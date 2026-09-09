# M8 Preflight — Lease Memory & Data Integrity Audit

**Read-only.** No code changed, no migration, no data repaired, no extraction re-run,
nothing deployed. Pilot was queried with `SELECT` only; Production was not touched.

Base commit `f7eb6ec`. Branch `claude/validation-runs-analysis-ji1zb3`.

---

## Headline

**Nothing is missing. Nothing is broken. Two projections are narrow.**

The seven "missing" lease field values are not missing from the database, not lost by
extraction, and not dropped by persistence. Every one of them survives ingest,
normalisation and storage, and for most of them the value is *also* stored a second time
in `tenant_field_evidence.value`. They are absent from the AI surface for exactly one
reason: two functions that project a subset, and neither subset includes them.

That makes M8 far smaller and far safer than "recover lost lease data" implied.

**And one correction, stated up front because it was mine.** In the M7 closure I reported
that `sanitizeImportedPropertyData` "silently reopens every decided dispute" on import.
The rewrite logic is real and does what I described *if it runs*. **It never runs.** The
function has no caller anywhere in the product. I verified the transformation in isolation
and did not check reachability before reporting it. Details in §3.

---

## 1. The seven fields

### What they are

`cap_base_amount`, `admin_fee_pct`, `gross_up_pct`, `expense_stop`, `audit_rights`,
`pro_rata_method`, `renewal_options` — the seven of `LeaseIntelligence.CANONICAL_FIELDS`
(13 total) whose values reach no capability. The other six (`cap`, `tenant_name`,
`leased_sqft`, `start_date`, `end_date`, `lease_type`) are exposed through `space.lease`.

### Where each value originates

| field | origin | in the lease PDF? | extraction asks for it? |
|---|---|---|---|
| `admin_fee_pct` | AI extraction | yes — "management fee", "administrative fee not to exceed X%" | **yes** (`_claude-tasks.js:41`) |
| `gross_up_pct` | AI extraction | yes — "grossed up to X% occupancy" | **yes** (`:43`) |
| `expense_stop` | AI extraction | yes — "expense stop", "base year stop" | **yes** (`:44`) |
| `audit_rights` | AI extraction | yes — right to audit CAM records | **yes** (`:45`) |
| `pro_rata_method` | AI extraction | yes — how the lease defines the denominator | **yes** (`:46`) |
| `renewal_options` | AI extraction | yes — count, term, rate basis | **yes** (`:47`) |
| `cap_base_amount` | **manual entry only** | **no** | **no — absent from the schema entirely** |

**`cap_base_amount` is not a lease field.** Its UI label is *"Prior-Year CAM Base ($) —
last year's total CAM charge for this tenant"* (`script.js:8605`). It is a prior-year
operating actual, not a clause. No lease PDF contains it, the extraction schema never asks
for it, and `script.js:2134` will only accept one if a `quotes.cap_base_amount` exists —
which extraction never produces. It reaches the record solely through the manual
"Prior-Year CAM Base" input at `script.js:8606`.

Grouping it with the other six was my own error in the M1–M6 audit. It is a different kind
of fact and belongs in a different bucket.

### Is the pipeline capable of obtaining them?

Yes, for six of seven — and it already does. Measured in Pilot (86 stored tenants):

```
cap_base_amount   21    (24%)   manual entry
audit_rights      23    (27%)
pro_rata_method   20    (23%)
renewal_options   16    (19%)
admin_fee_pct      3    (3.5%)
gross_up_pct       3
expense_stop       3
                  ───
                   89 stored values no agent can currently read
```

Low coverage on `admin_fee_pct` / `gross_up_pct` / `expense_stop` reflects how often those
clauses appear in these leases, not a pipeline failure — the extractor asks for all three
on every document and returns `null` when the clause is absent.

### Why provenance exists without a value

Because provenance was designed to describe evidence, not to carry data — and nothing
downstream ever added the value back.

`FieldProvenance.fieldProvenance()` returns exactly thirteen keys:

```
field, state, stated, cited, by, when, quote, page, sourceFile,
label, method, uiStatus, dbStatus
```

`value` is not among them. The function *reads* the value — `_isEmpty(raw)` is what
separates `unknown` from `ai_extracted` — and then reports only its status. That is
coherent as a design; it becomes a gap only when it is the sole route to the field.

### Which are safely auto-recoverable

**All seven, for read exposure** — because no recovery is involved. The values are already
in the record's inputs; they are simply not projected. See §4 and §5.

The distinction the brief asks for applies to *trust labelling*, not to retrieval:

| bucket | fields | why |
|---|---|---|
| **Safely auto-recoverable** | `pro_rata_method`, `audit_rights`, `renewal_options`, `admin_fee_pct`, `gross_up_pct`, `expense_stop` | Stored values with an existing provenance state. Exposing them adds no claim beyond what the state already asserts. |
| **Recoverable only with explicit confirmation** | `cap_base_amount` | Not a lease term. It is a prior-year actual typed by a person, and it is the operand of every cap ceiling. It must be exposed with its manual origin stated, never described as lease-derived. |
| **Genuinely unavailable** | none of the seven | No field is unrecoverable. What varies is coverage: 3–27% of tenants carry each. Absence for a given tenant means the clause was not in that lease, which `state: 'unknown'` already says. |

---

## 2. `leased_sqft ?? leasedSqft ?? sqft`

### Where the substitution happens

Three sites, and they are not equivalent to each other:

1. **`tenant-normalize.js:92`** — `d.leased_sqft ?? d.leasedSqft ?? d.sqft ?? ''`
   The canonical resolver. Runs on every ingest and every load.
2. **`api/_property-record-hydrator.js:255`** — `leased_sqft: t.sqft`
   The `tenants` table fallback, mapping the table's `sqft` column onto the canonical name.
3. **`tenant-space.js:137`** — `t.leased_sqft || t.sqft || null`
   The lease projection.

### What each name means

- **`leased_sqft`** — canonical snake_case. The tenant's demised area.
- **`leasedSqft`** — camelCase alias. Same quantity, different casing convention.
- **`sqft`** — two distinct things depending on the object:
  - on an **extraction result**, it is the key Claude returns for the tenant's area
    (`_claude-tasks.js:38`, prompt line 84: *"sqft: Integer. Strip commas, units..."*),
    extracted from that one tenant's lease. Same quantity.
  - on a **`tenants` table row** (`000_base_schema.sql:33`, `sqft numeric`), it is that
    tenant's area. Same quantity.
  - on a **property** object, `property.sqft` is the building total — a different quantity,
    but a different object, so the chain never confuses them.

### Equivalent, or historically conflated?

**Historically conflated in naming; semantically the same quantity.** Nothing in the schema,
the extraction prompt, or any consumer distinguishes demised area from rentable area with a
load factor. There is no second measure for the alias chain to substitute.

**This corrects an overstatement of mine.** The M7 units note says a tenant "may arrive here
carrying its *rentable* sqft under the leased name." I have found no evidence for a
rentable/demised distinction anywhere in this codebase. The honest statement is that three
spellings of one quantity are resolved by a `??` chain — a naming inconsistency, not a
semantic hazard. The M7 guarantee should be re-examined on that basis.

### Two real defects found while tracing

- **`tenant-space.js:137` uses `||`, not `??`.** A legitimate `leased_sqft: 0` projects as
  `null`. Measured: input `0` → output `null`.
- **The `|| t.sqft` fallback there is dead code.** `normalizeTenant` emits no `sqft` key
  (verified against its output key list), so after normalisation `t.sqft` is `undefined`.
  Measured in Pilot: **0 of 86 stored tenants carry a bare `sqft` key.** The branch has
  never fired on stored data.
- **`normalizeTenant` defaults an absent area to `''`, not `null`.** Harmless today —
  `PropertyArea._area('')` returns `null` — but it is an empty string standing in for
  "unknown" in the canonical record.

**Coverage:** 85 of 86 Pilot tenants have `leased_sqft`. One does not, which under the M7
rule makes leased area and occupancy `null` for that one property.

---

## 3. Dispute import mutation — my M7 report was wrong

### The trace

`sanitizeImportedPropertyData` (`script.js:24281`) holds a second dispute vocabulary:

```js
const VALID_DISPUTE_STATUSES = new Set(['open', 'resolved', 'escalated', 'withdrawn']);
...
status: VALID_DISPUTE_STATUSES.has(d.status) ? d.status : 'open',
```

It shares only `open` with `DISPUTE_TRANSITIONS`, the machine `resolveDispute` enforces.
Measured in isolation:

```
open           -> open
docs_requested -> open      REWRITTEN
accepted       -> open      REWRITTEN
rejected       -> open      REWRITTEN
resolved       -> resolved
escalated      -> escalated
nonsense       -> open      REWRITTEN
```

### It never runs

- **No call site.** `grep` for `sanitizeImportedPropertyData(` finds only the definition.
- **Not exported**, not assigned to `window` explicitly (it is a top-level declaration, which
  is how `qa-harness.js:538` reaches it via `typeof`).
- **No property-JSON import flow exists.** All three `FileReader` paths in `script.js` are
  base64 encoding (`:1151`), GL Excel import (`:4393`) and Yardi CSV (`:9906`). None touches
  `disputes`.
- **It is the only place in the codebase that rewrites a dispute status on a read path**
  (`grep` for `status: VALID` / `status = 'open'` returns this line alone).

It is dead code written for an import feature that was never wired up.

### Evidence in stored records: none, and none possible

Pilot, all property blobs:

```
status          n   properties   resolvedAt set   history present
docs_requested  3       3              0                0
open            3       3              0                0
                ─
                6 disputes total
```

Zero `accepted`, `rejected`, `resolved`, `escalated`, `withdrawn` or unrecognised statuses.
The rewrite fingerprint — a dispute reading `open` while carrying a `resolvedAt` or a
history entry with `toStatus: accepted|rejected` — is **0 across all three counts**.

Two things follow, and they should not be conflated: the code cannot have run, and there is
also nothing for it to have damaged, because no Pilot dispute has ever been resolved.

**What I got wrong:** I verified the transformation and reported its consequence without
checking whether the function is reachable. "Importing a property silently reopens every
decided dispute" describes behaviour that has never occurred and cannot occur today. The
correct statement is: *a latent second vocabulary exists in dead code, and would corrupt
dispute state if an import feature were ever wired to it.*

That is still worth fixing — but it is a latent hazard, not an active defect, and it does
not belong anywhere near a data-repair conversation.

---

## 4. Lease evidence / value relationship — expected behaviour, not a broken path

**The value never disappears. It is never picked up.**

Traced stage by stage with a tenant carrying a real value for all seven:

| stage | result |
|---|---|
| stored in `properties.data.tenants[i]` | **present** |
| `normalizeTenant` | **kept** — all seven are explicitly named in the allow-list (`tenant-normalize.js:143–150`) |
| `_stripBlobs` before save | **not stripped** — it removes `fieldEvidence` only |
| `tenant_field_evidence.value` | **present** — measured: every evidence row in Pilot has a non-empty `value` |
| `_evidenceRowToSnapshot` | **carries it** — `value: row.value` (`hydrator:134`) |
| `FieldProvenance.fieldProvenance()` | **drops it** — the returned object has no `value` key |
| `TenantSpace.assemble().lease` | **omits it** — projects only `{type, sqft, start, end, cap, url, fileName}` |
| `PropertyRecord.spaces[].lease` | copies TenantSpace verbatim |
| `get_tenant` / `get_space` / `get_lease_evidence` | **value absent from the entire record** |

Measured end to end: with all seven populated in the blob, **none of the seven values
appears anywhere in the assembled `PropertyRecord`.**

### The exact points

There are two, and neither is a bug in the ordinary sense:

1. **`field-provenance.js` — the `out` object literal.** Thirteen keys, no `value`. The
   resolver answers *"what stands behind this field?"* and was never asked *"what is it?"*.
2. **`tenant-space.js:135–138` — the `lease` literal.** Seven keys chosen for a UI card.
   `PropertyRecord` then inherits that shape as the canonical lease view.

Neither is a persistence failure. Neither is an extraction failure. Both are projections
that predate the AI surface and were never widened when it was built.

**A note on citations.** In Pilot, `source_page` is `NULL` on every evidence row and only 6
rows of 371 carry a quote. So today's provenance is mostly `state` + `sourceFile` with no
clause reference. That does not affect value recovery, but it means "cited on page N" is
currently a fixture-only shape — worth knowing before designing anything that leans on it.

---

## 5. M8 design recommendation

### Classification

| bucket | fields | treatment |
|---|---|---|
| **Safely auto-recoverable** | `admin_fee_pct`, `gross_up_pct`, `expense_stop`, `audit_rights`, `pro_rata_method`, `renewal_options` | Project the stored value alongside the provenance state that already describes it. No new claim, no new read, no repair. |
| **Recoverable only with explicit confirmation** | `cap_base_amount` | Expose with `origin: 'manual_entry'` stated on the field. Never labelled lease-derived; it is a prior-year actual and it is the operand of every cap ceiling. |
| **Genuinely unavailable** | none | Per-tenant absence is real and already correctly reported as `state: 'unknown'`. |

### Smallest safe implementation sequence

**M8a — expose what is already there. One projection, no new read.**
Widen the canonical lease view to carry all thirteen fields as `{value, state}` pairs
sourced from the tenant record and the provenance resolver that already runs. No new
database read, no capability added, no write. This alone closes the entire gap.
*Risk: low. It exposes stored values whose trust state is already computed.*

**M8b — state the origin of `cap_base_amount`.**
It travels with M8a but needs its own label: manual entry, prior-year actual, not a lease
clause. Without this it will be read as lease-supported the moment it is visible.
*Risk: low, and it is the one field where getting the label wrong is expensive.*

**M8c — the two sqft defects, separately and after.**
Change `||` to `??` in `tenant-space.js:137` so a real `0` survives; remove the dead
`|| t.sqft`; consider `null` rather than `''` for an absent area in `normalizeTenant`.
Re-examine the M7 `convention` guarantee in light of §2 — the note may be stronger than the
evidence supports.
*Risk: low but touching the normaliser affects every write path, so it earns its own phase.*

**M8d — neutralise the dead import vocabulary.**
Delete `VALID_DISPUTE_STATUSES` or make it read `DisputeStatus.knownStatuses()`. It is
unreachable today; the point is that it cannot become reachable later without carrying the
divergence back in.
*Risk: none — dead code. Do not schedule this as data repair; there is nothing to repair.*

### What I recommend against

- **Any data repair.** Nothing is damaged. 89 stored values are intact and unread.
- **Any extraction re-run.** The pipeline already asks for all six extractable fields and
  gets them when the clause exists.
- **Any migration.** Both gaps are in application projections.
- **Bundling the sqft or dispute work into M8a.** The value exposure is a clean, testable
  change on its own; the other two are unrelated hygiene with different blast radii.

### Sequencing

`M8a + M8b` together — one coherent change, "the record states what it knows."
Then `M8c`, then `M8d`, each on its own approval.

---

## Method and limits

- Read: `tenant-normalize.js`, `tenant-space.js`, `property-record.js`, `field-provenance.js`,
  `lease-intelligence.js`, `api/_claude-tasks.js`, `api/_property-record-hydrator.js`,
  `api/_mcp-capabilities.js`, `script.js` (ingest, cap base, sanitize, FileReader paths),
  `migrations/000_base_schema.sql`.
- Measured: an offline probe running the real hydrator and capabilities over fixtures, plus
  four read-only `SELECT`s against Pilot. No writes of any kind. The probe lives in the
  session scratchpad and is not committed — it is an instrument, not a test.
- **Correction 1:** my M7 dispute-import finding overstated an unreachable code path as an
  active defect. Corrected in §3.
- **Correction 2:** my M1–M6 audit and M7 units note treated `cap_base_amount` as a lease
  field and implied a rentable/demised conflation in the sqft chain. Neither holds. §1, §2.
- **Not established:** why `admin_fee_pct`, `gross_up_pct` and `expense_stop` sit at ~3%
  coverage while `audit_rights` and `pro_rata_method` reach ~25%. It is consistent with
  those clauses simply being rarer in this lease set, but I did not open the source PDFs to
  confirm it, and the brief did not authorise re-running extraction to test it.
