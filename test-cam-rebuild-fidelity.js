'use strict';
/**
 * test-cam-rebuild-fidelity.js — a reconciliation rebuilt from summary rows must
 * say what it cannot tell you.
 *
 *   node test-cam-rebuild-fidelity.js
 *
 * THE DEFECT THIS EXISTS FOR
 *
 * When the snapshot blob is missing, _mergeCamReconciliationRows rebuilds the
 * reconciliation from the normalized cam_reconciliations rows. It took each
 * tenant's dollar figure from the stored `actual_cam` — and then RECOMPUTED the
 * pro-rata share from `leased_sqft / totalSqft`:
 *
 *     allocatedAmount: t.actualCam,                                  // as billed
 *     proRataPercent:  (Number(t.leased_sqft) / totalSqft) * 100,    // as of today
 *
 * Two numbers from two different moments, printed side by side as though they
 * belonged to the same run. Re-measure a suite, amend a lease, or correct the
 * property's total square footage after the reconciliation, and the restored
 * record shows the amount that was billed beside a percentage that could never
 * have produced it. `pro_rata_percent` has been a column since migration 003 and
 * saveCamResults has always written it; the rebuild simply never read it.
 *
 * The same record also asserted `capApplied: false` — "no cap was applied" —
 * about rows that do not record caps at all, and gave every tenant the
 * property-wide invoice count as its own.
 *
 * WHY THIS MATTERS NOW
 *
 * T2 will add an occupancy factor to the allocation. A rebuilt record would then
 * show a stored, prorated dollar figure beside a recomputed, un-prorated
 * percentage — the same contradiction with more money behind it. Fixing the
 * rebuild first is the precondition, not a tidy-up.
 *
 * NO MIRROR. This suite extracts and runs the REAL function out of script.js.
 * test-cam-persistence.js carried an inline copy of it, which is how the
 * recompute survived a rewrite of the surrounding code without any test noticing.
 */

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');
const vm     = require('vm');

// ── The real function, not a copy of it ──────────────────────────────────────
const scriptSrc = fs.readFileSync(path.join(__dirname, 'script.js'), 'utf8');
function loadMerge() {
  const m = scriptSrc.match(/\nfunction _mergeCamReconciliationRows\(dbData, camRows\) \{[\s\S]*?\n\}\n/);
  if (!m) throw new Error('_mergeCamReconciliationRows not found in script.js — has it been renamed?');
  const box = {
    console: { log() {}, warn() {}, error() {} },
    parseFloat, parseInt, Number, String, Array, Object, JSON, Math, isFinite,
    getCamYear:         () => 2026,
    _appliedExclusions: () => [],
    _exclusionState:    () => ({ notApplied: [] }),
  };
  vm.createContext(box);
  vm.runInContext(m[0] + '\nthis.__f = _mergeCamReconciliationRows;', box);
  return box.__f;
}
const merge = loadMerge();

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log(`  \x1b[32m✓\x1b[0m ${name}`); pass++; }
  catch (e) { console.log(`  \x1b[31m✗\x1b[0m ${name}\n      → ${e.message}`); fail++; }
}
const ok = (c, m) => assert.ok(c, m);
const eq = (a, b, m) => assert.strictEqual(a, b, m || `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);

// A property whose square footage has MOVED since the reconciliation ran: the
// suite was re-measured from 10,000 to 12,500 sqft. The stored share is what was
// billed; a recomputed one is not.
const property = () => ({
  id: 'p-1', name: 'Marlow Court', totalSqft: 50000,
  invoices: [{ amount: '40000' }, { amount: '35000' }, { amount: '25000' }],
  tenants: [
    { id: 't-a', tenant_name: 'Aster Bakery',  leased_sqft: 12500 },   // was 10,000 at run time
    { id: 't-b', tenant_name: 'Brant Optical',  leased_sqft: 15000 },
    { id: 't-c', tenant_name: 'Coral Clinic',   leased_sqft: 5000  },
  ],
});
const rows = () => ([
  { tenant_id: 't-a', tenant_name: 'Aster Bakery', actual_cam: 20000, expected_cam: null,
    variance: null, allocated_amount: 20000, pro_rata_percent: 20, year: 2026 },
  { tenant_id: 't-b', tenant_name: 'Brant Optical', actual_cam: 30000, expected_cam: null,
    variance: null, allocated_amount: 30000, pro_rata_percent: 30, year: 2026 },
  { tenant_id: 't-c', tenant_name: 'Coral Clinic', actual_cam: 10000, expected_cam: null,
    variance: null, allocated_amount: 10000, pro_rata_percent: 10, year: 2026 },
]);
const rebuild = (mut) => {
  const d = property(); const r = rows();
  if (mut) mut(d, r);
  merge(d, r);
  return d;
};
const byName = (d, n) => (d.camReconciliation.results || []).find(x => x.name === n);

console.log('\n══ Rebuilt from summary rows ══');
console.log('\n── The share that was billed, read back ──');

t('THE DEFECT: the stored share is used, not one recomputed from current sqft', () => {
  const d = rebuild();
  const a = byName(d, 'Aster Bakery');
  eq(a.proRataPercent, 20, 'the rebuild recomputed the share from current square footage');
  // 12,500 / 50,000 = 25% today. The run billed 20%. They must not be confused.
  ok(a.proRataPercent !== 25, 'the recomputed 25% leaked through');
  eq(a.proRata, 0.2, 'the fractional alias disagrees with the percentage');
});

t('the amount and the share now come from the same moment', () => {
  const d = rebuild();
  ['Aster Bakery', 'Brant Optical', 'Coral Clinic'].forEach(n => {
    const r = byName(d, n);
    eq(r.proRataSource, 'stored', `${n} did not use the stored share`);
  });
});

t('a share of exactly 0 is a stored value, not a missing one', () => {
  // 0 is falsy. A `||` fallback here would silently recompute a real zero share.
  const d = rebuild((_, r) => { r[0].pro_rata_percent = 0; });
  const a = byName(d, 'Aster Bakery');
  eq(a.proRataPercent, 0);
  eq(a.proRataSource, 'stored');
});

t('a stored share arriving as a numeric string is still stored', () => {
  const d = rebuild((_, r) => { r[0].pro_rata_percent = '20'; });
  eq(byName(d, 'Aster Bakery').proRataPercent, 20);
  eq(byName(d, 'Aster Bakery').proRataSource, 'stored');
});

console.log('\n── A legacy row with no stored share is labelled, not disguised ──');

t('null falls back to a recomputed share', () => {
  const d = rebuild((_, r) => { r[0].pro_rata_percent = null; });
  const a = byName(d, 'Aster Bakery');
  eq(a.proRataPercent, 25, '12,500 of 50,000 sqft is 25%');
  eq(a.proRataSource, 'recomputed', 'a derived share is presented as the one that was billed');
});

t('and the others are unaffected by it', () => {
  const d = rebuild((_, r) => { r[0].pro_rata_percent = null; });
  eq(byName(d, 'Brant Optical').proRataSource, 'stored');
  eq(byName(d, 'Brant Optical').proRataPercent, 30);
});

t('an unparseable stored share is treated as missing, not as NaN', () => {
  const d = rebuild((_, r) => { r[0].pro_rata_percent = 'n/a'; });
  const a = byName(d, 'Aster Bakery');
  eq(a.proRataSource, 'recomputed');
  ok(Number.isFinite(a.proRataPercent), 'NaN reached the result');
});

console.log('\n── The record says what it cannot tell you ──');

t('a rebuilt record is marked, and names its source', () => {
  const d = rebuild();
  eq(d.camReconciliation.fidelity, 'reduced');
  eq(d.camReconciliation.rebuiltFrom, 'cam_reconciliations');
});

t('    and lists the reasons, not just a flag', () => {
  const reasons = rebuild().camReconciliation.fidelityReasons;
  ok(Array.isArray(reasons) && reasons.length >= 2, JSON.stringify(reasons));
  ok(reasons.some(r => /invoice/i.test(r)), 'the missing per-invoice breakdown is not disclosed');
  ok(reasons.some(r => /cap/i.test(r)),     'the unknown cap state is not disclosed');
});

t('    and says so when a share had to be recomputed', () => {
  const clean = rebuild().camReconciliation.fidelityReasons;
  ok(!clean.some(r => /recomputed/i.test(r)),
     'a fully-stored rebuild claims a share was recomputed');
  const one = rebuild((_, r) => { r[0].pro_rata_percent = null; }).camReconciliation.fidelityReasons;
  ok(one.some(r => /recomputed/i.test(r)), JSON.stringify(one));
  ok(one.some(r => /^1 tenant's/.test(r)), 'the count reads wrongly in the singular: ' + JSON.stringify(one));
  const two = rebuild((_, r) => { r[0].pro_rata_percent = null; r[1].pro_rata_percent = null; })
                .camReconciliation.fidelityReasons;
  ok(two.some(r => /^2 tenants'/.test(r)), 'the count reads wrongly in the plural: ' + JSON.stringify(two));
});

t('cap state is UNKNOWN, not "no cap applied"', () => {
  const d = rebuild();
  byName(d, 'Aster Bakery') && eq(byName(d, 'Aster Bakery').capApplied, null,
    '`false` asserts no cap was applied about rows that do not record caps');
  eq(byName(d, 'Aster Bakery').capAdjustment, null);
});

t('    and null stays falsy, so no consumer changes behaviour', () => {
  const d = rebuild();
  const capsCount = d.camReconciliation.results.filter(r => r.capApplied).length;
  eq(capsCount, 0, 'every existing consumer tests capApplied truthily — null must not become truthy');
});

console.log('\n── Everything the rebuild already got right, still right ──');

t('the amount billed is carried through untouched', () => {
  const d = rebuild();
  eq(byName(d, 'Aster Bakery').allocatedAmount, 20000);
  eq(byName(d, 'Aster Bakery').totalAllocated,  20000);
  eq(byName(d, 'Brant Optical').totalAllocated, 30000);
});

t('the blob snapshot still wins — no rebuild when one exists', () => {
  const d = property(); d.camReconciliation = { existing: true };
  merge(d, rows());
  eq(d.camReconciliation.existing, true, 'the rebuild overwrote an authoritative snapshot');
  eq(d.camReconciliation.fidelity, undefined, 'a full snapshot was marked reduced');
});

t('the per-tenant overlay still runs even when no rebuild happens', () => {
  const d = property(); d.camReconciliation = { existing: true };
  merge(d, rows());
  eq(d.tenants.find(x => x.id === 't-a').actualCam, 20000);
});

t('no rows is a no-op', () => {
  const d = property();
  merge(d, []);
  eq(d.camReconciliation, undefined);
});

t('a tenant with no reconciliation row is left out of the results', () => {
  const d = rebuild((dd, r) => { r.pop(); });   // drop Coral Clinic's row
  eq(d.camReconciliation.results.length, 2);
  eq(byName(d, 'Coral Clinic'), undefined);
});

console.log('\n── The notice reaches the screen ──');

t('[source] the summary panel renders the fidelity notice', () => {
  ok(/class="rcs-fidelity"/.test(scriptSrc), 'nothing renders the notice');
  ok(/_cr\.fidelity !== 'reduced'\) return '';/.test(scriptSrc),
     'the notice is not gated on the fidelity marker');
  ok(/fidelityReasons \|\| \[\]\)\.map/.test(scriptSrc), 'the reasons are not rendered');
});

t('[source] it sits ABOVE the KPI row it qualifies', () => {
  const notice = scriptSrc.indexOf('class="rcs-fidelity"');
  const kpis   = scriptSrc.indexOf('<div class="rcs-kpis">');
  ok(notice > 0 && kpis > 0, 'could not locate both');
  ok(notice < kpis, 'the notice renders after the figures it is meant to qualify');
});

t('[source] the reasons are escaped before rendering', () => {
  ok(/<li>\$\{esc\(r\)\}<\/li>/.test(scriptSrc), 'a fidelity reason is interpolated unescaped');
});

t('[source] no recomputed share survives in the rebuild', () => {
  const i = scriptSrc.indexOf('function _mergeCamReconciliationRows');
  const body = scriptSrc.slice(i, scriptSrc.indexOf('\n}\n', i));
  const stripped = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok(/row\.pro_rata_percent/.test(stripped), 'the stored column is never read');
  const recomputes = (stripped.match(/leased_sqft\) \|\| 0\) \/ totalSqft/g) || []).length;
  eq(recomputes, 1,
     `${recomputes} recompute(s) of the share — exactly one is expected, the labelled legacy fallback`);
});

console.log('\n' + '─'.repeat(58));
if (fail) { console.log(`\x1b[31mRESULT: ${pass} passed, ${fail} failed\x1b[0m`); process.exit(1); }
console.log(`\x1b[32mRESULT: ${pass} passed, 0 failed\x1b[0m`);
