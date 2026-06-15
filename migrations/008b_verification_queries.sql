-- ─── 008b_verification_queries.sql ───────────────────────────────────────────
-- Verification queries to run BEFORE applying Fixes 2, 3, and 4.
-- These are READ-ONLY. Run in Supabase SQL Editor and review results.
-- Do NOT apply the schema changes below until each verification passes.
-- ─────────────────────────────────────────────────────────────────────────────


-- ═══════════════════════════════════════════════════════════════════════════════
-- FIX 2 VERIFICATION: cam_reconciliations unique constraint
-- (DB-H4: no unique constraint on property_id + tenant_id + year)
-- ═══════════════════════════════════════════════════════════════════════════════

-- Step 2-A: Check for duplicate (property_id, tenant_id, year) combinations.
-- Must return 0 rows before adding the unique constraint.
-- If rows are returned, run the dedup DELETE below (Step 2-B) first.

select
  property_id,
  tenant_id,
  year,
  count(*)            as duplicate_count,
  min(created_at)     as oldest_row,
  max(created_at)     as newest_row
from public.cam_reconciliations
group by property_id, tenant_id, year
having count(*) > 1
order by duplicate_count desc;
-- PASS condition: 0 rows returned.


-- Step 2-B: Dedup DELETE (run ONLY if Step 2-A returns rows).
-- Keeps the newest row per (property_id, tenant_id, year); deletes all others.
-- Preview first — comment out the DELETE, run as SELECT to see what would be deleted:

/*
delete from public.cam_reconciliations
where id not in (
  select distinct on (property_id, tenant_id, year) id
  from public.cam_reconciliations
  order by property_id, tenant_id, year, created_at desc
);
*/


-- Step 2-C: Also check for (property_id, year) duplicates where tenant_id IS NULL.
-- cam_reconciliations.tenant_id is nullable — null rows must also be deduplicated.

select
  property_id,
  year,
  count(*)        as null_tenant_rows
from public.cam_reconciliations
where tenant_id is null
group by property_id, year
having count(*) > 1;
-- PASS condition: 0 rows returned.


-- Step 2-D: Schema change — apply ONLY after Steps 2-A and 2-C both pass.
-- NOTE: tenant_id is nullable, so the unique constraint must use NULLS NOT DISTINCT
-- (PostgreSQL 15+) or a partial index to handle null tenant_id values correctly.
-- If on PostgreSQL < 15, use a partial index approach (see comment).

/*
-- PostgreSQL 15+ (NULLS NOT DISTINCT):
alter table public.cam_reconciliations
  add constraint cam_recon_unique_per_tenant_year
  unique nulls not distinct (property_id, tenant_id, year);

-- PostgreSQL < 15 (two partial indexes instead):
create unique index cam_recon_unique_with_tenant
  on public.cam_reconciliations (property_id, tenant_id, year)
  where tenant_id is not null;

create unique index cam_recon_unique_null_tenant
  on public.cam_reconciliations (property_id, year)
  where tenant_id is null;
*/

-- Step 2-E: After adding the constraint, update saveCamResults() in script.js
-- to use upsert instead of delete+insert:
--   db.from('cam_reconciliations')
--     .upsert(rows, { onConflict: 'property_id,tenant_id,year' })
-- Remove the pre-delete try/catch block.


-- ═══════════════════════════════════════════════════════════════════════════════
-- FIX 3 VERIFICATION: cam_reconciliations.tenant_id foreign key
-- (DB-H2: tenant_id UUID with no FK constraint — orphaned rows on tenant delete)
-- ═══════════════════════════════════════════════════════════════════════════════

-- Step 3-A: Count orphaned cam_reconciliation rows (tenant_id references a
-- deleted or non-existent tenant). Must return 0 before adding the FK.

select count(*) as orphaned_cam_rows
from public.cam_reconciliations c
where c.tenant_id is not null
  and not exists (
    select 1 from public.tenants t where t.id = c.tenant_id
  );
-- PASS condition: 0 rows.


-- Step 3-B: Preview orphaned rows (which properties/years are affected).
-- Run this if Step 3-A returns > 0 to understand scope before fixing.

select
  c.property_id,
  c.tenant_id,
  c.tenant_name,
  c.year,
  c.created_at
from public.cam_reconciliations c
where c.tenant_id is not null
  and not exists (
    select 1 from public.tenants t where t.id = c.tenant_id
  )
order by c.created_at desc
limit 50;


-- Step 3-C: Null out orphaned references (run ONLY if Step 3-A returns > 0).
-- This sets tenant_id = NULL on orphaned rows, preserving the historical record
-- while allowing the FK to be added.

/*
update public.cam_reconciliations
set tenant_id = null
where tenant_id is not null
  and not exists (
    select 1 from public.tenants t where t.id = tenant_id
  );
*/


-- Step 3-D: Schema change — apply ONLY after Step 3-A passes (or after 3-C runs).

/*
alter table public.cam_reconciliations
  add constraint cam_recon_tenant_id_fk
  foreign key (tenant_id)
  references public.tenants(id)
  on delete set null;
*/


-- ═══════════════════════════════════════════════════════════════════════════════
-- FIX 4 VERIFICATION: lease_documents.tenant_id foreign key
-- (DB-H2: same issue as cam_reconciliations — no FK on tenant_id)
-- ═══════════════════════════════════════════════════════════════════════════════

-- Step 4-A: Count orphaned lease_document rows.

select count(*) as orphaned_doc_rows
from public.lease_documents d
where d.tenant_id is not null
  and not exists (
    select 1 from public.tenants t where t.id = d.tenant_id
  );
-- PASS condition: 0 rows.


-- Step 4-B: Preview orphaned rows.

select
  d.property_id,
  d.tenant_id,
  d.tenant_name,
  d.file_name,
  d.created_at
from public.lease_documents d
where d.tenant_id is not null
  and not exists (
    select 1 from public.tenants t where t.id = d.tenant_id
  )
order by d.created_at desc
limit 50;


-- Step 4-C: Null out orphaned references (run ONLY if Step 4-A returns > 0).

/*
update public.lease_documents
set tenant_id = null
where tenant_id is not null
  and not exists (
    select 1 from public.tenants t where t.id = tenant_id
  );
*/


-- Step 4-D: Schema change — apply ONLY after Step 4-A passes (or after 4-C runs).

/*
alter table public.lease_documents
  add constraint lease_docs_tenant_id_fk
  foreign key (tenant_id)
  references public.tenants(id)
  on delete set null;
*/


-- ═══════════════════════════════════════════════════════════════════════════════
-- COMBINED HEALTH CHECK
-- Run any time to get a snapshot of data integrity across all three areas.
-- ═══════════════════════════════════════════════════════════════════════════════

select
  -- Fix 2: cam_reconciliations duplicates
  (select count(*) from (
    select property_id, tenant_id, year
    from public.cam_reconciliations
    group by property_id, tenant_id, year
    having count(*) > 1
  ) dup)                                                                    as cam_recon_duplicates,

  -- Fix 3: orphaned cam_reconciliations rows
  (select count(*) from public.cam_reconciliations c
   where c.tenant_id is not null
     and not exists (select 1 from public.tenants t where t.id = c.tenant_id)
  )                                                                          as cam_recon_orphans,

  -- Fix 4: orphaned lease_documents rows
  (select count(*) from public.lease_documents d
   where d.tenant_id is not null
     and not exists (select 1 from public.tenants t where t.id = d.tenant_id)
  )                                                                          as lease_doc_orphans,

  -- Bonus: total rows in each table
  (select count(*) from public.cam_reconciliations)                         as cam_recon_total,
  (select count(*) from public.lease_documents)                             as lease_docs_total,
  (select count(*) from public.tenant_field_evidence)                       as tfe_total,
  (select count(*) from public.tenant_review_audit)                         as tra_total;

-- Target: cam_recon_duplicates=0, cam_recon_orphans=0, lease_doc_orphans=0
