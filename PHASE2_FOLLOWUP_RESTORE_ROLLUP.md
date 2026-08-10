# Phase 2 Follow-Up — "Needs Review" rollup on saved reconciliations (Not a blocker)

**Discovered during:** pilot Preview QA of `0d7f673` (restore-path tenant actions), phone smoke test
**Status:** Deferred. Not a regression — the gap predates the recent reconciliation work and exists
on `main` equally. Not required for the pilot; logged so the decision is deliberate rather than
forgotten.

---

## What is missing

`_buildNeedsReviewRollupHtml()` (`script.js`) renders the "Needs Review" triage strip above the
Reconciliation Summary — a per-tenant list of extraction/allocation ambiguities, each deep-linking
to that tenant's result card.

It has exactly one call site, inside **`runAllocation()`** — the fresh-run renderer.
**`restoreResultsDisplay()` never calls it**, so opening a *saved* reconciliation shows no rollup.

Two consequences:

1. The fresh-run and saved-run views of the same reconciliation differ in what triage they surface.
2. `0d7f673` restored `_resultCardAnchorId(r.name)` on the saved card for structural parity, so that
   path now carries a scroll target with no user-facing entry point. It is harmless and is a
   precondition for the fix below, but it is not currently doing anything for a user.

Note this is *not* the AI Audit Summary. That panel (`buildAuditSummary()` → `renderAuditPanel()`)
renders property-wide Red/Yellow/Green findings and **is** called on the restore path. The two are
different systems: the rollup is per-tenant triage keyed on `r.ambiguityFlags`; the Audit Summary is
a property-level audit. Adding one does not make the other redundant.

---

## Why this is not a one-line fix

Adding `_buildNeedsReviewRollupHtml(lastResults)` to `restoreResultsDisplay`'s HTML is mechanically
trivial, but it would render nothing — or worse, render inconsistently — unless the data question
below is answered first.

**The blocking question: do `ambiguityFlags` survive the snapshot/restore cycle?**

`ambiguityFlags` is populated in `runFullReconciliation` (`script.js`, `result.ambiguityFlags = flags`)
from six codes:

`DIRECT_EXCLUDED_CATEGORY` · `DIRECT_ASSIGNMENT` · `SQFT_OVERFLOW` · `SQFT_APPROXIMATE` ·
`BASE_YEAR_MISMATCH` · `NNN_GROSS_UNKNOWN`

The rollup self-suppresses when none are present (`if (!flagged.length) return '';`). So the fix is
only meaningful if the flags are still on `lastResults` after a restore. Known so far:

- The primary restore path assigns `lastResults = snapshot.results` directly, so flags survive **if**
  the persisted blob retained them — **unverified**.
- The **fallback** path that rebuilds from `cam_reconciliations` rows hardcodes `ambiguityFlags: []`.
  On that path the rollup would render nothing no matter what, because the per-tenant flags are not
  recoverable from those rows. That asymmetry needs a deliberate decision: accept it, or reconstruct.

---

## Suggested work (future)

1. Verify whether `ambiguityFlags` round-trips through the saved snapshot — check what `_stripBlobs`
   and the persistence layer retain on `results[]`.
2. Decide the fallback-path behaviour (accept "no rollup when rebuilt from rows", or reconstruct the
   flags from stored tenant data).
3. Only then add the rollup call to `restoreResultsDisplay`, with a test asserting it renders for a
   restored snapshot carrying flags and stays suppressed for one without.
4. At that point the restore-path anchor assertion in `test-restore-renderer-parity.js` becomes a
   live user-facing guarantee, and its docblock caveat can be removed.

The durable version of this is the shared `_renderResultCard(r, opts)` helper the two renderers
should have had from the start — deliberately deferred out of the pilot window. If that refactor
happens first, this item collapses into it.

---

## Disposition

Out of scope for the pilot. The saved-reconciliation card is functional without it: the tenant
actions restored in `0d7f673` (View Calculation, Validate Against Lease, Tenant Statement) work, and
the AI Audit Summary still surfaces property-level findings on that path. The rollup is triage
convenience, not correctness.
