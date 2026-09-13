'use strict';
/**
 * test-audit-consistency.js — the audit summary must not contradict itself.
 *
 * Each block here corresponds to a specific contradiction found by tracing the
 * Test 2 reconciliation, and asserts the property that makes it unrepresentable
 * rather than merely absent from one screenshot.
 *
 * THE CONTRADICTIONS
 *  A. "5 critical exceptions" beside "no at-risk amounts identified". The count
 *     came from the red-flag array; the exposure string came from three
 *     unrelated inputs (undocumented invoices, disputes, cap savings). Red flags
 *     carried no money, so four expired leases summed to nothing.
 *  B. Lender Summary 100/100 on the same reconciliation, because its health
 *     score never saw the findings either.
 *  C. "PASSED" on "No management fee cap was extracted from the lease" —
 *     absence of evidence rendered as confirmation.
 *  D. 22.25% on the tenant card vs 18.54% quoted from the lease, with nothing
 *     comparing them.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pass = 0, fail = 0;
const ok  = (m) => { console.log('  \x1b[32m✓\x1b[0m ' + m); pass++; };
const bad = (m, d) => { console.log('  \x1b[31m✗\x1b[0m ' + m + (d ? ' — ' + d : '')); fail++; };
const eq  = (l, a, e) => a === e ? ok(`${l} → ${a}`) : bad(l, `expected ${e}, got ${a}`);

const AX = require('./audit-exposure.js');

// reconciliation-engine.js is a browser module; load it the way the page does.
// The real lease-period module, loaded rather than stubbed: the engine now
// reads its interval classification instead of re-deriving a date rule, and a
// stub here would let this sandbox agree with an engine that had drifted.
const sandbox = { window: { LeasePeriod: require('./lease-period.js') }, console, module: {}, Date, Math, Number, String, Array, JSON, isFinite, parseFloat };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'reconciliation-engine.js'), 'utf8'),
                sandbox, { filename: 'reconciliation-engine.js' });
const RE = sandbox.window.ReconciliationEngine;

// ── A. The exposure contradiction ───────────────────────────────────────────
console.log('\n── A · Red flags must carry money into the exposure total ──');
{
  // The Test 2 shape: every invoice documented, no disputes, no caps — so the
  // three legacy inputs are all zero — plus expired leases with real dollars.
  const findings = {
    red: [
      { severity: 'red', title: 'Expired lease A', impact: { amount: 12000, kind: 'at_risk' } },
      { severity: 'red', title: 'Expired lease B', impact: { amount: 8000,  kind: 'at_risk' } },
      { severity: 'red', title: 'Expired lease C', impact: { amount: 5000,  kind: 'at_risk' } },
      { severity: 'red', title: 'Expired lease D', impact: { amount: 3000,  kind: 'at_risk' } },
      { severity: 'red', title: 'Oversized invoice' }, // no amount priced yet
    ],
    yellow: [{ severity: 'yellow', title: 'Pro-rata conflict', impact: { amount: 1500, kind: 'under_review' } }],
    green: [{ severity: 'green', title: '13/13 invoices documented' }],
  };
  const x = AX.deriveExposure(findings, 71950);

  eq('confirmed at risk sums the red findings', x.confirmedAtRisk, 28000);
  eq('requiring review is kept separate from at-risk', x.requiringReview, 1500);
  eq('the unpriced red flag is counted as unquantified', x.unquantified, 1);
  eq('red count', x.counts.red, 5);

  const line = AX.describeExposure(x);
  !/no at-risk amounts identified/.test(line)
    ? ok('the exposure line cannot say "no at-risk amounts identified" here')
    : bad('THE ORIGINAL CONTRADICTION IS BACK', line);
  /28,000/.test(line) ? ok('it states the at-risk figure') : bad('at-risk figure missing', line);
  /not yet quantified/.test(line)
    ? ok('and says one finding is unpriced rather than implying zero')
    : bad('the unpriced finding is silently treated as zero', line);
}

console.log('\n── A2 · "No at-risk amounts" is reachable ONLY when truly clean ──');
{
  const clean = AX.deriveExposure({ red: [], yellow: [], green: [{ severity: 'green', title: 'ok' }] }, 71950);
  /no at-risk amounts identified/.test(AX.describeExposure(clean))
    ? ok('a genuinely clean reconciliation still says so')
    : bad('the clean case lost its plain-language summary', AX.describeExposure(clean));

  // One unpriced yellow must be enough to withhold the reassurance.
  const murky = AX.deriveExposure({ red: [], yellow: [{ severity: 'yellow', title: 'unpriced' }], green: [] }, 71950);
  !/no at-risk amounts identified/.test(AX.describeExposure(murky))
    ? ok('an unpriced advisory finding withholds the "no at-risk" phrasing')
    : bad('an unpriced finding still reads as nothing at risk');

  // Defensive: money classified at_risk on a finding that is not red or yellow
  // is a data error somewhere upstream. The reassurance must still be withheld —
  // the failure mode to avoid is telling a manager nothing is at risk while the
  // model is holding a non-zero at-risk figure, whatever produced it.
  const inconsistent = AX.deriveExposure({
    red: [], yellow: [],
    green: [{ severity: 'green', title: 'mislabelled', impact: { amount: 4200, kind: 'at_risk' } }],
  }, 71950);
  inconsistent.confirmedAtRisk === 4200
    ? ok('at-risk money is counted regardless of which array carried it')
    : bad('at-risk money on a green finding was dropped', String(inconsistent.confirmedAtRisk));
  !/no at-risk amounts identified/.test(AX.describeExposure(inconsistent))
    ? ok('and the "no at-risk" phrasing is still withheld — fails closed')
    : bad('a non-zero at-risk total still printed "no at-risk amounts identified"');
}

// ── B. Lender Summary health score ──────────────────────────────────────────
console.log('\n── B · The health score must see the audit findings ──');
{
  const x = AX.deriveExposure({
    red: [
      { severity: 'red', title: 'e1', impact: { amount: 12000, kind: 'at_risk' } },
      { severity: 'red', title: 'e2', impact: { amount: 8000,  kind: 'at_risk' } },
      { severity: 'red', title: 'e3' }, { severity: 'red', title: 'e4' }, { severity: 'red', title: 'e5' },
    ], yellow: [], green: [],
  }, 71950);
  const h = AX.healthDeductions(x);
  h.deduction > 0
    ? ok(`five critical exceptions deduct ${h.deduction} points`)
    : bad('critical exceptions deduct nothing — 100/100 is still reachable');
  (100 - h.deduction) < 60
    ? ok(`a five-exception property cannot score 100 (scores ${100 - h.deduction})`)
    : bad('a five-exception property still scores as healthy', String(100 - h.deduction));
  h.reasons.length > 0
    ? ok('the deduction shows its working')
    : bad('the score is unexplained');

  const perfect = AX.healthDeductions(AX.deriveExposure({ red: [], yellow: [], green: [] }, 71950));
  eq('a clean property deducts nothing', perfect.deduction, 0);
}

console.log('\n── B2 · Billing readiness answers the screen\'s core question ──');
{
  const blocked = AX.billingReadiness(AX.deriveExposure({ red: [{ severity: 'red', title: 'x' }], yellow: [], green: [] }, 100));
  eq('red flags block billing', blocked.canBill, false);
  /must be resolved/.test(blocked.reason) ? ok('and say why') : bad('no reason given');

  const advisory = AX.billingReadiness(AX.deriveExposure({ red: [], yellow: [{ severity: 'yellow', title: 'y' }], green: [] }, 100));
  eq('advisory findings do not block billing', advisory.canBill, true);
  eq('but are not called "ready"', advisory.label, 'Bill with review');

  const clean = AX.billingReadiness(AX.deriveExposure({ red: [], yellow: [], green: [] }, 100));
  eq('a clean reconciliation is ready to bill', clean.label, 'Ready to bill');
}

// ── C. Verdict vocabulary ───────────────────────────────────────────────────
console.log('\n── C · "No clause found" is not "PASSED" ──');
{
  const src = fs.readFileSync(path.join(__dirname, 'script.js'), 'utf8');

  eq('NOT CONFIRMED is a distinct label', AX.VERDICT_LABEL.not_confirmed, 'NOT CONFIRMED');
  /unconfirmed: 'NOT CONFIRMED'/.test(src)
    ? ok('the panel renders it')
    : bad('the panel has no NOT CONFIRMED label');
  !/info: 'PASSED'[\s\S]{0,40}warning: 'REVIEW'/.test(src) || /unconfirmed:/.test(src)
    ? ok('the three-value severity map is gone')
    : bad('severity is still three-valued');

  // The specific findings from the report.
  const noCap = src.indexOf("No management fee cap was extracted from the lease");
  const noCapCtx = src.slice(Math.max(0, noCap - 600), noCap);
  /severity: 'unconfirmed'/.test(noCapCtx)
    ? ok('"no management fee cap extracted" is NOT CONFIRMED')
    : bad('"no management fee cap extracted" still passes');

  const noAudit = src.indexOf('Audit rights are not addressed in this lease');
  const noAuditCtx = src.slice(Math.max(0, noAudit - 400), noAudit);
  /severity: 'unconfirmed'/.test(noAuditCtx)
    ? ok('"audit rights not addressed" is NOT CONFIRMED')
    : bad('"audit rights not addressed" still passes');

  // A genuine pass must remain a pass.
  const withinCap = src.indexOf('is within the ${cap}% lease cap');
  const withinCtx = src.slice(Math.max(0, withinCap - 900), withinCap);
  /severity:\s*exceeded \? 'warning' : 'info'/.test(withinCtx)
    ? ok('a verified in-cap admin fee still reads PASSED')
    : bad('the genuine pass case was changed too');

  // Waived rights are a review item, not "not confirmed" — the distinction the
  // engine's own comment insists on.
  const waived = src.indexOf('Audit rights are explicitly waived');
  const waivedCtx = src.slice(Math.max(0, waived - 300), waived);
  /severity: 'warning'/.test(waivedCtx)
    ? ok('explicitly waived audit rights remain a REVIEW item')
    : bad('waived rights were reclassified');

  /Source: /.test(src) && /SRC_LABEL/.test(src)
    ? ok('findings render their source, so two same-titled cards are distinguishable')
    : bad('source is still never rendered');
}

// ── D. Pro-rata conflict: flag both, assert neither ─────────────────────────
console.log('\n── D · Pro-rata conflict flags both figures and asserts neither ──');
{
  const property = { tenants: [{ id: 't1', name: 'Digital River', pro_rata_share: 18.54, end_date: '2030-12-31' }] };
  const results  = [{ tenantId: 't1', name: 'Digital River', proRataPercent: 22.25, totalAllocated: 16008 }];
  const flags = RE.detectReconciliationIssues(results, property, '2026-12-31');
  const conflict = flags.find(f => /Pro-rata allocation conflict/.test(f.title));

  conflict ? ok('the conflict is detected') : bad('no pro-rata conflict raised');
  if (conflict) {
    eq('it is a review finding, not a critical exception', conflict.severity, 'yellow');
    eq('and its impact is under_review, never at_risk', conflict.impact.kind, 'under_review');

    const ev = conflict.conditions.join(' | ');
    /18\.54%/.test(ev) ? ok('states the lease-stated share') : bad('lease share missing', ev);
    /22\.25%/.test(ev) ? ok('states the computed share') : bad('computed share missing', ev);
    /3\.71 percentage points/.test(ev)
      ? ok('states the difference in percentage points') : bad('difference missing or wrong', ev);
    /may over- or under-recover/.test(ev)
      ? ok('describes the impact as either direction') : bad('impact direction asserted', ev);
    /does not assert which figure is controlling/i.test(ev)
      ? ok('explicitly declines to name a controlling figure') : bad('no such disclaimer', ev);

    // The wording must not declare a loss.
    !/over-?recover(ed|y)\b(?!.*under)/i.test(conflict.detail)
      ? ok('the detail does not declare an over-recovery')
      : bad('the finding asserts an over-recovery', conflict.detail);
    /Verify the executed lease/.test(conflict.detail)
      ? ok('and directs the manager to the executed lease') : bad('no verification instruction');

    const acts = conflict.actions || [];
    ['Review lease clause', 'Confirm allocation methodology',
     'Update tenant allocation if verified', 'Re-run reconciliation']
      .every(a => acts.includes(a))
      ? ok('all four recommended actions are present')
      : bad('recommended actions incomplete', acts.join(', '));
  }

  // Absent or equal shares must NOT raise a conflict.
  const noShare = RE.detectReconciliationIssues(
    [{ tenantId: 't1', name: 'X', proRataPercent: 22.25, totalAllocated: 100 }],
    { tenants: [{ id: 't1', name: 'X', end_date: '2030-12-31' }] }, '2026-12-31');
  !noShare.some(f => /Pro-rata allocation conflict/.test(f.title))
    ? ok('no lease-stated share ⇒ no conflict raised')
    : bad('a conflict was raised against a missing lease figure');

  const equal = RE.detectReconciliationIssues(
    [{ tenantId: 't1', name: 'X', proRataPercent: 22.25, totalAllocated: 100 }],
    { tenants: [{ id: 't1', name: 'X', pro_rata_share: 22.25, end_date: '2030-12-31' }] }, '2026-12-31');
  !equal.some(f => /Pro-rata allocation conflict/.test(f.title))
    ? ok('matching shares raise nothing')
    : bad('a conflict was raised on identical figures');

  // A 0% stated share must read as absent, not as a real 0.00% conflict.
  const zero = RE.detectReconciliationIssues(
    [{ tenantId: 't1', name: 'X', proRataPercent: 22.25, totalAllocated: 100 }],
    { tenants: [{ id: 't1', name: 'X', pro_rata_share: '', end_date: '2030-12-31' }] }, '2026-12-31');
  !zero.some(f => /Pro-rata allocation conflict/.test(f.title))
    ? ok('an empty stated share is absent, not 0%')
    : bad('an empty lease field was treated as a 0% share');
}

// ── E. Expired lease: implication, money, actions ───────────────────────────
console.log('\n── E · Expired leases state the implication and carry their money ──');
{
  const property = { tenants: [{ id: 't1', name: 'Old Tenant', end_date: '2003-06-30' }] };
  const results  = [{ tenantId: 't1', name: 'Old Tenant', totalAllocated: 12000, proRataPercent: 10 }];
  const flags = RE.detectReconciliationIssues(results, property, '2026-12-31');
  const f = flags.find(x => /2026 CAM/.test(x.title));

  f ? ok('the finding leads with the implication, not a generic label') : bad('no expired-lease finding');
  if (f) {
    /ended 2003-06-30/.test(f.title) ? ok('names the expiry in the title') : bad('expiry not in title', f.title);
    eq('it is critical', f.severity, 'red');
    eq('the allocation is carried as at-risk money', f.impact.amount, 12000);
    eq('classified at_risk', f.impact.kind, 'at_risk');
    /23 years before/.test(f.detail)
      ? ok('states how long before the billed period the lease ended')
      : bad('gap not stated', f.detail);
    ['Confirm occupancy', 'Update lease', 'Remove allocation'].every(a => (f.actions || []).includes(a))
      ? ok('offers Confirm occupancy / Update lease / Remove allocation')
      : bad('actions missing', (f.actions || []).join(', '));
    f.source ? ok('cites its source') : bad('no source');
  }

  // Not expired ⇒ nothing raised.
  const live = RE.detectReconciliationIssues(
    [{ tenantId: 't1', name: 'Current', totalAllocated: 5000 }],
    { tenants: [{ id: 't1', name: 'Current', end_date: '2030-01-01' }] }, '2026-12-31');
  !live.some(x => /CAM on a lease that ended/.test(x.title))
    ? ok('a live lease raises nothing') : bad('a current lease was flagged as expired');
}

console.log('\n' + (fail ? '\x1b[31m' : '\x1b[32m') + 'RESULT: ' + pass + ' passed, ' + fail + ' failed\x1b[0m');
process.exit(fail ? 1 : 0);
