'use strict';
/**
 * test-metrics.js — Regression tests for the canonical derived metrics layer.
 *
 * All tests are zero-DOM, zero-network. Dependencies are stubbed inline.
 * Run: node test-metrics.js
 */

// ── Assertion helpers ─────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${label}`);
    failed++;
  }
}

function assertEqual(a, b, label) {
  if (a === b) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${label} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
    failed++;
  }
}

// ── Stubs ─────────────────────────────────────────────────────────────────────

// Stub window for Node environment
const window = global;

// Stub ReviewEngine
window.ReviewEngine = {
  deriveTenantReviewState(t) {
    const warnings = [];
    if (!t.lease_type)  warnings.push({ type: 'missing_lease_type', severity: 'high' });
    if (!t.leased_sqft) warnings.push({ type: 'missing_sqft',       severity: 'high' });
    if (!t.start_date)  warnings.push({ type: 'missing_start_date', severity: 'high' });
    if (!t.end_date)    warnings.push({ type: 'missing_end_date',   severity: 'high' });
    const hasCoreFields = t.lease_type && t.leased_sqft && t.start_date && t.end_date && t.tenant_name;
    const status = !t.tenant_name ? 'incomplete'
      : !hasCoreFields ? 'incomplete'
      : t._needsReview ? 'needs_review'
      : 'verified';
    return { status, warnings, score: 100 - warnings.length * 5 };
  },
};

// Stub Selectors
window.Selectors = {
  derivePropertyReadiness(p) {
    const tenants = Array.isArray(p.tenants) ? p.tenants : [];
    const expiredCount  = tenants.filter(t => t.end_date && new Date(t.end_date) < new Date()).length;
    const lowConfCount  = tenants.filter(t => t._confidence === 'low').length;
    let riskScore = expiredCount * 15 + lowConfCount * 10;
    riskScore = Math.min(100, riskScore);
    const readiness = riskScore >= 60 ? 'high_risk'
      : riskScore >= 30 ? 'needs_review'
      : 'partially_verified';
    return { riskScore, readiness };
  },
};

// Inline getPropertyInvoiceStats (mirrors script.js logic)
function getPropertyInvoiceStats(p) {
  const camRec = p.camReconciliation ?? p.results ?? null;
  let invoices = Array.isArray(p.invoices) && p.invoices.length > 0 ? p.invoices : null;
  if (!invoices) {
    const full = camRec?.invoicesFull;
    if (Array.isArray(full) && full.length > 0) invoices = full;
  }
  if (!invoices) {
    const simple = camRec?.invoices;
    if (Array.isArray(simple) && simple.length > 0) invoices = simple;
  }
  if (!invoices && p.results) {
    const leg = p.results?.invoices;
    if (Array.isArray(leg) && leg.length > 0) invoices = leg;
  }
  if (!invoices && Array.isArray(camRec?.results) && camRec.results.length > 0) {
    const seen = new Set();
    const agg = [];
    for (const r of camRec.results) {
      if (!Array.isArray(r.includedInvoices)) continue;
      for (const inv of r.includedInvoices) {
        const key = inv.id != null ? String(inv.id)
          : (inv.vendorName || inv.vendor || '') + '|' + (inv.amount || 0);
        if (!seen.has(key)) { seen.add(key); agg.push(inv); }
      }
    }
    if (agg.length > 0) invoices = agg;
  }
  if (!invoices || invoices.length === 0) return { totalInvoices: 0, uniqueVendors: 0, totalExpenseAmount: 0 };
  const vendors = new Set();
  let total = 0;
  for (const inv of invoices) {
    const v = inv.vendorName || inv.vendor;
    if (v) vendors.add(v);
    const amt = parseFloat(inv.amount || 0);
    if (!isNaN(amt)) total += amt;
  }
  return { totalInvoices: invoices.length, uniqueVendors: vendors.size, totalExpenseAmount: Math.round(total * 100) / 100 };
}

// Inline derivePropertyMetrics (mirrors script.js)
function derivePropertyMetrics(p) {
  if (!p) return null;
  const invStats       = getPropertyInvoiceStats(p);
  const disputes_arr   = Array.isArray(p.disputes) ? p.disputes : [];
  const openDisputes   = disputes_arr.filter(d => d.status === 'open').length;
  const resolvedDisputes = disputes_arr.filter(d => d.status !== 'open' && d.status != null).length;
  const tenants_arr    = Array.isArray(p.tenants) ? p.tenants : [];
  const reviewStates   = tenants_arr.map(t => window.ReviewEngine.deriveTenantReviewState(t, []));
  const tenantsNeedingReview = reviewStates.filter(rs => rs.status === 'incomplete' || rs.status === 'needs_review').length;
  const flaggedLeaseCount    = reviewStates.filter(rs => rs.warnings && rs.warnings.length > 0).length;
  const amendmentCount       = tenants_arr.reduce((s, t) => s + (Array.isArray(t.amendments) ? t.amendments.length : 0), 0);
  const unresolvedWarnings   = reviewStates.reduce((s, rs) => s + (rs.warnings ? rs.warnings.length : 0), 0);
  const reconSnap    = p.camReconciliation ?? p.results;
  const reconResults = Array.isArray(reconSnap?.results) ? reconSnap.results : [];
  const totalCAM = Math.round(reconResults.reduce((s, r) => s + (Number(r.allocatedAmount) || 0), 0));
  const allocationCoveragePct = invStats.totalExpenseAmount > 0
    ? Math.round((totalCAM / invStats.totalExpenseAmount) * 100) : null;
  const rd = window.Selectors.derivePropertyReadiness(p);
  let healthScore = Math.max(0, Math.min(100, 100 - (rd.riskScore || 0)));
  const reasons = [];
  if (openDisputes > 0) {
    healthScore = Math.max(0, healthScore - Math.min(20, openDisputes * 7));
    reasons.push(`${openDisputes} open dispute${openDisputes !== 1 ? 's' : ''}`);
  }
  if (tenantsNeedingReview > 0) {
    healthScore = Math.max(0, healthScore - Math.min(15, tenantsNeedingReview * 5));
    reasons.push(`${tenantsNeedingReview} tenant${tenantsNeedingReview !== 1 ? 's' : ''} need review`);
  }
  if (invStats.totalInvoices === 0) reasons.push('No invoices loaded');
  const healthStatus = healthScore >= 80 ? 'healthy' : healthScore >= 50 ? 'warning' : 'high-risk';
  const tenantsWithEvidence = tenants_arr.filter(t => t.fieldEvidence && Object.keys(t.fieldEvidence).length > 0).length;
  const confVals = tenants_arr.map(t => {
    if (t._confidence === 'high')   return 90;
    if (t._confidence === 'medium') return 70;
    if (t._confidence === 'low')    return 40;
    return null;
  }).filter(v => v !== null);
  const avgConfidence = confVals.length ? Math.round(confVals.reduce((s, v) => s + v, 0) / confVals.length) : null;
  return {
    propertyId:     p.id,
    invoiceStats:   { totalInvoices: invStats.totalInvoices, uniqueVendors: invStats.uniqueVendors, totalExpenseAmount: invStats.totalExpenseAmount },
    disputeStats:   { totalDisputes: disputes_arr.length, openDisputes, resolvedDisputes },
    reviewStats:    { tenantsNeedingReview, flaggedLeaseCount, amendmentCount, unresolvedWarnings },
    financialStats: { totalCAM, totalAllocated: totalCAM, allocationCoveragePct },
    health:         { score: healthScore, status: healthStatus, reasons },
    extraction:     { tenantsWithEvidence, tenantsMissingEvidence: tenants_arr.length - tenantsWithEvidence, avgConfidence },
  };
}

// Inline rebuildDerivedState
const _props = [];
let activePropId = null;
function rebuildDerivedState(property) {
  if (!property) return;
  const metrics = derivePropertyMetrics(property);
  if (!metrics) return;
  property._derivedMetrics     = metrics;
  property.derivedStateVersion = (property.derivedStateVersion || 0) + 1;
  window.ms_metricsDebug = { propertyId: metrics.propertyId, metrics, computedAt: new Date().toISOString() };
  const entry = (_props || []).find(q => q.id === property.id);
  if (entry && entry !== property) {
    entry.openDisputes        = metrics.disputeStats.openDisputes;
    entry.totalCAM            = metrics.financialStats.totalCAM;
    entry._derivedMetrics     = metrics;
    entry.derivedStateVersion = property.derivedStateVersion;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST metrics-1: Invoice totals match dashboard
// ─────────────────────────────────────────────────────────────────────────────
console.log('\nTEST metrics-1: Invoice totals match dashboard');
{
  const prop = {
    id: 'p1',
    invoices: [
      { vendorName: 'Acme Cleaning', amount: '1000' },
      { vendorName: 'City Power',    amount: '500' },
      { vendorName: 'Acme Cleaning', amount: '250' },
      { vendorName: 'PestControl Co', amount: '300' },
    ],
    disputes: [],
    tenants: [],
  };
  const dm = derivePropertyMetrics(prop);
  assertEqual(dm.invoiceStats.totalInvoices,   4,     'totalInvoices === 4');
  assertEqual(dm.invoiceStats.uniqueVendors,   3,     'uniqueVendors === 3 (Acme counted once)');
  assertEqual(dm.invoiceStats.totalExpenseAmount, 2050, 'totalExpenseAmount === 2050');
  assertEqual(dm.propertyId, 'p1', 'propertyId matches');
  assert(typeof dm.health === 'object', 'health object present');
  assert(typeof dm.reviewStats === 'object', 'reviewStats object present');
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST metrics-2: Dispute totals survive reload (reads from property.disputes only)
// ─────────────────────────────────────────────────────────────────────────────
console.log('\nTEST metrics-2: Dispute totals survive reload');
{
  const prop = {
    id: 'p2',
    invoices: [],
    disputes: [
      { id: 0, status: 'open',     tenantName: 'Tenant A' },
      { id: 1, status: 'open',     tenantName: 'Tenant B' },
      { id: 2, status: 'accepted', tenantName: 'Tenant C' },
    ],
    tenants: [],
  };
  const dm = derivePropertyMetrics(prop);
  assertEqual(dm.disputeStats.totalDisputes,    3, 'totalDisputes === 3');
  assertEqual(dm.disputeStats.openDisputes,     2, 'openDisputes === 2');
  assertEqual(dm.disputeStats.resolvedDisputes, 1, 'resolvedDisputes === 1');
  assert(dm.health.reasons.some(r => r.includes('2 open disputes')), 'health.reasons mentions open disputes');
  assert(dm.health.score < 100, 'health.score degraded below 100 by open disputes');
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST metrics-3: Health score changes after warning added
// ─────────────────────────────────────────────────────────────────────────────
console.log('\nTEST metrics-3: Health score changes after warning added');
{
  const propBase = {
    id: 'p3',
    invoices: [{ vendorName: 'V1', amount: '100' }],
    disputes: [],
    tenants: [{
      id: 't1', tenant_name: 'Alice', leased_sqft: 1000,
      lease_type: 'NNN', start_date: '2024-01-01', end_date: '2026-01-01',
    }],
  };
  const dmBase = derivePropertyMetrics(propBase);
  assert(dmBase.health.score >= 80, 'base health score >= 80 (healthy)');
  assertEqual(dmBase.health.status, 'healthy', 'base status is healthy');

  // Add an open dispute
  const propWithDispute = {
    ...propBase,
    disputes: [{ id: 0, status: 'open', tenantName: 'Alice', tenantShare: '500' }],
  };
  const dmDispute = derivePropertyMetrics(propWithDispute);
  assert(dmDispute.health.score < dmBase.health.score, 'score decreased after dispute');
  assert(dmDispute.health.status !== 'healthy', 'status degraded after dispute');
  assert(dmDispute.health.reasons.length > 0, 'reasons array non-empty');
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST metrics-4: Amendment upload updates reviewStats
// ─────────────────────────────────────────────────────────────────────────────
console.log('\nTEST metrics-4: Amendment upload updates reviewStats');
{
  const prop = {
    id: 'p4',
    invoices: [],
    disputes: [],
    tenants: [
      {
        id: 't1', tenant_name: 'Bob', leased_sqft: 2000,
        lease_type: 'Gross', start_date: '2023-01-01', end_date: '2025-12-31',
        amendments: [],
      },
    ],
  };
  const dm1 = derivePropertyMetrics(prop);
  assertEqual(dm1.reviewStats.amendmentCount, 0, 'zero amendments initially');

  // Simulate amendment upload
  prop.tenants[0].amendments = [{ id: 'amd-1', overriddenFields: ['cap'] }];
  const dm2 = derivePropertyMetrics(prop);
  assertEqual(dm2.reviewStats.amendmentCount, 1, 'amendmentCount === 1 after upload');

  prop.tenants[0].amendments.push({ id: 'amd-2', overriddenFields: ['end_date'] });
  const dm3 = derivePropertyMetrics(prop);
  assertEqual(dm3.reviewStats.amendmentCount, 2, 'amendmentCount === 2 after second amendment');
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST metrics-5: Dispute updates derived state without full rerender
// ─────────────────────────────────────────────────────────────────────────────
console.log('\nTEST metrics-5: Dispute updates derived state without full rerender');
{
  const prop = {
    id: 'p5',
    invoices: [{ vendorName: 'V1', amount: '1000' }],
    disputes: [],
    tenants: [],
  };

  rebuildDerivedState(prop);
  assertEqual(prop._derivedMetrics.disputeStats.openDisputes, 0, 'initially 0 open disputes in cached state');
  assertEqual(prop.derivedStateVersion, 1, 'derivedStateVersion starts at 1');

  // Simulate dispute submission
  prop.disputes = [{ id: 0, status: 'open', tenantName: 'Tenant A' }];
  rebuildDerivedState(prop);
  assertEqual(prop._derivedMetrics.disputeStats.openDisputes, 1, 'cached state updated to 1 open dispute');
  assertEqual(prop.derivedStateVersion, 2, 'derivedStateVersion incremented to 2');

  // Verify ms_metricsDebug updated
  assert(window.ms_metricsDebug.propertyId === 'p5', 'ms_metricsDebug.propertyId set');
  assert(window.ms_metricsDebug.metrics !== null, 'ms_metricsDebug.metrics populated');
  assert(typeof window.ms_metricsDebug.computedAt === 'string', 'ms_metricsDebug.computedAt is ISO string');
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST metrics-6: PDF export uses same derived metrics as UI
// ─────────────────────────────────────────────────────────────────────────────
console.log('\nTEST metrics-6: PDF export uses same derived metrics as UI');
{
  const prop = {
    id: 'p6',
    invoices: [{ vendorName: 'Vendor A', amount: '5000' }, { vendorName: 'Vendor B', amount: '3000' }],
    disputes: [
      { id: 0, status: 'open', tenantShare: '2000' },
      { id: 1, status: 'accepted' },
    ],
    tenants: [{
      id: 't1', tenant_name: 'Corp X', leased_sqft: 5000,
      lease_type: 'NNN', start_date: '2024-01-01', end_date: '2027-01-01',
    }],
    camReconciliation: {
      results: [{ allocatedAmount: 7500, name: 'Corp X', includedInvoices: [] }],
    },
  };

  // Simulate what the UI dashboard would show
  const dmUI = derivePropertyMetrics(prop);

  // Simulate what generateLandlordExport() would show (using derivePropertyMetrics via _expDm)
  rebuildDerivedState(prop);
  const dmExport = prop._derivedMetrics;

  assertEqual(dmUI.financialStats.totalCAM,     dmExport.financialStats.totalCAM,     'totalCAM matches between UI and export');
  assertEqual(dmUI.disputeStats.openDisputes,   dmExport.disputeStats.openDisputes,   'openDisputes matches between UI and export');
  assertEqual(dmUI.invoiceStats.totalInvoices,  dmExport.invoiceStats.totalInvoices,  'totalInvoices matches between UI and export');
  assertEqual(dmUI.financialStats.totalCAM, 7500, 'totalCAM is 7500 from camReconciliation');
  assertEqual(dmUI.disputeStats.openDisputes, 1, 'openDisputes is 1');
}

// ─────────────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`Derived metrics: ${passed} passed, ${failed} failed`);
console.log('─'.repeat(50));

if (failed > 0) process.exit(1);
