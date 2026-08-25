'use strict';
/**
 * test-e2e-cam-pool-loop.js — a correct remediation must actually clear the
 * blocker it is the remedy for.
 *
 *   node test-e2e-cam-pool-loop.js
 *
 * THE DEFECT THIS EXISTS FOR
 *
 * On Brookfield Commons a $70,000 roof replacement was sitting in the CAM pool.
 * The reconciliation raised it, correctly:
 *
 *   "Unusually large invoice — Summit Roofing Systems: $70,000.00
 *    (43.6% of total CAM)"
 *
 * Since I-4 that finding is a PROPERTY-level billing blocker, so all four
 * tenants read "Blocked" and no statement could be issued. The manager did the
 * right thing — a roof replacement is capital, not CAM — unticked "CAM eligible"
 * in the invoice register, and re-ran. The allocation obeyed: the roof vanished
 * from every tenant's expense detail. The finding did not move:
 *
 *   roofEligible     : false
 *   roofInAllocation : false          <- the engine obeyed
 *   redFindings      : ["…43.6% of total CAM"]     <- the detector did not
 *   propertyBlockers : [same]         -> 0 of 4 tenants billable
 *
 * The detector's own sentence said "% of total CAM" and it divided by the GROSS
 * expense total, so an invoice contributing nothing to CAM still cleared the 40%
 * materiality threshold. The remediation loop did not close. A blocker that a
 * correct action cannot clear is worse than one that is merely wrong: it tells
 * the manager the product is broken, and it is right.
 *
 * WHAT THIS ASSERTS — the loop, both directions
 *
 *   1. roof CAM-eligible          -> the property blocker appears
 *   2. the manager unticks it     -> through the real register control
 *   3. re-run
 *   4. the roof is absent from the engine's allocation
 *   5. the concentration finding is gone
 *   6. the property blocker is gone
 *   7. the previously-blocked tenants are billable again
 *   8. their statements actually issue
 *   9. INVERSE: re-tick it, re-run, and the blocker comes back
 *
 * Step 9 is not symmetry for its own sake. A detector that had simply been
 * deleted would pass steps 4–8 perfectly.
 *
 * AND ONE NEGATIVE: clearing a PROPERTY blocker must not wash out a TENANT's
 * own. Corner Market Grocers holds a Modified Gross lease and is held for an
 * unconfirmed CAM treatment — a yellow, tenant-scoped blocker that has nothing
 * to do with the roof. It stays blocked at every step. "Everything is billable
 * now" would be the easy way to pass steps 7 and 8 and a worse defect than the
 * one being fixed.
 *
 * These are asserted against RENDERED OUTPUT wherever there is any — the
 * billing status column, the roster line, the statement — because every defect
 * of this class has been visible on screen and green in the unit suites.
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
      console.error('\n\x1b[31mtest-e2e-cam-pool-loop: playwright is not installed.\x1b[0m');
      console.error('This suite drives the invoice register and the reconciliation screen in');
      console.error('a real browser and cannot verify anything without one. Install');
      console.error('playwright, or set SKIP_BROWSER_TESTS=1 to deliberately skip it.\n');
      process.exit(1);
    }
  }
}
if (SKIP) {
  console.log('\n\x1b[33m⚠ test-e2e-cam-pool-loop SKIPPED (SKIP_BROWSER_TESTS=1).\x1b[0m');
  console.log('  The CAM-eligibility remediation loop was NOT verified.\n');
  process.exit(0);
}
const { chromium } = pw;

const http = require('http');
const fs   = require('fs');
const path = require('path');

const ROOT     = __dirname;
const PORT     = parseInt(process.env.APP_PORT || '7961', 10);
const HEADLESS = process.env.HEADLESS !== '0';
const CHROME   = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css',
               '.json':'application/json', '.png':'image/png', '.svg':'image/svg+xml',
               '.mp4':'video/mp4', '.webm':'video/webm', '.woff2':'font/woff2' };

let pass = 0, fail = 0;
const ok  = (m) => { console.log('  \x1b[32m✓\x1b[0m ' + m); pass++; };
const bad = (m, d) => { console.log('  \x1b[31m✗\x1b[0m ' + m + (d ? '\n      → ' + d : '')); fail++; };
const yes = (m, c, d) => c ? ok(m) : bad(m, d);
const R   = (l, v) => console.log('  ' + String(l).padEnd(40) + ':', typeof v === 'string' ? v : JSON.stringify(v));

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

// ── The fixture: Brookfield Commons ──────────────────────────────────────────
//
// 100,000 sqft, fully leased by four current leases, CAM year 2026. Full
// coverage is deliberate — a partly-leased property raises a coverage finding of
// its own, and this suite is about ONE finding appearing and disappearing.
const PROP_ID = 'bf-prop-000000000001';
const TENANTS = [
  { id: 'bf-t-fair', tenant_name: 'Fairview Dental Group',       leased_sqft: 25000,
    lease_type: 'Triple Net (NNN)', start_date: '2021-01-01', end_date: '2028-12-31',
    cap: '', capBaseAmount: '', excluded_categories: '', status: 'complete' },
  { id: 'bf-t-lake', tenant_name: 'Lakeside Imaging Partners',   leased_sqft: 30000,
    lease_type: 'Triple Net (NNN)', start_date: '2020-06-01', end_date: '2030-05-31',
    cap: '', capBaseAmount: '', excluded_categories: '', status: 'complete' },
  { id: 'bf-t-pt',   tenant_name: 'Brookfield Physical Therapy', leased_sqft: 25000,
    lease_type: 'Triple Net (NNN)', start_date: '2022-03-01', end_date: '2029-02-28',
    cap: '', capBaseAmount: '', excluded_categories: '', status: 'complete' },
  // The control tenant. Modified Gross → a YELLOW, tenant-scoped blocker that
  // the roof has nothing to do with. It must survive the remediation.
  { id: 'bf-t-corn', tenant_name: 'Corner Market Grocers',       leased_sqft: 20000,
    lease_type: 'Modified Gross', start_date: '2019-09-01', end_date: '2027-08-31',
    cap: '', capBaseAmount: '', excluded_categories: '', status: 'complete' },
];

// Ten ordinary operating invoices totalling $90,500, plus one $70,000 roof.
// Gross $160,500. With the roof in CAM it is 43.6% of the pool — over the 40%
// materiality threshold, and the number the live run reported. With the roof
// held out the pool is $90,500 and the largest remaining invoice is 20.1%, so
// the finding must disappear entirely rather than merely shrink.
const ROOF_ID = 'bf-i-roof';
const doc = n => ({ fileName: n + '.pdf', fileUrl: 'https://mock.local/' + n + '.pdf' });
const INVOICES = [
  { id: ROOF_ID,     vendorName: 'Summit Roofing Systems', amount: '70000', category: 'repairs',
    invoiceDate: '2026-05-12', camEligible: true, ...doc('roof') },
  { id: 'bf-i-01', vendorName: 'PureSpace Janitorial', amount: '18200', category: 'janitorial', invoiceDate: '2026-02-01', camEligible: true, ...doc('pure') },
  { id: 'bf-i-02', vendorName: 'Hartwell Insurance',   amount: '14500', category: 'insurance',  invoiceDate: '2026-01-10', camEligible: true, ...doc('hart') },
  { id: 'bf-i-03', vendorName: 'ClimateCore HVAC',     amount: '12400', category: 'hvac',       invoiceDate: '2026-04-03', camEligible: true, ...doc('clim') },
  { id: 'bf-i-04', vendorName: 'Regional Power',       amount: '11200', category: 'utilities',  invoiceDate: '2026-03-01', camEligible: true, ...doc('regp') },
  { id: 'bf-i-05', vendorName: 'Riverside Management', amount: '11000', category: 'management', invoiceDate: '2026-06-01', camEligible: true, ...doc('rmgt') },
  { id: 'bf-i-06', vendorName: 'Otis Elevator',        amount: '9600',  category: 'elevator',   invoiceDate: '2026-02-15', camEligible: true, ...doc('otis') },
  { id: 'bf-i-07', vendorName: 'Northgate Snow',       amount: '5000',  category: 'snow',       invoiceDate: '2026-01-20', camEligible: true, ...doc('nsnw') },
  { id: 'bf-i-08', vendorName: 'Greenline Grounds',    amount: '4000',  category: 'grounds',    invoiceDate: '2026-05-01', camEligible: true, ...doc('grnl') },
  { id: 'bf-i-09', vendorName: 'Citywide Waste',       amount: '1740',  category: 'waste',      invoiceDate: '2026-07-01', camEligible: true, ...doc('city') },
  { id: 'bf-i-10', vendorName: 'City Water Authority', amount: '2860',  category: 'utilities',  invoiceDate: '2026-08-01', camEligible: true, ...doc('watr') },
];

const GROSS    = 160500;   // every invoice
const CAM_POOL = 90500;    // once the roof is held out
const ROOF     = 70000;

const SUPABASE_MOCK = `
(function () {
  var USER_ID = 'bf-user';
  var _user = { id: USER_ID, email: 'bf@e2e-test.local' };
  var _session = null;
  var KEY = '__bf_store';
  var seed = {
    properties: [{
      id: ${JSON.stringify(PROP_ID)}, user_id: USER_ID, name: 'Brookfield Commons', sqft: 100000,
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

// ── What the app says, gathered the same way at every step ──────────────────
// One reader used at every step so a difference between steps is a difference
// in the product, not in how the step was measured.
const SNAPSHOT = () => {
  const AX      = window.AuditExposure;
  const summary = buildAuditSummary();
  const expo    = AX.deriveExposure(summary, lastTotal || 0);
  const names   = tenantData.filter(Boolean).map(t => t.tenant_name);
  const state   = {};
  names.forEach(n => { const s = _tenantBillingState(n, expo); state[n] = s.state; });
  const conc    = summary.red.concat(summary.yellow)
                    .filter(f => /Unusually large invoice/.test(f.title || ''));
  const roofRow = lastResults.some(r => (r.includedInvoices || [])
                    .some(li => /Summit Roofing/.test(li.vendorName || li.vendor || '')));
  return {
    pool:    lastTotal,
    camPool: typeof lastCamPool === 'number' ? lastCamPool : null,
    billed:  +lastResults.reduce((s, r) => s + r.totalAllocated, 0).toFixed(2),
    roofInAllocation: roofRow,
    concentration: conc.map(f => f.title),
    propertyBlockers: ((expo.blocking || {}).property || []).map(b => b.title),
    tenantBlockers: Object.keys((expo.blocking || {}).byTenant || {}),
    billable: names.filter(n => state[n] === 'billable'),
    blocked:  names.filter(n => state[n] !== 'billable'),
    state,
  };
};

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
  await page.addInitScript(() => { window.__PROP_ID = 'bf-prop-000000000001'; });

  console.log('\n══ CAM-eligibility remediation loop — Brookfield Commons ══');

  // ── sign in and load ───────────────────────────────────────────────────────
  await page.goto('http://127.0.0.1:' + PORT + '/?signin=1', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('#loginBtn', { state: 'visible', timeout: 20000 });
  await page.fill('#loginEmail', 'bf@e2e-test.local');
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
    && tenantData.filter(Boolean).length === 4, { timeout: 20000 });

  yes('the module the whole fix depends on is actually loaded',
      await page.evaluate(() => !!(window.CamPool && window.CamPool.total)),
      'cam-pool.js is not on the page — every assertion below would be vacuous');

  // ═══ STEP 1 — the roof is CAM-eligible; the blocker appears ════════════════
  console.log('\n── Step 1: the roof is in the CAM pool ──');
  await page.evaluate(async () => { await runAllocation(); });
  await page.waitForFunction(() => typeof lastResults !== 'undefined' && lastResults.length === 4,
                             { timeout: 20000 });
  const before = await page.evaluate(SNAPSHOT);
  R('expense pool (gross)', '$' + before.pool.toLocaleString());
  R('CAM pool',             '$' + Number(before.camPool).toLocaleString());
  R('allocated to tenants', '$' + before.billed.toLocaleString());
  R('roof in the allocation', before.roofInAllocation);
  R('concentration finding', before.concentration);
  R('property blockers',     before.propertyBlockers);
  R('billable',              before.billable);

  yes('the fixture is the reported property',
      before.pool === GROSS && before.camPool === GROSS,
      JSON.stringify({ pool: before.pool, camPool: before.camPool }));
  yes('with nothing held out, the CAM pool IS the expense pool',
      before.camPool === before.pool, JSON.stringify(before));
  yes('the roof is allocated to tenants', before.roofInAllocation,
      'the fixture never had the roof in CAM — steps 4-8 would pass vacuously');
  yes('the concentration finding is raised', before.concentration.length === 1,
      JSON.stringify(before.concentration));
  yes('and it states the number the live run stated',
      /43\.6% of total CAM/.test(before.concentration[0] || ''), String(before.concentration[0]));
  yes('it is a PROPERTY-level billing blocker',
      before.propertyBlockers.some(t => /Unusually large invoice/.test(t)),
      JSON.stringify(before.propertyBlockers));
  yes('so no tenant on the property can be billed',
      before.billable.length === 0, JSON.stringify(before.billable));

  // The screen, not just the derivation.
  const beforeRoster = await page.evaluate(() => {
    const el = document.querySelector('#resultsBody .rcs-bill-roster');
    return el ? el.textContent.replace(/\s+/g, ' ').trim() : null;
  });
  R('roster line', beforeRoster);
  yes('and the results screen says so',
      !!beforeRoster && /0 of 4 tenants billable/.test(beforeRoster), String(beforeRoster));

  // ═══ STEP 2 — the manager unticks CAM eligible, through the real control ═══
  console.log('\n── Step 2: the manager unticks "CAM eligible" in the register ──');
  await page.evaluate(() => {
    PropertyOS.init();
    switchWorkspaceTab('property');            // the tab a manager taps
    PropertyOS.renderPropertyPage(currentProperty());
  });
  const boxSel = `input[data-inv-id="${ROOF_ID}"]`;
  const boxThere = await page.evaluate((s) => {
    const el = document.querySelector(s);
    return el ? { checked: el.checked, onchange: el.getAttribute('onchange') || '' } : null;
  }, boxSel);
  R('register checkbox', boxThere);
  yes('the register offers a CAM-eligible checkbox for the roof',
      !!boxThere && boxThere.checked === true,
      'no checked CAM-eligible control found for ' + ROOF_ID);

  // The real onchange handler, driven by a real click — not a direct write to
  // the record. The control has been wired to a render-time index before, which
  // wrote the relation onto a different invoice.
  await page.uncheck(boxSel);
  await page.waitForTimeout(200);

  const marked = await page.evaluate((id) => {
    const p = currentProperty();
    const inv = (p.invoices || []).find(i => String(i.id) === id);
    const eng = invoiceData.find(i => String(i.id) === id);
    return { record: inv ? inv.camEligible : null, engineInput: eng ? eng.camEligible : null };
  }, ROOF_ID);
  R('after the click', marked);
  yes('the record now says the roof is not CAM-eligible', marked.record === false,
      JSON.stringify(marked));
  yes('and the list the engine reads agrees', marked.engineInput === false,
      'the register wrote to a copy the reconciliation never sees — the original CAM-6 defect');

  // ═══ STEP 3 — re-run ══════════════════════════════════════════════════════
  console.log('\n── Steps 3-6: re-run ──');
  await page.evaluate(async () => { await runAllocation(); });
  await page.waitForFunction(() => typeof lastResults !== 'undefined' && lastResults.length === 4,
                             { timeout: 20000 });
  const after = await page.evaluate(SNAPSHOT);
  R('expense pool (gross)', '$' + after.pool.toLocaleString());
  R('CAM pool',             '$' + Number(after.camPool).toLocaleString());
  R('allocated to tenants', '$' + after.billed.toLocaleString());
  R('roof in the allocation', after.roofInAllocation);
  R('concentration finding', after.concentration);
  R('property blockers',     after.propertyBlockers);
  R('billable',              after.billable);
  R('blocked',               after.blocked);

  // Step 4
  yes('STEP 4 — the roof is absent from the allocation',
      after.roofInAllocation === false, 'the engine still billed the roof to tenants');
  yes('the two pools have separated, and each is right',
      after.pool === GROSS && after.camPool === CAM_POOL,
      JSON.stringify({ pool: after.pool, camPool: after.camPool, expected: { GROSS, CAM_POOL } }));
  yes('the gross expense pool did NOT move — the money still exists',
      after.pool === before.pool,
      'holding an invoice out of CAM deleted it from the expense record');
  yes('the billed total fell by exactly the roof',
      +(before.billed - after.billed).toFixed(2) === ROOF,
      JSON.stringify({ before: before.billed, after: after.billed }));

  // Step 5
  yes('STEP 5 — the concentration finding is gone',
      after.concentration.length === 0, JSON.stringify(after.concentration));
  yes('    (gone, not merely re-worded — no invoice is 40% of $90,500)',
      !after.concentration.some(t => /Summit Roofing/.test(t)), JSON.stringify(after.concentration));

  // Step 6
  yes('STEP 6 — the property-level blocker is gone',
      after.propertyBlockers.length === 0, JSON.stringify(after.propertyBlockers));

  // Step 7
  console.log('\n── Step 7: the tenants are billable again ──');
  R('per-tenant state', after.state);
  yes('STEP 7 — the three NNN tenants are billable again',
      ['Fairview Dental Group', 'Lakeside Imaging Partners', 'Brookfield Physical Therapy']
        .every(n => after.state[n] === 'billable'),
      JSON.stringify(after.state));
  yes('    and each was blocked a moment ago — the change is the remediation',
      ['Fairview Dental Group', 'Lakeside Imaging Partners', 'Brookfield Physical Therapy']
        .every(n => before.state[n] !== 'billable'),
      JSON.stringify(before.state));
  // The negative that matters more than the positives.
  yes('    but the Modified Gross tenant is STILL held for its own reason',
      after.state['Corner Market Grocers'] !== 'billable',
      'clearing a property blocker washed out a tenant-scoped one — a worse defect than the fix');
  yes('    and that hold is recorded against the tenant, not the property',
      after.tenantBlockers.includes('Corner Market Grocers') && after.propertyBlockers.length === 0,
      JSON.stringify({ byTenant: after.tenantBlockers, property: after.propertyBlockers }));

  const afterScreen = await page.evaluate(() => {
    const roster = document.querySelector('#resultsBody .rcs-bill-roster');
    const rows = [...document.querySelectorAll('#resultsBody table tr')].map(tr =>
      [...tr.querySelectorAll('td,th')].map(td => td.textContent.replace(/\s+/g, ' ').trim()));
    const kpis = [...document.querySelectorAll('#resultsBody .rcs-kpi')].map(k => ({
      lbl: ((k.querySelector('.rcs-kpi-lbl') || {}).textContent || '').replace(/\s+/g, ' ').trim(),
      val: ((k.querySelector('.rcs-kpi-val') || {}).textContent || '').trim(),
    }));
    return {
      roster: roster ? roster.textContent.replace(/\s+/g, ' ').trim() : null,
      billingCells: rows.filter(r => r.some(c => /Billable|Blocked|Confirm/i.test(c)))
                        .map(r => [r[0], r[r.length - 1]]),
      camKpi: kpis.find(k => /CAM Pool/.test(k.lbl)) || null,
    };
  });
  R('roster line', afterScreen.roster);
  R('billing column', afterScreen.billingCells);
  R('CAM Pool KPI', afterScreen.camKpi);
  yes('the results screen reports the new count',
      !!afterScreen.roster && /3 of 4 tenants billable/.test(afterScreen.roster),
      String(afterScreen.roster));
  // THIS is the state that tells the two figures apart. At step 1 and step 9 the
  // CAM pool and the gross pool are the same $160,500, so a KPI showing the
  // wrong one is indistinguishable there. Here they differ by the whole roof.
  yes('the KPI labelled "CAM Pool" shows $90,500, not the $160,500 gross',
      !!afterScreen.camKpi && /90,500/.test(afterScreen.camKpi.val)
        && !/160,500\.00</.test(afterScreen.camKpi.val),
      JSON.stringify(afterScreen.camKpi));
  yes('    and it says what it is NOT, so the reader can find the other $70,000',
      !!afterScreen.camKpi && /of \$160,500\.00 invoiced/.test(afterScreen.camKpi.lbl),
      JSON.stringify(afterScreen.camKpi));

  // Step 8 — the statements actually issue, for the right amount.
  //
  // "A statement rendered" is too weak: the refusal screen renders too. Each of
  // these asserts the ISSUED figure, which is the tenant's pro-rata share of the
  // CAM POOL ($90,500) and not of the gross pool ($160,500). A statement billing
  // the gross share would be the same defect wearing the other face.
  console.log('\n── Step 8: the statements issue, for the CAM-pool share ──');
  const EXPECTED = {
    'Fairview Dental Group':       { pct: 25, due: '$22,625.00' },   // 25% of $90,500
    'Lakeside Imaging Partners':   { pct: 30, due: '$27,150.00' },   // 30% of $90,500
    'Brookfield Physical Therapy': { pct: 25, due: '$22,625.00' },
  };
  for (const name of Object.keys(EXPECTED)) {
    const exp = EXPECTED[name];
    const st = await page.evaluate(async (n) => {
      generateTenantStatement(n);
      await new Promise(r => setTimeout(r, 400));
      const body = document.getElementById('rptBody');
      const txt  = body ? body.textContent.replace(/\s+/g, ' ').trim() : '';
      return {
        rendered: !!txt,
        refused:  /has not been issued/i.test(txt),
        roof:     /Summit Roofing/.test(txt),
        named:    txt.indexOf(n) >= 0,
        due:      (txt.match(/Total CAM Billed to You\s*(\$[\d,]+\.\d\d)/) || [])[1] || null,
        share:    (txt.match(/Your Share\s*([\d.]+)%/) || [])[1] || null,
      };
    }, name);
    R(name, st);
    yes(`${name} — a statement is issued, not refused`,
        st.rendered && st.named && !st.refused, JSON.stringify(st));
    yes(`${name} — billed ${exp.due}, its share of the CAM pool`,
        st.due === exp.due && Number(st.share) === exp.pct,
        JSON.stringify({ got: { due: st.due, share: st.share }, want: exp }));
    yes(`${name} — and it does not bill the roof`, !st.roof,
        'the statement lists an invoice the manager held out of CAM');
    await page.evaluate(() => { const o = document.getElementById('reportOverlay'); if (o) o.style.display = 'none'; });
  }
  yes('the three issued statements sum to the CAM pool, not the gross pool',
      +Object.values(EXPECTED).reduce((s, e) => s + Number(e.due.replace(/[$,]/g, '')), 0).toFixed(2)
        === +(CAM_POOL * 0.8).toFixed(2),
      'the fixture arithmetic drifted — these three hold 80% of the building');

  const refusal = await page.evaluate(async () => {
    generateTenantStatement('Corner Market Grocers');
    await new Promise(r => setTimeout(r, 400));
    const body = document.getElementById('rptBody');
    const txt  = body ? body.textContent.replace(/\s+/g, ' ').trim() : '';
    return {
      refused:  /has not been issued/i.test(txt),
      roof:     /Summit Roofing/.test(txt),
      modGross: /Modified Gross tenant receiving shared CAM/i.test(txt),
      // I-12: the refusal must say whose problem this is. On the run at step 1
      // the honest answer was "the property"; here it is "yours alone".
      ownItems: /held for [^.]*own outstanding items/i.test(txt),
      othersOk: /Other tenants on this reconciliation are not affected/i.test(txt),
      head:     txt.slice(0, 300),
    };
  });
  R('Corner Market Grocers', refusal);
  yes('the held tenant is still refused', refusal.refused, JSON.stringify(refusal));
  yes('    and the reason given is its own lease, not the roof',
      refusal.modGross && !refusal.roof, JSON.stringify(refusal));
  yes('    and the refusal says the hold is this tenant\'s alone',
      refusal.ownItems && refusal.othersOk,
      'the refusal still reads as a property-wide hold on a run where the property is clear');
  await page.evaluate(() => { const o = document.getElementById('reportOverlay'); if (o) o.style.display = 'none'; });

  // ═══ STEP 9 — THE INVERSE ═════════════════════════════════════════════════
  //
  // Everything above would pass if the concentration detector had simply been
  // deleted. Put the roof back in CAM and the blocker must come back.
  console.log('\n── Step 9 (inverse): re-tick it, and the blocker returns ──');
  await page.evaluate(() => {
    switchWorkspaceTab('property');
    PropertyOS.renderPropertyPage(currentProperty());
  });
  await page.check(boxSel);
  await page.waitForTimeout(200);
  const reMarked = await page.evaluate((id) => {
    const inv = (currentProperty().invoices || []).find(i => String(i.id) === id);
    return inv ? inv.camEligible : null;
  }, ROOF_ID);
  yes('the roof is back in CAM', reMarked === true, JSON.stringify({ camEligible: reMarked }));

  await page.evaluate(async () => { await runAllocation(); });
  await page.waitForFunction(() => typeof lastResults !== 'undefined' && lastResults.length === 4,
                             { timeout: 20000 });
  const again = await page.evaluate(SNAPSHOT);
  R('CAM pool',              '$' + Number(again.camPool).toLocaleString());
  R('roof in the allocation', again.roofInAllocation);
  R('concentration finding',  again.concentration);
  R('property blockers',      again.propertyBlockers);
  R('billable',               again.billable);

  yes('the CAM pool is whole again', again.camPool === GROSS,
      JSON.stringify({ camPool: again.camPool }));
  yes('the roof is allocated again', again.roofInAllocation === true, JSON.stringify(again));
  yes('STEP 9 — the concentration finding is BACK',
      again.concentration.length === 1 && /43\.6% of total CAM/.test(again.concentration[0] || ''),
      JSON.stringify(again.concentration) + ' — the detector may have been silenced rather than corrected');
  yes('    and it blocks the property again',
      again.propertyBlockers.some(t => /Unusually large invoice/.test(t)),
      JSON.stringify(again.propertyBlockers));
  yes('    so no tenant is billable', again.billable.length === 0, JSON.stringify(again.billable));
  yes('    — the state matches step 1 exactly',
      JSON.stringify(again.state) === JSON.stringify(before.state),
      JSON.stringify({ step1: before.state, step9: again.state }));

  // ── the finding's own sentence must be checkable against the screen ────────
  console.log('\n── The claim a reader can check ──');
  const claim = await page.evaluate(() => {
    const s = buildAuditSummary();
    const f = s.red.concat(s.yellow).find(x => /Unusually large invoice/.test(x.title || ''));
    const kpi = [...document.querySelectorAll('#resultsBody .rcs-kpi')]
      .map(k => ({ lbl: (k.querySelector('.rcs-kpi-lbl') || {}).textContent || '',
                   val: (k.querySelector('.rcs-kpi-val') || {}).textContent || '' }));
    return {
      basis: f ? f.source : null,
      conditions: f ? f.conditions : null,
      detail: f ? f.detail : null,
      camKpi: kpi.find(k => /CAM Pool/.test(k.lbl)) || null,
    };
  });
  R('stated basis', claim.basis);
  R('CAM Pool KPI', claim.camKpi);
  yes('the finding states the pool it divided by',
      (claim.conditions || []).some(c => /Total CAM pool: \$160,500/.test(c)),
      JSON.stringify(claim.conditions));
  yes('no sentence in it calls that number the expense pool',
      !/total expense pool/i.test(claim.detail || ''), String(claim.detail));
  yes('and the screen shows the same CAM pool the finding used',
      !!claim.camKpi && /160,500/.test(claim.camKpi.val),
      JSON.stringify(claim.camKpi));

  // ── no console errors anywhere in the loop ────────────────────────────────
  console.log('\n── Console ──');
  yes('no uncaught page errors through the whole loop', errors.length === 0,
      errors.slice(0, 3).join(' | '));

  console.log('\n' + '─'.repeat(56));
  if (fail) console.log(`\x1b[31mRESULT: ${pass} passed, ${fail} failed\x1b[0m`);
  else      console.log(`\x1b[32mRESULT: ${pass} passed, 0 failed\x1b[0m`);

  await browser.close();
  server.close();
  process.exit(fail ? 1 : 0);
})().catch(e => {
  console.error('\n\x1b[31mtest-e2e-cam-pool-loop crashed:\x1b[0m', e && e.stack || e);
  process.exit(1);
});
