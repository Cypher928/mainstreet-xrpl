-- ─── 028b_property_events_append_only_fix — Phase 0, P0.3 ───────────────────
--
-- 028 is applied on pilot and is NOT replayed. This corrects three defects in
-- it, in place, by replacing two function bodies and adding one trigger. No
-- column, index, policy, grant or row is touched.
--
-- DEFECT 1 — THE DELETE GUARD NEVER FIRED
--   028 refuses a delete only when `pg_trigger_depth() = 0`. Inside a row
--   trigger the depth is never 0: measured on this database, a direct
--   statement reaches the trigger at depth 1 and a foreign key's own cascade
--   reaches it at depth 2. The condition was therefore unreachable and every
--   DELETE was allowed through. A privileged direct DELETE did succeed.
--
--   The predicate is now `<= 1`: depth 1 is an application statement and is
--   refused; depth 2 or more is the property's own ON DELETE CASCADE and is
--   allowed, so deleting a property still takes its events with it. That
--   remains the one destructive act the product keeps.
--
--   No application role can delete today — authenticated and service_role
--   hold only SELECT and INSERT — but the invariant is not allowed to rest on
--   a grant that a later migration could widen by accident. Both layers say
--   it now.
--
-- DEFECT 2 — TRUNCATE WAS NOT COVERED
--   A `for each row` trigger never fires on TRUNCATE, so a privileged
--   TRUNCATE emptied the table. A statement-level BEFORE TRUNCATE trigger now
--   refuses it outright, for every role including the table owner.
--
-- DEFECT 3 — THE UPDATE GUARD BLOCKED REFERENTIAL CLEANUP
--   028 refused every UPDATE unconditionally. actor_uid and organization_id
--   are both declared ON DELETE SET NULL, and a SET NULL is an UPDATE, so the
--   guard made those foreign keys unreachable: deleting a user or an
--   organisation that had any event failed with "rows are never updated".
--   Once P0.5 starts writing events that would block user deletion outright
--   and break the B1 CI fixture teardown.
--
--   An UPDATE is now allowed only when BOTH hold:
--     · it arrives at depth 2 or more, i.e. from inside another trigger —
--       an application statement is depth 1 and is still refused; and
--     · every column is unchanged except actor_uid and/or organization_id
--       moving from a value to NULL.
--   That is exactly the shape of a SET NULL and nothing else. The event row
--   itself — what happened, to what, when, and the text of it — can never be
--   rewritten by anyone. Attribution is dropped only because the referenced
--   row is gone, which is the same thing the foreign key already promised.
--
-- DEFECT 4 — organization_id WAS TRUSTED FROM THE CALLER
--   028 derived it only when absent, so a member could file an event under
--   any organisation id they liked. It never granted read access (RLS is by
--   property_id) but it could mis-attribute an event in an organisation-scoped
--   listing. It is now derived from the property unconditionally and the
--   caller's value is ignored, so a stored event can never carry a
--   property/organisation pair that disagree.
--
--   actor_uid is unchanged: still stamped from auth.uid() when absent, still
--   refused when it names anyone else.
--
-- PILOT ONLY. Same marker guard. Idempotent. Rollback:
-- 028b_property_events_append_only_fix_rollback.sql (run BEFORE 028's).

begin;

do $$
begin
  if not exists (
    select 1 from public.properties
    where id = 'fd9c09b1-b657-4c58-9999-c3cce28e7600'
  ) then
    raise exception
      'REFUSING TO RUN: pilot marker property not found. This does not appear to be the pilot project (bhmktujbxdbvdmpybmad). 028b must never be applied to production.';
  end if;
end $$;

-- ── Defect 4: the organisation is derived, never accepted ──────────────────
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

  -- Unconditional. Whatever the caller sent is discarded: the organisation of
  -- an event is a fact about the property, not a claim the writer gets to make.
  select p.organization_id into new.organization_id
  from public.properties p where p.id = new.property_id;

  return new;
end $$;

-- ── Defects 1 and 3: append-only, with room for referential cleanup ────────
create or replace function public._property_events_append_only()
returns trigger
language plpgsql
as $$
begin
  -- Depth 1 is a statement someone ran. Depth 2+ means another trigger is
  -- driving, which for this table means a foreign key's own cleanup.
  if tg_op = 'DELETE' then
    if pg_trigger_depth() <= 1 then
      raise exception 'property_events is append-only: rows are never deleted (deleting the property removes them by cascade)'
        using errcode = 'integrity_constraint_violation';
    end if;
    return old;
  end if;

  if pg_trigger_depth() <= 1 then
    raise exception 'property_events is append-only: rows are never updated'
      using errcode = 'integrity_constraint_violation';
  end if;

  -- Reached from inside a trigger. Permit ONLY the SET NULL shape: the two
  -- attribution columns may go to NULL, everything else must be identical.
  if not (
        new.id              is not distinct from old.id
    and new.property_id     is not distinct from old.property_id
    and new.actor_email     is not distinct from old.actor_email
    and new.action          is not distinct from old.action
    and new.subject_type    is not distinct from old.subject_type
    and new.subject_id      is not distinct from old.subject_id
    and new.field_key       is not distinct from old.field_key
    and new.old_value       is not distinct from old.old_value
    and new.new_value       is not distinct from old.new_value
    and new.detail          is not distinct from old.detail
    and new.client_ts       is not distinct from old.client_ts
    and new.created_at      is not distinct from old.created_at
    and (new.actor_uid       is not distinct from old.actor_uid       or new.actor_uid       is null)
    and (new.organization_id is not distinct from old.organization_id or new.organization_id is null)
  ) then
    raise exception 'property_events is append-only: only a foreign key''s own SET NULL cleanup may touch a stored event'
      using errcode = 'integrity_constraint_violation';
  end if;

  return new;
end $$;

-- ── Defect 2: TRUNCATE ─────────────────────────────────────────────────────
create or replace function public._property_events_no_truncate()
returns trigger
language plpgsql
as $$
begin
  raise exception 'property_events is append-only: the table is never truncated'
    using errcode = 'integrity_constraint_violation';
end $$;

drop trigger if exists property_events_no_truncate on public.property_events;
create trigger property_events_no_truncate
  before truncate on public.property_events
  for each statement execute function public._property_events_no_truncate();

commit;

-- ── Verify (run after commit) ──────────────────────────────────────────────
-- A privileged session, which is the only kind that holds these privileges:
--   delete from public.property_events where true;   -- expect 23000
--   truncate public.property_events;                 -- expect 23000
--   update public.property_events set action = 'x';  -- expect 23000
-- Deleting a user or an organisation that an event references must SUCCEED
-- and leave the event in place with that one column NULL.
-- select tgname from pg_trigger where tgrelid = 'public.property_events'::regclass and not tgisinternal;
--   -- property_events_stamp, property_events_append_only, property_events_no_truncate
