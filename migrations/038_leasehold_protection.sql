-- ============================================================================
-- 038_leasehold_protection.sql — a leasehold is permanent: nothing deletes it
-- for leaving a list, and its lifecycle changes only by a person's decision
-- ============================================================================
-- TARGET: PILOT PROJECT (bhmktujbxdbvdmpybmad). Not to be run on production as
-- part of this change. Written against Pilot's LIVE catalog as read on
-- 2026-09-30 (PostgreSQL 17.6). Requires 037 (tenants.leasehold_status,
-- ended_at, ended_reason and their three checks) and 039's
-- resync_property_tenants, whose live body is byte-identical to that file
-- (prosrc md5 dd78274653e12e5a7cdfbf3024bd4a7e).
--
-- WHY
-- ---
--   tenants.id is the permanent leasehold identity. A leasehold is never
--   deleted merely because it is absent from a roster or source; absence means
--   it may have ended or needs review. Before 038, three things contradicted
--   that on Pilot:
--     · resync_property_tenants DELETED every active leasehold missing from the
--       roster that no reconciliation, evidence row, payment or document named
--       (the lease list's Remove, dedupe and the extraction filter all send
--       such rosters);
--     · the same resync would overwrite a leasehold a person had ended;
--     · tenants_owner_all lets any member of the property DELETE a tenant row,
--       or change its lifecycle columns, directly through the API.
--
-- BEFORE → AFTER (exact inventory)
-- --------------------------------
--   functions  ~ resync_property_tenants(uuid, jsonb): 039's body with the
--                  retention count and the DELETE removed, ended leaseholds in
--                  the roster skipped (never written, never reactivated), and
--                  two report fields added. Signature, SECURITY DEFINER,
--                  search_path, owner-only authorisation, the prospect and
--                  cross-property refusals and the upserted column list are
--                  unchanged; grants re-stated, not changed.
--              + tenants_delete_guard()          (trigger function)
--              + tenants_lifecycle_guard()       (trigger function)
--              + end_leasehold(uuid, date, text, text)
--              + reactivate_leasehold(uuid, text)
--              + discard_leasehold(uuid, text)
--   triggers   + tenants_delete_guard     BEFORE DELETE ON tenants
--              + tenants_lifecycle_guard  BEFORE INSERT OR UPDATE OF
--                                         leasehold_status, ended_at, ended_reason
--   grants     the three lifecycle functions: EXECUTE revoked from PUBLIC and
--              anon, granted to authenticated and service_role. The two trigger
--              functions: EXECUTE revoked from PUBLIC, anon, authenticated and
--              service_role (a trigger fires regardless; nobody calls them).
--   comments   + on resync_property_tenants and the three lifecycle functions
--   = everything else untouched: no row is written when this is applied; no
--     table, column, constraint, index, policy or RLS flag changes; no
--     acquisition table is touched; lease_documents.legacy_tenant_id is not
--     read or written anywhere (it stays reserved for register relinks).
--
-- THE RULES THIS ENFORCES
-- -----------------------
--   · RESYNC NEVER DELETES AND NEVER CHANGES LIFECYCLE. An active leasehold
--     missing from the roster is left exactly as it is and reported in
--     absent_active. A roster row naming an ENDED leasehold is not written and
--     is reported in ended_in_roster (D5: only a person reactivates). deleted
--     is always 0; retained_referenced (kept for compatibility) now counts the
--     absent active leaseholds.
--   · NO DIRECT DELETE, FOR ANY ROLE (service role and table owner included).
--     A tenant row goes away only by
--       – deleting its whole PROPERTY (the foreign key's cascade runs inside a
--         trigger, pg_trigger_depth() > 1 — the same rule property_events
--         uses), or
--       – discard_leasehold, which sets a transaction-local flag naming exactly
--         the one row it deletes.
--   · LIFECYCLE CHANGES ONLY THROUGH end_leasehold / reactivate_leasehold. A
--     new tenant row is always active with no end fields. An UPDATE that
--     changes leasehold_status, ended_at or ended_reason is refused unless the
--     function set its transaction-local flag for that row. An UPDATE that
--     names those columns without changing them passes.
--   · The flags are set only inside these SECURITY DEFINER functions with
--     set_config(..., true): transaction-local, and set_config lives in
--     pg_catalog, which the API does not expose (D12).
--   · end_leasehold: the property's owner (D3); an acquired property; an
--     ACTIVE leasehold; an actual end date that is REQUIRED and never taken
--     from end_date (D8); one of the five reasons — lease_expired,
--     terminated_early, surrendered, evicted, other (no 'assigned': an
--     assignment does not end a leasehold). Writes a leasehold_ended event.
--   · reactivate_leasehold: the owner; an ENDED leasehold; a note is required
--     (D4). Clears ended_at/ended_reason; the previous values are kept in the
--     leasehold_reactivated event.
--   · discard_leasehold — ONLY for a record entered in error (N3, option A):
--     the owner; an ACTIVE leasehold (an ended leasehold is history and is
--     never discarded); a note is required. REFUSED, naming each reason, while
--     any of these exist for it: cam_reconciliations, lease_provisions,
--     tenant_review_audit, payments, a portal row (tenant_users,
--     tenant_statements, tenant_documents, tenant_invitations,
--     tenant_space_profiles — D14), a property_events row naming it (D13), or
--     evidence a PERSON reviewed (approved, manually_edited, or a reviewer
--     recorded; reviewed_at is NOT a review signal — it is the snapshot
--     timestamp every extraction row carries). Otherwise: its lease_documents
--     are KEPT and unlinked (tenant_id → null; legacy_tenant_id untouched),
--     its unreviewed extraction evidence is removed, the row is deleted, and a
--     leasehold_discarded event records the row's snapshot, the note and the
--     unlinked document ids.
--
-- CLIENT: nothing in the browser or the API deletes a tenant row or writes a
-- lifecycle column (A-1, pinned by test-lifecycle-plumbing.js). The lease
-- list's Remove now leaves the leasehold on record as an absent active
-- leasehold; the End / Discard / Reactivate UI is Step B, separately approved.
--
-- Re-runnable. Rollback: 038_leasehold_protection_rollback.sql (restores 039's
-- resync body byte for byte and drops the triggers and functions; writes no
-- row). Verified by tools/verify-migration-038.js on a throwaway cluster.
-- ============================================================================

begin;

-- ── Guard ──────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from public.properties where id = 'fd9c09b1-b657-4c58-9999-c3cce28e7600') then
    raise exception 'REFUSING TO RUN: pilot marker property not found. This does not appear to be the pilot project (bhmktujbxdbvdmpybmad). 038 must never be applied to production.';
  end if;
end $$;

-- ── Preconditions, stated rather than assumed ──────────────────────────────
do $$
declare
  v_md5 text;
begin
  if (select count(*) from information_schema.columns
       where table_schema = 'public' and table_name = 'tenants'
         and column_name in ('leasehold_status', 'ended_at', 'ended_reason')) <> 3 then
    raise exception '038: the 037 lifecycle columns are missing; apply 037 first';
  end if;
  if (select count(*) from pg_constraint
       where conrelid = 'public.tenants'::regclass
         and conname in ('tenants_leasehold_status_chk', 'tenants_ended_consistency_chk', 'tenants_ended_reason_chk')) <> 3 then
    raise exception '038: the 037 lifecycle checks are missing; apply 037 first';
  end if;
  select md5(prosrc) into v_md5 from pg_proc
   where oid = to_regprocedure('public.resync_property_tenants(uuid,jsonb)');
  -- 039's body (the one this file replaces) or this file's own (a re-run).
  if v_md5 is null or v_md5 not in ('dd78274653e12e5a7cdfbf3024bd4a7e', '52ab0f93bc357582d5f2369d4695e589') then
    raise exception '038: resync_property_tenants is not 039''s body (md5 %); refusing to replace a body this file was not written against', coalesce(v_md5, '<missing>');
  end if;
end $$;

-- ── 1 · resync_property_tenants: never deletes, never touches an ended row ──
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
  v_row        jsonb;
  v_tenant_id  uuid;
  v_incoming   uuid[] := array[]::uuid[];
  v_ended      uuid[] := array[]::uuid[];
  v_absent     uuid[] := array[]::uuid[];
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

  -- ── 038: an ENDED leasehold in the roster is not written (D5) ───────────
  select coalesce(array_agg(t.id order by t.id), array[]::uuid[]) into v_ended
  from public.tenants t
  where t.id = any(v_incoming)
    and t.property_id = p_property_id
    and t.leasehold_status = 'ended';

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

    -- 038: an ended leasehold is history; only reactivate_leasehold changes it
    if v_tenant_id = any(v_ended) then
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
    where tenants.property_id = p_property_id      -- 032: property_id is never re-pointed
      and tenants.leasehold_status = 'active';     -- 038: an ended leasehold is never overwritten
    get diagnostics v_written = row_count;

    if v_written = 0 then
      -- 038: ended between pass 1 and here — report it, write nothing
      if exists (select 1 from public.tenants t
                  where t.id = v_tenant_id and t.property_id = p_property_id
                    and t.leasehold_status = 'ended') then
        v_ended := v_ended || v_tenant_id;
        continue;
      end if;
      -- 032: a row that appeared under another property between pass 1 and
      -- here makes the guarded update a no-op; refuse and roll the call back.
      raise exception 'Tenant % belongs to another property; roster for % not written',
        v_tenant_id, p_property_id
        using errcode = 'integrity_constraint_violation';
    end if;

    v_upserted := v_upserted + 1;
  end loop;

  -- ── 038: an active leasehold missing from the roster is reported, never
  --    deleted and never ended. Absence is not an ending. ──────────────────
  select coalesce(array_agg(t.id order by t.id), array[]::uuid[]) into v_absent
  from public.tenants t
  where t.property_id = p_property_id
    and not (t.id = any(v_incoming))
    and t.leasehold_status = 'active';

  return jsonb_build_object(
    'ok', true, 'property_id', p_property_id,
    'upserted', v_upserted, 'skipped', v_skipped,
    'deleted', 0, 'retained_referenced', cardinality(v_absent),
    'inserted', v_upserted,
    'absent_active', to_jsonb(v_absent),
    'ended_in_roster', to_jsonb(v_ended)
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

-- ── 2 · no direct delete of a leasehold, for any role ──────────────────────
create or replace function public.tenants_delete_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Depth 2+: a foreign key's own cascade, i.e. the whole PROPERTY is being
  -- deleted — the intentional exception (the property_events rule).
  if pg_trigger_depth() > 1 then
    return old;
  end if;
  -- discard_leasehold names exactly the one row it deletes, for its
  -- transaction only.
  if current_setting('mainstreet.discard_leasehold', true) = old.id::text then
    return old;
  end if;
  raise exception 'Leasehold % is permanent and is not deleted. End it (end_leasehold) or, if the record was entered in error, discard it (discard_leasehold).', old.id
    using errcode = 'integrity_constraint_violation';
end;
$$;

drop trigger if exists tenants_delete_guard on public.tenants;
create trigger tenants_delete_guard
  before delete on public.tenants
  for each row execute function public.tenants_delete_guard();

-- ── 3 · lifecycle changes only through end_leasehold / reactivate_leasehold ─
create or replace function public.tenants_lifecycle_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    -- A new leasehold is always active.
    if new.leasehold_status is distinct from 'active' or new.ended_at is not null or new.ended_reason is not null then
      raise exception 'A new leasehold is always active; % cannot be created as %', new.id, coalesce(new.leasehold_status, '<null>')
        using errcode = 'integrity_constraint_violation';
    end if;
    return new;
  end if;

  -- An UPDATE that names the columns but changes none of them passes.
  if new.leasehold_status is not distinct from old.leasehold_status
     and new.ended_at     is not distinct from old.ended_at
     and new.ended_reason is not distinct from old.ended_reason then
    return new;
  end if;
  if pg_trigger_depth() > 1 then
    return new;
  end if;
  if current_setting('mainstreet.leasehold_lifecycle', true) = old.id::text then
    return new;
  end if;
  raise exception 'The lifecycle of leasehold % changes only through end_leasehold or reactivate_leasehold', old.id
    using errcode = 'integrity_constraint_violation';
end;
$$;

drop trigger if exists tenants_lifecycle_guard on public.tenants;
create trigger tenants_lifecycle_guard
  before insert or update of leasehold_status, ended_at, ended_reason on public.tenants
  for each row execute function public.tenants_lifecycle_guard();

-- ── 4 · end_leasehold: a person confirms the leasehold actually ended ──────
create or replace function public.end_leasehold(
  p_tenant_id uuid,
  p_ended_at  date,
  p_reason    text,
  p_note      text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_t     public.tenants%rowtype;
  v_stage text;
  v_event uuid;
begin
  if v_uid is null then
    raise exception 'end_leasehold requires an authenticated user' using errcode = 'insufficient_privilege';
  end if;
  if p_tenant_id is null then
    raise exception 'end_leasehold needs a leasehold id' using errcode = 'check_violation';
  end if;
  select * into v_t from public.tenants where id = p_tenant_id for update;
  -- Authorisation first, so a stranger learns nothing about what exists.
  if not found or not exists (select 1 from public.properties p where p.id = v_t.property_id and p.user_id = v_uid) then
    raise exception 'Not authorized: caller does not own the property of leasehold %', p_tenant_id
      using errcode = 'insufficient_privilege';
  end if;
  select lifecycle_stage into v_stage from public.properties where id = v_t.property_id;
  if v_stage is distinct from 'acquired' then
    raise exception 'Property % is %, not acquired', v_t.property_id, coalesce(v_stage, '<none>') using errcode = 'check_violation';
  end if;
  if v_t.leasehold_status <> 'active' then
    raise exception 'Leasehold % is already ended (%); reactivate it first', p_tenant_id, v_t.ended_at using errcode = 'check_violation';
  end if;
  if p_ended_at is null then
    raise exception 'The actual end date is required; it is never taken from the contractual end date' using errcode = 'check_violation';
  end if;
  if p_reason is null or p_reason not in ('lease_expired', 'terminated_early', 'surrendered', 'evicted', 'other') then
    raise exception 'The reason must be one of lease_expired, terminated_early, surrendered, evicted, other (got %)', coalesce(p_reason, '<null>')
      using errcode = 'check_violation';
  end if;

  perform set_config('mainstreet.leasehold_lifecycle', p_tenant_id::text, true);
  update public.tenants
     set leasehold_status = 'ended', ended_at = p_ended_at, ended_reason = p_reason
   where id = p_tenant_id;
  perform set_config('mainstreet.leasehold_lifecycle', '', true);

  insert into public.property_events (property_id, actor_uid, action, subject_type, subject_id, old_value, new_value, detail)
  values (v_t.property_id, v_uid, 'leasehold_ended', 'leasehold', p_tenant_id::text, 'active', 'ended',
          jsonb_build_object('source', 'end_leasehold', 'ended_at', p_ended_at, 'reason', p_reason,
                             'note', nullif(trim(coalesce(p_note, '')), ''),
                             'contractual_end_date', v_t.end_date))
  returning id into v_event;

  return jsonb_build_object('ok', true, 'tenant_id', p_tenant_id, 'property_id', v_t.property_id,
    'leasehold_status', 'ended', 'ended_at', p_ended_at, 'ended_reason', p_reason, 'event_id', v_event);
end;
$$;

-- ── 5 · reactivate_leasehold: a person corrects an ending, with a note ─────
create or replace function public.reactivate_leasehold(
  p_tenant_id uuid,
  p_note      text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_t     public.tenants%rowtype;
  v_stage text;
  v_event uuid;
begin
  if v_uid is null then
    raise exception 'reactivate_leasehold requires an authenticated user' using errcode = 'insufficient_privilege';
  end if;
  if p_tenant_id is null then
    raise exception 'reactivate_leasehold needs a leasehold id' using errcode = 'check_violation';
  end if;
  select * into v_t from public.tenants where id = p_tenant_id for update;
  if not found or not exists (select 1 from public.properties p where p.id = v_t.property_id and p.user_id = v_uid) then
    raise exception 'Not authorized: caller does not own the property of leasehold %', p_tenant_id
      using errcode = 'insufficient_privilege';
  end if;
  select lifecycle_stage into v_stage from public.properties where id = v_t.property_id;
  if v_stage is distinct from 'acquired' then
    raise exception 'Property % is %, not acquired', v_t.property_id, coalesce(v_stage, '<none>') using errcode = 'check_violation';
  end if;
  if v_t.leasehold_status <> 'ended' then
    raise exception 'Leasehold % is active; there is nothing to reactivate', p_tenant_id using errcode = 'check_violation';
  end if;
  if p_note is null or trim(p_note) = '' then
    raise exception 'A note is required to reactivate a leasehold' using errcode = 'check_violation';
  end if;

  perform set_config('mainstreet.leasehold_lifecycle', p_tenant_id::text, true);
  update public.tenants
     set leasehold_status = 'active', ended_at = null, ended_reason = null
   where id = p_tenant_id;
  perform set_config('mainstreet.leasehold_lifecycle', '', true);

  insert into public.property_events (property_id, actor_uid, action, subject_type, subject_id, old_value, new_value, detail)
  values (v_t.property_id, v_uid, 'leasehold_reactivated', 'leasehold', p_tenant_id::text, 'ended', 'active',
          jsonb_build_object('source', 'reactivate_leasehold', 'note', trim(p_note),
                             'previous_ended_at', v_t.ended_at, 'previous_reason', v_t.ended_reason))
  returning id into v_event;

  return jsonb_build_object('ok', true, 'tenant_id', p_tenant_id, 'property_id', v_t.property_id,
    'leasehold_status', 'active', 'event_id', v_event);
end;
$$;

-- ── 6 · discard_leasehold: a record entered in error, and nothing else ─────
create or replace function public.discard_leasehold(
  p_tenant_id uuid,
  p_note      text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_t        public.tenants%rowtype;
  v_stage    text;
  v_reasons  text[] := array[]::text[];
  v_n        integer;
  v_docs     uuid[] := array[]::uuid[];
  v_evidence integer := 0;
  v_event    uuid;
begin
  if v_uid is null then
    raise exception 'discard_leasehold requires an authenticated user' using errcode = 'insufficient_privilege';
  end if;
  if p_tenant_id is null then
    raise exception 'discard_leasehold needs a leasehold id' using errcode = 'check_violation';
  end if;
  select * into v_t from public.tenants where id = p_tenant_id for update;
  if not found or not exists (select 1 from public.properties p where p.id = v_t.property_id and p.user_id = v_uid) then
    raise exception 'Not authorized: caller does not own the property of leasehold %', p_tenant_id
      using errcode = 'insufficient_privilege';
  end if;
  select lifecycle_stage into v_stage from public.properties where id = v_t.property_id;
  if v_stage is distinct from 'acquired' then
    raise exception 'Property % is %, not acquired', v_t.property_id, coalesce(v_stage, '<none>') using errcode = 'check_violation';
  end if;
  if v_t.leasehold_status <> 'active' then
    raise exception 'Leasehold % ended on %; an ended leasehold is history and is never discarded', p_tenant_id, v_t.ended_at
      using errcode = 'check_violation';
  end if;
  if p_note is null or trim(p_note) = '' then
    raise exception 'A note is required to discard a leasehold' using errcode = 'check_violation';
  end if;

  -- What a person or the business did with this leasehold blocks the discard.
  select count(*) into v_n from public.cam_reconciliations where tenant_id = p_tenant_id;
  if v_n > 0 then v_reasons := v_reasons || format('%s CAM reconciliation row(s)', v_n); end if;
  select count(*) into v_n from public.lease_provisions where tenant_id = p_tenant_id::text;
  if v_n > 0 then v_reasons := v_reasons || format('%s lease provision(s)', v_n); end if;
  select count(*) into v_n from public.tenant_review_audit where tenant_id = p_tenant_id::text;
  if v_n > 0 then v_reasons := v_reasons || format('%s review audit entr(y/ies)', v_n); end if;
  select count(*) into v_n from public.payments where tenant_id = p_tenant_id;
  if v_n > 0 then v_reasons := v_reasons || format('%s payment(s)', v_n); end if;
  select (select count(*) from public.tenant_users          where tenant_id = p_tenant_id)
       + (select count(*) from public.tenant_statements     where tenant_id = p_tenant_id)
       + (select count(*) from public.tenant_documents      where tenant_id = p_tenant_id)
       + (select count(*) from public.tenant_invitations    where tenant_id = p_tenant_id)
       + (select count(*) from public.tenant_space_profiles where tenant_id = p_tenant_id)
    into v_n;
  if v_n > 0 then v_reasons := v_reasons || format('%s tenant portal record(s)', v_n); end if;
  select count(*) into v_n from public.property_events where subject_id = p_tenant_id::text;
  if v_n > 0 then v_reasons := v_reasons || format('%s property history event(s)', v_n); end if;
  -- reviewed_at is NOT a review signal: every extraction snapshot carries it.
  select count(*) into v_n from public.tenant_field_evidence
   where tenant_id = p_tenant_id::text
     and (approved or manually_edited or reviewer_uid is not null or reviewer_email is not null);
  if v_n > 0 then v_reasons := v_reasons || format('%s person-reviewed evidence row(s)', v_n); end if;

  if cardinality(v_reasons) > 0 then
    raise exception 'Leasehold % cannot be discarded: %. End it instead, or resolve these first.', p_tenant_id, array_to_string(v_reasons, '; ')
      using errcode = 'check_violation',
            detail  = jsonb_build_object('tenant_id', p_tenant_id, 'reasons', to_jsonb(v_reasons))::text;
  end if;

  -- The upload's own artefacts (N3, option A): its documents are kept and
  -- unlinked; its unreviewed extraction evidence goes with it.
  with u as (
    update public.lease_documents
       set tenant_id = null
     where tenant_id = p_tenant_id and property_id = v_t.property_id
    returning id
  ) select coalesce(array_agg(id order by id), array[]::uuid[]) into v_docs from u;

  delete from public.tenant_field_evidence where tenant_id = p_tenant_id::text;
  get diagnostics v_evidence = row_count;

  perform set_config('mainstreet.discard_leasehold', p_tenant_id::text, true);
  delete from public.tenants where id = p_tenant_id;
  perform set_config('mainstreet.discard_leasehold', '', true);

  insert into public.property_events (property_id, actor_uid, action, subject_type, subject_id, old_value, new_value, detail)
  values (v_t.property_id, v_uid, 'leasehold_discarded', 'leasehold', p_tenant_id::text, 'active', 'discarded',
          jsonb_build_object('source', 'discard_leasehold', 'note', trim(p_note), 'snapshot', to_jsonb(v_t),
                             'unlinked_document_ids', to_jsonb(v_docs),
                             'removed_unreviewed_evidence', v_evidence))
  returning id into v_event;

  return jsonb_build_object('ok', true, 'tenant_id', p_tenant_id, 'property_id', v_t.property_id,
    'unlinked_document_ids', to_jsonb(v_docs), 'removed_unreviewed_evidence', v_evidence, 'event_id', v_event);
end;
$$;

-- ── 7 · grants ─────────────────────────────────────────────────────────────
revoke all on function public.end_leasehold(uuid, date, text, text) from public, anon;
revoke all on function public.reactivate_leasehold(uuid, text)      from public, anon;
revoke all on function public.discard_leasehold(uuid, text)         from public, anon;
grant execute on function public.end_leasehold(uuid, date, text, text) to authenticated, service_role;
grant execute on function public.reactivate_leasehold(uuid, text)      to authenticated, service_role;
grant execute on function public.discard_leasehold(uuid, text)         to authenticated, service_role;
revoke all on function public.tenants_delete_guard()    from public, anon, authenticated, service_role;
revoke all on function public.tenants_lifecycle_guard() from public, anon, authenticated, service_role;

comment on function public.resync_property_tenants(uuid, jsonb) is
  'Writes the roster''s ACTIVE leaseholds (insert or update by id). Never deletes: an active leasehold missing from the roster is reported in absent_active. Never writes an ended leasehold: reported in ended_in_roster. (038)';
comment on function public.end_leasehold(uuid, date, text, text) is
  'A person confirms a leasehold actually ended: required actual end date (never end_date), one of five reasons; owner only; writes leasehold_ended. (038)';
comment on function public.reactivate_leasehold(uuid, text) is
  'A person corrects an ending: required note; owner only; the previous end is kept in the leasehold_reactivated event. (038)';
comment on function public.discard_leasehold(uuid, text) is
  'Removes a record entered in error: active, unreferenced by CAM, provisions, review audit, payments, portal, history or person-reviewed evidence; documents kept and unlinked; owner only; writes leasehold_discarded with a snapshot. (038)';

commit;
