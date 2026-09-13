'use strict';
/**
 * test-tenant-billing-status.js — I-12: the billing verdict must be visible.
 *
 *   node test-tenant-billing-status.js
 *
 * THE DEFECT THIS EXISTS FOR
 *
 * I-4 made billing readiness a per-tenant question and answered it correctly.
 * It then reported the answer nowhere. On Brookfield Court a manager could not
 * tell which of four tenants were billable without generating four statements
 * one at a time; the results table's last column read "Calc verified" for all
 * four, which is a statement about the ARITHMETIC, and the only billing signal
 * on the screen was a property-level badge reading "Not ready to bill" — true of
 * the property, false of two of the tenants under it.
 *
 * Across thirty properties that is roughly a hundred and fifty statements opened
 * to find the ones that work.
 *
 * AND THE ORDERING
 *
 * Asking for Chen Family Practice's statement — a tenant holding over on a lease
 * that ended 2024-06-30 AND carrying an exclusion the matcher cannot apply —
 * produced a screen entirely about "capital / ambiguous / repairs" that did not
 * mention the holdover at all. The material reason was reachable only by
 * pressing "I have reviewed these — issue the statement", a button promising a
 * document it could not produce.
 *
 * WHAT IS ASSERTED
 *
 * That the chip, the roster line, the card button and the refusal all read ONE
 * derivation. Each of those four surfaces has, at some point in this codebase,
 * been the one that disagreed.
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

// ── _tenantBillingState, evaluated against a stubbed exclusion gate ─────────
// The function is a plain declaration in script.js. Pull it out and give it the
// two things it consults, so this suite exercises the real branching.
const _src = scriptSrc.slice(
  scriptSrc.indexOf('function _tenantBillingState(tenantName, exposure) {'),
  scriptSrc.indexOf('function _statementReadinessBlock(tenantName) {'));
function billingState(tenantName, exposure, exclusion) {
  const f = new Function('window', '_exclusionBlockReason',
    _src + '; return _tenantBillingState;')({ AuditExposure: AX }, () => exclusion || null);
  return f(tenantName, exposure);
}

const expiredLease = (n) => ({
  title: `${n} is being billed 2026 CAM on a lease that ended 2024-06-30`,
  conditions: [`Tenant: ${n}`], impact: { amount: 27904.17, kind: 'at_risk' },
});
const modGross = (n) => ({
  severity: 'yellow', blocksBilling: true,
  title: `Modified Gross tenant receiving shared CAM — ${n}`,
  conditions: [`Tenant: ${n}`],
});
const concentration = () => ({
  title: 'Unusually large invoice — Summit Roofing: $70,000.00 (43.6% of total CAM)',
  conditions: ['Vendor: "Summit Roofing"'], impact: { amount: 70000, kind: 'concentration' },
});
const unappliedExclusion = { notApplied: [
  { raw: 'capital', status: 'ambiguous', candidates: ['repairs'],
    reason: 'Capital expenditure exclusions have no capital/operating axis in the invoice vocabulary.' }] };

const exposure = (red, yellow) => AX.deriveExposure({ red: red || [], yellow: yellow || [], green: [] }, 160500);

console.log('\n══ Tenant billing status ══');
console.log('\n── THE BROOKFIELD COURT MATRIX ──');

const BROOKFIELD = exposure([expiredLease('Chen Family Practice')],
                            [modGross('Novara Wellness')]);

t('Fairview and Lakeside read Billable', () => {
  ['Fairview Dental Group', 'Lakeside Imaging Partners'].forEach(n => {
    const b = billingState(n, BROOKFIELD, null);
    eq(b.state, 'billable', `${n} should be billable`);
    eq(b.label, 'Billable');
  });
});

t('Novara reads Needs confirmation', () => {
  const b = billingState('Novara Wellness', BROOKFIELD, null);
  eq(b.state, 'confirm');
  eq(b.label, 'Needs confirmation');
});

t('Chen reads Blocked', () => {
  const b = billingState('Chen Family Practice', BROOKFIELD, null);
  eq(b.state, 'blocked');
  eq(b.label, 'Blocked');
});

t('each state offers an action that does not overpromise', () => {
  eq(billingState('Fairview Dental Group', BROOKFIELD, null).cta, '\u{1F9FE} Tenant Statement');
  ok(/Confirm to bill/.test(billingState('Novara Wellness', BROOKFIELD, null).cta));
  ok(/can’t bill/.test(billingState('Chen Family Practice', BROOKFIELD, null).cta),
     'a blocked tenant still offers a button reading "Tenant Statement"');
});

console.log('\n── A property-level blocker is named as such ──');

const WIDE = exposure([expiredLease('Chen Family Practice'), concentration()],
                      [modGross('Novara Wellness')]);

t('every tenant is blocked, including the previously clean ones', () => {
  ['Fairview Dental Group', 'Lakeside Imaging Partners',
   'Novara Wellness', 'Chen Family Practice'].forEach(n => {
    eq(billingState(n, WIDE, null).state, 'blocked', `${n} should be blocked by the property finding`);
  });
});

t('and a clean tenant\'s row says the block is property-level, not its own', () => {
  const b = billingState('Fairview Dental Group', WIDE, null);
  eq(b.propertyLevel, true);
  eq(b.label, 'Blocked · property',
     'a tenant with nothing wrong with it must not read as though it has its own problem');
  ok(/property-level/.test(b.reason), b.reason);
});

t('the property headline stays Not ready to bill', () => {
  const p = AX.billingReadiness(WIDE);
  eq(p.canBill, false);
  eq(p.label, 'Not ready to bill');
  ok(/property-level exception/.test(p.reason), p.reason);
});

console.log('\n── The chip agrees with the gate that will actually refuse ──');

t('THE CONSISTENCY TRAP: an exclusion-only block does not read Billable', () => {
  // billingReadiness clears this tenant. The older per-tenant exclusion gate does
  // not. Reading only the I-4 verdict would put "Billable" on a row whose
  // statement is refused the moment it is asked for — the two-surfaces-one-fact
  // defect this codebase keeps producing.
  const b = billingState('Fairview Dental Group', BROOKFIELD, unappliedExclusion);
  eq(b.state, 'confirm', 'an unapplied lease exclusion was ignored by the chip');
  eq(b.exclusionOnly, true);
  ok(/could not be applied/.test(b.reason), b.reason);
});

t('an audit blocker outranks an exclusion in the same row', () => {
  const b = billingState('Chen Family Practice', BROOKFIELD, unappliedExclusion);
  eq(b.state, 'blocked', 'the material reason must decide the chip');
  ok(b.exclusion, 'the exclusion detail is dropped rather than carried');
});

t('FAILS CLOSED with no exposure at all', () => {
  const b = billingState('Anyone', null, null);
  eq(b.state, 'blocked', 'an unreadable audit state must not read as billable');
});

console.log('\n── Ownership: no second billing predicate ──');

t('[source] the chip reads billingReadiness and the existing exclusion gate', () => {
  const i = scriptCode.indexOf('function _tenantBillingState');
  const body = scriptCode.slice(i, scriptCode.indexOf('\nfunction _statementReadinessBlock', i));
  ok(/AXs\.billingReadiness\(exposure, tenantName\)/.test(body),
     'the chip does not read the I-4 verdict');
  ok(/_exclusionBlockReason\(tenantName\)/.test(body),
     'the chip does not read the existing exclusion gate');
  ok(!/counts\.red/.test(body) && !/summary\.red/.test(body),
     'the chip re-derives blocking from findings instead of asking the gate');
});

t('[source] the roster line and the column read the same object', () => {
  ok(/const _tenantBilling = \{\};/.test(scriptCode), 'per-tenant state is not derived once');
  ok(/_tenantBilling\[r\.name\] = _tenantBillingState\(r\.name, _exposure\)/.test(scriptCode),
     'the table does not populate the shared map');
  ok(/_billableNames = results\.map\(r => r\.name\)\.filter\(n => _tenantBilling\[n\]\.state === 'billable'\)/.test(scriptCode),
     'the roster count is computed from something other than the per-tenant map');
});

t('[source] the results table carries a Billing status column', () => {
  ok(/>Billing status<\/th>/.test(scriptCode), 'the column header is gone');
  ok(/rcs-bill rcs-bill--\$\{b\.state\}/.test(scriptCode), 'the chip does not render its state');
  ok(/CAM calculation<\/th>/.test(scriptCode),
     'the calc-state column was replaced rather than joined — they answer different questions');
});

t('[source] the roster line states the count in words, above the table', () => {
  ok(/tenant\$\{results\.length === 1 \? '' : 's'\} billable/.test(scriptCode),
     'the at-a-glance count is gone');
  const panelHead = scriptCode.indexOf('rcs-coverage-badge');
  const tableHead = scriptCode.indexOf('>Billing status</th>');
  ok(panelHead < tableHead && scriptCode.indexOf('rcs-bill-roster') < tableHead,
     'the roster line is inside the table rather than above it — on a phone that is several screens down');
});

console.log('\n── Refusal ordering: the material reason speaks first ──');

t('[source] the audit gate is consulted before the exclusion screen renders', () => {
  const i = scriptCode.indexOf('function generateTenantStatement');
  const body = scriptCode.slice(i, i + 3000);
  const readyAt = body.indexOf('_statementReadinessBlock(tenantName)');
  const renderExclusionAt = body.indexOf('_renderExclusionBlock(_block)');
  ok(readyAt > 0 && renderExclusionAt > 0, 'a gate is missing');
  ok(readyAt < renderExclusionAt,
     'the exclusion screen still renders before the audit gate is asked — the technicality pre-empts the material reason');
});

t('[source] the exclusion detail is carried onto the readiness screen', () => {
  ok(/if \(_ready\) _ready\.exclusion = _block;/.test(scriptCode),
     'the exclusion information is dropped when the audit gate refuses first');
  ok(/Also on this lease/.test(scriptCode),
     'the readiness screen renders no secondary exclusion section');
});

t('[source] the exclusion screen is still reachable when it IS the reason', () => {
  const i = scriptCode.indexOf('function generateTenantStatement');
  const body = scriptCode.slice(i, i + 3000);
  ok(/if \(_block\) \{[\s\S]{0,400}_renderExclusionBlock\(_block\);/.test(body),
     'a tenant blocked only by an unapplied exclusion now gets no refusal screen at all');
});

t('[source] the statement button no longer promises what it cannot produce', () => {
  ok(/_lbl = _b \? _b\.cta :/.test(scriptCode),
     'the result-card button label is fixed rather than following billing state');
  eq((scriptCode.match(/tenant-stmt-card-btn\$\{_b && _b\.state !== 'billable'/g) || []).length, 2,
     'expected both result-card buttons to follow billing state');
});

console.log('\n' + '─'.repeat(56));
if (fail) { console.log(`\x1b[31mRESULT: ${pass} passed, ${fail} failed\x1b[0m`); process.exit(1); }
console.log(`\x1b[32mRESULT: ${pass} passed, 0 failed\x1b[0m`);
