-- ============================================================================
-- 019_evidence_quote_rollback.sql
-- ============================================================================
-- Drops the quote column added by 019.
--
-- WHAT REVERTING COSTS. Every clause captured since 019 was applied is
-- destroyed, and unlike most rollbacks this one is not recoverable by
-- re-applying: the blob copy was stripped at save time, so the column was the
-- only place the text lived. Re-extracting each affected lease document is the
-- only way back.
--
-- The application tolerates the column's absence — _evidenceRowToSnapshot reads
-- `row.quote != null ? row.quote : null`, which is null for a column that is not
-- there — so reverting degrades to pre-019 behaviour rather than breaking. That
-- is what makes it safe to run, and it is not a reason to run it.

alter table public.tenant_field_evidence
  drop column if exists quote;
