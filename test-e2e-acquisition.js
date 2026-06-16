'use strict';
/**
 * test-e2e-acquisition.js — End-to-end Playwright tests for Acquisition Due Diligence.
 *
 * Covers:
 *  ACQ-E2E-1  App loads; portfolio dashboard visible; acquisition section visible
 *  ACQ-E2E-2  Empty acquisition section shows prompt copy
 *  ACQ-E2E-3  "New Review" creates a review; detail panel opens
 *  ACQ-E2E-4  Analyze button disabled until tenants + invoices + sqft present
 *  ACQ-E2E-5  runAcquisitionAnalysis() renders KPI summary cards
 *  ACQ-E2E-6  Report includes at least one findings row
 *  ACQ-E2E-7  Report status badge changes to "complete"
 *  ACQ-E2E-8  Back to portfolio: acquisition card appears with correct name
 *  ACQ-E2E-9  Re-entering the review restores previous analysis report
 *  ACQ-E2E-10 No console errors matching known acquisition namespaces
 *
 * Uses a Supabase mock (no real DB), intercepts the Supabase CDN script,
 * and injects mock tenant/invoice data directly via page.evaluate so
 * no Claude API calls are required.
 *
 * Usage:
 *   node test-e2e-acquisition.js
 *
 * Optional env vars:
 *   HEADLESS=false   — open a visible browser
 *   APP_PORT=7821    — local HTTP server port (default: 7821)
 */

let pw;
try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }
const { chromium } = pw;

const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const PORT   = parseInt(process.env.APP_PORT || '7821', 10);
const HEADLESS = process.env.HEADLESS !== 'false';
const ROOT   = __dirname;

// ── Logging helpers ────────────────────────────────────────────────────────────
let failures = 0;
function pass(label)    { console.log('\x1b[32m  ✅ ' + label + '\x1b[0m'); }
function fail(label, d) { console.error('\x1b[31m  ❌ ' + label + (d ? ' — ' + d : '') + '\x1b[0m'); failures++; }
function info(label)    { console.log('  · ' + label); }
function section(label) { console.log('\n── ' + label + ' ' + '─'.repeat(Math.max(0, 60 - label.length))); }
function assert(cond, label, detail) { cond ? pass(label) : fail(label, detail); }

// ── Local HTTP server ──────────────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html', '.js': 'application/javascript',
  '.css': 'text/css',  '.json': 'application/json',
  '.png': 'image/png', '.ico': 'image/x-icon',
};

function startServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let filePath = path.join(ROOT, req.url === '/' ? '/index.html' : req.url);
      // strip query strings
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

// ── Supabase mock (injected as init script) ────────────────────────────────────
// Sets window.supabase.createClient before script.js runs.
// Handles all tables the app queries on startup + acquisition_reviews.
const SUPABASE_MOCK = `
(function() {
  var _store = { acquisition_reviews: [] };
  var _user  = { id: 'e2e-test-user-id', email: 'e2e@test.local' };

  function noopPromise(val) { return Promise.resolve(val); }

  function makeQ(tableName) {
    var _filters = {};
    var q = {
      select:   function() { return q; },
      insert:   function(rows) {
        var arr = Array.isArray(rows) ? rows : [rows];
        if (_store[tableName]) arr.forEach(function(r) { _store[tableName].push(r); });
        return noopPromise({ data: arr, error: null });
      },
      upsert:   function(row) {
        if (_store[tableName]) {
          var idx = _store[tableName].findIndex(function(r) { return r.id === row.id; });
          if (idx >= 0) _store[tableName][idx] = row; else _store[tableName].push(row);
        }
        return noopPromise({ data: [row], error: null });
      },
      update:   function() { return noopPromise({ data: null, error: null }); },
      delete:   function() {
        return { eq: function() { return noopPromise({ error: null }); } };
      },
      eq:       function(col, val) { _filters[col] = val; return q; },
      neq:      function() { return q; },
      in:       function() { return q; },
      order:    function() { return q; },
      limit:    function() { return q; },
      single:   function() {
        var rows = _store[tableName] || [];
        return noopPromise({ data: rows[0] || null, error: null });
      },
      then: function(fn) {
        var rows = (_store[tableName] || []).filter(function(r) {
          return Object.keys(_filters).every(function(k) { return r[k] === _filters[k]; });
        });
        return noopPromise({ data: rows, error: null }).then(fn);
      }
    };
    return q;
  }

  var _authCb = null;

  window.supabase = {
    createClient: function() {
      return {
        auth: {
          getUser: function() {
            return noopPromise({ data: { user: _user }, error: null });
          },
          getSession: function() {
            return noopPromise({ data: { session: { user: _user } }, error: null });
          },
          onAuthStateChange: function(cb) {
            _authCb = cb;
            setTimeout(function() { cb('SIGNED_IN', { user: _user }); }, 50);
            return { data: { subscription: { unsubscribe: function() {} } } };
          },
          signOut: function() { return noopPromise({ error: null }); }
        },
        from: function(table) {
          if (!_store[table]) _store[table] = [];
          return makeQ(table);
        },
        _store: _store
      };
    }
  };

  // Expose store reference for test assertions
  window.__e2eStore = _store;
})();
`;

// ── Tenant/invoice fixtures (used to bypass Claude API) ───────────────────────
const MOCK_TENANTS = [
  {
    tenant_name: 'Acme Corp', tenantName: 'Acme Corp',
    unit: '101', lease_type: 'NNN',
    sqft: 3000, leased_sqft: 3000,
    start_date: '2022-01-01', end_date: '2027-06-30',
    cap: 5, cap_base_year: 2022, cap_base_amount: 18000,
    pro_rata_method: 'occupied',
    audit_rights: '30 days written notice',
    renewal_options: '1 × 5 year option',
    excluded_categories: 'capital expenditures, management fees',
    expense_stop: null, gross_up_pct: null,
    _status: 'ok',
    quotes: {
      cam_cap: 'CAM charges shall not increase more than 5% per annum over the prior year.',
      audit_rights: 'Tenant shall have the right to audit CAM charges with 30 days written notice.',
      renewal_options: 'Tenant shall have one (1) five-year renewal option at then-market rent.',
      pro_rata_method: 'Tenant\'s share based on occupied square footage of the building.',
      excluded_categories: 'Capital expenditures, management fees, and structural repairs are excluded.'
    }
  },
  {
    tenant_name: 'Globex LLC', tenantName: 'Globex LLC',
    unit: '102', lease_type: 'Gross',
    sqft: 4000, leased_sqft: 4000,
    start_date: '2021-06-01', end_date: '2026-05-31',
    cap: 0, pro_rata_method: 'rentable',
    audit_rights: null, renewal_options: null,
    excluded_categories: null,
    _status: 'ok',
    quotes: {}
  }
];

const MOCK_INVOICES = [
  { vendorName: 'ABC Landscaping',  amount: 12000, category: 'landscaping',   _status: 'ok' },
  { vendorName: 'XYZ Maintenance',  amount: 8500,  category: 'maintenance',   _status: 'ok' },
  { vendorName: 'Parking Services', amount: 3000,  category: 'parking',       _status: 'ok' }
];

// ── Main ───────────────────────────────────────────────────────────────────────
(async () => {
  info('Starting local HTTP server on port ' + PORT + '…');
  const server = await startServer();
  info('Server ready at http://127.0.0.1:' + PORT);

  const browser = await chromium.launch({
    headless: HEADLESS,
    executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const ctx  = await browser.newContext();
  const page = await ctx.newPage();

  // Collect console + errors
  const consoleLogs = [];
  page.on('console', m => consoleLogs.push({ type: m.type(), text: m.text() }));
  page.on('pageerror', e => consoleLogs.push({ type: 'PAGEERROR', text: e.message }));

  // Intercept Supabase CDN — replace with empty comment so window.supabase stays as our mock
  await page.route('**/supabase-js**', route => route.fulfill({
    status: 200, contentType: 'application/javascript', body: '/* supabase CDN suppressed by e2e mock */'
  }));

  // Inject Supabase mock before ANY page script runs
  await page.addInitScript(SUPABASE_MOCK);

  try {
    // ── ACQ-E2E-1: App loads; portfolio dashboard visible ──────────────────────
    section('ACQ-E2E-1: App load');
    await page.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'networkidle', timeout: 30000 });

    // Wait for the mock auth callback to fire _showApp → reveals appContent
    await page.waitForFunction(() => {
      const app = document.getElementById('appContent');
      return app && app.style.display !== 'none' && app.style.display !== '';
    }, { timeout: 10000 });

    const dashVisible = await page.$eval('#portfolioDashboard', el => el.style.display !== 'none').catch(() => false);
    assert(dashVisible, 'ACQ-E2E-1: portfolio dashboard visible after auth mock fires');

    const loginHidden = await page.$eval('#loginScreen', el => el.style.display === 'none').catch(() => false);
    assert(loginHidden, 'ACQ-E2E-1: login screen hidden after sign-in');

    // ── ACQ-E2E-2: Acquisition section visible; empty state ───────────────────
    section('ACQ-E2E-2: Acquisition section empty state');
    const acqSectionVisible = await page.$eval('#acqSection', el => !!el).catch(() => false);
    assert(acqSectionVisible, 'ACQ-E2E-2: #acqSection exists in DOM');

    const acqGridHTML = await page.$eval('#acqReviewsGrid', el => el.innerHTML).catch(() => '');
    const hasEmptyMsg = acqGridHTML.toLowerCase().includes('no due diligence') ||
                        acqGridHTML.toLowerCase().includes('start one');
    assert(hasEmptyMsg, 'ACQ-E2E-2: empty-state message shown when no reviews exist', acqGridHTML.slice(0, 80));

    // ── ACQ-E2E-3: Create review via mocked prompt ────────────────────────────
    section('ACQ-E2E-3: Create new review');
    // Override window.prompt so the dialog auto-returns the test name
    await page.evaluate(() => { window.prompt = () => '123 Main Street Acquisition'; });

    // Dismiss the onboarding welcome modal if it is visible — it intercepts
    // pointer events and would block all subsequent clicks in the test.
    await page.evaluate(() => {
      const m = document.getElementById('obWelcomeModal');
      if (m && m.style.display !== 'none') { if (typeof obCloseWelcome === 'function') obCloseWelcome('skip'); else m.style.display = 'none'; }
    });

    await page.click('.acq-new-btn');
    // Detail panel should appear
    await page.waitForFunction(() => {
      const p = document.getElementById('acqDetailPanel');
      return p && p.style.display !== 'none';
    }, { timeout: 5000 });

    const titleText = await page.$eval('#acqDetailTitle', el => el.textContent).catch(() => '');
    assert(titleText.includes('123 Main Street'), 'ACQ-E2E-3: detail panel title matches review name', titleText);

    const badgeText = await page.$eval('#acqDetailBadge', el => el.textContent).catch(() => '');
    assert(badgeText === 'draft', 'ACQ-E2E-3: initial badge is "draft"', badgeText);

    const portfolioHidden = await page.$eval('#portfolioDashboard', el => el.style.display === 'none').catch(() => false);
    assert(portfolioHidden, 'ACQ-E2E-3: portfolio dashboard hidden while in detail panel');

    // ── ACQ-E2E-4: Analyze button disabled before data injected ───────────────
    section('ACQ-E2E-4: Analyze button guard');
    const btnDisabledInitially = await page.$eval('#acqAnalyzeBtn', el => el.disabled).catch(() => true);
    assert(btnDisabledInitially, 'ACQ-E2E-4: analyze button disabled before tenants/invoices/sqft');

    // Inject mock tenants/invoices by mutating the shared store object then
    // calling selectAcquisitionReview so script.js re-hydrates _acqTenants etc.
    // (let variables in script.js are not window properties; the shared-reference
    // trick lets us reach them through the functions that read review.data.)
    await page.evaluate((fixtures) => {
      // createAcquisitionReview pushes the same object reference into both
      // _acqReviews and the mock store, so mutating one mutates the other.
      var storeReview = window.__e2eStore && window.__e2eStore.acquisition_reviews &&
                        window.__e2eStore.acquisition_reviews[0];
      if (!storeReview) { console.error('[e2e] no review in store'); return; }
      var reviewId = storeReview.id;
      storeReview.data = {
        tenants:   fixtures.tenants,
        invoices:  fixtures.invoices,
        totalSqFt: 10000,
        documents: [],
        analysis:  null,
      };
      // Re-select → sets _acqTenants, _acqInvoices, _acqSqFt, calls _updateAcqAnalyzeBtn
      window.selectAcquisitionReview(reviewId);
    }, { tenants: MOCK_TENANTS, invoices: MOCK_INVOICES });

    await page.waitForTimeout(300);

    const btnEnabled = await page.$eval('#acqAnalyzeBtn', el => !el.disabled).catch(() => false);
    assert(btnEnabled, 'ACQ-E2E-4: analyze button enabled after tenants + invoices + sqft');

    // ── ACQ-E2E-5/6/7: Run analysis; report renders; badge updates ────────────
    section('ACQ-E2E-5/6/7: Run analysis');
    await page.click('#acqAnalyzeBtn');
    // Wait for report container to have content
    await page.waitForFunction(() => {
      const c = document.getElementById('acqReportContainer');
      return c && c.innerHTML.length > 100;
    }, { timeout: 8000 });

    // ACQ-E2E-5: KPI cards rendered
    const kpiRow = await page.$('.acq-kpi-row').catch(() => null);
    assert(!!kpiRow, 'ACQ-E2E-5: .acq-kpi-row (KPI summary) rendered in report');

    const kpiText = await page.$eval('.acq-kpi-row', el => el.innerText).catch(() => '');
    const hasRecovery = /recovery|tenants|invoices/i.test(kpiText);
    assert(hasRecovery, 'ACQ-E2E-5: KPI row contains recovery/tenant/invoice metric', kpiText.slice(0, 80));

    // ACQ-E2E-6: Findings section rendered
    const findingsList = await page.$$('.acq-finding-item').catch(() => []);
    assert(findingsList.length > 0, 'ACQ-E2E-6: at least one finding item rendered in report');
    info('Findings rendered: ' + findingsList.length);

    // ACQ-E2E-7: Badge changed to complete
    const badgeAfter = await page.$eval('#acqDetailBadge', el => el.textContent).catch(() => '');
    assert(badgeAfter === 'complete', 'ACQ-E2E-7: badge updated to "complete" after analysis', badgeAfter);

    // ── ACQ-E2E-8: Back to portfolio; acquisition card visible ─────────────────
    section('ACQ-E2E-8: Back to portfolio');
    const backBtn = await page.$('.acq-detail-header button');
    assert(!!backBtn, 'ACQ-E2E-8: back button exists in detail header');
    await backBtn.click();
    await page.waitForTimeout(300);

    const dashAfterBack = await page.$eval('#portfolioDashboard', el => el.style.display !== 'none').catch(() => false);
    assert(dashAfterBack, 'ACQ-E2E-8: portfolio dashboard visible after back navigation');

    const acqCards = await page.$$('.acq-card').catch(() => []);
    assert(acqCards.length >= 1, 'ACQ-E2E-8: at least one acquisition card shown in portfolio');

    const cardText = await page.$eval('.acq-card', el => el.innerText).catch(() => '');
    assert(cardText.includes('123 Main Street'), 'ACQ-E2E-8: card name matches created review', cardText.slice(0, 60));

    const cardComplete = cardText.toLowerCase().includes('complete');
    assert(cardComplete, 'ACQ-E2E-8: card shows "complete" status', cardText.slice(0, 80));

    // ── ACQ-E2E-9: Re-enter review; report still rendered ─────────────────────
    section('ACQ-E2E-9: Re-enter review — report persists');
    await page.click('.acq-card');
    await page.waitForFunction(() => {
      const p = document.getElementById('acqDetailPanel');
      return p && p.style.display !== 'none';
    }, { timeout: 5000 });

    const reportAfterReentry = await page.$eval('#acqReportContainer', el => el.innerHTML).catch(() => '');
    assert(reportAfterReentry.length > 100, 'ACQ-E2E-9: report container still has content after re-entry', reportAfterReentry.length + ' chars');

    const kpiAfterReentry = await page.$('.acq-kpi-row').catch(() => null);
    assert(!!kpiAfterReentry, 'ACQ-E2E-9: KPI row still visible after re-entry');

    const findingsAfterReentry = await page.$$('.acq-finding-item').catch(() => []);
    assert(findingsAfterReentry.length > 0, 'ACQ-E2E-9: findings still visible after re-entry');

    // ── ACQ-E2E-10: No unexpected console errors ───────────────────────────────
    section('ACQ-E2E-10: Console error check');
    const acqErrors = consoleLogs.filter(l =>
      (l.type === 'error' || l.type === 'PAGEERROR') &&
      /\[acq\]|AcquisitionEngine|acquisition_reviews/i.test(l.text)
    );
    if (acqErrors.length) {
      acqErrors.forEach(e => info('console error: ' + e.text));
    }
    assert(acqErrors.length === 0, 'ACQ-E2E-10: no [acq] / AcquisitionEngine console errors', acqErrors.map(e => e.text).join('; '));

    const pageErrors = consoleLogs.filter(l => l.type === 'PAGEERROR');
    if (pageErrors.length) {
      pageErrors.forEach(e => info('page error: ' + e.text.slice(0, 100)));
    }
    assert(pageErrors.length === 0, 'ACQ-E2E-10: no uncaught page errors', pageErrors.map(e => e.text).join('; '));

  } finally {
    await browser.close();
    server.close();
  }

  // ── Summary ──────────────────────────────────────────────────────────────────
  console.log('\n' + '─'.repeat(64));
  if (failures === 0) {
    console.log('\x1b[32mResults: 10/10 ACQ-E2E assertions passed\x1b[0m');
    console.log('\x1b[32m✅ Acquisition E2E verification complete\x1b[0m');
    process.exit(0);
  } else {
    console.log('\x1b[31mResults: ' + (10 - failures) + '/10 passed, ' + failures + ' failed\x1b[0m');
    process.exit(1);
  }
})();
