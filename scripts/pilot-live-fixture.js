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
 * THE ORGANISATION NOBODY ASKED FOR
 * ---------------------------------
 * Inserting the first property for a fresh landlord fires migration 024's
 * properties_default_organization trigger, which creates an organisation named
 * after the landlord's email plus an admin membership. Teardown used to delete
 * the property and the users and stop: the membership went with the user
 * (ON DELETE CASCADE) but the organisation did not (created_by is ON DELETE
 * SET NULL), so every run left one creator-less, member-less, property-less
 * organisation behind — 88 of them on Pilot between 2026-09-18 and 2026-10-07,
 * one per run of this gate and of the b1 gate. The organisation is now recorded
 * the moment the property insert returns it, deleted after the property
 * (properties.organization_id is ON DELETE RESTRICT) and BEFORE the users (so
 * created_by is still set and is restated in the DELETE), and re-read
 * afterwards like everything else. Only a row whose name has the fixture shape
 * and whose creator is one of this run's users is ever deleted, and a DELETE
 * that matches anything but exactly one row fails the step. Landlord B owns no
 * property, so the trigger never runs for B and B has no organisation.
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

// The organisation the 024 trigger creates is named after the landlord's email,
// so a fixture organisation is exactly `<prefix><runId>-<tag>@pilot.invalid`.
// Nothing with any other name is ever deleted by this script. The run id is
// GITHUB_RUN_ID in CI and `local<millis>` by hand, hence [a-z0-9]+.
const FIXTURE_ORG_NAME = new RegExp(`^${FIXTURE_PREFIX}[a-z0-9]+-[a-z]+@${FIXTURE_EMAIL_DOMAIN.replace(/\./g, '\\.')}$`);
function isFixtureOrgName(name) { return typeof name === 'string' && FIXTURE_ORG_NAME.test(name); }

const STATE_FILE = path.join(process.cwd(), '.pilot-live-state.json');

// Teardown can only remove what state knows about, so state is recorded the
// moment each object exists rather than once at the end. The first run of the
// b1 gate proved why: setup failed part-way and teardown reported "nothing to
// tear down" while nine objects sat in the database. Cleanup that only works on
// the happy path is not cleanup.
//
// `organizations` entries are objects — { id, createdBy, name } — because the
// DELETE restates all three. A state file written before that key existed is
// read without it.
function remember(key, value) {
  let s = { runId: null, userIds: [], propertyIds: [], organizations: [] };
  if (fs.existsSync(STATE_FILE)) s = Object.assign(s, JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')));
  if (!Array.isArray(s[key])) s[key] = [];
  const idOf = (v) => (v && typeof v === 'object') ? v.id : v;
  if (!s[key].some(v => idOf(v) === idOf(value))) s[key].push(value);
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

  const io = { rest, admin, warn: (m) => console.error(`::warning::${m}`) };
  let swept = 0;
  for (const u of stale) if ((await sweepUser(u, io)).swept) swept++;
  log(`✓ sweep complete — ${swept} of ${stale.length} stale account(s) removed`);
}

// One stale account, in the same order teardown uses: properties, then the
// organisation(s) the account created, then the account. Properties cascade to
// tenants, tenant_users, tenant_invitations, cam_reconciliations,
// lease_documents, lease_jobs, tenant_field_evidence and tenant_review_audit —
// verified against the live schema. The organisation cascades from nothing, so
// it is deleted here, under the same three-filter guard teardown uses, and
// BEFORE the user: deleting the user first would null created_by and leave the
// row behind for good. An organisation this script cannot explain — one whose
// name is not a fixture name, or whose delete does not match exactly one row —
// leaves the account in place too, so the next sweep (or a person) sees it
// again rather than finding an orphan.
async function sweepUser(u, io) {
  await io.rest(`/properties?user_id=eq.${u.id}`, { method: 'DELETE', prefer: 'return=minimal' });
  const orgs = await io.rest(`/organizations?created_by=eq.${u.id}&select=id,name`);
  if (!orgs.ok || !Array.isArray(orgs.body)) {
    io.warn(`could not list organisations created by stale ${u.email} (http ${orgs.status}); leaving the account for the next sweep`);
    return { swept: false };
  }
  for (const o of orgs.body) {
    if (!isFixtureOrgName(o.name)) {
      io.warn(`stale ${u.email} created organisation ${o.id} named "${o.name}", which is not a fixture name — leaving account and organisation alone`);
      return { swept: false };
    }
  }
  for (const o of orgs.body) {
    const r = await io.rest(`/organizations?id=eq.${o.id}&created_by=eq.${u.id}&name=eq.${encodeURIComponent(o.name)}`, { method: 'DELETE' });
    const n = r.ok && Array.isArray(r.body) ? r.body.length : -1;
    if (n !== 1) {
      io.warn(`organisation ${o.id}: delete matched ${n < 0 ? 'nothing (http ' + r.status + ')' : n + ' row(s)'}, expected exactly 1 — leaving the account for the next sweep`);
      return { swept: false };
    }
  }
  const d = await io.admin(`/admin/users/${u.id}`, { method: 'DELETE' });
  if (!d.ok) io.warn(`could not delete stale user ${u.id} (http ${d.status})`);
  return { swept: d.ok };
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

  // The row comes back with organization_id already set: the 024 trigger ran
  // before the insert and, A being new, created the organisation it points at.
  // Recorded now, as the property was, because teardown can only remove what
  // state knows about (see the header).
  if (propA.organization_id) remember('organizations', { id: propA.organization_id, createdBy: userA.id, name: userA.email });

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

  const orgCount = (JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')).organizations || []).length;
  log(`✓ fixtures created — 2 landlords, ${orgCount} organisation(s), 1 property, 1 tenant (blob + table) (run ${runId})`);
}

// ── teardown ────────────────────────────────────────────────────────────────
// Runs under `if: always()`. A failed suite must still leave the database as it
// found it, or the next run inherits a dirty world and its result means nothing.
async function teardown() {
  requireKey();
  if (!fs.existsSync(STATE_FILE)) { log('no fixture state — nothing to tear down'); return; }
  const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));

  const io = { rest, admin, warn: (m) => console.error(`::warning::${m}`) };
  const organizations = await discoverOrganizations(state, io);
  const plan = teardownPlan({ ...state, organizations });
  const { failed, residue } = await executePlan(plan, io);

  fs.unlinkSync(STATE_FILE);
  if (failed || residue) {
    die(`teardown left ${failed + residue} object(s) behind — sweep retries stale accounts on the next run; ` +
        `an organisation whose creator is already gone is not something the sweep can reach`);
  }
  const n = (k) => plan.filter(s => s.kind === k).length;
  log(`✓ fixtures removed — ${n('delete-property')} propert(ies), ${n('delete-organization')} organisation(s), ` +
      `${n('delete-user')} user(s); re-read confirms none remain`);
}

// ── Teardown as a plan and an executor ──────────────────────────────────────
// teardownPlan is pure: from the state file it returns the ordered steps, so
// test-ci-fixture-teardown.js can assert the order and the guards without a
// network. executePlan carries the steps out through this file's own rest()
// and admin() — the target stays hard-coded — and the test hands it a recorder
// instead.
function teardownPlan(state) {
  const props = state.propertyIds || [], users = state.userIds || [], orgs = state.organizations || [];
  const steps = [];
  for (const id of props) steps.push({ kind: 'delete-property', id });
  // Organisations after the properties (properties.organization_id is ON
  // DELETE RESTRICT) and BEFORE the users: once the user is gone created_by is
  // null and can no longer be restated in the DELETE.
  for (const o of orgs) {
    if (!isFixtureOrgName(o.name))         steps.push({ kind: 'refuse-organization', id: o.id, name: o.name, why: 'not a fixture organisation name' });
    else if (!users.includes(o.createdBy)) steps.push({ kind: 'refuse-organization', id: o.id, name: o.name, why: 'not created by one of this run\'s users' });
    else                                    steps.push({ kind: 'delete-organization', id: o.id, createdBy: o.createdBy, name: o.name });
  }
  for (const id of users) steps.push({ kind: 'delete-user', id });
  // Not a formality. Deletes are by id, and a property row that survived the
  // DELETE would take its tenant_field_evidence rows with it — so the run
  // reports what is actually left rather than what it asked for.
  for (const id of props) steps.push({ kind: 'verify-absent', table: 'properties', id });
  for (const s of steps.filter(x => x.kind === 'delete-organization')) steps.push({ kind: 'verify-absent', table: 'organizations', id: s.id });
  for (const id of users) steps.push({ kind: 'verify-absent-user', id });
  return steps;
}

// Every organisation this run's users created, recorded or not — a setup that
// died between the property insert and the state write still created one.
// Read while the users exist, so created_by is still on the row.
async function discoverOrganizations(state, io) {
  const known = (state.organizations || []).slice();
  for (const uid of state.userIds || []) {
    const r = await io.rest(`/organizations?created_by=eq.${uid}&select=id,name,created_by`);
    if (!r.ok || !Array.isArray(r.body)) {
      io.warn(`could not list organisations created by ${uid} (http ${r.status}); tearing down the recorded ones only`);
      continue;
    }
    for (const o of r.body) if (!known.some(k => k.id === o.id)) known.push({ id: o.id, createdBy: o.created_by, name: o.name });
  }
  return known;
}

async function executePlan(plan, io) {
  let failed = 0, residue = 0;
  for (const s of plan) {
    if (s.kind === 'delete-property') {
      const r = await io.rest(`/properties?id=eq.${s.id}`, { method: 'DELETE', prefer: 'return=minimal' });
      if (!r.ok) { failed++; io.warn(`could not delete property ${s.id} (http ${r.status})`); }
    } else if (s.kind === 'delete-organization') {
      // Three filters, all restated: the id this run recorded, the user that
      // created it, and the exact fixture name. The DELETE returns the rows it
      // removed and exactly one is required — a filter that matched nothing
      // is a failure, not a no-op.
      const r = await io.rest(`/organizations?id=eq.${s.id}&created_by=eq.${s.createdBy}&name=eq.${encodeURIComponent(s.name)}`, { method: 'DELETE' });
      const n = r.ok && Array.isArray(r.body) ? r.body.length : -1;
      if (n !== 1) { failed++; io.warn(`organisation ${s.id}: delete matched ${n < 0 ? 'nothing (http ' + r.status + ')' : n + ' row(s)'}, expected exactly 1`); }
    } else if (s.kind === 'refuse-organization') {
      residue++; io.warn(`not deleting organisation ${s.id} (${s.name}): ${s.why}`);
    } else if (s.kind === 'delete-user') {
      const r = await io.admin(`/admin/users/${s.id}`, { method: 'DELETE' });
      if (!r.ok) { failed++; io.warn(`could not delete user ${s.id} (http ${r.status})`); }
    } else if (s.kind === 'verify-absent') {
      const r = await io.rest(`/${s.table}?id=eq.${s.id}&select=id`);
      if (r.ok && Array.isArray(r.body) && r.body.length) { residue++; io.warn(`${s.table} row ${s.id} still present after delete`); }
    } else if (s.kind === 'verify-absent-user') {
      const r = await io.admin(`/admin/users/${s.id}`);
      if (r.ok && r.body && r.body.id === s.id) { residue++; io.warn(`user ${s.id} still present after delete`); }
    }
  }
  return { failed, residue };
}

module.exports = { PILOT_REF, FIXTURE_PREFIX, FIXTURE_EMAIL_DOMAIN, isFixtureOrgName, teardownPlan, discoverOrganizations, executePlan, sweepUser };

if (require.main === module) {
  const verb = process.argv[2];
  const verbs = { 'verify-target': verifyTarget, sweep, setup, teardown };
  if (!verbs[verb]) die(`usage: pilot-live-fixture.js <verify-target|sweep|setup|teardown>`);
  verbs[verb]().catch(e => die(e && e.stack ? e.stack : String(e)));
}
