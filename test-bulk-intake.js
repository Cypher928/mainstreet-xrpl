'use strict';
/**
 * test-bulk-intake.js — Bulk Intake B1–B5 (the read-only audit of 2026-10-01).
 *
 *   node test-bulk-intake.js
 *
 * The REAL code runs, as in test-lease-upload-identity.js (whose sandbox this
 * suite copies): the job pipeline, handleBulkLeases, the retry path, the
 * held-upload decision, the register queue and api/lease-documents.js against
 * an in-memory PostgREST that enforces the primary key and migration 039's
 * leasehold foreign key. The document-type reading is the REAL
 * _acqClassifyDocument; only the model call behind it is stubbed.
 *
 *   1  a normal upload still becomes a new leasehold
 *   2  a duplicate upload is held (A-2 unchanged)
 *   3  an amendment never becomes a bogus leasehold (B5)
 *   4  a non-lease or uncertain document cannot silently become one (B5)
 *   5  retry cannot hijack the Upload Leases control (B1)
 *   6  retry runs through the A-2 protections (B2)
 *   7  a successful retry is persisted, linked, and survives a reload (B4)
 *   8  a job not in memory is updated by id — never inserted, never moved (B3)
 *   9  nothing A-2 / 038 / 043 protect is touched
 */
const fs   = require('fs');
const path = require('path');
const vm   = require('vm');
const nodeCrypto = require('crypto');
const { fnSource } = require('./test-support/fn-source.js');

const ROOT   = __dirname;
const SCRIPT = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');
const API    = fs.readFileSync(path.join(ROOT, 'api/lease-documents.js'), 'utf8');
const LUI    = require('./lease-upload-identity.js');
const LS     = require('./leasehold-status.js');
const FP     = require('./field-provenance.js');
const AD     = require('./acquisition-documents.js');
const TN     = require('./tenant-normalize.js');

// The API handler narrates every write on the console; the suite speaks through `out`.
const out = console.log.bind(console), outErr = console.error.bind(console);
console.log = console.warn = console.info = console.error = () => {};
let pass = 0, fail = 0, finished = false;
const failures = [];
// A promise that never settles lets Node exit 0 with half the suite unrun. It is a failure.
process.on('exit', () => { if (!finished) { out('\x1b[31mRESULT: did not finish (' + pass + ' passed, ' + fail + ' failed before it stopped)\x1b[0m'); process.exitCode = 1; } });
const ok  = (m) => { pass++; out('  \x1b[32m✓\x1b[0m ' + m); };
const bad = (m, d) => { fail++; failures.push(m); out('  \x1b[31m✗\x1b[0m ' + m + (d ? '  — ' + d : '')); };
const is  = (c, m, d) => (c ? ok(m) : bad(m, d));
const eq  = (a, b, m) => (JSON.stringify(a) === JSON.stringify(b) ? ok(m) : bad(m, 'got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b)));
const sec = (t) => out('\n\x1b[1m── ' + t + ' ──\x1b[0m');
const clone = (x) => JSON.parse(JSON.stringify(x));
const tick = () => new Promise(r => setImmediate(r));

// ── The register: an in-memory PostgREST for lease_documents ─────────────────
const FK_REFUSAL = { code: '23503', details: 'Key (tenant_id, property_id) is not present in table "tenants".',
  message: 'insert or update on table "lease_documents" violates foreign key constraint "lease_documents_leasehold_fk"' };
function makeDb() {
  const docs = new Map();              // id → row
  const tenantsTable = new Set();      // `${tenant_id}|${property_id}`
  let uid = 0;
  const resp = (status, json) => ({ ok: status < 300, status, json: async () => json, text: async () => JSON.stringify(json) });
  const q = (u) => {
    const out = {};
    for (const [k, v] of new URL(u).searchParams) if (/^eq\./.test(v)) out[k] = v.slice(3);
    return out;
  };
  const match = (row, f) => Object.keys(f).every(k => String(row[k]) === String(f[k]));
  const fetchImpl = async (url, opts = {}) => {
    const u = String(url), method = (opts.method || 'GET').toUpperCase();
    const body = opts.body ? JSON.parse(opts.body) : null;
    if (u.includes('/auth/v1/user')) return resp(200, { id: 'user-' + (++uid) });   // fresh id: no rate limit
    if (u.includes('/rest/v1/properties?')) return resp(200, [{ id: q(u).id }]);
    if (!u.includes('/rest/v1/lease_documents')) return resp(500, { raw: 'unmocked ' + u });
    const f = q(u);
    if (method === 'GET') return resp(200, [...docs.values()].filter(r => match(r, f)).map(clone));
    const fkOk = (tid, pid) => !tid || tenantsTable.has(tid + '|' + pid);
    if (method === 'POST') {
      const id = body.id || nodeCrypto.randomUUID();
      if (docs.has(id)) return resp(409, { code: '23505', message: 'duplicate key value violates unique constraint "lease_documents_pkey"' });
      if (!fkOk(body.tenant_id, body.property_id)) return resp(409, FK_REFUSAL);
      const row = { tenant_id: null, doc_type: null, classified_by: null, ...body, id };
      docs.set(id, row);
      return resp(201, [clone(row)]);
    }
    if (method === 'PATCH') {
      const rows = [...docs.values()].filter(r => match(r, f));
      for (const r of rows) if ('tenant_id' in body && !fkOk(body.tenant_id, r.property_id)) return resp(409, FK_REFUSAL);
      rows.forEach(r => Object.assign(r, body));
      return resp(200, rows.map(clone));
    }
    return resp(405, {});
  };
  return { docs, tenantsTable, fetchImpl };
}

function loadHandler() {
  const src = API.replace(/export\s+default\s+async\s+function\s+handler/, 'module.exports = async function handler');
  const mod = { exports: {} };
  const req = (p) => require(p.startsWith('.') ? path.join(ROOT, 'api', p) : p);
  new Function('require', 'module', 'exports', 'process', src)(req, mod, mod.exports, process);
  return mod.exports;
}
const HANDLER = loadHandler();
async function callApi(db, body) {
  global.fetch = db.fetchImpl;
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; }, setHeader() {} };
  await HANDLER({ method: 'POST', headers: { authorization: 'Bearer tok' }, body: clone(body) }, res);
  return res;
}

// ── The app, sandboxed ───────────────────────────────────────────────────────
const FNS = [
  'createLeaseJob', 'updateLeaseJob', 'finalizeLeaseJob', 'failLeaseJob',
  '_persistExtractedEvidence', '_saveLeaseRegisterWrite', '_flushLeaseRegisterWrites',
  '_leaseJobProperty', '_leaseJobRoster', '_leaseJobRowIndex', '_putLeaseJobRow', '_dropLeaseJobRow',
  '_heldLeaseUploads', '_heldUploadSettled', '_mergeHeldLeaseUploads', '_holdLeaseUpload', '_heldExtract',
  '_retireVacanciesFor', '_runLeaseJobPipeline', 'handleBulkLeases', 'retryLeaseJob', 'handleLease',
  'saveLeaseDocument', 'dedupeTenants', 'mintTenantIdentity', '_amendmentMerge',
  '_findHeldLeaseUpload', '_removeHeldLeaseUpload', '_persistableTenantRows', '_saveAfterHeldDecision',
  '_repaintAfterHeldDecision', 'resolveHeldLeaseUpload', '_tenantsBelongTo',
  // Bulk Intake B1–B5: the shared save, the retry path and the document-type hold.
  '_settleLeaseJobRoster', '_persistLeaseUploads', '_classifyLeaseUpload', '_leaseUploadDocGate',
  '_leaseRetryInput', '_pickLeaseRetryFile', 'retryLeaseUpload', '_retryLeaseJobWithFile',
];
const JOB_STAGES = SCRIPT.slice(SCRIPT.indexOf('const _JOB_STAGES = {'), SCRIPT.indexOf('};', SCRIPT.indexOf('const _JOB_STAGES = {')) + 2);
const APP_SRC = JOB_STAGES + '\nconst _resolvedHeldUploads = new Set();\nconst _heldInFlight = new Set();\nlet _leaseRetryPick = null;\n'
  + FNS.map(n => fnSource(SCRIPT, n)).join('\n') + '\n'
  + FNS.map(n => `this.${n} = ${n};`).join('\n');

const FILLER = 'This lease agreement is made between the landlord and the tenant for the premises. '.repeat(2);

/** A property's roster, in the shapes the app keeps. */
function fixtureA() {
  return {
    id: 'prop-A', name: 'Alder Plaza', totalSqft: 50000, timeline: [],
    tenants: [
      { id: 'lh-x', tenant_name: 'Whole Health Market', suite: '100', leased_sqft: 5000, start_date: '2020-01-01', end_date: '2030-12-31',
        lease_type: 'NNN', cap: 5, leaseUrl: 'leases/x/Lease.pdf', fileName: 'Lease.pdf', leaseExpected: true, status: 'success',
        amendments: [], reviewOverrides: {}, fieldEvidence: {} },
      { id: 'lh-y', tenant_name: 'Summit Coffee', suite: '210', leased_sqft: 1500, start_date: '2021-01-01', end_date: '2029-12-31',
        lease_type: 'NNN', cap: null, leaseUrl: null, fileName: '', leaseExpected: false, status: 'success', amendments: [] },
      { id: 'lh-e', tenant_name: 'Gone Co', suite: '300', leased_sqft: 1000, start_date: '2015-01-01', end_date: '2030-12-31',
        leasehold_status: 'ended', ended_at: '2024-06-30', ended_reason: 'surrendered', status: 'success' },
      { id: 'vac-400', tenant_name: 'Vacant', suite: '400', unitNumber: '400', leased_sqft: 2000, vacant: true },
      { id: 'lh-z1', tenant_name: 'Acme Holdings', suite: '500', leased_sqft: 800, start_date: '2022-01-01', end_date: '2027-12-31', status: 'success' },
      { id: 'lh-z2', tenant_name: 'Acme Holdings LLC', suite: '510', leased_sqft: 900, start_date: '2022-01-01', end_date: '2027-12-31', status: 'success' },
    ],
  };
}
function fixtureB() {
  return { id: 'prop-B', name: 'Birch Court', totalSqft: 20000, timeline: [],
    tenants: [{ id: 'lh-b1', tenant_name: 'Birch Books', suite: '1', leased_sqft: 3000, start_date: '2020-01-01', end_date: '2030-12-31', status: 'success' }] };
}

function makeApp(opts) {
  const o = opts || {};
  const db = makeDb();
  const A = fixtureA(), B = fixtureB();
  // The tenants table holds every persisted leasehold (the vacancy is a space, not a row there).
  [...A.tenants, ...B.tenants].forEach(t => { if (!t.vacant) db.tenantsTable.add(t.id + '|' + (A.tenants.includes(t) ? A.id : B.id)); });
  // A lease document already on file for Whole Health Market, named like everyone's.
  db.docs.set('doc-x', { id: 'doc-x', property_id: 'prop-A', tenant_id: 'lh-x', file_name: 'Lease.pdf', file_url: 'leases/x/Lease.pdf', doc_type: 'original_lease' });
  const rec = { saves: [], resyncs: [], evidence: [], timeline: [], audit: [], jobs: {}, errors: [] };
  const clicks = [];
  const el = (id) => { const e = { id: id || '', innerHTML: '', value: '', style: {}, files: null, onchange: null, _listeners: {},
    getBoundingClientRect: () => ({ height: 0 }),
    addEventListener(t, f) { (this._listeners[t] = this._listeners[t] || []).push(f); },
    click() { clicks.push(this.id); },
    fire(t) { (this._listeners[t] || []).forEach(f => f({ target: this })); if (t === 'change' && typeof this.onchange === 'function') this.onchange({ target: this }); } };
    return e; };
  const els = {};
  const box = {
    console: { log() {}, warn() {}, info() {}, error() {}, groupCollapsed() {}, groupEnd() {} },
    crypto: nodeCrypto, setTimeout, clearTimeout, setImmediate, Promise, Map, Set, JSON, Date, Math, Object, Array, String, Number, Boolean, Error, RegExp,
    File: class File {},
    window: { LeaseUploadIdentity: LUI, LeaseholdStatus: LS, FieldProvenance: FP, AcquisitionDocuments: AD,
              AuthService: { getCurrentUser: () => ({ id: 'u-pm', email: 'pm@example.test' }) } },
    _props: [A, B], activePropId: 'prop-A', tenantData: [null, null, null, ...A.tenants],
    _leaseJobs: new Map(), _leaseDebug: new Map(), _lastIngestTelemetry: null, _saveDebounceTimer: null,
    lastResults: [], _resultsStale: false,
    document: { getElementById: (id) => els[id] || null,
                createElement: () => el(''),
                body: { appendChild: (e) => { els[e.id] = e; return e; } } },
    alert: (m) => rec.errors.push('alert: ' + m),
    currentProperty: () => box._props.find(p => p && p.id === box.activePropId) || null,
    _syncJobToDb: () => Promise.resolve(true), _updateJobRowById: () => Promise.resolve(true), _trackJobLiveness: () => {},
    renderBulkResults: () => {}, logError: (w, e) => rec.errors.push(w + ': ' + (e && e.message)), logActivity: () => {},
    appendPropertyTimelineEvent: (p, e) => { (p.timeline || (p.timeline = [])).push(e); rec.timeline.push({ prop: p.id, ...e }); },
    appendPropertyTimelineEventOnce: (p, k, e) => { (p.timeline || (p.timeline = [])).push(e); rec.timeline.push({ prop: p.id, ...e }); },
    appendReviewAuditEntry: (e) => rec.audit.push(e),
    captureCheckpoint: () => {}, checkSqftValidation: () => {}, _revealExtractedLeases: () => {},
    retryUploadForSlot: () => {}, renderTenantUploadZone: () => {}, switchLeaseTab: () => {}, renderTenantError: (i, m) => rec.errors.push('slot ' + i + ': ' + m),
    deleteLeaseFile: () => Promise.resolve(), storeLeaseFile: () => {}, normalizeText: (s) => s, extractTenantFromText: () => '',
    _reconciliationCriticalFields: () => ['tenant_name', 'leased_sqft', 'start_date', 'end_date'], _capConfidenceLevel: (l) => l,
    computeExtractionConfidence: () => ({ level: 'high', score: 95, reasons: [], failedFields: [] }),
    uploadLeaseToStorage: (file, pid) => Promise.resolve('leases/' + pid + '/' + file.name),
    extractLeaseText: (file) => Promise.resolve(file.__text || FILLER),
    callClaudeForLease: async (text, name) => { const f = box.__files[name]; if (f && f.__gate) await f.__gate; return f && f.__extract ? clone(f.__extract) : null; },
    extractTextFromPdfDirect: () => Promise.resolve(null), callClaudeWithPdfDirect: () => Promise.resolve(null),
    normalizeTenant: (d) => TN.normalizeTenant(d),
    // The document-type reading (B5). Every file in this suite is a lease
    // unless it says otherwise, so A-2's own cases run exactly as before.
    _acqClassifyDocument: async (text, name) => { const f = box.__files[name]; return f && '__classify' in f ? clone(f.__classify) : { docType: 'original_lease', confidence: 0.95 }; },
    getLeaseFile: async () => null,
    parseSqft: (v) => parseFloat(String(v == null ? '' : v).replace(/,/g, '')) || 0,
    saveProperty: async (p) => { rec.saves.push({ id: p.id, tenants: clone((p.tenants || []).filter(Boolean)), pendingLeaseUploads: clone(p.pendingLeaseUploads || []) }); },
    resyncTenantsToTable: async (pid, rows) => { rec.resyncs.push({ pid, ids: rows.map(r => r.id) }); rows.forEach(r => db.tenantsTable.add(r.id + '|' + pid)); },
    _authHeaders: async () => ({ authorization: 'Bearer tok' }),
    fetch: async (url, init) => { const r = await callApi(db, JSON.parse(init.body)); return { ok: r.statusCode < 300, status: r.statusCode, json: async () => r.body }; },
    savePropertyData: () => {},
    _writeTenantFieldEvidence: (pid, tid, fk, snap) => { rec.evidence.push({ pid, tid, fk, snap: clone(snap) }); return Promise.resolve(); },
    _updateStaleResultsBanner: () => {}, _refreshAdvisorSurfaces: () => {},
    showToast: () => {}, confirm: () => true,
    __files: {},
  };
  ['bulkProgress', 'bulkResults', 'bulkLeaseInput'].forEach(id => { els[id] = el(id); });
  // The Upload Leases control's handler, as index.html wires it.
  const BULK_HANDLER = function () { return box.handleBulkLeases(this.files); };
  els.bulkLeaseInput.onchange = BULK_HANDLER;
  vm.createContext(box);
  vm.runInContext(APP_SRC, box);
  if (o.mutate) o.mutate(box);
  const file = (name, extract, extra) => { const f = Object.assign({ name, size: 1000, __extract: extract }, extra || {}); box.__files[name] = f; return f; };
  const A_ = () => box._props.find(p => p.id === 'prop-A');
  const held = () => (A_().pendingLeaseUploads || []);
  const row = (id) => (A_().tenants || []).find(t => t && t.id === id) || null;
  return { box, db, rec, A: A_, B: () => box._props.find(p => p.id === 'prop-B'), file, held, row, els, clicks, BULK_HANDLER };
}

const EXT = (over) => Object.assign({ tenant_name: 'Brand New Co', suite: '900', leased_sqft: 1200, start_date: '2026-01-01',
  end_date: '2031-12-31', lease_type: 'NNN', cap: null,
  fieldEvidence: { leased_sqft: { snapshots: [{ value: 1200, quote: 'Premises of 1,200 rentable square feet', page: 1, extractedAt: '2026-09-01T00:00:00Z', confidence: { status: 'estimated' } }] } } }, over || {});

// ── This suite's own additions to the sandbox ────────────────────────────────
// The REAL _acqClassifyDocument runs (the reading B5 reuses); only the model
// call behind it is stubbed. Each file says what it "is" (__classify), or that
// the call fails (__classifyThrows). No __classify: an original lease.
const BI_FNS = ['_acqClassifyDocument'];
function makeBI(opts) {
  const tasks = [];
  const T = makeApp({ mutate: (box) => {
    box.claudeFetch = async (req) => {
      tasks.push(req && req.task);
      const content = String(((req && req.messages) || [])[0] && req.messages[0].content || '');
      const m = content.match(/File name \(context only, do not classify from it\): (.*)\n/);
      const f = m && box.__files[m[1]];
      if (f && f.__classifyThrows) throw new Error('classification unavailable');
      return f && '__classify' in f ? clone(f.__classify) : { docType: 'original_lease', confidence: 0.95, evidence: 'THIS LEASE is made' };
    };
    box.callClaudeWithPdfDirect = async (file) => (file && file.__extract ? clone(file.__extract) : null);
    vm.runInContext(BI_FNS.map(n => fnSource(SCRIPT, n)).join('\n'), box);
    if (opts && opts.mutate) opts.mutate(box);
  } });
  T.tasks = tasks;
  T.resyncedIds = () => T.rec.resyncs.length ? T.rec.resyncs[T.rec.resyncs.length - 1].ids : [];
  T.lastSave = () => T.rec.saves[T.rec.saves.length - 1];
  T.doc = (id) => T.db.docs.get(id) || null;
  T.until = async (pred, ms) => { const t0 = Date.now(); while (!pred()) { if (Date.now() - t0 > (ms || 3000)) return false; await new Promise(r => setTimeout(r, 5)); } return true; };
  return T;
}
const CLS = (docType, extra) => Object.assign({ docType, confidence: 0.9, evidence: docType + ' — quoted' }, extra || {});

(async () => {
  // ════════════════════════════════════════════════════════════════════════
  sec('1 · a normal upload still becomes a new leasehold');
  {
    const T = makeBI();
    await T.box.handleBulkLeases([T.file('brandnew-lease.pdf', EXT())]);
    const r = T.A().tenants.find(t => t && t.tenant_name === 'Brand New Co');
    is(!!r && T.held().length === 0, '1.1 an original lease with no candidate is a new leasehold, nothing held');
    is(r && T.resyncedIds().includes(r.id), '1.2 …synced to the tenants table');
    is(r && T.doc(r.leaseDocumentId) && T.doc(r.leaseDocumentId).tenant_id === r.id, '1.3 …its document linked to it by its own id');
    is(T.tasks.includes('document_classification'), '1.4 the document was read by the existing document_classification task (no second classifier)');
    const S = T.lastSave();
    is(S && S.tenants.some(t => t.id === r.id), '1.5 …and it is in the saved property roster');
  }

  // ════════════════════════════════════════════════════════════════════════
  sec('2 · a duplicate upload is held (A-2 unchanged)');
  {
    const T = makeBI();
    const before = clone(T.A().tenants);
    await T.box.handleBulkLeases([T.file('whole-health-again.pdf', EXT({ tenant_name: 'Whole Health Market', suite: '100' }))]);
    const h = T.held()[0] || {};
    is(T.held().length === 1 && (h.candidates || []).map(c => c.id).join() === 'lh-x', '2.1 a second copy of an existing lease is HELD against that leasehold');
    eq(T.A().tenants.filter(Boolean).map(t => t.id), before.map(t => t.id), '2.2 …the roster is unchanged — no second leasehold');
    is(!T.resyncedIds().includes(h.id) && T.doc(h.documentId) && T.doc(h.documentId).tenant_id === null, '2.3 …not synced; its document filed unlinked');
    is(h.documentGate && h.documentGate.docType === 'original_lease' && h.documentGate.hold === false,
      '2.4 a candidate holds it whatever the document is (an original lease here) — A-2\'s rule decides, not the reading');
  }

  // ════════════════════════════════════════════════════════════════════════
  sec('3 · an amendment never becomes a bogus leasehold');
  {
    // (a) for an existing leasehold → held as A-2 always held it, the reading shown
    let T = makeBI();
    await T.box.handleBulkLeases([T.file('whm-amendment-1.pdf', Object.assign(EXT({ tenant_name: 'Whole Health Market', suite: '100', cap: 6 })), { __classify: CLS('amendment') })]);
    let h = T.held()[0] || {};
    is(T.held().length === 1 && h.candidates.map(c => c.id).join() === 'lh-x' && h.documentGate.docType === 'amendment',
      '3.1 an amendment of an existing leasehold is held against it, read as an Amendment');
    const r = await T.box.resolveHeldLeaseUpload(h.id, { action: 'attach', targetId: 'lh-x', kind: 'amendment' });
    is(r.ok && r.leaseholdId === 'lh-x' && T.row('lh-x').cap === 6 && !T.A().tenants.some(t => t && t.id === h.id),
      '3.2 …a person attaches it: the SAME leasehold id takes the change; no new leasehold');
    // (b) for a leasehold that does not match → held, never created
    T = makeBI();
    const before = clone(T.A().tenants);
    await T.box.handleBulkLeases([T.file('first-amendment.pdf', EXT({ tenant_name: 'Harbor Optical LLC', suite: '777' }), { __classify: CLS('amendment') })]);
    h = T.held()[0] || {};
    is(T.held().length === 1 && h.candidates.length === 0 && h.documentGate.reason === 'lease_document',
      '3.3 an amendment that matches no leasehold is HELD (reason: a document of a lease), not created');
    eq(T.A().tenants.filter(Boolean).map(t => t.id), before.map(t => t.id), '3.4 …the roster is unchanged');
    is(!T.resyncedIds().includes(h.id) && T.doc(h.documentId).tenant_id === null && !T.rec.evidence.some(e => e.tid === h.id),
      '3.5 …nothing synced, its document unlinked, no evidence written against anyone');
    is(T.lastSave().pendingLeaseUploads.some(x => x.id === h.id), '3.6 …the hold is saved with the property, so it survives a reload');
    for (const k of ['renewal', 'extension', 'assignment', 'guaranty', 'side_letter', 'estoppel', 'snda']) {
      const U = makeBI();
      await U.box.handleBulkLeases([U.file(k + '.pdf', EXT({ tenant_name: 'Nobody Matches ' + k, suite: 'Z-' + k }), { __classify: CLS(k) })]);
      is(U.held().length === 1 && U.held()[0].documentGate.docType === k && !U.A().tenants.some(t => t && /Nobody Matches/.test(t.tenant_name || '')),
        `3.7 ${k}: held, no leasehold created`);
    }
    // (c) the person can still say it is a new lease
    const c = await T.box.resolveHeldLeaseUpload(h.id, { action: 'create' });
    const nr = T.row(h.id);
    is(c.ok && nr && T.resyncedIds().includes(h.id) && T.doc(h.documentId).tenant_id === h.id,
      '3.8 …only a person\'s "It\'s a new lease" creates it — then synced, its document linked');
  }

  // ════════════════════════════════════════════════════════════════════════
  sec('4 · a non-lease or uncertain document cannot silently become a leasehold');
  {
    const cases = [
      ['invoice',             CLS('invoice'),             'not_a_lease'],
      ['rent_roll',           CLS('rent_roll'),           'not_a_lease'],
      ['notice (other)',      CLS('other'),               'not_a_lease'],
      ['financial statement', CLS('financial_statement'), 'not_a_lease'],
      ['unknown',             CLS('unknown'),             'unclassified'],
      ['an unrecognised type',CLS('lease_ish'),           'unclassified'],
      ['no reading (null)',   null,                       'unclassified'],
    ];
    for (const [label, cls, reason] of cases) {
      const T = makeBI();
      const n0 = T.A().tenants.length;
      await T.box.handleBulkLeases([T.file('doc-' + label.replace(/\W+/g, '-') + '.pdf', EXT({ tenant_name: 'Vendor Named Like A Tenant', suite: '901' }), { __classify: cls })]);
      const h = T.held()[0] || {};
      is(T.held().length === 1 && h.documentGate && h.documentGate.reason === reason && T.A().tenants.length === n0 && !T.resyncedIds().includes(h.id),
        `4.1 ${label}: held (${reason}); not in the roster, not synced`, JSON.stringify(h.documentGate));
    }
    let T = makeBI();
    await T.box.handleBulkLeases([T.file('flaky.pdf', EXT({ tenant_name: 'Flaky Co', suite: '902' }), { __classifyThrows: true })]);
    is(T.held().length === 1 && T.held()[0].documentGate.reason === 'unclassified' && !T.A().tenants.some(t => t && t.tenant_name === 'Flaky Co'),
      '4.2 the classification call failing holds the upload (fails closed)');
    T = makeBI();
    await T.box.handleBulkLeases([T.file('scan.pdf', EXT({ tenant_name: 'Scanned Co', suite: '903' }), { __text: 'x' })]);
    is(T.held().length === 1 && T.held()[0].documentGate.reason === 'unclassified' && !T.A().tenants.some(t => t && t.tenant_name === 'Scanned Co'),
      '4.3 a scan with no readable text (nothing to classify) is held, not created');
    T = makeBI({ mutate: (box) => { box.window.AcquisitionDocuments = undefined; } });
    await T.box.handleBulkLeases([T.file('novocab.pdf', EXT({ tenant_name: 'No Vocab Co', suite: '904' }))]);
    is(T.held().length === 1 && T.held()[0].documentGate.reason === 'unclassified', '4.4 with the document vocabulary not loaded, even a "lease" reading is held (fails closed)');
    T = makeBI();
    await T.box.handleBulkLeases([T.file('vac-invoice.pdf', EXT({ tenant_name: 'Sparkle Cleaning', suite: '400' }), { __classify: CLS('invoice') })]);
    is(T.row('vac-400') && T.row('vac-400').vacant === true, '4.5 a held non-lease naming a vacant suite does not retire the vacancy');
    const h = T.held()[0];
    const rm = await T.box.resolveHeldLeaseUpload(h.id, { action: 'remove' });
    is(rm.ok && T.held().length === 0 && T.doc(h.documentId) && T.doc(h.documentId).tenant_id === null && !T.row(h.id),
      '4.6 "Remove upload": no leasehold, and the document stays in the register, unlinked');
    // A mixed batch.
    T = makeBI();
    await T.box.handleBulkLeases([T.file('m-lease.pdf', EXT({ tenant_name: 'Mix Lease Co', suite: '911' })),
                                  T.file('m-amend.pdf', EXT({ tenant_name: 'Mix Amend Co', suite: '912' }), { __classify: CLS('amendment') }),
                                  T.file('m-inv.pdf',   EXT({ tenant_name: 'Mix Invoice Co', suite: '913' }), { __classify: CLS('invoice') })]);
    is(T.A().tenants.some(t => t && t.tenant_name === 'Mix Lease Co') && !T.A().tenants.some(t => t && /Mix (Amend|Invoice)/.test(t.tenant_name || ''))
       && T.held().length === 2, '4.7 a mixed batch: the lease is created, the amendment and the invoice are held');
  }

  // ════════════════════════════════════════════════════════════════════════
  sec('5 · retry cannot hijack the normal Upload Leases control');
  {
    const T = makeBI();
    // A failed upload: nothing could be read.
    const bad = T.file('unreadable-scan.pdf', null);
    await T.box.handleBulkLeases([bad]);
    const failed = T.A().tenants.find(t => t && t.fileName === 'unreadable-scan.pdf');
    is(failed && failed.extractionFailed && !T.resyncedIds().includes(failed.id), '5.1 a failed upload is an upload row, not a leasehold');
    // A reload: the job is gone from memory, and no copy of the file is kept.
    T.box._leaseJobs.clear();
    await T.box.retryLeaseUpload(failed.id);
    is(T.clicks.join() === 'leaseRetryInput', '5.2 Retry asks for the file on its OWN input (#leaseRetryInput)', T.clicks.join());
    is(T.els.bulkLeaseInput.onchange === T.BULK_HANDLER, '5.3 …the Upload Leases control\'s handler is untouched');
    // The person cancels the retry picker — then uploads two new leases normally.
    T.els.bulkLeaseInput.files = [T.file('next-1.pdf', EXT({ tenant_name: 'Next One', suite: '921' })), T.file('next-2.pdf', EXT({ tenant_name: 'Next Two', suite: '922' }))];
    T.els.bulkLeaseInput.fire('change');
    await T.until(() => T.A().tenants.some(t => t && t.tenant_name === 'Next Two'));
    await new Promise(r => setTimeout(r, 30));
    is(['Next One', 'Next Two'].every(n => T.A().tenants.some(t => t && t.tenant_name === n)),
      '5.4 after a cancelled retry, the next normal upload takes ALL its files as new uploads');
    const still = T.row(failed.id);
    is(still && still.extractionFailed && still.fileName === 'unreadable-scan.pdf', '5.5 …and none of them was written over the failed row');
    is(T.els.bulkLeaseInput.onchange === T.BULK_HANDLER, '5.6 the Upload Leases control still works after a retry (handler intact)');
    // The retry is answered later, on its own input.
    T.box.__files['unreadable-scan.pdf'].__extract = EXT({ tenant_name: 'Recovered Co', suite: '930' });
    const ri = T.els.leaseRetryInput;
    ri.files = [T.box.__files['unreadable-scan.pdf']];
    ri.fire('change');
    await T.until(() => { const r = T.row(failed.id); return r && r.tenant_name === 'Recovered Co' && r.status === 'success'; });
    await new Promise(r => setTimeout(r, 30));
    is(T.row(failed.id) && T.row(failed.id).tenant_name === 'Recovered Co', '5.7 the retry\'s own input re-reads THAT upload, under its own id');
    // Structural: nothing in the app assigns the Upload Leases control a handler, and the old paths are gone.
    is(!/bulkLeaseInput[^\n;]*\.onchange\s*=/.test(SCRIPT) && !/input\.onchange\s*=/.test(SCRIPT),
      '5.8 script.js never assigns an onchange to the Upload Leases control (or to any borrowed input)');
    is(!/function\s+(retryUploadForSlot|retryExtraction|retryExtractionWithFile)\s*\(/.test(SCRIPT),
      '5.9 the index-based retry functions (retryUploadForSlot / retryExtraction / retryExtractionWithFile) are gone');
    const handler = SCRIPT.slice(SCRIPT.indexOf('// Delegated retry handler'), SCRIPT.indexOf('// Delegated retry handler') + 1200);
    is(/retryLeaseUpload\(rowId\)/.test(handler) && !/retryLeaseJob\(|retryUploadForSlot/.test(handler.split('});')[0]),
      '5.10 every Retry control goes to retryLeaseUpload, by row id');
  }

  // ════════════════════════════════════════════════════════════════════════
  sec('6 · retry uses the A-2 protections');
  {
    // (a) the re-read names an existing leasehold → held, never merged
    let T = makeBI();
    await T.box.handleBulkLeases([T.file('blank.pdf', null)]);
    let f0 = T.A().tenants.find(t => t && t.fileName === 'blank.pdf');
    const lhx = clone(T.row('lh-x'));
    T.box.__files['blank.pdf'].__extract = EXT({ tenant_name: 'Whole Health Market', suite: '100', cap: 9 });
    await T.box.retryLeaseJob(f0.id);
    let h = T.held().find(x => x.id === f0.id);
    is(h && h.candidates.map(c => c.id).join() === 'lh-x' && JSON.stringify(T.row('lh-x')) === JSON.stringify(lhx),
      '6.1 a retry that reads an existing leasehold\'s lease is HELD against it; the leasehold is untouched');
    is(!T.row(f0.id), '6.2 …the upload row left the roster for the hold');
    // (b) the re-read is an amendment of nobody → held by the document-type rule
    T = makeBI();
    await T.box.handleBulkLeases([T.file('blank2.pdf', null)]);
    f0 = T.A().tenants.find(t => t && t.fileName === 'blank2.pdf');
    T.box.__files['blank2.pdf'].__extract = EXT({ tenant_name: 'Orphan Amendment Co', suite: '940' });
    T.box.__files['blank2.pdf'].__classify = CLS('amendment');
    await T.box.retryLeaseJob(f0.id);
    h = T.held().find(x => x.id === f0.id);
    is(h && h.documentGate.reason === 'lease_document' && !T.A().tenants.some(t => t && t.tenant_name === 'Orphan Amendment Co'),
      '6.3 a retry that reads an amendment of nobody is held, not created');
    // (c) the square-footage gate applies on retry (the old path skipped it)
    T = makeBI();
    await T.box.handleBulkLeases([T.file('blank3.pdf', null)]);
    f0 = T.A().tenants.find(t => t && t.fileName === 'blank3.pdf');
    T.box.__files['blank3.pdf'].__extract = EXT({ tenant_name: 'No Sqft Co', suite: '950', leased_sqft: null, fieldEvidence: {} });
    await T.box.retryLeaseJob(f0.id);
    const ns = T.row(f0.id);
    is(ns && ns.status === 'partial' && ns._needsReview === true && /leased_sqft/.test((ns._confidenceReasons || []).join(' ')),
      '6.4 a retried lease with no square footage is NOT "success" — the M5 gate applies (the old retry marked it success)');
    // (d) a persisted leasehold is never re-read in place
    T = makeBI();
    const lhy = clone(T.row('lh-y'));
    await T.box.retryLeaseJob('lh-y');
    is(JSON.stringify(T.row('lh-y')) === JSON.stringify(lhy), '6.5 retryLeaseJob refuses to re-read a persisted leasehold in place');
    await T.box.retryLeaseUpload('lh-y');
    is(T.clicks.join() === 'leaseRetryInput', '6.6 "No lease file — tap to re-upload" on a leasehold asks on the retry input…');
    T.els.leaseRetryInput.files = [T.file('summit-lease.pdf', EXT({ tenant_name: 'Summit Coffee', suite: '210' }))];
    T.els.leaseRetryInput.fire('change');
    await T.until(() => T.held().length === 1);
    h = T.held()[0] || {};
    is(h.candidates && h.candidates.map(c => c.id).join() === 'lh-y' && JSON.stringify(T.row('lh-y')) === JSON.stringify(lhy) && h.id !== 'lh-y',
      '6.7 …and the file is a NEW upload held against that leasehold (its own id); the leasehold is untouched until a person attaches it');
    // (e) the job's own property, never the one on screen
    T = makeBI();
    await T.box.handleBulkLeases([T.file('slow.pdf', null)]);
    f0 = T.A().tenants.find(t => t && t.fileName === 'slow.pdf');
    let release; const gate = new Promise(r => { release = r; });
    T.box.__files['slow.pdf'].__extract = EXT({ tenant_name: 'Slow Lease Co', suite: '960' });
    T.box.__files['slow.pdf'].__gate = gate;
    const run = T.box.retryLeaseJob(f0.id);
    await tick();
    T.box.activePropId = 'prop-B';                // the user opens another property mid-retry
    T.box.tenantData.splice(0, T.box.tenantData.length, ...T.B().tenants);
    release(); await run;
    is(T.A().tenants.some(t => t && t.tenant_name === 'Slow Lease Co') && !T.B().tenants.some(t => t && t.tenant_name === 'Slow Lease Co'),
      '6.8 a retry finishing after the user opened another property writes to the JOB\'s property only');
    // (f) a retry answered after the user switched property is refused
    T = makeBI();
    await T.box.handleBulkLeases([T.file('late.pdf', null)]);
    f0 = T.A().tenants.find(t => t && t.fileName === 'late.pdf');
    T.box._leaseJobs.clear();
    await T.box.retryLeaseUpload(f0.id);
    T.box.activePropId = 'prop-B';
    const savesBefore = T.rec.saves.length;
    T.box.__files['late.pdf'].__extract = EXT({ tenant_name: 'Late Co', suite: '970' });
    T.els.leaseRetryInput.files = [T.box.__files['late.pdf']];
    T.els.leaseRetryInput.fire('change');
    await new Promise(r => setTimeout(r, 50));
    is(T.rec.saves.length === savesBefore && !T.A().tenants.some(t => t && t.tenant_name === 'Late Co') && !T.B().tenants.some(t => t && t.tenant_name === 'Late Co'),
      '6.9 a retry file chosen after another property was opened is refused — written nowhere');
  }

  // ════════════════════════════════════════════════════════════════════════
  sec('7 · a successful retry is persisted, linked, and survives a reload');
  {
    const T = makeBI();
    await T.box.handleBulkLeases([T.file('retry-me.pdf', null)]);
    const f0 = T.A().tenants.find(t => t && t.fileName === 'retry-me.pdf');
    const docId = f0.leaseDocumentId;
    const docsBefore = T.db.docs.size;
    is(!!docId && T.doc(docId) && T.doc(docId).tenant_id === null, '7.1 the failed attempt filed its document, unlinked');
    // After a reload: the job is gone from memory; the person picks the file again.
    T.box._leaseJobs.clear();
    T.box.__files['retry-me.pdf'].__extract = EXT({ tenant_name: 'Retried Lease Co', suite: '980' });
    await T.box._retryLeaseJobWithFile('prop-A', f0.id, T.box.__files['retry-me.pdf']);
    const r = T.row(f0.id);
    is(r && r.status === 'success' && r.tenant_name === 'Retried Lease Co' && r.id === f0.id, '7.2 the retry succeeds under the SAME id');
    is(T.resyncedIds().includes(f0.id), '7.3 …synced to the tenants table (B4: the old retry saved nothing)');
    is(T.doc(docId) && T.doc(docId).tenant_id === f0.id && T.db.docs.size === docsBefore && r.leaseDocumentId === docId,
      '7.4 …its document is the SAME register row, now linked — no second row, not left unlinked');
    const S = clone(T.lastSave());
    is(S.tenants.some(t => t.id === f0.id && t.status === 'success'), '7.5 …and the property was saved with it');
    // A fresh session from what was saved.
    const R = makeBI();
    const A = R.A();
    A.tenants = S.tenants; A.pendingLeaseUploads = S.pendingLeaseUploads;
    R.box.tenantData.splice(0, R.box.tenantData.length, null, null, null, ...S.tenants);
    const back = A.tenants.find(t => t.id === f0.id);
    is(back && back.tenant_name === 'Retried Lease Co' && !back.extractionFailed && back.leaseDocumentId === docId,
      '7.6 after a reload the retried leasehold is there, with its document id');
    is(R.box._persistableTenantRows([back]).length === 1, '7.7 …and it is a persistable leasehold (passes the same gate the tenants sync uses)');
  }

  // ════════════════════════════════════════════════════════════════════════
  sec('8 · a job no longer in memory is updated by id — never inserted, never moved');
  {
    // lease_jobs as the database holds it, with lease_jobs_owner_all's rule:
    // a row is visible and writable only for a property the user belongs to,
    // and an INSERT (including an upsert's proposed row) must satisfy it.
    const MEMBER = new Set(['prop-A']);
    const table = [
      { id: 'job-A-stale', property_id: 'prop-A', status: 'processing', stage: 'normalize', updated_at: '2020-01-01T00:00:00Z' },
      { id: 'job-X-stale', property_id: 'prop-X', status: 'processing', stage: 'normalize', updated_at: '2020-01-01T00:00:00Z' },
      { id: 'job-A-held',  property_id: 'prop-A', status: 'review_required', stage: 'manual_review', updated_at: '2026-09-30T00:00:00Z' },
    ];
    const log = { inserts: 0, upserts: 0, updates: 0 };
    const RLS = { code: '42501', message: 'new row violates row-level security policy for table "lease_jobs"' };
    const visible = (r) => MEMBER.has(r.property_id);
    const db = { from: (t) => {
      if (t !== 'lease_jobs') throw new Error('unexpected table ' + t);
      return {
        select: () => ({ in: (col, vals) => Promise.resolve({ data: table.filter(r => visible(r) && vals.includes(r[col])).map(clone), error: null }) }),
        upsert: (row) => { log.upserts++;
          if (!MEMBER.has(row.property_id)) return Promise.resolve({ error: RLS });            // WITH CHECK on the proposed row
          const cur = table.find(r => r.id === row.id);
          if (cur) { if (!visible(cur)) return Promise.resolve({ error: RLS }); Object.assign(cur, row); }
          else { table.push(clone(row)); log.inserts++; }
          return Promise.resolve({ data: [row], error: null }); },
        update: (fields) => ({ eq: (col, v) => { log.updates++; log.lastUpdate = clone(fields);
          if ('property_id' in fields && !MEMBER.has(fields.property_id)) return Promise.resolve({ error: RLS });
          table.filter(r => visible(r) && String(r[col]) === String(v)).forEach(r => Object.assign(r, fields));
          return Promise.resolve({ data: null, error: null }); } }),
      };
    } };
    const errors = [];
    const box = { console: { log() {}, warn() {}, info() {}, error() {} }, db, Date, Math, Object, Array, String, Promise, Map, Set, JSON, Error,
      setTimeout: () => 0, clearTimeout: () => {}, logError: (w, e) => errors.push(w + ': ' + (e && e.message)),
      _lastIngestTelemetry: null };
    const B3_FNS = ['updateLeaseJob', '_trackJobLiveness', '_syncJobToDb', '_updateJobRowById', '_clearJobWatchdog', '_armJobWatchdog',
                    'failLeaseJob', 'finalizeLeaseJob', '_reapStaleLeaseJobs'];
    const consts = ['const _leaseJobs = new Map();', 'const _jobWatchdogs = new Map();', 'const JOB_WATCHDOG_MS = 240000;',
      'const JOB_STALE_MS = 15 * 60 * 1000;', "const _TERMINAL_JOB_STATUSES = new Set(['completed', 'review_required', 'failed']);", JOB_STAGES];
    vm.createContext(box);
    vm.runInContext(consts.join('\n') + '\n' + B3_FNS.map(n => fnSource(SCRIPT, n)).join('\n') + '\n'
      + B3_FNS.map(n => `this.${n} = ${n};`).join('\n') + '\nthis._leaseJobs = _leaseJobs;', box);
    const snap = () => clone(table);
    // The old write, for the record: an upsert of { id, status } proposes a row with no property.
    const okOld = await box._syncJobToDb({ id: 'job-A-stale', status: 'failed' }, { terminal: true });
    is(okOld === false && table.find(r => r.id === 'job-A-stale').status === 'processing',
      '8.1 (the defect) an upsert of { id, status } is refused by the RLS rule — the job stays "processing"');
    errors.length = 0;
    const before = snap();
    box.updateLeaseJob('job-A-held', { status: 'failed', stage: 'manual_review', error_message: 'Removed by a person' }, { terminal: true });
    await tick(); await tick();
    const a = table.find(r => r.id === 'job-A-held');
    is(a.status === 'failed' && a.error_message === 'Removed by a person' && a.property_id === 'prop-A', '8.2 updateLeaseJob for a job not in memory changes its existing row');
    is(table.length === before.length && log.inserts === 0, '8.3 …no row is created');
    is(errors.length === 0, '8.4 …and nothing was refused', errors.join('; '));
    const reap = await box._reapStaleLeaseJobs();
    await tick(); await tick();
    is(reap.reaped === 1 && table.find(r => r.id === 'job-A-stale').status === 'failed'
       && /tab closed or was suspended/.test(table.find(r => r.id === 'job-A-stale').error_message || ''),
      '8.5 the startup sweep now closes a stale job it can see, with its explanation');
    is(JSON.stringify(table.find(r => r.id === 'job-X-stale')) === JSON.stringify(before.find(r => r.id === 'job-X-stale')),
      '8.6 …another property\'s job is not changed');
    is(table.length === before.length && log.inserts === 0 && table.every(r => r.property_id === before.find(b => b.id === r.id).property_id),
      '8.7 …no row created, no job moved to another property');
    box.updateLeaseJob('job-never-existed', { status: 'failed' }, { terminal: true });
    await tick(); await tick();
    is(!table.some(r => r.id === 'job-never-existed') && log.inserts === 0, '8.8 an update for an id with no row creates nothing');
    // A caller passing id / property_id (even the job's own property, which RLS
    // would allow) must not re-key or re-home the row: neither is ever sent.
    box.updateLeaseJob('job-A-held', { status: 'failed', property_id: 'prop-A', id: 'other' }, {});
    await tick(); await tick();
    is(!('id' in (log.lastUpdate || {})) && !('property_id' in (log.lastUpdate || {})) && table.some(r => r.id === 'job-A-held') && !table.some(r => r.id === 'other'),
      '8.9 the update by id never carries id or property_id — a job cannot be re-keyed or moved', JSON.stringify(log.lastUpdate));
    // In memory: unchanged — the full row, with its property, by upsert.
    box._leaseJobs.set('job-live', { id: 'job-live', property_id: 'prop-A', status: 'processing', stage: 'upload', _file: {} });
    const ups0 = log.upserts;
    box.updateLeaseJob('job-live', { stage: 'extraction' });
    await tick();
    is(log.upserts === ups0 + 1 && table.some(r => r.id === 'job-live' && r.property_id === 'prop-A' && r.stage === 'extraction'),
      '8.10 a job in memory is still written whole, with its property (unchanged path)');
    // A terminal update that fails is retried once, by id.
    let failOnce = true;
    const realFrom = db.from;
    db.from = (t) => { const q = realFrom(t); const u = q.update;
      q.update = (f) => ({ eq: (c, v) => { if (failOnce) { failOnce = false; log.updates++; return Promise.resolve({ error: { message: 'transient' } }); } return u(f).eq(c, v); } });
      return q; };
    const upd0 = log.updates;
    const okRetry = await box._updateJobRowById('job-A-held', { status: 'completed' }, { terminal: true });
    is(okRetry === true && log.updates === upd0 + 2 && table.find(r => r.id === 'job-A-held').status === 'completed',
      '8.11 a failed terminal update is retried once, by id');
  }

  // ════════════════════════════════════════════════════════════════════════
  sec('9 · nothing A-2 / 038 / 043 protect is touched here');
  {
    // The mutation harness runs this from a copy with no .git; it names the real
    // checkout here so the comparison is still made, not skipped.
    const GIT_ROOT = process.env.BULK_INTAKE_GIT_ROOT || ROOT;
    const LUI_SRC = fs.readFileSync(path.join(ROOT, 'lease-upload-identity.js'), 'utf8');
    const head = require('child_process').execFileSync('git', ['show', 'HEAD:lease-upload-identity.js'], { cwd: GIT_ROOT, encoding: 'utf8' });
    is(LUI_SRC === head, '9.1 lease-upload-identity.js (the A-2 rule) is byte-for-byte unchanged');
    const diff = require('child_process').execFileSync('git', ['diff', '--name-only', 'HEAD'], { cwd: GIT_ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
    is(!diff.some(f => /^migrations\//.test(f) || /^api\//.test(f)), '9.2 no migration and no API file is changed', diff.join(', '));
    const rf = fnSource(SCRIPT, 'resolveHeldLeaseUpload');
    is(/nowCandidates\.some\(c => c\.id === target\.id\)/.test(rf) && /LUI\.isKind\(o\.kind\)/.test(rf),
      '9.3 the held decision still attaches only to a current candidate, of a confirmed kind');
    is(/!t\?\._pendingJobReview/.test(fnSource(SCRIPT, '_persistLeaseUploads')),
      '9.4 the tenants sync still takes only rows that pass the review gate');
  }

  finished = true;
  out('\n' + (fail ? '\x1b[31m' : '\x1b[32m') + `RESULT: ${pass} passed, ${fail} failed\x1b[0m`);
  if (fail) { out('FAILED:'); failures.forEach(f => out('  - ' + f)); }
  process.exit(fail ? 1 : 0);
})().catch(e => { outErr(e); process.exit(1); });
