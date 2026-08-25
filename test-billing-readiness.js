'use strict';
/**
 * test-billing-readiness.js — a tenant is blocked by its own problems, not by
 * somebody else's.
 *
 *   node test-billing-readiness.js
 *
 * THE DEFECT THIS EXISTS FOR (I-4)
 *
 * billingReadiness(x) branched on `x.counts.red > 0` over PROPERTY-WIDE
 * exposure, and every tenant statement asked it. On Riverside Commons that
 * meant one anchor holding over on a month-to-month made four clean inline
 * tenants unbillable:
 *
 *     Cornerstone Physical Therapy   BLOCKED   exceptions naming it: 0 of 1
 *
 * Anchor holdover is routine. The product was unusable in a common situation.
 *
 * THE MODEL
 *
 * Three authored facts per finding, two of which already existed:
 *
 *     severity        how alarming is this            (already authored)
 *     Tenant: marker  who is it about                 (read by findingScope)
 *     blocksBilling   may we bill anyway              (new, defaults to red)
 *
 * SEVERITY AND BLOCKING ARE SEPARATE AXES. That is not a refactor, it is the
 * finding: a >20% YoY rise is red and blocks nobody, while a Gross-lease tenant
 * receiving shared CAM is yellow and blocks its own statement. Treating the two
 * as one axis produced both errors at once.
 */

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');

const AX = require('./audit-exposure.js');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log(`  \x1b[32m✓\x1b[0m ${name}`); pass++; }
  catch (e) { console.log(`  \x1b[31m✗\x1b[0m ${name}\n      → ${e.message}`); fail++; }
}
const ok = (c, m) => assert.ok(c, m);
const eq = (a, b, m) => assert.strictEqual(a, b, m || `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);

const scriptSrc  = fs.readFileSync(path.join(__dirname, 'script.js'), 'utf8');
const scriptCode = scriptSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const engineSrc  = fs.readFileSync(path.join(__dirname, 'reconciliation-engine.js'), 'utf8');

// ── finding builders, shaped exactly as the detectors emit them ─────────────
const expiredLease = (name) => ({
  title: `${name} is being billed 2026 CAM on a lease that ended 2016-02-28`,
  conditions: [`Tenant: ${name}`, 'Lease end date: 2016-02-28'],
  impact: { amount: 4129.65, kind: 'at_risk' },
});
const grossCam = (name) => ({
  severity: 'yellow', blocksBilling: true,
  title: `Gross-lease tenant receiving shared CAM — ${name} ($4,816.43)`,
  conditions: [`Tenant: ${name}`, 'Lease type: Gross'],
});
const yoy = () => ({
  blocksBilling: false,
  title: 'Total CAM increased 24.0% year-over-year',
  conditions: ['Threshold: >20% triggers critical flag'],
});
const concentration = () => ({
  title: 'Unusually large invoice — Acme: $38,000.00 (52.8% of total CAM)',
  conditions: ['Vendor: "Acme"'], impact: { amount: 38000, kind: 'concentration' },
});
const overAllocation = () => ({
  title: 'Pro-rata over-allocation: shares total 106.2% of the property',
  conditions: ['Pro-rata sum: 106.20%'],
});
const coverage = () => ({ severity: 'yellow', title: 'Property CAM coverage: 91.7% documented', conditions: [] });

const exposure = (red, yellow) => AX.deriveExposure({ red: red || [], yellow: yellow || [], green: [] }, 96950);

console.log('\n══ Billing readiness ══');
console.log('\n── THE RIVERSIDE CASE ──');

// Property: 5 tenants. Anchor holding over, one Gross tenant, three clean.
const RIVERSIDE = exposure([expiredLease('Value Grocers #418'), yoy()],
                           [grossCam('Golden Wok'), coverage()]);

t('the anchor is blocked by its own expired lease', () => {
  const r = AX.billingReadiness(RIVERSIDE, 'Value Grocers #418');
  eq(r.canBill, false);
  eq(r.label, 'Not ready to bill');
  eq(r.blockers.length, 1);
});

t('THE FIX: a clean tenant is billable despite the anchor holding over', () => {
  ['Cornerstone Physical Therapy', 'Sunrise Cleaners', 'Bella Nails & Spa'].forEach(n => {
    const r = AX.billingReadiness(RIVERSIDE, n);
    eq(r.canBill, true, `${n} is still blocked by somebody else's problem`);
    eq(r.label, 'Ready to bill');
  });
});

t('the Gross tenant is held, and told it needs CONFIRMATION not correction', () => {
  const r = AX.billingReadiness(RIVERSIDE, 'Golden Wok');
  eq(r.canBill, false, 'a Gross tenant receiving shared CAM must not silently bill');
  eq(r.label, 'Needs confirmation before billing',
     'a finding the engine will not assert as a violation must not be reported as one');
  ok(/confirmed/.test(r.reason), r.reason);
});

t('the property headline survives, and no longer claims a global block', () => {
  const p = AX.billingReadiness(RIVERSIDE);
  eq(p.canBill, false, 'the property is not fully billable and must say so');
  eq(p.label, 'Not ready to bill');
  eq(p.reason, '2 tenants cannot be billed yet.');
  ok(!/before statements are issued/.test(p.reason),
     'the headline still asserts that NO statement can issue');
});

console.log('\n── Severity and blocking are separate axes ──');

t('YoY >20% stays RED for scoring and display', () => {
  // Deliberately not demoted: demoting changes counts.yellow, which feeds a
  // per-finding health-score deduction that this decision does not authorise.
  eq(RIVERSIDE.counts.red, 2, 'the YoY finding left the red bucket');
  eq(AX.blocksBilling(yoy(), 'red'), false);
});

t('...and blocks NOBODY, on a property where it is the only finding', () => {
  const x = exposure([yoy()], []);
  eq(x.blocking.property.length, 0);
  eq(AX.billingReadiness(x).canBill, true, 'a 24% YoY rise still blocks the property');
  ['Anyone', 'Someone Else'].forEach(n =>
    eq(AX.billingReadiness(x, n).canBill, true, `${n} blocked by a documentation flag`));
});

t('a YELLOW finding CAN block, which is the other half of the same point', () => {
  const x = exposure([], [grossCam('Golden Wok')]);
  eq(x.counts.red, 0, 'nothing was escalated to red');
  eq(AX.billingReadiness(x, 'Golden Wok').canBill, false);
  eq(AX.billingReadiness(x, 'Another Tenant').canBill, true, 'it leaked to another tenant');
});

t('blocksBilling DEFAULTS to red — every existing finding keeps its behaviour', () => {
  eq(AX.blocksBilling({ title: 'x' }, 'red'), true, 'an unmarked red must fail closed');
  eq(AX.blocksBilling({ title: 'x' }, 'yellow'), false);
  eq(AX.blocksBilling({ title: 'x', severity: 'red' }, 'yellow'), true, 'severityOf must win over the bucket');
});

console.log('\n── Property-scoped blockers still stop everyone ──');

t('an over-allocation blocks every tenant, including clean ones', () => {
  const x = exposure([overAllocation()], []);
  eq(x.blocking.property.length, 1);
  eq(AX.billingReadiness(x, 'Perfectly Clean Tenant').canBill, false,
     'shares totalling 106% make every share wrong');
  ok(/property-level/.test(AX.billingReadiness(x, 'Perfectly Clean Tenant').reason));
});

t('so does a material concentration — it moves the pool every share comes from', () => {
  const x = exposure([concentration()], []);
  eq(AX.billingReadiness(x, 'Anyone').canBill, false);
});

t('a property blocker outranks the headline wording', () => {
  const x = exposure([concentration(), expiredLease('A')], []);
  const p = AX.billingReadiness(x);
  ok(/property-level exception/.test(p.reason), p.reason);
  ok(!/tenants cannot be billed/.test(p.reason),
     'a property-level block must not be described as a per-tenant queue');
});

t('and both scopes are reported together on the affected tenant', () => {
  const x = exposure([concentration(), expiredLease('A')], []);
  const r = AX.billingReadiness(x, 'A');
  eq(r.blockers.length, 2);
  ok(/1 property-level and 1 on this tenant/.test(r.reason), r.reason);
});

console.log('\n── Nothing outstanding ──');

t('a clean reconciliation bills, at both scopes', () => {
  const x = exposure([], []);
  eq(AX.billingReadiness(x).canBill, true);
  eq(AX.billingReadiness(x).label, 'Ready to bill');
  eq(AX.billingReadiness(x, 'Anyone').canBill, true);
});

t('advisories alone never block either scope', () => {
  const x = exposure([], [coverage(), { severity: 'yellow', title: 'Cap applied to A', conditions: ['Tenant: A'] }]);
  eq(AX.billingReadiness(x).canBill, true);
  eq(AX.billingReadiness(x).label, 'Bill with review');
  eq(AX.billingReadiness(x, 'A').canBill, true, 'an advisory naming a tenant must not block it');
});

console.log('\n── Ownership: one scope derivation, one blocking tally ──');

t('findingScope moved to audit-exposure and script.js delegates', () => {
  eq(typeof AX.findingScope, 'function');
  eq(AX.findingScope(expiredLease('X')).tenant, 'X');
  eq(AX.findingScope(concentration()).level, 'property');
  const i = scriptCode.indexOf('function _findingScope(f) {');
  const body = scriptCode.slice(i, i + 200);
  ok(/AuditExposure\.findingScope\(f\)/.test(body), 'script.js re-implements the scope derivation');
});

t('the blocking tally is built in the pass deriveExposure already makes', () => {
  const src = String(AX.deriveExposure);
  eq((src.match(/list\.forEach/g) || []).length, 1,
     'a second walk over the findings was added — the count and the list can now disagree');
});

t('[source] the statement gate reads the blocking set, not summary.red', () => {
  // A Gross blocker is YELLOW. Filtering reds would report that tenant billable.
  const i = scriptCode.indexOf('function _statementReadinessBlock');
  const body = scriptCode.slice(i, scriptCode.indexOf('\n}', i));
  ok(/billingReadiness\(exposure, tenantName\)/.test(body), 'the gate still asks the property question');
  ok(!/summary\.red\.filter/.test(body), 'the gate filters reds and would miss a yellow blocker');
  ok(/readiness\.blockers/.test(body), 'the gate does not read the blocking set');
});

t('[source] the three property-level callers were not given a tenant', () => {
  const calls = (scriptCode.match(/billingReadiness\([^)]*\)/g) || []);
  const withTenant = calls.filter(c => /,\s*tenantName/.test(c));
  eq(withTenant.length, 1, `expected exactly one tenant-scoped caller, saw ${JSON.stringify(calls)}`);
});

t('[source] both Gross findings block their own tenant and stay yellow', () => {
  const gross = engineSrc.slice(engineSrc.indexOf('Gross / Modified Gross tenant receiving shared CAM'));
  eq((gross.match(/blocksBilling: true/g) || []).length, 2, 'a Gross variant stopped blocking');
  ok(!/severity: 'red'/.test(gross), 'a Gross finding was escalated to red — it asserts a violation the engine cannot prove');
});

t('[source] YoY carries the marker rather than a changed severity', () => {
  const i = scriptCode.indexOf("title: `Total CAM ${dir}");
  const around = scriptCode.slice(i - 300, i);
  ok(/blocksBilling: false/.test(around), 'the YoY finding no longer opts out of blocking');
  ok(/red\.push/.test(around), 'the YoY finding was demoted — that changes the health score');
});

t('[source] the blocked screen explains only what is on it', () => {
  // It stated "Requiring lease verification is CAM allocated to a tenant whose
  // lease on file has expired" unconditionally. Golden Wok is held for a Gross
  // CAM treatment and its lease has not expired.
  ok(/subtotals\.at_risk != null/.test(scriptCode),
     'the expired-lease explanation is unconditional again');
});

console.log('\n' + '─'.repeat(56));
if (fail) { console.log(`\x1b[31mRESULT: ${pass} passed, ${fail} failed\x1b[0m`); process.exit(1); }
console.log(`\x1b[32mRESULT: ${pass} passed, 0 failed\x1b[0m`);
