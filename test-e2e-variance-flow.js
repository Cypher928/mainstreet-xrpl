'use strict';
/**
 * test-e2e-variance-flow.js — the variance banner must lead somewhere, and a
 * property-level exception must not read as a tenant row with a missing name.
 *
 *   node test-e2e-variance-flow.js
 *
 * THE TWO DEFECTS THIS EXISTS FOR
 *
 * 1. On the live Pilot the reconciliation screen said:
 *
 *      "Reconciliation variance detected — total billed ($8,259.30) differs from
 *       total expense pool ($71,950.00) by $63,690.70. Re-check invoice amounts
 *       or re-run allocation."
 *
 *    Tapping it did nothing, and the advice was wrong: every invoice amount was
 *    correct. The gap was 8 of the 13 invoices being marked not CAM-eligible —
 *    a setting the manager had chosen — and nothing on screen said so.
 *
 * 2. The blocked-statement table printed "NAMES THIS TENANT — —" against a
 *    property-level concentration finding, so a $38,000 row about a single
 *    invoice looked like a tenant row whose tenant had failed to render.
 *
 * THE FIXTURE IS THE REPORTED NUMBERS
 *
 * Pool $71,950.00 · billed $8,259.30 · difference $63,690.70 · 11.5% of the pool
 * billed · 100% of the property leased. The concentration invoice is drawn from a
 * vendor named after a tenant, which is the exact over-match that made a
 * property-level finding look tenant-specific.
 *
 * These are asserted against RENDERED OUTPUT — the banner in #resultsBody and the
 * report in #rptBody — because every defect of this class has been a rendering
 * defect that the unit suites were green through.
 *
 * DETERMINISM
 * Fixed timezone, fixed fixture, own port and localStorage key, no network egress.
 */
process.env.TZ = 'America/New_York';

const SKIP = process.env.SKIP_BROWSER_TESTS === '1';

let pw = null;
if (!SKIP) {
  try { pw = require('playwright'); }
  catch (_) {
    try { pw = require('/opt/node22/lib/node_modules/playwright'); }
    catch (_2) {
      console.error('\n\x1b[31mtest-e2e-variance-flow: playwright is not installed.\x1b[0m');
      console.error('This suite drives the reconciliation screen in a real browser and');
      console.error('cannot verify anything without one. Install playwright, or set');
      console.error('SKIP_BROWSER_TESTS=1 to deliberately skip it.\n');
      process.exit(1);
    }
  }
}
if (SKIP) {
  console.log('\n\x1b[33m⚠ test-e2e-variance-flow SKIPPED (SKIP_BROWSER_TESTS=1).\x1b[0m');
  console.log('  The variance CTA and the exception scope column were NOT verified.\n');
  process.exit(0);
}
const { chromium } = pw;

const http = require('http');
const fs   = require('fs');
const path = require('path');

const ROOT     = __dirname;
const PORT     = parseInt(process.env.APP_PORT || '7953', 10);
const HEADLESS = process.env.HEADLESS !== '0';
const CHROME   = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css',
               '.json':'application/json', '.png':'image/png', '.svg':'image/svg+xml',
               '.mp4':'video/mp4', '.webm':'video/webm', '.woff2':'font/woff2' };

let pass = 0, fail = 0;
const ok  = (m) => { console.log('  \x1b[32m✓\x1b[0m ' + m); pass++; };
const bad = (m, d) => { console.log('  \x1b[31m✗\x1b[0m ' + m + (d ? '\n      → ' + d : '')); fail++; };
const yes = (m, c, d) => c ? ok(m) : bad(m, d);
const R   = (l, v) => console.log('  ' + String(l).padEnd(44) + ':', typeof v === 'string' ? v : JSON.stringify(v));

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

// ── The fixture ──────────────────────────────────────────────────────────────
// 100,000 sqft, fully leased by three expired leases, CAM year 2026.
const PROP_ID = 'vf-prop-000000000001';
const TENANTS = [
  { id: 'vf-t-shonac', tenant_name: 'SHONAC CORPORATION', leased_sqft: 50000,
    lease_type: 'Triple Net (NNN)', start_date: '2006-03-01', end_date: '2016-02-28',
    cap: '5', capBaseAmount: '40000', excluded_categories: '', status: 'complete' },
  { id: 'vf-t-tollgr', tenant_name: 'Tollgrade', leased_sqft: 30000,
    lease_type: 'Triple Net (NNN)', start_date: '1998-05-01', end_date: '2008-04-30',
    cap: '5', capBaseAmount: '40000', excluded_categories: '', status: 'complete' },
  { id: 'vf-t-digriv', tenant_name: 'Digital River', leased_sqft: 20000,
    lease_type: 'Triple Net (NNN)', start_date: '1993-08-01', end_date: '2003-07-31',
    cap: '5', capBaseAmount: '40000', excluded_categories: '', status: 'complete' },
];

// 13 invoices totalling $71,950.00. Five are CAM-eligible and total $8,259.30;
// eight are marked not eligible. One of those eight is $38,000 (52.8% of the
// pool) from a vendor that shares a name with a tenant — the over-match case.
const doc = n => ({ fileName: n + '.pdf', fileUrl: 'https://mock.local/' + n + '.pdf' });
const INVOICES = [
  { id: 'vf-i-01', vendorName: 'SHONAC CORPORATION', amount: '38000', category: 'capital',
    invoiceDate: '2026-06-01', camEligible: false, ...doc('roof') },
  { id: 'vf-i-02', vendorName: 'Alpha Landscaping',  amount: '3000',   category: 'grounds',    invoiceDate: '2026-03-01', camEligible: true,  ...doc('alpha') },
  { id: 'vf-i-03', vendorName: 'Beta Janitorial',    amount: '2500',   category: 'janitorial', invoiceDate: '2026-04-01', camEligible: true,  ...doc('beta') },
  { id: 'vf-i-04', vendorName: 'Gamma Snow',         amount: '1200',   category: 'snow',       invoiceDate: '2026-01-15', camEligible: true,  ...doc('gamma') },
  { id: 'vf-i-05', vendorName: 'Delta Utilities',    amount: '900',    category: 'utilities',  invoiceDate: '2026-05-01', camEligible: true,  ...doc('delta') },
  { id: 'vf-i-06', vendorName: 'Epsilon Security',   amount: '659.30', category: 'security',   invoiceDate: '2026-07-01', camEligible: true,  ...doc('eps') },
  { id: 'vf-i-07', vendorName: 'Zeta Capital Works', amount: '3670',   category: 'capital',    invoiceDate: '2026-02-01', camEligible: false, ...doc('zeta') },
  { id: 'vf-i-08', vendorName: 'Eta Capital Works',  amount: '3670',   category: 'capital',    invoiceDate: '2026-02-02', camEligible: false, ...doc('eta') },
  { id: 'vf-i-09', vendorName: 'Theta Capital Works',amount: '3670',   category: 'capital',    invoiceDate: '2026-02-03', camEligible: false, ...doc('theta') },
  { id: 'vf-i-10', vendorName: 'Iota Capital Works', amount: '3670',   category: 'capital',    invoiceDate: '2026-02-04', camEligible: false, ...doc('iota') },
  { id: 'vf-i-11', vendorName: 'Kappa Capital Works',amount: '3670',   category: 'capital',    invoiceDate: '2026-02-05', camEligible: false, ...doc('kappa') },
  { id: 'vf-i-12', vendorName: 'Lambda Capital Works',amount:'3670',   category: 'capital',    invoiceDate: '2026-02-06', camEligible: false, ...doc('lambda') },
  { id: 'vf-i-13', vendorName: 'Mu Capital Works',   amount: '3670.70',category: 'capital',    invoiceDate: '2026-02-07', camEligible: false, ...doc('mu') },
];

const SUPABASE_MOCK = `
(function () {
  var USER_ID = 'vf-user';
  var _user = { id: USER_ID, email: 'vf@e2e-test.local' };
  var _session = null;
  var KEY = '__vf_store';
  var seed = {
    properties: [{
      id: ${JSON.stringify(PROP_ID)}, user_id: USER_ID, name: 'Happy Plaza', sqft: 100000,
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
  const server  = await startServer();
  const browser = await chromium.launch({
    headless: HEADLESS, executablePath: CHROME,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const ctx  = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.route('**', route => {
    const u = route.request().url();
    if (u.startsWith('http://127.0.0.1:' + PORT)) return route.continue();
    if (/supabase-js/.test(u)) {
      return route.fulfill({ status: 200, contentType: 'application/javascript', body: '/* mocked */' });
    }
    return route.abort();
  });
  await page.addInitScript(SUPABASE_MOCK);
  await page.addInitScript(() => { window.__PROP_ID = 'vf-prop-000000000001'; });

  console.log('\n══ Variance flow — the banner must lead somewhere ══');

  // ── sign in and load ───────────────────────────────────────────────────────
  await page.goto('http://127.0.0.1:' + PORT + '/?signin=1', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('#loginBtn', { state: 'visible', timeout: 20000 });
  await page.fill('#loginEmail', 'vf@e2e-test.local');
  await page.fill('#loginPassword', 'TestPass123!');
  await page.click('#loginBtn');
  await page.waitForFunction(() => {
    const app = document.getElementById('appContent');
    return app && app.style.display !== 'none' && app.style.display !== '';
  }, { timeout: 20000 });
  await page.waitForFunction(() => typeof _props !== 'undefined' && Array.isArray(_props) && _props.length > 0,
                             { timeout: 20000 });
  await page.evaluate(() => selectProperty(window.__PROP_ID));
  await page.waitForFunction(() => typeof tenantData !== 'undefined'
    && tenantData.filter(Boolean).length === 3, { timeout: 20000 });

  yes('the module the panel depends on is actually loaded',
      await page.evaluate(() => !!(window.VarianceBreakdown && window.VarianceBreakdown.derive)),
      'variance-breakdown.js is not on the page — every assertion below would be vacuous');

  // ── run the reconciliation ─────────────────────────────────────────────────
  console.log('\n── The reported reconciliation ──');
  await page.evaluate(async () => { await runAllocation(); });
  await page.waitForFunction(() => typeof lastResults !== 'undefined' && lastResults.length === 3,
                             { timeout: 20000 });

  const run = await page.evaluate(() => ({
    pool:   lastTotal,
    billed: +lastResults.reduce((s, r) => s + r.totalAllocated, 0).toFixed(2),
    proRata: +lastResults.reduce((s, r) => s + r.proRataPercent, 0).toFixed(2),
    invoices: invoiceData.filter(Boolean).length,
  }));
  R('expense pool', '$' + run.pool.toLocaleString());
  R('allocated to tenants', '$' + run.billed.toLocaleString());
  R('difference', '$' + (run.pool - run.billed).toFixed(2));
  R('property covered', run.proRata + '%');
  yes('the fixture reproduces the reported numbers',
      run.pool === 71950 && run.billed === 8259.30 && run.proRata === 100,
      JSON.stringify(run));

  // ── the banner ─────────────────────────────────────────────────────────────
  console.log('\n── Step 1: the banner is pressable and names a next step ──');
  const banner = await page.evaluate(() => {
    const el = document.querySelector('#resultsBody .rcs-variance-banner');
    if (!el) return { found: false };
    const cta = el.querySelector('.rcs-variance-cta');
    return {
      found: true,
      text:    el.textContent.replace(/\s+/g, ' ').trim(),
      role:    el.getAttribute('role'),
      tabindex: el.getAttribute('tabindex'),
      onclick: el.getAttribute('onclick') || '',
      keydown: !!el.getAttribute('onkeydown'),
      ctaText: cta ? cta.textContent.replace(/\s+/g, ' ').trim() : null,
      ctaClick: cta ? (cta.getAttribute('onclick') || '') : null,
      diagnostic: /Reconciliation variance detected/.test(el.textContent),
    };
  });
  R('banner branch', banner.diagnostic ? 'diagnostic (coverage complete)' : 'partial coverage');
  R('cta', banner.ctaText);
  yes('the banner rendered', banner.found, JSON.stringify(banner));
  yes('this is the diagnostic branch — coverage is not the explanation',
      banner.diagnostic, banner.text);
  yes('the banner itself is pressable',
      banner.role === 'button' && banner.tabindex === '0' && /openVarianceDetails\(\)/.test(banner.onclick),
      JSON.stringify({ role: banner.role, onclick: banner.onclick }));
  yes('and reachable from the keyboard', banner.keydown, 'no onkeydown handler');
  yes('it carries an explicit next step',
      !!banner.ctaText && /^Next step:/.test(banner.ctaText), String(banner.ctaText));
  yes('the next step names THIS run\'s cause, not generic advice',
      /CAM-eligible/i.test(banner.ctaText || ''), String(banner.ctaText));
  yes('the dead-end advice is gone',
      !/Re-check invoice amounts or re-run allocation/.test(banner.text), banner.text);
  yes('the banner says what the gap is made of',
      /not CAM-eligible/i.test(banner.text) && /\$63,690\.70/.test(banner.text), banner.text);

  // Every BARE call in the handler — `event.stopPropagation()` is a method on a
  // local and is skipped, `openVarianceDetails()` is a global and is not. A
  // dead-end CTA is precisely a handler naming something that does not exist, so
  // this checks all of them rather than only the first.
  const wired = await page.evaluate((ocs) => {
    const names = new Set();
    ocs.filter(Boolean).forEach(oc => {
      oc.replace(/(^|[;{(\s])([A-Za-z_$][\w$]*)\s*\(/g, (_, _p, n) => { names.add(n); return ''; });
    });
    return [...names].filter(n => !['if', 'return', 'typeof'].includes(n))
      .map(n => ({ fn: n, exists: typeof window[n] === 'function' }));
  }, [banner.ctaClick, banner.onclick]);
  R('CTA wiring', wired);
  yes('every function the banner names actually exists',
      wired.length > 0 && wired.every(w => w.exists), JSON.stringify(wired));
  yes('and one of them is the details panel',
      wired.some(w => w.fn === 'openVarianceDetails'), JSON.stringify(wired));

  // ── press it ───────────────────────────────────────────────────────────────
  console.log('\n── Step 2: pressing it opens Variance details ──');
  const panel = await page.evaluate(async () => {
    document.querySelector('#resultsBody .rcs-variance-cta').click();
    await new Promise(r => setTimeout(r, 400));
    const ov = document.getElementById('reportOverlay');
    const body = document.getElementById('rptBody');
    const txt = body ? body.textContent.replace(/\s+/g, ' ') : '';
    const tables = body ? [...body.querySelectorAll('table')] : [];
    const rows = t => t ? [...t.querySelectorAll('tbody tr')].map(
      r => [...r.querySelectorAll('td')].map(c => c.textContent.replace(/\s+/g, ' ').trim())) : [];
    return {
      open:  !!ov && ov.style.display === 'block',
      title: (document.getElementById('rptToolbarTitle') || {}).textContent,
      text:  txt,
      headline: rows(tables[0]),
      buckets:  rows(tables[1]),
      invoices: rows(tables[2]),
      actionBtn: (() => { const b = body.querySelector('.rpt-action-btn');
        return b ? { text: b.textContent.trim(), onclick: b.getAttribute('onclick') } : null; })(),
    };
  });
  R('panel opened', panel.open);
  R('title', panel.title);
  console.log('  headline:');
  panel.headline.forEach(r => console.log('     ', r.join('  →  ')));
  console.log('  made up of:');
  panel.buckets.forEach(r => console.log('     ', r[0], '→', r[1]));

  yes('the panel opens', panel.open && /variance details/i.test(panel.title || ''),
      JSON.stringify({ open: panel.open, title: panel.title }));

  const headline = Object.fromEntries(panel.headline.map(r => [r[0], r[1]]));
  yes('it states the expense pool', headline['Expense pool'] === '$71,950.00', JSON.stringify(headline));
  yes('it states what was allocated', headline['Allocated to tenants'] === '$8,259.30', JSON.stringify(headline));
  yes('it states the difference', headline['Difference'] === '$63,690.70', JSON.stringify(headline));
  yes('it states the coverage percentage the reader asked for',
      headline['Share of the pool that reached a tenant'] === '11.5%', JSON.stringify(headline));
  yes('and distinguishes that from how much of the property is leased',
      headline['Property covered by loaded leases'] === '100.0%', JSON.stringify(headline));

  const buckets = Object.fromEntries(panel.buckets.map(r => [r[0], r[1]]));
  yes('the cause is named explicitly rather than left to the reader',
      buckets['Marked not CAM-eligible'] === '$63,690.70', JSON.stringify(buckets));
  yes('no unattributed remainder is hidden',
      !Object.keys(buckets).some(k => /not attributed/i.test(k)), JSON.stringify(buckets));
  yes('it says so in words too',
      /Every dollar of the difference is accounted for/.test(panel.text), panel.text.slice(0, 400));

  yes('it says how many invoices reached no tenant, in the reader\'s terms',
      /8 of the 13 invoices in this pool contributed nothing/.test(panel.text),
      panel.text.slice(0, 600));
  yes('every invoice in the pool is listed, not only the unallocated ones',
      panel.invoices.length === 13, `${panel.invoices.length} rows`);

  const roof = panel.invoices.find(r => /SHONAC/.test(r[0]));
  R('the $38,000 row', roof);
  yes('each row says what happened to that invoice',
      !!roof && roof[2] === '$38,000.00' && roof[3] === '$0.00' && /not CAM-eligible/i.test(roof[5]),
      JSON.stringify(roof));

  const billedRow = panel.invoices.find(r => /Alpha Landscaping/.test(r[0]));
  yes('a fully-allocated invoice reads as fully allocated',
      !!billedRow && billedRow[2] === '$3,000.00' && billedRow[3] === '$3,000.00' && billedRow[4] === '—',
      JSON.stringify(billedRow));

  yes('the panel offers a way to act on it', !!panel.actionBtn, 'no action button');
  yes('and that way is navigation, not a state change',
      !!panel.actionBtn && /^openVarianceFix\(/.test(panel.actionBtn.onclick || ''),
      JSON.stringify(panel.actionBtn));

  // ── the next step navigates and changes nothing ────────────────────────────
  console.log('\n── Step 3: the next step navigates, and changes nothing ──');
  const nav = await page.evaluate(async () => {
    const snap = () => ({
      billed:   +lastResults.reduce((s, r) => s + r.totalAllocated, 0).toFixed(2),
      eligible: invoiceData.filter(Boolean).filter(i => i.camEligible !== false).length,
      pool:     lastTotal,
    });
    const before = snap();
    document.querySelector('#rptBody .rpt-action-btn').click();
    await new Promise(r => setTimeout(r, 500));
    const pane = document.getElementById('wsPane-property');
    return {
      before, after: snap(),
      reportClosed: (document.getElementById('reportOverlay') || {}).style.display !== 'block',
      landedOn: pane && pane.style.display === 'block' ? 'property' : null,
      registerOnScreen: !!document.querySelector('#wsPane-property .pos-reg'),
    };
  });
  R('landed on pane', nav.landedOn);
  R('invoice register present', nav.registerOnScreen);
  R('before / after', [nav.before, nav.after]);
  yes('the report closes behind you', nav.reportClosed, 'the overlay stayed open');
  yes('it lands on the pane that holds the control', nav.landedOn === 'property', String(nav.landedOn));
  yes('and specifically on the invoice register', nav.registerOnScreen, 'the register is not on screen');
  yes('nothing about the reconciliation changed',
      nav.before.billed === nav.after.billed && nav.before.pool === nav.after.pool
        && nav.before.eligible === nav.after.eligible,
      JSON.stringify([nav.before, nav.after]));

  // ── the other branch of the same banner ────────────────────────────────────
  //
  // The banner has two branches and BOTH were dead ends. The grey one is not a
  // warning — partial coverage is expected while leases are still being loaded —
  // but a reader still has no way to find out what the unallocated remainder is
  // made of, and on this fixture coverage is only part of the answer.
  console.log('\n── Step 4: the partial-coverage branch leads somewhere too ──');
  const partial = await page.evaluate(async () => {
    const t = tenantData.filter(Boolean).find(x => x.tenant_name === 'Digital River');
    t.leased_sqft = 2000;                       // 100% → 82% covered
    currentProperty().tenants = tenantData.filter(Boolean);
    await runAllocation();
    await new Promise(r => setTimeout(r, 300));
    const el = document.querySelector('#resultsBody .rcs-variance-banner');
    const cta = el ? el.querySelector('.rcs-variance-cta') : null;
    return {
      found: !!el,
      partialBranch: !!el && /Partial property coverage/.test(el.textContent),
      opens: !!el && /openVarianceDetails\(\)/.test(el.getAttribute('onclick') || ''),
      ctaText: cta ? cta.textContent.replace(/\s+/g, ' ').trim() : null,
      proRata: +lastResults.reduce((s, r) => s + r.proRataPercent, 0).toFixed(1),
    };
  });
  R('coverage now', partial.proRata + '%');
  R('cta', partial.ctaText);
  yes('the banner switched to the partial-coverage branch',
      partial.found && partial.partialBranch && partial.proRata < 98, JSON.stringify(partial));
  yes('and that branch is pressable as well', partial.opens, JSON.stringify(partial));
  yes('with a next step of its own',
      !!partial.ctaText && /^Next step:/.test(partial.ctaText), String(partial.ctaText));

  const partialPanel = await page.evaluate(async () => {
    document.querySelector('#resultsBody .rcs-variance-cta').click();
    await new Promise(r => setTimeout(r, 400));
    const body = document.getElementById('rptBody');
    const rows = [...body.querySelectorAll('table')][1];
    const b = rows ? [...rows.querySelectorAll('tbody tr')].map(
      r => [...r.querySelectorAll('td')].map(c => c.textContent.replace(/\s+/g, ' ').trim())) : [];
    return { buckets: Object.fromEntries(b.map(r => [r[0], r[1]])),
             text: body.textContent.replace(/\s+/g, ' ') };
  });
  console.log('  made up of:');
  Object.entries(partialPanel.buckets).forEach(([k, v]) => console.log('     ', k, '→', v));
  yes('the panel now separates the coverage share from the eligibility flag',
      Object.keys(partialPanel.buckets).some(k => /Outside the .* covered by loaded leases/.test(k))
        && !!partialPanel.buckets['Marked not CAM-eligible'],
      JSON.stringify(partialPanel.buckets));
  yes('and still leaves nothing unattributed',
      !Object.keys(partialPanel.buckets).some(k => /not attributed/i.test(k)),
      JSON.stringify(partialPanel.buckets));

  // Put the property back before the statement assertions, so those run against
  // the reported fixture rather than this one.
  await page.evaluate(async () => {
    closeReport();
    const t = tenantData.filter(Boolean).find(x => x.tenant_name === 'Digital River');
    t.leased_sqft = 20000;
    currentProperty().tenants = tenantData.filter(Boolean);
    await runAllocation();
    await new Promise(r => setTimeout(r, 300));
  });


  // ══ I-1 / I-2 · the source-value fixes, on the real screens ══
  //
  // Both defects were surfaces disagreeing, not functions being wrong, so they
  // are asserted here on what the app actually does rather than on the readers.
  console.log('\n══ I-1: a formatted square footage no longer vanishes ══');
  const sv1 = await page.evaluate(async () => {
    const ts = tenantData.filter(Boolean);
    ts[0].leased_sqft = '50,000';        // as a person types it, or an extractor reads it
    ts[1].leased_sqft = 30000;
    ts[2].leased_sqft = 20000;
    currentProperty().tenants = ts;
    await runAllocation();
    await new Promise(r => setTimeout(r, 400));
    const sec = document.getElementById('results');
    const st  = deriveTenantReviewState(ts[0]);
    return {
      reachedEngine: lastResults.some(r => r.name === ts[0].tenant_name),
      reconciled:    lastResults.map(r => r.name),
      allocated:     +(lastResults.find(r => r.name === ts[0].tenant_name) || {}).totalAllocated,
      proRataSum:    +lastResults.reduce((s, r) => s + r.proRataPercent, 0).toFixed(1),
      reviewState:   st.status,
      camBlocking:   st.camBlocking,
      sqftBanner:    !!sec.querySelector('.cam-sqft-warning'),
    };
  });
  Object.entries(sv1).forEach(([k, v]) => R(k, v));
  yes('the lease reaches the reconciliation instead of vanishing',
      sv1.reachedEngine === true && sv1.reconciled.length === 3, JSON.stringify(sv1));
  yes('it is allocated on the real area, and coverage is complete',
      sv1.proRataSum === 100 && sv1.allocated > 0, JSON.stringify(sv1));
  yes('and nothing warns that its area is missing, because it is not',
      sv1.sqftBanner === false && sv1.camBlocking.length === 0, JSON.stringify(sv1));
  yes('"verified" is now a true statement about a lease that is in the run',
      sv1.reviewState === 'verified' && sv1.reachedEngine === true, sv1.reviewState);

  console.log('\n── an unreadable area is excluded AND says so ──');
  const sv2 = await page.evaluate(async () => {
    const ts = tenantData.filter(Boolean);
    ts[0].leased_sqft = 'see exhibit A';
    currentProperty().tenants = ts;
    await runAllocation();
    await new Promise(r => setTimeout(r, 400));
    const sec = document.getElementById('results');
    const st  = deriveTenantReviewState(ts[0]);
    const out = {
      reachedEngine: lastResults.some(r => r.name === ts[0].tenant_name),
      reviewState: st.status, camBlocking: st.camBlocking,
      requiredGaps: st.requiredGaps,
      bannerNamesIt: (() => { const b = sec.querySelector('.cam-sqft-warning');
        return b ? b.textContent.indexOf(ts[0].tenant_name) >= 0 : false; })(),
    };
    ts[0].leased_sqft = 50000; currentProperty().tenants = ts;   // restore
    return out;
  });
  Object.entries(sv2).forEach(([k, v]) => R(k, v));
  yes('THE SILENT DROP IS GONE: excluded and warned, never one without the other',
      sv2.reachedEngine === false && sv2.bannerNamesIt === true
        && sv2.camBlocking.length === 1 && sv2.reviewState !== 'verified',
      JSON.stringify(sv2));
  yes('and the card lists it as a required field to fill in',
      sv2.requiredGaps.some(g => /square footage/i.test(g)), JSON.stringify(sv2.requiredGaps));

  console.log('\n══ I-2: the pool the screen shows is the pool the engine allocates ══');
  const sv3 = await page.evaluate(async () => {
    invoiceData.forEach(i => { if (i) i.camEligible = true; });
    invoiceData[0].amount = '$1,250.00';      // currency symbol + separator
    invoiceData[1].amount = '2,000.00';       // separator only
    invoiceData[2].amount = 'TBD';            // genuinely unreadable
    canonicaliseInvoiceAmounts(invoiceData);
    await runAllocation();
    await new Promise(r => setTimeout(r, 400));
    const billed = +lastResults.reduce((s, r) => s + r.totalAllocated, 0).toFixed(2);
    const bk = window.VarianceBreakdown.derive({
      results: lastResults, invoices: _lastEngineInvoices,
      pool: lastTotal, billed });
    return {
      stored: invoiceData.slice(0, 3).map(i => i.amount),
      unparsedKept: invoiceData[2].amountUnparsed,
      pool: lastTotal, billed, gap: +(lastTotal - billed).toFixed(2),
      residual: bk.residual, explained: bk.explained,
      skipBanner: (() => { const n = document.querySelector('#results .cam-skip-warning');
        return n ? n.textContent.replace(/\s+/g, ' ').trim().slice(0, 72) : null; })(),
    };
  });
  Object.entries(sv3).forEach(([k, v]) => R(k, v));
  yes('a currency-formatted amount is stored as a number',
      sv3.stored[0] === 1250 && sv3.stored[1] === 2000, JSON.stringify(sv3.stored));
  yes('THE POOL AND THE ALLOCATION AGREE — no unattributed remainder',
      sv3.gap === 0 && sv3.residual === 0 && sv3.explained === true, JSON.stringify(sv3));
  yes('an unreadable amount is not silently priced at zero',
      sv3.stored[2] === '' && sv3.unparsedKept === 'TBD', JSON.stringify(sv3));
  yes('it is reported as an excluded invoice instead',
      !!sv3.skipBanner && /no amount were excluded/i.test(sv3.skipBanner), String(sv3.skipBanner));

  // Restore the fixture so the statement assertions below run against it.
  await page.evaluate(async () => {
    const seed = { 'vf-i-01': '38000', 'vf-i-02': '3000', 'vf-i-03': '2500' };
    invoiceData.forEach(i => { if (i && seed[i.id]) { i.amount = seed[i.id]; delete i.amountUnparsed; } });
    invoiceData[0].camEligible = false;
    canonicaliseInvoiceAmounts(invoiceData);
    await runAllocation();
    await new Promise(r => setTimeout(r, 300));
  });

  // ── the blocked statement's scope column ───────────────────────────────────
  console.log('\n══ Blocked statement — scope, not a blank ══');
  const stmt = await page.evaluate(async () => {
    generateTenantStatement('SHONAC CORPORATION');
    await new Promise(r => setTimeout(r, 500));
    const body = document.getElementById('rptBody');
    const tbl  = body ? body.querySelector('table') : null;
    return {
      title:   (document.getElementById('rptToolbarTitle') || {}).textContent,
      blocked: /THIS STATEMENT HAS NOT BEEN ISSUED/i.test(body ? body.textContent : ''),
      lead:    (body.querySelector('.rpt-helper-text') || {}).textContent.replace(/\s+/g, ' ').trim(),
      headers: tbl ? [...tbl.querySelectorAll('thead th')].map(h => h.textContent.trim()) : [],
      rows: tbl ? [...tbl.querySelectorAll('tbody tr')].map(
        r => [...r.querySelectorAll('td')].map(c => c.textContent.replace(/\s+/g, ' ').trim())) : [],
    };
  });
  R('title', stmt.title);
  R('headers', stmt.headers);
  console.log('  rows:');
  stmt.rows.forEach(r => console.log('     ', JSON.stringify(r)));
  R('lead', stmt.lead);

  yes('the statement is still refused', stmt.blocked, 'the billing gate stopped refusing');
  yes('the column is headed Scope, not "Names this tenant"',
      stmt.headers[0] === 'Scope', JSON.stringify(stmt.headers));

  const scopeOf = re => (stmt.rows.find(r => re.test(r[1] || '')) || [])[0];
  const concentration = scopeOf(/Unusually large invoice/);
  const mineRow       = scopeOf(/SHONAC CORPORATION is being billed/);
  const otherRow      = scopeOf(/Tollgrade is being billed/);
  R('concentration row scope', concentration);
  R('SHONAC expired-lease row scope', mineRow);
  R('Tollgrade expired-lease row scope', otherRow);

  yes('a property-level exception says Property-wide',
      concentration === 'Property-wide', String(concentration));
  yes('THE OVER-MATCH IS GONE: a vendor named after a tenant is not that tenant\'s exception',
      concentration !== 'This tenant',
      'the $38,000 invoice from a vendor called SHONAC CORPORATION is still attributed to the tenant');
  yes('this tenant\'s own exception still says This tenant',
      mineRow === 'This tenant', String(mineRow));
  yes('another tenant\'s exception names that tenant instead of an em dash',
      otherRow === 'Tollgrade', String(otherRow));
  yes('no row in the scope column is a bare em dash',
      !stmt.rows.some(r => r[0] === '—'),
      JSON.stringify(stmt.rows.map(r => r[0])));

  yes('the lead counts only exceptions that really name this tenant',
      /1 of the \d+ blocking exceptions names SHONAC CORPORATION directly/.test(stmt.lead), stmt.lead);
  yes('and says how many belong to the property as a whole',
      /property-wide/.test(stmt.lead) && /not to any one tenant/.test(stmt.lead), stmt.lead);

  yes('no uncaught page errors', errors.length === 0, errors.join(' | '));

  const EXPECTED = 55;
  yes(`suite runs all ${EXPECTED} checks`, pass + fail === EXPECTED + 1, `ran ${pass + fail}`);

  await browser.close();
  server.close();

  console.log('\n' + '─'.repeat(56));
  if (fail) { console.log(`\x1b[31mRESULT: ${pass} passed, ${fail} failed\x1b[0m`); process.exit(1); }
  console.log(`\x1b[32mRESULT: ${pass} passed, 0 failed\x1b[0m`);
})().catch(e => { console.error('\n\x1b[31mHARNESS FAILURE:\x1b[0m', e); process.exit(1); });
