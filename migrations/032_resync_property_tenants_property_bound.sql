-- ============================================================================
-- 032_resync_property_tenants_property_bound.sql — a tenant id is bound to its
-- property; the roster call can no longer move it, and writes acquired
-- properties only
-- ============================================================================
-- TARGET: PILOT PROJECT (bhmktujbxdbvdmpybmad). Not to be run on production as
-- part of this change.
--
-- WHAT THIS FIXES (hazard H2 in the Universal Property Intake trace)
-- -----------------------------------------------------------------
-- resync_property_tenants(p_property_id, p_rows) upserts the roster the client
-- sends. Until now its conflict clause included
--
--     property_id = excluded.property_id
--
-- so a roster for property B that carried an id already stored under property
-- A silently RE-POINTED that tenant to B: the row, its reconciliations, its
-- evidence and its payment history changed building. The client guards against
-- this in _tenantsBelongTo(), but a client guard is not a guarantee. This is
-- the shape of the incident reported from the pilot ("SafeShield Insurance
-- from Maple Plaza showed up in Lakeview").
--
-- WHAT CHANGES (function body only — compare with the rollback, which is the
-- definition Pilot ran before this file, taken from pg_get_functiondef)
-- ---------------------------------------------------------------------------
--   1  property_id is REMOVED from the conflict update set, and the update is
--      guarded with `where tenants.property_id = p_property_id`. An existing
--      row's property is never written by this function again.
--   2  The roster is parsed first and written second. Between the two, any id
--      that already belongs to another property refuses the WHOLE call before
--      a single write: { ok:false, code:'cross_property_tenant', tenant_ids }.
--      The ids returned are the ones the caller supplied — nothing new is
--      disclosed. A row with no property (property_id null) counts as
--      foreign too, deliberately: adopting an orphan is not this function's job.
--   3  If a row appears under another property between the check and the
--      write (a race), the guarded update touches nothing, the function raises
--      integrity_constraint_violation, and plpgsql rolls the whole call back.
--   4  Only an ACQUIRED property has a roster to write. Any other
--      lifecycle_stage (prospect, under_review, due_diligence, passed) answers
--      { ok:false, code:'property_not_acquired', stage }. Archived acquired
--      properties are unchanged — writable, as before.
--
-- WHAT DOES NOT CHANGE
-- --------------------
--   * Authorization: owner only (properties.user_id = auth.uid()), as before.
--     A missing property and a property owned by someone else both answer
--     not_authorized, as before. Organization members who are not the owner
--     are refused, as before — that is a separate decision, not taken here.
--   * The empty-roster and no-usable-rows no-ops, the refusal to mint ids
--     server-side, the retention of tenants still referenced by a
--     reconciliation, a piece of evidence or a payment, and the response shape
--     (upserted / skipped / deleted / retained_referenced / inserted).
--   * Signature, SECURITY DEFINER, search_path, grants. This file re-states the
--     grants to authenticated and service_role that 021 gave; it neither adds
--     nor removes any privilege.
--
-- ADDITIVE. One `create or replace function` and two grants. No table, column,
-- index, policy or trigger is created, altered or dropped; no row is written.
-- Re-runnable. Depends on: properties.lifecycle_stage (Phase 0 023, applied),
-- tenants, cam_reconciliations, tenant_field_evidence, payments (022, applied),
-- auth.uid(). Verified by tools/verify-migration-032.js on a throwaway cluster.
--
-- CLIENT. script.js _doResyncTenantsToTable() shows any ok:false response as a
-- toast and returns; its direct-write fallback fires only when the function
-- does not exist (PGRST202), so neither new refusal can be bypassed through it.
-- ============================================================================

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
  v_stage      text;
  v_foreign    uuid[] := array[]::uuid[];
  v_written    integer := 0;
  v_upserted   integer := 0;
  v_skipped    integer := 0;
  v_deleted    integer := 0;
  v_retained   integer := 0;
  v_row        jsonb;
  v_tenant_id  uuid;
  v_incoming   uuid[] := array[]::uuid[];
begin
  -- ── Authorization (unchanged) ───────────────────────────────────────────
  select exists(
    select 1 from public.properties
    where id = p_property_id and user_id = auth.uid()
  ) into v_caller_owns_property;

  if not v_caller_owns_property then
    raise exception 'Not authorized: caller does not own property %', p_property_id
      using errcode = 'insufficient_privilege';
  end if;

  -- ── 032: only an acquired property has a tenant roster to write ─────────
  select lifecycle_stage into v_stage from public.properties where id = p_property_id;
  if v_stage is distinct from 'acquired' then
    return jsonb_build_object('ok', false, 'property_id', p_property_id,
      'code', 'property_not_acquired', 'stage', v_stage,
      'error', format('Property %s is %s, not acquired; its roster is not written', p_property_id, v_stage));
  end if;

  -- ── An empty roster says nothing, so nothing happens (unchanged) ────────
  if p_rows is null or jsonb_array_length(p_rows) = 0 then
    return jsonb_build_object('ok', true, 'property_id', p_property_id,
      'upserted', 0, 'skipped', 0, 'deleted', 0, 'retained_referenced', 0,
      'noop_reason', 'empty_roster');
  end if;

  -- ── 032: pass 1 — parse the roster, write nothing ───────────────────────
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
  end loop;

  if cardinality(v_incoming) = 0 then
    return jsonb_build_object('ok', true, 'property_id', p_property_id,
      'upserted', 0, 'skipped', v_skipped, 'deleted', 0, 'retained_referenced', 0,
      'noop_reason', 'no_usable_rows');
  end if;

  -- ── 032: an id that already belongs to another property refuses the call ─
  select coalesce(array_agg(t.id), array[]::uuid[]) into v_foreign
  from public.tenants t
  where t.id = any(v_incoming)
    and t.property_id is distinct from p_property_id;

  if cardinality(v_foreign) > 0 then
    return jsonb_build_object('ok', false, 'property_id', p_property_id,
      'code', 'cross_property_tenant', 'tenant_ids', to_jsonb(v_foreign),
      'error', format('%s tenant id(s) already belong to another property and were not re-pointed',
                      cardinality(v_foreign)));
  end if;

  -- ── pass 2 — write. The same filters as pass 1, so the same rows ────────
  for v_row in select * from jsonb_array_elements(p_rows)
  loop
    if v_row->>'name' is null or trim(v_row->>'name') = '' then
      continue;
    end if;

    begin
      v_tenant_id := (v_row->>'id')::uuid;
    exception when invalid_text_representation then
      v_tenant_id := null;
    end;
    if v_tenant_id is null then
      continue;
    end if;

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
      name        = excluded.name,
      sqft        = excluded.sqft,
      cap         = excluded.cap,
      start_date  = excluded.start_date,
      end_date    = excluded.end_date,
      lease_url   = excluded.lease_url,
      lease_type  = excluded.lease_type
    where tenants.property_id = p_property_id;   -- 032: property_id is never re-pointed
    get diagnostics v_written = row_count;

    -- 032: a row that appeared under another property between pass 1 and here
    -- makes the guarded update a no-op; refuse and roll the whole call back.
    if v_written = 0 then
      raise exception 'Tenant % belongs to another property; roster for % not written',
        v_tenant_id, p_property_id
        using errcode = 'integrity_constraint_violation';
    end if;

    v_upserted := v_upserted + 1;
  end loop;

  -- ── Count what would be removed but is referenced (unchanged) ───────────
  select count(*) into v_retained
  from public.tenants t
  where t.property_id = p_property_id
    and not (t.id = any(v_incoming))
    and (exists (select 1 from public.cam_reconciliations c where c.tenant_id = t.id)
      or exists (select 1 from public.tenant_field_evidence e where e.tenant_id = t.id::text)
      or exists (select 1 from public.payments pm where pm.tenant_id = t.id));

  -- ── Delete only the unreferenced absentees (unchanged) ──────────────────
  delete from public.tenants t
  where t.property_id = p_property_id
    and not (t.id = any(v_incoming))
    and not exists (select 1 from public.cam_reconciliations c where c.tenant_id = t.id)
    and not exists (select 1 from public.tenant_field_evidence e where e.tenant_id = t.id::text)
    and not exists (select 1 from public.payments pm where pm.tenant_id = t.id);
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
