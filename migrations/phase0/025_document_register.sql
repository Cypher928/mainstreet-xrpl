-- ─── 025_document_register — Phase 0, P0.3 ──────────────────────────────────
--
-- lease_documents IS the document register. One register, not two. Every
-- document surface that exists today — the lease modal, the evidence viewer,
-- the cabinet, api/document-url.js, the tenant portal's publication records
-- (tenant_document_sources.lease_document_id) — keeps working, because the
-- table keeps its name, its columns and its policies. This migration only
-- ADDS what the acquisition workflow needs to file, classify and track a
-- document of any type, not just a lease.
--
-- GROUND TRUTH ON PILOT (read before writing this):
--   92 rows · 91 with a tenant · 88 with extracted_text · 17 public-URL
--   file_url, 64 bare-path, 11 none · no amendment record in any blob
--   references a row · no tenant has two rows. So the backfill below is
--   simple, and it is stated as INFERENCE: a backfilled doc_type carries no
--   classification_confidence and no classified_by, because no classifier
--   and no person typed it.
--
-- WHAT IS NEW
--   doc_type        one of the 32 classifier labels, or 'unclassified'. NULL
--                   means "not yet classified" (a row just received).
--   category        the cabinet drawer the document is filed in. The drawer
--                   map is owned by property-cabinet.js (the application), so
--                   it is not a check constraint here; it is a key, and the
--                   application is the one source of what keys exist.
--   doc_family_id   one governing lease chain for one space. A family is the
--                   SET of rows that share this id — there is no families
--                   table, and the governing terms are COMPUTED by the
--                   authority (LeaseIntelligence, promoted in S6), never
--                   stored. One source of truth: the member rows.
--   status          received → classified → extracted → verified, or
--                   needs_attention. Per document.
--   classification_confidence, classified_by (ai | user), doc_date,
--   effective_date, uploaded_by, supersedes_document_id, sha256, size_bytes,
--   mime — as the plan specifies.
--
-- THE VIEW property_documents is a readable projection of the SAME rows with
-- a derived storage_ref (the bare bucket/path, whichever shape file_url holds)
-- and has_text. security_invoker = true, so RLS on lease_documents applies to
-- every read through it — the same choice payment_balances (022) made.
--
-- RLS: unchanged. lease_docs_owner_all (024: owner OR active member) already
-- governs every column on the row.
--
-- PILOT ONLY. Same marker guard as 012/014/023/024. Idempotent.
-- Rollback: 025_document_register_rollback.sql.

begin;

-- ── Guard ──────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from public.properties
    where id = 'fd9c09b1-b657-4c58-9999-c3cce28e7600'
  ) then
    raise exception
      'REFUSING TO RUN: pilot marker property not found. This does not appear to be the pilot project (bhmktujbxdbvdmpybmad). 025 must never be applied to production.';
  end if;
end $$;

-- ── Columns ────────────────────────────────────────────────────────────────
alter table public.lease_documents add column if not exists doc_type                  text;
alter table public.lease_documents add column if not exists doc_family_id             uuid;
alter table public.lease_documents add column if not exists category                  text;
alter table public.lease_documents add column if not exists classification_confidence integer;
alter table public.lease_documents add column if not exists classified_by             text;
alter table public.lease_documents add column if not exists doc_date                  date;
alter table public.lease_documents add column if not exists effective_date            date;
alter table public.lease_documents add column if not exists status                    text not null default 'received';
alter table public.lease_documents add column if not exists uploaded_by               uuid references auth.users(id) on delete set null;
alter table public.lease_documents add column if not exists supersedes_document_id    uuid references public.lease_documents(id) on delete set null;
alter table public.lease_documents add column if not exists sha256                    text;
alter table public.lease_documents add column if not exists size_bytes                bigint;
alter table public.lease_documents add column if not exists mime                      text;

-- ── Constraints (added idempotently) ───────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'lease_documents_doc_type_check' and conrelid = 'public.lease_documents'::regclass) then
    alter table public.lease_documents add constraint lease_documents_doc_type_check
      check (doc_type is null or doc_type in (
        -- Leases (per family)
        'original_lease', 'amendment', 'renewal_extension', 'assignment', 'guaranty',
        'side_letter', 'snda', 'estoppel', 'commencement_letter',
        -- Deal
        'offering_memorandum', 'purchase_agreement', 'letter_of_intent',
        -- Financials
        'rent_roll', 'general_ledger', 'operating_statement', 'budget',
        -- Taxes
        'tax_bill', 'assessment',
        -- Insurance
        'insurance_policy', 'insurance_certificate',
        -- Legal & Title
        'title_commitment', 'legal_other',
        -- Survey & Zoning
        'survey', 'zoning_letter',
        -- Environmental
        'environmental_report',
        -- Building & Systems
        'pca_report', 'roof_report', 'hvac_report', 'inspection',
        -- Financing
        'loan_document', 'escrow_agreement',
        -- Contracts & Vendors
        'service_contract',
        -- Other
        'unclassified'
      ));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'lease_documents_status_check' and conrelid = 'public.lease_documents'::regclass) then
    alter table public.lease_documents add constraint lease_documents_status_check
      check (status in ('received', 'classified', 'extracted', 'verified', 'needs_attention'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'lease_documents_classified_by_check' and conrelid = 'public.lease_documents'::regclass) then
    alter table public.lease_documents add constraint lease_documents_classified_by_check
      check (classified_by is null or classified_by in ('ai', 'user'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'lease_documents_confidence_check' and conrelid = 'public.lease_documents'::regclass) then
    alter table public.lease_documents add constraint lease_documents_confidence_check
      check (classification_confidence is null or (classification_confidence between 0 and 100));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'lease_documents_sha256_check' and conrelid = 'public.lease_documents'::regclass) then
    alter table public.lease_documents add constraint lease_documents_sha256_check
      check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'lease_documents_size_check' and conrelid = 'public.lease_documents'::regclass) then
    alter table public.lease_documents add constraint lease_documents_size_check
      check (size_bytes is null or size_bytes >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'lease_documents_not_self_superseding' and conrelid = 'public.lease_documents'::regclass) then
    alter table public.lease_documents add constraint lease_documents_not_self_superseding
      check (supersedes_document_id is null or supersedes_document_id <> id);
  end if;
end $$;

-- ── Indexes ────────────────────────────────────────────────────────────────
create index if not exists lease_docs_property_family_idx   on public.lease_documents (property_id, doc_family_id);
create index if not exists lease_docs_property_category_idx on public.lease_documents (property_id, category);
create index if not exists lease_docs_property_status_idx   on public.lease_documents (property_id, status);
create index if not exists lease_docs_sha256_idx            on public.lease_documents (sha256) where sha256 is not null;
create index if not exists lease_docs_supersedes_idx        on public.lease_documents (supersedes_document_id) where supersedes_document_id is not null;

-- ── Backfill — inference, marked as such ───────────────────────────────────
-- Only rows that predate this migration have status 'received' AND text: a
-- row written after it gets its status from the intake flow. Nothing here
-- invents a confidence, a classifier or an uploader.

-- A row an amendment record points at (tenant.amendments[].leaseDocumentId in
-- the property blob) is an amendment. Zero such rows on Pilot today; the rule
-- is here so a project that has them is backfilled correctly.
update public.lease_documents ld
set doc_type = 'amendment', category = 'leases'
where ld.doc_type is null
  and ld.tenant_id is not null
  and exists (
    select 1
    from public.properties p,
         jsonb_array_elements(coalesce(p.data->'tenants', '[]'::jsonb)) t,
         jsonb_array_elements(coalesce(t->'amendments', '[]'::jsonb)) a
    where p.id = ld.property_id
      and a->>'leaseDocumentId' = ld.id::text
  );

-- A row written for a tenant by the lease intake path is that tenant's lease.
update public.lease_documents
set doc_type = 'original_lease', category = 'leases'
where doc_type is null and tenant_id is not null;

-- Anything else the register holds is not typed by anyone yet.
update public.lease_documents
set doc_type = 'unclassified', category = 'other'
where doc_type is null;

-- A document whose text was extracted has been through extraction.
update public.lease_documents
set status = 'extracted'
where status = 'received' and extracted_text is not null;

-- ── The readable projection ────────────────────────────────────────────────
-- security_invoker: the caller's RLS applies. Without it a view runs as its
-- owner and would read every organisation's documents.
create or replace view public.property_documents
with (security_invoker = true) as
select
  ld.id,
  ld.property_id,
  ld.tenant_id,
  ld.tenant_name,
  ld.file_name,
  ld.doc_type,
  ld.category,
  ld.doc_family_id,
  ld.status,
  ld.classification_confidence,
  ld.classified_by,
  ld.doc_date,
  ld.effective_date,
  ld.uploaded_by,
  ld.supersedes_document_id,
  ld.sha256,
  ld.size_bytes,
  ld.mime,
  ld.parsing_status,
  (ld.extracted_text is not null)                                   as has_text,
  case
    when ld.file_url is null then null
    when ld.file_url like 'http%' then
      split_part(regexp_replace(ld.file_url, '^.*/storage/v1/object/(public|sign|authenticated)/', ''), '?', 1)
    else ld.file_url
  end                                                                as storage_ref,
  ld.created_at,
  ld.updated_at
from public.lease_documents ld;

grant select on public.property_documents to authenticated;
grant select on public.property_documents to service_role;

-- ── Comments ───────────────────────────────────────────────────────────────
comment on column public.lease_documents.doc_type is
  'P0.3: one of the 32 classifier labels or unclassified; NULL = not yet classified. Backfilled rows were INFERRED (original_lease for a tenant''s lease, amendment where a blob amendment record points at the row) and carry no confidence and no classified_by.';
comment on column public.lease_documents.category is
  'P0.3: the cabinet drawer key this document is filed under. The drawer map is owned by property-cabinet.js; this column is the key, not the map.';
comment on column public.lease_documents.doc_family_id is
  'P0.3: one governing lease chain for one space. A family is the set of rows sharing this id; governing terms are computed by the authority, never stored.';
comment on column public.lease_documents.status is
  'P0.3: received | classified | extracted | verified | needs_attention.';
comment on column public.lease_documents.classified_by is
  'P0.3: ai | user. NULL for rows typed by backfill inference or not yet typed.';
comment on column public.lease_documents.uploaded_by is
  'P0.3: the user who uploaded the file. NULL for rows that predate the register — unknown, not assumed.';
comment on column public.lease_documents.supersedes_document_id is
  'P0.3: the register row this one replaces (a re-upload or a retype). The old row is kept.';
comment on column public.lease_documents.sha256 is
  'P0.3: hex digest of the stored bytes, computed in the browser at intake; duplicate detection reads it.';
comment on view public.property_documents is
  'P0.3: readable projection of lease_documents (the document register) with a derived bare storage_ref and has_text. security_invoker: RLS applies.';

commit;

-- ── Verify (run after commit; every line should hold) ──────────────────────
-- select doc_type, status, count(*) from public.lease_documents group by 1,2 order by 1,2;
-- select count(*) as untyped from public.lease_documents where doc_type is null;                    -- expect 0
-- select count(*) as inferred_with_confidence from public.lease_documents where classification_confidence is not null;  -- expect 0
-- select count(*) from public.property_documents;                                                     -- expect = count(*) from lease_documents (as service role)
-- select reloptions from pg_class where relname = 'property_documents';                              -- expect {security_invoker=true}
