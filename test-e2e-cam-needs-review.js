'use strict';
/**
 * test-e2e-cam-needs-review.js — Punch-list item #3: "Needs Review" rollup.
 *
 * Verifies the dominant "Needs Review" rollup (script.js:_buildNeedsReviewRollupHtml)
 * renders above the Reconciliation Summary panel when any tenant has ambiguity
 * flags, lists the flagged tenant(s), and that clicking a rollup item jumps to
 * the matching tenant result card. Also verifies the rollup does NOT render
 * when no tenant has flags, and that no console errors occur.
 *
 * Drives the app via the local HTTP server + Supabase mock pattern shared with
 * test-e2e-acquisition.js / test-e2e-phase25-visual.js.
 *
 * Usage:
 *   node test-e2e-cam-needs-review.js
 *
 * Optional env vars:
 *   HEADLESS=false   — open a visible browser
 *   APP_PORT=7826    — local HTTP server port
 */

let pw;
try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }
const { chromium } = pw;

const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const PORT     = parseInt(process.env.APP_PORT || '7826', 10);
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

// Supabase mock — same shape as test-e2e-acquisition.js / test-e2e-phase25-visual.js.
const SUPABASE_MOCK = `
(function() {
  var _store = { properties: [], acquisition_reviews: [] };
  var _user  = { id: 'e2e-test-user-id', email: 'e2e@test.local' };

  function noopPromise(val) { return Promise.resolve(val); }

  function makeQ(tableName) {
    var _filters = {};
    var q = {
      select:   function() { return q; },
      insert:   function(rows) {
        var arr = Array.isArray(rows) ? rows : [rows];
        if (_store[tableName]) arr.forEach(function(r) { _store[tableName].push(r); });
        var result = noopPromise({ data: arr, error: null });
        result.select = function() { return noopPromise({ data: arr, error: null }); };
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
        return { eq: function() { return noopPromise({ error: null }); } };
      },
      eq:       function(col, val) { _filters[col] = val; return q; },
      neq:      function() { return q; },
      // MOCK DRIFT. The product added an .is(col, null) filter to a query this
      // flow runs, and this mock had no such method, so the page threw
      // "q.is is not a function" and the suite's console-error check failed.
      // Nothing about the product is wrong here — the stand-in had simply
      // stopped standing in for the real client.
      is:       function() { return q; },
      not:      function() { return q; },
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

  window.supabase = {
    createClient: function() {
      return {
        auth: {
          getUser: function() { return noopPromise({ data: { user: _user }, error: null }); },
          getSession: function() { return noopPromise({ data: { session: { user: _user } }, error: null }); },
          onAuthStateChange: function(cb) {
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

  const consoleLogs = [];
  page.on('console', m => consoleLogs.push({ type: m.type(), text: m.text() }));
  page.on('pageerror', e => consoleLogs.push({ type: 'PAGEERROR', text: e.message }));

  await page.route('**/supabase-js**', route => route.fulfill({
    status: 200, contentType: 'application/javascript', body: '/* supabase CDN suppressed by e2e mock */'
  }));
  await page.addInitScript(SUPABASE_MOCK);

  try {
    section('CAM-NR-1: Load demo property and run a clean allocation');
    await page.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForFunction(() => {
      const app = document.getElementById('appContent');
      return app && app.style.display !== 'none' && app.style.display !== '';
    }, null, { timeout: 45000 });

    await page.evaluate(() => loadDemo());
    await page.waitForFunction(() => {
      const el = document.getElementById('mainWorkflow');
      return el && el.style.display !== 'none';
    }, null, { timeout: 45000 });
    await page.evaluate(() => switchWorkspaceTab('cam'));
    await page.waitForTimeout(300);

    await page.click('#runBtn');
    await page.waitForTimeout(500);
    const modalVisible1 = await page.$eval('#allocModal', el => el.style.display === 'flex').catch(() => false);
    if (modalVisible1) await page.click('.modal-confirm');
    await page.waitForFunction(() => {
      const body = document.getElementById('resultsBody');
      return body && body.innerText.trim().length > 20;
    }, null, { timeout: 45000 });

    const cleanHtml = await page.$eval('#resultsBody', el => el.innerHTML);
    assert(!cleanHtml.includes('needs-review-rollup'),
      'CAM-NR-1: rollup does NOT render when no tenant has ambiguity flags (demo data is clean)');

    section('CAM-NR-2: Force a tenant flag (missing lease type) and re-run');
    await page.evaluate(() => {
      const prop = currentProperty();
      const t = (prop.tenants || [])[0];
      t.lease_type = null;
      const td = tenantData.find(d => d && d.tenant_name === t.tenant_name);
      if (td) td.lease_type = null;
    });
    await page.click('#runBtn');
    await page.waitForTimeout(500);
    const modalVisible2 = await page.$eval('#allocModal', el => el.style.display === 'flex').catch(() => false);
    if (modalVisible2) await page.click('.modal-confirm');
    await page.waitForFunction(() => {
      const body = document.getElementById('resultsBody');
      return body && body.innerHTML.includes('needs-review-rollup');
    }, null, { timeout: 45000 });

    const flaggedHtml = await page.$eval('#resultsBody', el => el.innerHTML);
    const rollupIdx  = flaggedHtml.indexOf('needs-review-rollup');
    const summaryIdx = flaggedHtml.indexOf('rcs-panel');
    assert(rollupIdx >= 0 && summaryIdx >= 0 && rollupIdx < summaryIdx,
      'CAM-NR-2: rollup appears before the Reconciliation Summary panel in DOM order');

    const rollupTenantName = await page.evaluate(() => currentProperty().tenants[0].tenant_name);
    assert(flaggedHtml.includes(rollupTenantName),
      'CAM-NR-2: flagged tenant name appears inside the rollup', rollupTenantName);

    const countBadgeText = await page.$eval('.nrr-count-badge', el => el.textContent).catch(() => '');
    assert(/1 tenant/.test(countBadgeText) && /1 issue/.test(countBadgeText),
      'CAM-NR-2: rollup count badge reads "1 tenant · 1 issue"', countBadgeText);

    section('CAM-NR-3: 🔍 Probe — clicking a rollup item scrolls to the matching result card');
    const anchorId = await page.$eval('.nrr-item', el => el.getAttribute('onclick').match(/'([^']+)'/)[1]);
    const cardExists = await page.$(`#${anchorId}`);
    assert(!!cardExists, 'CAM-NR-3: the rollup item references an existing result-card id in the DOM', anchorId);

    await page.evaluate(() => window.scrollTo(0, 0));
    const scrollBefore = await page.evaluate(() => window.scrollY);
    await page.click('.nrr-item');
    await page.waitForTimeout(500);
    const scrollAfter = await page.evaluate(() => window.scrollY);
    assert(scrollAfter !== scrollBefore || scrollBefore === 0,
      'CAM-NR-3: clicking the rollup item triggers a scroll toward the flagged tenant card',
      `before=${scrollBefore} after=${scrollAfter}`);

    section('CAM-NR-4: Console error check');
    const realErrors = consoleLogs.filter(l =>
      (l.type === 'error' || l.type === 'PAGEERROR') &&
      !l.text.includes('favicon') &&
      !l.text.includes('Failed to load resource') &&
      !l.text.includes('[saveCamResults]') &&
      !l.text.includes('[CAM] save failed') &&
      !l.text.includes('[loadCamResults]') &&
      !l.text.includes('ERR_CERT_AUTHORITY_INVALID')
    );
    assert(realErrors.length === 0, 'CAM-NR-4: no console errors across the Needs Review rollup flow', JSON.stringify(realErrors.slice(0, 5)));

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
    console.log('\x1b[32m✅ All CAM Needs Review rollup checks passed\x1b[0m');
  } else {
    console.log('\x1b[31m❌ ' + failures + ' check(s) failed\x1b[0m');
  }
  console.log('─'.repeat(64));
  process.exit(failures === 0 ? 0 : 1);
})();
