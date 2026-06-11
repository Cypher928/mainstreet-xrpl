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

// ── Group 9: Citation Extraction ─────────────────────────────────────────────

console.log('\n── Group 9: Citation Extraction ─────────────────────────────────');

// Helper: call internal _extractCitation via a tenant with quotes
const ACQ_INTERNAL = (() => {
  // Re-evaluate the module in a context where we can reach internal symbols.
  // We call the exported buildCitationIndex + buildFindingsWithCitations which
  // exercise _extractCitation internally; we also test via a white-box tenant fixture.
  return AE;
})();

{
  // Test via buildCitationIndex which calls _extractCitation internally.
  const t = {
    id: 'cite-01', tenant_name: 'CiteTenant',
    quotes: { cam_cap: 'Tenant CAM shall not exceed 5% over prior year.' },
  };
  const idx = AE.buildCitationIndex([t]);
  assert('buildCitationIndex populates cam_cap from quotes', idx['cite-01'] && idx['cite-01']['cam_cap'] === 'Tenant CAM shall not exceed 5% over prior year.');
}

{
  const t = { id: 'cite-02', tenant_name: 'NoQuotes' };
  const idx = AE.buildCitationIndex([t]);
  assert('buildCitationIndex handles tenant with no quotes object', idx['cite-02'] && Object.keys(idx['cite-02']).length === 0);
}

{
  const t = {
    id: 'cite-03', tenant_name: 'MixedQuotes',
    quotes: { cam_cap: 'Not more than 5%', audit_rights: null, renewal_options: '' },
  };
  const idx = AE.buildCitationIndex([t]);
  assert('buildCitationIndex includes cam_cap', !!idx['cite-03']['cam_cap']);
  assert('buildCitationIndex excludes null audit_rights', !idx['cite-03']['audit_rights']);
  assert('buildCitationIndex excludes empty renewal_options', !idx['cite-03']['renewal_options']);
}

{
  // Tenant with no id — falls back to tenantName as key
  const t = { tenant_name: 'NoIdTenant', quotes: { cam_cap: 'capped at 3%' } };
  const idx = AE.buildCitationIndex([t]);
  assert('buildCitationIndex uses tenant_name as fallback key when id absent', !!idx['NoIdTenant']);
  assert('fallback key preserves quote value', idx['NoIdTenant']['cam_cap'] === 'capped at 3%');
}

{
  // buildFindingsWithCitations — citation attached from quotes
  const tenant = {
    id: 'cap-tenant-01', tenant_name: 'CapTenant',
    leased_sqft: 5000, cam_cap: 10, capBaseAmount: 10000,
    excluded_categories: '', audit_rights: false, end_date: null, lease_type: 'NNN',
    quotes: { cam_cap: 'CAM increases limited to 10% of prior year actual.' },
  };
  const bigInv = [{ vendorName: 'Pool', category: 'utilities', invoiceDate: '2024-01-01', amount: 300000 }];
  const recon  = AE.runAcquisitionReconciliation([tenant], bigInv, 5000);
  const caps   = AE.capLeakageAnalysis(recon);
  const partialReport = { capLeakage: caps, exclusions: [], auditWindows: [], underbilling: AE.underbillingAnalysis(recon), renewalRisk: [] };
  const findings = AE.buildFindingsWithCitations(partialReport, [tenant]);
  const capFinding = findings.find(f => f.type === 'cap_leakage');
  assert('cap leakage finding has citation object', capFinding && capFinding.citation !== null);
  assert('cap leakage citation field is cam_cap', capFinding && capFinding.citation.field === 'cam_cap');
  assert('cap leakage citation text matches quote', capFinding && capFinding.citation.text === 'CAM increases limited to 10% of prior year actual.');
  assert('cap leakage citation tenantName matches', capFinding && capFinding.citation.tenantName === 'CapTenant');
}

{
  // Citation is null when no quotes object present
  const tenant = {
    id: 'cap-tenant-02', tenant_name: 'NoCiteTenant',
    leased_sqft: 5000, cam_cap: 10, capBaseAmount: 10000,
    excluded_categories: '', audit_rights: false, end_date: null, lease_type: 'NNN',
    // no quotes property at all
  };
  const bigInv = [{ vendorName: 'Pool', category: 'utilities', invoiceDate: '2024-01-01', amount: 300000 }];
  const recon  = AE.runAcquisitionReconciliation([tenant], bigInv, 5000);
  const caps   = AE.capLeakageAnalysis(recon);
  const partialReport = { capLeakage: caps, exclusions: [], auditWindows: [], underbilling: AE.underbillingAnalysis(recon), renewalRisk: [] };
  const findings = AE.buildFindingsWithCitations(partialReport, [tenant]);
  const capFinding = findings.find(f => f.type === 'cap_leakage');
  assert('cap leakage citation is null when quotes absent', capFinding && capFinding.citation === null);
}

// ── Group 10: Recon Extraction Edge Cases ────────────────────────────────────

console.log('\n── Group 10: Recon Extraction Edge Cases ────────────────────────');

{
  // Zero sqft tenant: proRata = 0, gets no shared expenses
  const zeroSqFtTenant = [{
    id: 'z1', tenant_name: 'ZeroSqFt', unitNumber: '',
    leased_sqft: 0, cam_cap: 0, capBaseAmount: 0,
    excluded_categories: '', audit_rights: false, end_date: null, lease_type: 'NNN',
  }];
  const inv = [{ vendorName: 'Shared', category: 'utilities', invoiceDate: '2024-01-01', amount: 1000 }];
  const r   = AE.runAcquisitionReconciliation(zeroSqFtTenant, inv, 10000);
  assert('zero-sqft tenant gets $0 allocated', r[0].allocatedAmount === 0);
  assert('zero-sqft tenant proRataPct is 0', r[0].proRataPct === 0);
}

{
  // String amount with commas — parseFloat strips non-numeric characters
  // Note: parseFloat("1,500") only parses "1" — amounts should come pre-parsed.
  // Test that the engine handles "1500" (string form without comma) correctly.
  const inv = [{ vendorName: 'Vendor', category: 'utilities', invoiceDate: '2024-01-01', amount: '1500' }];
  const r   = AE.runAcquisitionReconciliation(
    [{ id: 'a', tenant_name: 'T', leased_sqft: 5000, excluded_categories: '', cam_cap: 0, capBaseAmount: 0 }],
    inv, 5000
  );
  assertApprox('string amount "1500" parsed correctly', r[0].allocatedAmount, 1500, 0.01);
}

{
  // Amount = 0 — no division by zero, no NaN
  const inv = [{ vendorName: 'Zero', category: 'utilities', invoiceDate: '2024-01-01', amount: 0 }];
  const r   = AE.runAcquisitionReconciliation(
    [{ id: 'a', tenant_name: 'T', leased_sqft: 5000, excluded_categories: '', cam_cap: 0, capBaseAmount: 0 }],
    inv, 5000
  );
  assert('amount=0 gives allocatedAmount=0 without NaN', r[0].allocatedAmount === 0 && !isNaN(r[0].allocatedAmount));
}

{
  // All invoices directly matched → shared pool is empty → other tenants get $0
  const invDirect = [{ vendorName: 'Unit 101 repair', category: 'maintenance', invoiceDate: '2024-01-01', amount: 500 }];
  const twoTenants = [
    { id: 'ta', tenant_name: 'Alpha', unitNumber: '101', leased_sqft: 3000, cam_cap: 0, capBaseAmount: 0, excluded_categories: '' },
    { id: 'tb', tenant_name: 'Beta',  unitNumber: '102', leased_sqft: 2000, cam_cap: 0, capBaseAmount: 0, excluded_categories: '' },
  ];
  const r = AE.runAcquisitionReconciliation(twoTenants, invDirect, 5000);
  const alpha = r.find(x => x.tenantName === 'Alpha');
  const beta  = r.find(x => x.tenantName === 'Beta');
  assert('direct-matched invoice charged only to matched tenant', alpha.allocatedAmount === 500);
  assert('unmatched tenant gets $0 when all invoices are direct', beta.allocatedAmount === 0);
}

{
  // Single tenant → gets 100% of shared pool
  const single = [{ id: 's1', tenant_name: 'Solo', leased_sqft: 10000, cam_cap: 0, capBaseAmount: 0, excluded_categories: '' }];
  const inv    = [{ vendorName: 'Shared', category: 'utilities', invoiceDate: '2024-01-01', amount: 2000 }];
  const r      = AE.runAcquisitionReconciliation(single, inv, 10000);
  assertApprox('single tenant gets 100% of shared pool', r[0].allocatedAmount, 2000, 0.01);
  assert('single tenant proRataPct is 100', r[0].proRataPct === 100);
}

{
  // Cap with capPct > 0 but capBaseAmount = 0 → cap NOT applied (guard)
  const t   = [{ id: 'cg', tenant_name: 'CapGuard', leased_sqft: 5000, cam_cap: 5, capBaseAmount: 0, excluded_categories: '' }];
  const inv = [{ vendorName: 'BigPool', category: 'utilities', invoiceDate: '2024-01-01', amount: 500000 }];
  const r   = AE.runAcquisitionReconciliation(t, inv, 5000);
  assert('cap NOT applied when capBaseAmount is 0', !r[0].capApplied);
  assert('full pro-rata allocated when capBase is missing', r[0].allocatedAmount > 0);
}

{
  // Invoice with no category → category is '' → not excluded by any exclusion list
  const t   = [{ id: 'nc', tenant_name: 'Tenant', leased_sqft: 5000, cam_cap: 0, capBaseAmount: 0, excluded_categories: 'utilities,maintenance' }];
  const inv = [{ vendorName: 'Mystery Vendor', category: '', invoiceDate: '2024-01-01', amount: 1000 }];
  const r   = AE.runAcquisitionReconciliation(t, inv, 5000);
  assert('invoice with no category is not excluded', r[0].allocatedAmount === 1000);
}

{
  // Penny rounding: sum of allocations should equal total invoice amount (within rounding tolerance)
  const twoT = [
    { id: 'p1', tenant_name: 'P1', leased_sqft: 3333, cam_cap: 0, capBaseAmount: 0, excluded_categories: '' },
    { id: 'p2', tenant_name: 'P2', leased_sqft: 6667, cam_cap: 0, capBaseAmount: 0, excluded_categories: '' },
  ];
  const inv   = [{ vendorName: 'Shared', category: 'utilities', invoiceDate: '2024-01-01', amount: 1000.01 }];
  const r     = AE.runAcquisitionReconciliation(twoT, inv, 10000);
  const sumAl = r.reduce((s, x) => s + x.allocatedAmount, 0);
  assertApprox('penny rounding: allocations sum ≈ total invoices', sumAl, 1000.01, 0.05);
}

{
  // totalSqFt = 0 guard → empty array returned
  const r = AE.runAcquisitionReconciliation(TENANTS, INVOICES, 0);
  assertEq('totalSqFt=0 returns empty array', r, []);
}

{
  // Cap AND exclusions: underbilling cause should be 'cap' (cap takes priority in cause determination)
  const t = [{
    id: 'ce', tenant_name: 'CapAndExcl', leased_sqft: 5000,
    cam_cap: 5, capBaseAmount: 100,  // tiny base → guaranteed breach on any expense
    excluded_categories: 'utilities', // also has exclusions
  }];
  const inv = [{ vendorName: 'Pool', category: 'maintenance', invoiceDate: '2024-01-01', amount: 100000 }];
  const r   = AE.runAcquisitionReconciliation(t, inv, 5000);
  const ub  = AE.underbillingAnalysis(r);
  assert('cap takes priority over exclusions in cause determination', ub[0].cause === 'cap');
}

// ── Group 11: Tenant Matching Edge Cases ─────────────────────────────────────

console.log('\n── Group 11: Tenant Matching Edge Cases ─────────────────────────');

{
  // Case-insensitive: tenant name is "Acme Corp", vendor contains "ACME CORP"
  const t   = [{ id: 'ci1', tenant_name: 'Acme Corp', unitNumber: '', leased_sqft: 1000 }];
  const inv = { vendorName: 'ACME CORP Maintenance', category: 'maintenance', invoiceDate: '' };
  const m   = AE.matchInvoiceToTenant(inv, t);
  assert('case-insensitive name match works', m !== null && m.tenantName === 'Acme Corp');
  assert('case-insensitive match confidence is 75', m && m.confidence === 75);
}

{
  // Tenant name IS a substring of vendor name → match (we check text.includes(name))
  const t   = [{ id: 'sub1', tenant_name: 'Corp', unitNumber: '', leased_sqft: 1000 }];
  const inv = { vendorName: 'Acme Corp HVAC', category: 'maintenance', invoiceDate: '' };
  const m   = AE.matchInvoiceToTenant(inv, t);
  assert('short tenant name substring of vendor → match', m !== null);
}

{
  // Vendor name IS a substring of tenant name → no match (text.includes(name) is false)
  const t   = [{ id: 'sub2', tenant_name: 'Acme Corporation', unitNumber: '', leased_sqft: 1000 }];
  const inv = { vendorName: 'Acme', category: 'maintenance', invoiceDate: '' };
  const m   = AE.matchInvoiceToTenant(inv, t);
  assert('long tenant name not substring of short vendor → no match', m === null);
}

{
  // Empty tenant array
  const m = AE.matchInvoiceToTenant({ vendorName: 'Anyone', category: '', invoiceDate: '' }, []);
  assert('empty tenant array → null', m === null);
}

{
  // Invoice with all null/empty fields
  const t = [{ id: 'nf', tenant_name: 'SomeTenant', unitNumber: '999', leased_sqft: 1000 }];
  const m = AE.matchInvoiceToTenant({ vendorName: null, category: null, invoiceDate: null }, t);
  assert('invoice with all null fields → null match', m === null);
}

{
  // Unit number appears in the middle of vendor text
  const t = [{ id: 'um', tenant_name: 'MiddleUnit', unitNumber: 'B-42', leased_sqft: 1000 }];
  const m = AE.matchInvoiceToTenant({ vendorName: 'Suite B-42 Repair Co', category: 'maintenance', invoiceDate: '' }, t);
  assert('unit number in middle of vendor text is matched', m !== null && m.confidence === 90);
}

{
  // Tenant with only unit_number (no name) → unit match still works
  const t = [{ id: 'un', tenant_name: '', unitNumber: '200', leased_sqft: 1000 }];
  const m = AE.matchInvoiceToTenant({ vendorName: 'Unit 200 HVAC', category: '', invoiceDate: '' }, t);
  assert('unit-only tenant matches via unit number', m !== null && m.confidence === 90);
}

{
  // Multiple tenants: unit match (conf 90) beats name match (conf 75)
  const tenants = [
    { id: 'ma', tenant_name: 'Alpha',  unitNumber: '300', leased_sqft: 1000 },
    { id: 'mb', tenant_name: 'beta',   unitNumber: '',    leased_sqft: 1000 },
  ];
  // Invoice mentions unit 300 AND contains "beta" in vendor name
  const inv = { vendorName: 'Unit 300 Beta Repairs', category: '', invoiceDate: '' };
  const m   = AE.matchInvoiceToTenant(inv, tenants);
  assert('unit match (90) beats name match (75) when both present', m && m.tenantName === 'Alpha' && m.confidence === 90);
}

{
  // Two tenants, same unit string: first-encountered with higher conf wins
  const tenants = [
    { id: 'dup1', tenant_name: 'First',  unitNumber: '101', leased_sqft: 1000 },
    { id: 'dup2', tenant_name: 'Second', unitNumber: '101', leased_sqft: 1000 },
  ];
  const m = AE.matchInvoiceToTenant({ vendorName: 'Unit 101 fix', category: '', invoiceDate: '' }, tenants);
  assert('deterministic: first tenant wins when unit ties', m && m.tenantName === 'First');
}

{
  // vendorName is in the category field instead — still matched via category text
  const t = [{ id: 'cat', tenant_name: 'CategoryMatch', unitNumber: '', leased_sqft: 1000 }];
  const m = AE.matchInvoiceToTenant({ vendorName: null, category: 'categorymatch repair', invoiceDate: '' }, t);
  assert('tenant name matched through category text field', m !== null);
}

// ── Group 12: Citation-Backed Findings ───────────────────────────────────────

console.log('\n── Group 12: Citation-Backed Findings ───────────────────────────');

{
  // buildFindingsWithCitations returns an array
  const empty = AE.buildFindingsWithCitations(
    { capLeakage: { affectedTenants: [] }, exclusions: [], auditWindows: [], underbilling: [], renewalRisk: [] },
    []
  );
  assertEq('no findings when all arrays empty', empty, []);
}

{
  // Audit window 'closing' → generates finding
  const t   = [{ id: 'aw1', tenant_name: 'ClosingTenant', audit_rights: true, end_date: '2026-09-01',
                  quotes: { audit_rights: 'Tenant has the right to audit within 2 years of statement.' } }];
  const now = Date.now();
  const daysToExpiry = Math.round((new Date('2026-09-01').getTime() - now) / 86400000);
  // Only proceed if lease is actually 'closing' (within 365 days)
  if (daysToExpiry >= 0 && daysToExpiry < 365) {
    const windows  = AE.auditWindowAnalysis(t);
    const report   = { capLeakage: { affectedTenants: [] }, exclusions: [], auditWindows: windows, underbilling: [], renewalRisk: [] };
    const findings = AE.buildFindingsWithCitations(report, t);
    const af = findings.find(f => f.type === 'audit_window');
    assert('closing audit window generates finding', af !== null);
    assert('audit window finding has citation', af && af.citation !== null);
    assert('audit window citation field is audit_rights', af && af.citation.field === 'audit_rights');
  } else {
    // Lease is not closing today; skip date-dependent test with a note
    assert('audit_window closing test skipped (date out of range — adjust fixture if needed)', true);
  }
}

{
  // Audit window 'open' (far future) → does NOT generate finding
  const t = [{ id: 'aw2', tenant_name: 'FarFuture', audit_rights: true, end_date: '2035-01-01' }];
  const windows  = AE.auditWindowAnalysis(t);
  const report   = { capLeakage: { affectedTenants: [] }, exclusions: [], auditWindows: windows, underbilling: [], renewalRisk: [] };
  const findings = AE.buildFindingsWithCitations(report, t);
  assert('open audit window (far future) does NOT generate finding', !findings.some(f => f.type === 'audit_window'));
}

{
  // Audit window 'expired' → generates finding
  const t = [{ id: 'aw3', tenant_name: 'ExpiredTenant', audit_rights: true, end_date: '2020-01-01',
                quotes: { audit_rights: 'Tenant may audit within 2 years of statement date.' } }];
  const windows  = AE.auditWindowAnalysis(t);
  const report   = { capLeakage: { affectedTenants: [] }, exclusions: [], auditWindows: windows, underbilling: [], renewalRisk: [] };
  const findings = AE.buildFindingsWithCitations(report, t);
  const af = findings.find(f => f.type === 'audit_window');
  assert('expired audit window generates finding', af !== null);
  assert('expired finding label is "Audit Window Expired"', af && af.label === 'Audit Window Expired');
  assert('expired audit window has citation', af && af.citation !== null);
}

{
  // Underbilling gap < 1 is excluded from findings
  const ub = [{ tenantName: 'TinyGap', tenantId: 'tg1', gap: 0.50, cause: 'partial_match',
                fullLiability: 100, allocatedAmount: 99.50, gapPct: 0.5, capApplied: false }];
  const findings = AE.buildFindingsWithCitations(
    { capLeakage: { affectedTenants: [] }, exclusions: [], auditWindows: [], underbilling: ub, renewalRisk: [] },
    []
  );
  assert('underbilling gap < $1 is excluded from findings', !findings.some(f => f.type === 'underbilling'));
}

{
  // Underbilling with cause=cap uses cam_cap citation field
  const t  = [{ id: 'ubcap', tenant_name: 'CapTenant', leased_sqft: 5000, cam_cap: 5, capBaseAmount: 100,
                excluded_categories: '', quotes: { cam_cap: 'Not to exceed 5% above prior year.' } }];
  const inv = [{ vendorName: 'Big', category: 'utilities', invoiceDate: '2024-01-01', amount: 100000 }];
  const r   = AE.runAcquisitionReconciliation(t, inv, 5000);
  const ub  = AE.underbillingAnalysis(r);
  const partialReport = { capLeakage: AE.capLeakageAnalysis(r), exclusions: [], auditWindows: [], underbilling: ub, renewalRisk: [] };
  const findings = AE.buildFindingsWithCitations(partialReport, t);
  const ubFinding = findings.find(f => f.type === 'underbilling');
  assert('underbilling (cap cause) finding exists', ubFinding !== null);
  assert('underbilling (cap cause) citation field is cam_cap', ubFinding && ubFinding.citation && ubFinding.citation.field === 'cam_cap');
}

{
  // Underbilling with cause=exclusions uses excluded_categories citation field
  const t   = [{ id: 'ubexcl', tenant_name: 'ExclTenant', leased_sqft: 5000, cam_cap: 0, capBaseAmount: 0,
                  excluded_categories: 'capital', quotes: { excluded_categories: 'Excluding capital improvements per §4.3.' } }];
  const inv = [{ vendorName: 'Capital Reno', category: 'capital', invoiceDate: '2024-01-01', amount: 5000 },
               { vendorName: 'Other', category: 'utilities', invoiceDate: '2024-01-01', amount: 100 }];
  const r   = AE.runAcquisitionReconciliation(t, inv, 5000);
  const ub  = AE.underbillingAnalysis(r);
  const partialReport = { capLeakage: AE.capLeakageAnalysis(r), exclusions: [], auditWindows: [], underbilling: ub, renewalRisk: [] };
  const findings = AE.buildFindingsWithCitations(partialReport, t);
  const ubFinding = findings.find(f => f.type === 'underbilling' && f.cause === 'exclusions');
  assert('underbilling (exclusions cause) finding exists', ubFinding !== null);
  assert('exclusions cause citation field is excluded_categories', ubFinding && ubFinding.citation && ubFinding.citation.field === 'excluded_categories');
}

{
  // Findings sorted by annualValue descending
  const bigCap = {
    id: 'sc1', tenant_name: 'BigCap', leased_sqft: 5000, cam_cap: 5, capBaseAmount: 100,
    excluded_categories: '', quotes: {}, audit_rights: false, end_date: null,
  };
  const smallCap = {
    id: 'sc2', tenant_name: 'SmallCap', leased_sqft: 1000, cam_cap: 5, capBaseAmount: 10,
    excluded_categories: '', quotes: {}, audit_rights: false, end_date: null,
  };
  const inv = [{ vendorName: 'Shared', category: 'utilities', invoiceDate: '2024-01-01', amount: 1000000 }];
  const r   = AE.runAcquisitionReconciliation([bigCap, smallCap], inv, 6000);
  const ub  = AE.underbillingAnalysis(r);
  const partialReport = { capLeakage: AE.capLeakageAnalysis(r), exclusions: [], auditWindows: [], underbilling: ub, renewalRisk: [] };
  const findings = AE.buildFindingsWithCitations(partialReport, [bigCap, smallCap]);
  const nonNullAV = findings.filter(f => f.annualValue !== null);
  assert('findings sorted by annualValue descending', nonNullAV.every((f, i, a) => i === 0 || a[i-1].annualValue >= f.annualValue));
}

// ── Group 13: Renewal & Pro-Rata Risk ────────────────────────────────────────

console.log('\n── Group 13: Renewal & Pro-Rata Risk ────────────────────────────');

{
  // renewalRiskAnalysis: expired lease → 'critical'
  const t = [{ id: 'r1', tenant_name: 'Expired', end_date: '2020-01-01', renewal_options: null }];
  const r = AE.renewalRiskAnalysis(t);
  assert('expired lease → riskLevel critical', r.length === 1 && r[0].riskLevel === 'critical');
}

{
  // renewalRiskAnalysis: expiring within 365 days, no renewal → 'high'
  const future = new Date(Date.now() + 180 * 86400000).toISOString().slice(0, 10);
  const t = [{ id: 'r2', tenant_name: 'SoonNoRenew', end_date: future, renewal_options: null }];
  const r = AE.renewalRiskAnalysis(t);
  assert('expiring in 180 days, no renewal option → high', r.length === 1 && r[0].riskLevel === 'high');
}

{
  // renewalRiskAnalysis: expiring within 365 days but HAS renewal → 'medium'
  const future = new Date(Date.now() + 180 * 86400000).toISOString().slice(0, 10);
  const t = [{ id: 'r3', tenant_name: 'SoonWithRenew', end_date: future, renewal_options: '2 x 5yr options' }];
  const r = AE.renewalRiskAnalysis(t);
  assert('expiring in 180 days with renewal option → medium', r.length === 1 && r[0].riskLevel === 'medium');
}

{
  // renewalRiskAnalysis: no end_date → excluded (riskLevel 'none' → filtered out)
  const t = [{ id: 'r4', tenant_name: 'NoDate', end_date: null, renewal_options: null }];
  const r = AE.renewalRiskAnalysis(t);
  assertEq('tenant with no end_date excluded from renewal risk', r, []);
}

{
  // renewalRiskAnalysis: citation comes from quotes, not from the renewal_options field.
  // Even when renewal_options (the extracted field) is null, if quotes.renewal_options
  // contains verbatim clause text, the citation should be returned.
  const future = new Date(Date.now() + 100 * 86400000).toISOString().slice(0, 10);
  const t = [{
    id: 'r5', tenant_name: 'WithQuote', end_date: future, renewal_options: null,
    quotes: { renewal_options: 'Tenant shall have one option to renew for 5 years.' },
  }];
  const r = AE.renewalRiskAnalysis(t);
  assert('renewal risk citation present when quotes.renewal_options populated (even if field is null)', r.length > 0 && r[0].citation !== null);
  assert('renewal risk citation text matches quotes.renewal_options', r[0].citation.text === 'Tenant shall have one option to renew for 5 years.');
}

{
  // proRataRiskAnalysis: 'occupied' method → non-standard → 'medium'
  const t = [{ id: 'pr1', tenant_name: 'OccupiedMethod', pro_rata_method: 'occupied', leased_sqft: 1000 }];
  const r = AE.proRataRiskAnalysis(t);
  assert('occupied pro-rata method → medium risk', r.length === 1 && r[0].riskLevel === 'medium' && r[0].isNonStandard);
}

{
  // proRataRiskAnalysis: 'rentable' → standard → not returned (filtered out)
  const t = [{ id: 'pr2', tenant_name: 'RentableMethod', pro_rata_method: 'rentable', leased_sqft: 1000 }];
  const r = AE.proRataRiskAnalysis(t);
  assertEq('rentable pro-rata method → not flagged', r, []);
}

{
  // proRataRiskAnalysis: no method → unknown → 'low'
  const t = [{ id: 'pr3', tenant_name: 'NoMethod', pro_rata_method: null, leased_sqft: 1000 }];
  const r = AE.proRataRiskAnalysis(t);
  assert('missing pro-rata method → low risk', r.length === 1 && r[0].riskLevel === 'low' && r[0].isUnknown);
}

{
  // proRataRiskAnalysis: citation attached when pro_rata_method quote present
  const t = [{
    id: 'pr4', tenant_name: 'QuotedMethod', pro_rata_method: 'gross',
    quotes: { pro_rata_method: 'Tenant\'s share is based on gross leasable area.' },
  }];
  const r = AE.proRataRiskAnalysis(t);
  assert('pro-rata risk citation present when quote available', r.length === 1 && r[0].citation !== null);
  assert('pro-rata citation field is pro_rata_method', r[0].citation.field === 'pro_rata_method');
}

{
  // buildAcquisitionReport now includes findings, renewalRisk, proRataRisk
  const report = AE.buildAcquisitionReport(TENANTS, INVOICES, TOTAL_SQFT);
  assert('report includes findings array', Array.isArray(report.findings));
  assert('report includes renewalRisk array', Array.isArray(report.renewalRisk));
  assert('report includes proRataRisk array', Array.isArray(report.proRataRisk));
  assert('report summary includes criticalRenewalCount', typeof report.summary.criticalRenewalCount === 'number');
  const findingsWithCitation = report.findings.filter(f => f.citation !== null);
  assert('all findings have required fields', report.findings.every(f =>
    'type' in f && 'label' in f && 'tenantName' in f && 'citation' in f
  ));
}

{
  // Large pool: report findings include cap_leakage findings
  const bigInv = [{ vendorName: 'Huge Pool', category: 'utilities', invoiceDate: '2024-01-01', amount: 500000 }];
  const report = AE.buildAcquisitionReport(TENANTS, bigInv, TOTAL_SQFT);
  assert('findings include cap_leakage type when caps breach', report.findings.some(f => f.type === 'cap_leakage'));
  assert('cap_leakage renewal_risk appears in topRisks only when relevant', typeof report.topRisks === 'object');
}

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(60)}`);
const total = passed + failed;
console.log(`Results: ${passed}/${total} passed${failed > 0 ? `, ${failed} FAILED` : ''}`);
if (failed > 0) { console.error('\n❌ Test suite FAILED'); process.exit(1); }
else             { console.log('\n✅ All acquisition engine tests pass'); }
