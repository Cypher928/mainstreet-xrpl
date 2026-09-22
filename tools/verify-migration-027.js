'use strict';
/**
 * tools/verify-migration-027.js — run migration 027 for real, against nothing
 * that matters.
 *
 *   node tools/verify-migration-027.js
 *
 * Same discipline as 023–026: a migration reviewed by reading is a migration
 * whose first execution is on a real database with real rows. This builds a
 * throwaway PostgreSQL cluster, stands up what 027 depends on FROM THE REPO'S
 * OWN FILES (000, 006, 023, 024, 025, 026) plus the Supabase pieces those
 * assume, and executes 027 against it.
 *
 * It touches NO Supabase project.
 *
 * WHAT IT PROVES
 *
 *   1  027 applies on top of 026 and is re-runnable
 *   2  the column is what it claims: text, nullable, no default, documented
 *   3  all six reasons are accepted on a failed row, and a seventh word is not
 *   4  a reason CANNOT ride on a status that is not a failure — a reading that
 *      landed does not keep wearing the reason its first attempt failed with
 *   5  null is accepted under every status, including failed: 027 does not
 *      force a reason to exist
 *   6  025's STATUS vocabulary is untouched — this is not a sixth status
 *   7  error_message and abstraction_error are independent: the parsing
 *      stage's account and the reading stage's account do not overwrite
 *      each other
 *   8  THE EVIDENCE IS NEVER TOUCHED: recording a reason leaves
 *      abstracted_fields byte-identical, and clearing one leaves it alone too
 *   9  existing rows survive the migration unchanged — 027 adds, it does not
 *      rewrite
 *  10  RLS still holds on the widened table: the owner may record a reason,
 *      another user may not, anon sees nothing
 *  11  026's guarantees still hold — decisions are still append-only
 *  12  the rollback removes exactly what 027 added and nothing else
 *  13  027 applies again after the rollback
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
const M027 = path.join(MIG, '027_acquisition_abstraction_error.sql');
const R027 = path.join(MIG, '027_acquisition_abstraction_error_rollback.sql');

// The vocabulary is read from the module that owns it, not retyped here. If
// acquisition-terms.js and the migration ever disagree, this harness fails
// rather than quietly testing the words it happened to be written with.
const AT = require(path.join(ROOT, 'acquisition-terms.js'));
const AD = require(path.join(ROOT, 'acquisition-documents.js'));
const REASONS = AT.ABSTRACTION_ERRORS;

const PGBIN = ['/usr/lib/postgresql/16/bin', '/usr/lib/postgresql/15/bin', '/usr/pgsql-16/bin', '/usr/local/bin']
  .find(d => { try { return fs.existsSync(path.join(d, 'initdb')) && fs.existsSync(path.join(d, 'postgres')); } catch (_) { return false; } });

if (!PGBIN) {
  console.log('\n\x1b[33m⚠ SKIPPED — no local PostgreSQL server binary found.\x1b[0m');
  console.log('  Migration 027 was NOT executed. This is a skip, not a pass.');
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
    console.log('  Migration 027 was NOT executed. This is a skip, not a pass.\n');
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

const tmp  = fs.mkdtempSync(path.join(os.tmpdir(), 'pg027-'));
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
console.log('\n══ migration 027 — executed against a throwaway cluster ══');
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
                 '024_acquisition_document_classification.sql', '025_acquisition_abstraction.sql',
                 '026_acquisition_term_decisions.sql']) {
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
                 values ('${RA}','${UA}','ShopRite Supermarkets') returning id;`).out.trim();

// A document carrying REAL P4-1 evidence, including the derived base_rent the
// live run produced. Nothing 027 does may alter a byte of it.
const EVIDENCE = `'{"schemaVersion":1,"model":"claude-sonnet-4-6","at":"2026-09-21T20:30:55.850Z","fields":{`
  + `"cap":{"value":4,"quote":"CAM increases are capped at 4% annually.","page":4,"confidence":0.95},`
  + `"base_rent":{"value":1202500,"quote":"Tenant agrees to pay base rent of $18.50 per square foot annually.","page":3,"confidence":0.95},`
  + `"renewal_options":{"value":null,"quote":null,"page":null,"confidence":null}}}'::jsonb`;

// GOOD is a reading that landed. BAD is the live amendment: classified, text
// on the row, and `failed` with nothing to say for itself. 027 exists for BAD.
const GOOD = psql(`insert into public.acquisition_documents
    (review_id,user_id,file_name,intake_kind,intake_id,parsing_status,storage_path,extracted_text,
     doc_type,doc_type_status,doc_type_source,confirmed_by,confirmed_at,family_id,family_status,family_source,
     abstracted_fields,abstraction_status,abstraction_model,abstracted_at)
  values ('${RA}','${UA}','ShopRite.pdf','lease','intake-good','success','leases/${UA}/acq_x-ShopRite.pdf','TEXT',
          'renewal','corrected','human','${UA}',now(),'${FA}','confirmed','human',
          ${EVIDENCE},'success','claude-sonnet-4-6','2026-09-21T20:30:55.850Z')
  returning id;`).out.trim();
const BAD = psql(`insert into public.acquisition_documents
    (review_id,user_id,file_name,intake_kind,intake_id,parsing_status,extracted_text,error_message,
     doc_type,doc_type_status,doc_type_source,abstraction_status)
  values ('${RA}','${UA}','Amendment.pdf','lease','intake-bad','success','TEST AMENDMENT TEXT','storage was slow',
          'amendment','proposed','ai','failed')
  returning id;`).out.trim();
const BOTH = psql(`select count(*) from public.acquisition_documents where id in ('${GOOD}','${BAD}');`).out;
check('two documents exist before 027 runs — one read, one failed', BOTH === '2');

const evidenceHash = () => psql(`select md5(abstracted_fields::text) from public.acquisition_documents where id='${GOOD}';`).out;
const EV0 = evidenceHash();
const rowShot = () => psql(`select file_name||'|'||parsing_status||'|'||coalesce(error_message,'-')||'|'
                                 ||coalesce(doc_type,'-')||'|'||doc_type_status||'|'||abstraction_status
                            from public.acquisition_documents where id='${BAD}';`).out;
const BAD0 = rowShot();

// ── 1 · it applies ─────────────────────────────────────────────────────────
section('1 · 027 applies on top of 026, and again');
const first = psqlFile(M027);
check('027 applies cleanly', first.ok, first.ok ? '' : first.out.slice(0, 400));
const second = psqlFile(M027);
check('027 is re-runnable — every step is guarded', second.ok, second.ok ? '' : second.out.slice(0, 400));

// ── 2 · the column is what it claims ───────────────────────────────────────
section('2 · the column');
check('abstraction_error exists as nullable text with no default',
  psql(`select data_type||'|'||is_nullable||'|'||coalesce(column_default,'-')
        from information_schema.columns
        where table_schema='public' and table_name='acquisition_documents'
          and column_name='abstraction_error';`).out === 'text|YES|-');
check('it carries a comment saying what it is and what it is not',
  /no_text/.test(psql(`select col_description('public.acquisition_documents'::regclass,
       (select ordinal_position from information_schema.columns
         where table_schema='public' and table_name='acquisition_documents'
           and column_name='abstraction_error'));`).out));
check('both of its constraints are present',
  psql(`select count(*) from pg_constraint
         where conrelid='public.acquisition_documents'::regclass
           and conname in ('acq_docs_abstraction_error_check',
                           'acq_docs_abstraction_error_coherent_check');`).out === '2');

// ── 3 · the vocabulary ─────────────────────────────────────────────────────
section('3 · the six reasons, and only those six');
check('acquisition-terms.js and acquisition-documents.js name the same six',
  JSON.stringify(REASONS) === JSON.stringify(AD.ABSTRACTION_ERRORS),
  REASONS.join(','));
check('there are exactly six', REASONS.length === 6);
for (const r of REASONS) {
  check(`'${r}' is accepted on a failed row`,
    psql(`update public.acquisition_documents set abstraction_error='${r}' where id='${BAD}';`).ok);
}
check('a seventh word is REFUSED',
  refused(`update public.acquisition_documents set abstraction_error='mysterious' where id='${BAD}';`));
check('so is the empty string',
  refused(`update public.acquisition_documents set abstraction_error='' where id='${BAD}';`));
check('the migration file lists exactly the six the module does',
  REASONS.every(r => fs.readFileSync(M027, 'utf8').includes(`'${r}'`)));

// ── 4 · a reason belongs to a failure ──────────────────────────────────────
section('4 · a reason cannot ride on a status that is not a failure');
psql(`update public.acquisition_documents set abstraction_error='transport' where id='${BAD}';`);
for (const st of ['pending', 'skipped']) {
  check(`moving to '${st}' while a reason is set is REFUSED`,
    refused(`update public.acquisition_documents set abstraction_status='${st}' where id='${BAD}';`));
}
check("and 'success' with a reason is REFUSED even with fields and a timestamp",
  refused(`update public.acquisition_documents
             set abstraction_status='success', abstracted_fields='{"fields":{}}'::jsonb,
                 abstracted_at=now() where id='${BAD}';`));
check('clearing the reason in the same statement is ACCEPTED — this is how a re-read lands',
  psql(`update public.acquisition_documents
          set abstraction_status='success', abstracted_fields='{"fields":{}}'::jsonb,
              abstracted_at=now(), abstraction_error=null where id='${BAD}';`).ok);
check('a reason cannot be set on the now-successful row',
  refused(`update public.acquisition_documents set abstraction_error='no_fields' where id='${BAD}';`));
// Put it back to failed for the rest of the run.
psql(`update public.acquisition_documents
        set abstraction_status='failed', abstracted_fields='{}'::jsonb, abstracted_at=null,
            abstraction_error='transport' where id='${BAD}';`);

// ── 5 · null is always allowed ─────────────────────────────────────────────
section('5 · null is allowed under every status');
check('a failed row with no reason is still legal — 027 does not force one',
  psql(`update public.acquisition_documents set abstraction_error=null where id='${BAD}';`).ok);
check('and a pending row with no reason is legal',
  psql(`update public.acquisition_documents set abstraction_status='pending' where id='${BAD}';`).ok);
psql(`update public.acquisition_documents set abstraction_status='failed', abstraction_error='upstream_timeout' where id='${BAD}';`);

// ── 6 · the STATUS vocabulary is untouched ─────────────────────────────────
section('6 · this is not a sixth status');
check("025's status CHECK is still there, unmodified",
  psql(`select pg_get_constraintdef(oid) from pg_constraint
         where conrelid='public.acquisition_documents'::regclass
           and conname='acq_docs_abstraction_status_check';`).out.includes("'skipped'"));
for (const bogus of ['timeout', 'errored', 'unparsable']) {
  check(`abstraction_status='${bogus}' is still REFUSED`,
    refused(`update public.acquisition_documents set abstraction_status='${bogus}' where id='${BAD}';`));
}
check('the five statuses acquisition-documents.js knows are still the five',
  JSON.stringify(AD.ABSTRACTION_STATUSES) === JSON.stringify(['pending', 'success', 'partial', 'failed', 'skipped']));

// ── 7 · error_message is not borrowed ──────────────────────────────────────
section('7 · the parsing stage keeps its own account');
check('error_message survived the migration and both columns hold at once',
  psql(`select coalesce(error_message,'-')||'|'||coalesce(abstraction_error,'-')
        from public.acquisition_documents where id='${BAD}';`).out === 'storage was slow|upstream_timeout');
psql(`update public.acquisition_documents set abstraction_error='no_fields' where id='${BAD}';`);
check('changing the reading reason leaves the parsing message alone',
  psql(`select coalesce(error_message,'-') from public.acquisition_documents where id='${BAD}';`).out === 'storage was slow');
psql(`update public.acquisition_documents set error_message='something else' where id='${BAD}';`);
check('and changing the parsing message leaves the reading reason alone',
  psql(`select coalesce(abstraction_error,'-') from public.acquisition_documents where id='${BAD}';`).out === 'no_fields');

// ── 8 · the evidence is never touched ──────────────────────────────────────
section('8 · recording a reason does not disturb evidence');
check('the read document still has its evidence, byte for byte', evidenceHash() === EV0, EV0);
check('the derived base_rent and its clause are still exactly as written',
  psql(`select (abstracted_fields->'fields'->'base_rent'->>'value')||'|'
             ||(abstracted_fields->'fields'->'base_rent'->>'quote')
        from public.acquisition_documents where id='${GOOD}';`).out
  === '1202500|Tenant agrees to pay base rent of $18.50 per square foot annually.');
check('MISSING IS NOT NONE survived: renewal_options is still null, not 0 or ""',
  psql(`select coalesce(abstracted_fields->'fields'->'renewal_options'->>'value','NULL')
        from public.acquisition_documents where id='${GOOD}';`).out === 'NULL');

// ── 9 · existing rows survive ──────────────────────────────────────────────
section('9 · 027 adds, it does not rewrite');
check('the failed document kept every column it arrived with',
  rowShot().replace('something else', 'storage was slow') === BAD0, BAD0);
check('and its abstraction_error started life null, not defaulted to a word',
  psql(`select count(*) from public.acquisition_documents where id='${GOOD}' and abstraction_error is null;`).out === '1');

// ── 10 · RLS still holds on the widened table ──────────────────────────────
section('10 · RLS');
const ownerWrite = psql(`set local role authenticated; set local request.jwt.claim.sub='${UA}';
  update public.acquisition_documents set abstraction_error='unparsable' where id='${BAD}';`);
check('the owner may record a reason on their own document', ownerWrite.ok, ownerWrite.ok ? '' : ownerWrite.out.slice(0, 160));
const otherWrite = psql(`set local role authenticated; set local request.jwt.claim.sub='${UB}';
  update public.acquisition_documents set abstraction_error='transport' where id='${BAD}';
  select count(*) from public.acquisition_documents where id='${BAD}' and abstraction_error='transport';`);
check('another user\'s write reaches no row', otherWrite.ok && otherWrite.out.trim() === '0',
  otherWrite.out.slice(0, 160));
const anonSee = psql(`set local role anon; select count(*) from public.acquisition_documents;`);
check('anon sees no documents at all', !anonSee.ok || anonSee.out.trim() === '0');

// ── 11 · 026 still holds ───────────────────────────────────────────────────
section('11 · 026 is undisturbed');
const DEC = psql(`insert into public.acquisition_term_decisions
    (review_id,user_id,family_id,field_key,action,new_value,decided_by,decided_at)
  values ('${RA}','${UA}','${FA}','cap','confirm','4','${UA}',now()) returning id;`);
check('a decision can still be recorded', DEC.ok, DEC.ok ? '' : DEC.out.slice(0, 200));
check('and it is still append-only — UPDATE refused',
  refused(`update public.acquisition_term_decisions set new_value='9' where id='${DEC.out.trim()}';`));
check('and DELETE refused',
  refused(`delete from public.acquisition_term_decisions where id='${DEC.out.trim()}';`));

// ── 12 · the rollback ──────────────────────────────────────────────────────
section('12 · the rollback removes exactly what 027 added');
const rb = psqlFile(R027);
check('the rollback applies', rb.ok, rb.ok ? '' : rb.out.slice(0, 300));
check('the column is gone',
  psql(`select count(*) from information_schema.columns
         where table_schema='public' and table_name='acquisition_documents'
           and column_name='abstraction_error';`).out === '0');
check('both of its constraints are gone',
  psql(`select count(*) from pg_constraint
         where conrelid='public.acquisition_documents'::regclass
           and conname in ('acq_docs_abstraction_error_check',
                           'acq_docs_abstraction_error_coherent_check');`).out === '0');
check('and nothing else went with it — the evidence is still byte-identical', evidenceHash() === EV0);
check('the status column and its CHECK survive',
  psql(`select count(*) from pg_constraint
         where conrelid='public.acquisition_documents'::regclass
           and conname='acq_docs_abstraction_status_check';`).out === '1');
check('error_message survives', psql(`select coalesce(error_message,'-')
        from public.acquisition_documents where id='${BAD}';`).out === 'something else');
check("026's decisions table survives the 027 rollback",
  psql(`select count(*) from public.acquisition_term_decisions;`).out === '1');
const rb2 = psqlFile(R027);
check('the rollback is re-runnable', rb2.ok, rb2.ok ? '' : rb2.out.slice(0, 300));

// ── 13 · and it applies again ──────────────────────────────────────────────
section('13 · applies again after the rollback');
const again = psqlFile(M027);
check('027 applies cleanly again', again.ok, again.ok ? '' : again.out.slice(0, 400));
check('the column is back, null everywhere — the reasons really were destroyed',
  psql(`select count(*) from public.acquisition_documents where abstraction_error is not null;`).out === '0');
check('and the six are enforced again',
  refused(`update public.acquisition_documents set abstraction_error='mysterious' where id='${BAD}';`)
  && psql(`update public.acquisition_documents set abstraction_error='no_text' where id='${BAD}';`).ok);

console.log('\n' + '─'.repeat(64));
console.log(`RESULT: ${pass} passed, ${fail} failed`);
if (fail) { console.log('FAILED:'); failures.forEach(f => console.log('  - ' + f)); }
process.exit(fail ? 1 : 0);

})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(2); });
