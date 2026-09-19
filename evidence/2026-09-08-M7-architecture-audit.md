# M7 — M1–M6 architecture and readiness audit

**Read-only.** No code changed, no migration applied, nothing deployed, no data repaired.
Base commit `eee8528`. Branch `claude/validation-runs-analysis-ji1zb3`.

Every claim below is either a citation to a file and line, or a number produced by a
measurement probe run against the real capabilities. Where I inferred something from
reading and the measurement disagreed, the measurement wins and the correction is stated.

---

## The question

> If an external AI agent connected to MainStreet today, what can it reliably know about a
> commercial property, what can it not know, and where could it still be misled?

### The short answer

**MainStreet's *truthfulness machinery* is production-quality. Its *information architecture*
is not yet coherent enough to call the system a property's verified memory.**

The distinction matters, and it is the whole finding. M1–M6 built something genuinely
rare: a read surface that reliably distinguishes "none" from "unknown" and refuses to
answer rather than guess. That machinery works, is mutation-tested, and holds under
dependency failure.

What it sits on top of is a record with **two stores that disagree**, **one vocabulary used
two ways**, **seven lease fields that have provenance but no value**, and **a unit that is
never declared**. An agent connected today would rarely be told something false. It would
frequently be told nothing, and it could be misled in four specific, reproducible ways.

So: the moat is real, and it is currently guarding a partially-empty vault.

---

## Part 1 — The entity chain

`Property → Spaces → Tenants → Leases → Evidence → CAM → Timeline → Disputes → Attention`

### Property

| | |
|---|---|
| Canonical source | `properties` row (`id`, `name`, `sqft`) + the `data` JSON blob |
| Exposed by | `list_properties` (row only), `get_property` (full record) |
| Provenance | `origin: server`, `includesBrowserLocalState: false`, three reads named |
| Verdict | **Production-quality**, with one incoherence (below) |

`identity.leasedSqft` is **always null**, by deliberate design: three modules compute a
property-level leased total and disagree (`acquisition-engine` skips extraction-failed
tenants; `lease-review-packets` counts active only; `PropertyReference.occupancyPct` sums
every tenant). PropertyRecord refuses to make one canonical (`property-record.js:70-77`).

**But `identity.occupancy` is exposed anyway** — and `occupancyPct`
(`property-reference.js:150-159`) is computed as `Σ(leased_sqft || sqft) / totalSqft`,
which *is* one of the three disputed definitions. Measured: `leasedSqft: null`,
`occupancy: 50` in the same response. An agent can multiply occupancy by `totalSqft` and
recover the number the record just declined to state.

That function also clamps with `Math.min(100, …)`. A property whose tenant square footages
sum to more than its total area — double-counted tenants, a stale suite record — reports
exactly `100`, and the contradiction that would have revealed the bad data is erased.

### Spaces and Tenants

In this data model **a space and its tenant are one object**; `space.id` is the tenant id.
`TenantSpace.assemble` owns the definition, including the "no identity, no record" guard
(`noIdentity`) and the duplicate-name guard. PropertyRecord does not second-guess it.

| | |
|---|---|
| Canonical source | `data.tenants` blob; the `tenants` **table is a fallback only** |
| Exposed by | `get_property.spaces`, `get_tenant`, `get_space` |
| Provenance | `tenants.from_table_no_review_state` when the fallback fired |
| Verdict | **Production-quality contract, pilot-quality data** |

The table fallback loses review state, `reviewOverrides` and `capBaseAmount` entirely — it
is correctly reported as degraded rather than silently thinner.

### Leases

**This is the largest incompleteness in the system.** `LeaseIntelligence.CANONICAL_FIELDS`
has 13 entries. Measured, against a fixture where every one carries a real stored value:

```
field                 stored          provenance         value exposed as
cap                   5               ai_extracted       5
cap_base_amount       100000          manually_entered   — not exposed anywhere —
admin_fee_pct         15              ai_extracted       — not exposed anywhere —
gross_up_pct          95              ai_extracted       — not exposed anywhere —
expense_stop          20000           ai_extracted       — not exposed anywhere —
audit_rights          Tenant may…     ai_extracted       — not exposed anywhere —
pro_rata_method       rentable        ai_extracted       — not exposed anywhere —
renewal_options       One 5-year…     ai_extracted       — not exposed anywhere —
tenant_name           Acme Coffee LLC ai_extracted       Acme Coffee LLC
leased_sqft           500             ai_extracted       500
start_date            2020-01-01      ai_extracted       2020-01-01
end_date              2030-01-01      ai_extracted       2030-01-01
lease_type            NNN             ai_extracted       NNN

6 of 13 expose a VALUE; 7 carry provenance with no value.
```

An agent can learn that **a named reviewer manually entered the cap base**, and cannot
learn **what the cap base is**. It can learn the admin fee is cited on page 4 of a named
PDF, and cannot learn that it is 15%. `space.lease` exposes only
`{type, sqft, start, end, cap, url, fileName}`, and `fieldProvenance` returns state,
attestation and citation but **never the value itself** (`field-provenance.js`, the `out`
object has no `value` key).

*(This confirms the M5 finding at the same count of seven, now measured end-to-end through
the capability surface rather than inferred from the record.)*

### Evidence

| | |
|---|---|
| Canonical source | `tenant_field_evidence` table — **the only normalised table the AI surface reads as canonical** |
| Exposed by | `get_lease_evidence`, `get_tenant.fieldProvenance` |
| Provenance | five states; `evidence.read_failed` ⇒ `null`, never a floor state |
| Verdict | **Production-quality.** The strongest link in the chain. |

The `evidence.read_failed → null` rule is the sharpest piece of reasoning in M1–M6: a
failed read would otherwise silently downgrade `manually_confirmed` with a named reviewer
to `ai_extracted` with `by: null`, turning "a person verified this" into "a model guessed
this". It is the one degradation that *fabricates a positive claim*, and it is handled.

### CAM

| | |
|---|---|
| Canonical source | `data.camReconciliation` blob snapshot, via `PropertyRecord._cam` |
| **Not read** | the `cam_reconciliations` **table** |
| Exposed by | `get_cam_status` |
| Verdict | **Production-quality gate, pilot-quality data, duplicated store** |

The expectation gate is correct and mutation-verified. In practice, on today's pilot data,
it will return almost nothing. Measured against a row in the exact shape migration 020
found in pilot (`expectedCam: 5`, `variance: 5995`, no stamp):

```
reported : expectedCam=null variance=null trust=unstamped_value_withheld
tally    : {"established":0,"withheld":1,"none":0}
```

Honest, and nearly empty. Migration 020's own header records the measurement: *46 rows,
28 with a non-null `expected_cam`, all whole numbers in 3..8 — "There is not one
legitimately-derived ceiling in the table."*

### Timeline

| | |
|---|---|
| Canonical source | `data.timeline` blob; scoped by `TenantSpace`, keyed by `TimelineMerge.eventKey` |
| Exposed by | `get_timeline` (property-level and tenant-scoped) |
| Provenance | `timeline.server_origin_only` on every response |
| Verdict | **Production-quality**, with a permanent and correctly-declared scope limit |

The browser merges localStorage into the timeline; the server cannot. Every response says
so rather than presenting a partial timeline as complete. Property-level attachments are
absent (`TenantSpace._attach` is not exported), and `lease_documents` is never read.

### Disputes

| | |
|---|---|
| Canonical source | `data.disputes` blob — real records only |
| Exposed by | `get_disputes`, `get_tenant.disputes`, space `counts.disputes` |
| Verdict | **Misleading — see M7-A.** The contract is right; the vocabulary is not. |

### Attention

| | |
|---|---|
| Canonical source | `PropertyWorkspace.collectAttention` |
| Exposed by | `get_attention` |
| Provenance | always `degraded`; `allClear` always `null` server-side |
| Verdict | **Incomplete by construction, and honest about it** |

`collectAttention` reads `window.Selectors` for its readiness signals; the server graph
excludes Selectors (it reaches for a bare `ReviewEngine` global). So the server's list is
*permanently* shorter than the application's, and `allClear` can never become `true` today.
This is correct behaviour and it is also a capability that cannot currently do its job.

---

## Part 2 — Capability → source → provenance → limits → security

| Capability | Canonical source | Provenance carried | Hard limitation | Security |
|---|---|---|---|---|
| `list_properties` | `properties` row | `summary_only` caveat | no counts, no disputes, no CAM; **no pagination** | owner-scoped; 1 read |
| `get_property` | full record | 8 section statuses | no payments; unbounded size | owner-scoped; 3 reads |
| `get_tenant` | `spaces` + disputes + docs + provenance | section statuses | 7 lease values absent | resolved inside owned record |
| `get_lease_evidence` | `tenant_field_evidence` | state/attestation/citation | **no values, ever** | resolved inside owned record |
| `get_space` | `spaces` | section statuses | duplicates `get_tenant` by design | resolved inside owned record |
| `get_timeline` | `data.timeline` | `server_origin_only` | no localStorage events; no property attachments | resolved inside owned record |
| `get_disputes` | `data.disputes` | section statuses | **"open" defined differently than in `get_attention`** | resolved inside owned record |
| `get_cam_status` | **blob snapshot** | trust label per row + gate stated | **table not read**; nearly all rows withheld today | resolved inside owned record |
| `get_attention` | `collectAttention` | always degraded | no Selectors ⇒ permanently short | resolved inside owned record |

**Security, common to all nine and verified per capability:** identity is server-derived from
a bearer token only; there is no `userId` parameter; only `user.id` crosses the boundary
(never `role`, `app_metadata`, `user_metadata`); ownership is `properties.user_id =
authenticated user`; `tenant_users` is never consulted, so a tenant-portal session holding a
valid token for a property it does not own is refused; service-role credentials are transport
only; every write verb is refused by a guard, not merely unused. This holds.

**Two security gaps, both structural rather than latent bugs:**

- **No rate limiting.** `api/_rate-limit.js` is used by *eleven* endpoints in `api/`
  — `ask-lease`, `claude`, `cam-reconciliations`, `lease-documents`, `upload`,
  `rlusd-settlement` and more. The MCP capability module uses **none**. It is the only
  read surface in `api/` without it, and every call makes an uncached `/auth/v1/user`
  round trip.
- **No pagination or size caps anywhere.** No `limit`, no `offset`, no slice in the module.
  `list_properties` returns every property; `get_property` returns every timeline event and
  every space in one response. For an agent surface, an unbounded response is both a cost
  problem and a context-exhaustion problem.

---

## Part 3 — Classification

### Production-quality

1. **The four-state truthfulness contract** — `ok` / `empty` / `degraded` / `unavailable`,
   with `unavailable` as `null` and never `[]`, precedence `unavailable > degraded > empty`,
   kept distinct to the caller. 1,119 assertions across M1b–M6, all passing.
2. **The identity and ownership boundary** — re-tested per capability rather than inherited.
3. **Read-only enforcement** — a write is refused by a guard, and asserted absent from the
   executable code with string literals blanked so the prose promising it cannot pass the scan.
4. **The expected-CAM basis gate** — the same predicate as the persister, 26/26 mutants killed.
5. **Evidence provenance** — including the `read_failed ⇒ null` rule.
6. **Deployment realism** — `@vercel/nft`-shaped static require tracing, 0 computed requires,
   plus an out-of-process runtime harness. This is why the graph will actually load in a
   serverless runtime rather than merely passing locally.
7. **Envelope determinism** — identical calls agree byte for byte; `asOf` is the caller's clock.

### Pilot-quality

1. **CAM expectation data.** The gate is right; the data behind it is almost entirely
   unstamped, so `get_cam_status` returns `expectedCam: null` for essentially every
   historical row. Measured: `{established: 0, withheld: 1}` on a pilot-shaped row.
2. **Attention.** Permanently degraded server-side; `allClear` structurally always `null`.
3. **Tenant roster via table fallback.** Loses review state, overrides and cap base.
4. **`expected_cam_basis` column.** Exists since migration 020; **nothing writes or reads
   it** ("every row reads NULL, which is the honest answer for all 46 of them").

### Incomplete

1. **Seven of thirteen canonical lease fields have provenance but no value.** Measured.
2. **`identity.leasedSqft` is permanently null** — three definitions, none chosen.
3. **Payments are entirely absent from the AI surface.** The hydrator loads `settlement`,
   `escrowReserves` and `drawRequests` into `property`; `PropertyRecord.assemble` surfaces
   none of them. Measured: none of `ABC123`, `25000`, `escrow`, `drawRequest`, `settlement`,
   `testnet` appears in *any* of the nine capability responses. An agent asked "has this
   tenant settled?" gets silence — and silence is the failure mode this project exists to
   prevent.
4. **Property-level timeline attachments**, and the entire `lease_documents` table.
5. **No transport.** Nine capabilities, zero endpoints. Nothing can connect today.
6. **No rate limiting, no pagination, no size caps.**

### Misleading — the four ways an agent could still be wrong

**M7-A · Two definitions of "open dispute", in the same response set. (Measured.)**

Fixture: one dispute `status: 'open'`, one `status: 'docs_requested'`.

```
get_attention  → items: ["1 open dispute", …]
get_disputes   → disputeCount: 2, openDisputeCount: 2
```

`property-workspace.js:47` counts `d.status === 'open'`. `tenant-space.js` and
`getDisputes` count `'open' || 'docs_requested'`. So do `selectors.js`,
`command-center.js`, `acquisition-engine.js` and `lease-review-packets.js` — all on the
narrow definition. An agent calling both capabilities receives **two different counts of
the same disputes on the same property**, with no caveat, both labelled confidently. This
is the most serious finding in the audit, because both answers pass every existing test.

**M7-B · `lease.cap` has no declared unit. (Measured.)**

```
lease as exposed: {"type":"NNN","sqft":500,"start":…,"end":…,"cap":5,"url":null,"fileName":null}
```

The convention is a percentage number — `normalizeCap` (`script.js:2077`) maps `"35%"` → 35
and `"0.35"` → 35, and `_camCeilingCents` computes `base × (1 + pct/100)`. Nothing in the
response says so. An agent receiving `cap: 5` cannot distinguish 5%, 0.05, or $5, and
`normalizeCap`'s `n < 1 ? n*100 : n` rule means a genuine 0.5% cap becomes 50.

**M7-C · Occupancy silently restores the number `leasedSqft` refuses to state.** Above.
Compounded by the `Math.min(100, …)` clamp, which converts evidence of bad data into a
confident `100`.

**M7-D · The blob and the tables are two records of the same facts, and only one is read.**

`saveCamResults` writes **both** a blob snapshot (raw in-memory rows, unstamped legacy pairs
included) and normalised `cam_reconciliations` rows (gated, bad pairs nulled). `get_cam_status`
reads the blob. Nothing reconciles them and nothing reports the divergence. The same holds for
`tenants` (blob wins, table is fallback). An agent's view of a reconciliation is the browser's
last snapshot, not the system of record — and the response says which store it read, which is
why this is *contained* rather than actively false. But two stores of the same fact, with
different gates, and no reconciliation, is not verified memory.

### Duplicated

1. **Blob vs normalised tables** — `tenants`, `cam_reconciliations`. See M7-D.
2. **`get_tenant` vs `get_space`** — overlapping by construction and documented as such.
   *Not* a defect: a space and its tenant are one object, and inventing a difference would
   mean inventing a second space model. Leave it.
3. **Two "open dispute" definitions** — see M7-A.
4. **Three "leased square footage" definitions** — see Property.

---

## Part 4 — What should become M7

Ranked by how much each increases what an agent can *reliably* know per unit of risk.

**M7 (recommended) — Semantic coherence. No new capability, no new endpoint, no new read.**

1. **Settle the dispute-status vocabulary.** One exported predicate, one definition of open,
   consumed by `collectAttention`, `TenantSpace` and `getDisputes` alike. Whichever definition
   is chosen, the two capabilities must stop contradicting each other. *(M7-A)*
2. **Declare units and meaning on every exposed lease term** — starting with `cap`. Either
   rename to `capPercent`, or carry an explicit unit alongside the value. *(M7-B)*
3. **Make occupancy consistent with `leasedSqft`.** Either state the leased area under a named
   rule, or withhold the percentage derived from it. Reporting a derived ratio while refusing
   its numerator is the same class of error the project has spent six phases eliminating.
   The `Math.min(100, …)` clamp should surface the contradiction, not hide it. *(M7-C)*
4. **State the store.** Every response that reads the blob should say the normalised table
   exists and was not read — `get_cam_status` already does this; nothing else does. *(M7-D)*

This is a small, tightly-bounded, high-value phase. It fixes every *misleading* finding
without adding surface area, and it is the one thing that must be true before a transport
is built — because once an agent is connected, a contradiction between two capabilities is
no longer a latent bug, it is a wrong answer given to a user.

**M8 candidate — lease field values.** Extend `PropertyRecord` so the seven provenance-only
fields carry their values. This is the largest single increase in what an agent can know.
It is a record change, not a capability change, and deserves its own phase.

**M9 candidate — transport, with rate limiting and pagination built in from the first commit,
not retrofitted.** The MCP module being the only surface in `api/` without rate limiting is
acceptable while it has no endpoint and unacceptable the moment it has one.

---

## Part 5 — Explicitly deferred (unchanged, each needing separate approval)

- Phase 1b payment write path, and any exposure of payments/settlement/escrow to the AI surface
- Ripple / XRPL integration
- CAM data repair: the 28 pilot rows, 6 orphan reconciliations, 15 dangling evidence rows
- Wiring `expected_cam_basis` into `saveCamResults` / `loadCamResults`
- `lease_documents.tenant_id` rename; FK on `cam_reconciliations.tenant_id`
- Maple Coffee `275d2435` human review
- SEO P1/P2; `/` → `/home` routing
- Fail-silent `persistFieldEvidence`
- `test-broken-promises.js` baseline failure (2 failures, pre-existing, untouched)
- Property-level timeline attachments; `lease_documents` reads
- Making `Selectors` loadable server-side (would let `attention` become complete — but it
  reaches for a bare `ReviewEngine` global, and M3 deliberately left it excluded)

---

## Method

- Read: `property-record.js`, `tenant-space.js`, `field-provenance.js`, `lease-intelligence.js`,
  `property-workspace.js`, `property-reference.js`, `api/_property-record-hydrator.js`,
  `api/_mcp-capabilities.js`, `script.js` (CAM paths), migrations 003/009/020.
- Measured: a read-only probe running all nine capabilities against fixtures, offline, no
  network, no Pilot, no Production, nothing written. Kept in the session scratchpad, not
  committed — it is a measurement instrument, not a test.
- One correction made during the audit: an initial substring scan reported `gross_up_pct`
  as reachable because `"95"` occurs inside the variance `5995`. Re-done with exact field
  paths; the corrected count is 6 of 13, which independently matches the M5 evidence record.
