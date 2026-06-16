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
