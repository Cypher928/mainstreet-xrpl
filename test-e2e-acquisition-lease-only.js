// test-e2e-acquisition-lease-only.js
// ============================================================================
// Acquisition Review — seller invoices are optional.
//
// A buyer often has no seller CAM invoices (ACQUISITION_REVIEW.md, the P1-3
// finding). Before this change Run Analysis needed one, and Acquire Property
// appears only once an analysis has made the review `complete`, so a review
// without invoices could never be acquired. Walked in the page with Maple
// Plaza as the Pilot holds it (fixtures/maple-plaza-acquisition.js), and NO
// invoices:
//
//   A  leaseholds + Total SqFt + no invoices: Run Analysis is enabled and says
//      it runs a lease-only analysis; with no SqFt it is still off
//   B  the lease-only analysis is stored with its canonical block — basis,
//      fingerprint, area, invoice fingerprint and every leasehold's term
//      states — readable by the property after Acquire (PropertyLeaseholds)
//   C  the page says it is lease-only, shows the rent roll and occupancy, and
//      offers no Decision Report; the Decision Report refuses it
//   D  Acquire Property appears, DISABLED, naming the unmatched extractions and
//      the pending documents — the gate is unchanged
//   E  once a person resolves them (and the analysis is refreshed), Acquire
//      Property is enabled and the conversion request goes to the server
//      with one roster row per leasehold
//   F  adding an invoice makes the analysis stale and blocks Acquire again
//   G  re-running with the invoice restores the full CAM analysis and the
//      Decision Report
//
// Run: node test-e2e-acquisition-lease-only.js
// ============================================================================
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
let pw; try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }

const F = require('./fixtures/maple-plaza-acquisition.js');
const ROOT = __dirname, PORT = 8954;
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
const PID = 'fffffff2-0000-4000-b000-0000000077aa';   // the review's own prospect property (TEST id)

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
    await page.evaluate(async ({ maple, other, pid, fx }) => {
      // NO invoices: the buyer has none. The area is a TEST value.
      __store.acquisition_reviews.push({ id: maple, user_id: 'u1', name: 'Maple Plaza', status: 'draft', property_id: pid,
        created_at: '2026-09-17T19:14:41Z', updated_at: 'rev-0',
        data: { tenants: fx.tenants, invoices: [], totalSqFt: 80000, documents: [], analysis: null } });
      __store.acquisition_reviews.push({ id: other, user_id: 'u1', name: 'Oak Commons', status: 'draft',
        created_at: '2026-09-18T10:00:00Z', updated_at: 'rev-0',
        data: { tenants: [], invoices: [], totalSqFt: 0, documents: [], analysis: null } });
      fx.families.forEach(f => __store.acquisition_document_families.push(f));
      fx.documents.forEach(d => __store.acquisition_documents.push(d));
      fx.decisions.forEach(d => __store.acquisition_term_decisions.push(d));
      await _loadAcqReviewsAndRender();
      selectAcquisitionReview(maple);
    }, { maple: MAPLE, other: OTHER, pid: PID, fx: F });
    await page.waitForSelector(`#acqTermsList .acq-lm-row[data-leasehold="${SHOP}"]`, { timeout: 15000 });
    return { ctx, page };
  }

  const { page } = await open({ width: 1280, height: 1000 }, false);
  await page.waitForFunction((m) => _acqRecordLoaded(m), MAPLE, { timeout: 15000 });
  await page.evaluate(() => { window.__toasts = []; const t = window.showToast; window.showToast = (m, o) => { window.__toasts.push(String(m)); try { t(m, o); } catch (_) {} }; });

  console.log('\nAcquisition Review — seller invoices are optional (lease-only analysis)\n' + '='.repeat(72));

  const run = () => page.evaluate(() => runAcquisitionAnalysis()).then(() => page.waitForTimeout(600));
  const setSqFt = (v) => page.evaluate((v) => { const el = document.getElementById('acqTotalSqft'); el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); acqSaveSqft(String(v)); }, v);
  const btn = () => page.evaluate(() => { const b = document.getElementById('acqAnalyzeBtn'); return { disabled: b.disabled, note: document.getElementById('acqAnalyzeNote').textContent.trim() }; });
  const convert = () => page.evaluate(() => {
    const el = document.getElementById('acqConvertAction');
    const b = el && el.querySelector('.acq-convert-btn');
    return { shown: !!b, disabled: !!(b && b.disabled), label: b ? b.textContent.trim() : '',
             blocked: ((el && el.querySelector('.acq-convert-blocked')) || {}).textContent || '' };
  });
  const stored = () => page.evaluate((m) => JSON.parse(JSON.stringify(__store.acquisition_reviews.find(r => r.id === m))), MAPLE);
  const shownText = (sel) => page.evaluate((sel) => [].filter.call(document.querySelectorAll(sel), e => e.getClientRects().length).map(e => e.textContent.replace(/\s+/g, ' ').trim()).join(' | '), sel);
  const leaseholdIds = await page.evaluate((m) => _acqLeaseholdsOnly(_acqCanonicalRows(m)).map(t => t._leaseholdId).sort(), MAPLE);

  // ── A · no invoices: Run Analysis is available ───────────────────────────
  const a0 = await btn();
  check('A · leaseholds + Total SqFt + no invoices: Run Analysis is enabled', !a0.disabled, JSON.stringify(a0));
  check('A · and it says it will run a lease-only analysis', /lease-only analysis \(no seller invoices\)/.test(a0.note), a0.note);
  await setSqFt(0);
  const a1 = await btn();
  check('A · the area is still required: no Total SqFt, no analysis', a1.disabled && /Enter total property square footage/.test(a1.note), JSON.stringify(a1));
  await setSqFt(80000);
  check('A · no Acquire Property before any analysis (the review is a draft)', !(await convert()).shown);

  // ── B · the lease-only analysis keeps the term states ───────────────────
  await run();
  const b = await stored();
  const a = b.data.analysis || {};
  check('B · the analysis ran and the review is complete', b.status === 'complete' && Array.isArray(a.tenantSummary), b.status);
  check('B · it is lease-only: no CAM summary, zero invoices', !a.summary && a.invoices === 0, JSON.stringify({ summary: !!a.summary, invoices: a.invoices }));
  check('B · the rent roll is there: occupancy on 80,000 sf, WALT', a.rentRoll && a.rentRoll.occupancy && a.rentRoll.occupancy.buildingSqft === 80000 && a.rentRoll.walt != null, JSON.stringify(a.rentRoll && a.rentRoll.occupancy));
  check('B · the canonical block is stored: leaseholds basis, fingerprint, area, invoice fingerprint',
        a.canonical && a.canonical.basis === 'leaseholds' && !!a.canonical.fingerprint && a.canonical.sqft === 80000 && a.canonical.invoices !== undefined, JSON.stringify(a.canonical && Object.keys(a.canonical)));
  const stIds = Object.keys((a.canonical && a.canonical.states) || {}).sort();
  check('B · every leasehold\'s term states are stored', stIds.length === leaseholdIds.length && JSON.stringify(stIds) === JSON.stringify(leaseholdIds), stIds.join(','));
  const parsed = await page.evaluate(({ m, pid, canonical }) => {
    const PL = window.PropertyLeaseholds;
    const fams = __store.acquisition_document_families.filter(f => f.review_id === m).map(f => Object.assign({}, f, { property_id: pid }));
    const rec = PL.acquisitionRecord([{ id: m, property_id: pid, status: 'converted', converted_at: '2026-10-01T00:00:00Z', canonical }], pid, fams);
    return { parsed: !!PL.parseCanonicalStates(canonical), record: !!rec, n: rec ? Object.keys(rec.byLeasehold).length : 0 };
  }, { m: MAPLE, pid: PID, canonical: a.canonical });
  check('B · after Acquire the property can read them: PropertyLeaseholds parses the record for every leasehold',
        parsed.parsed && parsed.record && parsed.n === leaseholdIds.length, JSON.stringify(parsed));

  // ── C · what the page shows; no Decision Report ──────────────────────────
  const c0 = await shownText('#acqReportContainer .acq-lease-only');
  check('C · the page says it is lease-only and why', /Lease-only analysis/.test(c0) && /Seller invoices were not provided, so CAM recovery was not analyzed/.test(c0), c0);
  const c1 = await page.evaluate(() => ({
    decision: [].some.call(document.querySelectorAll('#acqReportContainer button'), x => /Decision Report/.test(x.textContent)),
    error: /Insufficient data/.test(document.getElementById('acqReportContainer').textContent),
    rr: document.getElementById('acqTabRentRoll') ? document.getElementById('acqTabRentRoll').textContent : '' }));
  check('C · no Decision Report control, and not the engine\'s "Insufficient data" error', !c1.decision && !c1.error, JSON.stringify({ decision: c1.decision, error: c1.error }));
  check('C · the Rent Roll tab carries the leaseholds', ['ShopRite', 'Luxe Nails', 'Maple Coffee', 'Prime Wellness'].every(n => c1.rr.includes(n)), c1.rr.slice(0, 160));
  await page.evaluate(() => { window.__toasts = []; generateAcquisitionReport(); });
  const c2 = await page.evaluate(() => ({ toasts: window.__toasts.slice(), open: getComputedStyle(document.getElementById('reportOverlay')).display !== 'none' }));
  check('C · the Decision Report refuses a lease-only analysis', !c2.open && c2.toasts.some(t => /^The Decision Report needs seller invoices/.test(t)), JSON.stringify(c2.toasts));
  const c3 = await page.evaluate((m) => _acqReviewsForConsumers().find(r => r.id === m).analysisState, MAPLE);
  check('C · consumers (Ask AI, Command Center) are not handed CAM figures that do not exist', c3 === 'none', c3);

  // ── D · the gate is unchanged ────────────────────────────────────────────
  const d0 = await convert();
  check('D · Acquire Property now appears — disabled', d0.shown && d0.disabled && /Acquire Property/.test(d0.label), JSON.stringify(d0));
  check('D · it names the unmatched extractions and the pending documents',
        /extracted entries not matched to a tenant/.test(d0.blocked) && /documents? in Documents/.test(d0.blocked), d0.blocked.slice(0, 160));
  await page.evaluate(() => { window.__toasts = []; _showAcqConvertModal(); });
  check('D · the confirmation does not open past the gate', await page.evaluate(() => document.getElementById('acqConvertModal').style.display !== 'flex'));
  await page.evaluate(() => convertAcquisitionToProperty());
  await page.waitForTimeout(400);
  check('D · and no conversion request reaches the server', !(await page.evaluate(() => (window.__rpc || []).some(r => r.fn === 'acquire_property'))));

  // ── E · a person resolves them; then Acquire is enabled ─────────────────
  for (let pass = 0; pass < 4; pass++) {
    await page.evaluate(async (m) => {
      const R = AcquisitionLeasehold.RESOLUTION;
      for (const e of _acqUnmatched(m).filter(x => !x.resolution)) await acqResolveExtraction(e.key, R.DISMISSED);
    }, MAPLE);
    await page.waitForTimeout(300);
    const pend = await page.evaluate((m) => _acqPendingDocuments(m).map(p => p.doc.id), MAPLE);
    for (const id of pend) {
      const how = await page.evaluate((id) => {
        if (document.querySelector(`#acqDocsList .acq-doc-confirm-family[data-doc-id="${id}"]`)) return 'confirm';
        if (document.querySelector(`#acqDocsList .acq-doc-dispose[data-doc-id="${id}"][data-action="not_relevant"]`)) return 'dispose';
        return null;
      }, id);
      if (how === 'confirm') await page.click(`#acqDocsList .acq-doc-confirm-family[data-doc-id="${id}"]`);
      else if (how === 'dispose') await page.click(`#acqDocsList .acq-doc-dispose[data-doc-id="${id}"][data-action="not_relevant"]`);
      await page.waitForTimeout(400);
    }
  }
  const e0 = await page.evaluate((m) => ({ unresolved: _acqUnresolvedExtractions(m), pending: _acqPendingDocuments(m).length }), MAPLE);
  check('E · a person has resolved every extraction and document', e0.unresolved === 0 && e0.pending === 0, JSON.stringify(e0));
  const e1 = await convert();
  if (e1.disabled && /Refresh the analysis/.test(e1.blocked)) {
    check('E · resolving changed the record: Acquire waits for a refreshed analysis', true);
    await run();
  }
  const e2 = await convert();
  check('E · with the safeguards met, Acquire Property is enabled — still with no invoices', e2.shown && !e2.disabled && !e2.blocked, JSON.stringify(e2));
  check('E · the analysis is still lease-only', !(await stored()).data.analysis.summary);
  await page.evaluate(() => _showAcqConvertModal());
  check('E · the confirmation opens', await page.evaluate(() => document.getElementById('acqConvertModal').style.display === 'flex'));
  // The server call: recorded, then refused here so nothing is converted and
  // the walk can go on (a converted review is closed).
  await page.evaluate(() => {
    window.__acquireCalls = [];
    const orig = db.rpc.bind(db);
    db.rpc = (fn, args) => {
      if (fn === 'acquire_property') { window.__acquireCalls.push(JSON.parse(JSON.stringify(args))); return Promise.resolve({ data: null, error: { code: 'P0001', message: 'test: stopped before the database' } }); }
      return orig(fn, args);
    };
  });
  await page.evaluate(() => convertAcquisitionToProperty());
  await page.waitForTimeout(800);
  const e3 = await page.evaluate(() => window.__acquireCalls.slice());
  const lhNow = await page.evaluate((m) => _acqLeaseholdsOnly(_acqCanonicalRows(m)).length, MAPLE);
  check('E · the conversion request goes to the server for THIS property, one roster row per leasehold',
        e3.length === 1 && e3[0].p_property_id === PID && e3[0].p_review_id === MAPLE && e3[0].p_snapshot.roster.length === lhNow,
        JSON.stringify(e3.map(c => ({ p: c.p_property_id, n: c.p_snapshot.roster.length }))));
  check('E · and carries the lease-only occupancy snapshot', e3.length === 1 && e3[0].p_snapshot.occupancyAtAcquisition && e3[0].p_snapshot.occupancyAtAcquisition.buildingSqft === 80000);
  check('E · refused there, the review is unchanged (not converted)', (await stored()).status === 'complete');
  await page.evaluate(() => { if (typeof _hideAcqConvertModal === 'function') _hideAcqConvertModal(); });

  // ── F · an invoice arrives: the lease-only analysis is stale ────────────
  await page.evaluate((m) => {
    const rv = _acqReviews.find(r => r.id === m);
    rv.data.invoices = [{ id: 'inv-test-1', vendorName: 'Test Landscaping (test data)', amount: 24000, category: 'landscaping' }];
    _acqInvoices = rv.data.invoices;
    _acqUpdateStaleNotice(); _renderAcqConvertAction(rv);
  }, MAPLE);
  const f0 = await page.evaluate((m) => _acqAnalysisStale(_acqReviews.find(r => r.id === m)), MAPLE);
  check('F · adding an invoice makes the analysis stale', f0 === 'The invoices have changed since this analysis was run.', f0);
  const f1 = await convert();
  check('F · and Acquire Property is blocked until it is re-run', f1.shown && f1.disabled && /Refresh the analysis/.test(f1.blocked), f1.blocked);

  // ── G · re-run with the invoice: the full CAM analysis returns ──────────
  await run();
  const g = (await stored()).data.analysis;
  check('G · re-run with the invoice: the full CAM analysis — a summary with a recovery rate', !!g.summary && typeof g.summary.recoveryRate === 'number', JSON.stringify(g.summary && g.summary.recoveryRate));
  check('G · the term states are still stored', Object.keys((g.canonical || {}).states || {}).length === lhNow);
  const g1 = await page.evaluate(() => ({
    decision: [].some.call(document.querySelectorAll('#acqReportContainer button'), x => /Decision Report/.test(x.textContent)),
    leaseOnly: !!document.querySelector('#acqReportContainer .acq-lease-only') }));
  check('G · the Decision Report control is back, and the lease-only notice is gone', g1.decision && !g1.leaseOnly, JSON.stringify(g1));
  await page.evaluate(() => { window.__toasts = []; generateAcquisitionReport(); });
  await page.waitForTimeout(400);
  const g2 = await page.evaluate(() => ({ open: getComputedStyle(document.getElementById('reportOverlay')).display !== 'none', title: document.getElementById('rptToolbarTitle').textContent }));
  check('G · and the Decision Report opens', g2.open && /Acquisition Decision Report/.test(g2.title), JSON.stringify(g2));
  check('G · Acquire Property is enabled again (current analysis, gate met)', !(await convert()).disabled);

  // ── boundaries ───────────────────────────────────────────────────────────
  check('no page errors during the walk', errs.length === 0, errs.join(' | '));
  const apiFiles = fs.readdirSync(path.join(ROOT, 'api')).filter(f => f.endsWith('.js') && !f.startsWith('_'));
  check('no new serverless function — api/ still holds twelve', apiFiles.length === 12, String(apiFiles.length));

  await browser.close();
  srv.close();
  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) { console.log('\nFAILED:'); failed.forEach(f => console.log('  ✗ ' + f.name + (f.detail ? '  — ' + f.detail : ''))); }
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
