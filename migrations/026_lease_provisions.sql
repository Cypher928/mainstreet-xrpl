-- ─── 026_lease_provisions — Phase 0, P0.3 ───────────────────────────────────
--
-- A lease provision is a CLAUSE with structure: exclusives, co-tenancy,
-- permitted use, termination, assignment, ROFR/ROFO, guaranties, landlord
-- obligations, renewal terms, rent schedule, expense responsibility, CAM
-- exclusions, audit rights, and anything else material. They are the wrong
-- shape for the tenant record's flat field list and the right shape for their
-- own rows (Finding 2 of the audit).
--
-- THE SAME VERIFIED-MEMORY ARCHITECTURE, NOT A SECOND ONE
--   state       the five provenance states field-provenance.js already defines
--               for every tenant field: lease_confirmed, manually_confirmed,
--               manually_entered, ai_extracted, unknown. One vocabulary; the
--               contract test asserts this list and STATES agree.
--   quote/page/section   the same evidence shape tenant_field_evidence carries
--   reviewer_uid/email/reviewed_at   the same attribution
--   tenant_id text       the same key tenant_field_evidence and
--               tenant_review_audit use (text, the app-side tenant id)
--   source_document_id   → the document register (025)
--   doc_family_id        → the family the source document belongs to
--
-- HISTORY IS KEPT BY CONSTRUCTION. A correction INSERTS a new row and points
-- the old one at it through superseded_by. The trigger below refuses any
-- other update: every value column is immutable once written. There is no
-- delete policy for members. The current provision is the row with
-- superseded_by null.
--
-- provision_key is free text on purpose. The fourteen kinds the plan names
-- (rent_schedule, expense_responsibility, cam_exclusions, renewal_option,
-- exclusive_use, co_tenancy, permitted_use, termination_right,
-- assignment_sublet, rofr_rofo, guaranty, landlord_obligation, other_material,
-- audit_right) are owned by the provisions module (S4), which is the one
-- source of what a provision kind is and what its structure looks like. A
-- second copy here as a check constraint would be a second source.
--
-- ordinal: repeatable kinds (three landlord obligations) are ordered rows.
--
-- RLS: owner OR active member of the property (024's member_property_ids),
-- select + insert + update (the update the trigger permits); no delete.
--
-- PILOT ONLY. Same marker guard. Idempotent. Rollback: 026_lease_provisions_rollback.sql.

begin;

do $$
begin
  if not exists (
    select 1 from public.properties
    where id = 'fd9c09b1-b657-4c58-9999-c3cce28e7600'
  ) then
    raise exception
      'REFUSING TO RUN: pilot marker property not found. This does not appear to be the pilot project (bhmktujbxdbvdmpybmad). 026 must never be applied to production.';
  end if;
end $$;

-- ── Table ──────────────────────────────────────────────────────────────────
create table if not exists public.lease_provisions (
  id                 uuid        primary key default gen_random_uuid(),
  property_id        uuid        not null references public.properties(id) on delete cascade,
  tenant_id          text        not null,
  doc_family_id      uuid,
  source_document_id uuid        references public.lease_documents(id) on delete set null,
  provision_key      text        not null,
  ordinal            integer     not null default 0 check (ordinal >= 0),
  structured         jsonb       not null default '{}'::jsonb,
  plain              text,
  quote              text,
  page               integer     check (page is null or page >= 1),
  section            text,
  state              text        not null
                       check (state in ('lease_confirmed', 'manually_confirmed', 'manually_entered', 'ai_extracted', 'unknown')),
  extraction_id      text,
  extraction_version text,
  reviewer_uid       text,
  reviewer_email     text,
  reviewed_at        timestamptz,
  superseded_by      uuid        references public.lease_provisions(id) on delete set null,
  created_at         timestamptz not null default now(),
  constraint lease_provisions_not_self_superseding check (superseded_by is null or superseded_by <> id)
);

comment on table public.lease_provisions is
  'P0.3: one clause of one lease, with structure, a plain sentence, its quote and page, and the same five provenance states as tenant fields. A correction inserts a new row and sets superseded_by on the old one; value columns are immutable. The current provision is the row with superseded_by null.';
comment on column public.lease_provisions.provision_key is
  'P0.3: the provision kind (rent_schedule, expense_responsibility, cam_exclusions, renewal_option, exclusive_use, co_tenancy, permitted_use, termination_right, assignment_sublet, rofr_rofo, guaranty, landlord_obligation, other_material, audit_right). The vocabulary is owned by the provisions module, not duplicated here.';
comment on column public.lease_provisions.state is
  'P0.3: the five FieldProvenance states. lease_confirmed only when quote and page are on file and describe this value.';
comment on column public.lease_provisions.tenant_id is
  'P0.3: the app-side tenant id, text — the same key tenant_field_evidence and tenant_review_audit use.';

-- ── Indexes ────────────────────────────────────────────────────────────────
create index if not exists lease_provisions_property_idx        on public.lease_provisions (property_id);
create index if not exists lease_provisions_lookup_idx          on public.lease_provisions (property_id, tenant_id, provision_key);
create index if not exists lease_provisions_current_idx         on public.lease_provisions (property_id, tenant_id, provision_key, ordinal) where superseded_by is null;
create index if not exists lease_provisions_source_document_idx on public.lease_provisions (source_document_id) where source_document_id is not null;
create index if not exists lease_provisions_family_idx          on public.lease_provisions (doc_family_id) where doc_family_id is not null;

-- ── Immutability: the only update is to point at a successor ───────────────
create or replace function public._lease_provisions_immutable_guard()
returns trigger language plpgsql as $$
begin
  if old.superseded_by is not null and new.superseded_by is distinct from old.superseded_by then
    raise exception 'lease_provisions.superseded_by is set once' using errcode = 'integrity_constraint_violation';
  end if;
  if new.property_id        is distinct from old.property_id
  or new.tenant_id          is distinct from old.tenant_id
  or new.doc_family_id      is distinct from old.doc_family_id
  or new.source_document_id is distinct from old.source_document_id
  or new.provision_key      is distinct from old.provision_key
  or new.ordinal            is distinct from old.ordinal
  or new.structured         is distinct from old.structured
  or new.plain              is distinct from old.plain
  or new.quote              is distinct from old.quote
  or new.page               is distinct from old.page
  or new.section            is distinct from old.section
  or new.state              is distinct from old.state
  or new.extraction_id      is distinct from old.extraction_id
  or new.extraction_version is distinct from old.extraction_version
  or new.reviewer_uid       is distinct from old.reviewer_uid
  or new.reviewer_email     is distinct from old.reviewer_email
  or new.reviewed_at        is distinct from old.reviewed_at
  or new.created_at         is distinct from old.created_at
  then
    raise exception 'lease_provisions rows are immutable: insert a new row and set superseded_by on the old one'
      using errcode = 'integrity_constraint_violation';
  end if;
  return new;
end $$;

drop trigger if exists lease_provisions_immutable on public.lease_provisions;
create trigger lease_provisions_immutable
  before update on public.lease_provisions
  for each row execute function public._lease_provisions_immutable_guard();

-- ── RLS ────────────────────────────────────────────────────────────────────
alter table public.lease_provisions enable row level security;

revoke all on public.lease_provisions from public, anon;
grant select, insert, update on public.lease_provisions to authenticated;
grant all on public.lease_provisions to service_role;

drop policy if exists lease_provisions_member_select on public.lease_provisions;
drop policy if exists lease_provisions_member_insert on public.lease_provisions;
drop policy if exists lease_provisions_member_update on public.lease_provisions;
drop policy if exists lease_provisions_service_role_all on public.lease_provisions;

create policy lease_provisions_member_select on public.lease_provisions
  for select to authenticated
  using (property_id in (select public.member_property_ids()));
create policy lease_provisions_member_insert on public.lease_provisions
  for insert to authenticated
  with check (property_id in (select public.member_property_ids()));
create policy lease_provisions_member_update on public.lease_provisions
  for update to authenticated
  using      (property_id in (select public.member_property_ids()))
  with check (property_id in (select public.member_property_ids()));
create policy lease_provisions_service_role_all on public.lease_provisions
  for all to service_role using (true) with check (true);

commit;

-- ── Verify (run after commit) ──────────────────────────────────────────────
-- select count(*) from public.lease_provisions;                                                     -- expect 0
-- select tgname from pg_trigger where tgrelid = 'public.lease_provisions'::regclass and not tgisinternal;  -- expect lease_provisions_immutable
-- select policyname, cmd from pg_policies where tablename = 'lease_provisions' order by 1;           -- 3 member policies (select/insert/update) + service_role
-- select has_table_privilege('anon', 'public.lease_provisions', 'select');                            -- expect false
-- select has_table_privilege('authenticated', 'public.lease_provisions', 'delete');                   -- expect false
