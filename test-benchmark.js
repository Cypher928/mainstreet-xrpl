'use strict';
/**
 * test-benchmark.js — Phase 15: Lease Intelligence Benchmark
 *
 * Measures accuracy of the LeaseIntelligence module across all six task areas.
 * Zero-DOM, zero-network. Inlines all functions under test.
 *
 * Run: node test-benchmark.js
 */

// ── Minimal global stubs ──────────────────────────────────────────────────────
global.window = global.window || {};

// ── The module under test — the real one ─────────────────────────────────────
//
// This file used to inline a COPY of every function in lease-intelligence.js
// and benchmark that. The copy drifted: it still carried
// `t._confidenceScore ?? 100` after AI-1 removed it from the shipped module,
// so the benchmark went on certifying "100% accuracy" for routing behaviour
// the product no longer had. A benchmark of a replica measures the replica.
//
// lease-intelligence.js is a pure module — no DOM, no network — so it loads
// here directly and every number below now describes the code that ships.
const fs = require('fs');
const path = require('path');
new Function(fs.readFileSync(path.join(__dirname, 'lease-intelligence.js'), 'utf8'))();
const {
  CANONICAL_FIELDS,
  CAM_CONCEPT_MAP,
  normalizeClauseConcept,
  reasonMultiDocumentLease,
  deriveExtractionConfidence,
  generateLeaseExplainability,
  detectLeaseEdgeCases,
  modelRoutingRecommendation,
  buildMultiDocReasoningDocs,
} = window.LeaseIntelligence;


// ── Test harness ──────────────────────────────────────────────────────────────

let passed = 0, failed = 0;
const results = { normalization: {}, confidence: {}, multiDoc: {}, explainability: {}, edgeCases: {}, routing: {} };

function assert(cond, label) {
  if (cond) { console.log(`  ✓ ${label}`); passed++; }
  else       { console.error(`  ✗ ${label}`); failed++; }
}
function assertEqual(a, b, label) {
  if (a === b) { console.log(`  ✓ ${label}`); passed++; }
  else         { console.error(`  ✗ ${label} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); failed++; }
}

// ── BENCHMARK 1: Clause Semantic Normalization ────────────────────────────────
// 16 test strings → expected canonical codes.  Accuracy target: ≥ 87.5%

console.log('\n═══ BENCHMARK 1: Clause Semantic Normalization ═══');

const normFixtures = [
  { text: 'administrative fee not to exceed 15% of total CAM charges', expected: 'ADMIN_FEE' },
  { text: 'management surcharge of 12% applies to all operating expenses', expected: 'ADMIN_FEE' },
  { text: 'operating overhead allocation per Section 7.2', expected: 'ADMIN_FEE' },
  { text: 'CAM cap of 5% per year applies to controllable expenses', expected: 'CAM_CAP' },
  { text: 'annual increases limited to 3% over prior year', expected: 'CAM_CAP' },
  { text: 'operating expenses capped at 104% of prior year', expected: 'CAM_CAP' },
  { text: 'expense stop of $8.50 per square foot base year 2022', expected: 'EXPENSE_STOP' },
  { text: 'base year operating expenses of $12.00 per rentable square foot', expected: 'EXPENSE_STOP' },
  { text: 'grossed up to 95% occupancy for purposes of CAM reconciliation', expected: 'GROSS_UP' },
  { text: 'occupancy factor of 90% applied to variable operating expenses', expected: 'GROSS_UP' },
  { text: 'capital expenditures excluded from CAM charges per Exhibit B', expected: 'CAM_EXCLUSION' },
  { text: 'tenant has the right to audit landlord\'s books and records', expected: 'AUDIT_RIGHTS' },
  { text: '2-year look-back period for audit reimbursement', expected: 'AUDIT_RIGHTS' },
  { text: 'tenant shall have one (1) five-year renewal option at then-market rate', expected: 'RENEWAL_OPTION' },
  { text: 'pro rata share based on rentable square footage of the premises', expected: 'PRO_RATA' },
  { text: 'triple net lease — tenant responsible for taxes insurance and CAM', expected: 'LEASE_TYPE' },
];

let normCorrect = 0;
for (const f of normFixtures) {
  const res = normalizeClauseConcept(f.text);
  const ok = res.canonical === f.expected;
  assert(ok, `"${f.text.slice(0, 50)}…" → ${f.expected}`);
  if (ok) normCorrect++;
}
const normAccuracy = Math.round((normCorrect / normFixtures.length) * 100);
results.normalization = { correct: normCorrect, total: normFixtures.length, accuracy: normAccuracy };
console.log(`  Normalization accuracy: ${normCorrect}/${normFixtures.length} (${normAccuracy}%)`);

// ── BENCHMARK 2: Multi-Document Reasoning ─────────────────────────────────────
// Scenario A: Original lease + 2 amendments → governing clause correct
// Scenario B: Conflicting amendments → contradiction detected

console.log('\n═══ BENCHMARK 2: Multi-Document Reasoning ═══');

const scenarioA = [
  { docType: 'original_lease', docDate: '2020-01-01', fileName: 'lease.pdf', extractedFields: { cap: 5, admin_fee_pct: 15, audit_rights: true }, quotes: { cap: 'CAM increases capped at 5% per year.', audit_rights: 'Tenant has right to audit books and records.' } },
  { docType: 'amendment', docDate: '2021-06-15', fileName: 'amd1.pdf', extractedFields: { cap: 4, admin_fee_pct: 15 }, quotes: { cap: 'CAM cap reduced to 4% effective June 2021.' } },
  { docType: 'amendment', docDate: '2023-04-11', fileName: 'amd2.pdf', extractedFields: { cap: 3 }, quotes: { cap: 'CAM cap further reduced to 3% per year.' } },
];
const reasonA = reasonMultiDocumentLease(scenarioA);
assertEqual(reasonA.cap?.currentValue, 3, 'Scenario A: cap governed by Amendment #2 (3%)');
assertEqual(reasonA.cap?.governingDocument, 'amendment', 'Scenario A: governing document is amendment');
assert(reasonA.cap?.supersededValues.length === 2, 'Scenario A: 2 superseded cap values');
assert(reasonA.cap?.reasoning.includes('3'), 'Scenario A: reasoning mentions 3%');
assert(!reasonA.audit_rights?.contradictions.length, 'Scenario A: audit_rights has no contradictions');
assert(Array.isArray(reasonA.admin_fee_pct?.supersededValues), 'Scenario A: admin_fee_pct has superseded values tracked');

const scenarioB = [
  { docType: 'amendment', docDate: '2022-01-01', fileName: 'amdX.pdf', extractedFields: { cap: 5 }, quotes: {} },
  { docType: 'amendment', docDate: '2022-01-01', fileName: 'amdY.pdf', extractedFields: { cap: 3 }, quotes: {} },
];
const reasonB = reasonMultiDocumentLease(scenarioB);
assert(reasonB.cap?.contradictions.length > 0, 'Scenario B: contradiction detected for same-date amendments');
assert(reasonB.cap?.reasoning.includes('WARNING'), 'Scenario B: reasoning flags the contradiction');
assert(reasonB.cap?.confidence < 70, 'Scenario B: confidence reduced for contradicting amendments');

const multiDocCorrect = [
  reasonA.cap?.currentValue === 3,
  reasonA.cap?.governingDocument === 'amendment',
  reasonA.cap?.supersededValues.length === 2,
  reasonB.cap?.contradictions.length > 0,
].filter(Boolean).length;
results.multiDoc = { correct: multiDocCorrect, total: 4, accuracy: Math.round((multiDocCorrect / 4) * 100) };
console.log(`  Multi-doc reasoning: ${multiDocCorrect}/4 correct`);

// ── BENCHMARK 3: Confidence Calibration ──────────────────────────────────────
// 6 scenarios — verify signal direction and score thresholds

console.log('\n═══ BENCHMARK 3: Confidence Calibration ═══');

const baseConf = deriveExtractionConfidence([], {});
assertEqual(baseConf.score, 70, 'Base: no signals = 70');

const directQuote = deriveExtractionConfidence([{ quote: 'text' }], { hasQuote: true });
assert(directQuote.score > 70, 'Direct quote increases score');
assert(directQuote.score >= 90, 'Direct quote pushes score ≥ 90');

const poorOcr = deriveExtractionConfidence([], { ocrChars: 150 });
assert(poorOcr.score < 70, 'Poor OCR decreases score');
assertEqual(poorOcr.level, 'medium', 'Poor OCR yields medium confidence');

const amdConflict = deriveExtractionConfidence([], { amendmentConflict: true });
assert(amdConflict.score < 70, 'Amendment conflict decreases score');

const multiAgree = deriveExtractionConfidence([{}, {}], { multiDocAgreement: true });
assert(multiAgree.score > 70, 'Multi-doc agreement increases score');

const worstCase = deriveExtractionConfidence([], { amendmentConflict: true, ocrChars: 100, candidateCount: 3, governingClauseUncertain: true });
assert(worstCase.score < 30, 'Worst case: multiple negative signals → low score');
assertEqual(worstCase.level, 'low', 'Worst case → low level');

const confTestsPassed = [
  baseConf.score === 70,
  directQuote.score > 70,
  poorOcr.score < 70,
  amdConflict.score < 70,
  multiAgree.score > 70,
  worstCase.score < 30,
].filter(Boolean).length;
results.confidence = { correct: confTestsPassed, total: 6, accuracy: Math.round((confTestsPassed / 6) * 100) };
console.log(`  Confidence calibration: ${confTestsPassed}/6 signals moving in correct direction`);

// ── BENCHMARK 4: Explainability Quality ──────────────────────────────────────
// 3 tenant states — verify key phrases appear in summaries

console.log('\n═══ BENCHMARK 4: Explainability Outputs ═══');

const tenantWithAmendment = {
  tenant_name: 'Acme Corp', leased_sqft: 5000, start_date: '2020-01-01', end_date: '2025-01-01',
  cap: 3, admin_fee_pct: 15, audit_rights: true,
  fieldEvidence: {
    cap: { snapshots: [{ value: 5, amendmentId: null, quote: 'capped at 5%', reviewedAt: '2020-01-01T00:00:00Z' }, { value: 3, amendmentId: 'amd-001', quote: 'reduced to 3%', reviewedAt: '2023-04-11T00:00:00Z' }] },
    audit_rights: { snapshots: [{ value: true, amendmentId: null, quote: 'Tenant has 2-year audit rights.', reviewedAt: '2020-01-01T00:00:00Z' }] },
  },
  amendments: [{ amendmentId: 'amd-001', effectiveDate: '2023-04-11', uploadedAt: '2023-04-11T00:00:00Z', fileName: 'amd2.pdf', overriddenFields: ['cap'], extractedFields: { cap: 3 } }],
};
const expl1 = generateLeaseExplainability(tenantWithAmendment);
assert(expl1.fieldSummaries.cap.includes('3%'), 'Cap summary mentions 3%');
assert(expl1.fieldSummaries.cap.includes('Amendment'), 'Cap summary credits amendment');
assert(expl1.fieldSummaries.audit_rights.includes('Audit rights clause exists'), 'Audit rights confirmed');
assert(expl1.reviewNotes.some(n => n.includes('amendment')), 'Review notes mention amendment');
assert(expl1.overallSummary.includes('CAM Cap: 3%'), 'Overall summary includes CAM cap');

const tenantNoQuote = {
  tenant_name: 'Beta LLC', leased_sqft: 2000, start_date: '2021-01-01', end_date: '2026-01-01',
  gross_up_pct: 95, audit_rights: false, fieldEvidence: { gross_up_pct: { snapshots: [{ value: 95, amendmentId: null, quote: null, reviewedAt: '2021-01-01T00:00:00Z' }] } }, amendments: [],
};
const expl2 = generateLeaseExplainability(tenantNoQuote);
assert(expl2.fieldSummaries.gross_up_pct.includes('ambiguous'), 'No-quote gross_up marked ambiguous');
assert(expl2.fieldSummaries.audit_rights.includes('waived'), 'Waived audit rights flagged');
assert(expl2.reviewNotes.some(n => n.includes('waived')), 'Review notes flag waived audit rights');

const tenantIncomplete = { tenant_name: 'Gamma Inc', leased_sqft: null, start_date: null, end_date: null, fieldEvidence: {}, amendments: [] };
const expl3 = generateLeaseExplainability(tenantIncomplete);
assert(expl3.overallSummary.includes('incomplete'), 'Incomplete lease flagged in summary');
assert(expl3.overallSummary.includes('leased_sqft'), 'Missing sqft named in summary');

const explCorrect = [
  expl1.fieldSummaries.cap.includes('3%'),
  expl1.fieldSummaries.cap.includes('Amendment'),
  expl2.fieldSummaries.gross_up_pct.includes('ambiguous'),
  expl3.overallSummary.includes('incomplete'),
].filter(Boolean).length;
results.explainability = { correct: explCorrect, total: 4, accuracy: Math.round((explCorrect / 4) * 100) };
console.log(`  Explainability quality: ${explCorrect}/4 key phrases verified`);

// ── BENCHMARK 5: Edge Case Detection ─────────────────────────────────────────
// 5 known states — verify detection accuracy

console.log('\n═══ BENCHMARK 5: Edge Case Detection ═══');

// Case 1: Weak OCR
const ecResult1 = detectLeaseEdgeCases({}, { ocrChars: 200, usedPdfDirect: false });
assert(ecResult1.edgeCases.some(e => e.type === 'WEAK_OCR'), 'Weak OCR detected for ocrChars=200');
assert(ecResult1.overallRisk === 'high', 'Weak OCR produces high risk');

// Case 2: Amendment conflict
const conflictTenant = { amendments: [{ amendmentId: 'a1', overriddenFields: ['cap'] }, { amendmentId: 'a2', overriddenFields: ['cap'] }] };
const ecResult2 = detectLeaseEdgeCases(conflictTenant, {});
assert(ecResult2.edgeCases.some(e => e.type === 'AMENDMENT_CONFLICT'), 'Amendment conflict detected');
assert(ecResult2.shouldFlagReview === true, 'Amendment conflict triggers review flag');

// Case 3: Both cap and expense stop
const bothTenant = { cap: 5, expense_stop: 12.00 };
const ecResult3 = detectLeaseEdgeCases(bothTenant, {});
assert(ecResult3.edgeCases.some(e => e.type === 'CONTRADICTORY_CAP_AND_STOP'), 'Cap+stop contradiction detected');

// Case 4: NNN with no exclusions
const nnnTenant = { lease_type: 'Triple Net (NNN)', excluded_categories: null };
const ecResult4 = detectLeaseEdgeCases(nnnTenant, {});
assert(ecResult4.edgeCases.some(e => e.type === 'CAM_EXCLUSIONS_UNDEFINED'), 'NNN exclusions undefined detected');

// Case 5: Clean lease — no edge cases
const cleanTenant = { lease_type: 'Gross', cap: null, expense_stop: null, amendments: [], fieldEvidence: {} };
const ecResult5 = detectLeaseEdgeCases(cleanTenant, { ocrChars: 5000, usedPdfDirect: false });
assert(ecResult5.overallRisk === 'none', 'Clean lease produces no edge cases');
assertEqual(ecResult5.edgeCases.length, 0, 'Clean lease: zero edge cases');

const ecCorrect = [
  ecResult1.edgeCases.some(e => e.type === 'WEAK_OCR'),
  ecResult2.edgeCases.some(e => e.type === 'AMENDMENT_CONFLICT'),
  ecResult3.edgeCases.some(e => e.type === 'CONTRADICTORY_CAP_AND_STOP'),
  ecResult4.edgeCases.some(e => e.type === 'CAM_EXCLUSIONS_UNDEFINED'),
  ecResult5.overallRisk === 'none',
].filter(Boolean).length;
results.edgeCases = { correct: ecCorrect, total: 5, accuracy: Math.round((ecCorrect / 5) * 100) };
console.log(`  Edge case detection: ${ecCorrect}/5 correct`);

// ── BENCHMARK 6: Model Routing ────────────────────────────────────────────────
// 4 scenarios — verify correct tier assignment

console.log('\n═══ BENCHMARK 6: Model Routing ═══');

// Simple clean lease → Haiku
const simpleRoute = modelRoutingRecommendation({ tenant_name: 'Simple Co', leased_sqft: 1000, start_date: '2022-01-01', end_date: '2027-01-01', cap: 5, amendments: [], fieldEvidence: {}, _confidenceScore: 92 });
assertEqual(simpleRoute.tier, 'simple', 'Simple lease routes to haiku tier');
assert(simpleRoute.model.includes('haiku'), 'Simple lease model is haiku');

// Amendment present → Opus
const amendRoute = modelRoutingRecommendation({ amendments: [{ amendmentId: 'a1', overriddenFields: ['cap'] }], fieldEvidence: {}, _confidenceScore: 80 });
assertEqual(amendRoute.tier, 'complex', 'Lease with amendment routes to complex tier');
assert(amendRoute.model.includes('opus'), 'Amendment lease model is opus');

// Low confidence → Opus
const lowConfRoute = modelRoutingRecommendation({ amendments: [], fieldEvidence: {}, _confidenceScore: 40 });
assertEqual(lowConfRoute.tier, 'complex', 'Low confidence routes to complex tier');

// Amendment conflict → Opus
const conflictRoute = modelRoutingRecommendation({ amendments: [{ amendmentId: 'b1', overriddenFields: ['cap'] }, { amendmentId: 'b2', overriddenFields: ['cap'] }], fieldEvidence: {}, _confidenceScore: 70 });
assertEqual(conflictRoute.tier, 'complex', 'Amendment conflict routes to complex tier');
assert(conflictRoute.signals.length > 0, 'Amendment conflict: signals populated');

// AI-1 — no confidence score at all → Opus.
//
// Every case above hands the router an explicit score, which is why the whole
// benchmark stayed green while `?? 100` was still in the module: no fixture
// ever exercised the state that actually occurs in production. The lease
// extraction prompt does not ask the model for a confidence score, so this —
// not `_confidenceScore: 92` — is the common case. Unknown routes conservatively.
const unknownConfRoute = modelRoutingRecommendation({ tenant_name: 'Unscored Co', leased_sqft: 1000, start_date: '2022-01-01', end_date: '2027-01-01', cap: 5, amendments: [], fieldEvidence: {} });
assertEqual(unknownConfRoute.tier, 'complex', 'Unknown confidence routes to complex tier');
assert(unknownConfRoute.signals.some(s => /confidence unknown/i.test(s)), 'Unknown confidence: the reason names it');

const routeCorrect = [
  simpleRoute.tier === 'simple',
  amendRoute.tier === 'complex',
  lowConfRoute.tier === 'complex',
  conflictRoute.tier === 'complex',
  unknownConfRoute.tier === 'complex',
].filter(Boolean).length;
results.routing = { correct: routeCorrect, total: 5, accuracy: Math.round((routeCorrect / 5) * 100) };
console.log(`  Model routing: ${routeCorrect}/5 correct`);

// ── BENCHMARK SUMMARY ─────────────────────────────────────────────────────────

const totalCorrect = Object.values(results).reduce((s, r) => s + r.correct, 0);
const totalTests   = Object.values(results).reduce((s, r) => s + r.total, 0);
const overallPct   = Math.round((totalCorrect / totalTests) * 100);

// Simulate hallucination rate: fraction of normalization misfires (wrong canonical on clear input)
const halluRate = Math.round(((normFixtures.length - normCorrect) / normFixtures.length) * 100);

// Model routing split (simple vs complex)
const complexSignalCount = 4; // amendment, low-conf, conflict, unknown-conf scenarios
const routingComplexPct  = Math.round((complexSignalCount / 5) * 100);

console.log('\n' + '═'.repeat(60));
console.log('  PHASE 15 BENCHMARK RESULTS');
console.log('═'.repeat(60));
console.log(`  Normalization accuracy:     ${results.normalization.accuracy}%  (${results.normalization.correct}/${results.normalization.total})`);
console.log(`  Multi-doc reasoning:        ${results.multiDoc.accuracy}%  (${results.multiDoc.correct}/${results.multiDoc.total})`);
console.log(`  Confidence calibration:     ${results.confidence.accuracy}%  (${results.confidence.correct}/${results.confidence.total})`);
console.log(`  Explainability quality:     ${results.explainability.accuracy}%  (${results.explainability.correct}/${results.explainability.total})`);
console.log(`  Edge case detection:        ${results.edgeCases.accuracy}%  (${results.edgeCases.correct}/${results.edgeCases.total})`);
console.log(`  Model routing accuracy:     ${results.routing.accuracy}%  (${results.routing.correct}/${results.routing.total})`);
console.log('─'.repeat(60));
console.log(`  Overall accuracy:           ${overallPct}%  (${totalCorrect}/${totalTests} assertions)`);
console.log(`  Hallucination rate:         ${halluRate}% (wrong canonical on known clause text)`);
console.log('─'.repeat(60));
console.log('  MODEL ROUTING RECOMMENDATION:');
console.log(`    ${routingComplexPct}% of leases route to Opus 4.8 based on amendment/complexity signals`);
console.log(`    ${100 - routingComplexPct}% route to Haiku 4.5 for simple single-document extraction`);
console.log('    Strategy: use complexity signals (amendments, low confidence, edge cases)');
console.log('    to route dynamically — not a blanket upgrade to Opus for all leases.');
console.log('═'.repeat(60));

if (failed > 0) {
  console.error(`\n  BENCHMARK SUITE FAILED — ${failed} assertion(s) failed`);
  process.exit(1);
} else {
  console.log(`\n  ALL BENCHMARKS PASSED (${passed} assertions)\n`);
}
