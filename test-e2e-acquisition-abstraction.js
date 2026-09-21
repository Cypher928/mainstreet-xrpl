// test-e2e-acquisition-abstraction.js
// ============================================================================
// Acquisition Review Phase 1, increment P1-4 / P4-1 — walked in the real page.
//
// P1-3 said what each document IS. This proves each document is now asked what
// it SAYS, and that the answer is stored as evidence and nothing more:
//
//   1. A lease is read after it is stored and classified. Its row carries the
//      27-field evidence, `success`, the model and the time. A term the lease
//      does not address is { value: null, quote: null } — NOT zero. A term it
//      explicitly denies is a VALUE with its clause.
//   2. Nothing was written back: the tenant the extraction produced is what
//      lease_extraction returned, untouched by the abstraction.
//   3. A rent roll is `skipped`, with nothing claimed.
//   4. A document the task cannot read (the call fails) is `failed`, and the
//      review is none the worse for it.
//   5. Correcting a rent roll INTO an amendment reads it — from the text
//      already on its row, not from a re-upload. Correcting an amendment OUT
//      to a rent roll marks it `skipped` and leaves its evidence in place.
//   6. "Read terms" on a failed row reads it again, from the same stored text.
//   7. The panel says, per lease-family document, whether it was read — and
//      says nothing of the kind on a rent roll.
//   8. The stand-in enforces migration 025's checks (an object, a status in
//      the list, a claim with evidence) so a state the database refuses cannot
//      pass here.
//   9. At 375 px the new chip and control do not collapse the file name.
//
// Run: node test-e2e-acquisition-abstraction.js
// ============================================================================
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
let pw; try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }

const ROOT = __dirname, PORT = 8933;
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

// The Supabase stand-in, with migration 024's rules AND migration 025's.
const DB = `
(function(){
  var U = { id: '${UID}', email: 'pm@example.com' };
  var STORE = { acquisition_reviews: [], acquisition_documents: [],
                acquisition_document_families: [], properties: [], tenants: [] };
  var _seq = 0;
  window.__dbCalls = [];
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
  var DEFAULTS = {
    acquisition_documents: {
      intake_kind: 'other', parsing_status: 'pending', used_pdf_direct: false,
      doc_type_status: 'unclassified', family_status: 'unfiled', classification_history: [],
      abstracted_fields: {}, abstraction_status: 'pending', abstraction_model: null, abstracted_at: null,
    },
    acquisition_document_families: { family_kind: 'lease' },
  };
  function withDefaults(name, row) {
    var d = DEFAULTS[name] || {};
    for (var k in d) if (row[k] === undefined) row[k] = Array.isArray(d[k]) ? d[k].slice() : (d[k] && typeof d[k] === 'object' ? {} : d[k]);
    return row;
  }
  // 024's trigger and 025's checks.
  function coherence(row) {
    if (row.family_id == null && row.family_status && row.family_status !== 'unfiled') {
      row.family_status = 'unfiled'; row.family_source = null;
    }
    var claims = (row.doc_type_status === 'confirmed' || row.doc_type_status === 'corrected'
                  || row.family_status === 'confirmed' || row.relationship_status === 'confirmed');
    if (claims && !row.confirmed_by) return 'a confirmed classification must name who confirmed it';
    if ('abstracted_fields' in row) {
      var ev = row.abstracted_fields;
      if (!ev || typeof ev !== 'object' || Array.isArray(ev)) return 'acq_docs_abstracted_fields_is_object_check';
    }
    if ('abstraction_status' in row) {
      if (['pending','success','partial','failed','skipped'].indexOf(row.abstraction_status) < 0) return 'acq_docs_abstraction_status_check';
      if ((row.abstraction_status === 'success' || row.abstraction_status === 'partial')
          && !(row.abstracted_fields && ('fields' in row.abstracted_fields) && row.abstracted_at)) return 'acq_docs_abstraction_coherent_check';
    }
    return null;
  }

  function q(name) {
    var filters = [], pending = null, sel = null, ord = null;
    var owned = (name === 'acquisition_documents' || name === 'acquisition_document_families');
    function rows() {
      var out = tbl(name).filter(function (r) { return filters.every(function (f) { return r[f[0]] === f[1]; }); });
      if (owned) out = out.filter(function (r) { return r.user_id === U.id; });
      if (ord) out = out.slice().sort(function (a, b) {
        var x = a[ord[0]], y = b[ord[0]];
        return (x === y ? 0 : (x > y ? 1 : -1)) * (ord[1] ? 1 : -1);
      });
      return out;
    }
    var myCall = null;
    function record(op, extra) {
      var c = { table: name, op: op, select: sel, order: ord, filters: filters.slice() };
      for (var k in (extra || {})) c[k] = extra[k];
      window.__dbCalls.push(c); myCall = c; return c;
    }
    function run() {
      if (pending) {
        var changed = rows(), err = null;
        changed.forEach(function (r) {
          var next = clone(r); Object.assign(next, pending);
          var bad = coherence(next);
          if (bad) { err = bad; return; }
          Object.assign(r, next); r.updated_at = 'rev-' + (++_seq);
        });
        record('update');
        if (err) return P(refuse('23514', err));
        return P({ data: owned ? project(changed, sel) : changed, error: null });
      }
      record('select');
      return P({ data: owned ? project(rows(), sel) : rows(), error: null });
    }
    var api = {
      select: function (cols) { sel = (typeof cols === 'string' && cols) ? cols : null; return api; },
      eq: function (k, v) { filters.push([k, v]); return api; },
      neq: function () { return api; }, is: function () { return api; }, not: function () { return api; },
      in: function () { return api; },
      order: function (col, opts) { ord = [col, !opts || opts.ascending !== false]; return api; },
      limit: function () { return api; }, ilike: function () { return api; },
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
        var out = [], err = null;
        arr.forEach(function (x) {
          if (err) return;
          if (owned) {
            if (x.user_id !== U.id) { err = refuse('42501', 'row-level security'); return; }
            if (!tbl('acquisition_reviews').some(function (p2) { return p2.id === x.review_id && p2.user_id === x.user_id; })) {
              err = refuse('23503', 'review foreign key'); return;
            }
          }
          if (name === 'acquisition_documents') {
            if (x.family_id && !tbl('acquisition_document_families').some(function (f) {
              return f.id === x.family_id && f.user_id === x.user_id; })) { err = refuse('23503', 'family foreign key'); return; }
            if (x.parent_document_id && !tbl('acquisition_documents').some(function (d) {
              return d.id === x.parent_document_id && d.user_id === x.user_id; })) { err = refuse('23503', 'parent foreign key'); return; }
          }
          var i = -1;
          for (var n = 0; n < t.length; n++) {
            if (key.every(function (k) { return t[n][k] === x[k]; })) { i = n; break; }
          }
          var stamp = new Date(Date.now() + (++_seq)).toISOString();
          var next = (i >= 0) ? Object.assign(clone(t[i]), x)
                              : withDefaults(name, Object.assign({ id: 'row-' + (++_seq), created_at: stamp }, x));
          next.updated_at = stamp;
          var bad = coherence(next);
          if (bad) { err = refuse('23514', bad); return; }
          if (i >= 0) { Object.assign(t[i], next); out.push(t[i]); }
          else { t.push(next); out.push(next); }
        });
        record('upsert', { conflict: key.join(','), keys: Object.keys(arr[0] || {}) });
        if (err) return _wrap(P(err));
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
          return { data: owned ? project(out || r.data || [], sel) : (out || r.data), error: null };
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

function leaseText(tenant, marker) {
  return `LEASE AGREEMENT\nTenant: ${tenant}. Commencement Date: March 1, 2023. Expiration Date: February 29, 2028.\n`
    + `Tenant shall lease approximately 2,600 square feet. This is a Triple Net (NNN) lease.\n`
    + `CAM charges shall not increase more than 4% per annum. Pro rata share based on occupied square footage.\n`
    + `Tenant shall have no option to renew.\n`
    + (marker || '') + '\n' + 'This lease continues. '.repeat(60);
}

// What the abstraction task answers, from the text it is given. The lease
// answers with a value+quote, an explicit denial, an out-of-vocabulary key,
// and NOTHING for the rest — which is what a real reading of a short lease
// looks like. The word FAILME makes the call fail outright.
function abstractionFor(text) {
  if (/FAILME/.test(text)) return null;
  const fields = {
    cap:             { value: '4%', quote: 'CAM charges shall not increase more than 4% per annum', page: null, confidence: 0.93 },
    renewal_options: { value: 'Tenant shall have no option to renew', quote: 'Tenant shall have no option to renew.', page: null, confidence: 0.9 },
    tenant_name:     { value: (text.match(/Tenant: ([^.]+)\./) || [])[1] || null, quote: (text.match(/Tenant: [^.]+\./) || [])[0] || null, confidence: 0.95 },
    leased_sqft:     { value: '2,600', quote: 'approximately 2,600 square feet', page: 2, confidence: 0.9 },
    not_a_field:     { value: 'x', quote: 'y' },
  };
  if (/AMENDMENT/.test(text)) {
    return { fields: { cap: { value: '5%', quote: 'the cap is hereby amended to 5%', confidence: 0.9 } } };
  }
  return { fields };
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
  const errs = [];

  async function openPage(viewport, mobile) {
    const ctx = await browser.newContext({ viewport, isMobile: !!mobile, hasTouch: !!mobile, deviceScaleFactor: mobile ? 3 : 1 });
    const page = await ctx.newPage();
    page.on('pageerror', e => errs.push(String(e.message).split('\n')[0]));
    page.on('dialog', d => d.dismiss().catch(() => {}));
    await page.route('**cdnjs**',    r => r.fulfill({ status: 200, body: '/*x*/' }));
    await page.route('**jsdelivr**', r => r.fulfill({ status: 200, body: '/*x*/' }));
    await page.route('**fonts.g**',  r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await page.route('**/api/upload', async route => {
      const b = JSON.parse(route.request().postData() || '{}');
      const safe = `${UID}/${String(b.fileName || '').replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ url: `${b.bucket}/${safe}` }) });
    });
    await page.route('**/api/document-url', async route => {
      const b = JSON.parse(route.request().postData() || '{}');
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ url: 'https://stub/' + b.ref + '?token=signed', expiresIn: 300 }) });
    });
    return { ctx, page };
  }

  const { ctx, page } = await openPage({ width: 1280, height: 1000 }, false);

  // Every /api/claude call, by task, with what it was sent.
  const calls = { document_classification: [], acquisition_abstraction: [], other: [] };
  await page.route('**/api/claude', async route => {
    const post = route.request().postData() || '';
    let body = {}; try { body = JSON.parse(post); } catch (_) {}
    const text = (body.messages && body.messages[0] && body.messages[0].content) || '';
    if (body.task === 'document_classification') {
      calls.document_classification.push({ body, text });
      let r;
      if (/AMENDMENT/.test(text))      r = { docType: 'amendment', docDate: '2024-05-01', tenantName: 'Coastal Outfitters', confidence: 0.88, evidence: 'FIRST AMENDMENT TO LEASE' };
      else if (/RENT ROLL/.test(text)) r = { docType: 'rent_roll', docDate: '2024-06-30', tenantName: null, confidence: 0.94, evidence: 'RENT ROLL' };
      else                             r = { docType: 'original_lease', docDate: '2023-03-01', tenantName: 'Coastal Outfitters', confidence: 0.95, evidence: 'LEASE AGREEMENT' };
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(r) });
    }
    if (body.task === 'acquisition_abstraction') {
      calls.acquisition_abstraction.push({ body, text });
      const r = abstractionFor(text);
      if (!r) return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Anthropic API error' }) });
      r.__meta = { model: 'stub-abstraction-model', inputTokens: 1, outputTokens: 1 };
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(r) });
    }
    calls.other.push({ body, text });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(LEASE_FIXTURE) });
  });

  await page.addInitScript(DB);
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  console.log('\nAcquisition abstraction — what each document says (P4-1)\n' + '='.repeat(64));

  await page.evaluate(() => {
    const w = document.getElementById('obWelcomeModal');
    if (w && w.style.display !== 'none') { if (typeof obCloseWelcome === 'function') obCloseWelcome('skip'); else w.style.display = 'none'; }
  });
  await page.evaluate(async (rid) => {
    __store.acquisition_reviews.push({
      id: rid, user_id: 'u1', name: 'Harborview Retail Center', status: 'draft',
      created_at: '2026-03-01T10:00:00.000Z', updated_at: 'rev-0',
      data: { tenants: [], invoices: [], totalSqFt: 26000, documents: [], analysis: null },
    });
    await _loadAcqReviewsAndRender();
    selectAcquisitionReview(rid);
  }, REVIEW_ID);
  await page.waitForTimeout(500);

  const docs  = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__store.acquisition_documents)));
  const named = async n => (await docs()).find(r => r.file_name === n) || null;
  const settled = (n) => page.waitForFunction(
    (name) => { const r = window.__store.acquisition_documents.find(d => d.file_name === name);
                return r && r.parsing_status !== 'pending' && r.abstraction_status !== 'pending'; },
    n, { timeout: 45000 }).catch(() => {});
  const upload = async (name, text) => {
    await page.setInputFiles('#acqLeaseInput', [{ name, mimeType: 'text/plain', buffer: Buffer.from(text) }]);
    await settled(name);
    await page.waitForTimeout(600);
  };

  // ── 1 · a lease is read, and what it says is stored as evidence ──────────
  await upload('coastal-lease.txt', leaseText('Coastal Outfitters'));
  const lease = await named('coastal-lease.txt');
  check('the lease was read for its terms', !!lease && lease.abstraction_status === 'success',
        lease ? String(lease.abstraction_status) : 'no row');
  check('with the model and the time it was read', !!lease && lease.abstraction_model === 'stub-abstraction-model' && /^\d{4}-/.test(String(lease.abstracted_at)),
        lease ? `${lease.abstraction_model} / ${lease.abstracted_at}` : '');
  const ev = lease && lease.abstracted_fields;
  check('the evidence carries every one of the 27 fields and nothing else',
        !!ev && ev.schemaVersion === 1 && ev.fields && Object.keys(ev.fields).length === 27 && !('not_a_field' in ev.fields),
        ev ? `${Object.keys(ev.fields || {}).length} fields, schema ${ev.schemaVersion}` : 'no evidence');
  check('a term the lease states carries its value AND its verbatim clause',
        !!ev && ev.fields.cap.value === 4 && /not increase more than 4%/.test(ev.fields.cap.quote) && ev.fields.cap.confidence === 0.93,
        ev ? JSON.stringify(ev.fields.cap) : '');
  check('a term the lease does NOT address is null and null — not zero, not false, not ""',
        !!ev && ['expense_stop', 'guaranty_limit', 'audit_rights', 'co_tenancy', 'tenant_improvement_allowance']
          .every(f => ev.fields[f].value === null && ev.fields[f].quote === null),
        ev ? JSON.stringify({ expense_stop: ev.fields.expense_stop, audit_rights: ev.fields.audit_rights }) : '');
  check('a term the lease explicitly DENIES is a value, with the clause that denies it',
        !!ev && ev.fields.renewal_options.value === 'Tenant shall have no option to renew'
          && ev.fields.renewal_options.quote === 'Tenant shall have no option to renew.',
        ev ? JSON.stringify(ev.fields.renewal_options) : '');
  check('a number arrives as a number, a page as a page',
        !!ev && ev.fields.leased_sqft.value === 2600 && ev.fields.leased_sqft.page === 2,
        ev ? JSON.stringify(ev.fields.leased_sqft) : '');

  check('the task was asked ONCE for the lease, from its stored text, after classification',
        calls.acquisition_abstraction.length === 1 && /LEASE AGREEMENT/.test(calls.acquisition_abstraction[0].text)
          && calls.document_classification.length === 1,
        `${calls.acquisition_abstraction.length} abstraction, ${calls.document_classification.length} classification`);
  check('told the document type as context, and not to read terms from the file name',
        /Document type \(as classified\): original_lease/.test(calls.acquisition_abstraction[0]?.text || '')
          && /do not read terms from it/.test(calls.acquisition_abstraction[0]?.text || ''),
        (calls.acquisition_abstraction[0]?.text || '').split('\n').slice(0, 2).join(' | '));
  check('and no system prompt travelled from the browser',
        calls.acquisition_abstraction.every(c => c.body.system === undefined),
        'body keys: ' + Object.keys(calls.acquisition_abstraction[0]?.body || {}).join(', '));

  // The write itself: the four columns together, in one upsert, under the
  // owner's id, and nothing but those plus identity.
  const absWrites = await page.evaluate(() => window.__dbCalls.filter(c => c.op === 'upsert' && c.keys && c.keys.indexOf('abstracted_fields') >= 0));
  check('the evidence is written in ONE upsert with its status, model and time',
        absWrites.length === 1 && ['abstraction_status', 'abstraction_model', 'abstracted_at'].every(k => absWrites[0].keys.indexOf(k) >= 0),
        absWrites[0] ? absWrites[0].keys.join(', ') : 'no such write');
  check('that write names the signed-in owner and touches no classification column',
        absWrites.length === 1 && absWrites[0].keys.indexOf('user_id') >= 0
          && !['doc_type', 'doc_type_status', 'family_id', 'confirmed_by'].some(k => absWrites[0].keys.indexOf(k) >= 0),
        absWrites[0] ? absWrites[0].keys.join(', ') : '');
  const statusWrites = await page.evaluate(() => window.__dbCalls.filter(c => c.op === 'upsert' && c.keys && c.keys.indexOf('abstraction_status') >= 0).length);
  check('and the lease’s abstraction status was written exactly once — never `skipped` on the way to being read',
        statusWrites === 1, `${statusWrites} status write(s)`);

  // ── 2 · nothing was written back ─────────────────────────────────────────
  const tenants = await page.evaluate(() => JSON.parse(JSON.stringify(_acqTenants.map(t => ({ tenant_name: t.tenant_name, cap: t.cap, renewal_options: t.renewal_options })))));
  check('the tenant the extraction produced is what lease_extraction returned — the abstraction wrote nothing into it',
        tenants.length === 1 && tenants[0].tenant_name === 'Coastal Outfitters' && tenants[0].cap === 4
          && tenants[0].renewal_options === '1 x 5 year option',
        JSON.stringify(tenants));
  const reviewTenants = await page.evaluate(() => JSON.parse(JSON.stringify((__store.acquisition_reviews[0].data || {}).tenants || [])));
  check('and the review record holds no abstraction', !JSON.stringify(reviewTenants).includes('abstracted'), '');

  // ── 3 · a rent roll is skipped ───────────────────────────────────────────
  await upload('rent-roll-2024.txt', 'RENT ROLL\nAs of June 30, 2024\n' + 'Suite 100 Coastal Outfitters 2600 sf. '.repeat(30));
  const rr = await named('rent-roll-2024.txt');
  check('a rent roll is `skipped` — a true statement, not a promise',
        !!rr && rr.doc_type === 'rent_roll' && rr.abstraction_status === 'skipped', rr ? `${rr.doc_type} / ${rr.abstraction_status}` : 'no row');
  check('with nothing claimed about its terms', !!rr && JSON.stringify(rr.abstracted_fields) === '{}' && rr.abstracted_at === null,
        rr ? JSON.stringify(rr.abstracted_fields) : '');
  check('and the task was NOT asked', calls.acquisition_abstraction.length === 1, String(calls.acquisition_abstraction.length));

  // ── 4 · a failed read is failed, and costs nothing ───────────────────────
  await upload('harbor-lease.txt', leaseText('Harbor Cafe', 'FAILME'));
  const failed = await named('harbor-lease.txt');
  check('a document the task could not read is `failed`',
        !!failed && failed.abstraction_status === 'failed', failed ? String(failed.abstraction_status) : 'no row');
  check('it is still stored, classified and filed — the failure cost the review nothing',
        !!failed && failed.parsing_status === 'success' && failed.doc_type === 'original_lease' && !!failed.storage_path,
        failed ? `${failed.parsing_status} / ${failed.doc_type} / ${failed.storage_path ? 'stored' : 'not stored'}` : '');
  check('with nothing claimed', !!failed && JSON.stringify(failed.abstracted_fields) === '{}' && failed.abstracted_at === null, '');

  // ── 5 · corrections ──────────────────────────────────────────────────────
  const before5 = calls.acquisition_abstraction.length;
  await page.evaluate((id) => acqSetDocType(id, 'amendment'), rr.id);
  await page.waitForFunction((id) => { const r = window.__store.acquisition_documents.find(d => d.id === id);
                                       return r && r.abstraction_status !== 'skipped'; }, rr.id, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(400);
  const nowAmd = await named('rent-roll-2024.txt');
  check('correcting a rent roll INTO an amendment reads it for its terms',
        calls.acquisition_abstraction.length === before5 + 1 && !!nowAmd && nowAmd.doc_type === 'amendment',
        `${calls.acquisition_abstraction.length - before5} new call, type ${nowAmd && nowAmd.doc_type}`);
  const textReads = await page.evaluate(() => window.__dbCalls.filter(c => c.op === 'select' && c.select === 'id, extracted_text')
                                                 .map(c => c.filters.map(f => f[0]).join('+')));
  check('from the text already on its row — read back by id under the owner, not re-uploaded',
        /RENT ROLL/.test(calls.acquisition_abstraction[before5]?.text || '') && textReads.some(f => /id/.test(f) && /user_id/.test(f)),
        'text reads filtered on: ' + (textReads.join(' | ') || 'none'));
  check('and told its NEW type as context', /Document type \(as classified\): amendment/.test(calls.acquisition_abstraction[before5]?.text || ''), '');
  check('the reading is stored', !!nowAmd && nowAmd.abstraction_status === 'success' && nowAmd.abstracted_fields.fields
          && nowAmd.abstracted_fields.fields.cap.value === 4,
        nowAmd ? `${nowAmd.abstraction_status}` : '');

  // Out of the family again.
  await page.evaluate((id) => acqSetDocType(id, 'rent_roll'), rr.id);
  await page.waitForFunction((id) => { const r = window.__store.acquisition_documents.find(d => d.id === id);
                                       return r && r.abstraction_status === 'skipped'; }, rr.id, { timeout: 15000 }).catch(() => {});
  const backOut = await named('rent-roll-2024.txt');
  check('correcting it back OUT to a rent roll marks it `skipped`',
        !!backOut && backOut.abstraction_status === 'skipped', backOut ? String(backOut.abstraction_status) : '');
  check('and leaves the evidence it had in place — nothing is destroyed',
        !!backOut && backOut.abstracted_fields && backOut.abstracted_fields.fields && backOut.abstracted_fields.fields.cap.value === 4,
        backOut ? JSON.stringify(Object.keys(backOut.abstracted_fields || {})) : '');
  check('without asking the task again', calls.acquisition_abstraction.length === before5 + 1, String(calls.acquisition_abstraction.length));

  // A correction from one family type to another does not re-read.
  const before5b = calls.acquisition_abstraction.length;
  await page.evaluate((id) => acqSetDocType(id, 'renewal'), lease.id);
  await page.waitForTimeout(600);
  check('a correction from one lease-family type to another does not re-read — the terms are the same words',
        calls.acquisition_abstraction.length === before5b && (await named('coastal-lease.txt')).abstraction_status === 'success',
        String(calls.acquisition_abstraction.length - before5b) + ' new calls');

  // ── 6 · Read terms, on a failed row ──────────────────────────────────────
  // The retry succeeds now: the FAILME marker is in the stored text, so the
  // stand-in is switched to answer it.
  const before6 = calls.acquisition_abstraction.length;
  await page.unroute('**/api/claude');
  await page.route('**/api/claude', async route => {
    const post = route.request().postData() || '';
    let body = {}; try { body = JSON.parse(post); } catch (_) {}
    const text = (body.messages && body.messages[0] && body.messages[0].content) || '';
    if (body.task === 'acquisition_abstraction') {
      calls.acquisition_abstraction.push({ body, text });
      const r = abstractionFor(text.replace('FAILME', ''));
      r.__meta = { model: 'stub-abstraction-model' };
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(r) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(LEASE_FIXTURE) });
  });
  const hadButton = await page.evaluate((id) => !!document.querySelector(`.acq-doc-reabstract[data-doc-id="${id}"]`), failed.id);
  check('a failed row offers "Read terms"', hadButton, hadButton ? 'control present' : 'control absent');
  await page.click(`.acq-doc-reabstract[data-doc-id="${failed.id}"]`);
  await page.waitForFunction((id) => { const r = window.__store.acquisition_documents.find(d => d.id === id);
                                       return r && r.abstraction_status === 'success'; }, failed.id, { timeout: 15000 }).catch(() => {});
  const retried = await named('harbor-lease.txt');
  check('clicking it reads the document again from its stored text',
        calls.acquisition_abstraction.length === before6 + 1 && /Harbor Cafe/.test(calls.acquisition_abstraction[before6]?.text || ''),
        `${calls.acquisition_abstraction.length - before6} new call`);
  check('and the row is now read', !!retried && retried.abstraction_status === 'success'
          && retried.abstracted_fields.fields.tenant_name.value === 'Harbor Cafe',
        retried ? `${retried.abstraction_status} / ${retried.abstracted_fields.fields && retried.abstracted_fields.fields.tenant_name.value}` : '');
  const buttonGone = await page.evaluate((id) => !document.querySelector(`.acq-doc-reabstract[data-doc-id="${id}"]`), failed.id);
  check('a row already read no longer offers it', buttonGone, buttonGone ? 'control gone' : 'control still present');

  // ── 7 · the panel ────────────────────────────────────────────────────────
  const panel = await page.evaluate(() => {
    const rows = [].slice.call(document.querySelectorAll('#acqDocsList .acq-doc-row'));
    return rows.map(r => ({
      name: (r.querySelector('.acq-doc-name') || {}).innerText || '',
      type: r.getAttribute('data-doc-type'),
      terms: (r.querySelector('.acq-doc-terms') || {}).innerText || null,
      termsState: (r.querySelector('.acq-doc-terms') || { getAttribute: () => null }).getAttribute('data-abstraction'),
      readBtn: !!r.querySelector('.acq-doc-reabstract'),
      status: (r.querySelector('.acq-doc-status') || {}).innerText || '',
    }));
  });
  const pLease = panel.find(r => /coastal-lease/.test(r.name));
  const pRR    = panel.find(r => /rent-roll/.test(r.name));
  check('a read lease says so on its row', !!pLease && pLease.terms === 'Terms read' && pLease.termsState === 'success',
        pLease ? `${pLease.terms} / ${pLease.termsState}` : 'row missing');
  check('the parsing status is still there beside it', !!pLease && /Read/.test(pLease.status), pLease ? pLease.status : '');
  check('a rent roll says NOTHING about terms — it has none', !!pRR && pRR.terms === null && !pRR.readBtn,
        pRR ? `${pRR.terms} / button ${pRR.readBtn}` : 'row missing');

  // ── 8 · the stand-in refuses what migration 025 refuses ──────────────────
  const refusals = await page.evaluate(async () => {
    const mine = __store.acquisition_documents[0];
    const base = { reviewId: mine.review_id, intakeId: mine.intake_id, fileName: mine.file_name };
    const a = await _acqSaveDocument({ ...base, abstractionStatus: 'success', abstractedFields: { fields: {} } }); // no timestamp — refused by the module
    const before = window.__dbRefusals.length;
    // Straight to the client, past the module: 025's own checks must catch it.
    const { data: { user } } = await db.auth.getUser();
    const r1 = await db.from('acquisition_documents').upsert({ review_id: mine.review_id, user_id: user.id, intake_id: mine.intake_id, file_name: mine.file_name,
      abstraction_status: 'success', abstracted_fields: {}, abstracted_at: new Date().toISOString() }, { onConflict: 'review_id,intake_id' });
    const r2 = await db.from('acquisition_documents').upsert({ review_id: mine.review_id, user_id: user.id, intake_id: mine.intake_id, file_name: mine.file_name,
      abstraction_status: 'done' }, { onConflict: 'review_id,intake_id' });
    const r3 = await db.from('acquisition_documents').upsert({ review_id: mine.review_id, user_id: user.id, intake_id: mine.intake_id, file_name: mine.file_name,
      abstracted_fields: [1] }, { onConflict: 'review_id,intake_id' });
    return { moduleRefused: a === null, dbRefusals: window.__dbRefusals.slice(before).map(r => r.message),
             still: __store.acquisition_documents[0].abstraction_status };
  });
  check('the module refuses a claim of success with no timestamp before the database sees it', refusals.moduleRefused, '');
  check('the stand-in refuses success-with-nothing, a status outside the list, and a non-object — as 025 does',
        refusals.dbRefusals.length === 3 && /coherent/.test(refusals.dbRefusals[0]) && /status_check/.test(refusals.dbRefusals[1]) && /is_object/.test(refusals.dbRefusals[2]),
        refusals.dbRefusals.join(' | '));
  check('and the row is untouched by any of them', refusals.still === 'success', refusals.still);

  check('no uncaught errors across the walk', errs.length === 0, errs.slice(0, 3).join(' | ') || 'clean');
  // The rows as the walk left them, taken BEFORE the context closes — a read
  // after it would fail quietly and the phone section would measure nothing.
  const store = await page.evaluate(() => JSON.parse(JSON.stringify(window.__store)));
  await ctx.close();

  // ── 9 · at 375px the chip and the control do not collapse the name ───────
  {
    const { ctx: mctx, page: mpage } = await openPage({ width: 375, height: 667 }, true);
    await mpage.route('**/api/claude', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
    await mpage.addInitScript(DB);
    await mpage.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
    await mpage.waitForTimeout(2200);
    const m = await mpage.evaluate(({ rid, docsIn }) => {
      const w = document.getElementById('obWelcomeModal');
      if (w && w.style.display !== 'none') { if (typeof obCloseWelcome === 'function') obCloseWelcome('skip'); else w.style.display = 'none'; }
      _activeAcqId = rid;
      _acqDocs.set(rid, docsIn);
      _acqFamilies.set(rid, []);
      _acqDocsUnavailable = false;
      _renderAcqDocuments();
      for (let el = document.getElementById('acqDocsList'); el && el !== document.body; el = el.parentElement) {
        if (getComputedStyle(el).display === 'none') el.style.display = 'block';
        if (getComputedStyle(el).visibility === 'hidden') el.style.visibility = 'visible';
      }
      const panel = document.getElementById('acqDocsList');
      const rows = [].slice.call(panel.querySelectorAll('.acq-doc-row'));
      return {
        panelWidth: panel.clientWidth, scrollWidth: panel.scrollWidth,
        rows: rows.map(r => {
          const name = r.querySelector('.acq-doc-name'); const nb = name.getBoundingClientRect();
          const cs = getComputedStyle(name); const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2;
          const btn = r.querySelector('.acq-doc-reabstract');
          return { name: name.textContent.trim(), nameWidth: Math.round(nb.width), lines: Math.round(nb.height / lh),
                   hasTerms: !!r.querySelector('.acq-doc-terms'), hasBtn: !!btn,
                   btnRight: btn ? Math.round(btn.getBoundingClientRect().right) : 0 };
        }),
      };
    }, { rid: REVIEW_ID, docsIn: store.acquisition_documents.map(d => ({ ...d, abstraction_status: d.file_name === 'harbor-lease.txt' ? 'failed' : d.abstraction_status })) });
    check('375px: the panel is laid out', m.panelWidth > 0, `panel ${m.panelWidth}px`);
    check('375px: the walk’s documents all render', m.rows.length === store.acquisition_documents.length && m.rows.length >= 3, `${m.rows.length} rows`);
    check('375px: the term chip is on the lease rows', m.rows.filter(r => r.hasTerms).length >= 2, `${m.rows.filter(r => r.hasTerms).length} chips`);
    check('375px: a failed row shows the Read terms control', m.rows.some(r => r.hasBtn), `${m.rows.filter(r => r.hasBtn).length} control(s)`);
    check('375px: the file name column keeps usable width with the chip and control present',
          m.rows.every(r => r.nameWidth >= 150), m.rows.map(r => r.nameWidth + 'px').join(', '));
    check('375px: names read on a couple of lines', m.rows.every(r => r.lines <= 3), m.rows.map(r => r.lines).join(', '));
    check('375px: nothing overflows the panel', m.scrollWidth <= m.panelWidth + 1 && m.rows.every(r => r.btnRight <= m.panelWidth + 24),
          `content ${m.scrollWidth}px in ${m.panelWidth}px`);
    await mctx.close();
  }

  await browser.close(); srv.close();

  const failedChecks = results.filter(r => !r.ok);
  console.log('='.repeat(64));
  console.log(`${results.length - failedChecks.length}/${results.length} passed`);
  if (failedChecks.length) { console.log('FAILED:'); failedChecks.forEach(f => console.log('  - ' + f.name + ' :: ' + f.detail)); }
  process.exit(failedChecks.length ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(2); });
