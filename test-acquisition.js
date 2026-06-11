'use strict';

// ─── Acquisition Engine Test Suite ───────────────────────────────────────────
// Tests: tenant matching, CAM reconciliation, underbilling, cap leakage,
//        operational vs structural gap, exclusion analysis, audit windows.
// Run: node test-acquisition.js

const path = require('path');
eval(require('fs').readFileSync(path.join(__dirname, 'acquisition-engine.js'), 'utf8'));

const AE = (typeof AcquisitionEngine !== 'undefined') ? AcquisitionEngine : module.exports;

let passed = 0;
let failed = 0;

function assert(label, condition, detail) {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.error(`  ❌ ${label}${detail ? ' — ' + detail : ''}`);
    failed++;
  }
}

function assertEq(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  assert(label, ok, `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

function assertApprox(label, actual, expected, tol) {
  const ok = Math.abs(actual - expected) <= (tol || 0.01);
  assert(label, ok, `got ${actual}, expected ~${expected} (±${tol || 0.01})`);
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TENANTS = [
  {
    id: 'aa000001-0000-4000-a000-000000000001',
    tenant_name: 'Acme Corp',
    unitNumber: '101',
    leased_sqft: 2000,
    cam_cap: 5,
    capBaseAmount: 10000,
    excluded_categories: 'capital,management fees',
    audit_rights: true,
    end_date: '2027-12-31',
    lease_type: 'NNN',
  },
  {
    id: 'bb000002-0000-4000-a000-000000000002',
    tenant_name: 'Globex LLC',
    unitNumber: '102',
    leased_sqft: 3000,
    cam_cap: 0,
    capBaseAmount: 0,
    excluded_categories: '',
    audit_rights: false,
    end_date: '2025-06-01',
    lease_type: 'Gross',
  },
  {
    id: 'cc000003-0000-4000-a000-000000000003',
    tenant_name: 'Initech',
    unitNumber: '103',
    leased_sqft: 5000,
    cam_cap: 10,
    capBaseAmount: 25000,
    excluded_categories: 'management fees,structural,roof',
    audit_rights: true,
    end_date: '2029-03-15',
    lease_type: 'NNN',
  },
];

const TOTAL_SQFT = 10000;

const INVOICES = [
  { vendorName: 'ABC Landscaping',  category: 'landscaping', invoiceDate: '2024-03-01', amount: 1200 },
  { vendorName: 'XYZ Cleaning',     category: 'cleaning',    invoiceDate: '2024-03-01', amount: 800  },
  { vendorName: 'Capital Repairs',  category: 'capital',     invoiceDate: '2024-03-01', amount: 5000 },
  { vendorName: 'Mgmt Fee',         category: 'management fees', invoiceDate: '2024-03-01', amount: 2000 },
  { vendorName: 'Unit 101 HVAC',    category: 'maintenance', invoiceDate: '2024-03-01', amount: 500  },
  { vendorName: 'Insurance Co',     category: 'insurance',   invoiceDate: '2024-03-01', amount: 3000 },
];

// ── Group 1: Tenant Matching ──────────────────────────────────────────────────

console.log('\n── Group 1: Tenant Matching ─────────────────────────────────────');

{
  const inv = { vendorName: 'Unit 101 HVAC repair', category: 'maintenance', invoiceDate: '2024-01-15' };
  const m = AE.matchInvoiceToTenant(inv, TENANTS);
  assert('unit number hit → confidence 90', m && m.confidence === 90);
  assertEq('unit number hit → tenant name', m && m.tenantName, 'Acme Corp');
}

{
  const inv = { vendorName: 'Globex LLC parking', category: 'parking', invoiceDate: '2024-01-15' };
  const m = AE.matchInvoiceToTenant(inv, TENANTS);
  assert('tenant name hit → confidence 75', m && m.confidence === 75);
  assertEq('tenant name hit → correct tenant', m && m.tenantName, 'Globex LLC');
}

{
  const inv = { vendorName: 'ABC Landscaping', category: 'landscaping', invoiceDate: '2024-01-15' };
  const m = AE.matchInvoiceToTenant(inv, TENANTS);
  assert('no unit/name match → null', m === null);
}

{
  // Unit number takes priority over name match
  const t = [
    { id: 'x1', tenant_name: 'Alpha Inc',  unitNumber: '200', leased_sqft: 1000 },
    { id: 'x2', tenant_name: 'Beta Corp',  unitNumber: '',    leased_sqft: 1000 },
  ];
  const inv = { vendorName: 'Unit 200 Alpha Inc invoice', category: 'maintenance', invoiceDate: '' };
  const m = AE.matchInvoiceToTenant(inv, t);
  assert('unit match beats name match', m && m.confidence === 90 && m.tenantName === 'Alpha Inc');
}

{
  const quality = AE.tenantMatchingAnalysis(TENANTS, INVOICES);
  assert('matchingAnalysis returns matched count', typeof quality.matched === 'number');
  assert('matchingAnalysis returns matchRate 0-100', quality.matchRate >= 0 && quality.matchRate <= 100);
  // One invoice has "Unit 101" → direct match; rest are shared
  assert('unit 101 invoice is directly matched', quality.matched >= 1);
}

// ── Group 2: CAM Reconciliation ───────────────────────────────────────────────

console.log('\n── Group 2: CAM Reconciliation ──────────────────────────────────');

{
  const results = AE.runAcquisitionReconciliation(TENANTS, INVOICES, TOTAL_SQFT);
  assert('returns one result per tenant', results.length === TENANTS.length);
  assert('all allocated amounts are numbers', results.every(r => typeof r.allocatedAmount === 'number'));
  assert('all proRataPct sum to ~100', Math.abs(results.reduce((s, r) => s + r.proRataPct, 0) - 100) < 0.1);
}

{
  const results = AE.runAcquisitionReconciliation(TENANTS, INVOICES, TOTAL_SQFT);
  // Acme Corp (unit 101) has direct invoice for $500; capital + mgmt fees excluded
  const acme = results.find(r => r.tenantName === 'Acme Corp');
  assert('Acme own invoice included', acme && acme.ownTotal > 0);
  assert('Acme excluded categories populated', acme && acme.excludedCategories.includes('capital'));
}

{
  // Cap enforcement: Acme cap = 5% of $10000 base = $10500 max
  // If raw total < cap, no leakage
  const results = AE.runAcquisitionReconciliation(TENANTS, INVOICES, TOTAL_SQFT);
  const acme = results.find(r => r.tenantName === 'Acme Corp');
  // With the invoice pool given (~$12500 total, Acme 20% share = $2500 + own $500)
  // Cap = $10000 * 1.05 = $10500 — raw should be well under
  assert('Acme below cap — no leakage', acme && !acme.capApplied);
}

{
  // Force cap breach: large invoice pool
  const bigInvoices = [{ vendorName: 'Shared Utility', category: 'utilities', invoiceDate: '2024-01-01', amount: 100000 }];
  const results = AE.runAcquisitionReconciliation(TENANTS, bigInvoices, TOTAL_SQFT);
  // Acme: proRata 20% of $100000 = $20000; cap = $10000*1.05 = $10500 → breach
  const acme = results.find(r => r.tenantName === 'Acme Corp');
  assert('Acme cap breach detected when pool is large', acme && acme.capApplied);
  assertApprox('Acme cap leakage is correct', acme && acme.capLeakage, 9500, 1);
  assertApprox('Acme allocated = cap limit', acme && acme.allocatedAmount, 10500, 1);
}

{
  // Empty inputs
  const r1 = AE.runAcquisitionReconciliation([], INVOICES, TOTAL_SQFT);
  assertEq('empty tenants → empty results', r1, []);
  const r2 = AE.runAcquisitionReconciliation(TENANTS, [], TOTAL_SQFT);
  assertEq('empty invoices → empty results', r2, []);
}

// ── Group 3: Underbilling Analysis ────────────────────────────────────────────

console.log('\n── Group 3: Underbilling Analysis ───────────────────────────────');

{
  const bigInvoices = [{ vendorName: 'Shared Pool', category: 'utilities', invoiceDate: '2024-01-01', amount: 100000 }];
  const recon = AE.runAcquisitionReconciliation(TENANTS, bigInvoices, TOTAL_SQFT);
  const ub    = AE.underbillingAnalysis(recon);
  assert('one underbilling row per tenant', ub.length === TENANTS.length);
  assert('all gap values are non-negative', ub.every(r => r.gap >= 0));
  const acme = ub.find(r => r.tenantName === 'Acme Corp');
  assert('Acme gap cause is cap (large pool)', acme && acme.cause === 'cap');
}

{
  // Tenant with exclusions but no cap — cause should be 'exclusions'
  const invoiceWithExcluded = [
    { vendorName: 'Capital Works',  category: 'capital',   invoiceDate: '2024-01-01', amount: 5000 },
    { vendorName: 'Cleaning',       category: 'cleaning',  invoiceDate: '2024-01-01', amount: 1000 },
  ];
  const tenantWithExclusion = [{
    id: 'zz01', tenant_name: 'ExclusionTenant', unitNumber: '999',
    leased_sqft: 5000, cam_cap: 0, capBaseAmount: 0,
    excluded_categories: 'capital', audit_rights: false, end_date: null, lease_type: 'NNN',
  }];
  const recon = AE.runAcquisitionReconciliation(tenantWithExclusion, invoiceWithExcluded, 5000);
  const ub    = AE.underbillingAnalysis(recon);
  assert('exclusion cause detected', ub[0] && ub[0].cause === 'exclusions');
  assert('gap equals excluded invoice amount * proRata', ub[0].gap > 0);
}

{
  // No gap — all allocated correctly
  const noGapTenants = [{
    id: 'zz02', tenant_name: 'Full Pay', unitNumber: '',
    leased_sqft: 5000, cam_cap: 0, capBaseAmount: 0,
    excluded_categories: '', audit_rights: false, end_date: null, lease_type: 'NNN',
  }];
  const recon = AE.runAcquisitionReconciliation(noGapTenants,
    [{ vendorName: 'Shared', category: 'utilities', invoiceDate: '2024-01-01', amount: 1000 }],
    5000
  );
  const ub = AE.underbillingAnalysis(recon);
  assert('no gap when proRata matches full pool', ub[0].gap === 0 && ub[0].cause === 'none');
}

// ── Group 4: Cap Leakage Analysis ─────────────────────────────────────────────

console.log('\n── Group 4: Cap Leakage Analysis ────────────────────────────────');

{
  const bigInvoices = [{ vendorName: 'Shared', category: 'utilities', invoiceDate: '2024-01-01', amount: 200000 }];
  const recon  = AE.runAcquisitionReconciliation(TENANTS, bigInvoices, TOTAL_SQFT);
  const caps   = AE.capLeakageAnalysis(recon);
  assert('total leakage > 0 when caps breach', caps.totalLeakage > 0);
  assert('annualized = monthly * 12', Math.abs(caps.annualizedTotal - caps.totalLeakage * 12) < 0.01);
  assert('affected tenants list non-empty', caps.affectedTenants.length > 0);
  assert('each affected tenant has annualizedLeakage', caps.affectedTenants.every(t => typeof t.annualizedLeakage === 'number'));
}

{
  const smallInvoices = [{ vendorName: 'Tiny', category: 'cleaning', invoiceDate: '2024-01-01', amount: 100 }];
  const recon = AE.runAcquisitionReconciliation(TENANTS, smallInvoices, TOTAL_SQFT);
  const caps  = AE.capLeakageAnalysis(recon);
  assert('zero leakage when all under cap', caps.totalLeakage === 0);
  assertEq('no affected tenants when no breach', caps.affectedTenants, []);
}

// ── Group 5: Operational vs Structural Gap ────────────────────────────────────

console.log('\n── Group 5: Operational vs Structural Gap ───────────────────────');

{
  const bigInvoices = [{ vendorName: 'Shared', category: 'utilities', invoiceDate: '2024-01-01', amount: 200000 }];
  const recon  = AE.runAcquisitionReconciliation(TENANTS, bigInvoices, TOTAL_SQFT);
  const ub     = AE.underbillingAnalysis(recon);
  const gap    = AE.operationalVsStructuralGap(ub);
  assert('structural + operational = total', Math.abs(gap.structural + gap.operational - gap.total) < 0.01);
  assert('annualized structural = monthly * 12', Math.abs(gap.annualizedStructural - gap.structural * 12) < 0.01);
  assert('large pool → structural > 0 (caps)', gap.structural > 0);
}

{
  const ub  = [{ gap: 100, cause: 'cap', capApplied: true }];
  const gap = AE.operationalVsStructuralGap(ub);
  assertEq('cap cause → structural only', gap, {
    structural: 100, operational: 0, total: 100,
    annualizedStructural: 1200, annualizedOperational: 0,
  });
}

{
  const ub  = [{ gap: 50, cause: 'partial_match', capApplied: false }];
  const gap = AE.operationalVsStructuralGap(ub);
  assertEq('partial_match cause → operational only', gap, {
    structural: 0, operational: 50, total: 50,
    annualizedStructural: 0, annualizedOperational: 600,
  });
}

{
  const ub  = [];
  const gap = AE.operationalVsStructuralGap(ub);
  assertEq('empty underbilling → all zeroes', gap, {
    structural: 0, operational: 0, total: 0,
    annualizedStructural: 0, annualizedOperational: 0,
  });
}

// ── Group 6: Exclusion Analysis ───────────────────────────────────────────────

console.log('\n── Group 6: Exclusion Analysis ──────────────────────────────────');

{
  const excl = AE.exclusionAnalysis(TENANTS, INVOICES);
  assert('only tenants with exclusions returned', excl.length > 0);
  const acme = excl.find(r => r.tenantName === 'Acme Corp');
  assert('Acme has unusual exclusion (management fees)', acme && acme.hasUnusualExclusions);
  assert('excluded invoice total is non-negative', excl.every(r => r.excludedInvoiceTotal >= 0));
}

{
  const t = [{ id: 'x', tenant_name: 'No Excl', leased_sqft: 1000, excluded_categories: '' }];
  const excl = AE.exclusionAnalysis(t, INVOICES);
  assertEq('tenant with no exclusions filtered out', excl, []);
}

// ── Group 7: Audit Window Analysis ────────────────────────────────────────────

console.log('\n── Group 7: Audit Window Analysis ───────────────────────────────');

{
  const windows = AE.auditWindowAnalysis(TENANTS);
  assert('one row per tenant', windows.length === TENANTS.length);
  assert('all have windowStatus field', windows.every(w => typeof w.windowStatus === 'string'));
  const acme = windows.find(w => w.tenantName === 'Acme Corp');
  assert('Acme has audit rights → not "none"', acme && acme.windowStatus !== 'none');
  const globex = windows.find(w => w.tenantName === 'Globex LLC');
  assert('Globex no audit rights → "none"', globex && globex.windowStatus === 'none');
  // Globex end_date = 2025-06-01, which is in the past from current date (2026-06-11)
  // But windowStatus is 'none' because hasAuditRights is false — confirm this
  assert('Globex no-rights overrides expiry check', globex.windowStatus === 'none');
}

{
  const expired = [{ id: 'x', tenant_name: 'Expired', leased_sqft: 1000,
    audit_rights: true, end_date: '2020-01-01' }];
  const w = AE.auditWindowAnalysis(expired);
  assertEq('past end date with rights → expired', w[0].windowStatus, 'expired');
}

{
  const noDate = [{ id: 'x', tenant_name: 'NoDate', leased_sqft: 1000,
    audit_rights: true, end_date: null }];
  const w = AE.auditWindowAnalysis(noDate);
  assertEq('no end date with rights → unknown', w[0].windowStatus, 'unknown');
}

// ── Group 8: Full Report ──────────────────────────────────────────────────────

console.log('\n── Group 8: Full Report (buildAcquisitionReport) ────────────────');

{
  const report = AE.buildAcquisitionReport(TENANTS, INVOICES, TOTAL_SQFT);
  assert('report has summary', report.summary && typeof report.summary === 'object');
  assert('report has reconciliation array', Array.isArray(report.reconciliation));
  assert('report has underbilling array', Array.isArray(report.underbilling));
  assert('report has capLeakage', report.capLeakage && typeof report.capLeakage === 'object');
  assert('report has exclusions array', Array.isArray(report.exclusions));
  assert('report has auditWindows array', Array.isArray(report.auditWindows));
  assert('report has gap object', report.gap && typeof report.gap === 'object');
  assert('report has topRisks array', Array.isArray(report.topRisks));
  assert('report has generatedAt', typeof report.generatedAt === 'string');
  assert('summary.tenantCount matches input', report.summary.tenantCount === TENANTS.length);
  assert('summary.recoveryRate 0-100', report.summary.recoveryRate >= 0 && report.summary.recoveryRate <= 100);
}

{
  const report = AE.buildAcquisitionReport([], INVOICES, TOTAL_SQFT);
  assert('empty tenants → error property', report.error && typeof report.error === 'string');
}

{
  const report = AE.buildAcquisitionReport(TENANTS, [], TOTAL_SQFT);
  assert('empty invoices → error property', report.error && typeof report.error === 'string');
}

{
  const bigInvoices = [{ vendorName: 'Big Pool', category: 'utilities', invoiceDate: '2024-01-01', amount: 200000 }];
  const report = AE.buildAcquisitionReport(TENANTS, bigInvoices, TOTAL_SQFT);
  assert('cap leakage appears in topRisks when caps breach', report.topRisks.some(r => r.type === 'cap_leakage'));
  assert('topRisks sorted by annualImpact descending',
    report.topRisks.filter(r => r.annualImpact !== null).every((r, i, arr) =>
      i === 0 || (arr[i - 1].annualImpact || 0) >= (r.annualImpact || 0)
    )
  );
}

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(60)}`);
const total = passed + failed;
console.log(`Results: ${passed}/${total} passed${failed > 0 ? `, ${failed} FAILED` : ''}`);
if (failed > 0) { console.error('\n❌ Test suite FAILED'); process.exit(1); }
else             { console.log('\n✅ All acquisition engine tests pass'); }
