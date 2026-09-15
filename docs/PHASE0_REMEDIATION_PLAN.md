# Phase 0 Remediation Plan

**Input:** `docs/PHASE0_BENCHMARK.md` (authoritative measurement, commit `76ec88d`).
**Status:** proposal. Nothing implemented. Pilot frozen at `73041d1`; `main` untouched.
**Approval required before any code change.**

Benchmark classifications (A/B/C/D) are preserved. Four findings are refined
below on new evidence obtained by reading the engine and ingest code — each is
called out explicitly with the evidence, and each is flagged for your approval
separately from the plan itself. No finding is reclassified silently.

---

## 0. Cross-cutting fact that shapes the whole plan

`lease_documents.extracted_text` retains the full document text for all three
benchmark leases (19,255 / 25,824 / 14,653 chars, verified faithful against
pdf.js re-extraction). **Re-extraction does not require re-upload.** A prompt or
schema change can be replayed against stored text.

This makes the sequencing decision obvious: **batch every prompt/schema change
into one re-extraction pass.** Six separately-shipped extraction changes means
six re-extraction passes and six chances to diverge. See §5.

---

## 1. Four evidence-backed refinements — approve or reject individually

### R1 — Category D is resolved. It is a mapping omission, not model quality.

**New evidence:** `script.js:1765` — `_normalizeExtraction` builds the tenant
object by passing a literal to `normalizeTenant()`. That literal lists
`tenant_name, leased_sqft, start_date, end_date, lease_type, cap,
excluded_categories, baseYear, confidence, flags, doc_has_dates,
doc_has_lease_type, _error, admin_fee_pct, gross_up_pct, expense_stop,
audit_rights, pro_rata_method, renewal_options, property_name`.

`suite`, `base_rent` and `security_deposit` are **absent from that list**.
`normalizeTenant` (`script.js:1135`) does define all three, with defaults
`''`, `null`, `null` — exactly the values observed in the database:

```
suite:            d.suite ?? d.unit ?? d.unitNumber ?? ''     // → ""
base_rent:        d.base_rent        ?? null                  // → null
security_deposit: d.security_deposit ?? null                  // → null
```

The API contract asks for all three (`api/_claude-tasks.js`). The model's
response is never read for them. This explains 0-for-3 exactly, explains why
`suite` is `""` rather than the contract's `null`, and explains why the harder
`excluded_categories` succeeded — it *is* in the list.

**Proposed:** resolve D1–D9 into a new class **E — mapping defect**. This is not
a reclassification of any A/B/C finding; it is the resolution D was created to
await. B1 (Wink Davis sqft) remains the only model-quality finding.

**If you reject this:** D1–D9 stay unattributed and E1 below is not scheduled.

### R2 — M1's cap defect is currently inert, and that changes the fix order.

**New evidence:** `script.js:8869`:

```js
if (lease.capPercentage !== null && lease.capBaseAmount !== null) {
```

Both operands are required. `capBaseAmount` is `null` on all three benchmark
tenants and is **never populated by extraction** — it is manual entry only
(`script.js:8984-8990` documents this deliberately: *"capBaseAmount must be
entered manually; without it we skip cap enforcement rather than show wrong
math"*).

So today Canvas On Demand's 5.25% cap is **not applied at all**, while the UI
reports `"Lease complete. CAM Cap: 5.25%."` and the tenant statement shows no
cap line. The over-capping described in M1 only begins once a landlord types a
base amount into the field.

**Proposed:** M1 splits into two defects with different urgency —
**M1a** (cap advertised as in force but silently inert: present-tense, affects
every capped lease today) and **M1b** (when enforced, applied to the whole pool
instead of controllables: latent until someone enters a base amount).
Both stay money-class. M1a moves ahead of M1b.

### R3 — M5 does not reach the money path. Downgrade proposed.

**New evidence:** `script.js:8904` flags `SQFT_APPROXIMATE` when
`parseSqft(live.leased_sqft || lease.sqFt)` is falsy, and
`reconciliation-engine.js:24` maps that code to calculation state
`missing_inputs` / **"Missing Inputs"**. So a tenant with no square footage is
correctly refused a "Verified" badge at reconciliation time.

The contradictory state (`_confidenceScore: 90`, `_confidence: "high"`,
`_needsReview: false` alongside *"Lease incomplete — missing: leased_sqft"*) is
confined to the **ingest/review gate**, which tells the operator the lease is
fine when it is not. The reconciliation itself does not produce a wrong number.

**Proposed:** move M5 out of Priority 1 (wrong dollar amount) into a new
**Priority 1b — gate defects**: does not corrupt a number, but routes an
unusable lease past human review. Still ahead of all provenance work.

**If you reject this:** M5 stays in Priority 1 and ships with M1–M4.

### R4 — P1 is wrong about the columns. Three distinct causes, not one.

**New evidence:** `tenant_field_evidence` **does** have `source_file` and
`source_page`, and `_writeTenantFieldEvidence` (`script.js:5530-5531`) already
maps `snapshot.sourceFile` and `snapshot.page` into them. My benchmark
statement *"There is no column to store a citation"* is wrong. What is missing
is a `quote` column. The NULLs have three separate causes:

| | Cause | Location |
|---|---|---|
| **P1a** | `page: null` is hardcoded. The extraction contract never asks for a page number, though the stored text carries `--- Page N ---` markers. | `script.js:1832` |
| **P1b** | `sourceFile: normalized.fileName \|\| null` — but `fileName` is not yet assigned when the snapshot is built, so it resolves to `null`. The tenant blob shows the filename set later. Pure ordering bug. | `script.js:1831` |
| **P1c** | `quote` **is** captured in the in-memory snapshot (`script.js:1834`, 200-char cap) but `_writeTenantFieldEvidence`'s payload has no `quote` key and the table has no such column — and `fieldEvidence` is stripped from the JSON blob under `ms_useNormalizedEvidence`. Dropped from **both** stores. | `script.js:5523-5540` + `migrations/` |

P1b is a one-line fix. This is materially better news than the benchmark implied.

---

## 2. Priority 1 — correctness defects that can produce a wrong customer dollar amount

Ordered by expected magnitude. Every one of these produces a number that is
wrong without saying so.

> **Engine warning that applies to all of Priority 1.** `allocation-engine.js` is
> **dead, diverged code** (hardcoded `BASE_AMOUNT = 10000`, not loaded by
> `index.html`, documented in `docs/PRODUCTION_READINESS_REVIEW.md:339`). It is
> nonetheless `package.json`'s `main` and is described in `README.md` as "the
> allocation engine", and `test-allocation.js` tests it — so its tests pass while
> testing code the app never runs. **The live engine is
> `script.js:8811 runFullReconciliation` (cap at `8869`) and
> `script.js:8975 runCAMAllocation` (cap at `8987`).** Every fix and every
> regression test below targets those. Deleting or clearly quarantining the dead
> module should be part of this work, or the next person fixes the wrong file.

---

### M2 — Pro-rata denominator is manual entry, never reconciled against the lease

*Largest available error. Silent.*

- **Where:** `script.js:8855` `const proRata = lease.sqFt / totalSqFt;`
  `totalSqFt` originates at `script.js:9034` /`8681` from
  `document.getElementById('totalSqft').value` → `prop.totalSqft`
  (`script.js:3127`). Nothing reads the building area **stated in the lease**.
- **Evidence:** Canvas On Demand's lease states
  `TOTAL RENTABLE FLOOR AREA OF THE BUILDING: 134,809 SQUARE FEET`.
  Correct share 54,777 / 134,809 = 40.63%. Type 90,000 instead and every share
  inflates ~50%. The existing guard (`SQFT_OVERFLOW`, `script.js:8819`) only
  fires when the *sum of tenants exceeds* the property total — 54,777 < 90,000,
  so it stays silent.
- **Minimum schema change:** add `building_total_sqft: number | null` to
  `LEASE_EXTRACTION_SYSTEM` (`api/_claude-tasks.js`) + its `quotes` entry; add
  `building_total_sqft` to the `normalizeTenant` field set and to the
  `script.js:1765` literal.
- **Engine change:** none to the arithmetic. Add a comparison: if any tenant's
  `building_total_sqft` disagrees with `prop.totalSqft` beyond a tolerance, emit
  a blocking flag naming both numbers and the source lease.
- **Regression test:** new case in `test-allocation.js` **retargeted at
  `script.js`'s engine**, plus a reconciliation-level test: property total
  90,000, one tenant with `leased_sqft: 54777, building_total_sqft: 134809` →
  assert a `DENOMINATOR_MISMATCH` flag exists and names both figures.
  *Mutation proof:* delete the comparison → the assertion must fail.
- **Re-extraction:** **yes** — the field does not exist on any stored lease.

### M3 — No way to represent "this lease has no CAM clause"

- **Where:** the tenant model has no such field; `runFullReconciliation`
  (`script.js:8852`) allocates to every lease in `property.leases`.
- **Evidence:** CPI Corp is absolute net, single tenant, pays vendors directly.
  Extraction returned `_confidenceScore: 100`, `"Lease complete. No CAM Cap."`
  Placed in a property with a pool it receives 300,000 sqft of share with no
  contractual basis.
- **Minimum schema change:** `has_cam_clause: true | false | null` in
  `LEASE_EXTRACTION_SYSTEM` + `quotes` entry; same two plumbing sites as M2.
  `null` means unresolved and must not be treated as `true`.
- **Engine change:** `runFullReconciliation` excludes `has_cam_clause === false`
  tenants from the allocation pool **and** from the pro-rata denominator, and
  surfaces them in a named "not CAM-recoverable" section rather than dropping
  them silently.
- **Regression test:** three-tenant property, one with
  `has_cam_clause: false` → assert that tenant's `totalAllocated === 0`, that it
  is absent from `results`, and that the remaining two shares sum to 100%.
  A second case asserts `has_cam_clause: null` is **not** excluded (fails open
  to inclusion, with a flag).
- **Re-extraction:** **yes.**

### M1a — Cap is advertised as in force but never enforced

*Present-tense, affects every capped lease in the product today.*

- **Where:** `script.js:8869` requires both `capPercentage` **and**
  `capBaseAmount`; `capBaseAmount` is manual-entry-only and extraction never
  sets it (`script.js:1765` omits it; `normalizeTenant` defaults it to `null`).
  Display asserts the cap regardless — `_explainability.overallSummary`
  (`lease-intelligence.js`) renders *"CAM Cap: 5.25%."*
- **Minimum schema change:** none required to fix the honesty problem. Optional:
  extract `cap_base_amount` where a lease states one.
- **Engine change:** none to the arithmetic. The lease-intelligence summary and
  the tenant statement must distinguish *"cap found in lease"* from *"cap being
  enforced"*, and a cap with no base amount must raise a review note that names
  the missing input.
- **Regression test:** `test-ai-confidence.js` — tenant with `cap: 5.25`,
  `capBaseAmount: null` → assert the rendered summary does **not** claim the cap
  is applied and **does** contain a note naming `capBaseAmount`.
  *Mutation proof:* revert the wording → assertion fails. Guard against the
  vacuous-assertion trap: the regex must not match the fix's own comment (use
  the `code()` helper established in `test-security.js`).
- **Re-extraction:** **no** for the honesty fix. Yes if `cap_base_amount` is added.

### M1b — When enforced, the cap applies to the whole pool instead of controllables

- **Where:** `script.js:8869-8876` (`runFullReconciliation`) and
  `script.js:8987-8995` (`runCAMAllocation`) both cap `rawTotal` / `total`, which
  is `sharedTotal + ownTotal` — the tenant's entire allocation.
- **Evidence:** Canvas §4.2 caps *"items Landlord directly controls."* Taxes,
  insurance and utilities pass through uncapped. Capping everything under-bills
  the landlord silently.
- **Minimum schema change:** two parts.
  1. `cap_scope: "controllable" | "all" | null` in `LEASE_EXTRACTION_SYSTEM` +
     `quotes` entry. `null` must **not** default to `"all"`.
  2. A `controllable: boolean` classification on expense categories. Smallest
     viable form is a static category map (taxes / insurance / utilities /
     snow removal = uncontrollable; everything else controllable) plus a
     per-invoice override, rather than a new AI call.
- **Engine change:** split `rawTotal` into `cappedPortion` + `uncappedPortion`
  before the cap test; apply the cap to `cappedPortion` only; report both on the
  result so the statement can show the split.
- **Regression test:** tenant with `cap: 5.25`, `capBaseAmount: 10000`,
  `cap_scope: "controllable"`, and an expense set split across controllable and
  uncontrollable categories → assert the uncapped portion passes through intact
  and only the controllable portion is reduced. Second case: `cap_scope: null`
  → assert the engine refuses to cap and flags, rather than assuming `"all"`.
- **Re-extraction:** **yes** for `cap_scope`.
- **Note:** this is `C3` in `docs/CAM_ENGINE_GAP_ANALYSIS.md`. It is the same
  defect, now with a real document behind it.

### M4 — Recoverable CAM scope cannot be expressed as an inclusion list

- **Where:** `script.js:8857-8859` filters by
  `lease.excludedCategories.includes(...)` — an exclusion model only.
- **Evidence:** Wink Davis SS#3 recovers *"grounds care, outside lighting, and
  water/sewer service"* — a closed three-item list. `excluded_categories` came
  back `""`. Any pool containing roof work, repaving, security or management
  over-recovers. ¶12 additionally makes paving a landlord obligation, so
  parking-lot repaving is not recoverable here.
- **Minimum schema change:** `included_categories: string | null` alongside the
  existing `excluded_categories`. When `included_categories` is non-null it is
  authoritative and `excluded_categories` is ignored.
- **Engine change:** the filter at `8857` becomes inclusion-first.
- **Regression test:** tenant with
  `included_categories: "grounds, lighting, water/sewer"` and a pool containing
  a roof invoice → assert the roof invoice is excluded and appears in a named
  "not recoverable under this lease" list. Mutation: drop the inclusion branch →
  the roof invoice reappears and the assertion fails.
- **Re-extraction:** **yes.**

### M6 — Base-*year* stops are unrepresentable, so the gross expense gets billed

- **Where:** `expense_stop` in `LEASE_EXTRACTION_SYSTEM` is specified as
  *"dollar amount per square foot."* The tenant model carries an orphan
  `baseYear` field (`normalizeTenant`, and `script.js:1776` passes
  `raw.baseYear ?? null`) that the extraction contract cannot fill — it has no
  `base_year` output field, so it is always `null`.
- **Evidence:** Wink Davis ¶10 — tenant pays only the amount by which taxes
  exceed the **2001 tax year** and insurance exceeds the **first Lease year**.
  Billing the share of the gross amount over-bills by the entire base-year
  figure, every year, growing with the term.
- **Minimum schema change:** `base_year: number | null` and
  `base_year_scope: string | null` (which expenses the stop covers) in
  `LEASE_EXTRACTION_SYSTEM` + `quotes` entries; wire `base_year` through
  `script.js:1765` to the existing `baseYear` field.
- **Engine change:** deferred. Correct base-year arithmetic needs prior-year
  actuals, which the product does not hold. **The shippable step now is
  refusal:** if `base_year` is set and no base-year actuals exist, refuse to
  bill those categories and say why — do not bill the gross.
- **Regression test:** tenant with `base_year: 2001` and a tax invoice → assert
  the tax amount is **not** allocated and a flag names the base year and the
  missing prior-year actuals. Mutation: remove the refusal → the tax flows into
  `totalAllocated` and the assertion fails.
- **Re-extraction:** **yes.**

### M7 — `base_rent` null on all three

Resolved by **E1** below (mapping omission), pending R1 approval. No engine
change. Listed here only so the money list stays complete.

### M8 — Estimated payments not captured, so no balance can be computed

- **Where:** no field; `docs/CAM_ENGINE_GAP_ANALYSIS.md` `C2`.
- **Evidence:** Canvas pays `$1.50/SF` estimated monthly (§4.2); Wink Davis pays
  `$161.13/month` (SS#3). A reconciliation's output is what the tenant owes or
  is owed after true-up. Today MainStreet produces an allocation, not a
  reconciliation.
- **Minimum schema change:** `cam_estimate_rate: number | null` and
  `cam_estimate_basis: "psf_year" | "psf_month" | "monthly_amount" | null`.
  The basis field is not optional — Wink Davis states `$0.16/sf` *and*
  `$161.13 per month`, and reading the rate as monthly rather than annual is a
  12× error.
- **Engine change:** an estimated-payments ledger and a balance-due line. This is
  the largest piece of work in the plan and is **not** a defect fix — the
  headline number is absent, not wrong. Recommend scheduling after Priority 1.
- **Regression test:** written with the ledger, not before.
- **Re-extraction:** **yes** for the two fields (batch with the others even if
  the ledger ships later).

### M9 / M10 — Multi-tier and sub-pool allocation

- **Evidence:** Canvas §4.2.1 *"Building's proportionate share of Lot-wide common
  improvement costs"* (Project → Building → Tenant); §4.2.4 *"Special services
  not rendered to all areas comparably are allocated proportionately to the
  areas served."*
- **Recommendation: defer.** One denominator exists throughout the engine, and
  a single-building pilot property does not hit either case. Adding pools now
  means touching the allocation core twice. Record as known limitations in
  `docs/CAM_ENGINE_GAP_ANALYSIS.md` and revisit when a mixed-use property
  arrives.

### M11 — Amendment provenance not recorded

- **Where:** `amendments: []` on Canvas On Demand, whose sqft and end date both
  came from Amendment No. One. `_mkEvidenceSnapshot` (`script.js:5273`) already
  has an `amendmentId` slot; the ingest path (`script.js:1840`) hardcodes `null`.
- **Minimum schema change:** `source_document_type: "lease" | "amendment" | null`
  and `amendment_date` per extracted field, or at minimum per document.
- **Regression test:** assert that a tenant whose `leased_sqft` came from an
  amendment carries a non-null `amendmentId` on that field's snapshot.
- **Re-extraction:** **yes.** Priority: below M1–M6 — no immediate dollar error,
  high risk of a silent one when a second amendment arrives.

---

## 3. Priority 1b — gate defects (pending R3 approval)

### M5 — A lease that cannot be reconciled passes the review gate as high-confidence

- **Where:** `_confidenceScore` / `_confidence` / `_needsReview` are set on the
  ingest path; `review-engine.js:197` gates on `t._needsReview === true`.
  Wink Davis: score 90, `"high"`, `_needsReview: false`, while
  `_confidenceReasons: ["Square footage not found"]` and `overallSummary`
  says *"Review required before reconciliation."*
- **Scope after R3:** the reconciliation layer already refuses this tenant a
  "Verified" badge (`SQFT_APPROXIMATE` → `missing_inputs`,
  `reconciliation-engine.js:24`). The defect is that the operator is told the
  lease is fine at ingest.
- **Minimum change:** no schema change. A missing value in the set required for
  reconciliation (`leased_sqft` at minimum) must force `_needsReview = true` and
  cap `_confidence` below `"high"`. The prose summary and the machine-readable
  flags must be derived from one source, not computed twice.
- **Regression test:** `test-e2e-cam-needs-review.js` — extraction result with
  `leased_sqft: ""` → assert `_needsReview === true` **and**
  `_confidence !== 'high'` **and** that the summary text and the flag agree.
  *Mutation proof:* restore the old scoring → all three assertions must fail,
  and each must be checked individually (a single combined assertion can pass
  vacuously if one clause short-circuits).
- **Re-extraction:** **no.**

---

## 4. Priority 2 — provenance, completeness, presentation

None of these change a dollar amount.

### E1 — Wire `suite`, `base_rent`, `security_deposit` through the normalizer

*Pending R1 approval. Smallest fix in the plan, resolves nine findings.*

- **Where:** `script.js:1765`, the object literal passed to `normalizeTenant`.
- **Change:** three lines.
  ```js
  suite:            raw.suite ?? null,
  base_rent:        _pf(raw.base_rent),
  security_deposit: _pf(raw.security_deposit),
  ```
- **Regression test:** `test-extraction.js` — feed a raw API response containing
  all three, assert all three survive `_normalizeExtraction`. *Mutation proof:*
  remove any one line → its assertion fails. Assert on the **call site**, not the
  definition of `normalizeTenant` — the benchmark's own vacuous-assertion trap.
- **Re-extraction:** **yes**, to populate existing leases. Free — replay against
  `lease_documents.extracted_text`.
- **Caveat:** this assumes the model returns these fields. It should — they are
  in the contract — but the benchmark could not observe a raw response. **The
  first instrumented re-run must log the raw payload and confirm.** If the model
  is also not returning them, this becomes a B-class finding and the fix is a
  prompt change, not a mapping change. Do not close E1 without that check.

### P1a — Capture the page number

- **Where:** `script.js:1832` `page: null` hardcoded.
- **Minimum schema change:** the `quotes` object in `LEASE_EXTRACTION_SYSTEM`
  becomes `{ quote: string, page: number | null }` per field instead of a bare
  string. Stored text already carries `--- Page N ---` markers, so the model has
  what it needs.
- **Regression test:** assert a non-null `source_page` on at least one field for
  a document with page markers.
- **Re-extraction:** **yes.**

### P1b — `sourceFile` resolves to null because `fileName` is not yet set

- **Where:** `script.js:1831` `sourceFile: normalized.fileName || null`.
  `normalized.fileName` is assigned later in the pipeline; the tenant blob shows
  it populated while every DB row shows `source_file: null`.
- **Minimum change:** one line — set `fileName` on `normalized` before the
  snapshot loop, or pass the filename into `_normalizeExtraction`.
- **Regression test:** assert `source_file` equals the uploaded filename on
  every snapshot. *Mutation proof:* restore the ordering → assertion fails.
- **Re-extraction:** **yes** to backfill; the fix itself is ordering-only.

### P1c — `quote` is captured then dropped from both stores

- **Where:** in-memory snapshot has it (`script.js:1834`, 200-char cap);
  `_writeTenantFieldEvidence` payload (`script.js:5523-5540`) has no `quote` key;
  the table has no column; `fieldEvidence` is stripped from the JSON blob under
  `ms_useNormalizedEvidence`.
- **Minimum schema change:** migration adding `quote text`, `section text`,
  `extraction_model text`, `amendment_id text` to `tenant_field_evidence`;
  add the four keys to the payload. `_evidenceRowToSnapshot` (`script.js:5472`)
  must round-trip them.
- **Regression test:** write a snapshot with a quote, read it back through
  `_evidenceRowToSnapshot`, assert the quote survives the round trip.
- **Re-extraction:** **yes** to backfill existing leases.
- **Note:** apply to the **pilot project only** (`bhmktujbxdbvdmpybmad`).
  Production (`zhsuhehgehbzkmzurzyf`) is out of scope for this plan.

### P2 — The surviving quote is truncated mid-sentence

- **Where:** two independent truncations — `script.js:1820` and `1834` both
  `.slice(0, 200)`, and the display summary in `lease-intelligence.js` cuts to
  roughly 80 chars with an ellipsis.
- **Evidence:** the Canvas audit citation stops at *"…to review Landlord's…"* —
  before the 10% threshold, the 15-day remittance, and all of §4.2.4.
- **Minimum change:** raise the storage cap (a clause is not a label; 200 chars
  cannot hold §4.2.3) and truncate only at display time, with the full text
  reachable.
- **Re-extraction:** **yes** to recapture at the larger cap.

### P3 — Model provenance split across two locations

- **Where:** `lease_documents.extraction_model` is NULL; the model is recorded
  only at `properties.data.tenants[]._modelRouting.model` (`claude-opus-4-8`).
  `_mkEvidenceSnapshot` has an `extractionModel` slot that the dual-write drops
  (same cause as P1c).
- **Minimum change:** populate `lease_documents.extraction_model` on the write
  that creates the row; the `extraction_model` column added in P1c covers the
  per-field case.
- **Regression test:** assert `extraction_model` is non-null after an extraction.
  **This must not be satisfied by writing a hardcoded model name** — SEC-2 and
  the evidence-honesty rule require the value to come from the response that
  actually performed the work. `test-evidence-honesty.js` is the right home.
- **Re-extraction:** **no** for new leases; yes to backfill.

### P4 — `audit_rights` as a boolean

- **Where:** `api/_claude-tasks.js`: *"audit_rights: Return true if tenant has
  explicit right to audit CAM records."* Working as specified.
- **Minimum schema change:** `audit_rights` becomes an object —
  `{ exists: boolean, auditor: string|null, cost_bearer: string|null,
  error_threshold_pct: number|null, threshold_consequence: string|null,
  remittance_days: number|null, shortfall_days: number|null,
  overpayment_remedy: string|null }`. Canvas §4.2.3–4.2.4 populates every one
  of these.
- **Breaking change:** `normalizeTenant` coerces `audit_rights` to a boolean
  (`script.js:1785-1789`). Both shapes must be accepted during migration.
- **Regression test:** feed the Canvas §4.2.3 text, assert
  `error_threshold_pct === 10` and `remittance_days === 15`.
- **Re-extraction:** **yes.**
- **Priority note:** this is the single largest gap between what the Evidence
  Viewer promises and what it holds, but it changes no dollar amount. Schedule
  after Priority 1.

### P5 / P6

P5 is resolved by E1. P6 (amendment provenance) is tracked as M11.

---

## 5. Proposed sequencing

**Everything that changes `LEASE_EXTRACTION_SYSTEM` ships as one prompt version
and one re-extraction pass.** Six separate extraction changes means six
re-extraction passes and six chances for stored leases to diverge from the
contract that produced them.

**Wave 1 — no schema change, no re-extraction.** Ship independently, verify in
the pilot before touching the contract.
- E1 (three-line mapping fix) — *gated on the raw-response check in §4*
- P1b (`fileName` ordering)
- M1a (stop claiming an inert cap is enforced)
- M5 (review gate) — pending R3
- Quarantine or delete `allocation-engine.js`; repoint `package.json` `main`
  and the `README.md` description at the live engine

**Wave 2 — one contract revision, one re-extraction.** New fields:
`building_total_sqft`, `has_cam_clause`, `cap_scope`, `included_categories`,
`base_year`, `base_year_scope`, `cam_estimate_rate`, `cam_estimate_basis`,
`base_rent`/`security_deposit`/`suite` confirmation, per-field `page`,
structured `audit_rights`, `source_document_type`.
Plus the `tenant_field_evidence` migration (P1c) and the larger quote cap (P2).
Replay against stored `extracted_text`. **Pilot project only.**

**Wave 3 — engine changes, behind the Wave 2 data.** M2 mismatch flag, M3 pool
exclusion, M1b controllable split, M4 inclusion-first filter, M6 refusal,
M11 amendment provenance, P3 model provenance.

**Wave 4 — the estimated-payments ledger (M8).** Largest single piece; converts
allocation into reconciliation. Not a defect fix.

**Deferred, recorded as known limitations:** M9, M10 (multi-tier and sub-pool
allocation), full base-year arithmetic beyond refusal.

---

## 6. Testing rules that apply to every item

Carried forward from the work that produced this codebase's existing suites:

1. **No fix ships without a regression test that would have caught the defect.**
2. **Every test must be mutation-proven.** Revert the fix by exact string
   replacement with an `assert` that the replacement occurred — perl-style
   quoting and `||`/`?:` precedence have both silently no-oped here before, and
   a mutation that does not apply is indistinguishable from a passing test.
3. **No vacuous assertions.** Scope regexes to the call site, not the
   definition; strip comment lines with the `code()` helper so a test cannot be
   satisfied by the fix's own explanatory comment.
4. **Exercise real paths.** `test-allocation.js` currently validates
   `allocation-engine.js`, which the app never loads. Retarget it before adding
   money-path cases to it.
5. **Count the suite before and after.** `test-pilot-readiness.js` silently
   dropped 39→36 once and the regression shipped.

---

## 7. What I am not proposing

- No change to `main` or to production Supabase (`zhsuhehgehbzkmzurzyf`).
- No unfreezing of the pilot for this plan's approval — Wave 1 needs it, and
  that is a separate decision.
- No reclassification of any A/B/C benchmark finding. B1 (Wink Davis derivable
  square footage) remains the only model-quality finding in the set.
- No new features. Every item traces to a benchmark finding.
- No Yardi integration work (see the competitive analysis; unchanged).

---

## 8. Recommended decisions

1. **Approve or reject R1–R4 individually.** R1 and R3 change what gets built;
   R2 changes ordering; R4 makes the provenance work cheaper than the benchmark
   suggested.
2. **Confirm Wave 1 may proceed against the pilot**, which requires lifting the
   freeze for that branch only.
3. **Confirm the raw-response check** happens before E1 is closed — it is the
   one place this plan rests on an inference rather than an observation.

*Prepared 2026-08-08. No code changed. All line references against `pilot` at
`bf71a35`.*
