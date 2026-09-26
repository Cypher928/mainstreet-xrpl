-- ─── 027_evidence_lineage — ROLLBACK ────────────────────────────────────────
-- Drops the three lineage columns, their indexes and the self-reference check.
-- Every evidence row and every pre-027 column is untouched.
--
-- DATA: which document each value came from, and which value superseded
-- which, recorded since 027, is discarded. The values and quotes remain.
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

drop index if exists public.tfe_source_document_idx;
drop index if exists public.tfe_superseded_by_idx;
drop index if exists public.tfe_amendment_idx;

alter table public.tenant_field_evidence drop constraint if exists tfe_not_self_superseding;

alter table public.tenant_field_evidence drop column if exists superseded_by;
alter table public.tenant_field_evidence drop column if exists source_document_id;
alter table public.tenant_field_evidence drop column if exists amendment_id;

commit;
