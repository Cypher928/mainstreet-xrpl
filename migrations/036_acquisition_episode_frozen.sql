-- ============================================================================
-- 036_acquisition_episode_frozen.sql — P5-6A: a converted acquisition is
-- history, and history does not change
-- ============================================================================
-- TARGET: PILOT PROJECT (bhmktujbxdbvdmpybmad). Not to be run on production as
-- part of this change. Written against Pilot's LIVE catalog as read on
-- 2026-09-29. Requires 033 (converted_at), 034 (property_id on the acquisition
-- tables, begin_acquisition, delete_prospect_acquisition) and 035
-- (acquire_property). It changes none of them.
--
-- WHY
-- ---
--   Since P5-2..P5-5 the Property Workspace reads the converted acquisition
--   review and its documents, leaseholds and term decisions AS the property's
--   history: what was filed, what a person verified, the term states as they
--   stood at acquisition, the episode's milestones. Until this file nothing
--   prevented those rows from changing afterwards: `authenticated` could UPDATE
--   and DELETE acquisition_reviews and acquisition_documents, families were
--   mutable, a new term decision could be appended, and a re-run of the
--   analysis rewrote data.analysis.canonical — the only record of the term
--   states as acquired. Only acquisition_term_decisions was append-only.
--
--   This file makes the freeze a property of the database. The client half
--   (renderers that draw no control on a converted review) is a courtesy; the
--   triggers below are the enforcement, and they apply to every role,
--   service role included — triggers are role-blind.
--
-- THE RULE
-- --------
--   An acquisition review with status = 'converted' is FROZEN, together with
--   every acquisition_documents, acquisition_document_families and
--   acquisition_term_decisions row that names it.
--
-- BEFORE → AFTER (exact inventory)
-- --------------------------------
--   functions   + public._acq_episode_frozen(uuid)      (security definer, stable)
--               + public.acq_children_frozen()          (trigger function)
--               + public.acq_reviews_frozen()           (trigger function)
--               = every other function untouched (028–035 included)
--
--   triggers    acquisition_reviews
--                 before: acq_reviews_insert_guard, acq_reviews_property_immutable,
--                         acq_reviews_updated_at
--                 after:  + acq_reviews_frozen  (BEFORE UPDATE OR DELETE)
--               acquisition_documents
--                 before: acq_docs_property_bind, acq_documents_updated_at,
--                         trg_acq_docs_coherence
--                 after:  + acq_children_frozen (BEFORE INSERT OR UPDATE OR DELETE)
--               acquisition_document_families
--                 before: acq_doc_families_property_bind,
--                         acq_doc_families_review_immutable,
--                         trg_acq_doc_families_updated_at
--                 after:  + acq_children_frozen (BEFORE INSERT OR UPDATE OR DELETE)
--               acquisition_term_decisions
--                 before: acq_term_decisions_property_bind,
--                         trg_acq_term_decisions_actor,
--                         trg_acq_term_decisions_no_delete,
--                         trg_acq_term_decisions_no_update
--                 after:  + acq_children_frozen (BEFORE INSERT OR UPDATE OR DELETE)
--               Row triggers of one table fire in NAME order. `acq_children_frozen`
--               and `acq_reviews_frozen` sort before every existing trigger on
--               their tables, so a refused write is refused before set_updated_at,
--               property_bind or coherence run.
--
--   privileges  anon on acquisition_reviews:    ALL (006 never revoked) → none
--               anon on acquisition_documents:  ALL (023 never revoked) → none
--               anon on acquisition_document_families / _term_decisions: already
--               none (024b, 026c) — unchanged
--               authenticated, service_role: unchanged on every table
--               (RLS already returned anon zero rows; this closes the hygiene
--               gap so a policy mistake can never widen into anon writes.)
--
--   tables, columns, constraints, indexes, RLS policies, membership predicates
--   (member_property_ids, is_property_admin), data: UNCHANGED. No row is read
--   or written by this file outside the trigger bodies.
--
-- TRIGGER BEHAVIOUR, EXPLICITLY
-- -----------------------------
--   acq_children_frozen — documents, families, decisions; the row's review is
--   OLD.review_id for UPDATE/DELETE and NEW.review_id for INSERT.
--     review not converted     → pass through (open / prospect episodes keep
--                                exactly their existing behaviour)
--     INSERT into converted    → REFUSE
--     UPDATE of a frozen row   → REFUSE, except at pg_trigger_depth() > 1 when
--                                the only change is a foreign key's own SET NULL
--                                (family_id, parent_document_id,
--                                superseded_by_document_id, source_document_id
--                                going to null; every other column identical)
--     DELETE of a frozen row   → REFUSE at depth <= 1 (a statement someone ran);
--                                PASS at depth > 1 (a foreign key's own cascade,
--                                as 028b for property_events)
--
--   acq_reviews_frozen — acquisition_reviews, when OLD.status = 'converted'.
--     DELETE                   → REFUSE at depth <= 1; PASS at depth > 1
--                                (the auth.users cascade)
--     UPDATE, the SET NULL     → PASS only at depth > 1, only when property_id
--                                goes from a value to null and every other
--                                column is identical (the property row was
--                                deleted; acquisition_reviews.property_id is
--                                ON DELETE SET NULL)
--     UPDATE, the legacy revert→ PASS only in this exact shape, the write
--                                _revertAcquisitionsForDeletedProperty makes
--                                after the property is gone:
--                                  OLD.property_id IS NULL AND NEW.property_id IS NULL
--                                  AND NEW.status = 'complete'
--                                  AND NEW.data has no 'conversionRecord'
--                                  AND id, user_id, name, created_at, converted_at unchanged
--                                  AND NEW.data − {conversionRecord, conversionHistory,
--                                      activity, activityCount, activityDropped, stage}
--                                    = OLD.data − the same keys
--                                (so analysis, families, documentDispositions,
--                                extractionResolutions, tenants, invoices,
--                                totalSqFt and every other key are byte-identical)
--     UPDATE, anything else    → REFUSE (errcode integrity_constraint_violation,
--                                hint naming the property the episode acquired)
--     status ≠ 'converted'     → pass through; acquire_property's own update
--                                sees OLD.status IN (draft, analyzing, complete)
--                                and is unaffected.
--
--   Why the revert exception cannot become a bypass: it requires the property
--   to be gone already (property_id null, which for any episode with documents,
--   families or decisions is unreachable — those children reference the
--   property ON DELETE RESTRICT), it withdraws the conversion claim, and it may
--   not touch a single key of the record other than the conversion bookkeeping.
--   A revert while the property stands, a revert that keeps conversionRecord,
--   a revert to any status but 'complete', or a revert that changes analysis,
--   families, dispositions or resolutions is refused.
--
--   `activityDropped` is stripped alongside `activity` / `activityCount`
--   because AcquisitionWorkspace.recordActivity writes all three as one
--   record; the three are the activity log, not the record of the acquisition.
--
-- AUTHORIZATION MATRIX (as enforced after this file; verified by
-- tools/verify-migration-036.js on a throwaway cluster)
-- --------------------------------------------------------------------------
--   On a CONVERTED episode           owner  member  admin  anon     service role
--   SELECT review/docs/fams/decs     allow  allow   allow  denied¹  allow
--   UPDATE review data.analysis      REFUSE REFUSE  REFUSE denied   REFUSE
--   UPDATE review status / name      REFUSE REFUSE  REFUSE denied   REFUSE
--   legacy revert (exact shape)      allow  allow   allow  denied   allow
--   DELETE review (direct)           REFUSE REFUSE  REFUSE denied   REFUSE
--   INSERT/UPDATE/DELETE document    REFUSE REFUSE  REFUSE denied   REFUSE
--   INSERT/UPDATE family             REFUSE REFUSE  REFUSE denied   REFUSE
--   DELETE family                    denied² denied² denied² denied REFUSE
--   INSERT decision                  REFUSE REFUSE  REFUSE denied   REFUSE
--   UPDATE/DELETE decision           REFUSE³ REFUSE³ REFUSE³ denied REFUSE³
--   delete_prospect_acquisition      refuse refuse  refuse refuse   n/a
--   INSERT property_events           allow  allow   allow  none     allow
--
--   On an OPEN episode: every write above behaves exactly as before this file
--   (allow for owner / member / admin / service role; anon zero rows);
--   delete_prospect_acquisition keeps 034's rule (admin, no confirmed record).
--
--   ¹ anon: no privilege after this file (was: zero rows under RLS).
--   ² authenticated never held DELETE on families (024b); unchanged.
--   ³ 026's append-only triggers; unchanged.
--
-- WHAT THIS DOES NOT DO
-- ---------------------
--   No RLS policy, membership predicate, column, constraint, index or data
--   change. No change to acquire_property, begin_acquisition,
--   delete_prospect_acquisition, the lifecycle triggers, property_events,
--   tenants, payments, settlement, XRPL or auth. No repair of any row. The
--   `leases` storage bucket is out of scope. A future migration that needs to
--   correct a converted episode must do so deliberately, by lifting the freeze
--   in a transaction (ALTER TABLE … DISABLE TRIGGER), on the record.
--
-- ADDITIVE and RE-RUNNABLE: three functions (create or replace), four triggers
-- (drop if exists, create), two revokes.
-- ============================================================================

-- ── 1 · the predicate ────────────────────────────────────────────────────────
-- SECURITY DEFINER so the trigger can read the review's status whatever RLS
-- shows the caller; STABLE so it is evaluated once per row.
create or replace function public._acq_episode_frozen(p_review_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select r.status = 'converted' from public.acquisition_reviews r where r.id = p_review_id),
    false);
$$;
revoke all on function public._acq_episode_frozen(uuid) from public, anon;
grant execute on function public._acq_episode_frozen(uuid) to authenticated, service_role;

-- ── 2 · the children ─────────────────────────────────────────────────────────
create or replace function public.acq_children_frozen()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_review uuid;
  v_new    jsonb;
  v_old    jsonb;
  -- The columns a foreign key's own ON DELETE SET NULL may clear.
  c_fk     constant text[] := array['family_id', 'parent_document_id', 'superseded_by_document_id', 'source_document_id'];
begin
  v_review := case when tg_op = 'INSERT' then new.review_id else old.review_id end;
  if not public._acq_episode_frozen(v_review) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'DELETE' then
    -- Depth 1 is a statement someone ran. Depth 2+ is another trigger driving,
    -- which for these tables means a foreign key's own cascade.
    if pg_trigger_depth() > 1 then
      return old;
    end if;
    raise exception '% row % belongs to converted acquisition review % and cannot be deleted',
      tg_table_name, old.id, v_review
      using errcode = 'integrity_constraint_violation',
            hint = 'This acquisition is closed. Its record is read-only.';
  end if;

  if tg_op = 'UPDATE' then
    if pg_trigger_depth() > 1 then
      v_new := to_jsonb(new) - c_fk - 'updated_at';
      v_old := to_jsonb(old) - c_fk - 'updated_at';
      if v_new = v_old and (
           select coalesce(bool_and(
             to_jsonb(new) -> k is null
             or jsonb_typeof(to_jsonb(new) -> k) = 'null'
             or to_jsonb(new) -> k = to_jsonb(old) -> k), true)
           from unnest(c_fk) k) then
        return new;   -- a foreign key's own SET NULL, nothing else
      end if;
    end if;
    raise exception '% row % belongs to converted acquisition review % and cannot be changed',
      tg_table_name, old.id, v_review
      using errcode = 'integrity_constraint_violation',
            hint = 'This acquisition is closed. Its record is read-only.';
  end if;

  -- INSERT
  raise exception 'a new % row cannot be added to converted acquisition review %',
    tg_table_name, v_review
    using errcode = 'integrity_constraint_violation',
          hint = 'This acquisition is closed. Its record is read-only.';
end;
$$;

drop trigger if exists acq_children_frozen on public.acquisition_documents;
create trigger acq_children_frozen
  before insert or update or delete on public.acquisition_documents
  for each row execute function public.acq_children_frozen();

drop trigger if exists acq_children_frozen on public.acquisition_document_families;
create trigger acq_children_frozen
  before insert or update or delete on public.acquisition_document_families
  for each row execute function public.acq_children_frozen();

drop trigger if exists acq_children_frozen on public.acquisition_term_decisions;
create trigger acq_children_frozen
  before insert or update or delete on public.acquisition_term_decisions
  for each row execute function public.acq_children_frozen();

-- ── 3 · the review ───────────────────────────────────────────────────────────
create or replace function public.acq_reviews_frozen()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  -- The conversion bookkeeping the legacy revert rewrites; nothing else may move.
  c_strip  constant text[] := array['conversionRecord', 'conversionHistory', 'activity', 'activityCount', 'activityDropped', 'stage'];
  v_prop   text;
begin
  if old.status is distinct from 'converted' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  v_prop := coalesce(old.property_id::text, old.data -> 'conversionRecord' ->> 'propertyId', '<unknown>');

  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then
      return old;   -- the auth.users cascade
    end if;
    raise exception 'acquisition review % is converted and cannot be deleted', old.id
      using errcode = 'integrity_constraint_violation',
            hint = 'This acquisition is closed; it acquired property ' || v_prop || '. Its record is read-only.';
  end if;

  -- UPDATE, shape 1: the property row was deleted and its foreign key set
  -- property_id to null. Only inside a trigger, only that one column.
  if pg_trigger_depth() > 1
     and old.property_id is not null and new.property_id is null
     and (to_jsonb(new) - 'property_id' - 'updated_at') = (to_jsonb(old) - 'property_id' - 'updated_at') then
    return new;
  end if;

  -- UPDATE, shape 2: the legacy revert, exactly.
  if old.property_id is null and new.property_id is null
     and new.status = 'complete'
     and not (coalesce(new.data, '{}'::jsonb) ? 'conversionRecord')
     and new.id = old.id
     and new.user_id = old.user_id
     and new.name is not distinct from old.name
     and new.created_at = old.created_at
     and new.converted_at is not distinct from old.converted_at
     and (coalesce(new.data, '{}'::jsonb) - c_strip) = (coalesce(old.data, '{}'::jsonb) - c_strip) then
    return new;
  end if;

  raise exception 'acquisition review % is converted; its record is read-only', old.id
    using errcode = 'integrity_constraint_violation',
          hint = 'This acquisition is closed; it acquired property ' || v_prop || '. Nothing on the review, its documents, its leaseholds or its decisions can be changed.';
end;
$$;

drop trigger if exists acq_reviews_frozen on public.acquisition_reviews;
create trigger acq_reviews_frozen
  before update or delete on public.acquisition_reviews
  for each row execute function public.acq_reviews_frozen();

-- ── 4 · anon hygiene ─────────────────────────────────────────────────────────
-- RLS already returned anon zero rows on both tables; the privileges 006 and
-- 023 left in place are withdrawn so that no future policy can widen them.
revoke all on table public.acquisition_reviews   from anon;
revoke all on table public.acquisition_documents from anon;
