'use strict';
/**
 * test-e2e-existing-landlord.js — End-to-end Playwright test for a RETURNING
 * landlord's core workflow (as opposed to the brand-new-user path covered by
 * test-e2e-first-time-experience.js):
 *
 *   Login → Open existing property → Upload additional lease → Run CAM → Generate reports
 *
 * Seeds the Supabase mock with one already-existing property (one tenant,
 * one invoice, already has a prior reconciliation result) so the test starts
 * from realistic "returning user" state rather than zero properties.
 *
 * Usage:
 *   node test-e2e-existing-landlord.js
 *
 * Optional env vars:
 *   HEADLESS=false   — open a visible browser
 *   APP_PORT=7835    — local HTTP server port (default: 7835)
 */

let pw;
try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }
const { chromium } = pw;

const http   = require('http');
const { signIn: _e2eSignIn, attachDiagnostics } = require('./test-support/e2e-login');
const fs     = require('fs');
const path   = require('path');
const PORT   = parseInt(process.env.APP_PORT || '7835', 10);
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

const EXISTING_PROP_ID = 'existing-prop-1';
const EXISTING_TENANT_ID = 'existing-tenant-1';

// ── Supabase mock — seeded with one existing property (returning user) ─────
const SUPABASE_MOCK = `
(function() {
  var USER_ID = 'e2e-existing-landlord-user';
  var _user = { id: USER_ID, email: 'returning-landlord@e2e-test.local' };
  var _session = null;

  var _existingTenant = {
    id: '${EXISTING_TENANT_ID}', property_id: '${EXISTING_PROP_ID}',
    name: 'Anchor Bakery LLC', sqft: 2000, cap: 4,
    start_date: '2021-05-01', end_date: '2026-04-30',
    lease_url: null, lease_type: 'NNN',
  };

  var _store = {
    properties: [{
      id: '${EXISTING_PROP_ID}', user_id: USER_ID,
      name: 'Existing Plaza', sqft: 8000,
      data: {
        invoices: [{ vendorName: 'Acme Cleaning Co', amount: 6000, category: 'cleaning', invoiceDate: '2024-02-10', confidence: {} }],
        disputes: [], camYear: 2024, results: null, camReconciliation: null,
        activityLog: [], timeline: [],
        tenants: [{
          id: '${EXISTING_TENANT_ID}', tenant_name: 'Anchor Bakery LLC', leased_sqft: 2000, cap: 4,
          start_date: '2021-05-01', end_date: '2026-04-30', lease_type: 'NNN', leaseUrl: null,
        }],
        escrowReserves: [], drawRequests: [],
      },
    }],
    tenants: [_existingTenant],
  };

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
        var result = noopPromise({ data: arr, error: null });
        result.select = function() { return { single: function() { return noopPromise({ data: arr[0], error: null }); }, then: function(fn) { return noopPromise({ data: arr, error: null }).then(fn); } }; };
        return result;
      },
      upsert:   function(row) {
        if (_store[tableName]) {
          var idx = _store[tableName].findIndex(function(r) { return r.id === row.id; });
          if (idx >= 0) _store[tableName][idx] = row; else _store[tableName].push(row);
        }
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
          signUp: function() { _session = makeSession(); return noopPromise({ data: { session: _session, user: _user }, error: null }); },
          signInWithPassword: function() { _session = makeSession(); return noopPromise({ data: { session: _session, user: _user }, error: null }); },
          onAuthStateChange: function() { return { data: { subscription: { unsubscribe: function() {} } } }; },
          signOut: function() { _session = null; return noopPromise({ error: null }); }
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

const MOCK_CLAUDE_TENANT_2 = {
  tenant_name: 'Lakeside Dental Group',
  lease_start_date: '2024-06-01',
  lease_end_date: '2029-05-31',
  lease_type: 'NNN',
  sqft: 1800,
  cam_cap: 3,
  audit_rights: true,
  pro_rata_method: 'occupied',
  renewal_options: null,
  excluded_categories: null,
  quotes: {},
};

const LEASE_TEXT_2 = `
LEASE AGREEMENT
Tenant: Lakeside Dental Group. Commencement Date: June 1, 2024. Expiration Date: May 31, 2029.
Tenant shall lease approximately 1,800 square feet. This is a Triple Net (NNN) lease.
CAM charges shall not increase more than 3% per annum. Pro rata share based on occupied square footage.
`.repeat(4);

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
  const _e2eErrors = attachDiagnostics(page);

  const consoleLogs = [];
  page.on('console', m => consoleLogs.push({ type: m.type(), text: m.text() }));
  page.on('pageerror', e => consoleLogs.push({ type: 'PAGEERROR', text: e.message }));

  await page.route('**/supabase-js**', route => route.fulfill({
    status: 200, contentType: 'application/javascript', body: '/* supabase CDN suppressed by e2e mock */'
  }));
  await page.addInitScript(SUPABASE_MOCK);

  await page.route('**/api/claude', route => {
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_CLAUDE_TENANT_2) });
  });
  await page.route('**/api/upload', route => {
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ url: 'https://mock-storage.local/leases/lakeside-dental.txt' }) });
  });

  try {
    // ── STEP 1: Login (existing account, sign-in tab is the default) ──────────
    section('STEP 1: Login');
    await page.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'networkidle', timeout: 30000 });

    const loginVisible = await page.$eval('#loginScreen', el => el.style.display !== 'none').catch(() => false);
    assert(loginVisible, 'STEP 1: login screen visible before sign-in');

    await _e2eSignIn(page, { email: "returning-landlord@e2e-test.local", errors: _e2eErrors });

    const appVisible = await page.$eval('#appContent', el => el.style.display !== 'none' && el.style.display !== '').catch(() => false);
    assert(appVisible, 'STEP 1: app content visible after sign-in');

    // ── STEP 2: Open existing property ─────────────────────────────────────────
    section('STEP 2: Open existing property');
    await page.waitForFunction(() => window._props && window._props.length >= 0, null, { timeout: 45000 }).catch(() => {});
    await page.waitForSelector('.ptf-prop-card:not(.ptf-demo-card)', { timeout: 10000 });

    const realCardText = await page.$eval('.ptf-prop-card:not(.ptf-demo-card)', el => el.innerText).catch(() => '');
    assert(realCardText.includes('Existing Plaza'), 'STEP 2: existing property card rendered on portfolio', realCardText.slice(0, 80));

    await page.evaluate((propId) => { if (typeof selectProperty === 'function') selectProperty(propId); }, EXISTING_PROP_ID);
    await page.waitForFunction(() => {
      const el = document.getElementById('propertyName');
      return el && el.value === 'Existing Plaza';
    }, null, { timeout: 45000 });

    const openedName = await page.$eval('#propertyName', el => el.value).catch(() => '');
    assert(openedName === 'Existing Plaza', 'STEP 2: property workspace opened with correct name', openedName);

    await page.waitForTimeout(800); // let the background loadPropertyData() refresh settle
    const bulkResultsAfterOpen = await page.$eval('#bulkResults', el => el.innerText).catch(() => '');
    assert(bulkResultsAfterOpen.includes('Anchor Bakery'), 'STEP 2: pre-existing tenant (Anchor Bakery LLC) shown after opening property', bulkResultsAfterOpen.slice(0, 150));

    // ── STEP 3: Upload additional lease ─────────────────────────────────────────
    section('STEP 3: Upload additional lease');
    await page.evaluate(() => { if (typeof switchWorkspaceTab === 'function') switchWorkspaceTab('documents'); });
    await page.setInputFiles('#bulkLeaseInput', {
      name: 'lakeside-dental-lease.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from(LEASE_TEXT_2, 'utf-8'),
    });

    await page.waitForFunction(() => document.getElementById('bulkResults').innerText.includes('Lakeside Dental'), null, { timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(800);

    const bulkResultsAfterUpload = await page.$eval('#bulkResults', el => el.innerText).catch(() => '');
    const newTenantAdded = bulkResultsAfterUpload.includes('Lakeside Dental');
    assert(newTenantAdded, 'STEP 3: new tenant (Lakeside Dental Group) extracted and added', bulkResultsAfterUpload.slice(0, 200));

    const oldTenantStillPresent = bulkResultsAfterUpload.includes('Anchor Bakery');
    assert(oldTenantStillPresent, 'STEP 3: pre-existing tenant (Anchor Bakery LLC) preserved alongside new upload', bulkResultsAfterUpload.slice(0, 200));

    // ── STEP 4: Run CAM ──────────────────────────────────────────────────────────
    section('STEP 4: Run CAM');
    await page.evaluate(() => { if (typeof switchWorkspaceTab === 'function') switchWorkspaceTab('cam'); });
    await page.click('#runBtn');
    await page.waitForTimeout(400);
    const allocModalVisible = await page.$eval('#allocModal', el => el.style.display === 'flex').catch(() => false);
    if (allocModalVisible) await page.click('.modal-confirm');

    await page.waitForFunction(() => {
      const body = document.getElementById('resultsBody');
      return body && body.innerText.trim().length > 20;
    }, null, { timeout: 45000 }).catch(() => {});

    const camResultsText = await page.$eval('#resultsBody', el => el.innerText).catch(() => '');
    assert(camResultsText.includes('Anchor Bakery') && camResultsText.includes('Lakeside Dental'),
      'STEP 4: CAM allocation includes both old and new tenants', camResultsText.slice(0, 250));

    const lastResultsLen = await page.evaluate(() => (typeof lastResults !== 'undefined' ? lastResults.length : -1));
    assert(lastResultsLen === 2, 'STEP 4: lastResults has exactly 2 tenant rows', 'lastResults.length=' + lastResultsLen);

    // ── STEP 5: Generate reports ─────────────────────────────────────────────────
    section('STEP 5: Generate reports');
    await page.evaluate(() => { if (typeof switchWorkspaceTab === 'function') switchWorkspaceTab('reports'); });
    const masterReportBtn = await page.$('button[onclick="guardedMasterReport()"]');
    assert(!!masterReportBtn, 'STEP 5: Master Report button present');
    if (masterReportBtn) await masterReportBtn.click();

    await page.waitForFunction(() => {
      const overlay = document.getElementById('reportOverlay');
      return overlay && overlay.style.display !== 'none';
    }, null, { timeout: 45000 }).catch(() => {});

    const reportBodyHtml = await page.$eval('#rptBody', el => el.innerHTML).catch(() => '');
    assert(reportBodyHtml.includes('Anchor Bakery') && reportBodyHtml.includes('Lakeside Dental'),
      'STEP 5: Master Report includes both tenants', reportBodyHtml.length + ' chars');
    assert(reportBodyHtml.includes('Existing Plaza'), 'STEP 5: Master Report shows correct property name');

    await page.evaluate(() => closeReport());
    await page.evaluate(() => { if (typeof switchWorkspaceTab === 'function') switchWorkspaceTab('reports'); });
    const holesBtn = await page.$('button[onclick="generateHolesReport()"]');
    assert(!!holesBtn, 'STEP 5: Coverage Gap Report button present');
    if (holesBtn) await holesBtn.click();
    await page.waitForFunction(() => {
      const overlay = document.getElementById('reportOverlay');
      return overlay && overlay.style.display !== 'none';
    }, null, { timeout: 45000 }).catch(() => {});
    const holesBodyHtml = await page.$eval('#rptBody', el => el.innerHTML).catch(() => '');
    assert(holesBodyHtml.length > 100, 'STEP 5: Coverage Gap Report rendered with content', holesBodyHtml.length + ' chars');

    // ── Console error check ──────────────────────────────────────────────────────
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
    console.log('\x1b[32m✅ Existing landlord workflow E2E verification complete\x1b[0m');
    process.exit(0);
  } else {
    console.log('\x1b[31mResults: ' + failures + ' assertion(s) failed\x1b[0m');
    process.exit(1);
  }
})();
