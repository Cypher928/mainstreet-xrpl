# The CAM page as a workflow

The CAM tab reads top to bottom as four numbered steps. Nothing about the
calculation, the allocation, the year scope, the billing gates, the evidence
rules, the audit findings, the stale-result protection or persistence changed
in this reorganisation; the existing sections were moved under four headings
and given a status each, and every figure on the page is read from the
authority that already owns it (`renderCamWorkflow()` in `script.js`).

| Step | Holds (existing ids) | Status and facts, read from |
|---|---|---|
| **1 · Prepare** | `#cardGL` (GL upload), `#cardInvoices` (upload, Yardi import, and the invoice register `#invResults` — collapsed by default behind a one-line summary, see below — with a pointer to Property → Invoices) | `_camPrepState()` — the same predicate the Calculate button's confirmation modal refuses on; `camYearScopeOf` for dated-in-year; `CamPool` for the pool; the source-document predicate the audit detector uses |
| **2 · Calculate** | `#runBtn` ("Calculate CAM Charges", `showAllocationModal()` → `confirmAllocation()` → `runAllocation()`) | CAM year (`getCamYear`), recoverable pool (`CamPool.total`), tenant count, readiness; last run from `camRuns[0]` / `camReconciliation.savedAt`; `_staleResultsReason()` when stale; the refusal when the engine refused |
| **3 · Tenant Results** | `#results` with `#resultsTitle`, the save/stale banners and `#resultsBody` (Needs Review rollup, Reconciliation Summary with the per-tenant table and billing status, tenant result cards); `#previousRunsSection` | `_lastBillingVerdict` — the billing gate's own count of billable tenants |
| **4 · AI Audit Review** | `#camAuditReview`, where `#narrativePanel`, `#auditPanel` and `#trendsPanel` now mount (`_camAuditMount()`, falling back to `#results`) | `_camAuditBuckets()` over `buildAuditSummary()` and `AuditExposure.billingReadiness` |

`#disputeSection` (Tenant Disputes) follows the four steps unchanged.

## The invoice register is collapsed by default

The upload controls in Prepare stay open and immediately usable. The register
itself (`#invResults`, every row with its View · Explain · Dispute · Remove
actions, unchanged) sits behind a one-line summary strip (`#camRegisterHead`):

> Invoice register · 26 invoices · $188,300.00 · 0 with a source document ·
> **View invoices ›** · Filed under Property › Invoices

The three figures are the same counts Prepare already reads: the register
length, `CamPool.grossTotal`, and the source-document predicate the audit
detector uses. *View invoices* (`toggleCamRegister()`) shows the existing
register in place and reads *Hide invoices* while it is open; nothing about the
rows is re-rendered differently. The state is display-only and changes in one
place, `setCamRegisterOpen()`: the toggle opens and closes it, and
`resetWorkflow()` (opening a property) closes it. A batch upload, a Yardi
import or a GL import leaves it collapsed and only updates the summary row —
a real property can carry hundreds of invoices, and a batch landing must not
unfold every card and bring the scrolling back; the manager chooses *View
invoices*. A re-render of the register never changes its state. The Property
→ Invoices drawer remains the permanent filing location.

Any register change that changes the reconciliation's inputs — removing a
row, Clear All, editing a vendor, amount, category or date, or taking an
invoice out of CAM in the Property → Invoices drawer — marks the existing
results stale through `_invoiceInputChanged()`, the same `_resultsStale`
behaviour the tenant edits use. The stale banner shows, Calculate reads
"Re-run needed", the CSV export and the tenant statement refuse, and the next
run clears it. Before this, the same removal was flagged only after a reload
(the saved inputs fingerprint no longer matched) and passed as current in the
session it happened in. `test-e2e-invoice-input-stale.js` proves the
lifecycle for each path.

## Lease provisions the engine does not apply hold the statement

Intake extracts an expense stop, a gross-up, a base year, an administrative
fee and its basis, and a pro-rata method, stores each with its clause, and
lets a reviewer mark it verified. The allocation applies none of them: the
share is leased area over the property total, times occupancy, less excluded
categories, under a single-year cap. Rather than bill a tenant as though such a
clause did not exist, detector 3b in `reconciliation-engine.js` raises one
yellow, tenant-scoped finding with `blocksBilling: true` for a tenant that
receives shared CAM and carries any of them. The finding names the term, its
value, the lease quote when one is on file (and says so when none is), states
that MainStreet does not apply it, and holds that tenant's statement until it
is confirmed and handled. The existing gate does the rest: "Why it can't bill",
the AI Audit Review blocking group, and the Tenant Statement block screen all
show it through the same machinery as every other blocker.

Present, not truthy: an expense stop of 0 is a stated stop; `null` and `''`
are absent. A pro-rata method of "rentable" and a fee basis of
"operating_expenses" are what the engine already does and never fire. Lease
type is not repeated here; the Gross / Modified Gross detector owns it. The
arithmetic is untouched, and `test-unapplied-provisions.js` asserts that the
engine reads none of these fields.

## The year is chosen where it is reconciled

The CAM year is one in-memory authority, `getCamYear()`, per user, stamped on
the property and on each run and re-adopted when the property is opened. The
selector that changes it lived only in Property Setup, while every message
about the year ("Dated in 2025: 0", the refusal's "switch the CAM year") was
on the CAM tab. The Prepare step now carries the same selector ("Reconciling
· 2025 CAM"); both selects share the class `cam-year-select`, are populated by
`initCamYearSelect()` and kept in step by `setCamYear()`. The refusal panel
gains "Change the CAM year ›", which takes the manager to that selector
(`focusCamYearSelect()`). When the selected year has no invoices, Prepare
says which year the invoices do carry.

Switching the year after a run no longer leaves "✓ Calculated" beside figures
for another year. The mismatch is derived, not stored: `_camYearMismatch()`
compares the chosen year with `lastResultsYear`, and the banner, the Calculate
step and `_staleResultsReason()` read it ("These results are for 2024, not
2025 — switch the CAM year back to 2024, or re-run for 2025"). Nothing about
the inputs changed, so switching the year back makes the results current
again with no run, while a genuine edit keeps `_resultsStale` set through a
year round-trip. The CSV export and the statement already refused on the year
mismatch and still do. Nothing about `camYearScopeOf`, the refusal
condition, the undated rule or the run stamping changed.
`test-e2e-cam-year-choice.js` walks Maple Plaza: 2024 invoices under a 2026
year, the refusal, the switch, the 2024 run, mixed years, and the reload.

## A cap with no base names the base, and offers it

A tenant with a CAM cap on file, no prior-year base and no clause quote on
record is in the `unit_unconfirmed` state. It used to read "Cap type needs
confirmation before MainStreet can determine whether a base is required",
with no button. Nothing in the product lets a person declare a cap unit, and
the engine never reads one: a cap between 0 and 100 with a usable base is
enforced as a percentage regardless. The state now says what is true — the
cap is on file, the prior-year base is missing, the cap is not applied, and
it will be applied as a percentage once the base is entered — and carries
`actionable: true, field: 'cap_base_amount'`, so the "CAM cap unresolved"
banner renders the same "Add cap base →" that `missing_base` has always
rendered. That button is the existing `openReviewItemFix`, which opens the
tenant's Lease Intake row and focuses Prior-Year CAM Base. The state name,
the cap arithmetic, the ceiling, extraction and the dollar-cap state are
unchanged.

The banner is now cleared before each run alongside the other run warnings.
It was prepended on every run and never removed, so two unresolved runs
showed it twice and a resolved cap still sat under it.
`test-e2e-cap-resolution.js` walks unresolved → Add cap base → Prior-Year CAM
Base → re-run → cap applied → banner gone, and that repeated runs show one
banner.

## A space can be marked vacant, and a vacancy is never a tenant

Every surface that said "confirm the space is vacant" pointed at nothing: no
control created a vacancy. The Spaces list now carries **Mark space vacant**.
It opens an inline form (suite + vacant sq ft) and records through
`recordVacantSpace(suite, sqft)` in the app shell, the one writer. The record
is the representation that already existed: a row on `property.tenants` with
`vacant: true`, a suite and an area, no tenant name, and a minted record id.
The Spaces list shows the row as *Vacant*; above the list, when the
property's total area is known, a note states how much of the building is
under neither a loaded lease nor a recorded vacancy.

What a vacancy is not: it is not a lease, not a tenant and not a
reconciliation input. `getValidTenants`, `_camPrepState`,
`renderBulkResults` and `camInputsFingerprint` all skip `vacant === true`,
so recording one enters no allocation, renders no intake card, and does not
mark a saved reconciliation stale — in session or after a reload. Property
readiness and the occupancy sum in `selectors.js` skip it too. Recording the
same suite again updates its area rather than adding a second row; a suite
under a loaded lease is refused and the lease named.

What reads it: the engine's coverage finding subtracts confirmed vacancy from
the uncovered remainder. When the remainder after recorded vacancy is within
the same 2% safeguard, the finding is **green** (advisory, never blocking):
"X% documented · Y% confirmed vacant", stating that the vacant share is the
landlord's and no lease is missing. Otherwise it stays yellow and states the
vacant and the still-unresolved shares. The variance breakdown is told the
vacancy and the engine's verdict (`vacantPct`, `vacantResolved`) and repeats
them in its uncovered line; its next step falls through past a resolved
remainder. The summary banner note and the Prepare step ("Recorded vacant")
say the same. No bucket amount, share or charge moves.

`test-vacancy.js` pins the engine, breakdown and selector contracts;
`test-e2e-vacancy.js` walks Mark space vacant → save → Spaces row → coverage
green without a re-run → identical charges after one → no duplicates on
re-render or re-record → refusals → reload with the saved reconciliation
still current and the five tenants unchanged.

## The held tenant's action is not green

On a tenant card the *Why it can't bill* action (`.tenant-stmt-card-btn--held`)
is amber-outlined rather than the green of *Generate statement*, so a held
tenant and a billable one no longer look alike. The action, its wording, the
gate it opens and the billing logic behind it are unchanged.

## The four audit groups

`renderAuditPanel` groups the same findings it always rendered by what they
affect, in the order a manager acts on them:

- **Critical / blocking** — the findings the billing gate is holding
  statements on (`readiness.blockers`, matched by title as the statement
  refusal does);
- **Property-wide findings** — the remaining red/yellow findings with no
  tenant marker (`AuditExposure.findingScope`);
- **Tenant-specific findings** — the remaining red/yellow findings about one
  tenant;
- **Advisory** — the green findings.

Each finding keeps its severity colour, title, detail, conditions, its
quantified amount when the record carries one (`impact.amount`), and its
action control. The strip above the panel shows the four counts; a bucket
opens the panel on that group.

## Phone

The steps stack; the context cells sit two per row; the summary panel's badges
wrap; the per-tenant table scrolls inside its own wrap rather than the page.
`test-e2e-cam-workflow.js` checks the page never scrolls sideways at 400px.

## Verification

`test-e2e-cam-workflow.js` (in the regression as *CAM workflow layout*): the
four steps in order holding the right elements; Prepare and Calculate facts
equal to the authorities; the charges before the audit material; the audit
groups equal to the buckets and to the findings count; Calculate CAM opening
the same modal and calling `runAllocation` once, with amounts, verdict and
findings identical after the re-run and the row saved; stale protection after
an edit; a refused year; the restored path after a reload; the register
collapsed by default with its summary equal to the authorities, expanded in
place with every row's four actions on their existing handlers, a removal
still written through, and the Property → Invoices link opening the drawer;
the held action not green; the phone layout, including that the collapsed
register puts the Calculate button well under half as far down the page.
