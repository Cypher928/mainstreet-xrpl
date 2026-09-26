-- ============================================================================
-- 033_property_lifecycle_integrity.sql — P2 of the Canonical Property
-- Lifecycle Contract: four promises the client keeps alone today become
-- promises the database keeps
-- ============================================================================
-- TARGET: PILOT PROJECT (bhmktujbxdbvdmpybmad). Not to be run on production as
-- part of this change. Written against Pilot's LIVE catalog as read on
-- 2026-09-26 (constraint names, column nullability, trigger inventory), not
-- against the historical migration files.
--
-- WHAT THIS ESTABLISHES
-- ---------------------
--   1  tenants.property_id is IMMUTABLE. A tenant belongs to the property it
--      was created for. 032 stopped the roster RPC from re-pointing one; this
--      stops every other UPDATE, PostgREST included. There is no move
--      operation yet — a later phase adds one, as a controlled function.
--      An orphan (property_id null) cannot be adopted either: null → value is
--      a change, and 032 already treats such a row as foreign.
--
--   2  A lease family belongs to exactly ONE acquisition episode.
--        · unique (id, review_id) on acquisition_document_families, so a
--          family id can be referenced together with its review.
--        · acquisition_documents and acquisition_term_decisions gain a second
--          foreign key on (family_id, review_id) → families (id, review_id).
--          The existing (family_id, user_id) keys are KEPT: this file adds a
--          boundary, it does not loosen one. A document or decision can now
--          only cite a family of its own episode. Pilot data: 0 violations.
--        · acquisition_document_families.review_id is immutable, so a family
--          cannot be walked from one episode to another.
--
--   3  properties.lifecycle_stage moves only along the locked model
--        prospect → acquired     ONLY inside acquire_property (a later phase),
--                                 which sets the transaction-local setting
--                                 mainstreet.acquire = 'on' before the update
--        prospect → passed       stamps passed_at
--        passed   → prospect     reopen
--        acquired → (nothing)    terminal
--      under_review and due_diligence are episode progress, not property
--      stages. They stay in the CHECK constraint Phase 0 wrote (nothing
--      historical is rewritten, and no Pilot row holds them) but this trigger
--      refuses them as a destination. A legacy row that somehow holds one may
--      move to prospect, and nowhere else. An archived property cannot change
--      stage. Every accepted change stamps stage_changed_by (auth.uid() when
--      there is one) and stage_changed_at.
--
--   4  acquisition_reviews.converted_at — when the episode was converted. The
--      existing conversion path writes it together with property_id, so an
--      episode and the property it produced are linked in the database and
--      not only inside review.data.conversionRecord.
--
-- WHAT THIS DOES NOT DO
-- ---------------------
--   No RPC (begin_acquisition, acquire_property come later). No prospect is
--   created. No property_id on the acquisition tables. No RLS change. No
--   read-path change. No row is written. Nothing is dropped.
--
-- ADDITIVE and RE-RUNNABLE. Two trigger functions, three triggers, one unique
-- constraint, two foreign keys, one column. Verified by
-- tools/verify-migration-033.js on a throwaway cluster.
-- ============================================================================

-- ── 1 · tenants.property_id is immutable ────────────────────────────────────

create or replace function public.tenants_property_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.property_id is distinct from old.property_id then
    raise exception 'tenants.property_id is immutable: tenant % belongs to property % and cannot be moved to %',
      old.id, coalesce(old.property_id::text, '<none>'), coalesce(new.property_id::text, '<none>')
      using errcode = 'integrity_constraint_violation',
            hint    = 'A tenant is created for one property. There is no move operation.';
  end if;
  return new;
end;
$$;

drop trigger if exists tenants_property_immutable on public.tenants;
create trigger tenants_property_immutable
  before update of property_id on public.tenants
  for each row execute function public.tenants_property_immutable();

-- ── 2 · a family belongs to one episode ─────────────────────────────────────

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'acq_doc_families_id_review_key') then
    alter table public.acquisition_document_families
      add constraint acq_doc_families_id_review_key unique (id, review_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'acq_docs_family_review_fk') then
    alter table public.acquisition_documents
      add constraint acq_docs_family_review_fk
      foreign key (family_id, review_id)
      references public.acquisition_document_families (id, review_id)
      on delete set null (family_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'acq_term_decisions_family_review_fk') then
    alter table public.acquisition_term_decisions
      add constraint acq_term_decisions_family_review_fk
      foreign key (family_id, review_id)
      references public.acquisition_document_families (id, review_id)
      on delete set null (family_id);
  end if;
end $$;

create or replace function public.acq_doc_families_review_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.review_id is distinct from old.review_id then
    raise exception 'acquisition_document_families.review_id is immutable: family % belongs to review %',
      old.id, old.review_id
      using errcode = 'integrity_constraint_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists acq_doc_families_review_immutable on public.acquisition_document_families;
create trigger acq_doc_families_review_immutable
  before update of review_id on public.acquisition_document_families
  for each row execute function public.acq_doc_families_review_immutable();

-- ── 3 · the property lifecycle moves only along the locked model ────────────

create or replace function public.properties_stage_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_from    text := old.lifecycle_stage;
  v_to      text := new.lifecycle_stage;
  v_acquire text := current_setting('mainstreet.acquire', true);
begin
  if v_to is not distinct from v_from then
    return new;
  end if;

  if new.archived_at is not null then
    raise exception 'property % is archived and cannot change stage (% → %)', old.id, v_from, v_to
      using errcode = 'check_violation';
  end if;

  if v_to in ('under_review', 'due_diligence') then
    raise exception '% is acquisition-episode progress, not a property stage; property % stays %', v_to, old.id, v_from
      using errcode = 'check_violation',
            hint    = 'A property is prospect, acquired or passed. The episode carries its own progress.';
  end if;

  if v_from = 'acquired' then
    raise exception 'property % is acquired; acquired is terminal (→ % refused)', old.id, v_to
      using errcode = 'check_violation';
  end if;

  if v_to = 'acquired' then
    if v_from <> 'prospect' then
      raise exception 'property % is %; only a prospect can be acquired', old.id, v_from
        using errcode = 'check_violation';
    end if;
    if coalesce(v_acquire, '') <> 'on' then
      raise exception 'property % can be acquired only through acquire_property', old.id
        using errcode = 'insufficient_privilege',
              hint    = 'Acquire is one transaction on the same property; a plain update is not it.';
    end if;
    new.acquired_at := coalesce(new.acquired_at, now());
  elsif v_to = 'passed' then
    if v_from <> 'prospect' then
      raise exception 'property % is %; only a prospect can be passed', old.id, v_from
        using errcode = 'check_violation';
    end if;
    new.passed_at := coalesce(new.passed_at, now());
  elsif v_to = 'prospect' then
    if v_from not in ('passed', 'under_review', 'due_diligence') then
      raise exception 'property % is %; it cannot become a prospect', old.id, v_from
        using errcode = 'check_violation';
    end if;
  else
    raise exception '% is not a property stage', v_to using errcode = 'check_violation';
  end if;

  new.stage_changed_by := coalesce(auth.uid(), new.stage_changed_by);
  new.stage_changed_at := now();
  return new;
end;
$$;

drop trigger if exists properties_stage_transition on public.properties;
create trigger properties_stage_transition
  before update of lifecycle_stage on public.properties
  for each row execute function public.properties_stage_transition();

-- ── 4 · when the episode was converted ──────────────────────────────────────

alter table public.acquisition_reviews
  add column if not exists converted_at timestamptz;

comment on column public.acquisition_reviews.converted_at is
  'When this acquisition episode was converted to (from P4 on: acquired as) its property. Written with property_id by the conversion path.';
