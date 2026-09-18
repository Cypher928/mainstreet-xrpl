-- ─── 029_financial_tables — Phase 0, P0.3 ───────────────────────────────────
--
-- TABLES ONLY. Phase 1 files financial documents — rent rolls, general ledger
-- exports, operating statements (T-12, P&L), budgets — into the register
-- (025) and records a financial_sources stub for each: which document, what
-- kind, what period was detected. Phase 2 parses them: gl-import.js (lifted
-- from script.js in P0.7) writes gl_entries; the rent-roll and statement
-- extractors fill financial_sources.extracted. Nothing in Phase 1 reads a
-- number out of either table, and the Financials tab says so.
--
-- WHY THEY SHIP NOW
--   So S2 can file a GL export against a foreign key that exists, instead of
--   inventing a blob field that would have to be migrated later. The existing
--   CAM-tab GL import (rows → invoices, session-only glData) is unchanged;
--   the ledger path is additive.
--
-- ONE SOURCE OF TRUTH
--   financial_sources.document_id → the register row. The file, its text and
--   its classification live there; this table holds only what a FINANCIAL
--   reading of that document produced.
--   gl_entries.source_id → the financial_sources row it was parsed from, and
--   source_document_id → the register row, so a ledger line can always be
--   traced to the export it came from. row_hash is unique per property so a
--   re-import is idempotent rather than duplicating.
--   mapped_category is free text; the category vocabulary (GL_CAT_KEYWORDS,
--   lifted with the parser in P0.7) is owned by gl-import.js.
--
-- RLS: owner OR active member (024): select + insert. No update or delete
-- policy for members in Phase 0; Phase 2 decides what a re-import may do.
--
-- PILOT ONLY. Same marker guard. Idempotent. Rollback: 029_financial_tables_rollback.sql.

begin;

do $$
begin
  if not exists (
    select 1 from public.properties
    where id = 'fd9c09b1-b657-4c58-9999-c3cce28e7600'
  ) then
    raise exception
      'REFUSING TO RUN: pilot marker property not found. This does not appear to be the pilot project (bhmktujbxdbvdmpybmad). 029 must never be applied to production.';
  end if;
end $$;

-- ── financial_sources ──────────────────────────────────────────────────────
create table if not exists public.financial_sources (
  id                uuid        primary key default gen_random_uuid(),
  property_id       uuid        not null references public.properties(id) on delete cascade,
  kind              text        not null
                      check (kind in ('rent_roll', 'general_ledger', 'operating_statement', 'budget', 't12')),
  document_id       uuid        references public.lease_documents(id) on delete set null,
  period_start      date,
  period_end        date,
  period_label      text,
  extraction_status text        not null default 'filed'
                      check (extraction_status in ('filed', 'extracted', 'failed')),
  extracted         jsonb       not null default '{}'::jsonb,
  created_by        uuid        references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint financial_sources_period_order check (period_start is null or period_end is null or period_start <= period_end)
);

comment on table public.financial_sources is
  'P0.3: one filed financial document (rent roll, GL export, operating statement, budget, T-12) and what a financial reading of it produced. Phase 1 writes the stub (kind, document, period); Phase 2 fills extracted.';
comment on column public.financial_sources.document_id is
  'P0.3: the document register row (lease_documents) this source was filed from. The file, its text and its classification live there.';

create index if not exists financial_sources_property_idx on public.financial_sources (property_id, kind);
create index if not exists financial_sources_document_idx on public.financial_sources (document_id) where document_id is not null;

drop trigger if exists financial_sources_updated_at on public.financial_sources;
create trigger financial_sources_updated_at
  before update on public.financial_sources
  for each row execute function public.set_updated_at();

-- ── gl_entries ─────────────────────────────────────────────────────────────
create table if not exists public.gl_entries (
  id                 uuid           primary key default gen_random_uuid(),
  property_id        uuid           not null references public.properties(id) on delete cascade,
  source_id          uuid           references public.financial_sources(id) on delete set null,
  source_document_id uuid           references public.lease_documents(id) on delete set null,
  period_start       date,
  period_end         date,
  account_code       text,
  account_name       text,
  description        text,
  vendor             text,
  debit              numeric(14,2)  check (debit  is null or debit  >= 0),
  credit             numeric(14,2)  check (credit is null or credit >= 0),
  amount             numeric(14,2),
  mapped_category    text,
  confidence         integer        check (confidence is null or confidence between 0 and 100),
  row_hash           text           not null,
  created_at         timestamptz    not null default now(),
  constraint gl_entries_period_order check (period_start is null or period_end is null or period_start <= period_end),
  constraint gl_entries_row_hash_uniq unique (property_id, row_hash)
);

comment on table public.gl_entries is
  'P0.3: the general ledger as a ledger — one row per GL line, traceable to the export it came from. Empty until Phase 2; the CAM-tab GL-to-invoices import is unchanged and separate.';
comment on column public.gl_entries.row_hash is
  'P0.3: a hash of the source row, unique per property, so a re-import is idempotent.';
comment on column public.gl_entries.mapped_category is
  'P0.3: the category the parser mapped the line to. The vocabulary is owned by gl-import.js, not duplicated here.';

create index if not exists gl_entries_property_period_idx on public.gl_entries (property_id, period_start, period_end);
create index if not exists gl_entries_source_idx          on public.gl_entries (source_id) where source_id is not null;
create index if not exists gl_entries_category_idx        on public.gl_entries (property_id, mapped_category);

-- ── RLS ────────────────────────────────────────────────────────────────────
alter table public.financial_sources enable row level security;
alter table public.gl_entries        enable row level security;

revoke all on public.financial_sources from public, anon;
revoke all on public.gl_entries        from public, anon;
grant select, insert on public.financial_sources to authenticated;
grant select, insert on public.gl_entries        to authenticated;
grant all on public.financial_sources to service_role;
grant all on public.gl_entries        to service_role;

drop policy if exists financial_sources_member_select     on public.financial_sources;
drop policy if exists financial_sources_member_insert     on public.financial_sources;
drop policy if exists financial_sources_service_role_all  on public.financial_sources;
drop policy if exists gl_entries_member_select            on public.gl_entries;
drop policy if exists gl_entries_member_insert            on public.gl_entries;
drop policy if exists gl_entries_service_role_all         on public.gl_entries;

create policy financial_sources_member_select on public.financial_sources
  for select to authenticated
  using (property_id in (select public.member_property_ids()));
create policy financial_sources_member_insert on public.financial_sources
  for insert to authenticated
  with check (property_id in (select public.member_property_ids()));
create policy financial_sources_service_role_all on public.financial_sources
  for all to service_role using (true) with check (true);

create policy gl_entries_member_select on public.gl_entries
  for select to authenticated
  using (property_id in (select public.member_property_ids()));
create policy gl_entries_member_insert on public.gl_entries
  for insert to authenticated
  with check (property_id in (select public.member_property_ids()));
create policy gl_entries_service_role_all on public.gl_entries
  for all to service_role using (true) with check (true);

commit;

-- ── Verify (run after commit) ──────────────────────────────────────────────
-- select count(*) from public.financial_sources;   -- expect 0
-- select count(*) from public.gl_entries;          -- expect 0
-- select has_table_privilege('anon', 'public.gl_entries', 'select');              -- expect false
-- select has_table_privilege('authenticated', 'public.gl_entries', 'delete');     -- expect false
-- select policyname, cmd from pg_policies where tablename in ('financial_sources','gl_entries') order by 1;
