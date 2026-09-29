'use strict';
/**
 * tools/verify-migration-042.js — run 042 (the 53-row register relink) for
 * real, against nothing that matters.
 *
 *   node tools/verify-migration-042.js
 *
 * It touches NO Supabase project. It builds a throwaway PostgreSQL cluster with
 * stand-ins for the tables 042 reads or writes — properties, tenants (with
 * tenants_id_property_uniq), lease_jobs, storage.objects and lease_documents
 * with its live BEFORE UPDATE trigger — installs 032 and 039 from their files,
 * and loads a fixture that mirrors Pilot's 92 register rows by shape:
 *
 *   · the 53 approved documents, with the approved ids (document, expected
 *     tenant_id, proposed tenant id), each with exactly the evidence the dry
 *     run proved: one job whose id is the proposed tenant, that tenant in the
 *     same property, the same stored upload on both sides, one storage object;
 *   · the 38 excluded documents, with their real ids: 9 Miracle Mile List A
 *     rows (built so they WOULD qualify under the dry run's rule), 11 List B
 *     (no stored file), 4 List C (two jobs), 14 List D (no job, no tenant);
 *   · the row whose tenant_id is already empty;
 *   · one more row that also qualifies under the rule but is on no list — the
 *     proof that 042 selects by its fixed list only, never by a rule.
 *
 * WHAT IT PROVES
 *
 *   1  042 applies; exactly the 53 rows change: legacy_tenant_id = the audited
 *      value, tenant_id = the proposed tenant, every link same-property valid;
 *      nothing else about those rows changes except updated_at (the table's
 *      own trigger); every other register row — every excluded row, the empty
 *      row and the rule-qualifying extra — is byte-identical; tenants, jobs,
 *      properties and storage are byte-identical; no DDL; the constraint stays
 *      NOT VALID; unresolved rows drop by exactly 53; re-running is a no-op
 *   2  ABORT MATRIX: each broken precondition — a missing row, a changed
 *      current value, a current value that now resolves, a missing / moved /
 *      re-pointed target, a shared upload, a second job, a job that is not the
 *      target, a missing stored object, a claimed target, a Miracle Mile row,
 *      a stray legacy value, a partial prior run, 039 missing, not Pilot, and a
 *      damaged list (short, duplicate target, excluded row) — aborts the WHOLE
 *      migration with the reason named, and leaves every table unchanged
 *   3  after 042 a relinked leasehold cannot be deleted on its own; deleting
 *      its property still cascades
 *   4  ROLLBACK restores tenant_id exactly and empties legacy_tenant_id, re-adds
 *      the identical NOT VALID constraint with its comment, changes no other
 *      row and no catalog object; it is refused once any of the 53 moved on or
 *      a foreign legacy value exists; 042 applies again after it
 *   5  STATIC: the 53 triples in 042 and in its rollback are, in order, the
 *      approved list (sha256 pinned below); the excluded list is the audit's
 *      38 + the empty row; outside the proof the file writes lease_documents
 *      only, has no DDL, no VALIDATE, no policy or grant, and names Pilot
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
const M042 = fs.readFileSync(path.join(MIG, '042_register_relink_deterministic.sql'), 'utf8');
const R042 = fs.readFileSync(path.join(MIG, '042_register_relink_deterministic_rollback.sql'), 'utf8');

// The approved list: sha256 of "doc expected proposed\n"… in the dry run's order
// (migration-042-dry-run.md, 2026-09-29), and of the audit's 38 excluded ids
// (Miracle Mile A, B, C, D in the audit's order).
const APPROVED_SHA = 'bcb3753778cec68fe071c8648b01ac2c9553737ddcc71bf21b86f0f2fc099730';
const EXCLUDED_SHA = 'ec85ff0b30dc3068f23b3f256e836d482740dd6c2113bb3ab11aa4743589c6a2';
const NULL_ROW = 'fb46a142-beda-452e-b628-d72c6db13f78';
const PM = 'fd9c09b1-b657-4c58-9999-c3cce28e7600';                 // Pilot marker property
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

// ── the lists, read out of the file under test ────────────────────────────
const arrayOf = (sql, name) => {
  const m = sql.match(new RegExp(name + ' uuid\\[\\] := array\\[([\\s\\S]*?)\\]::uuid\\[\\]'));
  return m ? (m[1].match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) || []) : [];
};
const DOC = arrayOf(M042, 'v_doc'), EXP = arrayOf(M042, 'v_exp'), NEW = arrayOf(M042, 'v_new');
const EXCL = arrayOf(M042, 'v_excluded');
const EX38 = EXCL.filter(x => x !== NULL_ROW);
const MM = EX38.slice(0, 9), LB = EX38.slice(9, 20), LC = EX38.slice(20, 24), LD = EX38.slice(24, 38);

const T = tally();
const { check, section } = T;

console.log('\n══ migration 042 — executed against a throwaway cluster ══');
console.log('   NO Supabase project is contacted by this script.');
const pg = startCluster('042');
console.log('   postgres: ' + pg.PGBIN);

const A = '11111111-1111-4111-8111-111111111111';
const PROPS = [1, 2, 3, 4, 5].map(i => `aaaaaaaa-0000-4000-8000-00000000000${i}`);
const PMM = 'aaaaaaaa-0000-4000-8000-0000000000mm'.replace('mm', '99');  // "Miracle Mile"
const PX  = 'aaaaaaaa-0000-4000-8000-000000000077';                      // spare property
const EXTRA_DOC = 'f0000000-0000-4000-8000-0000000000ee', EXTRA_T = 'dddddddd-0000-4000-8000-0000000000ee';
const EXTRA_GHOST = 'eeeeeeee-0000-4000-8000-0000000000ee';

const SCHEMA = `
  insert into auth.users(id) values ('${A}');
  create schema storage;
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text,
    updated_at timestamptz default now());
  create table public.properties (
    id uuid primary key default gen_random_uuid(),
    user_id uuid references auth.users(id) on delete cascade,
    name text, archived_at timestamptz,
    lifecycle_stage text not null default 'acquired');
  create table public.tenants (
    id uuid primary key default gen_random_uuid(),
    property_id uuid references public.properties(id) on delete cascade,
    name text, sqft numeric, cap numeric, start_date date, end_date date, lease_url text, lease_type text,
    created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
    constraint tenants_id_property_uniq unique (id, property_id));
  create table public.lease_jobs (id uuid primary key, created_at timestamptz not null default now(),
    property_id uuid references public.properties(id) on delete cascade, tenant_id uuid, file_name text);
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
  create table public.tenant_field_evidence (id uuid primary key default gen_random_uuid(),
    property_id uuid not null references public.properties(id) on delete cascade, tenant_id text not null, field_key text not null,
    source_document_id uuid references public.lease_documents(id) on delete set null);
  create table public.payments (id uuid primary key default gen_random_uuid(),
    property_id uuid not null references public.properties(id) on delete cascade, tenant_id uuid not null,
    constraint payments_tenant_property_fk foreign key (tenant_id, property_id) references public.tenants(id, property_id) on delete restrict);
  -- the live trigger (Pilot: lease_documents_updated_at → set_updated_at())
  create function public.set_updated_at() returns trigger language plpgsql as $f$
  begin
    new.updated_at = now();
    return new;
  end;
  $f$;
  create trigger lease_documents_updated_at before update on public.lease_documents
    for each row execute function public.set_updated_at();`;

const ts = `now() - interval '30 days'`;
const url = (i, prop, name) => (i % 2
  ? `https://x.supabase.co/storage/v1/object/public/leases/${prop}/${name}`      // the public-URL spelling
  : `leases/${prop}/${name}`);                                                    // the bucket/name spelling
function fixtureSql() {
  const s = [];
  s.push(`insert into public.properties(id,user_id,name) values ('${PM}','${A}','V3 (pilot marker)'),
    ${PROPS.map((p, i) => `('${p}','${A}','Property ${i + 1}')`).join(',')},
    ('${PMM}','${A}','Miracle Mile'), ('${PX}','${A}','Spare');`);
  // the 53 approved rows, each with exactly the dry run's evidence
  DOC.forEach((doc, i) => {
    const p = PROPS[i % PROPS.length], name = `lease-${i + 1}.pdf`, u = url(i, p, name);
    s.push(`insert into public.tenants(id,property_id,name,lease_url) values ('${NEW[i]}','${p}','Tenant ${i + 1}','${u}');
      insert into public.lease_jobs(id,property_id,file_name) values ('${NEW[i]}','${p}','${name}');
      insert into storage.objects(bucket_id,name) values ('leases','${p}/${name}');
      insert into public.lease_documents(id,property_id,tenant_id,tenant_name,file_name,file_url,extracted_text,created_at,updated_at)
        values ('${doc}','${p}','${EXP[i]}','Tenant ${i + 1}','${name}','${u}','text ${i + 1}',${ts},${ts});`);
  });
  // 9 Miracle Mile List A rows: the full structure — they WOULD qualify under the rule
  MM.forEach((doc, i) => {
    const t = `cccccccc-0000-4000-8000-0000000000${String(10 + i)}`, name = `mm-${i}.pdf`, u = `leases/${PMM}/${name}`;
    s.push(`insert into public.tenants(id,property_id,name,lease_url) values ('${t}','${PMM}','MM ${i}','${u}');
      insert into public.lease_jobs(id,property_id,file_name) values ('${t}','${PMM}','${name}');
      insert into storage.objects(bucket_id,name) values ('leases','${PMM}/${name}');
      insert into public.lease_documents(id,property_id,tenant_id,file_name,file_url,created_at,updated_at)
        values ('${doc}','${PMM}',gen_random_uuid(),'${name}','${u}',${ts},${ts});`);
  });
  // 11 List B rows: a job → tenant, no stored file on either side
  LB.forEach((doc, i) => {
    const t = `cccccccc-0000-4000-8000-0000000001${String(10 + i)}`, name = `b-${i}.pdf`, p = PROPS[i % PROPS.length];
    s.push(`insert into public.tenants(id,property_id,name) values ('${t}','${p}','B ${i}');
      insert into public.lease_jobs(id,property_id,file_name) values ('${t}','${p}','${name}');
      insert into public.lease_documents(id,property_id,tenant_id,file_name,created_at,updated_at)
        values ('${doc}','${p}',gen_random_uuid(),'${name}',${ts},${ts});`);
  });
  // 4 List C rows: two jobs, two tenants
  LC.forEach((doc, i) => {
    const t1 = `cccccccc-0000-4000-8000-0000000002${String(10 + i)}`, t2 = `cccccccc-0000-4000-8000-0000000003${String(10 + i)}`;
    const name = `c-${i}.pdf`, p = PX, u = `leases/${p}/${name}`;
    s.push(`insert into public.tenants(id,property_id,name) values ('${t1}','${p}','C ${i} a'), ('${t2}','${p}','C ${i} b');
      insert into public.lease_jobs(id,property_id,file_name) values ('${t1}','${p}','${name}'), ('${t2}','${p}','${name}');
      insert into public.lease_documents(id,property_id,tenant_id,file_name,file_url,created_at,updated_at)
        values ('${doc}','${p}',gen_random_uuid(),'${name}','${u}',${ts},${ts});`);
  });
  // 14 List D rows: nothing to point at
  LD.forEach((doc, i) => {
    s.push(`insert into public.lease_documents(id,property_id,tenant_id,file_name,created_at,updated_at)
      values ('${doc}','${PX}',gen_random_uuid(),'d-${i}.pdf',${ts},${ts});`);
  });
  // the row whose tenant_id is already empty
  s.push(`insert into public.lease_documents(id,property_id,tenant_id,file_name,created_at,updated_at)
    values ('${NULL_ROW}','${PX}',null,'empty.pdf',${ts},${ts});`);
  // one more row that qualifies under the rule but is on no list
  const eu = `leases/${PROPS[0]}/extra.pdf`;
  s.push(`insert into public.tenants(id,property_id,name,lease_url) values ('${EXTRA_T}','${PROPS[0]}','Extra','${eu}');
    insert into public.lease_jobs(id,property_id,file_name) values ('${EXTRA_T}','${PROPS[0]}','extra.pdf');
    insert into storage.objects(bucket_id,name) values ('leases','${PROPS[0]}/extra.pdf');
    insert into public.lease_documents(id,property_id,tenant_id,file_name,file_url,created_at,updated_at)
      values ('${EXTRA_DOC}','${PROPS[0]}','${EXTRA_GHOST}','extra.pdf','${eu}',${ts},${ts});`);
  return s.join('\n');
}

const q = (sql, db) => pg.psql(sql, db);
const one = (sql, db) => q(sql, db).out;
const inList = (ids) => `(${ids.map(x => `'${x}'`).join(',')})`;
const rowsMd5 = (where, db) => one(`select coalesce(md5(string_agg(md5(x::text), '' order by x.id)),'<none>') from public.lease_documents x ${where};`, db);
const ldAll = (db) => rowsMd5('', db);
const ldOther = (db) => rowsMd5(`where x.id not in ${inList(DOC)}`, db);
const ld53Stable = (db) => one(`select md5(string_agg(md5(row(x.id,x.property_id,x.tenant_name,x.file_name,x.file_url,x.extracted_text,x.parsing_status,x.extraction_model,x.used_pdf_direct,x.created_at,x.doc_type,x.doc_family_id,x.category,x.status,x.supersedes_document_id)::text), '' order by x.id)) from public.lease_documents x where x.id in ${inList(DOC)};`, db);
const tbl = (t, db) => one(`select coalesce(md5(string_agg(md5(x::text), '' order by x::text)),'<none>') from ${t} x;`, db);
const world = (db) => ['public.properties', 'public.tenants', 'public.lease_jobs', 'storage.objects', 'public.cam_reconciliations',
  'public.tenant_field_evidence', 'public.payments'].map(t => t + '=' + tbl(t, db)).join(' ') + ' ld=' + ldAll(db);
const catalog = (db) => one(`
  select md5(string_agg(x, '|' order by x)) from (
    select 'c:' || table_name || '.' || column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default,'') x
      from information_schema.columns where table_schema='public'
    union all select 'k:' || conrelid::regclass::text || '.' || conname || ':' || pg_get_constraintdef(oid) || ':' || convalidated
      || ':' || coalesce(obj_description(oid,'pg_constraint'),'')
      from pg_constraint where connamespace='public'::regnamespace
    union all select 'i:' || indexname || ':' || indexdef from pg_indexes where schemaname='public'
    union all select 'f:' || p.oid::regprocedure::text || ':' || md5(prosrc) || ':' || coalesce(proacl::text,'') from pg_proc p where pronamespace='public'::regnamespace
    union all select 't:' || tgname || ':' || pg_get_triggerdef(oid) from pg_trigger where not tgisinternal
  ) s;`, db);
const unresolved = (db) => +one(`select count(*) from public.lease_documents d where d.tenant_id is not null and not exists (select 1 from public.tenants t where t.id=d.tenant_id);`, db);
const fkValidated = (db) => one(`select convalidated from pg_constraint where conname='lease_documents_leasehold_fk';`, db);
const clone = (name, from) => q(`create database ${name} template ${from};`, 'postgres');
const run042 = (db, text) => pg.psqlText(text || M042, db, 'm042');

// ── base database: schema, 032, 039, fixture ───────────────────────────────
const BASE = 'base042';
pg.database(BASE, 'legacy');
section('0 · fixture');
check('the file carries 53 documents, 53 expected, 53 proposed', DOC.length === 53 && EXP.length === 53 && NEW.length === 53);
check('the file carries the 38 excluded ids + the empty row', EX38.length === 38 && EXCL.includes(NULL_ROW) && EXCL.length === 39);
check('stand-in schema builds', q(SCHEMA, BASE).ok);
check('032 installs', pg.psqlText(M032, BASE, 'm032').ok);
// History first, then 039 — as on Pilot, where the unresolved values predate the link.
const fx = pg.psqlText(fixtureSql(), BASE, 'fixture');
check('fixture loads (53 approved + 38 excluded + empty row + a rule-qualifying extra)', fx.ok, fx.ok ? '' : fx.out.slice(0, 300));
check('039 applies over that history', pg.psqlText(M039, BASE, 'm039').ok);
check('fixture: 92 unresolved (53 + 38 + the extra), 1 empty', unresolved(BASE) === 92 &&
  one(`select count(*) from public.lease_documents where tenant_id is null;`, BASE) === '1', String(unresolved(BASE)));
check('fixture: the dry run\'s RULE would select 63 here (53 + 9 Miracle Mile + the extra) — 042 must take 53',
  one(`select count(*) from public.lease_documents d join public.properties p on p.id=d.property_id
        where d.tenant_id is not null and not exists (select 1 from public.tenants t where t.id=d.tenant_id) and d.file_url is not null
          and (select count(*) from public.lease_jobs j where j.property_id=d.property_id and j.file_name=d.file_name)=1
          and exists (select 1 from public.lease_jobs j join public.tenants t on t.id=j.id where j.property_id=d.property_id
                        and j.file_name=d.file_name and t.property_id=d.property_id and t.lease_url=d.file_url);`, BASE) === '63');

// ── 1 · the relink ─────────────────────────────────────────────────────────
section('1 · 042 relinks exactly the 53 approved rows');
{
  const X = 'm042'; clone(X, BASE);
  const worldTables = (db) => world(db).split(' ld=')[0];
  const before = { other: ldOther(X), stable: ld53Stable(X), tables: worldTables(X), cat: catalog(X), unres: unresolved(X),
    excl: rowsMd5(`where x.id in ${inList(EXCL)}`, X), extra: rowsMd5(`where x.id = '${EXTRA_DOC}'`, X),
    upd: one(`select string_agg(updated_at::text, ',' order by id) from public.lease_documents where id in ${inList(DOC)};`, X) };
  const r = run042(X);
  check('042 applies', r.ok, r.ok ? '' : r.out.slice(0, 400));
  check('exactly 53 rows hold a legacy_tenant_id', one(`select count(*) from public.lease_documents where legacy_tenant_id is not null;`, X) === '53');
  const pairs = DOC.map((d, i) => `('${d}'::uuid,'${EXP[i]}'::uuid,'${NEW[i]}'::uuid)`).join(',');
  check('every one of the 53: legacy_tenant_id = the audited value, tenant_id = the proposed tenant',
    one(`select count(*) from (values ${pairs}) f(doc,exp,new) join public.lease_documents ld on ld.id=f.doc where ld.legacy_tenant_id=f.exp and ld.tenant_id=f.new;`, X) === '53');
  check('all 53 now point at an existing tenant of their own property',
    one(`select count(*) from public.lease_documents ld join public.tenants t on t.id=ld.tenant_id and t.property_id=ld.property_id where ld.id in ${inList(DOC)};`, X) === '53');
  check('nothing else about the 53 changed (every other column but updated_at)', ld53Stable(X) === before.stable);
  check('updated_at moved on the 53 — the table\'s own BEFORE UPDATE trigger, not 042',
    one(`select string_agg(updated_at::text, ',' order by id) from public.lease_documents where id in ${inList(DOC)};`, X) !== before.upd);
  check('every other register row is byte-identical (all 39)', ldOther(X) === before.other);
  check('   …the 38 excluded rows and the empty row, byte-identical, no legacy value', rowsMd5(`where x.id in ${inList(EXCL)}`, X) === before.excl
    && one(`select count(*) from public.lease_documents where id in ${inList(EXCL)} and legacy_tenant_id is not null;`, X) === '0');
  check('   …the 9 Miracle Mile rows are still unresolved although the rule would have taken them',
    one(`select count(*) from public.lease_documents d where d.id in ${inList(MM)} and not exists (select 1 from public.tenants t where t.id=d.tenant_id);`, X) === '9');
  check('   …Prime Wellness (6f09adbf…) untouched', one(`select legacy_tenant_id is null and tenant_id is not null from public.lease_documents where id='6f09adbf-9700-41d0-8621-eef681d40149';`, X) === 't');
  check('   …the rule-qualifying row on no list is untouched', rowsMd5(`where x.id = '${EXTRA_DOC}'`, X) === before.extra);
  check('tenants, jobs, properties, storage, CAM, evidence, payments: byte-identical', worldTables(X) === before.tables);
  check('no DDL: the catalog is unchanged (constraint still NOT VALID, same comment)', catalog(X) === before.cat);
  check('the constraint is still NOT VALID', fkValidated(X) === 'f');
  check('unresolved rows: 92 → 39, down by exactly 53', before.unres === 92 && unresolved(X) === 39, `${before.unres} → ${unresolved(X)}`);
  const w = world(X), r2 = run042(X);
  check('re-running 042 is a no-op (all 53 already carry the relink): succeeds, nothing changes', r2.ok && world(X) === w, r2.out.slice(0, 200));
  // 3 · protection
  section('3 · after 042 a relinked leasehold is protected; its property still cascades');
  const del = q(`delete from public.tenants where id='${NEW[0]}';`, X);
  check('DELETE a relinked tenant on its own: refused by the link', !del.ok && /lease_documents_leasehold_fk/.test(del.out));
  const pdel = q(`delete from public.properties where id='${PROPS[1]}';`, X);
  check('DELETE its property: cascades tenants and documents together', pdel.ok
    && one(`select (select count(*) from public.tenants where property_id='${PROPS[1]}') + (select count(*) from public.lease_documents where property_id='${PROPS[1]}');`, X) === '0',
    pdel.ok ? '' : pdel.out.slice(0, 200));
}

// ── 2 · abort matrix ───────────────────────────────────────────────────────
section('2 · any broken precondition aborts the whole migration and changes nothing');
const i0 = 7;   // a row on a public-URL spelling (odd index)
const p0 = PROPS[i0 % PROPS.length];
const DROP_FK = `alter table public.lease_documents drop constraint lease_documents_leasehold_fk;`;
const ADD_FK  = `alter table public.lease_documents add constraint lease_documents_leasehold_fk foreign key (tenant_id, property_id) references public.tenants (id, property_id) on update no action on delete no action not valid;`;
const swapIn = (name, from, to) => M042.replace(new RegExp(`(${name} uuid\\[\\] := array\\[[\\s\\S]*?)'${from}'`), `$1'${to}'`);
const ABORTS = [
  ['a document of the 53 is missing', `delete from public.lease_documents where id='${DOC[i0]}';`, /document missing/],
  ['a current tenant_id changed since the audit', `${DROP_FK} update public.lease_documents set tenant_id=gen_random_uuid() where id='${DOC[i0]}'; ${ADD_FK}`, /current tenant_id changed/],
  ['a current tenant_id now resolves to a tenant', `insert into public.tenants(id,property_id,name) values ('${EXP[i0]}','${p0}','revived');`, /now resolves to a tenant/],
  ['a proposed tenant is missing', `delete from public.tenants where id='${NEW[i0]}';`, /proposed tenant missing/],
  ['a proposed tenant is in another property', `update public.tenants set property_id='${PX}' where id='${NEW[i0]}';`, /property mismatch/],
  ['the document\'s upload is not the tenant\'s', `update public.tenants set lease_url='leases/elsewhere.pdf' where id='${NEW[i0]}';`, /file_url is not the proposed tenant's lease_url/],
  ['the upload is held by a second tenant', `insert into public.tenants(property_id,name,lease_url) select '${p0}','twin',lease_url from public.tenants where id='${NEW[i0]}';`, /not held by exactly one tenant/],
  ['the upload is held by a second document', `insert into public.lease_documents(property_id,file_name,file_url) select '${p0}','copy.pdf',file_url from public.lease_documents where id='${DOC[i0]}';`, /not held by exactly one document/],
  ['a second job has the same file', `insert into public.lease_jobs(id,property_id,file_name) select gen_random_uuid(),property_id,file_name from public.lease_jobs where id='${NEW[i0]}';`, /not exactly one lease_jobs row/],
  ['the job is not the proposed tenant', `update public.lease_jobs set id=gen_random_uuid() where id='${NEW[i0]}';`, /job id is not the proposed tenant/],
  ['the stored object is missing', `delete from storage.objects where name='${p0}/lease-${i0 + 1}.pdf';`, /not exactly one stored object/],
  ['the target is already named by a document', `insert into public.lease_documents(property_id,tenant_id,file_name) values ('${p0}','${NEW[i0]}','other.pdf');`, /already named by a document/],
  ['a document now sits on Miracle Mile', `update public.properties set name='Miracle Mile' where id='${p0}';`, /document is on Miracle Mile/],
  ['a stray legacy value exists (the empty row)', `update public.lease_documents set legacy_tenant_id=gen_random_uuid() where id='${NULL_ROW}';`, /already hold a legacy_tenant_id/],
  ['one of the 53 was already relinked (partial state)', `update public.lease_documents set legacy_tenant_id=tenant_id, tenant_id='${NEW[0]}' where id='${DOC[0]}';`, /partial state/],
  ['039\'s constraint is missing', DROP_FK, /requires 039/],
  ['039\'s column is missing (constraint present)', `alter table public.lease_documents drop column legacy_tenant_id;`, /legacy_tenant_id is missing \(042 requires 039\)/],
  ['not Pilot (marker property absent)', `delete from public.properties where id='${PM}';`, /REFUSING TO RUN/],
];
ABORTS.forEach(([label, mut, want], k) => {
  const X = 'abort' + k; clone(X, BASE);
  const m = q(mut, X);
  if (!m.ok) { check(label + ' — (mutation did not apply: ' + m.out.slice(0, 120) + ')', false); return; }
  const w = world(X), cat = catalog(X);
  const r = run042(X);
  check(label + ': aborted, reason named', !r.ok && want.test(r.out), r.out.replace(/\s+/g, ' ').slice(0, 220));
  check('   …nothing changed', world(X) === w && catalog(X) === cat);
});
const TEXT_ABORTS = [
  ['the list is one short', M042.replace(new RegExp(`\\n\\s*'${DOC[52]}'`), '').replace(/,(\s*\]::uuid\[\];\s*\n\s*v_exp)/, '$1'), /exactly 53 triples/],
  ['the list names a target twice', swapIn('v_new', NEW[1], NEW[0]), /duplicate target tenant/],
  ['the list names a Miracle Mile document', swapIn('v_doc', DOC[2], MM[0]), /excluded document/],
  ['the list names Prime Wellness', swapIn('v_doc', DOC[3], '6f09adbf-9700-41d0-8621-eef681d40149'), /excluded document/],
];
TEXT_ABORTS.forEach(([label, text, want], k) => {
  const X = 'tabort' + k; clone(X, BASE);
  check(label + ' — (the damaged copy differs from the file)', text !== M042);
  const w = world(X);
  const r = run042(X, text);
  check(label + ': aborted, reason named', !r.ok && want.test(r.out), r.out.replace(/\s+/g, ' ').slice(0, 220));
  check('   …nothing changed', world(X) === w);
});

// ── 4 · rollback ───────────────────────────────────────────────────────────
section('4 · rollback');
{
  const X = 'rb042'; clone(X, BASE);
  const cols = (db) => one(`select md5(string_agg(md5(row(x.id,x.property_id,x.tenant_id,x.tenant_name,x.file_name,x.file_url,x.extracted_text,x.parsing_status,x.extraction_model,x.used_pdf_direct,x.created_at,x.doc_type,x.doc_family_id,x.category,x.status,x.supersedes_document_id,x.legacy_tenant_id)::text), '' order by x.id)) from public.lease_documents x;`, db);
  const beforeCols = cols(X), beforeOther = ldOther(X), beforeCat = catalog(X), beforeTables = world(X).split(' ld=')[0];
  const nop = pg.psqlText(R042, X, 'r042-noop');
  check('rollback before 042 is a no-op', nop.ok && cols(X) === beforeCols && catalog(X) === beforeCat);
  check('042 applies', run042(X).ok);
  const rb = pg.psqlText(R042, X, 'r042');
  check('rollback runs', rb.ok, rb.ok ? '' : rb.out.slice(0, 300));
  check('   …tenant_id restored and legacy_tenant_id empty on every row (all columns but updated_at)', cols(X) === beforeCols);
  check('   …no other row touched', ldOther(X) === beforeOther);
  check('   …constraint re-added identically: definition, NOT VALID, comment — catalog equals the pre-042 catalog', catalog(X) === beforeCat);
  check('   …no other table touched', world(X).split(' ld=')[0] === beforeTables);
  check('   …92 unresolved again', unresolved(X) === 92);
  check('042 applies again after the rollback', run042(X).ok && one(`select count(*) from public.lease_documents where legacy_tenant_id is not null;`, X) === '53');
  // refused once one of the 53 moved on
  const Y = 'rb042b'; clone(Y, X);
  q(`update public.lease_documents set tenant_id=null where id='${DOC[4]}';`, Y);
  let w = world(Y);
  const ref1 = pg.psqlText(R042, Y, 'r042-refused');
  check('rollback REFUSED when one of the 53 no longer carries 042\'s relink', !ref1.ok && /no longer carry exactly/.test(ref1.out), ref1.out.slice(0, 200));
  check('   …and changed nothing', world(Y) === w);
  const Z = 'rb042c'; clone(Z, X);
  q(`update public.lease_documents set legacy_tenant_id=gen_random_uuid() where id='${NULL_ROW}';`, Z);
  w = world(Z);
  const ref2 = pg.psqlText(R042, Z, 'r042-refused2');
  check('rollback REFUSED when a legacy value exists outside the 53', !ref2.ok && /not 042's 53/.test(ref2.out), ref2.out.slice(0, 200));
  check('   …and changed nothing', world(Z) === w);
}

// ── 5 · static ─────────────────────────────────────────────────────────────
section('5 · static');
{
  const noComments = (s) => s.replace(/^\s*--.*$/gm, '');
  const canon = (d, e, n) => d.map((x, i) => `${x} ${e[i]} ${n[i]}`).join('\n');
  check('042\'s 53 triples are, in order, the approved dry-run list (sha256 ' + APPROVED_SHA.slice(0, 12) + '…)', sha(canon(DOC, EXP, NEW)) === APPROVED_SHA, sha(canon(DOC, EXP, NEW)));
  check('the rollback carries the identical triples', canon(arrayOf(R042, 'v_doc'), arrayOf(R042, 'v_exp'), arrayOf(R042, 'v_new')) === canon(DOC, EXP, NEW));
  check('the excluded list is the audit\'s 38 (sha256 ' + EXCLUDED_SHA.slice(0, 12) + '…) + the empty row', sha(EX38.join('\n')) === EXCLUDED_SHA && EXCL[38] === NULL_ROW);
  check('53 distinct documents, 53 distinct targets, no overlap with the excluded', new Set(DOC).size === 53 && new Set(NEW).size === 53 && !DOC.some(d => EXCL.includes(d)));
  const body = noComments(M042);
  check('the only write is one UPDATE of public.lease_documents', (body.match(/\bupdate\s+public\.\w+/gi) || []).join() === 'update public.lease_documents'
    && !/\binsert\s+into\b|\bdelete\s+from\b|\btruncate\b/i.test(body));
  check('042 sets exactly legacy_tenant_id and tenant_id', /set legacy_tenant_id = ld\.tenant_id,\s*tenant_id\s*= f\.new\s*from/.test(body));
  check('042 has no DDL (no ALTER / CREATE / DROP / COMMENT)', !/\b(alter|create|drop)\s+(table|constraint|function|index|trigger|policy|view)\b|\bcomment\s+on\b/i.test(body));
  check('no VALIDATE CONSTRAINT anywhere', !/validate\s+constraint/i.test(noComments(M042) + noComments(R042)));
  check('no acquisition table, policy or grant is named', !/acquisition_|\bpolicy\b|\bgrant\b|\brevoke\b/i.test(body));
  check('no rule, name or blob selects a row (the relink joins only its fixed list)', /from unnest\(v_doc, v_exp, v_new\) as f\(doc, exp, new\)\s*where ld\.id = f\.doc/.test(body));
  check('guarded by the Pilot marker property (both files)', M042.includes(PM) && R042.includes(PM));
  check('says nothing of XRPL / wallets / payments settlement', !/xrpl|wallet|rlusd/i.test(noComments(M042) + noComments(R042)));
}

T.finish();
