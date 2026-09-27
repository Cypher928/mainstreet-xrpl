-- ============================================================================
-- 034_property_at_new_acquisition.sql — P3 of the Canonical Property Lifecycle
-- Contract: a deal is a property from its first minute
-- ============================================================================
-- TARGET: PILOT PROJECT (bhmktujbxdbvdmpybmad). Not to be run on production as
-- part of this change. Written against Pilot's LIVE catalog and LIVE data as
-- read on 2026-09-27; every row this file touches is named below.
--
-- Requires 033 (the stage-transition trigger and its reserved-setting pattern,
-- converted_at, the review-bound family keys).
--
-- WHAT THIS ESTABLISHES
-- ---------------------
--   1  begin_acquisition(name, data, organization?, review_id?) creates the
--      PROSPECT property and its acquisition episode in one transaction and
--      returns both ids. No half-created deal is possible. A prospect is born
--      nowhere else: a BEFORE INSERT guard on properties refuses 'prospect'
--      outside this function (the existing direct add of an owned building,
--      which inserts 'acquired', is unchanged). An episode is born nowhere
--      else either: a BEFORE INSERT guard on acquisition_reviews requires a
--      property that is a prospect, not archived, and the function's setting.
--
--   2  Every acquisition child is property-owned. acquisition_documents,
--      acquisition_document_families and acquisition_term_decisions gain
--      property_id NOT NULL → properties ON DELETE RESTRICT. A trigger fills it
--      from the row's review and refuses any value that is not the review's
--      property, so a record can never be filed under another property. A
--      property that holds any acquisition record cannot be deleted; records
--      leave only through their episode (the existing review cascade), and an
--      episode with decisions is permanent (the existing append-only rule).
--      RESTRICT, not CASCADE: a property delete must never destroy evidence.
--
--   3  acquisition_reviews.property_id stays nullable with its existing
--      ON DELETE SET NULL (a converted episode outlives a deleted acquired
--      property as history, exactly as today), but an OPEN episode always has
--      a property: CHECK (status = 'converted' OR property_id IS NOT NULL).
--      Deleting a property with an open episode therefore fails. property_id,
--      once set, cannot be changed to another property. At most one open
--      episode per property (partial unique index; open = draft, analyzing,
--      complete).
--
--   4  Access follows property membership (contract D3). The four owner-only
--      policies (user_id = auth.uid()) are replaced by property_id IN
--      member_property_ids(), which already includes properties the caller
--      owns, so no owner loses access; an orphaned converted episode stays
--      visible to its owner. is_property_admin() (owner, or active
--      organisation member with role 'admin') guards administrative acts.
--
--      SCOPE OF MEMBERSHIP ACCESS IN P3 — READ-CAPABLE, NOT WRITE-ATTRIBUTED.
--      Acquisition membership access is read-capable in P3. Child-record
--      authorship remains review-owner-bound by existing composite user FKs:
--      acquisition_documents_review_fk, acq_doc_families_review_fk and
--      acq_term_decisions_review_fk are (review_id, user_id) →
--      acquisition_reviews(id, user_id), and the family/parent/superseded/
--      source-document keys are (x_id, user_id) pairs likewise, so a child row
--      must carry the review owner's user_id, and acq_term_decisions_actor
--      requires decided_by = user_id. An organisation member who inserts a
--      child under their own user_id is therefore refused by those keys,
--      before the policies below are consulted. This file does not change
--      those keys, the child user_id semantics, or the actor triggers.
--      General member write attribution is deferred to a separately reviewed
--      identity/authorship migration.
--
--   5  delete_prospect_acquisition(review_id): the one safe way to remove a
--      deal that was started and should not have been. Admin only; the
--      property must be a prospect with exactly this episode, and the episode
--      must hold no confirmed document (doc_type_status confirmed/corrected,
--      family_status confirmed or relationship_status confirmed — the state
--      fields 024 defined), no confirmed family (a family a document is
--      filed into with family_status = 'confirmed') and no term decision.
--      It deletes the review (unconfirmed documents and families cascade
--      through the review key, as they do today) and then the property, in
--      one transaction.
--
-- BACKFILL — Pilot's 11 acquisition reviews, by evidence, row by row
-- ------------------------------------------------------------------
--   Two converted reviews whose conversionRecord names a property that exists
--   with the same owner are linked to it:
--     aca00000-0000-4000-b000-c4bbdb183219 → 5c67a03c-81c2-4a42-bb20-496b486534ae
--     aca00000-0000-4000-b000-46e82be2381d → 15436ba9-5827-4867-a4db-25a1409828a0
--   One review contradicts itself: status 'complete' but a conversionRecord
--   (convertedAt 2026-09-16T20:30:23.332Z) naming property
--   286622d5-0c8f-4dfd-b242-b75bdaa49e1e, which exists, is acquired, has the
--   same owner and the same name, and was created that day. The application
--   already treats it as converted (the Acquire guard refuses it and the card
--   action reads Converted). The status is corrected to 'converted' and the
--   review is linked; conversionRecord is left untouched; no property is
--   created:
--     aca00000-0000-4000-b000-011df998bad2 → 286622d5-0c8f-4dfd-b242-b75bdaa49e1e
--   Seven open reviews (draft or complete, no conversion) each receive a NEW
--   prospect property owned by the review's own user_id, named after the
--   review, sqft from data.totalSqFt, data = {"_p3Backfill": true,
--   "_p3ReviewId": <review>}; the default-organisation trigger assigns each
--   owner's organisation. Ownership is the review's, never inferred:
--     aca00000-0000-4000-b000-05c35898a4e8, aca00000-0000-4000-b000-97d242509394,
--     aca00000-0000-4000-b000-d66ee6a3ccf5 (demo-seeded Harborview reviews),
--     b7aab0b8-5458-4f5a-a482-5dfc644101dc (Miracle Mile),
--     59af3e99-82dc-4a97-813b-21e4f956aca8 (Maple plaza — holds all 8 documents,
--     5 families and 27 decisions), 2457445b-3696-405b-b946-44ba14757ef9 (Lakeview),
--     a9be308c-bbac-4cb2-978e-459138f72586 (lake view)
--   One converted review whose property no longer exists keeps property_id
--   null, which the CHECK permits for converted episodes; it has no children:
--     aca00000-0000-4000-b000-479b339e9193 → ed839767-32c6-4d90-8fe6-0f78f19dea8d (deleted)
--   Every child row then takes its review's property, and the three child
--   columns become NOT NULL. The rules below are written generally so the same
--   file is correct on a database that has none of these rows.
--
-- WHAT THIS DOES NOT DO
-- ---------------------
--   No acquire_property. No change to how conversion creates a property (P4).
--   No property_attention, dedup, identity check, register fold-in, invoice
--   table, tenant change, workspace read change, API-route membership, or
--   organisation UI. The properties row policy, payments, settlement and
--   XRPL are untouched. Storage objects of a deleted episode are not removed
--   (as today).
-- ============================================================================

-- ── helpers ──────────────────────────────────────────────────────────────────

create or replace function public.is_property_admin(p_property uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.properties p
    where p.id = p_property
      and (
        p.user_id = auth.uid()
        or (p.organization_id is not null and exists (
              select 1 from public.organization_members m
              where m.organization_id = p.organization_id
                and m.user_id     = auth.uid()
                and m.role        = 'admin'
                and m.accepted_at is not null
                and m.revoked_at  is null))
      )
  )
$$;
revoke all on function public.is_property_admin(uuid) from public, anon;
grant execute on function public.is_property_admin(uuid) to authenticated, service_role;

-- ── 1 · begin_acquisition ────────────────────────────────────────────────────

create or replace function public.begin_acquisition(
  p_name            text,
  p_data            jsonb default '{}'::jsonb,
  p_organization_id uuid  default null,
  p_review_id       uuid  default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_name    text := nullif(btrim(coalesce(p_name, '')), '');
  v_sqft    numeric;
  v_pid     uuid;
  v_rid     uuid;
  v_created timestamptz;
  v_updated timestamptz;
begin
  if v_uid is null then
    raise exception 'begin_acquisition requires an authenticated user'
      using errcode = 'insufficient_privilege';
  end if;
  if v_name is null then
    raise exception 'A new acquisition needs a name' using errcode = 'check_violation';
  end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' then
    raise exception 'p_data must be a JSON object' using errcode = 'check_violation';
  end if;
  if p_organization_id is not null and not exists (
      select 1 from public.organization_members m
      where m.organization_id = p_organization_id
        and m.user_id     = v_uid
        and m.accepted_at is not null
        and m.revoked_at  is null
        and m.role        <> 'read_only') then
    raise exception 'You are not an active member of that organisation, or your role there is read-only'
      using errcode = 'insufficient_privilege';
  end if;

  v_sqft := case when (p_data->>'totalSqFt') ~ '^[0-9]+(\.[0-9]+)?$'
                 then (p_data->>'totalSqFt')::numeric else 0 end;

  -- The reserved setting the two insert guards look for. Transaction-local.
  perform set_config('mainstreet.begin_acquisition', 'on', true);

  insert into public.properties
    (user_id, name, sqft, data, lifecycle_stage, organization_id, stage_changed_by, stage_changed_at)
  values
    (v_uid, v_name, v_sqft, '{}'::jsonb, 'prospect', p_organization_id, v_uid, now())
  returning id into v_pid;

  insert into public.acquisition_reviews (id, user_id, name, status, data, property_id)
  values (coalesce(p_review_id, gen_random_uuid()), v_uid, v_name, 'draft', p_data, v_pid)
  returning id, created_at, updated_at into v_rid, v_created, v_updated;

  perform set_config('mainstreet.begin_acquisition', '', true);

  return jsonb_build_object(
    'property_id', v_pid, 'review_id', v_rid, 'name', v_name,
    'status', 'draft', 'lifecycle_stage', 'prospect',
    'created_at', v_created, 'updated_at', v_updated);
end;
$$;
revoke all on function public.begin_acquisition(text, jsonb, uuid, uuid) from public, anon;
grant execute on function public.begin_acquisition(text, jsonb, uuid, uuid) to authenticated, service_role;

-- a prospect is born only inside begin_acquisition
create or replace function public.properties_insert_stage_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.lifecycle_stage = 'prospect' then
    if coalesce(current_setting('mainstreet.begin_acquisition', true), '') <> 'on' then
      raise exception 'a prospect is created only by begin_acquisition'
        using errcode = 'insufficient_privilege';
    end if;
    new.stage_changed_at := coalesce(new.stage_changed_at, now());
    new.stage_changed_by := coalesce(new.stage_changed_by, auth.uid());
  elsif new.lifecycle_stage in ('under_review', 'due_diligence') then
    raise exception '% is acquisition-episode progress, not a property stage', new.lifecycle_stage
      using errcode = 'check_violation';
  elsif new.lifecycle_stage = 'passed' then
    raise exception 'a property is not created as passed' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
drop trigger if exists properties_insert_stage_guard on public.properties;
create trigger properties_insert_stage_guard
  before insert on public.properties
  for each row execute function public.properties_insert_stage_guard();

-- an episode is born only inside begin_acquisition, on a live prospect
create or replace function public.acq_reviews_insert_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_stage    text;
  v_archived timestamptz;
begin
  if new.property_id is null then
    raise exception 'an acquisition review belongs to a property; start it with begin_acquisition'
      using errcode = 'check_violation';
  end if;
  if coalesce(current_setting('mainstreet.begin_acquisition', true), '') <> 'on' then
    raise exception 'an acquisition review is created only by begin_acquisition'
      using errcode = 'insufficient_privilege';
  end if;
  select lifecycle_stage, archived_at into v_stage, v_archived
  from public.properties where id = new.property_id;
  if v_stage is null then
    raise exception 'property % does not exist', new.property_id using errcode = 'foreign_key_violation';
  end if;
  if v_stage <> 'prospect' then
    raise exception 'property % is %; a new acquisition episode opens only on a prospect', new.property_id, v_stage
      using errcode = 'check_violation';
  end if;
  if v_archived is not null then
    raise exception 'property % is archived', new.property_id using errcode = 'check_violation';
  end if;
  if auth.uid() is not null and new.user_id is distinct from auth.uid() then
    raise exception 'an acquisition review is recorded by the person who starts it'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;
drop trigger if exists acq_reviews_insert_guard on public.acquisition_reviews;
create trigger acq_reviews_insert_guard
  before insert on public.acquisition_reviews
  for each row execute function public.acq_reviews_insert_guard();

-- an episode's property, once set, is never another property
create or replace function public.acq_reviews_property_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.property_id is not null and new.property_id is not null
     and new.property_id <> old.property_id then
    raise exception 'acquisition_reviews.property_id is immutable: review % belongs to property %',
      old.id, old.property_id using errcode = 'integrity_constraint_violation';
  end if;
  return new;
end;
$$;
drop trigger if exists acq_reviews_property_immutable on public.acquisition_reviews;
create trigger acq_reviews_property_immutable
  before update of property_id on public.acquisition_reviews
  for each row execute function public.acq_reviews_property_immutable();

-- ── 2 · property-owned children ─────────────────────────────────────────────

alter table public.acquisition_documents
  add column if not exists property_id uuid references public.properties(id) on delete restrict;
alter table public.acquisition_document_families
  add column if not exists property_id uuid references public.properties(id) on delete restrict;
alter table public.acquisition_term_decisions
  add column if not exists property_id uuid references public.properties(id) on delete restrict;

create index if not exists idx_acq_docs_property          on public.acquisition_documents (property_id);
create index if not exists idx_acq_doc_families_property  on public.acquisition_document_families (property_id);
create index if not exists idx_acq_term_decisions_property on public.acquisition_term_decisions (property_id);

-- a child's property is its review's property, filled when absent, refused when different
create or replace function public.acq_child_property_bind()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_pid uuid;
begin
  if tg_op = 'UPDATE' and old.property_id is not null and new.property_id is not null
     and new.property_id <> old.property_id then
    raise exception '%.property_id is immutable', tg_table_name using errcode = 'integrity_constraint_violation';
  end if;
  select property_id into v_pid from public.acquisition_reviews where id = new.review_id;
  if new.property_id is null then
    new.property_id := v_pid;
  end if;
  if new.property_id is null then
    raise exception 'review % has no property; nothing can be filed under it', new.review_id
      using errcode = 'check_violation';
  end if;
  if v_pid is not null and new.property_id <> v_pid then
    raise exception '% cannot be attached to property %: its review belongs to property %',
      tg_table_name, new.property_id, v_pid using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
drop trigger if exists acq_docs_property_bind on public.acquisition_documents;
create trigger acq_docs_property_bind
  before insert or update on public.acquisition_documents
  for each row execute function public.acq_child_property_bind();
drop trigger if exists acq_doc_families_property_bind on public.acquisition_document_families;
create trigger acq_doc_families_property_bind
  before insert or update on public.acquisition_document_families
  for each row execute function public.acq_child_property_bind();
-- decisions are append-only (024): updates are refused by their own trigger, so bind on insert only
drop trigger if exists acq_term_decisions_property_bind on public.acquisition_term_decisions;
create trigger acq_term_decisions_property_bind
  before insert on public.acquisition_term_decisions
  for each row execute function public.acq_child_property_bind();

-- ── 3 · backfill (see header for the row-by-row account) ────────────────────

do $$
declare
  r     record;
  v_pid uuid;
begin
  perform set_config('mainstreet.begin_acquisition', 'on', true);

  -- The self-contradicting Harborview review: converted in fact, 'complete' in status.
  update public.acquisition_reviews ar
     set status       = 'converted',
         property_id  = '286622d5-0c8f-4dfd-b242-b75bdaa49e1e',
         converted_at = coalesce(ar.converted_at, '2026-09-16T20:30:23.332Z'::timestamptz)
   where ar.id = 'aca00000-0000-4000-b000-011df998bad2'
     and ar.status = 'complete'
     and ar.property_id is null
     and ar.data->'conversionRecord'->>'propertyId' = '286622d5-0c8f-4dfd-b242-b75bdaa49e1e'
     and exists (select 1 from public.properties p
                 where p.id = '286622d5-0c8f-4dfd-b242-b75bdaa49e1e'
                   and p.user_id = ar.user_id
                   and p.lifecycle_stage = 'acquired');

  -- Converted reviews whose recorded property exists with the same owner.
  update public.acquisition_reviews ar
     set property_id  = p.id,
         converted_at = coalesce(ar.converted_at, nullif(ar.data->'conversionRecord'->>'convertedAt', '')::timestamptz)
    from public.properties p
   where ar.status = 'converted'
     and ar.property_id is null
     and p.id::text = ar.data->'conversionRecord'->>'propertyId'
     and p.user_id  = ar.user_id;

  -- Open reviews without a property: one prospect each, owned by the review's owner.
  for r in
    select id, user_id, name, data
    from public.acquisition_reviews
    where status in ('draft', 'analyzing', 'complete') and property_id is null
    order by created_at
  loop
    insert into public.properties (user_id, name, sqft, data, lifecycle_stage, stage_changed_at)
    values (
      r.user_id,
      coalesce(nullif(btrim(r.name), ''), 'New Property'),
      case when (r.data->>'totalSqFt') ~ '^[0-9]+(\.[0-9]+)?$' then (r.data->>'totalSqFt')::numeric else 0 end,
      jsonb_build_object('_p3Backfill', true, '_p3ReviewId', r.id),
      'prospect',
      now())
    returning id into v_pid;
    update public.acquisition_reviews set property_id = v_pid where id = r.id;
  end loop;

  -- Children take their review's property.
  update public.acquisition_documents d
     set property_id = ar.property_id
    from public.acquisition_reviews ar
   where ar.id = d.review_id and d.property_id is null and ar.property_id is not null;
  update public.acquisition_document_families f
     set property_id = ar.property_id
    from public.acquisition_reviews ar
   where ar.id = f.review_id and f.property_id is null and ar.property_id is not null;

  -- Decisions are append-only: their own trigger refuses UPDATE. The one-time
  -- fill of a new column is not an edit of a decision, so the guard steps
  -- aside for exactly these statements and is re-armed immediately after.
  alter table public.acquisition_term_decisions disable trigger trg_acq_term_decisions_no_update;
  update public.acquisition_term_decisions x
     set property_id = ar.property_id
    from public.acquisition_reviews ar
   where ar.id = x.review_id and x.property_id is null and ar.property_id is not null;
  alter table public.acquisition_term_decisions enable trigger trg_acq_term_decisions_no_update;

  perform set_config('mainstreet.begin_acquisition', '', true);
end $$;

-- Every child now has a property; if one did not, this fails and the whole file rolls back.
alter table public.acquisition_documents         alter column property_id set not null;
alter table public.acquisition_document_families alter column property_id set not null;
alter table public.acquisition_term_decisions    alter column property_id set not null;

-- ── 4 · open episodes always have a property; one open episode per property ─

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'acq_reviews_open_has_property') then
    alter table public.acquisition_reviews
      add constraint acq_reviews_open_has_property
      check (status = 'converted' or property_id is not null) not valid;
  end if;
end $$;
alter table public.acquisition_reviews validate constraint acq_reviews_open_has_property;

create unique index if not exists acq_reviews_one_open_per_property
  on public.acquisition_reviews (property_id)
  where status in ('draft', 'analyzing', 'complete');

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'acq_doc_families_id_property_key') then
    alter table public.acquisition_document_families
      add constraint acq_doc_families_id_property_key unique (id, property_id);
  end if;
end $$;

-- ── 5 · access follows property membership ──────────────────────────────────

drop policy if exists acq_reviews_owner_all        on public.acquisition_reviews;
drop policy if exists acq_docs_owner_all           on public.acquisition_documents;
drop policy if exists acq_doc_families_owner_all   on public.acquisition_document_families;
drop policy if exists acq_term_decisions_owner_all on public.acquisition_term_decisions;

drop policy if exists acq_reviews_member_all on public.acquisition_reviews;
create policy acq_reviews_member_all on public.acquisition_reviews
  for all to authenticated
  using      (property_id in (select public.member_property_ids()) or (property_id is null and user_id = auth.uid()))
  with check (property_id in (select public.member_property_ids()) or (property_id is null and user_id = auth.uid()));

drop policy if exists acq_docs_member_all on public.acquisition_documents;
create policy acq_docs_member_all on public.acquisition_documents
  for all to authenticated
  using      (property_id in (select public.member_property_ids()))
  with check (property_id in (select public.member_property_ids()));

drop policy if exists acq_doc_families_member_all on public.acquisition_document_families;
create policy acq_doc_families_member_all on public.acquisition_document_families
  for all to authenticated
  using      (property_id in (select public.member_property_ids()))
  with check (property_id in (select public.member_property_ids()));

drop policy if exists acq_term_decisions_member_all on public.acquisition_term_decisions;
create policy acq_term_decisions_member_all on public.acquisition_term_decisions
  for all to authenticated
  using      (property_id in (select public.member_property_ids()))
  with check (property_id in (select public.member_property_ids()));

-- ── 6 · delete_prospect_acquisition ─────────────────────────────────────────

create or replace function public.delete_prospect_acquisition(p_review_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid           uuid := auth.uid();
  v_rid           uuid;
  v_pid           uuid;
  v_status        text;
  v_stage         text;
  v_other         integer;
  v_docs          integer;
  v_confirmed_docs integer;
  v_fams          integer;
  v_confirmed_fams integer;
  v_decs          integer;
begin
  if v_uid is null then
    raise exception 'delete_prospect_acquisition requires an authenticated user'
      using errcode = 'insufficient_privilege';
  end if;

  select id, property_id, status into v_rid, v_pid, v_status
  from public.acquisition_reviews where id = p_review_id;
  if v_rid is null then
    raise exception 'No acquisition review % exists', p_review_id using errcode = 'no_data_found';
  end if;
  if v_pid is null then
    raise exception 'This review has no property; a legacy episode is not deleted through this function'
      using errcode = 'check_violation';
  end if;
  if not public.is_property_admin(v_pid) then
    raise exception 'Only an administrator of the property may delete its acquisition'
      using errcode = 'insufficient_privilege';
  end if;

  select lifecycle_stage into v_stage from public.properties where id = v_pid;
  if v_stage is null then
    raise exception 'Property % does not exist', v_pid using errcode = 'no_data_found';
  end if;
  if v_stage <> 'prospect' then
    raise exception 'Property % is %, not a prospect; it is not deleted through its acquisition', v_pid, v_stage
      using errcode = 'check_violation';
  end if;

  select count(*) into v_other from public.acquisition_reviews
  where property_id = v_pid and id <> v_rid;
  if v_other > 0 then
    raise exception 'Property % has % other acquisition episode(s); this review is not its only one', v_pid, v_other
      using errcode = 'check_violation';
  end if;

  select count(*),
         count(*) filter (where doc_type_status in ('confirmed', 'corrected')
                             or family_status = 'confirmed'
                             or relationship_status = 'confirmed')
    into v_docs, v_confirmed_docs
  from public.acquisition_documents where review_id = v_rid;

  select count(*),
         count(*) filter (where exists (select 1 from public.acquisition_documents d
                                        where d.family_id = f.id and d.family_status = 'confirmed'))
    into v_fams, v_confirmed_fams
  from public.acquisition_document_families f where f.review_id = v_rid;

  select count(*) into v_decs from public.acquisition_term_decisions where review_id = v_rid;

  if v_confirmed_docs > 0 then
    raise exception 'This acquisition has % confirmed document(s); a deal with confirmed records is not deleted', v_confirmed_docs
      using errcode = 'check_violation';
  end if;
  if v_confirmed_fams > 0 then
    raise exception 'This acquisition has % confirmed leasehold(s); a deal with confirmed records is not deleted', v_confirmed_fams
      using errcode = 'check_violation';
  end if;
  if v_decs > 0 then
    raise exception 'This acquisition has % term decision(s); decisions are append-only and make the episode permanent', v_decs
      using errcode = 'check_violation';
  end if;

  -- The review first: its unconfirmed documents and families cascade through
  -- the review key, exactly as a review delete does today. Then the property,
  -- which now has no children and no episode.
  delete from public.acquisition_reviews where id = v_rid;
  delete from public.properties where id = v_pid;

  return jsonb_build_object('ok', true, 'review_id', v_rid, 'property_id', v_pid,
                            'documents_removed', v_docs, 'families_removed', v_fams);
end;
$$;
revoke all on function public.delete_prospect_acquisition(uuid) from public, anon;
grant execute on function public.delete_prospect_acquisition(uuid) to authenticated, service_role;
