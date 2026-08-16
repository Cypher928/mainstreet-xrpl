-- ============================================================================
-- 017_tenant_statements_rollback.sql
-- ============================================================================
-- Drops the statement projection, its companion and the publish RPC.
--
-- DESTRUCTIVE, AND MORE SO THAN THE OTHER TWO: published statements are what a
-- tenant was actually shown, including their revision history. Dump the table
-- before running this if any statement has been published to a real tenant.
-- Nothing in cam_reconciliations is affected — the source figures survive and a
-- statement can be republished from them.
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

drop function if exists public.publish_tenant_statement(
  uuid, uuid, integer, numeric, numeric, numeric, numeric, numeric, jsonb, uuid, text, uuid
);

-- tenant_document_sources references tenant_statements(id); drop that FK first
-- so this rollback does not fail when 018 is still applied.
alter table if exists public.tenant_document_sources
  drop constraint if exists tenant_document_sources_statement_id_fkey;

drop table if exists public.tenant_statement_sources;
drop table if exists public.tenant_statements;

commit;
