-- ─── lease_documents migration (Phase 22A) ──────────────────────────────────
-- Persists OCR/extracted lease text after the extraction pipeline completes.
-- One row per uploaded lease file per property. Tenant association is optional
-- (some uploads may not yield a recognized tenant until after review).
--
-- Run once in Supabase: Settings → SQL Editor → New query → paste → Run.
-- Safe to re-run (IF NOT EXISTS / OR REPLACE / DROP IF EXISTS throughout).
-- Rollback: drop table public.lease_documents cascade;

-- ── Table ──────────────────────────────────────────────────────────────────────

create table if not exists public.lease_documents (
  id                uuid        primary key default gen_random_uuid(),
  property_id       uuid        not null references public.properties(id) on delete cascade,
  tenant_id         uuid,                         -- references tenant row UUID (nullable until confirmed)
  tenant_name       text,                         -- denormalized for display without join
  file_name         text        not null,
  file_url          text,                         -- Supabase storage public URL
  extracted_text    text,                         -- full OCR / PDF text layer
  parsing_status    text        not null default 'pending',  -- pending | success | partial | failed
  extraction_model  text,                         -- e.g. 'claude-3-5-sonnet-20241022'
  used_pdf_direct   boolean     not null default false,      -- true = vision path, false = text path
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- ── Indexes ────────────────────────────────────────────────────────────────────

create index if not exists lease_docs_property_id_idx
  on public.lease_documents (property_id);

create index if not exists lease_docs_property_tenant_idx
  on public.lease_documents (property_id, tenant_id)
  where tenant_id is not null;

create index if not exists lease_docs_created_at_idx
  on public.lease_documents (created_at desc);

-- ── Row-Level Security ─────────────────────────────────────────────────────────

alter table public.lease_documents enable row level security;

grant usage  on schema public to authenticated;
grant usage  on schema public to service_role;
grant select, insert, update, delete on public.lease_documents to authenticated;
grant select, insert, update, delete on public.lease_documents to service_role;

-- POLICIES
-- Owner access scoped via properties.user_id — same pattern as cam_reconciliations.
-- API proxy uses service_role and bypasses RLS. Direct authenticated-client access
-- (e.g. Lease Center) uses the owner policy without leaking other users' documents.

drop policy if exists "lease_docs_owner_all"        on public.lease_documents;
drop policy if exists "lease_docs_service_role_all" on public.lease_documents;

create policy "lease_docs_owner_all"
  on public.lease_documents
  for all to authenticated
  using (
    property_id in (
      select id from public.properties
      where user_id = auth.uid()
    )
  )
  with check (
    property_id in (
      select id from public.properties
      where user_id = auth.uid()
    )
  );

create policy "lease_docs_service_role_all"
  on public.lease_documents
  for all to service_role using (true) with check (true);

-- ── updated_at trigger ─────────────────────────────────────────────────────────

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists lease_documents_updated_at on public.lease_documents;
create trigger lease_documents_updated_at
  before update on public.lease_documents
  for each row execute function public.set_updated_at();

-- ── Verify ─────────────────────────────────────────────────────────────────────

select count(*) from public.lease_documents;
