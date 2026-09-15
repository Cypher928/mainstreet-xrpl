# Finding F-01 — the edge-case detector and the review gate disagree

**Status:** recorded, NOT fixed. No code change made.
**Found:** Validation Run 1, 2026-08-08, property `Claude` (`3e597cf0-d390-4821-b407-78f309ddce01`), build `b8eecd9`.
**Source data:** `evidence/2026-08-08-validation-run-1.json`.

## The contradiction

All three tenants in Run 1 carry `_edgeCases.shouldFlagReview: true` and
`_edgeCases.overallRisk: "high"`, while `_needsReview` is `false` on all three.

| Tenant | `overallRisk` | `shouldFlagReview` | `_needsReview` | `status` | `_confidence` | score |
|---|---|---|---|---|---|---|
| Olenox Corp | high | **true** | **false** | success | high | 80 |
| Surgery Partners, Inc | high | **true** | **false** | success | high | 70 |
| Siga Technologies, Inc | high | **true** | **false** | success | high | 80 |

`_needsReview` is the machine-readable flag the workflow gates on
(`review-engine.js:197` tests `t._needsReview === true`). `shouldFlagReview` is
produced by `detectLeaseEdgeCases` and is not consulted by that gate. So a
detector that has concluded "high risk, flag this for review" is overruled by a
gate that never asks it.

## Why this is the same shape as M5, and why M5's fix does not cover it

M5 was the ingest gate deriving "partial" from a field list that omitted
`leased_sqft`, while the explainability summary used a different list. The fix
made both read one exported constant.

This is a *third* opinion, from a system neither of those two consults. The M5
fix is working correctly here — none of these three leases is missing a
reconciliation-critical field, so the gate is right to leave `_needsReview`
false on its own terms. The defect is that `shouldFlagReview` has no path to
the gate at all.

## The edge cases actually detected

Per-tenant, from `_meta.edgeCasesDetected`:

- **`PROPERTY_NAME_MISMATCH`** (severity high, −20 confidence) — all three.
  The extracted `property_name` values are real and correct:
  `1207 N FM 3083 Rd, Conroe, TX 77304` (Olenox),
  `Seven Springs II, 310 Seven Springs Way, Brentwood, Tennessee 37027`
  (Surgery Partners), `4575 S.W. Research Way, Corvallis, OR, 97333` (SIGA).
  None matches a property named `Claude`. The reviewer note reads: *"Confirm
  this lease belongs to the current property before approving — it may have
  been uploaded to the wrong property."*
- **`CONTRADICTORY_CAP_AND_STOP`** (severity medium, −10) — Surgery Partners
  only, which carries both `cap: 5` and `expense_stop: 8.25`.

## Related: the same detector makes `_confidenceScore` property-dependent

`PROPERTY_NAME_MISMATCH` compares the extracted property name against the
property the lease was uploaded into, so the confidence score depends on how
the operator named the property — not on how well the document was read. The
identical three documents scored 100 / 90 / 100 in property `Lv` (2026-08-08
17:45, pre-fix build) and 80 / 70 / 80 in property `Claude` (Run 1), with the
deltas exactly equal to the edge-case adjustments (−20 / −30 / −20).

Consequence for the validation protocol: because each run uses a fresh
property, `_confidence` and `_confidenceScore` will vary for reasons unrelated
to extraction. Per instruction, they are **recorded but excluded from the
stability metric**, and properties are **not** renamed to suppress the
behaviour.

Note the mismatch detector is arguably doing the right thing — these leases
genuinely do not belong to a property called `Claude`. The problem is that a
correct high-severity signal both fails to gate the workflow and silently
distorts a score that is presented as extraction quality.

## Not assessed

Whether `shouldFlagReview` *should* drive `_needsReview`, and whether
`PROPERTY_NAME_MISMATCH` should adjust confidence at all rather than raise a
separate placement warning, are design questions. No recommendation is made
here and no code was changed.
