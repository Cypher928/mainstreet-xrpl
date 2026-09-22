'use strict';
/**
 * tools/verify-migration-026.js — run migration 026 for real, against nothing
 * that matters.
 *
 *   node tools/verify-migration-026.js
 *
 * Same discipline as 023, 024 and 025: a migration reviewed by reading is a
 * migration whose first execution is on a real database with real rows. This
 * builds a throwaway PostgreSQL cluster, stands up what 026 depends on FROM
 * THE REPO'S OWN FILES (000, 006, 023, 024, 025) plus the Supabase pieces
 * those assume, and executes 026 against it.
 *
 * It touches NO Supabase project.
 *
 * WHAT IT PROVES
 *
 *   1  026 applies on top of 025 and is re-runnable
 *   2  the four actions are the only four, and a correction must correct
 *      something
 *   3  APPEND-ONLY IS REAL: update and delete are both refused, by the
 *      database, for the owner as much as for anyone
 *   4  a decision names an actor, and cannot name somebody else
 *   5  a decision CANNOT be filed on another owner's review, family or
 *      document — every key is composite on user_id
 *   6  RLS: the owner sees their decisions, another user sees none, anon sees
 *      nothing, and there is no anon policy
 *   7  THE AI EVIDENCE IS NEVER TOUCHED: recording confirm, correct and reject
 *      leaves abstracted_fields byte-identical
 *   8  a correction keeps the value it replaced (previous_value)
 *   9  the history survives: four decisions on one field are four rows, and
 *      the latest by decided_at is the one in force
 *  10  deleting a family unfiles its decisions instead of deleting them;
 *      deleting a review takes them with it
 *  11  D-17: needs_review is accepted, and the old two values still are
 *  12  025's and 024's guarantees still hold
 *  13  the rollback removes exactly what 026 added, REFUSES to narrow D-17
 *      while a document sits in needs_review, and leaves the AI evidence alone
 *  14  026 applies again after the rollback
 *
 * SKIPS (exit 0) when no local PostgreSQL server binary is present, and says so
 * loudly — a skip is not a pass and must not read like one.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const MIG  = path.join(ROOT, 'migrations');
const M026 = path.join(MIG, '026_acquisition_term_decisions.sql');
const R026 = path.join(MIG, '026_acquisition_term_decisions_rollback.sql');

const PGBIN = ['/usr/lib/postgresql/16/bin', '/usr/lib/postgresql/15/bin', '/usr/pgsql-16/bin', '/usr/local/bin']
  .find(d => { try { return fs.existsSync(path.join(d, 'initdb')) && fs.existsSync(path.join(d, 'postgres')); } catch (_) { return false; } });

if (!PGBIN) {
  console.log('\n\x1b[33m⚠ SKIPPED — no local PostgreSQL server binary found.\x1b[0m');
  console.log('  Migration 026 was NOT executed. This is a skip, not a pass.');
  console.log('  Install postgresql-16 (server, not just psql) to run this verification.\n');
  process.exit(0);
}

const IS_ROOT = typeof process.getuid === 'function' && process.getuid() === 0;
let AS_PG = null;
if (IS_ROOT) {
  try {
    execFileSync('id', ['-u', 'postgres'], { stdio: 'ignore' });
    AS_PG = ['setpriv', ['--reuid=postgres', '--regid=postgres', '--clear-groups']];
  } catch (_) {
    console.log('\n\x1b[33m⚠ SKIPPED — running as root and there is no `postgres` user to drop to.\x1b[0m');
    console.log('  Migration 026 was NOT executed. This is a skip, not a pass.\n');
    process.exit(0);
  }
}
function pgArgs(bin, args) {
  return AS_PG ? [AS_PG[0], [...AS_PG[1], path.join(PGBIN, bin), ...args]]
               : [path.join(PGBIN, bin), args];
}
function pgRun(bin, args, opts) { const [c, a] = pgArgs(bin, args); return execFileSync(c, a, opts); }
function pgSpawn(bin, args, opts) { const [c, a] = pgArgs(bin, args); return spawn(c, a, opts); }

let pass = 0, fail = 0;
const failures = [];
function check(name, ok, detail) {
  if (ok) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${name}${detail ? '  — ' + detail : ''}`); }
  else    { fail++; failures.push(name + (detail ? ': ' + detail : '')); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? '  — ' + detail : ''}`); }
}
function section(s) { console.log('\n── ' + s + ' ' + '─'.repeat(Math.max(0, 60 - s.length))); }

const tmp  = fs.mkdtempSync(path.join(os.tmpdir(), 'pg026-'));
const DATA = path.join(tmp, 'data');
const SOCK = path.join(tmp, 'sock');
const LOG  = path.join(tmp, 'pg.log');
fs.mkdirSync(SOCK);
fs.writeFileSync(LOG, '');
if (AS_PG) { try { execFileSync('chown', ['-R', 'postgres:postgres', tmp]); } catch (_) {} }
let server = null;

function psql(sql) {
  const args = ['-h', SOCK, '-U', 'postgres', '-d', 'verifydb', '-v', 'ON_ERROR_STOP=1', '-X', '-q', '-t', '-A', '-c', sql];
  try {
    return { ok: true, out: pgRun('psql', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() };
  } catch (e) {
    return { ok: false, out: String((e.stdout || '') + (e.stderr || '')).trim() };
  }
}
function psqlFile(file) {
  const staged = path.join(tmp, 'sql-' + path.basename(file));
  fs.writeFileSync(staged, fs.readFileSync(file, 'utf8'));
  if (AS_PG) { try { execFileSync('chown', ['postgres:postgres', staged]); } catch (_) {} }
  const args = ['-h', SOCK, '-U', 'postgres', '-d', 'verifydb', '-v', 'ON_ERROR_STOP=1', '-X', '-q', '-f', staged];
  try {
    return { ok: true, out: pgRun('psql', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() };
  } catch (e) {
    return { ok: false, out: String((e.stdout || '') + (e.stderr || '')).trim() };
  }
}
/** True when the statement was REFUSED — which is what most of this proves. */
function refused(sql) { return !psql(sql).ok; }

function cleanup() {
  try { if (server) pgRun('pg_ctl', ['-D', DATA, '-m', 'immediate', 'stop'], { stdio: 'ignore' }); } catch (_) {}
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
}
process.on('exit', cleanup);

(async () => {
console.log('\n══ migration 026 — executed against a throwaway cluster ══');
console.log('   postgres: ' + PGBIN);
console.log('   cluster:  ' + DATA + '  (deleted on exit)');
console.log('   NO Supabase project is contacted by this script.');

section('cluster');
pgRun('initdb', ['-D', DATA, '-U', 'postgres', '--auth=trust', '-E', 'UTF8'], { stdio: 'ignore' });
server = pgSpawn('postgres',
  ['-D', DATA, '-k', SOCK, '-c', 'listen_addresses=', '-c', 'log_min_messages=warning'],
  { stdio: ['ignore', fs.openSync(LOG, 'a'), fs.openSync(LOG, 'a')] });

let up = false;
for (let i = 0; i < 100; i++) {
  try { pgRun('pg_isready', ['-h', SOCK, '-U', 'postgres'], { stdio: 'ignore' }); up = true; break; }
  catch (_) { execFileSync('sleep', ['0.2']); }
}
check('a throwaway PostgreSQL cluster is running', up, up ? '' : fs.readFileSync(LOG, 'utf8').slice(-400));
if (!up) { console.log('\nCannot continue without the cluster.'); process.exit(2); }
pgRun('createdb', ['-h', SOCK, '-U', 'postgres', 'verifydb'], { stdio: 'ignore' });

const boot = psql(`
  create extension if not exists pgcrypto;
  do $$ begin
    if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
    if not exists (select 1 from pg_roles where rolname='service_role')  then create role service_role nologin;  end if;
    if not exists (select 1 from pg_roles where rolname='anon')          then create role anon nologin;          end if;
  end $$;
  create schema if not exists auth;
  create table if not exists auth.users (id uuid primary key default gen_random_uuid(), email text);
  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  grant usage on schema auth to authenticated, service_role;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
`);
check('Supabase prerequisites (roles, auth schema, auth.uid, grants) created', boot.ok, boot.ok ? '' : boot.out.slice(0, 200));

section('prerequisite migrations, from the repo');
for (const f of ['000_base_schema.sql', '006_acquisition_reviews.sql', '023_acquisition_documents.sql',
                 '024_acquisition_document_classification.sql', '025_acquisition_abstraction.sql']) {
  const r = psqlFile(path.join(MIG, f));
  check(f + ' applies', r.ok, r.ok ? '' : r.out.slice(0, 300));
}

const UA = '11111111-1111-4111-8111-111111111111';
const UB = '22222222-2222-4222-8222-222222222222';
const RA = 'aaaaaaaa-0000-4000-8000-00000000000a';
const RB = 'bbbbbbbb-0000-4000-8000-00000000000b';
psql(`insert into auth.users (id, email) values ('${UA}','a@example.com'), ('${UB}','b@example.com');`);
psql(`insert into public.acquisition_reviews (id, user_id, name, status) values
        ('${RA}','${UA}','Harborview','draft'), ('${RB}','${UB}','Lakeview','draft');`);

const FA = psql(`insert into public.acquisition_document_families (review_id,user_id,label)
                 values ('${RA}','${UA}','Coastal Outfitters') returning id;`).out.trim();
const FB = psql(`insert into public.acquisition_document_families (review_id,user_id,label)
                 values ('${RB}','${UB}','Theirs') returning id;`).out.trim();

// A document carrying REAL P4-1 evidence, including the derived base_rent the
// live run produced. Nothing 026 does may alter a byte of it.
const EVIDENCE = `'{"schemaVersion":1,"model":"claude-sonnet-4-6","at":"2026-09-21T20:30:55.850Z","fields":{`
  + `"cap":{"value":4,"quote":"CAM increases are capped at 4% annually.","page":4,"confidence":0.95},`
  + `"base_rent":{"value":1202500,"quote":"Tenant agrees to pay base rent of $18.50 per square foot annually.","page":3,"confidence":0.95},`
  + `"renewal_options":{"value":null,"quote":null,"page":null,"confidence":null}}}'::jsonb`;
const DOC = psql(`insert into public.acquisition_documents
    (review_id,user_id,file_name,intake_kind,intake_id,parsing_status,storage_path,extracted_text,
     doc_type,doc_type_status,doc_type_source,confirmed_by,confirmed_at,family_id,family_status,family_source,
     abstracted_fields,abstraction_status,abstraction_model,abstracted_at)
  values ('${RA}','${UA}','ShopRite.pdf','lease','intake-1','success','leases/${UA}/acq_x_1-ShopRite.pdf','TEXT',
          'renewal','corrected','human','${UA}',now(),'${FA}','confirmed','human',
          ${EVIDENCE},'success','claude-sonnet-4-6','2026-09-21T20:30:55.850Z')
  returning id;`).out.trim();
const DOCB = psql(`insert into public.acquisition_documents (review_id,user_id,file_name,intake_kind,intake_id)
                   values ('${RB}','${UB}','theirs.pdf','lease','intake-b') returning id;`).out.trim();
const evidenceHash = () => psql(`select md5(abstracted_fields::text) from public.acquisition_documents where id='${DOC}';`).out;
const EV0 = evidenceHash();

// ── 1 · applies and re-applies ─────────────────────────────────────────────
section('1 · applies on top of 025, and is re-runnable');
const first = psqlFile(M026);
check('026 applies cleanly', first.ok, first.ok ? '' : first.out.slice(0, 500));
if (!first.ok) { console.log('\nStopping: 026 did not apply.'); process.exit(1); }

const shape = () => psql(`select column_name||':'||data_type||':'||is_nullable from information_schema.columns
                           where table_schema='public' and table_name='acquisition_term_decisions'
                           order by column_name;`).out;
const before = shape();
const second = psqlFile(M026);
check('026 applies a SECOND time without error', second.ok, second.ok ? '' : second.out.slice(0, 400));
check('and the shape is unchanged by the second run', shape() === before);
const COLUMNS = ['action', 'created_at', 'decided_at', 'decided_by', 'family_id', 'field_key', 'id',
                 'new_value', 'note', 'previous_value', 'review_id', 'source_document_id',
                 'source_page', 'source_quote', 'user_id'];
const actualCols = psql(`select string_agg(column_name, ',' order by column_name) from information_schema.columns
                          where table_schema='public' and table_name='acquisition_term_decisions';`).out;
check('the table has exactly the columns the approved plan named, and no others',
  actualCols === COLUMNS.join(','), actualCols);
check('review_id, user_id, field_key, action and decided_by are all NOT NULL',
  psql(`select count(*) from information_schema.columns where table_schema='public'
         and table_name='acquisition_term_decisions' and is_nullable='NO'
         and column_name in ('review_id','user_id','field_key','action','decided_by','decided_at','created_at','id');`).out === '8');

// ── 2 · the vocabulary ─────────────────────────────────────────────────────
section('2 · four actions, and a correction that corrects something');
const ins = (over) => {
  const o = Object.assign({ review: RA, user: UA, family: `'${FA}'`, field: `'cap'`, action: `'confirm'`,
    prev: 'null', next: 'null', srcDoc: 'null', srcQuote: 'null', srcPage: 'null',
    by: UA, at: 'now()', note: 'null' }, over);
  return `insert into public.acquisition_term_decisions
    (review_id,user_id,family_id,field_key,action,previous_value,new_value,source_document_id,source_quote,source_page,decided_by,decided_at,note)
    values ('${o.review}','${o.user}',${o.family},${o.field},${o.action},${o.prev},${o.next},${o.srcDoc},${o.srcQuote},${o.srcPage},'${o.by}',${o.at},${o.note})`;
};
for (const a of ['confirm', 'reject', 'reopen']) {
  check(`'${a}' is accepted with no new value`, psql(ins({ action: `'${a}'` }) + ';').ok, a);
}
check("'correct' with a new value is accepted",
  psql(ins({ action: `'correct'`, next: `'5'`, prev: `'4'` }) + ';').ok);
check("'correct' with NO new value is refused — a correction must correct something",
  refused(ins({ action: `'correct'` }) + ';'));
check("'correct' with a blank new value is refused too",
  refused(ins({ action: `'correct'`, next: `'   '` }) + ';'));
check("an action outside the four is refused",
  refused(ins({ action: `'approve'` }) + ';'));
check('a blank field_key is refused',
  refused(ins({ field: `'   '` }) + ';'));
check('a page of zero or less is refused',
  refused(ins({ srcPage: '0' }) + ';') && refused(ins({ srcPage: '-2' }) + ';'));
check('an over-long quote is refused',
  refused(ins({ srcQuote: `repeat('x', 601)` }) + ';'));

// ── 3 · append-only ────────────────────────────────────────────────────────
section('3 · append-only is enforced by the database, not by the app');
const anyId = psql(`select id from public.acquisition_term_decisions limit 1;`).out.trim();
check('UPDATE is refused', refused(`update public.acquisition_term_decisions set note='tidied' where id='${anyId}';`));
check('changing the action is refused',
  refused(`update public.acquisition_term_decisions
             set action = case when action = 'confirm' then 'reject' else 'confirm' end
           where id='${anyId}';`));
check('changing the value is refused', refused(`update public.acquisition_term_decisions set new_value='99' where id='${anyId}';`));
check('changing the actor or the time is refused',
  refused(`update public.acquisition_term_decisions set decided_by='${UB}' where id='${anyId}';`)
  && refused(`update public.acquisition_term_decisions set decided_at=now() where id='${anyId}';`));
check('DELETE is refused', refused(`delete from public.acquisition_term_decisions where id='${anyId}';`));
check('a blanket DELETE is refused too', refused(`delete from public.acquisition_term_decisions;`));
check('and the rows are all still there',
  psql(`select count(*) from public.acquisition_term_decisions;`).out === '4');
// The narrow exception the cascades need, and its limits.
check('clearing family_id alone is allowed — that is what ON DELETE SET NULL does',
  psql(`update public.acquisition_term_decisions set family_id=null where id='${anyId}';`).ok);
check('but clearing it while ALSO editing the decision is refused',
  refused(`update public.acquisition_term_decisions set family_id=null, note='sneaked in' where id='${anyId}';`));
check('and a cleared link cannot be repointed at another family',
  refused(`update public.acquisition_term_decisions set family_id='${FA}' where id='${anyId}';`));
psql(`update public.acquisition_term_decisions set family_id=null where id='${anyId}';`);
const asOwner = psql(`set local role authenticated; set local request.jwt.claim.sub='${UA}';
                      update public.acquisition_term_decisions set note='mine to edit' where id='${anyId}';`);
check('the OWNER cannot edit their own decision either', !asOwner.ok, asOwner.ok ? 'it was allowed' : '');

// ── 4 · an actor, and only the right one ───────────────────────────────────
section('4 · a decision names the person who made it');
check('decided_by NOT NULL is on the table',
  psql(`select is_nullable from information_schema.columns where table_schema='public'
         and table_name='acquisition_term_decisions' and column_name='decided_by';`).out === 'NO');
check('a decision naming somebody else as the decider is refused',
  refused(ins({ by: UB }) + ';'));
check('decided_at defaults to now() rather than being optional',
  psql(`select count(*) from public.acquisition_term_decisions where decided_at is null;`).out === '0');

// ── 5 · nothing points across owners ───────────────────────────────────────
section('5 · every key is composite on the owner');
check("a decision on another owner's review is refused",
  refused(ins({ review: RB, family: 'null' }) + ';'));
check("a decision filed into another owner's family is refused",
  refused(ins({ family: `'${FB}'` }) + ';'));
check("a decision citing another owner's document is refused",
  refused(ins({ srcDoc: `'${DOCB}'` }) + ';'));
check('but citing the owner\'s own document is accepted',
  psql(ins({ srcDoc: `'${DOC}'`, srcQuote: `'CAM increases are capped at 4% annually.'`, srcPage: '4' }) + ';').ok);

// ── 6 · RLS ────────────────────────────────────────────────────────────────
section('6 · who may see a decision');
check('RLS is enabled',
  psql(`select relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
         where n.nspname='public' and c.relname='acquisition_term_decisions';`).out === 't');
const pol = psql(`select policyname||'='||array_to_string(roles,'+') from pg_policies
                   where schemaname='public' and tablename='acquisition_term_decisions' order by policyname;`).out;
check('exactly two policies: owner (authenticated) and service_role',
  pol === 'acq_term_decisions_owner_all=authenticated\nacq_term_decisions_service_role_all=service_role',
  pol.replace(/\n/g, ' | '));
check('no policy grants anon anything',
  psql(`select count(*) from pg_policies where schemaname='public' and tablename='acquisition_term_decisions'
         and 'anon' = any(roles);`).out === '0');
const seeA = psql(`set local role authenticated; set local request.jwt.claim.sub='${UA}';
                   select count(*) from public.acquisition_term_decisions;`);
check('the owner sees their own decisions', Number(seeA.out) === 5, seeA.out);
const seeB = psql(`set local role authenticated; set local request.jwt.claim.sub='${UB}';
                   select count(*) from public.acquisition_term_decisions;`);
check('another user sees none of them', seeB.out === '0', seeB.out);
const seeAnon = psql(`set local role anon; select count(*) from public.acquisition_term_decisions;`);
check('anon sees nothing at all', seeAnon.out === '0', seeAnon.out);
const writeB = psql(`set local role authenticated; set local request.jwt.claim.sub='${UB}';
                     ${ins({ user: UB, by: UB, family: 'null' })};`);
check("another user cannot file a decision on this owner's review", !writeB.ok);

// ── 7 · THE AI EVIDENCE IS NEVER TOUCHED ───────────────────────────────────
section('7 · recording a decision does not touch what the document said');
check('the evidence is byte-identical after five decisions', evidenceHash() === EV0, EV0);
check('including a rejection — rejecting a reading does not delete it',
  psql(ins({ action: `'reject'`, field: `'base_rent'` }) + ';').ok && evidenceHash() === EV0);
check('and a correction — correcting a term does not rewrite the document',
  psql(ins({ action: `'correct'`, field: `'base_rent'`, prev: `'1202500'`, next: `'1202500'`,
             srcDoc: `'${DOC}'`, srcQuote: `'annual base rent of $1,202,500'` }) + ';').ok
  && evidenceHash() === EV0);
check('the derived base_rent figure is still exactly as the model left it',
  psql(`select (abstracted_fields->'fields'->'base_rent'->>'value')||'|'||(abstracted_fields->'fields'->'base_rent'->>'quote')
          from public.acquisition_documents where id='${DOC}';`).out
  === '1202500|Tenant agrees to pay base rent of $18.50 per square foot annually.');
check('and the term nobody established is still null and null',
  psql(`select jsonb_typeof(abstracted_fields->'fields'->'renewal_options'->'value')||'|'
             ||coalesce(abstracted_fields->'fields'->'renewal_options'->>'quote','∅')
          from public.acquisition_documents where id='${DOC}';`).out === 'null|∅');

// ── 8 · a correction keeps what it replaced ────────────────────────────────
section('8 · a correction records the value it replaced');
check('previous_value is stored alongside the new one',
  psql(`select previous_value||'→'||new_value from public.acquisition_term_decisions
         where action='correct' and field_key='cap' limit 1;`).out === '4→5');

// ── 9 · the history is the point ───────────────────────────────────────────
section('9 · four decisions on one field are four rows, newest in force');
psql(`delete from public.acquisition_term_decisions where false;`); // no-op, keeps intent explicit
const FIELD = 'admin_fee_pct';
const seq = [
  [`'confirm'`, 'null', `'2026-09-22T10:00:00Z'`],
  [`'correct'`, `'15'`, `'2026-09-22T11:00:00Z'`],
  [`'reject'`,  'null', `'2026-09-22T12:00:00Z'`],
  [`'reopen'`,  'null', `'2026-09-22T13:00:00Z'`],
];
let seqOk = true;
for (const [action, next, at] of seq) {
  const r = psql(ins({ action, next, prev: `'12'`, field: `'${FIELD}'`, at }) + ';');
  if (!r.ok) { seqOk = false; console.log('     ' + r.out.slice(0, 160)); }
}
check('all four acts are recorded', seqOk);
check('as four separate rows',
  psql(`select count(*) from public.acquisition_term_decisions where field_key='${FIELD}';`).out === '4');
check('and the latest by decided_at is the reopen',
  psql(`select action from public.acquisition_term_decisions where field_key='${FIELD}'
         order by decided_at desc limit 1;`).out === 'reopen');
check('the earlier acts are still readable — nothing was superseded away',
  psql(`select string_agg(action, ',' order by decided_at) from public.acquisition_term_decisions
         where field_key='${FIELD}';`).out === 'confirm,correct,reject,reopen');

// ── 10 · deletes ───────────────────────────────────────────────────────────
section('10 · what happens when a family or a review goes');
// This is what the blanket append-only refusal broke, and why it was replaced:
// the database's own cascades are UPDATEs and DELETEs on this table.
const totalBefore = Number(psql(`select count(*) from public.acquisition_term_decisions;`).out);
const filedHere   = Number(psql(`select count(*) from public.acquisition_term_decisions where family_id='${FA}';`).out);
check('decisions are actually filed under the family before it goes', filedHere > 0, String(filedHere));
const famDel = psql(`delete from public.acquisition_document_families where id='${FA}';`);
check('deleting a family SUCCEEDS — append-only does not make a family undeletable', famDel.ok,
  famDel.ok ? '' : famDel.out.slice(0, 200));
check('its decisions SURVIVE, unfiled rather than deleted',
  Number(psql(`select count(*) from public.acquisition_term_decisions;`).out) === totalBefore,
  `${totalBefore} before, ${psql(`select count(*) from public.acquisition_term_decisions;`).out} after`);
check('and they kept their action, value, actor and time — only the filing was cleared',
  psql(`select count(*) from public.acquisition_term_decisions
         where family_id is null and decided_by='${UA}' and action is not null;`).out
  === String(totalBefore));
psql(`insert into public.acquisition_term_decisions (review_id,user_id,field_key,action,decided_by)
      values ('${RB}','${UB}','cap','confirm','${UB}');`);
check('a decision exists on the other review before it is deleted',
  psql(`select count(*) from public.acquisition_term_decisions where review_id='${RB}';`).out === '1');
const revDel = psql(`delete from public.acquisition_reviews where id='${RB}';`);
check('deleting a REVIEW succeeds — append-only does not make a review undeletable', revDel.ok,
  revDel.ok ? '' : revDel.out.slice(0, 200));
check('and takes its decisions with it',
  psql(`select count(*) from public.acquisition_term_decisions where review_id='${RB}';`).out === '0');
check('while THIS review\'s decisions are all still there',
  psql(`select count(*) from public.acquisition_term_decisions where review_id='${RA}';`).out === String(totalBefore));

// ── 11 · D-17 ──────────────────────────────────────────────────────────────
section('11 · D-17 — a relationship that needs a person');
const D2 = psql(`insert into public.acquisition_documents (review_id,user_id,file_name,intake_kind,intake_id)
                 values ('${RA}','${UA}','amendment.pdf','lease','intake-2') returning id;`).out.trim();
check("relationship_status 'needs_review' is accepted",
  psql(`update public.acquisition_documents set parent_document_id='${DOC}', relationship='amends',
          relationship_status='needs_review' where id='${D2}';`).ok);
check('and the relationship itself is PRESERVED, not discarded',
  psql(`select relationship||'→'||(parent_document_id='${DOC}')::text from public.acquisition_documents where id='${D2}';`).out === 'amends→true');
check("'proposed' and 'confirmed' still mean what they meant",
  psql(`update public.acquisition_documents set relationship_status='proposed' where id='${D2}';`).ok
  && psql(`update public.acquisition_documents set relationship_status='confirmed', confirmed_by='${UA}' where id='${D2}';`).ok);
check('a relationship_status outside the three is still refused',
  refused(`update public.acquisition_documents set relationship_status='maybe' where id='${D2}';`));

// ── 12 · earlier migrations still hold ─────────────────────────────────────
section('12 · 024 and 025 are not weakened');
check('a confirmation with nobody confirming is still refused',
  refused(`update public.acquisition_documents set doc_type_status='confirmed', confirmed_by=null where id='${D2}';`));
check("'success' with no evidence is still refused",
  refused(`update public.acquisition_documents set abstraction_status='success', abstracted_fields='{}'::jsonb, abstracted_at=now() where id='${D2}';`));
check('the classification trigger is still attached',
  psql(`select count(*) from pg_trigger where tgrelid='public.acquisition_documents'::regclass and tgname='trg_acq_docs_coherence';`).out === '1');

// ── 13 · the rollback ──────────────────────────────────────────────────────
section('13 · the rollback, and what it refuses');
psql(`update public.acquisition_documents set relationship_status='needs_review' where id='${D2}';`);
const rb1 = psqlFile(R026);
check('the rollback runs with a document in needs_review', rb1.ok, rb1.ok ? '' : rb1.out.slice(0, 300));
check('the decisions table is gone',
  psql(`select count(*) from information_schema.tables where table_schema='public'
         and table_name='acquisition_term_decisions';`).out === '0');
check('but D-17 was NOT narrowed while a document sits in needs_review',
  psql(`select relationship_status from public.acquisition_documents where id='${D2}';`).out === 'needs_review');
check('and the AI evidence is untouched by the rollback', evidenceHash() === EV0);
check('the document, its text and its classification survive',
  psql(`select extracted_text||'|'||doc_type||'|'||doc_type_status from public.acquisition_documents where id='${DOC}';`).out
  === 'TEXT|renewal|corrected');

psql(`update public.acquisition_documents set relationship_status=null, relationship=null, parent_document_id=null where id='${D2}';`);
const rb2 = psqlFile(R026);
check('re-run once nothing is in needs_review, it narrows D-17 back to 024\'s two values', rb2.ok,
  rb2.ok ? '' : rb2.out.slice(0, 300));
check('and needs_review is refused again',
  refused(`update public.acquisition_documents set parent_document_id='${DOC}', relationship='amends',
             relationship_status='needs_review' where id='${D2}';`));
check('the append-only functions are gone too',
  psql(`select count(*) from pg_proc where proname in ('acq_term_decisions_append_only','acq_term_decisions_actor');`).out === '0');

// ── 14 · and it applies again ──────────────────────────────────────────────
section('14 · applies again after the rollback');
const again = psqlFile(M026);
check('026 applies cleanly again', again.ok, again.ok ? '' : again.out.slice(0, 400));
check('the table is back with its RLS and its append-only trigger',
  psql(`select relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
         where n.nspname='public' and c.relname='acquisition_term_decisions';`).out === 't'
  && psql(`select count(*) from pg_trigger where tgrelid='public.acquisition_term_decisions'::regclass
            and tgname in ('trg_acq_term_decisions_no_update','trg_acq_term_decisions_no_delete');`).out === '2');
check('and it is empty — the rollback really did destroy the history it warned about',
  psql(`select count(*) from public.acquisition_term_decisions;`).out === '0');

console.log('\n' + '─'.repeat(64));
console.log(`RESULT: ${pass} passed, ${fail} failed`);
if (fail) { console.log('FAILED:'); failures.forEach(f => console.log('  - ' + f)); }
process.exit(fail ? 1 : 0);

})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(2); });
