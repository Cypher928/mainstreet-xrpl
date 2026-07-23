-- ─── 000_base_schema.sql — base properties + tenants tables ────────────────────
-- These two tables predate the numbered migrations (they were created out-of-band
-- in the original production project), so migrations 001-009 only reference them
-- as foreign keys and never create them. A FRESH project (e.g. the pilot) must
-- create them FIRST or 001 fails with "relation public.properties does not exist".
--
-- Columns/types are reconstructed from the app's own writes and the resync RPC:
--   properties upsert  → { id, user_id, name, sqft, data }         (script.js:15449)
--   tenants insert     → id, property_id, name, sqft, cap,          (009 RPC:97-116)
--                        start_date, end_date, lease_url, lease_type
-- RLS is intentionally NOT enabled here — migration 005 enables it and defines the
-- owner/service-role policies. Safe to re-run (IF NOT EXISTS throughout).

create extension if not exists pgcrypto;   -- gen_random_uuid()

-- ── properties ─────────────────────────────────────────────────────────────────
create table if not exists public.properties (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        references auth.users(id) on delete cascade,
  name       text,
  sqft       numeric,
  data       jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists properties_user_id_idx on public.properties (user_id);

-- ── tenants ────────────────────────────────────────────────────────────────────
create table if not exists public.tenants (
  id          uuid        primary key default gen_random_uuid(),
  property_id uuid        references public.properties(id) on delete cascade,
  name        text,
  sqft        numeric,
  cap         numeric,
  start_date  date,
  end_date    date,
  lease_url   text,
  lease_type  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists tenants_property_id_idx on public.tenants (property_id);
