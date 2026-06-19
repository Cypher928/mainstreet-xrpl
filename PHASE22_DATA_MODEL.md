# Phase 22 — Lease Audit & Estoppel Intelligence
## Data Model Proposal

Status: **Planning only — no implementation.** All shapes below are
proposals to validate during build, not final schemas.

---

## 1. `estoppel` object (normalized, attached as `tenant.estoppel`)

Mirrors the normalization pattern already used by
`EscrowReserveEngine.normalizeReserve()` — raw Claude JSON in, normalized
object with citations out.

```js
{
  id: 'uuid',
  tenantName: 'Acme Corp',
  suite: '204',
  baseRent: 4200.00,              // monthly, matches lease's normalized unit
  securityDeposit: 8400.00,
  leaseExpiration: '2027-03-31',  // ISO date string
  renewalOptions: 'One 5-year option at FMV',  // null if estoppel silent
  outstandingTiAllowance: 0,
  landlordObligations: null,      // null if estoppel silent
  sourceFileName: 'Acme_Estoppel_2026.pdf',
  sourceFileUrl: 'https://...',
  uploadedAt: '2026-06-19T00:00:00Z',
  // evidence mirrors lease-intelligence/escrow-reserve-engine convention:
  // evidence.<field> = { quote, page }
  evidence: {
    baseRent:          { quote: 'Current Base Rent is $4,200.00 per month.', page: 1 },
    leaseExpiration:   { quote: 'The Lease expires March 31, 2027.', page: 1 },
    // fields the estoppel never mentions have NO entry here —
    // absence of an evidence entry is the signal for "omitted from estoppel",
    // distinct from an explicit null value the document affirmatively states
  },
  extractionConfidence: { score: 82, level: 'high', reasons: [...] },
}
```

Design note: a field can be **affirmatively stated as null/none** (e.g.
"Tenant has no renewal options") vs. **never mentioned at all**. These must
be distinguishable — the former is a real comparison value (and may PASS if
the lease also has none), the latter is the `omitted_from_estoppel` case
that's HIGH RISK regardless of the lease's actual value. Proposal: Claude's
extraction prompt instructs it to emit `null` only when the document is
silent, and an explicit string like `"None"` when the document affirmatively
states no options exist — letting normalization tell these apart. This
mirrors the exact problem already solved for `excluded_categories` in the
existing CAM exclusion detector — same pattern, different field.

## 2. Comparison result shape (generic, produced by
   `DocumentComparisonEngine.compareDocuments`)

```js
{
  results: [
    {
      field: 'baseRent',
      label: 'Base Rent',
      valueA: 4200.00,            // from lease (docA)
      valueB: 4200.00,            // from estoppel (docB)
      status: 'match',            // 'match' | 'mismatch' | 'omitted'
      citationA: { quote, page, sourceFileName },
      citationB: { quote, page, sourceFileName } | null,
    },
    // ...one entry per configured field
  ],
  summary: { matchCount: 6, mismatchCount: 1, omittedCount: 1, totalFields: 8 },
}
```

## 3. Lease Audit Report shape (estoppel-specific, layered on top of §2 by
   `EstoppelIntelligence.buildLeaseAuditReport`)

```js
{
  tenantName: 'Acme Corp',
  property: { name, totalSqft },
  generatedAt: '2026-06-19T...',
  comparison: { /* §2 shape */ },
  auditRows: [
    {
      field: 'baseRent', label: 'Base Rent',
      verdict: 'PASS',           // 'PASS' | 'WARNING' | 'HIGH_RISK'
      verdictReason: 'Base Rent matches',
      citationA, citationB,
    },
    {
      field: 'securityDeposit', label: 'Security Deposit',
      verdict: 'WARNING',
      verdictReason: 'Security Deposit mismatch — lease states $8,500.00, estoppel states $8,400.00',
      citationA, citationB,
    },
    {
      field: 'renewalOptions', label: 'Renewal Options',
      verdict: 'HIGH_RISK',
      verdictReason: 'Renewal option omitted from estoppel',
      citationA, citationB: null,
    },
  ],
  overallVerdict: 'HIGH_RISK',   // worst verdict across all rows
  lenderReady: false,            // true only if overallVerdict === 'PASS' (no WARNING/HIGH_RISK rows)
}
```

`lenderReady` deliberately mirrors the `pkg.complete` boolean already used
by Escrow & Reserve's draw package validation banner — same UX convention,
same field semantics (a single boolean the formatter uses to choose the
green/red banner).

## 4. Acquisition Risk Summary shape (extension to existing acquisition
   review `data` jsonb)

```js
{
  // ...existing buildAcquisitionReport() fields unchanged...
  riskSummary: {
    missingDocuments: [ { tenantName, missingDocType } ],       // existing concept, surfaced here
    leaseExceptions:  [ { tenantName, edgeCaseType, severity } ], // from detectLeaseEdgeCases per tenant
    expiringLeases:   [ { tenantName, expirationDate, daysUntil, riskTier } ], // existing leaseExpirationSchedule
    estoppelConflicts: [ { tenantName, overallVerdict, highRiskFieldCount } ], // NEW — from buildLeaseAuditReport, only for tenants with tenant.estoppel
    camRecoveryRisks: [ { tenantName, underbillingAmount, capLeakageAmount } ], // existing underbilling/capLeakage
  },
}
```

Tenants without an uploaded estoppel simply don't appear in
`estoppelConflicts` — they are not reported as conflict-free, since no
comparison was performed for them. This avoids the false-confidence failure
mode flagged as Acceptance Criteria in the requirements doc.

## 5. Persistence

| Data | Where it lives | New schema? |
|---|---|---|
| `tenant.estoppel` | inside `property.tenants[]`, via existing `saveProperty()` | No — reuses existing tenant-array persistence |
| Lease Audit Report | computed on demand, not persisted | No |
| Acquisition Risk Summary | inside `acquisition_reviews.data` jsonb | No — additive field inside existing jsonb blob |

No new Supabase migration is anticipated for this phase. If pilot feedback
calls for persisted audit history (re-running audits over time and diffing
*those*), that would need a new table and is explicitly out of scope here.
