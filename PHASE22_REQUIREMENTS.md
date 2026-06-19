# Phase 22 — Lease Audit & Estoppel Intelligence
## Requirements Document

Status: **Planning only — no implementation.** Branch:
`feature/phase22-estoppel-intelligence-planning`.

---

## 1. Problem statement

Today the platform extracts and analyzes a lease in isolation (Lease
Intelligence), and analyzes a portfolio of leases in isolation (Acquisition
Review). Neither compares a lease against an independently-issued document
that's supposed to corroborate it — most importantly, an **estoppel
certificate**, the document a tenant signs at acquisition/financing time
attesting to the lease's current terms. Lenders and acquirers need to know
where the estoppel and the lease *disagree*, because that's where legal and
financial risk hides. No comparator exists anywhere in the codebase today
(confirmed by reuse analysis — see `PHASE22_REUSE_ANALYSIS.md`).

## 2. Goals (this phase)

1. Let a user upload a lease and a matching estoppel certificate for the
   same tenant/suite and get a field-by-field comparison with flagged
   mismatches.
2. Generate a lender/acquisition-ready **Lease Audit Report** with a
   PASS / WARNING / HIGH RISK verdict per compared field.
3. Extend the existing Acquisition Review feature with an aggregate
   **Acquisition Risk Summary** that rolls in: missing documents, lease
   exceptions, expiring leases, estoppel conflicts, and CAM recovery risk.
4. Build the comparison logic as a **reusable Document Comparison engine**,
   not a one-off estoppel-only function — explicitly designed so Phase 22's
   second and third use cases (amendment-vs-original, mortgage-vs-amendment,
   insurance-vs-lender-requirement) are additions, not rewrites.

## 3. Non-goals (this phase)

- No covenant extraction (Phase 23).
- No insurance/COI tracking (Phase 24).
- No automated estoppel *generation* — only comparison of an already-issued
  estoppel against the lease of record.
- No change to existing Lease Intelligence, Acquisition Review, or Lease
  Expiration Toolkit behavior — Phase 22 consumes their outputs, it doesn't
  modify them.
- No new extraction "AI architecture" — reuse the existing Claude
  call → JSON parse → normalize pattern already used for leases and escrow
  documents.

## 4. Functional requirements

### 4.1 Estoppel Comparison Engine
- Accept two already-extracted, normalized structured objects: a lease
  (the existing `tenant` shape from Lease Intelligence) and a newly-defined
  `estoppel` shape (see `PHASE22_DATA_MODEL.md`).
- Compare these fields at minimum: Tenant Name, Suite, Base Rent, Security
  Deposit, Lease Expiration, Renewal Options, Outstanding TI Allowances,
  Landlord Obligations.
- For each field, classify the result as `match`, `mismatch`, or
  `omitted_from_estoppel` (the field exists on the lease but the estoppel
  is silent on it — distinct from an active mismatch, and itself a risk
  signal per the example in the request: "Renewal option omitted from
  estoppel" is HIGH RISK, not a numeric mismatch).
- Each comparison result carries the lease's and estoppel's source citation
  (quote + page), reusing the `evidence.<field> = {quote, page}` shape
  already used by Lease Intelligence and the Escrow/Reserve engine.

### 4.2 Lease Audit Report
- One row per compared field, each tagged PASS / WARNING / HIGH RISK.
- Severity mapping (initial proposal, to be refined during build):
  - **PASS** — fields match exactly, or match within an immaterial
    tolerance (e.g. base rent off by a rounding cent).
  - **WARNING** — fields differ but the difference is reconcilable or low
    financial impact (e.g. security deposit off by a few hundred dollars,
    a date formatted differently but resolving to the same day).
  - **HIGH RISK** — fields actively conflict on a material term (base rent,
    expiration date), or a term required for lender reliance is *omitted*
    from the estoppel entirely (e.g. renewal options, TI allowance,
    landlord obligations).
- Report is printable/exportable via the existing `openReport()` +
  `window.print()` pattern (no new PDF infrastructure).

### 4.3 Acquisition Due Diligence Package extension
- Add an **Acquisition Risk Summary** section to the existing Acquisition
  Review output, aggregating:
  - Missing Documents (extend the existing `missingCrit`/`missingCritDocs`
    concept in `lease-review-packets.js`)
  - Lease Exceptions (surface `detectLeaseEdgeCases()` output per tenant,
    which already exists but isn't currently rolled up at the portfolio
    level)
  - Expiring Leases (reuse `leaseExpirationSchedule`/`renewalRiskAnalysis`
    from `acquisition-engine.js`, already built)
  - Estoppel Conflicts (new — output of 4.1/4.2 above, where an estoppel has
    been uploaded for a given tenant)
  - CAM Recovery Risk (reuse existing `underbilling`/`capLeakage` analysis
    already in `buildAcquisitionReport()`)
- This is **assembly of existing + one new signal**, not new analytics
  engines for 4 of 5 bullets.

### 4.4 Document Comparison Workspace
- A generic two-document comparator: given two normalized structured
  objects and a field-mapping/precedence config, produce a list of
  per-field comparison results (match/mismatch/omitted) with citations.
- Lease vs. Estoppel is the first concrete use case; the engine's public
  API should not bake in estoppel-specific field names — the field list and
  severity rules should be passed in as configuration, so Lease Amendment
  vs. Original Lease, Mortgage vs. Amendment, and Insurance Policy vs.
  Lender Requirement can reuse the same core diff function later without
  modifying it.

## 5. Acceptance criteria (high-level, to be refined into test plans at
   implementation time)

- Given a lease and an estoppel with one deliberately mismatched field
  (e.g. base rent), the comparison engine flags exactly that field as
  HIGH RISK or WARNING per the severity rules, and all other fields as
  PASS.
- Given an estoppel that's silent on renewal options where the lease has
  them, the engine flags `omitted_from_estoppel` for that field, classified
  HIGH RISK.
- The Lease Audit Report renders and prints via the existing report
  overlay, with no new PDF library introduced.
- The Acquisition Risk Summary surfaces estoppel conflicts only for tenants
  that actually have an uploaded estoppel; tenants without one show no
  estoppel-related risk line (not a false "no conflicts found").

## 6. Stakeholders / context

- Christy has already expressed interest in this feature set — named as the
  reason this is prioritized over Phase 23 (Loan Covenant Intelligence) and
  Phase 24 (Insurance Intelligence).
- Builds directly on three already-shipped or in-flight capabilities: Lease
  Intelligence (`main`), Acquisition Review (`main`), Lease Expiration
  Toolkit (unmerged `feature/phase20-prepilot-hardening-expiry-toolkit`).
