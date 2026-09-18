'use strict';
/**
 * test-rls-cross-user.js — Cross-user RLS Verification
 *
 * Tests that User A cannot read or write User B's data at three layers:
 *   1. Supabase REST API with no auth token (anon key only)
 *   2. User B's JWT cannot see User A's rows (fresh account owns nothing)
 *   3. API proxy routes reject User B attempting to access User A's property IDs
 *
 * And, since P0.1 (organisations — migration 024), the boundary the other way:
 *   4. C, an ACTIVE member of A's organisation, sees A's rows; D, a REVOKED
 *      member, sees none; revoking C removes access on the very next read;
 *      and a storage object is reached only through the document register —
 *      knowing its path grants nothing to C, D or B at the storage layer.
 *
 * Usage (requires two real accounts; four and a registered document for Group 4):
 *   USER_A_EMAIL=a@example.com USER_A_PASS=xxx \
 *   USER_B_EMAIL=b@example.com USER_B_PASS=yyy \
 *   USER_A_PROP_ID=<uuid-of-a-property-owned-by-A> \
 *   [ORG_FIXTURE=present USER_C_EMAIL/PASS USER_D_EMAIL/PASS USER_A_ORG_ID USER_A_DOC_ID USER_A_DOC_REF] \
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

async function apiDocumentUrl(token, body) {
  const r = await fetch(`${APP_URL}/api/document-url`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return r.status;
}

// A direct storage read with a USER token — the layer api/document-url does
// not sit in front of. Migration 024's storage policies decide this one.
async function storageDirect(token, ref) {
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/authenticated/${ref}`, {
    headers: { 'apikey': ANON_KEY, 'Authorization': `Bearer ${token}` },
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

  // ── Group 4: organisations (P0.1) — the boundary the other way ───────
  //
  // C is an ACTIVE member of A's organisation; D is a REVOKED one. A's property
  // has one REGISTERED document whose object sits under A's uid (the legacy
  // path shape). Three layers, each proved directly:
  //
  //   RLS      C reads A's rows; D and B read none (the same tables as Group 2)
  //   revoke   with the service-role key, C is revoked and re-read: 0 rows,
  //            on the very next request — then reinstated
  //   storage  a direct object read with a user token: A yes; C, D, B no.
  //            The path is an address, not a grant, at the storage layer too
  //   API      D and B get 403 from the deployed routes on either build; C's
  //            200 is asserted only once the deployment carries P0.1
  //            (ORG_API_DEPLOYED=1) and reported as information until then
  const ORG = process.env.ORG_FIXTURE;
  const EMAIL_C = process.env.USER_C_EMAIL, PASS_C = process.env.USER_C_PASS;
  const EMAIL_D = process.env.USER_D_EMAIL, PASS_D = process.env.USER_D_PASS;
  const ORG_A   = process.env.USER_A_ORG_ID;
  const DOC_ID  = process.env.USER_A_DOC_ID;
  const DOC_REF = process.env.USER_A_DOC_REF;
  const API_HAS_P01 = process.env.ORG_API_DEPLOYED === '1';
  const SERVICE_KEY = (process.env.PILOT_SUPABASE_SERVICE_ROLE_KEY || '').trim();

  if (ORG === 'absent') {
    // Not a pass and not a failure: a fact about this project, stated where
    // CI annotations will show it. The fixture asked the database and the
    // membership table is not there, so there is no boundary to test yet.
    console.log('\nGroup 4: NOT RUN — migration 024 (organisations) is not applied to this project');
    console.log('  The organisation boundary is unverified live until 024 is applied to pilot and this gate re-runs.');
    if (process.env.GITHUB_ACTIONS) console.log('::warning::Group 4 (organisations) did not run: migration 024 is not applied to the pilot project');
  } else if (ORG !== 'present' || !EMAIL_C || !PASS_C || !EMAIL_D || !PASS_D || !ORG_A || !DOC_ID || !DOC_REF || !PROP_A || !EMAIL_A) {
    console.log('\nGroup 4: SKIPPED — organisation fixture variables not set (ORG_FIXTURE, USER_C_*, USER_D_*, USER_A_ORG_ID, USER_A_DOC_ID, USER_A_DOC_REF)');
    if (STRICT) fail('Group 4 was skipped under MS_REQUIRE_ALL_GROUPS=1 — the fixture did not report the organisation world');
  } else {
    console.log('\nGroup 4: Organisations — an active member sees A\'s rows, a revoked member sees none, a path is not a grant\n');
    const { token: tokenA4, userId: uidA } = await signIn(EMAIL_A, PASS_A);
    const { token: tokenB4 } = await signIn(EMAIL_B2, PASS_B2);
    const { token: tokenC, userId: uidC } = await signIn(EMAIL_C, PASS_C);
    const { token: tokenD } = await signIn(EMAIL_D, PASS_D);
    if (!tokenA4 || !tokenB4 || !tokenC || !tokenD) {
      fail(`Could not sign in as every Group 4 account (A:${!!tokenA4} B:${!!tokenB4} C:${!!tokenC} D:${!!tokenD}) — Group 4 did not run`);
    } else {
      // The fixture must be what it claims, or every assertion below is about nothing.
      const orgRow = await sbGet(`properties?id=eq.${PROP_A}&select=id,organization_id`, tokenA4);
      const orgOnProp = orgRow.rows === 1 && orgRow.data[0].organization_id;
      if (orgOnProp === ORG_A) pass(`A's property carries organisation ${ORG_A} — the fixture is real`);
      else fail(`A's property does not carry the fixture organisation (got ${JSON.stringify(orgRow.data)})`);

      // ── RLS: what each account sees of A's property, per table ─────────
      const SCOPED = [
        ['properties',      `properties?id=eq.${PROP_A}&select=id`],
        ['tenants',         `tenants?property_id=eq.${PROP_A}&select=id`],
        ['lease_documents', `lease_documents?property_id=eq.${PROP_A}&select=id`],
      ];
      for (const [t, q] of SCOPED) {
        const c = await sbGet(q, tokenC);
        if (c.rows >= 1) pass(`${t}: C (active member) sees A's ${c.rows} row(s) ✓`);
        else fail(`${t}: C, an active member of A's organisation, sees 0 rows (status ${c.status}) — membership grants nothing`);
        const d = await sbGet(q, tokenD);
        if (d.rows === 0) pass(`${t}: D (revoked) sees 0 rows ✓`);
        else fail(`${t}: D, REVOKED, sees ${d.rows} row(s) — revocation is not enforced by RLS`);
        const b = await sbGet(q, tokenB4);
        if (b.rows === 0) pass(`${t}: B (no membership) still sees 0 rows ✓`);
        else fail(`${t}: B sees ${b.rows} row(s) after 024 — the rewrite widened access`);
      }
      const orgsC = await sbGet(`organizations?id=eq.${ORG_A}&select=id`, tokenC);
      if (orgsC.rows === 1) pass('organizations: C can see the organisation they belong to ✓');
      else fail(`organizations: C cannot see their own organisation (${orgsC.rows} rows, status ${orgsC.status})`);
      const orgsD = await sbGet(`organizations?id=eq.${ORG_A}&select=id`, tokenD);
      if (orgsD.rows === 0) pass('organizations: D (revoked) cannot see it ✓');
      else fail(`organizations: D, revoked, sees the organisation (${orgsD.rows} rows)`);
      const memC = await sbGet(`organization_members?organization_id=eq.${ORG_A}&select=id`, tokenC);
      if (memC.rows >= 2) pass(`organization_members: C sees the organisation's roster (${memC.rows} rows) ✓`);
      else fail(`organization_members: C sees ${memC.rows} roster row(s) — expected the whole organisation`);
      const memB = await sbGet(`organization_members?organization_id=eq.${ORG_A}&select=id`, tokenB4);
      if (memB.rows === 0) pass('organization_members: B sees none of it ✓');
      else fail(`organization_members: B sees ${memB.rows} row(s) of an organisation they are not in`);

      // A member may READ but the with-check must stop them re-homing the
      // property to an organisation they choose. A write with a USER token.
      const rehome = await fetch(`${SUPABASE_URL}/rest/v1/properties?id=eq.${PROP_A}`, {
        method: 'PATCH',
        headers: { 'apikey': ANON_KEY, 'Authorization': `Bearer ${tokenC}`, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
        body: JSON.stringify({ organization_id: '00000000-0000-4000-8000-000000000000' }),
      });
      const rehomed = await sbGet(`properties?id=eq.${PROP_A}&select=organization_id`, tokenA4);
      if (rehomed.rows === 1 && rehomed.data[0].organization_id === ORG_A) pass(`a member cannot move A's property to another organisation (PATCH → ${rehome.status}, organisation unchanged) ✓`);
      else fail(`a member MOVED A's property to another organisation (PATCH → ${rehome.status}, now ${JSON.stringify(rehomed.data)})`);

      // ── Revocation is immediate ────────────────────────────────────────
      if (!SERVICE_KEY) {
        warn('PILOT_SUPABASE_SERVICE_ROLE_KEY not set — the live revoke/reinstate check did not run');
        if (STRICT) fail('the live revocation check needs the fixture service-role key and it is absent');
      } else if (!/^plci-.*@pilot\.invalid$/.test(EMAIL_C)) {
        fail(`refusing to revoke ${EMAIL_C}: not a disposable fixture account`);
      } else {
        const patchC = (body) => fetch(`${SUPABASE_URL}/rest/v1/organization_members?organization_id=eq.${ORG_A}&user_id=eq.${uidC}`, {
          method: 'PATCH',
          headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
          body: JSON.stringify(body),
        });
        const before = await sbGet(`properties?id=eq.${PROP_A}&select=id`, tokenC);
        const rv = await patchC({ revoked_at: new Date().toISOString() });
        const during = await sbGet(`properties?id=eq.${PROP_A}&select=id`, tokenC);
        const apiDuring = await apiProbeOwnership(tokenC, PROP_A);
        const rs = await patchC({ revoked_at: null });
        const after = await sbGet(`properties?id=eq.${PROP_A}&select=id`, tokenC);
        if (!rv.ok || !rs.ok) fail(`could not revoke/reinstate C with the service role (${rv.status}/${rs.status})`);
        if (before.rows === 1 && during.rows === 0) pass('revoking C removes their read on the VERY NEXT request — no cached grant ✓');
        else fail(`revocation is not immediate: before=${before.rows} during=${during.rows}`);
        if (apiDuring === 403) pass('and the API refuses the revoked member in the same instant (403) ✓');
        else fail(`the API answered ${apiDuring} to a just-revoked member (expected 403)`);
        if (after.rows === 1) pass('reinstating C restores the read on the next request ✓');
        else fail(`reinstatement did not take: after=${after.rows}`);
      }

      // ── Storage: a path is an address, not a grant ─────────────────────
      const sA = await storageDirect(tokenA4, DOC_REF);
      if (sA === 200) pass('storage: the owner reads their own object directly ✓');
      else fail(`storage: the owner cannot read their own object directly (${sA}) — the uid shape is broken`);
      for (const [who, tok] of [['C (active member)', tokenC], ['D (revoked)', tokenD], ['B (stranger)', tokenB4]]) {
        const s = await storageDirect(tok, DOC_REF);
        if (s !== 200) pass(`storage: ${who} knowing the path gets ${s}, not the object ✓`);
        else fail(`storage: ${who} read A's object DIRECTLY by path — a path is being treated as a grant`);
      }

      // ── The API gate ───────────────────────────────────────────────────
      const apiD = await apiProbeOwnership(tokenD, PROP_A);
      if (apiD === 403) pass('/api/cam-reconciliations: D (revoked) → 403 ✓');
      else fail(`/api/cam-reconciliations: D (revoked) → ${apiD} (expected 403)`);
      const docD = await apiDocumentUrl(tokenD, { documentId: DOC_ID });
      const docB = await apiDocumentUrl(tokenB4, { documentId: DOC_ID });
      const refB = await apiDocumentUrl(tokenB4, { ref: DOC_REF });
      if (docD !== 200 && docB !== 200 && refB !== 200) pass(`/api/document-url: D and B are refused by id (${docD}, ${docB}) and by path (${refB}) ✓`);
      else fail(`/api/document-url minted for someone it must not: D=${docD} B=${docB} B-by-path=${refB}`);
      const refA = await apiDocumentUrl(tokenA4, { ref: DOC_REF });
      if (refA === 200) pass('/api/document-url: the owner gets a signed URL for their own path ✓');
      else fail(`/api/document-url: the owner was refused their own document (${refA})`);

      const apiC = await apiProbeOwnership(tokenC, PROP_A);
      const docC = await apiDocumentUrl(tokenC, { documentId: DOC_ID });
      if (API_HAS_P01) {
        if (apiC === 200) pass('/api/cam-reconciliations: C (active member) → 200 ✓');
        else fail(`/api/cam-reconciliations: C, an active member, → ${apiC} (expected 200 — ORG_API_DEPLOYED=1)`);
        if (docC === 200) pass('/api/document-url: C reaches the registered document by id ✓');
        else fail(`/api/document-url: C, an active member, → ${docC} by id (expected 200 — ORG_API_DEPLOYED=1)`);
      } else {
        info(`deployed API answered C (active member): cam-reconciliations ${apiC}, document-url by id ${docC} — ` +
             'not asserted until the pilot deployment carries P0.1 (ORG_API_DEPLOYED=1)');
      }
      if (uidA && uidC && uidA !== uidC) pass('A and C are different accounts — the member checks above are cross-user');
      else fail('A and C resolved to the same account');
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
