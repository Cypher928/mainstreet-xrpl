-- ─── 026b_lease_provisions_privileges — ROLLBACK ────────────────────────────
-- Restores the privilege set 026 left behind on a Supabase project (the
-- schema default: ALL to authenticated). Row-level security is unchanged
-- either way; this only reopens the table-privilege layer 026b closed.
--
-- There is no reason to run this except to reproduce the pre-026b state.
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

grant delete, truncate, references, trigger on public.lease_provisions to authenticated;

commit;
