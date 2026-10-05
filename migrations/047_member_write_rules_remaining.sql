-- ============================================================================
-- 047_member_write_rules_remaining.sql — the lease document register and the
-- organisation storage folders follow 045's rule: members read, editors write;
-- the latent grants on the organisation tables and the register are removed
-- ============================================================================
-- TARGET: PILOT PROJECT (bhmktujbxdbvdmpybmad) ONLY. Refuses to run unless the
-- Pilot marker property exists. NOT APPLIED. Requires 045 (can_edit_property,
-- is_active_editor_of_org) and phase0/024 (member_property_ids,
-- storage_object_accessible). Verified by tools/verify-migration-047.js.
--
-- WHY
--   045 narrowed the acquisition tables, properties and the ledger. It left, as
--   phase0/024 wrote them (read on a Pilot-shaped stand-in, 2026-10-04):
--     · lease_documents  lease_docs_owner_all, FOR ALL to every active member of
--       the property's organisation, read_only included. A read-only member can
--       add, rename and delete rows of the lease document register.
--     · storage.objects  docs_owner_insert / _update / _delete admit any object
--       whose first folder is an organisation the caller is an active member of
--       (storage_object_accessible). A read-only member can put, overwrite and
--       delete files in the organisation's folder.
--     · grants  anon and authenticated hold every privilege (TRUNCATE included)
--       on organization_members, organizations and lease_documents, from the
--       legacy default privileges. Row rules refuse every write the API can
--       send, and TRUNCATE is not something PostgREST issues — but one mis-edited
--       policy would be the only thing left.
--
-- WHAT CHANGES
--   lease_documents   lease_docs_owner_all → lease_docs_member_select (the same
--                     predicate: member_property_ids) + lease_docs_editor_insert /
--                     _update / _delete (can_edit_property). The app writes this
--                     table only through api/lease-documents.js with the service
--                     key; ask-lease and validate-lease read it the same way. No
--                     browser code writes it, so no app path changes.
--   storage.objects   a new helper, storage_object_writable(name): the caller's
--                     own folder, or an organisation they may EDIT (an accepted,
--                     unrevoked member whose role is not read_only). The three
--                     write rules use it; docs_owner_read is unchanged, so every
--                     member still opens what they opened. The app uploads only
--                     through api/upload.js with the service key, which these
--                     rules do not restrain; the rules govern direct storage
--                     calls by a signed-in person, which the app never makes.
--                     046's two RESTRICTIVE rules on acquisition originals stay.
--   grants            organization_members, organizations: authenticated keeps
--                     SELECT only; anon loses everything. Membership is written
--                     by properties_default_organization (SECURITY DEFINER) and
--                     by the server; no signed-in path writes these tables.
--                     lease_documents: anon loses everything; authenticated
--                     loses TRUNCATE, REFERENCES and TRIGGER and keeps SELECT,
--                     INSERT, UPDATE, DELETE under the new row rules.
--
-- NOT CHANGED: any row; docs_owner_read; storage_object_accessible (still used
-- by the read rule); the service-role policies; tenants, lease_jobs,
-- tenant_field_evidence, tenant_review_audit, cam_reconciliations, tenant_users,
-- tenant_invitations, tenant_statements (audited separately; see 048).
--
-- ROLLBACK: 047_member_write_rules_remaining_rollback.sql restores 024's
-- policy, the three storage rules and every grant exactly — and with them
-- every gap above.
-- ============================================================================

begin;

do $$
begin
  if not exists (select 1 from public.properties where id = 'fd9c09b1-b657-4c58-9999-c3cce28e7600') then
    raise exception 'REFUSING TO RUN: pilot marker property not found. This does not appear to be the pilot project (bhmktujbxdbvdmpybmad). 047 must never be applied to production.';
  end if;
  if to_regprocedure('public.can_edit_property(uuid)') is null or to_regprocedure('public.is_active_editor_of_org(uuid)') is null then
    raise exception '047 requires 045 (can_edit_property, is_active_editor_of_org)';
  end if;
  if to_regprocedure('public.member_property_ids()') is null or to_regprocedure('public.storage_object_accessible(text)') is null then
    raise exception '047 requires phase0/024 (member_property_ids, storage_object_accessible)';
  end if;
  if to_regclass('public.lease_documents') is null or to_regclass('storage.objects') is null then
    raise exception '047 requires lease_documents and Supabase storage (storage.objects)';
  end if;
end $$;

-- ── lease_documents: members read, editors write ────────────────────────────
drop policy if exists "lease_docs_owner_all"   on public.lease_documents;
drop policy if exists lease_docs_member_select on public.lease_documents;
drop policy if exists lease_docs_editor_insert on public.lease_documents;
drop policy if exists lease_docs_editor_update on public.lease_documents;
drop policy if exists lease_docs_editor_delete on public.lease_documents;
create policy lease_docs_member_select on public.lease_documents
  for select to authenticated
  using (property_id in (select public.member_property_ids()));
create policy lease_docs_editor_insert on public.lease_documents
  for insert to authenticated
  with check (public.can_edit_property(property_id));
create policy lease_docs_editor_update on public.lease_documents
  for update to authenticated
  using      (public.can_edit_property(property_id))
  with check (public.can_edit_property(property_id));
create policy lease_docs_editor_delete on public.lease_documents
  for delete to authenticated
  using (public.can_edit_property(property_id));

-- ── storage: a write needs your own folder or an organisation you may edit ──
-- Same shape as storage_object_accessible (phase0/024), which the read rule
-- keeps: the first folder is the caller's own uid, or an organisation — here,
-- one the caller is an accepted, unrevoked, non-read-only member of. VOLATILE
-- for the same reason as is_active_editor_of_org (045).
create or replace function public.storage_object_writable(object_name text)
returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
  select (storage.foldername(object_name))[1] = auth.uid()::text
      or exists (
           select 1 from public.organization_members m
            where m.user_id = auth.uid()
              and m.accepted_at is not null and m.revoked_at is null
              and m.role <> 'read_only'
              and m.organization_id::text = (storage.foldername(object_name))[1])
$$;
revoke all on function public.storage_object_writable(text) from public, anon;
grant execute on function public.storage_object_writable(text) to authenticated, service_role;
comment on function public.storage_object_writable(text) is
  '047: the caller may write at this path — their own folder, or the folder of an organisation they may edit (accepted, unrevoked, not read_only). Reads keep storage_object_accessible.';

drop policy if exists "docs_owner_insert" on storage.objects;
drop policy if exists "docs_owner_update" on storage.objects;
drop policy if exists "docs_owner_delete" on storage.objects;
create policy "docs_owner_insert"
  on storage.objects for insert
  to authenticated
  with check (bucket_id in ('leases', 'invoices') and public.storage_object_writable(name));
create policy "docs_owner_update"
  on storage.objects for update
  to authenticated
  using      (bucket_id in ('leases', 'invoices') and public.storage_object_writable(name))
  with check (bucket_id in ('leases', 'invoices') and public.storage_object_writable(name));
create policy "docs_owner_delete"
  on storage.objects for delete
  to authenticated
  using (bucket_id in ('leases', 'invoices') and public.storage_object_writable(name));

-- ── grants ──────────────────────────────────────────────────────────────────
revoke insert, update, delete, truncate, references, trigger on public.organization_members, public.organizations from authenticated;
revoke all on public.organization_members, public.organizations, public.lease_documents from anon;
revoke truncate, references, trigger on public.lease_documents from authenticated;

commit;
