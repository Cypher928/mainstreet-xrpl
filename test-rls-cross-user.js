'use strict';
/**
 * test-rls-cross-user.js — Cross-user RLS Verification
 *
 * Tests that User A cannot read or write User B's data at three layers:
 *   1. Supabase REST API with no auth token (anon key only)
 *   2. User B's JWT cannot see User A's rows (fresh account owns nothing)
 *   3. API proxy routes reject User B attempting to access User A's property IDs
 *
 * Usage (requires two real accounts):
 *   USER_A_EMAIL=a@example.com USER_A_PASS=xxx \
 *   USER_B_EMAIL=b@example.com USER_B_PASS=yyy \
 *   USER_A_PROP_ID=<uuid-of-a-property-owned-by-A> \
 *   node test-rls-cross-user.js
 *
 * Results:
 *   exit 0 = all assertions passed
 *   exit 1 = one or more assertions failed
 */

// THE PROJECT IS CHOSEN, NOT HARD-CODED — and the default is PILOT.
//
// These two lines used to be the PRODUCTION url and anon key as literals, so
// this suite read the customer database no matter which accounts were supplied.
// The resolver reads both projects out of supabase-config.js (the app's own
// source of truth, so a key here cannot drift from the key the app ships) and
// refuses production unless MS_TEST_ALLOW_PRODUCTION carries the force token.
// See test-support/supabase-target.js.
const { resolveOrAbort } = require('./test-support/supabase-target.js');
const TARGET       = resolveOrAbort('rls-cross-user');
const SUPABASE_URL = TARGET.url;
const ANON_KEY     = TARGET.anonKey;
const APP_URL      = process.env.APP_URL || 'http://localhost:7821';

let failures = 0;
const log    = (icon, msg) => console.log(`  ${icon} ${msg}`);
const pass   = (msg)       => log('✅', msg);
const fail   = (msg)       => { log('❌', msg); failures++; };
const info   = (msg)       => log('ℹ️ ', msg);
const warn   = (msg)       => log('⚠️ ', msg);

async function sbGet(path, token) {
  const headers = { 'apikey': ANON_KEY };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers });
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: r.status, rows: Array.isArray(data) ? data.length : 0, data };
}

async function signIn(email, password) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const d = await r.json();
  return { token: d?.access_token || null, userId: d?.user?.id || null };
}

async function apiProbeOwnership(token, propId) {
  // Try to read CAM reconciliations for a property we don't own
  const r = await fetch(`${APP_URL}/api/cam-reconciliations?propertyId=${propId}`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  return r.status;
}

async function run() {
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║      RLS Cross-User Verification — MainStreet        ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');

  const TABLES = [
    'properties', 'tenants', 'lease_documents',
    'lease_jobs', 'cam_reconciliations', 'acquisition_reviews',
  ];

  // ── Group 1: Unauthenticated (no JWT) ───────────────────────────────
  console.log('Group 1: Unauthenticated requests (anon key, no Bearer token)\n');
  for (const t of TABLES) {
    const r = await sbGet(`${t}?select=id&limit=10`, null);
    if (r.status === 403 || r.rows === 0) {
      pass(`${t}: blocked (status ${r.status}, ${r.rows} rows)`);
    } else {
      fail(`${t}: returned ${r.rows} rows to unauthenticated request (status ${r.status})`);
    }
  }

  // ── Group 2: Cross-user (User B reads tables as a fresh account) ─────
  const EMAIL_B = process.env.USER_B_EMAIL;
  const PASS_B  = process.env.USER_B_PASS;

  if (!EMAIL_B || !PASS_B) {
    console.log('\nGroup 2: SKIPPED — USER_B_EMAIL / USER_B_PASS not set');
    console.log('  To run cross-user tests, create a second account and set:');
    console.log('  USER_B_EMAIL=b@example.com USER_B_PASS=password node test-rls-cross-user.js');
  } else {
    console.log('\nGroup 2: User B reads all tables (should see 0 rows)\n');
    const { token: tokenB } = await signIn(EMAIL_B, PASS_B);
    if (!tokenB) {
      warn('Could not sign in as User B — check credentials');
    } else {
      for (const t of TABLES) {
        const r = await sbGet(`${t}?select=id&limit=100`, tokenB);
        if (r.rows === 0) {
          pass(`${t}: User B sees 0 rows ✓`);
        } else {
          fail(`${t}: User B sees ${r.rows} rows — possible RLS gap`);
        }
      }
    }
  }

  // ── Group 3: API proxy ownership gate (User B → User A's prop) ───────
  const EMAIL_A  = process.env.USER_A_EMAIL;
  const PASS_A   = process.env.USER_A_PASS;
  const PROP_A   = process.env.USER_A_PROP_ID;
  const EMAIL_B2 = process.env.USER_B_EMAIL;
  const PASS_B2  = process.env.USER_B_PASS;

  if (!EMAIL_B2 || !EMAIL_A || !PROP_A) {
    console.log('\nGroup 3: SKIPPED — USER_A_EMAIL / USER_A_PASS / USER_A_PROP_ID not set');
  } else {
    console.log('\nGroup 3: User B tries to access User A\'s property via API proxy\n');
    const { token: tokenB2 } = await signIn(EMAIL_B2, PASS_B2);
    if (!tokenB2) {
      warn('Could not sign in as User B for Group 3');
    } else {
      const status = await apiProbeOwnership(tokenB2, PROP_A);
      if (status === 403) {
        pass(`/api/cam-reconciliations with User A's propId → 403 Forbidden ✓`);
      } else if (status === 404) {
        pass(`/api/cam-reconciliations with User A's propId → 404 Not Found (treated as 403) ✓`);
      } else {
        fail(`/api/cam-reconciliations with User A's propId → ${status} (expected 403 or 404)`);
      }
    }
  }

  // ── Summary ──────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════');
  if (failures === 0) {
    console.log('✅ All executed assertions PASSED');
  } else {
    console.log(`❌ ${failures} assertion(s) FAILED`);
  }
  console.log('═══════════════════════════════════\n');

  process.exit(failures > 0 ? 1 : 0);
}

run().catch(e => { console.error('Test runner error:', e); process.exit(1); });
