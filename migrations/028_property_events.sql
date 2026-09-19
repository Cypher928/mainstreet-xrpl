-- ─── 028_property_events — Phase 0, P0.3 ────────────────────────────────────
--
-- The durable "who did what, when" (Finding 4 of the audit). Today three
-- writers exist and only two are durable: tenant_field_evidence and
-- tenant_review_audit record reviewer_uid/email for FIELD-level acts; the
-- activityLog and timeline live in the property blob, capped and rewritten
-- whole on every save, and carry 'User' or a role label as the actor.
--
-- property_events is ONE append-only, identity-stamped table for every kind
-- of act on a property — upload, classification, retype, field and provision
-- entry, confirmation, stage change, dismissal, export. It does not replace
-- tenant_review_audit (which stays the field-review record with its own
-- dedup key) and it does not replace the blob logs as what the timeline
-- RENDERS today; P0.5 makes the existing writers dual-write here so this
-- becomes the record. One event table, not a second audit silo.
--
-- APPEND-ONLY BY CONSTRUCTION, NOT BY CONVENTION
--   · no UPDATE or DELETE policy for any role, and no UPDATE/DELETE grant to
--     authenticated or service_role;
--   · a trigger refuses every UPDATE, and every DELETE that is not the
--     cascade of the property itself being deleted (pg_trigger_depth() = 0
--     means a direct statement; a cascade runs inside the FK trigger).
--     Deleting a property is the one destructive act the product keeps, and
--     its events go with it — the same rule every other child table follows.
--
-- IDENTITY-STAMPED BY CONSTRUCTION
--   actor_uid must be the caller. A member inserting through PostgREST has
--   auth.uid(); the trigger sets actor_uid to it when absent and REFUSES a
--   row that names someone else. The service role (auth.uid() null) may
--   write on behalf of a named actor — the API routes verify the bearer
--   first, exactly as they do for every other write.
--
-- organization_id is stamped from the property when absent, so an event can
-- be listed per organisation without a join.
--
-- PILOT ONLY. Same marker guard. Idempotent. Rollback: 028_property_events_rollback.sql.

begin;

do $$
begin
  if not exists (
    select 1 from public.properties
    where id = 'fd9c09b1-b657-4c58-9999-c3cce28e7600'
  ) then
    raise exception
      'REFUSING TO RUN: pilot marker property not found. This does not appear to be the pilot project (bhmktujbxdbvdmpybmad). 028 must never be applied to production.';
  end if;
end $$;

-- ── Table ──────────────────────────────────────────────────────────────────
create table if not exists public.property_events (
  id              uuid        primary key default gen_random_uuid(),
  property_id     uuid        not null references public.properties(id) on delete cascade,
  organization_id uuid        references public.organizations(id) on delete set null,
  actor_uid       uuid        references auth.users(id) on delete set null,
  actor_email     text,
  action          text        not null check (length(action) between 1 and 80),
  subject_type    text,
  subject_id      text,
  field_key       text,
  old_value       text,
  new_value       text,
  detail          jsonb       not null default '{}'::jsonb,
  client_ts       timestamptz not null default now(),
  created_at      timestamptz not null default now()
);

comment on table public.property_events is
  'P0.3: append-only, identity-stamped record of every act on a property. No update or delete for any role; a direct delete is refused by trigger and only the property''s own cascade removes rows. actor_uid is the caller for member writes.';
comment on column public.property_events.action is
  'P0.3: what happened — e.g. document_uploaded, document_classified, document_retyped, field_entered, field_confirmed, provision_entered, provision_confirmed, stage_changed, attention_dismissed, report_exported. The vocabulary is owned by property-events.js (P0.5).';
comment on column public.property_events.subject_type is
  'P0.3: what the act was about — document | tenant | provision | field | property | report.';
comment on column public.property_events.client_ts is
  'P0.3: the moment the act happened on the client; created_at is when the row arrived.';

-- ── Indexes ────────────────────────────────────────────────────────────────
create index if not exists property_events_property_time_idx on public.property_events (property_id, created_at desc);
create index if not exists property_events_actor_idx         on public.property_events (actor_uid) where actor_uid is not null;
create index if not exists property_events_org_time_idx      on public.property_events (organization_id, created_at desc) where organization_id is not null;
create index if not exists property_events_subject_idx       on public.property_events (property_id, subject_type, subject_id) where subject_id is not null;

-- ── Stamp identity and organisation on the way in ──────────────────────────
-- Security definer so the organisation lookup does not depend on the
-- caller's read of properties (a member can read the row anyway; the
-- service role has no auth.uid()). search_path empty, as every helper here.
create or replace function public._property_events_stamp()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is not null then
    if new.actor_uid is null then
      new.actor_uid := v_caller;
    elsif new.actor_uid <> v_caller then
      raise exception 'property_events.actor_uid must be the caller' using errcode = 'insufficient_privilege';
    end if;
  end if;
  if new.organization_id is null then
    select p.organization_id into new.organization_id
    from public.properties p where p.id = new.property_id;
  end if;
  return new;
end $$;

drop trigger if exists property_events_stamp on public.property_events;
create trigger property_events_stamp
  before insert on public.property_events
  for each row execute function public._property_events_stamp();

-- ── Append-only ────────────────────────────────────────────────────────────
create or replace function public._property_events_append_only()
returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'property_events is append-only: rows are never updated' using errcode = 'integrity_constraint_violation';
  end if;
  -- A DELETE at depth 0 is a direct statement. A cascade from the property
  -- row runs inside the FK trigger, at depth >= 1, and is allowed.
  if pg_trigger_depth() = 0 then
    raise exception 'property_events is append-only: rows are never deleted (deleting the property removes them by cascade)' using errcode = 'integrity_constraint_violation';
  end if;
  return old;
end $$;

drop trigger if exists property_events_append_only on public.property_events;
create trigger property_events_append_only
  before update or delete on public.property_events
  for each row execute function public._property_events_append_only();

-- ── RLS ────────────────────────────────────────────────────────────────────
alter table public.property_events enable row level security;

revoke all on public.property_events from public, anon;
revoke all on public.property_events from authenticated, service_role;
grant select, insert on public.property_events to authenticated;
grant select, insert on public.property_events to service_role;

drop policy if exists property_events_member_select      on public.property_events;
drop policy if exists property_events_member_insert      on public.property_events;
drop policy if exists property_events_service_role_select on public.property_events;
drop policy if exists property_events_service_role_insert on public.property_events;

create policy property_events_member_select on public.property_events
  for select to authenticated
  using (property_id in (select public.member_property_ids()));
create policy property_events_member_insert on public.property_events
  for insert to authenticated
  with check (property_id in (select public.member_property_ids()));
create policy property_events_service_role_select on public.property_events
  for select to service_role using (true);
create policy property_events_service_role_insert on public.property_events
  for insert to service_role with check (true);

commit;

-- ── Verify (run after commit) ──────────────────────────────────────────────
-- select count(*) from public.property_events;                                                              -- expect 0
-- select policyname, cmd from pg_policies where tablename = 'property_events' order by 1;                    -- 4 rows, none UPDATE/DELETE/ALL
-- select has_table_privilege('authenticated', 'public.property_events', 'update'), has_table_privilege('service_role', 'public.property_events', 'delete');  -- false, false
-- select tgname from pg_trigger where tgrelid = 'public.property_events'::regclass and not tgisinternal;   -- property_events_stamp, property_events_append_only
