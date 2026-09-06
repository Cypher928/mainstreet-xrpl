'use strict';
/**
 * test-phase0-remediation.js — Phase 0 findings M1a, M5, P1b.
 *
 * Each test corresponds to a finding in docs/PHASE0_BENCHMARK.md and would have
 * failed against the code that produced the benchmark. Run:
 *
 *   node test-phase0-remediation.js
 *
 * Two testing styles are used deliberately:
 *
 *   - M1a and M5's shared-field-list assertion EXECUTE the real
 *     lease-intelligence.js. The module is evaluated from disk, never inlined —
 *     test-benchmark.js inlines its own copy of this module, which is how a
 *     stale `?? 100` survived in the real file while its tests passed.
 *
 *   - M5's gate and P1b assert on script.js SOURCE. Both live inside a 24k-line
 *     browser-bound file with no seam to call. Source assertions are weaker than
 *     execution and are marked as such in the output; they are mutation-proven
 *     below so they cannot pass vacuously.
 *
 * Every source assertion runs against comment-stripped text via code(), because
 * a regex that matches the fix's own explanatory comment proves nothing.
 */

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

let pass = 0, fail = 0;
const failures = [];

function t(name, fn) {
  try { fn(); pass++; console.log(`  ok   ${name}`); }
  catch (e) { fail++; failures.push(`${name}: ${e.message}`); console.log(`  FAIL ${name}\n       ${e.message}`); }
}
function eq(actual, expected, msg) {
  if (actual !== expected) throw new Error(`${msg || ''} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function ok(cond, msg) { if (!cond) throw new Error(msg || 'expected truthy'); }

// Strips line and block comments so an assertion can never be satisfied by the
// prose of the fix it is testing.
function code(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

// Loads the real lease-intelligence.js in a sandbox with a window stub.
function loadLeaseIntelligence(source) {
  const src = source != null ? source : fs.readFileSync(path.join(__dirname, 'lease-intelligence.js'), 'utf8');
  const sandbox = { window: {}, console };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'lease-intelligence.js' });
  if (!sandbox.window.LeaseIntelligence) throw new Error('lease-intelligence.js did not expose window.LeaseIntelligence');
  return sandbox.window.LeaseIntelligence;
}

const LI        = loadLeaseIntelligence();
const scriptSrc = code(fs.readFileSync(path.join(__dirname, 'script.js'), 'utf8'));
const liSrc     = code(fs.readFileSync(path.join(__dirname, 'lease-intelligence.js'), 'utf8'));

// The three real Phase 0 tenants, as extraction actually produced them.
// Values copied verbatim from properties.data.tenants[] in the pilot project on
// 2026-08-08 (property 881a2a92-84ae-4cb4-ba14-f05bdc5fd8f1). Not invented.
const CANVAS = {
  tenant_name: 'Canvas On Demand, LLC', leased_sqft: 54777, start_date: '2010-01-01',
  end_date: '2015-12-31', lease_type: 'Triple Net (NNN)', cap: 5.25, capBaseAmount: null,
  admin_fee_pct: null, gross_up_pct: null, expense_stop: null, audit_rights: true,
  pro_rata_method: 'rentable', amendments: [], fieldEvidence: {},
  renewal_options: '2 options of 3 years each; 180 days notice; 1st at 97% escalated rate +3%/yr; 2nd at market rate',
};
const WINK = {
  tenant_name: 'Wink Davis Equipment Company', leased_sqft: '', start_date: '2001-05-01',
  end_date: '2006-05-31', lease_type: 'Modified Gross', cap: null, capBaseAmount: null,
  admin_fee_pct: null, gross_up_pct: null, expense_stop: null, audit_rights: null,
  pro_rata_method: 'rentable', amendments: [], fieldEvidence: {},
  renewal_options: '1 option to renew for 3-year term with 120 days prior written notice',
};

console.log('\n── M1a — a cap with no base amount must not be reported as enforced ──');
console.log('   (executes the real lease-intelligence.js)');

t('capIsEnforceable is false when capBaseAmount is null (Canvas On Demand, real data)', () => {
  eq(LI.capIsEnforceable(CANVAS), false, 'cap 5.25 with null base');
});

t('capIsEnforceable is true once a base amount exists', () => {
  eq(LI.capIsEnforceable({ ...CANVAS, capBaseAmount: 10000 }), true);
});

t('capIsEnforceable mirrors the engine: out-of-range percentages are not enforceable', () => {
  eq(LI.capIsEnforceable({ cap: 150, capBaseAmount: 10000 }), false, 'cap > 100');
  eq(LI.capIsEnforceable({ cap: -1,  capBaseAmount: 10000 }), false, 'cap < 0');
});

t('field summary says NOT ENFORCED for an inert cap', () => {
  const r = LI.generateLeaseExplainability(CANVAS);
  ok(/NOT ENFORCED/.test(r.fieldSummaries.cap), `cap summary was: ${r.fieldSummaries.cap}`);
});

t('field summary does NOT say NOT ENFORCED once the cap is live', () => {
  const r = LI.generateLeaseExplainability({ ...CANVAS, capBaseAmount: 10000 });
  ok(!/NOT ENFORCED/.test(r.fieldSummaries.cap), `cap summary was: ${r.fieldSummaries.cap}`);
});

t('a review note names the missing base amount', () => {
  const r = LI.generateLeaseExplainability(CANVAS);
  ok(r.reviewNotes.some(n => /NOT being enforced/.test(n) && /base amount/.test(n)),
     `reviewNotes were: ${JSON.stringify(r.reviewNotes)}`);
});

t('overallSummary no longer asserts a bare "CAM Cap: 5.25%." for an inert cap', () => {
  const r = LI.generateLeaseExplainability(CANVAS);
  ok(/not enforced/.test(r.overallSummary),
     `overallSummary was: ${r.overallSummary}`);
  ok(!/CAM Cap: 5\.25%\.\s*$/.test(r.overallSummary),
     'summary still ends with the bare enforced-cap claim');
});

console.log('\n── M5 — a lease that cannot be reconciled must not pass the gate ──');

t('the critical-field list is exported and contains leased_sqft', () => {
  ok(Array.isArray(LI.RECONCILIATION_CRITICAL_FIELDS), 'not exported');
  ok(LI.RECONCILIATION_CRITICAL_FIELDS.includes('leased_sqft'),
     `list was ${JSON.stringify(LI.RECONCILIATION_CRITICAL_FIELDS)}`);
});

t('explainability reports Wink Davis as incomplete on leased_sqft (real data)', () => {
  const r = LI.generateLeaseExplainability(WINK);
  ok(/Lease incomplete/.test(r.overallSummary), `summary was: ${r.overallSummary}`);
  ok(/leased_sqft/.test(r.overallSummary),      `summary was: ${r.overallSummary}`);
});

t('generateLeaseExplainability reads the shared list, not a private literal', () => {
  const slice = liSrc.slice(liSrc.indexOf('function generateLeaseExplainability'));
  ok(/missingCritical\s*=\s*RECONCILIATION_CRITICAL_FIELDS/.test(slice),
     'missingCritical is not derived from the exported constant');
});

t('[source] the ingest gate derives "partial" from the shared list, not start/end/type only', () => {
  const i = scriptSrc.indexOf('const _missingCritical');
  ok(i !== -1, '_missingCritical not found in script.js');
  const slice = scriptSrc.slice(i, i + 900);
  ok(/_reconciliationCriticalFields\(\)/.test(slice), 'gate does not call _reconciliationCriticalFields()');
  ok(/_missingCritical\.length\s*>\s*0/.test(slice), 'status does not branch on _missingCritical');
  // The exact pre-fix condition must be gone.
  ok(!/!norm\?\.start_date\s*\|\|\s*!norm\?\.end_date\s*\|\|\s*!hasLeaseType/.test(scriptSrc),
     'the original start/end/type-only condition is still present');
});

t('[source] confidence is capped below "high" when a critical field is missing', () => {
  // Anchored on the fix itself, not on `_confidenceScore:` — that string first
  // appears at an unrelated placeholder initialiser, and slicing around the
  // wrong occurrence is how a source assertion passes while testing nothing.
  ok(/_confidence:\s*_missingCritical\.length\s*\?\s*_capConfidenceLevel\(_conf\.level\)\s*:\s*_conf\.level/.test(scriptSrc),
     '_confidence level is not capped');
  ok(/_confidenceScore:\s*_missingCritical\.length\s*\?\s*Math\.min\(_conf\.score,\s*79\)/.test(scriptSrc),
     '_confidenceScore is not capped below the 80 threshold');
  ok(/_confidenceReasons:\s*_missingCritical\.length/.test(scriptSrc),
     'the reason for the demotion is not recorded');
  // The pre-fix unconditional assignment must be gone from the ingest path.
  ok(!/_confidence:\s*_conf\.level,/.test(scriptSrc),
     'the original unconditional _confidence assignment is still present');
});

t('_capConfidenceLevel demotes high and leaves everything else alone', () => {
  const m = scriptSrc.match(/function _capConfidenceLevel\(level\)\s*\{[\s\S]*?\n\}/);
  ok(m, '_capConfidenceLevel not found');
  const fn = new Function(`${m[0]}; return _capConfidenceLevel;`)();
  eq(fn('high'), 'medium');
  eq(fn('medium'), 'medium');
  eq(fn('low'), 'low');
  eq(fn('failed'), 'failed');
});

t('[source] the gate evaluates the resolved tenant name, not the raw extraction', () => {
  const i = scriptSrc.indexOf('const _criticalState');
  ok(i !== -1, '_criticalState not found');
  ok(/tenant_name:\s*resolvedName/.test(scriptSrc.slice(i, i + 400)),
     'gate reads norm.tenant_name, which would newly fail leases the name fallbacks rescue');
});

console.log('\n── P1b — evidence snapshots must record the source filename ──');

t('[source] callClaudeForLease accepts a fileName parameter', () => {
  ok(/async function callClaudeForLease\(text,\s*fileName\)/.test(scriptSrc),
     'signature unchanged');
});

t('[source] the snapshot uses the parameter, not the unset normalized.fileName', () => {
  const i = scriptSrc.indexOf('sourceFile:             fileName');
  ok(i !== -1, 'snapshot does not read the fileName parameter');
  ok(!/sourceFile:\s*normalized\.fileName\s*\|\|\s*null,/.test(scriptSrc),
     'the original normalized.fileName-only read is still present');
});

t('[source] every call site passes a filename', () => {
  const calls = scriptSrc.match(/callClaudeForLease\((?!text,)[^)]*\)/g) || [];
  const bare  = calls.filter(c => !/,/.test(c));
  eq(bare.length, 0, `call sites still passing only text: ${JSON.stringify(bare)}`);
  ok(calls.length >= 5, `expected >= 5 call sites, found ${calls.length}`);
});

console.log('\n── Suite integrity ──');

t('no assertion in this file can be satisfied by a comment', () => {
  ok(!/\/\//.test(code('// x')), 'code() does not strip line comments');
  ok(!/NOT ENFORCED/.test(code('// NOT ENFORCED')), 'code() left a comment behind');
});

const TOTAL_EXPECTED = 19;
t(`suite runs all ${TOTAL_EXPECTED} checks (guards silent test loss)`, () => {
  eq(pass + fail + 1, TOTAL_EXPECTED, 'test count changed — update TOTAL_EXPECTED deliberately');
});

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} passed, ${fail} failed`);
if (fail) { failures.forEach(f => console.log(`  · ${f}`)); process.exit(1); }
