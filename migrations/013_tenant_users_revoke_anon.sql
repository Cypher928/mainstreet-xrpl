-- ============================================================================
-- 013_tenant_users_revoke_anon.sql — defence in depth for tenant_users
-- ============================================================================
-- TARGET: PILOT PROJECT ONLY (bhmktujbxdbvdmpybmad).
-- NEVER apply to production (zhsuhehgehbzkmzurzyf).
--
-- STATUS: NOT APPLIED. Prepared for review alongside Phase A, kept deliberately
-- separate from 012 so the authorization work and this hardening can be
-- approved, applied and reverted independently.
--
-- WHY
-- ---
-- Supabase's default privileges grant ALL on every table in `public` to `anon`
-- and `authenticated`. public.tenant_users inherited that when 012 created it:
--
--   tenant_users | anon | DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE
--
-- Nothing is currently exploitable through it. RLS gates every verb PostgREST
-- can reach, and an anonymous caller reads zero rows — verified. TRUNCATE
-- ignores RLS, but PostgREST cannot issue TRUNCATE, so it is not reachable
-- over the API.
--
-- The point is that RLS is presently the ONLY thing standing between an
-- anonymous caller and this table. tenant_users is the authorization source of
-- truth for every tenant in the pilot: if one policy on it is ever mis-edited,
-- there is no second layer. Membership data also has no anonymous use case
-- whatsoever, so the grant buys nothing to offset that risk.
--
-- SCOPE
-- -----
-- Only the new table. The same over-broad grant exists on all eight
-- pre-existing tables; sweeping those is a larger hardening pass with its own
-- regression surface and does not belong inside Phase A.
--
-- EXPECTED EFFECT (measured in a rolled-back transaction before shipping this)
-- ---------------------------------------------------------------------------
--   anon SELECT on tenant_users     : 0 rows (RLS)  ->  DENIED AT GRANT LAYER (42501)
--   tenant reads own membership     : 1 row   ->  1 row   (unchanged)
--   tenant reads own tenants row    : 1 row   ->  1 row   (unchanged)
--   landlord reads memberships      : 1 row   ->  1 row   (unchanged)
--   landlord reads properties       : 13 rows ->  13 rows (unchanged)
--
-- PostgREST switches to `authenticated` for any request carrying a valid JWT,
-- so tenants and landlords never transact as `anon` and are unaffected. No
-- application code reads tenant_users yet — Phase A ships no client that
-- touches it — so there is no pre-login path to break.
--
-- Rollback: migrations/013_tenant_users_revoke_anon_rollback.sql
-- ============================================================================

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

revoke all on public.tenant_users from anon;

commit;
