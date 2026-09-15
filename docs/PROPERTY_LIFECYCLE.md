# Property Lifecycle

**Status:** IMPLEMENTED. Migration `010_property_archive.sql` must be applied
in Supabase before Archive works — until then the app degrades to
all-properties-active rather than emptying the portfolio.
**§6** (orphan repair) is frozen and remains as the backstop.
**§5** (prevention) shipped: deleting a converted property now reverts its
acquisition, so orphan repair is the exception rather than the normal path.
**Walked by:** `test-property-lifecycle.js` (37 checks),
`test-acq-orphan-repair.js` (30).

---

## Why this exists

Harborview Retail Center is marked **Converted** in Acquisition Review and does
not appear in the portfolio. That is not a rendering bug. The property was
converted and later deleted, and nothing connects those two facts.

Verified in the code:

- `convertAcquisitionToProperty()` (`script.js:22163`) sets `review.status =
  'converted'` and writes `review.data.conversionRecord = { propertyId, … }`.
- `confirmDeleteProperty()` (`script.js:21644`) deletes the `properties` row and
  lets the child tables cascade. It never looks for a review pointing at that
  property.

So the review keeps a `propertyId` that resolves to nothing, and the card keeps
saying Converted.

**There is a second consequence, and it is the worse one.** The first thing
`convertAcquisitionToProperty()` does is:

```js
if (review.data?.conversionRecord?.propertyId) {
  alert('This review has already been converted.\nProperty ID: ' + …);
  return;
}
```

The guard tests for the *record*, not for the property. Once the property is
deleted, that review can never be converted again — it is held shut by a
duplicate check protecting a duplicate that no longer exists. The only way back
to the property is to redo the entire acquisition as a new review, discarding
the original analysis. Harborview is not merely mislabelled; that review is a
dead end.

Deleting a property is also unconditional today. There is no archive, no
activity check, and no typed confirmation — one modal and every lease, timeline
entry, reconciliation and piece of evidence is gone by cascade. For a product
whose claim is verified memory, that is the wrong default.

---

## The model

### Active

- Appears in the portfolio.
- Included in dashboards, CAM, renewals, portfolio intelligence, AI summaries.

### Archived

The property is no longer managed — sold, management ended, closed.

- Hidden from the active portfolio by default; reachable through an explicit
  **Archived** view.
- Every lease, timeline entry, document, repair, reconciliation and piece of AI
  history stays intact and readable.
- Restorable, returning the property to Active exactly as it was.
- **Excluded from every aggregate.** Occupancy, WALT, revenue-at-risk, renewal
  counts and portfolio intelligence must not count a building you no longer
  manage. An archived property that still moves the dashboard is a wrong number,
  not a preserved memory.

### Deleted

Delete exists **only for mistakes**: a duplicate, a wrong address, a test
property, a bad import. It is not the end of a property's life — Archive is.

When a property has meaningful activity, **Archive is the primary action** and
Delete is demoted, with the modal saying plainly what would be destroyed.

---

## Decisions — all confirmed

These were the points where the model was not yet specific enough to build from.
Every one is now agreed; they are recorded with their reasoning so the next
person does not have to re-derive it.

**Archive is the normal lifecycle. Delete is the exception.** That sentence
governs everything below — where the two actions sit, which one is styled as
primary, and what the confirmation says.

### 1. What counts as "meaningful activity"? — one predicate

One predicate, evaluated in one place, or Archive-vs-Delete will disagree
between screens. A property-scoped sibling of
`_hasRealActivity()` (`tenant-space.js:149`), which already draws this line for
Spaces:

> A property has meaningful activity if it has **any** tenant, lease document,
> CAM reconciliation, timeline event, dispute, settlement, or manually added
> activity.

Name and total square footage are *not* activity — a property with only those
is exactly the "wrong address, start again" case Delete is for.

### 2. Delete is demoted, not blocked

Delete stays available: a bad import can be large, and forbidding the action
would just push people to work around it. But the cost is made visible and
deliberate — the confirmation names the counts it is about to destroy ("14
timeline entries, 3 reconciliations, 6 leases") and requires typing the property
name. Archive is the default button; Delete is the quiet one.

**And the dialog explains why Archive is recommended.** Hiding Delete would be
the weaker product: it treats the user as someone to be steered rather than
informed, and it gives them no way to understand the choice. Explaining it
teaches the model the product is built on. Copy:

> This property contains leases, timeline history, reconciliations, and
> supporting documents.
>
> If the property is no longer managed, **Archive** preserves its history while
> removing it from your active portfolio.
>
> **Delete** permanently removes all records and should only be used for
> properties created by mistake.

This paragraph appears only when the activity predicate in §1 returns true. On a
property with nothing in it there is no history to preserve, no case for
Archive, and nothing to explain — showing the warning there would train people
to dismiss it unread, which is exactly how it stops working on the day it
matters.

### 3. Schema

`properties.archived_at timestamptz null`, not a boolean and not a status enum.
It answers *when*, it is trivially indexable, and `is null` is the
active filter. Pair it with an `property_archived` / `property_restored` entry
through the existing `logActivity()` so *who and when* survives in the record.

A boolean would need a second column to answer the same question, and a status
enum invites a third state nobody has defined.

### 4. Where the filter goes

`loadProperties()` is the single read path (`script.js:15788` region), so the
active filter belongs there, with an explicit opt-in for the Archived view.
`computePortfolioIntelligence(props, …)` takes the array it is given, so it
inherits the filter for free — provided nothing else passes it an unfiltered
list. That is worth a test rather than an assumption.

### 5. Acquisition integration — THE NEXT WORK

This is prevention, and it is where the lifecycle effort goes next. §6 repairs
an orphan after the fact; this stops one being created.

- Property **Archived** → the acquisition stays **Converted**, with an Archived
  badge so the state is legible rather than merely consistent. The property still
  exists, so the conversion record is still true.
- Property **Deleted** → the acquisition reverts to **Ready to Convert**, and
  `conversionRecord` is cleared so the duplicate guard stops firing. The property
  it referred to is gone, so the record is no longer true and must not be kept as
  though it were.

The link is currently one-way (review → `propertyId`). Delete therefore has to
find the review by scanning `_acqReviews` for a matching
`conversionRecord.propertyId`. That is fine at pilot scale and needs no schema
change; a reverse `acquisition_review_id` on the property is the optimisation to
reach for only if that scan ever becomes a real cost.

Two things to get right, because both are ways this can quietly fail:

- **Clearing `conversionRecord` must not lose the history.** Move it to
  `conversionHistory[]` exactly as the repair path does, with a
  `supersededReason` naming the deletion. A reverted acquisition should still be
  able to say it was converted once, and what happened to that property.
- **Deletion can fail after the review has been updated, or the reverse.** These
  are two writes to two tables with no transaction between them. Order them so
  the survivable failure is the one that happens: delete the property first, then
  revert the review. If the second write fails the result is an orphan — which
  §6 already detects and offers to repair. Reverting first and then failing to
  delete leaves a live property no acquisition points at, which nothing detects.

That ordering is the reason §6 stays. It is not redundant once prevention ships;
it is the backstop prevention falls back to.

### 6. Existing orphans — SHIPPED

Archive prevents the *next* Harborview. It does nothing for the one that already
exists, because that property row is already gone. This is a self-healing read
rather than a data migration, and it shipped independently of everything else in
this document.

`_acqOrphaned(review)` is the single predicate: status is `converted`, a
`conversionRecord.propertyId` exists, and no loaded property carries that id.
Everything else reads from it — the card, the detail badge, the action panel,
the modal copy, and the duplicate-guard bypass.

- The card and the badge say **"Converted — property no longer exists"** instead
  of a healthy Converted, in amber: a state to resolve, not an error.
- The detail panel offers **Convert Again** and states that the review, its
  documents and its analysis are all still present.
- The duplicate guard is bypassed **only** for this state. It tests for the
  conversion *record*, which outlived the property it was protecting against —
  so it had stopped preventing a duplicate and started preventing the repair.
  The moment the repair succeeds the guard is live again.
- The superseded conversion is **kept, not overwritten**: it moves to
  `conversionHistory[]` with `supersededAt` and `supersededReason`. Same rule as
  the Space workspace — nothing important disappears, and the record shows how
  it evolved. `review.data` is merged, never replaced, so the analysis, tenants
  and invoices survive.

**`_propsLoadedOk` gates the predicate, and this is not optional.** Without it a
failed properties load leaves `_props` empty and every converted review looks
orphaned — the product would tell someone their buildings had been deleted
because the network blipped. Absence of evidence is not evidence of deletion:
say nothing until a load has actually succeeded.

Walked end-to-end in `test-acq-orphan-repair.js` (28 checks), including that
false positive.

**Frozen.** This path stays for safety and nothing more is built on it. If a new
requirement seems to want extending the repair, it almost certainly belongs in
§5 instead — repairing more states is not the same as producing fewer of them.

---

## Acceptance

To be walked as a first-time property manager, not asserted from component
tests. Every one of these is a regression test as well as a checklist line.

- ☐ A property with activity offers **Archive** as the primary action; Delete is
      present but demoted.
- ☐ A property with no activity offers **Delete** without ceremony.
- ☐ Archiving removes the property from the portfolio and from every aggregate —
      occupancy, WALT, revenue-at-risk, renewals, portfolio intelligence.
- ☐ An archived property's leases, timeline, documents, reconciliations and
      evidence are all still readable from the Archived view.
- ☐ Restoring returns it to the portfolio with all of the above intact.
- ☐ Deleting a converted property reverts its acquisition to **Ready to
      Convert**, and converting it again succeeds.
- ☐ That revert keeps the superseded conversion in `conversionHistory[]` rather
      than discarding it.
- ☐ If the revert fails after the property is deleted, the review is detected as
      orphaned rather than left silently wrong.
- ☐ Archiving a converted property leaves the acquisition **Converted**, badged
      Archived.
- ☑ A converted review whose property no longer exists says so, and offers
      Convert Again. *(shipped — `test-acq-orphan-repair.js`)*
- ☐ Deleting a property with activity states the counts it will destroy and
      requires the property name to be typed.
- ☐ That dialog explains why Archive is recommended, and does so only when the
      property actually has history to preserve.
