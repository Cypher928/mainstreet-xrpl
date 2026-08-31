'use strict';
/**
 * test-cent-policy.js — every cent has an honest attribution, and the
 * decomposition can never buy that by moving a tenant's charge.
 *
 *   node test-cent-policy.js
 *
 * THE DEFECT THIS EXISTS FOR
 *
 * Three tenants at exactly one third of a building each, three $100 invoices,
 * nothing wrong with the reconciliation. The variance panel printed:
 *
 *     Outside the 100.0% of the property covered by loaded leases     $0.03
 *     Not attributed                                                 −$0.03
 *
 * on a building with no vacancy. 33.33 + 33.33 + 33.33 = 99.99, so `covered`
 * came out at 0.9999 and three cents were reported as belonging to space nobody
 * leases — while the same line's label said 100.0%.
 *
 * On the Kettle Row fixture the same mechanism was larger and worse: `uncovered`
 * over-stated by $1.06, and the offsetting −$1.06 printed under the label
 * "Excluded by a lease, or matched to no tenant". A rounding artefact presented
 * as a contractual exclusion, as a negative number.
 *
 * WHAT THIS SUITE HOLDS
 *
 * 1. THE SEPARATION. Allocation decides what a tenant is billed; decomposition
 *    explains the pool. The decomposition may never act as a plug. This is
 *    asserted three ways — the module never writes to its inputs, the tenant
 *    totals are reproducible from the engine alone with derive() never called,
 *    and freezing the inputs does not change a single figure.
 *
 * 2. THE IDENTITY CLOSES IN INTEGER CENTS, asserted as integers with no epsilon
 *    anywhere. `residual` must be exactly 0.
 *
 * 3. THE 1/3 x 3 REGRESSION. A fully-leased property reports no vacancy, and the
 *    three cents appear as rounding, under that name.
 *
 * 4. A GENUINE EXCLUSION IS TOLD APART FROM A ROUNDING RESIDUE. Two fixtures
 *    with the same dollar gap: one caused by an exclusion schedule, one by
 *    rounding. The labels, the buckets and the invoice rows must differ.
 *
 * 5. LEGACY RECORDS ARE NOT RECOMPUTED (D12). A pre-P6 snapshot keeps its billed
 *    dollars and is marked `legacy` rather than being given a clean zero it
 *    never had.
 *
 * Pure-module level: no browser needed, so this runs in a second and can be
 * mutated cheaply. The rendered end of the same change is covered by
 * test-partial-period-explanation.js and test-e2e-variance-flow.js.
 */

const assert = require('assert');
const MC = require('./money-cents.js');
const VB = require('./variance-breakdown.js');

let pass = 0, fail = 0;
const ok  = (m) => { console.log('  \x1b[32m✓\x1b[0m ' + m); pass++; };
const bad = (m, d) => { console.log('  \x1b[31m✗\x1b[0m ' + m + (d ? '\n      → ' + d : '')); fail++; };
const yes = (m, c, d) => c ? ok(m) : bad(m, d);
const R   = (l, v) => console.log('  ' + String(l).padEnd(34) + ':', typeof v === 'string' ? v : JSON.stringify(v));

// ── A miniature of the engine's allocation, to the same cent policy ─────────
//
// It mirrors runFullReconciliation's arithmetic exactly — the same MoneyCents
// calls in the same order — so the suite can build fixtures without a browser.
// test-partial-period-explanation.js is what proves the real engine agrees; this
// is what lets the cent policy itself be mutated and measured in a second.
function allocate(name, sqFt, totalSqFt, invoices, opts) {
  const o = opts || {};
  const excludeCats = o.exclude || [];
  const occ = o.occ || null;
  const temporal = (occ && occ.applied && occ.numerator != null && occ.denominator > 0)
    ? { n: occ.numerator, d: occ.denominator } : { n: 1, d: 1 };
  const spatial = MC.ratio(sqFt, totalSqFt);
  const shareCents = inv => MC.shareCents(MC.toCents(inv.amount) || 0, [spatial, temporal]);

  const isExcluded = inv => excludeCats.includes(String(inv.category || '').toLowerCase());
  // ELIGIBILITY FIRST, exactly as runFullReconciliation does it. An invoice the
  // manager unticked never reaches a tenant, and a helper that forgot this
  // double-counted it — once in every tenant's allocation and once in
  // `not_eligible` — which is a $2,152.74 negative residual and a fixture that
  // proves nothing.
  const usable   = invoices.filter(i => i.camEligible !== false);
  const shared   = usable.filter(i => (Number(i.matchConfidence) || 0) < 75);
  const direct   = usable.filter(i => (Number(i.matchConfidence) || 0) >= 75 && i.matchedTenant === name);

  const eligibleShared = shared.filter(i => !isExcluded(i));
  const excludedShares = shared.filter(isExcluded).map(i => ({
    id: i.id, vendorName: i.vendorName, category: i.category, scope: 'shared', cents: shareCents(i),
  }));
  direct.filter(isExcluded).forEach(i => excludedShares.push({
    id: i.id, vendorName: i.vendorName, category: i.category, scope: 'direct',
    cents: MC.toCents(i.amount) || 0,
  }));

  const sharedCents = eligibleShared.map(shareCents);
  const own         = direct.filter(i => !isExcluded(i));
  const ownCents    = own.map(i => MC.toCents(i.amount) || 0);
  let rawCents = sharedCents.reduce((s, c) => s + c, 0) + ownCents.reduce((s, c) => s + c, 0);

  let capApplied = false, capAdjustment = null;
  if (o.capBase != null && o.capPct != null) {
    const capCents = MC.toCents(o.capBase * (1 + o.capPct / 100));
    if (capCents !== null && rawCents > capCents) {
      capAdjustment = MC.fromCents(rawCents - capCents); rawCents = capCents; capApplied = true;
    }
  }

  return {
    name, sqFt, totalSqFt, precision: 'cents',
    proRataPercent: parseFloat((sqFt / totalSqFt * 100).toFixed(2)),
    totalAllocated: MC.fromCents(rawCents),
    includedInvoices: [
      ...eligibleShared.map((i, k) => ({ ...i, allocation: 'shared',
        amount: MC.fromCents(MC.toCents(i.amount) || 0), share: MC.fromCents(sharedCents[k]) })),
      ...own.map((i, k) => ({ ...i, allocation: 'direct',
        amount: MC.fromCents(ownCents[k]), share: MC.fromCents(ownCents[k]) })),
    ],
    capApplied, capAdjustment, occupancy: occ, ambiguityFlags: [], excludedShares,
  };
}

const run = (results, invoices) => {
  const pool   = MC.fromCents(MC.sumCents(invoices, i => i.amount));
  const billed = MC.fromCents(results.reduce((s, r) => s + (MC.toCents(r.totalAllocated) || 0), 0));
  return { bk: VB.derive({ results, invoices, pool, billed }), pool, billed };
};

const inv = (id, amount, category, extra) => Object.assign(
  { id, vendorName: id, amount, category, camEligible: true, matchConfidence: 0 }, extra || {});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n══ 1 · The 1/3 x 3 regression — a fully leased property has no vacancy ══');

const THIRDS = [inv('a', 100, 'x'), inv('b', 100, 'x'), inv('c', 100, 'x')];
const thirdsResults = ['A', 'B', 'C'].map(n => allocate(n, 10000, 30000, THIRDS));
const thirds = run(thirdsResults, THIRDS);

R('pool / billed', `${thirds.pool} / ${thirds.billed}`);
R('lines', thirds.bk.lines.map(l => `${l.key}=${l.amount}`));

yes('the property is fully leased, so NO uncovered line is rendered at all',
    thirds.bk.uncovered === 0 && !thirds.bk.lines.some(l => l.key === 'uncovered'),
    JSON.stringify(thirds.bk.lines));
yes('    — this is the $0.03 of phantom vacancy the panel used to print',
    thirds.bk.uncovered !== 0.03, String(thirds.bk.uncovered));
yes('the three cents appear as rounding, under that name',
    thirds.bk.roundingResidue === 0.03
      && thirds.bk.lines.some(l => l.key === 'rounding_residue' && l.amount === 0.03),
    JSON.stringify({ residue: thirds.bk.roundingResidue }));
yes('    and the rounding line offers no next step, because there is nothing to fix',
    VB.nextStep(thirds.bk) === null, JSON.stringify(VB.nextStep(thirds.bk)));
yes('nothing lands in an exclusion bucket',
    thirds.bk.excludedByLease === 0 && thirds.bk.claimShortfall === 0);
yes('the residual is EXACTLY zero, and the panel says so',
    thirds.bk.residual === 0 && thirds.bk.explained === true,
    JSON.stringify({ residual: thirds.bk.residual, explained: thirds.bk.explained }));
yes('every tenant total is the sum of its own line items (D5)',
    thirdsResults.every(r => MC.toCents(r.totalAllocated)
      === r.includedInvoices.reduce((s, i) => s + MC.toCents(i.share), 0)),
    JSON.stringify(thirdsResults.map(r => r.totalAllocated)));
yes('    which is $99.99, not the $100.00 the rounded sum used to bill',
    thirdsResults.every(r => r.totalAllocated === 99.99));

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n══ 2 · A genuine lease exclusion vs a rounding residue ══');
//
// TWO FIXTURES, THE SAME $900 GAP. One is a lease term; one is arithmetic. The
// old `claim` bucket could not tell them apart and put both under "Excluded by
// a lease" — which is how a NEGATIVE $1.06 came to carry that label.

// FIXTURE E — the gap is an exclusion schedule. B's lease excludes repairs.
const INV_E = [inv('rep', 1800, 'repairs'), inv('jan', 1000, 'janitorial')];
const resE  = [allocate('A', 15000, 30000, INV_E),
               allocate('B', 15000, 30000, INV_E, { exclude: ['repairs'] })];
const E = run(resE, INV_E);

// FIXTURE R — no exclusion anywhere; the same pool, a gap from coverage, and a
// non-terminating third so cents are genuinely in play.
const INV_R = [inv('rep', 1800, 'repairs'), inv('jan', 1000, 'janitorial')];
const resR  = [allocate('A', 10000, 30000, INV_R)];
const R_ = run(resR, INV_R);

R('E · lines', E.bk.lines.map(l => `${l.key}=${l.amount}`));
R('R · lines', R_.bk.lines.map(l => `${l.key}=${l.amount}`));

yes('E · the exclusion lands in excluded_by_lease, at exactly $900.00',
    E.bk.excludedByLease === 900
      && E.bk.lines.some(l => l.key === 'excluded_by_lease' && l.amount === 900),
    JSON.stringify(E.bk.lines));
// Independently computed from the fixture itself: half the building, whole
// period, one $1,800 invoice. If the engine ever stopped RECORDING the decision
// and went back to inferring it by subtraction, this is what would move.
yes('    and that figure is amount x sqFt/totalSqFt, computed independently here',
    E.bk.excludedByLease === MC.fromCents(MC.shareCents(180000, [MC.ratio(15000, 30000), { n: 1, d: 1 }])),
    String(E.bk.excludedByLease));
yes('    the invoice row names the exclusion rather than calling it unallocated',
    E.bk.invoices.find(r => r.id === 'rep').reason === 'partly_excluded'
      && E.bk.invoices.find(r => r.id === 'rep').excludedShare === 900,
    JSON.stringify(E.bk.invoices.find(r => r.id === 'rep')));
yes('    E carries no rounding residue — the gap is entirely contractual',
    E.bk.roundingResidue === 0, String(E.bk.roundingResidue));
yes('    and its next step sends the manager to the exclusion schedules',
    (VB.nextStep(E.bk) || {}).key === 'excluded_by_lease', JSON.stringify(VB.nextStep(E.bk)));

yes('R · NO excluded_by_lease line is rendered, because no lease excludes anything',
    R_.bk.excludedByLease === 0 && !R_.bk.lines.some(l => l.key === 'excluded_by_lease'),
    JSON.stringify(R_.bk.lines));
yes('    its gap is coverage, and it says so',
    R_.bk.lines[0].key === 'uncovered', JSON.stringify(R_.bk.lines[0]));
yes('    no bucket on either fixture is negative',
    [...E.bk.lines, ...R_.bk.lines].every(l => l.amount >= 0),
    JSON.stringify([...E.bk.lines, ...R_.bk.lines].filter(l => l.amount < 0)));
yes('    both fixtures close to exactly zero',
    E.bk.residual === 0 && R_.bk.residual === 0,
    JSON.stringify({ E: E.bk.residual, R: R_.bk.residual }));

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n══ 3 · The identity closes in integer cents, with no tolerance ══');

const BUCKETS = ['outOfYear', 'notEligible', 'uncovered', 'notOccupied', 'claimShortfall',
                 'excludedByLease', 'unclaimed', 'roundingResidue', 'capTotal'];

// A property carrying every condition at once: vacancy, a part-period tenant,
// an exclusion, a direct invoice, an ineligible invoice, a cap with a fractional
// ceiling, and two non-terminating shares.
const OCC = { applied: true, unit: 'days', numerator: 245, denominator: 365,
              factor: 245 / 365, overlapStart: '2025-05-01', overlapEnd: '2025-12-31' };
const INV_ALL = [
  inv('i1', 12500, 'janitorial'),
  inv('i2', 9000,  'insurance'),
  inv('i3', 6100,  'repairs'),
  inv('i4', 4200,  'security'),
  inv('i5', 2400,  'utilities', { matchConfidence: 90, matchedTenant: 'B' }),
  inv('i6', 3000,  'capital',   { camEligible: false }),
];
const resALL = [
  allocate('A', 10000, 30000, INV_ALL),
  allocate('B', 6000,  30000, INV_ALL, { occ: OCC }),
  allocate('C', 4500,  30000, INV_ALL, { exclude: ['repairs'] }),
  allocate('D', 3000,  30000, INV_ALL, { capBase: 1000, capPct: 7.5 }),
];
const ALL = run(resALL, INV_ALL);

R('pool / billed / difference', `${ALL.pool} / ${ALL.billed} / ${ALL.bk.difference}`);
ALL.bk.lines.forEach(l => R('  ' + l.key, l.amount));

const bucketCents = BUCKETS.reduce((s, k) => s + MC.toCents(ALL.bk[k]), 0);
const diffCents   = MC.toCents(ALL.bk.difference);
yes('pool − billed === the sum of every bucket, as INTEGERS (no epsilon)',
    Number.isInteger(bucketCents) && Number.isInteger(diffCents) && bucketCents === diffCents,
    `${bucketCents} vs ${diffCents}`);
yes('    residual is exactly 0 and `explained` is true',
    ALL.bk.residual === 0 && ALL.bk.explained === true, JSON.stringify(ALL.bk.residual));
yes('    every per-invoice row closes to its own amount, in cents',
    ALL.bk.invoices.every(r => {
      if (!r.considered || !r.eligible) return true;
      const parts = ['allocated', 'coverageShare', 'occupancyShare', 'excludedShare',
                     'unclaimedShare', 'residueShare'].reduce((s, k) => s + MC.toCents(r[k]), 0);
      return parts === MC.toCents(r.amount);
    }),
    JSON.stringify(ALL.bk.invoices.map(r => ({ id: r.id, amt: r.amount, alloc: r.allocated }))));
yes('    the fractional cap ceiling is applied at the cent it prints (D6)',
    resALL[3].capApplied && MC.toCents(1000 * 1.075) === 107500
      && MC.toCents(resALL[3].totalAllocated) === 107500,
    JSON.stringify({ total: resALL[3].totalAllocated, adj: resALL[3].capAdjustment }));
yes('    the ineligible invoice is still the whole of not_eligible',
    ALL.bk.notEligible === 3000, String(ALL.bk.notEligible));
yes('    the exclusion is named, not folded into a coverage gap',
    ALL.bk.excludedByLease > 0 && ALL.bk.claimShortfall === 0,
    JSON.stringify({ excl: ALL.bk.excludedByLease, claim: ALL.bk.claimShortfall }));

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n══ 4 · THE SEPARATION — decomposition can never move a tenant charge ══');
//
// Allocation determines what a tenant is billed. Decomposition explains the
// pool. The second may never adjust the first to make an identity close. Three
// independent proofs, because one of them being a comment is not a proof.

// (a) The tenant totals are reproducible from the engine alone.
const preTotals = resALL.map(r => r.totalAllocated);
const preShares = resALL.map(r => r.includedInvoices.map(i => i.share));
yes('[a] every tenant total is the sum of its rounded lines, with derive() never called',
    resALL.every(r => {
      const lines = r.includedInvoices.reduce((s, i) => s + MC.toCents(i.share), 0);
      const capped = r.capApplied ? lines - MC.toCents(r.capAdjustment) : lines;
      return MC.toCents(r.totalAllocated) === capped;
    }),
    JSON.stringify(preTotals));

// (b) derive() does not write to its inputs.
const again = run(resALL, INV_ALL);
yes('[b] running the decomposition again leaves every billed figure identical',
    JSON.stringify(resALL.map(r => r.totalAllocated)) === JSON.stringify(preTotals)
      && JSON.stringify(resALL.map(r => r.includedInvoices.map(i => i.share))) === JSON.stringify(preShares),
    JSON.stringify(resALL.map(r => r.totalAllocated)));
yes('    and produces byte-identical buckets — it is a pure function of its inputs',
    JSON.stringify(again.bk.lines) === JSON.stringify(ALL.bk.lines));

// (c) FROZEN INPUTS. If the decomposition ever tried to adjust an allocation to
// close the identity, this would throw in strict mode rather than silently
// succeed. It is the assertion that makes the boundary structural rather than
// intended.
const frozen = resALL.map(r => {
  const copy = { ...r,
    includedInvoices: r.includedInvoices.map(i => Object.freeze({ ...i })),
    excludedShares:   r.excludedShares.map(e => Object.freeze({ ...e })) };
  Object.freeze(copy.includedInvoices); Object.freeze(copy.excludedShares);
  return Object.freeze(copy);
});
const frozenInv = INV_ALL.map(i => Object.freeze({ ...i }));
Object.freeze(frozenInv);
let frozeOk = true, frozeErr = '';
let frozenBk = null;
try {
  frozenBk = VB.derive({ results: frozen, invoices: frozenInv,
    pool: ALL.pool, billed: ALL.billed });
} catch (e) { frozeOk = false; frozeErr = String(e && e.message); }
yes('[c] the decomposition runs against DEEP-FROZEN results and invoices without throwing',
    frozeOk, frozeErr);
yes('    and reaches the same answer, so it never needed to write to them',
    frozenBk && JSON.stringify(frozenBk.lines) === JSON.stringify(ALL.bk.lines),
    frozenBk ? JSON.stringify(frozenBk.lines) : 'no result');
yes('    the identity still closes with the inputs immutable',
    frozenBk && frozenBk.residual === 0);

// (d) The largest-remainder sweep is not given the allocation to move.
const srcVB = require('fs').readFileSync(require('path').join(__dirname, 'variance-breakdown.js'), 'utf8');
const lrCall = /largestRemainder\(\[([^\]]*)\]/.exec(srcVB);
yes('[d] [source] the remainder sweep is handed only unallocated buckets',
    lrCall && !/alloc/i.test(lrCall[1]) && /uncoveredE/.test(lrCall[1]) && /exclC/.test(lrCall[1]),
    lrCall ? lrCall[1] : 'no largestRemainder call found');
// D6 — the ceiling the tenant is shown must be the ceiling the engine applied.
// Both sides go through the same quantiser; a fixture cannot tell them apart
// once they agree, so this is asserted where the two expressions live.
const srcJS = require('fs').readFileSync(require('path').join(__dirname, 'script.js'), 'utf8');
yes('[source] the engine caps at a ceiling quantised to cents (D6)',
    /const capCents = _MC\.toCents\(lease\.capBaseAmount \* \(1 \+ lease\.capPercentage \/ 100\)\)/.test(srcJS),
    'the engine still caps at an unrounded product');
yes('[source] and the statement prints that same quantised ceiling',
    /_capCeiling = _capTermsKnown\s*\n\s*\? window\.MoneyCents\.fromCents\(window\.MoneyCents\.toCents\(_capBase \* \(1 \+ _capPct \/ 100\)\)\)/.test(srcJS),
    'the statement still prints an unrounded ceiling');
// The rational is evaluated in BigInt so a tie can never land on the wrong side
// of a cent. NOTE, honestly: a search over ~2,000,000 amount/share/period
// combinations found NO case where sequential float arithmetic reaches a
// different cent. This is a guarantee, not a measured fix, and it is asserted at
// the source because no realistic fixture distinguishes it.
yes('[source] the rational is divided exactly, half-up, in BigInt',
    /var q = \(2n \* a \+ b\) \/ \(2n \* b\);/.test(
      require('fs').readFileSync(require('path').join(__dirname, 'money-cents.js'), 'utf8')));
yes('    [source] and a bucket can never come out negative',
    /n > 0 \? n : 0;\s*\/\/ a bucket is never negative/.test(
      require('fs').readFileSync(require('path').join(__dirname, 'money-cents.js'), 'utf8')));

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n══ 4b · The residual is a real signal, not a rounded-away one ══');
//
// `residual` only means something if it can be non-zero. Two conditions that
// must reach it rather than being laundered through a substantive bucket.

// (i) A billed total that disagrees with the results it came from — a stale or
// corrupted screen state. This is precisely what the residual line exists for.
const stale = VB.derive({ results: resALL, invoices: INV_ALL,
  pool: ALL.pool, billed: ALL.billed + 5 });
yes('a billed total that disagrees with the results produces a non-zero residual',
    stale.residual !== 0, String(stale.residual));
yes('    and the panel refuses to call it explained',
    stale.explained === false, JSON.stringify({ residual: stale.residual, explained: stale.explained }));
yes('    — a five-cent tolerance would have hidden a five-cent version of this',
    VB.derive({ results: resALL, invoices: INV_ALL, pool: ALL.pool, billed: ALL.billed + 0.01 })
      .explained === false);
yes('    and it sends the reader to the invoice register',
    (VB.nextStep(stale) || {}).key === 'residual', JSON.stringify(VB.nextStep(stale)));

// (ii) AN OVER-ALLOCATED BUILDING. Two 20,000 sqft leases in a 30,000 sqft
// property is a real condition the app already warns about, and it makes the
// exact `uncovered` NEGATIVE. A bucket must never go negative and the rounding
// bucket must never absorb the difference — it would report a genuine data
// defect as "rounding to the nearest cent".
const OVER_INV = [inv('o1', 900, 'janitorial')];
const overResults = ['A', 'B'].map(n => allocate(n, 20000, 30000, OVER_INV));
const over = run(overResults, OVER_INV);
R('over-allocated lines', over.bk.lines.map(l => `${l.key}=${l.amount}`));
yes('an over-allocated building produces no negative bucket',
    over.bk.lines.filter(l => l.key !== 'residual').every(l => l.amount >= 0),
    JSON.stringify(over.bk.lines));
yes('    the rounding bucket does not absorb it — it stays a measured quantity',
    Math.abs(over.bk.roundingResidue) < 1, String(over.bk.roundingResidue));
yes('    the difference surfaces in `residual`, the line that means the numbers may be wrong',
    over.bk.residual !== 0 && over.bk.explained === false,
    JSON.stringify({ residual: over.bk.residual, explained: over.bk.explained }));

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n══ 5 · Legacy records keep their dollars and are marked as legacy (D12) ══');

// A pre-P6 snapshot: no totalSqFt, no excludedShares, no precision stamp, and
// totalAllocated computed the old way (round2 of the exact sum) so it does NOT
// equal the sum of its lines.
const legacyResults = [{
  name: 'A', sqFt: 10000, proRataPercent: 33.33,
  totalAllocated: 100.00,                      // round2(300 x 1/3) — the old rule
  includedInvoices: THIRDS.map(i => ({ ...i, allocation: 'shared', share: 33.33 })),
  capApplied: false, capAdjustment: null, occupancy: null, ambiguityFlags: [],
}];
const legacySnapshotBefore = JSON.stringify(legacyResults);
const legacy = VB.derive({ results: legacyResults, invoices: THIRDS, pool: 300, billed: 100 });

R('legacy precision', legacy.precision);
R('legacy lines', legacy.lines.map(l => `${l.key}=${l.amount}`));

yes('a pre-P6 record is marked legacy, not silently recomputed under the new policy',
    legacy.precision === 'legacy', legacy.precision);
yes('    its stored billed total is untouched by the panel',
    legacyResults[0].totalAllocated === 100 && legacyResults[0].includedInvoices[0].share === 33.33);
// A SAVED RECONCILIATION IS A RECORD OF WHAT WAS BILLED. Reopening it runs the
// new decomposition over the old dollars; the dollars may not move a cent.
yes('    the whole snapshot is byte-identical after the panel has read it',
    JSON.stringify(legacyResults) === legacySnapshotBefore,
    'the variance panel wrote to a saved reconciliation');
yes('    and its residual is preserved honestly rather than manufactured to zero',
    legacy.residual === -0.01,
    `a pre-P6 record was given a clean zero it never had (${legacy.residual})`);
yes('    it claims no excluded_by_lease figure, because it cannot establish one',
    legacy.excludedByLease === 0 && !legacy.lines.some(l => l.key === 'excluded_by_lease'));
yes('    and it keeps the old five-cent tolerance, because its arithmetic cannot reach zero',
    legacy.explained === (Math.abs(legacy.residual) < 0.05));
yes('a P6 record is marked cents',
    ALL.bk.precision === 'cents' && thirds.bk.precision === 'cents');

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n══ 6 · The cent boundary itself ══');

yes('a general-ledger float artefact quantises to the cent it displays as',
    MC.toCents(1234.56 - 1000.01) === 23455 && MC.toCents(8.3 - 2.2) === 610,
    JSON.stringify([MC.toCents(1234.56 - 1000.01), MC.toCents(8.3 - 2.2)]));
yes('    and is NOT reported as sub-cent, because it is the float form of a clean value',
    MC.quantise(1234.56 - 1000.01).changed === false);
yes('a genuinely sub-cent source IS reported as sub-cent (D9b evidence)',
    MC.quantise(1234.567).changed === true && MC.quantise(1234.567).cents === 123457,
    JSON.stringify(MC.quantise(1234.567)));
yes('half-up is symmetric about zero, so a credit rounds like a charge',
    MC.toCents(0.005) === 1 && MC.toCents(-0.005) === -1);
yes('a pool of eight clean amounts sums exactly, where floats drift',
    MC.sumCents([12500, 9000, 6100, 4200, 2400, 1800, 0.10, 0.20]) === 3600030
      && (12500 + 9000 + 6100 + 4200 + 2400 + 1800 + 0.10 + 0.20) !== 36000.30,
    String(12500 + 9000 + 6100 + 4200 + 2400 + 1800 + 0.10 + 0.20));
yes('one third of $12,500 over a full year is the billed cent, exactly',
    MC.shareCents(1250000, [MC.ratio(10000, 30000), { n: 365, d: 365 }]) === 416667);
yes('    and 245/365 of a fifth of it likewise',
    MC.shareCents(1250000, [MC.ratio(6000, 30000), { n: 245, d: 365 }]) === 167808);
yes('a missing denominator apportions nothing rather than billing the lot',
    MC.shareCents(100000, [{ n: 1, d: 0 }]) === 0);
yes('largest remainder is deterministic and order-stable',
    JSON.stringify(MC.largestRemainder([0.4, 0.4, 0.4], 1).parts) === '[1,0,0]'
      && JSON.stringify(MC.largestRemainder([33.4, 33.3, 33.3], 100).parts) === '[34,33,33]');

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n' + '─'.repeat(58));
console.log(fail === 0
  ? `\x1b[32mRESULT: ${pass} passed, 0 failed\x1b[0m`
  : `\x1b[31mRESULT: ${pass} passed, ${fail} failed\x1b[0m`);
process.exit(fail > 0 ? 1 : 0);
