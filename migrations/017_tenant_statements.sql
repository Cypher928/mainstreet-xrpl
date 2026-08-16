-- ============================================================================
-- 017_tenant_statements.sql — B2: published CAM statements and their history
-- ============================================================================
-- TARGET: PILOT PROJECT ONLY (bhmktujbxdbvdmpybmad).
-- NEVER apply to production (zhsuhehgehbzkmzurzyf).
--
-- Publication is the trust boundary. A row here is a statement the landlord
-- deliberately released; everything else in the system is working material.
--
-- THE NUMBERS ARE COPIED, NOT REFERENCED, AND NOT RECOMPUTED
-- ----------------------------------------------------------
-- allocated_amount and friends are written from the cam_reconciliations row by
-- api/tenant-publish-statement.js. The portal performs no arithmetic, B2 changes
-- no allocation math, and a statement cannot drift when the working data later
-- changes — which is the point of publishing rather than exposing a live view.
--
-- ONE LIVE STATEMENT PER YEAR
-- ---------------------------
-- A correction supersedes: the previous row moves to 'superseded' and a new
-- version is published, atomically, in publish_tenant_statement(). The partial
-- unique index below makes two simultaneously-live statements unrepresentable
-- rather than merely avoided — so the tenant is never shown two different
-- numbers for one year, even if the endpoint is ever wrong.
--
-- Rollback: migrations/017_tenant_statements_rollback.sql
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

create table if not exists public.tenant_statements (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null,
  property_id       uuid not null,
  cam_year          integer not null,
  version           integer not null default 1,

  -- Typed columns rather than JSON alone: the portal sorts and totals without
  -- parsing, and a malformed statement fails at write time instead of render.
  allocated_amount  numeric(14,2) not null,
  pro_rata_percent  numeric(7,4)  not null,
  total_pool        numeric(14,2) not null,
  amount_billed     numeric(14,2),
  balance_due       numeric(14,2),
  currency          text not null default 'usd',

  -- The tenant-visible slice ONLY. Never another tenant's share, never the
  -- unallocated pool detail, never exclusion reasoning, evidence, audit
  -- references, reviewer notes, confidence scores or model names.
  statement_json    jsonb not null,

  status            text not null default 'draft'
                      check (status in ('draft','published','superseded','void')),
  published_at      timestamptz,
  created_at        timestamptz not null default now(),

  constraint tenant_statements_version_uniq unique (tenant_id, cam_year, version),
  constraint tenant_statements_tenant_property_fk
    foreign key (tenant_id, property_id)
    references public.tenants(id, property_id) on delete cascade,
  constraint tenant_statements_publish_complete check (
    status <> 'published' or published_at is not null
  ),
  constraint tenant_statements_year_sane check (cam_year between 2000 and 2100)
);

comment on table public.tenant_statements is
  'B2 projection. A CAM statement the landlord has published to one tenant. Figures are copied from cam_reconciliations at publish time by api/tenant-publish-statement.js and are never recomputed here.';

-- Exactly one live statement per tenant-year.
create unique index if not exists tenant_statements_one_live
  on public.tenant_statements (tenant_id, cam_year)
  where status = 'published';

create index if not exists tenant_statements_tenant_idx
  on public.tenant_statements(tenant_id) where status = 'published';
create index if not exists tenant_statements_property_idx
  on public.tenant_statements(property_id);

-- ── Companion: provenance and the revision chain, landlord only ────────────
create table if not exists public.tenant_statement_sources (
  statement_id             uuid primary key
                             references public.tenant_statements(id) on delete cascade,
  property_id              uuid not null,
  source_reconciliation_id uuid references public.cam_reconciliations(id) on delete set null,
  source_run_hash          text,
  superseded_by            uuid references public.tenant_statements(id) on delete set null,
  published_by             uuid references auth.users(id),
  created_at               timestamptz not null default now()
);

comment on table public.tenant_statement_sources is
  'B2 companion. Which reconciliation a statement came from, its run hash, its revision chain and who published it. NO TENANT POLICY — zero rows for a tenant by construction.';

create index if not exists tenant_statement_sources_property_idx
  on public.tenant_statement_sources(property_id);

-- ── RLS ────────────────────────────────────────────────────────────────────
alter table public.tenant_statements        enable row level security;
alter table public.tenant_statement_sources enable row level security;

revoke all on public.tenant_statements        from anon;
revoke all on public.tenant_statement_sources from anon;

create policy tenant_statements_tenant_select on public.tenant_statements
  for select to authenticated
  using (
    tenant_id in (select public.tenant_ids_for_current_user())
    and status = 'published'
  );

create policy tenant_statements_landlord_all on public.tenant_statements
  for all to authenticated
  using      (property_id in (select p.id from public.properties p where p.user_id = auth.uid()))
  with check (property_id in (select p.id from public.properties p where p.user_id = auth.uid()));

create policy tenant_statements_service_role_all on public.tenant_statements
  for all to service_role using (true) with check (true);

create policy tenant_statement_sources_landlord_all on public.tenant_statement_sources
  for all to authenticated
  using      (property_id in (select p.id from public.properties p where p.user_id = auth.uid()))
  with check (property_id in (select p.id from public.properties p where p.user_id = auth.uid()));

create policy tenant_statement_sources_service_role_all on public.tenant_statement_sources
  for all to service_role using (true) with check (true);

-- ── Atomic supersede-and-publish ───────────────────────────────────────────
-- PostgREST cannot issue a multi-statement transaction, and this operation must
-- be one: superseding the old row and publishing the new one in separate
-- requests leaves a window with zero live statements, or two.
--
-- SECURITY DEFINER with search_path = '' for the same reasons as
-- tenant_ids_for_current_user(). Granted to service_role ONLY — the endpoint has
-- already established that the caller owns the property before it gets here, and
-- this function performs no authorization of its own. It must therefore never be
-- reachable by `authenticated`.
create or replace function public.publish_tenant_statement(
  p_tenant_id        uuid,
  p_property_id      uuid,
  p_cam_year         integer,
  p_allocated_amount numeric,
  p_pro_rata_percent numeric,
  p_total_pool       numeric,
  p_amount_billed    numeric,
  p_balance_due      numeric,
  p_statement_json   jsonb,
  p_reconciliation_id uuid,
  p_source_run_hash  text,
  p_published_by     uuid
) returns public.tenant_statements
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev    public.tenant_statements;
  v_version integer;
  v_new     public.tenant_statements;
begin
  -- Lock the tenant-year so two concurrent publishes cannot both read version N.
  select * into v_prev
  from public.tenant_statements
  where tenant_id = p_tenant_id and cam_year = p_cam_year
  order by version desc
  limit 1
  for update;

  v_version := coalesce(v_prev.version, 0) + 1;

  -- Retire the live row first; the partial unique index would reject the insert
  -- otherwise, which is the backstop working as intended.
  update public.tenant_statements
     set status = 'superseded'
   where tenant_id = p_tenant_id
     and cam_year  = p_cam_year
     and status    = 'published';

  insert into public.tenant_statements (
    tenant_id, property_id, cam_year, version,
    allocated_amount, pro_rata_percent, total_pool,
    amount_billed, balance_due, statement_json,
    status, published_at
  ) values (
    p_tenant_id, p_property_id, p_cam_year, v_version,
    p_allocated_amount, p_pro_rata_percent, p_total_pool,
    p_amount_billed, p_balance_due, p_statement_json,
    'published', now()
  ) returning * into v_new;

  insert into public.tenant_statement_sources (
    statement_id, property_id, source_reconciliation_id,
    source_run_hash, published_by
  ) values (
    v_new.id, p_property_id, p_reconciliation_id,
    p_source_run_hash, p_published_by
  );

  if v_prev.id is not null then
    update public.tenant_statement_sources
       set superseded_by = v_new.id
     where statement_id = v_prev.id;
  end if;

  return v_new;
end $$;

revoke all    on function public.publish_tenant_statement(
  uuid, uuid, integer, numeric, numeric, numeric, numeric, numeric, jsonb, uuid, text, uuid
) from public, anon, authenticated;
grant  execute on function public.publish_tenant_statement(
  uuid, uuid, integer, numeric, numeric, numeric, numeric, numeric, jsonb, uuid, text, uuid
) to service_role;

comment on function public.publish_tenant_statement is
  'B2. Atomically supersedes the live statement for a tenant-year and publishes the next version. Performs NO authorization — api/tenant-publish-statement.js has already proven ownership. service_role only, deliberately.';

commit;
