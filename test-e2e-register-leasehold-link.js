'use strict';
/**
 * test-e2e-register-leasehold-link.js — a real bulk upload, in a real page,
 * writes each register row against the tenant row's REAL id, after that row
 * exists.
 *
 *   node test-e2e-register-leasehold-link.js
 *
 * Supabase is mocked in the page (nothing leaves the machine): the roster RPC
 * resync_property_tenants is recorded with the time it COMPLETES, and every
 * POST to /api/lease-documents is captured with the time it is SENT. Two
 * uploads through the Documents panel's bulk input:
 *
 *   1  a lease for a tenant the property already has with no lease on file
 *      (a rent-roll row). Since Step A-2 a match is a PROPOSAL: the upload is
 *      held, its register row is written at arrival UNLINKED under its own
 *      document id, and only a person's decision (attach, as the Original
 *      Lease Copy) links that same document id to THAT tenant's existing id;
 *   2  a lease for a new tenant — the register row must carry the new tenant
 *      row's id (the job id), the same id the roster RPC wrote.
 *
 * A register POST that names a tenant is sent only after the batch's roster
 * RPC has completed, and its tenantId is an id a tenant row has. Before 039
 * the bulk path sent norm.id — an id no tenant row ever had.
 */
let pw;
try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }
const { chromium } = pw;
const http = require('http');
const fs   = require('fs');
const path = require('path');
const { signIn: _e2eSignIn, attachDiagnostics } = require('./test-support/e2e-login');

const PORT     = parseInt(process.env.APP_PORT || '7853', 10);
const HEADLESS = process.env.HEADLESS !== 'false';
const ROOT     = __dirname;

let failures = 0;
const pass = (l) => console.log('\x1b[32m  ✅ ' + l + '\x1b[0m');
const fail = (l, d) => { console.error('\x1b[31m  ❌ ' + l + (d ? ' — ' + d : '') + '\x1b[0m'); failures++; };
const assert = (c, l, d) => (c ? pass(l) : fail(l, d));
const section = (l) => console.log('\n── ' + l + ' ' + '─'.repeat(Math.max(0, 60 - l.length)));

const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon' };
function startServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const u = req.url.split('?')[0];
      const filePath = path.join(ROOT, u === '/' ? '/index.html' : u);
      fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); res.end('not found'); return; }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
        res.end(data);
      });
    });
    server.listen(PORT, '127.0.0.1', () => resolve(server));
    server.on('error', reject);
  });
}

const PROP_ID = 'cascade-commons-e2e';
const RR_ID   = '0b7c9d2e-1111-4111-8111-000000000001';   // an existing tenant with no lease on file

const SUPABASE_MOCK = `
(function() {
  var USER_ID = 'e2e-register-user';
  var _user = { id: USER_ID, email: 'register-test@e2e-test.local' };
  var _session = null;
  var _store = {
    properties: [{
      id: '${PROP_ID}', user_id: USER_ID, name: 'Cascade Commons', sqft: 10000, lifecycle_stage: 'acquired',
      data: {
        invoices: [], disputes: [], camYear: 2024, results: null, camReconciliation: null,
        activityLog: [], timeline: [], escrowReserves: [], drawRequests: [],
        tenants: [{ id: '${RR_ID}', tenant_name: 'Cascade Hardware Co', leased_sqft: 1200, lease_type: 'NNN' }],
      },
    }],
    tenants: [{ id: '${RR_ID}', property_id: '${PROP_ID}', name: 'Cascade Hardware Co', sqft: 1200 }],
  };
  window.__rpcLog = [];
  function P(v) { return Promise.resolve(v); }
  function makeQ(t) {
    var f = {}, fin = {}, fis = {};
    var q = {
      select: function() { return q; },
      insert: function(rows) { var a = Array.isArray(rows) ? rows : [rows]; a.forEach(function(r){ if (!r.id) r.id = 'row-' + Math.random().toString(36).slice(2); (_store[t] = _store[t] || []).push(r); });
        var r = P({ data: a, error: null }); r.select = function(){ return { single: function(){ return P({ data: a[0], error: null }); }, then: function(fn){ return P({ data: a, error: null }).then(fn); } }; }; return r; },
      upsert: function(row) { var a = Array.isArray(row) ? row : [row]; a.forEach(function(x){ var arr = (_store[t] = _store[t] || []); var i = arr.findIndex(function(r){ return r.id === x.id; }); if (i >= 0) arr[i] = x; else arr.push(x); });
        var r = P({ data: a, error: null }); r.select = function(){ return P({ data: a, error: null }); }; return r; },
      update: function() { var r = P({ data: null, error: null }); r.select = function(){ return P({ data: null, error: null }); }; r.eq = function(){ return P({ data: null, error: null }); }; return r; },
      delete: function() { return { eq: function(){ return P({ error: null }); }, in: function(){ return P({ error: null }); } }; },
      eq: function(c, v) { f[c] = v; return q; }, neq: function(){ return q; }, not: function(){ return q; },
      is: function(c, v) { fis[c] = v; return q; }, gt: function(){ return q; }, gte: function(){ return q; },
      lt: function(){ return q; }, lte: function(){ return q; }, ilike: function(){ return q; }, or: function(){ return q; },
      range: function(){ return q; }, match: function(){ return q; }, contains: function(){ return q; },
      in: function(c, v) { fin[c] = v; return q; }, order: function(){ return q; }, limit: function(){ return q; },
      single: function() { var rows = (_store[t] || []).filter(function(r){ return Object.keys(f).every(function(k){ return r[k] === f[k]; }); }); return P({ data: rows[0] || null, error: null }); },
      maybeSingle: function() { return q.single(); },
      then: function(fn) { var rows = (_store[t] || []).filter(function(r){ return Object.keys(f).every(function(k){ return r[k] === f[k]; }) && Object.keys(fin).every(function(k){ return (fin[k] || []).indexOf(r[k]) !== -1; }) && Object.keys(fis).every(function(k){ return fis[k] === null ? r[k] == null : r[k] === fis[k]; }); }); return P({ data: rows, error: null }).then(fn); }
    };
    return q;
  }
  function makeSession() { return { user: _user, access_token: 'mock-access-token', expires_at: (Date.now() / 1000) + 3600 }; }
  window.supabase = { createClient: function() { return {
    auth: {
      getUser: function(){ return P({ data: { user: _session ? _user : null }, error: null }); },
      getSession: function(){ return P({ data: { session: _session }, error: null }); },
      refreshSession: function(){ return P({ data: { session: _session }, error: null }); },
      signUp: function(){ _session = makeSession(); return P({ data: { session: _session, user: _user }, error: null }); },
      signInWithPassword: function(){ _session = makeSession(); return P({ data: { session: _session, user: _user }, error: null }); },
      onAuthStateChange: function(){ return { data: { subscription: { unsubscribe: function(){} } } }; },
      signOut: function(){ _session = null; return P({ error: null }); }
    },
    from: function(t) { if (!_store[t]) _store[t] = []; return makeQ(t); },
    rpc: function(name, args) {
      // The roster write takes a moment, as a real round trip does; its
      // completion time is what the register writes are measured against.
      return new Promise(function(resolve) { setTimeout(function() {
        if (name === 'resync_property_tenants') {
          var rows = (args && args.p_rows) || [];
          rows.forEach(function(r){ var arr = _store.tenants; var i = arr.findIndex(function(x){ return x.id === r.id; }); var row = Object.assign({ property_id: args.p_property_id }, r); if (i >= 0) arr[i] = row; else arr.push(row); });
          window.__rpcLog.push({ name: name, ids: rows.map(function(r){ return r.id; }), names: rows.map(function(r){ return r.name; }), doneAt: Date.now() });
          resolve({ data: { ok: true, upserted: rows.length, deleted: 0 }, error: null });
        } else { resolve({ data: null, error: null }); }
      }, 400); });
    },
    _store: _store
  }; } };
  window.__e2eStore = _store;
})();
`;

const lease = (tenant, sqft) => ({
  tenant_name: tenant, lease_start_date: '2024-01-01', lease_end_date: '2029-12-31', lease_type: 'NNN',
  sqft, cam_cap: 4, property_name: 'Cascade Commons', quotes: {},
});
const leaseText = (tenant, sqft) => `
LEASE AGREEMENT
This lease covers premises located at Cascade Commons.
Tenant: ${tenant}. Commencement Date: January 1, 2024. Expiration Date: December 31, 2029.
Tenant shall lease approximately ${sqft} square feet. This is a Triple Net (NNN) lease.
CAM charges shall not increase more than 4% per annum.
`.repeat(4);

(async () => {
  const server  = await startServer();
  const browser = await chromium.launch({ headless: HEADLESS,
    executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  const errors = attachDiagnostics(page);
  const consoleLogs = [];
  page.on('console', m => consoleLogs.push({ type: m.type(), text: m.text() }));
  page.on('pageerror', e => consoleLogs.push({ type: 'PAGEERROR', text: e.message }));

  const registerPosts = [];
  await page.route('**/supabase-js**', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: '/* suppressed */' }));
  await page.route('**/api/cam-reconciliations**', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) }));
  await page.route('**fonts.g**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.addInitScript(SUPABASE_MOCK);
  await page.route('**/api/upload', r => r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ url: 'leases/u/' + PROP_ID + '_' + Date.now() + '-lease.txt' }) }));
  await page.route('**/api/lease-documents**', r => {
    const req = r.request();
    if (req.method() === 'POST') {
      registerPosts.push({ sentAt: Date.now(), body: JSON.parse(req.postData() || '{}') });
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: [{}], linked: true }) });
    }
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) });
  });

  try {
    section('Sign in and open the property');
    // ?signin=1 is the app's own "straight to the sign-in form" entry, so the
    // marketing overlay does not sit on top of the form.
    await page.goto('http://127.0.0.1:' + PORT + '/?signin=1', { waitUntil: 'networkidle', timeout: 30000 });
    await page.evaluate(() => { try { MainStreetLanding.hide(); } catch (_) {} });
    await _e2eSignIn(page, { email: 'register-test@e2e-test.local', errors });
    await page.waitForSelector('.ptf-prop-card:not(.ptf-demo-card)', { timeout: 15000 });
    await page.evaluate((id) => selectProperty(id), PROP_ID);
    await page.waitForFunction(() => { const el = document.getElementById('propertyName'); return el && el.value === 'Cascade Commons'; }, null, { timeout: 45000 });
    await page.evaluate(() => { if (typeof switchWorkspaceTab === 'function') switchWorkspaceTab('documents'); });
    assert(true, 'workspace open');

    async function upload(tenant, sqft, file) {
      await page.unroute('**/api/claude').catch(() => {});
      // The pipeline asks two things of /api/claude: the lease's terms and, since
      // Bulk Intake B5, what kind of document it is (document_classification).
      // These are original leases.
      await page.route('**/api/claude', r => {
        let task = null; try { task = JSON.parse(r.request().postData() || '{}').task; } catch (_) {}
        const body = task === 'document_classification'
          ? { docType: 'original_lease', docDate: null, tenantName: tenant, suite: null, confidence: 0.95, evidence: 'LEASE AGREEMENT' }
          : lease(tenant, sqft);
        return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      });
      const before = registerPosts.length;
      const rpcBefore = await page.evaluate(() => window.__rpcLog.length);
      await page.setInputFiles('#bulkLeaseInput', { name: file, mimeType: 'text/plain', buffer: Buffer.from(leaseText(tenant, sqft), 'utf-8') });
      const t0 = Date.now();
      while (registerPosts.length === before && Date.now() - t0 < 45000) await page.waitForTimeout(100);
      await page.waitForTimeout(300);
      const rpc = await page.evaluate((n) => window.__rpcLog.slice(n), rpcBefore);
      const rows = await page.evaluate((nm) => (tenantData || []).filter(t => t && t.tenant_name && t.tenant_name.indexOf(nm) === 0)
        .map(t => ({ id: t.id, jobId: t._jobId || null, name: t.tenant_name })), tenant);
      return { post: registerPosts.slice(before), rpc, rows };
    }

    section('1 · a lease for a tenant the property already has (no lease on file) — held, then attached by a person');
    {
      const r = await upload('Cascade Hardware Co', 1200, 'cascade-hardware-lease.txt');
      const p = r.post[0];
      assert(r.post.length === 1, '1a exactly one register row is written at arrival', String(r.post.length));
      assert(p && !p.body.tenantId && /^[0-9a-f-]{36}$/.test(p.body.documentId || ''), '1b …UNLINKED, under the document\'s own id (the match is only a proposal)',
        JSON.stringify(p && { tenantId: p.body.tenantId, documentId: p.body.documentId }));
      assert(p && p.body.fileName === 'cascade-hardware-lease.txt' && /LEASE AGREEMENT/.test(p.body.extractedText || ''),
        '1c the same document fields as before (file name, extracted text)');
      const held = await page.evaluate(() => (currentProperty().pendingLeaseUploads || []).map(h => ({ id: h.id, documentId: h.documentId, cands: (h.candidates || []).map(c => c.id) })));
      assert(held.length === 1 && held[0].cands.join() === RR_ID && held[0].documentId === (p && p.body.documentId),
        '1d the upload is held with the existing tenant as its candidate, and the same document id', JSON.stringify(held));
      assert(r.rows.length === 1 && r.rows[0].id === RR_ID && !r.rows[0].jobId, '1e the existing tenant row is untouched: its id, no job stamped on it, no second row', JSON.stringify(r.rows));
      // A person decides: this is the lease of the rent-roll row that had none.
      const before = registerPosts.length;
      const res = await page.evaluate(async (a) => resolveHeldLeaseUpload(a.id, { action: 'attach', targetId: a.target, kind: 'original_lease' }), { id: held[0] && held[0].id, target: RR_ID });
      await page.waitForTimeout(300);
      const link = registerPosts.slice(before)[0];
      assert(res && res.ok && res.leaseholdId === RR_ID, '1f attach keeps the existing leasehold id', JSON.stringify(res));
      assert(link && link.body.documentId === p.body.documentId && link.body.tenantId === RR_ID && link.body.docType === 'original_lease',
        '1g …and links the SAME document id to it, with the kind the person confirmed', JSON.stringify(link && link.body));
      const after = await page.evaluate((id) => { const t = (tenantData || []).find(x => x && x.id === id); return t && { id: t.id, leaseUrl: !!t.leaseUrl, docId: t.leaseDocumentId }; }, RR_ID);
      assert(after && after.leaseUrl && after.docId === p.body.documentId, '1h the leasehold now has its lease on file, by the document id', JSON.stringify(after));
    }

    section('2 · a lease for a new tenant');
    {
      const r = await upload('Summit Coffee & Provisions', 900, 'summit-coffee-lease.txt');
      const p = r.post[0];
      const row = r.rows[0];
      assert(r.post.length === 1, '2a exactly one register row is written', String(r.post.length));
      assert(p && r.rpc.length && p.sentAt >= r.rpc[r.rpc.length - 1].doneAt,
        '2b the register row is sent AFTER the roster write completed',
        p && r.rpc.length ? (p.sentAt - r.rpc[r.rpc.length - 1].doneAt) + ' ms' : 'no timing');
      assert(row && p && p.body.tenantId === row.id, '2c tenantId = the new tenant row\'s id', JSON.stringify({ sent: p && p.body.tenantId, row }));
      assert(row && row.id === row.jobId, '2d …which is the job id (jobId IS the tenantId)', JSON.stringify(row));
      assert(r.rpc.some(x => x.ids.includes(p && p.body.tenantId)), '2e …an id the roster write actually wrote');
      assert(r.rows.length === 1, '2f one tenant row for one lease (no extra row per document)', JSON.stringify(r.rows));
    }

    section('3 · every register id is a real tenant id');
    {
      const tenantIds = await page.evaluate(() => (window.__e2eStore.tenants || []).map(t => t.id));
      const named = registerPosts.filter(p => p.body.tenantId);
      assert(registerPosts.length === 3 && named.length === 2 && named.every(p => tenantIds.includes(p.body.tenantId)),
        '3a no register row names an id that no tenant row has (the held arrival names none)', JSON.stringify(registerPosts.map(p => p.body.tenantId || null)));
    }

    section('4 · console');
    const real = consoleLogs.filter(l => (l.type === 'error' || l.type === 'PAGEERROR')
      && !/favicon|Failed to load resource|ERR_CERT_AUTHORITY_INVALID|\[saveCamResults\]/.test(l.text));
    assert(real.length === 0, '4a no console errors across the upload flow', JSON.stringify(real.slice(0, 5)));
  } catch (e) {
    fail('UNCAUGHT', e.message);
    console.error(e.stack);
    consoleLogs.slice(-30).forEach(l => console.error(l.type + ': ' + l.text));
  } finally {
    await browser.close();
    server.close();
  }
  console.log('\n' + '─'.repeat(64));
  console.log(failures === 0 ? '\x1b[32m✅ All register-link checks passed\x1b[0m' : '\x1b[31m❌ ' + failures + ' check(s) failed\x1b[0m');
  process.exit(failures === 0 ? 0 : 1);
})();
