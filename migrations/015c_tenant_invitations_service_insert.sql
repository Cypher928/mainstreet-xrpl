-- ============================================================================
-- 015c_tenant_invitations_service_insert.sql — the server may create an
-- invitation: INSERT on tenant_invitations for service_role
-- ============================================================================
-- TARGET: PILOT PROJECT ONLY (bhmktujbxdbvdmpybmad). Refuses to run anywhere
-- the Pilot marker property is absent.
--
-- FORWARD-ONLY COMPANION TO 015b. 015b is not edited: it is the record of what
-- Pilot ran on 2026-09-24. Any build replays 012–015, 015b and then this file.
-- Order matters: 015b revokes everything and grants back SELECT, UPDATE, so
-- 015b re-run after this file would silently remove the grant made here. This
-- file is re-run after it. (Neither is normally run twice; the migration
-- history records each once.)
--
-- WHY
-- ---
-- 015b narrowed service_role on tenant_invitations to SELECT, UPDATE on the
-- premise "nothing on any branch creates an invitation". That was true of the
-- application and of both fixture scripts, and it is still true of the
-- application. It overlooked the B1 authorization gate: test-tenant-authz.js
-- has, since 2026-08-16, played the landlord itself and ISSUED invitations as
-- the service role (its issueInvitation helper, cases T17, T19, T20c), because
-- the landlord invite screen does not exist yet and the accept-invite route
-- only redeems. From the first gate run after 015b was applied (run 187,
-- 2026-09-24 01:04Z) every run has failed those three lines with 42501, and
-- everything downstream of them — T17b/c, T18, T19b–g, T21: acceptance
-- restores a revoked tenant, re-acceptance creates no duplicate, an
-- outstanding invitation grants nothing — has gone unverified live.
--
-- WHAT THIS GRANTS, AND TO WHOM
-- -----------------------------
-- INSERT on public.tenant_invitations to service_role, and nothing else:
--   · service_role is server-only; it never reaches a browser.
--   · 014's policy tenant_invitations_service_role_all (FOR ALL, using and
--     with check true) has always permitted this at the row level. Only the
--     grant layer, narrowed by 015b, refused it.
--   · Precedent: 015b itself grants service_role DELETE on tenant_users
--     "FIXTURE ONLY" — a privilege no application path uses, held so the
--     authorization fixtures can do their job. This is the same kind of grant
--     for the same suite.
--   · authenticated and anon are untouched: authenticated still holds nothing
--     on this table (048's admin FOR ALL rule stays dormant until a landlord
--     invite screen grants it), anon still holds nothing.
--   · DELETE is still not granted to service_role; cascades run as the owner.
--
-- Changes no table, column, policy, function or row. Safe to re-run.
--
-- Rollback: migrations/015c_tenant_invitations_service_insert_rollback.sql
-- (revokes exactly this INSERT; 015b's SELECT, UPDATE remain).
-- ============================================================================

begin;

do $$
begin
  if not exists (select 1 from public.properties where id = 'fd9c09b1-b657-4c58-9999-c3cce28e7600') then
    raise exception 'REFUSING TO RUN: pilot marker property not found. This does not appear to be the pilot project (bhmktujbxdbvdmpybmad). 015c must never be applied to production.';
  end if;
  if to_regclass('public.tenant_invitations') is null then
    raise exception '015c requires 014 (tenant_invitations)';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tenant_invitations'
                   and policyname = 'tenant_invitations_service_role_all') then
    raise exception '015c requires 014''s service-role policy on tenant_invitations (tenant_invitations_service_role_all)';
  end if;
end $$;

grant insert on public.tenant_invitations to service_role;

commit;
