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
