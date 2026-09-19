-- ============================================================================
-- 013_tenant_users_revoke_anon_rollback.sql — reverses 013
-- ============================================================================
-- TARGET: PILOT PROJECT ONLY (bhmktujbxdbvdmpybmad).
--
-- Restores the Supabase default grant that public.tenant_users had when
-- migration 012 created it. Only needed if some later component turns out to
-- require anonymous access to membership rows — which would itself deserve
-- scrutiny, since tenant_users is the tenant authorization source of truth and
-- has no legitimate pre-login use.
--
-- Note the asymmetry: 013 removes a privilege, so rolling it back GRANTS one.
-- Unlike the 012 rollback, this direction widens access rather than narrowing
-- it. Apply it deliberately, not as routine cleanup.
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

grant all on public.tenant_users to anon;

commit;
