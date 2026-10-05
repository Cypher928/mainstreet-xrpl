'use strict';
/**
 * tools/verify-migration-047.js — run 047 (the lease document register and the
 * organisation storage folders follow 045's rule; the latent grants on the
 * organisation tables go) for real, against nothing that matters.
 *
 *   node tools/verify-migration-047.js
 *   MS_PG_SERVER_BIN=/path/to/pg17/bin node tools/verify-migration-047.js
 *
 * It touches NO Supabase project. It builds a throwaway PostgreSQL cluster
 * (PostgreSQL 16 by default; MS_PG_SERVER_BIN runs the same checks on another
 * server build, e.g. 17.6 as on Pilot), stands up verify-migration-036.js's
 * Pilot-shaped stand-ins, verify-migration-046.js's Supabase storage stand-in
 * (Pilot's live storage rules), phase0/024's rules on organization_members,
 * organizations and lease_documents as that file wrote them, the Pilot marker,
 * and installs 032–036, 044, phase0/029, 045 and 046 from their files.
 *
 * WHAT IT PROVES
 *   0  BEFORE 047 every gap is real: a read-only member adds, renames and
 *      deletes lease_documents rows and puts, overwrites and deletes files in
 *      the organisation's storage folder; anon and authenticated hold every
 *      privilege on the three tables
 *   1  047 applies, applies again, refuses a database without the Pilot marker
 *      or without 045, and changes only what it says it changes
 *   2  lease_documents: every member (read-only, revoked-before, unaccepted…)
 *      reads exactly what they read; only the owner and editors write; the
 *      server (service_role, as api/lease-documents.js) writes as before
 *   3  storage: a read-only member still opens the organisation's files but
 *      cannot put, overwrite or delete them; their own folder stays theirs;
 *      editors and the owner write the organisation's folder; 046's rules on
 *      acquisition originals still hold against editors
 *   4  grants, exactly: anon nothing; authenticated SELECT on the organisation
 *      tables and SELECT/INSERT/UPDATE/DELETE on lease_documents; service_role
 *      unchanged; a member still reads their own membership
 *   5  the workflows around them: a brand-new user's first property (and the
 *      organisation made for them), begin_acquisition, an editor's save, a
 *      property deletion cascading into the register
 *   6  ROLLBACK restores the catalog exactly and the old behaviour returns;
 *      047 applies again to the same catalog
 *   7  under Supabase's post-2026-10-30 default privileges the same grants result
 *
 * SKIPS (exit 0) when no local PostgreSQL server binary is present, and says so
 * loudly — a skip is not a pass and must not read like one.
 */
const fs = require('fs');
const path = require('path');
const { startCluster, tally } = require('./_pg-throwaway');

const ROOT = path.join(__dirname, '..');
const MIG  = path.join(ROOT, 'migrations');
const FILES = ['032_resync_property_tenants_property_bound', '033_property_lifecycle_integrity', '034_property_at_new_acquisition',
               '035_acquire_property', '036_acquisition_episode_frozen', '044_acquisition_conversion_safeguards']
  .map(n => [n.slice(0, 3), path.join(MIG, n + '.sql')]);
const M029 = path.join(MIG, 'phase0', '029_financial_tables.sql');
const M045 = path.join(MIG, '045_acquisition_member_write_rules.sql');
const M046 = path.join(MIG, '046_acquisition_general_ledger.sql');
const M047 = path.join(MIG, '047_member_write_rules_remaining.sql');
const R047 = path.join(MIG, '047_member_write_rules_remaining_rollback.sql');
const MARKER = 'fd9c09b1-b657-4c58-9999-c3cce28e7600';

const T = tally();
const { check, section } = T;

console.log('\n══ migration 047 (member write rules — the register, the storage folders, the grants) — executed against a throwaway cluster ══');
console.log('   NO Supabase project is contacted by this script.');
const pg = startCluster('047');
console.log('   server: ' + pg.serverVersion() + '  (' + pg.SERVER_BIN + ')');

// ── people (verify-migration-036.js's, plus a revoked and an unaccepted member)
const A = '11111111-1111-4111-8111-111111111111';   // owner of the deals, admin of O1
const M = '33333333-3333-4333-8333-333333333333';   // property_manager in O1 — an editor
const D = '55555555-5555-4555-8555-555555555555';   // admin of O1 who owns nothing
const R = '44444444-4444-4444-8444-444444444444';   // read_only in O1
const S = '22222222-2222-4222-8222-222222222222';   // stranger, admin of O2
const Z = '66666666-6666-4666-8666-666666666666';   // admin of O3 (owns the marker)
const V = '77777777-7777-4777-8777-777777777777';   // property_manager in O1, revoked
const U = '88888888-8888-4888-8888-888888888888';   // property_manager in O1, never accepted
const N = '99999999-9999-4999-8999-999999999999';   // a brand-new user: no organisation at all
const O1 = 'c1c1c1c1-0000-4000-8000-000000000001', O2 = 'c2c2c2c2-0000-4000-8000-000000000002', O3 = 'c3c3c3c3-0000-4000-8000-000000000003';

const V036 = fs.readFileSync(path.join(__dirname, 'verify-migration-036.js'), 'utf8');
const SCHEMA = (() => {
  const a = V036.indexOf('const SCHEMA = `') + 'const SCHEMA = `'.length;
  const b = V036.indexOf('`;\n\nconst q =', a);
  if (a < 20 || b < a) throw new Error('could not read SCHEMA from verify-migration-036.js');
  // eslint-disable-next-line no-new-func
  return new Function('A', 'M', 'D', 'R', 'S', 'Z', 'O1', 'O2', 'O3', 'return `' + V036.slice(a, b) + '`;')(A, M, D, R, S, Z, O1, O2, O3);
})();
// Supabase storage as Pilot has it (verify-migration-046.js's stand-in: the live rules, read in Phase 0).
const V046 = fs.readFileSync(path.join(__dirname, 'verify-migration-046.js'), 'utf8');
const STORAGE = (() => {
  const a = V046.indexOf('const STORAGE = `'), b = V046.indexOf('`;\n', a);
  // eslint-disable-next-line no-new-func
  return new Function('A', 'V', 'O1', 'MARKER', 'Z', V046.slice(a, b + 2) + ' return STORAGE;')(A, V, O1, MARKER, Z);
})();
// What phase0/024 put on Pilot for the three tables 047 touches (the stand-in schema has none of it),
// plus the register's shape as 004/024/039 left it.
const EXTRA = `
  insert into auth.users(id) values ('${V}'),('${U}'),('${N}');
  insert into public.organization_members(organization_id,user_id,role,accepted_at,revoked_at) values
    ('${O1}','${V}','property_manager',now(),now()),('${O1}','${U}','property_manager',null,null);
  insert into public.properties(id,user_id,name) values ('${MARKER}','${Z}','Pilot marker (stand-in)');
  create table public.lease_documents (
    id uuid primary key default gen_random_uuid(),
    property_id uuid not null references public.properties(id) on delete cascade,
    tenant_id uuid, tenant_name text, file_name text not null, file_url text, parsing_status text not null default 'pending',
    created_at timestamptz not null default now(), updated_at timestamptz not null default now());
  alter table public.lease_documents enable row level security;
  create policy "lease_docs_owner_all" on public.lease_documents for all to authenticated
    using (property_id in (select public.member_property_ids())) with check (property_id in (select public.member_property_ids()));
  create policy "lease_docs_service_role_all" on public.lease_documents for all to service_role using (true) with check (true);
  alter table public.organization_members enable row level security;
  alter table public.organizations enable row level security;
  create policy organizations_member_select on public.organizations for select to authenticated using (public.is_active_member_of_org(id));
  create policy organizations_service_role_all on public.organizations for all to service_role using (true) with check (true);
  create policy organization_members_self_select on public.organization_members for select to authenticated using (user_id = auth.uid());
  create policy organization_members_org_select on public.organization_members for select to authenticated using (public.is_active_member_of_org(organization_id));
  create policy organization_members_service_role_all on public.organization_members for all to service_role using (true) with check (true);`;

let DB = 'pilotlike';
const q = (sql, db) => pg.psql(sql, db || DB);
const one = (sql, db) => q(sql, db).out;
const as = (uid, sql, db) => pg.as('authenticated', uid, sql, db || DB);
const svc = (sql, db) => pg.as('service_role', null, sql, db || DB);
const anon = (sql, db) => pg.as('anon', null, sql, db || DB);
const s = (v) => v == null ? 'null' : "'" + String(v).replace(/'/g, "''") + "'";
const lit = (v) => JSON.stringify(v).replace(/'/g, "''");
const parse = (r) => { try { return JSON.parse(r.out); } catch (_) { return { _raw: r.out }; } };
const short = (t) => String(t || '').replace(/\s+/g, ' ').replace(/.*?ERROR:\s*/, '').slice(0, 150);
/** A write landed: no error, and RETURNING gave a row. */
const wrote   = (r) => r.ok && r.out.trim() !== '';
/** A write did not land: refused outright, or the row rules matched nothing. */
const blocked = (r) => !r.ok || r.out.trim() === '';
const denied  = (r) => !r.ok && /permission denied/i.test(r.out);
const ALL = 'DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE';

function build(db, model, with045, with046) {
  let r = pg.database(db, model);
  for (const part of [SCHEMA, STORAGE, EXTRA]) if (r.ok) r = q(part, db);
  for (const [n, f] of FILES) if (r.ok) { r = pg.psqlFile(f, db); if (!r.ok) r.out = n + ': ' + r.out; }
  if (r.ok) r = pg.psqlFile(M029, db);
  if (r.ok && with045) r = pg.psqlFile(M045, db);
  if (r.ok && with046) r = pg.psqlFile(M046, db);
  return r;
}
function deal(uid, name, db) {
  const d = parse(as(uid, `select public.begin_acquisition(${s(name)}, '${lit({ totalSqFt: '1000' })}'::jsonb);`, db));
  if (!d.property_id) throw new Error('begin_acquisition: ' + JSON.stringify(d));
  return { P: d.property_id, R: d.review_id };
}
const ownProperty = (uid, name, db) => { const r = as(uid, `insert into public.properties(user_id,name) values ('${uid}',${s(name)}) returning id;`, db); if (!wrote(r)) throw new Error('property: ' + r.out); return r.out.trim(); };
/** A register row, written as api/lease-documents.js writes it (service_role). */
const registerRow = (pid, name, db) => { const r = svc(`insert into public.lease_documents(property_id,file_name) values ('${pid}',${s(name)}) returning id;`, db); if (!wrote(r)) throw new Error('register: ' + r.out); return r.out.trim(); };
/** A stored object, as api/upload.js (service key) stores it. */
const object = (name, owner, db) => { const r = q(`insert into storage.objects(bucket_id,name,owner,metadata) values ('leases',${s(name)},'${owner}','{"size":10}'::jsonb) returning id;`, db); if (!wrote(r)) throw new Error('object: ' + r.out); return r.out.trim(); };
const objExists = (name, db) => one(`select count(*) from storage.objects where name=${s(name)};`, db) === '1';
/**
 * An INSERT by a signed-in person, WITHOUT RETURNING: with RETURNING the new row
 * must also pass the SELECT rule, which would hide a write rule that is too
 * wide behind a read rule that is right. The write rule is judged on its own:
 * did the row land?
 */
const landedObj = (uid, bucket, name, db) => { as(uid, `insert into storage.objects(bucket_id,name,owner) values (${s(bucket)},${s(name)},'${uid}');`, db); const yes = objExists(name, db); if (yes) q(`delete from storage.objects where name=${s(name)};`, db); return yes; };
const landedRow = (uid, pid, name, db) => { as(uid, `insert into public.lease_documents(property_id,file_name) values ('${pid}',${s(name)});`, db); const yes = one(`select count(*) from public.lease_documents where file_name=${s(name)};`, db) === '1'; if (yes) q(`delete from public.lease_documents where file_name=${s(name)};`, db); return yes; };

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
let r = build(DB, 'legacy', true, true);
check('pilotlike: 036\'s stand-ins, Pilot\'s storage rules, 024\'s rules on the three tables, the marker, 032–036, 044, phase0/029, 045 and 046 installed from their files', r.ok, short(r.out));
if (!r.ok) T.finish();
check('the stand-in matches what the probe of 2026-10-04 found: anon and authenticated hold EVERY privilege on organization_members, organizations and lease_documents',
  ['organization_members', 'organizations', 'lease_documents'].every(t => pg.privs('public.' + t, 'anon', DB) === ALL && pg.privs('public.' + t, 'authenticated', DB) === ALL));

// A property of A's in O1, with a register row and an object in the organisation's folder and one in A's own.
const W = deal(A, 'ZZ Working Deal');
const LD = registerRow(W.P, 'lease.pdf');
const ORG_OBJ = `${O1}/shared-lease.pdf`, OWN_OBJ = `${A}/mine.pdf`;
object(ORG_OBJ, A); object(OWN_OBJ, A);

// ── 0 · the gaps ─────────────────────────────────────────────────────────────
section('0 · BEFORE 047 — every gap is real');
check('a read-only member adds a row to the lease document register', wrote(as(R, `insert into public.lease_documents(property_id,file_name) values ('${W.P}','planted.pdf') returning id;`)));
check('…renames one', wrote(as(R, `update public.lease_documents set file_name='renamed.pdf' where id='${LD}' returning id;`)));
check('…and deletes one', wrote(as(R, `delete from public.lease_documents where file_name='planted.pdf' returning id;`)));
check('a read-only member puts a file in the organisation\'s storage folder', wrote(as(R, `insert into storage.objects(bucket_id,name,owner) values ('leases','${O1}/planted.pdf','${R}') returning id;`)));
check('…overwrites one', wrote(as(R, `update storage.objects set metadata='{"size":1}' where name='${ORG_OBJ}' returning id;`)));
check('…and deletes one', wrote(as(R, `delete from storage.objects where name='${O1}/planted.pdf' returning id;`)));
check('anon can TRUNCATE the register (the grant is there; only the absence of a request protects it)', /TRUNCATE/.test(pg.privs('public.lease_documents', 'anon', DB)));
q(`update public.lease_documents set file_name='lease.pdf' where id='${LD}'; update storage.objects set metadata='{"size":10}' where name='${ORG_OBJ}';`);
const before = inventory(DB);
const rowCounts = () => one(`select (select count(*) from public.lease_documents)||'|'||(select count(*) from public.organization_members)||'|'||(select count(*) from public.organizations)||'|'||(select count(*) from storage.objects)||'|'||(select md5(string_agg(file_name||property_id::text, ',' order by id)) from public.lease_documents);`);
const rowsBefore = rowCounts();

// ── 1 · apply ────────────────────────────────────────────────────────────────
section('1 · 047 applies, applies again, and changes only what it says');
r = build('nomarker', 'legacy', true, true);
q(`delete from public.properties where id='${MARKER}';`, 'nomarker');
r = pg.psqlFile(M047, 'nomarker');
check('a database without the Pilot marker is refused before anything changes', !r.ok && /REFUSING TO RUN: pilot marker property not found/.test(r.out)
  && one(`select count(*) from pg_policies where policyname='lease_docs_owner_all';`, 'nomarker') === '1', short(r.out));
r = build('no045', 'legacy', false, false);
r = pg.psqlFile(M047, 'no045');
check('a Pilot-shaped database WITHOUT 045 is refused (047 builds on its helpers)', !r.ok && /047 requires 045/.test(r.out), short(r.out));
r = pg.psqlFile(M047, DB);
check('047 applies', r.ok, short(r.out));
r = pg.psqlFile(M047, DB);
check('047 applies a second time without error', r.ok, short(r.out));
const after = inventory(DB);
const removed = before.filter(x => !after.includes(x));
const added = after.filter(x => !before.includes(x));
const REPLACED = /^pol\|public\.lease_documents\|lease_docs_owner_all\||^pol\|storage\.objects\|docs_owner_(insert|update|delete)\||^pri\|public\.(organization_members|organizations|lease_documents)\|(anon|authenticated)\|/;
check(`only the policy, the three storage rules and the grants 047 replaces are gone (${removed.length})`, removed.length === 10 && removed.every(x => REPLACED.test(x)), removed.filter(x => !REPLACED.test(x)).slice(0, 3).join(' ; ') || removed.length);
const OWN = /^pol\|public\.lease_documents\|lease_docs_(member_select|editor_insert|editor_update|editor_delete)\||^pol\|storage\.objects\|docs_owner_(insert|update|delete)\|.*storage_object_writable|^fn\|(public\.)?storage_object_writable\(text\)\||^pri\|public\.(organization_members|organizations)\|authenticated\|SELECT$|^pri\|public\.lease_documents\|authenticated\|DELETE,INSERT,SELECT,UPDATE$/;
check(`everything added is 047's own (${added.length})`, added.length === 11 && added.every(x => OWN.test(x)), added.filter(x => !OWN.test(x)).slice(0, 3).join(' ; ') || added.length);
check('no row changed: the register, memberships, organisations and stored objects are as they were', rowCounts() === rowsBefore);
check('docs_owner_read is untouched (members still open what they opened)', after.filter(x => /^pol\|storage\.objects\|docs_owner_read\|/.test(x)).join() === before.filter(x => /^pol\|storage\.objects\|docs_owner_read\|/.test(x)).join());
const ACL = one(`select proacl::text from pg_proc where oid='public.storage_object_writable(text)'::regprocedure;`);
const FNP = one(`select prosecdef::text||'|'||provolatile::text||'|'||coalesce(array_to_string(proconfig,','),'') from pg_proc where oid='public.storage_object_writable(text)'::regprocedure;`);
check('storage_object_writable: SECURITY DEFINER, empty search_path, VOLATILE; authenticated and service_role may execute',
  FNP === 'true|v|search_path=""' && pg.canExecute('authenticated', 'public.storage_object_writable(text)', DB) && pg.canExecute('service_role', 'public.storage_object_writable(text)', DB),
  FNP + ' · auth=' + pg.canExecute('authenticated', 'public.storage_object_writable(text)', DB) + ' svc=' + pg.canExecute('service_role', 'public.storage_object_writable(text)', DB));
check('…anon and PUBLIC may not (an ACL exists and names no PUBLIC grant)', !pg.canExecute('anon', 'public.storage_object_writable(text)', DB) && ACL !== '' && !/(^\{|,)=X\//.test(ACL), ACL);

// ── 2 · lease_documents ─────────────────────────────────────────────────────
section('2 · the lease document register: members read, editors write, the server writes as before');
const seesLD = (uid) => as(uid, `select count(*) from public.lease_documents where property_id='${W.P}';`).out.trim();
check('the owner, an editor, an organisation admin and a read-only member all still read the register', [A, M, D, R].every(u => seesLD(u) === '1'));
check('a revoked member, an unaccepted member and a stranger read nothing', [V, U, S].every(u => seesLD(u) === '0'));
check('anon is refused outright', denied(anon(`select count(*) from public.lease_documents;`)));
const ldDigest = () => one(`select md5(coalesce(string_agg(id||file_name||coalesce(tenant_name,''), ',' order by id),'')) from public.lease_documents;`);
const d0 = ldDigest();
check('a read-only member cannot add a row', blocked(as(R, `insert into public.lease_documents(property_id,file_name) values ('${W.P}','planted.pdf') returning id;`)));
check('…nor rename or re-point one', blocked(as(R, `update public.lease_documents set file_name='x.pdf', tenant_name='x' where id='${LD}' returning id;`))
  && blocked(as(R, `update public.lease_documents set file_name='x.pdf' returning id;`)));
check('…nor delete one (filtered or not)', blocked(as(R, `delete from public.lease_documents where id='${LD}' returning id;`)) && blocked(as(R, `delete from public.lease_documents returning id;`)));
check('a revoked member, an unaccepted member and a stranger cannot write it either (inserts judged without RETURNING)',
  [V, U, S].every(u => !landedRow(u, W.P, 'p-' + u.slice(0, 2) + '.pdf')
    && blocked(as(u, `update public.lease_documents set file_name='x' returning id;`)) && blocked(as(u, `delete from public.lease_documents returning id;`))));
check('a read-only member cannot add a row even without RETURNING', !landedRow(R, W.P, 'p-ro.pdf'));
check('anon cannot write it (refused outright)', denied(anon(`insert into public.lease_documents(property_id,file_name) values ('${W.P}','p.pdf');`)) && denied(anon(`delete from public.lease_documents;`)));
check('…and none of that changed a row', ldDigest() === d0);
check('an editor adds, renames and deletes a row', wrote(as(M, `insert into public.lease_documents(property_id,file_name) values ('${W.P}','by-editor.pdf') returning id;`))
  && wrote(as(M, `update public.lease_documents set tenant_name='Editor Co' where file_name='by-editor.pdf' returning id;`))
  && wrote(as(M, `delete from public.lease_documents where file_name='by-editor.pdf' returning id;`)));
check('the owner adds, renames and deletes a row', wrote(as(A, `insert into public.lease_documents(property_id,file_name) values ('${W.P}','by-owner.pdf') returning id;`))
  && wrote(as(A, `update public.lease_documents set tenant_name='Owner Co' where file_name='by-owner.pdf' returning id;`))
  && wrote(as(A, `delete from public.lease_documents where file_name='by-owner.pdf' returning id;`)));
check('an organisation admin who owns nothing writes it too (admins are editors)', wrote(as(D, `update public.lease_documents set tenant_name='Admin saw it' where id='${LD}' returning id;`)));
check('the server (service_role — api/lease-documents.js, ask-lease, validate-lease) reads and writes as before',
  wrote(svc(`insert into public.lease_documents(property_id,file_name) values ('${W.P}','by-server.pdf') returning id;`))
  && svc(`select count(*) from public.lease_documents where property_id='${W.P}';`).out.trim() === '2'
  && wrote(svc(`update public.lease_documents set parsing_status='success' where file_name='by-server.pdf' returning id;`))
  && wrote(svc(`delete from public.lease_documents where file_name='by-server.pdf' returning id;`)));
check('an editor cannot file a register row against a property outside their organisation', blocked(as(M, `insert into public.lease_documents(property_id,file_name) values ('${MARKER}','x.pdf') returning id;`)));

// ── 3 · storage ─────────────────────────────────────────────────────────────
section('3 · storage: read-only members open the organisation\'s files but do not write its folder');
const objCount = () => one(`select count(*) from storage.objects;`);
const o0 = objCount();
check('a read-only member still opens an object in the organisation\'s folder (docs_owner_read unchanged)', as(R, `select count(*) from storage.objects where name='${ORG_OBJ}';`).out.trim() === '1');
check('…but cannot put a file there (judged without RETURNING, so the read rule cannot mask the write rule)', !landedObj(R, 'leases', `${O1}/planted.pdf`) && !landedObj(R, 'invoices', `${O1}/planted.pdf`));
check('…nor overwrite one', blocked(as(R, `update storage.objects set metadata='{"size":1}' where name='${ORG_OBJ}' returning id;`)) && one(`select metadata->>'size' from storage.objects where name='${ORG_OBJ}';`) === '10');
check('…nor move one', blocked(as(R, `update storage.objects set name='${O1}/moved.pdf' where name='${ORG_OBJ}' returning id;`)) && objExists(ORG_OBJ));
check('…nor delete one', blocked(as(R, `delete from storage.objects where name='${ORG_OBJ}' returning id;`)) && objExists(ORG_OBJ));
check('…nor touch the owner\'s own folder', blocked(as(R, `delete from storage.objects where name='${OWN_OBJ}' returning id;`)) && objExists(OWN_OBJ));
check('their own folder is still theirs: put, overwrite, delete', wrote(as(R, `insert into storage.objects(bucket_id,name,owner) values ('leases','${R}/own.pdf','${R}') returning id;`))
  && wrote(as(R, `update storage.objects set metadata='{"size":2}' where name='${R}/own.pdf' returning id;`))
  && wrote(as(R, `delete from storage.objects where name='${R}/own.pdf' returning id;`)));
check('a revoked member, an unaccepted member and a stranger write nothing in the organisation\'s folder (inserts judged without RETURNING)',
  [V, U, S].every(u => !landedObj(u, 'leases', `${O1}/x-${u.slice(0, 2)}.pdf`)
    && blocked(as(u, `update storage.objects set metadata='{}' where name='${ORG_OBJ}' returning id;`)) && blocked(as(u, `delete from storage.objects where name='${ORG_OBJ}' returning id;`))));
check('…and none of that changed an object', objCount() === o0 && objExists(ORG_OBJ) && objExists(OWN_OBJ));
check('an editor puts, overwrites and deletes a file in the organisation\'s folder', wrote(as(M, `insert into storage.objects(bucket_id,name,owner) values ('leases','${O1}/by-editor.pdf','${M}') returning id;`))
  && wrote(as(M, `update storage.objects set metadata='{"size":3}' where name='${O1}/by-editor.pdf' returning id;`))
  && wrote(as(M, `delete from storage.objects where name='${O1}/by-editor.pdf' returning id;`)));
check('the owner (an admin) does too, and in their own folder', wrote(as(A, `insert into storage.objects(bucket_id,name,owner) values ('leases','${O1}/by-owner.pdf','${A}') returning id;`))
  && wrote(as(A, `delete from storage.objects where name='${O1}/by-owner.pdf' returning id;`))
  && wrote(as(A, `update storage.objects set metadata='{"size":11}' where name='${OWN_OBJ}' returning id;`)));
check('a bucket outside leases/invoices takes nothing from anyone signed in, their own folder or not (as before; judged without RETURNING)',
  landedObj(A, 'invoices', `${A}/ok.pdf`) && q(`insert into storage.buckets(id,name) values ('other','other');`).ok
  && !landedObj(A, 'other', `${A}/no.pdf`) && !landedObj(M, 'other', `${O1}/no.pdf`)
  && blocked(as(A, `update storage.objects set bucket_id='other' where name='${OWN_OBJ}' returning id;`)) && one(`select bucket_id from storage.objects where name='${OWN_OBJ}';`) === 'leases');
check('the server (service key, api/upload.js) still writes any folder', wrote(svc(`insert into storage.objects(bucket_id,name,owner) values ('leases','${O1}/by-server.pdf',null) returning id;`)) && wrote(svc(`delete from storage.objects where name='${O1}/by-server.pdf' returning id;`)));
// 046's rules on acquisition originals still hold, against editors too.
const ACQ = `${A}/acq_${W.R}_1-gl.csv`;
object(ACQ, A);
r = as(A, `insert into public.acquisition_documents(review_id,user_id,file_name,intake_id,storage_path) values ('${W.R}','${A}','gl.csv','ik-1','leases/${ACQ}') returning id;`);
check('(an acquisition document points at a stored original)', wrote(r), short(r.out));
check('046 still stands: an editor cannot overwrite, move or delete an acquisition original, even in a folder they may write', blocked(as(M, `update storage.objects set metadata='{}' where name='${ACQ}' returning id;`))
  && blocked(as(A, `update storage.objects set name='${A}/elsewhere.csv' where name='${ACQ}' returning id;`)) && blocked(as(A, `delete from storage.objects where name='${ACQ}' returning id;`)) && objExists(ACQ));

// ── 4 · grants ──────────────────────────────────────────────────────────────
section('4 · grants, exactly');
check('anon: nothing on organization_members, organizations or lease_documents', ['organization_members', 'organizations', 'lease_documents'].every(t => pg.privs('public.' + t, 'anon', DB) === ''));
check('authenticated: SELECT only on organization_members and organizations', pg.privs('public.organization_members', 'authenticated', DB) === 'SELECT' && pg.privs('public.organizations', 'authenticated', DB) === 'SELECT');
check('authenticated: SELECT, INSERT, UPDATE, DELETE on lease_documents — no TRUNCATE, REFERENCES or TRIGGER', pg.privs('public.lease_documents', 'authenticated', DB) === 'DELETE,INSERT,SELECT,UPDATE');
check('service_role: unchanged (everything) on all three', ['organization_members', 'organizations', 'lease_documents'].every(t => pg.privs('public.' + t, 'service_role', DB) === ALL));
check('a member still reads their own membership and their organisation\'s roster', as(R, `select count(*) from public.organization_members where user_id='${R}';`).out.trim() === '1' && as(R, `select count(*) from public.organizations where id='${O1}';`).out.trim() === '1');
check('a read-only member cannot promote themselves, add or remove members (refused outright now, not just filtered)',
  denied(as(R, `update public.organization_members set role='admin' where user_id='${R}';`)) && denied(as(R, `insert into public.organization_members(organization_id,user_id,role) values ('${O1}','${S}','admin');`))
  && denied(as(R, `delete from public.organization_members where organization_id='${O1}';`)));
check('…and neither can the owner or an admin through the API (membership is the server\'s to write)', denied(as(A, `delete from public.organization_members where user_id='${R}';`)) && denied(as(D, `update public.organizations set name='x' where id='${O1}';`)));
check('anon cannot read, write or TRUNCATE any of the three', denied(anon(`select count(*) from public.organization_members;`)) && denied(anon(`select count(*) from public.organizations;`))
  && denied(anon(`truncate public.lease_documents;`)) && denied(anon(`truncate public.organization_members;`)));
check('authenticated cannot TRUNCATE the register', denied(as(A, `truncate public.lease_documents;`)));

// ── 5 · workflows ───────────────────────────────────────────────────────────
section('5 · the workflows around them keep working');
r = as(N, `insert into public.properties(user_id,name) values ('${N}','ZZ First Property') returning organization_id;`);
check('a brand-new user creates their first property, and the organisation and admin membership are made for them (SECURITY DEFINER trigger — the grant change does not reach it)',
  wrote(r) && r.out.trim() !== O1 && one(`select role from public.organization_members where user_id='${N}';`) === 'admin', short(r.out));
const N2 = deal(N, 'ZZ New User Deal');
check('…and starts a deal', !!N2.R);
const P1 = ownProperty(A, 'ZZ Operating Property');
check('an editor saves the owner\'s property (045 keeps ownership)', wrote(as(M, `update public.properties set name='saved by editor' where id='${P1}' returning id;`)) && one(`select user_id from public.properties where id='${P1}';`) === A);
registerRow(P1, 'doomed.pdf');
check('deleting a property cascades into the register (the cascade runs as the table owner; no grant is needed)', wrote(as(A, `delete from public.properties where id='${P1}' returning id;`)) && one(`select count(*) from public.lease_documents where property_id='${P1}';`) === '0');
check('a read-only member still reads properties, leaseholds and the acquisition review', as(R, `select (select count(*) from public.properties where id='${W.P}')||'|'||(select count(*) from public.acquisition_reviews where id='${W.R}');`).out.trim() === '1|1');
check('a read-only member still creates a property of their own', wrote(as(R, `insert into public.properties(user_id,name) values ('${R}','ZZ read-only own') returning id;`)));

// ── 6 · rollback ────────────────────────────────────────────────────────────
section('6 · ROLLBACK — exact, and the old behaviour returns');
r = pg.psqlFile(R047, DB);
check('the rollback runs', r.ok, short(r.out));
const rolled = inventory(DB);
check('the catalog is EXACTLY what it was before 047 (policies, storage rules, grants, functions)', rolled.join('\n') === before.join('\n'),
  'missing: ' + before.filter(y => !rolled.includes(y)).slice(0, 2).join(' ; ') + ' | extra: ' + rolled.filter(y => !before.includes(y)).slice(0, 2).join(' ; '));
check('the old behaviour is back: a read-only member adds a register row again', wrote(as(R, `insert into public.lease_documents(property_id,file_name) values ('${W.P}','after-rollback.pdf') returning id;`)));
check('…and puts a file in the organisation\'s folder again', wrote(as(R, `insert into storage.objects(bucket_id,name,owner) values ('leases','${O1}/after-rollback.pdf','${R}') returning id;`)));
check('…and anon holds TRUNCATE on the register again', pg.privs('public.lease_documents', 'anon', DB) === ALL);
check('no row was lost by the rollback', one(`select count(*) from public.lease_documents where id='${LD}';`) === '1' && objExists(ORG_OBJ) && objExists(OWN_OBJ) && objExists(ACQ));
q(`delete from public.lease_documents where file_name='after-rollback.pdf'; delete from storage.objects where name='${O1}/after-rollback.pdf';`);
r = pg.psqlFile(R047, DB);
check('the rollback runs a second time harmlessly', r.ok, short(r.out));
r = pg.psqlFile(M047, DB);
check('047 applies again, to the same catalog as before', r.ok && inventory(DB).join('\n') === after.join('\n'), short(r.out));
check('…and refuses the read-only register write again', blocked(as(R, `insert into public.lease_documents(property_id,file_name) values ('${W.P}','again.pdf') returning id;`)));

// ── 7 · post-2026-10-30 defaults ────────────────────────────────────────────
section('7 · under Supabase\'s post-2026-10-30 default privileges');
DB = 'post1030';
r = build(DB, 'legacy', false, false);
if (r.ok) r = pg.setModel(DB, 'post-2026-10-30');
if (r.ok) r = pg.psqlFile(M045, DB);
if (r.ok) r = pg.psqlFile(M046, DB);
if (r.ok) r = pg.psqlFile(M047, DB);
check('047 applies after the switch', r.ok, short(r.out));
check('the same grants result: anon nothing; authenticated SELECT on the organisation tables, SELECT/INSERT/UPDATE/DELETE on the register; service_role everything',
  ['organization_members', 'organizations', 'lease_documents'].every(t => pg.privs('public.' + t, 'anon', DB) === '' && pg.privs('public.' + t, 'service_role', DB) === ALL)
  && pg.privs('public.organization_members', 'authenticated', DB) === 'SELECT' && pg.privs('public.lease_documents', 'authenticated', DB) === 'DELETE,INSERT,SELECT,UPDATE');
const W2 = deal(A, 'ZZ Post Deal', DB);
check('…and an editor writes the register, a read-only member does not', wrote(as(M, `insert into public.lease_documents(property_id,file_name) values ('${W2.P}','e.pdf') returning id;`, DB))
  && blocked(as(R, `insert into public.lease_documents(property_id,file_name) values ('${W2.P}','r.pdf') returning id;`, DB)));

T.finish();
