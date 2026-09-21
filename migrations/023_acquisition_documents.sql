-- ============================================================================
-- 023_acquisition_documents.sql — every document an acquisition review was given
-- ============================================================================
-- TARGET: PILOT PROJECT ONLY (bhmktujbxdbvdmpybmad).
-- NEVER apply to production (zhsuhehgehbzkmzurzyf).
--
-- WHY
-- ---
-- Acquisition Review extracted leases and invoices and then threw the source
-- away. acqHandleLeaseFiles (script.js) read each file in the browser, kept the
-- extracted fields in review.data.tenants[], and never uploaded the file, never
-- stored its text, and dropped the record entirely when extraction failed. So a
-- review could not show the document a term came from, could not be asked about
-- it, and could not re-extract without the manager finding the file again —
-- while the managed-property path has preserved all three since Phase 22A.
--
-- WHAT THIS IS NOT
-- ----------------
-- It is not lease_documents. That table is property-scoped (property_id NOT
-- NULL references properties) and its ownership checks join through
-- properties.user_id — but a review has no property until it is converted.
-- Relaxing that column would pull acquisition rows into the managed-property
-- document model and change three shared ownership checks. The two models stay
-- apart until conversion copies rows across (P1-10).
--
-- WHAT IS DELIBERATELY ABSENT
-- ---------------------------
-- No doc_type, family_id, version or supersession columns. Classification and
-- document families are P1-3, and their shape depends on the AI-proposes /
-- human-confirms record that increment has to design (a proposal, the model
-- that made it, a confirmer, a time). Choosing those columns here would decide
-- P1-3 here. intake_kind below is NOT that: it records which upload control the
-- file came through, which is a fact this increment knows.
--
-- No delete path. Preserving every source is the point of this increment; if a
-- removal is ever wanted it arrives as an explicit archive workflow with its
-- own column (ARCHITECTURE_PRINCIPLES §4).
--
-- Safe to re-run (IF NOT EXISTS / OR REPLACE / guarded ALTER throughout).
-- Rollback: 023_acquisition_documents_rollback.sql
-- Run once in Supabase: SQL Editor → New query → paste → Run.

-- ── 1. Owner integrity on the parent ────────────────────────────────────────
-- Lets a document row's owner be tied to its review's owner by the database
-- rather than by every writer remembering to. Additive: id is already the
-- primary key, so this places no new restriction on acquisition_reviews.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'acquisition_reviews_id_user_id_key'
       and conrelid = 'public.acquisition_reviews'::regclass
  ) then
    alter table public.acquisition_reviews
      add constraint acquisition_reviews_id_user_id_key unique (id, user_id);
  end if;
end $$;

-- ── 2. Table ────────────────────────────────────────────────────────────────
create table if not exists public.acquisition_documents (
  id               uuid        primary key default gen_random_uuid(),
  review_id        uuid        not null,
  user_id          uuid        not null,

  -- The file as it arrived
  file_name        text        not null,
  intake_kind      text        not null default 'other'
                     check (intake_kind in ('lease', 'invoice', 'other')),
  byte_size        bigint,
  content_type     text,

  -- WHERE THE ORIGINAL IS, as a storage REFERENCE ("bucket/path"), never a
  -- public URL (SEC-1). NULL means the original is NOT on file — too large to
  -- store, or the upload failed — which is a real state and must read as
  -- "not stored", never as "not uploaded yet".
  storage_path     text,

  -- What was read out of it
  extracted_text   text,
  parsing_status   text        not null default 'pending'
                     check (parsing_status in ('pending', 'success', 'partial', 'failed')),
  extraction_model text,
  used_pdf_direct  boolean     not null default false,
  error_message    text,

  -- What it produced in review.data, when it produced anything. That id is
  -- minted client-side (mintTenantIdentity) and can be re-minted by a later
  -- re-extraction, so this is a pointer, not a foreign key.
  produced_kind    text        check (produced_kind in ('tenant', 'invoice')),
  produced_id      text,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  -- The owner cannot disagree with the review's owner, and deleting a review
  -- takes its documents with it. auth.users needs no separate foreign key:
  -- deleting a user already cascades through acquisition_reviews to here.
  constraint acquisition_documents_review_fk
    foreign key (review_id, user_id)
    references public.acquisition_reviews (id, user_id)
    on delete cascade,

  -- Re-uploading the same file name onto the same review UPDATES that row, the
  -- way lease_documents keys on (property_id, file_name). Two different files
  -- sharing a name therefore replace one another; that is the existing
  -- convention, and P1-3 revisits it when it introduces versions.
  constraint acquisition_documents_review_file_key unique (review_id, file_name)
);

-- ── 3. Indexes ──────────────────────────────────────────────────────────────
create index if not exists acq_docs_review_idx
  on public.acquisition_documents (review_id);
create index if not exists acq_docs_user_idx
  on public.acquisition_documents (user_id);
create index if not exists acq_docs_review_created_idx
  on public.acquisition_documents (review_id, created_at);
create index if not exists acq_docs_review_status_idx
  on public.acquisition_documents (review_id, parsing_status);

-- ── 4. updated_at ───────────────────────────────────────────────────────────
-- The same function migrations 004 and 006 install; repeated so this file
-- stands alone. Identical body, create-or-replace.
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists acq_documents_updated_at on public.acquisition_documents;
create trigger acq_documents_updated_at
  before update on public.acquisition_documents
  for each row execute function public.set_updated_at();

-- ── 5. Row-Level Security ───────────────────────────────────────────────────
alter table public.acquisition_documents enable row level security;

grant usage  on schema public to authenticated;
grant usage  on schema public to service_role;
grant select, insert, update, delete on public.acquisition_documents to authenticated;
grant select, insert, update, delete on public.acquisition_documents to service_role;

drop policy if exists "acq_docs_owner_all"        on public.acquisition_documents;
drop policy if exists "acq_docs_service_role_all" on public.acquisition_documents;

-- The owner policy reads user_id directly — the same pattern as migration 006,
-- and cheaper than joining the review on every row. The composite foreign key
-- above is what stops that column ever disagreeing with the review it names.
create policy "acq_docs_owner_all"
  on public.acquisition_documents
  for all to authenticated
  using      (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "acq_docs_service_role_all"
  on public.acquisition_documents
  for all to service_role using (true) with check (true);

-- Deliberately NO policy for the `anon` role. Absence of a policy under RLS is
-- a denial, which is the intended answer for an unauthenticated reader.

-- ── 6. Column documentation ─────────────────────────────────────────────────
comment on table public.acquisition_documents is
  'Every file uploaded to an Acquisition Review: the original in storage, the text read out of it, and the row that survives a failed extraction. Isolated from lease_documents, which is property-scoped. See docs/ACQUISITION_REVIEW.md.';
comment on column public.acquisition_documents.storage_path is
  'Storage REFERENCE "bucket/path" (SEC-1), signed on demand by /api/document-url. NULL means the original is not on file — too large to store, or the upload failed.';
comment on column public.acquisition_documents.intake_kind is
  'Which upload control the file arrived through — NOT a classification of the document. Document type, families and versions are P1-3.';
comment on column public.acquisition_documents.produced_id is
  'The tenant or invoice id this file produced in acquisition_reviews.data, when it produced one. Client-minted and re-mintable, so a pointer rather than a foreign key.';

-- ── 7. Verify ───────────────────────────────────────────────────────────────
select count(*) as acquisition_documents_rows from public.acquisition_documents;

-- Expect 2 policies, both {authenticated} / {service_role}, none for anon:
--   select policyname, cmd, roles from pg_policies
--    where schemaname = 'public' and tablename = 'acquisition_documents'
--    order by policyname;
--
-- Expect true:
--   select relrowsecurity from pg_class c
--     join pg_namespace n on n.oid = c.relnamespace
--    where n.nspname = 'public' and c.relname = 'acquisition_documents';
--
-- Expect one row, acquisition_reviews_id_user_id_key:
--   select conname from pg_constraint
--    where conrelid = 'public.acquisition_reviews'::regclass and contype = 'u';
