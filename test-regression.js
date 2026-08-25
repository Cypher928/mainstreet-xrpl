'use strict';
/**
 * test-regression.js — Orchestrates all regression test suites.
 *
 * Runs each suite as a child process so failures in one don't abort others.
 * Exit code 0 = all suites passed. Non-zero = at least one failure.
 *
 * Run: node test-regression.js
 *      npm run test:regression
 */

const { execSync } = require('child_process');

const SUITES = [
  { label: 'Allocation engine',       cmd: 'node test-allocation.js' },
  { label: 'Tenant dispute pipeline', cmd: 'node test-disputes.js' },
  { label: 'Extraction quality',      cmd: 'node test-extraction.js' },
  { label: 'Invoice dashboard counts',cmd: 'node test-invoices.js'   },
  { label: 'Derived metrics layer',   cmd: 'node test-metrics.js'    },
  { label: 'Property activity timeline', cmd: 'node test-timeline.js' },
  { label: 'Lease intelligence benchmark', cmd: 'node test-benchmark.js' },
  { label: 'Lease review packets',         cmd: 'node test-packets.js'   },
  { label: 'Lease test lab',               cmd: 'node test-testlab.js'   },
  { label: 'Normalized read migration',    cmd: 'node test-normalized-reads.js' },
  { label: 'CAM reconciliation persistence', cmd: 'node test-cam-persistence.js' },
  { label: 'Lease document persistence',     cmd: 'node test-lease-persistence.js' },
  { label: 'Ask the Lease API',              cmd: 'node test-ask-lease.js' },
  { label: 'Lease Validation (Phase 23)',    cmd: 'node test-validate-lease.js' },
  { label: 'Escrow & Reserve engine (Phase 21)', cmd: 'node test-reserve-engine.js' },
  // Lease readiness. "Ready for CAM" is a claim about what the reconciliation
  // engine will accept, and this screen has now been wrong in both directions —
  // once counting a lease with no square footage as ready, then once telling
  // the reader two leases could not be reconciled on the run that reconciled
  // them. Nothing covered it either time, which is why both shipped.
  { label: 'Lease CAM readiness',               cmd: 'node test-lease-readiness.js' },
  // Test 3, replayed end to end in a real browser: real sign-in, real
  // runAllocation, real report renderers, real billing gate, real statement.
  // Every defect Test 3 found was a rendering defect that the unit suites were
  // green through, so this one asserts against what is on screen. It is the
  // only registered suite that drives a browser; with no browser available it
  // fails loudly rather than passing, and SKIP_BROWSER_TESTS=1 is the explicit
  // opt-out.
  { label: 'Test 3 workflow replay (e2e)',      cmd: 'node test-e2e-test3.js' },
  // The happy path. Every other e2e suite drives a property with problems,
  // which is where the defects were — and left the most common real case
  // untested. A system tuned only on failure cases cries wolf, so this one is
  // mostly negative assertions: no exceptions, no coverage gap, no manufactured
  // "needs review" on a lease that scores 100, and a statement that issues.
  { label: 'Clean property, happy path (e2e)',  cmd: 'node test-e2e-clean-property.js' },
  // The lease review flow: Needs Review must lead somewhere. A "Mark reviewed"
  // button turned the card green while the CAM blocker stood, and a confirmed
  // property mismatch could never clear Needs Review at all because the status
  // derivation read the raw detector. Both are pinned here, on the real path a
  // person takes rather than on the functions underneath it.
  { label: 'Lease review flow (e2e)',           cmd: 'node test-e2e-lease-review-flow.js' },
  // Where the pool-vs-billed difference went. The banner could state a $63,690.70
  // gap and then close with "Re-check invoice amounts" — advice that was wrong,
  // on a run where every amount was right — and clicking it did nothing. The
  // unit half pins the identity that keeps the panel from inventing arithmetic:
  // every dollar of the gap lands in a named bucket or in a visible residual.
  // ONE interpretation of every number read off a document. Four predicates for
  // "does this lease have square footage?" let a lease with a formatted area
  // vanish from CAM with its card reading "verified"; two parsers for "what is
  // this invoice worth?" let $1,250 be allocated out of a pool that counted it
  // as $0. The load-bearing assertion is the INVARIANT — for every value in a
  // corpus of real extraction output, the eligibility gate and every warning
  // surface must reach the same conclusion.
  { label: 'Source values (sqft + money)',      cmd: 'node test-source-values.js' },
  // Per-tenant billing readiness. billingReadiness branched on property-wide
  // red counts and every tenant statement asked it, so one anchor holding over
  // on a month-to-month made four clean inline tenants unbillable. The model
  // this pins: severity says how alarming a finding is, the Tenant: marker says
  // who it is about, and blocksBilling says whether billing may proceed — three
  // questions that were being answered by one field.
  { label: 'Billing readiness (per tenant)',    cmd: 'node test-billing-readiness.js' },
  { label: 'Variance breakdown',                cmd: 'node test-variance-breakdown.js' },
  // The same thing on screen, plus the blocked statement's Scope column, which
  // printed an em dash against property-level exceptions and matched a tenant
  // whose name appeared as an invoice VENDOR.
  { label: 'Variance flow + exception scope (e2e)', cmd: 'node test-e2e-variance-flow.js' },
  // XRPL/RLUSD settlement configuration. Offline only: it asserts the issuer,
  // currency code, Make Waves source tag and memo payload, and SKIPS (does not
  // fail) the live ledger reads when the network is unreachable — so it is safe
  // in CI and in sandboxes with no egress. It was absent from this list, which
  // is why a missing `xrpl` dependency went unnoticed.
  // The Riverside Commons walkthrough, asserted on RENDERED statements: an
  // anchor holding over, a Gross lease taking shared CAM, three clean tenants
  // that must bill anyway, and a property headline that survives all of it.
  { label: 'Riverside billing readiness (e2e)', cmd: 'node test-e2e-billing-readiness.js' },
  { label: 'XRPL RLUSD settlement config',      cmd: 'node test-rlusd.js' },
];

let anyFailed = false;

console.log('═'.repeat(56));
console.log('  Mainstreet Regression Suite');
console.log('═'.repeat(56));

for (const { label, cmd } of SUITES) {
  console.log(`\n▶  ${label}`);
  console.log('─'.repeat(56));
  try {
    execSync(cmd, { stdio: 'inherit' });
    console.log(`\x1b[32m   ✓ ${label} — passed\x1b[0m`);
  } catch (_) {
    console.error(`\x1b[31m   ✗ ${label} — FAILED\x1b[0m`);
    anyFailed = true;
  }
}

console.log('\n' + '═'.repeat(56));
if (anyFailed) {
  console.error('\x1b[31m  REGRESSION SUITE FAILED — see failures above\x1b[0m');
  console.log('═'.repeat(56));
  process.exit(1);
} else {
  console.log('\x1b[32m  ALL SUITES PASSED\x1b[0m');
  console.log('═'.repeat(56));
}
