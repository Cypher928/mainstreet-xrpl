-- ============================================================================
-- 018b_tenant_portal_privileges_rollback.sql
-- ============================================================================
-- Restores the privileges Pilot held before 018b, as observed on Pilot
-- (information_schema.role_table_grants, read-only): authenticated and
-- service_role held every table privilege on all six tables; anon held none.
--
-- WARNING: this WIDENS access again. RLS still narrows rows, but authenticated
-- regains every write privilege at the grant level.
-- ============================================================================

revoke all on public.tenant_space_profiles        from anon, authenticated, service_role;
revoke all on public.tenant_space_profile_sources from anon, authenticated, service_role;
revoke all on public.tenant_statements            from anon, authenticated, service_role;
revoke all on public.tenant_statement_sources     from anon, authenticated, service_role;
revoke all on public.tenant_documents             from anon, authenticated, service_role;
revoke all on public.tenant_document_sources      from anon, authenticated, service_role;

grant all on public.tenant_space_profiles        to authenticated, service_role;
grant all on public.tenant_space_profile_sources to authenticated, service_role;
grant all on public.tenant_statements            to authenticated, service_role;
grant all on public.tenant_statement_sources     to authenticated, service_role;
grant all on public.tenant_documents             to authenticated, service_role;
grant all on public.tenant_document_sources      to authenticated, service_role;
