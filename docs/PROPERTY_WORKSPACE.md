# Property Workspace

**Status:** 🧊 FROZEN pending Christy's walkthrough — bug fixes only, no new
work. See the freeze notice at the top of `PILOT_ACCEPTANCE_CHECKLIST.md`.
First increment SHIPPED. Property Records, building-level
categories, the Building System subject, and provenance are in.
**Walked by:** `test-property-workspace.js` (28 checks).
**Not yet done:** the Mortgage/Financing link to the escrow engine, and an
archived property's workspace — see "Still open" below.

The Space workspace made a suite the operational record for a tenancy. This does
the same for the building itself — and reuses that implementation rather than
growing a second one beside it.

---

## The rule that governs everything else

**No parallel data stores.** A property activity is a property-scoped timeline
event, full stop. The Property Timeline stays the single verified history for
the building, exactly as `TenantSpace` records are the single history for a
suite.

This is not a preference about tidiness. Every category below is a *filter over
one timeline*, not a screen with its own storage. The moment "Insurance" gets
its own array, three things follow that have already cost us time elsewhere: the
timeline stops being complete, two places disagree about what happened, and a
reconciliation or property switch clears one of them and not the other.

*Violation shape:* a new `prop.insurance = []`, `prop.taxes = []`, or a category
that renders from anything except the timeline.

## What already exists — read this before designing anything

Surveying `property-os.js` before starting changes the shape of this work. The
subject-scoped timeline model is **already implemented**; what is missing is the
surface over it, not the storage under it.

- **`PropertyOS.BUILDING_SYSTEMS`** (`property-os.js:43`) — eight shared physical
  assets already defined: Roof, Parking Lot, HVAC, Fire Suppression,
  Landscaping, Electrical, Plumbing, Other/Shared. Exported, with a
  `systemLabel()` lookup.
- **Timeline events already carry a subject**: `e.subject = { type, id }`, where
  type is `property`, `system`, or a space/tenant. The Building Systems grid
  counts records per system by reading exactly that
  (`e.subject.type === 'system' && e.subject.id === s.key`).
- **Property documents already derive from the timeline** — files are collected
  from events whose subject is the property or a system, not from a document
  store.

So the no-parallel-stores rule is not an aspiration to implement; it is the
model already in place, and the risk is a new category quietly departing from
it. A warranty is a timeline event with `subject: { type: 'system', id: 'roof' }`
and nothing more. The existing systems grid will count it without being told.

This makes the Property Workspace mostly an information-architecture problem:
one Property Records surface, categories as a filter, `➕ Add Activity` writing
subject-scoped timeline events. Very little new persistence should be needed —
and needing some is a signal to re-read this section before writing it.

Categories are a **filter**, not separate screens — one Property Records surface
with a category selector, the same shape as the Space workspace's Add Activity.

- Real Estate Taxes
- Insurance
- Mortgage / Financing
- Surveys
- Site Plans
- Building Plans
- Environmental Reports
- Capital Improvements
- Building Photos
- Warranties — as part of **Building Systems**, not as a loose category

Two of these carry existing work that must be reused, not re-implemented:

- **Mortgage / Financing** overlaps the escrow/reserve engine
  (`escrow-reserve-engine.js`, `escrow-draw-packets.js`), which already extracts
  and cites mortgage terms. Financing records should surface those, not
  re-extract them.
- **Warranties** were deliberately removed from the Space activity types during
  the pilot freeze, on the grounds that a warranty belongs to the building
  system rather than the tenancy. They come back as part of Building Systems —
  a warranty is recorded against Roof or HVAC, and is found by opening that
  system. A warranty with no system is the shape to reject in review.

## What carries over from Spaces, unchanged

Settled patterns. Reuse them; do not re-decide them.

- **`➕ Add Activity` as the centrepiece**, with a type picker and a form per
  type. Every submission creates a timeline event and files its attachments into
  the right section automatically.
- **Append-only revisions.** Records are amended, never mutated in place;
  `event.revisions[]` keeps the original and the history of how it evolved.
  (ARCHITECTURE_PRINCIPLES §6.)
- **Provenance on every record** — who created it and when.
- **Related Items**, so a roof repair is one thing rather than six.
- **Empty states that say what to record**, not blank panels.

## Open questions — to answer before building, not during

1. **Does a category need anything beyond `subject` + a category field?** The
   subject model already exists and already distinguishes property-wide from
   system-scoped. The default answer is no: a property activity is a timeline
   event with `subject: { type: 'property' | 'system', id }` and a category.
   Anything more needs a reason.
2. **Do categories need per-category fields?** Taxes have an assessment year and
   amount; a site plan has a revision date and little else. Either one form with
   optional fields, or a per-category form like the Space activity types. The
   Space pattern already solved this; follow it.
3. **What does an archived property's workspace show?** It must stay readable —
   archiving preserves history, and history you cannot open is not preserved.
4. **Does a property record ever become evidence?** Spaces gate "Draft from this
   record" on real activity. The equivalent question here is whether an
   environmental report or survey can be cited in a reconciliation, and if so,
   through the same Evidence Viewer path.

## Related Items — the relationship model (shipped)

A roof replacement is one story, not six records: the job, the warranty, the
contractor invoice, the photos, the inspection, and the insurance claim.

**Storage** is a single `relatedTo` array on the timeline event, holding
`{ kind: 'event' | 'invoice', id }`. No join table, no link store — the same
rule as everywhere else here.

**Direction:** links are stored ONE way and read UNDIRECTED. Storing both ends
means keeping two copies in step, and the copy that drifts is the one nobody
looks at. The reverse costs a scan of the timeline, which at property scale is
nothing.

**Shape:** the story is the CONNECTED COMPONENT, not the immediate neighbours.
If the warranty links to the invoice and the invoice links to the job, opening
the warranty must still show the whole job — otherwise "one connected story" is
only true when you happen to start at the anchor. BFS with a visited set, so a
cycle terminates rather than hangs.

**Linking is an amendment.** Who connected the invoice to the roof job, and
when, is in `revisions[]` like every other change. The connective tissue is not
the one part of the record without provenance.

**Clicking a Building System ends the search.** "Roof" shows records whose
subject is the system, plus invoices tagged to it, plus anything linked into
those stories — an invoice attached to the roof job belongs under Roof even if
only the job carries the tag.

## Documents — a view of records (shipped)

Documents is **not a repository**. A document is an attachment on a record: the
roof warranty PDF belongs to the roof job, not to a folder that mentions roofs.
`propertyDocuments()` derives every file FROM the records that hold it, so each
row carries `recordId` and can open it — a file chip that cannot say which
record it sits on is a link into nowhere.

The flat scrape that used to build this section is gone. It collected files from
the timeline and the invoice register into one list with no idea where each came
from, which is precisely the flat document repository this workspace must not
be.

**Files get in one way: by being attached to a record.** 📎 Attach on the record
uploads and amends, so the history says who attached what and when. A failed
upload is reported and changes nothing — partial success keeps the files that
did upload and names the ones that did not.

Reference samples (seeded demo property only) are rendered visibly apart, under
a heading saying they are examples rather than records on this property. A
preview must never be mistakable for something on file.

## Still open

The first increment deliberately stopped at the surface. What remains:

1. **Mortgage / Financing** should surface what `escrow-reserve-engine.js`
   already extracted and cited, rather than being a category a user types into.
2. **Archived property's workspace** — must stay readable. Not yet walked.
3. **Records as evidence** — whether a survey or environmental report can be
   cited in a reconciliation through the Evidence Viewer.

## Acceptance

Walked as a property manager, not asserted from component tests.

- ☑ Every category is reachable from one Property Records surface via a filter,
      not by navigating to a different screen.
- ☑ Adding a record of any category produces a **property timeline event**, and
      the timeline shows it.
- ☑ No category renders from a store other than the timeline. *(Checked by
      emptying the timeline and requiring the surface to empty with it — a
      violation is otherwise invisible on screen.)*
- ☑ Amending a record preserves the original and shows the revision history.
- ☑ Every record names who created it and when.
- ☑ A warranty is recorded against a Building System, appears in that system's
      record count, and is findable by opening the system.
- ☐ An archived property's records and timeline are still readable.
- ☑ Empty categories say what to record there, and why.
- ☑ A roof replacement reads as one story from any record in it, including the
      contractor invoice.
- ☑ Clicking a Building System shows its complete history in one place.
- ☑ Linking and unlinking are recorded in the revision history.
- ☑ Documents are derived from records; every one names the record it is filed
      on and opens it.
- ☑ A document can be attached to an existing record, and the attachment is in
      the history.
- ☑ A failed attachment is reported and changes nothing.
- ☑ The workspace does not scroll sideways at 390px.
