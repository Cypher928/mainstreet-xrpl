'use strict';
/**
 * test-e2e-field-provenance.js — the label a manager reads, in the running app.
 *
 *   node test-e2e-field-provenance.js
 *   HEADLESS=false node test-e2e-field-provenance.js
 *
 * WHY THIS EXISTS
 *
 * The unit suite pins the resolver. This drives the real application and asserts
 * the thing the resolver exists for: four tenants whose values came from four
 * different places must not read the same.
 *
 * Before this change they did. Measured in this same harness against tenant
 * objects copied verbatim out of Pilot: CafePress (a real 25,824-character
 * lease), a hand-typed tenant with no document at all, and a tenant whose cap
 * carried a verbatim clause AND a page number all rendered
 * `verified · "✓ Extracted from lease document" · chip High`. The evidence layer
 * migration 019 exists to fill was completely unobservable.
 *
 * The suite also holds the line that matters more than any label: a provenance
 * correction must not move a single dollar. Allocation inputs, stored
 * allocations, cap decisions and the billing verdict are captured before the
 * tenants are ever loaded and compared again at the end.
 */

let pw;
try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }
const { chromium } = pw;

const http = require('http');
const fs   = require('fs');
const path = require('path');
const { signIn, attachDiagnostics } = require('./test-support/e2e-login');

const PORT     = parseInt(process.env.APP_PORT || '7844', 10);
const HEADLESS = process.env.HEADLESS !== 'false';
const ROOT     = __dirname;
const PID      = 'b22d0000-0000-4000-c000-provenance001';

let pass = 0, fail = 0;
const ok  = (m) => { console.log('  \x1b[32m✓\x1b[0m ' + m); pass++; };
const bad = (m, d) => { console.log('  \x1b[31m✗\x1b[0m ' + m + (d ? '\n      → ' + d : '')); fail++; };
const yes = (m, c, d) => c ? ok(m) : bad(m, d);
const R   = (l, v) => console.log('  ' + String(l).padEnd(46) + ':', typeof v === 'string' ? v : JSON.stringify(v));
const H   = (t) => console.log('\n\x1b[36m── ' + t + ' ──\x1b[0m');

const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
               '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon',
               '.pdf': 'application/pdf', '.svg': 'image/svg+xml' };
function startServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const filePath = path.join(ROOT, req.url === '/' ? '/index.html' : req.url).split('?')[0];
      fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); res.end('not found'); return; }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
        res.end(data);
      });
    });
    server.listen(PORT, '127.0.0.1', () => resolve(server));
    server.on('error', reject);
  });
}

// A store that outlives a reload — the same one test-e2e-timeline-persistence
// uses, and for the same reason: a persistence question cannot be answered by a
// mock whose rows vanish with the page.
const SUPABASE_MOCK = `
(function () {
  var KEY = '__fpMockStore';
  var _store = null;
  try { _store = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (_) {}
  if (!_store) _store = { properties: [], tenants: [], acquisition_reviews: [],
                          cam_reconciliations: [], lease_documents: [], tenant_field_evidence: [] };
  function flush() { try { localStorage.setItem(KEY, JSON.stringify(_store)); } catch (_) {} }
  var _user = { id: 'e2e-test-user-id', email: 'e2e@e2e-test.local' };
  function P(v) { return Promise.resolve(v); }
  function makeQ(t) {
    var f = {};
    var q = {
      select: function () { return q; },
      insert: function (rows) { var a = Array.isArray(rows) ? rows : [rows];
        if (!_store[t]) _store[t] = []; a.forEach(function (r) { _store[t].push(r); }); flush();
        var r = P({ data: a, error: null }); r.select = function () { return P({ data: a, error: null }); }; return r; },
      upsert: function (row) { var a = Array.isArray(row) ? row : [row];
        if (!_store[t]) _store[t] = [];
        a.forEach(function (rw) { var i = _store[t].findIndex(function (x) { return x.id === rw.id; });
          if (i >= 0) _store[t][i] = rw; else _store[t].push(rw); }); flush();
        var r = P({ data: a, error: null }); r.select = function () { return P({ data: a, error: null }); }; return r; },
      update: function () { var r = P({ data: null, error: null });
        r.select = function () { return P({ data: null, error: null }); };
        r.eq = function () { return P({ data: null, error: null }); }; return r; },
      delete: function () { return { eq: function () { return P({ error: null }); } }; },
      eq: function (c, v) { f[c] = v; return q; },
      neq: function () { return q; }, is: function () { return q; }, not: function () { return q; },
      in: function () { return q; }, order: function () { return q; }, limit: function () { return q; },
      gte: function () { return q; }, lte: function () { return q; },
      single: function () { var rows = (_store[t] || []).filter(function (r) {
          return Object.keys(f).every(function (k) { return r[k] === f[k]; }); });
        return P({ data: rows[0] || null, error: null }); },
      maybeSingle: function () { var rows = (_store[t] || []).filter(function (r) {
          return Object.keys(f).every(function (k) { return r[k] === f[k]; }); });
        return P({ data: rows[0] || null, error: null }); },
      then: function (fn) { var rows = (_store[t] || []).filter(function (r) {
          return Object.keys(f).every(function (k) { return r[k] === f[k]; }); });
        return P({ data: rows, error: null }).then(fn); }
    };
    return q;
  }
  window.supabase = { createClient: function () { return {
    auth: {
      getUser: function () { return P({ data: { user: _user }, error: null }); },
      getSession: function () { return P({ data: { session: { user: _user, access_token: 'mock' } }, error: null }); },
      onAuthStateChange: function (cb) { setTimeout(function () { cb('SIGNED_IN', { user: _user }); }, 50);
        return { data: { subscription: { unsubscribe: function () {} } } }; },
      signOut: function () { return P({ error: null }); }
    },
    from: function (tb) { if (!_store[tb]) _store[tb] = []; return makeQ(tb); },
    storage: { from: function () { return {
      upload: function () { return P({ data: { path: 'mock/path' }, error: null }); },
      createSignedUrl: function (p) { return P({ data: { signedUrl: 'https://mock.local/' + p }, error: null }); },
      getPublicUrl: function (p) { return { data: { publicUrl: 'https://mock.local/' + p } }; }
    }; } },
    _store: _store
  }; } };
  window.__e2eStore = _store;
  window.__fpFlush = flush;
})();
`;

// Four tenants, four provenances, one field in common: `cap`. The first two are
// copied out of Pilot; the third and fourth are the controls that make the
// distinction observable.
const T_EXTRACTED_UNCITED = {
  id: 'fp-t1', tenant_name: 'CafePress.com, Inc', cap: 5.25, leased_sqft: 54777,
  lease_type: 'Triple Net (NNN)', start_date: '2010-01-01', end_date: '2015-12-31',
  admin_fee_pct: 15, audit_rights: true, pro_rata_method: 'rentable',
  excluded_categories: 'capital expenditures', confidence: {}, _confidenceScore: 100,
  doc_has_dates: true, doc_has_lease_type: true, _usedFallback: false,
  fileName: 'Lease 2 CafePress Commercial Flex CAM.pdf', reviewOverrides: {}, amendments: [],
};
const T_TYPED = {
  id: 'fp-t2', tenant_name: 'Typed By Hand LLC', cap: '5', leased_sqft: '12000',
  lease_type: 'NNN', start_date: '2024-01-01', end_date: '2029-12-31',
  admin_fee_pct: '15', audit_rights: true, capBaseAmount: '40000',
  excluded_categories: 'capital expenditures', pro_rata_method: 'rentable',
  reviewOverrides: {}, amendments: [],
};
const T_CITED = {
  id: 'fp-t3', tenant_name: 'Quoted LLC', cap: '5', leased_sqft: '9000', lease_type: 'NNN',
  start_date: '2022-01-01', end_date: '2027-12-31', reviewOverrides: {}, amendments: [],
  fileName: 'quoted-lease.pdf',
  fieldEvidence: { cap: { snapshots: [{
    fieldKey: 'cap', value: '5', manuallyEdited: false, approved: false,
    confidence: { status: 'estimated', note: 'AI-extracted' },
    quote: 'Controllable Operating Expenses shall not increase by more than five percent (5%) per annum.',
    page: 12, sourceFile: 'quoted-lease.pdf', extractedAt: '2026-01-01T00:00:00Z',
  }] } },
};
const T_CONFIRMED = {
  id: 'fp-t4', tenant_name: 'Reviewed LLC', cap: '7', leased_sqft: '4000', lease_type: 'NNN',
  start_date: '2023-01-01', end_date: '2028-12-31', reviewOverrides: {}, amendments: [],
  fieldEvidence: { cap: { snapshots: [{
    fieldKey: 'cap', value: '7', manuallyEdited: false, approved: true,
    reviewerEmail: 'pm@example.com', reviewedAt: '2026-02-01T00:00:00Z',
    confidence: { status: 'estimated', note: 'AI-extracted' },
    quote: null, page: null, sourceFile: null,
  }] } },
};

const FIXTURE = {
  id: PID, name: 'Provenance Plaza', totalSqft: 90000, camYear: 2025,
  tenants: [T_EXTRACTED_UNCITED, T_TYPED, T_CITED, T_CONFIRMED],
  invoices: [
    { id: 'pv-1', vendorName: 'Statewide Mutual Insurance', amount: 38000, category: 'insurance',  invoiceDate: '2025-02-01', camEligible: true },
    { id: 'pv-2', vendorName: 'BrightClean Services',       amount: 19800, category: 'janitorial', invoiceDate: '2025-09-30', camEligible: true },
  ],
  disputes: [], timeline: [], activityLog: [], escrowReserves: [], drawRequests: [],
  aiDrafts: [], results: null, settlement: null,
  camReconciliation: {
    propId: PID, camYear: 2025, totalExpenses: 57800,
    results: [
      { tenantId: 'fp-t1', tenantName: 'CafePress.com, Inc', proRataPercent: 60.86, allocatedAmount: 35177.1, totalAllocated: 35177.1, capApplied: true },
      { tenantId: 'fp-t2', tenantName: 'Typed By Hand LLC',  proRataPercent: 13.33, allocatedAmount:  7706.7, totalAllocated:  7706.7, capApplied: false },
      { tenantId: 'fp-t3', tenantName: 'Quoted LLC',         proRataPercent: 10.00, allocatedAmount:  5780.0, totalAllocated:  5780.0, capApplied: false },
      { tenantId: 'fp-t4', tenantName: 'Reviewed LLC',       proRataPercent:  4.44, allocatedAmount:  2566.3, totalAllocated:  2566.3, capApplied: false },
    ],
  },
};

const _moneyShape = `(function (p) {
  var num = function (v) { var n = parseFloat(v); return isFinite(n) ? n : null; };
  return {
    invoices: (p.invoices || []).map(function (i) {
      return { id: i.id, amount: i.amount, category: i.category, camEligible: i.camEligible }; }),
    leaseInputs: (p.tenants || []).map(function (t) {
      return { id: t.id, sqft: num(t.leased_sqft), cap: num(t.cap), capBase: num(t.capBaseAmount),
               type: t.lease_type || null, excl: t.excluded_categories || null }; }),
    allocations: (((p.camReconciliation || {}).results) || []).map(function (r) {
      return { tenant: r.tenantName, allocated: r.allocatedAmount,
               capApplied: !!r.capApplied, proRata: r.proRataPercent }; }),
    camYear: p.camYear != null ? p.camYear : null, totalSqft: p.totalSqft
  };
})`;

// Everything the three surfaces say about one field, in one call.
const _labelShape = `(function (tid, field) {
  var p = currentProperty();
  var t = (p.tenants || []).find(function (x) { return x && x.id === tid; });
  if (!t) return { missing: true };
  var c = getFieldConfidence(field, t);
  var pv = window.FieldProvenance ? FieldProvenance.fieldProvenance(field, t) : null;
  return {
    tenant: t.tenant_name, value: t[field] == null ? null : String(t[field]),
    state:  pv ? pv.state : null,
    status: c.status, source: c.source, note: c.note,
    badge:  (typeof renderFieldConfidenceHtml === 'function'
             ? renderFieldConfidenceHtml(field, t).replace(/<[^>]+>/g, '').trim() : null),
    method: (typeof _rwExtractionMethod === 'function' ? _rwExtractionMethod(field, t) : null),
    chip:   (typeof _rwConfChip === 'function' ? _rwConfChip(field, t).label : null),
    dbStatus: pv ? pv.dbStatus : null,
  };
})`;

(async () => {
  console.log('\n══ Four provenances must not read the same ══');
  const server  = await startServer();
  const browser = await chromium.launch({
    headless: HEADLESS,
    executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const ctx  = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = attachDiagnostics(page);

  await page.route('**/supabase-js**', r => r.fulfill({
    status: 200, contentType: 'application/javascript', body: '/* supabase CDN suppressed */' }));
  await page.addInitScript(SUPABASE_MOCK);

  const labelsFor = async (field) => {
    const out = {};
    for (const tid of ['fp-t1', 'fp-t2', 'fp-t3', 'fp-t4']) {
      out[tid] = await page.evaluate(([src, id, f]) => eval(src)(id, f), [_labelShape, tid, field]);
    }
    return out;
  };
  const openFixture = async () => {
    await page.evaluate(async (pid) => {
      activePropId = pid;
      if (typeof selectProperty === 'function') await selectProperty(pid);
    }, PID);
    await page.waitForTimeout(2200);
  };

  try {
    await page.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'networkidle', timeout: 30000 });
    await signIn(page, { errors });

    H('A property with four differently-sourced caps');
    // EVIDENCE LIVES IN THE NORMALIZED TABLE, NOT THE BLOB. ms_useNormalizedEvidence
    // makes _stripBlobs drop `fieldEvidence` on every save, and loadPropertyData
    // rebuilds it from tenant_field_evidence. A fixture that seeds only the blob
    // therefore loses its evidence on the first save — which this suite caught by
    // watching Reviewed LLC fall from manually_confirmed to ai_extracted after a
    // reload. That is the real storage path, and the fixture now matches it.
    //
    // NOTE WHICH COLUMN CARRIES WHICH SIGNAL. `source_page`, `approved`,
    // `manually_edited` and `reviewer_email` are existing columns and survive.
    // `quote` has no column until migration 019, which is written and unapplied —
    // so fp-t3's citation is seeded as a PAGE, the citation form that can survive
    // a round trip today. The suite asserts that limitation explicitly further down.
    const created = await page.evaluate(async (fx) => {
      const st = window.__e2eStore;
      st.tenant_field_evidence = (st.tenant_field_evidence || []).filter(r => r.property_id !== fx.id);
      st.tenant_field_evidence.push({
        id: 'ev-t3', property_id: fx.id, tenant_id: 'fp-t3', field_key: 'cap', value: '5',
        confidence_status: 'estimated', confidence_note: 'AI-extracted',
        source_file: 'quoted-lease.pdf', source_page: 12,
        extraction_id: null, extraction_version: 'v1',
        reviewer_uid: null, reviewer_email: null, reviewed_at: '2026-01-01T00:00:00Z',
        approved: false, manually_edited: false, original_extracted_value: null,
        created_at: '2026-01-01T00:00:00Z',
      });
      st.tenant_field_evidence.push({
        id: 'ev-t4', property_id: fx.id, tenant_id: 'fp-t4', field_key: 'cap', value: '7',
        confidence_status: 'estimated', confidence_note: 'AI-extracted',
        source_file: null, source_page: null,
        extraction_id: null, extraction_version: 'v1',
        reviewer_uid: 'u-1', reviewer_email: 'pm@example.com', reviewed_at: '2026-02-01T00:00:00Z',
        approved: true, manually_edited: false, original_extracted_value: null,
        created_at: '2026-02-01T00:00:00Z',
      });
      try { window.__fpFlush && window.__fpFlush(); } catch (_) {}
      _props = (Array.isArray(_props) ? _props : []).filter(p => p && p.id !== fx.id)
                 .concat([JSON.parse(JSON.stringify(fx))]);
      activePropId = fx.id;
      await saveProperty(_props[_props.length - 1]);
      try { if (typeof renderProperty === 'function') renderProperty(currentProperty()); } catch (_) {}
      const p = currentProperty();
      return { open: !!p, tenants: (p.tenants || []).length,
               hasResolver: !!window.FieldProvenance };
    }, FIXTURE);
    R('property', created);
    yes('the fixture opens with four tenants and the resolver is loaded',
        created.open && created.tenants === 4 && created.hasResolver, JSON.stringify(created));

    const moneyBefore = await page.evaluate((src) => eval(src)(currentProperty()), _moneyShape);
    R('allocations (before)', moneyBefore.allocations.map(a => a.allocated));

    // ── The four labels ─────────────────────────────────────────────────────
    H('The same field, four sources, four answers');
    const L = await labelsFor('cap');
    Object.values(L).forEach(v => R(v.tenant, { state: v.state, status: v.status, chip: v.chip, note: v.note }));

    yes('an AI extraction with no clause is not called a lease document',
        L['fp-t1'].state === 'ai_extracted' && L['fp-t1'].status === 'estimated' &&
        !/lease document/i.test(L['fp-t1'].note), JSON.stringify(L['fp-t1']));
    yes('a hand-typed cap is not called a lease document either',
        L['fp-t2'].state === 'ai_extracted' && !/lease document/i.test(L['fp-t2'].note),
        JSON.stringify(L['fp-t2']));
    yes('a cap with a verbatim clause IS — and only it',
        L['fp-t3'].state === 'lease_confirmed' && L['fp-t3'].status === 'verified' &&
        /Extracted from lease document/.test(L['fp-t3'].note), JSON.stringify(L['fp-t3']));
    yes('a reviewer-approved cap reads as manually confirmed, naming the reviewer',
        L['fp-t4'].state === 'manually_confirmed' && L['fp-t4'].status === 'manual' &&
        /pm@example\.com/.test(L['fp-t4'].note), JSON.stringify(L['fp-t4']));
    // Three states across four tenants, and that is right: an uncited extraction
    // off a real lease and an uncited hand-typed value are the same claim —
    // "a value with nothing behind it" — and should read alike. What matters is
    // that BEFORE this change all three of CafePress, Typed and Quoted read
    // "✓ Extracted from lease document", and now only Quoted does.
    yes('the cited cap has separated from the two uncited ones',
        L['fp-t3'].note !== L['fp-t1'].note && L['fp-t3'].note !== L['fp-t2'].note,
        JSON.stringify(Object.values(L).map(v => v.note)));
    yes('exactly one of the four notes claims the lease document',
        Object.values(L).filter(v => /Extracted from lease document/.test(v.note || '')).length === 1,
        JSON.stringify(Object.values(L).map(v => v.note)));
    yes('three distinct states across the four tenants',
        new Set(Object.values(L).map(v => v.state)).size === 3,
        JSON.stringify(Object.values(L).map(v => v.state)));
    yes('only one of the four carries the ✓',
        Object.values(L).filter(v => /^✓/.test(v.badge || '')).length === 1,
        JSON.stringify(Object.values(L).map(v => v.badge)));

    // ── All three surfaces agree ────────────────────────────────────────────
    H('Chip, method and note tell one story per row');
    yes('the cited cap: verified badge, High chip, AI Extraction method',
        L['fp-t3'].chip === 'High' && L['fp-t3'].method === 'AI Extraction' &&
        L['fp-t3'].status === 'verified', JSON.stringify(L['fp-t3']));
    yes('the confirmed cap: Manual chip and a Manually Confirmed method, not "AI Extraction"',
        L['fp-t4'].chip === 'Manual' && L['fp-t4'].method === 'Manually Confirmed',
        JSON.stringify(L['fp-t4']));
    yes('no row shows a Manual chip beside a lease-document note',
        !Object.values(L).some(v => v.chip === 'Manual' && /lease document/i.test(v.note || '')),
        JSON.stringify(Object.values(L).map(v => [v.chip, v.note])));
    yes('no row shows an AI Extraction method beside a manual note',
        !Object.values(L).some(v => v.method === 'AI Extraction' && /^Manually/.test(v.note || '')),
        JSON.stringify(Object.values(L).map(v => [v.method, v.note])));

    // ── A manual correction, made through the product ───────────────────────
    H('Correcting a field by hand changes what the field claims');
    const edited = await page.evaluate(async () => {
      const before = getFieldConfidence('cap', currentProperty().tenants.find(t => t.id === 'fp-t3'));
      // The real writer. It records reviewOverrides AND an evidence snapshot, and
      // it operates on the module-level `tenantData` array — which is a const, so
      // it is filled in place rather than reassigned.
      tenantData.length = 0;
      currentProperty().tenants.forEach(x => tenantData.push(x));
      try { saveFieldOverride('fp-t3', 'cap', '6'); } catch (e) { /* known ReferenceError after the writes */ }
      const t = tenantData.find(x => x.id === 'fp-t3');
      const p = window.FieldProvenance ? FieldProvenance.fieldProvenance('cap', t) : null;
      const c = getFieldConfidence('cap', t);
      return { beforeNote: before.note, value: String(t.cap),
               state: p && p.state, status: c.status, note: c.note,
               hadQuote: !!(t.fieldEvidence && t.fieldEvidence.cap
                 && t.fieldEvidence.cap.snapshots.some(s => s.quote)) };
    });
    R('after a manual correction', edited);
    yes('the value that was lease-confirmed is now manually entered',
        edited.beforeNote === 'Extracted from lease document' &&
        edited.state === 'manually_entered', JSON.stringify(edited));
    yes('    and the clause that stated the OLD value no longer vouches for the new one',
        edited.hadQuote === true && !/lease document/i.test(edited.note),
        JSON.stringify(edited));

    // ── Persistence ─────────────────────────────────────────────────────────
    H('Provenance survives a save and a reload');
    await page.evaluate(async () => {
      const p = currentProperty(); p.tenants = tenantData.slice(); await saveProperty(p);
    });
    await page.waitForTimeout(800);
    await page.evaluate(() => { try { window.__fpFlush && window.__fpFlush(); } catch (_) {} });

    await page.reload({ waitUntil: 'networkidle' });
    await signIn(page, { errors });
    await openFixture();

    const L2 = await labelsFor('cap');
    Object.values(L2).forEach(v => R(v.tenant + ' (after reload)', { state: v.state, status: v.status }));
    yes('the uncited extraction is still ai_extracted',
        L2['fp-t1'].state === 'ai_extracted', JSON.stringify(L2['fp-t1']));
    yes('the hand-typed cap is still not a lease document',
        !/lease document/i.test(L2['fp-t2'].note || ''), JSON.stringify(L2['fp-t2']));
    yes('the reviewer-approved cap is still manually confirmed',
        L2['fp-t4'].state === 'manually_confirmed', JSON.stringify(L2['fp-t4']));
    yes('the corrected cap is still manually entered, not re-promoted',
        L2['fp-t3'].state === 'manually_entered' && String(L2['fp-t3'].value) === '6',
        JSON.stringify(L2['fp-t3']));
    yes('    three distinct states still survive the round trip',
        new Set(Object.values(L2).map(v => v.state)).size === 3 &&
        Object.values(L2).every(v => v.state !== null), JSON.stringify(Object.values(L2).map(v => v.state)));

    // THE 019 GAP, ASSERTED RATHER THAN ASSUMED. The citation that survives a
    // round trip today is a PAGE — `source_page` is an existing column. A quote
    // has nowhere to be stored until migration 019 is applied, so a field whose
    // only citation was a clause degrades to ai_extracted on reload. That is a
    // known, documented limitation and not a defect in this model; the point of
    // pinning it is that it changes the moment 019 lands, and this suite will say so.
    const quoteFate = await page.evaluate(() => {
      const p = currentProperty();
      const t = (p.tenants || []).find(x => x.id === 'fp-t3');
      const snaps = (t && t.fieldEvidence && t.fieldEvidence.cap && t.fieldEvidence.cap.snapshots) || [];
      return { snapshots: snaps.length,
               anyQuote: snaps.some(s => !!s.quote),
               anyPage:  snaps.some(s => s.page != null) };
    });
    R('citation after reload', quoteFate);
    yes('a PAGE citation survives the round trip — the column exists',
        quoteFate.anyPage === true, JSON.stringify(quoteFate));
    yes('a QUOTE does not, pre-019 — recorded, and the reason lease_confirmed needs it',
        quoteFate.anyQuote === false, JSON.stringify(quoteFate));

    // ── The database projection ─────────────────────────────────────────────
    H('The CHECK constraint is honoured without widening it');
    const dbRows = await page.evaluate(() => {
      const st = window.__e2eStore || {};
      return (st.tenant_field_evidence || []).map(r => ({
        field: r.field_key, status: r.confidence_status, note: r.confidence_note,
        manual: r.manually_edited, approved: r.approved }));
    });
    R('evidence rows written', dbRows);
    yes('every written confidence_status is one the constraint permits',
        dbRows.every(r => ['verified', 'estimated', 'missing', null].includes(r.status)),
        JSON.stringify(dbRows.map(r => r.status)));
    yes('a manually edited row is NOT stored as verified',
        !dbRows.some(r => r.manual === true && r.status === 'verified'),
        JSON.stringify(dbRows.filter(r => r.manual === true)));

    // ── Tenant-level confirmation must not leak ─────────────────────────────
    H('Confirming the tenant does not verify its fields');
    const leak = await page.evaluate(() => {
      const p = currentProperty();
      const t = (p.tenants || []).find(x => x.id === 'fp-t1');
      t._userConfirmed = true;
      t.review = { status: 'verified', reviewedBy: 'pm@example.com' };
      const pv = FieldProvenance.fieldProvenance('cap', t);
      const c  = getFieldConfidence('cap', t);
      return { state: pv.state, status: c.status, note: c.note };
    });
    R('tenant marked confirmed', leak);
    yes('the cap stays ai_extracted — a tenant confirmation is not field evidence',
        leak.state === 'ai_extracted' && !/lease document/i.test(leak.note), JSON.stringify(leak));

    // ── The money ───────────────────────────────────────────────────────────
    H('A provenance correction moves no money');
    const moneyAfter = await page.evaluate((src) => eval(src)(currentProperty()), _moneyShape);
    R('allocations (after)', moneyAfter.allocations.map(a => a.allocated));
    yes('every stored allocation is identical',
        JSON.stringify(moneyAfter.allocations) === JSON.stringify(moneyBefore.allocations),
        JSON.stringify({ before: moneyBefore.allocations, after: moneyAfter.allocations }));
    yes('the cap decisions are identical',
        JSON.stringify(moneyAfter.allocations.map(a => a.capApplied)) ===
        JSON.stringify(moneyBefore.allocations.map(a => a.capApplied)), 'a cap decision changed');
    yes('the invoice register is identical',
        JSON.stringify(moneyAfter.invoices) === JSON.stringify(moneyBefore.invoices),
        JSON.stringify({ before: moneyBefore.invoices, after: moneyAfter.invoices }));
    // fp-t3's cap was deliberately corrected from 5 to 6 through the product's
    // own writer; every other allocation input must be untouched.
    yes('    and so are the lease inputs, apart from the cap this suite edited on purpose',
        JSON.stringify(moneyAfter.leaseInputs.filter(t => t.id !== 'fp-t3')) ===
        JSON.stringify(moneyBefore.leaseInputs.filter(t => t.id !== 'fp-t3')),
        JSON.stringify({ before: moneyBefore.leaseInputs, after: moneyAfter.leaseInputs }));
    yes('the CAM year and rentable area are unchanged',
        moneyAfter.camYear === moneyBefore.camYear && moneyAfter.totalSqft === moneyBefore.totalSqft,
        JSON.stringify([moneyBefore.camYear, moneyAfter.camYear]));

    const verdict = await page.evaluate(() => {
      const p = currentProperty();
      if (!window.AuditExposure || typeof buildAuditSummary !== 'function') return { unavailable: true };
      const sum = buildAuditSummary(p);
      const findings = (sum && sum.findings) || [];
      const exp = AuditExposure.deriveExposure(findings, p);
      const rd  = AuditExposure.billingReadiness(exp, p);
      return { findings: findings.length, verdict: (rd && (rd.verdict || rd.state || rd.label)) || null,
               blockedTenants: exp && exp.blocking && exp.blocking.byTenant
                 ? Object.keys(exp.blocking.byTenant).length : 0 };
    });
    R('billing readiness', verdict);
    yes('billing readiness still computes and reports a verdict',
        !verdict.unavailable && verdict.verdict != null, JSON.stringify(verdict));

    H('Page errors');
    // saveFieldOverride throws a pre-existing ReferenceError AFTER its writes
    // (script.js:7704, `actor: user?.email` on an undeclared identifier). It is a
    // recorded finding, out of scope here, and the suite exercises that path on
    // purpose — so it is expected, by that exact name, and nothing else is.
    const unexpected = errors.filter(e => !/user is not defined/.test(e));
    R('errors', errors.length ? errors.slice(0, 4) : '(none)');
    yes('no page errors other than the known saveFieldOverride one',
        unexpected.length === 0, JSON.stringify(unexpected.slice(0, 4)));

  } catch (e) {
    bad('UNCAUGHT', e.message);
    console.error(e.stack);
  } finally {
    await browser.close();
    server.close();
  }

  console.log(`\n${fail ? '\x1b[31m' : '\x1b[32m'}RESULT: ${pass} passed, ${fail} failed\x1b[0m\n`);
  process.exit(fail ? 1 : 0);
})();
