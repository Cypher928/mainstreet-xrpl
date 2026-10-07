-- ============================================================================
-- 015c_tenant_invitations_service_insert_rollback.sql
-- ============================================================================
-- Revokes exactly what 015c granted: INSERT on public.tenant_invitations from
-- service_role. 015b's SELECT, UPDATE for service_role remain; authenticated
-- and anon are untouched (they hold nothing on this table). Changes no row.
--
-- After this rollback the B1 authorization gate's re-invitation cases (T17,
-- T19, T20c) fail again with 42501, as they did from 2026-09-24 to 015c.
--
-- TARGET: PILOT PROJECT (bhmktujbxdbvdmpybmad) ONLY. Refuses to run unless the
-- Pilot marker property exists.
-- ============================================================================

begin;

do $$
begin
  if not exists (select 1 from public.properties where id = 'fd9c09b1-b657-4c58-9999-c3cce28e7600') then
    raise exception 'REFUSING TO RUN: pilot marker property not found. This does not appear to be the pilot project (bhmktujbxdbvdmpybmad). The 015c rollback must never be run on production.';
  end if;
end $$;

revoke insert on public.tenant_invitations from service_role;

commit;
