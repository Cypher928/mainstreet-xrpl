-- ============================================================================
-- 048_operating_tables_member_write_rules_rollback.sql
-- ============================================================================
-- Restores, exactly, what 048 replaced: phase0/024's FOR ALL member rules on
-- the eight operating tables and the grants as the legacy default privileges
-- (and 015b / 018b) left them — every privilege for anon and authenticated on
-- tenants, lease_jobs, tenant_field_evidence, tenant_review_audit and
-- cam_reconciliations; SELECT for authenticated on tenant_users and
-- tenant_statements; nothing for authenticated on tenant_invitations; nothing
-- for anon on those three.
--
-- THIS RE-OPENS EVERY GAP 048 CLOSED: read-only members writing leaseholds,
-- jobs, evidence, audit rows, CAM results and statements; anon and
-- authenticated holding TRUNCATE on the five older tables. It changes no row.
--
-- TARGET: PILOT PROJECT (bhmktujbxdbvdmpybmad) ONLY. The GRANT ALL below
-- restores Pilot's recorded pre-048 state; on any other database it would
-- widen permissions. Refuses to run unless the Pilot marker property exists.
-- ============================================================================

begin;

do $$
begin
  if not exists (select 1 from public.properties where id = 'fd9c09b1-b657-4c58-9999-c3cce28e7600') then
    raise exception 'REFUSING TO RUN: pilot marker property not found. This does not appear to be the pilot project (bhmktujbxdbvdmpybmad). The 048 rollback must never be run on production.';
  end if;
end $$;

drop policy if exists tenants_member_select on public.tenants;
drop policy if exists tenants_editor_insert on public.tenants;
drop policy if exists tenants_editor_update on public.tenants;
drop policy if exists tenants_editor_delete on public.tenants;
drop policy if exists "tenants_owner_all"   on public.tenants;
create policy "tenants_owner_all" on public.tenants
  for all to authenticated
  using      (property_id in (select public.member_property_ids()))
  with check (property_id in (select public.member_property_ids()));

drop policy if exists lease_jobs_member_select on public.lease_jobs;
drop policy if exists lease_jobs_editor_insert on public.lease_jobs;
drop policy if exists lease_jobs_editor_update on public.lease_jobs;
drop policy if exists lease_jobs_editor_delete on public.lease_jobs;
drop policy if exists "lease_jobs_owner_all"   on public.lease_jobs;
create policy "lease_jobs_owner_all" on public.lease_jobs
  for all to authenticated
  using      (property_id in (select public.member_property_ids()))
  with check (property_id in (select public.member_property_ids()));

drop policy if exists tfe_member_select on public.tenant_field_evidence;
drop policy if exists tfe_editor_insert on public.tenant_field_evidence;
drop policy if exists "tfe_owner_all"   on public.tenant_field_evidence;
create policy "tfe_owner_all" on public.tenant_field_evidence
  for all to authenticated
  using      (property_id in (select public.member_property_ids()))
  with check (property_id in (select public.member_property_ids()));

drop policy if exists tra_member_select on public.tenant_review_audit;
drop policy if exists tra_editor_insert on public.tenant_review_audit;
drop policy if exists "tra_owner_all"   on public.tenant_review_audit;
create policy "tra_owner_all" on public.tenant_review_audit
  for all to authenticated
  using      (property_id in (select public.member_property_ids()))
  with check (property_id in (select public.member_property_ids()));

drop policy if exists cam_recon_member_select on public.cam_reconciliations;
drop policy if exists cam_recon_editor_insert on public.cam_reconciliations;
drop policy if exists cam_recon_editor_update on public.cam_reconciliations;
drop policy if exists cam_recon_editor_delete on public.cam_reconciliations;
drop policy if exists "cam_recon_owner_all"   on public.cam_reconciliations;
create policy "cam_recon_owner_all" on public.cam_reconciliations
  for all to authenticated
  using      (property_id in (select public.member_property_ids()))
  with check (property_id in (select public.member_property_ids()));

drop policy if exists tenant_users_landlord_select on public.tenant_users;
drop policy if exists tenant_users_landlord_all    on public.tenant_users;
create policy tenant_users_landlord_all on public.tenant_users
  for all to authenticated
  using      (property_id in (select public.member_property_ids()))
  with check (property_id in (select public.member_property_ids()));

drop policy if exists tenant_invitations_admin_all    on public.tenant_invitations;
drop policy if exists tenant_invitations_landlord_all on public.tenant_invitations;
create policy tenant_invitations_landlord_all on public.tenant_invitations
  for all to authenticated
  using      (property_id in (select public.member_property_ids()))
  with check (property_id in (select public.member_property_ids()));

drop policy if exists tenant_statements_member_select on public.tenant_statements;
drop policy if exists tenant_statements_editor_insert on public.tenant_statements;
drop policy if exists tenant_statements_editor_update on public.tenant_statements;
drop policy if exists tenant_statements_editor_delete on public.tenant_statements;
drop policy if exists tenant_statements_landlord_all  on public.tenant_statements;
create policy tenant_statements_landlord_all on public.tenant_statements
  for all to authenticated
  using      (property_id in (select public.member_property_ids()))
  with check (property_id in (select public.member_property_ids()));

-- ── grants, as they were ────────────────────────────────────────────────────
grant all on public.tenants, public.lease_jobs, public.tenant_field_evidence, public.tenant_review_audit, public.cam_reconciliations to anon, authenticated;
-- tenant_users (015b), tenant_invitations (015b), tenant_statements (018b): authenticated SELECT / none / SELECT; anon nothing.
grant select on public.tenant_users, public.tenant_statements to authenticated;

commit;
