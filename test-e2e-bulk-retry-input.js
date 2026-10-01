'use strict';
/**
 * test-e2e-bulk-retry-input.js — Bulk Intake B1 / B4 in a real page.
 *
 *   node test-e2e-bulk-retry-input.js
 *
 * The app's real index.html and script.js, Supabase mocked in the page
 * (nothing leaves the machine). A property is opened with a FAILED lease
 * upload in its saved roster — as after a reload: the job is not in memory and
 * no copy of the file is kept.
 *
 *   1  Retry asks for the file on its OWN input (#leaseRetryInput); the Upload
 *      Leases control (#bulkLeaseInput) keeps its own handler
 *   2  the person cancels — then uploads two new leases with the Upload Leases
 *      control: BOTH are new uploads, neither is written over the failed row
 *   3  Retry again, answered: the failed upload is re-read under its own id,
 *      saved, synced, and its register row linked by its own document id
 *   4  a fresh page opened from what was saved shows the retried leasehold
 *
 * Before the fix, Retry borrowed #bulkLeaseInput (retryUploadForSlot): a
 * cancelled retry left the next normal upload to be swallowed as a retry of
 * that row (first file only), and a completed one disabled the control.
 */
let pw;
try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }
const { chromium } = pw;
const http = require('http');
const fs   = require('fs');
const path = require('path');
const { signIn: _e2eSignIn, attachDiagnostics } = require('./test-support/e2e-login');

const PORT     = parseInt(process.env.APP_PORT || '8862', 10);
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

const MOCK_TEMPLATE = `
(function() {
  var USER_ID = 'e2e-bulk-retry-user';
  var _user = { id: USER_ID, email: 'bulk-retry@e2e-test.local' };
  var _session = null;
  var _store = __SEED__;
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


const PROP_ID   = 'bulk-retry-e2e';
const FAILED_ID = '0b7c9d2e-2222-4222-8222-0000000000f1';
const DOC_ID    = '0b7c9d2e-3333-4333-8333-0000000000d1';
const SEED = {
  properties: [{
    id: PROP_ID, user_id: 'e2e-bulk-retry-user', name: 'Juniper Square', sqft: 20000, lifecycle_stage: 'acquired',
    data: {
      invoices: [], disputes: [], camYear: 2024, results: null, camReconciliation: null,
      activityLog: [], timeline: [], escrowReserves: [], drawRequests: [], pendingLeaseUploads: [],
      tenants: [{ id: FAILED_ID, _jobId: FAILED_ID, tenant_name: null, fileName: 'unreadable-scan.pdf', status: 'failed',
                  extractionFailed: true, _showRetry: true, leaseExpected: true, leaseDocumentId: DOC_ID,
                  _error: 'Extraction failed — tap Retry to re-upload' }],
    },
  }],
  tenants: [],
};
const mockFor = (seed) => MOCK_TEMPLATE.replace('__SEED__', JSON.stringify(seed));

const lease = (tenant, sqft) => ({
  tenant_name: tenant, lease_start_date: '2024-01-01', lease_end_date: '2029-12-31', lease_type: 'NNN',
  sqft, cam_cap: 4, property_name: 'Juniper Square', quotes: {},
});
const leaseText = (tenant, sqft) => `
LEASE AGREEMENT
This lease covers premises located at Juniper Square.
Tenant: ${tenant}. Commencement Date: January 1, 2024. Expiration Date: December 31, 2029.
Tenant shall lease approximately ${sqft} square feet. This is a Triple Net (NNN) lease.
`.repeat(4);
const leaseFile = (tenant, sqft, name) => ({ name, mimeType: 'text/plain', buffer: Buffer.from(leaseText(tenant, sqft), 'utf-8') });

async function openPage(browser, seed, registerPosts, consoleLogs) {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  const errors = attachDiagnostics(page);
  page.on('console', m => consoleLogs.push({ type: m.type(), text: m.text() }));
  page.on('pageerror', e => consoleLogs.push({ type: 'PAGEERROR', text: e.message }));
  await page.route('**/supabase-js**', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: '/* suppressed */' }));
  await page.route('**/api/cam-reconciliations**', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) }));
  await page.route('**fonts.g**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.addInitScript(mockFor(seed));
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
  // /api/claude: the lease's terms, read from the text it is sent; and what kind
  // of document it is (document_classification) — every file here is a lease.
  await page.route('**/api/claude', r => {
    let req = {}; try { req = JSON.parse(r.request().postData() || '{}'); } catch (_) {}
    const content = JSON.stringify(req.messages || '');
    const m = content.match(/Tenant: ([^.]+)\./);
    const tenant = m ? m[1] : null;
    const body = req.task === 'document_classification'
      ? { docType: tenant ? 'original_lease' : 'unknown', docDate: null, tenantName: tenant, suite: null, confidence: 0.95, evidence: 'LEASE AGREEMENT' }
      : (tenant ? lease(tenant, 1500) : {});
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto('http://127.0.0.1:' + PORT + '/?signin=1', { waitUntil: 'networkidle', timeout: 30000 });
  await page.evaluate(() => { try { MainStreetLanding.hide(); } catch (_) {} });
  await _e2eSignIn(page, { email: 'bulk-retry@e2e-test.local', errors });
  await page.waitForSelector('.ptf-prop-card:not(.ptf-demo-card)', { timeout: 15000 });
  await page.evaluate((id) => selectProperty(id), PROP_ID);
  await page.waitForFunction(() => { const el = document.getElementById('propertyName'); return el && el.value === 'Juniper Square'; }, null, { timeout: 45000 });
  await page.evaluate(() => {
    if (typeof switchWorkspaceTab === 'function') switchWorkspaceTab('spaces');
    if (typeof switchLeaseTab === 'function') switchLeaseTab('bulk');
    if (typeof renderBulkResults === 'function') renderBulkResults();
  });
  return page;
}

const rowOf = (page, id) => page.evaluate((i) => { const t = (tenantData || []).find(x => x && x.id === i);
  return t ? { id: t.id, name: t.tenant_name, status: t.status, failed: !!t.extractionFailed, fileName: t.fileName, docId: t.leaseDocumentId } : null; }, id);

(async () => {
  const server  = await startServer();
  const browser = await chromium.launch({ headless: HEADLESS,
    executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const registerPosts = [], consoleLogs = [];
  try {
    section('Open the property — a failed upload is in its saved roster, nothing in memory');
    let page = await openPage(browser, SEED, registerPosts, consoleLogs);
    const bulkHandler0 = await page.evaluate(() => { const el = document.getElementById('bulkLeaseInput'); return el && String(el.onchange); });
    assert(/handleBulkLeases\(this\.files\)/.test(bulkHandler0 || ''), '0a the Upload Leases control carries its own handler', bulkHandler0);
    const r0 = await rowOf(page, FAILED_ID);
    assert(r0 && r0.failed && r0.fileName === 'unreadable-scan.pdf', '0b the failed upload row is on screen', JSON.stringify(r0));
    await page.waitForSelector(`[data-retry][data-job-id="${FAILED_ID}"]`, { timeout: 10000 });

    section('1 · Retry asks on its own input');
    let [chooser] = await Promise.all([
      page.waitForEvent('filechooser', { timeout: 10000 }),
      page.click(`button[data-retry][data-job-id="${FAILED_ID}"]`),
    ]);
    const chooserId = await chooser.element().evaluate(el => el.id);
    assert(chooserId === 'leaseRetryInput', '1a the file picker that opens is #leaseRetryInput, not the Upload Leases control', chooserId);
    const bulkHandler1 = await page.evaluate(() => String(document.getElementById('bulkLeaseInput').onchange));
    assert(bulkHandler1 === bulkHandler0, '1b the Upload Leases control\'s handler is untouched by Retry');

    section('2 · the person cancels, then uploads two new leases normally');
    // Cancelled: no file is given to the retry chooser.
    const posts0 = registerPosts.length;
    await page.setInputFiles('#bulkLeaseInput', [leaseFile('Aspen Outfitters', 1500, 'aspen-lease.txt'), leaseFile('Birchwood Bakery', 1500, 'birchwood-lease.txt')]);
    await page.waitForFunction(() => ['Aspen Outfitters', 'Birchwood Bakery'].every(n => (tenantData || []).some(t => t && t.tenant_name === n && t.status !== 'pending')), null, { timeout: 60000 });
    await page.waitForTimeout(500);
    const names = await page.evaluate(() => (tenantData || []).filter(Boolean).map(t => t.tenant_name));
    assert(names.includes('Aspen Outfitters') && names.includes('Birchwood Bakery'), '2a BOTH files became new uploads', JSON.stringify(names));
    const r2 = await rowOf(page, FAILED_ID);
    assert(r2 && r2.failed && r2.fileName === 'unreadable-scan.pdf' && !r2.name, '2b the failed row was not written over', JSON.stringify(r2));
    assert(registerPosts.length - posts0 === 2, '2c two register rows, one per new lease', String(registerPosts.length - posts0));
    const bulkHandler2 = await page.evaluate(() => String(document.getElementById('bulkLeaseInput').onchange));
    assert(bulkHandler2 === bulkHandler0, '2d the Upload Leases control still has its own handler afterwards');

    section('3 · Retry, answered: re-read under its own id, saved, synced, linked');
    const rpc0 = await page.evaluate(() => window.__rpcLog.length);
    const posts1 = registerPosts.length;
    [chooser] = await Promise.all([
      page.waitForEvent('filechooser', { timeout: 10000 }),
      page.click(`button[data-retry][data-job-id="${FAILED_ID}"]`),
    ]);
    assert((await chooser.element().evaluate(el => el.id)) === 'leaseRetryInput', '3a again on #leaseRetryInput');
    await chooser.setFiles(leaseFile('Cedar Dental Group', 1500, 'unreadable-scan.txt'));
    await page.waitForFunction((id) => { const t = (tenantData || []).find(x => x && x.id === id); return t && t.tenant_name === 'Cedar Dental Group' && t.status === 'success'; }, FAILED_ID, { timeout: 60000 });
    const t0 = Date.now();
    while (registerPosts.length === posts1 && Date.now() - t0 < 20000) await page.waitForTimeout(100);
    await page.waitForTimeout(500);
    const r3 = await rowOf(page, FAILED_ID);
    assert(r3 && r3.name === 'Cedar Dental Group' && !r3.failed && r3.docId === DOC_ID, '3b the SAME row (same id, same document id) is now the leasehold', JSON.stringify(r3));
    const rpc = await page.evaluate((n) => window.__rpcLog.slice(n), rpc0);
    assert(rpc.some(x => x.ids.includes(FAILED_ID)), '3c the tenants table was synced with it (B4)', JSON.stringify(rpc.map(x => x.ids)));
    const link = registerPosts.slice(posts1).find(p => p.body.documentId === DOC_ID);
    assert(link && link.body.tenantId === FAILED_ID, '3d its register row is written by its own document id, LINKED to it', JSON.stringify(link && link.body && { d: link.body.documentId, t: link.body.tenantId }));
    assert(link && rpc.length && link.sentAt >= rpc[rpc.length - 1].doneAt, '3e …after the tenant row exists');
    const saved = await page.evaluate((pid) => JSON.parse(JSON.stringify((window.__e2eStore.properties || []).find(p => p.id === pid))), PROP_ID);
    const savedRow = saved && saved.data && (saved.data.tenants || []).find(t => t.id === FAILED_ID);
    assert(savedRow && savedRow.tenant_name === 'Cedar Dental Group' && !savedRow.extractionFailed, '3f the property was saved with the retried leasehold', JSON.stringify(savedRow && { n: savedRow.tenant_name, f: savedRow.extractionFailed }));

    section('4 · a fresh page, from what was saved');
    const store = await page.evaluate(() => JSON.parse(JSON.stringify(window.__e2eStore)));
    await page.context().close();
    page = await openPage(browser, { properties: store.properties, tenants: store.tenants }, [], consoleLogs);
    // The portfolio list paints a placeholder roster from the tenants table
    // first; the saved roster (properties.data) replaces it a moment later
    // (RR-1). The assertion is about the saved one, so wait for it.
    await page.waitForFunction((a) => { const t = (tenantData || []).find(x => x && x.id === a.id); return t && t.leaseDocumentId === a.doc; },
      { id: FAILED_ID, doc: DOC_ID }, { timeout: 20000 }).catch(() => {});
    const r4 = await rowOf(page, FAILED_ID);
    assert(r4 && r4.name === 'Cedar Dental Group' && !r4.failed && r4.docId === DOC_ID, '4a after a reload the retried leasehold is there, linked by its document id', JSON.stringify(r4));
    const r4b = await page.evaluate(() => ['Aspen Outfitters', 'Birchwood Bakery'].map(n => (tenantData || []).some(t => t && t.tenant_name === n)));
    assert(r4b.every(Boolean), '4b …with the two leases uploaded normally beside it');

    section('5 · console');
    const real = consoleLogs.filter(l => (l.type === 'error' || l.type === 'PAGEERROR')
      && !/favicon|Failed to load resource|ERR_CERT_AUTHORITY_INVALID|\[saveCamResults\]/.test(l.text));
    assert(real.length === 0, '5a no console errors', JSON.stringify(real.slice(0, 5)));
  } catch (e) {
    fail('UNCAUGHT', e.message);
    console.error(e.stack);
    consoleLogs.slice(-30).forEach(l => console.error(l.type + ': ' + l.text));
  } finally {
    await browser.close();
    server.close();
  }
  console.log('\n' + '─'.repeat(64));
  console.log(failures === 0 ? '\x1b[32m✅ All bulk retry checks passed\x1b[0m' : '\x1b[31m❌ ' + failures + ' check(s) failed\x1b[0m');
  process.exit(failures === 0 ? 0 : 1);
})();
