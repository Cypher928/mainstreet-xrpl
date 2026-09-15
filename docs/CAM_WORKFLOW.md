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

Removing an invoice from the register writes the removal to the property and
re-renders, as it always did; `removeInvItem` never set the stale flag and
still does not.

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
