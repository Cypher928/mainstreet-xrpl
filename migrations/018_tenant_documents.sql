-- ============================================================================
-- 018_tenant_documents.sql — B2: documents a landlord has shared with a tenant
-- ============================================================================
-- TARGET: PILOT PROJECT ONLY (bhmktujbxdbvdmpybmad).
-- NEVER apply to production (zhsuhehgehbzkmzurzyf).
--
-- WHY NOT lease_documents.tenant_visible
-- --------------------------------------
-- The original Phase B plan proposed adding a boolean to lease_documents and a
-- tenant read policy beside it. That cannot hold: RLS filters rows, not columns,
-- so a tenant policy on lease_documents exposes every column of a visible row —
-- including extracted_text, which is the entire parsed lease, plus file_url,
-- parsing_status and extraction_model.
--
-- lease_documents therefore keeps exactly the two policies it has today and
-- gains no tenant access. A shared document is a new row here instead, carrying
-- only what a tenant should see, with its storage location in the companion.
--
-- The tenant never learns where a file lives. It asks for a document by this
-- table's id at POST /api/tenant-document-url, which re-checks membership and
-- status server-side and returns a short-lived signed URL.
-- api/document-url.js is untouched: its path.split('/')[0] === user.id rule can
-- never pass for a tenant, and widening it would weaken the landlord's path.
--
-- Rollback: migrations/018_tenant_documents_rollback.sql
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

create table if not exists public.tenant_documents (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null,
  property_id  uuid not null,

  title        text not null,
  doc_kind     text not null
                 check (doc_kind in ('lease','statement','invoice','notice','other')),
  content_type text,
  byte_size    bigint check (byte_size is null or byte_size >= 0),

  status       text not null default 'draft'
                 check (status in ('draft','published','withdrawn')),
  published_at timestamptz,
  created_at   timestamptz not null default now(),

  constraint tenant_documents_tenant_property_fk
    foreign key (tenant_id, property_id)
    references public.tenants(id, property_id) on delete cascade,
  constraint tenant_documents_publish_complete check (
    status <> 'published' or published_at is not null
  )
);

comment on table public.tenant_documents is
  'B2 projection. A file the landlord has published to one tenant. Carries display metadata only; the storage location lives in tenant_document_sources and is never tenant-readable.';

-- ── Companion: where the file actually is. Landlord only. ──────────────────
create table if not exists public.tenant_document_sources (
  document_id       uuid primary key
                      references public.tenant_documents(id) on delete cascade,
  property_id       uuid not null,
  storage_path      text not null,
  storage_bucket    text,
  lease_document_id uuid references public.lease_documents(id) on delete set null,
  statement_id      uuid references public.tenant_statements(id) on delete set null,
  published_by      uuid references auth.users(id),
  created_at        timestamptz not null default now()
);

comment on table public.tenant_document_sources is
  'B2 companion. Storage location and provenance for a shared document. NO TENANT POLICY — zero rows for a tenant by construction. Read only by the landlord and by api/tenant-document-url.js with the service role.';

create index if not exists tenant_documents_tenant_idx
  on public.tenant_documents(tenant_id) where status = 'published';
create index if not exists tenant_documents_property_idx
  on public.tenant_documents(property_id);
create index if not exists tenant_document_sources_property_idx
  on public.tenant_document_sources(property_id);

-- ── RLS ────────────────────────────────────────────────────────────────────
alter table public.tenant_documents        enable row level security;
alter table public.tenant_document_sources enable row level security;

revoke all on public.tenant_documents        from anon;
revoke all on public.tenant_document_sources from anon;

create policy tenant_documents_tenant_select on public.tenant_documents
  for select to authenticated
  using (
    tenant_id in (select public.tenant_ids_for_current_user())
    and status = 'published'
  );

create policy tenant_documents_landlord_all on public.tenant_documents
  for all to authenticated
  using      (property_id in (select p.id from public.properties p where p.user_id = auth.uid()))
  with check (property_id in (select p.id from public.properties p where p.user_id = auth.uid()));

create policy tenant_documents_service_role_all on public.tenant_documents
  for all to service_role using (true) with check (true);

create policy tenant_document_sources_landlord_all on public.tenant_document_sources
  for all to authenticated
  using      (property_id in (select p.id from public.properties p where p.user_id = auth.uid()))
  with check (property_id in (select p.id from public.properties p where p.user_id = auth.uid()));

create policy tenant_document_sources_service_role_all on public.tenant_document_sources
  for all to service_role using (true) with check (true);

commit;
