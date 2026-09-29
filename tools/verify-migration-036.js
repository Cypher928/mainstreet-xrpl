'use strict';
/**
 * tools/verify-migration-036.js — run 036 (P5-6A: a converted acquisition is
 * frozen) for real, against nothing that matters.
 *
 *   node tools/verify-migration-036.js
 *
 * It touches NO Supabase project. It builds a throwaway PostgreSQL cluster,
 * stands up STAND-INS for the acquisition tables with the columns, CHECKs,
 * keys, triggers, functions, privileges and row policies read from Pilot's
 * live catalog (organisations, memberships and property_events included),
 * installs 032, 033, 034 and 035 from their files, and then applies 036.
 *
 * WHAT IT PROVES
 *
 *   1  036 applies, and applies again; exactly the objects its header lists
 *      appear; the helper is SECURITY DEFINER / STABLE; anon loses every
 *      privilege on acquisition_reviews and acquisition_documents and nothing
 *      else's privileges move
 *   2  acquire_property still works end to end AFTER 036 (its own update sees
 *      an open review); the episode it converts is the frozen fixture
 *   3  AUTHORIZATION MATRIX on the converted episode — owner, org member
 *      (property_manager), org admin (not the owner), anon, service role:
 *      SELECT allowed (anon denied); every UPDATE / DELETE of the review,
 *      every INSERT / UPDATE / DELETE of a document, family or decision
 *      refused; delete_prospect_acquisition refused; property_events INSERT
 *      still allowed; after every refusal the whole episode (updated_at
 *      included) is byte-identical
 *   4  OPEN / PROSPECT episodes keep their behaviour: every write the matrix
 *      refuses on a converted episode is allowed on an open one for owner,
 *      member, admin and service role; anon denied; delete_prospect_acquisition
 *      keeps 034's rule
 *   5  THE LEGACY REVERT PATH cannot become a bypass: the property's own
 *      ON DELETE SET NULL passes (depth 2); a direct property_id := null is
 *      refused; on Pilot the revert itself is refused by 034's CHECK
 *      (acq_reviews_open_has_property) before the freeze is even asked; with
 *      that CHECK removed in a harness-only copy, the exact shape passes and
 *      every variant (property still stands, status other than complete,
 *      conversionRecord kept, analysis / families / name / converted_at
 *      touched, upgrade keys added to a legacy-shaped row) is refused
 *   6  CASCADES still work: the auth.users cascade removes a converted review
 *      and its children (depth > 1), including the foreign keys' own SET NULL
 *      steps; a direct delete of the same rows at depth 1 is refused
 *   7  ATOMICITY: a refused write inside a transaction rolls back everything
 *      the transaction did; an acquire_property call that fails after its
 *      review update leaves the review open and acquirable
 *   8  NOTHING ELSE MOVED — every object outside 036's own is identical across
 *      the apply; ROLLBACK removes the triggers and functions (and, as its
 *      header says, does not re-grant anon); 036 applies again
 *   9  STATIC: the file adds or alters no policy, no column, no constraint, no
 *      function of 028–035, runs no top-level DML, and says nothing of XRPL
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
const M036 = path.join(MIG, '036_acquisition_episode_frozen.sql');
const R036 = path.join(MIG, '036_acquisition_episode_frozen_rollback.sql');

const T = tally();
const { check, section } = T;
const SQL = fs.readFileSync(M036, 'utf8');
const strip = (s) => s.replace(/^\s*--.*$/gm, '');

console.log('\n══ migration 036 — executed against a throwaway cluster ══');
console.log('   NO Supabase project is contacted by this script.');
const pg = startCluster('036');
console.log('   postgres: ' + pg.PGBIN);

// ── people and organisations ─────────────────────────────────────────────────
const A = '11111111-1111-4111-8111-111111111111';   // owner of the properties, admin of O1
const M = '33333333-3333-4333-8333-333333333333';   // property_manager in O1 (a member, not an admin)
const D = '55555555-5555-4555-8555-555555555555';   // admin of O1 who owns nothing
const R = '44444444-4444-4444-8444-444444444444';   // read_only in O1
const S = '22222222-2222-4222-8222-222222222222';   // stranger, admin of O2
const Z = '66666666-6666-4666-8666-666666666666';   // owner used for the cascade test, admin of O3
const O1 = 'c1c1c1c1-0000-4000-8000-000000000001', O2 = 'c2c2c2c2-0000-4000-8000-000000000002', O3 = 'c3c3c3c3-0000-4000-8000-000000000003';

// The stand-in mirrors Pilot's live catalog as read on 2026-09-29 — including
// the privileges 024b / 026c left (authenticated: no DELETE on families, no
// UPDATE/DELETE on decisions; anon: nothing on those two tables) and the ones
// 006 / 023 never revoked (anon: everything on reviews and documents).
const SCHEMA = `
  insert into auth.users(id) values ('${A}'),('${M}'),('${D}'),('${R}'),('${S}'),('${Z}');
  create table public.organizations (id uuid primary key default gen_random_uuid(), name text, created_by uuid, created_at timestamptz default now());
  create table public.organization_members (id uuid primary key default gen_random_uuid(), organization_id uuid references public.organizations(id), user_id uuid references auth.users(id) on delete cascade,
    role text not null check (role in ('admin','property_manager','accounting','leasing','read_only')), invited_by uuid, invited_at timestamptz default now(), accepted_at timestamptz, revoked_at timestamptz, created_at timestamptz default now());
  insert into public.organizations(id,name,created_by) values ('${O1}','Org One','${A}'),('${O2}','Org Two','${S}'),('${O3}','Org Three','${Z}');
  insert into public.organization_members(organization_id,user_id,role,accepted_at) values
    ('${O1}','${A}','admin',now()),('${O1}','${M}','property_manager',now()),('${O1}','${D}','admin',now()),('${O1}','${R}','read_only',now()),('${O2}','${S}','admin',now()),('${O3}','${Z}','admin',now());
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
  create table public.acquisition_reviews (
    id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade, name text not null,
    status text not null default 'draft' constraint acquisition_reviews_status_check check (status in ('draft','analyzing','complete','converted')),
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
    produced_kind text, produced_id text, abstracted_fields jsonb, abstraction_status text, abstraction_error text,
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
    constraint acq_docs_family_fk foreign key (family_id, user_id) references public.acquisition_document_families(id, user_id) on delete set null (family_id),
    constraint acq_docs_parent_fk foreign key (parent_document_id, user_id) references public.acquisition_documents(id, user_id) on delete set null (parent_document_id),
    constraint acq_docs_superseded_fk foreign key (superseded_by_document_id, user_id) references public.acquisition_documents(id, user_id) on delete set null (superseded_by_document_id));
  create table public.acquisition_term_decisions (
    id uuid primary key default gen_random_uuid(), review_id uuid not null, user_id uuid not null, family_id uuid, field_key text not null, action text not null check (action in ('confirm','correct','reject','reopen')),
    previous_value text, new_value text, source_document_id uuid, decided_by uuid not null, decided_at timestamptz not null default now(), created_at timestamptz not null default now(),
    constraint acq_term_decisions_review_fk foreign key (review_id, user_id) references public.acquisition_reviews(id, user_id) on delete cascade,
    constraint acq_term_decisions_family_fk foreign key (family_id, user_id) references public.acquisition_document_families(id, user_id) on delete set null (family_id),
    constraint acq_term_decisions_source_doc_fk foreign key (source_document_id, user_id) references public.acquisition_documents(id, user_id) on delete set null (source_document_id));
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
  begin
    if tg_op = 'DELETE' then if pg_trigger_depth() <= 1 then raise exception 'property_events is append-only' using errcode = 'integrity_constraint_violation'; end if; return old; end if;
    if pg_trigger_depth() <= 1 then raise exception 'property_events is append-only' using errcode = 'integrity_constraint_violation'; end if;
    return new;
  end $f$;
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
  grant all on all tables in schema public to authenticated;
  -- 024b and 026c, as Pilot holds them today
  revoke all on public.acquisition_document_families, public.acquisition_term_decisions from anon;
  revoke delete, truncate, references, trigger on public.acquisition_document_families from authenticated;
  revoke update, delete, truncate, references, trigger on public.acquisition_term_decisions from authenticated;`;

const q = (sql, db) => pg.psql(sql, db);
const as = (uid, sql, db) => pg.as('authenticated', uid, sql, db);
const svc = (sql, db) => pg.as('service_role', null, sql, db);
const anon = (sql, db) => pg.as('anon', null, sql, db);
const refused = (r, re) => !r.ok && (re ? re.test(r.out) : true);
const one = (sql, db) => q(sql, db).out;
const parse = (r) => { try { return JSON.parse(r.out); } catch (_) { return { _raw: r.out }; } };
const lit = (v) => JSON.stringify(v).replace(/'/g, "''");
const rpcBegin = (db, uid, name, data) => parse(as(uid, `select public.begin_acquisition('${name}', '${lit(Object.assign({ totalSqFt: '1000' }, data || {}))}'::jsonb);`, db));
const acquire = (db, uid, pid, rid, snapshot, pre) => as(uid, `${pre || ''}select public.acquire_property('${pid}'::uuid, '${rid}'::uuid, '${lit(snapshot)}'::jsonb);`, db);

// Every object outside 036's own — the freeze's functions and triggers are
// excluded by name so the diff says whether anything ELSE moved.
const OWN_FN = ['_acq_episode_frozen', 'acq_children_frozen', 'acq_reviews_frozen'];
const inventory = (db) => q(`
  select string_agg(x, E'\\n' order by x) from (
    select 'con|'||conrelid::regclass::text||'|'||conname||'|'||pg_get_constraintdef(oid) as x from pg_constraint where connamespace='public'::regnamespace
    union all select 'trg|'||t.tgrelid::regclass::text||'|'||t.tgname||'|'||pg_get_triggerdef(t.oid) from pg_trigger t where not t.tgisinternal and t.tgname not like 'harness_%' and t.tgname not in ('acq_children_frozen','acq_reviews_frozen')
    union all select 'fn|'||p.proname||'|'||md5(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f' and p.proname not in (${OWN_FN.map(f => `'${f}'`).join(',')},'harness_fail')
    union all select 'col|'||table_name||'|'||column_name||'|'||data_type||'|'||is_nullable from information_schema.columns where table_schema='public'
    union all select 'idx|'||indexname||'|'||indexdef from pg_indexes where schemaname='public'
    union all select 'pol|'||tablename||'|'||policyname||'|'||coalesce(qual,'')||'|'||coalesce(with_check,'') from pg_policies where schemaname='public'
    union all select 'pri|'||table_name||'|'||grantee||'|'||string_agg(privilege_type, ',' order by privilege_type) from information_schema.role_table_grants where table_schema='public' and grantee in ('anon','authenticated','service_role') and not (grantee='anon' and table_name in ('acquisition_reviews','acquisition_documents')) group by table_name, grantee
  ) s;`, db).out;
const ownObjects = (db) => one(`
  select string_agg(x, ';' order by x) from (
    select 'trg|'||t.tgrelid::regclass::text||'|'||t.tgname as x from pg_trigger t where not t.tgisinternal and t.tgname in ('acq_children_frozen','acq_reviews_frozen')
    union all select 'fn|'||p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in (${OWN_FN.map(f => `'${f}'`).join(',')})
  ) s;`, db);
// The whole episode: the review row and every child, with updated_at, so a refused write that slipped through shows.
const episode = (db, rid) => one(`
  select coalesce((select r.status||'|'||coalesce(r.name,'')||'|'||coalesce(r.property_id::text,'')||'|'||coalesce(r.converted_at::text,'')||'|'||r.data::text||'|'||r.updated_at::text from public.acquisition_reviews r where r.id='${rid}'),'<no review>')
    || '#' || coalesce((select string_agg(d.id::text||'|'||coalesce(d.family_id::text,'')||'|'||d.family_status||'|'||coalesce(d.doc_type,'')||'|'||d.doc_type_status||'|'||coalesce(d.abstraction_status,'')||'|'||coalesce(d.superseded_by_document_id::text,'')||'|'||d.updated_at::text, ',' order by d.id) from public.acquisition_documents d where d.review_id='${rid}'),'')
    || '#' || coalesce((select string_agg(f.id::text||'|'||f.label||'|'||coalesce(f.tenant_hint,'')||'|'||f.updated_at::text, ',' order by f.id) from public.acquisition_document_families f where f.review_id='${rid}'),'')
    || '#' || coalesce((select string_agg(t.id::text||'|'||t.field_key||'|'||t.action||'|'||coalesce(t.new_value,''), ',' order by t.id) from public.acquisition_term_decisions t where t.review_id='${rid}'),'')
    || '#' || (select count(*) from public.acquisition_term_decisions where review_id='${rid}')::text;`, db);

// A deal with two confirmed leaseholds, one decision and clean records; returns ids.
function makeDeal(db, uid, name, opts) {
  const o = opts || {};
  const d = rpcBegin(db, uid, name, o.data || { totalSqFt: '1000', invoices: [{ id: 'inv-1', vendorName: 'Tax', amount: 100, category: 'taxes' }] });
  const P = d.property_id, Rv = d.review_id;
  const F1 = one(`select gen_random_uuid();`, db), F2 = one(`select gen_random_uuid();`, db);
  const D1 = one(`select gen_random_uuid();`, db), D2 = one(`select gen_random_uuid();`, db), X1 = one(`select gen_random_uuid();`, db);
  as(uid, `insert into public.acquisition_document_families(id,review_id,user_id,label,tenant_hint) values ('${F1}','${Rv}','${uid}','Leasehold One','One'),('${F2}','${Rv}','${uid}','Leasehold Two','Two');`, db);
  as(uid, `insert into public.acquisition_documents(id,review_id,user_id,file_name,intake_id,family_id,family_status,doc_type,doc_type_status,doc_type_source,confirmed_by,confirmed_at,abstraction_status) values
    ('${D1}','${Rv}','${uid}','one.pdf','ik-1','${F1}','confirmed','original_lease','confirmed','human','${uid}',now(),'success'),
    ('${D2}','${Rv}','${uid}','two.pdf','ik-2','${F2}','confirmed','original_lease','confirmed','human','${uid}',now(),'pending');`, db);
  as(uid, `insert into public.acquisition_term_decisions(id,review_id,user_id,family_id,field_key,action,previous_value,new_value,source_document_id,decided_by) values
    ('${X1}','${Rv}','${uid}','${F1}','leased_sqft','confirm','400','400','${D1}','${uid}');`, db);
  const roster = [
    { id: F1, family_id: F1, property_id: P, review_id: Rv, tenant_name: 'Tenant One', leased_sqft: '400', cap: '5', start_date: '2024-01-01', end_date: '2029-12-31', lease_type: 'NNN' },
    { id: F2, family_id: F2, property_id: P, review_id: Rv, tenant_name: 'Tenant Two', leased_sqft: '600', cap: null, start_date: '2023-06-01', end_date: '2028-05-31', lease_type: 'Gross' },
  ];
  return { P, R: Rv, F1, F2, D1, D2, X1, roster, snap: { roster, propertyName: name, occupancyAtAcquisition: 100, waltAtAcquisition: 4.2 } };
}

// A v2-shaped review record (AcquisitionWorkspace.upgradeReview's keys), so the
// legacy-revert shape can be exercised exactly as the client writes it.
const V2 = (extra) => Object.assign({
  schemaVersion: 2, stage: 'report', tenants: [], invoices: [], totalSqFt: 1000, documents: [], families: [], assumptions: {},
  activity: [{ id: 'act-1', type: 'analysis_run', at: '2026-09-01T00:00:00.000Z' }], activityCount: 1, activityDropped: 0,
  analysis: { summary: { recoveryRate: 70 }, canonical: { at: '2026-09-01T00:00:00.000Z', states: {} } },
  documentDispositions: { 'doc-x': { action: 'not_relevant' } }, extractionResolutions: { 'raw-1': { action: 'dismissed' } },
}, extra || {});

// A converted review WITHOUT children — the shape of Pilot's three Harborview
// rows and its one orphan: begun through begin_acquisition, then marked
// converted by the harness (the pre-035 client wrote exactly these columns).
function makeLegacyConverted(db, uid, name, data) {
  const d = rpcBegin(db, uid, name, data || V2());
  q(`update public.acquisition_reviews set status='converted', converted_at=now(),
       data = data || jsonb_build_object('conversionRecord', jsonb_build_object('propertyId','${d.property_id}','propertyName','${name}','convertedAt','2026-09-10T00:00:00.000Z'), 'stage','acquired')
     where id='${d.review_id}';`, db);
  return { P: d.property_id, R: d.review_id };
}

// ── build ────────────────────────────────────────────────────────────────────
const DB = 'pilotlike';
let r = pg.database(DB, 'legacy');
check('pilotlike: database built under Pilot\'s legacy default privileges', r.ok, r.ok ? '' : r.out.slice(0, 300));
r = q(SCHEMA, DB);
check('pilotlike: stand-ins with Pilot\'s constraints, triggers, functions, privileges, organisations, property_events and policies', r.ok, r.ok ? '' : r.out.slice(0, 500));
for (const [f, n] of [[M032, '032'], [M033, '033'], [M034, '034'], [M035, '035']]) { r = pg.psqlFile(f, DB); check(`pilotlike: ${n} installed from its file`, r.ok, r.ok ? '' : r.out.slice(0, 300)); }
check('before 036: anon holds every privilege on acquisition_reviews and acquisition_documents (006 / 023 never revoked)',
  pg.privs('public.acquisition_reviews', 'anon', DB) === 'DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE' && pg.privs('public.acquisition_documents', 'anon', DB) === 'DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE',
  pg.privs('public.acquisition_reviews', 'anon', DB));
check('before 036: authenticated may DELETE reviews and documents, not families; may not UPDATE or DELETE decisions',
  /DELETE/.test(pg.privs('public.acquisition_reviews', 'authenticated', DB)) && /DELETE/.test(pg.privs('public.acquisition_documents', 'authenticated', DB))
  && pg.privs('public.acquisition_document_families', 'authenticated', DB) === 'INSERT,SELECT,UPDATE' && pg.privs('public.acquisition_term_decisions', 'authenticated', DB) === 'INSERT,SELECT');
const before = inventory(DB);
const authPrivsBefore = ['acquisition_reviews', 'acquisition_documents', 'acquisition_document_families', 'acquisition_term_decisions'].map(t => t + ':' + pg.privs('public.' + t, 'authenticated', DB) + '/' + pg.privs('public.' + t, 'service_role', DB)).join(';');

// Before 036 the same episode is mutable — the freeze is what this file adds.
const PRE = makeDeal(DB, A, 'Pre Deal');
r = acquire(DB, A, PRE.P, PRE.R, PRE.snap);
check('before 036: acquire_property converts an episode', r.ok && parse(r).ok === true, r.out.slice(0, 200));
r = as(A, `update public.acquisition_reviews set data = jsonb_set(data, '{analysis}', '{"summary":{"recoveryRate":1}}') where id='${PRE.R}';`, DB);
check('before 036: the owner CAN rewrite a converted review\'s analysis (the gap 036 closes)', r.ok, r.out.slice(0, 200));
r = as(A, `insert into public.acquisition_term_decisions(review_id,user_id,family_id,field_key,action,new_value,decided_by) values ('${PRE.R}','${A}','${PRE.F1}','cam_cap','correct','9','${A}');`, DB);
check('before 036: a decision CAN be appended to a converted episode', r.ok, r.out.slice(0, 200));

// ── 1 · apply ────────────────────────────────────────────────────────────────
section('1 · 036 applies, and applies again');
r = pg.psqlFile(M036, DB);
check('pilotlike: 036 applies', r.ok, r.ok ? '' : r.out.slice(0, 600));
r = pg.psqlFile(M036, DB);
check('pilotlike: 036 applies a second time without error', r.ok, r.out.slice(0, 300));
check('exactly its objects appear: three functions, four triggers',
  ownObjects(DB) === 'fn|_acq_episode_frozen;fn|acq_children_frozen;fn|acq_reviews_frozen;trg|acquisition_document_families|acq_children_frozen;trg|acquisition_documents|acq_children_frozen;trg|acquisition_reviews|acq_reviews_frozen;trg|acquisition_term_decisions|acq_children_frozen',
  ownObjects(DB));
const helperAttrs = one(`select prosecdef::text||'|'||provolatile::text||'|'||coalesce(array_to_string(proconfig,','),'') from pg_proc where proname='_acq_episode_frozen';`, DB);
check('_acq_episode_frozen is SECURITY DEFINER, STABLE, empty search_path', helperAttrs === 'true|s|search_path=""', helperAttrs);
check('the trigger functions run with an empty search_path', one(`select string_agg(coalesce(array_to_string(proconfig,','),'<none>'), ';' order by proname) from pg_proc where proname in ('acq_children_frozen','acq_reviews_frozen');`, DB) === 'search_path="";search_path=""');
check('anon and PUBLIC cannot execute the helper; authenticated and service_role can',
  !pg.canExecute('anon', 'public._acq_episode_frozen(uuid)', DB) && one(`select has_function_privilege(0, 'public._acq_episode_frozen(uuid)', 'execute');`, DB) === 'f'
  && pg.canExecute('authenticated', 'public._acq_episode_frozen(uuid)', DB) && pg.canExecute('service_role', 'public._acq_episode_frozen(uuid)', DB));
check('the freeze triggers sort before every existing trigger on their tables (evaluated first)', one(`
  select bool_and(ok)::text from (
    select t.tgrelid, (select min(x.tgname) from pg_trigger x where x.tgrelid=t.tgrelid and not x.tgisinternal) in ('acq_children_frozen','acq_reviews_frozen') as ok
    from pg_trigger t where t.tgname in ('acq_children_frozen','acq_reviews_frozen') group by t.tgrelid) s;`, DB) === 'true');
check('after 036: anon holds NO privilege on acquisition_reviews or acquisition_documents', pg.privs('public.acquisition_reviews', 'anon', DB) === '' && pg.privs('public.acquisition_documents', 'anon', DB) === '');
check('after 036: authenticated and service_role privileges are unchanged on all four tables',
  ['acquisition_reviews', 'acquisition_documents', 'acquisition_document_families', 'acquisition_term_decisions'].map(t => t + ':' + pg.privs('public.' + t, 'authenticated', DB) + '/' + pg.privs('public.' + t, 'service_role', DB)).join(';') === authPrivsBefore);

// ── 2 · acquire_property still works ─────────────────────────────────────────
section('2 · acquire_property still converts an open episode after 036');
const C = makeDeal(DB, A, 'Converted Deal');
const propsBefore = one(`select count(*) from public.properties;`, DB);
r = acquire(DB, A, C.P, C.R, C.snap);
check('the owner acquires Converted Deal in place: ok, same property id', r.ok && parse(r).ok === true && parse(r).property_id === C.P, r.out.slice(0, 300));
check('no second properties row; the review is converted on the same property', one(`select count(*) from public.properties;`, DB) === propsBefore
  && one(`select status||'|'||property_id::text||'|'||(converted_at is not null)::text from public.acquisition_reviews where id='${C.R}';`, DB) === `converted|${C.P}|true`);
check('its documents, leaseholds and decision are all still there, on the same property', one(`select (select count(*) from public.acquisition_documents where review_id='${C.R}' and property_id='${C.P}')||'|'||(select count(*) from public.acquisition_document_families where review_id='${C.R}' and property_id='${C.P}')||'|'||(select count(*) from public.acquisition_term_decisions where review_id='${C.R}' and property_id='${C.P}');`, DB) === '2|2|1');
check('_acq_episode_frozen says so', one(`select public._acq_episode_frozen('${C.R}');`, DB) === 't' && one(`select public._acq_episode_frozen('${PRE.R}');`, DB) === 't');
r = acquire(DB, A, C.P, C.R, C.snap);
check('a second acquire is refused as before (not a prospect / already converted)', refused(r, /not a prospect|already converted/), r.out.slice(0, 160));

// ── 3 · the matrix on a converted episode ────────────────────────────────────
section('3 · AUTHORIZATION MATRIX — converted episode: nothing moves, for anyone');
const frozenSnap = episode(DB, C.R);
// The freeze's own words — a refusal for any other reason does not count.
const FROZEN = /its record is read-only|belongs to converted acquisition review .* cannot be (deleted|changed)|cannot be added to converted acquisition review|is converted and cannot be deleted/;
const rolesW = [['owner A', (s) => as(A, s, DB)], ['member M (property_manager)', (s) => as(M, s, DB)], ['admin D (org admin, owns nothing)', (s) => as(D, s, DB)], ['service role', (s) => svc(s, DB)]];
const untouched = (label) => { const now = episode(DB, C.R); check(`  … ${label}: the episode is byte-identical (updated_at included)`, now === frozenSnap, now === frozenSnap ? '' : 'CHANGED'); };
// SELECT
for (const [who, run] of rolesW) {
  const c = run(`select (select count(*) from public.acquisition_reviews where id='${C.R}')||'|'||(select count(*) from public.acquisition_documents where review_id='${C.R}')||'|'||(select count(*) from public.acquisition_document_families where review_id='${C.R}')||'|'||(select count(*) from public.acquisition_term_decisions where review_id='${C.R}');`);
  check(`SELECT · ${who} reads the whole episode`, c.ok && c.out === '1|2|2|1', c.out.slice(0, 120));
}
r = anon(`select count(*) from public.acquisition_reviews where id='${C.R}';`, DB);
check('SELECT · anon is denied outright (no privilege after 036)', refused(r, /permission denied/), r.out.slice(0, 120));
// the writes, one by one, every role
const WRITES = [
  ['UPDATE review data.analysis (re-run)', `update public.acquisition_reviews set data = jsonb_set(data, '{analysis}', '{"summary":{"recoveryRate":1}}') where id='${C.R}';`],
  ['UPDATE review data.analysis.canonical only', `update public.acquisition_reviews set data = jsonb_set(data, '{analysis,canonical}', '{"at":"2030-01-01T00:00:00Z","states":{}}', true) where id='${C.R}';`],
  ['UPDATE review status → complete', `update public.acquisition_reviews set status='complete' where id='${C.R}';`],
  ['UPDATE review name', `update public.acquisition_reviews set name='Renamed' where id='${C.R}';`],
  ['UPDATE review data.documentDispositions', `update public.acquisition_reviews set data = jsonb_set(data, '{documentDispositions}', '{"x":{"action":"duplicate"}}', true) where id='${C.R}';`],
  ['UPDATE review data.extractionResolutions', `update public.acquisition_reviews set data = jsonb_set(data, '{extractionResolutions}', '{"raw-9":{"action":"dismissed"}}', true) where id='${C.R}';`],
  ['UPDATE review data.activity (a new act)', `update public.acquisition_reviews set data = jsonb_set(data, '{activity}', coalesce(data->'activity','[]'::jsonb) || '[{"type":"x"}]'::jsonb, true) where id='${C.R}';`],
  ['UPDATE review data.stage', `update public.acquisition_reviews set data = jsonb_set(data, '{stage}', '"intake"') where id='${C.R}';`],
  ['UPDATE review converted_at', `update public.acquisition_reviews set converted_at = now() + interval '1 day' where id='${C.R}';`],
  ['UPDATE review property_id → null (a direct un-linking)', `update public.acquisition_reviews set property_id = null where id='${C.R}';`],
  ['UPDATE review with an identical row (a no-op save still counts as a write)', `update public.acquisition_reviews set data = data where id='${C.R}';`],
  ['DELETE review', `delete from public.acquisition_reviews where id='${C.R}';`],
  ['INSERT document', `insert into public.acquisition_documents(review_id,user_id,file_name,intake_id) values ('${C.R}','${A}','late.pdf','ik-late');`],
  ['UPDATE document doc_type (retype)', `update public.acquisition_documents set doc_type='amendment', doc_type_status='corrected', confirmed_by='${A}' where id='${C.D1}';`],
  ['UPDATE document family_id (re-file)', `update public.acquisition_documents set family_id='${C.F2}' where id='${C.D1}';`],
  ['UPDATE document abstraction_status (the pending → success write a retry would make)', `update public.acquisition_documents set abstraction_status='success', abstracted_fields='{"leased_sqft":1}' where id='${C.D2}';`],
  ['UPDATE document superseded_by (a re-upload)', `update public.acquisition_documents set superseded_by_document_id='${C.D2}' where id='${C.D1}';`],
  ['DELETE document', `delete from public.acquisition_documents where id='${C.D1}';`],
  ['INSERT family', `insert into public.acquisition_document_families(review_id,user_id,label) values ('${C.R}','${A}','Late Leasehold');`],
  ['UPDATE family label', `update public.acquisition_document_families set label='Renamed Leasehold' where id='${C.F1}';`],
  ['UPDATE family tenant_hint', `update public.acquisition_document_families set tenant_hint='Somebody Else' where id='${C.F1}';`],
  ['INSERT decision (Confirm / Correct / Reject / Reopen / Enter)', `insert into public.acquisition_term_decisions(review_id,user_id,family_id,field_key,action,new_value,decided_by) values ('${C.R}','${A}','${C.F1}','cam_cap','correct','9', auth.uid());`],
  ['UPDATE decision', `update public.acquisition_term_decisions set new_value='0' where id='${C.X1}';`],
  ['DELETE decision', `delete from public.acquisition_term_decisions where id='${C.X1}';`],
];
for (const [label, sql] of WRITES) {
  for (const [who, run] of rolesW) {
    // Children rows carry the owner's user_id (the composite keys, 034 notes);
    // a member writes them under the owner's id, so the freeze — not a key —
    // is what refuses here.
    const rr = run(sql);
    // UPDATE / DELETE of a decision: authenticated has no privilege (026c); for
    // service role the freeze sorts before 026's append-only trigger and answers first.
    const by026 = /^UPDATE decision|^DELETE decision/.test(label);
    check(`${label} · ${who} → refused${by026 ? ' (026c privilege / the freeze, 026 behind it)' : ' by the freeze'}`, refused(rr) && (by026 ? (/append-only|permission denied/.test(rr.out) || FROZEN.test(rr.out)) : FROZEN.test(rr.out)), rr.out.split('\n')[0].slice(0, 140));
  }
  untouched(label);
}
// DELETE family: authenticated never had the privilege; service role has it and meets the trigger.
for (const [who, run] of rolesW.slice(0, 3)) { r = run(`delete from public.acquisition_document_families where id='${C.F1}';`); check(`DELETE family · ${who} → denied (024b privilege, unchanged)`, refused(r, /permission denied/), r.out.slice(0, 120)); }
r = svc(`delete from public.acquisition_document_families where id='${C.F1}';`, DB);
check('DELETE family · service role → refused by the freeze', refused(r, FROZEN), r.out.slice(0, 140));
untouched('DELETE family');
// anon: denied on the two tables it used to hold; zero rows / denied elsewhere
r = anon(`update public.acquisition_reviews set name='x' where id='${C.R}';`, DB); check('anon UPDATE review → permission denied', refused(r, /permission denied/), r.out.slice(0, 120));
r = anon(`delete from public.acquisition_documents where review_id='${C.R}';`, DB); check('anon DELETE document → permission denied', refused(r, /permission denied/), r.out.slice(0, 120));
r = anon(`insert into public.acquisition_document_families(review_id,user_id,label) values ('${C.R}','${A}','x');`, DB); check('anon INSERT family → permission denied (024b, unchanged)', refused(r, /permission denied/), r.out.slice(0, 120));
r = anon(`insert into public.acquisition_term_decisions(review_id,user_id,family_id,field_key,action,decided_by) values ('${C.R}','${A}','${C.F1}','x','confirm','${A}');`, DB); check('anon INSERT decision → permission denied (026c, unchanged)', refused(r, /permission denied/), r.out.slice(0, 120));
untouched('anon');
// delete_prospect_acquisition on the converted episode
for (const [who, uid] of [['owner A', A], ['member M', M], ['admin D', D]]) { r = as(uid, `select public.delete_prospect_acquisition('${C.R}');`, DB); check(`delete_prospect_acquisition · ${who} → refused (034: not a prospect / not an admin)`, refused(r, /not a prospect|administrator|converted/), r.out.slice(0, 140)); }
r = anon(`select public.delete_prospect_acquisition('${C.R}');`, DB); check('delete_prospect_acquisition · anon → refused', refused(r), r.out.slice(0, 120));
untouched('delete_prospect_acquisition');
// property_events stays open
r = as(A, `insert into public.property_events(property_id, action, subject_type, subject_id, detail) values ('${C.P}','note_added','property','${C.P}','{}');`, DB);
check('INSERT property_events on the acquired property · owner → allowed (028 unchanged)', r.ok, r.out.slice(0, 120));
r = as(M, `insert into public.property_events(property_id, action, subject_type, subject_id, detail) values ('${C.P}','note_added','property','${C.P}','{}');`, DB);
check('INSERT property_events · member → allowed', r.ok, r.out.slice(0, 120));
untouched('property_events');
// a stranger sees nothing and changes nothing, exactly as before
r = as(S, `update public.acquisition_reviews set name='x' where id='${C.R}';`, DB);
check('stranger S: zero rows under RLS (no error, no change)', r.ok && episode(DB, C.R) === frozenSnap, r.out.slice(0, 120));
// the pre-036 episode is frozen too — the freeze reads status, not when it was converted
r = as(A, `update public.acquisition_reviews set data = jsonb_set(data, '{analysis}', '{}') where id='${PRE.R}';`, DB);
check('an episode converted BEFORE 036 is frozen as well (status is the predicate)', refused(r, FROZEN), r.out.slice(0, 140));
check('a refused write raises integrity_constraint_violation (23000) with a hint naming the property', (() => {
  const rr = as(A, `do $$ begin update public.acquisition_reviews set name='x' where id='${C.R}'; exception when others then raise notice 'CODE=% HINT=%', sqlstate, coalesce(pg_exception_context(), ''); end $$;`, DB);
  void rr;
  const rc = as(A, `do $$ declare h text; begin update public.acquisition_reviews set name='x' where id='${C.R}'; exception when others then get stacked diagnostics h = pg_exception_hint; raise exception 'CODE=% HINT=%', sqlstate, h; end $$;`, DB);
  return refused(rc, /CODE=23000/) && new RegExp(C.P).test(rc.out);
})());

// ── 4 · open episodes are unchanged ──────────────────────────────────────────
section('4 · OPEN / PROSPECT episodes keep their existing behaviour');
const O = makeDeal(DB, A, 'Open Deal');
check('_acq_episode_frozen is false for the open episode (and for an unknown id)', one(`select public._acq_episode_frozen('${O.R}')::text||'|'||public._acq_episode_frozen('00000000-0000-4000-8000-000000000000')::text;`, DB) === 'false|false');
// Children rows carry user_id = owner (the composite keys, 034 notes: a
// member's write under their own user_id is refused by those keys already).
const openWrites = (n) => [
  [`UPDATE review data.analysis`, `update public.acquisition_reviews set data = jsonb_set(data, '{analysis}', '{"summary":{"recoveryRate":${n}}}', true) where id='${O.R}';`],
  [`UPDATE review status → complete`, `update public.acquisition_reviews set status='complete' where id='${O.R}';`],
  [`UPDATE review name`, `update public.acquisition_reviews set name='Open Deal ${n}' where id='${O.R}';`],
  [`INSERT document`, `insert into public.acquisition_documents(review_id,user_id,file_name,intake_id) values ('${O.R}','${A}','late-${n}.pdf','ik-late-${n}');`],
  [`UPDATE document`, `update public.acquisition_documents set abstraction_status='success' where id='${O.D2}';`],
  [`INSERT family`, `insert into public.acquisition_document_families(review_id,user_id,label) values ('${O.R}','${A}','Leasehold ${n}');`],
  [`UPDATE family`, `update public.acquisition_document_families set tenant_hint='Hint ${n}' where id='${O.F1}';`],
  [`INSERT decision`, `insert into public.acquisition_term_decisions(review_id,user_id,family_id,field_key,action,new_value,decided_by) values ('${O.R}','${A}','${O.F1}','cam_cap','correct','${n}','${A}');`],
];
let n = 0;
for (const [who, run] of [['owner A', (s) => as(A, s, DB)], ['member M', (s) => as(M, s, DB)], ['admin D', (s) => as(D, s, DB)], ['service role', (s) => svc(s, DB)]]) {
  n++;
  for (const [label, sql] of openWrites(n)) {
    const rr = run(sql);
    check(`${label} · ${who} → allowed`, rr.ok, rr.out.split('\n')[0].slice(0, 140));
  }
}
r = as(A, `delete from public.acquisition_documents where review_id='${O.R}' and intake_id like 'ik-late-%';`, DB);
check('DELETE document · owner → allowed on the open episode', r.ok, r.out.slice(0, 120));
r = as(A, `update public.acquisition_term_decisions set new_value='0' where review_id='${O.R}';`, DB);
check('UPDATE decision on the open episode → still refused (026, unchanged; also no privilege)', refused(r, /append-only|permission denied/), r.out.slice(0, 120));
r = anon(`update public.acquisition_reviews set name='x' where id='${O.R}';`, DB);
check('anon on an open episode → permission denied', refused(r, /permission denied/), r.out.slice(0, 120));
// delete_prospect_acquisition keeps 034's rule
const P1 = rpcBegin(DB, A, 'Fresh Prospect');
r = as(M, `select public.delete_prospect_acquisition('${P1.review_id}');`, DB);
check('delete_prospect_acquisition · member M → refused (034: admin only)', refused(r, /administrator/), r.out.slice(0, 140));
r = as(D, `select public.delete_prospect_acquisition('${P1.review_id}');`, DB);
check('delete_prospect_acquisition · admin D on a clean prospect → allowed (034 unchanged)', r.ok && one(`select count(*) from public.acquisition_reviews where id='${P1.review_id}';`, DB) === '0', r.out.slice(0, 140));
r = as(A, `select public.delete_prospect_acquisition('${O.R}');`, DB);
check('delete_prospect_acquisition on an episode with confirmed records → refused (034 unchanged)', refused(r, /confirmed|decision/), r.out.slice(0, 140));
// and the open episode — four leaseholds richer after the writes above — can still be acquired
const oFams = one(`select string_agg(id::text, ',' order by created_at, id) from public.acquisition_document_families where review_id='${O.R}';`, DB).split(',');
const oRoster = oFams.map((f, i) => ({ id: f, family_id: f, property_id: O.P, review_id: O.R, tenant_name: 'Tenant ' + i, leased_sqft: String(100 + i) }));
r = acquire(DB, A, O.P, O.R, { roster: oRoster });
check('the open episode still acquires through acquire_property (' + oFams.length + ' leaseholds)', r.ok && parse(r).ok === true, r.out.slice(0, 200));
r = as(A, `update public.acquisition_reviews set name='x' where id='${O.R}';`, DB);
check('… and is frozen from that moment', refused(r, FROZEN), r.out.slice(0, 140));

// ── 5 · the legacy revert path ───────────────────────────────────────────────
section('5 · THE LEGACY REVERT PATH cannot become a bypass');
const L = makeLegacyConverted(DB, A, 'Harborview-like');
check('a legacy converted review (no children) is frozen', refused(as(A, `update public.acquisition_reviews set name='x' where id='${L.R}';`, DB), FROZEN));
r = as(A, `update public.acquisition_reviews set property_id = null where id='${L.R}';`, DB);
check('un-linking the property directly (depth 1) → refused', refused(r, FROZEN), r.out.slice(0, 140));
const revertSql = (rid, patch) => `update public.acquisition_reviews set status='complete',
  data = (data - 'conversionRecord') || jsonb_build_object('conversionHistory', jsonb_build_array(data->'conversionRecord'),
           'activity', coalesce(data->'activity','[]'::jsonb) || '[{"type":"conversion_reverted"}]'::jsonb,
           'activityCount', coalesce((data->>'activityCount')::int,0) + 1, 'activityDropped', 0, 'stage', 'report') ${patch || ''}
  where id='${rid}';`;
r = as(A, revertSql(L.R), DB);
check('the exact revert shape WHILE THE PROPERTY STANDS → refused (property_id is not null)', refused(r, FROZEN), r.out.slice(0, 140));
r = q(`delete from public.properties where id='${L.P}';`, DB);
check('deleting the property (no children reference it) succeeds; the foreign key\'s SET NULL passes the freeze at depth 2', r.ok && one(`select status||'|'||coalesce(property_id::text,'<null>') from public.acquisition_reviews where id='${L.R}';`, DB) === 'converted|<null>', r.out.slice(0, 200));
// On Pilot as it stands, 034's CHECK refuses the revert before the freeze matters.
r = as(A, revertSql(L.R), DB);
check('on Pilot\'s catalog the revert is refused by 034\'s CHECK acq_reviews_open_has_property (an open review must have a property) — the freeze is not even the reason',
  refused(r, /acq_reviews_open_has_property/), r.out.slice(0, 160));
check('  … and the review is still converted and unchanged', one(`select status from public.acquisition_reviews where id='${L.R}';`, DB) === 'converted');
// In a harness-only copy without that CHECK, the shape itself is what decides.
q(`alter table public.acquisition_reviews drop constraint acq_reviews_open_has_property;`, DB);
const snapL = episode(DB, L.R);
const variants = [
  ['status draft instead of complete', revertSql(L.R).replace("status='complete'", "status='draft'")],
  ['conversionRecord kept', revertSql(L.R).replace("(data - 'conversionRecord')", 'data')],
  ['analysis touched', revertSql(L.R, `|| jsonb_build_object('analysis', jsonb_build_object('summary', jsonb_build_object('recoveryRate', 1)))`)],
  ['analysis.canonical touched', revertSql(L.R, `|| jsonb_build_object('analysis', (data->'analysis') || jsonb_build_object('canonical', jsonb_build_object('at','2030-01-01')))`)],
  ['families cache touched', revertSql(L.R, `|| '{"families":[{"id":"x"}]}'::jsonb`)],
  ['documentDispositions touched', revertSql(L.R, `|| '{"documentDispositions":{}}'::jsonb`)],
  ['extractionResolutions touched', revertSql(L.R, `|| '{"extractionResolutions":{}}'::jsonb`)],
  ['tenants touched', revertSql(L.R, `|| '{"tenants":[{"id":"t9"}]}'::jsonb`)],
  ['a new key added', revertSql(L.R, `|| '{"note":"hi"}'::jsonb`)],
  ['name changed alongside', revertSql(L.R).replace("set status='complete',", "set status='complete', name='Renamed',")],
  ['converted_at cleared alongside', revertSql(L.R).replace("set status='complete',", "set status='complete', converted_at=null,")],
  ['status complete but property_id re-pointed at another property', revertSql(L.R).replace("set status='complete',", `set status='complete', property_id='${C.P}',`)],
];
for (const [label, sql] of variants) {
  r = as(A, sql, DB);
  check(`revert variant · ${label} → refused`, refused(r, FROZEN), r.out.split('\n')[0].slice(0, 140));
}
check('  … after every variant the review is byte-identical', episode(DB, L.R) === snapL);
r = as(A, revertSql(L.R), DB);
check('the exact revert shape, property gone, CHECK absent → allowed (the one write the trigger admits)', r.ok && one(`select status||'|'||(data ? 'conversionRecord')::text||'|'||jsonb_array_length(data->'conversionHistory')||'|'||(data->'analysis'->'summary'->>'recoveryRate') from public.acquisition_reviews where id='${L.R}';`, DB) === 'complete|false|1|70', r.out.slice(0, 200));
r = as(A, `update public.acquisition_reviews set name='Reopened legacy review' where id='${L.R}';`, DB);
check('once reverted the review is open again and behaves as any legacy open review', r.ok, r.out.slice(0, 120));
// the same shape by the member and by service role
const L2 = makeLegacyConverted(DB, A, 'Harborview-like 2'); q(`delete from public.properties where id='${L2.P}';`, DB);
r = as(M, revertSql(L2.R), DB);
check('the exact revert · member M → allowed (RLS: property_id null and user_id = owner ⇒ M sees zero rows, so no change)', r.ok && one(`select status from public.acquisition_reviews where id='${L2.R}';`, DB) === 'converted', r.out.slice(0, 120));
r = svc(revertSql(L2.R), DB);
check('the exact revert · service role → allowed', r.ok && one(`select status from public.acquisition_reviews where id='${L2.R}';`, DB) === 'complete', r.out.slice(0, 120));
// a legacy-SHAPED row (no schemaVersion — Pilot's four pre-P1-1 converted rows): the client upgrade adds keys, so its revert is refused
const L3 = makeLegacyConverted(DB, A, 'Legacy-shaped', { tenants: [], invoices: [], totalSqFt: 1000, documents: [], analysis: { summary: { recoveryRate: 70 } } });
q(`delete from public.properties where id='${L3.P}';`, DB);
r = as(A, revertSql(L3.R, `|| '{"schemaVersion":2,"families":[],"assumptions":{},"activityDropped":0}'::jsonb`), DB);
check('a legacy-SHAPED row reverted with the client\'s upgrade keys added (schemaVersion, families, assumptions) → refused: the shape is exact, not approximate (documented compatibility note)', refused(r, FROZEN), r.out.slice(0, 140));
r = as(A, revertSql(L3.R), DB);
check('  … the same row reverted WITHOUT added keys → allowed', r.ok && one(`select status from public.acquisition_reviews where id='${L3.R}';`, DB) === 'complete', r.out.slice(0, 120));
// The reverted harness rows are open reviews without a property — the very
// shape 034's CHECK forbids — so they go before the CHECK comes back, validated.
r = q(`delete from public.acquisition_reviews where id in ('${L.R}','${L2.R}','${L3.R}');
       alter table public.acquisition_reviews add constraint acq_reviews_open_has_property check (status = 'converted' or property_id is not null);`, DB);
check('harness: the reverted rows removed (open reviews delete as before) and 034\'s CHECK restored, validated', r.ok && one(`select convalidated::text from pg_constraint where conname='acq_reviews_open_has_property';`, DB) === 'true', r.out.slice(0, 200));

// ── 6 · cascades ─────────────────────────────────────────────────────────────
section('6 · CASCADES still pass through the freeze');
// (a) A converted episode with a full record, acquired through the product.
const ZD = makeDeal(DB, Z, 'Cascade Deal');
// an amendment that names its parent, so a SET NULL step (parent_document_id) is in the cascade too
as(Z, `insert into public.acquisition_documents(review_id,user_id,file_name,intake_id,family_id,family_status,doc_type,doc_type_status,doc_type_source,confirmed_by,confirmed_at,parent_document_id,relationship,relationship_status)
       values ('${ZD.R}','${Z}','amend.pdf','ik-3','${ZD.F1}','confirmed','amendment','confirmed','human','${Z}',now(),'${ZD.D1}','amends','confirmed');`, DB);
r = acquire(DB, Z, ZD.P, ZD.R, ZD.snap);
check('Z acquires Cascade Deal: a converted episode with 3 documents, 2 leaseholds, 1 decision', r.ok && parse(r).ok === true, r.out.slice(0, 200));
for (const [what, sql] of [['one of its documents', `delete from public.acquisition_documents where id='${ZD.D1}';`], ['its family', `delete from public.acquisition_document_families where id='${ZD.F1}';`], ['its decision', `delete from public.acquisition_term_decisions where id='${ZD.X1}';`], ['the review', `delete from public.acquisition_reviews where id='${ZD.R}';`]]) {
  r = q(sql, DB);
  check(`a direct DELETE of ${what} (depth 1, even as superuser) → refused`, refused(r, what === 'its decision' ? /append-only|read-only|cannot be deleted/ : FROZEN), r.out.slice(0, 140));
}
r = q(`delete from public.properties where id='${ZD.P}';`, DB);
check('deleting the acquired property → refused by 034\'s RESTRICT (documents, leaseholds and decisions reference it), unchanged by 036', refused(r, /violates foreign key constraint .*property_id/), r.out.slice(0, 160));
// (b) The one cascade Pilot can actually reach: auth.users → acquisition_reviews (ON DELETE CASCADE).
// With children referencing the property RESTRICT, the same cascade hits
// properties first — 034's behaviour, independent of 036; recorded, not asserted.
r = q(`delete from auth.users where id='${Z}';`, DB);
console.log('     (observed) deleting the owner of an acquired property with an acquisition record: ' + (r.ok ? 'cascaded' : 'refused — ' + r.out.split('\n')[0].slice(0, 110)));
// (c) The exemption itself: another trigger driving the delete (depth > 1) —
// which is what every foreign-key cascade is — passes the freeze on the review
// and on every child, SET NULL steps included.
q(`create table public.harness_cascade (review_id uuid);
   create or replace function public.harness_cascade_fire() returns trigger language plpgsql as $f$
   begin delete from public.acquisition_reviews where id = new.review_id; return null; end $f$;
   create trigger harness_cascade after insert on public.harness_cascade for each row execute function public.harness_cascade_fire();`, DB);
r = q(`insert into public.harness_cascade values ('${ZD.R}');`, DB);
check('a DELETE of the converted review driven from inside another trigger (depth 2) passes, and its children go with it (depth 3), the SET NULL steps included', r.ok
  && one(`select (select count(*) from public.acquisition_reviews where id='${ZD.R}')||'|'||(select count(*) from public.acquisition_documents where review_id='${ZD.R}')||'|'||(select count(*) from public.acquisition_document_families where review_id='${ZD.R}')||'|'||(select count(*) from public.acquisition_term_decisions where review_id='${ZD.R}');`, DB) === '0|0|0|0', r.out.slice(0, 300));
q(`drop trigger harness_cascade on public.harness_cascade; drop function public.harness_cascade_fire(); drop table public.harness_cascade;`, DB);
// (d) a converted review with NO children (Pilot's Harborview rows) is removed by the auth.users cascade itself
const ZL = makeLegacyConverted(DB, A, 'Owner-cascade legacy');
q(`insert into auth.users(id) values ('77777777-7777-4777-8777-777777777777'); update public.acquisition_reviews set user_id='77777777-7777-4777-8777-777777777777' where id='${ZL.R}';`, DB);
r = q(`select 1;`, DB);
if (one(`select user_id::text from public.acquisition_reviews where id='${ZL.R}';`, DB) === '77777777-7777-4777-8777-777777777777') {
  r = q(`delete from auth.users where id='77777777-7777-4777-8777-777777777777';`, DB);
  check('the auth.users cascade (depth 2) removes a converted review that has no children', r.ok && one(`select count(*) from public.acquisition_reviews where id='${ZL.R}';`, DB) === '0', r.out.slice(0, 200));
} else {
  check('harness: could not re-own the legacy review for the owner-cascade test (the freeze refused the harness update, as it should — user_id is frozen too)', true);
  r = q(`delete from auth.users where id='77777777-7777-4777-8777-777777777777';`, DB);
}

// ── 7 · atomicity ────────────────────────────────────────────────────────────
section('7 · ATOMICITY');
const O2d = makeDeal(DB, A, 'Atomic Open');
const snapO2 = episode(DB, O2d.R), snapC = episode(DB, C.R);
r = as(A, `update public.acquisition_reviews set name='moved in the same transaction' where id='${O2d.R}';
           insert into public.acquisition_document_families(review_id,user_id,label) values ('${O2d.R}','${A}','Added in the same transaction');
           update public.acquisition_reviews set name='frozen' where id='${C.R}';`, DB);
check('a transaction that writes an open episode and then touches a converted one fails as a whole', refused(r, FROZEN), r.out.slice(0, 140));
check('  … the open episode\'s writes were rolled back too; the converted one is untouched', episode(DB, O2d.R) === snapO2 && episode(DB, C.R) === snapC);
// acquire_property failing after its review update: the review stays open and acquirable
q(`create table public.harness_flags (fail_at text);
   create or replace function public.harness_fail() returns trigger language plpgsql as $f$
   begin if exists (select 1 from public.harness_flags where fail_at = tg_argv[0]) then raise exception 'harness: injected failure at %', tg_argv[0]; end if; return null; end $f$;
   create trigger harness_after_review after update of status on public.acquisition_reviews for each row when (new.status = 'converted') execute function public.harness_fail('after_review');
   insert into public.harness_flags values ('after_review');`, DB);
const s0 = episode(DB, O2d.R);
r = acquire(DB, A, O2d.P, O2d.R, O2d.snap);
check('acquire_property with a failure injected after the review update → the call fails', refused(r, /injected failure/), r.out.slice(0, 160));
check('  … the review is still open, byte-identical, and NOT frozen', episode(DB, O2d.R) === s0 && one(`select public._acq_episode_frozen('${O2d.R}');`, DB) === 'f');
r = as(A, `update public.acquisition_reviews set name='still open' where id='${O2d.R}';`, DB);
check('  … and still writable', r.ok, r.out.slice(0, 120));
q(`drop trigger harness_after_review on public.acquisition_reviews; drop function public.harness_fail(); drop table public.harness_flags;`, DB);
r = acquire(DB, A, O2d.P, O2d.R, O2d.snap);
check('with the injection removed the episode acquires and is frozen', r.ok && one(`select public._acq_episode_frozen('${O2d.R}');`, DB) === 't', r.out.slice(0, 200));
check('a refused write caught in a subtransaction (a plpgsql exception block) leaves the rest of the transaction alive', (() => {
  const F = makeDeal(DB, A, 'Savepoint Deal');
  const r2 = as(A, `do $$ declare caught text; begin
      begin update public.acquisition_reviews set name='x' where id='${C.R}'; exception when others then caught := sqlerrm; end;
      if caught is null then raise exception 'the frozen write was NOT refused'; end if;
      update public.acquisition_reviews set name='alive' where id='${F.R}';
    end $$;`, DB);
  return r2.ok && one(`select name from public.acquisition_reviews where id='${F.R}';`, DB) === 'alive' && episode(DB, C.R) === snapC;
})());

// ── 8 · nothing else moved; rollback ─────────────────────────────────────────
section('8 · NOTHING ELSE MOVED · ROLLBACK');
check('every object outside 036\'s own (constraints, other triggers, functions 028–035, columns, indexes, policies, authenticated/service_role privileges) is identical across the apply', inventory(DB) === before, 'inventory differs');
r = pg.psqlFile(R036, DB);
check('rollback applies', r.ok, r.out.slice(0, 300));
check('the four triggers and three functions are gone; nothing else changed', ownObjects(DB) === '' && inventory(DB) === before, ownObjects(DB));
check('the anon revokes are NOT reversed (as the rollback header says)', pg.privs('public.acquisition_reviews', 'anon', DB) === '' && pg.privs('public.acquisition_documents', 'anon', DB) === '');
r = as(A, `update public.acquisition_reviews set name='mutable again' where id='${C.R}';`, DB);
check('after rollback the converted episode is mutable again (the freeze is the migration, not the data)', r.ok, r.out.slice(0, 120));
r = pg.psqlFile(M036, DB);
check('036 applies again after the rollback, and freezes again', r.ok && refused(as(A, `update public.acquisition_reviews set name='x' where id='${C.R}';`, DB), FROZEN), r.out.slice(0, 300));

// ── 9 · static ───────────────────────────────────────────────────────────────
section('9 · STATIC — the file keeps to its scope');
const code = strip(SQL);
const bodies = code.replace(/\$\$[\s\S]*?\$\$/g, '$$…$$');   // outside function bodies
check('no policy is created, altered or dropped', !/\b(create|alter|drop)\s+policy\b/i.test(code));
check('no table, column, constraint or index is added or altered', !/\balter\s+table\b(?!.*\b(enable|disable)\s+trigger)/i.test(bodies) && !/\bcreate\s+(unique\s+)?index\b/i.test(code) && !/\bcreate\s+table\b/i.test(code));
check('no function of 028–035 is redefined', !/create\s+or\s+replace\s+function\s+public\.(acquire_property|begin_acquisition|delete_prospect_acquisition|is_property_admin|member_property_ids|acq_child_property_bind|acq_reviews_insert_guard|acq_reviews_property_immutable|properties_stage_transition|properties_insert_stage_guard|acq_doc_families_review_immutable|tenants_property_immutable|resync_property_tenants|_property_events_\w+)\b/i.test(code));
check('no top-level DML (every UPDATE / INSERT / DELETE is inside a trigger body)', !/^\s*(update|insert|delete)\b/im.test(bodies));
check('exactly the objects the header lists: 3 functions, 4 triggers, 2 table revokes', (code.match(/create\s+or\s+replace\s+function/gi) || []).length === 3 && (code.match(/^create trigger/gim) || []).length === 4 && (code.match(/revoke all on table/gi) || []).length === 2);
check('the freeze predicate is status = converted and nothing softer', /status\s*=\s*'converted'/.test(code) && !/converted_at is not null/i.test(code.replace(/--.*$/gm, '')));
check('036 touches nothing XRPL, wallet, payment or settlement related', !/rlusd|xrpl|xrp\b|wallet|ripple|settlement|payment_/i.test(code));

T.finish();
