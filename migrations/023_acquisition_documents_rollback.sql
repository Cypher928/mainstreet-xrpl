-- ============================================================================
-- 023_acquisition_documents_rollback.sql
-- ============================================================================
-- TARGET: PILOT PROJECT ONLY (bhmktujbxdbvdmpybmad).
--
-- Destroys every acquisition document row — the file names, the extracted text
-- and the pointers to the stored originals. The OBJECTS in the `leases` bucket
-- are NOT removed by this: they are addressed by path, and deleting them is a
-- separate, deliberate act. After a rollback those objects are unreferenced;
-- they are named `<uid>/acq_<reviewId>_<timestamp>-<file>` if they have to be
-- found again.
--
-- The application degrades honestly once this runs: /api/acquisition-documents
-- answers 503 with `code: 'migration_missing'` and the review says its
-- documents could not be filed, rather than appearing to have none.
--
-- Safe to re-run.

drop table if exists public.acquisition_documents cascade;

-- The unique constraint 023 added to the parent. Dropping it is safe — id is
-- the primary key, so nothing else depends on this pair being unique.
alter table public.acquisition_reviews
  drop constraint if exists acquisition_reviews_id_user_id_key;

-- Verify: both should return 0 rows.
--   select 1 from information_schema.tables
--    where table_schema = 'public' and table_name = 'acquisition_documents';
--   select 1 from pg_constraint where conname = 'acquisition_reviews_id_user_id_key';
