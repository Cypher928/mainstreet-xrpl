-- ─── 027_evidence_lineage — Phase 0, P0.3 ───────────────────────────────────
--
-- The backlog item docs/LEASE_AMENDMENTS.md recorded: an evidence row does
-- not say WHICH DOCUMENT it came from, or that a later document superseded
-- it. Families (S6) need both, and so does the honesty rule the amendment
-- chip already enforces by hand — "a superseded clause is not evidence".
--
-- tenant_field_evidence is EXTENDED, not replaced. The 440 rows on Pilot keep
-- every column they have; the writer (_writeTenantFieldEvidence) keeps its
-- payload and its dedup key (tenant_id, field_key, reviewed_at). The three
-- new columns are nullable and are filled by the writers that learn to fill
-- them (P0.5 / S6), never by this migration: a row that predates lineage has
-- an unknown source, and unknown is recorded as NULL, not guessed.
--
--   amendment_id        the app-side amendment id (tenant.amendments[].amendmentId,
--                       text) the value came from, when it came from one
--   source_document_id  the register row (025) the quote was read from
--   superseded_by       the later evidence row for the same field that
--                       replaced this value; the chip reads it to refuse a
--                       stale citation
--
-- No policy change: tfe_owner_all (024) governs the new columns.
--
-- PILOT ONLY. Same marker guard. Idempotent. Rollback: 027_evidence_lineage_rollback.sql.

begin;

do $$
begin
  if not exists (
    select 1 from public.properties
    where id = 'fd9c09b1-b657-4c58-9999-c3cce28e7600'
  ) then
    raise exception
      'REFUSING TO RUN: pilot marker property not found. This does not appear to be the pilot project (bhmktujbxdbvdmpybmad). 027 must never be applied to production.';
  end if;
end $$;

alter table public.tenant_field_evidence add column if not exists amendment_id       text;
alter table public.tenant_field_evidence add column if not exists source_document_id uuid references public.lease_documents(id) on delete set null;
alter table public.tenant_field_evidence add column if not exists superseded_by      uuid references public.tenant_field_evidence(id) on delete set null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tfe_not_self_superseding' and conrelid = 'public.tenant_field_evidence'::regclass) then
    alter table public.tenant_field_evidence add constraint tfe_not_self_superseding
      check (superseded_by is null or superseded_by <> id);
  end if;
end $$;

create index if not exists tfe_source_document_idx on public.tenant_field_evidence (source_document_id) where source_document_id is not null;
create index if not exists tfe_superseded_by_idx   on public.tenant_field_evidence (superseded_by)      where superseded_by is not null;
create index if not exists tfe_amendment_idx       on public.tenant_field_evidence (amendment_id)       where amendment_id is not null;

comment on column public.tenant_field_evidence.amendment_id is
  'P0.3: the app-side amendment id (tenant.amendments[].amendmentId) this value came from, when it came from an amendment. NULL for rows written before lineage or for the original lease.';
comment on column public.tenant_field_evidence.source_document_id is
  'P0.3: the document register row the quote was read from. NULL = unknown (written before lineage) or a manual entry, which cites a person.';
comment on column public.tenant_field_evidence.superseded_by is
  'P0.3: the later evidence row for the same field whose value replaced this one. A row with superseded_by set is history, never support for the current value.';

commit;

-- ── Verify (run after commit) ──────────────────────────────────────────────
-- select count(*) as rows_with_lineage from public.tenant_field_evidence where source_document_id is not null or amendment_id is not null or superseded_by is not null;  -- expect 0 right after 027
-- select count(*) from public.tenant_field_evidence;                                   -- unchanged from before (440 on Pilot at authoring)
-- select conname from pg_constraint where conname = 'tenant_field_evidence_dedup';    -- still present
