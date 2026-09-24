-- ============================================================================
-- 015b_tenant_access_privileges.sql — the Data API privileges tenant_users and
-- tenant_invitations actually need, granted explicitly
-- ============================================================================
-- TARGET: PILOT PROJECT ONLY (bhmktujbxdbvdmpybmad), where 012–015 ran.
--
-- FORWARD-ONLY. 012 and 014 are not edited: they are the record of what Pilot
-- ran. Any build replays 012–015 and then this file.
--
-- WHY
-- ---
-- From October 30, 2026, Supabase stops granting anon, authenticated and
-- service_role anything on objects newly created in `public`. 012 and 014 never
-- granted these tables to anyone; they relied on the old automatic grant. So a
-- project built after that date would give the app no access at all. On Pilot
-- the opposite holds: the automatic grant gave authenticated and service_role
-- EVERY privilege (anon was revoked by 013 and 014), far beyond what any caller
-- uses; RLS is the only thing narrowing it.
--
-- Revoke-then-grant makes both reach the same exact set.
--
-- WHAT EACH GRANT IS FOR (every caller on every branch that carries these tables)
-- ---------------------------------------------------------------------------
-- tenant_users
--   authenticated  SELECT   portal.js / auth-service.js read the caller's own
--                           membership (RLS: tenant_users_self_select).
--   service_role   SELECT   api/tenant-accept-invite.js (return=representation),
--                           api/tenant-document-url.js (B2) GET, fixtures.
--                  INSERT,  api/tenant-accept-invite.js POST
--                  UPDATE   resolution=merge-duplicates — an upsert needs both.
--                  DELETE   scripts/provision-pilot-authz-fixture.js clears its own
--                           fixture memberships before re-seeding. FIXTURE ONLY:
--                           no application path deletes a membership.
-- tenant_invitations
--   authenticated  none     no browser code reads or writes invitations.
--   service_role   SELECT,  api/tenant-accept-invite.js GET by token_hash, then
--                  UPDATE   PATCH return=representation. Nothing on any branch
--                           creates an invitation, so there is no INSERT.
-- anon             none on either table (unchanged: 013/014 already revoked it).
--
-- Deletions that reach these tables by ON DELETE CASCADE from properties/tenants
-- run as the table owner and need no grant.
--
-- DORMANT ON PURPOSE: tenant_users_landlord_all and
-- tenant_invitations_landlord_all would let a landlord write at the RLS level,
-- but no landlord code uses them, so authenticated gets no write privilege. The
-- migration that adds a landlord invite/revoke screen adds the privilege it needs.
--
-- Changes no table, column, policy, function or row. Safe to re-run.
-- ============================================================================

revoke all on public.tenant_users       from anon, authenticated, service_role;
grant select                         on public.tenant_users       to authenticated;
grant select, insert, update, delete on public.tenant_users       to service_role;

revoke all on public.tenant_invitations from anon, authenticated, service_role;
grant select, update                 on public.tenant_invitations to service_role;
