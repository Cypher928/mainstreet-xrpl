/**
 * test-invoices.js
 * Regression suite for invoice count correctness on portfolio dashboard cards.
 *
 * Zero network/DOM. All logic inlined from getPropertyInvoiceStats().
 * Run: node test-invoices.js
 */
'use strict';

let passed = 0;
let failed = 0;

function ok(label) {
  console.log(`  \x1b[32m✓\x1b[0m ${label}`);
  passed++;
}

function fail(label, reason) {
  console.error(`  \x1b[31m✗\x1b[0m ${label}: ${reason}`);
  failed++;
}

// ── Inlined helper (mirrors getPropertyInvoiceStats in script.js) ─────────────

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
          : (inv.vendorName || inv.vendor || '') + '|' + (inv.amount || 0) + '|' + (inv.date || inv.invoiceDate || '');
        if (!seen.has(key)) { seen.add(key); agg.push(inv); }
      }
    }
    if (agg.length > 0) invoices = agg;
  }

  if (!invoices || invoices.length === 0) {
    return { totalInvoices: 0, uniqueVendors: 0, totalExpenseAmount: 0 };
  }

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

// ── TEST 1 — invoice-dashboard-1: 4 invoices in property.invoices renders 4 ───
console.log('\nTEST 1 — invoice-dashboard-1: property.invoices source');
try {
  const p = {
    id: 'p1',
    invoices: [
      { vendorName: 'ACME Plumbing', amount: 100 },
      { vendorName: 'City Electric', amount: 200 },
      { vendorName: 'ACME Plumbing', amount: 50 },
      { vendorName: 'Roof Repairs LLC', amount: 300 },
    ],
  };
  const stats = getPropertyInvoiceStats(p);
  if (stats.totalInvoices !== 4)          fail('invoice-dashboard-1: totalInvoices', `expected 4, got ${stats.totalInvoices}`);
  else                                    ok('invoice-dashboard-1: totalInvoices === 4');
  if (stats.uniqueVendors !== 3)          fail('invoice-dashboard-1: uniqueVendors', `expected 3, got ${stats.uniqueVendors}`);
  else                                    ok('invoice-dashboard-1: uniqueVendors === 3');
  if (stats.totalExpenseAmount !== 650)   fail('invoice-dashboard-1: totalExpenseAmount', `expected 650, got ${stats.totalExpenseAmount}`);
  else                                    ok('invoice-dashboard-1: totalExpenseAmount === 650');
} catch (e) { fail('invoice-dashboard-1', e.message); }

// ── TEST 2 — invoice-dashboard-2: reload preserves count via camRec.invoices ──
console.log('\nTEST 2 — invoice-dashboard-2: reload via camReconciliation.invoices');
try {
  // Simulate reload: property.invoices stripped (guard skipped), camRec.invoicesFull stripped,
  // but camRec.invoices (simplified) survives because it IS persisted.
  const p = {
    id: 'p2',
    invoices: [],                           // empty — guard skipped at save time
    camReconciliation: {
      invoicesFull: undefined,              // stripped before save
      invoices: [                           // simplified list — persisted to DB
        { id: 'inv-0', vendorName: 'HVAC Co', amount: 500 },
        { id: 'inv-1', vendorName: 'Janitor Inc', amount: 300 },
      ],
      results: [],
    },
  };
  const stats = getPropertyInvoiceStats(p);
  if (stats.totalInvoices !== 2)  fail('invoice-dashboard-2: totalInvoices', `expected 2, got ${stats.totalInvoices}`);
  else                            ok('invoice-dashboard-2: totalInvoices === 2 (from camRec.invoices)');
  if (stats.uniqueVendors !== 2)  fail('invoice-dashboard-2: uniqueVendors', `expected 2, got ${stats.uniqueVendors}`);
  else                            ok('invoice-dashboard-2: uniqueVendors === 2');
} catch (e) { fail('invoice-dashboard-2', e.message); }

// ── TEST 3 — invoice-dashboard-3: dispute save does not zero count ─────────────
console.log('\nTEST 3 — invoice-dashboard-3: dispute submit does not zero invoice count');
try {
  const originalInvoices = [
    { vendorName: 'ACME', amount: 100 },
    { vendorName: 'BETA', amount: 200 },
  ];
  const p = {
    id: 'p3',
    invoices: originalInvoices.slice(),  // start with invoices
    disputes: [],
    camReconciliation: {
      invoices: originalInvoices.slice(),
      invoicesFull: undefined,
      results: [],
    },
  };

  // Simulate a dispute save: only touches p.disputes, not p.invoices
  const pAfterDispute = {
    ...p,
    disputes: [{ id: 'd1', tenantId: 't1', amount: 50, status: 'open' }],
    // p.invoices untouched — savePropertyData() guard: `if (invoiceData.length > 0) prop.invoices = ...`
    // In tenant portal mode invoiceData is empty, so the guard skips the write.
    // To simulate the worst case, clear p.invoices as the guard would skip it:
    invoices: [],
  };

  const stats = getPropertyInvoiceStats(pAfterDispute);
  if (stats.totalInvoices !== 2)  fail('invoice-dashboard-3: totalInvoices after dispute', `expected 2, got ${stats.totalInvoices}`);
  else                            ok('invoice-dashboard-3: totalInvoices still 2 after dispute save (camRec fallback)');
} catch (e) { fail('invoice-dashboard-3', e.message); }

// ── TEST 4 — invoice-dashboard-4: amendment upload does not affect count ───────
console.log('\nTEST 4 — invoice-dashboard-4: amendment upload does not affect invoice count');
try {
  const p = {
    id: 'p4',
    invoices: [
      { vendorName: 'ACME', amount: 400 },
      { vendorName: 'BETA', amount: 600 },
    ],
    tenants: [{
      id: 't1',
      tenant_name: 'Tenant A',
      amendments: [],
    }],
  };

  // Simulate amendment upload: adds entry to tenant.amendments, leaves invoices untouched
  const pAfterAmendment = {
    ...p,
    tenants: [{
      ...p.tenants[0],
      amendments: [{
        id: 'amd-1',
        fileName: 'amendment-1.pdf',
        uploadedAt: new Date().toISOString(),
        overriddenFields: ['cap'],
      }],
    }],
  };

  const statsBefore = getPropertyInvoiceStats(p);
  const statsAfter  = getPropertyInvoiceStats(pAfterAmendment);
  if (statsBefore.totalInvoices !== 2)
    fail('invoice-dashboard-4: totalInvoices before amendment', `expected 2, got ${statsBefore.totalInvoices}`);
  else ok('invoice-dashboard-4: totalInvoices === 2 before amendment');
  if (statsAfter.totalInvoices !== 2)
    fail('invoice-dashboard-4: totalInvoices after amendment', `expected 2, got ${statsAfter.totalInvoices}`);
  else ok('invoice-dashboard-4: totalInvoices === 2 after amendment (unchanged)');
} catch (e) { fail('invoice-dashboard-4', e.message); }

// ── TEST 5 — zeros when no invoice source has data ────────────────────────────
console.log('\nTEST 5 — zeros when no invoice source has data');
try {
  const p = { id: 'p5', invoices: [], results: null };
  const stats = getPropertyInvoiceStats(p);
  if (stats.totalInvoices !== 0)       fail('no-data: totalInvoices', `expected 0, got ${stats.totalInvoices}`);
  else                                 ok('no-data: totalInvoices === 0');
  if (stats.uniqueVendors !== 0)       fail('no-data: uniqueVendors', `expected 0, got ${stats.uniqueVendors}`);
  else                                 ok('no-data: uniqueVendors === 0');
  if (stats.totalExpenseAmount !== 0)  fail('no-data: totalExpenseAmount', `expected 0, got ${stats.totalExpenseAmount}`);
  else                                 ok('no-data: totalExpenseAmount === 0');
} catch (e) { fail('no-data', e.message); }

// ── TEST 6 — includedInvoices fallback with deduplication ─────────────────────
console.log('\nTEST 6 — includedInvoices deduplication across tenants');
try {
  const p = {
    id: 'p6',
    invoices: [],
    camReconciliation: {
      invoices: [],
      invoicesFull: undefined,
      results: [
        { includedInvoices: [
          { id: 'i1', vendorName: 'Alpha', amount: 200 },
          { id: 'i2', vendorName: 'Beta',  amount: 100 },
        ]},
        { includedInvoices: [
          { id: 'i2', vendorName: 'Beta',  amount: 100 },  // duplicate
          { id: 'i3', vendorName: 'Gamma', amount: 150 },
        ]},
      ],
    },
  };
  const stats = getPropertyInvoiceStats(p);
  if (stats.totalInvoices !== 3)   fail('dedup: totalInvoices', `expected 3, got ${stats.totalInvoices}`);
  else                             ok('dedup: totalInvoices === 3 (i2 deduplicated)');
  if (stats.uniqueVendors !== 3)   fail('dedup: uniqueVendors', `expected 3, got ${stats.uniqueVendors}`);
  else                             ok('dedup: uniqueVendors === 3');
  if (stats.totalExpenseAmount !== 450) fail('dedup: totalExpenseAmount', `expected 450, got ${stats.totalExpenseAmount}`);
  else                             ok('dedup: totalExpenseAmount === 450');
} catch (e) { fail('dedup', e.message); }

// ── TEST 7 — legacy results fallback ─────────────────────────────────────────
console.log('\nTEST 7 — legacy results.invoices fallback');
try {
  const p = {
    id: 'p7',
    invoices: [],
    results: {
      propId: 'p7',
      invoices: [
        { id: 'inv-0', vendorName: 'LegacyCo', amount: 750 },
      ],
      invoicesFull: undefined,
      results: [],
    },
  };
  const stats = getPropertyInvoiceStats(p);
  if (stats.totalInvoices !== 1)          fail('legacy-results: totalInvoices', `expected 1, got ${stats.totalInvoices}`);
  else                                    ok('legacy-results: totalInvoices === 1');
  if (stats.totalExpenseAmount !== 750)   fail('legacy-results: totalExpenseAmount', `expected 750, got ${stats.totalExpenseAmount}`);
  else                                    ok('legacy-results: totalExpenseAmount === 750');
} catch (e) { fail('legacy-results', e.message); }

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${passed + failed} assertions: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
} else {
  console.log('\x1b[32m  ALL INVOICE TESTS PASSED\x1b[0m');
}
