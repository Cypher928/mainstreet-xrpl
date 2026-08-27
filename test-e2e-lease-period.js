'use strict';
/**
 * test-e2e-lease-period.js — T1 on screen: the four interval cases, in a browser.
 *
 *   node test-e2e-lease-period.js
 *
 * WHY THIS EXISTS SEPARATELY FROM test-lease-period.js
 *
 * The unit suite proves the detector emits the right findings. It cannot prove
 * the manager sees them, and this exact class of defect was invisible to unit
 * tests for its whole life: a lease commencing mid-period produced a row reading
 * "Calc verified · Billable", an issued statement for twelve months, and not one
 * finding at any severity. Every function underneath was behaving.
 *
 * WHAT IS ASSERTED — Kestrel Point, four cases in one run
 *
 *   Alder Bakery      full period            -> billable, statement issues
 *   Elm Stationers    full period            -> billable, statement issues
 *   Birch Optical     ends 2026-09-30        -> Needs confirmation, held
 *   Cedar Fitness     begins 2026-04-01      -> Needs confirmation, held  <- was silent
 *   Dogwood Deli      ended 2025-12-31       -> Blocked, red holdover
 *
 * AND THE MONEY DOES NOT MOVE. T1 is classification and wording only. The pool
 * is $100,000 and the property is exactly 100% leased, so every allocation is a
 * clean area share — Birch is $20,000, its full 20%, NOT $15,000 for nine
 * months. Apportionment is T2's question and this suite pins that T1 did not
 * quietly answer it.
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
      console.error('\n\x1b[31mtest-e2e-lease-period: playwright is not installed.\x1b[0m');
      console.error('This suite drives the reconciliation screen in a real browser and cannot');
      console.error('verify anything without one. Install playwright, or set');
      console.error('SKIP_BROWSER_TESTS=1 to deliberately skip it.\n');
      process.exit(1);
    }
  }
}
if (SKIP) {
  console.log('\n\x1b[33m⚠ test-e2e-lease-period SKIPPED (SKIP_BROWSER_TESTS=1).\x1b[0m');
  console.log('  The lease-term vs CAM-period cases were NOT verified on screen.\n');
  process.exit(0);
}
const { chromium } = pw;

const http = require('http');
const fs   = require('fs');
const path = require('path');

const ROOT     = __dirname;
const PORT     = parseInt(process.env.APP_PORT || '7967', 10);
const HEADLESS = process.env.HEADLESS !== '0';
const CHROME   = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css',
               '.json':'application/json', '.png':'image/png', '.svg':'image/svg+xml',
               '.mp4':'video/mp4', '.webm':'video/webm', '.woff2':'font/woff2' };

let pass = 0, fail = 0;
const ok  = (m) => { console.log('  \x1b[32m✓\x1b[0m ' + m); pass++; };
const bad = (m, d) => { console.log('  \x1b[31m✗\x1b[0m ' + m + (d ? '\n      → ' + d : '')); fail++; };
const yes = (m, c, d) => c ? ok(m) : bad(m, d);
const R   = (l, v) => console.log('  ' + String(l).padEnd(38) + ':', typeof v === 'string' ? v : JSON.stringify(v));

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

// ── Kestrel Point ────────────────────────────────────────────────────────────
// 50,000 sqft, leased to exactly 100% so no coverage finding competes with the
// four cases under test. No caps, no exclusions, every invoice documented and
// in year — anything raised here is about lease dates and nothing else.
const PROP_ID = 'kp-prop-000000000001';
const TENANTS = [
  { id: 'kp-t-alder', tenant_name: 'Alder Bakery',    leased_sqft: 12000,
    lease_type: 'Triple Net (NNN)', start_date: '2020-01-01', end_date: '2030-12-31',
    cap: '', capBaseAmount: '', excluded_categories: '', status: 'complete' },
  { id: 'kp-t-birch', tenant_name: 'Birch Optical',   leased_sqft: 10000,
    lease_type: 'Triple Net (NNN)', start_date: '2019-06-01', end_date: '2026-09-30',
    cap: '', capBaseAmount: '', excluded_categories: '', status: 'complete' },
  { id: 'kp-t-cedar', tenant_name: 'Cedar Fitness',   leased_sqft: 13000,
    lease_type: 'Triple Net (NNN)', start_date: '2026-04-01', end_date: '2033-03-31',
    cap: '', capBaseAmount: '', excluded_categories: '', status: 'complete' },
  { id: 'kp-t-dogwd', tenant_name: 'Dogwood Deli',    leased_sqft: 7000,
    lease_type: 'Triple Net (NNN)', start_date: '2018-02-01', end_date: '2025-12-31',
    cap: '', capBaseAmount: '', excluded_categories: '', status: 'complete' },
  { id: 'kp-t-elm',   tenant_name: 'Elm Stationers',  leased_sqft: 8000,
    lease_type: 'Triple Net (NNN)', start_date: '2021-01-01', end_date: '2028-12-31',
    cap: '', capBaseAmount: '', excluded_categories: '', status: 'complete' },
];

// $100,000 flat. Largest invoice is 24% of the pool, well under the 40%
// materiality threshold, so no concentration finding appears to muddy the run.
const doc = n => ({ fileName: n + '.pdf', fileUrl: 'https://mock.local/' + n + '.pdf' });
const INVOICES = [
  { id: 'kp-i-01', vendorName: 'Summit Janitorial', amount: '24000', category: 'janitorial', invoiceDate: '2026-02-01', camEligible: true, ...doc('sum') },
  { id: 'kp-i-02', vendorName: 'Vale Insurance',    amount: '20000', category: 'insurance',  invoiceDate: '2026-01-15', camEligible: true, ...doc('vale') },
  { id: 'kp-i-03', vendorName: 'Ridge Utilities',   amount: '18000', category: 'utilities',  invoiceDate: '2026-03-01', camEligible: true, ...doc('ridge') },
  { id: 'kp-i-04', vendorName: 'Fern Grounds',      amount: '14000', category: 'grounds',    invoiceDate: '2026-05-01', camEligible: true, ...doc('fern') },
  { id: 'kp-i-05', vendorName: 'Larch Elevator',    amount: '13000', category: 'elevator',   invoiceDate: '2026-06-01', camEligible: true, ...doc('larch') },
  { id: 'kp-i-06', vendorName: 'Moss Waste',        amount: '11000', category: 'waste',      invoiceDate: '2026-07-01', camEligible: true, ...doc('moss') },
];

// Area share × occupancy factor × $100,000. The two multiplicands are
// independent, and only the mid-period tenants carry a factor below 1.
const EXPECTED_ALLOCATION = {
  'Alder Bakery':   '$24,000.00',   // 24%, full period
  'Birch Optical':  '$14,958.90',   // 20% x 273/365 (ends 2026-09-30)
  'Cedar Fitness':  '$19,589.04',   // 26% x 275/365 (begins 2026-04-01)
  'Dogwood Deli':   '$14,000.00',   // holdover — NOT apportioned, held instead
  'Elm Stationers': '$16,000.00',   // 16%, full period
};

const SUPABASE_MOCK = `
(function () {
  var USER_ID = 'kp-user';
  var _user = { id: USER_ID, email: 'kp@e2e-test.local' };
  var _session = null;
  var KEY = '__kp_store';
  var seed = {
    properties: [{
      id: ${JSON.stringify(PROP_ID)}, user_id: USER_ID, name: 'Kestrel Point', sqft: 50000,
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

  console.log('\n══ Lease term vs CAM period — Kestrel Point ══');

  await page.goto('http://127.0.0.1:' + PORT + '/?signin=1', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('#loginBtn', { state: 'visible', timeout: 20000 });
  // The button paints with the HTML; submitAuth() arrives with script.js. The
  // form is wired as onsubmit="submitAuth(event)", an inline attribute, so a
  // click in the gap between those two moments fires a ReferenceError and is
  // LOST — after which the suite waits out its full timeout for an app that was
  // never told to sign in. Three suites failed this way intermittently, only
  // ever inside the full regression, where a dozen browsers have already run.
  // Waiting for the handler states the real precondition.
  await page.waitForFunction(() => typeof submitAuth === 'function', null, { timeout: 45000 });
  await page.fill('#loginEmail', 'kp@e2e-test.local');
  await page.fill('#loginPassword', 'TestPass123!');
  await page.click('#loginBtn');
  await page.waitForFunction(() => {
    const app = document.getElementById('appContent');
    return app && app.style.display !== 'none' && app.style.display !== '';
  }, null, { timeout: 45000 });
  await page.waitForFunction(() => typeof _props !== 'undefined' && Array.isArray(_props) && _props.length > 0, null,
                             { timeout: 45000 });
  await page.evaluate((id) => selectProperty(id), PROP_ID);
  await page.waitForFunction(() => typeof tenantData !== 'undefined'
    && tenantData.filter(Boolean).length === 5, null, { timeout: 45000 });

  yes('the module the whole change depends on is actually loaded',
      await page.evaluate(() => !!(window.LeasePeriod && window.LeasePeriod.classify)),
      'lease-period.js is not on the page — every assertion below would be vacuous');

  await page.evaluate(async () => { await runAllocation(); });
  await page.waitForFunction(() => typeof lastResults !== 'undefined' && lastResults.length === 5, null,
                             { timeout: 45000 });

  const run = await page.evaluate(() => {
    const AX = window.AuditExposure;
    const summary = buildAuditSummary();
    const expo = AX.deriveExposure(summary, lastTotal || 0);
    const g = s => { const e = document.querySelector('#resultsBody ' + s);
                     return e ? e.textContent.replace(/\s+/g, ' ').trim() : null; };
    const rows = [...document.querySelectorAll('#resultsBody table tr')]
      .map(tr => [...tr.querySelectorAll('td,th')].map(td => td.textContent.replace(/\s+/g, ' ').trim()))
      .filter(r => r.length > 3);
    const state = {};
    lastResults.forEach(r => { const s = _tenantBillingState(r.name, expo); state[r.name] = s.state; });
    const alloc = {};
    rows.slice(1).forEach(r => { if (r[0] && r[4]) alloc[r[0]] = r[4]; });
    return {
      pool: lastTotal,
      billed: +lastResults.reduce((s, r) => s + r.totalAllocated, 0).toFixed(2),
      proRataSum: +lastResults.reduce((s, r) => s + (r.proRataPercent || 0), 0).toFixed(2),
      alloc, rows, state,
      roster: g('.rcs-bill-roster'),
      red: summary.red.map(f => f.title),
      yellow: summary.yellow.map(f => f.title),
      propertyBlockers: ((expo.blocking || {}).property || []).map(b => b.title),
      byTenant: Object.fromEntries(Object.entries((expo.blocking || {}).byTenant || {})
        .map(([k, v]) => [k, v.map(b => b.title)])),
    };
  });

  console.log('\n── The run ──');
  R('pool', '$' + run.pool.toLocaleString());
  R('billed', '$' + run.billed.toLocaleString());
  R('property covered', run.proRataSum + '%');
  R('roster', run.roster);
  console.log('  results table:');
  run.rows.forEach(r => console.log('     ' + JSON.stringify(r)));

  yes('the fixture is fully leased, so no coverage finding competes',
      run.proRataSum === 100 && run.pool === 100000, JSON.stringify({ pool: run.pool, proRataSum: run.proRataSum }));

  // ── T2 MOVES THE MONEY, AND ONLY WHERE IT SHOULD ───────────────────────────
  console.log('\n── T2 apportions the mid-period tenants, and nobody else ──');
  R('allocations', run.alloc);
  yes('every allocation is the area share times the occupancy factor',
      Object.keys(EXPECTED_ALLOCATION).every(n => run.alloc[n] === EXPECTED_ALLOCATION[n]),
      JSON.stringify({ got: run.alloc, want: EXPECTED_ALLOCATION }));
  yes('    the full-period tenants are untouched by their neighbours\' dates',
      run.alloc['Alder Bakery'] === '$24,000.00' && run.alloc['Elm Stationers'] === '$16,000.00'
        && run.alloc['Dogwood Deli'] === '$14,000.00',
      'a tenant moved when a different tenant was apportioned — the share was redistributed');
  yes('    and the unoccupied share is NOT billed to anyone',
      Math.abs(run.billed - 88547.94) < 0.02,
      `${run.billed} — the pool should be under-billed by exactly the apportioned-away share`);

  // ── The four cases ─────────────────────────────────────────────────────────
  console.log('\n── Full-period leases are untouched ──');
  R('per-tenant state', run.state);
  yes('Alder Bakery is billable', run.state['Alder Bakery'] === 'billable', JSON.stringify(run.state));
  yes('Elm Stationers is billable', run.state['Elm Stationers'] === 'billable', JSON.stringify(run.state));
  yes('neither raises an occupancy finding',
      !run.red.concat(run.yellow).some(t => /Alder Bakery|Elm Stationers/.test(t)),
      JSON.stringify(run.red.concat(run.yellow)));

  console.log('\n── The mid-period EXPIRY: no longer described as already ended ──');
  const birch = run.yellow.find(t => /Birch Optical/.test(t));
  R('finding', birch);
  yes('it is raised at all', !!birch, JSON.stringify(run.yellow));
  yes('and it does NOT say the lease ended',
      !!birch && !/ended 2026-09-30/.test(birch),
      'still past tense about a date inside the period being billed');
  yes('it asks about the apportionment, since the lease does not state one',
      !!birch && /partial year is apportioned — the lease does not say/.test(birch), String(birch));
  yes('it holds the tenant for confirmation, not as a critical exception',
      run.state['Birch Optical'] === 'confirm', JSON.stringify(run.state));
  yes('and it is scoped to this tenant, not the property',
      (run.byTenant['Birch Optical'] || []).length === 1 && run.propertyBlockers.length === 0,
      JSON.stringify({ byTenant: run.byTenant, property: run.propertyBlockers }));

  console.log('\n── The mid-period COMMENCEMENT: the case that used to be silent ──');
  const cedar = run.yellow.find(t => /Cedar Fitness/.test(t));
  R('finding', cedar);
  yes('THE SILENT CASE IS CAUGHT — a lease commencing mid-period raises a finding',
      !!cedar, 'Cedar Fitness commenced 2026-04-01 and was billed twelve months with no finding');
  yes('it asks about the apportionment, since the lease does not state one',
      !!cedar && /partial year is apportioned — the lease does not say/.test(cedar), String(cedar));
  yes('and the tenant is held rather than billed',
      run.state['Cedar Fitness'] === 'confirm',
      'still "billable" — the row read Calc verified / Billable before T1');

  console.log('\n── The holdover: unchanged ──');
  const dogwood = run.red.find(t => /Dogwood Deli/.test(t));
  R('finding', dogwood);
  yes('it is still red', !!dogwood, JSON.stringify(run.red));
  yes('it still names the lease that ended',
      !!dogwood && /lease that ended 2025-12-31/.test(dogwood), String(dogwood));
  yes('and the tenant is blocked', run.state['Dogwood Deli'] === 'blocked', JSON.stringify(run.state));

  yes('the roster counts the two clean tenants',
      !!run.roster && /2 of 5 tenants billable/.test(run.roster), String(run.roster));

  // ── Statements ─────────────────────────────────────────────────────────────
  console.log('\n── What can actually be issued ──');
  const stmts = await page.evaluate(async () => {
    const out = {};
    for (const n of ['Alder Bakery', 'Elm Stationers', 'Birch Optical', 'Cedar Fitness', 'Dogwood Deli']) {
      const o = document.getElementById('reportOverlay'); if (o) o.style.display = 'none';
      generateTenantStatement(n);
      await new Promise(r => setTimeout(r, 350));
      const body = document.getElementById('rptBody');
      const txt = body ? body.textContent.replace(/\s+/g, ' ') : '';
      out[n] = {
        issued: !/has not been issued/i.test(txt),
        due: (txt.match(/Total CAM Billed to You\s*(\$[\d,]+\.\d\d)/) || [])[1] || null,
        saysEnded: /lease that ended 2026-09-30/.test(txt),
        // An EMPTY body must not read as issued: `!/has not been issued/` is
        // true of the empty string, so a statement that threw and rendered
        // nothing looked like a successful one. It did, while T2 was landing.
        rendered: txt.length > 0,
        head: txt.slice(0, 200),
      };
    }
    const o = document.getElementById('reportOverlay'); if (o) o.style.display = 'none';
    return out;
  });
  Object.entries(stmts).forEach(([k, v]) => R(k, v));

  yes('the two full-period tenants are billed their area share',
      stmts['Alder Bakery'].rendered && stmts['Alder Bakery'].due === '$24,000.00'
        && stmts['Elm Stationers'].rendered && stmts['Elm Stationers'].due === '$16,000.00',
      JSON.stringify({ alder: stmts['Alder Bakery'], elm: stmts['Elm Stationers'] }));
  yes('the three date cases are all held',
      !stmts['Birch Optical'].issued && !stmts['Cedar Fitness'].issued && !stmts['Dogwood Deli'].issued,
      JSON.stringify(stmts));
  yes('Birch\'s refusal asks for a confirmation, not for an expiry that has not happened',
      /Needs confirmation before billing/.test(stmts['Birch Optical'].head || '')
        && !stmts['Birch Optical'].saysEnded,
      JSON.stringify(stmts['Birch Optical']));
  yes('and a rendered statement is never mistaken for an issued one',
      Object.keys(EXPECTED_ALLOCATION).every(n => stmts[n].rendered === true),
      'a statement rendered nothing and was read as issued: ' + JSON.stringify(stmts));

  // ── The reduced-fidelity notice (change A) ────────────────────────────────
  // A reconciliation rebuilt from normalized summary rows must say what it
  // cannot tell you, and must say it ABOVE the KPI row it qualifies. Driven
  // here rather than in its own browser suite because this is the only thing
  // that needs a rendered panel and one boot is enough.
  // ── T2: the existing-lease experience ─────────────────────────────────────
  // Birch and Cedar carry no partial_period_basis — which is every lease in
  // Pilot today. The apportionment still happens, but the manager must be told
  // in plain words that the basis is this product's default and not something
  // the lease said, and must be able to settle it once.
  console.log('\n── T2: a lease that says nothing about partial years ──');
  const t2 = await page.evaluate(() => {
    const AX = window.AuditExposure;
    const summary = buildAuditSummary();
    const expo = AX.deriveExposure(summary, lastTotal || 0);
    const rows = [...document.querySelectorAll('#resultsBody table tr')]
      .map(tr => [...tr.querySelectorAll('td,th')].map(td => td.textContent.replace(/\s+/g, ' ').trim()))
      .filter(r => r.length > 3);
    const alloc = {}; rows.slice(1).forEach(r => { if (r[0] && r[4]) alloc[r[0]] = r[4]; });
    const state = {}; lastResults.forEach(r => { state[r.name] = _tenantBillingState(r.name, expo); });
    const occOf = n => (lastResults.find(r => r.name === n) || {}).occupancy || null;
    const f = summary.yellow.find(x => /partial year is apportioned/.test(x.title || ''));
    return {
      alloc,
      birchOcc: occOf('Birch Optical'), cedarOcc: occOf('Cedar Fitness'),
      birchPro: (lastResults.find(r => r.name === 'Birch Optical') || {}).proRataPercent,
      chips: Object.fromEntries(Object.entries(state).map(([k, v]) => [k, v.label])),
      finding: f ? { title: f.title, detail: f.detail, severity: f.severity, blocks: f.blocksBilling } : null,
      byTenant: Object.keys((expo.blocking || {}).byTenant || {}),
      basis: window.LeasePeriod.partialPeriodBasis(
        tenantData.find(t => t.tenant_name === 'Birch Optical')),
    };
  });
  R('allocations', t2.alloc);
  R('chips', t2.chips);
  R('Birch occupancy', t2.birchOcc && { n: t2.birchOcc.numerator, d: t2.birchOcc.denominator, src: t2.birchOcc.basisSource });

  yes('THE MONEY MOVES: a mid-period lease is now apportioned',
      t2.alloc['Birch Optical'] === '$14,958.90' && t2.alloc['Cedar Fitness'] === '$19,589.04',
      JSON.stringify(t2.alloc) + ' — expected 273/365 x $20,000 and 275/365 x $26,000');
  yes('    the full-period tenants are untouched',
      t2.alloc['Alder Bakery'] === '$24,000.00' && t2.alloc['Elm Stationers'] === '$16,000.00',
      JSON.stringify(t2.alloc));
  yes('    proRataPercent is still the SPATIAL share',
      t2.birchPro === 20, String(t2.birchPro));
  yes('    and the rational is stored, not just the decimal',
      !!t2.birchOcc && t2.birchOcc.numerator === 273 && t2.birchOcc.denominator === 365,
      JSON.stringify(t2.birchOcc));

  yes('the basis reads as this product\'s DEFAULT, never as the lease\'s',
      t2.basis.source === 'default' && t2.basis.stated === false, JSON.stringify(t2.basis));
  yes('the tenant is held once, and the finding says why in plain words',
      !!t2.finding && t2.finding.blocks === true && t2.finding.severity === 'yellow',
      JSON.stringify(t2.finding));
  yes('    the title says the LEASE does not say — not that something is wrong',
      !!t2.finding && /the lease does not say/.test(t2.finding.title), String(t2.finding && t2.finding.title));
  yes('    the detail names the default as ours, and states the arithmetic used',
      !!t2.finding && /this product's default, not a term of the lease/.test(t2.finding.detail)
        && /273 of 365 days/.test(t2.finding.detail),
      String(t2.finding && t2.finding.detail));
  yes('    and promises it is asked once',
      !!t2.finding && /will not be asked again/.test(t2.finding.detail), '');
  yes('    the chip says HELD, not "prorated"',
      t2.chips['Birch Optical'] === 'Needs confirmation', JSON.stringify(t2.chips));

  // ── Confirm it, and the hold clears ───────────────────────────────────────
  console.log('\n── Confirming the basis once ──');
  const after = await page.evaluate(async () => {
    const t = tenantData.find(x => x.tenant_name === 'Birch Optical');
    const okc = await confirmPartialPeriodBasis(t.id, 'per_diem');
    await runAllocation();
    await new Promise(r => setTimeout(r, 300));
    const AX = window.AuditExposure;
    const summary = buildAuditSummary();
    const expo = AX.deriveExposure(summary, lastTotal || 0);
    const st = _tenantBillingState('Birch Optical', expo);
    const t2b = tenantData.find(x => x.tenant_name === 'Birch Optical');
    return {
      okc,
      basis: window.LeasePeriod.partialPeriodBasis(t2b),
      conf: getFieldConfidence('partial_period_basis', t2b),
      label: st.label, state: st.state, partPeriod: !!st.partPeriod,
      stillHeld: summary.yellow.some(x => /partial year is apportioned/.test(x.title || '')
        && /Birch/.test(x.title)),
      allocated: (lastResults.find(r => r.name === 'Birch Optical') || {}).totalAllocated,
      cedarStillHeld: summary.yellow.some(x => /partial year is apportioned/.test(x.title || '')
        && /Cedar/.test(x.title)),
    };
  });
  R('after confirming', after);
  yes('the confirmation is recorded', after.okc === true, JSON.stringify(after));
  yes('and reads as MANUAL — a human decision, not a clause',
      after.basis.source === 'manual', JSON.stringify(after.basis));
  yes('    the confidence surface agrees it was manually set',
      after.conf.status === 'manual', JSON.stringify(after.conf));
  yes('the hold clears for that tenant',
      after.stillHeld === false && after.state === 'billable', JSON.stringify(after));
  yes('    and the chip distinguishes prorated from blocked',
      after.label === 'Billable \u00B7 part period' && after.partPeriod === true, String(after.label));
  yes('    the amount is unchanged by confirming — only the hold was',
      Math.abs(after.allocated - 14958.90) < 0.02, String(after.allocated));
  yes('the OTHER silent lease is still held — confirmation is per lease',
      after.cedarStillHeld === true, 'confirming one lease cleared another');

  console.log('\n── Rebuilt-record notice ──');
  const fid = await page.evaluate(async () => {
    const p = currentProperty();
    p.camReconciliation = Object.assign({}, p.camReconciliation, {
      fidelity: 'reduced',
      rebuiltFrom: 'cam_reconciliations',
      fidelityReasons: ['Reason one about invoices.', 'Reason two about <caps>.'],
    });
    await runAllocation();
    await new Promise(r => setTimeout(r, 300));
    const body = document.getElementById('resultsBody');
    const note = body ? body.querySelector('.rcs-fidelity') : null;
    const kpis = body ? body.querySelector('.rcs-kpis') : null;
    return {
      present: !!note,
      text: note ? note.textContent.replace(/\s+/g, ' ').trim() : null,
      items: note ? [...note.querySelectorAll('li')].map(li => li.textContent.trim()) : [],
      beforeKpis: !!(note && kpis && (note.compareDocumentPosition(kpis) & Node.DOCUMENT_POSITION_FOLLOWING)),
      rawHasScriptTag: note ? /<caps>/.test(note.innerHTML) : null,
    };
  });
  R('notice', fid.present);
  R('items', fid.items);
  yes('a rebuilt record renders the fidelity notice', fid.present, JSON.stringify(fid));
  yes('    it lists the reasons it was given',
      fid.items.length === 2 && /Reason one/.test(fid.items[0]), JSON.stringify(fid.items));
  yes('    it sits above the KPI row it qualifies', fid.beforeKpis, JSON.stringify(fid));
  yes('    and the reasons are escaped, not injected as markup',
      fid.rawHasScriptTag === false, 'a fidelity reason was interpolated unescaped');

  console.log('\n── Console ──');
  yes('no uncaught page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

  console.log('\n' + '─'.repeat(58));
  if (fail) console.log(`\x1b[31mRESULT: ${pass} passed, ${fail} failed\x1b[0m`);
  else      console.log(`\x1b[32mRESULT: ${pass} passed, 0 failed\x1b[0m`);

  await browser.close();
  server.close();
  process.exit(fail ? 1 : 0);
})().catch(e => {
  console.error('\n\x1b[31mtest-e2e-lease-period crashed:\x1b[0m', e && e.stack || e);
  process.exit(1);
});
