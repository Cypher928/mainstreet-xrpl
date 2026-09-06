'use strict';
/**
 * test-m5-property-memory.js — the four read-only Property Memory capabilities.
 *
 *   node test-m5-property-memory.js
 *
 * OFFLINE. Every transport and every auth call is a function defined in this
 * file. Nothing here opens a socket or can reach Pilot or Production.
 *
 * WHAT M5 ADDED, AND WHAT IT DID NOT
 * ----------------------------------
 * Four ways of asking about a record the server already knew how to build:
 * get_lease_evidence, get_space, get_timeline, get_disputes. They add NO
 * database read — every one of them goes through the same hydrator over the
 * same three approved reads, which section E asserts rather than assumes.
 *
 * The security boundary is therefore the same boundary, and it is re-tested per
 * capability rather than inherited on trust: a caller cannot name itself, a
 * tenant-portal identity is not a landlord, and a foreign id does not resolve.
 *
 * THE TWO CASES WORTH READING
 * ---------------------------
 * Section G — get_disputes on a property with no stored record returns null and
 * a null count, never [] and never 0. That is the question this whole contract
 * was written for.
 *
 * Section H — when TimelineMerge is absent, PropertyRecord still returns a
 * timeline, but byTenant is {} and property events are un-deduplicated. Asking
 * for one tenant's events would yield undefined, and [] there would be a
 * confident, empty, wrong answer. Tenant-scoped is UNAVAILABLE; property-level
 * is DEGRADED, because those events are real and merely unfiltered. M4 never
 * exercised that path.
 */

const fs   = require('fs');
const MCP  = require('./api/_mcp-capabilities.js');
const DEPS = require('./api/_server-deps.js');

const INV   = require('./tools/global-dependency-inventory.js');
const SRC   = fs.readFileSync(require.resolve('./api/_mcp-capabilities.js'), 'utf8');
const strip = (s) => s.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
const CODE  = strip(SRC);
/**
 * Code with comments AND string contents blanked. The distinction matters here:
 * this module deliberately SAYS "never localStorage" in a provenance field, so
 * a scan for the word would flag the sentence that promises the thing it is
 * checking for. What must be absent is the ACCESS, not the vocabulary.
 */
const EXEC  = INV.stripStringsAndComments(SRC);

let pass = 0, fail = 0;
const ok  = (m, d) => { console.log('  \x1b[32m✓\x1b[0m ' + m + (d ? '  — ' + d : '')); pass++; };
const bad = (m, d) => { console.log('  \x1b[31m✗\x1b[0m ' + m + (d ? '  — ' + d : '')); fail++; };
const is  = (c, m, d) => (c ? ok(m, d) : bad(m, d));
const eq  = (a, b, m) => (JSON.stringify(a) === JSON.stringify(b)
  ? ok(m, JSON.stringify(a))
  : bad(m, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`));
const sec = (t) => console.log('\n\x1b[1m── ' + t + ' ──\x1b[0m');

// ── Fixtures ───────────────────────────────────────────────────────────────
const OWNER  = '22222222-2222-4222-8222-222222222222';
const TENANT = '33333333-3333-4333-8333-333333333333';   // a tenant-portal user
const PROP   = '11111111-1111-4111-8111-111111111111';
const OTHER  = '99999999-9999-4999-8999-999999999999';
const T1     = 'aaaaaaaa-0000-4000-8000-000000000001';
const T2     = 'aaaaaaaa-0000-4000-8000-000000000002';
const FOREIGN = 'bbbbbbbb-0000-4000-8000-00000000000b';
const NOW    = '2026-09-06T12:00:00.000Z';

/** A reviewer-approved, fully cited evidence row. */
const EV_CONFIRMED = {
  tenant_id: T1, field_key: 'cap', value: '0.05',
  confidence_status: 'high', confidence_note: null,
  source_file: 'acme-lease.pdf', source_page: 3,
  quote: 'Section 4.2 caps controllable CAM at five percent per annum.',
  extraction_id: 'e1', extraction_version: 1,
  reviewer_uid: 'rev-1', reviewer_email: 'asset.manager@example.com',
  reviewed_at: '2025-06-01T00:00:00Z', approved: true, manually_edited: false,
  original_extracted_value: null, created_at: '2025-01-01T00:00:00Z',
};

const FULL_BLOB = {
  tenants: [
    { id: T1, tenant_name: 'Acme Coffee LLC', leased_sqft: 500, cap: 0.05,
      start_date: '2020-01-01', end_date: '2030-01-01', lease_type: 'NNN',
      lease_url: 'https://example.invalid/acme.pdf', leaseFileName: 'acme.pdf' },
    { id: T2, tenant_name: 'Northside Hardware', leased_sqft: 300, cap: null,
      start_date: '2021-06-01', end_date: '2026-06-01', lease_type: 'NNN' },
  ],
  invoices: [{ id: 'i1', amount: 12000, category: 'Landscaping', camEligible: true }],
  disputes: [
    { id: 'd1', tenantId: T1, tenantName: 'Acme Coffee LLC', status: 'open',
      amount: 1200, timestamp: '2025-03-01T00:00:00Z' },
    { id: 'd2', tenantName: 'Northside Hardware', status: 'resolved',
      amount: 300, timestamp: '2025-02-01T00:00:00Z' },
    { id: 'd3', tenantId: T1, tenantName: 'Acme Coffee LLC', status: 'docs_requested',
      amount: 800, timestamp: '2025-04-01T00:00:00Z' },
  ],
  timeline: [
    { id: 'e1', type: 'photo', tenantId: T1, when: '2025-01-05T00:00:00Z',
      attachments: [{ name: 'storefront.jpg', url: 'u', kind: 'photo' }] },
    { id: 'e2', type: 'pdf', tenantId: T2, when: '2025-01-09T00:00:00Z',
      attachments: [{ name: 'ns.pdf', url: 'v', kind: 'pdf' }] },
    { id: 'e9', type: 'cam_reconciled', when: '2025-02-01T00:00:00Z' },
  ],
};

const EMPTY_BLOB = { tenants: [], invoices: [], disputes: [], timeline: [] };
const TENANTS_NO_DISPUTES = {
  tenants: FULL_BLOB.tenants, invoices: [], disputes: [], timeline: [],
};

function auth(opts) {
  const o = opts || {};
  const calls = [];
  const fn = async (tok) => {
    calls.push(tok);
    if (o.throws) { const e = new Error('boom'); e.name = o.throws; throw e; }
    if (o.status) return { status: o.status, json: o.json || {} };
    if (tok === 'owner') return { status: 200, json: {
      id: OWNER, role: 'authenticated', aud: 'authenticated',
      app_metadata:  { role: 'admin' },
      user_metadata: { role: 'service_role', is_admin: true, owns_all: true },
    } };
    if (tok === 'tenant') return { status: 200, json: { id: TENANT, role: 'authenticated' } };
    if (tok === 'noid')   return { status: 200, json: { role: 'authenticated' } };
    return { status: 401, json: { error: 'bad' } };
  };
  fn.calls = calls;
  return fn;
}

/** Generous back end: it answers about PROP for anyone, so refusals are ours. */
function db(opts) {
  const o = Object.assign({ blob: FULL_BLOB, evidence: [EV_CONFIRMED], ownedBy: OWNER,
                            evStatus: 200, propStatus: 200, tenantStatus: 200,
                            tableTenants: [] }, opts || {});
  const calls = [];
  const fn = async (p, options) => {
    calls.push({ path: p, method: (options && options.method) || 'GET' });
    if (/^\/properties\?id=eq\.([^&]+)&user_id=eq\.([^&]+)&select=id$/.test(p)) {
      const m = p.match(/id=eq\.([^&]+)&user_id=eq\.([^&]+)/);
      const pid = decodeURIComponent(m[1]), uid = decodeURIComponent(m[2]);
      return { status: 200, json: (pid === PROP && uid === o.ownedBy) ? [{ id: pid }] : [] };
    }
    if (/^\/properties\?/.test(p)) {
      if (o.propStatus >= 300) return { status: o.propStatus, json: { message: 'x' } };
      return { status: 200, json: [{ id: PROP, name: 'Main Street Plaza', sqft: 1000,
                                     data: o.blob }] };
    }
    if (/^\/tenants\?/.test(p)) {
      if (o.tenantStatus >= 300) return { status: o.tenantStatus, json: { message: 'x' } };
      return { status: 200, json: o.tableTenants };
    }
    if (/^\/tenant_field_evidence\?/.test(p)) {
      if (o.evStatus >= 300) return { status: o.evStatus, json: { message: 'x' } };
      return { status: 200, json: o.evidence };
    }
    return { status: 404, json: [] };
  };
  fn.calls = calls;
  return fn;
}

const ctx = (over) => Object.assign(
  { token: 'owner', authFetch: auth(), sbFetch: db(), now: NOW }, over || {});
const codes = (env) => env.caveats.map(c => c.code);

/** The four capabilities M5 adds, with the arguments each needs. */
const M5 = [
  ['get_lease_evidence', { propertyId: PROP, tenantId: T1 }],
  ['get_space',          { propertyId: PROP, spaceId: T1 }],
  ['get_timeline',       { propertyId: PROP }],
  ['get_disputes',       { propertyId: PROP }],
];

(async function main() {

// ── A. The four capabilities exist and are described ───────────────────────
sec('A. Four capabilities, added to the existing set rather than beside it');
{
  const names = MCP.TOOLS.map(t => t.name);
  eq(names, ['list_properties', 'get_property', 'get_tenant',
             'get_lease_evidence', 'get_space', 'get_timeline', 'get_disputes'],
     'A1 seven tools — M4\'s three, plus M5\'s four');
  for (const [name] of M5) {
    const t = MCP.TOOLS.find(x => x.name === name);
    is(!!t, 'A2.' + name + ' is registered');
    is(typeof t.description === 'string' && t.description.length > 60,
       'A3.' + name + ' has a description worth reading');
    is(t.inputSchema && t.inputSchema.additionalProperties === false,
       'A4.' + name + ' refuses unknown arguments');
    is(typeof t.handler === 'function', 'A5.' + name + ' has a handler');
    is(t.inputSchema.required.indexOf('propertyId') !== -1,
       'A6.' + name + ' requires a propertyId');
  }
  // Nothing from the excluded list crept in.
  is(!names.some(n => /search_property_memory|^get_cam|attention|payment|ripple|xrpl|create|update|delete/i.test(n)),
     'A7 and none of the capabilities this phase excluded');
  is(names.indexOf('get_lease') === -1,
     'A8 get_lease was NOT built — its terms come through get_tenant and get_lease_evidence');
}

// ── B. Security, re-tested per capability ──────────────────────────────────
sec('B. The boundary holds for each new capability, not by inheritance');
{
  for (const [name, args] of M5) {
    // owner succeeds
    const okr = await MCP.call(name, args, ctx());
    is(okr.data !== null, 'B1.' + name + ' the owner gets an answer',
       okr.caveats.length ? codes(okr).join(',') : '');

    // missing token
    const noTok = await MCP.call(name, args, ctx({ token: '' }));
    eq(noTok.data, null, 'B2.' + name + ' a missing token is refused');
    eq(codes(noTok), ['authentication_required'], 'B3.' + name + ' with the right reason');

    // bad token
    const badTok = await MCP.call(name, args, ctx({ token: 'nonsense' }));
    eq(codes(badTok), ['invalid_or_expired_token'], 'B4.' + name + ' a bad token is refused');

    // auth service down
    const down = await MCP.call(name, args, ctx({ authFetch: auth({ throws: 'TimeoutError' }) }));
    eq(codes(down), ['auth_service_unavailable'],
       'B5.' + name + ' an auth timeout fails closed, and is distinguished');

    // auth returns no id
    const noid = await MCP.call(name, args, ctx({ token: 'noid' }));
    eq(codes(noid), ['user_identity_missing'], 'B6.' + name + ' an id-less auth payload is refused');

    // non-owner (tenant-portal identity, a REAL session)
    const ten = await MCP.call(name, args, ctx({ token: 'tenant' }));
    eq(ten.data, null, 'B7.' + name + ' a tenant-portal identity gets nothing');
    eq(codes(ten), ['not_authorized'], 'B8.' + name + ' refused as not authorized');

    // caller-supplied userId cannot override the authenticated identity
    const spoof = await MCP.call(name, Object.assign({ userId: OWNER }, args),
                                 ctx({ token: 'tenant' }));
    eq(spoof.data, null, 'B9.' + name + ' a supplied userId does not help');
    eq(codes(spoof), ['not_authorized'], 'B10.' + name + ' still refused');

    // a property the caller does not own
    const foreign = await MCP.call(name, Object.assign({}, args, { propertyId: OTHER }),
                                   ctx());
    eq(foreign.data, null, 'B11.' + name + ' another user\'s property is refused');
    eq(codes(foreign), ['not_authorized'], 'B12.' + name + ' as not authorized');

    // no propertyId at all
    const noProp = await MCP.call(name, Object.assign({}, args, { propertyId: undefined }), ctx());
    eq(codes(noProp), ['invalid_arguments'], 'B13.' + name + ' rejects a missing propertyId');
  }

  // A capability with a REQUIRED id must refuse its absence as a bad request,
  // not resolve nothing and call it "not found" — those are different answers,
  // and only one of them tells the caller they forgot an argument.
  for (const [name, key] of [['get_lease_evidence', 'tenantId'], ['get_space', 'spaceId']]) {
    const missing = await MCP.call(name, { propertyId: PROP }, ctx());
    eq(codes(missing), ['invalid_arguments'],
       'B13a.' + name + ' a missing ' + key + ' is an argument error');
    is(new RegExp(key).test(missing.caveats[0].message),
       'B13b.' + name + ' naming the argument', missing.caveats[0].message);
    const wrongType = await MCP.call(name, { propertyId: PROP, [key]: { evil: 1 } }, ctx());
    eq(codes(wrongType), ['invalid_arguments'], 'B13c.' + name + ' and a non-string ' + key);
  }
  // The optional ones reject a non-string too, rather than coercing it.
  for (const name of ['get_timeline', 'get_disputes']) {
    const bad = await MCP.call(name, { propertyId: PROP, tenantId: 42 }, ctx());
    eq(codes(bad), ['invalid_arguments'], 'B13d.' + name + ' rejects a non-string tenantId');
  }

  // The blank token must not even reach the auth service.
  const a = auth();
  await MCP.call('get_disputes', { propertyId: PROP }, ctx({ token: '  ', authFetch: a }));
  eq(a.calls.length, 0, 'B14 a blank token is refused without contacting the auth service');

  // The generous back end proves the refusal is ours, not the database's.
  const d = db();
  await MCP.call('get_space', { propertyId: PROP, spaceId: T1 },
                 ctx({ token: 'tenant', sbFetch: d }));
  eq(d.calls.length, 1, 'B15 a non-owner call issues only the ownership probe');
}

// ── C. No authorization from a role or metadata claim ──────────────────────
sec('C. A payload claiming service_role still owns nothing');
{
  const claimsAdmin = async () => ({ status: 200, json: {
    id: TENANT, role: 'service_role',
    app_metadata:  { role: 'service_role' },
    user_metadata: { role: 'owner', owns_all: true, user_id: OWNER },
  } });
  for (const [name, args] of M5) {
    const r = await MCP.call(name, args, ctx({ token: 'x', authFetch: claimsAdmin }));
    eq(codes(r), ['not_authorized'], 'C1.' + name + ' is refused despite the claims');
  }
  is(!/\.role\b/.test(CODE) && !/app_metadata|user_metadata/.test(CODE),
     'C2 and no role or metadata field is read anywhere in the module');
}

// ── D. Cross-property access ───────────────────────────────────────────────
sec('D. A foreign tenant or space id does not resolve');
{
  const le = await MCP.call('get_lease_evidence', { propertyId: PROP, tenantId: FOREIGN }, ctx());
  eq(le.data, null, 'D1 get_lease_evidence refuses a foreign tenant');
  eq(codes(le), ['tenant_not_found'], 'D2 as tenant_not_found');
  eq(le.provenance.spacesConsidered, 2, 'D3 having looked only inside the owned property');

  const sp = await MCP.call('get_space', { propertyId: PROP, spaceId: FOREIGN }, ctx());
  eq(codes(sp), ['space_not_found'], 'D4 get_space refuses a foreign space');

  const tl = await MCP.call('get_timeline', { propertyId: PROP, tenantId: FOREIGN }, ctx());
  eq(codes(tl), ['tenant_not_found'], 'D5 get_timeline refuses a foreign tenant');

  const di = await MCP.call('get_disputes', { propertyId: PROP, tenantId: FOREIGN }, ctx());
  eq(codes(di), ['tenant_not_found'], 'D6 get_disputes refuses a foreign tenant');

  // Structural: the lookup is a find() over the hydrated record, never a query.
  is(/rec\.spaces \|\| \[\]\)\.find/.test(CODE),
     'D7 spaces are resolved inside the owned record, not fetched by id');
  is(!/\/tenants\?id=eq|\/spaces\?/.test(CODE),
     'D8 and no query here could reach another property\'s rows');
}

// ── E. No new database reads ───────────────────────────────────────────────
sec('E. Four capabilities, zero new reads');
{
  const d = db();
  for (const [name, args] of M5) await MCP.call(name, args, ctx({ sbFetch: d }));
  const tables = Array.from(new Set(d.calls.map(c => c.path.split('?')[0]))).sort();
  eq(tables, ['/properties', '/tenant_field_evidence'],
     'E1 only the tables M1b approved were touched');
  is(d.calls.every(c => c.method === 'GET'), 'E2 and every request was a GET',
     Array.from(new Set(d.calls.map(c => c.method))).join(','));
  is(!/tenant_review_audit|cam_reconciliations|\bpayments\b|lease_documents|tenant_users/.test(
       d.calls.map(c => c.path).join(' ')),
     'E3 no audit, CAM, payment, document or tenant_users table');

  // Each capability makes exactly the hydrator's reads: probe, property, evidence.
  for (const [name, args] of M5) {
    const one = db();
    const r = await MCP.call(name, args, ctx({ sbFetch: one }));
    eq(one.calls.length, 3, 'E4.' + name + ' issues exactly three requests');
    is((r.provenance.reads || []).length === 3, 'E5.' + name + ' and reports them');
    eq(r.provenance.hydrated, true, 'E6.' + name + ' through the accepted hydrator');
  }

  is(!/\brpc\/|\.rpc\(/.test(CODE), 'E7 no RPC anywhere in the module');

  // The guard itself, exercised rather than merely present. M5 issues no write,
  // so without this the guard could be removed and nothing here would notice.
  const guarded = MCP._readOnly(async () => ({ status: 200, json: [] }));
  eq(MCP.WRITE_METHODS.slice().sort(), ['DELETE', 'PATCH', 'POST', 'PUT'],
     'E7a the guard names exactly the four methods that change data');
  for (const m of ['POST', 'PATCH', 'PUT', 'DELETE', 'delete']) {
    let threw = false;
    try { await guarded('/properties', { method: m }); } catch (_e) { threw = true; }
    is(threw, 'E7b.' + m + ' a ' + m + ' is refused');
  }
  let getOk = false;
  try { await guarded('/properties', { method: 'GET' }); getOk = true; } catch (_e) {}
  is(getOk, 'E7c while a GET passes through');
  const noList = CODE.replace(/const WRITE_METHODS[\s\S]*?\];/, '');
  is(!/'(POST|PATCH|PUT|DELETE)'/.test(noList),
     'E8 no write method named outside the guard\'s own list');
}

// ── F. get_lease_evidence ──────────────────────────────────────────────────
sec('F. Evidence, passed through rather than reconstructed');
{
  const r = await MCP.call('get_lease_evidence', { propertyId: PROP, tenantId: T1 }, ctx());
  eq(r.data.tenantId, T1, 'F1 the tenant resolves');
  eq(r.data.fieldCount, 13, 'F2 all thirteen canonical fields are represented');
  const cap = r.data.evidence.cap;
  eq(cap.state, 'manually_confirmed', 'F3 a reviewer-approved field says so');
  eq(cap.by, 'asset.manager@example.com', 'F4 and names the reviewer');
  eq(cap.when, '2025-06-01T00:00:00Z', 'F5 with when they confirmed it');
  eq(cap.page, 3, 'F6 the page citation survives intact');
  eq(cap.sourceFile, 'acme-lease.pdf', 'F7 and the source document');
  is(cap.quote === EV_CONFIRMED.quote, 'F8 and the clause, byte for byte', cap.quote);
  eq(cap.cited, true, 'F9 marked cited');

  // One field at a time.
  const one = await MCP.call('get_lease_evidence',
                             { propertyId: PROP, tenantId: T1, fieldKey: 'cap' }, ctx());
  eq(Object.keys(one.data.evidence), ['cap'], 'F10 fieldKey narrows to one field');
  eq(one.data.evidence.cap, cap, 'F11 identically to the full response');
  eq(one.data.fieldKey, 'cap', 'F12 and the response says which field was asked for');

  const bogus = await MCP.call('get_lease_evidence',
                               { propertyId: PROP, tenantId: T1, fieldKey: 'not_a_field' }, ctx());
  eq(codes(bogus), ['field_not_found'], 'F13 an unknown field name is refused');
  is(/statement about the field name, not about the evidence/.test(bogus.caveats[0].message),
     'F14 and says that is a statement about the NAME, not about the evidence');
  is((bogus.provenance.knownFields || []).length === 13,
     'F15 listing the fields that do exist');

  // Nothing is invented: every entry matches what PropertyRecord holds.
  const gp = await MCP.call('get_property', { propertyId: PROP }, ctx());
  eq(r.data.evidence, gp.data.fields[T1],
     'F16 the evidence is PropertyRecord.fields verbatim — not a second derivation');

  // A field with no value stays unknown; nothing promotes it.
  eq(r.data.evidence.expense_stop.state, 'unknown',
     'F17 a field with no value stays unknown');
  eq(r.data.evidence.expense_stop.cited, false, 'F18 and uncited');
}

// ── G. get_disputes, and the question the contract exists for ──────────────
sec('G. "Does this property have any disputes?"');
{
  const all = await MCP.call('get_disputes', { propertyId: PROP }, ctx());
  eq(all.data.disputeCount, 3, 'G1 three disputes on the record');
  eq(all.data.openDisputeCount, 2, 'G2 two of them open or awaiting documents');
  eq(all.data.scope, 'property', 'G3 property scope by default');
  eq(all.provenance.sectionStatus.disputes, 'ok', 'G4 status ok');

  const t1 = await MCP.call('get_disputes', { propertyId: PROP, tenantId: T1 }, ctx());
  eq(t1.data.disputeCount, 2, 'G5 scoped to one tenant');
  eq(t1.data.scope, 'tenant', 'G6 with tenant scope');
  eq(t1.data.tenantName, 'Acme Coffee LLC', 'G7 and the tenant named');
  is(t1.data.disputes.every(d => d.tenantId === T1 || d.tenantName === 'Acme Coffee LLC'),
     'G8 and only that tenant\'s disputes');
  // The scoped list must agree with the space's own count.
  const sp = await MCP.call('get_space', { propertyId: PROP, spaceId: T1 }, ctx());
  eq(sp.data.counts.disputes, t1.data.disputeCount,
     'G9 which agrees with the count the space itself reports');

  // Genuinely none.
  const none = await MCP.call('get_disputes', { propertyId: PROP },
                              ctx({ sbFetch: db({ blob: TENANTS_NO_DISPUTES }) }));
  eq(none.data.disputes, [], 'G10 a record with no disputes returns []');
  eq(none.data.disputeCount, 0, 'G11 and a count of zero — this IS an answer');
  eq(none.provenance.sectionStatus.disputes, 'empty', 'G12 with status empty');

  // Nothing was ever recorded.
  const blank = await MCP.call('get_disputes', { propertyId: PROP },
                               ctx({ sbFetch: db({ blob: null }) }));
  eq(blank.data.disputes, null, 'G13 a property with no stored record returns NULL');
  eq(blank.data.disputeCount, null, 'G14 and a null count — not zero');
  eq(blank.data.openDisputeCount, null, 'G15 nor a zero open count');
  eq(blank.provenance.sectionStatus.disputes, 'unavailable', 'G16 status unavailable');
  const nsr = blank.caveats.find(c => c.code === 'property.no_stored_record');
  is(nsr && nsr.severity === 'unavailable', 'G17 with an unavailable caveat');

  // THE DISTINCTION.
  is(Array.isArray(none.data.disputes) && blank.data.disputes === null,
     'G18 so "there are none" and "nothing was recorded" are DIFFERENT answers');
  is(none.data.disputeCount === 0 && blank.data.disputeCount === null,
     'G19 and a count of 0 is never emitted for a source nobody could read');
}

// ── H. get_timeline, server-origin and the scoping case ────────────────────
sec('H. The timeline the server can see, and what it says it cannot');
{
  const p = await MCP.call('get_timeline', { propertyId: PROP }, ctx());
  eq(p.data.scope, 'property', 'H1 property scope by default');
  eq(p.data.eventCount, 1, 'H2 property-level events are those not claimed by a space');
  eq(p.data.byTenantCounts, { [T1]: 1, [T2]: 1 },
     'H3 with a per-tenant index so scoping is visible without asking per space');

  const t = await MCP.call('get_timeline', { propertyId: PROP, tenantId: T1 }, ctx());
  eq(t.data.scope, 'tenant', 'H4 tenant scope when asked');
  eq(t.data.eventCount, 1, 'H5 with that tenant\'s events');
  eq(t.provenance.sectionStatus.timeline, 'ok', 'H6 status ok');

  // Server-origin limitation, on every response.
  for (const r of [p, t]) {
    const so = r.caveats.find(c => c.code === 'timeline.server_origin_only');
    is(!!so, 'H7 the server-origin caveat is present');
    eq(so.severity, 'info', 'H8 as information, not a failure — it is a scope limit');
    is(/never persisted/.test(so.message) && /not a claim that they do not exist/.test(so.message),
       'H9 and says a browser may hold events this cannot see');
  }
  is(!/loadPropertyData/.test(CODE), 'H10 the browser loader is not called');
  eq(p.provenance.includesBrowserLocalState, false, 'H11 and the flag says so');

  // A tenant with no events of its own.
  const bare = await MCP.call('get_timeline', { propertyId: PROP, tenantId: T1 },
                              ctx({ sbFetch: db({ blob: TENANTS_NO_DISPUTES }) }));
  eq(bare.data.events, [], 'H12 a tenant with no stored events gets []');
  eq(bare.provenance.sectionStatus.timeline, 'empty', 'H13 with status empty');

  // ── THE SCOPING CASE. M4 never exercised this. ─────────────────────────
  const noTM = Object.assign({}, DEPS.load()); delete noTM.TimelineMerge;
  const sp = await MCP.call('get_timeline', { propertyId: PROP }, ctx({ deps: noTM }));
  const st = await MCP.call('get_timeline', { propertyId: PROP, tenantId: T1 }, ctx({ deps: noTM }));

  eq(st.data.events, null,
     'H14 without scoping, ONE TENANT\'S events are null — not an empty list');
  eq(st.data.eventCount, null, 'H15 and the count is null, not 0');
  eq(st.provenance.sectionStatus.timeline, 'unavailable', 'H16 status unavailable');

  eq(sp.provenance.sectionStatus.timeline, 'degraded',
     'H17 while property-level is DEGRADED — those events are real, just unfiltered');
  is(Array.isArray(sp.data.events) && sp.data.events.length === 3,
     'H18 so they are still returned, un-deduplicated', String(sp.data.eventCount));
  eq(sp.data.byTenantCounts, null,
     'H19 but the per-tenant index is null — an index of zeroes would read as "no tenant has any"');
  const sc = sp.caveats.find(c => c.code === 'timeline.scoping_unavailable');
  is(sc && sc.severity === 'unavailable', 'H20 with an unavailable caveat naming the cause');
  is(sc && /UNKNOWN, not\s+empty/.test(sc.message.replace(/\s+/g, ' ')),
     'H21 that says per-tenant timelines are unknown rather than empty');
}

// ── I. get_space ───────────────────────────────────────────────────────────
sec('I. One space, and a space that cannot be composed');
{
  const r = await MCP.call('get_space', { propertyId: PROP, spaceId: T1 }, ctx());
  eq(r.data.spaceId, T1, 'I1 the space resolves');
  eq(r.data.spaceName, 'Acme Coffee LLC', 'I2 by name');
  eq(r.data.tenantId, T1, 'I3 carrying its tenant identity');
  is(r.data.lease && r.data.lease.cap === 0.05, 'I4 with the lease relationship');
  is(r.data.counts && typeof r.data.counts.events === 'number', 'I5 and its record counts');
  is(typeof r.data.summary === 'string', 'I6 and the summary the record already holds');
  eq(r.data.noIdentity, false, 'I7 and whether it has an identity at all');

  // camResult is null in the base fixture, so a fixture WITH a reconciliation is
  // needed or "returns the CAM result" is untested by construction.
  {
    const withCam = JSON.parse(JSON.stringify(FULL_BLOB));
    withCam.camReconciliation = { camYear: 2025, total: 16500, results: [
      { tenantId: T1, tenantName: 'Acme Coffee LLC', allocatedAmount: 6000, proRata: 0.5 },
      { tenantName: 'Northside Hardware', totalAllocated: 3600, proRata: 0.3 }] };
    const cr = await MCP.call('get_space', { propertyId: PROP, spaceId: T1 },
                              ctx({ sbFetch: db({ blob: withCam }) }));
    is(cr.data.camResult !== null, 'I7a a space with a reconciliation returns its CAM result');
    eq(cr.data.camResult.allocatedAmount, 6000, 'I7b with the allocated amount');
    const gpc = await MCP.call('get_property', { propertyId: PROP },
                               ctx({ sbFetch: db({ blob: withCam }) }));
    eq(cr.data.camResult, gpc.data.spaces.find(x => x.tenantId === T1).camResult,
       'I7c identical to the record\'s own — not recomputed here');
    is(typeof cr.data.summary === 'string' && /CAM/.test(cr.data.summary),
       'I7d and the summary mentions it', cr.data.summary);
  }

  // Accepting the tenant id, because in this model they are one value.
  const byTenant = await MCP.call('get_space', { propertyId: PROP, spaceId: T1 }, ctx());
  eq(byTenant.data, r.data, 'I8 a space id and its tenant id are the same value');
  is(/identityNote/.test(JSON.stringify(r.provenance)),
     'I9 and the response says so rather than leaving a caller to discover it');

  // No second space model: it is PropertyRecord's own representation.
  const gp = await MCP.call('get_property', { propertyId: PROP }, ctx());
  const fromRecord = gp.data.spaces.find(s => s.tenantId === T1);
  eq(r.data.lease,     fromRecord.lease,     'I10 the lease is the record\'s own');
  eq(r.data.counts,    fromRecord.counts,    'I11 so are the counts');
  eq(r.data.camResult, fromRecord.camResult, 'I12 and the CAM result');
  eq(r.data.summary,   fromRecord.summary,   'I13 and the summary');

  // A real space that cannot be composed must not become not_found.
  const noTS = Object.assign({}, DEPS.load()); delete noTS.TenantSpace;
  const ghost = await MCP.call('get_space', { propertyId: PROP, spaceId: T1 },
                               ctx({ deps: noTS }));
  eq(ghost.data, null, 'I14 an uncomposable space returns no data');
  eq(codes(ghost)[0], 'section_unavailable', 'I15 as section_unavailable');
  is(codes(ghost).indexOf('space_not_found') === -1,
     'I16 and NEVER as space_not_found — the space is unknown, not absent');
  is(/UNKNOWN/.test(ghost.caveats[0].message), 'I17 which the message states');

  // Same rule for the other three.
  const le = await MCP.call('get_lease_evidence', { propertyId: PROP, tenantId: T1 },
                            ctx({ deps: noTS }));
  eq(codes(le)[0], 'section_unavailable', 'I18 get_lease_evidence too');
  const tl = await MCP.call('get_timeline', { propertyId: PROP, tenantId: T1 },
                            ctx({ deps: noTS }));
  eq(codes(tl)[0], 'section_unavailable', 'I19 get_timeline too');
  const di = await MCP.call('get_disputes', { propertyId: PROP, tenantId: T1 },
                            ctx({ deps: noTS }));
  eq(codes(di)[0], 'section_unavailable', 'I20 and get_disputes');
  is([le, tl, di].every(x => codes(x).indexOf('tenant_not_found') === -1),
     'I21 none of them emits the false negative');
}

// ── J. Evidence-read failure cannot fabricate provenance ───────────────────
sec('J. An unreadable citation is still not a missing one');
{
  const failed = await MCP.call('get_lease_evidence', { propertyId: PROP, tenantId: T1 },
                                ctx({ sbFetch: db({ evStatus: 503 }) }));
  eq(failed.data, null, 'J1 a failed evidence read returns no evidence at all');
  eq(codes(failed)[0], 'section_unavailable', 'J2 as section_unavailable');
  is(/UNKNOWN/.test(failed.caveats[0].message), 'J3 stating that provenance is unknown');
  is(/a reviewer has confirmed is[\s\S]*indistinguishable/.test(failed.caveats[0].message),
     'J4 and why: a confirmed field would be indistinguishable from an unchecked one');
  const ec = failed.caveats.find(c => c.code === 'evidence.read_failed');
  is(ec && ec.severity === 'unavailable', 'J5 with the M4 caveat at severity unavailable');

  // The successful read, for contrast — and to show what would have been lost.
  const okr = await MCP.call('get_lease_evidence', { propertyId: PROP, tenantId: T1 }, ctx());
  eq(okr.data.evidence.cap.state, 'manually_confirmed',
     'J6 where the read succeeds the reviewer\'s confirmation stands');
  is(!JSON.stringify(failed).includes('ai_extracted'),
     'J7 and the failed response never states ai_extracted for any field');

  // No evidence on file is a DIFFERENT answer from unreadable evidence.
  const noneOnFile = await MCP.call('get_lease_evidence', { propertyId: PROP, tenantId: T1 },
                                    ctx({ sbFetch: db({ evidence: [] }) }));
  eq(noneOnFile.provenance.sectionStatus.fields, 'ok',
     'J8 a successful read with nothing on file is ok, not unavailable');
  is(noneOnFile.data.evidence !== null, 'J9 and returns the fields\' genuine floor states');
  eq(noneOnFile.data.evidence.cap.state, 'ai_extracted', 'J10 which for cap is ai_extracted');
  is(failed.data === null && noneOnFile.data !== null,
     'J11 so "no evidence" and "evidence unreadable" stay DIFFERENT answers');
}

// ── K. No browser anything ─────────────────────────────────────────────────
sec('K. No browser API, no localStorage, no second hydration');
{
  is(!/\blocalStorage\b/.test(EXEC),
     'K1 localStorage is never accessed — checked against code with strings blanked, ' +
     'because the module deliberately says "never localStorage" in a provenance field');
  is(/never localStorage/.test(SRC),
     'K1a and that sentence IS there, so the check is discriminating rather than lucky');
  is(!/\bdocument\./.test(EXEC),            'K2 nor document.');
  is(!/\bwindow\./.test(EXEC),              'K3 nor window.');
  is(!/\bgetCamYear\s*\(/.test(EXEC),       'K4 getCamYear is not called');
  is(!/PropertyRecord\.assemble/.test(CODE),'K5 assemble() is not called directly');
  is(/_hydrateOwned\(/.test(CODE), 'K6 every capability goes through the one hydrator');

  const trap = (n) => ({ configurable: true,
                         get() { throw new Error('[test] ' + n + ' was touched'); } });
  Object.defineProperty(global, 'localStorage', trap('localStorage'));
  Object.defineProperty(global, 'document',     trap('document'));
  let err = null; const outs = [];
  try {
    for (const [name, args] of M5) outs.push(await MCP.call(name, args, ctx()));
  } catch (e) { err = e; }
  delete global.localStorage;
  delete global.document;
  is(!err, 'K7 all four run with localStorage and document booby-trapped',
     err ? err.message : 'no contact');
  is(outs.length === 4 && outs.every(o => o.data !== null),
     'K8 and all four produced answers');
  eq(DEPS.leakedWindow(), false, 'K9 leaving no window behind');
  eq(DEPS.SHIM_KEYS.slice().sort(),
     ['LeaseIntelligence', 'PropertyReference', 'PropertyWorkspace', 'TenantSpace'],
     'K10 the M3 shim allow-list is unchanged — M5 did not broaden it');
}

// ── L. Envelope, asOf, and a stable shape ──────────────────────────────────
sec('L. The same envelope, whatever is asked and whatever fails');
{
  const cases = [];
  for (const [name, args] of M5) {
    cases.push(await MCP.call(name, args, ctx()));                       // success
    cases.push(await MCP.call(name, args, ctx({ token: '' })));          // refusal
    cases.push(await MCP.call(name, args, ctx({ sbFetch: db({ blob: null }) })));
  }
  for (let i = 0; i < cases.length; i++) {
    eq(Object.keys(cases[i]).sort(), ['asOf', 'caveats', 'data', 'provenance'],
       'L1.' + i + ' four envelope keys');
    eq(cases[i].asOf, NOW, 'L2.' + i + ' asOf is present and injectable');
    is(Array.isArray(cases[i].caveats), 'L3.' + i + ' caveats is a list');
    eq(cases[i].provenance.origin, 'server', 'L4.' + i + ' origin server');
    eq(cases[i].provenance.includesBrowserLocalState, false, 'L5.' + i + ' no browser state');
  }
  const live = await MCP.call('get_disputes', { propertyId: PROP }, ctx({ now: undefined }));
  is(!isNaN(Date.parse(live.asOf)), 'L6 and a real ISO timestamp when not injected', live.asOf);

  // Stable shape per capability, across four back-end states.
  for (const [name, args] of M5) {
    const shapes = [];
    for (const opts of [{}, { evidence: [] }, { blob: TENANTS_NO_DISPUTES }, { evStatus: 503 }]) {
      const r = await MCP.call(name, args, ctx({ sbFetch: db(opts) }));
      shapes.push(r.data === null ? 'REFUSED' : Object.keys(r.data).sort().join(','));
    }
    const distinct = new Set(shapes.filter(s => s !== 'REFUSED'));
    eq(distinct.size, 1, 'L7.' + name + ' one data shape across every back-end state',
       Array.from(distinct)[0]);
  }

  // Determinism.
  const one = await MCP.call('get_disputes', { propertyId: PROP, tenantId: T1 }, ctx());
  const two = await MCP.call('get_disputes', { propertyId: PROP, tenantId: T1 }, ctx());
  eq(JSON.stringify(one), JSON.stringify(two), 'L8 two identical calls agree exactly');
}

// ── M. meta.unavailable and the hierarchy, still intact ────────────────────
sec('M. unavailable > degraded > empty, preserved through the new capabilities');
{
  const S = MCP.sectionStatus;
  eq(S('disputes', [], ['disputes'], []), 'unavailable', 'M1 named unavailable beats empty');
  eq(S('disputes', null, [], []),         'unavailable', 'M2 null is unavailable');
  eq(S('spaces', [{}], [], ['tenants.read_failed']), 'unavailable',
     'M3 an unknown-class degradation beats ok');
  eq(S('fields', {}, [], ['evidence.read_failed']), 'unavailable',
     'M4 including the evidence one');
  eq(S('spaces', [{}], [], ['tenants.from_table_no_review_state']), 'degraded',
     'M5 a known-less degradation is degraded');
  eq(S('disputes', [], [], []),   'empty', 'M6 composed and zero-length is empty');
  eq(S('disputes', [{}], [], []), 'ok',    'M7 composed with content is ok');

  // meta.unavailable travels to the caller verbatim.
  const noTS = Object.assign({}, DEPS.load()); delete noTS.TenantSpace;
  const r = await MCP.call('get_disputes', { propertyId: PROP }, ctx({ deps: noTS }));
  is((r.provenance.unavailable || []).indexOf('spaces') !== -1,
     'M8 meta.unavailable reaches the caller unchanged',
     JSON.stringify(r.provenance.unavailable));
  is(Array.isArray(r.data.disputes) && r.data.disputes.length === 3,
     'M9 while a section that DID compose is still returned — per section, not all-or-nothing');
  // And the caller is TOLD which section was lost, not merely able to infer it
  // from a provenance array it might not read.
  const su = r.caveats.find(c => c.code === 'section_unavailable' && c.scope === 'spaces');
  is(!!su, 'M9a with a section_unavailable caveat naming the section',
     JSON.stringify(codes(r)));
  eq(su && su.severity, 'unavailable', 'M9b at severity unavailable');
  is(su && /not a statement that there are none/.test(su.message),
     'M9c that refuses the wrong reading explicitly');
  // Same for a capability that returns data alongside the loss.
  const tlu = await MCP.call('get_timeline', { propertyId: PROP }, ctx({ deps: noTS }));
  is(tlu.caveats.some(c => c.code === 'section_unavailable' && c.scope === 'spaces'),
     'M9d and get_timeline carries it too');

  // Degraded is not empty.
  const degr = await MCP.call('get_space', { propertyId: PROP, spaceId: T1 },
    ctx({ sbFetch: db({ blob: EMPTY_BLOB, tableTenants: [
      { id: T1, property_id: PROP, name: 'Legacy Tenant', sqft: 400, cap: null,
        start_date: null, end_date: null, lease_url: null, lease_type: 'NNN' }] }) }));
  eq(degr.provenance.sectionStatus.spaces, 'degraded',
     'M10 a table fallback is degraded — the rows are real');
  is(degr.data !== null && degr.data.tenantName === 'Legacy Tenant',
     'M11 so the space is returned, not withheld');
  is(codes(degr).indexOf('tenants.from_table_no_review_state') !== -1,
     'M12 with a caveat about the missing review state');
}

console.log(`\n${fail ? '\x1b[31m' : '\x1b[32m'}RESULT: ${pass} passed, ${fail} failed\x1b[0m`);
process.exit(fail ? 1 : 0);

})().catch(e => { console.error(e); process.exit(1); });
