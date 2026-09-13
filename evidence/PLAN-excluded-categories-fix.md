# Implementation plan — making `excluded_categories` safe for CAM allocation

**Status:** plan only. Nothing implemented, no extraction, no deployment.
**Basis:** `evidence/FINDINGS-excluded-categories.md` (F-02, commit `4e45ebd`),
Runs 1–3 at `31c00f2`.

---

## 0. A result that changes the recommendation — read first

F-02 proposed `canonicalizeExclusion(phrase) → category` mapping capital
expenditures, roof replacement and structural components onto `repairs`. I
tested that against the 21 distinct phrases actually observed across Runs 1–3
before planning it. **It is unsafe and should not be built that way.**

| Outcome | Count | Phrases |
|---|---|---|
| Exact match to the vocabulary | **1** | `insurance` |
| Would map only by over-excluding `repairs` | **4** | `capital expenditures`, `capital improvements (with exceptions)`, `roof replacement`, `structural components` |
| No bucket exists in the vocabulary at all | **16** | `taxes`, `depreciation`, `interest`, `debt service`, `ground lease rent`, `executive salaries`, `broker commissions`, `brokers' leasing fees`, `real estate brokers' commissions`, `tenant improvements`, `tenant improvement costs`, `advertising/marketing costs`, `affiliate markups above market`, `building depreciation`, `costs billed solely to specific tenants`, `tenant-reimbursed costs` |

The `repairs` bucket is where **ordinary recoverable repairs** land. Mapping
`capital expenditures → repairs` would exclude routine repairs the tenant does
owe — an under-billing error introduced by the fix, in the opposite direction to
the defect. That is exactly the silent choice on ambiguous language we were told
not to make.

**Conclusion.** The nine-value `CATEGORIES` vocabulary (`script.js:696`) cannot
express 20 of 21 real exclusions. Canonicalization is necessary but nowhere near
sufficient: it converts 1 phrase in 21. The vocabulary itself is the deeper
defect — F-02 listed it as "not assessed"; this analysis assesses it as the
blocking issue.

**Therefore the minimum safe fix is not "map prose to categories". It is: apply
only what can be applied provably, refuse to fail open on everything else, and
tell the truth in the statement.** Vocabulary extension is a separate, larger
decision (§10).

---

## 1. `canonicalizeExclusion` and the vocabulary

**Proposed signature — richer than `category | null`.** A two-valued return
cannot express "ambiguous", which forces exactly the silent choice we must
avoid.

```
canonicalizeExclusion(phrase) → {
  raw:        string,        // verbatim, untouched
  category:   string | null, // a CATEGORIES value, only when status === 'exact' | 'mapped'
  status:     'exact' | 'mapped' | 'ambiguous' | 'unmapped',
  candidates: string[],      // populated when 'ambiguous'
  reason:     string         // human-readable, shown in review UI
}
```

- **`exact`** — the phrase, lowercased and trimmed, is already a `CATEGORIES`
  value. `insurance` → `insurance`. Applied to the filter.
- **`mapped`** — a conservative synonym table resolves it with no risk of
  capturing a broader bucket. Candidates: `management fee`/`management fees`/
  `administrative fee` → `management`; `snow removal`/`snow plowing` → `snow`;
  `landscaping`/`grounds care`/`grounds maintenance` → `landscaping`;
  `janitorial`/`cleaning` → `janitorial`; `security services` → `security`;
  `utilities`/`water/sewer` → `utilities`. Applied to the filter.
  **The table must be additive-only and hand-reviewed.** No stemming, no fuzzy
  matching, no substring containment — those are how `capital expenditures` ends
  up as `repairs`.
- **`ambiguous`** — resolves to a bucket that is broader than the phrase, so
  applying it would exclude expenses the lease does not exclude. The four
  capital/structural phrases are the observed case, `candidates: ['repairs']`.
  **Not applied.** Flagged for review.
- **`unmapped`** — nothing in the vocabulary corresponds. The 16 observed cases.
  **Not applied.** Flagged.

Only `exact` and `mapped` reach the money path. On today's corpus that is
1 phrase of 21 — which is the honest number, and the point: the landlord sees
that 20 exclusions could not be applied instead of believing all 21 were.

**Home:** a new pure module `cam-exclusions.js`, dual CJS/global like
`request-limits.js` and `document-links.js`, so it is testable in Node rather
than grepped. It owns the synonym table and the ambiguity rules and imports
`CATEGORIES`.

---

## 2. Preserving the raw phrase alongside the resolved category

The raw text is already preserved in two places and must stay untouched:

- `properties.data.tenants[].excluded_categories` — the verbatim comma string
- `tenant_field_evidence` rows with `field_key = 'excluded_categories'` — the
  audit record, already carrying `source_file` since P1b

**Add one derived sibling field**, computed not authored:

```
excluded_categories_resolved: [
  { raw, category, status, candidates, reason }, …
]
```

`excluded_categories` remains the source of truth and the thing a human edits.
The resolved array is a projection, recomputed whenever the raw string changes
(extraction, manual edit at `script.js:3496`/`7865`, amendment override). It is
never edited directly, so the two cannot drift.

---

## 3. Preventing unmapped exclusions from failing open

Three layers, all required:

**a. The filter applies only resolved categories.** Replace the predicate at the
nine consumption sites (§9) so it tests `status ∈ {exact, mapped}` entries only.
Behaviourally this is close to today for the mapped ones and identical for the
rest — the point is not to change what is excluded but to make what is *not*
excluded visible.

**b. The allocation result carries the unapplied set.** Add to each
`ReconciliationResult`: `exclusionsApplied: [...]`, `exclusionsNotApplied: [...]`.
`allocation-integrity.js` gains a check that raises an issue when
`exclusionsNotApplied.length > 0`, alongside its existing sum and anomaly checks.
It currently never inspects exclusions at all.

**c. The review gate blocks the statement, not the extraction.** A tenant with
unapplied exclusions must not be silently issuable. This is deliberately *not*
wired into `_needsReview` — F-01 already documents two systems disagreeing about
that flag, and adding a third opinion would repeat the mistake. It surfaces as a
named blocking condition on the statement path with its own message:
*"3 of 9 lease exclusions could not be applied — review before issuing."*

---

## 4. Fixing the `'' → null → ''` round trip

Three states must be distinguishable, and today all three collapse to `''`:

| Meaning | Value |
|---|---|
| Extraction never ran / unavailable | `undefined` |
| Extraction ran, found no exclusion schedule | `''` |
| Extraction ran, found exclusions | the string |

**Changes:**
- `script.js:2014-2017` — delete the `v === '' ? null : v` coercion. Pass the
  model's value through: `''` stays `''`, `null` stays `null`.
- `script.js:1358` — change `d.excluded_categories ?? d.excludedCategories ?? ''`
  to preserve `null` rather than defaulting it to `''`. Every read site must
  then tolerate `null`, which the `(t.excluded_categories || '')` idiom at
  `9999`, `16588`, `17730`, `21858` already does.
- `lease-intelligence.js:505-518` — `CAM_EXCLUSIONS_UNDEFINED` can then fire as
  written. Extend its `detect` so an NNN lease with `''` also warrants review at
  lower severity: two of three Run-1/2 SIGA extractions returned `''` for a
  lease that demonstrably lists five exclusions, and nothing flagged it.

**Risk to check before shipping:** anything currently relying on
`excluded_categories` being a string will see `null`. The `|| ''` idiom covers
the read sites found; the manual-edit inputs at `script.js:3496` and `7865`
already use `esc(d.excluded_categories || '')`.

---

## 5. Making the tenant statement reflect what was applied

This is the integrity fix and the most user-visible change.

- `script.js:11196-11197` — `Excluded from your CAM: ${t.excludedCategories.join(', ')}`
  currently prints the raw AI phrases. It must print **only applied** exclusions.
- `script.js:16209-16210` — same for the "Excluded categories" note.
- Where any exclusion was not applied, the statement must say so plainly rather
  than omitting it, e.g. *"Excluded from your CAM: insurance. 6 further
  exclusions in your lease could not be automatically applied — see review."*
  Dropping them silently would replace one untruth with another.

Assertion to enforce forever: **the statement must never list a category as
excluded unless that category was filtered out of the pool.** That is test 6 in
§7 and it fails against today's code.

---

## 6. Migration of existing leases

**No re-extraction required, and none should be run.** `excluded_categories` is
raw text already stored in `properties.data.tenants[]`; the resolved array is
derived from it. Recomputation is local and deterministic.

- **On load** — compute `excluded_categories_resolved` if absent. Self-healing,
  no backfill script, no migration ordering. Existing leases gain the field the
  first time they are opened.
- **No database migration.** The `tenants` table has no `excluded_categories`
  column (confirmed: `id, property_id, name, sqft, cap, start_date, end_date,
  lease_url, lease_type, created_at, updated_at`). The field lives only in the
  JSON blob, and `_stripBlobs` spreads tenant objects, so a new key persists
  automatically.
- **Benchmark corpus untouched.** Runs 1–3 are frozen evidence. The resolver can
  be run against them offline to produce a before/after table without writing
  anything.
- **One-way door to avoid:** do not overwrite `excluded_categories` with a
  normalised version. The raw phrase is the audit trail and the only link back
  to the lease clause.

---

## 7. The six regression tests

New file `test-cam-exclusions.js`, executing the real modules — not an inlined
copy, the mistake `test-benchmark.js` made and `test-phase0-remediation.js`
avoids. All six mutation-proven by exact string replacement with an assert that
the replacement applied.

1. **Canonicalization** — feed the 21 real phrases verbatim. Assert `insurance`
   → `exact`; the four capital/structural phrases → `ambiguous` with
   `candidates: ['repairs']`; the 16 others → `unmapped`. **Assert none of them
   returns a `category`** — this is the test that stops a future "helpful"
   mapping from silently reintroducing over-exclusion.
2. **Money** — one tenant, exclusion `"management fees"`, pool containing a
   `management` invoice. Assert it is excluded and `totalAllocated` drops by
   exactly its pro-rata share. *Mutation:* revert the resolver → fails.
3. **Wording invariance** — the three real Surgery Partners variants
   (`real estate brokers' commissions` / `broker commissions`; `affiliate
   overhead/profit above market` / `affiliate markups` / `affiliate markups
   above market`) must produce **identical `totalAllocated`**. This is the test
   that would have caught the Run 1–3 drift.
4. **No silent failure** — a tenant with unmapped exclusions must expose a
   non-empty `exclusionsNotApplied`, and `allocation-integrity` must raise an
   issue. Assert both.
5. **Empty ≠ absent** — `null` on an NNN lease fires `CAM_EXCLUSIONS_UNDEFINED`;
   `''` after a confirmed extraction fires the lower-severity variant, not the
   same code. Assert on the real SIGA shape (`''` in Runs 1–2, five phrases in
   Run 3).
6. **Display honesty** — the statement never lists a category as excluded unless
   it was filtered from the pool. Assert against the real Olenox Run 3 value:
   seven phrases in, only `insurance` may appear as applied. **Fails against
   today's code**, which is the proof the test is real.

---

## 8. Schema changes, and whether they can be avoided

**Database: none.** No new column, no migration, nothing touching the pilot
Supabase project. §6 explains why.

**Tenant object: one additive field**, `excluded_categories_resolved`, derived
and self-healing. It rides along in the JSON blob at no cost.

**Extraction contract (`api/_claude-tasks.js:90`): unchanged for this fix.**
Deliberate. Changing the prompt means a re-extraction pass and re-opens the
stability question we just measured. Structured output —
`excluded_categories: [{category, quote}]` — belongs in the Wave 2 contract
revision alongside `building_total_sqft`, `has_cam_clause`, `cap_scope` and
per-field `page`, as one prompt change and one replay. It does **not** remove
the need for the resolver: existing extractions are prose, and a model asked for
an enum still emits near-misses.

**`tenant_field_evidence`: unchanged.** The raw phrase and `source_file` already
persist. Adding the resolved status per field is Wave 2 work with P1c.

---

## 9. Interaction with existing allocation and reconciliation

Nine consumption sites share one predicate and must change together, or the
statement will disagree with the money:

| Site | Role |
|---|---|
| `script.js:9769-9771` | **money** — shared pool filter |
| `script.js:9775+` (CAM-3 block) | **money** — direct-invoice filter |
| `script.js:11189` | tenant statement eligible set |
| `script.js:11314` | category drill-down |
| `script.js:12703` | per-invoice share view |
| `script.js:16123` | statement invoice breakdown |
| `script.js:13929-13930` | cross-tenant exclusion-inconsistency check |
| `script.js:11196`, `16209` | **display** — §5 |
| `script.js:17730` | portfolio exclusion-impact rollup |

Plus the array builders at `script.js:9999-10000`, `10068`, `16588`, `21858-21859`,
and the `Lease` constructor's `.map(c => c.toLowerCase())` at `script.js:729`.

**Behavioural impact on today's data: near zero, by design.** Only `insurance`
on Olenox is currently applied, and it stays applied. What changes is that the
other 20 stop being presented as if they were in force. That is the intended
outcome — this fix makes an existing silence audible, it does not move money.

**Do not touch `allocation-engine.js`.** It is dead, diverged code
(hardcoded `BASE_AMOUNT = 10000`, not loaded by `index.html`, still
`package.json`'s `main`). Its `tenant.excludedCategories.includes(...)` at line
23 looks like the same defect and is not on the live path. Fixing it there would
be the "fixing the wrong file" trap already documented in
`docs/PRODUCTION_READINESS_REVIEW.md:339`.

**No interaction with the cap path.** M1a's `capIsEnforceable` and this are
independent; a lease can have an inert cap and unapplied exclusions at once —
Surgery Partners has both.

---

## 10. The larger decision this plan does not make

Twenty of twenty-one real exclusions have no bucket in a nine-value vocabulary
built for invoice classification, not for lease exclusion schedules. Real CAM
exclusions are about *recoverability* — capital vs operating, landlord
obligation vs tenant obligation, arm's-length vs affiliate — which is a
different axis from *what the invoice is for*.

Making most exclusions applicable needs either a second axis on invoices (a
capital/operating flag, a recoverable flag) or a substantially larger category
set. Both are real product decisions with re-extraction and UI consequences, and
neither belongs in a defect fix.

**Recommendation: ship §§1–7 as the correctness fix**, which stops the product
asserting things it does not do, and take the vocabulary question up separately
with the CAM engine gap analysis (`docs/CAM_ENGINE_GAP_ANALYSIS.md` items C1–C3).
Until then the honest position is that MainStreet can apply a small, named
subset of lease exclusions and says so.

---

## Files that would change

| File | Change |
|---|---|
| `cam-exclusions.js` | **new** — resolver, synonym table, ambiguity rules |
| `script.js` | resolver wiring; nine predicate sites; two display sites; `2014-2017` and `1358` null/empty; derived field on load |
| `lease-intelligence.js` | `CAM_EXCLUSIONS_UNDEFINED` detect logic |
| `allocation-integrity.js` | unapplied-exclusions check |
| `test-cam-exclusions.js` | **new** — six tests |
| `index.html` | one `<script>` tag for the new module |

Untouched: `api/_claude-tasks.js`, `allocation-engine.js`, all migrations, the
pilot database, `docs/PHASE0_BENCHMARK.md`, and the Runs 1–3 evidence.
