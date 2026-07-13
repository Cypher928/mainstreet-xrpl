# MainStreet — Testing Guide

How the test suite works, how to add features without breaking money paths,
and the mistakes that have actually bitten this codebase.

---

## 1. The regression suite

```bash
npm run test:regression        # node test-regression.js — the gate
```

`test-regression.js` runs 15 wired suites and exits non-zero if any fails:

| Suite | File | Covers |
|---|---|---|
| Allocation engine | test-allocation.js | Pro-rata, caps, exclusions — **the money math** |
| Tenant dispute pipeline | test-disputes.js | Dispute lifecycle + recovered revenue |
| Extraction quality | test-extraction.js | Extraction field mapping + confidence |
| Invoice dashboard counts | test-invoices.js | Categorization, dedup, counts |
| Derived metrics layer | test-metrics.js | selectors.js — meta, KPIs, health, sorting |
| Property activity timeline | test-timeline.js | Timeline event derivation |
| Lease intelligence benchmark | test-benchmark.js | Multi-doc supersedence + confidence |
| Lease review packets | test-packets.js | Lender packet generation |
| Lease test lab | test-testlab.js | Dev fixture integrity |
| Normalized read migration | test-normalized-reads.js | Blob ↔ tenant_field_evidence parity |
| CAM reconciliation persistence | test-cam-persistence.js | Recon snapshot round-trip |
| Lease document persistence | test-lease-persistence.js | Document metadata round-trip |
| Ask the Lease API | test-ask-lease.js | Lease Q&A path |
| Lease Validation (Phase 23) | test-validate-lease.js | Validation rules |
| Escrow & Reserve engine | test-reserve-engine.js | 182 assertions: normalize, merge, balance, draw state machine, readiness, health, runway, narrative |

Other runnable suites (not in the regression gate): `test-acquisition.js`,
`test-rlusd.js` / `test-xrpl.js` / `test-xrpl-ui.js` (settlement),
`test-e2e-*.js` (flow-level), `test-prod-smoke.js`,
`test-supabase-integration.js` and `test-rls-cross-user.js` (need live
credentials), `test-escrow*.js`, plus scratch harnesses used during phases
(e.g. AI Workspace intent coverage).

## 2. How the harness works — no framework, no build

Pure modules are window-IIFEs, so tests load them into a Node `vm` context
with a stub `window`, then assert against the **real engine functions** — the
exact code the browser runs:

```js
const vm = require('vm');
const ctx = { window: {} };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync('escrow-reserve-engine.js', 'utf8'), ctx);
const Engine = ctx.window.EscrowReserveEngine;
// assert(...) against Engine directly — same input, same output, every run
```

No mocking of business logic, no transpilation, no test doubles for the
engines themselves. External boundaries (Supabase, XRPL, DOM) are the only
things stubbed. This works **because** modules take dependencies via injected
`deps` and never touch the DOM at load time — preserve that property in every
new module or it becomes untestable.

## 3. Adding a feature safely — the checklist

1. **Inspect before building.** The capability may already exist (the Reserve
   module was built on a hidden existing Mortgage Escrow module). Search
   first; reuse engines, never re-derive their numbers.
2. **New logic goes in a pure module** (window-IIFE, injected deps, no DOM at
   load) — not into script.js. script.js gets only the thin view glue.
3. **New persisted field? Update all four hops** — this is the invariant that
   has actually broken production behavior:
   - `saveProperty` whitelist (`data{}` in script.js)
   - `loadPropertyData` blob→property field map
   - LS-merge authority list (DB must win for critical fields)
   - `selectProperty` apply step
   Then write a round-trip test (pattern: `test-cam-persistence.js`).
4. **Wire a test suite** into `SUITES` in test-regression.js.
5. **Run the full regression suite** before commit — not just your suite.
   Selectors, Command Center, and Workspace all read the same derived state;
   a change in one engine surfaces in three UIs.

## 4. Protecting settlement (do not learn this the hard way again)

Settlement code is **frozen on feature branches**: `rlusd-integration.js`,
`api/rlusd-settlement.js`, `scripts/send-settlement.js` and siblings, and the
`property.settlement` persistence hops. Rules:

- Never remove `settlement` from the saveProperty whitelist — any save after
  that wipes the record and the UI regresses to "pending" (this happened; the
  fix required patching three hops plus a demo version bump).
- Never make the web API mutating; `status` is read-only by design.
- Never log, echo, or accept seeds as CLI args — hidden prompts only.
- Verify with `scripts/verify-settlement.js` (6-point on-ledger check) rather
  than trusting app state.
- Test money-display changes against `test-rlusd.js` / `test-xrpl-ui.js`.

## 5. Verification beyond unit tests

- **Round-trip tests** for persistence (save → simulated load → assert field
  survives and DB beats LS mirror).
- **On-ledger verification** for settlement (`verify-settlement.js`).
- **Scale benchmark** (`test-benchmark.js` + the 500-property benchmark
  method): measure before optimizing — Phase 27 proved every compute path ran
  in 4–53 ms at 500 properties; the real limits were DOM node counts, fixed by
  render caps, not by touching the engines.
- **RLS cross-user test** (`test-rls-cross-user.js`) for row isolation.

## 6. Common developer mistakes (all observed in this repo's history)

| Mistake | Consequence | Prevention |
|---|---|---|
| Persisting a field through 3 of the 4 hops | Works all session, vanishes on refresh or next save | §3 step 3 + round-trip test |
| Appending test code after `process.exit()` | Suite "passes" while new assertions never run | Keep exit at true end; check the printed assertion count went **up** |
| Asserting against a misread fixture (e.g. wrong tenant count) | Red test, correct code | When a test fails, verify the fixture before "fixing" code |
| Re-deriving engine numbers in UI/intents | Two sources of truth drift apart | Consume selectors/engines; never reimplement math |
| Unguarded saves from tenant portal | Empty session arrays wipe persisted invoices/results | Follow the existing `invoiceData.length > 0` / `lastResults.length` guard pattern |
| Optimizing without measuring | Rewrites of code that was never the bottleneck | Benchmark first (§5) |
| Editing demo seed without bumping `_demoV` | Existing users never receive the new seed | Bump the version marker with every seed change |
| DOM access at module load time | Module becomes un-loadable in the `vm` harness | Pure IIFE + injected deps, DOM only in script.js glue |
| Claiming a pass without running the gate | Broken suite discovered later | `npm run test:regression`, paste the summary line |

## 7. What is *not* automatically tested (be honest with yourself)

- Visual rendering and CSS (spot-check in browser; `test-e2e-phase25-visual.js`
  covers structure, not pixels).
- Live Claude extraction quality (fixtures approximate it; real documents
  vary).
- Live XRPL submission (dry-run is testable; `--live` is production).
- Supabase RLS end-to-end runs only with real credentials.
- Accessibility (focus traps and labels were hand-audited in Phase 27).

When your change touches one of these, say so in the commit/PR and describe
the manual verification you actually performed.
