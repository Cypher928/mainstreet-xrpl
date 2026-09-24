-- ============================================================================
-- 024b_acquisition_document_families_privileges.sql — the Data API privileges
-- acquisition_document_families actually needs, granted explicitly
-- ============================================================================
-- TARGET: PILOT PROJECT ONLY (bhmktujbxdbvdmpybmad), where 024 ran.
--
-- FORWARD-ONLY. 024 is not edited. Any build replays 024 and then this file.
--
-- WHY: 024 created the table and granted it to no one, relying on Supabase's
-- automatic grant, which stops for new objects on October 30, 2026. On Pilot
-- the automatic grant gave anon, authenticated and service_role EVERY privilege
-- (RLS has no anon policy, so anon read nothing, but it held the grant).
--
-- WHAT EACH GRANT IS FOR
--   authenticated  SELECT   script.js _acqLoadFamilies
--                  INSERT,  script.js _acqSaveFamily: upsert on id — an upsert
--                  UPDATE   needs both — followed by .select()
--   service_role   none     no server code touches this table.
--   anon           none
-- No DELETE: nothing deletes a family directly; a review's deletion cascades as
-- the table owner. acquisition_documents (023) keeps its own explicit grants.
--
-- Changes no table, column, policy, trigger, function or row. Safe to re-run.
-- ============================================================================

revoke all on public.acquisition_document_families from anon, authenticated, service_role;
grant select, insert, update on public.acquisition_document_families to authenticated;
