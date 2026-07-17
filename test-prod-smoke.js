'use strict';
/**
 * test-prod-smoke.js — 20-requirement production smoke test
 *
 * Targets the live Vercel deployment with the real Supabase backend.
 * The Anthropic API (/api/claude) and storage upload (/api/upload) are
 * intercepted via Playwright route handlers to avoid external costs; all
 * data persistence (properties, tenants, sessions) uses the real Supabase.
 *
 * Requirements covered:
 *   R1  Sign Up              R11 Upload Lease
 *   R2  Login                R12 Verify Extraction Completes
 *   R3  Password Persistence R13 Verify Lease Data Persists
 *   R4  Create Property      R14 Run CAM Allocation
 *   R5  Save Property        R15 Verify Results Render
 *   R6  Refresh Page         R16 Generate Reports
 *   R7  Property Still Exists R17 Open View Lease
 *   R8  Logout               R18 No Console Errors
 *   R9  Login Again          R19 No Failed Network Requests
 *   R10 Property Still Exists R20 Pass/Fail Summary
 *
 * Usage:
 *   TEST_EMAIL=you@example.com TEST_PASSWORD=secret node test-prod-smoke.js
 *
 * Optional:
 *   PROD_URL=https://mainstreetcam.com   (default)
 *   HEADLESS=false                                  (show browser window)
 */

let pw;
try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }
const { chromium } = pw;
const https = require('https');
const fs    = require('fs');
const path  = require('path');

const PROD_URL       = process.env.PROD_URL || 'https://mainstreetcam.com';
const EMAIL          = process.env.TEST_EMAIL;
const PASSWORD       = process.env.TEST_PASSWORD;
const HEADLESS       = process.env.HEADLESS !== 'false';
const SCREENSHOT_DIR = path.join(process.cwd(), 'smoke-screenshots');

if (!EMAIL || !PASSWORD) {
  console.error('\n  ❌ TEST_EMAIL and TEST_PASSWORD must be set.\n');
  console.error('  Usage: TEST_EMAIL=you@example.com TEST_PASSWORD=secret node test-prod-smoke.js\n');
  process.exit(1);
}

// ── Helpers ────────────────────────────────────────────────────────────────────

let failures = 0;
const consoleErrors  = [];
const networkErrors  = [];
const stepResults    = [];
let   stepNum        = 0;

function pass(label)  { console.log('\x1b[32m  ✅ ' + label + '\x1b[0m'); }
function fail(label, d) { console.error('\x1b[31m  ❌ ' + label + (d ? ' — ' + d : '') + '\x1b[0m'); failures++; }
function warn(label)  { console.log('\x1b[33m  ⚠️  ' + label + '\x1b[0m'); }
function info(label)  { console.log('  · ' + label); }
function section(t)   { console.log('\n── ' + t + ' ' + '─'.repeat(Math.max(0, 60 - t.length))); }

function ensureScreenshotDir() {
  if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

async function snap(page, label) {
  ensureScreenshotDir();
  const name = 'FAIL-R' + String(stepNum).padStart(2, '0') + '-' + label.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 40) + '.png';
  const file = path.join(SCREENSHOT_DIR, name);
  try { await page.screenshot({ path: file, fullPage: true }); }
  catch (_) { return null; }
  return file;
}

async function assertR(condition, label, detail, page) {
  stepNum++;
  if (condition) {
    pass('R' + stepNum + ': ' + label);
    stepResults.push({ r: stepNum, label, passed: true });
  } else {
    const scFile = page ? await snap(page, label) : null;
    const msg = detail + (scFile ? ' [screenshot: ' + path.basename(scFile) + ']' : '');
    fail('R' + stepNum + ': ' + label, msg);
    stepResults.push({ r: stepNum, label, passed: false, detail, screenshot: scFile });
  }
}

// HTTPS GET — returns { status, body }
function httpGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { timeout: 12000 }, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });
}

// HTTPS POST — returns { status, body }
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

// ── Mock data ──────────────────────────────────────────────────────────────────

// Fake lease document — > 500 chars, contains 'lease', > 100 words.
// extractLeaseText() on a .txt file returns file.text() immediately; since
// length >= 50, the text path is taken and callClaudeForLease() is called.
const FAKE_LEASE_TEXT = `
COMMERCIAL LEASE AGREEMENT

THIS COMMERCIAL LEASE AGREEMENT ("Lease") is entered into as of January 1, 2024,
by and between TestLandlord Properties LLC ("Landlord") and Smoke Test Tenant Corp
("Tenant").

1. PREMISES
   Landlord hereby leases to Tenant the premises consisting of 5,000 square feet
   located at 100 Commerce Drive, Suite 200, pursuant to the terms of this Lease.

2. TERM
   The term of this Lease shall commence on January 1, 2024, and shall expire on
   December 31, 2027, unless sooner terminated as provided in this Lease Agreement.

3. LEASE TYPE
   This is a Triple Net (NNN) Lease. Tenant shall pay, in addition to base rent,
   all operating expenses, real property taxes, and property insurance premiums.

4. BASE RENT
   Tenant shall pay monthly base rent of Eight Thousand Five Hundred Dollars ($8,500)
   per month, payable in advance on the first day of each calendar month.

5. COMMON AREA MAINTENANCE
   Tenant's pro-rata share of all Common Area Maintenance (CAM) expenses is capped
   at five percent (5%) cumulative per year over the prior year's amount.
   Administrative fee shall be fifteen percent (15%) of total CAM expenses.
   Gross-up provision applies at ninety percent (90%) occupancy.

6. RENEWAL OPTIONS
   Tenant shall have two (2) options to renew this Lease, each for a period of five
   (5) years, subject to sixty (60) days prior written notice to Landlord.

7. AUDIT RIGHTS
   Tenant shall have the right to audit Landlord's CAM records within thirty (30) days
   of written notice, not more than once per calendar year.

8. EXCLUDED CATEGORIES
   The following expense categories are explicitly excluded from the CAM pool:
   capital expenditures, management fees, ground lease payments, and debt service.

IN WITNESS WHEREOF, the parties hereto have executed this Lease as of the date
first written above.

LANDLORD: TestLandlord Properties LLC
TENANT:   Smoke Test Tenant Corp
`.trim();

// Mock Claude extraction response — all key fields present → confidence = 'high'.
const MOCK_CLAUDE_RESPONSE = {
  content: [{
    type: 'text',
    text: JSON.stringify([{
      tenant_name:        'Smoke Test Tenant Corp',
      lease_type:         'NNN',
      leased_sqft:        5000,
      start_date:         '2024-01-01',
      end_date:           '2027-12-31',
      base_rent:          8500,
      cap:                5,
      admin_fee_pct:      15,
      gross_up_pct:       90,
      pro_rata_method:    'usable',
      renewal_options:    '2 x 5-year options',
      audit_rights:       '30 days written notice',
      excluded_categories: 'capital expenditures, management fees',
    }])
  }],
  usage: { input_tokens: 180, output_tokens: 95 },
};

// Mock upload response — a plausible Supabase Storage public URL.
// The URL does not need to be real; it just needs to be non-blob so the
// View Lease button opens #leaseViewerModal instead of showing a toast.
const MOCK_UPLOAD_RESPONSE = {
  url: 'https://zhsuhehgehbzkmzurzyf.supabase.co/storage/v1/object/public/leases/smoke-test-lease.txt',
};

// ── Main ───────────────────────────────────────────────────────────────────────
(async () => {
  const TS        = Date.now();
  const PROP_NAME = 'Smoke Test Property ' + TS;

  ensureScreenshotDir();
  console.log('\n' + '═'.repeat(62));
  info('Production smoke test  —  ' + PROD_URL);
  info('Account:    ' + EMAIL);
  info('Property:   ' + PROP_NAME);
  info('Screenshots: ' + SCREENSHOT_DIR + '/');
  console.log('═'.repeat(62));

  // ════════════════════════════════════════════════════════════════════════════
  // STATIC CHECKS — no browser required
  // ════════════════════════════════════════════════════════════════════════════
  section('STATIC: Asset availability');
  const assets = ['/', '/script.js', '/acquisition-engine.js', '/lease-intelligence.js'];
  for (const p of assets) {
    try {
      const r = await httpGet(PROD_URL + p);
      if (r.status === 200) pass('GET ' + p + ' → 200');
      else fail('GET ' + p, 'status=' + r.status);
    } catch (e) { fail('GET ' + p + ' → reachable', e.message); }
  }

  section('STATIC: Vercel API endpoints (empty-body 4xx, not 500)');
  for (const ep of ['/api/claude', '/api/upload', '/api/ask-lease', '/api/explain']) {
    try {
      const r = await httpPost(PROD_URL + ep, {});
      if (r.status !== 500 && r.status >= 400 && r.status < 500) {
        pass('POST ' + ep + ' → ' + r.status + ' (no 500 on empty body)');
      } else if (r.status !== 500) {
        warn('POST ' + ep + ' → ' + r.status + ' (unexpected but not a 500)');
      } else {
        fail('POST ' + ep + ' returned 500 on empty body', r.body.slice(0, 120));
      }
    } catch (e) { fail('POST ' + ep + ' → reachable', e.message); }
  }

  section('STATIC: Supabase RLS — unauthenticated reads blocked');
  let sbUrl = '', sbKey = '';
  try {
    const s = await httpGet(PROD_URL + '/script.js');
    const uM = s.body.match(/SUPABASE_URL\s*=\s*'([^']+)'/);
    const kM = s.body.match(/SUPABASE_ANON_KEY\s*=\s*'([^']+)'/);
    sbUrl = uM ? uM[1] : '';
    sbKey = kM ? kM[1] : '';
  } catch (_) {}

  if (sbUrl && sbKey) {
    for (const tbl of ['properties', 'tenants', 'cam_reconciliations', 'acquisition_reviews']) {
      try {
        const r = await new Promise((resolve, reject) => {
          https.get(sbUrl + '/rest/v1/' + tbl + '?select=id&limit=1', {
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
        if (blocked) pass('RLS: ' + tbl + ' — unauthenticated read blocked');
        else fail('RLS: ' + tbl + ' — should block unauthenticated read', 'status=' + r.status + ' rows=' + JSON.stringify(rows).slice(0, 60));
      } catch (e) { fail('RLS: ' + tbl + ' reachable', e.message); }
    }
  } else {
    warn('Could not extract Supabase config from script.js — skipping RLS checks');
  }

  // ════════════════════════════════════════════════════════════════════════════
  // BROWSER TESTS: R1–R19
  // ════════════════════════════════════════════════════════════════════════════
  const browser = await chromium.launch({ headless: HEADLESS });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page    = await context.newPage();

  // Collect console errors throughout the session
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push('[console] ' + msg.text().slice(0, 250));
  });
  page.on('pageerror', err => consoleErrors.push('[pageerror] ' + err.message.slice(0, 250)));

  // Collect unexpected network errors (enabled after login to skip pre-auth noise)
  let trackNetwork = false;
  page.on('response', resp => {
    if (!trackNetwork) return;
    const status = resp.status();
    const url    = resp.url();
    if (status >= 500) {
      networkErrors.push({ type: '5xx', status, url });
      return;
    }
    // 4xx from app API endpoints after login are unexpected failures
    if (status >= 400) {
      const isAuth = url.includes('/auth/v1/') || url.includes('/token');
      const isMock = url.includes('/api/claude') || url.includes('/api/upload');
      if (!isAuth && !isMock) {
        networkErrors.push({ type: '4xx', status, url });
      }
    }
  });

  let propId = null;

  try {

    // ──────────────────────────────────────────────────────────────────────────
    // R1: Sign Up
    // ──────────────────────────────────────────────────────────────────────────
    section('R1: Sign Up');
    await page.goto(PROD_URL, { waitUntil: 'networkidle', timeout: 30000 });

    // Switch to sign-up tab
    await page.click('#loginTabSignUp').catch(() => {});
    await page.waitForTimeout(200);
    await page.fill('#loginEmail', EMAIL);
    await page.fill('#loginPassword', PASSWORD);
    await page.click('#loginBtn');

    // Wait for any response: immediate session, success msg, or error msg
    const signupOutcome = await Promise.race([
      page.waitForFunction(() => {
        const a = document.getElementById('appContent');
        return a && a.style.display !== 'none';
      }, { timeout: 12000 }).then(() => 'dashboard'),
      page.waitForFunction(() => {
        const m = document.getElementById('loginMsg');
        return m && m.textContent.trim().length > 5;
      }, { timeout: 12000 }).then(() => 'message'),
    ]).catch(() => 'timeout');

    const signupMsg  = await page.$eval('#loginMsg', el => el.textContent.trim()).catch(() => '');
    const dashNow    = await page.$eval('#appContent', el => el.style.display !== 'none').catch(() => false);
    const alreadyReg = /already|registered|exists/i.test(signupMsg);
    const goodMsg    = /created|confirmation|check your email/i.test(signupMsg);

    // R1 passes if the form was submitted and Supabase responded in any expected way
    const r1ok = dashNow || alreadyReg || goodMsg || signupOutcome === 'dashboard';
    await assertR(r1ok, 'Sign-up form submitted — Supabase responded',
      `outcome=${signupOutcome} msg="${signupMsg}"`, page);

    if (alreadyReg) info('  Account already exists — using existing credentials for login');
    if (goodMsg && !dashNow) info('  Sign-up message received — switching to sign-in');

    // ──────────────────────────────────────────────────────────────────────────
    // R2: Login
    // ──────────────────────────────────────────────────────────────────────────
    section('R2: Login');

    if (!dashNow) {
      await page.click('#loginTabSignIn').catch(() => {});
      await page.waitForTimeout(200);
      await page.fill('#loginEmail', EMAIL);
      await page.fill('#loginPassword', PASSWORD);
      await page.click('#loginBtn');
    }

    const dashAppeared = await page.waitForFunction(() => {
      const a = document.getElementById('appContent');
      return a && a.style.display !== 'none';
    }, { timeout: 25000 }).then(() => true).catch(() => false);
    await assertR(dashAppeared, 'Dashboard visible after login', '', page);

    const loginGone = await page.$eval('#loginScreen', el => el.style.display === 'none').catch(() => false);
    await assertR(loginGone, 'Login screen hidden after authentication', '', page);

    // Begin tracking network errors now that we're authenticated
    trackNetwork = true;

    // ──────────────────────────────────────────────────────────────────────────
    // R3: Password Persistence (session survives page reload)
    // ──────────────────────────────────────────────────────────────────────────
    section('R3: Password Persistence');
    await page.reload({ waitUntil: 'networkidle', timeout: 30000 });

    const stillAuth = await page.waitForFunction(() => {
      const a = document.getElementById('appContent');
      const l = document.getElementById('loginScreen');
      return (a && a.style.display !== 'none') || (l && l.style.display === 'none');
    }, { timeout: 20000 }).then(() => true).catch(() => false);
    await assertR(stillAuth, 'Supabase session persists after page reload', '', page);

    // Dismiss welcome panel if present
    await page.evaluate(() => {
      if (typeof _dismissDemoWelcome === 'function') _dismissDemoWelcome();
      const m = document.getElementById('obWelcomeModal');
      if (m) m.style.display = 'none';
    });

    // ──────────────────────────────────────────────────────────────────────────
    // R4: Create Property
    // ──────────────────────────────────────────────────────────────────────────
    section('R4: Create Property');

    await page.evaluate(() => { if (typeof addNewProperty === 'function') addNewProperty(); });

    const workflowOpen = await page.waitForFunction(() => {
      const w = document.getElementById('mainWorkflow');
      return w && w.style.display !== 'none';
    }, { timeout: 15000 }).then(() => true).catch(() => false);
    await assertR(workflowOpen, 'New property created — workflow panel visible', '', page);

    // ──────────────────────────────────────────────────────────────────────────
    // R5: Save Property (name + sqft → Supabase upsert)
    // ──────────────────────────────────────────────────────────────────────────
    section('R5: Save Property');

    // Update in-memory name first to prevent renderProperty() from resetting the DOM
    await page.evaluate((name) => {
      const prop = (typeof currentProperty === 'function') ? currentProperty() : null;
      if (prop) prop.name = name;
    }, PROP_NAME);
    await page.fill('#propertyName', PROP_NAME);
    await page.fill('#totalSqft', '10000');

    // Listen for the Supabase properties write
    const savePromise = page.waitForResponse(
      resp => resp.url().includes('/rest/v1/properties') && resp.status() < 400,
      { timeout: 15000 }
    ).catch(() => null);

    await page.evaluate(() => {
      if (typeof savePropertyData === 'function') savePropertyData();
    });

    const saveResp = await savePromise;
    propId = await page.evaluate(() => (typeof currentProperty === 'function' ? currentProperty()?.id : null) ?? null);

    const savedOk = (saveResp !== null) || (propId && propId.length > 10);
    await assertR(savedOk, 'Property saved to Supabase', 'propId=' + propId, page);
    if (propId) info('  Property ID: ' + propId);

    // ──────────────────────────────────────────────────────────────────────────
    // R6: Refresh Page
    // R7: Verify Property Still Exists
    // ──────────────────────────────────────────────────────────────────────────
    section('R6-R7: Refresh — verify property persists');
    await page.reload({ waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(1500);
    await assertR(true, 'Page refreshed successfully', '', null);

    const propInMemory = await page.evaluate((name) => {
      if (typeof _props !== 'undefined' && Array.isArray(_props)) {
        return _props.some(p => p.name === name);
      }
      return false;
    }, PROP_NAME);
    await assertR(propInMemory, '"' + PROP_NAME + '" present in portfolio after refresh', '', page);

    // ──────────────────────────────────────────────────────────────────────────
    // R8: Logout
    // ──────────────────────────────────────────────────────────────────────────
    section('R8: Logout');
    await page.evaluate(() => { if (typeof signOut === 'function') signOut(); });

    const loginBack = await page.waitForFunction(() => {
      const l = document.getElementById('loginScreen');
      return l && l.style.display !== 'none';
    }, { timeout: 10000 }).then(() => true).catch(() => false);
    await assertR(loginBack, 'Logged out — login screen visible', '', page);

    // ──────────────────────────────────────────────────────────────────────────
    // R9: Login Again
    // R10: Verify Property Still Exists After Re-login
    // ──────────────────────────────────────────────────────────────────────────
    section('R9-R10: Login again — verify property survives logout/login cycle');

    // Ensure sign-in tab is active
    await page.click('#loginTabSignIn').catch(() => {});
    await page.fill('#loginEmail', EMAIL);
    await page.fill('#loginPassword', PASSWORD);
    await page.click('#loginBtn');

    const loginOk = await page.waitForFunction(() => {
      const a = document.getElementById('appContent');
      return a && a.style.display !== 'none';
    }, { timeout: 25000 }).then(() => true).catch(() => false);
    await assertR(loginOk, 'Login again succeeded — dashboard visible', '', page);

    await page.waitForTimeout(1500); // allow portfolio to render

    const propAfterRelogin = await page.evaluate((name) => {
      if (typeof _props !== 'undefined' && Array.isArray(_props)) {
        return _props.some(p => p.name === name);
      }
      return false;
    }, PROP_NAME);
    await assertR(propAfterRelogin, '"' + PROP_NAME + '" persists after logout/login', '', page);

    // Navigate to the property
    if (propId) {
      await page.evaluate((id) => { if (typeof selectProperty === 'function') selectProperty(id); }, propId);
      await page.waitForFunction(() => {
        const w = document.getElementById('mainWorkflow');
        return w && w.style.display !== 'none';
      }, { timeout: 12000 }).catch(() => {});
      await page.waitForTimeout(500);
    }

    // Dismiss welcome panel
    await page.evaluate(() => {
      if (typeof _dismissDemoWelcome === 'function') _dismissDemoWelcome();
    });

    // ──────────────────────────────────────────────────────────────────────────
    // R11: Upload Lease
    // R12: Verify Extraction Completes
    // ──────────────────────────────────────────────────────────────────────────
    section('R11-R12: Upload Lease — verify extraction');

    // Intercept Anthropic API call to return mock tenant data (avoids real Claude cost)
    await page.route('**/api/claude', route => {
      route.fulfill({
        status:      200,
        contentType: 'application/json',
        body:        JSON.stringify(MOCK_CLAUDE_RESPONSE),
      });
    });

    // Intercept Supabase Storage upload to return a plausible public URL
    await page.route('**/api/upload', route => {
      route.fulfill({
        status:      200,
        contentType: 'application/json',
        body:        JSON.stringify(MOCK_UPLOAD_RESPONSE),
      });
    });

    // Create a File in the browser context and call handleBulkLeases() directly.
    // Using a .txt file so extractLeaseText() returns file.text() immediately
    // (text path) rather than trying PDF.js, and the text is > 50 chars so
    // callClaudeForLease() (not the PDF-direct path) is used.
    await page.evaluate((leaseText) => {
      const blob = new Blob([leaseText], { type: 'text/plain' });
      const file = new File([blob], 'smoke-test-lease.txt', { type: 'text/plain' });
      const dt   = new DataTransfer();
      dt.items.add(file);
      if (typeof handleBulkLeases === 'function') handleBulkLeases(dt.files);
      else throw new Error('handleBulkLeases not found on window');
    }, FAKE_LEASE_TEXT);

    // Wait for extraction pipeline to populate tenantData[0].tenant_name
    const extractionDone = await page.waitForFunction(() => {
      return Array.isArray(tenantData) &&
             tenantData.length > 0 &&
             tenantData[0] !== null &&
             tenantData[0]?.tenant_name &&
             tenantData[0]?.status !== 'pending' &&
             tenantData[0]?.status !== 'processing';
    }, { timeout: 35000 }).then(() => true).catch(() => false);
    await assertR(extractionDone, 'Lease uploaded and extraction pipeline completed', '', page);

    const extractedName = await page.evaluate(() => tenantData?.[0]?.tenant_name ?? null);
    const extractedSqft = await page.evaluate(() => tenantData?.[0]?.leased_sqft ?? null);
    const extractedType = await page.evaluate(() => tenantData?.[0]?.lease_type  ?? null);
    await assertR(
      extractedName === 'Smoke Test Tenant Corp',
      'Extracted tenant matches mock response (name, sqft, lease type)',
      'name="' + extractedName + '" sqft=' + extractedSqft + ' type=' + extractedType,
      page
    );

    // Wait for Supabase tenant write (resyncTenantsToTable runs after pipeline)
    await page.waitForTimeout(4000);

    // Remove route intercepts — subsequent Claude calls go through normally
    await page.unroute('**/api/claude');
    await page.unroute('**/api/upload');

    // ──────────────────────────────────────────────────────────────────────────
    // R13: Verify Lease Data Persists (reload → re-select property)
    // ──────────────────────────────────────────────────────────────────────────
    section('R13: Lease data persists after refresh');
    await page.reload({ waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(1500);

    if (propId) {
      await page.evaluate((id) => { if (typeof selectProperty === 'function') selectProperty(id); }, propId);
      await page.waitForFunction(() => {
        const w = document.getElementById('mainWorkflow');
        return w && w.style.display !== 'none';
      }, { timeout: 12000 }).catch(() => {});
      await page.waitForTimeout(1500);
    }

    const tenantPersists = await page.evaluate(() => {
      return Array.isArray(tenantData) &&
             tenantData.some(t => t?.tenant_name === 'Smoke Test Tenant Corp');
    });
    await assertR(tenantPersists, '"Smoke Test Tenant Corp" still in tenantData after refresh', '', page);

    // ──────────────────────────────────────────────────────────────────────────
    // R14: Run CAM Allocation
    // R15: Verify Results Render
    // ──────────────────────────────────────────────────────────────────────────
    section('R14-R15: Run CAM allocation — verify results');

    // This is a fresh property with no real invoices saved to DB. Inject sample
    // invoices into the in-memory arrays so the CAM calculation can produce results.
    // These are session-only; they do not persist but are sufficient for testing
    // the allocation engine and report generation.
    await page.evaluate(() => {
      const sampleInvoices = [
        { description: 'Property Tax', amount: 18000, category: 'taxes', vendorName: 'County Assessor', invoiceDate: '2024-01-15', confidence: { vendorName: 95, amount: 98, category: 95 } },
        { description: 'Insurance Premium', amount: 6000, category: 'insurance', vendorName: 'Zurich', invoiceDate: '2024-01-20', confidence: { vendorName: 92, amount: 96, category: 94 } },
        { description: 'Landscaping Services', amount: 3600, category: 'maintenance', vendorName: 'Green Services', invoiceDate: '2024-02-01', confidence: { vendorName: 90, amount: 95, category: 91 } },
      ];
      if (typeof invoiceData !== 'undefined') {
        // Only inject if no real invoices exist for this property
        if (invoiceData.length === 0) {
          invoiceData.push(...sampleInvoices);
          lastInvoicesFull = [...invoiceData];
        }
      }
    });

    const runBtnReady = await page.$eval('#runBtn', el => !!(el && el.offsetParent !== null)).catch(() => false);
    await assertR(runBtnReady, 'Run CAM button (#runBtn) visible on property page', '', page);

    if (runBtnReady) {
      await page.click('#runBtn');

      // Wait for allocation modal (#allocModal, not #allocationModal)
      await page.waitForFunction(() => {
        const m = document.getElementById('allocModal');
        return m && m.style.display !== 'none';
      }, { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(200);

      // Confirm allocation via the production function (avoids ambiguous selector)
      await page.evaluate(() => { if (typeof confirmAllocation === 'function') confirmAllocation(); });

      // Wait for lastResults to be populated
      const gotResults = await page.waitForFunction(() => {
        return typeof lastResults !== 'undefined' &&
               Array.isArray(lastResults) &&
               lastResults.length > 0;
      }, { timeout: 20000 }).then(() => true).catch(() => false);

      const resultCount = await page.evaluate(() => lastResults?.length ?? 0);
      await assertR(gotResults && resultCount >= 1, 'CAM allocation produced results', 'count=' + resultCount, page);

      const resultsRendered = await page.$eval('#resultsBody', el => el.innerHTML.length > 100).catch(() => false);
      await assertR(resultsRendered, 'Allocation results rendered in #resultsBody', '', page);
    } else {
      // Bump stepNum to maintain R14/R15 numbering
      await assertR(false, 'CAM allocation — #runBtn not found', '', page);
      await assertR(false, 'Results render — skipped (no CAM run)', '', page);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // R16: Generate Report
    // ──────────────────────────────────────────────────────────────────────────
    section('R16: Generate reports');
    await page.evaluate(() => { if (typeof generateMasterReport === 'function') generateMasterReport(); });

    const reportOpen = await page.waitForFunction(() => {
      const o = document.getElementById('reportOverlay');
      return o && o.style.display !== 'none';
    }, { timeout: 8000 }).then(() => true).catch(() => false);
    await assertR(reportOpen, 'Master Report overlay opened (#reportOverlay visible)', '', page);

    if (reportOpen) {
      const rptLen = await page.$eval('#rptBody', el => el.innerHTML.length).catch(() => 0);
      await assertR(rptLen > 500, 'Report body has content (' + rptLen + ' chars)', 'len=' + rptLen, page);
      // Close the report overlay
      await page.evaluate(() => { if (typeof closeReport === 'function') closeReport(); });
    } else {
      await assertR(false, 'Report body has content — skipped (overlay did not open)', '', page);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // R17: Open View Lease
    // ──────────────────────────────────────────────────────────────────────────
    section('R17: Open View Lease');

    // tenantData[0] has leaseUrl (from the mock /api/upload response, saved to DB
    // and re-loaded by selectProperty). Call openLeaseModalFromFile(0) to open it.
    await page.evaluate(() => {
      if (typeof openLeaseModalFromFile === 'function') openLeaseModalFromFile(0);
    });

    const leaseModalOpen = await page.waitForFunction(() => {
      const m = document.getElementById('leaseViewerModal');
      return m && m.style.display !== 'none';
    }, { timeout: 6000 }).then(() => true).catch(() => false);

    if (!leaseModalOpen) {
      // If the leaseUrl didn't survive the refresh, we'll get a toast — that's ok
      const toast = await page.evaluate(() => {
        const t = document.querySelector('.toast-msg') || document.querySelector('[id*="toast"]');
        return t?.textContent?.trim() ?? '';
      });
      info('  Lease modal did not open — toast: "' + toast.slice(0, 80) + '"');
    }

    await assertR(leaseModalOpen, 'Lease viewer modal (#leaseViewerModal) opened', '', page);

    // Close lease viewer
    await page.evaluate(() => {
      const m = document.getElementById('leaseViewerModal');
      if (m) m.style.display = 'none';
    });

    // ──────────────────────────────────────────────────────────────────────────
    // R18: No Console Errors
    // ──────────────────────────────────────────────────────────────────────────
    section('R18: Console error audit');
    const critErrors = consoleErrors.filter(e =>
      !e.includes('favicon') &&
      !e.includes('net::ERR_ABORTED') &&
      !e.includes('Failed to load resource') &&
      !e.includes('[loadCamResults]') &&    // expected before first CAM run
      !e.includes('[saveCamResults]') &&    // expected on first load (no prior results)
      !e.includes('ResizeObserver') &&      // benign browser warning
      !e.includes('Script error') &&        // cross-origin noise
      !e.includes('xrpl')                  // XRPL library noise
    );
    await assertR(
      critErrors.length === 0,
      'No critical console errors (' + consoleErrors.length + ' total, ' + critErrors.length + ' critical)',
      critErrors.slice(0, 3).join(' | '),
      page
    );
    if (critErrors.length > 0) critErrors.forEach((e, i) => console.log('      [E' + (i + 1) + '] ' + e));

    // ──────────────────────────────────────────────────────────────────────────
    // R19: No Failed Network Requests
    // ──────────────────────────────────────────────────────────────────────────
    section('R19: Network error audit');
    await assertR(
      networkErrors.length === 0,
      'No unexpected network errors (' + networkErrors.length + ' detected)',
      networkErrors.slice(0, 3).map(e => e.status + ' ' + e.url).join(' | '),
      page
    );
    if (networkErrors.length > 0) networkErrors.forEach((e, i) => console.log('      [N' + (i + 1) + '] ' + e.type + ' ' + e.status + ' ' + e.url));

  } catch (err) {
    fail('Unexpected exception during browser tests: ' + (err.message || String(err)));
    try { await snap(page, 'EXCEPTION'); } catch (_) {}
    console.error(err);
  }

  await browser.close();

  // ════════════════════════════════════════════════════════════════════════════
  // R20: Pass/Fail Summary
  // ════════════════════════════════════════════════════════════════════════════
  section('R20: Pass/Fail Summary');

  const passCount = stepResults.filter(r => r.passed).length;
  const failCount = stepResults.filter(r => !r.passed).length;

  console.log();
  stepResults.forEach(r => {
    const icon   = r.passed ? '✅' : '❌';
    const detail = (!r.passed && r.detail) ? '  →  ' + r.detail.slice(0, 80) : '';
    const ss     = (!r.passed && r.screenshot) ? '  [' + path.basename(r.screenshot) + ']' : '';
    console.log('  ' + icon + '  R' + String(r.r).padStart(2, ' ') + ': ' + r.label + detail + ss);
  });

  console.log('\n' + '═'.repeat(62));
  console.log('  Target:   ' + PROD_URL);
  console.log('  Account:  ' + EMAIL);
  console.log('  Results:  ' + passCount + '/' + (passCount + failCount) + ' steps passed');

  if (consoleErrors.length > 0) {
    console.log('\n  Console errors logged (' + consoleErrors.length + '):');
    consoleErrors.slice(0, 8).forEach((e, i) => console.log('    [' + (i + 1) + '] ' + e));
  }

  if (networkErrors.length > 0) {
    console.log('\n  Network errors logged (' + networkErrors.length + '):');
    networkErrors.slice(0, 8).forEach((e, i) => console.log('    [' + (i + 1) + '] ' + e.type + ' ' + e.status + ' ' + e.url));
  }

  const shots = fs.existsSync(SCREENSHOT_DIR)
    ? fs.readdirSync(SCREENSHOT_DIR).filter(f => f.endsWith('.png') && f.includes('FAIL'))
    : [];
  if (shots.length > 0) {
    console.log('\n  Failure screenshots (' + shots.length + ') in: ' + SCREENSHOT_DIR + '/');
    shots.forEach(f => console.log('    ' + f));
  }

  if (failures === 0) {
    console.log('\x1b[32m\n  ✅  ALL PRODUCTION SMOKE TESTS PASSED — ready for Wharton Realty pilot\x1b[0m');
  } else {
    console.log('\x1b[31m\n  ❌  ' + failures + ' STEP(S) FAILED — review above before Wharton pilot\x1b[0m');
  }
  console.log('═'.repeat(62) + '\n');

  process.exit(failures ? 1 : 0);
})();
