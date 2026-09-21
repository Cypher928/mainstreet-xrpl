'use strict';
/**
 * tools/verify-migration-024.js — run migration 024 for real, against nothing
 * that matters.
 *
 *   node tools/verify-migration-024.js
 *
 * THE POINT
 *
 * Same as tools/verify-migration-023.js, which this is modelled on: a migration
 * reviewed by reading is a migration whose first execution is on a real
 * database with real rows. This builds a throwaway PostgreSQL cluster, stands
 * up what 024 depends on FROM THE REPO'S OWN FILES (000, 006, 023) plus the
 * Supabase pieces those assume, and executes 024 against it.
 *
 * It touches NO Supabase project.
 *
 * WHAT IT PROVES
 *
 *   1  024 applies cleanly on top of 000 + 006 + 023, and is re-runnable
 *   2  intake_id is backfilled for rows that already existed under 023
 *   3  the identity swap: (review_id, file_name) is no longer unique,
 *      (review_id, intake_id) is
 *   4  D-14 — the same file name twice in one review now KEEPS BOTH sources,
 *      and the superseded row keeps its original, its text and its type
 *   5  supersession is not a delete: the older row is still readable
 *   6  the families table has RLS, two policies, and nothing for anon
 *   7  one user cannot read, file into, or point at another user's rows —
 *      family, parent and supersession are all composite on user_id
 *   8  a proposal cannot become a confirmation with nobody confirming it
 *   9  incoherent states are refused: a filed document with no family, a
 *      family with no standing, half a relationship, a self-reference
 *  10  every CHECK list rejects a value outside it, and the four
 *      LeaseIntelligence tier names are all accepted
 *  11  deleting a family unfiles its documents instead of deleting them
 *  12  deleting a review takes its documents and families with it
 *  13  the rollback restores 023's shape when the data allows it, and REFUSES
 *      to when restoring it would mean destroying a preserved source
 *  14  024 applies again cleanly after the rollback
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
const M024 = path.join(MIG, '024_acquisition_document_classification.sql');
const R024 = path.join(MIG, '024_acquisition_document_classification_rollback.sql');

const PGBIN = ['/usr/lib/postgresql/16/bin', '/usr/lib/postgresql/15/bin', '/usr/pgsql-16/bin', '/usr/local/bin']
  .find(d => { try { return fs.existsSync(path.join(d, 'initdb')) && fs.existsSync(path.join(d, 'postgres')); } catch (_) { return false; } });

if (!PGBIN) {
  console.log('\n\x1b[33m⚠ SKIPPED — no local PostgreSQL server binary found.\x1b[0m');
  console.log('  Migration 024 was NOT executed. This is a skip, not a pass.');
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
    console.log('  Migration 024 was NOT executed. This is a skip, not a pass.\n');
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

const tmp  = fs.mkdtempSync(path.join(os.tmpdir(), 'pg024-'));
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
console.log('\n══ migration 024 — executed against a throwaway cluster ══');
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

// The objects a Supabase project already has, which 000/006/023/024 reference.
// The default privileges line is what makes the RLS assertions below mean
// something: without a grant, a denied read would prove only that the grant
// was missing, not that the policy worked.
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
for (const f of ['000_base_schema.sql', '006_acquisition_reviews.sql', '023_acquisition_documents.sql']) {
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

// A document that already exists UNDER 023, so the backfill has something real
// to do — the Pilot table is not empty.
psql(`insert into public.acquisition_documents (review_id, user_id, file_name, intake_kind, parsing_status, storage_path, extracted_text)
      values ('${RA}','${UA}','coastal-lease.pdf','lease','success','leases/${UA}/acq_x_1-coastal-lease.pdf','ORIGINAL TEXT');`);

// ── 1 · applies, and is re-runnable ────────────────────────────────────────
section('1 · applies on top of 023, and is re-runnable');
const first = psqlFile(M024);
check('024 applies cleanly', first.ok, first.ok ? '' : first.out.slice(0, 500));
if (!first.ok) { console.log('\nStopping: 024 did not apply.'); process.exit(1); }

const shape = () => psql(`select table_name||'.'||column_name||':'||data_type from information_schema.columns
                           where table_schema='public'
                             and table_name in ('acquisition_documents','acquisition_document_families')
                           order by table_name, column_name;`).out;
const shapeBefore = shape();
const second = psqlFile(M024);
check('024 applies a SECOND time without error', second.ok, second.ok ? '' : second.out.slice(0, 400));
check('and the shape is unchanged by the second run', shape() === shapeBefore);

// ── 2 · the backfill ───────────────────────────────────────────────────────
section('2 · a row that already existed keeps its identity');
check('intake_id is NOT NULL on the table',
  psql(`select is_nullable from information_schema.columns
         where table_schema='public' and table_name='acquisition_documents' and column_name='intake_id';`).out === 'NO');
check('the pre-existing row was backfilled from its id',
  psql(`select count(*) from public.acquisition_documents where intake_id = id::text;`).out === '1');
check('and it kept its original and its text',
  psql(`select (storage_path is not null and extracted_text = 'ORIGINAL TEXT')::text
          from public.acquisition_documents where file_name='coastal-lease.pdf';`).out === 'true');

// ── 3 · the identity swap ──────────────────────────────────────────────────
section('3 · the identity of a document is its intake, not its name');
check('023\'s unique (review_id, file_name) is GONE',
  psql(`select count(*) from pg_constraint where conname='acquisition_documents_review_file_key'
         and conrelid='public.acquisition_documents'::regclass;`).out === '0');
check('unique (review_id, intake_id) is in its place',
  psql(`select count(*) from pg_constraint where conname='acquisition_documents_review_intake_key'
         and conrelid='public.acquisition_documents'::regclass;`).out === '1');
check('the name is still indexed, for lookup',
  psql(`select count(*) from pg_indexes where schemaname='public' and indexname='idx_acq_docs_review_file';`).out === '1');
check('one intake is still one row — the same intake_id twice is refused',
  refused(`insert into public.acquisition_documents (review_id, user_id, file_name, intake_kind, intake_id)
           values ('${RA}','${UA}','dup.pdf','lease','intake-fixed'),
                  ('${RA}','${UA}','dup-other.pdf','lease','intake-fixed');`));

// ── 4 · D-14, the case this increment had to answer ────────────────────────
section('4 · the same file name twice KEEPS BOTH sources');
const reup = psql(`insert into public.acquisition_documents
    (review_id, user_id, file_name, intake_kind, intake_id, parsing_status, storage_path, extracted_text)
  values ('${RA}','${UA}','coastal-lease.pdf','lease','intake-second','success',
          'leases/${UA}/acq_x_2-coastal-lease.pdf','REPLACEMENT TEXT')
  returning id;`);
check('a second upload of the same name is accepted', reup.ok, reup.ok ? '' : reup.out.slice(0, 200));
const newId = reup.out.trim();
check('both documents of that name now exist',
  psql(`select count(*) from public.acquisition_documents where file_name='coastal-lease.pdf';`).out === '2');

psql(`update public.acquisition_documents set superseded_by_document_id = '${newId}'
       where file_name='coastal-lease.pdf' and id <> '${newId}';`);
check('the older row is marked superseded by the newer',
  psql(`select count(*) from public.acquisition_documents
         where superseded_by_document_id='${newId}';`).out === '1');
check('and it STILL has its own original and its own text — nothing was replaced',
  psql(`select extracted_text from public.acquisition_documents
         where file_name='coastal-lease.pdf' and superseded_by_document_id is not null;`).out === 'ORIGINAL TEXT');
check('the two rows point at two different stored objects',
  psql(`select count(distinct storage_path) from public.acquisition_documents where file_name='coastal-lease.pdf';`).out === '2');
check('the current set of the review is one predicate away',
  psql(`select count(*) from public.acquisition_documents
         where review_id='${RA}' and superseded_by_document_id is null;`).out
  === psql(`select count(*) from public.acquisition_documents where review_id='${RA}';`).out.replace(/^(\d+)$/, (m, n) => String(Number(n) - 1)));
check('no document supersedes itself',
  refused(`update public.acquisition_documents set superseded_by_document_id = id where id='${newId}';`));

// ── 5 · families, and who may see them ─────────────────────────────────────
section('5 · the families table');
check('RLS is enabled',
  psql(`select relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
         where n.nspname='public' and c.relname='acquisition_document_families';`).out === 't');
const fpol = psql(`select policyname||'='||array_to_string(roles,'+') from pg_policies
                    where schemaname='public' and tablename='acquisition_document_families' order by policyname;`).out;
check('exactly two policies: owner (authenticated) and service_role',
  fpol === 'acq_doc_families_owner_all=authenticated\nacq_doc_families_service_role_all=service_role', fpol.replace(/\n/g, ' | '));
check('no policy grants anon anything',
  psql(`select count(*) from pg_policies where schemaname='public' and tablename='acquisition_document_families'
         and 'anon' = any(roles);`).out === '0');
check('a family with a blank label is refused',
  refused(`insert into public.acquisition_document_families (review_id,user_id,label) values ('${RA}','${UA}','   ');`));
check('a family_kind outside the list is refused',
  refused(`insert into public.acquisition_document_families (review_id,user_id,label,family_kind)
           values ('${RA}','${UA}','X','portfolio');`));

const FA = psql(`insert into public.acquisition_document_families (review_id,user_id,label,tenant_hint)
                 values ('${RA}','${UA}','Coastal Outfitters','Coastal Outfitters') returning id;`).out.trim();
const FB = psql(`insert into public.acquisition_document_families (review_id,user_id,label)
                 values ('${RB}','${UB}','Lakeview Cafe') returning id;`).out.trim();

const famA = psql(`set local role authenticated;
                   set local request.jwt.claim.sub = '${UA}';
                   select string_agg(label, ',' order by label) from public.acquisition_document_families;`);
check('authenticated as A sees A\'s family and only A\'s', famA.out === 'Coastal Outfitters', famA.out || '(none)');
const famAnon = psql(`set local role anon;
                      select count(*) from public.acquisition_document_families;`);
check('anon sees nothing at all', famAnon.out === '0', famAnon.out);

// ── 6 · nothing may point across owners ────────────────────────────────────
section('6 · family, parent and supersession are all composite on the owner');
check('a document cannot be filed into another user\'s family',
  refused(`update public.acquisition_documents set family_id='${FB}', family_status='proposed', family_source='ai'
            where id='${newId}';`));
const docB = psql(`insert into public.acquisition_documents (review_id,user_id,file_name,intake_kind,intake_id)
                   values ('${RB}','${UB}','b-lease.pdf','lease','intake-b') returning id;`).out.trim();
check('a document cannot name another user\'s document as its parent',
  refused(`update public.acquisition_documents
             set parent_document_id='${docB}', relationship='amends', relationship_status='proposed'
           where id='${newId}';`));
check('a document cannot be superseded by another user\'s document',
  refused(`update public.acquisition_documents set superseded_by_document_id='${docB}' where id='${newId}';`));
check('but it CAN be filed into its own owner\'s family',
  psql(`update public.acquisition_documents set family_id='${FA}', family_status='proposed', family_source='ai'
         where id='${newId}';`).ok);

// ── 7 · a proposal cannot quietly become a fact ────────────────────────────
section('7 · a confirmation names who confirmed it');
check('doc_type_status = confirmed with nobody confirming is REFUSED',
  refused(`update public.acquisition_documents set doc_type='original_lease', doc_type_status='confirmed',
             doc_type_source='human', confirmed_by=null where id='${newId}';`));
check('family_status = confirmed with nobody confirming is REFUSED',
  refused(`update public.acquisition_documents set family_status='confirmed', confirmed_by=null where id='${newId}';`));
check('relationship_status = confirmed with nobody confirming is REFUSED',
  refused(`update public.acquisition_documents
             set parent_document_id=null, relationship=null, relationship_status='confirmed', confirmed_by=null
           where id='${newId}';`));
check('a model\'s reading is allowed to stand as `proposed` with no confirmer',
  psql(`update public.acquisition_documents set doc_type='amendment', doc_type_status='proposed',
          doc_type_source='ai', doc_type_confidence=0.82 where id='${newId}';`).ok);
check('and a person\'s act is allowed once it names them',
  psql(`update public.acquisition_documents set doc_type='renewal', doc_type_status='corrected',
          doc_type_source='human', confirmed_by='${UA}', confirmed_at=now() where id='${newId}';`).ok);

// ── 8 · states that would be incoherent ────────────────────────────────────
section('8 · incoherent states are refused');
// family_id is the single truth about whether a document is filed, and
// family_status is not allowed to disagree with it. Asking for a standing in
// no family is not an uncertainty to preserve — it is two columns contradicting
// each other — so the trigger settles it rather than storing the contradiction.
{
  const r = psql(`update public.acquisition_documents set family_id=null, family_status='proposed' where id='${docB}';`);
  check('a standing in no family cannot be stored — the row comes back unfiled',
    r.ok && psql(`select family_status from public.acquisition_documents where id='${docB}';`).out === 'unfiled',
    r.ok ? psql(`select family_status from public.acquisition_documents where id='${docB}';`).out : r.out.slice(0, 120));
}
check('half a relationship — a parent with no relationship — is refused',
  refused(`update public.acquisition_documents set parent_document_id='${newId}', relationship=null,
             relationship_status='proposed' where id='${newId}';`));
check('no document is its own parent',
  refused(`update public.acquisition_documents set parent_document_id=id, relationship='amends',
             relationship_status='proposed' where id='${newId}';`));
check('classification_history must be an array, not an object',
  refused(`update public.acquisition_documents set classification_history='{"a":1}'::jsonb where id='${newId}';`));
check('a confidence outside 0..1 is refused',
  refused(`update public.acquisition_documents set doc_type_confidence=1.4 where id='${newId}';`));

// ── 9 · the vocabulary ─────────────────────────────────────────────────────
section('9 · the vocabulary, including the four LeaseIntelligence tiers');
for (const t of ['original_lease', 'amendment', 'side_letter', 'estoppel']) {
  check(`doc_type '${t}' is accepted — LeaseIntelligence already tiers it`,
    psql(`update public.acquisition_documents set doc_type='${t}' where id='${newId}';`).ok);
}
for (const t of ['renewal', 'extension', 'assignment', 'guaranty', 'snda', 'psa', 'rent_roll',
                 'financial_statement', 'invoice', 'other', 'unknown']) {
  check(`doc_type '${t}' is accepted`,
    psql(`update public.acquisition_documents set doc_type='${t}' where id='${newId}';`).ok);
}
check('a doc_type outside the list is refused',
  refused(`update public.acquisition_documents set doc_type='memorandum_of_lease' where id='${newId}';`));
check('a doc_type_status outside the list is refused',
  refused(`update public.acquisition_documents set doc_type_status='probably' where id='${newId}';`));
check('a relationship outside the list is refused',
  refused(`update public.acquisition_documents set parent_document_id='${docB}', relationship='replaces',
             relationship_status='proposed' where id='${newId}';`));
check('doc_type may be set back to NULL — unclassified is an ordinary state',
  psql(`update public.acquisition_documents set doc_type=null, doc_type_status='unclassified' where id='${newId}';`).ok);

// ── 10 · deleting a family does not delete a document ──────────────────────
section('10 · a family can go without taking a source with it');
psql(`update public.acquisition_documents set family_id='${FA}', family_status='proposed', family_source='ai' where id='${newId}';`);
// Checked for real: a composite ON DELETE SET NULL with no column list would
// try to null user_id too and the delete would FAIL — leaving the document
// pointing at a family that no longer exists. A swallowed error here would
// have made the next two assertions meaningless.
const famDel = psql(`delete from public.acquisition_document_families where id='${FA}';`);
check('deleting a family succeeds — the owner column is not collateral', famDel.ok,
  famDel.ok ? '' : famDel.out.slice(0, 200));
check('the document survives its family',
  psql(`select count(*) from public.acquisition_documents where id='${newId}';`).out === '1');
check('and is honestly unfiled again, not left claiming a family it has lost',
  psql(`select family_id is null and family_status='unfiled' and family_source is null
          from public.acquisition_documents where id='${newId}';`).out === 't');

// ── 11 · deleting a review ─────────────────────────────────────────────────
section('11 · deleting a review takes its documents and families');
psql(`insert into public.acquisition_document_families (review_id,user_id,label) values ('${RB}','${UB}','Doomed');`);
psql(`delete from public.acquisition_reviews where id='${RB}';`);
check('the review\'s documents are gone',
  psql(`select count(*) from public.acquisition_documents where review_id='${RB}';`).out === '0');
check('and so are its families',
  psql(`select count(*) from public.acquisition_document_families where review_id='${RB}';`).out === '0');

// ── 12 · the rollback, both ways ───────────────────────────────────────────
section('12 · the rollback refuses to destroy a preserved source');
// Two documents still share a file name, so 023's key cannot come back.
const rb1 = psqlFile(R024);
check('the rollback runs', rb1.ok, rb1.ok ? '' : rb1.out.slice(0, 300));
check('the classification columns are gone',
  psql(`select count(*) from information_schema.columns where table_schema='public'
         and table_name='acquisition_documents'
         and column_name in ('doc_type','family_id','parent_document_id','superseded_by_document_id','classification_history');`).out === '0');
check('the families table is gone',
  psql(`select count(*) from information_schema.tables where table_schema='public'
         and table_name='acquisition_document_families';`).out === '0');
check('BOTH preserved sources are still there — neither was deleted to fit a constraint',
  psql(`select count(*) from public.acquisition_documents where file_name='coastal-lease.pdf';`).out === '2');
check('so 023\'s unique key was NOT restored, and intake_id was kept',
  psql(`select count(*) from pg_constraint where conname='acquisition_documents_review_file_key'
         and conrelid='public.acquisition_documents'::regclass;`).out === '0'
  && psql(`select count(*) from information_schema.columns where table_schema='public'
            and table_name='acquisition_documents' and column_name='intake_id';`).out === '1');

// Now remove the duplicate by hand — the operator's decision, not the
// migration's — and the rollback completes.
psql(`delete from public.acquisition_documents where file_name='coastal-lease.pdf' and intake_id='intake-second';`);
const rb2 = psqlFile(R024);
check('re-run once the duplicate is resolved, it restores 023 exactly', rb2.ok, rb2.ok ? '' : rb2.out.slice(0, 300));
check('023\'s unique (review_id, file_name) is back',
  psql(`select count(*) from pg_constraint where conname='acquisition_documents_review_file_key'
         and conrelid='public.acquisition_documents'::regclass;`).out === '1');
check('and intake_id is gone',
  psql(`select count(*) from information_schema.columns where table_schema='public'
         and table_name='acquisition_documents' and column_name='intake_id';`).out === '0');

// ── 13 · and it applies again ──────────────────────────────────────────────
section('13 · applies again after the rollback');
const again = psqlFile(M024);
check('024 applies cleanly a third time, after a full rollback', again.ok, again.ok ? '' : again.out.slice(0, 400));
check('the families table is back with its RLS',
  psql(`select relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
         where n.nspname='public' and c.relname='acquisition_document_families';`).out === 't');

console.log('\n' + '─'.repeat(64));
console.log(`RESULT: ${pass} passed, ${fail} failed`);
if (fail) { console.log('FAILED:'); failures.forEach(f => console.log('  - ' + f)); }
process.exit(fail ? 1 : 0);

})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(2); });
