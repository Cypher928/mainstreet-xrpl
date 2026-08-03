# Property Lifecycle

**Status:** agreed design, not implemented. Not a pilot blocker.
**Supersedes:** the "Archive property" line in `PILOT_ACCEPTANCE_CHECKLIST.md`,
which stays unchecked until this ships.

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

## Decisions this leaves open, and what I recommend

These are the points where the model above is not yet specific enough to build
from. Each carries a recommendation rather than a menu.

### 1. What counts as "meaningful activity"?

Needs to be one predicate, evaluated in one place, or Archive-vs-Delete will
disagree between screens. Recommend a property-scoped sibling of
`_hasRealActivity()` (`tenant-space.js:149`), which already draws this line for
Spaces:

> A property has meaningful activity if it has **any** tenant, lease document,
> CAM reconciliation, timeline event, dispute, settlement, or manually added
> activity.

Name and total square footage are *not* activity — a property with only those
is exactly the "wrong address, start again" case Delete is for.

### 2. Should Delete be blocked outright when there is activity?

Recommend **no** — demote it, don't remove it. A bad import can be large. But
make the cost visible and deliberate: the confirmation names the counts it is
about to destroy ("14 timeline entries, 3 reconciliations, 6 leases") and
requires typing the property name. Archive is the default button; Delete is the
quiet one.

### 3. Schema

Recommend `properties.archived_at timestamptz null` rather than a boolean or a
status enum. It answers *when*, it is trivially indexable, and `is null` is the
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

### 5. Acquisition integration

Agreed as proposed:

- Property **Archived** → the acquisition stays **Converted**, with an Archived
  badge so the state is legible rather than merely consistent.
- Property **Deleted** → the acquisition reverts to **Ready to Convert**, and
  `conversionRecord` is cleared so the duplicate guard stops firing.

The link is currently one-way (review → `propertyId`). Delete therefore has to
find the review by scanning `_acqReviews` for a matching
`conversionRecord.propertyId`. That is fine at pilot scale and needs no schema
change; a reverse `acquisition_review_id` on the property is the optimisation to
reach for only if that scan ever becomes a real cost.

### 6. Existing orphans — this is the part the lifecycle does **not** fix

Archive prevents the *next* Harborview. It does nothing for the one that already
exists, because that property row is already gone. Without a repair step,
Harborview stays Converted-and-invisible forever, and stays unconvertible.

Recommend a self-healing read rather than a data migration: when a review is
`converted` and its `conversionRecord.propertyId` is not in the loaded
portfolio, render it as **"Converted — property no longer exists"** with a
**Convert again** action, and let that action bypass the duplicate guard.

This is small, has no schema change, and is **separable from the rest of this
document** — it can ship on its own, before or after the lifecycle work.

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
- ☐ Archiving a converted property leaves the acquisition **Converted**, badged
      Archived.
- ☐ A converted review whose property no longer exists says so, and offers
      Convert again.
- ☐ Deleting a property with activity states the counts it will destroy and
      requires the property name to be typed.
