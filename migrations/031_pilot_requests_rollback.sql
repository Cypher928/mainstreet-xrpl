-- ============================================================================
-- 031_pilot_requests_rollback.sql
-- ============================================================================
-- THIS DOES NOT DROP THE TABLE. pilot_requests holds real inbound leads; a
-- rollback that deleted them would lose data that exists nowhere else. The
-- table predates 031 on Pilot (created by hand), so "before 031" includes it.
--
-- It restores only the privileges Pilot held before 031, as observed on Pilot
-- (read-only): anon, authenticated and service_role held every table privilege.
--
-- WARNING: this WIDENS access again, anon included. RLS with no policies still
-- keeps anon and authenticated from reading rows, but the grant-level defence
-- is gone.
--
-- Removing the table itself, on a project where 031 created it, is a manual,
-- deliberate step — export the rows first.
-- ============================================================================

revoke all on public.pilot_requests from anon, authenticated, service_role;
grant all  on public.pilot_requests to anon, authenticated, service_role;
