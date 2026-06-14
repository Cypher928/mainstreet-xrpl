-- ─── Fix acquisition_reviews status constraint ────────────────────────────────
-- Migration 006 defined status CHECK as ('draft', 'analyzing', 'complete').
-- The Convert-to-Property flow sets status='converted', which violates the
-- constraint and causes every conversion save to fail silently.
--
-- Run once in Supabase: Settings → SQL Editor → New query → paste → Run.
-- Safe to re-run (DROP CONSTRAINT IF EXISTS / ADD CONSTRAINT).

alter table public.acquisition_reviews
  drop constraint if exists acquisition_reviews_status_check;

alter table public.acquisition_reviews
  add constraint acquisition_reviews_status_check
    check (status in ('draft', 'analyzing', 'complete', 'converted'));

-- Verify: this should return 0 rows (no invalid status values in existing data)
select count(*) as invalid_status_count
from public.acquisition_reviews
where status not in ('draft', 'analyzing', 'complete', 'converted');
