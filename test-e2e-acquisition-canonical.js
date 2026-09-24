// test-e2e-acquisition-canonical.js
// ============================================================================
// Acquisition Review §4l — one tenant row per leasehold, walked in the page.
//
// Found on the Pilot: a person corrected ShopRite's leased area from 65,000 to
// 67,000 in the Lease Terms panel, and the Rent Roll went on saying 65,000,
// because the Rent Roll read review.data.tenants[] (one row per uploaded
// file, as extracted) and the correction lived in acquisition_term_decisions.
// A lease and its amendment counted as two tenants. A term no document
// established could not be supplied at all.
//
// This walks the whole path in the real page, against the stand-in database
// test-e2e-acquisition-isolation.js uses (migration 026's rules included):
//
//   1  an analysis stored before §4l is flagged as behind the terms, and one
//      click rebuilds it from the leaseholds — two source files, one row
//   2  the 65,000 → 67,000 correction reaches the Rent Roll, the stored
//      analysis and the v1 Decision Report; the raw upload rows are untouched
//   3  a missing Security deposit is ENTERED: the Lease Terms panel, the
//      Rent Roll and Report v2 all show 25,000 as Verified · Entered by a
//      person · No document on file supports this value; the stored decision
//      cites no document
//   4  the CSV carries the resolved values, says what each row is, and lists
//      the entered and contested fields
//   5  the 4% vs 3% CAM cap stays contested everywhere
//   6  conversion produces one tenant per leasehold with the resolved values,
//      plus the unfiled row marked as such; the review keeps its raw rows
//   7  Lake View — raw rows, no documents, no leasehold — never reads as
//      verified
//
// Run: node test-e2e-acquisition-canonical.js
// ============================================================================
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
let pw; try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }

const ROOT = __dirname, PORT = 8943;
const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css',
               '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg',
               '.svg':'image/svg+xml', '.pdf':'application/pdf', '.txt':'text/plain' };

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail || '' });
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (detail ? '  — ' + detail : ''));
}

const UID = 'u1';
const MAPLE = 'fffffff1-0000-4000-b000-00000000c4a1';
const LAKE  = 'fffffff1-0000-4000-b000-00000000c4a2';
const FAM   = '8b175124-98c2-46be-a44c-34d622378e44';
const EV = (v, q, p, c) => ({ value: v, quote: q, page: p, confidence: c });
const FIELDS = (o) => ({ schemaVersion: 1, model: 'claude-sonnet-4-6', at: '2026-09-22T15:09:11Z', fields: o });

// Maple Plaza as the Pilot holds it: one leasehold behind two files (a
// corrected renewal and a confirmed amendment that disagree on the cap), a
// third file in no leasehold, and one raw tenant row per file — all three
// still saying what the extraction said.
const MAPLE_DOCS = [
  { id: 'm-lease', review_id: MAPLE, user_id: UID, intake_id: 'ik-m1', file_name: 'ShopRite_Anchor_Tenant_Lease.pdf',
    intake_kind: 'lease', parsing_status: 'success', storage_path: 'leases/u1/acq_m1.pdf', produced_kind: 'tenant', produced_id: 't-lease',
    doc_type: 'renewal', doc_type_status: 'corrected', doc_type_source: 'human', confirmed_by: UID,
    confirmed_at: '2026-09-21T20:30:00Z', doc_date: '2024-03-01', family_id: FAM, family_status: 'confirmed', family_source: 'human',
    superseded_by_document_id: null, classification_history: [], abstraction_status: 'success',
    abstracted_fields: FIELDS({
      tenant_name: EV('ShopRite Supermarkets, Inc.', 'Tenant: ShopRite Supermarkets, Inc.', 1, 0.99),
      suite:       EV('Anchor Unit A-1', 'Premises: Anchor Unit A-1', 1, 0.9),
      leased_sqft: EV(65000, 'Leased Area: 65,000 rentable square feet', 1, 0.99),
      cap:         EV(4, 'CAM increases are capped at 4% annually.', 4, 0.95),
      base_rent:   EV(1202500, 'Tenant agrees to pay base rent of $18.50 per square foot annually.', 3, 0.95),
      start_date:  EV('2024-03-01', 'Commencement Date: March 1, 2024', 2, 0.9),
      end_date:    EV('2034-02-28', 'Expiration Date: February 28, 2034', 2, 0.9),
    }),
    created_at: '2026-09-21T12:31:02Z' },
  { id: 'm-amd', review_id: MAPLE, user_id: UID, intake_id: 'ik-m2', file_name: 'Maple_Plaza_Test_Lease_Amendment.pdf',
    intake_kind: 'lease', parsing_status: 'success', storage_path: 'leases/u1/acq_m2.pdf', produced_kind: 'tenant', produced_id: 't-amd',
    doc_type: 'amendment', doc_type_status: 'confirmed', doc_type_source: 'human', confirmed_by: UID,
    confirmed_at: '2026-09-22T15:00:00Z', doc_date: '2027-01-01', family_id: FAM, family_status: 'confirmed', family_source: 'human',
    superseded_by_document_id: null, classification_history: [], abstraction_status: 'success',
    abstracted_fields: FIELDS({
      tenant_name: EV('ShopRite Supermarkets, Inc.', 'Tenant ShopRite Supermarkets, Inc.', 1, 0.99),
      leased_sqft: EV(65000, 'the Premises contain 65,000 rentable square feet', 1, 0.99),
      // The suite disagrees with the renewal's, so a Rent Roll COLUMN is contested.
      suite:       EV('Anchor Unit A-3', 'Suite: Anchor Unit A-3', 1, 0.9),
      cap:         EV(3, 'controllable Common Area Maintenance expense increases shall not exceed 3% per year', 1, 0.99),
    }),
    created_at: '2026-09-22T03:15:36Z' },
  { id: 'm-mystery', review_id: MAPLE, user_id: UID, intake_id: 'ik-m3', file_name: 'Mystery_Tenant_Lease.pdf',
    intake_kind: 'lease', parsing_status: 'success', storage_path: 'leases/u1/acq_m3.pdf', produced_kind: 'tenant', produced_id: 't-mystery',
    doc_type: 'original_lease', doc_type_status: 'proposed', doc_type_source: 'ai', doc_date: null,
    family_id: null, family_status: 'unfiled', family_source: null,
    superseded_by_document_id: null, classification_history: [], abstraction_status: 'success',
    abstracted_fields: FIELDS({ tenant_name: EV('Mystery Tenant LLC', 'Tenant: Mystery Tenant LLC', 1, 0.8) }),
    created_at: '2026-09-22T09:00:00Z' },
];
const RAW = (id, name, file, over) => Object.assign({ id, tenant_name: name, _fileName: file, _status: 'ok',
  start_date: '2024-03-01', end_date: '2034-02-28', lease_type: 'NNN', leased_sqft: 65000, base_rent: 1202500,
  cap: 4, audit_rights: true, pro_rata_method: 'occupied', security_deposit: null, quotes: {} }, over || {});
const MAPLE_TENANTS = [
  RAW('t-lease',   'ShopRite Supermarkets, Inc.', 'ShopRite_Anchor_Tenant_Lease.pdf'),
  RAW('t-amd',     'ShopRite Supermarkets, Inc.', 'Maple_Plaza_Test_Lease_Amendment.pdf', { cap: 3, base_rent: 1251250 }),
  RAW('t-mystery', 'Mystery Tenant LLC', 'Mystery_Tenant_Lease.pdf', { leased_sqft: 1200, base_rent: 36000, cap: null }),
];
const MAPLE_INVOICES = [{ id: 'acqinv-1', vendorName: 'Atlas Landscaping', amount: 18400, category: 'landscaping',
                          invoiceDate: '2024-06-15', _status: 'ok', fileName: 'atlas.pdf' }];
// Lake View: raw rows from before any document was filed. No documents, no leasehold.
const LAKE_TENANTS = [
  RAW('lv-1', 'Lake Pharmacy', 'Lake_Pharmacy_Lease.pdf', { leased_sqft: 3000, base_rent: 60000 }),
  RAW('lv-2', 'Lake Diner',    'Lake_Diner_Lease.pdf',    { leased_sqft: 2500, base_rent: 48000, cap: null }),
];

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
    var filters = [], pending = null, sel = null, ord = null;
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
        if (name === 'acquisition_term_decisions') return P(refuse('2F004', 'acquisition_term_decisions is append-only: UPDATE is refused'));
        var changed = rows();
        // As a database serialises it: the stored row is a COPY of the patch.
        changed.forEach(function (r) { Object.assign(r, JSON.parse(JSON.stringify(pending))); r.updated_at = 'rev-' + (++_seq); });
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
          var row = JSON.parse(JSON.stringify(x));
          if (name === 'acquisition_term_decisions') {
            var bad = decisionRefusal(row);
            if (bad) { err = bad; return; }
            if (!row.decided_at) row.decided_at = new Date().toISOString();
            row.created_at = row.created_at || new Date().toISOString();
          }
          if (!row.id) row.id = 'row-' + (++_seq) + '-0000-4000-b000-000000000000';
          tbl(name).push(row); out.push(row);
        });
        var p = err ? P(err) : P({ data: out, error: null });
        p.select = function (cols) {
          var s2 = (typeof cols === 'string' && cols) ? cols : null;
          var r2 = p.then(function (res) { if (res.error) return res; return { data: owned ? project(out, s2) : out, error: null }; });
          r2.single = function () { return r2.then(function (res) { return { data: (res.data || [])[0] || null, error: res.error || null }; }); };
          return r2;
        };
        return p;
      },
      upsert: function (r, opts) {
        var arr = Array.isArray(r) ? r : [r], t = tbl(name);
        var key = (opts && opts.onConflict) ? String(opts.onConflict).split(',').map(function (s) { return s.trim(); }) : ['id'];
        var out = [], err = null;
        arr.forEach(function (x0) {
          if (err) return;
          var x = JSON.parse(JSON.stringify(x0));
          if (owned && x.user_id !== U.id) { err = refuse('42501', 'row-level security'); return; }
          var i = -1;
          for (var n = 0; n < t.length; n++) { if (key.every(function (k) { return t[n][k] === x[k]; })) { i = n; break; } }
          var next = (i >= 0) ? Object.assign(clone(t[i]), x) : Object.assign({ id: 'row-' + (++_seq) + '-0000-4000-b000-000000000000' }, x);
          if (i >= 0) { Object.assign(t[i], next); out.push(t[i]); } else { t.push(next); out.push(next); }
        });
        var p = err ? P(err) : P({ data: out, error: null });
        p.select = function (cols) {
          var s2 = (typeof cols === 'string' && cols) ? cols : null;
          var r2 = p.then(function (res) { return res.error ? res : { data: owned ? project(out, s2) : out, error: null }; });
          r2.single = function () { return r2.then(function (res) { return { data: (res.data || [])[0] || null, error: res.error || null }; }); };
          return r2;
        };
        return p;
      },
      delete: function () {
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
    rpc: function (fn, args) { window.__rpc = (window.__rpc || []).concat([{ fn: fn, args: JSON.parse(JSON.stringify(args || null)) }]); return P({ data: null, error: null }); },
    from: q,
    storage: { from: function () { return { upload: function () { return P({ data: { path: 'x' }, error: null }); },
                                           getPublicUrl: function () { return { data: { publicUrl: '' } }; } }; } },
  }; } };
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
  page.on('dialog', d => d.dismiss().catch(() => {}));
  for (const g of ['**cdnjs**', '**jsdelivr**']) await page.route(g, r => r.fulfill({ status: 200, body: '/*x*/' }));
  await page.route('**fonts.g**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  const claude = [];
  await page.route('**/api/claude', r => { claude.push(r.request().postData() || '');
    r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }); });
  await page.addInitScript(DB);
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2400);
  await page.evaluate(() => {
    const w = document.getElementById('obWelcomeModal');
    if (w && w.style.display !== 'none') { if (typeof obCloseWelcome === 'function') obCloseWelcome('skip'); else w.style.display = 'none'; }
  });

  // Maple is seeded WITH an analysis run before §4l: built from the raw rows,
  // no `canonical` block — exactly what the Pilot holds today.
  await page.evaluate(async ({ maple, lake, fam, docs, tenants, invoices, lakeTenants }) => {
    const legacy = AcquisitionEngine.buildAcquisitionReport(tenants, invoices, 90000);
    __store.acquisition_reviews.push({ id: maple, user_id: 'u1', name: 'Maple Plaza', status: 'complete',
      created_at: '2026-09-17T19:14:41Z', updated_at: 'rev-0',
      data: { tenants, invoices, totalSqFt: 90000, documents: [], analysis: legacy } });
    __store.acquisition_reviews.push({ id: lake, user_id: 'u1', name: 'Lake View', status: 'draft',
      created_at: '2026-09-18T10:00:00Z', updated_at: 'rev-0',
      data: { tenants: lakeTenants, invoices, totalSqFt: 12000, documents: [], analysis: null } });
    __store.acquisition_document_families.push({ id: fam, review_id: maple, user_id: 'u1',
      label: 'ShopRite Supermarkets, Inc.', tenant_hint: 'ShopRite Supermarkets, Inc.', family_kind: 'lease' });
    docs.forEach(d => __store.acquisition_documents.push(d));
    await _loadAcqReviewsAndRender();
    selectAcquisitionReview(maple);
  }, { maple: MAPLE, lake: LAKE, fam: FAM, docs: MAPLE_DOCS, tenants: MAPLE_TENANTS, invoices: MAPLE_INVOICES, lakeTenants: LAKE_TENANTS });
  await page.waitForTimeout(1200);
  // §4m: the review opens on the Lease Matrix; ShopRite's terms are in its
  // record, opened from its row.
  await page.click(`#acqTermsList .acq-lm-row[data-leasehold="${FAM}"]`);
  await page.waitForSelector(`#acqTermsList .acq-term-group[data-family="${FAM}"]`, { timeout: 10000 });

  // ── readers ──────────────────────────────────────────────────────────────
  const txt = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  // The Rent Roll is sorted by tenant name; rows are found by name, not index.
  const shopRow = (rr) => rr.rows.find(r => /ShopRite/.test(r.name)) || {};
  const mystRow = (rr) => rr.rows.find(r => /Mystery/.test(r.name)) || {};
  const rentRoll = () => page.evaluate(() => {
    const rows = [].map.call(document.querySelectorAll('#acqRentRollTbody tr'), tr => {
      const tds = [].map.call(tr.querySelectorAll('td'), td => td.innerText.replace(/\s+/g, ' ').trim());
      return { source: tr.getAttribute('data-source'), leasehold: tr.getAttribute('data-leasehold'),
               name: tds[0], suite: tds[1], sqft: tds[2], term: tds[3], rent: tds[4], renewal: tds[5], deposit: tds[6], cam: tds[7],
               entered: [].map.call(tr.querySelectorAll('.acq-rr-entered'), e => e.closest('td').cellIndex),
               contested: [].map.call(tr.querySelectorAll('.acq-rr-contested'), e => e.closest('td').cellIndex),
               missing: [].map.call(tr.querySelectorAll('.acq-rr-missing'), e => e.closest('td').cellIndex),
               unfiled: !!tr.querySelector('.acq-rr-unfiled') };
    });
    const stale = [].map.call(document.querySelectorAll('#acqReportContainer .acq-analysis-stale'), el =>
      ({ shown: el.style.display !== 'none', text: el.innerText.replace(/\s+/g, ' ').trim() }));
    const line = document.querySelector('#acqTabRentRoll .acq-canonical-line');
    // The v1 Decision Report reads the same stored tenantSummary; its rows
    // are what Ask AI and drafting read too.
    return { rows, stale, line: line ? { text: line.innerText.replace(/\s+/g, ' ').trim(),
      leaseholds: line.getAttribute('data-leaseholds'), unfiled: line.getAttribute('data-unfiled') } : null,
      tab: _acqActiveTab };
  });
  const stored = (id) => page.evaluate((id) => {
    const r = __store.acquisition_reviews.find(x => x.id === id);
    return JSON.parse(JSON.stringify({ tenants: r.data.tenants, analysis: r.data.analysis, status: r.status }));
  }, id);
  const termRow = (field) => page.evaluate((field) => {
    const r = document.querySelector(`#acqTermsList .acq-term-row[data-field="${field}"]`);
    return r ? { state: r.getAttribute('data-state'), origin: r.getAttribute('data-origin'),
                 text: r.innerText.replace(/\s+/g, ' ').trim(),
                 buttons: [].map.call(r.querySelectorAll('.acq-term-actions button'), b => b.textContent.trim() + (b.disabled ? '(off)' : '')) } : null;
  }, field);

  console.log('\nAcquisition Review — one row per leasehold (§4l)\n' + '='.repeat(64));

  // ── 1 · an analysis from before §4l is flagged, and one click rebuilds it ─
  const before = await rentRoll();
  check('the stored (pre-§4l) analysis is drawn: one row per FILE, three rows, none marked',
        before.rows.length === 3 && before.rows.every(r => !r.source), JSON.stringify(before.rows.map(r => r.name + '|' + r.sqft)));
  check('and it is flagged as run before the Rent Roll read the lease terms, with the refresh control',
        before.stale.length === 1 && before.stale.every(s => s.shown && /before the Rent Roll read the lease terms/.test(s.text) && /Refresh from lease terms/.test(s.text)),
        JSON.stringify(before.stale));
  const errsBefore = errs.length;
  await page.evaluate(() => switchAcqTab('rentroll'));
  await page.click('#acqTabRentRoll .acq-stale-refresh');
  await page.waitForTimeout(900);
  const after = await rentRoll();
  check('the Rent Roll tab stayed open through the refresh', after.tab === 'rentroll', after.tab);
  check('refreshed: two source files became ONE leasehold row, and the unfiled file its own row',
        after.rows.length === 2 && shopRow(after).source === 'leasehold' && shopRow(after).leasehold === FAM
        && mystRow(after).source === 'unfiled', JSON.stringify(after.rows.map(r => r.name + '|' + r.source)));
  check('the notice is gone', after.stale.every(s => !s.shown));
  check('the line above the table says what the rows are',
        after.line && after.line.leaseholds === '1' && after.line.unfiled === '1'
        && /1 leasehold from the lease terms/.test(after.line.text) && /1 row not in a leasehold/.test(after.line.text)
        && /2 source files represented by a leasehold/.test(after.line.text), after.line && after.line.text);
  check('the unfiled row says so on its face, and nothing on it is dressed as verified',
        mystRow(after).unfiled && /Not in a leasehold · not verified/.test(mystRow(after).name)
        && mystRow(after).entered.length === 0 && mystRow(after).contested.length === 0 && mystRow(after).missing.length === 0
        && /1,200/.test(mystRow(after).sqft), JSON.stringify(mystRow(after)));
  check('the leasehold row shows the file\'s 65,000 for now — no correction has been made yet',
        /65,000/.test(shopRow(after).sqft), shopRow(after).sqft);
  check('the contested suite (A-1 vs A-3) reads Contested — neither figure is shown',
        shopRow(after).suite === 'Contested' && shopRow(after).contested.includes(1) && !/A-1|A-3/.test(shopRow(after).suite), shopRow(after).suite);
  check('a term no document establishes reads Not established, never a dash',
        shopRow(after).deposit === 'Not established' && shopRow(after).missing.includes(6), shopRow(after).deposit);
  const st1 = await stored(MAPLE);
  check('the stored analysis carries the canonical block', st1.analysis.canonical && st1.analysis.canonical.leaseholds === 1
        && st1.analysis.canonical.unfiled === 1 && st1.analysis.canonical.dropped === 2 && !!st1.analysis.canonical.fingerprint);
  check('the raw upload rows are untouched — three rows, still 65,000',
        st1.tenants.length === 3 && st1.tenants.filter(t => t.leased_sqft === 65000).length === 2, JSON.stringify(st1.tenants.map(t => t.leased_sqft)));
  check('no page error', errs.length === errsBefore, errs.slice(errsBefore).join(' | '));

  // ── 2 · the correction reaches the Rent Roll ─────────────────────────────
  await page.evaluate(() => { window.prompt = () => '67000'; window.confirm = () => true; });
  await page.evaluate((f) => acqCorrectTerm(f, 'leased_sqft'), FAM);
  await page.waitForTimeout(1200);
  const rr2 = await rentRoll();
  check('65,000 → 67,000: the Rent Roll now says 67,000', /67,000/.test(shopRow(rr2).sqft) && !/65,000/.test(shopRow(rr2).sqft), shopRow(rr2).sqft);
  // The v1 Decision Report draws the same stored rows.
  const v1 = await page.evaluate(() => {
    generateAcquisitionReport();
    const body = (document.getElementById('rptBody') || {}).innerText || '';
    if (typeof closeReport === 'function') closeReport();
    return body.replace(/\s+/g, ' ');
  });
  check('and the v1 Decision Report, which reads the stored analysis, says 67,000 and not 65,000',
        /67,000/.test(v1) && !/65,000/.test(v1), v1.slice(0, 80));
  check('the corrected cell is not tagged as entered — a document stands behind it',
        !shopRow(rr2).entered.includes(2), JSON.stringify(shopRow(rr2).entered));
  const st2 = await stored(MAPLE);
  check('the stored analysis says 67,000', st2.analysis.tenantSummary[0].leased_sqft === 67000 && st2.analysis.tenantSummary[0]._source === 'leasehold');
  check('the raw upload rows STILL say 65,000 — the correction did not rewrite the upload record',
        st2.tenants.length === 3 && st2.tenants.filter(t => t.leased_sqft === 65000).length === 2);
  const term2 = await termRow('leased_sqft');
  check('the Lease Terms panel shows the correction as verified, from the document', term2 && term2.state === 'verified' && !term2.origin && /67,000/.test(term2.text), term2 && term2.text.slice(0, 90));
  check('no notice — the analysis is current', rr2.stale.every(s => !s.shown));

  // ── 3 · entering a missing term ──────────────────────────────────────────
  const dep0 = await termRow('security_deposit');
  check('a missing term offers Enter, and nothing else', dep0 && dep0.state === 'missing'
        && JSON.stringify(dep0.buttons) === JSON.stringify(['Enter']), dep0 && JSON.stringify(dep0.buttons));
  const decBefore = await page.evaluate(() => __store.acquisition_term_decisions.length);
  const prompts = [];
  await page.evaluate(() => {
    window.__prompts = [];
    window.prompt = (msg) => { window.__prompts.push(msg); return '25000'; };
    window.confirm = (msg) => { window.__prompts.push('CONFIRM: ' + msg); return true; };
  });
  await page.evaluate((f) => acqEnterTerm(f, 'security_deposit'), FAM);
  await page.waitForTimeout(1200);
  prompts.push(...await page.evaluate(() => window.__prompts));
  check('the person is told before typing that no document establishes it and the value will be theirs',
        /No document on file establishes this term/.test(prompts[0]) && /entered by a person/.test(prompts[0]), (prompts[0] || '').slice(0, 120));
  check('and asked to confirm with the full provenance sentence',
        /Verified · Entered by a person · No document on file supports this value\./.test(prompts[1] || ''), (prompts[1] || '').slice(0, 140));
  const decs = await page.evaluate(() => JSON.parse(JSON.stringify(__store.acquisition_term_decisions)));
  const entry = decs[decs.length - 1];
  check('one decision was written: a correction with NO source document, quote or page',
        decs.length === decBefore + 1 && entry.action === 'correct' && entry.new_value === '25000'
        && entry.source_document_id === null && entry.source_quote === null && entry.source_page === null
        && entry.family_id === FAM && entry.review_id === MAPLE, JSON.stringify(entry));
  check('with the note saying so', /Entered by a person\. No document on file supports it\./.test(entry.note), entry.note);
  check('the database refused nothing', (await page.evaluate(() => window.__dbRefusals.length)) === 0);
  const dep1 = await termRow('security_deposit');
  check('Lease Terms: the term is now Verified, marked entered, with the whole sentence',
        dep1 && dep1.state === 'verified' && dep1.origin === 'entered' && /\$25,000/.test(dep1.text)
        && /Entered by a person · No document on file supports this value/.test(dep1.text), dep1 && dep1.text.slice(0, 160));
  check('and offers Reopen only', dep1 && JSON.stringify(dep1.buttons) === JSON.stringify(['Reopen']), dep1 && JSON.stringify(dep1.buttons));
  const rr3 = await rentRoll();
  check('Rent Roll: the deposit is $25,000, tagged Entered',
        /\$25,000/.test(shopRow(rr3).deposit) && /Entered/.test(shopRow(rr3).deposit) && shopRow(rr3).entered.includes(6), shopRow(rr3).deposit);
  const st3 = await stored(MAPLE);
  check('the stored analysis carries the value AND its origin',
        st3.analysis.tenantSummary[0].security_deposit === 25000 && st3.analysis.tenantSummary[0]._origins.security_deposit === 'entered'
        && st3.analysis.tenantSummary[0]._states.security_deposit === 'verified');

  // Report v2
  await page.click('#acqReportV2Btn');
  await page.waitForTimeout(900);
  const v2 = await page.evaluate(() => {
    const root = document.querySelector('#rptBody [data-report="acquisition-v2"]');
    if (!root) return null;
    const row = (k) => { const r = root.querySelector(`.acqr-leasehold .acqr-fact[data-key="${k}"]`); return r ? {
      state: r.getAttribute('data-state'), origin: r.getAttribute('data-origin'), text: r.innerText.replace(/\s+/g, ' ').trim(),
      evidence: !!r.querySelector('.acqr-evidence'), competing: r.querySelectorAll('.acqr-competing-item').length,
      chip: [].map.call(r.querySelectorAll('.acqr-state .acqr-chip, .acqr-state .acqr-origin'), e => e.textContent.trim()) } : null; };
    return { deposit: row('security_deposit'), sqft: row('leased_sqft'), cap: row('cap'),
             legend: (root.querySelector('.acqr-legend') || {}).innerText || '',
             counts: (root.querySelector('.acqr-counts') || {}).innerText || '' };
  });
  check('Report v2: the deposit is Verified with the entered tag, and no Source block',
        v2 && v2.deposit && v2.deposit.state === 'verified' && v2.deposit.origin === 'entered' && !v2.deposit.evidence
        && JSON.stringify(v2.deposit.chip) === JSON.stringify(['Verified', 'Entered by a person · No document on file supports this value'])
        && /\$25,000/.test(v2.deposit.text), v2 && v2.deposit && JSON.stringify(v2.deposit.chip));
  check('Report v2: the corrected sqft is Verified from its document, with a Source block and no entered tag',
        v2 && v2.sqft && v2.sqft.state === 'verified' && !v2.sqft.origin && v2.sqft.evidence && /67,000/.test(v2.sqft.text), v2 && v2.sqft && v2.sqft.text.slice(0, 100));
  check('Report v2: the legend explains the entered mark', v2 && /Entered by a person/.test(v2.legend));
  check('opening the report called no AI', claude.length === 0);

  // ── 5 · the contradiction stays contested everywhere ────────────────────
  check('Report v2: the 4% vs 3% cap is still an Issue with both sides', v2 && v2.cap && v2.cap.state === 'issue' && v2.cap.competing === 2, v2 && v2.cap && v2.cap.state);
  await page.evaluate(() => { if (typeof closeReport === 'function') closeReport(); });
  const capTerm = await termRow('cap');
  check('Lease Terms: the cap is Conflicting', capTerm && capTerm.state === 'conflicting');
  check('the canonical row carries NO value for the cap — neither figure was chosen',
        st3.analysis.tenantSummary[0]._states.cap === 'conflicting'
        && (await page.evaluate((m) => { const c = _acqCanonicalRows(m); return c.rows[0].cap === null && c.rows[0].cam_cap === null; }, MAPLE)));

  // ── 4 · the CSV ──────────────────────────────────────────────────────────
  await page.evaluate(() => {
    window.__csv = null;
    URL.createObjectURL = (blob) => { window.__csv = blob; return 'blob:test'; };
    URL.revokeObjectURL = () => {};
    HTMLAnchorElement.prototype.click = function () {};
  });
  await page.evaluate(() => acqExportRentRollCsv());
  const csv = await page.evaluate(async () => window.__csv ? await window.__csv.text() : null);
  const csvLines = (csv || '').split('\n');
  const labels = await page.evaluate(() => ({ cap: AcquisitionTerms.FIELD_META.cap.label, dep: AcquisitionTerms.FIELD_META.security_deposit.label,
                                             suite: AcquisitionTerms.FIELD_META.suite.label }));
  check('CSV: the header carries Basis, Entered by a person and Contested',
        csvLines[0] === 'Tenant,Suite,Sq Ft,Lease Start,Lease End,Base Rent/yr,Renewal Options,Security Deposit,CAM Structure,Basis,Entered by a person,Contested', csvLines[0]);
  const shop = csvLines.find(l => /^"?ShopRite/.test(l)) || '';
  check('CSV: the ShopRite row has the resolved 67000 and the entered 25000',
        /,67000,/.test(shop) && /,25000,/.test(shop) && !/65000/.test(shop), shop);
  check('CSV: the contested suite is the word Contested, not either value',
        /^"ShopRite Supermarkets, Inc\.",Contested,67000,/.test(shop) && !/A-1|A-3/.test(shop), shop);
  const tail = shop.split(',').slice(-3);
  check('CSV: the row says it is a leasehold, names the entered field and the contested ones',
        tail[0] === 'Leasehold' && tail[1] === labels.dep
        && JSON.stringify(tail[2].split('; ').sort()) === JSON.stringify([labels.cap, labels.suite].sort()), shop);
  const myst = csvLines.find(l => /^Mystery/.test(l)) || '';
  check('CSV: the unfiled row says it is not in a leasehold and not verified, with no entered or contested fields',
        /Not in a leasehold — not verified,,$/.test(myst) && /,1200,/.test(myst), myst);

  // ── 6 · conversion ───────────────────────────────────────────────────────
  const rawBefore = JSON.stringify((await stored(MAPLE)).tenants);
  await page.evaluate(() => { window.alert = () => {}; window.confirm = () => true; });
  await page.evaluate(() => convertAcquisitionToProperty());
  await page.waitForTimeout(1500);
  const conv = await page.evaluate((m) => {
    const rv = __store.acquisition_reviews.find(x => x.id === m);
    const pid = rv.data.conversionRecord && rv.data.conversionRecord.propertyId;
    const prop = (typeof _props !== 'undefined' ? _props : []).find(p => p && p.id === pid);
    const rpc = (window.__rpc || []).filter(r => r.fn === 'resync_property_tenants');
    return JSON.parse(JSON.stringify({ pid, status: rv.status, tenants: prop ? prop.tenants : null,
      rpcRows: rpc.length ? rpc[rpc.length - 1].args.p_rows : null }));
  }, MAPLE);
  check('the review converted', conv.status === 'converted' && !!conv.pid, JSON.stringify({ status: conv.status, pid: conv.pid }));
  check('the property has ONE tenant per leasehold plus the unfiled row — two, not three',
        Array.isArray(conv.tenants) && conv.tenants.length === 2, conv.tenants && conv.tenants.length);
  const shopT = conv.tenants && conv.tenants.find(t => /ShopRite/.test(t.tenant_name));
  const mystT = conv.tenants && conv.tenants.find(t => /Mystery/.test(t.tenant_name));
  check('the ShopRite tenant carries the resolved values and is keyed on the leasehold',
        shopT && shopT.leased_sqft === 67000 && shopT.security_deposit === 25000 && shopT.id === FAM
        && shopT._source === 'leasehold' && shopT.start_date === '2024-03-01' && shopT.end_date === '2034-02-28', JSON.stringify(shopT));
  check('its entered origin travels with it, and the contested cap is null', shopT && shopT._origins && shopT._origins.security_deposit === 'entered' && shopT.cap === null);
  check('the unfiled tenant is marked as not in a leasehold, not verified',
        mystT && mystT._source === 'unfiled' && mystT._unverified === true && mystT.leased_sqft === 1200, JSON.stringify(mystT));
  check('the tenants table was given the same two rows, with the resolved area',
        Array.isArray(conv.rpcRows) && conv.rpcRows.length === 2 && conv.rpcRows.some(r => r.id === FAM && r.sqft === 67000),
        JSON.stringify(conv.rpcRows));
  check('the review keeps its raw upload rows, byte for byte', JSON.stringify((await stored(MAPLE)).tenants) === rawBefore);

  // ── 7 · Lake View: raw rows, no documents, no leasehold ──────────────────
  await page.evaluate((id) => selectAcquisitionReview(id), LAKE);
  await page.waitForTimeout(1200);
  check('Lake View: the Analyze control is enabled from its raw rows',
        await page.evaluate(() => !document.getElementById('acqAnalyzeBtn').disabled));
  await page.evaluate(() => runAcquisitionAnalysis());
  await page.waitForTimeout(1200);
  const lake = await rentRoll();
  check('Lake View: both rows are drawn, each marked not in a leasehold · not verified',
        lake.rows.length === 2 && lake.rows.every(r => r.source === 'unfiled' && r.unfiled && /not verified/.test(r.name)),
        JSON.stringify(lake.rows.map(r => r.name)));
  check('Lake View: no cell reads verified, entered, contested or established',
        lake.rows.every(r => r.entered.length === 0 && r.contested.length === 0 && r.missing.length === 0));
  check('Lake View: the values the files gave are still shown, as what the file said',
        lake.rows.some(r => /Lake Pharmacy/.test(r.name) && /3,000/.test(r.sqft)) && lake.rows.some(r => /Lake Diner/.test(r.name) && /2,500/.test(r.sqft)));
  check('Lake View: the line says 0 leaseholds, 2 rows not in a leasehold',
        lake.line && lake.line.leaseholds === '0' && lake.line.unfiled === '2', lake.line && lake.line.text);
  const stL = await stored(LAKE);
  check('Lake View: the stored rows say unfiled, with no states',
        stL.analysis.tenantSummary.every(t => t._source === 'unfiled' && t._unverified === true && Object.keys(t._states).length === 0));
  check('Lake View: no stale notice — nothing about it has changed', lake.stale.every(s => !s.shown));
  const noFam = await page.evaluate(() => document.getElementById('acqTermsList').innerText);
  check('Lake View: the Lease Terms panel still says no leasehold has been identified', /No leasehold has been identified yet/.test(noFam));

  // ── boundaries ───────────────────────────────────────────────────────────
  check('no page errors during the walk', errs.length === 0, errs.join(' | '));
  const apiFiles = fs.readdirSync(path.join(ROOT, 'api')).filter(f => f.endsWith('.js') && !f.startsWith('_'));
  check('no new serverless function — api/ still holds twelve', apiFiles.length === 12, String(apiFiles.length));
  check('no new migration', !fs.readdirSync(path.join(ROOT, 'migrations')).some(f => /^028_/.test(f)));

  await browser.close();
  srv.close();
  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) { console.log('\nFAILED:'); failed.forEach(f => console.log('  ✗ ' + f.name + (f.detail ? '  — ' + f.detail : ''))); }
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
