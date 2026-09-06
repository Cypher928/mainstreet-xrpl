# Statement lifecycle trace — where the exclusion block sits

Required before modifying the statement/review gate. Traced against `script.js`
at `d7648d0`, before any of the F-02 changes were made.

## 1. What issues or approves a statement

**There is no separate issue/approve/send step.** `generateTenantStatement(tenantName)`
builds the tenant-facing document and hands it to `openReport(title, html)`,
which writes into `#rptBody` and shows `#reportOverlay`. The tenant copy is
produced from that overlay (print / save as PDF). So **rendering is issuing** —
the moment the HTML exists, the document exists.

Three entry points, all reaching the same function:

| Entry | Path |
|---|---|
| Reports tab button | `index.html:6959` → `guardedTenantStatement()` → `generateTenantStatement()` |
| Per-result card | `script.js:10304` `onclick="generateTenantStatement('…')"` |
| Reports tenant buttons | `script.js:14659` `onclick="generateTenantStatement('…')"` |

`guardedTenantStatement()` only checks that an allocation has been run; it
delegates immediately.

That single convergence is what makes a real guard possible: one function, three
doors, no fourth path that renders a tenant statement.

## 2. Where `exclusionsNotApplied` blocks it

Inside `generateTenantStatement`, **before any HTML is constructed and before
the "statement generated" activity-log entry**. The order is deliberate:

```
generateTenantStatement(tenantName)
  ├─ no allocation yet?            → toast, return
  ├─ _exclusionBlockReason(name)   → NON-NULL: log 'tenant_statement_blocked',
  │                                  render the block screen, RETURN
  └─ (only past this point) log 'tenant_statement', build HTML, openReport, hash
```

This is a lifecycle guard, not a banner. When it fires:

- no statement HTML is built,
- `openReport` is never called with a statement,
- the SHA-256 audit fingerprint is never computed,
- the activity log records `tenant_statement_blocked`, not a generated statement.

`_exclusionBlockReason` returns `null` — permitting issuance — only when the
tenant has no unapplied exclusions, or when a landlord acknowledgement exists
**whose fingerprint matches the current exclusion set**.

## 3. What the user sees

A full-overlay screen titled *"Statement blocked — {tenant}"* containing:

- a plain statement that the statement has **not** been issued, and why: those
  expenses are still in the tenant's pool, so issuing now would bill them for
  categories the lease may exclude;
- a table of every unapplied exclusion — the verbatim lease phrase, its status
  (`ambiguous` / `unmapped`), the nearest category if any, and the reason;
- if a previous acknowledgement has been invalidated, an explicit note that it
  no longer applies because the exclusions changed;
- two ways forward: edit the lease's excluded categories, or record a review.

## 4. Alternate actions that bypass it

Checked every report generator and export path:

| Path | Tenant-facing? | Bypass? |
|---|---|---|
| `generateTenantStatement` | yes | **guarded** |
| `openExplainPanel` (`script.js:11138`) | yes — drill-down, shows exclusions | not a statement; **display corrected** to name unapplied items |
| `generateReconciliationSummary` | landlord | no tenant statement |
| `generateMasterReport` | landlord | no per-tenant exclusion claim |
| `generateExceptionReport`, `generateHolesReport`, `openReportTenantDetail` | landlord | — |
| `generateLeaseReviewPacketReport`, `generateLenderSummaryReport`, `generateDrawPackageReport`, `generateAcquisitionReport` | landlord/lender | — |
| `window.print()` | — | prints whatever overlay is open; a blocked statement was never rendered, so there is nothing to print |

**No bypass found.** The one adjacent tenant-facing surface, the explain panel,
is not an issued document but did make the same false claim, so it now names
what could not be applied rather than listing raw AI phrases.

## 5. How manual resolution clears the block

Two routes, both auditable:

**a. Fix the data.** Edit the lease's excluded categories
(`script.js:3496` bulk card, `script.js:7865` lease centre → `handleFieldBlur`).
If every phrase then resolves, `exclusionsNotApplied` is empty and the block
disappears with no acknowledgement needed.

**b. Accept it explicitly.** `acknowledgeUnappliedExclusions(tenantName)` writes
`_exclusionAck = { fingerprint, at, by, unapplied[] }` onto the tenant, persists
it, logs an `exclusion_review` activity entry at `warning` severity naming every
acknowledged phrase, and re-attempts the statement.

This route exists because 20 of 21 real exclusions are structurally unmappable
(see the plan §0). Without it a lease whose exclusions the vocabulary cannot
express could never produce a statement, which would make the product unusable
rather than safe.

## 6. What happens when the exclusions change afterwards

Two independent mechanisms:

**The acknowledgement invalidates itself.** It is keyed to
`exclusionFingerprint(raw)` — a hash of the *semantic set* of phrases, so
re-spacing, re-casing or reordering does not invalidate it, while adding or
removing a phrase does. `_exclusionBlockReason` compares the stored fingerprint
against the current one and re-blocks on mismatch, reporting `staleAck: true` so
the screen can say the earlier review no longer applies. A landlord cannot
acknowledge one exclusion set and issue against another.

**The reconciliation is already marked stale.** `handleFieldBlur`
(`script.js:5394`) sets `_resultsStale = true` and shows the stale-results
banner on any lease field edit, including exclusions — pre-existing behaviour
this fix relies on rather than duplicates.

## Consequence for the guard's placement

Because issuance *is* rendering, and all three entry points converge on one
function, the guard could be a single early return rather than a state machine.
Anything weaker — a banner inside the statement, or a check in the Reports tab —
would have been bypassable by the two `onclick` handlers that call
`generateTenantStatement` directly.
