// test-e2e-acquisition-terms.js
// ============================================================================
// Acquisition Review Phase 1, increment P1-4 / P4-3 — walked in the real page.
//
// The Lease Terms panel and the four human acts, against a Supabase stand-in
// that enforces what migration 026 enforces: append-only (UPDATE and DELETE
// refused), an actor that must be the owner, owner-only RLS, and composite
// keys on user_id. A test cannot pass here by writing a state the database
// would refuse.
//
//   1. The panel lists every term, per leasehold, with a state chip.
//   2. THE GATE: while the document is a proposal, Confirm and Correct are
//      disabled and the row says why. Reject stays available.
//   3. Confirming the DOCUMENT's type opens the gate.
//   4. Confirm writes one decision with an actor and a timestamp, and the
//      term reads verified — while the document's evidence is byte-identical.
//   5. Correct records the value it replaced and does not rewrite the document.
//   6. Reject keeps the reading and its clause, and stops presenting it.
//   7. Reopen returns the term to the documents and leaves all four rows.
//   8. A contradiction shows both values and both documents, unresolved.
//   9. A missing term is listed as missing, in words, with no Confirm.
//  10. A derived figure says it was calculated rather than quoted.
//  11. Append-only is real: the stand-in refuses an update and a delete.
//  12. Nothing crosses an owner.
//  13. A reload rebuilds every state from the two tables.
//  14. At 375px the term keeps its width and the controls take their own line.
//
// Run: node test-e2e-acquisition-terms.js
// ============================================================================
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
let pw; try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }

const ROOT = ROOTDIR(), PORT = 8935;
function ROOTDIR() { return __dirname; }
const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css',
               '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg',
               '.svg':'image/svg+xml', '.pdf':'application/pdf', '.txt':'text/plain' };

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail || '' });
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (detail ? '  — ' + detail : ''));
}

const UID = 'u1', REVIEW_ID = 'fffffff1-0000-4000-b000-000000000001';
const FAM = 'fam-1';

const EV = (v, q, p, c) => ({ value: v === undefined ? null : v, quote: q || null,
                              page: p == null ? null : p, confidence: c == null ? null : c });

// Two documents in one leasehold. The lease is a PROPOSAL going in, so the
// gate is the first thing the walk meets. The amendment is confirmed and
// contradicts nothing; a third document creates the contradiction later.
const DOCS = [
  { id: 'd-lease', review_id: REVIEW_ID, user_id: UID, intake_id: 'ik-1', file_name: 'ShopRite_Lease.pdf',
    intake_kind: 'lease', parsing_status: 'success', byte_size: 33098,
    storage_path: 'leases/' + UID + '/acq_x_1-ShopRite_Lease.pdf',
    doc_type: 'original_lease', doc_type_status: 'proposed', doc_type_source: 'ai',
    doc_type_confidence: 0.95, doc_date: '2023-03-01',
    family_id: FAM, family_status: 'proposed', family_source: 'ai',
    superseded_by_document_id: null, classification_history: [],
    abstraction_status: 'success', abstraction_model: 'claude-sonnet-4-6',
    abstracted_at: '2026-09-21T20:30:55.850Z',
    abstracted_fields: { schemaVersion: 1, model: 'claude-sonnet-4-6', at: '2026-09-21T20:30:55.850Z', fields: {
      cap:         EV(4, 'CAM increases are capped at 4% annually.', 4, 0.95),
      base_rent:   EV(1202500, 'Tenant agrees to pay base rent of $18.50 per square foot annually.', 3, 0.95),
      leased_sqft: EV(65000, 'Leased Area: 65,000 rentable square feet', 1, 0.99),
      lease_type:  EV('NNN', 'This lease is a Triple Net (NNN) lease.', 2, 0.99),
      renewal_options: EV('Tenant shall have no option to renew', 'Tenant shall have no option to renew.', 7, 0.9),
    } },
    created_at: '2026-09-21T12:00:00Z' },
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

  async function open(viewport, mobile) {
    const ctx = await browser.newContext({ viewport, isMobile: !!mobile, hasTouch: !!mobile,
                                           deviceScaleFactor: mobile ? 3 : 1 });
    const page = await ctx.newPage();
    page.on('pageerror', e => errs.push(String(e.message).split('\n')[0]));
    page.on('dialog', d => d.dismiss().catch(() => {}));
    await page.route('**cdnjs**',    r => r.fulfill({ status: 200, body: '/*x*/' }));
    await page.route('**jsdelivr**', r => r.fulfill({ status: 200, body: '/*x*/' }));
    await page.route('**fonts.g**',  r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await page.route('**/api/claude', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
    await page.route('**/api/document-url', r => r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ url: 'https://stub/x?token=signed', expiresIn: 300 }) }));
    await page.addInitScript(DB);
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2400);
    await page.evaluate(() => {
      const w = document.getElementById('obWelcomeModal');
      if (w && w.style.display !== 'none') { if (typeof obCloseWelcome === 'function') obCloseWelcome('skip'); else w.style.display = 'none'; }
    });
    return { ctx, page };
  }

  async function seed(page, docs) {
    await page.evaluate(async ({ rid, fam, ds }) => {
      __store.acquisition_reviews.push({ id: rid, user_id: 'u1', name: 'Harborview', status: 'draft',
        created_at: '2026-03-01T10:00:00.000Z', updated_at: 'rev-0',
        data: { tenants: [], invoices: [], totalSqFt: 26000, documents: [], analysis: null } });
      __store.acquisition_document_families.push({ id: fam, review_id: rid, user_id: 'u1',
        label: 'ShopRite Supermarkets', family_kind: 'lease' });
      ds.forEach(d => __store.acquisition_documents.push(d));
      await _loadAcqReviewsAndRender();
      selectAcquisitionReview(rid);
    }, { rid: REVIEW_ID, fam: FAM, ds: docs });
    await page.waitForTimeout(900);
  }

  const { ctx, page } = await open({ width: 1280, height: 1000 }, false);
  await seed(page, DOCS);

  console.log('\nAcquisition Lease Terms — decisions and the gate (P4-3)\n' + '='.repeat(64));

  const termRow = (field) => page.evaluate((f) => {
    const r = document.querySelector(`.acq-term-row[data-field="${f}"]`);
    if (!r) return null;
    const btn = (c) => { const b = r.querySelector(c); return b ? { present: true, disabled: b.disabled, title: b.title } : { present: false }; };
    return {
      state: r.getAttribute('data-state'),
      derived: r.getAttribute('data-derived') === '1',
      label: (r.querySelector('.acq-term-label') || {}).innerText || '',
      value: (r.querySelector('.acq-term-value') || {}).innerText || null,
      missing: (r.querySelector('.acq-term-missing') || {}).innerText || null,
      quote: (r.querySelector('.acq-term-quote') || {}).innerText || null,
      src: (r.querySelector('.acq-term-src') || {}).innerText || null,
      derivedNote: (r.querySelector('.acq-term-derived') || {}).innerText || null,
      conflict: (r.querySelector('.acq-term-conflict') || {}).innerText || null,
      decided: (r.querySelector('.acq-term-decided') || {}).innerText || null,
      blocked: (r.querySelector('.acq-term-blocked') || {}).innerText || null,
      confirm: btn('.acq-term-confirm'), correct: btn('.acq-term-correct'),
      reject: btn('.acq-term-reject'), reopen: btn('.acq-term-reopen'),
    };
  }, field);
  const decisions = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__store.acquisition_term_decisions)));
  const evidenceHash = () => page.evaluate(() =>
    JSON.stringify(window.__store.acquisition_documents.find(d => d.id === 'd-lease').abstracted_fields));

  const EV0 = await evidenceHash();

  // ── 1 · the panel ────────────────────────────────────────────────────────
  const panel = await page.evaluate(() => {
    const el = document.getElementById('acqTermsList');
    return {
      groups: [].slice.call(el.querySelectorAll('.acq-term-group')).map(g =>
        (g.querySelector('.acq-term-group-title') || {}).innerText || ''),
      rows: el.querySelectorAll('.acq-term-row').length,
      chips: el.querySelectorAll('.acq-term-state').length,
      count: (document.getElementById('acqTermsCount') || {}).innerText || '',
    };
  });
  check('the Lease Terms panel renders, grouped by leasehold',
        panel.groups.length === 1 && /ShopRite/.test(panel.groups[0]), panel.groups.join(' | '));
  check('every one of the 27 terms is listed', panel.rows === 27, String(panel.rows));
  check('each carries a state chip', panel.chips === 27, String(panel.chips));
  check('the header counts what is verified', /0 of 27 verified/.test(panel.count), panel.count);

  // ── 2 · THE GATE ─────────────────────────────────────────────────────────
  const capBefore = await termRow('cap');
  check('a term from a PROPOSED document is ai_extracted, not verified',
        capBefore.state === 'ai_extracted', capBefore.state);
  check('Confirm is DISABLED while the document is a proposal',
        capBefore.confirm.present && capBefore.confirm.disabled === true, JSON.stringify(capBefore.confirm));
  check('Correct is DISABLED too',
        capBefore.correct.present && capBefore.correct.disabled === true, JSON.stringify(capBefore.correct));
  check('and the row says why, in words',
        !!capBefore.blocked && /proposal/.test(capBefore.blocked), capBefore.blocked || 'no reason shown');
  check('the reason is on the control as well', /Confirm or correct the document type first/.test(capBefore.confirm.title || ''),
        capBefore.confirm.title || '');
  check('Reject is still available — it needs no agreement about the document',
        capBefore.reject.present && !capBefore.reject.disabled);

  const clicked = await page.evaluate(() => {
    const b = document.querySelector('.acq-term-row[data-field="cap"] .acq-term-confirm');
    b.click();
    return true;
  });
  await page.waitForTimeout(400);
  check('clicking the disabled Confirm records nothing at all',
        clicked && (await decisions()).length === 0, String((await decisions()).length) + ' decisions');

  // ── 3 · the gate opens ───────────────────────────────────────────────────
  await page.evaluate(() => acqConfirmDocType('d-lease'));
  await page.waitForTimeout(600);
  const capOpen = await termRow('cap');
  check('confirming the DOCUMENT type opens the gate',
        capOpen.confirm.disabled === false && capOpen.correct.disabled === false,
        `confirm disabled=${capOpen.confirm.disabled}`);
  check('and the blocked reason is gone', !capOpen.blocked, capOpen.blocked || 'clear');
  check('the term is still only ai_extracted — the DOCUMENT was confirmed, not the term',
        capOpen.state === 'ai_extracted', capOpen.state);

  // ── 4 · Confirm ──────────────────────────────────────────────────────────
  await page.click('.acq-term-row[data-field="cap"] .acq-term-confirm');
  await page.waitForTimeout(500);
  const capConfirmed = await termRow('cap');
  const d1 = await decisions();
  check('confirming writes exactly one decision', d1.length === 1, String(d1.length));
  check('it names the actor and the time',
        d1[0] && d1[0].decided_by === UID && d1[0].user_id === UID && /^\d{4}-/.test(String(d1[0].decided_at)),
        d1[0] ? `${d1[0].decided_by} @ ${d1[0].decided_at}` : '');
  check('it records the field and the action', d1[0] && d1[0].field_key === 'cap' && d1[0].action === 'confirm',
        d1[0] ? `${d1[0].field_key}/${d1[0].action}` : '');
  check('and the citation it confirmed', d1[0] && d1[0].source_document_id === 'd-lease'
        && /capped at 4%/.test(String(d1[0].source_quote)), d1[0] ? String(d1[0].source_quote) : '');
  check('the term now reads VERIFIED', capConfirmed.state === 'verified', capConfirmed.state);
  check('with its value and clause intact', /4%/.test(capConfirmed.value || '') && /capped at 4%/.test(capConfirmed.quote || ''),
        `${capConfirmed.value} | ${capConfirmed.quote}`);
  check('and the AI evidence is byte-identical', (await evidenceHash()) === EV0);

  // ── 5 · Correct ──────────────────────────────────────────────────────────
  await page.evaluate(() => { window.prompt = () => '6'; });
  await page.click('.acq-term-row[data-field="lease_type"] .acq-term-reject');
  await page.waitForTimeout(300);
  await page.evaluate(() => { window.prompt = () => '6'; });
  await page.click('.acq-term-row[data-field="cap"] .acq-term-correct');
  await page.waitForTimeout(500);
  const capCorrected = await termRow('cap');
  const dc = (await decisions()).filter(d => d.field_key === 'cap' && d.action === 'correct')[0];
  check('correcting records the value it replaced', dc && dc.previous_value === '4' && dc.new_value === '6',
        dc ? `${dc.previous_value} → ${dc.new_value}` : 'no correction recorded');
  check('the term shows the corrected value', /6%/.test(capCorrected.value || ''), capCorrected.value || '');
  check('and still reads verified, by a person', capCorrected.state === 'verified'
        && /Corrected by a person/.test(capCorrected.decided || ''), capCorrected.decided || '');
  check('THE DOCUMENT STILL SAYS 4% — a correction does not rewrite evidence',
        (await evidenceHash()) === EV0);

  // ── 6 · Reject ───────────────────────────────────────────────────────────
  const ltRejected = await termRow('lease_type');
  check('a rejected term keeps the reading the document gave',
        /NNN/.test(ltRejected.value || ''), ltRejected.value || '');
  check('and keeps its clause', /Triple Net/.test(ltRejected.quote || ''), ltRejected.quote || '');
  check('but stops presenting it as an answer', ltRejected.state === 'unclear', ltRejected.state);
  check('saying a person rejected it', /rejected this reading/.test(ltRejected.decided || ''), ltRejected.decided || '');
  check('the evidence is still untouched after a rejection', (await evidenceHash()) === EV0);

  // ── 7 · Reopen ───────────────────────────────────────────────────────────
  await page.click('.acq-term-row[data-field="cap"] .acq-term-reopen');
  await page.waitForTimeout(500);
  const capReopened = await termRow('cap');
  const capHistory = (await decisions()).filter(d => d.field_key === 'cap');
  check('reopening returns the term to what the documents say',
        capReopened.state === 'ai_extracted' && /4%/.test(capReopened.value || ''),
        `${capReopened.state} / ${capReopened.value}`);
  check('and every act is still on the record — three rows, nothing removed',
        capHistory.length === 3, capHistory.map(d => d.action).join(','));
  check('in the order they were made',
        capHistory.map(d => d.action).join(',') === 'confirm,correct,reopen', capHistory.map(d => d.action).join(','));
  check('Reopen is no longer offered on an unresolved term', capReopened.reopen.present === false);

  // ── 8 · a contradiction ──────────────────────────────────────────────────
  await page.evaluate((fam) => {
    const mk = (id, name, cap) => ({ id, review_id: window.__store.acquisition_reviews[0].id, user_id: 'u1',
      intake_id: id, file_name: name, intake_kind: 'lease', parsing_status: 'success',
      doc_type: 'amendment', doc_type_status: 'confirmed', doc_type_source: 'human', confirmed_by: 'u1',
      doc_date: '2024-05-01', family_id: fam, family_status: 'confirmed', family_source: 'human',
      superseded_by_document_id: null, classification_history: [],
      abstraction_status: 'success', abstracted_at: '2026-09-21T21:00:00Z', abstraction_model: 'm',
      abstracted_fields: { schemaVersion: 1, model: 'm', at: 'x', fields: {
        admin_fee_pct: { value: cap, quote: 'the administrative fee is ' + cap + '%', page: 2, confidence: 0.9 } } },
      created_at: '2026-09-21T13:00:00Z' });
    window.__store.acquisition_documents.push(mk('d-a', 'amendment-a.pdf', 12));
    window.__store.acquisition_documents.push(mk('d-b', 'amendment-b.pdf', 15));
  }, FAM);
  // The same two reads the app performs when a review is opened: the rows,
  // then the evidence column the list deliberately leaves behind.
  await page.evaluate((rid) => _acqLoadDocuments(rid)
    .then(() => _acqLoadEvidence(rid))
    .then(() => _renderAcqDocuments()), REVIEW_ID);
  await page.waitForTimeout(700);
  const conflict = await termRow('admin_fee_pct');
  check('two documents of one rank disagreeing reads as CONFLICTING',
        conflict.state === 'conflicting', conflict.state);
  check('and both values are on screen',
        /12/.test(conflict.conflict || '') && /15/.test(conflict.conflict || ''), conflict.conflict || '');
  check('with both documents named',
        /amendment-a\.pdf/.test(conflict.conflict || '') && /amendment-b\.pdf/.test(conflict.conflict || ''),
        conflict.conflict || '');
  check('and the screen says nothing was chosen',
        /Nothing has been chosen for you/.test(conflict.conflict || ''), conflict.conflict || '');

  // ── 9 · missing ──────────────────────────────────────────────────────────
  const missing = await termRow('co_tenancy');
  check('a term no document establishes is LISTED, not hidden', missing !== null && missing.state === 'missing',
        missing ? missing.state : 'row absent');
  check('and says so in words rather than showing a blank or a zero',
        /No document on file establishes this/.test(missing.missing || ''), missing.missing || '');
  check('it shows no value at all', missing.value === null, String(missing.value));
  check('and offers no Confirm or Correct — there is nothing to confirm',
        missing.confirm.present === false && missing.correct.present === false);

  // ── 10 · the derived figure ──────────────────────────────────────────────
  const derived = await termRow('base_rent');
  check('a calculated figure is flagged derived', derived.derived === true, String(derived.derived));
  check('it reads UNCLEAR rather than evidenced', derived.state === 'unclear', derived.state);
  check('the value is kept, not discarded or replaced by the rate',
        /1,202,500/.test(derived.value || ''), derived.value || '');
  check('the clause that produced it is shown',
        /18\.50 per square foot/.test(derived.quote || ''), derived.quote || '');
  check('and the screen says it was calculated, not quoted',
        /Calculated, not quoted/.test(derived.derivedNote || ''), derived.derivedNote || '');

  // ── 11 · append-only ─────────────────────────────────────────────────────
  const appendOnly = await page.evaluate(async () => {
    const id = window.__store.acquisition_term_decisions[0].id;
    const before = window.__store.acquisition_term_decisions.length;
    const u = await db.from('acquisition_term_decisions').update({ note: 'tidied' }).eq('id', id);
    const d = await db.from('acquisition_term_decisions').delete().eq('id', id);
    return { update: !!(u && u.error), del: !!(d && d.error), same: window.__store.acquisition_term_decisions.length === before };
  });
  check('the database refuses an UPDATE to a decision', appendOnly.update);
  check('and a DELETE', appendOnly.del);
  check('and the history is intact after both', appendOnly.same);

  // ── 12 · cross-owner ─────────────────────────────────────────────────────
  const crossed = await page.evaluate(async () => {
    __store.acquisition_reviews.push({ id: 'other-review', user_id: 'someone-else', name: 'Theirs', status: 'draft', data: {} });
    const before = __store.acquisition_term_decisions.length;
    const AT = window.AcquisitionTerms;
    const built = AT.buildDecisionPayload('other-review', 'u1', { fieldKey: 'cap', action: 'reject' });
    const r1 = await db.from('acquisition_term_decisions').insert(built.payload).select('id');
    const r2 = await db.from('acquisition_term_decisions')
      .insert({ review_id: __store.acquisition_reviews[0].id, user_id: 'someone-else',
                field_key: 'cap', action: 'reject', decided_by: 'someone-else' }).select('id');
    const r3 = await db.from('acquisition_term_decisions')
      .insert({ review_id: __store.acquisition_reviews[0].id, user_id: 'u1',
                field_key: 'cap', action: 'reject', decided_by: 'someone-else' }).select('id');
    return { r1: !!(r1 && r1.error), r2: !!(r2 && r2.error), r3: !!(r3 && r3.error),
             added: __store.acquisition_term_decisions.length - before };
  });
  check("a decision on another owner's review is refused by the database", crossed.r1);
  check("a decision written as another user is refused", crossed.r2);
  check("a decision naming somebody else as the decider is refused", crossed.r3);
  check('and none of the three was stored', crossed.added === 0, String(crossed.added));

  // ── 13 · a reload rebuilds it ────────────────────────────────────────────
  const snapshot = await page.evaluate(() => JSON.parse(JSON.stringify(window.__store)));
  check('no uncaught errors across the walk', errs.length === 0, errs.slice(0, 3).join(' | ') || 'clean');
  await ctx.close();

  {
    const { ctx: c2, page: p2 } = await open({ width: 1280, height: 1000 }, false);
    await p2.evaluate(async (snap) => {
      Object.keys(snap).forEach(k => { window.__store[k].length = 0; snap[k].forEach(r => window.__store[k].push(r)); });
      await _loadAcqReviewsAndRender();
      selectAcquisitionReview(snap.acquisition_reviews[0].id);
    }, snapshot);
    await p2.waitForTimeout(1000);
    const reCap = await p2.evaluate(() => {
      const r = document.querySelector('.acq-term-row[data-field="cap"]');
      return r ? { state: r.getAttribute('data-state'), value: (r.querySelector('.acq-term-value') || {}).innerText } : null;
    });
    const reLt = await p2.evaluate(() => {
      const r = document.querySelector('.acq-term-row[data-field="lease_type"]');
      return r ? { state: r.getAttribute('data-state'), decided: (r.querySelector('.acq-term-decided') || {}).innerText } : null;
    });
    check('after a reload the reopened term is still unresolved',
          reCap && reCap.state === 'ai_extracted' && /4%/.test(reCap.value || ''),
          reCap ? `${reCap.state} / ${reCap.value}` : 'row absent');
    check('and the rejected term is still rejected, with its reason',
          reLt && reLt.state === 'unclear' && /rejected/.test(reLt.decided || ''),
          reLt ? `${reLt.state} / ${reLt.decided}` : 'row absent');
    await c2.close();
  }

  // ── 14 · the phone ───────────────────────────────────────────────────────
  {
    const { ctx: c3, page: p3 } = await open({ width: 375, height: 667 }, true);
    await p3.evaluate(async (snap) => {
      Object.keys(snap).forEach(k => { window.__store[k].length = 0; snap[k].forEach(r => window.__store[k].push(r)); });
      await _loadAcqReviewsAndRender();
      selectAcquisitionReview(snap.acquisition_reviews[0].id);
    }, snapshot);
    await p3.waitForTimeout(1000);
    const m = await p3.evaluate(() => {
      const panel = document.getElementById('acqTermsList');
      for (let el = panel; el && el !== document.body; el = el.parentElement) {
        if (getComputedStyle(el).display === 'none') el.style.display = 'block';
        if (getComputedStyle(el).visibility === 'hidden') el.style.visibility = 'visible';
      }
      const rows = [].slice.call(panel.querySelectorAll('.acq-term-row')).slice(0, 8);
      // The panel's own right edge, in the same coordinate space the row
      // rectangles are measured in. Comparing an absolute x to a width was
      // the first version of this check and it was wrong.
      const panelRight = Math.round(panel.getBoundingClientRect().right);
      return {
        panelWidth: panel.clientWidth, scrollWidth: panel.scrollWidth, panelRight: panelRight,
        rows: rows.map(r => {
          const main = r.querySelector('.acq-term-main');
          const acts = r.querySelector('.acq-term-actions');
          const lab  = r.querySelector('.acq-term-label');
          const mb = main.getBoundingClientRect();
          return {
            field: r.getAttribute('data-field'),
            mainWidth: Math.round(mb.width),
            labelWidth: lab ? Math.round(lab.getBoundingClientRect().width) : 0,
            actionsBelow: acts ? Math.round(acts.getBoundingClientRect().top) >= Math.round(mb.bottom) - 2 : true,
            actionsRight: acts ? Math.round(acts.getBoundingClientRect().right) : 0,
            hasChip: !!r.querySelector('.acq-term-state'),
          };
        }),
      };
    });
    check('375px: the panel is actually laid out', m.panelWidth > 0, `panel ${m.panelWidth}px`);
    check('375px: terms render', m.rows.length === 8, String(m.rows.length));
    check('375px: each term keeps usable width',
          m.rows.every(r => r.mainWidth >= 200), m.rows.map(r => r.mainWidth).join(','));
    check('375px: the label is not crushed',
          m.rows.every(r => r.labelWidth >= 40), m.rows.map(r => r.labelWidth).join(','));
    check('375px: the controls take their own line under the term',
          m.rows.filter(r => !r.actionsBelow).length === 0,
          m.rows.filter(r => !r.actionsBelow).map(r => r.field).join(',') || 'all below');
    check('375px: every row still carries its state chip', m.rows.every(r => r.hasChip));
    check('375px: nothing scrolls sideways',
          m.scrollWidth <= m.panelWidth + 1 && m.rows.every(r => r.actionsRight <= m.panelRight + 1),
          `content ${m.scrollWidth}px in ${m.panelWidth}px; furthest control at `
          + Math.max(...m.rows.map(r => r.actionsRight)) + `px, panel ends at ${m.panelRight}px`);
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
