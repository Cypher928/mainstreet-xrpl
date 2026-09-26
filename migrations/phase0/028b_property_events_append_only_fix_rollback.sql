-- ─── 028b_property_events_append_only_fix — ROLLBACK ────────────────────────
-- Puts back exactly what 028 left behind: the unreachable delete guard, the
-- unconditional update refusal, the conditional organisation stamp, and no
-- truncate protection.
--
-- THERE IS NO GOOD REASON TO RUN THIS. It reopens all four defects:
--   · a privileged DELETE and TRUNCATE empty the event log again;
--   · deleting a user or an organisation that has events fails again;
--   · a caller can label an event with any organisation id.
-- It exists so the pair is reversible and so 028's own rollback has a defined
-- starting point. RUN THIS BEFORE 028_property_events_rollback.sql — that
-- rollback drops the table and 028's two functions, but knows nothing about
-- the truncate trigger's function, which this file removes.
--
-- No data is touched either way. Stored events are unchanged.
--
-- PILOT ONLY — same guard as the migration.

begin;

do $$
begin
  if not exists (
    select 1 from public.properties
    where id = 'fd9c09b1-b657-4c58-9999-c3cce28e7600'
  ) then
    raise exception
      'REFUSING TO RUN: pilot marker property not found. This does not appear to be the pilot project (bhmktujbxdbvdmpybmad).';
  end if;
end $$;

drop trigger  if exists property_events_no_truncate on public.property_events;
drop function if exists public._property_events_no_truncate();

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

create or replace function public._property_events_append_only()
returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'property_events is append-only: rows are never updated' using errcode = 'integrity_constraint_violation';
  end if;
  if pg_trigger_depth() = 0 then
    raise exception 'property_events is append-only: rows are never deleted (deleting the property removes them by cascade)' using errcode = 'integrity_constraint_violation';
  end if;
  return old;
end $$;

commit;
