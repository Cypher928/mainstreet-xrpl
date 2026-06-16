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
