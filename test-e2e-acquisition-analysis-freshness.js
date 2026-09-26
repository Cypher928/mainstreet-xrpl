// test-e2e-acquisition-analysis-freshness.js
// ============================================================================
// Acquisition Review §4o — an analysis is current only for the inputs it was
// run with, and a report printed from it cannot outlive it.
//
// Walked in the page with Maple Plaza as the Pilot holds it (fixtures/maple-
// plaza-acquisition.js), ShopRite's leased area corrected to 65,000 sf by a
// person as on the Pilot, so the four leaseholds lease 75,500 sf:
//
//   A  Total Property SqFt 30,000: occupancy 251.7% — shown as computed, never
//      clamped, and flagged "Occupancy exceeds 100% — verify property and
//      lease SF." on Risk Analysis, Rent Roll and the Decision Report
//   B  changing Total Property SqFt to 75,500 makes that analysis stale — the
//      workspace, the Decision Report and every consumer say so
//   C  rerunning gives 100%, and the flag is gone
//   D  the Decision Report asked for after the rerun shows 100%, not 251.7%
//   E  neither a report left open during the rerun nor a closed one can be
//      printed: the rerun retires it, closing empties it, and print shows
//      only an open report
//   F  changing the invoices makes the analysis stale too; putting them back
//      makes it current again
//   G  Option B holds: four leaseholds, never the unmatched extractions; the
//      acquisition gate unchanged
//
// Run: node test-e2e-acquisition-analysis-freshness.js
// ============================================================================
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
let pw; try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }

const F = require('./fixtures/maple-plaza-acquisition.js');
const ROOT = __dirname, PORT = 8949;
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
        // The invoice and building area are TEST values (the Pilot review has
        // neither), so the engine's recovery, occupancy and rollover run.
        data: { tenants: fx.tenants, invoices: [{ id: 'inv-test-1', vendorName: 'Test Landscaping (test data)', amount: 24000, category: 'landscaping' }],
                totalSqFt: 100000, documents: [], analysis: null } });
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

  const { page } = await open({ width: 1280, height: 1000 }, false);
  await page.waitForFunction((m) => _acqRecordLoaded(m), MAPLE, { timeout: 15000 });
  await page.evaluate(() => { window.__toasts = []; const t = window.showToast; window.showToast = (m, o) => { window.__toasts.push(String(m)); try { t(m, o); } catch (_) {} }; });

  console.log('\nAcquisition Review §4o — analysis freshness, the report overlay, occupancy over 100%\n' + '='.repeat(72));

  // As on the Pilot: a person corrects ShopRite's leased area to 65,000 sf.
  await page.evaluate(async (fam) => { window.prompt = () => '65000'; await acqCorrectTerm(fam, 'leased_sqft'); }, SHOP);
  await page.waitForTimeout(400);
  const leased = await page.evaluate((m) => _acqAnalysisRows(_acqLeaseholdsOnly(_acqCanonicalRows(m)))
    .map(t => AcquisitionEngine.normalizeAcqTenant(t).leased_sqft), MAPLE);
  check('the four leaseholds lease 75,500 sf, as on the Pilot (65,000 + 3,000 + 3,000 + 4,500)',
        leased.length === 4 && leased.reduce((s, v) => s + (v || 0), 0) === 75500, JSON.stringify(leased));

  const setSqFt = (v) => page.evaluate((v) => { const el = document.getElementById('acqTotalSqft'); el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); }, v);
  const run = () => page.evaluate(() => runAcquisitionAnalysis()).then(() => page.waitForTimeout(500));
  const state = () => page.evaluate((m) => {
    const rv = _acqReviews.find(r => r.id === m);
    const a = rv.data.analysis || {};
    const v = _acqReviewsForConsumers().find(r => r.id === m);
    const ai = AIWorkspace.answer({ question: 'how is the acquisition recovery looking', context: null, wctx: null, props: _props, acqReviews: _acqReviewsForConsumers() });
    const vis = (sel) => [].map.call(document.querySelectorAll(sel), e => (e.offsetParent !== null || getComputedStyle(e).display !== 'none') ? e.textContent.replace(/\s+/g, ' ').trim() : '').filter(Boolean);
    return { occ: (a.rentRoll || {}).occupancy || null, tenants: (a.tenantSummary || []).map(t => t.tenant_name),
             basis: a.canonical && a.canonical.basis, stale: _acqAnalysisStale(rv), consumer: v.analysisState, reason: v.analysisStaleReason,
             ai: (ai.paragraphs || []).find(p => /Maple Plaza/.test(p)) || '',
             notice: [].map.call(document.querySelectorAll('#acqReportContainer .acq-analysis-stale'), e => e.style.display !== 'none' ? e.textContent.replace(/\s+/g, ' ').trim() : '').filter(Boolean),
             riskFlag: vis('#acqTabRisk .acq-occ-check'), rrFlag: [].map.call(document.querySelectorAll('#acqReportContainer .acq-occ-check'), e => e.textContent.replace(/\s+/g, ' ').trim()),
             rrKpi: ((document.querySelector('#acqReportContainer .acq-kpi-row .acq-kpi-val.verify') || {}).textContent || '').trim() };
  }, MAPLE);
  const report = () => page.evaluate(() => {
    const ov = document.getElementById('reportOverlay');
    return { open: getComputedStyle(ov).display !== 'none', title: document.getElementById('rptToolbarTitle').textContent,
             text: (document.getElementById('rptBody').textContent || '').replace(/\s+/g, ' ') };
  });
  // What a browser print puts on paper, under print media: whether the report
  // is actually RENDERED (has boxes — a display:block overlay inside a hidden
  // parent has none, which is how the old rule printed an open report blank),
  // its rendered text, and whether any of the page outside it renders.
  const printed = async () => {
    await page.emulateMedia({ media: 'print' });
    const out = await page.evaluate(() => {
      const ov = document.getElementById('reportOverlay'), body = document.getElementById('rptBody');
      const rendered = !!(body && body.getClientRects().length && ov.getClientRects().length);
      const pageShown = [].filter.call(document.querySelectorAll('body *'), e => !ov.contains(e) && !e.contains(ov)
        && e.tagName !== 'SCRIPT' && e.getClientRects().length > 0 && (e.textContent || '').trim()).length;
      return { overlayShown: rendered, overlayText: rendered ? body.innerText.replace(/\s+/g, ' ') : '', pageShown };
    });
    await page.emulateMedia({ media: 'screen' });
    return out;
  };

  // ── A · 30,000 sf ────────────────────────────────────────────────────────
  await setSqFt(30000);
  await run();
  const a = await state();
  check('A · 30,000 sf property, 75,500 sf leased: occupancy is 251.7% — as computed, not clamped',
        a.occ && a.occ.occupancyRate === 251.7 && a.occ.buildingSqft === 30000 && a.occ.occupiedSqft === 75500, JSON.stringify(a.occ));
  check('A · the analysis is current for those inputs', a.stale === '' && a.consumer === 'current', JSON.stringify([a.stale, a.consumer]));
  check('A · Risk Analysis flags it for verification, with the arithmetic',
        a.riskFlag.length === 1 && a.riskFlag[0] === '⚠️ Occupancy exceeds 100% — verify property and lease SF. 75,500 sf leased ÷ 30,000 sf property = 251.7%', JSON.stringify(a.riskFlag));
  await page.evaluate(() => switchAcqTab('rentroll'));
  const aRR = await state();
  check('A · Rent Roll shows 251.7% (marked for checking, not green) and the same flag',
        aRR.rrKpi === '251.7%' && aRR.rrFlag.some(t => /Occupancy exceeds 100% — verify property and lease SF\. 75,500 sf leased ÷ 30,000 sf property = 251\.7%/.test(t)), JSON.stringify([aRR.rrKpi, aRR.rrFlag]));
  await page.evaluate(() => switchAcqTab('risk'));

  // The Decision Report from the 30,000 sf analysis — and it is left OPEN.
  await page.evaluate(() => generateAcquisitionReport());
  const r1 = await report();
  check('A · the Decision Report shows 251.7% with the verification flag',
        r1.open && /^Acquisition Decision Report — Maple Plaza$/.test(r1.title) && /251\.7%Occupancy/.test(r1.text)
        && /Occupancy exceeds 100% — verify property and lease SF\. 75,500 sf leased ÷ 30,000 sf property = 251\.7%/.test(r1.text), r1.text.slice(0, 120));
  const p1 = await printed();
  check('A · printing an open report prints the report, and only the report', p1.overlayShown && /251\.7%/.test(p1.overlayText) && p1.pageShown === 0, JSON.stringify([p1.overlayShown, p1.pageShown]));

  // ── B · the area changes: the analysis is stale ─────────────────────────
  await setSqFt(75500);
  const b = await state();
  check('B · Total Property SqFt 30,000 → 75,500 makes the stored analysis stale, saying which input moved',
        b.stale === 'Total Property SqFt has changed since this analysis was run (30,000 sf → 75,500 sf).', b.stale);
  check('B · the workspace says so above the figures, at once', b.notice.length > 0 && b.notice.every(t => /Total Property SqFt has changed since this analysis was run \(30,000 sf → 75,500 sf\)/.test(t)), JSON.stringify(b.notice));
  check('B · every consumer is told it is stale, and why — Ask AI uses no figure from it',
        b.consumer === 'stale' && b.reason === 'Total Property SqFt has changed since it was run (30,000 sf → 75,500 sf)'
        && /the analysis on file is not used — Total Property SqFt has changed since it was run/.test(b.ai) && !/251\.7/.test(b.ai), b.ai);
  check('B · the stored analysis is untouched until a rerun — still 251.7%', b.occ.occupancyRate === 251.7);

  // ── C, D, E · rerun while the old report is still open ──────────────────
  await run();
  const e1 = await report();
  check('E · the rerun retired the open Decision Report — closed and emptied', !e1.open && e1.text.trim() === '' && e1.title === 'Report', JSON.stringify(e1).slice(0, 120));
  const p2 = await printed();
  check('E · print now cannot resurrect it: no report on paper, no 251.7% anywhere', !p2.overlayShown && !/251\.7/.test(p2.overlayText) && p2.pageShown > 0, JSON.stringify([p2.overlayShown, p2.pageShown]));
  const c = await state();
  check('C · rerun: occupancy 100% (75,500 of 75,500 sf), current, and no flag',
        c.occ.occupancyRate === 100 && c.occ.buildingSqft === 75500 && c.stale === '' && c.consumer === 'current' && c.riskFlag.length === 0 && c.notice.length === 0,
        JSON.stringify([c.occ, c.stale, c.riskFlag]));
  await page.evaluate(() => generateAcquisitionReport());
  const d1 = await report();
  check('D · the Decision Report asked for after the rerun shows 100% — not 251.7%, no flag',
        d1.open && /100%Occupancy/.test(d1.text) && !/251\.7/.test(d1.text) && !/Occupancy exceeds 100%/.test(d1.text), d1.text.slice(0, 120));
  const p3 = await printed();
  check('D · and printing it prints 100%', p3.overlayShown && /100%\s*Occupancy/i.test(p3.overlayText) && !/251\.7/.test(p3.overlayText));

  // E, the other way: the report is closed first, the analysis rerun later.
  await page.click('#reportOverlay .rpt-close-btn');
  const e2 = await report();
  check('E · closing a report empties it', !e2.open && e2.text.trim() === '');
  const p4 = await printed();
  check('E · a closed report is never printed — the page prints instead', !p4.overlayShown && p4.pageShown > 0, JSON.stringify(p4).slice(0, 100));

  // ── F · the invoices change ─────────────────────────────────────────────
  const inv = (fn) => page.evaluate(({ m, fn }) => { const rv = _acqReviews.find(r => r.id === m); rv.data.invoices = (new Function('x', 'return ' + fn))(rv.data.invoices); _acqUpdateStaleNotice(); }, { m: MAPLE, fn });
  const orig = await page.evaluate((m) => JSON.parse(JSON.stringify(_acqReviews.find(r => r.id === m).data.invoices)), MAPLE);
  await inv('x.map(i => Object.assign({}, i, { amount: i.amount + 1000 }))');
  const f1 = await state();
  check('F · an invoice amount changes: the analysis is stale — "The invoices have changed since this analysis was run."',
        f1.stale === 'The invoices have changed since this analysis was run.' && f1.consumer === 'stale' && f1.reason === 'the invoices have changed since it was run', JSON.stringify([f1.stale, f1.reason]));
  await inv(JSON.stringify(orig));
  check('F · the same invoices back: current again (the check compares, it does not just count edits)', (await state()).stale === '');
  await inv('x.concat([{ id: "inv-test-2", vendorName: "Test Snow Removal (test data)", amount: 5000, category: "snow_removal" }])');
  const f2 = await state();
  check('F · an invoice added: stale', f2.stale === 'The invoices have changed since this analysis was run.' && f2.consumer === 'stale');
  await page.evaluate(() => { window.__toasts = []; generateAcquisitionReport(); });
  const f3 = await page.evaluate(() => ({ toasts: window.__toasts.slice(), open: getComputedStyle(document.getElementById('reportOverlay')).display !== 'none' }));
  check('F · and the Decision Report refuses it until refreshed', !f3.open && f3.toasts.some(t => /^The invoices have changed since this analysis was run\. Refresh the analysis before generating the Decision Report/.test(t)), JSON.stringify(f3.toasts));
  await page.evaluate(() => acqRefreshAnalysisFromTerms());
  await page.waitForTimeout(500);
  check('F · refreshed: current again', (await state()).stale === '');

  // An analysis saved before §4o records neither input: it says which area it
  // used (every rent roll does), not which invoices — so it is not trusted.
  await page.evaluate((m) => { const rv = _acqReviews.find(r => r.id === m); delete rv.data.analysis.canonical.sqft; delete rv.data.analysis.canonical.invoices; _acqUpdateStaleNotice(); }, MAPLE);
  const g0 = await state();
  check('an analysis from before §4o is stale: it does not record which invoices it used (its area is still read from its rent roll)',
        g0.stale === 'This analysis does not record which invoices it used.' && g0.consumer === 'stale', g0.stale);
  await page.evaluate(() => acqRefreshAnalysisFromTerms());
  await page.waitForTimeout(500);

  // ── G · Option B is intact ──────────────────────────────────────────────
  const g = await state();
  check('G · the analysis is the four leaseholds only — never the unmatched extractions', g.basis === 'leaseholds' && g.tenants.length === 4
        && ['ShopRite Supermarkets, Inc.', 'Luxe Nails', 'Maple Coffee Co.', 'Prime Wellness Spa'].every(n => g.tenants.includes(n)), g.tenants.join(' | '));
  const gate = await page.evaluate((m) => ({ block: _acqConversionBlock(_acqReviews.find(r => r.id === m)), unresolved: _acqUnresolvedExtractions(m),
    raw: (_acqReviews.find(r => r.id === m).data.tenants || []).length }), MAPLE);
  check('G · the acquisition gate still names the unmatched extractions and the documents', gate.unresolved === 6
        && /^Before this property can be acquired, a person must resolve: 6 extracted entries not matched to a tenant/.test(gate.block) && /4 documents in Documents/.test(gate.block), gate.block.slice(0, 120));
  check('G · the raw extraction history is untouched — 13 rows', gate.raw === 13, String(gate.raw));
  // A leasehold change is still caught, and named on its own.
  await page.evaluate(async (fam) => { window.prompt = () => '66000'; await acqCorrectTerm(fam, 'leased_sqft'); }, SHOP);
  await page.waitForTimeout(500);
  const g2 = await page.evaluate((m) => { const rv = _acqReviews.find(r => r.id === m); return { occ: rv.data.analysis.rentRoll.occupancy, stale: _acqAnalysisStale(rv) }; }, MAPLE);
  check('G · a term a person corrects is still carried into the analysis (refreshed after the act): 76,500 of 75,500 sf, flagged',
        g2.stale === '' && g2.occ.occupiedSqft === 76500 && g2.occ.occupancyRate === 101.3, JSON.stringify(g2));

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
