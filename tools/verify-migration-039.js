'use strict';
/**
 * tools/verify-migration-039.js — run 039 (the register's leasehold link) for
 * real, against nothing that matters.
 *
 *   node tools/verify-migration-039.js
 *
 * It touches NO Supabase project. It builds a throwaway PostgreSQL cluster,
 * stands up the tables resync_property_tenants and the new constraint touch —
 * properties, tenants (with tenants_id_property_uniq), cam_reconciliations,
 * tenant_field_evidence, payments and lease_documents, columns and keys as read
 * from Pilot's catalog — installs 032 from its file (byte-identical to Pilot's
 * live body), seeds historical register rows whose tenant_id resolves to
 * nothing (as all 91 on Pilot do), and applies 039.
 *
 * WHAT IT PROVES
 *
 *   1  the 032 body installed is Pilot's live body (prosrc md5); 039 applies,
 *      and applies again
 *   2  EXACT INVENTORY: legacy_tenant_id is a nullable uuid with no default and
 *      no constraint; lease_documents_leasehold_fk is (tenant_id, property_id)
 *      → tenants(id, property_id), ON DELETE / ON UPDATE NO ACTION, NOT VALID;
 *      the function body is 032's plus exactly the two retention lines; the
 *      function stays SECURITY DEFINER with search_path=public and the same ACL
 *   3  HISTORY UNTOUCHED: every lease_documents row is byte-identical across the
 *      apply; legacy_tenant_id is empty; the unresolved values are still there,
 *      still unresolved, and the constraint is still not validated
 *   4  NEW WRITES ARE CHECKED: a link to a tenant of the same property is
 *      accepted; to a tenant of another property, or to no tenant, refused —
 *      for the service role (BYPASSRLS) too; tenant_id null is accepted;
 *      editing an unresolved historical row without touching tenant_id is
 *      accepted; re-pointing it to a real same-property tenant is accepted, to
 *      a bad one refused
 *   5  DELETES: a tenant a document is linked to cannot be deleted on its own;
 *      an unlinked tenant can; deleting the PROPERTY still removes its tenants
 *      and documents in one statement (cascade, end-of-statement check)
 *   6  RESYNC: a roster that omits a linked tenant succeeds, keeps it and says
 *      so (retained_referenced), and still prunes an unreferenced absentee;
 *      032's other rules still hold (cross-property refusal, prospect refusal,
 *      not_authorized); WITHOUT 039's function change the same roster would
 *      fail the whole call — the reason the two ship together
 *   7  ROLLBACK restores 032's body byte-for-byte, drops the constraint and the
 *      column, clears the comment, writes no row; it is REFUSED once
 *      legacy_tenant_id holds a value; 039 applies again after it
 *   8  STATIC: outside the function body the file writes no row, touches no
 *      acquisition table, policy or other grant, and names Pilot's marker
 *
 * SKIPS (exit 0) when no local PostgreSQL server binary is present, and says so
 * loudly — a skip is not a pass and must not read like one.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { startCluster, tally } = require('./_pg-throwaway');

const ROOT = path.join(__dirname, '..');
const MIG  = path.join(ROOT, 'migrations');
const M032 = fs.readFileSync(path.join(MIG, '032_resync_property_tenants_property_bound.sql'), 'utf8');
const M039 = fs.readFileSync(path.join(MIG, '039_register_leasehold_link.sql'), 'utf8');
const R039 = fs.readFileSync(path.join(MIG, '039_register_leasehold_link_rollback.sql'), 'utf8');

const LIVE_BODY_MD5 = '3611e28879049f86cae9ad10c0552494';   // Pilot prosrc, read 2026-09-29
const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');
const bodyOf = (s) => { const i = s.indexOf('as $$'); return s.slice(i + 5, s.indexOf('$$;', i)); };

const T = tally();
const { check, section } = T;

console.log('\n══ migration 039 — executed against a throwaway cluster ══');
console.log('   NO Supabase project is contacted by this script.');
const pg = startCluster('039');
console.log('   postgres: ' + pg.PGBIN);

const A  = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222';
const P1 = 'aaaaaaaa-0000-4000-8000-000000000001', P2 = 'aaaaaaaa-0000-4000-8000-000000000002';
const P3 = 'aaaaaaaa-0000-4000-8000-000000000003', P4 = 'bbbbbbbb-0000-4000-8000-000000000004';
const PM = 'fd9c09b1-b657-4c58-9999-c3cce28e7600';                 // Pilot marker property
const T1 = 'dddddddd-0000-4000-8000-000000000001', T2 = 'dddddddd-0000-4000-8000-000000000002';
const T3 = 'dddddddd-0000-4000-8000-000000000003', T4 = 'dddddddd-0000-4000-8000-000000000004';
const T5 = 'dddddddd-0000-4000-8000-000000000005', T9 = 'dddddddd-0000-4000-8000-000000000009';
const GHOST = 'eeeeeeee-0000-4000-8000-00000000000e';               // resolves to nothing
const D1 = 'f0000000-0000-4000-8000-000000000001', D2 = 'f0000000-0000-4000-8000-000000000002';
const D3 = 'f0000000-0000-4000-8000-000000000003';

const SCHEMA = `
  insert into auth.users(id) values ('${A}'),('${B}');
  create table public.properties (
    id uuid primary key default gen_random_uuid(),
    user_id uuid references auth.users(id) on delete cascade,
    name text, archived_at timestamptz,
    lifecycle_stage text not null default 'acquired'
      check (lifecycle_stage in ('prospect','under_review','due_diligence','acquired','passed')));
  create table public.tenants (
    id uuid primary key default gen_random_uuid(),
    property_id uuid references public.properties(id) on delete cascade,
    name text, sqft numeric, cap numeric, start_date date, end_date date, lease_url text, lease_type text,
    created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
    constraint tenants_id_property_uniq unique (id, property_id));
  create table public.cam_reconciliations (id uuid primary key default gen_random_uuid(),
    property_id uuid not null references public.properties(id) on delete cascade, tenant_id uuid, year integer not null);
  create table public.lease_documents (
    id uuid primary key default gen_random_uuid(),
    property_id uuid not null references public.properties(id) on delete cascade,
    tenant_id uuid, tenant_name text, file_name text not null, file_url text, extracted_text text,
    parsing_status text not null default 'pending', extraction_model text, used_pdf_direct boolean not null default false,
    created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
    doc_type text, doc_family_id uuid, category text, status text not null default 'received',
    supersedes_document_id uuid references public.lease_documents(id) on delete set null);
  create index lease_docs_property_tenant_idx on public.lease_documents (property_id, tenant_id) where tenant_id is not null;
  create table public.tenant_field_evidence (id uuid primary key default gen_random_uuid(),
    property_id uuid not null references public.properties(id) on delete cascade, tenant_id text not null, field_key text not null,
    source_document_id uuid references public.lease_documents(id) on delete set null);
  create table public.payments (id uuid primary key default gen_random_uuid(),
    property_id uuid not null references public.properties(id) on delete cascade, tenant_id uuid not null,
    constraint payments_tenant_property_fk foreign key (tenant_id, property_id) references public.tenants(id, property_id) on delete restrict);
  alter table public.properties enable row level security;
  alter table public.tenants enable row level security;
  alter table public.lease_documents enable row level security;`;

const FIXTURES = `
  insert into public.properties(id,user_id,name,lifecycle_stage) values
    ('${PM}','${A}','pilot marker','acquired'),
    ('${P1}','${A}','A acquired 1','acquired'), ('${P2}','${A}','A acquired 2','acquired'),
    ('${P3}','${A}','A prospect','prospect'),   ('${P4}','${B}','B acquired','acquired');
  insert into public.tenants(id,property_id,name) values
    ('${T1}','${P1}','T1 linked'), ('${T2}','${P1}','T2 unreferenced'), ('${T3}','${P1}','T3 evidence'),
    ('${T4}','${P2}','T4 on P2'),  ('${T5}','${P4}','T5 on P4 (B)');
  insert into public.tenant_field_evidence(property_id,tenant_id,field_key) values ('${P1}','${T3}','sqft');
  -- historical register rows, exactly Pilot's shapes: an id that resolves to nothing, and a null
  insert into public.lease_documents(id,property_id,tenant_id,tenant_name,file_name,file_url) values
    ('${D1}','${P1}','${GHOST}','Ghost Co','ghost.pdf','leases/x/ghost.pdf'),
    ('${D2}','${P2}',null,null,'nobody.pdf',null),
    ('${D3}','${P1}','${GHOST}','Ghost Co','ghost2.pdf',null);`;

const q = (sql, db) => pg.psql(sql, db);
const one = (sql, db) => q(sql, db).out;
const fp = (db) => one(`select md5(string_agg(md5(x::text), '' order by x.id)) from public.lease_documents x;`, db);
const fpCols = (db) => one(`select md5(string_agg(md5(row(x.id,x.property_id,x.tenant_id,x.tenant_name,x.file_name,x.file_url,x.extracted_text,x.parsing_status,x.extraction_model,x.used_pdf_direct,x.created_at,x.updated_at,x.doc_type,x.doc_family_id,x.category,x.status,x.supersedes_document_id)::text), '' order by x.id)) from public.lease_documents x;`, db);
const prosrcMd5 = (db) => one(`select md5(prosrc) from pg_proc where oid='public.resync_property_tenants(uuid,jsonb)'::regprocedure;`, db);
const acl = (db) => one(`select coalesce(proacl::text,'<default>') || '|' || prosecdef || '|' || coalesce(array_to_string(proconfig, ','),'') from pg_proc where oid='public.resync_property_tenants(uuid,jsonb)'::regprocedure;`, db);
const rpc = (db, uid, prop, rows) => {
  const r = pg.as('authenticated', uid, `select public.resync_property_tenants('${prop}'::uuid, '${JSON.stringify(rows).replace(/'/g, "''")}'::jsonb);`, db);
  try { return JSON.parse(r.out); } catch (_) { return { _error: r.out }; }
};
const exists = (db, t) => one(`select exists(select 1 from public.tenants where id='${t}');`, db) === 't';
const fkErr = (r) => !r.ok && /violates foreign key constraint "lease_documents_leasehold_fk"/.test(r.out);
const install032 = (db) => pg.psqlText(M032, db, 'm032');
const catalog = (db) => one(`
  select md5(string_agg(x, '|' order by x)) from (
    select 'c:' || table_name || '.' || column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default,'') x
      from information_schema.columns where table_schema='public'
    union all select 'k:' || conrelid::regclass::text || '.' || conname || ':' || pg_get_constraintdef(oid) || ':' || convalidated
      from pg_constraint where connamespace='public'::regnamespace
    union all select 'i:' || indexname || ':' || indexdef from pg_indexes where schemaname='public'
    union all select 'f:' || p.oid::regprocedure::text || ':' || md5(prosrc) || ':' || coalesce(proacl::text,'') from pg_proc p where pronamespace='public'::regnamespace
    union all select 'g:' || table_name || ':' || grantee || ':' || privilege_type from information_schema.role_table_grants where table_schema='public'
    union all select 'p:' || tablename || '.' || policyname from pg_policies where schemaname='public'
  ) s;`, db);

// ── 1 · apply ────────────────────────────────────────────────────────────────
section('1 · 032 baseline is Pilot\'s live body; 039 applies, and again');
check('032 file body = Pilot live prosrc (md5 ' + LIVE_BODY_MD5.slice(0, 8) + '…)', md5(bodyOf(M032)) === LIVE_BODY_MD5, md5(bodyOf(M032)));
const DB = 'm039';
pg.database(DB, 'legacy');
check('stand-in schema builds', q(SCHEMA, DB).ok);
check('032 installs', install032(DB).ok);
check('fixtures load', q(FIXTURES, DB).ok);
check('installed body is the live body', prosrcMd5(DB) === LIVE_BODY_MD5, prosrcMd5(DB));
const fpColsBefore = fpCols(DB), aclBefore = acl(DB);
const r1 = pg.psqlText(M039, DB, 'm039');
check('039 applies', r1.ok, r1.ok ? '' : r1.out.slice(0, 300));
const catalogAfterFirst = catalog(DB);
const r2 = pg.psqlText(M039, DB, 'm039-again');
check('039 applies again (re-runnable)', r2.ok, r2.ok ? '' : r2.out.slice(0, 300));
check('the second apply changes nothing', catalog(DB) === catalogAfterFirst);

// ── 2 · exact inventory ─────────────────────────────────────────────────────
section('2 · exact inventory');
check('legacy_tenant_id: uuid, nullable, no default',
  one(`select data_type||':'||is_nullable||':'||coalesce(column_default,'<none>') from information_schema.columns where table_schema='public' and table_name='lease_documents' and column_name='legacy_tenant_id';`, DB) === 'uuid:YES:<none>');
check('legacy_tenant_id carries no constraint',
  one(`select count(*) from pg_constraint c where c.conrelid='public.lease_documents'::regclass and (select attnum from pg_attribute where attrelid=c.conrelid and attname='legacy_tenant_id') = any(c.conkey);`, DB) === '0');
const fk = one(`select pg_get_constraintdef(oid)||'|'||convalidated::text||'|'||confdeltype::text||'|'||confupdtype::text||'|'||confrelid::regclass::text from pg_constraint where conrelid='public.lease_documents'::regclass and conname='lease_documents_leasehold_fk';`, DB);
check('FK (tenant_id, property_id) → tenants(id, property_id)', /^FOREIGN KEY \(tenant_id, property_id\) REFERENCES (public\.)?tenants\(id, property_id\)/.test(fk), fk);
check('FK is NOT VALID (convalidated = false)', fk.split('|')[1] === 'false');
check('FK ON DELETE NO ACTION and ON UPDATE NO ACTION', fk.split('|')[2] === 'a' && fk.split('|')[3] === 'a');
const src = one(`select prosrc from pg_proc where oid='public.resync_property_tenants(uuid,jsonb)'::regprocedure;`, DB);
const added = src.split('\n').filter(l => !bodyOf(M032).split('\n').includes(l));
// Undo exactly 039's edit and the result must be Pilot's live body, byte for byte.
const undone = src
  .replace('\n      or exists (select 1 from public.lease_documents ld where ld.tenant_id = t.id));', ');')
  .replace('\n    and not exists (select 1 from public.lease_documents ld where ld.tenant_id = t.id);', ';')
  .replace('(039: + lease_documents)\n', '(unchanged) ───────────\n')
  .replace('(039: + lease_documents) ─────', '(unchanged) ──────────────────');
check('function body = 032 + exactly the two retention lines (undoing them yields the live md5)',
  // (psql -A -t trims the leading/trailing newline of prosrc; the file body is compared trimmed the same way)
  undone === bodyOf(M032).trim() && md5(bodyOf(M032)) === LIVE_BODY_MD5 && added.filter(l => /lease_documents ld where ld\.tenant_id = t\.id/.test(l)).length === 2,
  md5(undone));
check('function stays SECURITY DEFINER, search_path=public, same ACL', acl(DB) === aclBefore, acl(DB));
check('comment on tenant_id names the leasehold',
  /leasehold/.test(one(`select col_description('public.lease_documents'::regclass, (select attnum from pg_attribute where attrelid='public.lease_documents'::regclass and attname='tenant_id'));`, DB)));

// ── 3 · history untouched ───────────────────────────────────────────────────
section('3 · history untouched');
check('every original column of every lease_documents row is byte-identical across the apply', fpCols(DB) === fpColsBefore);
check('legacy_tenant_id is empty on every row', one(`select count(*) from public.lease_documents where legacy_tenant_id is not null;`, DB) === '0');
check('the unresolved historical values are still there, still unresolved',
  one(`select count(*) from public.lease_documents d where d.tenant_id='${GHOST}' and not exists (select 1 from public.tenants t where t.id=d.tenant_id);`, DB) === '2');
check('nothing declared valid: constraint still NOT VALID after the re-apply',
  one(`select convalidated from pg_constraint where conname='lease_documents_leasehold_fk';`, DB) === 'f');

// ── 4 · new writes are checked ──────────────────────────────────────────────
section('4 · new writes are checked (property-scoped)');
check('INSERT linked to a tenant of the SAME property: accepted',
  q(`insert into public.lease_documents(property_id,tenant_id,file_name) values ('${P1}','${T1}','t1-lease.pdf');`, DB).ok);
check('INSERT linked to a tenant of ANOTHER property: refused by the FK',
  fkErr(q(`insert into public.lease_documents(property_id,tenant_id,file_name) values ('${P1}','${T4}','x.pdf');`, DB)));
check('INSERT linked to no tenant at all: refused by the FK',
  fkErr(q(`insert into public.lease_documents(property_id,tenant_id,file_name) values ('${P1}','${GHOST}','x.pdf');`, DB)));
check('service role (BYPASSRLS) cross-property link: still refused',
  fkErr(pg.as('service_role', null, `insert into public.lease_documents(property_id,tenant_id,file_name) values ('${P1}','${T5}','x.pdf');`, DB)));
check('INSERT with tenant_id null (a property document): accepted',
  q(`insert into public.lease_documents(property_id,tenant_id,file_name) values ('${P2}',null,'tax-bill.pdf');`, DB).ok);
check('UPDATE of an unresolved historical row that leaves tenant_id alone: accepted',
  q(`update public.lease_documents set file_url='leases/x/ghost-v2.pdf', updated_at=now() where id='${D1}';`, DB).ok);
check('UPDATE that re-points a historical row to a bad tenant: refused',
  fkErr(q(`update public.lease_documents set tenant_id='${T4}' where id='${D3}';`, DB)));
check('UPDATE that re-points a historical row to a real same-property tenant: accepted',
  q(`update public.lease_documents set tenant_id='${T2}' where id='${D3}';`, DB).ok);
check('re-writing an unresolved value is refused (history cannot be re-created, only kept)',
  fkErr(q(`update public.lease_documents set tenant_id='${GHOST}' where id='${D3}';`, DB)));
check('   …test hygiene: D3 unlinked again (tenant_id null) so section 6 starts clean',
  q(`update public.lease_documents set tenant_id=null where id='${D3}';`, DB).ok);

// ── 5 · deletes ─────────────────────────────────────────────────────────────
section('5 · deletes: a linked leasehold is protected, a property still cascades');
check('DELETE a tenant a document is linked to: refused',
  fkErr(q(`delete from public.tenants where id='${T1}';`, DB)) && exists(DB, T1));
check('DELETE an unlinked tenant: allowed',
  q(`insert into public.tenants(id,property_id,name) values ('${T9}','${P2}','T9 unlinked');`, DB).ok
  && q(`delete from public.tenants where id='${T9}';`, DB).ok && !exists(DB, T9));
{
  const X = 'm039del'; pg.database(X, 'legacy'); q(SCHEMA, X); install032(X); q(FIXTURES, X); pg.psqlText(M039, X, 'm039');
  q(`insert into public.lease_documents(property_id,tenant_id,file_name) values ('${P1}','${T1}','linked.pdf');`, X);
  q(`insert into public.tenant_field_evidence(property_id,tenant_id,field_key,source_document_id) select '${P1}','${T1}','cap', id from public.lease_documents where file_name='linked.pdf';`, X);
  const r = q(`delete from public.properties where id='${P1}';`, X);
  check('DELETE the PROPERTY (linked tenant + linked doc + historical docs): succeeds', r.ok, r.ok ? '' : r.out.slice(0, 200));
  check('   …its tenants, documents and evidence are gone together',
    one(`select (select count(*) from public.tenants where property_id='${P1}') + (select count(*) from public.lease_documents where property_id='${P1}') + (select count(*) from public.tenant_field_evidence where property_id='${P1}');`, X) === '0');
  check('   …other properties untouched',
    one(`select count(*) from public.tenants where property_id in ('${P2}','${P4}');`, X) === '2');
}

// ── 6 · resync ──────────────────────────────────────────────────────────────
section('6 · resync_property_tenants keeps register-linked tenants');
{
  // T1 is linked (t1-lease.pdf), T2 unreferenced, T3 has evidence. Roster names only a new tenant.
  const NEW = 'dddddddd-0000-4000-8000-00000000000a';
  const r = rpc(DB, A, P1, [{ id: NEW, name: 'New tenant', sqft: 100 }]);
  check('roster omitting a linked tenant: ok', r.ok === true, JSON.stringify(r).slice(0, 200));
  check('   …the linked tenant is kept', exists(DB, T1));
  check('   …and counted in retained_referenced (T1 linked + T3 evidence = 2)', r.retained_referenced === 2, String(r.retained_referenced));
  check('   …the unreferenced absentee is still pruned', !exists(DB, T2) && r.deleted === 1);
  check('   …the new row is written', exists(DB, NEW) && r.upserted === 1);
  const x = rpc(DB, A, P1, [{ id: T4, name: 'moved?' }]);
  check('032 rule holds: an id from another property refuses the call', x.ok === false && x.code === 'cross_property_tenant');
  const p = rpc(DB, A, P3, [{ id: 'dddddddd-0000-4000-8000-00000000000b', name: 'p' }]);
  check('032 rule holds: a prospect is refused', p.ok === false && p.code === 'property_not_acquired');
  const n = rpc(DB, B, P1, [{ id: NEW, name: 'x' }]);
  check('032 rule holds: another user is not_authorized', n.ok === false && n.code === 'not_authorized');
}
{
  // The hazard 039's function change removes: the FK with 032's body.
  const X = 'm039hazard'; pg.database(X, 'legacy'); q(SCHEMA, X); install032(X); q(FIXTURES, X); pg.psqlText(M039, X, 'm039');
  q(`insert into public.lease_documents(property_id,tenant_id,file_name) values ('${P1}','${T2}','t2.pdf');`, X);
  install032(X);                                  // put 032's body back, keep the FK
  const r = rpc(X, A, P1, [{ id: T1, name: 'T1' }]);
  check('WITHOUT the function change the same kind of roster FAILS the whole call (why they ship together)',
    !!r._error && /lease_documents_leasehold_fk/.test(r._error), (r._error || JSON.stringify(r)).slice(0, 160));
  check('   …and wrote nothing (T1 name unchanged, T2 still there)',
    one(`select name from public.tenants where id='${T1}';`, X) === 'T1 linked' && exists(X, T2));
}

// ── 7 · rollback ────────────────────────────────────────────────────────────
section('7 · rollback');
{
  const X = 'm039rb'; pg.database(X, 'legacy'); q(SCHEMA, X); install032(X); q(FIXTURES, X);
  const before = fpCols(X), catBefore = catalog(X);
  pg.psqlText(M039, X, 'm039');
  const rb = pg.psqlText(R039, X, 'r039');
  check('rollback runs', rb.ok, rb.ok ? '' : rb.out.slice(0, 300));
  check('   …function body back to 032 (live md5)', prosrcMd5(X) === LIVE_BODY_MD5);
  check('   …constraint and column gone; the catalog equals the pre-039 catalog', catalog(X) === catBefore);
  check('   …tenant_id comment cleared (it had none before)',
    one(`select coalesce(col_description('public.lease_documents'::regclass, (select attnum from pg_attribute where attrelid='public.lease_documents'::regclass and attname='tenant_id')),'<none>');`, X) === '<none>');
  check('   …no row written', fpCols(X) === before);
  check('039 applies again after the rollback', pg.psqlText(M039, X, 'm039-again').ok);
  q(`update public.lease_documents set legacy_tenant_id = tenant_id where id='${D1}';`, X);
  const refused = pg.psqlText(R039, X, 'r039-refused');
  check('rollback is REFUSED once legacy_tenant_id holds a value', !refused.ok && /rollback refused/.test(refused.out));
  check('   …and changed nothing (constraint still present)',
    one(`select count(*) from pg_constraint where conname='lease_documents_leasehold_fk';`, X) === '1');
}

// ── 8 · static ──────────────────────────────────────────────────────────────
section('8 · static');
{
  const noComments = (s) => s.replace(/^\s*--.*$/gm, '');
  const outsideFn = (s) => { const i = s.indexOf('as $$'); return i < 0 ? s : s.slice(0, i) + s.slice(s.indexOf('$$;', i) + 3); };
  const top = noComments(outsideFn(M039));
  check('no INSERT / UPDATE / DELETE outside the function body', !/\b(insert\s+into|update\s+public\.|delete\s+from)\b/i.test(top));
  check('no acquisition table is named', !/acquisition_/i.test(noComments(M039)));
  check('no policy is created, altered or dropped', !/\bpolicy\b/i.test(top));
  check('the only grants are the two re-stated EXECUTE grants',
    (top.match(/\bgrant\b/gi) || []).length === 2 && !/\brevoke\b/i.test(top));
  check('guarded by the Pilot marker property', M039.includes("fd9c09b1-b657-4c58-9999-c3cce28e7600") && R039.includes("fd9c09b1-b657-4c58-9999-c3cce28e7600"));
  check('no VALIDATE CONSTRAINT anywhere', !/validate\s+constraint/i.test(noComments(M039)));
  check('says nothing of XRPL / wallets / payments settlement', !/xrpl|wallet|rlusd/i.test(noComments(M039)));
}

T.finish();
