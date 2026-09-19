'use strict';
/**
 * test-m8c-leased-area-projection.js — a space's leased area, one definition.
 *
 *   node test-m8c-leased-area-projection.js
 *
 * OFFLINE. Every transport and every auth call is defined in this file. Nothing
 * here opens a socket or can reach Pilot or Production.
 *
 * WHAT M8c FIXED
 * --------------
 * `tenant-space.js` projected a space's area as
 *
 *     sqft: t.leased_sqft || t.sqft || null
 *
 * and the M8 preflight measured three faults in that one line:
 *
 *   1. `||` on a number. A tenant whose demised area is genuinely 0 projected
 *      as null — "no area on file" — while the STRING '0' is truthy and
 *      survived as '0'. The same fact, reported two ways, decided by which type
 *      the extractor happened to return.
 *   2. `|| t.sqft` is dead. normalizeTenant emits no `sqft` key and every caller
 *      passes normalized tenants; 0 of 86 stored Pilot tenants carry one.
 *   3. No parsing, so `lease.sqft` could be the string '500' while
 *      `identity.leasedSqft` was the number 500 — one quantity, two types, one
 *      response.
 *
 * All three are the same underlying problem: a second definition of leased
 * area, sitting next to the one M7 settled on. The fix is to use PropertyArea,
 * not to write a fourth rule.
 *
 * THE SECTION WORTH READING IS C.
 * It does not check that the two agree on a handful of values — it drives the
 * SAME table of inputs through PropertyArea, through the projection, and
 * through the literal fallback the browser keeps, and requires all three to
 * agree on every one. A fallback that drifts is the failure this file exists to
 * prevent.
 */

const fs   = require('fs');
const MCP  = require('./api/_mcp-capabilities.js');
const HYD  = require('./api/_property-record-hydrator.js');
const DEPS = require('./api/_server-deps.js');
const PA   = require('./property-area.js');
const TN   = require('./tenant-normalize.js');
const INV  = require('./tools/global-dependency-inventory.js');

let pass = 0, fail = 0;
const ok  = (m, d) => { console.log('  \x1b[32m✓\x1b[0m ' + m + (d ? '  — ' + d : '')); pass++; };
const bad = (m, d) => { console.log('  \x1b[31m✗\x1b[0m ' + m + (d ? '  — ' + d : '')); fail++; };
const is  = (c, m, d) => (c ? ok(m, d) : bad(m, d));
const eq  = (a, b, m) => (JSON.stringify(a) === JSON.stringify(b)
  ? ok(m, JSON.stringify(a))
  : bad(m, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`));
const sec = (t) => console.log('\n\x1b[1m── ' + t + ' ──\x1b[0m');

const OWNER = '22222222-2222-4222-8222-222222222222';
const PROP  = '11111111-1111-4111-8111-111111111111';
const T1    = 'aaaaaaaa-0000-4000-8000-000000000001';
const T2    = 'aaaaaaaa-0000-4000-8000-000000000002';
const NOW   = '2026-09-09T12:00:00.000Z';

/**
 * Every shape a stored leased area actually takes, with the answer the ONE
 * definition gives. normalizeTenant does not coerce, so the string forms are
 * real: extraction returns a number, a manual edit returns an input's string.
 */
const AREAS = [
  ['positive number',   500,      500],
  ['positive string',   '500',    500],
  ['decimal string',    '250.5',  250.5],
  ['ZERO number',       0,        0],      // the reported bug
  ['ZERO string',       '0',      0],      // survived as a STRING before
  ['negative',          -5,       -5],     // passed through; PropertyArea rejects at the SUM
  ['empty string',      '',       null],
  ['null',              null,     null],
  ['undefined',         undefined, null],
  ['whitespace',        '   ',    null],
  ['unparseable',       'abc',    null],
];

function tenant(area, over) {
  const t = Object.assign({
    id: T1, tenant_name: 'Acme Coffee LLC', cap: 5,
    start_date: '2020-01-01', end_date: '2030-01-01', lease_type: 'NNN',
  }, over || {});
  if (area !== undefined) t.leased_sqft = area;
  return t;
}
const blob = (tenants) => ({ tenants, invoices: [], disputes: [], timeline: [] });

const auth = async (t) => (t === 'owner' ? { status: 200, json: { id: OWNER } }
                                        : { status: 401, json: {} });
function db(b, sqft) {
  return async (p) => {
    if (/^\/properties\?id=eq\.[^&]+&user_id=eq\.[^&]+&select=id$/.test(p))
      return { status: 200, json: [{ id: PROP }] };
    if (/^\/properties\?/.test(p))
      return { status: 200, json: [{ id: PROP, name: 'Plaza',
                                     sqft: sqft === undefined ? 10000 : sqft, data: b }] };
    if (/^\/tenant_field_evidence\?/.test(p)) return { status: 200, json: [] };
    if (/^\/tenants\?/.test(p)) return { status: 200, json: [] };
    return { status: 404, json: [] };
  };
}
const ctx = (b, sqft) => ({ token: 'owner', authFetch: auth, sbFetch: db(b, sqft), now: NOW });
const recordFor = async (b, sqft) => (await HYD.hydrate({
  propertyId: PROP, userId: OWNER, sbFetch: db(b, sqft) })).record;

/**
 * The REAL fallback inside tenant-space.js, exercised by loading that file with
 * no PropertyArea on the window — the situation a browser is in when
 * property-area.js failed to load.
 *
 * Re-implementing the fallback here and comparing THAT to PropertyArea would
 * test a copy: mutation testing showed exactly that, with two mutants of the
 * real fallback surviving untouched. This drives the shipped code instead.
 */
function withWindow(extra, fn) {
  const had = Object.prototype.hasOwnProperty.call(global, 'window');
  const prior = had ? global.window : undefined;
  try { global.window = extra || {}; return fn(); }
  finally { if (had) global.window = prior; else delete global.window; }
}
function loadTenantSpace(win) {
  return withWindow(win, () => {
    delete require.cache[require.resolve('./tenant-space.js')];
    require('./tenant-space.js');
    return global.window.TenantSpace;
  });
}
/** assemble() through tenant-space.js's OWN fallback, PropertyArea absent. */
function fallbackRule(v) {
  const TS = loadTenantSpace({});                       // no PropertyArea
  const prop = { id: PROP, tenants: [{ id: T1, tenant_name: 'A', leased_sqft: v }] };
  return withWindow({ TenantSpace: TS }, () => TS.assemble(prop, T1)).lease.sqft;
}

(async function main() {

// ── A. The reported bug ───────────────────────────────────────────────────
sec('A. A legitimate zero is an area, not an absence');
{
  const rec = await recordFor(blob([tenant(0)]));
  eq(rec.spaces[0].lease.sqft, 0,
     'A1 leased_sqft 0 projects as 0 — a signage or parking licence really can be zero');
  is(rec.spaces[0].lease.sqft !== null, 'A2 and specifically NOT null');

  // The old rule, run here so the regression is visible rather than asserted.
  const old = (t) => t.leased_sqft || t.sqft || null;
  eq(old(TN.normalizeTenant(tenant(0))), null,
     'A3 — measured: the rule this replaced turned that 0 into null');
  eq(old(TN.normalizeTenant(tenant('0'))), '0',
     'A4 while the STRING zero survived it, as a string — two answers for one fact');

  // And the string zero now agrees with the number zero.
  const recS = await recordFor(blob([tenant('0')]));
  eq(recS.spaces[0].lease.sqft, 0, 'A5 "0" and 0 now give the same answer');
  eq(typeof recS.spaces[0].lease.sqft, 'number', 'A6 and it is a number, not a string');
}

// ── B. Every shape a stored area takes ────────────────────────────────────
sec('B. The whole input table, through the record');
{
  for (const [label, input, want] of AREAS) {
    const rec = await recordFor(blob([tenant(input)]));
    eq(rec.spaces[0].lease.sqft, want, 'B1 ' + label + ' → ' + JSON.stringify(want));
  }
  // NaN IS NOT NULL, and JSON.stringify turns it into "null" — so the equality
  // helper above cannot tell them apart. Mutation testing found this: dropping
  // the finiteness guard in PropertyArea let NaN through and every assertion
  // still passed. Checked by identity here rather than by serialisation.
  {
    const rec = await recordFor(blob([tenant('abc')]));
    const v = rec.spaces[0].lease.sqft;
    is(v === null, 'B1a an unparseable area is exactly null');
    is(!Number.isNaN(v), 'B1b and specifically NOT NaN wearing null\'s clothes');
    is(PA._area('abc') === null && !Number.isNaN(PA._area('abc')),
       'B1c the canonical rule returns null for it too, not NaN');
    is(PA._area(Infinity) === null, 'B1d and rejects Infinity');
  }

  // A tenant with no area KEY at all, not merely an empty one.
  const bare = { id: T1, tenant_name: 'Acme', lease_type: 'NNN' };
  const rec = await recordFor(blob([bare]));
  eq(rec.spaces[0].lease.sqft, null, 'B2 a tenant with no area key at all → null');
}

// ── C. One definition — the projection, the canon, and the fallback ───────
sec('C. Three implementations, one answer, on every input');
{
  let disagreed = [];
  for (const [label, input, want] of AREAS) {
    const rec  = await recordFor(blob([tenant(input)]));
    const norm = TN.normalizeTenant(tenant(input));
    const viaProjection = rec.spaces[0].lease.sqft;
    const viaCanon      = PA._area(norm.leased_sqft);
    const viaFallback   = fallbackRule(norm.leased_sqft);
    if (JSON.stringify(viaProjection) !== JSON.stringify(viaCanon) ||
        JSON.stringify(viaCanon) !== JSON.stringify(viaFallback)) {
      disagreed.push({ label, viaProjection, viaCanon, viaFallback });
    }
    eq(viaProjection, want, 'C1 ' + label + ' — the projection');
  }
  is(disagreed.length === 0,
     'C2 the projection, PropertyArea._area and the browser fallback agree on all ' +
     AREAS.length + ' inputs',
     disagreed.length ? JSON.stringify(disagreed[0]) : 'no disagreement');

  // The projection must actually be REACHING PropertyArea on the server, not
  // quietly running the fallback — the M7 lesson, where a name was declared on
  // the allow-list and never placed in the shim.
  DEPS.load();
  is(DEPS.shimKeys().indexOf('PropertyArea') !== -1,
     'C3 PropertyArea is IN the shim, so tenant-space.js reaches the canonical rule');
  eq(DEPS.SHIM_KEYS.slice().sort(),
     ['DisputeStatus', 'LeaseIntelligence', 'PropertyArea', 'PropertyReference',
      'PropertyWorkspace', 'TenantSpace'],
     'C3a and the declared allow-list holds exactly the reviewed names');
  is(DEPS.SHIM_KEYS.indexOf('Selectors') === -1, 'C3b Selectors is still excluded');
  const cls = INV.CLASSIFICATION.PropertyArea;
  is(cls && cls.kind === 'shimmed',
     'C3d and the dependency inventory classifies it, so M3\'s scan cannot find ' +
     'an unclassified global where a reviewed one belongs');
  eq(DEPS.leakedWindow(), false, 'C3c and no window is left behind');

  // Purity, because this name is now on a security boundary.
  const src  = fs.readFileSync(require.resolve('./property-area.js'), 'utf8');
  const exec = INV.stripStringsAndComments(src);
  is(!/document\.|localStorage|sessionStorage|fetch\(|XMLHttpRequest/.test(exec),
     'C4 property-area.js reaches for no DOM, storage or network');
  const before = JSON.stringify({ a: PA._area(5), b: PA.leasedSqft({ tenants: [] }) });
  PA._area('123'); PA.occupancyPct({ tenants: [{ leased_sqft: 1 }], totalSqft: 2 });
  eq(JSON.stringify({ a: PA._area(5), b: PA.leasedSqft({ tenants: [] }) }), before,
     'C5 and it holds no state that using it could change');
}

// ── D. The dead fallback ──────────────────────────────────────────────────
sec('D. `|| t.sqft` is gone, and it could never have fired');
{
  const norm = TN.normalizeTenant({ id: T1, tenant_name: 'A', sqft: 300 });
  eq(norm.leased_sqft, 300, 'D1 normalizeTenant folds a bare `sqft` INTO leased_sqft');
  is(!('sqft' in norm), 'D2 and emits no `sqft` key of its own — so the fallback was dead');

  // Which means removing it changes nothing for a normalized tenant.
  const rec = await recordFor(blob([{ id: T1, tenant_name: 'A', sqft: 300 }]));
  eq(rec.spaces[0].lease.sqft, 300,
     'D3 a tenant that arrives carrying only `sqft` still reports 300 — the ' +
     'substitution happens upstream in the normaliser, as M8 recorded');

  const src = fs.readFileSync(require.resolve('./tenant-space.js'), 'utf8');
  const exec = INV.stripStringsAndComments(src);
  is(!/leased_sqft\s*\|\|\s*\w*\.?sqft/.test(exec),
     'D4 the `leased_sqft || sqft` chain is gone from tenant-space.js');
  is(!/sqft:\s*t\.leased_sqft\s*\|\|/.test(exec),
     'D5 and the lease projection no longer uses || on an area at all');

  // D4 CAUGHT A SECOND ONE. The space-LIST card built its "N sqft" chip with
  // the same `t.leased_sqft || t.sqft` rule, so a zero-area space showed no
  // area at all — reading as "unknown" where the truth is "none" — and the card
  // could disagree with the space view it links to. The M8 preflight did not
  // find it; this assertion did, which is the point of asserting the invariant
  // over the whole file rather than pinning one line.
  is(/rec\.lease\.sqft != null/.test(exec),
     'D6 the space-list card reads the area its own record computed');
  const occurrences = (exec.match(/\bt\.sqft\b/g) || []).length;
  eq(occurrences, 0, 'D7 and `t.sqft` appears nowhere in the executable file');
}

// ── E. PropertyRecord stays consistent with itself ────────────────────────
sec('E. lease.sqft and identity.leasedSqft are the same quantity, the same way');
{
  // Two tenants, both with areas: the identity total is the sum of the spaces.
  const rec = await recordFor(blob([tenant(500), tenant(300, { id: T2, tenant_name: 'North' })]), 1000);
  const spaceSum = rec.spaces.reduce((s, sp) => s + (sp.lease.sqft || 0), 0);
  eq(rec.identity.leasedSqft, 800, 'E1 identity.leasedSqft sums the tenants');
  eq(spaceSum, 800, 'E2 and the spaces sum to the same figure');
  eq(rec.identity.occupancy, 80, 'E3 with occupancy derived from it');

  // Types match. Before M8c one could be a string and the other a number.
  const recS = await recordFor(blob([tenant('500'), tenant('300', { id: T2, tenant_name: 'N' })]), 1000);
  eq(recS.identity.leasedSqft, 800, 'E4 string areas still sum to 800');
  for (const sp of recS.spaces) {
    eq(typeof sp.lease.sqft, 'number',
       'E5 and every space reports a NUMBER, matching identity.leasedSqft\'s type');
  }

  // A zero-area tenant is COUNTED, not treated as missing — the M7 rule, which
  // the old projection quietly contradicted for this exact tenant.
  const recZ = await recordFor(blob([tenant(500), tenant(0, { id: T2, tenant_name: 'Sign' })]), 1000);
  eq(recZ.identity.leasedSqft, 500, 'E6 a zero-area tenant contributes 0 to the total');
  eq(recZ.identity.areaBasis.tenantsMissingArea, 0,
     'E7 and is NOT counted as missing an area');
  eq(recZ.spaces[1].lease.sqft, 0, 'E8 while its own space reports 0, not null');

  // One tenant genuinely without an area still makes the total unknown.
  const recM = await recordFor(blob([tenant(500), tenant(undefined, { id: T2, tenant_name: 'M' })]), 1000);
  eq(recM.identity.leasedSqft, null, 'E9 a tenant with no area makes the total unknown');
  eq(recM.identity.occupancy, null, 'E10 and occupancy null with it');
  eq(recM.spaces[1].lease.sqft, null, 'E11 while its space reports null, consistently');
}

// ── F. Through the capabilities ───────────────────────────────────────────
sec('F. What an agent actually reads');
{
  const b = blob([tenant(0, { id: T1, tenant_name: 'Signage Licence' })]);
  const sp  = await MCP.call('get_space',  { propertyId: PROP, spaceId: T1 }, ctx(b));
  const ten = await MCP.call('get_tenant', { propertyId: PROP, tenantId: T1 }, ctx(b));
  const pr  = await MCP.call('get_property', { propertyId: PROP }, ctx(b));

  eq(sp.data.lease.sqft, 0,  'F1 get_space reports 0');
  eq(ten.data.lease.sqft, 0, 'F2 get_tenant agrees');
  eq(pr.data.spaces[0].lease.sqft, 0, 'F3 and get_property agrees');
  is(sp.data.lease.sqft === ten.data.lease.sqft &&
     ten.data.lease.sqft === pr.data.spaces[0].lease.sqft,
     'F4 all three capabilities report the identical value');

  // The unit declaration still describes it, and now describes it accurately.
  const u = sp.provenance.units['lease.sqft'];
  eq(u.unit, 'square_feet', 'F5 lease.sqft is declared as square feet');

  // M8c added no capability and no read.
  eq(MCP.TOOLS.length, 9, 'F6 still nine capabilities');
  is(Array.isArray(sp.provenance.reads) && sp.provenance.reads.length === 3,
     'F7 and still the same three reads');
}

console.log('\n\x1b[1mRESULT: ' + pass + ' passed, ' + fail + ' failed\x1b[0m');
process.exit(fail ? 1 : 0);

})().catch(e => { console.error(e); process.exit(1); });
