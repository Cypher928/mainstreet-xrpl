-- ============================================================================
-- 016_tenant_space_profiles_rollback.sql
-- ============================================================================
-- Drops the space-profile projection and its companion. DESTRUCTIVE: publication
-- state is lost, so a landlord who had published a profile must publish it again
-- after re-applying 016. No landlord-owned data is touched — the projection only
-- ever held copies.
--
-- TARGET: PILOT PROJECT ONLY (bhmktujbxdbvdmpybmad).
-- ============================================================================
begin;

do $$
begin
  if not exists (select 1 from public.properties where id = 'fd9c09b1-b657-4c58-9999-c3cce28e7600') then
    raise exception 'REFUSING TO RUN: pilot marker property not found.';
  end if;
end $$;

drop table if exists public.tenant_space_profile_sources;
drop table if exists public.tenant_space_profiles;

commit;
