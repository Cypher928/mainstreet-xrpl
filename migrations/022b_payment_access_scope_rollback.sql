-- ============================================================================
-- 022b_payment_access_scope_rollback.sql
-- ============================================================================
-- WARNING: this RE-OPENS the exposure 022b closed. After it runs, any signed-in
-- user can read every payment, source, settlement and event again, and anyone
-- can call the three internal helpers directly. It exists only so the forward
-- migration has an exact inverse. Do not run it on Pilot without a reason that
-- outweighs that.
--
-- It restores the state 022 left: the four policies on PUBLIC, and EXECUTE on
-- the helpers for PUBLIC and the three API roles. It touches nothing else.
-- ============================================================================

alter policy payments_service_role_all            on public.payments            to public;
alter policy payment_sources_service_role_all     on public.payment_sources     to public;
alter policy payment_settlements_service_role_all on public.payment_settlements to public;
alter policy payment_events_service_role_all      on public.payment_events      to public;

grant execute on function public._payment_settled_total(uuid)  to public, anon, authenticated, service_role;
grant execute on function public._payment_derive_state(uuid)   to public, anon, authenticated, service_role;
grant execute on function public._payment_replay(uuid, uuid)   to public, anon, authenticated, service_role;
