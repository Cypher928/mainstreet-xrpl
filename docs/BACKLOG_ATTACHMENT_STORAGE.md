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

---

# BACKLOG — Focus the newly created activity

**Status:** open · **Raised:** Space workspace walkthrough · **After:** pilot

After recording an activity you land back at the top of the space and must find
the row on the timeline and click it before you can attach the photo already in
your hand. Small, but it is on the most common path.

I built this and reverted it: landing on the new record raced the panel state
(the deferred open could replace a picker the user had just opened) and I could
not verify it. `tenant-space.js` carries a note where the revert sits.

Revisit with a deterministic approach — resolve the new event id from
`appendPropertyTimelineEvent`'s return value and render the record view
directly, rather than closing and reopening the space on a timer.

---

# BACKLOG — "⚡ Act on this space": reframe as the record's payoff

**Status:** open · **Raised:** Space workspace review · **Recommendation:** keep, reframe, demote

## What it actually is

Not an action menu. `SpaceActions` is an **AI drafting surface grounded in the
verified record** — it serialises the space (lease terms, invoices, warranties,
service history, timeline) into a context block and drafts against it under a
strict system prompt: use only facts in the record, cite every claim to a named
item, list the supporting documents, and set `insufficient: true` rather than
guess.

One action is built — **Reply to tenant** — and four are registered as `available:
false`: draft landlord update, explain CAM charges, review warranty coverage,
maintenance summary.

## Why it does not compete with Add Activity

They run in opposite directions:

- **Add Activity** writes *to* the record — input.
- **Act on this space** reads *from* it and produces something — output.

It is the payoff for keeping the record well. Record the repair, and MainStreet
can draft a tenant reply that cites the actual invoice and the actual lease
clause. That is the product's whole argument, made concrete on one screen.

## Why it nonetheless feels like a rival

Presentation, not purpose:

1. **The label says nothing.** "Act on this space" reads as a generic action
   menu, so it looks like a second front door.
2. **Two gold primary buttons.** It has the same visual weight as Add Activity,
   which makes them look like alternatives rather than opposites.
3. **Four of five options are "soon".** A menu that is mostly disabled reads as
   unfinished rather than forthcoming.
4. **`review_warranty` is now stale** — standalone warranties were removed;
   warranty coverage belongs to a maintenance record.

## Recommendation — contextual action area, not a peer

- **Rename to what it does**: "Draft from this record" (or "Ask MainStreet about
  this space"). The verb should promise a document, not an unspecified action.
- **Demote visually** to a secondary control. One primary per screen, and on a
  Space that primary is Add Activity.
- **Show only what is built.** One working action is a feature; five where four
  are disabled is a roadmap. Replace the "soon" chips with a single quiet line.
- **Gate it on having a record.** With nothing recorded there is nothing to cite,
  and the strict prompt will correctly return `insufficient`. Disable it with the
  reason — "Record something about this space first; drafts cite the record" —
  which teaches the loop instead of producing an empty draft.
- **Retire `review_warranty`** or fold it into a maintenance summary.

Doing this makes the relationship legible: you put things in with Add Activity,
and you get things out with Draft from this record.
