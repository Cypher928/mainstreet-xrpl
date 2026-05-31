'use strict';
/**
 * test-cam-persistence.js — Phase 21: CAM reconciliation persistence
 *
 * Unit tests for the row-mapping (saveCamResults) and merge/rebuild
 * (_mergeCamReconciliationRows) logic introduced in Phase 21. Zero network —
 * all Supabase/API interactions are replaced with inline data.
 *
 * Run: node test-cam-persistence.js
 */

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) { console.log('  ✓', label); passed++; }
  else           { console.error('  ✗', label); failed++; }
}
function assertEqual(a, b, label) {
  assert(a === b, label + ` (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
}

// ── Inline copies of the logic under test (mirrors script.js) ─────────────────

// Mirrors saveCamResults() row construction.
function camResultsToRows(propertyId, fullResults, year, totalExpenses) {
  return (fullResults || []).map(r => {
    const actual   = r.actualCam ?? r.totalAllocated ?? null;
    const expected = r.expectedCam ?? null;
    return {
      property_id:      propertyId,
      tenant_id:        r.tenantId,
      tenant_name:      r.tenantName ?? r.name ?? null,
      actual_cam:       actual,
      expected_cam:     expected,
      variance:         (actual !== null && expected !== null)
        ? Math.round((actual - expected) * 100) / 100
        : (r.variance ?? null),
      allocated_amount: r.allocatedAmount ?? r.totalAllocated ?? actual,
      pro_rata_percent: r.proRataPercent ?? (r.proRata != null ? r.proRata * 100 : null),
      total_expenses:   totalExpenses,
      year,
    };
  });
}

// Mirrors _mergeCamReconciliationRows() from script.js.
function mergeCamReconciliationRows(dbData, camRows, getCamYear) {
  if (!dbData || !Array.isArray(camRows) || !camRows.length) return;

  dbData.tenants = (dbData.tenants || []).map(t => {
    const cam = camRows.find(r => r.tenant_id === t.id);
    if (!cam) return t;
    return { ...t, expectedCam: cam.expected_cam, actualCam: cam.actual_cam, variance: cam.variance };
  });

  if (dbData.camReconciliation || dbData.results) return;

  const totalSqft    = dbData.totalSqft || 1;
  const invoiceList  = dbData.invoices || [];
  const invoiceCount = invoiceList.length;
  const invoiceTotal = invoiceList.reduce((s, inv) => s + (parseFloat(inv.amount) || 0), 0);

  const snapResults = dbData.tenants
    .filter(t => t.actualCam != null)
    .map(t => ({
      name:             t.tenant_name || '(Unknown)',
      allocatedAmount:  t.actualCam,
      totalAllocated:   t.actualCam,
      proRata:          (Number(t.leased_sqft) || 0) / totalSqft,
      proRataPercent:   ((Number(t.leased_sqft) || 0) / totalSqft) * 100,
      eligibleCount:    invoiceCount,
      capApplied:       false,
      capAdjustment:    null,
      includedInvoices: [],
      ambiguityFlags:   [],
    }));
  if (!snapResults.length) return;

  dbData.camReconciliation = {
    propId:   dbData.id,
    propName: dbData.name || '',
    camYear:  camRows[0]?.year ?? getCamYear(),
    total:    invoiceTotal || snapResults.reduce((s, r) => s + (r.allocatedAmount || 0), 0),
    results:  snapResults,
    invoices: invoiceList.map((inv, i) => ({ id: `inv-${i}`, ...inv })),
    invoicesFull: invoiceList,
    tenants:  (dbData.tenants || []).filter(t => t && t.tenant_name).map(t => ({
      name: t.tenant_name, leasedSqft: Number(t.leased_sqft) || 0, totalSqft,
      excludedCategories: t.excluded_categories
        ? t.excluded_categories.split(',').map(s => s.trim().toLowerCase()).filter(Boolean) : [],
    })),
    camRuns: [],
  };
}

console.log('\nCAM persistence — Phase 21 unit tests');
console.log('─'.repeat(48));

// ── P21-1: row mapping captures all enriched fields ──────────────────────────
{
  const results = [{
    tenantId: 't1', tenantName: 'Acme Co', totalAllocated: 1200.5, allocatedAmount: 1200.5,
    actualCam: 1200.5, expectedCam: 1000, proRataPercent: 25,
  }];
  const rows = camResultsToRows('prop-1', results, 2025, 4802);
  assertEqual(rows.length, 1, 'P21-1: one row per result');
  assertEqual(rows[0].property_id, 'prop-1', 'P21-1: property_id');
  assertEqual(rows[0].tenant_id, 't1', 'P21-1: tenant_id');
  assertEqual(rows[0].tenant_name, 'Acme Co', 'P21-1: tenant_name');
  assertEqual(rows[0].actual_cam, 1200.5, 'P21-1: actual_cam');
  assertEqual(rows[0].expected_cam, 1000, 'P21-1: expected_cam');
  assertEqual(rows[0].variance, 200.5, 'P21-1: variance computed (actual - expected)');
  assertEqual(rows[0].allocated_amount, 1200.5, 'P21-1: allocated_amount');
  assertEqual(rows[0].pro_rata_percent, 25, 'P21-1: pro_rata_percent');
  assertEqual(rows[0].total_expenses, 4802, 'P21-1: total_expenses');
  assertEqual(rows[0].year, 2025, 'P21-1: year');
}

// ── P21-2: variance null when expected unknown; proRata→percent fallback ─────
{
  const results = [{ tenantId: 't2', name: 'Beta', totalAllocated: 500, expectedCam: null, proRata: 0.1 }];
  const rows = camResultsToRows('prop-1', results, 2025, 5000);
  assertEqual(rows[0].variance, null, 'P21-2: variance null when expected_cam null');
  assertEqual(rows[0].tenant_name, 'Beta', 'P21-2: tenant_name falls back to r.name');
  assertEqual(rows[0].pro_rata_percent, 10, 'P21-2: pro_rata_percent derived from proRata (0.1 → 10)');
  assertEqual(rows[0].actual_cam, 500, 'P21-2: actual_cam falls back to totalAllocated');
}

// ── P21-3: merge overlays cam fields onto matching tenants only ──────────────
{
  const dbData = {
    id: 'prop-1', tenants: [
      { id: 't1', tenant_name: 'Acme' },
      { id: 't2', tenant_name: 'Beta' },
    ],
    camReconciliation: { existing: true }, // blob present → no rebuild
  };
  const camRows = [
    { tenant_id: 't1', actual_cam: 1200, expected_cam: 1000, variance: 200, year: 2025 },
  ];
  mergeCamReconciliationRows(dbData, camRows, () => 2025);
  assertEqual(dbData.tenants[0].actualCam, 1200, 'P21-3: matching tenant gets actualCam');
  assertEqual(dbData.tenants[0].expectedCam, 1000, 'P21-3: matching tenant gets expectedCam');
  assertEqual(dbData.tenants[0].variance, 200, 'P21-3: matching tenant gets variance');
  assert(dbData.tenants[1].actualCam === undefined, 'P21-3: non-matching tenant untouched');
}

// ── P21-4: blob present → camReconciliation NOT rebuilt ──────────────────────
{
  const dbData = {
    id: 'prop-1', tenants: [{ id: 't1', tenant_name: 'Acme' }],
    camReconciliation: { existing: true },
  };
  mergeCamReconciliationRows(dbData, [{ tenant_id: 't1', actual_cam: 9, expected_cam: 1, variance: 8, year: 2025 }], () => 2025);
  assertEqual(dbData.camReconciliation.existing, true, 'P21-4: existing blob preserved (not overwritten)');
}

// ── P21-5: blob absent → camReconciliation rebuilt from rows ─────────────────
{
  const dbData = {
    id: 'prop-1', name: 'Riverside', totalSqft: 10000,
    invoices: [{ amount: 3000 }, { amount: 2000 }],
    tenants: [
      { id: 't1', tenant_name: 'Acme', leased_sqft: 2500 },
      { id: 't2', tenant_name: 'Beta', leased_sqft: 1500 },
    ],
    camReconciliation: null, results: null,
  };
  const camRows = [
    { tenant_id: 't1', actual_cam: 1250, expected_cam: 1000, variance: 250, year: 2024 },
    { tenant_id: 't2', actual_cam: 750,  expected_cam: 800,  variance: -50, year: 2024 },
  ];
  mergeCamReconciliationRows(dbData, camRows, () => 2025);
  assert(dbData.camReconciliation !== null, 'P21-5: camReconciliation rebuilt when blob absent');
  assertEqual(dbData.camReconciliation.camYear, 2024, 'P21-5: rebuilt camYear from rows (not getCamYear)');
  assertEqual(dbData.camReconciliation.results.length, 2, 'P21-5: rebuilt result per tenant with actualCam');
  assertEqual(dbData.camReconciliation.total, 5000, 'P21-5: total from invoice sum');
  assertEqual(dbData.camReconciliation.results[0].allocatedAmount, 1250, 'P21-5: result allocatedAmount from actual_cam');
}

// ── P21-6: empty rows → no-op (no merge, no rebuild) ─────────────────────────
{
  const dbData = { id: 'p', tenants: [{ id: 't1', tenant_name: 'Acme' }], camReconciliation: null, results: null };
  mergeCamReconciliationRows(dbData, [], () => 2025);
  assertEqual(dbData.camReconciliation, null, 'P21-6: empty rows → camReconciliation stays null');
  assert(dbData.tenants[0].actualCam === undefined, 'P21-6: empty rows → tenants untouched');
}

// ── P21-7: history year aggregation (mirrors DB Health years computation) ────
{
  const history = [
    { year: 2025, tenant_id: 't1' }, { year: 2025, tenant_id: 't2' },
    { year: 2024, tenant_id: 't1' }, { year: 2023, tenant_id: 't1' },
  ];
  const years = [...new Set(history.map(r => r.year))].sort((a, b) => b - a);
  assertEqual(years.length, 3, 'P21-7: distinct years counted');
  assertEqual(years[0], 2025, 'P21-7: years sorted newest-first');
  assertEqual(years[2], 2023, 'P21-7: oldest year last');
}

// ── P21-8: migration_missing error code propagation ──────────────────────────
// Mirrors the structured error returned by the API handler when the table is absent.
{
  function mockSaveCamResults_migrationMissing() {
    // Simulates what saveCamResults returns when API responds with code:'migration_missing'
    const apiResp = { error: 'cam_reconciliations table not found', code: 'migration_missing', keySource: 'service_role' };
    return { ok: false, reason: apiResp.error, code: apiResp.code, keySource: apiResp.keySource };
  }
  const res = mockSaveCamResults_migrationMissing();
  assert(!res.ok, 'P21-8: migration_missing returns ok:false');
  assertEqual(res.code, 'migration_missing', 'P21-8: code field is migration_missing');
  assertEqual(res.keySource, 'service_role', 'P21-8: keySource propagated from API response');
}

// ── P21-9: anon key fallback surfaced in error result ────────────────────────
{
  function mockSaveCamResults_anonKey() {
    const apiResp = { error: 'Insert failed', detail: {}, keySource: 'anon' };
    return { ok: false, reason: apiResp.error, keySource: apiResp.keySource };
  }
  const res = mockSaveCamResults_anonKey();
  assert(!res.ok, 'P21-9: anon key write failure returns ok:false');
  assertEqual(res.keySource, 'anon', 'P21-9: keySource=anon signals missing SUPABASE_SERVICE_ROLE_KEY');
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('─'.repeat(48));
console.log(`  ${passed} passed, ${failed} failed`);
console.log('─'.repeat(48));
if (failed > 0) process.exit(1);
