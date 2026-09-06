'use strict';
/**
 * test-e2e-data-persistence.js — End-to-end Playwright test for the Data
 * Persistence workflow:
 *
 *   Create property → Refresh page → Logout/login → Confirm data remains
 *   intact
 *
 * Starts from a clean account (no pre-existing properties), creates a new
 * property via the real "+ Add Property" button (addNewProperty()), renames
 * it and sets its sqft through the real form fields (savePropertyData()),
 * waits out the 800ms save debounce, then:
 *   1. Reloads the page and confirms the property survives (re-fetched via
 *      the real loadProperties() → init() pipeline).
 *   2. Logs out (signOut()) and confirms the login screen reappears with all
 *      in-memory state cleared.
 *   3. Logs back in and confirms the property — with its new name and sqft —
 *      is still present, proving persistence survives a full session cycle.
 *
 * Usage:
 *   node test-e2e-data-persistence.js
 *
 * Optional env vars:
 *   HEADLESS=false   — open a visible browser
 *   APP_PORT=7856    — local HTTP server port (default: 7856)
 */

let pw;
try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }
const { chromium } = pw;

const http   = require('http');
const { signIn: _e2eSignIn } = require('./test-support/e2e-login');
const fs     = require('fs');
const path   = require('path');
const PORT   = parseInt(process.env.APP_PORT || '7856', 10);
const HEADLESS = process.env.HEADLESS !== 'false';
const ROOT   = __dirname;

let failures = 0;
function pass(label)    { console.log('\x1b[32m  ✅ ' + label + '\x1b[0m'); }
function fail(label, d) { console.error('\x1b[31m  ❌ ' + label + (d ? ' — ' + d : '') + '\x1b[0m'); failures++; }
function info(label)    { console.log('  · ' + label); }
function section(label) { console.log('\n── ' + label + ' ' + '─'.repeat(Math.max(0, 60 - label.length))); }
function assert(cond, label, detail) { cond ? pass(label) : fail(label, detail); }

const MIME = {
  '.html': 'text/html', '.js': 'application/javascript',
  '.css': 'text/css',  '.json': 'application/json',
  '.png': 'image/png', '.ico': 'image/x-icon',
};

function startServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let filePath = path.join(ROOT, req.url === '/' ? '/index.html' : req.url);
      filePath = filePath.split('?')[0];
      fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); res.end('not found'); return; }
        const ext = path.extname(filePath);
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        res.end(data);
      });
    });
    server.listen(PORT, '127.0.0.1', () => resolve(server));
    server.on('error', reject);
  });
}

const NEW_PROPERTY_NAME = 'Persistence Test Tower';
const NEW_PROPERTY_SQFT = '45000';

// ── Supabase mock — clean account, no pre-existing properties ──────────────
// addInitScript reruns this whole script on every navigation (including
// page.reload()), so the store and session are persisted to localStorage —
// otherwise a reload would wipe in-memory mock state, unlike a real
// Supabase-backed database. Logout only clears the persisted session, never
// the store, mirroring how signOut() never touches server-side data.
const SUPABASE_MOCK = `
(function() {
  var USER_ID = 'e2e-persistence-user';
  var _user = { id: USER_ID, email: 'persistence@e2e-test.local' };

  // A real supabase-js client persists the auth session in localStorage, so
  // refreshing the page keeps the user logged in. Mirror that here.
  var SESSION_LS_KEY = '__e2e_persistence_session__';
  var _session = null;
  try { _session = JSON.parse(localStorage.getItem(SESSION_LS_KEY) || 'null'); } catch (e) {}
  function persistSession() {
    try { localStorage.setItem(SESSION_LS_KEY, JSON.stringify(_session)); } catch (e) {}
  }

  // A real Supabase database survives a page reload; this in-memory mock
  // does not by default (addInitScript reruns on every navigation). Persist
  // the store to localStorage so STEP 2/4 of the test can verify reload and
  // logout/login behavior against the same "server-side" data.
  var LS_KEY = '__e2e_persistence_store__';
  var _persisted = null;
  try { _persisted = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch (e) {}
  var _store = _persisted || { properties: [], tenants: [] };

  function persistStore() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(_store)); } catch (e) {}
  }

  function noopPromise(val) { return Promise.resolve(val); }

  function makeQ(tableName) {
    var _filters = {};
    var _inFilters = {};
    var q = {
      select:   function() { return q; },
      insert:   function(rows) {
        var arr = Array.isArray(rows) ? rows : [rows];
        arr.forEach(function(r) { if (!r.id) r.id = 'row-' + Math.random().toString(36).slice(2); });
        if (_store[tableName]) arr.forEach(function(r) { _store[tableName].push(r); });
        persistStore();
        var result = noopPromise({ data: arr, error: null });
        result.select = function() { return { single: function() { return noopPromise({ data: arr[0], error: null }); }, then: function(fn) { return noopPromise({ data: arr, error: null }).then(fn); } }; };
        return result;
      },
      upsert:   function(row) {
        if (_store[tableName]) {
          var idx = _store[tableName].findIndex(function(r) { return r.id === row.id; });
          if (idx >= 0) _store[tableName][idx] = row; else _store[tableName].push(row);
        }
        persistStore();
        var result = noopPromise({ data: [row], error: null });
        result.select = function() { return noopPromise({ data: [row], error: null }); };
        return result;
      },
      update:   function() {
        var result = noopPromise({ data: null, error: null });
        result.select = function() { return noopPromise({ data: null, error: null }); };
        result.eq = function() { return noopPromise({ data: null, error: null }); };
        return result;
      },
      delete:   function() {
        return { eq: function() { return noopPromise({ error: null }); }, in: function() { return noopPromise({ error: null }); } };
      },
      eq:       function(col, val) { _filters[col] = val; return q; },
      neq:      function() { return q; },
      in:       function(col, vals) { _inFilters[col] = vals; return q; },
      not:      function() { return q; },
      order:    function() { return q; },
      limit:    function() { return q; },
      single:   function() {
        var rows = (_store[tableName] || []).filter(function(r) {
          return Object.keys(_filters).every(function(k) { return r[k] === _filters[k]; });
        });
        return noopPromise({ data: rows[0] || null, error: null });
      },
      then: function(fn) {
        var rows = (_store[tableName] || []).filter(function(r) {
          var okEq = Object.keys(_filters).every(function(k) { return r[k] === _filters[k]; });
          var okIn = Object.keys(_inFilters).every(function(k) { return (_inFilters[k] || []).indexOf(r[k]) !== -1; });
          return okEq && okIn;
        });
        return noopPromise({ data: rows, error: null }).then(fn);
      }
    };
    return q;
  }

  function makeSession() {
    return { user: _user, access_token: 'mock-access-token', expires_at: (Date.now() / 1000) + 3600 };
  }

  window.supabase = {
    createClient: function() {
      return {
        auth: {
          getUser: function() { return noopPromise({ data: { user: _session ? _user : null }, error: null }); },
          getSession: function() { return noopPromise({ data: { session: _session }, error: null }); },
          refreshSession: function() { return noopPromise({ data: { session: _session }, error: null }); },
          signUp: function() { _session = makeSession(); persistSession(); return noopPromise({ data: { session: _session, user: _user }, error: null }); },
          signInWithPassword: function() { _session = makeSession(); persistSession(); return noopPromise({ data: { session: _session, user: _user }, error: null }); },
          onAuthStateChange: function() { return { data: { subscription: { unsubscribe: function() {} } } }; },
          signOut: function() { _session = null; persistSession(); return noopPromise({ error: null }); }
        },
        from: function(table) { if (!_store[table]) _store[table] = []; return makeQ(table); },
        rpc: function() { return noopPromise({ data: null, error: null }); },
        _store: _store
      };
    }
  };
  window.__e2eStore = _store;
})();
`;

async function login(page, port, email, password) {
  // THE SWALLOW IS PRESERVED. This helper has always tolerated a sign-in that
  // does not complete — the `.catch(() => {})` below was on the original wait —
  // and this refactor is not the place to decide that it should not. What it
  // gains is the shared retry: a first click whose promise never resolves left
  // the button disabled, and every later click was a no-op.
  try { await _e2eSignIn(page, { email, password }); } catch (_) {}
}

(async () => {
  info('Starting local HTTP server on port ' + PORT + '…');
  const server = await startServer();
  info('Server ready at http://127.0.0.1:' + PORT);

  const browser = await chromium.launch({
    headless: HEADLESS,
    executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const ctx  = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();

  const consoleLogs = [];
  page.on('console', m => consoleLogs.push({ type: m.type(), text: m.text() }));
  page.on('pageerror', e => consoleLogs.push({ type: 'PAGEERROR', text: e.message }));

  await page.route('**/supabase-js**', route => route.fulfill({
    status: 200, contentType: 'application/javascript', body: '/* supabase CDN suppressed by e2e mock */'
  }));
  await page.addInitScript(SUPABASE_MOCK);

  try {
    // ── STEP 1: Login + create a brand-new property ──────────────────────────
    section('STEP 1: Login and create a new property');
    await page.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'networkidle', timeout: 30000 });
    await login(page, PORT, 'persistence@e2e-test.local', 'PersistUser123!');

    await page.waitForSelector('.add-prop-btn', { timeout: 10000 });
    await page.click('.add-prop-btn');

    await page.waitForFunction(() => {
      const el = document.getElementById('propertyName');
      return el && el.value === 'New Property';
    }, null, { timeout: 45000 });
    pass('STEP 1: new property created via addNewProperty() and auto-opened');

    const createdId = await page.evaluate(() => activePropId);
    assert(!!createdId, 'STEP 1: new property has a server-assigned id', String(createdId));

    // Rename it and set sqft through the real form fields — this exercises
    // savePropertyData()'s 800ms debounced save.
    await page.fill('#propertyName', NEW_PROPERTY_NAME);
    await page.fill('#totalSqft', NEW_PROPERTY_SQFT);
    await page.dispatchEvent('#totalSqft', 'input');
    await page.waitForTimeout(1000); // clear the 800ms save debounce

    const storeAfterCreate = await page.evaluate(() => window.__e2eStore.properties.find(p => p.id === activePropId));
    assert(!!storeAfterCreate, 'STEP 1: property persisted to the mock store after debounced save');
    assert(storeAfterCreate && storeAfterCreate.name === NEW_PROPERTY_NAME, 'STEP 1: persisted property has the updated name', storeAfterCreate && storeAfterCreate.name);
    assert(storeAfterCreate && Number(storeAfterCreate.sqft) === Number(NEW_PROPERTY_SQFT), 'STEP 1: persisted property has the updated sqft', storeAfterCreate && storeAfterCreate.sqft);

    // ── STEP 2: Refresh the page — confirm the property survives reload ─────
    section('STEP 2: Refresh page, confirm property survives');
    await page.reload({ waitUntil: 'networkidle', timeout: 30000 });

    await page.waitForFunction(() => {
      const app = document.getElementById('appContent');
      return app && app.style.display !== 'none' && app.style.display !== '';
    }, null, { timeout: 45000 }).catch(() => {});

    await page.waitForSelector('.ptf-prop-card:not(.ptf-demo-card)', { timeout: 10000 });
    const portfolioAfterReload = await page.evaluate(() => document.querySelector('#propertyCardsGrid')?.innerText || '');
    assert(portfolioAfterReload.includes(NEW_PROPERTY_NAME), 'STEP 2: portfolio dashboard shows the created property after reload', portfolioAfterReload.slice(0, 200));

    await page.evaluate((id) => { if (typeof selectProperty === 'function') selectProperty(id); }, createdId);
    await page.waitForFunction((name) => {
      const el = document.getElementById('propertyName');
      return el && el.value === name;
    }, NEW_PROPERTY_NAME, { timeout: 10000 });
    await page.waitForTimeout(800);

    const sqftAfterReload = await page.$eval('#totalSqft', el => el.value).catch(() => '');
    assert(sqftAfterReload === NEW_PROPERTY_SQFT, 'STEP 2: property sqft survives reload', sqftAfterReload);

    // ── STEP 3: Logout, confirm app state is cleared ──────────────────────────
    section('STEP 3: Logout clears in-memory state');
    await page.click('.logout-btn');
    await page.waitForFunction(() => {
      const login = document.getElementById('loginScreen');
      return login && getComputedStyle(login).display !== 'none';
    }, null, { timeout: 45000 });
    pass('STEP 3: login screen reappears after signOut()');

    const propsAfterLogout = await page.evaluate(() => (_props || []).length);
    assert(propsAfterLogout === 0, 'STEP 3: in-memory _props cleared after logout', String(propsAfterLogout));

    const sessionAfterLogout = await page.evaluate(() => window.__e2eStore !== undefined);
    assert(sessionAfterLogout, 'STEP 3: mock store itself is untouched by logout (server-side data persists)');

    // ── STEP 4: Login again, confirm data remains intact ──────────────────────
    section('STEP 4: Login again, confirm data remains intact');
    await login(page, PORT, 'persistence@e2e-test.local', 'PersistUser123!');

    await page.waitForSelector('.ptf-prop-card:not(.ptf-demo-card)', { timeout: 10000 });
    const portfolioAfterRelogin = await page.evaluate(() => document.querySelector('#propertyCardsGrid')?.innerText || '');
    assert(portfolioAfterRelogin.includes(NEW_PROPERTY_NAME), 'STEP 4: property still present on the portfolio dashboard after re-login', portfolioAfterRelogin.slice(0, 200));

    await page.evaluate((id) => { if (typeof selectProperty === 'function') selectProperty(id); }, createdId);
    await page.waitForFunction((name) => {
      const el = document.getElementById('propertyName');
      return el && el.value === name;
    }, NEW_PROPERTY_NAME, { timeout: 10000 });
    await page.waitForTimeout(800);

    const nameAfterRelogin = await page.$eval('#propertyName', el => el.value).catch(() => '');
    const sqftAfterRelogin = await page.$eval('#totalSqft', el => el.value).catch(() => '');
    assert(nameAfterRelogin === NEW_PROPERTY_NAME, 'STEP 4: property name intact after full logout/login cycle', nameAfterRelogin);
    assert(sqftAfterRelogin === NEW_PROPERTY_SQFT, 'STEP 4: property sqft intact after full logout/login cycle', sqftAfterRelogin);

    // ── Console error check ──────────────────────────────────────────────────
    section('Console error check');
    const pageErrors = consoleLogs.filter(l => l.type === 'PAGEERROR');
    if (pageErrors.length) pageErrors.forEach(e => info('PAGE ERROR: ' + e.text.slice(0, 200)));
    assert(pageErrors.length === 0, 'No uncaught page errors across the full flow', pageErrors.map(e => e.text).join(' | ').slice(0, 300));

  } finally {
    await browser.close();
    server.close();
  }

  console.log('\n' + '─'.repeat(64));
  if (failures === 0) {
    console.log('\x1b[32mResults: all assertions passed — 0 failures\x1b[0m');
    console.log('\x1b[32m✅ Data persistence workflow E2E verification complete\x1b[0m');
    process.exit(0);
  } else {
    console.log('\x1b[31mResults: ' + failures + ' assertion(s) failed\x1b[0m');
    process.exit(1);
  }
})();
