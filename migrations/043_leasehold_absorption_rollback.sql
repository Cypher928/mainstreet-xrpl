-- ============================================================================
-- 043_leasehold_absorption_rollback.sql — undo 043 exactly
-- ============================================================================
-- TARGET: PILOT PROJECT (bhmktujbxdbvdmpybmad).
--
-- Restores 038's resync_property_tenants, tenants_lifecycle_guard and
-- discard_leasehold byte for byte (copied from 038_leasehold_protection.sql;
-- prosrc md5 52ab0f93…, 3d6dbe7a…, 004365df…), the 038 trigger column list,
-- 037's two checks (tenants_leasehold_status_chk active | ended and
-- tenants_ended_consistency_chk), and drops everything 043 added: the three
-- absorption columns, properties.data_revision, the checks, key and indexes,
-- the three triggers and the eleven functions. Writes no row.
--
-- REFUSES while any leasehold is absorbed: 037's checks cannot hold an
-- absorbed row, and dropping the columns would lose where it was consolidated.
-- Restore each one first (restore_absorbed_leasehold).
--
-- WHAT IT DOES NOT UNDO, BY DESIGN: events written by absorb / restore stay
-- (property_events is append-only). A discarded id is no longer a tombstone
-- after this rollback: the 038 resync would re-create it from a stale roster
-- again — which is one of the reasons 043 exists — so roll back only together
-- with the client that relies on it.
-- ============================================================================

begin;

do $$
begin
  if not exists (select 1 from public.properties where id = 'fd9c09b1-b657-4c58-9999-c3cce28e7600') then
    raise exception 'REFUSING TO RUN: pilot marker property not found. This does not appear to be the pilot project (bhmktujbxdbvdmpybmad).';
  end if;
end $$;

do $$
declare
  v_n integer;
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'tenants' and column_name = 'absorbed_into') then
    execute 'select count(*) from public.tenants where leasehold_status = ''absorbed''' into v_n;
    if v_n > 0 then
      raise exception 'REFUSING TO ROLL BACK 043: % leasehold(s) are absorbed; restore each one first (restore_absorbed_leasehold)', v_n;
    end if;
  end if;
end $$;

-- ── triggers and functions 043 added ───────────────────────────────────────
drop trigger if exists tenants_absorbed_freeze  on public.tenants;
drop trigger if exists tenants_tombstone_guard  on public.tenants;
drop trigger if exists properties_data_revision on public.properties;
drop trigger if exists tenants_lifecycle_guard  on public.tenants;
drop function if exists public.absorb_leasehold(uuid, uuid, text, uuid[], text, bigint);
drop function if exists public.restore_absorbed_leasehold(uuid, text);
drop function if exists public.absorb_leasehold_preflight(uuid, uuid);
drop function if exists public._absorb_eligibility(uuid, uuid);
drop function if exists public.has_meaningful_history(uuid);
drop function if exists public.leasehold_history(uuid);
drop function if exists public._leasehold_tombstoned(uuid);
drop function if exists public._is_demo_property(uuid);
drop function if exists public.tenants_absorbed_freeze();
drop function if exists public.tenants_tombstone_guard();
drop function if exists public.properties_data_revision();

-- ── keys, checks, indexes and columns ──────────────────────────────────────
alter table public.tenants drop constraint if exists tenants_absorbed_into_fk;
alter table public.tenants drop constraint if exists tenants_absorbed_not_self_chk;
alter table public.tenants drop constraint if exists tenants_absorbed_reason_chk;
alter table public.tenants drop constraint if exists tenants_lifecycle_consistency_chk;
alter table public.tenants drop constraint if exists tenants_leasehold_status_chk;
drop index if exists public.tenants_absorbed_into_idx;
drop index if exists public.property_events_leasehold_discarded_idx;
alter table public.tenants drop column if exists absorbed_into;
alter table public.tenants drop column if exists absorbed_reason;
alter table public.tenants drop column if exists absorbed_at;
alter table public.properties drop column if exists data_revision;

-- 037's two checks, as 037 wrote them.
alter table public.tenants add constraint tenants_leasehold_status_chk
  check (leasehold_status in ('active', 'ended'));
alter table public.tenants drop constraint if exists tenants_ended_consistency_chk;
alter table public.tenants add constraint tenants_ended_consistency_chk
  check (   (leasehold_status = 'active' and ended_at is null     and ended_reason is null)
         or (leasehold_status = 'ended'  and ended_at is not null and ended_reason is not null));

-- ── 038's three bodies, verbatim ───────────────────────────────────────────
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

create trigger tenants_lifecycle_guard
  before insert or update of leasehold_status, ended_at, ended_reason on public.tenants
  for each row execute function public.tenants_lifecycle_guard();

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

comment on function public.resync_property_tenants(uuid, jsonb) is
  'Writes the roster''s ACTIVE leaseholds (insert or update by id). Never deletes: an active leasehold missing from the roster is reported in absent_active. Never writes an ended leasehold: reported in ended_in_roster. (038)';
comment on function public.discard_leasehold(uuid, text) is
  'Removes a record entered in error: active, unreferenced by CAM, provisions, review audit, payments, portal, history or person-reviewed evidence; documents kept and unlinked; owner only; writes leasehold_discarded with a snapshot. (038)';

commit;
