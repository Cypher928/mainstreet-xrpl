'use strict';
/**
 * test-m6-cam-attention.js — get_cam_status and get_attention.
 *
 *   node test-m6-cam-attention.js
 *
 * OFFLINE. Every transport and every auth call is a function defined in this
 * file. Nothing here opens a socket or can reach Pilot or Production.
 *
 * THE TWO THINGS M6 HAS TO GET RIGHT
 * ----------------------------------
 * 1. AN EXPECTED CAM FIGURE IS ONLY MONEY IF THE ROW SAYS SO.
 *    `expectedCamBasis` is stamped by the producer, never sniffed, because
 *    nothing can tell 5 (a cap percentage) from 5.00 (a small dollar ceiling) by
 *    looking at it. Section C walks all five states a stored row can be in and
 *    asserts that only `cap_ceiling` + a finite number is presented, that the
 *    variance always travels with the expectation, and that the withheld rows
 *    are reported as withheld rather than quietly dropped.
 *
 *    And the axis distinction: `cap_ceiling` describes ARITHMETIC. It is not a
 *    claim that a human ever read the cap base off a lease. Section D asserts
 *    this module never says otherwise, in any field or any caveat.
 *
 * 2. AN EMPTY ATTENTION LIST IS NOT "ALL CAUGHT UP".
 *    collectAttention reads window.Selectors for readiness signals, and the
 *    server graph deliberately excludes Selectors — so the server's list is
 *    systematically shorter than the application's. Section F asserts that
 *    `allClear` is null rather than true, on a property with genuinely nothing
 *    in the list. That is the same argument as `disputes: null`: a caller
 *    computing `items.length === 0` must not be able to reach a conclusion the
 *    server cannot support.
 *
 * Section G asserts the projection strips the browser: no icon, no nav, no
 * anchors, no button labels anywhere in the response.
 */

const fs   = require('fs');
const MCP  = require('./api/_mcp-capabilities.js');
const DEPS = require('./api/_server-deps.js');

const INV   = require('./tools/global-dependency-inventory.js');
const SRC   = fs.readFileSync(require.resolve('./api/_mcp-capabilities.js'), 'utf8');
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
const T1     = 'aaaaaaaa-0000-4000-8000-000000000001';   // cap_ceiling, finite
const T2     = 'aaaaaaaa-0000-4000-8000-000000000002';   // no basis, no value
const T3     = 'aaaaaaaa-0000-4000-8000-000000000003';   // legacy_unverified
const T4     = 'aaaaaaaa-0000-4000-8000-000000000004';   // no basis, value present
const T5     = 'aaaaaaaa-0000-4000-8000-000000000005';   // cap_ceiling, no value
const NOW    = '2026-09-06T12:00:00.000Z';

/**
 * Five reconciliation rows, one per state a stored row can actually be in.
 *
 * T3 is the shape that put 19 bad rows in Pilot: `expectedCam: 5` is a cap
 * PERCENTAGE sitting in a dollar field, and the `variance: 2395` beside it is
 * dollars minus a percentage — a number with no unit. Both must be withheld.
 * T4 is the pre-stamp shape: the value might be a legitimate $92 ceiling or
 * might be another stray percent, and nothing here can tell.
 */
const CAM_RESULTS = [
  { tenantId: T1, tenantName: 'Acme Coffee LLC',    totalAllocated: 6000, actualCam: 6000,
    allocatedAmount: 6000, proRataPercent: 50, capApplied: true,
    expectedCam: 5500, variance: 500, expectedCamBasis: 'cap_ceiling' },
  { tenantId: T2, tenantName: 'Northside Hardware', totalAllocated: 3600, actualCam: 3600,
    allocatedAmount: 3600, proRataPercent: 30, capApplied: false,
    expectedCam: null, variance: null, expectedCamBasis: null },
  { tenantId: T3, tenantName: 'Legacy Diner',       totalAllocated: 2400, actualCam: 2400,
    allocatedAmount: 2400, proRataPercent: 20, capApplied: false,
    expectedCam: 5, variance: 2395, expectedCamBasis: 'legacy_unverified' },
  { tenantId: T4, tenantName: 'Unstamped Bakery',   totalAllocated: 900, actualCam: 900,
    allocatedAmount: 900, proRataPercent: 8, capApplied: false,
    expectedCam: 92, variance: 808, expectedCamBasis: null },
  { tenantId: T5, tenantName: 'Stamped But Empty',  totalAllocated: 100, actualCam: 100,
    allocatedAmount: 100, proRataPercent: 1, capApplied: false,
    expectedCam: null, variance: null, expectedCamBasis: 'cap_ceiling' },
];

const TENANTS = [
  { id: T1, tenant_name: 'Acme Coffee LLC',    leased_sqft: 500, cap: 0.05,
    start_date: '2020-01-01', end_date: '2030-01-01', lease_type: 'NNN' },
  { id: T2, tenant_name: 'Northside Hardware', leased_sqft: 300, cap: null,
    start_date: '2021-06-01', end_date: '2026-06-01', lease_type: 'NNN' },
];

/** A property with a saved reconciliation, an open dispute and maintenance. */
const FULL_BLOB = {
  tenants:  TENANTS,
  invoices: [{ id: 'i1', amount: 12000, category: 'Landscaping', camEligible: true }],
  disputes: [{ id: 'd1', tenantId: T1, tenantName: 'Acme Coffee LLC', status: 'open',
               amount: 1200, timestamp: '2025-03-01T00:00:00Z' }],
  timeline: [{ id: 'm1', category: 'maintenance', responsibility: 'landlord',
               title: 'Roof patch after storm', when: '2025-05-01T00:00:00Z' }],
  camReconciliation: {
    propId: PROP, camYear: 2025, savedAt: '2025-01-15T00:00:00Z',
    schemaVersion: 2, total: 12000, results: CAM_RESULTS,
  },
};

/**
 * The SAME property with nothing that raises an attention item on the server.
 * No disputes, no maintenance, no reference record — and, because Selectors is
 * not in the server graph, no readiness signals either. The list is genuinely
 * empty, which is exactly the case in which "all caught up" must NOT be said.
 */
const QUIET_BLOB = {
  tenants: TENANTS, invoices: [], disputes: [], timeline: [],
};

/** A reconciliation whose rows are all clean. */
const CLEAN_BLOB = Object.assign({}, QUIET_BLOB, {
  camReconciliation: { propId: PROP, camYear: 2025, total: 12000,
                       results: [CAM_RESULTS[0]] },
});

/** A saved property with no reconciliation on it at all. */
const NO_CAM_BLOB = QUIET_BLOB;

function auth(opts) {
  const o = opts || {};
  const calls = [];
  const fn = async (tok) => {
    calls.push(tok);
    if (o.throws) { const e = new Error('boom'); e.name = o.throws; throw e; }
    if (o.status) return { status: o.status, json: o.json || {} };
    if (tok === 'owner') return { status: 200, json: {
      id: OWNER, role: 'authenticated',
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
  const o = Object.assign({ blob: FULL_BLOB, evidence: [], ownedBy: OWNER,
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
const rowFor = (env, id) => env.data.results.find(r => r.tenantId === id);
/** One caveat, or a stand-in — so a MISSING caveat fails an assertion rather
 *  than throwing and taking the rest of the section down with it. */
const cav = (env, code) => env.caveats.find(c => c.code === code) ||
                           { code: null, severity: null, scope: null, message: '' };

/** The two capabilities M6 adds. Both take a propertyId and nothing else. */
const M6 = [
  ['get_cam_status', { propertyId: PROP }],
  ['get_attention',  { propertyId: PROP }],
];

/** The real dependency set with one module removed — the deployment-shaped way
 *  a module goes missing, rather than a hand-built stub set. */
function without(name) {
  const d = Object.assign({}, DEPS.load());
  delete d[name];
  return d;
}

(async function main() {

// ── A. Registration ────────────────────────────────────────────────────────
sec('A. Two capabilities, added to the existing set rather than beside it');
{
  const names = MCP.TOOLS.map(t => t.name);
  eq(names, ['list_properties', 'get_property', 'get_tenant',
             'get_lease_evidence', 'get_space', 'get_timeline', 'get_disputes',
             'get_cam_status', 'get_attention'],
     'A1 nine tools — M4\'s three, M5\'s four, then M6\'s two, in order');
  is(new Set(names).size === names.length, 'A1a and no name is registered twice');
  for (const [name] of M6) {
    const t = MCP.TOOLS.find(x => x.name === name);
    is(!!t, 'A2.' + name + ' is registered');
    is(typeof t.description === 'string' && t.description.length > 60,
       'A3.' + name + ' has a description worth reading');
    is(t.inputSchema && t.inputSchema.additionalProperties === false,
       'A4.' + name + ' refuses unknown arguments');
    is(typeof t.handler === 'function', 'A5.' + name + ' has a handler');
    eq(t.inputSchema.required, ['propertyId'], 'A6.' + name + ' requires only a propertyId');
  }
  const cs = MCP.TOOLS.find(t => t.name === 'get_cam_status');
  is(/NOT a claim/.test(cs.description) && /lease-supported or verified/.test(cs.description),
     'A7 get_cam_status\'s own description separates arithmetic from verification');
  const at = MCP.TOOLS.find(t => t.name === 'get_attention');
  is(/does NOT mean the property is all caught up/.test(at.description),
     'A8 and get_attention warns against reading its silence as all-clear');
}

// ── B. Security, re-tested per capability ──────────────────────────────────
sec('B. The boundary holds for each new capability, not by inheritance');
{
  for (const [name, args] of M6) {
    const okr = await MCP.call(name, args, ctx());
    is(okr.data !== null, 'B1.' + name + ' the owner gets an answer');

    const noTok = await MCP.call(name, args, ctx({ token: '' }));
    eq(codes(noTok), ['authentication_required'], 'B2.' + name + ' a missing token is refused');

    const badTok = await MCP.call(name, args, ctx({ token: 'nonsense' }));
    eq(codes(badTok), ['invalid_or_expired_token'], 'B3.' + name + ' a bad token is refused');

    const down = await MCP.call(name, args, ctx({ authFetch: auth({ throws: 'TimeoutError' }) }));
    eq(codes(down), ['auth_service_unavailable'],
       'B4.' + name + ' an auth timeout fails closed, and is distinguished');

    const noid = await MCP.call(name, args, ctx({ token: 'noid' }));
    eq(codes(noid), ['user_identity_missing'], 'B5.' + name + ' an id-less auth payload is refused');

    // A tenant-portal user holds a VALID session for a property they do not own.
    const ten = await MCP.call(name, args, ctx({ token: 'tenant' }));
    eq(codes(ten), ['not_authorized'],
       'B6.' + name + ' a tenant identity is not a landlord');
    eq(ten.data, null, 'B7.' + name + ' and gets no data at all');

    // Someone else's property. The ownership probe is a single predicate —
    // owned, or not — so a property that belongs to another user and one that
    // does not exist are the same refusal. That is deliberate: distinguishing
    // them would let a caller enumerate which property ids are real.
    const foreign = await MCP.call(name, { propertyId: OTHER }, ctx());
    eq(codes(foreign), ['not_authorized'],
       'B8.' + name + ' a property the caller does not own does not resolve');
    eq(foreign.data, null, 'B8a.' + name + ' and yields nothing');

    // A caller cannot name itself.
    const spoof = await MCP.call(name, Object.assign({ userId: OWNER }, args),
                                 ctx({ token: 'tenant' }));
    eq(codes(spoof), ['not_authorized'],
       'B9.' + name + ' a caller-supplied userId does not authorise anything');

    // Arguments are validated.
    const noProp = await MCP.call(name, {}, ctx());
    eq(codes(noProp), ['invalid_arguments'], 'B10.' + name + ' rejects a missing propertyId');
    const objProp = await MCP.call(name, { propertyId: { evil: 1 } }, ctx());
    eq(codes(objProp), ['invalid_arguments'], 'B11.' + name + ' rejects a non-string propertyId');
  }
}

// ── C. The expected-CAM gate, state by state ───────────────────────────────
sec('C. Only a stamped dollar ceiling is presented as money');
{
  const r = await MCP.call('get_cam_status', { propertyId: PROP }, ctx());
  eq(r.data.resultCount, 5, 'C0 all five stored rows are reported — none is dropped');

  // cap_ceiling + a finite number: the only case that passes.
  const t1 = rowFor(r, T1);
  eq(t1.expectedCam, 5500, 'C1 a stamped cap_ceiling row presents its expected amount');
  eq(t1.variance, 500,     'C2 and its variance travels with it');
  eq(t1.expectedCamTrust, 'cap_ceiling_arithmetic', 'C3 labelled as arithmetic, not verification');
  eq(t1.expectedCamBasis, 'cap_ceiling', 'C4 with the stored basis passed through unchanged');

  // legacy_unverified: the value is a PERCENTAGE in a dollar field.
  const t3 = rowFor(r, T3);
  eq(t3.expectedCam, null, 'C5 a legacy_unverified row withholds its expected amount');
  eq(t3.variance, null,    'C6 and its dollars-minus-percent variance with it');
  eq(t3.expectedCamTrust, 'legacy_unverified_not_money', 'C7 named for what is wrong with it');
  eq(t3.expectedCamBasis, 'legacy_unverified',
     'C8 the stored basis is still reported — the row is described, not rewritten');
  is(JSON.stringify(r.data).indexOf('2395') === -1,
     'C9 and the bad variance figure appears nowhere in the response');

  // No stamp, but a value: might be $92, might be another stray 92%.
  const t4 = rowFor(r, T4);
  eq(t4.expectedCam, null, 'C10 an unstamped value is withheld — nothing can tell a ceiling from a percent');
  eq(t4.variance, null,    'C11 and so is the variance derived from it');
  eq(t4.expectedCamTrust, 'unstamped_value_withheld', 'C12 with the reason stated');

  // No stamp and no value: nothing was ever computed.
  const t2 = rowFor(r, T2);
  eq(t2.expectedCam, null, 'C13 a row with no expectation reports none');
  eq(t2.expectedCamTrust, 'no_expectation_established',
     'C14 distinguished from a value that was withheld');

  // Stamped, but the value is not a usable number.
  const t5 = rowFor(r, T5);
  eq(t5.expectedCam, null, 'C15 a stamp without a finite value presents nothing');
  eq(t5.expectedCamTrust, 'stamped_without_usable_value', 'C16 and says so');

  // The tally.
  eq(r.data.expectation, { established: 1, withheld: 3, none: 1 },
     'C17 the tally counts established, withheld and none separately');
  eq(r.data.expectationByTrust.cap_ceiling_arithmetic, 1, 'C18 and breaks down by trust label');
  is(codes(r).indexOf('cam.expectation_withheld') !== -1,
     'C19 a caveat says how many rows had their expectation withheld');

  // The gate is the persister's gate.
  const gate = MCP._classifyExpectation;
  eq(gate({ expectedCamBasis: 'cap_ceiling', expectedCam: 0 }).expectedCam, 0,
     'C20 a legitimate zero ceiling is presented — the gate tests finiteness, not truthiness');
  eq(gate({ expectedCamBasis: 'cap_ceiling', expectedCam: NaN }).trust,
     'stamped_without_usable_value', 'C21 NaN is not a finite number');
  eq(gate({ expectedCamBasis: 'cap_ceiling', expectedCam: Infinity }).trust,
     'stamped_without_usable_value', 'C22 nor is Infinity');
  eq(gate({ expectedCamBasis: 'cap_ceiling', expectedCam: '5500' }).trust,
     'stamped_without_usable_value', 'C23 nor is a numeric string — it is not coerced');
  eq(gate({ expectedCamBasis: 'future_vocabulary', expectedCam: 5500 }).trust,
     'unrecognised_basis', 'C24 a basis this build has never heard of is refused, not trusted');
  eq(gate({ expectedCamBasis: 'future_vocabulary', expectedCam: 5500 }).expectedCam, null,
     'C25 and its value is withheld');
  eq(gate({}).trust, 'no_expectation_established', 'C26 an absent basis is handled like a null one');
  eq(gate(null).trust, 'no_expectation_established', 'C27 and so is a missing row');

  // capApplied agrees with cappedCount, or the response contradicts itself.
  //
  // PropertyRecord._cam counts a capped row with `r.capApplied === true`,
  // strictly. If this projection used `!!row.capApplied` instead, a row stored
  // with a truthy non-boolean — 'yes', 1, a leftover string from an older
  // writer — would report `capApplied: true` beside a cappedCount that does not
  // include it. Two numbers in one response disagreeing about the same row is
  // the kind of thing a caller reasonably assumes cannot happen.
  eq(MCP._camRow({ tenantId: T1, capApplied: 'yes' }).capApplied, false,
     'C28 a truthy non-boolean capApplied is not promoted to true');
  eq(MCP._camRow({ tenantId: T1, capApplied: 1 }).capApplied, false,
     'C29 nor is a numeric 1');
  eq(MCP._camRow({ tenantId: T1, capApplied: true }).capApplied, true,
     'C30 while a real boolean survives');

  const odd = Object.assign({}, FULL_BLOB, {
    camReconciliation: { propId: PROP, camYear: 2025, total: 12000, results: [
      { tenantId: T1, tenantName: 'Acme Coffee LLC', totalAllocated: 6000,
        capApplied: 'yes', expectedCam: null, variance: null, expectedCamBasis: null },
    ] },
  });
  const oddR = await MCP.call('get_cam_status', { propertyId: PROP },
                              ctx({ sbFetch: db({ blob: odd }) }));
  eq(oddR.data.cappedCount, 0, 'C31 end to end: the record does not count it as capped');
  eq(oddR.data.results[0].capApplied, false,
     'C32 and the row agrees — the two figures cannot contradict each other');
}

// ── D. Arithmetic is not verification ──────────────────────────────────────
sec('D. A cap_ceiling basis never becomes a claim about the lease');
{
  const r = await MCP.call('get_cam_status', { propertyId: PROP }, ctx());
  const payload = JSON.stringify(r.data);
  is(!/"(verified|leaseSupported|leaseVerified|confirmed|lease_supported)":/i.test(payload),
     'D1 no field in the data asserts, or even offers, verification');
  // "unverified" is allowed and expected — `legacy_unverified` is the stored
  // basis word, and it is a warning, not a claim. What must never appear is the
  // positive form.
  is(!/lease-supported|lease supported|(?<!un)verified/i.test(payload),
     'D2 and the positive form of the word never appears in the data at all');
  is(/legacy_unverified/.test(payload),
     'D2c while the negative form does — so the check is discriminating, not vacuous');
  // It DOES appear once, in the caveat that forbids the inference — so the
  // check above discriminates rather than passing because the topic is absent.
  const mentions = r.caveats.filter(c => /lease-supported/i.test(c.message));
  eq(mentions.length, 1, 'D2a the phrase appears in exactly one caveat');
  is(/do not describe/i.test(mentions[0].message),
     'D2b and that caveat forbids the description rather than making it');
  const note = cav(r, 'cam.basis_is_arithmetic_not_verification');
  is(note.code !== null, 'D3 a caveat states the distinction explicitly');
  is(/NOT a claim/.test(note.message) && /get_lease_evidence/.test(note.message),
     'D4 and points at the capability that CAN answer the other question',
     note.message.slice(0, 60) + '…');
  is(/capBaseAmount/.test(note.message),
     'D5 naming the arithmetic it does describe');

  // A property with no withheld rows still carries the arithmetic caveat, and
  // no withheld-rows caveat: the two are independent.
  const clean = await MCP.call('get_cam_status', { propertyId: PROP },
                               ctx({ sbFetch: db({ blob: CLEAN_BLOB }) }));
  eq(clean.data.expectation, { established: 1, withheld: 0, none: 0 },
     'D6 a clean reconciliation has nothing withheld');
  is(codes(clean).indexOf('cam.expectation_withheld') === -1,
     'D7 and no withheld caveat is emitted');
  is(codes(clean).indexOf('cam.basis_is_arithmetic_not_verification') !== -1,
     'D8 but the arithmetic-is-not-verification caveat still is');
}

// ── E. Unknown CAM is null, never an empty reconciliation ──────────────────
sec('E. A CAM section that could not be composed is unknown, not zero');
{
  // No stored record at all.
  const none = await MCP.call('get_cam_status', { propertyId: PROP },
                              ctx({ sbFetch: db({ blob: null }) }));
  eq(none.data, null, 'E1 a property with no stored record returns null, not an empty CAM');
  is(codes(none).indexOf('property.no_stored_record') !== -1,
     'E2 with the reason named');
  is(/not a statement that no CAM was run/i.test(
       none.caveats.map(c => c.message).join(' ')),
     'E3 and the caveat says what the null does NOT mean');
  is(JSON.stringify(none).indexOf('"results":[]') === -1,
     'E4 and there is no empty results list anywhere to be misread');

  // A saved property with no reconciliation is EMPTY, not unknown — a real,
  // different answer, and the one place `results: []` is the truth.
  const nocam = await MCP.call('get_cam_status', { propertyId: PROP },
                               ctx({ sbFetch: db({ blob: NO_CAM_BLOB }) }));
  eq(nocam.data.results, [], 'E5 a saved property with no reconciliation reports no rows');
  eq(nocam.data.resultCount, 0, 'E6 with a count of zero — this one IS an assertion');
  eq(nocam.provenance.sectionStatus.cam, 'ok', 'E7 and the section composed fine');

  // CamPool absent: the pool is unknown. A pool of 0 would read as "no expenses".
  const noPool = await MCP.call('get_cam_status', { propertyId: PROP },
                                ctx({ deps: without('CamPool') }));
  eq(noPool.data.pool, null, 'E8 without CamPool the eligible pool is null, not zero');
  is(codes(noPool).indexOf('cam.pool_unavailable') !== -1, 'E9 with a caveat naming it');
  is(/not a statement that there are no CAM expenses/.test(
       cav(noPool, 'cam.pool_unavailable').message),
     'E10 which says what the null does not mean');
  eq(noPool.data.results.length, 5, 'E11 and the stored rows are still reported');

  // VarianceBreakdown absent: the remainder is unknown.
  const noVB = await MCP.call('get_cam_status', { propertyId: PROP },
                              ctx({ deps: without('VarianceBreakdown') }));
  eq(noVB.data.unallocated, null, 'E12 without VarianceBreakdown the remainder is null');
  is(codes(noVB).indexOf('cam.unallocated_unavailable') !== -1, 'E13 with a caveat naming it');
  eq(noVB.data.pool, 12000, 'E14 while the pool, which is still computable, is reported');

  // A real zero survives. This is the case a blanket "null when falsy" would ruin.
  const zero = await MCP.call('get_cam_status', { propertyId: PROP },
    ctx({ sbFetch: db({ blob: Object.assign({}, FULL_BLOB, { invoices: [] }) }) }));
  eq(zero.data.pool, 0, 'E15 a property with no eligible invoices has a pool of 0, reported as 0');
  is(codes(zero).indexOf('cam.pool_unavailable') === -1,
     'E16 and 0 is not mistaken for unavailable');
}

// ── F. The scope of what get_cam_status can see ────────────────────────────
sec('F. The snapshot is named as the snapshot');
{
  const r = await MCP.call('get_cam_status', { propertyId: PROP }, ctx());
  const scope = cav(r, 'cam.snapshot_scope');
  is(scope.code !== null, 'F1 every response says which source it read');
  is(/cam_reconciliations table is not read/i.test(scope.message),
     'F2 and states that the cam_reconciliations table is not among them');
  is(/not a claim that no reconciliation was run/i.test(scope.message),
     'F3 so a caller cannot read the snapshot as the whole history');
  is(/cam_reconciliations table is NOT read/.test(r.provenance.source),
     'F4 with the same fact in machine-readable provenance');
  is(/expectedCamBasis === "cap_ceiling"/.test(r.provenance.expectedCamGate),
     'F5 and the gate itself stated, so a caller can audit what was shown');

  // The three approved reads and nothing else. M6 adds no database read.
  const f = db();
  await MCP.call('get_cam_status', { propertyId: PROP }, ctx({ sbFetch: f }));
  eq(f.calls.map(c => c.method), ['GET', 'GET', 'GET'], 'F6 three reads, all GET');
  is(!f.calls.some(c => /cam_reconciliations/.test(c.path)),
     'F7 and none of them touches cam_reconciliations');
  const g = db();
  await MCP.call('get_attention', { propertyId: PROP }, ctx({ sbFetch: g }));
  eq(g.calls.map(c => c.path), f.calls.map(c => c.path),
     'F8 get_attention performs the identical three reads — M6 adds none');
  eq(r.data.camYear, 2025, 'F9 the CAM year comes from the record, not from today\'s date');
}

// ── G. Attention: an empty list is not "all caught up" ─────────────────────
sec('G. allClear is null when nothing can establish it');
{
  const quiet = await MCP.call('get_attention', { propertyId: PROP },
                               ctx({ sbFetch: db({ blob: QUIET_BLOB }) }));
  eq(quiet.data.items, [], 'G1 a quiet property returns an empty list');
  eq(quiet.data.itemCount, 0, 'G2 and a count of zero items RETURNED');
  eq(quiet.data.allClear, null,
     'G3 but allClear is null — the server cannot see the readiness signals');
  eq(quiet.data.complete, false, 'G4 and the list is explicitly marked incomplete');
  is(codes(quiet).indexOf('attention.not_a_complete_list') !== -1,
     'G5 with a caveat saying so');
  is(/does\s+NOT mean the property is all caught up/.test(
       cav(quiet, 'attention.not_a_complete_list').message),
     'G6 in the words a caller most needs to read');
  eq(cav(quiet, 'attention.not_a_complete_list').severity,
     'unavailable', 'G7 at unavailable severity, not merely informational');
  is(codes(quiet).indexOf('attention.without_selectors_readiness') !== -1,
     'G8 and the underlying degradation is reported too');
  eq(quiet.provenance.sectionStatus.attention, 'degraded',
     'G9 the section is degraded — composed from fewer inputs, not uncomposable');

  // The busy case still carries the same warning: a non-empty list is not a
  // complete one either.
  const busy = await MCP.call('get_attention', { propertyId: PROP }, ctx());
  is(busy.data.itemCount > 0, 'G10 a property with real concerns returns them',
     String(busy.data.itemCount));
  eq(busy.data.allClear, null, 'G11 and allClear is still null');
  is(codes(busy).indexOf('attention.not_a_complete_list') !== -1,
     'G12 with the same incompleteness caveat');

  // Unknown, not empty.
  const gone = await MCP.call('get_attention', { propertyId: PROP },
                              ctx({ deps: without('PropertyWorkspace') }));
  eq(gone.data, null, 'G13 without PropertyWorkspace the list is null, never []');
  is(/not a statement that nothing does/i.test(gone.caveats.map(c => c.message).join(' ')),
     'G14 and says what the null does not mean');
  is(JSON.stringify(gone).indexOf('"items":[]') === -1,
     'G15 with no empty list anywhere to be misread');
  is(JSON.stringify(gone).indexOf('"allClear":true') === -1,
     'G16 and nothing claiming all-clear');
}

// ── H. Attention: the browser is stripped ──────────────────────────────────
sec('H. UI navigation, icons and button labels do not cross the boundary');
{
  const r = await MCP.call('get_attention', { propertyId: PROP }, ctx());
  const blob = JSON.stringify(r);
  const payload = JSON.stringify(r.data);

  for (const it of r.data.items) {
    eq(Object.keys(it).sort(), ['rank', 'severity', 'title', 'why'],
       'H1 each item carries exactly rank, severity, title and why');
  }
  is(!/"icon"|"nav"|"anchors"|"action"|"tab"/.test(payload),
     'H2 no icon, nav, anchors, action or tab key survives into the data');
  // The three names DO appear once more, in provenance.omittedFields, which is
  // how the response declares what it removed instead of removing it silently.
  eq(blob.match(/"icon"|"nav"|"action"/g), ['"icon"', '"nav"', '"action"'],
     'H2a and their only other appearance is the list of what was omitted');
  is(!/disputeSection|openDisputesWrap|cardLeases|spacesSection|propertyReviewQueuePanel|propertyActivitySlot|cardInvoices/.test(blob),
     'H3 and no DOM element id from the application appears anywhere');
  is(!/Review disputes|Review leases|Complete review|Add cap|View allocation|View leases|Verify terms|Open timeline|View policy|Review CAM/.test(blob),
     'H4 nor any button label');
  is(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(blob),
     'H5 nor any UI emoji');

  // What DOES survive is the substance, unchanged.
  const dispute = r.data.items.find(i => /open dispute/.test(i.title || ''));
  is(!!dispute, 'H6 the open-dispute item survives the projection');
  eq(dispute.why, 'Unresolved charges hold up reconciliation.',
     'H7 with its reason passed through verbatim — not paraphrased');
  eq(dispute.severity, 'warning', 'H8 and its severity as composed');

  // Ranking is preserved, not re-sorted.
  eq(r.data.items.map(i => i.rank), r.data.items.map((_, i) => i),
     'H9 rank is the position collectAttention ranked it in');
  const sevOrder = { critical: 0, warning: 1, info: 2 };
  const seq = r.data.items.map(i => sevOrder[i.severity]);
  eq(seq.slice().sort(), seq, 'H10 and that order is still severity-ranked');

  // Counting is not a new rule.
  const counted = r.data.items.reduce((a, i) => { a[i.severity] = (a[i.severity] || 0) + 1; return a; }, {});
  eq(r.data.severityCounts, counted, 'H11 severityCounts is a tally of what was returned');
  is(r.provenance.rulesAdded.indexOf('none') === 0,
     'H12 and provenance states that no attention rule is defined here');
  eq(r.provenance.omittedFields, ['icon', 'nav', 'action'],
     'H13 with the stripped fields named rather than silently dropped');
}

// ── I. Nothing is mutated ──────────────────────────────────────────────────
sec('I. Read-only, in the strong sense: the stored rows come back unchanged');
{
  const before = JSON.stringify(CAM_RESULTS);
  const r = await MCP.call('get_cam_status', { propertyId: PROP }, ctx());
  eq(JSON.stringify(CAM_RESULTS), before,
     'I1 the fixture rows are byte-identical after the call — nothing was repaired');
  is(r.data.results.every((row, i) => row !== CAM_RESULTS[i]),
     'I2 and the projected rows are new objects, not aliases of the stored ones');

  // A write is refused, not merely absent.
  const guarded = MCP._readOnly(async () => ({ status: 200, json: [] }));
  let threw = null;
  try { await guarded('/properties', { method: 'PATCH' }); } catch (e) { threw = e.message; }
  is(threw && /refused a PATCH/.test(threw), 'I3 the transport guard refuses a write');

  // No write verb anywhere in the executable code of the module.
  is(!/method:\s*'(POST|PATCH|PUT|DELETE)'/.test(EXEC),
     'I4 and the module issues no write in any code path');
  is(!/localStorage|sessionStorage|document\.|window\.location/.test(EXEC),
     'I5 nor reaches for browser storage or the DOM');
  // The check discriminates: the module DOES use the vocabulary in its prose.
  is(/never localStorage/.test(SRC), 'I5a and the scan is over code, not prose — the phrase is present');
}

// ── J. Envelope consistency ────────────────────────────────────────────────
sec('J. The same envelope as every capability before it');
{
  for (const [name, args] of M6) {
    const r = await MCP.call(name, args, ctx());
    eq(Object.keys(r).sort(), ['asOf', 'caveats', 'data', 'provenance'],
       'J1.' + name + ' four top-level keys');
    eq(r.asOf, NOW, 'J2.' + name + ' asOf is the caller\'s clock, not the wall');
    eq(r.provenance.origin, 'server', 'J3.' + name + ' origin is server');
    eq(r.provenance.includesBrowserLocalState, false,
       'J4.' + name + ' and it says it has no browser-local state');
    eq(r.provenance.ownership, 'properties.user_id = authenticated user',
       'J5.' + name + ' with the ownership rule stated');
    is(Array.isArray(r.provenance.reads) && r.provenance.reads.length === 3,
       'J6.' + name + ' and the exact reads it performed');
    is(Array.isArray(r.caveats), 'J7.' + name + ' caveats is always a list');

    // Determinism: two identical calls agree exactly.
    const again = await MCP.call(name, args, ctx());
    is(JSON.stringify(r) === JSON.stringify(again),
       'J8.' + name + ' two identical calls agree byte for byte');
  }

  const unknown = await MCP.call('get_cam_forecast', { propertyId: PROP }, ctx());
  eq(codes(unknown), ['unknown_tool'], 'J9 an unknown capability is refused, not guessed at');
}

console.log('\n\x1b[1mRESULT: ' + pass + ' passed, ' + fail + ' failed\x1b[0m');
process.exit(fail ? 1 : 0);

})().catch(e => { console.error(e); process.exit(1); });
