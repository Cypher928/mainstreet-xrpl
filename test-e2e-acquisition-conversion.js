'use strict';
/**
 * test-e2e-acquisition-conversion.js — End-to-end Playwright test for the
 * Acquisition Review workflow, driving REAL uploads through the actual
 * extraction pipeline (unlike test-e2e-acquisition.js, which injects fixture
 * tenants/invoices directly to bypass Claude):
 *
 *   Upload leases → Upload invoices → Complete review → Convert to property
 *
 * Mocks /api/claude and /api/upload via page.route so the real
 * acqHandleLeaseFiles()/acqHandleInvoiceFiles() pipeline runs end to end,
 * then drives runAcquisitionAnalysis() and convertAcquisitionToProperty()
 * and confirms a real, managed property is created with the review's tenant.
 *
 * Usage:
 *   node test-e2e-acquisition-conversion.js
 *
 * Optional env vars:
 *   HEADLESS=false   — open a visible browser
 *   APP_PORT=7842    — local HTTP server port (default: 7842)
 */

let pw;
try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }
const { chromium } = pw;

const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const PORT   = parseInt(process.env.APP_PORT || '7842', 10);
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

// ── Supabase mock — clean account, no pre-existing reviews/properties ──────
const SUPABASE_MOCK = `
(function() {
  var USER_ID = 'e2e-acq-conversion-user';
  var _user = { id: USER_ID, email: 'acq-conversion@e2e-test.local' };
  var _session = null;

  var _store = { properties: [], tenants: [], acquisition_reviews: [] };

  function noopPromise(val) { return Promise.resolve(val); }
  function genId() { return 'mock-' + Math.random().toString(36).slice(2) + Date.now().toString(36); }

  function makeQ(tableName) {
    var _filters = {};
    var _inFilters = {};
    var q = {
      select:   function() { return q; },
      insert:   function(rows) {
        var arr = Array.isArray(rows) ? rows : [rows];
        arr.forEach(function(r) { if (!r.id) r.id = genId(); });
        if (_store[tableName]) arr.forEach(function(r) { _store[tableName].push(r); });
        var result = noopPromise({ data: arr, error: null });
        result.select = function() { return { single: function() { return noopPromise({ data: arr[0], error: null }); }, then: function(fn) { return noopPromise({ data: arr, error: null }).then(fn); } }; };
        return result;
      },
      upsert:   function(rows) {
        var arr = Array.isArray(rows) ? rows : [rows];
        arr.forEach(function(r) {
          if (!r.id) r.id = genId();
          if (_store[tableName]) {
            var idx = _store[tableName].findIndex(function(x) { return x.id === r.id; });
            if (idx >= 0) _store[tableName][idx] = r; else _store[tableName].push(r);
          }
        });
        var result = noopPromise({ data: arr, error: null });
        result.select = function() { return noopPromise({ data: arr, error: null }); };
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

const MOCK_TENANT = {
  tenant_name: 'Harborview Outfitters',
  lease_start_date: '2023-03-01',
  lease_end_date: '2028-02-29',
  lease_type: 'NNN',
  sqft: 2600,
  cam_cap: 4,
  audit_rights: true,
  pro_rata_method: 'occupied',
  renewal_options: '1 x 5 year option',
  excluded_categories: 'capital expenditures',
  quotes: {},
};

const LEASE_TEXT = `
LEASE AGREEMENT
Tenant: Harborview Outfitters. Commencement Date: March 1, 2023. Expiration Date: February 29, 2028.
Tenant shall lease approximately 2,600 square feet. This is a Triple Net (NNN) lease.
CAM charges shall not increase more than 4% per annum. Pro rata share based on occupied square footage.
Tenant shall have one (1) five-year renewal option. Capital expenditures are excluded from CAM.
`.repeat(4);

const MOCK_INVOICE = { vendorName: 'Harbor Cleaning Services', amount: 5400, category: 'cleaning', invoiceDate: '2024-01-15' };

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

  // Real extraction pipeline hits /api/claude for both lease text and invoice
  // image parsing, and /api/upload for cloud-backup of the invoice file.
  await page.route('**/api/claude', route => {
    const postData = route.request().postData() || '';
    // Both lease and invoice calls send a "document" content block (text-based
    // extraction for .txt leases, base64 PDF for invoices), so route by the
    // distinguishing prompt text instead of content-block type.
    const isInvoiceCall = postData.includes('commercial real estate invoice');
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify(isInvoiceCall ? MOCK_INVOICE : MOCK_TENANT),
    });
  });
  await page.route('**/api/upload', route => {
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ url: 'https://mock-storage.local/invoices/harbor-cleaning.pdf' }) });
  });

  try {
    // ── STEP 1: Sign up / login ──────────────────────────────────────────────
    section('STEP 1: Login');
    await page.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'networkidle', timeout: 30000 });

    const loginVisible = await page.$eval('#loginScreen', el => el.style.display !== 'none').catch(() => false);
    assert(loginVisible, 'STEP 1: login screen visible before sign-in');

    await page.fill('#loginEmail', 'acq-conversion@e2e-test.local');
    await page.fill('#loginPassword', 'AcqConversion123!');
    await page.click('#loginBtn');

    await page.waitForFunction(() => {
      const app = document.getElementById('appContent');
      return app && app.style.display !== 'none' && app.style.display !== '';
    }, { timeout: 10000 }).catch(() => {});

    const appVisible = await page.$eval('#appContent', el => el.style.display !== 'none' && el.style.display !== '').catch(() => false);
    assert(appVisible, 'STEP 1: app content visible after sign-in');

    // Dismiss the onboarding welcome modal if present — it can intercept clicks.
    await page.evaluate(() => {
      const m = document.getElementById('obWelcomeModal');
      if (m && m.style.display !== 'none') { if (typeof obCloseWelcome === 'function') obCloseWelcome('skip'); else m.style.display = 'none'; }
    });

    // ── STEP 2: Create a new acquisition review ─────────────────────────────
    section('STEP 2: Create acquisition review');
    await page.evaluate(() => { window.prompt = () => 'Harborview Plaza Acquisition'; });
    await page.click('.acq-new-btn');
    await page.waitForFunction(() => {
      const p = document.getElementById('acqDetailPanel');
      return p && p.style.display !== 'none';
    }, { timeout: 5000 });

    const titleText = await page.$eval('#acqDetailTitle', el => el.textContent).catch(() => '');
    assert(titleText.includes('Harborview Plaza'), 'STEP 2: detail panel opened for new review', titleText);

    // ── STEP 3: Upload leases (real extraction pipeline) ────────────────────
    section('STEP 3: Upload leases');
    await page.setInputFiles('#acqLeaseInput', {
      name: 'harborview-lease.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from(LEASE_TEXT, 'utf-8'),
    });

    await page.waitForFunction(() => {
      const el = document.getElementById('acqLeaseList');
      return el && el.innerText.includes('Harborview Outfitters');
    }, { timeout: 20000 }).catch(() => {});

    const leaseListText = await page.$eval('#acqLeaseList', el => el.innerText).catch(() => '');
    assert(leaseListText.includes('Harborview Outfitters'), 'STEP 3: lease extracted via real pipeline and listed', leaseListText.slice(0, 150));

    // ── STEP 4: Upload invoices (real extraction pipeline) ──────────────────
    section('STEP 4: Upload invoices');
    await page.setInputFiles('#acqInvoiceInput', {
      name: 'harbor-cleaning-invoice.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4 mock invoice content'),
    });

    await page.waitForFunction(() => {
      const el = document.getElementById('acqInvoiceList');
      return el && el.innerText.includes('Harbor Cleaning Services');
    }, { timeout: 20000 }).catch(() => {});

    const invoiceListText = await page.$eval('#acqInvoiceList', el => el.innerText).catch(() => '');
    assert(invoiceListText.includes('Harbor Cleaning Services'), 'STEP 4: invoice extracted via real pipeline and listed', invoiceListText.slice(0, 150));

    // ── STEP 5: Complete review (run analysis) ───────────────────────────────
    section('STEP 5: Complete review');
    await page.fill('#acqTotalSqft', '12000');
    await page.waitForTimeout(200);

    const analyzeEnabled = await page.$eval('#acqAnalyzeBtn', el => !el.disabled).catch(() => false);
    assert(analyzeEnabled, 'STEP 5: analyze button enabled after leases + invoices + sqft entered');

    await page.click('#acqAnalyzeBtn');
    await page.waitForFunction(() => {
      const c = document.getElementById('acqReportContainer');
      return c && c.innerHTML.length > 100;
    }, { timeout: 8000 }).catch(() => {});

    const badgeAfterAnalysis = await page.$eval('#acqDetailBadge', el => el.textContent).catch(() => '');
    assert(badgeAfterAnalysis === 'complete', 'STEP 5: review badge updated to "complete"', badgeAfterAnalysis);

    // ── STEP 6: Convert to property ───────────────────────────────────────────
    section('STEP 6: Convert to property');
    const convertBtn = await page.$('.acq-convert-btn');
    assert(!!convertBtn, 'STEP 6: "Acquire Property" button rendered after review is complete');
    if (convertBtn) await convertBtn.click();

    await page.waitForFunction(() => {
      const m = document.getElementById('acqConvertModal');
      return m && m.style.display !== 'none';
    }, { timeout: 5000 }).catch(() => {});

    await page.click('#acqConvertConfirmBtn');

    await page.waitForFunction(() => {
      const badge = document.getElementById('acqDetailBadge');
      return badge && badge.textContent === 'converted';
    }, { timeout: 10000 }).catch(() => {});

    const badgeAfterConvert = await page.$eval('#acqDetailBadge', el => el.textContent).catch(() => '');
    assert(badgeAfterConvert === 'converted', 'STEP 6: review badge updated to "converted"', badgeAfterConvert);

    const convertedPropsCount = await page.evaluate(() => (typeof _props !== 'undefined' ? _props.length : -1));
    assert(convertedPropsCount === 1, 'STEP 6: a new managed property was created from the review', '_props.length=' + convertedPropsCount);

    const newPropName = await page.evaluate(() => (typeof _props !== 'undefined' && _props[0] ? _props[0].name : ''));
    assert(newPropName.includes('Harborview'), 'STEP 6: new property carries the review name', newPropName);

    const newPropTenants = await page.evaluate(() => (typeof _props !== 'undefined' && _props[0] ? (_props[0].tenants || []).map(t => t.tenant_name) : []));
    assert(newPropTenants.some(n => (n || '').includes('Harborview Outfitters')), 'STEP 6: new property carries the review\'s tenant', JSON.stringify(newPropTenants));

    // Back in the portfolio, the converted property should now be open-able.
    await page.evaluate(() => { closeAcquisitionDetail(); });
    await page.waitForTimeout(300);
    const propCard = await page.$('.ptf-prop-card:not(.ptf-demo-card)');
    assert(!!propCard, 'STEP 6: converted property appears on the portfolio dashboard');

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
    console.log('\x1b[32m✅ Acquisition review → conversion workflow E2E verification complete\x1b[0m');
    process.exit(0);
  } else {
    console.log('\x1b[31mResults: ' + failures + ' assertion(s) failed\x1b[0m');
    process.exit(1);
  }
})();
