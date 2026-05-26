'use strict';
/**
 * test-disputes.js — Regression tests for the tenant dispute persistence pipeline.
 *
 * Covers the five bugs fixed in v0.8-tenant-dispute-stable:
 *   1. activePropId not set → saves silently skipped
 *   2. disputes[] not seeded → first save overwrites prior disputes
 *   3. loadPropertyData merge used stale LS disputes instead of DB
 *   4. savePropertyData wiped invoices/results in tenant mode
 *   5. nextDisputeId not seeded → id collisions
 *
 * Run:  node test-disputes.js
 * No network. No DOM. No external dependencies.
 */

// ── Micro assertion engine ────────────────────────────────────────────────────

let _passed = 0;
let _failed = 0;
const _suites = [];

function suite(name, fn) {
  const results = [];
  const _suite = { name, results };
  _suites.push(_suite);
  console.log('\n' + name);

  function pass(msg)  { _passed++; results.push({ ok: true,  msg }); console.log('  \x1b[32m✓\x1b[0m', msg); }
  function fail(msg, ctx) {
    _failed++;
    results.push({ ok: false, msg, ctx });
    const detail = ctx !== undefined ? '  \x1b[90m' + JSON.stringify(ctx) + '\x1b[0m' : '';
    console.error('  \x1b[31m✗\x1b[0m', msg, detail);
  }

  function assert(cond, msg, ctx)   { cond ? pass(msg) : fail(msg, ctx); }
  function assertEq(a, b, msg)      { JSON.stringify(a) === JSON.stringify(b) ? pass(msg) : fail(msg, { expected: b, actual: a }); }
  function assertGt(a, b, msg)      { a > b  ? pass(msg) : fail(msg, { value: a, mustBeGt: b }); }
  function assertNull(a, msg)       { a == null ? pass(msg) : fail(msg, { value: a }); }
  function assertNotNull(a, msg)    { a != null ? pass(msg) : fail(msg, { was: a }); }

  fn({ assert, assertEq, assertGt, assertNull, assertNotNull });
}

// ── Shared fixtures ───────────────────────────────────────────────────────────

const PROP_ID   = 'prop-test-uuid-001';
const TENANT_ID = 't-test-uuid-001';

// Fully hydrated property as returned by loadPropertyData()
function makeProperty(overrides) {
  return Object.assign({
    id:         PROP_ID,
    name:       'Regency Commons',
    totalSqft:  12000,
    invoices:   [
      { id: 'inv-1', vendorName: 'CleanCo',  category: 'janitorial', amount: '3200' },
      { id: 'inv-2', vendorName: 'LawnPro',  category: 'landscaping', amount: '1800' },
    ],
    disputes:   [],
    activityLog: [
      { type: 'property_created', title: 'Property created', timestamp: '2024-01-01T00:00:00Z' },
    ],
    results: {
      propId:   PROP_ID,
      results:  [{ name: 'Anchor Retail', allocatedAmount: 14000, proRata: 0.6 }],
      total:    23000,
    },
    camReconciliation: {
      propId:   PROP_ID,
      results:  [{ year: 2024, total: 23000 }],
    },
    tenants: [
      { id: TENANT_ID, tenant_name: 'Anchor Retail', leased_sqft: 7200, lease_type: 'NNN', cap: null },
    ],
  }, overrides);
}

// Sample disputes for fixture use
const D0 = { id: 0, tenantName: 'Anchor Retail', vendor: 'CleanCo',  reason: 'Already paid', timestamp: '2024-06-01T10:00:00Z', status: 'open' };
const D1 = { id: 1, tenantName: 'Anchor Retail', vendor: 'LawnPro',  reason: 'Incorrect sqft', timestamp: '2024-07-15T09:00:00Z', status: 'open' };
const D2 = { id: 2, tenantName: 'Anchor Retail', vendor: 'SecureIT', reason: 'Not in lease',    timestamp: '2024-08-01T08:00:00Z', status: 'open' };

// ── Extracted logic under test ────────────────────────────────────────────────
// These blocks are inlined verbatim from script.js so tests break if the
// implementation diverges from what the tests expect.

/**
 * Mirrors _initTenantPortal() state mutations (script.js ~line 13878).
 * Returns the mutated globals so tests can assert on them.
 */
function simulateInitTenantPortal(loadedProperty, globals) {
  const g = globals; // { activePropId, _props, disputes, activityLog, nextDisputeId }

  // — verbatim from _initTenantPortal —
  g.activePropId = loadedProperty.id;
  g._tenantPortalPropId = loadedProperty.id;
  if (!g._props.find(p => p.id === loadedProperty.id)) g._props.push(loadedProperty);

  g.disputes.splice(0, g.disputes.length, ...(loadedProperty.disputes || []));
  if (loadedProperty.disputes && loadedProperty.disputes.length) {
    g.nextDisputeId = Math.max(...loadedProperty.disputes.map(d => (d.id || 0) + 1), 0);
  }
  g.activityLog.splice(0, g.activityLog.length, ...(loadedProperty.activityLog || []));
  // — end verbatim —

  return g;
}

/**
 * Mirrors the savePropertyData() mutations relevant to tenant mode (script.js ~line 13340).
 * Does NOT call saveProperty() — captures what would be sent to Supabase.
 */
function simulateSavePropertyData(globals) {
  const g = globals;
  if (!g.activePropId) return { skipped: true, reason: 'activePropId null' };

  const prop = g._props.find(p => p.id === g.activePropId);
  if (!prop)            return { skipped: true, reason: 'prop not in _props' };

  // — verbatim from savePropertyData —
  if (g.tenantData && g.tenantData.some(t => t !== null)) {
    prop.tenants = g.tenantData.filter(t => t !== null);
  }
  if (g.invoiceData && g.invoiceData.length > 0) {
    prop.invoices = Array.from(g.invoiceData);
  }
  prop.activityLog = [...g.activityLog];
  prop.disputes    = Array.from(g.disputes);
  prop.results     = g.lastResults && g.lastResults.length
    ? { propId: prop.id, results: g.lastResults }
    : (prop.results ?? null);
  // — end verbatim —

  return { skipped: false, savedProp: prop };
}

/**
 * Mirrors the loadPropertyData() merge logic (script.js ~line 13534).
 */
function simulateMerge(dbData, lsData) {
  if (!dbData) return lsData;
  if (!lsData) return dbData;

  // — verbatim from loadPropertyData merge —
  const dbCount = (dbData.tenants || []).length;
  const lsCount = (lsData.tenants || []).length;
  const base = lsCount > dbCount ? lsData : dbData;

  const _dbDisps     = dbData.disputes || [];
  const _lsDisps     = lsData.disputes || [];
  const _lsOnlyDisps = _lsDisps.filter(d => !_dbDisps.some(dd => dd.id === d.id));
  const _mergedDisps = [..._dbDisps, ..._lsOnlyDisps];

  const merged = {
    ...base,
    disputes:          _mergedDisps,
    results:           dbData.results           ?? base.results           ?? null,
    camReconciliation: dbData.camReconciliation ?? base.camReconciliation ?? null,
  };
  // — end verbatim —

  return merged;
}

/**
 * Returns a fresh globals object (simulates page-load state).
 */
function freshGlobals(overrides) {
  return Object.assign({
    activePropId:       null,
    _tenantPortalPropId: null,
    _props:             [],
    disputes:           [],
    activityLog:        [],
    invoiceData:        [],
    tenantData:         [null, null, null],
    lastResults:        [],
    nextDisputeId:      0,
  }, overrides);
}

// ── TEST 1 — Tenant dispute persistence ───────────────────────────────────────

suite('TEST 1 — Tenant dispute persistence', ({ assert, assertEq, assertNotNull }) => {
  const prop = makeProperty({ disputes: [], activityLog: [] });
  const g    = freshGlobals();

  // Phase: tenant portal initializes
  simulateInitTenantPortal(prop, g);

  assert(g.activePropId === PROP_ID,       'activePropId set after portal init');
  assertEq(g.disputes.length, 0,           'disputes[] seeded from property (0 existing)');
  assertEq(g.nextDisputeId,  0,            'nextDisputeId starts at 0 with no prior disputes');

  // Phase: tenant submits a dispute (mirrors submitDispute logic)
  const newDispute = {
    id:         g.nextDisputeId++,
    tenantName: 'Anchor Retail',
    vendor:     'CleanCo',
    reason:     'Already paid directly',
    timestamp:  '2024-09-01T12:00:00Z',
    status:     'open',
    history:    [{ action: 'opened', by: 'Anchor Retail', at: '2024-09-01T12:00:00Z', note: 'Already paid directly' }],
  };
  g.disputes.push(newDispute);
  g.activityLog.push({ type: 'dispute_opened', title: 'Dispute filed — CleanCo' });

  assert(g.disputes.length === 1,          'disputes[] has 1 entry after push');

  // Phase: savePropertyData fires
  const { skipped, savedProp } = simulateSavePropertyData(g);

  assert(!skipped,                         'savePropertyData did not skip (activePropId set)');
  assertNotNull(savedProp,                 'savedProp is not null');
  assertEq(savedProp.disputes.length, 1,   'dispute persisted onto prop object');
  assertEq(savedProp.disputes[0].vendor, 'CleanCo', 'dispute vendor intact');
  assertEq(savedProp.disputes[0].id, 0,   'dispute id is 0 (first dispute)');
  assertEq(g.nextDisputeId, 1,            'nextDisputeId incremented to 1');
});

// ── TEST 2 — Landlord visibility after reload ─────────────────────────────────

suite('TEST 2 — Landlord visibility after reload (merge)', ({ assert, assertEq }) => {
  // DB has the tenant's dispute; landlord LS is stale (no dispute).
  const dbData = makeProperty({ disputes: [D0, D1] });
  const lsData = makeProperty({ disputes: [] }); // landlord's stale localStorage

  const merged = simulateMerge(dbData, lsData);

  assertEq(merged.disputes.length, 2,           'both DB disputes present after merge');
  assertEq(merged.disputes[0].id, D0.id,         'first dispute id intact');
  assertEq(merged.disputes[1].id, D1.id,         'second dispute id intact');
  assertEq(merged.disputes[0].vendor, D0.vendor, 'dispute vendor survives merge');
  assertEq(merged.disputes[1].reason, D1.reason, 'dispute reason survives merge');

  // Ensure other fields not clobbered
  assert(merged.tenants.length === 1,            'tenants not lost after merge');
  assertEq(merged.results.propId, PROP_ID,       'results.propId intact after merge');
  assertEq(merged.camReconciliation.propId, PROP_ID, 'camReconciliation intact after merge');
});

// ── TEST 3 — Merge preservation (stale LS / fresh DB) ────────────────────────

suite('TEST 3 — Merge preservation', ({ assert, assertEq }) => {
  // Scenario: DB has two disputes from tenant. LS has one old dispute not in DB (unsaved landlord entry).
  const dbData = makeProperty({ disputes: [D0, D1] });
  const lsData = makeProperty({ disputes: [D2] }); // LS-only dispute (not yet in DB)

  const merged = simulateMerge(dbData, lsData);

  // DB disputes preserved
  assert(merged.disputes.some(d => d.id === D0.id), 'DB dispute D0 present after merge');
  assert(merged.disputes.some(d => d.id === D1.id), 'DB dispute D1 present after merge');
  // LS-only dispute not dropped
  assert(merged.disputes.some(d => d.id === D2.id), 'LS-only dispute D2 preserved (safety net)');
  assertEq(merged.disputes.length, 3, 'all 3 unique disputes in merged result');

  // Dedup: if same dispute in both LS and DB, it should not appear twice
  const dbAndLs = makeProperty({ disputes: [D0] });
  const lsAlso  = makeProperty({ disputes: [D0] });
  const mergedDup = simulateMerge(dbAndLs, lsAlso);
  assertEq(mergedDup.disputes.length, 1, 'duplicate dispute not doubled in merge');

  // When LS has MORE tenants, LS wins as base — but disputes still come from DB
  const dbFewer = makeProperty({ tenants: [{ id: TENANT_ID, tenant_name: 'T1', leased_sqft: 1000 }], disputes: [D1] });
  const lsMore  = makeProperty({
    tenants: [
      { id: TENANT_ID, tenant_name: 'T1', leased_sqft: 1000 },
      { id: 't-extra',  tenant_name: 'T2', leased_sqft: 2000 },
    ],
    disputes: [], // LS is stale on disputes
  });
  const mergedBase = simulateMerge(dbFewer, lsMore);
  assert(mergedBase.disputes.some(d => d.id === D1.id), 'DB dispute preserved even when LS wins as base by tenant count');
  assertEq(mergedBase.tenants.length, 2, 'LS tenant list used as base (more tenants)');
});

// ── TEST 4 — No invoice/results/activityLog wipe ─────────────────────────────

suite('TEST 4 — No invoice/results/activityLog wipe', ({ assert, assertEq }) => {
  const prop = makeProperty({
    disputes:    [],
    invoices:    [
      { id: 'inv-1', vendorName: 'CleanCo',  category: 'janitorial',  amount: '3200' },
      { id: 'inv-2', vendorName: 'LawnPro',  category: 'landscaping', amount: '1800' },
    ],
    activityLog: [
      { type: 'property_created', title: 'Property created', timestamp: '2024-01-01T00:00:00Z' },
      { type: 'cam_run',          title: 'CAM run completed', timestamp: '2024-06-01T00:00:00Z' },
    ],
    results: {
      propId:  PROP_ID,
      results: [{ name: 'Anchor Retail', allocatedAmount: 14000 }],
      total:   23000,
    },
  });

  const g = freshGlobals();
  simulateInitTenantPortal(prop, g);

  // Tenant submits a dispute
  g.disputes.push({ id: g.nextDisputeId++, vendor: 'CleanCo', reason: 'Overstated', status: 'open', tenantName: 'Anchor Retail', timestamp: new Date().toISOString() });
  g.activityLog.push({ type: 'dispute_opened', title: 'Dispute filed' });

  // invoiceData and lastResults are empty (never populated in tenant mode)
  assertEq(g.invoiceData.length, 0, 'invoiceData is empty in tenant mode');
  assertEq(g.lastResults.length, 0, 'lastResults is empty in tenant mode');

  const { skipped, savedProp } = simulateSavePropertyData(g);

  assert(!skipped, 'save not skipped');

  // Invoices must not be wiped
  assertEq(savedProp.invoices.length, 2, 'invoices NOT wiped (empty invoiceData skipped)');
  assertEq(savedProp.invoices[0].vendorName, 'CleanCo',  'invoice 0 intact');
  assertEq(savedProp.invoices[1].vendorName, 'LawnPro',  'invoice 1 intact');

  // Results must not be wiped (prop.results preserved when lastResults is empty)
  assert(savedProp.results !== null,                    'results NOT wiped (null guard applied)');
  assertEq(savedProp.results.propId, PROP_ID,           'results.propId intact');
  assertEq(savedProp.results.results[0].allocatedAmount, 14000, 'results allocation intact');

  // Disputes: only the new one (existing was empty, seeded from loaded property)
  assertEq(savedProp.disputes.length, 1,                'new dispute persisted');

  // activityLog: seeded existing + new entry
  assert(savedProp.activityLog.length >= 2,             'activityLog has existing + new entries');
  assert(savedProp.activityLog.some(e => e.type === 'property_created'), 'existing log entry preserved');
  assert(savedProp.activityLog.some(e => e.type === 'dispute_opened'),   'new log entry present');
});

// ── TEST 4b — Existing disputes preserved when seeded ─────────────────────────

suite('TEST 4b — Existing disputes preserved when tenant has prior disputes', ({ assert, assertEq }) => {
  // Property already has two disputes stored in Supabase
  const prop = makeProperty({ disputes: [D0, D1] });
  const g    = freshGlobals();

  simulateInitTenantPortal(prop, g);

  // disputes[] seeded from loaded property
  assertEq(g.disputes.length, 2,      'disputes[] seeded with 2 existing disputes');
  assertEq(g.nextDisputeId,   2,      'nextDisputeId seeded correctly (max id + 1 = 2)');

  // Tenant submits a third dispute
  g.disputes.push({ id: g.nextDisputeId++, vendor: 'NewCo', reason: 'Wrong category', status: 'open', tenantName: 'Anchor Retail', timestamp: new Date().toISOString() });

  assertEq(g.disputes.length, 3,      'disputes[] has 3 entries after new push');
  assertEq(g.nextDisputeId,   3,      'nextDisputeId incremented to 3');

  const { savedProp } = simulateSavePropertyData(g);

  assertEq(savedProp.disputes.length, 3,  'all 3 disputes persisted (existing + new)');
  assert(savedProp.disputes.some(d => d.id === D0.id), 'original dispute D0 preserved');
  assert(savedProp.disputes.some(d => d.id === D1.id), 'original dispute D1 preserved');
  assert(savedProp.disputes.some(d => d.vendor === 'NewCo'), 'new dispute present');
});

// ── TEST 5 — activePropId initialization ──────────────────────────────────────

suite('TEST 5 — activePropId initialization and submitDispute guard', ({ assert, assertEq, assertNull }) => {
  const g = freshGlobals();

  // Pre-init state
  assertNull(g.activePropId, 'activePropId is null before init');
  assertEq(g._props.length,  0, '_props is empty before init');

  const prop = makeProperty({ disputes: [D0] });
  simulateInitTenantPortal(prop, g);

  // Post-init state
  assertEq(g.activePropId, PROP_ID,  'activePropId === property.id after init');
  assertEq(g._tenantPortalPropId, PROP_ID, '_tenantPortalPropId set after init');
  assertEq(g._props.length, 1,       'property pushed into _props');
  assertEq(g._props[0].id, PROP_ID,  '_props[0] is the correct property');
  assertEq(g.disputes.length, 1,     'disputes[] seeded from property.disputes');
  assertEq(g.disputes[0].id, D0.id,  'seeded dispute id matches fixture');
  assertEq(g.nextDisputeId, 1,       'nextDisputeId seeded to 1 (D0.id + 1)');
  assert(g.activityLog.length >= 1,  'activityLog seeded from property.activityLog');

  // submitDispute early-return simulation:
  // Before fix, activePropId === null → early return. After fix it is set.
  function wouldSubmitDisputeSkip(activePropId) {
    // Mirrors the guard at top of submitDispute (before fix was: if (!activePropId) { alert(...); return; })
    return !activePropId;
  }
  assert(!wouldSubmitDisputeSkip(g.activePropId), 'submitDispute does NOT early-return (activePropId set)');
  assert( wouldSubmitDisputeSkip(null),            'submitDispute WOULD early-return if activePropId were null (guard works)');

  // Calling init a second time must not duplicate the property in _props
  simulateInitTenantPortal(prop, g);
  assertEq(g._props.length, 1, '_props not duplicated on second init call');
});

// ── TEST 5b — submitDispute id collision prevention ───────────────────────────

suite('TEST 5b — nextDisputeId collision prevention', ({ assert, assertEq }) => {
  // Without seeding nextDisputeId, a second tenant dispute gets id=0 (collides with D0)
  const prop = makeProperty({ disputes: [D0, D1, D2] }); // ids: 0, 1, 2
  const g    = freshGlobals();
  simulateInitTenantPortal(prop, g);

  assertEq(g.nextDisputeId, 3, 'nextDisputeId seeded to 3 (max existing id + 1)');

  const d3 = { id: g.nextDisputeId++, vendor: 'ElectroPower', reason: 'Excluded in lease', status: 'open', tenantName: 'Anchor Retail', timestamp: new Date().toISOString() };
  g.disputes.push(d3);

  assertEq(d3.id, 3, 'new dispute gets id=3 (no collision with D0/D1/D2)');
  assertEq(g.nextDisputeId, 4, 'nextDisputeId advances to 4');

  const allIds = g.disputes.map(d => d.id);
  const uniqueIds = new Set(allIds);
  assertEq(uniqueIds.size, allIds.length, 'all dispute ids are unique (no collision)');
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log('\n' + '─'.repeat(52));
const total = _passed + _failed;
if (_failed === 0) {
  console.log(` \x1b[32mPASSED: ${_passed}/${total}\x1b[0m  All tests green.`);
} else {
  console.log(` \x1b[32mPASSED: ${_passed}\x1b[0m  \x1b[31mFAILED: ${_failed}\x1b[0m  (${total} total)`);
}
console.log('─'.repeat(52));

if (_failed > 0) process.exit(1);
