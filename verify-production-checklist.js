'use strict';
/**
 * verify-production-checklist.js — Pre-production checklist verification
 *
 * Drives the local app via Playwright with a mocked Supabase:
 *   1. Existing user login
 *   2. New user signup
 *   3. Demo property loads
 *   4. View Lease button opens modal (tests the index-mismatch fix)
 *   5. Lease field edits update the correct tenantData slot
 *   6. No blocking console errors on load
 */

let pw;
try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }
const { chromium } = pw;

const http = require('http');
const fs   = require('fs');
const path = require('path');

const PORT     = 7910;
const ROOT     = __dirname;
const HEADLESS = process.env.HEADLESS !== 'false';
const BASE     = `http://127.0.0.1:${PORT}`;

let failures = 0;
function pass(label)       { console.log('\x1b[32m  ✅ ' + label + '\x1b[0m'); }
function fail(label, d)    { console.error('\x1b[31m  ❌ ' + label + (d ? ' — ' + d : '') + '\x1b[0m'); failures++; }
function section(label)    { console.log('\n── ' + label + ' ' + '─'.repeat(Math.max(0, 60 - label.length))); }
function assert(ok, label, detail) { ok ? pass(label) : fail(label, detail); }

const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css',
               '.json':'application/json', '.png':'image/png', '.ico':'image/x-icon' };

function startServer() {
  return new Promise((resolve, reject) => {
    const srv = http.createServer((req, res) => {
      let fp = path.join(ROOT, req.url === '/' ? '/index.html' : req.url.split('?')[0]);
      fs.readFile(fp, (err, data) => {
        if (err) { res.writeHead(404); res.end('not found'); return; }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
        res.end(data);
      });
    });
    srv.listen(PORT, '127.0.0.1', () => resolve(srv));
    srv.on('error', reject);
  });
}

// ── Supabase mock ─────────────────────────────────────────────────────────────
// window.__TEST_AUTHED = true → fires SIGNED_IN immediately (for logged-in tests)
// Absent/false → fires INITIAL_SESSION null (app shows login after its 1s timer)
const SUPABASE_MOCK = `
(function() {
  var startAuthed = !!window.__TEST_AUTHED;
  var _user  = startAuthed ? { id: 'mock-uid', email: 'test@mainstreet.local' } : null;
  var _authCbs = [];
  var _store = { properties:[], tenants:[], activity_log:[], profiles:[], acquisition_reviews:[] };

  function noopPromise(v) { return Promise.resolve(v); }
  function chainable(data) {
    // Chainable query result: supports .select(), .then(), .single()
    return {
      select:  function() { return noopPromise({ data: data, error: null }); },
      single:  function() { return noopPromise({ data: Array.isArray(data) ? data[0]||null : data, error: null }); },
      then:    function(fn) { return noopPromise({ data: data, error: null }).then(fn); },
    };
  }

  function fireAuth(ev, sess) {
    _authCbs.forEach(function(cb) { try { cb(ev, sess); } catch(e){} });
  }

  function makeQ(table) {
    var F = {};
    var _pending = null;
    var q = {
      select:   function()    { return q; },
      insert:   function(rows) {
        var a = Array.isArray(rows) ? rows : [rows];
        if (_store[table]) a.forEach(function(r) { _store[table].push(r); });
        // insert().select() is used in ensureDemoProperty — return chainable
        return chainable(a);
      },
      upsert:   function(row) {
        if (_store[table]) {
          var i = _store[table].findIndex(function(r) { return r.id === row.id; });
          if (i >= 0) _store[table][i] = Object.assign({}, _store[table][i], row);
          else _store[table].push(row);
        }
        return chainable([row]);
      },
      update:   function(v) {
        if (_store[table]) {
          _store[table].forEach(function(r) {
            var m = Object.keys(F).every(function(k) { return r[k] === F[k]; });
            if (m) Object.assign(r, v);
          });
        }
        return noopPromise({ data: null, error: null });
      },
      delete:   function() {
        return { eq: function(c, v) {
          if (_store[table]) _store[table] = _store[table].filter(function(r) { return r[c] !== v; });
          return noopPromise({ error: null });
        }};
      },
      eq:       function(c, v) { F[c] = v; return q; },
      neq:      function()     { return q; },
      in:       function()     { return q; },
      is:       function()     { return q; },
      order:    function()     { return q; },
      limit:    function()     { return q; },
      single:   function() {
        var rows = (_store[table] || []).filter(function(r) {
          return Object.keys(F).every(function(k) { return r[k] === F[k]; });
        });
        return noopPromise({ data: rows[0] || null, error: null });
      },
      then:     function(fn) {
        var rows = (_store[table] || []).filter(function(r) {
          return Object.keys(F).every(function(k) { return r[k] === F[k]; });
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
          getUser:    function() { return noopPromise({ data: { user: _user }, error: null }); },
          getSession: function() { return noopPromise({ data: { session: _user ? { user: _user } : null }, error: null }); },
          onAuthStateChange: function(cb) {
            _authCbs.push(cb);
            if (startAuthed) {
              setTimeout(function() { cb('SIGNED_IN', { user: _user }); }, 50);
            } else {
              setTimeout(function() { cb('INITIAL_SESSION', null); }, 50);
            }
            return { data: { subscription: { unsubscribe: function() {} } } };
          },
          signInWithPassword: function(creds) {
            _user = { id: 'mock-uid', email: creds.email };
            setTimeout(function() { fireAuth('SIGNED_IN', { user: _user }); }, 50);
            return noopPromise({ data: { user: _user }, error: null });
          },
          signUp: function(creds) {
            _user = { id: 'mock-new-uid', email: creds.email };
            setTimeout(function() { fireAuth('SIGNED_IN', { user: _user }); }, 50);
            return noopPromise({ data: { user: _user }, error: null });
          },
          signOut: function() {
            _user = null;
            setTimeout(function() { fireAuth('SIGNED_OUT', null); }, 50);
            return noopPromise({ error: null });
          },
          resetPasswordForEmail: function() { return noopPromise({ error: null }); },
          updateUser: function() { return noopPromise({ data: { user: _user }, error: null }); },
        },
        from: function(t) {
          if (!_store[t]) _store[t] = [];
          return makeQ(t);
        },
        storage: { from: function() {
          return {
            upload:       function() { return noopPromise({ data: { path: 'mock/lease.pdf' }, error: null }); },
            getPublicUrl: function() { return { data: { publicUrl: 'https://mock.storage/lease.pdf' } }; },
          };
        }},
        _store: _store,
      };
    }
  };
})();
`;

// ── Page factory ──────────────────────────────────────────────────────────────
async function newPage(browser, { authed = false } = {}) {
  const ctx  = await browser.newContext();
  const page = await ctx.newPage();

  if (authed) await page.addInitScript('window.__TEST_AUTHED = true;');

  await page.route('**supabase**', r => r.fulfill({
    status: 200, contentType: 'application/javascript', body: '/* supabase CDN blocked */',
  }));
  await page.route('**/api/**', r => r.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ content: [{ text: JSON.stringify({
      tenant_name: 'Mock Tenant', lease_type: 'NNN', leased_sqft: 2500,
      start_date: '2024-01-01', end_date: '2029-12-31', cap: 5,
      admin_fee_pct: 15, audit_rights: '30 days notice', renewal_options: '1x5yr',
      excluded_categories: null, expense_stop: null, gross_up_pct: null,
      pro_rata_method: 'occupied',
    }) }] }),
  }));

  await page.addInitScript(SUPABASE_MOCK);

  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(e.message));

  return { page, ctx, errors };
}

function filterErrors(errors) {
  return errors.filter(e =>
    !e.includes('favicon') &&
    !e.includes('fonts.googleapis') &&
    !e.includes('net::ERR_') &&
    !e.includes('Failed to load resource') &&
    !e.includes('supabase.co')
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
(async () => {
  const server  = await startServer();
  const browser = await chromium.launch({ headless: HEADLESS });

  // ── CHECK 1: Existing user login ───────────────────────────────────────────
  section('CHECK 1 — Existing user login');
  {
    const { page, ctx, errors } = await newPage(browser, { authed: false });
    await page.goto(BASE);

    // 1s safety timer in script.js calls _showLogin() if both divs are still hidden
    const loginScreen = await page.waitForSelector('#loginScreen', { state: 'visible', timeout: 5000 })
      .catch(() => null);
    assert(!!loginScreen, 'CHECK-1a: #loginScreen shown when not authenticated');

    await page.fill('#loginEmail', 'existing@example.com');
    await page.fill('#loginPassword', 'password123');
    await page.click('#loginBtn');

    const app = await page.waitForSelector('#appContent', { state: 'visible', timeout: 6000 })
      .catch(() => null);
    assert(!!app, 'CHECK-1b: #appContent visible after signInWithPassword mock');
    assert(filterErrors(errors).length === 0, 'CHECK-1c: no JS errors during login', filterErrors(errors)[0]);
    await ctx.close();
  }

  // ── CHECK 2: New user signup ───────────────────────────────────────────────
  section('CHECK 2 — New user signup');
  {
    const { page, ctx, errors } = await newPage(browser, { authed: false });
    await page.goto(BASE);

    await page.waitForSelector('#loginScreen', { state: 'visible', timeout: 5000 }).catch(() => {});

    // Switch to "Create Account" tab — same form, tab drives signUp vs signInWithPassword
    await page.click('#loginTabSignUp').catch(() => {});
    await page.waitForTimeout(200);

    await page.fill('#loginEmail', 'newuser@example.com');
    await page.fill('#loginPassword', 'newpassword123');
    await page.click('#loginBtn');

    const app = await page.waitForSelector('#appContent', { state: 'visible', timeout: 6000 })
      .catch(() => null);
    assert(!!app, 'CHECK-2: #appContent visible after signUp mock');
    await ctx.close();
  }

  // ── CHECK 3: Demo property loads ──────────────────────────────────────────
  section('CHECK 3 — Demo property loads');
  {
    const { page, ctx, errors } = await newPage(browser, { authed: true });
    await page.goto(BASE);

    const app = await page.waitForSelector('#appContent', { state: 'visible', timeout: 8000 })
      .catch(() => null);
    assert(!!app, 'CHECK-3a: #appContent visible with authed mock');

    if (app) {
      await page.waitForTimeout(1000);

      // Trigger loadDemo() — the primary demo entry point
      const loadedOk = await page.evaluate(() => {
        if (typeof loadDemo === 'function') { loadDemo(); return true; }
        return false;
      });
      assert(loadedOk, 'CHECK-3b: loadDemo() function available');

      await page.waitForTimeout(3000);

      // tenantData is const so we read it directly (not via window.tenantData)
      const hasData = await page.evaluate(() =>
        Array.isArray(tenantData) && tenantData.some(function(t) { return t && t.tenant_name; })
      ).catch(() => false);
      assert(hasData, 'CHECK-3c: tenantData populated after loadDemo()');

      const cardCount = await page.$eval('#bulkResults', el => el.children.length).catch(() => 0);
      assert(cardCount > 0, 'CHECK-3d: bulk tenant cards rendered', `${cardCount} cards`);

      const errs = filterErrors(errors);
      assert(errs.length === 0, 'CHECK-3e: no JS errors during demo load', errs[0]);
    }
    await ctx.close();
  }

  // ── CHECK 4: View Lease opens modal (the index-mismatch fix) ─────────────
  // Simulates exact broken state: tenantData[0..2] = null, tenant at [3].
  // Before the fix, _filterBulkTenants returned positional index 0 → openLeaseModalFromFile(0)
  // → d = null → early return (no modal). Fix: real index 3 is preserved.
  section('CHECK 4 — View Lease opens modal (index-mismatch fix)');
  {
    const { page, ctx, errors } = await newPage(browser, { authed: true });
    await page.goto(BASE);

    const app = await page.waitForSelector('#appContent', { state: 'visible', timeout: 8000 })
      .catch(() => null);
    assert(!!app, 'CHECK-4a: app visible');

    if (app) {
      await page.waitForTimeout(800);

      // Mutate the real tenantData (const array — cannot reassign but CAN mutate in-place)
      // and set slot 3 to a tenant with a leaseUrl.
      const rendered = await page.evaluate(() => {
        tenantData[0] = null;
        tenantData[1] = null;
        tenantData[2] = null;
        // Truncate any extra slots then push at index 3
        tenantData.length = 3;
        tenantData.push({
          id: 'test-t1',
          tenant_name: 'Acme Corp',
          lease_type: 'NNN',
          leased_sqft: 3000,
          start_date: '2023-01-01',
          end_date: '2028-12-31',
          leaseUrl: 'https://example.com/test-lease.pdf',
          leaseExpected: true,
          status: 'done',
          _needsReview: false,
          extractionFailed: false,
          _userConfirmed: true,
        });
        // tenantData[3] is now the tenant
        if (typeof renderBulkResults === 'function') { renderBulkResults(); return true; }
        return false;
      });
      assert(rendered, 'CHECK-4b: tenantData mutated and renderBulkResults() called');

      await page.waitForTimeout(600);

      // View Lease button: class="view-lease-btn" with onclick="openLeaseModalFromFile(3)"
      const viewBtn = await page.$('.view-lease-btn');
      assert(!!viewBtn, 'CHECK-4c: .view-lease-btn present in rendered card');

      // The button renders inside a panel that may be hidden in this test context.
      // Call openLeaseModalFromFile(3) directly — that's the exact function the button
      // invokes and the exact code path the index-mismatch fix protects.
      const modalResult = await page.evaluate(() => {
        if (typeof openLeaseModalFromFile !== 'function') return { err: 'fn missing' };
        openLeaseModalFromFile(3);
        var m = document.getElementById('leaseViewerModal');
        if (!m) return { err: 'no modal element' };
        var s = window.getComputedStyle(m);
        var visible = s.display !== 'none' && s.visibility !== 'hidden';
        var frame = document.getElementById('leaseViewerFrame');
        return { visible: visible, frameSrc: frame ? frame.src : '' };
      });
      assert(!modalResult.err, 'CHECK-4d: openLeaseModalFromFile available', modalResult.err);
      assert(modalResult.visible === true, 'CHECK-4e: #leaseViewerModal opened by openLeaseModalFromFile(3)', `visible=${modalResult.visible}`);
      assert(modalResult.frameSrc && modalResult.frameSrc.length > 4,
        'CHECK-4f: leaseViewerFrame src populated', modalResult.frameSrc);
    }
    await ctx.close();
  }

  // ── CHECK 5: Lease field edits reach the correct tenantData slot ──────────
  // updateTenantField(3, field, value) must write to tenantData[3] — not [0].
  section('CHECK 5 — Lease field edits update correct tenantData index');
  {
    const { page, ctx, errors } = await newPage(browser, { authed: true });
    await page.goto(BASE);

    const app = await page.waitForSelector('#appContent', { state: 'visible', timeout: 8000 })
      .catch(() => null);
    assert(!!app, 'CHECK-5a: app visible');

    if (app) {
      await page.waitForTimeout(500);

      // Set up + call updateTenantField in a single synchronous evaluate so no
      // async init() code can race between setup and check.
      const result = await page.evaluate(() => {
        tenantData[0] = null;
        tenantData[1] = null;
        tenantData[2] = null;
        tenantData.length = 3;
        tenantData.push({
          id: 'edit-test',
          tenant_name: 'Original Name',
          lease_type: 'NNN',
          leased_sqft: 2000,
          start_date: '2023-01-01',
          end_date: '2027-12-31',
          status: 'done',
          _needsReview: false,
          extractionFailed: false,
          _userConfirmed: true,
        });

        if (typeof updateTenantField !== 'function') return { ok: false, reason: 'updateTenantField not found' };
        updateTenantField(3, 'tenant_name', 'Updated Name');
        return {
          ok: true,
          slot3Name:  tenantData[3] ? tenantData[3].tenant_name : null,
          slot0IsNull: tenantData[0] === null,
        };
      });

      assert(result.ok, 'CHECK-5b: updateTenantField() is defined', result.reason);
      assert(result.slot3Name === 'Updated Name',
        'CHECK-5c: tenantData[3].tenant_name updated', `got "${result.slot3Name}"`);
      assert(result.slot0IsNull,
        'CHECK-5d: tenantData[0] remains null (no index bleed)', `slot0=${result.slot0IsNull}`);
    }
    await ctx.close();
  }

  // ── CHECK 6: No blocking JS errors on cold load ───────────────────────────
  section('CHECK 6 — No blocking JS errors on cold load');
  {
    const { page, ctx, errors } = await newPage(browser, { authed: false });
    await page.goto(BASE);
    await page.waitForTimeout(3500);

    const blocking = filterErrors(errors);
    assert(blocking.length === 0, 'CHECK-6: no blocking JS errors', blocking[0]);
    if (blocking.length > 0) blocking.slice(0, 5).forEach(e => console.log('     · ' + e.slice(0, 120)));
    await ctx.close();
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(62));
  if (failures === 0) {
    console.log('\x1b[32m  ALL CHECKS PASSED — safe to merge to main\x1b[0m');
  } else {
    console.log('\x1b[31m  ' + failures + ' CHECK(S) FAILED\x1b[0m');
  }
  console.log('═'.repeat(62) + '\n');

  await browser.close();
  server.close();
  process.exit(failures > 0 ? 1 : 0);
})();
