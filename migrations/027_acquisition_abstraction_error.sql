-- ============================================================================
-- 027_acquisition_abstraction_error.sql — WHY a reading failed
-- ============================================================================
-- TARGET: PILOT PROJECT ONLY (bhmktujbxdbvdmpybmad).
-- NEVER apply to production (zhsuhehgehbzkmzurzyf).
--
-- WHY
-- ---
-- Acquisition Review Phase 1, P4-3 remediation, Issue A4.
--
-- A live document on the Pilot came back `abstraction_status = 'failed'` with
-- abstracted_fields {}, abstraction_model null, abstracted_at null and
-- error_message null. Nothing on the row said what had gone wrong, and the
-- three separate code paths that write `failed` — no text on the row, the
-- request never came back, the reply carried no fields — were indistinguishable
-- once written.
--
-- The actual cause took the SERVER'S LOGS to find, and it was none of the three
-- a reader would have guessed: the call had SUCCEEDED, returned HTTP 200 and
-- produced valid 27-field evidence, and the browser had aborted two seconds
-- early because its fetch ceiling (58s) sat below the function's own ceiling
-- (60s). Correct work, discarded, filed under a word that did not describe it.
--
-- That is the gap this column closes. A row that failed should say why, on the
-- row, in one word, without anyone reading a log.
--
-- WHAT THIS IS NOT
-- ----------------
-- It is NOT a sixth abstraction_status. A status says WHERE a reading got to;
-- a reason says WHY it stopped. Widening the status vocabulary would have
-- meant every reader of `failed` had to learn five new words to keep meaning
-- what it already meant. acq_docs_abstraction_status_check (025) is untouched.
--
-- It is NOT error_message. That column belongs to the PARSING stage — it
-- carries why a PDF could not be read or stored — and a document can fail to
-- parse and fail to abstract for entirely unrelated reasons. One column per
-- stage, so neither overwrites the other's account of itself.
--
-- THE VOCABULARY
-- --------------
--   no_text           there was no usable text on the row to read
--   transport         the request never completed: aborted, or the network went
--   upstream_timeout  the server reached Claude; Claude did not answer in time
--   upstream_error    the server reached Claude; Claude answered with an error
--   unparsable        an answer came back and it was not JSON we could read
--   no_fields         valid JSON, but it carried no `fields` object
--
-- The same six live in acquisition-terms.js (ABSTRACTION_ERRORS) and in
-- acquisition-documents.js, which writes them. A test holds all three equal,
-- the same guard P1-4 put on the status list.
--
-- Guarded and idempotent throughout. Safe to re-run.
-- ============================================================================

alter table public.acquisition_documents
  add column if not exists abstraction_error text;

do $$
begin
  -- Null, or one of the six. A reason nobody can look up is not a reason, and
  -- a free-text column would become one sentence per call site within a month.
  if not exists (select 1 from pg_constraint
                  where conname = 'acq_docs_abstraction_error_check'
                    and conrelid = 'public.acquisition_documents'::regclass) then
    alter table public.acquisition_documents
      add constraint acq_docs_abstraction_error_check
      check (abstraction_error is null
             or abstraction_error in ('no_text', 'transport', 'upstream_timeout',
                                      'upstream_error', 'unparsable', 'no_fields'));
  end if;

  -- A reason belongs to a failure. `success`, `partial`, `pending` and
  -- `skipped` are not failures, so they carry no reason — otherwise a reading
  -- that eventually landed would keep wearing the reason its first attempt
  -- failed with, and the row would contradict itself.
  if not exists (select 1 from pg_constraint
                  where conname = 'acq_docs_abstraction_error_coherent_check'
                    and conrelid = 'public.acquisition_documents'::regclass) then
    alter table public.acquisition_documents
      add constraint acq_docs_abstraction_error_coherent_check
      check (abstraction_error is null or abstraction_status = 'failed');
  end if;
end $$;

comment on column public.acquisition_documents.abstraction_error is
  'WHY the term reading failed, when abstraction_status = ''failed''. One of '
  'no_text | transport | upstream_timeout | upstream_error | unparsable | '
  'no_fields. Null otherwise. Distinct from error_message, which belongs to '
  'the parsing stage. See migrations/027_acquisition_abstraction_error.sql.';
