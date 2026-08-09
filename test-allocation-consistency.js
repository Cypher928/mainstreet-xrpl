'use strict';
/**
 * test-allocation-consistency.js — the tenant statement must add up to the
 * number the reconciliation computed.
 *
 *   node test-allocation-consistency.js
 *
 * A pilot test showed the summary, the tenant allocation and the audit
 * narrative printing $12,960.75 while the CAM Charge Breakdown printed
 * $12,963.50. The breakdown was not reading the engine's numbers — it
 * re-derived its own from lastInvoicesFull, and diverged three ways:
 *
 *   1. it ignored the camEligible filter (PW-3, script.js:9791), so invoices
 *      the manager had marked not-recoverable were still shown and summed;
 *   2. it multiplied every invoice by proRata, including directly-matched
 *      invoices the engine charges to that tenant in full;
 *   3. it re-rounded from raw amounts instead of using the share the engine
 *      had already computed, and never saw the engine's penny adjustment.
 *
 * These tests execute the real runFullReconciliation out of script.js and
 * assert on its own output, then assert at source level that the four
 * tenant-facing surfaces read that output rather than rebuilding it.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pass = 0, fail = 0;
const failures = [];
function t(name, fn) {
  try { fn(); pass++; console.log(`  ok   ${name}`); }
  catch (e) { fail++; failures.push(`${name}: ${e.message}`); console.log(`  FAIL ${name}\n       ${e.message}`); }
}
function eq(a, b, m) { if (a !== b) throw new Error(`${m || ''} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
function ok(c, m) { if (!c) throw new Error(m || 'expected truthy'); }
function code(src) { return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''); }

const scriptSrc = fs.readFileSync(path.join(__dirname, 'script.js'), 'utf8');
const scriptCode = code(scriptSrc);

function extract(pattern, label) {
  const m = scriptSrc.match(pattern);
  if (!m) throw new Error(`${label} not found in script.js`);
  return m[0];
}

// The real engine. `directVendors` lets a test mark an invoice as directly
// matched, which is how the engine decides to charge it in full.
function loadEngine(directVendors) {
  const direct = new Set(directVendors || []);
  const src = [
    extract(/\nclass ReconciliationResult \{[\s\S]*?\n\}\n/, 'ReconciliationResult'),
    extract(/\nclass Lease \{[\s\S]*?\n\}\n/, 'Lease'),
    extract(/\nfunction parseSqft\(v\) \{[\s\S]*?\n\}\n/, 'parseSqft'),
    extract(/\nfunction runFullReconciliation\(property\) \{[\s\S]*?\n\}\n/, 'runFullReconciliation'),
  ].join('\n');
  const sandbox = {
    console: { log() {}, warn() {}, error() {}, groupCollapsed() {}, groupEnd() {} },
    parseFloat, isNaN, Number, Math, Date, JSON, Set, Array, Object, String,
    currentProperty: () => ({ tenants: [] }),
    matchInvoiceToTenant: inv => direct.has(inv.vendorName)
      ? { tenantName: 'T', tenantId: 't1', confidence: 100, reason: 'test' } : null,
    matchesTenant: inv => direct.has(inv.vendorName),
    showToast: () => {},
    _fmtMoney: n => String(n),
  };
  vm.createContext(sandbox);
  vm.runInContext(src + '\nthis.__e = runFullReconciliation; this.__L = Lease;', sandbox);
  return sandbox;
}

// A pool that exercises every divergence at once.
const POOL = [
  { vendorName: 'Shared A',   category: 'repairs',    amount: 41003.33, invoiceDate: '2025-03-01' },
  { vendorName: 'Shared B',   category: 'utilities',  amount: 29777.77, invoiceDate: '2025-04-01' },
  { vendorName: 'Shared C',   category: 'janitorial', amount: 11555.55, invoiceDate: '2025-05-01' },
  { vendorName: 'Not CAM',    category: 'repairs',    amount:  9000.00, invoiceDate: '2025-06-01', camEligible: false },
  { vendorName: 'Direct One', category: 'repairs',    amount:  2750.00, invoiceDate: '2025-07-01' },
];

function reconcile(opts) {
  const o = opts || {};
  const sb = loadEngine(o.direct);
  const lease = new sb.__L('T', '', 2360, '2020-01-01', '2030-12-31', o.excluded || [], null, null);
  lease.id = 't1';
  const other = new sb.__L('Other', '', 7640, '2020-01-01', '2030-12-31', [], null, null);
  other.id = 't2';
  const property = {
    leases: [lease, other],
    invoices: JSON.parse(JSON.stringify(POOL)),
    totalSqFt: 10000,
  };
  const results = sb.__e(property);
  return { r: results.find(x => x.name === 'T'), all: results, property };
}

// What the statement used to do: every invoice in the property, times proRata.
function legacyBreakdownTotal(property, r) {
  return property.invoices
    .filter(inv => !r.excludedCategories || true)
    .reduce((s, inv) => s + parseFloat((inv.amount * r.proRata).toFixed(2)), 0);
}

console.log('\n── The engine is the single source of truth ──');

t('a not-CAM-eligible invoice is excluded from the allocation', () => {
  const { r } = reconcile();
  const vendors = r.includedInvoices.map(i => i.vendorName);
  ok(!vendors.includes('Not CAM'), `camEligible:false invoice leaked into the allocation: ${vendors}`);
});

t('includedInvoices carries the share the engine computed', () => {
  const { r } = reconcile();
  r.includedInvoices.forEach(i => {
    ok(typeof i.share === 'number' && isFinite(i.share), `${i.vendorName} has no numeric share`);
    ok(i.allocation === 'shared' || i.allocation === 'direct', `${i.vendorName} has no allocation kind`);
  });
});

t('a directly-matched invoice is charged in full, not pro-rated', () => {
  const { r } = reconcile({ direct: ['Direct One'] });
  const d = r.includedInvoices.find(i => i.vendorName === 'Direct One');
  ok(d, 'direct invoice missing from the allocation');
  eq(d.allocation, 'direct');
  eq(d.share, 2750, 'a direct invoice must be charged at 100%, not at the pro-rata share');
});

console.log('\n── The reported discrepancy ──');

t('summing the engine shares matches totalAllocated to the cent', () => {
  const { r } = reconcile({ direct: ['Direct One'] });
  const sum = r.includedInvoices.reduce((s, i) => s + i.share, 0);
  const gap = Math.abs(r.totalAllocated - parseFloat(sum.toFixed(2)));
  ok(gap < 0.02, `breakdown ${sum.toFixed(2)} vs total ${r.totalAllocated} — gap ${gap.toFixed(2)}`);
});

t('the OLD re-derivation really did disagree — this is the bug being fixed', () => {
  const { r, property } = reconcile({ direct: ['Direct One'] });
  const legacy = parseFloat(legacyBreakdownTotal(property, r).toFixed(2));
  ok(Math.abs(legacy - r.totalAllocated) > 0.02,
     `expected the legacy method to diverge, but it matched (${legacy} vs ${r.totalAllocated}) — the fixture no longer reproduces the defect`);
});

t('the divergence is driven by camEligible and direct matching, not rounding alone', () => {
  const { r, property } = reconcile({ direct: ['Direct One'] });
  const legacy = parseFloat(legacyBreakdownTotal(property, r).toFixed(2));
  ok(Math.abs(legacy - r.totalAllocated) > 1,
     'the gap should be dollars, not cents — cents would mean only rounding differed');
});

console.log('\n── Every tenant-facing surface reads the engine output ──');

t('[source] no tenant-scoped surface rebuilds from lastInvoicesFull', () => {
  // Property-level category counts may still scan lastInvoicesFull; a
  // TENANT-scoped filter on excludedCategories is the re-derivation that broke.
  const bad = scriptCode.match(/lastInvoicesFull\.filter\(inv =>\s*\n?\s*!t\.excludedCategories/g) || [];
  eq(bad.length, 0, `tenant-scoped re-derivations still present: ${bad.length}`);
});

t('[source] the four surfaces read r.includedInvoices', () => {
  const uses = scriptCode.match(/r\.includedInvoices \|\| \[\]/g) || [];
  ok(uses.length >= 3, `expected >= 3 uses of r.includedInvoices, found ${uses.length}`);
  ok(/const invs = \(r\.includedInvoices \|\| \[\]\)\.filter/.test(scriptCode),
     'the category drill-down does not read the engine output');
});

t('[source] the statement uses the engine share, never a re-multiplication', () => {
  const i = scriptCode.indexOf('const eligible = r.includedInvoices || [];\n  const catMap = {};');
  ok(i !== -1, 'statement breakdown grouping not found');
  const slice = scriptCode.slice(i, i + 500);
  ok(/const share = parseFloat\(inv\.share\) \|\| 0;/.test(slice),
     'the statement re-derives the share instead of reading the engine value');
  ok(!/inv\.amount \* r\.proRata/.test(slice),
     're-multiplying by proRata pro-rates directly-billed invoices the engine charges in full');
});

t('[source] category shares sum engine shares rather than re-multiplying', () => {
  ok(!/const yourShare = parseFloat\(\(data\.total \* r\.proRata\)\.toFixed\(2\)\)/.test(scriptCode),
     'the explain panel still re-multiplies the category total by proRata');
  ok(/const yourShare = parseFloat\(data\.share\.toFixed\(2\)\)/.test(scriptCode),
     'the explain panel does not sum the engine shares');
});

t('[source] the statement reconciles its line items to the authoritative total', () => {
  ok(/_breakdownGap\s*=\s*parseFloat\(\(r\.allocatedAmount - _breakdownSum\)\.toFixed\(2\)\)/.test(scriptCode),
     'no reconciliation between the line items and the billed total');
  ok(/rounding adjustment/.test(scriptCode),
     'a residual gap is not disclosed to the tenant');
});

t('[source] a direct invoice is not described with the pro-rata formula', () => {
  ok(/inv\.allocation === 'direct'/.test(scriptCode),
     'the charge detail does not distinguish direct from shared');
  ok(/charged in full \(100%\)/.test(scriptCode),
     'a directly-billed invoice still shows a pro-rata multiplication');
});

t('[source] the dispute row indexes the same array the statement rendered', () => {
  const i = scriptCode.indexOf('function tsToggleDispute');
  const body = scriptCode.slice(i, i + 600);
  ok(/const eligible = r\.includedInvoices \|\| \[\]/.test(body),
     'tsToggleDispute indexes a different array than the statement — disputes would attach to the wrong invoice');
});

console.log('\n── Coverage gap is not an allocation error ──');

// The real reconciliation-engine, loaded from disk.
function loadReconEngine() {
  const sandbox = { window: {}, console };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'reconciliation-engine.js'), 'utf8'), sandbox);
  return sandbox.window.ReconciliationEngine;
}
const RCE = loadReconEngine();

// Two leases covering 23.57% of the building — the pilot's Olenox case.
const partial = [
  { tenantId: 't1', name: 'T',     proRataPercent: 23.57, totalAllocated: 12960.75, includedInvoices: [] },
];
const overish = [
  { tenantId: 't1', name: 'T',     proRataPercent: 70,  totalAllocated: 1, includedInvoices: [] },
  { tenantId: 't2', name: 'Other', proRataPercent: 38,  totalAllocated: 1, includedInvoices: [] },
];
const propStub = { tenants: [{ id: 't1', lease_type: 'NNN' }, { id: 't2', lease_type: 'NNN' }] };
const gapFlag = rs => RCE.detectReconciliationIssues(rs, propStub, '2025-12-31')
  .find(f => /Coverage gap|over-allocation/i.test(f.title));

t('a 76.4% coverage gap is yellow, not red', () => {
  const f = gapFlag(partial);
  ok(f, 'no coverage finding raised');
  eq(f.severity, 'yellow', 'partial lease coverage is not an allocation error —');
});

t('the coverage finding no longer says "expected 100%" or blames a missing tenant', () => {
  const f = gapFlag(partial);
  ok(!/expected 100%/i.test(f.detail), 'still asserts 100% was expected');
  ok(!/tenant may be missing/i.test(f.detail), 'still asserts a tenant may be missing');
  ok(!/under-allocated/i.test(f.title), 'still calls the pool under-allocated');
});

t('the coverage finding offers both causes and protects the billed amounts', () => {
  const f = gapFlag(partial);
  ok(/vacant space/i.test(f.detail), 'does not mention vacant space');
  ok(/has not been uploaded yet/i.test(f.detail), 'does not mention an unloaded lease');
  ok(/unaffected/i.test(f.detail), 'does not say tenant charges are unaffected');
  ok(f.conditions.some(c => /Cause not determined/i.test(c)), 'conditions assert a cause');
});

t('over-allocation above 100% is still red — that one IS an error', () => {
  const f = gapFlag(overish);
  ok(f, 'no over-allocation finding raised');
  eq(f.severity, 'red', 'billing tenants more than the pool must stay red —');
  ok(/over-allocation/i.test(f.title), `title was: ${f.title}`);
});

t('the coverage finding is marked non-disputable and typed as coverage', () => {
  const f = gapFlag(partial);
  eq(f.kind, 'coverage', 'not typed as a coverage finding —');
  eq(f.disputable, false, 'a property coverage gap has no counterparty to dispute with —');
});

t('over-allocation stays disputable — it IS a tenant-facing billing error', () => {
  const f = gapFlag(overish);
  ok(f.disputable !== false, 'over-allocation must remain actionable as a dispute');
  ok(f.kind !== 'coverage', 'over-allocation is not a coverage finding');
});

t('the coverage finding tells the user how to resolve the ambiguity', () => {
  const f = gapFlag(partial);
  ok(f.conditions.some(c => /upload any lease still missing/i.test(c)),
     'no path offered for the "lease not uploaded" case');
  ok(f.conditions.some(c => /every lease is loaded, the remainder is vacant/i.test(c)),
     'no path offered for the "vacant space" case');
});

t('[source] a non-disputable finding renders no Open Dispute button', () => {
  ok(/f\.disputable === false \? '' :/.test(scriptCode),
     'the renderer still offers a dispute button on every finding');
  ok(/f\.kind === 'coverage' \? ' rcs-issue--coverage' : ''/.test(scriptCode),
     'coverage findings are not visually distinguished from exceptions');
  ok(/Property coverage<\/span>/.test(scriptCode),
     'no label marks the finding as property coverage rather than an exception');
});

t('[source] openDisputeFromFlag refuses a non-disputable finding', () => {
  const i = scriptCode.indexOf('function openDisputeFromFlag');
  const body = scriptCode.slice(i, i + 700);
  ok(/if \(flag\.disputable === false\)/.test(body),
     'the global entry point still opens a dispute for a property-level finding');
});

t('full coverage raises no coverage finding at all', () => {
  const full = [{ tenantId: 't1', name: 'T', proRataPercent: 100, totalAllocated: 1, includedInvoices: [] }];
  eq(gapFlag(full), undefined, 'a fully-leased property should raise nothing');
});

console.log('\n── AI Auditor: unallocated space ──');

t('[source] the gap is described as "not covered by loaded leases", not "untenanted"', () => {
  ok(!/is untenanted — its share of CAM expenses/.test(scriptCode),
     'the auditor still asserts the remaining space is untenanted');
  ok(/not covered by any lease currently loaded/.test(scriptCode),
     'the auditor does not scope the gap to the leases actually loaded');
  ok(/leases currently loaded cover/.test(scriptCode),
     'the context line does not say these are the loaded leases');
});

t('[source] both causes are offered, neither asserted', () => {
  ok(/either vacant space/.test(scriptCode) && /has not been uploaded yet/.test(scriptCode),
     'the auditor does not present both explanations for the gap');
  ok(!/`Unrecoverable gap: \$\{gap\}%`/.test(scriptCode),
     'the condition list still calls the gap unrecoverable as a fact');
  ok(/Gap not covered by loaded leases/.test(scriptCode),
     'the condition list is not scoped to loaded leases');
});

t('[source] the recommendation asks which cause applies before concluding', () => {
  ok(!/represents CAM expenses ' \+\s*'that cannot be recovered/.test(scriptCode),
     'the recommendation still presupposes the space is unrecoverable');
  ok(/Confirm whether the unallocated square footage is vacant or simply not yet loaded/.test(scriptCode),
     'the recommendation does not ask which cause applies');
});

const TOTAL_EXPECTED = 27;
t(`suite runs all ${TOTAL_EXPECTED} checks`, () => {
  eq(pass + fail + 1, TOTAL_EXPECTED, 'test count changed — update TOTAL_EXPECTED deliberately');
});

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} passed, ${fail} failed`);
if (fail) { failures.forEach(f => console.log(`  · ${f}`)); process.exit(1); }
