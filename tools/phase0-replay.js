#!/usr/bin/env node
'use strict';
/**
 * phase0-replay.js — before/after for the three Phase 0 benchmark leases.
 *
 *   node tools/phase0-replay.js
 *
 * WHAT THIS REPLAYS, PRECISELY: the post-extraction layer — explainability,
 * the review gate, and confidence — using the extraction outputs that the real
 * pipeline actually produced on 2026-08-08, read verbatim from
 * properties.data.tenants[] in the pilot project (property
 * 881a2a92-84ae-4cb4-ba14-f05bdc5fd8f1). No values are invented.
 *
 * WHAT IT DOES NOT REPLAY: the model call. M1a, M5 and P1b all live downstream
 * of extraction, so re-running the model would not exercise them and would only
 * add nondeterminism. E1 is the finding that needs a live model call, and it has
 * its own probe (tools/e1-raw-response-probe.js) which is deliberately separate
 * because it is gated.
 *
 * "before" = lease-intelligence.js as of the frozen pilot (git show pilot:...).
 * "after"  = the working tree.
 */

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');
const { execFileSync } = require('child_process');

const REPO = path.join(__dirname, '..');

function loadLI(source) {
  const sandbox = { window: {}, console: { log(){}, warn(){}, error(){} } };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'lease-intelligence.js' });
  return sandbox.window.LeaseIntelligence;
}

const BEFORE = loadLI(execFileSync('git', ['show', 'pilot:lease-intelligence.js'], { cwd: REPO, encoding: 'utf8' }));
const AFTER  = loadLI(fs.readFileSync(path.join(REPO, 'lease-intelligence.js'), 'utf8'));

// Recorded extraction output, verbatim. Only the fields the replayed layer reads.
const TENANTS = [
  { file: 'Lease 1 CPI Corp 1706 Washington Ave.pdf',
    tenant_name: 'Consumer Programs Incorporated', leased_sqft: 300000,
    start_date: '2012-07-27', end_date: '2032-07-26', lease_type: 'Triple Net (NNN)',
    cap: null, capBaseAmount: null, admin_fee_pct: null, gross_up_pct: null,
    expense_stop: null, audit_rights: null, pro_rata_method: null,
    renewal_options: '2 successive options to extend for 5 years each at market rates; written notice required 180 days before Term expiration',
    amendments: [], fieldEvidence: {}, _recorded: { score: 100, level: 'high', needsReview: false } },

  { file: 'Lease 2 CafePress Commercial Flex CAM.pdf',
    tenant_name: 'Canvas On Demand, LLC', leased_sqft: 54777,
    start_date: '2010-01-01', end_date: '2015-12-31', lease_type: 'Triple Net (NNN)',
    cap: 5.25, capBaseAmount: null, admin_fee_pct: null, gross_up_pct: null,
    expense_stop: null, audit_rights: true, pro_rata_method: 'rentable',
    renewal_options: '2 options of 3 years each; 180 days notice; 1st at 97% escalated rate +3%/yr; 2nd at market rate',
    amendments: [], fieldEvidence: {}, _recorded: { score: 100, level: 'high', needsReview: false } },

  { file: 'Lease 3 Speizman Wink Davis Atlanta.pdf',
    tenant_name: 'Wink Davis Equipment Company', leased_sqft: '',
    start_date: '2001-05-01', end_date: '2006-05-31', lease_type: 'Modified Gross',
    cap: null, capBaseAmount: null, admin_fee_pct: null, gross_up_pct: null,
    expense_stop: null, audit_rights: null, pro_rata_method: 'rentable',
    renewal_options: '1 option to renew for 3-year term with 120 days prior written notice; Year 1: $5,650/mo, Year 2: $5,750/mo, Year 3: $5,850/mo',
    amendments: [], fieldEvidence: {}, _recorded: { score: 90, level: 'high', needsReview: false } },
];

// The two gates, as script.js computes them before and after the M5 fix.
const gateBefore = t => ({
  status: (!t.start_date || !t.end_date || !t.lease_type) ? 'partial' : 'success',
  missing: [],
});
const gateAfter = t => {
  const missing = AFTER.RECONCILIATION_CRITICAL_FIELDS.filter(f => !t[f]);
  return { status: (missing.length > 0 || !t.lease_type) ? 'partial' : 'success', missing };
};
const capLevel = l => (l === 'high' ? 'medium' : l);

const d = (a, b) => (a === b ? '  (unchanged)' : '  <-- CHANGED');

for (const t of TENANTS) {
  const b = BEFORE.generateLeaseExplainability(t);
  const a = AFTER.generateLeaseExplainability(t);
  const gb = gateBefore(t), ga = gateAfter(t);

  const needsReviewAfter = ga.status === 'partial';
  const levelAfter = ga.missing.length ? capLevel(t._recorded.level) : t._recorded.level;
  const scoreAfter = ga.missing.length ? Math.min(t._recorded.score, 79) : t._recorded.score;

  console.log(`\n${'='.repeat(78)}\n${t.file}\n${'='.repeat(78)}`);

  console.log('\n  overallSummary');
  console.log(`    before : ${b.overallSummary}`);
  console.log(`    after  : ${a.overallSummary}${d(b.overallSummary, a.overallSummary)}`);

  console.log('\n  fieldSummaries.cap');
  console.log(`    before : ${b.fieldSummaries.cap}`);
  console.log(`    after  : ${a.fieldSummaries.cap}${d(b.fieldSummaries.cap, a.fieldSummaries.cap)}`);

  const newNotes = a.reviewNotes.filter(n => !b.reviewNotes.includes(n));
  console.log(`\n  reviewNotes  before ${b.reviewNotes.length} / after ${a.reviewNotes.length}`);
  newNotes.forEach(n => console.log(`    + ${n}`));

  console.log('\n  review gate');
  console.log(`    before : status=${gb.status.padEnd(7)} needsReview=${String(gb.status === 'partial').padEnd(5)} confidence=${t._recorded.level}/${t._recorded.score}`);
  console.log(`    after  : status=${ga.status.padEnd(7)} needsReview=${String(needsReviewAfter).padEnd(5)} confidence=${levelAfter}/${scoreAfter}` +
              d(`${gb.status}${gb.status === 'partial'}${t._recorded.level}${t._recorded.score}`,
                `${ga.status}${needsReviewAfter}${levelAfter}${scoreAfter}`));
  if (ga.missing.length) console.log(`             missing: ${ga.missing.join(', ')}`);
}

console.log(`\n${'='.repeat(78)}`);
console.log('P1b (evidence source_file) is not replayable here — it lives inside');
console.log('callClaudeForLease in script.js, which requires a browser and a live');
console.log('extraction. Covered by source assertions in test-phase0-remediation.js');
console.log('and by 3 killed mutants; it will be observable in the pilot as a');
console.log('non-null source_file on the next extraction.');
console.log('E1 is NOT included: gated on tools/e1-raw-response-probe.js.');
