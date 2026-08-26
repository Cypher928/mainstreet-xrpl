'use strict';
/**
 * test-lease-period.js — a lease term and a CAM period are two intervals.
 *
 *   node test-lease-period.js
 *
 * THE DEFECT THIS EXISTS FOR
 *
 * One line in reconciliation-engine.js was the only place a lease date ever met
 * the CAM year:
 *
 *     if (t?.end_date && t.end_date < evalDate && r.totalAllocated > 0)
 *
 * `evalDate` being the last day of the CAM year. One endpoint, standing in for a
 * question about two intervals overlapping, and it was wrong in both directions
 * at once. Measured on a live run:
 *
 *   Sunrise Cleaners   lease to 2026-08-31, five days away
 *                      -> "is being billed 2026 CAM on a lease that ENDED
 *                         2026-08-31" — past tense about a future date — red,
 *                         blocked, full allocation booked as at-risk.
 *
 *   Coastal Phys. Ther. lease from 2026-09-01
 *                      -> $10,483.97 for twelve months, "Calc verified",
 *                         "Billable", statement issued, ZERO findings.
 *
 * A false positive on the endpoint it tested; a silent false negative, and the
 * larger money error, on the one it did not.
 *
 * WHAT T1 IS AND IS NOT
 *
 * T1 is classification and wording only. No allocation amount changes, and no
 * apportionment is introduced — whether a partial period is billed in full or
 * apportioned, and on what basis, is an open product question. So the assertions
 * below deliberately pin BOTH that the partial-period cases are caught AND that
 * nothing here computes a factor or restates a dollar figure.
 */

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');
const vm     = require('vm');

const LP = require('./lease-period.js');

// The engine the way the page loads it, with the real module in scope.
function loadEngine() {
  const box = { window: { LeasePeriod: LP }, console, module: {},
                Date, Math, Number, String, Array, JSON, isFinite, parseFloat };
  vm.createContext(box);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'reconciliation-engine.js'), 'utf8'), box,
                  { filename: 'reconciliation-engine.js' });
  return box.window.ReconciliationEngine;
}
const RE = loadEngine();

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log(`  \x1b[32m✓\x1b[0m ${name}`); pass++; }
  catch (e) { console.log(`  \x1b[31m✗\x1b[0m ${name}\n      → ${e.message}`); fail++; }
}
const ok = (c, m) => assert.ok(c, m);
const eq = (a, b, m) => assert.strictEqual(a, b, m || `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);

const P2026 = LP.periodFrom('2026-12-31');

// One tenant, one result, one detector call — the shape the real caller uses.
function detect(term, allocated) {
  const t1 = Object.assign({ id: 't1', name: 'Tenant', tenant_name: 'Tenant' }, term);
  return RE.detectReconciliationIssues(
    [{ tenantId: 't1', name: 'Tenant', totalAllocated: allocated === undefined ? 10000 : allocated,
       proRataPercent: 10, includedInvoices: [] }],
    { tenants: [t1] }, '2026-12-31');
}
const occupancyFinding = fs2 =>
  fs2.find(f => /lease that ended|does not begin until|partial year is apportioned|lease dates/.test(f.title || ''));

const scriptSrc  = fs.readFileSync(path.join(__dirname, 'reconciliation-engine.js'), 'utf8');
const engineCode = scriptSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

console.log('\n══ Lease term vs CAM period ══');
console.log('\n── The period is an interval, not an endpoint ──');

t('a bare date string is read as the period END, with 1 January as the start', () => {
  const p = LP.periodFrom('2026-12-31');
  eq(p.start, '2026-01-01');
  eq(p.end,   '2026-12-31');
});

t('a {start,end} passes through — a fiscal CAM period needs no change here', () => {
  const p = LP.periodFrom({ start: '2026-07-01', end: '2027-06-30' });
  eq(p.start, '2026-07-01');
  eq(p.end,   '2027-06-30');
});

t('periodForYear is the calendar year', () => {
  eq(JSON.stringify(LP.periodForYear(2026)), JSON.stringify({ start: '2026-01-01', end: '2026-12-31' }));
  eq(LP.periodForYear('nope'), null);
});

console.log('\n── Every interval case, classified ──');

const C = (term) => LP.classify(term, P2026).case;

t('a lease spanning the whole period is unremarkable', () => {
  eq(C({ start_date: '2018-03-01', end_date: '2033-02-28' }), 'covers_period');
  eq(LP.classify({ start_date: '2018-03-01', end_date: '2033-02-28' }, P2026).needsOccupancyConfirmation, false);
});

t('boundary dates are INSIDE the period, not outside it', () => {
  // A lease running exactly 1 Jan – 31 Dec covers the period. An off-by-one here
  // would put every full-year lease into the partial-period branch.
  eq(C({ start_date: '2026-01-01', end_date: '2026-12-31' }), 'covers_period');
});

t('THE FALSE POSITIVE: a lease ending inside the period is not one that ended before it', () => {
  const c = LP.classify({ start_date: '2019-09-01', end_date: '2026-08-31' }, P2026);
  eq(c.case, 'expires_within', 'an ordinary mid-period expiry is still read as a holdover');
  eq(c.overlapStart, '2026-01-01');
  eq(c.overlapEnd,   '2026-08-31');
});

t('THE FALSE NEGATIVE: a lease starting inside the period is classified at all', () => {
  const c = LP.classify({ start_date: '2026-09-01', end_date: '2031-08-31' }, P2026);
  eq(c.case, 'commences_within', 'the endpoint the old predicate never tested');
  eq(c.needsOccupancyConfirmation, true);
  eq(c.overlapStart, '2026-09-01');
  eq(c.overlapEnd,   '2026-12-31');
});

t('a lease wholly inside the period is one case, not two findings', () => {
  eq(C({ start_date: '2026-03-01', end_date: '2026-09-30' }), 'within_period');
});

t('a holdover — ended before the period opened', () => {
  eq(C({ start_date: '2020-11-01', end_date: '2025-10-31' }), 'ended_before');
});

t('a lease that has not begun by the time the period closes', () => {
  eq(C({ start_date: '2027-03-01', end_date: '2032-02-28' }), 'begins_after');
});

console.log('\n── An absent bound is not an unknowable one ──');

t('a known end BEFORE the period is a holdover even with no start date', () => {
  // The first cut of this module returned early on the missing start and
  // swallowed a lease that ended in 2003 — caught by test-audit-consistency,
  // whose fixture carries no start_date.
  const c = LP.classify({ end_date: '2003-06-30' }, P2026);
  eq(c.case, 'ended_before');
  eq(c.assumedStart, true);
  eq(c.needsOccupancyConfirmation, true);
});

t('a known start AFTER the period is caught with no end date', () => {
  eq(C({ start_date: '2027-03-01' }), 'begins_after');
});

t('a known end INSIDE the period is caught with no start date', () => {
  eq(C({ end_date: '2026-08-31' }), 'expires_within');
});

t('a known start INSIDE the period is caught with no end date', () => {
  eq(C({ start_date: '2026-09-01' }), 'commences_within');
});

t('but a month-to-month covering the period stays silent — that is D4, not T1', () => {
  const c = LP.classify({ start_date: '2024-01-01' }, P2026);
  eq(c.case, 'unknown_end');
  eq(c.needsOccupancyConfirmation, false, 'T1 must not start raising the missing-end-date question');
  eq(c.assumedEnd, true, 'the assumption is at least recorded');
});

t('and a lease with no dates at all stays silent', () => {
  const c = LP.classify({}, P2026);
  eq(c.case, 'no_term');
  eq(c.needsOccupancyConfirmation, false);
});

console.log('\n── Dates are read once, and fail closed ──');

t('ISO passes straight through', () => {
  const r = LP.readDate('2026-08-31');
  eq(r.status, 'ok'); eq(r.value, '2026-08-31'); eq(r.normalised, false);
});

t('a US-format date is repaired rather than mis-compared', () => {
  // THE LATENT HAZARD: the old code compared raw strings, and
  // '8/31/2026' < '2026-12-31' is FALSE — so a malformed end date raised
  // nothing whatever. Reading it properly is what removes that.
  const r = LP.readDate('8/31/2026');
  eq(r.status, 'ok'); eq(r.value, '2026-08-31'); eq(r.normalised, true);
  eq(C({ start_date: '2019-09-01', end_date: '8/31/2026' }), 'expires_within');
});

t('a date that is genuinely not a date fails CLOSED', () => {
  ['TBD', 'n/a', 'see amendment', '31/08/2026'].forEach(v => {
    eq(LP.readDate(v).status, 'unreadable', `"${v}" was read as a date`);
    const c = LP.classify({ start_date: '2019-09-01', end_date: v }, P2026);
    eq(c.case, 'unreadable', `"${v}"`);
    eq(c.needsOccupancyConfirmation, true, `"${v}" was waved through`);
  });
});

t('absent is absent — not zero, not unreadable', () => {
  ['', null, undefined].forEach(v => eq(LP.readDate(v).status, 'absent', JSON.stringify(v)));
});

console.log('\n── B: one owner of "when does this tenant owe CAM" ──');

t('a plain lease resolves to its own term', () => {
  const o = LP.obligationTerm({ start_date: '2020-01-01', end_date: '2030-12-31' });
  eq(o.start, '2020-01-01'); eq(o.end, '2030-12-31'); eq(o.startSource, 'start_date');
});

t('cam_commencement_date overrides start_date, and start_date survives', () => {
  const o = LP.obligationTerm({ start_date: '2026-01-01', cam_commencement_date: '2026-04-01',
                                end_date: '2031-03-31' });
  eq(o.start, '2026-04-01');
  eq(o.startSource, 'cam_commencement_date');
  eq(o.leaseStart, '2026-01-01', 'the lease start was overwritten rather than recorded beside it');
});

t('an EMPTY cam_commencement_date falls back — it is the common case', () => {
  [null, undefined, ''].forEach(v => {
    const o = LP.obligationTerm({ start_date: '2026-01-01', cam_commencement_date: v, end_date: '2030-12-31' });
    eq(o.start, '2026-01-01', JSON.stringify(v));
    eq(o.startSource, 'start_date', JSON.stringify(v));
  });
});

t('an UNREADABLE cam_commencement_date does NOT fall back — it fails closed', () => {
  // Falling back here would quietly bill from a different date than the lease
  // names, which is the failure mode this whole module exists to remove.
  const o = LP.obligationTerm({ start_date: '2026-01-01', cam_commencement_date: 'upon opening',
                                end_date: '2030-12-31' });
  eq(o.start, null);
  eq(o.startStatus, 'unreadable');
  eq(o.startSource, 'cam_commencement_date');
  eq(LP.classify({ start_date: '2026-01-01', cam_commencement_date: 'upon opening',
                   end_date: '2030-12-31' }, P2026).case, 'unreadable');
});

t('classify() reads the OBLIGATION term, not the lease term', () => {
  const c = LP.classify({ start_date: '2026-01-01', cam_commencement_date: '2026-04-01',
                          end_date: '2031-03-31' }, P2026);
  eq(c.case, 'commences_within', 'the lease term alone would read as covers_period');
  eq(c.overlapStart, '2026-04-01');
  eq(c.startSource, 'cam_commencement_date');
});

t('a lease with neither new field behaves exactly as before', () => {
  const legacy = { start_date: '2020-01-01', end_date: '2030-12-31' };
  const o = LP.obligationTerm(legacy);
  eq(o.start, '2020-01-01'); eq(o.startSource, 'start_date');
  eq(LP.classify(legacy, P2026).case, 'covers_period');
  eq(LP.classify(legacy, P2026).needsOccupancyConfirmation, false);
});

console.log('\n── B: a stated basis and a defaulted one are different claims ──');

t('the three recognised bases are read as lease-stated', () => {
  LP.BASES.forEach(v => {
    const b = LP.partialPeriodBasis({ partial_period_basis: v });
    eq(b.basis, v); eq(b.source, 'lease'); eq(b.stated, true);
  });
});

t('case and whitespace do not change the answer', () => {
  const b = LP.partialPeriodBasis({ partial_period_basis: '  PER_DIEM ' });
  eq(b.basis, 'per_diem'); eq(b.source, 'lease');
});

t('SILENCE defaults to per-diem and says it defaulted', () => {
  [null, undefined, '', '   '].forEach(v => {
    const b = LP.partialPeriodBasis(v === undefined ? {} : { partial_period_basis: v });
    eq(b.basis, 'per_diem', JSON.stringify(v));
    eq(b.source, 'default', JSON.stringify(v) + ' — a product choice is reading as lease language');
    eq(b.stated, false, JSON.stringify(v));
  });
});

t('an unrecognised value is neither stated nor a default', () => {
  const b = LP.partialPeriodBasis({ partial_period_basis: 'weekly' });
  eq(b.basis, 'per_diem', 'something still has to be computable');
  eq(b.source, 'unrecognised', 'a bad value and a silent lease are different problems');
  eq(b.raw, 'weekly', 'the raw value was discarded');
});

t('the basis chooses the arithmetic, and each is inspectable', () => {
  const term = { start_date: '2019-09-01', end_date: '2026-08-31' };
  const day  = LP.occupancy(Object.assign({}, term, { partial_period_basis: 'per_diem' }), P2026);
  const mon  = LP.occupancy(Object.assign({}, term, { partial_period_basis: 'monthly' }), P2026);
  const full = LP.occupancy(Object.assign({}, term, { partial_period_basis: 'full_period' }), P2026);
  eq(day.unit, 'days');    eq(day.numerator, 243);  eq(day.denominator, 365);
  eq(mon.unit, 'months');  eq(mon.numerator, 8);    eq(mon.denominator, 12);
  eq(full.unit, 'period'); eq(full.factor, 1, 'full_period must not reduce the bill');
});

console.log('\n── T1 DOES NOT APPORTION ──');

t('[source] the apportionment lives in occupancy(), not scattered', () => {
  // T1 asserted this module held NO arithmetic at all, because the policy was
  // undecided. T2 is that decision, so the assertion is retargeted rather than
  // dropped: the factor exists in exactly one function, and classify() still
  // holds none of it.
  const src = fs.readFileSync(path.join(__dirname, 'lease-period.js'), 'utf8')
                .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const occIdx = src.indexOf('function occupancy(');
  ok(occIdx > 0, 'occupancy() is gone');
  const classIdx = src.indexOf('function classify(');
  const classBody = src.slice(classIdx, src.indexOf('\n  function ', classIdx + 10));
  ok(!/factor/i.test(classBody), 'classify() computes a factor — it answers the shape question only');
  ok(!/_span\(/.test(classBody),  'classify() counts days');
  // Day arithmetic exists in exactly the two helpers and their use in occupancy.
  ok(/function _dayNum\(iso\)/.test(src) && /Date\.UTC/.test(src),
     'the day count is not UTC-based — a DST boundary can move a day');
});

t('classify() still carries dates and no arithmetic', () => {
  const c = LP.classify({ start_date: '2026-09-01', end_date: '2031-08-31' }, P2026);
  Object.keys(c).forEach(k => {
    if (typeof c[k] === 'number') throw new Error(`classify() returned a number at "${k}"`);
  });
});

console.log('\n── What the detector now says ──');

t('a full-period lease raises nothing', () => {
  eq(occupancyFinding(detect({ start_date: '2018-01-01', end_date: '2030-01-01' })), undefined);
});

t('a lease with no allocation raises nothing, whatever its dates', () => {
  eq(occupancyFinding(detect({ start_date: '2020-01-01', end_date: '2021-01-01' }, 0)), undefined);
});

t('THE HOLDOVER keeps its severity, its money and its wording', () => {
  const f = occupancyFinding(detect({ start_date: '2020-11-01', end_date: '2025-10-31' }));
  ok(f, 'the holdover finding disappeared');
  eq(f.severity, 'red', 'a lease that expired before the period is still the alarming case');
  eq(f.impact.kind, 'at_risk');
  eq(f.impact.amount, 10000, 'the full allocation is still the amount with no documented basis');
  ok(/lease that ended 2025-10-31/.test(f.title), f.title);
});

t('    but it no longer concludes against the charge', () => {
  const f = occupancyFinding(detect({ start_date: '2020-11-01', end_date: '2025-10-31' }));
  ok(!/there is no lease on file supporting this charge/.test(f.detail),
     'the finding still asserts the charge is unsupported rather than asking for confirmation');
  ok(/Confirm whether/.test(f.detail), f.detail);
  ok(/holdover or a renewal may well carry the obligation forward/.test(f.detail), f.detail);
});

t('T2 REVERSAL: a stated basis means a mid-period lease raises NOTHING', () => {
  // T1 held these pending the apportionment policy. T2 is that policy, so a
  // lease that says how to apportion is simply apportioned and billed.
  ['per_diem', 'monthly', 'full_period'].forEach(b => {
    eq(occupancyFinding(detect({ start_date: '2019-09-01', end_date: '2026-08-31',
                                 partial_period_basis: b })), undefined, b);
    eq(occupancyFinding(detect({ start_date: '2026-09-01', end_date: '2031-08-31',
                                 partial_period_basis: b })), undefined, b);
  });
});

t('a SILENT lease is still held — once — and the finding says why', () => {
  const f = occupancyFinding(detect({ start_date: '2019-09-01', end_date: '2026-08-31' }));
  ok(f, 'a lease with no partial-period clause was billed on a default with no confirmation');
  eq(f.severity, 'yellow', 'nothing alarming here — the lease is valid');
  eq(f.blocksBilling, true, 'the approved model holds once before billing');
  ok(/the lease does not say/.test(f.title), f.title);
  ok(/this product's default, not a term of the lease/.test(f.detail), f.detail);
  ok(/no partial-period clause was found/.test(f.detail), f.detail);
  ok(/will not be asked again/.test(f.detail), 'the hold must read as once, not forever');
});

t('    and it states the apportionment it actually applied', () => {
  const f = occupancyFinding(detect({ start_date: '2019-09-01', end_date: '2026-08-31' }));
  ok(/243 of 365 days/.test(f.detail), f.detail);
  ok(f.conditions.some(c => /apportioned 243\/365 days/.test(c)),
     'the amount line still claims the allocation was un-apportioned: ' + JSON.stringify(f.conditions));
});

t('a manager-confirmed basis clears the hold, and is not called the lease', () => {
  const confirmed = { start_date: '2019-09-01', end_date: '2026-08-31',
    partial_period_basis: 'per_diem',
    fieldEvidence: { partial_period_basis: { snapshots: [{ manuallyEdited: true }] } } };
  eq(occupancyFinding(detect(confirmed)), undefined, 'a confirmed basis still blocks');
  eq(LP.partialPeriodBasis(confirmed).source, 'manual',
     'a manager\'s decision is being reported as the lease\'s own language');
});

t('an UNRECOGNISED basis is held too, and named', () => {
  const f = occupancyFinding(detect({ start_date: '2019-09-01', end_date: '2026-08-31',
                                      partial_period_basis: 'weekly' }));
  ok(f, 'an unrecognised basis was silently treated as a stated one');
  ok(/"weekly", which is not a basis this reconciliation recognises/.test(f.detail), f.detail);
});

t('a lease that has not begun by period end is a data error, and says so', () => {
  const f = occupancyFinding(detect({ start_date: '2027-03-01', end_date: '2032-02-28' }));
  ok(f, 'billing a period entirely before the lease raises nothing');
  eq(f.severity, 'red');
  ok(/does not begin until 2027-03-01/.test(f.title), f.title);
  ok(/Either the lease dates or the CAM period is wrong/.test(f.detail), f.detail);
});

t('an unreadable date asks rather than failing open', () => {
  const f = occupancyFinding(detect({ start_date: '2019-09-01', end_date: 'TBD' }));
  ok(f, "'TBD' as an end date still raises nothing — it used to fail open as a string comparison");
  eq(f.severity, 'yellow');
  eq(f.blocksBilling, true);
  ok(/cannot be read/.test(f.title), f.title);
});

console.log('\n── The remedies offered match the case ──');

t('a holdover keeps Confirm occupancy / Update lease / Remove allocation', () => {
  const f = occupancyFinding(detect({ start_date: '2020-11-01', end_date: '2025-10-31' }));
  ['Confirm occupancy', 'Update lease', 'Remove allocation']
    .forEach(a => ok((f.actions || []).includes(a), `missing "${a}" — ${JSON.stringify(f.actions)}`));
});

t('a partial period is NOT told to remove the allocation', () => {
  // The tenant occupied and owes something. "Remove allocation" is the right
  // answer for a vacancy and bad advice here.
  const f = occupancyFinding(detect({ start_date: '2026-09-01', end_date: '2031-08-31' }));
  ok(!(f.actions || []).includes('Remove allocation'), JSON.stringify(f.actions));
  ok((f.actions || []).some(a => /Confirm the partial-period basis/.test(a)),
     'the remedy should be the confirmation the finding asks for: ' + JSON.stringify(f.actions));
});

console.log('\n── Ownership: the date rule lives in one place ──');

t('[source] the detector reads the classification and re-derives nothing', () => {
  ok(/const c = LP\.classify\(t, period\);/.test(engineCode),
     'the detector does not consult lease-period.js');
  const copies = (engineCode.match(/end_date\s*<\s*evalDate/g) || []).length;
  eq(copies, 0, 'the old single-endpoint predicate is still in the engine');
});

t('[source] the detector no longer compares raw date strings at all', () => {
  const i = engineCode.indexOf('results.forEach(r => {');
  const j = engineCode.indexOf('1b.', i) > 0 ? engineCode.indexOf('const stated', i) : engineCode.length;
  const body = engineCode.slice(i, j > i ? j : i + 6000);
  ok(!/t\.end_date\s*[<>]/.test(body), 'a raw end_date comparison survives in the detector');
  ok(!/t\.start_date\s*[<>]/.test(body), 'a raw start_date comparison survives in the detector');
});

t('[source] the engine resolves the module and raises nothing if it is absent', () => {
  ok(/function _leasePeriod\(\)/.test(engineCode));
  ok(/if \(!t \|\| !\(r\.totalAllocated > 0\) \|\| !LP \|\| !period\) return;/.test(engineCode),
     'a missing module must not fall back to a private copy of the date rule');
});

t('[source] the period is built from start AND end, not one endpoint', () => {
  ok(/const period\s+= LP && LP\.periodFrom\(evalDate\);/.test(engineCode));
  ok(/CAM period billed: \$\{period\.start\} to \$\{period\.end\}/.test(engineCode),
     'the finding does not state the period it measured against');
});

console.log('\n── T1 CHANGES NO MONEY ──');

t('[source] the detector never writes to an allocation', () => {
  const i = engineCode.indexOf('function detectReconciliationIssues');
  const body = engineCode.slice(i, engineCode.indexOf('\n  function ', i + 10));
  ok(!/totalAllocated\s*=/.test(body), 'the detector assigns to totalAllocated');
  ok(!/proRataPercent\s*=[^=]/.test(body), 'the detector assigns to proRataPercent');
});

t('the allocation handed in comes back untouched', () => {
  const results = [{ tenantId: 't1', name: 'Tenant', totalAllocated: 4717.79,
                     proRataPercent: 2.88, includedInvoices: [] }];
  const before = JSON.stringify(results);
  RE.detectReconciliationIssues(results, {
    tenants: [{ id: 't1', name: 'Tenant', start_date: '2019-09-01', end_date: '2026-08-31' }],
  }, '2026-12-31');
  eq(JSON.stringify(results), before, 'detection mutated the reconciliation results');
});

console.log('\n' + '─'.repeat(58));
if (fail) { console.log(`\x1b[31mRESULT: ${pass} passed, ${fail} failed\x1b[0m`); process.exit(1); }
console.log(`\x1b[32mRESULT: ${pass} passed, 0 failed\x1b[0m`);
