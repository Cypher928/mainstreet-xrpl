-- ─── SEC-1: make the document buckets private ────────────────────────────────
--
-- The `leases` and `invoices` buckets were created with public = true, so
-- api/upload.js returned /object/public/... URLs and every uploaded lease PDF
-- was retrievable by anyone holding one — no authentication, no expiry.
-- Commercial leases carry tenant names, rents, addresses, guarantors and
-- signatures. Row-level security protected the lease_documents ROW; nothing
-- protected the OBJECT.
--
-- ⚠ DEPLOY ORDER MATTERS. Deploy the application code BEFORE running this.
--    The code change adds /api/document-url, which mints a short-lived signed
--    URL after checking ownership, and routes the Evidence Viewer, lease modal
--    and Documents through it. Run this migration first and every stored
--    document stops loading until that code ships.
--
--    1. deploy the pilot branch
--    2. confirm a lease still opens in the Evidence Viewer
--    3. run this file
--    4. confirm a lease still opens (now via a signed URL)
--
-- Safe to re-run.
-- Run in Supabase: SQL Editor → New query → paste → Run.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. BEFORE — record what the buckets currently are.
--    Run this first, on its own, and keep the output. If anything needs to be
--    rolled back, this is what it rolls back to.
-- ─────────────────────────────────────────────────────────────────────────────
--   select id, name, public, file_size_limit, allowed_mime_types
--   from storage.buckets
--   where id in ('leases', 'invoices');

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Flip both buckets to private.
--    `public = false` stops /object/public/... from resolving. Objects remain
--    exactly where they are; only anonymous readability changes.
-- ─────────────────────────────────────────────────────────────────────────────
update storage.buckets
   set public = false
 where id in ('leases', 'invoices');

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Object-level policies.
--
--    api/upload.js writes every object to `${user.id}/${safeName}`, so the
--    first path segment IS the owner and the policy can say so exactly.
--    storage.foldername(name) returns the path segments as an array; [1] is
--    the first (PostgreSQL arrays are 1-indexed).
--
--    These policies govern DIRECT client access with a user JWT. The
--    application does not currently use that path — uploads and signing both
--    go through the service role in api/ — but they are the correct backstop:
--    if a future client talks to storage directly, it is already constrained,
--    and if the service-role key ever leaks the blast radius is unchanged
--    rather than made worse by a permissive policy.
-- ─────────────────────────────────────────────────────────────────────────────
alter table storage.objects enable row level security;

drop policy if exists "docs_owner_read"   on storage.objects;
drop policy if exists "docs_owner_insert" on storage.objects;
drop policy if exists "docs_owner_update" on storage.objects;
drop policy if exists "docs_owner_delete" on storage.objects;

create policy "docs_owner_read"
  on storage.objects for select
  to authenticated
  using (
    bucket_id in ('leases', 'invoices')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "docs_owner_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id in ('leases', 'invoices')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "docs_owner_update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id in ('leases', 'invoices')
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id in ('leases', 'invoices')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "docs_owner_delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id in ('leases', 'invoices')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Deliberately NO policy for the `anon` role. Absence of a policy under RLS is
-- a denial, which is the whole point of this migration.

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. AFTER — verify. Both rows must read public = false.
-- ─────────────────────────────────────────────────────────────────────────────
--   select id, name, public from storage.buckets where id in ('leases','invoices');
--
--   select policyname, cmd, roles
--   from pg_policies
--   where schemaname = 'storage' and tablename = 'objects'
--   order by policyname;
--
-- And the check that actually matters, from a terminal with no credentials —
-- it must NOT return the PDF:
--
--   curl -sI "https://<project>.supabase.co/storage/v1/object/public/leases/<uid>/<file>.pdf"
--
-- Expect 400 or 404. A 200 means the bucket is still public.

-- ─── Rollback ────────────────────────────────────────────────────────────────
-- Only if step 2 of the deploy order was missed and documents must load again
-- immediately. This RE-OPENS every lease to anonymous access — it is an outage
-- workaround, not a resting state.
--   update storage.buckets set public = true where id in ('leases','invoices');
