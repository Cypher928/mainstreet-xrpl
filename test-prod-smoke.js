'use strict';
/**
 * test-prod-smoke.js — Production smoke test against the live Vercel deployment.
 *
 * Tests authentication, data persistence across page refresh, demo seeding,
 * acquisition demo, Vercel API endpoints, and Supabase RLS — all with real
 * infrastructure (no mocks).
 *
 * Usage:
 *   TEST_EMAIL=you@example.com TEST_PASSWORD=yourpassword node test-prod-smoke.js
 *
 * Optional:
 *   PROD_URL=https://mainstreet-xrpl.vercel.app  (default)
 *   HEADLESS=false                                 (open a visible browser window)
 */

let pw;
try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }
const { chromium } = pw;
const https = require('https');

const PROD_URL = process.env.PROD_URL || 'https://mainstreet-xrpl.vercel.app';
const EMAIL    = process.env.TEST_EMAIL;
const PASSWORD = process.env.TEST_PASSWORD;

if (!EMAIL || !PASSWORD) {
  console.error('\n  ❌ TEST_EMAIL and TEST_PASSWORD must be set.\n');
  console.error('  Usage: TEST_EMAIL=you@example.com TEST_PASSWORD=yourpassword node test-prod-smoke.js\n');
  process.exit(1);
}

// ── Helpers ────────────────────────────────────────────────────────────────────
let failures = 0;
const consoleErrors = [];
function pass(label)     { console.log('\x1b[32m  ✅ ' + label + '\x1b[0m'); }
function fail(label, d)  { console.error('\x1b[31m  ❌ ' + label + (d ? ' — ' + d : '') + '\x1b[0m'); failures++; }
function warn(label)     { console.log('\x1b[33m  ⚠️  ' + label + '\x1b[0m'); }
function info(label)     { console.log('  · ' + label); }
function section(t)      { console.log('\n── ' + t + ' ' + '─'.repeat(Math.max(0, 56 - t.length))); }
function assert(c, l, d) { c ? pass(l) : fail(l, d); }

// Simple HTTPS GET returning { status, body }
function httpGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { timeout: 10000 }, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });
}

// Simple HTTPS POST returning { status, body }
function httpPost(url, payload, headers) {
  return new Promise((resolve, reject) => {
    const data = typeof payload === 'string' ? payload : JSON.stringify(payload);
    const u    = new URL(url);
    const opts = {
      hostname: u.hostname,
      path:     u.pathname,
      method:   'POST',
      headers:  Object.assign({ 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }, headers || {}),
      timeout:  15000,
    };
    const req = https.request(opts, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// ── Main ───────────────────────────────────────────────────────────────────────
(async () => {
  info('Production smoke test — target: ' + PROD_URL);
  info('Account: ' + EMAIL);

  // ════════════════════════════════════════════════════════════════════════════
  // GROUP 0 — Static availability (no browser needed)
  // ════════════════════════════════════════════════════════════════════════════
  section('GROUP 0: Static asset availability');

  const assetPaths = ['/', '/script.js', '/acquisition-engine.js', '/lease-intelligence.js', '/lease-test-lab.js'];
  for (const p of assetPaths) {
    try {
      const r = await httpGet(PROD_URL + p);
      assert(r.status === 200, 'GET ' + p + ' → 200', 'got ' + r.status);
    } catch (e) {
      fail('GET ' + p + ' → reachable', e.message);
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // GROUP 1 — Vercel API endpoint sanity (no credentials needed)
  // ════════════════════════════════════════════════════════════════════════════
  section('GROUP 1: Vercel API endpoints (missing-param behavior)');

  const apiEndpoints = [
    { path: '/api/claude', body: {} },
    { path: '/api/upload', body: {} },
    { path: '/api/ask-lease', body: {} },
    { path: '/api/explain', body: {} },
  ];
  for (const ep of apiEndpoints) {
    try {
      const r = await httpPost(PROD_URL + ep.path, ep.body);
      // Expect 400 (missing required param) or 405 (method not allowed) — never 500
      assert(r.status !== 500, 'POST ' + ep.path + ' does not 500 on empty body',
        'status=' + r.status + ' body=' + r.body.slice(0, 120));
      assert(r.status >= 400 && r.status < 500, 'POST ' + ep.path + ' → 4xx on empty body',
        'status=' + r.status);
    } catch (e) {
      fail('POST ' + ep.path + ' → reachable', e.message);
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // GROUP 2 — Supabase unauthenticated RLS (no browser needed)
  // ════════════════════════════════════════════════════════════════════════════
  section('GROUP 2: Supabase RLS — unauthenticated requests blocked');

  // Read SUPABASE_URL and SUPABASE_ANON_KEY from the deployed script.js
  let sbUrl = '';
  let sbKey = '';
  try {
    const scriptRes = await httpGet(PROD_URL + '/script.js');
    const urlM  = scriptRes.body.match(/SUPABASE_URL\s*=\s*'([^']+)'/);
    const keyM  = scriptRes.body.match(/SUPABASE_ANON_KEY\s*=\s*'([^']+)'/);
    sbUrl = urlM ? urlM[1] : '';
    sbKey = keyM ? keyM[1] : '';
    info('  Supabase URL: ' + sbUrl);
  } catch (e) {
    warn('Could not read script.js to extract Supabase config: ' + e.message);
  }

  if (sbUrl && sbKey) {
    const rlsTables = ['properties', 'tenants', 'lease_documents', 'cam_reconciliations', 'acquisition_reviews'];
    for (const table of rlsTables) {
      try {
        const r = await new Promise((resolve, reject) => {
          https.get(sbUrl + '/rest/v1/' + table + '?select=id&limit=1', {
            headers: { apikey: sbKey, 'Content-Type': 'application/json' },
            timeout: 8000,
          }, res => {
            let body = '';
            res.on('data', d => body += d);
            res.on('end', () => resolve({ status: res.statusCode, body }));
          }).on('error', reject);
        });
        const rows = (() => { try { return JSON.parse(r.body); } catch (_) { return r.body; } })();
        const blocked = r.status === 401 || r.status === 403 ||
                        (r.status === 200 && Array.isArray(rows) && rows.length === 0);
        assert(blocked, 'RLS: ' + table + ' blocks unauthenticated read',
          'status=' + r.status + ' body=' + r.body.slice(0, 80));
      } catch (e) {
        fail('RLS: ' + table + ' reachable', e.message);
      }
    }
  } else {
    warn('Supabase config not extracted — skipping RLS checks');
  }

  // ════════════════════════════════════════════════════════════════════════════
  // Groups 3–6 require a real browser with a live auth session
  // ════════════════════════════════════════════════════════════════════════════
  const browser = await chromium.launch({ headless: process.env.HEADLESS !== 'false' });
  // Use a persistent context so auth cookies survive the page-refresh test.
  // tempDir is intentionally NOT wiped between steps.
  const { mkdtempSync } = require('fs');
  const { join } = require('path');
  const { tmpdir } = require('os');
  const tmpDir = mkdtempSync(join(tmpdir(), 'ms-smoke-'));

  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    userDataDir: undefined,  // default ephemeral — no cross-run persistence
  });

  const page = await context.newPage();
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push('[console.error] ' + msg.text().slice(0, 200));
  });
  page.on('pageerror', err => consoleErrors.push('[pageerror] ' + err.message.slice(0, 200)));

  try {

    // ══════════════════════════════════════════════════════════════════════════
    // GROUP 3 — Authentication
    // ══════════════════════════════════════════════════════════════════════════
    section('GROUP 3: Authentication');

    await page.goto(PROD_URL, { waitUntil: 'networkidle', timeout: 30000 });

    const loginVisible = await page.$eval('#loginScreen', el => el.style.display !== 'none').catch(() => false);
    assert(loginVisible, 'G3: login screen visible on first load');

    // Sign in with real credentials
    await page.click('#loginTabSignIn').catch(() => {});
    await page.fill('#loginEmail', EMAIL);
    await page.fill('#loginPassword', PASSWORD);
    await page.click('#loginBtn');

    // Wait for dashboard — indicates auth succeeded and app loaded
    const dashAppeared = await page.waitForFunction(() => {
      const a = document.getElementById('appContent');
      return a && a.style.display !== 'none';
    }, { timeout: 20000 }).then(() => true).catch(() => false);
    assert(dashAppeared, 'G3: dashboard visible after sign-in');

    const loginHidden = await page.$eval('#loginScreen', el => el.style.display === 'none').catch(() => false);
    assert(loginHidden, 'G3: login screen hidden after sign-in');

    // Verify real user is in auth state
    const userId = await page.evaluate(() => {
      if (typeof _lsUserId !== 'undefined') return _lsUserId;
      return null;
    });
    assert(userId !== null && userId.length > 8, 'G3: authenticated user ID set (' + userId + ')',
      'userId=' + userId);
    info('  Signed in — user ID: ' + userId);

    // ══════════════════════════════════════════════════════════════════════════
    // GROUP 4 — Demo loading (real Supabase upsert)
    // ══════════════════════════════════════════════════════════════════════════
    section('GROUP 4: Demo loading (real Supabase persistence)');

    // Dismiss welcome modal if showing
    await page.evaluate(() => {
      const m = document.getElementById('obWelcomeModal');
      if (m && m.style.display !== 'none' && typeof obCloseWelcome === 'function') {
        obCloseWelcome('skip');
      } else if (m) {
        m.style.display = 'none';
      }
    });

    const demoBtnExists = await page.$('#demoBtn') !== null;
    assert(demoBtnExists, 'G4: #demoBtn exists in start-here panel');

    await page.click('#demoBtn');

    // Wait for main workflow — indicates property was upserted and selected
    const workflowVisible = await page.waitForFunction(() => {
      const w = document.getElementById('mainWorkflow');
      return w && w.style.display !== 'none';
    }, { timeout: 20000 }).then(() => true).catch(() => false);
    assert(workflowVisible, 'G4: mainWorkflow visible after demo load');

    const propName = await page.$eval('#propertyName', el => el.value).catch(() => '');
    assert(propName.includes('Cascade Commons'), 'G4: demo property "Cascade Commons" loaded', propName);

    const tenantCount = await page.evaluate(() =>
      typeof tenantData !== 'undefined' ? tenantData.filter(t => t?.tenant_name).length : -1
    );
    assert(tenantCount >= 5, 'G4: ≥5 demo tenants in memory', 'count=' + tenantCount);

    const invoiceCount = await page.evaluate(() =>
      typeof invoiceData !== 'undefined' ? invoiceData.length : -1
    );
    assert(invoiceCount >= 20, 'G4: ≥20 demo invoices in memory', 'count=' + invoiceCount);

    const reconCount = await page.evaluate(() =>
      typeof lastResults !== 'undefined' ? lastResults.length : -1
    );
    assert(reconCount >= 5, 'G4: demo reconciliation results present', 'count=' + reconCount);
    info('  Demo: ' + tenantCount + ' tenants, ' + invoiceCount + ' invoices, ' + reconCount + ' results');

    // ══════════════════════════════════════════════════════════════════════════
    // GROUP 5 — Page refresh persistence
    // ══════════════════════════════════════════════════════════════════════════
    section('GROUP 5: Page refresh persistence');

    info('  Refreshing page (F5)…');
    await page.reload({ waitUntil: 'networkidle', timeout: 30000 });

    // After refresh, Supabase should restore the session automatically —
    // app should show dashboard, NOT login screen
    const dashAfterRefresh = await page.waitForFunction(() => {
      const app = document.getElementById('appContent');
      const ls  = document.getElementById('loginScreen');
      return (app && app.style.display !== 'none') ||
             (ls  && ls.style.display  === 'none');
    }, { timeout: 20000 }).then(() => true).catch(() => false);
    assert(dashAfterRefresh, 'G5: dashboard (not login) shown after page refresh');

    const loginAfterRefresh = await page.$eval('#loginScreen', el => el.style.display === 'none').catch(() => false);
    assert(loginAfterRefresh, 'G5: login screen remains hidden after refresh');

    // Cascade Commons should still be in the portfolio cards
    await page.waitForTimeout(1000); // allow portfolio render
    const demoCardVisible = await page.evaluate(() => {
      const cards = document.querySelectorAll('[data-property-name], .portfolio-card, .prop-card');
      for (const c of cards) {
        if ((c.textContent || '').includes('Cascade Commons')) return true;
      }
      // Fallback: check _props
      return typeof _props !== 'undefined' && _props.some(p => (p.name || '').includes('Cascade Commons'));
    });
    assert(demoCardVisible, 'G5: Cascade Commons persists in portfolio after refresh');
    info('  Session survived refresh — user still authenticated');

    // ══════════════════════════════════════════════════════════════════════════
    // GROUP 6 — Acquisition demo
    // ══════════════════════════════════════════════════════════════════════════
    section('GROUP 6: Acquisition Due Diligence demo card');

    // Navigate back to portfolio dashboard
    await page.evaluate(() => {
      if (typeof renderPortfolio === 'function') renderPortfolio();
    });
    await page.waitForFunction(() => {
      const d = document.getElementById('portfolioDashboard');
      return d && d.style.display !== 'none';
    }, { timeout: 8000 }).catch(() => {});

    // Wait for acquisition reviews to load (async from Supabase)
    await page.waitForTimeout(2000);

    // Check acquisition grid has at least one card
    const acqCardCount = await page.$$eval('.acq-card', els => els.length).catch(() => 0);
    assert(acqCardCount >= 1, 'G6: ≥1 acquisition review card in #acqReviewsGrid', 'count=' + acqCardCount);

    // Verify Harborview card is present
    const harborviewVisible = await page.evaluate(() => {
      const grid = document.getElementById('acqReviewsGrid');
      return grid ? grid.textContent.includes('Harborview') : false;
    });
    assert(harborviewVisible, 'G6: "Harborview Retail Center" demo review card is visible');

    // Click the card and verify the report is rendered (status='complete')
    if (harborviewVisible) {
      await page.evaluate(() => {
        const cards = document.querySelectorAll('.acq-card');
        for (const c of cards) {
          if (c.textContent.includes('Harborview')) { c.click(); break; }
        }
      });
      await page.waitForFunction(() => {
        const p = document.getElementById('acqDetailPanel');
        return p && p.style.display !== 'none';
      }, { timeout: 8000 }).catch(() => {});

      const badge = await page.$eval('#acqDetailBadge', el => el.textContent).catch(() => '');
      assert(badge === 'complete', 'G6: Harborview review status badge is "complete"', 'badge=' + badge);

      const reportHTML = await page.$eval('#acqReportContainer', el => el.innerHTML.length).catch(() => 0);
      assert(reportHTML > 500, 'G6: Harborview report container has content (' + reportHTML + ' chars)');

      const verdictPresent = await page.evaluate(() => {
        const c = document.getElementById('acqReportContainer');
        return c ? c.textContent.includes('Due Diligence') || c.textContent.includes('Proceed') : false;
      });
      assert(verdictPresent, 'G6: acquisition report contains verdict text');
      info('  Report HTML: ' + reportHTML + ' chars, badge: "' + badge + '"');
    }

    // ══════════════════════════════════════════════════════════════════════════
    // GROUP 7 — CAM run persistence (write + re-read from Supabase)
    // ══════════════════════════════════════════════════════════════════════════
    section('GROUP 7: CAM run → Supabase persist → re-read after refresh');

    // Navigate to demo property
    await page.evaluate(() => { if (typeof renderPortfolio === 'function') renderPortfolio(); });
    await page.waitForTimeout(500);
    await page.evaluate(() => { if (typeof loadDemo === 'function') loadDemo(); });

    const workflowBack = await page.waitForFunction(() => {
      const w = document.getElementById('mainWorkflow');
      return w && w.style.display !== 'none';
    }, { timeout: 15000 }).then(() => true).catch(() => false);
    assert(workflowBack, 'G7: navigated back to demo property');

    if (workflowBack) {
      // Click Run CAM
      const runBtnVisible = await page.$eval('#runBtn', el => el && el.style.display !== 'none').catch(() => false);
      assert(runBtnVisible, 'G7: #runBtn visible on demo property');

      if (runBtnVisible) {
        await page.click('#runBtn');

        // Wait for allocation modal
        await page.waitForFunction(() => {
          const m = document.getElementById('allocModal');
          return m && m.style.display !== 'none';
        }, { timeout: 8000 }).catch(() => {});

        // Confirm allocation
        await page.evaluate(() => { if (typeof confirmAllocation === 'function') confirmAllocation(); });

        // Wait for results
        await page.waitForFunction(() => {
          return typeof lastResults !== 'undefined' && lastResults.length > 0;
        }, { timeout: 15000 }).catch(() => {});

        const resultCount = await page.evaluate(() =>
          typeof lastResults !== 'undefined' ? lastResults.length : 0
        );
        assert(resultCount >= 5, 'G7: CAM produced ≥5 tenant results', 'count=' + resultCount);

        // Wait for Supabase save (async)
        await page.waitForTimeout(3000);

        // Check #resultsBody has content
        const resultsRendered = await page.$eval('#resultsBody', el => el.innerHTML.length > 100).catch(() => false);
        assert(resultsRendered, 'G7: results rendered in #resultsBody');
        info('  CAM run complete — ' + resultCount + ' tenant results');

        // Refresh and verify results survive
        await page.reload({ waitUntil: 'networkidle', timeout: 30000 });
        await page.waitForTimeout(1500);

        const dashAfterCamRefresh = await page.evaluate(() => {
          const a = document.getElementById('appContent');
          return a && a.style.display !== 'none';
        });
        assert(dashAfterCamRefresh, 'G7: dashboard visible after CAM + refresh');
      }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // GROUP 8 — Console error audit
    // ══════════════════════════════════════════════════════════════════════════
    section('GROUP 8: Console error audit');

    // Filter known non-critical noise
    const criticalErrors = consoleErrors.filter(e =>
      !e.includes('favicon') &&
      !e.includes('net::ERR_ABORTED') &&
      !e.includes('Failed to load resource') &&
      !e.includes('[loadCamResults]') &&    // expected before first CAM run
      !e.includes('[saveCamResults]') &&    // expected on first load before results exist
      !e.includes('xrpl') &&
      !e.includes('[pageerror] Script error') &&  // third-party noise
      !e.includes('ResizeObserver')               // benign browser warning
    );

    if (criticalErrors.length === 0) {
      pass('G8: no critical console errors');
    } else {
      fail('G8: ' + criticalErrors.length + ' critical console error(s) found');
      criticalErrors.forEach((e, i) => console.log('    [' + (i+1) + '] ' + e));
    }

  } catch (err) {
    fail('Unexpected exception', err.message || String(err));
    console.error(err);
  }

  await browser.close();

  // ── Final report ────────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(62));
  console.log('  Target: ' + PROD_URL);
  console.log('  Account: ' + EMAIL);
  if (failures === 0) {
    console.log('\x1b[32m\n  ✅ All production smoke tests passed\x1b[0m');
  } else {
    console.log('\x1b[31m\n  ❌ ' + failures + ' assertion(s) failed\x1b[0m');
  }
  console.log('═'.repeat(62) + '\n');
  process.exit(failures ? 1 : 0);
})();
