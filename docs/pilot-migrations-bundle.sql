-- ============================================================================
-- MainStreet PILOT project — one-paste setup bundle
-- Run in: pilot Supabase project → SQL Editor → New query → paste all → Run.
-- Idempotent (safe to re-run). Concatenates migrations 001-009 in order and
-- creates the two PUBLIC storage buckets the app uploads to (leases, invoices).
-- Do NOT run this against production.
-- ============================================================================


-- ─────────────────────────────────────────────────────────────────────────
-- migrations/001_lease_jobs.sql
-- ─────────────────────────────────────────────────────────────────────────
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

-- ─────────────────────────────────────────────────────────────────────────
-- migrations/002_evidence_audit_tables.sql
-- ─────────────────────────────────────────────────────────────────────────
-- tenant_field_evidence + tenant_review_audit
-- Phase 1 normalization. Safe to re-run (IF NOT EXISTS throughout).
-- Rollback: drop table public.tenant_review_audit cascade;
--           drop table public.tenant_field_evidence cascade;


-- TABLE: tenant_field_evidence

create table if not exists public.tenant_field_evidence (
  id                       uuid        primary key default gen_random_uuid(),
  property_id              uuid        not null references public.properties(id) on delete cascade,
  tenant_id                text        not null,
  field_key                text        not null,
  value                    text,
  confidence_status        text        check (confidence_status in ('verified','estimated','missing')),
  confidence_note          text,
  source_file              text,
  source_page              integer,
  extraction_id            text,
  extraction_version       text,
  reviewer_uid             text,
  reviewer_email           text,
  reviewed_at              timestamptz,
  approved                 boolean     not null default false,
  manually_edited          boolean     not null default false,
  original_extracted_value text,
  created_at               timestamptz not null default now(),
  constraint tenant_field_evidence_dedup unique (tenant_id, field_key, reviewed_at)
);

create index if not exists tfe_property_id_idx       on public.tenant_field_evidence (property_id);
create index if not exists tfe_tenant_id_idx         on public.tenant_field_evidence (tenant_id);
create index if not exists tfe_field_key_idx         on public.tenant_field_evidence (field_key);
create index if not exists tfe_created_at_idx        on public.tenant_field_evidence (created_at desc);
create index if not exists tfe_tenant_field_time_idx on public.tenant_field_evidence (tenant_id, field_key, created_at desc);


-- TABLE: tenant_review_audit

create table if not exists public.tenant_review_audit (
  id                  uuid        primary key default gen_random_uuid(),
  property_id         uuid        not null references public.properties(id) on delete cascade,
  tenant_id           text        not null,
  field_key           text,
  action              text        not null,
  label               text,
  severity            text        not null default 'info' check (severity in ('info','success','warning','error')),
  old_value           text,
  new_value           text,
  review_state_before text,
  review_state_after  text,
  reviewer_uid        text,
  reviewer_email      text,
  client_ts           timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  constraint tenant_review_audit_dedup unique (tenant_id, action, client_ts)
);

create index if not exists tra_property_id_idx on public.tenant_review_audit (property_id);
create index if not exists tra_tenant_id_idx   on public.tenant_review_audit (tenant_id);
create index if not exists tra_field_key_idx   on public.tenant_review_audit (field_key) where field_key is not null;
create index if not exists tra_created_at_idx  on public.tenant_review_audit (created_at desc);
create index if not exists tra_tenant_time_idx on public.tenant_review_audit (tenant_id, client_ts desc);


-- RLS

alter table public.tenant_field_evidence enable row level security;
alter table public.tenant_review_audit   enable row level security;

grant usage  on schema public to authenticated;
grant usage  on schema public to service_role;
grant select, insert, update, delete on public.tenant_field_evidence to authenticated;
grant select, insert, update, delete on public.tenant_field_evidence to service_role;
grant select, insert, update, delete on public.tenant_review_audit   to authenticated;
grant select, insert, update, delete on public.tenant_review_audit   to service_role;


-- POLICIES: tenant_field_evidence
-- Uses IN subquery to avoid alias.id dot-notation (rendered incorrectly by some tools).

drop policy if exists "tfe_owner_all"        on public.tenant_field_evidence;
drop policy if exists "tfe_service_role_all" on public.tenant_field_evidence;

create policy "tfe_owner_all"
  on public.tenant_field_evidence
  for all to authenticated
  using (
    property_id in (
      select id from public.properties
      where user_id = auth.uid()
    )
  )
  with check (
    property_id in (
      select id from public.properties
      where user_id = auth.uid()
    )
  );

create policy "tfe_service_role_all"
  on public.tenant_field_evidence
  for all to service_role using (true) with check (true);


-- POLICIES: tenant_review_audit

drop policy if exists "tra_owner_all"        on public.tenant_review_audit;
drop policy if exists "tra_service_role_all" on public.tenant_review_audit;

create policy "tra_owner_all"
  on public.tenant_review_audit
  for all to authenticated
  using (
    property_id in (
      select id from public.properties
      where user_id = auth.uid()
    )
  )
  with check (
    property_id in (
      select id from public.properties
      where user_id = auth.uid()
    )
  );

create policy "tra_service_role_all"
  on public.tenant_review_audit
  for all to service_role using (true) with check (true);


-- VERIFY

select count(*) from public.tenant_field_evidence;
select count(*) from public.tenant_review_audit;

-- ─────────────────────────────────────────────────────────────────────────
-- migrations/003_cam_reconciliations.sql
-- ─────────────────────────────────────────────────────────────────────────
-- ─── cam_reconciliations migration (Phase 21) ──────────────────────────────────
-- Normalized, queryable persistence for CAM reconciliation results.
-- One row per tenant per property per CAM year. The full reconciliation snapshot
-- still lives in properties.data.camReconciliation (blob) for offline resilience;
-- this table is the authoritative, cross-year-queryable record.
--
-- Run once in Supabase: Settings → SQL Editor → New query → paste → Run.
-- Safe to re-run (IF NOT EXISTS / OR REPLACE / DROP IF EXISTS throughout).
-- Rollback: drop table public.cam_reconciliations cascade;

-- ── Table ──────────────────────────────────────────────────────────────────────

create table if not exists public.cam_reconciliations (
  id                uuid        primary key default gen_random_uuid(),
  property_id       uuid        not null references public.properties(id) on delete cascade,
  tenant_id         uuid,                         -- references the tenant row UUID
  tenant_name       text,
  year              integer     not null,
  actual_cam        numeric,                      -- amount allocated to the tenant this run
  expected_cam      numeric,                      -- lease cap / expected amount, when known
  variance          numeric,                      -- actual_cam - expected_cam (precomputed)
  allocated_amount  numeric,                      -- alias of actual_cam from ReconciliationResult
  pro_rata_percent  numeric,                      -- tenant share basis (sqft %)
  total_expenses    numeric,                      -- total CAM pool for the run (same for all rows)
  reconciled_at     timestamptz,                  -- when the reconciliation run was performed
  created_at        timestamptz not null default now()
);

-- ── Indexes ────────────────────────────────────────────────────────────────────

create index if not exists cam_recon_property_id_idx
  on public.cam_reconciliations (property_id);

create index if not exists cam_recon_property_year_idx
  on public.cam_reconciliations (property_id, year);

create index if not exists cam_recon_tenant_id_idx
  on public.cam_reconciliations (tenant_id)
  where tenant_id is not null;

create index if not exists cam_recon_created_at_idx
  on public.cam_reconciliations (created_at desc);

-- ── Row-Level Security ─────────────────────────────────────────────────────────

alter table public.cam_reconciliations enable row level security;

grant usage  on schema public to authenticated;
grant usage  on schema public to service_role;
grant select, insert, update, delete on public.cam_reconciliations to authenticated;
grant select, insert, update, delete on public.cam_reconciliations to service_role;

-- POLICIES
-- Owner access scoped via properties.user_id (mirrors tenant_field_evidence).
-- Writes/reads from the /api/cam-reconciliations proxy use the service role and
-- bypass RLS; this owner policy enables direct authenticated-client access too
-- (e.g. the DB Health diagnostic) without leaking other tenants' data.

drop policy if exists "cam_recon_owner_all"        on public.cam_reconciliations;
drop policy if exists "cam_recon_service_role_all" on public.cam_reconciliations;

create policy "cam_recon_owner_all"
  on public.cam_reconciliations
  for all to authenticated
  using (
    property_id in (
      select id from public.properties
      where user_id = auth.uid()
    )
  )
  with check (
    property_id in (
      select id from public.properties
      where user_id = auth.uid()
    )
  );

create policy "cam_recon_service_role_all"
  on public.cam_reconciliations
  for all to service_role using (true) with check (true);

-- ── Verify ─────────────────────────────────────────────────────────────────────

select count(*) from public.cam_reconciliations;

-- ─────────────────────────────────────────────────────────────────────────
-- migrations/004_lease_intelligence.sql
-- ─────────────────────────────────────────────────────────────────────────
-- ─── lease_documents migration (Phase 22A) ──────────────────────────────────
-- Persists OCR/extracted lease text after the extraction pipeline completes.
-- One row per uploaded lease file per property. Tenant association is optional
-- (some uploads may not yield a recognized tenant until after review).
--
-- Run once in Supabase: Settings → SQL Editor → New query → paste → Run.
-- Safe to re-run (IF NOT EXISTS / OR REPLACE / DROP IF EXISTS throughout).
-- Rollback: drop table public.lease_documents cascade;

-- ── Table ──────────────────────────────────────────────────────────────────────

create table if not exists public.lease_documents (
  id                uuid        primary key default gen_random_uuid(),
  property_id       uuid        not null references public.properties(id) on delete cascade,
  tenant_id         uuid,                         -- references tenant row UUID (nullable until confirmed)
  tenant_name       text,                         -- denormalized for display without join
  file_name         text        not null,
  file_url          text,                         -- Supabase storage public URL
  extracted_text    text,                         -- full OCR / PDF text layer
  parsing_status    text        not null default 'pending',  -- pending | success | partial | failed
  extraction_model  text,                         -- e.g. 'claude-3-5-sonnet-20241022'
  used_pdf_direct   boolean     not null default false,      -- true = vision path, false = text path
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- ── Indexes ────────────────────────────────────────────────────────────────────

create index if not exists lease_docs_property_id_idx
  on public.lease_documents (property_id);

create index if not exists lease_docs_property_tenant_idx
  on public.lease_documents (property_id, tenant_id)
  where tenant_id is not null;

create index if not exists lease_docs_created_at_idx
  on public.lease_documents (created_at desc);

-- ── Row-Level Security ─────────────────────────────────────────────────────────

alter table public.lease_documents enable row level security;

grant usage  on schema public to authenticated;
grant usage  on schema public to service_role;
grant select, insert, update, delete on public.lease_documents to authenticated;
grant select, insert, update, delete on public.lease_documents to service_role;

-- POLICIES
-- Owner access scoped via properties.user_id — same pattern as cam_reconciliations.
-- API proxy uses service_role and bypasses RLS. Direct authenticated-client access
-- (e.g. Lease Center) uses the owner policy without leaking other users' documents.

drop policy if exists "lease_docs_owner_all"        on public.lease_documents;
drop policy if exists "lease_docs_service_role_all" on public.lease_documents;

create policy "lease_docs_owner_all"
  on public.lease_documents
  for all to authenticated
  using (
    property_id in (
      select id from public.properties
      where user_id = auth.uid()
    )
  )
  with check (
    property_id in (
      select id from public.properties
      where user_id = auth.uid()
    )
  );

create policy "lease_docs_service_role_all"
  on public.lease_documents
  for all to service_role using (true) with check (true);

-- ── updated_at trigger ─────────────────────────────────────────────────────────

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists lease_documents_updated_at on public.lease_documents;
create trigger lease_documents_updated_at
  before update on public.lease_documents
  for each row execute function public.set_updated_at();

-- ── Verify ─────────────────────────────────────────────────────────────────────

select count(*) from public.lease_documents;

-- ─────────────────────────────────────────────────────────────────────────
-- migrations/005_rls_hardening.sql
-- ─────────────────────────────────────────────────────────────────────────
-- ─── RLS Hardening migration ────────────────────────────────────────────────────
-- Fixes three RLS gaps identified in security audit:
--   1. properties table — no RLS (client-side .eq('user_id') was the only guard)
--   2. tenants table    — no RLS (all authenticated users could read/delete any tenant)
--   3. lease_jobs table — over-permissive: any auth user could access all jobs
--
-- SCHEMA DEPENDENCY: properties.user_id (uuid, references auth.users) predates this
-- migration and exists in the live schema. It was first used in script.js commit
-- 0a490fb (2026-05-03) and referenced without guards in migrations 002–004 before
-- this file was written. This migration does NOT add the column — it only adds RLS
-- policies that reference it. If applying to a fresh database, ensure the column
-- exists before running: ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS
-- user_id uuid references auth.users(id);
--
-- Safe to re-run (uses DROP IF EXISTS / OR REPLACE patterns).
-- Run in Supabase: Settings → SQL Editor → New query → paste → Run

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. PROPERTIES TABLE
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.properties enable row level security;

grant usage  on schema public to authenticated;
grant usage  on schema public to service_role;
grant select, insert, update, delete on public.properties to authenticated;
grant select, insert, update, delete on public.properties to service_role;

-- Owners can do anything with their own properties.
drop policy if exists "properties_owner_all"        on public.properties;
drop policy if exists "properties_service_role_all" on public.properties;

create policy "properties_owner_all"
  on public.properties
  for all
  to authenticated
  using  (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Service role (API proxy) bypasses RLS.
create policy "properties_service_role_all"
  on public.properties
  for all
  to service_role
  using  (true)
  with check (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. TENANTS TABLE
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.tenants enable row level security;

grant select, insert, update, delete on public.tenants to authenticated;
grant select, insert, update, delete on public.tenants to service_role;

-- Owners access tenants via their property ownership.
drop policy if exists "tenants_owner_all"        on public.tenants;
drop policy if exists "tenants_service_role_all" on public.tenants;

create policy "tenants_owner_all"
  on public.tenants
  for all
  to authenticated
  using (
    property_id in (
      select id from public.properties where user_id = auth.uid()
    )
  )
  with check (
    property_id in (
      select id from public.properties where user_id = auth.uid()
    )
  );

create policy "tenants_service_role_all"
  on public.tenants
  for all
  to service_role
  using  (true)
  with check (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. LEASE_JOBS TABLE — tighten over-permissive policy
-- ─────────────────────────────────────────────────────────────────────────────

-- Drop the old wide-open policy (auth.uid() is not null = any user sees all jobs).
drop policy if exists "lease_jobs_authenticated_all" on public.lease_jobs;

-- New policy: owners see only jobs tied to their properties.
create policy "lease_jobs_owner_all"
  on public.lease_jobs
  for all
  to authenticated
  using (
    property_id in (
      select id from public.properties where user_id = auth.uid()
    )
  )
  with check (
    property_id in (
      select id from public.properties where user_id = auth.uid()
    )
  );

-- ─────────────────────────────────────────────────────────────────────────
-- migrations/006_acquisition_reviews.sql
-- ─────────────────────────────────────────────────────────────────────────
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
                check (status in ('draft', 'analyzing', 'complete', 'converted')),
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

-- ─────────────────────────────────────────────────────────────────────────
-- migrations/007_fix_acq_review_status.sql
-- ─────────────────────────────────────────────────────────────────────────
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

-- ─────────────────────────────────────────────────────────────────────────
-- migrations/008_database_hardening.sql
-- ─────────────────────────────────────────────────────────────────────────
-- ─── 008_database_hardening.sql ──────────────────────────────────────────────
-- Production-safe hardening: additive-only changes, no downtime, no data risk.
-- Contains ONLY Fixes 1, 5, and 6 from the production verification audit.
-- Safe to re-run (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS throughout).
--
-- Deferred to separate migrations:
--   009_atomic_tenant_resync.sql — Fix 8 (atomic RPC + app code change)
--   Fixes 2/3/4 — require verification queries (see 008b_verification_queries.sql)
--   Fix 7      — requires maintenance window and DB backup (deferred indefinitely)
--
-- Run in Supabase: Settings → SQL Editor → New query → paste → Run.
-- ─────────────────────────────────────────────────────────────────────────────


-- ─── FIX 1: DB-H3 — Index on properties.user_id for RLS subquery performance ──
--
-- All five "owner" RLS policies use:
--   property_id IN (SELECT id FROM public.properties WHERE user_id = auth.uid())
--
-- Without this index, that subquery is a sequential scan of properties for every
-- row evaluated by the policy. Adding the index costs nothing (additive, no lock)
-- and makes all RLS-gated reads scale linearly with the user's properties rather
-- than with the total properties table size.

create index if not exists properties_user_id_idx
  on public.properties (user_id);

-- Verify: confirm index exists
-- select indexname, indexdef
-- from pg_indexes
-- where tablename = 'properties' and indexname = 'properties_user_id_idx';


-- ─── FIX 5: DB-H6 — Server-authoritative timestamp on tenant_review_audit ──────
--
-- client_ts is a client-generated ISO string used as the idempotency key for
-- retried audit writes (same client_ts = same event = ON CONFLICT DO NOTHING).
-- This design is intentional and correct for retry deduplication.
--
-- The gap: client_ts can be forged or backdated by a direct API call, and two
-- legitimate browser actions within the same millisecond collide on the dedup
-- constraint. Adding server_ts (DEFAULT now() at INSERT time, no override) gives
-- a tamper-evident, server-authoritative record for forensic queries without
-- changing the dedup behavior.
--
-- Existing rows receive server_ts = migration run time (acceptable — they predate
-- this column and their original server timestamps are unrecoverable).

alter table public.tenant_review_audit
  add column if not exists server_ts timestamptz not null default now();

create index if not exists tra_server_ts_idx
  on public.tenant_review_audit (server_ts desc);

-- Verify: confirm column and index exist
-- select column_name, data_type, column_default
-- from information_schema.columns
-- where table_name = 'tenant_review_audit' and column_name = 'server_ts';


-- ─── FIX 6: DB-C1 — Retention index for tenant_field_evidence ────────────────
--
-- The JSON blob caps evidence snapshots at 50 per field per tenant (script.js:3372).
-- The DB table has no equivalent cap. Every field review action inserts a new row
-- indefinitely (by design — one row per event, reviewed_at is the idempotency key).
--
-- This index enables efficient archival queries and per-(tenant, field) row counts
-- without full table scans. The actual archival job (retain the 100 most recent
-- rows per tenant+field, delete older ones) should run as a scheduled Supabase
-- Edge Function or pg_cron job using the query below.
--
-- The index tfe_tenant_field_time_idx already exists (migration 002, line 35).
-- This adds a composite covering index that includes created_at DESC for the
-- PARTITION BY / ORDER BY pattern used in the archival query.

create index if not exists tfe_tenant_field_retention_idx
  on public.tenant_field_evidence (tenant_id, field_key, created_at desc)
  include (id);

-- Recommended archival query (run via pg_cron or Supabase Edge Function):
-- Retains the 100 most recent rows per (tenant_id, field_key); deletes the rest.
--
-- delete from public.tenant_field_evidence
-- where id in (
--   select id from (
--     select id,
--            row_number() over (
--              partition by tenant_id, field_key
--              order by created_at desc
--            ) as rn
--     from public.tenant_field_evidence
--   ) ranked
--   where rn > 100
-- );
--
-- Row count check (run before scheduling archival to assess current volume):
-- select tenant_id, field_key, count(*) as row_count
-- from public.tenant_field_evidence
-- group by tenant_id, field_key
-- having count(*) > 100
-- order by row_count desc
-- limit 20;


-- ─── Verify all three fixes ───────────────────────────────────────────────────

select
  (select count(*) from pg_indexes
   where tablename = 'properties' and indexname = 'properties_user_id_idx')          as fix1_rls_index,
  (select count(*) from information_schema.columns
   where table_name = 'tenant_review_audit' and column_name = 'server_ts')           as fix5_server_ts,
  (select count(*) from pg_indexes
   where tablename = 'tenant_field_evidence'
     and indexname = 'tfe_tenant_field_retention_idx')                                as fix6_retention_idx;
-- Expected: 1 | 1 | 1

-- ─────────────────────────────────────────────────────────────────────────
-- migrations/009_atomic_tenant_resync.sql
-- ─────────────────────────────────────────────────────────────────────────
-- ─── 009_atomic_tenant_resync.sql ────────────────────────────────────────────
-- Fix 8 (DB-C2): Atomic tenant resync via stored procedure.
--
-- Problem: _doResyncTenantsToTable() in script.js issues a DELETE followed by
-- an INSERT as two separate round-trips with no transaction. If the INSERT fails
-- (network error, RLS rejection, malformed row), the DELETE has already committed
-- and the property has zero tenants in the database. The next loadPropertyData
-- call will prefer localStorage if it has more rows, but a concurrent session
-- that loads before the next localStorage-preferring load sees zero tenants and
-- can overwrite with an empty state.
--
-- Fix: A security-definer stored procedure that wraps DELETE + INSERT in a single
-- PL/pgSQL transaction block. If the INSERT raises an exception, the DELETE is
-- automatically rolled back by PostgreSQL. The app replaces the two-round-trip
-- pattern with a single db.rpc('resync_property_tenants', ...) call.
--
-- Safe to re-run (CREATE OR REPLACE).
-- Run in Supabase: Settings → SQL Editor → New query → paste → Run.
-- Companion app change: script.js _doResyncTenantsToTable() updated in same PR.
-- ─────────────────────────────────────────────────────────────────────────────


-- ─── Stored procedure ────────────────────────────────────────────────────────
--
-- Parameters:
--   p_property_id  uuid   — the property whose tenants are being replaced
--   p_rows         jsonb  — array of tenant row objects (see schema below)
--
-- Row object shape (matches what _doResyncTenantsToTable builds):
-- {
--   "id":          "<uuid>",
--   "name":        "<string|null>",
--   "sqft":        <number|null>,
--   "cap":         <number|null>,
--   "start_date":  "<date-string|null>",
--   "end_date":    "<date-string|null>",
--   "lease_url":   "<string|null>",
--   "lease_type":  "<string|null>"
-- }
--
-- Security: SECURITY DEFINER runs with the function owner's privileges.
-- The caller must be authenticated (enforced by the GRANT below). The
-- p_property_id is validated against the caller's RLS-visible properties
-- before the write proceeds, preventing a user from resyncing another
-- user's property.

create or replace function public.resync_property_tenants(
  p_property_id  uuid,
  p_rows         jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_owns_property boolean;
  v_inserted_count       integer := 0;
  v_row                  jsonb;
  v_tenant_id            uuid;
begin
  -- ── Authorization check ─────────────────────────────────────────────────
  -- Verify the calling user owns this property. This check runs with the
  -- function's elevated privileges but validates against the caller's uid.
  select exists(
    select 1 from public.properties
    where id = p_property_id
      and user_id = auth.uid()
  ) into v_caller_owns_property;

  if not v_caller_owns_property then
    raise exception 'Not authorized: caller does not own property %', p_property_id
      using errcode = 'insufficient_privilege';
  end if;

  -- ── Atomic replace ──────────────────────────────────────────────────────
  -- Both operations run in the same transaction. If the INSERT loop raises
  -- any exception, the DELETE is automatically rolled back.

  delete from public.tenants
  where property_id = p_property_id;

  -- Only insert if the array is non-empty
  if p_rows is not null and jsonb_array_length(p_rows) > 0 then
    for v_row in select * from jsonb_array_elements(p_rows)
    loop
      -- Skip rows without a name (mirrors the JS filter: t.tenant_name && !t._pendingJobReview)
      continue when v_row->>'name' is null or trim(v_row->>'name') = '';

      -- Parse UUID safely — null if malformed
      begin
        v_tenant_id := (v_row->>'id')::uuid;
      exception when invalid_text_representation then
        v_tenant_id := null;
      end;

      insert into public.tenants (
        id,
        property_id,
        name,
        sqft,
        cap,
        start_date,
        end_date,
        lease_url,
        lease_type
      ) values (
        coalesce(v_tenant_id, gen_random_uuid()),
        p_property_id,
        nullif(trim(v_row->>'name'), ''),
        (v_row->>'sqft')::numeric,
        (v_row->>'cap')::numeric,
        nullif(v_row->>'start_date', '')::date,
        nullif(v_row->>'end_date',   '')::date,
        nullif(v_row->>'lease_url',  ''),
        nullif(v_row->>'lease_type', '')
      )
      on conflict (id) do update set
        name       = excluded.name,
        sqft       = excluded.sqft,
        cap        = excluded.cap,
        start_date = excluded.start_date,
        end_date   = excluded.end_date,
        lease_url  = excluded.lease_url,
        lease_type = excluded.lease_type;

      v_inserted_count := v_inserted_count + 1;
    end loop;
  end if;

  return jsonb_build_object(
    'ok',            true,
    'property_id',   p_property_id,
    'inserted',      v_inserted_count
  );

exception
  when insufficient_privilege then
    return jsonb_build_object('ok', false, 'error', sqlerrm, 'code', 'not_authorized');
  when others then
    -- Re-raise so the DELETE rolls back automatically
    raise;
end;
$$;


-- ─── Grants ──────────────────────────────────────────────────────────────────

-- Authenticated users can call the function; SECURITY DEFINER handles the rest.
grant execute on function public.resync_property_tenants(uuid, jsonb) to authenticated;

-- Service role retains full access
grant execute on function public.resync_property_tenants(uuid, jsonb) to service_role;


-- ─── Verify ──────────────────────────────────────────────────────────────────

select
  routine_name,
  security_type,
  routine_definition is not null as has_body
from information_schema.routines
where routine_schema = 'public'
  and routine_name = 'resync_property_tenants';
-- Expected: routine_name='resync_property_tenants', security_type='DEFINER', has_body=true


-- ─── Rollback ────────────────────────────────────────────────────────────────
-- drop function if exists public.resync_property_tenants(uuid, jsonb);


-- ─────────────────────────────────────────────────────────────────────────
-- Storage buckets (public — uploads return /object/public/ URLs; see api/upload.js)
-- ─────────────────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('leases', 'leases', true), ('invoices', 'invoices', true)
on conflict (id) do update set public = excluded.public;
