-- ============================================================================
-- 026_acquisition_term_decisions_rollback.sql
-- ============================================================================
-- TARGET: PILOT PROJECT ONLY (bhmktujbxdbvdmpybmad).
--
-- Undoes 026 and leaves the schema as 025 left it.
--
-- WHAT THIS DESTROYS: every human decision ever recorded about a lease term —
-- the confirmations, the corrections, the rejections and the reasons given for
-- them, with their actors and timestamps. That history CANNOT be rebuilt: it is
-- not derivable from the documents, because it is the record of what people
-- concluded ABOUT the documents.
--
-- It does NOT destroy the AI evidence. `abstracted_fields` is 025's and is
-- untouched here, so the terms go back to reading exactly as they did before
-- anybody confirmed anything.
--
-- The D-17 widening is reverted too, which is refused while any document is
-- actually sitting in `needs_review` — narrowing a CHECK under live rows would
-- either fail loudly or, worse, demand those rows be edited to fit. The
-- operator decides what happens to them; a rollback does not get to.
--
-- Safe to re-run.

drop trigger if exists trg_acq_term_decisions_no_update on public.acquisition_term_decisions;
drop trigger if exists trg_acq_term_decisions_no_delete on public.acquisition_term_decisions;
drop trigger if exists trg_acq_term_decisions_actor     on public.acquisition_term_decisions;

drop table if exists public.acquisition_term_decisions;

drop function if exists public.acq_term_decisions_append_only();
drop function if exists public.acq_term_decisions_actor();

-- ── D-17, back to 024's two values ──────────────────────────────────────────
do $$
declare pending int;
begin
  select count(*) into pending
    from public.acquisition_documents
   where relationship_status = 'needs_review';

  if pending > 0 then
    raise notice 'D-17 NOT reverted: % document(s) are in relationship_status = needs_review.', pending;
    raise notice 'Narrowing the check would refuse those rows. Resolve or clear them first, then re-run.';
  else
    if exists (select 1 from pg_constraint where conname = 'acq_docs_relationship_status_check'
                 and conrelid = 'public.acquisition_documents'::regclass) then
      alter table public.acquisition_documents drop constraint acq_docs_relationship_status_check;
    end if;
    alter table public.acquisition_documents add constraint acq_docs_relationship_status_check
      check (relationship_status is null or relationship_status in ('proposed', 'confirmed'));
  end if;
end $$;
