// test-e2e-acquisition-documents.js
// ============================================================================
// Acquisition Review Phase 1, increment P1-2 — walked in the real page.
//
// The claim this suite defends: every file an acquisition review is given is
// KEPT. Before P1-2 the browser read each file, kept the extracted fields, and
// threw the source away — and a failed extraction left nothing at all.
//
// What must hold, in the order a manager would meet it:
//
//   1. The row exists before the extraction finishes. A tab closed mid-read
//      still leaves the fact that the file arrived.
//   2. Three leases — two that read, one that fails — leave three rows, and
//      the failure carries its reason instead of vanishing.
//   3. The original reaches the private `leases` bucket at the agreed path,
//      as a REFERENCE, never a public URL, and the panel offers a control that
//      opens it (ARCHITECTURE_PRINCIPLES §9).
//   4. Re-opening the review lists the documents from the database.
//   5. An invoice is filed as an invoice and names what it produced.
//   6. A file too large to store is still read, and the panel says plainly
//      that the original is not on file rather than implying it is.
//   7. With migration 023 not run, uploads still extract and the product SAYS
//      the documents are not being filed.
//
// The stand-ins are honest: /api/upload flattens the object name exactly as the
// real endpoint does, and /api/acquisition-documents upserts on
// (review_id, file_name) — so a test cannot pass by filing two rows for one
// file, and the asserted storage path is the one the product would really get.
//
// Run: node test-e2e-acquisition-documents.js
// ============================================================================
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
let pw; try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }

const ROOT = __dirname, PORT = 8923;
const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css',
               '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg',
               '.svg':'image/svg+xml', '.pdf':'application/pdf', '.txt':'text/plain' };

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail || '' });
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (detail ? '  — ' + detail : ''));
}

const UID       = 'u1';
const REVIEW_ID = 'ddddddd1-0000-4000-b000-000000000001';

// The supabase stand-in: the same conditional-update shape P1-1 needs.
const DB = `
(function(){
  var U = { id: '${UID}', email: 'pm@example.com' };
  var STORE = { acquisition_reviews: [], properties: [], tenants: [] };
  var _seq = 0;
  function P(v) { return Promise.resolve(v); }
  function tbl(n) { STORE[n] = STORE[n] || []; return STORE[n]; }
  function q(name) {
    var filters = [], pending = null;
    function rows() { return tbl(name).filter(function (r) { return filters.every(function (f) { return r[f[0]] === f[1]; }); }); }
    function run() {
      if (pending) {
        var changed = rows();
        changed.forEach(function (r) { Object.assign(r, pending); r.updated_at = 'rev-' + (++_seq); });
        return P({ data: changed, error: null });
      }
      return P({ data: rows(), error: null });
    }
    var api = {
      select: function () { return api; },
      eq: function (k, v) { filters.push([k, v]); return api; },
      neq: function () { return api; }, is: function () { return api; }, not: function () { return api; },
      in: function () { return api; }, order: function () { return api; }, limit: function () { return api; },
      ilike: function () { return api; },
      single: function () { return run().then(function (r) { return { data: (r.data || [])[0] || null, error: null }; }); },
      maybeSingle: function () { return run().then(function (r) { return { data: (r.data || [])[0] || null, error: null }; }); },
      update: function (patch) { pending = patch; return api; },
      insert: function (r) { var arr = Array.isArray(r) ? r : [r];
        arr.forEach(function (x) { if (!x.id) x.id = 'row-' + (++_seq); tbl(name).push(x); });
        var p = P({ data: arr, error: null });
        p.select = function () { var s = P({ data: arr, error: null }); s.single = function () { return P({ data: arr[0], error: null }); }; return s; };
        return p; },
      upsert: function (r) { var arr = Array.isArray(r) ? r : [r], t = tbl(name);
        arr.forEach(function (x) { var i = t.findIndex(function (y) { return y.id === x.id; }); if (i >= 0) Object.assign(t[i], x); else t.push(x); });
        var p = P({ data: arr, error: null });
        p.select = function () { return P({ data: arr, error: null }); };
        return p; },
      delete: function () { return { eq: function (k, v) { STORE[name] = tbl(name).filter(function (x) { return x[k] !== v; }); return P({ error: null }); },
                                     in: function () { return P({ error: null }); } }; },
      then: function (res, rej) { return run().then(res, rej); },
    };
    return api;
  }
  window.__store = STORE;
  window.supabase = { createClient: function () { return {
    auth: {
      getUser: function () { return P({ data: { user: U }, error: null }); },
      getSession: function () { return P({ data: { session: { user: U, access_token: 'tok' } }, error: null }); },
      onAuthStateChange: function (cb) { setTimeout(function () { try { cb('SIGNED_IN', { user: U }); } catch (_) {} }, 40);
        return { data: { subscription: { unsubscribe: function () {} } } }; },
      signOut: function () { return P({ error: null }); },
    },
    rpc: function () { return P({ data: null, error: null }); },
    from: q,
    storage: { from: function () { return { upload: function () { return P({ data: { path: 'x' }, error: null }); },
                                           getPublicUrl: function () { return { data: { publicUrl: '' } }; } }; } },
  }; } };
})();`;

const LEASE_FIXTURE = {
  tenant_name: 'Coastal Outfitters', lease_start_date: '2023-03-01', lease_end_date: '2028-02-29',
  lease_type: 'NNN', sqft: 2600, cam_cap: 4, audit_rights: true, pro_rata_method: 'occupied',
  renewal_options: '1 x 5 year option', excluded_categories: 'capital expenditures', quotes: {},
};
const INVOICE_FIXTURE = { vendorName: 'Atlas Landscaping', amount: 18400, category: 'landscaping', invoiceDate: '2024-06-15' };

function leaseText(tenant, marker) {
  return `LEASE AGREEMENT\nTenant: ${tenant}. Commencement Date: March 1, 2023. Expiration Date: February 29, 2028.\n`
    + `Tenant shall lease approximately 2,600 square feet. This is a Triple Net (NNN) lease.\n`
    + `CAM charges shall not increase more than 4% per annum. Pro rata share based on occupied square footage.\n`
    + `Tenant shall have one (1) five-year renewal option. Capital expenditures are excluded from CAM.\n`
    + (marker || '') + '\n'.repeat(2) + 'This lease continues. '.repeat(60);
}

(async () => {
  const srv = http.createServer((rq, rs) => {
    let u = decodeURIComponent(rq.url.split('?')[0]);
    if (u === '/') u = '/index.html';
    if (u.startsWith('/api/')) { rs.writeHead(200, { 'Content-Type': 'application/json' }); rs.end('{}'); return; }
    fs.readFile(path.join(ROOT, u), (e, d) => {
      if (e) { rs.writeHead(404); rs.end(); return; }
      rs.writeHead(200, { 'Content-Type': MIME[path.extname(u)] || 'application/octet-stream' }); rs.end(d);
    });
  });
  await new Promise(r => srv.listen(PORT, '127.0.0.1', r));

  const browser = await pw.chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e.message).split('\n')[0]));
  page.on('dialog', d => d.dismiss().catch(() => {}));

  // ── the document store, behind the endpoint the product really calls ─────
  // Upserts on (review_id, file_name), the way migration 023 constrains it.
  const docStore = [];
  let docsMigrationMissing = false;
  let seq = 0;

  await page.route('**cdnjs**',    r => r.fulfill({ status: 200, body: '/*x*/' }));
  await page.route('**jsdelivr**', r => r.fulfill({ status: 200, body: '/*x*/' }));
  await page.route('**fonts.g**',  r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));

  await page.route('**/api/acquisition-documents**', async route => {
    if (docsMigrationMissing) {
      return route.fulfill({ status: 503, contentType: 'application/json',
        body: JSON.stringify({ error: 'acquisition_documents table not found — run migrations/023_acquisition_documents.sql in Supabase SQL Editor', code: 'migration_missing' }) });
    }
    const req = route.request();
    if (req.method() === 'POST') {
      const b = JSON.parse(req.postData() || '{}');
      const i = docStore.findIndex(r => r.review_id === b.reviewId && r.file_name === b.fileName);
      const row = i >= 0 ? docStore[i] : { id: 'doc-' + (++seq), review_id: b.reviewId, created_at: new Date(Date.now() + seq).toISOString() };
      const MAP = { fileName: 'file_name', intakeKind: 'intake_kind', byteSize: 'byte_size', contentType: 'content_type',
                    storagePath: 'storage_path', parsingStatus: 'parsing_status', extractionModel: 'extraction_model',
                    usedPdfDirect: 'used_pdf_direct', errorMessage: 'error_message',
                    producedKind: 'produced_kind', producedId: 'produced_id' };
      for (const [c, s] of Object.entries(MAP)) if (b[c] !== undefined) row[s] = b[c];
      // extracted_text is stored but never echoed back, as the endpoint does.
      if (b.extractedText !== undefined) row._text = b.extractedText;
      if (i < 0) docStore.push(row);
      const { _text, ...clean } = row;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: [clean] }) });
    }
    const rid = new URL(req.url()).searchParams.get('reviewId');
    const rows = docStore.filter(r => r.review_id === rid).map(({ _text, ...r }) => r);
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: rows }) });
  });

  // /api/upload, flattening the name exactly as api/upload.js does, so the
  // path this suite asserts is the path the product would really receive.
  const uploaded = [];
  await page.route('**/api/upload', async route => {
    const b = JSON.parse(route.request().postData() || '{}');
    const safe = `${UID}/${String(b.fileName || '').replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    uploaded.push({ fileName: b.fileName, bucket: b.bucket, fileType: b.fileType, bytes: (b.fileBase64 || '').length });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ url: `${b.bucket}/${safe}` }) });
  });

  await page.route('**/api/document-url', async route => {
    const b = JSON.parse(route.request().postData() || '{}');
    return route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ url: 'https://stub.supabase.co/storage/v1/object/sign/' + b.ref + '?token=signed', expiresIn: 300 }) });
  });

  let claudeDelayMs = 0;
  await page.route('**/api/claude', async route => {
    const post = route.request().postData() || '';
    if (claudeDelayMs) await new Promise(r => setTimeout(r, claudeDelayMs));
    if (post.includes('FAIL_EXTRACTION')) {
      return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Anthropic API error 529: overloaded' }) });
    }
    const isInvoice = post.includes('commercial real estate invoice');
    return route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify(isInvoice ? INVOICE_FIXTURE : LEASE_FIXTURE) });
  });

  await page.addInitScript(DB);
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  console.log('\nAcquisition documents — every source is kept\n' + '='.repeat(64));

  await page.evaluate(() => {
    window.__toasts = [];
    const orig = window.showToast;
    window.showToast = function (m, o) { window.__toasts.push(String(m)); return orig ? orig(m, o) : undefined; };
    const w = document.getElementById('obWelcomeModal');
    if (w && w.style.display !== 'none') { if (typeof obCloseWelcome === 'function') obCloseWelcome('skip'); else w.style.display = 'none'; }
  });

  // Open a review.
  await page.evaluate(async (rid) => {
    __store.acquisition_reviews.push({
      id: rid, user_id: 'u1', name: 'Harborview Retail Center', status: 'draft',
      created_at: '2026-03-01T10:00:00.000Z', updated_at: 'rev-0',
      data: { tenants: [], invoices: [], totalSqFt: 26000, documents: [], analysis: null },
    });
    await _loadAcqReviewsAndRender();
    selectAcquisitionReview(rid);
  }, REVIEW_ID);
  await page.waitForTimeout(400);

  const panel = await page.evaluate(() => ({
    exists: !!document.getElementById('acqDocsList'),
    text: (document.getElementById('acqDocsList') || {}).innerText || '',
  }));
  check('the review has a Documents panel', panel.exists);
  check('and it says so honestly when empty', /no documents on file/i.test(panel.text), panel.text.slice(0, 70));

  // ── 1 · the row exists before the extraction finishes ────────────────────
  claudeDelayMs = 1200;
  await page.setInputFiles('#acqLeaseInput', [{
    name: 'coastal-outfitters-lease.txt', mimeType: 'text/plain', buffer: Buffer.from(leaseText('Coastal Outfitters')),
  }]);
  // Poll while the extraction is still in flight.
  let pendingSeen = null;
  for (let i = 0; i < 40 && !pendingSeen; i++) {
    const row = docStore.find(r => r.file_name === 'coastal-outfitters-lease.txt');
    if (row && row.parsing_status === 'pending') pendingSeen = { ...row };
    await new Promise(r => setTimeout(r, 50));
  }
  check('the document row exists while the extraction is still running',
        !!pendingSeen, pendingSeen ? 'status ' + pendingSeen.parsing_status : 'no pending row was ever visible');
  check('and that first row already names the file and its lane',
        !!pendingSeen && pendingSeen.file_name === 'coastal-outfitters-lease.txt' && pendingSeen.intake_kind === 'lease',
        pendingSeen ? `${pendingSeen.file_name} / ${pendingSeen.intake_kind}` : '');

  await page.waitForFunction(() => !document.querySelector('#acqDocsList .acq-doc-status.pending'), null, { timeout: 30000 }).catch(() => {});
  claudeDelayMs = 0;
  await page.waitForTimeout(400);

  const afterFirst = docStore.find(r => r.file_name === 'coastal-outfitters-lease.txt');
  check('when the extraction lands the SAME row is updated, not a second one filed',
        docStore.filter(r => r.file_name === 'coastal-outfitters-lease.txt').length === 1,
        String(docStore.filter(r => r.file_name === 'coastal-outfitters-lease.txt').length) + ' rows');
  check('the row reads success and carries the text that was read',
        afterFirst.parsing_status === 'success' && typeof afterFirst._text === 'string' && /Coastal Outfitters/.test(afterFirst._text),
        afterFirst.parsing_status);
  check('and it names the tenant it produced',
        afterFirst.produced_kind === 'tenant' && !!afterFirst.produced_id,
        `${afterFirst.produced_kind} / ${afterFirst.produced_id}`);

  // ── 3 · the original, and how it is addressed ────────────────────────────
  check('the original went to the private leases bucket',
        uploaded.length === 1 && uploaded[0].bucket === 'leases', JSON.stringify(uploaded[0] || null));
  check('under the agreed acquisition naming',
        /^acq\/[^/]+\/\d+-coastal-outfitters-lease\.txt$/.test(uploaded[0].fileName), uploaded[0].fileName);
  check('the stored value is a REFERENCE, not a public URL',
        afterFirst.storage_path === `leases/${UID}/acq_${REVIEW_ID}_${uploaded[0].fileName.split('-')[0].split('/').pop()}` ||
        (/^leases\/u1\/acq_/.test(afterFirst.storage_path) && !/object\/public/.test(afterFirst.storage_path)),
        afterFirst.storage_path);
  check('the object sits one segment under the owner id, which is what signing checks',
        afterFirst.storage_path.split('/').length === 3 && afterFirst.storage_path.split('/')[1] === UID,
        afterFirst.storage_path);

  const opener = await page.evaluate(() => {
    const b = document.querySelector('#acqDocsList [data-doc-url]');
    return b ? { ref: b.getAttribute('data-doc-url'), label: (b.innerText || '').trim() } : null;
  });
  check('the panel offers a control that opens the original (ARCH §9)',
        !!opener && /^leases\//.test(opener.ref), opener ? opener.ref : 'no opener rendered');

  // ── 2 · a failed extraction still leaves a row ───────────────────────────
  await page.setInputFiles('#acqLeaseInput', [
    { name: 'harbor-cafe-lease.txt', mimeType: 'text/plain', buffer: Buffer.from(leaseText('Harbor Cafe')) },
    { name: 'unreadable-lease.txt',  mimeType: 'text/plain', buffer: Buffer.from(leaseText('Nobody', 'FAIL_EXTRACTION')) },
  ]);
  await page.waitForFunction(() => document.querySelectorAll('#acqDocsList .acq-doc-row').length >= 3, null, { timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(500);

  const failed = docStore.find(r => r.file_name === 'unreadable-lease.txt');
  check('three files in, three rows on file', docStore.length === 3, String(docStore.length));
  check('the file whose extraction failed still has a row', !!failed);
  // The message is the one the extraction path produced — callClaudeForLease
  // reports the transport failure rather than the upstream body — and what
  // matters here is that the row KEEPS it instead of recording a bare 'failed'.
  check('the row says it failed and why',
        !!failed && failed.parsing_status === 'failed'
          && /extraction failed/i.test(failed.error_message || '')
          && /HTTP|error|\d{3}/i.test(failed.error_message || ''),
        failed ? `${failed.parsing_status}: ${failed.error_message}` : '');
  check('its original was kept anyway — the file was still given to the review',
        !!failed && /^leases\/u1\/acq_/.test(failed.storage_path || ''), failed ? String(failed.storage_path) : '');

  const shown = await page.evaluate(() => {
    const rows = [].slice.call(document.querySelectorAll('#acqDocsList .acq-doc-row'));
    return rows.map(r => ({
      name: (r.querySelector('.acq-doc-name') || {}).innerText || '',
      status: (r.querySelector('.acq-doc-status') || {}).innerText || '',
      err: (r.querySelector('.acq-doc-err') || {}).innerText || '',
      opens: !!r.querySelector('[data-doc-url]'),
    }));
  });
  check('the panel lists all three, the failure included', shown.length === 3, shown.map(s => s.name).join(', '));
  const failRow = shown.find(s => /unreadable/.test(s.name));
  check('and shows the failure with its reason on screen',
        !!failRow && /failed/i.test(failRow.status) && /extraction failed/i.test(failRow.err),
        failRow ? `${failRow.status} — ${failRow.err}` : '');
  check('every stored document on screen can be opened', shown.every(s => s.opens), JSON.stringify(shown.map(s => s.opens)));

  const tenantsNow = await page.evaluate(() => _acqTenants.filter(t => t._status === 'ok').length);
  check('the two readable leases still became tenants', tenantsNow === 2, String(tenantsNow));

  // ── 5 · an invoice is filed as an invoice ────────────────────────────────
  await page.setInputFiles('#acqInvoiceInput', [{
    name: 'atlas-landscaping-june.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 invoice fixture'),
  }]);
  await page.waitForFunction(() => document.querySelectorAll('#acqDocsList .acq-doc-row').length >= 4, null, { timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(500);

  const inv = docStore.find(r => r.file_name === 'atlas-landscaping-june.pdf');
  check('the invoice is filed in its own lane', !!inv && inv.intake_kind === 'invoice', inv ? inv.intake_kind : 'no row');
  check('it names the invoice it produced', !!inv && inv.produced_kind === 'invoice' && !!inv.produced_id,
        inv ? `${inv.produced_kind} / ${inv.produced_id}` : '');
  check('and its original was stored too', !!inv && /^leases\/u1\/acq_/.test(inv.storage_path || ''), inv ? String(inv.storage_path) : '');

  // ── 4 · re-opening the review reads them back ────────────────────────────
  await page.evaluate(() => closeAcquisitionDetail());
  await page.waitForTimeout(300);
  await page.evaluate((rid) => { _acqDocs.clear(); selectAcquisitionReview(rid); }, REVIEW_ID);
  await page.waitForFunction(() => document.querySelectorAll('#acqDocsList .acq-doc-row').length >= 4, null, { timeout: 30000 }).catch(() => {});
  const reopened = await page.evaluate(() => ({
    rows: document.querySelectorAll('#acqDocsList .acq-doc-row').length,
    count: (document.getElementById('acqDocsCount') || {}).textContent || '',
    openers: document.querySelectorAll('#acqDocsList [data-doc-url]').length,
  }));
  check('re-opening the review lists its documents from the database', reopened.rows === 4, String(reopened.rows));
  check('the header counts them', /4 files on record/.test(reopened.count), reopened.count);
  check('and every original is still openable', reopened.openers === 4, String(reopened.openers));

  // ── 6 · too large to store is said plainly ───────────────────────────────
  const big = Buffer.alloc(3.8 * 1024 * 1024, 'x');
  await page.setInputFiles('#acqLeaseInput', [{ name: 'huge-scan.txt', mimeType: 'text/plain', buffer: big }]);
  await page.waitForFunction(() => document.querySelectorAll('#acqDocsList .acq-doc-row').length >= 5, null, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(600);

  const huge = docStore.find(r => r.file_name === 'huge-scan.txt');
  check('a file too large to store still gets a row', !!huge);
  check('its original is recorded as NOT on file', !!huge && (huge.storage_path === null || huge.storage_path === undefined),
        huge ? String(huge.storage_path) : '');
  check('the row carries the reason', !!huge && /too large|limit|MB/i.test(huge.error_message || ''),
        huge ? String(huge.error_message).slice(0, 80) : '');
  check('no upload was attempted for it — the gate fires before the encode',
        !uploaded.some(u => /huge-scan/.test(u.fileName)), uploaded.map(u => u.fileName).join(', '));
  const hugeRow = await page.evaluate(() => {
    const r = [].slice.call(document.querySelectorAll('#acqDocsList .acq-doc-row')).find(x => /huge-scan/.test(x.innerText));
    return r ? { text: r.innerText.replace(/\s+/g, ' '), opens: !!r.querySelector('[data-doc-url]') } : null;
  });
  check('and the panel says the original is not on file rather than offering a dead control',
        !!hugeRow && /not on file/i.test(hugeRow.text) && hugeRow.opens === false,
        hugeRow ? hugeRow.text.slice(0, 90) : 'row not rendered');

  // ── 7 · migration 023 not run ────────────────────────────────────────────
  docsMigrationMissing = true;
  const tenantsBeforeGap = await page.evaluate(() => {
    window.__toasts = []; _acqDocsUnavailable = false;
    return _acqTenants.filter(t => t._status === 'ok').length;
  });
  await page.setInputFiles('#acqLeaseInput', [{
    name: 'post-migration-gap.txt', mimeType: 'text/plain', buffer: Buffer.from(leaseText('Gap Tenant')),
  }]);
  await page.waitForFunction(() => /not filed/i.test((document.getElementById('acqDocsList') || {}).innerText || ''), null, { timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(600);

  const gap = await page.evaluate(() => ({
    panel: (document.getElementById('acqDocsList') || {}).innerText || '',
    toasts: window.__toasts.slice(),
    tenants: _acqTenants.filter(t => t._status === 'ok').length,
  }));
  check('with the table absent, the panel says documents are NOT being filed',
        /not filed/i.test(gap.panel), gap.panel.replace(/\s+/g, ' ').slice(0, 100));
  check('and names the migration to run', /023_acquisition_documents\.sql/.test(gap.panel));
  check('the user is told once, in a toast', gap.toasts.some(t => /023_acquisition_documents\.sql/.test(t)),
        gap.toasts.join(' | ').slice(0, 120) || 'no toast');
  check('extraction still works — the workflow is not held hostage by the migration',
        gap.tenants === tenantsBeforeGap + 1, `${tenantsBeforeGap} → ${gap.tenants}`);

  check('no uncaught errors across the walk', errs.length === 0, errs.slice(0, 3).join(' | ') || 'clean');

  await ctx.close(); await browser.close(); srv.close();

  const failedChecks = results.filter(r => !r.ok);
  console.log('='.repeat(64));
  console.log(`${results.length - failedChecks.length}/${results.length} passed`);
  if (failedChecks.length) { console.log('FAILED:'); failedChecks.forEach(f => console.log('  - ' + f.name + ' :: ' + f.detail)); }
  process.exit(failedChecks.length ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(2); });
