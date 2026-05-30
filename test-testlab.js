'use strict';
/**
 * test-testlab.js — Regression tests for lease-test-lab.js
 *
 * Zero-DOM, zero-network. Loads lease-test-lab.js via eval.
 * Run: node test-testlab.js
 */

const fs   = require('fs');
const path = require('path');

global.window = {};
eval(fs.readFileSync(path.join(__dirname, 'lease-intelligence.js'), 'utf8')); // eslint-disable-line no-eval
eval(fs.readFileSync(path.join(__dirname, 'lease-test-lab.js'), 'utf8')); // eslint-disable-line no-eval
const LeaseTestLab = global.window.LeaseTestLab;

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    passed++;
    console.log('  ✓', label);
  } else {
    failed++;
    console.error('  ✗', label);
  }
}

console.log('\nLease Test Lab — regression tests');
console.log('─'.repeat(48));

// ── TEST-LAB-1: Easy scenario, perfect result → pass ─────────────────────────
{
  const s = LeaseTestLab.generateScenario('easy');
  const mockResult = {
    fields: Object.assign({}, s.expected.fields),
    confidenceScore: (s.expected.confidenceRange[0] + s.expected.confidenceRange[1]) / 2,
    warnings: s.expected.warnings.slice(),
    amendmentPrecedence: s.expected.amendmentPrecedence,
    edgeCases: s.expected.edgeCases.slice(),
  };
  const v = LeaseTestLab.validate(mockResult, s.expected);
  assert(v.pass === true,  'TEST-LAB-1: easy perfect result should pass');
  assert(v.score >= 80,    'TEST-LAB-1: score should be >= 80');
}

// ── TEST-LAB-2: Medium scenario, perfect result → score >= 70 ────────────────
{
  const s = LeaseTestLab.generateScenario('medium');
  const mockResult = {
    fields: Object.assign({}, s.expected.fields),
    confidenceScore: (s.expected.confidenceRange[0] + s.expected.confidenceRange[1]) / 2,
    warnings: s.expected.warnings.slice(),
    amendmentPrecedence: s.expected.amendmentPrecedence,
    edgeCases: s.expected.edgeCases.slice(),
  };
  const v = LeaseTestLab.validate(mockResult, s.expected);
  assert(v.score >= 70, 'TEST-LAB-2: medium perfect result should score >= 70');
}

// ── TEST-LAB-3: Hard scenario, wrong result → failedFields and edgeCaseIssues ─
{
  const s = LeaseTestLab.generateScenario('hard-001');
  const badResult = {
    fields: { cap: 99, admin_fee_pct: 0 },   // wrong cap value
    confidenceScore: 50,
    warnings: [],
    amendmentPrecedence: null,
    edgeCases: [],                             // missing AMENDMENT_CONFLICT
  };
  const v = LeaseTestLab.validate(badResult, s.expected);
  assert(v.failedFields.length > 0,   'TEST-LAB-3: wrong fields should produce failedFields');
  assert(v.edgeCaseIssues.length > 0, 'TEST-LAB-3: missing edge case should produce edgeCaseIssues');
}

// ── TEST-LAB-4: Nightmare scenario, wrong result → score < 50 ────────────────
{
  const s = LeaseTestLab.generateScenario('nightmare');
  const badResult = {
    fields: { cap: 99 },
    confidenceScore: 90,      // overconfident — nightmare range is much lower
    warnings: [],
    amendmentPrecedence: null,
    edgeCases: [],
  };
  const v = LeaseTestLab.validate(badResult, s.expected);
  assert(v.score < 50, 'TEST-LAB-4: nightmare wrong result should score < 50');
}

// ── TEST-LAB-5: hard-001 wrong amendment precedence → amendmentIssues > 0 ────
{
  const s = LeaseTestLab.generateScenario('hard-001');
  const badResult = {
    fields: { cap: 6 },
    confidenceScore: 58,
    warnings: ['amendment conflict'],
    amendmentPrecedence: { winningDocType: 'original_lease', governingField: 'cap', value: 5 },  // wrong doc type
    edgeCases: ['AMENDMENT_CONFLICT'],
  };
  const v = LeaseTestLab.validate(badResult, s.expected);
  assert(v.amendmentIssues.length > 0, 'TEST-LAB-5: wrong amendment precedence should produce amendmentIssues');
}

// ── TEST-LAB-6: nightmare-001 wrong winningDocType → amendmentIssues > 0 ─────
{
  const s = LeaseTestLab.generateScenario('nightmare-001');
  const badResult = {
    fields: { cap: 7 },      // amendment value, not side letter value
    confidenceScore: 38,
    warnings: [],
    amendmentPrecedence: { winningDocType: 'amendment', governingField: 'cap', value: 7 },  // should be side_letter
    edgeCases: ['AMENDMENT_CONFLICT'],
  };
  const v = LeaseTestLab.validate(badResult, s.expected);
  assert(v.amendmentIssues.length > 0, 'TEST-LAB-6: wrong winningDocType should produce amendmentIssues');
}

// ── TEST-LAB-7: nightmare-002 overconfident → confidenceIssues > 0 ────────────
{
  const s = LeaseTestLab.generateScenario('nightmare-002');
  const badResult = {
    fields: {},
    confidenceScore: 90,      // way too high — expected range is [10, 45]
    warnings: ['OCR'],
    amendmentPrecedence: null,
    edgeCases: ['WEAK_OCR'],
  };
  const v = LeaseTestLab.validate(badResult, s.expected);
  assert(v.confidenceIssues.length > 0, 'TEST-LAB-7: overconfident score should produce confidenceIssues');
}

// ── BONUS: scoreSuite test ────────────────────────────────────────────────────
{
  const suiteResults = LeaseTestLab.runSuite(['easy']);
  const stats = LeaseTestLab.scoreSuite(suiteResults);
  assert(stats.passRate >= 0 && stats.passRate <= 1,               'scoreSuite: passRate should be 0-1');
  assert(stats.extractionAccuracy >= 0 && stats.extractionAccuracy <= 1, 'scoreSuite: extractionAccuracy should be 0-1');
  assert(stats.totalScenarios > 0,                                 'scoreSuite: should have scenarios');
}

// ── Phase 18 regression: amendment precedence ────────────────────────────────

// P18-1: medium-001 — amendment overrides original lease (cap 5→3)
{
  const s = LeaseTestLab.generateScenario('medium-001');
  const v = LeaseTestLab.validate(s.tenant, s.expected);
  assert(v.amendmentIssues.length === 0, 'P18-1 medium-001: amendment should win over original_lease (cap 5→3)');
  assert(!v.amendmentIssues.some(i => i.issue === 'Wrong or missing amendment precedence'), 'P18-1 medium-001: no missing precedence');
}

// P18-2: hard-001 — two conflicting amendments, latest date wins (cap 4→6)
{
  const s = LeaseTestLab.generateScenario('hard-001');
  const v = LeaseTestLab.validate(s.tenant, s.expected);
  assert(v.amendmentIssues.length === 0, 'P18-2 hard-001: latest amendment should win (cap=6)');
}

// P18-3: nightmare-001 — side letter (tier 4) beats amendment (tier 2)
{
  const s = LeaseTestLab.generateScenario('nightmare-001');
  const v = LeaseTestLab.validate(s.tenant, s.expected);
  assert(v.amendmentIssues.length === 0, 'P18-3 nightmare-001: side_letter should beat amendment for cap');
}

// P18-4: nightmare-003 — three amendments, latest wins on all three fields
{
  const s = LeaseTestLab.generateScenario('nightmare-003');
  const v = LeaseTestLab.validate(s.tenant, s.expected);
  assert(v.amendmentIssues.length === 0, 'P18-4 nightmare-003: latest of three amendments should win (cap=4)');
}

// P18-5: nightmare-004 — amendment governs end_date field specifically
{
  const s = LeaseTestLab.generateScenario('nightmare-004');
  const v = LeaseTestLab.validate(s.tenant, s.expected);
  assert(v.amendmentIssues.length === 0, 'P18-5 nightmare-004: amendment should govern end_date (2027-12-31)');
}

// P18-6: nightmare-005 — side letter wins in maximum-complexity scenario
{
  const s = LeaseTestLab.generateScenario('nightmare-005');
  const v = LeaseTestLab.validate(s.tenant, s.expected);
  assert(v.amendmentIssues.length === 0, 'P18-6 nightmare-005: side_letter should win on cap in max-complexity scenario');
}

// ── Phase 19 regression: benchmark integrity ──────────────────────────────────

// P19-1: runSuite uses live LeaseIntelligence functions (reviewNotes from production, not hardcoded)
{
  const suiteResults = LeaseTestLab.runSuite(['easy']);
  const easy001 = suiteResults.find(r => r.scenario.id === 'easy-001');
  assert(easy001 !== undefined, 'P19-1 setup: easy-001 in suite results');
  // easy-001 has audit_rights=false — live generateLeaseExplainability pushes 'Audit rights waived' note
  // Hardcoded _explainability.reviewNotes was []; live output is non-empty → proves live call happened
  assert(
    easy001.result._explainability.reviewNotes.length > 0,
    'P19-1: runSuite calls live generateLeaseExplainability (easy-001 audit_rights=false produces reviewNote)'
  );
}

// P19-2: scoreSuite returns null for amendmentAccuracy when no amendment scenarios present
{
  const mockSuiteResults = [{
    scenario: { level: 'easy', expected: { amendmentPrecedence: null, edgeCases: [] } },
    validation: { pass: true, breakdown: { fields: 40, confidence: 20, warnings: 20, amendment: 10, edgeCases: 10 } }
  }];
  const stats = LeaseTestLab.scoreSuite(mockSuiteResults);
  assert(stats.amendmentAccuracy === null, 'P19-2: no amendment scenarios → amendmentAccuracy should be null (not 1.0)');
  assert(stats.amendmentTestedCount === 0,  'P19-2: amendmentTestedCount should be 0');
}

// P19-3: component veto — zero warning score with expected warnings → pass = false
{
  const badResult = {
    fields: { cap: 5 },
    confidenceScore: 90,
    warnings: [],           // deliberately empty — won't match expected
    amendmentPrecedence: null,
    edgeCases: []
  };
  const expected = {
    fields: { cap: 5 },
    confidenceRange: [80, 100],
    warnings: ['some required warning'],
    amendmentPrecedence: null,
    edgeCases: []
  };
  const v = LeaseTestLab.validate(badResult, expected);
  assert(v.warningIssues.length > 0, 'P19-3 setup: warningIssues should be non-empty');
  assert(v.pass === false,           'P19-3: zero warning score with expected warnings triggers veto → pass=false');
}

// P19-4: CAM_EXCLUSIONS_UNDEFINED does NOT fire when excluded_categories is empty string
{
  const LI = global.window.LeaseIntelligence;
  const edgeResult = LI.detectLeaseEdgeCases(
    { lease_type: 'NNN', excluded_categories: '' },
    {}
  );
  const fired = edgeResult.edgeCases.some(e => e.type === 'CAM_EXCLUSIONS_UNDEFINED');
  assert(!fired, 'P19-4: excluded_categories="" should NOT trigger CAM_EXCLUSIONS_UNDEFINED');
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('─'.repeat(48));
console.log(`  ${passed} passed, ${failed} failed`);
console.log('─'.repeat(48));

if (failed > 0) {
  process.exit(1);
}
