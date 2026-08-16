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
 *   TENANT_C_TENANT_ID=… TENANT_C_PROPERTY_ID=… \   (T17/T18)
 *   PILOT_SUPABASE_SERVICE_ROLE_KEY=… \             (T17/T18)
 *   APP_ORIGIN=… \                                  (T15/T16)
 *   node test-tenant-authz.js
 *
 * scripts/b1-ci-fixture.js setup emits every one of these except the last two.
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
  // Doubles as the data-side proof for a pending membership: A holds an
  // unaccepted membership on exactly this tenant, so a 0 here says an issued
  // invitation grants no read until it is redeemed.
  expectRows('T3  A reads a tenant on another property (A is PENDING on it)',
    await count(`tenants?id=eq.${OTHER_ID}&select=id`, aTok), 0);
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

  // T12c — the positive half of 015. The policy now reads
  //   user_id = auth.uid() and accepted_at is not null and revoked_at is null
  // and a predicate that hides a revoked row is worthless if it also hides an
  // ACTIVE one: the tenant portal would show every signed-in tenant an empty
  // state and the failure would look like "no data" rather than "denied".
  // T12 above proves A sees one row; this proves that row is genuinely active,
  // so the two together pin both directions of the predicate.
  expectRows('T12c A\'s visible membership is accepted and not revoked',
    await count('tenant_users?accepted_at=not.is.null&revoked_at=is.null&select=id', aTok), 1);

  // T12d — a PENDING membership grants nothing and is not even visible.
  // The fixture gives A a second, unaccepted membership on the other property's
  // tenant. This is the assertion that makes the `accepted_at is not null`
  // conjunct in tenant_users_self_select load-bearing: a truth table over the
  // predicate shows deleting that conjunct changes the result for a pending row
  // and for no other shape, so without a pending row in the fixture the conjunct
  // could be deleted with every test still green.
  //
  // Note T12 above is the sharper of the two — with the conjunct gone A reads 2
  // rows there, not 1. T12d states the property directly so the intent survives
  // a future change to the fixture's row counts.
  expectRows('T12d A\'s pending membership is invisible to A',
    await count('tenant_users?accepted_at=is.null&select=id', aTok), 0);

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
  // Revocation must cut off BOTH the data and the membership row that grants it.
  //
  // T9 is the one that matters for confidentiality and it passed even before
  // migration 015, because tenant_ids_for_current_user() has always filtered
  // revoked_at. T9b failed: tenant_users_self_select said only
  // `user_id = auth.uid()`, so C kept reading its own revoked row. Nothing
  // lateral leaked through it — but the database was carrying two different
  // definitions of "membership", and the looser one was the one a policy edit
  // would land on. 015 removed the split; this assertion is what holds it
  // removed, and it was NOT relaxed to match the old behaviour.
  const C_TENANT_ID = need('TENANT_C_TENANT_ID');
  expectRows('T9  revoked membership reads tenants',  await count('tenants?select=id', cTok), 0);
  expectRows('T9b revoked membership reads tenant_users', await count('tenant_users?select=id', cTok), 0);

  // T9c — the same read, aimed. An unfiltered SELECT returning 0 could also be
  // a PostgREST quirk or an empty table; asking for the row C knows exists, by
  // its own tenant_id, can only return 0 because the policy refused it.
  expectRows('T9c revoked membership reads its own row by tenant_id',
    await count(`tenant_users?tenant_id=eq.${C_TENANT_ID}&select=id`, cTok), 0);

  // T9d/e — revocation reaches the data, not just the membership table. If a
  // future policy ever grants tenant reads on these directly rather than
  // through tenant_ids_for_current_user(), revocation would stop meaning
  // anything and T9 alone would not notice.
  expectRows('T9d revoked membership reads properties',
    await count('properties?select=id', cTok), 0);
  expectRows('T9e revoked membership reads cam_reconciliations',
    await count('cam_reconciliations?select=id', cTok), 0);
  expectRows('T9f revoked membership reads tenant_field_evidence',
    await count('tenant_field_evidence?select=id', cTok), 0);

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

  console.log('\n── Invitations are invisible to tenants (B1) ──');
  // tenant_invitations has NO tenant policy by design. A tenant proves an
  // invitation by presenting its token to the API, never by reading the row —
  // so a tenant who can list invitations can enumerate other tenants' spaces
  // and their token hashes.
  expectRows('T13  A reads tenant_invitations',            await count('tenant_invitations?select=id', aTok), 0);
  expectRows('T13b B reads tenant_invitations',            await count('tenant_invitations?select=id', bTok), 0);
  expectRows('T13c revoked member reads tenant_invitations', await count('tenant_invitations?select=id', cTok), 0);
  expectRows('T13d anonymous reads tenant_invitations',    await count('tenant_invitations?select=id'), 0);

  // Selecting only token_hash is the enumeration a leaky policy would enable.
  expectRows('T13e A reads invitation token hashes',       await count('tenant_invitations?select=token_hash', aTok), 0);

  // A tenant forging an invitation for itself is a self-grant with extra steps.
  const invIns = await fetch(`${SUPABASE_URL}/rest/v1/tenant_invitations`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${aTok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tenant_id: B_ID, property_id: B_PROPERTY_ID,
      email: process.env.TENANT_A_EMAIL, token_hash: 'a'.repeat(64),
      invited_by: await currentUserId(aTok),
    }),
  });
  const invInsBody = await invIns.json().catch(() => ({}));
  if (invIns.ok) bad('T14 tenant forged an invitation — the invitation INSERT policy is open (SECURITY FAILURE)');
  else if (invInsBody.code === '42501') ok('T14 tenant invitation forge refused by RLS (42501)');
  else bad(`T14 invitation forge refused for a NON-RLS reason (http ${invIns.status}, code ${invInsBody.code || 'none'})`);

  console.log('\n── Accept-invite endpoint (B1) ──');
  // The route lives on the app origin, not on Supabase. APP_ORIGIN is required
  // to exercise it; fail loudly rather than skip silently if it is absent.
  if (!process.env.APP_ORIGIN) {
    bad('T15/T16 skipped — APP_ORIGIN not set, so the accept-invite route was never exercised');
  } else {
    const origin = process.env.APP_ORIGIN.replace(/\/$/, '');
    const bogus = await fetch(`${origin}/api/tenant-accept-invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${aTok}` },
      body: JSON.stringify({ token: 'x'.repeat(64) }),
    });
    // A 404 here means the route is not deployed at APP_ORIGIN, which is a
    // different condition from "deployed and answering wrongly" — and right now
    // it is the expected one: api/tenant-accept-invite.js is on the held B1
    // checkpoint, not on origin/pilot, which is what serves that domain.
    //
    // It still counts as a FAILURE, deliberately. B1's exit criterion is that
    // this route was exercised over real HTTP; an undeployed route has not been.
    // Naming the cause makes the run readable without letting it read as a pass.
    const undeployed = (s) => s === 404
      ? ' — the route is NOT DEPLOYED at APP_ORIGIN (B1 is unverified here, not broken); deploy B1 to pilot to exercise it'
      : '';
    if (bogus.status === 400) ok('T15 accept-invite refuses an unknown token (400)');
    else bad(`T15 accept-invite returned ${bogus.status} for an unknown token — expected 400${undeployed(bogus.status)}`);

    const noAuth = await fetch(`${origin}/api/tenant-accept-invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'x'.repeat(64) }),
    });
    if (noAuth.status === 401) ok('T16 accept-invite requires authentication (401)');
    else bad(`T16 accept-invite returned ${noAuth.status} unauthenticated — expected 401${undeployed(noAuth.status)}`);
  }

  console.log('\n── Landlord regression ──');
  const lp = await count('properties?select=id', lTok);
  const lt = await count('tenants?select=id', lTok);
  if (lp > 0) ok(`T7  landlord still reads own properties (${lp})`);
  else bad('T7  landlord can no longer read properties — REGRESSION');
  if (lt > 0) ok(`T7b landlord still reads own tenants (${lt})`);
  else bad('T7b landlord can no longer read tenants — REGRESSION');

  // T7c — 015 narrowed tenant_users_self_select and MUST NOT have narrowed
  // tenant_users_landlord_all. The landlord's own view is the one place a
  // revoked membership still has to be visible: it is the record of who was
  // removed and the row the landlord edits to restore them. Expect all three
  // fixture memberships, including C's revoked one.
  //
  // Asserted as an exact count, not "> 0". At `> 0` this test would pass with
  // the revoked row filtered out — which is precisely the regression it exists
  // to catch — because A's and B's active rows would still be there.
  expectRows('T7c landlord reads all memberships incl. the revoked and pending ones',
    await count('tenant_users?select=id', lTok), 4);

  // ── Re-invitation restores a revoked tenant (B1) ─────────────────────────
  // RUNS LAST, DELIBERATELY. It un-revokes tenant C, so every assertion above
  // that depends on C being revoked (T9, T9b, T9c, T9d/e/f, T13c) must already
  // have executed. Do not move this block up.
  //
  // WHAT IT PROVES, and why it is not redundant with T15/T16:
  // T15/T16 exercise the HTTP route and are currently blocked — the route is
  // not deployed to pilot. This proves the WRITE PATH that route depends on:
  // that the service role can still create a membership RLS forbids the tenant
  // to create (T11), and that doing so restores a revoked tenant's access.
  //
  // Migration 015 is what makes this test necessary. Once a revoked row is
  // invisible to its own tenant, a re-acceptance that silently fails to clear
  // revoked_at leaves the tenant with no access AND no way to see why. Writing
  // it found exactly that bug: the endpoint's upsert payload omitted
  // revoked_at, and `resolution=merge-duplicates` only updates the columns the
  // payload carries, so a re-invited tenant got a 200 and stayed locked out.
  console.log('\n── Re-invitation restores a revoked tenant (B1) ──');
  const svcKey = process.env.PILOT_SUPABASE_SERVICE_ROLE_KEY;
  if (!svcKey) {
    bad('T17/T18 skipped — PILOT_SUPABASE_SERVICE_ROLE_KEY not set, so the acceptance write path was never exercised');
  } else {
    const C_PROPERTY_ID = need('TENANT_C_PROPERTY_ID');
    const cEmail = process.env.TENANT_C_EMAIL;
    const svc = (path, opts = {}) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      ...opts,
      headers: {
        apikey: svcKey, Authorization: `Bearer ${svcKey}`,
        'Content-Type': 'application/json', ...(opts.headers || {}),
      },
    });

    // The landlord issues the invitation. Only the hash is stored, exactly as
    // the endpoint expects to find it.
    const rawToken = require('crypto').randomBytes(32).toString('hex');
    const tokenHash = require('crypto').createHash('sha256').update(rawToken).digest('hex');
    const invIns2 = await svc('tenant_invitations', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        tenant_id: C_TENANT_ID, property_id: C_PROPERTY_ID, email: cEmail,
        token_hash: tokenHash,
        expires_at: new Date(Date.now() + 7 * 864e5).toISOString(),
      }),
    });
    const invRow = (await invIns2.json().catch(() => []))[0];
    if (!invIns2.ok || !invRow) {
      bad(`T17 landlord could not issue an invitation via the service role (http ${invIns2.status})`);
    } else {
      // Byte-for-byte the membership write api/tenant-accept-invite.js performs.
      const acc = await svc('tenant_users', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify({
          user_id: await currentUserId(cTok),
          tenant_id: invRow.tenant_id,
          property_id: invRow.property_id,
          accepted_at: new Date().toISOString(),
          revoked_at: null,
          invited_by: null,
        }),
      });
      if (acc.ok) ok('T17 service role writes the membership RLS forbids the tenant to write');
      else bad(`T17 acceptance write failed (http ${acc.status}) — the endpoint's write path is broken`);

      // Single use, conditioned on still being open — as the endpoint does.
      const closed = await svc(
        `tenant_invitations?id=eq.${invRow.id}&accepted_at=is.null&revoked_at=is.null`,
        { method: 'PATCH', headers: { Prefer: 'return=representation' },
          body: JSON.stringify({ accepted_at: new Date().toISOString() }) });
      const closedRows = await closed.json().catch(() => []);
      if (closed.ok && closedRows.length === 1) ok('T17b invitation is closed on acceptance (single use)');
      else bad(`T17b invitation was not closed (http ${closed.status}, ${closedRows.length} row(s))`);

      // The payoff. Same JWT as before — RLS is evaluated per request against
      // current data, so no re-login is needed for access to come back.
      expectRows('T18  restored tenant reads its membership again',
        await count('tenant_users?select=id', cTok), 1);
      expectRows('T18b restored tenant reads its tenant row again',
        await count('tenants?select=id', cTok), 1);

      // Restoration must not overshoot into someone else's space.
      expectRows('T18c restored tenant still reads no properties',
        await count('properties?select=id', cTok), 0);
      expectRows('T18d restored tenant still reads no invitations',
        await count('tenant_invitations?select=id', cTok), 0);
    }
  }

  console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} — ${passed} passed, ${failed} failed`);
  if (failed) { failures.forEach(f => console.log(`  · ${f}`)); process.exit(1); }
}

main().catch(e => abort(e.stack || e.message));
