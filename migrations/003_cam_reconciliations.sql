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
