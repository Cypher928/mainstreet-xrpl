-- ─── 024_organizations — ROLLBACK ───────────────────────────────────────────
-- Restores every policy 024 rewrote to its pre-024 text (verbatim from the
-- migration that last defined it), restores _payment_assert_owner, removes
-- the trigger, the helpers, the column and the two tables.
--
-- DATA: dropping organization_members removes every membership, including
-- any deliberately granted after 024. Properties fall back to owner-only
-- access. Nothing else is deleted — properties, tenants, documents, evidence
-- and audit rows are untouched.
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

-- ── Storage (011 text) ─────────────────────────────────────────────────────
drop policy if exists "docs_owner_read"   on storage.objects;
drop policy if exists "docs_owner_insert" on storage.objects;
drop policy if exists "docs_owner_update" on storage.objects;
drop policy if exists "docs_owner_delete" on storage.objects;

create policy "docs_owner_read"
  on storage.objects for select
  to authenticated
  using (
    bucket_id in ('leases', 'invoices')
    and (storage.foldername(name))[1] = auth.uid()::text
  );
create policy "docs_owner_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id in ('leases', 'invoices')
    and (storage.foldername(name))[1] = auth.uid()::text
  );
create policy "docs_owner_update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id in ('leases', 'invoices')
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id in ('leases', 'invoices')
    and (storage.foldername(name))[1] = auth.uid()::text
  );
create policy "docs_owner_delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id in ('leases', 'invoices')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ── payments family (022 text) ─────────────────────────────────────────────
create or replace function public._payment_assert_owner(p_property_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.properties
                 where id = p_property_id and user_id = auth.uid()) then
    raise exception 'Not authorized: caller does not own property %', p_property_id
      using errcode = 'insufficient_privilege';
  end if;
end $$;

drop policy if exists payments_landlord_select on public.payments;
create policy payments_landlord_select on public.payments for select
  using (property_id in (select id from public.properties where user_id = auth.uid()));
drop policy if exists payment_sources_landlord_select on public.payment_sources;
create policy payment_sources_landlord_select on public.payment_sources for select
  using (property_id in (select id from public.properties where user_id = auth.uid()));
drop policy if exists payment_settlements_landlord_select on public.payment_settlements;
create policy payment_settlements_landlord_select on public.payment_settlements for select
  using (property_id in (select id from public.properties where user_id = auth.uid()));
drop policy if exists payment_events_landlord_select on public.payment_events;
create policy payment_events_landlord_select on public.payment_events for select
  using (property_id in (select id from public.properties where user_id = auth.uid()));

-- ── tenant_statements (pre-024 text) ───────────────────────────────────────
drop policy if exists tenant_statements_landlord_all on public.tenant_statements;
create policy tenant_statements_landlord_all on public.tenant_statements
  for all to authenticated
  using      (property_id in (select p.id from public.properties p where p.user_id = auth.uid()))
  with check (property_id in (select p.id from public.properties p where p.user_id = auth.uid()));

-- ── tenant_invitations (014 text) ──────────────────────────────────────────
drop policy if exists tenant_invitations_landlord_all on public.tenant_invitations;
create policy tenant_invitations_landlord_all on public.tenant_invitations
  for all to authenticated
  using (
    property_id in (select p.id from public.properties p where p.user_id = auth.uid())
  )
  with check (
    property_id in (select p.id from public.properties p where p.user_id = auth.uid())
  );

-- ── tenant_users (012 text) ────────────────────────────────────────────────
drop policy if exists tenant_users_landlord_all on public.tenant_users;
create policy tenant_users_landlord_all on public.tenant_users
  for all to authenticated
  using (
    property_id in (select p.id from public.properties p where p.user_id = auth.uid())
  )
  with check (
    property_id in (select p.id from public.properties p where p.user_id = auth.uid())
  );

-- ── lease_documents (004 text) ─────────────────────────────────────────────
drop policy if exists "lease_docs_owner_all" on public.lease_documents;
create policy "lease_docs_owner_all"
  on public.lease_documents
  for all to authenticated
  using (
    property_id in (
      select id from public.properties
      where user_id = auth.uid()
    )
  )
  with check (
    property_id in (
      select id from public.properties
      where user_id = auth.uid()
    )
  );

-- ── cam_reconciliations (003 text) ─────────────────────────────────────────
drop policy if exists "cam_recon_owner_all" on public.cam_reconciliations;
create policy "cam_recon_owner_all"
  on public.cam_reconciliations
  for all to authenticated
  using (
    property_id in (
      select id from public.properties
      where user_id = auth.uid()
    )
  )
  with check (
    property_id in (
      select id from public.properties
      where user_id = auth.uid()
    )
  );

-- ── tenant_review_audit / tenant_field_evidence (002 text) ─────────────────
drop policy if exists "tra_owner_all" on public.tenant_review_audit;
create policy "tra_owner_all"
  on public.tenant_review_audit
  for all to authenticated
  using (
    property_id in (
      select id from public.properties
      where user_id = auth.uid()
    )
  )
  with check (
    property_id in (
      select id from public.properties
      where user_id = auth.uid()
    )
  );

drop policy if exists "tfe_owner_all" on public.tenant_field_evidence;
create policy "tfe_owner_all"
  on public.tenant_field_evidence
  for all to authenticated
  using (
    property_id in (
      select id from public.properties
      where user_id = auth.uid()
    )
  )
  with check (
    property_id in (
      select id from public.properties
      where user_id = auth.uid()
    )
  );

-- ── lease_jobs / tenants / properties (005 text) ───────────────────────────
drop policy if exists "lease_jobs_owner_all" on public.lease_jobs;
create policy "lease_jobs_owner_all"
  on public.lease_jobs
  for all
  to authenticated
  using (
    property_id in (
      select id from public.properties where user_id = auth.uid()
    )
  )
  with check (
    property_id in (
      select id from public.properties where user_id = auth.uid()
    )
  );

drop policy if exists "tenants_owner_all" on public.tenants;
create policy "tenants_owner_all"
  on public.tenants
  for all
  to authenticated
  using (
    property_id in (
      select id from public.properties where user_id = auth.uid()
    )
  )
  with check (
    property_id in (
      select id from public.properties where user_id = auth.uid()
    )
  );

drop policy if exists "properties_owner_all" on public.properties;
create policy "properties_owner_all"
  on public.properties
  for all
  to authenticated
  using  (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ── New objects ────────────────────────────────────────────────────────────
drop trigger  if exists properties_default_organization on public.properties;
drop function if exists public.properties_default_organization();

drop policy if exists organizations_member_select          on public.organizations;
drop policy if exists organizations_service_role_all       on public.organizations;
drop policy if exists organization_members_self_select     on public.organization_members;
drop policy if exists organization_members_org_select      on public.organization_members;
drop policy if exists organization_members_service_role_all on public.organization_members;

drop function if exists public.storage_object_accessible(text);
drop function if exists public.member_property_ids();
drop function if exists public.is_member_of_property(uuid);
drop function if exists public.is_active_member_of_org(uuid);

alter table public.properties drop column if exists organization_id;

drop table if exists public.organization_members;
drop table if exists public.organizations;

commit;
