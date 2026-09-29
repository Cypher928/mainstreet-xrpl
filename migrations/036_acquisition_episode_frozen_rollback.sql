-- ============================================================================
-- 036_acquisition_episode_frozen_rollback.sql
-- ============================================================================
-- Removes the four triggers and three functions 036 added. Nothing else: 036
-- created no table, column, constraint, index or policy, and touched no row.
--
-- NOT REVERSED: the anon revokes on acquisition_reviews and
-- acquisition_documents. Before 036 anon held every privilege on both tables
-- while RLS returned it zero rows; re-granting them would restore an exposure
-- that nothing depended on. If a later change needs anon there, it grants
-- deliberately.
--
-- DATA. Nothing to undo: 036 changed no row. After this file a converted
-- acquisition review and its documents, leaseholds and decisions are mutable
-- again, exactly as before 036 — the Property Workspace's history surfaces
-- (P5-2..P5-5) then read records that can change underneath them.
-- ============================================================================

drop trigger if exists acq_reviews_frozen  on public.acquisition_reviews;
drop trigger if exists acq_children_frozen on public.acquisition_documents;
drop trigger if exists acq_children_frozen on public.acquisition_document_families;
drop trigger if exists acq_children_frozen on public.acquisition_term_decisions;

drop function if exists public.acq_reviews_frozen();
drop function if exists public.acq_children_frozen();
drop function if exists public._acq_episode_frozen(uuid);
