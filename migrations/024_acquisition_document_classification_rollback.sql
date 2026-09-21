-- ============================================================================
-- 024_acquisition_document_classification_rollback.sql
-- ============================================================================
-- TARGET: PILOT PROJECT ONLY (bhmktujbxdbvdmpybmad).
--
-- Undoes 024 and leaves the table as 023 left it: every preserved source still
-- there, with no classification, no family and no supersession.
--
-- WHAT THIS DOES DESTROY: the classification work itself — types, families,
-- relationships and the history of who proposed and confirmed them. It does
-- NOT destroy a document, its stored original or its text.
--
-- THE ONE CASE THAT CANNOT BE UNDONE CLEANLY: 024 lets two documents in one
-- review share a file name (D-14). Restoring 023's unique (review_id,
-- file_name) would fail while any such pair exists, which is correct — the
-- alternative is deleting a preserved source to make a constraint fit, and
-- that is the thing P1-2 exists to prevent. The guarded block below restores
-- the constraint only when no duplicate name remains, and raises a notice
-- naming the collisions when one does. intake_id is kept in that case so the
-- rows keep their identity.
--
-- Safe to re-run.

drop trigger  if exists trg_acq_docs_coherence on public.acquisition_documents;
drop function if exists public.acq_docs_coherence();

alter table public.acquisition_documents
  drop constraint if exists acq_docs_family_fk,
  drop constraint if exists acq_docs_parent_fk,
  drop constraint if exists acq_docs_superseded_fk,
  drop constraint if exists acq_docs_doc_type_check,
  drop constraint if exists acq_docs_doc_type_status_check,
  drop constraint if exists acq_docs_doc_type_source_check,
  drop constraint if exists acq_docs_doc_type_confidence_check,
  drop constraint if exists acq_docs_family_status_check,
  drop constraint if exists acq_docs_family_source_check,
  drop constraint if exists acq_docs_family_coherent_check,
  drop constraint if exists acq_docs_relationship_check,
  drop constraint if exists acq_docs_relationship_status_check,
  drop constraint if exists acq_docs_relationship_coherent_check,
  drop constraint if exists acq_docs_parent_not_self_check,
  drop constraint if exists acq_docs_superseded_not_self_check,
  drop constraint if exists acq_docs_history_is_array_check;

drop index if exists public.idx_acq_docs_family;
drop index if exists public.idx_acq_docs_parent;
drop index if exists public.idx_acq_docs_current;
drop index if exists public.idx_acq_docs_doc_type;

alter table public.acquisition_documents
  drop column if exists doc_type,
  drop column if exists doc_type_status,
  drop column if exists doc_type_source,
  drop column if exists doc_type_confidence,
  drop column if exists doc_date,
  drop column if exists family_id,
  drop column if exists family_status,
  drop column if exists family_source,
  drop column if exists parent_document_id,
  drop column if exists relationship,
  drop column if exists relationship_status,
  drop column if exists superseded_by_document_id,
  drop column if exists classification_history,
  drop column if exists confirmed_by,
  drop column if exists confirmed_at;

drop table if exists public.acquisition_document_families cascade;

-- Restore 023's identity only if the data still allows it.
do $$
declare dupes int;
begin
  select count(*) into dupes from (
    select review_id, file_name
      from public.acquisition_documents
     group by review_id, file_name having count(*) > 1
  ) d;

  if dupes = 0 then
    if not exists (
      select 1 from pg_constraint
       where conname = 'acquisition_documents_review_file_key'
         and conrelid = 'public.acquisition_documents'::regclass
    ) then
      alter table public.acquisition_documents
        add constraint acquisition_documents_review_file_key unique (review_id, file_name);
    end if;
    alter table public.acquisition_documents
      drop constraint if exists acquisition_documents_review_intake_key;
    alter table public.acquisition_documents drop column if exists intake_id;
    drop index if exists public.idx_acq_docs_review_file;
  else
    raise notice
      'Rollback kept intake_id: % file name(s) are used by more than one preserved document. Restoring the 023 unique key would require deleting a source.', dupes;
  end if;
end $$;

alter table public.acquisition_documents
  drop constraint if exists acquisition_documents_id_user_id_key;
