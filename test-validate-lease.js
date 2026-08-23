'use strict';
/**
 * test-validate-lease.js
 * Phase 23 regression tests for lease validation.
 *
 * Covers:
 *   - parseValidationFindings: Critical gate, silence coercion, field normalization
 *   - _tier1LeaseChecks: MGMT_FEE_CAP and AUDIT_RIGHTS deterministic logic
 *   - Required fields, source field, constants
 *
 * Run: node test-validate-lease.js
 */

let passed = 0;
let failed = 0;

function assert(label, condition, detail = '') {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? ' — ' + detail : ''}`);
    failed++;
  }
}

// ---------------------------------------------------------------------------
// Inline replica of parseValidationFindings (keep in sync with api/validate-lease.js)
// ---------------------------------------------------------------------------

const TIER2_CHECKS      = new Set(['CAM_EXCLUSIONS', 'STRUCT_EXCLUSIONS', 'TAX_ALLOCATION']);
const VALID_SEVERITIES  = new Set(['info', 'unconfirmed', 'warning', 'critical']);
const VALID_CONFIDENCES = new Set(['high', 'medium', 'low']);
const VALIDATION_MODEL  = 'claude-sonnet-4-6';
const MAX_LEASE_TEXT    = 300000;
const VALIDATION_TIMEOUT = 45000;

const SILENCE_PHRASES = [
  'does not address', 'is silent', 'not mentioned', 'no mention',
  'not specified',    'not found in', 'does not specify', 'no provision',
  'does not contain', 'no language',  'does not discuss',
];

function _normalizeFinding(f) {
  let severity   = typeof f.severity   === 'string' ? f.severity.toLowerCase()   : '';
  let confidence = typeof f.confidence === 'string' ? f.confidence.toLowerCase() : '';

  if (!VALID_SEVERITIES.has(severity))    severity   = 'unconfirmed';
  if (!VALID_CONFIDENCES.has(confidence)) confidence = 'medium';

  const quote       = typeof f.quote       === 'string' && f.quote.trim()       ? f.quote.trim()       : null;
  const section     = typeof f.section     === 'string' && f.section.trim()     ? f.section.trim()     : null;
  const page        = typeof f.page        === 'number' && Number.isFinite(f.page) ? Math.floor(f.page) : null;
  const finding     = typeof f.finding     === 'string' && f.finding.trim()     ? f.finding.trim()     : 'No detail provided.';
  const explanation = typeof f.explanation === 'string' && f.explanation.trim() ? f.explanation.trim() : null;

  // Hard requirement: Critical requires quote + section
  if (severity === 'critical' && (!quote || !section)) {
    severity   = 'warning';
    confidence = confidence === 'high' ? 'medium' : confidence;
  }

  // Hard requirement: lease silence → Unconfirmed/High
  const findingLc = finding.toLowerCase();
  if (SILENCE_PHRASES.some(p => findingLc.includes(p))) {
    severity   = 'unconfirmed';
    confidence = 'high';
  }

  return { check: f.check, source: 'lease_ai', severity, confidence, finding, quote, section, page, explanation };
}

function parseValidationFindings(raw) {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return [];
  let parsed;
  try { parsed = JSON.parse(match[0]); } catch { return []; }
  const findings = Array.isArray(parsed.findings) ? parsed.findings : [];
  return findings
    .filter(f => f && typeof f.check === 'string' && TIER2_CHECKS.has(f.check))
    .map(_normalizeFinding);
}

// ---------------------------------------------------------------------------
// Inline replica of _tier1LeaseChecks (keep in sync with script.js)
// ---------------------------------------------------------------------------

const _LV_ADMIN_KEYWORDS = ['admin', 'administrative', 'management fee', 'mgmt fee', 'property management'];

function _tier1LeaseChecks({ tenant = {}, totalExpenses = 0, lineItems = [], reconciledAt = null, today = new Date() } = {}) {
  const findings = [];
  const cap       = typeof tenant.admin_fee_pct === 'number' ? tenant.admin_fee_pct : null;
  const auditText = tenant.audit_rights || null;
  const adminFeeEvidence = tenant.fieldEvidence?.admin_fee_pct?.snapshots?.[0];
  const quote     = adminFeeEvidence?.quote || null;

  // ── MGMT_FEE_CAP ──────────────────────────────────────────────────────────
  if (cap !== null && totalExpenses > 0) {
    const adminLines = (lineItems || []).filter(li => {
      const cat = (li.category || '').toLowerCase();
      return _LV_ADMIN_KEYWORDS.some(kw => cat.includes(kw));
    });
    if (adminLines.length > 0) {
      const adminTotal = adminLines.reduce((s, li) => s + (li.amount || 0), 0);
      const actualPct  = (adminTotal / totalExpenses) * 100;
      const exceeded   = actualPct > cap + 0.5;   // 0.5% rounding tolerance
      findings.push({
        check: 'MGMT_FEE_CAP', source: 'deterministic',
        severity:    exceeded ? 'warning' : 'info',
        confidence:  'high',
        finding:     exceeded
          ? `Admin fee (${actualPct.toFixed(1)}%) exceeds the ${cap}% lease cap by ${(actualPct - cap).toFixed(1)} percentage points.`
          : `Admin fee (${actualPct.toFixed(1)}%) is within the ${cap}% lease cap.`,
        quote, section: null, page: null,
        explanation: exceeded
          ? `Reconciliation admin fee of $${adminTotal.toLocaleString()} is ${actualPct.toFixed(1)}% of total CAM ($${totalExpenses.toLocaleString()}), exceeding the ${cap}% cap.`
          : null,
      });
    } else {
      findings.push({
        check: 'MGMT_FEE_CAP', source: 'deterministic',
        severity: 'info', confidence: 'high',
        finding: 'No administrative fee line items identified in this reconciliation.',
        quote: null, section: null, page: null, explanation: null,
      });
    }
  } else {
    findings.push({
      check: 'MGMT_FEE_CAP', source: 'deterministic',
      severity: 'info', confidence: 'high',
      finding: cap === null
        ? 'No management fee cap was extracted from the lease.'
        : 'Total expenses are zero — fee cap check skipped.',
      quote: null, section: null, page: null, explanation: null,
    });
  }

  // ── AUDIT_RIGHTS ──────────────────────────────────────────────────────────
  if (auditText) {
    const daysMatch = auditText.match(/(\d+)\s+days?/i);
    if (daysMatch && reconciledAt) {
      const days        = parseInt(daysMatch[1], 10);
      const reconDate   = new Date(reconciledAt);
      const windowClose = new Date(reconDate.getTime() + days * 86400000);
      const expired     = today > windowClose;
      const daysLeft    = Math.round((windowClose - today) / 86400000);
      findings.push({
        check: 'AUDIT_RIGHTS', source: 'deterministic',
        severity:   expired ? 'warning' : 'info',
        confidence: 'high',
        finding:    expired
          ? `Audit window closed ${windowClose.toISOString().slice(0,10)} — ${Math.abs(daysLeft)} days have elapsed past the ${days}-day limit.`
          : `Audit window open — ${daysLeft} days remaining (closes ${windowClose.toISOString().slice(0,10)}).`,
        quote: null, section: null, page: null,
        explanation: expired
          ? `The tenant had ${days} days from ${reconDate.toISOString().slice(0,10)} to request an audit. That window has closed.`
          : null,
      });
    } else {
      findings.push({
        check: 'AUDIT_RIGHTS', source: 'deterministic',
        severity: 'info', confidence: 'medium',
        finding: `Audit rights found but deadline could not be computed: "${(auditText || '').slice(0, 80)}"`,
        quote: null, section: null, page: null, explanation: null,
      });
    }
  } else {
    findings.push({
      check: 'AUDIT_RIGHTS', source: 'deterministic',
      severity: 'info', confidence: 'high',
      finding: 'No audit rights clause was extracted from this lease.',
      quote: null, section: null, page: null, explanation: null,
    });
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------

async function runTests() {
  console.log('\n' + '='.repeat(60));
  console.log('  Phase 23 — Lease Validation Regression Tests');
  console.log('='.repeat(60));

  // ── Critical gate: quote missing ─────────────────────────────────────────

  console.log('\n[Critical gate — quote missing]');
  {
    const raw = JSON.stringify({ findings: [{
      check: 'CAM_EXCLUSIONS', severity: 'critical', confidence: 'high',
      finding: 'Roof repair conflicts with the structural exclusion clause.',
      quote: null, section: 'Section 6.2', page: 11, explanation: 'Direct conflict.',
    }] });
    const f = parseValidationFindings(raw);
    assert('VL-1:  critical + null quote → downgraded to warning', f[0].severity === 'warning');
    assert('VL-2:  confidence high → medium on downgrade',         f[0].confidence === 'medium');
  }

  // ── Critical gate: section missing ───────────────────────────────────────

  console.log('\n[Critical gate — section missing]');
  {
    const raw = JSON.stringify({ findings: [{
      check: 'CAM_EXCLUSIONS', severity: 'critical', confidence: 'high',
      finding: 'Conflict.', quote: 'Tenant shall not be charged for structural repairs.',
      section: null, page: 11, explanation: 'Conflict.',
    }] });
    const f = parseValidationFindings(raw);
    assert('VL-3:  critical + null section → downgraded to warning', f[0].severity === 'warning');
    assert('VL-4:  confidence high → medium on downgrade',           f[0].confidence === 'medium');
  }

  // ── Critical gate: both present — survives ────────────────────────────────

  console.log('\n[Critical gate — both quote and section present]');
  {
    const raw = JSON.stringify({ findings: [{
      check: 'CAM_EXCLUSIONS', severity: 'critical', confidence: 'high',
      finding: 'Explicit conflict found.', quote: 'Tenant shall not be charged…',
      section: 'Section 6.2', page: 11, explanation: 'Direct conflict.',
    }] });
    const f = parseValidationFindings(raw);
    assert('VL-5:  critical with quote+section stays critical', f[0].severity === 'critical');
    assert('VL-6:  confidence stays high',                      f[0].confidence === 'high');
  }

  // ── Lease silence → Unconfirmed/High ──────────────────────────────────────
  //
  // These asserted coercion to 'info', which the Lease Validation panel renders
  // as a green tick reading PASSED. The requirement was always that silence must
  // not be reported as a failure; it was never that silence should be reported
  // as compliance confirmed. "The lease is silent on structural exclusions"
  // shown as PASSED beside a $55,000 unitemised category is absence of evidence
  // presented as evidence of absence.
  //
  // 'unconfirmed' already existed client-side, meaning exactly this: "the lease
  // does not provide enough information to confirm this. Not a failure — not a
  // pass either." Only this tier could not produce it. The coercion is unchanged
  // in every other respect, including confidence staying high: the reading is
  // confident, the compliance is not established.

  console.log('\n[Lease silence coercion]');
  {
    const silencePhrases = [
      ['does not address', 'TAX_ALLOCATION'],
      ['is silent',        'STRUCT_EXCLUSIONS'],
      ['not mentioned',    'CAM_EXCLUSIONS'],
      ['no mention',       'TAX_ALLOCATION'],
      ['not specified',    'STRUCT_EXCLUSIONS'],
      ['not found in',     'CAM_EXCLUSIONS'],
      ['no provision',     'TAX_ALLOCATION'],
      ['does not contain', 'STRUCT_EXCLUSIONS'],
      ['no language',      'CAM_EXCLUSIONS'],
    ];
    silencePhrases.forEach(([phrase, check], i) => {
      const raw = JSON.stringify({ findings: [{
        check, severity: 'warning', confidence: 'medium',
        finding: `The lease ${phrase} this item.`, quote: null, section: null, page: null, explanation: null,
      }] });
      const f = parseValidationFindings(raw);
      assert(`VL-7.${i+1}: "${phrase}" → severity coerced to unconfirmed`, f[0].severity === 'unconfirmed');
      assert(`VL-7.${i+1}b: "${phrase}" is NOT reported as a pass`, f[0].severity !== 'info');
      assert(`VL-8.${i+1}: "${phrase}" → confidence coerced to high`, f[0].confidence === 'high');
    });
  }

  // ── Source field ──────────────────────────────────────────────────────────

  console.log('\n[Source field]');
  {
    const raw = JSON.stringify({ findings: [{
      check: 'TAX_ALLOCATION', severity: 'info', confidence: 'high',
      finding: 'Property taxes billed separately — consistent with NNN structure.',
      quote: null, section: null, page: null, explanation: null,
    }] });
    const f = parseValidationFindings(raw);
    assert('VL-9:  source is lease_ai on all Tier 2 findings', f[0].source === 'lease_ai');
  }

  // ── Required fields on every finding ─────────────────────────────────────

  console.log('\n[Required fields on every finding]');
  {
    const raw = JSON.stringify({ findings: [{
      check: 'STRUCT_EXCLUSIONS', severity: 'info', confidence: 'high',
      finding: 'No structural items found.', quote: null, section: null, page: null, explanation: null,
    }] });
    const f = parseValidationFindings(raw);
    assert('VL-10: check present',       typeof f[0].check === 'string');
    assert('VL-11: source present',      typeof f[0].source === 'string');
    assert('VL-12: severity present',    typeof f[0].severity === 'string');
    assert('VL-13: confidence present',  typeof f[0].confidence === 'string');
    assert('VL-14: finding present',     typeof f[0].finding === 'string');
    assert('VL-15: explanation present', 'explanation' in f[0]);
  }

  // ── Malformed Claude JSON ─────────────────────────────────────────────────

  console.log('\n[Malformed Claude JSON]');
  {
    assert('VL-16: non-JSON text → empty array',      parseValidationFindings('I cannot answer.').length === 0);
    assert('VL-17: partial JSON → empty array',       parseValidationFindings('{ findings: [').length === 0);
    assert('VL-18: empty string → empty array',       parseValidationFindings('').length === 0);
    assert('VL-19: non-array findings → empty array', parseValidationFindings(JSON.stringify({ findings: 'bad' })).length === 0);
  }

  // ── Empty findings array ──────────────────────────────────────────────────

  console.log('\n[Empty findings array]');
  {
    assert('VL-20: empty findings → empty output', parseValidationFindings(JSON.stringify({ findings: [] })).length === 0);
  }

  // ── Unknown check IDs filtered ────────────────────────────────────────────

  console.log('\n[Unknown check IDs filtered out]');
  {
    const raw = JSON.stringify({ findings: [
      { check: 'INVENTED_CHECK', severity: 'critical', confidence: 'high', finding: 'x', quote: 'q', section: 'S1', page: 1, explanation: null },
      { check: 'CAM_EXCLUSIONS', severity: 'info', confidence: 'high', finding: 'y', quote: null, section: null, page: null, explanation: null },
    ] });
    const f = parseValidationFindings(raw);
    assert('VL-21: unknown check filtered out', f.length === 1);
    assert('VL-22: known check preserved',      f[0].check === 'CAM_EXCLUSIONS');
  }

  // ── Severity and confidence normalization ─────────────────────────────────

  console.log('\n[Severity and confidence normalization]');
  {
    const raw = JSON.stringify({ findings: [
      { check: 'CAM_EXCLUSIONS',    severity: 'Critical', confidence: 'High', finding: 'x', quote: 'q', section: 'S1', page: 1, explanation: null },
      { check: 'STRUCT_EXCLUSIONS', severity: 'INVALID',  confidence: 'UNKNOWN', finding: 'y', quote: null, section: null, page: null, explanation: null },
    ] });
    const f = parseValidationFindings(raw);
    assert('VL-23: severity normalized to lowercase',     f[0].severity === 'critical');
    assert('VL-24: confidence normalized to lowercase',   f[0].confidence === 'high');
    // Fails safe, not open: an unrecognised verdict has confirmed nothing, so it
    // must never render as the affirmative green PASSED.
    assert('VL-25: unknown severity coerced to unconfirmed', f[1].severity === 'unconfirmed');
    assert('VL-25b: unknown severity is never reported as a pass', f[1].severity !== 'info');
    assert('VL-26: unknown confidence coerced to medium', f[1].confidence === 'medium');
  }

  // ── Page normalization ────────────────────────────────────────────────────

  console.log('\n[Page normalization]');
  {
    const raw = JSON.stringify({ findings: [
      { check: 'TAX_ALLOCATION',   severity: 'info', confidence: 'high', finding: 'ok', quote: null, section: null, page: 7.9,     explanation: null },
      { check: 'CAM_EXCLUSIONS',   severity: 'info', confidence: 'high', finding: 'ok', quote: null, section: null, page: 'twelve', explanation: null },
      { check: 'STRUCT_EXCLUSIONS',severity: 'info', confidence: 'high', finding: 'ok', quote: null, section: null, page: null,     explanation: null },
    ] });
    const f = parseValidationFindings(raw);
    assert('VL-27: float page floored to integer', f[0].page === 7);
    assert('VL-28: string page → null',            f[1].page === null);
    assert('VL-29: null page preserved',           f[2].page === null);
  }

  // ── Constants ─────────────────────────────────────────────────────────────

  console.log('\n[Constants]');
  {
    assert('VL-30: VALIDATION_MODEL is claude-sonnet-4-6', VALIDATION_MODEL === 'claude-sonnet-4-6');
    assert('VL-31: MAX_LEASE_TEXT is 300000',               MAX_LEASE_TEXT === 300000);
    assert('VL-32: VALIDATION_TIMEOUT is 45000',            VALIDATION_TIMEOUT === 45000);
  }

  // ── Tier 1: MGMT_FEE_CAP within cap ──────────────────────────────────────

  console.log('\n[Tier 1 — MGMT_FEE_CAP: within cap]');
  {
    const tenant = {
      admin_fee_pct: 15,
      fieldEvidence: { admin_fee_pct: { snapshots: [{ quote: 'fees shall not exceed 15% of annual CAM' }] } },
    };
    const f  = _tier1LeaseChecks({ tenant, totalExpenses: 48320, lineItems: [{ category: 'Administrative Fee', amount: 4832 }] });
    const fc = f.find(x => x.check === 'MGMT_FEE_CAP');
    assert('VL-33: within cap → info',              fc.severity   === 'info');
    assert('VL-34: confidence is high',              fc.confidence === 'high');
    assert('VL-35: source is deterministic',         fc.source     === 'deterministic');
    assert('VL-36: stored quote propagated',         fc.quote      !== null);
    assert('VL-37: explanation is null when passing',fc.explanation === null);
  }

  // ── Tier 1: MGMT_FEE_CAP exceeded ────────────────────────────────────────

  console.log('\n[Tier 1 — MGMT_FEE_CAP: cap exceeded]');
  {
    const tenant = { admin_fee_pct: 10 };
    // 9664 / 48320 = 20% — well above 10% cap
    const f  = _tier1LeaseChecks({ tenant, totalExpenses: 48320, lineItems: [{ category: 'Management Fee', amount: 9664 }] });
    const fc = f.find(x => x.check === 'MGMT_FEE_CAP');
    assert('VL-38: cap exceeded → warning',        fc.severity   === 'warning');
    assert('VL-39: confidence stays high',          fc.confidence === 'high');
    assert('VL-40: explanation provided',           fc.explanation !== null);
    assert('VL-41: finding text mentions exceeded', fc.finding.includes('exceeds'));
  }

  // ── Tier 1: MGMT_FEE_CAP rounding tolerance (0.5%) ───────────────────────

  console.log('\n[Tier 1 — MGMT_FEE_CAP: rounding tolerance]');
  {
    // 10.3% vs 10% cap — within 0.5% tolerance → should be info, not warning
    const tenant = { admin_fee_pct: 10 };
    const f  = _tier1LeaseChecks({ tenant, totalExpenses: 100000, lineItems: [{ category: 'Administrative Fee', amount: 10300 }] });
    const fc = f.find(x => x.check === 'MGMT_FEE_CAP');
    assert('VL-42: 0.3% overage within tolerance → info', fc.severity === 'info');
  }

  // ── Tier 1: MGMT_FEE_CAP no cap extracted ────────────────────────────────

  console.log('\n[Tier 1 — MGMT_FEE_CAP: no cap extracted]');
  {
    const tenant = { admin_fee_pct: null };
    const f  = _tier1LeaseChecks({ tenant, totalExpenses: 48320, lineItems: [{ category: 'Administrative Fee', amount: 4832 }] });
    const fc = f.find(x => x.check === 'MGMT_FEE_CAP');
    assert('VL-43: no cap extracted → info',   fc.severity   === 'info');
    assert('VL-44: confidence is high',         fc.confidence === 'high');
  }

  // ── Tier 1: MGMT_FEE_CAP no matching line items ──────────────────────────

  console.log('\n[Tier 1 — MGMT_FEE_CAP: no admin line items]');
  {
    const tenant = { admin_fee_pct: 15 };
    const f  = _tier1LeaseChecks({ tenant, totalExpenses: 48320, lineItems: [{ category: 'Landscaping', amount: 5000 }] });
    const fc = f.find(x => x.check === 'MGMT_FEE_CAP');
    assert('VL-45: no admin lines → info',    fc.severity === 'info');
    assert('VL-46: finding explains absence', fc.finding.toLowerCase().includes('no administrative'));
  }

  // ── Tier 1: AUDIT_RIGHTS window open ─────────────────────────────────────

  console.log('\n[Tier 1 — AUDIT_RIGHTS: window open]');
  {
    const reconDate = new Date();
    reconDate.setDate(reconDate.getDate() - 30);  // 30 days ago
    const tenant = { audit_rights: '180 days after delivery of annual statement' };
    const f  = _tier1LeaseChecks({ tenant, reconciledAt: reconDate.toISOString(), today: new Date() });
    const fa = f.find(x => x.check === 'AUDIT_RIGHTS');
    assert('VL-47: window open → info',      fa.severity   === 'info');
    assert('VL-48: confidence is high',       fa.confidence === 'high');
    assert('VL-49: explanation is null',      fa.explanation === null);
  }

  // ── Tier 1: AUDIT_RIGHTS window expired ──────────────────────────────────

  console.log('\n[Tier 1 — AUDIT_RIGHTS: window expired]');
  {
    const reconDate = new Date();
    reconDate.setDate(reconDate.getDate() - 200);  // 200 days ago, past 180-day window
    const tenant = { audit_rights: '180 days' };
    const f  = _tier1LeaseChecks({ tenant, reconciledAt: reconDate.toISOString(), today: new Date() });
    const fa = f.find(x => x.check === 'AUDIT_RIGHTS');
    assert('VL-50: window expired → warning', fa.severity   === 'warning');
    assert('VL-51: confidence is high',        fa.confidence === 'high');
    assert('VL-52: explanation provided',      fa.explanation !== null);
  }

  // ── Tier 1: AUDIT_RIGHTS no audit text ───────────────────────────────────

  console.log('\n[Tier 1 — AUDIT_RIGHTS: no audit text]');
  {
    const f  = _tier1LeaseChecks({ tenant: {} });
    const fa = f.find(x => x.check === 'AUDIT_RIGHTS');
    assert('VL-53: no audit text → info',  fa.severity   === 'info');
    assert('VL-54: confidence is high',     fa.confidence === 'high');
  }

  // ── Tier 1: required fields and source on all findings ───────────────────

  console.log('\n[Tier 1 — required fields and source]');
  {
    const f = _tier1LeaseChecks({ tenant: { admin_fee_pct: 15 }, totalExpenses: 1000, lineItems: [] });
    const REQUIRED = ['check', 'source', 'severity', 'confidence', 'finding', 'explanation'];
    f.forEach(finding => {
      REQUIRED.forEach(field => {
        assert(`VL-55: ${finding.check}.${field} present`, field in finding);
      });
      assert(`VL-56: ${finding.check}.source is deterministic`, finding.source === 'deterministic');
    });
  }

  // ── Missing lease text (handler-level, simulated) ────────────────────────

  console.log('\n[Missing lease text]');
  {
    // Simulate what parseValidationFindings returns when called with no content
    const result = parseValidationFindings('');
    assert('VL-57: empty raw → empty findings array', Array.isArray(result) && result.length === 0);
  }

  // ── Summary ───────────────────────────────────────────────────────────────

  console.log('\n' + '='.repeat(60));
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log('='.repeat(60) + '\n');

  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
