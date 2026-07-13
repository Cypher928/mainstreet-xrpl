# MainStreet — Production-Readiness Review

**Report only. No application code was changed to produce this document.**
Make Waves submission functionality, settlement, authentication, and
production logic are untouched.

**Method.** Eleven independent reviewers swept the codebase in parallel
(script.js in four regions, the pure engines, the AI-surface modules, the
reserve/packets/auth stack, the XRPL/API/CLI surface, index.html, cross-cutting
duplication, and test/config). Every high-severity finding below was then
**personally re-verified against source** before inclusion; false positives are
listed at the end with why they were dropped. Line numbers are as of the
`claude/review-main-street-yVU0j` branch at review time and may drift by a few
lines with edits.

**Headline.** The product's architecture is genuinely sound — deterministic AI,
evidence-first data, keys never on the server, a read-only settlement API, a
15-suite regression gate. It is **not yet production-hardened**: one systemic
XSS/escaping defect spans the whole UI, several user-facing flows are broken,
the RBAC layer is only half-wired, and the "tamper-evident" audit hash — a
feature the product sells — does not actually record what it claims. None of
these touch the money rail or the demo; all are fixable in a focused sprint.

---

## Severity summary

| Severity | Count | Meaning |
|---|---|---|
| **Critical** | 3 | Exploitable, or breaks a trust feature the product sells. Fix before any real customer data. |
| **High** | 14 | Broken user flow, security gap, or data-integrity risk. Fix before pilot. |
| **Medium** | 21 | Correctness/perf/debt that will bite under real use. |
| **Low** | 15 | Hygiene, naming, minor edge cases. |

Plus: ~370 `console.*` calls in `script.js`, ~15 verified dead functions/blocks,
and pervasive helper duplication (details in §Duplicate/Dead/Debt).

---

## CRITICAL (verified)

### C1 · Systemic XSS / handler-breakage — `esc()` does not escape single quotes
**`script.js:9706`** — `esc()` replaces `& < > "` only:
```js
.replace(/"/g, '&quot;');   // no  ' → &#39;
```
**Verified.** Dozens of templates interpolate document-/user-derived strings
into **single-quoted JS argument lists inside `onclick`** attributes. Confirmed
live sites: `script.js:11326` `onclick="submitDispute('${esc(rowId)}','${esc(tenantName)}',…)"`,
`8931`/`13205` `generateTenantStatement('${esc(r.name)}')`, `13786`
`openReportTenantDetail`, `16710`/`17348` `navigateToPropertyTenant`, plus the
AI-surface sinks (C2). Two concrete impacts:
1. **Guaranteed functional breakage** for legitimate data — a tenant named
   `O'Brien Deli` breaks *every one* of these handlers with a SyntaxError.
2. **Injection** — a tenant/vendor name from an uploaded lease (or a
   tenant-portal dispute field) like `x',fetch(...)//` executes arbitrary JS.

Threat model is real but not trivial (the attacker is a malicious document or a
tenant-portal submitter, not a random visitor) — but the apostrophe breakage is
certain and will surface on day one of real data. Compounded by id-building from
raw names (`script.js:14641` `` `ts-${tenantName}-${idx}` ``).
**Fix:** add `'` → `&#39;` to `esc()` **and** migrate these to
`data-*` attributes + delegated listeners. One-line escaper change removes the
injection surface immediately; the data-attribute migration is the durable fix.

### C2 · AI-surface `onclick` payloads are unescaped or half-escaped
**`ai-workspace.js:1098`** builds `onclick="${x.js}"` with the label escaped but
`x.js` raw; payloads interpolate stored data (`ai-workspace.js:709`
`window.open('${s.explorerLink}',…)`, `:253` drafting args).
**`command-center.js:69`** `_jsArg()` escapes `\` and `'` for the JS-string
layer but **not** `"` for the HTML-attribute layer it lands in
(`command-center.js:662` `onclick="${r.action.js}"`), and `p.id` is interpolated
with no escaping at all (`:78`). **Verified.** Same class as C1, in the newest
code. **Fix:** HTML-attribute-escape the whole `onclick` value, or (better) move
to `data-action` + a delegated listener.

### C3 · The dispute "tamper-detection" audit hash records nothing meaningful
**`script.js:11657`** hashes `resolution: d.resolution` inside `resolveDispute()`,
but **nothing in the codebase ever assigns `d.resolution`** (grep: zero
`d.resolution =`); the status lives on `d.status` (set at `11615`). **Verified.**
The SHA-256 "audit trail" therefore hashes `resolution: null` for every dispute
and is **identical for an accepted and a rejected dispute** — it cannot
distinguish outcomes, defeating the exact tamper-evidence the product markets.
Corroborated by the reserve reviewer: the hash is computed only at resolution,
stored in the same mutable client record, and has no verification path anywhere.
**Fix:** hash `resolution: d.status` (or set `d.resolution` before hashing),
hash at creation, and add a verify-on-render/export path. Since evidence and
provenance are the pitch, this is a credibility bug, not just a code bug.

---

## HIGH (verified)

### H1 · Server-side row injection bypasses RLS — `api/cam-reconciliations.js:122`
POST validates the caller owns `propertyId` but then inserts the caller-supplied
`rows` array **verbatim** with the service-role key, never forcing each row's
`property_id`/`year` to match. An authenticated user can write reconciliation
rows into another user's property. **Fix:** server-side overwrite
`row.property_id = propertyId; row.year = year` on every row before insert.

### H2 · Submitted-but-unconfirmed settlement invites a real-money double-send — `rlusd-integration.js:243`
`submitAndWait` can throw after the payment has actually validated on-ledger
(dropped socket / timeout); `scripts/send-settlement.js:116` prints failure and
the natural operator response is to re-run — sending RLUSD twice. No idempotency
check, and `signed.hash` isn't printed pre-submit. **Fix:** log `signed.hash`
before submit; on ambiguous failure, look up that hash before any retry.
*(Operational, not demo-blocking — but this is real money.)*

### H3 · `esc()` gap in the invoice/statement paths — `script.js` parts 2–4
Same root as C1, additional confirmed sinks in disputes, tenant statements,
report tenant details, and the settlement/nav chips. Grouped under C1 for the
fix; called out separately because it spans four independent code regions —
evidence the pattern is systemic, not local.

### H4 · Invoice "Dispute"/"Explain" buttons crash / false-alarm — `script.js:7751`, `7730`
`document.getElementById(`ichev-${i}`).innerHTML = …` with no null guard, but no
template renders an `ichev-` element. **Verified** (grep: `ichev-` only ever
read). `disputeCharge` throws before opening the dispute form (invoice-row
dispute flow dead); `explainCharge` throws into a catch that `alert()`s
"Explain error" after every *successful* explanation. **Fix:** null-guard.

### H5 · Pre-allocation confirmation modal is dead — `script.js:8245`
`showAllocationModal` filters on `t.tenantName`/`t.leasedSqft` (camelCase) but
records use snake_case (`tenant_name`/`leased_sqft`), so the filter is always
empty and the "confirm this looks right" modal never appears — it silently falls
through to `runAllocation()`. **Verified** against `getValidTenants()` at
`2960`. **Fix:** use the snake_case keys.

### H6 · Persisted CAM metric computed from a percentage — `script.js:8510`
`expectedCam = live.cap` (a 0–100 percent) is subtracted from a dollar
`actualCam` and saved to `cam_reconciliations.expected_cam` (`19215`). The stored
variance is meaningless. **Verified.** **Fix:** use the cap ceiling
(`capBaseAmount * (1 + cap/100)`) or store null.

### H7 · `saveFieldOverride` throws on an undeclared `user` — `script.js:6121`
`actor: user?.email` references a `user` that exists nowhere (optional chaining
doesn't save an undeclared identifier). **Verified** (every other site declares
`const user = window.AuthService…`). Throws after save but before UI refresh —
the field-override card sticks in edit mode. **Fix:** declare `user` locally.

### H8 · Draw-status mutation has no role check — `script.js:2631`
`updateDrawStatus` (approve/fund a lender draw) is a bare global called from
onclick strings with **no `AccessControl` gate** and a hardcoded `actor: 'User'`.
**Verified.** Tenant-role hiding is CSS-only; the function stays callable.
Same for `generateDrawPackageReport`, `openDrawEmailModal`. *(RLS on the server
is the real boundary, so this is defense-in-depth, but a landlord-only mutation
should not be reachable in tenant role.)* **Fix:** gate on an AccessControl
helper and pass the authenticated user as actor.

### H9 · Unknown role fails open to landlord — `auth-service.js:60`
`return VALID_ROLES.has(raw) ? raw : 'landlord';` — a user with missing/typo'd
role (the file notes role is client-writable) renders the full landlord UI.
**Verified.** **Fix:** default to least privilege (`'tenant'`).

### H10 · dev-switcher activates on `*.vercel.app` with `?devRole=1` — `dev-switcher.js:21`
Its own header promises "localhost only," but the gate also enables any
`*.vercel.app` host carrying `?devRole=1` (and `_host === ''` allows `file://`).
**Verified.** If the preview/demo is served from `*.vercel.app`, a visitor can
open the role-switcher. **Fix:** drop the vercel.app branch or require a
non-production build flag; align the comment. *(Note: `dev-switcher.js` and
`lease-test-lab.js` both ship in `index.html` to production users — see M-set.)*

### H11 · "Lender-ready" gate ignores deadlines and zero-dollar draws — `escrow-reserve-engine.js:349`
`validateDrawRequest`/`computeEscrowReadiness` never compare the extracted
`drawRequestDeadline`/`reserveExpirationDate` to today, and a `$0`/negative
`amountRequested` passes every check (`:373`). **Verified** (the only expiry
check lives in `computeReserveHealth`, which is dead — see D-set). An expired
reserve or empty draw still shows "✅ lender-ready." **Fix:** add deadline and
`amount > 0` checklist items.

### H12 · Equal-count background load clobbers fresh invoices/disputes — `script.js:18259`
`selectProperty`'s richness guard is `loadedCount >= inMemCount` on **tenant**
count only; with equal counts a stale DB/LS record overwrites in-memory
`invoices`/`disputes`, and the next save persists the regression. **Verified.**
**Fix:** require strictly-richer data, or compare invoices/disputes
independently.

### H13 · "View in Lease" buttons always broken + injectable — `script.js:19064`
`onclick="openLeaseModal(${JSON.stringify(fileUrl)})"` emits `"..."` into a
double-quoted attribute, terminating it early (every click throws) and allowing
attribute injection when the upload path embeds the raw filename. **Verified**
(same at `19483`; `safeUrl` at `19373` escapes `\` and `'` but not `"`).
**Fix:** `esc(JSON.stringify(url))` or a dataset handler.

### H14 · Offline fallback is unreachable — `_lsLoadAll` never called — `script.js:18586`
The init catch path logs "loading from localStorage" but renders an empty
portfolio; `_lsLoadAll()` has **zero callers** (verified). Offline users with
local data see "Add your first property." **Fix:** hydrate `_props` from
`_lsLoadAll()` in the init catch path.

### H15 · `followup_why` hijacks the product's own demo question — `ai-workspace.js:301`
`/^(why|how)\b[\s\S]{0,25}\??$/` matches short why/how questions once any prior
answer exists — including `guided-tour.js:56`'s scripted `"Why does {tenant} owe
money?"` for short tenant names — returning a meta reasoning-trace instead of the
charge explanation. **Verified** (borderline on length; fires for short names).
**Fix:** anchor to bare `/^(why|how)\??$/` plus a few explicit forms.

---

## MEDIUM (representative — 21 total across reports)

**Correctness / data**
- `selectors.js:98,344` — `buildPropMeta`/portfolio KPIs call `.filter(d => d.status===…)` on disputes **without** a null guard used everywhere else; one null entry crashes the dashboard + Command Center. *(Verify-and-fix cheap; high blast radius.)*
- `script.js:18546` — `_stripBlobs` drops invoice `id`; disputes reference `invoiceId`, so a save/load round-trip can silently re-point dispute→invoice links.
- `script.js:11275` vs `14232` — dispute `invoiceId` stored as filtered-list index, resolved against the unfiltered array → packet cites the wrong invoice for tenants with excluded categories.
- `script.js:18236` — legacy reconciliation snapshots without `propId` are nulled by `selectProperty` even though `renderProperty` (`20159`) accepts them → pre-`propId` CAM results never restore.
- `ai-workspace.js:540` — `compare_costs` regex captures the stopword ("the") instead of the category.
- `ai-workspace.js:736` / multiple engines — YoY math divides by an unguarded prior-year total (`Infinity%`); UTC-vs-local date parsing disagreements across features (`acquisition-engine.js:556` vs `730`; `script.js:12012` day-gap math; `toISODate` timezone shift at `script.js:1082`).
- `escrow-reserve-engine.js:250` — merging two distinct `'other'`-type reserves collapses them and drops the second's balance; `:76` `_pd` stores `"December 3"` for `"December 31, 2027"`.

**Debug / noise (maintainability + minor perf)**
- **~370 `console.*` in `script.js`**, many logging business data and PII: `submitDispute` logs `email`/`role` (`11343+`); capture-phase click/mousedown probes run `getComputedStyle` on every interaction (`10436`, `10480`); `[PIPELINE:*]` groups dump invoices/disputes on every save/open (`19593`, `19989`, `20127`); `matchInvoiceToTenant` logs per candidate per invoice. Pure engines are clean (0 console). **Gate all behind a debug flag.**

**Async / races**
- `evidence-viewer.js:256` — stale-render guard covers only the first `await`; rapid Next/Prev interleaves renders → wrong page/highlights.
- `script.js:4304`/`4180` — lease pipeline writes results by a stale captured array index while `tenantData` is mutated concurrently (documented hazard, unprotected write).

**Performance (measured concerns)**
- `command-center.js:521` / `selectors.js:234` — `derivePropertyReadiness` re-invokes `buildPropMeta` **and** `getReviewQueueItems` per property, recomputed 3–4× per paint; only `sortProperties` memoizes.
- `script.js:7352`, `6872`, `18071`, `17413` — full innerHTML rebuilds inside per-file loops and on every search keystroke; O(n²) duplicate-scan per invoice render.
- `acquisition-engine.js:320` — invoice→tenant matcher runs twice per report; `computePortfolioActions` ignores its `preRar` param and recomputes revenue-at-risk portfolio-wide.

**Serverless / API**
- `api/claude.js:25` (copied ×8) — in-memory rate limiter is per-cold-start; ineffective across concurrent Vercel instances and never pruned.
- `api/cam-reconciliations.js:100` — non-atomic DELETE-then-INSERT loses the year's data if the insert fails.
- `rlusd-integration.js:21` — single hardcoded WSS endpoint on the fund path (verify tooling already has multi-endpoint fallback to copy).
- `api/upload.js:151` — lease PDFs returned as public storage URLs (low-confidence; depends on bucket config).

**XSS-adjacent / display**
- `lease-review-packets.js:566` — `t.cap + '%'` etc. interpolated unescaped (numeric-ish AI fields); `script.js:6043` lease `val` into innerHTML unescaped; `script.js:6067` curly-quote attribute delimiters break markup and defeat escaping.

---

## LOW (representative — 15 total)

- Naming: `totalSqFt` vs `totalSqft` (Property class vs everywhere; forces `|| ` fallbacks at `12376`, `13525`, `18663`, `20336`); `vendor` vs `vendorName`; dispute `denied` key labelled `Rejected`; tenant join by `name` (`review-engine.js:126`) vs `id` (`reconciliation-engine.js:58`).
- `normalizeCap` (`script.js:1620`) scales a genuine 0.5% cap to 50%.
- Stale `extractionModel: 'claude-3-5-sonnet-20241022'` persisted (`2871`, `4219`) while the app calls a newer model — degrades the audit trail.
- Dynamically created file inputs never removed on picker-cancel (`1928`, `1947`, `2473`) — unbounded DOM growth.
- `retryExtractionWithFile` queries a nonexistent `.bulk-t-meta` class (`7119`); `ccOpenReserves` uses a bare 400ms timeout where siblings poll (`17508`); `applyDrawStatus` re-applies same-status on terminal draws (`escrow-reserve-engine.js:436`).
- Bare `throw` in async onclick handlers (`importGLToInvoices` `3748`, `confirmYardiImport` `8073`) → unhandled rejection, rows shown but not saved, no user feedback.

---

## Duplicate code, dead code, architectural debt

### Dead / unreachable (verified)
| Item | Location | Note |
|---|---|---|
| `allocation-engine.js` (whole file) | not in `index.html` | **Not loaded by the app** — only `test-allocation.js`. See false-positives §. |
| `escrow-reconciliation.js` (whole file) | not in `index.html` | Not loaded/used by app. |
| `xrpl-integration.js` (whole file) | zero callers | Dead predecessor of `rlusd-integration.js`. |
| Duplicate onboarding block | `script.js:9356–9427` | `_obKey/_obSyncState/_obUpdateHints` redefined at `9433+`; first set shadowed; `_obMarkStep` never runs → onboarding steps never persist. **Verified.** |
| `_lsLoadAll` | `script.js:18586` | Zero callers (H14). |
| `syncTenantsToTable`, `sanitizeImportedPropertyData` | `18908`, `18663` | Zero production callers. |
| 7 extraction-fallback fns | `parseJSON`/`applyRawTextFallback`/`splitTextByTenant`/`enrichLeaseData`/`validateTotalSqFt`/`renderFailedTenants`/`mergeTenantsDedup` | ~250 lines, superseded. |
| `verifiableActions`, `tsExplainCharge`, `renderItems` (local), duplicate `sha256` block | `7588`, `11230`, `13391`, `13805` | Dead/duplicate. |
| `EscrowEngine.computeReserveHealth`/`projectReserveRunway` | `escrow-reserve-engine.js:851` | Exported, zero callers — the overcommit/expiry logic never runs. |
| 6/10 `AccessControl` exports, `EvidenceViewer.fromTenantField`, `AIWorkspace.registerIntent`, several explainer exports | various | Exported, called only by tests/qa. |

### Duplication (verified)
- **HTML-escape helper**: `esc` (script.js) + `_esc` byte-identical in `command-center.js:26`, `ai-workspace.js:32`, `document-drafting.js:19`, `evidence-viewer.js:32`. Five copies — and the C1 bug lives in all of them.
- **Currency formatter**: `_fmt$` in command-center/ai-workspace/guided-tour (whole dollars) vs `document-drafting.js:20` (2 decimals) — **a drafted letter says `$1,234.56` while the answer that spawned it says `$1,235`.** Plus `fmtUSD` copies in reconciliation-engine/explainer/review-engine and `_fmt` in both packet builders.
- **`_verifyUser` + rate-limit + `sbFetch`**: copy-pasted byte-identical across **8** `api/*.js` files, already drifting (rate caps 10/15/20/60).
- **`promptSecret`/`getSeed`**: reimplemented in 4 `scripts/*.js`.
- **`p.camReconciliation ?? p.results`** recon-snapshot shim and the NNN-missing-cap predicate each reimplemented in 3–5 places instead of consuming `selectors`.
- **Snapshot-session-to-property blob** built 3× with drift (`script.js:18293`, `19710`, `18362`); acquisition verdict formula 2×.

### Architectural debt (the expensive-later list)
1. **The 21.7k-line `script.js` monolith.** The pure modules are clean and tested; the glue is not. Every persisted field must be threaded through the manual **four-hop** save→load→merge→apply chain by hand — H12/H14 and the M-set persistence bugs all live in that seam. This is the single biggest maintainability tax.
2. **`esc()`/inline-onclick pattern** (C1/C2) is architectural, not local — the app builds behaviour by string-concatenating handlers with data. The durable fix is a rendering convention (data-attributes + delegated listeners), not 40 spot-escapes.
3. **RBAC is aspirational** — the `access-control.js` matrix is mostly unwired (H8, dead exports); UI role-hiding is CSS-deep while the functions stay globally callable. RLS is the real boundary, which is correct, but the client layer advertises gating it doesn't enforce.
4. **Audit/provenance is cosmetic in places** (C3) — the feature the product sells hardest needs the most rigor.
5. **Naming drift** (`totalSqFt`/`vendor`/date conventions) forces compensating fallback code at every read site and is a steady source of silent zeros.

---

## Over-engineered / unnecessarily complex

- **Duplicated dev/test fixtures shipped to production** — `lease-test-lab.js` and `dev-switcher.js` are `<script>`-loaded in `index.html` for real users. Dead weight at best (lease-test-lab), a security surface at worst (dev-switcher, H10). Gate them out of the production bundle.
- **Two full unused engine modules** (`allocation-engine.js`, `escrow-reconciliation.js`) that *diverge* from the real implementations in `script.js` — worse than dead, they invite "fix the wrong file." The Node test harness even validates the diverged `allocation-engine.js`, so its tests pass while testing code the app never runs.
- **Three-way import UX** (GL Excel / invoice upload / Yardi CSV) for one job; the redundant `checkSqftValidation` vs `runCamValidation` and `toBase64` vs `fileToBase64` pairs are the same tax at function scale.
- **370 console statements** are effectively a second, ad-hoc logging framework left switched on.

---

## Cleanest long-term architecture (recommended, not urgent)

You do **not** need a framework rewrite. The bones are right. In dependency order:

1. **One shared util module** (`ms-util.js`): the *single* `esc` (quote-safe), `fmt$`, `num`, `recon`, date-parse. Delete the 5+ copies. This alone closes C1/C2 at the source and the `$1,235` vs `$1,234.56` drift.
2. **A rendering convention**: replace string-built `onclick` with `data-action`/`data-id` + a few delegated listeners. Removes the entire injection class structurally.
3. **A declarative persisted-field registry** that the save/load/merge/apply hops all read from — kills the four-hop-by-hand class of bug (H12/H14, invoice-id drop, legacy-`propId` nulling) and the 3× snapshot duplication.
4. **`api/_lib.js`** for the 8-times-copied auth/rate/fetch helpers (underscore-prefixed files aren't routed by Vercel).
5. **Continue extracting `script.js`** module by module — persistence pipeline and the six report generators are the next natural cuts — and **add CI** (the regression gate is run by discipline today; a GitHub Action is the cheapest reliability win available, see ROI #2).
6. Delete the two unused engine modules and `xrpl-integration.js`; if their tests are worth keeping, point them at the real `script.js` logic.

---

## Prioritized fix buckets

### Fix BEFORE a pilot (real customer data on the system)
- **C1 / C2 / H3 / H13** — quote-safe `esc()` + de-string the onclick handlers (XSS + apostrophe breakage across the whole UI).
- **C3** — make the dispute audit hash record the actual resolution (trust feature).
- **H1** — server-side row ownership in `api/cam-reconciliations.js` (cross-tenant write).
- **H4 / H5 / H7** — three broken/again-broken user flows (invoice dispute, allocation confirm, field-override save).
- **H6 / H12** — persisted `expected_cam` from a percentage; equal-count persistence clobber (data integrity).
- **H8 / H9 / H10** — role gate on draw mutations; least-privilege default; dev-switcher production exposure.
- **M-set quick wins**: `selectors.js` null-dispute guard (dashboard crash), strip/gate the ~370 `console.*` (incl. the PII log in `submitDispute`), and remove `lease-test-lab.js`/`dev-switcher.js` from `index.html`.

### Can WAIT until after a pilot
- **H2** — settlement idempotency (operator process fix; matters when settlement volume grows).
- **H11** — draw deadline/zero-amount checks in the readiness gate.
- **H14** — offline `_lsLoadAll` hydration.
- **H15** + `compare_costs` — AI intent-matching refinements.
- Most MEDIUM correctness items (invoice-id round-trip, legacy-`propId` restore, date-parse unification, evidence-viewer race).
- Dead-code deletion (~250+ lines) and the duplicate onboarding block.

### Enterprise-scale improvements
- CI gate on the regression suite; **wire the 22 non-gated test files** (15 of 37 are in `test-regression.js`) or consciously retire them.
- Real RBAC (wire `access-control.js`; server-enforced, not CSS-deep).
- Shared serverless rate-limiter (Redis/KV); private buckets + signed URLs for lease documents; scrub logs of PII/content.
- Multi-endpoint XRPL fallback on the settlement path; settlement idempotency by memo-hash lookup.
- Persisted-field registry; break up `script.js`; TypeScript for the engines.
- Performance: memoize `derivePropertyReadiness`/`buildPropMeta`; incremental (non-wholesale) portfolio re-render; single-pass acquisition matcher.

### Nice-to-have refactors
- `ms-util.js` shared helpers; `api/_lib.js`; `scripts/_secret-prompt.js`.
- Naming normalization (`totalSqft`, `vendorName`, one date helper) at the persistence boundary.
- Delete the two unused engine modules + `xrpl-integration.js`.
- Collapse the three-way import UX and the duplicate validators/base64 helpers.

---

## False positives removed after verification

Reviewers surfaced these as high/critical; **verification downgraded or dropped them**:

1. **`allocation-engine.js:24` hardcoded `BASE_AMOUNT = 10000` cap** — flagged *critical money-math*. **Verified NOT loaded** by `index.html` or any production file (only `test-allocation.js`). The app uses `script.js:8554`'s correct `capBaseAmount` logic. Real issue is *dead diverged code + a test validating it*, not a live money bug. **Downgraded to dead-code.**
2. **`escrow-reconciliation.js:120` EscrowCancel without CancelAfter** — flagged *critical logic*. **Verified NOT loaded/used** by the app. Downgraded to dead-code.
3. **"Seed/wallet files tracked in git"** — my own grep matched `scripts/generate-settlement-wallet.js` and `scripts/wallet-address.js`. **Verified**: these are prompt-based *source scripts*, not secrets; no `.env`, `.seed`, or key material is tracked. **Dropped** (no seed/env file is in the repo).
4. **index.html step-bar "dead markup"** — the reviewer self-corrected: the step bar is dynamically driven. **Dropped.**

Note on threat model for C1/C2: the injection vector is a malicious document or a tenant-portal submitter, not an anonymous visitor — so "critical" reflects the *breadth* (whole UI) and the *certain* apostrophe-breakage on legitimate data, not a trivial drive-by. Rank accordingly for your context.

---

## Top 10 Improvements by ROI

Ranked by (reliability + maintainability + customer-experience gain) ÷ effort.
These are practical wins, not theoretical perfection.

| # | Change | Effort | Payoff |
|---|---|---|---|
| **1** | **Add `'`→`&#39;` to `esc()`** (`script.js:9706` + the 4 `_esc` copies, ideally via one shared util). | ~1 hour | Instantly removes the injection surface **and** fixes the certain breakage on every apostrophe tenant name across the whole UI (C1/C2/H3). Highest payoff-per-line in the codebase. |
| **2** | **CI: run `npm run test:regression` on every push** (GitHub Action). | ~1 hour | Converts a 15-suite gate that's honored by discipline into one that's enforced. Cheapest durable reliability win; also your own review's #1 tech-debt item. |
| **3** | **Strip/gate the ~370 `console.*`** behind a `DEBUG` flag (start with the PII log in `submitDispute`). | ~2 hours | Stops leaking tenant email/role and business data to the console, removes per-interaction `getComputedStyle` recalcs, and de-noises production. |
| **4** | **Fix the dispute audit hash** to record `d.status` (C3). | ~1 hour | Restores the tamper-evidence feature the product *sells* — a credibility fix, not just a code fix. |
| **5** | **Server-side row ownership** in `api/cam-reconciliations.js` (H1). | ~1 hour | Closes a genuine cross-tenant write hole before any real customer data lands. |
| **6** | **Add the `selectors.js` null-dispute guard** (`d &&`) at `:98`/`:344`. | ~15 min | One null dispute entry currently crashes the whole dashboard + Command Center; trivial fix, catastrophic-failure prevention. |
| **7** | **Remove `lease-test-lab.js` and `dev-switcher.js` from `index.html`** and fix the dev-switcher gate (H10). | ~1 hour | Stops shipping dev tooling — and a role-switcher — to production users. |
| **8** | **Fix the three broken flows** — invoice Dispute/Explain (H4), allocation-confirm modal (H5), field-override save (H7). | ~2–3 hours | Restores three user-visible features that are silently dead today; each is a one-symbol/one-line fix with outsized UX impact. |
| **9** | **Delete verified dead code** — the two unused engine modules, `xrpl-integration.js`, the duplicate onboarding block, `_lsLoadAll`-adjacent dead paths, ~250 lines of fallback fns. | ~2 hours | Removes ~600+ lines and, crucially, eliminates *diverged* modules that invite fixing the wrong file. Pure maintainability. |
| **10** | **Guard the persistence clobber** (H12: strict `>` / independent invoice+dispute richness). | ~2 hours | Prevents silent loss of freshly-imported invoices and disputes — the exact class of "works in session, gone on refresh" bug the four-hop invariant exists to prevent. |

**If you do only the top 5** (≈6 hours total): you close the systemic XSS, enforce the test gate, stop the PII leak, restore the audit-trail feature, and seal the cross-tenant write hole — the entire critical tier and the worst of the high tier, for less than a day of work.

---

*Report generated by a parallel multi-agent review with per-finding source
verification. Findings cite `file:line`; high-severity items were individually
re-checked against source and false positives were removed and documented above.
No application code was modified.*
