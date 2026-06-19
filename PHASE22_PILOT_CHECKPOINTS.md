# Phase 22 — Lease Audit & Estoppel Intelligence
## Pilot Feedback Checkpoints

Status: **Planning only — no implementation.** This defines where in the
build process to pause and get real user (Christy / pilot) feedback before
continuing, mirroring the "stop and stabilize" discipline already applied
at the end of Phase 21.

---

## Checkpoint 1 — Before writing any engine code

**Validate with Christy:**
- Confirm the 8 compared fields (Tenant Name, Suite, Base Rent, Security
  Deposit, Lease Expiration, Renewal Options, Outstanding TI Allowances,
  Landlord Obligations) are the right field set — are there other fields
  estoppels commonly carry that lenders specifically check (e.g. "no
  defaults by either party," "lease is in full force and effect," option
  to purchase) that should be in scope for v1 rather than added later?
- Confirm the PASS/WARNING/HIGH RISK severity examples in the requirements
  doc match her mental model of risk — in particular, whether a dollar
  mismatch should ever be PASS (e.g. is a $1 rounding difference actually
  fine, or does she want zero-tolerance exact matching with no automatic
  "immaterial" bucketing)?
- Show her the proposed Estoppel Comparison view mock (§2 of
  `PHASE22_UI_MOCKS.md`) as a sketch/wireframe and confirm the side-by-side
  table is the right mental model, vs. e.g. a simple pass/fail checklist
  with no values shown.

**Go/no-go:** don't write `estoppel-intelligence.js`'s field config until
this is confirmed — the field list directly drives the data model.

## Checkpoint 2 — After the engine + unit tests, before UI wiring

**Validate with Christy (or internal reviewer) using real documents, not
fixtures:**
- Take 2-3 real lease + estoppel pairs (anonymized if needed) and run them
  through the engine manually (e.g. via a debug script, not the UI yet).
  Confirm the comparison results match what a human reviewer would flag.
- Specifically stress-test the `omitted_from_estoppel` vs. explicit-null
  distinction (data model §1) against a real estoppel that's silent on
  renewal options — confirm Claude's extraction reliably distinguishes
  "silent" from "explicitly says none" on real document phrasing, not just
  synthetic test fixtures. This is the highest-risk extraction-accuracy
  question in the whole phase.

**Go/no-go:** if real-document extraction can't reliably make that
distinction, the HIGH RISK vs. PASS classification for omitted fields will
be unreliable — worth knowing before building the UI on top of it.

## Checkpoint 3 — After UI wiring, before Acquisition Risk Summary work

**Validate with Christy:**
- Walk through the full upload → comparison view → Lease Audit Report
  PDF flow on one real tenant, live.
- Confirm the report is actually "lender/acquisition-ready" in her
  judgment — not just structurally complete, but something she'd be
  comfortable handing to an actual lender or acquirer without editing.
- Ask specifically whether she'd want this gated behind any approval step
  before being considered "final," or whether informational-only (per the
  open architectural question in `PHASE22_ARCHITECTURE.md` §6) is fine for
  pilot purposes.

**Go/no-go:** don't start the Acquisition Risk Summary aggregation work
until the core estoppel comparison is validated end-to-end — building the
summary on top of an unvalidated signal compounds risk.

## Checkpoint 4 — Before merging to main

**Validate (mirrors Phase 21's pilot/merge gate):**
- Run the equivalent of `PHASE21_DEMO_SCRIPT.md` for Phase 22: a written
  demo script covering upload lease, upload estoppel, review comparison,
  generate audit report, review acquisition risk summary.
- Confirm full regression suite (`test-regression.js`) still passes with
  the new test files wired in.
- Get a "yes, this is useful as-is" signal from Christy specifically — she
  was named as the reason this phase was prioritized, so her sign-off is
  the actual success criterion for this phase, not just test coverage.

## Checkpoint 5 — Before considering the Document Comparison Workspace
   "foundational" claim validated

- Defer this checkpoint until/unless a second comparison pair (Amendment
  vs. Original Lease, Mortgage vs. Amendment, or Insurance vs. Lender
  Requirement) is actually scheduled. At that point, confirm the generic
  `DocumentComparisonEngine` core needed zero or minimal changes to support
  the second use case — if it needed significant rework, that's a signal
  the v1 abstraction guessed wrong about what "generic" should mean, and
  should be corrected before a third use case locks it in further.

---

## General principle across all checkpoints

Per the standing instruction not to start additional Phase 21 features and
to treat pilot validation as the gating activity: the same discipline
applies here. Each checkpoint above is a deliberate pause, not a formality
— if Christy's feedback at any checkpoint contradicts an assumption in the
requirements/architecture/data-model docs, those docs should be revised
before continuing, not patched around in code.
