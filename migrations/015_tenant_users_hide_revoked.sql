-- ============================================================================
-- 015_tenant_users_hide_revoked.sql — a revoked membership becomes invisible
-- ============================================================================
-- TARGET: PILOT PROJECT ONLY (bhmktujbxdbvdmpybmad).
-- NEVER apply to production (zhsuhehgehbzkmzurzyf).
--
-- WHY
-- ---
-- The B1 authorization gate (test-tenant-authz.js, run over real HTTP against
-- pilot) surfaced this: T9b asserts a revoked tenant reads ZERO rows from
-- tenant_users, and it returned 1 — the tenant's own membership row, with
-- revoked_at set.
--
-- That was the shipped behaviour, not an accident. 012 wrote:
--
--   create policy tenant_users_self_select on public.tenant_users
--     for select to authenticated
--     using (user_id = auth.uid());
--
-- No revoked_at predicate. Nothing lateral leaked — the two PERMISSIVE policies
-- an authenticated tenant can match are this one and tenant_users_landlord_all
-- (property_id in own properties, and a tenant owns none), so the union is
-- own-rows-only — and T9 confirmed the tenant_id in that row is inert: the same
-- revoked caller reads 0 rows from tenants.
--
-- It is still the wrong shape. The database held TWO definitions of membership:
-- tenant_ids_for_current_user() means "accepted and not revoked", while this
-- policy meant "ever existed". A security boundary with two definitions of its
-- central noun is one edit away from the looser one being the effective one.
-- After this migration there is a single definition, expressed the same way in
-- both places.
--
-- The test was kept as written and the policy moved to meet it. Relaxing a
-- negative-authorization assertion to match observed behaviour is how a suite
-- stops being evidence.
--
-- SCOPE
-- -----
-- One policy: tenant_users_self_select. Deliberately NOT touched —
--   · tenant_users_landlord_all    the landlord must keep seeing revoked rows,
--                                  they are what it manages; asserted by T7c.
--   · tenant_users_service_role_all the accept-invite endpoint writes through
--                                  this; asserted by T17/T18.
--   · tenant_ids_for_current_user() already filters revoked_at; unchanged.
--   · every policy on tenants, properties and the landlord tables.
--
-- EFFECT
-- ------
--   revoked tenant reads tenant_users : 1 row  ->  0 rows   (T9b, the fix)
--   active tenant reads tenant_users  : 1 row  ->  1 row    (T12/T12c)
--   landlord reads tenant_users       : 3 rows ->  3 rows   (T7c)
--   revoked tenant reads tenants      : 0 rows ->  0 rows   (T9, unchanged)
--
-- NO CLIENT BREAKS. portal.js selects revoked_at and filters client-side
-- (`m.accepted_at && !m.revoked_at`), so a revoked tenant already rendered the
-- empty state; it now reaches that state with the row filtered in the database
-- instead of in the browser, which is where it belonged.
--
-- RE-ACCEPTANCE STILL WORKS. A revoked tenant that is re-invited is restored by
-- api/tenant-accept-invite.js, which writes with the service role and is
-- unaffected by this policy. That path is now asserted end to end (T17/T18)
-- rather than assumed — writing this migration is what exposed that the
-- endpoint was not clearing revoked_at on re-acceptance.
--
-- Rollback: migrations/015_tenant_users_hide_revoked_rollback.sql
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

drop policy if exists tenant_users_self_select on public.tenant_users;

-- A tenant may SELECT its own ACTIVE membership rows. Still SELECT-only: an
-- INSERT policy here would let a tenant grant itself any space (T11).
-- `accepted_at is not null` is part of the definition too — a pending invitation
-- is not a membership, and it is tenant_ids_for_current_user()'s definition.
create policy tenant_users_self_select on public.tenant_users
  for select to authenticated
  using (
    user_id = auth.uid()
    and accepted_at is not null
    and revoked_at is null
  );

commit;
