-- ============================================================================
-- 025_acquisition_abstraction_rollback.sql
-- ============================================================================
-- TARGET: PILOT PROJECT ONLY (bhmktujbxdbvdmpybmad).
--
-- Undoes 025 and leaves acquisition_documents as 024 left it.
--
-- WHAT THIS DESTROYS: the per-document abstraction — what each document said
-- about each term. It does NOT destroy a document, its stored original, its
-- text, or its classification; re-running abstraction rebuilds what this
-- removes, from the text that is still there.
--
-- Safe to re-run.

drop index if exists public.idx_acq_docs_abstraction;

alter table public.acquisition_documents
  drop constraint if exists acq_docs_abstraction_coherent_check,
  drop constraint if exists acq_docs_abstraction_status_check,
  drop constraint if exists acq_docs_abstracted_fields_is_object_check;

alter table public.acquisition_documents
  drop column if exists abstracted_fields,
  drop column if exists abstraction_status,
  drop column if exists abstraction_model,
  drop column if exists abstracted_at;
