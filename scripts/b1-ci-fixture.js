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

  // A active, B active on the SAME property, C revoked on the other property,
  // and A additionally PENDING on that other property.
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
      // A PENDING membership for A on the other property's tenant: invited,
      // never accepted. Without it, tenant_users_self_select's
      // `accepted_at is not null` conjunct is untested — a truth table over the
      // predicate shows deleting that conjunct changes the outcome for exactly
      // one shape of row, a pending one, and the first three rows above have
      // none. It is also the case that matters in practice: an invitation that
      // was issued and never redeemed must grant nothing.
      { user_id: tA.id, tenant_id: tenant3.id, property_id: p2.id, accepted_at: null, revoked_at: null },
    ]),
  });
  if (!mem.ok || mem.body.length !== 4) die(`could not create fixture memberships: ${JSON.stringify(mem.body)}`);

  // ── B2 publish source ─────────────────────────────────────────────────────
  // The publish endpoint refuses without exactly one cam_reconciliations row for
  // (property, tenant, year), and refuses again if the property changed after it
  // was computed. reconciled_at is set to now(), which is after the property was
  // created a moment ago, so the staleness check passes for the right reason
  // rather than because the check is inert.
  //
  // Tenant B gets the reconciliation, deliberately: tenant A's statements are
  // already fixed rows above, and publishing over them would make T22's count
  // depend on whether T53 had run yet. B has one published statement and no
  // publish traffic, so a new version there is unambiguous.
  const recon = await rest('/cam_reconciliations', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify([{
      property_id: p1.id, tenant_id: tenant2.id, tenant_name: 'CI Tenant Bravo',
      year: 2025, actual_cam: 8200.00, expected_cam: 7000.00, variance: 1200.00,
      allocated_amount: 8200.00, pro_rata_percent: 6.1000, total_expenses: 134426.23,
      reconciled_at: new Date().toISOString(),
    }]),
  });
  if (!recon.ok || recon.body.length !== 1) die(`could not create fixture reconciliation: ${JSON.stringify(recon.body)}`);

  // ── B2 projections ────────────────────────────────────────────────────────
  // Every status the tenant policies discriminate on has to exist, or the
  // negative cases pass by accident: a "draft returns 0 rows" assertion is
  // vacuous when no draft row was ever created. So each projection gets a
  // published row AND at least one row in every state that must stay hidden.
  //
  // These are written with the service role, which is how the publish endpoints
  // write in production. No tenant policy is involved on the way in.
  const profiles = await rest('/tenant_space_profiles', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify([
      // A: published — the one row tenant A may read.
      { tenant_id: tenant1.id, property_id: p1.id, property_name: `B1 CI ${runId} P1`,
        property_address: '1400 Maple Ave', space_label: 'Suite 210',
        rentable_sqft: 12000, lease_type: 'NNN', lease_start: '2023-01-01',
        lease_end: '2027-12-31', pro_rata_percent: 8.4210,
        manager_name: 'CI Manager', manager_email: 'ci@pilot.invalid',
        status: 'published', published_at: now },
      // B: draft — must stay invisible to B.
      { tenant_id: tenant2.id, property_id: p1.id, property_name: `B1 CI ${runId} P1`,
        property_address: null, space_label: 'Suite 120',
        rentable_sqft: 9000, lease_type: 'Modified Gross', lease_start: null,
        lease_end: null, pro_rata_percent: null,
        manager_name: null, manager_email: null,
        status: 'draft', published_at: null },
    ]),
  });
  if (!profiles.ok || profiles.body.length !== 2) die(`could not create fixture space profiles: ${JSON.stringify(profiles.body)}`);

  const stmts = await rest('/tenant_statements', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify([
      // A 2024 published — the only statement A may read.
      { tenant_id: tenant1.id, property_id: p1.id, cam_year: 2024, version: 1,
        allocated_amount: 12960.75, pro_rata_percent: 8.4210, total_pool: 153900.00,
        amount_billed: 11400.00, balance_due: 1560.75, currency: 'usd',
        statement_json: { line_items: [{ label: 'Landscaping', pool_amount: 18400, your_share: 1549.46 }],
                          method_note: 'Allocated by rentable square footage.' },
        status: 'published', published_at: now },
      // A 2023 draft, 2022 superseded, 2021 void — three ways to be hidden.
      { tenant_id: tenant1.id, property_id: p1.id, cam_year: 2023, version: 1,
        allocated_amount: 11204.10, pro_rata_percent: 8.4210, total_pool: 133000.00,
        amount_billed: 11204.10, balance_due: 0, currency: 'usd',
        statement_json: { line_items: [] }, status: 'draft', published_at: null },
      { tenant_id: tenant1.id, property_id: p1.id, cam_year: 2022, version: 1,
        allocated_amount: 9000.00, pro_rata_percent: 8.4210, total_pool: 106000.00,
        amount_billed: 9000.00, balance_due: 0, currency: 'usd',
        statement_json: { line_items: [] }, status: 'superseded', published_at: now },
      { tenant_id: tenant1.id, property_id: p1.id, cam_year: 2021, version: 1,
        allocated_amount: 8000.00, pro_rata_percent: 8.4210, total_pool: 95000.00,
        amount_billed: 8000.00, balance_due: 0, currency: 'usd',
        statement_json: { line_items: [] }, status: 'void', published_at: now },
      // B published — proves cross-tenant isolation against a REAL published row
      // rather than against an empty table.
      { tenant_id: tenant2.id, property_id: p1.id, cam_year: 2024, version: 1,
        allocated_amount: 7777.00, pro_rata_percent: 6.1000, total_pool: 153900.00,
        amount_billed: 7000.00, balance_due: 777.00, currency: 'usd',
        statement_json: { line_items: [] }, status: 'published', published_at: now },
    ]),
  });
  if (!stmts.ok || stmts.body.length !== 5) die(`could not create fixture statements: ${JSON.stringify(stmts.body)}`);
  const stmtAPublished = stmts.body.find(s => s.tenant_id === tenant1.id && s.status === 'published');

  // Companion rows: what a tenant must never reach.
  const stmtSrc = await rest('/tenant_statement_sources', {
    method: 'POST',
    body: JSON.stringify(stmts.body.map(s => ({
      statement_id: s.id, property_id: s.property_id,
      source_reconciliation_id: null,
      source_run_hash: 'ci-' + s.id.slice(0, 8),
      superseded_by: null, published_by: landlord.id,
    }))),
  });
  if (!stmtSrc.ok) die(`could not create fixture statement sources: ${JSON.stringify(stmtSrc.body)}`);

  const docs = await rest('/tenant_documents', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify([
      { tenant_id: tenant1.id, property_id: p1.id, title: '2024 CAM Statement',
        doc_kind: 'statement', content_type: 'application/pdf', byte_size: 184320,
        status: 'published', published_at: now },
      { tenant_id: tenant1.id, property_id: p1.id, title: 'Draft notice',
        doc_kind: 'notice', content_type: 'application/pdf', byte_size: 1024,
        status: 'draft', published_at: null },
      { tenant_id: tenant1.id, property_id: p1.id, title: 'Withdrawn notice',
        doc_kind: 'notice', content_type: 'application/pdf', byte_size: 2048,
        status: 'withdrawn', published_at: now },
      { tenant_id: tenant2.id, property_id: p1.id, title: "B's lease",
        doc_kind: 'lease', content_type: 'application/pdf', byte_size: 4096,
        status: 'published', published_at: now },
    ]),
  });
  if (!docs.ok || docs.body.length !== 4) die(`could not create fixture documents: ${JSON.stringify(docs.body)}`);
  const docAPublished = docs.body.find(d => d.tenant_id === tenant1.id && d.status === 'published');
  const docBPublished = docs.body.find(d => d.tenant_id === tenant2.id);

  const docSrc = await rest('/tenant_document_sources', {
    method: 'POST',
    body: JSON.stringify(docs.body.map(d => ({
      document_id: d.id, property_id: d.property_id,
      storage_path: `${landlord.id}/ci-${d.id.slice(0, 8)}.pdf`,
      storage_bucket: 'lease-documents',
      lease_document_id: null, statement_id: null, published_by: landlord.id,
    }))),
  });
  if (!docSrc.ok) die(`could not create fixture document sources: ${JSON.stringify(docSrc.body)}`);

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
    // C's own space, under its own names. Same ids as OTHER_PROPERTY_* above,
    // but the re-invitation test (T17/T18) reads them as "the space C was
    // revoked from", not as "a space A cannot see" — aliasing the two roles to
    // one variable would make that test read as if it were about A.
    TENANT_C_TENANT_ID: tenant3.id,
    TENANT_C_PROPERTY_ID: p2.id,
    // B2 — ids the projection cases aim at, so a 0-row result can be shown to
    // be a refusal rather than an empty table.
    STMT_A_PUBLISHED_ID: stmtAPublished.id,
    DOC_A_PUBLISHED_ID:  docAPublished.id,
    DOC_B_PUBLISHED_ID:  docBPublished.id,
    LANDLORD_USER_ID:    landlord.id,
    // The publish round-trip targets B on P1, for the 2025 reconciliation above.
    PUBLISH_PROPERTY_ID: p1.id,
    PUBLISH_TENANT_ID:   tenant2.id,
    PUBLISH_CAM_YEAR:    '2025',
    DOC_A_DRAFT_ID:      docs.body.find(d => d.status === 'draft').id,
  };

  if (process.env.GITHUB_ENV) {
    fs.appendFileSync(process.env.GITHUB_ENV,
      Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n') + '\n');
  } else {
    // Local use: print exports, with the passwords included deliberately —
    // they are throwaway and the operator needs them to run the suite by hand.
    console.log(Object.entries(env).map(([k, v]) => `export ${k}='${v}'`).join('\n'));
  }

  log(`✓ fixtures created — 1 landlord, 2 properties, 3 tenants, 4 memberships (2 active, 1 revoked, 1 pending) (run ${runId})`);
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
