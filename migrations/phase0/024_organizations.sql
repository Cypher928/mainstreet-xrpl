-- ─── 024_organizations — Phase 0, P0.1 ──────────────────────────────────────
--
-- Organisations, membership, and the one rule every property-scoped policy
-- now reads: a row is visible to the property's OWNER, or to an ACTIVE MEMBER
-- of the property's organisation. Nothing else changes for anyone today —
-- every existing user becomes the admin of a one-person organisation, and
-- every existing property joins its owner's organisation — so the behaviour
-- after this migration is identical to the behaviour before it, for every
-- account, until someone is deliberately made a member of someone else's.
--
-- WHY THIS IS FIRST
-- Every RLS policy on every property-scoped table said `user_id = auth.uid()`
-- in one form or another. Phase 1 creates six more tables. Shipping them with
-- that rule and adding organisations later would mean rewriting every policy
-- twice. So the shape is set once, here, before any table depends on it.
--
-- WHAT "ACTIVE" MEANS, AND WHY IT IS CHECKED EVERY TIME
-- A membership grants access only while `accepted_at is not null and
-- revoked_at is null`. Every predicate below reads the row at query time —
-- there is no cached grant anywhere — so revoking a membership removes access
-- on the very next statement. (A storage signed URL already minted lives for
-- its TTL, 300 seconds; that is the one window, and it is stated in
-- api/document-url.js.)
--
-- ONE PREDICATE, MANY POLICIES
-- Three security-definer helpers carry the rule. Policies call them rather
-- than restating the join, so there is one place the meaning of "member" lives
-- and one place it can be wrong. They are `security definer set search_path =
-- ''` for the same reason tenant_ids_for_current_user() (migration 012) is:
-- they must read organization_members regardless of that table's own RLS,
-- and must not be able to resolve an unqualified name to anything a caller
-- planted.
--
-- STORAGE
-- storage.objects policies accepted only `<user_id>/...` paths. They now also
-- accept `<organization_id>/...` for active members. The first path segment is
-- an ADDRESS, not a grant: the uid form still requires the caller's own uid,
-- and the org form requires a live membership row. Both shapes coexist; no
-- object is moved.
--
-- UNTOUCHED, DELIBERATELY
--   acquisition_reviews   has no property_id until 023 runs; its policy stays
--                         `user_id = auth.uid()` until then.
--   tenant-side policies  tenant_users_self_select, tenants_tenant_self_select,
--                         *_tenant_select — about tenants, not landlords.
--   service_role policies unchanged.
--
-- PILOT ONLY. The marker property guard below is the same one migrations
-- 012 and 014 use; this file refuses to run anywhere it is absent.
-- Idempotent: safe to re-run. Rollback: 024_organizations_rollback.sql.

begin;

-- ── Guard ──────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from public.properties
    where id = 'fd9c09b1-b657-4c58-9999-c3cce28e7600'
  ) then
    raise exception
      'REFUSING TO RUN: pilot marker property not found. This does not appear to be the pilot project (bhmktujbxdbvdmpybmad). 024 must never be applied to production.';
  end if;
end $$;

-- ── Tables ─────────────────────────────────────────────────────────────────

create table if not exists public.organizations (
  id          uuid        primary key default gen_random_uuid(),
  name        text        not null,
  created_by  uuid        references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.organizations is
  'P0.1: a team that shares properties. Every user is the admin of one on creation; sharing is a membership row, never a role claim.';

create table if not exists public.organization_members (
  id              uuid        primary key default gen_random_uuid(),
  organization_id uuid        not null references public.organizations(id) on delete cascade,
  user_id         uuid        not null references auth.users(id)           on delete cascade,
  role            text        not null default 'read_only'
                    check (role in ('admin', 'property_manager', 'accounting', 'leasing', 'read_only')),
  invited_by      uuid        references auth.users(id) on delete set null,
  invited_at      timestamptz not null default now(),
  accepted_at     timestamptz,
  revoked_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint organization_members_org_user_uniq unique (organization_id, user_id)
);
comment on table public.organization_members is
  'P0.1: membership is live — access is granted only while accepted_at is set and revoked_at is null. Roles are labels in Phase 1; enforcement is Phase 5. This table, not any role claim, is the authorization source of truth for landlord-side sharing.';

create index if not exists organization_members_user_active_idx
  on public.organization_members (user_id) where revoked_at is null;
create index if not exists organization_members_org_idx
  on public.organization_members (organization_id);

alter table public.properties
  add column if not exists organization_id uuid references public.organizations(id) on delete restrict;
create index if not exists properties_organization_id_idx
  on public.properties (organization_id);

drop trigger if exists organizations_updated_at on public.organizations;
create trigger organizations_updated_at
  before update on public.organizations
  for each row execute function public.set_updated_at();
drop trigger if exists organization_members_updated_at on public.organization_members;
create trigger organization_members_updated_at
  before update on public.organization_members
  for each row execute function public.set_updated_at();

-- ── The rule, as three helpers ─────────────────────────────────────────────

-- Is the caller an active member of this organisation?
create or replace function public.is_active_member_of_org(p_org uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members m
    where m.organization_id = p_org
      and m.user_id         = auth.uid()
      and m.accepted_at     is not null
      and m.revoked_at      is null
  )
$$;
comment on function public.is_active_member_of_org(uuid) is
  'P0.1 authorization helper. Live membership only. Never consults a role claim.';

-- May the caller see this property? Owner, or active member of its organisation.
create or replace function public.is_member_of_property(p_property uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.properties p
    where p.id = p_property
      and (
        p.user_id = auth.uid()
        or (p.organization_id is not null and public.is_active_member_of_org(p.organization_id))
      )
  )
$$;
comment on function public.is_member_of_property(uuid) is
  'P0.1 authorization helper: owner OR active organisation member. The one rule every property-scoped policy reads.';

-- Every property the caller may see. For `property_id in (select ...)` policies.
create or replace function public.member_property_ids()
returns setof uuid
language sql
security definer
stable
set search_path = ''
as $$
  select p.id
  from public.properties p
  where p.user_id = auth.uid()
     or (p.organization_id is not null and public.is_active_member_of_org(p.organization_id))
$$;
comment on function public.member_property_ids() is
  'P0.1 authorization helper. The set of property ids the calling user may read: owned, or in an organisation they are an active member of.';

-- Storage: a path is reachable if its first segment is the caller's own uid
-- (the SEC-1 rule, unchanged) or an organisation the caller is an active
-- member of. The segment is an address, never a grant on its own.
create or replace function public.storage_object_accessible(object_name text)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select (storage.foldername(object_name))[1] = auth.uid()::text
      or exists (
        select 1
        from public.organization_members m
        where m.user_id     = auth.uid()
          and m.accepted_at is not null
          and m.revoked_at  is null
          and m.organization_id::text = (storage.foldername(object_name))[1]
      )
$$;
comment on function public.storage_object_accessible(text) is
  'P0.1 storage rule: uid-prefixed path must be the caller''s own; org-prefixed path requires live membership. Coexisting shapes; nothing is moved.';

revoke all on function public.is_active_member_of_org(uuid)   from public, anon;
revoke all on function public.is_member_of_property(uuid)     from public, anon;
revoke all on function public.member_property_ids()           from public, anon;
revoke all on function public.storage_object_accessible(text) from public, anon;
grant execute on function public.is_active_member_of_org(uuid)   to authenticated;
grant execute on function public.is_member_of_property(uuid)     to authenticated;
grant execute on function public.member_property_ids()           to authenticated;
grant execute on function public.storage_object_accessible(text) to authenticated;

-- ── Every property belongs to an organisation ──────────────────────────────
--
-- The application does not know about organisations yet (that is S1). A
-- property it inserts arrives with organization_id null. This trigger gives
-- it the inserting user's own organisation — creating that organisation and
-- an admin membership if the user has none, which is also how a user who
-- signs up after this migration gets theirs. Security definer, because the
-- inserting user cannot write organization_members directly.
create or replace function public.properties_default_organization()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  if new.organization_id is not null or new.user_id is null then
    return new;
  end if;

  select m.organization_id into v_org
  from public.organization_members m
  where m.user_id = new.user_id
    and m.role = 'admin'
    and m.accepted_at is not null
    and m.revoked_at is null
  order by m.created_at asc
  limit 1;

  if v_org is null then
    insert into public.organizations (name, created_by)
    values (coalesce((select u.email from auth.users u where u.id = new.user_id), 'Organisation'), new.user_id)
    returning id into v_org;
    insert into public.organization_members (organization_id, user_id, role, accepted_at)
    values (v_org, new.user_id, 'admin', now());
  end if;

  new.organization_id := v_org;
  return new;
end $$;

drop trigger if exists properties_default_organization on public.properties;
create trigger properties_default_organization
  before insert on public.properties
  for each row execute function public.properties_default_organization();

-- ── Backfill: one organisation per existing user; properties join their owner's ──

insert into public.organizations (name, created_by)
select coalesce(u.email, 'Organisation'), u.id
from auth.users u
where not exists (select 1 from public.organizations o where o.created_by = u.id);

insert into public.organization_members (organization_id, user_id, role, accepted_at)
select o.id, o.created_by, 'admin', now()
from public.organizations o
where o.created_by is not null
  and not exists (
    select 1 from public.organization_members m
    where m.organization_id = o.id and m.user_id = o.created_by
  );

update public.properties p
set organization_id = (
  select m.organization_id
  from public.organization_members m
  where m.user_id = p.user_id
    and m.role = 'admin'
    and m.revoked_at is null
  order by m.created_at asc
  limit 1
)
where p.organization_id is null
  and p.user_id is not null;

-- ── RLS on the new tables ──────────────────────────────────────────────────
-- Read-only for authenticated users in P0.1. Membership is written by the
-- backfill, the trigger and (Phase 5) the invitation route — all service-side.

alter table public.organizations        enable row level security;
alter table public.organization_members enable row level security;

grant select on public.organizations        to authenticated;
grant select on public.organization_members to authenticated;
grant all    on public.organizations        to service_role;
grant all    on public.organization_members to service_role;

drop policy if exists organizations_member_select     on public.organizations;
drop policy if exists organizations_service_role_all  on public.organizations;
create policy organizations_member_select on public.organizations
  for select to authenticated
  using (public.is_active_member_of_org(id));
create policy organizations_service_role_all on public.organizations
  for all to service_role using (true) with check (true);

drop policy if exists organization_members_self_select   on public.organization_members;
drop policy if exists organization_members_org_select    on public.organization_members;
drop policy if exists organization_members_service_role_all on public.organization_members;
create policy organization_members_self_select on public.organization_members
  for select to authenticated
  using (user_id = auth.uid());
create policy organization_members_org_select on public.organization_members
  for select to authenticated
  using (public.is_active_member_of_org(organization_id));
create policy organization_members_service_role_all on public.organization_members
  for all to service_role using (true) with check (true);

-- ── The property-scoped policies: owner OR active member ───────────────────
-- Each policy keeps its name, its command and its role target; only the
-- predicate changes. Service-role and tenant-side policies are not touched.

-- properties
drop policy if exists "properties_owner_all" on public.properties;
create policy "properties_owner_all"
  on public.properties
  for all
  to authenticated
  using (
    user_id = auth.uid()
    or (organization_id is not null and public.is_active_member_of_org(organization_id))
  )
  with check (
    user_id = auth.uid()
    or (organization_id is not null and public.is_active_member_of_org(organization_id))
  );

-- tenants
drop policy if exists "tenants_owner_all" on public.tenants;
create policy "tenants_owner_all"
  on public.tenants
  for all
  to authenticated
  using      (property_id in (select public.member_property_ids()))
  with check (property_id in (select public.member_property_ids()));

-- lease_jobs
drop policy if exists "lease_jobs_owner_all" on public.lease_jobs;
create policy "lease_jobs_owner_all"
  on public.lease_jobs
  for all
  to authenticated
  using      (property_id in (select public.member_property_ids()))
  with check (property_id in (select public.member_property_ids()));

-- tenant_field_evidence
drop policy if exists "tfe_owner_all" on public.tenant_field_evidence;
create policy "tfe_owner_all"
  on public.tenant_field_evidence
  for all to authenticated
  using      (property_id in (select public.member_property_ids()))
  with check (property_id in (select public.member_property_ids()));

-- tenant_review_audit
drop policy if exists "tra_owner_all" on public.tenant_review_audit;
create policy "tra_owner_all"
  on public.tenant_review_audit
  for all to authenticated
  using      (property_id in (select public.member_property_ids()))
  with check (property_id in (select public.member_property_ids()));

-- cam_reconciliations
drop policy if exists "cam_recon_owner_all" on public.cam_reconciliations;
create policy "cam_recon_owner_all"
  on public.cam_reconciliations
  for all to authenticated
  using      (property_id in (select public.member_property_ids()))
  with check (property_id in (select public.member_property_ids()));

-- lease_documents
drop policy if exists "lease_docs_owner_all" on public.lease_documents;
create policy "lease_docs_owner_all"
  on public.lease_documents
  for all to authenticated
  using      (property_id in (select public.member_property_ids()))
  with check (property_id in (select public.member_property_ids()));

-- tenant_users (landlord side)
drop policy if exists tenant_users_landlord_all on public.tenant_users;
create policy tenant_users_landlord_all on public.tenant_users
  for all to authenticated
  using      (property_id in (select public.member_property_ids()))
  with check (property_id in (select public.member_property_ids()));

-- tenant_invitations (landlord side)
drop policy if exists tenant_invitations_landlord_all on public.tenant_invitations;
create policy tenant_invitations_landlord_all on public.tenant_invitations
  for all to authenticated
  using      (property_id in (select public.member_property_ids()))
  with check (property_id in (select public.member_property_ids()));

-- tenant_statements (landlord side)
drop policy if exists tenant_statements_landlord_all on public.tenant_statements;
create policy tenant_statements_landlord_all on public.tenant_statements
  for all to authenticated
  using      (property_id in (select public.member_property_ids()))
  with check (property_id in (select public.member_property_ids()));

-- payments family (landlord select). Role target preserved as 022 wrote it.
drop policy if exists payments_landlord_select on public.payments;
create policy payments_landlord_select on public.payments for select
  using (property_id in (select public.member_property_ids()));

drop policy if exists payment_sources_landlord_select on public.payment_sources;
create policy payment_sources_landlord_select on public.payment_sources for select
  using (property_id in (select public.member_property_ids()));

drop policy if exists payment_settlements_landlord_select on public.payment_settlements;
create policy payment_settlements_landlord_select on public.payment_settlements for select
  using (property_id in (select public.member_property_ids()));

drop policy if exists payment_events_landlord_select on public.payment_events;
create policy payment_events_landlord_select on public.payment_events for select
  using (property_id in (select public.member_property_ids()));

-- The payment RPCs assert ownership before writing. A member who can read a
-- property's payments must be able to act on them under the same rule.
create or replace function public._payment_assert_owner(p_property_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_member_of_property(p_property_id) then
    raise exception 'Not authorized: caller is not the owner or an active member of property %', p_property_id
      using errcode = 'insufficient_privilege';
  end if;
end $$;

-- ── Storage: both path shapes, one rule ────────────────────────────────────
drop policy if exists "docs_owner_read"   on storage.objects;
drop policy if exists "docs_owner_insert" on storage.objects;
drop policy if exists "docs_owner_update" on storage.objects;
drop policy if exists "docs_owner_delete" on storage.objects;

create policy "docs_owner_read"
  on storage.objects for select
  to authenticated
  using (
    bucket_id in ('leases', 'invoices')
    and public.storage_object_accessible(name)
  );

create policy "docs_owner_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id in ('leases', 'invoices')
    and public.storage_object_accessible(name)
  );

create policy "docs_owner_update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id in ('leases', 'invoices')
    and public.storage_object_accessible(name)
  )
  with check (
    bucket_id in ('leases', 'invoices')
    and public.storage_object_accessible(name)
  );

create policy "docs_owner_delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id in ('leases', 'invoices')
    and public.storage_object_accessible(name)
  );

commit;

-- ── Verify (run after commit; every line should hold) ──────────────────────
-- select count(*) as organisations               from public.organizations;
-- select count(*) as admin_memberships           from public.organization_members where role = 'admin' and accepted_at is not null;
-- select count(*) as properties_without_org      from public.properties where organization_id is null;          -- expect 0
-- select count(*) as users_without_own_org       from auth.users u where not exists (select 1 from public.organizations o where o.created_by = u.id); -- expect 0
-- select tablename, policyname from pg_policies
--   where schemaname = 'public' and qual like '%properties.user_id = auth.uid()%'
--     and policyname not like '%tenant%';                                                                       -- expect: acquisition_reviews only (until 023)
