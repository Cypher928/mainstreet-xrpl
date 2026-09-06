-- ─── 021_safe_tenant_resync.sql ──────────────────────────────────────────────
-- S6.2 (prevention): make the tenant resync incapable of orphaning a record.
--
-- WHAT WENT WRONG WITH 009
--
-- 009 made the resync ATOMIC, which it was not before, and that was the right
-- fix for the problem it addressed. It did not make the resync SAFE. It opens
-- with an unconditional
--
--     delete from public.tenants where property_id = p_property_id;
--
-- and then inserts only the rows the caller passed. Three consequences, all of
-- them observed in pilot rather than hypothesised:
--
--   1. Every caller filters its roster first — no name, failed extraction,
--      pending review. Anything filtered out is deleted here and never
--      reinserted, while its cam_reconciliations and tenant_field_evidence
--      rows go on pointing at it. Six reconciliations and fifteen evidence
--      rows in pilot reference tenants that no longer exist.
--
--   2. The insert is guarded by `jsonb_array_length(p_rows) > 0` and the delete
--      is not, so resync(property, []) erases the property's entire roster.
--
--   3. `coalesce(v_tenant_id, gen_random_uuid())` mints an identity database-
--      side that the application never learns, so the next resync mints another.
--      An id the app cannot see is not an identity; it is a new row each time.
--
-- WHAT THIS VERSION DOES INSTEAD
--
--   • An empty roster is a NO-OP. Nothing is deleted. A caller with nothing to
--     say is not asserting that the property has no tenants.
--   • A row without an id is REFUSED, not given one. Identity is minted in the
--     application, once, where it can be recorded; see mintTenantIdentity().
--   • Tenants are UPSERTED, so an id that survives a round trip keeps its row
--     and its created_at instead of being deleted and recreated.
--   • A tenant absent from the roster is deleted ONLY IF nothing references it.
--     A referenced tenant is RETAINED and counted, because a reconciliation
--     that can name its subject is the whole point of keeping the subject.
--
-- Signature is unchanged from 009 so this is a drop-in CREATE OR REPLACE: an
-- older deployed client calling it simply gets the safer behaviour.
--
-- Safe to re-run. Run in Supabase: SQL Editor → New query → paste → Run.
-- ─────────────────────────────────────────────────────────────────────────────

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
  -- ── Authorization ───────────────────────────────────────────────────────
  select exists(
    select 1 from public.properties
    where id = p_property_id and user_id = auth.uid()
  ) into v_caller_owns_property;

  if not v_caller_owns_property then
    raise exception 'Not authorized: caller does not own property %', p_property_id
      using errcode = 'insufficient_privilege';
  end if;

  -- ── An empty roster says nothing, so nothing happens ────────────────────
  -- This is the guard 009 lacked. Without it a caller whose filters removed
  -- every row erases the property.
  if p_rows is null or jsonb_array_length(p_rows) = 0 then
    return jsonb_build_object('ok', true, 'property_id', p_property_id,
      'upserted', 0, 'skipped', 0, 'deleted', 0, 'retained_referenced', 0,
      'noop_reason', 'empty_roster');
  end if;

  -- ── Upsert, and collect the ids the caller is asserting ─────────────────
  for v_row in select * from jsonb_array_elements(p_rows)
  loop
    -- A row with no usable name is not a tenant record.
    if v_row->>'name' is null or trim(v_row->>'name') = '' then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    -- A row with no id is REFUSED rather than given one here. See header.
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

  -- Every row was unusable — treat it as an empty roster, not as "delete all".
  if v_upserted = 0 then
    return jsonb_build_object('ok', true, 'property_id', p_property_id,
      'upserted', 0, 'skipped', v_skipped, 'deleted', 0, 'retained_referenced', 0,
      'noop_reason', 'no_usable_rows');
  end if;

  -- ── Count what would be removed but is referenced ───────────────────────
  select count(*) into v_retained
  from public.tenants t
  where t.property_id = p_property_id
    and not (t.id = any(v_incoming))
    and (exists (select 1 from public.cam_reconciliations c where c.tenant_id = t.id)
      or exists (select 1 from public.tenant_field_evidence e where e.tenant_id = t.id::text));

  -- ── Delete only the unreferenced absentees ──────────────────────────────
  -- A tenant a reconciliation or a piece of evidence still names is kept, even
  -- though the caller did not list it. Removing it would not tidy the data; it
  -- would break the only link between a stored figure and its subject.
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
    -- 009 reported 'inserted'; kept as an alias so an older client that reads
    -- data.inserted still logs a sensible number instead of undefined.
    'inserted', v_upserted
  );

exception
  when insufficient_privilege then
    return jsonb_build_object('ok', false, 'error', sqlerrm, 'code', 'not_authorized');
  when others then
    raise;   -- re-raise so the whole statement rolls back
end;
$$;


-- ─── Grants (unchanged from 009) ─────────────────────────────────────────────
grant execute on function public.resync_property_tenants(uuid, jsonb) to authenticated;
grant execute on function public.resync_property_tenants(uuid, jsonb) to service_role;


-- ─── Verify ──────────────────────────────────────────────────────────────────
select routine_name, security_type, routine_definition is not null as has_body
from information_schema.routines
where routine_schema = 'public' and routine_name = 'resync_property_tenants';
-- Expected: resync_property_tenants | DEFINER | true


-- ─── Rollback ────────────────────────────────────────────────────────────────
-- Re-run migrations/009_atomic_tenant_resync.sql to restore the previous body.
-- Note that doing so restores the destructive delete described in the header.
