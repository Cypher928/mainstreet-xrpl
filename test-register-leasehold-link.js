'use strict';
/**
 * test-register-leasehold-link.js — lease_documents.tenant_id is the leasehold
 * the document belongs to, written against the REAL tenant id, never lost.
 *
 *   node test-register-leasehold-link.js
 *
 * Migration 039 makes lease_documents.tenant_id a property-scoped foreign key
 * (lease_documents_leasehold_fk). This suite pins the client and API half:
 *
 *   A  api/lease-documents.js — the REAL handler, with fetch mocked (nothing
 *      leaves the process): a link the constraint accepts is written once
 *      and reported linked:true; a link the constraint refuses is written once
 *      more with tenant_id null and reported linked:false, every other field
 *      identical, on the INSERT path; the PATCH path (Step A-2: only the SAME
 *      leasehold's same-named row) never names or drops a link; any OTHER error is not
 *      retried; no tenantId means one write; auth and ownership still refuse
 *      before any write
 *   B  the bulk pipeline writes the tenant row's real id (never norm.id), the
 *      same id the extraction evidence uses; handleBulkLeases queues the
 *      register writes and flushes them AFTER the batch's tenant resync, in a
 *      finally; the single-file retry writes immediately
 *   C  the queue helpers: sequential, the vision-text promise is awaited at
 *      write time, a rejected text becomes null, a failed write does not stop
 *      the rest, and the queue is emptied
 *   D  the deleters: confirmDeleteProperty deletes the property (cascade), not
 *      tenants first; Clear All keeps tenants a document is linked to and
 *      deletes nothing if that set cannot be read; the direct-write resync
 *      fallback counts lease_documents as a reference
 */
const fs   = require('fs');
const path = require('path');
const { fnSource } = require('./test-support/fn-source');

const ROOT = __dirname;
let pass = 0, fail = 0;
const ok  = (label, cond, detail) => { if (cond) { pass++; console.log('  \x1b[32m✓\x1b[0m ' + label); }
                                       else { fail++; console.log('  \x1b[31m✗\x1b[0m ' + label + (detail ? '  — ' + detail : '')); } };
const sec = (s) => console.log('\n── ' + s + ' ' + '─'.repeat(Math.max(0, 60 - s.length)));

const SRC = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');
const API = fs.readFileSync(path.join(ROOT, 'api/lease-documents.js'), 'utf8');
const stripComments = (s) => s.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

// ── A · the real handler, fetch mocked ───────────────────────────────────────
function loadHandler(fetchImpl) {
  const src = API.replace(/export\s+default\s+async\s+function\s+handler/, 'module.exports = async function handler');
  const mod = { exports: {} };
  const req = (p) => require(p.startsWith('.') ? path.join(ROOT, 'api', p) : p);
  const saved = global.fetch;
  global.fetch = fetchImpl;
  // eslint-disable-next-line no-new-func
  new Function('require', 'module', 'exports', 'process', src)(req, mod, mod.exports, process);
  return { handler: mod.exports, restore: () => { global.fetch = saved; } };
}
function mockRes() {
  return { statusCode: 200, body: null, headers: {},
    status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; },
    setHeader(k, v) { this.headers[k] = v; } };
}
const FK_REFUSAL = { code: '23503', details: 'Key (tenant_id, property_id)=(t, p) is not present in table "tenants".',
  hint: null, message: 'insert or update on table "lease_documents" violates foreign key constraint "lease_documents_leasehold_fk"' };
const OTHER_FK   = { code: '23503', details: 'Key (property_id)=(p) is not present in table "properties".',
  hint: null, message: 'insert or update on table "lease_documents" violates foreign key constraint "lease_documents_property_id_fkey"' };

/** Script: an ordered list of responses for Supabase REST writes; reads are routed by path. */
function scenario({ existing = [], writes = [], owns = true, authed = true }) {
  const calls = [];
  const w = writes.slice();
  const fetchImpl = async (url, opts = {}) => {
    const u = String(url);
    const method = (opts.method || 'GET').toUpperCase();
    const body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ u, method, body });
    const resp = (status, json) => ({ ok: status < 300, status, json: async () => json, text: async () => JSON.stringify(json) });
    if (u.includes('/auth/v1/user')) return authed ? resp(200, { id: 'user-1' }) : resp(401, {});
    if (u.includes('/rest/v1/properties?')) return resp(200, owns ? [{ id: 'prop-1' }] : []);
    if (u.includes('/rest/v1/lease_documents?') && method === 'GET') return resp(200, existing);
    if (u.includes('/rest/v1/lease_documents') && (method === 'POST' || method === 'PATCH')) {
      const next = w.shift() || { status: 201, json: [{ id: 'doc-1', ...body }] };
      return resp(next.status, next.json);
    }
    return resp(500, { raw: 'unmocked ' + method + ' ' + u });
  };
  return { fetchImpl, calls };
}
const POST_BODY = { propertyId: 'prop-1', tenantId: 'tenant-real', tenantName: 'Acme', fileName: 'acme-lease.pdf',
  fileUrl: 'leases/u/p_1-acme-lease.pdf', extractedText: 'TEXT', parsingStatus: 'success',
  extractionModel: 'm', usedPdfDirect: false };
async function call(sc, body, { headers = { authorization: 'Bearer tok' } } = {}) {
  const { handler, restore } = loadHandler(sc.fetchImpl);
  const res = mockRes();
  try { await handler({ method: 'POST', headers, body }, res); } finally { restore(); }
  return res;
}
const writesOf = (sc) => sc.calls.filter(c => c.u.includes('/rest/v1/lease_documents') && c.method !== 'GET');

(async () => {
  sec('A · api/lease-documents.js — the real handler');
  {
    const sc = scenario({});
    const r = await call(sc, POST_BODY);
    const ws = writesOf(sc);
    ok('A1 link accepted → one INSERT, tenant_id = the id sent, linked:true',
      r.statusCode === 200 && r.body.linked === true && ws.length === 1 && ws[0].method === 'POST' && ws[0].body.tenant_id === 'tenant-real',
      JSON.stringify({ s: r.statusCode, b: r.body, n: ws.length }));
  }
  {
    const sc = scenario({ writes: [{ status: 409, json: FK_REFUSAL }] });
    const r = await call(sc, POST_BODY);
    const ws = writesOf(sc);
    ok('A2 link REFUSED by lease_documents_leasehold_fk → saved once more, unlinked, linked:false',
      r.statusCode === 200 && r.body.ok === true && r.body.linked === false && ws.length === 2
      && ws[0].body.tenant_id === 'tenant-real' && ws[1].body.tenant_id === null,
      JSON.stringify({ s: r.statusCode, b: r.body, n: ws.length }));
    const a = { ...ws[0].body }, b = { ...ws[1].body }; delete a.tenant_id; delete b.tenant_id;
    ok('A3 the retry changes tenant_id and nothing else (same file, text, url, status, model)',
      JSON.stringify(a) === JSON.stringify(b) && ws[1].method === 'POST');
  }
  {
    // Step A-2: a same-named row is updated only when it is ALREADY this
    // leasehold's; the PATCH carries no tenant_id, so it can neither re-point
    // nor unlink, and there is nothing for the constraint to refuse.
    const sc = scenario({ existing: [{ id: 'doc-existing', tenant_id: 'tenant-real' }] });
    const r = await call(sc, POST_BODY);
    const ws = writesOf(sc);
    ok('A4 the PATCH path (the same leasehold\'s own same-named row) updates that row in place and never touches its link',
      r.body && r.body.linked === true && ws.length === 1 && ws[0].method === 'PATCH' && /id=eq\.doc-existing/.test(ws[0].u)
      && !('tenant_id' in ws[0].body), JSON.stringify({ b: r.body, ws: ws.map(w => w.method + ' ' + w.u) }));
  }
  {
    const sc = scenario({ writes: [{ status: 409, json: OTHER_FK }] });
    const r = await call(sc, POST_BODY);
    ok('A5 a DIFFERENT constraint (property FK) is not retried and still fails (502)',
      r.statusCode === 502 && writesOf(sc).length === 1, JSON.stringify({ s: r.statusCode, n: writesOf(sc).length }));
  }
  {
    const sc = scenario({ writes: [{ status: 500, json: { code: 'XX000', message: 'boom' } }] });
    const r = await call(sc, POST_BODY);
    ok('A6 a non-FK error is not retried and still fails (502)', r.statusCode === 502 && writesOf(sc).length === 1);
  }
  {
    const sc = scenario({});
    const r = await call(sc, { ...POST_BODY, tenantId: undefined });
    const ws = writesOf(sc);
    ok('A7 no tenantId → one write, tenant_id null, linked:false (a property document)',
      r.body.linked === false && ws.length === 1 && ws[0].body.tenant_id === null);
  }
  {
    const sc = scenario({ writes: [{ status: 409, json: FK_REFUSAL }] });
    const r = await call(sc, { ...POST_BODY, tenantId: undefined });
    ok('A8 a refusal with no tenant to drop is NOT retried (the fallback only ever removes a link)',
      r.statusCode === 502 && writesOf(sc).length === 1);
  }
  {
    const sc = scenario({ owns: false });
    const r = await call(sc, POST_BODY);
    ok('A9 not the owner → 403 before any write (unchanged)', r.statusCode === 403 && writesOf(sc).length === 0);
    const sc2 = scenario({});
    const r2 = await call(sc2, POST_BODY, { headers: {} });
    ok('A10 no token → 401 before any write (unchanged)', r2.statusCode === 401 && writesOf(sc2).length === 0);
  }
  ok('A11 the refusal matcher names the constraint and the code, nothing broader',
    /obj\.code === '23503'/.test(API) && /lease_documents_leasehold_fk/.test(API));

  // ── B · the bulk pipeline ──────────────────────────────────────────────────
  sec('B · bulk upload writes the real id, after the tenant rows');
  const pipe = stripComments(fnSource(SRC, '_runLeaseJobPipeline'));
  ok('B1 the discarded norm.id is no longer written anywhere', !/tenantId:\s*norm\?\.id/.test(SRC));
  ok('B2 the register write uses the linked tenant id', /tenantId:\s*_linkedTenantId\s*\|\|\s*null/.test(pipe));
  ok('B3 …defined once: none while the upload is held for a leasehold decision, else this job\'s (finalEntry.id)',
    /const _linkedTenantId = _held \? null : finalEntry\.id;/.test(pipe)
    && (pipe.match(/const _linkedTenantId\b/g) || []).length === 1);
  ok('B4 …and the extraction evidence uses the SAME id (one rule, two writes)',
    /_persistExtractedEvidence\(propertyId, _linkedTenantId,/.test(pipe));
  ok('B5 finalEntry still takes id: jobId (the tenant row id is unchanged)', /id:\s+jobId,/.test(pipe));
  ok('B6 queued when the caller passes a queue (and the row names a tenant), immediate otherwise',
    /if \(Array\.isArray\(registerQueue\) && !_held\) registerQueue\.push\(_registerWrite\);\s*else _saveLeaseRegisterWrite\(_registerWrite\);/.test(pipe));
  const bulk = stripComments(fnSource(SRC, 'handleBulkLeases'));
  ok('B7 handleBulkLeases passes its queue to the pipeline', /_runLeaseJobPipeline\(jobId, _registerQueue\)/.test(bulk));
  const iResync = bulk.indexOf('await resyncTenantsToTable(propertyId');
  const iFlush  = bulk.indexOf('await _flushLeaseRegisterWrites(_registerQueue)');
  ok('B8 …and flushes it AFTER the batch\'s tenant resync', iResync > 0 && iFlush > iResync);
  ok('B9 …in a finally, so a failed save never drops a document',
    /try\s*\{[^]*?await saveProperty\(target\);[^]*?await resyncTenantsToTable\([^]*?\}\s*finally\s*\{\s*await _flushLeaseRegisterWrites\(_registerQueue\);\s*\}/.test(bulk));
  ok('B10 the single-file retry keeps calling the pipeline without a queue (immediate write)',
    /await _runLeaseJobPipeline\(jobId\);/.test(SRC));
  ok('B11 the pipeline is called from exactly the two places it was', (SRC.match(/await _runLeaseJobPipeline\(/g) || []).length === 2);

  // ── C · the queue helpers, executed ────────────────────────────────────────
  sec('C · queue helpers (executed)');
  {
    const saved = [];
    let active = 0, maxActive = 0;
    const saveLeaseDocument = async (w) => {
      active++; maxActive = Math.max(maxActive, active);
      await new Promise(r => setTimeout(r, 5));
      active--;
      if (w.fileName === 'boom.pdf') throw new Error('network');
      saved.push(w);
      return { ok: true };
    };
    // eslint-disable-next-line no-new-func
    const env = new Function('saveLeaseDocument', 'console',
      fnSource(SRC, '_saveLeaseRegisterWrite') + '\n' + fnSource(SRC, '_flushLeaseRegisterWrites') +
      '\nreturn { _saveLeaseRegisterWrite, _flushLeaseRegisterWrites };')(saveLeaseDocument, { warn() {}, log() {} });
    // A rejected text, marked handled as the product's own vision promise is
    // (extractTextFromPdfDirect(file).catch(...)); awaiting it still throws.
    const rejected = Promise.reject(new Error('ocr')); rejected.catch(() => {});
    const queue = [
      { propertyId: 'p', tenantId: 'a', fileName: 'a.pdf', extractedText: Promise.resolve('vision text') },
      { propertyId: 'p', tenantId: 'b', fileName: 'boom.pdf', extractedText: 'x' },
      { propertyId: 'p', tenantId: 'c', fileName: 'c.pdf', extractedText: rejected },
      { propertyId: 'p', tenantId: 'd', fileName: 'd.pdf', extractedText: null },
    ];
    const n = await env._flushLeaseRegisterWrites(queue);
    ok('C1 every queued write is attempted (4), and the queue is emptied', n === 4 && queue.length === 0);
    ok('C2 one request at a time', maxActive === 1, 'max concurrent ' + maxActive);
    ok('C3 the vision-text promise is awaited at write time', saved[0] && saved[0].extractedText === 'vision text');
    ok('C4 a rejected text becomes null, the document is still written', saved.find(s => s.fileName === 'c.pdf')?.extractedText === null);
    ok('C5 a failed write does not stop the rest', saved.map(s => s.fileName).join(',') === 'a.pdf,c.pdf,d.pdf');
    ok('C6 the id passed through is the queued one, untouched', saved.map(s => s.tenantId).join(',') === 'a,c,d');
    ok('C7 an empty or missing queue is a no-op', (await env._flushLeaseRegisterWrites([])) === 0 && (await env._flushLeaseRegisterWrites(null)) === 0);
  }

  // ── D · the deleters ───────────────────────────────────────────────────────
  sec('D · deleters no longer delete linked leaseholds');
  const del = stripComments(fnSource(SRC, 'confirmDeleteProperty'));
  ok('D1 confirmDeleteProperty no longer deletes tenants first', !/from\('tenants'\)\.delete\(\)/.test(del));
  ok('D2 …it deletes the property (one statement; the cascade does the rest)', /db\.from\('properties'\)\.delete\(\)\.eq\('id', propId\)/.test(del));
  // Step A-1 (D6) made both of these stronger than 039 did: they no longer
  // delete a leasehold at all, linked or not. A leasehold is not deleted for
  // leaving a list; test-lifecycle-plumbing.js runs both against a fake database.
  const clr = stripComments(fnSource(SRC, 'clearBulkResults'));
  ok('D3 Clear All deletes no tenants row — linked or not', !/from\('tenants'\)/.test(clr));
  ok('D4 …so it no longer needs the linked-document read at all', !/from\('lease_documents'\)/.test(clr));
  ok('D5 …and its confirmation says leaseholds are kept', /saved for this property are not deleted/.test(clr) && !/cannot be undone/.test(clr));
  const fb = stripComments(fnSource(SRC, '_doResyncTenantsDirectly'));
  ok('D6 the direct-write resync fallback upserts on id', /from\('tenants'\)\.upsert\(insertRows, \{ onConflict: 'id' \}\)/.test(fb));
  ok('D7 …and prunes nothing, so no absentee is deleted', !/\.delete\(\)/.test(fb));

  console.log('\n' + '─'.repeat(64));
  console.log(`RESULT: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
