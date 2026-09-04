-- ============================================================================
-- 020_cam_expected_basis.sql — which arithmetic produced expected_cam
-- ============================================================================
-- TARGET: PILOT PROJECT ONLY (bhmktujbxdbvdmpybmad).
-- NEVER apply to production (zhsuhehgehbzkmzurzyf).
--
-- WHY
-- ---
-- Phase H settled that expected_cam is a dollar ceiling or it is nothing:
--
--     capBaseAmount x (1 + capPercentage/100)          script.js:_camCeilingCents
--
-- and that the producer STAMPS the basis rather than letting a persister sniff
-- it — because nothing downstream can tell 5 (a cap percentage) from 5.00 (a
-- small ceiling) by looking at the number. saveCamResults already computes that
-- stamp and refuses to write an unstamped value:
--
--     const _stamped = r.expectedCamBasis === 'cap_ceiling' && ...
--     const expected = _stamped ? r.expectedCam : null;      script.js:24967
--
-- The stamp has existed only in memory, because this table has no column for
-- it. So the guard can keep a bad value OUT, but a row already stored cannot
-- say which arithmetic made it. Measured on pilot before this migration: 46
-- rows, 28 with a non-null expected_cam, and all 28 are whole numbers in the
-- range 3..8 with variance = actual_cam - expected_cam — every one a cap
-- percentage sitting in a dollar column. There is not one legitimately-derived
-- ceiling in the table, and nothing stored distinguishes those 28 from a
-- correct row.
--
-- WHAT THE THREE STATES MEAN
-- --------------------------
--   'cap_ceiling'        Produced by the current authoritative calculation.
--                        Safe to display as money and to expose externally.
--
--   'legacy_unverified'  Written before that calculation existed. The value is
--                        NOT a dollar ceiling and must never be rendered as
--                        one. Reserved for a future repair to mark rows it
--                        chooses to label rather than null.
--
--   NULL                 No basis recorded. This means UNKNOWN, not "there is
--                        no expectation" — a reader may not infer either way.
--
-- WHAT THIS ENABLES, AND WHAT IT DOES NOT
-- ---------------------------------------
-- It makes a future audit able to separate a repaired row from a legacy one,
-- which is the precondition for repairing the 28 rows at all: repair without
-- it produces correct values that are indistinguishable from wrong ones, and
-- the audit that found them becomes unreproducible.
--
-- It does NOT change any value, any behaviour, or any reader. No application
-- code writes or reads this column yet — saveCamResults and loadCamResults are
-- deliberately untouched in this phase. Until they are, every row reads NULL,
-- which is the honest answer for all 46 of them.
--
-- SAFETY
-- ------
-- Additive: one nullable text column, NO DEFAULT, NO NOT NULL, NO BACKFILL, no
-- index, no data touched. Every existing row stays valid and reads NULL.
--
-- A default is deliberately absent. Defaulting to either value would assert a
-- basis for 46 rows nobody has examined, which is precisely the failure this
-- column exists to prevent.
--
-- The CHECK is written to admit NULL explicitly. A bare IN (...) would already
-- pass NULL rows (unknown is not false), but stating it makes the third state
-- part of the contract rather than an artefact of three-valued logic.
--
-- text + CHECK rather than a Postgres enum: adding a fourth basis later is one
-- ALTER on a CHECK and a migration on an enum.
--
-- Re-runnable (IF NOT EXISTS on the column; DROP IF EXISTS before ADD on the
-- constraint, so a re-run replaces the constraint rather than failing on a
-- duplicate name).
-- Rollback: 020_cam_expected_basis_rollback.sql

alter table public.cam_reconciliations
  add column if not exists expected_cam_basis text;

alter table public.cam_reconciliations
  drop constraint if exists cam_recon_expected_basis_chk;

alter table public.cam_reconciliations
  add constraint cam_recon_expected_basis_chk
  check (expected_cam_basis is null
         or expected_cam_basis in ('cap_ceiling', 'legacy_unverified'));

comment on column public.cam_reconciliations.expected_cam_basis is
  'How expected_cam was derived. cap_ceiling = capBaseAmount x (1 + capPercentage/100), the current authoritative calculation (Phase H) — safe to display as money. legacy_unverified = written before that calculation existed; the value is a cap percentage, not a dollar ceiling, and must not be rendered as money. NULL = no basis recorded, meaning UNKNOWN rather than "no expectation".';
