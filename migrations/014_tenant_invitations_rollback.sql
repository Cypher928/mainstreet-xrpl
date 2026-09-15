-- ============================================================================
-- 014_tenant_invitations_rollback.sql — reverses 014
-- ============================================================================
-- TARGET: PILOT PROJECT ONLY (bhmktujbxdbvdmpybmad).
--
-- Safe by construction: 014 is strictly additive, so this drops only what it
-- created. No pre-existing landlord policy is referenced in either direction,
-- which means rollback cannot break landlord access.
--
-- DESTRUCTIVE STEP: dropping public.tenant_invitations discards issued
-- invitations. Memberships already created from accepted invitations live in
-- tenant_users and are NOT affected — an accepted tenant keeps their access.
-- Outstanding un-redeemed invitations are lost and must be re-issued.
--
-- If any invitations are outstanding, capture them first:
--   select id, tenant_id, property_id, email, expires_at
--   from public.tenant_invitations
--   where accepted_at is null and revoked_at is null;
--
-- The citext extension is intentionally left installed; dropping an extension
-- other code may later depend on is a wider change than this rollback owns.
-- ============================================================================

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

drop policy if exists tenant_invitations_landlord_all     on public.tenant_invitations;
drop policy if exists tenant_invitations_service_role_all on public.tenant_invitations;

-- Drops the table together with its indexes and both foreign keys.
drop table if exists public.tenant_invitations;

commit;
