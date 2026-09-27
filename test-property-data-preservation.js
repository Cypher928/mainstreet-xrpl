'use strict';
/**
 * test-property-data-preservation.js — server-owned keys in properties.data
 * survive an ordinary property save.
 *
 *   node test-property-data-preservation.js
 *
 * Offline. THE BUG (Maple plaza, 2026-09-27): acquire_property (migration 035)
 * wrote data.acquiredFrom and stamped the carried invoices with sourceEpisodeId
 * and acquiredAt; on first open, PropertyOS.ensureInvoiceIds minted ids and
 * called savePropertyData, and the debounced saveProperty rebuilt the column
 * from a fixed key list — the provenance was gone 17 seconds after it was
 * written. THE RULE NOW: loadPropertyData keeps every top-level key the client
 * does not own under `_serverOwned`; saveProperty writes those back FIRST and
 * the client-owned keys after, so the client still wins on its own keys and the
 * server's keys are carried, never interpreted.
 *
 * Proved against the REAL functions, extracted from script.js by name and run
 * in a sandbox with recording fakes:
 *
 *   A  the exact Maple path — selectProperty → loadPropertyData →
 *      renderProperty (the ensureInvoiceIds trigger, property-os.js's own
 *      function) → savePropertyData → the 800 ms debounce → saveProperty —
 *      and the upsert payload still carries acquiredFrom, _p3Backfill, every
 *      invoice's sourceEpisodeId and acquiredAt (plus the minted id)
 *   B  the sixteen client-owned keys behave exactly as before: they are
 *      written from the live record, and a server-owned bag that tries to
 *      smuggle a client key in never wins
 *   C  _stripBlobs keeps the two invoice provenance fields and still drops
 *      what it always dropped
 *   D  structure: the constant names exactly the keys the save literal writes,
 *      and the server-owned spread comes BEFORE the first client-owned key
 *   E  the local/database merge: server-owned keys come from the database, a
 *      stale local copy cannot resurrect or invent one; offline, the local
 *      copy's own bag is what travels
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

// ── The pieces of script.js under test, by name ────────────────────────────
const CONST_KEYS = (SCRIPT.match(/const PROPERTY_DATA_CLIENT_KEYS = Object\.freeze\(\[[\s\S]*?\]\);\n/) || [''])[0];
const CONST_SCHEMA = (SCRIPT.match(/const STATE_SCHEMA_VERSION = \d+;\n/) || [''])[0];
// property-os.js keeps its functions inside an IIFE; lift the two we need.
const posLifted = POS.replace(/\n  function (ensureInvoiceIds|_isLegacyIndexKey)\(/g, '\nfunction $1(');
const ENSURE_IDS = fnSource(posLifted, 'ensureInvoiceIds') + '\n' + fnSource(posLifted, '_isLegacyIndexKey') + '\n';

const REAL = [
  '_serverOwnedDataKeys', '_stripBlobs', 'saveProperty', 'savePropertyData', 'loadPropertyData',
  'normalizePropertyState', '_isUsableRecordId', 'mintTenantIdentity', '_lsSave', '_lsLoad',
  'selectProperty', 'appendPropertyTimelineEvent', 'appendPropertyTimelineEventOnce', '_appendSyncRestored',
].map(n => fnSource(SCRIPT, n)).join('\n');

const U = '011df998-bad2-464e-bbcb-28e2d0fee821';
const P = '3dc8a7b8-170c-4a51-b90d-dde831c56ca9';
const R = '59af3e99-82dc-4a97-813b-21e4f956aca8';
const F1 = 'd1fb1d5a-aea0-4305-ad8e-82b14e9fee17', F2 = 'ae6f43fd-eb1e-469f-928e-0caa706914a7';

/** The blob acquire_property leaves behind: what Maple plaza's row held at 13:40:41Z. */
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
 * A world: the real functions above, the real tenant normaliser, the real
 * ensureInvoiceIds, and recording fakes for everything they touch. `store`
 * is the database row; `ls` the browser's localStorage.
 */
function world(opts) {
  const o = opts || {};
  const rec = { upserts: [], selects: 0, camReads: 0, toasts: [] };
  const store = { properties: o.row ? [o.row] : [] };
  const ls = new Map();
  if (o.ls) ls.set('ms_props_' + U, JSON.stringify(o.ls));
  const offline = !!o.offline;
  function q(table) {
    const f = {};
    const b = {
      select: () => b, eq: (k, v) => { f[k] = v; return b; }, in: () => b, order: () => b, is: () => b, not: () => b,
      single: async () => {
        rec.selects++;
        if (offline) throw new Error('Failed to fetch');
        const rows = (store[table] || []).filter(r => Object.keys(f).every(k => r[k] === f[k]));
        return rows.length ? { data: rows[0], error: null } : { data: null, error: { code: 'PGRST116', message: 'no rows' } };
      },
      upsert: (row) => ({ select: async () => {
        if (offline) throw new Error('Failed to fetch');
        rec.upserts.push(JSON.parse(JSON.stringify(row)));
        const i = (store[table] || []).findIndex(r => r.id === row.id);
        if (i >= 0) Object.assign(store[table][i], row); else (store[table] = store[table] || []).push(row);
        return { data: [{ id: row.id }], error: null };
      } }),
      then: (res) => Promise.resolve({ data: (store[table] || []).filter(r => Object.keys(f).every(k => r[k] === f[k])), error: null }).then(res),
    };
    return b;
  }
  const prefix = `
    let activePropId = null; let _saveDebounceTimer = null; let _saveGeneration = 0; const _snapshots = {};
    let _activeWorkspaceTab = 'overview'; let _props = ${JSON.stringify(o.props || [])};
    const tenantData = [null, null, null]; const invoiceData = []; const disputes = []; const activityLog = []; const camRuns = [];
    let lastResults = [], lastInvoices = [], lastTenants = [], lastPropName = '', lastTotal = 0, lastInvoicesFull = [];
    const DEMO_PROPERTY_ID = null, NORTHGATE_PROPERTY_ID = null;
    ${CONST_SCHEMA}${CONST_KEYS}
    function normalizeTenant(d) { return window.TenantNormalize.normalizeTenant(d); }
    function resetWorkflow() { clearTimeout(_saveDebounceTimer); _saveDebounceTimer = null; tenantData.splice(0, tenantData.length, null, null, null); invoiceData.length = 0; activityLog.length = 0; disputes.length = 0; }
    // renderProperty, reduced to the two things it does to the data on this path
    // (script.js renderProperty: tenants → tenantData, invoices → invoiceData) and
    // the PropertyOS hook that fired on Maple: renderPropertyPage runs
    // ensureInvoiceIds and saves when it minted an id (property-os.js PW-1).
    function renderProperty(property) {
      const tenants = (property.tenants || []).filter(x => x !== null);
      if (tenants.length) { property.tenants = tenants.map(normalizeTenant); tenantData.splice(0, tenantData.length, ...property.tenants); }
      const invoices = property.invoices || [];
      if (invoices.length) invoiceData.splice(0, invoiceData.length, ...invoices);
      __rec.renders++;
      try { if (ensureInvoiceIds(property) && savePropertyData) savePropertyData(); } catch (_) {}
    }
    ${ENSURE_IDS}
    function rebuildDerivedState() {}
    function _captureSnapshot() {} function _setSyncStatus() {} function _isAuthError() { return false; }
    function logError(w, e) { __rec.errors.push(w + ': ' + (e && e.message)); }
    function _refreshAdvisorSurfaces() {} function _auditDirect() {} function _obSyncState() {}
    function loadCamResults() { __rec.camReads++; return Promise.resolve([]); } function _mergeCamReconciliationRows() {}
    function getCamYear() { return __camYear; } function setCamYear(y) { __camYear = y; } function _camYearKey() { return 'camYear:' + '${U}'; }
    let __camYear = 2026;
    function _lsUserKey() { return 'ms_props_' + '${U}'; }
    function _lsGet(k) { return __ls.has(k) ? __ls.get(k) : null; } function _lsSet(k, v) { __ls.set(k, v); }
    ${REAL}
    this.selectProperty = selectProperty; this.saveProperty = saveProperty; this.savePropertyData = savePropertyData;
    this.loadPropertyData = loadPropertyData; this._stripBlobs = _stripBlobs; this._serverOwnedDataKeys = _serverOwnedDataKeys;
    this._lsSave = _lsSave; this.PROPERTY_DATA_CLIENT_KEYS = PROPERTY_DATA_CLIENT_KEYS;
    this.state = () => ({ activePropId, props: _props, tenantData, invoiceData, timer: _saveDebounceTimer });
  `;
  const sandbox = {
    __rec: Object.assign(rec, { renders: 0, errors: [] }), __ls: ls,
    window: { ms_useNormalizedEvidence: false, ms_useNormalizedAudit: false, TimelineMerge: undefined },
    localStorage: { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, v), removeItem: (k) => ls.delete(k) },
    document: { getElementById: () => ({ value: '', style: {}, textContent: '', innerHTML: '' }), createElement: () => ({ style: {}, remove() {} }), body: { appendChild() {} }, activeElement: null },
    db: { auth: { getUser: async () => ({ data: { user: { id: U } } }) }, from: (table) => q(table) },
    console: { log() {}, warn() {}, error() {}, groupCollapsed() {}, groupEnd() {} },
    setTimeout, clearTimeout, Promise, Error, Array, Object, String, Number, JSON, RegExp, Date, Map, Set, Math, isNaN, parseInt, parseFloat, Symbol,
  };
  vm.createContext(sandbox);
  vm.runInContext(TN, sandbox);                // window.TenantNormalize
  vm.runInContext(prefix, sandbox);
  return { sb: sandbox, rec, store, ls };
}

const listRow = () => ({ id: P, name: 'Maple plaza', totalSqft: 77500, lifecycle_stage: 'acquired',
  tenants: [{ id: F1, tenant_name: 'Luxe Nails', leased_sqft: 3000 }, { id: F2, tenant_name: 'Maple Coffee Co.', leased_sqft: 3000 }] });
const dbRow = (blob) => ({ id: P, user_id: U, name: 'Maple plaza', sqft: 77500, data: blob || rpcBlob() });

(async () => {
  // ── A ────────────────────────────────────────────────────────────────────
  sec('A  the Maple path: open → hydrate → ensureInvoiceIds → debounced save keeps the provenance');
  const A = world({ row: dbRow(), props: [listRow()] });
  await A.sb.selectProperty(P);
  await sleep(1400);                                     // setTimeout(0) load + the 800 ms debounce
  t('A1 the open triggered exactly ONE upsert of the property, and it was the ensureInvoiceIds save (every invoice now has a minted id)',
    A.rec.upserts.length === 1 && A.rec.upserts[0].id === P && A.rec.upserts[0].data.invoices.length === 2 && A.rec.upserts[0].data.invoices.every(i => /^inv-[a-z0-9]+-\d$/.test(i.id)),
    JSON.stringify({ n: A.rec.upserts.length, inv: A.rec.upserts[0] && A.rec.upserts[0].data.invoices, errors: A.rec.errors }));
  const d = A.rec.upserts[0] ? A.rec.upserts[0].data : {};
  eq(d.acquiredFrom, rpcBlob().acquiredFrom, 'A2 data.acquiredFrom is written back exactly as the database held it');
  eq(d._p3Backfill, rpcBlob()._p3Backfill, 'A3 data._p3Backfill (034\'s marker) is written back exactly');
  t('A4 every invoice keeps sourceEpisodeId and acquiredAt', Array.isArray(d.invoices) && d.invoices.length === 2 && d.invoices.every(i => i.sourceEpisodeId === R && i.acquiredAt === '2026-09-27T13:40:41.213Z'), JSON.stringify(d.invoices));
  t('A5 the row in the store now carries the provenance AND the client\'s additions (ids, the sync_restored timeline entry)',
    A.store.properties[0].data.acquiredFrom.reviewId === R && A.store.properties[0].data.timeline.some(e => e.type === 'sync_restored') && A.store.properties[0].data.invoices[0].id);
  t('A6 the same property, the same tenants: two tenant rows keyed by the leasehold ids', d.tenants.length === 2 && d.tenants.map(x => x.id).sort().join() === [F1, F2].sort().join());

  // ── B ────────────────────────────────────────────────────────────────────
  sec('B  the client-owned keys behave exactly as before');
  const KEYS = ['invoices', 'disputes', 'camYear', 'results', 'camReconciliation', 'camRefusal', 'settlement', 'aiDrafts', '_demoVersion', '_demoV', 'activityLog', 'timeline', 'tenants', 'escrowReserves', 'drawRequests', 'info'];
  // The two demo markers are `undefined` on a real property and, as before,
  // never reach the wire (JSON has no undefined) — so fourteen keys travel.
  const WIRE = KEYS.filter(k => k !== '_demoVersion' && k !== '_demoV');
  t('B1 the payload names every client-owned key that has a value (all but the two demo markers, undefined on a real property, exactly as before)', WIRE.every(k => Object.prototype.hasOwnProperty.call(d, k)) && !('_demoVersion' in d) && !('_demoV' in d), Object.keys(d).join());
  t('B2 client values come from the live record, not the blob: camYear adopted from the property (2025), settlement and info carried by their existing paths, timeline is the client\'s (with sync_restored), tenants are the normalised shape',
    d.camYear === 2025 && d.settlement && d.settlement.amountUsd === 12.5 && d.info && d.info.yearBuilt === 1998 && d.timeline.length === 1 && d.timeline[0].type === 'sync_restored'
    && d.tenants.every(x => Object.prototype.hasOwnProperty.call(x, 'reviewOverrides')) && d.results === null && d.camReconciliation === null && d.camRefusal === null,
    JSON.stringify({ camYear: d.camYear, settlement: d.settlement, info: d.info, tl: d.timeline.length, results: d.results }));
  // a server-owned bag that tries to carry client keys: the client's values still win
  const B = world({ row: dbRow(), props: [listRow()] });
  const prop = { id: P, name: 'Maple plaza', totalSqft: 77500, camYear: 2026, invoices: [{ id: 'inv-x', vendorName: 'V', amount: 1 }], tenants: [], timeline: [],
    _serverOwned: { camYear: 1999, invoices: 'smuggled', tenants: 'smuggled', timeline: 'smuggled', acquiredFrom: { reviewId: R } } };
  await B.sb.saveProperty(prop);
  const bd = B.rec.upserts[0].data;
  t('B3 a client key inside _serverOwned never wins: camYear 2026, invoices the client\'s array, tenants [], timeline [] — and the genuine server key still travels',
    bd.camYear === 2026 && Array.isArray(bd.invoices) && bd.invoices[0].id === 'inv-x' && Array.isArray(bd.tenants) && Array.isArray(bd.timeline) && bd.acquiredFrom.reviewId === R, JSON.stringify(bd));
  t('B4 the payload shape is unchanged for the row: {id, name, sqft, data, user_id}', Object.keys(B.rec.upserts[0]).sort().join() === ['data', 'id', 'name', 'sqft', 'user_id'].join(), Object.keys(B.rec.upserts[0]).join());
  // a property that was never hydrated (no _serverOwned at all) saves as before — nothing invented
  const B2 = world({ row: dbRow(), props: [listRow()] });
  await B2.sb.saveProperty({ id: P, name: 'Maple plaza', totalSqft: 77500, tenants: [], invoices: [] });
  t('B5 with no _serverOwned on the record, nothing is invented: the payload has the client-owned keys and no other', Object.keys(B2.rec.upserts[0].data).sort().join() === WIRE.slice().sort().join(), Object.keys(B2.rec.upserts[0].data).join());

  // ── C ────────────────────────────────────────────────────────────────────
  sec('C  _stripBlobs');
  const C = world({});
  const s = C.sb._stripBlobs({ id: P, tenants: [{ id: F1, tenant_name: 'X', rawText: 'big', leaseFile: {} }],
    invoices: [{ id: 'i1', vendorName: 'V', amount: 2, category: 'c', invoiceDate: '2026-01-01', fileName: 'f', sourceEpisodeId: R, acquiredAt: 'T', _error: 'e', rawText: 'r', matchAmbiguous: false }] });
  t('C1 an invoice keeps sourceEpisodeId and acquiredAt', s.invoices[0].sourceEpisodeId === R && s.invoices[0].acquiredAt === 'T');
  t('C2 and still drops what it dropped before (_error, rawText) while keeping id, vendor, amount, category, date, file, match flags',
    !('_error' in s.invoices[0]) && !('rawText' in s.invoices[0]) && s.invoices[0].id === 'i1' && s.invoices[0].vendorName === 'V' && s.invoices[0].matchAmbiguous === false);
  t('C3 tenants still lose rawText and leaseFile', s.tenants[0].rawText === undefined && s.tenants[0].leaseFile === undefined && s.tenants[0].tenant_name === 'X');
  t('C4 an invoice without the stamps is unchanged in kind (the keys are present as undefined, never invented)', (() => { const u = C.sb._stripBlobs({ tenants: [], invoices: [{ id: 'i2', amount: 1 }] }).invoices[0]; return u.sourceEpisodeId === undefined && u.acquiredAt === undefined; })());

  // ── D ────────────────────────────────────────────────────────────────────
  sec('D  structure');
  const saveSrc = fnSource(SCRIPT, 'saveProperty');
  const lit = saveSrc.slice(saveSrc.indexOf('const data = {'), saveSrc.indexOf('\n    };', saveSrc.indexOf('const data = {')));
  const litKeys = Array.from(lit.matchAll(/\n\s{6}([A-Za-z_]\w*):\s/g)).map(m => m[1]);
  const spreadAt = lit.indexOf('..._serverOwnedDataKeys(stripped._serverOwned)');
  t('D1 the save literal spreads the server-owned keys, and does so BEFORE its first client-owned key', spreadAt !== -1 && spreadAt < lit.indexOf('invoices:'), String(spreadAt));
  eq(litKeys.slice().sort(), Array.from(C.sb.PROPERTY_DATA_CLIENT_KEYS).slice().sort(), 'D2 PROPERTY_DATA_CLIENT_KEYS names exactly the keys the save literal writes — no more, no fewer');
  t('D3 loadPropertyData projects _serverOwned from the raw blob, and the merge takes it from the database side only',
    /_serverOwned:\s+_serverOwnedDataKeys\(d\)/.test(fnSource(SCRIPT, 'loadPropertyData')) && /_serverOwned:\s+_serverOwnedDataKeys\(dbData\._serverOwned\)/.test(fnSource(SCRIPT, 'loadPropertyData')));
  t('D4 selectProperty carries _serverOwned onto the live record', /property\._serverOwned = data\._serverOwned/.test(fnSource(SCRIPT, 'selectProperty')));
  t('D5 ensureInvoiceIds is untouched (it still mints and still asks for a save)', /inv\.id = 'inv-' \+ Math\.random\(\)/.test(ENSURE_IDS) && /if \(ensureInvoiceIds\(property\) && window\.savePropertyData\) window\.savePropertyData\(\);/.test(POS));

  // ── E ────────────────────────────────────────────────────────────────────
  sec('E  local/database merge');
  // localStorage holds a copy taken BEFORE the acquisition (no acquiredFrom, a stale marker); the database has the fresh blob.
  const staleLocal = { [P]: { id: P, name: 'Maple plaza', totalSqft: 77500, tenants: [{ id: F1, tenant_name: 'Luxe Nails' }, { id: F2, tenant_name: 'Maple Coffee Co.' }], invoices: [], timeline: [], _serverOwned: { _p3Backfill: { at: 'old' }, ghost: 'from a stale copy' } } };
  const E = world({ row: dbRow(), props: [listRow()], ls: staleLocal });
  await E.sb.selectProperty(P);
  await sleep(1400);
  const ed = E.rec.upserts[0] ? E.rec.upserts[0].data : {};
  t('E1 with both copies present, the DATABASE\'s server-owned keys win: acquiredFrom present, _p3Backfill the database\'s, and the stale copy\'s ghost key is NOT resurrected',
    ed.acquiredFrom && ed.acquiredFrom.reviewId === R && ed._p3Backfill && ed._p3Backfill.at === '2026-09-27T03:27:53.560Z' && !('ghost' in ed), JSON.stringify({ a: ed.acquiredFrom, b: ed._p3Backfill, g: ed.ghost }));
  // localStorage has MORE tenants than the database (the merge's base becomes the local copy) — server-owned keys still come from the database
  const richLocal = JSON.parse(JSON.stringify(staleLocal)); richLocal[P].tenants.push({ id: 'f3', tenant_name: 'Third' });
  const E2 = world({ row: dbRow(), props: [listRow()], ls: richLocal });
  await E2.sb.selectProperty(P);
  await sleep(300);
  // The local copy wins the tenant/invoice merge (three tenants, no invoices), so
  // nothing mints an id and nothing saves by itself — the merge behaviour that
  // predates this change. A person's edit is what saves: the ordinary path.
  E2.sb.savePropertyData();
  await sleep(1100);
  const e2 = E2.rec.upserts[0] ? E2.rec.upserts[0].data : {};
  t('E2 even when the local copy is the merge base (more tenants), the server-owned keys are the database\'s', E2.rec.upserts.length === 1 && e2.acquiredFrom && e2.acquiredFrom.reviewId === R && !('ghost' in e2) && e2.tenants.length === 3, JSON.stringify({ n: E2.rec.upserts.length, a: e2.acquiredFrom, g: e2.ghost, tenants: (e2.tenants || []).length }));
  // offline: the local copy is all there is, and its own bag travels (saved by _lsSave from a hydrated record)
  const offlineLocal = { [P]: Object.assign({}, staleLocal[P], { _serverOwned: { acquiredFrom: { reviewId: R, source: 'acquire_property' } }, invoices: [{ id: 'inv-a', amount: 1, sourceEpisodeId: R, acquiredAt: 'T' }] }) };
  const E3 = world({ props: [listRow()], ls: offlineLocal, offline: true });
  await E3.sb.selectProperty(P);
  await sleep(1400);
  t('E3 offline, the local copy\'s server-owned bag is what the record carries (the save itself fails offline, so it is read from the live record)',
    E3.sb.state().props[0]._serverOwned && E3.sb.state().props[0]._serverOwned.acquiredFrom.reviewId === R && E3.rec.upserts.length === 0, JSON.stringify(E3.sb.state().props[0]._serverOwned));
  t('E4 _lsSave writes the bag into the local copy, so a later offline load has it', (() => { const W = world({}); W.sb._lsSave({ id: P, tenants: [], _serverOwned: { acquiredFrom: { reviewId: R } } }); return JSON.parse(W.ls.get('ms_props_' + U))[P]._serverOwned.acquiredFrom.reviewId === R; })());

  // ── H ────────────────────────────────────────────────────────────────────
  sec('H  the helper');
  const H = world({});
  eq(H.sb._serverOwnedDataKeys({ acquiredFrom: 1, invoices: [], camYear: 2, _p3Backfill: 3, info: {}, tenants: [] }), { acquiredFrom: 1, _p3Backfill: 3 }, 'H1 keeps every key the client does not own and nothing the client owns');
  eq(H.sb._serverOwnedDataKeys(null), {}, 'H2 null → {}');
  eq(H.sb._serverOwnedDataKeys([1, 2]), {}, 'H3 an array → {}');
  eq(H.sb._serverOwnedDataKeys('x'), {}, 'H4 a string → {}');
  eq(H.sb._serverOwnedDataKeys({}), {}, 'H5 an empty blob → {} (a fresh property adds nothing to its own payload)');

  console.log(`\n${'─'.repeat(58)}\nRESULT: ${pass} passed, ${fail} failed`);
  if (fail) { console.log('FAILED:'); failures.forEach(f => console.log('  - ' + f)); process.exit(1); }
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(2); });
