'use strict';
/**
 * test-m4-mcp-capabilities.js — the first three capabilities another system may
 * ask MainStreet for, and the semantics that make the answers trustworthy.
 *
 *   node test-m4-mcp-capabilities.js
 *
 * OFFLINE. Every transport and every auth call in this suite is a function
 * defined in this file. Nothing here opens a socket or can reach Pilot or
 * Production.
 *
 * WHAT THIS SUITE IS REALLY FOR
 * -----------------------------
 * Two things, and the second is the harder one.
 *
 * The first is the boundary: a caller is authenticated server-side from a
 * token, ownership is checked against properties.user_id, and a tenant-portal
 * identity — which is a real Supabase user with a real session and a
 * tenant_users row naming a property_id — gets an empty portfolio and a
 * refusal, never a landlord's data.
 *
 * The second is semantic. If MainStreet could not compose the disputes for a
 * property, the answer to "does this property have any disputes?" must not
 * become "no". Four cases have to stay distinct all the way to the caller:
 *
 *   ok           composed, has content
 *   empty        composed, source present, genuinely none
 *   unavailable  could not be composed, or nothing was ever recorded
 *   degraded     composed, from fewer inputs
 *
 * Section G is where that is proven, and it is the section worth reading.
 */

const fs   = require('fs');
const path = require('path');
const MCP  = require('./api/_mcp-capabilities.js');
const HYD  = require('./api/_property-record-hydrator.js');

const SRC  = fs.readFileSync(require.resolve('./api/_mcp-capabilities.js'), 'utf8');
const strip = (s) => s.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
const CODE  = strip(SRC);

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
const OTHER  = '99999999-9999-4999-8999-999999999999';   // someone else's property
const T1     = 'aaaaaaaa-0000-4000-8000-000000000001';
const T2     = 'aaaaaaaa-0000-4000-8000-000000000002';
const FOREIGN_TENANT = 'bbbbbbbb-0000-4000-8000-00000000000b';   // lives in OTHER
const NOW    = '2026-09-06T12:00:00.000Z';

const EV_ROW = {
  tenant_id: T1, field_key: 'cap', value: '0.05',
  confidence_status: 'high', confidence_note: null,
  source_file: 'lease.pdf', source_page: 3, quote: 'Section 4.2 caps CAM at 5%.',
  extraction_id: 'e1', extraction_version: 1,
  reviewer_uid: null, reviewer_email: null, reviewed_at: null,
  approved: null, manually_edited: false, original_extracted_value: null,
  created_at: '2025-01-01T00:00:00Z',
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
  disputes: [{ id: 'd1', tenantId: T1, tenantName: 'Acme Coffee LLC',
               status: 'open', amount: 1200, timestamp: '2025-03-01T00:00:00Z' }],
  timeline: [{ id: 'e1', type: 'photo', tenantId: T1, when: '2025-01-05T00:00:00Z',
               attachments: [{ name: 'a.jpg', url: 'u', kind: 'photo' }] }],
};

/** Auth back end. `owner` and `tenant` are valid sessions; anything else is not. */
function auth(opts) {
  const o = opts || {};
  const calls = [];
  const fn = async (tok) => {
    calls.push(tok);
    if (o.throws) { const e = new Error('boom'); e.name = o.throws; throw e; }
    if (o.status) return { status: o.status, json: o.json || {} };
    if (tok === 'owner')  return { status: 200, json: {
      id: OWNER,
      // Everything below is present in a real Supabase payload and must never
      // authorise anything. user_metadata in particular is user-writable.
      role: 'authenticated', aud: 'authenticated',
      app_metadata:  { role: 'admin', provider: 'email' },
      user_metadata: { role: 'service_role', is_admin: true, owns_all: true },
    } };
    if (tok === 'tenant') return { status: 200, json: { id: TENANT, role: 'authenticated' } };
    if (tok === 'noid')   return { status: 200, json: { role: 'authenticated' } };
    return { status: 401, json: { error: 'bad' } };
  };
  fn.calls = calls;
  return fn;
}

/**
 * Database back end. Deliberately generous: it answers about PROP for anyone
 * who asks by id, so every refusal below has to come from the ownership check
 * rather than from a cooperative server.
 */
function db(opts) {
  const o = Object.assign({ blob: FULL_BLOB, evidence: [EV_ROW], ownedBy: OWNER,
                            tenantStatus: 200, evStatus: 200, propStatus: 200,
                            listStatus: 200, tableTenants: [] }, opts || {});
  const calls = [];
  const fn = async (p, options) => {
    calls.push({ path: p, method: (options && options.method) || 'GET' });

    // list_properties — the portfolio read, filtered by user
    if (/^\/properties\?user_id=eq\.([^&]+)&select=id,name,sqft/.test(p)) {
      if (o.listStatus >= 300) return { status: o.listStatus, json: { message: 'x' } };
      const uid = decodeURIComponent(p.match(/user_id=eq\.([^&]+)/)[1]);
      const rows = uid === o.ownedBy
        ? [{ id: PROP, name: 'Main Street Plaza', sqft: 1000,
             created_at: '2025-01-01T00:00:00Z', updated_at: '2025-02-01T00:00:00Z',
             archived_at: null },
           { id: 'cccccccc-0000-4000-8000-00000000000c', name: 'Old Mill',
             sqft: 400, created_at: '2024-01-01T00:00:00Z',
             updated_at: '2024-02-01T00:00:00Z', archived_at: '2025-06-01T00:00:00Z' }]
        : [];
      return { status: 200, json: rows };
    }
    // ownership probe
    if (/^\/properties\?id=eq\.([^&]+)&user_id=eq\.([^&]+)&select=id$/.test(p)) {
      const m = p.match(/id=eq\.([^&]+)&user_id=eq\.([^&]+)/);
      const pid = decodeURIComponent(m[1]), uid = decodeURIComponent(m[2]);
      const owns = (pid === PROP && uid === o.ownedBy);
      return { status: 200, json: owns ? [{ id: pid }] : [] };
    }
    // the property read
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

const ctx = (over) => Object.assign({ token: 'owner', authFetch: auth(), sbFetch: db(), now: NOW }, over || {});
const codes = (env) => env.caveats.map(c => c.code);
const sevs  = (env) => env.caveats.map(c => c.severity);

(async function main() {

// ── A. The envelope ────────────────────────────────────────────────────────
sec('A. Every answer comes back in the agreed envelope');
{
  const results = [
    await MCP.call('list_properties', {}, ctx()),
    await MCP.call('get_property', { propertyId: PROP }, ctx()),
    await MCP.call('get_tenant', { propertyId: PROP, tenantId: T1 }, ctx()),
    await MCP.call('get_property', { propertyId: OTHER }, ctx()),          // a refusal
    await MCP.call('list_properties', {}, ctx({ token: '' })),             // another
    await MCP.call('no_such_tool', {}, ctx()),
  ];
  for (let i = 0; i < results.length; i++) {
    eq(Object.keys(results[i]).sort(), ['asOf', 'caveats', 'data', 'provenance'],
       'A1.' + i + ' exactly the four envelope keys, refusals included');
    is(Array.isArray(results[i].caveats), 'A2.' + i + ' caveats is a list');
    is(typeof results[i].asOf === 'string' && results[i].asOf.length > 0,
       'A3.' + i + ' asOf is present');
  }
  eq(results[0].asOf, NOW, 'A4 asOf is the moment of the read, injectable for tests');
  const live = await MCP.call('list_properties', {}, ctx({ now: undefined }));
  is(!isNaN(Date.parse(live.asOf)), 'A5 and a real ISO timestamp when not injected', live.asOf);
  eq(codes(results[5]), ['unknown_tool'], 'A6 an unknown capability is refused, not guessed at');

  // Provenance always states where the answer came from.
  for (let i = 0; i < 3; i++) {
    eq(results[i].provenance.origin, 'server', 'A7.' + i + ' provenance.origin');
    eq(results[i].provenance.includesBrowserLocalState, false,
       'A8.' + i + ' provenance.includesBrowserLocalState');
  }
}

// ── B. Identity is resolved server-side, from a token only ─────────────────
sec('B. The caller is authenticated server-side, and cannot name itself');
{
  is(!/\buserId\s*[:=]\s*(a|args|o)\./.test(CODE) && !/args\.userId/.test(CODE),
     'B1 no handler reads a userId from its arguments');
  is(!/userId:\s*a\.userId|userId:\s*args\./.test(CODE),
     'B2 and none is passed through to the hydrator from caller input');
  is(/resolveIdentity\(c\.token/.test(CODE),
     'B3 every handler resolves the user from the token instead');

  for (const tool of ['list_properties', 'get_property', 'get_tenant']) {
    const r = await MCP.call(tool, { propertyId: PROP, tenantId: T1, userId: OWNER },
                             ctx({ token: '' }));
    eq(r.data, null, 'B4.' + tool + ' a missing token is refused');
    eq(codes(r), ['authentication_required'], 'B5.' + tool + ' with the right reason');
  }
  // Supplying a userId argument alongside a bad token must not help.
  const spoof = await MCP.call('get_property', { propertyId: PROP, userId: OWNER },
                               ctx({ token: 'nonsense' }));
  eq(spoof.data, null, 'B6 a userId argument does not substitute for a valid token');
  eq(codes(spoof), ['invalid_or_expired_token'], 'B7 the bad token is what is reported');

  // THE case the earlier draft missed: a VALID session, plus a userId argument
  // naming somebody else. Every refusal above happened before the argument was
  // ever reachable, so none of them proved it is ignored.
  {
    const d = db();
    const spoofList = await MCP.call('list_properties', { userId: OWNER },
                                     ctx({ token: 'tenant', sbFetch: d }));
    eq(spoofList.data.properties, [],
       'B7a a valid tenant session naming the owner in userId still owns nothing');
    is(d.calls[0].path.indexOf('user_id=eq.' + TENANT) !== -1,
       'B7b and the query filtered on the AUTHENTICATED user, not the argument',
       d.calls[0].path);
    is(d.calls[0].path.indexOf(OWNER) === -1,
       'B7c the supplied id appears nowhere in the read');

    const spoofGet = await MCP.call('get_property', { propertyId: PROP, userId: OWNER },
                                    ctx({ token: 'tenant' }));
    eq(spoofGet.data, null, 'B7d get_property ignores a supplied userId too');
    eq(codes(spoofGet), ['not_authorized'], 'B7e and refuses');

    const spoofTen = await MCP.call('get_tenant',
                                    { propertyId: PROP, tenantId: T1, userId: OWNER },
                                    ctx({ token: 'tenant' }));
    eq(spoofTen.data, null, 'B7f and so does get_tenant');
    eq(codes(spoofTen), ['not_authorized'], 'B7g with the same refusal');
  }

  const noid = await MCP.call('get_property', { propertyId: PROP }, ctx({ token: 'noid' }));
  eq(codes(noid), ['user_identity_missing'], 'B8 an auth response with no id fails closed');

  const down = await MCP.call('get_property', { propertyId: PROP },
                              ctx({ authFetch: auth({ throws: 'TimeoutError' }) }));
  eq(codes(down), ['auth_service_unavailable'],
     'B9 an auth service that times out fails closed, and says which kind of failure');

  const err5 = await MCP.call('get_property', { propertyId: PROP },
                              ctx({ authFetch: auth({ status: 500 }) }));
  eq(codes(err5), ['invalid_or_expired_token'], 'B10 a 5xx from auth is still a refusal');

  // No token ⇒ no auth call at all. Fail closed before any network.
  const a = auth();
  await MCP.call('list_properties', {}, ctx({ token: '   ', authFetch: a }));
  eq(a.calls.length, 0, 'B11 a blank token is refused without contacting the auth service');

  // The Bearer prefix is tolerated, because callers send headers.
  const idr = await MCP.resolveIdentity('Bearer owner', auth());
  is(idr.ok && idr.userId === OWNER, 'B12 a "Bearer " prefix is stripped, not rejected');
  eq(Object.keys(idr).sort(), ['ok', 'userId'],
     'B13 and only the id crosses the boundary — no role, no metadata');
}

// ── C. No authorization from a client-supplied role claim ──────────────────
sec('C. Roles and metadata in the auth payload authorise nothing');
{
  // The owner fixture's payload carries role:'authenticated',
  // app_metadata.role:'admin' and user_metadata.role:'service_role'. If any of
  // those were consulted, the tenant below would be able to claim the same.
  is(!/\.role\b/.test(CODE), 'C1 the word .role appears nowhere in the code');
  is(!/app_metadata/.test(CODE) && !/user_metadata/.test(CODE),
     'C2 nor app_metadata or user_metadata');
  is(!/\bis_admin\b|\bclaims\b/.test(CODE), 'C3 nor any other claim');
  is(/user\.id/.test(CODE), 'C4 only user.id is read');

  // A user whose metadata claims service_role gets exactly what their
  // properties.user_id entitles them to, and no more.
  const impostor = auth();
  impostor.calls.length = 0;
  const claimsAdmin = async () => ({ status: 200, json: {
    id: TENANT, role: 'service_role',
    app_metadata: { role: 'service_role' },
    user_metadata: { role: 'owner', owns_all: true, user_id: OWNER },
  } });
  const r = await MCP.call('list_properties', {}, ctx({ token: 'x', authFetch: claimsAdmin }));
  eq(r.data.properties, [], 'C5 a payload claiming service_role still owns nothing');
  eq(r.data.count, 0, 'C6 and the count says so');
  const g = await MCP.call('get_property', { propertyId: PROP },
                           ctx({ token: 'x', authFetch: claimsAdmin }));
  eq(codes(g), ['not_authorized'], 'C7 and cannot read a property it does not own');
}

// ── D. Ownership, and the tenant identity that must not become a portfolio ─
sec('D. A tenant-portal identity is not a landlord');
{
  // TENANT is a real user with a real session. In the product they also hold a
  // tenant_users row naming PROP (migration 012). None of that is ownership.
  const r = await MCP.call('list_properties', {}, ctx({ token: 'tenant' }));
  eq(r.data.properties, [], 'D1 a tenant-portal user owns no properties');
  eq(r.data.count, 0, 'D2 and gets a count of zero, not somebody else\'s portfolio');
  is(codes(r).indexOf('no_properties_owned') !== -1,
     'D3 with a caveat explaining that tenant access is a separate identity');

  const g = await MCP.call('get_property', { propertyId: PROP }, ctx({ token: 'tenant' }));
  eq(g.data, null, 'D4 and cannot fetch the property their tenancy is in');
  eq(codes(g), ['not_authorized'], 'D5 refused as not authorized');

  const t = await MCP.call('get_tenant', { propertyId: PROP, tenantId: T1 },
                           ctx({ token: 'tenant' }));
  eq(t.data, null, 'D6 nor the tenant record inside it');
  eq(codes(t), ['not_authorized'], 'D7 same refusal');

  // The database fixture would happily answer about PROP. The refusal is ours.
  const generous = db({ ownedBy: OWNER });
  const g2 = await MCP.call('get_property', { propertyId: PROP },
                            ctx({ token: 'tenant', sbFetch: generous }));
  eq(g2.data, null, 'D8 a permissive back end does not change the answer');
  eq(generous.calls.length, 1, 'D9 and only the ownership probe was ever issued');

  // Ownership is never inferred from tenant_users.
  is(!/tenant_users/.test(CODE), 'D10 tenant_users is not consulted for ownership');
  is(/properties\.user_id/.test(SRC), 'D11 ownership is properties.user_id, stated in the code');

  // Service role is transport, never authorisation.
  is(!/serviceRole[\s\S]{0,40}(owns|authoriz|allow)/i.test(CODE),
     'D12 the service-role key is never part of a decision');
}

// ── E. list_properties ─────────────────────────────────────────────────────
sec('E. list_properties returns owned properties, and reads the minimum');
{
  const d = db();
  const r = await MCP.call('list_properties', {}, ctx({ sbFetch: d }));
  eq(r.data.count, 2, 'E1 the owner sees their two properties');
  eq(r.data.properties.map(p => p.propertyId).sort(),
     ['11111111-1111-4111-8111-111111111111', 'cccccccc-0000-4000-8000-00000000000c'],
     'E2 by id');
  eq(r.data.properties.map(p => p.archived), [false, true],
     'E3 with archived state exposed rather than silently filtered');

  eq(d.calls.length, 1, 'E4 in exactly ONE read — no hydration per property');
  is(d.calls[0].path.indexOf('user_id=eq.' + OWNER) !== -1,
     'E5 filtered on the authenticated user');
  is(d.calls[0].path.indexOf('data') === -1,
     'E6 and the property blob is NOT selected', d.calls[0].path);
  is(!/tenant|evidence|cam_reconciliation/.test(d.calls[0].path),
     'E7 no tenant, evidence or CAM read for a listing');
  eq(r.provenance.hydrated, false, 'E8 provenance says the rows were not hydrated');

  is(codes(r).indexOf('summary_only') !== -1,
     'E9 and a caveat that counts and statuses are absent, not zero');
  const summary = r.caveats.find(c => c.code === 'summary_only');
  is(/must not be inferred as zero/.test(summary.message),
     'E10 which says so in as many words');

  // A failed listing is not an empty portfolio.
  const failed = await MCP.call('list_properties', {}, ctx({ sbFetch: db({ listStatus: 500 }) }));
  eq(failed.data, null, 'E11 a failed list read returns null, not []');
  eq(codes(failed), ['read_failed'], 'E12 with a refusal');
  is(/not an empty portfolio/.test(failed.caveats[0].message),
     'E13 that says exactly what it is not');
}

// ── F. get_property and get_tenant ─────────────────────────────────────────
sec('F. The record, and one tenant inside it');
{
  const r = await MCP.call('get_property', { propertyId: PROP }, ctx());
  eq(r.data.propertyId, PROP, 'F1 the property is returned');
  eq(r.data.spaces.length, 2, 'F2 with both spaces');
  eq(r.data.disputes.length, 1, 'F3 and its dispute');
  is(r.data.identity && r.data.identity.totalSqft === 1000, 'F4 and its identity');
  is(!!r.data.fields[T1], 'F5 and per-tenant provenance');
  eq(r.provenance.hydrated, true, 'F6 provenance says it was hydrated');
  is(Array.isArray(r.provenance.reads) && r.provenance.reads.length === 3,
     'F7 over the three approved reads', String((r.provenance.reads || []).length));

  // One data model. get_property must not invent a second shape.
  eq(Object.keys(r.data).sort(),
     ['attention', 'cam', 'disputes', 'documents', 'fields', 'identity',
      'propertyId', 'spaces', 'timeline'],
     'F8 the sections are PropertyRecord\'s own, plus the id that was asked for');

  const t = await MCP.call('get_tenant', { propertyId: PROP, tenantId: T1 }, ctx());
  eq(t.data.tenantId, T1, 'F9 the tenant resolves');
  eq(t.data.tenantName, 'Acme Coffee LLC', 'F10 by name');
  is(t.data.lease && t.data.lease.cap === 0.05, 'F11 with its lease terms — get_lease folded in');
  is(t.data.lease.url === 'https://example.invalid/acme.pdf',
     'F12 including the lease document reference');
  eq(t.data.disputes.length, 1, 'F13 and the disputes scoped to this tenant');
  is(t.data.documents.length >= 1, 'F14 and its documents',
     String(t.data.documents.length));
  is(t.data.documents.every(d => d.tenantId === T1),
     'F14a every one of which belongs to THIS tenant',
     JSON.stringify(t.data.documents.map(d => d.tenantId)));
  is(!!t.data.fieldProvenance && !!t.data.fieldProvenance.cap,
     'F15 and the field-level provenance PropertyRecord already holds');
  is(t.data.fieldProvenance.cap.cited === true && t.data.fieldProvenance.cap.page === 3,
     'F16 with the citation intact — page and source survive the boundary',
     t.data.fieldProvenance.cap.sourceFile + ' p' + t.data.fieldProvenance.cap.page);

  // The second tenant's disputes must not leak into the first's.
  const t2 = await MCP.call('get_tenant', { propertyId: PROP, tenantId: T2 }, ctx());
  eq(t2.data.disputes.length, 0, 'F17 a tenant with no disputes gets an empty list');
  eq(t2.provenance.sectionStatus.disputes, 'ok',
     'F18 and the section is ok, because disputes WERE composed for this property');

  // Scoping, with a fixture where BOTH tenants have documents. Without the
  // second tenant's documents, "filtered by tenant" and "not filtered at all"
  // produce the same list and neither is being tested.
  {
    const both = JSON.parse(JSON.stringify(FULL_BLOB));
    both.tenants[1].lease_url = 'https://example.invalid/northside.pdf';
    both.tenants[1].leaseFileName = 'northside.pdf';
    both.timeline.push({ id: 'e2', type: 'pdf', tenantId: T2,
                         when: '2025-01-09T00:00:00Z',
                         attachments: [{ name: 'ns.pdf', url: 'v', kind: 'pdf' }] });
    const c2 = ctx({ sbFetch: db({ blob: both }) });
    const a1 = await MCP.call('get_tenant', { propertyId: PROP, tenantId: T1 }, c2);
    const a2 = await MCP.call('get_tenant', { propertyId: PROP, tenantId: T2 }, c2);
    is(a1.data.documents.length >= 1 && a2.data.documents.length >= 1,
       'F18a both tenants have documents in this fixture',
       a1.data.documents.length + ' and ' + a2.data.documents.length);
    is(a1.data.documents.every(d => d.tenantId === T1),
       'F18b and tenant one sees only its own');
    is(a2.data.documents.every(d => d.tenantId === T2),
       'F18c and tenant two only its own');
    const names1 = a1.data.documents.map(d => d.name).join(',');
    is(names1.indexOf('northside') === -1,
       'F18d so the other tenant\'s lease never appears here', names1);
  }

  // Stable shape across tenants.
  eq(Object.keys(t.data).sort(), Object.keys(t2.data).sort(),
     'F19 both tenants come back in the same shape');
}

// ── G. UNAVAILABLE IS NOT EMPTY ────────────────────────────────────────────
sec('G. "We could not load it" never becomes "there are none"');
{
  // 1. The property row exists but nothing has ever been saved for it. Every
  //    section below reads `d.x || []` in the hydrator and would otherwise
  //    produce a confident, empty, wrong answer.
  const blank = await MCP.call('get_property', { propertyId: PROP },
                               ctx({ sbFetch: db({ blob: null }) }));
  is(blank.data !== null, 'G1 a property with no stored record still returns data');
  eq(blank.data.disputes, null, 'G2 but disputes is NULL, not []');
  eq(blank.data.spaces,   null, 'G3 spaces is null');
  eq(blank.data.timeline, null, 'G4 timeline is null');
  eq(blank.data.documents,null, 'G5 documents is null');
  eq(blank.provenance.sectionStatus.disputes, 'unavailable',
     'G6 and the status is unavailable, not empty');
  is(codes(blank).indexOf('property.no_stored_record') !== -1,
     'G7 with a caveat naming the reason');
  const nsr = blank.caveats.find(c => c.code === 'property.no_stored_record');
  eq(nsr.severity, 'unavailable', 'G8 at severity unavailable, not degraded');
  is(/UNKNOWN, not zero/.test(nsr.message), 'G9 and it says so in plain words');

  // The ordering rules, tested as a contract rather than only through fixtures.
  // Unavailable outranks degraded outranks empty, and every one of those
  // precedences is a place the wrong answer could be formed.
  {
    const S = MCP.sectionStatus;
    eq(S('disputes', [], ['disputes'], []), 'unavailable',
       'G9a a section named in meta.unavailable is unavailable even when its value is []');
    eq(S('disputes', null, [], []), 'unavailable',
       'G9b a null value is unavailable, never empty');
    eq(S('disputes', undefined, [], []), 'unavailable',
       'G9c and so is undefined — a section nobody set is not a section with none');
    eq(S('spaces', [], [], ['tenants.read_failed']), 'unavailable',
       'G9d an unknown-class degradation outranks empty');
    eq(S('spaces', [{}], [], ['tenants.read_failed']), 'unavailable',
       'G9e and outranks ok');
    eq(S('spaces', [{}], [], ['tenants.from_table_no_review_state']), 'degraded',
       'G9f a known-less degradation is degraded');
    eq(S('disputes', [], [], []), 'empty', 'G9g a present, composed, zero-length section is empty');
    eq(S('disputes', [{}], [], []), 'ok', 'G9h and one with content is ok');
    eq(S('fields', {}, [], []), 'empty', 'G9i an empty object is empty too');
    eq(MCP.sectionValue('unavailable', []), null, 'G9j sectionValue nulls an unavailable section');
    eq(MCP.sectionValue('empty', []), [], 'G9k and leaves a genuinely empty one alone');
  }

  // 2. The same property, but with a blob that genuinely holds nothing.
  const empty = await MCP.call('get_property', { propertyId: PROP },
    ctx({ sbFetch: db({ blob: { tenants: [], invoices: [], disputes: [], timeline: [] } }) }));
  eq(empty.data.disputes, [], 'G10 a genuinely empty record returns [], not null');
  eq(empty.provenance.sectionStatus.disputes, 'empty',
     'G11 with status empty — this IS an answer, and a different one');
  is(codes(empty).indexOf('property.no_stored_record') === -1,
     'G12 and no unavailability caveat');

  // THE DISTINCTION, stated as one assertion.
  is(blank.data.disputes === null && Array.isArray(empty.data.disputes),
     'G13 so "nothing was recorded" and "there are none" are DIFFERENT answers');

  // 3. A section that could not be composed because a module is missing.
  const DEPS = require('./api/_server-deps.js');
  const partial = Object.assign({}, DEPS.load());
  delete partial.TenantSpace;      // spaces and documents cannot be composed
  const noTS = await MCP.call('get_property', { propertyId: PROP },
                              ctx({ deps: partial }));
  eq(noTS.data.spaces, null, 'G14 a missing module makes spaces null');
  eq(noTS.data.documents, null, 'G15 and documents null');
  eq(noTS.provenance.sectionStatus.spaces, 'unavailable', 'G16 status unavailable');
  is(noTS.provenance.unavailable.indexOf('spaces') !== -1,
     'G17 meta.unavailable is carried through to the caller verbatim');
  const su = noTS.caveats.find(c => c.scope === 'spaces');
  is(su && /not a statement that there are none/.test(su.message),
     'G18 with a caveat that refuses the wrong reading explicitly');
  eq(noTS.data.disputes.length, 1,
     'G19 while disputes, which DID compose, are still returned — per section, not all-or-nothing');

  // 4. A tenant roster read that failed. The tenants are unknown, not absent.
  const rosterFail = await MCP.call('get_property', { propertyId: PROP },
    ctx({ sbFetch: db({ blob: { tenants: [], invoices: [], disputes: [], timeline: [] },
                        tenantStatus: 500 }) }));
  eq(rosterFail.data.spaces, null, 'G20 a failed roster read makes spaces null');
  eq(rosterFail.provenance.sectionStatus.spaces, 'unavailable', 'G21 status unavailable');
  const rf = rosterFail.caveats.find(c => c.code === 'tenants.read_failed');
  is(rf && rf.severity === 'unavailable', 'G22 at severity unavailable');
  is(rf && /not empty — they are unknown/.test(rf.message), 'G23 and says which');

  // 5. Degraded is its own state: composed, real, and smaller.
  const degraded = await MCP.call('get_property', { propertyId: PROP },
    ctx({ sbFetch: db({ blob: { tenants: [], invoices: [], disputes: [], timeline: [] },
                        tableTenants: [{ id: T1, property_id: PROP, name: 'Legacy',
                                         sqft: 400, cap: null, start_date: null,
                                         end_date: null, lease_url: null,
                                         lease_type: 'NNN' }] }) }));
  eq(degraded.provenance.sectionStatus.spaces, 'degraded',
     'G24 a table fallback is degraded, not unavailable — the rows are real');
  is(Array.isArray(degraded.data.spaces) && degraded.data.spaces.length === 1,
     'G25 so the spaces are returned, with a caveat about the missing review state');
  const dc = degraded.caveats.find(c => c.code === 'tenants.from_table_no_review_state');
  is(dc && dc.severity === 'degraded', 'G26 at severity degraded');

  // 6. Evidence that could not be read: provenance is UNKNOWN, not guessed.
  //
  // This one is not "known, from less" like the two above. Without the evidence
  // rows FieldProvenance finds no snapshot, so every field carrying a value
  // falls to its floor state `ai_extracted` — output byte-identical to the case
  // where the read SUCCEEDED and there is genuinely nothing on file, and for a
  // reviewer-approved field it is not merely indistinguishable, it is false.
  // G31a-G31j below pin all three states apart.
  const noEv = await MCP.call('get_tenant', { propertyId: PROP, tenantId: T1 },
                              ctx({ sbFetch: db({ evStatus: 503 }) }));
  is(noEv.data !== null, 'G27 the tenant still resolves without evidence');
  eq(noEv.provenance.sectionStatus.fields, 'unavailable',
     'G28 fields is UNAVAILABLE — provenance is unknown, not thinner');
  eq(noEv.data.fieldProvenance, null,
     'G28a and fieldProvenance is null rather than a fabricated state');
  const ec = noEv.caveats.find(c => c.code === 'evidence.read_failed');
  is(ec && ec.severity === 'unavailable', 'G29 the caveat is at severity unavailable');
  is(ec && /provenance is UNKNOWN/.test(ec.message),
     'G29a and says provenance is unknown, not incomplete');
  is(ec && /including fields a reviewer has confirmed/.test(ec.message),
     'G29b naming the reason: a confirmed field would otherwise read as an AI guess');

  // Nothing true is discarded by that null: evidence supplies provenance, never
  // values. Compared against the SAME tenant with the read succeeding.
  {
    const withEv = await MCP.call('get_tenant', { propertyId: PROP, tenantId: T1 }, ctx());
    for (const k of ['tenantName', 'lease', 'space', 'counts', 'summary', 'camResult']) {
      eq(noEv.data[k], withEv.data[k],
         'G29c.' + k + ' ' + k + ' is unaffected by the evidence read failing');
    }
    is(withEv.data.fieldProvenance !== null,
       'G29d while the successful read does return provenance');
  }

  // ── The three states this contract must keep apart ──────────────────────
  // 1 no evidence exists · 2 evidence read, uncited · 3 evidence read FAILED
  {
    const UNCITED = Object.assign({}, EV_ROW,
      { source_file: null, source_page: null, quote: null });
    const CONFIRMED = Object.assign({}, EV_ROW,
      { reviewer_uid: 'rev-1', reviewer_email: 'asset.manager@example.com',
        reviewed_at: '2025-06-01T00:00:00Z', approved: true });

    const s1 = await MCP.call('get_tenant', { propertyId: PROP, tenantId: T1 },
                              ctx({ sbFetch: db({ evidence: [] }) }));
    const s2 = await MCP.call('get_tenant', { propertyId: PROP, tenantId: T1 },
                              ctx({ sbFetch: db({ evidence: [UNCITED] }) }));
    const s3 = await MCP.call('get_tenant', { propertyId: PROP, tenantId: T1 },
                              ctx({ sbFetch: db({ evStatus: 503 }) }));
    const s4 = await MCP.call('get_tenant', { propertyId: PROP, tenantId: T1 },
                              ctx({ sbFetch: db({ evidence: [CONFIRMED] }) }));

    eq(s1.provenance.sectionStatus.fields, 'ok',
       'G31a state 1 — read succeeded, no evidence on file: fields is ok');
    is(s1.data.fieldProvenance !== null && s1.data.fieldProvenance.cap.state === 'ai_extracted',
       'G31b and the field states its genuine floor, ai_extracted',
       s1.data.fieldProvenance.cap.state);

    eq(s2.provenance.sectionStatus.fields, 'ok',
       'G31c state 2 — read succeeded, a row with no citation: fields is ok');
    is(s2.data.fieldProvenance.cap.cited === false,
       'G31d and the field is honestly uncited');

    eq(s3.provenance.sectionStatus.fields, 'unavailable',
       'G31e state 3 — the read FAILED: fields is unavailable');
    eq(s3.data.fieldProvenance, null, 'G31f and provenance is null');

    // The distinction, as one assertion each way.
    is(s1.data.fieldProvenance !== null && s3.data.fieldProvenance === null,
       'G31g so "no evidence exists" and "evidence unreadable" are DIFFERENT answers');
    is(s2.data.fieldProvenance !== null && s3.data.fieldProvenance === null,
       'G31h and so are "uncited" and "unreadable"');

    // The case that made this incorrect rather than merely imprecise.
    eq(s4.data.fieldProvenance.cap.state, 'manually_confirmed',
       'G31i a reviewer-approved field reads as manually confirmed when evidence loads');
    eq(s4.data.fieldProvenance.cap.by, 'asset.manager@example.com',
       'G31j naming the reviewer — which a failed read must never silently replace ' +
       'with an unattributed AI extraction');
  }

  // 7. get_tenant when spaces are unavailable must not say "no such tenant".
  const ghost = await MCP.call('get_tenant', { propertyId: PROP, tenantId: T1 },
                               ctx({ deps: partial }));
  eq(ghost.data, null, 'G30 it returns no data');
  eq(codes(ghost)[0], 'section_unavailable',
     'G31 as section_unavailable — NOT tenant_not_found');
  is(/UNKNOWN/.test(ghost.caveats[0].message),
     'G32 because whether the tenant exists is unknown, not settled');
  is(codes(ghost).indexOf('tenant_not_found') === -1,
     'G33 and the false negative is never emitted');
}

// ── H. Cross-property tenant access ────────────────────────────────────────
sec('H. A tenant id from another property does not resolve');
{
  const r = await MCP.call('get_tenant', { propertyId: PROP, tenantId: FOREIGN_TENANT }, ctx());
  eq(r.data, null, 'H1 a foreign tenant id returns no data');
  eq(codes(r), ['tenant_not_found'], 'H2 as tenant_not_found');
  is(/another property does not resolve/.test(r.caveats[0].message),
     'H3 and the message says why');
  eq(r.provenance.spacesConsidered, 2,
     'H4 having looked only inside the owned property\'s own spaces');

  // Asking about the OTHER property directly is a different refusal.
  const other = await MCP.call('get_tenant', { propertyId: OTHER, tenantId: FOREIGN_TENANT }, ctx());
  eq(codes(other), ['not_authorized'], 'H5 and the other property is refused outright');

  // Structural: the lookup is a find() over the hydrated record, not a query.
  is(/rec\.spaces \|\| \[\]\)\.find/.test(CODE),
     'H6 the tenant is found inside the owned record, not fetched by id');
  is(!/\/tenants\?id=eq/.test(CODE),
     'H7 there is no query anywhere here that could reach another property\'s rows');
}

// ── I. Read-only, and the approved reads only ──────────────────────────────
sec('I. No writes, no RPC, and only the reads M1b approved');
{
  const d = db();
  await MCP.call('get_property', { propertyId: PROP }, ctx({ sbFetch: d }));
  await MCP.call('get_tenant', { propertyId: PROP, tenantId: T1 }, ctx({ sbFetch: d }));
  await MCP.call('list_properties', {}, ctx({ sbFetch: d }));
  is(d.calls.every(c => c.method === 'GET'), 'I1 every request is a GET',
     Array.from(new Set(d.calls.map(c => c.method))).join(','));

  const tables = Array.from(new Set(d.calls.map(c => c.path.split('?')[0]))).sort();
  eq(tables, ['/properties', '/tenant_field_evidence'],
     'I2 and only the approved tables were touched');

  const guarded = MCP._readOnly(async () => ({ status: 200, json: [] }));
  eq(MCP.WRITE_METHODS.slice().sort(), ['DELETE', 'PATCH', 'POST', 'PUT'],
     'I3 the guard names exactly the four methods that change data');
  for (const m of ['POST', 'PATCH', 'PUT', 'DELETE', 'delete']) {
    let threw = false;
    try { await guarded('/properties', { method: m }); } catch (_e) { threw = true; }
    is(threw, 'I4.' + m + ' a ' + m + ' is refused');
  }

  const noList = CODE.replace(/const WRITE_METHODS[\s\S]*?\];/, '');
  is(!/'(POST|PATCH|PUT|DELETE)'/.test(noList),
     'I5 no write method is named outside the guard\'s own list');
  is(!/\brpc\/|\.rpc\(/.test(CODE), 'I6 no RPC — a procedure could write');
  is(!/insert|upsert|update\(|delete\(/i.test(noList.replace(/updatedAt|updated_at/g, '')),
     'I7 and no write vocabulary anywhere');
}

// ── J. No browser anything ─────────────────────────────────────────────────
sec('J. No browser API, no localStorage, no second hydration');
{
  is(!/\blocalStorage\b/.test(CODE),        'J1 localStorage does not appear');
  is(!/\bdocument\./.test(CODE),            'J2 nor document.');
  is(!/\bwindow\./.test(CODE),              'J3 nor window.');
  is(!/\bloadPropertyData\s*\(/.test(CODE), 'J4 loadPropertyData is not called');
  is(!/\bgetCamYear\s*\(/.test(CODE),       'J5 getCamYear is not called');
  is(/require\('\.\/_property-record-hydrator\.js'\)/.test(CODE),
     'J6 the accepted hydrator is used');
  is(!/PropertyRecord\.assemble/.test(CODE),
     'J7 and assemble() is not called directly — no second hydration path');

  // Booby-trap the browser globals and run everything again.
  const trap = (n) => ({ configurable: true,
                         get() { throw new Error('[test] ' + n + ' was touched'); } });
  Object.defineProperty(global, 'localStorage', trap('localStorage'));
  Object.defineProperty(global, 'document',     trap('document'));
  let err = null, out = null;
  try {
    out = await MCP.call('get_property', { propertyId: PROP }, ctx());
    await MCP.call('get_tenant', { propertyId: PROP, tenantId: T1 }, ctx());
    await MCP.call('list_properties', {}, ctx());
  } catch (e) { err = e; }
  delete global.localStorage;
  delete global.document;
  is(!err, 'J8 all three capabilities run with localStorage and document booby-trapped',
     err ? err.message : 'no contact');
  is(out && out.data && out.data.spaces.length === 2, 'J9 and produce the same record');

  const DEPS = require('./api/_server-deps.js');
  eq(DEPS.leakedWindow(), false, 'J10 and leave no window behind');
  eq(DEPS.SHIM_KEYS.slice().sort(),
     ['LeaseIntelligence', 'PropertyReference', 'PropertyWorkspace', 'TenantSpace'],
     'J11 the M3 shim allow-list is unchanged — M4 did not broaden it');
}

// ── K. Tool descriptors ────────────────────────────────────────────────────
sec('K. Exactly three capabilities, described honestly');
{
  eq(MCP.TOOLS.map(t => t.name), ['list_properties', 'get_property', 'get_tenant'],
     'K1 three tools, and only three');
  for (const t of MCP.TOOLS) {
    is(typeof t.description === 'string' && t.description.length > 60,
       'K2.' + t.name + ' has a description worth reading');
    is(t.inputSchema && t.inputSchema.type === 'object',
       'K3.' + t.name + ' has an input schema');
    is(t.inputSchema.additionalProperties === false,
       'K4.' + t.name + ' refuses unknown arguments');
    is(typeof t.handler === 'function', 'K5.' + t.name + ' has a handler');
  }
  is(!MCP.TOOLS.some(t => /search_property_memory|cam_|attention|timeline_|evidence_|dispute_|payment|ripple|xrpl/i.test(t.name)),
     'K6 and none of the capabilities this phase excluded');
  const gp = MCP.TOOLS.find(t => t.name === 'get_property');
  is(/null never means "none"/.test(gp.description),
     'K7 get_property\'s own description states the null rule');
  const lp = MCP.TOOLS.find(t => t.name === 'list_properties');
  is(/must not be read as zero/.test(lp.description),
     'K8 and list_properties warns against reading its silence as zero');

  // Arguments are validated.
  for (const [tool, args] of [['get_property', {}], ['get_tenant', { propertyId: PROP }],
                              ['get_tenant', { tenantId: T1 }]]) {
    const r = await MCP.call(tool, args, ctx());
    eq(codes(r), ['invalid_arguments'], 'K9 ' + tool + ' rejects incomplete arguments');
  }
  const nonString = await MCP.call('get_property', { propertyId: { evil: 1 } }, ctx());
  eq(codes(nonString), ['invalid_arguments'], 'K10 and a non-string id');
}

// ── L. Stable output shape ─────────────────────────────────────────────────
sec('L. The same question gives the same shape');
{
  const shapes = [];
  for (const opts of [{}, { blob: null }, { evStatus: 503 },
                      { blob: { tenants: [], invoices: [], disputes: [], timeline: [] } }]) {
    const r = await MCP.call('get_property', { propertyId: PROP }, ctx({ sbFetch: db(opts) }));
    shapes.push(Object.keys(r.data).sort().join(','));
  }
  eq(new Set(shapes).size, 1, 'L1 get_property returns one shape across four back-end states');
  is(shapes[0].split(',').length === 9, 'L2 with nine fields every time', shapes[0]);

  const envShapes = [];
  for (const [tool, args] of [['list_properties', {}], ['get_property', { propertyId: PROP }],
                              ['get_tenant', { propertyId: PROP, tenantId: T1 }],
                              ['get_property', { propertyId: OTHER }]]) {
    const r = await MCP.call(tool, args, ctx());
    envShapes.push(Object.keys(r).sort().join(','));
  }
  eq(new Set(envShapes).size, 1, 'L3 and the envelope is identical across tools and refusals',
     envShapes[0]);

  // Determinism: the same inputs give the same bytes.
  const one = await MCP.call('get_property', { propertyId: PROP }, ctx());
  const two = await MCP.call('get_property', { propertyId: PROP }, ctx());
  eq(JSON.stringify(one), JSON.stringify(two), 'L4 and two identical calls agree exactly');
}

console.log(`\n${fail ? '\x1b[31m' : '\x1b[32m'}RESULT: ${pass} passed, ${fail} failed\x1b[0m`);
process.exit(fail ? 1 : 0);

})().catch(e => { console.error(e); process.exit(1); });
