-- ============================================================================
-- 026_acquisition_term_decisions.sql — what a PERSON decided about a term
-- ============================================================================
-- TARGET: PILOT PROJECT ONLY (bhmktujbxdbvdmpybmad).
-- NEVER apply to production (zhsuhehgehbzkmzurzyf).
--
-- WHY
-- ---
-- Acquisition Review Phase 1, increment P1-4, step P4-3. 025 recorded what each
-- DOCUMENT says. P4-2 turned a family of those into one set of terms, each with
-- a state. Nothing yet records what a PERSON decided about any of them, and
-- without that no term can ever read `verified` — which is the approved rule:
-- AI proposes, a human confirms, and AI never writes verified truth.
--
-- APPEND-ONLY, AND WHY IT IS A TABLE RATHER THAN A COLUMN
-- ------------------------------------------------------
-- A decision is an EVENT, not a property of a term. "The cap was confirmed at
-- 4%, then corrected to 5%, then reopened" is three facts about three moments,
-- and a column would keep only the last one. The current decision is the
-- latest row by decided_at; everything before it is the audit trail, and the
-- trigger below REFUSES update and delete so that trail cannot be rewritten
-- after the fact. A decision somebody can quietly edit is not an audit record.
--
-- The AI's reading is NOT stored here and is NOT touched by anything here. It
-- lives in acquisition_documents.abstracted_fields, where 025 put it. A
-- correction records the NEW value beside the one it replaced
-- (previous_value); it does not reach into the document and overwrite what the
-- document said. Rejecting a reading does not delete it either. The evidence
-- and the decisions are two separate records of two separate things, and the
-- resolver (acquisition-terms.js resolveTerms) lays one over the other at read
-- time without merging them.
--
-- WHAT `field_key` IS NOT
-- ----------------------
-- It is not constrained to a list here on purpose. The 27 field names are a
-- reading rule owned by acquisition-terms.js, exactly as 025's evidence shape
-- is; a CHECK spelling them out would have to be migrated to add a field. It
-- is bounded in length and required to be non-blank, which is what the
-- database can honestly enforce.
--
-- D-17 · A RELATIONSHIP THAT NEEDS A PERSON
-- -----------------------------------------
-- Reclassifying a document out of a lease-family type used to discard its
-- parent and relationship outright (P1-3). The approved plan replaces that
-- with `needs_review`: the relationship is PRESERVED and flagged, because a
-- document that amended a lease yesterday still amended it today, and throwing
-- the link away to keep two columns tidy destroys a fact. The check is widened
-- here; acqSetDocType writes it.
--
-- Safe to re-run (IF NOT EXISTS / guarded throughout).
-- Rollback: 026_acquisition_term_decisions_rollback.sql
-- Run once in Supabase: SQL Editor → New query → paste → Run.

create table if not exists public.acquisition_term_decisions (
  id                  uuid primary key default gen_random_uuid(),
  review_id           uuid        not null,
  user_id             uuid        not null,
  family_id           uuid,
  field_key           text        not null,
  action              text        not null,
  -- What the term read BEFORE this decision, kept as text because a term's
  -- type varies by field and this is a record of what was on screen, not a
  -- typed value anybody computes with.
  previous_value      text,
  new_value           text,
  -- Where the person says the answer comes from. Optional: confirming the
  -- reading the documents already produced needs no new citation.
  source_document_id  uuid,
  source_quote        text,
  source_page         integer,
  decided_by          uuid        not null,
  decided_at          timestamptz not null default now(),
  note                text,
  created_at          timestamptz not null default now()
);

-- ── Constraints ─────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'acq_term_decisions_action_check'
                   and conrelid = 'public.acquisition_term_decisions'::regclass) then
    alter table public.acquisition_term_decisions add constraint acq_term_decisions_action_check
      check (action in ('confirm', 'correct', 'reject', 'reopen'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'acq_term_decisions_field_key_check'
                   and conrelid = 'public.acquisition_term_decisions'::regclass) then
    alter table public.acquisition_term_decisions add constraint acq_term_decisions_field_key_check
      check (length(btrim(field_key)) between 1 and 120);
  end if;

  -- A correction that corrects nothing is not a correction. Every other action
  -- is allowed to carry no new value: confirming keeps what is there,
  -- rejecting and reopening assert no value at all.
  if not exists (select 1 from pg_constraint where conname = 'acq_term_decisions_correct_has_value_check'
                   and conrelid = 'public.acquisition_term_decisions'::regclass) then
    alter table public.acquisition_term_decisions add constraint acq_term_decisions_correct_has_value_check
      check (action <> 'correct' or (new_value is not null and length(btrim(new_value)) > 0));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'acq_term_decisions_page_check'
                   and conrelid = 'public.acquisition_term_decisions'::regclass) then
    alter table public.acquisition_term_decisions add constraint acq_term_decisions_page_check
      check (source_page is null or source_page > 0);
  end if;

  -- Bounded text, so one decision cannot carry a document.
  if not exists (select 1 from pg_constraint where conname = 'acq_term_decisions_text_bounds_check'
                   and conrelid = 'public.acquisition_term_decisions'::regclass) then
    alter table public.acquisition_term_decisions add constraint acq_term_decisions_text_bounds_check
      check ((previous_value is null or length(previous_value) <= 4000)
         and (new_value      is null or length(new_value)      <= 4000)
         and (source_quote   is null or length(source_quote)   <= 600)
         and (note           is null or length(note)           <= 2000));
  end if;

  -- ── Composite foreign keys, all on user_id ────────────────────────────────
  -- The same ownership rule 023 and 024 use: nothing may point across owners,
  -- because the pair (id, user_id) of another person's row does not exist.
  if not exists (select 1 from pg_constraint where conname = 'acq_term_decisions_review_fk'
                   and conrelid = 'public.acquisition_term_decisions'::regclass) then
    alter table public.acquisition_term_decisions
      add constraint acq_term_decisions_review_fk
      foreign key (review_id, user_id)
      references public.acquisition_reviews (id, user_id)
      on delete cascade;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'acq_term_decisions_family_fk'
                   and conrelid = 'public.acquisition_term_decisions'::regclass) then
    alter table public.acquisition_term_decisions
      add constraint acq_term_decisions_family_fk
      foreign key (family_id, user_id)
      references public.acquisition_document_families (id, user_id)
      -- The column list matters: without it a composite SET NULL would try to
      -- null user_id too, which is NOT NULL, and deleting a family would fail.
      on delete set null (family_id);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'acq_term_decisions_source_doc_fk'
                   and conrelid = 'public.acquisition_term_decisions'::regclass) then
    alter table public.acquisition_term_decisions
      add constraint acq_term_decisions_source_doc_fk
      foreign key (source_document_id, user_id)
      references public.acquisition_documents (id, user_id)
      on delete set null (source_document_id);
  end if;
end $$;

-- The read P4-3 makes: one family's decisions, newest last.
create index if not exists idx_acq_term_decisions_family
  on public.acquisition_term_decisions (review_id, family_id, field_key, decided_at);
create index if not exists idx_acq_term_decisions_owner
  on public.acquisition_term_decisions (user_id, review_id);

-- ── Append-only ─────────────────────────────────────────────────────────────
-- The whole point of the table: a correction history cannot be tidied up
-- afterwards by anybody, including the person who wrote it. Reopening is an
-- INSERT, like every other act.
--
-- A BLANKET refusal of UPDATE and DELETE was the first attempt and it was
-- WRONG, which executing it against a real cluster is what showed. The
-- database performs its own UPDATEs and DELETEs here: `on delete set null`
-- nulls family_id when a family is deleted, and `on delete cascade` removes
-- decisions when their review is deleted. A blanket refusal makes those
-- cascades fail, so a family or a review could never be deleted again once a
-- single decision existed. The guarantee has to protect the DECISION, not
-- forbid the statement.
--
-- So: what makes a decision a decision — its action, its values, its citation,
-- its actor and its timestamps — is immutable. The two nullable foreign keys
-- are filing, and the database is allowed to clear them when what they point
-- at goes away. A delete is allowed only when the review itself has gone,
-- which is the cascade doing its work; by then the parent row is no longer
-- visible, and every other delete still has its review and is refused.
create or replace function public.acq_term_decisions_append_only()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from public.acquisition_reviews where id = old.review_id) then
      raise exception 'acquisition_term_decisions is append-only: DELETE is refused. The history of a decision is not editable.'
        using errcode = 'restrict_violation';
    end if;
    return old;   -- the review is gone; this row goes with it
  end if;

  -- The only UPDATE anybody gets: clearing a link to something that has been
  -- deleted. Every column that carries the decision itself must be untouched,
  -- and a cleared link may only become NULL, never be repointed.
  if (new.family_id is not distinct from old.family_id or new.family_id is null)
     and (new.source_document_id is not distinct from old.source_document_id or new.source_document_id is null)
     and new.id            =            old.id
     and new.review_id     =            old.review_id
     and new.user_id       =            old.user_id
     and new.field_key     =            old.field_key
     and new.action        =            old.action
     and new.previous_value is not distinct from old.previous_value
     and new.new_value      is not distinct from old.new_value
     and new.source_quote   is not distinct from old.source_quote
     and new.source_page    is not distinct from old.source_page
     and new.decided_by    =            old.decided_by
     and new.decided_at    =            old.decided_at
     and new.note           is not distinct from old.note
     and new.created_at    =            old.created_at
  then
    return new;
  end if;

  raise exception 'acquisition_term_decisions is append-only: UPDATE is refused. Record a new decision instead.'
    using errcode = 'restrict_violation';
end $$;

drop trigger if exists trg_acq_term_decisions_no_update on public.acquisition_term_decisions;
create trigger trg_acq_term_decisions_no_update
  before update on public.acquisition_term_decisions
  for each row execute function public.acq_term_decisions_append_only();

drop trigger if exists trg_acq_term_decisions_no_delete on public.acquisition_term_decisions;
create trigger trg_acq_term_decisions_no_delete
  before delete on public.acquisition_term_decisions
  for each row execute function public.acq_term_decisions_append_only();

-- ── A decision names the person who made it ─────────────────────────────────
-- decided_by is NOT NULL above; this refuses the subtler version, where the
-- row names somebody who is not the owner making the write.
create or replace function public.acq_term_decisions_actor()
returns trigger language plpgsql as $$
begin
  if new.decided_by is distinct from new.user_id then
    raise exception 'A decision must be recorded by its owner (decided_by must equal user_id).'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists trg_acq_term_decisions_actor on public.acquisition_term_decisions;
create trigger trg_acq_term_decisions_actor
  before insert on public.acquisition_term_decisions
  for each row execute function public.acq_term_decisions_actor();

-- ── RLS: owner only, nothing for anon ───────────────────────────────────────
alter table public.acquisition_term_decisions enable row level security;

drop policy if exists "acq_term_decisions_owner_all"        on public.acquisition_term_decisions;
drop policy if exists "acq_term_decisions_service_role_all" on public.acquisition_term_decisions;

create policy "acq_term_decisions_owner_all"
  on public.acquisition_term_decisions
  for all to authenticated
  using      (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "acq_term_decisions_service_role_all"
  on public.acquisition_term_decisions
  for all to service_role using (true) with check (true);

-- ── D-17 · a relationship that needs a person ───────────────────────────────
-- Widened, not replaced: `proposed` and `confirmed` still mean what they meant.
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'acq_docs_relationship_status_check'
               and conrelid = 'public.acquisition_documents'::regclass) then
    alter table public.acquisition_documents drop constraint acq_docs_relationship_status_check;
  end if;
  alter table public.acquisition_documents add constraint acq_docs_relationship_status_check
    check (relationship_status is null
        or relationship_status in ('proposed', 'confirmed', 'needs_review'));
end $$;

comment on table public.acquisition_term_decisions is
  'P1-4 / P4-3. One row per human act on one lease term: confirm | correct | reject | reopen. Append-only — a trigger refuses UPDATE and DELETE — so the correction history cannot be rewritten. The current decision is the latest row by decided_at. The AI reading it overlays lives in acquisition_documents.abstracted_fields and is never modified from here.';
comment on column public.acquisition_term_decisions.previous_value is
  'What the term read BEFORE this decision. Kept so a correction records what it replaced rather than erasing it.';
comment on column public.acquisition_term_decisions.field_key is
  'One of acquisition-terms.js FIELDS. Deliberately not a CHECK list: the vocabulary is the module''s, and a constraint would have to be migrated to add a field.';
