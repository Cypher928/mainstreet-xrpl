-- ============================================================================
-- 018_tenant_documents_rollback.sql
-- ============================================================================
-- Drops the document projection and its companion. DESTRUCTIVE: loses which
-- files had been shared with which tenant. No file is deleted from storage and
-- lease_documents is untouched — this only removes the sharing records.
--
-- TARGET: PILOT PROJECT ONLY (bhmktujbxdbvdmpybmad).
-- ============================================================================
begin;

do $$
begin
  if not exists (select 1 from public.properties where id = 'fd9c09b1-b657-4c58-9999-c3cce28e7600') then
    raise exception 'REFUSING TO RUN: pilot marker property not found.';
  end if;
end $$;

drop table if exists public.tenant_document_sources;
drop table if exists public.tenant_documents;

commit;
