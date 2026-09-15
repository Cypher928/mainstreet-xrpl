#!/usr/bin/env node
'use strict';
/**
 * scripts/pilot-live-fixture.js — disposable fixtures for the pilot live
 * verification gate (cross-user RLS + the D-2 evidence round trip).
 *
 *   node scripts/pilot-live-fixture.js verify-target
 *   node scripts/pilot-live-fixture.js sweep
 *   node scripts/pilot-live-fixture.js setup
 *   node scripts/pilot-live-fixture.js teardown
 *
 * WHY A SECOND FIXTURE SCRIPT
 * ---------------------------
 * scripts/b1-ci-fixture.js builds a landlord + tenants + memberships world for
 * the tenant-authorization gate. This gate needs a different world: TWO
 * landlords who must not be able to see each other, and one property that
 * carries a real tenant in properties.data so the evidence round trip has
 * something to confirm. Sharing one script would mean either fixture growing
 * objects the other does not use, and a teardown whose blast radius nobody can
 * state precisely. Two small worlds, each deleted by the run that made it.
 *
 * THE SAME THREE GUARDS, DELIBERATELY DUPLICATED
 * ----------------------------------------------
 * The target is hardcoded, the production ref is refused, and the pilot marker
 * property is probed live before anything is created. Duplicated rather than
 * factored out: a guard shared between two gates can be relaxed once and weaken
 * both, and the whole value of the marker probe is that it is a fact about THIS
 * key at THIS moment rather than a claim inherited from somewhere else.
 *
 * PILOT ONLY. This script both reads and WRITES, so it refuses to run anywhere
 * else and stops before the first insert if it cannot prove where it is.
 */

const fs     = require('fs');
const path   = require('path');
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
const FIXTURE_PREFIX       = 'plci-';

const STATE_FILE = path.join(process.cwd(), '.pilot-live-state.json');

// Teardown can only remove what state knows about, so state is recorded the
// moment each object exists rather than once at the end. The first run of the
// b1 gate proved why: setup failed part-way and teardown reported "nothing to
// tear down" while nine objects sat in the database. Cleanup that only works on
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

  // TWO LANDLORDS, NOT A LANDLORD AND A TENANT. The boundary under test here is
  // between two accounts that are each fully entitled to their own data, which
  // is a different claim from "a tenant sees only its own suite" (that one is
  // b1-authorization.yml). B owns nothing at all: a fresh account that can see
  // any row anywhere is the failure this gate exists to catch, and giving B its
  // own property would make "0 rows" ambiguous.
  const userA = await createUser('a', runId);
  const userB = await createUser('b', runId);

  const props = await rest('/properties', {
    method: 'POST',
    body: JSON.stringify([
      { user_id: userA.id, name: `Pilot Live CI ${runId} — A`, sqft: 60000, data: {} },
    ]),
  });
  if (!props.ok || props.body.length !== 1) die(`could not create fixture property: ${JSON.stringify(props.body)}`);
  const propA = props.body[0];
  remember('propertyIds', propA.id);

  const tenants = await rest('/tenants', {
    method: 'POST',
    body: JSON.stringify([
      { property_id: propA.id, name: 'CI Roundtrip Tenant', sqft: 14000,
        start_date: '2024-04-01', end_date: '2027-03-31', lease_type: 'NNN' },
    ]),
  });
  if (!tenants.ok || tenants.body.length !== 1) die(`could not create fixture tenant: ${JSON.stringify(tenants.body)}`);
  const tenant = tenants.body[0];

  // THE TENANT MUST ALSO EXIST IN properties.data, and this is not redundancy.
  // loadPropertyData reads its tenants from the blob when the blob has any, and
  // falls back to the tenants table only for legacy rows. The evidence overlay
  // is applied to whichever list came back. A fixture that populated only the
  // table would exercise the legacy path — the one real properties do not use —
  // and the round trip would prove nothing about how a manager's confirmation
  // actually survives a reload.
  //
  // partial_period_basis is deliberately ABSENT: the scenario is a lease that
  // says nothing about apportioning a partial year, which is what makes the
  // manager's confirmation the only thing standing behind the answer.
  const blobTenant = {
    id:          tenant.id,
    tenant_name: 'CI Roundtrip Tenant',
    leased_sqft: 14000,
    start_date:  '2024-04-01',
    end_date:    '2027-03-31',
    lease_type:  'NNN',
    cap:         null,
    confidence:  { leased_sqft: 96 },
  };
  const patched = await rest(`/properties?id=eq.${propA.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ data: { tenants: [blobTenant], invoices: [], camYear: 2025 } }),
  });
  if (!patched.ok) die(`could not seed properties.data.tenants: ${JSON.stringify(patched.body)}`);

  const st = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  st.runId = runId;
  fs.writeFileSync(STATE_FILE, JSON.stringify(st, null, 2));

  // Two naming schemes for one pair of accounts, on purpose. test-rls-cross-user
  // talks about USER_A and USER_B because its subject is the boundary between
  // them; the evidence round trip and the Supabase integration suite talk about
  // TEST_* because their subject is one account's own data. Aliasing them to a
  // single name would make each suite read as if it were about the other's
  // concern.
  const env = {
    USER_A_EMAIL:   userA.email,
    USER_A_PASS:    userA.password,
    USER_A_PROP_ID: propA.id,
    USER_B_EMAIL:   userB.email,
    USER_B_PASS:    userB.password,

    TEST_EMAIL:     userA.email,
    TEST_PASSWORD:  userA.password,
    TEST_PROP_ID:   propA.id,
    TEST_TENANT_ID: tenant.id,
  };

  if (process.env.GITHUB_ENV) {
    fs.appendFileSync(process.env.GITHUB_ENV,
      Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n') + '\n');
  } else {
    // Local use: print exports, with the passwords included deliberately —
    // they are throwaway and the operator needs them to run the suites by hand.
    console.log(Object.entries(env).map(([k, v]) => `export ${k}='${v}'`).join('\n'));
  }

  log(`✓ fixtures created — 2 landlords, 1 property, 1 tenant (blob + table) (run ${runId})`);
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

  // Not a formality. teardown deletes by id, and a property row that survived
  // the DELETE would take its tenant_field_evidence rows with it — so the run
  // reports what is actually left rather than what it asked for.
  let residue = 0;
  for (const id of state.propertyIds || []) {
    const r = await rest(`/properties?id=eq.${id}&select=id`);
    if (r.ok && Array.isArray(r.body) && r.body.length) { residue++; console.error(`::warning::property ${id} still present after delete`); }
  }
  for (const id of state.userIds || []) {
    const r = await admin(`/admin/users/${id}`);
    if (r.ok && r.body && r.body.id === id) { residue++; console.error(`::warning::user ${id} still present after delete`); }
  }

  fs.unlinkSync(STATE_FILE);
  if (failed || residue) die(`teardown left ${failed + residue} object(s) behind — sweep will retry on the next run`);
  log(`✓ fixtures removed — ${(state.propertyIds || []).length} propert(ies), ${(state.userIds || []).length} user(s); re-read confirms none remain`);
}

const verb = process.argv[2];
const verbs = { 'verify-target': verifyTarget, sweep, setup, teardown };
if (!verbs[verb]) die(`usage: pilot-live-fixture.js <verify-target|sweep|setup|teardown>`);
verbs[verb]().catch(e => die(e && e.stack ? e.stack : String(e)));
