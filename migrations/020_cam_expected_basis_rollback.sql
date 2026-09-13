-- ============================================================================
-- 020_cam_expected_basis_rollback.sql
-- ============================================================================
-- TARGET: PILOT PROJECT ONLY (bhmktujbxdbvdmpybmad).
--
-- Drops the CHECK constraint and the expected_cam_basis column added by 020.
--
-- WHAT REVERTING COSTS. Any basis stamped since 020 was applied is destroyed,
-- and with it the only way to tell a repaired row from a legacy one. Unlike
-- 019 this IS recoverable in principle — the basis can be recomputed from
-- capBaseAmount and capPercentage wherever both are still persisted — but it
-- is not recoverable for the rows whose inputs were never stored, which is the
-- majority of the affected set. Reverting after a repair therefore re-creates
-- exactly the ambiguity the repair was performed to remove.
--
-- The application tolerates the column's absence: no code writes or reads it
-- as of this phase, and saveCamResults derives its stamp in memory from
-- r.expectedCamBasis rather than from the table. Reverting degrades to pre-020
-- behaviour rather than breaking anything. That is what makes it safe to run,
-- and it is not a reason to run it.
--
-- The constraint is dropped before the column for clarity only — dropping the
-- column would remove it either way.

alter table public.cam_reconciliations
  drop constraint if exists cam_recon_expected_basis_chk;

alter table public.cam_reconciliations
  drop column if exists expected_cam_basis;
