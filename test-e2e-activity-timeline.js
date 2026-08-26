'use strict';
/**
 * test-e2e-activity-timeline.js — Punch-list item #5: "No activity recorded" on populated properties.
 *
 * Verifies the demo property ("Cascade Commons") — the most visible populated
 * property most users see — renders a real Property Activity timeline
 * (script.js:renderPropertyActivity) instead of the "No activity has been
 * recorded for this property yet." empty state, now that ensureDemoProperty()
 * seeds property.timeline with realistic historical events.
 *
 * Drives the app via the local HTTP server + Supabase mock pattern shared with
 * test-e2e-acquisition.js / test-e2e-cam-needs-review.js.
 *
 * Usage:
 *   node test-e2e-activity-timeline.js
 *
 * Optional env vars:
 *   HEADLESS=false   — open a visible browser
 *   APP_PORT=7828    — local HTTP server port
 */

let pw;
try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }
const { chromium } = pw;

const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const PORT     = parseInt(process.env.APP_PORT || '7828', 10);
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

// Supabase mock — same shape as test-e2e-acquisition.js / test-e2e-cam-needs-review.js.
const SUPABASE_MOCK = `
(function() {
  var _store = { properties: [], acquisition_reviews: [], tenants: [] };
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
    section('ACT-1: Load demo property (Cascade Commons) and open Overview tab');
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
    await page.evaluate(() => switchWorkspaceTab('overview'));
    await page.waitForTimeout(500);

    const timelineLen = await page.evaluate(() => (currentProperty().timeline || []).length);
    assert(timelineLen > 0, 'ACT-1: demo property has a non-empty timeline array', `length=${timelineLen}`);

    section('ACT-2: Property Activity panel renders real events, not the empty state');
    const slotHtml = await page.$eval('#propertyActivitySlot', el => el.innerHTML).catch(() => '');
    assert(!slotHtml.includes('No activity has been recorded for this property yet.'),
      'ACT-2: empty-state message is NOT shown for the populated demo property');
    assert(slotHtml.includes('Property Timeline'),
      'ACT-2: Property Timeline panel header is rendered');
    assert(/Property Timeline.*?(\d+) event/.test(slotHtml),
      'ACT-2: panel header shows an event count badge');

    section('ACT-3: Timeline includes lease, invoice, and dispute events');
    const hasTlItems = await page.$$eval('.tl-item', els => els.length).catch(() => 0);
    assert(hasTlItems > 0, 'ACT-3: at least one rendered timeline row (.tl-item)', `count=${hasTlItems}`);

    const typeBadges = await page.$$eval('.tl-type-badge', els => els.map(e => e.textContent));
    assert(typeBadges.includes('Lease'),    'ACT-3: timeline includes a "Lease" event', JSON.stringify(typeBadges));
    assert(typeBadges.includes('Invoice'),  'ACT-3: timeline includes an "Invoice" event', JSON.stringify(typeBadges));
    assert(typeBadges.includes('Dispute'),  'ACT-3: timeline includes a "Dispute" event', JSON.stringify(typeBadges));

    section('ACT-4: 🔍 Probe — filter chips narrow the visible event list');
    await page.click('.tl-filter-chip:has-text("Disputes")');
    await page.waitForTimeout(300);
    const filteredBadges = await page.$$eval('.tl-type-badge', els => els.map(e => e.textContent));
    assert(filteredBadges.length > 0 && filteredBadges.every(b => b === 'Dispute'),
      'ACT-4: clicking the "Disputes" filter chip narrows the list to dispute events only', JSON.stringify(filteredBadges));

    await page.click('.tl-filter-chip:has-text("All")');
    await page.waitForTimeout(300);
    const allBadges = await page.$$eval('.tl-type-badge', els => els.map(e => e.textContent));
    assert(allBadges.length >= filteredBadges.length,
      'ACT-4: clicking "All" restores the full event list', `all=${allBadges.length} disputesOnly=${filteredBadges.length}`);

    section('ACT-5: Console error check');
    const realErrors = consoleLogs.filter(l =>
      (l.type === 'error' || l.type === 'PAGEERROR') &&
      !l.text.includes('favicon') &&
      !l.text.includes('Failed to load resource') &&
      !l.text.includes('[saveCamResults]') &&
      !l.text.includes('[CAM] save failed') &&
      !l.text.includes('[loadCamResults]') &&
      !l.text.includes('ERR_CERT_AUTHORITY_INVALID')
    );
    assert(realErrors.length === 0, 'ACT-5: no console errors across the activity timeline flow', JSON.stringify(realErrors.slice(0, 5)));

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
    console.log('\x1b[32m✅ All Activity Timeline checks passed\x1b[0m');
  } else {
    console.log('\x1b[31m❌ ' + failures + ' check(s) failed\x1b[0m');
  }
  console.log('─'.repeat(64));
  process.exit(failures === 0 ? 0 : 1);
})();
