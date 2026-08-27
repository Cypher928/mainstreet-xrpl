'use strict';
/**
 * test-cap-base-persistence.js — Prior-Year CAM Base must survive a reload.
 *
 *   node test-cap-base-persistence.js
 *   HEADLESS=0 node test-cap-base-persistence.js
 *
 * THE BUG THIS EXISTS FOR
 * Reported from a real phone against the deployed pilot: a landlord fills in
 * "Prior-Year CAM Base ($)" on a lease card, presses Done, and on returning to
 * the property the field is empty. "CAM Cap (%)" entered in the same session,
 * through the same handler, on the same card, survives — which is what makes it
 * a data bug rather than a save that simply did not fire.
 *
 * WHAT IS ASSERTED
 * The two fields are entered and saved together, the page is reloaded, and both
 * are read back. Cap is the control: if it also failed, the fault would be in
 * saving generally rather than in this one field, and the assertions say which.
 *
 * The Supabase mock persists its store in localStorage so a reload reads what
 * the previous page wrote — without that, a reload resets the backing store and
 * the test would report a false failure for every field.
 *
 * STATUS: this path PASSES. Entering both fields, pressing Done and reloading
 * returns both values, so the ordinary save is not where the value is lost.
 * That makes this a regression guard rather than a reproduction, and the
 * reported loss is still unexplained.
 *
 * THE LEADING HYPOTHESIS, not yet reproduced:
 * loadPropertyData reads tenants from properties.data.tenants when that blob has
 * any, and otherwise falls back to the `tenants` TABLE. That table has a `cap`
 * column and none for the prior-year base — see the select at script.js:23017
 * and syncTenantsToTable's column map — and the fallback mapping lists its
 * fields explicitly, omitting capBaseAmount. Any load taking that fallback
 * therefore returns the percentage and drops the dollar base, which is exactly
 * the asymmetry reported. Staging that state needs a property whose blob has no
 * tenants while the table does; this harness could not produce it, so the
 * hypothesis is recorded rather than asserted.
 */
let pw;
try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }
const { chromium } = pw;

const http = require('http');
const fs   = require('fs');
const path = require('path');

const ROOT     = __dirname;
const PORT     = parseInt(process.env.APP_PORT || '7877', 10);
const HEADLESS = process.env.HEADLESS !== '0';
const CHROME   = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css',
               '.json':'application/json', '.png':'image/png', '.svg':'image/svg+xml',
               '.mp4':'video/mp4', '.webm':'video/webm', '.woff2':'font/woff2' };

let pass = 0, fail = 0;
const ok  = (m) => { console.log('  \x1b[32m✓\x1b[0m ' + m); pass++; };
const bad = (m, d) => { console.log('  \x1b[31m✗\x1b[0m ' + m + (d ? ' — ' + d : '')); fail++; };
const yes = (m, c, d) => c ? ok(m) : bad(m, d);
const eq  = (l, a, e) => a === e ? ok(`${l} → ${JSON.stringify(a)}`) : bad(l, `expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`);

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

const PROP_ID   = 'capbase-prop-0000000001';
const TENANT_ID = 'capbase-tenant-000000001';

// The store is backed by localStorage so it survives the reload under test.
const SUPABASE_MOCK = `
(function () {
  var USER_ID = 'capbase-user';
  var _user = { id: USER_ID, email: 'capbase@e2e-test.local' };
  var _session = null;
  var KEY = '__capbase_store';
  var seed = {
    properties: [{
      id: '${PROP_ID}', user_id: USER_ID, name: 'Test 2', sqft: 80000,
      data: {
        invoices: [], disputes: [], camYear: 2026, results: null, camReconciliation: null,
        activityLog: [], timeline: [], escrowReserves: [], drawRequests: [],
        tenants: [{
          id: '${TENANT_ID}', tenant_name: 'SHONAC', leased_sqft: 12000,
          lease_type: 'Triple Net (NNN)', start_date: '2001-02-28', end_date: '2016-02-28',
          cap: null, capBaseAmount: null, excluded_categories: '',
          status: 'complete', _userConfirmed: true,
        }],
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
      select: function () { return api; },
      eq: function () { return api; },
      not: function () { return api; },
      is:  function () { return api; },
      in:  function () { return api; },
      order: function () { return api; },
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
      then: function (r2) {
        return Promise.resolve({ data: last ? [last] : rows, error: null }).then(r2);
      },
    };
    return api;
  }
  window.supabase = {
    createClient: function () {
      return {
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
      };
    },
  };
})();
`;

async function signIn(page) {
  await page.route('**', route => {
    const u = route.request().url();
    if (u.startsWith('http://127.0.0.1:' + PORT)) return route.continue();
    if (/supabase-js/.test(u)) {
      return route.fulfill({ status: 200, contentType: 'application/javascript', body: '/* mocked */' });
    }
    return route.abort();
  });
  await page.addInitScript(SUPABASE_MOCK);
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
  await page.fill('#loginEmail', 'capbase@e2e-test.local');
  await page.fill('#loginPassword', 'TestPass123!');
  await page.click('#loginBtn');
  await page.waitForFunction(() => {
    const app = document.getElementById('appContent');
    return app && app.style.display !== 'none' && app.style.display !== '';
  }, null, { timeout: 45000 });
}

// Open the property and render the lease cards the fields live on.
async function openLeaseCard(page) {
  // Wait for the app's own property list to arrive before selecting from it —
  // selectProperty() is a no-op against a list that has not loaded yet.
  await page.waitForFunction(() => typeof _props !== 'undefined'
    && Array.isArray(_props) && _props.length > 0, null, { timeout: 45000 });
  await page.evaluate((id) => selectProperty(id), PROP_ID);
  await page.waitForFunction(() => typeof tenantData !== 'undefined' && tenantData.length > 0, null,
                             { timeout: 45000 });
  await page.evaluate(() => {
    if (typeof switchWorkspaceTab === 'function') switchWorkspaceTab('spaces');
    if (typeof switchLeaseTab === 'function') switchLeaseTab('bulk');
    if (typeof renderBulkResults === 'function') renderBulkResults();
  });
  await page.waitForSelector('#btr-0', { state: 'attached', timeout: 15000 });
  // The card renders collapsed; a person taps it open before the fields exist
  // on screen. Expand it the same way.
  await page.evaluate(() => {
    const det = document.getElementById('bdet-0');
    if (det && getComputedStyle(det).display === 'none') toggleBulkDetail(0);
  });
  await page.waitForSelector('#bdet-0 input', { state: 'visible', timeout: 10000 });
}

// The two inputs are found by their labels rather than by index, so the test
// keeps pointing at the right boxes if the card is ever reordered.
const READ_FIELDS = () => {
  const out = {};
  document.querySelectorAll('#btr-0 .field').forEach(f => {
    const label = (f.querySelector('label')?.textContent || '').trim();
    const input = f.querySelector('input');
    if (!input) return;
    if (/^CAM Cap/.test(label))        out.cap  = input.value;
    if (/^Prior-Year CAM Base/.test(label)) out.base = input.value;
  });
  return out;
};

(async () => {
  const server  = await startServer();
  const browser = await chromium.launch({
    headless: HEADLESS, executablePath: CHROME,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const ctx  = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  console.log('\n── Entering both cap fields on a lease card ──');
  await signIn(page);
  await openLeaseCard(page);

  const before = await page.evaluate(READ_FIELDS);
  eq('both fields start empty', JSON.stringify(before), JSON.stringify({ cap: '', base: '' }));

  // Type the way a person does — into the field, then blur, which is what the
  // card's onblur handler is bound to.
  await page.evaluate(() => {
    const fields = [...document.querySelectorAll('#btr-0 .field')];
    const find = (re) => fields.find(f => re.test((f.querySelector('label')?.textContent || '').trim()));
    window.__capInput  = find(/^CAM Cap/).querySelector('input');
    window.__baseInput = find(/^Prior-Year CAM Base/).querySelector('input');
  });
  await page.evaluate(() => window.__capInput.focus());
  await page.keyboard.type('5');
  await page.evaluate(() => window.__capInput.blur());
  await page.evaluate(() => window.__baseInput.focus());
  await page.keyboard.type('33000');
  await page.evaluate(() => window.__baseInput.blur());

  const typed = await page.evaluate(READ_FIELDS);
  eq('both fields hold the typed values', JSON.stringify(typed), JSON.stringify({ cap: '5', base: '33000' }));

  const inMemory = await page.evaluate(() => ({
    cap:  tenantData[0].cap,
    base: tenantData[0].capBaseAmount,
    propCap:  (currentProperty().tenants[0] || {}).cap,
    propBase: (currentProperty().tenants[0] || {}).capBaseAmount,
  }));
  eq('the blur handler wrote CAM Cap to the working buffer', inMemory.cap, '5');
  eq('and to the property', inMemory.propCap, '5');
  eq('the blur handler wrote the CAM Base to the working buffer', inMemory.base, '33000');
  eq('and to the property', inMemory.propBase, '33000');

  console.log('\n── Pressing Done, then reloading ──');
  await page.evaluate(() => saveBulkTenant(0));
  await page.waitForTimeout(1500);

  const saved = await page.evaluate(() => {
    const p = (window.__store().properties || [])[0] || {};
    const t = ((p.data || {}).tenants || [])[0] || {};
    return { cap: t.cap, base: t.capBaseAmount, keys: Object.keys(t).length };
  });
  yes('the saved property blob carries CAM Cap', saved.cap === '5' || saved.cap === 5,
      `blob cap is ${JSON.stringify(saved.cap)}`);
  yes('the saved property blob carries the CAM Base',
      saved.base === '33000' || saved.base === 33000,
      `blob capBaseAmount is ${JSON.stringify(saved.base)} — this is where it is lost`);

  await page.reload({ waitUntil: 'domcontentloaded' });
  // Wait for one of the two states the reload can land in, rather than waiting
  // for one and swallowing the timeout. The discarded form let a slow login
  // screen read as "already signed in", after which every later wait sat until
  // its own timeout on a condition that could no longer come true — an
  // intermittent hang that only ever showed up under the full regression.
  await page.waitForFunction(() => {
    const b = document.getElementById('loginBtn');
    const a = document.getElementById('appContent');
    return (b && b.offsetParent !== null)
        || (a && a.style.display !== 'none' && a.style.display !== '');
  }, null, { timeout: 45000 });
  const needsLogin = await page.evaluate(() => {
    const b = document.getElementById('loginBtn');
    return !!(b && b.offsetParent !== null);
  });
  if (needsLogin) {
    await page.fill('#loginEmail', 'capbase@e2e-test.local');
    await page.fill('#loginPassword', 'TestPass123!');
    await page.click('#loginBtn');
    await page.waitForFunction(() => {
      const app = document.getElementById('appContent');
      return app && app.style.display !== 'none' && app.style.display !== '';
    }, null, { timeout: 45000 });
  }
  await openLeaseCard(page);

  const after = await page.evaluate(READ_FIELDS);
  console.log('\n── After reload ──');
  yes('CAM Cap survived the reload', after.cap === '5',
      `CAM Cap reads ${JSON.stringify(after.cap)} after reload`);
  yes('Prior-Year CAM Base survived the reload', after.base === '33000',
      `Prior-Year CAM Base reads ${JSON.stringify(after.base)} after reload — the reported bug`);

  const afterMem = await page.evaluate(() => ({
    cap: tenantData[0].cap, base: tenantData[0].capBaseAmount,
  }));
  yes('and is present in the loaded tenant, not only in the input',
      afterMem.base === '33000' || afterMem.base === 33000,
      `tenantData[0].capBaseAmount is ${JSON.stringify(afterMem.base)}`);

  yes('no page errors during the run', errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();
  server.close();
  console.log(`\n${fail === 0 ? '\x1b[32m' : '\x1b[31m'}RESULT: ${pass} passed, ${fail} failed\x1b[0m`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
