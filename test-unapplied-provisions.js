'use strict';
/**
 * test-unapplied-provisions.js — a lease term the engine does not apply holds
 * that tenant's statement, and nobody else's.
 *
 *   node test-unapplied-provisions.js
 *
 * THE GAP THIS EXISTS FOR
 *
 * Intake extracts an expense stop, a gross-up, a base year, an administrative
 * fee and its basis, and a pro-rata method; stores each with its clause; and
 * lets a reviewer mark it verified. The allocation reads none of them. So a
 * tenant whose lease carried a $4.50 expense stop was billed the full NNN
 * share, the row beside the figure read "Calc verified", and the statement
 * issued. The number was confident and wrong.
 *
 * THE FIX IS A GATE, NOT A CALCULATION. reconciliation-engine.js detector 3b
 * raises one yellow, tenant-scoped, blocking finding per tenant that carries
 * such a term and receives shared CAM. The existing machinery — findingScope,
 * blocksBilling, deriveExposure, billingReadiness, the statement gate — does
 * the rest. The engine's arithmetic is untouched, and this suite proves that
 * too.
 *
 *   A · each provision, alone, blocks that tenant's statement
 *   B · null, absent and '' do not
 *   C · zero is a stated provision
 *   D · the vocabulary the engine already applies does not fire
 *   E · one tenant's term does not hold another tenant
 *   F · a tenant with no shared CAM is not held
 *   G · lease type stays with the Gross detector — never repeated here
 *   H · one finding per tenant, every term listed
 *   I · the clause is quoted when it is on file
 *   J · [source] the engine reads none of these fields; the allocation is untouched
 */
const assert = require('assert');
const fs     = require('fs');
const path   = require('path');
const vm     = require('vm');
const AX     = require('./audit-exposure.js');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log(`  \x1b[32m✓\x1b[0m ${name}`); pass++; }
  catch (e) { console.log(`  \x1b[31m✗\x1b[0m ${name}\n      → ${e.message}`); fail++; }
}
const ok = (c, m) => assert.ok(c, m);
const eq = (a, b, m) => assert.strictEqual(a, b, m || `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
const sec = s => console.log(`\n── ${s} ──`);

function loadReconEngine() {
  const sandbox = { window: { LeasePeriod: require('./lease-period.js') }, console };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'reconciliation-engine.js'), 'utf8'), sandbox);
  return sandbox.window.ReconciliationEngine;
}
const RCE = loadReconEngine();

// ── fixtures, shaped exactly as runAllocation hands them to the detector ─────
const shared = (n, share) => ({ vendorName: n, category: 'repairs', amount: 1000, allocation: 'shared', share });
const direct = (n, share) => ({ vendorName: n, category: 'repairs', amount: share, allocation: 'direct', share });
const result = (id, name, invoices) => ({
  tenantId: id, name, proRataPercent: 10, totalAllocated: (invoices || []).reduce((s, i) => s + i.share, 0),
  includedInvoices: invoices || [],
});
const SHARED = [shared('Janitorial', 300), shared('Insurance', 200)];
// Dates cover the period so detector 1 stays quiet; NNN so detector 4 does.
const tenant = (id, name, fields) => Object.assign(
  { id, tenant_name: name, name, lease_type: 'NNN', leased_sqft: 1000, start_date: '2020-01-01', end_date: '2030-12-31' },
  fields || {});
const detect = (results, tenants) => RCE.detectReconciliationIssues(results, { tenants }, '2025-12-31');
const isProvision = f => /^Lease provisions? not applied — /.test(f.title);
const provisionFlags = flags => flags.filter(isProvision);

// The gate, fed exactly what buildAuditSummary feeds it: the detector's own
// findings, bucketed by severity.
function readiness(flags, tenantName) {
  const summary = { red: flags.filter(f => f.severity === 'red'), yellow: flags.filter(f => f.severity === 'yellow'), green: [] };
  const x = AX.deriveExposure(summary, 10000);
  return { x, r: AX.billingReadiness(x, tenantName), property: AX.billingReadiness(x) };
}

// One tenant, one term.
const single = (fields) => {
  const flags = detect([result('t1', 'Whole Health Market', SHARED)], [tenant('t1', 'Whole Health Market', fields)]);
  return { flags, mine: provisionFlags(flags) };
};

const CASES = [
  ['expense_stop',    { expense_stop: 4.5 },                          'Expense stop',             'Expense stop: $4.50/sqft'],
  ['gross_up_pct',    { gross_up_pct: 95 },                           'Gross-up',                 'Gross-up: 95%'],
  ['baseYear',        { baseYear: 2019 },                             'Base year',                'Base year: 2019'],
  ['admin_fee_pct',   { admin_fee_pct: 15 },                          'Administrative fee',       'Administrative fee: 15%'],
  ['admin_fee_basis', { admin_fee_basis: 'controllable_expenses' },   'Administrative fee basis', 'Administrative fee basis: controllable expenses'],
  ['pro_rata_method', { pro_rata_method: 'occupied' },                'Pro-rata method',          'Pro-rata method: occupied'],
];

sec('A · each provision, alone, holds that tenant’s statement');
CASES.forEach(([key, fields, label, cond]) => {
  t(`${key}: one yellow, blocking, tenant-scoped finding naming the term`, () => {
    const { mine } = single(fields);
    eq(mine.length, 1, `expected exactly one provision finding, got ${mine.length}`);
    const f = mine[0];
    eq(f.severity, 'yellow', 'severity — the engine cannot prove the figure is wrong');
    eq(f.blocksBilling, true, 'blocksBilling — but the figure is what is in doubt');
    eq(f.disputable, false, 'it is a verification, not a dispute');
    eq(f.kind, 'lease_verification');
    ok(f.title.includes('Whole Health Market'), `title names the tenant: ${f.title}`);
    ok(f.title.includes(label), `title names the term: ${f.title}`);
    eq(f.conditions[0], 'Tenant: Whole Health Market', 'the first condition is the scope marker');
    ok(f.conditions.includes(cond), `conditions carry the value: ${JSON.stringify(f.conditions)}`);
    ok(f.conditions.some(c => /does not apply this provision/.test(c)), 'it says MainStreet does not apply the term');
    ok(/cannot be issued until/.test(f.detail), 'it says the statement cannot be issued until confirmed');
    eq(AX.findingScope(f).level, 'tenant'); eq(AX.findingScope(f).tenant, 'Whole Health Market');
    eq(f.provisions.length, 1); eq(f.provisions[0].key, key);
  });
  t(`${key}: the gate refuses that tenant with "Needs confirmation"`, () => {
    const { flags } = single(fields);
    const { x, r } = readiness(flags, 'Whole Health Market');
    eq(r.canBill, false);
    eq(r.label, 'Needs confirmation before billing');
    ok(r.blockers.some(b => isProvision(b)), 'the provision finding is among the blockers');
    eq(x.blocking.property.length, 0, 'nothing property-wide');
    ok((x.blocking.byTenant['Whole Health Market'] || []).some(b => isProvision(b)), 'held under the tenant’s own name');
  });
});
t('base year is read under its stored key and its canonical key', () => {
  eq(single({ base_year: 2018 }).mine.length, 1, 'base_year');
  eq(single({ baseYear: 2018 }).mine.length, 1, 'baseYear');
});

sec('B · null, absent and \'\' are absent — nothing fires, the tenant bills');
CASES.forEach(([key]) => {
  t(`${key}: null, missing and '' do not fire`, () => {
    eq(single({ [key]: null }).mine.length, 0, 'null');
    eq(single({}).mine.length, 0, 'missing');
    eq(single({ [key]: '' }).mine.length, 0, "''");
    eq(single({ [key]: '   ' }).mine.length, 0, 'whitespace');
  });
});
t('a numeric field that cannot be read is absent, not a provision', () => {
  eq(single({ expense_stop: 'N/A' }).mine.length, 0);
  eq(single({ gross_up_pct: 'see lease' }).mine.length, 0);
});
t('a clean NNN tenant is Ready to bill through the whole gate', () => {
  const { flags } = single({});
  const { r, property } = readiness(flags, 'Whole Health Market');
  eq(r.canBill, true); eq(r.label, 'Ready to bill');
  eq(property.canBill, true);
});

sec('C · zero is a stated provision');
t('an expense stop of 0 fires, and reads $0.00/sqft', () => {
  const { mine } = single({ expense_stop: 0 });
  eq(mine.length, 1); ok(mine[0].conditions.includes('Expense stop: $0.00/sqft'), JSON.stringify(mine[0].conditions));
});
t('a gross-up of 0 and an administrative fee of 0 fire', () => {
  eq(single({ gross_up_pct: 0 }).mine.length, 1);
  eq(single({ admin_fee_pct: 0 }).mine.length, 1);
  ok(single({ admin_fee_pct: 0 }).mine[0].conditions.includes('Administrative fee: 0%'));
});
t('and 0 holds the statement like any other value', () => {
  eq(readiness(single({ expense_stop: 0 }).flags, 'Whole Health Market').r.canBill, false);
});

sec('D · the vocabulary the engine already applies does not fire');
t('pro-rata method "rentable" is what the engine does — silent, in any case', () => {
  eq(single({ pro_rata_method: 'rentable' }).mine.length, 0);
  eq(single({ pro_rata_method: ' Rentable ' }).mine.length, 0);
});
['occupied', 'leasable', 'gross'].forEach(m => t(`pro-rata method "${m}" fires`, () => {
  const { mine } = single({ pro_rata_method: m });
  eq(mine.length, 1); ok(mine[0].conditions.includes(`Pro-rata method: ${m}`));
}));
t('fee basis "operating_expenses" is the whole pool the fee check divides by — silent', () => {
  eq(single({ admin_fee_basis: 'operating_expenses' }).mine.length, 0);
});
['controllable_expenses', 'excluding_management_fee', 'unstated', 'per_square_foot'].forEach(b => t(`fee basis "${b}" fires`, () => {
  eq(single({ admin_fee_basis: b }).mine.length, 1);
}));

sec('E · one tenant’s term does not hold another tenant');
t('the tenant with the stop is held; the clean tenant on the same property bills', () => {
  const flags = detect(
    [result('a', 'Stop Co', SHARED), result('b', 'Clean Co', SHARED)],
    [tenant('a', 'Stop Co', { expense_stop: 4.5 }), tenant('b', 'Clean Co')]);
  eq(provisionFlags(flags).length, 1);
  const { x } = readiness(flags);
  eq(AX.billingReadiness(x, 'Stop Co').canBill, false);
  eq(AX.billingReadiness(x, 'Clean Co').canBill, true, 'Clean Co was held for Stop Co’s lease');
  eq(x.blocking.property.length, 0);
  eq(Object.keys(x.blocking.byTenant).join(','), 'Stop Co');
});

sec('F · a tenant with no shared CAM is not held');
t('only direct charges: the term is irrelevant to what was computed', () => {
  const flags = detect([result('t1', 'Direct Co', [direct('Own repair', 900)])], [tenant('t1', 'Direct Co', { expense_stop: 4.5 })]);
  eq(provisionFlags(flags).length, 0);
});
t('no charges at all: nothing to hold', () => {
  const flags = detect([result('t1', 'Empty Co', [])], [tenant('t1', 'Empty Co', { expense_stop: 4.5, gross_up_pct: 95 })]);
  eq(provisionFlags(flags).length, 0);
});

sec('G · lease type stays with the Gross detector — never repeated here');
t('a Gross tenant with no other term is held exactly once, by the Gross finding', () => {
  const flags = detect([result('g', 'Gross Co', SHARED)], [tenant('g', 'Gross Co', { lease_type: 'Gross' })]);
  eq(provisionFlags(flags).length, 0, 'detector 3b raised a finding for lease type');
  const blocking = flags.filter(f => f.blocksBilling === true);
  eq(blocking.length, 1, `expected exactly one blocker, got: ${blocking.map(f => f.title).join(' | ')}`);
  ok(/Gross-lease tenant receiving shared CAM/.test(blocking[0].title));
});
t('a Modified Gross tenant with an expense stop is held for both, under two distinct titles', () => {
  const flags = detect([result('m', 'Mod Co', SHARED)], [tenant('m', 'Mod Co', { lease_type: 'Modified Gross', expense_stop: 3 })]);
  const blocking = flags.filter(f => f.blocksBilling === true);
  eq(blocking.length, 2);
  eq(new Set(blocking.map(f => f.title)).size, 2, 'two blockers share a title');
  const mine = provisionFlags(flags)[0];
  ok(!mine.conditions.some(c => /lease type/i.test(c)), 'the provision finding repeats the lease type');
});
t('an NNN tenant with no term raises no blocker of any kind', () => {
  const flags = detect([result('n', 'NNN Co', SHARED)], [tenant('n', 'NNN Co')]);
  eq(flags.filter(f => f.blocksBilling === true).length, 0);
});

sec('H · one finding per tenant, every term listed');
t('three terms → one finding, three labels in the title, three values in the conditions', () => {
  const { mine } = single({ expense_stop: 4.5, gross_up_pct: 95, pro_rata_method: 'occupied' });
  eq(mine.length, 1);
  const f = mine[0];
  ok(/^Lease provisions not applied — Whole Health Market: Expense stop, Gross-up, Pro-rata method$/.test(f.title), f.title);
  ['Expense stop: $4.50/sqft', 'Gross-up: 95%', 'Pro-rata method: occupied'].forEach(c => ok(f.conditions.includes(c), c));
  eq(f.provisions.map(p => p.key).join(','), 'expense_stop,gross_up_pct,pro_rata_method');
  ok(/these terms/.test(f.detail) && /each is confirmed/.test(f.detail), 'plural wording');
});
t('one term → singular wording', () => {
  const f = single({ expense_stop: 4.5 }).mine[0];
  ok(/^Lease provision not applied — /.test(f.title));
  ok(/this term/.test(f.detail) && /it is confirmed/.test(f.detail), f.detail);
});

sec('I · the clause is quoted when it is on file');
t('the latest evidence snapshot’s quote is shown', () => {
  const f = single({ expense_stop: 4.5, fieldEvidence: { expense_stop: { snapshots: [
    { quote: 'old clause', value: 4 }, { quote: 'Tenant shall pay Operating Expenses in excess of $4.50 per square foot.', value: 4.5 },
  ] } } }).mine[0];
  ok(f.conditions.includes('Expense stop — lease says: "Tenant shall pay Operating Expenses in excess of $4.50 per square foot."'), JSON.stringify(f.conditions));
  eq(f.provisions[0].quote, 'Tenant shall pay Operating Expenses in excess of $4.50 per square foot.');
});
t('the extraction’s own quotes map is the fallback', () => {
  const f = single({ pro_rata_method: 'gross', quotes: { pro_rata_method: 'Tenant’s share is based on gross leasable area.' } }).mine[0];
  ok(f.conditions.includes('Pro-rata method — lease says: "Tenant’s share is based on gross leasable area."'), JSON.stringify(f.conditions));
});
t('with nothing on file it says so, rather than inventing a citation', () => {
  const f = single({ gross_up_pct: 95 }).mine[0];
  ok(f.conditions.includes('Gross-up — no lease quote on file'), JSON.stringify(f.conditions));
  eq(f.provisions[0].quote, null);
});

sec('J · [source] the engine reads none of these fields; the allocation is untouched');
const scriptSrc = fs.readFileSync(path.join(__dirname, 'script.js'), 'utf8');
const engineSrc = fs.readFileSync(path.join(__dirname, 'reconciliation-engine.js'), 'utf8');
t('runFullReconciliation still computes the share from area, occupancy, exclusions and the cap — and nothing else', () => {
  const i = scriptSrc.indexOf('function runFullReconciliation(');
  const body = scriptSrc.slice(i, scriptSrc.indexOf('\n}\n', i));
  ok(/const proRata = lease\.sqFt \/ totalSqFt;/.test(body), 'the spatial share changed');
  ok(/_camCeilingCents\(lease\.capBaseAmount, lease\.capPercentage\)/.test(body), 'the cap ceiling changed');
  ['expense_stop', 'gross_up', 'baseYear', 'base_year', 'admin_fee', 'pro_rata_method'].forEach(k =>
    ok(!body.includes(k), `the engine now reads ${k} — this suite is about a gate, not a calculation`));
});
t('the Lease the engine allocates from carries no such term', () => {
  const i = scriptSrc.indexOf('class Lease {');
  const body = scriptSrc.slice(i, scriptSrc.indexOf('\n}\n', i));
  ['expense_stop', 'gross_up', 'admin_fee', 'pro_rata_method', 'expenseStop', 'grossUp', 'adminFee'].forEach(k =>
    ok(!body.includes(k), `Lease now carries ${k}`));
});
t('the detector writes to no allocation — the results come back byte-identical', () => {
  const results = [result('t1', 'Whole Health Market', SHARED)];
  const before = JSON.stringify(results);
  detect(results, [tenant('t1', 'Whole Health Market', { expense_stop: 4.5, gross_up_pct: 95 })]);
  eq(JSON.stringify(results), before);
});
t('the keys the detector reads are the keys the normaliser writes', () => {
  const norm = fs.readFileSync(path.join(__dirname, 'tenant-normalize.js'), 'utf8');
  ['expense_stop', 'gross_up_pct', 'baseYear', 'admin_fee_pct', 'admin_fee_basis', 'pro_rata_method'].forEach(k =>
    ok(new RegExp(`^\\s*${k}:`, 'm').test(norm), `${k} is not a key normalizeTenant writes`));
});
t('the finding is raised in the engine’s detector, before the Gross detector, and blocks by the shared flag', () => {
  const i = engineSrc.indexOf('3b. A lease provision the engine reads but does not apply');
  const j = engineSrc.indexOf('4. Gross / Modified Gross tenant receiving shared CAM');
  ok(i > 0 && j > i, 'detector 3b is not where the Gross detector expects to follow it');
  const mine = engineSrc.slice(i, j);
  eq((mine.match(/blocksBilling: true/g) || []).length, 1);
  ok(!/severity: 'red'/.test(mine));
  ok(!/lease_type/.test(mine), 'detector 3b reads lease_type — that is detector 4’s fact');
});

console.log('\n' + '─'.repeat(56));
if (fail) { console.log(`\x1b[31mRESULT: ${pass} passed, ${fail} failed\x1b[0m`); process.exit(1); }
console.log(`\x1b[32mRESULT: ${pass} passed, 0 failed\x1b[0m`);
