'use strict';
/**
 * test-cam-exclusions.js — the six regression tests specified in F-02
 * (evidence/FINDINGS-excluded-categories.md) and planned in
 * evidence/PLAN-excluded-categories-fix.md.
 *
 *   node test-cam-exclusions.js
 *
 * Executes real code, never a copy:
 *   - cam-exclusions.js and lease-intelligence.js are loaded from disk.
 *   - runFullReconciliation is EXTRACTED FROM script.js and evaluated, so tests
 *     2 and 3 measure a real allocated amount rather than a reimplementation.
 *     test-benchmark.js inlines its module and that is how a stale value once
 *     survived in the real file while its own tests passed.
 *
 * Every phrase used below is verbatim from Runs 1-3, not invented.
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

const CX = require('./cam-exclusions');
const scriptSrc = fs.readFileSync(path.join(__dirname, 'script.js'), 'utf8');
const scriptCode = code(scriptSrc);

// The real allocation engine, lifted out of script.js.
//
// runCAMAllocation was deleted by CAM-6 as a dead second engine, so
// runFullReconciliation is the only CAM arithmetic in the product and is what
// these tests must measure. It is not pure — it reaches for currentProperty,
// the invoice matcher and a toast — so those are stubbed and nothing else is.
// The exclusion filter, the pro-rata maths and the cap logic are the real code.
function extract(pattern, label) {
  const m = scriptSrc.match(pattern);
  if (!m) throw new Error(`${label} not found in script.js — the test cannot measure real dollars`);
  return m[0];
}
function loadEngine() {
  const src = [
    extract(/\nclass ReconciliationResult \{[\s\S]*?\n\}\n/, 'class ReconciliationResult'),
    extract(/\nclass Lease \{[\s\S]*?\n\}\n/, 'class Lease'),
    extract(/\nfunction parseSqft\(v\) \{[\s\S]*?\n\}\n/, 'parseSqft'),
    extract(/\nfunction runFullReconciliation\(property\) \{[\s\S]*?\n\}\n/, 'runFullReconciliation'),
  ].join('\n');
  const sandbox = {
    console: { log() {}, warn() {}, error() {}, groupCollapsed() {}, groupEnd() {} },
    // parseSqft delegates to source-values.js, which is the single reading of a
    // square-footage value shared with getValidTenants and the review engine.
    // The sandbox loads the real module rather than stubbing it, so these suites
    // exercise the same interpretation production does.
    window: { SourceValues: require('./source-values.js') },
    parseFloat, isNaN, Number, Math, Date, JSON, Set, Array, Object, String,
    currentProperty: () => ({ tenants: [] }),          // live-tenant overlay: none
    matchInvoiceToTenant: () => null,                   // force every invoice shared
    matchesTenant: () => false,
    showToast: () => {},
    _fmtMoney: n => String(n),
  };
  vm.createContext(sandbox);
  vm.runInContext(src + '\nthis.__engine = runFullReconciliation; this.__Lease = Lease;', sandbox);
  return { runFullReconciliation: sandbox.__engine, Lease: sandbox.__Lease };
}
const ENGINE = loadEngine();

// Runs the real engine over a single tenant and returns their allocated amount.
function allocate(rawExclusions, pool) {
  const st = CX.tenantExclusionState(rawExclusions);
  const lease = new ENGINE.Lease('T', '', 5000, '2020-01-01', '2030-12-31', st.applied, null, null);
  lease.id = 't1';
  const property = {
    leases: [lease],
    invoices: pool.map((e, i) => ({ ...e, vendorName: 'V' + i, invoiceDate: '2025-06-01' })),
    totalSqFt: 10000,
  };
  const results = ENGINE.runFullReconciliation(property);
  return results[0].totalAllocated;
}

function loadLeaseIntelligence() {
  const sandbox = { window: {}, console };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'lease-intelligence.js'), 'utf8'), sandbox);
  return sandbox.window.LeaseIntelligence;
}
const LI = loadLeaseIntelligence();

function loadAllocationIntegrity() {
  const sandbox = { window: {}, console };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'allocation-integrity.js'), 'utf8'), sandbox);
  return sandbox.window.AllocationIntegrity;
}
const AI = loadAllocationIntegrity();

// ── The real Run 1-3 phrases ─────────────────────────────────────────────────
const RUN_PHRASES = {
  exact: ['insurance'],
  ambiguous: ['capital expenditures', 'capital improvements (with exceptions)',
              'roof replacement', 'structural components'],
  unmapped: ['taxes', 'depreciation', 'interest', 'debt service', 'ground lease rent',
             'executive salaries', 'broker commissions', "brokers' leasing fees",
             "real estate brokers' commissions", 'tenant improvements',
             'tenant improvement costs', 'advertising/marketing costs',
             'affiliate markups above market', 'building depreciation',
             'costs billed solely to specific tenants', 'tenant-reimbursed costs'],
};

// Surgery Partners' three real wordings of the same lease clause, Runs 1/2/3.
const SURGERY = [
  "depreciation, ground lease rent, advertising and marketing costs, interest, executive salaries, real estate brokers' commissions, affiliate overhead/profit above market, costs reimbursed by other tenants, capital improvements (with exceptions)",
  'depreciation, ground lease rent, advertising/marketing costs, interest, executive salaries, broker commissions, affiliate markups, tenant-reimbursed costs, capital improvements (with exceptions)',
  'depreciation, ground lease rent, advertising/marketing costs, interest, executive salaries, broker commissions, affiliate markups above market, tenant-reimbursed costs, capital improvements (with exceptions)',
];

const POOL = [
  { category: 'management', amount: 10000 },
  { category: 'repairs',    amount: 40000 },
  { category: 'insurance',  amount: 20000 },
  { category: 'utilities',  amount: 30000 },
];
const mkTenant = raw => ({
  name: 'T', leasedSqft: 5000, totalSqft: 10000, capPct: null, capBaseAmount: null,
  excludedCategories:   CX.tenantExclusionState(raw).applied,
  exclusionsNotApplied: CX.tenantExclusionState(raw).notApplied,
});

console.log('\n── 1. Canonicalization: no silent mapping of ambiguous language ──');

t('the one exact match resolves and is applied', () => {
  const r = CX.canonicalizeExclusion('insurance');
  eq(r.status, 'exact'); eq(r.category, 'insurance');
});

t('capital/structural/roof phrases are AMBIGUOUS and carry no category', () => {
  RUN_PHRASES.ambiguous.forEach(p => {
    const r = CX.canonicalizeExclusion(p);
    eq(r.status, 'ambiguous', `${p}:`);
    eq(r.category, null, `${p} must not resolve to a category —`);
    ok(r.candidates.includes('repairs'), `${p} should name repairs as the near-miss`);
    ok(r.reason.length > 20, `${p} must explain why`);
  });
});

t('the 16 unmappable phrases resolve to nothing', () => {
  RUN_PHRASES.unmapped.forEach(p => {
    const r = CX.canonicalizeExclusion(p);
    eq(r.status, 'unmapped', `${p}:`);
    eq(r.category, null, `${p} must not resolve to a category —`);
  });
});

t('NO phrase from Runs 1-3 other than "insurance" can affect dollars', () => {
  const all = [...RUN_PHRASES.exact, ...RUN_PHRASES.ambiguous, ...RUN_PHRASES.unmapped];
  const applied = CX.appliedCategories(all.map(CX.canonicalizeExclusion));
  eq(JSON.stringify(applied), JSON.stringify(['insurance']),
     'a future "helpful" mapping would break this — that is the point');
});

t('hand-reviewed synonyms are narrower than or equal to their category', () => {
  Object.entries(CX.SAFE_SYNONYMS).forEach(([phrase, cat]) => {
    ok(CX.CANONICAL_CATEGORIES.includes(cat), `${phrase} maps to unknown category ${cat}`);
    const r = CX.canonicalizeExclusion(phrase);
    ok(r.status === 'mapped' || r.status === 'exact', `${phrase} did not resolve`);
  });
});

console.log('\n── 2. Money: a resolvable exclusion changes the allocated amount ──');

t('a "management fees" exclusion removes the management invoice from the pool', () => {
  const withoutExcl = allocate('', POOL);
  const withExcl    = allocate('management fees', POOL);
  eq(withoutExcl, 50000, 'baseline: half of 100,000 —');
  eq(withExcl, 45000, 'management (10,000) excluded, half of 90,000 —');
  eq(withoutExcl - withExcl, 5000, 'the drop must equal the pro-rata share of the excluded invoice —');
});

t('an ambiguous exclusion does NOT change the allocated amount', () => {
  eq(allocate('capital expenditures', POOL), allocate('', POOL),
     'mapping capex onto repairs would exclude 40,000 of ordinary repairs the tenant owes —');
});

console.log('\n── 3. Wording invariance: the Run 1-3 drift must not move dollars ──');

t('all three Surgery Partners wordings allocate identically', () => {
  const amounts = SURGERY.map(w => allocate(w, POOL));
  eq(new Set(amounts).size, 1, `wordings produced ${JSON.stringify(amounts)} —`);
});

t('all three Surgery Partners wordings resolve to the same applied set', () => {
  const sets = SURGERY.map(w => JSON.stringify(CX.tenantExclusionState(w).applied));
  eq(new Set(sets).size, 1, `applied sets differ: ${JSON.stringify(sets)}`);
});

t('Olenox Run 1 vs Run 2 (two extra phrases) allocate identically', () => {
  const r1 = "capital expenditures, interest, depreciation, tenant improvements, insurance, taxes, brokers' leasing fees";
  const r2 = r1 + ', structural components, roof replacement';
  eq(allocate(r1, POOL), allocate(r2, POOL));
});

console.log('\n── 4. No silent failure ──');

t('unapplied exclusions are exposed on the tenant, not swallowed', () => {
  const st = CX.tenantExclusionState("capital expenditures, taxes, insurance");
  eq(st.applied.length, 1);
  eq(st.notApplied.length, 2);
  ok(st.notApplied.every(u => u.raw && u.reason), 'each must carry its raw text and a reason');
});

t('allocation-integrity raises EXCLUSIONS_NOT_APPLIED', () => {
  const issues = AI.detectUnappliedExclusions([mkTenant('capital expenditures, taxes')]);
  eq(issues.length, 1);
  eq(issues[0].type, 'EXCLUSIONS_NOT_APPLIED');
  eq(issues[0].severity, 'high');
  ok(/could not be applied/.test(issues[0].message));
});

t('allocation-integrity stays silent when everything applied', () => {
  eq(AI.detectUnappliedExclusions([mkTenant('insurance')]).length, 0);
});

// _exclusionBlockReason reads two module globals; extract and run it for real
// rather than asserting on its text, so acknowledgement semantics are measured.
function loadBlockReason(lastTenants, tenantData) {
  const src = [
    extract(/\nfunction _exclusionState\(rawExcluded\) \{[\s\S]*?\n\}\n/, '_exclusionState'),
    extract(/\nfunction _exclusionBlockReason\(tenantName\) \{[\s\S]*?\n\}\n/, '_exclusionBlockReason'),
  ].join('\n');
  const sandbox = { lastTenants, tenantData, console, window: { CamExclusions: CX } };
  vm.createContext(sandbox);
  vm.runInContext(src + '\nthis.__fn = _exclusionBlockReason;', sandbox);
  return sandbox.__fn;
}

// The six acknowledgement-lifecycle cases. Each builds lastTenants the way a
// particular code path really builds it, so the difference between them is the
// presence or absence of exclusionFingerprint — the defect this covers.
const ACK_RAW = 'capital expenditures, taxes';
const ackState = CX.tenantExclusionState(ACK_RAW);
const freshTenant   = () => [{ name: 'T', excludedCategories: ackState.applied,
                               exclusionsNotApplied: ackState.notApplied,
                               exclusionFingerprint: ackState.fingerprint }];
// _mergeCamReconciliationRows / pre-F-02 snapshots: no exclusionFingerprint key.
const restoredTenant = () => [{ name: 'T', excludedCategories: ackState.applied,
                                exclusionsNotApplied: ackState.notApplied }];
const recWithAck = (raw, fp) => [{ tenant_name: 'T', excluded_categories: raw,
                                   ...(fp ? { _exclusionAck: { fingerprint: fp, at: 'x' } } : {}) }];

console.log('\n── Acknowledgement lifecycle across every path that builds lastTenants ──');

t('1. fresh reconciliation: acknowledge unblocks', () => {
  ok(loadBlockReason(freshTenant(), recWithAck(ACK_RAW, null))('T'), 'must block before acknowledgement');
  eq(loadBlockReason(freshTenant(), recWithAck(ACK_RAW, ackState.fingerprint))('T'), null,
     'acknowledgement must clear the block');
});

t('2. reloaded reconciliation with no exclusionFingerprint: acknowledge unblocks', () => {
  const before = loadBlockReason(restoredTenant(), recWithAck(ACK_RAW, null))('T');
  ok(before, 'must block before acknowledgement');
  ok(before.fingerprint, 'fingerprint must be DERIVED from the tenant record, not left empty');
  eq(before.fingerprint, ackState.fingerprint, 'derived fingerprint must equal the run-computed one');
  eq(loadBlockReason(restoredTenant(), recWithAck(ACK_RAW, before.fingerprint))('T'), null,
     'this is the loop the review found: acknowledgement must now clear the block');
});

t('3. older snapshot with a pre-existing acknowledgement unblocks', () => {
  eq(loadBlockReason(restoredTenant(), recWithAck(ACK_RAW, ackState.fingerprint))('T'), null,
     'an ack recorded earlier must still be honoured after a reload');
});

t('4. changing an exclusion after acknowledgement blocks again', () => {
  const changed = CX.tenantExclusionState(ACK_RAW + ', roof replacement');
  const lt = [{ name: 'T', excludedCategories: changed.applied, exclusionsNotApplied: changed.notApplied }];
  const r = loadBlockReason(lt, recWithAck(ACK_RAW + ', roof replacement', ackState.fingerprint))('T');
  ok(r, 'editing the exclusions must re-block');
  eq(r.staleAck, true, 'and must report the earlier review as stale');
});

t('5. reordering and re-spacing keeps the acknowledgement valid', () => {
  const respaced = ' TAXES ,  capital expenditures ';
  const st = CX.tenantExclusionState(respaced);
  const lt = [{ name: 'T', excludedCategories: st.applied, exclusionsNotApplied: st.notApplied }];
  eq(loadBlockReason(lt, recWithAck(respaced, ackState.fingerprint))('T'), null,
     'the same exclusion set written differently must not invalidate the review');
});

t('6. unapplied exclusions with no acknowledgement stay blocked', () => {
  const r = loadBlockReason(restoredTenant(), recWithAck(ACK_RAW, null))('T');
  ok(r, 'must block');
  eq(r.staleAck, false, 'no prior ack, so nothing is stale');
  eq(r.notApplied.length, 2);
});

t('no fingerprint is fabricated when the record cannot supply one', () => {
  // No tenant record at all, and a blank record: both must leave the fingerprint
  // empty and keep the statement blocked rather than invent an identity.
  const a = loadBlockReason(restoredTenant(), [])('T');
  ok(a && a.fingerprint === '', 'missing record must not yield a fingerprint');
  const b = loadBlockReason(restoredTenant(), [{ tenant_name: 'T', excluded_categories: '   ' }])('T');
  ok(b && b.fingerprint === '', 'blank exclusions must not yield a fingerprint');
});

t('[source] acknowledgement refuses to store an empty fingerprint', () => {
  const i = scriptCode.indexOf('function acknowledgeUnappliedExclusions');
  const body = scriptCode.slice(i, i + 900);
  ok(/if \(!block\.fingerprint\)/.test(body), 'no guard against storing a meaningless acknowledgement');
});

t('[source] the fingerprint is derived from the record, never defaulted', () => {
  const i = scriptCode.indexOf('function _exclusionBlockReason');
  const body = scriptCode.slice(i, i + 1400);
  ok(/_recRaw \? _exclusionState\(_recRaw\)\.fingerprint : ''/.test(body),
     'fingerprint is not derived from the tenant record');
  ok(/typeof rec\.excluded_categories === 'string' && rec\.excluded_categories\.trim\(\)/.test(body),
     'derivation does not require a real stored string');
});

t('a stale acknowledgement does NOT clear the block', () => {
  const raw = 'capital expenditures, taxes';
  const st  = CX.tenantExclusionState(raw);
  const lt  = [{ name: 'T', exclusionsNotApplied: st.notApplied, exclusionFingerprint: st.fingerprint }];

  const noAck = loadBlockReason(lt, [{ tenant_name: 'T' }])('T');
  ok(noAck, 'unacknowledged unapplied exclusions must block');
  eq(noAck.notApplied.length, 2);

  const good = loadBlockReason(lt, [{ tenant_name: 'T', _exclusionAck: { fingerprint: st.fingerprint } }])('T');
  eq(good, null, 'a matching acknowledgement should clear the block');

  const stale = loadBlockReason(lt, [{ tenant_name: 'T', _exclusionAck: { fingerprint: 'deadbeef' } }])('T');
  ok(stale, 'an acknowledgement for a DIFFERENT exclusion set must not clear the block');
  eq(stale.staleAck, true, 'and it must be reported as stale');
});

t('changing the exclusions invalidates an existing acknowledgement', () => {
  const before = CX.tenantExclusionState('capital expenditures, taxes');
  const after  = CX.tenantExclusionState('capital expenditures, taxes, roof replacement');
  const lt = [{ name: 'T', exclusionsNotApplied: after.notApplied, exclusionFingerprint: after.fingerprint }];
  const r = loadBlockReason(lt, [{ tenant_name: 'T', _exclusionAck: { fingerprint: before.fingerprint } }])('T');
  ok(r && r.staleAck, 'editing the lease exclusions must re-block the statement');
});

t('a tenant with everything applied is never blocked', () => {
  const st = CX.tenantExclusionState('insurance');
  const lt = [{ name: 'T', exclusionsNotApplied: st.notApplied, exclusionFingerprint: st.fingerprint }];
  eq(loadBlockReason(lt, [{ tenant_name: 'T' }])('T'), null);
});

t('[source] the statement is BLOCKED, not merely warned', () => {
  ok(/function _exclusionBlockReason/.test(scriptCode), 'no block function');
  const i = scriptCode.indexOf('function generateTenantStatement');
  // Read the whole function rather than a fixed byte window.
  //
  // This sliced 2400 characters, widened once from 1200 after the staleness
  // guards were added above the F-02 check and pushed the log call past the
  // boundary. It went on to fail a third time when the audit-readiness gate
  // landed. An ordering assertion should not break because something unrelated
  // was inserted above the lines it is about, so take the function to its
  // closing brace and stop guessing at a size.
  const nextFn = scriptCode.indexOf('\nfunction ', i + 1);
  const body   = scriptCode.slice(i, nextFn === -1 ? undefined : nextFn);
  ok(/const _block = _exclusionBlockReason\(tenantName\);/.test(body), 'guard not called');
  // The return has to follow the block screen. Testing for `if (_block) {` and
  // `return;` separately passed on any function containing a return anywhere,
  // which this one does several times over, so deleting the early return left
  // the assertion green. Anchor on the two statements in sequence.
  ok(/if \(_block\) \{/.test(body), 'the F-02 guard no longer branches on the block');
  ok(/_renderExclusionBlock\(_block\);\s*return;/.test(body),
     'the F-02 guard renders the block screen but does not return — the statement is still built');
  // The guard must precede statement construction: nothing may log or build a
  // statement before the early return.
  const guardPos = body.indexOf('_exclusionBlockReason(tenantName)');
  // The log call carries a draft/issued ternary since the audit-readiness gate
  // was added, so match the call rather than one literal argument.
  const logPos   = body.search(/logActivity\(\s*opts\.draft \?|logActivity\('tenant_statement'/);
  ok(guardPos !== -1, 'the F-02 guard is no longer called in generateTenantStatement');
  ok(logPos !== -1, 'the statement-generated log call was not found — check the call shape');
  ok(guardPos < logPos,
     'a blocked attempt must not be logged as a generated statement');
});

console.log('\n── 5. Empty is not the same as absent ──');

const mkLease = e => ({ tenant_name: 'X', leased_sqft: 1, start_date: '2020-01-01',
  end_date: '2021-01-01', lease_type: 'Triple Net (NNN)', excluded_categories: e,
  amendments: [], fieldEvidence: {} });
const camCodes = e => (LI.detectLeaseEdgeCases(mkLease(e), {}).edgeCases || [])
  .map(c => c.type).filter(x => x.startsWith('CAM_EXCLUSIONS'));

t('null (never extracted) fires CAM_EXCLUSIONS_UNDEFINED', () => {
  eq(JSON.stringify(camCodes(null)), JSON.stringify(['CAM_EXCLUSIONS_UNDEFINED']));
});

t('empty string (extracted, none found) fires CAM_EXCLUSIONS_EMPTY — the SIGA case', () => {
  eq(JSON.stringify(camCodes('')), JSON.stringify(['CAM_EXCLUSIONS_EMPTY']));
});

t('a populated value fires neither', () => {
  eq(JSON.stringify(camCodes('insurance')), JSON.stringify([]));
});

t('[source] the "" -> null -> "" round trip is gone', () => {
  ok(!/return v === '' \? null : v;/.test(scriptCode),
     "extraction still collapses '' to null");
  ok(/excluded_categories: raw\.excludedCategories \?\? raw\.excluded_categories \?\? null/.test(scriptCode),
     'extraction does not pass the value through');
  ok(!/excluded_categories: d\.excluded_categories \?\? d\.excludedCategories\s+\?\? '',/.test(scriptCode),
     "normalizeTenant still defaults null to ''");
});

t('state distinguishes never-extracted from none-found', () => {
  eq(CX.tenantExclusionState(null).extracted, false);
  eq(CX.tenantExclusionState('').extracted, true);
  eq(CX.tenantExclusionState('').empty, true);
});

console.log('\n── 6. Display honesty ──');

t('[source] the explain panel names what was NOT applied', () => {
  const i = scriptCode.indexOf('const exclHtml');
  ok(i !== -1, 'explain panel exclusion block not found');
  const slice = scriptCode.slice(i, i + 900);
  ok(/Excluded from your CAM: \$\{esc\(t\.excludedCategories\.join\(', '\)\)\}/.test(slice),
     'explain panel does not render the applied set');
  ok(/could not be applied automatically/.test(slice),
     'explain panel does not tell the tenant what was not applied');
});

t('[source] the statement names what was NOT applied and says it was still billed', () => {
  const i = scriptCode.indexOf('const exclNote');
  ok(i !== -1, 'statement exclusion note not found');
  const slice = scriptCode.slice(i, i + 900);
  ok(/could not be applied automatically/.test(slice),
     'statement does not tell the reader what was not applied');
  ok(/These expenses remain in the pool above\./.test(slice),
     'the statement does not say the unapplied expenses were still billed');
});

t('[source] every builder feeds the engine applied-only categories', () => {
  // No raw comma-split of excluded_categories may survive anywhere: the Lease
  // builder passes positionally, so a key-shaped assertion alone misses it.
  const rawSplits = scriptCode.match(/excluded_categories[\s\S]{0,40}?\.split\(','\)/g) || [];
  ok(rawSplits.length === 0,
     `raw split(s) still feed the engine unapplied categories: ${JSON.stringify(rawSplits)}`);
  const builders = scriptCode.match(/_appliedExclusions\(t\)/g) || [];
  ok(builders.length >= 5, `expected >= 5 resolver-backed builders, found ${builders.length}`);
});

t('the applied set never contains a value outside the invoice vocabulary', () => {
  const all = [...RUN_PHRASES.exact, ...RUN_PHRASES.ambiguous, ...RUN_PHRASES.unmapped, ...SURGERY];
  all.forEach(s => CX.tenantExclusionState(s).applied.forEach(c => {
    ok(CX.CANONICAL_CATEGORIES.includes(c), `${c} is not an invoice category`);
  }));
});

console.log('\n── Suite integrity ──');
t('the raw extracted phrase is preserved for audit', () => {
  const raw = "capital expenditures, brokers' leasing fees";
  const st = CX.tenantExclusionState(raw);
  eq(st.resolved.map(r => r.raw).join(', '), raw, 'raw text must survive resolution');
});

t('acknowledgement fingerprint is set-based, not string-based', () => {
  eq(CX.exclusionFingerprint('a, b'), CX.exclusionFingerprint(' B ,  a '), 'reorder/respace must not invalidate');
  ok(CX.exclusionFingerprint('a, b') !== CX.exclusionFingerprint('a, b, c'), 'adding one must invalidate');
});

const TOTAL_EXPECTED = 38;
t(`suite runs all ${TOTAL_EXPECTED} checks`, () => {
  eq(pass + fail + 1, TOTAL_EXPECTED, 'test count changed — update TOTAL_EXPECTED deliberately');
});

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} passed, ${fail} failed`);
if (fail) { failures.forEach(f => console.log(`  · ${f}`)); process.exit(1); }
