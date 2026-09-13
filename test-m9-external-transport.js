'use strict';
/**
 * test-m9-external-transport.js — the external boundary, asserted.
 *
 *   node test-m9-external-transport.js
 *
 * OFFLINE. Every transport, auth call and clock is defined in this file.
 * Nothing here opens a socket or can reach Pilot or Production.
 *
 * WHAT M9 HAD TO PROVE
 * --------------------
 * M8 closed the capability layer and the final gate found it safe. M9 adds the
 * only thing that can undo that: a way in from outside. So this suite is not
 * organised around the transport's features — it is organised around the
 * guarantees M8 established, each re-asserted THROUGH the transport, plus the
 * four boundary rules the transport itself introduces.
 *
 * The one to read is section C. Everything else checks that a rule holds; C
 * checks that a rule cannot be reached around. It captures the context the
 * capability layer actually received and asserts its exact key set, because the
 * P0 here is not "the transport ignores a `now` field" — it is "there is no
 * key a caller can set that ends up in ctx", and only the received object can
 * settle that.
 */

const fs   = require('fs');
const T    = require('./api/_mcp-transport.js');
const CAP  = require('./api/_mcp-capabilities.js');
const HYD  = require('./api/_property-record-hydrator.js');
const RL   = require('./api/_rate-limit');

let pass = 0, fail = 0;
const ok  = (m, d) => { console.log('  \x1b[32m✓\x1b[0m ' + m + (d ? '  — ' + d : '')); pass++; };
const bad = (m, d) => { console.log('  \x1b[31m✗\x1b[0m ' + m + (d ? '  — ' + d : '')); fail++; };
const is  = (c, m, d) => (c ? ok(m, d) : bad(m, d));
const eq  = (a, b, m) => (JSON.stringify(a) === JSON.stringify(b)
  ? ok(m, JSON.stringify(a))
  : bad(m, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`));
const sec = (t) => console.log('\n\x1b[1m── ' + t + ' ──\x1b[0m');

const OWNER   = '22222222-2222-4222-8222-222222222222';
const TENANTU = '33333333-3333-4333-8333-333333333333';
const PROP    = '11111111-1111-4111-8111-111111111111';
const T1      = 'aaaaaaaa-0000-4000-8000-000000000001';

/** An auth service that hands back forged claims, to prove none of them count. */
const auth = async (tok) => {
  if (tok === 'owner')  return { status: 200, json: {
    id: OWNER, role: 'service_role',
    app_metadata:  { role: 'admin', owns: [PROP], provider: 'email' },
    user_metadata: { role: 'admin', user_id: OWNER, is_admin: true } } };
  if (tok === 'tenant') return { status: 200, json: {
    id: TENANTU, app_metadata: { property_id: PROP, role: 'landlord' } } };
  if (tok === 'noid')   return { status: 200, json: { email: 'x@y.z' } };
  if (tok === 'slow')   { const e = new Error('t'); e.name = 'TimeoutError'; throw e; }
  return { status: 401, json: {} };
};

const LEGACY_ROW = {
  tenantId: T1, tenantName: 'Acme Coffee LLC', allocatedAmount: 12000,
  actualCam: 12000, expectedCam: 5, variance: 11995,
  expectedCamBasis: 'legacy_unverified', capApplied: true, proRataPercent: 12,
  internalScratch: 'must never travel',
};

const EVIDENCE = [{
  tenant_id: T1, field_key: 'cap', value: '5', confidence_status: 'verified',
  confidence_note: null, source_file: 'acme-lease.pdf', source_page: 12,
  quote: 'not to exceed five percent (5%)', extraction_id: 'e1',
  extraction_version: 1, reviewer_uid: 'uid-9f2',
  reviewer_email: 'jane.doe@landlordco.com', reviewed_at: '2026-02-02T00:00:00Z',
  approved: true, manually_edited: false, original_extracted_value: null,
  created_at: '2026-02-02T00:00:00Z',
}];

function blob(over) {
  return Object.assign({
    tenants: [{ id: T1, tenant_name: 'Acme Coffee LLC', leased_sqft: 1200, cap: 5,
                lease_type: 'NNN', end_date: '2026-10-01' }],
    disputes: [{ id: 'd1', status: 'open', tenantId: T1, amount: 500 }],
    invoices: [],
    timeline: [{ id: 'e1', timestamp: '2026-09-01T00:00:00Z', type: 'note',
                 subject: { id: T1, type: 'suite' } }],
    camReconciliation: { camYear: 2025, total: 100000, results: [LEGACY_ROW] },
  }, over || {});
}

function db(o) {
  const opt = Object.assign({ sqft: 10000, blob: blob(), evidence: EVIDENCE }, o || {});
  const seen = [];
  const fn = async (p, options) => {
    seen.push(((options || {}).method || 'GET') + ' ' + p);
    const uid = (p.match(/user_id=eq\.([^&]+)/) || [])[1];
    if (/^\/properties\?id=eq\.[^&]+&user_id=eq\.[^&]+&select=id$/.test(p))
      return { status: 200, json: uid === OWNER ? [{ id: PROP }] : [] };
    if (/^\/properties\?id=eq\./.test(p))
      return { status: 200, json: uid === OWNER
        ? [{ id: PROP, name: 'Plaza', sqft: opt.sqft, data: opt.blob }] : [] };
    if (/^\/properties\?user_id=eq\./.test(p))
      return { status: 200, json: uid === OWNER
        ? [{ id: PROP, name: 'Plaza', sqft: opt.sqft, created_at: '2026-01-01T00:00:00Z',
             updated_at: '2026-01-01T00:00:00Z', archived_at: null }] : [] };
    if (/^\/tenant_field_evidence\?/.test(p))
      return { status: opt.evStatus || 200, json: opt.evidence };
    if (/^\/tenants\?/.test(p)) return { status: 200, json: [] };
    return { status: 404, json: [] };
  };
  fn.seen = seen;
  return fn;
}

/** A rate limiter that never refuses, so ordinary cases don't spend budget. */
const allowRate = () => ({ ok: true, remaining: 99, retryAfterSec: 0, limit: 60 });

const seamFor = (o) => Object.assign(
  { authFetch: auth, sbFetch: db(o && o.db), checkRate: allowRate }, (o && o.seam) || {});

const call = (tool, args, o) => T.serve({
  httpMethod: 'POST',
  headers: Object.assign({ authorization: 'Bearer ' + ((o && o.token) || 'owner') },
                         (o && o.headers) || {}),
  body: { jsonrpc: '2.0', id: 1, method: 'tools/call',
          params: { name: tool, arguments: args || {} } },
}, seamFor(o));

const rpc = (method, params, o) => T.serve({
  httpMethod: 'POST',
  headers: Object.assign({ authorization: 'Bearer ' + ((o && o.token) || 'owner') },
                         (o && o.headers) || {}),
  body: { jsonrpc: '2.0', id: 7, method: method, params: params || {} },
}, seamFor(o));

/** The envelope inside a successful tools/call result. */
const env = (r) => r.body && r.body.result && r.body.result.structuredContent;

const ALL = ['list_properties', 'get_property', 'get_tenant', 'get_lease_evidence',
             'get_space', 'get_timeline', 'get_disputes', 'get_cam_status', 'get_attention'];
const argsFor = () => ({ propertyId: PROP, tenantId: T1, spaceId: T1 });
/** Only the arguments a given tool declares — the transport rejects the rest. */
function argsOf(name) {
  const tool = CAP.TOOLS.find(t => t.name === name);
  const declared = Object.keys((tool.inputSchema && tool.inputSchema.properties) || {});
  const all = argsFor(), out = {};
  for (const k of declared) if (all[k] !== undefined) out[k] = all[k];
  return out;
}

/**
 * Run `fn` with one tool's handler replaced, so the (args, ctx) the capability
 * layer actually received can be inspected. Restored in a finally.
 */
async function captureHandler(toolName, fn) {
  const tool = CAP.TOOLS.find(t => t.name === toolName);
  const original = tool.handler;
  const seen = [];
  tool.handler = async (a, c) => { seen.push({ args: a, ctx: c }); return original(a, c); };
  try { await fn(); } finally { tool.handler = original; }
  return seen;
}

(async function main() {

// ═══════════════════════════════════════════════════════════════════════════
sec('A. The transport surface');
// ═══════════════════════════════════════════════════════════════════════════
{
  const init = await rpc('initialize');
  eq(init.status, 200, 'A1 initialize succeeds for an authenticated caller');
  eq(init.body.result.protocolVersion, T.PROTOCOL_VERSION, 'A2 and states the protocol version');
  is(!!init.body.result.serverInfo.name, 'A3 and names the server',
     init.body.result.serverInfo.name);
  is(/never means none/i.test(init.body.result.instructions),
     'A4 the instructions carry the truthfulness contract to the agent');

  const list = await rpc('tools/list');
  eq(list.body.result.tools.length, 9, 'A5 nine tools are advertised');
  eq(list.body.result.tools.map(t => t.name).sort(), ALL.slice().sort(),
     'A6 exactly the nine M8 capabilities, no more');
  is(list.body.result.tools.every(t => t.description && t.inputSchema),
     'A7 each carries a description and an input schema');
  /**
   * BY KEYS, NOT BY SERIALISATION. JSON.stringify drops function values, so a
   * listing that still carried `handler` would serialise identically to one
   * that did not — a mutant that leaked the whole tool object survived this
   * assertion in its first form. The same trap as NaN in M8c/M8d.
   */
  for (const t of list.body.result.tools) {
    eq(Object.keys(t).sort(), ['description', 'inputSchema', 'name'],
       'A8 ' + t.name + ': the listing carries exactly name, description, schema');
    is(typeof t.handler === 'undefined', 'A8b ' + t.name + ': no handler is attached');
  }

  const unknown = await rpc('tools/delete_property');
  eq(unknown.status, 404, 'A9 an unknown method is refused');
  eq(unknown.body.error.code, T.RPC.METHOD_NOT_FOUND, 'A10 with method-not-found');

  const badTool = await call('drop_tables', {});
  eq(badTool.status, 404, 'A11 an unknown TOOL is refused, not guessed at');

  const get = await T.serve({ httpMethod: 'GET', headers: { authorization: 'Bearer owner' },
                              body: {} }, seamFor());
  eq(get.status, 405, 'A12 a non-POST method is refused');
  eq(get.headers.Allow, 'POST', 'A13 and says what is allowed');

  for (const [label, b] of [['null', null], ['an array', []], ['a string', 'hi']]) {
    const r = await T.serve({ httpMethod: 'POST',
      headers: { authorization: 'Bearer owner' }, body: b }, seamFor());
    eq(r.status, 400, 'A14 a body that is ' + label + ' is refused');
  }
  const noMethod = await T.serve({ httpMethod: 'POST',
    headers: { authorization: 'Bearer owner' }, body: { jsonrpc: '2.0', id: 1 } }, seamFor());
  eq(noMethod.status, 400, 'A15 a message with no method is refused');
}

// ═══════════════════════════════════════════════════════════════════════════
sec('B. Authentication and authorization, through the transport');
// ═══════════════════════════════════════════════════════════════════════════
{
  // 1 — a valid authenticated owner reaches every tool.
  for (const name of ALL) {
    const r = await call(name, argsOf(name));
    eq(r.status, 200, 'B1 ' + name + ': the owner is served');
    is(env(r) && env(r).data !== null, 'B2 ' + name + ': and receives data');
  }

  // 2 — missing, malformed and rejected credentials.
  for (const [label, headers, expect] of [
        ['no Authorization header', {}, 401],
        ['an empty bearer',         { authorization: 'Bearer ' }, 401],
        ['a rejected token',        { authorization: 'Bearer forged' }, 401],
        ['a token with no id',      { authorization: 'Bearer noid' }, 401],
        ['an unreachable auth service', { authorization: 'Bearer slow' }, 503],
      ]) {
    const r = await T.serve({ httpMethod: 'POST', headers: headers,
      body: { jsonrpc: '2.0', id: 1, method: 'tools/call',
              params: { name: 'get_property', arguments: { propertyId: PROP } } } }, seamFor());
    eq(r.status, expect, 'B3 ' + label + ' → ' + expect);
    is(!r.body.result, 'B4 ' + label + ' returns no result');
  }
  // Discovery is gated too — one rule, no second door.
  for (const m of ['initialize', 'tools/list']) {
    const r = await T.serve({ httpMethod: 'POST', headers: {},
      body: { jsonrpc: '2.0', id: 1, method: m } }, seamFor());
    eq(r.status, 401, 'B5 ' + m + ' also requires authentication');
  }

  /**
   * FAIL CLOSED BEFORE THE TRANSPORT, not merely at it.
   *
   * A request with no bearer must be refused without costing an auth
   * round-trip. Two guards agree on the outcome — the empty-bearer check and
   * resolveIdentity — so removing the first changes no status code and looked
   * safe to mutation testing. It is not the same thing: without the early
   * return, every unauthenticated request reaches the auth service, which is
   * exactly the cost the pre-auth brake exists to avoid.
   */
  let authCalls = 0;
  const countingAuth = async (t) => { authCalls++; return auth(t); };
  const noTok = await T.serve({ httpMethod: 'POST', headers: {},
    body: { jsonrpc: '2.0', id: 1, method: 'tools/list' } },
    { authFetch: countingAuth, sbFetch: db(), checkRate: allowRate });
  eq(noTok.status, 401, 'B5b a request with no token is refused');
  eq(authCalls, 0, 'B5c and never reached the auth service at all');
  /**
   * The two 401s say different things, and that is the whole reason the
   * empty-bearer guard exists as well as resolveIdentity's own.
   *
   * Both refuse, both refuse before any transport, so removing the first
   * changes no status code — it is defence in depth, and mutation testing said
   * so by surviving. What it is NOT is redundant to a caller: "send a bearer
   * token" and "the caller could not be authenticated" are different problems
   * with different fixes, and an agent that cannot tell them apart retries the
   * wrong one. Pinning the message is what makes the guard load-bearing.
   */
  is(/send a bearer token/i.test(noTok.body.error.message),
     'B5c2 a missing header is told to send a token', noTok.body.error.message);
  const badTok = await T.serve({ httpMethod: 'POST',
    headers: { authorization: 'Bearer forged' },
    body: { jsonrpc: '2.0', id: 1, method: 'tools/list' } }, seamFor());
  is(/could not be authenticated/i.test(badTok.body.error.message),
     'B5c3 a rejected token is told its credential failed', badTok.body.error.message);
  is(noTok.body.error.message !== badTok.body.error.message,
     'B5c4 and the two are distinguishable');
  const withTok = await T.serve({ httpMethod: 'POST',
    headers: { authorization: 'Bearer owner' },
    body: { jsonrpc: '2.0', id: 1, method: 'tools/list' } },
    { authFetch: countingAuth, sbFetch: db(), checkRate: allowRate });
  eq(withTok.status, 200, 'B5d a request with one is served');
  eq(authCalls, 1, 'B5e having resolved the token exactly once');

  // 3 — forged claims in the auth payload change nothing. The owner token's
  //     response carries role: service_role and app_metadata.owns = [PROP].
  const forged = db();
  const r3 = await call('get_property', { propertyId: PROP }, { db: undefined, seam: { sbFetch: forged } });
  eq(r3.status, 200, 'B6 the owner is authorised by user.id alone');
  is(forged.seen.every(s => /user_id=eq\./.test(s) || /tenant_field_evidence|tenants\?/.test(s)),
     'B7 every property read carried a user_id filter');
  is(forged.seen.filter(s => /user_id=eq\./.test(s)).length >= 2,
     'B8 ownership is checked AND filtered on the read itself',
     String(forged.seen.filter(s => /user_id=eq\./.test(s)).length));

  // 4 — a tenant-portal identity holds a valid session for a property it does
  //     not own, and asserts app_metadata.role = 'landlord'. It gets nothing.
  for (const name of ALL) {
    const r = await call(name, argsOf(name), { token: 'tenant' });
    const e = env(r);
    if (name === 'list_properties') {
      eq(e.data.count, 0, 'B9 ' + name + ': a tenant identity gets an empty portfolio');
    } else {
      eq(e.data, null, 'B10 ' + name + ': a tenant identity is refused');
      is(e.caveats.some(c => c.severity === 'refusal'), 'B11 ' + name + ': as a refusal');
      is(r.body.result.isError === true, 'B12 ' + name + ': flagged isError for the agent');
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
sec('C. The context is server-owned — the P0');
// ═══════════════════════════════════════════════════════════════════════════
{
  const evilFetch = async () => { throw new Error('caller-supplied transport ran'); };
  const evilAuth  = async () => ({ status: 200, json: { id: 'attacker' } });

  /** Every shape an injection attempt can take through a JSON-RPC body. */
  const ATTEMPTS = [
    ['in tool arguments',   { params: { name: 'get_property', arguments: {
        propertyId: PROP, now: '1999-01-01T00:00:00Z', sbFetch: evilFetch,
        authFetch: evilAuth, deps: { PropertyArea: null }, token: 'attacker' } } }],
    ['beside params.name',  { params: { name: 'get_property', arguments: { propertyId: PROP },
        now: '1999-01-01T00:00:00Z', sbFetch: evilFetch, authFetch: evilAuth,
        deps: {}, ctx: { token: 'attacker' } } }],
    ['at the top level',    { now: '1999-01-01T00:00:00Z', nowMs: 1,
        sbFetch: evilFetch, authFetch: evilAuth, deps: {}, ctx: { token: 'attacker' },
        params: { name: 'get_property', arguments: { propertyId: PROP } } }],
  ];

  /**
   * The seam this test supplies, held by identity so the assertions below can
   * say something stronger than "no seam is present": they say the seam the
   * SERVER side passed is the one that ran, and the caller's is not anywhere.
   *
   * Asserting absence would be the weaker claim and, here, a false one — an
   * offline test has to inject a transport to avoid a socket. What matters is
   * that injection is reachable only from serve()'s second parameter, which is
   * why C16/C17 check the production call site separately.
   */
  const mySb = db();
  const mySeam = { authFetch: auth, sbFetch: mySb, checkRate: allowRate };

  for (const [label, extra] of ATTEMPTS) {
    const seen = await captureHandler('get_property', async () => {
      await T.serve({
        httpMethod: 'POST',
        headers: { authorization: 'Bearer owner' },
        body: Object.assign({ jsonrpc: '2.0', id: 1, method: 'tools/call' }, extra),
      }, mySeam);
    });
    if (label === 'in tool arguments') {
      // Unknown keys are refused outright, so the capability is never reached.
      eq(seen.length, 0, 'C1 ' + label + ': the call is rejected before dispatch');
      continue;
    }
    eq(seen.length, 1, 'C2 ' + label + ': the capability ran once');
    const ctx = seen[0].ctx;
    eq(Object.keys(ctx).sort(), ['authFetch', 'now', 'sbFetch', 'token'],
       'C3 ' + label + ': ctx carries only the server-side seam plus {token, now}');
    is(ctx.sbFetch === mySb && ctx.authFetch === auth,
       'C4a ' + label + ': the transport that ran is the one the SERVER passed');
    is(ctx.sbFetch !== evilFetch && ctx.authFetch !== evilAuth,
       'C4b ' + label + ': and never the one the caller sent');
    is(!('deps' in ctx), 'C4c ' + label + ': the caller\'s deps did not appear at all');
    is(ctx.now !== '1999-01-01T00:00:00Z', 'C5 ' + label + ': asOf was not overridden', ctx.now);
    is(ctx.token === 'owner', 'C6 ' + label + ': the token came from the header');
    eq(seen[0].args, { propertyId: PROP },
       'C7 ' + label + ': the capability saw only declared arguments');
    is(Object.isFrozen(ctx), 'C8 ' + label + ': and the context is frozen');
  }

  // The production shape: with no seam at all, ctx is exactly {token, now}.
  eq(Object.keys(T._buildContext('tok', Date.now())).sort(), ['now', 'token'],
     'C8b with no seam — the production path — ctx is exactly {token, now}');

  /**
   * The split itself, asserted directly. The rejection above is what a caller
   * sees, but the guarantee underneath it is that an undeclared key never lands
   * in the object handed to a capability — held here even if the rejection were
   * ever relaxed.
   */
  const propTool = CAP.TOOLS.find(t => t.name === 'get_property');
  const sp = T._splitInput(propTool, { propertyId: PROP, now: 'x', sbFetch: 'y', deps: {} });
  eq(sp.args, { propertyId: PROP }, 'C8c _splitInput forwards only declared keys');
  eq(sp.unknown.sort(), ['deps', 'now', 'sbFetch'], 'C8d and names every one it withheld');
  const tlTool = CAP.TOOLS.find(t => t.name === 'get_timeline');
  const sp2 = T._splitInput(tlTool, { propertyId: PROP, limit: 5, offset: 2, bogus: 1 });
  eq(sp2.args, { propertyId: PROP }, 'C8e pagination is consumed, not forwarded');
  eq(sp2.page, { limit: 5, offset: 2 }, 'C8f and kept for the transport');
  eq(sp2.unknown, ['bogus'], 'C8g while an undeclared key is still withheld');

  // asOf is not settable through the request object either.
  const viaReq = await T.serve({ httpMethod: 'POST', nowMs: 1,
    headers: { authorization: 'Bearer owner' },
    body: { jsonrpc: '2.0', id: 1, method: 'tools/call',
            params: { name: 'get_property', arguments: { propertyId: PROP } } } }, seamFor());
  is(Date.parse(env(viaReq).asOf) > 1600000000000,
     'C8h a nowMs on the request object does not become asOf', env(viaReq).asOf);

  // The unknown-argument rule, stated as its own guarantee.
  const rej = await call('get_property', { propertyId: PROP, sbFetch: 'x' });
  eq(rej.status, 400, 'C9 an undeclared argument is a stated error, not a silent pass');
  is(/Unknown argument/.test(rej.body.error.message), 'C10 and names it',
     rej.body.error.message);
  for (const k of ['now', 'deps', 'authFetch', 'token', 'userId', 'role']) {
    const r = await call('get_property', Object.assign({ propertyId: PROP }, { [k]: 'x' }));
    eq(r.status, 400, 'C11 "' + k + '" cannot be smuggled through arguments');
  }

  // asOf comes from the server clock.
  const before = Date.now();
  const r = await call('get_property', { propertyId: PROP });
  const after = Date.now();
  const at = Date.parse(env(r).asOf);
  is(at >= before - 5 && at <= after + 5, 'C12 asOf is generated from the server clock',
     env(r).asOf);
  is(!('nowMs' in (T._buildContext('t', 1) || {})), 'C13 nowMs never becomes a ctx key');
  eq(Object.keys(T._buildContext('t', 1)).sort(), ['now', 'token'],
     'C14 _buildContext names every key it sets');
  eq(T.CTX_KEYS.slice().sort(), ['authFetch', 'deps', 'now', 'sbFetch', 'token'],
     'C15 and the documented allow-list matches');

  /**
   * The seam is a second parameter, and the production call site does not pass
   * one. Checked against the EXECUTABLE file with comments stripped — the header
   * of api/mcp.js explains the seams at length, and a check that tripped over
   * its own documentation would be measuring prose.
   */
  const src = fs.readFileSync('./api/mcp.js', 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  is(/TRANSPORT\.serve\(/.test(code), 'C16a api/mcp.js reaches the transport through serve()');
  const callMatch = /TRANSPORT\.serve\(([\s\S]*?)\n\s*\}\);/.exec(code);
  is(!!callMatch && !/\},\s*\{/.test(callMatch[0]),
     'C16b and passes exactly one argument — no seam object follows the request');
  is(!/sbFetch|authFetch|\bdeps\b/.test(code),
     'C17 no capability seam is named anywhere in its executable code');
  is(!/nowMs\s*:/.test(code), 'C18 and it never sets nowMs, so asOf stays the server\'s');
}

// ═══════════════════════════════════════════════════════════════════════════
sec('D. Every database operation stays read-only');
// ═══════════════════════════════════════════════════════════════════════════
{
  const all = [];
  for (const name of ALL) {
    const f = db();
    await call(name, argsOf(name), { seam: { sbFetch: f } });
    all.push(...f.seen);
  }
  const writes = all.filter(s => !s.startsWith('GET '));
  eq(writes, [], 'D1 no capability issued a non-GET through the transport ('
     + all.length + ' reads)');
  const tables = [...new Set(all.map(s => (s.match(/^GET \/([a-z_]+)/) || [])[1]))].sort();
  eq(tables, ['properties', 'tenant_field_evidence'], 'D2 and touched only two tables');

  let refused = false;
  try { await HYD._readOnly(async () => ({}))('/properties', { method: 'POST' }); }
  catch (e) { refused = /read-only/i.test(e.message); }
  is(refused, 'D3 the underlying guard still refuses a write rather than omitting one');
  is(!/method\s*:\s*['"](POST|PATCH|PUT|DELETE)/.test(
       fs.readFileSync('./api/_mcp-transport.js', 'utf8')),
     'D4 the transport itself contains no write verb');
}

// ═══════════════════════════════════════════════════════════════════════════
sec('E. Rate limiting is active, and is the existing limiter');
// ═══════════════════════════════════════════════════════════════════════════
{
  is(/require\('\.\/_rate-limit'\)/.test(fs.readFileSync('./api/_mcp-transport.js', 'utf8')),
     'E1 the transport reuses api/_rate-limit.js rather than inventing one');

  RL._resetForTests();
  const real = { authFetch: auth, sbFetch: db() };   // no checkRate seam → the real one
  let lastOk = 0, limited = null;
  for (let i = 0; i < T.LIMITS.RATE_MAX + 2; i++) {
    const r = await T.serve({ httpMethod: 'POST',
      headers: { authorization: 'Bearer owner', 'x-forwarded-for': '203.0.113.9' },
      body: { jsonrpc: '2.0', id: i, method: 'tools/list' } }, real);
    if (r.status === 200) lastOk++;
    else if (r.status === 429 && !limited) limited = r;
  }
  eq(lastOk, T.LIMITS.RATE_MAX, 'E2 exactly RATE_MAX requests are served in the window');
  is(!!limited, 'E3 and the next one is refused');
  eq(limited.status, 429, 'E4 with 429');
  is(Number(limited.headers['Retry-After']) >= 1,
     'E5 and a Retry-After a client can back off against',
     limited.headers['Retry-After']);
  eq(limited.body.error.code, T.RPC.RATE_LIMITED, 'E6 and a rate-limited error code');

  // The limit is keyed on the SERVER-RESOLVED identity, not on anything sent.
  RL._resetForTests();
  for (let i = 0; i < T.LIMITS.RATE_MAX; i++) {
    await T.serve({ httpMethod: 'POST', headers: { authorization: 'Bearer owner' },
      body: { jsonrpc: '2.0', id: i, method: 'tools/list' } }, real);
  }
  const spoofed = await T.serve({ httpMethod: 'POST',
    headers: { authorization: 'Bearer owner', 'x-forwarded-for': '198.51.100.1' },
    body: { jsonrpc: '2.0', id: 99, method: 'tools/list',
            params: { userId: 'someone-else' } } }, real);
  eq(spoofed.status, 429, 'E7 changing the client hint does not reset the user budget');

  // A pre-auth brake exists, so a garbage-token flood is bounded too.
  RL._resetForTests();
  let preLimited = false;
  for (let i = 0; i < T.LIMITS.RATE_PREAUTH_MAX + 2; i++) {
    const r = await T.serve({ httpMethod: 'POST',
      headers: { authorization: 'Bearer forged', 'x-forwarded-for': '198.51.100.7' },
      body: { jsonrpc: '2.0', id: i, method: 'tools/list' } }, real);
    if (r.status === 429) preLimited = true;
  }
  is(preLimited, 'E8 unauthenticated floods are braked before the auth round-trip');
  RL._resetForTests();
}

// ═══════════════════════════════════════════════════════════════════════════
sec('F. Database reads are time-bounded');
// ═══════════════════════════════════════════════════════════════════════════
{
  eq(CAP.READ_TIMEOUT_MS, 8000, 'F1 the capability transport declares a bound');
  eq(HYD.READ_TIMEOUT_MS, 8000, 'F2 the hydrator transport declares the same bound');
  for (const [label, file] of [['capabilities', './api/_mcp-capabilities.js'],
                               ['hydrator', './api/_property-record-hydrator.js']]) {
    is(/AbortSignal\.timeout\(READ_TIMEOUT_MS\)/.test(fs.readFileSync(file, 'utf8')),
       'F3 ' + label + ': the bound is applied to the read');
  }

  // A timeout must become an ANSWER, not an exception. Driven against the real
  // _defaultFetch with global.fetch stubbed to abort.
  const realFetch = global.fetch;
  try {
    global.fetch = async () => { const e = new Error('timed out'); e.name = 'TimeoutError'; throw e; };
    const a = await CAP._defaultFetch('/properties?select=id');
    eq(a.status, 504, 'F4 a timed-out capability read returns 504, not a throw');
    eq(a.json.error, 'read_timeout', 'F5 and names the reason');
    eq(a.json.timeoutMs, 8000, 'F6 and the bound that was exceeded');
    const b = await HYD._defaultFetch('/properties?select=id');
    eq(b.status, 504, 'F7 the hydrator read does the same');

    global.fetch = async () => { throw new Error('ECONNREFUSED'); };
    const c = await HYD._defaultFetch('/properties?select=id');
    eq(c.status, 502, 'F8 an unreachable upstream is distinguished from a timeout');
    eq(c.json.error, 'read_unreachable', 'F9 and named separately');
  } finally { global.fetch = realFetch; }

  // And a failed read still produces a truthful envelope through the transport.
  const failing = async (p) => {
    if (/^\/properties\?id=eq\.[^&]+&user_id=eq\.[^&]+&select=id$/.test(p))
      return { status: 200, json: [{ id: PROP }] };
    return { status: 504, json: { error: 'read_timeout' } };
  };
  const r = await call('get_property', { propertyId: PROP }, { seam: { sbFetch: failing } });
  eq(env(r).data, null, 'F10 a timed-out property read refuses rather than inventing a record');
  is(env(r).caveats.some(c => c.severity === 'refusal'), 'F11 as a stated refusal');
}

// ═══════════════════════════════════════════════════════════════════════════
sec('G. Payloads are bounded, and every bound is disclosed');
// ═══════════════════════════════════════════════════════════════════════════
{
  // A property far past every cap: 300 tenants, 5000 events, 400 disputes.
  const tenants = [], results = [], timeline = [], disputes = [], evidence = [];
  for (let i = 0; i < 300; i++) {
    const id = 't-' + i;
    tenants.push({ id, tenant_name: 'Tenant ' + i, leased_sqft: 100, cap: 5, lease_type: 'NNN' });
    results.push({ tenantId: id, tenantName: 'Tenant ' + i, allocatedAmount: 10,
                   actualCam: 10, expectedCam: 9, variance: 1,
                   expectedCamBasis: 'cap_ceiling', capApplied: true });
    evidence.push({ tenant_id: id, field_key: 'cap', value: '5',
      confidence_status: 'estimated', confidence_note: null, source_file: 'l.pdf',
      source_page: 1, quote: 'five percent', extraction_id: 'e', extraction_version: 1,
      reviewer_uid: null, reviewer_email: null, reviewed_at: null, approved: null,
      manually_edited: false, original_extracted_value: null,
      created_at: '2026-01-01T00:00:00Z' });
  }
  // Half the events carry a tenant subject and half do not, so BOTH axes are
  // exercised: timeline.property (the ones no space claimed) and
  // timeline.byTenant (the ones a space did). An all-subject fixture leaves
  // timeline.property empty and silently tests nothing.
  for (let i = 0; i < 5000; i++) {
    const ev = { id: 'e-' + i, timestamp: '2026-05-01T00:00:00Z',
                 type: 'note', title: 'Event ' + i };
    if (i % 2 === 0) ev.subject = { id: 't-' + (i % 300), type: 'suite' };
    timeline.push(ev);
  }
  for (let i = 0; i < 400; i++) disputes.push({ id: 'd-' + i, status: 'open',
    tenantId: 't-' + (i % 300), amount: 5 });
  const bigDb = { blob: { tenants, invoices: [], disputes, timeline,
                          camReconciliation: { camYear: 2025, total: 1e6, results } },
                  evidence };

  const big = await call('get_property', { propertyId: PROP }, { db: bigDb });
  const e = env(big);
  const b = e.provenance.bounded;
  is(Array.isArray(b) && b.length > 0, 'G1 get_property discloses that it was bounded',
     String(b && b.length) + ' sections');
  const byPath = {}; for (const x of b) byPath[x.path] = x;

  eq(e.data.spaces.length, T.LIMITS.SPACES, 'G2 spaces are capped');
  eq(byPath['data.spaces'].total, 300, 'G3 and the TRUE total is still reported');
  eq(Object.keys(e.data.fields).length, T.LIMITS.FIELD_TENANTS, 'G4 fields are capped by tenant');
  eq(byPath['data.fields'].total, 300, 'G5 with the true tenant count disclosed');
  eq(e.data.timeline.property.length <= T.LIMITS.TIMELINE_IN_PROPERTY, true,
     'G6 the property timeline is capped');
  eq(e.data.disputes.length, T.LIMITS.DISPUTES, 'G7 disputes are capped');
  eq(byPath['data.disputes'].total, 400, 'G8 with the true count disclosed');
  eq(e.data.cam.results.length, T.LIMITS.CAM_ROWS, 'G9 CAM rows are capped');
  is(b.every(x => x.more === true && x.returned < x.total),
     'G10 every disclosure says more remains');

  const cav = e.caveats.find(c => c.code === T.BOUNDED_CAVEAT);
  is(!!cav, 'G11 a caveat names the bounding');
  eq(cav.severity, 'degraded', 'G12 at degraded severity — thinner, not unknown');
  is(/NOT empty/.test(cav.message), 'G13 and says a bounded section is not an empty one');
  is(/get_timeline|get_lease_evidence/.test(cav.message),
     'G14 and points at the capability that returns the rest');

  // Bounding must not disturb the status trichotomy.
  eq(e.provenance.sectionStatus.spaces, 'ok', 'G15 a bounded section keeps its status');
  eq(e.provenance.sectionStatus.disputes, 'ok', 'G16 likewise disputes');

  // get_timeline pages rather than caps.
  const p1 = await call('get_timeline', { propertyId: PROP }, { db: bigDb });
  const d1 = env(p1).data;
  eq(d1.events.length, T.LIMITS.PAGE_DEFAULT, 'G17 get_timeline returns one default page');
  eq(d1.page.total, d1.eventCount, 'G18 page.total agrees with the capability\'s own count');
  is(d1.eventCount > d1.events.length, 'G19 eventCount stays the TRUE total, not the page size');
  eq(d1.page.offset, 0, 'G20 the first page starts at 0');
  eq(d1.page.more, true, 'G21 and says more remains');
  eq(d1.page.nextOffset, T.LIMITS.PAGE_DEFAULT, 'G22 with the offset to continue from');

  const p2 = await call('get_timeline', { propertyId: PROP, limit: 10, offset: d1.page.nextOffset },
                        { db: bigDb });
  const d2 = env(p2).data;
  eq(d2.events.length, 10, 'G23 a caller-chosen limit is honoured');
  eq(d2.page.offset, T.LIMITS.PAGE_DEFAULT, 'G24 and the offset');
  is(d2.events[0].id !== d1.events[0].id, 'G25 the second page is different events');

  const over = await call('get_timeline', { propertyId: PROP, limit: 99999 }, { db: bigDb });
  eq(env(over).data.page.limit, T.LIMITS.PAGE_MAX, 'G26 an oversized limit is clamped, not honoured');
  for (const badPage of [{ limit: 0 }, { limit: -1 }, { limit: 1.5 }, { offset: -1 }]) {
    const r = await call('get_timeline', Object.assign({ propertyId: PROP }, badPage), { db: bigDb });
    eq(r.status, 400, 'G27 an invalid page argument is refused: ' + JSON.stringify(badPage));
  }

  // A small property carries no bounding metadata at all.
  const small = await call('get_property', { propertyId: PROP });
  is(!env(small).provenance.bounded, 'G28 an unbounded response carries no bounding block');
  is(!env(small).caveats.some(c => c.code === T.BOUNDED_CAVEAT),
     'G29 and no bounding caveat');

  // The size backstop is real, and it FIRES.
  is(T.LIMITS.MAX_RESPONSE_BYTES > 0, 'G30 a hard response ceiling exists');
  const bytes = Buffer.byteLength(JSON.stringify(big.body), 'utf8');
  is(bytes < T.LIMITS.MAX_RESPONSE_BYTES,
     'G31 the bounded 300-tenant response fits inside it', (bytes / 1024).toFixed(0) + ' KB');

  /**
   * The caps count ITEMS, so a small number of enormous items slips past every
   * one of them — a handful of leases whose extracted renewal-options prose runs
   * to hundreds of kilobytes. That is the case the byte ceiling exists for, and
   * until this fixture existed nothing exercised it: removing the guard entirely
   * changed no assertion.
   */
  const fat = 'x'.repeat(120000);
  const fatTenants = [];
  for (let i = 0; i < 20; i++) fatTenants.push({ id: 'f-' + i, tenant_name: 'Fat ' + i,
    leased_sqft: 100, cap: 5, lease_type: 'NNN', renewal_options: fat });
  const huge = await call('get_property', { propertyId: PROP },
    { db: { blob: { tenants: fatTenants, invoices: [], disputes: [], timeline: [] } } });
  eq(huge.status, 413, 'G32 a response too large to send is refused, not truncated silently');
  eq(huge.body.error.code, T.RPC.RESPONSE_TOO_LARGE, 'G33 with a stated code');
  is(huge.body.error.data.bytes > T.LIMITS.MAX_RESPONSE_BYTES,
     'G34 and the measured size that exceeded the ceiling',
     (huge.body.error.data.bytes / 1024).toFixed(0) + ' KB');
  is(/narrower scope/.test(huge.body.error.message),
     'G35 and tells the caller how to ask for less');
  is(!huge.body.result, 'G36 no partial payload is emitted alongside the refusal');
}

// ═══════════════════════════════════════════════════════════════════════════
sec('H. Unavailable and empty stay distinct across the boundary');
// ═══════════════════════════════════════════════════════════════════════════
{
  const unknown = await call('get_property', { propertyId: PROP }, { db: { blob: null } });
  const u = env(unknown).data;
  eq(u.disputes, null, 'H1 a property with no stored record: disputes are null');
  eq(u.spaces, null,   'H2 spaces are null');
  eq(u.timeline, null, 'H3 timeline is null');
  eq(env(unknown).provenance.sectionStatus.disputes, 'unavailable', 'H4 and named unavailable');
  is(env(unknown).caveats.some(c => c.code === 'property.no_stored_record'),
     'H5 with the reason stated');

  const empty = await call('get_property', { propertyId: PROP },
    { db: { blob: { tenants: [], invoices: [], disputes: [], timeline: [] } } });
  const em = env(empty).data;
  is(Array.isArray(em.disputes) && em.disputes.length === 0,
     'H6 a genuinely empty list is [], not null');
  eq(env(empty).provenance.sectionStatus.disputes, 'empty', 'H7 and named empty');
  is(em.disputes !== null, 'H8 the two answers remain different objects');

  // Bounding must never manufacture a value for an unknown section.
  const bounded = [];
  eq(T._boundData('get_property', { spaces: null, fields: null, disputes: null,
                                    documents: null, attention: null, cam: null,
                                    timeline: null }, bounded),
     { spaces: null, fields: null, disputes: null, documents: null,
       attention: null, cam: null, timeline: null },
     'H9 bounding a null section leaves it null');
  eq(bounded, [], 'H10 and reports no bound, because nothing was truncated');
  eq(T._pageTimeline({ events: null }, { limit: 10, offset: 0 }), { events: null },
     'H11 paging an unknown timeline leaves it unknown, with no page block');
}

// ═══════════════════════════════════════════════════════════════════════════
sec('I. The CAM trust gate survives the boundary');
// ═══════════════════════════════════════════════════════════════════════════
{
  const envs = {};
  for (const name of ALL) envs[name] = env(await call(name, argsOf(name)));

  const found = [];
  const walk = (node, path, cap) => {
    if (node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach((v, i) => walk(v, path + '[' + i + ']', cap));
    const k = Object.keys(node);
    if (k.includes('expectedCam') || k.includes('expectedCamBasis')) found.push({ cap, path, node });
    for (const key of k) walk(node[key], path + '.' + key, cap);
  };
  for (const n of ALL) walk(envs[n], n, n);

  is(found.length >= 6, 'I1 every CAM row shape is found across the nine responses',
     String(found.length));
  for (const f of found) {
    is(f.node.expectedCam === null && f.node.variance === null &&
       f.node.expectedCamTrust === 'legacy_unverified_not_money',
       'I2 ' + f.cap + ' → ' + f.path + ' is still gated');
    is(!('internalScratch' in f.node),
       'I3 ' + f.cap + ' → ' + f.path + ' is still whitelisted');
  }
  const raw = ALL.filter(n => JSON.stringify(envs[n]).includes('must never travel'));
  eq(raw, [], 'I4 the unnamed stored key reaches no response through the transport');
  const five = ALL.filter(n => /"expectedCam":5\b/.test(JSON.stringify(envs[n])));
  eq(five, [], 'I5 and the cap percentage is never presented as an expected amount');

  // Bounding must not be able to strip the gate by rebuilding an object.
  const bounded = [];
  const out = T._boundData('get_property', { cam: { results: [LEGACY_ROW], capped: [] } }, bounded);
  is(out.cam.results[0] === LEGACY_ROW,
     'I6 bounding forwards gated rows unchanged rather than reconstructing them');
}

// ═══════════════════════════════════════════════════════════════════════════
sec('J. Evidence honesty, and the two narrowing decisions');
// ═══════════════════════════════════════════════════════════════════════════
{
  // Stale evidence still cannot certify a changed value, through the transport.
  const staleDb = { blob: blob({ tenants: [{ id: T1, tenant_name: 'Acme', cap: 6 }] }) };
  const st = env(await call('get_lease_evidence', { propertyId: PROP, tenantId: T1 },
                            { db: staleDb })).data.evidence.cap;
  eq(st.state, 'ai_extracted', 'J1 a value edited away from its clause is not lease_confirmed');
  eq(st.quote, null, 'J2 and the mismatched clause does not travel');
  eq(st.evidenceStale, true, 'J3 with the reason reported');

  // A matching citation still certifies.
  const okEv = env(await call('get_lease_evidence', { propertyId: PROP, tenantId: T1 }))
                 .data.evidence.cap;
  eq(okEv.state, 'manually_confirmed', 'J4 an approved, matching field still certifies');
  is(typeof okEv.quote === 'string', 'J5 keeping the clause that supports it');

  // REVIEWER POLICY — the claim survives, the address does not.
  eq(okEv.by, null, 'J6 reviewer identity is withheld at the boundary');
  eq(okEv.byPresent, true, 'J7 and byPresent says an identity is on file');
  is(!JSON.stringify(env(await call('get_lease_evidence', { propertyId: PROP, tenantId: T1 })))
       .includes('jane.doe@landlordco.com'),
     'J8 no reviewer email appears anywhere in the response');
  for (const tool of ['get_property', 'get_tenant']) {
    const s = JSON.stringify(env(await call(tool, argsOf(tool))));
    is(!s.includes('jane.doe@landlordco.com'), 'J9 nor through ' + tool);
  }
  // Internal semantics are untouched — the redaction is transport-only.
  const FP = require('./field-provenance.js');
  const inApp = FP.fieldProvenance('cap', { id: T1, cap: 5, fieldEvidence: { cap: { snapshots: [{
    value: '5', quote: 'q', page: 1, reviewerEmail: 'jane.doe@landlordco.com',
    reviewedAt: '2026-02-02T00:00:00Z', approved: true, manuallyEdited: false }] } } });
  eq(inApp.by, 'jane.doe@landlordco.com',
     'J10 in-app provenance still names the reviewer — nothing internal changed');
  // Compared field by field: _redactField preserves the resolver's own key
  // order and appends byPresent, and eq() is order-sensitive.
  const noId = T._redactField({ by: null, state: 'manually_entered' });
  eq([noId.by, noId.byPresent, noId.state], [null, false, 'manually_entered'],
     'J11 a field with no identity on file reports byPresent false');
  eq(Object.keys(noId).sort(), ['by', 'byPresent', 'state'],
     'J11b and adds exactly one key');
  eq(T._redactField({ state: 'unknown' }), { state: 'unknown' },
     'J12 a field that never had a `by` is left exactly as it was');

  // PROVENANCE POLICY — reads are summarised, not deleted and not raw.
  const pr = env(await call('get_property', { propertyId: PROP })).provenance;
  is(!Array.isArray(pr.reads), 'J13 raw query strings do not travel');
  eq(pr.reads.tables, ['properties', 'tenant_field_evidence'],
     'J14 the tables consulted are still reported');
  is(typeof pr.reads.readCount === 'number', 'J15 with how many reads were made',
     String(pr.reads.readCount));
  const s = JSON.stringify(pr.reads);
  is(!s.includes('select=') && !s.includes('user_id=eq') && !s.includes(OWNER),
     'J16 and no column list, filter or user identifier survives');
  eq(T._summariseReads(['/properties?id=eq.x&select=a,b', '/tenants?x', '/properties?y']),
     { tables: ['properties', 'tenants'], readCount: 3,
       byTable: { properties: 2, tenants: 1 } },
     'J17 the summary counts reads per table');

  // The narrowing is disclosed, not silent.
  const cav = env(await call('get_property', { propertyId: PROP })).caveats
    .find(c => c.code === T.REDACTED_CAVEAT);
  is(!!cav, 'J18 a caveat states both narrowings');
  is(/manually_confirmed still means a named reviewer/.test(cav.message),
     'J19 and preserves the claim the address used to carry');
  is(!!pr.transport && pr.transport.contextOwnedBy === 'server',
     'J20 provenance states that the server owned the context');
  is(pr.transport.limits.dbTimeoutMs === 8000 && pr.transport.limits.rateMaxPerMinute === 60,
     'J21 and publishes the limits it enforced');
}

// ═══════════════════════════════════════════════════════════════════════════
sec('K. The envelope contract holds through the transport');
// ═══════════════════════════════════════════════════════════════════════════
{
  for (const name of ALL) {
    const e = env(await call(name, argsOf(name)));
    eq(Object.keys(e).sort().join(','), 'asOf,caveats,data,provenance',
       'K1 ' + name + ': still {data, provenance, caveats, asOf}');
    is(Array.isArray(e.caveats), 'K2 ' + name + ': caveats is an array');
    is(typeof e.asOf === 'string' && !Number.isNaN(Date.parse(e.asOf)),
       'K3 ' + name + ': asOf is a real timestamp');
  }
  const r = await call('get_property', { propertyId: PROP });
  is(!!r.body.result.structuredContent, 'K4 the envelope is carried as structured content');
  is(Array.isArray(r.body.result.content) && r.body.result.content[0].type === 'text',
     'K5 and as text, for an agent that reads only content');
  eq(JSON.parse(r.body.result.content[0].text), env(r),
     'K6 the two representations are the same envelope');
  eq(r.body.jsonrpc, '2.0', 'K7 responses are JSON-RPC 2.0');
  eq(r.body.id, 1, 'K8 and echo the request id');
}

console.log('\n' + (fail === 0 ? '\x1b[32m' : '\x1b[31m') +
            `RESULT: ${pass} passed, ${fail} failed\x1b[0m`);
process.exit(fail === 0 ? 0 : 1);

})().catch(e => { console.error(e); process.exit(1); });
