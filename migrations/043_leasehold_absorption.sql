-- ============================================================================
-- 043_leasehold_absorption.sql — a duplicate or fragment leasehold is
-- consolidated into the leasehold it belongs to, and kept as history
-- ============================================================================
-- TARGET: PILOT PROJECT (bhmktujbxdbvdmpybmad). Not to be run on production as
-- part of this change. Written against Pilot's LIVE catalog as read on
-- 2026-09-30 (PostgreSQL 17.6), with 037, 039, 042 and 038 applied. Requires
-- 038's resync_property_tenants, tenants_lifecycle_guard and discard_leasehold,
-- whose live bodies are byte-identical to 038_leasehold_protection.sql
-- (prosrc md5 52ab0f93…, 3d6dbe7a…, 004365df…).
--
-- Step B1 of the approved Step B plan. A controlled extension of 037/038, not
-- a redesign: every 038 rule stands — the resync never deletes and never
-- writes an ended leasehold; no direct delete, for any role; lifecycle changes
-- only through the lifecycle functions; end_leasehold, reactivate_leasehold and
-- tenants_delete_guard are not touched.
--
-- WHY
-- ---
--   · A leasehold row created from a document that belongs to another leasehold
--     (the old one-row-per-file upload: amendments, notices, renewals), or a
--     second record of the same leasehold, is neither ended (it never occupied
--     space in its own right, and it has no actual end date) nor created in
--     error in a way that should forget it (its documents belong to the real
--     leasehold). It is ABSORBED: kept, frozen, pointing at the leasehold it
--     belongs to, and hidden from every current view (B2).
--   · A leasehold discarded through 038 can come back: a stale browser tab
--     still holds it in its roster, and the 038 resync inserts any id it does
--     not hold. 043 makes a discarded id a tombstone no insert path passes.
--   · 038's discard blockers missed converted-acquisition leaseholds and
--     counted events that no person wrote (events copied from uploads and demo
--     seeds). 043 gives discard and absorb one shared meaningful-history test.
--   · properties.updated_at never changes after insert on Pilot (no trigger),
--     so nothing can tell a stale save from a current one. 043 adds a revision
--     the database maintains (D3's database half).
--
-- BEFORE → AFTER (exact inventory)
-- --------------------------------
--   columns    + tenants.absorbed_into    uuid         (null unless absorbed)
--              + tenants.absorbed_reason  text         (duplicate | document_of)
--              + tenants.absorbed_at      timestamptz
--              + properties.data_revision bigint not null default 0
--   checks     ~ tenants_leasehold_status_chk  active | ended  →  active | ended | absorbed
--              − tenants_ended_consistency_chk (037)
--              + tenants_lifecycle_consistency_chk  (the three-way rule, below)
--              + tenants_absorbed_reason_chk, tenants_absorbed_not_self_chk
--   keys       + tenants_absorbed_into_fk (absorbed_into, property_id)
--                  → tenants (id, property_id)   NO ACTION: the same property,
--                  enforced by the key itself (tenants_id_property_uniq)
--   indexes    + tenants_absorbed_into_idx  (absorbed_into) where not null
--              + property_events_leasehold_discarded_idx (subject_id)
--                  where action = 'leasehold_discarded'
--   functions  ~ resync_property_tenants   038's body; absorbed and discarded
--                  ids in the roster are skipped and reported
--              ~ tenants_lifecycle_guard   038's body; covers the absorption
--                  columns
--              ~ discard_leasehold         038's body; blockers are
--                  leasehold_history(); refuses a leasehold others were
--                  absorbed into, and a demo leasehold
--              + absorb_leasehold, restore_absorbed_leasehold,
--                absorb_leasehold_preflight           (owner only; API)
--              + leasehold_history, has_meaningful_history,
--                _absorb_eligibility, _is_demo_property,
--                _leasehold_tombstoned                (internal; no API role)
--              + tenants_absorbed_freeze, tenants_tombstone_guard,
--                properties_data_revision             (trigger functions)
--   triggers   ~ tenants_lifecycle_guard  BEFORE INSERT OR UPDATE OF
--                  leasehold_status, ended_at, ended_reason, absorbed_into,
--                  absorbed_reason, absorbed_at
--              + tenants_absorbed_freeze  BEFORE UPDATE ON tenants
--              + tenants_tombstone_guard  BEFORE INSERT ON tenants
--              + properties_data_revision BEFORE INSERT OR UPDATE ON properties
--   = unchanged: every policy and RLS flag; tenants_delete_guard,
--     end_leasehold, reactivate_leasehold; lease_documents.legacy_tenant_id is
--     never written. No row is written when this is applied (existing rows
--     read the new columns' defaults).
--
-- THE RULES THIS ENFORCES
-- -----------------------
--   · A leasehold is active, ended or absorbed. Absorbed means: absorbed_into,
--     absorbed_reason and absorbed_at are set and ended_at/ended_reason are
--     not; active and ended rows carry no absorption fields. absorbed_into is a
--     leasehold of the SAME property, never itself.
--   · Only absorb_leasehold and restore_absorbed_leasehold change the
--     absorption fields (038's lifecycle flag, set for one row). A new row is
--     always active with every lifecycle field null.
--   · An absorbed row is FROZEN: no column of it changes, for any role, except
--     through restore_absorbed_leasehold.
--   · A DISCARDED id is a TOMBSTONE: no insert re-creates it, for any role or
--     path (the resync, the direct-write fallback, the demo seed, the API). The
--     tombstone is the leasehold_discarded event discard_leasehold writes; an
--     event with any other source (a copied timeline entry, a member's insert)
--     is not one, and an id whose row still exists is never blocked.
--   · The resync skips an absorbed or discarded id in the roster and reports it
--     (absorbed_in_roster, discarded_in_roster) so a stale tab heals itself.
--   · leasehold_history(id) is the meaningful-history test. A reason for each:
--       ended, or an ended/reactivated event · a CAM reconciliation · a payment
--       · a portal record (tenant_users, tenant_statements, tenant_documents,
--       tenant_invitations, tenant_space_profiles) · a lease provision ·
--       evidence a person reviewed · a review audit entry · an acquisition
--       grouping with this id on a CONVERTED review · a term decision on it ·
--       a history event a person wrote (manual_*, space_*) · a dispute tied to
--       the id (a dispute_* event, or a dispute in the property record).
--     Events copied from an upload or a seed (lease_uploaded, review_confirmed,
--     sync_restored …) are not history (D4). Consolidation bookkeeping
--     (leasehold_absorbed / _restored) is not history either, so a leasehold
--     restored from a mistaken consolidation can be consolidated again.
--   · absorb_leasehold: the owner; an acquired, non-demo property; source and
--     target on it, different; the source ACTIVE with no meaningful history and
--     nothing absorbed into it; the target active or ended, never absorbed; a
--     reason and a note; the property's data_revision as the caller last read
--     it. Documents: each listed one must be on the property and linked to the
--     source, unlinked, or linked to an id that no longer exists; one on the
--     target or on another leasehold is refused; every document linked to the
--     source must be listed. The documents move to the target; the source's
--     saved-roster entry is copied into the event and removed from the saved
--     roster; terms are NEVER copied (a person adopts them through the review
--     override workflow, B3). Two events: leasehold_absorbed (subject: the
--     source) and leasehold_absorbed_other (subject: the target).
--   · restore_absorbed_leasehold: the owner; an absorbed leasehold; a note. The
--     documents its consolidation moved go back to it where they are still on
--     the target; any that moved since are reported, not taken. Its roster
--     entry returns to the saved roster when that roster is non-empty and lacks
--     it. The overrides written on the target since are listed for a person to
--     review. Two events: leasehold_restored / leasehold_restored_other.
--   · discard_leasehold: 038's rules, with leasehold_history() as the blockers,
--     plus: refused while leaseholds are absorbed into it, and for a demo
--     leasehold.
--   · properties.data_revision: +1 whenever name, sqft or data changes; the
--     database sets it on every insert and update, whatever the caller sends.
--
-- CLIENT: nothing in B1 calls the new functions and no product file changes.
-- The shared status helpers learn 'absorbed' in B2, before any screen can
-- absorb (B3); property-save conflict detection (D3) uses data_revision.
--
-- Re-runnable. Rollback: 043_leasehold_absorption_rollback.sql (refuses while
-- any leasehold is absorbed; restores 038's three bodies byte for byte and
-- 037's two checks; drops everything 043 added; writes no row). Verified by
-- tools/verify-migration-043.js on a throwaway cluster.
-- ============================================================================

begin;

-- ── Guard ──────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from public.properties where id = 'fd9c09b1-b657-4c58-9999-c3cce28e7600') then
    raise exception 'REFUSING TO RUN: pilot marker property not found. This does not appear to be the pilot project (bhmktujbxdbvdmpybmad). 043 must never be applied to production.';
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
    raise exception '043: the 037 lifecycle columns are missing; apply 037 first';
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.tenants'::regclass and conname = 'tenants_ended_reason_chk') then
    raise exception '043: 037''s tenants_ended_reason_chk is missing; apply 037 first';
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.tenants'::regclass and conname = 'tenants_id_property_uniq') then
    raise exception '043: tenants_id_property_uniq is missing; the same-property key needs it';
  end if;
  -- 038's bodies (the ones this file replaces) or this file's own (a re-run).
  select md5(prosrc) into v_md5 from pg_proc where oid = to_regprocedure('public.resync_property_tenants(uuid,jsonb)');
  if v_md5 is null or v_md5 not in ('52ab0f93bc357582d5f2369d4695e589', 'de53ec6029b7ef34c23ef20da0020f22') then
    raise exception '043: resync_property_tenants is not 038''s body (md5 %); apply 038 first, and never over a body this file was not written against', coalesce(v_md5, '<missing>');
  end if;
  select md5(prosrc) into v_md5 from pg_proc where oid = to_regprocedure('public.tenants_lifecycle_guard()');
  if v_md5 is null or v_md5 not in ('3d6dbe7a6e4e16880ba1ca4a521e4ec5', 'd5e88f82dc82c674082ce5644400c09e') then
    raise exception '043: tenants_lifecycle_guard is not 038''s body (md5 %); apply 038 first', coalesce(v_md5, '<missing>');
  end if;
  select md5(prosrc) into v_md5 from pg_proc where oid = to_regprocedure('public.discard_leasehold(uuid,text)');
  if v_md5 is null or v_md5 not in ('004365dfe924082d14197965e9b79477', 'b49f5c09f69ef6e7aa541da554148247') then
    raise exception '043: discard_leasehold is not 038''s body (md5 %); apply 038 first', coalesce(v_md5, '<missing>');
  end if;
  if to_regprocedure('public.tenants_delete_guard()') is null
     or to_regprocedure('public.end_leasehold(uuid,date,text,text)') is null
     or to_regprocedure('public.reactivate_leasehold(uuid,text)') is null then
    raise exception '043: 038''s delete guard or lifecycle functions are missing; apply 038 first';
  end if;
end $$;

-- ── 1 · columns ────────────────────────────────────────────────────────────
alter table public.tenants add column if not exists absorbed_into   uuid;
alter table public.tenants add column if not exists absorbed_reason text;
alter table public.tenants add column if not exists absorbed_at     timestamptz;
alter table public.properties add column if not exists data_revision bigint not null default 0;

-- ── 2 · checks and the same-property key ───────────────────────────────────
alter table public.tenants drop constraint if exists tenants_leasehold_status_chk;
alter table public.tenants add constraint tenants_leasehold_status_chk
  check (leasehold_status in ('active', 'ended', 'absorbed'));

alter table public.tenants drop constraint if exists tenants_ended_consistency_chk;
alter table public.tenants drop constraint if exists tenants_lifecycle_consistency_chk;
alter table public.tenants add constraint tenants_lifecycle_consistency_chk
  check (   (leasehold_status = 'active'   and ended_at is null     and ended_reason is null
                                           and absorbed_into is null and absorbed_reason is null and absorbed_at is null)
         or (leasehold_status = 'ended'    and ended_at is not null and ended_reason is not null
                                           and absorbed_into is null and absorbed_reason is null and absorbed_at is null)
         or (leasehold_status = 'absorbed' and ended_at is null     and ended_reason is null
                                           and absorbed_into is not null and absorbed_reason is not null and absorbed_at is not null));

alter table public.tenants drop constraint if exists tenants_absorbed_reason_chk;
alter table public.tenants add constraint tenants_absorbed_reason_chk
  check (absorbed_reason is null or absorbed_reason in ('duplicate', 'document_of'));

alter table public.tenants drop constraint if exists tenants_absorbed_not_self_chk;
alter table public.tenants add constraint tenants_absorbed_not_self_chk
  check (absorbed_into is null or absorbed_into <> id);

alter table public.tenants drop constraint if exists tenants_absorbed_into_fk;
alter table public.tenants add constraint tenants_absorbed_into_fk
  foreign key (absorbed_into, property_id) references public.tenants (id, property_id);

create index if not exists tenants_absorbed_into_idx on public.tenants (absorbed_into)
  where absorbed_into is not null;
create index if not exists property_events_leasehold_discarded_idx on public.property_events (subject_id)
  where action = 'leasehold_discarded';

comment on column public.tenants.absorbed_into is
  'The leasehold of the same property this one was consolidated into (absorbed). Set and cleared only by absorb_leasehold / restore_absorbed_leasehold. Added by 043.';
comment on column public.tenants.absorbed_reason is
  'duplicate (a second record of the same leasehold) or document_of (created from a document that belongs to absorbed_into). Added by 043.';
comment on column public.tenants.absorbed_at is
  'When the leasehold was consolidated. Added by 043.';
comment on column public.properties.data_revision is
  'Maintained by the database: +1 whenever name, sqft or data changes; whatever a caller sends is ignored. A save that read an older revision is stale. Added by 043.';

-- ── 3 · properties.data_revision ───────────────────────────────────────────
create or replace function public.properties_data_revision()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.data_revision := 0;
    return new;
  end if;
  if new.data is distinct from old.data
     or new.name is distinct from old.name
     or new.sqft is distinct from old.sqft then
    new.data_revision := old.data_revision + 1;
  else
    new.data_revision := old.data_revision;
  end if;
  return new;
end;
$$;

drop trigger if exists properties_data_revision on public.properties;
create trigger properties_data_revision
  before insert or update on public.properties
  for each row execute function public.properties_data_revision();

-- ── 4 · internal helpers ───────────────────────────────────────────────────
-- The two seeded demo properties carry fixed id prefixes (script.js
-- _initDemoIds): Cascade Commons and Northgate Exchange. Their leaseholds are
-- re-created by the seed; they are reset, never absorbed or discarded.
create or replace function public._is_demo_property(p_property_id uuid)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_property_id::text like 'dec00000-0000-4000-a000-%'
      or p_property_id::text like 'de000001-0000-4000-a000-%'
$$;

-- Only the event discard_leasehold itself writes is a tombstone.
create or replace function public._leasehold_tombstoned(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.property_events e
     where e.action = 'leasehold_discarded'
       and e.subject_id = p_tenant_id::text
       and e.subject_type = 'leasehold'
       and e.detail->>'source' = 'discard_leasehold')
$$;

create or replace function public.leasehold_history(p_tenant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_out  jsonb := '[]'::jsonb;
  v_id   text  := p_tenant_id::text;
  v_t    public.tenants%rowtype;
  v_data jsonb;
  v_n    integer;
begin
  select * into v_t from public.tenants where id = p_tenant_id;

  select (case when v_t.leasehold_status = 'ended' then 1 else 0 end)
       + (select count(*) from public.property_events e
           where e.subject_id = v_id and e.action in ('leasehold_ended', 'leasehold_reactivated'))
    into v_n;
  if v_n > 0 then v_out := v_out || jsonb_build_object('code', 'lifecycle', 'count', v_n,
    'label', format('%s lifecycle record(s): ended or reactivated', v_n)); end if;

  select count(*) into v_n from public.cam_reconciliations where tenant_id = p_tenant_id;
  if v_n > 0 then v_out := v_out || jsonb_build_object('code', 'cam', 'count', v_n,
    'label', format('%s CAM reconciliation row(s)', v_n)); end if;

  select count(*) into v_n from public.payments where tenant_id = p_tenant_id;
  if v_n > 0 then v_out := v_out || jsonb_build_object('code', 'payments', 'count', v_n,
    'label', format('%s payment(s)', v_n)); end if;

  select (select count(*) from public.tenant_users          where tenant_id = p_tenant_id)
       + (select count(*) from public.tenant_statements     where tenant_id = p_tenant_id)
       + (select count(*) from public.tenant_documents      where tenant_id = p_tenant_id)
       + (select count(*) from public.tenant_invitations    where tenant_id = p_tenant_id)
       + (select count(*) from public.tenant_space_profiles where tenant_id = p_tenant_id)
    into v_n;
  if v_n > 0 then v_out := v_out || jsonb_build_object('code', 'portal', 'count', v_n,
    'label', format('%s tenant portal record(s)', v_n)); end if;

  select count(*) into v_n from public.lease_provisions where tenant_id = v_id;
  if v_n > 0 then v_out := v_out || jsonb_build_object('code', 'provisions', 'count', v_n,
    'label', format('%s lease provision(s)', v_n)); end if;

  -- reviewed_at is NOT a review signal: every extraction snapshot carries it.
  select count(*) into v_n from public.tenant_field_evidence
   where tenant_id = v_id
     and (approved or manually_edited or reviewer_uid is not null or reviewer_email is not null);
  if v_n > 0 then v_out := v_out || jsonb_build_object('code', 'reviewed_evidence', 'count', v_n,
    'label', format('%s person-reviewed evidence row(s)', v_n)); end if;

  select count(*) into v_n from public.tenant_review_audit where tenant_id = v_id;
  if v_n > 0 then v_out := v_out || jsonb_build_object('code', 'review_audit', 'count', v_n,
    'label', format('%s review audit entr(y/ies)', v_n)); end if;

  select count(*) into v_n
    from public.acquisition_document_families f
    join public.acquisition_reviews r on r.id = f.review_id
   where f.id = p_tenant_id
     and (r.status = 'converted' or r.converted_at is not null);
  if v_n > 0 then v_out := v_out || jsonb_build_object('code', 'acquisition', 'count', v_n,
    'label', 'established by a converted acquisition review'); end if;

  select count(*) into v_n from public.acquisition_term_decisions where family_id = p_tenant_id;
  if v_n > 0 then v_out := v_out || jsonb_build_object('code', 'acquisition_decisions', 'count', v_n,
    'label', format('%s acquisition term decision(s)', v_n)); end if;

  select count(*) into v_n from public.property_events e
   where e.subject_id = v_id
     and (e.action like 'manual\_%' escape '\' or e.action like 'space\_%' escape '\');
  if v_n > 0 then v_out := v_out || jsonb_build_object('code', 'history_events', 'count', v_n,
    'label', format('%s property history event(s)', v_n)); end if;

  select p.data into v_data from public.properties p where p.id = v_t.property_id;
  select (select count(*) from public.property_events e
           where e.subject_id = v_id and e.action like 'dispute\_%' escape '\')
       + (select count(*) from jsonb_array_elements(
            case when jsonb_typeof(v_data->'disputes') = 'array' then v_data->'disputes' else '[]'::jsonb end) d
           where jsonb_typeof(d) = 'object' and d->>'tenantId' = v_id)
    into v_n;
  if v_n > 0 then v_out := v_out || jsonb_build_object('code', 'disputes', 'count', v_n,
    'label', format('%s dispute record(s)', v_n)); end if;

  return v_out;
end;
$$;

create or replace function public.has_meaningful_history(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_array_length(public.leasehold_history(p_tenant_id)) > 0
$$;

-- ── 5 · lifecycle guard: now covers the absorption columns ──────────────────
create or replace function public.tenants_lifecycle_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    -- A new leasehold is always active.
    if new.leasehold_status is distinct from 'active' or new.ended_at is not null or new.ended_reason is not null
       or new.absorbed_into is not null or new.absorbed_reason is not null or new.absorbed_at is not null then
      raise exception 'A new leasehold is always active; % cannot be created as %', new.id, coalesce(new.leasehold_status, '<null>')
        using errcode = 'integrity_constraint_violation';
    end if;
    return new;
  end if;

  -- An UPDATE that names the columns but changes none of them passes.
  if new.leasehold_status is not distinct from old.leasehold_status
     and new.ended_at        is not distinct from old.ended_at
     and new.ended_reason    is not distinct from old.ended_reason
     and new.absorbed_into   is not distinct from old.absorbed_into
     and new.absorbed_reason is not distinct from old.absorbed_reason
     and new.absorbed_at     is not distinct from old.absorbed_at then
    return new;
  end if;
  if pg_trigger_depth() > 1 then
    return new;
  end if;
  if current_setting('mainstreet.leasehold_lifecycle', true) = old.id::text then
    return new;
  end if;
  raise exception 'The lifecycle of leasehold % changes only through end_leasehold, reactivate_leasehold, absorb_leasehold or restore_absorbed_leasehold', old.id
    using errcode = 'integrity_constraint_violation';
end;
$$;

drop trigger if exists tenants_lifecycle_guard on public.tenants;
create trigger tenants_lifecycle_guard
  before insert or update of leasehold_status, ended_at, ended_reason, absorbed_into, absorbed_reason, absorbed_at on public.tenants
  for each row execute function public.tenants_lifecycle_guard();

-- ── 6 · an absorbed leasehold is frozen ────────────────────────────────────
create or replace function public.tenants_absorbed_freeze()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.leasehold_status is distinct from 'absorbed' then
    return new;
  end if;
  if current_setting('mainstreet.leasehold_lifecycle', true) = old.id::text then
    return new;
  end if;
  if new is not distinct from old then
    return new;
  end if;
  raise exception 'Leasehold % was consolidated into % and is kept as history; restore it (restore_absorbed_leasehold) before changing it', old.id, old.absorbed_into
    using errcode = 'integrity_constraint_violation';
end;
$$;

drop trigger if exists tenants_absorbed_freeze on public.tenants;
create trigger tenants_absorbed_freeze
  before update on public.tenants
  for each row execute function public.tenants_absorbed_freeze();

-- ── 7 · a discarded id is never re-created ─────────────────────────────────
create or replace function public.tenants_tombstone_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- An upsert whose row exists is heading for its own conflict, not a re-creation.
  if exists (select 1 from public.tenants t where t.id = new.id) then
    return new;
  end if;
  if public._leasehold_tombstoned(new.id) then
    raise exception 'Leasehold % was discarded as a record entered in error and is not re-created', new.id
      using errcode = 'integrity_constraint_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists tenants_tombstone_guard on public.tenants;
create trigger tenants_tombstone_guard
  before insert on public.tenants
  for each row execute function public.tenants_tombstone_guard();

-- ── 8 · resync_property_tenants: 038's, and a stale roster heals ───────────
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
  v_absorbed   uuid[] := array[]::uuid[];
  v_discarded  uuid[] := array[]::uuid[];
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

  -- ── 043: an ABSORBED leasehold in the roster is not written ─────────────
  select coalesce(array_agg(t.id order by t.id), array[]::uuid[]) into v_absorbed
  from public.tenants t
  where t.id = any(v_incoming)
    and t.property_id = p_property_id
    and t.leasehold_status = 'absorbed';

  -- ── 043: a DISCARDED id in the roster (a stale tab) is not re-created ───
  select coalesce(array_agg(distinct x order by x), array[]::uuid[]) into v_discarded
  from unnest(v_incoming) x
  where not exists (select 1 from public.tenants t where t.id = x)
    and public._leasehold_tombstoned(x);

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
    -- 043: an absorbed leasehold is history; only restore_absorbed_leasehold changes it
    if v_tenant_id = any(v_absorbed) then
      continue;
    end if;
    -- 043: a discarded leasehold stays discarded
    if v_tenant_id = any(v_discarded) then
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
      and tenants.leasehold_status = 'active';     -- 038: an ended (043: or absorbed) leasehold is never overwritten
    get diagnostics v_written = row_count;

    if v_written = 0 then
      -- 038: ended between pass 1 and here — report it, write nothing
      if exists (select 1 from public.tenants t
                  where t.id = v_tenant_id and t.property_id = p_property_id
                    and t.leasehold_status = 'ended') then
        v_ended := v_ended || v_tenant_id;
        continue;
      end if;
      -- 043: absorbed between pass 1 and here — report it, write nothing
      if exists (select 1 from public.tenants t
                  where t.id = v_tenant_id and t.property_id = p_property_id
                    and t.leasehold_status = 'absorbed') then
        v_absorbed := v_absorbed || v_tenant_id;
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
    'ended_in_roster', to_jsonb(v_ended),
    'absorbed_in_roster', to_jsonb(v_absorbed),
    'discarded_in_roster', to_jsonb(v_discarded)
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

-- ── 9 · discard_leasehold: one history test, and not for a consolidation target
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
  if v_t.leasehold_status = 'absorbed' then
    raise exception 'Leasehold % was consolidated into %; it is history and is never discarded (restore it first if the consolidation was a mistake)', p_tenant_id, v_t.absorbed_into
      using errcode = 'check_violation';
  end if;
  if v_t.leasehold_status <> 'active' then
    raise exception 'Leasehold % ended on %; an ended leasehold is history and is never discarded', p_tenant_id, v_t.ended_at
      using errcode = 'check_violation';
  end if;
  if p_note is null or trim(p_note) = '' then
    raise exception 'A note is required to discard a leasehold' using errcode = 'check_violation';
  end if;

  -- What a person or the business did with this leasehold blocks the discard.
  select coalesce(array_agg(h->>'label' order by o), array[]::text[]) into v_reasons
    from jsonb_array_elements(public.leasehold_history(p_tenant_id)) with ordinality x(h, o);
  select count(*) into v_n from public.tenants c where c.absorbed_into = p_tenant_id;
  if v_n > 0 then v_reasons := v_reasons || format('%s leasehold(s) consolidated into it', v_n); end if;
  if public._is_demo_property(v_t.property_id) then
    v_reasons := v_reasons || 'a demo leasehold (reset the demo instead)'::text;
  end if;

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

-- ── 10 · who may be consolidated, and into what ────────────────────────────
-- One list of refusals, shared by the preflight and absorb_leasehold. Reads
-- only; the caller has already authorised.
create or replace function public._absorb_eligibility(p_source uuid, p_target uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_s     public.tenants%rowtype;
  v_t     public.tenants%rowtype;
  v_stage text;
  v_out   jsonb := '[]'::jsonb;
  v_hist  jsonb;
  v_n     integer;
begin
  select * into v_s from public.tenants where id = p_source;
  if not found then
    return jsonb_build_array('The leasehold to consolidate does not exist');
  end if;
  select lifecycle_stage into v_stage from public.properties where id = v_s.property_id;
  if v_stage is distinct from 'acquired' then
    v_out := v_out || to_jsonb(format('Property %s is %s, not acquired', v_s.property_id, coalesce(v_stage, '<none>')));
  end if;
  if public._is_demo_property(v_s.property_id) then
    v_out := v_out || to_jsonb('A demo leasehold is not consolidated; reset the demo instead'::text);
  end if;
  if v_s.leasehold_status = 'ended' then
    v_out := v_out || to_jsonb(format('Leasehold %s ended on %s; an ended leasehold is history and is not consolidated', p_source, v_s.ended_at));
  elsif v_s.leasehold_status = 'absorbed' then
    v_out := v_out || to_jsonb(format('Leasehold %s is already consolidated into %s', p_source, v_s.absorbed_into));
  end if;
  select count(*) into v_n from public.tenants c where c.absorbed_into = p_source;
  if v_n > 0 then
    v_out := v_out || to_jsonb(format('%s leasehold(s) were consolidated into this one; restore them first', v_n));
  end if;
  v_hist := public.leasehold_history(p_source);
  if jsonb_array_length(v_hist) > 0 then
    v_out := v_out || to_jsonb(format('It has permanent history (%s); it can be ended, not consolidated',
      (select string_agg(h->>'label', '; ' order by o) from jsonb_array_elements(v_hist) with ordinality x(h, o))));
  end if;

  if p_target is null then
    return v_out;
  end if;
  if p_target = p_source then
    return v_out || to_jsonb('A leasehold cannot be consolidated into itself'::text);
  end if;
  select * into v_t from public.tenants where id = p_target;
  if not found or v_t.property_id is distinct from v_s.property_id then
    v_out := v_out || to_jsonb('The target leasehold is not on the same property'::text);
  elsif v_t.leasehold_status = 'absorbed' then
    v_out := v_out || to_jsonb(format('The target was itself consolidated into %s; choose that leasehold instead', v_t.absorbed_into));
  end if;
  return v_out;
end;
$$;

-- ── 11 · the preflight: what a consolidation would do, read only ───────────
create or replace function public.absorb_leasehold_preflight(p_source uuid, p_target uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_s    public.tenants%rowtype;
  v_t    public.tenants%rowtype;
  v_ref  jsonb;
  v_rev  bigint;
  v_leaf jsonb := jsonb_build_object();
begin
  if v_uid is null then
    raise exception 'absorb_leasehold_preflight requires an authenticated user' using errcode = 'insufficient_privilege';
  end if;
  if p_source is null then
    raise exception 'absorb_leasehold_preflight needs the leasehold to consolidate' using errcode = 'check_violation';
  end if;
  select * into v_s from public.tenants where id = p_source;
  if not found or not exists (select 1 from public.properties p where p.id = v_s.property_id and p.user_id = v_uid) then
    raise exception 'Not authorized: caller does not own the property of leasehold %', p_source
      using errcode = 'insufficient_privilege';
  end if;
  v_ref := public._absorb_eligibility(p_source, p_target);
  select data_revision into v_rev from public.properties where id = v_s.property_id;
  if p_target is not null then
    select * into v_t from public.tenants where id = p_target and property_id = v_s.property_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'eligible', p_target is not null and jsonb_array_length(v_ref) = 0,
    'refusals', v_ref,
    'history', public.leasehold_history(p_source),
    'data_revision', v_rev,
    'source', jsonb_build_object('id', v_s.id, 'name', v_s.name, 'leasehold_status', v_s.leasehold_status,
      'sqft', v_s.sqft, 'start_date', v_s.start_date, 'end_date', v_s.end_date, 'lease_type', v_s.lease_type,
      'lease_url', v_s.lease_url, 'absorbed_into', v_s.absorbed_into),
    'target', case when v_t.id is null then null else jsonb_build_object('id', v_t.id, 'name', v_t.name,
      'leasehold_status', v_t.leasehold_status, 'sqft', v_t.sqft, 'start_date', v_t.start_date,
      'end_date', v_t.end_date, 'lease_type', v_t.lease_type) end,
    'documents', jsonb_build_object(
      -- every document linked to the source: all of them must move
      'must_move', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'file_name', d.file_name, 'doc_type', d.doc_type) order by d.file_name, d.id), '[]'::jsonb)
                      from public.lease_documents d where d.property_id = v_s.property_id and d.tenant_id = p_source),
      -- unattributed documents whose file is the source row's own lease file
      'matched_by_file', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'file_name', d.file_name, 'doc_type', d.doc_type) order by d.file_name, d.id), '[]'::jsonb)
                      from public.lease_documents d
                     where d.property_id = v_s.property_id
                       and (d.tenant_id is null or not exists (select 1 from public.tenants x where x.id = d.tenant_id))
                       and v_s.lease_url is not null and d.file_url = v_s.lease_url),
      -- every other unattributed document of the property (optional)
      'unattributed', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'file_name', d.file_name, 'doc_type', d.doc_type) order by d.file_name, d.id), '[]'::jsonb)
                      from public.lease_documents d
                     where d.property_id = v_s.property_id
                       and (d.tenant_id is null or not exists (select 1 from public.tenants x where x.id = d.tenant_id))
                       and (v_s.lease_url is null or d.file_url is distinct from v_s.lease_url))
    )
  );
end;
$$;

-- ── 12 · absorb_leasehold ──────────────────────────────────────────────────
create or replace function public.absorb_leasehold(
  p_source            uuid,
  p_target            uuid,
  p_reason            text,
  p_document_ids      uuid[],
  p_note              text,
  p_expected_revision bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_s         public.tenants%rowtype;
  v_t         public.tenants%rowtype;
  v_rev       bigint;
  v_rev_after bigint;
  v_refusals  jsonb;
  v_docs      uuid[];
  v_bad       uuid[];
  v_moved     jsonb;
  v_data      jsonb;
  v_roster    jsonb;
  v_at        timestamptz := now();
  v_event     uuid;
  v_event2    uuid;
begin
  if v_uid is null then
    raise exception 'absorb_leasehold requires an authenticated user' using errcode = 'insufficient_privilege';
  end if;
  if p_source is null or p_target is null then
    raise exception 'absorb_leasehold needs the leasehold to consolidate and the leasehold to consolidate into' using errcode = 'check_violation';
  end if;

  -- Both rows, in one fixed order, so two consolidations cannot deadlock.
  perform 1 from public.tenants where id in (p_source, p_target) order by id for update;
  select * into v_s from public.tenants where id = p_source;
  -- Authorisation first, so a stranger learns nothing about what exists.
  if not found or not exists (select 1 from public.properties p where p.id = v_s.property_id and p.user_id = v_uid) then
    raise exception 'Not authorized: caller does not own the property of leasehold %', p_source
      using errcode = 'insufficient_privilege';
  end if;
  -- The saved roster lives on the property row: hold it while this runs.
  select data_revision, data into v_rev, v_data from public.properties where id = v_s.property_id for update;

  v_refusals := public._absorb_eligibility(p_source, p_target);
  if jsonb_array_length(v_refusals) > 0 then
    raise exception 'Leasehold % cannot be consolidated into %: %', p_source, p_target,
      (select string_agg(r, '; ' order by o) from jsonb_array_elements_text(v_refusals) with ordinality x(r, o))
      using errcode = 'check_violation',
            detail  = jsonb_build_object('source', p_source, 'target', p_target, 'refusals', v_refusals)::text;
  end if;
  select * into v_t from public.tenants where id = p_target;

  if p_reason is null or p_reason not in ('duplicate', 'document_of') then
    raise exception 'The reason must be duplicate or document_of (got %)', coalesce(p_reason, '<null>') using errcode = 'check_violation';
  end if;
  if p_note is null or trim(p_note) = '' then
    raise exception 'A note is required to consolidate a leasehold' using errcode = 'check_violation';
  end if;
  if p_expected_revision is null or p_expected_revision is distinct from v_rev then
    raise exception 'The property changed since this consolidation was prepared (revision % expected, % now); reload it and try again', coalesce(p_expected_revision::text, '<none>'), v_rev
      using errcode = 'check_violation';
  end if;

  -- ── documents: every check before any write ─────────────────────────────
  v_docs := coalesce((select array_agg(distinct d order by d) from unnest(p_document_ids) d where d is not null), array[]::uuid[]);
  perform 1 from public.lease_documents d where d.id = any(v_docs) order by d.id for update;

  select coalesce(array_agg(x order by x), array[]::uuid[]) into v_bad
    from unnest(v_docs) x
   where not exists (select 1 from public.lease_documents d where d.id = x and d.property_id = v_s.property_id);
  if cardinality(v_bad) > 0 then
    raise exception 'Document(s) % are not documents of this property', v_bad using errcode = 'check_violation';
  end if;

  select coalesce(array_agg(d.id order by d.id), array[]::uuid[]) into v_bad
    from public.lease_documents d where d.id = any(v_docs) and d.tenant_id = p_target;
  if cardinality(v_bad) > 0 then
    raise exception 'Document(s) % already belong to the leasehold being consolidated into', v_bad using errcode = 'check_violation';
  end if;

  select coalesce(array_agg(d.id order by d.id), array[]::uuid[]) into v_bad
    from public.lease_documents d
   where d.id = any(v_docs) and d.tenant_id is not null and d.tenant_id <> p_source
     and exists (select 1 from public.tenants x where x.id = d.tenant_id);
  if cardinality(v_bad) > 0 then
    raise exception 'Document(s) % belong to another leasehold and are not moved', v_bad using errcode = 'check_violation';
  end if;

  select coalesce(array_agg(d.id order by d.id), array[]::uuid[]) into v_bad
    from public.lease_documents d
   where d.property_id = v_s.property_id and d.tenant_id = p_source and not (d.id = any(v_docs));
  if cardinality(v_bad) > 0 then
    raise exception 'Leasehold % still has document(s) % linked; every one of them moves with it', p_source, v_bad using errcode = 'check_violation';
  end if;

  -- ── record, then move the documents ─────────────────────────────────────
  select coalesce(jsonb_agg(jsonb_build_object('document_id', d.id, 'file_name', d.file_name,
           'from_tenant_id', d.tenant_id, 'to_tenant_id', p_target) order by d.id), '[]'::jsonb)
    into v_moved
    from public.lease_documents d where d.id = any(v_docs);
  update public.lease_documents set tenant_id = p_target where id = any(v_docs);

  -- ── the source's saved-roster entry, copied before it is removed ────────
  v_roster := coalesce((select jsonb_agg(e order by o)
                          from jsonb_array_elements(case when jsonb_typeof(v_data->'tenants') = 'array' then v_data->'tenants' else '[]'::jsonb end)
                               with ordinality x(e, o)
                         where jsonb_typeof(e) = 'object' and e->>'id' = p_source::text), '[]'::jsonb);

  -- ── the state ───────────────────────────────────────────────────────────
  perform set_config('mainstreet.leasehold_lifecycle', p_source::text, true);
  update public.tenants
     set leasehold_status = 'absorbed', absorbed_into = p_target, absorbed_reason = p_reason, absorbed_at = v_at
   where id = p_source;
  perform set_config('mainstreet.leasehold_lifecycle', '', true);

  if jsonb_array_length(v_roster) > 0 then
    update public.properties p
       set data = jsonb_set(p.data, '{tenants}',
             coalesce((select jsonb_agg(e order by o)
                         from jsonb_array_elements(p.data->'tenants') with ordinality x(e, o)
                        where not (jsonb_typeof(e) = 'object' and e->>'id' = p_source::text)), '[]'::jsonb))
     where p.id = v_s.property_id;
  end if;
  select data_revision into v_rev_after from public.properties where id = v_s.property_id;

  -- ── the permanent record ────────────────────────────────────────────────
  insert into public.property_events (property_id, actor_uid, action, subject_type, subject_id, old_value, new_value, detail)
  values (v_s.property_id, v_uid, 'leasehold_absorbed', 'leasehold', p_source::text, 'active', 'absorbed',
          jsonb_build_object('source', 'absorb_leasehold', 'target_id', p_target, 'reason', p_reason,
                             'note', trim(p_note), 'absorbed_at', v_at,
                             'source_snapshot', to_jsonb(v_s),
                             'source_roster_entry', v_roster,
                             'target_snapshot_before', to_jsonb(v_t),
                             'moved_documents', v_moved,
                             'eligibility', public.leasehold_history(p_source),
                             'data_revision_seen', v_rev,
                             'data_revision_after', v_rev_after))
  returning id into v_event;

  insert into public.property_events (property_id, actor_uid, action, subject_type, subject_id, detail)
  values (v_s.property_id, v_uid, 'leasehold_absorbed_other', 'leasehold', p_target::text,
          jsonb_build_object('source', 'absorb_leasehold', 'source_id', p_source, 'reason', p_reason,
                             'absorbed_event_id', v_event, 'moved_documents', v_moved))
  returning id into v_event2;

  return jsonb_build_object('ok', true, 'tenant_id', p_source, 'absorbed_into', p_target,
    'property_id', v_s.property_id, 'reason', p_reason, 'absorbed_at', v_at,
    'moved_documents', v_moved, 'roster_entry_removed', jsonb_array_length(v_roster) > 0,
    'data_revision', v_rev_after, 'event_id', v_event, 'target_event_id', v_event2);
end;
$$;

-- ── 13 · restore_absorbed_leasehold ────────────────────────────────────────
create or replace function public.restore_absorbed_leasehold(
  p_tenant_id uuid,
  p_note      text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_s         public.tenants%rowtype;
  v_t         public.tenants%rowtype;
  v_stage     text;
  v_ev_id     uuid;
  v_ev        jsonb;
  v_el        jsonb;
  v_doc       uuid;
  v_back      jsonb := '[]'::jsonb;
  v_conflicts jsonb := '[]'::jsonb;
  v_over      jsonb;
  v_roster    jsonb;
  v_n         integer := 0;
  v_rev_after bigint;
  v_event     uuid;
  v_event2    uuid;
begin
  if v_uid is null then
    raise exception 'restore_absorbed_leasehold requires an authenticated user' using errcode = 'insufficient_privilege';
  end if;
  if p_tenant_id is null then
    raise exception 'restore_absorbed_leasehold needs a leasehold id' using errcode = 'check_violation';
  end if;
  select * into v_s from public.tenants where id = p_tenant_id for update;
  if not found or not exists (select 1 from public.properties p where p.id = v_s.property_id and p.user_id = v_uid) then
    raise exception 'Not authorized: caller does not own the property of leasehold %', p_tenant_id
      using errcode = 'insufficient_privilege';
  end if;
  select lifecycle_stage into v_stage from public.properties where id = v_s.property_id;
  if v_stage is distinct from 'acquired' then
    raise exception 'Property % is %, not acquired', v_s.property_id, coalesce(v_stage, '<none>') using errcode = 'check_violation';
  end if;
  if v_s.leasehold_status <> 'absorbed' then
    raise exception 'Leasehold % is not consolidated into another leasehold; there is nothing to restore', p_tenant_id
      using errcode = 'check_violation';
  end if;
  if p_note is null or trim(p_note) = '' then
    raise exception 'A note is required to restore a consolidated leasehold' using errcode = 'check_violation';
  end if;
  select * into v_t from public.tenants where id = v_s.absorbed_into for update;
  perform 1 from public.properties where id = v_s.property_id for update;

  -- The consolidation's own record: written by absorb_leasehold, for this row and this target.
  select e.id, e.detail into v_ev_id, v_ev
    from public.property_events e
   where e.property_id = v_s.property_id and e.subject_type = 'leasehold' and e.subject_id = p_tenant_id::text
     and e.action = 'leasehold_absorbed' and e.detail->>'source' = 'absorb_leasehold'
     and e.detail->>'target_id' = v_s.absorbed_into::text
   order by e.created_at desc, e.id desc
   limit 1;
  if v_ev_id is null then
    raise exception 'No consolidation record was found for leasehold %; it is not restored', p_tenant_id
      using errcode = 'check_violation';
  end if;

  -- Documents go back where they are still on the target; any moved since stay.
  for v_el in select * from jsonb_array_elements(coalesce(v_ev->'moved_documents', '[]'::jsonb))
  loop
    v_doc := (v_el->>'document_id')::uuid;
    if exists (select 1 from public.lease_documents d
                where d.id = v_doc and d.property_id = v_s.property_id and d.tenant_id = v_s.absorbed_into) then
      update public.lease_documents set tenant_id = p_tenant_id where id = v_doc;
      v_back := v_back || jsonb_build_object('document_id', v_doc, 'file_name', v_el->>'file_name',
        'from_tenant_id', v_s.absorbed_into, 'to_tenant_id', p_tenant_id);
    else
      v_conflicts := v_conflicts || jsonb_build_object('document_id', v_doc, 'file_name', v_el->>'file_name',
        'exists', exists (select 1 from public.lease_documents d where d.id = v_doc),
        'now_tenant_id', (select d.tenant_id from public.lease_documents d where d.id = v_doc));
    end if;
  end loop;

  -- Terms a person adopted onto the target since: listed, never reverted here.
  select coalesce(jsonb_agg(jsonb_build_object('audit_id', a.id, 'field_key', a.field_key, 'old_value', a.old_value,
           'new_value', a.new_value, 'created_at', a.created_at) order by a.created_at, a.id), '[]'::jsonb)
    into v_over
    from public.tenant_review_audit a
   where a.tenant_id = v_s.absorbed_into::text and a.action = 'field_override' and a.created_at >= v_s.absorbed_at;

  perform set_config('mainstreet.leasehold_lifecycle', p_tenant_id::text, true);
  update public.tenants
     set leasehold_status = 'active', absorbed_into = null, absorbed_reason = null, absorbed_at = null
   where id = p_tenant_id;
  perform set_config('mainstreet.leasehold_lifecycle', '', true);

  -- The saved-roster entry returns when the roster is in use and lacks it.
  v_roster := coalesce(v_ev->'source_roster_entry', '[]'::jsonb);
  if jsonb_typeof(v_roster) = 'array' and jsonb_array_length(v_roster) > 0 then
    update public.properties p
       set data = jsonb_set(p.data, '{tenants}', (p.data->'tenants') || v_roster)
     where p.id = v_s.property_id
       and jsonb_typeof(p.data->'tenants') = 'array'
       and jsonb_array_length(p.data->'tenants') > 0
       and not exists (select 1 from jsonb_array_elements(p.data->'tenants') e
                        where jsonb_typeof(e) = 'object' and e->>'id' = p_tenant_id::text);
    get diagnostics v_n = row_count;
  end if;
  select data_revision into v_rev_after from public.properties where id = v_s.property_id;

  insert into public.property_events (property_id, actor_uid, action, subject_type, subject_id, old_value, new_value, detail)
  values (v_s.property_id, v_uid, 'leasehold_restored', 'leasehold', p_tenant_id::text, 'absorbed', 'active',
          jsonb_build_object('source', 'restore_absorbed_leasehold', 'note', trim(p_note),
                             'previous_target_id', v_s.absorbed_into, 'previous_reason', v_s.absorbed_reason,
                             'previous_absorbed_at', v_s.absorbed_at, 'absorbed_event_id', v_ev_id,
                             'moved_back_documents', v_back, 'document_conflicts', v_conflicts,
                             'roster_entry_restored', v_n > 0,
                             'overrides_since_absorption', v_over))
  returning id into v_event;

  insert into public.property_events (property_id, actor_uid, action, subject_type, subject_id, detail)
  values (v_s.property_id, v_uid, 'leasehold_restored_other', 'leasehold', v_s.absorbed_into::text,
          jsonb_build_object('source', 'restore_absorbed_leasehold', 'restored_id', p_tenant_id,
                             'restored_event_id', v_event, 'moved_back_documents', v_back))
  returning id into v_event2;

  return jsonb_build_object('ok', true, 'tenant_id', p_tenant_id, 'property_id', v_s.property_id,
    'leasehold_status', 'active', 'previous_target_id', v_s.absorbed_into,
    'moved_back_documents', v_back, 'document_conflicts', v_conflicts,
    'roster_entry_restored', v_n > 0, 'overrides_since_absorption', v_over,
    'data_revision', v_rev_after, 'event_id', v_event, 'target_event_id', v_event2);
end;
$$;

-- ── 14 · grants ────────────────────────────────────────────────────────────
revoke all on function public.absorb_leasehold(uuid, uuid, text, uuid[], text, bigint) from public, anon;
revoke all on function public.restore_absorbed_leasehold(uuid, text)                   from public, anon;
revoke all on function public.absorb_leasehold_preflight(uuid, uuid)                   from public, anon;
grant execute on function public.absorb_leasehold(uuid, uuid, text, uuid[], text, bigint) to authenticated, service_role;
grant execute on function public.restore_absorbed_leasehold(uuid, text)                   to authenticated, service_role;
grant execute on function public.absorb_leasehold_preflight(uuid, uuid)                   to authenticated, service_role;
revoke all on function public.leasehold_history(uuid)              from public, anon, authenticated, service_role;
revoke all on function public.has_meaningful_history(uuid)         from public, anon, authenticated, service_role;
revoke all on function public._absorb_eligibility(uuid, uuid)      from public, anon, authenticated, service_role;
revoke all on function public._is_demo_property(uuid)              from public, anon, authenticated, service_role;
revoke all on function public._leasehold_tombstoned(uuid)          from public, anon, authenticated, service_role;
revoke all on function public.tenants_absorbed_freeze()            from public, anon, authenticated, service_role;
revoke all on function public.tenants_tombstone_guard()            from public, anon, authenticated, service_role;
revoke all on function public.properties_data_revision()           from public, anon, authenticated, service_role;

comment on function public.resync_property_tenants(uuid, jsonb) is
  'Writes the roster''s ACTIVE leaseholds (insert or update by id). Never deletes: an active leasehold missing from the roster is reported in absent_active. Never writes an ended, absorbed or discarded leasehold: reported in ended_in_roster, absorbed_in_roster, discarded_in_roster. (038, 043)';
comment on function public.discard_leasehold(uuid, text) is
  'Removes a record entered in error: active, no meaningful history (leasehold_history), nothing consolidated into it, not a demo leasehold; documents kept and unlinked; owner only; writes leasehold_discarded with a snapshot, which also keeps the id from ever being re-created. (038, 043)';
comment on function public.absorb_leasehold(uuid, uuid, text, uuid[], text, bigint) is
  'Consolidates a duplicate or fragment leasehold into the leasehold of the same property it belongs to: no meaningful history, owner only, the property revision as last read; its documents move, its saved-roster entry is kept in the event and removed; terms are never copied. Writes leasehold_absorbed and leasehold_absorbed_other. (043)';
comment on function public.restore_absorbed_leasehold(uuid, text) is
  'Undoes a consolidation: required note; owner only; documents still on the target go back; the saved-roster entry returns; overrides adopted since are listed, not reverted. Writes leasehold_restored and leasehold_restored_other. (043)';
comment on function public.absorb_leasehold_preflight(uuid, uuid) is
  'Read only: whether a consolidation is allowed and why not, the source''s history, the property revision, and the documents that must or may move. Owner only. (043)';
comment on function public.leasehold_history(uuid) is
  'The meaningful-history test: one reason per kind of permanent history a leasehold has. Internal. (043)';

commit;
