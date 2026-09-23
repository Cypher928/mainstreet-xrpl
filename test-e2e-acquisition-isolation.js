// test-e2e-acquisition-isolation.js
// ============================================================================
// Acquisition Review — one review's work never lands in another.
//
// Found on the Pilot, 2026-09-22: a newly created review showed Maple Plaza's
// tenants. An upload runs for minutes (extract, classify, read terms), and it
// kept writing to the review ON SCREEN rather than the review it started in:
// switching reviews mid-upload moved the remaining files into the other
// review's list, and the upload then saved that list over its own review.
// The same shape was in the invoice upload, in the analysis run (its report
// drawn into whichever review was open when the save returned) and in every
// document and term action that read the open review after an `await`.
//
// This walks each of those with the switch made MID-FLIGHT, in both
// directions, and checks the screen, the in-memory review and the stored row.
//
// The Supabase stand-in is test-e2e-acquisition-terms.js's, carried verbatim.
// One test-only wrapper is added: every write is deep-copied, as a database
// serialises it — the stand-in's shallow copy otherwise lets an in-memory list
// masquerade as a stored one — and sign-in can be slowed to hold an action
// open while the switch is made.
//
// Run: node test-e2e-acquisition-isolation.js
// ============================================================================
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
let pw; try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }

const ROOT = __dirname, PORT = 8941;
const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css',
               '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg',
               '.svg':'image/svg+xml', '.pdf':'application/pdf', '.txt':'text/plain' };

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail || '' });
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (detail ? '  — ' + detail : ''));
}

const UID = 'u1';
const MAPLE = 'fffffff1-0000-4000-b000-00000000a9e1';
const FAM   = 'fam-maple-shoprite';
const EV = (v, q, p, c) => ({ value: v, quote: q, page: p, confidence: c });
const FIELDS = (o) => ({ schemaVersion: 1, model: 'claude-sonnet-4-6', at: '2026-09-22T15:09:11Z', fields: o });
const TENANT = (name, file) => ({ tenant_name: name, _fileName: file, _status: 'ok', lease_start_date: '2023-03-01',
  lease_end_date: '2028-02-29', lease_type: 'NNN', sqft: 65000, cam_cap: 4, audit_rights: true, pro_rata_method: 'occupied' });

// Maple Plaza as the Pilot holds it: two tenant rows for one leasehold (lease
// and amendment), and the two documents behind them, one of them a proposal.
const MAPLE_DOCS = [
  { id: 'm-lease', review_id: MAPLE, user_id: UID, intake_id: 'ik-m1', file_name: 'ShopRite_Anchor_Tenant_Lease.pdf',
    intake_kind: 'lease', parsing_status: 'success', storage_path: 'leases/u1/acq_m1.pdf',
    doc_type: 'renewal', doc_type_status: 'corrected', doc_type_source: 'human', confirmed_by: UID,
    confirmed_at: '2026-09-21T20:30:00Z', family_id: FAM, family_status: 'proposed', family_source: 'ai',
    superseded_by_document_id: null, classification_history: [], abstraction_status: 'success',
    abstracted_fields: FIELDS({ tenant_name: EV('ShopRite Supermarkets, Inc.', 'Tenant: ShopRite Supermarkets, Inc.', 1, 0.99) }),
    created_at: '2026-09-21T12:31:02Z' },
  { id: 'm-amd', review_id: MAPLE, user_id: UID, intake_id: 'ik-m2', file_name: 'Maple_Plaza_Test_Lease_Amendment.pdf',
    intake_kind: 'lease', parsing_status: 'success', storage_path: 'leases/u1/acq_m2.pdf',
    doc_type: 'amendment', doc_type_status: 'proposed', doc_type_source: 'ai',
    family_id: FAM, family_status: 'proposed', family_source: 'ai',
    superseded_by_document_id: null, classification_history: [], abstraction_status: 'success',
    abstracted_fields: FIELDS({ tenant_name: EV('ShopRite Supermarkets, Inc.', 'Tenant ShopRite Supermarkets, Inc.', 1, 0.99) }),
    created_at: '2026-09-22T03:15:36Z' },
  // A confirmed original lease in no leasehold yet — the Issue B case — so a
  // person can begin one from it mid-switch (§6c).
  { id: 'm-orig', review_id: MAPLE, user_id: UID, intake_id: 'ik-m3', file_name: 'Sunrise_Original_Lease.pdf',
    intake_kind: 'lease', parsing_status: 'success', storage_path: 'leases/u1/acq_m3.pdf',
    doc_type: 'original_lease', doc_type_status: 'confirmed', doc_type_source: 'human', confirmed_by: UID,
    confirmed_at: '2026-09-21T21:00:00Z', family_id: null, family_status: 'unfiled', family_source: null,
    superseded_by_document_id: null, classification_history: [], abstraction_status: 'success',
    abstracted_fields: FIELDS({ tenant_name: EV('Sunrise Cafe & Bakery LLC', 'Tenant: Sunrise Cafe & Bakery LLC', 1, 0.95) }),
    created_at: '2026-09-21T21:00:00Z' },
];
const MAPLE_TENANTS = [TENANT('ShopRite Supermarkets, Inc', 'ShopRite_Anchor_Tenant_Lease.pdf'),
                       TENANT('ShopRite Supermarkets, Inc', 'Maple_Plaza_Test_Lease_Amendment.pdf')];
const MAPLE_INVOICES = [{ id: 'acqinv-seed', vendorName: 'Atlas Landscaping', amount: 18400, category: 'landscaping',
                          invoiceDate: '2024-06-15', _status: 'ok', fileName: 'atlas.pdf' }];

function leaseText(tenant) {
  return `LEASE AGREEMENT\nTenant: ${tenant}. Commencement Date: March 1, 2023. Expiration Date: February 29, 2028.\n`
    + 'Tenant shall lease approximately 2,600 square feet. This is a Triple Net (NNN) lease.\n'
    + 'This lease continues. '.repeat(60);
}

const DB = `
(function(){
  var U = { id: '${UID}', email: 'pm@example.com' };
  var STORE = { acquisition_reviews: [], acquisition_documents: [],
                acquisition_document_families: [], acquisition_term_decisions: [],
                properties: [], tenants: [] };
  var _seq = 0;
  window.__dbRefusals = [];
  function P(v) { return Promise.resolve(v); }
  function tbl(n) { STORE[n] = STORE[n] || []; return STORE[n]; }
  function clone(o) { var c = {}; for (var k in o) c[k] = o[k]; return c; }
  function project(arr, sel) {
    if (!sel || sel.indexOf('*') >= 0) return arr.map(clone);
    var cols = sel.split(',').map(function (s) { return s.trim(); });
    return arr.map(function (r) { var o = {}; cols.forEach(function (c) { if (c in r) o[c] = r[c]; }); return o; });
  }
  function refuse(code, message) {
    window.__dbRefusals.push({ code: code, message: message });
    return { data: null, error: { code: code, message: message } };
  }
  var OWNED = { acquisition_documents: 1, acquisition_document_families: 1, acquisition_term_decisions: 1 };

  // Migration 026, in the stand-in.
  function decisionRefusal(row) {
    if (!row.user_id || row.user_id !== U.id) return refuse('42501', 'row-level security');
    if (row.decided_by !== row.user_id) return refuse('23514', 'A decision must be recorded by its owner');
    if (['confirm','correct','reject','reopen'].indexOf(row.action) < 0) return refuse('23514', 'acq_term_decisions_action_check');
    if (!row.field_key || !String(row.field_key).trim()) return refuse('23514', 'acq_term_decisions_field_key_check');
    if (row.action === 'correct' && (!row.new_value || !String(row.new_value).trim())) return refuse('23514', 'acq_term_decisions_correct_has_value_check');
    if (row.source_page != null && row.source_page <= 0) return refuse('23514', 'acq_term_decisions_page_check');
    if (row.source_quote && row.source_quote.length > 600) return refuse('23514', 'acq_term_decisions_text_bounds_check');
    if (!tbl('acquisition_reviews').some(function (p) { return p.id === row.review_id && p.user_id === row.user_id; })) {
      return refuse('23503', 'review foreign key');
    }
    if (row.family_id && !tbl('acquisition_document_families').some(function (f) { return f.id === row.family_id && f.user_id === row.user_id; })) {
      return refuse('23503', 'family foreign key');
    }
    if (row.source_document_id && !tbl('acquisition_documents').some(function (d) { return d.id === row.source_document_id && d.user_id === row.user_id; })) {
      return refuse('23503', 'source document foreign key');
    }
    return null;
  }

  function q(name) {
    var filters = [], pending = null, sel = null, ord = null, deleting = false;
    var owned = !!OWNED[name];
    function rows() {
      var out = tbl(name).filter(function (r) { return filters.every(function (f) { return r[f[0]] === f[1]; }); });
      if (owned) out = out.filter(function (r) { return r.user_id === U.id; });
      if (ord) out = out.slice().sort(function (a, b) {
        var x = a[ord[0]], y = b[ord[0]];
        return (x === y ? 0 : (x > y ? 1 : -1)) * (ord[1] ? 1 : -1);
      });
      return out;
    }
    function run() {
      if (pending) {
        // 026: this table is append-only. An UPDATE is refused outright.
        if (name === 'acquisition_term_decisions') return P(refuse('2F004', 'acquisition_term_decisions is append-only: UPDATE is refused'));
        var changed = rows();
        changed.forEach(function (r) { Object.assign(r, pending); r.updated_at = 'rev-' + (++_seq); });
        return P({ data: owned ? project(changed, sel) : changed, error: null });
      }
      return P({ data: owned ? project(rows(), sel) : rows(), error: null });
    }
    var api = {
      select: function (cols) { sel = (typeof cols === 'string' && cols) ? cols : null; return api; },
      eq: function (k, v) { filters.push([k, v]); return api; },
      neq: function () { return api; }, is: function () { return api; }, not: function () { return api; },
      in: function () { return api; }, limit: function () { return api; }, ilike: function () { return api; },
      order: function (col, opts) { ord = [col, !opts || opts.ascending !== false]; return api; },
      single: function () { return run().then(function (r) { return { data: (r.data || [])[0] || null, error: r.error || null }; }); },
      maybeSingle: function () { return run().then(function (r) { return { data: (r.data || [])[0] || null, error: r.error || null }; }); },
      update: function (patch) { pending = patch; return api; },
      insert: function (r) {
        var arr = Array.isArray(r) ? r : [r], out = [], err = null;
        arr.forEach(function (x) {
          if (err) return;
          var row = clone(x);
          if (name === 'acquisition_term_decisions') {
            var bad = decisionRefusal(row);
            if (bad) { err = bad; return; }
            if (!row.decided_at) row.decided_at = new Date().toISOString();
            row.created_at = row.created_at || new Date().toISOString();
          }
          if (!row.id) row.id = 'row-' + (++_seq);
          tbl(name).push(row); out.push(row);
        });
        var p = err ? P(err) : P({ data: out, error: null });
        p.select = function (cols) {
          var s2 = (typeof cols === 'string' && cols) ? cols : null;
          return p.then(function (res) {
            if (res.error) return res;
            return { data: owned ? project(out, s2) : out, error: null };
          });
        };
        return p;
      },
      upsert: function (r, opts) {
        var arr = Array.isArray(r) ? r : [r], t = tbl(name);
        var key = (opts && opts.onConflict) ? String(opts.onConflict).split(',').map(function (s) { return s.trim(); }) : ['id'];
        var out = [], err = null;
        arr.forEach(function (x) {
          if (err) return;
          if (owned && x.user_id !== U.id) { err = refuse('42501', 'row-level security'); return; }
          var i = -1;
          for (var n = 0; n < t.length; n++) { if (key.every(function (k) { return t[n][k] === x[k]; })) { i = n; break; } }
          var next = (i >= 0) ? Object.assign(clone(t[i]), x) : Object.assign({ id: 'row-' + (++_seq) }, x);
          if (i >= 0) { Object.assign(t[i], next); out.push(t[i]); } else { t.push(next); out.push(next); }
        });
        var p = err ? P(err) : P({ data: out, error: null });
        p.select = function (cols) {
          var s2 = (typeof cols === 'string' && cols) ? cols : null;
          return p.then(function (res) { return res.error ? res : { data: owned ? project(out, s2) : out, error: null }; });
        };
        return p;
      },
      delete: function () {
        deleting = true;
        return { eq: function (k, v) {
                   if (name === 'acquisition_term_decisions') return P(refuse('2F004', 'acquisition_term_decisions is append-only: DELETE is refused'));
                   STORE[name] = tbl(name).filter(function (x) { return x[k] !== v; }); return P({ error: null }); },
                 in: function () { return P({ error: null }); } };
      },
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

// Test-only: writes are deep-copied as a database would serialise them, and
// the NEXT sign-in check can be slowed once — the action under test makes it
// first, synchronously, so exactly that await straddles the review switch and
// everything after it runs at normal speed.
const WRAP = `
(function(){
  var make = window.supabase.createClient;
  window.__slowAuthMs = 0;
  window.supabase.createClient = function () {
    var c = make.apply(this, arguments);
    var getUser = c.auth.getUser;
    c.auth.getUser = function () {
      var ms = window.__slowAuthMs, p = getUser.apply(c.auth, arguments);
      window.__slowAuthMs = 0;
      return ms ? new Promise(function (r) { setTimeout(function () { r(p); }, ms); }) : p;
    };
    var from = c.from;
    c.from = function (n) {
      var b = from.call(c, n);
      ['insert', 'update', 'upsert'].forEach(function (m) {
        var o = b[m];
        if (typeof o === 'function') b[m] = function (v) {
          var a = [].slice.call(arguments); a[0] = JSON.parse(JSON.stringify(v)); return o.apply(b, a);
        };
      });
      return b;
    };
    return c;
  };
})();`;

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
  const errs = [];
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => errs.push(String(e.message).split('\n')[0]));
  page.on('dialog', d => d.type() === 'prompt' ? d.accept('Lake View') : d.dismiss().catch(() => {}));
  for (const g of ['**cdnjs**', '**jsdelivr**']) await page.route(g, r => r.fulfill({ status: 200, body: '/*x*/' }));
  await page.route('**fonts.g**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.route('**/api/document-url', r => r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ url: 'https://stub/x?token=signed', expiresIn: 300 }) }));
  // Every AI call takes a while — long enough to switch reviews in the middle.
  await page.route('**/api/claude', async route => {
    const post = route.request().postData() || '';
    await new Promise(r => setTimeout(r, 1200));
    if (/invoice_extraction|commercial real estate invoice/.test(post)) {
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ vendorName: 'Harbor Sweeping', amount: 9100, category: 'sweeping', invoiceDate: '2024-07-01' }) });
    }
    const m = /Tenant: ([A-Za-z ]+)\./.exec(post);
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      tenant_name: m ? m[1] : 'Unknown', lease_start_date: '2023-03-01', lease_end_date: '2028-02-29',
      lease_type: 'NNN', sqft: 2600, cam_cap: 4, audit_rights: true, pro_rata_method: 'occupied', quotes: {} }) });
  });
  await page.addInitScript(DB);
  await page.addInitScript(WRAP);
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2400);
  await page.evaluate(() => {
    const w = document.getElementById('obWelcomeModal');
    if (w && w.style.display !== 'none') { if (typeof obCloseWelcome === 'function') obCloseWelcome('skip'); else w.style.display = 'none'; }
  });

  await page.evaluate(async ({ rid, fam, docs, tenants, invoices }) => {
    __store.acquisition_reviews.push({ id: rid, user_id: 'u1', name: 'Maple plaza', status: 'draft',
      created_at: '2026-09-17T19:14:41Z', updated_at: 'rev-0',
      data: { tenants, invoices, totalSqFt: 90000, documents: [], analysis: null } });
    __store.acquisition_document_families.push({ id: fam, review_id: rid, user_id: 'u1',
      label: 'ShopRite Supermarkets, Inc.', family_kind: 'lease' });
    docs.forEach(d => __store.acquisition_documents.push(d));
    await _loadAcqReviewsAndRender();
    selectAcquisitionReview(rid);
  }, { rid: MAPLE, fam: FAM, docs: MAPLE_DOCS, tenants: MAPLE_TENANTS, invoices: MAPLE_INVOICES });
  await page.waitForTimeout(900);

  // ── readers ──────────────────────────────────────────────────────────────
  const stored = (id) => page.evaluate((id) => {
    const r = __store.acquisition_reviews.find(x => x.id === id);
    return r ? JSON.parse(JSON.stringify({ tenants: (r.data.tenants || []).map(t => t.tenant_name),
      invoices: (r.data.invoices || []).map(i => i.vendorName), analysis: !!r.data.analysis, status: r.status })) : null;
  }, id);
  const memory = (id) => page.evaluate((id) => {
    const r = _acqReviews.find(x => x.id === id);
    return r ? { tenants: (r.data.tenants || []).map(t => t.tenant_name), invoices: (r.data.invoices || []).map(i => i.vendorName) } : null;
  }, id);
  const docsOf = (id) => page.evaluate((id) => __store.acquisition_documents
    .filter(d => d.review_id === id).map(d => JSON.parse(JSON.stringify(d))), id);
  const screen = () => page.evaluate(() => ({
    active: _activeAcqId,
    title: (document.getElementById('acqDetailTitle') || {}).textContent || '',
    leases: (document.getElementById('acqLeaseList') || {}).innerText || '',
    invoices: (document.getElementById('acqInvoiceList') || {}).innerText || '',
    report: ((document.getElementById('acqReportContainer') || {}).innerHTML || '').trim(),
  }));
  // The Lease Terms panel — painted from the open review's families, and the
  // one panel that was NOT repainted when an empty review was opened.
  const terms = () => page.evaluate(() => ({
    count: ((document.getElementById('acqTermsCount') || {}).innerText || '').trim(),
    text: ((document.getElementById('acqTermsList') || {}).innerText || '').replace(/\s+/g, ' ').trim(),
    families: _acqFamilyRows(_activeAcqId).length,
  }));
  const EMPTY_TERMS = /No leasehold has been identified yet/;
  // Sample the screen while work belonging to another review is in flight.
  async function watch(until, pattern, ms = 30000) {
    const seen = []; const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const s = await screen();
      const hit = (s.leases + ' ' + s.invoices + ' ' + s.report).match(pattern);
      if (hit) seen.push(hit[0]);
      if (await until()) return seen;
      await page.waitForTimeout(200);
    }
    seen.push('TIMED OUT');
    return seen;
  }
  const waitFor = (fn, ms = 30000) => page.waitForFunction(fn, null, { timeout: ms }).catch(() => null);

  const MAPLE_DOCS_BEFORE = JSON.stringify(await docsOf(MAPLE));
  console.log('\nAcquisition Review — cross-review isolation\n' + '='.repeat(64));

  // ── 1 · Maple → a new review, mid-upload ────────────────────────────────
  await page.setInputFiles('#acqLeaseInput', [
    { name: 'Luxe_Nails_Lease.txt', mimeType: 'text/plain', buffer: Buffer.from(leaseText('Luxe Nails')) },
    { name: 'Prime_Wellness_Spa_Lease.txt', mimeType: 'text/plain', buffer: Buffer.from(leaseText('Prime Wellness Spa')) },
  ]);
  await waitFor(() => /Luxe_Nails_Lease\.txt/.test(document.getElementById('acqLeaseList').innerText));
  await page.evaluate(() => createAcquisitionReview());
  await page.waitForTimeout(300);
  const LAKE = (await screen()).active;
  check('a new review is created and opened mid-upload', LAKE && LAKE !== MAPLE && (await screen()).title === 'Lake View',
        (await screen()).title);
  const t1 = await terms();
  check('MAPLE → LAKE: the Lease Terms panel is repainted for the new review — no Maple leasehold',
        t1.families === 0 && EMPTY_TERMS.test(t1.text) && !/ShopRite/.test(t1.text) && t1.count === '',
        JSON.stringify({ count: t1.count, text: t1.text.slice(0, 70) }));
  const leak1 = await watch(async () => {
    const s = await stored(MAPLE); return s && s.tenants.includes('Prime Wellness Spa');
  }, /Luxe|Prime/);
  check('MAPLE → LAKE: the new review never shows the upload it did not start',
        leak1.length === 0, leak1.join(', ') || 'nothing seen');
  const lake1 = await stored(LAKE), lakeMem1 = await memory(LAKE);
  check('MAPLE → LAKE: the new review\'s stored tenants are still empty', lake1 && lake1.tenants.length === 0, JSON.stringify(lake1 && lake1.tenants));
  check('MAPLE → LAKE: and its in-memory tenants too', lakeMem1 && lakeMem1.tenants.length === 0, JSON.stringify(lakeMem1 && lakeMem1.tenants));
  check('MAPLE → LAKE: no document was filed under the new review', (await docsOf(LAKE)).length === 0);
  const maple1 = await stored(MAPLE);
  check('Maple keeps every tenant it had, plus both new ones, in order',
        JSON.stringify(maple1.tenants) === JSON.stringify(['ShopRite Supermarkets, Inc', 'ShopRite Supermarkets, Inc', 'Luxe Nails', 'Prime Wellness Spa']),
        JSON.stringify(maple1.tenants));
  const mapleDocs1 = await docsOf(MAPLE);
  check('both new documents are filed under Maple',
        ['Luxe_Nails_Lease.txt', 'Prime_Wellness_Spa_Lease.txt'].every(n => mapleDocs1.some(d => d.file_name === n)), mapleDocs1.map(d => d.file_name).join(', '));
  check('the new review is still the one on screen', (await screen()).active === LAKE);
  const t1b = await terms();
  check('MAPLE → LAKE: after Maple\'s upload finishes, the Lease Terms panel still shows nothing of Maple\'s',
        EMPTY_TERMS.test(t1b.text) && !/ShopRite|Luxe|Prime/.test(t1b.text) && t1b.count === '',
        JSON.stringify({ count: t1b.count, text: t1b.text.slice(0, 70) }));

  // ── 2 · the new review → Maple, mid-upload ──────────────────────────────
  const mapleBefore2 = await stored(MAPLE);
  await page.setInputFiles('#acqLeaseInput', [{ name: 'Oak_Tenant_Lease.txt', mimeType: 'text/plain', buffer: Buffer.from(leaseText('Oak Tenant')) }]);
  await waitFor(() => /Oak_Tenant_Lease\.txt/.test(document.getElementById('acqLeaseList').innerText));
  await page.evaluate((id) => selectAcquisitionReview(id), MAPLE);
  const leak2 = await watch(async () => { const s = await stored(LAKE); return s && s.tenants.includes('Oak Tenant'); }, /Oak/);
  check('LAKE → MAPLE: Maple never shows the new review\'s upload', leak2.length === 0, leak2.join(', ') || 'nothing seen');
  check('LAKE → MAPLE: Maple\'s stored tenants are untouched',
        JSON.stringify((await stored(MAPLE)).tenants) === JSON.stringify(mapleBefore2.tenants), JSON.stringify((await stored(MAPLE)).tenants));
  check('LAKE → MAPLE: the upload lands in the review it started in',
        JSON.stringify((await stored(LAKE)).tenants) === JSON.stringify(['Oak Tenant']), JSON.stringify((await stored(LAKE)).tenants));
  const lakeDocs2 = await docsOf(LAKE);
  check('LAKE → MAPLE: its document is filed there, and only there',
        lakeDocs2.length === 1 && lakeDocs2[0].file_name === 'Oak_Tenant_Lease.txt'
        && !(await docsOf(MAPLE)).some(d => d.file_name === 'Oak_Tenant_Lease.txt'));

  // ── 3 · leave mid-upload and come back ──────────────────────────────────
  await page.setInputFiles('#acqLeaseInput', [
    { name: 'Sunrise_Cafe_Lease.txt', mimeType: 'text/plain', buffer: Buffer.from(leaseText('Sunrise Cafe')) },
    { name: 'Maple_Coffee_Lease.txt', mimeType: 'text/plain', buffer: Buffer.from(leaseText('Maple Coffee')) },
  ]);
  await waitFor(() => /Sunrise_Cafe_Lease\.txt/.test(document.getElementById('acqLeaseList').innerText));
  await page.evaluate((id) => selectAcquisitionReview(id), LAKE);
  await page.waitForTimeout(400);
  const away = await screen();
  await page.evaluate((id) => selectAcquisitionReview(id), MAPLE);
  await page.waitForTimeout(200);
  const back = await screen();
  check('away mid-upload: the other review shows none of it', !/Sunrise|Maple Coffee/.test(away.leases), away.leases.slice(0, 80));
  check('back mid-upload: the review shows its own upload in progress', /Sunrise/.test(back.leases), back.leases.slice(0, 160));
  await waitFor(() => (__store.acquisition_reviews.find(r => r.name === 'Maple plaza').data.tenants || [])
    .some(t => t.tenant_name === 'Maple Coffee'));
  const maple3 = await stored(MAPLE);
  check('back mid-upload: both files are kept on the review that took them',
        maple3.tenants.includes('Sunrise Cafe') && maple3.tenants.includes('Maple Coffee'), JSON.stringify(maple3.tenants));
  check('back mid-upload: the other review is untouched', JSON.stringify((await stored(LAKE)).tenants) === JSON.stringify(['Oak Tenant']));
  const shown3 = await screen();
  check('and the screen shows the finished rows', /Sunrise Cafe/.test(shown3.leases) && /Maple Coffee/.test(shown3.leases));

  // ── 4 · invoices, mid-upload ─────────────────────────────────────────────
  // Two files: the first placeholder is added before anything is awaited,
  // while Maple is still open; only the SECOND is added after the switch.
  await page.setInputFiles('#acqInvoiceInput', [
    { name: 'harbor-sweeping-july.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 invoice fixture july') },
    { name: 'harbor-sweeping-august.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 invoice fixture august') },
  ]);
  await waitFor(() => /harbor-sweeping-july\.pdf/.test(document.getElementById('acqInvoiceList').innerText));
  await page.evaluate((id) => selectAcquisitionReview(id), LAKE);
  const leak4 = await watch(async () => { const s = await stored(MAPLE); return s && s.invoices.length === 3; }, /harbor|Harbor Sweeping/i);
  check('invoices: the other review never shows the upload', leak4.length === 0, leak4.join(', ') || 'nothing seen');
  check('invoices: nothing is stored on the other review', (await stored(LAKE)).invoices.length === 0 && (await memory(LAKE)).invoices.length === 0);
  check('invoices: both invoices are kept on the review that took them',
        JSON.stringify((await stored(MAPLE)).invoices) === JSON.stringify(['Atlas Landscaping', 'Harbor Sweeping', 'Harbor Sweeping']),
        JSON.stringify((await stored(MAPLE)).invoices));

  // ── 5 · analysis, with the save held open ───────────────────────────────
  await page.evaluate((id) => selectAcquisitionReview(id), MAPLE);
  await page.waitForTimeout(400);
  await page.evaluate(({ m, l }) => {
    window.__slowAuthMs = 1500;
    runAcquisitionAnalysis();          // reads Maple now; its save is held open by the slow sign-in
    selectAcquisitionReview(l);        // …while the person opens the other review
  }, { m: MAPLE, l: LAKE });
  await waitFor(() => { const r = __store.acquisition_reviews.find(x => x.name === 'Maple plaza'); return r && r.data.analysis; }, 15000);
  await page.waitForTimeout(600);
  await page.evaluate(() => { window.__slowAuthMs = 0; });
  const s5 = await screen();
  check('analysis: the review on screen when it returns is the other one', s5.active === LAKE, s5.title);
  check('analysis: its report is NOT drawn into the other review', s5.report === '', s5.report.slice(0, 80) || 'empty');
  const maple5 = await stored(MAPLE);
  check('analysis: the result is stored on the review that ran it', maple5.analysis && maple5.status === 'complete', JSON.stringify(maple5));
  check('analysis: nothing is stored on the other review', !(await stored(LAKE)).analysis);
  await page.evaluate((id) => selectAcquisitionReview(id), MAPLE);
  await page.waitForTimeout(300);
  check('analysis: reopening the review that ran it shows its report', /ShopRite/.test((await screen()).report));

  // ── 6 · a document action, with the switch made mid-action ──────────────
  await page.evaluate(({ l }) => {
    window.__slowAuthMs = 1200;
    acqConfirmDocType('m-amd');        // Maple's amendment, confirmed…
    selectAcquisitionReview(l);        // …while the other review is opened
  }, { l: LAKE });
  await page.waitForTimeout(2600);
  await page.evaluate(() => { window.__slowAuthMs = 0; });
  const amd = (await docsOf(MAPLE)).find(d => d.id === 'm-amd');
  check('document action: the confirmation lands on the document it was about',
        amd && amd.doc_type_status === 'confirmed' && amd.review_id === MAPLE, amd && amd.doc_type_status);
  const lakeDocs6 = await docsOf(LAKE);
  check('document action: no copy of it is filed under the other review',
        lakeDocs6.length === 1 && !lakeDocs6.some(d => d.intake_id === 'ik-m2'), lakeDocs6.map(d => d.file_name).join(', '));

  // A human act on one Maple document, held open while the other review is
  // opened. Whatever it writes must land on that document, under Maple.
  async function actAcross(label, call, arg, expect) {
    await page.evaluate((id) => selectAcquisitionReview(id), MAPLE);
    await page.waitForTimeout(900);
    const lakeDocsBefore = (await docsOf(LAKE)).length;
    const lakeFamsBefore = await page.evaluate((l) => __store.acquisition_document_families.filter(f => f.review_id === l).length, LAKE);
    await page.evaluate(({ call, arg, l }) => {
      window.__slowAuthMs = 1200;
      window[call].apply(null, arg);
      selectAcquisitionReview(l);
    }, { call, arg, l: LAKE });
    await page.waitForTimeout(3200);
    await page.evaluate(() => { window.__slowAuthMs = 0; });
    const lakeDocsAfter = await docsOf(LAKE);
    const lakeFamsAfter = await page.evaluate((l) => __store.acquisition_document_families.filter(f => f.review_id === l).length, LAKE);
    const row = (await docsOf(MAPLE)).find(d => d.id === arg[0]);
    check(label + ': it lands on the Maple document it was about', !!row && expect(row), row && JSON.stringify({
      type: row.doc_type, status: row.doc_type_status, fam: row.family_id, abs: row.abstraction_status }));
    check(label + ': nothing is filed under the other review',
          lakeDocsAfter.length === lakeDocsBefore && lakeFamsAfter === lakeFamsBefore,
          lakeDocsAfter.map(d => d.file_name).join(', ') + ' · families ' + lakeFamsAfter);
  }
  const docId = async (name) => (await docsOf(MAPLE)).find(d => d.file_name === name).id;

  // ── 6b · correcting a document's type ───────────────────────────────────
  await actAcross('set type', 'acqSetDocType', [await docId('Luxe_Nails_Lease.txt'), 'estoppel'],
    r => r.doc_type === 'estoppel' && r.doc_type_status === 'corrected');
  // ── 6c · beginning a leasehold from a document ──────────────────────────
  await actAcross('begin leasehold', 'acqBeginLeasehold', ['m-orig'],
    r => !!r.family_id && r.family_status === 'confirmed');
  const newFam = await page.evaluate(() => {
    const d = __store.acquisition_documents.find(x => x.id === 'm-orig');
    const f = d && __store.acquisition_document_families.find(x => x.id === d.family_id);
    return f ? f.review_id : null;
  });
  check('begin leasehold: the new leasehold belongs to Maple', newFam === MAPLE, String(newFam));
  // ── 6d · asking for a document to be read again ─────────────────────────
  await actAcross('re-read', 'acqReabstractDocument', [await docId('Prime_Wellness_Spa_Lease.txt')],
    r => r.abstraction_status === 'skipped');

  // ── 7 · a term decision, with the switch made mid-action ────────────────
  await page.evaluate((id) => selectAcquisitionReview(id), MAPLE);
  await page.waitForTimeout(1200);
  const termReady = await page.evaluate((f) => !!_acqTermFor(f, 'tenant_name'), FAM);
  check('the Maple leasehold has a tenant term to decide on', termReady);
  const decBefore = await page.evaluate(() => __store.acquisition_term_decisions.length);
  await page.evaluate(({ f, l }) => {
    window.__slowAuthMs = 1200;
    acqRejectTerm(f, 'tenant_name');
    selectAcquisitionReview(l);
  }, { f: FAM, l: LAKE });
  await page.waitForTimeout(2600);
  await page.evaluate(() => { window.__slowAuthMs = 0; });
  const decs = await page.evaluate(() => JSON.parse(JSON.stringify(__store.acquisition_term_decisions)));
  const newDecs = decs.slice(decBefore);
  check('term decision: recorded once, against the review it was made in',
        newDecs.length === 1 && newDecs[0].review_id === MAPLE && newDecs[0].family_id === FAM,
        JSON.stringify(newDecs.map(d => d.review_id)));
  check('term decision: none is recorded against the other review', !decs.some(d => d.review_id === LAKE));

  // ── 8 · Maple's existing documents, and the v2 report ───────────────────
  const mapleDocsAfter = await docsOf(MAPLE);
  const before = JSON.parse(MAPLE_DOCS_BEFORE);
  const untouched = before.filter(b => b.id === 'm-lease').every(b =>
    JSON.stringify(mapleDocsAfter.find(a => a.id === b.id)) === JSON.stringify(b));
  check('Maple\'s existing lease is byte-for-byte what it was', untouched);
  const amdAfter = mapleDocsAfter.find(a => a.id === 'm-amd');
  const amdBefore = before.find(b => b.id === 'm-amd');
  check('and the amendment changed only by the confirmation made in §6',
        amdAfter && JSON.stringify(amdAfter.abstracted_fields) === JSON.stringify(amdBefore.abstracted_fields)
        && amdAfter.storage_path === amdBefore.storage_path && amdAfter.file_name === amdBefore.file_name
        && amdAfter.family_id === amdBefore.family_id);

  const v2 = async (id) => {
    await page.evaluate((id) => { if (typeof closeReport === 'function') closeReport(); selectAcquisitionReview(id); }, id);
    await page.waitForTimeout(600);
    await page.click('#acqReportV2Btn');
    await page.waitForTimeout(800);
    return page.evaluate(() => {
      const root = document.querySelector('#rptBody [data-report="acquisition-v2"]');
      return root ? {
        docs: [].map.call(root.querySelectorAll('.acqr-doc'), r => r.getAttribute('data-doc')).sort(),
        leaseholds: [].map.call(root.querySelectorAll('.acqr-roster li'), li => li.getAttribute('data-leasehold')),
      } : null;
    });
  };
  const mv2 = await v2(MAPLE);
  const mapleIds = (await docsOf(MAPLE)).map(d => d.id).sort();
  check('v2 report for Maple lists exactly Maple\'s documents', mv2 && JSON.stringify(mv2.docs) === JSON.stringify(mapleIds),
        mv2 && mv2.docs.length + ' of ' + mapleIds.length);
  const mapleFams = await page.evaluate((m) => __store.acquisition_document_families.filter(f => f.review_id === m).map(f => f.id).sort(), MAPLE);
  check('v2 report for Maple shows exactly its own leaseholds',
        mv2 && JSON.stringify(mv2.leaseholds.slice().sort()) === JSON.stringify(mapleFams) && mapleFams.indexOf(FAM) >= 0,
        mv2 && mv2.leaseholds.length + ' of ' + mapleFams.length);
  const lv2 = await v2(LAKE);
  const lakeIds = (await docsOf(LAKE)).map(d => d.id).sort();
  check('v2 report for the other review lists only its own document',
        lv2 && JSON.stringify(lv2.docs) === JSON.stringify(lakeIds) && lakeIds.length === 1, lv2 && lv2.docs.join(','));
  check('v2 report for the other review shows no Maple leasehold', lv2 && lv2.leaseholds.indexOf(FAM) < 0);
  await page.evaluate(() => { if (typeof closeReport === 'function') closeReport(); });

  // ── 9 · the Lease Terms panel follows the review, with nothing in flight ─
  // Give Lake View a leasehold of its own: its Oak lease, corrected to an
  // original lease, begins one. Now both reviews have terms to show.
  await page.evaluate((id) => selectAcquisitionReview(id), LAKE);
  await page.waitForTimeout(900);
  await page.evaluate((docId) => acqSetDocType(docId, 'original_lease'), (await docsOf(LAKE)).find(d => d.file_name === 'Oak_Tenant_Lease.txt').id);
  await waitFor(() => /Oak Tenant/.test((document.getElementById('acqTermsList') || {}).innerText || ''), 20000);
  const tLake = await terms();
  check('Lake View\'s Lease Terms show its own leasehold and count',
        tLake.families === 1 && /Oak Tenant/.test(tLake.text) && !/ShopRite|Sunrise/.test(tLake.text) && /of 27 verified/.test(tLake.count),
        JSON.stringify({ count: tLake.count, text: tLake.text.slice(0, 60) }));
  await page.evaluate((id) => selectAcquisitionReview(id), MAPLE);
  await page.waitForTimeout(900);
  const tMaple = await terms();
  const mapleFamCount = await page.evaluate((m) => _acqFamilyRows(m).length, MAPLE);
  check('populated → populated: Maple\'s Lease Terms show Maple\'s leaseholds, not Lake View\'s',
        tMaple.families === mapleFamCount && mapleFamCount >= 2 && /ShopRite/.test(tMaple.text) && !/Oak Tenant/.test(tMaple.text)
        && new RegExp('of ' + (27 * mapleFamCount) + ' verified').test(tMaple.count),
        JSON.stringify({ count: tMaple.count, families: mapleFamCount }));
  await page.evaluate((id) => selectAcquisitionReview(id), LAKE);
  await page.waitForTimeout(900);
  const tLake2 = await terms();
  check('populated → populated: back on Lake View, only its leasehold', /Oak Tenant/.test(tLake2.text) && !/ShopRite/.test(tLake2.text) && /of 27 verified/.test(tLake2.count),
        JSON.stringify({ count: tLake2.count }));
  // An empty review opened with nothing in flight at all — the plain case.
  await page.evaluate(() => createAcquisitionReview());
  await page.waitForTimeout(1200);
  const THIRD = (await screen()).active;
  const tEmpty = await terms();
  check('populated → empty: an empty review\'s Lease Terms say so, and show no other review\'s terms',
        THIRD !== LAKE && THIRD !== MAPLE && EMPTY_TERMS.test(tEmpty.text) && !/Oak Tenant|ShopRite/.test(tEmpty.text) && tEmpty.count === '',
        JSON.stringify({ count: tEmpty.count, text: tEmpty.text.slice(0, 70) }));
  // …and when the documents table is missing, the panel is still repainted.
  await page.evaluate((id) => selectAcquisitionReview(id), LAKE);
  await page.waitForTimeout(900);
  // Read at the FIRST paint, synchronously after the open: when the table is
  // really missing the loads keep the flag set, so that paint is also the last.
  const tGap = await page.evaluate((id) => {
    _acqDocsUnavailable = true;
    selectAcquisitionReview(id);
    const snap = { text: ((document.getElementById('acqTermsList') || {}).innerText || '').replace(/\s+/g, ' ').trim() };
    _acqDocsUnavailable = false;
    return snap;
  }, THIRD);
  await page.waitForTimeout(600);
  check('with the documents table missing, the empty review still shows no other review\'s terms',
        EMPTY_TERMS.test(tGap.text) && !/Oak Tenant|ShopRite/.test(tGap.text), tGap.text.slice(0, 70));

  check('no uncaught errors', errs.length === 0, errs.slice(0, 3).join(' | ') || 'clean');

  await browser.close(); srv.close();
  const failed = results.filter(r => !r.ok);
  console.log('='.repeat(64));
  console.log(`${results.length - failed.length}/${results.length} passed`);
  if (failed.length) { console.log('FAILED:'); failed.forEach(f => console.log('  - ' + f.name + ' :: ' + f.detail)); }
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(2); });
