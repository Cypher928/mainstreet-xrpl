'use strict';
/**
 * test-e2e-tenant-dispute.js — End-to-end Playwright test for the Tenant
 * Dispute workflow:
 *
 *   Open tenant statement → Create dispute → Landlord review → Resolution tracking
 *
 * Seeds an existing property (one tenant, one invoice), runs a real CAM
 * allocation, opens the tenant-facing statement (generateTenantStatement →
 * openReport), files a dispute through the real dispute form
 * (toggleDisputeForm/submitDispute), then drives the landlord-side dispute
 * list (renderOpenDisputes) through to resolution (resolveDispute).
 *
 * Usage:
 *   node test-e2e-tenant-dispute.js
 *
 * Optional env vars:
 *   HEADLESS=false   — open a visible browser
 *   APP_PORT=7848    — local HTTP server port (default: 7848)
 */

let pw;
try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }
const { chromium } = pw;

const http   = require('http');
const { signIn: _e2eSignIn, attachDiagnostics } = require('./test-support/e2e-login');
const fs     = require('fs');
const path   = require('path');
const PORT   = parseInt(process.env.APP_PORT || '7848', 10);
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

const PROP_ID   = 'dispute-prop-1';
const TENANT_ID = 'dispute-tenant-1';

// ── Supabase mock — seeded with one existing property + tenant + invoice ───
const SUPABASE_MOCK = `
(function() {
  var USER_ID = 'e2e-dispute-user';
  var _user = { id: USER_ID, email: 'dispute-landlord@e2e-test.local' };
  var _session = null;

  var _existingTenant = {
    id: '${TENANT_ID}', property_id: '${PROP_ID}',
    name: 'Sunrise Bagels LLC', sqft: 2500, cap: 5,
    start_date: '2022-01-01', end_date: '2027-12-31',
    lease_url: null, lease_type: 'NNN',
  };

  var _store = {
    properties: [{
      id: '${PROP_ID}', user_id: USER_ID,
      name: 'Sunrise Retail Center', sqft: 10000,
      data: {
        invoices: [{ vendorName: 'Acme Cleaning Co', amount: 8000, category: 'cleaning', invoiceDate: '2024-03-10', confidence: {} }],
        disputes: [], camYear: 2024, results: null, camReconciliation: null,
        activityLog: [], timeline: [],
        tenants: [{
          id: '${TENANT_ID}', tenant_name: 'Sunrise Bagels LLC', leased_sqft: 2500, cap: 5,
          start_date: '2022-01-01', end_date: '2027-12-31', lease_type: 'NNN', leaseUrl: null,
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

  try {
    // ── STEP 1: Login + open the existing property ───────────────────────────
    section('STEP 1: Login + open property');
    await page.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'networkidle', timeout: 30000 });

    await _e2eSignIn(page, { email: "dispute-landlord@e2e-test.local", errors: _e2eErrors });

    await page.waitForSelector('.ptf-prop-card:not(.ptf-demo-card)', { timeout: 10000 });
    await page.evaluate((propId) => { if (typeof selectProperty === 'function') selectProperty(propId); }, PROP_ID);
    await page.waitForFunction(() => {
      const el = document.getElementById('propertyName');
      return el && el.value === 'Sunrise Retail Center';
    }, null, { timeout: 45000 });
    await page.waitForTimeout(800); // let background loadPropertyData() refresh settle

    const opened = await page.$eval('#propertyName', el => el.value).catch(() => '');
    assert(opened === 'Sunrise Retail Center', 'STEP 1: property opened', opened);

    // ── STEP 2: Run CAM allocation ─────────────────────────────────────────────
    section('STEP 2: Run CAM allocation');
    await page.evaluate(() => { if (typeof switchWorkspaceTab === 'function') switchWorkspaceTab('cam'); });
    await page.click('#runBtn');
    await page.waitForTimeout(400);
    const allocModalVisible = await page.$eval('#allocModal', el => el.style.display === 'flex').catch(() => false);
    if (allocModalVisible) await page.click('.modal-confirm');

    await page.waitForFunction(() => {
      const body = document.getElementById('resultsBody');
      return body && body.innerText.includes('Sunrise Bagels');
    }, null, { timeout: 45000 }).catch(() => {});

    const resultsText = await page.$eval('#resultsBody', el => el.innerText).catch(() => '');
    assert(resultsText.includes('Sunrise Bagels'), 'STEP 2: CAM allocation produced a result for the tenant', resultsText.slice(0, 150));

    // ── STEP 3: Open tenant statement ────────────────────────────────────────
    section('STEP 3: Open tenant statement');
    const stmtBtn = await page.$('button.tenant-stmt-card-btn');
    assert(!!stmtBtn, 'STEP 3: Tenant Statement button present on result card');
    if (stmtBtn) await stmtBtn.click();

    await page.waitForFunction(() => {
      const overlay = document.getElementById('reportOverlay');
      return overlay && overlay.style.display !== 'none';
    }, null, { timeout: 45000 });

    const stmtHtml = await page.$eval('#rptBody', el => el.innerHTML).catch(() => '');
    assert(stmtHtml.includes('Acme Cleaning Co'), 'STEP 3: tenant statement shows the invoiced charge', stmtHtml.length + ' chars');

    // ── STEP 4: Create dispute ───────────────────────────────────────────────
    section('STEP 4: Create dispute');
    // Charges are grouped into collapsed category accordions — expand first.
    await page.click('#rptBody .ts-cat-header');
    await page.waitForFunction(() => {
      const row = document.querySelector('#rptBody .ts-inv-card');
      return row && row.offsetParent !== null;
    }, null, { timeout: 45000 });
    // Expand the first charge row to reveal the dispute button.
    await page.click('#rptBody .ts-inv-card');
    await page.waitForFunction(() => {
      const btn = document.querySelector('#rptBody .btn-danger-outline');
      return btn && btn.offsetParent !== null;
    }, null, { timeout: 45000 });

    await page.click('#rptBody .btn-danger-outline');
    await page.waitForFunction(() => {
      const ta = document.querySelector('#rptBody .dispute-form textarea');
      return ta && ta.offsetParent !== null;
    }, null, { timeout: 45000 });

    await page.fill('#rptBody .dispute-form textarea', 'This cleaning charge was already billed last quarter — requesting a credit.');
    await page.click('#rptBody .d-submit-btn');

    await page.waitForFunction(() => {
      return document.querySelector('#rptBody .ts-dispute-submitted-msg') != null;
    }, null, { timeout: 45000 }).catch(() => {});

    const submittedMsg = await page.$('#rptBody .ts-dispute-submitted-msg');
    assert(!!submittedMsg, 'STEP 4: dispute submission confirmation shown in tenant statement');

    const disputeCount = await page.evaluate(() => (typeof disputes !== 'undefined' ? disputes.length : -1));
    assert(disputeCount === 1, 'STEP 4: dispute recorded in disputes[]', 'disputes.length=' + disputeCount);

    const disputeStatus = await page.evaluate(() => (typeof disputes !== 'undefined' && disputes[0] ? disputes[0].status : null));
    assert(disputeStatus === 'open', 'STEP 4: new dispute has status "open"', disputeStatus);

    await page.evaluate(() => closeReport());

    // ── STEP 5: Landlord review — dispute appears in the open disputes list ──
    section('STEP 5: Landlord review');
    await page.waitForFunction(() => {
      const sec = document.getElementById('disputeSection');
      return sec && sec.style.display !== 'none';
    }, null, { timeout: 45000 });

    const openDisputesHtml = await page.$eval('#openDisputesList', el => el.innerHTML).catch(() => '');
    assert(openDisputesHtml.includes('Sunrise Bagels'), 'STEP 5: open dispute card shows tenant name', openDisputesHtml.length + ' chars');
    assert(openDisputesHtml.includes('already billed last quarter'), 'STEP 5: open dispute card shows the tenant\'s stated reason');

    const acceptBtn = await page.$('#openDisputesList .d-res-btn.accept');
    assert(!!acceptBtn, 'STEP 5: landlord Accept action available for the open dispute');

    // ── STEP 6: Resolution tracking ──────────────────────────────────────────
    section('STEP 6: Resolution tracking');
    if (acceptBtn) await acceptBtn.click();

    await page.waitForFunction(() => {
      return typeof disputes !== 'undefined' && disputes[0] && disputes[0].status === 'accepted';
    }, null, { timeout: 45000 }).catch(() => {});

    const resolvedStatus = await page.evaluate(() => (typeof disputes !== 'undefined' && disputes[0] ? disputes[0].status : null));
    assert(resolvedStatus === 'accepted', 'STEP 6: dispute status transitioned to "accepted"', resolvedStatus);

    const resolvedAt = await page.evaluate(() => (typeof disputes !== 'undefined' && disputes[0] ? disputes[0].resolvedAt : null));
    assert(!!resolvedAt, 'STEP 6: resolvedAt timestamp recorded', resolvedAt);

    const history = await page.evaluate(() => (typeof disputes !== 'undefined' && disputes[0] ? disputes[0].history : []));
    const hasResolvedEvent = Array.isArray(history) && history.some(h => h.toStatus === 'accepted' && h.fromStatus === 'open');
    assert(hasResolvedEvent, 'STEP 6: history[] records the open → accepted transition', JSON.stringify(history));

    const resolvedCardText = await page.$eval('#openDisputesList', el => el.innerText).catch(() => '');
    assert(resolvedCardText.includes('Accepted'), 'STEP 6: resolved dispute card shows "Accepted" status', resolvedCardText.slice(0, 200));

    const resolvedCountEl = await page.$eval('#resolvedCount', el => el.textContent).catch(() => '');
    assert(resolvedCountEl === '1', 'STEP 6: resolved-count tally updated to 1', resolvedCountEl);

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
    console.log('\x1b[32m✅ Tenant dispute workflow E2E verification complete\x1b[0m');
    process.exit(0);
  } else {
    console.log('\x1b[31mResults: ' + failures + ' assertion(s) failed\x1b[0m');
    process.exit(1);
  }
})();
