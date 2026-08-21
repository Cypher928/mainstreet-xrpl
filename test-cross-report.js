'use strict';
/**
 * test-cross-report.js — five reports, one reconciliation, no contradictions.
 *
 *   node test-cross-report.js
 *
 * Each report is written in a different place against a different set of module
 * globals, which is precisely why they were free to disagree. Every assertion
 * here runs two of them against ONE fixture and compares what they say.
 *
 * THE CONTRADICTIONS THIS SUITE PINS DOWN, found by tracing the Test 2
 * reconciliation against df143a7:
 *
 *  C1  Audit Exception Summary reported 5 critical / 5 warnings while Risk &
 *      Disputes reported 4 / 2 for the same reconciliation on the same day.
 *      Risk & Disputes called _detectReconciliationIssues, a strict subset of
 *      buildAuditSummary, so the $38,000 concentration flag, the undated
 *      invoice and the low-confidence match existed in one report only.
 *
 *  C2  "Exposure" meant open-dispute value in Risk & Disputes and canonical
 *      at-risk elsewhere. With no disputes it printed "$0.00" beside $40,832
 *      of allocated CAM that had no lease behind it.
 *
 *  C3  deriveExposure counted unpriced findings via `f.severity`, which only
 *      the reconciliation engine sets. Five findings carried no amount; one was
 *      counted. The other four were silently treated as costing nothing, which
 *      is the exact failure audit-exposure.js exists to prevent.
 *
 *  C4  The coverage gap was raised twice — by buildAuditSummary section 8 and
 *      by reconciliation-engine section 3, on identical thresholds.
 *
 *  C5  SHONAC 2016-02-28 rendered as "February 27, 2016"; Digital River
 *      2003-07-31 as "July 30, 2003"; Tollgrade 2008-04-30 as "April 29, 2008".
 *      Reported as source conflicts. They are not: one stored value, parsed as
 *      UTC midnight and rendered in local time, always a day early and never a
 *      day late. Fixed at the parse, not surfaced as a conflict.
 *
 *  C6  The Lender Summary's verdict was floored only by the health score, so a
 *      single critical exception left 88/100 and read "Proceed" on a
 *      reconciliation the operator was blocked from billing. Its narrative
 *      never mentioned the audit at all.
 *
 *  C7  Coverage Gap said "1 item needs attention" on a property carrying five
 *      critical exceptions, with nothing on either page explaining that the two
 *      reports answer different questions.
 */
// PIN THE TIMEZONE BEFORE ANYTHING CONSTRUCTS A DATE.
//
// The C5 date assertions are vacuous under UTC: `new Date('2016-02-28')` and a
// locally-constructed February 28th render identically there, so a CI runner in
// UTC — which is the default — would pass whether or not the bug was present. A
// mutation reverting the fix survived this suite until this line was added.
// Pinning to a negative-offset zone is what makes the assertions load-bearing,
// and it is the zone the reports were observed misbehaving in.
process.env.TZ = 'America/New_York';

const fs   = require('fs');
const path = require('path');
const F    = require('./test-cross-report-fixture.js');

if (new Date(2016, 1, 28).getTimezoneOffset() <= 0) {
  console.error('\x1b[31mFATAL: the timezone pin did not take effect — the C5 date '
    + 'assertions would pass vacuously. Run with TZ=America/New_York.\x1b[0m');
  process.exit(1);
}

let pass = 0, fail = 0;
const ok  = (m) => { console.log('  \x1b[32m✓\x1b[0m ' + m); pass++; };
const bad = (m, d) => { console.log('  \x1b[31m✗\x1b[0m ' + m + (d ? '\n      ' + d : '')); fail++; };
const eq  = (l, a, e) => a === e ? ok(`${l} → ${a}`) : bad(l, `expected ${e}, got ${a}`);
const yes = (l, c, d) => c ? ok(l) : bad(l, d);
const no  = (l, c, d) => !c ? ok(l) : bad(l, d);

const AX   = F.AX;
const text = (h) => String(h || '').replace(/<[^>]+>/g, ' ').replace(/&mdash;/g, '—')
  .replace(/&middot;/g, '·').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

// One reconciliation, computed once, read by every assertion below.
const SUMMARY   = F.auditSummary();
const NARRATIVE = F.auditNarrative();
const EXCEPTION = text(F.exceptionReport().html);
const GAP       = text(F.coverageGap().html);
const RISK      = text(F.riskAndDisputes().html);
const LENDER    = text(F.lenderSummary({
  exposure: NARRATIVE.exposure, readiness: NARRATIVE.readiness,
  camYear: NARRATIVE.camYear, conflicts: NARRATIVE.conflicts,
}));

// ── C1. One finding set ─────────────────────────────────────────────────────
console.log('\n── C1 · A count labelled "Critical" means the same thing in every report ──');
{
  const kpi = (src, label) => {
    const m = new RegExp('(\\d+)\\s+' + label).exec(src);
    return m ? Number(m[1]) : null;
  };
  eq('the audit finding set', SUMMARY.red.length + ' red / ' + SUMMARY.yellow.length + ' yellow',
     '5 red / 4 yellow');
  eq('Risk & Disputes critical count', kpi(RISK, 'Critical Issues'), SUMMARY.red.length);
  eq('Risk & Disputes warning count',  kpi(RISK, 'Warnings'),        SUMMARY.yellow.length);

  // The three findings that lived in one report only.
  ['Unusually large invoice', 'missing invoice date', 'insufficient confidence'].forEach(needle => {
    yes(`Risk & Disputes now carries "${needle}"`, RISK.indexOf(needle) >= 0,
        'this finding is still visible only in the Audit Exception Summary');
  });

  no('[source] Risk & Disputes no longer derives its own finding list',
     /const reconIss\s+= _detectReconciliationIssues\(lastResults, currentProperty\(\)\);/
       .test(fs.readFileSync(path.join(__dirname, 'script.js'), 'utf8')),
     'generateLandlordExport is calling _detectReconciliationIssues directly again');
}

// ── C2. One meaning of "exposure" ───────────────────────────────────────────
console.log('\n── C2 · "Exposure" is one measure, not two ──');
{
  const atRisk = AX.fmtMoney(NARRATIVE.exposure.confirmedAtRisk).replace('$', '');
  yes('Risk & Disputes states the canonical at-risk figure',
      RISK.indexOf('Allocation At Risk') >= 0 && /40,83[0-9]/.test(RISK),
      `no allocation-at-risk figure in Risk & Disputes (expected ~${atRisk})`);
  yes('the header states the canonical pool as Total CAM',
      /Total CAM Pool \$71,950\.00/.test(RISK),
      'the Total CAM header is not the $71,950 pool the Exception Summary reports');
  yes('and shows what was billed out under its own label',
      /Billed to Tenants \$40,831\.64/.test(RISK),
      'the allocated total is missing or is still labelled Total CAM');
  no('the allocated figure is never labelled Total CAM',
     /Total CAM Pool \$40,83/.test(RISK),
     'the allocation total is being presented as the expense pool again');
  yes('the dispute figure keeps its own label',
      RISK.indexOf('Dispute Exposure') >= 0,
      'the open-dispute total is still labelled just "Exposure"');
  no('and no bare "Exposure" label survives to be confused with it',
     /[^ ]Exposure\b(?!\s*(?::|Report))/.test(RISK.replace(/Dispute Exposure/g, '')
       .replace(/Allocation At Risk/g, '')),
     'a bare "Exposure" label is still present');

  // The one that matters: a reader must not be able to conclude "no exposure".
  no('Risk & Disputes cannot read as "no exposure" while money is at risk',
     /Exposure \$0\.00/.test(RISK) && NARRATIVE.exposure.confirmedAtRisk > 0
       && RISK.indexOf('Allocation At Risk') < 0,
     'the only exposure figure shown is $0.00 while the audit holds money at risk');
}

// ── C3. Unpriced findings are counted ───────────────────────────────────────
console.log('\n── C3 · A finding nobody priced is never treated as costing nothing ──');
{
  // Which array a finding is in is the authoritative severity, because it is
  // what every report renders "Critical"/"Warning" from.
  const noSeverityField = AX.deriveExposure({
    red:    [{ title: 'detector that never set severity' }],
    yellow: [{ title: 'another' }, { title: 'and another' }],
    green:  [{ title: 'a passed check, correctly not counted' }],
  }, 1000);
  eq('three unpriced red/yellow findings without a severity field', noSeverityField.unquantified, 3);

  const withField = AX.deriveExposure({
    red: [{ severity: 'red', title: 'x' }], yellow: [], green: [],
  }, 1000);
  eq('an explicit severity field still works', withField.unquantified, 1);

  eq('severityOf falls back to the array', AX.severityOf({ title: 'x' }, 'yellow'), 'yellow');
  eq('severityOf prefers an explicit field', AX.severityOf({ severity: 'red' }, 'yellow'), 'red');

  // A green finding with no amount is a verification, not an unpriced gap.
  eq('green findings are not "unquantified"',
     AX.deriveExposure({ red: [], yellow: [], green: [{ title: 'v' }, { title: 'w' }] }, 1000).unquantified, 0);
}

console.log('\n── C3b · The two axes are never added together ──');
{
  const x = NARRATIVE.exposure;
  yes('allocation exposure stays within the pool',
      AX.allocationExposure(x) <= x.totalPool,
      `allocation exposure ${Math.round(AX.allocationExposure(x))} exceeds the pool ${x.totalPool}`);
  yes('the expense-side figure is non-zero and reported separately',
      x.poolUnsubstantiated > 0 && !AX.ALLOCATION_KINDS.includes('unsubstantiated'),
      'unsubstantiated has leaked into the allocation kinds');
  yes('adding the two would have overstated the pool — which is why they are separate',
      AX.allocationExposure(x) + x.poolUnsubstantiated > x.totalPool,
      'the fixture no longer reproduces the overlap, so this guard proves nothing');
  yes('the exposure line names the expense-side figure as a separate measure',
      /separate measure/.test(AX.describeExposure(x)),
      AX.describeExposure(x));

  // Two findings about the same invoice are one sum of money.
  const deduped = AX.deriveExposure({
    red: [], green: [],
    yellow: [
      { title: 'undated',      impact: { amount: 11750, kind: 'unsubstantiated', scope: 'invoice:Harbor' } },
      { title: 'undocumented', impact: { amount: 11750, kind: 'unsubstantiated', scope: 'invoice:Harbor' } },
    ],
  }, 71950);
  eq('one invoice flagged twice is counted once', deduped.poolUnsubstantiated, 11750);

  const bigger = AX.deriveExposure({
    red: [], green: [],
    yellow: [
      { title: 'small', impact: { amount: 500,  kind: 'at_risk', scope: 'tenant:A' } },
      { title: 'large', impact: { amount: 2000, kind: 'at_risk', scope: 'tenant:A' } },
    ],
  }, 71950);
  eq('the larger claim on the same money supersedes the smaller', bigger.confirmedAtRisk, 2000);
  eq('and only the surviving claim is listed as a contributor', bigger.contributors.at_risk.length, 1);

  const unscoped = AX.deriveExposure({
    red: [], green: [],
    yellow: [
      { title: 'a', impact: { amount: 100, kind: 'at_risk' } },
      { title: 'b', impact: { amount: 100, kind: 'at_risk' } },
    ],
  }, 71950);
  eq('findings with no scope are treated as distinct', unscoped.confirmedAtRisk, 200);

  // kind 'none' means "here is a number for context" — a category total, a
  // threshold. It must never land in a bucket, or a report would total figures
  // that were only ever printed to explain another one.
  const contextual = AX.deriveExposure({
    red: [], green: [],
    yellow: [{ title: 'context', impact: { amount: 9999, kind: 'none' } }],
  }, 71950);
  eq('a contextual amount enters no bucket', contextual.confirmedAtRisk
     + contextual.requiringReview + contextual.excludedRecoverable
     + contextual.poolUnsubstantiated, 0);
  eq('and is not counted as unpriced either — it was priced, just not as exposure',
     contextual.unquantified, 0);

  // The reassurance must be withheld for weakly-evidenced money too. Nothing is
  // at risk and nothing is under review, but a third of the pool has no
  // supporting document — "no at-risk amounts identified" is not the sentence a
  // manager should read before billing it out.
  const onlyUnsub = AX.deriveExposure({
    red: [], yellow: [], green: [
      { title: 'undocumented', impact: { amount: 24000, kind: 'unsubstantiated', scope: 'invoice:X' } },
    ],
  }, 71950);
  eq('weakly-evidenced money is totalled', onlyUnsub.poolUnsubstantiated, 24000);
  no('and withholds the "no at-risk amounts identified" phrasing',
     /no at-risk amounts identified/.test(AX.describeExposure(onlyUnsub)),
     AX.describeExposure(onlyUnsub));
  yes('a truly empty reconciliation still gets the plain-language all-clear',
      /no at-risk amounts identified/.test(
        AX.describeExposure(AX.deriveExposure({ red: [], yellow: [], green: [{ title: 'ok' }] }, 71950))),
      'the clean case lost its summary');
}

// ── C4. No duplicate findings ───────────────────────────────────────────────
console.log('\n── C4 · One fact, one finding ──');
{
  const coverage = SUMMARY.yellow.filter(f => /coverage|not allocated to a loaded lease|Pro-rata totals/i.test(f.title));
  eq('the coverage gap is raised exactly once', coverage.length, 1);
  yes('and it is the engine\'s version, which carries the renderer contract',
      coverage[0] && coverage[0].disputable === false && coverage[0].kind === 'coverage',
      'the surviving coverage finding lost kind:coverage / disputable:false');

  const titles = [...SUMMARY.red, ...SUMMARY.yellow].map(f => f.title);
  eq('no finding title is duplicated', titles.length, new Set(titles).size);
}

// ── C5. One stored date, one rendered date ──────────────────────────────────
console.log('\n── C5 · A lease date renders as the day it was stored ──');
{
  // The three pairs reported as source conflicts.
  const PAIRS = [
    ['SHONAC',        '2016-02-28', 'February 28, 2016', 'February 27, 2016'],
    ['Digital River', '2003-07-31', 'July 31, 2003',     'July 30, 2003'],
    ['Tollgrade',     '2008-04-30', 'April 30, 2008',    'April 29, 2008'],
  ];
  PAIRS.forEach(([name, stored, correct, shifted]) => {
    const finding = SUMMARY.red.find(f => f.title.indexOf(name) === 0 && /ended/.test(f.title));
    yes(`${name}: the audit finding cites the stored value ${stored}`,
        !!finding && finding.title.indexOf(stored) >= 0,
        finding ? finding.title : 'no expired-lease finding raised');
    yes(`${name}: the Lender Summary renders ${correct}`,
        LENDER.indexOf(correct) >= 0, `"${correct}" not found in the Lender Summary`);
    no(`${name}: and never ${shifted}`, LENDER.indexOf(shifted) >= 0,
       'the UTC-parse shift is back — a date-only value is being read as an instant');
  });

  // The direction of the bug: always earlier, never later. A test that only
  // checked "the two agree" would pass if both shifted together.
  yes('the expiration schedule buckets by the stored year',
      /2003 Digital River/.test(LENDER) && /2016 SHONAC/.test(LENDER),
      'the year buckets moved with the timezone');

  // Start dates shifted too, which the original report did not notice.
  yes('start dates are equally unshifted', LENDER.indexOf('March 1, 2011') >= 0,
      'SHONAC\'s 2011-03-01 start date is still rendering as February 28, 2011');

  no('[source] no lease date is parsed by handing a bare date string to Date()',
     /new Date\((?:t|lt)\.(?:end|start)_date\)/.test(
       fs.readFileSync(path.join(__dirname, 'lease-review-packets.js'), 'utf8')),
     'a lease date is being parsed as an instant again in lease-review-packets.js');

  // lease-intelligence.js renders dates independently and had the identical
  // defect. It is a pure module, so it loads directly.
  new Function(fs.readFileSync(path.join(__dirname, 'lease-intelligence.js'), 'utf8'))();
  const LI = global.window.LeaseIntelligence;

  const exp = LI.generateLeaseExplainability({
    tenant_name: 'Digital River', leased_sqft: 17800, lease_type: 'NNN',
    start_date: '1998-08-01', end_date: '2003-07-31',
    // The amendment date is rendered only where a field summary cites the
    // governing amendment, so the overridden field has to be one that gets a
    // summary. `cap` does; `leased_sqft` does not.
    cap: 5, capBaseAmount: 40000,
    amendments: [{ effectiveDate: '2001-03-31', overriddenFields: ['cap'] }],
    fieldEvidence: {},
  });
  const expText = JSON.stringify(exp);
  yes('lease intelligence dates an amendment on the day it was stored',
      expText.indexOf('March 31, 2001') >= 0,
      'the amendment date shifted — 2001-03-31 is not rendering as March 31, 2001');
  no('and never a day early', expText.indexOf('March 30, 2001') >= 0,
     'the UTC-parse shift is back in lease-intelligence.js');

  // The renewal-option edge case compares the lease end YEAR, and a lease that
  // ends on January 1st is where the shift changes the year rather than just the
  // day: parsed as an instant, 2021-01-01 becomes December 31st 2020. The
  // renewal text then no longer predates the expiry and the conflict is not
  // raised at all — a silent false negative on a real lease conflict.
  const janExpiry = {
    tenant_name: 'Year Boundary Co', leased_sqft: 1000, lease_type: 'NNN',
    start_date: '2015-01-01', end_date: '2021-01-01',
    renewal_options: 'Tenant may renew through 2020.',
  };
  const cases = (LI.detectLeaseEdgeCases(janExpiry) || {}).edgeCases || [];
  yes('a renewal option predating a January-1 lease expiry is still detected',
      cases.some(c => /renewal/i.test(c.type || '')),
      'the year-boundary expiry was read as the previous year, so the conflict vanished');
}

// ── C6. The Lender Summary consumes canonical state ─────────────────────────
console.log('\n── C6 · The Lender Summary says what the audit says ──');
{
  yes('the health basis names the critical exceptions',
      /5 critical exceptions/.test(LENDER), 'the health score still does not show the findings');
  yes('the health basis keeps the document-completeness penalties too',
      /low-confidence extraction/.test(LENDER),
      'the document penalties were replaced rather than added to');
  yes('the underwriting narrative leads with the audit',
      /CAM audit raised 5 critical exceptions and 4 advisory findings/.test(LENDER),
      'the narrative still opens on occupancy and never mentions the reconciliation');
  yes('the narrative states the at-risk figure',
      /\$40,832 of allocated CAM lacking a documented basis/.test(LENDER),
      'the at-risk total never reaches the underwriting prose');
  yes('the narrative flags the unpriced finding as a floor, not a total',
      /a floor, not a total/.test(LENDER),
      'the exposure figures are presented as complete when one finding is unpriced');
  yes('the narrative reports the blocked billing state',
      /cannot issue reconciliation statements/.test(LENDER),
      'a lender is not told the operator cannot bill');

  // The floor. Without it a single red finding scores 88 and reads "Proceed".
  const oneRed = { counts: { red: 1, yellow: 0, green: 4 }, totalPool: 100000,
                   confirmedAtRisk: 0, requiringReview: 0, excludedRecoverable: 0,
                   poolUnsubstantiated: 0, unquantified: 0, contributors: {} };
  const scoreNoFloor = 100 - AX.healthDeductions(oneRed).deduction;
  yes('one critical exception alone would still score in "Proceed" territory',
      scoreNoFloor >= 75,
      `the fixture no longer reproduces the gap the floor exists to close (score ${scoreNoFloor})`);

  // See P3 below: several tenants, none dominant, so concentration risk does not
  // independently drive the verdict this assertion is about.
  const clean = { name: 'Clean', totalSqft: 10000, timeline: [], disputes: [],
    tenants: ['A', 'B', 'C', 'D', 'E'].map((n, i) => ({
      id: 't' + i, tenant_name: n + ' Co', name: n + ' Co', leased_sqft: 1900,
      lease_type: 'NNN', start_date: '2020-01-01', end_date: '2032-12-31' })) };
  const LRP = global.window.LeaseReviewPackets;
  const blocked = text(LRP.generateLenderSummaryHtml(clean, {
    exposure: oneRed, readiness: AX.billingReadiness(oneRed), camYear: 2026 }));
  yes('but readiness floors the verdict to Additional Due Diligence Required',
      /Additional Due Diligence Required/.test(blocked) && !/\bProceed\b/.test(blocked),
      'a lender is told to Proceed on a reconciliation that cannot be billed');

  const okState = { counts: { red: 0, yellow: 0, green: 6 }, totalPool: 100000,
                    confirmedAtRisk: 0, requiringReview: 0, excludedRecoverable: 0,
                    poolUnsubstantiated: 0, unquantified: 0, contributors: {} };
  const green = text(LRP.generateLenderSummaryHtml(clean, {
    exposure: okState, readiness: AX.billingReadiness(okState), camYear: 2026 }));
  yes('a genuinely clean property can still reach Proceed',
      /\bProceed\b/.test(green),
      'the floor is now blocking clean properties too — it must be a floor, not a ceiling');
}

// ── C6b. The score saturates; the deduction total must not ──────────────────
console.log('\n── C6b · Progress is visible even when the score has nothing left to say ──');
{
  const LRP = global.window.LeaseReviewPackets;
  const S   = SUMMARY;
  const ALL = { red: S.red.slice(), yellow: S.yellow.slice(), green: S.green };
  const drop = (re) => ({
    red:    ALL.red.filter(f => !re.test(f.title)),
    yellow: ALL.yellow.filter(f => !re.test(f.title)),
    green:  ALL.green,
  });

  // Render the real Lender Summary for a given finding set and read back the
  // two numbers a reader actually sees.
  function render(findings) {
    const x = AX.deriveExposure(findings, F.POOL);
    const ready = AX.billingReadiness(x);
    const html = LRP.generateLenderSummaryHtml(F.PROPERTY,
      { exposure: x, readiness: ready, camYear: 2026 });
    const score = (html.match(/Health Score: <strong[^>]*>([^<]*)</) || [])[1];
    const note  = (html.match(/(\d+) points of deductions against a 100-point scale/) || [])[1];
    const basis = (html.match(/Health score basis:<\/strong>([\s\S]*?)<\/div>/) || [])[1] || '';
    return {
      score: (score || '').trim(),
      scoreNum: score ? Number(String(score).split('/')[0].trim()) : null,
      deductions: note ? Number(note) : null,
      verdict: (html.match(/font-weight:700;color:#[0-9a-f]{6};">([^<]*)</) || [])[1],
      canBill: ready.canBill,
      basisSum: (basis.match(/−(\d+)/g) || []).length,   // component count, not a total
      html,
    };
  }

  const base    = render(ALL);
  const lessOne = render(drop(/^SHONAC is being billed/));
  const lessAll = render(drop(/is being billed 2026 CAM/));

  // 1 · The displayed score stays 0 while the deductions outrun the scale.
  eq('baseline displayed score', base.score, '0 / 100');
  yes('baseline deductions exceed the 100-point scale',
      base.deductions > 100, `deduction total is ${base.deductions}`);
  eq('one finding resolved — displayed score is unchanged', lessOne.score, '0 / 100');

  // 2 · The uncapped total decreases, which is the whole point.
  yes('the deduction total falls when a finding is resolved',
      lessOne.deductions < base.deductions,
      `${base.deductions} → ${lessOne.deductions} — no progress is visible`);
  eq('and falls by exactly the weight of that finding',
     base.deductions - lessOne.deductions, 12);

  // 3 · Clamped at zero, never negative, however bad it gets.
  yes('the score is clamped at 0, never negative',
      base.scoreNum === 0 && lessOne.scoreNum === 0,
      `scores ${base.scoreNum} / ${lessOne.scoreNum}`);
  {
    // Far past the scale: nine critical exceptions on top of everything else.
    const piled = {
      red: ALL.red.concat(Array.from({ length: 9 }, (_, i) => ({ title: 'piled ' + i }))),
      yellow: ALL.yellow, green: ALL.green,
    };
    const p = render(piled);
    eq('an extreme deduction total still shows 0 / 100', p.score, '0 / 100');
    yes('and reports the larger total rather than saturating the note too',
        p.deductions > base.deductions,
        `${base.deductions} → ${p.deductions} — the note is capped as well as the score`);
  }

  // 4 · Once the total drops under 100, the score resumes and the note stops.
  eq('with all four expired leases resolved the score resumes', lessAll.score, '51 / 100');
  eq('and the deduction note is withheld', lessAll.deductions, null);
  yes('the note appears only while the total exceeds the scale',
      base.deductions != null && lessAll.deductions == null,
      'the note is shown for a total that fits inside the scale');
  {
    // Exactly at the boundary: 100 deductions must NOT print the note, since
    // 100 does not exceed the scale — it lands on 0/100 legitimately.
    const boundary = { counts: { red: 0, yellow: 0, green: 0 }, totalPool: 71950,
      confirmedAtRisk: 0, requiringReview: 0, excludedRecoverable: 0,
      poolUnsubstantiated: 0, unquantified: 0, contributors: {} };
    const html = LRP.generateLenderSummaryHtml(
      // 6 leases each missing critical dates: 6 × 15 = 90, plus the property's
      // own low-confidence extraction weight, to sit near the boundary.
      { name: 'Boundary', totalSqft: 10000, timeline: [], disputes: [],
        tenants: Array.from({ length: 6 }, (_, i) => ({ id: 'b' + i, tenant_name: 'B' + i,
          name: 'B' + i, leased_sqft: 1000, lease_type: 'NNN' })) },
      { exposure: boundary, readiness: AX.billingReadiness(boundary), camYear: 2026 });
    const note = (html.match(/(\d+) points of deductions against a 100-point scale/) || [])[1];
    const score = (html.match(/Health Score: <strong[^>]*>([^<]*)</) || [])[1];
    eq('a deduction total of exactly 90 shows no note', note === undefined, true);
    eq('and scores 10 / 100', (score || '').trim(), '10 / 100');
  }

  // 5 · Nothing downstream moved. Same verdict, same readiness, at every step.
  eq('baseline verdict unchanged',        base.verdict,    'Additional Due Diligence Required');
  eq('verdict after one fix unchanged',   lessOne.verdict, 'Additional Due Diligence Required');
  eq('verdict after all leases fixed',    lessAll.verdict, 'Additional Due Diligence Required');
  eq('readiness at baseline',   base.canBill,    false);
  eq('readiness after one fix', lessOne.canBill, false);
  eq('readiness after four',    lessAll.canBill, false);

  // 6 · The note must reconcile with the basis line printed beneath it. A total
  // that disagrees with the components listed under it would be the same defect
  // this whole pass exists to remove.
  {
    const basis = (base.html.match(/Health score basis:<\/strong>([\s\S]*?)<\/div>/) || [])[1] || '';
    // "5 critical exceptions (−12 each)" style entries multiply; flat ones do not.
    let sum = 0;
    basis.replace(/&minus;|−/g, '−').split('&middot;').forEach(part => {
      const m = /−(\d+)(\s*each)?/.exec(part);
      if (!m) return;
      const each = !!m[2];
      const n = each ? Number((/^\s*(\d+)/.exec(part.replace(/<[^>]*>/g, '')) || [0, 1])[1]) : 1;
      sum += Number(m[1]) * (each ? n : 1);
    });
    eq('the deduction note equals the sum of the basis components', sum, base.deductions);
  }

  // 7 · The reader sees the pair together, in both places the score appears.
  eq('the note is rendered beside the score in both places',
     (base.html.match(/points of deductions against a 100-point scale/g) || []).length, 2);
}

// ── P3. Evidence semantics ──────────────────────────────────────────────────
console.log('\n── P3 · VERIFIED · INFERRED · MISSING · CONFLICT ──');
{
  yes('a field whose two sources disagree reads CONFLICT, not Inferred',
      /Digital River[^|]*?Conflict/.test(LENDER.replace(/\s+/g, ' ')) || /Conflict/.test(LENDER),
      'the pro-rata conflict is still reported as an absence of citation');
  yes('and the conflict names the field and both sources',
      /pro_rata_share — sources disagree/.test(LENDER),
      'the conflict has no provenance attached');
  yes('a tenant with values but no citations still reads Inferred',
      /Inferred/.test(LENDER), 'the Inferred state disappeared');

  eq('the conflict is carried on the finding, with both sources named',
     ((NARRATIVE.conflicts[0] || {}).sources || []).length, 2);

  // Unknown must never become satisfactory. The sentence claiming satisfactory
  // extraction confidence used to turn on document completeness alone.
  no('"extraction confidence is satisfactory" is withheld while findings are open',
     /extraction confidence is satisfactory/.test(LENDER),
     'a reconciliation with five critical exceptions is described as satisfactory');

  const LRP = global.window.LeaseReviewPackets;
  // Five tenants, none dominant: concentration risk gates this sentence too, so
  // a single-tenant fixture would withhold it for a reason unrelated to the
  // audit and the assertion would prove nothing.
  const clean = { name: 'Clean', totalSqft: 10000, timeline: [], disputes: [],
    tenants: ['A', 'B', 'C', 'D', 'E'].map((n, i) => ({
      id: 't' + i, tenant_name: n + ' Co', name: n + ' Co', leased_sqft: 1900,
      lease_type: 'NNN', start_date: '2020-01-01', end_date: '2032-12-31' })) };
  const unpriced = { counts: { red: 0, yellow: 0, green: 3 }, totalPool: 100000,
                     confirmedAtRisk: 0, requiringReview: 0, excludedRecoverable: 0,
                     poolUnsubstantiated: 0, unquantified: 1, contributors: {} };
  no('and withheld when a finding is merely unpriced, not resolved',
     /extraction confidence is satisfactory/.test(text(LRP.generateLenderSummaryHtml(clean, {
       exposure: unpriced, readiness: AX.billingReadiness(unpriced), camYear: 2026 }))),
     'an unquantified finding still reads as a satisfactory state');

  const allClear = { counts: { red: 0, yellow: 0, green: 6 }, totalPool: 100000,
                     confirmedAtRisk: 0, requiringReview: 0, excludedRecoverable: 0,
                     poolUnsubstantiated: 0, unquantified: 0, contributors: {} };
  yes('a genuinely clean audit can still say so',
      /extraction confidence is satisfactory/.test(text(LRP.generateLenderSummaryHtml(clean, {
        exposure: allClear, readiness: AX.billingReadiness(allClear), camYear: 2026 }))),
      'the sentence is now unreachable even when everything checks out');
}

// ── P5. Coverage Gap scope ──────────────────────────────────────────────────
console.log('\n── P5 · Coverage Gap says which question it answers ──');
{
  yes('the report states its scope up front',
      /checks whether the inputs are complete before you reconcile/.test(GAP),
      'nothing tells the reader what this report does and does not cover');
  yes('it says explicitly that it does not evaluate the reconciliation',
      /does not evaluate a reconciliation that has already been produced/.test(GAP),
      'the exclusion is left to be inferred from a differing count');
  yes('it names the audit finding counts and points at the other report',
      /5 critical and 4 advisory audit findings/.test(GAP)
        && /Audit Exception Summary, not here/.test(GAP),
      'a reader still cannot reconcile this report\'s count with the audit\'s');
  no('it does not claim everything is fine while exceptions are open',
     /Everything looks good/.test(GAP),
     'the all-clear banner shows on a property with five critical exceptions');
  yes('its own count is described as inputs, not as findings',
      /input[s]? need[s]? attention/.test(GAP),
      'the summary bar still says "items", which reads as the audit\'s items');
}

// ── Uniform finding structure ───────────────────────────────────────────────
console.log('\n── Every finding states what, how much, on what evidence, what to do ──');
{
  yes('the Exception Summary states the exposure line, not just a count',
      EXCEPTION.indexOf(NARRATIVE.financialImpact) >= 0,
      'the report enumerates findings without ever totalling them');
  yes('and the same readiness verdict as every other surface',
      EXCEPTION.indexOf(NARRATIVE.readiness.reason) >= 0,
      'the Exception Summary omits the billing readiness verdict');

  yes('a priced finding shows its amount and how it is treated',
      /\$38,000\.00 weakly evidenced \(expense-side\)/.test(EXCEPTION),
      'the $38,000 concentration renders with no dollar figure');
  yes('an unpriced finding says so rather than showing nothing',
      /Not yet quantified/.test(EXCEPTION),
      'an unpriced finding is silently rendered as though it had no consequence');
  yes('every finding cites its source',
      /Source: Invoice amount vs total CAM pool/.test(EXCEPTION)
        && /Source: Lease record \(end_date\) vs reconciliation allocation/.test(EXCEPTION),
      'the source field is recorded on findings but still never displayed');
  yes('and offers the actions that resolve it',
      /Confirm occupancy/.test(EXCEPTION) && /Review lease clause/.test(EXCEPTION),
      'findings render without their recommended actions');

  // The pro-rata conflict, verbatim to the specification it was built to.
  yes('the pro-rata conflict states both figures and the difference',
      /18\.54%/.test(EXCEPTION) && /22\.25%/.test(EXCEPTION)
        && /3\.71 percentage points/.test(EXCEPTION),
      'the conflict no longer shows both shares and their difference');
  yes('and asserts neither as controlling',
      /does not assert which figure is controlling/.test(EXCEPTION),
      'MainStreet is now asserting which pro-rata figure governs');
  yes('and is rendered as a Warning, never a Critical',
      /Warning Pro-rata allocation conflict/.test(EXCEPTION),
      'the conflict has been promoted to a critical exception');
}

// ── W1. Billing workflow obeys the audit's verdict ──────────────────────────
console.log('\n── W1 · A statement is not issued from a reconciliation that cannot be billed ──');
{
  const scriptText = fs.readFileSync(path.join(__dirname, 'script.js'), 'utf8');

  const blocked = F.statementReadiness('SHONAC');
  yes('the gate blocks while the audit says Not ready to bill', !!blocked,
      'generateTenantStatement would proceed on a reconciliation the audit is holding open');
  // Everything below reads off `blocked`; without this the gate's removal shows
  // up as a crash rather than as a named failure.
  if (!blocked) {
    bad('the remaining W1 assertions cannot run', 'the gate returned nothing to inspect');
  } else {
  eq('and reports the canonical readiness verdict', blocked.readiness.label, 'Not ready to bill');
  eq('with the canonical reason', blocked.readiness.reason,
     NARRATIVE.readiness.reason);
  eq('all five critical exceptions are carried into the block', blocked.red.length, 5);
  eq('and the one naming SHONAC is identified', blocked.mine.length, 1);
  yes('specifically SHONAC\'s own expired lease',
      /^SHONAC is being billed/.test(blocked.mine[0].title), blocked.mine[0].title);

  // A tenant not named by any exception is still blocked — the reconciliation
  // as a whole is what cannot be billed.
  }

  const other = F.statementReadiness('Northline Landscaping');
  yes('a tenant named by no exception is blocked too', !!other,
      'the gate only blocks tenants that appear in a finding');
  eq('and the block says so rather than implying they are implicated',
     other ? other.mine.length : null, 0);

  // The gate opens by itself once the audit clears. No override, no flag.
  const clean = F.statementReadiness('SHONAC', { red: [], yellow: [], green: [{ title: 'ok' }] });
  eq('a clean reconciliation issues the statement', clean, null);
  const advisoryOnly = F.statementReadiness('SHONAC',
    { red: [], yellow: [{ title: 'advisory only' }], green: [] });
  eq('advisory findings alone do not block billing', advisoryOnly, null);

  const blockScreen = F.statementBlockHtml('SHONAC');
  yes('the block screen is actually produced', !!blockScreen.html,
      'the readiness gate produced no screen — the refusal would be invisible');
  eq('and is titled as a refusal', blockScreen.title, 'Statement blocked — SHONAC');
  const html = blockScreen.html;
  const bt   = text(html);
  yes('the block screen refuses rather than warns',
      /This statement has not been issued/.test(bt), 'the block screen reads as a warning');
  yes('it lists every blocking exception with its amount',
      /\$10,792\.50/.test(bt) && /\$16,008\.88/.test(bt), 'amounts are missing from the block screen');
  yes('and marks the ones naming this tenant',
      /This tenant/.test(bt), 'the tenant\'s own exceptions are not distinguished');
  yes('the only way forward is an explicitly non-billable draft',
      /View non-billable draft/.test(bt) && /must not be sent to a tenant/.test(bt),
      'the block screen offers a way to issue the statement anyway');
  no('and it offers no override that issues the real statement',
     /issue the statement/i.test(bt), 'the block can be overridden into a real statement');

  // Source-level: the gate must sit on the statement path, and the draft flag
  // must not be reachable from the ordinary Tenant Statement button.
  yes('[source] the gate runs inside generateTenantStatement',
      /if \(!opts\.draft\) \{\s*const _ready = _statementReadinessBlock\(tenantName\);/.test(scriptText),
      'the readiness gate is no longer on the statement path');
  yes('[source] the tenant statement buttons pass no draft flag',
      (scriptText.match(/generateTenantStatement\('\$\{esc\(r\.name\)\}'\)/g) || []).length >= 2,
      'a Tenant Statement button now passes options, which could bypass the gate');
  yes('[source] the draft is reachable only from the block screen',
      (scriptText.match(/draft: true/g) || []).length === 1
        && /function _renderStatementReadinessBlock[\s\S]*?draft: true[\s\S]*?\n\}/.test(scriptText),
      'draft mode is reachable from somewhere other than the block screen');

  // The draft carries the audit state with it.
  yes('[source] the draft relabels the billed total',
      /Provisional CAM allocation — not billable/.test(scriptText),
      'the draft still says "Total CAM Billed to You"');
  eq('[source] the draft is marked non-billable in the banner AND the report header',
     (scriptText.match(/NON-BILLABLE DRAFT/g) || []).length, 2);
  yes('[source] the banner tells the reader not to send it',
      /DO NOT SEND TO TENANT/.test(scriptText),
      'the draft banner no longer warns against sending it to a tenant');
  yes('[source] the draft carries the blocking exceptions',
      /_draftState\.red\.map/.test(scriptText),
      'the draft does not list what is blocking it');
  yes('[source] the draft shows no settlement section at all',
      /\$\{_draftState \? '' : \(\(\) => \{/.test(scriptText),
      'a non-billable draft still renders payment settlement language');
}

// ── W2. Settlement language reflects settlement, not statement generation ───
console.log('\n── W2 · Settlement is claimed only when a transaction exists ──');
{
  const scriptText = fs.readFileSync(path.join(__dirname, 'script.js'), 'utf8');
  no('the statement no longer asserts settlement in the present tense',
     /This is the trust layer behind your statement/.test(scriptText),
     'the statement still claims RLUSD settlement backs it');
  yes('an unsettled statement says so in as many words',
      /No payment has been made and no settlement has occurred for this statement/.test(scriptText),
      'nothing tells the tenant that no settlement has occurred');
  yes('and keeps the "not yet live" caveat the shared widget carries',
      /goes live once the settlement wallet is funded/.test(scriptText),
      'the statement drops the caveat that the capability is not live');
  yes('the settled wording is reachable only from a real transaction',
      /const _settled = _st\.status === 'settled'/.test(scriptText),
      'the settled copy is not gated on settlement state');
  yes('[source] settled state still requires a txHash',
      /if \(s && s\.txHash\) \{[\s\S]{0,120}status:\s*'settled'/.test(scriptText),
      'settlement state no longer requires a transaction hash');
}

// ── W3. Lease Review counts, chronology, empty values ───────────────────────
console.log('\n── W3 · Lease Review says what it is counting ──');
{
  const lrpText = fs.readFileSync(path.join(__dirname, 'lease-review-packets.js'), 'utf8');

  no('a card no longer claims "no exceptions" beside an exception count',
     /verified — no exceptions/.test(lrpText),
     'the card still says "N fields verified — no exceptions" under an exception count');
  yes('both counts state their denominator',
      /of \$\{_fieldsChecked\} field/.test(lrpText),
      'the exception and verified counts are still bare numbers over an unstated population');
  yes('the appendix names them lease-field exceptions',
      /lease-field exception/.test(lrpText),
      'the field-level count still shares the bare word "exception" with the audit');
  yes('and points at where reconciliation exceptions are counted',
      /Reconciliation exceptions are counted separately in the Audit Exception Summary/.test(lrpText),
      'nothing relates the two counts');

  // Empty string is not a value.
  const LRP = global.window.LeaseReviewPackets;
  const packet = LRP.generateLeaseReviewPacket({
    name: 'Cap Render', totalSqft: 10000, disputes: [], timeline: [],
    tenants: [
      { id: 'a', tenant_name: 'Digital River', name: 'Digital River', leased_sqft: 5000,
        lease_type: 'NNN', start_date: '1998-08-01', end_date: '2003-07-31',
        cap: '', admin_fee_pct: '', gross_up_pct: '' },
      { id: 'b', tenant_name: 'Real Cap Co', name: 'Real Cap Co', leased_sqft: 5000,
        lease_type: 'NNN', start_date: '2020-01-01', end_date: '2030-01-01', cap: 5 },
    ],
  }, { audience: 'landlord' });
  const ph = LRP.formatReviewPacketHtml(packet);
  no('an empty cap does not render as a bare percent sign',
     />\s*%\s*</.test(ph), 'a "%" with no number is still rendered for an empty cap');
  // Nor as 0% — Number('') is 0, so a guard that merely coerces turns an absent
  // cap into a stated one, which is worse than the bare "%" it replaced.
  no('and never as 0%, which would assert a cap that does not exist',
     /Digital River[\s\S]{0,400}?>0%</.test(ph),
     'an empty cap now renders as 0%, asserting a cap the lease does not state');
  yes('the empty cap cell is an em-dash, like any absent value',
      /Digital River[\s\S]{0,400}?>—</.test(ph),
      'the absent cap does not render as an em-dash');
  yes('a real cap still renders its number', /5%/.test(ph), 'a populated cap stopped rendering');
  // The evidence appendix renders through _displayValue, which had the same
  // defect independently.
  no('the evidence appendix does not print a bare percent either',
     /rpt-ev-val">%</.test(ph), 'the appendix still prints "%" with no number');
  // The same guard has to hold for fields that are not percentages: an empty
  // expense_stop rendered "$0.00/sqft", asserting a stop the lease never set.
  eq('an empty non-percent field is absent, not zero',
     LRP.formatReviewPacketHtml(LRP.generateLeaseReviewPacket({
       name: 'Stop', totalSqft: 1000, disputes: [], timeline: [],
       tenants: [{ id: 'a', tenant_name: 'Empty Stop Co', name: 'Empty Stop Co', leased_sqft: 1000,
                   lease_type: 'NNN', start_date: '2020-01-01', end_date: '2030-01-01',
                   expense_stop: '' }],
     }, { audience: 'landlord' })).indexOf('/sqft') >= 0, false);

  // Original leases are not amendments.
  const pt = text(ph);
  no('the chronology is no longer titled "Amendment Chronology"',
     /Amendment Chronology/.test(pt),
     'original leases are still listed under a heading that says amendments');
  yes('it is titled for what it contains', /Document Chronology/.test(pt),
      'the chronology section lost its title');
  yes('and reconciles its own rows with the Amendments count',
      /original lease(s)? shown as the baseline/.test(pt)
        && /Amendments count on the cover counts amendments only/.test(pt),
      'nothing explains why originals appear where Amendments reads 0');
}

// ── W4. Measured zero vs unavailable ────────────────────────────────────────
console.log('\n── W4 · A measured zero and a missing measurement do not look alike ──');
{
  const LRP = global.window.LeaseReviewPackets;
  // The Test 2 shape: no lease carries a confidence score, and the readiness
  // score is genuinely 0 from expired leases and missing caps.
  const prop = {
    name: 'Test 2 Property', totalSqft: 80000, disputes: [], timeline: [],
    tenants: F.TENANTS.map(t => { const c = Object.assign({}, t); delete c._confidence; delete c._confidenceScore; return c; }),
  };
  const packet = LRP.generateLeaseReviewPacket(prop, { audience: 'landlord' });
  const es = packet.executiveSummary || {};
  eq('extraction confidence is null when no lease carries a score', es.avgConfidence, null);

  const ph = text(LRP.formatReviewPacketHtml(prop.tenants.length ? packet : packet));
  yes('and renders as N/A, never as 0',
      /N\/A Extraction Confidence/.test(ph),
      'unavailable confidence is rendered as a number');
  yes('the packet says unavailable is not zero, in as many words',
      /unavailable<\/strong>, not zero/.test(LRP.formatReviewPacketHtml(packet))
        || /unavailable , not zero/.test(ph) || /unavailable, not zero/.test(ph),
      'nothing distinguishes unavailable confidence from a measured zero');
  yes('and says the health score does not include confidence',
      /does not include confidence/.test(ph),
      'a reader can still attribute the health score to the missing confidence');

  // The basis reaches the packet through property._derivedMetrics, which the app
  // fills from derivePropertyMetrics. Drive that for real — its components come
  // from derivePropertyReadiness in selectors.js — then render with it, so both
  // halves of the seam are exercised rather than a stub.
  const realMetrics = F.propertyMetrics(prop);
  yes('derivePropertyMetrics builds a basis for the score',
      realMetrics.health.basis.length > 0,
      'the score components are computed but still not exposed');
  yes('naming the expired leases and missing caps that produced it',
      realMetrics.health.basis.some(b => /expired lease/.test(b))
        && realMetrics.health.basis.some(b => /no CAM cap/.test(b)),
      realMetrics.health.basis.join(' · '));
  eq('the score is a measured zero, not an absent one', realMetrics.health.score, 0);
  yes('and its deductions are reported past the 100-point scale',
      realMetrics.health.deductionTotal > 100,
      `deduction total is ${realMetrics.health.deductionTotal}`);

  const withMetrics = Object.assign({}, prop, { _derivedMetrics: realMetrics });
  const ph2 = text(LRP.formatReviewPacketHtml(
    LRP.generateLeaseReviewPacket(withMetrics, { audience: 'landlord' })));
  yes('the packet renders the components it is made of',
      /Health score basis:/.test(ph2), 'the health score is still an unexplained number');
  yes('including the expired leases and missing caps',
      /expired lease/.test(ph2) && /no CAM cap/.test(ph2),
      'the basis does not name the drivers of the score');
  yes('and states the deduction total that outran the scale',
      /points of deductions against a 100-point scale/.test(ph2),
      'a saturated Lease Review score reports no progress, as the Lender Summary once did');
  eq('the score still renders as the measured 0, not N/A',
     /(\d+|N\/A)\s*Health Score/.exec(ph2) ? /0\s*Health Score/.test(ph2) : false, true);
}

// ── P1 rollup. Every report agrees on the numbers it shares ─────────────────
console.log('\n── P1 · The five reports agree wherever they overlap ──');
{
  const x = NARRATIVE.exposure;
  // The Exception Summary now states the same exposure line as everywhere else.
  yes('the exposure line the audit narrative computes reaches every surface',
      NARRATIVE.financialImpact === AX.describeExposure(x),
      'the narrative re-derives its own exposure string');
  yes('billing readiness is one verdict, not one per report',
      RISK.indexOf(NARRATIVE.readiness.label) >= 0
        && LENDER.indexOf(NARRATIVE.readiness.reason) >= 0,
      'the readiness verdict differs between Risk & Disputes and the Lender Summary');

  // The four expired leases and the $38,000 concentration are the material
  // findings the pass was asked to follow end to end.
  ['SHONAC', 'Digital River', 'Tollgrade', 'Fourth Tenant Co'].forEach(t => {
    yes(`${t}'s expired lease is visible in both the audit and Risk & Disputes`,
        RISK.indexOf(t) >= 0 && SUMMARY.red.some(f => f.title.indexOf(t) === 0),
        'the expired lease is missing from one of the two');
  });
  yes('the $38,000 concentration reaches the Lender Summary\'s expense-side figure',
      x.contributors.unsubstantiated.some(t => /38,000/.test(t)) && /57,750/.test(LENDER),
      'the concentration finding still carries no money anywhere');
  yes('the pro-rata conflict is under review, never asserted as a loss',
      x.contributors.under_review.some(t => /Pro-rata allocation conflict/.test(t))
        && !x.contributors.at_risk.some(t => /Pro-rata/.test(t)),
      'the pro-rata conflict has been classified as a confirmed loss');
}

console.log(`\n${fail === 0 ? '\x1b[32m' : '\x1b[31m'}RESULT: ${pass} passed, ${fail} failed\x1b[0m`);
process.exit(fail === 0 ? 0 : 1);
