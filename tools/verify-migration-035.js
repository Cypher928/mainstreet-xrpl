'use strict';
/**
 * tools/verify-migration-035.js — run 035 (P4: acquire_property, the atomic
 * acquire transition on the SAME property) for real, against nothing that matters.
 *
 *   node tools/verify-migration-035.js
 *
 * It touches NO Supabase project. It builds a throwaway PostgreSQL cluster,
 * stands up STAND-INS for the tables 035 reads and writes with the columns,
 * CHECKs, keys, triggers, functions and row policies read from Pilot's live
 * catalog (organisations, memberships and property_events included), installs
 * 032, 033 and 034 from their files, and then applies 035.
 *
 * WHAT IT PROVES
 *
 *   1  035 applies, and applies again; the function is SECURITY DEFINER with an
 *      empty search_path; anon and PUBLIC cannot execute it
 *   2  SUCCESS — a valid prospect with a valid open review: the SAME property
 *      id before and after, no second properties row, stage acquired with
 *      acquired_at stamped, review converted with converted_at and a
 *      conversionRecord naming the same property, tenants created with the
 *      leasehold ids, invoices carried once with sourceEpisodeId/acquiredAt,
 *      properties.data preserved, exactly one property event, a `converted`
 *      activity entry on the review, the result carries the same id; a second
 *      call is refused
 *   3  REFUSALS — wrong pairing, acquired / passed / archived property,
 *      converted / closed review, non-admin member, read_only, stranger, anon,
 *      zero leaseholds, unresolved extraction, pending document (untyped,
 *      unmatched, AI-filed unconfirmed), cross-review family, cross-property
 *      family, duplicate / missing / extra roster row, a roster row naming
 *      another property, a tenant that belongs to another property, a second
 *      open episode; every refusal leaves the snapshot byte-identical
 *   4  ATOMICITY — a harness-only trigger raises AFTER the stage transition,
 *      AFTER the tenant insert, AFTER the invoice copy, AFTER the review
 *      update and AFTER the event insert; every time the property is still a
 *      prospect, the review still open, and tenants, data, review and events
 *      byte-identical to before
 *   5  NO BUSINESS LOGIC — the file interprets no lease term (no resolver
 *      port), inserts no properties row, and keeps to the vocabulary the JS
 *      modules define (family types, dispositions, resolutions)
 *   6  NOTHING ELSE MOVED — every object outside 035's one function is
 *      identical across the apply; ROLLBACK removes the function and 035
 *      applies again
 *
 * SKIPS (exit 0) when no local PostgreSQL server binary is present, and says so
 * loudly — a skip is not a pass and must not read like one.
 */
const fs = require('fs');
const path = require('path');
const { startCluster, tally } = require('./_pg-throwaway');

const ROOT = path.join(__dirname, '..');
const MIG  = path.join(ROOT, 'migrations');
const M032 = path.join(MIG, '032_resync_property_tenants_property_bound.sql');
const M033 = path.join(MIG, '033_property_lifecycle_integrity.sql');
const M034 = path.join(MIG, '034_property_at_new_acquisition.sql');
const M035 = path.join(MIG, '035_acquire_property.sql');
const R035 = path.join(MIG, '035_acquire_property_rollback.sql');

const T = tally();
const { check, section } = T;
const SQL = fs.readFileSync(M035, 'utf8');
const strip = (s) => s.replace(/^\s*--.*$/gm, '');

console.log('\n══ migration 035 — executed against a throwaway cluster ══');
console.log('   NO Supabase project is contacted by this script.');
const pg = startCluster('035');
console.log('   postgres: ' + pg.PGBIN);

// ── people and organisations ─────────────────────────────────────────────────
const A = '11111111-1111-4111-8111-111111111111';   // owner, admin of O1
const M = '33333333-3333-4333-8333-333333333333';   // property_manager in O1
const R = '44444444-4444-4444-8444-444444444444';   // read_only in O1
const S = '22222222-2222-4222-8222-222222222222';   // stranger, admin of O2
const O1 = 'c1c1c1c1-0000-4000-8000-000000000001', O2 = 'c2c2c2c2-0000-4000-8000-000000000002';

const SCHEMA = `
  insert into auth.users(id) values ('${A}'),('${M}'),('${R}'),('${S}');
  create table public.organizations (id uuid primary key default gen_random_uuid(), name text, created_by uuid, created_at timestamptz default now());
  create table public.organization_members (id uuid primary key default gen_random_uuid(), organization_id uuid references public.organizations(id), user_id uuid references auth.users(id),
    role text not null check (role in ('admin','property_manager','accounting','leasing','read_only')), invited_by uuid, invited_at timestamptz default now(), accepted_at timestamptz, revoked_at timestamptz, created_at timestamptz default now());
  insert into public.organizations(id,name,created_by) values ('${O1}','Org One','${A}'),('${O2}','Org Two','${S}');
  insert into public.organization_members(organization_id,user_id,role,accepted_at) values
    ('${O1}','${A}','admin',now()),('${O1}','${M}','property_manager',now()),('${O1}','${R}','read_only',now()),('${O2}','${S}','admin',now());
  create table public.properties (
    id uuid primary key default gen_random_uuid(), user_id uuid references auth.users(id) on delete cascade, organization_id uuid references public.organizations(id) on delete restrict,
    name text, sqft numeric, data jsonb, archived_at timestamptz,
    lifecycle_stage text not null default 'acquired' constraint properties_lifecycle_stage_check check (lifecycle_stage in ('prospect','under_review','due_diligence','acquired','passed')),
    acquired_at timestamptz, passed_at timestamptz, stage_changed_by uuid references auth.users(id) on delete set null, stage_changed_at timestamptz, created_at timestamptz default now(), updated_at timestamptz default now());
  create table public.tenants (id uuid primary key default gen_random_uuid(), property_id uuid references public.properties(id) on delete cascade, name text, sqft numeric, cap numeric, start_date date, end_date date, lease_url text, lease_type text,
    created_at timestamptz not null default now(), updated_at timestamptz not null default now(), constraint tenants_id_property_uniq unique (id, property_id));
  create table public.cam_reconciliations (id uuid primary key default gen_random_uuid(), property_id uuid not null, tenant_id uuid, year integer not null);
  create table public.tenant_field_evidence (id uuid primary key default gen_random_uuid(), property_id uuid not null, tenant_id text not null, field_key text not null);
  create table public.payments (id uuid primary key default gen_random_uuid(), property_id uuid not null, tenant_id uuid not null);
  -- Pilot's acquisition_reviews has NO check on status values (only 034's open-has-property CHECK); mirrored.
  create table public.acquisition_reviews (
    id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade, name text not null,
    status text not null default 'draft',
    data jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
    property_id uuid references public.properties(id) on delete set null, constraint acquisition_reviews_id_user_id_key unique (id, user_id));
  create table public.acquisition_document_families (
    id uuid primary key default gen_random_uuid(), review_id uuid not null, user_id uuid not null, label text not null constraint acq_doc_families_label_not_blank check (length(btrim(label)) > 0),
    family_kind text not null default 'lease' check (family_kind in ('lease','financial','transaction','other')), tenant_hint text, suite_hint text,
    created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
    constraint acq_doc_families_id_user_id_key unique (id, user_id),
    constraint acq_doc_families_review_fk foreign key (review_id, user_id) references public.acquisition_reviews(id, user_id) on delete cascade);
  create table public.acquisition_documents (
    id uuid primary key default gen_random_uuid(), review_id uuid not null, user_id uuid not null, file_name text not null, intake_kind text not null default 'lease' check (intake_kind in ('lease','invoice','other')),
    intake_id text not null, storage_path text, parsing_status text not null default 'pending' check (parsing_status in ('pending','success','partial','failed')),
    produced_kind text, produced_id text, abstracted_fields jsonb,
    doc_type text constraint acq_docs_doc_type_check check (doc_type is null or doc_type in ('original_lease','amendment','renewal','extension','assignment','guaranty','side_letter','snda','estoppel','psa','rent_roll','financial_statement','invoice','other','unknown')),
    doc_type_status text not null default 'unclassified' constraint acq_docs_doc_type_status_check check (doc_type_status in ('unclassified','proposed','confirmed','corrected')),
    doc_type_source text check (doc_type_source is null or doc_type_source in ('ai','human','intake_kind')),
    family_id uuid, family_status text not null default 'unfiled' constraint acq_docs_family_status_check check (family_status in ('unfiled','proposed','confirmed')),
    family_source text, parent_document_id uuid, relationship text, relationship_status text constraint acq_docs_relationship_status_check check (relationship_status is null or relationship_status in ('proposed','confirmed','needs_review')),
    superseded_by_document_id uuid, confirmed_by uuid, confirmed_at timestamptz, classification_history jsonb not null default '[]'::jsonb,
    created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
    constraint acquisition_documents_id_user_id_key unique (id, user_id),
    constraint acquisition_documents_review_intake_key unique (review_id, intake_id),
    constraint acq_docs_family_coherent_check check ((family_id is null and family_status = 'unfiled') or (family_id is not null and family_status in ('proposed','confirmed'))),
    constraint acquisition_documents_review_fk foreign key (review_id, user_id) references public.acquisition_reviews(id, user_id) on delete cascade,
    constraint acq_docs_family_fk foreign key (family_id, user_id) references public.acquisition_document_families(id, user_id) on delete set null (family_id));
  create table public.acquisition_term_decisions (
    id uuid primary key default gen_random_uuid(), review_id uuid not null, user_id uuid not null, family_id uuid, field_key text not null, action text not null check (action in ('confirm','correct','reject','reopen')),
    previous_value text, new_value text, source_document_id uuid, decided_by uuid not null, decided_at timestamptz not null default now(), created_at timestamptz not null default now(),
    constraint acq_term_decisions_review_fk foreign key (review_id, user_id) references public.acquisition_reviews(id, user_id) on delete cascade,
    constraint acq_term_decisions_family_fk foreign key (family_id, user_id) references public.acquisition_document_families(id, user_id) on delete set null (family_id));
  -- property_events as Pilot has it (028/028b): append-only, identity-stamped
  create table public.property_events (
    id uuid primary key default gen_random_uuid(), property_id uuid not null references public.properties(id) on delete cascade,
    organization_id uuid references public.organizations(id) on delete set null, actor_uid uuid references auth.users(id) on delete set null, actor_email text,
    action text not null check (length(action) between 1 and 80), subject_type text, subject_id text, field_key text, old_value text, new_value text,
    detail jsonb not null default '{}'::jsonb, client_ts timestamptz not null default now(), created_at timestamptz not null default now());
  create or replace function public._property_events_stamp() returns trigger language plpgsql security definer set search_path to '' as $f$
  declare v_caller uuid := auth.uid();
  begin
    if v_caller is not null then
      if new.actor_uid is null then new.actor_uid := v_caller;
      elsif new.actor_uid <> v_caller then raise exception 'property_events.actor_uid must be the caller' using errcode = 'insufficient_privilege'; end if;
    end if;
    select p.organization_id into new.organization_id from public.properties p where p.id = new.property_id;
    return new;
  end $f$;
  create trigger property_events_stamp before insert on public.property_events for each row execute function public._property_events_stamp();
  create or replace function public._property_events_append_only() returns trigger language plpgsql as $f$
  begin raise exception 'property_events is append-only' using errcode = 'restrict_violation'; end $f$;
  create trigger property_events_append_only before update or delete on public.property_events for each row execute function public._property_events_append_only();

  -- Pilot's functions and triggers these tables carry (copied from the live catalog)
  create or replace function public.set_updated_at() returns trigger language plpgsql as $f$ begin new.updated_at := now(); return new; end $f$;
  create trigger acq_reviews_updated_at before update on public.acquisition_reviews for each row execute function public.set_updated_at();
  create trigger acq_documents_updated_at before update on public.acquisition_documents for each row execute function public.set_updated_at();
  create trigger trg_acq_doc_families_updated_at before update on public.acquisition_document_families for each row execute function public.set_updated_at();
  create or replace function public.acq_docs_coherence() returns trigger language plpgsql as $f$
  begin
    if new.family_id is null and new.family_status <> 'unfiled' then new.family_status := 'unfiled'; new.family_source := null; end if;
    if (new.doc_type_status in ('confirmed','corrected') or new.family_status = 'confirmed' or new.relationship_status = 'confirmed') and new.confirmed_by is null then
      raise exception 'a confirmed classification must name who confirmed it (acquisition_documents.confirmed_by)' using errcode = 'check_violation';
    end if;
    return new;
  end $f$;
  create trigger trg_acq_docs_coherence before insert or update on public.acquisition_documents for each row execute function public.acq_docs_coherence();
  create or replace function public.acq_term_decisions_actor() returns trigger language plpgsql as $f$
  begin if new.decided_by is distinct from new.user_id then raise exception 'A decision must be recorded by its owner (decided_by must equal user_id).' using errcode='check_violation'; end if; return new; end $f$;
  create trigger trg_acq_term_decisions_actor before insert on public.acquisition_term_decisions for each row execute function public.acq_term_decisions_actor();
  create or replace function public.acq_term_decisions_append_only() returns trigger language plpgsql as $f$
  begin
    if tg_op = 'DELETE' then
      if exists (select 1 from public.acquisition_reviews where id = old.review_id) then
        raise exception 'acquisition_term_decisions is append-only: DELETE is refused.' using errcode = 'restrict_violation';
      end if;
      return old;
    end if;
    raise exception 'acquisition_term_decisions is append-only: UPDATE is refused.' using errcode = 'restrict_violation';
  end $f$;
  create trigger trg_acq_term_decisions_no_delete before delete on public.acquisition_term_decisions for each row execute function public.acq_term_decisions_append_only();
  create trigger trg_acq_term_decisions_no_update before update on public.acquisition_term_decisions for each row execute function public.acq_term_decisions_append_only();

  create or replace function public.is_active_member_of_org(p_org uuid) returns boolean language sql stable security definer set search_path to '' as $f$
    select exists (select 1 from public.organization_members m where m.organization_id = p_org and m.user_id = auth.uid() and m.accepted_at is not null and m.revoked_at is null) $f$;
  create or replace function public.member_property_ids() returns setof uuid language sql stable security definer set search_path to '' as $f$
    select p.id from public.properties p where p.user_id = auth.uid() or (p.organization_id is not null and public.is_active_member_of_org(p.organization_id)) $f$;
  grant execute on function public.member_property_ids() to authenticated, service_role;
  grant execute on function public.is_active_member_of_org(uuid) to authenticated, service_role;
  create or replace function public.properties_default_organization() returns trigger language plpgsql security definer set search_path to '' as $f$
  declare v_org uuid;
  begin
    if new.organization_id is not null or new.user_id is null then return new; end if;
    select m.organization_id into v_org from public.organization_members m where m.user_id = new.user_id and m.role = 'admin' and m.accepted_at is not null and m.revoked_at is null order by m.created_at asc limit 1;
    if v_org is null then
      insert into public.organizations (name, created_by) values ('Organisation', new.user_id) returning id into v_org;
      insert into public.organization_members (organization_id, user_id, role, accepted_at) values (v_org, new.user_id, 'admin', now());
    end if;
    new.organization_id := v_org; return new;
  end $f$;
  create trigger properties_default_organization before insert on public.properties for each row execute function public.properties_default_organization();

  alter table public.properties enable row level security;
  alter table public.tenants enable row level security;
  alter table public.property_events enable row level security;
  alter table public.acquisition_reviews enable row level security;
  alter table public.acquisition_documents enable row level security;
  alter table public.acquisition_document_families enable row level security;
  alter table public.acquisition_term_decisions enable row level security;
  create policy properties_owner_all on public.properties for all to authenticated
    using ((user_id = auth.uid()) or (organization_id is not null and public.is_active_member_of_org(organization_id)))
    with check ((user_id = auth.uid()) or (organization_id is not null and public.is_active_member_of_org(organization_id)));
  create policy tenants_owner_all on public.tenants for all to authenticated using (property_id in (select public.member_property_ids())) with check (property_id in (select public.member_property_ids()));
  create policy property_events_member_select on public.property_events for select to authenticated using (property_id in (select public.member_property_ids()));
  create policy property_events_member_insert on public.property_events for insert to authenticated with check (property_id in (select public.member_property_ids()));
  create policy acq_reviews_owner_all on public.acquisition_reviews for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
  create policy acq_docs_owner_all on public.acquisition_documents for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
  create policy acq_doc_families_owner_all on public.acquisition_document_families for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
  create policy acq_term_decisions_owner_all on public.acquisition_term_decisions for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
  grant all on all tables in schema public to authenticated;`;

const q = (sql, db) => pg.psql(sql, db);
const as = (uid, sql, db) => pg.as('authenticated', uid, sql, db);
const refused = (r, re) => !r.ok && (re ? re.test(r.out) : true);
const one = (sql, db) => q(sql, db).out;
const parse = (r) => { try { return JSON.parse(r.out); } catch (_) { return { _raw: r.out }; } };
const lit = (v) => JSON.stringify(v).replace(/'/g, "''");
const rpcBegin = (db, uid, name, data) => parse(as(uid, `select public.begin_acquisition('${name}', '${lit(Object.assign({ totalSqFt: '1000' }, data || {}))}'::jsonb);`, db));
const acquire = (db, uid, pid, rid, snapshot, pre) => as(uid, `${pre || ''}select public.acquire_property('${pid}'::uuid, '${rid}'::uuid, '${lit(snapshot)}'::jsonb);`, db);
const inventory = (db) => q(`
  select string_agg(x, E'\\n' order by x) from (
    select 'con|'||conrelid::regclass::text||'|'||conname||'|'||pg_get_constraintdef(oid) as x from pg_constraint where connamespace='public'::regnamespace
    union all select 'trg|'||t.tgrelid::regclass::text||'|'||t.tgname from pg_trigger t where not t.tgisinternal and t.tgname not like 'harness_%'
    union all select 'fn|'||p.proname||'|'||md5(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f' and p.proname not in ('acquire_property','harness_fail')
    union all select 'col|'||table_name||'|'||column_name||'|'||data_type||'|'||is_nullable from information_schema.columns where table_schema='public'
    union all select 'pol|'||tablename||'|'||policyname||'|'||coalesce(qual,'') from pg_policies where schemaname='public'
  ) s;`, db).out;
// The whole state a failed acquire must leave untouched, for one property and its episode.
const snapshot = (db, pid, rid) => one(`
  select coalesce((select p.lifecycle_stage||'|'||coalesce(p.acquired_at::text,'')||'|'||coalesce(p.stage_changed_at::text,'')||'|'||coalesce(p.data::text,'')||'|'||coalesce(p.archived_at::text,'') from public.properties p where p.id='${pid}'),'')
    || '#' || coalesce((select r.status||'|'||coalesce(r.converted_at::text,'')||'|'||coalesce(r.property_id::text,'')||'|'||r.data::text||'|'||r.updated_at::text from public.acquisition_reviews r where r.id='${rid}'),'')
    || '#' || coalesce((select string_agg(t.id::text||'|'||coalesce(t.property_id::text,'')||'|'||coalesce(t.name,'')||'|'||coalesce(t.sqft::text,''), ',' order by t.id) from public.tenants t where t.property_id='${pid}'),'')
    || '#' || coalesce((select string_agg(e.id::text||'|'||e.action||'|'||coalesce(e.new_value,''), ',' order by e.created_at, e.id) from public.property_events e where e.property_id='${pid}'),'')
    || '#' || (select count(*) from public.properties where id='${pid}')::text;`, db);

// A deal with two confirmed leaseholds and clean records; returns ids.
function makeDeal(db, uid, name, opts) {
  const o = opts || {};
  const d = rpcBegin(db, uid, name, o.data || { totalSqFt: '1000', invoices: [{ id: 'inv-1', vendorName: 'Tax', amount: 100, category: 'taxes' }, { id: 'inv-2', vendorName: 'Ins', amount: 50, category: 'insurance' }] });
  const P = d.property_id, Rv = d.review_id;
  const F1 = one(`select gen_random_uuid();`, db), F2 = one(`select gen_random_uuid();`, db);
  as(uid, `insert into public.acquisition_document_families(id,review_id,user_id,label) values ('${F1}','${Rv}','${uid}','Leasehold One'),('${F2}','${Rv}','${uid}','Leasehold Two');`, db);
  if (!o.noDocs) {
    as(uid, `insert into public.acquisition_documents(review_id,user_id,file_name,intake_id,family_id,family_status,doc_type,doc_type_status,doc_type_source,confirmed_by,confirmed_at) values
      ('${Rv}','${uid}','one.pdf','ik-1','${F1}','confirmed','original_lease','confirmed','human','${uid}',now()),
      ('${Rv}','${uid}','two.pdf','ik-2','${F2}','confirmed','original_lease','confirmed','human','${uid}',now());`, db);
  }
  const roster = [
    { id: F1, family_id: F1, property_id: P, review_id: Rv, tenant_name: 'Tenant One', leased_sqft: '400', cap: '5', start_date: '2024-01-01', end_date: '2029-12-31', lease_type: 'NNN', base_rent: 12000 },
    { id: F2, family_id: F2, property_id: P, review_id: Rv, tenant_name: 'Tenant Two', leased_sqft: '600', cap: null, start_date: '2023-06-01', end_date: '2028-05-31', lease_type: 'Gross', base_rent: 18000 },
  ];
  return { P, R: Rv, F1, F2, roster, snap: { roster, propertyName: name, occupancyAtAcquisition: 100, waltAtAcquisition: 4.2 } };
}

// ── build ────────────────────────────────────────────────────────────────────
const DB = 'pilotlike';
let r = pg.database(DB, 'legacy');
check('pilotlike: database built under Pilot\'s legacy default privileges', r.ok, r.ok ? '' : r.out.slice(0, 300));
r = q(SCHEMA, DB);
check('pilotlike: stand-ins with Pilot\'s constraints, triggers, functions, organisations, property_events and policies', r.ok, r.ok ? '' : r.out.slice(0, 500));
r = pg.psqlFile(M032, DB); check('pilotlike: 032 installed from its file', r.ok, r.ok ? '' : r.out.slice(0, 300));
r = pg.psqlFile(M033, DB); check('pilotlike: 033 installed from its file', r.ok, r.ok ? '' : r.out.slice(0, 300));
r = pg.psqlFile(M034, DB); check('pilotlike: 034 installed from its file', r.ok, r.ok ? '' : r.out.slice(0, 300));
const before = inventory(DB);

// ── 1 · apply ────────────────────────────────────────────────────────────────
section('1 · 035 applies, and applies again');
r = pg.psqlFile(M035, DB);
check('pilotlike: 035 applies', r.ok, r.ok ? '' : r.out.slice(0, 600));
r = pg.psqlFile(M035, DB);
check('pilotlike: 035 applies a second time without error', r.ok, r.out.slice(0, 300));
check('acquire_property is SECURITY DEFINER with an empty search_path', one(`select prosecdef::text||'|'||coalesce(array_to_string(proconfig,','),'') from pg_proc where proname='acquire_property';`, DB) === 'true|search_path=""');
check('authenticated and service_role may execute it; anon and PUBLIC may not',
  pg.canExecute('authenticated', 'public.acquire_property(uuid,uuid,jsonb)', DB) && pg.canExecute('service_role', 'public.acquire_property(uuid,uuid,jsonb)', DB)
  && !pg.canExecute('anon', 'public.acquire_property(uuid,uuid,jsonb)', DB) && one(`select has_function_privilege(0, 'public.acquire_property(uuid,uuid,jsonb)', 'execute');`, DB) === 'f');

// ── 2 · success ──────────────────────────────────────────────────────────────
section('2 · SUCCESS — the SAME property becomes acquired');
const D = makeDeal(DB, A, 'Deal One');
const propsBefore = one(`select count(*) from public.properties;`, DB);
const eventsBefore = one(`select count(*) from public.property_events where property_id='${D.P}';`, DB);
q(`update public.properties set data = data || '{"keep":"me"}'::jsonb where id='${D.P}';`, DB);
const idBefore = one(`select id from public.properties where id='${D.P}';`, DB);
r = acquire(DB, A, D.P, D.R, D.snap);
let x = parse(r);
check('the owner acquires: ok, and the result carries the SAME property id', r.ok && x.ok === true && x.property_id === D.P, r.out.slice(0, 300));
check('no second properties row was created', one(`select count(*) from public.properties;`, DB) === propsBefore);
check('the same row is now acquired, acquired_at and stage_changed_by stamped', one(`select id::text||'|'||lifecycle_stage||'|'||(acquired_at is not null)::text||'|'||(stage_changed_by='${A}')::text from public.properties where id='${D.P}';`, DB) === `${idBefore}|acquired|true|true`);
check('the review is converted, converted_at set, property_id unchanged', one(`select status||'|'||(converted_at is not null)::text||'|'||property_id::text from public.acquisition_reviews where id='${D.R}';`, DB) === `converted|true|${D.P}`);
check('conversionRecord names the SAME property id, the review and the source', one(`select (data->'conversionRecord'->>'propertyId')||'|'||(data->'conversionRecord'->>'reviewId')||'|'||(data->'conversionRecord'->>'source')||'|'||(data->>'stage') from public.acquisition_reviews where id='${D.R}';`, DB) === `${D.P}|${D.R}|acquire_property|acquired`);
check('one `converted` activity entry was appended in the workspace module\'s shape', one(`select (data->'activity'->-1->>'type')||'|'||(data->'activity'->-1->'actor'->>'uid')||'|'||(data->>'activityCount')||'|'||((data->'activity'->-1->>'id') like 'act-%')::text from public.acquisition_reviews where id='${D.R}';`, DB) === `converted|${A}|1|true`);
check('two tenants were written, with the LEASEHOLD ids, on the SAME property', one(`select string_agg(t.id::text||'|'||t.name||'|'||coalesce(t.sqft::text,'')||'|'||coalesce(t.cap::text,'')||'|'||coalesce(t.lease_type,''), ';' order by t.name) from public.tenants t where t.property_id='${D.P}';`, DB) === `${D.F1}|Tenant One|400|5|NNN;${D.F2}|Tenant Two|600||Gross`);
check('the invoices were carried once, each stamped sourceEpisodeId and acquiredAt', one(`select jsonb_array_length(data->'invoices')||'|'||(data->'invoices'->0->>'sourceEpisodeId')||'|'||((data->'invoices'->0->>'acquiredAt') is not null)::text||'|'||(data->'invoices'->1->>'vendorName') from public.properties where id='${D.P}';`, DB) === `2|${D.R}|true|Ins`);
check('existing properties.data was preserved and the roster stored under data.tenants', one(`select (data->>'keep')||'|'||jsonb_array_length(data->'tenants')||'|'||(data->'tenants'->0->>'_leaseholdId' = data->'tenants'->0->>'id')::text||'|'||(data->'acquiredFrom'->>'reviewId') from public.properties where id='${D.P}';`, DB) === `me|2|true|${D.R}`);
check('EXACTLY ONE property event: stage_changed, property, prospect → acquired, actor = caller, naming the review', one(`select count(*)::text||'|'||max(action)||'|'||max(subject_type)||'|'||max(old_value)||'|'||max(new_value)||'|'||(max(actor_uid::text)='${A}')::text||'|'||max(detail->>'reviewId')||'|'||max(organization_id::text) from public.property_events where property_id='${D.P}' and created_at >= now() - interval '1 minute';`, DB) === `${Number(eventsBefore) + 1}|stage_changed|property|prospect|acquired|true|${D.R}|${O1}`);
check('the result names the event, the counts and the server\'s review row', x.event_id && x.tenants_written === 2 && x.invoices_carried === 2 && x.review && x.review.status === 'converted' && x.review.property_id === D.P && x.review.updated_at, JSON.stringify(x).slice(0, 200));
r = acquire(DB, A, D.P, D.R, D.snap);
check('a second call is refused: the property is acquired', refused(r, /not a prospect|already converted/), r.out.slice(0, 160));
check('the acquired episode remains, on the same property, with its families', one(`select count(*) from public.acquisition_document_families where review_id='${D.R}' and property_id='${D.P}';`, DB) === '2');

// ── 3 · refusals ─────────────────────────────────────────────────────────────
section('3 · REFUSALS — every one leaves the state byte-identical');
const E = makeDeal(DB, A, 'Deal Two');                 // the clean prospect used for refusals
const G = makeDeal(DB, A, 'Deal Three');               // another clean prospect (pairing / cross tests)
const snapE = snapshot(DB, E.P, E.R);
const refuse = (label, r, re) => {
  check(label, refused(r, re), r.out.slice(0, 200));
  const now = snapshot(DB, E.P, E.R);
  check('  … and the state is untouched', now === snapE, now === snapE ? '' : now + ' vs ' + snapE);
};
refuse('wrong pairing: review of Deal Three with property of Deal Two', acquire(DB, A, E.P, G.R, G.snap), /belongs to property/);
refuse('wrong pairing: unknown review id', acquire(DB, A, E.P, '00000000-0000-4000-8000-000000000000', E.snap), /No acquisition review/);
refuse('property_manager M (not an admin) is refused', acquire(DB, M, E.P, E.R, E.snap), /administrator/);
refuse('read_only R is refused', acquire(DB, R, E.P, E.R, E.snap), /administrator/);
refuse('stranger S (admin of another organisation) is refused, and learns nothing', acquire(DB, S, E.P, E.R, E.snap), /administrator/);
r = pg.as('anon', null, `select public.acquire_property('${E.P}'::uuid, '${E.R}'::uuid, '{}'::jsonb);`, DB);
refuse('anon is refused', r);
refuse('acquired property (Deal One) is refused', acquire(DB, A, D.P, D.R, D.snap), /not a prospect|already converted/);
// passed property
const Pp = makeDeal(DB, A, 'Passed Deal');
q(`update public.properties set lifecycle_stage='passed' where id='${Pp.P}';`, DB);
refuse('passed property is refused', acquire(DB, A, Pp.P, Pp.R, Pp.snap), /passed, not a prospect/);
// archived prospect
const Ar = makeDeal(DB, A, 'Archived Deal');
q(`update public.properties set archived_at=now() where id='${Ar.P}';`, DB);
refuse('archived property is refused', acquire(DB, A, Ar.P, Ar.R, Ar.snap), /archived/);
// converted review on a prospect (forced by the harness)
const Cv = makeDeal(DB, A, 'Converted Review Deal');
q(`update public.acquisition_reviews set status='converted' where id='${Cv.R}';`, DB);
refuse('an already-converted review is refused', acquire(DB, A, Cv.P, Cv.R, Cv.snap), /already converted/);
q(`update public.acquisition_reviews set status='closed' where id='${Cv.R}';`, DB);
refuse('a closed (non-open) review is refused', acquire(DB, A, Cv.P, Cv.R, Cv.snap), /only an open episode/);
// zero leaseholds
const Z = rpcBegin(DB, A, 'Zero Leaseholds');
refuse('zero leaseholds is refused', acquire(DB, A, Z.property_id, Z.review_id, { roster: [] }), /no leasehold/);
// unresolved extraction: a raw upload row with a name, no document, no resolution
const U = makeDeal(DB, A, 'Unresolved Deal');
q(`update public.acquisition_reviews set data = data || '{"tenants":[{"id":"raw-1","tenant_name":"Loose Row","_status":"ok"}]}'::jsonb where id='${U.R}';`, DB);
refuse('an unresolved extraction is refused', acquire(DB, A, U.P, U.R, U.snap), /not matched to a tenant/);
q(`update public.acquisition_reviews set data = data || jsonb_build_object('extractionResolutions', jsonb_build_object('raw-1', jsonb_build_object('action','dismissed'))) where id='${U.R}';`, DB);
r = acquire(DB, A, U.P, U.R, U.snap);
check('… and a person\'s dismissal resolves it (the JS resolution vocabulary is honoured)', r.ok && parse(r).ok === true, r.out.slice(0, 200));
// pending documents: untyped / unmatched / AI-filed unconfirmed
const Pd = makeDeal(DB, A, 'Pending Docs Deal');
as(A, `insert into public.acquisition_documents(review_id,user_id,file_name,intake_id) values ('${Pd.R}','${A}','mystery.pdf','ik-9');`, DB);
refuse('a pending document (type not set) is refused', acquire(DB, A, Pd.P, Pd.R, Pd.snap), /document\(s\) a person must still resolve/);
q(`update public.acquisition_reviews set data = data || jsonb_build_object('documentDispositions', jsonb_build_object((select id::text from public.acquisition_documents where intake_id='ik-9' and review_id='${Pd.R}'), jsonb_build_object('action','not_relevant'))) where id='${Pd.R}';`, DB);
as(A, `insert into public.acquisition_documents(review_id,user_id,file_name,intake_id,doc_type,doc_type_status,doc_type_source,confirmed_by,confirmed_at) values ('${Pd.R}','${A}','loose-lease.pdf','ik-10','original_lease','confirmed','human','${A}',now());`, DB);
refuse('a family-type document not matched to a tenant is refused', acquire(DB, A, Pd.P, Pd.R, Pd.snap), /document\(s\) a person must still resolve/);
as(A, `update public.acquisition_documents set family_id='${Pd.F1}', family_status='proposed', family_source='ai' where intake_id='ik-10' and review_id='${Pd.R}';`, DB);
refuse('a document filed into a leasehold by AI and not confirmed is refused', acquire(DB, A, Pd.P, Pd.R, Pd.snap), /document\(s\) a person must still resolve/);
as(A, `update public.acquisition_documents set family_status='confirmed', confirmed_by='${A}', confirmed_at=now() where intake_id='ik-10' and review_id='${Pd.R}';`, DB);
r = acquire(DB, A, Pd.P, Pd.R, Pd.snap);
check('… and once a person confirms the filing, the acquisition proceeds', r.ok && parse(r).ok === true, r.out.slice(0, 200));
// roster shape
const swap = (rows, i, patch) => rows.map((row, k) => k === i ? Object.assign({}, row, patch) : row);
refuse('cross-review family in the roster (a leasehold of Deal Three)', acquire(DB, A, E.P, E.R, { roster: swap(E.roster, 1, { id: G.F1, family_id: G.F1 }) }), /not one of review/);
refuse('cross-property family: a roster row naming another property', acquire(DB, A, E.P, E.R, { roster: swap(E.roster, 0, { property_id: G.P }) }), /names property/);
refuse('a roster row naming another review', acquire(DB, A, E.P, E.R, { roster: swap(E.roster, 0, { review_id: G.R }) }), /names review/);
refuse('duplicate family in the roster', acquire(DB, A, E.P, E.R, { roster: swap(E.roster, 1, { id: E.F1, family_id: E.F1 }) }), /more than once|is missing/);
refuse('missing family (one row for two leaseholds)', acquire(DB, A, E.P, E.R, { roster: [E.roster[0]] }), /has 1 row/);
refuse('extra family (three rows for two leaseholds)', acquire(DB, A, E.P, E.R, { roster: E.roster.concat([Object.assign({}, E.roster[0], { id: G.F2, family_id: G.F2 })]) }), /has 3 row/);
refuse('a roster row whose id is not its family_id', acquire(DB, A, E.P, E.R, { roster: swap(E.roster, 0, { id: G.F1 }) }), /not its leasehold id/);
refuse('a roster that is not an array', acquire(DB, A, E.P, E.R, { roster: { a: 1 } }), /must be an array/);
refuse('no roster at all', acquire(DB, A, E.P, E.R, {}), /must be an array/);
// a tenant with a leasehold's id already under another property
q(`insert into public.tenants(id, property_id, name) values ('${E.F2}', '${D.P}', 'Squatter');`, DB);
refuse('a tenant with a leasehold\'s id that belongs to ANOTHER property is never adopted or re-pointed', acquire(DB, A, E.P, E.R, E.snap), /already belongs to property/);
q(`delete from public.tenants where id='${E.F2}';`, DB);
// a second open episode on the property (forced past 034's guard by the harness)
r = q(`select set_config('mainstreet.begin_acquisition','on',true); insert into public.acquisition_reviews(id,user_id,name,status,property_id) values ('aaaaaaaa-0000-4000-8000-0000000000e2','${A}','second episode','draft','${E.P}');`, DB);
if (r.ok) {
  // The harness got a second open episode past 034 — the function must refuse.
  refuse('a property with another open episode is refused', acquire(DB, A, E.P, E.R, E.snap), /other open episode/);
  q(`delete from public.acquisition_reviews where id='aaaaaaaa-0000-4000-8000-0000000000e2';`, DB);
} else {
  check('a second open episode cannot even be created (034\'s one-open-episode index), so the function\'s own check is a second layer', refused(r, /acq_reviews_one_open_per_property|duplicate key/), r.out.slice(0, 160));
}
check('after every refusal, Deal Two is exactly as it was', snapshot(DB, E.P, E.R) === snapE);

// ── 4 · atomicity ────────────────────────────────────────────────────────────
section('4 · ATOMICITY — a failure after each write rolls everything back');
// The injection point is a ROW in a harness table, written by a separate call
// before the acquire, so the test does not depend on how psql carries a session
// setting across statements.
q(`create table public.harness_flags (fail_at text);
   create or replace function public.harness_fail() returns trigger language plpgsql as $f$
   begin
     if exists (select 1 from public.harness_flags where fail_at = tg_argv[0]) then raise exception 'harness: injected failure at %', tg_argv[0]; end if;
     return null;
   end $f$;
   create trigger harness_after_stage    after update of lifecycle_stage on public.properties for each row when (new.lifecycle_stage = 'acquired') execute function public.harness_fail('after_stage');
   create trigger harness_after_tenants  after insert on public.tenants for each row execute function public.harness_fail('after_tenants');
   create trigger harness_after_invoices after update of data on public.properties for each row when (new.data ? 'acquiredFrom') execute function public.harness_fail('after_invoices');
   create trigger harness_after_review   after update of status on public.acquisition_reviews for each row when (new.status = 'converted') execute function public.harness_fail('after_review');
   create trigger harness_after_event    after insert on public.property_events for each row execute function public.harness_fail('after_event');`, DB);
for (const at of ['after_stage', 'after_tenants', 'after_invoices', 'after_review', 'after_event']) {
  const s0 = snapshot(DB, E.P, E.R);
  q(`delete from public.harness_flags; insert into public.harness_flags values ('${at}');`, DB);
  r = acquire(DB, A, E.P, E.R, E.snap);
  check(`failure injected ${at.replace('_', ' ')}: the call fails`, refused(r, /injected failure/), r.out.slice(0, 160));
  check(`  … property still prospect, review still open, tenants / data / events byte-identical`, snapshot(DB, E.P, E.R) === s0
    && one(`select lifecycle_stage||'|'||(select status from public.acquisition_reviews where id='${E.R}') from public.properties where id='${E.P}';`, DB) === 'prospect|draft'
    && one(`select count(*) from public.tenants where property_id='${E.P}';`, DB) === '0'
    && one(`select count(*) from public.property_events where property_id='${E.P}' and action='stage_changed';`, DB) === '0');
}
q(`drop trigger harness_after_stage on public.properties; drop trigger harness_after_tenants on public.tenants; drop trigger harness_after_invoices on public.properties;
   drop trigger harness_after_review on public.acquisition_reviews; drop trigger harness_after_event on public.property_events; drop function public.harness_fail(); drop table public.harness_flags;`, DB);
r = acquire(DB, A, E.P, E.R, E.snap);
check('with the injections removed, Deal Two acquires on the same id', r.ok && parse(r).property_id === E.P && one(`select lifecycle_stage from public.properties where id='${E.P}';`, DB) === 'acquired', r.out.slice(0, 200));

// ── 5 · no business logic, no property insert ────────────────────────────────
section('5 · NO BUSINESS LOGIC IN SQL, NO PROPERTY INSERT');
const code = strip(SQL);
check('the file inserts no properties row', !/insert\s+into\s+public\.properties\b/i.test(code));
check('the file does not port the term resolver (no resolveFamilyTerms, abstracted_fields, decisions or term-state logic)', !/resolveFamilyTerms|abstracted_fields|acquisition_term_decisions|conflicting|verified/i.test(code));
check('the family-type list is exactly the JS module\'s (DOC_TYPES family: true)', (() => {
  const AD = require('../acquisition-documents.js');
  const js = Object.keys(AD.DOC_TYPES).filter(k => AD.DOC_TYPES[k].family).sort().join(',');
  const m = code.match(/c_family_types\s+constant\s+text\[\]\s*:=\s*array\[([^\]]+)\]/);
  const sql = m ? m[1].split(',').map(s => s.trim().replace(/'/g, '')).sort().join(',') : '<missing>';
  return js === sql;
})());
check('the disposition and resolution vocabularies are the JS modules\'', /'not_relevant',\s*'duplicate'/.test(code) && /'dismissed'/.test(code) && /'matched',\s*'new_leasehold'/.test(code));
check('the transition uses 033\'s reserved setting and nothing else writes lifecycle_stage', (code.match(/set_config\('mainstreet\.acquire'/g) || []).length === 2 && (code.match(/lifecycle_stage\s*=\s*'acquired'/g) || []).length === 1);
check('034\'s reserved setting is never armed here (no episode or prospect is created)', !/mainstreet\.begin_acquisition/.test(code));
check('035 touches nothing XRPL, wallet, payment or settlement related', !/rlusd|xrpl|xrp\b|wallet|ripple|settlement|payment_/i.test(code));

// ── 6 · nothing else moved; rollback ─────────────────────────────────────────
section('6 · NOTHING ELSE MOVED · ROLLBACK');
check('every object outside acquire_property is identical across the apply', inventory(DB) === before, 'inventory differs');
r = pg.psqlFile(R035, DB);
check('rollback applies', r.ok, r.out.slice(0, 300));
check('the function is gone and nothing else changed', one(`select count(*) from pg_proc where proname='acquire_property';`, DB) === '0' && inventory(DB) === before);
check('an acquisition already made stays made (acquired is terminal; the rollback undoes no data)', one(`select lifecycle_stage from public.properties where id='${D.P}';`, DB) === 'acquired');
r = pg.psqlFile(M035, DB);
check('035 applies again after the rollback', r.ok && one(`select count(*) from pg_proc where proname='acquire_property';`, DB) === '1', r.out.slice(0, 300));

T.finish();
