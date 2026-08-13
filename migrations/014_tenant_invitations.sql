-- ============================================================================
-- 014_tenant_invitations.sql — Phase B1: invitation + acceptance
-- ============================================================================
-- TARGET: PILOT PROJECT ONLY (bhmktujbxdbvdmpybmad).
-- NEVER apply to production (zhsuhehgehbzkmzurzyf).
--
-- Strictly additive. Creates one table and three policies. No existing policy
-- is dropped, altered or weakened; no existing row is touched.
--
-- WHY THIS TABLE EXISTS
-- ---------------------
-- Phase A proved a tenant cannot accept their own invite: tenant_users has no
-- tenant UPDATE policy, so accepted_at is settable only by the landlord or the
-- service role — and the attempt fails SILENTLY, affecting 0 rows rather than
-- raising. Handing tenants an UPDATE policy would have been the obvious fix and
-- the wrong one: a tenant able to write tenant_users can grant itself a space.
--
-- Instead the invitation carries the authority. The landlord creates a row; the
-- tenant redeems a single-use token; and the row that grants access is written
-- SERVER-SIDE with the service role by /api/tenant-accept-invite. Tenants never
-- gain a write path to tenant_users.
--
-- WHAT A TENANT CAN SEE HERE: nothing. There is deliberately NO tenant policy on
-- this table. A tenant cannot read their own invitation, cannot enumerate other
-- invitations, and cannot read token_hash. Redemption is proved by presenting
-- the token to the API, not by reading the row.
--
-- Rollback: migrations/014_tenant_invitations_rollback.sql
-- ============================================================================

begin;

-- Same pilot guard as 012/013. A migration that can silently run against
-- production is a migration that eventually will.
do $$
begin
  if not exists (
    select 1 from public.properties
    where id = 'fd9c09b1-b657-4c58-9999-c3cce28e7600'
  ) then
    raise exception
      'REFUSING TO RUN: pilot marker property not found. This does not appear to be the pilot project (bhmktujbxdbvdmpybmad). Phase B must never be applied to production.';
  end if;
end $$;

create extension if not exists citext;

create table if not exists public.tenant_invitations (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null,
  property_id uuid not null,
  email       citext not null,
  -- sha256 hex of a 32-byte random token. The raw token is emailed and never
  -- stored, so a database read cannot be replayed into an acceptance.
  token_hash  text not null unique,
  invited_by  uuid not null references auth.users(id) on delete cascade,
  invited_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '14 days',
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id) on delete set null,
  revoked_at  timestamptz,
  created_at  timestamptz not null default now(),
  -- Composite FK, as in 012: an invitation whose property disagrees with the
  -- tenant's real property is unrepresentable rather than merely rejected.
  -- This is also what makes the six known drift records un-inviteable by
  -- construction — four demo fixtures on Harborview with synthetic ids, and two
  -- orphans on an abandoned 0-sqft "New Property" — without any backfill and
  -- without inventing tenant identities for them.
  constraint tenant_invitations_tenant_property_fk
    foreign key (tenant_id, property_id)
    references public.tenants(id, property_id) on delete cascade
);

comment on table public.tenant_invitations is
  'Phase B1: a landlord-issued, single-use invitation binding an email to one tenant space. Tenants have NO policy on this table - redemption happens server-side via /api/tenant-accept-invite, which is what keeps tenant_users write-free for tenants.';

create index if not exists tenant_invitations_tenant_idx   on public.tenant_invitations(tenant_id);
create index if not exists tenant_invitations_property_idx on public.tenant_invitations(property_id);
-- Open invitations only: the lookup the accept endpoint performs.
create index if not exists tenant_invitations_open_idx
  on public.tenant_invitations(token_hash)
  where accepted_at is null and revoked_at is null;

alter table public.tenant_invitations enable row level security;

-- Landlord: full management of invitations for properties they own.
create policy tenant_invitations_landlord_all on public.tenant_invitations
  for all to authenticated
  using (
    property_id in (select p.id from public.properties p where p.user_id = auth.uid())
  )
  with check (
    property_id in (select p.id from public.properties p where p.user_id = auth.uid())
  );

-- The accept endpoint. The ONLY writer of the acceptance itself.
create policy tenant_invitations_service_role_all on public.tenant_invitations
  for all to service_role
  using (true) with check (true);

-- NO tenant policy. Deliberate — see the header. RLS is enabled with no
-- matching policy for a tenant, so every tenant read returns zero rows.

-- Membership data has no anonymous use case, and neither do invitations.
-- Matches 013's treatment of tenant_users: deny at the grant layer as well as
-- at RLS, so one mis-edited policy is not the only thing standing between an
-- anonymous caller and the invitation table.
revoke all on public.tenant_invitations from anon;

commit;
