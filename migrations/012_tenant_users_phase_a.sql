-- ============================================================================
-- 012_tenant_users_phase_a.sql — Phase A: tenant identity + authorization
-- ============================================================================
-- TARGET: PILOT PROJECT ONLY (bhmktujbxdbvdmpybmad).
-- NEVER apply to production (zhsuhehgehbzkmzurzyf).
--
-- This migration is STRICTLY ADDITIVE. It creates one table, one function,
-- four policies and one unique constraint. It does not DROP, ALTER or
-- otherwise weaken any existing policy, and it does not touch any existing
-- row. Landlord access is defined entirely by the pre-existing
-- `properties.user_id = auth.uid()` policies, which are untouched here.
--
-- WHAT PHASE A DELIBERATELY DOES NOT DO
-- -------------------------------------
-- No tenant-scoped policy is added to properties, tenant_field_evidence,
-- tenant_review_audit, lease_documents, lease_jobs or cam_reconciliations.
-- RLS is enabled on all of them and only landlord/service_role policies
-- exist, so an authenticated tenant reads ZERO rows from each — not a
-- filtered subset, nothing at all. Tenant-visible data arrives in Phase B as
-- purpose-built projection tables, never by opening these up.
--
-- Rollback: migrations/012_tenant_users_phase_a_rollback.sql
-- ============================================================================

begin;

-- ── Guard: refuse to run anywhere that is not the pilot project ─────────────
-- The MCP/psql caller pins the project, but a migration that can silently run
-- against production is a migration that eventually will. This marker property
-- exists only in the pilot database.
do $$
begin
  if not exists (
    select 1 from public.properties
    where id = 'fd9c09b1-b657-4c58-9999-c3cce28e7600'
  ) then
    raise exception
      'REFUSING TO RUN: pilot marker property not found. This does not appear to be the pilot project (bhmktujbxdbvdmpybmad). Phase A must never be applied to production.';
  end if;
end $$;

-- ── 1. Membership table ────────────────────────────────────────────────────
-- One row per (auth user, tenant space). UNIQUE is on (user_id, tenant_id)
-- rather than (user_id) on purpose: a corporate tenant may hold several
-- spaces, and a person may represent tenants across more than one property.
create table if not exists public.tenant_users (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id)        on delete cascade,
  tenant_id   uuid not null references public.tenants(id)    on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  invited_by  uuid references auth.users(id) on delete set null,
  invited_at  timestamptz not null default now(),
  accepted_at timestamptz,
  revoked_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint tenant_users_user_tenant_uniq unique (user_id, tenant_id)
);

comment on table public.tenant_users is
  'Phase A: links a Supabase auth user to a specific tenant space. Membership is live — access is granted only while accepted_at is set and revoked_at is null. This table, not any role claim, is the authorization source of truth for tenants.';

-- ── 2. Composite integrity ─────────────────────────────────────────────────
-- Guarantees tenant_users.property_id can never disagree with the tenant's
-- real property. `id` is already the PK of tenants, so this unique constraint
-- adds no new restriction on existing data — it exists purely so the
-- composite foreign key below has something to reference.
-- Verified before applying: 59 rows, 0 null property_id, 0 composite duplicates.
alter table public.tenants
  add constraint tenants_id_property_uniq unique (id, property_id);

alter table public.tenant_users
  add constraint tenant_users_tenant_property_fk
  foreign key (tenant_id, property_id)
  references public.tenants(id, property_id) on delete cascade;

create index if not exists tenant_users_user_idx
  on public.tenant_users(user_id) where revoked_at is null;
create index if not exists tenant_users_tenant_idx   on public.tenant_users(tenant_id);
create index if not exists tenant_users_property_idx on public.tenant_users(property_id);

-- ── 3. The single authorization primitive ──────────────────────────────────
-- SECURITY DEFINER is load-bearing twice over:
--   1. it reads tenant_users independently of the caller's own RLS;
--   2. it prevents recursive policy evaluation — a policy ON tenant_users that
--      called a function SELECTing FROM tenant_users under the invoker's rights
--      would recurse.
-- search_path is pinned to '' (empty), so every name below is schema-qualified
-- and the function cannot be hijacked by a caller-controlled search_path.
create or replace function public.tenant_ids_for_current_user()
returns setof uuid
language sql
security definer
stable
set search_path = ''
as $$
  select tu.tenant_id
  from public.tenant_users tu
  where tu.user_id     = auth.uid()
    and tu.accepted_at is not null
    and tu.revoked_at  is null
$$;

comment on function public.tenant_ids_for_current_user() is
  'Phase A authorization helper. Returns the tenant_ids the calling user may read. Never consults any role claim — user_metadata is client-writable and is not an authorization input.';

revoke all    on function public.tenant_ids_for_current_user() from public, anon;
grant  execute on function public.tenant_ids_for_current_user() to authenticated;

-- ── 4. RLS on the membership table itself ──────────────────────────────────
alter table public.tenant_users enable row level security;

-- A tenant may SELECT its own membership rows. Deliberately SELECT-only:
-- an INSERT policy here would let a tenant grant itself access to any space.
create policy tenant_users_self_select on public.tenant_users
  for select to authenticated
  using (user_id = auth.uid());

-- The landlord who owns the property manages its memberships.
create policy tenant_users_landlord_all on public.tenant_users
  for all to authenticated
  using (
    property_id in (select p.id from public.properties p where p.user_id = auth.uid())
  )
  with check (
    property_id in (select p.id from public.properties p where p.user_id = auth.uid())
  );

create policy tenant_users_service_role_all on public.tenant_users
  for all to service_role
  using (true) with check (true);

-- ── 5. The one new tenant-scoped read in Phase A ───────────────────────────
-- Added alongside the existing tenants_owner_all policy, which is untouched.
-- PERMISSIVE policies OR together, so this cannot narrow or widen landlord
-- access — it only adds a disjoint tenant path.
create policy tenants_tenant_self_select on public.tenants
  for select to authenticated
  using (id in (select public.tenant_ids_for_current_user()));

commit;
