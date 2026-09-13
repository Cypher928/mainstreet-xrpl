-- ============================================================================
-- 012_tenant_users_phase_a_rollback.sql — reverses 012_tenant_users_phase_a
-- ============================================================================
-- TARGET: PILOT PROJECT ONLY (bhmktujbxdbvdmpybmad).
--
-- Safe by construction: the forward migration is strictly additive, so this
-- drops only objects that migration created. No pre-existing landlord policy
-- is referenced or modified, which means rollback CANNOT break landlord
-- access — the `properties.user_id = auth.uid()` chain is never touched in
-- either direction.
--
-- DESTRUCTIVE STEP: dropping public.tenant_users discards membership records.
-- If any real (non-test) memberships exist, dump them first:
--   select * from public.tenant_users;
-- ============================================================================

begin;

-- Same pilot guard as the forward migration.
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

-- Drop in reverse dependency order.
drop policy if exists tenants_tenant_self_select    on public.tenants;

drop policy if exists tenant_users_self_select      on public.tenant_users;
drop policy if exists tenant_users_landlord_all     on public.tenant_users;
drop policy if exists tenant_users_service_role_all on public.tenant_users;

drop function if exists public.tenant_ids_for_current_user();

-- Drops the table together with its indexes and both foreign keys.
drop table if exists public.tenant_users;

-- Only meaningful once tenant_users (and its composite FK) is gone.
alter table public.tenants drop constraint if exists tenants_id_property_uniq;

commit;
