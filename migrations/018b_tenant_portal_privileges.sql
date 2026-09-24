-- ============================================================================
-- 018b_tenant_portal_privileges.sql — the Data API privileges the six tenant
-- portal tables (016–018) actually need, granted explicitly
-- ============================================================================
-- TARGET: PILOT PROJECT ONLY (bhmktujbxdbvdmpybmad), where 016–018 ran.
-- Runs after 015b_tenant_access_privileges.sql, which covers tenant_users
-- (read by api/tenant-document-url.js below).
--
-- FORWARD-ONLY. 016, 017 and 018 are not edited: they are the record of what
-- Pilot ran. Any build replays 016–018 and then this file.
--
-- WHY: 016–018 created these tables and granted them to no one (they only
-- revoked anon), relying on Supabase's automatic grant, which stops for new
-- objects on October 30, 2026. On Pilot the automatic grant gave authenticated
-- and service_role EVERY privilege on all six; RLS was the only narrowing.
-- Revoke-then-grant makes Pilot and any newly built project reach the same set.
--
-- WHAT EACH GRANT IS FOR. Every B2 server handler uses the service-role key;
-- the only browser code is portal.js, and it only reads.
--
-- tenant_space_profiles
--   authenticated  SELECT          portal.js
--   service_role   SELECT, INSERT  scripts/b1-ci-fixture.js POST
--                                  return=representation. FIXTURE ONLY.
-- tenant_space_profile_sources     no caller on any branch: nothing.
-- tenant_statements
--   authenticated  SELECT          portal.js; payment_balances (022, security
--                                  invoker) joins it.
--   service_role   SELECT, UPDATE  api/tenant-unpublish-statement.js PATCH
--                                  return=representation.
--                  INSERT          scripts/b1-ci-fixture.js. FIXTURE ONLY —
--                                  the app publishes through
--                                  publish_tenant_statement(), SECURITY DEFINER,
--                                  whose own EXECUTE grant (017) is unchanged.
-- tenant_statement_sources
--   service_role   SELECT, INSERT  scripts/b1-ci-fixture.js POST with the
--                                  fixture's default return=representation.
--                                  FIXTURE ONLY.
-- tenant_documents
--   authenticated  SELECT          portal.js
--   service_role   SELECT, INSERT, api/tenant-publish-document.js POST
--                  UPDATE          return=representation, then PATCH to withdraw;
--                                  api/tenant-document-url.js GET.
-- tenant_document_sources
--   service_role   SELECT, INSERT  api/tenant-publish-document.js POST;
--                                  api/tenant-document-url.js GET.
-- anon             none, anywhere (unchanged: 016–018 already revoked it).
--
-- No DELETE anywhere: deletions reach these tables only by ON DELETE CASCADE,
-- which runs as the table owner.
--
-- DORMANT ON PURPOSE: each table's `…_landlord_all` policy would let a landlord
-- write at the RLS level, but no landlord browser code uses it, so
-- authenticated gets no write privilege. The migration that adds a landlord
-- editing screen adds the privilege it needs.
--
-- Changes no table, column, policy, function or row. Safe to re-run.
-- ============================================================================

revoke all on public.tenant_space_profiles        from anon, authenticated, service_role;
revoke all on public.tenant_space_profile_sources from anon, authenticated, service_role;
grant select                 on public.tenant_space_profiles    to authenticated;
grant select, insert         on public.tenant_space_profiles    to service_role;

revoke all on public.tenant_statements            from anon, authenticated, service_role;
revoke all on public.tenant_statement_sources     from anon, authenticated, service_role;
grant select                 on public.tenant_statements        to authenticated;
grant select, insert, update on public.tenant_statements        to service_role;
grant select, insert         on public.tenant_statement_sources to service_role;

revoke all on public.tenant_documents             from anon, authenticated, service_role;
revoke all on public.tenant_document_sources      from anon, authenticated, service_role;
grant select                 on public.tenant_documents         to authenticated;
grant select, insert, update on public.tenant_documents         to service_role;
grant select, insert         on public.tenant_document_sources  to service_role;
