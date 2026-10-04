-- ============================================================================
-- 045_acquisition_member_write_rules_rollback.sql
-- ============================================================================
-- Restores, exactly, the policies, grants and triggers 045 replaced: 034's FOR
-- ALL member policies on the four acquisition tables, phase0/024's
-- properties_owner_all, 029's member-insert policies and INSERT grants on the
-- ledger tables, authenticated's TRUNCATE on acquisition_reviews,
-- acquisition_documents and properties, and anon's grants on properties. It
-- drops 045's guards and helpers.
--
-- THIS RE-OPENS EVERY GAP 045 CLOSED: read-only members writing and deleting
-- acquisition records and properties, a review marked converted by a direct
-- update, decisions and families recorded in another person's name, a
-- document's stored-file path re-pointed, ownership moved by a save, and
-- direct ledger inserts. It changes no row.
-- ============================================================================

begin;

drop trigger if exists acq_reviews_conversion_guard     on public.acquisition_reviews;
drop trigger if exists acq_reviews_author_guard         on public.acquisition_reviews;
drop trigger if exists acq_documents_author_guard       on public.acquisition_documents;
drop trigger if exists acq_doc_families_author_guard    on public.acquisition_document_families;
drop trigger if exists acq_term_decisions_author_guard  on public.acquisition_term_decisions;
drop trigger if exists acq_documents_storage_path_guard on public.acquisition_documents;
drop trigger if exists properties_identity_guard        on public.properties;

-- ── acquisition policies, as 034 left them ──────────────────────────────────
drop policy if exists acq_reviews_member_select on public.acquisition_reviews;
drop policy if exists acq_reviews_editor_insert on public.acquisition_reviews;
drop policy if exists acq_reviews_editor_update on public.acquisition_reviews;
drop policy if exists acq_reviews_admin_delete  on public.acquisition_reviews;
drop policy if exists acq_reviews_member_all    on public.acquisition_reviews;
create policy acq_reviews_member_all on public.acquisition_reviews
  for all to authenticated
  using      (property_id in (select public.member_property_ids()) or (property_id is null and user_id = auth.uid()))
  with check (property_id in (select public.member_property_ids()) or (property_id is null and user_id = auth.uid()));

drop policy if exists acq_docs_member_select on public.acquisition_documents;
drop policy if exists acq_docs_editor_insert on public.acquisition_documents;
drop policy if exists acq_docs_editor_update on public.acquisition_documents;
drop policy if exists acq_docs_editor_delete on public.acquisition_documents;
drop policy if exists acq_docs_member_all    on public.acquisition_documents;
create policy acq_docs_member_all on public.acquisition_documents
  for all to authenticated
  using      (property_id in (select public.member_property_ids()))
  with check (property_id in (select public.member_property_ids()));

drop policy if exists acq_doc_families_member_select on public.acquisition_document_families;
drop policy if exists acq_doc_families_editor_insert on public.acquisition_document_families;
drop policy if exists acq_doc_families_editor_update on public.acquisition_document_families;
drop policy if exists acq_doc_families_member_all    on public.acquisition_document_families;
create policy acq_doc_families_member_all on public.acquisition_document_families
  for all to authenticated
  using      (property_id in (select public.member_property_ids()))
  with check (property_id in (select public.member_property_ids()));

drop policy if exists acq_term_decisions_member_select on public.acquisition_term_decisions;
drop policy if exists acq_term_decisions_editor_insert on public.acquisition_term_decisions;
drop policy if exists acq_term_decisions_member_all    on public.acquisition_term_decisions;
create policy acq_term_decisions_member_all on public.acquisition_term_decisions
  for all to authenticated
  using      (property_id in (select public.member_property_ids()))
  with check (property_id in (select public.member_property_ids()));

-- ── properties, as phase0/024 left it ───────────────────────────────────────
drop policy if exists properties_member_select on public.properties;
drop policy if exists properties_editor_insert on public.properties;
drop policy if exists properties_editor_update on public.properties;
drop policy if exists properties_admin_delete  on public.properties;
drop policy if exists "properties_owner_all"   on public.properties;
create policy "properties_owner_all"
  on public.properties
  for all
  to authenticated
  using (
    user_id = auth.uid()
    or (organization_id is not null and public.is_active_member_of_org(organization_id))
  )
  with check (
    user_id = auth.uid()
    or (organization_id is not null and public.is_active_member_of_org(organization_id))
  );

-- ── ledger inserts, as 029 left them ────────────────────────────────────────
grant insert on public.financial_sources, public.gl_entries to authenticated;
drop policy if exists financial_sources_member_insert on public.financial_sources;
create policy financial_sources_member_insert on public.financial_sources
  for insert to authenticated
  with check (property_id in (select public.member_property_ids()));
drop policy if exists gl_entries_member_insert on public.gl_entries;
create policy gl_entries_member_insert on public.gl_entries
  for insert to authenticated
  with check (property_id in (select public.member_property_ids()));

-- ── grants, as they were ────────────────────────────────────────────────────
grant truncate on public.acquisition_reviews, public.acquisition_documents, public.properties to authenticated;
grant all on public.properties to anon;

drop function if exists public.acq_reviews_conversion_guard();
drop function if exists public.acq_children_author_guard();
drop function if exists public.acq_documents_storage_path_guard();
drop function if exists public.properties_identity_guard();
drop function if exists public.can_edit_property(uuid);
drop function if exists public.is_active_editor_of_org(uuid);

commit;
