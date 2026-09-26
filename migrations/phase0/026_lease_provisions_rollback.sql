-- ─── 026_lease_provisions — ROLLBACK ────────────────────────────────────────
-- Drops the table, its trigger and its guard function.
--
-- DATA: every provision row — extracted, confirmed or entered by hand — is
-- destroyed, including its history. Export first if any real provision exists:
--
--   select * from public.lease_provisions;
--
-- Nothing else is touched: the document register, the tenant fields and the
-- evidence rows they cite remain.
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

drop policy if exists lease_provisions_member_select     on public.lease_provisions;
drop policy if exists lease_provisions_member_insert     on public.lease_provisions;
drop policy if exists lease_provisions_member_update     on public.lease_provisions;
drop policy if exists lease_provisions_service_role_all  on public.lease_provisions;

drop trigger  if exists lease_provisions_immutable on public.lease_provisions;
drop function if exists public._lease_provisions_immutable_guard();

drop table if exists public.lease_provisions;

commit;
