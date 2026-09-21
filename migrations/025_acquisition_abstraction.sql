-- ============================================================================
-- 025_acquisition_abstraction.sql — what each document SAYS, field by field
-- ============================================================================
-- TARGET: PILOT PROJECT ONLY (bhmktujbxdbvdmpybmad).
-- NEVER apply to production (zhsuhehgehbzkmzurzyf).
--
-- WHY
-- ---
-- Acquisition Review Phase 1, increment P1-4, step P4-1. P1-2 preserved every
-- document's text. P1-3 said what each document IS. Nothing yet records what
-- each document SAYS about the terms of the lease it belongs to, and the
-- governing-term reasoner that already exists (LeaseIntelligence.
-- reasonMultiDocumentLease) needs exactly that: per document, a value and the
-- clause behind it, for each term.
--
-- This migration is deliberately small. It is the evidence column and its
-- bookkeeping, nothing more. The human decisions table and the D-17
-- relationship change are migration 026 (P4-3), so each increment is validated
-- against exactly its own schema change.
--
-- THE SHAPE, AND WHY IT IS ONE COLUMN
-- ----------------------------------
-- abstracted_fields is jsonb:
--
--   { "schemaVersion": 1, "model": "…", "at": "ISO-8601",
--     "fields": { "<field>": { "value": …, "quote": "…"|null,
--                              "page": n|null, "confidence": 0..1|null } } }
--
-- It is always read and written as a whole, with its document, by the one
-- code path that produces it; nothing queries across documents by field. A
-- normalised table would be a join for no read. The FIELD LIST is not
-- encoded here on purpose: it is a reading rule owned by acquisition-terms.js,
-- and a constraint that spelled it out would have to be migrated to change it.
--
-- MISSING IS NOT NONE
-- -------------------
-- A field with value null and quote null means THIS DOCUMENT DOES NOT
-- ESTABLISH THE TERM. It is a different thing from a document that says
-- "Tenant shall have no option to renew", which is a value — with its quote.
-- Nothing in this schema, and nothing in the code that writes it, may turn the
-- first into the second.
--
-- WHAT `skipped` MEANS
-- --------------------
-- A rent roll is not abstracted for lease terms; neither is an invoice. Their
-- status is `skipped`, which is a true statement, rather than `pending`,
-- which would be a promise nobody is going to keep.
--
-- Safe to re-run (IF NOT EXISTS / guarded ALTER throughout).
-- Rollback: 025_acquisition_abstraction_rollback.sql
-- Run once in Supabase: SQL Editor → New query → paste → Run.

alter table public.acquisition_documents
  add column if not exists abstracted_fields  jsonb       not null default '{}'::jsonb,
  add column if not exists abstraction_status text        not null default 'pending',
  add column if not exists abstraction_model  text,
  add column if not exists abstracted_at      timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'acq_docs_abstracted_fields_is_object_check'
                   and conrelid = 'public.acquisition_documents'::regclass) then
    alter table public.acquisition_documents add constraint acq_docs_abstracted_fields_is_object_check
      check (jsonb_typeof(abstracted_fields) = 'object');
  end if;

  if not exists (select 1 from pg_constraint where conname = 'acq_docs_abstraction_status_check'
                   and conrelid = 'public.acquisition_documents'::regclass) then
    alter table public.acquisition_documents add constraint acq_docs_abstraction_status_check
      check (abstraction_status in ('pending', 'success', 'partial', 'failed', 'skipped'));
  end if;

  -- A document that claims to have been read carries the evidence it read. An
  -- empty object under `success` or `partial` would be a status with nothing
  -- behind it.
  if not exists (select 1 from pg_constraint where conname = 'acq_docs_abstraction_coherent_check'
                   and conrelid = 'public.acquisition_documents'::regclass) then
    alter table public.acquisition_documents add constraint acq_docs_abstraction_coherent_check
      check (abstraction_status not in ('success', 'partial')
             or (abstracted_fields ? 'fields' and abstracted_at is not null));
  end if;
end $$;

-- The reads P4-2 makes: a family's documents that have evidence to reason from.
create index if not exists idx_acq_docs_abstraction
  on public.acquisition_documents (family_id, abstraction_status)
  where family_id is not null;

comment on column public.acquisition_documents.abstracted_fields is
  'P1-4. What this document says, per term: { schemaVersion, model, at, fields: { <field>: { value, quote, page, confidence } } }. value null + quote null = this document does not establish the term; an explicit negative in the document is a VALUE with a quote. Field list owned by acquisition-terms.js.';
comment on column public.acquisition_documents.abstraction_status is
  'pending | success | partial | failed | skipped. skipped = not a lease-family document (a rent roll, an invoice); a true statement rather than a promise.';
