'use strict';
/**
 * tools/verify-migration-037.js — run 037 (the leasehold lifecycle columns) for
 * real, against nothing that matters.
 *
 *   node tools/verify-migration-037.js
 *
 * It touches NO Supabase project. It builds a throwaway PostgreSQL cluster and a
 * stand-in public.tenants with Pilot's eleven columns in Pilot's order, its keys
 * (tenants_pkey, tenants_id_property_uniq, the property FK ON DELETE CASCADE),
 * its index, its 033 trigger, its row-level security and policies and its table
 * grants — plus lease_documents with 039's leasehold link, cam_reconciliations
 * and tenant_field_evidence, so the rows that other tables point at are there.
 * It loads tenants of every shape Pilot holds (past, future and absent dates, a
 * linked one, a CAM-referenced one) and applies 037.
 *
 * WHAT IT PROVES
 *
 *   1  037 applies, and applies again with no change
 *   2  EXACT INVENTORY: three columns, typed and defaulted as agreed, after the
 *      existing eleven; three constraints, exactly as agreed, validated; three
 *      comments; and NOTHING ELSE in the catalog changed — no column, constraint,
 *      index, trigger, function, policy, grant or RLS flag
 *   3  DATA: every existing tenant reads active / null / null; every one of the
 *      eleven existing columns of every row is byte-identical; no ended_at was
 *      derived from end_date (a lease past its end_date is still active with a
 *      null ended_at); updated_at did not move
 *   4  THE RULES: the five reasons and nothing else (`assigned` refused);
 *      active ⇒ both end fields null; ended ⇒ both set; the status vocabulary
 *      is exactly active | ended; ended_at may be later than end_date (holdover)
 *      and earlier than start_date (no date-order rule)
 *   5  TODAY'S WRITERS ARE UNAFFECTED: a resync-style upsert of named columns
 *      leaves the lifecycle alone (an ended row stays ended), an Acquire-style
 *      insert is active, the property cascade still deletes, and 039's link
 *      still refuses deleting a linked tenant on its own
 *   6  RLS: an owner reads the new columns through the unchanged policies, a
 *      stranger reads nothing
 *   7  ROLLBACK is refused while any leasehold is ended and while any function
 *      reads leasehold_status; otherwise it restores the pre-037 catalog exactly,
 *      writes no row, and 037 applies again after it
 *   8  STATIC: outside comments the file writes no row, reads no end_date,
 *      creates no policy/grant/FK/trigger/function/index, lists exactly the five
 *      reasons, names the column leasehold_status (never plain `status`) and is
 *      guarded by Pilot's marker
 *
 * SKIPS (exit 0) when no local PostgreSQL server binary is present, and says so
 * loudly — a skip is not a pass and must not read like one.
 */
const fs = require('fs');
const path = require('path');
const { startCluster, tally } = require('./_pg-throwaway');

const ROOT = path.join(__dirname, '..');
const MIG  = path.join(ROOT, 'migrations');
const M037 = fs.readFileSync(path.join(MIG, '037_leasehold_lifecycle.sql'), 'utf8');
const R037 = fs.readFileSync(path.join(MIG, '037_leasehold_lifecycle_rollback.sql'), 'utf8');

const REASONS = ['lease_expired', 'terminated_early', 'surrendered', 'evicted', 'other'];

const T = tally();
const { check, section } = T;

console.log('\n══ migration 037 — executed against a throwaway cluster ══');
console.log('   NO Supabase project is contacted by this script.');
const pg = startCluster('037');
console.log('   postgres: ' + pg.PGBIN);

const A  = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222';
const PM = 'fd9c09b1-b657-4c58-9999-c3cce28e7600';                 // Pilot marker property
const P1 = 'aaaaaaaa-0000-4000-8000-000000000001', P2 = 'aaaaaaaa-0000-4000-8000-000000000002';
const TID = (n) => `dddddddd-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;

// Pilot's tenants, column for column and in order (information_schema, 2026-09-30).
const SCHEMA = `
  insert into auth.users(id) values ('${A}'),('${B}');
  create table public.properties (
    id uuid primary key default gen_random_uuid(),
    user_id uuid references auth.users(id) on delete cascade,
    name text, lifecycle_stage text not null default 'acquired');
  create table public.tenants (
    id          uuid not null default gen_random_uuid(),
    property_id uuid,
    name        text,
    sqft        numeric,
    cap         numeric,
    start_date  date,
    end_date    date,
    lease_url   text,
    lease_type  text,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now(),
    constraint tenants_pkey primary key (id),
    constraint tenants_id_property_uniq unique (id, property_id),
    constraint tenants_property_id_fkey foreign key (property_id) references public.properties(id) on delete cascade);
  create index tenants_property_id_idx on public.tenants using btree (property_id);
  -- 033's trigger, verbatim body
  create function public.tenants_property_immutable() returns trigger language plpgsql as $f$
  begin
    if new.property_id is distinct from old.property_id then
      raise exception 'tenants.property_id is immutable: tenant % belongs to property % and cannot be moved to %',
        old.id, coalesce(old.property_id::text, '<none>'), coalesce(new.property_id::text, '<none>')
        using errcode = 'integrity_constraint_violation',
              hint    = 'A tenant is created for one property. There is no move operation.';
    end if;
    return new;
  end;
  $f$;
  create trigger tenants_property_immutable before update of property_id on public.tenants
    for each row execute function public.tenants_property_immutable();
  create table public.lease_documents (
    id uuid primary key default gen_random_uuid(),
    property_id uuid not null references public.properties(id) on delete cascade,
    tenant_id uuid, file_name text not null, legacy_tenant_id uuid,
    constraint lease_documents_leasehold_fk foreign key (tenant_id, property_id)
      references public.tenants (id, property_id) on update no action on delete no action not valid);
  create table public.cam_reconciliations (id uuid primary key default gen_random_uuid(),
    property_id uuid not null references public.properties(id) on delete cascade, tenant_id uuid, year integer not null);
  create table public.tenant_field_evidence (id uuid primary key default gen_random_uuid(),
    property_id uuid not null references public.properties(id) on delete cascade, tenant_id text not null, field_key text not null);
  -- Row-level security and policies of the same shape as Pilot's
  alter table public.tenants enable row level security;
  create policy tenants_owner_all on public.tenants for all to authenticated
    using (property_id in (select id from public.properties where user_id = auth.uid()))
    with check (property_id in (select id from public.properties where user_id = auth.uid()));
  create policy tenants_service_role_all on public.tenants for all to service_role using (true) with check (true);
  grant select, insert, update, delete, references, trigger, truncate on public.tenants to anon, authenticated, service_role;
  grant select on public.properties to authenticated, service_role;`;

const FIXTURES = `
  insert into public.properties(id,user_id,name) values
    ('${PM}','${A}','V3 (pilot marker)'), ('${P1}','${A}','Owned by A'), ('${P2}','${B}','Owned by B');
  insert into public.tenants(id,property_id,name,sqft,cap,start_date,end_date,lease_url,lease_type,created_at,updated_at) values
    ('${TID(1)}','${P1}','Past end date',   1200, 5,   '2015-01-01','2020-12-31','leases/p1/a.pdf','NNN','2024-01-01','2024-02-01'),
    ('${TID(2)}','${P1}','Future end date', 3400, null,'2022-03-01','2031-02-28',null,'Gross','2024-01-02','2024-02-02'),
    ('${TID(3)}','${P1}','No dates',        null, null, null, null, null, null,'2024-01-03','2024-02-03'),
    ('${TID(4)}','${P1}','Linked leasehold', 800, 4,   '2019-06-01','2024-05-31','leases/p1/d.pdf','NNN','2024-01-04','2024-02-04'),
    ('${TID(5)}','${P2}','CAM-referenced',  2000, 3,   '2018-01-01','2023-12-31',null,'NNN','2024-01-05','2024-02-05'),
    ('${TID(6)}','${PM}','Marker tenant',    500, null,'2021-01-01', null, null, null,'2024-01-06','2024-02-06');
  insert into public.lease_documents(property_id,tenant_id,file_name) values ('${P1}','${TID(4)}','d.pdf');
  insert into public.cam_reconciliations(property_id,tenant_id,year) values ('${P2}','${TID(5)}',2024);
  insert into public.tenant_field_evidence(property_id,tenant_id,field_key) values ('${P1}','${TID(1)}','cap');`;

const q   = (sql, db) => pg.psql(sql, db);
const one = (sql, db) => q(sql, db).out;
const ORIG_COLS = 'id,property_id,name,sqft,cap,start_date,end_date,lease_url,lease_type,created_at,updated_at';
const origRows = (db) => one(`select md5(string_agg(md5(row(${ORIG_COLS})::text), '' order by id)) from public.tenants;`, db);
const NEW_COLS = ['leasehold_status', 'ended_at', 'ended_reason'];
const NEW_CONS = ['tenants_leasehold_status_chk', 'tenants_ended_consistency_chk', 'tenants_ended_reason_chk'];
// The whole public catalog, optionally without 037's own objects, so "nothing
// else changed" is a comparison and not a list of things somebody remembered.
const catalog = (db, exclude037) => {
  const nc = exclude037 ? `and column_name not in (${NEW_COLS.map(c => `'${c}'`).join(',')})` : '';
  const nk = exclude037 ? `and conname not in (${NEW_CONS.map(c => `'${c}'`).join(',')})` : '';
  return one(`
  select md5(string_agg(x, '|' order by x)) from (
    select 'c:' || table_name || '.' || column_name || ':' || ordinal_position || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default,'') x
      from information_schema.columns where table_schema='public' ${nc}
    union all select 'd:' || c.relname || '.' || a.attname || ':' || coalesce(col_description(c.oid, a.attnum),'')
      from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and a.attnum>0 and not a.attisdropped ${exclude037 ? `and a.attname not in (${NEW_COLS.map(c => `'${c}'`).join(',')})` : ''}
    union all select 'k:' || conrelid::regclass::text || '.' || conname || ':' || pg_get_constraintdef(oid) || ':' || convalidated
      from pg_constraint where connamespace='public'::regnamespace ${nk}
    union all select 'i:' || indexname || ':' || indexdef from pg_indexes where schemaname='public'
    union all select 't:' || tgname || ':' || pg_get_triggerdef(oid) from pg_trigger where not tgisinternal
    union all select 'f:' || p.oid::regprocedure::text || ':' || md5(prosrc) || ':' || coalesce(proacl::text,'') from pg_proc p where pronamespace='public'::regnamespace
    union all select 'g:' || table_name || ':' || grantee || ':' || privilege_type from information_schema.role_table_grants where table_schema='public'
    union all select 'p:' || tablename || '.' || policyname || ':' || cmd || ':' || roles::text || ':' || coalesce(qual,'') || ':' || coalesce(with_check,'') from pg_policies where schemaname='public'
    union all select 'r:' || relname || ':' || relrowsecurity || ':' || relforcerowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'
  ) s;`, db);
};
const conErr = (r, name) => !r.ok && new RegExp('violates check constraint "' + name + '"').test(r.out);
const notNullErr = (r) => !r.ok && /null value in column "leasehold_status"/.test(r.out);
const setRow = (db, id, sets) => q(`update public.tenants set ${sets} where id='${id}';`, db);
const build = (db) => { pg.database(db, 'legacy'); q(SCHEMA, db); q(FIXTURES, db); };

// ── 1 · apply ────────────────────────────────────────────────────────────────
section('1 · 037 applies, and again');
const DB = 'm037';
pg.database(DB, 'legacy');
check('stand-in schema builds', q(SCHEMA, DB).ok);
check('fixtures load (6 tenants of every shape, a linked one, a CAM-referenced one)', q(FIXTURES, DB).ok);
const before = { rows: origRows(DB), cat: catalog(DB, false), n: one(`select count(*) from public.tenants;`, DB) };
const r1 = pg.psqlText(M037, DB, 'm037');
check('037 applies', r1.ok, r1.ok ? '' : r1.out.slice(0, 300));
const catAfter = catalog(DB, false);
const r2 = pg.psqlText(M037, DB, 'm037-again');
check('037 applies again (re-runnable)', r2.ok, r2.ok ? '' : r2.out.slice(0, 300));
check('the second apply changes nothing', catalog(DB, false) === catAfter);

// ── 2 · exact inventory ─────────────────────────────────────────────────────
section('2 · exact inventory');
const cols = one(`select string_agg(column_name||':'||ordinal_position||':'||data_type||':'||is_nullable||':'||coalesce(column_default,'<none>'), ' | ' order by ordinal_position)
  from information_schema.columns where table_schema='public' and table_name='tenants' and ordinal_position > 11;`, DB);
check('leasehold_status: text, NOT NULL, default \'active\' (position 12)', cols.split(' | ')[0] === "leasehold_status:12:text:NO:'active'::text", cols);
check('ended_at: date, nullable, no default (position 13)', cols.split(' | ')[1] === 'ended_at:13:date:YES:<none>');
check('ended_reason: text, nullable, no default (position 14)', cols.split(' | ')[2] === 'ended_reason:14:text:YES:<none>');
check('exactly three columns were added (14 in all)', one(`select count(*) from information_schema.columns where table_schema='public' and table_name='tenants';`, DB) === '14');
const con = (n) => one(`select pg_get_constraintdef(oid)||' | validated='||convalidated from pg_constraint where conrelid='public.tenants'::regclass and conname='${n}';`, DB);
check('tenants_leasehold_status_chk = active | ended, validated',
  con('tenants_leasehold_status_chk') === "CHECK ((leasehold_status = ANY (ARRAY['active'::text, 'ended'::text]))) | validated=true", con('tenants_leasehold_status_chk'));
check('tenants_ended_consistency_chk = active ⇒ both null, ended ⇒ both set, validated',
  con('tenants_ended_consistency_chk') === "CHECK ((((leasehold_status = 'active'::text) AND (ended_at IS NULL) AND (ended_reason IS NULL)) OR ((leasehold_status = 'ended'::text) AND (ended_at IS NOT NULL) AND (ended_reason IS NOT NULL)))) | validated=true",
  con('tenants_ended_consistency_chk'));
check('tenants_ended_reason_chk = the five reasons, validated',
  con('tenants_ended_reason_chk') === "CHECK (((ended_reason IS NULL) OR (ended_reason = ANY (ARRAY['lease_expired'::text, 'terminated_early'::text, 'surrendered'::text, 'evicted'::text, 'other'::text])))) | validated=true",
  con('tenants_ended_reason_chk'));
check('exactly three constraints were added (6 on tenants in all)',
  one(`select count(*) from pg_constraint where conrelid='public.tenants'::regclass;`, DB) === '6');
check('each new column carries its comment',
  one(`select count(*) from pg_attribute where attrelid='public.tenants'::regclass and attname in ('leasehold_status','ended_at','ended_reason') and col_description(attrelid, attnum) is not null;`, DB) === '3');
check('NOTHING ELSE in the catalog changed (columns, comments, constraints, indexes, triggers, functions, grants, policies, RLS)',
  catalog(DB, true) === before.cat);

// ── 3 · data ────────────────────────────────────────────────────────────────
section('3 · data');
check('every existing tenant is still there', one(`select count(*) from public.tenants;`, DB) === before.n);
check('every one of the eleven existing columns of every row is byte-identical (updated_at included)', origRows(DB) === before.rows);
check('every existing tenant reads active / null / null',
  one(`select count(*) from public.tenants where leasehold_status='active' and ended_at is null and ended_reason is null;`, DB) === before.n);
check('no ended_at was derived from end_date: a lease past its end_date is active with ended_at null',
  one(`select leasehold_status||'/'||coalesce(ended_at::text,'null')||'/'||end_date from public.tenants where id='${TID(1)}';`, DB) === 'active/null/2020-12-31');
check('zero ended rows, zero ended_at, zero ended_reason',
  one(`select count(*) filter (where leasehold_status='ended')||'/'||count(ended_at)||'/'||count(ended_reason) from public.tenants;`, DB) === '0/0/0');

// ── 4 · the rules ───────────────────────────────────────────────────────────
section('4 · the lifecycle rules');
check('an insert that names no lifecycle field reads active / null / null',
  q(`insert into public.tenants(id,property_id,name) values ('${TID(20)}','${P1}','New');`, DB).ok
  && one(`select leasehold_status||'/'||coalesce(ended_at::text,'null')||'/'||coalesce(ended_reason,'null') from public.tenants where id='${TID(20)}';`, DB) === 'active/null/null');
REASONS.forEach((r, i) => {
  check(`ended with reason ${r}: accepted`,
    setRow(DB, TID(20), `leasehold_status='ended', ended_at='2025-0${i + 1}-15', ended_reason='${r}'`).ok);
});
check('reason `assigned` refused — an assignment does not end a leasehold',
  conErr(setRow(DB, TID(20), `ended_reason='assigned'`), 'tenants_ended_reason_chk'));
['expired', 'Lease_Expired', 'terminated', '', 'holdover'].forEach(r => {
  check(`reason '${r}' refused`, conErr(setRow(DB, TID(20), `ended_reason='${r}'`), 'tenants_ended_reason_chk'));
});
check('ended without ended_at: refused',
  conErr(setRow(DB, TID(20), `ended_at=null`), 'tenants_ended_consistency_chk'));
check('ended without a reason: refused',
  conErr(setRow(DB, TID(20), `ended_reason=null`), 'tenants_ended_consistency_chk'));
check('back to active while keeping ended_at: refused',
  conErr(setRow(DB, TID(20), `leasehold_status='active', ended_reason=null`), 'tenants_ended_consistency_chk'));
check('back to active while keeping a reason: refused',
  conErr(setRow(DB, TID(20), `leasehold_status='active', ended_at=null`), 'tenants_ended_consistency_chk'));
check('back to active with both cleared: accepted',
  setRow(DB, TID(20), `leasehold_status='active', ended_at=null, ended_reason=null`).ok);
check('active with an ended_at: refused', conErr(setRow(DB, TID(20), `ended_at='2025-01-01'`), 'tenants_ended_consistency_chk'));
check('active with a reason: refused', conErr(setRow(DB, TID(20), `ended_reason='other'`), 'tenants_ended_consistency_chk'));
// Any value but active/ended fails BOTH checks; PostgreSQL reports the first by
// name (tenants_ended_consistency_chk), so either name is a correct refusal.
const statusErr = (r) => conErr(r, 'tenants_leasehold_status_chk') || conErr(r, 'tenants_ended_consistency_chk');
['inactive', 'ENDED', 'Active', '', 'vacant', 'terminated'].forEach(s => {
  check(`leasehold_status '${s}' refused`, statusErr(setRow(DB, TID(20), `leasehold_status='${s}'`)));
  check(`   …also with an ended_at and a reason set`, statusErr(setRow(DB, TID(20), `leasehold_status='${s}', ended_at='2025-01-01', ended_reason='other'`)));
});
check('leasehold_status null refused', notNullErr(setRow(DB, TID(20), `leasehold_status=null`)));
check('a holdover: ended_at LATER than end_date is accepted',
  setRow(DB, TID(1), `leasehold_status='ended', ended_at='2022-06-30', ended_reason='lease_expired'`).ok);
check('ended_at earlier than start_date is accepted (no date-order rule)',
  setRow(DB, TID(2), `leasehold_status='ended', ended_at='2020-01-01', ended_reason='other'`).ok);
check('   …test hygiene: both back to active', setRow(DB, TID(1), `leasehold_status='active', ended_at=null, ended_reason=null`).ok
  && setRow(DB, TID(2), `leasehold_status='active', ended_at=null, ended_reason=null`).ok);

// ── 5 · today's writers ─────────────────────────────────────────────────────
section('5 · today\'s writers are unaffected');
{
  q(`update public.tenants set leasehold_status='ended', ended_at='2023-12-31', ended_reason='surrendered' where id='${TID(5)}';`, DB);
  // resync_property_tenants / the direct fallback / acquire_property name their columns
  const up = q(`insert into public.tenants (id, property_id, name, sqft, cap, start_date, end_date, lease_url, lease_type)
                values ('${TID(5)}','${P2}','CAM-referenced (renamed)',2100,3,'2018-01-01','2023-12-31',null,'NNN')
                on conflict (id) do update set name=excluded.name, sqft=excluded.sqft, cap=excluded.cap,
                  start_date=excluded.start_date, end_date=excluded.end_date, lease_url=excluded.lease_url, lease_type=excluded.lease_type
                where tenants.property_id='${P2}';`, DB);
  check('a named-column upsert (the resync\'s shape) works', up.ok, up.ok ? '' : up.out.slice(0, 200));
  check('   …and leaves the lifecycle alone: the ended row is still ended',
    one(`select leasehold_status||'/'||ended_at||'/'||ended_reason||'/'||name from public.tenants where id='${TID(5)}';`, DB) === 'ended/2023-12-31/surrendered/CAM-referenced (renamed)');
  q(`update public.tenants set leasehold_status='active', ended_at=null, ended_reason=null, name='CAM-referenced', sqft=2000 where id='${TID(5)}';`, DB);
  check('an Acquire-style insert of named columns is active',
    q(`insert into public.tenants (id, property_id, name, sqft) values ('${TID(21)}','${P1}','Acquired',900);`, DB).ok
    && one(`select leasehold_status from public.tenants where id='${TID(21)}';`, DB) === 'active');
  check('039\'s link still refuses deleting a linked tenant on its own',
    /lease_documents_leasehold_fk/.test(q(`delete from public.tenants where id='${TID(4)}';`, DB).out));
  check('033\'s immutability trigger still refuses moving a tenant',
    /tenants\.property_id is immutable/.test(q(`update public.tenants set property_id='${P2}' where id='${TID(2)}';`, DB).out));
  const X = 'm037cascade'; build(X); pg.psqlText(M037, X, 'm037');
  const del = q(`delete from public.properties where id='${P1}';`, X);
  check('deleting a property still cascades its tenants and documents', del.ok
    && one(`select (select count(*) from public.tenants where property_id='${P1}') + (select count(*) from public.lease_documents where property_id='${P1}');`, X) === '0',
    del.ok ? '' : del.out.slice(0, 200));
}

// ── 6 · RLS ─────────────────────────────────────────────────────────────────
section('6 · row-level security unchanged');
{
  const own = pg.as('authenticated', A, `select count(*)||'/'||count(*) filter (where leasehold_status='active') from public.tenants;`, DB);
  check('the owner reads the new column through the unchanged policies', own.ok && /^\d+\/\d+$/.test(own.out) && own.out.split('/')[0] === own.out.split('/')[1]
    && own.out.split('/')[0] !== '0', own.out);
  const str = pg.as('authenticated', '33333333-3333-4333-8333-333333333333', `select count(*) from public.tenants;`, DB);
  check('a stranger reads nothing', str.ok && str.out === '0', str.out);
}

// ── 7 · rollback ────────────────────────────────────────────────────────────
section('7 · rollback');
{
  const X = 'm037rb'; build(X);
  const catPre = catalog(X, false), rowsPre = origRows(X);
  check('037 applies', pg.psqlText(M037, X, 'm037').ok);
  setRow(X, TID(3), `leasehold_status='ended', ended_at='2025-03-31', ended_reason='terminated_early'`);
  const ref1 = pg.psqlText(R037, X, 'r037-refused');
  check('rollback REFUSED while a leasehold is ended', !ref1.ok && /037 rollback refused: 1 leasehold/.test(ref1.out), ref1.out.slice(0, 200));
  check('   …and changed nothing', one(`select leasehold_status from public.tenants where id='${TID(3)}';`, X) === 'ended');
  setRow(X, TID(3), `leasehold_status='active', ended_at=null, ended_reason=null`);
  q(`create function public._reads_lifecycle() returns bigint language sql as $f$ select count(*) from public.tenants where leasehold_status='ended' $f$;`, X);
  const ref2 = pg.psqlText(R037, X, 'r037-refused2');
  check('rollback REFUSED while a function reads leasehold_status', !ref2.ok && /function\(s\) in public read leasehold_status/.test(ref2.out), ref2.out.slice(0, 200));
  q(`drop function public._reads_lifecycle();`, X);
  const rb = pg.psqlText(R037, X, 'r037');
  check('rollback runs', rb.ok, rb.ok ? '' : rb.out.slice(0, 300));
  check('   …the catalog equals the pre-037 catalog exactly', catalog(X, false) === catPre);
  check('   …no row written: every existing column byte-identical', origRows(X) === rowsPre);
  check('037 applies again after the rollback', pg.psqlText(M037, X, 'm037-again').ok
    && one(`select count(*) from public.tenants where leasehold_status='active';`, X) === '6');
}

// ── 8 · static ──────────────────────────────────────────────────────────────
section('8 · static');
{
  // Comments out: `--` lines, and each `comment on column … is '…';` statement
  // up to its terminating `';` at end of line (the text itself contains a `;`).
  const code = (s) => s.replace(/^\s*--.*$/gm, '').replace(/comment on column[\s\S]*?';\s*$/gim, '');
  const c = code(M037);
  check('no INSERT / UPDATE / DELETE', !/\b(insert\s+into|update\s+public\.|delete\s+from)\b/i.test(c));
  check('end_date is read nowhere — nothing is inferred from it', !/\bend_date\b/i.test(c));
  check('no policy, grant, revoke, FK, trigger, function or index is created',
    !/\b(policy|grant|revoke|references|create\s+(or\s+replace\s+)?(trigger|function|index))\b/i.test(c));
  check('exactly the five reasons, in order, and no `assigned`',
    (c.match(/ended_reason in \(([^)]*)\)/) || [])[1] === "'lease_expired', 'terminated_early', 'surrendered', 'evicted', 'other'"
    && !/assign/i.test(c));
  check('the column is leasehold_status — no plain `status` column is added',
    /add column if not exists leasehold_status text not null default 'active'/.test(c) && !/add column (if not exists )?status\b/i.test(c));
  check('the rollback touches only 037\'s objects',
    (code(R037).match(/drop (constraint|column) if exists (\w+)/g) || []).map(s => s.split(' ').pop()).sort().join()
      === [...NEW_CONS, ...NEW_COLS].sort().join());
  check('guarded by the Pilot marker property (both files)', M037.includes(PM) && R037.includes(PM));
  check('says nothing of XRPL / wallets / payments settlement', !/xrpl|wallet|rlusd/i.test(code(M037) + code(R037)));
}

T.finish();
