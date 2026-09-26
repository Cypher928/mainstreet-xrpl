-- ─── 030_property_events_derive — ROLLBACK ──────────────────────────────────
-- Stops deriving durable history from the property blob and removes the
-- machinery that did it.
--
-- WHAT IS LOST
--   · The watermark. Re-applying 030 afterwards re-seeds it from whatever the
--     blobs hold AT THAT MOMENT, which by then includes entries written since
--     the original migration. Those would then be classified pre-existing and
--     never derived. Re-applying is therefore not a no-op: events written in
--     the window between rollback and re-apply are permanently excluded from
--     derivation. They remain in the blob; they simply never become rows.
--   · source_key on every event derived so far. The rows themselves SURVIVE —
--     this rollback does not delete history, and could not: 028b refuses a
--     direct DELETE. Only their link back to the blob entry is dropped, so a
--     later re-apply cannot tell they were already recorded and would insert
--     them again under new source keys.
--
-- Because of that second point, prefer disabling the trigger to running this
-- file if the intent is temporary:
--   alter table public.properties disable trigger property_events_derive;
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

drop trigger   if exists property_events_derive on public.properties;
drop function  if exists public._property_events_derive();
drop function  if exists public._p05_safe_ts(text);

drop table     if exists public.property_events_watermark;

drop index     if exists public.property_events_source_key_uniq;
alter table public.property_events drop column if exists source_key;

commit;
