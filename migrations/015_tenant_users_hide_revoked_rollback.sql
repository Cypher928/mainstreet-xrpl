-- ============================================================================
-- 015_tenant_users_hide_revoked_rollback.sql
-- ============================================================================
-- Restores tenant_users_self_select to its 012 form, in which a tenant can read
-- its own membership row regardless of accepted_at / revoked_at.
--
-- Reverting re-opens nothing lateral — the policy is still own-rows-only — but
-- it does restore the split definition of membership that 015 removed, and it
-- will fail T9b in the B1 authorization gate. That failure is the intended
-- signal, not noise: run this only to unblock, and re-apply 015.
--
-- TARGET: PILOT PROJECT ONLY (bhmktujbxdbvdmpybmad).
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

drop policy if exists tenant_users_self_select on public.tenant_users;

create policy tenant_users_self_select on public.tenant_users
  for select to authenticated
  using (user_id = auth.uid());

commit;
