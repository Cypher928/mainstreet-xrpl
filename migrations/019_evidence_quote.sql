-- ============================================================================
-- 019_evidence_quote.sql — the clause the evidence row exists because of
-- ============================================================================
-- TARGET: PILOT PROJECT ONLY (bhmktujbxdbvdmpybmad).
-- NEVER apply to production (zhsuhehgehbzkmzurzyf).
--
-- WHY
-- ---
-- Lease extraction returns a `quotes` channel alongside every field — the
-- verbatim clause the value was read from — and normalizeTenant already writes
-- it into a fieldEvidence snapshot (script.js, _quoteMap). Two things then
-- happened to it, in order:
--
--   1. savePropertyData -> _stripBlobs deletes fieldEvidence from the property
--      blob, because ms_useNormalizedEvidence is true and this table is
--      authoritative.
--   2. _writeTenantFieldEvidence's payload had fifteen fields and none of them
--      was the quote, because this table had no column for it.
--
-- So the clause survived until the first save and then existed nowhere. The
-- irony is precise: _persistExtractedEvidence writes a snapshot to this table
-- ONLY when it carries a quote or a page (script.js:5038) — the quote is the
-- reason the row is written, and it was the one thing the row could not keep.
--
-- Measured on pilot before this migration: all three tenants carrying an
-- admin_fee_pct have a normalized evidence row and no fieldEvidence object at
-- all, so the management-fee clause behind every cap in the dataset is gone.
--
-- WHAT THIS ENABLES, AND WHAT IT DOES NOT
-- ---------------------------------------
-- It lets the product show a manager the sentence a lease value came from. It
-- does NOT change any billing behaviour: D2-2 (a management-fee cap breach
-- holding a tenant statement) is deliberately not implemented, because a cap
-- percentage is not testable until the lease's own base for it is known, and
-- that is a separate field with its own provenance.
--
-- SAFETY
-- ------
-- Additive and backward-compatible in the strict sense: one nullable column, no
-- default, no constraint, no index, no data touched. Every existing row stays
-- valid and reads quote NULL, which is true — the clause was discarded before
-- this column existed. There is deliberately NO BACKFILL: the text cannot be
-- reconstructed without re-extracting the source document, and inventing it
-- would be fabricating provenance, which is the one thing an evidence table
-- must never do.
--
-- Re-runnable (IF NOT EXISTS).
-- Rollback: 019_evidence_quote_rollback.sql

alter table public.tenant_field_evidence
  add column if not exists quote text;

comment on column public.tenant_field_evidence.quote is
  'Verbatim clause text the value was extracted from, capped at 200 chars by the writer. NULL for rows written before migration 019 and for manual confirmations, which cite a person rather than a document.';
