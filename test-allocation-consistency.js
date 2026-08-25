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
    // ONE reading of a square-footage value (SourceValues) and ONE definition of
    // what is in the CAM pool (CamPool), shared with getValidTenants, the review
    // engine and the concentration detector. The sandbox loads the real modules
    // rather than stubbing them, so these suites exercise the same
    // interpretations production does.
    window: {
      SourceValues: require('./source-values.js'),
      CamPool:      require('./cam-pool.js'),
    },
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
  .find(f => /Property CAM coverage|over-allocation/i.test(f.title));

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

// The wording of the resolution path changed when the finding was made
// actionable (it now names the re-run as the step that settles which cause
// applies). The REQUIREMENT is unchanged and is what is asserted: a reader must
// be given a concrete next step for BOTH causes, and a machine-readable action
// list, not just a description of the deficiency. Matched on the substance
// (upload a lease / re-run / the remainder is vacant) rather than on one exact
// sentence, so a rewording that keeps the guidance does not fail, but deleting
// either branch does.
t('the coverage finding tells the user how to resolve the ambiguity', () => {
  const f = gapFlag(partial);
  ok(f.conditions.some(c => /upload/i.test(c) && /lease/i.test(c)),
     'no path offered for the "lease not uploaded" case');
  ok(f.conditions.some(c => /re-run/i.test(c)),
     'the reader is not told that re-running is what settles the cause');
  ok(f.conditions.some(c => /remainder is vacant|is vacant and the landlord absorbs/i.test(c)),
     'no path offered for the "vacant space" case');
  ok(Array.isArray(f.actions) && f.actions.length >= 2,
     'the finding offers no actions a reader can act on');
  ok(f.actions.some(a => /upload/i.test(a)) && f.actions.some(a => /vacant/i.test(a)),
     `actions do not cover both causes — got: ${JSON.stringify(f.actions)}`);
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

console.log('\n── Variance banner: partial coverage is expected, not a defect ──');

t('[source] the banner branches on coverage before warning', () => {
  const i = scriptCode.indexOf('const variance = Math.abs(totalBilled - totalPool)');
  ok(i !== -1, 'variance banner not found');
  const slice = scriptCode.slice(i, i + 1800);
  ok(/const _coverageIncomplete = proRataSum < 98;/.test(slice),
     'the banner does not consider property coverage');
  ok(/_coverageIncomplete\s*\n?\s*\?/.test(slice) || /\? *`[\s\S]{0,80}Expected — partial property coverage/.test(slice),
     'the banner does not branch on coverage');
});

t('[source] partial coverage does not tell the user to re-check invoices', () => {
  // FOUND VACUOUS, REPAIRED. The previous form sliced a fixed 1400 characters
  // from the `_coverageIncomplete` declaration and looked for the
  // "Reconciliation variance detected" branch inside that window. A later edit
  // pushed that branch past 1400, so indexOf returned -1, slice(0, -1) handed
  // back nearly the whole window, and both assertions were then satisfied by an
  // HTML comment quoting the exact wording the branch had deliberately STOPPED
  // saying. Deleting the entire live sentence left the suite green.
  //
  // Two changes: the branch is located by content rather than by byte offset,
  // and HTML comments are stripped, so only copy a reader can actually see
  // counts. `code()` strips // and /* */ but not <!-- -->, which is what let the
  // old form pass.
  //
  // The assertions also now test the intent rather than wording that has since
  // been revised twice: this branch must not give defect advice, and it must
  // still tell the reader their tenant charges are unaffected.
  const i = scriptCode.indexOf('const varianceBanner');
  const j = scriptCode.indexOf('Reconciliation variance detected', i);
  ok(i !== -1 && j !== -1, 'the variance banner branches were not found');
  const expectedBranch = scriptCode.slice(i, j).replace(/<!--[\s\S]*?-->/g, '');
  ok(/Partial property coverage/.test(expectedBranch),
     'the partial-coverage branch no longer names partial coverage');
  ok(!/Re-check invoice amounts or re-run allocation/.test(expectedBranch),
     'the partial-coverage branch still gives defect advice');
  ok(/No tenant charge changes/.test(expectedBranch),
     'the partial-coverage branch no longer says tenant charges are unaffected');
});

t('[source] the diagnostic warning survives for complete coverage', () => {
  ok(/Reconciliation variance detected/.test(scriptCode),
     'the genuine variance warning was removed');
  ok(/Re-check invoice amounts or re-run allocation/.test(scriptCode),
     'the diagnostic advice was removed — it is still correct when coverage is complete');
});

t('[source] the variance arithmetic is untouched', () => {
  ok(/const totalPool   = invoices\.reduce\(\(s, inv\) => s \+ \(parseFloat\(inv\.amount\) \|\| 0\), 0\);/.test(scriptCode),
     'totalPool changed');
  ok(/const totalBilled = results\.reduce\(\(s, r\) => s \+ r\.totalAllocated, 0\);/.test(scriptCode),
     'totalBilled changed');
  ok(/const variance = Math\.abs\(totalBilled - totalPool\);/.test(scriptCode),
     'variance changed');
  ok(/variance <= 0\.05/.test(scriptCode),
     'the 0.05 suppression threshold changed');
});

console.log('\n── Modified Gross is a lease question, not a dispute ──');

// Two tenants, both receiving shared CAM: one Modified Gross, one pure Gross.
const inv = n => ({ vendorName: n, category: 'repairs', amount: 1000, allocation: 'shared', share: 500 });
const grossResults = [
  { tenantId: 'mg', name: 'ModGross', proRataPercent: 50, totalAllocated: 500, includedInvoices: [inv('A')] },
  { tenantId: 'gr', name: 'PureGross', proRataPercent: 50, totalAllocated: 500, includedInvoices: [inv('B')] },
];
const grossProp = { tenants: [
  { id: 'mg', lease_type: 'Modified Gross' },
  { id: 'gr', lease_type: 'Gross' },
]};
const grossFlags = () => RCE.detectReconciliationIssues(grossResults, grossProp, '2025-12-31');
const modGrossFlag  = () => grossFlags().find(f => /Modified Gross tenant receiving/i.test(f.title));
const pureGrossFlag = () => grossFlags().find(f => /Gross-lease tenant receiving/i.test(f.title));

t('the Modified Gross finding is non-disputable and typed as lease verification', () => {
  const f = modGrossFlag();
  ok(f, 'Modified Gross finding not raised');
  eq(f.disputable, false, 'it asks whether the charge is permitted — it does not allege an error —');
  eq(f.kind, 'lease_verification');
  eq(f.severity, 'yellow', 'severity must not change —');
});

t('the Modified Gross finding points at Validate Against Lease', () => {
  const f = modGrossFlag();
  ok(/Validate Against Lease/.test(f.detail), 'detail does not name the existing workflow');
  ok(f.conditions.some(c => /Validate Against Lease/.test(c)), 'conditions do not name the workflow');
  ok(f.conditions.some(c => /Not a dispute/i.test(c)), 'conditions do not say this is not a dispute');
});

t('the pure Gross-lease finding is UNCHANGED and still disputable', () => {
  const f = pureGrossFlag();
  ok(f, 'Gross-lease finding not raised');
  ok(f.disputable !== false, 'pure Gross alleges a possible violation and must stay disputable —');
  ok(f.kind === undefined, 'pure Gross must not be reclassified —');
  eq(f.severity, 'yellow');
  ok(/may violate lease terms/.test(f.detail), 'pure Gross wording changed');
});

t('[source] the renderer already suppresses the button for non-disputable findings', () => {
  ok(/f\.disputable === false \? '' :/.test(scriptCode),
     'the shared suppression path was removed');
});

console.log('\n── AI Auditor: unallocated space ──');

// These two assertions were written against buildAuditSummary section 8, which
// raised its own under-coverage finding. It has since been removed as a
// duplicate: reconciliation-engine.js section 3 raises the same finding on the
// same threshold, and the Test 2 audit was listing the fact twice. The
// REQUIREMENT is unchanged and is asserted here in full — the gap must never be
// called untenanted, both causes must be offered, and neither asserted — but it
// is now asserted against the implementation that survived, and against the
// finding's real output rather than only the source text.
const gapFinding = (() => {
  const box = { window: {}, console, module: {}, Date, Math, Number, String, Array, JSON, isFinite, parseFloat };
  box.globalThis = box;
  vm.createContext(box);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'reconciliation-engine.js'), 'utf8'), box);
  const flags = box.window.ReconciliationEngine.detectReconciliationIssues(
    [{ tenantId: 't1', name: 'Olenox Corp', proRataPercent: 23.57, totalAllocated: 12960.75 }],
    { tenants: [{ id: 't1', name: 'Olenox Corp' }] }, '2026-12-31');
  return flags.find(f => /Property CAM coverage/i.test(f.title));
})();

t('the gap is described as not covered by loaded leases, not "untenanted"', () => {
  ok(gapFinding, 'the coverage-gap finding is no longer raised at all');
  const text = gapFinding.title + ' ' + gapFinding.detail + ' ' + gapFinding.conditions.join(' ');
  ok(!/untenanted/i.test(text), 'the auditor still asserts the remaining space is untenanted');
  // The title now leads with the measured state ("X% documented · Y% unresolved")
  // instead of repeating the loaded-lease phrasing. Both framings satisfy the
  // requirement, which is that the title must NOT characterise the gap as
  // vacancy or as lost money — it may only report that the share is
  // undocumented. The loaded-lease scoping itself is still required, and is
  // asserted below against the finding as a whole.
  ok(!/vacant|unleased|empty|lost|unrecoverable/i.test(gapFinding.title),
     `the title characterises the gap rather than reporting it: ${gapFinding.title}`);
  ok(/unresolved|unallocated|undocumented/i.test(gapFinding.title),
     `the title does not report the gap as unresolved: ${gapFinding.title}`);
  ok(/loaded leases cover/i.test(gapFinding.conditions.join(' ')),
     'the finding does not scope the gap to the leases actually loaded');
  ok(/leases currently loaded account for/i.test(gapFinding.detail),
     'the detail does not say these are the loaded leases');
});

t('both causes are offered, neither asserted', () => {
  ok(gapFinding, 'the coverage-gap finding is no longer raised at all');
  const text = gapFinding.detail + ' ' + gapFinding.conditions.join(' ');
  ok(/either vacant space/i.test(text) && /has not been uploaded yet/i.test(text),
     'the auditor does not present both explanations for the gap');
  ok(!/unrecoverable gap/i.test(text),
     'the finding still calls the gap unrecoverable as a fact');
  ok(gapFinding.conditions.some(c => /cause not determined/i.test(c)),
     'the condition list does not record that the cause is undetermined');
  ok(gapFinding.disputable === false,
     'the coverage gap is disputable again — there is no counterparty to dispute with');
});

t('[source] the duplicate under-coverage finding does not come back', () => {
  // Both detectors fired on the same threshold, so the Test 2 audit reported
  // "Pro-rata totals 56.8% — 43.3% of expenses not allocated to a loaded lease"
  // directly above "Coverage gap: loaded leases cover 56.8% of the property",
  // inflating the warning count and deducting twice from the health score.
  ok(!/of expenses not allocated to a loaded lease/.test(scriptCode),
     'buildAuditSummary raises its own under-coverage finding again');
  ok(!/Pro-rata totals \$\{totalPR\.toFixed\(1\)\}% — exceeds 100%/.test(scriptCode),
     'buildAuditSummary raises its own over-allocation finding again');
});

t('[source] the recommendation asks which cause applies before concluding', () => {
  ok(!/represents CAM expenses ' \+\s*'that cannot be recovered/.test(scriptCode),
     'the recommendation still presupposes the space is unrecoverable');
  ok(/Confirm whether the unallocated square footage is vacant or simply not yet loaded/.test(scriptCode),
     'the recommendation does not ask which cause applies');
});

console.log('\n── The green allocation finding is scoped to the loaded leases ──');

// The pilot fixture: one $55,000 invoice, one loaded lease covering 18,852 of
// the property's 80,000 sqft. The engine bills that lease 23.57% = $12,960.75;
// the remaining $42,039.25 is the share of space no loaded lease covers.
//
// buildAuditSummary reads module globals and calls a handful of helpers, so it
// runs here against stubs. Only its own output is asserted on.
function auditSummary({ invoices, results, tenants, total, camYear }) {
  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    parseFloat, isNaN, Number, Math, Date, JSON, Set, Array, Object, String,
    window: { CamPool: require('./cam-pool.js') },
    // CARRIES camEligible. This mirrors the stripped shape script.js builds, and
    // that shape used to drop the flag — which is why buildAuditSummary could
    // not tell an invoice held out of CAM from a billable one and reported a
    // $70,000 capital item as "43.6% of total CAM".
    lastInvoicesFull: invoices.map(i => ({ vendor: i.vendorName, amount: i.amount,
                                          category: i.category, camEligible: i.camEligible })),
    invoiceData:  invoices,
    lastResults:  results,
    lastTenants:  tenants,
    lastTotal:    total,
    lastCamPool:  require('./cam-pool.js').total(invoices),
    camRuns:      [],
    fmt: n => '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    getCamYear:   () => camYear,
    currentProperty: () => ({ tenants }),
    _detectInvoiceSuspicions:   () => [],
    _detectReconciliationIssues: () => [],
  };
  vm.createContext(sandbox);
  vm.runInContext(
    extract(/\nfunction buildAuditSummary\(\) \{[\s\S]*?\n\}\n/, 'buildAuditSummary') +
    '\nthis.__s = buildAuditSummary();', sandbox);
  return sandbox.__s;
}

const PILOT_INV = [{ vendorName: 'Acme Landscaping', amount: 55000, category: 'landscaping', matchConfidence: 0, invoiceDate: null }];
const partialCoverage = auditSummary({
  invoices: PILOT_INV,
  results:  [{ tenantId: 'ol', name: 'Olenox Corp', proRataPercent: 23.57, totalAllocated: 12960.75, includedInvoices: [] }],
  tenants:  [{ id: 'ol', name: 'Olenox Corp', lease_type: 'Modified Gross', excludedCategories: [] }],
  total: 55000, camYear: 2026,
});
const allocFinding = () => partialCoverage.green.find(f => /allocated as shared CAM expense/i.test(f.title));

t('the green finding no longer says "All 1 invoices"', () => {
  const f = allocFinding();
  ok(f, 'the shared-allocation green finding was not raised');
  ok(!/All 1 invoices/.test(f.title), 'the title still reads "All 1 invoices"');
  ok(!/^All /.test(f.title), 'the title still opens with an "All" claim —');
  eq(f.title, '1 invoice allocated as shared CAM expense (pro-rata)');
});

t('the green finding cannot claim the whole pool was distributed', () => {
  const f = allocFinding();
  ok(!/all \$55,000\.00 of CAM expenses were distributed/.test(f.detail),
     'the detail still claims the entire pool was distributed');
  ok(!/across all tenants/.test(f.detail),
     'the detail still says the pool went across all tenants, not the loaded leases');
  ok(!/\ball \$55,000\.00\b/.test(f.detail),
     'the detail still asserts the full pool amount as distributed');
});

t('the green finding scopes the allocation to the loaded leases', () => {
  const f = allocFinding();
  ok(/currently loaded tenant leases/.test(f.detail),
     'the detail does not scope the allocation to the loaded leases');
  ok(/loaded leases cover 23\.57% of the property/.test(f.detail),
     'the detail does not name the coverage the leases actually provide');
  ok(f.conditions.some(c => /loaded lease/i.test(c)),
     'no condition scopes the allocation basis to the loaded leases');
  ok(f.conditions.some(c => /unallocated remainder is reported separately under property coverage/.test(c)),
     'the finding does not defer the remainder to the property-coverage finding');
});

t('the green finding names the amount actually billed, not the pool', () => {
  const f = allocFinding();
  ok(/\$12,960\.75 of the \$55,000\.00 expense pool is billed/.test(f.detail),
     'the detail does not separate the billed amount from the pool');
  ok(/is not allocated in this reconciliation/.test(f.detail),
     'the detail does not say the remainder goes unallocated');
});

t('full coverage reads cleanly and pluralises', () => {
  const s = auditSummary({
    invoices: [
      { vendorName: 'Acme Landscaping', amount: 30000, category: 'landscaping', matchConfidence: 0, invoiceDate: '2026-03-01' },
      { vendorName: 'Beta Snow',        amount: 25000, category: 'snow',        matchConfidence: 0, invoiceDate: '2026-03-02' },
    ],
    results: [
      { tenantId: 'a', name: 'A', proRataPercent: 60, totalAllocated: 33000, includedInvoices: [] },
      { tenantId: 'b', name: 'B', proRataPercent: 40, totalAllocated: 22000, includedInvoices: [] },
    ],
    tenants: [{ id: 'a', name: 'A', excludedCategories: [] }, { id: 'b', name: 'B', excludedCategories: [] }],
    total: 55000, camYear: 2026,
  });
  const f = s.green.find(x => /allocated as shared CAM expense/i.test(x.title));
  ok(f, 'the finding was not raised at full coverage');
  eq(f.title, '2 invoices allocated as shared CAM expenses (pro-rata)');
  ok(!/is not allocated in this reconciliation/.test(f.detail),
     'full coverage must not talk about an unallocated remainder —');
  ok(!f.conditions.some(c => /unallocated remainder/.test(c)),
     'the remainder condition must only appear when coverage is incomplete —');
  ok(/\$55,000\.00 of the \$55,000\.00 expense pool is billed across them/.test(f.detail),
     'at full coverage the billed total should equal the pool');
});

console.log('\n── The missing invoice date finding states a requirement, not a confirmation ──');

const dateFinding = () => partialCoverage.yellow.find(f => /missing invoice date/i.test(f.title));

t('the missing-date finding does not claim the date was confirmed', () => {
  const f = dateFinding();
  ok(f, 'the missing invoice date finding was not raised');
  ok(!/^Invoice date confirms/.test(f.detail),
     'the detail still opens by saying the invoice date confirms the period');
  ok(!/Invoice date confirms that a charge falls within/.test(f.detail),
     'the detail still asserts the date confirms the charge falls in the period');
  ok(/required to establish that a charge falls within the 2026 CAM reconciliation period/.test(f.detail),
     'the detail no longer states the requirement an invoice date exists to meet');
  ok(/no recorded date/.test(f.detail),
     'the detail does not say this invoice has no recorded date');
});

t('the missing-date finding keeps its meaning, severity and affected vendors', () => {
  const f = dateFinding();
  eq(f.group, 'missing_docs', 'group changed —');
  eq(f.title, '1 invoice missing invoice date', 'title changed —');
  ok(/Acme Landscaping/.test(f.detail), 'the affected vendor was dropped from the detail');
  ok(/may be excluded or challenged in a formal tenant audit/.test(f.detail),
     'the audit-exposure warning was dropped');
  ok(f.conditions.some(c => /Affected vendors: Acme Landscaping/.test(c)),
     'the affected-vendor condition was dropped');
  ok(f.conditions.some(c => /must fall within the 2026 reconciliation year/.test(c)),
     'the requirement condition was dropped');
});

t('the missing-date count agrees with its verb in both singular and plural', () => {
  const one = dateFinding();
  ok(one.conditions.some(c => /^Count: 1 invoice has no recorded invoice date$/.test(c)),
     'the singular count line does not read "1 invoice has" — got: ' +
     JSON.stringify(one.conditions.filter(c => /^Count:/.test(c))));
  ok(!one.conditions.some(c => /1 invoice have/.test(c)),
     'the singular count line still reads "1 invoice have"');

  const many = auditSummary({
    invoices: [
      { vendorName: 'Acme', amount: 30000, category: 'x', matchConfidence: 0, invoiceDate: null },
      { vendorName: 'Beta', amount: 25000, category: 'y', matchConfidence: 0, invoiceDate: null },
    ],
    results:  [{ tenantId: 'a', name: 'A', proRataPercent: 100, totalAllocated: 55000, includedInvoices: [] }],
    tenants:  [{ id: 'a', name: 'A', excludedCategories: [] }],
    total: 55000, camYear: 2026,
  }).yellow.find(f => /missing invoice date/i.test(f.title));
  ok(many, 'the plural missing-date finding was not raised');
  eq(many.title, '2 invoices missing invoice date', 'plural title changed —');
  ok(many.conditions.some(c => /^Count: 2 invoices have no recorded invoice date$/.test(c)),
     'the plural count line does not read "2 invoices have" — got: ' +
     JSON.stringify(many.conditions.filter(c => /^Count:/.test(c))));
  ok(!many.conditions.some(c => /2 invoices has/.test(c)),
     'the plural count line was over-corrected to "2 invoices has"');
});

t('the allocation figures themselves are untouched', () => {
  const f = allocFinding();
  ok(/\$12,960\.75/.test(f.detail), '$12,960.75 no longer appears in the finding');
  ok(/\$55,000\.00/.test(f.detail), 'the pool total no longer appears in the finding');
});

const TOTAL_EXPECTED = 45;   // +1: the duplicate under-coverage finding must not return
t(`suite runs all ${TOTAL_EXPECTED} checks`, () => {
  eq(pass + fail + 1, TOTAL_EXPECTED, 'test count changed — update TOTAL_EXPECTED deliberately');
});

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} passed, ${fail} failed`);
if (fail) { failures.forEach(f => console.log(`  · ${f}`)); process.exit(1); }
