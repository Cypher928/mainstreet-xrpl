-- ─── 023_property_lifecycle — Phase 0, P0.2 ─────────────────────────────────
--
-- A property has a lifecycle STAGE. An acquisition is a property at a
-- pre-acquisition stage — the same row, the same id, the same documents — and
-- it becomes part of the managed portfolio by a transition to `acquired`,
-- never by copying or rebuilding the property (Decision 1).
--
--   prospect → under_review → due_diligence → acquired     the deal path
--   any pre-acquisition stage → passed                     declined; file kept
--   passed → prospect                                      reopened
--
-- `acquired` is where every existing property already is. The column defaults
-- to it, so this migration changes NOTHING for any row that exists today: no
-- backfill, no data migration, no property moves. acquired_at is left NULL for
-- those rows — the date they were acquired is unknown, and writing now() there
-- would be inventing a fact.
--
-- The rule every aggregate reads (property-lifecycle.js): "the portfolio" is
-- stage = acquired AND archived_at IS NULL. Archive (010) remains the exit for
-- a managed property; a stage never sends an acquired property backwards.
--
-- acquisition_reviews.property_id: the legacy review table gains a nullable
-- link to the property a review is about. Legacy reviews keep working exactly
-- as before; nothing populates the column here. Their Convert path is untouched.
--
-- NUMBERED 023, APPLIED AFTER 024. The number is the file's identity; the
-- order is the plan's (024 first, so nothing ships single-user).
-- Requires 010 (archived_at) — the partial index below names it.
--
-- PILOT ONLY. Same marker guard as 012/014/024. Idempotent. Rollback:
-- 023_property_lifecycle_rollback.sql.

begin;

-- ── Guard ──────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from public.properties
    where id = 'fd9c09b1-b657-4c58-9999-c3cce28e7600'
  ) then
    raise exception
      'REFUSING TO RUN: pilot marker property not found. This does not appear to be the pilot project (bhmktujbxdbvdmpybmad). 023 must never be applied to production.';
  end if;
end $$;

-- ── The stage ──────────────────────────────────────────────────────────────
alter table public.properties
  add column if not exists lifecycle_stage text not null default 'acquired';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'properties_lifecycle_stage_check'
      and conrelid = 'public.properties'::regclass
  ) then
    alter table public.properties
      add constraint properties_lifecycle_stage_check
      check (lifecycle_stage in ('prospect', 'under_review', 'due_diligence', 'acquired', 'passed'));
  end if;
end $$;

alter table public.properties add column if not exists acquired_at      timestamptz;
alter table public.properties add column if not exists passed_at        timestamptz;
alter table public.properties add column if not exists stage_changed_by uuid references auth.users(id) on delete set null;
alter table public.properties add column if not exists stage_changed_at timestamptz;

comment on column public.properties.lifecycle_stage is
  'P0.2: prospect | under_review | due_diligence | acquired | passed. Only acquired (and not archived) is the managed portfolio. An acquisition is this row at an earlier stage; it becomes a managed property by transition, never by copying.';
comment on column public.properties.acquired_at is
  'P0.2: when the stage became acquired. NULL for properties that predate the stage model — unknown, not fabricated.';
comment on column public.properties.passed_at is
  'P0.2: when the deal was passed on. The file (documents, notes, abstract) is kept.';
comment on column public.properties.stage_changed_by is
  'P0.2: the user who made the most recent stage change.';
comment on column public.properties.stage_changed_at is
  'P0.2: when the most recent stage change was made.';

-- The portfolio read is "this owner's acquired, active properties"; the
-- acquisitions read is "this owner's pre-acquisition properties". One index
-- on the pair serves both. Partial on archived_at (010): archived rows are the
-- rare case and are read only from the explicit Archived view.
create index if not exists properties_user_stage_active_idx
  on public.properties (user_id, lifecycle_stage)
  where archived_at is null;

-- ── The legacy review table learns which property it is about ──────────────
alter table public.acquisition_reviews
  add column if not exists property_id uuid references public.properties(id) on delete set null;
create index if not exists acq_reviews_property_id_idx
  on public.acquisition_reviews (property_id);
comment on column public.acquisition_reviews.property_id is
  'P0.2: the property this legacy review concerns, when known. Nullable; nothing here populates it. The legacy Convert path is unchanged.';

-- RLS: no policy changes. lifecycle_stage is a column on a row the existing
-- properties_owner_all policy (024: owner OR active member) already governs.
-- A stage change is an UPDATE by someone that policy admits — no new policy,
-- and no new way to reach another organisation's rows.

commit;

-- ── Verify (run after commit; every line should hold) ──────────────────────
-- select lifecycle_stage, count(*) from public.properties group by 1;            -- expect: acquired = every row
-- select count(*) as with_acquired_at from public.properties where acquired_at is not null;   -- expect 0 (nothing fabricated)
-- select conname from pg_constraint where conname = 'properties_lifecycle_stage_check';       -- expect 1 row
-- select count(*) from public.acquisition_reviews where property_id is not null;              -- expect 0
-- select indexname from pg_indexes where indexname in ('properties_user_stage_active_idx','acq_reviews_property_id_idx'); -- expect 2
