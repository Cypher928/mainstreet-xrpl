# Phase 0 Benchmark — Three Real SEC-Derived Leases

**Status:** measurement only. No code changed. Pilot remains frozen at `73041d1`.

This is the first time MainStreet has been run against real commercial leases
rather than fixtures. Three leases, pulled from SEC EDGAR filings, uploaded
through the real UI on 2026-08-08, extracted by the production pipeline.

Every finding below is classified into exactly one of:

| Class | Meaning |
|---|---|
| **A — Correct** | Extracted, and the value matches the instrument. |
| **B — Model quality** | The schema has a field for it, the lease states it plainly, the pipeline returned nothing or something wrong. |
| **C — Schema too narrow** | The lease says something material that no field in the extraction contract can hold. Not the model's fault. |
| **D — Unattributed** | Wrong or empty, and I cannot tell whether the model or the persistence layer is responsible without an instrumented re-run. Recorded as unknown rather than guessed. |

Category D exists because forcing a finding into A/B/C when the evidence does
not support the attribution is exactly the failure mode this benchmark is
supposed to catch. See `docs/ARCHITECTURE_PRINCIPLES.md` Principle 8.

---

## The benchmark set

| # | Tenant | Document | Structure | Why it is a useful test |
|---|---|---|---|---|
| 1 | Consumer Programs Incorporated (CPI Corp) | 8-K Ex. 10.2, 2012 | Absolute net, single tenant, whole building | **Has no CAM clause at all.** Tests whether the product can say "there is nothing to reconcile here." |
| 2 | Canvas On Demand, LLC (CafePress) | S-1 Ex. 10.9 + Amendment No. One | TICAM, multi-tenant flex | Full reconciliation machinery: estimate, statement, audit, true-up. Plus an amendment that changes the premises. |
| 3 | Wink Davis Equipment Company (Speizman) | 10-K Ex. 10.42, 2001 | Base-year stops + narrow net CAM | GAR standard form. Everything material is in the Special Stipulations, not the printed form. |

Ingestion was faithful. pdf.js text extraction reproduces 19,175 / 25,785 /
14,570 characters against the 19,255 / 25,824 / 14,653 stored by the pipeline —
the deltas are page-marker formatting. **No finding below is caused by text-layer
loss.** Every miss is model or schema.

All three routed to `_modelRouting.tier = "complex"`, `model = "claude-opus-4-8"`,
with reason *"Extraction confidence unknown — routing conservatively."*

---

## Two corrections to the 2026-08-08 verbal read

Both of these change what a reviewer should do, so they are stated before the
findings rather than buried in them.

**1. Wink Davis square footage is derivable from the lease. My earlier "no
footage information exists in this document" was wrong.**

Special Stipulation #3 reads:

> Tenant pays its pro rata share of common area maintenance, covering grounds
> care, outside lighting, and water/sewer service. **CAM is currently $0.16/sf,
> or $161.13 per month.**

$161.13 × 12 ÷ $0.16 = **12,085 SF**. Cross-check against the rent schedule:
$5,147.39/mo → $61,768/yr ÷ 12,085 = **$5.11/SF/yr**, a credible 2001 Smyrna GA
office/warehouse rate. Reading $0.16/sf as monthly instead gives 1,007 SF and
$61/SF/yr, which is not a warehouse rate — so the annual reading is correct.

My earlier sweep searched `square f`, `sq. ft`, `rentable area`, `usable area`,
`floor area`. The lease writes it `$0.16/sf`. The sweep missed it. This moves
the finding from "correct refusal on absent data" to "defensible refusal on a
value a CRE analyst would have derived."

**2. The 14,000 SF north-end suite is not part of the premises. My earlier
five-figure CAM-swing flag was wrong.**

The amendment says *"Section 10.21 amended to include an unnumbered north-end
suite of approximately 14,000 square feet."* Section 10.21 is the **Right of
First Offer Contingency**. The 14,000 SF is added to the ROFO scope, not the
leased premises. 35,164 + 19,613 = 54,777 exactly, and **54,777 is correct and
complete.** Nothing to chase.

---

## Lease 1 — CPI Corp

### A — Correct

| Field | Value | Source |
|---|---|---|
| `tenant_name` | Consumer Programs Incorporated | Preamble. Correctly rejected "1706 Washington Avenue, LLC" as the landlord. |
| `leased_sqft` | 300,000 | §2A "approximately 300,000 square feet of gross leasable area" |
| `start_date` | 2012-07-27 | §3 "commencing upon closing"; closing = execution date on signature page |
| `end_date` | 2032-07-26 | §3, stated |
| `lease_type` | Triple Net (NNN) | Correct by inference — §7 tenant insures the building, §8 tenant pays all taxes, §9 tenant maintains **roof and structure**, §12 tenant pays all utilities |
| `cap` | null | Correct. No cap exists. |
| `pro_rata_method` | null | Correct, and the review note *"Pro-rata share denominator not confirmed"* is the right thing to say |
| `renewal_options` | "2 successive options to extend for 5 years each at market rates; written notice required 180 days before Term expiration" | §3, verbatim-accurate |
| `property_name` | CPI Headquarters, 1706 Washington Avenue, St. Louis, MO 63103 | §2A |

This is a strong result. §9 pushing roof and structure to the tenant is what
makes this a bond-type lease rather than ordinary NNN, and the classifier got
there without the phrase "triple net" appearing anywhere in the document.

### C — Schema too narrow

**C1. Rent escalation cannot be represented at all.** §5C:

> Adjusted each anniversary … by the change in the Consumer Price Index (CPI-U,
> Midwest Urban Average, 1982-84=100) versus the Base Price Index, **or by 3.5%,
> whichever is greater.** Minimum Rent will not be reduced below the amount first
> due.

An indexed escalator with a floor and a ratchet, over a 20-year term. At the
3.5% floor alone, Year 1's $300,000 becomes roughly $576,000 by Year 20. There is
no `rent_escalation` field, no index field, no floor field. This is the single
most financially significant clause in the lease and the contract has nowhere to
put it.

**C2. "This lease has no CAM provision" is unrepresentable.** CPI has no common
area, no proportionate share, no expense pool, no reconciliation. The tenant pays
every vendor directly. MainStreet's model of a tenant assumes a CAM relationship
exists; the extraction returned `overallSummary: "Lease complete. No CAM Cap."`
and `_confidenceScore: 100`. "Complete" here means "all fields populated," not
"reconcilable" — and there is no field whose value is *"not a CAM tenant."*

**C3. Rent abatement tied to untenantable area** (§15C) and the **2× market
holdover** (§25) have no representation.

### D — Unattributed

**D1. `base_rent` = null.** §5B states *"Lease Year 1: Monthly Minimum Rent
$25,000; Annual Minimum Rent $300,000."* The schema has `base_rent` and
instructs the model to look for "Minimum Rent." See the cross-lease pattern below.

**D2. `security_deposit` = null.** §5D: *"$75,000.00."*

**D3. `suite` = `""`.** Whole building; arguably correct, but the value is an
empty string where the contract specifies `null`.

---

## Lease 2 — Canvas On Demand (CafePress)

This is the only one of the three with a real CAM reconciliation, so it carries
most of the weight.

### A — Correct

| Field | Value | Why it is non-trivial |
|---|---|---|
| `leased_sqft` | 54,777 | **Amendment-aware.** Article I says `RENTABLE FLOOR AREA OF TENANT'S SPACE: 35,164 SQUARE FEET`. 54,777 appears only on page 6, in Amendment No. One. The pipeline read the amendment and overrode the reference-data table. |
| `end_date` | 2015-12-31 | Same — the original term expires 2013-02-28. This comes from the 53-month extension. |
| `start_date` | 2010-01-01 | Article I Commencement Date, correctly kept from the base lease rather than the amendment |
| `lease_type` | Triple Net (NNN) | Amendment states it explicitly |
| `cap` | 5.25 | §4.2 *"Items Landlord directly controls may not increase more than 5.25% per annum"* — the number is right (see M1 for the qualifier that was lost) |
| `pro_rata_method` | rentable | §4.2 *"rentable square feet of Premises / total rentable square feet of Building"* |
| `renewal_options` | "2 options of 3 years each; 180 days notice; 1st at 97% escalated rate +3%/yr; 2nd at market rate" | Amendment. Dense and accurate. |
| `excluded_categories` | "capital expenditures and their depreciation/amortization, mortgage interest/amortization, tenant-specific special-charge services" | §4.2.1. **Complete and correct** — and this field drives the allocation math, so it matters. |
| `audit_rights` | true | §4.2.3 exists |
| `property_name` | 10700 World Trade Park, Raleigh, North Carolina 27709 | Article I |

Amendment-aware extraction on sqft and term is the strongest single result in
the benchmark. Most tools take the reference-data table and stop.

### C — Schema too narrow

**C4. The cap cannot be qualified.** The lease caps *"items Landlord directly
controls."* The schema's `cam_cap` is a bare number. There is no
controllable/uncontrollable distinction anywhere in the extraction contract or
the engine. → **money, M1.**

**C5. The pro rata denominator is not captured.** Article I states
`TOTAL RENTABLE FLOOR AREA OF THE BUILDING: 134,809 SQUARE FEET`. The schema
records *how* the denominator is defined (`pro_rata_method: "rentable"`) but not
*what it is*. 54,777 / 134,809 = **40.63%**. → **money, M2.**

**C6. The reconciliation mechanics collapse to one boolean.** §4.2.2–4.2.4
contain: annual Landlord's Statement per GAAP certified by Landlord's
Representative; tenant's independent auditor at tenant cost; findings subject to
landlord's auditor and final/binding; 15-day remittance; **10% aggregate error
threshold triggering landlord reimbursement of audit cost**; shortfall due as a
lump sum within 45 days; overpayment credited against future TICAM installments
or refunded within 45 days of term end; stub-period estimate with true-up on the
final statement; accrual basis. All of it is stored as `audit_rights: true`.

This is the schema, not the model — `api/_claude-tasks.js` instructs it
literally: *"audit_rights: Return true if tenant has explicit right to audit CAM
records."* It was asked for a boolean and returned a correct boolean.

**C7. Two-tier allocation.** §4.2.1 includes *"Building's proportionate share of
Lot-wide common improvement costs"* — Project → Building → Tenant. One
denominator exists. → **money, M9.**

**C8. Sub-pool allocation.** §4.2.4: *"Special services not rendered to all areas
comparably are allocated proportionately to the areas served."* → **money, M10.**

**C9. The estimated CAM rate is not captured.** §4.2: *"estimated at $1.50 per
square foot, paid monthly with Base Rent."* Without the estimate there is no
estimated-payments ledger, and without that there is no balance due or credit —
which is the actual output of a reconciliation. → **money, M8.**

**C10. Variable premises.** §2.1 reserves Landlord's right *"to re-measure the
Premises and adjust rentable square feet (and Rent accordingly)."* sqft is
modelled as a constant.

**C11. Amendment provenance.** `amendments: []` — empty, despite the extraction
having correctly *used* the amendment for two fields. A reviewer looking at
54,777 cannot see it came from a document dated 18 months after the lease.

**C12. Rent/TICAM abatement** proportional to untenantable area (§7.1.1) is
unrepresentable.

### D — Unattributed

**D4. `base_rent` = null**, despite Exhibit D and the amendment's
`$27,251.56/month plus TICAM` schedule.
**D5. `security_deposit` = null**, despite Article I `SECURITY DEPOSIT: $16,116.83`.
**D6. `suite` = `""`**, despite Article I `TENANT'S SPACE: Suite 102`.

---

## Lease 3 — Wink Davis (Speizman)

### A — Correct

| Field | Value | Source |
|---|---|---|
| `tenant_name` | Wink Davis Equipment Company | Preamble, among four named parties including two brokers — correctly picked the tenant |
| `start_date` / `end_date` | 2001-05-01 / 2006-05-31 | ¶2, sixty-one months |
| `lease_type` | **Modified Gross** | Correct — see below |
| `renewal_options` | "1 option to renew for 3-year term with 120 days prior written notice; Year 1: $5,650/mo, Year 2: $5,750/mo, Year 3: $5,850/mo" | Special Stipulation #4, exact |
| `cap` | null | Correct, no cap |
| `property_name` | 4938 South Atlanta Road, Smyrna, GA 30080 | ¶1 |

**On the lease type.** ¶10 is the deciding clause: tenant pays *"the amount by
which taxes … exceed the 2001 tax-year baseline"* and *"the excess cost of
fire/extended-coverage and public liability insurance over the first Lease
year's cost."* Those are **base-year expense stops** — the landlord absorbs the
base year and the tenant pays only the increment. A triple net tenant pays taxes
and insurance from dollar one; there is no baseline to exceed. ¶12 also keeps
roof, foundations, exterior walls and underground utilities with the landlord.

The structure is properly **Industrial Gross with base-year stops**, with CAM
billed net under ¶7/SS#3. In a four-way classifier, "Modified Gross" is the
right bucket. The net CAM component is what makes it read NNN-ish, but the
stops dominate. **Keep the classification.**

### B — Model quality

**B1. `leased_sqft` = `""`, and ~12,085 SF was derivable.** Special Stipulation
#3 states both the CAM rate and the CAM dollar amount; the quotient is the
footage. The pipeline correctly reported *"Lease incomplete — missing:
leased_sqft. Review required before reconciliation"* with
`_confidenceReasons: ["Square footage not found"]`, which is honest and
well-surfaced. But a CRE analyst reads SS#3 and derives it. The right output is
a derived value at reduced confidence with the arithmetic shown, not a blank.

This is the only clean B in the benchmark: supported field, information present,
nothing returned.

### C — Schema too narrow

**C13. Base-*year* stops cannot be stored.** The schema's `expense_stop` expects
*"dollar amount per square foot."* ¶10 states a base **tax year** (2001) and a
base **insurance year** (first Lease year). The tenant model even carries an
orphan `baseYear` field that the extraction contract cannot fill — it came back
`null`. → **money, M6.**

**C14. The CAM scope is not captured.** SS#3 limits recoverable CAM to *"grounds
care, outside lighting, and water/sewer service"* — a three-item inclusion list,
not an exclusion list. `excluded_categories` came back `""`. Note ¶12 makes
**paving** a landlord obligation and SS#3 does not list it as recoverable, so
parking-lot repaving — a classic disputed line item — is landlord cost here.
→ **money, M4.**

**C15. Two separate recovery streams with different timing.** CAM is monthly
additional rent (¶7). The tax/insurance escalation is *"payable within 15 days of
notice"* on demand (¶10). MainStreet has one recovery stream.

**C16. The stated CAM rate and amount** ($0.16/SF, $161.13/month) have no field.
→ **money, M8.**

**C17. `audit_rights: null` is correct** — the GAR form grants no audit right.
But "the form is silent, and Georgia law supplies no default" is different from
"not addressed," and the explainability text (*"default rights may apply per
jurisdiction"*) is a hedge the schema cannot make precise.

### D — Unattributed

**D7. `base_rent` = null**, despite SS#1's full five-year rent schedule.
**D8. `security_deposit` = null**, despite ¶5's `$5,550.23` — which equals the
final year's monthly rent exactly, a clean cross-check the pipeline never made.
**D9. `suite` = `""`**, despite ¶1 *"Suites 800 and 900."*

---

## The cross-lease pattern behind category D

Three fields are empty on **all three** leases, in all three cases where the
lease states the value plainly and unmissably:

| Field | CPI | CafePress | Wink Davis | In the lease? |
|---|---|---|---|---|
| `base_rent` | null | null | null | Yes — 3/3, stated as a schedule or an annual figure |
| `security_deposit` | null | null | null | Yes — 3/3, stated as a single dollar amount |
| `suite` | `""` | `""` | `""` | 2/3 (`Suite 102`, `Suites 800 and 900`) |

0-for-3 on fields this easy is not what model-quality failure looks like.
Model-quality failure is uneven. Meanwhile `excluded_categories` — a much harder
field requiring synthesis of a long inclusion/exclusion schedule — came back
correct and complete on the lease that has one.

`suite` returning `""` rather than the `null` the contract specifies is the
strongest signal: `""` is a default-initialised value that was never overwritten,
not a model output. The leading hypothesis is that these fields are dropped
between the API response and persistence, not that the model failed to find them.

**I have not confirmed this**, and confirming it means one instrumented re-run
capturing the raw API response — which requires unfreezing. Until then these
stay in category D. Do not report them as model quality.

---

## Priority 1 — failures that can produce a wrong CAM dollar amount

Ordered by expected magnitude of error. These are correctness defects, not
feature gaps: each one produces a number that is wrong without saying so.

**M1 — The cap is applied to the whole pool instead of controllables only.**
*Canvas On Demand, 5.25%.* The lease caps only items the landlord directly
controls; taxes, insurance and utilities pass through uncapped. The engine caps
the tenant's entire total. **Direction: under-bills the landlord.** The customer
loses money and the statement looks correct. Already logged as `C3` in
`docs/CAM_ENGINE_GAP_ANALYSIS.md`; this is the first real document proving it
bites.

**M2 — The pro rata denominator is derived, not read.** The lease states
134,809 SF. MainStreet builds the denominator from the tenants entered into the
property. If a landlord enters six of twenty tenants, every share is inflated by
the ratio of entered-to-total area. Correct share here is 40.63%; a property
holding only these tenants would compute something far larger. **Direction:
over-bills, potentially by multiples.** This is the largest-magnitude error
available in the product and it is silent — there is no reconciliation between
the denominator the engine uses and the one the lease states.

**M3 — No way to say a lease has no CAM.** *CPI Corp.* Absolute net, single
tenant, tenant pays vendors directly. Dropped into a property with a CAM pool,
MainStreet will allocate 300,000 SF worth of share to it. **Direction:
fabricates a charge that has no contractual basis.** The extraction scored it
`_confidenceScore: 100` and `"Lease complete."`

**M4 — Recoverable CAM scope is not enforced.** *Wink Davis.* SS#3 recovers
grounds care, outside lighting, and water/sewer only. Any pool containing roof
work, repaving, security or management fees over-recovers against this tenant.
**Direction: over-bills.** Note the product's inclusion model is exclusion-based
(`excluded_categories`), which cannot express a closed inclusion list at all —
so this is C-class as well as money-class.

**M5 — A lease that cannot be reconciled is scored "high" confidence and not
flagged for review.** *Wink Davis:* `_confidenceScore: 90`, `_confidence:
"high"`, `_needsReview: false` — on a tenant with no square footage, for whom no
share can be computed. The `overallSummary` says "Review required before
reconciliation," but the machine-readable flags say the opposite, and the flags
are what gates the workflow. **Direction: lets an unusable lease into the
reconciliation pool.**

**M6 — Base-year stops are unrepresentable, so the full expense gets billed.**
*Wink Davis ¶10.* If taxes are billed at the tenant's share of the gross amount
rather than the share of the increment over the 2001 base, the tenant is
over-billed by the entire base-year amount every year. **Direction: over-bills,
and grows with the term.**

**M7 — `base_rent` is null on all three.** Any calculation keyed to rent —
percentage rent, a cap expressed as a percentage of rent, a balance-due
statement showing rent and recoveries together — has no input. **Direction:
depends on downstream handling; at minimum the deliverable is incomplete.**
Attribution unresolved (category D).

**M8 — Estimated payments are not captured, so no balance can be computed.**
Canvas pays $1.50/SF estimated monthly; Wink Davis pays $161.13/month. A CAM
reconciliation's output is *what the tenant owes or is owed after true-up*.
Without the estimate stream, MainStreet can produce an allocation but not a
reconciliation. Already logged as `C2`. **Direction: the headline number is
absent, not wrong** — which is why it sits below M1–M6.

**M9 / M10 — Multi-tier and sub-pool allocation.** Canvas §4.2.1 Lot→Building
share, and §4.2.4 special services allocated to areas served. One denominator
exists. **Direction: mis-allocates whenever a property has more than one
expense pool.** Lower priority only because a simple single-building pilot
property will not hit it.

**M11 — Amendment provenance is not recorded.** `amendments: []` on the lease
whose two most important values came from an amendment. If a second amendment
arrives, nothing distinguishes it from a correction to the first, and the
Evidence Viewer cannot show which instrument a number came from. **Direction:
no immediate dollar error; high risk of a silent one later.**

## Priority 2 — completeness and provenance

Real, but none of these change a dollar amount.

**P1 — There is no column to store a citation.** `tenant_field_evidence` has
`source_file` and `source_page`, and both are `NULL` on all 21 rows across all
three leases. There is no `quote` column at all. The extraction contract *does*
ask the model for a verbatim clause per field (`quotes` object,
`api/_claude-tasks.js`), and the stored text carries `--- Page N ---` markers, so
both the quote and the page anchor exist at extraction time and are dropped at
persistence time. **This is plumbing, not model quality, which makes it cheap
to fix.**

**P2 — The one surviving quote is truncated mid-sentence.**
`_explainability.fieldSummaries.audit_rights` holds:
`Audit rights clause exists. Source: "Tenant may engage an independent auditor,
at Tenant's cost, to review Landlord's…"` — cut off before the 10% threshold,
the 15-day remittance, and all of §4.2.4. It is a display string, not a
structured citation, and it has no page number. *(This corrects the 2026-08-08
verbal statement that no citation survives anywhere — a truncated one does.)*

**P3 — Model provenance is split across two places.**
`lease_documents.extraction_model` is `NULL` on all three rows; the model is
recorded only in `properties.data.tenants[]._modelRouting.model`
(`claude-opus-4-8`). Honest — nothing false is displayed — but the Evidence
Viewer's own table cannot answer "which model produced this."

**P4 — `audit_rights` as a boolean** (see C6). The most commercially
significant paragraph in the Canvas lease is stored as one bit.

**P5 — `suite`, `security_deposit` empty across the set** (category D).

**P6 — `amendments: []`** (see C11 / M11).

---

## What this benchmark actually establishes

**Extraction quality is better than the schema.** On every field the contract
supports and the lease states plainly, the pipeline was right — including two
genuinely hard calls: reading an amendment over a reference-data table, and
classifying a lease as Modified Gross from base-year-stop language with no
label present. One clean model miss in three leases (B1), and even that one was
refused loudly rather than guessed.

**The binding constraint is the field schema and the engine, not the model.**
Of the eleven money-affecting failures, one is arguably model quality (M7,
unattributed), one is an engine defect already logged (M1), and the rest are
things the leases say that the product has no field to hold.

**The refusal behaviour works.** Wink Davis produced a blank and said why. CPI
produced a review note about the unconfirmed denominator. Canvas flagged
nothing because nothing was missing — which is correct given what the schema
asks for, and misleading given what the lease contains.

**The evidence chain is not yet a chain.** The model is asked for citations, it
returns them, and they are discarded before storage. Every field in the Evidence
Viewer for these three leases reads `estimated / AI-extracted` with no source.
That is the gap between what the product claims and what the database holds.

---

*Prepared 2026-08-08 against pilot Supabase `bhmktujbxdbvdmpybmad`, read-only.
Source PDFs supplied by the operator; text independently re-extracted with
pdf.js 4.10.38 and reconciled against the pipeline's stored text before any
finding was recorded.*
