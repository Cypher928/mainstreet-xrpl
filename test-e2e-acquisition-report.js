// test-e2e-acquisition-report.js
// ============================================================================
// Acquisition Review P1-7 / R-2 — Acquisition Report v2, walked in the real page.
//
// The pure suite proves the view draws the model faithfully. This proves the
// page does: that the control exists without the CAM analysis, that the report
// opened from it is built from the P1-4 model and nothing else, that every
// obligation row on screen carries exactly the state the model gives it, that
// an original opens from INSIDE the report, that opening the report writes
// nothing, that a decision recorded after the page loaded still reaches it,
// and that at 375px the page does not scroll sideways.
//
// The Supabase stand-in is test-e2e-acquisition-terms.js's, carried verbatim:
// it enforces 026's append-only trigger, its actor rule and composite keys, so
// a state the database would refuse cannot pass here either.
//
// Run: node test-e2e-acquisition-report.js
// ============================================================================
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
let pw; try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }

const ROOT = __dirname, PORT = 8937;
const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css',
               '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg',
               '.svg':'image/svg+xml', '.pdf':'application/pdf', '.txt':'text/plain' };

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail || '' });
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (detail ? '  — ' + detail : ''));
}

const UID = 'u1', REVIEW_ID = 'fffffff1-0000-4000-b000-0000000000a2';
const FAM = 'fam-1';
const EV = (v, q, p, c) => ({ value: v === undefined ? null : v, quote: q || null,
                              page: p == null ? null : p, confidence: c == null ? null : c });
const FIELDS = (o) => ({ schemaVersion: 1, model: 'claude-sonnet-4-6', at: '2026-09-22T15:09:11Z', fields: o });

// The Pilot's leasehold, reproduced: a renewal and an amendment at the same
// tier, disagreeing. Plus a scan with no original that could not be read, and
// an unrelated lease in no leasehold — so question 4 has every kind of row.
const DOCS = [
  { id: 'd-lease', review_id: REVIEW_ID, user_id: UID, intake_id: 'ik-1',
    file_name: 'ShopRite_Anchor_Tenant_Lease.pdf', intake_kind: 'lease', parsing_status: 'success',
    storage_path: 'leases/' + UID + '/acq_x_1-ShopRite_Anchor_Tenant_Lease.pdf',
    doc_type: 'renewal', doc_type_status: 'corrected', doc_type_source: 'human',
    confirmed_by: UID, confirmed_at: '2026-09-21T20:30:00Z', doc_date: '2024-03-01',
    family_id: FAM, family_status: 'proposed', family_source: 'ai',
    superseded_by_document_id: null, classification_history: [],
    abstraction_status: 'success', abstraction_model: 'claude-sonnet-4-6', abstracted_at: '2026-09-21T20:30:55Z',
    abstracted_fields: FIELDS({
      tenant_name:     EV('ShopRite Supermarkets, Inc.', 'Tenant:   ShopRite Supermarkets, Inc.', 1, 0.99),
      renewal_options: EV("The initial term shall be fifteen (15) years, subject to Tenant's renewal options as set forth herein.",
                          "The initial term shall be fifteen (15) years, subject to Tenant's renewal options as set forth herein.", 2, 0.4),
      audit_rights:    EV(true, 'Tenant shall have the right to audit Landlord records.', 5, 0.95),
      cap:             EV(4, 'CAM increases are capped at 4% annually.', 4, 0.95),
      tenant_improvement_allowance: EV(650000, 'Landlord shall provide an allowance of $10.00 per rentable square foot.', 6, 0.9),
    }),
    created_at: '2026-09-21T12:31:02Z' },
  { id: 'd-amd', review_id: REVIEW_ID, user_id: UID, intake_id: 'ik-2',
    file_name: 'Maple_Plaza_Test_Lease_Amendment.pdf', intake_kind: 'lease', parsing_status: 'success',
    storage_path: 'leases/' + UID + '/acq_x_2-Maple_Plaza_Test_Lease_Amendment.pdf',
    doc_type: 'amendment', doc_type_status: 'confirmed', doc_type_source: 'ai',
    confirmed_by: UID, confirmed_at: '2026-09-22T15:00:00Z', doc_date: '2027-01-01',
    family_id: FAM, family_status: 'confirmed', family_source: 'human',
    superseded_by_document_id: null, classification_history: [],
    abstraction_status: 'success', abstraction_model: 'claude-sonnet-4-6', abstracted_at: '2026-09-22T15:09:11Z',
    abstracted_fields: FIELDS({
      tenant_name:     EV('ShopRite Supermarkets, Inc.', 'Tenant   ShopRite Supermarkets, Inc.', 1, 0.99),
      renewal_options: EV('one additional five-year renewal option following expiration of the then-current term',
                          'The Tenant shall have   one additional five-year renewal option', 1, 0.99),
      cap:             EV(3, 'controllable Common Area Maintenance expense increases shall not exceed   3% per year', 1, 0.99),
      assignment_consent: EV('Landlord consent not to be unreasonably withheld',
                             'Landlord’s consent to assignment shall not be unreasonably withheld.', 1, 0.95),
    }),
    created_at: '2026-09-22T03:15:36Z' },
  { id: 'd-scan', review_id: REVIEW_ID, user_id: UID, intake_id: 'ik-3',
    file_name: 'Estoppel_scan.pdf', intake_kind: 'lease', parsing_status: 'partial', storage_path: null,
    doc_type: 'estoppel', doc_type_status: 'proposed', doc_type_source: 'ai', doc_date: null,
    family_id: null, family_status: 'unfiled', family_source: null,
    superseded_by_document_id: null, classification_history: [],
    abstraction_status: 'failed', abstraction_error: 'no_text', abstracted_fields: {},
    created_at: '2026-09-22T09:00:00Z' },
];
// One confirmation, decided on a confirmed document, so a VERIFIED row exists.
const DECISIONS = [
  { id: 'dec-1', review_id: REVIEW_ID, user_id: UID, family_id: FAM, field_key: 'assignment_consent',
    action: 'confirm', previous_value: 'Landlord consent not to be unreasonably withheld', new_value: null,
    source_document_id: 'd-amd', source_quote: 'Landlord’s consent to assignment shall not be unreasonably withheld.',
    source_page: 1, decided_by: UID, decided_at: '2026-09-22T15:30:00Z', note: null, created_at: '2026-09-22T15:30:00Z' },
];
const ASSUMPTIONS = [{ key: 'guaranty_limit', label: 'Underwritten guaranty limit', value: 500000,
                       at: '2026-09-22T12:00:00Z', by: 'pm@example.com' }];

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
  const signed = [];     // every /api/document-url request, with the path it asked for
  const claude = [];     // every /api/claude request — opening a report must make none

  async function open(viewport, mobile) {
    const ctx = await browser.newContext({ viewport, isMobile: !!mobile, hasTouch: !!mobile,
                                           deviceScaleFactor: mobile ? 3 : 1 });
    await ctx.route('https://stub/**', r => r.fulfill({ status: 200, contentType: 'text/plain', body: 'original' }));
    const page = await ctx.newPage();
    page.on('pageerror', e => errs.push(String(e.message).split('\n')[0]));
    page.on('dialog', d => d.dismiss().catch(() => {}));
    await page.route('**cdnjs**',    r => r.fulfill({ status: 200, body: '/*x*/' }));
    await page.route('**jsdelivr**', r => r.fulfill({ status: 200, body: '/*x*/' }));
    await page.route('**fonts.g**',  r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await page.route('**/api/claude', r => { claude.push(r.request().postData() || '');
      r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }); });
    await page.route('**/api/document-url**', r => { signed.push(r.request().url() + ' ' + (r.request().postData() || ''));
      r.fulfill({ status: 200, contentType: 'application/json',
                  body: JSON.stringify({ url: 'https://stub/x?token=signed', expiresIn: 300 }) }); });
    await page.addInitScript(DB);
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2400);
    await page.evaluate(() => {
      const w = document.getElementById('obWelcomeModal');
      if (w && w.style.display !== 'none') { if (typeof obCloseWelcome === 'function') obCloseWelcome('skip'); else w.style.display = 'none'; }
    });
    return { ctx, page };
  }

  async function seed(page) {
    await page.evaluate(async ({ rid, fam, ds, decs, asm }) => {
      __store.acquisition_reviews.push({ id: rid, user_id: 'u1', name: 'Harborview', status: 'draft',
        created_at: '2026-03-01T10:00:00.000Z', updated_at: 'rev-0',
        data: { tenants: [], invoices: [], totalSqFt: 26000, documents: [], analysis: null, assumptions: asm } });
      __store.acquisition_document_families.push({ id: fam, review_id: rid, user_id: 'u1',
        label: 'ShopRite Supermarkets, Inc.', family_kind: 'lease' });
      ds.forEach(d => __store.acquisition_documents.push(d));
      decs.forEach(d => __store.acquisition_term_decisions.push(d));
      await _loadAcqReviewsAndRender();
      selectAcquisitionReview(rid);
    }, { rid: REVIEW_ID, fam: FAM, ds: DOCS, decs: DECISIONS, asm: ASSUMPTIONS });
    await page.waitForTimeout(900);
  }

  // The model the page SHOULD have drawn, built in the page from the store
  // directly — not from anything the glue computed — by the frozen R-1 module.
  const expectedModel = (page) => page.evaluate(() => {
    const S = window.__store, AR = window.AcquisitionReport;
    const review = S.acquisition_reviews.find(r => r.id === 'fffffff1-0000-4000-b000-0000000000a2');
    const m = AR.buildReport(review,
      S.acquisition_document_families.filter(f => f.review_id === review.id),
      S.acquisition_documents.filter(d => d.review_id === review.id),
      S.acquisition_term_decisions.filter(d => d.review_id === review.id), {});
    const q3 = m.questions.find(q => q.id === 'what_obligations');
    const q4 = m.questions.find(q => q.id === 'what_evidence');
    return {
      ok: m.ok,
      q3: [].concat(...q3.sections.map(s => s.facts)).map(f =>
        [f.key, f.state, f.origin || '', f.derived ? 'D' : ''].join(':')),
      entered: (q3.entered || []).map(f => [f.key, f.state, f.origin || ''].join(':')),
      q4: q4.documents.map(d => [d.documentId, d.classificationSettled, d.readForTerms,
                                 d.readFailedBecause || '', d.originalOnFile].join(':')),
      q1keys: [].concat(...m.questions[0].sections.map(s => s.facts)).map(f => f.key),
      q2keys: [].concat(...m.questions[1].sections.map(s => s.facts)).map(f => f.key),
    };
  });

  // What is ON SCREEN, read back from the rendered report only.
  const drawn = (page) => page.evaluate(() => {
    const root = document.querySelector('#rptBody [data-report="acquisition-v2"]');
    if (!root) return null;
    const q3 = root.querySelector('[data-q="what_obligations"]');
    const q4 = root.querySelector('[data-q="what_evidence"]');
    const txt = (el) => el ? el.innerText.replace(/\s+/g, ' ').trim() : '';
    const rowOf = (key) => { const r = q3 && q3.querySelector(`.acqr-leasehold .acqr-fact[data-key="${key}"]`); return r ? {
      state: r.getAttribute('data-state'), origin: r.getAttribute('data-origin'),
      derived: r.getAttribute('data-derived'), text: txt(r),
      lead: txt(r.querySelector('.acqr-evidence-lead')),
      competing: r.querySelectorAll('.acqr-competing-item').length,
      competingText: [].map.call(r.querySelectorAll('.acqr-competing-item'), txt),
    } : null; };
    return {
      overlay: getComputedStyle(document.getElementById('reportOverlay')).display,
      title: txt(document.getElementById('rptToolbarTitle')),
      coverage: { drawn: root.querySelector('.acqr-coverage').getAttribute('data-drawn'),
                  of: root.querySelector('.acqr-coverage').getAttribute('data-of'),
                  text: txt(root.querySelector('.acqr-coverage')) },
      pending: [].map.call(root.querySelectorAll('[data-pending="true"]'), s => s.getAttribute('data-q')),
      pendingText: [].map.call(root.querySelectorAll('[data-pending="true"]'), txt),
      order: [].map.call(root.querySelectorAll('.acqr-question'), s => s.getAttribute('data-q')),
      q3: [].map.call(q3.querySelectorAll('.acqr-leasehold .acqr-fact'), r =>
        [r.getAttribute('data-key'), r.getAttribute('data-state'), r.getAttribute('data-origin') || '',
         r.getAttribute('data-derived') === 'true' ? 'D' : ''].join(':')),
      entered: [].map.call(q3.querySelectorAll('.acqr-entered .acqr-fact'), r =>
        [r.getAttribute('data-key'), r.getAttribute('data-state'), r.getAttribute('data-origin') || ''].join(':')),
      enteredText: txt(q3.querySelector('.acqr-entered')),
      allKeys: [].map.call(root.querySelectorAll('.acqr-fact'), r => r.getAttribute('data-key')),
      q4: [].map.call(q4.querySelectorAll('.acqr-doc'), r => {
        const read = r.querySelector('[data-read]'), why = r.querySelector('[data-reason]');
        return { id: r.getAttribute('data-doc'), settled: r.getAttribute('data-settled'),
                 read: read && read.getAttribute('data-read'), reason: why ? why.getAttribute('data-reason') : '',
                 opener: (r.querySelector('[data-doc-url]') || { getAttribute: () => null }).getAttribute('data-doc-url'),
                 text: txt(r) };
      }),
      rows: { renewal: rowOf('renewal_options'), audit: rowOf('audit_rights'),
              ti: rowOf('tenant_improvement_allowance'), assign: rowOf('assignment_consent'),
              landlord: rowOf('landlord_work') },
      missingRows: [].map.call(q3.querySelectorAll('.acqr-leasehold .acqr-fact[data-state="missing"]'), txt),
      legend: txt(root.querySelector('.acqr-legend')),
    };
  });

  const { ctx, page } = await open({ width: 1280, height: 1000 }, false);
  await seed(page);

  console.log('\nAcquisition Report v2 — Q3 + Q4 in the page (P1-7 / R-2)\n' + '='.repeat(64));

  // ── 1 · the control ──────────────────────────────────────────────────────
  const ctl = await page.evaluate(() => {
    const b = document.getElementById('acqReportV2Btn');
    const v1 = [].slice.call(document.querySelectorAll('button')).filter(x =>
      /generateAcquisitionReport\(\)/.test(x.getAttribute('onclick') || '') && x.offsetParent !== null);
    return { present: !!b, visible: !!(b && b.offsetParent !== null), text: b ? b.innerText.trim() : '',
             v1Visible: v1.length, analysis: ((_acqReviews.find(r => r.id === _activeAcqId) || {}).data || {}).analysis,
             active: _activeAcqId };
  });
  check('the v2 control is on the page', ctl.present && /Acquisition Report v2/.test(ctl.text), ctl.text);
  check('it is reachable with NO CAM analysis run', ctl.visible && ctl.active === REVIEW_ID && ctl.analysis == null,
        'analysis=' + JSON.stringify(ctl.analysis));
  check('the v1 Decision Report is not offered here (it still needs the analysis)', ctl.v1Visible === 0,
        String(ctl.v1Visible));

  // ── 2 · opening it writes nothing and asks nothing ──────────────────────
  const snap = () => page.evaluate(() => JSON.stringify(window.__store));
  const before = await snap();
  const claudeBefore = claude.length;
  await page.click('#acqReportV2Btn');
  await page.waitForTimeout(700);
  const d1 = await drawn(page);
  check('the report opens in the report overlay', !!d1 && d1.overlay === 'block', d1 ? d1.overlay : 'no report');
  check('titled as v2 for this property', !!d1 && /Acquisition Report v2/.test(d1.title), d1 && d1.title);
  const after = await snap();
  check('opening the report writes nothing to the store', before === after,
        before === after ? 'byte-identical' : 'store changed');
  check('opening the report calls no AI', claude.length === claudeBefore, String(claude.length - claudeBefore));

  // At desktop width nothing the report says may be cut off. Report tables
  // default to nowrap on every column but the first; a clause in that column
  // runs off the edge of its scroll box and the reader never sees the end.
  const wide = await page.evaluate(() => {
    const root = document.querySelector('#rptBody [data-report="acquisition-v2"]');
    const boxes = [].map.call(root.querySelectorAll('.rpt-table-scroll'), w =>
      ({ scroll: w.scrollWidth, client: w.clientWidth }));
    const clipped = [].filter.call(root.querySelectorAll('.acqr-cell'), c => c.scrollWidth > c.clientWidth + 1)
      .map(c => (c.closest('tr').getAttribute('data-key') || c.closest('tr').getAttribute('data-doc')) + ':' + c.scrollWidth + '>' + c.clientWidth);
    return { boxes, clipped };
  });
  check('1280px: no report table scrolls sideways',
        wide.boxes.length === 3 && wide.boxes.every(b => b.scroll <= b.client + 1),
        wide.boxes.map(b => b.scroll + '/' + b.client).join(' '));
  check('1280px: no cell’s text is cut off', wide.clipped.length === 0, wide.clipped.slice(0, 4).join(', ') || 'none');

  // ── 3 · Q3 — every row is the model's row ───────────────────────────────
  const exp = await expectedModel(page);
  check('the model builds', exp.ok === true);
  check('Q3 on screen is exactly the model — key, state, origin, derived, in order',
        JSON.stringify(d1.q3) === JSON.stringify(exp.q3),
        d1.q3.length + ' rows' + (JSON.stringify(d1.q3) === JSON.stringify(exp.q3) ? '' : ' :: ' + d1.q3.join(',') + ' vs ' + exp.q3.join(',')));
  check('all 11 obligations are listed, none hidden', d1.q3.length === 11, String(d1.q3.length));
  const states = s => d1.q3.filter(x => x.split(':')[1] === s).length;
  check('each of the four states appears (non-vacuous)',
        states('verified') >= 1 && states('assumption') >= 1 && states('issue') >= 1 && states('missing') >= 1,
        ['verified', 'assumption', 'issue', 'missing'].map(s => s + '=' + states(s)).join(' '));

  const R = d1.rows;
  check('a confirmed term reads Verified, with its source', R.assign && R.assign.state === 'verified'
        && /Verified/.test(R.assign.text) && R.assign.lead === 'Source:' && /Maple_Plaza_Test_Lease_Amendment/.test(R.assign.text),
        R.assign && R.assign.text.slice(0, 140));
  check('an unconfirmed AI read is an Assumption marked AI-read', R.audit && R.audit.state === 'assumption'
        && R.audit.origin === 'ai_read' && /AI-read · not confirmed/.test(R.audit.text), R.audit && R.audit.text.slice(0, 120));
  check('a derived figure says so and shows what it was calculated from',
        R.ti && R.ti.derived === 'true' && /Derived — calculated from lease terms/.test(R.ti.text)
        && R.ti.lead === 'Calculated from:' && /\$10\.00 per rentable square foot/.test(R.ti.text),
        R.ti && R.ti.text.slice(0, 160));
  check('the derived figure is never labelled as a stated Source', R.ti && R.ti.lead !== 'Source:');
  check('a contradiction is an Issue, drawn Contested', R.renewal && R.renewal.state === 'issue'
        && /Contested/.test(R.renewal.text), R.renewal && R.renewal.text.slice(0, 80));
  check('both sides of the contradiction are shown, each with its document',
        R.renewal && R.renewal.competing === 2
        && R.renewal.competingText.some(t => /Maple_Plaza_Test_Lease_Amendment/.test(t))
        && R.renewal.competingText.some(t => /ShopRite_Anchor_Tenant_Lease/.test(t)),
        R.renewal && String(R.renewal.competing));
  check('and the report says neither has been chosen', R.renewal && /Neither value has been selected\./.test(R.renewal.text));
  check('and names no single Source for it', R.renewal && R.renewal.lead === '' && !/Source:/.test(R.renewal.text),
        R.renewal && R.renewal.lead);
  check('every missing row says Not established, and invents nothing',
        d1.missingRows.length === 7 && d1.missingRows.every(t => /Not established/.test(t)),
        d1.missingRows.length + ' missing');
  check('a missing row carries no value and no source', R.landlord && R.landlord.state === 'missing'
        && !/Source:|Calculated from:/.test(R.landlord.text), R.landlord && R.landlord.text);

  // entered assumptions: separate, and never passed off as read from a document
  check('an entered figure is drawn apart from the AI-read rows',
        JSON.stringify(d1.entered) === JSON.stringify(exp.entered) && d1.entered.length === 1,
        d1.entered.join(','));
  check('it is labelled Entered · no document', /Entered by a person/.test(d1.enteredText)
        && /Entered · no document/.test(d1.enteredText) && /Underwritten guaranty limit/.test(d1.enteredText),
        d1.enteredText.slice(0, 160));
  check('the leasehold row for the same term stays Missing — the entry does not fill it',
        exp.q3.indexOf('guaranty_limit:missing::') >= 0 && d1.q3.indexOf('guaranty_limit:missing::') >= 0);

  // ── 4 · Q4 — every document, and the original opens from inside ────────
  const q4got = d1.q4.map(d => [d.id, d.settled === 'true', d.read, d.reason, !!d.opener].join(':'));
  check('Q4 on screen is exactly the model — document, settled, read, reason, original',
        JSON.stringify(q4got) === JSON.stringify(exp.q4), q4got.join(' | '));
  const scan = d1.q4.find(d => d.id === 'd-scan') || {};
  check('a document with no original says so and offers no opener',
        scan.opener === null && /Original not on file\./.test(scan.text), scan.text);
  check('an unreadable document says why', scan.read === 'failed' && scan.reason === 'no_text'
        && /no usable text on file/.test(scan.text), scan.reason);
  check('an AI-proposed classification is not presented as confirmed',
        /Proposed by AI — not confirmed\./.test(scan.text));
  const amd = d1.q4.find(d => d.id === 'd-amd') || {};
  check('an original on file carries its storage path as the opener',
        amd.opener === DOCS[1].storage_path, amd.opener);

  const signedBefore = signed.length;
  const popup = ctx.waitForEvent('page', { timeout: 4000 }).catch(() => null);
  await page.click('#rptBody .acqr-doc[data-doc="d-amd"] [data-doc-url]');
  const pop = await popup;
  await page.waitForTimeout(500);
  const asked = signed.slice(signedBefore);
  check('clicking it inside the report asks for a signed link', asked.length === 1, asked.join(' ; ') || 'none');
  check('for that document’s path, not another', asked.length === 1 && asked[0].indexOf(encodeURIComponent(DOCS[1].storage_path)) >= 0
        || asked.length === 1 && asked[0].indexOf(DOCS[1].storage_path) >= 0, asked[0] || '');
  check('and the original opens', !!pop && /stub\/x\?token=signed/.test(pop.url()), pop ? pop.url() : 'no window');
  if (pop) await pop.close();
  const still = await page.evaluate(() => getComputedStyle(document.getElementById('reportOverlay')).display);
  check('the report stays open behind it', still === 'block', still);

  // ── 5 · Q1, Q2, Q5 are drawn in place as not yet answered ──────────────
  check('the report says it answers 2 of 5 questions',
        d1.coverage.drawn === '2' && d1.coverage.of === '5' && /not a complete acquisition report/.test(d1.coverage.text),
        d1.coverage.text.slice(0, 120));
  check('all five questions appear, in §7 order', JSON.stringify(d1.order) === JSON.stringify(
        ['what_am_i_buying', 'what_income', 'what_obligations', 'what_evidence', 'what_needs_attention']),
        d1.order.join(','));
  check('Q1, Q2 and Q5 are marked pending, not skipped',
        JSON.stringify(d1.pending) === JSON.stringify(['what_am_i_buying', 'what_income', 'what_needs_attention']),
        d1.pending.join(','));
  check('each pending question warns against being read as an answer',
        d1.pendingText.length === 3 && d1.pendingText.every(t => /Nothing here should be read as an answer/.test(t)));
  const leaked = d1.allKeys.filter(k => exp.q1keys.indexOf(k) >= 0 || exp.q2keys.indexOf(k) >= 0);
  check('no Q1 or Q2 term leaks into this version — not even the contested CAM cap',
        leaked.length === 0 && d1.allKeys.indexOf('cap') < 0, leaked.join(',') || 'none');
  check('the legend explains every state and the derived mark',
        ['Verified', 'Assumption', 'Issue', 'Missing', 'Derived — calculated from lease terms'].every(w => d1.legend.indexOf(w) >= 0));

  // ── 6 · fresh reads: a decision made after load reaches the report ─────
  await page.evaluate(() => { if (typeof closeReport === 'function') closeReport(); });
  await page.evaluate(() => {
    window.__store.acquisition_term_decisions.push({ id: 'dec-2', review_id: 'fffffff1-0000-4000-b000-0000000000a2',
      user_id: 'u1', family_id: 'fam-1', field_key: 'audit_rights', action: 'confirm', previous_value: true,
      new_value: null, source_document_id: 'd-lease', source_quote: 'Tenant shall have the right to audit Landlord records.',
      source_page: 5, decided_by: 'u1', decided_at: '2026-09-22T16:00:00Z', note: null, created_at: '2026-09-22T16:00:00Z' });
    // …and a reading that landed after load: the amendment now states the landlord's work.
    const amd = window.__store.acquisition_documents.find(d => d.id === 'd-amd');
    amd.abstracted_fields = JSON.parse(JSON.stringify(amd.abstracted_fields));
    amd.abstracted_fields.fields.landlord_work = { value: 'Landlord to deliver the premises with a new roof',
      quote: 'Landlord shall deliver the Premises with a new roof.', page: 2, confidence: 0.9 };
  });
  await page.click('#acqReportV2Btn');
  await page.waitForTimeout(700);
  const d2 = await drawn(page);
  const exp2 = await expectedModel(page);
  check('a decision recorded after the page loaded reaches the report',
        d2.rows.audit && d2.rows.audit.state === 'verified', d2.rows.audit && d2.rows.audit.state);
  check('and the reopened report is still exactly the model',
        JSON.stringify(d2.q3) === JSON.stringify(exp2.q3), d2.q3.join(','));
  check('a reading that landed after the page loaded reaches the report',
        d2.rows.landlord && d2.rows.landlord.state === 'assumption' && /new roof/.test(d2.rows.landlord.text),
        d2.rows.landlord && d2.rows.landlord.state);
  check('the earlier state is gone, not kept alongside', d2.q3.filter(x => /^audit_rights:/.test(x)).length === 1);
  await page.evaluate(() => { if (typeof closeReport === 'function') closeReport(); });
  await ctx.close();

  // ── 7 · 375px ────────────────────────────────────────────────────────────
  {
    const { ctx: c3, page: p3 } = await open({ width: 375, height: 812 }, true);
    await seed(p3);
    await p3.evaluate(() => { const b = document.getElementById('acqReportV2Btn'); b.scrollIntoView(); b.click(); });
    await p3.waitForTimeout(800);
    const m = await p3.evaluate(() => {
      const root = document.querySelector('#rptBody [data-report="acquisition-v2"]');
      const vw = document.documentElement.clientWidth;
      const rows = [].map.call(root.querySelectorAll('.acqr-fact, .acqr-doc'), r => {
        const b = r.getBoundingClientRect();
        return { key: r.getAttribute('data-key') || r.getAttribute('data-doc'), right: Math.round(b.right), width: Math.round(b.width),
                 chip: !!r.querySelector('.acqr-chip, [data-read]') };
      });
      // On a phone each <td> is a card line: heading on the left, content on
      // the right. Everything a cell says must sit in the content column.
      const cells = [].map.call(root.querySelectorAll('.acqr-fact td, .acqr-doc td'), td => {
        const tr = td.getBoundingClientRect();
        const kids = [].filter.call(td.childNodes, n => n.nodeType === 1 || (n.nodeType === 3 && n.textContent.trim()));
        const inner = td.querySelector(':scope > .acqr-cell');
        const ib = inner ? inner.getBoundingClientRect() : null;
        const outOfColumn = [].filter.call(td.querySelectorAll('.acqr-competing-item, .acqr-unchosen, .acqr-note, .acqr-evidence, .acqr-origin, .acqr-derived'),
          el => ib && el.getBoundingClientRect().left < ib.left - 1).length;
        return { ok: kids.length === 1 && !!inner, gutter: ib ? Math.round(ib.left - tr.left) : -1, outOfColumn };
      });
      return { vw, scroll: document.documentElement.scrollWidth, bodyScroll: document.body.scrollWidth, rows, cells,
               competing: [].map.call(root.querySelectorAll('.acqr-competing-item'), li => Math.round(li.getBoundingClientRect().right)) };
    });
    check('375px: the page does not scroll sideways', m.scroll <= m.vw + 1 && m.bodyScroll <= m.vw + 1,
          `document ${m.scroll}px, body ${m.bodyScroll}px, viewport ${m.vw}px`);
    check('375px: every row fits inside the viewport', m.rows.every(r => r.right <= m.vw + 1),
          m.rows.filter(r => r.right > m.vw + 1).map(r => r.key + '@' + r.right).join(',') || m.rows.length + ' rows fit');
    // 11 obligations + 1 entered figure + 3 documents
    check('375px: every row keeps its state', m.rows.length === 15 && m.rows.every(r => r.chip),
          m.rows.length + ' rows');
    // 12 fact rows × 3 cells + 3 documents × 4 cells
    check('375px: every cell holds its content as one block', m.cells.length === 48 && m.cells.every(c => c.ok),
          m.cells.filter(c => !c.ok).length + ' of ' + m.cells.length + ' cells split');
    check('375px: nothing a cell says is dealt into the heading gutter',
          m.cells.every(c => c.outOfColumn === 0 && c.gutter > 40),
          'gutters ' + [...new Set(m.cells.map(c => c.gutter))].join(',') + 'px; misplaced '
          + m.cells.reduce((a, c) => a + c.outOfColumn, 0));
    check('375px: both sides of the contradiction stay on screen',
          m.competing.length === 2 && m.competing.every(x => x <= m.vw + 1), m.competing.join(','));
    if (process.env.SHOT) {
      await p3.evaluate(() => document.querySelector('#rptBody [data-q="what_obligations"]').scrollIntoView());
      await p3.screenshot({ path: process.env.SHOT, fullPage: false });
    }
    await c3.close();
  }

  check('no uncaught errors in any viewport', errs.length === 0, errs.slice(0, 3).join(' | ') || 'clean');

  await browser.close(); srv.close();

  const failed = results.filter(r => !r.ok);
  console.log('='.repeat(64));
  console.log(`${results.length - failed.length}/${results.length} passed`);
  if (failed.length) { console.log('FAILED:'); failed.forEach(f => console.log('  - ' + f.name + ' :: ' + f.detail)); }
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(2); });
