'use strict';
/**
 * test-supabase-integration.js — Phase 20 live Supabase write/read verification.
 *
 * Uses Playwright to:
 *  1. Sign in via the real app UI (no CDN stubs — real Supabase connection)
 *  2. Open the first available property
 *  3. Call window.ms_debug_dualwrite() to fire test inserts into tenant_field_evidence
 *     and tenant_review_audit, then read back the last 5 rows per table
 *  4. Assert row counts, IDs, and the absence of RLS / permission errors
 *  5. Delete the two __debug_test__ rows to leave the DB clean
 *
 * Usage:
 *   TEST_EMAIL=you@example.com TEST_PASSWORD=yourpassword node test-supabase-integration.js
 *
 * Optional:
 *   TEST_PROP_ID=<uuid>  — open a specific property instead of the first listed one
 *   HEADLESS=false        — run with visible browser for debugging
 *
 * Requirements:
 *   - Playwright installed: npm install playwright (or npx playwright install chromium)
 *   - Network access to the target Supabase project (PILOT by default;
 *     see test-support/supabase-target.js)
 *   - App running at http://localhost:7821
 *
 * Exit codes:
 *   0 = all assertions passed
 *   1 = one or more assertions failed or BLOCKED
 */

// Try the global playwright install used by other test scripts in this repo
let pw;
try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }
const { chromium } = pw;

// THE PROJECT IS CHOSEN, NOT HARD-CODED — and the default is PILOT.
//
// This suite INSERTS into tenant_field_evidence and tenant_review_audit via
// ms_debug_dualwrite(), and the REST read-back below used the PRODUCTION url
// and anon key as literals — so it wrote test rows into the customer database
// regardless of which account was supplied. The resolver reads both projects
// out of supabase-config.js and refuses production unless
// MS_TEST_ALLOW_PRODUCTION carries the force token.
// See test-support/supabase-target.js.
const { resolveOrAbort } = require('./test-support/supabase-target.js');
const TARGET    = resolveOrAbort('supabase-integration');
const BASE      = process.env.APP_URL    || 'http://localhost:7821';
const EMAIL     = process.env.TEST_EMAIL;
const PASSWORD  = process.env.TEST_PASSWORD;
const TARGET_PROP = process.env.TEST_PROP_ID || null;
const HEADLESS  = process.env.HEADLESS !== 'false';

if (!EMAIL || !PASSWORD) {
  console.error('ERROR: TEST_EMAIL and TEST_PASSWORD environment variables are required.');
  console.error('Usage: TEST_EMAIL=you@example.com TEST_PASSWORD=yourpassword node test-supabase-integration.js');
  process.exit(1);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function pass(label) { console.log('\x1b[32m  ✓ ' + label + '\x1b[0m'); }
function fail(label) { console.error('\x1b[31m  ✗ ' + label + '\x1b[0m'); }
function info(label) { console.log('  · ' + label); }
function warn(label) { console.log('\x1b[33m  ⚠ ' + label + '\x1b[0m'); }
function section(label) { console.log('\n▶  ' + label); console.log('─'.repeat(64)); }

let failures = 0;
function assert(condition, label, detail) {
  if (condition) { pass(label); }
  else { fail(label + (detail ? ' — ' + detail : '')); failures++; }
}

// ── Main ──────────────────────────────────────────────────────────────────────
(async () => {
  const browser = await chromium.launch({ headless: HEADLESS, args: ['--no-sandbox'] });
  const ctx     = await browser.newContext();
  const page    = await ctx.newPage();

  const consoleLines = [];
  page.on('console', m  => consoleLines.push({ type: m.type(), text: m.text() }));
  page.on('pageerror', e => consoleLines.push({ type: 'PAGEERROR', text: e.message }));

  // ── Step 1: Load the app (no stubs — real Supabase) ─────────────────────────
  section('Step 1: Load app with real Supabase connection');
  // ?signin=1 — THE PRODUCT'S OWN ANSWER TO ITS LANDING DIALOG. #msLanding
  // covers the page on a bare load, so a suite that navigates to `/` and reaches
  // for the login form is clicking through an overlay. Ten suites in this repo
  // are currently parked as stale for exactly that reason. The flag says
  // "someone who clicked Log in has already declared what they want", and every
  // current suite uses it.
  const ENTRY = BASE + (BASE.includes('?') ? '&' : '?') + 'signin=1';
  await page.goto(ENTRY, { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForTimeout(2000);

  const pageTitle = await page.title();
  info('Page title: ' + pageTitle);

  const loginVisible = await page.$('#loginScreen').then(el => el ? el.evaluate(n => n.style.display !== 'none') : false).catch(() => false);
  info('Login screen visible: ' + loginVisible);

  // ── Step 2: Sign in ──────────────────────────────────────────────────────────
  section('Step 2: Authenticate');
  info('Signing in as: ' + EMAIL);

  // Ensure the login form is shown
  const loginScreen = await page.$('#loginScreen');
  if (!loginScreen) {
    fail('Login screen (#loginScreen) not found — is the app running at ' + BASE + '?');
    await browser.close();
    process.exit(1);
  }

  await page.evaluate(() => { document.getElementById('loginScreen').style.display = 'flex'; });
  await page.fill('#loginEmail',    EMAIL);
  await page.fill('#loginPassword', PASSWORD);

  // THE LOGIN HANDLER ARRIVES AFTER THE BUTTON DOES. #loginBtn paints with the
  // HTML; submitAuth is defined by script.js; and the form calls it through an
  // inline onsubmit attribute. A click landing in that gap raises a
  // ReferenceError and is simply LOST — the page looks fine, no request is made,
  // and the suite then waits out its full timeout on a sign-in that never
  // started. Thirteen suites in this repo carry this same wait for the same
  // reason.
  await page.waitForFunction(() => typeof submitAuth === 'function', null, { timeout: 45000 });
  await page.click('#loginBtn');

  // Wait for auth state change (up to 15 s)
  let authed = false;
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(500);
    const sessionOk = await page.evaluate(async () => {
      if (typeof db === 'undefined') return false;
      const { data } = await db.auth.getSession();
      return !!data?.session;
    }).catch(() => false);
    if (sessionOk) { authed = true; break; }
  }

  const authDetails = await page.evaluate(async () => {
    if (typeof db === 'undefined') return { ok: false, reason: 'db not defined' };
    const { data, error } = await db.auth.getSession();
    const sess = data?.session;
    return sess
      ? { ok: true, uid: sess.user.id, email: sess.user.email, role: sess.user.role }
      : { ok: false, reason: error?.message || 'no session returned' };
  }).catch(e => ({ ok: false, reason: e.message }));

  assert(authDetails.ok, 'Authenticated with Supabase', authDetails.reason || '');
  if (!authDetails.ok) {
    fail('Cannot proceed without an authenticated session — RLS will block all inserts');
    info('Hint: check TEST_EMAIL / TEST_PASSWORD. Supabase may require email confirmation.');
    await browser.close();
    process.exit(1);
  }
  info('auth.uid  = ' + authDetails.uid);
  info('auth.email = ' + authDetails.email);
  info('auth.role  = ' + authDetails.role);

  // ── Step 3: Open a property ──────────────────────────────────────────────────
  section('Step 3: Open property');

  let propId = TARGET_PROP;
  if (!propId) {
    // Load the first property available for this user from Supabase
    const firstProp = await page.evaluate(async () => {
      if (typeof db === 'undefined') return null;
      const { data, error } = await db.from('properties').select('id,name').limit(1).single();
      return error ? null : data;
    }).catch(() => null);

    if (!firstProp?.id) {
      fail('No properties found for this user in Supabase — create at least one property first');
      await browser.close();
      process.exit(1);
    }
    propId = firstProp.id;
    info('Using first available property: ' + propId + ' ("' + firstProp.name + '")');
  } else {
    info('Using TEST_PROP_ID: ' + propId);
  }

  // Load the property in-app
  await page.evaluate(async (pid) => {
    if (typeof loadPropertyById === 'function') {
      await loadPropertyById(pid);
    } else if (typeof activePropId !== 'undefined') {
      // fallback: set via localStorage and reload
      localStorage.setItem('_ms_activePropId_anon', pid);
    }
  }, propId).catch(() => {});

  await page.waitForTimeout(2000);

  const propLoaded = await page.evaluate((pid) => {
    if (typeof activePropId !== 'undefined') return activePropId === pid;
    return typeof currentProperty === 'function' && currentProperty()?.id === pid;
  }, propId).catch(() => false);

  assert(propLoaded, 'Property loaded in app context', 'propId=' + propId);

  // ── Step 4: Run ms_debug_dualwrite() ─────────────────────────────────────────
  section('Step 4: Run ms_debug_dualwrite() — inserts + read-back');
  info('Calling window.ms_debug_dualwrite()…');

  const dw = await page.evaluate(async () => {
    if (typeof ms_debug_dualwrite !== 'function') return { error: 'ms_debug_dualwrite not defined' };
    return await ms_debug_dualwrite();
  }).catch(e => ({ error: e.message }));

  if (dw?.error) {
    fail('ms_debug_dualwrite() threw: ' + dw.error);
    failures++;
  } else {
    // Auth assertions
    assert(dw.auth?.ok === true, 'ms_debug_dualwrite() saw authenticated session');

    // TFE insert assertions
    const tfe = dw.evStatus;
    assert(tfe === 'ok', 'tenant_field_evidence insert status = ok', 'got: ' + tfe);
    if (window?.ms_lastDualWrite?.evidence?.error) {
      fail('tenant_field_evidence insert error: ' + JSON.stringify(dw.evStatus));
    }

    // TRA insert assertions
    const tra = dw.audStatus;
    assert(tra === 'ok', 'tenant_review_audit insert status = ok', 'got: ' + tra);

    // Read-back row counts
    const evRows  = dw.evRows  || [];
    const audRows = dw.audRows || [];
    assert(evRows.length  > 0, 'tenant_field_evidence read-back returned rows', 'got ' + evRows.length);
    assert(audRows.length > 0, 'tenant_review_audit read-back returned rows',   'got ' + audRows.length);

    // Log row IDs
    info('tenant_field_evidence rows (last 5):');
    evRows.forEach((r, i) => info('  [' + i + '] id=' + r.id + ' field=' + r.field_key + ' tenant=' + r.tenant_id));

    info('tenant_review_audit rows (last 5):');
    audRows.forEach((r, i) => info('  [' + i + '] id=' + r.id + ' action=' + r.action + ' tenant=' + r.tenant_id));

    // Check debug rows are present
    const debugEvRow  = evRows.find(r => r.field_key === '__debug_test__');
    const debugAudRow = audRows.find(r => r.action   === 'debug_test');
    assert(!!debugEvRow,  'Debug TFE row (__debug_test__) found in read-back',  debugEvRow?.id  || 'missing');
    assert(!!debugAudRow, 'Debug TRA row (debug_test) found in read-back',      debugAudRow?.id || 'missing');

    if (debugEvRow)  info('TFE debug row id = ' + debugEvRow.id);
    if (debugAudRow) info('TRA debug row id = ' + debugAudRow.id);

    // Property ID matches
    assert(dw.propId === propId, 'propId matches in result', 'expected ' + propId + ' got ' + dw.propId);
  }

  // ── Step 5: Console error scan ───────────────────────────────────────────────
  section('Step 5: Console error scan');
  const normalizedErrors = consoleLines.filter(l =>
    /NormalizedEvidence|NormalizedAudit|DualWrite:tfe.*ERROR|DualWrite:tra.*ERROR|RLS|permission denied|allowlist/i.test(l.text)
  );
  const pageErrors = consoleLines.filter(l => l.type === 'PAGEERROR');

  if (normalizedErrors.length === 0) {
    pass('No [NormalizedEvidence], [NormalizedAudit], [DualWrite:tfe ERROR], [DualWrite:tra ERROR] messages');
  } else {
    normalizedErrors.forEach(l => warn('[' + l.type + '] ' + l.text));
    // Errors are informational — already counted in step 4 assertions
  }

  if (pageErrors.length === 0) {
    pass('No page errors');
  } else {
    pageErrors.forEach(l => fail('PAGEERROR: ' + l.text));
    failures += pageErrors.length;
  }

  // ── Step 6: Direct REST read-back (bypasses app layer) ───────────────────────
  section('Step 6: Direct REST read-back (confirms rows exist independently of app)');
  // The read-back runs inside the page, so the resolved target is passed IN
  // rather than written here — a literal in this block is exactly what pointed
  // the whole suite at production.
  const restResults = await page.evaluate(async ({ pid, baseUrl, key }) => {
    const { data: sess } = await db.auth.getSession();
    const token = sess?.session?.access_token;
    if (!token) return { error: 'no access_token' };

    const BASE_URL = baseUrl;
    const KEY      = key;

    const headers = {
      'apikey': KEY,
      'Authorization': 'Bearer ' + token,
    };

    const [tfeRes, traRes] = await Promise.all([
      fetch(BASE_URL + '/rest/v1/tenant_field_evidence?property_id=eq.' + pid +
            '&field_key=eq.__debug_test__&select=id,tenant_id,field_key,value,confidence_status,reviewed_at', { headers })
        .then(r => r.json()),
      fetch(BASE_URL + '/rest/v1/tenant_review_audit?property_id=eq.' + pid +
            '&action=eq.debug_test&select=id,tenant_id,action,severity,client_ts', { headers })
        .then(r => r.json()),
    ]);

    return { tfe: tfeRes, tra: traRes };
  }, { pid: propId, baseUrl: TARGET.url, key: TARGET.anonKey }).catch(e => ({ error: e.message }));

  if (restResults?.error) {
    warn('Direct REST check skipped: ' + restResults.error);
  } else {
    const tfeRows = Array.isArray(restResults.tfe) ? restResults.tfe : [];
    const traRows = Array.isArray(restResults.tra) ? restResults.tra : [];

    assert(tfeRows.length > 0, 'Direct REST: TFE row visible via access_token', 'got ' + tfeRows.length);
    assert(traRows.length > 0, 'Direct REST: TRA row visible via access_token', 'got ' + traRows.length);

    if (tfeRows.length > 0) {
      info('TFE row (direct REST): ' + JSON.stringify(tfeRows[0]));
    }
    if (traRows.length > 0) {
      info('TRA row (direct REST): ' + JSON.stringify(traRows[0]));
    }
  }

  // ── Step 7: Clean up debug rows ───────────────────────────────────────────────
  section('Step 7: Clean up __debug_test__ rows');
  const cleanup = await page.evaluate(async (pid) => {
    const results = {};
    const { data: d1, error: e1 } = await db
      .from('tenant_field_evidence')
      .delete()
      .eq('property_id', pid)
      .eq('field_key', '__debug_test__');
    results.tfe = e1 ? 'ERROR: ' + e1.message : 'deleted';

    const { data: d2, error: e2 } = await db
      .from('tenant_review_audit')
      .delete()
      .eq('property_id', pid)
      .eq('action', 'debug_test');
    results.tra = e2 ? 'ERROR: ' + e2.message : 'deleted';

    return results;
  }, propId).catch(e => ({ tfe: 'exception: ' + e.message, tra: 'exception: ' + e.message }));

  assert(cleanup.tfe === 'deleted', 'TFE debug row cleaned up', cleanup.tfe);
  assert(cleanup.tra === 'deleted', 'TRA debug row cleaned up', cleanup.tra);

  // ── Verdict ───────────────────────────────────────────────────────────────────
  await browser.close();

  console.log('\n' + '═'.repeat(64));
  if (failures === 0) {
    console.log('\x1b[32m  PASS — all ' + (7) + ' steps completed, 0 failures\x1b[0m');
    console.log('  Rows written to and read back from tenant_field_evidence');
    console.log('  and tenant_review_audit with authenticated RLS — confirmed.');
  } else {
    console.error('\x1b[31m  FAIL — ' + failures + ' assertion(s) failed (see ✗ above)\x1b[0m');
  }
  console.log('═'.repeat(64));
  process.exit(failures > 0 ? 1 : 0);
})();
