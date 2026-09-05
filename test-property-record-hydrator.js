'use strict';
/**
 * test-property-record-hydrator.js — M1b: the server-side PropertyRecord.
 *
 *   node test-property-record-hydrator.js
 *
 * READ-ONLY, and offline. Every transport in this suite is a function defined
 * in this file. Nothing here opens a socket, and nothing here can reach Pilot
 * or Production even if the environment happens to hold credentials.
 *
 * WHAT THIS SUITE IS FOR
 * ----------------------
 * M1b makes a claim that is easy to state and easy to get subtly wrong: this
 * record is built from the database, from this user's data, without touching a
 * browser. Eleven properties have to hold for that claim to be true, and each
 * one below is asserted against behaviour rather than against a comment.
 *
 *   A  ownership fails closed, before any transport
 *   B  service-role transport never substitutes for the ownership check
 *   C  exactly the approved reads, and nothing else
 *   D  read-only, enforced rather than merely observed
 *   E  the evidence read is load-bearing, and skipping it is detectable
 *   F  tenant precedence matches loadPropertyData's
 *   G  tenant-normalize.js is reused, not reimplemented
 *   H  no browser API is contacted
 *   I  the window shim is contained, and holds no session state
 *   J  meta.unavailable keeps its meaning and is not widened
 *   K  the server-origin metadata is structured and additive
 *
 * The single most valuable assertion in the file is E2: it removes the evidence
 * read and shows the record changes. A read whose absence changes nothing is a
 * read nobody would notice losing.
 */

const fs   = require('fs');
const path = require('path');

const H    = require('./api/_property-record-hydrator.js');
const DEPS = require('./api/_server-deps.js');
const TN   = require('./tenant-normalize.js');
const PR   = require('./property-record.js');

const HSRC = fs.readFileSync(require.resolve('./api/_property-record-hydrator.js'), 'utf8');
const DSRC = fs.readFileSync(require.resolve('./api/_server-deps.js'), 'utf8');
const SSRC = fs.readFileSync(require.resolve('./script.js'), 'utf8');

/** Source assertions must never match a comment — these comments discuss the
 *  very things being forbidden, so a naive grep would pass on the prose. */
const strip = (s) => s.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
const HCODE = strip(HSRC);
const DCODE = strip(DSRC);

let pass = 0, fail = 0;
const ok  = (m, d) => { console.log('  \x1b[32m✓\x1b[0m ' + m + (d ? '  — ' + d : '')); pass++; };
const bad = (m, d) => { console.log('  \x1b[31m✗\x1b[0m ' + m + (d ? '  — ' + d : '')); fail++; };
const is  = (c, m, d) => (c ? ok(m, d) : bad(m, d));
const eq  = (a, b, m) => (JSON.stringify(a) === JSON.stringify(b)
  ? ok(m, JSON.stringify(a))
  : bad(m, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`));
const sec = (t) => console.log('\n\x1b[1m── ' + t + ' ──\x1b[0m');

// ── Fixtures ───────────────────────────────────────────────────────────────
const PROP  = '11111111-1111-4111-8111-111111111111';
const OTHER = '99999999-9999-4999-8999-999999999999';
const USER  = '22222222-2222-4222-8222-222222222222';
const TID   = 'aaaaaaaa-0000-4000-8000-000000000001';

const BLOB_TENANT = {
  id: TID, tenant_name: 'Acme Coffee LLC', leased_sqft: 500, cap: 0.05,
  start_date: '2020-01-01', end_date: '2030-01-01',
};

const EV_ROW = {
  tenant_id: TID, field_key: 'cap', value: '0.05',
  confidence_status: 'high', confidence_note: null,
  source_file: 'lease.pdf', source_page: 3, quote: 'Section 4.2 caps CAM at 5%.',
  extraction_id: 'e1', extraction_version: 1,
  reviewer_uid: null, reviewer_email: null, reviewed_at: null,
  approved: null, manually_edited: false, original_extracted_value: null,
  created_at: '2025-01-01T00:00:00Z',
};

/**
 * A transport with a deliberately generous back end: it will hand back the
 * property for ANY id it is asked about. That is the point — the refusals below
 * have to come from the hydrator's own checks, not from a cooperative server.
 */
function transport(opt) {
  const o = Object.assign({ owns: true, blobTenants: [BLOB_TENANT], tableTenants: [],
                            evidence: [], propStatus: 200, evStatus: 200,
                            tenantStatus: 200 }, opt || {});
  const calls = [];
  const fn = async (p, options) => {
    calls.push({ path: p, method: (options && options.method) || 'GET' });
    if (/^\/properties\?.*select=id$/.test(p)) {
      return { status: 200, json: o.owns ? [{ id: PROP }] : [] };
    }
    if (/^\/properties\?/.test(p)) {
      if (o.propStatus >= 300) return { status: o.propStatus, json: { message: 'nope' } };
      return { status: 200, json: [{
        id: PROP, name: 'Main Street Plaza', sqft: 1000,
        data: { tenants: o.blobTenants, invoices: [], disputes: [], timeline: [] },
      }] };
    }
    if (/^\/tenants\?/.test(p)) {
      if (o.tenantStatus >= 300) return { status: o.tenantStatus, json: { message: 'nope' } };
      return { status: 200, json: o.tableTenants };
    }
    if (/^\/tenant_field_evidence\?/.test(p)) {
      if (o.evStatus >= 300) return { status: o.evStatus, json: { message: 'nope' } };
      return { status: 200, json: o.evidence };
    }
    return { status: 404, json: [] };
  };
  fn.calls = calls;
  return fn;
}

const tablesTouched = (reads) => Array.from(new Set(reads.map(r => r.split('?')[0])));

(async function main() {

// ── A. Ownership fails closed, before any transport ────────────────────────
sec('A. Ownership fails closed, and does so before a single read');
{
  const t1 = transport();
  const r1 = await H.hydrate({ propertyId: PROP, sbFetch: t1 });
  eq(r1.ok, false, 'A1 a call with no userId is refused');
  eq(r1.reason, H.REFUSAL.NO_USER, 'A2 with reason authentication_required');
  eq(t1.calls.length, 0, 'A3 and the transport was never touched — no read at all');

  const t2 = transport();
  const r2 = await H.hydrate({ propertyId: PROP, userId: { sub: USER }, sbFetch: t2 });
  is(r2.ok === false && r2.reason === H.REFUSAL.NO_USER,
     'A4 a non-string userId is refused too — an object is not an identity');
  eq(t2.calls.length, 0, 'A5 also without touching the transport');

  const t3 = transport();
  const r3 = await H.hydrate({ userId: USER, sbFetch: t3 });
  is(r3.ok === false && t3.calls.length === 0,
     'A6 a call with no propertyId is refused without a read', r3.reason);

  const t4 = transport({ owns: false });
  const r4 = await H.hydrate({ propertyId: OTHER, userId: USER, sbFetch: t4 });
  eq(r4.reason, H.REFUSAL.NOT_OWNED, 'A7 a property the user does not own is refused');
  eq(t4.calls.length, 1, 'A8 after exactly one read — the ownership probe, and nothing after it');

  // A broken ownership probe is not a passing one. "Could not determine" and
  // "yes" are different answers, and only one of them may return a row.
  for (const status of [401, 403, 500, 503]) {
    const sb = async () => ({ status, json: { message: 'upstream' } });
    const r = await H.hydrate({ propertyId: PROP, userId: USER, sbFetch: sb });
    is(r.ok === false && r.reason === H.REFUSAL.NOT_OWNED,
       'A9.' + status + ' an ownership probe that returns ' + status + ' refuses, it does not assume ownership',
       r.reason);
  }

  // Likewise a property read that fails after ownership passed.
  const t5 = transport({ propStatus: 500 });
  const r5 = await H.hydrate({ propertyId: PROP, userId: USER, sbFetch: t5 });
  is(r5.ok === false && r5.reason === H.REFUSAL.READ_FAILED,
     'A10 a failed property read is reported as a failure, not as an empty record', r5.reason);
  is(!r5.record, 'A11 and returns no record at all');

  const t6 = transport({ propStatus: 404 });
  const r6 = await H.hydrate({ propertyId: PROP, userId: USER, sbFetch: t6 });
  is(r6.ok === false, 'A12 a 4xx on the property read is a failure too', r6.reason);
}

// ── B. Transport credential is not the authorization ───────────────────────
sec('B. Service-role transport never substitutes for the ownership check');
{
  // The fixture back end above returns the property for any id. If the hydrator
  // leaned on the credential rather than the check, A7 would have succeeded.
  const t = transport({ owns: false });
  const r = await H.hydrate({ propertyId: OTHER, userId: USER, sbFetch: t });
  is(r.ok === false && !r.record,
     'B1 a permissive back end still yields no record — the refusal is the hydrator\'s own');

  const t2 = transport();
  const r2 = await H.hydrate({ propertyId: PROP, userId: USER, sbFetch: t2 });
  const probe = t2.calls[0].path, read = t2.calls[1].path;
  is(probe.includes('user_id=eq.' + USER), 'B2 the ownership probe filters on the authenticated user');
  is(read.includes('user_id=eq.' + USER),
     'B3 and the property read carries the SAME filter — redundant on purpose, so one regression still fails closed');
  is(r2.ok, 'B4 the owner does get their record');

  is(/_ownsProperty\s*\(\s*sb\s*,\s*propertyId\s*,\s*userId\s*\)/.test(HCODE),
     'B5 the check is called with the authenticated user, not with a value from the row');
  is(!/service[_-]?role/i.test(HCODE.replace(/serviceRoleKey/g, '')),
     'B6 the service-role key appears only as transport credential, nowhere in a decision');
}

// ── C. Exactly the approved reads ──────────────────────────────────────────
sec('C. Three tables, and the two that are deliberately absent');
{
  const t = transport({ evidence: [EV_ROW] });
  const r = await H.hydrate({ propertyId: PROP, userId: USER, sbFetch: t });
  eq(tablesTouched(r.reads), ['/properties', '/tenant_field_evidence'],
     'C1 with tenants in the blob, only properties and tenant_field_evidence are read');
  eq(r.reads.length, 3, 'C2 in three requests: the ownership probe, the property, the evidence');

  const t2 = transport({ blobTenants: [], tableTenants: [
    { id: TID, property_id: PROP, name: 'Acme Coffee LLC', sqft: 500, cap: 0.05,
      start_date: '2020-01-01', end_date: '2030-01-01', lease_url: null, lease_type: 'NNN' },
  ], evidence: [EV_ROW] });
  const r2 = await H.hydrate({ propertyId: PROP, userId: USER, sbFetch: t2 });
  eq(tablesTouched(r2.reads), ['/properties', '/tenants', '/tenant_field_evidence'],
     'C3 with an empty blob the tenants table is read as a fallback');

  const all = r.reads.concat(r2.reads).join(' ');
  is(!/tenant_review_audit/.test(all), 'C4 tenant_review_audit is never read');
  is(!/tenant_review_audit/.test(HCODE), 'C5 and does not appear in the code at all');
  is(!/cam_reconciliations/.test(all), 'C6 cam_reconciliations is never read');
  is(!/\/cam_reconciliations/.test(HCODE), 'C7 and no request path names it');
  is(!/\bpayments\b|payment_settlements|lease_documents/.test(all),
     'C8 no payment or lease-document table is touched — M1b has nothing to do with those');
}

// ── D. Read-only, enforced ─────────────────────────────────────────────────
sec('D. Read-only is enforced, not merely observed');
{
  const guarded = H._readOnly(async () => ({ status: 200, json: [] }));

  // The list is asserted against a literal, not against itself. Iterating
  // H.WRITE_METHODS alone would pass happily on a list with DELETE removed.
  eq(H.WRITE_METHODS.slice().sort(), ['DELETE', 'PATCH', 'POST', 'PUT'],
     'D0 the guard\'s list is exactly the four methods that change data');

  for (const m of ['POST', 'PATCH', 'PUT', 'DELETE']) {
    let threw = false;
    try { await guarded('/properties', { method: m }); } catch (_e) { threw = true; }
    is(threw, 'D1.' + m + ' a ' + m + ' is refused by the guard');
  }
  let getOk = false;
  try { await guarded('/properties', { method: 'GET' }); getOk = true; } catch (_e) {}
  is(getOk, 'D2 a GET passes through');

  let lowerThrew = false;
  try { await guarded('/properties', { method: 'post' }); } catch (_e) { lowerThrew = true; }
  is(lowerThrew, 'D3 the guard is case-insensitive — "post" is refused too');

  const t = transport({ evidence: [EV_ROW] });
  await H.hydrate({ propertyId: PROP, userId: USER, sbFetch: t });
  is(t.calls.every(c => c.method === 'GET'),
     'D4 every request a real hydration makes is a GET', t.calls.map(c => c.method).join(','));

  // The literals in WRITE_METHODS are the guard's own list; nothing else may
  // name a write method.
  const withoutList = HCODE.replace(/const WRITE_METHODS[\s\S]*?\];/, '');
  is(!/'(POST|PATCH|PUT|DELETE)'/.test(withoutList),
     'D5 no write method is named anywhere outside the guard\'s own list');
  is(!/\brpc\/|\.rpc\(/.test(HCODE), 'D6 no RPC call — a procedure could write');
}

// ── E. The evidence read is load-bearing ───────────────────────────────────
sec('E. Skipping the evidence read is detectable, which is why it is not optional');
{
  const withEv    = await H.hydrate({ propertyId: PROP, userId: USER,
                                      sbFetch: transport({ evidence: [EV_ROW] }) });
  const withoutEv = await H.hydrate({ propertyId: PROP, userId: USER,
                                      sbFetch: transport({ evidence: [] }) });
  const a = withEv.record.fields[TID].cap;
  const b = withoutEv.record.fields[TID].cap;

  eq(a.state, 'lease_confirmed', 'E1 with the evidence read, cap is lease-confirmed');
  is(a.cited === true && a.sourceFile === 'lease.pdf' && a.page === 3,
     'E2 cited, with the source document and page', a.sourceFile + ' p' + a.page);
  eq(b.state, 'ai_extracted', 'E3 without it the SAME field degrades to an uncited AI extraction');
  is(b.cited === false && b.sourceFile === null,
     'E4 with no source and no page — present, plausible and wrong, which is why the read is required');

  // The mapping has to agree with script.js key for key. `page` vs `sourcePage`
  // does not throw; it silently drops every page citation.
  const m = SSRC.match(/function _evidenceRowToSnapshot\(row\)\s*\{[\s\S]*?\n\}/);
  is(!!m, 'E5 script.js still defines _evidenceRowToSnapshot');
  const browserKeys = strip(m[0]).match(/^\s{4}(\w+):/gm).map(s => s.trim().replace(':', '')).sort();
  const serverKeys  = Object.keys(H._evidenceRowToSnapshot(EV_ROW)).sort();
  eq(serverKeys, browserKeys, 'E6 the server mapping produces exactly the browser\'s keys');
  is(serverKeys.includes('page') && !serverKeys.includes('sourcePage'),
     'E7 including `page` — the name FieldProvenance actually reads');
  is(withEv.record.fields[TID].cap.quote === EV_ROW.quote,
     'E8 and the clause survives into the record');

  const failed = await H.hydrate({ propertyId: PROP, userId: USER,
                                   sbFetch: transport({ evStatus: 500 }) });
  is(failed.ok && failed.degraded.includes('evidence.read_failed'),
     'E9 a failed evidence read is reported as degradation, not silently absent');
}

// ── F. Tenant precedence matches the browser's ─────────────────────────────
sec('F. The blob wins, and the table is a fallback — as in loadPropertyData');
{
  const t = transport({ tableTenants: [{ id: 'x', name: 'Should Not Appear', sqft: 1 }] });
  const r = await H.hydrate({ propertyId: PROP, userId: USER, sbFetch: t });
  eq(r.record.spaces.length, 1, 'F1 one space');
  is(r.record.spaces[0].tenantName === 'Acme Coffee LLC',
     'F2 from the blob, because the table has no review, reviewOverrides or capBaseAmount',
     r.record.spaces[0].tenantName);
  is(!r.reads.some(p => p.startsWith('/tenants?')),
     'F3 and the tenants table is not even read when the blob has rows');

  const t2 = transport({ blobTenants: [], tableTenants: [
    { id: TID, property_id: PROP, name: 'Fallback Tenant', sqft: 400, cap: null,
      start_date: null, end_date: null, lease_url: null, lease_type: 'NNN' },
  ] });
  const r2 = await H.hydrate({ propertyId: PROP, userId: USER, sbFetch: t2 });
  is(r2.record.spaces.length === 1 && r2.record.spaces[0].tenantName === 'Fallback Tenant',
     'F4 an empty blob falls back to the table', r2.record.spaces[0].tenantName);
  is(r2.degraded.includes('tenants.from_table_no_review_state'),
     'F5 and says so — the fallback rows carry no review state, and that is not hidden');

  const t3 = transport({ blobTenants: [], tenantStatus: 500 });
  const r3 = await H.hydrate({ propertyId: PROP, userId: USER, sbFetch: t3 });
  is(r3.ok && r3.degraded.includes('tenants.read_failed'),
     'F6 a failed fallback read degrades rather than throwing');
}

// ── G. Normalization is reused ─────────────────────────────────────────────
sec('G. tenant-normalize.js is reused, not reimplemented');
{
  is(/require\([^)]*tenant-normalize\.js[^)]*\)/.test(HCODE),
     'G1 the hydrator requires tenant-normalize.js');
  is(!/function\s+(normalizeTenant|cleanTenantName|toISODate|extractDatesFromText)\s*\(/.test(HCODE),
     'G2 and defines none of its functions locally');

  const t = transport({ blobTenants: [{ id: TID, tenant_name: '  ACME COFFEE, LLC  ',
                                        leased_sqft: '500', cap: '5%' }] });
  const r = await H.hydrate({ propertyId: PROP, userId: USER, sbFetch: t });
  const direct = TN.normalizeTenant({ id: TID, tenant_name: '  ACME COFFEE, LLC  ',
                                      leased_sqft: '500', cap: '5%' });
  is(r.record.spaces[0].tenantName === direct.tenant_name,
     'G3 a messy name is normalized identically to a direct call', JSON.stringify(direct.tenant_name));
}

// ── H. No browser API is contacted ─────────────────────────────────────────
sec('H. No browser API, asserted by making contact throw rather than by reading');
{
  is(!/\blocalStorage\b/.test(HCODE),        'H1 localStorage does not appear in the code');
  is(!/\bdocument\./.test(HCODE),            'H2 nor does document.');
  is(!/\bloadPropertyData\s*\(/.test(HCODE), 'H3 loadPropertyData is not called');
  is(!/\bgetCamYear\s*\(/.test(HCODE),       'H4 getCamYear is not called');
  is(!/\bsessionStorage\b|\bnavigator\b/.test(HCODE), 'H5 no other browser session API');

  // Definitions that throw on contact. If any code path touches one, the
  // hydration below fails loudly instead of quietly succeeding.
  const trap = (n) => ({ configurable: true,
                         get() { throw new Error('[test] ' + n + ' was touched'); } });
  Object.defineProperty(global, 'localStorage', trap('localStorage'));
  Object.defineProperty(global, 'document',     trap('document'));
  let r, err = null;
  try {
    r = await H.hydrate({ propertyId: PROP, userId: USER,
                          sbFetch: transport({ evidence: [EV_ROW] }) });
  } catch (e) { err = e; }
  delete global.localStorage;
  delete global.document;
  is(!err, 'H6 a full hydration completes with localStorage and document booby-trapped',
     err ? err.message : 'no contact');
  is(r && r.ok && r.record.spaces.length === 1, 'H7 and produces the same record');
}

// ── I. The window shim is contained ────────────────────────────────────────
sec('I. The shim exists only inside the call, and holds no session state');
{
  eq(DEPS.leakedWindow(), false, 'I1 no window exists before anything is loaded here');
  const deps = DEPS.load();
  eq(DEPS.missing(deps), [], 'I2 all eight dependencies load');
  eq(DEPS.leakedWindow(), false, 'I3 and loading them leaves no window behind');

  eq(DEPS.shimKeys(), ['LeaseIntelligence', 'PropertyReference', 'PropertyWorkspace', 'TenantSpace'],
     'I4 the shim holds exactly the four allow-listed names');
  eq(DEPS.SHIM_KEYS.slice().sort(), DEPS.shimKeys(), 'I5 and matches its declared allow-list');
  for (const forbidden of ['currentProperty', 'showToast', 'savePropertyNow', 'AuthService',
                           'Selectors', 'PropertyTimeline', 'localStorage', 'document']) {
    is(DEPS.shimKeys().indexOf(forbidden) === -1,
       'I6.' + forbidden + ' the shim does not carry ' + forbidden);
  }

  let inside = false;
  DEPS.withWindow(() => { inside = typeof global.window === 'object'; });
  is(inside, 'I7 withWindow does install a window for the duration of the call');
  eq(DEPS.leakedWindow(), false, 'I8 and removes it afterwards');

  let threw = false;
  try { DEPS.withWindow(() => { throw new Error('boom'); }); } catch (_e) { threw = true; }
  is(threw && !DEPS.leakedWindow(),
     'I9 a throw inside the call still restores the global — the finally is the whole point');

  const sentinel = { iAm: 'the prior window' };
  global.window = sentinel;
  DEPS.withWindow(() => {});
  is(global.window === sentinel, 'I10 a pre-existing window is restored, not clobbered');
  delete global.window;

  await H.hydrate({ propertyId: PROP, userId: USER, sbFetch: transport({ evidence: [EV_ROW] }) });
  eq(DEPS.leakedWindow(), false, 'I11 a full hydration leaves no window behind either');

  // cam-pool.js requires money-cents.js from inside a function; money-cents.js's
  // UMD tail then assigns itself to whatever `window` it finds. The seal refuses
  // it. Without the seal the shim would silently acquire a fifth name.
  is(DEPS.blockedWrites().includes('MoneyCents'),
     'I11a a call-time attempt to attach MoneyCents was refused, not absorbed',
     DEPS.blockedWrites().join(','));
  eq(DEPS.shimKeys(), ['LeaseIntelligence', 'PropertyReference', 'PropertyWorkspace', 'TenantSpace'],
     'I11b so the shim still holds exactly four names after a full hydration');
  DEPS.withWindow(() => { global.window.somethingNew = 1; global.window.Selectors = {}; });
  is(DEPS.shimKeys().length === 4 && DEPS.blockedWrites().includes('Selectors'),
     'I11c and an explicit attempt to inject Selectors is refused too');

  // The prune is the LOAD-time half of the guarantee the seal gives at call
  // time, and no current dependency exercises it — so it is asserted directly
  // rather than left to be discovered missing by a future dependency.
  const planted = { TenantSpace: 1, PropertyReference: 2, currentProperty: 3, Selectors: 4 };
  const removed = DEPS._pruneToAllowList(planted);
  eq(removed.sort(), ['Selectors', 'currentProperty'],
     'I11d the prune removes exactly the names outside the allow-list');
  eq(Object.keys(planted).sort(), ['PropertyReference', 'TenantSpace'],
     'I11e and leaves the allow-listed ones untouched');

  is(/finally\s*\{/.test(DCODE) && /delete global\.window/.test(DCODE),
     'I12 the restore is in a finally and deletes the global it created');
  is((DCODE.match(/global\.window\s*=/g) || []).length === 2,
     'I13 exactly two assignments to global.window exist — the install and the restore',
     String((DCODE.match(/global\.window\s*=/g) || []).length));
}

// ── J. meta.unavailable keeps its meaning ──────────────────────────────────
sec('J. meta.unavailable is not widened to hide the localStorage divergence');
{
  const full = await H.hydrate({ propertyId: PROP, userId: USER,
                                 sbFetch: transport({ evidence: [EV_ROW] }) });
  eq(full.record.meta.unavailable, [],
     'J1 with every dependency present, nothing is unavailable');

  const deps = Object.assign({}, DEPS.load());
  delete deps.CamPool;
  const partial = await H.hydrate({ propertyId: PROP, userId: USER, deps,
                                    sbFetch: transport({ evidence: [EV_ROW] }) });
  is(partial.record.meta.unavailable.includes('cam.pool'),
     'J2 a missing dependency still populates unavailable — the semantics are untouched');
  is(partial.degraded.some(d => d.startsWith('deps.missing:')),
     'J3 and the caller is told separately', partial.degraded.join(' '));

  const u = full.record.meta.unavailable.join(' ');
  is(!/local|browser|storage|session/i.test(u),
     'J4 nothing about browser-local divergence is recorded in unavailable');
  is(full.degraded.includes('attention.without_selectors_readiness'),
     'J5 the attention degradation is reported in degraded[] instead — attention IS composed, just from fewer inputs');
  is(!full.record.meta.unavailable.includes('attention'),
     'J6 so `attention` is not listed as unavailable, which would be a different and false claim');
  is(Array.isArray(full.record.attention),
     'J7 and attention is in fact present', String(full.record.attention.length) + ' items');
}

// ── K. The server-origin metadata ──────────────────────────────────────────
sec('K. Server-origin metadata is structured, additive, and not parsed');
{
  const r = await H.hydrate({ propertyId: PROP, userId: USER,
                              sbFetch: transport({ evidence: [EV_ROW] }) });
  eq(r.record.meta.origin, 'server', 'K1 meta.origin');
  eq(r.record.meta.includesBrowserLocalState, false, 'K2 meta.includesBrowserLocalState');
  is(typeof r.record.meta.note === 'string' && r.record.meta.note.length > 0,
     'K3 meta.note is prose for a human');

  // Additive: every key the browser record carries must survive.
  const browser = DEPS.withWindow(() => PR.assemble({
    id: PROP, name: 'Main Street Plaza', totalSqft: 1000,
    tenants: [BLOB_TENANT], invoices: [], disputes: [], timeline: [],
  }, DEPS.load()));
  const lost = Object.keys(browser.meta).filter(k => !(k in r.record.meta));
  eq(lost, [], 'K4 no original meta key was displaced by the addition');

  is(!/meta\.note\s*(===|==|\.includes|\.indexOf|\.match|\.startsWith)/.test(HCODE),
     'K5 no logic branches on the note text');
  is(!/includesBrowserLocalState\s*:\s*true/.test(HCODE),
     'K6 there is no code path that claims the server record includes browser state');
}

console.log(`\n${fail ? '\x1b[31m' : '\x1b[32m'}RESULT: ${pass} passed, ${fail} failed\x1b[0m`);
process.exit(fail ? 1 : 0);

})().catch(e => { console.error(e); process.exit(1); });
