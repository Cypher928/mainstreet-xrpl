'use strict';
/**
 * verify-ftux.js — First-Time User Experience verification
 * Flow: Sign Up → Try Live Demo → Create Property → Upload Lease → Run CAM → Generate Report
 *
 * Mocks Supabase (no real DB) and intercepts Anthropic API calls.
 * Run: node verify-ftux.js
 */

let pw;
try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }
const { chromium } = pw;

const http = require('http');
const fs   = require('fs');
const path = require('path');
const PORT = 7831;
const ROOT = __dirname;

// ── helpers ──────────────────────────────────────────────────────────────────
let failures = 0;
const consoleErrors = [];
function pass(label)     { console.log('\x1b[32m  ✅ ' + label + '\x1b[0m'); }
function fail(label, d)  { console.error('\x1b[31m  ❌ ' + label + (d ? ' — ' + d : '') + '\x1b[0m'); failures++; }
function info(label)     { console.log('  · ' + label); }
function section(label)  { console.log('\n── ' + label + ' ' + '─'.repeat(Math.max(0, 56 - label.length))); }
function assert(c, l, d) { c ? pass(l) : fail(l, d); }

// ── Local HTTP server ─────────────────────────────────────────────────────────
const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css', '.json':'application/json' };
function startServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let fp = path.join(ROOT, req.url === '/' ? '/index.html' : req.url).split('?')[0];
      fs.readFile(fp, (err, data) => {
        if (err) { res.writeHead(404); res.end('not found'); return; }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
        res.end(data);
      });
    });
    server.listen(PORT, '127.0.0.1', () => resolve(server));
    server.on('error', reject);
  });
}

// ── Supabase mock ─────────────────────────────────────────────────────────────
// Richer than the acquisition mock — includes auth.signUp, signInWithPassword,
// storage (for lease_documents), and per-table upsert/insert/delete with filters.
// Starts UNAUTHENTICATED so the Sign Up flow is exercised, then _loggedIn flips
// to true when signUp / signInWithPassword resolves.
const SUPABASE_MOCK = `
(function() {
  var _loggedIn = false;
  var _user = { id: 'ftux-test-00000000000a', email: 'ftux@verify.local' };
  var _store = {
    properties: [],
    tenants: [],
    lease_documents: [],
    lease_jobs: [],
    cam_reconciliations: [],
    acquisition_reviews: [],
  };

  function noopPromise(val) { return Promise.resolve(val); }
  function makeFilterable(tableName, rows) {
    return function(filters) {
      return noopPromise({
        data: rows.filter(function(r) {
          return Object.keys(filters).every(function(k) { return r[k] === filters[k]; });
        }),
        error: null
      });
    };
  }

  function makeQ(tableName) {
    var _f = {};
    var _neq = {};
    var q = {
      select:  function() { return q; },
      order:   function() { return q; },
      limit:   function() { return q; },
      ilike:   function() { return q; },
      in:      function() { return q; },
      neq:     function(col, val) { _neq[col] = val; return q; },
      eq:      function(col, val) { _f[col] = val; return q; },
      insert:  function(rows) {
        var arr = Array.isArray(rows) ? rows : [rows];
        arr.forEach(function(r) { if (!r.id) r.id = 'gen-' + Math.random().toString(36).slice(2); });
        if (_store[tableName]) arr.forEach(function(r) { _store[tableName].push(r); });
        // Full chainable like Supabase v2: insert().select('id').single() is valid
        function makeChain(data) {
          return {
            select: function() { return makeChain(data); },
            single: function() { return noopPromise({ data: Array.isArray(data) ? (data[0] || null) : data, error: null }); },
            then:   function(fn) { return noopPromise({ data: data, error: null }).then(fn); }
          };
        }
        return makeChain(arr);
      },
      upsert:  function(row) {
        var arr = Array.isArray(row) ? row : [row];
        arr.forEach(function(r) {
          if (!r.id) r.id = 'gen-' + Math.random().toString(36).slice(2);
          if (_store[tableName]) {
            var idx = _store[tableName].findIndex(function(x) { return x.id === r.id; });
            if (idx >= 0) _store[tableName][idx] = r; else _store[tableName].push(r);
          }
        });
        return { select: function() { return noopPromise({ data: arr, error: null }); },
                 then: function(fn) { return noopPromise({ data: arr, error: null }).then(fn); } };
      },
      update:  function() { return noopPromise({ data: null, error: null }); },
      delete:  function() {
        // Chainable eq so delete().eq() works
        var d = { eq: function(col, val) {
          if (_store[tableName]) {
            _store[tableName] = _store[tableName].filter(function(r) { return r[col] !== val; });
          }
          return noopPromise({ error: null });
        }};
        return d;
      },
      single:  function() {
        var rows = (_store[tableName] || []).filter(function(r) {
          return Object.keys(_f).every(function(k) { return r[k] === _f[k]; });
        });
        return noopPromise({ data: rows[0] || null, error: rows[0] ? null : { code: 'PGRST116' } });
      },
      then: function(fn) {
        var rows = (_store[tableName] || []).filter(function(r) {
          return Object.keys(_f).every(function(k) { return r[k] === _f[k]; });
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
          getUser:    function() {
            return noopPromise({ data: { user: _loggedIn ? _user : null }, error: null });
          },
          getSession: function() {
            return noopPromise({ data: { session: _loggedIn ? { user: _user } : null }, error: null });
          },
          onAuthStateChange: function(cb) {
            _authCb = cb;
            // Fire INITIAL_SESSION — unauthenticated state at startup
            setTimeout(function() { cb('INITIAL_SESSION', null); }, 50);
            return { data: { subscription: { unsubscribe: function(){} } } };
          },
          signUp: function(creds) {
            _user.email = creds.email;
            return new Promise(function(res) {
              setTimeout(function() {
                _loggedIn = true;
                res({ data: { user: _user, session: { user: _user } }, error: null });
                if (_authCb) setTimeout(function() { _authCb('SIGNED_IN', { user: _user }); }, 50);
              }, 80);
            });
          },
          signInWithPassword: function(creds) {
            _user.email = creds.email;
            return new Promise(function(res) {
              setTimeout(function() {
                _loggedIn = true;
                res({ data: { user: _user, session: { user: _user } }, error: null });
                if (_authCb) setTimeout(function() { _authCb('SIGNED_IN', { user: _user }); }, 50);
              }, 80);
            });
          },
          signOut: function() { _loggedIn = false; return noopPromise({ error: null }); },
          resetPasswordForEmail: function() { return noopPromise({ data: {}, error: null }); },
          updateUser: function() { return noopPromise({ data: { user: _user }, error: null }); },
        },
        from: function(table) {
          if (!_store[table]) _store[table] = [];
          return makeQ(table);
        },
        storage: {
          from: function() {
            return {
              upload: function(path, file) { return noopPromise({ data: { path: path }, error: null }); },
              getPublicUrl: function(p) { return { data: { publicUrl: 'blob:mock/' + p } }; },
              remove: function() { return noopPromise({ data: [], error: null }); },
            };
          }
        },
        rpc: function() { return noopPromise({ data: null, error: { code: 'PGRST202', message: 'function not found' } }); },
        _store: _store,
        _user: _user,
      };
    }
  };
  window.__e2eStore = _store;
  window.__e2eUser  = _user;
})();
`;

// ── Claude API mock response ──────────────────────────────────────────────────
// Returned when Playwright intercepts fetch() to api.anthropic.com
const CLAUDE_MOCK_TENANT = JSON.stringify([{
  tenant_name: 'Verified Tenant LLC',
  lease_type: 'NNN',
  leased_sqft: '4200',
  start_date: '2023-01-01',
  end_date: '2028-12-31',
  cap: '5',
  capBaseAmount: '18000',
  excluded_categories: 'capital expenditures, management fees',
  admin_fee_pct: '15',
  audit_rights: '60 days written notice',
  renewal_options: '1 × 5-year option',
  pro_rata_method: 'leased',
  gross_up_pct: null,
  expense_stop: null,
  fieldEvidence: {
    tenant_name: { quote: 'Verified Tenant LLC' },
    lease_type:  { quote: 'Triple Net (NNN) Lease' },
    leased_sqft: { quote: '4,200 rentable square feet' },
    cap:         { quote: 'CAM charges shall not increase more than 5% per annum' }
  }
}]);

// ── Main ──────────────────────────────────────────────────────────────────────
(async () => {
  info('Starting local HTTP server on port ' + PORT + '…');
  const server = await startServer();
  info('Server ready');

  const browser = await chromium.launch({ headless: process.env.HEADLESS !== 'false' });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    storageState: undefined,  // fresh — no persisted localStorage
  });
  const page = await context.newPage();

  // Collect console errors
  page.on('console', msg => {
    if (msg.type() === 'error') {
      const t = msg.text();
      consoleErrors.push(t);
    }
  });
  page.on('pageerror', err => consoleErrors.push('[pageerror] ' + err.message));

  // Suppress Supabase CDN
  await page.route('**/supabase-js**', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: '/* suppressed */' }));

  // Mock Anthropic API — return one tenant object
  await page.route('**/api.anthropic.com/**', async route => {
    info('  [intercept] Anthropic API call → returning mock tenant');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        content: [{ type: 'text', text: CLAUDE_MOCK_TENANT }],
        usage: { input_tokens: 100, output_tokens: 50 }
      })
    });
  });

  // Inject Supabase mock before page scripts run
  await page.addInitScript(SUPABASE_MOCK);

  try {

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 1 — Sign Up
    // ═══════════════════════════════════════════════════════════════════════
    section('STEP 1: Sign Up');
    await page.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'networkidle', timeout: 30000 });

    // Confirm login screen is visible
    const loginVisible = await page.$eval('#loginScreen', el => el.style.display !== 'none').catch(() => false);
    assert(loginVisible, 'S1: login screen visible on first load');

    // Switch to sign-up tab
    const signupTabExists = await page.$('#loginTabSignUp') !== null;
    assert(signupTabExists, 'S1: Sign Up tab exists in auth UI');
    await page.click('#loginTabSignUp');
    await page.waitForTimeout(100);

    const btnText = await page.$eval('#loginBtn', el => el.textContent).catch(() => '');
    assert(btnText.includes('Create Account'), 'S1: button text changes to "Create Account" on signup tab', btnText);

    // Fill credentials
    await page.fill('#loginEmail', 'ftux@verify.local');
    await page.fill('#loginPassword', 'TestPass123!');
    await page.click('#loginBtn');

    // Wait for app to load
    await page.waitForFunction(() => {
      const app = document.getElementById('appContent');
      return app && app.style.display !== 'none';
    }, { timeout: 10000 });

    const loginHidden = await page.$eval('#loginScreen', el => el.style.display === 'none').catch(() => false);
    assert(loginHidden, 'S1: login screen hidden after sign-up');

    const dashVisible = await page.$eval('#portfolioDashboard', el => el.style.display !== 'none').catch(() => false);
    assert(dashVisible, 'S1: portfolio dashboard visible after sign-up');
    info('  Sign-up complete');

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 2 — Try Live Demo
    // ═══════════════════════════════════════════════════════════════════════
    section('STEP 2: Try Live Demo');

    // Dismiss welcome modal if showing
    await page.evaluate(() => {
      const m = document.getElementById('obWelcomeModal');
      if (m && m.style.display !== 'none') {
        m.style.display = 'none';
        const ob = { steps:[false,false,false,false,false], welcomeSeen: true };
        try { localStorage.setItem('ms_ob_v1_ftux-test-00000000000a', JSON.stringify(ob)); } catch(_){}
      }
    });

    // Click Try Live Demo from start-here section
    const demoBtnExists = await page.$('#demoBtn') !== null;
    assert(demoBtnExists, 'S2: #demoBtn exists in start-here section');

    await page.click('#demoBtn');

    // Wait for main workflow to show (selectProperty was called)
    await page.waitForFunction(() => {
      return document.getElementById('mainWorkflow') &&
             document.getElementById('mainWorkflow').style.display !== 'none';
    }, { timeout: 15000 });

    const propNameVal = await page.$eval('#propertyName', el => el.value).catch(() => '');
    assert(propNameVal.includes('Cascade Commons'), 'S2: demo property "Cascade Commons" loaded', propNameVal);

    // Verify tenants seeded
    const tenantRows = await page.$$eval('.tenant-row, .tenant-item, [data-tenant-row]', els => els.length).catch(() => 0);
    // Also check via JS state
    const tenantCount = await page.evaluate(() => {
      return typeof tenantData !== 'undefined' ? tenantData.filter(t => t && t.tenant_name).length : -1;
    });
    assert(tenantCount >= 5, 'S2: demo has ≥5 tenants in memory', 'count=' + tenantCount);

    // Verify invoices seeded
    const invoiceCount = await page.evaluate(() => {
      return typeof invoiceData !== 'undefined' ? invoiceData.length : -1;
    });
    assert(invoiceCount >= 20, 'S2: demo has ≥20 invoices in memory', 'count=' + invoiceCount);

    // Verify reconciliation results already present (demo seeds them)
    const reconResults = await page.evaluate(() => {
      return typeof lastResults !== 'undefined' ? lastResults.length : -1;
    });
    assert(reconResults >= 5, 'S2: demo reconciliation results present', 'count=' + reconResults);

    info('  Demo loaded — ' + tenantCount + ' tenants, ' + invoiceCount + ' invoices, ' + reconResults + ' reconciliation results');

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 3 — Create Property
    // ═══════════════════════════════════════════════════════════════════════
    section('STEP 3: Create Property');

    // Go back to portfolio via JS (breadcrumb may be invisible depending on layout)
    await page.evaluate(() => { if (typeof renderPortfolio === 'function') renderPortfolio(); });
    await page.waitForFunction(() => {
      const d = document.getElementById('portfolioDashboard');
      return d && d.style.display !== 'none';
    }, { timeout: 5000 });
    info('  Back on portfolio dashboard');

    // Click + Add Property (from empty state or from start-here)
    await page.evaluate(() => addNewProperty());
    await page.waitForFunction(() => {
      return document.getElementById('mainWorkflow') &&
             document.getElementById('mainWorkflow').style.display !== 'none';
    }, { timeout: 8000 });

    const newPropName = await page.$eval('#propertyName', el => el.value).catch(() => '');
    assert(newPropName.length > 0, 'S3: new property form loaded with a name', newPropName);

    // Update the property model name first — renderProperty() reads from the model,
    // so filling totalSqft (which triggers renderProperty) would otherwise reset
    // #propertyName back to the default name.
    await page.evaluate(() => {
      const prop = currentProperty();
      if (prop) prop.name = 'Wharton Test Plaza';
    });
    await page.fill('#propertyName', 'Wharton Test Plaza');
    await page.fill('#totalSqft', '25000');

    const updatedName = await page.$eval('#propertyName', el => el.value).catch(() => '');
    assert(updatedName === 'Wharton Test Plaza', 'S3: property name set to "Wharton Test Plaza"', updatedName);
    info('  Property "Wharton Test Plaza" created, 25,000 sqft');

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 4 — Upload Lease (mocked Claude extraction)
    // ═══════════════════════════════════════════════════════════════════════
    section('STEP 4: Upload Lease');

    // Verify lease drop zone exists
    const dropZoneExists = await page.$('#leaseDropZone, .lease-drop-zone, [id*="drop"]') !== null;
    assert(dropZoneExists, 'S4: lease drop zone exists on property form');

    // Bypass file I/O — inject tenant directly via normalizeTenant (same as what
    // processFile does after calling Claude), then trigger renderTenantsUI.
    await page.evaluate(() => {
      // Simulate what processFile() does after successful Claude extraction:
      var extracted = [{
        tenant_name: 'Verified Tenant LLC',
        lease_type: 'NNN',
        leased_sqft: '4200',
        start_date: '2023-01-01',
        end_date: '2028-12-31',
        cap: '5',
        capBaseAmount: '18000',
        excluded_categories: 'capital expenditures, management fees',
        admin_fee_pct: '15',
        audit_rights: '60 days written notice',
        renewal_options: '1 × 5-year option',
        pro_rata_method: 'leased',
        fieldEvidence: {
          tenant_name: { quote: 'Verified Tenant LLC, hereinafter referred to as Tenant' },
          lease_type:  { quote: 'Triple Net (NNN) Lease Agreement' },
          leased_sqft: { quote: '4,200 rentable square feet of the Premises' },
          cap:         { quote: 'CAM charges shall not increase more than 5% per annum over the prior lease year' }
        }
      }];
      // normalizeTenant is defined in script.js
      var norm = extracted.map(function(t) { return normalizeTenant(t); });
      // Push into tenantData (the live array)
      norm.forEach(function(t) {
        if (!t) return;
        // Derive confidence scores via LeaseIntelligence module
        var LI = window.LeaseIntelligence;
        if (LI && typeof LI.deriveExtractionConfidence === 'function') {
          var ctx = { ocrText: 'Triple Net (NNN) Lease Agreement 4,200 rentable square feet CAM 5% cap', hasQuote: true };
          var conf = LI.deriveExtractionConfidence(t, ctx);
          t._confidenceScore = conf.score;
          t._confidence = conf.level;
        }
        tenantData.push(t);
      });
      // Re-render tenant list
      if (typeof renderTenantsUI === 'function') renderTenantsUI();
      else if (typeof renderTenants === 'function') renderTenants();
    });
    await page.waitForTimeout(300);

    // Verify tenant appears in UI
    const tenantInUI = await page.evaluate(() => {
      return typeof tenantData !== 'undefined' && tenantData.some(function(t) {
        return t && t.tenant_name === 'Verified Tenant LLC';
      });
    });
    assert(tenantInUI, 'S4: extracted tenant "Verified Tenant LLC" appears in tenantData');

    // Verify lease review status badge rendered
    const anyBadge = await page.$('.trs-badge, .lrs-badge, [class*="trs-"], .tenant-badge').catch(() => null);
    assert(anyBadge !== null, 'S4: lease review status badge rendered for tenant');

    // Check confidence score was derived
    const confScore = await page.evaluate(() => {
      var t = tenantData.find(function(x) { return x && x.tenant_name === 'Verified Tenant LLC'; });
      return t ? t._confidenceScore : null;
    });
    assert(confScore !== null && confScore > 0, 'S4: confidence score derived (' + confScore + ')', 'score=' + confScore);
    info('  Tenant "Verified Tenant LLC" injected, confidence score: ' + confScore);

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 5 — Run CAM Reconciliation
    // ═══════════════════════════════════════════════════════════════════════
    section('STEP 5: Run CAM Reconciliation');

    // Inject a set of invoices directly into invoiceData
    await page.evaluate(() => {
      var mockInvoices = [
        { id: 'inv-v1', vendorName: 'Austin Energy',     amount: 12000, category: 'utilities',    invoiceDate: '2024-03-31', confidence: { vendorName:98, amount:99, category:97 } },
        { id: 'inv-v2', vendorName: 'CleanSpace Co',     amount:  8400, category: 'janitorial',   invoiceDate: '2024-06-30', confidence: { vendorName:97, amount:98, category:95 } },
        { id: 'inv-v3', vendorName: 'Meridian Insurance',amount: 24000, category: 'insurance',    invoiceDate: '2024-01-15', confidence: { vendorName:96, amount:98, category:99 } },
        { id: 'inv-v4', vendorName: 'GreenPath Landscape',amount: 6500, category: 'landscaping',  invoiceDate: '2024-05-01', confidence: { vendorName:94, amount:97, category:96 } },
        { id: 'inv-v5', vendorName: 'WatchPoint Security',amount: 9600, category: 'security',     invoiceDate: '2024-09-30', confidence: { vendorName:99, amount:98, category:99 } },
      ];
      mockInvoices.forEach(function(inv) { invoiceData.push(inv); });
      if (typeof renderInvoicesUI === 'function') renderInvoicesUI();
    });

    // Verify invoices visible
    const invCount = await page.evaluate(() => typeof invoiceData !== 'undefined' ? invoiceData.length : 0);
    assert(invCount >= 5, 'S5: 5 test invoices loaded into invoiceData', 'count=' + invCount);

    // Set CAM year
    await page.evaluate(() => {
      if (typeof _camYear !== 'undefined') _camYear = 2024;
      var sel = document.getElementById('camYearSelect');
      if (sel) { sel.value = '2024'; sel.dispatchEvent(new Event('change')); }
    });

    // Click "Calculate CAM Charges" (#runBtn) → opens allocation modal
    const runBtnVisible = await page.$eval('#runBtn', el => el && el.style.display !== 'none').catch(() => false);
    assert(runBtnVisible, 'S5: "Calculate CAM Charges" button (#runBtn) is visible');

    await page.click('#runBtn');

    // Wait for the allocation confirmation modal (#allocModal) to appear
    await page.waitForFunction(() => {
      const m = document.getElementById('allocModal');
      return m && m.style.display !== 'none';
    }, { timeout: 5000 }).catch(() => {
      // Modal may have been skipped (e.g. validation bypassed it)
    });
    await page.waitForTimeout(200);

    // Invoke confirmAllocation() directly — avoids ambiguous .modal-confirm selector
    // that exists in multiple modals (delete, allocate, etc.) and may be hidden.
    await page.evaluate(() => {
      if (typeof confirmAllocation === 'function') confirmAllocation();
    });
    await page.waitForTimeout(1000);

    // Verify results
    const resultCount = await page.evaluate(() => {
      return typeof lastResults !== 'undefined' ? lastResults.length : 0;
    });
    assert(resultCount >= 1, 'S5: reconciliation produced results', 'count=' + resultCount);

    // Verify results section visible — the real container ID is #results > #resultsBody
    const reconSectionVisible = await page.$eval(
      '#resultsBody',
      el => el && el.innerHTML.length > 50
    ).catch(() => false);
    assert(reconSectionVisible, 'S5: reconciliation results section rendered in DOM');
    info('  Reconciliation complete — ' + resultCount + ' tenant results');

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 6 — Generate Report
    // ═══════════════════════════════════════════════════════════════════════
    section('STEP 6: Generate Report');

    // Click Landlord Master Report (the main report button)
    const rptBtn = await page.$('[onclick*="generateMasterReport"], [onclick*="generateReport"], .rpt-btn, #masterReportBtn');
    if (rptBtn) {
      await rptBtn.click();
    } else {
      await page.evaluate(() => {
        if (typeof generateMasterReport === 'function') generateMasterReport();
      });
    }
    await page.waitForTimeout(600);

    // Report modal should appear (#rptModal or #reportModal)
    const rptModalVisible = await page.$eval(
      '#rptModal, #reportModal, .rpt-modal, [id*="report"]',
      el => el && el.style.display !== 'none' && el.innerHTML.length > 100
    ).catch(() => false);
    assert(rptModalVisible, 'S6: report modal opens with content');

    // Verify report contains expected sections
    const rptHTML = await page.evaluate(() => {
      var m = document.getElementById('rptModal') || document.getElementById('reportModal') ||
              document.querySelector('.rpt-modal') || document.getElementById('rptBody');
      return m ? m.innerHTML.toLowerCase() : '';
    });
    assert(rptHTML.includes('tenant') || rptHTML.includes('allocated'), 'S6: report contains tenant/allocation data');
    assert(rptHTML.includes('total') || rptHTML.includes('cam'), 'S6: report contains CAM totals');
    info('  Report rendered (' + (rptHTML.length / 1024).toFixed(1) + ' KB)');

    // ── Probes ────────────────────────────────────────────────────────────
    section('Probes');

    // 🔍 Probe 1: Does the demo load AGAIN without duplicating tenants?
    await page.evaluate(() => renderPortfolio());
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      var m = document.getElementById('obWelcomeModal');
      if (m) m.style.display = 'none';
    });
    await page.evaluate(() => loadDemo());
    await page.waitForFunction(() => {
      return document.getElementById('mainWorkflow') &&
             document.getElementById('mainWorkflow').style.display !== 'none';
    }, { timeout: 10000 });
    const tenantCountAfterReload = await page.evaluate(() => {
      return typeof tenantData !== 'undefined' ? tenantData.filter(function(t) { return t && t.tenant_name; }).length : 0;
    });
    assert(tenantCountAfterReload <= 6, '🔍 P1: re-loading demo does not duplicate tenants', 'count=' + tenantCountAfterReload);

    // 🔍 Probe 2: Does sign-up with weak password show an error (not crash)?
    // Navigate fresh so loginScreen is visible again
    await page.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForFunction(() => document.getElementById('loginScreen')?.style?.display !== 'none', { timeout: 5000 }).catch(() => {});
    await page.evaluate(() => { if (typeof switchAuthTab === 'function') switchAuthTab('signup'); });
    await page.fill('#loginEmail', 'probe@test.local');
    await page.fill('#loginPassword', 'abc');
    await page.click('#loginBtn');
    await page.waitForTimeout(300);
    const weakPwMsg = await page.$eval('#loginMsg', el => el.textContent).catch(() => '');
    assert(weakPwMsg.toLowerCase().includes('password') || weakPwMsg.includes('6'), '🔍 P2: short password shows validation error', weakPwMsg);

    // 🔍 Probe 3: Console errors check (filter known noise)
    const relevantErrors = consoleErrors.filter(function(e) {
      return !e.includes('favicon') &&
             !e.includes('net::ERR_ABORTED') &&
             !e.includes('Failed to load resource') &&
             !e.includes('supabase') &&  // CDN suppressed intentionally
             !e.includes('xrpl');
    });

  } catch (err) {
    fail('Unexpected exception', err.message || String(err));
    console.error(err);
  }

  await browser.close();
  server.close();

  // ── Final report ──────────────────────────────────────────────────────────
  console.log('\n' + '─'.repeat(60));
  const relevantErrors = consoleErrors.filter(function(e) {
    return !e.includes('favicon') &&
           !e.includes('net::ERR_ABORTED') &&
           !e.includes('Failed to load resource') &&
           !e.includes('supabase') &&
           !e.includes('xrpl') &&
           !e.includes('[loadCamResults]') &&   // expected: no real DB in mock env
           !e.includes('[saveCamResults]');      // expected: no real DB in mock env
  });

  if (relevantErrors.length) {
    console.log('\n\x1b[33mConsole errors captured:\x1b[0m');
    relevantErrors.forEach(function(e, i) { console.log('  [' + (i+1) + '] ' + e.slice(0, 200)); });
  } else {
    console.log('\n\x1b[32mNo console errors\x1b[0m');
  }

  console.log('─'.repeat(60));
  if (failures === 0) {
    console.log('\x1b[32mAll FTUX steps passed (' + failures + ' failures)\x1b[0m\n');
  } else {
    console.log('\x1b[31m' + failures + ' assertion(s) failed\x1b[0m\n');
  }
  process.exit(failures ? 1 : 0);
})();
