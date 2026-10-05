-- ============================================================================
-- 046_acquisition_general_ledger_rollback.sql
-- ============================================================================
-- Removes what 046 added: the import, reversal and purge functions, the actor
-- helpers, the guards, the storage evidence policies and their helper, the
-- three new tables, and the columns, checks and indexes on financial_sources
-- and gl_entries. phase0/029's tables, keys and rules, 045's grants, and any row
-- filed the 029 way are left exactly as they were.
--
-- DATA. It REFUSES while anything 046 recorded exists — an acquisition ledger
-- source (active or reversed), a line carrying a posting date, reference or
-- sheet row, a reversed line, or ANY import history — because dropping those
-- would discard evidence and audit history without anyone choosing to. Removing
-- a disposable prospect removes its ledger; history is removed only by
-- purge_ledger_import_history() once its retention has passed.
-- ============================================================================

begin;

do $$
declare
  v_sources integer := 0; v_lines integer := 0; v_reversed integer := 0; v_history integer := 0;
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'financial_sources' and column_name = 'acquisition_document_id') then
    execute 'select count(*) from public.financial_sources where acquisition_document_id is not null' into v_sources;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'gl_entries' and column_name = 'posted_on') then
    execute 'select count(*) from public.gl_entries where posted_on is not null or reference is not null or source_row is not null' into v_lines;
  end if;
  if to_regclass('public.gl_entries_reversed') is not null then
    execute 'select count(*) from public.gl_entries_reversed' into v_reversed;
  end if;
  if to_regclass('public.ledger_import_history') is not null then
    execute 'select count(*) from public.ledger_import_history' into v_history;
  end if;
  if v_sources + v_lines + v_reversed + v_history > 0 then
    raise exception 'REFUSING ROLLBACK: % ledger source(s), % ledger line(s), % reversed line(s) and % history row(s) were recorded through 046. Rolling back would discard them.',
      v_sources, v_lines, v_reversed, v_history;
  end if;
end $$;

drop policy if exists acq_evidence_no_update on storage.objects;
drop policy if exists acq_evidence_no_delete on storage.objects;
drop function if exists public.storage_object_is_acquisition_evidence(text, text);

drop function if exists public.import_general_ledger(uuid, uuid, jsonb, jsonb, jsonb, text);
drop function if exists public.reverse_general_ledger_import(uuid, uuid, text);
drop function if exists public.purge_ledger_import_history();
drop function if exists public.run_ledger_maintenance();
drop function if exists public.check_ledger_evidence_integrity();
drop table if exists public.ledger_maintenance_runs;

drop trigger if exists gl_entries_import_guard        on public.gl_entries;
drop trigger if exists financial_sources_acq_guard    on public.financial_sources;
drop trigger if exists financial_sources_acq_keep     on public.financial_sources;
drop trigger if exists financial_sources_acq_removed  on public.financial_sources;
drop function if exists public.gl_entries_import_guard();
drop function if exists public.financial_sources_acq_guard();
drop function if exists public.financial_sources_acq_keep();
drop function if exists public.financial_sources_acq_removed();
drop function if exists public.ledger_actor_may_edit(uuid, uuid);
drop function if exists public.ledger_actor_is_admin(uuid, uuid);

drop table if exists public.gl_entry_sources;
drop table if exists public.gl_entries_reversed;
drop table if exists public.ledger_import_history;
drop function if exists public.ledger_import_history_append_only();

drop index if exists public.gl_entries_property_posted_idx;
alter table public.gl_entries drop constraint if exists gl_entries_one_side_check;
alter table public.gl_entries drop constraint if exists gl_entries_source_row_check;
alter table public.gl_entries drop column if exists source_row;
alter table public.gl_entries drop column if exists reference;
alter table public.gl_entries drop column if exists posted_on;

drop index if exists public.financial_sources_acq_active_document_uniq;
drop index if exists public.financial_sources_acq_active_file_uniq;
drop index if exists public.financial_sources_acq_document_idx;
alter table public.financial_sources drop constraint if exists financial_sources_acq_import_shape;
alter table public.financial_sources drop constraint if exists financial_sources_one_document_link;
alter table public.financial_sources drop constraint if exists financial_sources_acquisition_document_fk;
alter table public.financial_sources drop column if exists reversal_reason;
alter table public.financial_sources drop column if exists reversed_by;
alter table public.financial_sources drop column if exists reversed_at;
alter table public.financial_sources drop column if exists date_order;
alter table public.financial_sources drop column if exists storage_path;
alter table public.financial_sources drop column if exists file_bytes;
alter table public.financial_sources drop column if exists file_etag;
alter table public.financial_sources drop column if exists file_sha256;
alter table public.financial_sources drop column if exists import_status;
alter table public.financial_sources drop column if exists acquisition_document_id;

commit;
