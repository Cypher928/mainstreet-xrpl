-- ============================================================================
-- 022_payment_management_rollback.sql
-- ============================================================================
-- TARGET: PILOT PROJECT ONLY (bhmktujbxdbvdmpybmad).
--
-- DESTRUCTIVE. Dropping these tables destroys payment records, which are
-- financial history — the one category of data this whole design exists to
-- preserve. Export first if anything real has been recorded:
--
--   select * from public.payments;
--   select * from public.payment_sources;
--   select * from public.payment_settlements;
--   select * from public.payment_events;
--
-- Safe to run unconditionally only while the tables are still inert — that is,
-- before Phase 1b gives them a write path and before any real payment exists.
-- ============================================================================

-- ─── Procedures ──────────────────────────────────────────────────────────────
drop function if exists public.payment_dispute_resolve(uuid,uuid,text,text);
drop function if exists public.payment_dispute_open(uuid,uuid,text,text);
drop function if exists public.payment_cancel(uuid,uuid,text,text);
drop function if exists public.payment_void_settlement(uuid,uuid,text,text);
drop function if exists public.payment_record_settlement(uuid,uuid,numeric,timestamptz,text,text,text,text);
drop function if exists public.payment_issue(uuid,uuid,text,text,date,text);
drop function if exists public.payment_authorize(uuid,uuid,text,text);
drop function if exists public.payment_create(uuid,uuid,integer,uuid,numeric,text,uuid,text,text,integer);

drop function if exists public._payment_replay(uuid,uuid);
drop function if exists public._payment_assert_owner(uuid);
drop function if exists public._payment_derive_state(uuid);
drop function if exists public._payment_settled_total(uuid);

-- ─── View, trigger, tables ───────────────────────────────────────────────────
drop view if exists public.payment_balances;

drop trigger if exists payments_immutable on public.payments;
drop function if exists public._payments_immutable_guard();

-- Order matters: children before parent.
drop table if exists public.payment_events;
drop table if exists public.payment_settlements;
drop table if exists public.payment_sources;
drop table if exists public.payments;


-- ═══ RESTORE MIGRATION 021's PROCEDURE ═══════════════════════════════════════
-- 022 replaced resync_property_tenants to add a payments clause to the tenant
-- retention predicate. With public.payments gone that body no longer compiles,
-- so the 021 body is restored verbatim here — including its own safety
-- behaviour: ownership check, empty-roster no-op, no_usable_rows guard, refusal
-- to mint ids server-side, upsert, and retention of tenants referenced by a
-- reconciliation or a piece of evidence.
--
-- This is a restore, NOT a reversion to 009. The destructive
-- delete-by-property that 009 carried does not come back.

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
  v_upserted   integer := 0;
  v_skipped    integer := 0;
  v_deleted    integer := 0;
  v_retained   integer := 0;
  v_row        jsonb;
  v_tenant_id  uuid;
  v_incoming   uuid[] := array[]::uuid[];
begin
  select exists(
    select 1 from public.properties
    where id = p_property_id and user_id = auth.uid()
  ) into v_caller_owns_property;

  if not v_caller_owns_property then
    raise exception 'Not authorized: caller does not own property %', p_property_id
      using errcode = 'insufficient_privilege';
  end if;

  if p_rows is null or jsonb_array_length(p_rows) = 0 then
    return jsonb_build_object('ok', true, 'property_id', p_property_id,
      'upserted', 0, 'skipped', 0, 'deleted', 0, 'retained_referenced', 0,
      'noop_reason', 'empty_roster');
  end if;

  for v_row in select * from jsonb_array_elements(p_rows)
  loop
    if v_row->>'name' is null or trim(v_row->>'name') = '' then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    begin
      v_tenant_id := (v_row->>'id')::uuid;
    exception when invalid_text_representation then
      v_tenant_id := null;
    end;
    if v_tenant_id is null then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    v_incoming := v_incoming || v_tenant_id;

    insert into public.tenants (
      id, property_id, name, sqft, cap, start_date, end_date, lease_url, lease_type
    ) values (
      v_tenant_id,
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
      property_id = excluded.property_id,
      name        = excluded.name,
      sqft        = excluded.sqft,
      cap         = excluded.cap,
      start_date  = excluded.start_date,
      end_date    = excluded.end_date,
      lease_url   = excluded.lease_url,
      lease_type  = excluded.lease_type;

    v_upserted := v_upserted + 1;
  end loop;

  if v_upserted = 0 then
    return jsonb_build_object('ok', true, 'property_id', p_property_id,
      'upserted', 0, 'skipped', v_skipped, 'deleted', 0, 'retained_referenced', 0,
      'noop_reason', 'no_usable_rows');
  end if;

  select count(*) into v_retained
  from public.tenants t
  where t.property_id = p_property_id
    and not (t.id = any(v_incoming))
    and (exists (select 1 from public.cam_reconciliations c where c.tenant_id = t.id)
      or exists (select 1 from public.tenant_field_evidence e where e.tenant_id = t.id::text));

  delete from public.tenants t
  where t.property_id = p_property_id
    and not (t.id = any(v_incoming))
    and not exists (select 1 from public.cam_reconciliations c where c.tenant_id = t.id)
    and not exists (select 1 from public.tenant_field_evidence e where e.tenant_id = t.id::text);
  get diagnostics v_deleted = row_count;

  return jsonb_build_object(
    'ok', true, 'property_id', p_property_id,
    'upserted', v_upserted, 'skipped', v_skipped,
    'deleted', v_deleted, 'retained_referenced', v_retained,
    'inserted', v_upserted
  );

exception
  when insufficient_privilege then
    return jsonb_build_object('ok', false, 'error', sqlerrm, 'code', 'not_authorized');
  when others then
    raise;
end;
$$;

grant execute on function public.resync_property_tenants(uuid, jsonb) to authenticated;
grant execute on function public.resync_property_tenants(uuid, jsonb) to service_role;


-- ─── Verify ──────────────────────────────────────────────────────────────────
select
  (select count(*) from information_schema.tables
     where table_schema='public'
       and table_name in ('payments','payment_sources','payment_settlements','payment_events')) as tables_remaining,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname like 'payment_%')                                   as payment_procs_remaining;
-- Expected: tables_remaining 0 | payment_procs_remaining 0
