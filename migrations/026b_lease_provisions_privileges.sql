-- ─── 026b_lease_provisions_privileges — Phase 0, P0.3 hardening ─────────────
--
-- WHY THIS FILE EXISTS
-- 026 created lease_provisions and granted authenticated SELECT, INSERT and
-- UPDATE. On a Supabase project the schema's DEFAULT PRIVILEGES grant every
-- new table ALL privileges to anon, authenticated and service_role at the
-- moment it is created, and 026's grant was additive — so after 026 the
-- authenticated role also held DELETE, TRUNCATE, REFERENCES and TRIGGER on
-- the table. Row-level security still refused every member delete (026 has
-- no DELETE policy; a live probe deleted 0 rows), but the contract is that
-- BOTH layers enforce "members do not delete provisions", and the privilege
-- layer did not.
--
-- 026 is already applied to pilot and is not replayed. This file corrects
-- the privilege set in place and nothing else: no column, no policy, no
-- trigger, no row is touched. The intended set for authenticated is exactly
-- SELECT, INSERT, UPDATE.
--
-- 029 (not yet applied at the time of this file) carries the same explicit
-- revoke for financial_sources and gl_entries in its own text.
--
-- PILOT ONLY. Same marker guard. Idempotent. Rollback: 026b_lease_provisions_privileges_rollback.sql.

begin;

do $$
begin
  if not exists (
    select 1 from public.properties
    where id = 'fd9c09b1-b657-4c58-9999-c3cce28e7600'
  ) then
    raise exception
      'REFUSING TO RUN: pilot marker property not found. This does not appear to be the pilot project (bhmktujbxdbvdmpybmad). 026b must never be applied to production.';
  end if;
end $$;

-- Authenticated members: exactly select, insert, update. Nothing else.
revoke delete, truncate, references, trigger on public.lease_provisions from authenticated;
grant  select, insert, update                  on public.lease_provisions to   authenticated;

-- anon: nothing, as 026 already said.
revoke all on public.lease_provisions from public, anon;

commit;

-- ── Verify (run after commit) ──────────────────────────────────────────────
-- select string_agg(privilege_type, ',' order by privilege_type) from information_schema.role_table_grants
--   where table_name = 'lease_provisions' and grantee = 'authenticated';                       -- expect INSERT,SELECT,UPDATE
-- select has_table_privilege('authenticated', 'public.lease_provisions', 'delete');             -- expect false
-- select has_table_privilege('anon', 'public.lease_provisions', 'select');                      -- expect false
-- select policyname from pg_policies where tablename = 'lease_provisions' order by 1;           -- unchanged: 4 policies
