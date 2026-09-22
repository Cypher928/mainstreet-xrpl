-- ============================================================================
-- 027_acquisition_abstraction_error_rollback.sql
-- ============================================================================
-- TARGET: PILOT PROJECT ONLY (bhmktujbxdbvdmpybmad).
--
-- Undoes 027 and leaves acquisition_documents as 026 left it.
--
-- WHAT THIS DESTROYS: the recorded reason a term reading failed. It does NOT
-- destroy a document, its stored original, its text, its classification, its
-- evidence, or any decision recorded against it. The readings themselves are
-- untouched — only the account of why the failed ones failed is lost, and
-- re-running a reading produces it again.
--
-- Safe to re-run.

alter table public.acquisition_documents
  drop constraint if exists acq_docs_abstraction_error_coherent_check,
  drop constraint if exists acq_docs_abstraction_error_check;

alter table public.acquisition_documents
  drop column if exists abstraction_error;
