# Phase 22 — Lease Audit & Estoppel Intelligence
## Architecture Document

Status: **Planning only — no implementation.**

---

## 1. Module layout (proposed)

Following the established engine/formatter split used by Lease Intelligence
(`lease-intelligence.js` + `lease-review-packets.js`) and Escrow & Reserve
Intelligence (`escrow-reserve-engine.js` + `escrow-draw-packets.js`) — both
pure IIFE modules with no DOM access, exposed on `window`, paired with a
`test-*.js` Node-runnable assertion file:

```
document-comparison-engine.js   → window.DocumentComparisonEngine
                                   (generic 2-document field-diff core;
                                    no estoppel-specific knowledge)

estoppel-intelligence.js         → window.EstoppelIntelligence
                                   (estoppel-specific: field mapping,
                                    severity rules, normalizeEstoppel(),
                                    buildLeaseAuditReport())

estoppel-audit-packets.js        → window.EstoppelAuditPackets
                                   (pure HTML formatter for the Lease
                                    Audit Report, mirrors
                                    escrow-draw-packets.js)

test-document-comparison.js      → unit tests for the generic comparator
test-estoppel-intelligence.js    → unit tests for estoppel-specific logic
test-e2e-estoppel.js             → Playwright e2e (mirrors
                                    test-e2e-escrow-reserve.js)
```

`acquisition-engine.js` gains one new function (`buildAcquisitionRiskSummary`)
rather than a new file — it's aggregation of existing analytics plus the one
new estoppel-conflict signal, not a new domain.

`script.js` gains: upload handlers for estoppel documents, UI wiring for
the comparison view and audit report, and the Acquisition Risk Summary
section in the existing acquisition review screen. No new global state
container beyond what's described in §3.

## 2. Why a generic comparator, not an estoppel-only diff function

The request explicitly names four comparison pairs as the long-term
target (Lease vs. Estoppel, Amendment vs. Original Lease, Mortgage vs.
Amendment, Insurance Policy vs. Lender Requirement). Today's codebase has
**zero** cross-document comparison utilities (confirmed in reuse analysis).
If Phase 22 hand-rolls an estoppel-specific diff the way `script.js`
currently hand-rolls a near-duplicate Claude-extraction function per
document type (`callClaudeForLease`, `callClaudeForEscrowDocument`,
`callClaudeForEscrowDocumentPdfDirect` — three structurally-identical
functions, confirmed by reuse analysis), Phase 22 repeats that anti-pattern
at the comparison layer instead of fixing it.

Proposed shape for the generic core:

```
DocumentComparisonEngine.compareDocuments(docA, docB, fieldConfig)
  → { results: [ { field, valueA, valueB, status, citationA, citationB } ],
      summary: { matchCount, mismatchCount, omittedCount, highRiskCount } }
```

`fieldConfig` is an array of `{ field, label, compareFn?, severityFn?,
omittedIsHighRisk? }` — `compareFn` defaults to strict/normalized equality
but can be overridden per field (e.g. date-equivalence, currency-tolerance).
`estoppel-intelligence.js` supplies the lease-vs-estoppel `fieldConfig` and
severity rules; it does not duplicate the diffing logic itself.

This is the only deliberately-generalized piece in this phase — everything
else is scoped narrowly to the estoppel use case, per the "Document
Comparison Workspace" requirement being explicitly framed as a long-term
foundational capability, not a finished workspace UI in this phase.

## 3. State / data flow

1. User uploads a lease (existing pipeline — already extracted/normalized
   via `callClaudeForLease` → tenant object) and an estoppel certificate
   (new pipeline — `callClaudeForEstoppelDocument`, following the existing
   hand-rolled pattern for now; see `PHASE22_REUSE_ANALYSIS.md` for the case
   to eventually unify these, out of scope here).
2. Estoppel raw Claude output is normalized via
   `EstoppelIntelligence.normalizeEstoppel(raw, meta)` into the shape defined
   in `PHASE22_DATA_MODEL.md`, mirroring `normalizeReserve()`'s pattern of
   producing `evidence.<field> = {quote, page}` per field.
3. The normalized estoppel is attached to the tenant record as
   `tenant.estoppel` (single estoppel per tenant for this phase — no
   versioning/history of multiple estoppels per lease yet).
4. `EstoppelIntelligence.buildLeaseAuditReport(tenant)` internally calls
   `DocumentComparisonEngine.compareDocuments(tenant, tenant.estoppel,
   ESTOPPEL_FIELD_CONFIG)` and layers the PASS/WARNING/HIGH RISK
   classification on top of the generic match/mismatch/omitted result.
5. `EstoppelAuditPackets.formatAuditReportHtml(report)` renders it for the
   existing `openReport()` print surface.
6. `AcquisitionEngine.buildAcquisitionRiskSummary(tenants, invoices,
   totalSqFt)` calls `buildAcquisitionReport()` (existing) plus, for each
   tenant with `tenant.estoppel` present, `buildLeaseAuditReport(tenant)`,
   and rolls the per-tenant audit results into one risk-summary list
   alongside the existing missing-docs/exceptions/expiring-lease signals.

## 4. Persistence

- `tenant.estoppel` persists the same way other tenant fields already do —
  inside the property's `tenants` array, written via the existing
  `saveProperty()` path. No new Supabase table needed for the estoppel
  document itself.
- The Lease Audit Report itself is **not persisted as a row** in this
  phase — it's computed on demand from `tenant` + `tenant.estoppel`,
  matching how `lease-review-packets.js` computes its packets on demand
  rather than storing rendered output. If pilot feedback shows users need
  audit-history-over-time (e.g. re-running after the estoppel is amended),
  that's a follow-up, not in scope here.
- Acquisition Risk Summary reuses the existing `acquisition_reviews` table
  (`data jsonb` blob, migration `006_acquisition_reviews.sql`) — the new
  summary fields go inside that same jsonb blob, no schema migration
  required for this phase.

## 5. Reused infrastructure (no new build required)

- Claude API call plumbing (`fetch` → `/api/claude`, JSON parse, retry/
  error handling already added in Phase 20 Track 1).
- `openReport()` / `#reportOverlay` / `window.print()` for the audit
  report and risk summary.
- Citation/evidence display pattern (`evidence.<field>.{quote,page}`) and
  modal UI convention from Phase 21's Source Citation Viewer — directly
  reusable for showing *both* the lease's and the estoppel's citation for
  a mismatched field side by side.
- `detectLeaseEdgeCases()`, `leaseExpirationSchedule`, `renewalRiskAnalysis`,
  `underbilling`/`capLeakage` — all consumed as-is by the Acquisition Risk
  Summary, not reimplemented.

## 6. Open architectural questions (flag for pilot/design review, not
   resolved by this planning pass)

- Should `tenant.estoppel` support multiple estoppels over time (e.g. a
  refinance produces a second estoppel years later), or is "latest wins"
  acceptable for the pilot? Current proposal: latest-wins, single field,
  revisit if pilot users need history.
- Should HIGH RISK findings block any downstream workflow (e.g. prevent
  marking an acquisition review "complete"), or is this purely informational
  in this phase? Current proposal: informational only — no gating — to
  avoid scope creep into the existing Acquisition Review state machine.
- Is the generic `DocumentComparisonEngine` premature abstraction if Phase
  22 is the only consumer for the foreseeable future? Counter-argument: the
  request explicitly lists three more planned comparison pairs and frames
  this as "a foundational capability" — the abstraction cost here is low
  (one config-driven diff function) relative to repeating the
  per-document-type hand-rolling anti-pattern already present in the
  extraction layer.
