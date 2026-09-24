-- ============================================================================
-- 026c_acquisition_term_decisions_privileges.sql — the Data API privileges
-- acquisition_term_decisions actually needs, granted explicitly
-- ============================================================================
-- TARGET: PILOT PROJECT ONLY (bhmktujbxdbvdmpybmad), where 026 ran.
--
-- NUMBERED 026c, not 026b: `026b` is already used by another migration lineage
-- in this repository (see the migration-drift workstream). This file follows
-- 026_acquisition_term_decisions.sql.
--
-- FORWARD-ONLY. 026 is not edited. Any build replays 026 and then this file.
--
-- WHY: 026 created the table and granted it to no one, relying on Supabase's
-- automatic grant, which stops for new objects on October 30, 2026. On Pilot
-- the automatic grant gave anon, authenticated and service_role EVERY privilege.
--
-- WHAT EACH GRANT IS FOR
--   authenticated  SELECT   script.js _acqLoadDecisions
--                  INSERT   script.js _acqSaveDecision: insert + .select()
--   service_role   none     no server code touches this table.
--   anon           none
-- No UPDATE or DELETE: decisions are append-only. After this, a client UPDATE
-- or DELETE is refused at the grant, before 026's append-only trigger; the
-- trigger stays for owner-level and cascade paths.
--
-- Changes no table, column, policy, trigger, function or row. Safe to re-run.
-- ============================================================================

revoke all on public.acquisition_term_decisions from anon, authenticated, service_role;
grant select, insert on public.acquisition_term_decisions to authenticated;
