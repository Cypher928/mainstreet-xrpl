# Phase 22 — Lease Audit & Estoppel Intelligence
## Reuse Analysis

Status: **Planning only — no implementation.** Findings below come from a
direct code-reading pass across `main`, the unmerged
`feature/phase20-prepilot-hardening-expiry-toolkit` branch, and the
unmerged `feature/phase21-escrow-reserve-intelligence` branch (read via
`git show <branch>:<path>`, no checkout required).

---

## 1. `lease-intelligence.js` (main) — directly reusable, unmodified

| Function | Reuse in Phase 22 |
|---|---|
| `detectLeaseEdgeCases(tenantState, extractionResult)` (L524) | Reused as-is to populate "Lease Exceptions" in the Acquisition Risk Summary, per-tenant. |
| `generateLeaseExplainability(tenantState)` (L304) | Reusable for narrative summary text in the Lease Audit Report cover letter. |
| `deriveExtractionConfidence(snapshots, context)` (L246) | Pattern to replicate (not call directly) for estoppel extraction confidence — same scoring shape, different input. |
| `reasonMultiDocumentLease` / `buildMultiDocReasoningDocs` (L170, L583) | Not directly reused this phase — this handles *amendment precedence within the lease's own document set*, which is a different problem from *comparing the lease against an external estoppel*. Relevant prior art for Phase 22's later "Amendment vs. Original Lease" comparison pair, not for estoppel. |
| `CANONICAL_FIELDS`, `normalizeClauseConcept` | Reference for field-naming conventions when defining estoppel's normalized field names — not called directly, since estoppel fields (security deposit, TI allowance) are a different schema than lease canonical fields. |

**Conclusion:** Lease Intelligence is consumed, not modified. No changes
needed to this file.

## 2. `acquisition-engine.js` + `lease-review-packets.js` (main)

| Existing capability | Reuse plan |
|---|---|
| `buildAcquisitionReport()` (L295) | Called as-is; Phase 22 wraps it, doesn't change it. |
| `leaseExpirationSchedule`, `renewalRiskAnalysis`, `rolloverRiskAnalysis` (L412, L547, L445) | Feed "Expiring Leases" directly — already exactly the data needed. |
| `underbilling`, `capLeakage` (inside `buildAcquisitionReport` output) | Feed "CAM Recovery Risks" directly. |
| `missingCrit`/`missingCritDocs` (`lease-review-packets.js` L90, L752) | Currently scoped to the lease-review-packet formatter, not exposed at the acquisition-engine level. **Gap**: needs a small new function in `acquisition-engine.js` to surface this per-tenant across a whole acquisition review, since today it's only computed inside the single-tenant review packet. This is the one place existing logic needs *lifting*, not rewriting. |
| `migrations/006_acquisition_reviews.sql` | `data jsonb` blob — no migration needed; new `riskSummary` key added inside the existing blob. |

**Conclusion:** ~80% of the Acquisition Risk Summary is existing-function
composition. One small lift (missing-docs aggregation) is needed; one field
(`estoppelConflicts`) is genuinely new.

## 3. Lease Expiration Toolkit (Phase 20, **unmerged** —
   `feature/phase20-prepilot-hardening-expiry-toolkit`)

| Existing capability | Reuse plan |
|---|---|
| `applyRenewalStatus` / `setRenewalStatus` (acquisition-engine.js ~L1148, script.js ~L15155) | Not used by Phase 22 directly — this is user-driven status tracking (contacted/negotiating/renewed), orthogonal to estoppel comparison. |
| `_renderLeaseExpirationTable` / `exportLeaseExpirationReport` (script.js ~L15170, ~L15223) | Reference UI pattern for the Acquisition Risk Summary's "Expiring Leases" sub-list — same data, similar table styling. |
| `RENEWAL_STATUSES` const | Not consumed by Phase 22. |

**Important dependency note:** this branch is **not merged to `main`**.
Phase 22's reliance on `leaseExpirationSchedule`/`renewalRiskAnalysis` is
fine regardless (those existed on `main` before Phase 20), but if Phase 22
work happens to want any Phase-20-specific addition (e.g. `RENEWAL_STATUSES`
display), that dependency must be called out explicitly when this planning
branch moves to implementation, since merge order between Phase 20 and
Phase 22 isn't yet decided.

## 4. Escrow & Reserve Intelligence (Phase 21, **unmerged** —
   `feature/phase21-escrow-reserve-intelligence`) — the most relevant prior
   art, pattern-reused rather than code-reused

| Pattern | How Phase 22 reuses it |
|---|---|
| Engine/formatter split (`escrow-reserve-engine.js` / `escrow-draw-packets.js`) | Directly copied as the module layout for `estoppel-intelligence.js` / `estoppel-audit-packets.js` (see architecture doc). |
| `evidence.<field> = {quote, page}` citation shape | Directly copied as the estoppel's evidence shape — same convention, so any future shared citation-rendering component works for both without modification. |
| `validationChecklist` / `pass`/`met`/`detail` pattern (`validateDrawRequest`, L250) | Directly analogous to the proposed `auditRows`/`verdict` shape — same "list of checks, each with a pass/fail and a reason" idea, applied to comparison results instead of requirement checks. |
| `pkg.complete` boolean + green/red banner convention | Directly copied as `lenderReady` in the Lease Audit Report. |
| Source Citation Viewer modal | Directly reusable UI pattern, extended to show two citations side by side instead of one. |
| `normalizeReserve(raw, meta)` | Pattern to replicate as `normalizeEstoppel(raw, meta)` — same shape of "raw Claude JSON in, normalized object with evidence out." |

**Conclusion:** Phase 21 is not called by Phase 22 (different domain,
different data) — but it is the single best architectural template
available, and was built recently enough that its conventions are fresh
and proven (139 unit tests, e2e-verified, already shipped this session).
Phase 22 should follow it closely rather than inventing new conventions.

## 5. Document upload/extraction pipeline (`script.js`)

**Confirmed gap, explicitly flagged, NOT fixed by this phase:** there is no
shared extraction abstraction. `callClaudeForLease`, `callClaudeWithPdfDirect`,
`callClaudeForEscrowDocument`, and `callClaudeForEscrowDocumentPdfDirect`
are four structurally near-identical functions (build prompt → POST →
parse JSON → filter valid objects), each hand-rolled per document type.
Phase 22 will add a **fifth** near-identical function
(`callClaudeForEstoppelDocument`) rather than refactor the existing four
into a shared helper.

This is a deliberate scope decision, not an oversight: refactoring the
extraction pipeline is cross-cutting, touches code outside Phase 22's
domain, and risks destabilizing two already-shipped/in-flight features
(Lease Intelligence, Escrow & Reserve) for a phase whose goal is pilot
validation, not infrastructure cleanup. **Recommendation:** if a Phase 25+
"extraction pipeline consolidation" effort is ever scoped, this repeated
pattern (now five copies) is the prime candidate — flagged here so it isn't
lost, not actioned now.

## 6. Document comparison/diff utilities

**Confirmed: none exist anywhere in the codebase.** This is the one piece
of genuinely new infrastructure in Phase 22 (`document-comparison-engine.js`,
per the architecture doc) — everything else in this phase is either direct
reuse or composition of existing functions.

## 7. Summary: reuse vs. new work

| Category | Reuse % (rough) |
|---|---|
| Estoppel Comparison Engine (generic core) | 0% — genuinely new |
| Estoppel Comparison Engine (estoppel-specific layer) | ~40% — pattern-copied from `escrow-reserve-engine.js`'s normalize/citation/checklist conventions |
| Lease Audit Report formatting | ~70% — same report-section, banner, and footer conventions as every other report in the app |
| Acquisition Risk Summary | ~80% — mostly composition of existing analytics, one new field |
| Document Comparison Workspace (full generic UI) | Deferred — not built this phase |
