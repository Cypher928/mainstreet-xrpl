'use strict';
/**
 * test-e2e-reports.js — End-to-end Playwright test for the Reports workflow:
 *
 *   Generate every report type → Verify rendering → Verify mobile layouts →
 *   Verify PDF generation
 *
 * Seeds an existing property (one tenant, one invoice), runs a real CAM
 * allocation, then drives every report button in the Reports tab
 * (#reportsSection) through the real openReport()/#reportOverlay pipeline.
 * Re-opens the Master Report under a mobile viewport to confirm the
 * @media (max-width:600px) report styling actually applies, then verifies
 * the "Print / Save PDF" button invokes window.print().
 *
 * Usage:
 *   node test-e2e-reports.js
 *
 * Optional env vars:
 *   HEADLESS=false   — open a visible browser
 *   APP_PORT=7855    — local HTTP server port (default: 7855)
 */

let pw;
try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }
const { chromium } = pw;

const http   = require('http');
const { signIn: _e2eSignIn, attachDiagnostics } = require('./test-support/e2e-login');
const fs     = require('fs');
const path   = require('path');
const PORT   = parseInt(process.env.APP_PORT || '7855', 10);
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

const PROP_ID   = 'reports-prop-1';
const TENANT_ID = 'reports-tenant-1';

// ── Supabase mock — seeded with one existing property + tenant + invoice ───
const SUPABASE_MOCK = `
(function() {
  var USER_ID = 'e2e-reports-user';
  var _user = { id: USER_ID, email: 'reports@e2e-test.local' };
  var _session = null;

  var _existingTenant = {
    id: '${TENANT_ID}', property_id: '${PROP_ID}',
    name: 'Pacific Hardware Co', sqft: 3000, cap: 4,
    start_date: '2021-01-01', end_date: '2026-12-31',
    lease_url: null, lease_type: 'NNN',
  };

  var _store = {
    properties: [{
      id: '${PROP_ID}', user_id: USER_ID,
      name: 'Crestview Commons', sqft: 12000,
      data: {
        invoices: [{ vendorName: 'Greenfield Landscaping', amount: 9600, category: 'landscaping', invoiceDate: '2024-04-05', confidence: {} }],
        disputes: [], camYear: 2024, results: null, camReconciliation: null,
        activityLog: [], timeline: [],
        tenants: [{
          id: '${TENANT_ID}', tenant_name: 'Pacific Hardware Co', leased_sqft: 3000, cap: 4,
          start_date: '2021-01-01', end_date: '2026-12-31', lease_type: 'NNN', leaseUrl: null,
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

// Every static report button reachable from the Reports tab, keyed by a
// short id for reporting, with the selector that triggers it and the text
// we expect somewhere in the rendered report body.
const REPORT_BUTTONS = [
  { id: 'master',       selector: 'button[onclick="guardedMasterReport()"]',           expectText: 'Pacific Hardware' },
  { id: 'risk',         selector: 'button[onclick="generateLandlordExport()"]',        expectText: 'Crestview Commons' },
  { id: 'lease-review', selector: 'button[onclick="generateLeaseReviewPacketReport()"]', expectText: 'Pacific Hardware' },
  { id: 'reconciliation', selector: 'button[onclick="guardedReconciliationSummary()"]', expectText: 'Crestview Commons' },
  { id: 'tenant-stmt',  selector: 'button[onclick="guardedTenantStatement()"]',         expectText: 'Pacific Hardware' },
  { id: 'coverage-gap', selector: 'button[onclick="generateHolesReport()"]',            expectText: null },
  { id: 'exception',    selector: 'button[onclick="guardedExceptionReport()"]',         expectText: null },
  { id: 'lender',       selector: 'button[onclick="generateLenderSummaryReport()"]',    expectText: 'Crestview Commons' },
];

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
    // ── STEP 1: Login + open property + run CAM ──────────────────────────────
    section('STEP 1: Login, open property, run CAM');
    await page.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'networkidle', timeout: 30000 });

    await _e2eSignIn(page, { email: "reports@e2e-test.local", errors: _e2eErrors });

    await page.waitForSelector('.ptf-prop-card:not(.ptf-demo-card)', { timeout: 10000 });
    await page.evaluate((propId) => { if (typeof selectProperty === 'function') selectProperty(propId); }, PROP_ID);
    await page.waitForFunction(() => {
      const el = document.getElementById('propertyName');
      return el && el.value === 'Crestview Commons';
    }, null, { timeout: 45000 });
    await page.waitForTimeout(800);

    await page.evaluate(() => { if (typeof switchWorkspaceTab === 'function') switchWorkspaceTab('cam'); });
    await page.click('#runBtn');
    await page.waitForTimeout(400);
    const allocModalVisible = await page.$eval('#allocModal', el => el.style.display === 'flex').catch(() => false);
    if (allocModalVisible) await page.click('.modal-confirm');

    await page.waitForFunction(() => {
      const body = document.getElementById('resultsBody');
      return body && body.innerText.includes('Pacific Hardware');
    }, null, { timeout: 45000 }).catch(() => {});

    const camOk = await page.$eval('#resultsBody', el => el.innerText.includes('Pacific Hardware')).catch(() => false);
    assert(camOk, 'STEP 1: CAM allocation ran successfully');

    // ── STEP 2: Generate every report type; verify rendering ─────────────────
    section('STEP 2: Generate every report type');
    await page.evaluate(() => { if (typeof switchWorkspaceTab === 'function') switchWorkspaceTab('reports'); });

    for (const r of REPORT_BUTTONS) {
      const btn = await page.$(r.selector);
      if (!btn) { fail('REPORT[' + r.id + ']: button found', r.selector); continue; }
      await btn.click();
      const opened = await page.waitForFunction(() => {
        const overlay = document.getElementById('reportOverlay');
        return overlay && overlay.style.display !== 'none';
      }, null, { timeout: 45000 }).then(() => true).catch(() => false);
      assert(opened, 'REPORT[' + r.id + ']: report overlay opened');

      if (opened) {
        const html = await page.$eval('#rptBody', el => el.innerHTML).catch(() => '');
        assert(html.length > 100, 'REPORT[' + r.id + ']: report body has substantive content', html.length + ' chars');
        if (r.expectText) {
          assert(html.includes(r.expectText), 'REPORT[' + r.id + ']: report content includes "' + r.expectText + '"', html.slice(0, 150));
        }
        await page.evaluate(() => closeReport());
        await page.evaluate(() => { if (typeof switchWorkspaceTab === 'function') switchWorkspaceTab('reports'); });
      }
    }

    // Lease Intelligence Score (dev-only slot — visible on localhost/127.0.0.1)
    const testLabBtn = await page.$('#testLabReportSlot button[onclick="generateTestLabBenchmarkReport()"]');
    if (testLabBtn) {
      const slotVisible = await page.$eval('#testLabReportSlot', el => el.style.display !== 'none').catch(() => false);
      if (slotVisible) {
        await testLabBtn.click();
        const opened = await page.waitForFunction(() => {
          const overlay = document.getElementById('reportOverlay');
          return overlay && overlay.style.display !== 'none';
        }, null, { timeout: 45000 }).then(() => true).catch(() => false);
        assert(opened, 'REPORT[test-lab-score]: Lease Intelligence Score report overlay opened');
        if (opened) {
          const html = await page.$eval('#rptBody', el => el.innerHTML).catch(() => '');
          assert(html.length > 50, 'REPORT[test-lab-score]: report body has content', html.length + ' chars');
          await page.evaluate(() => closeReport());
        }
      } else {
        info('REPORT[test-lab-score]: slot present but hidden — skipped');
      }
    } else {
      info('REPORT[test-lab-score]: button not found — skipped');
    }

    // ── STEP 3: Verify mobile layout ──────────────────────────────────────────
    section('STEP 3: Verify mobile layout');
    await page.setViewportSize({ width: 375, height: 812 });
    await page.evaluate(() => { if (typeof switchWorkspaceTab === 'function') switchWorkspaceTab('reports'); });
    await page.click('button[onclick="guardedMasterReport()"]');
    await page.waitForFunction(() => {
      const overlay = document.getElementById('reportOverlay');
      return overlay && overlay.style.display !== 'none';
    }, null, { timeout: 45000 });

    const toolBtnFontSize = await page.$eval('.rpt-tool-btn', el => getComputedStyle(el).fontSize).catch(() => '');
    assert(toolBtnFontSize === '12.48px', 'STEP 3: mobile @media(max-width:600px) report toolbar styling applied', toolBtnFontSize);

    const titleEllipsis = await page.$eval('#rptToolbarTitle', el => getComputedStyle(el).textOverflow).catch(() => '');
    assert(titleEllipsis === 'ellipsis', 'STEP 3: report title truncates with ellipsis on narrow viewport', titleEllipsis);

    const noHorizontalOverflow = await page.evaluate(() => {
      const overlay = document.getElementById('reportOverlay');
      return overlay.scrollWidth <= window.innerWidth + 1;
    });
    assert(noHorizontalOverflow, 'STEP 3: report overlay does not overflow the mobile viewport horizontally');

    // ── STEP 4: Verify PDF generation ─────────────────────────────────────────
    section('STEP 4: Verify PDF generation');
    await page.evaluate(() => { window.__printCalled = false; window.print = () => { window.__printCalled = true; }; });
    await page.click('button[onclick="window.print()"]');
    const printCalled = await page.evaluate(() => window.__printCalled);
    assert(printCalled, 'STEP 4: "Print / Save PDF" button invokes window.print()');

    await page.evaluate(() => closeReport());
    await page.setViewportSize({ width: 1280, height: 900 });

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
    console.log('\x1b[32m✅ Reports workflow E2E verification complete\x1b[0m');
    process.exit(0);
  } else {
    console.log('\x1b[31mResults: ' + failures + ' assertion(s) failed\x1b[0m');
    process.exit(1);
  }
})();
