-- ============================================================================
-- 022b_payment_access_scope.sql — who may read payment records, and who may
-- call the internal payment helpers
-- ============================================================================
-- TARGET: PILOT PROJECT ONLY (bhmktujbxdbvdmpybmad). The payment tables exist
-- nowhere else; production has none.
--
-- FORWARD-ONLY. 022 is not edited: it is the record of what Pilot ran. Any
-- build replays 022 and then this file, which yields the corrected state.
--
-- WHAT WAS WRONG
-- --------------
-- 1. 022 created the four `payment_*_service_role_all` policies with no TO
--    clause, so they apply to PUBLIC — every role — with USING (true).
--    `authenticated` holds SELECT on all four tables (022, section 7), so any
--    signed-in user, of any property, could read EVERY payment, payment
--    source, settlement and event. `payment_balances` is security_invoker and
--    inherited the same exposure. Writes were never reachable: authenticated
--    holds no INSERT/UPDATE/DELETE and anon holds nothing.
-- 2. `_payment_settled_total`, `_payment_derive_state` and `_payment_replay`
--    are SECURITY DEFINER, check no ownership, and kept PostgreSQL's default
--    EXECUTE for PUBLIC — so anyone, signed in or not, could call them at
--    /rest/v1/rpc/… with a payment UUID and read past RLS.
--
-- WHAT THIS DOES — AND ONLY THIS
-- ------------------------------
-- 1. Re-targets the four policies to service_role. USING / WITH CHECK are
--    unchanged. (service_role has BYPASSRLS, so these policies were never what
--    gave it access; scoping them keeps the `<table>_service_role_all TO
--    service_role` convention every other table follows.)
-- 2. Revokes EXECUTE on the three helpers from PUBLIC, anon, authenticated and
--    service_role. Their only callers are the seven payment procedures, all
--    SECURITY DEFINER and owned by postgres: inside them the current user is
--    postgres, which keeps EXECUTE as owner. No view, policy or trigger calls
--    them.
--
-- It changes no table, column, type, constraint, index, view, trigger,
-- function body or function signature; no procedure grant; nothing XRPL; no
-- row. It moves no money and records none.
--
-- Safe to re-run: ALTER POLICY … TO and REVOKE are idempotent.
-- ============================================================================

alter policy payments_service_role_all            on public.payments            to service_role;
alter policy payment_sources_service_role_all     on public.payment_sources     to service_role;
alter policy payment_settlements_service_role_all on public.payment_settlements to service_role;
alter policy payment_events_service_role_all      on public.payment_events      to service_role;

revoke all on function public._payment_settled_total(uuid)  from public, anon, authenticated, service_role;
revoke all on function public._payment_derive_state(uuid)   from public, anon, authenticated, service_role;
revoke all on function public._payment_replay(uuid, uuid)   from public, anon, authenticated, service_role;
