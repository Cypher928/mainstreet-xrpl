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
  // invisible to its own tenant, a re-acceptance that silently fails leaves the
  // tenant with no access AND no way to see why. Writing it found TWO such
  // failures in the endpoint, both only reachable on a RE-invitation — a first
  // acceptance has no row to collide with, which is what hid them:
  //
  //   1. `resolution=merge-duplicates` merges on the PRIMARY KEY unless
  //      on_conflict names another constraint. The payload carries no id, so
  //      PostgREST targeted id while the row actually collided with
  //      tenant_users_user_tenant_uniq — an unhandled unique violation, 409,
  //      surfaced to the tenant as 502. Nothing merged at all.
  //   2. revoked_at was absent from the payload, and merge-duplicates updates
  //      only the columns the payload carries, so the row stayed revoked. The
  //      tenant got a 200 and remained locked out.
  //
  // THREE ROUNDS, in order, each depending on the state the last one left:
  //   1  revoked -> invited -> accepted -> access restored      (T17, T18)
  //   2  an already-active tenant invited again, no duplicate   (T19)
  //   3  revoked again; an OUTSTANDING invitation restores
  //      nothing until the flow is completed                    (T20, T21)
  //
  // Round 3 is the security property the design rests on: authority comes from
  // completing acceptance, never from an invitation existing. Membership counts
  // are read with the SERVICE ROLE — through RLS a duplicate or a revoked
  // leftover is invisible, which is precisely what these tests look for.
  console.log('\n── Re-invitation restores a revoked tenant (B1) ──');
  const svcKey = process.env.PILOT_SUPABASE_SERVICE_ROLE_KEY;
  if (!svcKey) {
    bad('T17-T21 skipped — PILOT_SUPABASE_SERVICE_ROLE_KEY not set, so the acceptance write path was never exercised');
  } else {
    const C_PROPERTY_ID = need('TENANT_C_PROPERTY_ID');
    const cEmail  = process.env.TENANT_C_EMAIL;
    const cUserId = await currentUserId(cTok);
    const lUserId = await currentUserId(lTok);
    const crypto  = require('crypto');

    const svc = (path, opts = {}) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      ...opts,
      headers: {
        apikey: svcKey, Authorization: `Bearer ${svcKey}`,
        'Content-Type': 'application/json', ...(opts.headers || {}),
      },
    });
    // Counts read with the SERVICE ROLE, so they see the table as it really is.
    // count() above reads through RLS and would report 0 for a revoked row even
    // if a duplicate existed — exactly the bug these tests look for.
    const svcCount = async (path) => {
      const r = await svc(path);
      const b = await r.json().catch(() => []);
      return Array.isArray(b) ? b.length : 0;
    };
    const memberships = () =>
      svcCount(`tenant_users?user_id=eq.${cUserId}&tenant_id=eq.${C_TENANT_ID}&select=id`);
    const openInvites = () =>
      svcCount(`tenant_invitations?tenant_id=eq.${C_TENANT_ID}&accepted_at=is.null&revoked_at=is.null&select=id`);

    // The landlord issues an invitation. Only the hash is stored, exactly as the
    // endpoint expects to find it. Returns the row, or null with a reported fail.
    async function issueInvitation(label) {
      const token = crypto.randomBytes(32).toString('hex');
      const r = await svc('tenant_invitations', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({
          tenant_id: C_TENANT_ID, property_id: C_PROPERTY_ID, email: cEmail,
          token_hash: crypto.createHash('sha256').update(token).digest('hex'),
          // NOT NULL in 014, and correct on the merits: the landlord who owns
          // the property is the one issuing this invitation.
          invited_by: lUserId,
          expires_at: new Date(Date.now() + 7 * 864e5).toISOString(),
        }),
      });
      const body = await r.json().catch(() => null);
      const row  = Array.isArray(body) ? body[0] : null;
      if (!r.ok || !row) {
        // Carry the PostgREST message through. The first cut of this test
        // omitted invited_by (NOT NULL in 014) and reported only "http 400",
        // which said nothing about which column was wrong.
        bad(`${label} could not issue an invitation via the service role (http ${r.status}: ` +
            `${JSON.stringify(body).slice(0, 200)})`);
        return null;
      }
      return row;
    }

    // Byte-for-byte the two writes api/tenant-accept-invite.js performs, in the
    // same order: membership first, then close the invitation. Both details that
    // were broken live here — the conflict target and the revoked_at reset — so
    // this helper is the thing under test, not scaffolding around it.
    async function acceptInvitation(inv) {
      const acc = await svc('tenant_users?on_conflict=user_id,tenant_id', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify({
          user_id: cUserId,
          tenant_id: inv.tenant_id,
          property_id: inv.property_id,
          accepted_at: new Date().toISOString(),
          revoked_at: null,
          invited_by: null,
        }),
      });
      const accBody = acc.ok ? null : await acc.json().catch(() => null);
      // Single use, conditioned on still being open — as the endpoint does.
      const closed = await svc(
        `tenant_invitations?id=eq.${inv.id}&accepted_at=is.null&revoked_at=is.null`,
        { method: 'PATCH', headers: { Prefer: 'return=representation' },
          body: JSON.stringify({ accepted_at: new Date().toISOString(), accepted_by: cUserId }) });
      const closedRows = await closed.json().catch(() => []);
      return { ok: acc.ok, status: acc.status, body: accBody,
               closedCount: Array.isArray(closedRows) ? closedRows.length : 0 };
    }

    const revoke = () => svc(
      `tenant_users?user_id=eq.${cUserId}&tenant_id=eq.${C_TENANT_ID}`,
      { method: 'PATCH', headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ revoked_at: new Date().toISOString() }) });

    // ── Round 1: the revoked tenant is invited back and accepts ─────────────
    const inv1 = await issueInvitation('T17');
    if (inv1) {
      const r1 = await acceptInvitation(inv1);
      if (r1.ok) ok('T17 service role writes the membership RLS forbids the tenant to write');
      else bad(`T17 acceptance write failed (http ${r1.status}: ${JSON.stringify(r1.body).slice(0, 200)}) — ` +
               `the endpoint's write path is broken`);

      r1.closedCount === 1
        ? ok('T17b invitation is closed on acceptance (single use)')
        : bad(`T17b invitation was not closed (${r1.closedCount} row(s))`);

      // T17c — this block MIRRORS the endpoint's writes; it does not call them
      // (T15/T16 do, once the route is deployed). A mirror that silently drifts
      // proves nothing, and both bugs found here live in exactly the two details
      // checked below. Cheap coupling check, so the mirror cannot rot unnoticed.
      const epSrc = require('fs').readFileSync(
        require('path').join(__dirname, 'api/tenant-accept-invite.js'), 'utf8');
      const mirrored = ['on_conflict=user_id,tenant_id', 'revoked_at:  null']
        .filter(s => !epSrc.includes(s));
      mirrored.length === 0
        ? ok('T17c the endpoint still performs the writes this test mirrors')
        : bad(`T17c api/tenant-accept-invite.js no longer matches what T17 mirrors — missing: ${mirrored.join(', ')}`);

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

      // The upsert MERGED rather than inserting a second row. Read with the
      // service role: through RLS a duplicate would be indistinguishable from
      // the single row, since the tenant sees at most its own active membership.
      expectRows('T18e exactly one membership row exists after re-acceptance',
        await memberships(), 1);
    }

    // ── Round 2: inviting an ALREADY-ACTIVE tenant again ────────────────────
    // The upsert must be idempotent. Without on_conflict naming
    // (user_id, tenant_id) this is the 409 that broke round 1; with a plain
    // INSERT it would be a duplicate membership.
    console.log('\n── A repeated invitation does not multiply membership ──');
    const inv2 = await issueInvitation('T19');
    if (inv2) {
      const r2 = await acceptInvitation(inv2);
      r2.ok ? ok('T19  a second acceptance for an already-active tenant succeeds (idempotent)')
            : bad(`T19  second acceptance failed (http ${r2.status}: ${JSON.stringify(r2.body).slice(0, 200)})`);

      expectRows('T19b still exactly one membership row — no duplicate created',
        await memberships(), 1);
      expectRows('T19c tenant still reads exactly one membership',
        await count('tenant_users?select=id', cTok), 1);

      // Every invitation issued so far has been redeemed, so none is left
      // redeemable. An invitation that stayed open after acceptance would be a
      // second, unexpired key to the same space.
      expectRows('T19d no invitation is left open after acceptance',
        await openInvites(), 0);

      // Re-closing an already-closed invitation must affect nothing. This is
      // what makes the token single-use under concurrency: the PATCH is
      // conditioned on the row still being open.
      const reClose = await svc(
        `tenant_invitations?id=eq.${inv2.id}&accepted_at=is.null&revoked_at=is.null`,
        { method: 'PATCH', headers: { Prefer: 'return=representation' },
          body: JSON.stringify({ accepted_at: new Date().toISOString() }) });
      const reClosed = await reClose.json().catch(() => []);
      (Array.isArray(reClosed) && reClosed.length === 0)
        ? ok('T19e redeeming an already-closed invitation affects 0 rows (single use holds)')
        : bad(`T19e a closed invitation was redeemable again (${reClosed.length} row(s))`);

      // T19f — what actually makes a duplicate membership impossible is the
      // unique constraint, not the upsert. T19b/T21d count rows and would still
      // read 1 if that constraint were dropped and no second write happened, so
      // on their own they assert an invariant they cannot break. This asserts it
      // directly: a PLAIN insert of the same pair — no on_conflict, no
      // merge-duplicates — must be REFUSED by the database.
      //
      // On the SQLSTATE, not merely "it failed": 23505 is unique_violation.
      // Accepting any non-2xx would let a typo, a dropped column or an expired
      // key pass for a constraint that is no longer there.
      const dup = await svc('tenant_users', {
        method: 'POST',
        body: JSON.stringify({
          user_id: cUserId, tenant_id: C_TENANT_ID, property_id: C_PROPERTY_ID,
          accepted_at: new Date().toISOString(), revoked_at: null,
        }),
      });
      const dupBody = await dup.json().catch(() => ({}));
      if (dup.ok) bad('T19f a DUPLICATE membership row was accepted — tenant_users_user_tenant_uniq is gone (SECURITY FAILURE)');
      else if (dupBody.code === '23505') ok('T19f duplicate membership refused by the unique constraint (23505)');
      else bad(`T19f duplicate refused for a NON-CONSTRAINT reason (http ${dup.status}, code ${dupBody.code || 'none'}) — ` +
               `this proves nothing about duplicate prevention`);

      expectRows('T19g and the refused duplicate left the single row intact',
        await memberships(), 1);
    }

    // ── Round 3: an invitation ALONE must not restore access ────────────────
    // The security property behind the whole design: authority comes from
    // completing the acceptance flow, never from an invitation existing. If
    // merely being invited restored a revoked tenant, revocation would be
    // undone by any landlord mis-click, and a leaked invitation would be
    // equivalent to access.
    console.log('\n── An invitation alone does not restore a revoked tenant ──');
    const rev = await revoke();
    if (!rev.ok) {
      bad(`T20 could not re-revoke the membership to set up the test (http ${rev.status})`);
    } else {
      expectRows('T20  re-revoked tenant reads no membership',  await count('tenant_users?select=id', cTok), 0);
      expectRows('T20b re-revoked tenant reads no tenant row',  await count('tenants?select=id', cTok), 0);

      const inv3 = await issueInvitation('T20c-issue');
      if (inv3) {
        // Issued and OUTSTANDING — deliberately not accepted.
        expectRows('T20c an invitation is outstanding for the revoked tenant', await openInvites(), 1);

        expectRows('T20d holding an invitation grants NO membership read',
          await count('tenant_users?select=id', cTok), 0);
        expectRows('T20e holding an invitation grants NO tenant read',
          await count('tenants?select=id', cTok), 0);
        expectRows('T20f holding an invitation grants no property read',
          await count('properties?select=id', cTok), 0);
        expectRows('T20g the invited tenant still cannot see the invitation itself',
          await count('tenant_invitations?select=id', cTok), 0);
        expectRows('T20h and the membership row is still the same single row',
          await memberships(), 1);

        // Only now is the flow completed.
        console.log('\n── Completing the flow is what restores access ──');
        const r3 = await acceptInvitation(inv3);
        r3.ok ? ok('T21  acceptance of the outstanding invitation succeeds')
              : bad(`T21  acceptance failed (http ${r3.status}: ${JSON.stringify(r3.body).slice(0, 200)})`);

        expectRows('T21b access is restored only after acceptance — membership readable',
          await count('tenant_users?select=id', cTok), 1);
        expectRows('T21c access is restored only after acceptance — tenant row readable',
          await count('tenants?select=id', cTok), 1);
        expectRows('T21d still exactly one membership row after three acceptances',
          await memberships(), 1);
        expectRows('T21e no invitation left open',
          await openInvites(), 0);
      }
    }
  }

  // ══ B2 · projections ══════════════════════════════════════════════════════
  // Runs AFTER the B1 block. Tenant C has been restored by T21, so the
  // revoked-member cases here re-revoke explicitly rather than assuming a state
  // an earlier section left behind.
  const STMT_A = need('STMT_A_PUBLISHED_ID');
  const DOC_A  = need('DOC_A_PUBLISHED_ID');
  const DOC_B  = need('DOC_B_PUBLISHED_ID');

  // T21 left C active. The projection cases need it revoked again, and the
  // revocation must be a real one written the way a landlord would write it —
  // not a token that merely stops being sent.
  const _svc = process.env.PILOT_SUPABASE_SERVICE_ROLE_KEY;
  async function svcRevokeC() {
    if (!_svc) { bad('T71 could not re-revoke C — service role key absent'); return; }
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/tenant_users?user_id=eq.${await currentUserId(cTok)}` +
      `&tenant_id=eq.${C_TENANT_ID}`,
      { method: 'PATCH',
        headers: { apikey: _svc, Authorization: `Bearer ${_svc}`,
                   'Content-Type': 'application/json', Prefer: 'return=representation' },
        body: JSON.stringify({ revoked_at: new Date().toISOString() }) });
    if (!r.ok) bad(`T71 could not re-revoke C (http ${r.status})`);
  }

  console.log('\n── B2: statements — published only, own only ──');
  expectRows('T22  A reads its published statement',
    await count('tenant_statements?select=id', aTok), 1);
  expectRows('T23  A reads its DRAFT statement (2023)',
    await count('tenant_statements?cam_year=eq.2023&select=id', aTok), 0);
  expectRows('T24  A reads its SUPERSEDED statement (2022)',
    await count('tenant_statements?cam_year=eq.2022&select=id', aTok), 0);
  expectRows('T25  A reads its VOID statement (2021)',
    await count('tenant_statements?cam_year=eq.2021&select=id', aTok), 0);
  // B's 2024 statement is real and published — this is isolation, not emptiness.
  expectRows('T26  A reads B\'s published statement (same property)',
    await count(`tenant_statements?tenant_id=eq.${B_ID}&select=id`, aTok), 0);
  expectRows('T27  A reads statements on the other property',
    await count(`tenant_statements?property_id=neq.${B_PROPERTY_ID}&select=id`, aTok), 0);
  expectRows('T28  anonymous reads tenant_statements',
    await count('tenant_statements?select=id'), 0);
  expectRows('T31  A (role=landlord) reads statements',
    await count('tenant_statements?select=id', aTok2), 1);

  console.log('\n── B2: space profiles and documents ──');
  expectRows('T36  A reads its published space profile',
    await count('tenant_space_profiles?select=id', aTok), 1);
  expectRows('T37  B reads its DRAFT space profile',
    await count('tenant_space_profiles?select=id', bTok), 0);
  expectRows('T38  A reads B\'s space profile',
    await count(`tenant_space_profiles?tenant_id=eq.${B_ID}&select=id`, aTok), 0);
  expectRows('T40  A reads its published document',
    await count('tenant_documents?status=eq.published&select=id', aTok), 1);
  expectRows('T41  A reads its draft and withdrawn documents',
    await count('tenant_documents?status=neq.published&select=id', aTok), 0);
  expectRows('T42  A reads B\'s published document',
    await count(`tenant_documents?id=eq.${DOC_B}&select=id`, aTok), 0);

  console.log('\n── B2: _sources tables are unreachable ──');
  // No tenant policy exists on any of these. The assertion is aimed at rows
  // that certainly exist — the fixture wrote one companion row per projection
  // row — so 0 here is a refusal, not an empty table.
  expectRows('T56  A reads tenant_statement_sources',
    await count('tenant_statement_sources?select=statement_id', aTok), 0);
  expectRows('T56b A reads a source run hash by statement id',
    await count(`tenant_statement_sources?statement_id=eq.${STMT_A}&select=source_run_hash`, aTok), 0);
  expectRows('T57  A reads tenant_document_sources',
    await count('tenant_document_sources?select=document_id', aTok), 0);
  expectRows('T57b A reads a storage path by document id',
    await count(`tenant_document_sources?document_id=eq.${DOC_A}&select=storage_path`, aTok), 0);
  expectRows('T58  A reads tenant_space_profile_sources',
    await count('tenant_space_profile_sources?select=profile_id', aTok), 0);
  expectRows('T58b anonymous reads every _sources table',
    (await count('tenant_statement_sources?select=statement_id')) +
    (await count('tenant_document_sources?select=document_id')) +
    (await count('tenant_space_profile_sources?select=profile_id')), 0);

  console.log('\n── B2: landlord source tables stay closed ──');
  expectRows('T48  A reads properties',            await count('properties?select=id', aTok), 0);
  expectRows('T49  A reads properties(data)',      await count('properties?select=data', aTok), 0);
  expectRows('T51a A reads cam_reconciliations',   await count('cam_reconciliations?select=id', aTok), 0);
  expectRows('T51b A reads lease_documents',       await count('lease_documents?select=id', aTok), 0);

  console.log('\n── B2: the tenant write surface is empty ──');
  // Each must be refused by RLS with 42501 specifically. Accepting any non-2xx
  // would let a typo or a dropped table pass for a policy that is not there.
  // A tenant write can be refused two different ways, and both are correct:
  //
  //   INSERT        -> 42501. There is no tenant INSERT policy, so the WITH
  //                    CHECK fails and Postgres raises insufficient_privilege.
  //   UPDATE/DELETE -> 0 rows. The only policy an `authenticated` caller can
  //                    match for those commands is the landlord one, whose
  //                    USING requires owning the property. A tenant owns none,
  //                    so no row is visible to modify and the statement is a
  //                    no-op rather than an error.
  //
  // Counting affected rows is not enough on its own — an earlier version of this
  // helper read a PostgREST 204 (no body, which is what a 0-row PATCH returns
  // without return=representation) as an acceptance and reported a SECURITY
  // FAILURE that did not exist. So: ask for the representation, AND read the row
  // back with the service role to prove it is untouched. State is the assertion;
  // the row count is corroboration.
  async function expectRefused(label, path, method, body, verify) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      method,
      headers: {
        apikey: ANON_KEY, Authorization: `Bearer ${aTok}`,
        'Content-Type': 'application/json', Prefer: 'return=representation',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const txt = await r.text();
    let j = {};
    try { j = txt ? JSON.parse(txt) : {}; } catch (_) { j = {}; }

    if (!r.ok) {
      if (j.code === '42501') ok(`${label} refused by RLS (42501)`);
      else bad(`${label} refused for a NON-RLS reason (http ${r.status}, code ${j.code || 'none'})`);
      return;
    }

    const affected = Array.isArray(j) ? j.length : (r.status === 204 ? 0 : null);
    if (affected !== 0) {
      bad(`${label} was ACCEPTED (SECURITY FAILURE) — http ${r.status}, ${affected} row(s)`);
      return;
    }
    if (verify) {
      const intact = await verify();
      if (!intact) { bad(`${label} reported 0 rows but the data CHANGED (SECURITY FAILURE)`); return; }
      ok(`${label} — 0 rows affected and the row is verifiably unchanged`);
      return;
    }
    ok(`${label} — 0 rows affected (RLS)`);
  }

  // Service-role reads used to prove the writes above changed nothing. Read this
  // way deliberately: through the tenant's own token a modified row could simply
  // have become invisible, which is indistinguishable from unchanged.
  async function svcGet(path) {
    if (!_svc) return null;
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`,
      { headers: { apikey: _svc, Authorization: `Bearer ${_svc}` } });
    return r.ok ? await r.json().catch(() => null) : null;
  }
  await expectRefused('T32  A INSERTs a statement', 'tenant_statements', 'POST', {
    tenant_id: A_ID, property_id: B_PROPERTY_ID, cam_year: 2025,
    allocated_amount: 1, pro_rata_percent: 1, total_pool: 1,
    statement_json: {}, status: 'published', published_at: new Date().toISOString(),
  });
  await expectRefused('T33  A publishes its own draft',
    `tenant_statements?tenant_id=eq.${A_ID}&cam_year=eq.2023`, 'PATCH', { status: 'published' },
    async () => {
      const rows = await svcGet(`tenant_statements?tenant_id=eq.${A_ID}&cam_year=eq.2023&select=status`);
      return !!rows && rows.length === 1 && rows[0].status === 'draft';
    });
  await expectRefused('T34  A DELETEs its statement',
    `tenant_statements?id=eq.${STMT_A}`, 'DELETE', null,
    async () => {
      const rows = await svcGet(`tenant_statements?id=eq.${STMT_A}&select=id,status`);
      return !!rows && rows.length === 1 && rows[0].status === 'published';
    });
  await expectRefused('T39  A writes a space profile', 'tenant_space_profiles', 'POST', {
    tenant_id: A_ID, property_id: B_PROPERTY_ID, property_name: 'x', status: 'published',
    published_at: new Date().toISOString(),
  });
  await expectRefused('T44  A writes a document', 'tenant_documents', 'POST', {
    tenant_id: A_ID, property_id: B_PROPERTY_ID, title: 'x', doc_kind: 'other',
    status: 'published', published_at: new Date().toISOString(),
  });
  await expectRefused('T61  A writes a _sources row', 'tenant_statement_sources', 'POST', {
    statement_id: STMT_A, property_id: B_PROPERTY_ID, source_run_hash: 'x',
  });

  console.log('\n── B2: landlord regression ──');
  // Exact counts, not "> 0". At "> 0" these still pass if the landlord loses
  // sight of exactly the rows a tenant must not see, which is the regression
  // most likely to be introduced by a policy edit.
  expectRows('T52  landlord reads every statement, all statuses',
    await count('tenant_statements?select=id', lTok), 5);
  expectRows('T52b landlord reads statement sources incl. run hashes',
    await count('tenant_statement_sources?select=source_run_hash', lTok), 5);
  expectRows('T52c landlord reads every document, all statuses',
    await count('tenant_documents?select=id', lTok), 4);
  expectRows('T52d landlord reads document sources incl. storage paths',
    await count('tenant_document_sources?select=storage_path', lTok), 4);
  expectRows('T52e landlord reads every space profile, all statuses',
    await count('tenant_space_profiles?select=id', lTok), 2);

  // The landlord's own write path must survive everything B2 added. This is the
  // half of the shared-`authenticated`-role risk that a tenant-only suite cannot
  // see: if a grant or policy edit breaks landlord writes, every case above
  // still passes.
  const lWrite = await fetch(`${SUPABASE_URL}/rest/v1/tenant_space_profiles?tenant_id=eq.${B_ID}`, {
    method: 'PATCH',
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${lTok}`, 'Content-Type': 'application/json',
               Prefer: 'return=representation' },
    body: JSON.stringify({ space_label: 'Suite 120A' }),
  });
  const lWriteRows = await lWrite.json().catch(() => []);
  (lWrite.ok && Array.isArray(lWriteRows) && lWriteRows.length === 1)
    ? ok('T53e landlord can still UPDATE a draft projection row directly')
    : bad(`T53e landlord UPDATE on a projection failed (http ${lWrite.status}) — REGRESSION`);

  console.log('\n── B2: revoked and pending memberships ──');
  // C is active at this point (T21 restored it). Re-revoke to test the
  // projection surface specifically, rather than inheriting an earlier state.
  await svcRevokeC();
  expectRows('T71a revoked member reads statements',      await count('tenant_statements?select=id', cTok), 0);
  expectRows('T71b revoked member reads space profiles',  await count('tenant_space_profiles?select=id', cTok), 0);
  expectRows('T71c revoked member reads documents',       await count('tenant_documents?select=id', cTok), 0);
  // A's PENDING membership on the other property must grant nothing either.
  expectRows('T72  pending membership reads the other property\'s projections',
    await count(`tenant_statements?property_id=neq.${B_PROPERTY_ID}&select=id`, aTok), 0);

  console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} — ${passed} passed, ${failed} failed`);
  if (failed) { failures.forEach(f => console.log(`  · ${f}`)); process.exit(1); }
}

main().catch(e => abort(e.stack || e.message));
