'use strict';
/**
 * test-e2e-first-time-experience.js — End-to-end Playwright test for the
 * brand-new-user golden path:
 *
 *   Sign Up → Try Live Demo → Create Property → Upload Lease → Run CAM → Generate Report
 *
 * Mirrors the mocking approach in test-e2e-acquisition.js / test-e2e-phase25-visual.js:
 * a Supabase mock (no real DB) plus route interception of the two server
 * endpoints the app calls during lease extraction (/api/claude, /api/upload),
 * so the test exercises the *real* UI flow (real form submit, real file
 * input, real button clicks) without needing live Claude API access.
 *
 * Usage:
 *   node test-e2e-first-time-experience.js
 *
 * Optional env vars:
 *   HEADLESS=false   — open a visible browser
 *   APP_PORT=7833    — local HTTP server port (default: 7833)
 */

let pw;
try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }
const { chromium } = pw;

const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const PORT   = parseInt(process.env.APP_PORT || '7833', 10);
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

// ── Supabase mock — starts with NO session, so the app shows the login
// screen first (unlike the acquisition/phase25 mocks which auto-sign-in).
// signUp()/signInWithPassword() create a session, matching submitAuth()'s
// direct _showApp(data.session.user) call on a successful sign-up.
const SUPABASE_MOCK = `
(function() {
  var _store   = { properties: [] };
  var _user    = { id: 'e2e-ftux-user-id', email: 'e2e-ftux@test.local' };
  var _session = null;

  function noopPromise(val) { return Promise.resolve(val); }

  function makeQ(tableName) {
    var _filters = {};
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
      in:       function() { return q; },
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
          return Object.keys(_filters).every(function(k) { return r[k] === _filters[k]; });
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
          getUser: function() {
            return noopPromise({ data: { user: _session ? _user : null }, error: null });
          },
          getSession: function() {
            return noopPromise({ data: { session: _session }, error: null });
          },
          refreshSession: function() {
            return noopPromise({ data: { session: _session }, error: null });
          },
          signUp: function() {
            _session = makeSession();
            return noopPromise({ data: { session: _session, user: _user }, error: null });
          },
          signInWithPassword: function() {
            _session = makeSession();
            return noopPromise({ data: { session: _session, user: _user }, error: null });
          },
          onAuthStateChange: function(cb) {
            return { data: { subscription: { unsubscribe: function() {} } } };
          },
          signOut: function() { _session = null; return noopPromise({ error: null }); }
        },
        from: function(table) {
          if (!_store[table]) _store[table] = [];
          return makeQ(table);
        },
        rpc: function() { return noopPromise({ data: null, error: null }); },
        _store: _store
      };
    }
  };
  window.__e2eStore = _store;
})();
`;

// ── Mock Claude lease-extraction response ──────────────────────────────────────
const MOCK_CLAUDE_TENANT = {
  tenant_name: 'Riverside Hardware LLC',
  lease_start_date: '2023-01-01',
  lease_end_date: '2028-12-31',
  lease_type: 'NNN',
  sqft: 5000,
  cam_cap: 5,
  admin_fee_pct: null,
  gross_up_pct: null,
  expense_stop: null,
  audit_rights: true,
  pro_rata_method: 'occupied',
  renewal_options: '1 x 5 year option',
  excluded_categories: 'capital expenditures',
  quotes: {},
};

const LEASE_TEXT = `
LEASE AGREEMENT

This Lease Agreement is entered into between Landlord and Tenant: Riverside Hardware LLC.
Commencement Date: January 1, 2023. Expiration Date: December 31, 2028.
Tenant shall lease approximately 5,000 square feet of the premises.
This is a Triple Net (NNN) lease. CAM charges shall not increase more than 5% per annum.
Tenant's pro rata share shall be calculated based on occupied square footage of the building.
Tenant shall have one (1) five-year renewal option at then-market rent.
Capital expenditures are excluded from the CAM expense pool.
`.repeat(3); // pad past the 1000-char / 100-word "weak text" threshold

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

  const ctx  = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();

  const consoleLogs = [];
  page.on('console', m => consoleLogs.push({ type: m.type(), text: m.text() }));
  page.on('pageerror', e => consoleLogs.push({ type: 'PAGEERROR', text: e.message + ' | ' + (e.stack || '').split('\n').slice(0,5).join(' >> ') }));
  if (process.env.DEBUG_REQ) {
    page.on('requestfailed', r => console.log('REQFAILED:', r.url(), JSON.stringify(r.failure())));
  }

  await page.route('**/supabase-js**', route => route.fulfill({
    status: 200, contentType: 'application/javascript', body: '/* supabase CDN suppressed by e2e mock */'
  }));
  await page.addInitScript(SUPABASE_MOCK);

  // Mock the two server endpoints the lease-upload pipeline calls.
  await page.route('**/api/claude', route => {
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_CLAUDE_TENANT) });
  });
  await page.route('**/api/upload', route => {
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ url: 'https://mock-storage.local/leases/riverside-hardware.txt' }) });
  });

  try {
    // ── STEP 0: App load — login screen ────────────────────────────────────────
    section('STEP 0: App load — login screen shown (no session)');
    await page.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'networkidle', timeout: 30000 });

    const loginVisible = await page.$eval('#loginScreen', el => el.style.display !== 'none').catch(() => false);
    assert(loginVisible, 'STEP 0: login screen visible before sign-up');

    const appHiddenInitially = await page.$eval('#appContent', el => el.style.display === 'none' || el.style.display === '').catch(() => false);
    assert(appHiddenInitially, 'STEP 0: app content hidden before sign-up');

    // ── STEP 1: Sign Up ─────────────────────────────────────────────────────────
    section('STEP 1: Sign Up');
    await page.click('#loginTabSignUp');
    const signUpTabActive = await page.$eval('#loginTabSignUp', el => el.classList.contains('active')).catch(() => false);
    assert(signUpTabActive, 'STEP 1: "Sign Up" tab activates on click');

    await page.fill('#loginEmail', 'newuser@e2e-test.local');
    await page.fill('#loginPassword', 'TestPass123!');
    await page.click('#loginBtn');

    await page.waitForFunction(() => {
      const app = document.getElementById('appContent');
      return app && app.style.display !== 'none' && app.style.display !== '';
    }, null, { timeout: 45000 }).catch(() => {});

    const appVisibleAfterSignup = await page.$eval('#appContent', el => el.style.display !== 'none' && el.style.display !== '').catch(() => false);
    assert(appVisibleAfterSignup, 'STEP 1: app content visible after sign-up submit');

    const loginHiddenAfterSignup = await page.$eval('#loginScreen', el => el.style.display === 'none').catch(() => false);
    assert(loginHiddenAfterSignup, 'STEP 1: login screen hidden after sign-up');

    const dashVisible = await page.$eval('#portfolioDashboard', el => el.style.display !== 'none').catch(() => false);
    assert(dashVisible, 'STEP 1: portfolio dashboard visible after sign-up');

    // ── STEP 2: Try Live Demo ───────────────────────────────────────────────────
    section('STEP 2: Try Live Demo');
    // First-time user with zero real properties — the Cascade Commons demo
    // card ("Open Demo" → loadDemo()) should be discoverable in the grid.
    await page.waitForSelector('.ptf-demo-card', { timeout: 10000 });
    const demoCardCount = await page.$$eval('.ptf-demo-card', els => els.length).catch(() => 0);
    assert(demoCardCount >= 1, 'STEP 2: at least one demo property card rendered', 'found ' + demoCardCount);

    const cascadeCardHtml = await page.$$eval('.ptf-demo-card', els => {
      const el = els.find(e => e.innerText.includes('Cascade Commons'));
      return el ? el.outerHTML.slice(0, 200) : null;
    });
    assert(!!cascadeCardHtml, 'STEP 2: "Cascade Commons" CAM demo card present');

    // Click that card's "Open Demo" button → loadDemo()
    await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('.ptf-demo-card'));
      const card = cards.find(c => c.innerText.includes('Cascade Commons'));
      const btn = card && card.querySelector('.ptf-card-open-btn');
      if (btn) btn.click();
    });

    await page.waitForFunction(() => {
      const el = document.getElementById('propertyName');
      return el && el.value === 'Cascade Commons';
    }, null, { timeout: 45000 }).catch(() => {});

    const demoPropName = await page.$eval('#propertyName', el => el.value).catch(() => '');
    assert(demoPropName === 'Cascade Commons', 'STEP 2: demo property workspace opened ("Cascade Commons")', demoPropName);

    const demoResultsHtml = await page.$eval('#resultsBody', el => el.innerHTML).catch(() => '');
    assert(demoResultsHtml.length > 50, 'STEP 2: demo property shows pre-seeded CAM reconciliation results', demoResultsHtml.length + ' chars');

    // Back to portfolio for the real new-property flow
    await page.evaluate(() => { if (typeof backToPortfolio === 'function') backToPortfolio(); });
    await page.waitForFunction(() => {
      const el = document.getElementById('portfolioDashboard');
      return el && el.style.display !== 'none';
    }, null, { timeout: 45000 });
    pass('STEP 2: returned to portfolio dashboard after exploring demo');

    // ── STEP 3: Create Property ─────────────────────────────────────────────────
    section('STEP 3: Create Property');
    await page.click('.add-prop-btn');
    await page.waitForFunction(() => {
      const el = document.getElementById('propertyName');
      return el && document.getElementById('portfolioDashboard').style.display === 'none';
    }, null, { timeout: 45000 });

    const newPropWorkspaceOpen = await page.$eval('#portfolioDashboard', el => el.style.display === 'none').catch(() => false);
    assert(newPropWorkspaceOpen, 'STEP 3: new property workspace opened (portfolio hidden)');

    await page.fill('#propertyName', 'Maple Street Plaza');
    await page.fill('#totalSqft', '5000');
    // Commit the field edits (blur) before relying on their values downstream.
    await page.evaluate(() => document.getElementById('totalSqft').blur());

    const propNameSet = await page.$eval('#propertyName', el => el.value).catch(() => '');
    assert(propNameSet === 'Maple Street Plaza', 'STEP 3: property name set', propNameSet);

    // ── STEP 4: Upload Lease ────────────────────────────────────────────────────
    section('STEP 4: Upload Lease');
    await page.evaluate(() => { if (typeof switchWorkspaceTab === 'function') switchWorkspaceTab('documents'); });
    const docsTabVisible = await page.$eval('#wsPane-documents', el => el.style.display !== 'none').catch(() => false);
    assert(docsTabVisible, 'STEP 4: Documents tab (lease upload) opened');

    // Real file input drive — a plain-text "lease" (non-.pdf so the app's
    // extractLeaseText() takes the plain-text branch and skips PDF.js parsing).
    // Network calls to /api/claude (extraction) and /api/upload (storage) are
    // mocked above; the upload pipeline (_runLeaseJobPipeline) itself runs for real.
    await page.setInputFiles('#bulkLeaseInput', {
      name: 'riverside-hardware-lease.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from(LEASE_TEXT, 'utf-8'),
    });

    await page.waitForFunction(() => {
      return Array.isArray(window.__lastTenantDataDebug) || document.querySelectorAll('#bulkResults [class*="bulk-t"]').length > 0
        || document.getElementById('bulkResults').innerText.length > 10;
    }, null, { timeout: 45000 }).catch(() => {});
    // Give the async pipeline (upload + extraction + render) a moment to settle.
    await page.waitForTimeout(1500);

    const bulkResultsText = await page.$eval('#bulkResults', el => el.innerText).catch(() => '');
    const tenantExtracted = bulkResultsText.includes('Riverside Hardware');
    assert(tenantExtracted, 'STEP 4: lease processed — tenant name extracted into bulk results', bulkResultsText.slice(0, 150));

    // ── STEP 5: Run CAM ──────────────────────────────────────────────────────────
    section('STEP 5: Run CAM');
    // CAM allocation needs at least one invoice; inject one directly (invoice
    // upload/OCR is a separate pipeline not part of the requested step list).
    await page.evaluate(() => {
      invoiceData.push({
        vendorName: 'Greenfield Landscaping', amount: 12000, category: 'landscaping',
        invoiceDate: '2024-03-15', confidence: {}, _error: null,
      });
      const prop = currentProperty();
      if (prop) prop.invoices = Array.from(invoiceData);
    });

    await page.evaluate(() => { if (typeof switchWorkspaceTab === 'function') switchWorkspaceTab('cam'); });
    const camTabVisible = await page.$eval('#wsPane-cam', el => el.style.display !== 'none').catch(() => false);
    assert(camTabVisible, 'STEP 5: CAM tab opened');

    const runBtnExists = await page.$('#runBtn');
    assert(!!runBtnExists, 'STEP 5: "Calculate CAM Charges" button present');
    await page.click('#runBtn');

    // showAllocationModal() may show a confirm dialog or call runAllocation() directly.
    await page.waitForTimeout(400);
    const allocModalVisible = await page.$eval('#allocModal', el => el.style.display === 'flex').catch(() => false);
    if (allocModalVisible) {
      await page.click('.modal-confirm');
      info('Allocation confirm modal appeared — confirmed.');
    }

    await page.waitForFunction(() => {
      const body = document.getElementById('resultsBody');
      return body && body.innerText.trim().length > 20;
    }, null, { timeout: 45000 }).catch(() => {});

    const camResultsText = await page.$eval('#resultsBody', el => el.innerText).catch(() => '');
    const camRanSuccessfully = camResultsText.includes('Riverside Hardware') || /\$[\d,]+/.test(camResultsText);
    assert(camRanSuccessfully, 'STEP 5: CAM allocation ran — results table shows tenant/dollar figures', camResultsText.slice(0, 150));

    const lastResultsLen = await page.evaluate(() => (typeof lastResults !== 'undefined' ? lastResults.length : -1));
    assert(lastResultsLen > 0, 'STEP 5: lastResults populated after CAM run', 'lastResults.length=' + lastResultsLen);

    // ── STEP 6: Generate Report ─────────────────────────────────────────────────
    section('STEP 6: Generate Report');
    await page.evaluate(() => { if (typeof switchWorkspaceTab === 'function') switchWorkspaceTab('reports'); });
    const reportsTabVisible = await page.$eval('#wsPane-reports', el => el.style.display !== 'none').catch(() => false);
    assert(reportsTabVisible, 'STEP 6: Reports tab opened');

    const masterReportBtn = await page.$('button[onclick="guardedMasterReport()"]');
    assert(!!masterReportBtn, 'STEP 6: Master Report button present');
    if (masterReportBtn) await masterReportBtn.click();

    await page.waitForFunction(() => {
      const overlay = document.getElementById('reportOverlay');
      return overlay && overlay.style.display !== 'none';
    }, null, { timeout: 45000 }).catch(() => {});

    const reportOverlayVisible = await page.$eval('#reportOverlay', el => el.style.display !== 'none').catch(() => false);
    assert(reportOverlayVisible, 'STEP 6: report overlay opened after clicking Master Report');

    const reportBodyHtml = await page.$eval('#rptBody', el => el.innerHTML).catch(() => '');
    assert(reportBodyHtml.length > 200, 'STEP 6: report body rendered with content', reportBodyHtml.length + ' chars');

    const reportMentionsTenant = reportBodyHtml.includes('Riverside Hardware');
    assert(reportMentionsTenant, 'STEP 6: report includes the uploaded tenant', reportMentionsTenant ? '' : 'tenant name not found in report HTML');

    const reportMentionsProperty = reportBodyHtml.includes('Maple Street Plaza');
    assert(reportMentionsProperty, 'STEP 6: report header shows the created property name', reportMentionsProperty ? '' : 'property name not found in report HTML');

    // ── Console error check across the whole flow ──────────────────────────────
    section('Console error check');
    const pageErrors = consoleLogs.filter(l => l.type === 'PAGEERROR');
    if (pageErrors.length) {
      pageErrors.forEach(e => info('PAGE ERROR: ' + e.text.slice(0, 200)));
    }
    assert(pageErrors.length === 0, 'No uncaught page errors across the full flow', pageErrors.map(e => e.text).join(' | ').slice(0, 300));

    const consoleErrors = consoleLogs.filter(l => l.type === 'error');
    if (consoleErrors.length) {
      info(consoleErrors.length + ' console.error() call(s) logged (see detail below) — not necessarily failures:');
      consoleErrors.forEach(e => info('  console.error: ' + e.text.slice(0, 200)));
    }

  } finally {
    await browser.close();
    server.close();
  }

  // ── Summary ──────────────────────────────────────────────────────────────────
  console.log('\n' + '─'.repeat(64));
  if (failures === 0) {
    console.log('\x1b[32mResults: all assertions passed — 0 failures\x1b[0m');
    console.log('\x1b[32m✅ First-time user experience E2E verification complete\x1b[0m');
    process.exit(0);
  } else {
    console.log('\x1b[31mResults: ' + failures + ' assertion(s) failed\x1b[0m');
    process.exit(1);
  }
})();
