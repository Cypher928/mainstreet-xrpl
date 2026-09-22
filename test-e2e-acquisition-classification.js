// test-e2e-acquisition-classification.js
// ============================================================================
// Acquisition Review Phase 1, increment P1-3 — walked in the real page.
//
// P1-2 proved every source is kept. This proves the pile becomes a structure
// without anything being invented on the way:
//
//   1. A lease is classified and its leasehold is created from it.
//   2. An amendment for the same tenant joins that family and says what it
//      amends — as a PROPOSAL, labelled unconfirmed on screen.
//   3. An amendment for a tenant with no lease on file is NOT placed. It sits
//      under "Needs review" with everything else nobody has decided.
//   4. A rent roll is classified and stays at review level — no family is
//      invented for it.
//   5. A document the model cannot read stays unclassified and visible.
//   6. Confirming a type records the person; correcting it records the
//      correction AND keeps the reading it replaced.
//   7. D-14 — re-uploading a file name already used keeps BOTH sources. The
//      older row stays on screen, marked replaced, and its original still
//      opens.
//   8. Cross-user isolation: none of the new rows crosses an owner.
//
// The Supabase stand-in enforces what migration 024 enforces — the owner
// policy, the composite keys on user_id, the coherence trigger and the
// confirmed_by rule — so a test cannot pass by writing a state the database
// would refuse.
//
// Run: node test-e2e-acquisition-classification.js
// ============================================================================
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
let pw; try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }

const ROOT = __dirname, PORT = 8927;
const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css',
               '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg',
               '.svg':'image/svg+xml', '.pdf':'application/pdf', '.txt':'text/plain' };

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail || '' });
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (detail ? '  — ' + detail : ''));
}

const UID       = 'u1';
const REVIEW_ID = 'ccccccc1-0000-4000-b000-000000000001';

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

  // Migration 024's NOT NULL DEFAULTs. Without these a column the caller did
  // not mention reads back undefined, which is a state the real table cannot
  // be in — and a test that accepts it would be proving nothing.
  var DEFAULTS = {
    acquisition_documents: {
      intake_kind: 'other', parsing_status: 'pending', used_pdf_direct: false,
      doc_type_status: 'unclassified', family_status: 'unfiled', classification_history: [],
    },
    acquisition_document_families: { family_kind: 'lease' },
  };
  function withDefaults(name, row) {
    var d = DEFAULTS[name] || {};
    for (var k in d) if (row[k] === undefined) row[k] = Array.isArray(d[k]) ? d[k].slice() : d[k];
    return row;
  }

  // Migration 024's coherence trigger, in the stand-in.
  function coherence(row) {
    if (row.family_id == null && row.family_status && row.family_status !== 'unfiled') {
      row.family_status = 'unfiled'; row.family_source = null;
    }
    var claims = (row.doc_type_status === 'confirmed' || row.doc_type_status === 'corrected'
                  || row.family_status === 'confirmed' || row.relationship_status === 'confirmed');
    if (claims && !row.confirmed_by) {
      return 'a confirmed classification must name who confirmed it';
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
            // RLS WITH CHECK.
            if (x.user_id !== U.id) { err = refuse('42501', 'row-level security'); return; }
            // The composite key to the review.
            if (!tbl('acquisition_reviews').some(function (p2) { return p2.id === x.review_id && p2.user_id === x.user_id; })) {
              err = refuse('23503', 'review foreign key'); return;
            }
          }
          if (name === 'acquisition_documents') {
            // The composite key to the family.
            if (x.family_id && !tbl('acquisition_document_families').some(function (f) {
              return f.id === x.family_id && f.user_id === x.user_id; })) {
              err = refuse('23503', 'family foreign key'); return;
            }
            // The composite key to the parent, and no self-reference.
            if (x.parent_document_id && !tbl('acquisition_documents').some(function (d) {
              return d.id === x.parent_document_id && d.user_id === x.user_id; })) {
              err = refuse('23503', 'parent foreign key'); return;
            }
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
        record('upsert', { conflict: key.join(',') });
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
    + (marker || '') + '\n' + 'This lease continues. '.repeat(60);
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

  const docs  = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__store.acquisition_documents)));
  const fams  = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__store.acquisition_document_families)));
  const named = async n => (await docs()).find(r => r.file_name === n) || null;

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

  // The classifier, answering from the text it is given — including "unknown",
  // which is the answer the prompt is written to make possible.
  const classifyCalls = [];
  await page.route('**/api/claude', async route => {
    const post = route.request().postData() || '';
    let body = {}; try { body = JSON.parse(post); } catch (_) {}
    const text = (body.messages && body.messages[0] && body.messages[0].content) || '';
    if (body.task === 'document_classification') {
      classifyCalls.push(text);
      // The tenant comes from the TEXT, in every branch. A stub that answers
      // the same tenant whatever it is handed files every document into one
      // leasehold and makes a walk prove nothing.
      const who = /Harbor Cafe/.test(text) ? 'Harbor Cafe' : 'Coastal Outfitters';
      let r;
      if (/AMENDMENT/.test(text))        r = { docType: 'amendment', docDate: '2024-05-01', tenantName: /Harbor Cafe/.test(text) ? 'Harbor Cafe' : 'Coastal Outfitters, LLC', confidence: 0.88, evidence: 'FIRST AMENDMENT TO LEASE' };
      else if (/SIDE LETTER/.test(text)) r = { docType: 'side_letter', docDate: '2024-07-01', tenantName: who, confidence: 0.90, evidence: 'SIDE LETTER' };
      else if (/RENT ROLL/.test(text))   r = { docType: 'rent_roll', docDate: '2024-06-30', tenantName: null, confidence: 0.94, evidence: 'RENT ROLL' };
      else if (/ILLEGIBLE/.test(text))   r = { docType: 'unknown', docDate: null, tenantName: null, confidence: 0.12, evidence: null };
      else                               r = { docType: 'original_lease', docDate: '2023-03-01', tenantName: who, confidence: 0.95, evidence: 'LEASE AGREEMENT' };
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(r) });
    }
    // LEASE EXTRACTION reads the document in front of it, so the stub must
    // too. It used to answer `Coastal Outfitters` for every upload, which meant
    // a Harbor document "produced" a Coastal tenant — a thing that cannot
    // happen in production, and one that hid a whole class of bug: `produced_id`
    // names the tenant THIS document was read to name, and Issue B's family
    // step uses it when the terms reading has not landed.
    const t = /Harbor Cafe/.test(text) ? 'Harbor Cafe' : 'Coastal Outfitters';
    return route.fulfill({ status: 200, contentType: 'application/json',
                           body: JSON.stringify({ ...LEASE_FIXTURE, tenant_name: t }) });
  });

  await page.addInitScript(DB);
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  console.log('\nAcquisition classification, families and versions\n' + '='.repeat(64));

  await page.evaluate(() => {
    window.__toasts = [];
    const orig = window.showToast;
    window.showToast = function (m, o) { window.__toasts.push(String(m)); return orig ? orig(m, o) : undefined; };
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

  const upload = async (name, text) => {
    await page.setInputFiles('#acqLeaseInput', [{ name, mimeType: 'text/plain', buffer: Buffer.from(text) }]);
    await page.waitForFunction(
      (n) => { const r = window.__store.acquisition_documents.find(d => d.file_name === n);
               return r && r.parsing_status !== 'pending'; },
      name, { timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(700);
  };

  // ── 1 · a lease is classified and begins its leasehold ───────────────────
  await upload('coastal-lease.txt', leaseText('Coastal Outfitters'));
  const lease = await named('coastal-lease.txt');
  check('the lease is classified', !!lease && lease.doc_type === 'original_lease', lease ? String(lease.doc_type) : 'no row');
  check('as a PROPOSAL, not a fact', !!lease && lease.doc_type_status === 'proposed' && lease.doc_type_source === 'ai',
        lease ? `${lease.doc_type_status} / ${lease.doc_type_source}` : '');
  check('with the confidence and date it was read with',
        !!lease && lease.doc_type_confidence === 0.95 && lease.doc_date === '2023-03-01',
        lease ? `${lease.doc_type_confidence} / ${lease.doc_date}` : '');
  check('and nobody is recorded as having confirmed it',
        !!lease && !lease.confirmed_by, lease ? String(lease.confirmed_by) : '');

  const families1 = await fams();
  check('a leasehold was created from it', families1.length === 1, JSON.stringify(families1.map(f => f.label)));
  check('named for the tenant', families1[0] && /Coastal Outfitters/.test(families1[0].label), families1[0] && families1[0].label);
  check('and the lease is filed in it, as a proposal',
        !!lease && lease.family_id === families1[0].id && lease.family_status === 'proposed',
        lease ? `${lease.family_id} / ${lease.family_status}` : '');

  check('the classifier was given the stored text, not the file again',
        classifyCalls.length === 1 && /LEASE AGREEMENT/.test(classifyCalls[0]), String(classifyCalls.length));
  check('and told not to classify from the file name',
        /do not classify from it/i.test(classifyCalls[0] || ''), 'context line missing');

  // ── 2 · an amendment joins the family and says what it amends ────────────
  await upload('coastal-amendment.txt', 'FIRST AMENDMENT TO LEASE\nTenant: Coastal Outfitters, LLC.\n' + leaseText('Coastal Outfitters'));
  const amd = await named('coastal-amendment.txt');
  check('the amendment is classified as an amendment', !!amd && amd.doc_type === 'amendment', amd ? String(amd.doc_type) : 'no row');
  check('it joins the SAME family — the company form is not a different tenant',
        !!amd && !!lease && amd.family_id === lease.family_id, amd ? String(amd.family_id) : '');
  check('and no second family was invented', (await fams()).length === 1, String((await fams()).length));
  check('it names the lease it amends', !!amd && amd.parent_document_id === lease.id && amd.relationship === 'amends',
        amd ? `${amd.relationship} → ${amd.parent_document_id}` : '');
  check('as a proposal, like everything else the model decided',
        !!amd && amd.relationship_status === 'proposed', amd ? String(amd.relationship_status) : '');

  // ── 3 · an amendment with no lease on file is NOT placed ─────────────────
  await upload('harbor-amendment.txt', 'FIRST AMENDMENT TO LEASE\nTenant: Harbor Cafe.\n' + leaseText('Harbor Cafe'));
  const orphan = await named('harbor-amendment.txt');
  check('an amendment whose tenant has no lease on file is classified',
        !!orphan && orphan.doc_type === 'amendment', orphan ? String(orphan.doc_type) : 'no row');
  check('but it is NOT filed anywhere — nothing was guessed',
        !!orphan && !orphan.family_id && orphan.family_status === 'unfiled',
        orphan ? `${orphan.family_id} / ${orphan.family_status}` : '');
  check('and it is NOT given a parent',
        !!orphan && !orphan.parent_document_id, orphan ? String(orphan.parent_document_id) : '');
  check('no family was created for it either', (await fams()).length === 1, String((await fams()).length));

  // ── 4 · a rent roll stays at review level ────────────────────────────────
  await upload('rent-roll-2024.txt', 'RENT ROLL\nAs of June 30, 2024\n' + 'Suite 100 Coastal Outfitters 2600 sf. '.repeat(30));
  const rr = await named('rent-roll-2024.txt');
  check('a rent roll is classified as a rent roll', !!rr && rr.doc_type === 'rent_roll', rr ? String(rr.doc_type) : 'no row');
  check('and no leasehold is invented for it', !!rr && !rr.family_id, rr ? String(rr.family_id) : '');
  check('still only one family exists', (await fams()).length === 1, String((await fams()).length));

  // ── 5 · a document nobody can read stays unclassified ────────────────────
  await upload('scan-illegible.txt', 'ILLEGIBLE\n' + 'x y z '.repeat(80));
  const unk = await named('scan-illegible.txt');
  check('an unreadable document is stored as unknown, not as a guess',
        !!unk && unk.doc_type === 'unknown', unk ? String(unk.doc_type) : 'no row');
  check('and is left unclassified rather than proposed',
        !!unk && unk.doc_type_status === 'unclassified', unk ? String(unk.doc_type_status) : '');

  // ── the panel ────────────────────────────────────────────────────────────
  const panel = await page.evaluate(() => {
    const el = document.getElementById('acqDocsList');
    const groups = [].slice.call(el.querySelectorAll('.acq-doc-group')).map(g => ({
      title: (g.querySelector('.acq-doc-group-title') || {}).innerText || '',
      cls: g.className,
      rows: [].slice.call(g.querySelectorAll('.acq-doc-row')).map(r => ({
        name: (r.querySelector('.acq-doc-name') || {}).innerText || '',
        klass: (r.querySelector('.acq-doc-class') || {}).innerText || '',
        unconfirmed: !!r.querySelector('.acq-doc-unconf'),
        rel: (r.querySelector('.acq-doc-rel') || {}).innerText || '',
        superseded: r.className.indexOf('superseded') >= 0,
        opens: !!r.querySelector('[data-doc-url]'),
      })),
    }));
    return { groups, text: el.innerText };
  });
  const needs = panel.groups.find(g => /needs-review/.test(g.cls));
  const family = panel.groups.find(g => /\bfamily\b/.test(g.cls));
  const review = panel.groups.find(g => /review-level/.test(g.cls));

  check('the panel groups by leasehold', !!family && /Coastal Outfitters/.test(family.title),
        panel.groups.map(g => g.title).join(' | '));
  check('the lease and its amendment are under it', !!family && family.rows.length === 2,
        family ? family.rows.map(r => r.name).join(', ') : '');
  check('the amendment sorts above the lease it changes — tier order',
        !!family && /amendment/.test(family.rows[0].name), family ? family.rows[0].name : '');
  check('each row says what the document is', !!family && family.rows.every(r => /Lease|Amendment/i.test(r.klass)),
        family ? family.rows.map(r => r.klass).join(', ') : '');
  check('and every unconfirmed reading is marked unconfirmed on screen',
        !!family && family.rows.every(r => r.unconfirmed), 'a proposal rendered as settled');
  check('the relationship is shown by the document it points at',
        !!family && /amends/.test(family.rows[0].rel) && /coastal-lease/.test(family.rows[0].rel),
        family ? family.rows[0].rel : '');
  check('what nobody placed is grouped first, for review',
        !!needs && panel.groups.indexOf(needs) === 0, panel.groups.map(g => g.title).join(' | '));
  check('the unplaced amendment and the unreadable scan are in it',
        !!needs && needs.rows.length === 2 && needs.rows.some(r => /harbor-amendment/.test(r.name))
        && needs.rows.some(r => /scan-illegible/.test(r.name)),
        needs ? needs.rows.map(r => r.name).join(', ') : '');
  check('the rent roll sits with the review\'s own documents',
        !!review && review.rows.length === 1 && /rent-roll/.test(review.rows[0].name),
        review ? review.rows.map(r => r.name).join(', ') : '');
  check('every document is still openable from the panel (ARCH §9)',
        panel.groups.every(g => g.rows.every(r => r.opens)), 'a stored document has no opener');

  // ── 6 · confirming and correcting ────────────────────────────────────────
  await page.evaluate((id) => acqConfirmDocType(id), lease.id);
  await page.waitForTimeout(400);
  const confirmed = await named('coastal-lease.txt');
  check('confirming records the person who confirmed it',
        !!confirmed && confirmed.doc_type_status === 'confirmed' && confirmed.confirmed_by === UID,
        confirmed ? `${confirmed.doc_type_status} / ${confirmed.confirmed_by}` : '');
  check('and the confirmation settles where it was filed too',
        !!confirmed && confirmed.family_status === 'confirmed', confirmed ? String(confirmed.family_status) : '');
  check('the trail records the confirmation as a separate act',
        !!confirmed && Array.isArray(confirmed.classification_history)
        && confirmed.classification_history.some(h => h.action === 'confirmed' && h.source === 'human'),
        confirmed ? JSON.stringify((confirmed.classification_history || []).map(h => h.action)) : '');

  await page.evaluate((id) => acqSetDocType(id, 'renewal'), amd.id);
  await page.waitForTimeout(400);
  const corrected = await named('coastal-amendment.txt');
  check('correcting a type records the correction',
        !!corrected && corrected.doc_type === 'renewal' && corrected.doc_type_status === 'corrected'
        && corrected.doc_type_source === 'human',
        corrected ? `${corrected.doc_type} / ${corrected.doc_type_status}` : '');
  check('and KEEPS the reading it replaced — the trail is appended, not rewritten',
        !!corrected && (corrected.classification_history || []).some(h => h.to === 'amendment' && h.source === 'ai')
        && (corrected.classification_history || []).some(h => h.from === 'amendment' && h.to === 'renewal'),
        corrected ? JSON.stringify((corrected.classification_history || []).map(h => h.from + '→' + h.to)) : '');
  check('the model\'s confidence is dropped with the reading it belonged to',
        !!corrected && corrected.doc_type_confidence === null, corrected ? String(corrected.doc_type_confidence) : '');

  // A type that no longer belongs to a leasehold must leave it.
  //
  // D-17 (P1-4 / P4-3) changed what happens to the RELATIONSHIP when it does.
  // P1-3 discarded the parent and the relationship outright. That destroyed a
  // fact — a document that amended a lease yesterday still amended it today —
  // so they are now preserved and flagged `needs_review` for a person. The
  // family still goes, which is what this check has always been about.
  await page.evaluate((id) => acqSetDocType(id, 'rent_roll'), amd.id);
  await page.waitForTimeout(400);
  const moved = await named('coastal-amendment.txt');
  check('a document corrected to a review-level type leaves the leasehold',
        !!moved && !moved.family_id && moved.family_status === 'unfiled',
        moved ? `${moved.family_id} / ${moved.family_status}` : '');
  check('but KEEPS the relationship it had, flagged for review (D-17)',
        !!moved && moved.parent_document_id === lease.id && moved.relationship === 'amends'
        && moved.relationship_status === 'needs_review',
        moved ? `${moved.relationship} → ${moved.parent_document_id} (${moved.relationship_status})` : '');
  check('and the flagging is recorded in the audit trail',
        !!moved && (moved.classification_history || []).some(h => h.action === 'needs_review' && h.field === 'relationship'),
        moved ? JSON.stringify((moved.classification_history || []).map(h => h.action)) : '');

  // ── 7 · D-14, in the browser ─────────────────────────────────────────────
  const beforeReupload = (await docs()).length;
  await upload('coastal-lease.txt', leaseText('Coastal Outfitters', 'SECOND COPY WITH A CORRECTION'));
  const all = await docs();
  const bothNamed = all.filter(r => r.file_name === 'coastal-lease.txt');
  check('re-uploading a used file name adds a row rather than replacing one',
        all.length === beforeReupload + 1 && bothNamed.length === 2,
        `${beforeReupload} → ${all.length}, ${bothNamed.length} of that name`);
  const olderRow = bothNamed.find(r => r.superseded_by_document_id);
  const newerRow = bothNamed.find(r => !r.superseded_by_document_id);
  check('the earlier upload is marked replaced by the newer one',
        !!olderRow && !!newerRow && olderRow.superseded_by_document_id === newerRow.id,
        olderRow ? String(olderRow.superseded_by_document_id) : 'nothing marked');
  check('and it KEEPS its own stored original — two files, two objects',
        !!olderRow && !!newerRow && olderRow.storage_path && newerRow.storage_path
        && olderRow.storage_path !== newerRow.storage_path,
        olderRow ? olderRow.storage_path.slice(-40) + ' vs ' + String(newerRow.storage_path).slice(-40) : '');
  check('it keeps the confirmation it was given, too — history is not undone',
        !!olderRow && olderRow.doc_type_status === 'confirmed' && olderRow.confirmed_by === UID,
        olderRow ? `${olderRow.doc_type_status} / ${olderRow.confirmed_by}` : '');
  check('the replacement inherits the family but NOT the confirmation',
        !!newerRow && newerRow.family_id === olderRow.family_id && newerRow.family_status === 'proposed',
        newerRow ? `${newerRow.family_id} / ${newerRow.family_status}` : '');

  const supersededPanel = await page.evaluate(() => {
    const rows = [].slice.call(document.querySelectorAll('#acqDocsList .acq-doc-row.superseded'));
    return rows.map(r => ({ text: r.innerText.replace(/\s+/g, ' '), opens: !!r.querySelector('[data-doc-url]') }));
  });
  check('the replaced upload is still on screen, marked replaced',
        supersededPanel.length === 1 && /replaced by a newer upload/i.test(supersededPanel[0].text),
        supersededPanel[0] ? supersededPanel[0].text.slice(0, 80) : 'not rendered');
  check('and its original still opens — the source did not leave the record',
        supersededPanel.length === 1 && supersededPanel[0].opens, 'no opener on the replaced row');

  // ── 7b · a leasehold can BEGIN from a human correction (Issue B) ─────────
  //
  // `harbor-amendment.txt` is the Pilot's exact state, reproduced: a correctly
  // classified lease-family document whose tenant has no lease on file. Before
  // this increment it sat unfiled forever — the AI may not start a leasehold
  // from an amendment (correct), and `acqSetDocType` ran no family step at all
  // (the gap). The review could hold real lease documents and render an empty
  // Lease Terms panel with nothing on screen to say why.
  const famsBefore = (await fams()).length;
  const orphanNow  = await named('harbor-amendment.txt');
  check('7b: the orphan amendment is still unfiled, as P1-3 left it',
        !!orphanNow && !orphanNow.family_id && orphanNow.family_status === 'unfiled',
        orphanNow ? `${orphanNow.family_id} / ${orphanNow.family_status}` : 'no row');

  const unfiledUI = await page.evaluate((id) => {
    const row = document.querySelector(`.acq-doc-row[data-doc-id="${id}"]`);
    if (!row) return null;
    const box = row.querySelector('.acq-doc-unfiled');
    return { why: box ? (box.querySelector('.acq-doc-unfiled-why') || {}).innerText || '' : null,
             hasBtn: !!row.querySelector('.acq-doc-begin'),
             btnText: (row.querySelector('.acq-doc-begin') || {}).innerText || '',
             family: row.getAttribute('data-family') };
  }, orphanNow.id);
  check('7b: the panel now SAYS it has no leasehold rather than saying nothing',
        !!unfiledUI && !!unfiledUI.why, unfiledUI ? String(unfiledUI.why).slice(0, 70) : 'no notice');
  check('7b: and offers the one action a person may take',
        !!unfiledUI && unfiledUI.hasBtn && /begins the leasehold/i.test(unfiledUI.btnText),
        unfiledUI ? unfiledUI.btnText : '');
  check('7b: the wording asks the person to confirm it belongs to this tenant\'s lease history',
        !!unfiledUI && /can begin a leasehold if you confirm/i.test(unfiledUI.why), unfiledUI ? unfiledUI.why : '');
  check('7b: and NEVER claims MainStreet decided it is the original lease',
        !!unfiledUI && !/original lease/i.test(unfiledUI.why), unfiledUI ? unfiledUI.why : '');

  const noBtnOnFiled = await page.evaluate((id) =>
    !document.querySelector(`.acq-doc-row[data-doc-id="${id}"] .acq-doc-begin`), lease.id);
  check('7b: a document already in a leasehold is offered nothing', noBtnOnFiled);
  const noBtnOnRentRoll = await page.evaluate((id) =>
    !document.querySelector(`.acq-doc-row[data-doc-id="${id}"] .acq-doc-begin`), rr.id);
  check('7b: nor is a rent roll — it belongs to the review, not to a lease', noBtnOnRentRoll);

  // 375px, on the real laid-out row — a notice and a control added to a row
  // that was already four flex children is exactly how P1-3 broke the file
  // name column, and a stylesheet reading would not have caught that.
  await page.setViewportSize({ width: 375, height: 667 });
  await page.waitForTimeout(150);
  const phone = await page.evaluate((id) => {
    const panel = document.getElementById('acqDocsList');
    const row   = document.querySelector(`.acq-doc-row[data-doc-id="${id}"]`);
    const box   = row && row.querySelector('.acq-doc-unfiled');
    const btn   = row && row.querySelector('.acq-doc-begin');
    const name  = row && row.querySelector('.acq-doc-name');
    const nb    = name && name.getBoundingClientRect();
    const cs    = name && getComputedStyle(name);
    const lh    = cs ? (parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2) : 0;
    const pr    = panel.getBoundingClientRect();
    return {
      panelWidth: panel.clientWidth, scrollWidth: panel.scrollWidth,
      docScroll: document.documentElement.scrollWidth,
      docClient: document.documentElement.clientWidth,
      noticeVisible: !!box && box.getBoundingClientRect().height > 0,
      btnWidth: btn ? Math.round(btn.getBoundingClientRect().width) : 0,
      btnRight: btn ? Math.round(btn.getBoundingClientRect().right) : 0,
      panelRight: Math.round(pr.right),
      nameWidth: nb ? Math.round(nb.width) : 0,
      nameLines: (nb && lh) ? Math.round(nb.height / lh) : 0,
      // Stacked, per the 680px rule, rather than squeezed onto one line.
      stacked: !!(box && btn &&
        Math.round(btn.getBoundingClientRect().top)
          >= Math.round(box.querySelector('.acq-doc-unfiled-why').getBoundingClientRect().bottom) - 2),
    };
  }, orphanNow.id);
  check('7b/375px: the notice and its control are visible', phone.noticeVisible && phone.btnWidth > 0,
        `button ${phone.btnWidth}px`);
  check('7b/375px: they stack instead of squeezing the button off the row', phone.stacked);
  check('7b/375px: the control stays inside the panel',
        phone.btnRight <= phone.panelRight + 1, `${phone.btnRight} vs ${phone.panelRight}`);
  check('7b/375px: the file name column still has usable width',
        phone.nameWidth >= 150, `${phone.nameWidth}px`);
  check('7b/375px: the name still reads on a couple of lines', phone.nameLines <= 3, String(phone.nameLines));
  check('7b/375px: the panel does not scroll sideways',
        phone.scrollWidth <= phone.panelWidth + 1, `${phone.scrollWidth} in ${phone.panelWidth}`);
  check('7b/375px: and the PAGE introduces no horizontal scroll',
        phone.docScroll <= phone.docClient + 1, `${phone.docScroll} vs ${phone.docClient}`);
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.waitForTimeout(150);

  // A second Harbor document, so the sibling offer has something to offer.
  await upload('harbor-side-letter.txt', 'SIDE LETTER\nTenant: Harbor Cafe, Inc.\n' + leaseText('Harbor Cafe'));
  const sideLetter = await named('harbor-side-letter.txt');
  check('7b: a second Harbor document is also unfiled beforehand',
        !!sideLetter && !sideLetter.family_id, sideLetter ? String(sideLetter.family_id) : 'no row');

  await page.click(`.acq-doc-row[data-doc-id="${orphanNow.id}"] .acq-doc-begin`);
  await page.waitForFunction((id) => {
    const r = window.__store.acquisition_documents.find(d => d.id === id);
    return r && r.family_id;
  }, orphanNow.id, { timeout: 15000 }).catch(() => {});

  const famsAfter = await fams();
  const begun     = await named('harbor-amendment.txt');
  check('7b: clicking it creates exactly ONE leasehold',
        famsAfter.length === famsBefore + 1, `${famsBefore} → ${famsAfter.length}`);
  const harborFam = famsAfter.find(f => /Harbor Cafe/.test(f.label || ''));
  check('7b: named for the tenant the document was READ to name — not for the file',
        !!harborFam && !/harbor-amendment/.test(harborFam.label), harborFam ? harborFam.label : 'not created');
  check('7b: the document is filed in it as CONFIRMED by a HUMAN — a person said it',
        !!begun && begun.family_id === harborFam.id && begun.family_status === 'confirmed'
        && begun.family_source === 'human',
        begun ? `${begun.family_status} / ${begun.family_source}` : '');
  check('7b: with an actor on the row, because 024 refuses a settled status naming nobody',
        !!begun && begun.confirmed_by === UID, begun ? String(begun.confirmed_by) : '');
  check('7b: its TYPE is untouched — an amendment that begins a leasehold is still an amendment',
        !!begun && begun.doc_type === 'amendment' && begun.doc_type_status === orphanNow.doc_type_status,
        begun ? `${begun.doc_type} / ${begun.doc_type_status}` : '');

  const begunHist = (begun.classification_history || []);
  check('7b: the history GREW — the earlier entries are all still there',
        begunHist.length === (orphanNow.classification_history || []).length + 1,
        `${(orphanNow.classification_history || []).length} → ${begunHist.length}`);
  check('7b: and the new entry says a human confirmed the family',
        begunHist.length > 0 && begunHist[begunHist.length - 1].field === 'family'
        && begunHist[begunHist.length - 1].action === 'confirmed'
        && begunHist[begunHist.length - 1].source === 'human',
        JSON.stringify(begunHist[begunHist.length - 1] || {}));
  check('7b: nothing rewrote what the AI had proposed earlier',
        JSON.stringify(begunHist.slice(0, -1)) === JSON.stringify(orphanNow.classification_history || []));

  const sl = await named('harbor-side-letter.txt');
  check('7b: the same-tenant document already on file is OFFERED the new leasehold',
        !!sl && sl.family_id === harborFam.id, sl ? String(sl.family_id) : '');
  check('7b: as a PROPOSAL by `ai` — two names agreeing is a machine reading it',
        !!sl && sl.family_status === 'proposed' && sl.family_source === 'ai',
        sl ? `${sl.family_status} / ${sl.family_source}` : '');
  check('7b: never auto-confirmed — each document is confirmed on its own',
        !!sl && sl.family_status !== 'confirmed');
  check('7b: and it got its own appended history entry, on its own row',
        !!sl && (sl.classification_history || []).some(h => h && h.field === 'family' && h.action === 'proposed'),
        JSON.stringify((sl.classification_history || []).map(h => h && h.action)));
  const coastalUntouched = await named('coastal-lease.txt');
  check('7b: a different tenant\'s lease was not swept in',
        !!coastalUntouched && coastalUntouched.family_id !== harborFam.id);
  const rrUntouched = await named('rent-roll-2024.txt');
  check('7b: and the rent roll is still review-level', !!rrUntouched && !rrUntouched.family_id);

  const goneUI = await page.evaluate((id) =>
    !document.querySelector(`.acq-doc-row[data-doc-id="${id}"] .acq-doc-begin`), orphanNow.id);
  check('7b: the control is gone once the leasehold exists', goneUI);

  // ── 7c · correcting INTO a lease type now files the document ─────────────
  const beforeCorrect = (await fams()).length;
  await page.evaluate((id) => acqSetDocType(id, 'renewal'), rr.id);
  await page.waitForFunction((id) => {
    const r = window.__store.acquisition_documents.find(d => d.id === id);
    return r && r.doc_type === 'renewal';
  }, rr.id, { timeout: 15000 }).catch(() => {});
  const correctedIn = await named('rent-roll-2024.txt');
  check('7c: a rent roll corrected to a renewal is now filed, not left unfiled',
        !!correctedIn && !!correctedIn.family_id, correctedIn ? String(correctedIn.family_id) : '');
  check('7c: into the leasehold whose tenant it names, as a PROPOSAL',
        !!correctedIn && correctedIn.family_status === 'proposed' && correctedIn.family_source === 'ai',
        correctedIn ? `${correctedIn.family_status} / ${correctedIn.family_source}` : '');
  check('7c: and no new leasehold was invented for it',
        (await fams()).length === beforeCorrect, String((await fams()).length));
  check('7c: the family entry is appended to its history, not written over it',
        !!correctedIn && (correctedIn.classification_history || []).some(h => h && h.field === 'family'),
        JSON.stringify((correctedIn.classification_history || []).map(h => h && h.field)));

  // ── 7d · D-17 still clears the family on the way OUT ─────────────────────
  await page.evaluate((id) => acqSetDocType(id, 'rent_roll'), rr.id);
  await page.waitForFunction((id) => {
    const r = window.__store.acquisition_documents.find(d => d.id === id);
    return r && r.doc_type === 'rent_roll';
  }, rr.id, { timeout: 15000 }).catch(() => {});
  const correctedOut = await named('rent-roll-2024.txt');
  check('7d: D-17 — correcting back OUT clears the leasehold again',
        !!correctedOut && !correctedOut.family_id && correctedOut.family_status === 'unfiled',
        correctedOut ? `${correctedOut.family_id} / ${correctedOut.family_status}` : '');
  check('7d: and the history still holds both acts, in order',
        !!correctedOut && (correctedOut.classification_history || []).length
          > (correctedIn.classification_history || []).length - 1,
        `${(correctedIn.classification_history || []).length} → ${(correctedOut.classification_history || []).length}`);

  // ── 8 · nothing crossed an owner ─────────────────────────────────────────
  const crossed = await page.evaluate(async () => {
    __store.acquisition_reviews.push({ id: 'other-review', user_id: 'someone-else', name: 'Theirs', status: 'draft', data: {} });
    __store.acquisition_document_families.push({ id: 'their-family', review_id: 'other-review', user_id: 'someone-else', label: 'Theirs' });
    const before = __store.acquisition_documents.length;
    const mine = __store.acquisition_documents[0];
    const r1 = await _acqSaveDocument({ reviewId: 'other-review', intakeId: 'ik-x', fileName: 'theirs.pdf' });
    const r2 = await _acqSaveDocument({ reviewId: mine.review_id, intakeId: mine.intake_id,
                                        fileName: mine.file_name, familyId: 'their-family', familyStatus: 'proposed', familySource: 'ai' });
    const fam = await _acqSaveFamily('other-review', { label: 'Sneaky' });
    return { r1: r1, r2: r2, fam: fam, added: __store.acquisition_documents.length - before,
             stillMine: __store.acquisition_documents[0].family_id };
  });
  check('a document on another owner\'s review is refused', crossed.r1 === null && crossed.added === 0,
        `${JSON.stringify(crossed.r1)} / ${crossed.added} added`);
  check('a document cannot be filed into another owner\'s family',
        crossed.r2 === null && crossed.stillMine !== 'their-family', String(crossed.stillMine));
  check('a family cannot be created on another owner\'s review', crossed.fam === null, JSON.stringify(crossed.fam));

  const refusals = await page.evaluate(() => window.__dbRefusals.map(r => r.code));
  check('and the database is what refused them, not a UI check',
        refusals.filter(c => c === '23503').length >= 2, refusals.join(', ') || 'none');

  check('no uncaught errors across the walk', errs.length === 0, errs.slice(0, 3).join(' | ') || 'clean');

  await ctx.close(); await browser.close(); srv.close();

  const failed = results.filter(r => !r.ok);
  console.log('='.repeat(64));
  console.log(`${results.length - failed.length}/${results.length} passed`);
  if (failed.length) { console.log('FAILED:'); failed.forEach(f => console.log('  - ' + f.name + ' :: ' + f.detail)); }
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(2); });
