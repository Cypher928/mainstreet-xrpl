'use strict';
// test-vacancy.js — the pure contract behind "Mark space vacant".
//
//   A · reconciliation-engine: the coverage finding subtracts recorded vacancy
//       from the unresolved remainder; green when the remainder is within the
//       2% safeguard, yellow (with the vacancy stated) when it is not; a vacant
//       row with a name is still not a lease; the safeguard is not loosened.
//   B · variance-breakdown: the uncovered amount never moves; the label and
//       detail state the recorded vacancy; the CTA falls through on a resolved
//       remainder and names marking the space vacant otherwise.
//   C · selectors: derivePropertyReadiness and the occupancy sum skip vacant
//       rows.
//
//   node test-vacancy.js
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = __dirname;

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  catch (e) { fail++; console.log(`  \x1b[31m✗\x1b[0m ${name}\n      → ${e.message}`); } };
const ok = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m || ''}\n        expected ${JSON.stringify(b)}\n        got      ${JSON.stringify(a)}`); };

function loadEngine() {
  const box = { window: {}, console, module: {}, Date, Math, Number, String, Array, JSON, isFinite, parseFloat };
  box.globalThis = box;
  vm.createContext(box);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'reconciliation-engine.js'), 'utf8'), box);
  return box.window.ReconciliationEngine;
}
const RE = loadEngine();
const VB = require('./variance-breakdown.js');

// A property of 10,000 sqft; two leases 4,000 + 3,000 (70%); 3,000 uncovered.
const RESULTS = [
  { tenantId: 't1', name: 'Alder Dental', proRataPercent: 40, totalAllocated: 4000, totalSqFt: 10000 },
  { tenantId: 't2', name: 'Birch Books',  proRataPercent: 30, totalAllocated: 3000, totalSqFt: 10000 },
];
const LEASES = [
  { id: 't1', tenant_name: 'Alder Dental', leased_sqft: 4000, end_date: '2030-01-01' },
  { id: 't2', tenant_name: 'Birch Books',  leased_sqft: 3000, end_date: '2030-01-01' },
];
const prop = (vacantRows) => ({ totalSqft: 10000, tenants: LEASES.concat(vacantRows || []) });
const coverage = (p) => RE.detectReconciliationIssues(RESULTS, p, '2025-12-31').filter(f => f.kind === 'coverage');

console.log('\n── A · the engine: coverage vs recorded vacancy ──');
t('A1 no vacancy: yellow, 30.0% unresolved, no vacancy line', () => {
  const f = coverage(prop([]));
  eq(f.map(x => [x.severity, x.title]), [['yellow', 'Property CAM coverage: 70.0% documented · 30.0% unresolved']]);
  ok(!f[0].conditions.some(c => /Confirmed vacant/.test(c)), 'a vacancy line appears with no vacancy recorded');
});
t('A2 the whole remainder recorded vacant: green, not blocking, the landlord absorbs it', () => {
  const f = coverage(prop([{ id: 'v1', tenant_name: '', suite: '300', leased_sqft: 3000, vacant: true }]));
  eq(f.map(x => [x.severity, x.title, !!x.blocksBilling, x.disputable]),
     [['green', 'Property CAM coverage: 70.0% documented · 30.0% confirmed vacant', false, false]]);
  ok(/landlord's/.test(f[0].detail) && /no lease is missing/.test(f[0].detail), f[0].detail);
  ok(f[0].conditions.some(c => c === 'Confirmed vacant: 30.00% (3,000 sqft, 1 space)'), JSON.stringify(f[0].conditions));
  ok(f[0].conditions.some(c => /landlord absorbs the vacant share/.test(c)), JSON.stringify(f[0].conditions));
});
t('A3 part of the remainder recorded vacant: still yellow, and says how much is still unresolved', () => {
  const f = coverage(prop([{ id: 'v1', suite: '300', leased_sqft: 2000, vacant: true }]));
  eq(f.map(x => [x.severity, x.title]), [['yellow', 'Property CAM coverage: 70.0% documented · 20.0% confirmed vacant · 10.0% unresolved']]);
  ok(f[0].conditions.some(c => c === 'Unresolved after recorded vacancy: 10.00%'), JSON.stringify(f[0].conditions));
  ok(f[0].conditions.some(c => /Confirmed vacant: 20\.00% \(2,000 sqft\)/.test(c)), JSON.stringify(f[0].conditions));
});
t('A4 THE SAFEGUARD IS NOT LOOSENED: 2.5% still unresolved after vacancy stays yellow; 2.0% resolves', () => {
  eq(coverage(prop([{ id: 'v1', suite: '300', leased_sqft: 2750, vacant: true }])).map(x => x.severity), ['yellow'], '2.5% unresolved reads green');
  eq(coverage(prop([{ id: 'v1', suite: '300', leased_sqft: 2800, vacant: true }])).map(x => x.severity), ['green'],  '2.0% unresolved reads yellow');
});
t('A5 two vacant spaces add up; a vacant row that carries a name is still a vacancy', () => {
  const f = coverage(prop([
    { id: 'v1', tenant_name: 'Vacant', suite: '300', leased_sqft: 1000, vacant: true },
    { id: 'v2', tenant_name: 'Vacant', suite: '301', leased_sqft: 2000, vacant: true },
  ]));
  eq(f.map(x => x.severity), ['green']);
  ok(f[0].conditions.some(c => c === 'Confirmed vacant: 30.00% (3,000 sqft, 2 spaces)'), JSON.stringify(f[0].conditions));
});
t('A6 vacant: "true" (a string) or vacant: 1 is NOT a vacancy — strictly boolean, as the allow-list says', () => {
  const f = coverage(prop([{ id: 'v1', suite: '300', leased_sqft: 3000, vacant: 'true' }, { id: 'v2', suite: '301', leased_sqft: 3000, vacant: 1 }]));
  eq(f.map(x => [x.severity, x.title]), [['yellow', 'Property CAM coverage: 70.0% documented · 30.0% unresolved']]);
});
t('A7 over-recorded vacancy cannot exceed 100% and never makes a finding red', () => {
  const f = coverage(prop([{ id: 'v1', suite: '300', leased_sqft: 50000, vacant: true }]));
  eq(f.map(x => x.severity), ['green']);
});
t('A8 without a building total, vacancy cannot be measured and the finding is the plain yellow', () => {
  const f = RE.detectReconciliationIssues(
    RESULTS.map(r => ({ ...r, totalSqFt: undefined })),
    { tenants: LEASES.concat([{ id: 'v1', suite: '300', leased_sqft: 3000, vacant: true }]) }, '2025-12-31').filter(x => x.kind === 'coverage');
  eq(f.map(x => [x.severity, x.title]), [['yellow', 'Property CAM coverage: 70.0% documented · 30.0% unresolved']]);
});
t('A9 the over-allocation branch is untouched by vacancy', () => {
  const over = RE.detectReconciliationIssues(
    [{ tenantId: 't1', name: 'A', proRataPercent: 60, totalAllocated: 1 }, { tenantId: 't2', name: 'B', proRataPercent: 50, totalAllocated: 1 }],
    prop([{ id: 'v1', suite: '300', leased_sqft: 3000, vacant: true }]), '2025-12-31');
  ok(over.some(f => f.severity === 'red' && /over-allocation/.test(f.title)), JSON.stringify(over.map(f => f.title)));
});

console.log('\n── B · the breakdown: explanation, never arithmetic ──');
const invoices = [{ vendorName: 'Landscaping Co', category: 'Landscaping', amount: 10000, invoiceDate: '2025-06-01', camEligible: true }];
const bkResults = RESULTS.map(r => ({ ...r, includedInvoices: [{ vendorName: 'Landscaping Co', category: 'Landscaping', amount: 10000, invoiceDate: '2025-06-01', allocatedAmount: r.totalAllocated }] }));
const base = VB.derive({ results: bkResults, invoices, pool: 10000, billed: 7000 });
const withVac = VB.derive({ results: bkResults, invoices, pool: 10000, billed: 7000, vacantPct: 30, vacantResolved: true });
const partVac = VB.derive({ results: bkResults, invoices, pool: 10000, billed: 7000, vacantPct: 20, vacantResolved: false });
const uncov = bk => (bk.lines || []).find(l => l.key === 'uncovered');

t('B1 the uncovered amount is identical with and without recorded vacancy', () => {
  eq([withVac.uncovered, partVac.uncovered], [base.uncovered, base.uncovered]);
  eq([withVac.difference, withVac.residual, withVac.explained], [base.difference, base.residual, base.explained]);
});
t('B2 no vacancy: the label and detail are the pre-existing words; vacantPct 0, unresolved = gap', () => {
  eq(uncov(base).label, 'Outside the 70.0% of the property covered by loaded leases');
  ok(/either vacant or under a lease not yet uploaded/.test(uncov(base).detail), uncov(base).detail);
  eq([base.vacantPct, base.unresolvedPct, base.vacantResolved], [0, 30, false]);
});
t('B3 resolved vacancy: the label carries it, the detail says the landlord’s share and no lease is missing', () => {
  eq(uncov(withVac).label, 'Outside the 70.0% of the property covered by loaded leases (30.0% recorded vacant)');
  ok(/is the landlord's/.test(uncov(withVac).detail) && /no lease is missing/.test(uncov(withVac).detail), uncov(withVac).detail);
  eq([withVac.vacantPct, withVac.unresolvedPct, withVac.vacantResolved], [30, 0, true]);
});
t('B4 partial vacancy: the detail states the vacant share and the remainder still open', () => {
  ok(/20\.0% is recorded as vacant space/.test(uncov(partVac).detail) && /remaining 10\.0%/.test(uncov(partVac).detail)
     && /vacant but not yet recorded, or under a lease not yet uploaded/.test(uncov(partVac).detail), uncov(partVac).detail);
  eq([partVac.vacantPct, partVac.unresolvedPct, partVac.vacantResolved], [20, 10, false]);
});
t('B5 the breakdown does not decide "resolved" itself — it repeats the caller’s verdict', () => {
  const said = VB.derive({ results: bkResults, invoices, pool: 10000, billed: 7000, vacantPct: 30 });
  eq(said.vacantResolved, false, 'vacantResolved was inferred from the percentages');
  const told = VB.derive({ results: bkResults, invoices, pool: 10000, billed: 7000, vacantPct: 5, vacantResolved: true });
  eq(told.vacantResolved, true);
});
// nextStep reads residual, precision, lines, invoices and the two vacancy
// fields; these shapes hold the derive() outputs with the residual settled.
const stepBk = (bk, lines) => ({ residual: 0, precision: 'legacy', invoices: [], vacantPct: bk.vacantPct, vacantResolved: bk.vacantResolved, lines });
t('B6 next step: an unresolved remainder says mark the space vacant; a resolved one yields nothing', () => {
  const L = [{ key: 'uncovered', amount: 3000 }];
  eq(VB.nextStep(stepBk(base, L)),    { cta: 'Upload the remaining leases, or mark the space vacant', key: 'uncovered' });
  eq(VB.nextStep(stepBk(partVac, L)), { cta: 'Upload the remaining leases, or record the rest of the vacant space', key: 'uncovered' });
  eq(VB.nextStep(stepBk(withVac, L)), null);
});
t('B7 next step falls through to the next bucket when the uncovered share is resolved', () => {
  const L = [{ key: 'uncovered', amount: 3000 }, { key: 'caps', amount: 100 }];
  eq(VB.nextStep(stepBk(withVac, L)), { cta: 'Review the CAM caps that were applied', key: 'caps' });
  eq(VB.nextStep(stepBk(base, L)),    { cta: 'Upload the remaining leases, or mark the space vacant', key: 'uncovered' });
});
t('B8 a negative or junk vacantPct reads as none', () => {
  const junk = VB.derive({ results: bkResults, invoices, pool: 10000, billed: 7000, vacantPct: -4 });
  eq([junk.vacantPct, uncov(junk).label], [0, 'Outside the 70.0% of the property covered by loaded leases']);
  const nan = VB.derive({ results: bkResults, invoices, pool: 10000, billed: 7000, vacantPct: 'lots' });
  eq(nan.vacantPct, 0);
});

console.log('\n── C · selectors: a vacancy is not a lease ──');
const sel = {};
['source-values.js', 'lease-intelligence.js', 'review-engine.js', 'selectors.js'].forEach(f => {
  new Function('window', fs.readFileSync(path.join(ROOT, f), 'utf8')).call({ window: sel }, sel);
});
global.SourceValues = sel.SourceValues; global.LeaseIntelligence = sel.LeaseIntelligence; global.ReviewEngine = sel.ReviewEngine;
const S = sel.Selectors;
const propWith = (extra) => ({
  id: 'p1', name: 'Test', totalSqft: 10000, disputes: [], invoices: [],
  tenants: [
    { id: 't1', tenant_name: 'Alder Dental', leased_sqft: 4000, lease_type: 'NNN', cap: 5, end_date: '2030-01-01', _confidence: 'high' },
    { id: 't2', tenant_name: 'Birch Books',  leased_sqft: 3000, lease_type: 'NNN', cap: 4, end_date: '2030-01-01', _confidence: 'high' },
  ].concat(extra || []),
});
t('C1 derivePropertyReadiness: a vacancy adds no expired, expiring, low-confidence or missing-cap count', () => {
  const a = S.derivePropertyReadiness(propWith([]));
  const b = S.derivePropertyReadiness(propWith([{ id: 'v1', tenant_name: '', suite: '300', leased_sqft: 3000, vacant: true, lease_type: 'NNN', end_date: '2000-01-01', _confidence: 'failed' }]));
  eq([b.expiredCount, b.expiringCount, b.lowConfCount, b.missingCapCount, b.riskScore, b.status],
     [a.expiredCount, a.expiringCount, a.lowConfCount, a.missingCapCount, a.riskScore, a.status]);
});
t('C2 portfolioKPIs: recorded vacant area is not occupied area (70%, not 100%)', () => {
  const k = S.portfolioKPIs([propWith([{ id: 'v1', suite: '300', leased_sqft: 3000, vacant: true }])]);
  eq(k.occupancyPct, 70);
});
t('C3 buildPropMeta counts leases, not spaces', () => {
  const a = S.buildPropMeta(propWith([]));
  const b = S.buildPropMeta(propWith([{ id: 'v1', suite: '300', leased_sqft: 3000, vacant: true }]));
  eq(b.tenantCount ?? b.tenants ?? null, a.tenantCount ?? a.tenants ?? null);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
