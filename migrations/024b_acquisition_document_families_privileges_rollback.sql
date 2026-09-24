-- ============================================================================
-- 024b_acquisition_document_families_privileges_rollback.sql
-- ============================================================================
-- Restores the privileges Pilot held before 024b, as observed on Pilot
-- (read-only): anon, authenticated and service_role held every table privilege.
--
-- WARNING: this WIDENS access again, anon included. RLS still has no anon
-- policy, so anon reads no rows, but the grant-level defence is gone.
-- ============================================================================

revoke all on public.acquisition_document_families from anon, authenticated, service_role;
grant all  on public.acquisition_document_families to anon, authenticated, service_role;
