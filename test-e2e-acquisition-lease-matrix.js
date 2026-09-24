// test-e2e-acquisition-lease-matrix.js
// ============================================================================
// Acquisition Review §4m — Lease Matrix → Leasehold Detail, walked in the page
// with Maple Plaza as the Pilot holds it (fixtures/maple-plaza-acquisition.js).
//
//   1  the review opens on the Lease Matrix: one row per canonical leasehold,
//      no evidence drawn, the unfiled files listed apart
//   2  ShopRite's row: 67,000 · $1,251,250 · 2039-02-28 · NNN · 3% cap ·
//      2 issues — and Luxe Nails': 3,000 · — · — · 5% cap · Missing terms
//   3  clicking ShopRite opens ShopRite's record: back, name, headline,
//      "2 items need attention", then its Lease Terms evidence and no other
//   4  the 67,000 correction still reads Verified — 67,000, with the document
//      that said 65,000 and the person's correction; source, confidence and
//      Reopen intact
//   5  the evidence controls still act, and the record stays open on ShopRite
//   6  an attention item takes the person to its term
//   7  Back returns to the same matrix, focused on the row that was opened
//   8  Luxe Nails opens Luxe Nails — no ShopRite value anywhere in its record
//   9  the keyboard opens a row; another review lands on its own matrix and
//      Maple lands back on its matrix, not on a stale record
//  10  the phone: the matrix is one card per leasehold, no sideways scroll
//
// The stand-in database is the one test-e2e-acquisition-canonical.js uses
// (migration 026's rules included), copied verbatim.
//
// Run: node test-e2e-acquisition-lease-matrix.js
// ============================================================================
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
let pw; try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }

const F = require('./fixtures/maple-plaza-acquisition.js');
const ROOT = __dirname, PORT = 8945;
const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css',
               '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg',
               '.svg':'image/svg+xml', '.pdf':'application/pdf', '.txt':'text/plain' };

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail || '' });
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (detail ? '  — ' + detail : ''));
}

const UID = F.UID;
const MAPLE = F.REVIEW;
const OTHER = 'fffffff1-0000-4000-b000-00000000c4a9';
const SHOP = F.FAM.shoprite, LUXE = F.FAM.luxe;

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

  async function open(viewport, mobile) {
    const ctx = await browser.newContext({ viewport, isMobile: !!mobile, hasTouch: !!mobile });
    const page = await ctx.newPage();
    page.on('pageerror', e => errs.push(String(e.message).split('\n')[0]));
    page.on('dialog', d => d.dismiss().catch(() => {}));
    for (const g of ['**cdnjs**', '**jsdelivr**']) await page.route(g, r => r.fulfill({ status: 200, body: '/*x*/' }));
    await page.route('**fonts.g**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await page.route('**/api/claude', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
    await page.addInitScript(DB);
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2400);
    await page.evaluate(() => {
      const w = document.getElementById('obWelcomeModal');
      if (w && w.style.display !== 'none') { if (typeof obCloseWelcome === 'function') obCloseWelcome('skip'); else w.style.display = 'none'; }
    });
    await page.evaluate(async ({ maple, other, fx }) => {
      __store.acquisition_reviews.push({ id: maple, user_id: 'u1', name: 'Maple Plaza', status: 'complete',
        created_at: '2026-09-17T19:14:41Z', updated_at: 'rev-0',
        data: { tenants: fx.tenants, invoices: [], totalSqFt: 0, documents: [], analysis: null } });
      __store.acquisition_reviews.push({ id: other, user_id: 'u1', name: 'Oak Commons', status: 'draft',
        created_at: '2026-09-18T10:00:00Z', updated_at: 'rev-0',
        data: { tenants: [], invoices: [], totalSqFt: 0, documents: [], analysis: null } });
      fx.families.forEach(f => __store.acquisition_document_families.push(f));
      fx.documents.forEach(d => __store.acquisition_documents.push(d));
      fx.decisions.forEach(d => __store.acquisition_term_decisions.push(d));
      await _loadAcqReviewsAndRender();
      selectAcquisitionReview(maple);
    }, { maple: MAPLE, other: OTHER, fx: F });
    await page.waitForSelector(`#acqTermsList .acq-lm-row[data-leasehold="${SHOP}"]`, { timeout: 15000 });
    return { ctx, page };
  }

  const { ctx, page } = await open({ width: 1280, height: 1000 }, false);

  // ── readers ──────────────────────────────────────────────────────────────
  const matrix = () => page.evaluate(() => {
    const el = document.getElementById('acqTermsList');
    const rows = [].map.call(el.querySelectorAll('.acq-lm-row'), r => ({
      id: r.getAttribute('data-leasehold'),
      cells: [].map.call(r.querySelectorAll('td'), td => td.innerText.replace(/\s+/g, ' ').trim()),
      states: [].map.call(r.querySelectorAll('td .acq-lm-v'), v => v.getAttribute('data-state')),
      status: (r.querySelector('.acq-lm-status') || {}).innerText || '',
    }));
    return {
      rows, groups: el.querySelectorAll('.acq-term-group').length,
      unfiled: el.querySelectorAll('.acq-lm-unfiled li').length,
      unfiledText: ((el.querySelector('.acq-lm-unfiled summary') || {}).innerText || ''),
      back: !!el.querySelector('.acq-lh-back'),
      count: (document.getElementById('acqTermsCount') || {}).innerText || '',
      heading: (document.querySelector('#acqTermsCard h3') || {}).innerText || '',
      v2: !!document.querySelector('#acqTermsCard #acqReportV2Btn'),
    };
  });
  const record = () => page.evaluate(() => {
    const el = document.getElementById('acqTermsList');
    const lh = el.querySelector('.acq-lh');
    return {
      open: !!lh, leasehold: lh ? lh.getAttribute('data-leasehold') : null,
      back: !!el.querySelector('.acq-lh-back'),
      title: ((el.querySelector('.acq-lh-title') || {}).innerText || '').trim(),
      headline: ((el.querySelector('.acq-lh-headline') || {}).innerText || '').trim(),
      attnHead: ((el.querySelector('.acq-lh-attn-head') || {}).innerText || '').trim(),
      attn: [].map.call(el.querySelectorAll('.acq-lh-attn-item'), b => b.innerText.trim()),
      groups: [].map.call(el.querySelectorAll('.acq-term-group'), g => g.getAttribute('data-family')),
      rows: el.querySelectorAll('.acq-term-row').length,
      matrixRows: el.querySelectorAll('.acq-lm-row').length,
      text: el.innerText.replace(/\s+/g, ' '),
    };
  });
  const termRow = (field) => page.evaluate((field) => {
    const r = document.querySelector(`#acqTermsList .acq-term-row[data-field="${field}"]`);
    if (!r) return null;
    const q = (s) => ((r.querySelector(s) || {}).innerText || '').replace(/\s+/g, ' ').trim();
    return { state: r.getAttribute('data-state'), origin: r.getAttribute('data-origin'),
             label: q('.acq-term-label'), chip: q('.acq-term-state'), value: q('.acq-term-value'),
             src: q('.acq-term-src'), quote: q('.acq-term-quote'), decided: q('.acq-term-decided'),
             conflict: q('.acq-term-conflict'), missing: q('.acq-term-missing'),
             buttons: [].map.call(r.querySelectorAll('.acq-term-actions button'), b => b.textContent.trim() + (b.disabled ? '(off)' : '')) };
  }, field);

  console.log('\nAcquisition Review — Lease Matrix → Leasehold Detail (§4m), Maple Plaza\n' + '='.repeat(64));

  // ── 1 · the matrix is the entry point ────────────────────────────────────
  const m0 = await matrix();
  const canonCount = await page.evaluate((id) => _acqCanonicalRows(id).leaseholds, MAPLE);
  check('the review opens on the Lease Matrix, with the summary and Report v2 above it',
        /Lease Matrix/.test(m0.heading) && m0.v2 && m0.count === '4 leaseholds · 1 with issues · 2 with missing terms · 1 with unclear terms',
        `${m0.heading} | ${m0.count}`);
  check('the header counts leaseholds, not every possible term — no "of 108 verified"', !/of \d+ verified/.test(m0.count), m0.count);
  check('one row per canonical leasehold — four, ShopRite\'s two files as one',
        m0.rows.length === 4 && canonCount === 4 && m0.rows.filter(r => /ShopRite/.test(r.cells[0])).length === 1,
        m0.rows.map(r => r.cells[0]).join(' | '));
  check('no evidence is drawn on the matrix, and there is no Back', m0.groups === 0 && !m0.back);
  check('the six files not in a leasehold are listed apart, as unverified — with no row to open',
        m0.unfiled === 6 && /not in a leasehold/.test(m0.unfiledText) && /not verified/.test(m0.unfiledText), m0.unfiledText);

  // ── 2 · the rows ─────────────────────────────────────────────────────────
  const shopRow = m0.rows.find(r => r.id === SHOP), luxeRow = m0.rows.find(r => r.id === LUXE);
  check('ShopRite: 67,000 ✓ · $1,251,250 ✓ · 2039-02-28 · NNN · 3% cap · 2 issues',
        shopRow && shopRow.cells[0] === 'ShopRite Supermarkets, Inc.' && shopRow.cells[1] === '67,000✓'
        && shopRow.cells[2] === '$1,251,250✓' && shopRow.cells[3] === '2039-02-28'
        && shopRow.cells[4] === 'NNN · 3% cap' && /^2 issues$/i.test(shopRow.status),   // the chip is upper-cased by CSS
        shopRow && shopRow.cells.join(' | '));
  check('ShopRite\'s 67,000 is the VERIFIED canonical value, not the file\'s 65,000',
        shopRow && shopRow.states[0] === 'verified' && !/65,000/.test(shopRow.cells.join(' ')));
  check('Luxe Nails: 3,000 · — · — · 5% cap · Missing terms',
        luxeRow && luxeRow.cells[1] === '3,000' && luxeRow.cells[2] === '—' && luxeRow.cells[3] === '—'
        && luxeRow.cells[4] === '5% cap' && /missing terms/i.test(luxeRow.status), luxeRow && luxeRow.cells.join(' | '));
  check('Luxe Nails\' base rent is "not established", not blank or zero',
        luxeRow && luxeRow.states[1] === 'missing' && !/\$0\b/.test(luxeRow.cells[2]));

  // ── 3 · click ShopRite ───────────────────────────────────────────────────
  await page.click(`#acqTermsList .acq-lm-row[data-leasehold="${SHOP}"]`);
  await page.waitForSelector(`#acqTermsList .acq-term-group[data-family="${SHOP}"]`, { timeout: 10000 });
  const r1 = await record();
  check('ShopRite opens ShopRite\'s record: Back, the name, and no matrix',
        r1.open && r1.leasehold === SHOP && r1.back && r1.title === 'ShopRite Supermarkets, Inc.' && r1.matrixRows === 0, r1.title);
  check('the headline: 67,000 SF · NNN · $1,251,250 base rent', r1.headline === '67,000 SF · NNN · $1,251,250 base rent', r1.headline);
  check('"2 items need attention": Commencement contested, Renewal options contested',
        r1.attnHead === '2 items need attention' && r1.attn.length === 2
        && r1.attn.includes('Commencement — contested') && r1.attn.includes('Renewal options — contested'), r1.attn.join(' | '));
  check('then its Lease Terms evidence — ShopRite\'s group only, all 27 terms',
        r1.groups.length === 1 && r1.groups[0] === SHOP && r1.rows === 27, `${r1.groups.join(',')} / ${r1.rows}`);
  const focusBack = await page.evaluate(() => document.activeElement && document.activeElement.classList.contains('acq-lh-back'));
  check('focus moves to Back, so the keyboard lands in the record', focusBack);

  // ── 3b · the record, in layers and in review order ─────────────────────
  const lay = await page.evaluate(() => {
    const el = document.getElementById('acqTermsList');
    const q = (s) => ((el.querySelector(s) || {}).innerText || '').replace(/\s+/g, ' ').trim();
    const pos = (s) => { const n = el.querySelector(s); if (!n) return -1;
      return [].indexOf.call(el.querySelectorAll('[data-section], .acq-term-group'), n); };
    return {
      order: ['[data-section="overview"]', '[data-section="attention"]', '[data-section="terms"]',
              '[data-section="documents"]', '[data-section="evidence"]', '.acq-term-group'].map(pos),
      facts: [].map.call(el.querySelectorAll('.acq-lh-fact'), f => f.getAttribute('data-field') + '=' + f.querySelector('dd').innerText.trim()),
      tgroups: [].map.call(el.querySelectorAll('.acq-lh-tgroup'), g => g.querySelector('.acq-lh-tgroup-head').textContent.trim() + ':'
        + [].map.call(g.querySelectorAll('.acq-lh-term'), t => t.getAttribute('data-field')).join(',')),
      evidence: [].map.call(el.querySelectorAll('.acq-term-group .acq-term-row'), r => r.getAttribute('data-field')),
      docs: [].map.call(el.querySelectorAll('.acq-lh-doc'), d => ({ name: d.querySelector('.acq-lh-doc-name').innerText,
        meta: d.querySelector('.acq-lh-doc-meta').innerText, open: !!d.querySelector('.acq-doc-open') })),
      termsSub: q('.acq-lh-terms-sub'),
      compactStart: (el.querySelector('.acq-lh-term[data-field="start_date"]') || {}).innerText || '',
    };
  });
  check('the record is layered: Lease overview → Needs attention → Lease terms → Documents → Evidence & decisions',
        lay.order.every((p, i) => p >= 0 && (i === 0 || p > lay.order[i - 1])), JSON.stringify(lay.order));
  check('Lease overview carries the canonical values: 67,000 ✓, Commencement contested, $1,251,250 ✓, no deposit',
        lay.facts.includes('leased_sqft=67,000✓') && lay.facts.includes('start_date=Contested')
        && lay.facts.includes('base_rent=$1,251,250✓') && lay.facts.includes('security_deposit=—'), lay.facts.join(' | '));
  check('Needs attention lists them in review order: Commencement, then Renewal options',
        r1.attn.join(' | ') === 'Commencement — contested | Renewal options — contested', r1.attn.join(' | '));
  check('Lease terms, in review order: Tenant → Suite → Leased SF → Commencement → Expiration → Lease type → Base rent → CAM cap → Security deposit → Renewal → CAM details → obligations',
        lay.tgroups[0] === 'Premises & term:tenant_name,suite,leased_sqft,start_date,end_date,lease_type'
        && lay.tgroups[1] === 'Rent & CAM cap:base_rent,cap'
        && lay.tgroups[2] === 'Security & renewal:security_deposit,renewal_options'
        && /^CAM details:cap_base_amount,/.test(lay.tgroups[3]) && /^Obligations & special terms:/.test(lay.tgroups[4]),
        lay.tgroups.map(g => g.split(':')[0]).join(' → '));
  check('the term counts live in the record, not the matrix header', /^4 of 27 terms verified · 2 contested/.test(lay.termsSub), lay.termsSub);
  check('the evidence follows the same order, all 27 terms once',
        lay.evidence.slice(0, 8).join(',') === 'tenant_name,suite,leased_sqft,start_date,end_date,lease_type,base_rent,cap'
        && lay.evidence.length === 27 && new Set(lay.evidence).size === 27, lay.evidence.slice(0, 8).join(','));
  check('Documents: the two files behind ShopRite, each with its type and an opener',
        lay.docs.length === 2 && lay.docs.map(d => d.name).sort().join(',') === 'Maple_Plaza_Test_Lease_Amendment.pdf,ShopRite_Anchor_Tenant_Lease.pdf'
        && lay.docs.every(d => d.open) && lay.docs.some(d => /Amendment · 2027-01-01/.test(d.meta)), JSON.stringify(lay.docs.map(d => d.meta)));

  // ── 3b' · Core lease terms shown; Other lease terms folded, not gone ────
  const tierState = () => page.evaluate(() => {
    const el = document.getElementById('acqTermsList');
    const vis = (n) => !!(n && n.checkVisibility({ contentVisibilityAuto: true }) && n.getClientRects().length);
    const core = el.querySelector('.acq-lh-tier[data-tier="core"]');
    const other = el.querySelector('details.acq-lh-other');
    const txt = (n) => ((n && n.innerText) || '').replace(/\s+/g, ' ').trim();
    return {
      coreHead: txt(core && core.querySelector('.acq-lh-tier-head')),
      coreVisible: core ? [].filter.call(core.querySelectorAll('.acq-lh-term'), vis).map(b => b.getAttribute('data-field')) : [],
      otherHead: txt(other && other.querySelector('summary')),
      otherOpen: !!(other && other.open),
      otherFields: other ? [].map.call(other.querySelectorAll('.acq-lh-term'), b => b.getAttribute('data-field')) : [],
      otherVisible: other ? [].filter.call(other.querySelectorAll('.acq-lh-term'), vis).length : -1,
      allTerms: el.querySelectorAll('[data-section="terms"] .acq-lh-term').length,
      coreBeforeOther: !!(core && other && (core.compareDocumentPosition(other) & Node.DOCUMENT_POSITION_FOLLOWING)),
    };
  });
  const tr0 = await tierState();
  check('Core lease terms come first and are shown: the 10 core terms, with their counts on the heading',
        tr0.coreBeforeOther && tr0.coreVisible.join(',') === 'tenant_name,suite,leased_sqft,start_date,end_date,lease_type,base_rent,cap,security_deposit,renewal_options'
        && tr0.coreHead === 'Core lease terms 10 terms · 4 verified · 2 contested · 3 not yet verified · 1 not established', tr0.coreHead);
  check('Other lease terms are folded — with what is in them on the fold — and nothing in them is contested',
        !tr0.otherOpen && tr0.otherVisible === 0 && tr0.otherFields.length === 17
        && tr0.otherHead === 'Other lease terms 17 terms · 1 unclear · 8 not yet verified · 8 not established', JSON.stringify([tr0.otherOpen, tr0.otherVisible, tr0.otherFields.length, tr0.otherHead]));
  check('all 27 terms are on the page, each once', tr0.allTerms === 27, String(tr0.allTerms));
  await page.click('#acqTermsList details.acq-lh-other > summary');
  const tr1 = await tierState();
  check('one click unfolds the Other lease terms: all 17 visible, CAM details first', tr1.otherOpen && tr1.otherVisible === 17 && tr1.otherFields[0] === 'cap_base_amount',
        `${tr1.otherOpen} ${tr1.otherVisible}`);
  await page.click('#acqTermsList .acq-lh-term[data-field="admin_fee_pct"]');
  check('an Other term still opens its evidence, with its controls', await page.evaluate(() => {
    const r = document.querySelector('#acqTermsList .acq-term-row[data-field="admin_fee_pct"]');
    return r.classList.contains('acq-term-flash') && !!r.querySelector('.acq-term-actions button'); }));

  // ── 3c · a contested term does not pick a side ───────────────────────────
  const ct = await page.evaluate(() => {
    const r = document.querySelector('#acqTermsList .acq-term-row[data-field="start_date"]');
    const main = r.querySelector('.acq-term-main');
    return {
      chip: r.querySelector('.acq-term-state').innerText.trim(),
      first: (main.querySelector('.acq-term-contested') || {}).innerText || '',
      headThenContested: main.children[0].classList.contains('acq-term-head') && main.children[1].classList.contains('acq-term-contested'),
      value: !!r.querySelector('.acq-term-value'),
      directSrc: main.querySelectorAll(':scope > .acq-term-src, :scope > .acq-term-quote, :scope > .acq-term-superseded').length,
      readings: [].map.call(r.querySelectorAll('.acq-term-reading'), li => li.innerText.replace(/\s+/g, ' ').trim()),
      confirmTitle: (r.querySelector('.acq-term-confirm') || {}).title || '',
    };
  });
  check('Commencement: CONTESTED first — the chip, then the sentence, before anything else',
        /^contested$/i.test(ct.chip) && ct.headThenContested && /^Contested — the documents disagree\. Nothing has been chosen\./.test(ct.first), `${ct.chip} | ${ct.first}`);
  check('no single value is presented as the answer — no value line, no lone source, clause or "Replaced"',
        !ct.value && ct.directSrc === 0);
  check('each document\'s own reading is listed: 2027-01-01 from the amendment, 2024-03-01 from the renewal, with page and confidence',
        ct.readings.length === 2 && /2027-01-01 Maple_Plaza_Test_Lease_Amendment\.pdf · Amendment · p\.1 · confidence 0\.97/.test(ct.readings[0])
        && /2024-03-01 ShopRite_Anchor_Tenant_Lease\.pdf · Renewal · p\.2 · confidence 0\.99/.test(ct.readings[1]), ct.readings.join(' || ').slice(0, 200));
  check('Confirm on a contested term says whose reading it would record — the choice is the person\'s',
        /^Confirm records 2027-01-01 from Maple_Plaza_Test_Lease_Amendment\.pdf as the answer/.test(ct.confirmTitle), ct.confirmTitle);
  check('the compact term reads Contested too', /Contested/.test(lay.compactStart) && !/2027|2024/.test(lay.compactStart), lay.compactStart);
  await page.click('#acqTermsList .acq-lh-term[data-field="base_rent"]');
  check('a compact term opens its evidence below', await page.evaluate(() =>
    document.querySelector('#acqTermsList .acq-term-row[data-field="base_rent"]').classList.contains('acq-term-flash')));


  // ── 4 · the evidence, intact ─────────────────────────────────────────────
  const sq = await termRow('leased_sqft');
  check('Verified — 67,000', sq && sq.state === 'verified' && /verified/i.test(sq.chip) && sq.value === '67,000', sq && `${sq.chip} / ${sq.value}`);
  check('the document behind it, and what it said: 65,000 — with its confidence',
        sq && /Maple_Plaza_Test_Lease_Amendment\.pdf/.test(sq.src) && /confidence 0\.99/.test(sq.src) && /65,000 rentable square feet/.test(sq.quote),
        sq && `${sq.src} | ${sq.quote.slice(0, 60)}`);
  check('the person\'s correction is on the row, and it can be reopened',
        sq && /Corrected by a person/.test(sq.decided) && sq.buttons.includes('Reopen') && !sq.origin, sq && `${sq.decided} | ${sq.buttons.join(',')}`);
  const st = await termRow('start_date');
  check('Commencement: contested, both values and both documents named, nothing chosen',
        st && st.state === 'conflicting' && /2024-03-01/.test(st.conflict) && /2027-01-01/.test(st.conflict) && /Nothing has been chosen/.test(st.conflict),
        st && st.conflict.slice(0, 100));
  const dep = await termRow('security_deposit');
  check('Security deposit (entered, then reopened): missing, and it offers Enter',
        dep && dep.state === 'missing' && /No document on file establishes this/.test(dep.missing) && dep.buttons.join(',') === 'Enter', dep && dep.buttons.join(','));
  const au = await termRow('audit_rights');
  check('Audit rights: Unclear, with the person\'s rejection on the row', au && au.state === 'unclear' && /rejected/.test(au.decided), au && au.decided);
  const bc = await termRow('base_rent');
  check('Base rent: Verified — $1,251,250, from the amendment, p.1', bc && bc.state === 'verified' && bc.value === '$1,251,250' && /p\.1/.test(bc.src), bc && bc.src);
  check('Base rent, chosen by a person after the documents disagreed: Verified — Confirmed by a person, and never "Nothing has been chosen"',
        bc && /verified/i.test(bc.chip) && /Confirmed by a person/.test(bc.decided)
        && /^Documents previously contained conflicting values: .+\. This value was selected by a person\.$/.test(bc.conflict)
        && !/Nothing has been chosen/.test(bc.conflict), bc && bc.conflict);
  const cp = await termRow('cap');
  check('CAM cap reads the same way, and both competing values stay on the row as history',
        cp && cp.state === 'verified' && /This value was selected by a person\./.test(cp.conflict) && !/Nothing has been chosen/.test(cp.conflict)
        && / vs /.test(cp.conflict), cp && cp.conflict);

  // ── 5 · the controls still act, and the record stays ShopRite's ─────────
  const before = await page.evaluate(() => __store.acquisition_term_decisions.length);
  await page.click('#acqTermsList .acq-term-row[data-field="end_date"] .acq-term-confirm');
  await page.waitForFunction(() => { const r = document.querySelector('#acqTermsList .acq-term-row[data-field="end_date"]');
    return r && r.getAttribute('data-state') === 'verified'; }, null, { timeout: 10000 });
  const after = await page.evaluate(() => __store.acquisition_term_decisions.slice(-1)[0]);
  const r2 = await record();
  check('Confirm on Expiration is filed — one decision, by the owner, citing the document',
        (await page.evaluate(() => __store.acquisition_term_decisions.length)) === before + 1
        && after.field_key === 'end_date' && after.action === 'confirm' && after.family_id === SHOP && after.source_document_id === '3fc9463f-230e-424c-8bba-7dfacafd6a98',
        `${after.field_key} ${after.action}`);
  check('after the act the record is still ShopRite\'s, and still one group', r2.leasehold === SHOP && r2.groups.length === 1 && r2.groups[0] === SHOP);
  check('the Other lease terms a person unfolded stay unfolded after the re-render', (await tierState()).otherOpen);
  await page.click('#acqTermsList .acq-term-row[data-field="end_date"] .acq-term-reopen');
  await page.waitForFunction(() => { const r = document.querySelector('#acqTermsList .acq-term-row[data-field="end_date"]');
    return r && r.getAttribute('data-state') !== 'verified'; }, null, { timeout: 10000 });
  const eReopen = await termRow('end_date');
  check('Reopen puts it back where the documents leave it', eReopen && eReopen.state === 'ai_extracted', eReopen && eReopen.state);

  // ── 6 · an attention item goes to its term ───────────────────────────────
  await page.click('#acqTermsList .acq-lh-attn-item[data-field="renewal_options"]');
  const flashed = await page.evaluate(() => {
    const r = document.querySelector('#acqTermsList .acq-term-row[data-field="renewal_options"]');
    return r && r.classList.contains('acq-term-flash');
  });
  check('"Renewal options — contested" takes the person to that term, and marks it', flashed);

  // ── 7 · Back ─────────────────────────────────────────────────────────────
  await page.click('#acqTermsList .acq-lh-back');
  await page.waitForSelector('#acqTermsList .acq-lm-row', { timeout: 10000 });
  const m1 = await matrix();
  const focused = await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-leasehold'));
  check('Back returns to the same Lease Matrix — four rows, no evidence, no Back',
        m1.rows.length === 4 && m1.groups === 0 && !m1.back && JSON.stringify(m1.rows.map(r => r.id)) === JSON.stringify(m0.rows.map(r => r.id)));
  check('focused on the row that was opened', focused === SHOP, String(focused));
  check('the matrix still says 67,000, verified', m1.rows.find(r => r.id === SHOP).cells[1] === '67,000✓');

  // ── 8 · Luxe Nails is Luxe Nails ─────────────────────────────────────────
  await page.click(`#acqTermsList .acq-lm-row[data-leasehold="${LUXE}"]`);
  await page.waitForSelector(`#acqTermsList .acq-term-group[data-family="${LUXE}"]`, { timeout: 10000 });
  const r3 = await record();
  check('Luxe Nails opens Luxe Nails\' record', r3.leasehold === LUXE && r3.title === 'Luxe Nails' && r3.groups.length === 1 && r3.groups[0] === LUXE, r3.title);
  check('its headline says what is not established', r3.headline === '3,000 SF · Lease type not established · Base rent not established', r3.headline);
  check('"3 items need attention": base rent, expiration, lease type',
        r3.attnHead === '3 items need attention' && r3.attn.join(' | ') === 'Base rent — not established | Expiration — not established | Lease type — not established',
        r3.attn.join(' | '));
  check('nothing of ShopRite\'s is anywhere in it — no name, no 67,000, no $1,251,250, no amendment',
        !/ShopRite|67,000|1,251,250|Maple_Plaza_Test_Lease_Amendment|Commencement — contested|Renewal options — contested/i.test(r3.text), r3.text.slice(0, 120));
  const lsq = await termRow('leased_sqft');
  check('its leased area is its own: 3,000, read by AI from Luxe_Nails_Lease.pdf',
        lsq && lsq.value === '3,000' && lsq.state === 'ai_extracted' && /Luxe_Nails_Lease\.pdf/.test(lsq.src), lsq && `${lsq.value} / ${lsq.src}`);

  // ── 9 · keyboard; another review; back to Maple ──────────────────────────
  await page.click('#acqTermsList .acq-lh-back');
  await page.waitForSelector('#acqTermsList .acq-lm-row', { timeout: 10000 });
  await page.focus(`#acqTermsList .acq-lm-row[data-leasehold="${SHOP}"]`);
  await page.keyboard.press('Enter');
  await page.waitForSelector(`#acqTermsList .acq-term-group[data-family="${SHOP}"]`, { timeout: 10000 });
  check('Enter on a focused row opens it', (await record()).leasehold === SHOP);
  await page.evaluate((id) => selectAcquisitionReview(id), OTHER);
  await page.waitForTimeout(900);
  const o = await record();
  check('another review opens on its own matrix — no ShopRite record carried across',
        !o.open && o.groups.length === 0 && !/ShopRite/.test(o.text) && /No leasehold has been identified yet/.test(o.text), o.text.slice(0, 80));
  await page.evaluate((id) => selectAcquisitionReview(id), MAPLE);
  await page.waitForSelector(`#acqTermsList .acq-lm-row[data-leasehold="${SHOP}"]`, { timeout: 10000 });
  const m2 = await matrix();
  check('back on Maple Plaza: its matrix, not the record left open before', m2.rows.length === 4 && m2.groups === 0 && !m2.back);
  const canon = await page.evaluate((id) => _acqCanonicalRows(id).rows[0], MAPLE);
  check('the canonical projection is unchanged: 67,000, verified', canon.leased_sqft === 67000 && canon._states.leased_sqft === 'verified');
  const raw = await page.evaluate((id) => __store.acquisition_reviews.find(r => r.id === id).data.tenants.filter(t => /ShopRite/.test(t.tenant_name)).map(t => t.leased_sqft), MAPLE);
  check('the raw upload rows are untouched: 65,000, 65,000', JSON.stringify(raw) === '[65000,65000]', JSON.stringify(raw));

  // ── 10 · the phone ───────────────────────────────────────────────────────
  {
    const { ctx: c2, page: p2 } = await open({ width: 375, height: 740 }, true);
    const ph = await p2.evaluate(() => {
      const t = document.querySelector('#acqTermsList .acq-lm-table');
      const row = document.querySelector('#acqTermsList .acq-lm-row');
      return { overflow: document.documentElement.scrollWidth - window.innerWidth,
               tableW: t ? Math.round(t.getBoundingClientRect().width) : null,
               rowDisplay: row ? getComputedStyle(row).display : null,
               labels: row ? [].map.call(row.querySelectorAll('td'), td => getComputedStyle(td, '::before').content).slice(1, 3) : [] };
    });
    check('on a phone the matrix is a card per leasehold, labelled, with no sideways scroll',
          ph.rowDisplay === 'block' && ph.overflow <= 1 && ph.tableW <= 375 && /Leased SF/.test(ph.labels[0] || ''),
          JSON.stringify(ph));
    await p2.click(`#acqTermsList .acq-lm-row[data-leasehold="${SHOP}"]`);
    await p2.waitForSelector(`#acqTermsList .acq-term-group[data-family="${SHOP}"]`, { timeout: 10000 });
    const pr = await p2.evaluate(() => ({ title: document.querySelector('#acqTermsList .acq-lh-title').innerText,
      overflow: document.documentElement.scrollWidth - window.innerWidth }));
    check('and a tap opens the record, still without sideways scroll', /ShopRite/.test(pr.title) && pr.overflow <= 1, JSON.stringify(pr));
    await c2.close();
  }

  // ── boundaries ───────────────────────────────────────────────────────────
  check('no page errors during the walk', errs.length === 0, errs.join(' | '));
  const apiFiles = fs.readdirSync(path.join(ROOT, 'api')).filter(f => f.endsWith('.js') && !f.startsWith('_'));
  check('no new serverless function — api/ still holds twelve', apiFiles.length === 12, String(apiFiles.length));

  await ctx.close(); await browser.close(); srv.close();
  const failed = results.filter(r => !r.ok);
  console.log('\n' + '─'.repeat(64));
  console.log(`${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(2); });
