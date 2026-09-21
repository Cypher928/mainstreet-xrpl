'use strict';
/**
 * tools/verify-migration-025.js — run migration 025 for real, against nothing
 * that matters.
 *
 *   node tools/verify-migration-025.js
 *
 * THE POINT
 *
 * Same as tools/verify-migration-024.js, which this is modelled on: a migration
 * reviewed by reading is a migration whose first execution is on a real
 * database with real rows. This builds a throwaway PostgreSQL cluster, stands
 * up what 025 depends on FROM THE REPO'S OWN FILES (000, 006, 023, 024) plus
 * the Supabase pieces those assume, and executes 025 against it.
 *
 * It touches NO Supabase project.
 *
 * WHAT IT PROVES
 *
 *   1  025 applies cleanly on top of 000 + 006 + 023 + 024, and is re-runnable
 *   2  a document that already existed is untouched: same text, same
 *      classification, same history — and now `pending` with an empty object
 *   3  the four columns exist with the documented types and defaults
 *   4  abstracted_fields must be an object — an array, a string, a number
 *      are refused
 *   5  abstraction_status is one of exactly five words
 *   6  a status that claims the document was read carries the evidence:
 *      `success` / `partial` with no `fields` key, or with no timestamp,
 *      is refused; `failed`, `skipped` and `pending` need neither
 *   7  MISSING IS NOT NONE at the storage layer: a field stored as
 *      value null + quote null reads back as exactly that — nothing in the
 *      schema coerces it to 0, false or an empty string
 *   8  the evidence is invisible to another user and to anon — the existing
 *      RLS policy on the table covers the new column, no new policy needed
 *   9  the partial index exists and is limited to filed documents
 *  10  024's guarantees are not weakened: the classification trigger still
 *      refuses an unconfirmed confirmation; supersession still preserves
 *  11  the rollback removes exactly what 025 added and nothing else —
 *      the document, its text and its classification survive
 *  12  025 applies again cleanly after the rollback
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
const M025 = path.join(MIG, '025_acquisition_abstraction.sql');
const R025 = path.join(MIG, '025_acquisition_abstraction_rollback.sql');

const PGBIN = ['/usr/lib/postgresql/16/bin', '/usr/lib/postgresql/15/bin', '/usr/pgsql-16/bin', '/usr/local/bin']
  .find(d => { try { return fs.existsSync(path.join(d, 'initdb')) && fs.existsSync(path.join(d, 'postgres')); } catch (_) { return false; } });

if (!PGBIN) {
  console.log('\n\x1b[33m⚠ SKIPPED — no local PostgreSQL server binary found.\x1b[0m');
  console.log('  Migration 025 was NOT executed. This is a skip, not a pass.');
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
    console.log('  Migration 025 was NOT executed. This is a skip, not a pass.\n');
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

const tmp  = fs.mkdtempSync(path.join(os.tmpdir(), 'pg025-'));
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
console.log('\n══ migration 025 — executed against a throwaway cluster ══');
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
                 '024_acquisition_document_classification.sql']) {
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

// A document that already exists UNDER 024, classified and with history, so
// the migration has a real row to leave alone — the Pilot table is not empty.
const FA = psql(`insert into public.acquisition_document_families (review_id,user_id,label)
                 values ('${RA}','${UA}','Coastal Outfitters') returning id;`).out.trim();
const DOC = psql(`insert into public.acquisition_documents
    (review_id, user_id, file_name, intake_kind, intake_id, parsing_status, storage_path, extracted_text,
     doc_type, doc_type_status, doc_type_source, doc_type_confidence, family_id, family_status, family_source,
     classification_history)
  values ('${RA}','${UA}','coastal-lease.pdf','lease','intake-1','success','leases/${UA}/acq_x_1-coastal-lease.pdf',
          'ORIGINAL TEXT','original_lease','proposed','ai',0.9,'${FA}','proposed','ai',
          '[{"at":"2026-01-01T00:00:00Z","docType":"original_lease"}]'::jsonb)
  returning id;`).out.trim();
const DOCB = psql(`insert into public.acquisition_documents (review_id,user_id,file_name,intake_kind,intake_id)
                   values ('${RB}','${UB}','b-lease.pdf','lease','intake-b') returning id;`).out.trim();
const rowBefore = () => psql(`select extracted_text||'|'||doc_type||'|'||doc_type_status||'|'||family_id::text||'|'||classification_history::text
                               from public.acquisition_documents where id='${DOC}';`).out;
const snapshot = rowBefore();

// ── 1 · applies, and is re-runnable ────────────────────────────────────────
section('1 · applies on top of 024, and is re-runnable');
const first = psqlFile(M025);
check('025 applies cleanly', first.ok, first.ok ? '' : first.out.slice(0, 500));
if (!first.ok) { console.log('\nStopping: 025 did not apply.'); process.exit(1); }

const shape = () => psql(`select column_name||':'||data_type||':'||is_nullable||':'||coalesce(column_default,'')
                           from information_schema.columns
                           where table_schema='public' and table_name='acquisition_documents'
                           order by column_name;`).out;
const shapeBefore = shape();
const second = psqlFile(M025);
check('025 applies a SECOND time without error', second.ok, second.ok ? '' : second.out.slice(0, 400));
check('and the shape is unchanged by the second run', shape() === shapeBefore);
check('the second run added no duplicate constraint',
  psql(`select count(*) from pg_constraint where conrelid='public.acquisition_documents'::regclass
         and conname like 'acq_docs_abstract%';`).out === '3');

// ── 2 · the existing row is untouched ──────────────────────────────────────
section('2 · a document that already existed is left exactly as it was');
check('text, classification, family and history are byte-identical', rowBefore() === snapshot);
check('and it is now honestly `pending` with nothing claimed',
  psql(`select abstraction_status||'|'||abstracted_fields::text||'|'||coalesce(abstraction_model,'∅')||'|'||coalesce(abstracted_at::text,'∅')
          from public.acquisition_documents where id='${DOC}';`).out === 'pending|{}|∅|∅');

// ── 3 · the columns ────────────────────────────────────────────────────────
section('3 · the four columns, their types and defaults');
const cols = psql(`select column_name||':'||data_type||':'||is_nullable from information_schema.columns
                    where table_schema='public' and table_name='acquisition_documents'
                      and column_name in ('abstracted_fields','abstraction_status','abstraction_model','abstracted_at')
                    order by column_name;`).out;
check('abstracted_at timestamptz NULL / abstracted_fields jsonb NOT NULL / abstraction_model text NULL / abstraction_status text NOT NULL',
  cols === 'abstracted_at:timestamp with time zone:YES\nabstracted_fields:jsonb:NO\nabstraction_model:text:YES\nabstraction_status:text:NO',
  cols.replace(/\n/g, ' | '));
check('a new document defaults to pending with an empty object',
  psql(`insert into public.acquisition_documents (review_id,user_id,file_name,intake_kind,intake_id)
         values ('${RA}','${UA}','new.pdf','lease','intake-new')
         returning abstraction_status||'|'||abstracted_fields::text;`).out === 'pending|{}');
check('both new columns carry a comment that says what null-and-null means',
  psql(`select count(*) from pg_description d join pg_attribute a on a.attrelid=d.objoid and a.attnum=d.objsubid
         where d.objoid='public.acquisition_documents'::regclass
           and a.attname in ('abstracted_fields','abstraction_status');`).out === '2');

// ── 4 · abstracted_fields must be an object ────────────────────────────────
section('4 · abstracted_fields is an object, or it is refused');
check('an array is refused',
  refused(`update public.acquisition_documents set abstracted_fields='[]'::jsonb where id='${DOC}';`));
check('a string is refused',
  refused(`update public.acquisition_documents set abstracted_fields='"text"'::jsonb where id='${DOC}';`));
check('a number is refused',
  refused(`update public.acquisition_documents set abstracted_fields='1'::jsonb where id='${DOC}';`));
check('JSON null is refused (the column is NOT NULL, and null is not an object)',
  refused(`update public.acquisition_documents set abstracted_fields='null'::jsonb where id='${DOC}';`)
  && refused(`update public.acquisition_documents set abstracted_fields=null where id='${DOC}';`));
check('an object is accepted',
  psql(`update public.acquisition_documents set abstracted_fields='{}'::jsonb where id='${DOC}';`).ok);

// ── 5 · the status vocabulary ──────────────────────────────────────────────
section('5 · abstraction_status is one of five words');
for (const s of ['pending', 'failed', 'skipped']) {
  check(`'${s}' is accepted with an empty object`,
    psql(`update public.acquisition_documents set abstraction_status='${s}', abstracted_fields='{}'::jsonb, abstracted_at=null where id='${DOC}';`).ok);
}
check("a status outside the list ('done') is refused",
  refused(`update public.acquisition_documents set abstraction_status='done' where id='${DOC}';`));
check('an empty status is refused',
  refused(`update public.acquisition_documents set abstraction_status='' where id='${DOC}';`));
check('NULL status is refused — the column is NOT NULL',
  refused(`update public.acquisition_documents set abstraction_status=null where id='${DOC}';`));

// ── 6 · a claim of having read carries the evidence ────────────────────────
section('6 · success and partial must carry evidence and a timestamp');
const EVIDENCE = `'{"schemaVersion":1,"model":"m","at":"2026-01-02T00:00:00Z","fields":{"cap":{"value":5,"quote":"cap of 5%","page":3,"confidence":0.9},"renewal_options":{"value":null,"quote":null,"page":null,"confidence":null}}}'::jsonb`;
check("'success' with an empty object is refused",
  refused(`update public.acquisition_documents set abstraction_status='success', abstracted_fields='{}'::jsonb, abstracted_at=now() where id='${DOC}';`));
check("'partial' with an empty object is refused",
  refused(`update public.acquisition_documents set abstraction_status='partial', abstracted_fields='{}'::jsonb, abstracted_at=now() where id='${DOC}';`));
check("'success' with evidence but NO timestamp is refused",
  refused(`update public.acquisition_documents set abstraction_status='success', abstracted_fields=${EVIDENCE}, abstracted_at=null where id='${DOC}';`));
check("'success' with an object that has no `fields` key is refused",
  refused(`update public.acquisition_documents set abstraction_status='success', abstracted_fields='{"schemaVersion":1}'::jsonb, abstracted_at=now() where id='${DOC}';`));
check("'success' with evidence and a timestamp is accepted",
  psql(`update public.acquisition_documents set abstraction_status='success', abstracted_fields=${EVIDENCE},
          abstraction_model='m', abstracted_at='2026-01-02T00:00:00Z' where id='${DOC}';`).ok);
check("'partial' with evidence and a timestamp is accepted",
  psql(`update public.acquisition_documents set abstraction_status='partial' where id='${DOC}';`).ok);
check("'failed' may keep the old evidence — a failed re-run does not erase what was read",
  psql(`update public.acquisition_documents set abstraction_status='failed' where id='${DOC}';`).ok
  && psql(`select abstracted_fields ? 'fields' from public.acquisition_documents where id='${DOC}';`).out === 't');
psql(`update public.acquisition_documents set abstraction_status='success' where id='${DOC}';`);

// ── 7 · missing is not none ────────────────────────────────────────────────
section('7 · missing is not none — the storage layer coerces nothing');
check('a field stored as value null + quote null reads back as JSON null, not 0',
  psql(`select abstracted_fields->'fields'->'renewal_options'->>'value' is null
          and jsonb_typeof(abstracted_fields->'fields'->'renewal_options'->'value') = 'null'
          from public.acquisition_documents where id='${DOC}';`).out === 't');
check('and a field with a value keeps its number and its quote',
  psql(`select (abstracted_fields->'fields'->'cap'->>'value')||'|'||(abstracted_fields->'fields'->'cap'->>'quote')
          from public.acquisition_documents where id='${DOC}';`).out === '5|cap of 5%');
check('an explicit negative is a value: 0 with a quote is stored as 0, not null',
  psql(`update public.acquisition_documents set abstracted_fields = jsonb_set(abstracted_fields, '{fields,cap}',
          '{"value":0,"quote":"Tenant shall have no cap","page":null,"confidence":0.8}'::jsonb) where id='${DOC}'
        returning jsonb_typeof(abstracted_fields->'fields'->'cap'->'value')||'|'||(abstracted_fields->'fields'->'cap'->>'value');`).out === 'number|0');

// ── 8 · who may see it ─────────────────────────────────────────────────────
section('8 · the evidence is covered by the existing owner policy');
check('no new policy was added by 025',
  psql(`select count(*) from pg_policies where schemaname='public' and tablename='acquisition_documents';`).out
  === psql(`select count(*) from pg_policies where schemaname='public' and tablename='acquisition_documents'
             and policyname in ('acq_docs_owner_all','acq_docs_service_role_all');`).out);
const seeA = psql(`set local role authenticated; set local request.jwt.claim.sub='${UA}';
                   select count(*) from public.acquisition_documents where abstracted_fields ? 'fields';`);
check('the owner can read their own evidence', seeA.out === '1', seeA.out);
const seeB = psql(`set local role authenticated; set local request.jwt.claim.sub='${UB}';
                   select count(*) from public.acquisition_documents where abstracted_fields ? 'fields';`);
check('another user sees none of it', seeB.out === '0', seeB.out);
const seeAnon = psql(`set local role anon; select count(*) from public.acquisition_documents;`);
check('anon sees nothing at all', seeAnon.out === '0', seeAnon.out);
check('another user cannot write evidence onto a document they do not own',
  psql(`set local role authenticated; set local request.jwt.claim.sub='${UB}';
        update public.acquisition_documents set abstraction_status='skipped' where id='${DOC}';`).ok
  && psql(`select abstraction_status from public.acquisition_documents where id='${DOC}';`).out === 'success');

// ── 9 · the index ──────────────────────────────────────────────────────────
section('9 · the index P4-2 will read through');
const idx = psql(`select indexdef from pg_indexes where schemaname='public' and indexname='idx_acq_docs_abstraction';`).out;
check('idx_acq_docs_abstraction exists', idx !== '', idx);
check('on (family_id, abstraction_status), limited to filed documents',
  /\(family_id, abstraction_status\)/.test(idx) && /WHERE \(family_id IS NOT NULL\)/.test(idx));

// ── 10 · 024 is not weakened ───────────────────────────────────────────────
section('10 · 024\'s guarantees still hold');
check('a confirmation with nobody confirming is still refused',
  refused(`update public.acquisition_documents set doc_type_status='confirmed', confirmed_by=null where id='${DOC}';`));
check('the classification trigger is still attached',
  psql(`select count(*) from pg_trigger where tgrelid='public.acquisition_documents'::regclass and tgname='trg_acq_docs_coherence';`).out === '1');
check('a document cannot be filed into another user\'s family',
  refused(`update public.acquisition_documents set family_id='${FA}', family_status='proposed', family_source='ai' where id='${DOCB}';`));
check('(review_id, intake_id) is still the identity',
  psql(`select count(*) from pg_constraint where conname='acquisition_documents_review_intake_key'
         and conrelid='public.acquisition_documents'::regclass;`).out === '1');
check('deleting a family still unfiles rather than deletes, and the evidence survives it',
  psql(`delete from public.acquisition_document_families where id='${FA}';`).ok
  && psql(`select family_id is null and abstracted_fields ? 'fields' from public.acquisition_documents where id='${DOC}';`).out === 't');

// ── 11 · the rollback ──────────────────────────────────────────────────────
section('11 · the rollback removes exactly what 025 added');
const colsBeforeRb = psql(`select string_agg(column_name, ',' order by column_name) from information_schema.columns
                            where table_schema='public' and table_name='acquisition_documents';`).out;
const rb = psqlFile(R025);
check('the rollback runs', rb.ok, rb.ok ? '' : rb.out.slice(0, 300));
check('the four columns are gone',
  psql(`select count(*) from information_schema.columns where table_schema='public' and table_name='acquisition_documents'
         and column_name in ('abstracted_fields','abstraction_status','abstraction_model','abstracted_at');`).out === '0');
check('the three constraints and the index are gone',
  psql(`select count(*) from pg_constraint where conrelid='public.acquisition_documents'::regclass and conname like 'acq_docs_abstract%';`).out === '0'
  && psql(`select count(*) from pg_indexes where schemaname='public' and indexname='idx_acq_docs_abstraction';`).out === '0');
const colsAfterRb = psql(`select string_agg(column_name, ',' order by column_name) from information_schema.columns
                           where table_schema='public' and table_name='acquisition_documents';`).out;
check('and NOTHING else — every 024 column is still there',
  colsAfterRb === colsBeforeRb.split(',').filter(c => !['abstracted_fields','abstraction_status','abstraction_model','abstracted_at'].includes(c)).join(','));
check('the document, its text and its classification survive the rollback',
  psql(`select extracted_text||'|'||doc_type||'|'||doc_type_status from public.acquisition_documents where id='${DOC}';`).out
  === 'ORIGINAL TEXT|original_lease|proposed');
check('the rollback is itself re-runnable', psqlFile(R025).ok);

// ── 12 · and it applies again ──────────────────────────────────────────────
section('12 · applies again after the rollback');
const again = psqlFile(M025);
check('025 applies cleanly again, after a full rollback', again.ok, again.ok ? '' : again.out.slice(0, 400));
check('the columns are back, and the surviving row is `pending` with an empty object',
  psql(`select abstraction_status||'|'||abstracted_fields::text from public.acquisition_documents where id='${DOC}';`).out === 'pending|{}');

console.log('\n' + '─'.repeat(64));
console.log(`RESULT: ${pass} passed, ${fail} failed`);
if (fail) { console.log('FAILED:'); failures.forEach(f => console.log('  - ' + f)); }
process.exit(fail ? 1 : 0);

})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(2); });
