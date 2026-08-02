# BACKLOG — Migrate space attachments to Supabase Storage

**Status:** open · **Raised:** during the Pilot Readiness Sprint · **Blocks:** production scaling (not the pilot)

## The shortcut we took, deliberately

Add Activity (`tenant-space.js`) stores attachments **inline as base64 data URLs**
inside the timeline event, which lives in `properties.data` — a single JSON blob.

That was chosen so a pilot customer's photos survive a reload with no storage
bucket wired up. It is the right call for the pilot and the wrong one for
production.

Current guard rails:

- files over **1.2MB** are not inlined; their metadata is recorded and the
  attachment is flagged `oversize`, so nothing silently vanishes
- `MAX_INLINE_BYTES` in `tenant-space.js` is the single place that limit lives

## Why this must not become permanent

- **Every save rewrites every photo.** `properties.data` is written whole on each
  `saveProperty()`, so one 1MB image is re-uploaded on every subsequent edit to
  anything on that property.
- **Base64 costs ~33% overhead** on top of the original file.
- **Postgres row limits.** A busy suite — move-in, move-out, a dozen repairs —
  will approach the practical size of a single jsonb column.
- **No CDN, no thumbnails, no range requests.** Every photo is fetched in full
  as part of the property payload, before anything renders.
- **Nothing is deduplicated**, and deleting an activity does not reclaim space
  in any meaningful way.

A pilot property with a handful of suites is fine. Fifty properties with photo
histories is not.

## What the migration needs

1. A private `space-attachments` bucket, RLS-scoped to the owning user, laid out
   `{userId}/{propertyId}/{tenantId}/{uuid}-{filename}`.
2. Upload on submit; store `{ name, kind, size, mime, path }` on the event and
   **stop storing `url`**.
3. Signed URLs on read, generated when the space is opened.
4. A one-time backfill that walks existing timeline events, uploads any
   `url.startsWith('data:')` attachment, and rewrites it to a `path`.
5. Delete-on-remove, so orphaned objects do not accumulate.
6. Thumbnails for the Photos section — full images should not be fetched to
   render a grid.

## How to find every affected place

    grep -n "MAX_INLINE_BYTES\|readAsDataURL" tenant-space.js
    grep -rn "attachments" tenant-space.js script.js

`test-space-activity.js` covers the current behaviour and should be extended,
not replaced, when the storage path lands — the assertions about scoping,
categorisation and provenance hold either way.
