-- ─── acquisition_reviews migration ───────────────────────────────────────────
-- Dedicated table for Acquisition Due Diligence reviews.
-- Completely isolated from the properties/tenants/cam_reconciliations workflow.
-- One row per deal. All extracted state lives in the data jsonb column.
--
-- Run once in Supabase: Settings → SQL Editor → New query → paste → Run.
-- Safe to re-run (IF NOT EXISTS / OR REPLACE throughout).
-- Rollback: drop table public.acquisition_reviews cascade;

-- ── Table ──────────────────────────────────────────────────────────────────────

create table if not exists public.acquisition_reviews (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users(id) on delete cascade,
  name        text        not null,
  status      text        not null default 'draft'
                check (status in ('draft', 'analyzing', 'complete')),
  data        jsonb       not null default '{}',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ── Indexes ────────────────────────────────────────────────────────────────────

create index if not exists acq_reviews_user_id_idx
  on public.acquisition_reviews (user_id);

create index if not exists acq_reviews_created_at_idx
  on public.acquisition_reviews (created_at desc);

create index if not exists acq_reviews_status_idx
  on public.acquisition_reviews (user_id, status);

-- ── Auto-update updated_at ────────────────────────────────────────────────────

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists acq_reviews_updated_at on public.acquisition_reviews;
create trigger acq_reviews_updated_at
  before update on public.acquisition_reviews
  for each row execute function public.set_updated_at();

-- ── Row-Level Security ─────────────────────────────────────────────────────────

alter table public.acquisition_reviews enable row level security;

grant usage  on schema public to authenticated;
grant usage  on schema public to service_role;
grant select, insert, update, delete on public.acquisition_reviews to authenticated;
grant select, insert, update, delete on public.acquisition_reviews to service_role;

-- Owner policy: users can only read/write their own reviews.

drop policy if exists "acq_reviews_owner_all"        on public.acquisition_reviews;
drop policy if exists "acq_reviews_service_role_all" on public.acquisition_reviews;

create policy "acq_reviews_owner_all"
  on public.acquisition_reviews
  for all to authenticated
  using  (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "acq_reviews_service_role_all"
  on public.acquisition_reviews
  for all to service_role using (true) with check (true);

-- ── Verify ─────────────────────────────────────────────────────────────────────

select count(*) from public.acquisition_reviews;
