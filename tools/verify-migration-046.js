'use strict';
/**
 * tools/verify-migration-046.js — run 046 (the acquisition general ledger,
 * imported by the server from the stored original) for real, against nothing
 * that matters.
 *
 *   node tools/verify-migration-046.js
 *   MS_PG_SERVER_BIN=/path/to/pg17/bin node tools/verify-migration-046.js
 *
 * It touches NO Supabase project. It builds a throwaway PostgreSQL cluster
 * with verify-migration-036.js's Pilot-shaped stand-ins, a stand-in of Supabase
 * storage (storage.objects with Pilot's live docs_owner_* rules and
 * storage_object_accessible, read 2026-10-03), the Pilot marker, and installs
 * 032–036, 044, phase0/029 and 045 from their files; then 046.
 *
 * Every import below is what api/_ledger-import.js sends: the CSV bytes are read
 * by gl-import.js (readCsvFile → parseRows → importPayload), the fingerprint is
 * the sha256 of those bytes, and import_general_ledger runs as service_role
 * naming the person. The endpoint itself is exercised against this function in
 * tools/verify-ledger-import-endpoint.js.
 *
 * WHAT IT PROVES
 *   1  046 applies (only on top of 045), applies again, moves nothing else, and
 *      keeps 045's rule: signed-in people cannot write ledger rows directly
 *   2  a 2,000-line CSV imports exactly, linked to its stored original, with an
 *      import history row and a property event — and the CAM pool untouched
 *   3  ATOMIC: every refusal (wrong person, closed review, wrong or missing
 *      object, a fingerprint or total that differs from the preview, no date
 *      order, too many lines, a bad line, an imbalance without a reason, a
 *      failure after the lines were written) leaves nothing behind
 *   4  nothing reaches the ledger, its links, archive or history except through
 *      the functions — not authenticated, not service_role
 *   5  DUPLICATES: the same file writes nothing; overlapping files add only new
 *      lines; a source-less, foreign or altered line with a matching hash
 *      refuses the import instead of making a real line be skipped
 *   6  REVERSAL: property admins only, with a reason, never after conversion;
 *      overlapping imports keep their shared lines; reversed lines are archived;
 *      a corrected re-import is accepted; history records every step
 *   7  EVIDENCE: the stored original cannot be overwritten or deleted by a
 *      signed-in person while a document points at it; an imported document is
 *      not deleted on its own
 *   8  deleting the disposable prospect removes the ledger but not its history;
 *      retention purges only what is seven years past a deleted property
 *   9  a 10,000-line import completes under Pilot's 8 s statement limit; 10,001
 *      is refused
 *  10  ROLLBACK refuses while any ledger or history exists; when empty it
 *      restores the catalog exactly and 046 applies again
 *  11  under the post-2026-10-30 default privileges the grants are as stated
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { startCluster, tally } = require('./_pg-throwaway');
const GL = require('../gl-import.js');
const { buildLedger, shuffle, toCsv } = require('./gl-fixture.js');

const ROOT = path.join(__dirname, '..');
const MIG  = path.join(ROOT, 'migrations');
const FILES = ['032_resync_property_tenants_property_bound', '033_property_lifecycle_integrity', '034_property_at_new_acquisition',
               '035_acquire_property', '036_acquisition_episode_frozen', '044_acquisition_conversion_safeguards']
  .map(n => [n.slice(0, 3), path.join(MIG, n + '.sql')]);
const M029 = path.join(MIG, 'phase0', '029_financial_tables.sql');
const M045 = path.join(MIG, '045_acquisition_member_write_rules.sql');
const M046 = path.join(MIG, '046_acquisition_general_ledger.sql');
const R046 = path.join(MIG, '046_acquisition_general_ledger_rollback.sql');
const MARKER = 'fd9c09b1-b657-4c58-9999-c3cce28e7600';

const T = tally();
const { check, section } = T;
console.log('\n══ migration 046 (acquisition general ledger) — executed against a throwaway cluster ══');
console.log('   NO Supabase project is contacted by this script.');
const pg = startCluster('046');
console.log('   server: ' + pg.serverVersion() + '  (' + pg.SERVER_BIN + ')');

const A = '11111111-1111-4111-8111-111111111111';   // owner of the deals, admin of O1
const M = '33333333-3333-4333-8333-333333333333';   // property_manager in O1 — an editor, not an admin
const D = '55555555-5555-4555-8555-555555555555';   // admin of O1 who owns nothing
const R = '44444444-4444-4444-8444-444444444444';   // read_only in O1
const S = '22222222-2222-4222-8222-222222222222';   // stranger, admin of O2
const Z = '66666666-6666-4666-8666-666666666666';   // admin of O3 (owns the marker)
const V = '77777777-7777-4777-8777-777777777777';   // property_manager in O1, revoked
const O1 = 'c1c1c1c1-0000-4000-8000-000000000001', O2 = 'c2c2c2c2-0000-4000-8000-000000000002', O3 = 'c3c3c3c3-0000-4000-8000-000000000003';
const V036 = fs.readFileSync(path.join(__dirname, 'verify-migration-036.js'), 'utf8');
const SCHEMA = (() => {
  const a = V036.indexOf('const SCHEMA = `') + 'const SCHEMA = `'.length;
  const b = V036.indexOf('`;\n\nconst q =', a);
  // eslint-disable-next-line no-new-func
  return new Function('A', 'M', 'D', 'R', 'S', 'Z', 'O1', 'O2', 'O3', 'return `' + V036.slice(a, b) + '`;')(A, M, D, R, S, Z, O1, O2, O3);
})();
// Supabase storage, as far as 046 and Pilot's storage rules touch it (live definitions, read 2026-10-03).
const STORAGE = `
  create schema if not exists storage;
  create table storage.buckets (id text primary key, name text, public boolean not null default false);
  insert into storage.buckets(id, name) values ('leases','leases'),('invoices','invoices');
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text not null,
    owner uuid, metadata jsonb, created_at timestamptz default now(), updated_at timestamptz default now(), unique (bucket_id, name));
  create function storage.foldername(name text) returns text[] language sql immutable as $f$
    select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $f$;
  alter table storage.objects enable row level security;
  grant usage on schema storage to anon, authenticated, service_role;
  grant all on storage.objects to authenticated, service_role;
  create or replace function public.storage_object_accessible(object_name text) returns boolean language sql stable security definer set search_path to '' as $f$
    select (storage.foldername(object_name))[1] = auth.uid()::text
        or exists (select 1 from public.organization_members m where m.user_id = auth.uid() and m.accepted_at is not null and m.revoked_at is null
                    and m.organization_id::text = (storage.foldername(object_name))[1]) $f$;
  create policy docs_owner_read   on storage.objects for select to authenticated using (bucket_id = any (array['leases','invoices']) and public.storage_object_accessible(name));
  create policy docs_owner_insert on storage.objects for insert to authenticated with check (bucket_id = any (array['leases','invoices']) and public.storage_object_accessible(name));
  create policy docs_owner_update on storage.objects for update to authenticated using (bucket_id = any (array['leases','invoices']) and public.storage_object_accessible(name))
    with check (bucket_id = any (array['leases','invoices']) and public.storage_object_accessible(name));
  create policy docs_owner_delete on storage.objects for delete to authenticated using (bucket_id = any (array['leases','invoices']) and public.storage_object_accessible(name));`;
const EXTRA = `
  insert into auth.users(id) values ('${V}');
  insert into public.organization_members(organization_id,user_id,role,accepted_at,revoked_at) values ('${O1}','${V}','property_manager',now(),now());
  insert into public.properties(id,user_id,name) values ('${MARKER}','${Z}','Pilot marker (stand-in)');
  create table public.lease_documents (id uuid primary key default gen_random_uuid(), property_id uuid references public.properties(id) on delete cascade);`;

let DB = 'pilotlike';
const q = (sql, db) => pg.psql(sql, db || DB);
const one = (sql, db) => q(sql, db).out;
const as = (uid, sql, db) => pg.as('authenticated', uid, sql, db || DB);
const svc = (sql, db) => pg.as('service_role', null, sql, db || DB);
const anon = (sql, db) => pg.as('anon', null, sql, db || DB);
const s = (v) => v == null ? 'null' : "'" + String(v).replace(/'/g, "''") + "'";
const lit = (v) => JSON.stringify(v).replace(/'/g, "''");
const parse = (r) => { try { return JSON.parse(r.out); } catch (_) { return { _raw: r.out }; } };
const short = (t) => String(t || '').replace(/\s+/g, ' ').replace(/.*?ERROR:\s*/, '').slice(0, 170);
const wrote = (r) => r.ok && r.out.trim() !== '';
const blocked = (r) => !r.ok || r.out.trim() === '';
const denied = (r) => !r.ok && /permission denied/i.test(r.out);
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const csvOf = (rows) => Buffer.from(toCsv(rows), 'utf8');

function build(db, model, with045) {
  let r = pg.database(db, model);
  for (const part of [SCHEMA, STORAGE, EXTRA]) if (r.ok) r = q(part, db);
  for (const [n, f] of FILES) if (r.ok) { r = pg.psqlFile(f, db); if (!r.ok) r.out = n + ': ' + r.out; }
  if (r.ok) r = pg.psqlFile(M029, db);
  if (r.ok && with045) r = pg.psqlFile(M045, db);
  return r;
}
function deal(uid, name, db) {
  const d = parse(as(uid, `select public.begin_acquisition(${s(name)}, '${lit({ totalSqFt: '1000' })}'::jsonb);`, db));
  if (!d.property_id) throw new Error('begin_acquisition: ' + JSON.stringify(d));
  return { P: d.property_id, R: d.review_id };
}
let nObj = 0;
/** Store an original the way /api/upload does (path leases/<owner>/acq_<review>_<ts>-<name>) and file its document as the owner. */
function fileOriginal(owner, dl, name, buf, db) {
  const objName = `${owner}/acq_${dl.R}_${Date.now()}${++nObj}-${name}`;
  let r = q(`insert into storage.objects(bucket_id,name,owner,metadata) values ('leases',${s(objName)},'${owner}','${lit({ size: buf.length, mimetype: 'text/csv', eTag: '"' + crypto.createHash('md5').update(buf).digest('hex') + '"' })}'::jsonb);`, db);
  if (!r.ok) throw new Error('object: ' + r.out);
  const storagePath = 'leases/' + objName;
  r = as(owner, `insert into public.acquisition_documents(review_id,user_id,file_name,intake_id,intake_kind,doc_type,doc_type_status,doc_type_source,storage_path)
                 values ('${dl.R}','${owner}',${s(name)},${s('ik-' + nObj)},'other','financial_statement','proposed','intake_kind',${s(storagePath)}) returning id;`, db);
  if (!wrote(r)) throw new Error('document: ' + r.out);
  return { id: r.out.trim(), path: storagePath, buf, P: dl.P, R: dl.R };
}
/** What api/_ledger-import.js sends to the database for this stored file. */
function serverImport(actor, doc, opts) {
  const o = opts || {};
  const buf = o.buf || doc.buf;
  const csv = GL.readCsvFile(buf);
  const parsed = GL.parseRows(csv.rows, { dateOrder: o.dateOrder, maxRows: o.maxRows || GL.IMPORT_MAX_ROWS });
  const payload = o.payload || GL.importPayload(parsed);
  const file = Object.assign({ sha256: sha(buf), bytes: buf.length, storagePath: doc.path }, o.file || {});
  const preview = Object.assign({ lines: payload.summary.lines, debitCents: payload.summary.debitCents, creditCents: payload.summary.creditCents,
                                  dateOrder: payload.summary.dateOrder, fileSha256: file.sha256 }, o.preview || {});
  const sql = ['\\pset tuples_only on', '\\pset format unaligned', 'begin;', 'set local role service_role;', o.timeout ? `set local statement_timeout = '${o.timeout}';` : '',
    `select public.import_general_ledger(${actor ? `'${actor}'::uuid` : 'null'}, '${doc.id}'::uuid, '${lit(file)}'::jsonb, '${lit(payload)}'::jsonb, '${lit(preview)}'::jsonb, ${s(o.reason)});`,
    'commit;'].join('\n');
  const t0 = Date.now();
  const r = pg.psqlText(sql, o.db || DB, 'imp');
  const ms = Date.now() - t0;
  const line = r.out.split('\n').filter(l => l.startsWith('{')).pop();
  let j = null; try { j = JSON.parse(line); } catch (_) {}
  return { ok: r.ok && !!j, out: r.out, j, ms, parsed, payload };
}
const reverse = (actor, sourceId, reason, db) => svc(`select public.reverse_general_ledger_import(${actor ? `'${actor}'::uuid` : 'null'}, '${sourceId}'::uuid, ${s(reason)});`, db);
const counts = (pid, db) => one(`select (select count(*) from public.financial_sources where property_id='${pid}')||'|'||(select count(*) from public.gl_entries where property_id='${pid}')||'|'||(select count(*) from public.gl_entry_sources where property_id='${pid}')||'|'||(select count(*) from public.ledger_import_history where property_id='${pid}')||'|'||(select count(*) from public.property_events where property_id='${pid}' and action like 'ledger%')`, db);
const ledger = (seed, pairs) => buildLedger(seed, pairs || 1000, { textDates: true });

const inventory = (db) => q(`
  select string_agg(x, E'\\n' order by x) from (
    select 'con|'||conrelid::regclass::text||'|'||conname||'|'||pg_get_constraintdef(oid) as x from pg_constraint where connamespace in ('public'::regnamespace, 'storage'::regnamespace)
    union all select 'trg|'||t.tgrelid::regclass::text||'|'||t.tgname||'|'||pg_get_triggerdef(t.oid) from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relnamespace in ('public'::regnamespace, 'storage'::regnamespace) and not t.tgisinternal
    union all select 'fn|'||p.oid::regprocedure::text||'|'||md5(pg_get_functiondef(p.oid))||'|'||coalesce(array_to_string(p.proacl,','),'') from pg_proc p where p.pronamespace='public'::regnamespace and p.prokind='f'
    union all select 'col|'||table_schema||'.'||table_name||'|'||column_name||'|'||data_type||'|'||is_nullable||'|'||coalesce(column_default,'') from information_schema.columns where table_schema in ('public','storage')
    union all select 'idx|'||schemaname||'.'||indexname||'|'||indexdef from pg_indexes where schemaname in ('public','storage')
    union all select 'pol|'||schemaname||'.'||tablename||'|'||policyname||'|'||cmd||'|'||permissive||'|'||array_to_string(roles,',')||'|'||coalesce(qual,'')||'|'||coalesce(with_check,'') from pg_policies where schemaname in ('public','storage')
    union all select 'pri|'||table_schema||'.'||table_name||'|'||grantee||'|'||string_agg(privilege_type, ',' order by privilege_type) from information_schema.role_table_grants where table_schema in ('public','storage') group by table_schema, table_name, grantee
    union all select 'rls|'||relnamespace::regnamespace::text||'.'||relname||'|'||relrowsecurity::text from pg_class where relnamespace in ('public'::regnamespace, 'storage'::regnamespace) and relkind='r'
  ) s;`, db).out.split('\n');

// ── build ────────────────────────────────────────────────────────────────────
let r = build(DB, 'legacy', true);
check('pilotlike: 036\'s stand-ins, Supabase storage with Pilot\'s live rules, the marker, 032–036, 044, phase0/029 and 045 installed from their files', r.ok, short(r.out));
if (!r.ok) T.finish();
const before = inventory(DB);

// ── 1 · apply ────────────────────────────────────────────────────────────────
section('1 · 046 applies — on top of 045 only — and moves nothing else');
r = pg.database('notpilot', 'legacy');
q(`create table public.properties (id uuid primary key);`, 'notpilot');
r = pg.psqlFile(M046, 'notpilot');
check('a database without the Pilot marker is refused', !r.ok && /REFUSING TO RUN: pilot marker property not found/.test(r.out), short(r.out));
r = build('no045', 'legacy', false);
r = r.ok ? pg.psqlFile(M046, 'no045') : r;
check('a Pilot-shaped database WITHOUT 045 is refused (members could still write ledger rows there)', !r.ok && /046 requires 045/.test(r.out), short(r.out));
r = pg.psqlFile(M046, DB);
check('046 applies', r.ok, short(r.out));
r = pg.psqlFile(M046, DB);
check('046 applies a second time without error', r.ok, short(r.out));
const after = inventory(DB);
const removed = before.filter(x => !after.includes(x));
check('nothing that existed before 046 changed or disappeared', removed.length === 0, removed.slice(0, 3).join(' ; '));
check('045 is kept: authenticated may only SELECT financial_sources and gl_entries', pg.privs('public.financial_sources', 'authenticated', DB) === 'SELECT' && pg.privs('public.gl_entries', 'authenticated', DB) === 'SELECT');
check('the new tables: authenticated and service_role may only SELECT; anon nothing; row rules on',
  ['gl_entry_sources', 'gl_entries_reversed', 'ledger_import_history'].every(tb => pg.privs('public.' + tb, 'authenticated', DB) === 'SELECT'
    && pg.privs('public.' + tb, 'service_role', DB) === 'SELECT' && pg.privs('public.' + tb, 'anon', DB) === ''
    && one(`select relrowsecurity::text from pg_class where oid='public.${tb}'::regclass;`) === 'true'));
const SIGS = ['import_general_ledger(uuid,uuid,jsonb,jsonb,jsonb,text)', 'reverse_general_ledger_import(uuid,uuid,text)', 'purge_ledger_import_history()', 'ledger_actor_may_edit(uuid,uuid)', 'ledger_actor_is_admin(uuid,uuid)'];
check('import, reversal, purge and the actor helpers: service_role only (not authenticated, anon or PUBLIC); SECURITY DEFINER, empty search_path',
  SIGS.every(f => pg.canExecute('service_role', 'public.' + f, DB) && !pg.canExecute('authenticated', 'public.' + f, DB) && !pg.canExecute('anon', 'public.' + f, DB)
    && one(`select has_function_privilege(0, 'public.${f}', 'execute');`) === 'f'
    && one(`select prosecdef::text||'|'||array_to_string(proconfig,',') from pg_proc where oid='public.${f}'::regprocedure;`) === 'true|search_path=""'));
check('storage: two RESTRICTIVE rules keep acquisition originals from being updated or deleted by signed-in people',
  one(`select string_agg(policyname||':'||cmd||':'||permissive, ',' order by policyname) from pg_policies where schemaname='storage' and policyname like 'acq_evidence%';`)
    === 'acq_evidence_no_delete:DELETE:RESTRICTIVE,acq_evidence_no_update:UPDATE:RESTRICTIVE');
check('the database\'s line ceiling is gl-import.js IMPORT_MAX_ROWS', fs.readFileSync(M046, 'utf8').includes(`c_max_lines constant integer := ${GL.IMPORT_MAX_ROWS};`));

// ── 2 · import ───────────────────────────────────────────────────────────────
section('2 · a 2,000-line CSV imports exactly, from its stored original');
const D1 = deal(A, 'ZZ Ledger One');
const L1 = ledger(20251003);
const doc1 = fileOriginal(A, D1, 'gl-2025.csv', csvOf(L1.rows));
const camBefore = one(`select md5(coalesce(data::text,'')) from public.properties where id='${D1.P}';`);
let res = serverImport(A, doc1);
check('the owner imports: 2,000 inserted, nothing already present, balanced', res.ok && res.j.inserted === 2000 && res.j.already_present === 0 && res.j.balanced === true, short(res.out));
const S1 = res.j && res.j.source_id;
check('one source, 2,000 lines, 2,000 links, one history row, one property event', counts(D1.P) === '1|2000|2000|1|1', counts(D1.P));
check('totals equal the generator\'s exact BigInt totals', one(`select sum(debit*100)::bigint||'|'||sum(credit*100)::bigint from public.gl_entries where property_id='${D1.P}';`) === `${L1.expected.debitCents}|${L1.expected.creditCents}`);
const twins = res.parsed.entries.filter(e => e.occurrence > 1).length;
check(`identical lines are kept (${twins} repeat another exactly)`, twins > 0 && one(`select count(*) - count(distinct (posted_on, account_code, debit, credit, reference, description, vendor)) from public.gl_entries where property_id='${D1.P}';`) === String(twins));
check('the source records the stored original as the server read it: path, sha256, bytes, date order, active',
  one(`select storage_path||'|'||file_sha256||'|'||file_bytes||'|'||date_order||'|'||import_status||'|'||created_by from public.financial_sources where id='${S1}';`)
    === [doc1.path, sha(doc1.buf), doc1.buf.length, 'mdy', 'active', A].join('|'));
check('the history row: import, who, document, path, sha256, bytes, date order, counts, totals',
  one(`select action||'|'||actor_uid||'|'||acquisition_document_id||'|'||storage_path||'|'||file_sha256||'|'||file_bytes||'|'||date_order||'|'||lines||'|'||inserted||'|'||already_present||'|'||debit_cents||'|'||balanced from public.ledger_import_history where source_id='${S1}';`)
    === ['import', A, doc1.id, doc1.path, sha(doc1.buf), doc1.buf.length, 'mdy', 2000, 2000, 0, L1.expected.debitCents, 'true'].join('|'));
check('EVIDENCE: a line → its import → the stored original and the sheet row (as the owner)',
  as(A, `select d.storage_path||'#'||g.source_row from public.gl_entries g join public.financial_sources f on f.id=g.source_id join public.acquisition_documents d on d.id=f.acquisition_document_id where g.property_id='${D1.P}' and g.source_row=1001;`).out === doc1.path + '#1001');
check('a read-only member sees the ledger, its links and its history (read-only means read)',
  as(R, `select (select count(*) from public.gl_entries where property_id='${D1.P}')||'|'||(select count(*) from public.gl_entry_sources where property_id='${D1.P}')||'|'||(select count(*) from public.ledger_import_history where property_id='${D1.P}');`).out === '2000|2000|1');
check('a stranger sees none of it', as(S, `select (select count(*) from public.gl_entries where property_id='${D1.P}')||'|'||(select count(*) from public.ledger_import_history where property_id='${D1.P}');`).out === '0|0');
check('the CAM pool is untouched: properties.data is byte-identical after the import', one(`select md5(coalesce(data::text,'')) from public.properties where id='${D1.P}';`) === camBefore);

// ── 3 · atomic refusals ──────────────────────────────────────────────────────
section('3 · ATOMIC — every refusal leaves nothing behind');
const D2 = deal(A, 'ZZ Ledger Refusals');
const L2 = ledger(4242);
const doc2 = fileOriginal(A, D2, 'gl-refuse.csv', csvOf(L2.rows));
const c2 = counts(D2.P);
const nothing = (label, rr, re) => check(label, !rr.ok && (!re || re.test(rr.out)) && counts(D2.P) === c2, short(rr.out) + ' · ' + counts(D2.P));
nothing('no person named → refused', serverImport(null, doc2), /signed-in person/);
nothing('a person who does not exist → refused', serverImport('99999999-9999-4999-8999-999999999999', doc2), /signed-in person/);
nothing('a read-only member → refused', serverImport(R, doc2), /may edit it/);
nothing('a stranger → refused', serverImport(S, doc2), /may edit it/);
nothing('a revoked member → refused', serverImport(V, doc2), /may edit it/);
nothing('a path that is not this document\'s → refused', serverImport(A, doc2, { file: { storagePath: doc1.path } }), /not read from this document/);
nothing('the stored original missing from storage → refused', (q(`update storage.objects set name=name||'.moved' where name='${doc2.path.slice(7)}';`), serverImport(A, doc2)), /not in storage/);
q(`update storage.objects set name=replace(name, '.moved', '') where name like '%.moved';`);
nothing('a byte count that is not the stored object\'s → refused', serverImport(A, doc2, { file: { bytes: doc2.buf.length + 1 } }), /not in storage with that size/);
nothing('a malformed fingerprint → refused', serverImport(A, doc2, { file: { sha256: 'abc' } }), /fingerprint of the stored original is missing/);
nothing('a preview of another file (fingerprints differ) → refused', serverImport(A, doc2, { preview: { fileSha256: sha(Buffer.from('another file')) } }), /previewed is not the stored original/);
nothing('a preview showing one line more → refused', serverImport(A, doc2, { preview: { lines: 2001 } }), /preview showed/);
nothing('a preview one cent off → refused', serverImport(A, doc2, { preview: { debitCents: Number(L2.expected.debitCents) + 1 } }), /preview showed/);
nothing('a preview with another date order → refused', serverImport(A, doc2, { preview: { dateOrder: 'dmy' } }), /previewed as dmy but read as mdy/);
const ok2 = GL.importPayload(GL.parseRows(GL.readCsvFile(doc2.buf).rows));   // what the server would send — computed, not imported
nothing('a payload whose summary is not its own rows\' totals → refused', serverImport(A, doc2, { payload: { rows: ok2.rows, summary: Object.assign({}, ok2.summary, { debitCents: ok2.summary.debitCents + 1 }) }, preview: { debitCents: ok2.summary.debitCents + 1 } }), /do not add up to the parse/);
nothing('no date order → refused', serverImport(A, doc2, { payload: { rows: ok2.rows, summary: Object.assign({}, ok2.summary, { dateOrder: null }) }, preview: { dateOrder: null } }), /a person must choose/);
const bad = ok2.rows.map(x => Object.assign({}, x)); bad[999].debit_cents = -5;
nothing('a negative amount on line 1,000 → refused, naming its sheet row', serverImport(A, doc2, { payload: { rows: bad, summary: ok2.summary } }), /first at sheet row 1001/);
const dup = ok2.rows.map(x => Object.assign({}, x)); dup[7].key = dup[6].key;
nothing('two lines with one key → refused', serverImport(A, doc2, { payload: { rows: dup, summary: ok2.summary } }), /repeat another line's key/);
const unbal = ledger(4242); unbal.rows.splice(5, 1);
const docU = fileOriginal(A, D2, 'gl-unbalanced.csv', csvOf(unbal.rows));
nothing('an unbalanced ledger without a reason → refused', serverImport(A, docU), /does not balance/);
nothing('…with a blank reason → refused', serverImport(A, docU, { reason: '   ' }), /does not balance/);
q(`create function public._t046_fail() returns trigger language plpgsql as $f$ begin raise exception 'T046 injected failure after the lines were written'; end $f$;
   create trigger _t046_fail before insert on public.gl_entry_sources for each row execute function public._t046_fail();`);
const late = serverImport(A, doc2);
q(`drop trigger _t046_fail on public.gl_entry_sources; drop function public._t046_fail();`);
nothing('a failure after the source, 2,000 lines, history-to-be and event-to-be → all rolled back', late, /T046 injected failure/);
const big = buildLedger(77, 5001, { textDates: true });
const docBig = fileOriginal(A, D2, 'gl-too-big.csv', csvOf(big.rows));
nothing('10,002 lines (over the 10,000 ceiling) → refused', serverImport(A, docBig, { maxRows: 20000 }), /1 to 10000 lines \(got 10002\)/);
nothing('an EDITOR giving a reason for an unbalanced ledger → refused (the owner or an organisation admin only)', serverImport(M, docU, { reason: 'editor says so' }), /owner of the property or an organisation admin imports an unbalanced ledger/);
check('…and with an unbalanced reason given, the unbalanced ledger imports and records the reason',
  (() => { const x = serverImport(A, docU, { reason: 'Seller export omits one accrual line' }); return x.ok && one(`select override_reason from public.ledger_import_history where source_id='${x.j.source_id}';`) === 'Seller export omits one accrual line'; })());

// ── 4 · the functions are the only way in ────────────────────────────────────
{
  const unbal2 = ledger(7777); unbal2.rows.splice(1, 1);
  const docU2 = fileOriginal(A, D2, 'gl-unbalanced-2.csv', csvOf(unbal2.rows));
  let xo = serverImport(D, docU2, { reason: 'Admin accepts the seller omission' });
  check('an organisation ADMIN who owns nothing imports an unbalanced ledger with a reason, and the reason is recorded under their name',
    xo.ok && one(`select override_reason||'|'||actor_uid from public.ledger_import_history where source_id='${xo.j && xo.j.source_id}';`) === `Admin accepts the seller omission|${D}`, short(xo.out));
  const docB = fileOriginal(A, D2, 'gl-balanced-editor.csv', csvOf(ledger(8888).rows));
  xo = serverImport(M, docB);
  check('an editor still imports a BALANCED ledger (no reason needed, none asked)', xo.ok && xo.j.balanced === true, short(xo.out));
  xo = serverImport(M, docB, { reason: 'a reason on a balanced ledger is harmless' });
  check('…and a reason given with a balanced ledger changes nothing (already imported, same file)', xo.ok && xo.j.already_imported === true, short(xo.out));
}

section('4 · nothing reaches the ledger except through the functions');
check('authenticated cannot insert ledger sources or lines (045, kept)', denied(as(A, `insert into public.financial_sources(property_id,kind) values ('${D1.P}','general_ledger');`))
  && denied(as(A, `insert into public.gl_entries(property_id,account_code,debit,amount,row_hash) values ('${D1.P}','1',1,1,'x');`)));
check('authenticated cannot call the import or the reversal', denied(as(A, `select public.import_general_ledger('${A}','${doc1.id}','{}','{}','{}',null);`)) && denied(as(A, `select public.reverse_general_ledger_import('${A}','${S1}','x');`)));
check('nobody but the functions writes links, the archive or history (authenticated and service_role refused)',
  [A].every(u => denied(as(u, `insert into public.ledger_import_history(action,property_id) values ('import','${D1.P}');`)))
  && denied(svc(`insert into public.ledger_import_history(action,property_id) values ('import','${D1.P}');`))
  && denied(svc(`insert into public.gl_entry_sources(gl_entry_id,source_id,property_id,source_row) select id,'${S1}',property_id,1 from public.gl_entries limit 1;`))
  && denied(svc(`delete from public.ledger_import_history;`)) && denied(svc(`update public.ledger_import_history set reason='x';`)));
let x = svc(`insert into public.financial_sources(property_id,kind,acquisition_document_id,import_status,file_sha256,file_bytes,storage_path,date_order) values ('${D1.P}','general_ledger','${doc1.id}','active','${'a'.repeat(64)}',1,'x','iso') returning id;`);
check('service_role cannot file an acquisition source directly', !x.ok && /only by import_general_ledger/.test(x.out), short(x.out));
x = svc(`insert into public.gl_entries(property_id,source_id,account_code,debit,amount,row_hash) values ('${D1.P}','${S1}','1',1,1,'direct') returning id;`);
check('service_role cannot add a line to an import directly', !x.ok && /only by its import/.test(x.out), short(x.out));
x = svc(`update public.financial_sources set file_sha256='${'b'.repeat(64)}' where id='${S1}' returning id;`);
check('service_role cannot alter an import\'s recorded fingerprint', !x.ok && /does not change/.test(x.out), short(x.out));
x = svc(`update public.financial_sources set import_status='reversed', reversed_at=now(), reversed_by='${A}', reversal_reason='x' where id='${S1}' returning id;`);
check('service_role cannot mark an import reversed outside the reversal', !x.ok && /only by reverse_general_ledger_import/.test(x.out), short(x.out));
x = svc(`update public.gl_entries set debit=debit+1 where source_id='${S1}' and source_row=2 returning id;`);
check('service_role cannot change an imported line', !x.ok && /does not change/.test(x.out), short(x.out));
x = svc(`delete from public.gl_entries where source_id='${S1}' and source_row=2 returning id;`);
check('service_role cannot delete an imported line', !x.ok && /only by reversing its import/.test(x.out), short(x.out));
x = svc(`delete from public.financial_sources where id='${S1}' returning id;`);
check('service_role cannot delete an import (it is evidence)', !x.ok && /removed only with the whole prospect/.test(x.out), short(x.out));
x = q(`update public.ledger_import_history set reason='edited' where source_id='${S1}';`);
const x2 = q(`truncate public.ledger_import_history;`);
check('even the table owner cannot edit or truncate the history (append-only)', !x.ok && /append-only/.test(x.out) && !x2.ok && /append-only/.test(x2.out), short(x.out));
check('…and the import is intact after every attempt', counts(D1.P) === '1|2000|2000|1|1');

// ── 5 · duplicates and untrusted rows ────────────────────────────────────────
section('5 · DUPLICATES — the same file adds nothing; untrusted rows refuse, never hide a line');
res = serverImport(A, doc1);
check('the same file on the same document again → already imported; nothing written', res.ok && res.j.already_imported === true && res.j.source_id === S1 && counts(D1.P) === '1|2000|2000|1|1', short(res.out));
const doc1b = fileOriginal(A, D1, 'gl-2025-again.csv', doc1.buf);
res = serverImport(A, doc1b);
check('the same bytes filed as a second document → already imported (by fingerprint); no second source', res.ok && res.j.already_imported === true && res.j.document_id === doc1.id && counts(D1.P) === '1|2000|2000|1|1', short(res.out));
const docSh = fileOriginal(A, D1, 'gl-2025-resorted.csv', csvOf([L1.rows[0], ...shuffle(L1.rows.slice(1), 11)]));
res = serverImport(A, docSh);
const S1b = res.j && res.j.source_id;
check('the same lines re-sorted (another file) → a second import, 0 inserted, 2,000 already present, each linked to it',
  res.ok && res.j.inserted === 0 && res.j.already_present === 2000 && counts(D1.P) === '2|2000|4000|2|2', short(res.out) + ' ' + counts(D1.P));
const D3 = deal(A, 'ZZ Ledger Overlap');
const q1rows = [L1.rows[0], ...L1.rows.slice(1).filter(row => GL.parseDate(row[0], 'mdy').iso < '2025-04-01')];
const docQ1 = fileOriginal(A, D3, 'gl-q1.csv', csvOf(q1rows));
const docFY = fileOriginal(A, D3, 'gl-fy.csv', doc1.buf);
res = serverImport(A, docQ1);
const SQ1 = res.j && res.j.source_id, nQ1 = res.j && res.j.inserted;
check(`a Q1 export imports its ${nQ1} lines`, res.ok && nQ1 > 0, short(res.out));
res = serverImport(A, docFY);
const SFY = res.j && res.j.source_id;
check(`then the full year: only ${2000 - nQ1} new lines; ${nQ1} already present and linked to both imports`,
  res.ok && res.j.inserted === 2000 - nQ1 && res.j.already_present === nQ1
  && one(`select count(*) from public.gl_entries g where g.property_id='${D3.P}' and (select count(*) from public.gl_entry_sources l where l.gl_entry_id=g.id)=2;`) === String(nQ1), short(res.out));
// Untrusted rows with a matching hash — planted by service_role (members no longer can).
const D4 = deal(A, 'ZZ Ledger Untrusted');
const L4 = ledger(9090);
const p4 = GL.importPayload(GL.parseRows(GL.readCsvFile(csvOf(L4.rows)).rows));
const h0 = sha(Buffer.from(p4.rows[0].key, 'utf8')), r0 = p4.rows[0];
svc(`insert into public.gl_entries(property_id,posted_on,account_code,account_name,description,vendor,reference,debit,credit,amount,row_hash)
     values ('${D4.P}','${r0.posted_on}',${s(r0.account_code)},${s(r0.account_name)},${s(r0.description)},${s(r0.vendor)},${s(r0.reference)},${r0.debit_cents ? r0.debit_cents / 100 : 'null'},${r0.credit_cents ? r0.credit_cents / 100 : 'null'},${(r0.debit_cents - r0.credit_cents) / 100},'${h0}');`);
const doc4 = fileOriginal(A, D4, 'gl-untrusted.csv', csvOf(L4.rows));
const c4 = counts(D4.P);
res = serverImport(A, doc4);
check('a source-less line — even with identical content — refuses the import; it does not stand in for the real line',
  !res.ok && /no active import holds/.test(res.out) && counts(D4.P) === c4, short(res.out));
svc(`update public.gl_entries set debit=999999, amount=999999 where row_hash='${h0}' and property_id='${D4.P}';`);
res = serverImport(A, doc4);
check('…and with altered amounts it is refused the same way (first sheet row named)', !res.ok && /first at sheet row 2\)/.test(res.out) && counts(D4.P) === c4, short(res.out));
svc(`delete from public.gl_entries where row_hash='${h0}' and property_id='${D4.P}';`);
const ld = one(`insert into public.lease_documents(property_id) values ('${D4.P}') returning id;`);
const s029 = svc(`insert into public.financial_sources(property_id,kind,document_id) values ('${D4.P}','general_ledger','${ld}') returning id;`).out.trim();
svc(`insert into public.gl_entries(property_id,source_id,posted_on,account_code,debit,amount,row_hash) values ('${D4.P}','${s029}','${r0.posted_on}',${s(r0.account_code)},1,1,'${h0}');`);
res = serverImport(A, doc4);
check('a line filed the 029 way (not by an acquisition import) with a matching hash also refuses it', !res.ok && /no active import holds/.test(res.out), short(res.out));
svc(`delete from public.gl_entries where row_hash='${h0}' and property_id='${D4.P}';`);
res = serverImport(A, doc4);
check('with the untrusted row gone, the import goes through in full', res.ok && res.j.inserted === 2000, short(res.out));
const docOther = fileOriginal(A, D4, 'gl-other.csv', csvOf(ledger(1).rows));
x = serverImport(A, { id: doc4.id, path: doc4.path, buf: docOther.buf }, { file: { bytes: doc4.buf.length } });
check('another file read against an imported document → refused (its stored original differs)', !x.ok && /previewed is not the stored original|already has an active import of a different file|not in storage/.test(x.out), short(x.out));
const amb = Buffer.from('Date,Account Number,Debit,Credit\r\n3/4/2025,5100,10.00,\r\n3/4/2025,1010,,10.00\r\n', 'utf8');
const docAmb = fileOriginal(A, D4, 'gl-ambiguous.csv', amb);
check('an ambiguous file cannot be read without a choice (the server refuses before calling the database)', GL.parseRows(GL.readCsvFile(amb).rows).needsDateOrder === true);
res = serverImport(A, docAmb, { dateOrder: 'mdy' });
check('read month-first by a person\'s choice, it imports, recording mdy', res.ok && one(`select date_order from public.financial_sources where id='${res.j.source_id}';`) === 'mdy', short(res.out));
x = serverImport(A, docAmb, { dateOrder: 'dmy' });
check('the same file read day-first is refused while the month-first import stands', !x.ok && /already imported with its dates read as mdy/.test(x.out), short(x.out));

// ── 6 · reversal ─────────────────────────────────────────────────────────────
section('6 · REVERSAL — admins, a reason, never after conversion; shared lines kept');
x = reverse(M, SQ1, 'wrong file');
check('an editor who is not an admin cannot reverse', !x.ok && /owner of the property or an organisation admin/.test(x.out), short(x.out));
check('a read-only member and a stranger cannot reverse', !reverse(R, SQ1, 'x').ok && !reverse(S, SQ1, 'x').ok);
check('a reversal without a reason is refused', /needs a reason/.test(reverse(A, SQ1, '  ').out));
x = reverse(A, SQ1, 'Q1 export superseded by the full year');
check('the owner reverses the Q1 import: no line removed — every Q1 line is still held by the full-year import',
  x.ok && parse(x).lines_removed === 0 && parse(x).lines_kept === nQ1 && parse(x).lines_handed_over === nQ1, short(x.out));
check('…the shared lines now name the full-year import as their source; 2,000 lines, all linked to it',
  one(`select count(*) from public.gl_entries where property_id='${D3.P}' and source_id='${SFY}';`) === '2000'
  && one(`select count(*) from public.gl_entry_sources where source_id='${SQ1}';`) === '0');
check('…the Q1 import is kept, marked reversed with who, when and why', one(`select import_status||'|'||reversed_by||'|'||reversal_reason from public.financial_sources where id='${SQ1}';`) === `reversed|${A}|Q1 export superseded by the full year`);
check('reversing it again is refused', /already reversed/.test(reverse(A, SQ1, 'again').out));
x = reverse(D, SFY, 'Seller sent a corrected export');
check('an organisation admin (not the owner) reverses the full-year import: all 2,000 lines archived and removed',
  x.ok && parse(x).lines_removed === 2000 && one(`select count(*) from public.gl_entries where property_id='${D3.P}';`) === '0'
  && one(`select count(*) from public.gl_entries_reversed where reversed_source='${SFY}';`) === '2000', short(x.out));
check('history: import, import, reverse, reverse — in order, each with its person and reason',
  one(`select string_agg(action||':'||actor_uid||':'||coalesce(reason,''), ',' order by occurred_at, action desc) from public.ledger_import_history where property_id='${D3.P}';`)
    === `import:${A}:,import:${A}:,reverse:${A}:Q1 export superseded by the full year,reverse:${D}:Seller sent a corrected export`);
res = serverImport(A, docFY);
check('the corrected re-import of the same document is accepted after its reversal', res.ok && res.j.inserted === 2000 && counts(D3.P).startsWith('3|2000|2000|5'), short(res.out) + ' ' + counts(D3.P));
// Reverse the newer of two overlapping imports: its own lines go, the shared ones stay with the older.
const D5 = deal(A, 'ZZ Ledger Reverse Newer');
const d5q = fileOriginal(A, D5, 'q1.csv', csvOf(q1rows)), d5f = fileOriginal(A, D5, 'fy.csv', doc1.buf);
const i5q = serverImport(A, d5q).j, i5f = serverImport(A, d5f).j;
x = reverse(A, i5f.source_id, 'Full year belongs to another deal');
check(`reversing the newer full-year import removes only its ${2000 - nQ1} own lines; the ${nQ1} Q1 lines stay with Q1`,
  x.ok && parse(x).lines_removed === 2000 - nQ1 && parse(x).lines_kept === nQ1 && parse(x).lines_handed_over === 0
  && one(`select count(*)||'|'||count(*) filter (where source_id='${i5q.source_id}') from public.gl_entries where property_id='${D5.P}';`) === `${nQ1}|${nQ1}`, short(x.out));
// Conversion freezes the ledger.
const C = deal(A, 'ZZ Ledger Converted');
const fam = one(`select gen_random_uuid();`);
as(A, `insert into public.acquisition_document_families(id,review_id,user_id,label) values ('${fam}','${C.R}','${A}','Tenant') returning id;`);
as(A, `insert into public.acquisition_documents(review_id,user_id,file_name,intake_id,family_id,family_status,doc_type,doc_type_status,doc_type_source,confirmed_by,confirmed_at)
       values ('${C.R}','${A}','lease.pdf','ik-lease','${fam}','confirmed','original_lease','confirmed','human','${A}',now()) returning id;`);
const dC = fileOriginal(A, C, 'gl.csv', csvOf(ledger(31337).rows));
const iC = serverImport(A, dC).j;
x = as(A, `select public.acquire_property('${C.P}'::uuid, '${C.R}'::uuid, '${lit({ roster: [{ id: fam, family_id: fam, property_id: C.P, review_id: C.R, tenant_name: 'Tenant', leased_sqft: '500' }], propertyName: 'ZZ Ledger Converted', occupancyAtAcquisition: 100, waltAtAcquisition: 0 })}'::jsonb);`);
check('(the acquisition is converted by acquire_property, its ledger already imported)', x.ok && one(`select status from public.acquisition_reviews where id='${C.R}';`) === 'converted', short(x.out));
x = reverse(A, iC.source_id, 'too late');
check('a converted acquisition\'s import is not reversed — it is frozen', !x.ok && /is converted; its ledger is frozen/.test(x.out), short(x.out));
x = serverImport(A, dC);
check('…and a converted acquisition takes no import (checked before anything else)', !x.ok && /is converted; a ledger is imported only into an open acquisition/.test(x.out), short(x.out));
check('…nor a new document to import from (036\'s freeze)', !as(A, `insert into public.acquisition_documents(review_id,user_id,file_name,intake_id) values ('${C.R}','${A}','late.csv','ik-late') returning id;`).ok);

// ── 7 · evidence in storage ──────────────────────────────────────────────────
section('7 · EVIDENCE — the stored original is not overwritten or deleted');
const objName = doc1.path.slice('leases/'.length);
x = as(A, `update storage.objects set metadata = metadata || '{"size":1}'::jsonb, updated_at = now() where bucket_id='leases' and name='${objName}' returning id;`);
check('the uploader cannot overwrite the original an import was read from (storage update refused)', blocked(x), short(x.out));
x = as(A, `update storage.objects set name = name || '-moved' where bucket_id='leases' and name='${objName}' returning id;`);
check('…nor move it', blocked(x));
x = as(A, `delete from storage.objects where bucket_id='leases' and name='${objName}' returning id;`);
check('…nor delete it', blocked(x) && one(`select count(*) from storage.objects where name='${objName}';`) === '1');
q(`insert into storage.objects(bucket_id,name,owner,metadata) values ('leases','${A}/scratch.csv','${A}','{"size":3}');`);
check('an object no acquisition document points at stays the uploader\'s to replace or delete',
  wrote(as(A, `update storage.objects set metadata='{"size":4}' where name='${A}/scratch.csv' returning id;`)) && wrote(as(A, `delete from storage.objects where name='${A}/scratch.csv' returning id;`)));
x = as(A, `delete from public.acquisition_documents where id='${doc1.id}' returning id;`);
check('an imported document cannot be deleted on its own (its import is evidence)', !x.ok && /removed only with the whole prospect/.test(x.out), short(x.out));
x = as(A, `delete from public.acquisition_documents where id='${docFY.id}' returning id;`);
check('…nor one whose import was reversed (the reversal is evidence too)', !x.ok, short(x.out));

// ── 7b · evidence integrity and the maintenance run ──────────────────────────
section('7b · EVIDENCE INTEGRITY — a stored original that no longer matches its import is put on the record');
const S1R = one(`select id from public.financial_sources where acquisition_document_id='${doc1.id}' and import_status='active';`);
check('the import recorded storage\'s ETag of the original beside its own sha256 and size',
  one(`select file_etag from public.financial_sources where id='${S1R}';`) === '"' + crypto.createHash('md5').update(doc1.buf).digest('hex') + '"');
const integ = () => parse(svc(`select public.check_ledger_evidence_integrity();`));
const mismatches = (sid) => one(`select count(*) from public.ledger_import_history where source_id='${sid}' and action='evidence_mismatch';`);
let ig = integ();
check(`with every original as it was imported, the check flags nothing (${ig.checked} imports checked)`, ig.checked > 0 && ig.flagged === 0 && ig.newly_recorded === 0 && mismatches(S1R) === '0', JSON.stringify(ig));
// The service key can do this; Storage's rules do not bind it. Done here as the superuser.
q(`update storage.objects set metadata = metadata || '{"size":"5"}'::jsonb where name='${objName}';`);
ig = integ();
check('an original replaced by a file of another size is flagged, and a history row records what was expected and what was found',
  ig.flagged === 1 && ig.newly_recorded === 1 && mismatches(S1R) === '1'
  && one(`select detail->>'problem' from public.ledger_import_history where source_id='${S1R}' and action='evidence_mismatch';`) === 'size'
  && one(`select (detail->'expected'->>'bytes')||'|'||(detail->'found'->>'bytes') from public.ledger_import_history where source_id='${S1R}' and action='evidence_mismatch';`) === `${doc1.buf.length}|5`, JSON.stringify(ig));
ig = integ();
check('running the check again records the same finding only once', ig.flagged === 1 && ig.newly_recorded === 0 && mismatches(S1R) === '1');
q(`update storage.objects set metadata = metadata || '${lit({ size: doc1.buf.length, eTag: '"deadbeef"' })}'::jsonb where name='${objName}';`);
ig = integ();
check('an original replaced by a file of the SAME size but another ETag is flagged (etag)', ig.flagged === 1 && ig.newly_recorded === 1 && mismatches(S1R) === '2'
  && one(`select detail->>'problem' from public.ledger_import_history where source_id='${S1R}' and action='evidence_mismatch' order by occurred_at desc limit 1;`) === 'etag');
q(`set session_replication_role = replica; delete from storage.objects where name='${objName}';`);
ig = integ();
check('an original that is gone is flagged (missing)', ig.flagged === 1 && ig.newly_recorded === 1 && mismatches(S1R) === '3'
  && one(`select detail->>'problem' from public.ledger_import_history where source_id='${S1R}' and action='evidence_mismatch' order by occurred_at desc limit 1;`) === 'missing');
q(`insert into storage.objects(bucket_id,name,owner,metadata) values ('leases','${objName}','${A}','${lit({ size: doc1.buf.length, mimetype: 'text/csv', eTag: '"' + crypto.createHash('md5').update(doc1.buf).digest('hex') + '"' })}'::jsonb);`);
ig = integ();
check('with the original back as it was, the check flags nothing new (the three findings stay on the record)', ig.flagged === 0 && ig.newly_recorded === 0 && mismatches(S1R) === '3');
check('the findings are append-only like every history row', denied(svc(`delete from public.ledger_import_history where action='evidence_mismatch';`)) && denied(svc(`update public.ledger_import_history set detail='{}' where action='evidence_mismatch';`)));
check('only service_role runs the check or the maintenance', denied(as(A, `select public.check_ledger_evidence_integrity();`)) && denied(as(A, `select public.run_ledger_maintenance();`)) && denied(anon(`select public.run_ledger_maintenance();`)));
x = parse(svc(`select public.run_ledger_maintenance();`));
check('run_ledger_maintenance purges, checks and records the run', x.purged === 0 && x.integrity && x.integrity.flagged === 0
  && one(`select purged||'|'||(integrity->>'checked') from public.ledger_maintenance_runs where id='${x.run_id}';`) === `0|${x.integrity.checked}`, JSON.stringify(x));
check('members cannot read the maintenance log (nothing is granted); the server can', denied(as(A, `select count(*) from public.ledger_maintenance_runs;`)) && svc(`select count(*) from public.ledger_maintenance_runs;`).out === '1'
  && pg.privs('public.ledger_maintenance_runs', 'authenticated', DB) === '' && pg.privs('public.ledger_maintenance_runs', 'anon', DB) === '' && pg.privs('public.ledger_maintenance_runs', 'service_role', DB) === 'INSERT,SELECT');
check('the two functions: service_role only, SECURITY DEFINER, empty search_path', ['check_ledger_evidence_integrity()', 'run_ledger_maintenance()'].every(f =>
  pg.canExecute('service_role', 'public.' + f, DB) && !pg.canExecute('authenticated', 'public.' + f, DB) && !pg.canExecute('anon', 'public.' + f, DB)
  && one(`select prosecdef::text||'|'||array_to_string(proconfig,',') from pg_proc where oid='public.${f}'::regprocedure;`) === 'true|search_path=""'));

// ── 7c · the durable per-person import ceiling ───────────────────────────────
section('7c · RATE — one person imports at most 30 ledgers a minute, counted from the history itself');
const DR = deal(A, 'ZZ Rate Deal');
const small = (seed) => csvOf(ledger(seed, 3).rows);
const dHave = Number(one(`select count(*) from public.ledger_import_history where actor_uid='${D}' and action='import' and occurred_at > now() - interval '1 minute';`));   // the admin override above counts
let okRate = 0, lastRate = null;
for (let i = 1; i <= 31; i++) { lastRate = serverImport(D, fileOriginal(A, DR, `r${i}.csv`, small(60000 + i)), { dateOrder: 'mdy' }); if (lastRate.ok) okRate++; else break; }   // a 3-pair ledger may have only ambiguous dates; the order is chosen
check(`the admin's imports in a minute go through up to the 30th (${dHave} already on the record); the next is refused with 53400 and a sentence a person can act on`,
  okRate === 30 - dHave && !lastRate.ok && /53400|configuration_limit_exceeded|in the last minute/.test(lastRate.out) && /imported 30 ledgers in the last minute/.test(lastRate.out), okRate + ' · ' + short(lastRate.out));
check('…the refusal wrote no history row and no source', one(`select count(*) from public.ledger_import_history where actor_uid='${D}' and action='import' and occurred_at > now() - interval '1 minute';`) === '30'
  && one(`select count(*) from public.financial_sources where property_id='${DR.P}';`) === String(30 - dHave));
x = serverImport(A, fileOriginal(A, DR, 'by-owner.csv', small(60999)), { dateOrder: 'mdy' });
check('the ceiling is per person: the owner still imports into the same property', x.ok, short(x.out));
check('(guard for this verifier: the owner has made fewer than 30 imports in the last minute, so no earlier check hit the ceiling by accident)',
  Number(one(`select count(*) from public.ledger_import_history where actor_uid='${A}' and action='import' and occurred_at > now() - interval '1 minute';`)) < 30);

// ── 8 · prospect deletion and retention ──────────────────────────────────────
section('8 · DISPOSABLE PROSPECT — the ledger goes, the history stays; retention');
const X = deal(A, 'ZZ Ledger Disposable');
const dX = fileOriginal(A, X, 'gl.csv', csvOf(ledger(5150).rows));
const iX = serverImport(A, dX).j;
reverse(A, iX.source_id, 'Imported into the wrong deal');
serverImport(A, dX);
x = as(A, `select public.delete_prospect_acquisition('${X.R}'::uuid);`);
check('the owner deletes the disposable prospect with delete_prospect_acquisition', x.ok, short(x.out));
check('…its review, documents, imports, lines, links and archived lines are gone',
  one(`select (select count(*) from public.acquisition_reviews where id='${X.R}')||'|'||(select count(*) from public.financial_sources where property_id='${X.P}')||'|'||(select count(*) from public.gl_entries where property_id='${X.P}')||'|'||(select count(*) from public.gl_entry_sources where property_id='${X.P}')||'|'||(select count(*) from public.gl_entries_reversed where property_id='${X.P}')||'|'||(select count(*) from public.properties where id='${X.P}');`) === '0|0|0|0|0|0');
check('…its history stays: import, reverse, import, and one removal per import naming who deleted it',
  one(`select string_agg(action, ',' order by occurred_at, action) from public.ledger_import_history where property_id='${X.P}';`) === 'import,reverse,import,evidence_removed,evidence_removed'
  && one(`select count(*) from public.ledger_import_history where property_id='${X.P}' and action='evidence_removed' and actor_uid='${A}';`) === '2');
check('…readable by the server, no longer by members (the property is gone)', as(A, `select count(*) from public.ledger_import_history where property_id='${X.P}';`).out === '0'
  && svc(`select count(*) from public.ledger_import_history where property_id='${X.P}';`).out === '5');
check('purging now removes nothing: no history is seven years past', svc(`select public.purge_ledger_import_history();`).out === '0');
const GONE8 = 'a8a8a8a8-0000-4000-8000-000000000008', GONE6 = 'a6a6a6a6-0000-4000-8000-000000000006';
q(`insert into public.ledger_import_history(action,occurred_at,property_id,reason) values ('import', now() - interval '8 years', '${GONE8}', 'aged'),('evidence_removed', now() - interval '7 years 1 day', '${GONE8}', 'aged'),
   ('import', now() - interval '8 years', '${GONE6}', 'aged'),('evidence_removed', now() - interval '6 years', '${GONE6}', 'aged'),
   ('import', now() - interval '9 years', '${D1.P}', 'aged but the property exists'),
   ('import', now() - interval '9 years', '${MARKER}', 'aged, and all this property has — but it exists');`);
x = svc(`select public.purge_ledger_import_history();`);
check('the purge removes only a deleted property\'s history more than seven years past its last event',
  x.out === '2' && one(`select count(*) from public.ledger_import_history where property_id='${GONE8}';`) === '0'
  && one(`select count(*) from public.ledger_import_history where property_id='${GONE6}';`) === '2'
  && one(`select count(*) from public.ledger_import_history where property_id='${D1.P}' and reason like 'aged%';`) === '1'
  && one(`select count(*) from public.ledger_import_history where property_id='${MARKER}';`) === '1', x.out);
check('…a property that still exists keeps its history however old it is', one(`select count(*) from public.ledger_import_history where property_id='${MARKER}';`) === '1');
check('only service_role may purge', denied(as(A, `select public.purge_ledger_import_history();`)));

// ── 9 · size and time ────────────────────────────────────────────────────────
section('9 · SIZE AND TIME — 10,000 lines under Pilot\'s 8 s statement limit');
const D9 = deal(A, 'ZZ Ledger Ten Thousand');
const L9 = buildLedger(4096, 5000, { textDates: true });
const d9 = fileOriginal(A, D9, 'gl-10k.csv', csvOf(L9.rows));
check(`the 10,000-line CSV is ${d9.buf.length} bytes, under the ${GL.MAX_FILE_BYTES}-byte upload limit`, d9.buf.length < GL.MAX_FILE_BYTES);
res = serverImport(A, d9, { timeout: '8s' });
check(`10,000 lines import with statement_timeout = 8s (as PostgREST runs on Pilot): ${res.ms} ms here`, res.ok && res.j.inserted === 10000, short(res.out));
console.log(`     measured: 10,000 lines in ${res.ms} ms (server ${pg.serverVersion()}); 2,000 lines took ${serverImport(A, fileOriginal(A, deal(A, 'ZZ t2k'), 'g.csv', csvOf(ledger(1234).rows))).ms} ms`);

// ── 10 · rollback ────────────────────────────────────────────────────────────
section('10 · ROLLBACK — refuses while anything is recorded; exact when empty');
r = pg.psqlFile(R046, DB);
check('the rollback refuses while ledgers, reversed lines and history exist, and counts them', !r.ok && /REFUSING ROLLBACK: \d+ ledger source\(s\), \d+ ledger line\(s\), \d+ reversed line\(s\) and \d+ history row\(s\)/.test(r.out), short(r.out));
check('…and changed nothing', inventory(DB).join('\n') === after.join('\n'));
// Empty everything the only ways this throwaway database can: the evidence rows as superuser with triggers off,
// the history through the purge mark (as if its retention had passed).
q(`set session_replication_role = replica;
   delete from public.gl_entry_sources; delete from public.gl_entries_reversed; delete from public.gl_entries where posted_on is not null;
   delete from public.financial_sources where acquisition_document_id is not null;`);
r = pg.psqlFile(R046, DB);
check('with only history left (no ledger, no line), the rollback still refuses — it never discards the audit trail',
  !r.ok && /0 ledger source\(s\), 0 ledger line\(s\), 0 reversed line\(s\) and [1-9]\d* history row\(s\)/.test(r.out), short(r.out));
q(`select set_config('mainstreet.ledger_history_purge','on',false); delete from public.ledger_import_history;`);
r = pg.psqlFile(R046, DB);
check('with nothing recorded, the rollback runs', r.ok, short(r.out));
const rolled = inventory(DB);
check('the catalog is EXACTLY what it was before 046 — 045\'s grants included', rolled.join('\n') === before.join('\n'),
  'missing: ' + before.filter(y => !rolled.includes(y)).slice(0, 2).join(' ; ') + ' | extra: ' + rolled.filter(y => !before.includes(y)).slice(0, 2).join(' ; '));
check('…and signed-in people still cannot insert ledger rows (the rollback restores nothing of 029)', pg.privs('public.gl_entries', 'authenticated', DB) === 'SELECT');
r = pg.psqlFile(R046, DB);
check('the rollback runs a second time harmlessly', r.ok, short(r.out));
r = pg.psqlFile(M046, DB);
check('046 applies again, to the same catalog', r.ok && inventory(DB).join('\n') === after.join('\n'), short(r.out));
// The rollback carries the same Pilot marker guard as 046 itself, and it fires first:
// on a database that has 046 but no marker, nothing is counted or dropped.
r = build('rbnomark', 'legacy', true);
r = r.ok ? pg.psqlFile(M046, 'rbnomark') : r;
q(`delete from public.properties where id='${MARKER}';`, 'rbnomark');
const invNoMark = inventory('rbnomark');
r = pg.psqlFile(R046, 'rbnomark');
check('the rollback refuses a database without the Pilot marker, before it drops anything',
  !r.ok && /REFUSING TO RUN: pilot marker property not found/.test(r.out) && inventory('rbnomark').join('\n') === invNoMark.join('\n'), short(r.out));

// ── 11 · post-2026-10-30 defaults ────────────────────────────────────────────
section('11 · under Supabase\'s post-2026-10-30 default privileges');
DB = 'post1030';
r = build(DB, 'legacy', true);
pg.setModel(DB, 'post-2026-10-30');
r = r.ok ? pg.psqlFile(M046, DB) : r;
check('046 applies after the switch', r.ok, short(r.out));
check('service_role executes the import and reversal; authenticated SELECTs the new tables — and nothing more is granted',
  pg.canExecute('service_role', 'public.import_general_ledger(uuid,uuid,jsonb,jsonb,jsonb,text)', DB) && !pg.canExecute('authenticated', 'public.import_general_ledger(uuid,uuid,jsonb,jsonb,jsonb,text)', DB)
  && pg.privs('public.ledger_import_history', 'authenticated', DB) === 'SELECT' && pg.privs('public.gl_entry_sources', 'anon', DB) === '');
const P11 = deal(A, 'ZZ Post');
res = serverImport(A, fileOriginal(A, P11, 'g.csv', csvOf(ledger(11).rows)));
check('…and an import works with only those grants', res.ok && res.j.inserted === 2000, short(res.out));

T.finish();
