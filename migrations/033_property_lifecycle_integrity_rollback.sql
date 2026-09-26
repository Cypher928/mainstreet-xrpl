-- ============================================================================
-- 033_property_lifecycle_integrity_rollback.sql
-- ============================================================================
-- Removes exactly what 033 added and nothing else: three triggers and their
-- two functions, one unique constraint, two foreign keys, one column.
--
-- WARNING — THIS RE-OPENS THREE HOLES.
--   · tenants.property_id becomes writable again by any update the row
--     policy allows (032 still protects the roster RPC, nothing else).
--   · a document or term decision may again cite a family from another
--     acquisition episode of the same user, and a family may be moved between
--     episodes.
--   · properties.lifecycle_stage may again be set to any value the Phase 0
--     CHECK allows, by anyone the row policy allows, with no rule and no stamp.
--
-- The existing (family_id, user_id) foreign keys were never touched by 033 and
-- are left exactly as they are.
--
-- DROP COLUMN converted_at discards the conversion timestamps written since
-- 033 was applied. review.data.conversionRecord.convertedAt still holds the
-- same instant for every conversion, so nothing is lost that cannot be read
-- back; it is stated here so the loss is a decision, not a surprise.
-- ============================================================================

drop trigger if exists properties_stage_transition on public.properties;
drop function if exists public.properties_stage_transition();

drop trigger if exists acq_doc_families_review_immutable on public.acquisition_document_families;
drop function if exists public.acq_doc_families_review_immutable();

alter table public.acquisition_term_decisions drop constraint if exists acq_term_decisions_family_review_fk;
alter table public.acquisition_documents      drop constraint if exists acq_docs_family_review_fk;
alter table public.acquisition_document_families drop constraint if exists acq_doc_families_id_review_key;

drop trigger if exists tenants_property_immutable on public.tenants;
drop function if exists public.tenants_property_immutable();

alter table public.acquisition_reviews drop column if exists converted_at;
