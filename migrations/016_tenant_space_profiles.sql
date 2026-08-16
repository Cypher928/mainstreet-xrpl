-- ============================================================================
-- 016_tenant_space_profiles.sql — B2: the space a tenant may see
-- ============================================================================
-- TARGET: PILOT PROJECT ONLY (bhmktujbxdbvdmpybmad).
-- NEVER apply to production (zhsuhehgehbzkmzurzyf).
--
-- WHY A PROJECTION AND NOT A POLICY ON AN EXISTING TABLE
-- ------------------------------------------------------
-- The tenant needs to see their property name, address, suite, area, term and
-- who to contact. Every one of those facts lives on a landlord-owned table —
-- properties (incl. the data JSONB) and tenants — and none of those tables may
-- become tenant-readable. A policy would also be row-scoped, so it could not
-- keep tenants.cap or tenants.lease_url out of the answer.
--
-- So the landlord publishes a copy. This table holds values, never pointers,
-- and nothing lands in it that the landlord did not deliberately put there.
--
-- THE _sources COMPANION
-- ----------------------
-- An earlier draft of B2 proposed keeping publisher/provenance columns in the
-- projection and withholding them with column-level GRANTs. That does not work:
-- landlords and tenants are BOTH the Postgres role `authenticated`, so any
-- privilege granted for the landlord is granted to the tenant too, and any
-- privilege revoked from the tenant is revoked from the landlord. Column grants
-- cannot separate two parties who share a role.
--
-- The rule instead: if a column is not for the tenant, it does not live in the
-- projection. Operational fields move to a companion table with a landlord
-- policy and NO TENANT POLICY AT ALL — the same construction that already makes
-- public.properties unreachable, and the one B1 proved over real HTTP.
--
-- NOTHING IS REVOKED FROM `authenticated` ANYWHERE IN B2. A privilege that is
-- never removed cannot be removed from the wrong party.
--
-- Rollback: migrations/016_tenant_space_profiles_rollback.sql
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

-- ── The projection: every column here is intended for the tenant ───────────
create table if not exists public.tenant_space_profiles (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null,
  property_id      uuid not null,

  property_name    text not null,
  property_address text,
  space_label      text,
  rentable_sqft    numeric(12,2),
  lease_type       text,
  lease_start      date,
  lease_end        date,
  pro_rata_percent numeric(7,4),
  manager_name     text,
  manager_email    text,

  status           text not null default 'draft'
                     check (status in ('draft','published','withdrawn')),
  published_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint tenant_space_profiles_tenant_uniq unique (tenant_id),

  -- Composite FK against tenants(id, property_id): a profile that names the
  -- wrong property is unrepresentable rather than merely wrong. Reuses
  -- tenants_id_property_uniq, the same constraint Phase A built memberships on.
  constraint tenant_space_profiles_tenant_property_fk
    foreign key (tenant_id, property_id)
    references public.tenants(id, property_id) on delete cascade,

  -- A published row without a publication time is not a published row.
  constraint tenant_space_profiles_publish_complete check (
    status <> 'published' or published_at is not null
  )
);

comment on table public.tenant_space_profiles is
  'B2 projection. Landlord-published, tenant-readable description of a leased space. Holds copied values only — never a reference into properties or properties.data.';

-- ── The companion: landlord-only, no tenant policy ─────────────────────────
create table if not exists public.tenant_space_profile_sources (
  profile_id   uuid primary key
                 references public.tenant_space_profiles(id) on delete cascade,
  property_id  uuid not null,
  published_by uuid references auth.users(id),
  created_at   timestamptz not null default now()
);

comment on table public.tenant_space_profile_sources is
  'B2 companion. Publisher identity for a space profile. NO TENANT POLICY — a tenant reads zero rows here by construction, not by filter.';

create index if not exists tenant_space_profiles_tenant_idx
  on public.tenant_space_profiles(tenant_id) where status = 'published';
create index if not exists tenant_space_profiles_property_idx
  on public.tenant_space_profiles(property_id);
create index if not exists tenant_space_profile_sources_property_idx
  on public.tenant_space_profile_sources(property_id);

-- ── RLS ────────────────────────────────────────────────────────────────────
alter table public.tenant_space_profiles        enable row level security;
alter table public.tenant_space_profile_sources enable row level security;

revoke all on public.tenant_space_profiles        from anon;
revoke all on public.tenant_space_profile_sources from anon;

-- Tenant: SELECT only, own rows only, published only. The status predicate is
-- here and not in the portal's query, so a bug in the client cannot show a draft.
create policy tenant_space_profiles_tenant_select on public.tenant_space_profiles
  for select to authenticated
  using (
    tenant_id in (select public.tenant_ids_for_current_user())
    and status = 'published'
  );

create policy tenant_space_profiles_landlord_all on public.tenant_space_profiles
  for all to authenticated
  using      (property_id in (select p.id from public.properties p where p.user_id = auth.uid()))
  with check (property_id in (select p.id from public.properties p where p.user_id = auth.uid()));

create policy tenant_space_profiles_service_role_all on public.tenant_space_profiles
  for all to service_role using (true) with check (true);

-- Companion: landlord and service role only. No tenant policy is written here,
-- and that absence is the boundary.
create policy tenant_space_profile_sources_landlord_all on public.tenant_space_profile_sources
  for all to authenticated
  using      (property_id in (select p.id from public.properties p where p.user_id = auth.uid()))
  with check (property_id in (select p.id from public.properties p where p.user_id = auth.uid()));

create policy tenant_space_profile_sources_service_role_all on public.tenant_space_profile_sources
  for all to service_role using (true) with check (true);

commit;
