-- ============================================================================
-- 034_property_at_new_acquisition_rollback.sql
-- ============================================================================
-- Removes what 034 added and undoes its backfill, in the reverse order.
--
-- WARNING — THIS RE-OPENS WHAT 034 CLOSED.
--   · acquisition records are owner-only again (the four user_id = auth.uid()
--     policies are restored verbatim as they read on Pilot before 034);
--   · a review can again exist without a property, and a prospect can again be
--     created by any insert;
--   · the three child tables lose property_id, so nothing binds a document,
--     family or decision to a property any more.
--
-- DATA. The seven prospect properties the backfill created (marked
-- data._p3Backfill) are deleted only if they still hold no acquisition child
-- and no other episode; the ten review links are cleared; the one status
-- correction (aca00000-0000-4000-b000-011df998bad2, complete → converted) is
-- reverted, and its converted_at removed, only if it still carries the value
-- the backfill wrote. conversionRecord was never touched and stays.
-- Deals started with begin_acquisition AFTER 034 are NOT deleted: their
-- reviews keep property_id and their properties stay; those are real work,
-- and this rollback does not decide what to do with it.
-- ============================================================================

drop function if exists public.delete_prospect_acquisition(uuid);

drop policy if exists acq_reviews_member_all        on public.acquisition_reviews;
drop policy if exists acq_docs_member_all           on public.acquisition_documents;
drop policy if exists acq_doc_families_member_all   on public.acquisition_document_families;
drop policy if exists acq_term_decisions_member_all on public.acquisition_term_decisions;

create policy acq_reviews_owner_all on public.acquisition_reviews
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy acq_docs_owner_all on public.acquisition_documents
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy acq_doc_families_owner_all on public.acquisition_document_families
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy acq_term_decisions_owner_all on public.acquisition_term_decisions
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table public.acquisition_document_families drop constraint if exists acq_doc_families_id_property_key;
drop index if exists public.acq_reviews_one_open_per_property;
alter table public.acquisition_reviews drop constraint if exists acq_reviews_open_has_property;

drop trigger if exists acq_docs_property_bind           on public.acquisition_documents;
drop trigger if exists acq_doc_families_property_bind   on public.acquisition_document_families;
drop trigger if exists acq_term_decisions_property_bind on public.acquisition_term_decisions;
drop function if exists public.acq_child_property_bind();

drop index if exists public.idx_acq_docs_property;
drop index if exists public.idx_acq_doc_families_property;
drop index if exists public.idx_acq_term_decisions_property;

alter table public.acquisition_term_decisions    drop column if exists property_id;
alter table public.acquisition_document_families drop column if exists property_id;
alter table public.acquisition_documents         drop column if exists property_id;

drop trigger if exists acq_reviews_property_immutable on public.acquisition_reviews;
drop function if exists public.acq_reviews_property_immutable();
drop trigger if exists acq_reviews_insert_guard on public.acquisition_reviews;
drop function if exists public.acq_reviews_insert_guard();
drop trigger if exists properties_insert_stage_guard on public.properties;
drop function if exists public.properties_insert_stage_guard();

drop function if exists public.begin_acquisition(text, jsonb, uuid, uuid);
drop function if exists public.is_property_admin(uuid);

-- undo the backfill
update public.acquisition_reviews
   set status = 'complete', property_id = null, converted_at = null
 where id = 'aca00000-0000-4000-b000-011df998bad2'
   and status = 'converted'
   and property_id = '286622d5-0c8f-4dfd-b242-b75bdaa49e1e'
   and converted_at = '2026-09-16T20:30:23.332Z'::timestamptz;

-- the two automatic links and the seven backfill prospects — never a link the
-- conversion path wrote after 034 (P2 sets property_id on conversion too)
update public.acquisition_reviews ar
   set property_id = null
 where ar.property_id in (select id from public.properties where data ? '_p3Backfill')
    or (ar.id in ('aca00000-0000-4000-b000-c4bbdb183219', 'aca00000-0000-4000-b000-46e82be2381d')
        and ar.property_id::text = ar.data->'conversionRecord'->>'propertyId');

delete from public.properties p
 where p.data ? '_p3Backfill'
   and p.lifecycle_stage = 'prospect'
   and not exists (select 1 from public.acquisition_reviews ar where ar.property_id = p.id)
   and not exists (select 1 from public.tenants t where t.property_id = p.id);
