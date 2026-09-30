'use strict';
/**
 * tools/verify-migration-038.js — run 038 (leasehold protection) for real,
 * against nothing that matters.
 *
 *   node tools/verify-migration-038.js
 *
 * It touches NO Supabase project. It builds a throwaway PostgreSQL cluster
 * under the 'legacy' default-privilege model (the one Pilot was built under),
 * stands up every table 038 reads or guards — properties, members, tenants,
 * cam_reconciliations, lease_provisions, tenant_review_audit, lease_documents,
 * tenant_field_evidence, payments, the five portal tables, lease_jobs,
 * property_events (with Pilot's append-only and stamp triggers) — with Pilot's
 * foreign keys and Pilot's tenants_owner_all policy, applies the REAL 037 and
 * 039 files (so the resync installed is Pilot's live body, md5-checked), and
 * then applies 038.
 *
 * WHAT IT PROVES
 *
 *   1  APPLY: the 039 body installed is Pilot's live body; 038 applies, applies
 *      again, and the second apply changes nothing; applying it writes no row
 *      (every table fingerprinted before and after)
 *   2  EXACT INVENTORY: two triggers and five functions added, the resync body
 *      replaced, grants as stated; no table, column, constraint, index or
 *      policy changed
 *   3  RESYNC NEVER DELETES: the gap proven first on 039 (a roster missing an
 *      unreferenced leasehold deletes it), then closed on 038 for the client's
 *      real roster shapes (Remove, Clear All then one upload, the extraction
 *      filter); absent active rows are reported and byte-identical; an ended
 *      leasehold in the roster is not written and is reported; 032/039 rules
 *      still hold; a roster row carrying lifecycle fields changes nothing
 *   4  NO DIRECT DELETE, FOR ANY ROLE: owner, member, service role and the
 *      table owner are refused, referenced or not, one row or many; the
 *      gap proven first on 039; the whole-PROPERTY delete still cascades
 *      (tenants, documents, evidence, events, CAM, portal rows, jobs)
 *   5  LIFECYCLE ONLY THROUGH THE FUNCTIONS: direct status / ended_at /
 *      ended_reason changes refused for every role; an ended row cannot be
 *      inserted; a no-op naming the columns passes; other columns still edit;
 *      the resync's and acquire_property's insert shapes still work
 *   6  end_leasehold: every refusal (auth, member, stranger, anon, service
 *      role without a user, unknown id, prospect, already ended, no date,
 *      bad reason incl. 'assigned'); holdover and early endings; the event
 *   7  reactivate_leasehold: note required, ended only, clears the end, keeps
 *      the previous end in the event; the resync may write it again
 *   8  discard_leasehold: refused and NAMED for each blocker (CAM, provision,
 *      review audit, payment, each of the five portal tables, a history
 *      event, each kind of person-reviewed evidence); reviewed_at alone is NOT
 *      a blocker; refused for an ended leasehold, without a note, for a
 *      non-owner; on success the documents are kept and unlinked
 *      (legacy_tenant_id untouched), unreviewed evidence removed, other rows
 *      untouched, the id preserved in the event snapshot; the flag does not
 *      leak to a second delete
 *   9  ROLLBACK restores 039's body byte for byte, drops everything 038 added,
 *      writes no row; the catalog equals the pre-038 catalog; 038 applies
 *      again after it
 *  10  STATIC: no row written outside function bodies; no policy, table or
 *      column DDL; legacy_tenant_id never named; set_config only for the two
 *      flags; no 'assigned' reason; ended_at never taken from end_date; the
 *      Pilot marker guards both files
 *
 * WHAT IT CANNOT PROVE HERE: that the API cannot set the two flags. psql can
 * call set_config; PostgREST exposes only the public schema, and set_config
 * lives in pg_catalog. Section 10 checks that no public function wraps it.
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
const M037 = fs.readFileSync(path.join(MIG, '037_leasehold_lifecycle.sql'), 'utf8');
const M039 = fs.readFileSync(path.join(MIG, '039_register_leasehold_link.sql'), 'utf8');
const M038 = fs.readFileSync(path.join(MIG, '038_leasehold_protection.sql'), 'utf8');
const R038 = fs.readFileSync(path.join(MIG, '038_leasehold_protection_rollback.sql'), 'utf8');

const LIVE_039_MD5 = 'dd78274653e12e5a7cdfbf3024bd4a7e';   // Pilot prosrc, read 2026-09-30
const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');
const resyncBody = (s) => { const a = s.indexOf('create or replace function public.resync_property_tenants('); const i = s.indexOf('as $$', a); return s.slice(i + 5, s.indexOf('$$;', i)); };
const BODY_038_MD5 = md5(resyncBody(M038));

const T = tally();
const { check, section } = T;

console.log('\n══ migration 038 — executed against a throwaway cluster ══');
console.log('   NO Supabase project is contacted by this script.');
const pg = startCluster('038');
console.log('   postgres: ' + pg.PGBIN);

// ── ids ──────────────────────────────────────────────────────────────────────
const A = '11111111-1111-4111-8111-111111111111';   // owner of PM, P1, P2, P3
const B = '22222222-2222-4222-8222-222222222222';   // owner of P4
const M = '33333333-3333-4333-8333-333333333333';   // a MEMBER of P1, not its owner
const PM = 'fd9c09b1-b657-4c58-9999-c3cce28e7600';                   // Pilot marker property
const P1 = 'aaaaaaaa-0000-4000-8000-000000000001', P2 = 'aaaaaaaa-0000-4000-8000-000000000002';
const P3 = 'aaaaaaaa-0000-4000-8000-000000000003', P4 = 'bbbbbbbb-0000-4000-8000-000000000004';
const t = (n) => 'dddddddd-0000-4000-8000-' + String(n).padStart(12, '0');
const U1 = t(1), U2 = t(2), U3 = t(3), U4 = t(4), U5 = t(5), U6 = t(6), U7 = t(7), U8 = t(8), U9 = t(9);
const X1 = t(41);                                      // on P2
const Y1 = t(51);                                      // on P4 (B)
const D1 = 'f0000000-0000-4000-8000-000000000001', D2 = 'f0000000-0000-4000-8000-000000000002';

const SCHEMA = `
  insert into auth.users(id,email) values ('${A}','a@example.test'),('${B}','b@example.test'),('${M}','m@example.test');
  create table public.properties (
    id uuid primary key default gen_random_uuid(),
    user_id uuid references auth.users(id) on delete cascade,
    organization_id uuid, name text, archived_at timestamptz,
    lifecycle_stage text not null default 'acquired'
      check (lifecycle_stage in ('prospect','under_review','due_diligence','acquired','passed')));
  create table public.property_members (property_id uuid references public.properties(id) on delete cascade, user_id uuid, primary key (property_id, user_id));
  create function public.member_property_ids() returns setof uuid language sql stable security definer set search_path = public as $f$
    select id from public.properties where user_id = auth.uid()
    union select property_id from public.property_members where user_id = auth.uid() $f$;
  create table public.tenants (
    id uuid primary key default gen_random_uuid(),
    property_id uuid references public.properties(id) on delete cascade,
    name text, sqft numeric, cap numeric, start_date date, end_date date, lease_url text, lease_type text,
    created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
    constraint tenants_id_property_uniq unique (id, property_id));
  create function public.tenants_property_immutable() returns trigger language plpgsql as $f$
  begin
    if new.property_id is distinct from old.property_id then
      raise exception 'tenants.property_id is immutable' using errcode = 'integrity_constraint_violation';
    end if;
    return new;
  end; $f$;
  create trigger tenants_property_immutable before update of property_id on public.tenants for each row execute function public.tenants_property_immutable();
  create table public.cam_reconciliations (id uuid primary key default gen_random_uuid(),
    property_id uuid not null references public.properties(id) on delete cascade, tenant_id uuid, year integer not null default 2025);
  create table public.lease_provisions (id uuid primary key default gen_random_uuid(),
    property_id uuid not null references public.properties(id) on delete cascade, tenant_id text not null, reviewer_uid text, reviewed_at timestamptz);
  create table public.tenant_review_audit (id uuid primary key default gen_random_uuid(),
    property_id uuid not null references public.properties(id) on delete cascade, tenant_id text not null);
  create table public.lease_documents (
    id uuid primary key default gen_random_uuid(),
    property_id uuid not null references public.properties(id) on delete cascade,
    tenant_id uuid, tenant_name text, file_name text not null, file_url text, extracted_text text,
    created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
    doc_type text, status text not null default 'received');
  create table public.tenant_field_evidence (id uuid primary key default gen_random_uuid(),
    property_id uuid not null references public.properties(id) on delete cascade, tenant_id text not null, field_key text not null,
    source_document_id uuid references public.lease_documents(id) on delete set null,
    approved boolean not null default false, manually_edited boolean not null default false,
    reviewer_uid text, reviewer_email text, reviewed_at timestamptz);
  create table public.payments (id uuid primary key default gen_random_uuid(),
    property_id uuid not null references public.properties(id) on delete cascade, tenant_id uuid not null,
    constraint payments_tenant_property_fk foreign key (tenant_id, property_id) references public.tenants(id, property_id) on delete restrict);
  ${['tenant_users', 'tenant_statements', 'tenant_documents', 'tenant_invitations', 'tenant_space_profiles'].map(n => `
  create table public.${n} (id uuid primary key default gen_random_uuid(),
    property_id uuid not null references public.properties(id) on delete cascade, tenant_id uuid not null,
    constraint ${n}_tenant_property_fk foreign key (tenant_id, property_id) references public.tenants(id, property_id) on delete cascade);`).join('')}
  create table public.lease_jobs (id uuid primary key default gen_random_uuid(),
    property_id uuid references public.properties(id) on delete cascade,
    tenant_id uuid references public.tenants(id) on delete set null);
  create table public.property_events (
    id uuid primary key default gen_random_uuid(),
    property_id uuid not null references public.properties(id) on delete cascade,
    organization_id uuid, actor_uid uuid references auth.users(id) on delete set null, actor_email text,
    action text not null check (length(action) >= 1 and length(action) <= 80),
    subject_type text, subject_id text, field_key text, old_value text, new_value text,
    detail jsonb not null default '{}'::jsonb, client_ts timestamptz not null default now(),
    created_at timestamptz not null default now(), source_key text);
  -- Pilot's two property_events triggers, as read from its catalog
  create function public._property_events_append_only() returns trigger language plpgsql as $f$
  begin
    if tg_op = 'DELETE' then
      if pg_trigger_depth() <= 1 then
        raise exception 'property_events is append-only: rows are never deleted (deleting the property removes them by cascade)' using errcode = 'integrity_constraint_violation';
      end if;
      return old;
    end if;
    if pg_trigger_depth() <= 1 then
      raise exception 'property_events is append-only: rows are never updated' using errcode = 'integrity_constraint_violation';
    end if;
    return new;
  end; $f$;
  create trigger property_events_append_only before delete or update on public.property_events for each row execute function public._property_events_append_only();
  create function public._property_events_stamp() returns trigger language plpgsql as $f$
  declare v_caller uuid := auth.uid();
  begin
    if v_caller is not null then
      if new.actor_uid is null then new.actor_uid := v_caller;
      elsif new.actor_uid <> v_caller then raise exception 'property_events.actor_uid must be the caller' using errcode = 'insufficient_privilege';
      end if;
    end if;
    select p.organization_id into new.organization_id from public.properties p where p.id = new.property_id;
    return new;
  end; $f$;
  create trigger property_events_stamp before insert on public.property_events for each row execute function public._property_events_stamp();
  -- row security as on Pilot: any member of the property may do anything to its tenants
  ${['properties', 'tenants', 'cam_reconciliations', 'lease_provisions', 'tenant_review_audit', 'lease_documents', 'tenant_field_evidence', 'payments',
     'tenant_users', 'tenant_statements', 'tenant_documents', 'tenant_invitations', 'tenant_space_profiles', 'lease_jobs', 'property_events']
     .map(n => `alter table public.${n} enable row level security;`).join('\n  ')}
  create policy props_owner_all on public.properties for all to authenticated using (id in (select public.member_property_ids())) with check (id in (select public.member_property_ids()));
  create policy tenants_owner_all on public.tenants for all to authenticated
    using (property_id in (select public.member_property_ids())) with check (property_id in (select public.member_property_ids()));
  create policy tenants_service_role_all on public.tenants for all to service_role using (true) with check (true);
  create policy lease_docs_owner_all on public.lease_documents for all to authenticated
    using (property_id in (select public.member_property_ids())) with check (property_id in (select public.member_property_ids()));
  create policy property_events_member_select on public.property_events for select to authenticated using (property_id in (select public.member_property_ids()));
  create policy property_events_member_insert on public.property_events for insert to authenticated with check (property_id in (select public.member_property_ids()));`;

const FIXTURES = `
  insert into public.properties(id,user_id,name,lifecycle_stage) values
    ('${PM}','${A}','pilot marker','acquired'),
    ('${P1}','${A}','A acquired 1','acquired'), ('${P2}','${A}','A acquired 2','acquired'),
    ('${P3}','${A}','A prospect','prospect'),   ('${P4}','${B}','B acquired','acquired');
  insert into public.property_members(property_id,user_id) values ('${P1}','${M}');
  insert into public.tenants(id,property_id,name,sqft,cap,start_date,end_date,lease_type) values
    ('${U1}','${P1}','U1 unreferenced',1000,3,'2020-01-01','2025-12-31','NNN'),
    ('${U2}','${P1}','U2 document-linked',1200,3,'2021-01-01','2030-12-31','NNN'),
    ('${U3}','${P1}','U3 CAM-referenced',1500,4,'2019-06-01','2029-05-31','NNN'),
    ('${U4}','${P1}','U4 unreviewed evidence',900,null,'2022-01-01',null,'Gross'),
    ('${U5}','${P1}','U5 to be ended',800,2,'2018-01-01','2024-12-31','NNN'),
    ('${X1}','${P2}','X1 on P2',500,null,null,null,null),
    ('${Y1}','${P4}','Y1 on P4 (B)',700,null,null,null,null);
  insert into public.lease_documents(id,property_id,tenant_id,tenant_name,file_name,doc_type) values
    ('${D1}','${P1}','${U2}','U2 document-linked','u2-lease.pdf','original_lease'),
    ('${D2}','${P1}',null,null,'tax-bill.pdf',null);
  insert into public.cam_reconciliations(property_id,tenant_id) values ('${P1}','${U3}');
  insert into public.tenant_field_evidence(property_id,tenant_id,field_key,reviewed_at) values ('${P1}','${U4}','sqft', now());`;

const q = (sql, db) => pg.psql(sql, db);
const one = (sql, db) => q(sql, db).out;
const as = (role, uid, sql, db) => pg.as(role, uid, sql, db);
const json = (r) => { if (!r.ok) return { _error: r.out }; try { return JSON.parse(r.out); } catch (_) { return { _error: r.out }; } };
const rpc = (db, uid, prop, rows) =>
  json(as('authenticated', uid, `select public.resync_property_tenants('${prop}'::uuid, '${JSON.stringify(rows).replace(/'/g, "''")}'::jsonb);`, db));
const call = (db, uid, sql, role) => json(as(role || 'authenticated', uid, 'select ' + sql + ';', db));
const exists = (db, id) => one(`select exists(select 1 from public.tenants where id='${id}');`, db) === 't';
const rowOf = (db, id) => one(`select coalesce((select row(x.*)::text from public.tenants x where id='${id}'), '<none>');`, db);
const life = (db, id) => one(`select leasehold_status||'|'||coalesce(ended_at::text,'')||'|'||coalesce(ended_reason,'') from public.tenants where id='${id}';`, db);
const guardErr = (r) => !r.ok && /is permanent and is not deleted/.test(r.out);
const lifeErr = (r) => !r.ok && /changes only through end_leasehold or reactivate_leasehold|A new leasehold is always active/.test(r.out);
const errOf = (r) => (r && r._error) || '';
const events = (db, id, action) => one(`select count(*) from public.property_events where subject_id='${id}'${action ? ` and action='${action}'` : ''};`, db);
const TABLES = ['properties', 'property_members', 'tenants', 'cam_reconciliations', 'lease_provisions', 'tenant_review_audit', 'lease_documents',
  'tenant_field_evidence', 'payments', 'tenant_users', 'tenant_statements', 'tenant_documents', 'tenant_invitations', 'tenant_space_profiles',
  'lease_jobs', 'property_events'];
const dataFp = (db) => one(`select md5(${TABLES.map(n => `coalesce((select string_agg(md5(x::text), '' order by x::text) from public.${n} x), '${n}:empty')`).join(' || ')});`, db);
const catalog = (db, only) => one(`
  select md5(string_agg(x, '|' order by x)) from (
    select 'c:' || table_name || '.' || column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default,'') x
      from information_schema.columns where table_schema='public'
    union all select 'k:' || conrelid::regclass::text || '.' || conname || ':' || pg_get_constraintdef(oid) || ':' || convalidated
      from pg_constraint where connamespace='public'::regnamespace
    union all select 'i:' || indexname || ':' || indexdef from pg_indexes where schemaname='public'
    union all select 'p:' || tablename || '.' || policyname || ':' || coalesce(qual,'') || ':' || coalesce(with_check,'') from pg_policies where schemaname='public'
    union all select 'r:' || relname || ':' || relrowsecurity from pg_class where relnamespace='public'::regnamespace and relkind='r'
    union all select 'g:' || table_name || ':' || grantee || ':' || privilege_type from information_schema.role_table_grants where table_schema='public'
    ${only === 'tables' ? '' : `
    union all select 'f:' || p.oid::regprocedure::text || ':' || md5(prosrc) || ':' || coalesce(proacl::text,'') || ':' || prosecdef || ':' || coalesce(array_to_string(proconfig, ','),'') || ':' || coalesce(obj_description(p.oid, 'pg_proc'),'')
      from pg_proc p where pronamespace='public'::regnamespace
    union all select 't:' || tgname || ':' || pg_get_triggerdef(oid) from pg_trigger where not tgisinternal and tgrelid in (select oid from pg_class where relnamespace='public'::regnamespace)`}
  ) s;`, db);
const resyncMd5 = (db) => one(`select md5(prosrc) from pg_proc where oid='public.resync_property_tenants(uuid,jsonb)'::regprocedure;`, db);
const resyncAcl = (db) => one(`select coalesce(proacl::text,'<default>') || '|' || prosecdef || '|' || coalesce(array_to_string(proconfig, ','),'') from pg_proc where oid='public.resync_property_tenants(uuid,jsonb)'::regprocedure;`, db);

/** A database in Pilot's pre-038 state (037 + 039 applied), optionally with 038. */
function fresh(name, with038) {
  pg.database(name, 'legacy');
  const steps = [['schema', q(SCHEMA, name)], ['fixtures', q(FIXTURES, name)],
    ['037', pg.psqlText(M037, name, '037-' + name)], ['039', pg.psqlText(M039, name, '039-' + name)]];
  if (with038) steps.push(['038', pg.psqlText(M038, name, '038-' + name)]);
  const bad = steps.find(([, r]) => !r.ok);
  if (bad) throw new Error(`fresh(${name}) failed at ${bad[0]}: ${bad[1].out.slice(0, 400)}`);
  return name;
}

// ── 1 · apply ────────────────────────────────────────────────────────────────
section('1 · the 039 baseline is Pilot\'s live body; 038 applies, and again; no row written');
const DB = fresh('m038', false);
check('the installed resync is Pilot\'s live 039 body (md5 ' + LIVE_039_MD5.slice(0, 8) + '…)', resyncMd5(DB) === LIVE_039_MD5, resyncMd5(DB));
const dataBefore = dataFp(DB), tablesBefore = catalog(DB, 'tables'), catalogBefore = catalog(DB), aclBefore = resyncAcl(DB);
const a1 = pg.psqlText(M038, DB, 'm038');
check('038 applies', a1.ok, a1.ok ? '' : a1.out.slice(0, 400));
check('applying it writes no row (every table fingerprinted)', dataFp(DB) === dataBefore);
const catalogAfter = catalog(DB);
const a2 = pg.psqlText(M038, DB, 'm038-again');
check('038 applies again (re-runnable)', a2.ok, a2.ok ? '' : a2.out.slice(0, 300));
check('   …and the second apply changes nothing', catalog(DB) === catalogAfter && dataFp(DB) === dataBefore);
check('the precondition refuses a resync body it was not written against', (() => {
  const X = fresh('m038pre', false);
  q(`create or replace function public.resync_property_tenants(p_property_id uuid, p_rows jsonb) returns jsonb language sql as $f$ select '{}'::jsonb $f$;`, X);
  const r = pg.psqlText(M038, X, 'm038-pre');
  return !r.ok && /is not 039''?s body/.test(r.out) && one(`select count(*) from pg_trigger where tgname='tenants_delete_guard';`, X) === '0';
})());
check('the precondition refuses a database without 037', (() => {
  pg.database('m038no037', 'legacy'); q(SCHEMA, 'm038no037'); q(FIXTURES, 'm038no037');
  const r = pg.psqlText(M038, 'm038no037', 'm038-no037');
  return !r.ok && /apply 037 first/.test(r.out);
})());

// ── 2 · inventory ────────────────────────────────────────────────────────────
section('2 · exact inventory');
check('no table, column, constraint, index, policy, RLS flag or table grant changed', catalog(DB, 'tables') === tablesBefore);
check('resync body is 038\'s (md5 ' + BODY_038_MD5.slice(0, 8) + '…) and no longer contains a DELETE',
  resyncMd5(DB) === BODY_038_MD5 && !/\bdelete\s+from\b/i.test(resyncBody(M038)));
check('resync stays SECURITY DEFINER, search_path=public, same ACL', resyncAcl(DB) === aclBefore, resyncAcl(DB));
const trg = one(`select string_agg(tgname || '=' || pg_get_triggerdef(oid), ' ; ' order by tgname) from pg_trigger where tgrelid='public.tenants'::regclass and not tgisinternal;`, DB);
check('tenants_delete_guard: BEFORE DELETE, FOR EACH ROW', /tenants_delete_guard=CREATE TRIGGER tenants_delete_guard BEFORE DELETE ON public\.tenants FOR EACH ROW/.test(trg), trg);
check('tenants_lifecycle_guard: BEFORE INSERT OR UPDATE OF leasehold_status, ended_at, ended_reason',
  /tenants_lifecycle_guard=CREATE TRIGGER tenants_lifecycle_guard BEFORE INSERT OR UPDATE OF leasehold_status, ended_at, ended_reason ON public\.tenants FOR EACH ROW/.test(trg), trg);
check('tenants_property_immutable is still there, untouched', /tenants_property_immutable=CREATE TRIGGER tenants_property_immutable BEFORE UPDATE OF property_id/.test(trg));
const fnInfo = (sig) => one(`select prosecdef || '|' || coalesce(array_to_string(proconfig, ','),'') from pg_proc where oid='public.${sig}'::regprocedure;`, DB);
const SIGS = ['end_leasehold(uuid,date,text,text)', 'reactivate_leasehold(uuid,text)', 'discard_leasehold(uuid,text)', 'tenants_delete_guard()', 'tenants_lifecycle_guard()'];
check('all five new functions: SECURITY DEFINER, search_path=public (D12)', SIGS.every(s => fnInfo(s) === 'true|search_path=public'), SIGS.map(fnInfo).join(' '));
const canX = (role, sig) => pg.canExecute(role, 'public.' + sig, DB);
check('end / reactivate / discard: executable by authenticated and service_role', SIGS.slice(0, 3).every(s => canX('authenticated', s) && canX('service_role', s)));
check('   …and NOT by anon', SIGS.slice(0, 3).every(s => !canX('anon', s)));
check('the two trigger functions are executable by none of the API roles', SIGS.slice(3).every(s => !canX('anon', s) && !canX('authenticated', s) && !canX('service_role', s)));

// ── 3 · resync never deletes ─────────────────────────────────────────────────
section('3 · resync: never deletes, never touches an ended leasehold');
{
  // The gap, on Pilot's CURRENT (039) body.
  const G = fresh('m038gap', false);
  const r = rpc(G, A, P1, [{ id: U2, name: 'U2 document-linked' }, { id: U3, name: 'U3 CAM-referenced' }, { id: U4, name: 'U4' }, { id: U5, name: 'U5' }]);
  check('BEFORE 038: a roster missing an unreferenced leasehold DELETES it (the gap 038 closes)', r.ok === true && r.deleted === 1 && !exists(G, U1), JSON.stringify(r).slice(0, 160));
}
{
  const R = fresh('m038rs', true);
  const u1Before = rowOf(R, U1), all = dataFp(R);
  // Remove (the lease list's button): the roster minus one.
  const r = rpc(R, A, P1, [{ id: U2, name: 'U2 document-linked', sqft: 1200 }, { id: U3, name: 'U3 CAM-referenced', sqft: 1500 }, { id: U4, name: 'U4 unreviewed evidence', sqft: 900 }, { id: U5, name: 'U5 to be ended', sqft: 800 }]);
  check('Remove\'s roster (all but one): ok, deleted = 0', r.ok === true && r.deleted === 0, JSON.stringify(r).slice(0, 200));
  check('   …the absent, UNREFERENCED leasehold is still there, byte-identical', exists(R, U1) && rowOf(R, U1) === u1Before);
  check('   …and it is reported: absent_active = [U1], retained_referenced = 1',
    JSON.stringify(r.absent_active) === JSON.stringify([U1]) && r.retained_referenced === 1 && JSON.stringify(r.ended_in_roster) === '[]');
  check('   …it is still active (absence is not an ending)', life(R, U1) === 'active||');
  // Clear All, then one new upload: the roster is just the new leasehold.
  const NEW = t(20);
  const c = rpc(R, A, P1, [{ id: NEW, name: 'New upload', sqft: 300 }]);
  check('Clear All then one upload (roster = the new leasehold only): every other leasehold kept',
    c.ok === true && c.deleted === 0 && [U1, U2, U3, U4, U5].every(id => exists(R, id)) && exists(R, NEW), JSON.stringify(c).slice(0, 200));
  check('   …all five reported absent, sorted', JSON.stringify(c.absent_active) === JSON.stringify([U1, U2, U3, U4, U5].sort()));
  check('   …the new leasehold is inserted active', life(R, NEW) === 'active||' && c.upserted === 1 && c.inserted === 1);
  // The extraction filter / dedupe: rows dropped client-side are absence, not ending.
  const d = rpc(R, A, P1, [{ id: U1, name: 'U1 renamed' }]);
  check('a roster reduced by dedupe or the extraction filter: nothing deleted, the named row updated',
    d.ok && d.deleted === 0 && one(`select name from public.tenants where id='${U1}';`, R) === 'U1 renamed' && [U2, U3, U4, U5, NEW].every(id => exists(R, id)));
  // A roster row cannot change lifecycle.
  const l = rpc(R, A, P1, [{ id: U4, name: 'U4 unreviewed evidence', leasehold_status: 'ended', ended_at: '2025-01-01', ended_reason: 'other' }]);
  check('a roster row carrying lifecycle fields writes none of them', l.ok && life(R, U4) === 'active||');
  // 032 / 039 rules still hold.
  check('032: an id from another property refuses the call', rpc(R, A, P1, [{ id: X1, name: 'moved?' }]).code === 'cross_property_tenant' && one(`select property_id from public.tenants where id='${X1}';`, R) === P2);
  check('032: a prospect is refused', rpc(R, A, P3, [{ id: t(21), name: 'p' }]).code === 'property_not_acquired');
  check('032: another user is not_authorized, and nothing is written', rpc(R, B, P1, [{ id: U1, name: 'hijack' }]).code === 'not_authorized' && one(`select name from public.tenants where id='${U1}';`, R) === 'U1 renamed');
  check('032: a member who is not the owner is not_authorized (owner-only, unchanged)', rpc(R, M, P1, [{ id: U1, name: 'member' }]).code === 'not_authorized');
  check('an empty roster is a no-op', rpc(R, A, P1, []).noop_reason === 'empty_roster');
  const s = rpc(R, A, P1, [{ id: 'not-a-uuid', name: 'x' }, { id: U2, name: '' }]);
  check('rows with no usable id or name are skipped, nothing else changes', s.noop_reason === 'no_usable_rows' && s.skipped === 2);
  void all;
}
{
  // An ENDED leasehold sent back in a roster.
  const E = fresh('m038end', true);
  check('   (end U5 through end_leasehold)', call(E, A, `public.end_leasehold('${U5}', '2025-03-31', 'surrendered', 'keys returned')`).ok === true);
  const before = rowOf(E, U5);
  const r = rpc(E, A, P1, [{ id: U5, name: 'U5 overwritten?', sqft: 1, end_date: '2099-01-01' }, { id: U1, name: 'U1', sqft: 1000 }]);
  check('an ended leasehold in the roster is NOT written (D5): row byte-identical, still ended',
    r.ok && rowOf(E, U5) === before && life(E, U5) === 'ended|2025-03-31|surrendered', JSON.stringify(r).slice(0, 200));
  check('   …reported in ended_in_roster, not counted as upserted', JSON.stringify(r.ended_in_roster) === JSON.stringify([U5]) && r.upserted === 1);
  check('   …and an ended leasehold absent from a roster is not in absent_active (it is history, not missing)',
    !(rpc(E, A, P1, [{ id: U1, name: 'U1' }]).absent_active || []).includes(U5));
}

// ── 4 · no direct delete ─────────────────────────────────────────────────────
section('4 · no direct delete of a leasehold, for any role');
{
  const G = fresh('m038gapdel', false);
  check('BEFORE 038: the owner deletes an unreferenced leasehold directly through the API (the gap)',
    as('authenticated', A, `delete from public.tenants where id='${U1}';`, G).ok && !exists(G, U1));
  check('BEFORE 038: so can a member who is not the owner', as('authenticated', M, `delete from public.tenants where id='${U4}';`, G).ok && !exists(G, U4));
}
{
  const R = fresh('m038del', true);
  const fp0 = dataFp(R);
  const refusedAll = [];
  check('owner, one unreferenced leasehold, through the API: refused', guardErr(as('authenticated', A, `delete from public.tenants where id='${U1}';`, R)) && exists(R, U1));
  check('member (not owner): refused', guardErr(as('authenticated', M, `delete from public.tenants where id='${U4}';`, R)) && exists(R, U4));
  check('service role (BYPASSRLS): refused', guardErr(as('service_role', null, `delete from public.tenants where id='${U1}';`, R)) && exists(R, U1));
  check('table owner / superuser: refused', guardErr(q(`delete from public.tenants where id='${U1}';`, R)) && exists(R, U1));
  check('a many-row delete (the old Clear All) is refused whole: nothing deleted',
    guardErr(q(`delete from public.tenants where property_id='${P1}';`, R)) && one(`select count(*) from public.tenants where property_id='${P1}';`, R) === '5');
  check('   …the refused deletes above changed no row at all', dataFp(R) === fp0);
  void refusedAll;
  check('an ENDED leasehold cannot be deleted either', (() => {
    call(R, A, `public.end_leasehold('${U5}', '2025-01-31', 'lease_expired', null)`);
    return guardErr(q(`delete from public.tenants where id='${U5}';`, R)) && exists(R, U5);
  })());
  check('the refusal tells the caller what to do instead', /End it \(end_leasehold\)[\s\S]*discard it \(discard_leasehold\)/.test(q(`delete from public.tenants where id='${U1}';`, R).out));
  check('all seven leaseholds are still on record', one(`select count(*) from public.tenants;`, R) === '7');
}
{
  // The whole-PROPERTY delete still cascades — every child present.
  const C = fresh('m038casc', true);
  q(`insert into public.tenant_field_evidence(property_id,tenant_id,field_key,approved,reviewer_uid) values ('${P1}','${U2}','cap',true,'${A}');
     insert into public.lease_provisions(property_id,tenant_id) values ('${P1}','${U3}');
     insert into public.tenant_review_audit(property_id,tenant_id) values ('${P1}','${U3}');
     ${['tenant_users', 'tenant_statements', 'tenant_documents', 'tenant_invitations', 'tenant_space_profiles'].map(n => `insert into public.${n}(property_id,tenant_id) values ('${P1}','${U2}');`).join(' ')}
     insert into public.lease_jobs(property_id,tenant_id) values ('${P1}','${U4}');`, C);
  call(C, A, `public.end_leasehold('${U5}', '2025-02-28', 'terminated_early', 'early exit')`);
  const r = q(`delete from public.properties where id='${P1}';`, C);
  check('DELETE the PROPERTY (documents, evidence, CAM, provisions, audit, portal rows, jobs, an ended leasehold, events): succeeds', r.ok, r.ok ? '' : r.out.slice(0, 300));
  const left = one(`select ${TABLES.filter(n => !['properties', 'property_members'].includes(n)).map(n => `(select count(*) from public.${n} where property_id='${P1}')`).join(' + ')};`, C);
  check('   …every row of the property is gone together', left === '0', left);
  check('   …other properties untouched', one(`select count(*) from public.tenants where property_id in ('${P2}','${P4}');`, C) === '2');
  // With a payment present the property delete behaves exactly as without 038.
  const withPay = (name, w38) => { const X = fresh(name, w38); q(`insert into public.payments(property_id,tenant_id) values ('${P1}','${U3}');`, X);
    const d = q(`delete from public.properties where id='${P1}';`, X); return d.ok ? 'ok' : (/violates foreign key constraint "payments_tenant_property_fk"/.test(d.out) ? 'payments-restrict' : d.out.slice(0, 120)); };
  const p39 = withPay('m038pay39', false), p38 = withPay('m038pay38', true);
  check('a property with a payment deletes exactly as it did before 038 (' + p39 + ')', p38 === p39, p38 + ' vs ' + p39);
}

// ── 5 · lifecycle guard ──────────────────────────────────────────────────────
section('5 · lifecycle changes only through end_leasehold / reactivate_leasehold');
{
  const L = fresh('m038life', true);
  const setEnded = `update public.tenants set leasehold_status='ended', ended_at='2025-01-01', ended_reason='other' where id='${U1}';`;
  {
    const G = fresh('m038gaplife', false);
    check('BEFORE 038: the owner ends a leasehold directly through the API, with no event (the gap)',
      as('authenticated', A, setEnded, G).ok && life(G, U1) === 'ended|2025-01-01|other' && events(G, U1) === '0');
  }
  check('owner, direct UPDATE to ended: refused', lifeErr(as('authenticated', A, setEnded, L)) && life(L, U1) === 'active||');
  check('service role: refused', lifeErr(as('service_role', null, setEnded, L)) && life(L, U1) === 'active||');
  check('table owner / superuser: refused', lifeErr(q(setEnded, L)) && life(L, U1) === 'active||');
  call(L, A, `public.end_leasehold('${U5}', '2025-01-31', 'lease_expired', null)`);
  check('changing only ended_at of an ENDED leasehold directly: refused (037\'s check would allow it)',
    lifeErr(q(`update public.tenants set ended_at='2025-06-30' where id='${U5}';`, L)) && life(L, U5) === 'ended|2025-01-31|lease_expired');
  check('changing only ended_reason directly: refused', lifeErr(q(`update public.tenants set ended_reason='evicted' where id='${U5}';`, L)));
  check('reactivating directly: refused', lifeErr(q(`update public.tenants set leasehold_status='active', ended_at=null, ended_reason=null where id='${U5}';`, L)) && life(L, U5) === 'ended|2025-01-31|lease_expired');
  check('an UPDATE that names the columns without changing them passes',
    q(`update public.tenants set leasehold_status=leasehold_status, ended_at=ended_at, ended_reason=ended_reason where property_id='${P1}';`, L).ok);
  check('other columns still edit directly (active and ended rows alike)',
    as('authenticated', A, `update public.tenants set name='U1 edited' where id='${U1}'; update public.tenants set lease_type='Gross' where id='${U5}';`, L).ok
    && one(`select name from public.tenants where id='${U1}';`, L) === 'U1 edited');
  check('INSERT of an ended leasehold: refused, for every role',
    lifeErr(q(`insert into public.tenants(id,property_id,name,leasehold_status,ended_at,ended_reason) values ('${t(30)}','${P1}','born ended','ended','2025-01-01','other');`, L))
    && lifeErr(as('service_role', null, `insert into public.tenants(id,property_id,name,leasehold_status,ended_at,ended_reason) values ('${t(30)}','${P1}','born ended','ended','2025-01-01','other');`, L))
    && !exists(L, t(30)));
  check('INSERT of an active leasehold (the client\'s and acquire_property\'s shape): accepted',
    q(`insert into public.tenants (id, property_id, name, sqft, cap, start_date, end_date, lease_url, lease_type)
       values ('${t(31)}', '${P2}', 'acquired leasehold', 100, 3, '2024-01-01', '2029-12-31', null, 'NNN')
       on conflict (id) do update set name = excluded.name, sqft = excluded.sqft, cap = excluded.cap, start_date = excluded.start_date,
         end_date = excluded.end_date, lease_url = coalesce(excluded.lease_url, tenants.lease_url), lease_type = excluded.lease_type
       where tenants.property_id = '${P2}';`, L).ok && life(L, t(31)) === 'active||');
  check('   …and the same upsert again (conflict path): accepted, still active',
    q(`insert into public.tenants (id, property_id, name) values ('${t(31)}', '${P2}', 'acquired again')
       on conflict (id) do update set name = excluded.name where tenants.property_id = '${P2}';`, L).ok && life(L, t(31)) === 'active||');
}

// ── 6 · end_leasehold ────────────────────────────────────────────────────────
section('6 · end_leasehold: a person confirms the leasehold actually ended');
{
  const E = fresh('m038endfn', true);
  const unauthorized = (r) => /Not authorized: caller does not own the property of leasehold/.test(errOf(r));
  check('a member who is not the owner: refused (D3)', unauthorized(call(E, M, `public.end_leasehold('${U1}', '2025-01-31', 'surrendered', null)`)) && life(E, U1) === 'active||');
  check('another user: refused, and learns nothing (same message as an unknown id)',
    unauthorized(call(E, B, `public.end_leasehold('${U1}', '2025-01-31', 'surrendered', null)`)) && unauthorized(call(E, A, `public.end_leasehold('${t(99)}', '2025-01-31', 'surrendered', null)`)));
  check('service role with no user: refused', /requires an authenticated user/.test(errOf(call(E, null, `public.end_leasehold('${U1}', '2025-01-31', 'surrendered', null)`, 'service_role'))));
  check('anon cannot execute it', /permission denied for function end_leasehold/.test(errOf(call(E, A, `public.end_leasehold('${U1}', '2025-01-31', 'surrendered', null)`, 'anon'))));
  check('no actual end date: refused — never taken from end_date (D8)',
    /actual end date is required/.test(errOf(call(E, A, `public.end_leasehold('${U1}', null, 'surrendered', null)`))) && life(E, U1) === 'active||');
  check('"assigned" is not a reason (an assignment does not end a leasehold)', /must be one of/.test(errOf(call(E, A, `public.end_leasehold('${U1}', '2025-01-31', 'assigned', null)`))));
  check('a null reason: refused', /must be one of/.test(errOf(call(E, A, `public.end_leasehold('${U1}', '2025-01-31', null, null)`))));
  q(`insert into public.tenants(id,property_id,name) values ('${t(32)}','${P3}','on a prospect');`, E);
  check('a leasehold of a property that is not acquired: refused', /not acquired/.test(errOf(call(E, A, `public.end_leasehold('${t(32)}', '2025-01-31', 'other', null)`))));
  const fp = dataFp(E);
  check('every refusal above changed nothing', dataFp(E) === fp);
  // Holdover: the confirmed end is LATER than the contractual end_date (2025-12-31).
  const h = call(E, A, `public.end_leasehold('${U1}', '2026-04-30', 'lease_expired', 'held over four months')`);
  check('the owner ends it; a holdover end later than end_date is accepted', h.ok === true && life(E, U1) === 'ended|2026-04-30|lease_expired', JSON.stringify(h).slice(0, 200));
  check('   …end_date is untouched', one(`select end_date from public.tenants where id='${U1}';`, E) === '2025-12-31');
  const ev = one(`select action||'|'||subject_type||'|'||old_value||'|'||new_value||'|'||actor_uid||'|'||(detail->>'ended_at')||'|'||(detail->>'reason')||'|'||(detail->>'note')||'|'||(detail->>'contractual_end_date') from public.property_events where subject_id='${U1}';`, E);
  check('   …one leasehold_ended event: actor, reason, note and the contractual end date recorded',
    ev === `leasehold_ended|leasehold|active|ended|${A}|2026-04-30|lease_expired|held over four months|2025-12-31`, ev);
  check('an early ending (before end_date) is accepted too', call(E, A, `public.end_leasehold('${U2}', '2024-06-30', 'terminated_early', null)`).ok === true && life(E, U2) === 'ended|2024-06-30|terminated_early');
  check('   …a blank note is stored as no note', one(`select coalesce(detail->>'note','<none>') from public.property_events where subject_id='${U2}';`, E) === '<none>');
  check('ending an ENDED leasehold again: refused', /already ended/.test(errOf(call(E, A, `public.end_leasehold('${U1}', '2026-05-31', 'other', null)`))) && life(E, U1) === 'ended|2026-04-30|lease_expired');
  check('the lifecycle flag does not outlive the call: a direct change in the same transaction is refused',
    lifeErr(as('authenticated', A, `select public.end_leasehold('${U3}', '2025-01-31', 'other', null); update public.tenants set ended_reason='evicted' where id='${U3}';`, E))
    && life(E, U3) === 'active||');
}

// ── 7 · reactivate_leasehold ─────────────────────────────────────────────────
section('7 · reactivate_leasehold: a correction, with a note');
{
  const R = fresh('m038react', true);
  call(R, A, `public.end_leasehold('${U1}', '2025-05-31', 'surrendered', 'first ending')`);
  check('no note: refused', /note is required/.test(errOf(call(R, A, `public.reactivate_leasehold('${U1}', '  ')`))) && life(R, U1) === 'ended|2025-05-31|surrendered');
  check('a member who is not the owner: refused', /Not authorized/.test(errOf(call(R, M, `public.reactivate_leasehold('${U1}', 'x')`))));
  check('an ACTIVE leasehold: refused', /nothing to reactivate/.test(errOf(call(R, A, `public.reactivate_leasehold('${U2}', 'x')`))));
  const r = call(R, A, `public.reactivate_leasehold('${U1}', 'ended by mistake; tenant renewed')`);
  check('the owner reactivates it: active, ended_at and ended_reason cleared', r.ok === true && life(R, U1) === 'active||');
  const ev = one(`select action||'|'||old_value||'|'||new_value||'|'||(detail->>'note')||'|'||(detail->>'previous_ended_at')||'|'||(detail->>'previous_reason') from public.property_events where subject_id='${U1}' and action='leasehold_reactivated';`, R);
  check('   …the previous ending is kept in the leasehold_reactivated event', ev === 'leasehold_reactivated|ended|active|ended by mistake; tenant renewed|2025-05-31|surrendered', ev);
  check('   …and the leasehold_ended event is still there (history is appended, never rewritten)', events(R, U1, 'leasehold_ended') === '1');
  const s = rpc(R, A, P1, [{ id: U1, name: 'U1 after reactivation', sqft: 1000 }]);
  check('the resync writes a reactivated leasehold again', s.ok && s.upserted === 1 && one(`select name from public.tenants where id='${U1}';`, R) === 'U1 after reactivation');
}

// ── 8 · discard_leasehold ────────────────────────────────────────────────────
section('8 · discard_leasehold: a record entered in error, and nothing else');
{
  const blockers = [
    ['a CAM reconciliation', 'CAM reconciliation', (id) => `insert into public.cam_reconciliations(property_id,tenant_id) values ('${P1}','${id}');`],
    ['a lease provision', 'lease provision', (id) => `insert into public.lease_provisions(property_id,tenant_id) values ('${P1}','${id}');`],
    ['a review audit entry', 'review audit', (id) => `insert into public.tenant_review_audit(property_id,tenant_id) values ('${P1}','${id}');`],
    ['a payment', 'payment', (id) => `insert into public.payments(property_id,tenant_id) values ('${P1}','${id}');`],
    ...['tenant_users', 'tenant_statements', 'tenant_documents', 'tenant_invitations', 'tenant_space_profiles'].map(n =>
      ['a portal row in ' + n, 'tenant portal record', (id) => `insert into public.${n}(property_id,tenant_id) values ('${P1}','${id}');`]),
    ['a property history event naming it', 'property history event', (id) => `insert into public.property_events(property_id,action,subject_id) values ('${P1}','lease_uploaded','${id}');`],
    ['evidence a person approved', 'person-reviewed evidence', (id) => `insert into public.tenant_field_evidence(property_id,tenant_id,field_key,approved,reviewed_at) values ('${P1}','${id}','cap',true,now());`],
    ['evidence a person edited', 'person-reviewed evidence', (id) => `insert into public.tenant_field_evidence(property_id,tenant_id,field_key,manually_edited,reviewed_at) values ('${P1}','${id}','cap',true,now());`],
    ['evidence with a reviewer uid', 'person-reviewed evidence', (id) => `insert into public.tenant_field_evidence(property_id,tenant_id,field_key,reviewer_uid,reviewed_at) values ('${P1}','${id}','cap','${A}',now());`],
    ['evidence with a reviewer email', 'person-reviewed evidence', (id) => `insert into public.tenant_field_evidence(property_id,tenant_id,field_key,reviewer_email,reviewed_at) values ('${P1}','${id}','cap','a@example.test',now());`],
  ];
  const D = fresh('m038disc', true);
  blockers.forEach(([what, word, ins], i) => {
    const id = t(60 + i);
    q(`insert into public.tenants(id,property_id,name) values ('${id}','${P1}','blocked ${i}'); ${ins(id)}`, D);
    const fp = dataFp(D);
    const r = call(D, A, `public.discard_leasehold('${id}', 'entered in error')`);
    check(`refused while it has ${what} — and the refusal names it`, new RegExp('cannot be discarded:[^]*' + word).test(errOf(r)) && exists(D, id) && dataFp(D) === fp, errOf(r).slice(0, 140));
  });
  check('the refusal carries the reasons as JSON in its detail', /DETAIL:\s+\{"reasons":/.test(as('authenticated', A, `select public.discard_leasehold('${t(60)}', 'x');`, D).out));
  // Several reasons at once are all named.
  q(`insert into public.tenants(id,property_id,name) values ('${t(80)}','${P1}','many');
     insert into public.cam_reconciliations(property_id,tenant_id) values ('${P1}','${t(80)}');
     insert into public.payments(property_id,tenant_id) values ('${P1}','${t(80)}');`, D);
  const many = errOf(call(D, A, `public.discard_leasehold('${t(80)}', 'x')`));
  check('several blockers are all named', /CAM reconciliation[^]*payment/.test(many), many.slice(0, 160));
  check('an ENDED leasehold is never discarded (it is history)', (() => {
    call(D, A, `public.end_leasehold('${U5}', '2025-01-31', 'lease_expired', null)`);
    return /never discarded/.test(errOf(call(D, A, `public.discard_leasehold('${U5}', 'x')`))) && exists(D, U5);
  })());
  check('no note: refused', /note is required/.test(errOf(call(D, A, `public.discard_leasehold('${U1}', null)`))) && exists(D, U1));
  check('a member who is not the owner: refused', /Not authorized/.test(errOf(call(D, M, `public.discard_leasehold('${U1}', 'x')`))) && exists(D, U1));
  check('anon cannot execute it', /permission denied for function discard_leasehold/.test(errOf(call(D, A, `public.discard_leasehold('${U1}', 'x')`, 'anon'))));
}
{
  // Success: a record entered in error, with its upload's own artefacts.
  const S = fresh('m038discok', true);
  const J = 'c0000000-0000-4000-8000-000000000001';
  q(`insert into public.tenants(id,property_id,name,end_date) values ('${U9}','${P1}','Mistaken Co','2030-01-31');
     insert into public.lease_documents(id,property_id,tenant_id,tenant_name,file_name,doc_type) values ('d0000000-0000-4000-8000-000000000009','${P1}','${U9}','Mistaken Co','mistake.pdf','original_lease');
     insert into public.tenant_field_evidence(property_id,tenant_id,field_key,source_document_id,reviewed_at) values
       ('${P1}','${U9}','sqft','d0000000-0000-4000-8000-000000000009',now()), ('${P1}','${U9}','cap',null,now());
     insert into public.lease_jobs(id,property_id,tenant_id) values ('${J}','${P1}','${U9}');`, S);
  const docBefore = one(`select row(id,property_id,tenant_name,file_name,doc_type,legacy_tenant_id,status)::text from public.lease_documents where id='d0000000-0000-4000-8000-000000000009';`, S);
  const othersBefore = one(`select md5(string_agg(x::text,'' order by x::text)) from public.tenants x where id<>'${U9}';`, S);
  const otherEvidence = one(`select count(*) from public.tenant_field_evidence where tenant_id<>'${U9}';`, S);
  const snapshotRow = one(`select to_jsonb(x)::text from public.tenants x where id='${U9}';`, S);
  const r = call(S, A, `public.discard_leasehold('${U9}', 'uploaded to the wrong property')`);
  check('reviewed_at alone does NOT block a discard (every extraction snapshot carries it); the discard succeeds', r.ok === true, JSON.stringify(r).slice(0, 200));
  check('   …the row is gone', !exists(S, U9));
  check('   …its document is KEPT and unlinked: tenant_id null, legacy_tenant_id untouched, everything else identical',
    one(`select coalesce(tenant_id::text,'null') from public.lease_documents where id='d0000000-0000-4000-8000-000000000009';`, S) === 'null'
    && one(`select row(id,property_id,tenant_name,file_name,doc_type,legacy_tenant_id,status)::text from public.lease_documents where id='d0000000-0000-4000-8000-000000000009';`, S) === docBefore
    && one(`select count(*) from public.lease_documents where legacy_tenant_id is not null;`, S) === '0');
  check('   …its unreviewed extraction evidence is removed; nobody else\'s is touched',
    one(`select count(*) from public.tenant_field_evidence where tenant_id='${U9}';`, S) === '0'
    && one(`select count(*) from public.tenant_field_evidence where tenant_id<>'${U9}';`, S) === otherEvidence);
  check('   …every other tenant row is byte-identical', one(`select md5(string_agg(x::text,'' order by x::text)) from public.tenants x where id<>'${U9}';`, S) === othersBefore);
  check('   …its lease job keeps its row, unlinked by the foreign key\'s own SET NULL', one(`select coalesce(tenant_id::text,'null') from public.lease_jobs where id='${J}';`, S) === 'null');
  const ev = one(`select action||'|'||old_value||'|'||new_value||'|'||(detail->>'note')||'|'||(detail->'snapshot')::text||'|'||(detail->'unlinked_document_ids')::text||'|'||(detail->>'removed_unreviewed_evidence') from public.property_events where subject_id='${U9}';`, S);
  check('   …one leasehold_discarded event: the note, the full row snapshot (its id preserved), the unlinked document ids, the evidence removed',
    ev === `leasehold_discarded|active|discarded|uploaded to the wrong property|${JSON.stringify(JSON.parse(snapshotRow))}|["d0000000-0000-4000-8000-000000000009"]|2`
    || (ev.startsWith('leasehold_discarded|active|discarded|uploaded to the wrong property|') && ev.includes(`"id": "${U9}"`) && ev.includes('["d0000000-0000-4000-8000-000000000009"]') && ev.endsWith('|2')), ev.slice(0, 220));
  check('the discard flag does not outlive the call: deleting another leasehold in the same transaction is refused',
    (() => { q(`insert into public.tenants(id,property_id,name) values ('${t(90)}','${P1}','another mistake');`, S);
      return guardErr(as('authenticated', A, `select public.discard_leasehold('${t(90)}', 'mistake'); delete from public.tenants where id='${U1}';`, S))
        && exists(S, U1) && exists(S, t(90)); })());
  check('the flag names ONE row: set for one id, it does not let another be deleted',
    guardErr(q(`select set_config('mainstreet.discard_leasehold', '${U1}', true); delete from public.tenants where id='${U4}';`, S)) && exists(S, U4));
}

// ── 9 · rollback ─────────────────────────────────────────────────────────────
section('9 · rollback');
{
  const X = fresh('m038rb', false);
  const catBefore = catalog(X), dataB = dataFp(X);
  pg.psqlText(M038, X, 'm038');
  call(X, A, `public.end_leasehold('${U5}', '2025-01-31', 'lease_expired', null)`);
  const dataEnded = dataFp(X);
  const rb = pg.psqlText(R038, X, 'r038');
  check('rollback runs', rb.ok, rb.ok ? '' : rb.out.slice(0, 300));
  check('   …resync body back to Pilot\'s live 039 body byte for byte (md5 ' + LIVE_039_MD5.slice(0, 8) + '…)', resyncMd5(X) === LIVE_039_MD5, resyncMd5(X));
  check('   …both triggers and all five functions gone; the catalog equals the pre-038 catalog', catalog(X) === catBefore);
  check('   …it writes no row (the leasehold ended under 038 stays ended; its event stays)', dataFp(X) === dataEnded && life(X, U5) === 'ended|2025-01-31|lease_expired');
  check('038 applies again after the rollback', pg.psqlText(M038, X, 'm038-again').ok && resyncMd5(X) === BODY_038_MD5);
  void dataB;
}

// ── 10 · static ──────────────────────────────────────────────────────────────
section('10 · static');
{
  const noComments = (s) => s.replace(/^\s*--.*$/gm, '').replace(/--[^\n']*$/gm, '');
  const bodies = (s) => { const out = []; let i = 0; while ((i = s.indexOf('as $$', i)) >= 0) { const j = s.indexOf('$$;', i); out.push(s.slice(i + 5, j)); i = j + 3; } return out; };
  const outside = (s) => { let r = s; bodies(s).forEach(b => { r = r.replace(b, ''); }); return r.replace(/do \$\$[\s\S]*?end \$\$;/g, ''); };
  const top = noComments(outside(M038));
  check('no INSERT / UPDATE / DELETE outside function bodies', !/\b(insert\s+into|update\s+public\.|delete\s+from)\b/i.test(top));
  check('no table, column, policy or RLS DDL', !/\b(create|alter|drop)\s+table\b|\bpolicy\b|row level security|add\s+column/i.test(top));
  check('lease_documents.legacy_tenant_id is never named (reserved for register relinks)', !/legacy_tenant_id/.test(noComments(M038)));
  const sc = (noComments(M038).match(/set_config\('([^']+)'/g) || []).map(s => s.replace(/set_config\('/, '').replace(/'$/, ''));
  check('set_config is used only for the two flags', sc.length > 0 && sc.every(n => n === 'mainstreet.leasehold_lifecycle' || n === 'mainstreet.discard_leasehold'), sc.join(','));
  check('no public function wraps set_config for a caller (only the three lifecycle functions set a flag)',
    one(`select string_agg(proname, ',' order by proname) from pg_proc where pronamespace='public'::regnamespace and prosrc ~ 'set_config';`, DB) === 'discard_leasehold,end_leasehold,reactivate_leasehold');
  check('no "assigned" ending reason anywhere in executable SQL', !/'assigned'/.test(noComments(M038)));
  check('ended_at is never taken from end_date', !/ended_at\s*=\s*(v_t\.)?end_date|coalesce\(\s*p_ended_at\s*,/i.test(noComments(M038)));
  check('both files are guarded by the Pilot marker property', M038.includes('fd9c09b1-b657-4c58-9999-c3cce28e7600') && R038.includes('fd9c09b1-b657-4c58-9999-c3cce28e7600'));
  check('the rollback\'s resync is 039\'s body verbatim', md5(resyncBody(R038)) === LIVE_039_MD5);
  check('says nothing of XRPL / wallets / settlement', !/xrpl|wallet|rlusd/i.test(noComments(M038)));
  check('nothing is validated, and no acquisition table is named', !/validate\s+constraint/i.test(noComments(M038)) && !/acquisition_/i.test(noComments(M038)));
}

T.finish();
