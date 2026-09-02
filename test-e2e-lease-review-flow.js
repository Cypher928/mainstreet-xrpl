'use strict';
/**
 * test-e2e-lease-review-flow.js — Needs Review must lead somewhere.
 *
 *   node test-e2e-lease-review-flow.js
 *
 * THE BUG THIS EXISTS FOR
 *
 * Tapping "Needs Review" on a lease card opens the tenant space, where a review
 * panel offered a "Mark reviewed" button. Pressing it called
 * markTenantReviewAcknowledged, which sets review.reviewerConfirmed — and
 * deriveTenantReviewState SHORT-CIRCUITS on that flag, returning
 * 'manually_verified' before the status derivation runs.
 *
 * So on a lease with an unresolved CAM blocker, the button turned the card green
 * while nothing about the blocker changed. Measured on an unconfirmed property
 * mismatch:
 *
 *     before   needs_review       glyph ⚠️   camBlocking 1   engine rejects
 *     after    manually_verified  glyph ✓    camBlocking 1   engine rejects
 *
 * The lease was still listed as not ready for CAM on the bulk screen, still
 * excluded by getValidTenants(), and still absent from the reconciliation. The
 * button was not inert — it was worse, because it silenced the warning without
 * moving the thing the warning was about.
 *
 * WHAT IS ASSERTED
 * The real path a person takes: Needs Review → the review panel → an unresolved
 * mismatch → the resolution action → Needs Review clears and the lease reaches
 * the engine. Plus: no dead-end CTA anywhere in that panel, and acknowledgement
 * still available where it is honest (an advisory item with nothing blocking).
 *
 * The blocker itself is untouched by this work. Only which button is offered.
 *
 * DETERMINISM
 * Fixed timezone, fixed seed, own port and localStorage key, no network egress.
 */
process.env.TZ = 'America/New_York';

// Registered in test-regression.js, so it must not take the whole suite down on
// a machine with no browser — but it must not quietly pass there either, which
// is the same vacuous-pass failure this file exists to prevent. Skipping is
// therefore explicit and loud, never inferred.
const SKIP = process.env.SKIP_BROWSER_TESTS === '1';

let pw = null;
if (!SKIP) {
  try { pw = require('playwright'); }
  catch (_) {
    try { pw = require('/opt/node22/lib/node_modules/playwright'); }
    catch (_2) {
      console.error('\n\x1b[31mtest-e2e-test3: playwright is not installed.\x1b[0m');
      console.error('This suite replays the Test 3 workflow in a real browser and cannot');
      console.error('verify anything without one. Install playwright, or set');
      console.error('SKIP_BROWSER_TESTS=1 to deliberately skip it.\n');
      process.exit(1);
    }
  }
}
if (SKIP) {
  console.log('\n\x1b[33m⚠ test-e2e-test3 SKIPPED (SKIP_BROWSER_TESTS=1).\x1b[0m');
  console.log('  The Test 3 workflow was NOT verified on this run.\n');
  process.exit(0);
}
const { chromium } = pw;

const http = require('http');
const { signIn: _e2eSignIn, attachDiagnostics } = require('./test-support/e2e-login');
const fs   = require('fs');
const path = require('path');

const ROOT     = __dirname;
const PORT     = parseInt(process.env.APP_PORT || '7951', 10);
const HEADLESS = process.env.HEADLESS !== '0';
const SHOTS    = process.env.SHOTS === '1';
const SHOT_DIR = path.join(__dirname, 'screenshots-t3');
const CHROME   = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css',
               '.json':'application/json', '.png':'image/png', '.svg':'image/svg+xml',
               '.mp4':'video/mp4', '.webm':'video/webm', '.woff2':'font/woff2' };

let pass = 0, fail = 0;
const ok  = (m) => { console.log('  \x1b[32m✓\x1b[0m ' + m); pass++; };
const bad = (m, d) => { console.log('  \x1b[31m✗\x1b[0m ' + m + (d ? '\n      → ' + d : '')); fail++; };
const yes = (m, c, d) => c ? ok(m) : bad(m, d);

function startServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const urlPath = req.url.split('?')[0];
      const filePath = path.join(ROOT, urlPath === '/' ? '/index.html' : urlPath);
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

// ── The Test 3 dataset, exactly as the walkthrough used it ────────────────────
// Property: 100,000 sqft, CAM year 2026.
// Three leases: two expired with sqft, one live with NO sqft.
// Five invoices totalling $67,300, one of them $55,000 (81.7% of the pool).
const PROP_ID = 't3-prop-000000000001';
const T = {
  dover: 't3-tenant-dover-000001',
  para:  't3-tenant-para-0000001',
  gsb:   't3-tenant-gsb-00000001',
};
const TENANTS = [
  { id: T.dover, tenant_name: 'Dover', leased_sqft: 8194,
    lease_type: 'Triple Net (NNN)', start_date: '2011-07-01', end_date: '2016-07-01',
    cap: null, capBaseAmount: null, excluded_categories: '', status: 'complete' },
  { id: T.para, tenant_name: 'Paradigm', leased_sqft: 29088,
    lease_type: 'Triple Net (NNN)', start_date: '1998-03-01', end_date: '2003-02-28',
    cap: null, capBaseAmount: null, excluded_categories: '', status: 'complete' },
  // The lease that produced the contradictory readiness state: complete +
  // confirmed, but no square footage, so it cannot be reconciled.
  { id: T.gsb, tenant_name: 'Guaranty State Bank', leased_sqft: null,
    lease_type: 'Triple Net (NNN)', start_date: '2020-01-01', end_date: '2030-01-01',
    cap: null, capBaseAmount: null, excluded_categories: '', status: 'complete' },
];
const INVOICES = [
  { id: 't3-inv-1', vendorName: 'MainStreet CAM Validation', amount: '55000', category: 'validation',
    invoiceDate: '2026-02-10', fileName: 'validation.pdf', fileUrl: 'https://mock.local/validation.pdf',
    confidence: { amount: 95, vendor: 95, category: 90 } },
  { id: 't3-inv-2', vendorName: 'Alpha Landscaping', amount: '4200', category: 'landscaping',
    invoiceDate: '2026-03-01', fileName: 'alpha.pdf', fileUrl: 'https://mock.local/alpha.pdf',
    confidence: { amount: 92, vendor: 92, category: 90 } },
  { id: 't3-inv-3', vendorName: 'Beta Janitorial', amount: '3100', category: 'janitorial',
    invoiceDate: '2026-04-01', fileName: 'beta.pdf', fileUrl: 'https://mock.local/beta.pdf',
    confidence: { amount: 92, vendor: 92, category: 90 } },
  { id: 't3-inv-4', vendorName: 'Gamma Snow', amount: '2800', category: 'snow',
    invoiceDate: '2026-01-15', fileName: 'gamma.pdf', fileUrl: 'https://mock.local/gamma.pdf',
    confidence: { amount: 92, vendor: 92, category: 90 } },
  { id: 't3-inv-5', vendorName: 'Delta Utilities', amount: '2200', category: 'utilities',
    invoiceDate: '2026-05-01', fileName: 'delta.pdf', fileUrl: 'https://mock.local/delta.pdf',
    confidence: { amount: 92, vendor: 92, category: 90 } },
];

const SUPABASE_MOCK = `
(function () {
  var USER_ID = 't3-user';
  var _user = { id: USER_ID, email: 't3@e2e-test.local' };
  var _session = null;
  var KEY = '__lrf_store';
  var seed = {
    properties: [{
      id: ${JSON.stringify(PROP_ID)}, user_id: USER_ID, name: 'Test 3 Property', sqft: 100000,
      data: {
        invoices: ${JSON.stringify(INVOICES)},
        disputes: [], camYear: 2026, results: null, camReconciliation: null,
        activityLog: [], timeline: [], escrowReserves: [], drawRequests: [],
        tenants: ${JSON.stringify(TENANTS)},
      },
    }],
    tenants: [],
  };
  function load() {
    try { var raw = localStorage.getItem(KEY); if (raw) return JSON.parse(raw); } catch (e) {}
    return JSON.parse(JSON.stringify(seed));
  }
  function persist() { try { localStorage.setItem(KEY, JSON.stringify(_store)); } catch (e) {} }
  var _store = load();
  window.__store = function () { return _store; };
  function res(data) { return Promise.resolve({ data: data, error: null }); }
  var _seq = 0;
  function table(name) {
    var rows = _store[name] || (_store[name] = []);
    var last = null;
    var api = {
      select: function () { return api; }, eq: function () { return api; },
      not: function () { return api; }, is: function () { return api; },
      in: function () { return api; }, order: function () { return api; },
      limit: function () { return api; },
      maybeSingle: function () { return res(last || rows[0] || null); },
      single: function () { return res(last || rows[0] || null); },
      insert: function (v) {
        var a = [].concat(v).map(function (r) {
          var row = JSON.parse(JSON.stringify(r));
          if (!row.id) row.id = 'mock-' + name + '-' + (++_seq);
          rows.push(row); return row;
        });
        last = a[0]; persist(); return api;
      },
      upsert: function (v) {
        var a = [].concat(v).map(function (r) {
          var row = JSON.parse(JSON.stringify(r));
          if (!row.id) row.id = 'mock-' + name + '-' + (++_seq);
          var i = rows.findIndex(function (x) { return x.id === row.id; });
          if (i >= 0) { rows[i] = Object.assign({}, rows[i], row); persist(); return rows[i]; }
          rows.push(row); return row;
        });
        last = a[0]; persist(); return api;
      },
      update: function (v) {
        rows.forEach(function (r) { Object.assign(r, JSON.parse(JSON.stringify(v))); });
        last = rows[0]; persist(); return api;
      },
      delete: function () { return api; },
      then: function (r2) { return Promise.resolve({ data: last ? [last] : rows, error: null }).then(r2); },
    };
    return api;
  }
  window.supabase = { createClient: function () { return {
    auth: {
      getSession: function () { return Promise.resolve({ data: { session: _session }, error: null }); },
      getUser:    function () { return Promise.resolve({ data: { user: _session ? _user : null }, error: null }); },
      signInWithPassword: function () { _session = { access_token: 'mock', user: _user };
        return Promise.resolve({ data: { session: _session, user: _user }, error: null }); },
      signUp:  function () { return Promise.resolve({ data: { user: _user }, error: null }); },
      signOut: function () { _session = null; return Promise.resolve({ error: null }); },
      onAuthStateChange: function () { return { data: { subscription: { unsubscribe: function () {} } } }; },
    },
    from: table,
    storage: { from: function () { return {
      upload: function () { return res({ path: 'mock' }); },
      createSignedUrl: function () { return res({ signedUrl: 'https://mock.local/x' }); } }; } },
  }; } };
})();
`;

(async () => {
  if (SHOTS && !fs.existsSync(SHOT_DIR)) fs.mkdirSync(SHOT_DIR, { recursive: true });
  const server  = await startServer();
  const browser = await chromium.launch({
    headless: HEADLESS, executablePath: CHROME,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const ctx  = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = attachDiagnostics(page);

  await page.route('**', route => {
    const u = route.request().url();
    if (u.startsWith('http://127.0.0.1:' + PORT)) return route.continue();
    if (/supabase-js/.test(u)) {
      return route.fulfill({ status: 200, contentType: 'application/javascript', body: '/* mocked */' });
    }
    return route.abort();
  });
  await page.addInitScript(SUPABASE_MOCK);
  await page.addInitScript(() => { window.__PROP_ID = 't3-prop-000000000001'; });

  console.log('\n══ Lease review flow — Needs Review must lead somewhere ══');

  // ── sign in ────────────────────────────────────────────────────────────────
  await page.goto('http://127.0.0.1:' + PORT + '/?signin=1', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await _e2eSignIn(page, { email: "t3@e2e-test.local", errors: errors });
  await page.waitForFunction(() => typeof _props !== 'undefined' && Array.isArray(_props) && _props.length > 0, null,
                             { timeout: 45000 });
  await page.evaluate(() => selectProperty(window.__PROP_ID));
  await page.waitForFunction(() => typeof tenantData !== 'undefined'
    && tenantData.filter(Boolean).length === 3, null, { timeout: 45000 });

  const seeded = await page.evaluate(() => ({
    prop:     currentProperty()?.name,
    sqft:     document.getElementById('totalSqft')?.value,
    camYear:  typeof getCamYear === 'function' ? getCamYear() : null,
    tenants:  tenantData.filter(Boolean).map(t => `${t.tenant_name}/${t.leased_sqft ?? 'no sqft'}`),
    invoices: invoiceData.filter(Boolean).map(i => `${i.vendorName} ${i.amount}`),
    invTotal: invoiceData.filter(Boolean).reduce((s, i) => s + (parseFloat(i.amount) || 0), 0),
  }));
  console.log('\n── Loaded state ──');
  console.log('  property :', seeded.prop, '·', seeded.sqft, 'sqft · CAM year', seeded.camYear);
  console.log('  leases   :', seeded.tenants.join(' | '));
  console.log('  invoices :', seeded.invoices.join(' | '));
  console.log('  pool     : $' + seeded.invTotal.toLocaleString());

  yes('the fixture loaded', seeded.tenants.length === 3, JSON.stringify(seeded.tenants));


  const R = (l,v)=>console.log('  '+String(l).padEnd(44)+':', typeof v==='string'?v:JSON.stringify(v));

  // ── Seed the exact reported condition ──────────────────────────────────────
  console.log('\n── Dover has an unconfirmed property mismatch ──');
  const seed = await page.evaluate(() => {
    const d = tenantData.filter(Boolean).find(t => /^Dover/.test(t.tenant_name));
    d.property_name = 'Northgate Commons';
    d.fileName = 'dover-lease-v1.pdf';
    // The mismatch must be this lease's ONLY review item, so that resolving it
    // is expected to clear Needs Review outright. A lease that also lacks a cap
    // stays in Needs Review for that reason after the blocker is gone, which is
    // correct and is asserted separately at the end.
    d.cap = '5'; d.capBaseAmount = '30000'; d.audit_rights = true;
    d._edgeCases = window.LeaseIntelligence.detectLeaseEdgeCases(
      d, { currentPropertyName: currentProperty().name });
    delete d._propertyConfirm;
    currentProperty().tenants = tenantData.filter(Boolean);
    return { id: d.id, state: getTenantReviewState(d),
             camBlocking: deriveTenantReviewState(d).camBlocking,
             inEngine: getValidTenants().some(t => /^Dover/.test(t.tenant_name)) };
  });
  R('review state', seed.state); R('camBlocking', seed.camBlocking); R('engine accepts', seed.inEngine);
  yes('the lease starts in Needs Review with a real CAM blocker',
      seed.state === 'needs_review' && seed.camBlocking.length === 1 && seed.inEngine === false,
      JSON.stringify(seed));

  // ── Step 1: tap "Needs Review" — the real entry point ─────────────────────
  console.log('\n── Step 1: tap Needs Review → the review panel opens ──');
  const panel = await page.evaluate(async (tid) => {
    await openReviewItem(window.__PROP_ID, tid);
    await new Promise(r => setTimeout(r, 900));
    const gap = document.getElementById('tsReviewGap');
    const ov  = document.getElementById('tsOverlay');
    return {
      spaceOpened: !!ov,
      gapPainted:  !!gap,
      heading: gap ? (gap.querySelector('.ts-review-gap-h') || {}).textContent : null,
      reasons: gap ? [...gap.querySelectorAll('li')].map(x => x.textContent.trim()) : [],
      buttons: gap ? [...gap.querySelectorAll('button')].map(b => ({
        text: b.textContent.replace(/\s+/g, ' ').trim(),
        onclick: b.getAttribute('onclick') || '' })) : [],
      hint: gap ? (gap.querySelector('.ts-review-gap-hint') || {}).textContent : null,
    };
  }, seed.id);
  R('space modal opened', panel.spaceOpened);
  R('review panel painted', panel.gapPainted);
  R('heading', panel.heading);
  R('reasons listed', panel.reasons);
  R('buttons', panel.buttons.map(b => b.text));
  R('hint', panel.hint);

  yes('the review panel actually opens (not a vacuous check)',
      panel.spaceOpened && panel.gapPainted, JSON.stringify(panel));
  yes('it names why the lease needs a human', panel.reasons.length > 0, JSON.stringify(panel.reasons));

  // ── Step 2: the CTA leads to the resolution, not to acknowledgement ───────
  console.log('\n── Step 2: the CTA must resolve, not acknowledge ──');
  yes('there is exactly one call to action', panel.buttons.length === 1,
      JSON.stringify(panel.buttons.map(b => b.text)));
  yes('it is NOT "Mark reviewed" on a lease with a CAM blocker',
      !/mark reviewed/i.test(panel.buttons[0].text),
      `the acknowledgement CTA is back: ${JSON.stringify(panel.buttons[0].text)}`);
  yes('it does not call markTenantReviewAcknowledged',
      !/markTenantReviewAcknowledged/.test(panel.buttons[0].onclick),
      panel.buttons[0].onclick);
  yes('it names the blocker it will take you to',
      /confirm which property this lease belongs to/i.test(panel.buttons[0].text),
      panel.buttons[0].text);
  yes('and the panel says why acknowledgement is not offered',
      !!panel.hint && /cannot take part in CAM/i.test(panel.hint)
        && /would not change/i.test(panel.hint) && /not offered here/i.test(panel.hint),
      String(panel.hint));

  // NO DEAD ENDS: every button in the panel must be wired to a real function.
  const wired = await page.evaluate((btns) => btns.map(b => {
    const fn = (b.onclick.match(/^\s*([A-Za-z_$][\w$]*)\s*\(/) || [])[1];
    return { text: b.text, fn: fn || null, exists: fn ? typeof window[fn] === 'function' : false };
  }), panel.buttons);
  R('CTA wiring', wired);
  yes('every CTA in the panel calls a function that exists',
      wired.length > 0 && wired.every(w => w.exists), JSON.stringify(wired));

  // ── Step 3: press it — navigation only, no state change ──────────────────
  console.log('\n── Step 3: pressing it navigates to the resolution ──');
  const nav = await page.evaluate(async (tid) => {
    const before = {
      state: getTenantReviewState(tenantData.filter(Boolean).find(t => t.id === tid)),
      confirmed: !!(tenantData.filter(Boolean).find(t => t.id === tid).review || {}).reviewerConfirmed,
    };
    openLeaseBlockerFix(tid);
    await new Promise(r => setTimeout(r, 700));
    const d = tenantData.filter(Boolean).find(t => t.id === tid);
    const i = tenantData.findIndex(t => t && t.id === tid);
    const row = document.getElementById('btr-' + i);
    const confirmBtn = row ? row.querySelector('.lpm-btn') : null;
    return {
      before,
      spaceClosed: !document.getElementById('tsOverlay'),
      detailOpen: !!(document.getElementById('bdet-' + i)
        && getComputedStyle(document.getElementById('bdet-' + i)).display !== 'none'),
      confirmVisible: !!confirmBtn,
      confirmText: confirmBtn ? confirmBtn.textContent.replace(/\s+/g, ' ').trim() : null,
      flashed: !!(row && row.querySelector('.lease-blocker-flash')),
      after: { state: getTenantReviewState(d),
               confirmed: !!(d.review || {}).reviewerConfirmed,
               camBlocking: deriveTenantReviewState(d).camBlocking },
    };
  }, seed.id);
  R('space modal closed', nav.spaceClosed);
  R('lease card expanded', nav.detailOpen);
  R('resolution control visible', nav.confirmText);
  R('highlighted for the reader', nav.flashed);
  R('state before → after', nav.before.state + ' → ' + nav.after.state);

  yes('it lands on the resolution control',
      nav.confirmVisible && /Confirm lease belongs to this property/i.test(nav.confirmText || ''),
      String(nav.confirmText));
  yes('it expands the card so the control is reachable', nav.detailOpen, 'the card stayed collapsed');
  yes('it highlights what needs attention', nav.flashed, 'nothing was highlighted');
  yes('NAVIGATION ONLY — it changes no review state',
      nav.after.state === nav.before.state && nav.after.confirmed === false
        && nav.after.camBlocking.length === 1,
      JSON.stringify(nav.after));

  // ── Step 4: the state-changing action still clears it ────────────────────
  console.log('\n── Step 4: Confirm lease belongs to this property ──');
  const done = await page.evaluate(async (tid) => {
    const i = tenantData.findIndex(t => t && t.id === tid);
    const saved = window.AuthService;
    window.AuthService = { getCurrentUser: () => ({ role: 'landlord', email: 'owner@e2e-test.local' }),
                           isLandlord: () => true };
    let toast = null; const st = window.showToast; window.showToast = (m) => { toast = m; };
    confirmLeaseBelongsToProperty(i);
    window.showToast = st; window.AuthService = saved;
    await new Promise(r => setTimeout(r, 900));
    if (typeof renderBulkResults === 'function') renderBulkResults();
    const d = tenantData.filter(Boolean).find(t => t.id === tid);
    const el = document.getElementById('bulkResults');
    const card = [...el.querySelectorAll('[id^="btr-"]')].find(r => /Dover/.test(r.textContent));
    return {
      toast,
      state: getTenantReviewState(d),
      camBlocking: deriveTenantReviewState(d).camBlocking,
      inEngine: getValidTenants().some(t => /^Dover/.test(t.tenant_name)),
      cardSaysNeedsReview: card ? /Needs Review/.test(card.textContent) : null,
      glyph: card ? (card.querySelector('.bulk-t-status') || {}).textContent : null,
      stillBlockedOnScreen: (() => { const n = el.querySelector('.bulk-cam-blocked');
        return n ? /Dover/.test(n.textContent) : false; })(),
      recordedBy: (d._propertyConfirm || {}).by || null,
    };
  }, seed.id);
  R('toast', done.toast);
  R('review state', done.state);
  R('camBlocking', done.camBlocking);
  R('card still says Needs Review', done.cardSaysNeedsReview);
  R('glyph', done.glyph);
  R('engine accepts', done.inEngine);
  R('recorded by', done.recordedBy);

  yes('NEEDS REVIEW CLEARS on the card', done.cardSaysNeedsReview === false && done.glyph !== '⚠️',
      JSON.stringify({ says: done.cardSaysNeedsReview, glyph: done.glyph }));
  yes('and the derived review state agrees', done.state === 'verified', done.state);
  yes('the CAM blocker is gone', done.camBlocking.length === 0, JSON.stringify(done.camBlocking));
  yes('the lease now reaches the engine', done.inEngine === true, 'still excluded');
  yes('it is no longer listed as blocked on the bulk screen', done.stillBlockedOnScreen === false,
      'the blocked list still names it');
  yes('and the decision is attributed', done.recordedBy === 'owner@e2e-test.local', String(done.recordedBy));

  // ── EVERY review type gets a resolution, not just the blocker ────────────
  //
  // The reported case: a lease with three outstanding review items and NO CAM
  // blocker still showed "Mark reviewed", which set reviewerConfirmed and
  // flipped the card to verified while all three items stayed put. Each type is
  // driven here through the real panel.
  console.log('\n── Every Needs Review type leads to its own resolution ──');
  // What the card labels each field, so the landing can be checked by what the
  // reader sees rather than by an internal key.
  const LANDING = {
    leased_sqft: /^Leased Sqft/i, lease_type: /^Lease Type/i,
    start_date:  /^Lease Start/i, end_date:   /^Lease End/i,
    cap:         /^CAM Cap/i,
  };
  const KINDS = [
    ['missing square footage', { leased_sqft: null },
     /add the leased square footage/i, 'leased_sqft'],
    ['missing lease type',     { lease_type: '' },
     /set the lease type/i, 'lease_type'],
    ['missing end date',       { end_date: '' },
     /add the lease end date/i, 'end_date'],
    ['cap verification',       { cap: null, capBaseAmount: null },
     /enter the cam cap percentage/i, 'cap'],
    ['property mismatch',      { __mismatch: true },
     /confirm which property this lease belongs to/i, '_confirm'],
  ];
  for (const [name, patch, ctaRe, field] of KINDS) {
    const r = await page.evaluate(async ([p, tid]) => {
      const d = tenantData.filter(Boolean).find(t => t.id === tid);
      // Reset to a lease with nothing outstanding, then introduce exactly one.
      Object.assign(d, { leased_sqft: 8194, lease_type: 'Triple Net (NNN)',
        start_date: '2011-07-01', end_date: '2016-07-01',
        cap: '5', capBaseAmount: '30000', audit_rights: true });
      delete d._edgeCases; delete d._propertyConfirm; d.property_name = null;
      if (p.__mismatch) {
        d.property_name = 'Northgate Commons'; d.fileName = 'dover-lease-v1.pdf';
        d._edgeCases = window.LeaseIntelligence.detectLeaseEdgeCases(
          d, { currentPropertyName: currentProperty().name });
      } else { Object.assign(d, p); }
      currentProperty().tenants = tenantData.filter(Boolean);
      if (window.TenantSpace && window.TenantSpace.closeSpace) window.TenantSpace.closeSpace();
      await openReviewItem(window.__PROP_ID, tid);
      await new Promise(x => setTimeout(x, 800));
      const gap = document.getElementById('tsReviewGap');
      const btn = gap ? gap.querySelector('button') : null;
      const out = {
        state: getTenantReviewState(d),
        painted: !!gap,
        cta: btn ? btn.textContent.replace(/\s+/g, ' ').trim() : null,
        onclick: btn ? (btn.getAttribute('onclick') || '') : '',
        hint: gap ? (gap.querySelector('.ts-review-gap-hint') || {}).textContent || '' : '',
      };
      if (window.TenantSpace && window.TenantSpace.closeSpace) window.TenantSpace.closeSpace();
      return out;
    }, [patch, seed.id]);
    console.log(`  ${name.padEnd(24)} state=${r.state} cta=${JSON.stringify(r.cta)}`);
    yes(`${name}: the panel opens and offers a next step`,
        r.painted && !!r.cta && /^Next step:/.test(r.cta), JSON.stringify(r));
    yes(`${name}: the CTA names this item's resolution`, ctaRe.test(r.cta || ''), String(r.cta));
    yes(`${name}: it navigates to that field, and acknowledges nothing`,
        r.onclick.indexOf('openReviewItemFix(') === 0
          && r.onclick.indexOf(field === null ? 'null' : "'" + field + "'") > 0
          && !/markTenantReviewAcknowledged/.test(r.onclick),
        r.onclick);
    yes(`${name}: the panel says acknowledgement would not change it`,
        /would not change/i.test(r.hint), r.hint);

    // WHERE THE CLICK ACTUALLY LANDS, not what the onclick attribute says.
    // A mutation that made openReviewItemFix ignore the field entirely left the
    // attribute assertion above green, because the attribute is generated from
    // _reviewResolution while the landing is done by the navigator.
    const land = await page.evaluate(async ([tid, f]) => {
      openReviewItemFix(tid, f);
      await new Promise(x => setTimeout(x, 700));
      const i   = tenantData.findIndex(t => t && t.id === tid);
      const row = document.getElementById('btr-' + i);
      const hit = row ? row.querySelector('.lease-blocker-flash') : null;
      return {
        landed: !!hit,
        isConfirm: !!(hit && hit.classList.contains('lease-prop-confirm')),
        fieldLabel: hit ? ((hit.querySelector('label') || {}).textContent || '').trim() : null,
        focused: (document.activeElement && document.activeElement.tagName === 'INPUT')
          ? ((document.activeElement.closest('.field') || {}).querySelector
              ? ((document.activeElement.closest('.field').querySelector('label') || {}).textContent || '').trim()
              : null)
          : null,
      };
    }, [seed.id, field]);
    console.log(`     lands on: ${JSON.stringify(land.fieldLabel || (land.isConfirm ? '[confirm control]' : null))}`);
    yes(`${name}: the click lands on something specific`, land.landed, JSON.stringify(land));
    yes(`${name}: it lands on the control that resolves THIS item`,
        field === '_confirm'
          ? land.isConfirm
          : (LANDING[field] || /$^/).test(land.fieldLabel || land.focused || ''),
        JSON.stringify({ expected: field, label: land.fieldLabel, focused: land.focused }));
  }

  // No panel anywhere in this flow may still offer the acknowledgement CTA.
  console.log('\n── "Mark reviewed" is gone from these panels ──');
  const gone = await page.evaluate(() => {
    const src = String(_emphasiseReviewGap);
    return {
      // A rendered acknowledgement CONTROL, not the phrase: the words still
      // appear in the note explaining why it is absent, and in the comment
      // recording why it was removed. Neither is a button.
      ackButton: /<button[^>]*>\s*Mark reviewed/.test(src),
      callsAck:  /onclick="markTenantReviewAcknowledged/.test(src)
                 || /markTenantReviewAcknowledged\(/.test(src),
    };
  });
  yes('the review panel renders no acknowledgement button',
      gone.ackButton === false, JSON.stringify(gone));
  yes('and never wires one to markTenantReviewAcknowledged',
      gone.callsAck === false, JSON.stringify(gone));

  // ── The workspace approve path obeys the same rule ───────────────────────
  console.log('\n── rwApprove refuses a blocked lease ──');
  const rw = await page.evaluate(async (tid) => {
    const d = tenantData.filter(Boolean).find(t => t.id === tid);
    delete d._propertyConfirm;             // re-block Dover
    currentProperty().tenants = tenantData.filter(Boolean);
    let toast = null; const st = window.showToast; window.showToast = (m) => { toast = m; };
    rwApprove(tid);
    window.showToast = st;
    await new Promise(r => setTimeout(r, 500));
    const after = tenantData.filter(Boolean).find(t => t.id === tid);
    return { toast, confirmed: !!(after.review || {}).reviewerConfirmed,
             camBlocking: deriveTenantReviewState(after).camBlocking };
  }, seed.id);
  R('toast', rw.toast); R('reviewerConfirmed', rw.confirmed);
  yes('it refuses rather than recording a meaningless review',
      rw.confirmed === false && !!rw.toast && /cannot mark reviewed/i.test(rw.toast),
      JSON.stringify(rw));
  yes('and it says where the blocker is resolved',
      /opening where that is resolved/i.test(rw.toast || ''), String(rw.toast));

  // ── The residual case, stated honestly ───────────────────────────────────
  //
  // Resolving the blocker clears Needs Review only when the blocker was the
  // lease's only review item. A lease that also lacks a cap percentage stays in
  // Needs Review afterwards — correctly, because the cap really is unspecified.
  // What must NOT survive is any claim that the lease is blocked from CAM.
  console.log('\n── A lease with other review items keeps Needs Review ──');
  const residual = await page.evaluate(async (tid) => {
    const d = tenantData.filter(Boolean).find(t => t.id === tid);
    // The rwApprove check above re-blocked this lease deliberately; restore the
    // confirmation so this section measures what it claims to — a RESOLVED
    // blocker alongside a genuine advisory item.
    d._propertyConfirm = { extractedName: d.property_name,
      documentKey: window.LeaseIntelligence.propertyDocumentKey(d),
      propertyId: activePropId, propertyName: currentProperty().name,
      at: '2026-08-23T00:00:00.000Z', by: 'owner@e2e-test.local' };
    d.cap = null; d.capBaseAmount = null;      // reintroduce a genuine advisory item
    currentProperty().tenants = tenantData.filter(Boolean);
    if (typeof renderBulkResults === 'function') renderBulkResults();
    const el = document.getElementById('bulkResults');
    const card = [...el.querySelectorAll('[id^="btr-"]')].find(r => /Dover/.test(r.textContent));
    const st = deriveTenantReviewState(d);
    return {
      state: getTenantReviewState(d),
      camBlocking: st.camBlocking,
      reviewItems: st.reviewItems,
      saysNeedsReview: card ? /Needs Review/.test(card.textContent) : null,
      blockedOnScreen: (() => { const n = el.querySelector('.bulk-cam-blocked');
        return n ? /Dover/.test(n.textContent) : false; })(),
      inEngine: getValidTenants().some(t => /^Dover/.test(t.tenant_name)),
    };
  }, seed.id);
  R('state', residual.state); R('camBlocking', residual.camBlocking);
  R('reviewItems', residual.reviewItems); R('card says Needs Review', residual.saysNeedsReview);
  yes('Needs Review correctly persists for the remaining advisory item',
      residual.state === 'needs_review' && residual.saysNeedsReview === true
        && residual.reviewItems.some(x => /NNN Cap/i.test(x)),
      JSON.stringify(residual));
  yes('but nothing blocks CAM any more',
      residual.camBlocking.length === 0 && residual.inEngine === true,
      JSON.stringify(residual));
  yes('and the screen does not claim the lease is blocked',
      residual.blockedOnScreen === false, 'the blocked list still names a lease with no blocker');

  // ── THE BENEFITFOCUS CASE: the box must list EVERY blank required field ──
  //
  // Reported from the live Pilot. A lease with three blanks on screen — Leased
  // Sqft, Lease End Date, Lease Type — whose Needs Review box named only two:
  //
  //     Missing end date
  //     Lease type not specified
  //
  // The omitted one was the square footage, which is the CAM blocker: the field
  // that decides whether the lease can be reconciled at all. The reader had to
  // scroll the form and find the blank themselves.
  //
  // Cause: the box rendered getWarnings(computeFlags(d)), a second enumeration of
  // what a lease is missing, and computeFlags has NO square-footage branch.
  // deriveTenantReviewState knew about all three the whole time — it is what
  // camBlocking and the Next step CTA are built from — so the list the reader saw
  // and the list the product acted on were different lists.
  console.log('\n══ Benefitfocus: every blank required field is listed ══');
  const bf = await page.evaluate(async (tid) => {
    const d = tenantData.filter(Boolean).find(t => t.id === tid);
    // Exactly what the screenshots show: a name, a start date, nothing else.
    Object.assign(d, { tenant_name: 'Benefitfocus.com, Inc', leased_sqft: null,
      start_date: '2016-12-12', end_date: null, lease_type: null,
      cap: null, capBaseAmount: null });
    delete d._edgeCases; delete d._propertyConfirm; delete d.review; d.property_name = null;
    currentProperty().tenants = tenantData.filter(Boolean);
    if (typeof renderBulkResults === 'function') renderBulkResults();
    await new Promise(x => setTimeout(x, 300));
    const i   = tenantData.findIndex(t => t && t.id === tid);
    const det = document.getElementById('bdet-' + i);
    if (det && getComputedStyle(det).display === 'none') toggleBulkDetail(i);
    await new Promise(x => setTimeout(x, 300));
    const row = document.getElementById('btr-' + i);
    const box = row ? row.querySelector('.rc-flags') : null;
    const st  = deriveTenantReviewState(d);
    // What the form itself shows as blank, read from the inputs — so the
    // assertion compares the box against the FIELDS, not against another
    // derivation that could be wrong in the same direction.
    const blanks = [...row.querySelectorAll('.field')].filter(f => {
      const c = f.querySelector('input, select');
      return c && !String(c.value || '').trim();
    }).map(f => (f.querySelector('label') || {}).textContent.trim());
    const cta = box ? box.querySelector('.rc-flag-cta') : null;
    return {
      idx: i,
      boxItems: box ? [...box.querySelectorAll('.rc-flag-item')].map(x => x.textContent.trim()) : null,
      blanksOnForm: blanks,
      ctaText:  cta ? cta.textContent.replace(/\s+/g, ' ').trim() : null,
      ctaClick: cta ? (cta.getAttribute('onclick') || '') : null,
      state: st.status, score: st.score,
      requiredGaps: st.requiredGaps, camBlocking: st.camBlocking,
      // The second enumeration, kept only to show it is still the incomplete one
      // and that nothing was added to it — it feeds the health score.
      computeFlags: computeFlags(d),
    };
  }, T.gsb);
  R('box lists', bf.boxItems);
  R('blank fields on the form', bf.blanksOnForm);
  R('requiredGaps', bf.requiredGaps);
  R('camBlocking', bf.camBlocking);
  R('cta', bf.ctaText);
  R('computeFlags (untouched)', bf.computeFlags);
  R('score', bf.score);

  yes('the reported shape is reproduced — three required fields blank on the form',
      bf.blanksOnForm.some(l => /^Leased Sqft/i.test(l))
        && bf.blanksOnForm.some(l => /^Lease End Date/i.test(l))
        && bf.blanksOnForm.some(l => /^Lease Type/i.test(l)),
      JSON.stringify(bf.blanksOnForm));
  yes('THE DEFECT IS FIXED: the box names the missing square footage',
      !!bf.boxItems && bf.boxItems.some(x => /square footage/i.test(x)),
      JSON.stringify(bf.boxItems));
  yes('and still names the other two',
      bf.boxItems.some(x => /missing end date/i.test(x))
        && bf.boxItems.some(x => /lease type not specified/i.test(x)),
      JSON.stringify(bf.boxItems));
  yes('the box lists three items, one per blank required field',
      bf.boxItems.length === 3, JSON.stringify(bf.boxItems));
  yes('the CAM blocker is among them rather than silently omitted',
      bf.camBlocking.length === 1 && /Sq Ft/i.test(bf.camBlocking[0]),
      JSON.stringify(bf.camBlocking));

  yes('the box offers a next step',
      !!bf.ctaText && /^Next step:/.test(bf.ctaText), String(bf.ctaText));
  yes('and it resolves the blocker first, not the cosmetic items',
      /add the leased square footage/i.test(bf.ctaText || ''), String(bf.ctaText));
  yes('the CTA navigates rather than acknowledging',
      /(^|;)\s*openReviewItemFix\(/.test(bf.ctaClick || '')
        && /'leased_sqft'/.test(bf.ctaClick || '')
        && !/markTenantReviewAcknowledged/.test(bf.ctaClick || ''), String(bf.ctaClick));

  // THE SCORE MUST NOT MOVE. computeFlags feeds the health score
  // (score -= getWarnings(computeFlags(t)).length * 5), so "fixing" this by
  // adding a type to computeFlags would silently reprice every sqft-less lease.
  yes('computeFlags was NOT widened — the health score is untouched',
      bf.computeFlags.length === 2 && bf.computeFlags.indexOf('missing_sqft') === -1
        && bf.score === 40,
      JSON.stringify({ flags: bf.computeFlags, score: bf.score }));

  // ── and the resolution actually resolves ─────────────────────────────────
  console.log('\n── Following the next step, then resolving it ──');
  const bfLand = await page.evaluate(async ([tid, i]) => {
    openReviewItemFix(tid, 'leased_sqft');
    await new Promise(x => setTimeout(x, 700));
    const row = document.getElementById('btr-' + i);
    const hit = row ? row.querySelector('.lease-blocker-flash') : null;
    return { landed: !!hit,
             label: hit ? ((hit.querySelector('label') || {}).textContent || '').trim() : null };
  }, [T.gsb, bf.idx]);
  R('lands on', bfLand.label);
  yes('the next step lands on the Leased Sqft field',
      bfLand.landed && /^Leased Sqft/i.test(bfLand.label || ''), JSON.stringify(bfLand));

  // RESOLVE IT THE WAY A PERSON DOES — by typing into the field the CTA landed
  // on, not by assigning to the model. Assigning does not survive here: the
  // navigator leaves that input focused, so the next re-render fires its onblur
  // and writes the input's still-empty value back over the assignment. Driving
  // the input is both the honest path and the one that works.
  const bfFix = await page.evaluate(async (tid) => {
    const i = tenantData.findIndex(t => t && t.id === tid);
    const row = document.getElementById('btr-' + i);
    const fld = [...row.querySelectorAll('.field')]
      .find(f => /^Leased Sqft/i.test((f.querySelector('label') || {}).textContent || ''));
    const inp = fld && fld.querySelector('input');
    if (inp) { inp.focus(); inp.value = '12000'; inp.blur(); }
    await new Promise(x => setTimeout(x, 300));
    const d = tenantData.filter(Boolean).find(t => t.id === tid);
    currentProperty().tenants = tenantData.filter(Boolean);
    renderBulkResults();
    await new Promise(x => setTimeout(x, 300));
    const det = document.getElementById('bdet-' + i);
    if (det && getComputedStyle(det).display === 'none') toggleBulkDetail(i);
    await new Promise(x => setTimeout(x, 300));
    const row2 = document.getElementById('btr-' + i);
    const box = row2 ? row2.querySelector('.rc-flags') : null;
    const cta = box ? box.querySelector('.rc-flag-cta') : null;
    const st  = deriveTenantReviewState(d);
    return {
      sqftNow: d.leased_sqft,
      boxItems: box ? [...box.querySelectorAll('.rc-flag-item')].map(x => x.textContent.trim()) : null,
      ctaText: cta ? cta.textContent.replace(/\s+/g, ' ').trim() : null,
      camBlocking: st.camBlocking, inEngine: getValidTenants().some(t => t.id === tid),
    };
  }, T.gsb);
  R('sqft after typing', bfFix.sqftNow);
  R('box now lists', bfFix.boxItems);
  R('cta now', bfFix.ctaText);
  yes('resolving it removes exactly that line from the box',
      !!bfFix.boxItems && bfFix.boxItems.length === 2
        && !bfFix.boxItems.some(x => /square footage/i.test(x)),
      JSON.stringify(bfFix.boxItems));
  yes('the CAM blocker clears and the lease reaches the engine',
      bfFix.camBlocking.length === 0 && bfFix.inEngine === true, JSON.stringify(bfFix));
  yes('and the next step moves on to the next outstanding field',
      /set the lease type/i.test(bfFix.ctaText || ''), String(bfFix.ctaText));

  const bfDone = await page.evaluate(async (tid) => {
    const d = tenantData.filter(Boolean).find(t => t.id === tid);
    const i = tenantData.findIndex(t => t && t.id === tid);
    d.lease_type = 'Gross'; d.end_date = '2030-01-01';
    currentProperty().tenants = tenantData.filter(Boolean);
    renderBulkResults();
    await new Promise(x => setTimeout(x, 300));
    const det = document.getElementById('bdet-' + i);
    if (det && getComputedStyle(det).display === 'none') toggleBulkDetail(i);
    await new Promise(x => setTimeout(x, 300));
    const row = document.getElementById('btr-' + i);
    return {
      box: !!(row && row.querySelector('.rc-flags')),
      state: getTenantReviewState(d),
      gaps: deriveTenantReviewState(d).requiredGaps,
    };
  }, T.gsb);
  R('box still rendered', bfDone.box); R('state', bfDone.state);
  yes('filling the rest clears the box entirely',
      bfDone.box === false && bfDone.gaps.length === 0, JSON.stringify(bfDone));
  yes('and the lease leaves Needs Review',
      bfDone.state === 'verified', bfDone.state);

  yes('no uncaught page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

  const TOTAL_EXPECTED = 74;
  yes(`suite runs all ${TOTAL_EXPECTED} checks`, pass + fail + 1 === TOTAL_EXPECTED,
      `assertion count changed — update TOTAL_EXPECTED deliberately (saw ${pass + fail + 1})`);
  await browser.close(); server.close();
  console.log(`\n${fail === 0 ? '\x1b[32m' : '\x1b[31m'}RESULT: ${pass} passed, ${fail} failed\x1b[0m`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
