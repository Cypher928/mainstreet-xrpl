-- ============================================================================
-- 045_acquisition_member_write_rules.sql — members may read; only people who
-- may edit may write; a conversion and an author cannot be forged
-- ============================================================================
-- TARGET: PILOT PROJECT (bhmktujbxdbvdmpybmad) ONLY. Refuses to run unless the
-- Pilot marker property exists. NOT APPLIED. Requires phase0/024 and 029, and
-- 033–036. Verified by tools/verify-migration-045-member-write-rules.js.
--
-- WHY
--   034 gave every active member of a property's organisation one policy, FOR
--   ALL, on acquisition reviews, documents, families and decisions; phase0/024
--   did the same on properties. "Member" includes read_only. So a read-only
--   member could, through the API: update or delete reviews and documents
--   (including a document's stored-file path), mark a review converted by
--   setting its status, insert families and term decisions in the owner's name
--   (decided_by = user_id = the owner passes 026's rule), update or delete
--   properties, and insert ledger rows (029). Read on 2026-10-03 from Pilot's
--   live catalog; every function involved matched its file.
--
-- WHAT CHANGES
--   Two helpers, both SECURITY DEFINER and answering only about the CALLER:
--     is_active_editor_of_org(org)  an accepted, unrevoked member whose role is
--                                   not read_only
--     can_edit_property(property)   the owner, or an editor of its organisation
--   (044's attestation guard and the planned ledger import use the same rule.)
--
--   Policies — each FOR ALL member policy is split. SELECT keeps exactly the
--   predicate it had, so every member, read_only included, still sees what it
--   saw. Writes need can_edit_property:
--     acquisition_reviews     select · insert · update (editor) · delete (admin)
--     acquisition_documents   select · insert · update · delete (editor)
--     acquisition_document_families  select · insert · update (editor)
--     acquisition_term_decisions     select · insert (editor)
--     properties              select (member) · insert · update (editor) ·
--                             delete (owner or organisation admin)
--   A review with no property (a converted orphan) stays writable only by its
--   own user, as before; 036 freezes it anyway.
--
--   Triggers (new; no existing function is replaced):
--     acq_reviews_conversion_guard  a review becomes converted — status or
--       converted_at — only inside acquire_property: its property must have
--       become acquired in this same transaction (033's stage guard admits that
--       only with acquire_property's transaction-local mark) and converted_at
--       must be now(). A direct update, by anyone, is refused. Leaving the
--       converted state stays 036's business.
--     acq_children_author_guard  a review, document, family or decision is
--       recorded by the signed-in person: user_id (and, on a decision,
--       decided_by) must be auth.uid() when it is written, and never changes.
--       026 only required decided_by = user_id, both supplied by the client.
--     acq_documents_storage_path_guard  a document's stored-file path is set
--       once; it is never re-pointed or cleared.
--     properties_identity_guard  a signed-in save never moves ownership: the
--       app's saveProperty upserts with user_id = the saver, which until now
--       handed an editor the property. user_id and organization_id keep their
--       values (the save itself still succeeds).
--   A trigger answers to auth.uid(); with no signed-in person (service_role,
--   migrations) only the conversion and stored-file rules apply.
--
--   Grants:
--     authenticated loses TRUNCATE on acquisition_reviews, acquisition_documents
--       and properties (row rules do not apply to TRUNCATE; the API never needs
--       it), and INSERT on financial_sources and gl_entries, whose member-insert
--       policies are dropped — no app code writes them, and the ledger import
--       will be server-controlled (046).
--     anon loses everything on properties (no anon policy exists; the grant
--       only exposed TRUNCATE, REFERENCES and TRIGGER).
--
-- NOT CHANGED: begin_acquisition, acquire_property, delete_prospect_acquisition
-- (SECURITY DEFINER; they act as the table owner), 036's freeze, 044's
-- attestations, storage, organization_members, member_property_ids, any row.
--
-- ROLLBACK: 045_acquisition_member_write_rules_rollback.sql restores every
-- policy, grant and trigger exactly as they were — and with them every gap.
-- ============================================================================

begin;

do $$
begin
  if not exists (select 1 from public.properties where id = 'fd9c09b1-b657-4c58-9999-c3cce28e7600') then
    raise exception 'REFUSING TO RUN: pilot marker property not found. This does not appear to be the pilot project (bhmktujbxdbvdmpybmad). 045 must never be applied to production.';
  end if;
  if to_regprocedure('public.member_property_ids()') is null or to_regprocedure('public.is_active_member_of_org(uuid)') is null
     or to_regprocedure('public.is_property_admin(uuid)') is null then
    raise exception '045 requires phase0/024 and 034 (member_property_ids, is_active_member_of_org, is_property_admin)';
  end if;
  if to_regprocedure('public.acq_reviews_frozen()') is null then
    raise exception '045 requires 036 (acq_reviews_frozen)';
  end if;
  if to_regclass('public.financial_sources') is null or to_regclass('public.gl_entries') is null then
    raise exception '045 requires phase0/029 (financial_sources, gl_entries)';
  end if;
end $$;

-- ── helpers ─────────────────────────────────────────────────────────────────
-- VOLATILE on purpose: a new user's first property is inserted together with
-- the organisation properties_default_organization creates for them, in the
-- same statement. A STABLE function reads the statement's starting snapshot and
-- would not see that membership, refusing the user their own first property.
create or replace function public.is_active_editor_of_org(p_org uuid)
returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.organization_members m
     where m.organization_id = p_org and m.user_id = auth.uid()
       and m.accepted_at is not null and m.revoked_at is null
       and m.role <> 'read_only')
$$;
revoke all on function public.is_active_editor_of_org(uuid) from public, anon;
grant execute on function public.is_active_editor_of_org(uuid) to authenticated, service_role;

create or replace function public.can_edit_property(p_property uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1 from public.properties p
     where p.id = p_property
       and (p.user_id = auth.uid()
            or (p.organization_id is not null and public.is_active_editor_of_org(p.organization_id))))
$$;
revoke all on function public.can_edit_property(uuid) from public, anon;
grant execute on function public.can_edit_property(uuid) to authenticated, service_role;

-- ── acquisition policies: read for members, write for editors ───────────────
drop policy if exists acq_reviews_member_all on public.acquisition_reviews;
drop policy if exists acq_reviews_member_select on public.acquisition_reviews;
drop policy if exists acq_reviews_editor_insert on public.acquisition_reviews;
drop policy if exists acq_reviews_editor_update on public.acquisition_reviews;
drop policy if exists acq_reviews_admin_delete  on public.acquisition_reviews;
create policy acq_reviews_member_select on public.acquisition_reviews
  for select to authenticated
  using (property_id in (select public.member_property_ids()) or (property_id is null and user_id = auth.uid()));
create policy acq_reviews_editor_insert on public.acquisition_reviews
  for insert to authenticated
  with check (public.can_edit_property(property_id) or (property_id is null and user_id = auth.uid()));
create policy acq_reviews_editor_update on public.acquisition_reviews
  for update to authenticated
  using      (public.can_edit_property(property_id) or (property_id is null and user_id = auth.uid()))
  with check (public.can_edit_property(property_id) or (property_id is null and user_id = auth.uid()));
create policy acq_reviews_admin_delete on public.acquisition_reviews
  for delete to authenticated
  using (public.is_property_admin(property_id) or (property_id is null and user_id = auth.uid()));

drop policy if exists acq_docs_member_all    on public.acquisition_documents;
drop policy if exists acq_docs_member_select on public.acquisition_documents;
drop policy if exists acq_docs_editor_insert on public.acquisition_documents;
drop policy if exists acq_docs_editor_update on public.acquisition_documents;
drop policy if exists acq_docs_editor_delete on public.acquisition_documents;
create policy acq_docs_member_select on public.acquisition_documents
  for select to authenticated using (property_id in (select public.member_property_ids()));
create policy acq_docs_editor_insert on public.acquisition_documents
  for insert to authenticated with check (public.can_edit_property(property_id));
create policy acq_docs_editor_update on public.acquisition_documents
  for update to authenticated using (public.can_edit_property(property_id)) with check (public.can_edit_property(property_id));
create policy acq_docs_editor_delete on public.acquisition_documents
  for delete to authenticated using (public.can_edit_property(property_id));

drop policy if exists acq_doc_families_member_all    on public.acquisition_document_families;
drop policy if exists acq_doc_families_member_select on public.acquisition_document_families;
drop policy if exists acq_doc_families_editor_insert on public.acquisition_document_families;
drop policy if exists acq_doc_families_editor_update on public.acquisition_document_families;
create policy acq_doc_families_member_select on public.acquisition_document_families
  for select to authenticated using (property_id in (select public.member_property_ids()));
create policy acq_doc_families_editor_insert on public.acquisition_document_families
  for insert to authenticated with check (public.can_edit_property(property_id));
create policy acq_doc_families_editor_update on public.acquisition_document_families
  for update to authenticated using (public.can_edit_property(property_id)) with check (public.can_edit_property(property_id));

drop policy if exists acq_term_decisions_member_all    on public.acquisition_term_decisions;
drop policy if exists acq_term_decisions_member_select on public.acquisition_term_decisions;
drop policy if exists acq_term_decisions_editor_insert on public.acquisition_term_decisions;
create policy acq_term_decisions_member_select on public.acquisition_term_decisions
  for select to authenticated using (property_id in (select public.member_property_ids()));
create policy acq_term_decisions_editor_insert on public.acquisition_term_decisions
  for insert to authenticated with check (public.can_edit_property(property_id));

-- ── properties ──────────────────────────────────────────────────────────────
drop policy if exists "properties_owner_all"   on public.properties;
drop policy if exists properties_member_select on public.properties;
drop policy if exists properties_editor_insert on public.properties;
drop policy if exists properties_editor_update on public.properties;
drop policy if exists properties_admin_delete  on public.properties;
create policy properties_member_select on public.properties
  for select to authenticated
  using (user_id = auth.uid() or (organization_id is not null and public.is_active_member_of_org(organization_id)));
create policy properties_editor_insert on public.properties
  for insert to authenticated
  with check (user_id = auth.uid() and (organization_id is null or public.is_active_editor_of_org(organization_id)));
create policy properties_editor_update on public.properties
  for update to authenticated
  using      (user_id = auth.uid() or (organization_id is not null and public.is_active_editor_of_org(organization_id)))
  with check (user_id = auth.uid() or (organization_id is not null and public.is_active_editor_of_org(organization_id)));
create policy properties_admin_delete on public.properties
  for delete to authenticated
  using (public.is_property_admin(id));

-- ── guard: a review becomes converted only inside acquire_property ──────────
create or replace function public.acq_reviews_conversion_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'converted' or new.converted_at is not null then
      raise exception 'A review is not created converted; it is converted by acquire_property'
        using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;
  if old.status = 'converted' then
    return new;   -- 036 decides what, if anything, may change on a converted review
  end if;
  if new.status = 'converted' or new.converted_at is distinct from old.converted_at then
    if new.status = 'converted'
       and new.converted_at = now()
       and exists (select 1 from public.properties p
                    where p.id = new.property_id
                      and p.lifecycle_stage = 'acquired'
                      and p.stage_changed_at = now()) then
      return new;   -- acquire_property: the property became acquired in this transaction
    end if;
    raise exception 'Review % is converted only by acquire_property, which acquires its property in the same step', old.id
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;
revoke all on function public.acq_reviews_conversion_guard() from public, anon, authenticated;
drop trigger if exists acq_reviews_conversion_guard on public.acquisition_reviews;
create trigger acq_reviews_conversion_guard
  before insert or update of status, converted_at on public.acquisition_reviews
  for each row execute function public.acq_reviews_conversion_guard();

-- ── guard: an acquisition record is written by the person it names ──────────
create or replace function public.acq_children_author_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return new;   -- service_role and migrations: no person to compare with
  end if;
  if tg_op = 'INSERT' then
    if new.user_id is distinct from v_uid then
      raise exception '% must be recorded by the signed-in person, not on behalf of another (user_id)', tg_table_name
        using errcode = 'insufficient_privilege';
    end if;
    if tg_table_name = 'acquisition_term_decisions'
       and (to_jsonb(new) ->> 'decided_by') is distinct from v_uid::text then
      raise exception 'A term decision is recorded by the signed-in person (decided_by)'
        using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;
  if new.user_id is distinct from old.user_id then
    raise exception '%.user_id does not change', tg_table_name using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;
revoke all on function public.acq_children_author_guard() from public, anon, authenticated;
drop trigger if exists acq_reviews_author_guard on public.acquisition_reviews;
create trigger acq_reviews_author_guard
  before insert or update of user_id on public.acquisition_reviews
  for each row execute function public.acq_children_author_guard();
drop trigger if exists acq_documents_author_guard on public.acquisition_documents;
create trigger acq_documents_author_guard
  before insert or update of user_id on public.acquisition_documents
  for each row execute function public.acq_children_author_guard();
drop trigger if exists acq_doc_families_author_guard on public.acquisition_document_families;
create trigger acq_doc_families_author_guard
  before insert or update of user_id on public.acquisition_document_families
  for each row execute function public.acq_children_author_guard();
drop trigger if exists acq_term_decisions_author_guard on public.acquisition_term_decisions;
create trigger acq_term_decisions_author_guard
  before insert on public.acquisition_term_decisions
  for each row execute function public.acq_children_author_guard();

-- ── guard: a document's stored file is set once ─────────────────────────────
create or replace function public.acq_documents_storage_path_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.storage_path is not null and new.storage_path is distinct from old.storage_path then
    raise exception 'Document % already points at its stored original; the path is not re-pointed or cleared', old.id
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;
revoke all on function public.acq_documents_storage_path_guard() from public, anon, authenticated;
drop trigger if exists acq_documents_storage_path_guard on public.acquisition_documents;
create trigger acq_documents_storage_path_guard
  before update of storage_path on public.acquisition_documents
  for each row execute function public.acq_documents_storage_path_guard();

-- ── guard: a signed-in save does not move a property's ownership ────────────
create or replace function public.properties_identity_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is not null then
    new.user_id         := old.user_id;
    new.organization_id := old.organization_id;
  end if;
  return new;
end;
$$;
revoke all on function public.properties_identity_guard() from public, anon, authenticated;
drop trigger if exists properties_identity_guard on public.properties;
create trigger properties_identity_guard
  before update of user_id, organization_id on public.properties
  for each row execute function public.properties_identity_guard();

-- ── grants ──────────────────────────────────────────────────────────────────
revoke truncate on public.acquisition_reviews, public.acquisition_documents, public.properties from authenticated;
revoke all on public.properties from anon;

drop policy if exists financial_sources_member_insert on public.financial_sources;
drop policy if exists gl_entries_member_insert        on public.gl_entries;
revoke insert on public.financial_sources, public.gl_entries from authenticated;

comment on function public.can_edit_property(uuid) is
  '045: the caller is the property''s owner or an accepted, unrevoked, non-read-only member of its organisation.';
comment on function public.is_active_editor_of_org(uuid) is
  '045: the caller is an accepted, unrevoked member of the organisation whose role is not read_only.';

commit;
