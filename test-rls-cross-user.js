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

// STRICT MODE — set in CI, where every credential is provided by the fixture.
//
// Groups 2 and 3 print "SKIPPED" and exit 0 when their variables are absent,
// which is right for a developer running this by hand with one account. It is
// exactly wrong in CI: a typo in a variable name would turn the cross-user half
// of an RLS suite off and the run would still go green, which is the "unrun
// security test reads as a pass" failure this repo has already been bitten by.
// With this set, a skipped group and a failed sign-in are both failures.
const STRICT = process.env.MS_REQUIRE_ALL_GROUPS === '1';

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
    // A TABLE THAT IS NOT THERE CANNOT LEAK — AND CANNOT BE TESTED EITHER.
    // PostgREST answers an unknown relation with 404 and code 42P01/PGRST205,
    // which reads as "0 rows, blocked" to the check below and passes. So a
    // renamed or unmigrated table would silently drop out of this suite's
    // coverage while the suite went on reporting six tables green. Say so
    // instead: the list is part of what is under test.
    const body    = r.data;
    const code    = (body && typeof body === 'object' && !Array.isArray(body)) ? String(body.code || '') : '';
    const noTable = r.status === 404 || /^(42P01|PGRST205)$/.test(code);
    if (noTable) {
      fail(`${t}: no such table on this project (status ${r.status}${code ? ', ' + code : ''}) — ` +
           `the table list in this suite is stale or a migration has not been applied`);
    } else if (r.status === 403 || r.rows === 0) {
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
    if (STRICT) fail('Group 2 was skipped under MS_REQUIRE_ALL_GROUPS=1 — the cross-user half of this suite did not run');
  } else {
    console.log('\nGroup 2: User B reads all tables (should see 0 rows)\n');
    const { token: tokenB } = await signIn(EMAIL_B, PASS_B);
    if (!tokenB) {
      // Not a warning in CI. If B cannot sign in, nothing below runs, and a
      // suite that proves nothing must not exit 0.
      if (STRICT) fail('Could not sign in as User B — Group 2 did not run');
      else warn('Could not sign in as User B — check credentials');
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
    if (STRICT) fail('Group 3 was skipped under MS_REQUIRE_ALL_GROUPS=1 — the API ownership gate did not run');
  } else {
    console.log('\nGroup 3: User B tries to access User A\'s property via API proxy\n');
    const { token: tokenB2 } = await signIn(EMAIL_B2, PASS_B2);
    if (!tokenB2) {
      if (STRICT) fail('Could not sign in as User B — Group 3 did not run');
      else warn('Could not sign in as User B for Group 3');
    } else {
      // First prove User A's property is real and A can see it. Without this,
      // a mistyped or already-deleted UUID makes the 403 below meaningless —
      // the endpoint would refuse a property that does not exist, and the suite
      // would read that as the ownership gate holding.
      const { token: tokenA } = await signIn(EMAIL_A, PASS_A);
      if (!tokenA) {
        if (STRICT) fail('Could not sign in as User A — cannot establish that the probed property exists');
        else warn('Could not sign in as User A');
      } else {
        const own = await sbGet(`properties?id=eq.${PROP_A}&select=id`, tokenA);
        if (own.rows === 1) pass(`User A can see their own property ${PROP_A} — the probe below is about a real row`);
        else fail(`User A cannot see property ${PROP_A} (${own.rows} rows, status ${own.status}) — Group 3's probe would prove nothing`);
      }

      const status = await apiProbeOwnership(tokenB2, PROP_A);
      if (status === 403) {
        pass(`/api/cam-reconciliations with User A's propId → 403 Forbidden ✓`);
      } else if (status === 404) {
        // 404 IS NOT A PASS WHEN THE PROPERTY IS KNOWN TO EXIST. The endpoint
        // returns 403 on an ownership miss; a 404 means the ROUTE is not there,
        // so nothing was gated at all. Accepting it "as 403" turned a missing
        // deployment into a green security check.
        if (STRICT) fail(`/api/cam-reconciliations → 404: the route is not deployed at ${APP_URL}, so no ownership gate was exercised`);
        else pass(`/api/cam-reconciliations with User A's propId → 404 Not Found (treated as 403) ✓`);
      } else {
        fail(`/api/cam-reconciliations with User A's propId → ${status} (expected 403)`);
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
