'use strict';
/**
 * test-e2e-property-mismatch.js — Cross-property contamination regression test.
 *
 * Bug report: a "Lakeview Plaza" lease was uploaded into the "Cascade Commons"
 * property and MainStreet accepted it without any warning. Verifies the
 * PROPERTY_NAME_MISMATCH edge case (lease-intelligence.js) fires on both the
 * bulk drag-drop upload path (handleBulkLeases → _runLeaseJobPipeline) and the
 * single-tenant-slot upload path (handleLease), and that the mismatch warning
 * reaches the user — via the always-visible review-status pill (bulk) and the
 * AI Review Notes block (both paths) — without requiring the row to be expanded.
 *
 * Also verifies a matching property name does NOT produce a false-positive
 * warning, so the fix is safe for the common case.
 *
 * Usage:
 *   node test-e2e-property-mismatch.js
 *
 * Optional env vars:
 *   HEADLESS=false   — open a visible browser
 *   APP_PORT=7841    — local HTTP server port
 */

let pw;
try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }
const { chromium } = pw;

const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const PORT     = parseInt(process.env.APP_PORT || '7841', 10);
const HEADLESS = process.env.HEADLESS !== 'false';
const ROOT     = __dirname;

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

const EXISTING_PROP_ID = 'cascade-commons-1';

const SUPABASE_MOCK = `
(function() {
  var USER_ID = 'e2e-mismatch-user';
  var _user = { id: USER_ID, email: 'mismatch-test@e2e-test.local' };
  var _session = null;

  var _store = {
    properties: [{
      id: '${EXISTING_PROP_ID}', user_id: USER_ID,
      name: 'Cascade Commons', sqft: 10000,
      data: {
        invoices: [], disputes: [], camYear: 2024, results: null, camReconciliation: null,
        activityLog: [], timeline: [], tenants: [], escrowReserves: [], drawRequests: [],
      },
    }],
    tenants: [],
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

// Mismatched lease: explicitly names "Lakeview Plaza" while uploaded into "Cascade Commons".
const MOCK_CLAUDE_MISMATCH = {
  tenant_name: 'Lakeview Dental Group',
  lease_start_date: '2024-06-01',
  lease_end_date: '2029-05-31',
  lease_type: 'NNN',
  sqft: 1800,
  cam_cap: 3,
  property_name: 'Lakeview Plaza',
  quotes: {},
};

const LEASE_TEXT_MISMATCH = `
LEASE AGREEMENT
This lease covers premises located at Lakeview Plaza.
Tenant: Lakeview Dental Group. Commencement Date: June 1, 2024. Expiration Date: May 31, 2029.
Tenant shall lease approximately 1,800 square feet. This is a Triple Net (NNN) lease.
CAM charges shall not increase more than 3% per annum.
`.repeat(4);

// Matching lease: property_name agrees with the current property — must NOT trigger a warning.
const MOCK_CLAUDE_MATCH = {
  tenant_name: 'Cascade Hardware Co',
  lease_start_date: '2024-01-01',
  lease_end_date: '2029-12-31',
  lease_type: 'NNN',
  sqft: 1200,
  cam_cap: 4,
  property_name: 'Cascade Commons',
  quotes: {},
};

const LEASE_TEXT_MATCH = `
LEASE AGREEMENT
This lease covers premises located at Cascade Commons.
Tenant: Cascade Hardware Co. Commencement Date: January 1, 2024. Expiration Date: December 31, 2029.
Tenant shall lease approximately 1,200 square feet. This is a Triple Net (NNN) lease.
CAM charges shall not increase more than 4% per annum.
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

  const consoleLogs = [];
  page.on('console', m => consoleLogs.push({ type: m.type(), text: m.text() }));
  page.on('pageerror', e => consoleLogs.push({ type: 'PAGEERROR', text: e.message }));

  await page.route('**/supabase-js**', route => route.fulfill({
    status: 200, contentType: 'application/javascript', body: '/* supabase CDN suppressed by e2e mock */'
  }));
  await page.addInitScript(SUPABASE_MOCK);

  await page.route('**/api/upload', route => {
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ url: 'https://mock-storage.local/leases/mock-lease.txt' }) });
  });

  try {
    section('STEP 1: Sign in and open Cascade Commons');
    await page.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'networkidle', timeout: 30000 });

    await page.fill('#loginEmail', 'mismatch-test@e2e-test.local');
    await page.fill('#loginPassword', 'TestPass123!');
    await page.click('#loginBtn');

    await page.waitForFunction(() => {
      const app = document.getElementById('appContent');
      return app && app.style.display !== 'none' && app.style.display !== '';
    }, { timeout: 10000 }).catch(() => {});

    await page.waitForSelector('.ptf-prop-card:not(.ptf-demo-card)', { timeout: 10000 });
    await page.evaluate((propId) => { if (typeof selectProperty === 'function') selectProperty(propId); }, EXISTING_PROP_ID);
    await page.waitForFunction(() => {
      const el = document.getElementById('propertyName');
      return el && el.value === 'Cascade Commons';
    }, { timeout: 10000 });
    assert(true, 'STEP 1: Cascade Commons workspace opened');

    section('STEP 2: Bulk upload a Lakeview Plaza lease into Cascade Commons');
    await page.evaluate(() => { if (typeof switchWorkspaceTab === 'function') switchWorkspaceTab('documents'); });

    await page.route('**/api/claude', route => {
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_CLAUDE_MISMATCH) });
    });

    await page.setInputFiles('#bulkLeaseInput', {
      name: 'lakeview-plaza-lease.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from(LEASE_TEXT_MISMATCH, 'utf-8'),
    });

    await page.waitForFunction(() => document.getElementById('bulkResults').innerText.includes('Lakeview Dental'), { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(800);

    const bulkResultsHtml = await page.$eval('#bulkResults', el => el.innerHTML).catch(() => '');
    assert(bulkResultsHtml.includes('Lakeview Dental'), 'STEP 2: mismatched-property lease extracted and added', bulkResultsHtml.length + ' chars');
    assert(/Needs Review|needs-review|lrs-needs-review/.test(bulkResultsHtml),
      'STEP 2: bulk row shows a "Needs Review" status WITHOUT expanding the row');
    assert(bulkResultsHtml.includes('Confirm this lease belongs to the current property') || bulkResultsHtml.includes('different property'),
      'STEP 2: property-mismatch warning text is present in the rendered row');

    section('STEP 3: 🔍 Probe — matching property name does NOT trigger a false-positive');
    await page.unroute('**/api/claude');
    await page.route('**/api/claude', route => {
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_CLAUDE_MATCH) });
    });

    await page.setInputFiles('#bulkLeaseInput', {
      name: 'cascade-hardware-lease.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from(LEASE_TEXT_MATCH, 'utf-8'),
    });

    await page.waitForFunction(() => document.getElementById('bulkResults').innerText.includes('Cascade Hardware'), { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(800);

    const bulkResultsAfterMatch = await page.$eval('#bulkResults', el => el.innerHTML).catch(() => '');
    assert(bulkResultsAfterMatch.includes('Cascade Hardware'), 'STEP 3: matching-property lease extracted and added');
    // The mismatch warning text must not appear anywhere AFTER the new Cascade Hardware row
    // begins — isolates this assertion to the new row, since the earlier Lakeview row legitimately has it.
    const afterNewRow = bulkResultsAfterMatch.split('Cascade Hardware').pop();
    assert(!/different property/.test(afterNewRow),
      'STEP 3: 🔍 matching property name produces NO mismatch warning on the new row', afterNewRow.slice(0, 200));

    section('STEP 4: Single-tenant-slot upload path also catches the mismatch');
    await page.evaluate(() => { if (typeof switchLeaseTab === 'function') switchLeaseTab('single'); });
    await page.waitForSelector('#tb-0', { timeout: 5000 });

    await page.unroute('**/api/claude');
    await page.route('**/api/claude', route => {
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_CLAUDE_MISMATCH) });
    });

    await page.setInputFiles('#tb-0 input[type="file"]', {
      name: 'lakeview-plaza-lease-single.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from(LEASE_TEXT_MISMATCH, 'utf-8'),
    });

    await page.waitForFunction(() => {
      const el = document.getElementById('tb-0');
      return el && el.innerText.includes('Lakeview Dental');
    }, { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(500);

    const singleSlotHtml = await page.$eval('#tb-0', el => el.innerHTML).catch(() => '');
    assert(singleSlotHtml.includes('Lakeview Dental'), 'STEP 4: single-slot upload extracted the mismatched lease', singleSlotHtml.length + ' chars');
    assert(singleSlotHtml.includes('AI Review Notes'), 'STEP 4: single-slot path now renders the AI Review Notes block (previously absent)');
    assert(singleSlotHtml.includes('Confirm this lease belongs to the current property') || singleSlotHtml.includes('different property'),
      'STEP 4: single-slot upload surfaces the property-mismatch warning');

    section('STEP 5: Mismatched tenant is excluded from CAM allocation and rollups');
    // At this point currentProperty().tenants holds: "Lakeview Dental Group" (mismatch,
    // from the bulk path), "Cascade Hardware Co" (matching, from the bulk path), and
    // whatever the single-slot upload in STEP 4 produced. Confirm the mismatch flag
    // actually reached the tenant object that feeds CAM math (not just the rendered HTML).
    const mismatchFlagOnTenant = await page.evaluate(() => {
      const t = (currentProperty()?.tenants || []).find(t => t?.tenant_name === 'Lakeview Dental Group');
      const types = (t?._edgeCases?.edgeCases || []).map(e => e.type);
      return types.includes('PROPERTY_NAME_MISMATCH');
    });
    assert(mismatchFlagOnTenant, 'STEP 5: Lakeview Dental Group tenant object carries PROPERTY_NAME_MISMATCH');

    const validTenantNames = await page.evaluate(() => getValidTenants().map(t => t.tenant_name));
    assert(!validTenantNames.includes('Lakeview Dental Group'), 'STEP 5: getValidTenants() excludes the mismatched tenant', JSON.stringify(validTenantNames));
    assert(validTenantNames.includes('Cascade Hardware Co'), 'STEP 5: getValidTenants() still includes the matching tenant', JSON.stringify(validTenantNames));

    // Run an actual CAM allocation and confirm the dollar/rollup output never mentions the
    // mismatched tenant — proving exclusion holds end-to-end, not just at the filter function.
    await page.evaluate(() => {
      invoiceData.push({
        vendorName: 'Evergreen Landscaping', amount: 9000, category: 'landscaping',
        invoiceDate: '2024-03-15', confidence: {}, _error: null,
      });
      const prop = currentProperty();
      if (prop) prop.invoices = Array.from(invoiceData);
    });

    const totalSqftVal = await page.$eval('#totalSqft', el => el.value).catch(() => '');
    if (!totalSqftVal || parseFloat(totalSqftVal) <= 0) await page.fill('#totalSqft', '10000');

    await page.evaluate(() => { if (typeof switchWorkspaceTab === 'function') switchWorkspaceTab('cam'); });
    await page.click('#runBtn');
    await page.waitForTimeout(400);
    const allocModalVisible = await page.$eval('#allocModal', el => el.style.display === 'flex').catch(() => false);
    if (allocModalVisible) await page.click('.modal-confirm');

    await page.waitForFunction(() => {
      const body = document.getElementById('resultsBody');
      return body && body.innerText.trim().length > 20;
    }, { timeout: 10000 }).catch(() => {});

    const camResultsText = await page.$eval('#resultsBody', el => el.innerText).catch(() => '');
    assert(camResultsText.includes('Cascade Hardware'), 'STEP 5: CAM ran and includes the matching tenant', camResultsText.slice(0, 150));
    assert(!camResultsText.includes('Lakeview Dental'), 'STEP 5: CAM results never mention the mismatched tenant', camResultsText.slice(0, 300));

    const resultsSection = await page.$eval('#results', el => el.innerHTML).catch(() => '');
    assert(/excluded from CAM/.test(resultsSection) && /different property/.test(resultsSection),
      'STEP 5: an "excluded from CAM — lease names a different property" banner is shown');

    const lastResultsNames = await page.evaluate(() =>
      (typeof lastResults !== 'undefined' ? lastResults.map(r => r.name) : []));
    assert(!lastResultsNames.includes('Lakeview Dental Group'), 'STEP 5: lastResults (the allocation/rollup source of truth) excludes the mismatched tenant', JSON.stringify(lastResultsNames));

    section('STEP 6: Console error check');
    const realErrors = consoleLogs.filter(l =>
      (l.type === 'error' || l.type === 'PAGEERROR') &&
      !l.text.includes('favicon') &&
      !l.text.includes('Failed to load resource') &&
      !l.text.includes('ERR_CERT_AUTHORITY_INVALID') &&
      !l.text.includes('[saveLeaseDocument]') &&
      !l.text.includes('[saveCamResults]')
    );
    assert(realErrors.length === 0, 'STEP 6: no console errors across the property-mismatch flow', JSON.stringify(realErrors.slice(0, 5)));

  } catch (e) {
    fail('UNCAUGHT', e.message);
    console.error(e.stack);
    console.error('--- console log dump ---');
    consoleLogs.slice(-40).forEach(l => console.error(l.type + ': ' + l.text));
  } finally {
    await browser.close();
    server.close();
  }

  console.log('\n' + '─'.repeat(64));
  if (failures === 0) {
    console.log('\x1b[32m✅ All Property-Mismatch checks passed\x1b[0m');
  } else {
    console.log('\x1b[31m❌ ' + failures + ' check(s) failed\x1b[0m');
  }
  console.log('─'.repeat(64));
  process.exit(failures === 0 ? 0 : 1);
})();
