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
  // XRPL/RLUSD settlement configuration. Offline only: it asserts the issuer,
  // currency code, Make Waves source tag and memo payload, and SKIPS (does not
  // fail) the live ledger reads when the network is unreachable — so it is safe
  // in CI and in sandboxes with no egress. It was absent from this list, which
  // is why a missing `xrpl` dependency went unnoticed.
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
