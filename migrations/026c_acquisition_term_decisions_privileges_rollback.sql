-- ============================================================================
-- 026c_acquisition_term_decisions_privileges_rollback.sql
-- ============================================================================
-- Restores the privileges Pilot held before 026c, as observed on Pilot
-- (read-only): anon, authenticated and service_role held every table privilege.
--
-- WARNING: this WIDENS access again, anon included. The append-only trigger
-- still refuses UPDATE and DELETE, and RLS still has no anon policy, but the
-- grant-level defence is gone.
-- ============================================================================

revoke all on public.acquisition_term_decisions from anon, authenticated, service_role;
grant all  on public.acquisition_term_decisions to anon, authenticated, service_role;
