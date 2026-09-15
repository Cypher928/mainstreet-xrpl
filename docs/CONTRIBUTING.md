# Contributing to MainStreet

The philosophy first, then the mechanics. MainStreet's codebase has held a
15-suite regression gate green through seven consecutive feature phases — the
rules below are how.

See also [ARCHITECTURE_PRINCIPLES.md](./ARCHITECTURE_PRINCIPLES.md) — the
system-level invariants a new feature can break without anyone noticing. This
document is how to write code here; that one is what the system must not stop
doing.

---

## 1. Coding philosophy

1. **Deterministic over generative.** If an answer must be correct, it is
   computed by inspectable code. LLMs run in exactly one place (document
   extraction) and their output is human-verified before it drives money math.
   Never put a model in an answer path.
2. **Evidence-first.** Every extracted fact carries a verbatim quote, page,
   and confidence, and stays attached through answers, drafts, and the
   Evidence Viewer. A claim without evidence renders as a claim without
   evidence — don't fake certainty.
3. **Null over fabrication.** Insufficient data → return `null` / say "I don't
   have that" / refuse the highlight. A half-fabricated output is a bug even
   if it looks polished.
4. **Reuse before rewriting.** Inspect what exists before building. The
   Reserve module was built on a hidden existing escrow module; the Workspace
   consumes the same engines as the reports. Re-deriving a number that an
   engine already computes is how two sources of truth are born.
5. **Measure before optimizing.** The 500-property audit found every compute
   path at 4–53 ms; the bottleneck was DOM size. Benchmark, then fix the
   actual limit.
6. **Honesty in claims.** Test summaries, commit messages, and docs state what
   was actually run and verified. "All suites passed" means you ran them.

## 2. Architecture principles

- **Pure modules, thin glue.** New capability = a window-IIFE module with
  injected `deps`, no DOM access at load time, no globals. `script.js` gets
  only the view glue (element wiring, event handlers). This is what keeps
  modules testable in the Node `vm` harness.
- **One source of derived truth.** Display metadata comes from
  `selectors.js`; money math from the engines. UI code never re-computes.
- **Standard shapes travel.** Recommendations
  (`{id, priority, title, reason, impact, confidence, evidence, connections,
  action}`), answers (`{heading, bullets, citations, confidence, trace,
  resultSet}`), citations (`{source, detail, page, quote, fileUrl}`).
  New features emit these shapes; downstream surfaces (Command Center,
  Workspace, Drafting, Evidence Viewer) then work without changes.
- **Honest degradation.** Every feature defines what happens when data is
  missing, files are unfetchable, or confidence is low — and says so in the
  UI.

## 3. The persistence contract

A new persisted field must be carried through **all four hops** (details:
`DATABASE_REFERENCE.md` §4):

1. `saveProperty` whitelist → 2. `loadPropertyData` field map →
3. LS-merge authority → 4. `selectProperty` apply.

Then write a round-trip test. Blob by default; normalize only for
cross-property queries, immutability, or async coordination. New tables always
ship with RLS policies.

## 4. Frozen zones

Do **not** modify on feature branches without explicit agreement:

- Settlement: `rlusd-integration.js`, `api/rlusd-settlement.js`,
  `scripts/send-settlement.js` and sibling scripts, settlement persistence
  hops.
- Authentication & access control: `auth-service.js`, `access-control.js`.
- The `api/` serverless surface (extraction proxy, read-only settlement
  status).
- `main` is protected — never push to it without explicit permission; work on
  feature branches.

Seeds and secrets: wallet seeds never appear in the repo, env files, CLI
arguments, logs, or chat — hidden interactive prompts only.

## 5. Testing expectations

- Every engine change extends its suite; every new module gets one, wired into
  `SUITES` in `test-regression.js`.
- `npm run test:regression` before every commit — the whole gate, not just
  your suite (three UIs read the same derived state).
- When a test fails, verify the fixture before "fixing" code — a red test can
  be a wrong assertion.
- Full guide: `TESTING_GUIDE.md`.

## 6. Documentation expectations

- New module → a `MODULE_REFERENCE.md` entry (purpose, API, UI, extension
  points).
- New persisted object → `DATABASE_REFERENCE.md`.
- New limitation → `KNOWN_LIMITATIONS.md` (honesty is a feature).
- Code comments state constraints the code can't show (like the whitelist
  comment on `settlement`) — not narration.

## 7. Adding a module — the golden path

```js
// my-engine.js
(function () {
  'use strict';
  function doThing(input, deps) { /* pure, deterministic */ }
  window.MyEngine = { doThing };
})();
```

1. Pure IIFE as above; deps injected by callers, not imported globals.
2. `<script src="my-engine.js">` in index.html (order: after its deps).
3. Glue in script.js: wire UI events → call the engine → render its output.
4. Emit the standard shapes (§2) so existing surfaces pick it up.
5. `test-my-engine.js` using the `vm` harness pattern; wire into `SUITES`.
6. Persisted state? Four hops + round-trip test (§3).
7. Docs (§6).

## 8. Extending the AI surfaces

- New question → `AIWorkspace.registerIntent({id, match, handle})` consuming
  existing engines. Full contract: `AI_ENGINE_REFERENCE.md` §2.
- New document type → one builder + `DOC_TYPES` entry in
  `document-drafting.js`. Deterministic, `[bracketed placeholders]` for human
  decisions, `null` on insufficient data.
- New recommendation → one builder in `command-center.js` emitting the
  standard rec shape.
- Anything generative (voice, paraphrase) wraps the deterministic core as
  middleware — never inside it.

## 9. Git & review

- Feature branches per phase; clear descriptive commits; never push `main`.
- Commit messages describe what changed and why; claims of passing tests mean
  the gate was run.
- Ship in stages: land the engine + tests, then the UI, then polish — each
  stage green.
