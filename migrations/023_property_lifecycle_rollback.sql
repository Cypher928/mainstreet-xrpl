-- ─── 023_property_lifecycle — ROLLBACK ──────────────────────────────────────
-- Removes the stage columns, their constraint and index, and the legacy
-- review table's property link.
--
-- DATA: dropping lifecycle_stage discards the stage of every property. Any
-- property that was at a pre-acquisition stage (a prospect) becomes
-- indistinguishable from a managed property once the column is gone — it will
-- appear in the portfolio. Check before running:
--
--   select id, name, lifecycle_stage from public.properties where lifecycle_stage <> 'acquired';
--
-- Nothing else is deleted: no property row, document, tenant or evidence.
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

drop index if exists public.acq_reviews_property_id_idx;
alter table public.acquisition_reviews drop column if exists property_id;

drop index if exists public.properties_user_stage_active_idx;
alter table public.properties drop constraint if exists properties_lifecycle_stage_check;
alter table public.properties drop column if exists stage_changed_at;
alter table public.properties drop column if exists stage_changed_by;
alter table public.properties drop column if exists passed_at;
alter table public.properties drop column if exists acquired_at;
alter table public.properties drop column if exists lifecycle_stage;

commit;
