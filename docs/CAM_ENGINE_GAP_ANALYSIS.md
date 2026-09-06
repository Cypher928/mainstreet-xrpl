# CAM Engine — capability matrix and gap analysis

> **Update (Aug 2026).** A production-readiness audit of the engine found six
> defects distinct from C1–C3, all now fixed: currency strings silently valued
> at $0 or $1, invoices from every year included in a single-year run, the lease
> exclusion schedule not binding direct matches, a matcher that billed whole
> invoices on a naive substring hit, an unguarded divide-by-zero, and a SECOND
> CAM engine that the test suite covered while production used the other one.
> The worst of them — unit "1" matching every dated invoice at 90% confidence —
> was found while writing the test, not during the audit. See the CAM-1..CAM-6
> section at the end of this file.

Benchmarked against CapVeri's publicly described methodology, August 2026.
Every row below was verified against the code, not inferred from feature names.

**The headline.** MainStreet **extracts** most of the lease fields a full CAM
engine needs and **applies** almost none of them. `admin_fee_pct`,
`gross_up_pct` and `expense_stop` are all pulled out of the lease by the
extraction prompt (`script.js:609-611, 652-654`) and never reach the
calculation. The abstraction layer is roughly a year ahead of the arithmetic.

That is better news than it sounds: the hard, uncertain part (reading the lease)
is largely built, and what remains is deterministic arithmetic with no AI risk
and a known specification.

---

## What the engine actually computes

The whole of it, from `script.js:9276-9302`:

```js
proRata     = lease.sqFt / totalSqFt
sharedTotal = Σ(shared invoices not in lease.excludedCategories) × proRata
ownTotal    = Σ(invoices direct-matched to this tenant)
rawTotal    = sharedTotal + ownTotal
if (capPercentage && capBaseAmount) {
  cap = capBaseAmount × (1 + capPercentage / 100)
  if (rawTotal > cap) rawTotal = cap        // applied to the ENTIRE total
}
```

`reconciliation-engine.js` is 158 lines and `allocation-engine.js` is 43. There
is no other CAM arithmetic in the codebase.

---

## 1. Capability matrix

### Ingest and categorise expenses

| Capability | Status | Evidence |
|---|---|---|
| Recoverable vs non-recoverable | ⚠️ **Partial — and inconsistent** | Two mechanisms that disagree. `lease.excludedCategories` drives the math. The **"CAM eligible" checkbox** in the invoice register (`property-os.js:748`) is referenced **zero times** in the allocation path — it changes a display total and nothing else. |
| Controllable vs uncontrollable | ❌ **Not implemented** | No data field anywhere. The word appears only in extraction prompts and narrative prose (`script.js:13360`, `13599`). |
| CapEx charged as OpEx | ⚠️ **Partial** | `api/validate-lease.js:160` `STRUCT_EXCLUSIONS` is an **AI advisory check**, not a deterministic engine rule. |

### Gross-up

| Capability | Status | Evidence |
|---|---|---|
| Variable expenses only | ❌ **Not implemented** | No expense is classified fixed vs variable. |
| Fixed expenses excluded | ❌ **Not implemented** | — |
| Lease-specific occupancy threshold | ⚠️ **Extracted, never applied** | `gross_up_pct` extracted (`script.js:653`); zero references in any calculation. |
| BOMA-aligned methodology | ❌ **Not implemented** | — |

### Pro-rata

| Capability | Status | Evidence |
|---|---|---|
| Tenant RSF ÷ building RSF | ✅ **Fully supported** | `script.js:9282` |
| Multiple denominator support | ❌ **Not implemented** | One global `totalSqFt`. |
| Pool-specific allocations | ❌ **Not implemented** | No pool concept in the math. |

### Cap enforcement

| Capability | Status | Evidence |
|---|---|---|
| Non-cumulative cap | ⚠️ **Partial — and incorrect** | Applied, but to the tenant's **entire** total rather than to controllables only. |
| Cumulative cap | ❌ **Not implemented** | Single-year only; no prior-year carry. |
| Cap bank | ❌ **Not implemented** | — |
| Controllables capped, uncontrollables passed through | ❌ **Not implemented** | The distinction does not exist. |

### Final tenant true-up

| Capability | Status | Evidence |
|---|---|---|
| Adjusted recoverable × pro-rata | ✅ **Fully supported** | — |
| Less estimated payments | ❌ **Not implemented** | The product says so itself: *"Variance from monthly estimates requires payment history data not yet in this system — please reconcile against your accounts payable records."* (`script.js:15752`) |
| Final balance due or credit | ❌ **Not implemented** | Follows from the above. |

### Lease mapping

| Field | Status |
|---|---|
| Base year / expense stop | ⚠️ **Extracted, never applied** — `expense_stop`; `BASE_YEAR_MISMATCH` is a warning code, not a computation |
| Gross-up threshold | ⚠️ **Extracted, never applied** |
| Cap type | ❌ **Not implemented** — there is one cap behaviour, not a type |
| Cap percentage | ✅ **Fully supported** |
| Exclusions | ✅ **Fully supported** — drives the math |
| Controllable / uncontrollable | ❌ **Not implemented** |
| Admin fees | ⚠️ **Extracted, never applied** — `admin_fee_pct` |
| Pro-rata denominator | ❌ **Not implemented** — single implicit denominator |

**Tally: 4 fully supported · 6 partial or extracted-but-unused · 10 not
implemented.**

---

## 2. Gap analysis

### Critical — these are not gaps, they are defects

**A. "CAM eligible" changes nothing.** A control in the invoice register implies
it excludes an invoice from the reconciliation. It does not. A manager who
unticks it and sends the statement bills a tenant for an expense she believed
she had removed. This is a broken promise in the money path, and it is worse
than a missing feature because it is silently wrong in a direction that reaches
a tenant. *Common: every property. Every type.*

**B. No estimated payments, therefore no true-up.** A CAM reconciliation's
**output** is "you owe $4,212" or "you are owed $1,180". MainStreet computes the
tenant's share of actual expenses and stops. Everything before the true-up is
intermediate work. *Universal — every property type, every reconciliation.*
Without it MainStreet is a CAM *calculator*, not a CAM *reconciliation* product,
and a manager still finishes the job in Excel — which means the time saving we
are about to measure in Phase 0 will be structurally capped.

**C. The cap is applied to the whole total.** Standard lease language caps
*controllable* expenses; taxes, insurance and utilities pass through uncapped.
Applying the cap to everything under-bills the landlord — the customer loses
money and won't know. *Common wherever a cap exists, which is most retail NNN.*

### Important, but after paying customers

**D. Base year / expense stop.** Required for office, essentially absent in
retail and industrial NNN. Extracted already; the arithmetic is small. *Common
in office, edge case in our stated target market.*

**E. Gross-up.** Same shape: office standard, retail rarity. Needs a
fixed/variable classification of expenses, which is the real work — the
occupancy arithmetic is trivial. *Common in office.*

**F. Admin fee.** A percentage on the controllable pool. Extracted already,
small arithmetic. *Fairly common across types.*

**G. Multiple denominators / expense pools.** Needed for mixed-use, phased
centres, and anchor-excluded pools. *Uncommon below ~100k sqft; common above.*

### Future enterprise

**H. Cumulative caps and cap banks.** Requires multi-year reconciliation history
we do not yet store. *Uncommon in small portfolios; expected in institutional.*

**I. BOMA formalism, CapEx amortisation schedules.** Institutional
expectations. *Edge case for our first customers.*

---

## 3. Prioritised roadmap, ranked by customer impact

**Critical before charging — now Phase 1A, mandatory** (`docs/ROADMAP.md`)
1. **C1** Fix or remove the "CAM eligible" control *(defect, money path)*
2. **C2** Estimated payments ledger → final balance due/credit *(the deliverable)*
3. **C3** Controllable/uncontrollable classification → cap the controllables only
   *(defect, costs the landlord money)*

These are classified as **correctness**, not as feature gaps. They cannot be
waived for a design partner: a partner tolerates a missing feature they were
told about, not a number that is wrong without telling them.

**Important after pilot**
4. Admin fee on the controllable pool
5. Base year / expense stop
6. Gross-up with fixed/variable classification
7. Multiple denominators and expense pools

**Future enterprise**
8. Cumulative caps and cap banks
9. BOMA methodology alignment
10. CapEx amortisation schedules

Note that 1–3 are all *correctness*, not parity. None of them exist on
CapVeri's list as differentiators — they are table stakes we assumed we had.

---

## 4. What NOT to copy — where the investment stays

CapVeri's engine is deterministic and audit-focused, with AI confined to
abstraction and advice. **That is the right architecture and we already share
it** — our arithmetic is plain JavaScript and the model never computes money.
Matching them on engine features is necessary but it buys parity, not
preference.

The parts of MainStreet that are genuinely differentiated, and should keep
receiving investment:

- **Verified memory.** Append-only revision history on every record, with who
  and when. A reconciliation engine tells you this year's number; MainStreet is
  building the thing that still knows, in 2031, why the 2026 number was what it
  was.
- **Evidence-first extraction.** Every field carries a verbatim quote, page and
  confidence, and that provenance survives into answers and drafts. This is the
  moat. Competitors abstract leases; almost nobody makes the abstraction
  *auditable back to the paragraph*.
- **Refusal as a first-class outcome.** The engine says "this lease cannot
  answer that" and carries no citations when it does. Trust compounds; a single
  confidently wrong cited answer destroys more value than ten refusals cost.
- **Property and Space workspaces, Property Timeline, Related Items.** A CAM
  engine has no opinion about the roof. MainStreet knows the roof job, its
  warranty, its invoice and its inspection are one story. That is the operating
  system, and it is where the second and third year of retention comes from.
- **AI drafting from verified records.** Drafting gated on real activity, citing
  the record it drew from.

**The strategic read:** CAM correctness is the *entry ticket*. Verified memory
is the *product*. Spending six months achieving CapVeri parity and nothing else
would produce a worse CapVeri. Spending six months on correctness **plus** the
memory layer produces something they cannot answer, because their architecture
does not retain the history to answer it with.

---

## 5. Six-month allocation

| Area | Effort | Why |
|---|---|---|
| **CAM correctness** (items 1–3, then 4–6) | **30%** | Bounded, deterministic, no AI risk. Items 1–3 are defects and gate charging anyone. |
| **Dispute / audit response** | **20%** | The wedge. Uses evidence + verified memory, which competitors cannot copy quickly. Nobody buys reconciliation software enthusiastically; they buy the thing that saves them from a fight. |
| **Extraction accuracy + Phase 0 validation** | **15%** | Measure, then decide build-vs-integrate. Do not exceed this without evidence — the market says extraction is commodity. |
| **Verified memory / Property Workspace / evidence** | **15%** | The differentiator. Sustained, modest investment beats a burst. |
| **AI as assistant** (proactive, portfolio-level) | **10%** | Today it is document Q&A. The step change is telling her what needs attention before she asks. |
| **Integrations and export** | **10%** | One good CPA-acceptable export beats three half-integrations. |

**Deliberately near zero:** XRPL/RLUSD settlement, acquisitions, escrow/reserves,
marketing production. All built; none of them are why a first customer pays.


---

## Production audit findings CAM-1..CAM-6 (fixed)

Separate from C1–C3. These were defects in what already existed, not gaps.

**CAM-1 · Currency strings were silently mis-valued.** `parseFloat` stops at the
first non-numeric character: `"1,250.00"` became `1`, `"$84,500"` became `NaN`
and then `0` via `|| 0`. A zeroed invoice leaves the pool with no signal — every
tenant under-billed, the landlord absorbing it. One parser, `parseMoney()`, is
now shared by the engine and the Property Workspace, which had been fixed
separately and therefore *disagreed with the engine about the same invoice*.
It returns **null** for unreadable, never 0, because zero is a real amount and
must not be how the system says "I could not read this". Unreadable invoices are
excluded from the pool and named in a toast.

**CAM-2 · A single-year reconciliation summed every year.** `_runYear` tagged
the result and never filtered the inputs, so a run headed "2026 CAM" included
2025's invoices. Undated invoices are kept — dropping them would lose real
expenses — but counted and reported.

**CAM-3 · The exclusion schedule did not bind direct matches.** Exclusions
filtered only the shared pool. A $50,000 capital expenditure the lease
explicitly excludes was billed 100% to whichever tenant it matched. Now applied
to both pools, with a flag naming what was recognised and why it was not billed.

**CAM-4 · Whole-invoice assignments were invisible.** A direct match bills the
entire invoice to one tenant; nothing listed them. Every direct assignment now
carries a flag with vendor, amount and match reason.

**CAM-4b · THE MATCHER — the most severe finding, and it was found while writing
the test rather than during the audit.** The haystack included the invoice
*date*, and matching was naive substring:

    unit "1"    vs "apex roofing 2026-05-01"  -> 90%, whole invoice
    unit "2"    vs "...2026-..."              -> 90%
    name "A"    vs "...repairs..."            -> 75%
    name "Roof" vs "Apex Roofing"             -> 75%

Units 1 and 2 are the commonest unit numbers there are. On any property with a
Unit 1 tenant, **every** 2026-dated invoice was billed in full to them. Now:
dates are out of the haystack, matching is on token boundaries, and identifiers
too short to be evidence (names under 4 chars, units under 2) cannot trigger a
whole-invoice assignment. Legitimate matches — a real vendor/tenant name, a
"Suite 210" reference — still resolve.

**CAM-5 · Zero rentable area produced `$∞`.** `proRata = sqFt / 0` is Infinity;
with both zero it is NaN. The engine now refuses and names the missing field.

**CAM-6 · Two CAM engines, and the tests covered the dead one.**
`runCAMAllocation` was computed in `runAllocation()` and discarded four lines
later by `lastResults = fullResults`. `test-allocation.js` tested it. Every green
run of that suite was evidence about a function no tenant statement ever came
from — and the two disagreed: the dead one guarded divide-by-zero and validated
the cap range, the live one did neither. The dead function is removed;
`test-allocation.js` now drives `runFullReconciliation` in a browser.
`allocation-engine.js` is retained as the package entry point with a header
saying plainly that it is not the production engine.
