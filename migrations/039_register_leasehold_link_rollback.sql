-- ============================================================================
-- 039_register_leasehold_link_rollback.sql
-- ============================================================================
-- Restores exactly what Pilot ran before 039:
--   · resync_property_tenants → 032's body (byte-identical to Pilot's pre-039
--     prosrc, md5 3611e28879049f86cae9ad10c0552494);
--   · drops lease_documents_leasehold_fk;
--   · drops lease_documents.legacy_tenant_id — REFUSED if any row holds a value,
--     because that column is where a relink keeps the historical tenant_id;
--   · clears the tenant_id comment 039 added (it had none before).
--
-- No row is written. tenant_id values are not touched.
--
-- ORDER WARNING: once the 039 client code is deployed, rolling this back is
-- safe (the code saves unlinked when the constraint is absent too). Rolling
-- back 039 does NOT roll back the client code.
-- ============================================================================

begin;

do $$
begin
  if not exists (select 1 from public.properties where id = 'fd9c09b1-b657-4c58-9999-c3cce28e7600') then
    raise exception 'REFUSING TO RUN: pilot marker property not found. This does not appear to be the pilot project (bhmktujbxdbvdmpybmad). 039 must never be applied to production.';
  end if;
end $$;

-- Refuse if a relink has already used legacy_tenant_id: dropping it would
-- lose the historical values it exists to keep.
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'lease_documents' and column_name = 'legacy_tenant_id')
     and exists (select 1 from public.lease_documents where legacy_tenant_id is not null) then
    raise exception '039 rollback refused: lease_documents.legacy_tenant_id holds values (a relink ran). Restore tenant_id from it first.';
  end if;
end $$;

-- 3 · resync_property_tenants back to 032 (the body Pilot ran before 039)
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

-- 2 · the link
alter table public.lease_documents drop constraint if exists lease_documents_leasehold_fk;

-- 1 · the column (empty, checked above)
alter table public.lease_documents drop column if exists legacy_tenant_id;

-- the column comment 039 replaced
comment on column public.lease_documents.tenant_id is null;

commit;
