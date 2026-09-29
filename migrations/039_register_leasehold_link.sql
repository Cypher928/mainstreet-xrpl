-- ============================================================================
-- 039_register_leasehold_link.sql — lease_documents.tenant_id becomes the
-- property-scoped link to the leasehold (tenants.id), without judging history
-- ============================================================================
-- TARGET: PILOT PROJECT (bhmktujbxdbvdmpybmad). Not to be run on production as
-- part of this change. Written against Pilot's LIVE catalog as read on
-- 2026-09-29 (PostgreSQL 17.6). Requires 032 (resync_property_tenants, whose
-- live body is byte-identical to that file: prosrc md5
-- 3611e28879049f86cae9ad10c0552494) and tenants_id_property_uniq.
--
-- WHY
-- ---
--   tenants.id is the permanent leasehold identity (Leasehold Identity
--   checkpoint, approved). lease_documents.tenant_id is the register's link to
--   it, but it has never had a foreign key: all 91 historical values resolve to
--   no tenant (bulk upload wrote an id it then discarded; fixed in script.js in
--   the same change set as this file). This file makes the link real for every
--   write from now on, and leaves history exactly as it is.
--
-- BEFORE → AFTER (exact inventory)
-- --------------------------------
--   columns      + lease_documents.legacy_tenant_id uuid   (nullable, empty,
--                  no constraint; a relink — 042, separately approved — copies
--                  the old value here before changing tenant_id)
--   constraints  + lease_documents_leasehold_fk
--                    foreign key (tenant_id, property_id)
--                    references tenants (id, property_id)
--                    on update no action on delete no action
--                    NOT VALID
--   functions    ~ resync_property_tenants(uuid, jsonb): 032's body plus one
--                  line in the retention count and one in the delete guard —
--                  a tenant a document is linked to is retained, like one a
--                  reconciliation, evidence row or payment names. Signature,
--                  SECURITY DEFINER, search_path, owner-only authorisation and
--                  response shape unchanged; grants re-stated, not changed.
--   comments     + legacy_tenant_id, + the constraint, + tenant_id
--   = everything else untouched: no row is written; no policy, grant, index,
--     trigger or other function changes; no acquisition table is touched (the
--     constraint references tenants only).
--
-- THE RULES THIS ENFORCES
-- -----------------------
--   · A document can be linked only to a leasehold of ITS OWN property: the key
--     is (tenant_id, property_id), matched against tenants_id_property_uniq.
--     This holds for the service-role writer (api/lease-documents.js) too.
--   · NOT VALID: existing rows are not checked, so the 91 unresolved historical
--     values stay exactly as they are and are NOT declared valid. New INSERTs,
--     and UPDATEs that change tenant_id or property_id, are checked. The
--     constraint stays unvalidated until every historical row is decided.
--   · ON DELETE NO ACTION: a tenant that a document is linked to cannot be
--     deleted on its own (the leasehold is ended, not deleted). Checked at the
--     END of the statement, so deleting a PROPERTY still cascades its tenants
--     and its lease_documents together, exactly as before.
--
-- CLIENT (same change set; script.js, api/lease-documents.js)
--   · bulk upload writes each register row AFTER the batch's tenant rows, with
--     the tenant id the row actually has (the job id, or the existing tenant's
--     id when the upload matched one);
--   · api/lease-documents.js: if this constraint refuses the link (the tenant
--     is not persisted), the document is still saved, unlinked (tenant_id
--     null), and the response says linked:false — a document is never lost;
--   · confirmDeleteProperty deletes the property (cascade) instead of deleting
--     tenants first; Clear All and the direct-write resync fallback keep
--     tenants a document is linked to.
--
-- Re-runnable. Rollback: 039_register_leasehold_link_rollback.sql (refuses once
-- legacy_tenant_id holds values). Verified by tools/verify-migration-039.js on
-- a throwaway cluster.
-- ============================================================================

begin;

-- ── Guard ──────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from public.properties where id = 'fd9c09b1-b657-4c58-9999-c3cce28e7600') then
    raise exception 'REFUSING TO RUN: pilot marker property not found. This does not appear to be the pilot project (bhmktujbxdbvdmpybmad). 039 must never be applied to production.';
  end if;
end $$;

-- ── Preconditions, stated rather than assumed ──────────────────────────────
do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.tenants'::regclass and conname = 'tenants_id_property_uniq'
                    and contype = 'u') then
    raise exception '039: tenants_id_property_uniq (unique (id, property_id)) is missing; the property-scoped link needs it';
  end if;
  if (select attnotnull from pg_attribute
       where attrelid = 'public.lease_documents'::regclass and attname = 'property_id') is distinct from true then
    raise exception '039: lease_documents.property_id must be NOT NULL';
  end if;
end $$;

-- ── 1 · lease_documents.legacy_tenant_id (empty; nothing is copied here) ───
alter table public.lease_documents add column if not exists legacy_tenant_id uuid;

comment on column public.lease_documents.legacy_tenant_id is
  'The value tenant_id held before a relink, kept verbatim so no historical value is lost. '
  'Empty until a separately approved relink (042) copies it; never read as a link and never constrained.';

-- ── 2 · the property-scoped leasehold link, unvalidated ────────────────────
-- (tenant_id, property_id) → tenants(id, property_id): a document can only be
-- linked to a leasehold of ITS OWN property. NOT VALID: the 91 historical
-- values that resolve to no tenant are not checked and not declared valid;
-- every INSERT, and every UPDATE that changes tenant_id or property_id, is.
-- ON DELETE NO ACTION: checked at the end of the statement, so deleting a
-- property still cascades both tenants and lease_documents in one statement.
do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.lease_documents'::regclass
                    and conname = 'lease_documents_leasehold_fk') then
    alter table public.lease_documents
      add constraint lease_documents_leasehold_fk
      foreign key (tenant_id, property_id)
      references public.tenants (id, property_id)
      on update no action
      on delete no action
      not valid;
  end if;
end $$;

comment on constraint lease_documents_leasehold_fk on public.lease_documents is
  'tenant_id is the leasehold (tenants.id) of the SAME property. NOT VALID on purpose: '
  'historical unresolved values are left untouched and are not declared valid. Added by 039.';

comment on column public.lease_documents.tenant_id is
  'The leasehold this document belongs to (= tenants.id, same property; lease_documents_leasehold_fk). '
  'Null when the document belongs to the property only, or is not filed yet.';

-- ── 3 · resync_property_tenants keeps register-linked tenants ──────────────
-- The body is 032's, byte for byte, plus one line in each of the two places
-- that decide which absent tenants may be deleted: a tenant a document is
-- linked to is retained exactly like one a reconciliation, a piece of
-- evidence or a payment names. Without this the NO ACTION link would make the
-- whole roster call fail for any property with a linked document.
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

  -- ── Count what would be removed but is referenced (039: + lease_documents)
  select count(*) into v_retained
  from public.tenants t
  where t.property_id = p_property_id
    and not (t.id = any(v_incoming))
    and (exists (select 1 from public.cam_reconciliations c where c.tenant_id = t.id)
      or exists (select 1 from public.tenant_field_evidence e where e.tenant_id = t.id::text)
      or exists (select 1 from public.payments pm where pm.tenant_id = t.id)
      or exists (select 1 from public.lease_documents ld where ld.tenant_id = t.id));

  -- ── Delete only the unreferenced absentees (039: + lease_documents) ─────
  delete from public.tenants t
  where t.property_id = p_property_id
    and not (t.id = any(v_incoming))
    and not exists (select 1 from public.cam_reconciliations c where c.tenant_id = t.id)
    and not exists (select 1 from public.tenant_field_evidence e where e.tenant_id = t.id::text)
    and not exists (select 1 from public.payments pm where pm.tenant_id = t.id)
    and not exists (select 1 from public.lease_documents ld where ld.tenant_id = t.id);
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

commit;
