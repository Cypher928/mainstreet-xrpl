# Phase 0 — Engineering Sequence (P0.0 – P0.5)

The engineering foundation laid before Phase 1 Acquisition Workspace work began:
what each slice established, the commit that carries it, the migrations it
introduced, what was verified on the real Pilot database, and what it
deliberately did not do.

This file exists because that history lived only in commit titles and in code
comments. A later session went looking for "the P0.6 plan" and found nothing —
correctly, because there never was one: the numbering records work *delivered*,
not work *planned*. It is written down here so nobody has to reconstruct it from
`git log` again.

---

## 0. Three different things are called "Phase 0". This is one of them.

| | What it is | Where |
|---|---|---|
| **This file** | An **engineering** sequence: database hardening, authorisation, the monolith rule, durable history. Numbered P0.0–P0.5. | `docs/PHASE0_ENGINEERING_SEQUENCE.md` |
| **Roadmap Phase 0** | A **customer-validation measuring exercise**: build a 30–50 lease corpus, hand-abstract ground truth, score precision/recall per field, reconciliation parity in dollars, hours saved against a measured baseline. No engineering items, no P0.x numbering. | `docs/ROADMAP.md` § "Phase 0 — Validation" |
| **Phase 0 Remediation Plan** | A **lease-extraction defect plan**: M1–M11, E1, P1a–P6, with its own §5 sequencing. Unrelated to this numbering. | `docs/PHASE0_REMEDIATION_PLAN.md` |

They share a name and nothing else. If someone says "the Phase 0 plan", establish
which one before acting.

---

## 1. The sequence

### P0.0 — The monolith baseline, and the suite that holds it
**Commit `2557bc6`** · no migration

`script.js` does not grow. The ceiling is a committed baseline generated from the
tree — 31,716 lines, 761 top-level functions, 8 inline `index.html` script lines
— enforced by `test-monolith-budget.js`, which runs **first** in the regression
and cannot be excused through the coverage manifest (`test-suite-registration.js`
treats it as always-registered). New functionality goes in modules; when a slice
must touch the monolith, the logic is lifted into a module and the monolith keeps
a thin delegation.

The ratchet only turns one way: a slice that lifts code out re-runs
`--write-baseline` in the same commit, and the writer refuses to raise any
number.

### P0.1 — Organisations: owner OR active member, and a path is not a grant
**Commit `9117926`** · migration **024** (`024_organizations.sql`)

One authorisation rule in one module (`api/_membership.js`): a caller may see a
property if they own it or are an active member of its organisation. Applied by
`api/lease-documents.js`, `api/cam-reconciliations.js`, `api/ask-lease.js` and
others.

`api/document-url.js` carries the sharper half: **a storage path is an address,
never a grant.** Access resolves through a record the caller may see — a
`lease_documents` row, or (with no register row) the pre-P0.1 rule that the first
path segment equals the caller's own uid. An org-prefixed path with no row is
refused outright, so guessing a path yields nothing.

### P0.2 — A property joins the portfolio by stage transition, never by copy
**Commit `1689eb1`** · migration **023** (`023_property_lifecycle.sql`)

`lifecycle_stage` travels with the row and `PropertyLifecycle` (in
`property-lifecycle.js`) is the only thing that decides what it means. A prospect
does not become a portfolio property by being duplicated; it transitions. The
portfolio read path is one place — `loadProperties` — so every dashboard and
every intelligence computation inherits the active/archived filter from it.

`PropertyLifecycle.SELECT_COLUMNS` dates from here, and is a useful forensic
marker: a client asking for `id,name,sqft,user_id,archived_at` **without**
`lifecycle_stage` is running a build older than this commit. That fact identified
a stale deployment during P0.5 validation (see §4).

### P0.3 — The remaining tables: one register, one evidence shape, one event log
**Commits `0625b4d`, then `148837f` (privilege hardening), then `e03560a` (028b fix)**
Migrations **025**, **026**, **026b**, **027**, **028**, **028b**, **029**

- **025** document register (`lease_documents`) — the row P0.1's rule resolves through.
- **026** / **026b** `lease_provisions`, plus the privileges that state the same contract the policies do. Supabase grants ALL on a new public table to `anon`/`authenticated`/`service_role` at creation and grants are additive, so explicit revokes are required — a policy alone is not the whole story.
- **027** evidence lineage.
- **028** / **028b** `property_events` — append-only, actor stamped from `auth.uid()`, `organization_id` derived from the property, no update or delete grant to any role.
- **029** financial persistence infrastructure only. Deliberately **no** GL parsing, rent-roll parsing, T-12, NOI, reconciliation or acquisition conclusions — those are Phase 2.

**028 shipped with three real defects, found by verification and fixed in 028b:**

1. The delete guard tested `pg_trigger_depth() = 0`, which is **unreachable** — measured, not assumed: inside a row trigger a direct statement is depth 1, an FK `CASCADE` delete is depth 2, an FK `SET NULL` update is depth 2. The guard was inert. Now `<= 1`.
2. `TRUNCATE` was uncovered. Now refused by a statement-level `BEFORE TRUNCATE` trigger.
3. The UPDATE block was unconditional, so an FK's own `SET NULL` cleanup could not run — deleting a referenced user or organisation would have failed. Now a `SET NULL` that touches only `actor_uid`/`organization_id` is permitted and everything else is refused, so history survives the deletion of the people it names.
4. `organization_id` was trusted from the caller. Now derived unconditionally from `property_id`.

### P0.4 — One lease field registry, and the prompts read it
**Commit `8be004a`** · no migration

`lease-field-registry.js` ends four competing lease field lists. `FIELDS` order
*is* prompt order; each field declares its label, its storage key and its type
per profile (`text`, `pdf`, `server`). `promptSchema(profile)` reproduces all
three blocks **byte-for-byte** with what the hand-written blocks said at
`e03560a`, and `test-lease-field-registry.js` holds them against a frozen copy
taken from that commit — so the suite cannot pass by agreeing with itself.

Exactly four fields are renamed on storage: `sqft→leased_sqft`, `cam_cap→cap`,
`lease_start_date→start_date`, `lease_end_date→end_date`.

`script.js` changed on exactly two lines — the two prompt interpolations. No
extraction semantics, no calculation behaviour, no schema.

### P0.5 — Durable property history, derived in the property's own transaction
**Commit `c9789b1`** · migration **030** (`030_property_events_derive.sql`)

**Why there is no outbox.** Tracing the writers first changed the answer.
`savePropertyData` sets `prop.activityLog` and `prop.timeline`, and
`saveProperty` sends them inside `data` in **one** PostgREST call. One request is
one transaction, so the activity log and the timeline were **already** written
atomically with the property mutation — merely trapped in a JSON blob.

An outbox exists to bridge two writes that cannot share a transaction. Here they
already do. An outbox would have added a second write that can fail on its own,
then a worker, a retry ladder and a poison queue, to cover a gap this
architecture does not have. More machinery, weaker guarantee.

So 030 has the database read the blob on write: an `AFTER INSERT OR UPDATE OF
data ON public.properties` trigger records each entry as a real `property_events`
row, in the transaction that fired it. The event commits with the property or
neither commits. No outbox, no queue, no worker, **no `script.js` change at all**.

- `source_key` is `activity:<id>` or `timeline:<dedupeKey|id>`, with a partial unique index, so a replayed save is a no-op. 028b's refusal of any non-FK UPDATE is what forces `ON CONFLICT DO NOTHING` rather than `DO UPDATE`.
- `AuditService.shapeEvent` (in `audit-service.js`, outside the monolith) assigns a stable `ae-` id at creation. It is generated there rather than derived later from type/title/timestamp, because those are mutable display values and two events can share all three within one millisecond.
- The derive function is deliberately total: `_p05_safe_ts` returns NULL on an unparseable timestamp rather than raising, the action is clamped to 80 characters, and each insert is gated on the identity it needs existing.

**Watermark, and no backfill.** Pre-P0.5 entries name their actor with a display
string like `User`, so their authenticated identity is unrecoverable and they
must never become apparently-verified history. Activity is gated on carrying the
stable id, so older entries are excluded *by construction*, with no clock
involved. The timeline always had ids, so 030 captured every existing timeline
key into `property_events_watermark` at migration time, when no post-P0.5 entry
could yet exist. Any future backfill is a separate, explicitly authorised piece
of work and would use the original timestamp with `actor_uid` NULL.

### Supporting: B1 CI fixture teardown
**Commit `131c309`** · no migration

Every CI run was leaving an orphan `b1ci-*` organisation in Pilot. The fix is
teardown *order*: properties first (`organization_id` is `ON DELETE RESTRICT`),
organisations next — while `created_by` still names this run's landlord, since it
is `ON DELETE SET NULL` — users last. Ids are captured **before** deletion and
re-read by id afterwards; the first attempt verified organisations by
`created_by` *after* deleting users, which nulls that column, so the residue
check passed vacuously.

---

## 2. Migrations, in the order they were applied to Pilot

```
024 → 023 → 025 → 026 → 026b → 027 → 029 → 028 → 028b → 030
```

Not numeric order. Each was applied one at a time, under explicit
per-migration authorisation, verbatim, and verified before the next.

**Verbatim proof method.** Compare the stored
`supabase_migrations.schema_migrations.statements` normalised md5 against the
local file: strip comments (`regexp_replace(…, '--[^\n]*', '')` server side,
`sed 's/--.*$//'` locally), strip all whitespace, compare md5. This catches an
edit made between review and application.

**Pilot marker property.** `fd9c09b1-b657-4c58-9999-c3cce28e7600` ("V3", owned by
`lynnie928@mac.com`) guards every migration: its presence is what confirms the
target is Pilot `bhmktujbxdbvdmpybmad` and not Production `zhsuhehgehbzkmzurzyf`.

**Production has never been touched.** No migration, no schema change, no RLS
change, no deployment, no write of any kind.

---

## 3. What was actually verified on Pilot

Not "the tests pass" — what was observed on the real database.

**Schema and privileges (P0.3).** Every table, index, trigger, policy and grant
read back from `pg_catalog` / `information_schema` after each migration. Explicit
revokes confirmed present, not assumed from the policy.

**Append-only enforcement (028b).** Behaviour-level, not predicate-level: a
direct UPDATE refused, a direct DELETE refused, TRUNCATE refused, an FK
`SET NULL` cleanup permitted, `organization_id` derived rather than accepted from
the caller. The earlier offline assertion that merely checked for the literal
string `pg_trigger_depth() = 0` was replaced — it had passed against an inert
guard.

**Derivation (030).** 69 behaviour tests against **real PostgreSQL**
(`test-030-event-derivation.js`), plus 18/18 mutants killed
(`tools/p05-derive-mutation.js`). Two mutants were retired as documented
equivalents after being verified empirically, with the reasoning recorded in the
harness rather than propped up.

**Live browser validation (P0.5), 2026-09-18.** The full path — real Safari, the
deployed `c9789b1`, the live Pilot database — driven by hand:

| | Evidence |
|---|---|
| Activity path | Two `audit_log_export` clicks on Cascade Commons `dec00000-0000-4000-a000-011df998bad2` → exactly two rows, `source_key` `activity:ae-233f87d3-…` and `activity:ae-32e29350-…` |
| Timeline path | One manual record → one row, `action` `manual_maintenance`, `source_key` `timeline:tl-1789775335077-fngg8l`, `detail.source` `timeline` |
| Actor authority | `actor_uid` `011df998-bad2-464e-bbcb-28e2d0fee821` on every row, stamped from `auth.uid()`; the client's `"User"` / `dan@wrgusa.com` string preserved only as `detail.client_actor` |
| Organisation authority | `organization_id` `2aa39264-1d44-4f43-8293-20da3208face`, derived server-side from `property_id` |
| Replay idempotency | Three saves each re-sent the whole blob; the partial unique index absorbed every replay. No duplicates. |
| Watermark under real replay | All **70** legacy timeline entries replayed three times; **zero** derived. |
| Isolation | Three rows in the whole table, all on the one property acted upon. |

---

## 4. Post-P0.5 stabilisation (2026-09-18/19)

### The finding that cost the most: deployment identity

`www.mainstreet-review.com` — the designated Pilot URL — serves the Vercel
**production** deployment, which predates P0.2. A validation session ran for two
hours against it while believing it was testing the branch preview.

Proof, from the Pilot edge logs' `referer` header:

| Time (UTC) | Referer | Portfolio query |
|---|---|---|
| 14:03, 21:48, 22:59, **23:33:51** | `www.mainstreet-review.com` | no `lifecycle_stage` → pre-P0.2 build |
| **23:35:04** onward | `mainstreet-xrpl-2vge69ads-…vercel.app` | `…,lifecycle_stage` → `c9789b1` |

Everything followed from that: activity entries written with no `id` (that build's
`audit-service.js` is older than P0.5), which 030 correctly declined to derive.
**An earlier diagnosis of "stale Safari cache" was wrong** and is recorded here
so it is not repeated.

The root cause is structural: **one Vercel project
(`prj_9H4W4nUTW8tdsfYocJ9jruThakJJ`) serves both `www.mainstreetcam.com`
(Production Supabase, real customers) and the pilot domain.** Promoting to bring
the pilot URL up to date would change the customer app. Verified by identical
ETag `W/"058f3c89441af9e593f6acda14b6b5c3"` on both hosts.

Routing itself is sound and single-sourced: `supabase-config.js` assigns
`window.__MS_SUPABASE` in one place and selects by hostname against a two-entry
allowlist, defaulting to Pilot. Config bugs fail toward pilot, the safe
direction.

### P1 — deployment identity and asset freshness
**Commit `620276a`**

- `vercel.json`: `/(.*)\.(js|mjs)` → `Cache-Control: no-cache` (revalidate before every use; stronger than the `max-age=0, must-revalidate` default the assets were getting). Repo-wide, so it applies to Production from its next deployment — it only makes caching stricter.
- `api/build-info.js` reports the deployment's commit, ref, env and deployment id from Vercel's environment, `no-store`. There is no build step in this repository, so no static asset can carry the commit. The endpoint reads **only** those four public variables and `test-build-identity.js` pins the list.
- `build-stamp.js` logs one line beside the Supabase target line: `[build] host "…" · commit c9789b1 · ref … · env preview`. Read together they answer the two questions a live test must settle first — which database, which code.

The stamp identifies a *deployment*; it cannot alone catch one stale asset among
fresh ones. The header rule is what prevents that. They ship as a pair.

### P2 — the activity-log merge invariant
**Commit `4bf342e`**

> **Local state may ADD activity. Local state must never ERASE durable activity history.**

`loadPropertyData` reconciled disputes explicitly and the timeline explicitly,
but took `activityLog` from `...base` — and `base` is whichever side won a
comparison of **tenant count**. A local snapshot carrying one more tenant became
the whole activity log, and `savePropertyData` then wrote that deletion back.
Observed: two `audit_log_export` entries written from one host were gone by the
next save made from another (localStorage is per-origin).

`TimelineMerge.mergeActivityLogs` owns the rule, beside the timeline union it
mirrors, and **reuses `eventKey` unchanged** — the `id` from P0.5 onward, else
`type+timestamp+title` joined on `\u001f`. For an id-less legacy entry that means
two merge only when they share a type, a title and a millisecond. There is
deliberately not a second identity system. Newest-first, capped at 200, both
matching what `logActivity` already maintains. `script.js` keeps six lines of
delegation and none of the rule; with the module absent it returns the database
copy, because "never erase" is the safe direction to fail in.

Retention was **not** redesigned and the cap was **not** raised: an entry trimmed
at 200 is still durable history, because 030 derived it on write.

`tools/activity-merge-mutation.js` — 18 mutants, 18 killed. A01 is the observed
data loss itself, reintroduced.

### P3 — save failures are visible
**Commit `972461c`**

`saveProperty` is called fire-and-forget, and `_captureSnapshot` / `_lsSave` ran
*before* its try block — so a throw in either was an unhandled promise
rejection: no console error, no `logError`, no toast, no sync status, **and no
write**. A save that did not happen, with nothing to say so.

Both moved inside the existing boundary; they now fail the way a failed Supabase
write already failed. The generation counter stays outside, because the catch
reads it for the staleness guard, and `_lsSave` still precedes the network
attempt so an offline failure keeps the work. `_saveFailed` is the shared sink
for the three authorised call sites, each passing its own label — `debounced`,
`leaving`, `navigating` — so a log entry says which path lost the save and which
property.

`_saveFailed` is a `const` arrow rather than a `function` declaration, so the §00
top-level function count is unchanged at 761. That is the letter of the rule and,
for a four-line error sink, its intent — but it is recorded here rather than left
for a counter to imply.

`tools/save-failure-mutation.js` — 14 mutants, 14 killed.

### P4 — `lease_jobs` 403 (investigated, not fixed)

An **application-scope defect**, not a membership problem and not an RLS defect.
The policy is correctly refusing a row the client should never have sent.

The chain:

1. `_reapStaleLeaseJobs()` runs at startup and selects `id,status,stage,updated_at` for jobs in `queued`/`processing` — **`property_id` is not in the column list** (`script.js:5024`).
2. For each job older than 15 minutes it calls `failLeaseJob(job.id, …)` → `updateLeaseJob(jobId, updates, { terminal: true })`.
3. After a reload the in-memory `_leaseJobs` Map is empty, so the write-through branch sends `{ id: jobId, ...updates, updated_at }` — **still no `property_id`** (`script.js:~4945`).
4. `_syncJobToDb` issues `db.from('lease_jobs').upsert(row)` → `INSERT … ON CONFLICT DO UPDATE` with `property_id` NULL (`script.js:4970`).
5. Policy `lease_jobs_owner_all` WITH CHECK is `property_id IN (SELECT member_property_ids())`. Measured on Pilot: `null::uuid IN (subquery)` evaluates to **NULL**, which a policy treats as false → `new row violates row-level security policy for table "lease_jobs"` → HTTP 403.
6. `terminal: true` retries once, so **two POSTs per stale job**.

Arithmetic that confirms it: `dan@wrgusa.com` has exactly **two** stale jobs —
`361238eb-f0d1-4950-a641-8ec0ccdb62d1` ("Chase (7-30-24).pdf", stage `normalize`)
and `5bbe0808-45ad-4f0e-83bc-673faf549588` ("Pret A Porte.pdf", stage
`confidence`), both on property `24246b76-d96e-455d-8089-f2ec8512c24b` ("Test"),
which he owns. Two jobs × two attempts = the **bursts of four 403s** seen at
every app load, on both the old deployment and `c9789b1`.

`lease_jobs` holds 110 rows, all with a non-null `property_id` (written by the
full-row path, which includes it) and none newer than `2026-09-16 20:35`. **68
rows are stuck in `processing`** — across 6 owners and 19 properties, 0 in
`queued` — and can never be closed out, so the reaper retries the same jobs on
every load, forever. (An earlier report of "71 rows across 8 users" was a
miscount of a result listing; the counted figures are recorded in §4/P4 of the
follow-up commit.)

**Impact.** Lease-job state is no longer persisted: a tab closed mid-upload
leaves a job `processing` permanently, and the watchdog's terminal write — the
one write the code says it cannot afford to lose — is the one that fails. Each
load also writes four `logError` entries (`lease_job_sync`,
`lease_job_sync_retry`), which crowds the capped per-user error log that
`window._msErrors` reads and makes it less useful for diagnosing anything else.

**Recommended next action** (not implemented, no authorisation sought yet):
carry `property_id` through the reaper — add it to the SELECT and pass it into
the update — so the upsert sends a complete row. Consider also having
`_syncJobToDb` refuse a row with no `property_id` rather than issuing a write
that cannot succeed. The 68 pre-existing stuck rows are a separate data decision.

**Fixed in `R1` (see below).** The reaper now selects `property_id`, carries it
through `failLeaseJob`, and `_syncJobToDb` refuses an incomplete row before
issuing a request. The 68 stuck rows were left exactly as they are, by
instruction — a separate data decision, not something to change silently while
fixing the code that stranded them.

Note on method: `window._msErrors.show()` was the intended instrument but no
browser was reachable from the working environment. The `job_id` and
`property_id` above come from the database and the code trace instead, which is
stronger evidence than the error log would have been.

---

## 5. Parked — decided, not forgotten

Each of these is understood and deliberately not addressed. None is a bug
awaiting triage.

| Item | Why it is parked |
|---|---|
| **The seven remaining fire-and-forget save paths** | `script.js:2595` (escrow reserve delete), `3743`/`3771` (space vacancy), `23307`/`23790`/`23844` (owner-property writes), `25849` (restore — wrapped in a `try/catch` that catches nothing, since the throw is a rejection). P3 covered the three authorised sites only. `test-save-failure-visible.js` §4 enumerates these by line and holds the count at **7**: it may fall freely, but raising it fails, so a new unwatched save cannot land silently. **Explicit follow-up, ~7 lines.** |
| **Vercel project split** | The single project serving both `www.mainstreetcam.com` and the pilot domain. Until it is split, the Pilot URL cannot be updated without touching the customer app, and pilot testing must use a preview URL. Infrastructure decision, deliberately deferred. |
| **The 800 ms debounce window** | `savePropertyData` debounces 800 ms and there is no `beforeunload`/`pagehide`/`sendBeacon` anywhere. A tab closed inside that window loses the save. Documented by P0.5, not closed. |
| **Storage-first upload atomicity** | `api/upload.js` puts the file in Storage before the row exists, so a failure leaves an orphan. `docs/BACKLOG_ATTACHMENT_STORAGE.md` covers the adjacent space-attachment case. |
| **Historical activity backfill** | No backfill of pre-P0.5 history. See the watermark rule in P0.5; any backfill is separate work and would use the original timestamp with `actor_uid` NULL. |
| **D-2 `_TN is not defined`** | Pre-existing tracked harness failure. Not a product defect. |
| **`tenant_field_evidence` privilege hardening** | Not reached by P0.3's authorised scope. |
| **Six orphan organisations** | Historical residue from CI runs before `131c309`. Deliberately not deleted — a broad cleanup such as "delete all organisations with no members" was explicitly rejected. |
| **The unexplained 14:03 no-write** | On the pre-P0.2 build at `www.mainstreet-review.com`, not reproducible against `c9789b1`, and therefore not evidence about the accepted code. P3 hardened the path on its own merits rather than claiming a cause. |
| **Two id-less entries dropped from the blob on load** | Explained mechanically by the P2 defect (cross-origin localStorage plus the tenant-count pick). Confirming it fired in that specific session would need the `[PIPELINE:4b] MERGE decision` console output, which was not captured. |

---

## 6. Known limitations and constraints

**The monolith has 3 lines of headroom.** 31,713 of 31,716. Any slice that
touches `script.js` should assume it must *lift* something out, not add to it.
This is the tightest the budget has been, and it is deliberate: the rule is meant
to bite.

**`test-e2e-data-persistence.js` hangs.** It does not complete; it is declared
**stale** in `test-support/coverage-manifest.js:171` ("Same landing-dialog
entry-point drift as `test-e2e-acquisition.js`") and is excluded from the
regression. Pre-existing, and unrelated to the P1/P2/P3 work — but it means the
data-persistence e2e ground is genuinely uncovered, not merely unrun. Eleven
suites sit in that stale list against a hard budget of 13.

**The build stamp identifies a deployment, not an asset.** See §4/P1.

**`properties` has no `updated_at` trigger.** Only
`properties_default_organization` (BEFORE INSERT) and `property_events_derive`.
`updated_at` is set at insert and never moves, so it is **not** evidence that a
row was or was not written. Use the blob contents, or the edge logs.

**Egress from the agent working environment is restricted.** `*.vercel.app` and
`*.supabase.co` are denied by policy, so no browser-driven testing is possible
from there: the P0.5 live validation had to be driven by hand, with the database
side verified through the Supabase MCP. Plan live verification accordingly.

**Testing cadence.** Targeted tests plus the relevant security/RLS suites per
slice; mutation testing with zero real survivors; the ~1-hour full regression at
the Phase 0 checkpoint only, never per slice.

---

## 7. Commit index

| Slice | Commit | Migrations |
|---|---|---|
| P0.0 monolith baseline | `2557bc6` | — |
| P0.1 organisations | `9117926` | 024 |
| P0.2 lifecycle | `1689eb1` | 023 |
| P0.3 remaining tables | `0625b4d` | 025, 026, 027, 028, 029 |
| P0.3 privilege hardening | `148837f` | 026b |
| P0.3 append-only fix | `e03560a` | 028b |
| B1 CI fixture teardown | `131c309` | — |
| P0.4 lease field registry | `8be004a` | — |
| P0.5 durable history | `c9789b1` | 030 |
| P1 deployment identity | `620276a` | — |
| P2 activity merge invariant | `4bf342e` | — |
| P3 save-failure visibility | `972461c` | — |
| Docs: this file | `6aaf5dc` | — |
| R1 lease-job reaper keeps property_id | see `git log` | — |

Branch: `claude/validation-runs-analysis-ji1zb3`. Nothing in this sequence has
been deployed to Production, and Production Supabase `zhsuhehgehbzkmzurzyf` has
never been read from or written to.
