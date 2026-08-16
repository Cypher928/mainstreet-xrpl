#!/usr/bin/env node
'use strict';
/**
 * scripts/b1-ci-fixture.js — disposable fixtures for the B1 authorization gate.
 *
 *   node scripts/b1-ci-fixture.js verify-target
 *   node scripts/b1-ci-fixture.js sweep
 *   node scripts/b1-ci-fixture.js setup
 *   node scripts/b1-ci-fixture.js teardown
 *
 * WHY A DISPOSABLE WORLD
 * ----------------------
 * The obvious way to run an authorization suite is to point it at real accounts
 * on real data. That means standing credentials in CI, real tenant rows that
 * must not be disturbed, and a test that quietly becomes a liability the moment
 * someone edits the fixture property.
 *
 * Instead each run builds its own landlord, two properties, three tenants and
 * three memberships, proves the boundary against those, and deletes them. No
 * real customer row is read or written, no real tenant account exists, and a
 * green run means the boundary held for a world the run created from nothing.
 *
 * PILOT ONLY. Every verb refuses to touch a project that is not the pilot, and
 * the check is a live probe of the supplied key rather than a claim about it —
 * a production key pasted into the pilot secret is caught before anything is
 * created. See verifyTarget().
 */

const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');

// ── Target ──────────────────────────────────────────────────────────────────
// Hardcoded, not configurable. A CI job that can be pointed at an arbitrary
// database by changing a variable is one bad edit from writing to production.
const PILOT_REF      = 'bhmktujbxdbvdmpybmad';
const PRODUCTION_REF = 'zhsuhehgehbzkmzurzyf';
const SUPABASE_URL   = `https://${PILOT_REF}.supabase.co`;

// Exists only in the pilot database. Migrations 012/013/014 use the same row as
// their guard; reusing it means CI and the migrations agree on what "pilot" is.
const PILOT_MARKER_PROPERTY = 'fd9c09b1-b657-4c58-9999-c3cce28e7600';

// Reserved TLD (RFC 2606): can never resolve, can never receive mail. Fixture
// accounts must not be reachable, and must never borrow a real domain.
const FIXTURE_EMAIL_DOMAIN = 'pilot.invalid';
const FIXTURE_PREFIX       = 'b1ci-';

const STATE_FILE = path.join(process.cwd(), '.b1-ci-state.json');

// Teardown can only remove what state knows about, so state is recorded the
// moment each object exists rather than once at the end. The first run of this
// gate proved why: setup failed after creating four users, two properties and
// three tenants but before the single end-of-setup write, so teardown reported
// "nothing to tear down" and left all nine behind. Cleanup that only works on
// the happy path is not cleanup.
function remember(key, id) {
  let s = { runId: null, userIds: [], propertyIds: [] };
  if (fs.existsSync(STATE_FILE)) s = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  if (!s[key].includes(id)) s[key].push(id);
  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
}

const KEY = (process.env.PILOT_SUPABASE_SERVICE_ROLE_KEY || '').trim();

function die(msg, code = 1) {
  console.error(`::error::${msg}`);
  process.exit(code);
}
function log(msg) { console.log(msg); }

// GitHub redacts these from every subsequent log line. Generated per run and
// never persisted, but a password echoed into a public build log is a password
// published.
function mask(v) { if (process.env.GITHUB_ACTIONS) console.log(`::add-mask::${v}`); return v; }

function requireKey() {
  if (!KEY) die('PILOT_SUPABASE_SERVICE_ROLE_KEY is not set');
  if (KEY.includes(PRODUCTION_REF)) die('the supplied key references the PRODUCTION project — refusing');
  return KEY;
}

async function rest(pathname, opts = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1${pathname}`, {
    ...opts,
    headers: {
      apikey: KEY, Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      Prefer: opts.prefer || 'return=representation',
      ...(opts.headers || {}),
    },
  });
  const text = await r.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { ok: r.ok, status: r.status, body };
}

async function admin(pathname, opts = {}) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1${pathname}`, {
    ...opts,
    headers: {
      apikey: KEY, Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  const text = await r.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { ok: r.ok, status: r.status, body };
}

// ── verify-target ───────────────────────────────────────────────────────────
// The important guard. Everything else asserts what the CONFIG says; this
// asserts what the KEY actually opens. If someone pastes the production service
// role key into the pilot secret, the marker row is absent and the run stops
// here — before a single fixture is created.
async function verifyTarget() {
  requireKey();
  if (SUPABASE_URL.includes(PRODUCTION_REF)) die('target URL is the production project — refusing');

  const r = await rest(`/properties?id=eq.${PILOT_MARKER_PROPERTY}&select=id`);
  if (!r.ok) die(`could not query the target project (http ${r.status}) — key may be invalid for ${PILOT_REF}`);
  if (!Array.isArray(r.body) || r.body.length !== 1) {
    die(`pilot marker property not found in the project this key opens. ` +
        `This is NOT the pilot database (${PILOT_REF}). Refusing to create fixtures.`);
  }
  log(`✓ key opens the pilot project ${PILOT_REF} (marker property present)`);
}

// ── sweep ───────────────────────────────────────────────────────────────────
// A cancelled run leaves its world behind. Without this they accumulate, and
// the accumulation is the failure mode nobody notices until the pilot database
// is full of half-built fixtures.
async function sweep() {
  requireKey();
  const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  const users = await admin('/admin/users?per_page=200');
  const list  = (users.body && users.body.users) || [];
  const stale = list.filter(u =>
    typeof u.email === 'string' &&
    u.email.startsWith(FIXTURE_PREFIX) &&
    u.email.endsWith(`@${FIXTURE_EMAIL_DOMAIN}`) &&
    u.created_at < cutoff
  );

  if (!stale.length) { log('✓ no stale fixtures'); return; }
  log(`sweeping ${stale.length} stale fixture account(s)`);

  for (const u of stale) {
    // Properties cascade to tenants, tenant_users, tenant_invitations,
    // cam_reconciliations, lease_documents, lease_jobs, tenant_field_evidence
    // and tenant_review_audit — verified against the live schema.
    await rest(`/properties?user_id=eq.${u.id}`, { method: 'DELETE', prefer: 'return=minimal' });
    await admin(`/admin/users/${u.id}`, { method: 'DELETE' });
  }
  log('✓ sweep complete');
}

// ── setup ───────────────────────────────────────────────────────────────────
async function createUser(tag, runId) {
  const email    = `${FIXTURE_PREFIX}${runId}-${tag}@${FIXTURE_EMAIL_DOMAIN}`;
  const password = mask(crypto.randomBytes(24).toString('base64url'));

  const r = await admin('/admin/users', {
    method: 'POST',
    body: JSON.stringify({ email, password, email_confirm: true }),
  });

  if (!r.ok) {
    const detail = typeof r.body === 'string' ? r.body : JSON.stringify(r.body);
    // The one failure we were told to stop on rather than work around.
    if (/email/i.test(detail) && /(invalid|valid|format)/i.test(detail)) {
      die(`Supabase rejected the reserved fixture domain @${FIXTURE_EMAIL_DOMAIN}:\n` +
          `  ${detail}\n` +
          `STOPPING. Not substituting a real domain — that would put fixture accounts on ` +
          `an address that can receive mail. Choose a domain you control and approve it first.`, 3);
    }
    die(`could not create fixture user ${tag} (http ${r.status}): ${detail}`);
  }
  remember('userIds', r.body.id);
  return { id: r.body.id, email, password };
}

async function setup() {
  requireKey();
  const runId = process.env.GITHUB_RUN_ID || `local${Date.now()}`;

  // One landlord. Owns everything the run creates, so teardown has a single root.
  const landlord = await createUser('landlord', runId);
  const tA = await createUser('a', runId);
  const tB = await createUser('b', runId);
  const tC = await createUser('c', runId);

  // Two properties: A and B share one (same-property isolation), C sits on the
  // other (cross-property isolation).
  const props = await rest('/properties', {
    method: 'POST',
    body: JSON.stringify([
      { user_id: landlord.id, name: `B1 CI ${runId} P1`, sqft: 50000, data: {} },
      { user_id: landlord.id, name: `B1 CI ${runId} P2`, sqft: 40000, data: {} },
    ]),
  });
  if (!props.ok || props.body.length !== 2) die(`could not create fixture properties: ${JSON.stringify(props.body)}`);
  const [p1, p2] = props.body;
  remember('propertyIds', p1.id);
  remember('propertyIds', p2.id);

  const tenants = await rest('/tenants', {
    method: 'POST',
    body: JSON.stringify([
      { property_id: p1.id, name: 'CI Tenant Alpha', sqft: 12000, lease_type: 'NNN' },
      { property_id: p1.id, name: 'CI Tenant Bravo', sqft: 9000,  lease_type: 'Modified Gross' },
      { property_id: p2.id, name: 'CI Tenant Charlie', sqft: 7000, lease_type: 'NNN' },
    ]),
  });
  if (!tenants.ok || tenants.body.length !== 3) die(`could not create fixture tenants: ${JSON.stringify(tenants.body)}`);
  const [tenant1, tenant2, tenant3] = tenants.body;

  // A active, B active on the SAME property, C revoked on the other property.
  //
  // Every object carries revoked_at explicitly, including the two where it is
  // null. PostgREST derives the column list for a bulk insert from the first
  // object and rejects the batch with PGRST102 "All object keys must match" if
  // a later one differs — so omitting the key on the active rows and setting it
  // only on the revoked row fails the whole insert. Uniform keys, varying
  // values.
  const now = new Date().toISOString();
  const mem = await rest('/tenant_users', {
    method: 'POST',
    body: JSON.stringify([
      { user_id: tA.id, tenant_id: tenant1.id, property_id: p1.id, accepted_at: now, revoked_at: null },
      { user_id: tB.id, tenant_id: tenant2.id, property_id: p1.id, accepted_at: now, revoked_at: null },
      { user_id: tC.id, tenant_id: tenant3.id, property_id: p2.id, accepted_at: now, revoked_at: now },
    ]),
  });
  if (!mem.ok || mem.body.length !== 3) die(`could not create fixture memberships: ${JSON.stringify(mem.body)}`);

  // Merge, never overwrite — the id lists were built incrementally as each
  // object was created and rewriting them here would defeat that.
  const st = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  st.runId = runId;
  fs.writeFileSync(STATE_FILE, JSON.stringify(st, null, 2));

  // tenant3 does double duty: C's revoked space, and the tenant on a property
  // A has no membership on — which is exactly the cross-property case.
  const env = {
    TENANT_A_EMAIL: tA.email, TENANT_A_PASS: tA.password,
    TENANT_B_EMAIL: tB.email, TENANT_B_PASS: tB.password,
    TENANT_C_EMAIL: tC.email, TENANT_C_PASS: tC.password,
    LANDLORD_EMAIL: landlord.email, LANDLORD_PASS: landlord.password,
    TENANT_A_TENANT_ID: tenant1.id,
    TENANT_B_TENANT_ID: tenant2.id,
    TENANT_B_PROPERTY_ID: p1.id,
    OTHER_PROPERTY_TENANT_ID: tenant3.id,
  };

  if (process.env.GITHUB_ENV) {
    fs.appendFileSync(process.env.GITHUB_ENV,
      Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n') + '\n');
  } else {
    // Local use: print exports, with the passwords included deliberately —
    // they are throwaway and the operator needs them to run the suite by hand.
    console.log(Object.entries(env).map(([k, v]) => `export ${k}='${v}'`).join('\n'));
  }

  log(`✓ fixtures created — 1 landlord, 2 properties, 3 tenants, 3 memberships (run ${runId})`);
}

// ── teardown ────────────────────────────────────────────────────────────────
// Runs under `if: always()`. A failed suite must still leave the database as it
// found it, or the next run inherits a dirty world and its result means nothing.
async function teardown() {
  requireKey();
  if (!fs.existsSync(STATE_FILE)) { log('no fixture state — nothing to tear down'); return; }
  const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));

  let failed = 0;
  for (const id of state.propertyIds || []) {
    const r = await rest(`/properties?id=eq.${id}`, { method: 'DELETE', prefer: 'return=minimal' });
    if (!r.ok) { failed++; console.error(`::warning::could not delete property ${id} (http ${r.status})`); }
  }
  for (const id of state.userIds || []) {
    const r = await admin(`/admin/users/${id}`, { method: 'DELETE' });
    if (!r.ok) { failed++; console.error(`::warning::could not delete user ${id} (http ${r.status})`); }
  }

  fs.unlinkSync(STATE_FILE);
  if (failed) die(`teardown left ${failed} object(s) behind — sweep will retry on the next run`);
  log('✓ fixtures removed');
}

const verb = process.argv[2];
const verbs = { 'verify-target': verifyTarget, sweep, setup, teardown };
if (!verbs[verb]) die(`usage: b1-ci-fixture.js <verify-target|sweep|setup|teardown>`);
verbs[verb]().catch(e => die(e && e.stack ? e.stack : String(e)));
