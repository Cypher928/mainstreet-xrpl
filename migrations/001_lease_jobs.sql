-- ─── lease_jobs migration ──────────────────────────────────────────────────────
-- Run once in Supabase: Settings → SQL Editor → New query → paste → Run
-- Safe to re-run (uses IF NOT EXISTS / OR REPLACE / DROP IF EXISTS)
-- Do NOT modify existing lease/property/tenant tables.

-- ── Table ──────────────────────────────────────────────────────────────────────

create table if not exists public.lease_jobs (
  id                      uuid          primary key default gen_random_uuid(),
  created_at              timestamptz   not null default now(),
  updated_at              timestamptz   not null default now(),

  -- Lifecycle
  status                  text          not null default 'queued'
    check (status in ('queued','processing','review_required','completed','failed')),
  stage                   text          not null default 'upload'
    check (stage in ('upload','OCR','extraction','normalize','confidence','manual_review','persistence','completed')),
  progress                integer       not null default 0
    check (progress >= 0 and progress <= 100),

  -- File identity
  file_name               text,
  file_size               bigint,

  -- Relationships
  property_id             uuid          references public.properties(id) on delete cascade,
  tenant_id               uuid          references public.tenants(id)    on delete set null,

  -- Extraction results
  confidence_level        text          check (confidence_level in ('high','medium','low','failed')),
  confidence_score        integer       check (confidence_score >= 0 and confidence_score <= 100),
  extraction_route        text          check (extraction_route in ('text','pdf-direct','unknown')),

  -- Error tracking
  error_message           text,

  -- Timing
  processing_started_at   timestamptz,
  processing_completed_at timestamptz,

  -- Retry tracking
  retry_count             integer       not null default 0,

  -- Summarized diagnostics — NOT raw OCR text
  debug_summary           jsonb
);

-- ── Indexes ────────────────────────────────────────────────────────────────────

create index if not exists lease_jobs_property_id_idx
  on public.lease_jobs (property_id);

create index if not exists lease_jobs_status_idx
  on public.lease_jobs (status);

create index if not exists lease_jobs_tenant_id_idx
  on public.lease_jobs (tenant_id)
  where tenant_id is not null;

create index if not exists lease_jobs_created_at_idx
  on public.lease_jobs (created_at desc);

create index if not exists lease_jobs_property_status_idx
  on public.lease_jobs (property_id, status);

-- ── Auto-update updated_at ─────────────────────────────────────────────────────

create or replace function public.lease_jobs_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists lease_jobs_updated_at on public.lease_jobs;
create trigger lease_jobs_updated_at
  before update on public.lease_jobs
  for each row execute procedure public.lease_jobs_set_updated_at();

-- ── Row-Level Security ─────────────────────────────────────────────────────────

alter table public.lease_jobs enable row level security;

-- ── Explicit grants (required by newer Supabase projects) ──────────────────────

grant usage  on schema public to authenticated;
grant usage  on schema public to service_role;
grant select, insert, update, delete on public.lease_jobs to authenticated;
grant select, insert, update, delete on public.lease_jobs to service_role;

-- ── RLS Policies ───────────────────────────────────────────────────────────────

-- Authenticated users: can access any job (tighten by joining properties.user_id
-- once you add a user_id column to properties, e.g.  WHERE property_id IN
-- (SELECT id FROM public.properties WHERE user_id = auth.uid()) )
drop policy if exists "lease_jobs_authenticated_all"  on public.lease_jobs;
create policy "lease_jobs_authenticated_all"
  on public.lease_jobs
  for all
  to authenticated
  using  (auth.uid() is not null)
  with check (auth.uid() is not null);

-- Service role: full bypass for server-side operations
drop policy if exists "lease_jobs_service_role_all" on public.lease_jobs;
create policy "lease_jobs_service_role_all"
  on public.lease_jobs
  for all
  to service_role
  using  (true)
  with check (true);
