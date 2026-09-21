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
//   8. A document naming a review the signed-in user does not own is REFUSED
//      by the database, which is where that rule now lives.
//
// The stand-ins are honest: /api/upload flattens the object name exactly as the
// real endpoint does, and the Supabase stand-in upserts on (review_id,
// file_name), enforces the owner policy and the composite foreign key, and
// returns only the columns a query asked for — so a test cannot pass by filing
// two rows for one file, and the asserted storage path is the one the product
// would really get.
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

// The supabase stand-in.
//
// P1-2 originally reached acquisition_documents through a serverless function,
// and this suite stubbed that endpoint. There is no endpoint now — the browser
// writes the table directly — so the rules it used to enforce have to be
// modelled HERE, or the walk would prove nothing about them:
//
//   · row-level security: a row whose user_id is not the signed-in user is
//     refused (42501), and a read only ever sees that user's rows;
//   · the composite foreign key: a document naming a review that does not
//     belong to that same user is refused (23503) — which is the ownership
//     check the endpoint used to make in JavaScript;
//   · the unique key (review_id, file_name): the upsert lands on ONE row;
//   · the select list: what a query asked for is recorded, so "the list does
//     not ask for the document text" is checked against the real query.
//
// It also keeps the conditional-update shape P1-1 needs.
const DB = `
(function(){
  var U = { id: '${UID}', email: 'pm@example.com' };
  var STORE = { acquisition_reviews: [], acquisition_documents: [], properties: [], tenants: [] };
  var _seq = 0;
  window.__docsMissing = false;   // migration 023 not run
  window.__dbCalls = [];
  function P(v) { return Promise.resolve(v); }
  function tbl(n) { STORE[n] = STORE[n] || []; return STORE[n]; }
  function clone(o) { var c = {}; for (var k in o) c[k] = o[k]; return c; }

  // What the caller asked for is what it gets back — so a column left out of
  // the select is a column the screen never receives.
  function project(arr, sel) {
    if (!sel || sel.indexOf('*') >= 0) return arr.map(clone);
    var cols = sel.split(',').map(function (s) { return s.trim(); });
    return arr.map(function (r) { var o = {}; cols.forEach(function (c) { if (c in r) o[c] = r[c]; }); return o; });
  }

  function q(name) {
    var filters = [], pending = null, sel = null, ord = null;
    var isDocs = (name === 'acquisition_documents');
    function absent() {
      return (isDocs && window.__docsMissing)
        ? { data: null, error: { code: '42P01', message: 'relation "public.' + name + '" does not exist' } }
        : null;
    }
    function rows() {
      var out = tbl(name).filter(function (r) { return filters.every(function (f) { return r[f[0]] === f[1]; }); });
      // RLS: these tables are owner-scoped, and a read never crosses owners.
      if (isDocs) out = out.filter(function (r) { return r.user_id === U.id; });
      if (ord) {
        out = out.slice().sort(function (a, b) {
          var x = a[ord[0]], y = b[ord[0]];
          return (x === y ? 0 : (x > y ? 1 : -1)) * (ord[1] ? 1 : -1);
        });
      }
      return out;
    }
    // The recorded call is the object itself, not a snapshot: on a write the
    // select list is chosen AFTER the upsert (…upsert(row).select(cols)), so it
    // is filled in when it arrives.
    var myCall = null;
    function record(op, extra) {
      var c = { table: name, op: op, select: sel, order: ord, filters: filters.slice() };
      for (var k in (extra || {})) c[k] = extra[k];
      window.__dbCalls.push(c);
      myCall = c;
      return c;
    }
    function run() {
      var gone = absent(); if (gone) { record('select'); return P(gone); }
      if (pending) {
        var changed = rows();
        changed.forEach(function (r) { Object.assign(r, pending); r.updated_at = 'rev-' + (++_seq); });
        record('update');
        return P({ data: isDocs ? project(changed, sel) : changed, error: null });
      }
      record('select');
      return P({ data: isDocs ? project(rows(), sel) : rows(), error: null });
    }
    var api = {
      select: function (cols) { sel = (typeof cols === 'string' && cols) ? cols : null; return api; },
      eq: function (k, v) { filters.push([k, v]); return api; },
      neq: function () { return api; }, is: function () { return api; }, not: function () { return api; },
      in: function () { return api; },
      order: function (col, opts) { ord = [col, !opts || opts.ascending !== false]; return api; },
      limit: function () { return api; },
      ilike: function () { return api; },
      single: function () { return run().then(function (r) { return { data: (r.data || [])[0] || null, error: r.error || null }; }); },
      maybeSingle: function () { return run().then(function (r) { return { data: (r.data || [])[0] || null, error: r.error || null }; }); },
      update: function (patch) { pending = patch; return api; },
      insert: function (r) { var arr = Array.isArray(r) ? r : [r];
        arr.forEach(function (x) { if (!x.id) x.id = 'row-' + (++_seq); tbl(name).push(x); });
        var p = P({ data: arr, error: null });
        p.select = function () { var s = P({ data: arr, error: null }); s.single = function () { return P({ data: arr[0], error: null }); }; return s; };
        return p; },
      upsert: function (r, opts) {
        var arr = Array.isArray(r) ? r : [r], t = tbl(name);
        var key = (opts && opts.onConflict) ? String(opts.onConflict).split(',').map(function (s) { return s.trim(); }) : ['id'];
        var gone = absent();
        if (gone) { record('upsert', { conflict: key.join(',') }); return _wrap(P(gone)); }
        var out = [], err = null;
        arr.forEach(function (x) {
          if (err) return;
          if (isDocs) {
            // RLS WITH CHECK — a row must name its own writer.
            if (x.user_id !== U.id) {
              err = { code: '42501', message: 'new row violates row-level security policy for table "' + name + '"' };
              return;
            }
            // The composite foreign key: the review must exist AND be this user's.
            var parent = tbl('acquisition_reviews').filter(function (p) {
              return p.id === x.review_id && p.user_id === x.user_id;
            })[0];
            if (!parent) {
              err = { code: '23503', message: 'insert or update on table "' + name
                + '" violates foreign key constraint "acquisition_documents_review_fk"' };
              return;
            }
          }
          var i = -1;
          for (var n = 0; n < t.length; n++) {
            if (key.every(function (k) { return t[n][k] === x[k]; })) { i = n; break; }
          }
          var stamp = new Date(Date.now() + (++_seq)).toISOString();
          if (i >= 0) { Object.assign(t[i], x); t[i].updated_at = stamp; out.push(t[i]); }
          else {
            var row = Object.assign({ id: 'row-' + (++_seq), created_at: stamp, updated_at: stamp }, x);
            t.push(row); out.push(row);
          }
        });
        record('upsert', { conflict: key.join(',') });
        if (err) return _wrap(P({ data: null, error: err }));
        return _wrap(P({ data: out, error: null }), out);
      },
      delete: function () { return { eq: function (k, v) { STORE[name] = tbl(name).filter(function (x) { return x[k] !== v; }); return P({ error: null }); },
                                     in: function () { return P({ error: null }); } }; },
      then: function (res, rej) { return run().then(res, rej); },
    };
    function _wrap(p, out) {
      p.select = function (cols) {
        sel = (typeof cols === 'string' && cols) ? cols : null;
        if (myCall) myCall.select = sel;
        return p.then(function (r) {
          if (r.error) return r;
          return { data: isDocs ? project(out || r.data || [], sel) : (out || r.data), error: null };
        });
      };
      return p;
    }
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

  // The document rows live in the Supabase stand-in above — there is no
  // endpoint to intercept. These read them back out of the page.
  const docs     = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__store.acquisition_documents)));
  const docNamed = async n => (await docs()).find(r => r.file_name === n) || null;
  const dbCalls  = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__dbCalls)));

  await page.route('**cdnjs**',    r => r.fulfill({ status: 200, body: '/*x*/' }));
  await page.route('**jsdelivr**', r => r.fulfill({ status: 200, body: '/*x*/' }));
  await page.route('**fonts.g**',  r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));

  // Nothing may reach a serverless function for these rows: the whole point of
  // this rework is that there is no thirteenth function to deploy.
  const endpointHits = [];
  await page.route('**/api/acquisition-documents**', async route => {
    endpointHits.push(route.request().url());
    return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"no such endpoint"}' });
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
    const row = await docNamed('coastal-outfitters-lease.txt');
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

  const all1 = await docs();
  const afterFirst = all1.find(r => r.file_name === 'coastal-outfitters-lease.txt');
  check('when the extraction lands the SAME row is updated, not a second one filed',
        all1.filter(r => r.file_name === 'coastal-outfitters-lease.txt').length === 1,
        String(all1.filter(r => r.file_name === 'coastal-outfitters-lease.txt').length) + ' rows');
  check('the row reads success and carries the text that was read',
        afterFirst.parsing_status === 'success' && typeof afterFirst.extracted_text === 'string' && /Coastal Outfitters/.test(afterFirst.extracted_text),
        afterFirst.parsing_status);
  check('and it names the tenant it produced',
        afterFirst.produced_kind === 'tenant' && !!afterFirst.produced_id,
        `${afterFirst.produced_kind} / ${afterFirst.produced_id}`);

  // ── the shape of the writes themselves ───────────────────────────────────
  // With the endpoint gone, these are the rules that used to be its job.
  const writes = (await dbCalls()).filter(c => c.table === 'acquisition_documents' && c.op === 'upsert');
  check('no serverless function was called for any of this',
        endpointHits.length === 0, endpointHits.join(', ') || 'none');
  check('the write upserts on (review_id, file_name)',
        writes.length > 0 && writes.every(w => w.conflict === 'review_id,file_name'),
        writes.map(w => w.conflict).join(' | ') || 'no write recorded');
  check('and it never asks the database for the document text back',
        writes.every(w => w.select && !/extracted_text/.test(w.select)),
        writes.map(w => w.select).join(' | ').slice(0, 90));
  const reads = (await dbCalls()).filter(c => c.table === 'acquisition_documents' && c.op === 'select');
  check('the list is scoped to the review AND the signed-in user',
        reads.length > 0 && reads.every(r =>
          r.filters.some(f => f[0] === 'review_id') && r.filters.some(f => f[0] === 'user_id' && f[1] === UID)),
        JSON.stringify((reads[0] || {}).filters || null));
  check('the list is ordered oldest first and leaves the text behind',
        reads.every(r => r.order && r.order[0] === 'created_at' && r.order[1] === true
                         && r.select && !/extracted_text/.test(r.select)),
        JSON.stringify((reads[0] || {}).order || null));

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

  const all3  = await docs();
  const failed = all3.find(r => r.file_name === 'unreadable-lease.txt');
  check('three files in, three rows on file', all3.length === 3, String(all3.length));
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

  const inv = await docNamed('atlas-landscaping-june.pdf');
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

  const huge = await docNamed('huge-scan.txt');
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

  // ── 8 · a review the user does not own ───────────────────────────────────
  // The endpoint used to check this in JavaScript. It is now the composite
  // foreign key, so the walk asks the database directly: write a document
  // naming a review that belongs to somebody else and it must be refused.
  const foreign = await page.evaluate(async () => {
    __store.acquisition_reviews.push({
      id: 'ffffffff-0000-4000-b000-00000000000f', user_id: 'someone-else',
      name: "Another manager's review", status: 'draft', data: {},
    });
    const before = __store.acquisition_documents.length;
    const row = await _acqSaveDocument({
      reviewId: 'ffffffff-0000-4000-b000-00000000000f',
      fileName: 'not-mine.pdf', intakeKind: 'lease', parsingStatus: 'pending',
    });
    return { row: row, added: __store.acquisition_documents.length - before };
  });
  check('a document on someone else\'s review is refused by the database',
        foreign.row === null && foreign.added === 0,
        `row ${JSON.stringify(foreign.row)} / ${foreign.added} added`);

  // ── 7 · migration 023 not run ────────────────────────────────────────────
  const tenantsBeforeGap = await page.evaluate(() => {
    window.__toasts = []; _acqDocsUnavailable = false; window.__docsMissing = true;
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

  // The READ path meets the same absent table, and must reach the same verdict
  // on its own — a review opened fresh, before anything is uploaded, would
  // otherwise render as a review with no documents at all.
  const readGap = await page.evaluate(async (rid) => {
    _acqDocsUnavailable = false; _acqDocs.clear();
    const rows = await _acqLoadDocuments(rid);
    _renderAcqDocuments();
    return { flag: _acqDocsUnavailable, rows: rows.length,
             panel: (document.getElementById('acqDocsList') || {}).innerText || '' };
  }, REVIEW_ID);
  check('and opening a review against the absent table says the same thing',
        readGap.flag === true && readGap.rows === 0 && /not filed/i.test(readGap.panel),
        `flag ${readGap.flag} · ${readGap.panel.replace(/\s+/g, ' ').slice(0, 70)}`);

  check('no uncaught errors across the walk', errs.length === 0, errs.slice(0, 3).join(' | ') || 'clean');

  await ctx.close(); await browser.close(); srv.close();

  const failedChecks = results.filter(r => !r.ok);
  console.log('='.repeat(64));
  console.log(`${results.length - failedChecks.length}/${results.length} passed`);
  if (failedChecks.length) { console.log('FAILED:'); failedChecks.forEach(f => console.log('  - ' + f.name + ' :: ' + f.detail)); }
  process.exit(failedChecks.length ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(2); });
