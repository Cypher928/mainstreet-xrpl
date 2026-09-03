'use strict';
/**
 * test-occupancy-allocation.js — T2: the factor reaches the money, and only
 * where it belongs.
 *
 *   node test-occupancy-allocation.js
 *
 * WHAT T2 IS
 *
 * A tenant's CAM share has two independent multiplicands: how much of the
 * BUILDING it holds, and how much of the PERIOD it occupied. The product had
 * only the first, so a tenant who took occupancy on 1 September was billed all
 * twelve months.
 *
 * THE FOUR THINGS THAT CAN GO WRONG, AND ARE PINNED HERE
 *
 *   1. The factor multiplies a DIRECT invoice. A direct match bills the whole
 *      invoice to one tenant — their own submeter, their own repair. Four
 *      twelfths of a specific charge is not a smaller version of the right
 *      answer, it is the wrong operation.
 *
 *   2. proRataPercent quietly becomes the occupancy-adjusted share. Then the
 *      statement can no longer explain itself, and the variance panel cannot
 *      tell vacancy from a part-year lease.
 *
 *   3. One tenant's unoccupied share is redistributed to the others. The
 *      variance banner promises in words that this never happens.
 *
 *   4. The decimal factor is stored instead of the rational. 243/365 replays
 *      exactly; 0.66575342 does not.
 */

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');
const vm     = require('vm');

const LP = require('./lease-period.js');
const VB = require('./variance-breakdown.js');

// The REAL runFullReconciliation, extracted and run — not a model of it.
const scriptSrc = fs.readFileSync(path.join(__dirname, 'script.js'), 'utf8');
function extract(re, label) {
  const m = scriptSrc.match(re);
  if (!m) throw new Error(`could not extract ${label} from script.js`);
  return m[0];
}
function loadEngine() {
  const src = [
    extract(/\nclass Invoice \{[\s\S]*?\n\}\n/, 'class Invoice'),
    extract(/\nclass Lease \{[\s\S]*?\n\}\n/, 'class Lease'),
    extract(/\nclass ReconciliationResult \{[\s\S]*?\n\}\n/, 'class ReconciliationResult'),
    extract(/\nfunction parseSqft\(v\) \{[\s\S]*?\n\}\n/, 'parseSqft'),
    extract(/\nfunction parseMoney\(v\) \{[\s\S]*?\n\}\n/, 'parseMoney'),
    // H — the engine's cap ceiling and its expected-CAM derivation; the cap gate
    // and the expectation both call these, so the sandbox supplies them for the
    // same reason it supplies MoneyCents: they are the engine's own arithmetic.
    extract(/\nfunction _camCeilingCents\(capBaseAmount, capPercentage\) \{[\s\S]*?\n\}\n/, '_camCeilingCents'),
    extract(/\nfunction _camExpectation\(capBaseAmount, capPercentage, actualCam\) \{[\s\S]*?\n\}\n/, '_camExpectation'),
    extract(/\nfunction runFullReconciliation\(property\) \{[\s\S]*?\n\}\n/, 'runFullReconciliation'),
  ].join('\n');
  let _live = [];
  const box = {
    console: { log() {}, warn() {}, error() {}, groupCollapsed() {}, groupEnd() {} },
    window: { SourceValues: require('./source-values.js'),
              CamPool:      require('./cam-pool.js'),
              // P6 — the engine's money arithmetic goes through the canonical
              // integer-cent boundary, so the harness has to provide it the same
              // way it provides the other modules the engine owns nothing of.
              MoneyCents:   require('./money-cents.js'),
              LeasePeriod:  LP },
    parseFloat, parseInt, isNaN, Number, Math, Date, JSON, Set, Array, Object, String, Boolean,
    currentProperty: () => ({ tenants: _live }),
    // THE ENGINE SETS matchConfidence FROM THIS. A stub returning null makes
    // every invoice shared, which quietly turns the direct-invoice assertions
    // below into assertions about the shared path — they would have passed for
    // the wrong reason. Behaves like the real matcher: an exact vendor/tenant
    // name match is a direct assignment.
    matchInvoiceToTenant: (inv, leases) => {
      const v = String(inv.vendorName || inv.vendor || '').toLowerCase().trim();
      const l = (leases || []).find(x => String(x.tenantName || '').toLowerCase().trim() === v);
      const match = l ? { tenantName: l.tenantName, tenantId: l.id, confidence: 100, reason: 'vendor name' } : null;
      // F-14 — the matcher now always returns a shape: `.match` is the decision,
      // and the rest is what it passed over (ties, suppressed short identifiers).
      return { match, candidates: match ? [match] : [], tied: match ? [match] : [],
               ambiguous: false, nearMisses: [] };
    },
    matchesTenant: (inv, lease) =>
      String(inv.vendorName || '').toLowerCase() === String(lease.tenantName || '').toLowerCase(),
    showToast: () => {},
    _fmtMoney: n => '$' + Number(n).toFixed(2),
  };
  vm.createContext(box);
  vm.runInContext(src + '\nthis.__run = runFullReconciliation;'
                      + '\nthis.__Lease = Lease; this.__Invoice = Invoice;', box);
  return { run: box.__run, Lease: box.__Lease, Invoice: box.__Invoice,
           setLive: (t) => { _live = t; } };
}
const { run, Lease, Invoice, setLive } = loadEngine();
const parseFloatSafe = parseFloat;

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log(`  \x1b[32m✓\x1b[0m ${name}`); pass++; }
  catch (e) { console.log(`  \x1b[31m✗\x1b[0m ${name}\n      → ${e.message}`); fail++; }
}
const ok = (c, m) => assert.ok(c, m);
const eq = (a, b, m) => assert.strictEqual(a, b, m || `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
const near = (a, b, m) => assert.ok(Math.abs(a - b) < 0.011, m || `expected ~${b}, got ${a}`);

// ── Marlowe Yard: 100,000 sqft, exactly 100% leased, $100,000 pool ──────────
// Round numbers on purpose: 20% of $100,000 is $20,000, so an apportioned
// figure is unmistakable rather than a plausible-looking near miss.
const INVOICES = [
  { id: 'i1', vendorName: 'Ashfield Janitorial', amount: 40000, category: 'janitorial', invoiceDate: '2026-02-01', camEligible: true },
  { id: 'i2', vendorName: 'Bellrock Insurance',  amount: 35000, category: 'insurance',  invoiceDate: '2026-01-15', camEligible: true },
  { id: 'i3', vendorName: 'Calder Utilities',    amount: 25000, category: 'utilities',  invoiceDate: '2026-06-01', camEligible: true },
];
const T = (over) => Object.assign({
  id: 'x', tenant_name: 'X', leased_sqft: 20000,
  lease_type: 'Triple Net (NNN)', start_date: '2018-01-01', end_date: '2032-12-31',
  cap: '', capBaseAmount: '', excluded_categories: '',
}, over);
const TENANTS = () => ([
  T({ id: 'a', tenant_name: 'Ashen Co',   leased_sqft: 40000 }),                     // 40%, full period
  T({ id: 'b', tenant_name: 'Brandt Ltd', leased_sqft: 20000 }),                     // 20%, full period
  T({ id: 'c', tenant_name: 'Corbin Inc', leased_sqft: 20000 }),                     // 20%
  T({ id: 'd', tenant_name: 'Dunmore Plc', leased_sqft: 20000 }),                    // 20%
]);
// The engine takes Lease and Invoice objects and reads live tenant state through
// currentProperty(), exactly as runAllocation hands them over. Built the same
// way here so the sandbox exercises the real boundary rather than a convenient
// one — including `lease.id`, which is how a result is matched back to a tenant.
const property = (mut) => {
  const p = { id: 'p', name: 'Marlowe Yard', totalSqft: 100000, camYear: 2026,
              invoices: JSON.parse(JSON.stringify(INVOICES)), tenants: TENANTS() };
  if (mut) mut(p);
  return p;
};
const go = (mut) => {
  const p = property(mut);
  setLive(p.tenants);
  const leases = p.tenants.map(t => {
    const l = new Lease(t.tenant_name, '', parseFloat(t.leased_sqft) || 0,
      t.start_date || '', t.end_date || '',
      String(t.excluded_categories || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean),
      t.cap ? parseFloat(t.cap) : (t.cap === '0' ? 0 : null),
      t.capBaseAmount ? parseFloat(t.capBaseAmount) : null,
      false, null, t.lease_type || null);
    l.id = t.id;
    return l;
  });
  const invoices = p.invoices.map(inv => {
    const i = new Invoice(inv.id || null, inv.invoiceDate, inv.amount, inv.vendorName, inv.category, '',
                          { camEligible: inv.camEligible });
    return i;
  });
  const out = run({ leases, invoices, totalSqFt: p.totalSqft, camYear: p.camYear });
  // The invoice records this run was built from, carried alongside the results so
  // a test can hand BOTH to VarianceBreakdown — which needs the register shape
  // (id, amount, camEligible, matchConfidence), not the engine's Invoice objects.
  try { Object.defineProperty(out, '_invoices', { value: p.invoices, enumerable: false }); }
  catch (_) {}
  return out;
};
const of_ = (res, name) => res.find(r => r.tenantName === name);

console.log('\n══ Occupancy reaches the money ══');
console.log('\n── The baseline: everyone full-period ──');

const base = go();

t('a fully-leased property bills the whole pool', () => {
  near(base.reduce((s, r) => s + r.totalAllocated, 0), 100000);
  eq(of_(base, 'Ashen Co').totalAllocated, 40000);
  eq(of_(base, 'Brandt Ltd').totalAllocated, 20000);
});

t('a full-period lease carries a factor of exactly 1, applied', () => {
  const o = of_(base, 'Ashen Co').occupancy;
  ok(o, 'no occupancy recorded on the result at all');
  eq(o.factor, 1); eq(o.numerator, 365); eq(o.denominator, 365); eq(o.applied, true);
});

console.log('\n── A lease that covers part of the period ──');

// Corbin occupies 1 Jan – 31 Aug: 243 of 365 days.
const partial = go(p => { p.tenants[2].end_date = '2026-08-31'; });

t('THE FIX: its share is reduced by the occupancy factor', () => {
  // 20% of $100,000 = $20,000, at 243/365 = $13,315.07
  near(of_(partial, 'Corbin Inc').totalAllocated, 13315.07);
});

t('the rational is stored, not just the decimal', () => {
  const o = of_(partial, 'Corbin Inc').occupancy;
  eq(o.numerator, 243, 'the day count is not stored — 0.66575342 does not replay exactly');
  eq(o.denominator, 365);
  eq(o.unit, 'days');
  eq(o.overlapDays, 243); eq(o.periodDays, 365);
  eq(o.overlapStart, '2026-01-01'); eq(o.overlapEnd, '2026-08-31');
  // Reproducing from the stored rational must give back the billed figure.
  near(100000 * 0.20 * (o.numerator / o.denominator), of_(partial, 'Corbin Inc').totalAllocated);
});

t('proRataPercent stays the SPATIAL share', () => {
  eq(of_(partial, 'Corbin Inc').proRataPercent, 20,
     'the pro-rata share absorbed the occupancy factor — the statement can no longer explain itself');
  eq(of_(partial, 'Corbin Inc').proRata, 0.2);
});

t('and the effective share is derived beside it, not instead of it', () => {
  const r = of_(partial, 'Corbin Inc');
  near(r.effectiveSharePercent, 13.3151);
  ok(r.effectiveSharePercent !== r.proRataPercent, 'the two collapsed into one number');
});

t('NO REDISTRIBUTION: every other tenant is byte-identical', () => {
  ['Ashen Co', 'Brandt Ltd', 'Dunmore Plc'].forEach(n => {
    eq(of_(partial, n).totalAllocated, of_(base, n).totalAllocated,
       `${n} moved when a different tenant's dates changed`);
    eq(of_(partial, n).proRataPercent, of_(base, n).proRataPercent, n);
  });
});

t('    so the pool is UNDER-billed by exactly the unoccupied share', () => {
  const billed = partial.reduce((s, r) => s + r.totalAllocated, 0);
  near(100000 - billed, 20000 - 13315.07, 'the shortfall is not the landlord\'s absorption');
});

t('the per-invoice shares are apportioned too, and sum to the tenant total', () => {
  const r = of_(partial, 'Corbin Inc');
  near(r.includedInvoices.reduce((s, i) => s + i.share, 0), r.totalAllocated);
  near(r.includedInvoices.find(i => i.id === 'i1').share, 40000 * 0.2 * (243 / 365));
});

console.log('\n── Direct invoices are placed by DATE, never multiplied ──');

// Dunmore commences 1 September and has its own $9,000 invoice in October, plus
// one in March before it occupied, plus one with no date.
const direct = go(p => {
  p.tenants[3].start_date = '2026-09-01';
  p.invoices.push(
    { id: 'd1', vendorName: 'Dunmore Plc', amount: 9000, category: 'repairs', invoiceDate: '2026-10-15', camEligible: true, matchConfidence: 100 },
    { id: 'd2', vendorName: 'Dunmore Plc', amount: 5000, category: 'repairs', invoiceDate: '2026-03-10', camEligible: true, matchConfidence: 100 },
    { id: 'd3', vendorName: 'Dunmore Plc', amount: 3000, category: 'repairs', invoiceDate: '',           camEligible: true, matchConfidence: 100 });
});
const dun = of_(direct, 'Dunmore Plc');

t('a direct invoice inside the window is billed IN FULL', () => {
  const li = dun.includedInvoices.find(i => i.id === 'd1');
  ok(li, 'the October invoice was not billed at all');
  eq(li.share, 9000, 'the occupancy factor was applied to a specific charge');
  eq(li.allocation, 'direct');
});

t('a direct invoice dated BEFORE occupancy is not billed, and is reported', () => {
  eq(dun.includedInvoices.some(i => i.id === 'd2'), false, 'billed for a repair before it moved in');
  const f = (dun.ambiguityFlags || []).find(x => x.code === 'DIRECT_OUTSIDE_OCCUPANCY');
  ok(f, 'silently dropped — the manager is never told');
  ok(/5000|5,000/.test(f.explanation), f.explanation);
});

t('an UNDATED direct invoice cannot be placed, so it is held and named', () => {
  eq(dun.includedInvoices.some(i => i.id === 'd3'), false);
  const f = (dun.ambiguityFlags || []).find(x => x.code === 'DIRECT_UNDATED_OCCUPANCY');
  ok(f, 'an undated direct invoice was silently included or silently dropped');
  ok(/no readable date/.test(f.explanation), f.explanation);
});

// D-5. The prose above tells a person. This tells the variance panel, which has
// to attribute the money to occupancy rather than to "no lease claimed it" — and
// parsing that sentence to find out which invoices they were is not an
// interface.
t('the engine names the held invoices structurally, not only in prose', () => {
  const out = (dun.ambiguityFlags || []).find(x => x.code === 'DIRECT_OUTSIDE_OCCUPANCY');
  const und = (dun.ambiguityFlags || []).find(x => x.code === 'DIRECT_UNDATED_OCCUPANCY');
  ok(Array.isArray(out && out.held), 'DIRECT_OUTSIDE_OCCUPANCY carries no held list');
  ok(Array.isArray(und && und.held), 'DIRECT_UNDATED_OCCUPANCY carries no held list');
  eq(out.held.length, 1);
  eq(out.held[0].id, 'd2');
  eq(out.held[0].amount, 5000);
  eq(und.held[0].id, 'd3');
});

t('and the variance panel attributes them to occupancy, not to a lease exclusion', () => {
  // The real engine output, through the real module. The unit fixtures state the
  // `held` shape by hand; this is the only assertion that both halves agree.
  const VB = require('./variance-breakdown.js');
  const invoices = direct._invoices;
  const pool   = invoices.reduce((s, i) => s + (Number(i.amount) || 0), 0);
  const billed = direct.reduce((s, r) => s + (r.totalAllocated || 0), 0);
  const bk = VB.derive({ results: direct, invoices, pool, billed });
  const held = bk.invoices.filter(r => r.id === 'd2' || r.id === 'd3');
  eq(held.length, 2, 'the held invoices are missing from the breakdown entirely');
  eq(held.find(r => r.id === 'd2').reason, 'outside_occupancy');
  eq(held.find(r => r.id === 'd3').reason, 'undated_occupancy');
  const line = k => { const l = (bk.lines || []).find(x => x.key === k); return l ? l.amount : 0; };
  ok(line('not_occupied') >= 8000, `expected the 5,000 + 3,000 held out, got ${line('not_occupied')}`);
  ok(Math.abs(bk.residual) < 0.05, `the identity broke: residual ${bk.residual}`);
});

t('the shared part of the same tenant IS apportioned', () => {
  const shared = dun.includedInvoices.filter(i => i.allocation === 'shared');
  near(shared.reduce((s, i) => s + i.share, 0), 100000 * 0.2 * (122 / 365));
});

t('a FULL-PERIOD tenant keeps every direct invoice, whatever its date', () => {
  const full = go(p => {
    p.invoices.push({ id: 'e1', vendorName: 'Brandt Ltd', amount: 7000, category: 'repairs',
                      invoiceDate: '2026-03-10', camEligible: true, matchConfidence: 100 });
  });
  eq(of_(full, 'Brandt Ltd').includedInvoices.some(i => i.id === 'e1'), true);
  eq((of_(full, 'Brandt Ltd').ambiguityFlags || []).some(f => /OCCUPANCY/.test(f.code)), false,
     'a full-period tenant was told an invoice fell outside its occupancy');
});

console.log('\n── Cases where no factor is applied ──');

t('a HOLDOVER is not billed $0 — it is billed un-apportioned and held elsewhere', () => {
  const r = of_(go(p => { p.tenants[2].end_date = '2025-10-31'; }), 'Corbin Inc');
  eq(r.totalAllocated, 20000, 'a factor of 0 silently wrote off a real receivable');
  eq(r.occupancy.applied, false);
  eq(r.occupancy.factor, null);
  eq(r.occupancy.unresolved, true);
});

t('an UNREADABLE date is not billed on a guessed factor', () => {
  const r = of_(go(p => { p.tenants[2].end_date = 'TBD'; }), 'Corbin Inc');
  eq(r.totalAllocated, 20000);
  eq(r.occupancy.applied, false);
  eq(r.occupancy.factor, null);
});

t('cam_commencement_date drives the window, not the lease start', () => {
  const r = of_(go(p => {
    p.tenants[2].start_date = '2026-01-01';
    p.tenants[2].cam_commencement_date = '2026-04-01';
  }), 'Corbin Inc');
  eq(r.occupancy.overlapStart, '2026-04-01');
  eq(r.occupancy.numerator, 275);
  eq(r.occupancy.startSource, 'cam_commencement_date');
  near(r.totalAllocated, 100000 * 0.2 * (275 / 365));
});

console.log('\n── The cap stays annual (T2 decision) ──');

t('an annual cap is NOT prorated by occupancy', () => {
  // 20% of $100,000 = $20,000 un-apportioned; at 243/365 = $13,315.07.
  // A $15,000 cap must NOT be reduced to $9,986.30 — the lease did not say so.
  const r = of_(go(p => {
    p.tenants[2].end_date = '2026-08-31';
    p.tenants[2].cap = '0'; p.tenants[2].capBaseAmount = '15000';
  }), 'Corbin Inc');
  near(r.totalAllocated, 13315.07, 'the cap bit when it should not have — it was prorated');
  eq(r.capApplied, false);
  eq(r.occupancy.capProrated, false, 'the cap treatment is not recorded on the result');
});

t('    but an annual cap still binds when the apportioned figure exceeds it', () => {
  const r = of_(go(p => {
    p.tenants[2].end_date = '2026-08-31';
    p.tenants[2].cap = '0'; p.tenants[2].capBaseAmount = '10000';
  }), 'Corbin Inc');
  eq(r.capApplied, true);
  near(r.totalAllocated, 10000);
});

console.log('\n── The variance identity closes ──');

t('the unoccupied share lands in notOccupied, not in the residual', () => {
  const res = partial;
  const billed = +res.reduce((s, r) => s + r.totalAllocated, 0).toFixed(2);
  const bk = VB.derive({ results: res, invoices: INVOICES, pool: 100000, billed });
  near(bk.notOccupied, 20000 - 13315.07, 'the apportioned-away money is not in its own bucket');
  ok(Math.abs(bk.residual) < 0.05, `residual ${bk.residual} — the identity does not close`);
  eq(bk.explained, true);
});

t('and it is NOT reported as a coverage gap', () => {
  const res = partial;
  const billed = +res.reduce((s, r) => s + r.totalAllocated, 0).toFixed(2);
  const bk = VB.derive({ results: res, invoices: INVOICES, pool: 100000, billed });
  eq(bk.uncovered, 0,
     'a part-year tenant was reported as unleased space — the manager goes looking for a lease that is already uploaded');
  eq(bk.proRataSum, 100, 'the property is 100% leased and must still say so');
  near(bk.occupancyCoveredPct, 93.3151);
});

t('vacancy and part-period are separable when both are present', () => {
  const res = go(p => { p.tenants[2].end_date = '2026-08-31'; p.tenants.pop(); });  // drop Dunmore: 20% vacant
  const billed = +res.reduce((s, r) => s + r.totalAllocated, 0).toFixed(2);
  const bk = VB.derive({ results: res, invoices: INVOICES, pool: 100000, billed });
  near(bk.uncovered,   20000, 'the vacant 20% is not in uncovered');
  near(bk.notOccupied, 20000 - 13315.07, 'the part-period share is not in notOccupied');
  ok(Math.abs(bk.residual) < 0.05, `residual ${bk.residual}`);
});

t('the panel names the partial-period cause as its next step', () => {
  const res = partial;
  const billed = +res.reduce((s, r) => s + r.totalAllocated, 0).toFixed(2);
  const bk = VB.derive({ results: res, invoices: INVOICES, pool: 100000, billed });
  const step = VB.nextStep(bk);
  ok(step && /partial-period/.test(step.cta), JSON.stringify(step));
});

console.log('\n── Backward compatibility ──');

t('a pre-T2 result carries no occupancy, and absence is not a factor of 1', () => {
  const legacy = { name: 'Old', proRataPercent: 50, totalAllocated: 50000, includedInvoices: [] };
  eq(legacy.occupancy, undefined);
  // The variance module must treat it as unapportioned rather than throwing or
  // inventing a factor.
  const bk = VB.derive({ results: [legacy], invoices: INVOICES, pool: 100000, billed: 50000 });
  eq(bk.notOccupied, 0, 'a run from before T2 acquired an apportionment it never made');
});

t('[source] the run is stamped so a reader can tell T2 from pre-T2', () => {
  ok(/schemaVersion: 2,/.test(scriptSrc), 'nothing marks a run as computed with occupancy');
});

console.log('\n── Ownership ──');

t('[source] the temporal multiplicand is built once and applied through one function', () => {
  const code = scriptSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  // P6 replaced the float `occFactor` with the RATIONAL the lease states —
  // 245/365, not 0.6712328767 — so there is no longer a factor to multiply by.
  // The invariant is unchanged and now tighter: the temporal operand is
  // constructed in exactly one place and reaches money through exactly one
  // function, which is the only thing that multiplies it.
  eq((code.match(/const _temporal =/g) || []).length, 1,
     'the temporal rational is built in more than one place');
  eq((code.match(/const _shareCents = /g) || []).length, 1,
     'more than one function applies the share arithmetic');
  eq((code.match(/\* occFactor/g) || []).length, 0,
     'the float occupancy factor is being multiplied into money again — the rational is the stored form');
  eq((code.match(/window\.LeasePeriod\.occupancy\(/g) || []).length, 1,
     'occupancy() is called from more than one place in script.js');
});

t('[source] the allocation does not re-derive a factor of its own', () => {
  const i = scriptSrc.indexOf('function runFullReconciliation');
  const body = scriptSrc.slice(i, scriptSrc.indexOf('\n}\n', i));
  // Line comments are stripped as well as block comments. They were not, so a
  // comment that QUOTED a day count — "the lease says 245/365" — read as the
  // allocation computing one. The assertion is about code, so it looks at code.
  const codeOnly = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok(!/\/\s*365|\/\s*366|getTime\(\)\s*-/.test(codeOnly),
     'a day count appeared in the allocation — the arithmetic belongs in lease-period.js');
});

console.log('\n' + '─'.repeat(58));
if (fail) { console.log(`\x1b[31mRESULT: ${pass} passed, ${fail} failed\x1b[0m`); process.exit(1); }
console.log(`\x1b[32mRESULT: ${pass} passed, 0 failed\x1b[0m`);
