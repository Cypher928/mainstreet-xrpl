'use strict';
/**
 * test-pilot-evidence-roundtrip.js — D-2 against a real database.
 *
 * THE CLAIM UNDER TEST
 *
 *   A manager confirms how a partial CAM year is apportioned for a lease that
 *   says nothing about it. That confirmation is written to tenant_field_evidence.
 *   On the next load the reconciliation must report the basis AND report that a
 *   MANAGER supplied it — never that the lease did.
 *
 * WHY THIS SUITE EXISTS SEPARATELY FROM test-e2e-partial-basis-persistence.js
 *
 * The offline suite proves the logic in a browser against stubbed storage. It
 * cannot prove the part that actually broke, which was a storage fact: with
 * ms_useNormalizedEvidence on, _stripBlobs removes fieldEvidence from the
 * property blob before it is written, so the ONLY surviving record of the
 * confirmation is a row in a table on a server. When that row was not being
 * written, the value came back and its provenance did not, and
 * LeasePeriod.partialPeriodBasis reported source 'lease' — the product telling
 * the manager their own answer was the lease's language. Nothing short of a
 * real round trip through a real database can catch that returning.
 *
 * WHY NOT A BROWSER
 *
 * Pilot serves commit ac81875, which PREDATES the D-2 fix. Driving the deployed
 * app would fail correctly and tell us nothing about this branch. So the round
 * trip runs the product's own functions — extracted from script.js by name, not
 * reimplemented — in Node, against the real pilot database over real HTTP with a
 * real user's JWT and real RLS. Sixteen functions do the work; this file
 * supplies the fixture, the transport and the assertions, and nothing else.
 *
 * WHAT IS AND IS NOT THE PRODUCT'S CODE HERE
 *
 *   product   _writeTenantFieldEvidence  builds the payload and issues the write
 *   product   _evidenceRowToSnapshot     turns the row back into a snapshot
 *   product   normalizeTenant            the allow-list a loaded tenant passes
 *   product   LeasePeriod.partialPeriodBasis   the verdict
 *   product   _stripBlobs                what the blob loses on save
 *   this file the SELECT that reloads the evidence — replicated from
 *             loadPropertyData and PINNED against script.js below, so it cannot
 *             drift into testing a query the app does not make.
 *
 * PILOT ONLY. This suite WRITES. It refuses to start against production, and
 * exits non-zero rather than skipping — an unrun test must never read as a pass.
 *
 * Usage:
 *   TEST_EMAIL=… TEST_PASSWORD=… TEST_PROP_ID=… TEST_TENANT_ID=… \
 *   node test-pilot-evidence-roundtrip.js
 *
 * Exit codes: 0 all passed · 1 assertion failed · 2 refused / cannot run.
 */

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const { fnSource }      = require('./test-support/fn-source.js');
const { resolveOrAbort } = require('./test-support/supabase-target.js');

const PILOT_REF      = 'bhmktujbxdbvdmpybmad';
const PRODUCTION_REF = 'zhsuhehgehbzkmzurzyf';

// ── Reporting ───────────────────────────────────────────────────────────────
let failures = 0;
const pass = (m) => console.log('\x1b[32m  ✓\x1b[0m ' + m);
const fail = (m) => { console.error('\x1b[31m  ✗\x1b[0m ' + m); failures++; };
const info = (m) => console.log('  · ' + m);
const section = (m) => { console.log('\n▶  ' + m); console.log('─'.repeat(70)); };
function assert(cond, label, detail) {
  if (cond) pass(label); else fail(label + (detail ? ' — ' + detail : ''));
  return !!cond;
}
function abort(msg) {
  console.error('\nABORT [pilot-evidence-roundtrip]: ' + msg);
  console.error('This suite exits non-zero rather than skipping — an unrun test must never read as a pass.');
  process.exit(2);
}

// ── Target ──────────────────────────────────────────────────────────────────
const TARGET = resolveOrAbort('pilot-evidence-roundtrip');
// The resolver already refuses production without a force token. This is the
// second lock, and it is not redundant: the resolver answers "which target did
// configuration ask for", and this answers "is the thing we are about to WRITE
// to the pilot project". A suite that inserts rows should not rely on a single
// check, however good, made somewhere else.
if (TARGET.isProduction || TARGET.url.includes(PRODUCTION_REF) || !TARGET.url.includes(PILOT_REF)) {
  abort('this suite WRITES and will only ever write to pilot ' + PILOT_REF + '. Resolved: ' + TARGET.url);
}

const EMAIL     = process.env.TEST_EMAIL;
const PASSWORD  = process.env.TEST_PASSWORD;
const PROP_ID   = process.env.TEST_PROP_ID;
const TENANT_ID = process.env.TEST_TENANT_ID;
for (const [k, v] of [['TEST_EMAIL', EMAIL], ['TEST_PASSWORD', PASSWORD],
                      ['TEST_PROP_ID', PROP_ID], ['TEST_TENANT_ID', TENANT_ID]]) {
  if (!v) abort(k + ' is not set. This suite needs a disposable pilot fixture — see scripts/pilot-live-fixture.js setup.');
}

// ── The product's own code ──────────────────────────────────────────────────
// Extracted BY NAME and brace-matched (test-support/fn-source.js), so a
// signature change or an added comment cannot silently turn this suite into a
// test of nothing. A name that stops resolving is a hard failure here.
const PRODUCT_FNS = [
  'toISODate', 'extractDatesFromText', 'cleanTenantName', '_dateWithRaw',
  'getLatestFieldEvidence', 'hasFieldQuote', 'sqftConfidenceScore',
  'getFieldConfidence', 'getEffectiveLeaseField', '_extractionVersionTag',
  '_mkEvidenceSnapshot', 'normalizeTenant',
  '_evidenceValStr', '_dwStatus', '_evidenceRowToSnapshot',
  '_writeTenantFieldEvidence', '_stripBlobs',
];

function loadProduct(scriptSrc, leaseSrc) {
  const bodies = PRODUCT_FNS.map(n => {
    try { return fnSource(scriptSrc, n); }
    catch (e) { abort('could not extract ' + n + ' from script.js: ' + e.message); }
  });

  const sandbox = {
    // The context brings its own intrinsics; only what script.js reaches for
    // from outside the language is supplied here.
    console: { log() {}, warn() {}, error() {}, groupCollapsed() {}, group() {}, groupEnd() {} },
    crypto:  require('crypto'),
    // The two globals the extracted functions reach for. ms_useNormalizedEvidence
    // is ON here because it is on in the app — and it is precisely the flag that
    // makes _stripBlobs discard fieldEvidence, which is what makes the normalized
    // table the only surviving record. Turning it off would test a world the
    // product does not run in.
    window: { ms_useNormalizedEvidence: true, ms_lastDualWrite: { errors: [] }, AuthService: null },
    db: null,
    _updateDualWritePill() {},
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  // lease-period.js is a real module and is loaded as one, not extracted.
  vm.runInContext(leaseSrc, sandbox);
  vm.runInContext(bodies.join('\n\n'), sandbox);
  if (!sandbox.window.LeasePeriod || typeof sandbox.window.LeasePeriod.partialPeriodBasis !== 'function') {
    abort('lease-period.js did not expose LeasePeriod.partialPeriodBasis');
  }
  return sandbox;
}

// ── The reload query, pinned ────────────────────────────────────────────────
// loadPropertyData reads the normalized evidence with this exact shape. The
// query is replicated below rather than extracted (it is four lines inside a
// 300-line function), so it is pinned here instead: if the app's read changes
// column set, filter or order, this suite must be updated rather than quietly
// keep testing the old one.
function assertReadPathUnchanged(scriptSrc) {
  const want = [
    ".from('tenant_field_evidence')",
    ".select('*')",
    ".eq('property_id', id)",
    ".order('created_at', { ascending: true })",
  ];
  const idx = scriptSrc.indexOf('[NormalizedEvidence] overlaid fieldEvidence');
  if (idx < 0) return fail('PIN: the normalized-evidence read in loadPropertyData could not be located');
  const window_ = scriptSrc.slice(Math.max(0, idx - 1400), idx);
  const missing = want.filter(w => !window_.includes(w));
  assert(missing.length === 0,
    'PIN: loadPropertyData still reads tenant_field_evidence the way this suite replays it',
    missing.join(' | '));
}

// ── Supabase client ─────────────────────────────────────────────────────────
function loadSupabaseJs() {
  try { return require('@supabase/supabase-js'); }
  catch (e) {
    abort('@supabase/supabase-js is not installed. This suite talks to the real database through the ' +
          'same client the app loads (2.112.1). Install it for the run:\n' +
          '        npm install --no-save @supabase/supabase-js@2.112.1');
  }
}

// ── Main ────────────────────────────────────────────────────────────────────
(async () => {
  console.log('\n╔════════════════════════════════════════════════════════════════════╗');
  console.log('║   D-2 evidence round trip — real pilot database, real RLS          ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝');
  info('property ' + PROP_ID + ' · tenant ' + TENANT_ID);

  const scriptSrc = fs.readFileSync(path.join(__dirname, 'script.js'), 'utf8');
  const leaseSrc  = fs.readFileSync(path.join(__dirname, 'lease-period.js'), 'utf8');

  section('Step 0: the product functions this suite runs');
  const P = loadProduct(scriptSrc, leaseSrc);
  assert(PRODUCT_FNS.every(n => typeof P[n] === 'function'),
    'all ' + PRODUCT_FNS.length + ' product functions extracted from script.js and callable');
  assertReadPathUnchanged(scriptSrc);

  const { createClient } = loadSupabaseJs();
  const client = createClient(TARGET.url, TARGET.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ── Step 1: sign in ───────────────────────────────────────────────────────
  section('Step 1: authenticate as the fixture landlord (real JWT, real RLS)');
  const { data: authData, error: authErr } = await client.auth.signInWithPassword({
    email: EMAIL, password: PASSWORD,
  });
  if (authErr || !authData?.session) {
    abort('could not sign in as the fixture account: ' + (authErr?.message || 'no session returned'));
  }
  const uid = authData.session.user.id;
  assert(true, 'signed in — auth.uid() = ' + uid);
  P.db = client;
  P.window.AuthService = { getCurrentUser: () => ({ id: uid, email: EMAIL }) };

  // ── Step 2: the lease is silent ───────────────────────────────────────────
  section('Step 2: precondition — the lease says nothing about partial periods');
  const { data: propRows, error: propErr } = await client
    .from('properties').select('id,name,data').eq('id', PROP_ID);
  if (propErr) abort('could not read the fixture property: ' + propErr.message);
  if (!propRows?.length) abort('fixture property ' + PROP_ID + ' not visible to this account');

  const blobTenantsRaw = propRows[0].data?.tenants || [];
  const tenant0 = P.normalizeTenant(blobTenantsRaw.find(t => t && t.id === TENANT_ID));
  if (!tenant0) abort('fixture tenant ' + TENANT_ID + ' is not in properties.data.tenants');

  assert(tenant0.partial_period_basis == null,
    'tenant carries no partial_period_basis before the confirmation',
    'got ' + JSON.stringify(tenant0.partial_period_basis));

  const before = P.window.LeasePeriod.partialPeriodBasis(tenant0);
  assert(before.stated === false && before.source === 'default',
    'partialPeriodBasis reads as an unstated product default, not a lease term',
    JSON.stringify(before));

  // ── Step 3: the manager confirms ──────────────────────────────────────────
  section('Step 3: manual confirmation → normalized evidence write');
  // Exactly what confirmPartialPeriodBasis builds, via the product's own
  // snapshot maker — value, manuallyEdited, approved, and nothing else.
  const snap = P._mkEvidenceSnapshot('partial_period_basis', tenant0,
    { value: 'per_diem', manuallyEdited: true, approved: true });
  assert(snap.manuallyEdited === true && snap.value === 'per_diem',
    '_mkEvidenceSnapshot produced a manual snapshot', JSON.stringify({ v: snap.value, m: snap.manuallyEdited }));
  assert(snap.reviewerUid === uid && snap.reviewerEmail === EMAIL,
    'the snapshot records WHO confirmed it', JSON.stringify({ uid: snap.reviewerUid, email: snap.reviewerEmail }));

  // WHERE "MANUAL" ACTUALLY LIVES, and it is not the confidence field.
  //
  // _mkEvidenceSnapshot reads the field's confidence as it stood WHEN THE
  // MANAGER WAS ASKED — which, for a lease that says nothing, is
  // {status:'missing', source:'default'}. That is the honest record of the
  // moment: the snapshot is a photograph of a field with no answer, plus the
  // answer a human then gave. The manual-ness is carried by manuallyEdited,
  // and every downstream reader derives it from there —
  // getFieldConfidence returns status 'manual' off that flag, and
  // partialPeriodBasis returns source 'manual' off it.
  //
  // This assertion pins the confidence as 'missing' deliberately. Asserting
  // 'manual' here would be asserting a stored value the product does not
  // write, and the suite would fail on correct behaviour.
  assert(snap.confidence?.status === 'missing',
    'snapshot confidence is the pre-confirmation reading; manual-ness rides on manuallyEdited, not on confidence_status',
    JSON.stringify(snap.confidence));

  await P._writeTenantFieldEvidence(PROP_ID, TENANT_ID, 'partial_period_basis', snap);
  const dw = P.window.ms_lastDualWrite.evidence || {};
  assert(dw.status === 'ok',
    '_writeTenantFieldEvidence wrote the row (status ok)',
    dw.status + (dw.error ? ' · ' + JSON.stringify(dw.error) : ''));
  assert((dw.rowCount || 0) === 1, 'exactly one evidence row inserted', 'rowCount=' + dw.rowCount);

  // ── Step 4: the blob loses the evidence ───────────────────────────────────
  section('Step 4: the property blob is saved — and _stripBlobs discards the evidence');
  const liveProperty = {
    id: PROP_ID, name: propRows[0].name,
    tenants: [{ ...tenant0, partial_period_basis: 'per_diem',
                fieldEvidence: { partial_period_basis: { snapshots: [snap] } } }],
    invoices: [],
  };
  const persisted = P._stripBlobs(liveProperty);
  assert(persisted.tenants[0].fieldEvidence === undefined,
    'the persisted blob carries NO fieldEvidence — the normalized table is the only record',
    JSON.stringify(persisted.tenants[0].fieldEvidence));
  assert(persisted.tenants[0].partial_period_basis === 'per_diem',
    'the persisted blob does carry the basis VALUE (the value survives, the provenance does not)');
  assert(liveProperty.tenants[0].fieldEvidence != null,
    'the IN-MEMORY property keeps its evidence — _stripBlobs strips the copy, not the original');

  const { error: saveErr } = await client
    .from('properties')
    .update({ data: { ...propRows[0].data, tenants: persisted.tenants } })
    .eq('id', PROP_ID);
  if (saveErr) abort('could not write the property blob back: ' + saveErr.message);
  pass('blob written to the database as the app would write it');

  // ── Step 5: reload ────────────────────────────────────────────────────────
  section('Step 5: reload — read back exactly as loadPropertyData does');
  async function reload() {
    const { data: rows, error } = await client
      .from('properties').select('id,name,data').eq('id', PROP_ID);
    if (error) abort('reload: property read failed: ' + error.message);
    const dbTenants = (rows[0].data?.tenants || []).map(P.normalizeTenant);

    const { data: evidRows, error: evErr } = await client
      .from('tenant_field_evidence')
      .select('*')
      .eq('property_id', PROP_ID)
      .order('created_at', { ascending: true });
    if (evErr) abort('reload: evidence read failed: ' + evErr.message);

    const evByTenant = {};
    for (const row of evidRows || []) {
      if (!evByTenant[row.tenant_id]) evByTenant[row.tenant_id] = {};
      const fk = row.field_key;
      if (!evByTenant[row.tenant_id][fk]) evByTenant[row.tenant_id][fk] = { snapshots: [] };
      evByTenant[row.tenant_id][fk].snapshots.push(P._evidenceRowToSnapshot(row));
    }
    const overlaid = dbTenants.map(t => evByTenant[t.id] ? { ...t, fieldEvidence: evByTenant[t.id] } : t);
    return { tenant: overlaid.find(t => t.id === TENANT_ID), rawRows: evidRows || [] };
  }

  const r1 = await reload();
  assert(!!r1.tenant, 'the tenant came back from the reload');

  const evRow = r1.rawRows.find(r => r.tenant_id === TENANT_ID && r.field_key === 'partial_period_basis');
  assert(!!evRow, 'the evidence row is in tenant_field_evidence after the round trip');
  if (evRow) {
    info('row: value=' + evRow.value + ' confidence_status=' + evRow.confidence_status +
         ' manually_edited=' + evRow.manually_edited + ' approved=' + evRow.approved);
    assert(evRow.value === 'per_diem',              'row.value survived as per_diem');
    assert(evRow.manually_edited === true,          'row.manually_edited survived as true — this is what makes it MANUAL');
    assert(evRow.confidence_status === 'missing',   'row.confidence_status is the pre-confirmation reading, stored verbatim',
                                                    String(evRow.confidence_status));
    assert(evRow.reviewer_uid === uid,              'row.reviewer_uid records who confirmed it', String(evRow.reviewer_uid));
    assert(evRow.reviewer_email === EMAIL,          'row.reviewer_email records who confirmed it', String(evRow.reviewer_email));
    assert(evRow.approved === true,                 'row.approved survived as true');
  }

  const restored = P.getLatestFieldEvidence('partial_period_basis', r1.tenant);
  assert(restored?.manuallyEdited === true,
    'the reloaded snapshot is manual — _evidenceRowToSnapshot preserved the provenance',
    JSON.stringify(restored));
  assert(restored?.reviewerEmail === EMAIL,
    'the reloaded snapshot still names the reviewer', String(restored?.reviewerEmail));

  // ── Step 6: the verdict ───────────────────────────────────────────────────
  section('Step 6: the verdict — a manager\'s answer must never read as the lease\'s');
  const after = P.window.LeasePeriod.partialPeriodBasis(r1.tenant);
  info('partialPeriodBasis → ' + JSON.stringify(after));
  assert(after.basis === 'per_diem', 'basis is per_diem after the round trip', JSON.stringify(after));
  assert(after.stated === true,      'the basis reads as stated, so the tenant is not held for a confirmation already given');
  assert(after.source === 'manual',
    'source is MANUAL, not "lease" — THE D-2 CLAIM',
    'got source=' + after.source);

  const conf = P.getFieldConfidence('partial_period_basis', r1.tenant);
  assert(conf.status === 'manual' && conf.source === 'manual',
    'getFieldConfidence agrees the field was manually corrected', JSON.stringify(conf));

  // ── Step 7: the value can vanish and the answer still holds ───────────────
  section('Step 7: the blob loses the VALUE too — the evidence row still answers');
  // Not hypothetical. The blob is written on a debounce and the evidence row is
  // written immediately, so a navigation between the two leaves exactly this
  // state: no value, one manual snapshot. The tenant was being held for a
  // confirmation that had already been given.
  const strippedTenants = persisted.tenants.map(t => ({ ...t, partial_period_basis: null }));
  const { error: strErr } = await client
    .from('properties').update({ data: { ...propRows[0].data, tenants: strippedTenants } }).eq('id', PROP_ID);
  if (strErr) abort('could not write the value-less blob: ' + strErr.message);

  const r2 = await reload();
  assert(r2.tenant.partial_period_basis == null, 'the reloaded blob really has no basis value');
  const after2 = P.window.LeasePeriod.partialPeriodBasis(r2.tenant);
  info('partialPeriodBasis → ' + JSON.stringify(after2));
  assert(after2.basis === 'per_diem' && after2.stated === true,
    'the answer is recovered from the evidence row alone', JSON.stringify(after2));
  assert(after2.source === 'manual',
    'and it is still MANUAL — recovery must not invent a lease citation', 'got ' + after2.source);

  // ── Step 8: mutation — remove the normalized write ────────────────────────
  section('Step 8: mutation — what happens if the evidence write is removed');
  // The whole suite is worth nothing unless deleting the thing D-2 added makes
  // it fail. The mutation is applied to the DATA, not the source: the evidence
  // row is deleted and the two reloads replayed. Both must come back wrong.
  const { error: delErr } = await client
    .from('tenant_field_evidence').delete()
    .eq('property_id', PROP_ID).eq('field_key', 'partial_period_basis');
  if (delErr) abort('mutation: could not delete the evidence row: ' + delErr.message);

  // Blob with the value, no evidence — the original D-2 bug exactly.
  const { error: m1Err } = await client
    .from('properties').update({ data: { ...propRows[0].data, tenants: persisted.tenants } }).eq('id', PROP_ID);
  if (m1Err) abort('mutation: could not restore the blob: ' + m1Err.message);
  const m1 = P.window.LeasePeriod.partialPeriodBasis((await reload()).tenant);
  assert(m1.source === 'lease',
    'MUTATION KILLED: with no evidence row the confirmation reads as the LEASE\'s language — ' +
    'which is the defect D-2 fixed, and this suite sees it',
    'expected source=lease, got ' + JSON.stringify(m1));

  // Blob without the value, no evidence — the tenant is held again.
  const { error: m2Err } = await client
    .from('properties').update({ data: { ...propRows[0].data, tenants: strippedTenants } }).eq('id', PROP_ID);
  if (m2Err) abort('mutation: could not restore the value-less blob: ' + m2Err.message);
  const m2 = P.window.LeasePeriod.partialPeriodBasis((await reload()).tenant);
  assert(m2.stated === false && m2.source === 'default',
    'MUTATION KILLED: with neither value nor evidence the basis is unstated again — ' +
    'the tenant is held for a confirmation already given',
    JSON.stringify(m2));

  // ── Verdict ───────────────────────────────────────────────────────────────
  // Fixture rows created by this suite live on the fixture property and go with
  // it at teardown. The evidence row is deleted above by the mutation step; the
  // delete is verified here rather than assumed, because "the mutation cleaned
  // up for us" is exactly the kind of assumption that leaves rows behind.
  const { data: leftovers } = await client
    .from('tenant_field_evidence').select('id').eq('property_id', PROP_ID);
  info('tenant_field_evidence rows remaining on the fixture property: ' + (leftovers?.length ?? '?'));

  console.log('\n' + '═'.repeat(70));
  if (failures === 0) {
    console.log('\x1b[32m  PASS — D-2 round trip verified against the real pilot database\x1b[0m');
    console.log('  manual confirmation → tenant_field_evidence → reload → source "manual"');
  } else {
    console.error('\x1b[31m  FAIL — ' + failures + ' assertion(s) failed\x1b[0m');
  }
  console.log('═'.repeat(70) + '\n');
  process.exit(failures > 0 ? 1 : 0);
})().catch(e => {
  console.error('\nRunner error:', e && e.stack ? e.stack : e);
  process.exit(1);
});
