-- ============================================================================
-- 015b_tenant_access_privileges_rollback.sql
-- ============================================================================
-- Restores the privileges Pilot held before 015b, as observed on Pilot
-- (information_schema.role_table_grants, read-only): authenticated and
-- service_role held every table privilege on both tables; anon held none.
--
-- WARNING: this WIDENS access again. RLS still narrows rows, but authenticated
-- regains INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER at the grant level.
--
-- On a project built after October 30, 2026 this does not restore "nothing":
-- it restores Pilot's state, which is the only state 015b replaced.
-- ============================================================================

revoke all on public.tenant_users       from anon, authenticated, service_role;
grant all  on public.tenant_users       to authenticated, service_role;

revoke all on public.tenant_invitations from anon, authenticated, service_role;
grant all  on public.tenant_invitations to authenticated, service_role;
