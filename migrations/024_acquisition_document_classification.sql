-- ============================================================================
-- 024_acquisition_document_classification.sql — what a document IS, what it
-- belongs to, and what it changed
-- ============================================================================
-- TARGET: PILOT PROJECT ONLY (bhmktujbxdbvdmpybmad).
-- NEVER apply to production (zhsuhehgehbzkmzurzyf).
--
-- WHY
-- ---
-- Acquisition Review Phase 1, increment P1-3. Migration 023 preserved every
-- source file and said outright what it was leaving for this one:
--
--     "No doc_type, family_id, version or supersession columns. Classification
--      and document families are P1-3, and their shape depends on the
--      AI-proposes / human-confirms record that increment has to design."
--
-- This is that shape. A flat list of preserved files becomes a structure a
-- person and a later increment can both read: Review → Document → Type →
-- Family → the relationship to the document it changed.
--
-- THREE RULES IT ENFORCES
-- -----------------------
--  1. A PROPOSAL IS NEVER A FACT. Every classification, family filing and
--     relationship carries its own status and source. A model's reading is
--     `proposed`; only a person's act is `confirmed`. Nothing here can record
--     a confirmation without recording who made it (see the trigger in §6).
--  2. UNCERTAINTY IS REPRESENTABLE. doc_type NULL / 'unknown' and
--     family_id NULL are ordinary states, not errors, and they are what an
--     un-placed document keeps until somebody decides.
--  3. HISTORY IS APPENDED, NEVER OVERWRITTEN. classification_history keeps
--     every proposal and correction with its actor and time, so "the model
--     said amendment and a person corrected it to renewal" survives. The
--     current value is in columns so it can be constrained and indexed; the
--     trail is in jsonb, the shape fieldEvidence.snapshots and the P1-1
--     activity log already use.
--
-- THE VOCABULARY IS NOT NEW
-- -------------------------
-- doc_type's lease values are exactly the ones LeaseIntelligence already
-- reasons over (DOC_TYPE_TIER = side_letter 4, estoppel 3, amendment 2,
-- original_lease 1), so P1-4 feeds the existing reasonMultiDocumentLease
-- rather than a second one written to match a new table. renewal, extension,
-- assignment and guaranty join amendment at tier 2 — they modify a lease the
-- same way. The tier itself lives in code, not here: it is a reading rule, and
-- a constraint that encoded it would have to be migrated to change it.
--
-- D-14 — THE SAME FILE NAME, UPLOADED TWICE
-- -----------------------------------------
-- 023 keyed a document on (review_id, file_name), so re-uploading a file whose
-- name was already used REPLACED the row. The object storage was never the
-- problem — /api/upload names objects acq_<review>_<timestamp>-<file> and the
-- timestamp differs per upload, so both files were always kept — but the row
-- pointing at the older one was overwritten and that source left the record.
-- That contradicts the whole point of 023.
--
-- The identity of a document is therefore no longer its name. It is intake_id:
-- minted once when a file is taken in and reused by that upload's second write
-- (the one that lands the extraction), so one UPLOAD is one row and two
-- uploads are two rows even when they share a name. The old row is then marked
-- superseded_by_document_id and keeps everything it had — its own object, its
-- own text, its own classification.
--
-- Supersession is deliberately NOT a value of `relationship`. That column is
-- for what a document does to another document in law (an amendment amends a
-- lease); this is a fact about a file being handed over twice. Folding them
-- together would let a stale upload read as a governing-document link.
--
-- NO VERSION NUMBER. Order within a family is derived — tier, then date — by
-- the reasoner that already exists. A stored integer would be a second and
-- weaker source of truth, and amendments do not obey a total order anyway.
--
-- STILL NO DELETE. Preserving every source remains the rule
-- (ARCHITECTURE_PRINCIPLES §4). Nothing below removes a document, and the
-- supersession pointer is explicitly not a soft delete: a superseded row stays
-- readable, openable and in its family.
--
-- Safe to re-run (IF NOT EXISTS / guarded ALTER / guarded backfill throughout).
-- Rollback: 024_acquisition_document_classification_rollback.sql
-- Run once in Supabase: SQL Editor → New query → paste → Run.

-- ── 1. Families ─────────────────────────────────────────────────────────────
-- A family is one leasehold: a space and the chain of documents governing it.
-- An assignment stays in the family when the tenant changes, because what the
-- family tracks is the leasehold, not the counterparty.
--
-- It is a table and not a text key on the document because a family is renamed,
-- merged and abstracted per-family in P1-4, and two families can legitimately
-- share a tenant name. A text key would make a rename a rewrite of every row.
--
-- Non-lease documents (PSA, rent roll, financial statements, invoices) do NOT
-- get a family in P1-3. They belong to the review. family_kind exists so
-- grouping them later needs no migration, not because it is used now.
create table if not exists public.acquisition_document_families (
  id          uuid primary key default gen_random_uuid(),
  review_id   uuid not null,
  user_id     uuid not null,

  label       text not null,
  family_kind text not null default 'lease'
                check (family_kind in ('lease', 'financial', 'transaction', 'other')),

  -- What the family is believed to be about. Hints, not facts: they seed the
  -- label and help a person recognise the family, and nothing reads them as
  -- verified truth.
  tenant_hint text,
  suite_hint  text,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- The same owner-integrity rule migration 023 uses: a family belongs to a
  -- review, and to the review's owner, or it does not exist.
  constraint acq_doc_families_review_fk
    foreign key (review_id, user_id)
    references public.acquisition_reviews (id, user_id) on delete cascade,

  -- So a document's (family_id, user_id) can point here and be unable to name
  -- a family belonging to somebody else.
  constraint acq_doc_families_id_user_id_key unique (id, user_id),

  constraint acq_doc_families_label_not_blank check (length(btrim(label)) > 0)
);

create index if not exists idx_acq_doc_families_review  on public.acquisition_document_families (review_id);
create index if not exists idx_acq_doc_families_user    on public.acquisition_document_families (user_id);
create index if not exists idx_acq_doc_families_updated on public.acquisition_document_families (updated_at desc);

comment on table  public.acquisition_document_families is
  'Acquisition Review P1-3. One leasehold: a space and the chain of documents governing it. An assignment stays in the family when the tenant changes.';
comment on column public.acquisition_document_families.tenant_hint is
  'What the family is believed to be about. A hint for recognition, never a verified term.';

-- ── 2. A document''s own identity (D-14) ────────────────────────────────────
-- intake_id is minted once per file at intake and reused by that upload''s
-- second write. Added nullable, backfilled, then made NOT NULL, so the step is
-- correct whether the table is empty or already holds rows.
alter table public.acquisition_documents add column if not exists intake_id text;

update public.acquisition_documents
   set intake_id = id::text
 where intake_id is null;

do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'acquisition_documents'
       and column_name = 'intake_id' and is_nullable = 'YES'
  ) then
    alter table public.acquisition_documents alter column intake_id set not null;
  end if;
end $$;

-- One UPLOAD is one row. This replaces (review_id, file_name) as the identity
-- of a document and as the upsert''s conflict key.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'acquisition_documents_review_intake_key'
       and conrelid = 'public.acquisition_documents'::regclass
  ) then
    alter table public.acquisition_documents
      add constraint acquisition_documents_review_intake_key unique (review_id, intake_id);
  end if;
end $$;

-- The name stops being an identity and becomes a lookup. Dropped only AFTER
-- the replacement above exists, so the table is never without a key.
alter table public.acquisition_documents
  drop constraint if exists acquisition_documents_review_file_key;

create index if not exists idx_acq_docs_review_file
  on public.acquisition_documents (review_id, file_name);

-- ── 3. Classification, family, relationship ─────────────────────────────────
alter table public.acquisition_documents
  -- WHAT IT IS. NULL and 'unknown' are both ordinary: a document may arrive
  -- unclassified and be classified later.
  add column if not exists doc_type            text,
  add column if not exists doc_type_status     text not null default 'unclassified',
  add column if not exists doc_type_source     text,
  add column if not exists doc_type_confidence numeric,
  -- The document''s OWN effective date, which is what orders a family. Not
  -- created_at, which is when it was uploaded.
  add column if not exists doc_date            date,

  -- WHAT IT BELONGS TO.
  add column if not exists family_id     uuid,
  add column if not exists family_status text not null default 'unfiled',
  add column if not exists family_source text,

  -- WHAT IT CHANGED. In law — an amendment amends a lease.
  add column if not exists parent_document_id  uuid,
  add column if not exists relationship        text,
  add column if not exists relationship_status text,

  -- WHAT REPLACED IT. A fact about the file, not about the law (D-14).
  -- NULL means this row is the current upload of its name.
  add column if not exists superseded_by_document_id uuid,

  -- Every proposal and correction, appended, with its actor and its time.
  add column if not exists classification_history jsonb not null default '[]'::jsonb;

-- ── 4. What those columns may hold ──────────────────────────────────────────
-- Guarded so the migration re-runs: a constraint that exists is left alone.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'acq_docs_doc_type_check'
                   and conrelid = 'public.acquisition_documents'::regclass) then
    alter table public.acquisition_documents add constraint acq_docs_doc_type_check
      check (doc_type is null or doc_type in (
        -- Lease family. The first four names are LeaseIntelligence''s own.
        'original_lease', 'amendment', 'renewal', 'extension', 'assignment',
        'guaranty', 'side_letter', 'snda', 'estoppel',
        -- Review level.
        'psa', 'rent_roll', 'financial_statement', 'invoice',
        'other', 'unknown'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'acq_docs_doc_type_status_check'
                   and conrelid = 'public.acquisition_documents'::regclass) then
    alter table public.acquisition_documents add constraint acq_docs_doc_type_status_check
      check (doc_type_status in ('unclassified', 'proposed', 'confirmed', 'corrected'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'acq_docs_doc_type_source_check'
                   and conrelid = 'public.acquisition_documents'::regclass) then
    alter table public.acquisition_documents add constraint acq_docs_doc_type_source_check
      check (doc_type_source is null or doc_type_source in ('ai', 'human', 'intake_kind'));
  end if;

  -- A confidence that is not between 0 and 1 is a bug in the caller, not a
  -- reading to store.
  if not exists (select 1 from pg_constraint where conname = 'acq_docs_doc_type_confidence_check'
                   and conrelid = 'public.acquisition_documents'::regclass) then
    alter table public.acquisition_documents add constraint acq_docs_doc_type_confidence_check
      check (doc_type_confidence is null or (doc_type_confidence >= 0 and doc_type_confidence <= 1));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'acq_docs_family_status_check'
                   and conrelid = 'public.acquisition_documents'::regclass) then
    alter table public.acquisition_documents add constraint acq_docs_family_status_check
      check (family_status in ('unfiled', 'proposed', 'confirmed'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'acq_docs_family_source_check'
                   and conrelid = 'public.acquisition_documents'::regclass) then
    alter table public.acquisition_documents add constraint acq_docs_family_source_check
      check (family_source is null or family_source in ('ai', 'human', 'inherited'));
  end if;

  -- A document IN no family cannot be filed; a document in one must say how it
  -- got there. The two columns cannot disagree.
  if not exists (select 1 from pg_constraint where conname = 'acq_docs_family_coherent_check'
                   and conrelid = 'public.acquisition_documents'::regclass) then
    alter table public.acquisition_documents add constraint acq_docs_family_coherent_check
      check ((family_id is null and family_status = 'unfiled')
          or (family_id is not null and family_status in ('proposed', 'confirmed')));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'acq_docs_relationship_check'
                   and conrelid = 'public.acquisition_documents'::regclass) then
    alter table public.acquisition_documents add constraint acq_docs_relationship_check
      check (relationship is null or relationship in (
        'amends', 'renews', 'extends', 'assigns', 'guarantees',
        'supplements', 'certifies', 'relates_to'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'acq_docs_relationship_status_check'
                   and conrelid = 'public.acquisition_documents'::regclass) then
    alter table public.acquisition_documents add constraint acq_docs_relationship_status_check
      check (relationship_status is null or relationship_status in ('proposed', 'confirmed'));
  end if;

  -- A relationship needs both ends and a standing. Half a relationship is the
  -- kind of thing that later reads as fact.
  if not exists (select 1 from pg_constraint where conname = 'acq_docs_relationship_coherent_check'
                   and conrelid = 'public.acquisition_documents'::regclass) then
    alter table public.acquisition_documents add constraint acq_docs_relationship_coherent_check
      check ((parent_document_id is null  and relationship is null and relationship_status is null)
          or (parent_document_id is not null and relationship is not null and relationship_status is not null));
  end if;

  -- No document amends or supersedes itself.
  if not exists (select 1 from pg_constraint where conname = 'acq_docs_parent_not_self_check'
                   and conrelid = 'public.acquisition_documents'::regclass) then
    alter table public.acquisition_documents add constraint acq_docs_parent_not_self_check
      check (parent_document_id is distinct from id);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'acq_docs_superseded_not_self_check'
                   and conrelid = 'public.acquisition_documents'::regclass) then
    alter table public.acquisition_documents add constraint acq_docs_superseded_not_self_check
      check (superseded_by_document_id is distinct from id);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'acq_docs_history_is_array_check'
                   and conrelid = 'public.acquisition_documents'::regclass) then
    alter table public.acquisition_documents add constraint acq_docs_history_is_array_check
      check (jsonb_typeof(classification_history) = 'array');
  end if;
end $$;

-- ── 5. Who a document may point at ──────────────────────────────────────────
-- All three are COMPOSITE on user_id, the trick migration 023 introduced: a
-- document cannot be filed into another user''s family, cannot name another
-- user''s document as its parent, and cannot be superseded by one. The rule
-- holds even if every line of JavaScript above it is wrong.
--
-- ON DELETE: a family that goes takes no documents with it — they fall back to
-- unfiled, which is a true statement about them. The family_coherent check
-- means family_status must follow, so the trigger in §6 does it.
--
-- THE COLUMN LIST ON `set null` IS NOT DECORATION. A composite ON DELETE SET
-- NULL with no column list nulls EVERY column of the key, which here includes
-- user_id — a NOT NULL column — so deleting a family would fail outright and
-- the document would be left pointing at a family that no longer existed. The
-- list (PostgreSQL 15+; Pilot runs 17, the verification cluster 16) nulls only
-- the pointer and leaves the owner alone. All three keys below take it, for
-- the same reason.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'acq_docs_family_fk'
                   and conrelid = 'public.acquisition_documents'::regclass) then
    alter table public.acquisition_documents add constraint acq_docs_family_fk
      foreign key (family_id, user_id)
      references public.acquisition_document_families (id, user_id)
      on delete set null (family_id);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'acquisition_documents_id_user_id_key'
                   and conrelid = 'public.acquisition_documents'::regclass) then
    alter table public.acquisition_documents
      add constraint acquisition_documents_id_user_id_key unique (id, user_id);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'acq_docs_parent_fk'
                   and conrelid = 'public.acquisition_documents'::regclass) then
    alter table public.acquisition_documents add constraint acq_docs_parent_fk
      foreign key (parent_document_id, user_id)
      references public.acquisition_documents (id, user_id)
      on delete set null (parent_document_id);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'acq_docs_superseded_fk'
                   and conrelid = 'public.acquisition_documents'::regclass) then
    alter table public.acquisition_documents add constraint acq_docs_superseded_fk
      foreign key (superseded_by_document_id, user_id)
      references public.acquisition_documents (id, user_id)
      on delete set null (superseded_by_document_id);
  end if;
end $$;

-- ── 6. Coherence the database keeps, not the caller ─────────────────────────
-- Two rules that a wrong line of client code must not be able to break.
--
-- The first is the point of this whole increment: a CONFIRMED classification,
-- filing or relationship names the person who confirmed it. A confirmation
-- with no confirmer is exactly the silent promotion of a proposal to a fact
-- that P1-3 exists to prevent.
--
-- The second keeps family_status honest when a family is deleted out from
-- under a document by the ON DELETE SET NULL above.

-- Who confirmed, and when. Written by the same act that sets a status to
-- confirmed; the trigger below refuses the write otherwise. Added before the
-- function that reads it so the column always exists by the time it runs.
alter table public.acquisition_documents
  add column if not exists confirmed_by uuid,
  add column if not exists confirmed_at timestamptz;

create or replace function public.acq_docs_coherence()
returns trigger
language plpgsql
as $$
begin
  if new.family_id is null and new.family_status <> 'unfiled' then
    new.family_status := 'unfiled';
    new.family_source := null;
  end if;

  if (new.doc_type_status in ('confirmed', 'corrected')
      or new.family_status = 'confirmed'
      or new.relationship_status = 'confirmed')
     and new.confirmed_by is null then
    raise exception 'a confirmed classification must name who confirmed it (acquisition_documents.confirmed_by)'
      using errcode = 'check_violation';
  end if;

  return new;
end $$;

drop trigger if exists trg_acq_docs_coherence on public.acquisition_documents;
create trigger trg_acq_docs_coherence
  before insert or update on public.acquisition_documents
  for each row execute function public.acq_docs_coherence();

-- ── 7. Indexes for the reads P1-3 and P1-4 actually make ────────────────────
-- The current set of a review is `superseded_by_document_id is null`; the
-- partial index says so and stays small.
create index if not exists idx_acq_docs_family
  on public.acquisition_documents (family_id) where family_id is not null;
create index if not exists idx_acq_docs_parent
  on public.acquisition_documents (parent_document_id) where parent_document_id is not null;
create index if not exists idx_acq_docs_current
  on public.acquisition_documents (review_id) where superseded_by_document_id is null;
create index if not exists idx_acq_docs_doc_type
  on public.acquisition_documents (review_id, doc_type);

-- ── 8. Row-level security on the new table ──────────────────────────────────
-- Identical to acquisition_documents: owner-only, both halves, and NO anon
-- policy. Written from the browser under RLS like everything else in P1-2 —
-- no serverless function was added for this increment.
alter table public.acquisition_document_families enable row level security;

drop policy if exists "acq_doc_families_owner_all"        on public.acquisition_document_families;
drop policy if exists "acq_doc_families_service_role_all" on public.acquisition_document_families;

create policy "acq_doc_families_owner_all"
  on public.acquisition_document_families
  for all to authenticated
  using      (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "acq_doc_families_service_role_all"
  on public.acquisition_document_families
  for all to service_role using (true) with check (true);

-- updated_at moves on update, the way every other table here does.
drop trigger if exists trg_acq_doc_families_updated_at on public.acquisition_document_families;
create trigger trg_acq_doc_families_updated_at
  before update on public.acquisition_document_families
  for each row execute function public.set_updated_at();

-- ── 9. Column notes ─────────────────────────────────────────────────────────
comment on column public.acquisition_documents.intake_id is
  'Identity of one UPLOAD, minted at intake and reused by that upload''s second write. Replaces file_name as the document''s identity so a re-upload of the same name is a new row, not a replacement (D-14).';
comment on column public.acquisition_documents.doc_type is
  'What the document is. Lease values match LeaseIntelligence.DOC_TYPE_TIER so P1-4 reasons with the function that already exists. NULL or ''unknown'' is an ordinary state.';
comment on column public.acquisition_documents.doc_type_status is
  'unclassified | proposed | confirmed | corrected. A model''s reading is proposed; only a person''s act is confirmed, and the trigger requires confirmed_by.';
comment on column public.acquisition_documents.doc_date is
  'The document''s OWN effective date — what orders a family. Not created_at, which is when it was uploaded.';
comment on column public.acquisition_documents.family_id is
  'The leasehold this document governs. NULL is ordinary: an unplaced document stays visible rather than being filed somewhere plausible.';
comment on column public.acquisition_documents.parent_document_id is
  'What this document changes IN LAW (an amendment amends a lease). Not supersession — see superseded_by_document_id.';
comment on column public.acquisition_documents.superseded_by_document_id is
  'Set on the OLDER row when a new upload reuses its file name. NULL means this is the current upload of that name. NOT a delete: the row keeps its object, its text and its classification, and stays readable (D-14).';
comment on column public.acquisition_documents.classification_history is
  'Append-only. Every proposal and correction with its actor and time, so a model''s reading and a person''s correction both survive.';
