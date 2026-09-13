# Finding F-02 — the CAM exclusion schedule is extracted, displayed, and almost never enforced

**Status:** analysis only. Nothing implemented, no code changed, benchmark corpus untouched.
**Basis:** Runs 1–3 (`evidence/2026-08-08-validation-run-1.json`,
`evidence/2026-08-09-validation-run-2.json`, both at commit `31c00f2`; Run 3
values quoted from the operator's database report). Build `b8eecd9`.

## The headline

`excluded_categories` is free-text prose written by the model. The allocation
engine matches it against a **closed nine-value vocabulary** using exact string
equality. Across three runs and three leases, **3 of 55 extracted exclusion
phrases (5%) can ever match an invoice category. The other 52 are inert.**

The instability we set out to measure is real, but it is the second problem.
The first is that the field mostly does nothing — while the tenant statement
tells the tenant it does.

## 1. Where `excluded_categories` is consumed

| Stage | Location | What happens |
|---|---|---|
| Extraction | `api/_claude-tasks.js:90` | *"Comma-separated list of expense categories explicitly excluded from CAM."* Free text. No vocabulary given to the model. |
| Normalise (extraction) | `script.js:2014-2017` | `'' → null` |
| Normalise (tenant) | `script.js:1358` | `null → ''` — the previous step is undone |
| Split to array | `script.js:9999-10000`, `21858-21859`, `16588` | `.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)` |
| Lease object | `script.js:729` | `excludedCategories.map(c => c.toLowerCase())` |
| **Money — shared pool** | **`script.js:9769-9771`** | `_isExcluded = inv => lease.excludedCategories.includes((inv.category \|\| '').toLowerCase())` |
| **Money — direct pool** | `script.js:9775+` (CAM-3) | same predicate applied to directly-matched invoices |
| Money — other paths | `script.js:11189`, `11314`, `12703`, `16123` | same `.includes()` predicate |
| **Tenant-facing display** | **`script.js:11196-11197`** | `Excluded from your CAM: ${t.excludedCategories.join(', ')}` — prints the raw AI phrases |
| Category-impact view | `script.js:13929-13930` | splits tenants by the same predicate |
| Invoice vocabulary | **`script.js:696`** | `['insurance','landscaping','snow','repairs','utilities','janitorial','security','management','other']` |
| Invoice classification | `api/_claude-tasks.js:169` | model must return one of those nine |

## 2. What kind of matching

**Exact string equality**, per array element: `Array.prototype.includes` on
lowercased, comma-split, trimmed strings. Not substring, not stemmed, not
semantic. `'capital expenditures'` does not match `'repairs'`;
`'roof replacement'` does not match `'repairs'`; `'management fees'` does not
match `'management'`.

The two sides of the comparison are drawn from different universes: invoice
categories come from a nine-item enum the model is constrained to, exclusions
come from unconstrained prose.

## 3. Can different AI wording silently change which invoices are excluded

**Yes, and it did.** From Run 1 vs Run 2, Olenox:

```
run1: capital expenditures, interest, depreciation, tenant improvements,
      insurance, taxes, brokers' leasing fees                        (7 items)
run2: …same seven… + structural components, roof replacement          (9 items)
run3: …same seven…                                                    (7 items)
```

Surgery Partners kept nine items every run but re-worded four of them
(`real estate brokers' commissions` → `broker commissions`,
`affiliate overhead/profit above market` → `affiliate markups` →
`affiliate markups above market`). Under exact matching, a paraphrase is a
different key.

In *these three leases* the wording drift changed no dollars — because neither
wording matched anything. On a lease whose exclusion happened to read
`management fees` in one run and `management` in the next, the second run would
exclude every management invoice and the first would exclude none, silently.

## 4. Does empty mean "no exclusions" or "AI found none"

**The two are indistinguishable, and the system assumes the former.**

`script.js:2014-2017` maps `''` to `null`; `script.js:1358` maps `null` back to
`''`. The edge-case detector `CAM_EXCLUSIONS_UNDEFINED`
(`lease-intelligence.js:505-518`) fires only on `null`/`undefined`, with the
comment *"Empty string means Claude confirmed no exclusions."* Because of the
round-trip above, the stored value is `''` either way, so the detector cannot
fire on this path at all.

Run 1–3 evidence that this matters: **SIGA returned `''` in Runs 1 and 2, then
five exclusions in Run 3** — from byte-identical input (md5 `80e37b31`, 136,808
chars). Two runs recorded "this lease excludes nothing" for a lease that
demonstrably lists exclusions. No flag was raised in either run.

## 5. Is there a safety check

**No.** `allocation-integrity.js` validates allocation *sums*, precision and
anomalies (`validateAllocationSet`, `normalizeAllocationPrecision`,
`detectAllocationAnomalies`) — it never inspects exclusions. Nothing compares
the extracted phrases against the vocabulary, nothing reports how many were
applied, and nothing blocks an allocation whose exclusion schedule is unusable.
Confidence, review state and cap enforcement have guards; the exclusion filter
has none.

## Current behaviour, measured

Applying the engine's own normalisation and predicate to the real Run 1–3 values:

| Tenant | Run | Phrases | Match the vocabulary | Inert |
|---|---|---|---|---|
| Olenox Corp | 1 | 7 | `insurance` | 6 |
| Olenox Corp | 2 | 9 | `insurance` | 8 |
| Olenox Corp | 3 | 7 | `insurance` | 6 |
| Siga Technologies | 1 | 0 | — | 0 |
| Siga Technologies | 2 | 0 | — | 0 |
| Siga Technologies | 3 | 5 | — none — | 5 |
| Surgery Partners | 1 | 9 | — none — | 9 |
| Surgery Partners | 2 | 9 | — none — | 9 |
| Surgery Partners | 3 | 9 | — none — | 9 |

**3 / 55 = 5%.**

## Risk

**Direction: the tenant is over-billed.** A non-matching exclusion fails open —
the expense stays in the pool and is allocated. Capital expenditures, roof
replacement, structural components, executive salaries, brokers' commissions and
affiliate mark-ups are the classic disputed items, and they are exactly the ones
that do not match.

**The statement asserts something untrue.** `script.js:11196` prints
*"Excluded from your CAM: capital expenditures, interest, depreciation, …"* to
the tenant while the engine excluded only `insurance` — or, for Surgery Partners
and SIGA, nothing at all. This is the same shape as M1a (a cap displayed as in
force while inert), but worse: it appears in the tenant-facing document, is the
first thing a tenant's auditor checks, and is wrong in the landlord's favour.

**It is silent.** No warning, no confidence reduction, no review flag.

**Instability compounds it.** Once matching is fixed, today's wording drift
becomes tomorrow's dollar drift — the same lease excluding different categories
on different runs.

## Recommended minimum fix

Three changes, in this order. None requires a new AI call.

**1. Deterministic mapping, not free text (the actual fix).** Add a
`canonicalizeExclusion(phrase) → category | null` map from prose to the nine
`CATEGORIES` values (`capital expenditures`/`capital improvements`/`roof
replacement`/`structural` → `repairs`; `management fees`/`admin fee` →
`management`; and so on). Store both the raw phrase (for display and citation)
and the resolved category (for the filter). The filter reads resolved
categories; the statement shows the raw text plus what it resolved to.

**2. Refuse to fail open.** Any phrase that does not canonicalize must surface
as an unmapped exclusion — visible on the tenant statement and in the review
gate — rather than silently allocating. The landlord must be told
*"this lease excludes 8 categories; 1 could be applied; 7 could not"* before a
statement is issued.

**3. Distinguish absent from empty.** Keep the model's `null` as `null` end to
end (remove the `'' → null → ''` round trip at `script.js:2014` /
`script.js:1358`) so `CAM_EXCLUSIONS_UNDEFINED` can fire, and treat a
zero-exclusion result on an NNN lease as needing review rather than as a
confirmed absence. SIGA is the proof case.

## 7. Which approach is correct

**Deterministic category normalization is the right primary mechanism**, because
the defect is a type mismatch — unconstrained prose compared by equality against
a closed enum. Nothing else fixes that.

- A **structured enum returned by the model** is the cleaner long-term shape and
  should be the Wave 2 schema change (`excluded_categories: [{category, quote}]`).
  It does not replace the mapping layer: existing extractions are prose, and a
  model asked for an enum will still emit near-misses.
- **Source citations** are necessary but not sufficient — they let a human check
  the phrase; they do not make the filter work.
- **Human confirmation** is the right *gate*, not the fix. Confirming an
  exclusion that the engine cannot apply changes nothing.

Order: canonicalize (1) → refuse to fail open (2) → null/empty semantics (3) →
structured enum with per-item quotes (Wave 2).

## Regression test that would prove the fix

`test-cam-exclusions.js`, executing the real engine, not a fixture copy.

1. **Canonicalization** — feed the three real extracted strings from Runs 1–3
   verbatim; assert `capital expenditures`, `capital improvements (with
   exceptions)`, `roof replacement` and `structural components` all resolve to
   `repairs`, and that `insurance` resolves to `insurance`.
2. **Money, the core case** — one tenant, exclusion string
   `"capital expenditures, roof replacement"`, invoice pool containing a
   `repairs` invoice. Assert the repairs invoice is excluded and
   `totalAllocated` drops by exactly its pro-rata share.
   *Mutation:* revert the canonicalization and this must fail.
3. **Wording invariance** — the three Surgery Partners variants
   (`real estate brokers' commissions` / `broker commissions`, `affiliate
   overhead/profit above market` / `affiliate markups`) must produce **identical
   `totalAllocated`**. This is the test that would have caught the Run 1–3 drift.
4. **No silent failure** — an unmappable phrase must appear in the result's
   unmapped list and in the statement; assert the count is non-zero and rendered.
5. **Empty ≠ absent** — `excluded_categories: null` on an NNN lease raises
   `CAM_EXCLUSIONS_UNDEFINED`; `''` after a confirmed extraction does not.
   Assert on the SIGA shape specifically.
6. **Display honesty** — assert the tenant statement never lists a category as
   excluded unless that category was actually filtered out of the pool. This is
   the assertion that fails against today's code.

All six mutation-proven by exact string replacement with an assert that the
replacement applied.

## Not assessed

Whether the nine-value `CATEGORIES` vocabulary is itself adequate for real CAM
pools — `taxes`, `depreciation`, `interest` and `ground lease rent` have no home
in it, so some lease exclusions may be unmappable by construction. That is a
vocabulary question, separate from this defect, and no recommendation is made
here.
