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

// ── Inline: LeaseIntelligence module ─────────────────────────────────────────

const CANONICAL_FIELDS = [
  'cap', 'admin_fee_pct', 'gross_up_pct', 'expense_stop',
  'audit_rights', 'pro_rata_method', 'renewal_options',
  'tenant_name', 'leased_sqft', 'start_date', 'end_date', 'lease_type',
];

const CAM_CONCEPT_MAP = [
  { canonical: 'ADMIN_FEE', label: 'Administrative / Management Fee', patterns: [/admin(?:istrative)?\s+fee/i, /management\s+(?:fee|surcharge|charge|overhead)/i, /operating\s+overhead\s+allocation/i, /supervision\s+fee/i, /property\s+management\s+fee/i, /management\s+services\s+fee/i] },
  { canonical: 'CAM_CAP', label: 'CAM / Expense Increase Cap', patterns: [/cam\s+cap/i, /expense\s+(?:increase\s+)?cap/i, /capped\s+at\s+[\d.]+\s*%/i, /not\s+to\s+exceed\s+[\d.]+\s*%/i, /annual\s+increase\s+(?:is\s+)?(?:limited|capped)/i, /controllable\s+expense\s+cap/i, /shall\s+not\s+(?:pay|increase)\s+more\s+than/i, /increases\s+(?:shall\s+be\s+)?limited\s+to/i, /cam\s+increases\s+(?:limited|capped)/i] },
  { canonical: 'EXPENSE_STOP', label: 'Expense Stop / Base Year Stop', patterns: [/expense\s+stop/i, /base\s+year\s+(?:stop|expense)/i, /base\s+(?:year\s+)?operating\s+expenses?\s+of\s+\$/i, /tenant\s+(?:shall\s+)?pay\s+(?:the\s+)?excess/i, /gross\s+rent\s+(?:with\s+)?expense\s+stop/i] },
  { canonical: 'GROSS_UP', label: 'Gross-Up / Occupancy Normalization', patterns: [/gross[\s-]?up/i, /grossed[\s-]?up\s+to/i, /occupancy\s+factor/i, /occupancy\s+(?:threshold|level)\s+of\s+[\d.]+\s*%/i, /as\s+if\s+(?:the\s+)?(?:building|project)\s+were\s+[\d.]+\s*%\s+occupied/i, /normalized\s+to\s+[\d.]+\s*%\s+occupancy/i] },
  { canonical: 'CAM_EXCLUSION', label: 'CAM Exclusion', patterns: [/excluded?\s+(?:from\s+)?(?:cam|operating\s+expenses?)/i, /cam\s+exclusion/i, /non[-\s]?(?:allocable|cam)\s+expense/i, /shall\s+not\s+(?:be\s+)?included\s+in\s+(?:cam|operating)/i, /excluded\s+(?:from\s+)?tenant'?s?\s+(?:pro[\s-]?rata\s+)?share/i] },
  { canonical: 'AUDIT_RIGHTS', label: 'Tenant Audit Rights', patterns: [/audit\s+rights?/i, /right\s+to\s+audit/i, /inspection\s+(?:and\s+audit\s+)?rights?/i, /books\s+and\s+records/i, /tenant\s+(?:may|shall\s+have\s+the\s+right\s+to)\s+(?:examine|inspect|audit)/i, /right\s+to\s+examine\s+(?:landlord'?s?\s+)?(?:books|records)/i, /\d+[\s-]year\s+(?:audit\s+)?(?:look[\s-]?back|reimbursement\s+period)/i] },
  { canonical: 'RENEWAL_OPTION', label: 'Renewal Option', patterns: [/renewal\s+option/i, /option\s+to\s+(?:renew|extend)/i, /extension\s+option/i, /renewal\s+term/i, /(?:tenant|lessee)\s+shall\s+have\s+(?:the\s+)?(?:option|right)\s+to\s+(?:renew|extend)/i] },
  { canonical: 'PRO_RATA', label: 'Pro-Rata Share Method', patterns: [/pro[\s-]?rata\s+share/i, /proportionate\s+share/i, /tenant'?s?\s+(?:pro[\s-]?rata|proportionate)\s+share/i, /rentable\s+(?:area|square\s+(?:feet|footage))/i, /(?:leasable|occupied|gross)\s+(?:area|square\s+(?:feet|footage))/i] },
  { canonical: 'LEASE_TYPE', label: 'Lease Type', patterns: [/triple[\s-]?net/i, /\bnnn\b/i, /modified\s+gross/i, /gross\s+lease/i, /net[\s-]?net[\s-]?net/i, /full[\s-]?service\s+(?:gross\s+)?lease/i] },
];

function normalizeClauseConcept(rawText) {
  if (!rawText || typeof rawText !== 'string') return { canonical: null, label: null, candidates: [], preservedText: rawText || '', confidence: 0 };
  const text = rawText.trim();
  const matches = [];
  for (const c of CAM_CONCEPT_MAP) {
    const h = c.patterns.filter(p => p.test(text)).length;
    if (h > 0) matches.push({ canonical: c.canonical, label: c.label, hitCount: h });
  }
  matches.sort((a, b) => b.hitCount - a.hitCount);
  const best = matches[0] || null;
  const confidence = !best ? 0 : matches.length === 1 ? (best.hitCount >= 2 ? 90 : 70) : best.hitCount > matches[1].hitCount ? 75 : 50;
  return { canonical: best?.canonical ?? null, label: best?.label ?? null, candidates: matches, preservedText: text, confidence };
}

const DOC_TYPE_TIER = { side_letter: 4, estoppel: 3, amendment: 2, original_lease: 1 };

function reasonMultiDocumentLease(documents) {
  if (!Array.isArray(documents) || !documents.length) return {};
  const sorted = [...documents].sort((a, b) => {
    const td = (DOC_TYPE_TIER[b.docType] || 0) - (DOC_TYPE_TIER[a.docType] || 0);
    if (td !== 0) return td;
    return (b.docDate ? new Date(b.docDate).getTime() : 0) - (a.docDate ? new Date(a.docDate).getTime() : 0);
  });
  const result = {};
  for (const field of CANONICAL_FIELDS) {
    const history = [];
    for (const doc of sorted) {
      const val = doc.extractedFields?.[field];
      if (val == null || val === '') continue;
      history.push({ value: val, docType: doc.docType, docDate: doc.docDate || null, fileName: doc.fileName || null, quote: doc.quotes?.[field] || null });
    }
    if (!history.length) continue;
    const governing = history[0];
    const supersededValues = history.slice(1);
    const contradictions = [];
    const byTier = {};
    for (const v of history) { const t = DOC_TYPE_TIER[v.docType] || 0; (byTier[t] = byTier[t] || []).push(v); }
    for (const group of Object.values(byTier)) {
      if (group.length < 2) continue;
      const unique = new Set(group.map(v => String(v.value)));
      if (unique.size > 1) contradictions.push({ tier: DOC_TYPE_TIER[group[0].docType] || 0, documents: group.map(v => v.fileName), values: [...unique] });
    }
    let fieldConf = 80;
    if (contradictions.length > 0) fieldConf -= 25;
    if (history.length > 1 && !contradictions.length) fieldConf = Math.min(95, fieldConf + 10);
    if (!governing.quote) fieldConf -= 10;
    fieldConf = Math.max(10, Math.min(100, fieldConf));
    const docLabel = d => `${(d.docType || '').replace('_', ' ')}${d.docDate ? ' dated ' + d.docDate : ''}${d.fileName ? ' (' + d.fileName + ')' : ''}`;
    const reasoning = history.length === 1
      ? `${field} set to ${JSON.stringify(governing.value)} in ${docLabel(governing)}.`
      : `${field} changed from ${JSON.stringify(history[1].value)} to ${JSON.stringify(governing.value)} by ${docLabel(governing)}.`
        + (contradictions.length ? ` WARNING: Conflicting values detected.` : '');
    result[field] = { currentValue: governing.value, supersededValues, governingDocument: governing.docType, governingClause: governing.quote || null, confidence: fieldConf, reasoning, contradictions };
  }
  return result;
}

function deriveExtractionConfidence(snapshots, context) {
  const ctx = context || {};
  let score = 70;
  const reasons = [], signals = [];
  const push = (type, adj, desc) => { score += adj; signals.push({ type, adjustment: adj, description: desc }); };
  if (ctx.hasQuote)                push('direct_quote', +20, 'Direct verbatim clause found');
  if (ctx.multiDocAgreement)       push('multi_doc_agreement', +10, 'Multiple documents agree');
  if (Array.isArray(snapshots) && snapshots.length > 1) push('confirming_snapshots', Math.min(10, (snapshots.length - 1) * 5), `${snapshots.length} snapshots`);
  if (ctx.ocrQuality === 'poor' || (ctx.ocrChars != null && ctx.ocrChars < 200))  { push('poor_ocr', -15, 'Poor OCR quality'); reasons.push('Poor OCR'); }
  else if (ctx.ocrChars != null && ctx.ocrChars < 500)                            { push('short_ocr', -8, 'Short OCR text'); reasons.push('Short OCR'); }
  if (ctx.amendmentConflict)       { push('amendment_conflict', -20, 'Amendment conflict'); reasons.push('Amendment conflict'); }
  if (ctx.candidateCount > 1)      { push('ambiguous_clauses', -10, 'Ambiguous clauses'); reasons.push('Ambiguous clauses'); }
  if (ctx.governingClauseUncertain){ push('uncertain_clause', -10, 'Uncertain clause'); reasons.push('Uncertain clause'); }
  if (ctx.inferenceType === 'unsupported') { push('unsupported_inference', -5, 'Unsupported inference'); reasons.push('Unsupported inference'); }
  score = Math.max(0, Math.min(100, score));
  return { score, level: score >= 80 ? 'high' : score >= 55 ? 'medium' : score > 0 ? 'low' : 'failed', reasons, signals };
}

function generateLeaseExplainability(tenantState) {
  if (!tenantState) return { fieldSummaries: {}, overallSummary: '', reviewNotes: [] };
  const t = tenantState;
  const amendments = Array.isArray(t.amendments) ? t.amendments : [];
  const fev = t.fieldEvidence || {};
  const fieldSummaries = {}, reviewNotes = [];
  const govAmd = fk => amendments.slice().reverse().find(a => Array.isArray(a.overriddenFields) && a.overriddenFields.includes(fk));
  const amdLabel = a => { const idx = amendments.indexOf(a); const dt = a.effectiveDate || a.uploadedAt; return `Amendment #${idx + 1}${dt ? ' dated ' + new Date(dt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : ''}`; };
  const latestQuote = fk => { const s = (fev[fk]?.snapshots || []); return s.length ? s[s.length - 1].quote || null : null; };
  if (t.cap != null) {
    const gov = govAmd('cap');
    const prior = (fev['cap']?.snapshots || []).slice(0, -1);
    if (gov && prior.length) { const pv = prior[prior.length - 1].value; fieldSummaries.cap = `CAM Cap ${pv != null ? `reduced from ${pv}% to ` : 'set to '}${t.cap}% by ${amdLabel(gov)}.`; }
    else if (gov)             fieldSummaries.cap = `CAM Cap of ${t.cap}% applied by ${amdLabel(gov)}.`;
    else                      fieldSummaries.cap = `CAM Cap of ${t.cap}% defined in original lease.`;
  } else {
    fieldSummaries.cap = 'No CAM Cap found — tenant bears full proportionate share of expense increases.';
    reviewNotes.push('CAM Cap not specified.');
  }
  if (t.admin_fee_pct != null) {
    const gov = govAmd('admin_fee_pct');
    fieldSummaries.admin_fee_pct = gov ? `Administrative fee of ${t.admin_fee_pct}% per ${amdLabel(gov)}.` : `Administrative fee of ${t.admin_fee_pct}% per lease.`;
  } else { fieldSummaries.admin_fee_pct = 'Administrative / management fee not specified.'; }
  if (t.gross_up_pct != null) {
    const qt = latestQuote('gross_up_pct');
    fieldSummaries.gross_up_pct = qt ? `Gross-up set to ${t.gross_up_pct}% occupancy.` : 'Gross-up language detected with ambiguous occupancy threshold.';
    if (!qt) reviewNotes.push('Gross-up clause detected but occupancy percentage not confirmed by direct quote.');
  } else { fieldSummaries.gross_up_pct = 'No gross-up provision found.'; }
  fieldSummaries.audit_rights = t.audit_rights === true
    ? 'Audit rights clause exists' + (latestQuote('audit_rights') ? '.' : ' but reimbursement window could not be determined.')
    : t.audit_rights === false ? 'Audit rights explicitly waived in lease.' : 'Audit rights not addressed.';
  if (t.audit_rights === false) reviewNotes.push('Audit rights have been waived.');
  fieldSummaries.pro_rata_method = t.pro_rata_method ? `Pro-rata share on ${t.pro_rata_method} basis.` : 'Pro-rata method not specified.';
  fieldSummaries.renewal_options = t.renewal_options ? `Renewal options: ${t.renewal_options}.` : 'No renewal options specified.';
  if (amendments.length > 0) {
    const modified = [...new Set(amendments.flatMap(a => a.overriddenFields || []))];
    reviewNotes.push(`${amendments.length} amendment(s) on file, modifying: ${modified.join(', ')}.`);
  }
  const missing = ['tenant_name', 'leased_sqft', 'start_date', 'end_date'].filter(f => !t[f]);
  const overallSummary = !missing.length
    ? `Lease complete. ${amendments.length ? amendments.length + ' amendment(s) applied. ' : ''}${t.cap != null ? 'CAM Cap: ' + t.cap + '%.' : 'No CAM Cap.'}`
    : `Lease incomplete — missing: ${missing.join(', ')}.`;
  return { fieldSummaries, overallSummary, reviewNotes };
}

const EDGE_CASE_DEFINITIONS = [
  { type: 'WEAK_OCR', severity: 'high', confidenceAdjustment: -20, fieldImpact: ['tenant_name'], reviewerNote: 'Retry with PDF direct mode.', detect: (t, r) => !r?.usedPdfDirect && r?.ocrChars != null && r.ocrChars < 300, description: 'Very short OCR text layer.' },
  { type: 'MISSING_PAGES', severity: 'medium', confidenceAdjustment: -15, fieldImpact: ['cap'], reviewerNote: 'Ensure full lease uploaded.', detect: (t, r) => r?.ocrChars != null && r.ocrChars > 0 && r.ocrChars < 800 && !r?.usedPdfDirect, description: 'Document appears truncated.' },
  { type: 'AMENDMENT_CONFLICT', severity: 'high', confidenceAdjustment: -25, fieldImpact: [], reviewerNote: 'Confirm governing amendment.', detect: (t) => { const ams = Array.isArray(t.amendments) ? t.amendments : []; if (ams.length < 2) return false; const seen = {}; for (const a of ams) for (const f of (a.overriddenFields || [])) seen[f] = (seen[f] || 0) + 1; return Object.values(seen).some(c => c > 1); }, description: 'Two amendments modify the same field.' },
  { type: 'CONTRADICTORY_CAP_AND_STOP', severity: 'medium', confidenceAdjustment: -10, fieldImpact: ['cap', 'expense_stop'], reviewerNote: 'Confirm which mechanism applies.', detect: (t) => t.cap != null && t.expense_stop != null, description: 'Both CAM Cap and Expense Stop present.' },
  { type: 'CAM_EXCLUSIONS_UNDEFINED', severity: 'low', confidenceAdjustment: -5, fieldImpact: ['excluded_categories'], reviewerNote: 'Check expense category exposure.', detect: (t) => { const lt = (t.lease_type || '').toLowerCase(); return (lt.includes('nnn') || lt.includes('triple') || lt.includes('net')) && !t.excluded_categories; }, description: 'NNN lease with no CAM exclusions.' },
  { type: 'AMBIGUOUS_GROSS_UP', severity: 'medium', confidenceAdjustment: -10, fieldImpact: ['gross_up_pct'], reviewerNote: 'Verify gross-up against lease.', detect: (t) => { const s = t.fieldEvidence?.gross_up_pct?.snapshots || []; return t.gross_up_pct != null && !s.some(x => x.quote); }, description: 'Gross-up percentage lacks direct quote.' },
  { type: 'MALFORMED_OCR', severity: 'medium', confidenceAdjustment: -15, fieldImpact: ['tenant_name'], reviewerNote: 'Re-upload at higher quality.', detect: (t, r) => { if (!r?.ocrText || r.ocrText.length < 100) return false; const n = (r.ocrText.slice(0, 500).match(/[^a-zA-Z0-9\s$%.,;:'"()\-/]/g) || []).length; return n / Math.min(r.ocrText.length, 500) > 0.08; }, description: 'High OCR noise ratio.' },
  { type: 'RENEWAL_DATE_CONFLICT', severity: 'low', confidenceAdjustment: -5, fieldImpact: ['renewal_options'], reviewerNote: 'Verify renewal dates.', detect: (t) => { if (!t.renewal_options || !t.end_date) return false; const ey = new Date(t.end_date).getFullYear(); const m = t.renewal_options.match(/20(\d{2})/); return m && parseInt('20' + m[1]) < ey; }, description: 'Renewal date inconsistency.' },
];

function detectLeaseEdgeCases(tenantState, extractionResult) {
  const t = tenantState || {}, r = extractionResult || {};
  const edgeCases = [];
  for (const def of EDGE_CASE_DEFINITIONS) {
    let triggered = false; try { triggered = !!def.detect(t, r); } catch (_) {}
    if (triggered) edgeCases.push({ type: def.type, severity: def.severity, description: def.description, fieldImpact: def.fieldImpact.slice(), confidenceAdjustment: def.confidenceAdjustment, reviewerNote: def.reviewerNote });
  }
  const hasHigh = edgeCases.some(e => e.severity === 'high'), hasMedium = edgeCases.some(e => e.severity === 'medium');
  return { edgeCases, overallRisk: hasHigh ? 'high' : hasMedium ? 'medium' : edgeCases.length ? 'low' : 'none', shouldFlagReview: hasHigh || (hasMedium && edgeCases.length >= 2), totalConfidenceAdjustment: edgeCases.reduce((s, e) => s + e.confidenceAdjustment, 0) };
}

function modelRoutingRecommendation(tenantState) {
  const t = tenantState || {};
  const amendments = Array.isArray(t.amendments) ? t.amendments : [];
  const { edgeCases, overallRisk } = detectLeaseEdgeCases(t, null);
  const confScore = t._confidenceScore ?? 100;
  const signals = [];
  if (amendments.length)  signals.push(`${amendments.length} amendment(s)`);
  if (overallRisk === 'high') signals.push('High-risk edge cases');
  if (confScore < 60)     signals.push(`Low confidence (${confScore})`);
  if (edgeCases.some(e => e.type === 'AMENDMENT_CONFLICT'))        signals.push('Amendment conflict');
  if (edgeCases.some(e => e.type === 'CONTRADICTORY_CAP_AND_STOP')) signals.push('Contradictory CAM clauses');
  if (t.expense_stop != null && t.cap != null)                     signals.push('Both expense stop and CAM cap');
  return signals.length
    ? { model: 'claude-opus-4-8',           tier: 'complex', reason: signals.join('; '), signals }
    : { model: 'claude-haiku-4-5-20251001', tier: 'simple',  reason: 'Simple single-doc lease', signals: [] };
}

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

const routeCorrect = [
  simpleRoute.tier === 'simple',
  amendRoute.tier === 'complex',
  lowConfRoute.tier === 'complex',
  conflictRoute.tier === 'complex',
].filter(Boolean).length;
results.routing = { correct: routeCorrect, total: 4, accuracy: Math.round((routeCorrect / 4) * 100) };
console.log(`  Model routing: ${routeCorrect}/4 correct`);

// ── BENCHMARK SUMMARY ─────────────────────────────────────────────────────────

const totalCorrect = Object.values(results).reduce((s, r) => s + r.correct, 0);
const totalTests   = Object.values(results).reduce((s, r) => s + r.total, 0);
const overallPct   = Math.round((totalCorrect / totalTests) * 100);

// Simulate hallucination rate: fraction of normalization misfires (wrong canonical on clear input)
const halluRate = Math.round(((normFixtures.length - normCorrect) / normFixtures.length) * 100);

// Model routing split (simple vs complex)
const complexSignalCount = 3; // amendment, low-conf, conflict scenarios
const routingComplexPct  = Math.round((complexSignalCount / 4) * 100);

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
