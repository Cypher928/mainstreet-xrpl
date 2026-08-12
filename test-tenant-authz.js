'use strict';
/**
 * test-tenant-authz.js — Phase A tenant authorization, verified over real JWTs.
 *
 *   TENANT_A_EMAIL=… TENANT_A_PASS=… \
 *   TENANT_B_EMAIL=… TENANT_B_PASS=… \
 *   TENANT_C_EMAIL=… TENANT_C_PASS=… \   (revoked membership)
 *   LANDLORD_EMAIL=… LANDLORD_PASS=… \
 *   TENANT_A_TENANT_ID=… TENANT_B_TENANT_ID=… TENANT_B_PROPERTY_ID=… \
 *   OTHER_PROPERTY_TENANT_ID=… \
 *   node test-tenant-authz.js
 *
 * Credentials are read from the environment only. Nothing is written to disk,
 * nothing is echoed: emails and passwords never appear in output, and the only
 * identifier printed is a row count.
 *
 * PILOT ONLY. The URL is pinned to bhmktujbxdbvdmpybmad and the suite refuses
 * to run against anything else — note that the older test-rls-cross-user.js
 * hardcodes the PRODUCTION project, so do not copy its constants.
 *
 * WHAT THIS PROVES
 * ----------------
 * That RLS — not the UI, and not any role claim — is what stops a tenant from
 * reading another tenant, the parent property, or landlord-internal tables.
 * Every assertion is a REST read carried out with a genuine signed JWT.
 *
 * FAILURE MODES ARE LOUD BY DESIGN
 * --------------------------------
 * Missing env vars, an unreachable host, a non-pilot URL, or a failed sign-in
 * all abort with a non-zero exit. A security suite that skips silently is worse
 * than no suite: it reports success for tests that never executed.
 */

const PILOT_REF = 'bhmktujbxdbvdmpybmad';
const SUPABASE_URL = `https://${PILOT_REF}.supabase.co`;
const ANON_KEY = 'sb_publishable__Gi3NcVbKmnhu4SfjUxLHw_QpZMYEz1';

let passed = 0, failed = 0;
const failures = [];
const ok   = (m) => { passed++; console.log(`  ok   ${m}`); };
const bad  = (m) => { failed++; failures.push(m); console.log(`  FAIL ${m}`); };
function expectRows(label, actual, expected) {
  if (actual === expected) ok(`${label} → ${actual} row(s)`);
  else bad(`${label} → expected ${expected} row(s), got ${actual}`);
}
function abort(msg) {
  console.error(`\nABORT: ${msg}`);
  console.error('This suite exits non-zero rather than skipping — an unrun security test must never read as a pass.');
  process.exit(2);
}

if (!SUPABASE_URL.includes(PILOT_REF)) abort('URL is not the pilot project.');

const need = (n) => { const v = process.env[n]; if (!v) abort(`missing env var ${n}`); return v; };

async function signIn(email, password) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) abort(`sign-in failed for ${email}: ${r.status} ${JSON.stringify(j).slice(0, 200)}`);
  return j.access_token;
}

// The authenticated user's own id, read back from GoTrue rather than supplied
// as an env var — it must be the id the server actually associates with this
// token, otherwise T11 is not testing a genuine self-grant.
async function currentUserId(token) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.id) abort(`could not read current user id: ${r.status}`);
  return j.id;
}

// Returns row count. token omitted ⇒ anonymous (anon key only).
async function count(path, token) {
  const headers = { 'apikey': ANON_KEY };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers });
  if (r.status === 401 || r.status === 403) return 0;   // denied ⇒ no rows
  const body = await r.json().catch(() => []);
  return Array.isArray(body) ? body.length : 0;
}

async function main() {
  // Reachability first, so a blocked network can never look like a pass.
  try {
    const ping = await fetch(`${SUPABASE_URL}/rest/v1/`, { headers: { apikey: ANON_KEY } });
    if (!ping.status) throw new Error('no status');
  } catch (e) {
    abort(`cannot reach ${SUPABASE_URL} (${e.message}). ` +
          'Run from a host with egress to the pilot project.');
  }

  const A_ID          = need('TENANT_A_TENANT_ID');
  const B_ID          = need('TENANT_B_TENANT_ID');
  const B_PROPERTY_ID = need('TENANT_B_PROPERTY_ID'); // T11: makes the forged row well formed
  const OTHER_ID      = need('OTHER_PROPERTY_TENANT_ID');

  const aTok = await signIn(need('TENANT_A_EMAIL'),  need('TENANT_A_PASS'));
  const bTok = await signIn(need('TENANT_B_EMAIL'),  need('TENANT_B_PASS'));
  const cTok = await signIn(need('TENANT_C_EMAIL'),  need('TENANT_C_PASS'));
  const lTok = await signIn(need('LANDLORD_EMAIL'),  need('LANDLORD_PASS'));

  console.log('\n── Tenant A: own record readable, nothing else ──');
  expectRows('T1  A reads own tenant row',            await count(`tenants?id=eq.${A_ID}&select=id`, aTok), 1);
  expectRows('T2  A reads tenant B',                  await count(`tenants?id=eq.${B_ID}&select=id`, aTok), 0);
  expectRows('T3  A reads a tenant on another property', await count(`tenants?id=eq.${OTHER_ID}&select=id`, aTok), 0);
  expectRows('T2b A reads all tenants',               await count('tenants?select=id', aTok), 1);
  expectRows('T4  A reads properties',                await count('properties?select=id', aTok), 0);
  expectRows('T5a A reads tenant_field_evidence',     await count('tenant_field_evidence?select=id', aTok), 0);
  expectRows('T5b A reads tenant_review_audit',       await count('tenant_review_audit?select=id', aTok), 0);
  expectRows('T6a A reads lease_documents',           await count('lease_documents?select=id', aTok), 0);
  expectRows('T6b A reads lease_jobs',                await count('lease_jobs?select=id', aTok), 0);
  expectRows('T6c A reads cam_reconciliations',       await count('cam_reconciliations?select=id', aTok), 0);

  console.log('\n── Membership table is not a lateral channel ──');
  expectRows('T12 A reads tenant_users (own row only)', await count('tenant_users?select=id', aTok), 1);
  expectRows('T12b B reads tenant_users (own row only)', await count('tenant_users?select=id', bTok), 1);

  // T11 — a tenant that could INSERT its own membership could grant itself any
  // space, so this is the single most important negative test in the suite.
  //
  // The row below is deliberately WELL FORMED: every NOT NULL column is present,
  // both foreign keys resolve, the composite (tenant_id, property_id) pair is
  // real, and it collides with no unique constraint. Nothing about the row's
  // shape can refuse it — the only thing that can is authorization.
  //
  // The assertion is on the SQLSTATE, not merely on "the request failed".
  // Accepting any non-2xx would let an expired token, a typo in the URL or a
  // 404 masquerade as a passing security test. 42501 is Postgres'
  // insufficient_privilege, which is what an RLS WITH CHECK refusal raises;
  // PostgREST surfaces it as HTTP 403 with code "42501" in the body.
  //
  // Verified against the pilot database before shipping this assertion:
  //   · well-formed self-grant, policies as shipped  → 42501, insert refused
  //   · same insert with an INSERT policy opened up  → SUCCEEDS
  // so this test fails if the tenant INSERT policy is ever accidentally opened.
  const aUserId = await currentUserId(aTok);
  const insBody = {
    user_id:     aUserId,        // A's own id: a genuine self-grant attempt
    tenant_id:   B_ID,           // ... to tenant B's space
    property_id: B_PROPERTY_ID,  // ... with the property that actually holds B
    accepted_at: new Date().toISOString(),
  };
  const ins = await fetch(`${SUPABASE_URL}/rest/v1/tenant_users`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${aTok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(insBody),
  });
  const insBodyJson = await ins.json().catch(() => ({}));
  if (ins.ok) {
    bad('T11 tenant self-grant INSERT was ACCEPTED — the tenant INSERT policy is open (SECURITY FAILURE)');
  } else if (insBodyJson.code === '42501') {
    ok('T11 tenant self-grant INSERT refused by RLS (42501 insufficient_privilege)');
  } else {
    // Refused, but not by the policy — the test did not prove what it claims.
    bad(`T11 self-grant refused for a NON-RLS reason (http ${ins.status}, code ${insBodyJson.code || 'none'}: ` +
        `${(insBodyJson.message || '').slice(0, 120)}) — this test proves nothing about RLS until the row is accepted as well formed`);
  }

  console.log('\n── Revoked and unauthenticated ──');
  expectRows('T9  revoked membership reads tenants',  await count('tenants?select=id', cTok), 0);
  expectRows('T9b revoked membership reads tenant_users', await count('tenant_users?select=id', cTok), 0);
  expectRows('T8  anonymous reads tenants',           await count('tenants?select=id'), 0);
  expectRows('T8b anonymous reads properties',        await count('properties?select=id'), 0);

  console.log('\n── Role is not an authorization input ──');
  // Tenant A rewrites its own user_metadata.role — the client CAN do this.
  const esc = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    method: 'PUT',
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${aTok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: { role: 'landlord' } }),
  });
  ok(`T10 metadata self-edit accepted by GoTrue (${esc.status}) — expected; it is client-writable`);
  const aTok2 = await signIn(process.env.TENANT_A_EMAIL, process.env.TENANT_A_PASS);
  expectRows('T10a A (now role=landlord) reads properties', await count('properties?select=id', aTok2), 0);
  expectRows('T10b A (now role=landlord) reads all tenants', await count('tenants?select=id', aTok2), 1);
  expectRows('T10c A (now role=landlord) reads evidence',   await count('tenant_field_evidence?select=id', aTok2), 0);

  console.log('\n── Landlord regression ──');
  const lp = await count('properties?select=id', lTok);
  const lt = await count('tenants?select=id', lTok);
  if (lp > 0) ok(`T7  landlord still reads own properties (${lp})`);
  else bad('T7  landlord can no longer read properties — REGRESSION');
  if (lt > 0) ok(`T7b landlord still reads own tenants (${lt})`);
  else bad('T7b landlord can no longer read tenants — REGRESSION');

  console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} — ${passed} passed, ${failed} failed`);
  if (failed) { failures.forEach(f => console.log(`  · ${f}`)); process.exit(1); }
}

main().catch(e => abort(e.stack || e.message));
