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

---

# BACKLOG — Linked CAM impact

**Status:** open · **Raised:** after the Space workspace walkthrough

An activity should be able to show what it *cost the property*, not just what
happened. A roof repair is the start of a chain:

    Roof repair (space activity)
      └─ Vendor invoice
           └─ CAM allocation
                └─ Tenant statements
                     └─ Dispute

Today each link exists but nothing joins them: the repair lives on the space
timeline, the invoice in the CAM invoice register, the allocation in the
reconciliation, the statement in Reports, and a dispute in the dispute
workspace. A manager asked "what did the roof cost us, and who paid for it?"
has to reassemble that by memory.

The event model already carries the hooks — `relatedInvoiceIds`,
`relatedDisputeIds` and `relatedEvidenceIds` are on every timeline entry and
are currently unused for this. The work is to populate them and render a
"CAM impact" block on the activity record:

- link a vendor invoice recorded on an activity into the CAM invoice register
  rather than duplicating it
- once a reconciliation runs, show which tenants absorbed the cost and at what
  share, read from the allocation, never recomputed
- link forward to the statements it appeared on and any dispute it triggered
- never imply a link that is not there: if the invoice was not included in a
  reconciliation, say so

This is what turns the Space from a record of what happened into an
explanation of what it cost.
