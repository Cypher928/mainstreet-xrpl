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
  { label: 'Allocation engine',    cmd: 'node test-allocation.js' },
  { label: 'Tenant dispute pipeline', cmd: 'node test-disputes.js' },
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
