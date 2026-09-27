'use strict';
/**
 * tools/verify-migration-034.js — run 034 (P3: property at New Acquisition)
 * for real, against nothing that matters.
 *
 *   node tools/verify-migration-034.js
 *
 * It touches NO Supabase project. It builds a throwaway PostgreSQL cluster,
 * stands up STAND-INS for the tables 034 touches with the columns, CHECKs,
 * keys, triggers, functions and row policies read from Pilot's live catalog
 * (organisations and memberships included), installs 032 and 033 from their
 * files, loads a fixture reproducing Pilot's ELEVEN acquisition reviews under
 * their real ids, and then applies 034.
 *
 * WHAT IT PROVES
 *
 *   1  BASELINE — before 034 a review can be inserted with no property, a
 *      prospect can be inserted by anyone, and a document has no property
 *   2  034 applies, and applies again
 *   3  BACKFILL — the eleven reviews land exactly as the migration header
 *      says: 2 linked, 1 status-corrected and linked (Harborview), 7 new
 *      prospects owned by their review's owner, 1 converted orphan left null;
 *      every child carries its review's property; NOT NULL holds; no
 *      duplicate open Harborview exists
 *   4  begin_acquisition — creates property + episode atomically, returns
 *      both ids, refuses anon, blank name, non-object data, a foreign
 *      organisation and a read_only membership; a failure of the second
 *      insert leaves no property behind
 *   5  GUARDS — a prospect or an episode cannot be inserted outside the RPC;
 *      an episode cannot open on an acquired, passed or archived property;
 *      one open episode per property; an episode's property is immutable but
 *      ON DELETE SET NULL still works; a child inherits its review's property
 *      and refuses any other; a property with children cannot be deleted
 *      (RESTRICT); an open episode blocks its property's deletion (CHECK)
 *   6  RLS — owner, admin member, property_manager, read_only, stranger and
 *      anon on all four tables; a child cannot be attached across organisations
 *   7  delete_prospect_acquisition — the vocabulary of "confirmed" is the one
 *      024's CHECKs define; allowed only for a childless-of-confirmations
 *      prospect with exactly this episode; every refusal named
 *   8  NOTHING ELSE MOVED — every object outside 034's list is identical
 *   9  ROLLBACK restores owner-only access, drops the columns, undoes the
 *      backfill, and 034 applies again
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
const R034 = path.join(MIG, '034_property_at_new_acquisition_rollback.sql');

const T = tally();
const { check, section } = T;
const SQL = fs.readFileSync(M034, 'utf8');
const strip = (s) => s.replace(/^\s*--.*$/gm, '');

console.log('\n══ migration 034 — executed against a throwaway cluster ══');
console.log('   NO Supabase project is contacted by this script.');
const pg = startCluster('034');
console.log('   postgres: ' + pg.PGBIN);

// ── people and organisations ─────────────────────────────────────────────────
const A = '11111111-1111-4111-8111-111111111111';   // owner, admin of O1
const M = '33333333-3333-4333-8333-333333333333';   // property_manager in O1
const R = '44444444-4444-4444-8444-444444444444';   // read_only in O1
const S = '22222222-2222-4222-8222-222222222222';   // stranger, admin of O2
const O1 = 'c1c1c1c1-0000-4000-8000-000000000001', O2 = 'c2c2c2c2-0000-4000-8000-000000000002';

// Pilot's eleven reviews, by their real ids, owners and recorded properties.
const U_479 = '479b339e-9193-4b4d-bcf9-d3aa686a7c37', U_05c = '05c35898-a4e8-4943-9ad5-bc54b4cb0690',
      U_97d = '97d24250-9394-49ea-aafd-ad420ecbf20e', U_c4b = 'c4bbdb18-3219-46ff-859c-73ec84699332',
      U_46e = '46e82be2-381d-469f-8b9e-43b2f4f437ec', U_011 = '011df998-bad2-464e-bbcb-28e2d0fee821',
      U_d66 = 'd66ee6a3-ccf5-4198-a27e-59c4b068b15d', U_834 = '8347569a-6df4-470c-a5a9-c4207bba4e17';
const P_c4b = '5c67a03c-81c2-4a42-bb20-496b486534ae', P_46e = '15436ba9-5827-4867-a4db-25a1409828a0',
      P_HARBOR = '286622d5-0c8f-4dfd-b242-b75bdaa49e1e', P_GONE = 'ed839767-32c6-4d90-8fe6-0f78f19dea8d';
const RV = {
  orphan:  'aca00000-0000-4000-b000-479b339e9193',
  open05c: 'aca00000-0000-4000-b000-05c35898a4e8',
  open97d: 'aca00000-0000-4000-b000-97d242509394',
  convC4b: 'aca00000-0000-4000-b000-c4bbdb183219',
  conv46e: 'aca00000-0000-4000-b000-46e82be2381d',
  harbor:  'aca00000-0000-4000-b000-011df998bad2',
  opend66: 'aca00000-0000-4000-b000-d66ee6a3ccf5',
  miracle: 'b7aab0b8-5458-4f5a-a482-5dfc644101dc',
  maple:   '59af3e99-82dc-4a97-813b-21e4f956aca8',
  lakeview:'2457445b-3696-405b-b946-44ba14757ef9',
  lakev2:  'a9be308c-bbac-4cb2-978e-459138f72586',
};
const FAM1 = 'ffffffff-0000-4000-8000-00000000000a', FAM2 = 'ffffffff-0000-4000-8000-00000000000b';
const DOC_CONF = '99999999-0000-4000-8000-00000000000a', DOC_PROP = '99999999-0000-4000-8000-00000000000b';

const SCHEMA = `
  insert into auth.users(id) values ('${A}'),('${M}'),('${R}'),('${S}'),
    ('${U_479}'),('${U_05c}'),('${U_97d}'),('${U_c4b}'),('${U_46e}'),('${U_011}'),('${U_d66}'),('${U_834}');
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
  create table public.tenants (id uuid primary key default gen_random_uuid(), property_id uuid references public.properties(id) on delete cascade, name text, sqft numeric, cap numeric, start_date date, end_date date, lease_url text, lease_type text, constraint tenants_id_property_uniq unique (id, property_id));
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
        raise exception 'acquisition_term_decisions is append-only: DELETE is refused. The history of a decision is not editable.' using errcode = 'restrict_violation';
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
  alter table public.acquisition_reviews enable row level security;
  alter table public.acquisition_documents enable row level security;
  alter table public.acquisition_document_families enable row level security;
  alter table public.acquisition_term_decisions enable row level security;
  create policy properties_owner_all on public.properties for all to authenticated
    using ((user_id = auth.uid()) or (organization_id is not null and public.is_active_member_of_org(organization_id)))
    with check ((user_id = auth.uid()) or (organization_id is not null and public.is_active_member_of_org(organization_id)));
  create policy tenants_owner_all on public.tenants for all to authenticated using (property_id in (select public.member_property_ids())) with check (property_id in (select public.member_property_ids()));
  create policy acq_reviews_owner_all on public.acquisition_reviews for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
  create policy acq_docs_owner_all on public.acquisition_documents for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
  create policy acq_doc_families_owner_all on public.acquisition_document_families for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
  create policy acq_term_decisions_owner_all on public.acquisition_term_decisions for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
  grant all on all tables in schema public to authenticated;`;

// Pilot's eleven reviews and the three properties their records name.
const FIXTURE = `
  insert into public.properties(id,user_id,name,lifecycle_stage) values
    ('${P_c4b}','${U_c4b}','Harborview Retail Center','acquired'),
    ('${P_46e}','${U_46e}','Harborview Retail Center','acquired'),
    ('${P_HARBOR}','${U_011}','Harborview Retail Center','acquired');
  insert into public.acquisition_reviews(id,user_id,name,status,data,created_at) values
    ('${RV.orphan}','${U_479}','Harborview Retail Center','converted', jsonb_build_object('_demoAcq',true,'totalSqFt',32000,'conversionRecord',jsonb_build_object('propertyId','${P_GONE}','convertedAt','2026-07-25T00:33:22.709Z')), '2026-07-18'),
    ('${RV.open05c}','${U_05c}','Harborview Retail Center','complete', jsonb_build_object('_demoAcq',true,'totalSqFt',32000), '2026-07-21'),
    ('${RV.open97d}','${U_97d}','Harborview Retail Center','complete', jsonb_build_object('_demoAcq',true,'totalSqFt',32000), '2026-07-21'),
    ('${RV.convC4b}','${U_c4b}','Harborview Retail Center','converted', jsonb_build_object('_demoAcq',true,'totalSqFt',32000,'conversionRecord',jsonb_build_object('propertyId','${P_c4b}','convertedAt','2026-07-26T18:46:29.707Z')), '2026-07-21'),
    ('${RV.conv46e}','${U_46e}','Harborview Retail Center','converted', jsonb_build_object('_demoAcq',true,'totalSqFt',32000,'conversionRecord',jsonb_build_object('propertyId','${P_46e}','convertedAt','2026-09-16T19:08:33.742Z')), '2026-09-08'),
    ('${RV.harbor}','${U_011}','Harborview Retail Center','complete', jsonb_build_object('_demoAcq',true,'totalSqFt',32000,'conversionRecord',jsonb_build_object('propertyId','${P_HARBOR}','propertyName','Harborview Retail Center','convertedAt','2026-09-16T20:30:23.332Z')), '2026-09-11'),
    ('${RV.opend66}','${U_d66}','Harborview Retail Center','complete', jsonb_build_object('_demoAcq',true,'totalSqFt',32000), '2026-09-15'),
    ('${RV.miracle}','${U_834}','Miracle Mile','draft', jsonb_build_object('totalSqFt',303222), '2026-09-16'),
    ('${RV.maple}','${U_011}','Maple plaza','complete', jsonb_build_object('totalSqFt',77500), '2026-09-17'),
    ('${RV.lakeview}','${U_011}','Lakeview','draft', jsonb_build_object('totalSqFt',0), '2026-09-21'),
    ('${RV.lakev2}','${U_011}','lake view','draft', '{}'::jsonb, '2026-09-22');
  insert into public.acquisition_document_families(id,review_id,user_id,label) values ('${FAM1}','${RV.maple}','${U_011}','Maple fam 1'),('${FAM2}','${RV.maple}','${U_011}','Maple fam 2');
  insert into public.acquisition_documents(id,review_id,user_id,file_name,intake_id,family_id,family_status,doc_type,doc_type_status,doc_type_source,confirmed_by,confirmed_at) values
    ('${DOC_CONF}','${RV.maple}','${U_011}','lease.pdf','ik-1','${FAM1}','confirmed','original_lease','confirmed','human','${U_011}',now()),
    ('${DOC_PROP}','${RV.maple}','${U_011}','amend.pdf','ik-2','${FAM2}','proposed','amendment','proposed','ai',null,null);
  insert into public.acquisition_documents(review_id,user_id,file_name,intake_id) values ('${RV.maple}','${U_011}','unknown.pdf','ik-3');
  insert into public.acquisition_term_decisions(review_id,user_id,family_id,field_key,action,decided_by) values ('${RV.maple}','${U_011}','${FAM1}','base_rent','confirm','${U_011}'),('${RV.maple}','${U_011}','${FAM1}','term_end','confirm','${U_011}');`;

const q = (sql, db) => pg.psql(sql, db);
const as = (uid, sql, db) => pg.as('authenticated', uid, sql, db);
const refused = (r, re) => !r.ok && (re ? re.test(r.out) : true);
const one = (sql, db) => q(sql, db).out;
const parse = (r) => { try { return JSON.parse(r.out); } catch (_) { return { _raw: r.out }; } };
const rpcBegin = (db, uid, name, extra) => as(uid, `select public.begin_acquisition('${name}', '${JSON.stringify(Object.assign({ totalSqFt: '1000' }, extra || {})).replace(/'/g, "''")}'::jsonb${extra && extra._org ? `, '${extra._org}'::uuid` : ''}${extra && extra._rid ? `${extra && extra._org ? '' : ', null'}, '${extra._rid}'::uuid` : ''});`, db);
const inventory = (db) => q(`
  select string_agg(x, E'\\n' order by x) from (
    select 'con|'||conrelid::regclass::text||'|'||conname||'|'||pg_get_constraintdef(oid) as x from pg_constraint where connamespace='public'::regnamespace
      and conname not in ('acq_reviews_open_has_property','acq_doc_families_id_property_key') and conname not like '%_property_id_fkey'
    union all select 'trg|'||t.tgrelid::regclass::text||'|'||t.tgname from pg_trigger t join pg_class c on c.oid=t.tgrelid where not t.tgisinternal
      and t.tgname not in ('properties_insert_stage_guard','acq_reviews_insert_guard','acq_reviews_property_immutable','acq_docs_property_bind','acq_doc_families_property_bind','acq_term_decisions_property_bind')
    union all select 'fn|'||p.proname||'|'||md5(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f'
      and p.proname not in ('is_property_admin','begin_acquisition','delete_prospect_acquisition','properties_insert_stage_guard','acq_reviews_insert_guard','acq_reviews_property_immutable','acq_child_property_bind')
    union all select 'col|'||table_name||'|'||column_name||'|'||data_type||'|'||is_nullable from information_schema.columns where table_schema='public' and column_name <> 'property_id'
    union all select 'pol|'||tablename||'|'||policyname||'|'||coalesce(qual,'') from pg_policies where schemaname='public' and tablename not in ('acquisition_reviews','acquisition_documents','acquisition_document_families','acquisition_term_decisions')
  ) s;`, db).out;

// ── build ────────────────────────────────────────────────────────────────────
const DB = 'pilotlike';
let r = pg.database(DB, 'legacy');
check('pilotlike: database built under Pilot\'s legacy default privileges', r.ok, r.ok ? '' : r.out.slice(0, 300));
r = q(SCHEMA, DB);
check('pilotlike: stand-ins with Pilot\'s constraints, triggers, functions, organisations and policies', r.ok, r.ok ? '' : r.out.slice(0, 500));
r = pg.psqlFile(M032, DB); check('pilotlike: 032 installed from its file', r.ok, r.ok ? '' : r.out.slice(0, 300));
r = pg.psqlFile(M033, DB); check('pilotlike: 033 installed from its file', r.ok, r.ok ? '' : r.out.slice(0, 300));
r = q(FIXTURE, DB);
check('pilotlike: Pilot\'s eleven reviews loaded under their real ids, with the Maple plaza children', r.ok && one(`select count(*) from public.acquisition_reviews;`, DB) === '11', r.out.slice(0, 300));
const before = inventory(DB);

// ── 1 · baseline ─────────────────────────────────────────────────────────────
section('1 · baseline — before 034');
r = as(A, `insert into public.acquisition_reviews(user_id,name) values ('${A}','no property');`, DB);
check('a review can be inserted with no property', r.ok, r.out);
r = as(A, `insert into public.properties(user_id,name,lifecycle_stage) values ('${A}','p','prospect');`, DB);
check('a prospect can be inserted by any owner', r.ok, r.out);
check('a document has no property_id column', one(`select count(*) from information_schema.columns where table_name='acquisition_documents' and column_name='property_id';`, DB) === '0');
q(`delete from public.acquisition_reviews where name='no property'; delete from public.properties where name='p';`, DB);

// ── 2 · apply ────────────────────────────────────────────────────────────────
section('2 · 034 applies, and applies again');
r = pg.psqlFile(M034, DB);
check('pilotlike: 034 applies', r.ok, r.ok ? '' : r.out.slice(0, 600));
r = pg.psqlFile(M034, DB);
check('pilotlike: 034 applies a second time without error and without a second backfill', r.ok && one(`select count(*) from public.properties where data ? '_p3Backfill';`, DB) === '7', r.ok ? one(`select count(*) from public.properties where data ? '_p3Backfill';`, DB) + ' backfill prospects' : r.out.slice(0, 400));

// ── 3 · backfill ─────────────────────────────────────────────────────────────
section('3 · BACKFILL — the eleven reviews, row by row');
const link = (id) => one(`select coalesce(property_id::text,'null')||'|'||status||'|'||coalesce(converted_at::text,'null') from public.acquisition_reviews where id='${id}';`, DB);
check('convC4b linked to its recorded property, status kept, converted_at from the record', link(RV.convC4b) === `${P_c4b}|converted|2026-07-26 18:46:29.707+00`, link(RV.convC4b));
check('conv46e linked likewise', link(RV.conv46e) === `${P_46e}|converted|2026-09-16 19:08:33.742+00`, link(RV.conv46e));
check('HARBORVIEW: status corrected to converted, linked to 286622d5…, converted_at 2026-09-16T20:30:23.332Z', link(RV.harbor) === `${P_HARBOR}|converted|2026-09-16 20:30:23.332+00`, link(RV.harbor));
check('HARBORVIEW: conversionRecord untouched', one(`select data->'conversionRecord'->>'convertedAt' from public.acquisition_reviews where id='${RV.harbor}';`, DB) === '2026-09-16T20:30:23.332Z');
check('HARBORVIEW: no property was created for it', one(`select count(*) from public.properties where data->>'_p3ReviewId' = '${RV.harbor}';`, DB) === '0');
check('orphan converted review keeps property_id null', link(RV.orphan) === 'null|converted|null', link(RV.orphan));
for (const [k, uid, name, sqft] of [['open05c', U_05c, 'Harborview Retail Center', '32000'], ['open97d', U_97d, 'Harborview Retail Center', '32000'], ['opend66', U_d66, 'Harborview Retail Center', '32000'],
                                    ['miracle', U_834, 'Miracle Mile', '303222'], ['maple', U_011, 'Maple plaza', '77500'], ['lakeview', U_011, 'Lakeview', '0'], ['lakev2', U_011, 'lake view', '0']]) {
  const row = one(`select p.user_id::text||'|'||p.name||'|'||p.sqft||'|'||p.lifecycle_stage||'|'||(p.data ? '_p3Backfill')::text||'|'||(p.organization_id is not null)::text from public.acquisition_reviews ar join public.properties p on p.id = ar.property_id where ar.id='${RV[k]}';`, DB);
  check(`${k}: new prospect owned by the review's owner, named after it, sqft ${sqft}, marked, in an organisation`, row === `${uid}|${name}|${sqft}|prospect|true|true`, row);
}
check('exactly seven prospects were created', one(`select count(*) from public.properties where lifecycle_stage='prospect';`, DB) === '7');
check('every open review has a property (CHECK validated)', one(`select count(*) from public.acquisition_reviews where status<>'converted' and property_id is null;`, DB) === '0' && one(`select convalidated from pg_constraint where conname='acq_reviews_open_has_property';`, DB) === 't');
check('every child carries its review\'s property, and the columns are NOT NULL', one(`select (select count(*) from public.acquisition_documents d join public.acquisition_reviews ar on ar.id=d.review_id where d.property_id is distinct from ar.property_id) + (select count(*) from public.acquisition_document_families f join public.acquisition_reviews ar on ar.id=f.review_id where f.property_id is distinct from ar.property_id) + (select count(*) from public.acquisition_term_decisions x join public.acquisition_reviews ar on ar.id=x.review_id where x.property_id is distinct from ar.property_id);`, DB) === '0'
  && one(`select string_agg(is_nullable, ',' order by table_name) from information_schema.columns where column_name='property_id' and table_name in ('acquisition_documents','acquisition_document_families','acquisition_term_decisions');`, DB) === 'NO,NO,NO');
check('no duplicate OPEN Harborview acquisition: each open Harborview review has its own prospect', one(`select count(distinct property_id)||'/'||count(*) from public.acquisition_reviews where name='Harborview Retail Center' and status in ('draft','analyzing','complete');`, DB) === '3/3');
check('the append-only decision trigger is re-armed after the backfill', one(`select tgenabled from pg_trigger where tgname='trg_acq_term_decisions_no_update';`, DB) === 'O');
r = q(`update public.acquisition_term_decisions set field_key='x' where review_id='${RV.maple}';`, DB);
check('and decisions still refuse UPDATE', refused(r, /append-only/), r.out.slice(0, 120));

// ── 4 · begin_acquisition ────────────────────────────────────────────────────
section('4 · begin_acquisition — one transaction, both ids');
const propsBefore = one(`select count(*) from public.properties;`, DB);
let x = parse(rpcBegin(DB, A, 'Deal One'));
check('owner A starts a deal: property + episode created, ids returned', x.property_id && x.review_id && x.lifecycle_stage === 'prospect' && x.status === 'draft', JSON.stringify(x));
const DEAL_P = x.property_id, DEAL_R = x.review_id;
check('the property is a prospect in A\'s organisation with sqft from p_data and stamps', one(`select lifecycle_stage||'|'||organization_id::text||'|'||sqft||'|'||(stage_changed_by='${A}')::text from public.properties where id='${DEAL_P}';`, DB) === `prospect|${O1}|1000|true`);
check('the episode points at it, status draft, owned by A', one(`select property_id::text||'|'||status||'|'||user_id::text from public.acquisition_reviews where id='${DEAL_R}';`, DB) === `${DEAL_P}|draft|${A}`);
x = parse(rpcBegin(DB, M, 'Manager Deal', { _org: O1 }));
check('property_manager M starts a deal in O1 by naming it', x.property_id && one(`select organization_id::text from public.properties where id='${x.property_id}';`, DB) === O1, JSON.stringify(x));
r = rpcBegin(DB, R, 'Read-only Deal', { _org: O1 });
check('read_only R naming O1 is refused', refused(r, /read-only|not an active member/), r.out.slice(0, 160));
r = rpcBegin(DB, S, 'Foreign', { _org: O1 });
check('stranger S naming O1 is refused', refused(r, /not an active member/), r.out.slice(0, 160));
r = pg.as('anon', null, `select public.begin_acquisition('Anon deal');`, DB);
check('anon is refused', refused(r), r.out.slice(0, 120));
r = as(A, `select public.begin_acquisition('   ');`, DB);
check('a blank name is refused', refused(r, /needs a name/), r.out.slice(0, 120));
r = as(A, `select public.begin_acquisition('x', '[1,2]'::jsonb);`, DB);
check('non-object data is refused', refused(r, /JSON object/), r.out.slice(0, 120));
const propsMid = one(`select count(*) from public.properties;`, DB);
r = rpcBegin(DB, A, 'Collides', { _rid: DEAL_R });
check('a second insert that fails (duplicate review id) leaves NO property behind — atomic', refused(r, /duplicate key|unique/) && one(`select count(*) from public.properties;`, DB) === propsMid, r.out.slice(0, 120));
check('the reserved setting is not left on after the call', as(A, `insert into public.properties(user_id,name,lifecycle_stage) values ('${A}','late prospect','prospect');`, DB).ok === false);

// ── 5 · guards ───────────────────────────────────────────────────────────────
section('5 · GUARDS — prospects and episodes are born only inside begin_acquisition');
r = as(A, `insert into public.properties(user_id,name,lifecycle_stage) values ('${A}','p','prospect');`, DB);
check('a direct prospect insert is refused', refused(r, /only by begin_acquisition/), r.out.slice(0, 120));
r = as(A, `insert into public.properties(user_id,name) values ('${A}','owned building');`, DB);
check('the direct add of an owned building (acquired) still works', r.ok, r.out);
const OWNED = one(`select id from public.properties where name='owned building';`, DB);
r = as(A, `insert into public.properties(user_id,name,lifecycle_stage) values ('${A}','p','passed');`, DB);
check('a property is not born passed', refused(r, /not created as passed/), r.out.slice(0, 120));
r = as(A, `insert into public.acquisition_reviews(user_id,name) values ('${A}','no property');`, DB);
check('an episode without a property is refused', refused(r, /belongs to a property/), r.out.slice(0, 120));
r = as(A, `insert into public.acquisition_reviews(user_id,name,property_id) values ('${A}','direct','${DEAL_P}');`, DB);
check('an episode inserted outside the RPC is refused', refused(r, /only by begin_acquisition/), r.out.slice(0, 120));
r = q(`select set_config('mainstreet.begin_acquisition','on',true); insert into public.acquisition_reviews(user_id,name,property_id) values ('${A}','on acquired','${OWNED}');`, DB);
check('an episode cannot open on an acquired property', refused(r, /opens only on a prospect/), r.out.slice(0, 120));
q(`update public.properties set archived_at=now() where id='${DEAL_P}';`, DB);
r = q(`select set_config('mainstreet.begin_acquisition','on',true); insert into public.acquisition_reviews(user_id,name,property_id) values ('${A}','on archived','${DEAL_P}');`, DB);
check('an episode cannot open on an archived prospect', refused(r, /archived|one open/), r.out.slice(0, 120));
q(`update public.properties set archived_at=null where id='${DEAL_P}';`, DB);
r = q(`select set_config('mainstreet.begin_acquisition','on',true); insert into public.acquisition_reviews(user_id,name,property_id) values ('${A}','second open','${DEAL_P}');`, DB);
check('a second OPEN episode on the same property is refused (one open episode)', refused(r, /acq_reviews_one_open_per_property|duplicate key/), r.out.slice(0, 120));
r = as(A, `update public.acquisition_reviews set property_id='${OWNED}' where id='${DEAL_R}';`, DB);
check('an episode\'s property cannot be changed to another property', refused(r, /immutable/), r.out.slice(0, 120));
// children
r = as(A, `insert into public.acquisition_documents(review_id,user_id,file_name,intake_id) values ('${DEAL_R}','${A}','a.pdf','ik-a');`, DB);
check('a document inserted without property_id inherits its review\'s property', r.ok && one(`select property_id::text from public.acquisition_documents where intake_id='ik-a';`, DB) === DEAL_P, r.out);
r = as(A, `insert into public.acquisition_documents(review_id,user_id,file_name,intake_id,property_id) values ('${DEAL_R}','${A}','b.pdf','ik-b','${OWNED}');`, DB);
check('a document naming a property other than its review\'s is refused', refused(r, /cannot be attached to property/), r.out.slice(0, 160));
r = as(A, `update public.acquisition_documents set property_id='${OWNED}' where intake_id='ik-a';`, DB);
check('a document\'s property is immutable', refused(r, /immutable/), r.out.slice(0, 120));
r = as(A, `insert into public.acquisition_document_families(review_id,user_id,label) values ('${DEAL_R}','${A}','Fam');`, DB);
check('a family inherits its review\'s property', r.ok && one(`select property_id::text from public.acquisition_document_families where label='Fam' and review_id='${DEAL_R}';`, DB) === DEAL_P, r.out);
r = as(A, `insert into public.acquisition_term_decisions(review_id,user_id,field_key,action,decided_by) values ('${DEAL_R}','${A}','rent','confirm','${A}');`, DB);
check('a decision inherits its review\'s property', r.ok && one(`select property_id::text from public.acquisition_term_decisions where review_id='${DEAL_R}';`, DB) === DEAL_P, r.out);
r = q(`delete from public.properties where id='${DEAL_P}';`, DB);
check('a property with acquisition children cannot be deleted (RESTRICT / open-episode CHECK)', refused(r), r.out.slice(0, 140));
r = q(`delete from public.acquisition_reviews where id='${DEAL_R}';`, DB);
check('but deleting the episode is refused while it has decisions? — no: append-only allows the cascade once the review is gone', r.ok, r.out.slice(0, 160));
check('and its documents, family and decision cascaded through the review key', one(`select (select count(*) from public.acquisition_documents where review_id='${DEAL_R}')+(select count(*) from public.acquisition_document_families where review_id='${DEAL_R}')+(select count(*) from public.acquisition_term_decisions where review_id='${DEAL_R}');`, DB) === '0');
r = q(`delete from public.properties where id='${DEAL_P}';`, DB);
check('with no episode and no children the prospect can be deleted', r.ok, r.out);
// ON DELETE SET NULL still works for a converted episode without children
r = q(`delete from public.properties where id='${P_46e}';`, DB);
check('deleting an acquired property with a childless converted episode still sets the episode\'s property_id to null', r.ok && link(RV.conv46e).startsWith('null|converted'), r.out.slice(0, 160));
r = q(`delete from public.properties where id in (select property_id from public.acquisition_reviews where id='${RV.maple}');`, DB);
check('deleting the Maple plaza prospect is refused: it has children (RESTRICT) and an open episode (CHECK)', refused(r), r.out.slice(0, 140));

// ── 6 · RLS ──────────────────────────────────────────────────────────────────
section('6 · ACCESS — A membership READ · B owner-attributed CHILD WRITE · C unauthorized');
console.log('    Acquisition membership access is read-capable in P3. Child-record authorship remains');
console.log('    review-owner-bound by existing composite user FKs. General member write attribution is');
console.log('    deferred to a separately reviewed identity/authorship migration.');
x = parse(rpcBegin(DB, A, 'RLS Deal'));
const RP = x.property_id, RR = x.review_id;
const cnt = (uid, table, where) => as(uid, `select count(*) from public.${table} where ${where};`, DB).out;
// B · owner-attributed child writes: the review owner creates, files and updates
r = as(A, `insert into public.acquisition_documents(review_id,user_id,file_name,intake_id) values ('${RR}','${A}','r.pdf','ik-r');`, DB);
check('B · owner A files a document into their own episode', r.ok && one(`select property_id::text from public.acquisition_documents where intake_id='ik-r';`, DB) === RP, r.out);
r = as(A, `insert into public.acquisition_document_families(review_id,user_id,label) values ('${RR}','${A}','Owner fam');`, DB);
check('B · owner A creates a family in their own episode', r.ok && one(`select property_id::text from public.acquisition_document_families where label='Owner fam';`, DB) === RP, r.out);
r = as(A, `update public.acquisition_documents set file_name='r2.pdf' where intake_id='ik-r';`, DB);
check('B · owner A updates their own document', r.ok && one(`select file_name from public.acquisition_documents where intake_id='ik-r';`, DB) === 'r2.pdf', r.out);
r = as(A, `update public.acquisition_reviews set name='RLS Deal' where id='${RR}';`, DB);
check('B · owner A updates their own episode', r.ok, r.out);
// A · membership read access
check('A · owner A reads the episode and its document', cnt(A, 'acquisition_reviews', `id='${RR}'`) === '1' && cnt(A, 'acquisition_documents', `review_id='${RR}'`) === '1');
check('A · property_manager M (same organisation) reads the episode, its document and its family', cnt(M, 'acquisition_reviews', `id='${RR}'`) === '1' && cnt(M, 'acquisition_documents', `review_id='${RR}'`) === '1' && cnt(M, 'acquisition_document_families', `review_id='${RR}'`) === '1');
check('A · read_only R (same organisation) reads the episode and its document', cnt(R, 'acquisition_reviews', `id='${RR}'`) === '1' && cnt(R, 'acquisition_documents', `review_id='${RR}'`) === '1');
check('A · the orphan converted episode is still visible to its owner (property_id null clause)', cnt(U_479, 'acquisition_reviews', `id='${RV.orphan}'`) === '1');
// B (limit) · a member's child write under their own user_id is refused by the EXISTING user-bound composite FK — expected P3 limitation, not a migration failure
r = as(M, `insert into public.acquisition_documents(review_id,user_id,file_name,intake_id) values ('${RR}','${M}','m.pdf','ik-m');`, DB);
check('B · member M inserting a document under M\'s own user_id is refused by the existing acquisition_documents_review_fk (expected P3 limitation: child authorship is review-owner-bound)',
  refused(r, /acquisition_documents_review_fk/) && one(`select count(*) from public.acquisition_documents where intake_id='ik-m';`, DB) === '0', r.out.slice(0, 160));
r = as(M, `insert into public.acquisition_document_families(review_id,user_id,label) values ('${RR}','${M}','M fam');`, DB);
check('B · member M inserting a family under M\'s own user_id is refused by the existing acq_doc_families_review_fk', refused(r, /acq_doc_families_review_fk/), r.out.slice(0, 160));
r = as(M, `insert into public.acquisition_term_decisions(review_id,user_id,field_key,action,decided_by) values ('${RR}','${M}','rent','confirm','${M}');`, DB);
check('B · member M inserting a decision under M\'s own user_id is refused by the existing acq_term_decisions_review_fk', refused(r, /acq_term_decisions_review_fk/), r.out.slice(0, 160));
check('B · 034 leaves the three user-bound review keys exactly as they were (P3 does not change authorship semantics)',
  one(`select string_agg(conname||':'||pg_get_constraintdef(oid), ' | ' order by conname) from pg_constraint where conname in ('acquisition_documents_review_fk','acq_doc_families_review_fk','acq_term_decisions_review_fk');`, DB)
  === 'acq_doc_families_review_fk:FOREIGN KEY (review_id, user_id) REFERENCES acquisition_reviews(id, user_id) ON DELETE CASCADE | acq_term_decisions_review_fk:FOREIGN KEY (review_id, user_id) REFERENCES acquisition_reviews(id, user_id) ON DELETE CASCADE | acquisition_documents_review_fk:FOREIGN KEY (review_id, user_id) REFERENCES acquisition_reviews(id, user_id) ON DELETE CASCADE');
// C · unauthorized access
check('C · stranger S reads neither the episode nor its document', cnt(S, 'acquisition_reviews', `id='${RR}'`) === '0' && cnt(S, 'acquisition_documents', `review_id='${RR}'`) === '0');
check('C · anon reads neither', pg.as('anon', null, `select count(*) from public.acquisition_reviews where id='${RR}';`, DB).out !== '1');
r = as(S, `insert into public.acquisition_documents(review_id,user_id,file_name,intake_id) values ('${RR}','${S}','s.pdf','ik-s');`, DB);
check('C · stranger S cannot file into another organisation\'s deal', refused(r) || one(`select count(*) from public.acquisition_documents where intake_id='ik-s';`, DB) === '0', r.out.slice(0, 120));
x = parse(rpcBegin(DB, S, 'S own deal'));
const SR = x.review_id;
r = as(M, `insert into public.acquisition_documents(review_id,user_id,file_name,intake_id,property_id) values ('${SR}','${M}','x.pdf','ik-x','${RP}');`, DB);
check('C · a document of S\'s review cannot be attached to O1\'s property (bind trigger) nor filed by M under S\'s episode (policy/FK)', refused(r) || one(`select count(*) from public.acquisition_documents where intake_id='ik-x';`, DB) === '0', r.out.slice(0, 160));
r = as(S, `update public.acquisition_reviews set name='hijacked' where id='${RR}';`, DB);
check('C · stranger S\'s update of the deal changes no row', r.ok && one(`select name from public.acquisition_reviews where id='${RR}';`, DB) === 'RLS Deal', r.out);
r = as(S, `delete from public.acquisition_documents where intake_id='ik-r';`, DB);
check('C · stranger S\'s delete of the owner\'s document removes no row', r.ok && one(`select count(*) from public.acquisition_documents where intake_id='ik-r';`, DB) === '1', r.out);
check('is_property_admin: owner yes, admin member yes, property_manager no, read_only no, stranger no',
  as(A, `select public.is_property_admin('${RP}');`, DB).out === 't' && as(M, `select public.is_property_admin('${RP}');`, DB).out === 'f'
  && as(R, `select public.is_property_admin('${RP}');`, DB).out === 'f' && as(S, `select public.is_property_admin('${RP}');`, DB).out === 'f');

// ── 7 · delete_prospect_acquisition ──────────────────────────────────────────
section('7 · delete_prospect_acquisition — safe removal of a deal that should not have been');
const acquiredBefore7 = one(`select count(*) from public.properties where lifecycle_stage='acquired';`, DB);
const reviewsBefore7 = one(`select count(*) from public.acquisition_reviews;`, DB);
const vocab = (c) => one(`select pg_get_constraintdef(oid) from pg_constraint where conname='${c}';`, DB);
check('"confirmed document" uses 024\'s doc_type_status values confirmed/corrected', /'confirmed'/.test(vocab('acq_docs_doc_type_status_check')) && /'corrected'/.test(vocab('acq_docs_doc_type_status_check')) && /doc_type_status in \('confirmed', 'corrected'\)/.test(strip(SQL)));
check('"confirmed family" uses 024\'s family_status value confirmed', /'confirmed'/.test(vocab('acq_docs_family_status_check')) && /family_status = 'confirmed'/.test(strip(SQL)));
check('a confirmed relationship counts too (relationship_status confirmed)', /'confirmed'/.test(vocab('acq_docs_relationship_status_check')) && /relationship_status = 'confirmed'/.test(strip(SQL)));
const del = (uid, rid) => as(uid, `select public.delete_prospect_acquisition('${rid}');`, DB);
r = del(M, RR); check('property_manager M is refused (admin only)', refused(r, /administrator/), r.out.slice(0, 120));
r = del(R, RR); check('read_only R is refused', refused(r, /administrator/), r.out.slice(0, 120));
r = del(S, RR); check('stranger S is refused', refused(r, /administrator/), r.out.slice(0, 120));
r = pg.as('anon', null, `select public.delete_prospect_acquisition('${RR}');`, DB); check('anon is refused', refused(r), r.out.slice(0, 120));
r = del(A, '00000000-0000-4000-8000-000000000000'); check('an unknown review is refused', refused(r, /No acquisition review/), r.out.slice(0, 120));
r = del(U_479, RV.orphan); check('a legacy episode with no property is refused', refused(r, /no property/), r.out.slice(0, 120));
r = del(U_011, RV.harbor); check('a converted episode on an acquired property is refused', refused(r, /not a prospect/), r.out.slice(0, 120));
r = del(U_011, RV.maple); check('Maple plaza (a confirmed document) is refused', refused(r, /confirmed document/), r.out.slice(0, 140));
// a deal with only a confirmed family filing
x = parse(rpcBegin(DB, A, 'Fam Deal')); const FR = x.review_id, FP = x.property_id;
as(A, `insert into public.acquisition_document_families(id,review_id,user_id,label) values ('ffffffff-0000-4000-8000-0000000000f1','${FR}','${A}','F');`, DB);
as(A, `insert into public.acquisition_documents(review_id,user_id,file_name,intake_id,family_id,family_status,doc_type,doc_type_status,doc_type_source,confirmed_by,confirmed_at) values ('${FR}','${A}','f.pdf','ik-f','ffffffff-0000-4000-8000-0000000000f1','confirmed','original_lease','proposed','ai','${A}',now());`, DB);
r = del(A, FR); check('a deal with a confirmed family filing is refused', refused(r, /confirmed/), r.out.slice(0, 140));
// a deal with a decision
x = parse(rpcBegin(DB, A, 'Dec Deal')); const DR = x.review_id;
as(A, `insert into public.acquisition_term_decisions(review_id,user_id,field_key,action,decided_by) values ('${DR}','${A}','rent','confirm','${A}');`, DB);
r = del(A, DR); check('a deal with a term decision is refused (append-only makes it permanent)', refused(r, /term decision/), r.out.slice(0, 140));
// the allowed case: unconfirmed uploads only
as(A, `insert into public.acquisition_document_families(review_id,user_id,label) values ('${RR}','${A}','Proposed fam');`, DB);
as(A, `update public.acquisition_documents set family_id=(select id from public.acquisition_document_families where label='Proposed fam'), family_status='proposed' where intake_id='ik-r';`, DB);
const docsRR = Number(one(`select count(*) from public.acquisition_documents where review_id='${RR}';`, DB));
const famsRR = Number(one(`select count(*) from public.acquisition_document_families where review_id='${RR}';`, DB));
x = parse(del(A, RR));
check('owner A deletes a prospect whose episode holds only unconfirmed uploads: review, documents, families and property all gone', x.ok === true && x.documents_removed === docsRR && x.families_removed === famsRR
  && one(`select (select count(*) from public.acquisition_reviews where id='${RR}')+(select count(*) from public.properties where id='${RP}')+(select count(*) from public.acquisition_documents where review_id='${RR}');`, DB) === '0', JSON.stringify(x));
// admin member (not owner) may delete
x = parse(rpcBegin(DB, M, 'M Deal', { _org: O1 })); const MR = x.review_id;
x = parse(del(A, MR));
check('an admin member of the organisation (A) may delete a deal M started', x.ok === true, JSON.stringify(x));
// section 7 started three deals (Fam, Dec, M) and removed two (RLS Deal, M Deal): net +1 episode, acquired count unchanged, all eleven fixture episodes present
check('the acquired properties and all other episodes are untouched by these deletes', one(`select count(*) from public.acquisition_reviews;`, DB) === String(Number(reviewsBefore7) + 1)
  && one(`select count(*) from public.properties where lifecycle_stage='acquired';`, DB) === acquiredBefore7
  && one(`select count(*) from public.acquisition_reviews where id in (${Object.values(RV).map((v) => `'${v}'`).join(',')});`, DB) === String(Object.values(RV).length));

// ── 8 · nothing else moved ──────────────────────────────────────────────────
section('8 · NOTHING ELSE MOVED');
check('every object outside 034\'s list is identical across the apply', inventory(DB) === before, 'inventory differs');
check('034 drops only the four owner policies, no table, column of another table, function or trigger of another migration', !/drop (table|column|function|trigger)\b(?! if exists (public\.)?(delete_prospect_acquisition|properties_insert_stage_guard|acq_reviews_insert_guard|acq_reviews_property_immutable|acq_docs_property_bind|acq_doc_families_property_bind|acq_term_decisions_property_bind))/i.test(strip(SQL).replace(/drop trigger if exists (properties_insert_stage_guard|acq_reviews_insert_guard|acq_reviews_property_immutable|acq_docs_property_bind|acq_doc_families_property_bind|acq_term_decisions_property_bind) on/g, '')));
check('034 touches nothing XRPL, wallet, payment or settlement related', !/rlusd|xrpl|xrp\b|wallet|ripple|settlement|payment_/i.test(strip(SQL)));

// ── 9 · rollback ────────────────────────────────────────────────────────────
section('9 · ROLLBACK undoes 034 and its backfill');
r = pg.psqlFile(R034, DB);
check('pilotlike: rollback runs', r.ok, r.ok ? '' : r.out.slice(0, 500));
check('the columns, functions, triggers, index and CHECK are gone; owner policies are back', one(`select (select count(*) from information_schema.columns where column_name='property_id' and table_name in ('acquisition_documents','acquisition_document_families','acquisition_term_decisions'))||'|'||(select count(*) from pg_proc where proname in ('begin_acquisition','delete_prospect_acquisition','is_property_admin'))||'|'||(select count(*) from pg_policies where policyname like 'acq_%owner_all');`, DB) === '0|0|4');
check('the seven backfill prospects are gone and their reviews are unlinked', one(`select (select count(*) from public.properties where data ? '_p3Backfill')||'|'||(select count(*) from public.acquisition_reviews where id in ('${RV.miracle}','${RV.maple}','${RV.lakeview}','${RV.lakev2}','${RV.open05c}','${RV.open97d}','${RV.opend66}') and property_id is not null);`, DB) === '0|0');
check('HARBORVIEW is complete again with no link', link(RV.harbor) === 'null|complete|null', link(RV.harbor));
check('the automatic link to 5c67a03c… is cleared; the conversion record is intact', link(RV.convC4b) === 'null|converted|2026-07-26 18:46:29.707+00' && one(`select data->'conversionRecord'->>'propertyId' from public.acquisition_reviews where id='${RV.convC4b}';`, DB) === P_c4b, link(RV.convC4b));
check('deals started AFTER 034 keep their property and link (real work is not deleted)', one(`select count(*) from public.acquisition_reviews ar join public.properties p on p.id=ar.property_id where ar.name in ('Fam Deal','Dec Deal','S own deal','Manager Deal');`, DB) === '4');
check('the inventory equals the pre-034 inventory', inventory(DB) === before);
r = pg.psqlFile(M034, DB);
check('pilotlike: 034 applies again after the rollback', r.ok, r.ok ? '' : r.out.slice(0, 400));

// ── 10 · fresh model ────────────────────────────────────────────────────────
section('10 · under the post-2026-10-30 default-privilege model');
const F = 'fresh';
pg.database(F, 'post-2026-10-30');
q(SCHEMA, F); q(FIXTURE, F); pg.psqlFile(M032, F); pg.psqlFile(M033, F);
r = pg.psqlFile(M034, F);
check('fresh: 034 applies', r.ok, r.ok ? '' : r.out.slice(0, 300));
check('fresh: authenticated may call the RPCs, anon may not', pg.canExecute('authenticated', 'public.begin_acquisition(text,jsonb,uuid,uuid)', F) && !pg.canExecute('anon', 'public.begin_acquisition(text,jsonb,uuid,uuid)', F)
  && pg.canExecute('authenticated', 'public.delete_prospect_acquisition(uuid)', F) && !pg.canExecute('anon', 'public.delete_prospect_acquisition(uuid)', F));
x = parse(rpcBegin(F, A, 'Fresh deal'));
check('fresh: begin_acquisition works', x.property_id && x.review_id, JSON.stringify(x));

T.finish();
