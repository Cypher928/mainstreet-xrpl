-- ============================================================================
-- 048_operating_tables_member_write_rules.sql — approved for local build and
-- verification (2026-10-04), NOT APPLIED anywhere. The eight
-- operating tables phase0/024 opened to every active member follow 045's rule:
-- members read; only people who may edit write; audit trails are append-only
-- for signed-in people; the dormant tenant-portal rules narrow to the people
-- who would hold them
-- ============================================================================
-- TARGET: PILOT PROJECT (bhmktujbxdbvdmpybmad) ONLY. Refuses to run unless the
-- Pilot marker property exists. Requires 045 (can_edit_property), 034
-- (is_property_admin), phase0/024 (member_property_ids) and 038 (the leasehold
-- guards, which stay). Verified by tools/verify-migration-048.js.
--
-- THE AUDIT (2026-10-04, migration texts + every application path; the live
-- catalog is read in the calibration phase)
--
--   table                 024 rule           app writers                      048
--   ------------------    -----------------  -------------------------------  ------------------------
--   tenants               member FOR ALL     browser upsert (owner/editor);   member select · editor
--                         + tenant self-read   resync_property_tenants (SD);    insert/update/delete
--                         (012); 038 guards    end/reactivate/discard (SD)      (038 still refuses every
--                                                                                direct delete)
--   lease_jobs            member FOR ALL     browser upsert/update (uploader) member select · editor
--                                                                                insert/update/delete
--   tenant_field_evidence member FOR ALL     browser INSERT … ON CONFLICT DO  member select · editor
--                                              NOTHING; server reads             insert (append-only)
--   tenant_review_audit   member FOR ALL     browser INSERT … ON CONFLICT DO  member select · editor
--                                              NOTHING; server reads             insert (append-only)
--   cam_reconciliations   member FOR ALL     api/cam-reconciliations.js only  member select · editor
--                                              (service key; owner check)        insert/update/delete
--   tenant_users          member FOR ALL     api/tenant-accept-invite.js      member select (the write
--                         (dormant: 015b       (service key); portal reads       rule is dormant; it is
--                         grants SELECT only)  its own row                       dropped, not kept)
--   tenant_invitations    member FOR ALL     api/tenant-accept-invite.js      admin FOR ALL (dormant
--                         (dormant: no grant   (service key) reads/updates;      until a landlord invite
--                         to authenticated)    nothing creates one yet           screen grants INSERT)
--   tenant_statements     member FOR ALL     publish_tenant_statement (SD,    member select · editor
--                         + tenant published   017); portal reads published      insert/update/delete
--                         read (017); dormant:                                     (dormant: the grant
--                         018b grants SELECT                                       stays SELECT only)
--                         only
--
--   Tenant users (tenant_users rows) keep exactly their reads: their own
--   membership, their own tenant row, their published statements. They had,
--   and have, no write path. Anonymous callers lose every grant on all eight
--   (none has an anon policy). Signed-in people lose TRUNCATE, REFERENCES and
--   TRIGGER on all eight (row rules do not apply to TRUNCATE; the API never
--   issues it).
--
-- WHAT IS DELIBERATELY DIFFERENT PER TABLE
--   · evidence and audit are append-only for signed-in people: no app path
--     updates or deletes them, and an audit trail that any editor can rewrite
--     is not one. The server (service_role) keeps every privilege (fixtures,
--     cascades run as the owner anyway).
--   · tenant_users loses its dormant landlord write rule rather than keeping an
--     editor version: membership is written only by the accept-invite endpoint,
--     and a landlord screen that revokes memberships adds its own rule.
--   · tenant_invitations keeps a FOR ALL rule but for property ADMINS, still
--     dormant: when a landlord invite screen grants INSERT, only admins invite.
--   · tenants keeps an editor delete rule for symmetry; 038's delete guard
--     refuses every direct delete regardless (only discard_leasehold deletes).
--
-- NOT CHANGED: any row; the tenant-side rules (tenants_tenant_self_select,
-- tenant_users_self_select, tenant_statements_tenant_select); every
-- service_role rule; 038's guards and functions; resync_property_tenants;
-- publish_tenant_statement; the grants service_role holds; 015b's and 018b's
-- grants to authenticated on tenant_users, tenant_invitations and
-- tenant_statements (SELECT, none, SELECT).
--
-- ROLLBACK: 048_operating_tables_member_write_rules_rollback.sql restores
-- every 024 rule and grant exactly.
-- ============================================================================

begin;

do $$
begin
  if not exists (select 1 from public.properties where id = 'fd9c09b1-b657-4c58-9999-c3cce28e7600') then
    raise exception 'REFUSING TO RUN: pilot marker property not found. This does not appear to be the pilot project (bhmktujbxdbvdmpybmad). 048 must never be applied to production.';
  end if;
  if to_regprocedure('public.can_edit_property(uuid)') is null then
    raise exception '048 requires 045 (can_edit_property)';
  end if;
  if to_regprocedure('public.is_property_admin(uuid)') is null or to_regprocedure('public.member_property_ids()') is null then
    raise exception '048 requires 034 and phase0/024 (is_property_admin, member_property_ids)';
  end if;
  if to_regprocedure('public.tenants_delete_guard()') is null then
    raise exception '048 requires 038 (tenants_delete_guard)';
  end if;
  if to_regclass('public.tenant_users') is null or to_regclass('public.tenant_invitations') is null or to_regclass('public.tenant_statements') is null
     or to_regclass('public.lease_jobs') is null or to_regclass('public.tenant_field_evidence') is null or to_regclass('public.tenant_review_audit') is null
     or to_regclass('public.cam_reconciliations') is null then
    raise exception '048 requires the eight operating tables (001–003, 012, 014, 017)';
  end if;
end $$;

-- ── tenants ─────────────────────────────────────────────────────────────────
drop policy if exists "tenants_owner_all"   on public.tenants;
drop policy if exists tenants_member_select on public.tenants;
drop policy if exists tenants_editor_insert on public.tenants;
drop policy if exists tenants_editor_update on public.tenants;
drop policy if exists tenants_editor_delete on public.tenants;
create policy tenants_member_select on public.tenants
  for select to authenticated using (property_id in (select public.member_property_ids()));
create policy tenants_editor_insert on public.tenants
  for insert to authenticated with check (public.can_edit_property(property_id));
create policy tenants_editor_update on public.tenants
  for update to authenticated using (public.can_edit_property(property_id)) with check (public.can_edit_property(property_id));
create policy tenants_editor_delete on public.tenants
  for delete to authenticated using (public.can_edit_property(property_id));

-- ── lease_jobs ──────────────────────────────────────────────────────────────
drop policy if exists "lease_jobs_owner_all"   on public.lease_jobs;
drop policy if exists lease_jobs_member_select on public.lease_jobs;
drop policy if exists lease_jobs_editor_insert on public.lease_jobs;
drop policy if exists lease_jobs_editor_update on public.lease_jobs;
drop policy if exists lease_jobs_editor_delete on public.lease_jobs;
create policy lease_jobs_member_select on public.lease_jobs
  for select to authenticated using (property_id in (select public.member_property_ids()));
create policy lease_jobs_editor_insert on public.lease_jobs
  for insert to authenticated with check (public.can_edit_property(property_id));
create policy lease_jobs_editor_update on public.lease_jobs
  for update to authenticated using (public.can_edit_property(property_id)) with check (public.can_edit_property(property_id));
create policy lease_jobs_editor_delete on public.lease_jobs
  for delete to authenticated using (public.can_edit_property(property_id));

-- ── tenant_field_evidence: append-only for signed-in people ─────────────────
drop policy if exists "tfe_owner_all"   on public.tenant_field_evidence;
drop policy if exists tfe_member_select on public.tenant_field_evidence;
drop policy if exists tfe_editor_insert on public.tenant_field_evidence;
create policy tfe_member_select on public.tenant_field_evidence
  for select to authenticated using (property_id in (select public.member_property_ids()));
create policy tfe_editor_insert on public.tenant_field_evidence
  for insert to authenticated with check (public.can_edit_property(property_id));

-- ── tenant_review_audit: append-only for signed-in people ───────────────────
drop policy if exists "tra_owner_all"   on public.tenant_review_audit;
drop policy if exists tra_member_select on public.tenant_review_audit;
drop policy if exists tra_editor_insert on public.tenant_review_audit;
create policy tra_member_select on public.tenant_review_audit
  for select to authenticated using (property_id in (select public.member_property_ids()));
create policy tra_editor_insert on public.tenant_review_audit
  for insert to authenticated with check (public.can_edit_property(property_id));

-- ── cam_reconciliations ─────────────────────────────────────────────────────
drop policy if exists "cam_recon_owner_all"   on public.cam_reconciliations;
drop policy if exists cam_recon_member_select on public.cam_reconciliations;
drop policy if exists cam_recon_editor_insert on public.cam_reconciliations;
drop policy if exists cam_recon_editor_update on public.cam_reconciliations;
drop policy if exists cam_recon_editor_delete on public.cam_reconciliations;
create policy cam_recon_member_select on public.cam_reconciliations
  for select to authenticated using (property_id in (select public.member_property_ids()));
create policy cam_recon_editor_insert on public.cam_reconciliations
  for insert to authenticated with check (public.can_edit_property(property_id));
create policy cam_recon_editor_update on public.cam_reconciliations
  for update to authenticated using (public.can_edit_property(property_id)) with check (public.can_edit_property(property_id));
create policy cam_recon_editor_delete on public.cam_reconciliations
  for delete to authenticated using (public.can_edit_property(property_id));

-- ── tenant_users: landlords read; the server writes ─────────────────────────
drop policy if exists tenant_users_landlord_all    on public.tenant_users;
drop policy if exists tenant_users_landlord_select on public.tenant_users;
create policy tenant_users_landlord_select on public.tenant_users
  for select to authenticated using (property_id in (select public.member_property_ids()));

-- ── tenant_invitations: property admins (dormant until a grant) ─────────────
drop policy if exists tenant_invitations_landlord_all on public.tenant_invitations;
drop policy if exists tenant_invitations_admin_all    on public.tenant_invitations;
create policy tenant_invitations_admin_all on public.tenant_invitations
  for all to authenticated
  using      (public.is_property_admin(property_id))
  with check (public.is_property_admin(property_id));

-- ── tenant_statements ───────────────────────────────────────────────────────
drop policy if exists tenant_statements_landlord_all    on public.tenant_statements;
drop policy if exists tenant_statements_member_select   on public.tenant_statements;
drop policy if exists tenant_statements_editor_insert   on public.tenant_statements;
drop policy if exists tenant_statements_editor_update   on public.tenant_statements;
drop policy if exists tenant_statements_editor_delete   on public.tenant_statements;
create policy tenant_statements_member_select on public.tenant_statements
  for select to authenticated using (property_id in (select public.member_property_ids()));
create policy tenant_statements_editor_insert on public.tenant_statements
  for insert to authenticated with check (public.can_edit_property(property_id));
create policy tenant_statements_editor_update on public.tenant_statements
  for update to authenticated using (public.can_edit_property(property_id)) with check (public.can_edit_property(property_id));
create policy tenant_statements_editor_delete on public.tenant_statements
  for delete to authenticated using (public.can_edit_property(property_id));

-- ── grants ──────────────────────────────────────────────────────────────────
revoke all on public.tenants, public.lease_jobs, public.tenant_field_evidence, public.tenant_review_audit, public.cam_reconciliations,
              public.tenant_users, public.tenant_invitations, public.tenant_statements from anon;
revoke truncate, references, trigger on public.tenants, public.lease_jobs, public.tenant_field_evidence, public.tenant_review_audit,
              public.cam_reconciliations, public.tenant_users, public.tenant_invitations, public.tenant_statements from authenticated;
-- The append-only tables: signed-in people keep SELECT and INSERT only.
revoke update, delete on public.tenant_field_evidence, public.tenant_review_audit from authenticated;

commit;
