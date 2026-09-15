'use strict';
/**
 * scripts/provision-pilot-authz-fixture.js — build the fixture test-tenant-authz.js
 * needs, in the PILOT project, and print the fourteen values it wants.
 *
 *   node scripts/provision-pilot-authz-fixture.js            # plan only, writes nothing
 *   node scripts/provision-pilot-authz-fixture.js --apply    # create/update the rows
 *   node scripts/provision-pilot-authz-fixture.js --verify   # re-read and print the values
 *   node scripts/provision-pilot-authz-fixture.js --cleanup  # remove the fixture rows
 *
 * WHY A SCRIPT RATHER THAN THE SQL EDITOR
 *
 * The fixture is four auth users, two properties, four tenant rows and four
 * membership rows whose states differ in ways that are easy to get subtly wrong:
 * one accepted, one accepted on a different property, one accepted THEN revoked,
 * and one left PENDING. Three of the suite's assertions exist specifically to
 * distinguish those states, so a fixture that is nearly right produces a suite
 * that passes for the wrong reason. And every id involved is a uuid nobody
 * should be copying by hand.
 *
 * IT CANNOT TOUCH PRODUCTION
 *
 * Three independent guards, all of which must pass before a single write:
 *
 *   1. The target is resolved through test-support/supabase-target.js, which
 *      defaults to pilot. Unlike the test suites there is no force path here:
 *      a provisioning script has no business writing to the customer database
 *      under any circumstances, so `production` is refused outright.
 *   2. The resolved URL must contain the pilot project ref.
 *   3. The PILOT MARKER PROPERTY must exist. Migration 012 introduced it for
 *      exactly this purpose — "a migration that can silently run against
 *      production is a migration that eventually will" — and it exists only in
 *      the pilot database. If it is absent this script stops before writing.
 *
 * WHAT IT WILL NOT DO
 *
 * It does not create, modify or delete auth users. The four accounts are made
 * by hand in the dashboard; this resolves them BY EMAIL and refuses to proceed
 * if any is missing. A provisioning script that can mint accounts is one that
 * can mint them in the wrong project.
 *
 * IDEMPOTENT. Fixture rows carry fixed uuids under a recognisable prefix, so a
 * second --apply updates rather than duplicates, and --cleanup removes exactly
 * what this script made and nothing else.
 */

const path = require('path');
const ROOT = path.join(__dirname, '..');
const { resolveTarget } = require(path.join(ROOT, 'test-support/supabase-target.js'));

// Migration 012's own guard. Present only in pilot.
const PILOT_MARKER_PROPERTY = 'fd9c09b1-b657-4c58-9999-c3cce28e7600';
const PILOT_REF             = 'bhmktujbxdbvdmpybmad';

// Fixed ids so re-running updates instead of duplicating, and so --cleanup can
// name exactly what it removes. The f1105ada prefix marks them as fixtures.
const P1        = 'f1105ada-0000-4000-8000-000000000001';
const P2        = 'f1105ada-0000-4000-8000-000000000002';
const T_A       = 'f1105ada-1111-4000-8000-00000000000a';
const T_B       = 'f1105ada-1111-4000-8000-00000000000b';
const T_C       = 'f1105ada-1111-4000-8000-00000000000c';
const T_OTHER   = 'f1105ada-1111-4000-8000-00000000000d';
const M_A       = 'f1105ada-2222-4000-8000-00000000000a';
const M_B       = 'f1105ada-2222-4000-8000-00000000000b';
const M_C       = 'f1105ada-2222-4000-8000-00000000000c';
const M_PENDING = 'f1105ada-2222-4000-8000-00000000000d';

const EMAILS = {
  tenantA:  process.env.FIXTURE_TENANT_A_EMAIL  || 'pilot-tenant-a@mainstreet-test.local',
  tenantB:  process.env.FIXTURE_TENANT_B_EMAIL  || 'pilot-tenant-b@mainstreet-test.local',
  tenantC:  process.env.FIXTURE_TENANT_C_EMAIL  || 'pilot-tenant-c@mainstreet-test.local',
  landlord: process.env.FIXTURE_LANDLORD_EMAIL  || 'pilot-landlord@mainstreet-test.local',
};

const MODE = process.argv.includes('--apply')   ? 'apply'
           : process.argv.includes('--verify')  ? 'verify'
           : process.argv.includes('--cleanup') ? 'cleanup'
           : 'plan';

function die(msg) {
  console.error('\n\x1b[31mSTOPPED:\x1b[0m ' + msg + '\n');
  process.exit(2);
}
const say  = (m) => console.log('  ' + m);
const head = (m) => console.log('\n\x1b[1m' + m + '\x1b[0m');

// ── Guards ─────────────────────────────────────────────────────────────────
let TARGET;
try { TARGET = resolveTarget(); }
catch (e) { die(e.message); }

if (TARGET.isProduction) {
  die('this script resolved the PRODUCTION project. Provisioning never runs there, ' +
      'with or without a force variable. Unset MS_TEST_SUPABASE_TARGET.');
}
if (!TARGET.url.includes(PILOT_REF)) {
  die(`the resolved project (${TARGET.url}) is not the pilot project ${PILOT_REF}.`);
}

const SERVICE_KEY = process.env.PILOT_SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY && MODE !== 'plan') {
  die('PILOT_SUPABASE_SERVICE_ROLE_KEY is not set. Fixture rows must be written past ' +
      'RLS, which needs the service-role key from the PILOT project\'s API settings.');
}

const REST = (p) => `${TARGET.url}/rest/v1/${p}`;
const H = () => ({
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
});

async function rest(method, p, body, extraHeaders) {
  const r = await fetch(REST(p), {
    method,
    headers: Object.assign(H(), extraHeaders || {}),
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (_) { json = text; }
  if (!r.ok) {
    die(`${method} ${p} → HTTP ${r.status}\n        ${typeof json === 'string' ? json : JSON.stringify(json)}`);
  }
  return json;
}

async function findUsers() {
  const wanted = new Map(Object.entries(EMAILS).map(([k, v]) => [v.toLowerCase(), k]));
  const found = {};
  for (let page = 1; page <= 20; page++) {
    const r = await fetch(`${TARGET.url}/auth/v1/admin/users?page=${page}&per_page=200`, { headers: H() });
    if (!r.ok) die(`could not list auth users (HTTP ${r.status}). Is the service-role key correct?`);
    const j = await r.json();
    const users = j.users || [];
    for (const u of users) {
      const key = wanted.get(String(u.email || '').toLowerCase());
      if (key) found[key] = { id: u.id, email: u.email, confirmed: !!(u.email_confirmed_at || u.confirmed_at) };
    }
    if (users.length < 200) break;
  }
  const missing = Object.entries(EMAILS).filter(([k]) => !found[k]);
  if (missing.length) {
    die('these accounts do not exist in the pilot project:\n' +
        missing.map(([k, v]) => `          ${v}  (${k})`).join('\n') +
        '\n        Create them at https://supabase.com/dashboard/project/' + PILOT_REF + '/auth/users' +
        '\n        with "Auto Confirm User" ticked, or set FIXTURE_*_EMAIL to the addresses you used.');
  }
  const unconfirmed = Object.entries(found).filter(([, u]) => !u.confirmed);
  if (unconfirmed.length) {
    die('these accounts exist but are NOT confirmed, so password sign-in will fail:\n' +
        unconfirmed.map(([k, u]) => `          ${u.email}  (${k})`).join('\n') +
        '\n        Confirm them in the dashboard, or recreate with "Auto Confirm User" ticked.');
  }
  return found;
}

(async () => {
  console.log('\n' + '═'.repeat(66));
  console.log('  Pilot authz fixture — ' + MODE.toUpperCase());
  console.log('═'.repeat(66));
  say(`target: \x1b[32m${TARGET.name}\x1b[0m — ${TARGET.url}`);

  if (MODE === 'plan') {
    head('This run writes NOTHING. It is showing you what --apply would do.');
    say(`property ${P1}  "Authz Fixture — Property One"   owner: ${EMAILS.landlord}`);
    say(`property ${P2}  "Authz Fixture — Property Two"   owner: ${EMAILS.landlord}`);
    say(`tenant   ${T_A}     on Property One   ← Tenant A, membership ACCEPTED`);
    say(`tenant   ${T_B}     on Property Two   ← Tenant B, membership ACCEPTED`);
    say(`tenant   ${T_C}     on Property Two   ← Tenant C, membership ACCEPTED then REVOKED`);
    say(`tenant   ${T_OTHER}     on Property Two   ← Tenant A, membership PENDING (never accepted)`);
    head('Run again with --apply once PILOT_SUPABASE_SERVICE_ROLE_KEY is set.');
    return;
  }

  // Guard 3, and the last thing checked before any write.
  head('Confirming this is the pilot database');
  const marker = await rest('GET', `properties?id=eq.${PILOT_MARKER_PROPERTY}&select=id,name`);
  if (!Array.isArray(marker) || marker.length !== 1) {
    die(`the pilot marker property ${PILOT_MARKER_PROPERTY} was not found. ` +
        'Migration 012 uses this exact row to refuse to run outside pilot, and so does this script.');
  }
  say(`\x1b[32m✓\x1b[0m pilot marker property present`);

  if (MODE === 'cleanup') {
    head('Removing fixture rows (and nothing else)');
    await rest('DELETE', `tenant_users?id=in.(${[M_A, M_B, M_C, M_PENDING].join(',')})`);
    say('memberships removed');
    await rest('DELETE', `tenants?id=in.(${[T_A, T_B, T_C, T_OTHER].join(',')})`);
    say('tenant rows removed');
    await rest('DELETE', `properties?id=in.(${[P1, P2].join(',')})`);
    say('properties removed');
    say('auth users are NOT removed — delete them in the dashboard if you want them gone');
    return;
  }

  head('Resolving the four accounts by email');
  const U = await findUsers();
  for (const [k, u] of Object.entries(U)) say(`\x1b[32m✓\x1b[0m ${k.padEnd(9)} ${u.email}`);

  if (MODE === 'apply') {
    const merge = { Prefer: 'resolution=merge-duplicates,return=representation' };
    const now = new Date().toISOString();

    head('Properties');
    await rest('POST', 'properties', [
      { id: P1, user_id: U.landlord.id, name: 'Authz Fixture — Property One', sqft: 50000, data: {} },
      { id: P2, user_id: U.landlord.id, name: 'Authz Fixture — Property Two', sqft: 40000, data: {} },
    ], merge);
    say(`\x1b[32m✓\x1b[0m two properties owned by ${U.landlord.email}`);

    head('Tenant rows');
    await rest('POST', 'tenants', [
      { id: T_A,     property_id: P1, name: 'Fixture Tenant A',       sqft: 20000, lease_type: 'Triple Net (NNN)' },
      { id: T_B,     property_id: P2, name: 'Fixture Tenant B',       sqft: 15000, lease_type: 'Triple Net (NNN)' },
      { id: T_C,     property_id: P2, name: 'Fixture Tenant C',       sqft: 10000, lease_type: 'Triple Net (NNN)' },
      { id: T_OTHER, property_id: P2, name: 'Fixture Tenant (Other)', sqft:  5000, lease_type: 'Triple Net (NNN)' },
    ], merge);
    say('\x1b[32m✓\x1b[0m four tenant rows');

    head('Memberships — the four states the suite distinguishes');
    // Delete first: the unique constraint is (user_id, tenant_id), so a stale
    // row from an earlier shape would block the upsert rather than update.
    await rest('DELETE', `tenant_users?id=in.(${[M_A, M_B, M_C, M_PENDING].join(',')})`);
    await rest('POST', 'tenant_users', [
      // A: live. accepted_at set, revoked_at null.
      { id: M_A, user_id: U.tenantA.id, tenant_id: T_A, property_id: P1,
        invited_by: U.landlord.id, invited_at: now, accepted_at: now, revoked_at: null },
      // B: live, on the other property. T11 forges a row against this pair.
      { id: M_B, user_id: U.tenantB.id, tenant_id: T_B, property_id: P2,
        invited_by: U.landlord.id, invited_at: now, accepted_at: now, revoked_at: null },
      // C: accepted and THEN revoked. It must have been real before it was
      // withdrawn — a row that was never accepted proves something different.
      { id: M_C, user_id: U.tenantC.id, tenant_id: T_C, property_id: P2,
        invited_by: U.landlord.id, invited_at: now, accepted_at: now, revoked_at: now },
      // A again: PENDING on a second space. accepted_at NULL is the whole point
      // — T12d exists to keep the `accepted_at is not null` conjunct in the
      // policy load-bearing, and without this row it could be deleted with
      // every other test still green.
      { id: M_PENDING, user_id: U.tenantA.id, tenant_id: T_OTHER, property_id: P2,
        invited_by: U.landlord.id, invited_at: now, accepted_at: null, revoked_at: null },
    ], { Prefer: 'return=representation' });
    say('\x1b[32m✓\x1b[0m A accepted · B accepted (other property) · C revoked · A pending');
  }

  // ── Read the ids back out of the tenants table ────────────────────────────
  head('Reading the ids back from public.tenants');
  const rows = await rest('GET',
    `tenants?id=in.(${[T_A, T_B, T_C, T_OTHER].join(',')})&select=id,name,property_id`);
  const byId = Object.fromEntries(rows.map(r => [r.id, r]));
  for (const id of [T_A, T_B, T_C, T_OTHER]) {
    if (!byId[id]) die(`tenant row ${id} is missing — run with --apply first.`);
    say(`${byId[id].name.padEnd(24)} ${id}  (property ${byId[id].property_id})`);
  }

  const mem = await rest('GET',
    `tenant_users?id=in.(${[M_A, M_B, M_C, M_PENDING].join(',')})&select=id,accepted_at,revoked_at`);
  const state = (m) => m.revoked_at ? 'REVOKED' : m.accepted_at ? 'accepted' : 'PENDING';
  const memById = Object.fromEntries(mem.map(m => [m.id, m]));
  head('Membership states');
  for (const [id, label] of [[M_A, 'A on its own space'], [M_B, 'B on the other property'],
                             [M_C, 'C (must read REVOKED)'], [M_PENDING, 'A pending (must read PENDING)']]) {
    if (!memById[id]) die(`membership ${id} is missing — run with --apply first.`);
    say(`${label.padEnd(30)} ${state(memById[id])}`);
  }

  console.log('\n' + '═'.repeat(66));
  console.log('  The fourteen values test-tenant-authz.js requires');
  console.log('═'.repeat(66) + '\n');
  const pass = process.env.FIXTURE_PASSWORD || '<the password you set in the dashboard>';
  console.log([
    `TENANT_A_EMAIL=${EMAILS.tenantA}`,
    `TENANT_A_PASS=${pass}`,
    `TENANT_A_TENANT_ID=${T_A}`,
    '',
    `TENANT_B_EMAIL=${EMAILS.tenantB}`,
    `TENANT_B_PASS=${pass}`,
    `TENANT_B_TENANT_ID=${T_B}`,
    `TENANT_B_PROPERTY_ID=${P2}`,
    '',
    `TENANT_C_EMAIL=${EMAILS.tenantC}`,
    `TENANT_C_PASS=${pass}`,
    `TENANT_C_TENANT_ID=${T_C}`,
    `TENANT_C_PROPERTY_ID=${P2}`,
    '',
    `LANDLORD_EMAIL=${EMAILS.landlord}`,
    `LANDLORD_PASS=${pass}`,
    '',
    `OTHER_PROPERTY_TENANT_ID=${T_OTHER}`,
  ].join('\n'));
  console.log('\n  Optional, for four further tests:');
  console.log('    APP_ORIGIN=<pilot deployment origin>          (T15/T16)');
  console.log('    PILOT_SUPABASE_SERVICE_ROLE_KEY=<same key>    (T17/T18)\n');
})().catch(e => die(e && e.stack || String(e)));
