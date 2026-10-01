'use strict';
/**
 * test-lease-upload-identity.js — Step A-2: which leasehold an uploaded lease
 * belongs to is a PERSON's decision, and the document is identified by its own
 * id, never by its file name.
 *
 *   node test-lease-upload-identity.js
 *
 * Nothing here leaves the process. The REAL code runs:
 *   · lease-upload-identity.js (the rule), field-provenance.js, leasehold-status.js
 *   · from script.js, extracted by name: the job pipeline, handleBulkLeases,
 *     retryLeaseJob, handleLease ("Add One Tenant"), the held-upload store, the
 *     decision (resolveHeldLeaseUpload), the amendment merge core, the evidence
 *     writer front-end, saveLeaseDocument and the register queue
 *   · api/lease-documents.js — the real handler, served by an in-memory
 *     PostgREST stand-in that enforces what the database enforces: the primary
 *     key, and lease_documents_leasehold_fk ((tenant_id, property_id) must be a
 *     tenants row of the same property).
 * Only the edges are stubbed: storage upload, text extraction, the model call
 * (each file says what it "contains"), confidence, the property save and the
 * tenants-table resync (recorded, and the resync feeds the FK stand-in).
 *
 *   A  the rule (pure): candidates, eligibility, vacancies, kind, plan
 *   B  the register API: durable document id, never re-pointed, never unlinked
 *   C  held uploads: every candidate match is a proposal; nothing attached
 *   D  no candidate: the existing new-leasehold flow; vacancy → new id
 *   E  decisions: attach (same id, every kind), create (new id), remove
 *   F  human-confirmed values: a conflict needs a person
 *   G  retry / replay: no duplicate document, evidence or leasehold
 *   H  scoping: navigation, Add One Tenant, a batch of two
 *   I  reload: a held upload survives, and stays out of every roster
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
  const el = () => ({ innerHTML: '', value: '', style: {}, getBoundingClientRect: () => ({ height: 0 }) });
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
    document: { getElementById: (id) => (els[id] || (els[id] = el())) },
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
  vm.createContext(box);
  vm.runInContext(APP_SRC, box);
  if (o.mutate) o.mutate(box);
  const file = (name, extract, extra) => { const f = Object.assign({ name, size: 1000, __extract: extract }, extra || {}); box.__files[name] = f; return f; };
  const A_ = () => box._props.find(p => p.id === 'prop-A');
  const held = () => (A_().pendingLeaseUploads || []);
  const row = (id) => (A_().tenants || []).find(t => t && t.id === id) || null;
  return { box, db, rec, A: A_, B: () => box._props.find(p => p.id === 'prop-B'), file, held, row };
}

const EXT = (over) => Object.assign({ tenant_name: 'Brand New Co', suite: '900', leased_sqft: 1200, start_date: '2026-01-01',
  end_date: '2031-12-31', lease_type: 'NNN', cap: null,
  fieldEvidence: { leased_sqft: { snapshots: [{ value: 1200, quote: 'Premises of 1,200 rentable square feet', page: 1, extractedAt: '2026-09-01T00:00:00Z', confidence: { status: 'estimated' } }] } } }, over || {});

(async () => {
  // ════════════════════════════════════════════════════════════════════════
  sec('A · the rule (pure)');
  {
    const R = fixtureA().tenants;
    eq(LUI.candidates(R, { tenant_name: 'Other', suite: 'Ste. 100' }).map(c => [c.id, c.basis]), [['lh-x', 'suite']], 'A1 unique suite → one candidate, basis suite');
    eq(LUI.candidates(R, { tenant_name: 'SUMMIT COFFEE, L.L.C.' }).map(c => [c.id, c.basis]), [['lh-y', 'name']], 'A2 unique name → one candidate, basis name');
    eq(LUI.candidates(R, { tenant_name: 'Acme Holdings, Inc.' }).map(c => c.id).sort(), ['lh-z1', 'lh-z2'], 'A3 ambiguous name → both are candidates');
    is(LUI.candidates(R, { suite: '100' })[0].hasLease === true && LUI.candidates(R, { suite: '210' })[0].hasLease === false,
      'A4 a leasehold with a lease on file is a candidate (the old matcher skipped it); so is one without');
    eq(LUI.candidates(R, { tenant_name: 'Gone Co', suite: '300' }), [], 'A5 an ENDED leasehold is never a candidate, by suite or name');
    eq(LUI.candidates(R, { suite: '400' }).concat(LUI.candidates(R, { tenant_name: 'Vacant' })), [], 'A6 a vacancy is never a candidate — even one labelled "Vacant", by suite or by name');
    eq(LUI.vacanciesFor(R, { suite: 'Unit 400' }), ['vac-400'], 'A7 …it is the space a new lease on its suite fills');
    eq(LUI.candidates(R, { tenant_name: 'Whole Health Markets', suite: '101' }), [], 'A8 no fuzzy matching: a near miss is not a candidate');
    eq(LUI.candidates([{ id: 'j', tenant_name: 'Whole Health Market', status: 'pending' }, { id: 'h', tenant_name: 'Whole Health Market', _pendingJobReview: true }], { tenant_name: 'Whole Health Market' }),
       [], 'A9 an in-flight placeholder or an unconfirmed low-confidence row is never a candidate');
    eq(LUI.candidates(R, { suite: '100' }, { excludeId: 'lh-x' }), [], 'A10 excludeId: an upload never proposes itself');
    const X = R[0];
    eq([LUI.proposeKind(R[1], { tenant_name: 'Summit Coffee' }), LUI.proposeKind(X, { tenant_name: 'Fresh Foods Inc' }),
        LUI.proposeKind(X, { tenant_name: 'Whole Health Market', end_date: '2035-12-31' }), LUI.proposeKind(X, { tenant_name: 'Whole Health Market', cap: 6 })],
       ['original_lease', 'assignment', 'renewal_extension', 'amendment'], 'A11 proposeKind: no lease → Original; other name → Assignment; later end → Renewal; else Amendment');
    const Xc = Object.assign(clone(X), { reviewOverrides: { cap: { reviewerConfirmed: true, reviewedAt: '2026-05-01T00:00:00Z', override: 5 } } });
    const p0 = LUI.plan(Xc, { cap: 7, leased_sqft: 5200 }, 'amendment', {});
    eq([p0.unresolved, p0.changes.map(c => c.field)], [['cap'], ['leased_sqft']], 'A12 plan: a human-confirmed field that differs is UNRESOLVED; an unconfirmed one changes');
    eq(LUI.plan(Xc, { cap: 7 }, 'amendment', { cap: 'keep' }).kept, ['cap'], 'A13 …"keep" keeps it');
    eq(LUI.plan(Xc, { cap: 7 }, 'amendment', { cap: 'incoming' }).changes, [{ field: 'cap', from: 5, to: 7, confirmed: true }], 'A14 …"incoming" takes it, marked confirmed');
    eq(LUI.plan(X, { cap: 9, audit_rights: 'yes' }, 'original_lease', {}).changes.map(c => c.field), ['audit_rights'],
       'A15 an Original Lease Copy onto a leasehold WITH a lease only fills what is empty');
    is(LUI.KIND_KEYS.join() === 'amendment,renewal_extension,assignment,original_lease' && !LUI.isKind('new_leasehold'), 'A16 exactly the four kinds a person may confirm');
  }

  // ════════════════════════════════════════════════════════════════════════
  sec('B · the register API: the document\'s own id, never re-pointed, never unlinked');
  {
    const db = makeDb(); db.tenantsTable.add('lh-x|prop-A'); db.tenantsTable.add('lh-y|prop-A');
    db.docs.set('doc-x', { id: 'doc-x', property_id: 'prop-A', tenant_id: 'lh-x', file_name: 'Lease.pdf', extracted_text: 'X TEXT' });
    const D = '11111111-2222-4333-8444-555555555555';
    let r = await callApi(db, { propertyId: 'prop-A', fileName: 'Lease.pdf', tenantId: 'lh-y', extractedText: 'Y TEXT' });
    const byName = [...db.docs.values()].filter(d => d.file_name === 'Lease.pdf');
    is(r.statusCode === 200 && byName.length === 2 && db.docs.get('doc-x').tenant_id === 'lh-x' && db.docs.get('doc-x').extracted_text === 'X TEXT',
      'B1 a same-named upload for ANOTHER leasehold inserts its own row; the existing one is not re-pointed or rewritten', JSON.stringify(byName));
    r = await callApi(db, { propertyId: 'prop-A', fileName: 'Lease.pdf', tenantId: undefined });
    is(db.docs.get('doc-x').tenant_id === 'lh-x' && [...db.docs.values()].filter(d => d.file_name === 'Lease.pdf').length === 3,
      'B2 a same-named upload with NO leasehold never unlinks the existing row (a new unlinked row instead)');
    r = await callApi(db, { propertyId: 'prop-A', fileName: 'Lease.pdf', tenantId: 'lh-x', extractedText: 'X v2' });
    is(db.docs.get('doc-x').extracted_text === 'X v2' && db.docs.get('doc-x').tenant_id === 'lh-x' && [...db.docs.values()].filter(d => d.file_name === 'Lease.pdf').length === 3,
      'B3 the same leasehold re-saving its own same-named document updates that row in place');
    r = await callApi(db, { propertyId: 'prop-A', documentId: D, fileName: 'amend.pdf', extractedText: 'AM' });
    is(r.statusCode === 200 && db.docs.get(D) && db.docs.get(D).tenant_id === null, 'B4 documentId: the row is created with THAT id, unlinked');
    r = await callApi(db, { propertyId: 'prop-A', documentId: D, fileName: 'amend.pdf', extractedText: 'AM' });
    is(r.statusCode === 200 && db.docs.size === 4, 'B5 …replaying the same write creates nothing new', 'rows: ' + db.docs.size);
    r = await callApi(db, { propertyId: 'prop-A', documentId: D, tenantId: 'lh-x', docType: 'amendment' });
    const d = db.docs.get(D);
    is(r.statusCode === 200 && r.body.linked === true && d.tenant_id === 'lh-x' && d.doc_type === 'amendment' && d.classified_by === 'user' && d.extracted_text === 'AM',
      'B6 a link-only write links the unlinked row by id, records the confirmed kind as classified_by user, and leaves the text alone', JSON.stringify(d));
    r = await callApi(db, { propertyId: 'prop-A', documentId: D, tenantId: 'lh-y' });
    is(r.statusCode === 409 && r.body.code === 'document_linked_elsewhere' && db.docs.get(D).tenant_id === 'lh-x', 'B7 re-pointing a linked document to another leasehold is refused (409)');
    r = await callApi(db, { propertyId: 'prop-A', documentId: D, extractedText: 'AM2' });
    is(r.statusCode === 200 && db.docs.get(D).tenant_id === 'lh-x', 'B8 a write with no tenant never unlinks a linked document');
    r = await callApi(db, { propertyId: 'prop-B', documentId: D, fileName: 'x.pdf' });
    is(r.statusCode === 409 && r.body.code === 'document_in_other_property', 'B9 a document id from another property is refused');
    r = await callApi(db, { propertyId: 'prop-A', documentId: 'not-a-uuid', fileName: 'x.pdf' });
    is(r.statusCode === 400, 'B10 a documentId that is not a uuid is refused (400)');
    r = await callApi(db, { propertyId: 'prop-A', documentId: D, docType: 'new_leasehold' });
    is(r.statusCode === 400, 'B11 a docType outside the four confirmed kinds is refused (400)');
    const E = '99999999-2222-4333-8444-555555555555';
    r = await callApi(db, { propertyId: 'prop-A', documentId: E, fileName: 'held.pdf', tenantId: 'lh-not-persisted' });
    is(r.statusCode === 200 && r.body.linked === false && db.docs.get(E).tenant_id === null, 'B12 a link the FK refuses keeps the document, unlinked, linked:false');
    // A replay racing its own insert: the insert hits the primary key, and the write becomes an update of that row.
    const race = makeDb(); const R = 'aaaaaaaa-2222-4333-8444-555555555555';
    const f0 = race.fetchImpl;
    race.fetchImpl = async (url, opts) => {
      if ((opts && opts.method) === 'POST' && !race.docs.has(R)) race.docs.set(R, { id: R, property_id: 'prop-A', tenant_id: null, file_name: 'r.pdf' });
      return f0(url, opts);
    };
    r = await callApi(race, { propertyId: 'prop-A', documentId: R, fileName: 'r.pdf', extractedText: 'T' });
    is(r.statusCode === 200 && race.docs.size === 1 && race.docs.get(R).extracted_text === 'T', 'B13 a duplicate-key race on the same documentId becomes an update of that one row');
  }

  // ════════════════════════════════════════════════════════════════════════
  sec('C · every candidate match is HELD for a person — nothing is attached');
  const holdCase = async (label, ext, expectIds, expectBasis) => {
    const T = makeApp();
    const before = clone(T.A().tenants);
    await T.box.handleBulkLeases([T.file('upload-' + label + '.pdf', EXT(ext))]);
    const H = T.held();
    const h = H[0] || {};
    is(H.length === 1, `C-${label} the upload is HELD for a leasehold decision (one held record)`);
    eq(h.candidates && h.candidates.map(c => c.id).sort(), expectIds.slice().sort(), `C-${label} candidates proposed: ${expectIds.join(', ')}`);
    if (expectBasis) eq(h.candidates.map(c => c.basis), expectBasis, `C-${label} …by ${expectBasis.join(', ')}`);
    eq(T.A().tenants.filter(Boolean).map(t => t.id), before.map(t => t.id), `C-${label} the roster is exactly what it was: no row added, none replaced`);
    eq(clone(T.A().tenants.filter(Boolean)), before, `C-${label} every existing leasehold is byte-identical (no merge into a candidate)`);
    is(!T.box.tenantData.some(t => t && t.id === h.id), `C-${label} the held upload is not in the live roster (tenantData)`);
    is(T.rec.resyncs.every(r => !r.ids.includes(h.id)), `C-${label} …nor in the tenants-table resync`);
    eq(T.rec.evidence.length, 0, `C-${label} no evidence is written against anyone before the decision`);
    const doc = T.db.docs.get(h.documentId);
    is(!!doc && doc.tenant_id === null && doc.file_name === 'upload-' + label + '.pdf', `C-${label} the register row exists at arrival, UNLINKED, under the held record's documentId`);
    eq(T.box._leaseJobs.get(h.jobId).status + '/' + T.box._leaseJobs.get(h.jobId).stage, 'review_required/manual_review', `C-${label} the job waits: review_required / manual_review`);
    const saved = T.rec.saves[T.rec.saves.length - 1];
    is(saved && saved.pendingLeaseUploads.some(x => x.id === h.id) && !saved.tenants.some(t => t.id === h.id), `C-${label} saved with the property as a held upload, never as a tenant`);
    return T;
  };
  await holdCase('suite', { tenant_name: 'WHM Grocers Inc', suite: 'Suite 100' }, ['lh-x'], ['suite']);
  await holdCase('name', { tenant_name: 'Summit Coffee, LLC', suite: '' }, ['lh-y'], ['name']);
  await holdCase('ambiguous', { tenant_name: 'Acme Holdings, Inc.', suite: '' }, ['lh-z1', 'lh-z2']);
  {
    const T = await holdCase('withlease', { tenant_name: 'Whole Health Market', suite: '100' }, ['lh-x'], ['suite+name']);
    is(T.held()[0].candidates[0].hasLease === true, 'C-withlease the candidate has a lease on file — still only a proposal');
  }

  // ════════════════════════════════════════════════════════════════════════
  sec('D · no candidate: the existing new-leasehold flow');
  {
    const T = makeApp();
    await T.box.handleBulkLeases([T.file('gone.pdf', EXT({ tenant_name: 'Gone Co', suite: '300' }))]);
    const nu = T.A().tenants.find(t => t && t.fileName === 'gone.pdf');
    is(T.held().length === 0 && nu && nu.id !== 'lh-e' && T.row('lh-e') && T.row('lh-e').leasehold_status === 'ended',
      'D1 an ENDED leasehold is never a candidate: the upload is a NEW leasehold; the ended one stays, as history');
  }
  {
    const T = makeApp();
    await T.box.handleBulkLeases([T.file('bakery.pdf', EXT({ tenant_name: 'New Bakery', suite: 'Suite 400' }))]);
    const nu = T.A().tenants.find(t => t && t.fileName === 'bakery.pdf');
    const jobId = [...T.box._leaseJobs.keys()][0];
    is(T.held().length === 0 && nu && nu.id === jobId && nu.id !== 'vac-400', 'D2 vacancy: a NEW leasehold with a NEW id — the vacancy row\'s id is not reused');
    is(!T.row('vac-400') && !T.box.tenantData.some(t => t && t.id === 'vac-400'), 'D3 …and the vacancy row is retired (the area is not counted vacant and leased at once)');
    is(T.rec.timeline.some(e => e.type === 'vacancy_filled' && e.metadata.vacancyId === 'vac-400' && e.metadata.leaseholdId === jobId), 'D4 …with a timeline record naming both');
  }
  {
    const T = makeApp();
    // The model read the suite but no tenant: a failed extraction, which must not take the vacancy with it.
    await T.box.handleBulkLeases([T.file('unreadable.pdf', { tenant_name: '', suite: 'Suite 400', leased_sqft: 2000 })]);
    const failedRow = T.A().tenants.find(t => t && t.fileName === 'unreadable.pdf');
    is(!!failedRow && failedRow.extractionFailed && failedRow.suite === 'Suite 400' && !!T.row('vac-400'), 'D4b a failed extraction on a vacant suite never retires the vacancy',
      JSON.stringify(failedRow && { f: failedRow.extractionFailed, s: failedRow.suite }));
  }
  {
    const T = makeApp();
    await T.box.handleBulkLeases([T.file('brandnew.pdf', EXT())]);
    const jobId = [...T.box._leaseJobs.keys()][0];
    const nu = T.row(jobId);
    is(T.held().length === 0 && nu && nu.tenant_name === 'Brand New Co' && T.box.tenantData.some(t => t && t.id === jobId), 'D5 no candidate → a new leasehold row with the job\'s id, in the roster (today\'s behaviour)');
    is(T.rec.resyncs.some(r => r.ids.includes(jobId)), 'D6 …persisted through the normal gate (resync)');
    is(T.rec.evidence.length > 0 && T.rec.evidence.every(e => e.tid === jobId), 'D7 …its extraction evidence is written against its own id');
    const doc = T.db.docs.get(nu.leaseDocumentId);
    is(!!doc && doc.tenant_id === jobId && doc.file_name === 'brandnew.pdf', 'D8 …and its register row, by the document\'s own id, links to it after the resync');
    eq(T.box._leaseJobs.get(jobId).status, 'completed', 'D9 …and the job completes');
  }

  // ════════════════════════════════════════════════════════════════════════
  sec('E · decisions — attach keeps the leasehold id; create makes one; remove touches nothing');
  const heldOn = async (ext, fileName, T0) => {
    const T = T0 || makeApp();
    await T.box.handleBulkLeases([T.file(fileName, EXT(ext))]);
    return { T, h: T.held().find(x => x.fileName === fileName) };
  };
  for (const [kind, ext, check] of [
    ['amendment',         { tenant_name: 'Whole Health Market', suite: '100', cap: 6, leased_sqft: 5000,
                            fieldEvidence: { cap: { snapshots: [{ value: 6, quote: 'cap of six percent', page: 3, extractedAt: '2026-09-01T00:00:00Z' }] } } },
                          (x) => x.cap === 6],
    ['assignment',        { tenant_name: 'Fresh Foods Inc', suite: '100', leased_sqft: 5000 }, (x) => x.tenant_name === 'Fresh Foods Inc'],
    ['renewal_extension', { tenant_name: 'Whole Health Market', suite: '100', end_date: '2036-12-31', leased_sqft: 5000 }, (x) => x.end_date === '2036-12-31'],
  ]) {
    const { T, h } = await heldOn(ext, kind + '.pdf');
    const n0 = T.A().tenants.filter(Boolean).length;
    const r = await T.box.resolveHeldLeaseUpload(h.id, { action: 'attach', targetId: 'lh-x', kind, conflictChoices: {} });
    const x = T.row('lh-x');
    is(r.ok && r.leaseholdId === 'lh-x' && x && check(x) && T.A().tenants.filter(Boolean).length === n0 && !T.row(h.id),
      `E-${kind} attach → the SAME leasehold id (lh-x), updated; no new leasehold`, JSON.stringify(r));
    const am = (x.amendments || []).find(a => a.amendmentId === h.id);
    is(!!am && am.docType === kind && am.leaseDocumentId === h.documentId && am.heldUploadId === h.id, `E-${kind} …recorded on the leasehold as a ${kind} with the document's id`);
    const doc = T.db.docs.get(h.documentId);
    is(doc.tenant_id === 'lh-x' && doc.doc_type === kind && doc.classified_by === 'user' && T.db.docs.get('doc-x').tenant_id === 'lh-x',
      `E-${kind} …the register row is linked by its own id, with the confirmed kind; the lease already on file is untouched`);
    is(T.held().length === 0 && T.box._leaseJobs.get(h.jobId).status === 'completed', `E-${kind} …the held upload is gone and its job completed`);
    if (kind === 'amendment') {
      const evs = T.rec.evidence;
      is(evs.length > 0 && evs.every(e => e.tid === 'lh-x' && e.snap.sourceDocumentId === h.documentId && e.snap.amendmentId === h.id),
        'E-amendment evidence is written only now, against lh-x, carrying source_document_id and amendment_id', JSON.stringify(evs.map(e => [e.tid, e.fk])));
      is(T.rec.timeline.some(e => e.type === 'lease_document_attached' && e.tenantId === 'lh-x'), 'E-amendment the property timeline records the attach');
    }
  }
  {
    const { T, h } = await heldOn({ tenant_name: 'Summit Coffee', suite: '210', cap: 4 }, 'summit-lease.pdf');
    const r = await T.box.resolveHeldLeaseUpload(h.id, { action: 'attach', targetId: 'lh-y', kind: 'original_lease' });
    const y = T.row('lh-y');
    is(r.ok && y.id === 'lh-y' && y.leaseUrl === h.leaseUrl && y.leaseDocumentId === h.documentId && y.cap === 4,
      'E-original an Original Lease Copy for a leasehold with no lease becomes ITS lease — same id');
  }
  {
    const { T, h } = await heldOn({ tenant_name: 'Whole Health Market', suite: '100' }, 'kind-missing.pdf');
    const r = await T.box.resolveHeldLeaseUpload(h.id, { action: 'attach', targetId: 'lh-x' });
    is(!r.ok && r.error === 'kind_required' && T.held().length === 1 && T.db.docs.get(h.documentId).tenant_id === null,
      'E-kind the person must confirm the kind: without it nothing is attached');
    const r2 = await T.box.resolveHeldLeaseUpload(h.id, { action: 'attach', targetId: 'lh-y', kind: 'amendment' });
    is(!r2.ok && r2.error === 'target_not_eligible' && T.held().length === 1, 'E-target only a leasehold the upload is a candidate for can take it');
    const r3 = await T.box.resolveHeldLeaseUpload(h.id, { action: 'attach', targetId: 'lh-e', kind: 'amendment' });
    is(!r3.ok && r3.error === 'target_not_eligible', 'E-ended an ended leasehold can never take it');
  }
  {
    const { T, h } = await heldOn({ tenant_name: 'Whole Health Market', suite: '100' }, 'genuinely-new.pdf');
    const n0 = T.A().tenants.filter(Boolean).length;
    const x0 = clone(T.row('lh-x'));
    const r = await T.box.resolveHeldLeaseUpload(h.id, { action: 'create' });
    const nu = T.row(h.id);
    is(r.ok && r.leaseholdId === h.id && nu && nu.id === h.id && nu.id !== 'lh-x' && T.A().tenants.filter(Boolean).length === n0 + 1,
      'E-create a genuinely new lease → a NEW leasehold id (the upload\'s own)');
    eq(clone(T.row('lh-x')), x0, 'E-create …the candidate it was not is untouched');
    const doc = T.db.docs.get(h.documentId);
    is(doc.tenant_id === h.id && doc.doc_type === 'original_lease', 'E-create …its register row links to the new leasehold by the document id');
    is(T.rec.evidence.length > 0 && T.rec.evidence.every(e => e.tid === h.id), 'E-create …evidence is written only now, against the new leasehold');
  }
  {
    const { T, h } = await heldOn({ tenant_name: 'Whole Health Market', suite: '100' }, 'discard-me.pdf');
    const snap = clone(T.A().tenants.filter(Boolean));
    const r = await T.box.resolveHeldLeaseUpload(h.id, { action: 'remove' });
    is(r.ok && T.held().length === 0 && JSON.stringify(clone(T.A().tenants.filter(Boolean))) === JSON.stringify(snap) && T.rec.evidence.length === 0,
      'E-remove removes the upload; no leasehold changes; no evidence');
    is(T.db.docs.get(h.documentId) && T.db.docs.get(h.documentId).tenant_id === null, 'E-remove …the document stays in the register, unlinked');
  }

  // ════════════════════════════════════════════════════════════════════════
  sec('F · a human-confirmed value is never changed without a person');
  const confirmedApp = () => {
    const T = makeApp();
    const x = T.box.tenantData.find(t => t && t.id === 'lh-x');
    x.reviewOverrides = { cap: { original: 5, override: 5, reviewerConfirmed: true, reviewedAt: '2026-05-01T00:00:00Z', overrideSource: 'manual' } };
    T.A().tenants = T.box.tenantData.filter(Boolean);
    return T;
  };
  {
    const T = confirmedApp();
    const { h } = await heldOn({ tenant_name: 'Whole Health Market', suite: '100', cap: 7, leased_sqft: 5000,
      fieldEvidence: { cap: { snapshots: [{ value: 7, quote: 'cap seven', page: 2, extractedAt: '2026-09-01T00:00:00Z' }] } } }, 'conflict.pdf', T);
    const x0 = clone(T.row('lh-x'));
    const r = await T.box.resolveHeldLeaseUpload(h.id, { action: 'attach', targetId: 'lh-x', kind: 'amendment' });
    is(!r.ok && r.needsConfirmation && r.unresolved.join() === 'cap', 'F1 attaching over a confirmed cap without a decision → needsConfirmation [cap]');
    eq(clone(T.row('lh-x')), x0, 'F2 …nothing on the leasehold changed');
    is(T.held().length === 1 && T.rec.evidence.length === 0 && T.db.docs.get(h.documentId).tenant_id === null, 'F3 …the upload is still held, no evidence, the document still unlinked');
    const r2 = await T.box.resolveHeldLeaseUpload(h.id, { action: 'attach', targetId: 'lh-x', kind: 'amendment', conflictChoices: { cap: 'keep' } });
    const x = T.row('lh-x');
    is(r2.ok && x.cap === 5 && FP.isHumanBacked('cap', x) && (x.amendments.find(a => a.amendmentId === h.id) || {}).keptFields.join() === 'cap',
      'F4 "keep": the confirmed cap stays 5 and stays human-confirmed; the decision records what was kept');
    is(!T.rec.evidence.some(e => e.fk === 'cap'), 'F5 …and no newer unreviewed reading of the cap is written to displace the confirmation');
  }
  {
    const T = confirmedApp();
    const { h } = await heldOn({ tenant_name: 'Whole Health Market', suite: '100', cap: 7, leased_sqft: 5000 }, 'conflict2.pdf', T);
    const r = await T.box.resolveHeldLeaseUpload(h.id, { action: 'attach', targetId: 'lh-x', kind: 'amendment', conflictChoices: { cap: 'incoming' } });
    const x = T.row('lh-x');
    is(r.ok && x.cap === 7 && x.reviewOverrides.cap.overrideSource === 'document_decision' && x.reviewOverrides.cap.documentId === h.documentId && FP.isHumanBacked('cap', x),
      'F6 "use the document\'s value": the cap becomes 7 as a HUMAN decision, with the document it came from');
  }
  {
    // Unconfirmed values follow the amendment merge.
    const { T, h } = await heldOn({ tenant_name: 'Whole Health Market', suite: '100', cap: 6, leased_sqft: 5100 }, 'unconfirmed.pdf');
    const r = await T.box.resolveHeldLeaseUpload(h.id, { action: 'attach', targetId: 'lh-x', kind: 'amendment' });
    is(r.ok && T.row('lh-x').cap === 6 && T.row('lh-x').leased_sqft === 5100, 'F7 unconfirmed values follow the existing amendment merge (no prompt)');
  }

  // ════════════════════════════════════════════════════════════════════════
  sec('G · retry / replay never duplicates the document, the evidence or the leasehold');
  {
    const { T, h } = await heldOn({ tenant_name: 'Whole Health Market', suite: '100', cap: 6,
      fieldEvidence: { cap: { snapshots: [{ value: 6, quote: 'six', page: 1, extractedAt: '2026-09-01T00:00:00Z' }] } } }, 'replay.pdf');
    const opts = { action: 'attach', targetId: 'lh-x', kind: 'amendment' };
    const [r1, r2] = await Promise.all([T.box.resolveHeldLeaseUpload(h.id, opts), T.box.resolveHeldLeaseUpload(h.id, opts)]);
    const r3 = await T.box.resolveHeldLeaseUpload(h.id, opts);
    const ams = T.row('lh-x').amendments.filter(a => a.amendmentId === h.id);
    const ev = T.rec.evidence.length;
    is(ams.length === 1 && [r1, r2, r3].filter(r => r.ok && !r.already).length === 1 && r3.already, 'G1 a double click and a replay attach once: one amendment entry');
    // An older copy of the held record comes back (a stale local snapshot).
    T.A().pendingLeaseUploads = [clone(h)];
    const r4 = await T.box.resolveHeldLeaseUpload(h.id, opts);
    is(r4.ok && r4.already && T.held().length === 0 && T.row('lh-x').amendments.filter(a => a.amendmentId === h.id).length === 1 && T.rec.evidence.length === ev,
      'G2 a resurrected copy of a decided upload is recognised and dropped — no second merge, no second evidence');
    eq(T.box._mergeHeldLeaseUploads([], [clone(h)], T.A()), [], 'G3 …and a load cannot bring it back');
    eq([...T.db.docs.values()].filter(d => d.file_name === 'replay.pdf').length, 1, 'G4 one register row for the document');
  }
  {
    // Another session: the decision is already in the record (the amendment entry
    // on lh-x) but a stale copy of the held upload arrives with the load. This
    // session never resolved it, so only the record can say it was decided.
    const { T, h } = await heldOn({ tenant_name: 'Whole Health Market', suite: '100', cap: 6 }, 'other-session.pdf');
    await T.box.resolveHeldLeaseUpload(h.id, { action: 'attach', targetId: 'lh-x', kind: 'amendment' });
    const decided = clone(T.A().tenants.filter(Boolean));
    const R = makeApp();
    R.A().tenants = decided;
    R.box.tenantData.splice(0, R.box.tenantData.length, ...decided);
    R.A().pendingLeaseUploads = [clone(h)];
    eq(R.box._mergeHeldLeaseUploads([], [clone(h)], R.A()), [], 'G2b a new session does not bring back an upload the record shows was attached');
    const r = await R.box.resolveHeldLeaseUpload(h.id, { action: 'attach', targetId: 'lh-x', kind: 'amendment' });
    is(r.ok && r.already && R.row('lh-x').amendments.filter(a => a.amendmentId === h.id).length === 1 && R.rec.evidence.length === 0 && R.held().length === 0,
      'G2c …and replaying its decision there merges nothing twice and writes no evidence');
  }
  {
    const { T, h } = await heldOn({ tenant_name: 'Whole Health Market', suite: '100' }, 'create-twice.pdf');
    await Promise.all([T.box.resolveHeldLeaseUpload(h.id, { action: 'create' }), T.box.resolveHeldLeaseUpload(h.id, { action: 'create' })]);
    await T.box.resolveHeldLeaseUpload(h.id, { action: 'create' });
    eq(T.A().tenants.filter(t => t && t.id === h.id).length, 1, 'G5 creating twice makes ONE new leasehold');
  }
  {
    // A failed extraction retried: the same document id, so the same register row.
    const T = makeApp();
    const f = T.file('retry.pdf', null);
    await T.box.handleBulkLeases([f]);
    const jobId = [...T.box._leaseJobs.keys()][0];
    const failed = T.row(jobId);
    f.__extract = EXT({ tenant_name: 'Retry Co', suite: '901' });
    await T.box.retryLeaseJob(jobId);
    for (let k = 0; k < 20; k++) await tick();          // the retry's register write is not awaited by the app
    const rows = [...T.db.docs.values()].filter(d => d.file_name === 'retry.pdf');
    is(failed && failed.extractionFailed && rows.length === 1 && rows[0].id === T.box._leaseJobs.get(jobId)._documentId && T.row(jobId).tenant_name === 'Retry Co'
      && rows[0].parsing_status === 'success',
      'G6 a retried upload writes the SAME register row (its document id is kept on the job)', JSON.stringify(rows.map(r => r.id)));
    eq(T.A().tenants.filter(t => t && t.id === jobId).length, 1, 'G7 …and is still one leasehold row');
    // The saved roster is deduplicated by id (Bulk Intake B4 saves a retry as a
    // batch is saved), which would hide a second row; the live roster must not have one.
    eq(T.box.tenantData.filter(t => t && t.id === jobId).length, 1, 'G7b …one row in the live roster too (the retry replaced its row by id)');
  }

  // ════════════════════════════════════════════════════════════════════════
  sec('H · the job writes to its own property, by its own id');
  {
    const T = makeApp();
    let open; const gate = new Promise(r => { open = r; });
    const f = T.file('slow.pdf', EXT({ tenant_name: 'Slow Co', suite: '902' }), { __gate: gate });
    const run = T.box.handleBulkLeases([f]);
    await tick(); await tick();
    // The user opens Birch Court while the extraction is still running.
    const B = T.B();
    T.box.activePropId = 'prop-B';
    T.box.tenantData.splice(0, T.box.tenantData.length, null, null, null, ...B.tenants);
    const bBefore = clone(B.tenants);
    open(); await run;
    const jobId = [...T.box._leaseJobs.keys()][0];
    is(!!T.row(jobId) && T.row(jobId).tenant_name === 'Slow Co', 'H1 navigation mid-upload: the new leasehold lands in ITS property (Alder)');
    eq(clone(T.box.tenantData.filter(Boolean)), bBefore, 'H2 …the property now on screen (Birch) is untouched — its live buffer');
    eq(clone(T.B().tenants), bBefore, 'H3 …and its record');
    is(T.rec.saves.every(s => s.id === 'prop-A') && T.rec.resyncs.every(r => r.pid === 'prop-A'), 'H4 …every save and resync of the batch is Alder\'s');
    is(T.rec.saves.some(s => s.id === 'prop-A' && s.tenants.some(t => t.id === 'lh-x') && s.tenants.some(t => t.id === jobId)),
      'H5 …and Alder is saved with its own leaseholds plus the new one (not Birch\'s)');
  }
  {
    const T = makeApp();
    let open; const gate = new Promise(r => { open = r; });
    const run = T.box.handleBulkLeases([T.file('slow-held.pdf', EXT({ tenant_name: 'Whole Health Market', suite: '100' }), { __gate: gate })]);
    await tick(); await tick();
    T.box.activePropId = 'prop-B';
    T.box.tenantData.splice(0, T.box.tenantData.length, ...T.B().tenants);
    open(); await run;
    is(T.held().length === 1 && !(T.B().pendingLeaseUploads || []).length, 'H6 a held upload also stays with its own property after navigation');
  }
  {
    // "Add One Tenant": the upload slot is not a roster index.
    const T = makeApp();
    T.box.tenantData.splice(0, T.box.tenantData.length, ...T.A().tenants);   // leaseholds at indexes 0, 1, 2
    const first = clone(T.box.tenantData[0]);
    await T.box.handleLease(0, T.file('one.pdf', EXT({ tenant_name: 'One Tenant Co', suite: '903' })));
    const jobId = [...T.box._leaseJobs.keys()][0];
    eq(clone(T.box.tenantData[0]), first, 'H7 Add One Tenant into slot 1 leaves the leasehold at roster index 0 exactly as it was');
    is(!!T.row(jobId) && T.row('lh-x') && T.row('lh-y') && T.A().tenants.filter(Boolean).length === 7, 'H8 …the upload is added as its own leasehold; none replaced');
    const T2 = makeApp();
    T2.box.tenantData.splice(0, T2.box.tenantData.length, ...T2.A().tenants);
    await T2.box.handleLease(1, T2.file('one-match.pdf', EXT({ tenant_name: 'Summit Coffee', suite: '210' })));
    is(T2.held().length === 1 && T2.held()[0].candidates[0].id === 'lh-y' && T2.row('lh-y').leaseUrl === null,
      'H9 …and goes through the same identity step: a match is held, not written into the slot');
  }
  {
    // A batch of two: the first resolves into a HELD upload (its placeholder leaves the roster),
    // the second into a new leasehold. The second must land on its own row.
    const T = makeApp();
    let open1, open2;
    const g1 = new Promise(r => { open1 = r; }), g2 = new Promise(r => { open2 = r; });
    const f1 = T.file('first.pdf', EXT({ tenant_name: 'Whole Health Market', suite: '100' }), { __gate: g1 });
    const f2 = T.file('second.pdf', EXT({ tenant_name: 'Second Co', suite: '904' }), { __gate: g2 });
    const run = T.box.handleBulkLeases([f1, f2]);
    await tick(); await tick();
    const [j1, j2] = [...T.box._leaseJobs.keys()];
    open1(); await tick(); await tick(); await tick(); await tick();
    open2(); await run;
    const ids = T.A().tenants.filter(Boolean).map(t => t.id);
    is(!ids.includes(j1) && ids.includes(j2) && T.row(j2).tenant_name === 'Second Co' && T.row(j2).fileName === 'second.pdf',
      'H10 batch of two: the second file lands on its OWN row after the first left the roster', JSON.stringify(ids));
    is(T.row('lh-x').tenant_name === 'Whole Health Market' && !T.A().tenants.some(t => t && t.status === 'pending') && ids.length === 7,
      'H11 …no neighbour overwritten, no stranded placeholder');
  }
  {
    const T = makeApp();
    let open1, open2;
    const g1 = new Promise(r => { open1 = r; }), g2 = new Promise(r => { open2 = r; });
    const run = T.box.handleBulkLeases([T.file('p.pdf', EXT({ tenant_name: 'P Co', suite: '905' }), { __gate: g1 }),
                                        T.file('q.pdf', EXT({ tenant_name: 'Q Co', suite: '906' }), { __gate: g2 })]);
    await tick(); await tick();
    const [jp, jq] = [...T.box._leaseJobs.keys()];
    open2(); await tick(); await tick(); await tick(); open1(); await run;
    is(T.row(jp).tenant_name === 'P Co' && T.row(jq).tenant_name === 'Q Co', 'H12 finishing out of order, each file is written to its own row');
  }
  {
    // Same file name, two genuinely different leases: two leaseholds, two documents.
    const T = makeApp();
    await T.box.handleBulkLeases([T.file('Lease.pdf', EXT({ tenant_name: 'Twin One', suite: '907' }))]);
    T.box.__files['Lease.pdf'].__extract = EXT({ tenant_name: 'Twin Two', suite: '908' });
    await T.box.handleBulkLeases([T.box.__files['Lease.pdf']]);
    const twins = T.A().tenants.filter(t => t && /^Twin/.test(t.tenant_name));
    const docs = [...T.db.docs.values()].filter(d => d.file_name === 'Lease.pdf');
    is(twins.length === 2 && twins[0].id !== twins[1].id, 'H13 two different leases both named Lease.pdf stay two leaseholds (the roster no longer dedupes by file name)');
    is(docs.length === 3 && T.db.docs.get('doc-x').tenant_id === 'lh-x' && twins.every(t => docs.some(d => d.id === t.leaseDocumentId && d.tenant_id === t.id)),
      'H14 …three "Lease.pdf" documents, each linked to its own leasehold; Whole Health Market\'s is never re-pointed');
  }

  // ════════════════════════════════════════════════════════════════════════
  sec('I · reload: a held upload survives and stays out of every roster');
  {
    const T = makeApp();
    await T.box.handleBulkLeases([T.file('survive.pdf', EXT({ tenant_name: 'Whole Health Market', suite: '100', cap: 6 }))]);
    const saved = clone(T.rec.saves[T.rec.saves.length - 1]);
    // A fresh session: the property comes back from what was saved.
    const R = makeApp();
    const A = R.A();
    A.tenants = saved.tenants; A.pendingLeaseUploads = [];
    R.box.tenantData.splice(0, R.box.tenantData.length, null, null, null, ...saved.tenants);
    A.pendingLeaseUploads = R.box._mergeHeldLeaseUploads(A.pendingLeaseUploads, saved.pendingLeaseUploads, A);
    const h = A.pendingLeaseUploads[0];
    is(A.pendingLeaseUploads.length === 1 && h.fileName === 'survive.pdf' && h.documentId && h.extracted && h.extracted.cap === 6,
      'I1 after a reload the held upload is back, with its document id and its extraction');
    is(!A.tenants.some(t => t.id === h.id) && !R.box.tenantData.some(t => t && t.id === h.id), 'I2 …it is not in tenants[] or the live roster');
    // The document the reload finds was written by the first session.
    R.db.docs.set(h.documentId, clone(T.db.docs.get(h.documentId)));
    const r = await R.box.resolveHeldLeaseUpload(h.id, { action: 'attach', targetId: 'lh-x', kind: 'amendment' });
    is(r.ok && R.row('lh-x').cap === 6 && R.db.docs.get(h.documentId).tenant_id === 'lh-x' && R.db.docs.size === T.db.docs.size,
      'I3 …and it can be decided after the reload: same leasehold, the same document row linked');
  }

  // ════════════════════════════════════════════════════════════════════════
  sec('J · the wiring that has no executable seam here');
  {
    const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const at = (f) => HTML.indexOf('<script src="' + f + '"></script>');
    is(at('leasehold-status.js') > 0 && at('field-provenance.js') > 0 && at('lease-upload-identity.js') > at('field-provenance.js')
      && at('lease-upload-identity.js') > at('leasehold-status.js') && at('script.js') > at('lease-upload-identity.js'),
      'J1 index.html loads lease-upload-identity.js after its two dependencies and before script.js');
    is(!/function\s+findTenantMatch\s*\(/.test(SCRIPT) && !/_linkedBy\b/.test(SCRIPT) && !/_needsTenantConfirm\b/.test(SCRIPT),
      'J2 the automatic matcher and its flags are gone from script.js');
    eq(TN.normalizeTenant({ id: 't', tenant_name: 'N', leaseDocumentId: 'doc-1' }).leaseDocumentId, 'doc-1',
      'J3 the normalizer keeps leaseDocumentId (a reload does not lose the document a leasehold was created from)');
    const sbt = fnSource(SCRIPT, 'saveBulkTenant');
    is(/if \(d\.leaseDocumentId && d\.id\) _linkDocAfterSave = \{ documentId: d\.leaseDocumentId, tenantId: d\.id/.test(sbt)
      && /saveLeaseDocument\(\{ propertyId: prop\.id, \.\.\._linkDocAfterSave \}\)/.test(sbt)
      && sbt.indexOf('await resyncTenantsToTable(prop.id, _rows)') < sbt.indexOf('saveLeaseDocument({ propertyId: prop.id, ..._linkDocAfterSave })'),
      'J4 Confirm & Save links a held-for-review leasehold\'s document by its own id, after the row is persisted');
    const api = API;
    is(!/tenant_id:\s*null\s*\}\)/.test(api.slice(api.indexOf("if (method === 'POST')"), api.indexOf("if (method === 'GET')"))),
      'J5 the POST handler never writes tenant_id: null onto an existing row');
  }

  // ════════════════════════════════════════════════════════════════════════
  sec('K · an awaited resync means the rows are written (the register flush depends on it)');
  {
    const runs = [];
    let failNext = false;
    const box = { console: { log() {}, warn() {}, error() {} }, Map, Promise, setTimeout,
      _props: [{ id: 'prop-A-0000', tenants: [{ id: 'a', tenant_name: 'A' }, { id: 'b', tenant_name: 'B' }] }],
      _doResyncTenantsToTable: (pid, rows) => new Promise((res, rej) => setTimeout(() => {
        if (failNext) { failNext = false; runs.push('threw'); rej(new Error('rpc failed')); return; }
        runs.push(rows.map(r => r.id).join('+')); res();
      }, 30)) };
    vm.createContext(box);
    vm.runInContext('const _resyncQueues = new Map();\n' + fnSource(SCRIPT, '_tenantsBelongTo') + '\n' + fnSource(SCRIPT, 'resyncTenantsToTable')
      + '\nthis.resync = resyncTenantsToTable;', box);
    const A = [{ id: 'a', tenant_name: 'A' }], AB = [{ id: 'a', tenant_name: 'A' }, { id: 'b', tenant_name: 'B' }];
    const first = box.resync('prop-A-0000', A);
    await tick();
    let secondDone = false;
    const second = box.resync('prop-A-0000', AB).then(() => { secondDone = true; });
    while (runs.length < 1) await new Promise(r => setTimeout(r, 2));   // the first run has finished; the parked one is running
    await tick();
    is(!secondDone && !runs.includes('a+b'), 'K1 a caller parked behind a running resync is NOT released before its own rows are written');
    await first;
    await second;
    eq(runs, ['a', 'a+b'], 'K2 …it is released when the run carrying its rows completes');
    runs.length = 0; failNext = true;
    const f1 = box.resync('prop-A-0000', A).catch(() => 'threw');
    await tick();
    const f2 = box.resync('prop-A-0000', AB);
    const out = await Promise.race([Promise.all([f1, f2]).then(() => 'released'), new Promise(r => setTimeout(() => r('hung'), 1000))]);
    eq(out, 'released', 'K3 a run that throws never leaves a parked caller waiting forever');
  }

  finished = true;
  out('\n' + (fail ? '\x1b[31m' : '\x1b[32m') + `RESULT: ${pass} passed, ${fail} failed\x1b[0m`);
  if (fail) { out('FAILED:'); failures.forEach(f => out('  - ' + f)); }
  process.exit(fail ? 1 : 0);
})().catch(e => { outErr(e); process.exit(1); });
