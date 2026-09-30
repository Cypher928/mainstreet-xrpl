'use strict';
/**
 * tools/verify-migration-043.js — run 043 (leasehold absorption) for real,
 * against nothing that matters.
 *
 *   node tools/verify-migration-043.js
 *
 * It touches NO Supabase project. It builds a throwaway PostgreSQL cluster
 * under the 'legacy' default-privilege model (the one Pilot was built under),
 * stands up every table 043 reads, writes or guards — the 038 verifier's
 * tables, plus properties.data / sqft, the three acquisition tables the
 * history test reads, and Pilot's property_events_derive trigger (absorb and
 * restore edit properties.data, which fires it) — with Pilot's foreign keys
 * and policies, applies the REAL 037, 039 and 038 files (so the bodies 043
 * replaces are Pilot's live bodies, md5-checked), and then applies 043.
 *
 * The fixture has the shape that made 043 necessary (Miracle Mile, anonymised):
 * a base-lease leasehold, fragment leaseholds created one per uploaded file,
 * a document linked to a fragment, a document whose link points at an id that
 * no longer exists but whose file is a fragment's own lease file, an
 * unattributed document, a document of another leasehold, and a saved roster
 * in properties.data that lists them all.
 *
 * WHAT IT PROVES
 *
 *   1  APPLY: the 038 bodies installed are Pilot's live bodies; 043 applies,
 *      applies again, changes nothing the second time; applying it writes no
 *      row; the preconditions refuse a database without 038
 *   2  EXACT INVENTORY: the columns, checks, key, indexes, triggers and
 *      functions stated in the header and nothing else; policies and RLS flags
 *      unchanged; tenants_delete_guard, end_leasehold, reactivate_leasehold
 *      byte-identical; grants as stated
 *   3  THE STATE: every inconsistent combination refused by the checks; the
 *      pointer is same-property, never self, never dangling
 *   4  GUARDS: the absorption columns change only through the two functions,
 *      for every role; an absorbed row is frozen; a discarded id is never
 *      re-created by any path, while a forged or copied event is no tombstone
 *   5  data_revision: maintained by the database, whatever the caller sends
 *   6  RESYNC: the stale-tab resurrection proven on 038, closed on 043;
 *      absorbed rows skipped and reported; every 038 resync rule still holds
 *   7  leasehold_history: one reason per kind of permanent history; events
 *      copied from uploads or seeds and consolidation bookkeeping are not
 *   8  DISCARD: 038's rules with the shared history test; converted
 *      acquisitions now protected (the gap proven on 038 first); a copied
 *      upload event no longer blocks (D4, proven on 038 first); refused for a
 *      consolidation target, a demo leasehold, an absorbed leasehold
 *   9  ABSORB: every refusal; documents: ownership, conflicts, completeness;
 *      success moves the documents, freezes and points the row, removes and
 *      keeps its roster entry, bumps the revision, writes both events, copies
 *      no term and touches no other row; a failure part-way writes nothing
 *  10  PREFLIGHT: eligibility, reasons, documents, revision; owner only
 *  11  RESTORE: documents back, conflicts reported, roster entry returned,
 *      overrides listed; the row can be consolidated again; owner only
 *  12  THE REST OF 038 STILL HOLDS: no direct delete; the property cascade
 *      with absorbed rows; end and reactivate unchanged and refusing absorbed
 *  13  ROLLBACK: refused while a row is absorbed; after a restore it runs,
 *      restores 038's bodies byte for byte and 037's checks, and the catalog
 *      equals the pre-043 catalog; 043 applies again; and 038's own rollback
 *      still recovers 039 after it
 *  14  STATIC: no row written outside function bodies; no policy or RLS DDL;
 *      legacy_tenant_id never named; set_config only for 038's two flags;
 *      absorb/restore never write terms, evidence, audit or CAM; the rollback
 *      carries 038's bodies verbatim; the Pilot marker guards both files
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
const M043 = fs.readFileSync(path.join(MIG, '043_leasehold_absorption.sql'), 'utf8');
const R043 = fs.readFileSync(path.join(MIG, '043_leasehold_absorption_rollback.sql'), 'utf8');

// Pilot prosrc md5s, read 2026-09-30 with 038 applied.
const LIVE = { resync: '52ab0f93bc357582d5f2369d4695e589', guard: '3d6dbe7a6e4e16880ba1ca4a521e4ec5',
  discard: '004365dfe924082d14197965e9b79477', del: 'b3cec5ae5c3a1aa242fc96da9e916355',
  end: '81109fb153ced1ffb8d271675502a95d', react: '0f822f441b3209e1cc46496a306bcae5' };
const LIVE_039 = 'dd78274653e12e5a7cdfbf3024bd4a7e';
const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');
const bodyOf = (s, head) => { const a = s.indexOf(head); const i = s.indexOf('as $$', a); return s.slice(i + 5, s.indexOf('$$;', i)); };
const H = { resync: 'create or replace function public.resync_property_tenants(', guard: 'create or replace function public.tenants_lifecycle_guard()',
  discard: 'create or replace function public.discard_leasehold(' };
const B043 = Object.fromEntries(Object.entries(H).map(([k, h]) => [k, md5(bodyOf(M043, h))]));

const T = tally();
const { check, section } = T;

console.log('\n══ migration 043 — executed against a throwaway cluster ══');
console.log('   NO Supabase project is contacted by this script.');
const pg = startCluster('043');
console.log('   postgres: ' + pg.PGBIN);

// ── ids ──────────────────────────────────────────────────────────────────────
const A = '11111111-1111-4111-8111-111111111111';   // owner of PM, P1, P2, P3, PD, PE
const B = '22222222-2222-4222-8222-222222222222';   // owner of P4
const M = '33333333-3333-4333-8333-333333333333';   // a MEMBER of P1, not its owner
const PM = 'fd9c09b1-b657-4c58-9999-c3cce28e7600';                   // Pilot marker property
const P1 = 'aaaaaaaa-0000-4000-8000-000000000001', P2 = 'aaaaaaaa-0000-4000-8000-000000000002';
const P3 = 'aaaaaaaa-0000-4000-8000-000000000003', P4 = 'bbbbbbbb-0000-4000-8000-000000000004';
const PE = 'aaaaaaaa-0000-4000-8000-000000000005';                   // acquired, no saved roster
const PD = 'dec00000-0000-4000-a000-111111111111';                   // a seeded demo property
const t = (n) => 'dddddddd-0000-4000-8000-' + String(n).padStart(12, '0');
const d = (n) => 'f0000000-0000-4000-8000-' + String(n).padStart(12, '0');
const BASE = t(1), F1 = t(2), F2 = t(3), F3 = t(4), U1 = t(5), U5 = t(6);
const ACQ = t(7), DRAFTFAM = t(8), DECIDED = t(9), E1 = t(10), E2 = t(11);
const X1 = t(41), Y1 = t(51), DM1 = t(61), DM2 = t(62);
const GHOST = 'eeeeeeee-0000-4000-8000-000000000001';                 // an id no row has
const DBASE = d(1), DF1 = d(2), DF1L = d(3), DU = d(4), DX = d(5), DP2 = d(6), DF2 = d(7);
const R1 = 'cccccccc-0000-4000-8000-000000000001', R2 = 'cccccccc-0000-4000-8000-000000000002';
const F1URL = 'leases/a/p1/1789-AMD-1st.pdf', F2URL = 'leases/a/p1/1790-AMD-2nd.pdf';

const SCHEMA = `
  insert into auth.users(id,email) values ('${A}','a@example.test'),('${B}','b@example.test'),('${M}','m@example.test');
  create table public.properties (
    id uuid primary key default gen_random_uuid(),
    user_id uuid references auth.users(id) on delete cascade,
    organization_id uuid, name text, sqft numeric, data jsonb, archived_at timestamptz,
    updated_at timestamptz default now(),
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
    property_id uuid not null references public.properties(id) on delete cascade, tenant_id text not null,
    field_key text, action text, old_value text, new_value text, created_at timestamptz not null default now());
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
  -- the acquisition tables leasehold_history reads (keys as on Pilot)
  create table public.acquisition_reviews (id uuid primary key default gen_random_uuid(), user_id uuid,
    status text not null default 'draft' check (status in ('draft','analyzing','complete','converted')),
    property_id uuid references public.properties(id) on delete set null, converted_at timestamptz);
  create table public.acquisition_document_families (id uuid primary key default gen_random_uuid(),
    review_id uuid references public.acquisition_reviews(id) on delete cascade,
    property_id uuid references public.properties(id) on delete restrict, label text not null default 'lease');
  create table public.acquisition_term_decisions (id uuid primary key default gen_random_uuid(),
    review_id uuid references public.acquisition_reviews(id) on delete cascade,
    family_id uuid references public.acquisition_document_families(id) on delete set null, field_key text not null default 'x');
  create table public.property_events (
    id uuid primary key default gen_random_uuid(),
    property_id uuid not null references public.properties(id) on delete cascade,
    organization_id uuid, actor_uid uuid references auth.users(id) on delete set null, actor_email text,
    action text not null check (length(action) >= 1 and length(action) <= 80),
    subject_type text, subject_id text, field_key text, old_value text, new_value text,
    detail jsonb not null default '{}'::jsonb, client_ts timestamptz not null default now(),
    created_at timestamptz not null default now(), source_key text);
  create unique index property_events_source_key_uniq on public.property_events (property_id, source_key) where source_key is not null;
  create index property_events_subject_idx on public.property_events (property_id, subject_type, subject_id) where subject_id is not null;
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
  -- Pilot's property_events_derive: every write to properties.data copies its
  -- activityLog and timeline into property_events (body as read from Pilot)
  create table public.property_events_watermark (property_id uuid not null primary key, established_at timestamptz not null default now(), legacy_timeline_keys text[] not null default '{}');
  create function public._p05_safe_ts(t text) returns timestamptz language plpgsql stable set search_path = '' as $f$
  begin
    if t is null or btrim(t) = '' then return null; end if;
    return t::timestamptz;
  exception when others then
    return null;
  end $f$;
  create function public._property_events_derive() returns trigger language plpgsql security definer set search_path = '' as $f$
  declare
    v_legacy text[] := '{}';
  begin
    if new.data is null or jsonb_typeof(new.data) <> 'object' then
      return null;
    end if;
    select w.legacy_timeline_keys into v_legacy from public.property_events_watermark w where w.property_id = new.id;
    if v_legacy is null then v_legacy := '{}'; end if;
    if jsonb_typeof(new.data->'activityLog') = 'array' then
      insert into public.property_events (property_id, action, subject_type, subject_id, detail, client_ts, source_key)
      select new.id, left(coalesce(nullif(btrim(e->>'type'), ''), 'unknown'), 80),
        nullif(btrim(coalesce(e->>'relatedEntity', '')), ''), nullif(btrim(coalesce(e->>'tenantId', '')), ''),
        jsonb_build_object('source', 'activityLog', 'title', coalesce(e->>'title', ''), 'detail', coalesce(e->>'detail', ''),
          'severity', coalesce(e->>'severity', 'info'), 'client_actor', coalesce(e->>'actor', '')),
        coalesce(public._p05_safe_ts(e->>'timestamp'), now()), 'activity:' || btrim(e->>'id')
      from jsonb_array_elements(new.data->'activityLog') e
      where jsonb_typeof(e) = 'object' and nullif(btrim(coalesce(e->>'id', '')), '') is not null
      on conflict (property_id, source_key) where source_key is not null do nothing;
    end if;
    if jsonb_typeof(new.data->'timeline') = 'array' then
      insert into public.property_events (property_id, action, subject_type, subject_id, detail, client_ts, source_key)
      select new.id, left(coalesce(nullif(btrim(q.e->>'type'), ''), 'unknown'), 80),
        nullif(btrim(coalesce(q.e->>'source', '')), ''), nullif(btrim(coalesce(q.e->>'tenantId', '')), ''),
        jsonb_build_object('source', 'timeline', 'title', coalesce(q.e->>'title', ''), 'description', coalesce(q.e->>'description', ''),
          'severity', coalesce(q.e->>'severity', 'info'), 'client_actor', coalesce(q.e->>'actor', ''), 'category', coalesce(q.e->>'category', '')),
        coalesce(public._p05_safe_ts(q.e->>'timestamp'), now()), 'timeline:' || q.k
      from (select e, coalesce(nullif(btrim(coalesce(e->'metadata'->>'dedupeKey', '')), ''), nullif(btrim(coalesce(e->>'id', '')), '')) as k
              from jsonb_array_elements(new.data->'timeline') e where jsonb_typeof(e) = 'object') q
      where q.k is not null and not (q.k = any (v_legacy))
      on conflict (property_id, source_key) where source_key is not null do nothing;
    end if;
    return null;
  end $f$;
  create trigger property_events_derive after insert or update of data on public.properties for each row execute function public._property_events_derive();
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

const ROSTER = [BASE, F1, F2, F3, U1].map((id, i) => ({ id, tenant_name: ['ANTHONY BASE LEASE', 'AMD-1', 'AMD-2', 'Renewal notice', 'Unreferenced Co'][i], _fileName: 'file' + i + '.pdf' }));
const P1DATA = JSON.stringify({ tenants: ROSTER, timeline: [{ id: 'tl-1', type: 'lease_uploaded', tenantId: F1, title: 'Lease uploaded' }], invoices: [] }).replace(/'/g, "''");

// Inserted BEFORE 037/039: a document whose link points at an id no row has
// can exist only from before 039's key (as on Pilot).
const FIXTURES = `
  insert into public.properties(id,user_id,name,sqft,lifecycle_stage,data) values
    ('${PM}','${A}','pilot marker',1,'acquired',null),
    ('${P1}','${A}','Miracle-shaped',30000,'acquired','${P1DATA}'::jsonb),
    ('${P2}','${A}','A acquired 2',1000,'acquired','{}'::jsonb),
    ('${P3}','${A}','A prospect',1000,'prospect','{}'::jsonb),
    ('${P4}','${B}','B acquired',1000,'acquired','{}'::jsonb),
    ('${PE}','${A}','A acquired, empty roster',1000,'acquired','{"tenants":[]}'::jsonb),
    ('${PD}','${A}','Cascade Commons (demo)',24000,'acquired','{}'::jsonb);
  insert into public.property_members(property_id,user_id) values ('${P1}','${M}');
  insert into public.tenants(id,property_id,name,sqft,cap,start_date,end_date,lease_type,lease_url) values
    ('${BASE}','${P1}','ANTHONY BASE LEASE',5145,null,'1951-04-06','1951-04-06','NNN',null),
    ('${F1}','${P1}','AMD-1',null,null,'2010-12-22',null,null,'${F1URL}'),
    ('${F2}','${P1}','AMD-2',5145,null,'2010-12-22',null,null,'${F2URL}'),
    ('${F3}','${P1}','Renewal notice',null,null,'2010-12-22','2031-11-30',null,null),
    ('${U1}','${P1}','Unreferenced Co',1000,3,'2020-01-01','2025-12-31','NNN',null),
    ('${U5}','${P1}','To be ended',800,2,'2018-01-01','2024-12-31','NNN',null),
    ('${ACQ}','${P1}','Converted acquisition leasehold',3000,null,null,null,null,null),
    ('${DRAFTFAM}','${P1}','Family on an unconverted review',100,null,null,null,null,null),
    ('${DECIDED}','${P1}','Term decision',100,null,null,null,null,null),
    ('${E1}','${PE}','E1 on empty roster',100,null,null,null,null,null),
    ('${E2}','${PE}','E2 on empty roster',100,null,null,null,null,null),
    ('${X1}','${P2}','X1 on P2',500,null,null,null,null,null),
    ('${Y1}','${P4}','Y1 on P4 (B)',700,null,null,null,null,null),
    ('${DM1}','${PD}','Whole Health Market',9200,null,null,null,'NNN',null),
    ('${DM2}','${PD}','FitZone Athletics',6800,null,null,null,'NNN',null);
  insert into public.lease_documents(id,property_id,tenant_id,tenant_name,file_name,file_url,doc_type) values
    ('${DBASE}','${P1}','${BASE}','ANTHONY','LSE-base.pdf','leases/a/p1/base.pdf','original_lease'),
    ('${DF1}','${P1}','${GHOST}','AMD-1','AMD-1st.pdf','${F1URL}','amendment'),
    ('${DF1L}','${P1}','${F1}','AMD-1','AMD-1st-copy.pdf','leases/a/p1/amd1-copy.pdf','amendment'),
    ('${DU}','${P1}',null,null,'tax-bill.pdf','leases/a/p1/tax.pdf',null),
    ('${DX}','${P1}','${U1}','Unreferenced Co','u1-lease.pdf','leases/a/p1/u1.pdf','original_lease'),
    ('${DP2}','${P2}','${X1}','X1','x1.pdf','leases/a/p2/x1.pdf','original_lease'),
    ('${DF2}','${P1}','${F2}','AMD-2','AMD-2nd.pdf','${F2URL}','amendment');
  insert into public.tenant_field_evidence(property_id,tenant_id,field_key,reviewed_at) values ('${P1}','${F2}','sqft', now());
  insert into public.acquisition_reviews(id,user_id,status,property_id,converted_at) values
    ('${R1}','${A}','converted','${P1}',now()), ('${R2}','${A}','complete','${P1}',null);
  insert into public.acquisition_document_families(id,review_id,property_id) values
    ('${ACQ}','${R1}','${P1}'), ('${DRAFTFAM}','${R2}','${P1}'), ('${DECIDED}','${R2}','${P1}');
  insert into public.acquisition_term_decisions(review_id,family_id) values ('${R2}','${DECIDED}');`;

const q = (sql, db) => pg.psql(sql, db);
const one = (sql, db) => q(sql, db).out;
const as = (role, uid, sql, db) => pg.as(role, uid, sql, db);
const json = (r) => { if (!r.ok) return { _error: r.out }; try { return JSON.parse(r.out); } catch (_) { return { _error: r.out }; } };
const rpc = (db, uid, prop, rows) =>
  json(as('authenticated', uid, `select public.resync_property_tenants('${prop}'::uuid, '${JSON.stringify(rows).replace(/'/g, "''")}'::jsonb);`, db));
const call = (db, uid, sql, role) => json(as(role || 'authenticated', uid, 'select ' + sql + ';', db));
const errOf = (r) => (r && r._error) || '';
const exists = (db, id) => one(`select exists(select 1 from public.tenants where id='${id}');`, db) === 't';
const rowOf = (db, id) => one(`select coalesce((select row(x.*)::text from public.tenants x where id='${id}'), '<none>');`, db);
const life = (db, id) => one(`select leasehold_status||'|'||coalesce(absorbed_into::text,'')||'|'||coalesce(absorbed_reason,'')||'|'||(absorbed_at is not null) from public.tenants where id='${id}';`, db);
const docOwner = (db, id) => one(`select coalesce(tenant_id::text,'null') from public.lease_documents where id='${id}';`, db);
const rev = (db, p) => one(`select data_revision from public.properties where id='${p || P1}';`, db);
const rosterIds = (db, p) => one(`select coalesce(string_agg(e->>'id', ',' order by o), '') from public.properties, jsonb_array_elements(data->'tenants') with ordinality x(e,o) where id='${p || P1}';`, db);
const events = (db, id, action) => one(`select count(*) from public.property_events where subject_id='${id}'${action ? ` and action='${action}'` : ''};`, db);
const absorb = (db, uid, src, tgt, docs, extra) => {
  const o = Object.assign({ reason: 'document_of', note: 'fragment of the base lease', rev: null }, extra || {});
  const r = o.rev === null ? rev(db, one(`select property_id from public.tenants where id='${src}';`, db) || P1) : o.rev;
  const arr = docs === null ? 'null' : `array[${(docs || []).map(x => `'${x}'`).join(',')}]::uuid[]`;
  const reason = o.reason === null ? 'null' : `'${o.reason}'`;
  const note = o.note === null ? 'null' : `'${o.note}'`;
  return call(db, uid, `public.absorb_leasehold('${src}', '${tgt}', ${reason}, ${arr}, ${note}, ${r === '' ? 'null' : r})`, o.role);
};
const restore = (db, uid, id, note) => call(db, uid, `public.restore_absorbed_leasehold('${id}', ${note === null ? 'null' : `'${note || 'wrong target'}'`})`);
const TABLES = ['properties', 'property_members', 'tenants', 'cam_reconciliations', 'lease_provisions', 'tenant_review_audit', 'lease_documents',
  'tenant_field_evidence', 'payments', 'tenant_users', 'tenant_statements', 'tenant_documents', 'tenant_invitations', 'tenant_space_profiles',
  'lease_jobs', 'property_events', 'acquisition_reviews', 'acquisition_document_families', 'acquisition_term_decisions'];
const NEWCOLS = `array['data_revision','absorbed_into','absorbed_reason','absorbed_at']`;
/** Every row of every table, ignoring the four columns 043 adds (so it compares across 043's apply and rollback). */
const dataFp = (db) => one(`select md5(${TABLES.map(n => `coalesce((select string_agg(md5((to_jsonb(x) - ${NEWCOLS})::text), '' order by (to_jsonb(x) - ${NEWCOLS})::text) from public.${n} x), '${n}:empty')`).join(' || ')});`, db);
const fullFp = (db) => one(`select md5(${TABLES.map(n => `coalesce((select string_agg(md5(to_jsonb(x)::text), '' order by to_jsonb(x)::text) from public.${n} x), '${n}:empty')`).join(' || ')});`, db);
const catalog = (db, only) => one(`
  select md5(string_agg(x, '|' order by x)) from (
    ${only === 'policies' ? `
    select 'p:' || tablename || '.' || policyname || ':' || coalesce(qual,'') || ':' || coalesce(with_check,'') x from pg_policies where schemaname='public'
    union all select 'r:' || relname || ':' || relrowsecurity from pg_class where relnamespace='public'::regnamespace and relkind='r'` : `
    select 'c:' || table_name || '.' || column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default,'') x
      from information_schema.columns where table_schema='public'
    union all select 'k:' || conrelid::regclass::text || '.' || conname || ':' || pg_get_constraintdef(oid) || ':' || convalidated
      from pg_constraint where connamespace='public'::regnamespace
    union all select 'i:' || indexname || ':' || indexdef from pg_indexes where schemaname='public'
    union all select 'p:' || tablename || '.' || policyname || ':' || coalesce(qual,'') || ':' || coalesce(with_check,'') from pg_policies where schemaname='public'
    union all select 'r:' || relname || ':' || relrowsecurity from pg_class where relnamespace='public'::regnamespace and relkind='r'
    union all select 'g:' || table_name || ':' || grantee || ':' || privilege_type from information_schema.role_table_grants where table_schema='public'
    union all select 'f:' || p.oid::regprocedure::text || ':' || md5(prosrc) || ':' || coalesce(proacl::text,'') || ':' || prosecdef || ':' || coalesce(array_to_string(proconfig, ','),'') || ':' || coalesce(obj_description(p.oid, 'pg_proc'),'')
      from pg_proc p where pronamespace='public'::regnamespace
    union all select 'd:' || c.relname || '.' || a.attname || ':' || coalesce(col_description(c.oid, a.attnum),'')
      from pg_attribute a join pg_class c on c.oid = a.attrelid where c.relnamespace='public'::regnamespace and c.relkind='r' and a.attnum > 0 and not a.attisdropped
    union all select 't:' || tgname || ':' || pg_get_triggerdef(oid) from pg_trigger where not tgisinternal and tgrelid in (select oid from pg_class where relnamespace='public'::regnamespace)`}
  ) s;`, db);
const fnMd5 = (db, sig) => one(`select coalesce((select md5(prosrc) from pg_proc where oid=to_regprocedure('public.${sig}')), '<missing>');`, db);

/** A database in Pilot's current state (037 + 039 + 038 applied), optionally with 043. */
function fresh(name, with043) {
  pg.database(name, 'legacy');
  const steps = [['schema', q(SCHEMA, name)], ['fixtures', q(FIXTURES, name)],
    ['037', pg.psqlText(M037, name, '037-' + name)], ['039', pg.psqlText(M039, name, '039-' + name)], ['038', pg.psqlText(M038, name, '038-' + name)]];
  if (with043) steps.push(['043', pg.psqlText(M043, name, '043-' + name)]);
  const bad = steps.find(([, r]) => !r.ok);
  if (bad) throw new Error(`fresh(${name}) failed at ${bad[0]}: ${bad[1].out.slice(0, 600)}`);
  return name;
}

// ── 1 · apply ────────────────────────────────────────────────────────────────
section('1 · the 038 baseline is Pilot\'s live bodies; 043 applies, and again; no row written');
const DB = fresh('m043', false);
check('the installed resync, lifecycle guard and discard are Pilot\'s live 038 bodies',
  fnMd5(DB, 'resync_property_tenants(uuid,jsonb)') === LIVE.resync && fnMd5(DB, 'tenants_lifecycle_guard()') === LIVE.guard && fnMd5(DB, 'discard_leasehold(uuid,text)') === LIVE.discard);
check('   …and the delete guard, end_leasehold and reactivate_leasehold too',
  fnMd5(DB, 'tenants_delete_guard()') === LIVE.del && fnMd5(DB, 'end_leasehold(uuid,date,text,text)') === LIVE.end && fnMd5(DB, 'reactivate_leasehold(uuid,text)') === LIVE.react);
const dataBefore = dataFp(DB), policiesBefore = catalog(DB, 'policies'), catalogPre043 = catalog(DB);
const a1 = pg.psqlText(M043, DB, 'm043');
check('043 applies', a1.ok, a1.ok ? '' : a1.out.slice(0, 500));
check('applying it writes no row (every table fingerprinted, the new columns aside)', dataFp(DB) === dataBefore);
check('   …existing rows read the new columns\' defaults: data_revision 0, no absorption fields',
  one(`select count(*) from public.properties where data_revision <> 0;`, DB) === '0'
  && one(`select count(*) from public.tenants where absorbed_into is not null or absorbed_reason is not null or absorbed_at is not null;`, DB) === '0');
const catalogAfter = catalog(DB), fullAfter = fullFp(DB);
const a2 = pg.psqlText(M043, DB, 'm043-again');
check('043 applies again (re-runnable)', a2.ok, a2.ok ? '' : a2.out.slice(0, 300));
check('   …and the second apply changes nothing', catalog(DB) === catalogAfter && fullFp(DB) === fullAfter);
check('the precondition refuses a database without 038 (039\'s resync)', (() => {
  pg.database('m043no38', 'legacy'); q(SCHEMA, 'm043no38'); q(FIXTURES, 'm043no38');
  pg.psqlText(M037, 'm043no38', 'x037'); pg.psqlText(M039, 'm043no38', 'x039');
  const r = pg.psqlText(M043, 'm043no38', 'm043-no38');
  return !r.ok && /is not 038''?s body/.test(r.out) && one(`select count(*) from information_schema.columns where table_name='tenants' and column_name='absorbed_into';`, 'm043no38') === '0';
})());
check('the precondition refuses a discard body it was not written against', (() => {
  const X = fresh('m043pre', false);
  q(`create or replace function public.discard_leasehold(p_tenant_id uuid, p_note text) returns jsonb language sql as $f$ select '{}'::jsonb $f$;`, X);
  const r = pg.psqlText(M043, X, 'm043-pre');
  return !r.ok && /discard_leasehold is not 038/.test(r.out);
})());
check('the precondition refuses a database without the Pilot marker', (() => {
  const X = fresh('m043nomark', false);
  q(`alter table public.property_events disable trigger property_events_append_only; delete from public.properties where id='${PM}';`, X);
  const r = pg.psqlText(M043, X, 'm043-nomark');
  return !r.ok && /pilot marker property not found/.test(r.out);
})());

// ── 2 · inventory ────────────────────────────────────────────────────────────
section('2 · exact inventory');
{
  const cols = one(`select string_agg(table_name||'.'||column_name||':'||data_type||':'||is_nullable||':'||coalesce(column_default,''), ' ; ' order by table_name, column_name)
                      from information_schema.columns where table_schema='public' and column_name in ('absorbed_into','absorbed_reason','absorbed_at','data_revision');`, DB);
  check('four columns: tenants.absorbed_into / absorbed_reason / absorbed_at (nullable), properties.data_revision (bigint not null default 0)',
    cols === 'properties.data_revision:bigint:NO:0 ; tenants.absorbed_at:timestamp with time zone:YES: ; tenants.absorbed_into:uuid:YES: ; tenants.absorbed_reason:text:YES:', cols);
  const cons = one(`select string_agg(conname||'='||pg_get_constraintdef(oid), ' ; ' order by conname) from pg_constraint where conrelid='public.tenants'::regclass and conname like 'tenants\\_%' and contype in ('c','f');`, DB);
  check('tenants_leasehold_status_chk: active | ended | absorbed', /tenants_leasehold_status_chk=CHECK \(\(leasehold_status = ANY \(ARRAY\['active'::text, 'ended'::text, 'absorbed'::text\]\)\)\)/.test(cons), cons.slice(0, 200));
  check('037\'s tenants_ended_consistency_chk replaced by tenants_lifecycle_consistency_chk', !/tenants_ended_consistency_chk/.test(cons) && /tenants_lifecycle_consistency_chk=CHECK/.test(cons));
  check('tenants_ended_reason_chk (037) untouched', /tenants_ended_reason_chk=CHECK \(\(\(ended_reason IS NULL\) OR \(ended_reason = ANY/.test(cons));
  check('tenants_absorbed_reason_chk and tenants_absorbed_not_self_chk', /tenants_absorbed_reason_chk=CHECK \(\(\(absorbed_reason IS NULL\) OR \(absorbed_reason = ANY \(ARRAY\['duplicate'::text, 'document_of'::text\]\)\)\)\)/.test(cons)
    && /tenants_absorbed_not_self_chk=CHECK \(\(\(absorbed_into IS NULL\) OR \(absorbed_into <> id\)\)\)/.test(cons));
  check('tenants_absorbed_into_fk: (absorbed_into, property_id) → tenants(id, property_id), NO ACTION', /tenants_absorbed_into_fk=FOREIGN KEY \(absorbed_into, property_id\) REFERENCES tenants\(id, property_id\)(?! ON)/.test(cons), cons.match(/tenants_absorbed_into_fk=[^;]*/)?.[0]);
  const idx = one(`select string_agg(indexdef, ' ; ' order by indexname) from pg_indexes where indexname in ('tenants_absorbed_into_idx','property_events_leasehold_discarded_idx');`, DB);
  check('two partial indexes', /tenants_absorbed_into_idx ON public\.tenants USING btree \(absorbed_into\) WHERE \(absorbed_into IS NOT NULL\)/.test(idx)
    && /property_events_leasehold_discarded_idx ON public\.property_events USING btree \(subject_id\) WHERE \(action = 'leasehold_discarded'::text\)/.test(idx), idx);
  check('no policy and no RLS flag changed', catalog(DB, 'policies') === policiesBefore);
  const trg = one(`select string_agg(tgname || '=' || pg_get_triggerdef(oid), ' ; ' order by tgname) from pg_trigger where tgrelid in ('public.tenants'::regclass,'public.properties'::regclass) and not tgisinternal;`, DB);
  check('tenants_lifecycle_guard now also fires on the three absorption columns',
    /tenants_lifecycle_guard=CREATE TRIGGER tenants_lifecycle_guard BEFORE INSERT OR UPDATE OF leasehold_status, ended_at, ended_reason, absorbed_into, absorbed_reason, absorbed_at ON public\.tenants FOR EACH ROW/.test(trg), trg.slice(0, 300));
  check('tenants_absorbed_freeze BEFORE UPDATE, tenants_tombstone_guard BEFORE INSERT, properties_data_revision BEFORE INSERT OR UPDATE',
    /tenants_absorbed_freeze=CREATE TRIGGER tenants_absorbed_freeze BEFORE UPDATE ON public\.tenants FOR EACH ROW/.test(trg)
    && /tenants_tombstone_guard=CREATE TRIGGER tenants_tombstone_guard BEFORE INSERT ON public\.tenants FOR EACH ROW/.test(trg)
    && /properties_data_revision=CREATE TRIGGER properties_data_revision BEFORE INSERT OR UPDATE ON public\.properties FOR EACH ROW/.test(trg));
  check('tenants_delete_guard and tenants_property_immutable still there, untouched',
    /tenants_delete_guard=CREATE TRIGGER tenants_delete_guard BEFORE DELETE ON public\.tenants FOR EACH ROW/.test(trg) && /tenants_property_immutable=CREATE TRIGGER tenants_property_immutable BEFORE UPDATE OF property_id/.test(trg));
  check('tenants_delete_guard, end_leasehold and reactivate_leasehold are byte-identical to 038\'s',
    fnMd5(DB, 'tenants_delete_guard()') === LIVE.del && fnMd5(DB, 'end_leasehold(uuid,date,text,text)') === LIVE.end && fnMd5(DB, 'reactivate_leasehold(uuid,text)') === LIVE.react);
  check('resync, lifecycle guard and discard now carry 043\'s bodies',
    fnMd5(DB, 'resync_property_tenants(uuid,jsonb)') === B043.resync && fnMd5(DB, 'tenants_lifecycle_guard()') === B043.guard && fnMd5(DB, 'discard_leasehold(uuid,text)') === B043.discard);
  const fnInfo = (sig) => one(`select prosecdef || '|' || coalesce(array_to_string(proconfig, ','),'') from pg_proc where oid='public.${sig}'::regprocedure;`, DB);
  const API = ['absorb_leasehold(uuid,uuid,text,uuid[],text,bigint)', 'restore_absorbed_leasehold(uuid,text)', 'absorb_leasehold_preflight(uuid,uuid)'];
  const INTERNAL = ['leasehold_history(uuid)', 'has_meaningful_history(uuid)', '_absorb_eligibility(uuid,uuid)', '_leasehold_tombstoned(uuid)',
    'tenants_absorbed_freeze()', 'tenants_tombstone_guard()', 'properties_data_revision()'];
  check('every new function but _is_demo_property: SECURITY DEFINER, search_path=public', [...API, ...INTERNAL].every(s => fnInfo(s) === 'true|search_path=public'), [...API, ...INTERNAL].map(fnInfo).join(' '));
  check('_is_demo_property: a pure SQL test, search_path=public', fnInfo('_is_demo_property(uuid)') === 'false|search_path=public');
  const canX = (role, sig) => pg.canExecute(role, 'public.' + sig, DB);
  check('absorb, restore, preflight: executable by authenticated and service_role', API.every(s => canX('authenticated', s) && canX('service_role', s)));
  check('   …and NOT by anon', API.every(s => !canX('anon', s)));
  check('the internal and trigger functions: executable by none of the API roles',
    [...INTERNAL, '_is_demo_property(uuid)'].every(s => !canX('anon', s) && !canX('authenticated', s) && !canX('service_role', s)));
  check('end / reactivate / discard grants unchanged (authenticated, service_role; not anon)',
    ['end_leasehold(uuid,date,text,text)', 'reactivate_leasehold(uuid,text)', 'discard_leasehold(uuid,text)'].every(s => canX('authenticated', s) && canX('service_role', s) && !canX('anon', s)));
  const newFns = one(`select string_agg(proname, ',' order by proname) from pg_proc where pronamespace='public'::regnamespace and proname in
    ('absorb_leasehold','restore_absorbed_leasehold','absorb_leasehold_preflight','leasehold_history','has_meaningful_history','_absorb_eligibility','_is_demo_property','_leasehold_tombstoned','tenants_absorbed_freeze','tenants_tombstone_guard','properties_data_revision');`, DB);
  check('eleven functions added', newFns.split(',').length === 11, newFns);
}

// ── 3 · the state ────────────────────────────────────────────────────────────
section('3 · active | ended | absorbed, and nothing in between');
{
  const S = fresh('m043state', true);
  // The lifecycle flag lets these reach the checks, which is what is tested here.
  const setAs = (id, sets) => q(`select set_config('mainstreet.leasehold_lifecycle', '${id}', true); update public.tenants set ${sets} where id='${id}';`, S);
  const chk = (r, name) => !r.ok && new RegExp('violates check constraint "' + name + '"').test(r.out);
  check('absorbed without a pointer: refused', chk(setAs(U1, `leasehold_status='absorbed', absorbed_reason='duplicate', absorbed_at=now()`), 'tenants_lifecycle_consistency_chk'));
  check('absorbed without a reason: refused', chk(setAs(U1, `leasehold_status='absorbed', absorbed_into='${BASE}', absorbed_at=now()`), 'tenants_lifecycle_consistency_chk'));
  check('absorbed without absorbed_at: refused', chk(setAs(U1, `leasehold_status='absorbed', absorbed_into='${BASE}', absorbed_reason='duplicate'`), 'tenants_lifecycle_consistency_chk'));
  check('absorbed AND ended: refused', chk(setAs(U1, `leasehold_status='absorbed', absorbed_into='${BASE}', absorbed_reason='duplicate', absorbed_at=now(), ended_at='2025-01-01', ended_reason='other'`), 'tenants_lifecycle_consistency_chk'));
  check('active with a pointer: refused', chk(setAs(U1, `absorbed_into='${BASE}'`), 'tenants_lifecycle_consistency_chk'));
  check('ended with an absorption field: refused', chk(setAs(U1, `leasehold_status='ended', ended_at='2025-01-01', ended_reason='other', absorbed_reason='duplicate'`), 'tenants_lifecycle_consistency_chk'));
  check('an unknown reason: refused', chk(setAs(U1, `leasehold_status='absorbed', absorbed_into='${BASE}', absorbed_reason='merged', absorbed_at=now()`), 'tenants_absorbed_reason_chk'));
  check('an unknown status: refused', chk(setAs(U1, `leasehold_status='superseded'`), 'tenants_leasehold_status_chk'));
  check('a pointer to itself: refused', chk(setAs(U1, `leasehold_status='absorbed', absorbed_into='${U1}', absorbed_reason='duplicate', absorbed_at=now()`), 'tenants_absorbed_not_self_chk'));
  check('a pointer to another property\'s leasehold: refused by the same-property key',
    /violates foreign key constraint "tenants_absorbed_into_fk"/.test(setAs(U1, `leasehold_status='absorbed', absorbed_into='${X1}', absorbed_reason='duplicate', absorbed_at=now()`).out));
  check('a pointer to no leasehold: refused', /violates foreign key constraint "tenants_absorbed_into_fk"/.test(setAs(U1, `leasehold_status='absorbed', absorbed_into='${GHOST}', absorbed_reason='duplicate', absorbed_at=now()`).out));
  check('a consistent absorbed row is accepted', setAs(U1, `leasehold_status='absorbed', absorbed_into='${BASE}', absorbed_reason='duplicate', absorbed_at=now()`).ok && life(S, U1) === `absorbed|${BASE}|duplicate|true`);
}

// ── 4 · guards ───────────────────────────────────────────────────────────────
section('4 · guards: the absorption columns, the freeze, the tombstone');
{
  const G = fresh('m043guard', true);
  const lifeErr = (r) => !r.ok && /changes only through end_leasehold, reactivate_leasehold, absorb_leasehold or restore_absorbed_leasehold|A new leasehold is always active/.test(r.out);
  const setAbs = `update public.tenants set leasehold_status='absorbed', absorbed_into='${BASE}', absorbed_reason='duplicate', absorbed_at=now() where id='${F3}';`;
  check('owner, direct UPDATE to absorbed: refused', lifeErr(as('authenticated', A, setAbs, G)) && life(G, F3) === 'active|||false');
  check('member: refused', lifeErr(as('authenticated', M, setAbs, G)));
  check('service role: refused', lifeErr(as('service_role', null, setAbs, G)));
  check('table owner / superuser: refused', lifeErr(q(setAbs, G)) && life(G, F3) === 'active|||false');
  check('changing only absorbed_at / absorbed_reason / absorbed_into of an active row directly: refused',
    lifeErr(q(`update public.tenants set absorbed_at=now() where id='${F3}';`, G)) && lifeErr(q(`update public.tenants set absorbed_reason='duplicate' where id='${F3}';`, G))
    && lifeErr(q(`update public.tenants set absorbed_into='${BASE}' where id='${F3}';`, G)));
  check('INSERT of an absorbed leasehold: refused for every role',
    lifeErr(q(`insert into public.tenants(id,property_id,name,leasehold_status,absorbed_into,absorbed_reason,absorbed_at) values ('${t(30)}','${P1}','born absorbed','absorbed','${BASE}','duplicate',now());`, G))
    && lifeErr(as('service_role', null, `insert into public.tenants(id,property_id,name,absorbed_reason) values ('${t(30)}','${P1}','born with a reason','duplicate');`, G)) && !exists(G, t(30)));
  check('an UPDATE naming the six columns without changing them passes',
    q(`update public.tenants set leasehold_status=leasehold_status, ended_at=ended_at, ended_reason=ended_reason, absorbed_into=absorbed_into, absorbed_reason=absorbed_reason, absorbed_at=absorbed_at where property_id='${P1}';`, G).ok);
  check('038 still holds: a direct change to ended is refused', lifeErr(q(`update public.tenants set leasehold_status='ended', ended_at='2025-01-01', ended_reason='other' where id='${U1}';`, G)));
  // Absorb F1 for real, then try to change it.
  const r = absorb(G, A, F1, BASE, [DF1L]);
  check('   (absorb AMD-1 into the base lease through absorb_leasehold)', r.ok === true, JSON.stringify(r).slice(0, 200));
  const frozenErr = (x) => !x.ok && /was consolidated into [0-9a-f-]+ and is kept as history; restore it/.test(x.out);
  const before = rowOf(G, F1);
  check('an absorbed row is FROZEN: the owner cannot rename it', frozenErr(as('authenticated', A, `update public.tenants set name='renamed' where id='${F1}';`, G)) && rowOf(G, F1) === before);
  check('   …nor can the service role change its sqft', frozenErr(as('service_role', null, `update public.tenants set sqft=1 where id='${F1}';`, G)));
  check('   …nor the table owner change its dates', frozenErr(q(`update public.tenants set end_date='2099-01-01' where id='${F1}';`, G)) && rowOf(G, F1) === before);
  check('   …nor anyone move its pointer', !q(`update public.tenants set absorbed_into='${F2}' where id='${F1}';`, G).ok && life(G, F1).startsWith(`absorbed|${BASE}|`));
  check('   …an UPDATE that changes nothing on it still passes', q(`update public.tenants set name=name where id='${F1}';`, G).ok);
  check('   …the direct-write fallback\'s upsert shape cannot change it',
    !q(`insert into public.tenants(id,property_id,name,sqft) values ('${F1}','${P1}','stale tab',1) on conflict (id) do update set name=excluded.name, sqft=excluded.sqft;`, G).ok && rowOf(G, F1) === before);
  check('the lifecycle flag does not outlive absorb_leasehold: a direct change in the same transaction is refused',
    (() => { const x = as('authenticated', A, `select public.absorb_leasehold('${F3}', '${BASE}', 'document_of', null, 'n', (select data_revision from public.properties where id='${P1}')); update public.tenants set absorbed_reason='duplicate' where id='${F3}';`, G);
      return !x.ok && life(G, F3) === 'active|||false'; })());
  // Tombstones.
  const d1 = call(G, A, `public.discard_leasehold('${U5}', 'entered in error')`);
  check('   (discard U5 through discard_leasehold)', d1.ok === true, JSON.stringify(d1).slice(0, 160));
  const tombErr = (x) => !x.ok && /was discarded as a record entered in error and is not re-created/.test(x.out);
  check('a DISCARDED id is never re-created: owner INSERT refused', tombErr(as('authenticated', A, `insert into public.tenants(id,property_id,name) values ('${U5}','${P1}','back from the dead');`, G)) && !exists(G, U5));
  check('   …service role refused', tombErr(as('service_role', null, `insert into public.tenants(id,property_id,name) values ('${U5}','${P1}','x');`, G)));
  check('   …table owner refused', tombErr(q(`insert into public.tenants(id,property_id,name) values ('${U5}','${P1}','x');`, G)));
  check('   …the direct-write fallback\'s upsert refused', tombErr(q(`insert into public.tenants(id,property_id,name) values ('${U5}','${P1}','x') on conflict (id) do update set name=excluded.name;`, G)) && !exists(G, U5));
  check('   …under another property too', tombErr(q(`insert into public.tenants(id,property_id,name) values ('${U5}','${P2}','x');`, G)));
  // What is NOT a tombstone.
  q(`insert into public.property_events(property_id,action,subject_type,subject_id,detail) values ('${P1}','leasehold_discarded','leasehold','${t(31)}','{"source":"timeline"}');`, G);
  check('a leasehold_discarded event from any other source (a copied timeline entry) is no tombstone',
    q(`insert into public.tenants(id,property_id,name) values ('${t(31)}','${P1}','not really discarded');`, G).ok && exists(G, t(31)));
  as('authenticated', M, `insert into public.property_events(property_id,action,subject_type,subject_id,detail) values ('${P1}','leasehold_discarded','leasehold','${U1}','{"source":"discard_leasehold"}');`, G);
  check('a forged tombstone for a leasehold that EXISTS blocks nothing: its upsert still writes',
    q(`insert into public.tenants(id,property_id,name) values ('${U1}','${P1}','U1 still here') on conflict (id) do update set name=excluded.name;`, G).ok
    && one(`select name from public.tenants where id='${U1}';`, G) === 'U1 still here');
}

// ── 5 · data_revision ────────────────────────────────────────────────────────
section('5 · properties.data_revision is the database\'s, not the caller\'s');
{
  const V = fresh('m043rev', true);
  const r0 = rev(V);
  q(`update public.properties set data = data || '{"x":1}'::jsonb where id='${P1}';`, V);
  check('a change to data: +1', rev(V) === String(+r0 + 1), r0 + ' → ' + rev(V));
  q(`update public.properties set name='renamed' where id='${P1}';`, V);
  check('a change to name: +1', rev(V) === String(+r0 + 2));
  q(`update public.properties set sqft=31000 where id='${P1}';`, V);
  check('a change to sqft: +1', rev(V) === String(+r0 + 3));
  q(`update public.properties set archived_at=null, data=data where id='${P1}';`, V);
  check('an update that changes none of the three: unchanged', rev(V) === String(+r0 + 3));
  as('authenticated', A, `update public.properties set data_revision=999 where id='${P1}';`, V);
  check('the owner setting data_revision directly: ignored', rev(V) === String(+r0 + 3));
  as('authenticated', A, `update public.properties set data_revision=0, data=data || '{"y":2}'::jsonb where id='${P1}';`, V);
  check('   …and setting it alongside a real change: still exactly +1', rev(V) === String(+r0 + 4));
  q(`insert into public.properties(id,user_id,name,data,data_revision) values ('${t(99)}','${A}','new',null,42);`, V);
  check('an insert always starts at 0, whatever is sent', rev(V, t(99)) === '0');
  const up = as('authenticated', A, `insert into public.properties(id,user_id,name,sqft,data) values ('${P1}','${A}','client save',30000,'{"tenants":[]}'::jsonb) on conflict (id) do update set name=excluded.name, sqft=excluded.sqft, data=excluded.data;`, V);
  check('the client\'s save shape (upsert of id, name, sqft, data) still works, and counts', up.ok && rev(V) === String(+r0 + 5), up.out.slice(0, 160));
}

// ── 6 · resync ───────────────────────────────────────────────────────────────
section('6 · resync: a stale tab cannot resurrect, 038\'s rules still hold');
{
  // The gap, on Pilot's CURRENT (038) bodies.
  const G = fresh('m043gap', false);
  const d1 = call(G, A, `public.discard_leasehold('${U5}', 'entered in error')`);
  const r = rpc(G, A, P1, [{ id: U5, name: 'To be ended' }, { id: U1, name: 'Unreferenced Co' }]);
  check('BEFORE 043: a stale roster still holding a DISCARDED leasehold re-creates it (the gap)',
    d1.ok === true && r.ok === true && exists(G, U5), JSON.stringify(r).slice(0, 160));
}
{
  const R = fresh('m043rs', true);
  call(R, A, `public.discard_leasehold('${U5}', 'entered in error')`);
  const a = absorb(R, A, F1, BASE, [DF1L]);
  check('   (discard U5; absorb AMD-1 into the base lease)', a.ok === true, JSON.stringify(a).slice(0, 160));
  const f1Before = rowOf(R, F1);
  const stale = [BASE, F1, F2, F3, U1, U5].map(id => ({ id, name: 'stale ' + id.slice(-2), sqft: 1 }));
  const r = rpc(R, A, P1, stale);
  check('a stale roster holding a discarded and an absorbed leasehold: ok, nothing deleted', r.ok === true && r.deleted === 0, JSON.stringify(r).slice(0, 240));
  check('   …the discarded leasehold is NOT re-created', !exists(R, U5));
  check('   …it is reported: discarded_in_roster = [U5]', JSON.stringify(r.discarded_in_roster) === JSON.stringify([U5]));
  check('   …the absorbed leasehold is not written: byte-identical, still absorbed', rowOf(R, F1) === f1Before && life(R, F1).startsWith(`absorbed|${BASE}|document_of|`));
  check('   …it is reported: absorbed_in_roster = [F1]', JSON.stringify(r.absorbed_in_roster) === JSON.stringify([F1]));
  check('   …the active ones are written (4 upserted)', r.upserted === 4 && one(`select name from public.tenants where id='${BASE}';`, R) === 'stale 01');
  const r2 = rpc(R, A, P1, [{ id: BASE, name: 'Base' }]);
  check('an absorbed leasehold absent from a roster is not in absent_active (it is history, not missing)',
    r2.ok && !(r2.absent_active || []).includes(F1) && (r2.absent_active || []).includes(F2), JSON.stringify(r2.absent_active));
  check('the report\'s keys: every 038 key, plus absorbed_in_roster and discarded_in_roster',
    ['ok', 'property_id', 'upserted', 'skipped', 'deleted', 'retained_referenced', 'inserted', 'absent_active', 'ended_in_roster', 'absorbed_in_roster', 'discarded_in_roster'].every(k => k in r)
    && Object.keys(r).length === 11);
  // 038's rules, again, on 043's body.
  call(R, A, `public.end_leasehold('${U1}', '2025-03-31', 'surrendered', null)`);
  const u1Before = rowOf(R, U1);
  const e = rpc(R, A, P1, [{ id: U1, name: 'overwrite?', sqft: 9 }, { id: BASE, name: 'Base' }]);
  check('038: an ended leasehold in the roster is not written and is reported', e.ok && rowOf(R, U1) === u1Before && JSON.stringify(e.ended_in_roster) === JSON.stringify([U1]));
  const n = t(20);
  const c = rpc(R, A, P1, [{ id: n, name: 'New upload' }]);
  check('038: a roster of one new leasehold deletes nothing and inserts it active', c.ok && c.deleted === 0 && exists(R, n) && [BASE, F2, F3].every(id => exists(R, id)));
  check('032: an id from another property refuses the call', rpc(R, A, P1, [{ id: X1, name: 'moved?' }]).code === 'cross_property_tenant');
  check('032: a prospect is refused', rpc(R, A, P3, [{ id: t(21), name: 'p' }]).code === 'property_not_acquired');
  check('032: another user and a member are not_authorized', rpc(R, B, P1, [{ id: BASE, name: 'x' }]).code === 'not_authorized' && rpc(R, M, P1, [{ id: BASE, name: 'x' }]).code === 'not_authorized');
  check('an empty roster is a no-op', rpc(R, A, P1, []).noop_reason === 'empty_roster');
  check('a roster row carrying lifecycle or absorption fields writes none of them',
    rpc(R, A, P1, [{ id: F2, name: 'AMD-2', leasehold_status: 'absorbed', absorbed_into: BASE, absorbed_reason: 'duplicate' }]).ok && life(R, F2) === 'active|||false');
}

// ── 7 · leasehold_history ────────────────────────────────────────────────────
section('7 · leasehold_history: one reason per kind of permanent history');
{
  const L = fresh('m043hist', true);
  const hist = (id) => JSON.parse(one(`select public.leasehold_history('${id}')::text;`, L));
  const codes = (id) => hist(id).map(h => h.code).join(',');
  check('a clean leasehold has no history', JSON.stringify(hist(F3)) === '[]' && one(`select public.has_meaningful_history('${F3}');`, L) === 'f');
  check('unreviewed extraction evidence (reviewed_at set) is NOT history', codes(F2) === '');
  const cases = [
    ['ended', 'lifecycle', (id) => `select public.end_leasehold('${id}', '2025-01-31', 'lease_expired', null);`, true],
    ['a CAM reconciliation', 'cam', (id) => `insert into public.cam_reconciliations(property_id,tenant_id) values ('${P1}','${id}');`],
    ['a payment', 'payments', (id) => `insert into public.payments(property_id,tenant_id) values ('${P1}','${id}');`],
    ...['tenant_users', 'tenant_statements', 'tenant_documents', 'tenant_invitations', 'tenant_space_profiles'].map(n =>
      ['a row in ' + n, 'portal', (id) => `insert into public.${n}(property_id,tenant_id) values ('${P1}','${id}');`]),
    ['a lease provision', 'provisions', (id) => `insert into public.lease_provisions(property_id,tenant_id) values ('${P1}','${id}');`],
    ['evidence a person approved', 'reviewed_evidence', (id) => `insert into public.tenant_field_evidence(property_id,tenant_id,field_key,approved) values ('${P1}','${id}','cap',true);`],
    ['evidence a person edited', 'reviewed_evidence', (id) => `insert into public.tenant_field_evidence(property_id,tenant_id,field_key,manually_edited) values ('${P1}','${id}','cap',true);`],
    ['evidence with a reviewer uid', 'reviewed_evidence', (id) => `insert into public.tenant_field_evidence(property_id,tenant_id,field_key,reviewer_uid) values ('${P1}','${id}','cap','${A}');`],
    ['evidence with a reviewer email', 'reviewed_evidence', (id) => `insert into public.tenant_field_evidence(property_id,tenant_id,field_key,reviewer_email) values ('${P1}','${id}','cap','a@example.test');`],
    ['a review audit entry', 'review_audit', (id) => `insert into public.tenant_review_audit(property_id,tenant_id,action) values ('${P1}','${id}','tenant_confirmed');`],
    ['a manual_* history event', 'history_events', (id) => `insert into public.property_events(property_id,action,subject_id) values ('${P1}','manual_maintenance','${id}');`],
    ['a space_* history event', 'history_events', (id) => `insert into public.property_events(property_id,action,subject_type,subject_id) values ('${P1}','space_maintenance','manual','${id}');`],
    ['a dispute_* event', 'disputes', (id) => `insert into public.property_events(property_id,action,subject_id) values ('${P1}','dispute_created','${id}');`],
    ['a dispute in the property record', 'disputes', (id) => `update public.properties set data = jsonb_set(coalesce(data,'{}'), '{disputes}', coalesce(data->'disputes','[]') || jsonb_build_array(jsonb_build_object('id','dsp-${id.slice(-3)}','tenantId','${id}'))) where id='${P1}';`],
    ['a reactivation event', 'lifecycle', (id) => `insert into public.property_events(property_id,action,subject_type,subject_id) values ('${P1}','leasehold_reactivated','leasehold','${id}');`],
  ];
  cases.forEach(([what, code, sql, asOwner], i) => {
    const id = t(100 + i);
    q(`insert into public.tenants(id,property_id,name) values ('${id}','${P1}','history ${i}');`, L);
    const r = asOwner ? as('authenticated', A, sql(id), L) : q(sql(id), L);
    check(`${what} → ${code}`, r.ok && codes(id) === code && one(`select public.has_meaningful_history('${id}');`, L) === 't', r.ok ? codes(id) : r.out.slice(0, 120));
  });
  {
    // Ended with no event: what a pre-038 direct end left behind. The status alone is history.
    const id = t(130);
    q(`insert into public.tenants(id,property_id,name) values ('${id}','${P1}','ended before 038');
       select set_config('mainstreet.leasehold_lifecycle', '${id}', true);
       update public.tenants set leasehold_status='ended', ended_at='2024-12-31', ended_reason='surrendered' where id='${id}';`, L);
    const h = hist(id);
    check('an ENDED leasehold with no event at all → lifecycle (the status alone is history)',
      events(L, id) === '0' && h.length === 1 && h[0].code === 'lifecycle' && h[0].count === 1, JSON.stringify(h));
  }
  check('an acquisition grouping with the id on a CONVERTED review → acquisition', codes(ACQ) === 'acquisition');
  check('the same on a review not converted is not history', codes(DRAFTFAM) === '');
  check('a term decision on the grouping → acquisition_decisions', codes(DECIDED) === 'acquisition_decisions');
  const notHist = ['lease_uploaded', 'review_confirmed', 'sync_restored', 'cam_reconciled', 'leasehold_absorbed', 'leasehold_absorbed_other', 'leasehold_restored', 'leasehold_restored_other', 'leasehold_discarded'];
  notHist.forEach((action, i) => {
    const id = t(140 + i);
    q(`insert into public.tenants(id,property_id,name) values ('${id}','${P1}','not history ${i}'); insert into public.property_events(property_id,action,subject_type,subject_id,detail) values ('${P1}','${action}','leasehold','${id}','{"source":"timeline"}');`, L);
    check(`a "${action}" event is NOT history (D4: copied from an upload or a seed, or consolidation bookkeeping)`, codes(id) === '');
  });
  const many = t(160);
  q(`insert into public.tenants(id,property_id,name) values ('${many}','${P1}','many');
     insert into public.cam_reconciliations(property_id,tenant_id) values ('${P1}','${many}'),('${P1}','${many}');
     insert into public.tenant_review_audit(property_id,tenant_id) values ('${P1}','${many}');`, L);
  const h = hist(many);
  check('several kinds are all listed, in a fixed order, with counts and labels',
    h.map(x => x.code).join(',') === 'cam,review_audit' && h[0].count === 2 && h[0].label === '2 CAM reconciliation row(s)' && h[1].label === '1 review audit entr(y/ies)', JSON.stringify(h));
  check('a leasehold id no row has returns no history (and does not raise)', one(`select public.leasehold_history('${GHOST}')::text;`, L) === '[]');
}

// ── 8 · discard ──────────────────────────────────────────────────────────────
section('8 · discard_leasehold: one history test; never a consolidation target');
{
  // The two changes, proven on Pilot's current (038) discard first.
  const G = fresh('m043discgap', false);
  check('BEFORE 043: a converted-acquisition leasehold can be discarded (the gap)', call(G, A, `public.discard_leasehold('${ACQ}', 'x')`).ok === true && !exists(G, ACQ));
  q(`insert into public.property_events(property_id,action,subject_id,detail) values ('${P1}','lease_uploaded','${F3}','{"source":"timeline"}');`, G);
  check('BEFORE 043: an event copied from the upload blocks the discard of a real mistake',
    /property history event/.test(errOf(call(G, A, `public.discard_leasehold('${F3}', 'x')`))) && exists(G, F3));
}
{
  const D = fresh('m043disc', true);
  check('a converted-acquisition leasehold: refused, and the refusal names it',
    /cannot be discarded:[^]*established by a converted acquisition review/.test(errOf(call(D, A, `public.discard_leasehold('${ACQ}', 'x')`))) && exists(D, ACQ));
  check('a term decision on its grouping: refused, named', /acquisition term decision/.test(errOf(call(D, A, `public.discard_leasehold('${DECIDED}', 'x')`))) && exists(D, DECIDED));
  q(`insert into public.property_events(property_id,action,subject_id,detail) values ('${P1}','lease_uploaded','${F3}','{"source":"timeline"}');`, D);
  const blockers = [
    ['a CAM reconciliation', 'CAM reconciliation', (id) => `insert into public.cam_reconciliations(property_id,tenant_id) values ('${P1}','${id}');`],
    ['a lease provision', 'lease provision', (id) => `insert into public.lease_provisions(property_id,tenant_id) values ('${P1}','${id}');`],
    ['a review audit entry', 'review audit', (id) => `insert into public.tenant_review_audit(property_id,tenant_id) values ('${P1}','${id}');`],
    ['a payment', 'payment', (id) => `insert into public.payments(property_id,tenant_id) values ('${P1}','${id}');`],
    ...['tenant_users', 'tenant_statements', 'tenant_documents', 'tenant_invitations', 'tenant_space_profiles'].map(n =>
      ['a portal row in ' + n, 'tenant portal record', (id) => `insert into public.${n}(property_id,tenant_id) values ('${P1}','${id}');`]),
    ['a history event a person wrote', 'property history event', (id) => `insert into public.property_events(property_id,action,subject_id) values ('${P1}','manual_repair','${id}');`],
    ['evidence a person approved', 'person-reviewed evidence', (id) => `insert into public.tenant_field_evidence(property_id,tenant_id,field_key,approved) values ('${P1}','${id}','cap',true);`],
    ['evidence with a reviewer email', 'person-reviewed evidence', (id) => `insert into public.tenant_field_evidence(property_id,tenant_id,field_key,reviewer_email) values ('${P1}','${id}','cap','a@example.test');`],
    ['a dispute event', 'dispute record', (id) => `insert into public.property_events(property_id,action,subject_id) values ('${P1}','dispute_created','${id}');`],
  ];
  blockers.forEach(([what, word, ins], i) => {
    const id = t(200 + i);
    q(`insert into public.tenants(id,property_id,name) values ('${id}','${P1}','blocked ${i}'); ${ins(id)}`, D);
    const fp = fullFp(D);
    const r = call(D, A, `public.discard_leasehold('${id}', 'entered in error')`);
    check(`refused while it has ${what} — and the refusal names it`, new RegExp('cannot be discarded:[^]*' + word).test(errOf(r)) && exists(D, id) && fullFp(D) === fp, errOf(r).slice(0, 140));
  });
  check('the refusal still carries the reasons as JSON in its detail', /DETAIL:\s+\{"reasons":/.test(as('authenticated', A, `select public.discard_leasehold('${t(200)}', 'x');`, D).out));
  // A consolidation target, a demo leasehold, an absorbed leasehold.
  check('   (absorb AMD-2 into the base lease)', absorb(D, A, F2, BASE, [DF2]).ok === true);
  check('a leasehold others were consolidated into: refused, named', /cannot be discarded:[^]*1 leasehold\(s\) consolidated into it/.test(errOf(call(D, A, `public.discard_leasehold('${BASE}', 'x')`))) && exists(D, BASE));
  check('an absorbed leasehold: refused (it is history; restore it first)', /was consolidated into [^]*never discarded/.test(errOf(call(D, A, `public.discard_leasehold('${F2}', 'x')`))) && exists(D, F2));
  check('a demo leasehold: refused, named', /cannot be discarded:[^]*a demo leasehold/.test(errOf(call(D, A, `public.discard_leasehold('${DM1}', 'x')`))) && exists(D, DM1));
  check('an ENDED leasehold: refused (038, unchanged)', (() => { call(D, A, `public.end_leasehold('${U5}', '2025-01-31', 'lease_expired', null)`);
    return /never discarded/.test(errOf(call(D, A, `public.discard_leasehold('${U5}', 'x')`))) && exists(D, U5); })());
  check('no note, a member, anon: refused (038, unchanged)',
    /note is required/.test(errOf(call(D, A, `public.discard_leasehold('${F3}', null)`))) && /Not authorized/.test(errOf(call(D, M, `public.discard_leasehold('${F3}', 'x')`)))
    && /permission denied for function discard_leasehold/.test(errOf(call(D, A, `public.discard_leasehold('${F3}', 'x')`, 'anon'))));
  // D4: the copied upload event no longer blocks; the success path is 038's.
  const J = 'c0000000-0000-4000-8000-000000000001';
  q(`insert into public.lease_documents(id,property_id,tenant_id,file_name) values ('${d(40)}','${P1}','${F3}','renewal.pdf');
     insert into public.tenant_field_evidence(property_id,tenant_id,field_key,source_document_id,reviewed_at) values ('${P1}','${F3}','end_date','${d(40)}',now());
     insert into public.lease_jobs(id,property_id,tenant_id) values ('${J}','${P1}','${F3}');`, D);
  const snapshot = one(`select to_jsonb(x)::text from public.tenants x where id='${F3}';`, D);
  const others = one(`select md5(string_agg(x::text,'' order by x::text)) from public.tenants x where id<>'${F3}';`, D);
  const r = call(D, A, `public.discard_leasehold('${F3}', 'uploaded twice by mistake')`);
  check('D4: a leasehold whose only event was copied from its upload IS discarded', r.ok === true, JSON.stringify(r).slice(0, 200));
  check('   …its document kept and unlinked, its unreviewed evidence removed, its job unlinked, other rows identical (038\'s path)',
    docOwner(D, d(40)) === 'null' && one(`select count(*) from public.tenant_field_evidence where tenant_id='${F3}';`, D) === '0'
    && one(`select coalesce(tenant_id::text,'null') from public.lease_jobs where id='${J}';`, D) === 'null'
    && one(`select md5(string_agg(x::text,'' order by x::text)) from public.tenants x where id<>'${F3}';`, D) === others);
  const ev = one(`select (detail->>'source')||'|'||(detail->'snapshot')::text from public.property_events where subject_id='${F3}' and action='leasehold_discarded';`, D);
  check('   …the leasehold_discarded event keeps the full snapshot (and is the tombstone)',
    ev.startsWith('discard_leasehold|') && JSON.stringify(JSON.parse(ev.split('|').slice(1).join('|'))) === JSON.stringify(JSON.parse(snapshot))
    && !q(`insert into public.tenants(id,property_id,name) values ('${F3}','${P1}','again');`, D).ok);
}

// ── 9 · absorb ───────────────────────────────────────────────────────────────
section('9 · absorb_leasehold');
{
  const X = fresh('m043abs', true);
  const refused = (r, re) => re.test(errOf(r));
  q(`insert into public.tenants(id,property_id,name) values ('${t(32)}','${P3}','on a prospect'), ('${t(33)}','${P3}','also');
     insert into public.tenants(id,property_id,name) values ('${t(34)}','${P1}','billed');
     insert into public.cam_reconciliations(property_id,tenant_id) values ('${P1}','${t(34)}');`, X);
  const fp0 = fullFp(X);
  const unauth = /Not authorized: caller does not own the property of leasehold/;
  check('no user: refused', /requires an authenticated user/.test(errOf(absorb(X, null, F1, BASE, [DF1L], { role: 'service_role' }))));
  check('anon cannot execute it', /permission denied for function absorb_leasehold/.test(errOf(absorb(X, A, F1, BASE, [DF1L], { role: 'anon' }))));
  check('another user: refused, and learns nothing (same message as an unknown id)',
    refused(absorb(X, B, F1, BASE, [DF1L]), unauth) && refused(absorb(X, A, GHOST, BASE, [], { rev: 0 }), unauth));
  check('a member who is not the owner: refused', refused(absorb(X, M, F1, BASE, [DF1L]), unauth));
  check('into itself: refused', refused(absorb(X, A, F1, F1, [DF1L]), /cannot be consolidated into itself/));
  check('into a leasehold of another property: refused', refused(absorb(X, A, F1, X1, [DF1L]), /not on the same property/));
  check('into a leasehold that does not exist: refused', refused(absorb(X, A, F1, GHOST, [DF1L]), /not on the same property/));
  check('on a property that is not acquired: refused', refused(absorb(X, A, t(32), t(33), [], { rev: rev(X, P3) }), /not acquired/));
  check('a demo leasehold: refused', refused(absorb(X, A, DM1, DM2, [], { rev: rev(X, PD) }), /demo leasehold is not consolidated/));
  check('a leasehold with meaningful history: refused, the history named (it can be ended, not consolidated)',
    refused(absorb(X, A, ACQ, BASE, []), /permanent history \(established by a converted acquisition review\); it can be ended, not consolidated/));
  check('an ENDED leasehold: refused as history, by name (it is ended, not consolidated)', (() => {
    const Y = fresh('m043absend', true);
    call(Y, A, `public.end_leasehold('${U5}', '2025-01-31', 'lease_expired', null)`);
    const x = absorb(Y, A, U5, BASE, []);
    return /Leasehold [0-9a-f-]+ ended on 2025-01-31; an ended leasehold is history and is not consolidated/.test(errOf(x)) && life(Y, U5) === 'ended|||false'; })());
  check('   …a CAM-referenced one too', refused(absorb(X, A, t(34), BASE, []), /permanent history \(1 CAM reconciliation row\(s\)\)/));
  check('no reason, an unknown reason: refused', refused(absorb(X, A, F1, BASE, [DF1L], { reason: null }), /reason must be duplicate or document_of/)
    && refused(absorb(X, A, F1, BASE, [DF1L], { reason: 'merged' }), /reason must be duplicate or document_of/));
  check('no note: refused', refused(absorb(X, A, F1, BASE, [DF1L], { note: '  ' }), /note is required to consolidate/));
  check('a stale property revision: refused (the property changed since this was prepared)',
    refused(absorb(X, A, F1, BASE, [DF1L], { rev: +rev(X) + 1 }), /property changed since this consolidation was prepared/)
    && refused(absorb(X, A, F1, BASE, [DF1L], { rev: '' }), /property changed since this consolidation was prepared/));
  check('a document of another property: refused', refused(absorb(X, A, F1, BASE, [DF1L, DP2]), /are not documents of this property/));
  check('a document that does not exist: refused', refused(absorb(X, A, F1, BASE, [DF1L, d(90)]), /are not documents of this property/));
  check('a document already on the target: refused', refused(absorb(X, A, F1, BASE, [DF1L, DBASE]), /already belong to the leasehold being consolidated into/));
  check('a document of another leasehold: refused', refused(absorb(X, A, F1, BASE, [DF1L, DX]), /belong to another leasehold and are not moved/));
  check('a document linked to the source left out: refused (every one of them moves)', refused(absorb(X, A, F1, BASE, [DF1]), /still has document\(s\) .* linked; every one of them moves with it/));
  check('every refusal above changed nothing at all', fullFp(X) === fp0);
  // Success.
  const revBefore = rev(X);
  const baseBefore = rowOf(X, BASE), f1Snap = one(`select to_jsonb(x)::text from public.tenants x where id='${F1}';`, X);
  const entry = one(`select e::text from public.properties, jsonb_array_elements(data->'tenants') e where id='${P1}' and e->>'id'='${F1}';`, X);
  const others = () => one(`select md5(string_agg(x::text,'' order by x::text)) from public.tenants x where id<>'${F1}';`, X);
  const othersBefore = others();
  const otherTables = () => one(`select md5(concat_ws('|', (select string_agg(x::text,'' order by x::text) from public.tenant_field_evidence x), (select string_agg(x::text,'' order by x::text) from public.tenant_review_audit x),
      (select string_agg(x::text,'' order by x::text) from public.cam_reconciliations x), (select string_agg(x::text,'' order by x::text) from public.lease_provisions x), (select string_agg(x::text,'' order by x::text) from public.lease_jobs x)));`, X);
  const otherTablesBefore = otherTables();
  const otherDocs = one(`select md5(string_agg(x::text,'' order by x::text)) from public.lease_documents x where id not in ('${DF1}','${DF1L}');`, X);
  const r = absorb(X, A, F1, BASE, [DF1L, DF1], { note: 'the first amendment is a document of the base lease', rev: revBefore });
  check('the owner consolidates AMD-1 into the base lease, with its linked document and the matching unlinked one', r.ok === true, JSON.stringify(r).slice(0, 300));
  check('   …AMD-1 is absorbed: pointer, reason, time', life(X, F1) === `absorbed|${BASE}|document_of|true`);
  check('   …both documents now belong to the base lease', docOwner(X, DF1L) === BASE && docOwner(X, DF1) === BASE);
  check('   …every other document is untouched (legacy_tenant_id never written)',
    one(`select md5(string_agg(x::text,'' order by x::text)) from public.lease_documents x where id not in ('${DF1}','${DF1L}');`, X) === otherDocs
    && one(`select count(*) from public.lease_documents where legacy_tenant_id is not null;`, X) === '0');
  check('   …the base lease is byte-identical: no term was copied', rowOf(X, BASE) === baseBefore);
  check('   …every other leasehold is byte-identical', others() === othersBefore);
  check('   …no evidence, audit, CAM, provision or job row was written or changed', otherTables() === otherTablesBefore);
  check('   …its saved-roster entry is removed; the others keep their order', rosterIds(X) === [BASE, F2, F3, U1].join(','), rosterIds(X));
  check('   …the property revision moved on by exactly one', rev(X) === String(+revBefore + 1) && r.data_revision === +revBefore + 1);
  const ev = JSON.parse(one(`select jsonb_build_object('a',action,'st',subject_type,'o',old_value,'n',new_value,'actor',actor_uid,'d',detail)::text from public.property_events where subject_id='${F1}' and action='leasehold_absorbed';`, X));
  check('   …a leasehold_absorbed event: actor, target, reason, note',
    ev.st === 'leasehold' && ev.o === 'active' && ev.n === 'absorbed' && ev.actor === A && ev.d.source === 'absorb_leasehold' && ev.d.target_id === BASE
    && ev.d.reason === 'document_of' && ev.d.note === 'the first amendment is a document of the base lease');
  check('   …the source\'s full snapshot and its saved-roster entry are kept in it',
    JSON.stringify(ev.d.source_snapshot) === JSON.stringify(JSON.parse(f1Snap)) && JSON.stringify(ev.d.source_roster_entry) === JSON.stringify([JSON.parse(entry)]));
  check('   …the moved documents, from and to (a broken link recorded as it was)',
    JSON.stringify(ev.d.moved_documents.map(m => [m.document_id, m.from_tenant_id, m.to_tenant_id])) === JSON.stringify([[DF1, GHOST, BASE], [DF1L, F1, BASE]].sort((a, b) => a[0] < b[0] ? -1 : 1)));
  check('   …the proof of eligibility (no history) and the revisions seen', JSON.stringify(ev.d.eligibility) === '[]' && ev.d.data_revision_seen === +revBefore && ev.d.data_revision_after === +revBefore + 1);
  const ev2 = JSON.parse(one(`select detail::text from public.property_events where subject_id='${BASE}' and action='leasehold_absorbed_other';`, X));
  check('   …and a leasehold_absorbed_other event on the target', ev2.source === 'absorb_leasehold' && ev2.source_id === F1 && ev2.moved_documents.length === 2);
  check('   …the derive trigger (fired by the roster edit) added no event of its own', one(`select count(*) from public.property_events where detail->>'source' in ('timeline','activityLog');`, X) === '1');
  // A second fragment; into an ENDED target; chains refused.
  check('a fragment with no documents: consolidated, no documents moved', (() => { const x = absorb(X, A, F3, BASE, null, { reason: 'duplicate' }); return x.ok && JSON.stringify(x.moved_documents) === '[]'; })());
  check('an absorbed leasehold cannot be consolidated again', refused(absorb(X, A, F1, F2, []), /already consolidated into/));
  check('a leasehold others were consolidated into cannot itself be consolidated', refused(absorb(X, A, BASE, F2, [DBASE]), /were consolidated into this one; restore them first/));
  check('nothing can be consolidated INTO an absorbed leasehold', refused(absorb(X, A, F2, F1, [DF2]), /target was itself consolidated into/));
  q(`insert into public.tenants(id,property_id,name) values ('${t(35)}','${P1}','ended target'), ('${t(36)}','${P1}','duplicate of it');`, X);
  call(X, A, `public.end_leasehold('${t(35)}', '2024-06-30', 'surrendered', null)`);
  check('consolidating into an ENDED leasehold is allowed (a fragment of a lease that has ended)', absorb(X, A, t(36), t(35), []).ok === true && life(X, t(36)).startsWith(`absorbed|${t(35)}|`));
  // Atomic: a failure after every check (the second event) leaves nothing behind.
  q(`create function public._fail_abs() returns trigger language plpgsql as $f$ begin if new.action='leasehold_absorbed_other' then raise exception 'injected failure'; end if; return new; end $f$;
     create trigger zz_fail_abs before insert on public.property_events for each row execute function public._fail_abs();`, X);
  const fpA = fullFp(X);
  const bad = absorb(X, A, F2, BASE, [DF2]);
  check('ATOMIC: a failure after the documents moved, the row changed and the roster was edited writes nothing',
    /injected failure/.test(errOf(bad)) && fullFp(X) === fpA && docOwner(X, DF2) === F2 && life(X, F2) === 'active|||false' && rosterIds(X).includes(F2));
  q(`drop trigger zz_fail_abs on public.property_events; drop function public._fail_abs();`, X);
  // A property with no saved roster (the table is the roster).
  const e = absorb(X, A, E1, E2, [], { reason: 'duplicate' });
  check('on a property whose saved roster is empty: consolidated, the empty roster left as it was, the revision unchanged',
    e.ok === true && e.roster_entry_removed === false && one(`select data::text from public.properties where id='${PE}';`, X) === '{"tenants": []}' && rev(X, PE) === '0');
}

// ── 10 · preflight ───────────────────────────────────────────────────────────
section('10 · absorb_leasehold_preflight: what a consolidation would do, read only');
{
  const P = fresh('m043pre2', true);
  const fp = fullFp(P);
  const pf = (uid, src, tgt) => call(P, uid, `public.absorb_leasehold_preflight('${src}'${tgt === undefined ? '' : tgt === null ? ', null' : `, '${tgt}'`})`);
  const r = pf(A, F1, BASE);
  check('eligible, no refusals, no history, the current revision', r.ok === true && r.eligible === true && JSON.stringify(r.refusals) === '[]' && JSON.stringify(r.history) === '[]' && String(r.data_revision) === rev(P), JSON.stringify(r).slice(0, 200));
  check('   …must_move: exactly the documents linked to the source', JSON.stringify(r.documents.must_move.map(x => x.id)) === JSON.stringify([DF1L]));
  check('   …matched_by_file: the unlinked document whose file is the source\'s own lease file', JSON.stringify(r.documents.matched_by_file.map(x => x.id)) === JSON.stringify([DF1]));
  check('   …unattributed: the property\'s other unlinked documents (not those of a leasehold)', JSON.stringify(r.documents.unattributed.map(x => x.id)) === JSON.stringify([DU]));
  check('   …the source and target summaries', r.source.id === F1 && r.source.lease_url === F1URL && r.target.id === BASE && r.target.name === 'ANTHONY BASE LEASE');
  check('without a target: the source-side view, not eligible', (() => { const x = pf(A, F1, null); return x.ok && x.eligible === false && x.target === null && JSON.stringify(x.refusals) === '[]'; })());
  const h = pf(A, ACQ, BASE);
  check('a source with history: not eligible, the reason and the history returned', h.eligible === false && /permanent history/.test(h.refusals[0]) && h.history[0].code === 'acquisition');
  const o = pf(A, F1, X1);
  check('a target on another property: refused, and none of its details are returned', o.eligible === false && /not on the same property/.test(o.refusals.join()) && o.target === null);
  check('another user, a member: refused', /Not authorized/.test(errOf(pf(B, F1, BASE))) && /Not authorized/.test(errOf(pf(M, F1, BASE))));
  check('anon cannot execute it', /permission denied for function absorb_leasehold_preflight/.test(errOf(call(P, A, `public.absorb_leasehold_preflight('${F1}', '${BASE}')`, 'anon'))));
  check('it wrote nothing', fullFp(P) === fp);
}

// ── 11 · restore ─────────────────────────────────────────────────────────────
section('11 · restore_absorbed_leasehold');
{
  const S = fresh('m043rest', true);
  check('   (absorb AMD-1 with both its documents; then move one of them on)', absorb(S, A, F1, BASE, [DF1L, DF1]).ok === true);
  q(`update public.lease_documents set tenant_id='${F2}' where id='${DF1}';`, S);
  q(`insert into public.tenant_review_audit(property_id,tenant_id,field_key,action,old_value,new_value) values ('${P1}','${BASE}','end_date','field_override','1951-04-06','2031-11-30');`, S);
  const unauth = /Not authorized/;
  check('a member, another user: refused', unauth.test(errOf(restore(S, M, F1))) && unauth.test(errOf(restore(S, B, F1))));
  check('no note: refused', /note is required to restore/.test(errOf(restore(S, A, F1, null))) && life(S, F1).startsWith('absorbed|'));
  check('an active leasehold: refused (nothing to restore)', /nothing to restore/.test(errOf(restore(S, A, F2))));
  check('anon cannot execute it', /permission denied for function restore_absorbed_leasehold/.test(errOf(call(S, A, `public.restore_absorbed_leasehold('${F1}', 'x')`, 'anon'))));
  const revB = rev(S);
  const r = restore(S, A, F1, 'wrong target: it is a document of AMD-2');
  check('the owner restores it: active, pointer cleared', r.ok === true && life(S, F1) === 'active|||false', JSON.stringify(r).slice(0, 300));
  check('   …the document still on the target goes back to it', docOwner(S, DF1L) === F1);
  check('   …the one moved since stays where it is, and is reported', docOwner(S, DF1) === F2 && r.document_conflicts.length === 1 && r.document_conflicts[0].document_id === DF1 && r.document_conflicts[0].now_tenant_id === F2);
  check('   …its saved-roster entry is back (appended), revision +1', rosterIds(S).split(',').includes(F1) && r.roster_entry_restored === true && rev(S) === String(+revB + 1));
  check('   …the override written on the target since is listed for a person, not reverted',
    r.overrides_since_absorption.length === 1 && r.overrides_since_absorption[0].field_key === 'end_date');
  const ev = JSON.parse(one(`select detail::text from public.property_events where subject_id='${F1}' and action='leasehold_restored';`, S));
  check('   …a leasehold_restored event: note, previous target and reason, the absorb event it undoes',
    ev.source === 'restore_absorbed_leasehold' && ev.previous_target_id === BASE && ev.previous_reason === 'document_of' && !!ev.absorbed_event_id && ev.moved_back_documents.length === 1);
  check('   …and leasehold_restored_other on the target', events(S, BASE, 'leasehold_restored_other') === '1');
  check('   …the absorb events are still there (history is appended, never rewritten)', events(S, F1, 'leasehold_absorbed') === '1');
  check('   …it is no longer frozen', q(`update public.tenants set name='AMD-1 (restored)' where id='${F1}';`, S).ok);
  check('a restored leasehold can be consolidated again, into the right one (consolidation is not history)',
    absorb(S, A, F1, F2, [DF1L]).ok === true && life(S, F1).startsWith(`absorbed|${F2}|`));
  check('   …and restored again; its roster entry is not duplicated',
    restore(S, A, F1).ok === true && rosterIds(S).split(',').filter(x => x === F1).length === 1);
  check('a restored leasehold with no other history can be discarded as a mistake (its documents kept and unlinked)', (() => {
    const x = call(S, A, `public.discard_leasehold('${F1}', 'x')`); return x.ok === true && !exists(S, F1) && docOwner(S, DF1L) === 'null'; })());
  // On a property whose saved roster is empty, restore does not create one.
  absorb(S, A, E1, E2, [], { reason: 'duplicate' });
  const e = restore(S, A, E1);
  check('restore on a property whose saved roster is empty leaves it empty (the table is the roster there)',
    e.ok === true && e.roster_entry_restored === false && one(`select data::text from public.properties where id='${PE}';`, S) === '{"tenants": []}');
  // The roster held the entry when it was consolidated, and was emptied since (Clear All): restore does not refill it.
  q(`update public.properties set data='{"tenants":[{"id":"${E1}","tenant_name":"E1"},{"id":"${E2}","tenant_name":"E2"}]}'::jsonb where id='${PE}';`, S);
  check('   (absorb E1 again while the roster lists it; then the roster is emptied)', absorb(S, A, E1, E2, [], { reason: 'duplicate' }).roster_entry_removed === true);
  q(`update public.properties set data='{"tenants":[]}'::jsonb where id='${PE}';`, S);
  const e2 = restore(S, A, E1);
  check('restore after the saved roster was emptied does not re-create a roster of one',
    e2.ok === true && e2.roster_entry_restored === false && one(`select data::text from public.properties where id='${PE}';`, S) === '{"tenants": []}');
  // A stale tab put the entry back before the restore: it is not added twice.
  check('   (absorb AMD-2; a stale tab then saves a roster that still lists it)', absorb(S, A, F2, BASE, [DF2, DF1]).ok === true);
  q(`update public.properties set data = jsonb_set(data, '{tenants}', data->'tenants' || '[{"id":"${F2}","tenant_name":"AMD-2 (stale tab)"}]'::jsonb) where id='${P1}';`, S);
  const s2 = restore(S, A, F2);
  check('restore when a stale tab already put the entry back: not added a second time',
    s2.ok === true && s2.roster_entry_restored === false && rosterIds(S).split(',').filter(x => x === F2).length === 1);
  check('the lifecycle flag does not outlive restore: a direct change in the same transaction is refused', (() => {
    absorb(S, A, F2, BASE, [DF2, DF1]);
    const x = as('authenticated', A, `select public.restore_absorbed_leasehold('${F2}', 'x'); update public.tenants set leasehold_status='ended', ended_at='2025-01-01', ended_reason='other' where id='${F2}';`, S);
    return !x.ok && life(S, F2).startsWith(`absorbed|${BASE}|`); })());
}

// ── 12 · the rest of 038 ─────────────────────────────────────────────────────
section('12 · the rest of 038 still holds');
{
  const C = fresh('m043rest38', true);
  absorb(C, A, F1, BASE, [DF1L]);
  const guardErr = (r) => !r.ok && /is permanent and is not deleted/.test(r.out);
  check('no direct delete of an absorbed leasehold, for any role', guardErr(as('authenticated', A, `delete from public.tenants where id='${F1}';`, C))
    && guardErr(as('service_role', null, `delete from public.tenants where id='${F1}';`, C)) && guardErr(q(`delete from public.tenants where id='${F1}';`, C)) && exists(C, F1));
  check('no direct delete of its target either', guardErr(q(`delete from public.tenants where id='${BASE}';`, C)) && exists(C, BASE));
  check('end_leasehold refuses an absorbed leasehold, changing nothing', !call(C, A, `public.end_leasehold('${F1}', '2025-01-31', 'other', null)`).ok && life(C, F1).startsWith('absorbed|'));
  check('reactivate_leasehold refuses it too', !call(C, A, `public.reactivate_leasehold('${F1}', 'x')`).ok && life(C, F1).startsWith('absorbed|'));
  check('end_leasehold still ends an active leasehold (holdover allowed, event written)',
    call(C, A, `public.end_leasehold('${U1}', '2026-04-30', 'lease_expired', 'held over')`).ok === true && events(C, U1, 'leasehold_ended') === '1');
  check('   …and reactivate_leasehold still reactivates it', call(C, A, `public.reactivate_leasehold('${U1}', 'correction')`).ok === true);
  check('   (absorb E1 into E2 on the property with an empty saved roster)', absorb(C, A, E1, E2, [], { reason: 'duplicate' }).ok === true);
  q(`insert into public.lease_documents(id,property_id,tenant_id,file_name) values ('${d(50)}','${PE}','${E2}','e2.pdf');`, C);
  const otherTenants = one(`select md5(string_agg(x::text,'' order by x::text)) from public.tenants x where property_id<>'${PE}';`, C);
  const del = q(`delete from public.properties where id='${PE}';`, C);
  check('DELETE the PROPERTY with an absorbed leasehold and its target: the cascade runs, nothing of it is left',
    del.ok && one(`select count(*) from public.tenants where property_id='${PE}';`, C) === '0' && one(`select count(*) from public.lease_documents where property_id='${PE}';`, C) === '0', del.out.slice(0, 300));
  check('   …other properties untouched', one(`select md5(string_agg(x::text,'' order by x::text)) from public.tenants x where property_id<>'${PE}';`, C) === otherTenants);
}

// ── 13 · rollback ────────────────────────────────────────────────────────────
section('13 · rollback');
{
  const X = fresh('m043rb', false);
  const catBefore = catalog(X);
  pg.psqlText(M043, X, 'm043');
  absorb(X, A, F1, BASE, [DF1L]);
  const blocked = pg.psqlText(R043, X, 'r043-blocked');
  check('the rollback REFUSES while a leasehold is absorbed, and changes nothing',
    !blocked.ok && /REFUSING TO ROLL BACK 043: 1 leasehold\(s\) are absorbed/.test(blocked.out) && life(X, F1).startsWith('absorbed|') && fnMd5(X, 'resync_property_tenants(uuid,jsonb)') === B043.resync);
  restore(X, A, F1);
  call(X, A, `public.end_leasehold('${U5}', '2025-01-31', 'lease_expired', null)`);
  const dataB = dataFp(X);
  const rb = pg.psqlText(R043, X, 'r043');
  check('after the restore the rollback runs', rb.ok, rb.ok ? '' : rb.out.slice(0, 400));
  check('   …resync, lifecycle guard and discard are 038\'s bodies byte for byte (Pilot\'s live md5s)',
    fnMd5(X, 'resync_property_tenants(uuid,jsonb)') === LIVE.resync && fnMd5(X, 'tenants_lifecycle_guard()') === LIVE.guard && fnMd5(X, 'discard_leasehold(uuid,text)') === LIVE.discard);
  check('   …the catalog equals the pre-043 catalog exactly (columns, checks, keys, indexes, policies, grants, functions, comments, triggers)', catalog(X) === catBefore);
  check('   …it wrote no row (the ended leasehold stays ended; the consolidation\'s events stay)',
    dataFp(X) === dataB && one(`select leasehold_status from public.tenants where id='${U5}';`, X) === 'ended' && events(X, F1, 'leasehold_absorbed') === '1');
  check('   …038\'s discard is back: an event copied from an upload blocks a discard again', (() => {
    q(`insert into public.property_events(property_id,action,subject_id,detail) values ('${P1}','lease_uploaded','${F3}','{"source":"timeline"}');`, X);
    return /property history event/.test(errOf(call(X, A, `public.discard_leasehold('${F3}', 'x')`))); })());
  check('043 applies again after the rollback', (() => { const a = pg.psqlText(M043, X, 'm043-again'); return a.ok && fnMd5(X, 'resync_property_tenants(uuid,jsonb)') === B043.resync; })());
  check('the rollback of an un-absorbed 043 twice in a row is harmless', pg.psqlText(R043, X, 'r043-1').ok && pg.psqlText(R043, X, 'r043-2').ok && catalog(X) === catBefore);
  const r38 = pg.psqlText(R038, X, 'r038');
  check('038\'s own rollback still recovers 039\'s resync after 043\'s rollback (the chain stays linear)',
    r38.ok && fnMd5(X, 'resync_property_tenants(uuid,jsonb)') === LIVE_039 && fnMd5(X, 'tenants_lifecycle_guard()') === '<missing>', r38.ok ? '' : r38.out.slice(0, 300));
}

// ── 14 · static ──────────────────────────────────────────────────────────────
section('14 · static');
{
  const noComments = (s) => s.replace(/^\s*--.*$/gm, '').replace(/--[^\n']*$/gm, '');
  const bodies = (s) => { const out = []; let i = 0; while ((i = s.indexOf('as $$', i)) >= 0) { const j = s.indexOf('$$;', i); out.push(s.slice(i + 5, j)); i = j + 3; } return out; };
  const outside = (s) => { let r = s; bodies(s).forEach(b => { r = r.replace(b, ''); }); return r.replace(/do \$\$[\s\S]*?end \$\$;/g, ''); };
  const top = noComments(outside(M043)), code = noComments(M043);
  check('no INSERT / UPDATE / DELETE outside function bodies', !/\b(insert\s+into|update\s+public\.|delete\s+from)\b/i.test(top));
  check('no table, policy or RLS DDL (only the stated columns, checks, key and indexes)',
    !/\b(create|drop)\s+table\b|\bpolicy\b|row level security/i.test(top) && (top.match(/add\s+column/gi) || []).length === 4);
  check('lease_documents.legacy_tenant_id is never named', !/legacy_tenant_id/.test(code));
  const sc = (code.match(/set_config\('([^']+)'/g) || []).map(s => s.replace(/set_config\('/, '').replace(/'$/, ''));
  check('set_config is used only for 038\'s two flags', sc.length > 0 && sc.every(n => n === 'mainstreet.leasehold_lifecycle' || n === 'mainstreet.discard_leasehold'), [...new Set(sc)].join(','));
  check('no public function wraps set_config beyond the lifecycle functions',
    one(`select string_agg(proname, ',' order by proname) from pg_proc where pronamespace='public'::regnamespace and prosrc ~ 'set_config';`, DB)
      === 'absorb_leasehold,discard_leasehold,end_leasehold,reactivate_leasehold,restore_absorbed_leasehold');
  const fn = (name) => noComments(bodyOf(M043, `create or replace function public.${name}(`));
  const absorbSrc = fn('absorb_leasehold') + fn('restore_absorbed_leasehold');
  check('absorb and restore never write a term, evidence, audit, CAM or provision row',
    !/\b(insert\s+into|update|delete\s+from)\s+public\.(tenant_field_evidence|tenant_review_audit|cam_reconciliations|lease_provisions)\b/i.test(absorbSrc)
    && !/set\s+(name|sqft|cap|start_date|end_date|lease_type|lease_url)\s*=/i.test(absorbSrc));
  check('no document is ever deleted', !/delete\s+from\s+public\.lease_documents/i.test(code));
  check('the acquisition tables are only read', !/\b(insert\s+into|update|delete\s+from)\s+public\.acquisition_/i.test(code));
  check('no "assigned" reason anywhere in executable SQL', !/'assigned'/.test(code));
  check('both files are guarded by the Pilot marker property', M043.includes('fd9c09b1-b657-4c58-9999-c3cce28e7600') && R043.includes('fd9c09b1-b657-4c58-9999-c3cce28e7600'));
  check('the rollback carries 038\'s three bodies verbatim',
    md5(bodyOf(R043, H.resync)) === LIVE.resync && md5(bodyOf(R043, H.guard)) === LIVE.guard && md5(bodyOf(R043, H.discard)) === LIVE.discard);
  check('the migration\'s re-run precondition names its own three bodies', M043.includes(B043.resync) && M043.includes(B043.guard) && M043.includes(B043.discard));
  check('says nothing of XRPL / wallets / settlement', !/xrpl|wallet|rlusd/i.test(code));
  check('nothing is validated', !/validate\s+constraint/i.test(code));
}

T.finish();
