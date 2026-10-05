-- ============================================================================
-- 047_member_write_rules_remaining_rollback.sql
-- ============================================================================
-- Restores, exactly, what 047 replaced: phase0/024's lease_docs_owner_all (FOR
-- ALL to every active member), its three storage write rules on
-- storage_object_accessible, and the legacy grants — every privilege for anon
-- and authenticated on organization_members, organizations and lease_documents.
-- Drops storage_object_writable.
--
-- THIS RE-OPENS EVERY GAP 047 CLOSED: read-only members writing and deleting
-- the lease document register, and putting, overwriting and deleting files in
-- an organisation's storage folder; anon and authenticated holding TRUNCATE on
-- the three tables. It changes no row.
--
-- TARGET: PILOT PROJECT (bhmktujbxdbvdmpybmad) ONLY. The GRANT ALL below
-- restores Pilot's recorded pre-047 state; on any other database it would
-- widen permissions. Refuses to run unless the Pilot marker property exists.
-- ============================================================================

begin;

do $$
begin
  if not exists (select 1 from public.properties where id = 'fd9c09b1-b657-4c58-9999-c3cce28e7600') then
    raise exception 'REFUSING TO RUN: pilot marker property not found. This does not appear to be the pilot project (bhmktujbxdbvdmpybmad). The 047 rollback must never be run on production.';
  end if;
end $$;

-- ── lease_documents, as phase0/024 left it ─────────────────────────────────
drop policy if exists lease_docs_member_select on public.lease_documents;
drop policy if exists lease_docs_editor_insert on public.lease_documents;
drop policy if exists lease_docs_editor_update on public.lease_documents;
drop policy if exists lease_docs_editor_delete on public.lease_documents;
drop policy if exists "lease_docs_owner_all"   on public.lease_documents;
create policy "lease_docs_owner_all"
  on public.lease_documents
  for all to authenticated
  using      (property_id in (select public.member_property_ids()))
  with check (property_id in (select public.member_property_ids()));

-- ── storage write rules, as phase0/024 left them ───────────────────────────
drop policy if exists "docs_owner_insert" on storage.objects;
drop policy if exists "docs_owner_update" on storage.objects;
drop policy if exists "docs_owner_delete" on storage.objects;
create policy "docs_owner_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id in ('leases', 'invoices')
    and public.storage_object_accessible(name)
  );
create policy "docs_owner_update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id in ('leases', 'invoices')
    and public.storage_object_accessible(name)
  )
  with check (
    bucket_id in ('leases', 'invoices')
    and public.storage_object_accessible(name)
  );
create policy "docs_owner_delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id in ('leases', 'invoices')
    and public.storage_object_accessible(name)
  );

drop function if exists public.storage_object_writable(text);

-- ── grants, as they were ────────────────────────────────────────────────────
grant all on public.organization_members, public.organizations, public.lease_documents to anon, authenticated;

commit;
