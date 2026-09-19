-- ─── 029_financial_tables — ROLLBACK ────────────────────────────────────────
-- Drops gl_entries then financial_sources (gl_entries references it).
--
-- DATA: ledger lines and financial-source stubs written since 029 are
-- destroyed. The documents they were parsed from stay in the register.
-- Export first if anything real has been parsed:
--
--   select * from public.gl_entries;
--   select * from public.financial_sources;
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

drop policy if exists gl_entries_member_select            on public.gl_entries;
drop policy if exists gl_entries_member_insert            on public.gl_entries;
drop policy if exists gl_entries_service_role_all         on public.gl_entries;
drop policy if exists financial_sources_member_select     on public.financial_sources;
drop policy if exists financial_sources_member_insert     on public.financial_sources;
drop policy if exists financial_sources_service_role_all  on public.financial_sources;

drop trigger if exists financial_sources_updated_at on public.financial_sources;

drop table if exists public.gl_entries;
drop table if exists public.financial_sources;

commit;
