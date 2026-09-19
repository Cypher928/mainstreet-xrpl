-- ─── 025_document_register — ROLLBACK ───────────────────────────────────────
-- Drops the view, the indexes, the constraints and the thirteen columns 025
-- added to lease_documents. The rows themselves, file_url, extracted_text and
-- every column that existed before 025 are untouched.
--
-- DATA: classification, filing, family membership, upload attribution and
-- hashes recorded since 025 are discarded. Nothing else.
--
-- ORDER MATTERS: 026 (lease_provisions.source_document_id), 027
-- (tenant_field_evidence.source_document_id) and 029 (financial_sources.
-- document_id, gl_entries.source_document_id) reference lease_documents(id),
-- which 025 did not create and this file does not drop — so this rollback is
-- safe in any order relative to them. The view is dropped first because the
-- columns it projects are dropped after it.
--
-- PILOT ONLY — same guard as the migration.

begin;

do $$
begin
  if not exists (
    select 1 from public.properties
    where id = 'fd9c09b1-b657-4c58-9999-c3cce28e7600'
  ) then
    raise exception
      'REFUSING TO RUN: pilot marker property not found. This does not appear to be the pilot project (bhmktujbxdbvdmpybmad).';
  end if;
end $$;

drop view if exists public.property_documents;

drop index if exists public.lease_docs_property_family_idx;
drop index if exists public.lease_docs_property_category_idx;
drop index if exists public.lease_docs_property_status_idx;
drop index if exists public.lease_docs_sha256_idx;
drop index if exists public.lease_docs_supersedes_idx;

alter table public.lease_documents drop constraint if exists lease_documents_doc_type_check;
alter table public.lease_documents drop constraint if exists lease_documents_status_check;
alter table public.lease_documents drop constraint if exists lease_documents_classified_by_check;
alter table public.lease_documents drop constraint if exists lease_documents_confidence_check;
alter table public.lease_documents drop constraint if exists lease_documents_sha256_check;
alter table public.lease_documents drop constraint if exists lease_documents_size_check;
alter table public.lease_documents drop constraint if exists lease_documents_not_self_superseding;

alter table public.lease_documents drop column if exists mime;
alter table public.lease_documents drop column if exists size_bytes;
alter table public.lease_documents drop column if exists sha256;
alter table public.lease_documents drop column if exists supersedes_document_id;
alter table public.lease_documents drop column if exists uploaded_by;
alter table public.lease_documents drop column if exists status;
alter table public.lease_documents drop column if exists effective_date;
alter table public.lease_documents drop column if exists doc_date;
alter table public.lease_documents drop column if exists classified_by;
alter table public.lease_documents drop column if exists classification_confidence;
alter table public.lease_documents drop column if exists category;
alter table public.lease_documents drop column if exists doc_family_id;
alter table public.lease_documents drop column if exists doc_type;

commit;
