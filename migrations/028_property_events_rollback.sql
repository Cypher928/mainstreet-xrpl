-- ─── 028_property_events — ROLLBACK ─────────────────────────────────────────
-- Drops the event table, its two triggers and their functions.
--
-- DATA: the durable audit trail written since 028 is destroyed. This is the
-- record of who did what; export it first if anything real has happened:
--
--   select * from public.property_events order by created_at;
--
-- The append-only trigger is dropped before the table so the drop is not
-- refused. tenant_review_audit, tenant_field_evidence and the blob logs are
-- untouched.
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

drop policy if exists property_events_member_select       on public.property_events;
drop policy if exists property_events_member_insert       on public.property_events;
drop policy if exists property_events_service_role_select on public.property_events;
drop policy if exists property_events_service_role_insert on public.property_events;

drop trigger  if exists property_events_append_only on public.property_events;
drop trigger  if exists property_events_stamp       on public.property_events;
drop function if exists public._property_events_append_only();
drop function if exists public._property_events_stamp();

drop table if exists public.property_events;

commit;
