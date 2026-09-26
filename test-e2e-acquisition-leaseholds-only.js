// test-e2e-acquisition-leaseholds-only.js
// ============================================================================
// Acquisition Review — Option B: only a canonical leasehold is a tenant.
// Walked in the page with Maple Plaza as the Pilot holds it
// (fixtures/maple-plaza-acquisition.js): 4 leaseholds, 13 raw extracted rows,
// 6 of them matched to no leasehold. Before Option B the analysis received all
// 10 rows (4 + 6) and the Rent Roll, Decision Report and conversion said 10.
//
//   1  the analysis stored before Option B (10 rows) reads as out of date, and
//      the Decision Report refuses to print it
//   2  refreshed: the engine received the 4 leaseholds — Risk Analysis, Rent
//      Roll, Decision Report and the stored analysis all say 4; duplicate
//      uploads made no duplicate tenant
//   3  occupancy, recovery and rollover are the 4 leaseholds' — computed here
//      the old way too, to show the 6 would have changed them
//   4  the review card says 4 leaseholds and 6 extracted entries not yet
//      matched — not 13 tenants
//   5  the 6 stay visible on MainStreet's Record with their sources; the
//      unmatched document stays in Documents; nothing is deleted
//   6  conversion is refused while any is unresolved — button and direct call
//   7  a person resolves them (match, new leasehold, not a tenant; one undone
//      and redone); the new leasehold makes the analysis out of date, which
//      blocks conversion and the report until refreshed
//   8  conversion then creates exactly one tenant per leasehold — never the
//      10-row roster — and the raw extraction history is untouched
//
// Run: node test-e2e-acquisition-leaseholds-only.js
// ============================================================================
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
let pw; try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }

const F = require('./fixtures/maple-plaza-acquisition.js');
const ROOT = __dirname, PORT = 8947;
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
  const LH = [F.FAM.shoprite, F.FAM.luxe, F.FAM.coffee, F.FAM.prime];
  const NAMES = ['ShopRite Supermarkets, Inc.', 'Luxe Nails', 'Maple Coffee Co.', 'Prime Wellness Spa'];
  await page.waitForFunction((m) => _acqRecordLoaded(m), MAPLE, { timeout: 15000 });
  await page.evaluate(() => { window.__toasts = []; const t = window.showToast; window.showToast = (m, o) => { window.__toasts.push(String(m)); try { t(m, o); } catch (_) {} };
                              window.__alerts = []; window.alert = (m) => window.__alerts.push(String(m)); });

  // What each consumer of a stored analysis says about Maple Plaza — through
  // the one view the page gives them all (_acqReviewsForConsumers).
  const consumers = () => page.evaluate((m) => {
    const view = _acqReviewsForConsumers();
    const v = view.find(r => r.id === m);
    const ai = AIWorkspace.answer({ question: 'how is the acquisition recovery looking', context: null, wctx: null, props: _props, acqReviews: view });
    const cc = CommandCenter.buildModel({ props: _props, acqReviews: view, userName: 'x' });
    const dr = DocumentDrafting.build('acquisitionSummary', { props: _props, context: { acqId: m }, acqReviews: view });
    const acts = AcquisitionEngine.computePortfolioActions(_props || [], view);
    const all = [].concat(acts.criticalActions, acts.warningActions, acts.infoActions).filter(a => a.reviewId === m);
    return { state: v.analysisState, reason: v.analysisStaleReason, hasData: 'data' in v, rate: v.analysis ? v.analysis.recoveryRate : null,
      ai: (ai.paragraphs || []).find(p => /Maple Plaza/.test(p)) || '',
      cc: (cc.recommendations || []).filter(r => String(r.id).indexOf(m) >= 0).map(r => r.id + ' | ' + r.title + ' | ' + r.reason),
      draft: ((dr && dr.sections) || []).map(x => x.body).join(' | '),
      action: all.map(a => a.title + ' | ' + a.detail) };
  }, MAPLE);

  console.log('\nAcquisition Review — Option B: only a leasehold is a tenant (Maple Plaza)\n' + '='.repeat(64));

  // ── 1 · the analysis stored before Option B ─────────────────────────────
  // Built exactly as the old code did: every canonical row, the 6 included.
  await page.evaluate(async (m) => {
    const rv = _acqReviews.find(r => r.id === m);
    const canon = _acqCanonicalRows(m);
    const rows = _acqAnalysisRows(canon.rows);
    const rpt = AcquisitionEngine.buildAcquisitionReport(rows, rv.data.invoices, rv.data.totalSqFt);
    _AL().attachStates(rpt.tenantSummary, rows);
    rpt.canonical = { leaseholds: canon.leaseholds, unfiled: canon.unfiled, dropped: canon.dropped.length,
                      resolverAvailable: true, fingerprint: _acqCanonicalFingerprint(rows), at: '2026-09-20T00:00:00Z' };
    rv.data.analysis = rpt;
    await _saveAcqReview(rv);
    selectAcquisitionReview(m);
  }, MAPLE);
  await page.waitForFunction((m) => _acqRecordLoaded(m), MAPLE, { timeout: 15000 });
  await page.waitForTimeout(500);
  const old = await page.evaluate(() => ({
    rows: document.querySelectorAll('#acqTabRisk .acq-risk-table tbody tr').length,
    stale: [].map.call(document.querySelectorAll('#acqReportContainer .acq-analysis-stale'), e => e.style.display !== 'none' ? e.innerText.replace(/\s+/g, ' ') : '').filter(Boolean) }));
  check('before: the stored analysis is the old one — 10 tenant rows (4 leaseholds + 6 unmatched)', old.rows === 10, String(old.rows));
  const oldRR = await page.evaluate(() => { switchAcqTab('rentroll');
    const marked = [].filter.call(document.querySelectorAll('#acqRentRollTbody tr .acq-ts-name'), td => /Not in a leasehold · not verified/.test(td.innerText)).length;
    switchAcqTab('risk'); return marked; });
  check('until it is refreshed, the old analysis\'s 6 unmatched rows are at least marked in the Rent Roll', oldRR === 6, String(oldRR));
  check('and it reads as out of date, saying why', old.stale.length > 0 && old.stale.every(t => /counted extracted entries not matched to a tenant as tenants/.test(t)), JSON.stringify(old.stale).slice(0, 160));
  await page.evaluate(() => { window.__toasts = []; generateAcquisitionReport(); });
  const rep0 = await page.evaluate(() => ({ opened: !!((document.getElementById('rptBody') || {}).innerText || '').trim()
      && getComputedStyle(document.getElementById('reportOverlay')).display !== 'none', toasts: window.__toasts.slice() }));
  check('the Decision Report refuses to print it — it says why, and prints nothing',
        !rep0.opened && rep0.toasts.some(t => /counted extracted entries not matched to a tenant as tenants\. Refresh the analysis before generating the Decision Report/.test(t)), JSON.stringify(rep0));

  const c1 = await consumers();
  check('consumers are given the review WITHOUT its stored analysis — marked stale, with the reason, and no raw data',
        c1.state === 'stale' && /counted extracted entries not matched to a tenant as tenants/.test(c1.reason) && c1.rate === null && !c1.hasData, JSON.stringify([c1.state, c1.reason]));
  check('Ask AI refuses the stale analysis and says to refresh — no figure from it',
        /Maple Plaza: the analysis on file is not used — it counted extracted entries not matched to a tenant as tenants\. Refresh it from MainStreet’s Record/.test(c1.ai)
        && !/101\.3|%/.test(c1.ai), c1.ai);
  check('the Command Center recommends refreshing it — not acting on it',
        c1.cc.length === 1 && /^acq-stale:/.test(c1.cc[0]) && /analysis out of date/.test(c1.cc[0]) && !/101\.3/.test(c1.cc[0]), JSON.stringify(c1.cc));
  check('drafting states no recovery figure and says why', /Not stated: the analysis on file is not used/.test(c1.draft) && !/101\.3/.test(c1.draft), c1.draft.slice(0, 160));
  check('the portfolio actions do not call it Ready to convert', c1.action.length === 1 && /— Not ready to convert/.test(c1.action[0]), JSON.stringify(c1.action));
  const glue = await page.evaluate(() => { const src = [aiwAsk, openDraftingStudio, renderCommandCenter, exportPortfolioSummary].map(f => String(f)).join('\n');
    return { consumers: (src.match(/_acqReviewsForConsumers\(\)/g) || []).length, raw: /acqReviews: _acqReviews\b/.test(src) }; });
  check('Ask AI, drafting, the Command Center and the portfolio export all read that view, never the stored reviews', glue.consumers >= 4 && !glue.raw, JSON.stringify(glue));

  // ── 2 · refreshed from the record ────────────────────────────────────────
  await page.evaluate(() => acqRefreshAnalysisFromTerms());
  await page.waitForTimeout(900);
  const a1 = await page.evaluate((m) => JSON.parse(JSON.stringify(__store.acquisition_reviews.find(r => r.id === m).data.analysis)), MAPLE);
  check('the engine received the 4 leaseholds — the stored analysis has 4 tenants, each a leasehold',
        a1.tenantSummary.length === 4 && a1.tenantSummary.every(t => t._source === 'leasehold')
        && JSON.stringify(a1.tenantSummary.map(t => t._leaseholdId).sort()) === JSON.stringify(LH.slice().sort()), a1.tenantSummary.map(t => t.tenant_name).join(' | '));
  check('it says what it counted: leaseholds only, and 6 unmatched beside them, not in it',
        a1.canonical.basis === 'leaseholds' && a1.canonical.leaseholds === 4 && a1.canonical.unmatched === 6, JSON.stringify(a1.canonical));
  check('duplicate uploads made no duplicate tenant — Luxe (2 raw rows) and Prime Wellness (4) appear once each',
        a1.tenantSummary.filter(t => /Luxe/.test(t.tenant_name)).length === 1 && a1.tenantSummary.filter(t => /Prime Wellness/.test(t.tenant_name)).length === 1
        && new Set(a1.tenantSummary.map(t => t.tenant_name)).size === 4);
  if (a1.summary && a1.summary.tenantCount != null) check('the analysis summary counts 4 tenants', a1.summary.tenantCount === 4, String(a1.summary.tenantCount));
  const tabs = await page.evaluate(() => {
    switchAcqTab('risk');
    const risk = [].map.call(document.querySelectorAll('#acqTabRisk .acq-risk-table tbody tr td:first-child'), td => td.innerText.trim());
    switchAcqTab('rentroll');
    const rr = [].map.call(document.querySelectorAll('#acqRentRollTbody tr .acq-ts-name'), td => td.innerText.trim());
    const line = ((document.querySelector('#acqTabRentRoll .acq-canonical-line') || {}).innerText || '').replace(/\s+/g, ' ').trim();
    const stale = [].some.call(document.querySelectorAll('#acqReportContainer .acq-analysis-stale'), e => e.style.display !== 'none');
    switchAcqTab('risk');
    return { risk, rr, line, stale };
  });
  check('Risk Analysis lists the 4 leaseholds — no unmatched extraction, no duplicate', tabs.risk.length === 4 && NAMES.every(n => tabs.risk.includes(n)), tabs.risk.join(' | '));
  check('Rent Roll lists the 4 leaseholds', tabs.rr.length === 4 && NAMES.every(n => tabs.rr.some(x => x.startsWith(n))) && !tabs.rr.some(x => /not verified/i.test(x)), tabs.rr.join(' | '));
  check('the Rent Roll says the 6 unmatched are not counted',
        /^4 leaseholds from the lease terms · 6 extracted entries not matched to a tenant — not counted/.test(tabs.line), tabs.line);
  check('the out-of-date notice is gone', !tabs.stale);
  await page.evaluate(() => { window.__toasts = []; generateAcquisitionReport(); });
  const rep1 = await page.evaluate(() => {
    const body = document.getElementById('rptBody');
    const titles = body ? [].slice.call(body.querySelectorAll('.rpt-section-title')) : [];
    const t = titles.find(x => /Tenant Roster/.test(x.textContent));
    // The report wraps each table in its own scroller.
    let tbl = t ? t.nextElementSibling : null;
    if (tbl && tbl.tagName !== 'TABLE') tbl = tbl.querySelector('table');
    const roster = tbl ? [].map.call(tbl.querySelectorAll('tbody tr td:first-child'), td => td.innerText.trim()) : [];
    const out = { roster, text: body ? body.innerText : '' };
    if (typeof closeReport === 'function') closeReport();
    return out;
  });
  check('the Decision Report prints the 4 leaseholds in its Tenant Roster — not 10', rep1.roster.length === 4 && NAMES.every(n => rep1.roster.includes(n)), rep1.roster.join(' | '));
  check('no unmatched extraction is anywhere in the Decision Report',
        !/Sunrise Cafe|SafeShield Security|SafeShield Insurance/.test(rep1.text), '');

  const c2 = await consumers();
  check('refreshed and current: consumers now get the leasehold-only figures — 77.5%',
        c2.state === 'current' && c2.rate === 77.5 && /Maple Plaza: CAM recovery 77\.5%/.test(c2.ai) && /77\.5%/.test(c2.draft) && !/101\.3/.test(c2.ai + c2.draft), c2.ai);
  check('and the Command Center no longer flags it as out of date', !c2.cc.some(x => /^acq-stale:/.test(x)), JSON.stringify(c2.cc));
  await page.evaluate((m) => { _acqFamilies.delete(m); }, MAPLE);
  const c3 = await consumers();
  check('an analysis that cannot be checked against the record (not loaded) is not used either',
        c3.state === 'unchecked' && c3.rate === null && /the analysis on file is not used — it has not yet been checked against MainStreet’s Record/.test(c3.ai), c3.ai);
  await page.evaluate((m) => _acqEnsureRecord(m), MAPLE);
  check('…and is used again once the record is loaded', (await consumers()).state === 'current');

  // ── 3 · occupancy, recovery and rollover are the leaseholds' ────────────
  const calc = await page.evaluate((m) => {
    const rv = _acqReviews.find(r => r.id === m);
    const canon = _acqCanonicalRows(m);
    const lhRows = _acqAnalysisRows(_acqLeaseholdsOnly(canon)), allRows = _acqAnalysisRows(canon.rows);
    const A = AcquisitionEngine.buildAcquisitionReport(lhRows, rv.data.invoices, rv.data.totalSqFt);
    const B = AcquisitionEngine.buildAcquisitionReport(allRows, rv.data.invoices, rv.data.totalSqFt);
    const pick = (r) => JSON.parse(JSON.stringify({ occ: r.rentRoll && r.rentRoll.occupancy, roll: r.rentRoll && r.rentRoll.rolloverRisk, summary: r.summary, rec: r.revenueRecovery }));
    return { lh: pick(A), all: pick(B), stored: pick(rv.data.analysis) };
  }, MAPLE);
  check('occupancy is the 4 leaseholds\' 77,500 sf of 100,000 — not the 101,300 sf the 6 would have added',
        calc.stored.occ.occupiedSqft === 77500 && calc.all.occ.occupiedSqft === 101300 && calc.stored.occ.occupancyRate === 77.5, JSON.stringify([calc.stored.occ.occupiedSqft, calc.all.occ.occupiedSqft]));
  check('recovery and the summary are exactly the leasehold-only figures', JSON.stringify(calc.stored.rec) === JSON.stringify(calc.lh.rec)
        && JSON.stringify(calc.stored.summary) === JSON.stringify(calc.lh.summary));
  check('…and they differ from what the 10 rows gave, so the 6 really are out', JSON.stringify(calc.lh.summary) !== JSON.stringify(calc.all.summary)
        || JSON.stringify(calc.lh.rec) !== JSON.stringify(calc.all.rec));
  const rollNames = JSON.stringify(calc.stored.roll || {});
  check('rollover counts only leaseholds — no unmatched name in any bucket', JSON.stringify(calc.stored.roll) === JSON.stringify(calc.lh.roll)
        && !/Sunrise|SafeShield/.test(rollNames), rollNames.slice(0, 120));

  // ── 4 · the review card ──────────────────────────────────────────────────
  const card = await page.evaluate(() => {
    const c = [].find.call(document.querySelectorAll('#acqReviewsGrid .acq-card'), x => /Maple Plaza/.test(x.innerText));
    return c ? { lh: (c.querySelector('[data-stat="leaseholds"]') || {}).innerText, um: (c.querySelector('[data-stat="unmatched"]') || {}).innerText,
                 text: c.innerText.replace(/\s+/g, ' ') } : null;
  });
  check('the review card says 4 leaseholds — not 13 tenants', card && /^4\s*Leaseholds$/.test((card.lh || '').trim()) && !/13|Tenants/.test(card.text), card && card.text);
  check('and, separately, 6 extracted entries not yet matched', card && /^6 extracted entries not yet matched$/.test((card.um || '').trim()), card && card.um);

  // ── 5 · the 6 stay visible, and nothing is deleted ───────────────────────
  const vis = await page.evaluate((m) => {
    const el = document.getElementById('acqTermsList');
    const d = el.querySelector('.acq-lm-unfiled');
    const items = d ? [].map.call(d.querySelectorAll('li.acq-um-open'), li => li.textContent.replace(/\s+/g, ' ').trim()) : [];
    return { summary: d ? d.querySelector('summary').innerText.trim() : '', items,
             matrixRows: el.querySelectorAll('.acq-lm-row').length,
             safeshieldDoc: [].some.call(document.querySelectorAll('#acqDocsList .acq-doc-group.needs-review .acq-doc-name'), n => /SafeShield_Insurance_Lease\.pdf/.test(n.innerText)),
             raw: __store.acquisition_reviews.find(r => r.id === m).data.tenants.length };
  }, MAPLE);
  check('MainStreet\'s Record still shows 4 leaseholds', vis.matrixRows === 4, String(vis.matrixRows));
  check('the 6 unmatched extractions stay visible on it, apart', vis.summary === '6 extracted entries are not matched to a tenant — as extracted from the file, not reviewed' && vis.items.length === 6, vis.summary);
  check('each names its source — "Sunrise Cafe & Bakery LLC · Source: maple-plaza-sunrise-cafe-lease.pdf"',
        vis.items.some(t => /^Sunrise Cafe & Bakery LLC\b.*Source: maple-plaza-sunrise-cafe-lease\.pdf/.test(t)), JSON.stringify(vis.items.slice(0, 2)));
  check('the unmatched document stays in Documents › Needs review', vis.safeshieldDoc);
  check('the raw extraction history is intact — 13 rows', vis.raw === 13);

  // ── 6 · conversion is refused while any is unresolved ────────────────────
  const g0 = await page.evaluate((m) => ({ block: _acqConversionBlock(_acqReviews.find(r => r.id === m)),
    disabled: !!(document.querySelector('#acqConvertAction .acq-convert-btn') || {}).disabled,
    note: ((document.getElementById('acqConvertBlocked') || {}).innerText || '').trim() }), MAPLE);
  check('the gate names what remains: 6 extracted entries AND 4 documents, each document with its reason — button disabled',
        /^Before this property can be acquired, a person must resolve: 6 extracted entries not matched to a tenant \(in MainStreet’s Record\); 4 documents in Documents — /.test(g0.block)
        && /SafeShield_Insurance_Lease\.pdf \(type not set; not matched to a tenant\)/.test(g0.block)
        && /ShopRite_Anchor_Tenant_Lease\.pdf \(filed into ShopRite Supermarkets, Inc\. by AI — not confirmed by a person\)/.test(g0.block)
        && /maple_plaza_messy_lease\.pdf \(filed into Maple Coffee Co\. by AI — not confirmed by a person\)/.test(g0.block)
        && /Prime_Wellness_Spa_Lease\.pdf \(filed into Prime Wellness Spa by AI — not confirmed by a person\)/.test(g0.block)
        && /MainStreet will not create tenants from unmatched document extractions/.test(g0.block)
        && g0.disabled && g0.note === g0.block, g0.block.slice(0, 200));
  check('the two replaced copies of Prime Wellness are not in it — already replaced by a newer upload of the same name', !/\b2 documents replaced|, Prime_Wellness_Spa_Lease\.pdf \(.*, Prime_Wellness_Spa_Lease\.pdf/.test(g0.block));
  await page.evaluate(() => { window.__alerts = []; _showAcqConvertModal(); });
  const modal = await page.evaluate(() => getComputedStyle(document.getElementById('acqConvertModal')).display);
  check('the confirmation cannot even be opened', modal === 'none', modal);
  await page.evaluate(() => convertAcquisitionToProperty());
  await page.waitForTimeout(500);
  const c0 = await page.evaluate((m) => ({ rec: !!__store.acquisition_reviews.find(r => r.id === m).data.conversionRecord,
    props: (__store.properties || []).length, alerts: window.__alerts.slice() }), MAPLE);
  check('calling the conversion directly is refused: no property, no conversion record',
        !c0.rec && c0.props === 0 && c0.alerts.some(a => /6 extracted entries not matched to a tenant/.test(a) && /4 documents in Documents/.test(a)), JSON.stringify(c0).slice(0, 200));

  // ── 7 · a person resolves them ───────────────────────────────────────────
  const key = (name, file) => page.evaluate(({ m, name, file }) => {
    const x = _acqUnmatched(m).find(e => (e.row.tenant_name === name) && (!file || e.row._fileName === file));
    return x ? x.key : null;
  }, { m: MAPLE, name, file });
  const openList = () => page.evaluate(() => { const d = document.querySelector('#acqTermsList .acq-lm-unfiled'); if (d) d.open = true; });
  const unresolved = () => page.evaluate((m) => _acqUnresolvedExtractions(m), MAPLE);
  // Match through the control a person uses.
  await openList();
  const kLuxe = await key('Luxe Nails', 'Luxe_Nails_Lease.pdf');
  await page.selectOption(`#acqTermsList .acq-um-match[data-row="${kLuxe}"]`, F.FAM.luxe);
  await page.waitForTimeout(500);
  check('matching the extra Luxe Nails row to the Luxe Nails leasehold resolves it', (await unresolved()) === 5, String(await unresolved()));
  await openList();
  const kPrime = await key('Prime Wellness Spa');
  await page.selectOption(`#acqTermsList .acq-um-match[data-row="${kPrime}"]`, F.FAM.prime);
  await page.waitForTimeout(500);
  await openList();
  const kCoffee = await key('Maple Coffee Co');
  await page.selectOption(`#acqTermsList .acq-um-match[data-row="${kCoffee}"]`, F.FAM.coffee);
  await page.waitForTimeout(500);
  await openList();
  const kSec = await key('SafeShield Security, LLC');
  await page.click(`#acqTermsList .acq-um-dismiss[data-row="${kSec}"]`);
  await page.waitForTimeout(500);
  await openList();
  const kIns = await key('SafeShield Insurance');
  const insCtl = await page.evaluate((k) => { const li = document.querySelector(`#acqTermsList li.acq-um-open[data-row="${k}"]`);
    return li ? { match: !!li.querySelector('.acq-um-match'), docs: !!li.querySelector('.acq-um-docs'), dismiss: !!li.querySelector('.acq-um-dismiss') } : null; }, kIns);
  check('an extraction whose document is on file is settled in Documents — no match control here, only Documents or Not a tenant',
        insCtl && !insCtl.match && insCtl.docs && insCtl.dismiss, JSON.stringify(insCtl));
  await page.click(`#acqTermsList .acq-um-dismiss[data-row="${kIns}"]`);
  await page.waitForTimeout(500);
  check('five resolved, one to go', (await unresolved()) === 1, String(await unresolved()));
  // Undo one, then redo it.
  await openList();
  await page.click(`#acqTermsList .acq-um-reopen[data-row="${kSec}"]`);
  await page.waitForTimeout(500);
  check('Undo puts an entry back — the gate counts it again', (await unresolved()) === 2
        && /2 extracted entries not matched to a tenant/.test(await page.evaluate((m) => _acqConversionBlock(_acqReviews.find(r => r.id === m)), MAPLE)));
  await openList();
  await page.click(`#acqTermsList .acq-um-dismiss[data-row="${kSec}"]`);
  await page.waitForTimeout(500);
  // Sunrise Cafe becomes a leasehold of its own.
  await openList();
  const kSun = await key('Sunrise Cafe & Bakery LLC');
  await page.click(`#acqTermsList .acq-um-new[data-row="${kSun}"]`);
  await page.waitForTimeout(800);
  const after = await page.evaluate((m) => {
    const rv = __store.acquisition_reviews.find(r => r.id === m);
    const res = rv.data.extractionResolutions || {};
    return { unresolved: _acqUnresolvedExtractions(m), families: __store.acquisition_document_families.filter(f => f.review_id === m).map(f => f.label),
             actions: Object.values(res).map(e => e.action).sort(), by: Object.values(res).every(e => e.by === 'u1' && e.at),
             raw: JSON.stringify(rv.data.tenants), rows: document.querySelectorAll('#acqTermsList .acq-lm-row').length,
             activity: (rv.data.activity || []).filter(a => /extraction_/.test(a.type)).map(a => a.type) };
  }, MAPLE);
  check('all six resolved: 3 matched, 2 not a tenant, 1 new leasehold — each by a named person, with a time',
        after.unresolved === 0 && JSON.stringify(after.actions) === JSON.stringify(['dismissed', 'dismissed', 'matched', 'matched', 'matched', 'new_leasehold']) && after.by,
        JSON.stringify(after.actions));
  check('the new leasehold is on MainStreet\'s Record — 5 leaseholds now', after.rows === 5 && after.families.includes('Sunrise Cafe & Bakery LLC'), after.families.join(' | '));
  check('every act is in the activity log, the undo included',
        after.activity.filter(t => t === 'extraction_resolved').length === 7 && after.activity.filter(t => t === 'extraction_reopened').length === 1, after.activity.join(','));
  check('the raw extraction history is still byte for byte the Pilot\'s', after.raw === JSON.stringify(F.tenants));
  const docState = () => page.evaluate((m) => {
    const rv = __store.acquisition_reviews.find(r => r.id === m);
    return { pending: _acqPendingDocuments(m).map(p => p.doc.file_name + ' (' + p.reasons.join('; ') + ')'),
             disp: rv.data.documentDispositions || {}, block: _acqConversionBlock(_acqReviews.find(r => r.id === m)),
             activity: (rv.data.activity || []).filter(a => /document_/.test(a.type)).map(a => a.type) };
  }, MAPLE);
  const SAFE_DOC = '440d3294-d97d-4248-ae6e-8af6facdd8d3';
  const d1 = await docState();
  check('marking SafeShield Insurance not a tenant disposed of its document too — in the same act',
        d1.disp[SAFE_DOC] && d1.disp[SAFE_DOC].action === 'not_relevant' && d1.disp[SAFE_DOC].linkedRow && !d1.pending.some(x => /SafeShield/.test(x)), JSON.stringify(d1.disp[SAFE_DOC]));
  check('with every extraction resolved, the gate still names the 3 documents the AI filed — not ready',
        d1.pending.length === 3 && /^Before this property can be acquired, a person must resolve: 3 documents in Documents — ShopRite_Anchor_Tenant_Lease\.pdf \(filed into ShopRite Supermarkets, Inc\. by AI/.test(d1.block), d1.block.slice(0, 180));
  // Undo the document's disposition in Documents: the extraction reopens with it.
  await page.click(`#acqDocsList .acq-doc-undispose[data-doc-id="${SAFE_DOC}"]`);
  await page.waitForTimeout(500);
  const d2 = await docState();
  check('Undo in Documents reopens the document AND its extraction',
        !d2.disp[SAFE_DOC] && d2.pending.some(x => /^SafeShield_Insurance_Lease\.pdf \(type not set; not matched to a tenant\)$/.test(x)) && (await unresolved()) === 1, JSON.stringify(d2.pending));
  const safeCtl = await page.evaluate((id) => { const row = document.querySelector(`#acqDocsList .acq-doc-row[data-doc-id="${id}"]`);
    const pl = row && row.querySelector('.acq-doc-place');
    return pl ? { why: pl.querySelector('.acq-doc-place-why').innerText, confirm: !!pl.querySelector('.acq-doc-confirm-family'),
                  match: pl.querySelector('.acq-doc-match') ? pl.querySelector('.acq-doc-match').options.length : 0,
                  dispose: [].map.call(pl.querySelectorAll('.acq-doc-dispose'), b => b.innerText.trim()) } : null; }, SAFE_DOC);
  check('the document says what it needs, with the choices: match to a leasehold, Not relevant, Duplicate — no AI filing to confirm',
        safeCtl && /Needs a person: type not set; not matched to a tenant/.test(safeCtl.why) && !safeCtl.confirm && safeCtl.match === 6
        && JSON.stringify(safeCtl.dispose) === JSON.stringify(['Not relevant', 'Duplicate']), JSON.stringify(safeCtl));
  await page.click(`#acqDocsList .acq-doc-dispose[data-doc-id="${SAFE_DOC}"][data-action="duplicate"]`);
  await page.waitForTimeout(500);
  const d3 = await docState();
  check('marking it a Duplicate in Documents resolves the document and its extraction together',
        d3.disp[SAFE_DOC] && d3.disp[SAFE_DOC].action === 'duplicate' && (await unresolved()) === 0 && d3.pending.length === 3
        && d3.activity.filter(t => t === 'document_disposed').length === 1 && d3.activity.filter(t => t === 'document_reopened').length === 1, JSON.stringify(d3.activity));
  // Match: a document no leasehold holds is filed into one a person picks. A
  // TEST document (not on the Pilot) with no terms read, so no term changes.
  const TEST_DOC = 'doc-test-luxe-addendum';
  await page.evaluate(async ({ m, id }) => {
    __store.acquisition_documents.push({ id, review_id: m, user_id: 'u1', intake_id: 'ik-test-1', file_name: 'Luxe_Nails_Addendum_TEST.pdf',
      intake_kind: 'lease', parsing_status: 'success', doc_type: 'amendment', doc_type_status: 'confirmed', family_id: null,
      family_status: 'unfiled', abstraction_status: 'pending', created_at: '2026-09-25T00:00:00Z' });
    await _acqLoadDocuments(m); _renderAcqDocuments();
  }, { m: MAPLE, id: TEST_DOC });
  check('a document in no leasehold is named by the gate', /Luxe_Nails_Addendum_TEST\.pdf \(not matched to a tenant\)/.test((await docState()).block));
  await page.selectOption(`#acqDocsList .acq-doc-match[data-doc-id="${TEST_DOC}"]`, F.FAM.luxe);
  await page.waitForTimeout(600);
  const tdoc = await page.evaluate((id) => JSON.parse(JSON.stringify(__store.acquisition_documents.find(d => d.id === id))), TEST_DOC);
  check('Match to a leasehold files it there, confirmed by the person who chose — not a guess',
        tdoc.family_id === F.FAM.luxe && tdoc.family_status === 'confirmed' && tdoc.family_source === 'human' && tdoc.confirmed_by === 'u1'
        && !(await docState()).pending.some(x => /Luxe_Nails_Addendum_TEST/.test(x)), JSON.stringify([tdoc.family_id, tdoc.family_status, tdoc.family_source]));
  // Confirm the three leaseholds the AI filed documents into.
  for (const fname of ['ShopRite_Anchor_Tenant_Lease.pdf', 'maple_plaza_messy_lease.pdf', 'Prime_Wellness_Spa_Lease.pdf']) {
    const id = await page.evaluate((f) => { const d = _acqDocRows(_activeAcqId).find(x => x.file_name === f && !x.superseded_by_document_id); return d && d.id; }, fname);
    await page.click(`#acqDocsList .acq-doc-confirm-family[data-doc-id="${id}"]`);
    await page.waitForTimeout(500);
  }
  const d4 = await docState();
  check('Confirm leasehold settles each AI filing — nothing left in Documents for a person', d4.pending.length === 0, JSON.stringify(d4.pending));
  const g1 = await page.evaluate((m) => _acqConversionBlock(_acqReviews.find(r => r.id === m)), MAPLE);
  check('a new leasehold makes the analysis out of date — conversion waits for a refresh', /lease terms have changed since this analysis was run\. Refresh the analysis/.test(g1), g1);
  const c4 = await consumers();
  check('…and the consumers stop using it again: stale, "MainStreet’s Record has changed since it was run"',
        c4.state === 'stale' && /MainStreet’s Record has changed since it was run/.test(c4.ai) && c4.rate === null, c4.ai);
  await page.evaluate(() => { window.__toasts = []; generateAcquisitionReport(); });
  check('…and so does the Decision Report', (await page.evaluate(() => window.__toasts.slice())).some(t => /lease terms have changed since this analysis was run/.test(t)));
  await page.evaluate(() => acqRefreshAnalysisFromTerms());
  await page.waitForTimeout(900);
  const a2 = await page.evaluate((m) => __store.acquisition_reviews.find(r => r.id === m).data.analysis.tenantSummary.map(t => t.tenant_name), MAPLE);
  check('refreshed: 5 tenants — the 4 leaseholds and Sunrise Cafe, nothing unmatched', a2.length === 5 && a2.includes('Sunrise Cafe & Bakery LLC'), a2.join(' | '));
  check('the gate is open', (await page.evaluate((m) => _acqConversionBlock(_acqReviews.find(r => r.id === m)), MAPLE)) === '');

  // ── 8 · conversion: one tenant per leasehold ─────────────────────────────
  const rawBefore = await page.evaluate((m) => JSON.stringify(__store.acquisition_reviews.find(r => r.id === m).data.tenants), MAPLE);
  await page.evaluate(() => { _props = []; _propsLoadedOk = true; _archivedProps = []; });
  await page.evaluate(() => convertAcquisitionToProperty());
  await page.waitForTimeout(1500);
  const conv = await page.evaluate((m) => {
    const rv = __store.acquisition_reviews.find(x => x.id === m);
    const pid = rv.data.conversionRecord && rv.data.conversionRecord.propertyId;
    const prop = (_props || []).find(p => p && p.id === pid);
    const rpc = (window.__rpc || []).filter(r => r.fn === 'resync_property_tenants');
    return JSON.parse(JSON.stringify({ status: rv.status, pid, tenants: prop ? prop.tenants.map(t => ({ id: t.id, name: t.tenant_name, source: t._source })) : null,
      rpc: rpc.length ? rpc[rpc.length - 1].args.p_rows.length : null, raw: JSON.stringify(rv.data.tenants),
      families: __store.acquisition_document_families.filter(f => f.review_id === m).map(f => f.id) }));
  }, MAPLE);
  check('the review converted', conv.status === 'converted' && !!conv.pid, conv.status);
  check('the property has exactly one tenant per leasehold — 5, never the 10-row roster',
        conv.tenants && conv.tenants.length === 5 && conv.tenants.every(t => t.source === 'leasehold')
        && JSON.stringify(conv.tenants.map(t => t.id).sort()) === JSON.stringify(conv.families.slice().sort()), JSON.stringify(conv.tenants));
  check('no tenant came from an unmatched extraction, and none is duplicated',
        !conv.tenants.some(t => /SafeShield/.test(t.name)) && new Set(conv.tenants.map(t => t.name)).size === 5);
  check('the tenants table was given the same 5 rows', conv.rpc === 5, String(conv.rpc));
  check('the raw extraction history survived the conversion untouched', conv.raw === rawBefore);

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
