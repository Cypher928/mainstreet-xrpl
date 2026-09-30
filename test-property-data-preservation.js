'use strict';
/**
 * test-property-data-preservation.js — viewing a property must not rewrite its
 * memory; the database is the record; server-owned keys survive a save.
 *
 *   node test-property-data-preservation.js
 *
 * Offline. Three rules, proved against the REAL functions extracted from
 * script.js by name and run in a sandbox with recording fakes:
 *
 *   P4 PRESERVATION  server-owned keys in properties.data (acquiredFrom,
 *      _p3Backfill, an invoice's sourceEpisodeId / acquiredAt) survive an
 *      ordinary save; client-owned keys are still the client's.
 *   P5-0 DATABASE WINS  loadPropertyData takes the database as the base; the
 *      localStorage copy adds tenants/invoices only when it is flagged
 *      _unsynced (its write to Supabase failed), and only rows the database
 *      does not have.
 *   P5-1 SAVE ONLY WHEN DIRTY  opening, hydrating, normalising, minting
 *      invoice ids and navigating away write NOTHING; an edit (savePropertyData
 *      or a direct saveProperty) writes exactly what it always wrote.
 *
 *   A  the Maple path: open → hydrate → renderProperty → ensureInvoiceIds →
 *      no save; the first explicit edit carries the provenance
 *   B  the sixteen client-owned keys behave exactly as before
 *   C  _stripBlobs keeps the two invoice stamps, drops what it always dropped
 *   D  structure: constant == save literal; spread first; merge base is the
 *      database; the flushes are dirty-guarded; property-os no longer saves
 *   E  merge: unflagged local copy adds nothing; flagged copy adds only what
 *      the database lacks; offline uses the local copy; the flag lifecycle
 *   F  dirty-only navigation: open/leave/back/reopen write nothing; an edit
 *      writes once; a failed edit-save is retried on leave
 *   G  legacy blobs (no _serverOwned, no _schemaVersion, numeric invoice ids)
 *      load and do not save on open
 *   H  the helper's contract
 */

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');
const { fnSource } = require('./test-support/fn-source.js');

let pass = 0, fail = 0;
const failures = [];
function t(name, cond, detail) {
  if (cond) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  else { fail++; failures.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail !== undefined ? '  — ' + detail : ''}`); }
}
const eq  = (a, b, name) => t(name, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
const sec = (s) => console.log(`\n── ${s} ──`);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const ROOT   = __dirname;
const SCRIPT = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');
const POS    = fs.readFileSync(path.join(ROOT, 'property-os.js'), 'utf8');
const TN     = fs.readFileSync(path.join(ROOT, 'tenant-normalize.js'), 'utf8');

const CONST_KEYS   = (SCRIPT.match(/const PROPERTY_DATA_CLIENT_KEYS = Object\.freeze\(\[[\s\S]*?\]\);\n/) || [''])[0];
const CONST_SCHEMA = (SCRIPT.match(/const STATE_SCHEMA_VERSION = \d+;\n/) || [''])[0];
// Step A-1: loadPropertyData reads tenants rows through these shared columns and helpers.
const CONST_TENANT_ROWS = SCRIPT.slice(SCRIPT.indexOf('const TENANT_ROW_COLUMNS_PRE_037'), SCRIPT.indexOf('function _isLifecycleColumnMissing('));
const posLifted = POS.replace(/\n  function (ensureInvoiceIds|_isLegacyIndexKey)\(/g, '\nfunction $1(');
const ENSURE_IDS = fnSource(posLifted, 'ensureInvoiceIds') + '\n' + fnSource(posLifted, '_isLegacyIndexKey') + '\n';
// The one line of PropertyOS.renderPropertyPage that touches data on this path,
// taken from the source so a change there is a change here.
const POS_HOOK = (POS.match(/\n(\s*try \{[^\n]*ensureInvoiceIds\(property\)[^\n]*\n)/) || ['', ''])[1];

const REAL = [
  '_serverOwnedDataKeys', '_stripBlobs', 'saveProperty', 'savePropertyData', 'loadPropertyData',
  'normalizePropertyState', '_isUsableRecordId', 'mintTenantIdentity', '_lsSave', '_lsLoad', '_lsMarkUnsynced',
  'selectProperty', 'backToPortfolio', 'appendPropertyTimelineEvent', 'appendPropertyTimelineEventOnce', '_appendSyncRestored',
  '_isLifecycleColumnMissing', '_tenantRowToRecord', '_overlayLeaseholdLifecycle',
  '_mergeHeldLeaseUploads', '_heldUploadSettled',
].map(n => fnSource(SCRIPT, n)).join('\n') + '\nconst _resolvedHeldUploads = new Set();\n';

const U = '011df998-bad2-464e-bbcb-28e2d0fee821';
const P = '3dc8a7b8-170c-4a51-b90d-dde831c56ca9';
const Q = '11111111-2222-4333-8444-555555555555';
const R = '59af3e99-82dc-4a97-813b-21e4f956aca8';
const F1 = 'd1fb1d5a-aea0-4305-ad8e-82b14e9fee17', F2 = 'ae6f43fd-eb1e-469f-928e-0caa706914a7';

function rpcBlob() {
  return {
    _p3Backfill: { at: '2026-09-27T03:27:53.560Z', from: 'aca00000-0000-4000-b000-000000000000' },
    acquiredFrom: { reviewId: R, acquiredAt: '2026-09-27T13:40:41.213Z', source: 'acquire_property' },
    invoices: [
      { amount: 3200, category: 'landscaping', fileName: 'inv1.pdf', vendorName: 'GreenScape', invoiceDate: '2024-01-15', sourceEpisodeId: R, acquiredAt: '2026-09-27T13:40:41.213Z' },
      { amount: 6000, category: 'insurance',   fileName: 'abc.pdf',  vendorName: 'ABC Insurance', invoiceDate: '2026-01-01', sourceEpisodeId: R, acquiredAt: '2026-09-27T13:40:41.213Z' },
    ],
    tenants: [
      { id: F1, tenant_name: 'Luxe Nails', leased_sqft: '3000', cap: '5', end_date: '2031-07-07', _fromAcquisition: true, _leaseholdId: F1 },
      { id: F2, tenant_name: 'Maple Coffee Co.', leased_sqft: '3000', cap: '5', start_date: '2024-03-01', _fromAcquisition: true, _leaseholdId: F2 },
    ],
    camYear: 2025,
    settlement: { txHash: null, amountUsd: 12.5 },
    info: { yearBuilt: 1998 },
  };
}

/**
 * A world: the real functions, the real tenant normaliser, the real
 * ensureInvoiceIds and the real PropertyOS hook line, recording fakes for the
 * rest. `store` is the database; `ls` the browser's localStorage.
 */
function world(opts) {
  const o = opts || {};
  const rec = { upserts: [], selects: 0, renders: 0, errors: [], failNext: o.failNext || 0 };
  const store = { properties: (o.rows || (o.row ? [o.row] : [])).map(r => JSON.parse(JSON.stringify(r))) };
  const ls = new Map();
  if (o.ls) ls.set('_ms_props_v2_' + U, JSON.stringify(o.ls));
  const offline = !!o.offline;
  function q(table) {
    const f = {};
    const b = {
      select: () => b, eq: (k, v) => { f[k] = v; return b; }, in: () => b, order: () => b, is: () => b, not: () => b,
      single: async () => {
        rec.selects++;
        if (offline) throw new Error('Failed to fetch');
        const rows = (store[table] || []).filter(r => Object.keys(f).every(k => r[k] === f[k]));
        // a row crosses the wire as JSON: the client never holds the database's own objects
        return rows.length ? { data: JSON.parse(JSON.stringify(rows[0])), error: null } : { data: null, error: { code: 'PGRST116', message: 'no rows' } };
      },
      upsert: (row) => ({ select: async () => {
        if (offline) throw new Error('Failed to fetch');
        if (rec.failNext > 0) { rec.failNext--; return { data: null, error: { code: '57014', message: 'injected upsert failure' } }; }
        rec.upserts.push(JSON.parse(JSON.stringify(row)));
        const i = (store[table] || []).findIndex(r => r.id === row.id);
        if (i >= 0) Object.assign(store[table][i], JSON.parse(JSON.stringify(row))); else (store[table] = store[table] || []).push(JSON.parse(JSON.stringify(row)));
        return { data: [{ id: row.id }], error: null };
      } }),
      then: (res) => Promise.resolve({ data: (store[table] || []).filter(r => Object.keys(f).every(k => r[k] === f[k])), error: null }).then(res),
    };
    return b;
  }
  const prefix = `
    let activePropId = null; let _saveDebounceTimer = null; let _saveGeneration = 0; const _snapshots = {};
    let _activeWorkspaceTab = 'overview'; let _props = ${JSON.stringify(o.props || [])}; const portfolio = []; let _acqReviews = [];
    const tenantData = [null, null, null]; const invoiceData = []; const disputes = []; const activityLog = []; const camRuns = [];
    let lastResults = [], lastInvoices = [], lastTenants = [], lastPropName = '', lastTotal = 0, lastInvoicesFull = [];
    const DEMO_PROPERTY_ID = null, NORTHGATE_PROPERTY_ID = null;
    ${CONST_SCHEMA}${CONST_KEYS}${CONST_TENANT_ROWS}
    function normalizeTenant(d) { return window.TenantNormalize.normalizeTenant(d); }
    function resetWorkflow() { clearTimeout(_saveDebounceTimer); _saveDebounceTimer = null; tenantData.splice(0, tenantData.length, null, null, null); invoiceData.length = 0; activityLog.length = 0; disputes.length = 0; }
    // renderProperty, reduced to what it does to the data on this path (tenants →
    // tenantData, invoices → invoiceData) plus PropertyOS.renderPropertyPage's own
    // hook line, read from property-os.js.
    function renderProperty(property) {
      const tenants = (property.tenants || []).filter(x => x !== null);
      if (tenants.length) { property.tenants = tenants.map(normalizeTenant); tenantData.splice(0, tenantData.length, ...property.tenants); }
      const invoices = property.invoices || [];
      if (invoices.length) invoiceData.splice(0, invoiceData.length, ...invoices);
      __rec.renders++;
      ${POS_HOOK}
    }
    ${ENSURE_IDS}
    function rebuildDerivedState() {} function _openDisputes() { return []; } function renderPortfolio() {} function _renderAcqSection() {}
    function _captureSnapshot() {} function _setSyncStatus() {} function _isAuthError() { return false; } function _onAuthLost() {}
    function logError(w, e) { __rec.errors.push(w + ': ' + (e && e.message)); }
    function _refreshAdvisorSurfaces() {} function _auditDirect() {} function _obSyncState() {}
    function loadCamResults() { return Promise.resolve([]); } function _mergeCamReconciliationRows() {}
    function getCamYear() { return __camYear; } function setCamYear(y) { __camYear = y; } function _camYearKey() { return 'camYear:' + '${U}'; }
    let __camYear = 2026;
    function _lsUserKey() { return '_ms_props_v2_' + '${U}'; }
    function _lsGet(k) { return __ls.has(k) ? __ls.get(k) : null; } function _lsSet(k, v) { __ls.set(k, v); }
    ${REAL}
    this.selectProperty = selectProperty; this.backToPortfolio = backToPortfolio; this.saveProperty = saveProperty; this.savePropertyData = savePropertyData;
    this.loadPropertyData = loadPropertyData; this._stripBlobs = _stripBlobs; this._serverOwnedDataKeys = _serverOwnedDataKeys;
    this._lsSave = _lsSave; this._lsMarkUnsynced = _lsMarkUnsynced; this.PROPERTY_DATA_CLIENT_KEYS = PROPERTY_DATA_CLIENT_KEYS;
    this.state = () => ({ activePropId, props: _props, tenantData, invoiceData, timer: _saveDebounceTimer });
    this.setActive = (id) => { activePropId = id; };
  `;
  const sandbox = {
    __rec: rec, __ls: ls,
    window: { LeaseholdStatus: require('./leasehold-status.js'), ms_useNormalizedEvidence: false, ms_useNormalizedAudit: false, TimelineMerge: undefined, scrollTo() {} },
    localStorage: { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, v), removeItem: (k) => ls.delete(k) },
    document: { getElementById: () => ({ value: '', style: {}, textContent: '', innerHTML: '', remove() {}, classList: { remove() {}, add() {} } }), createElement: () => ({ style: {}, remove() {} }), body: { appendChild() {}, classList: { remove() {}, add() {} } }, activeElement: null, querySelector: () => null },
    db: { auth: { getUser: async () => ({ data: { user: { id: U } } }) }, from: (table) => q(table) },
    console: { log() {}, warn() {}, error() {}, groupCollapsed() {}, groupEnd() {} },
    setTimeout, clearTimeout, Promise, Error, Array, Object, String, Number, JSON, RegExp, Date, Map, Set, Math, isNaN, parseInt, parseFloat, Symbol,
  };
  vm.createContext(sandbox);
  vm.runInContext(TN, sandbox);
  vm.runInContext(prefix, sandbox);
  return { sb: sandbox, rec, store, ls };
}

const listRow = (id, name) => ({ id: id || P, name: name || 'Maple plaza', totalSqft: 77500, lifecycle_stage: 'acquired',
  tenants: [{ id: F1, tenant_name: 'Luxe Nails', leased_sqft: 3000 }, { id: F2, tenant_name: 'Maple Coffee Co.', leased_sqft: 3000 }] });
const dbRow = (blob, id, name) => ({ id: id || P, user_id: U, name: name || 'Maple plaza', sqft: 77500, data: blob || rpcBlob() });
const KEYS = ['invoices', 'disputes', 'camYear', 'results', 'camReconciliation', 'camRefusal', 'settlement', 'aiDrafts', '_demoVersion', '_demoV', 'activityLog', 'timeline', 'tenants', 'escrowReserves', 'drawRequests', 'info', 'pendingLeaseUploads'];
const WIRE = KEYS.filter(k => k !== '_demoVersion' && k !== '_demoV');
const open = async (W, id) => { await W.sb.selectProperty(id || P); await sleep(1300); };

(async () => {
  // ── A ────────────────────────────────────────────────────────────────────
  sec('A  the Maple path: opening writes nothing; the first edit carries the provenance');
  const A = world({ row: dbRow(), props: [listRow()] });
  await open(A);
  t('A1 opening the property (load, normalise, ensureInvoiceIds minting ids) triggered ZERO upserts', A.rec.upserts.length === 0 && A.rec.renders >= 2, JSON.stringify({ n: A.rec.upserts.length, renders: A.rec.renders, errors: A.rec.errors }));
  t('A2 the ids were minted IN MEMORY (every invoice on the live record has one) and the database row is untouched',
    A.sb.state().invoiceData.length === 2 && A.sb.state().invoiceData.every(i => /^inv-[a-z0-9]+-\d$/.test(i.id)) && A.store.properties[0].data.invoices.every(i => i.id === undefined));
  // an explicit edit: the ordinary path every field edit takes
  A.sb.savePropertyData();
  await sleep(1100);
  t('A3 the first explicit edit wrote exactly one upsert', A.rec.upserts.length === 1 && A.rec.upserts[0].id === P, String(A.rec.upserts.length));
  const d = A.rec.upserts[0] ? A.rec.upserts[0].data : {};
  eq(d.acquiredFrom, rpcBlob().acquiredFrom, 'A4 data.acquiredFrom is written back exactly as the database held it');
  eq(d._p3Backfill, rpcBlob()._p3Backfill, 'A5 data._p3Backfill (034\'s marker) is written back exactly');
  t('A6 every invoice keeps sourceEpisodeId and acquiredAt and carries its minted id', Array.isArray(d.invoices) && d.invoices.length === 2 && d.invoices.every(i => i.sourceEpisodeId === R && i.acquiredAt === '2026-09-27T13:40:41.213Z' && /^inv-/.test(i.id)), JSON.stringify(d.invoices));
  t('A7 the same property, the same tenants: two tenant rows keyed by the leasehold ids', d.tenants.length === 2 && d.tenants.map(x => x.id).sort().join() === [F1, F2].sort().join());

  // ── B ────────────────────────────────────────────────────────────────────
  sec('B  the client-owned keys behave exactly as before');
  t('B1 the payload names every client-owned key that has a value (all but the two demo markers, undefined on a real property)', WIRE.every(k => Object.prototype.hasOwnProperty.call(d, k)) && !('_demoVersion' in d) && !('_demoV' in d), Object.keys(d).join());
  t('B2 client values come from the live record: camYear adopted from the property (2025), settlement and info carried, timeline is the client\'s (sync_restored), tenants normalised, results/cam null',
    d.camYear === 2025 && d.settlement && d.settlement.amountUsd === 12.5 && d.info && d.info.yearBuilt === 1998 && d.timeline.length === 1 && d.timeline[0].type === 'sync_restored'
    && d.tenants.every(x => Object.prototype.hasOwnProperty.call(x, 'reviewOverrides')) && d.results === null && d.camReconciliation === null && d.camRefusal === null,
    JSON.stringify({ camYear: d.camYear, settlement: d.settlement, info: d.info, tl: d.timeline.length }));
  const B = world({ row: dbRow(), props: [listRow()] });
  const prop = { id: P, name: 'Maple plaza', totalSqft: 77500, camYear: 2026, invoices: [{ id: 'inv-x', vendorName: 'V', amount: 1 }], tenants: [], timeline: [],
    _serverOwned: { camYear: 1999, invoices: 'smuggled', tenants: 'smuggled', timeline: 'smuggled', acquiredFrom: { reviewId: R } } };
  await B.sb.saveProperty(prop);
  const bd = B.rec.upserts[0].data;
  t('B3 a client key inside _serverOwned never wins; the genuine server key still travels', bd.camYear === 2026 && bd.invoices[0].id === 'inv-x' && Array.isArray(bd.tenants) && Array.isArray(bd.timeline) && bd.acquiredFrom.reviewId === R, JSON.stringify(bd));
  t('B4 the payload shape is unchanged for the row: {id, name, sqft, data, user_id}', Object.keys(B.rec.upserts[0]).sort().join() === ['data', 'id', 'name', 'sqft', 'user_id'].join(), Object.keys(B.rec.upserts[0]).join());
  const B2 = world({ row: dbRow(), props: [listRow()] });
  await B2.sb.saveProperty({ id: P, name: 'Maple plaza', totalSqft: 77500, tenants: [], invoices: [] });
  t('B5 with no _serverOwned on the record nothing is invented: the client-owned keys and no other', Object.keys(B2.rec.upserts[0].data).sort().join() === WIRE.slice().sort().join(), Object.keys(B2.rec.upserts[0].data).join());
  t('B6 a direct saveProperty (the sqft path) still writes at once, and marks the record clean', B2.rec.upserts.length === 1 && B2.sb.state().timer === null);

  // ── C ────────────────────────────────────────────────────────────────────
  sec('C  _stripBlobs');
  const C = world({});
  const s = C.sb._stripBlobs({ id: P, tenants: [{ id: F1, tenant_name: 'X', rawText: 'big', leaseFile: {} }],
    invoices: [{ id: 'i1', vendorName: 'V', amount: 2, category: 'c', invoiceDate: '2026-01-01', fileName: 'f', sourceEpisodeId: R, acquiredAt: 'T', _error: 'e', rawText: 'r', matchAmbiguous: false }] });
  t('C1 an invoice keeps sourceEpisodeId and acquiredAt', s.invoices[0].sourceEpisodeId === R && s.invoices[0].acquiredAt === 'T');
  t('C2 and still drops _error and rawText while keeping id, vendor, amount, category, date, file, match flags', !('_error' in s.invoices[0]) && !('rawText' in s.invoices[0]) && s.invoices[0].id === 'i1' && s.invoices[0].vendorName === 'V' && s.invoices[0].matchAmbiguous === false);
  t('C3 tenants still lose rawText and leaseFile', s.tenants[0].rawText === undefined && s.tenants[0].leaseFile === undefined && s.tenants[0].tenant_name === 'X');
  t('C4 an invoice without the stamps: the keys are present as undefined, never invented', (() => { const u = C.sb._stripBlobs({ tenants: [], invoices: [{ id: 'i2', amount: 1 }] }).invoices[0]; return u.sourceEpisodeId === undefined && u.acquiredAt === undefined; })());

  // ── D ────────────────────────────────────────────────────────────────────
  sec('D  structure');
  const saveSrc = fnSource(SCRIPT, 'saveProperty');
  const lit = saveSrc.slice(saveSrc.indexOf('const data = {'), saveSrc.indexOf('\n    };', saveSrc.indexOf('const data = {')));
  const litKeys = Array.from(lit.matchAll(/\n\s{6}([A-Za-z_]\w*):\s/g)).map(m => m[1]);
  const spreadAt = lit.indexOf('..._serverOwnedDataKeys(stripped._serverOwned)');
  t('D1 the save literal spreads the server-owned keys BEFORE its first client-owned key', spreadAt !== -1 && spreadAt < lit.indexOf('invoices:'), String(spreadAt));
  eq(litKeys.slice().sort(), Array.from(C.sb.PROPERTY_DATA_CLIENT_KEYS).slice().sort(), 'D2 PROPERTY_DATA_CLIENT_KEYS names exactly the keys the save literal writes');
  const loadSrc = fnSource(SCRIPT, 'loadPropertyData');
  t('D3 loadPropertyData projects _serverOwned from the raw blob and takes it from the database side only', /_serverOwned:\s+_serverOwnedDataKeys\(d\)/.test(loadSrc) && /_serverOwned:\s+_serverOwnedDataKeys\(dbData\._serverOwned\)/.test(loadSrc));
  t('D4 P5-0: the merge base is the database, and the local copy is consulted only when flagged _unsynced', /const base = dbData;/.test(loadSrc) && /lsData\._unsynced === true/.test(loadSrc) && !/lsCount > dbCount \? lsData : dbData/.test(loadSrc));
  t('D5 P5-1: PropertyOS.renderPropertyPage mints ids and no longer calls savePropertyData for it', /ensureInvoiceIds\(property\)/.test(POS_HOOK) && !/savePropertyData/.test(POS_HOOK) && /inv\.id = 'inv-' \+ Math\.random\(\)/.test(ENSURE_IDS), POS_HOOK);
  t('D6 P5-1: the leaving flush and backToPortfolio are guarded by a pending debounce or a dirty record',
    /leavingProp && \(_saveDebounceTimer \|\| leavingProp\._dirty === true\)/.test(fnSource(SCRIPT, 'selectProperty')) && /if \(_saveDebounceTimer \|\| prop\._dirty === true\)/.test(fnSource(SCRIPT, 'backToPortfolio')));
  t('D7 P5-1: savePropertyData marks dirty; saveProperty clears it on success and flags the local copy unsynced on failure',
    /prop\._dirty = true;/.test(fnSource(SCRIPT, 'savePropertyData')) && /property\._dirty = false;/.test(saveSrc) && /_lsMarkUnsynced\(id, false\)/.test(saveSrc) && /_lsMarkUnsynced\(property\?\.id, true\)/.test(saveSrc));
  t('D8 selectProperty carries _serverOwned onto the live record and never marks it dirty', /property\._serverOwned = data\._serverOwned/.test(fnSource(SCRIPT, 'selectProperty')) && !/_dirty = true/.test(fnSource(SCRIPT, 'selectProperty')));

  // ── E ────────────────────────────────────────────────────────────────────
  sec('E  local/database merge (P5-0)');
  const richLocal = { [P]: { id: P, name: 'Maple plaza', totalSqft: 77500,
    tenants: [{ id: F1, tenant_name: 'Luxe Nails' }, { id: F2, tenant_name: 'Maple Coffee Co.' }, { id: 'f3-stale', tenant_name: 'Ghost Tenant' }],
    invoices: [{ id: 'inv-stale', vendorName: 'Stale Co', amount: 1 }], timeline: [], _serverOwned: { _p3Backfill: { at: 'old' }, ghost: 'stale' } } };
  const E1 = world({ row: dbRow(), props: [listRow()], ls: richLocal });
  await open(E1);
  E1.sb.savePropertyData(); await sleep(1100);
  const e1 = E1.rec.upserts[0] ? E1.rec.upserts[0].data : {};
  t('E1 an UNFLAGGED local copy with more tenants and its own invoices contributes NOTHING: the database\'s 2 tenants, 2 invoices, its server keys; no ghost',
    E1.rec.upserts.length === 1 && e1.tenants.length === 2 && !e1.tenants.some(x => x.id === 'f3-stale') && e1.invoices.length === 2 && !e1.invoices.some(i => i.id === 'inv-stale')
    && e1.acquiredFrom && e1.acquiredFrom.reviewId === R && e1._p3Backfill.at === '2026-09-27T03:27:53.560Z' && !('ghost' in e1),
    JSON.stringify({ n: E1.rec.upserts.length, tenants: (e1.tenants || []).map(x => x.id), inv: (e1.invoices || []).map(i => i.id), g: e1.ghost }));
  const flagged = JSON.parse(JSON.stringify(richLocal)); flagged[P]._unsynced = true;
  flagged[P].invoices.push({ vendorName: 'GreenScape', amount: 3200, invoiceDate: '2024-01-15', fileName: 'inv1.pdf' }); // already in the database, no id
  const E2 = world({ row: dbRow(), props: [listRow()], ls: flagged });
  await open(E2);
  E2.sb.savePropertyData(); await sleep(1100);
  const e2 = E2.rec.upserts[0] ? E2.rec.upserts[0].data : {};
  t('E2 a FLAGGED local copy (its write failed) adds only what the database lacks: the third tenant and the one unknown invoice; the duplicate invoice (same vendor/amount/date/file, no id) is not doubled; server keys stay the database\'s',
    e2.tenants.length === 3 && e2.tenants.some(x => x.id === 'f3-stale') && e2.invoices.length === 3 && e2.invoices.filter(i => i.vendorName === 'GreenScape').length === 1 && e2.invoices.some(i => i.id === 'inv-stale') && !('ghost' in e2),
    JSON.stringify({ tenants: (e2.tenants || []).map(x => x.id), inv: (e2.invoices || []).map(i => i.id || i.vendorName) }));
  const E3 = world({ props: [listRow()], ls: { [P]: Object.assign({}, richLocal[P], { _serverOwned: { acquiredFrom: { reviewId: R } } }) }, offline: true });
  await open(E3);
  t('E3 offline (no database answer) the local copy is what the record carries, and nothing is saved', E3.sb.state().props[0]._serverOwned && E3.sb.state().props[0]._serverOwned.acquiredFrom.reviewId === R && E3.sb.state().props[0].tenants.length === 3 && E3.rec.upserts.length === 0);
  t('E4 _lsSave writes the server-owned bag into the local copy', (() => { const W = world({}); W.sb._lsSave({ id: P, tenants: [], _serverOwned: { acquiredFrom: { reviewId: R } } }); return JSON.parse(W.ls.get('_ms_props_v2_' + U))[P]._serverOwned.acquiredFrom.reviewId === R; })());
  // the flag lifecycle
  const E5 = world({ row: dbRow(), props: [listRow()], failNext: 1 });
  await E5.sb.saveProperty({ id: P, name: 'Maple plaza', totalSqft: 77500, tenants: [{ id: 'new-t', tenant_name: 'Unsynced Co' }], invoices: [] });
  const lsAfterFail = JSON.parse(E5.ls.get('_ms_props_v2_' + U))[P];
  t('E5 a failed write flags the local copy _unsynced (and the local copy holds the edit)', lsAfterFail._unsynced === true && lsAfterFail.tenants[0].id === 'new-t' && E5.rec.upserts.length === 0, JSON.stringify({ f: lsAfterFail._unsynced, n: E5.rec.upserts.length }));
  await E5.sb.saveProperty({ id: P, name: 'Maple plaza', totalSqft: 77500, tenants: [{ id: 'new-t', tenant_name: 'Unsynced Co' }], invoices: [] });
  t('E6 the next successful write clears the flag', !('_unsynced' in JSON.parse(E5.ls.get('_ms_props_v2_' + U))[P]) && E5.rec.upserts.length === 1);
  t('E7 the flag lives on the stored record, never on the wire', !('_unsynced' in E5.rec.upserts[0].data) && !('_unsynced' in E5.rec.upserts[0]));

  // ── F ────────────────────────────────────────────────────────────────────
  sec('F  viewing writes nothing; editing writes once (P5-1)');
  const two = () => world({ rows: [dbRow(), dbRow(rpcBlob(), Q, 'Other Plaza')], props: [listRow(), listRow(Q, 'Other Plaza')] });
  const F = two();
  await open(F);
  t('F1 open → wait past the debounce → ZERO upserts', F.rec.upserts.length === 0, String(F.rec.upserts.length));
  await F.sb.selectProperty(Q); await sleep(1300);
  t('F2 leave for another property with no edit → the leaving flush writes NOTHING (and the second property\'s open writes nothing either)', F.rec.upserts.length === 0 && F.sb.state().activePropId === Q, String(F.rec.upserts.length));
  await F.sb.backToPortfolio(); await sleep(300);
  t('F3 back to the portfolio with no edit → NOTHING written', F.rec.upserts.length === 0 && F.sb.state().activePropId === null, String(F.rec.upserts.length));
  await open(F);
  t('F4 reopen → still nothing written; the in-memory tenants and invoices are the database\'s', F.rec.upserts.length === 0 && F.sb.state().tenantData.filter(Boolean).length === 2 && F.sb.state().invoiceData.length === 2 && F.store.properties[0].data.acquiredFrom.reviewId === R, String(F.rec.upserts.length));
  // an edit
  F.sb.state().tenantData[0].cap = 7;
  F.sb.savePropertyData(); await sleep(1100);
  t('F5 a tenant edit through savePropertyData → exactly ONE upsert, carrying the edit and the provenance', F.rec.upserts.length === 1 && F.rec.upserts[0].data.tenants[0].cap === 7 && F.rec.upserts[0].data.acquiredFrom.reviewId === R, JSON.stringify({ n: F.rec.upserts.length, cap: F.rec.upserts[0] && F.rec.upserts[0].data.tenants[0].cap }));
  await F.sb.selectProperty(Q); await sleep(1300);
  t('F6 leaving after the save completed writes no second identical copy (the record was marked clean)', F.rec.upserts.length === 1, String(F.rec.upserts.length));
  // a pending debounce IS flushed on leave — today's data-safety intent, kept
  const F7 = two();
  await open(F7);
  F7.sb.savePropertyData();                 // arms the 800 ms debounce
  await F7.sb.selectProperty(Q); await sleep(1300);
  t('F7 an edit still inside its debounce when the person leaves is flushed exactly once', F7.rec.upserts.length === 1 && F7.rec.upserts[0].id === P, String(F7.rec.upserts.length));
  // a failed edit-save stays dirty and is retried on leave
  const F8 = two(); F8.rec.failNext = 1;
  await open(F8);
  F8.sb.savePropertyData(); await sleep(1100);   // the debounced write fails
  t('F8 a failed edit-save leaves the record dirty and the local copy flagged', F8.rec.upserts.length === 0 && F8.sb.state().props[0]._dirty === true && JSON.parse(F8.ls.get('_ms_props_v2_' + U))[P]._unsynced === true);
  await F8.sb.selectProperty(Q); await sleep(1300);
  t('F9 …so leaving retries it: one upsert, and the flag is cleared', F8.rec.upserts.length === 1 && F8.rec.upserts[0].id === P && !('_unsynced' in JSON.parse(F8.ls.get('_ms_props_v2_' + U))[P]), String(F8.rec.upserts.length));

  // ── G ────────────────────────────────────────────────────────────────────
  sec('G  legacy blobs');
  const legacyBlob = { invoices: [{ id: 0, vendorName: 'Old Co', amount: 100, category: 'other' }, { id: '1', vendorName: 'Older Co', amount: 50, category: 'other' }],
    // the blob and the tenants table agree on the roster, as a real legacy row's do
    // (selectProperty's pre-existing "at least as rich" guard applies the loaded
    // tenants/invoices only when the load has at least as many tenants as the
    // in-memory list row — untouched by P5-0/P5-1)
    tenants: [{ id: F1, tenant_name: 'Luxe Nails', leased_sqft: '3000' }, { id: F2, tenant_name: 'Maple Coffee Co.', leased_sqft: '3000' }],
    results: null, camReconciliation: null, timeline: [{ id: 'tl-1', type: 'lease_uploaded', timestamp: '2026-01-01T00:00:00Z', title: 'Lease uploaded' }] };
  const G = world({ row: dbRow(legacyBlob), props: [listRow()] });
  await open(G);
  t('G1 a pre-P4 blob (no _serverOwned, no _schemaVersion, numeric legacy invoice ids) opens without error and without a save', G.rec.upserts.length === 0 && G.rec.errors.length === 0 && G.sb.state().invoiceData.length === 2, JSON.stringify({ n: G.rec.upserts.length, errors: G.rec.errors }));
  t('G2 its legacy ids were re-minted in memory only; the stored row still says 0 and "1"', G.sb.state().invoiceData.every(i => /^inv-/.test(String(i.id))) && G.store.properties[0].data.invoices[0].id === 0 && G.store.properties[0].data.invoices[1].id === '1');
  G.sb.savePropertyData(); await sleep(1100);
  t('G3 its first edit writes the client-owned keys only (nothing server-owned was there to carry) and keeps the timeline it loaded plus the sync marker', G.rec.upserts.length === 1 && Object.keys(G.rec.upserts[0].data).sort().join() === WIRE.slice().sort().join() && G.rec.upserts[0].data.timeline.length === 2, Object.keys(G.rec.upserts[0].data).join());

  // ── H ────────────────────────────────────────────────────────────────────
  sec('H  the helper');
  const H = world({});
  eq(H.sb._serverOwnedDataKeys({ acquiredFrom: 1, invoices: [], camYear: 2, _p3Backfill: 3, info: {}, tenants: [] }), { acquiredFrom: 1, _p3Backfill: 3 }, 'H1 keeps every key the client does not own and nothing the client owns');
  eq(H.sb._serverOwnedDataKeys(null), {}, 'H2 null → {}');
  eq(H.sb._serverOwnedDataKeys([1, 2]), {}, 'H3 an array → {}');
  eq(H.sb._serverOwnedDataKeys('x'), {}, 'H4 a string → {}');
  eq(H.sb._serverOwnedDataKeys({}), {}, 'H5 an empty blob → {}');

  // ── P ────────────────────────────────────────────────────────────────────
  sec('P  held lease uploads (Step A-2) travel with the property, never as tenants');
  {
    const HELD = { id: 'held-1', jobId: 'held-1', propertyId: P, documentId: 'aaaaaaaa-2222-4333-8444-555555555555', fileName: 'amend.pdf',
      extracted: { id: 'held-1', tenant_name: 'Luxe Nails', cap: '6' }, candidates: [{ id: F1, basis: 'name' }], vacancies: [], decision: null };
    const W = world({ row: dbRow(Object.assign(rpcBlob(), { pendingLeaseUploads: [HELD] })), props: [listRow()] });
    await open(W);
    const live = W.sb.state().props[0];
    t('P1 opening the property brings its held upload back onto the record', Array.isArray(live.pendingLeaseUploads) && live.pendingLeaseUploads.length === 1 && live.pendingLeaseUploads[0].documentId === HELD.documentId,
      JSON.stringify(live.pendingLeaseUploads));
    t('P2 …and it is not a tenant: not in the roster, not in the live buffer', !(live.tenants || []).some(x => x && x.id === 'held-1') && !W.sb.state().tenantData.some(x => x && x.id === 'held-1'));
    W.sb.savePropertyData(); await sleep(1100);
    const wd = W.rec.upserts[0] ? W.rec.upserts[0].data : {};
    t('P3 the next save writes it back under pendingLeaseUploads, and tenants still without it',
      Array.isArray(wd.pendingLeaseUploads) && wd.pendingLeaseUploads.length === 1 && wd.pendingLeaseUploads[0].id === 'held-1' && !wd.tenants.some(x => x.id === 'held-1'), JSON.stringify(wd.pendingLeaseUploads));
    // A local copy that never reached the database adds the held uploads the database does not have.
    const lsBlob = { [P]: Object.assign({ id: P, name: 'Maple plaza' }, rpcBlob(), { pendingLeaseUploads: [HELD, Object.assign({}, HELD, { id: 'held-2' })], _unsynced: true }) };
    const W2 = world({ row: dbRow(Object.assign(rpcBlob(), { pendingLeaseUploads: [HELD] })), props: [listRow()], ls: lsBlob });
    const merged = await W2.sb.loadPropertyData(P);
    t('P4 an unsynced local copy contributes its held upload the database lacks — by id, once', merged && merged.pendingLeaseUploads.map(h => h.id).sort().join() === 'held-1,held-2', JSON.stringify(merged && merged.pendingLeaseUploads));
    const W3 = world({ row: dbRow(Object.assign(rpcBlob(), { pendingLeaseUploads: [HELD] })), props: [listRow()], ls: { [P]: Object.assign({}, lsBlob[P], { _unsynced: undefined }) } });
    const m3 = await W3.sb.loadPropertyData(P);
    t('P5 …a synced local copy contributes nothing', m3 && m3.pendingLeaseUploads.map(h => h.id).join() === 'held-1', JSON.stringify(m3 && m3.pendingLeaseUploads));
  }

  console.log(`\n${'─'.repeat(58)}\nRESULT: ${pass} passed, ${fail} failed`);
  if (fail) { console.log('FAILED:'); failures.forEach(f => console.log('  - ' + f)); process.exit(1); }
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(2); });
