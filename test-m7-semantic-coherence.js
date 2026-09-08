'use strict';
/**
 * test-m7-semantic-coherence.js — the four measured incoherences, closed.
 *
 *   node test-m7-semantic-coherence.js
 *
 * OFFLINE. Every transport and every auth call is defined in this file.
 * Nothing here opens a socket or can reach Pilot or Production.
 *
 * WHAT M7 IS
 * ----------
 * Not a capability. The M1-M6 audit measured four ways an agent could be misled
 * by a surface that was, in every individual answer, telling the truth:
 *
 *   A. Two capabilities counted open disputes differently, so the same property
 *      reported "1 open dispute" and openDisputeCount 2 in the same breath.
 *   B. lease.cap arrived as a bare number with no unit stated anywhere.
 *   C. identity.leasedSqft was null because three modules disagree, while
 *      identity.occupancy was published from one of those three — so the
 *      refused numerator was recoverable by multiplication, and a clamp turned
 *      contradictory data into a confident 100%.
 *   D. The blob and the normalised tables hold the same facts and disagree, and
 *      only one of them was named in the answer.
 *
 * THE SECTION WORTH READING IS B.
 * The agreement test is not "both say 2". It is that they agree across EVERY
 * status the state machine defines and every combination of them, driven from
 * the transition table itself — so a status added to the machine later is
 * covered by this suite the day it is added, rather than the day someone
 * notices two numbers disagreeing again.
 */

const fs   = require('fs');
const MCP  = require('./api/_mcp-capabilities.js');
const DEPS = require('./api/_server-deps.js');
const DS   = require('./dispute-status.js');
const PA   = require('./property-area.js');
const INV  = require('./tools/global-dependency-inventory.js');

const SRC  = fs.readFileSync(require.resolve('./dispute-status.js'), 'utf8');
const AREA_SRC = fs.readFileSync(require.resolve('./property-area.js'), 'utf8');

let pass = 0, fail = 0;
const ok  = (m, d) => { console.log('  \x1b[32m✓\x1b[0m ' + m + (d ? '  — ' + d : '')); pass++; };
const bad = (m, d) => { console.log('  \x1b[31m✗\x1b[0m ' + m + (d ? '  — ' + d : '')); fail++; };
const is  = (c, m, d) => (c ? ok(m, d) : bad(m, d));
const eq  = (a, b, m) => (JSON.stringify(a) === JSON.stringify(b)
  ? ok(m, JSON.stringify(a))
  : bad(m, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`));
const sec = (t) => console.log('\n\x1b[1m── ' + t + ' ──\x1b[0m');

// ── Fixtures ───────────────────────────────────────────────────────────────
const OWNER = '22222222-2222-4222-8222-222222222222';
const PROP  = '11111111-1111-4111-8111-111111111111';
const T1    = 'aaaaaaaa-0000-4000-8000-000000000001';
const T2    = 'aaaaaaaa-0000-4000-8000-000000000002';
const NOW   = '2026-09-08T12:00:00.000Z';

const TENANTS = [
  { id: T1, tenant_name: 'Acme Coffee LLC', leased_sqft: 500, cap: 5,
    start_date: '2020-01-01', end_date: '2030-01-01', lease_type: 'NNN' },
  { id: T2, tenant_name: 'Northside Hardware', leased_sqft: 300, cap: null,
    start_date: '2021-06-01', end_date: '2026-06-01', lease_type: 'NNN' },
];

function blob(over) {
  return Object.assign({
    tenants: TENANTS, invoices: [], disputes: [], timeline: [],
  }, over || {});
}

const auth = async (tok) => (tok === 'owner'
  ? { status: 200, json: { id: OWNER } } : { status: 401, json: {} });

function db(opts) {
  const o = Object.assign({ blob: blob(), sqft: 1000 }, opts || {});
  return async (p) => {
    if (/^\/properties\?id=eq\.[^&]+&user_id=eq\.[^&]+&select=id$/.test(p)) {
      return { status: 200, json: [{ id: PROP }] };
    }
    if (/^\/properties\?/.test(p)) {
      return { status: 200, json: [{ id: PROP, name: 'Main Street Plaza',
                                     sqft: o.sqft, data: o.blob }] };
    }
    if (/^\/tenant_field_evidence\?/.test(p)) return { status: 200, json: [] };
    if (/^\/tenants\?/.test(p)) return { status: 200, json: [] };
    return { status: 404, json: [] };
  };
}

const ctx = (over) => Object.assign(
  { token: 'owner', authFetch: auth, sbFetch: db(), now: NOW }, over || {});
const codes = (env) => env.caveats.map(c => c.code);
const disp = (status, i) => ({ id: 'd' + (i || 0), tenantId: T1,
  tenantName: 'Acme Coffee LLC', status, amount: 100, timestamp: '2025-03-01T00:00:00Z' });

(async function main() {

// ── A. One definition, derived from the state machine ──────────────────────
sec('A. "Open" is derived from the transition table, not restated beside it');
{
  eq(Object.keys(DS.TRANSITIONS).sort(),
     ['accepted', 'docs_requested', 'open', 'rejected'],
     'A1 the machine defines four statuses');

  // The predicate must FOLLOW the table. If it were a hard-coded list, a state
  // added to the machine would be silently misclassified; this proves the
  // derivation by checking every entry against its own transition list.
  for (const s of Object.keys(DS.TRANSITIONS)) {
    const expected = DS.TRANSITIONS[s].length ? 'open' : 'closed';
    eq(DS.classify(s), expected,
       'A2.' + s + ' classifies as ' + expected + ' because the machine ' +
       (expected === 'open' ? 'still permits a transition' : 'permits none'));
  }

  // THE DERIVATION ITSELF. A hard-coded list of the same four answers passes
  // every assertion above while quietly losing the property that makes this
  // module worth having: add a state to the machine and the predicate must
  // follow it. Proven by adding one and taking it away again.
  {
    DS.TRANSITIONS.under_review = ['accepted', 'rejected'];
    const gotOpen = DS.classify('under_review');
    DS.TRANSITIONS.archived = [];
    const gotClosed = DS.classify('archived');
    const tallyNew = DS.tally([disp('under_review', 1), disp('archived', 2)]);
    delete DS.TRANSITIONS.under_review;
    delete DS.TRANSITIONS.archived;
    eq(gotOpen, 'open',
       'A2z a NEW non-terminal state classifies as open with no edit to this module');
    eq(gotClosed, 'closed', 'A2y and a new terminal state as closed');
    eq({ open: tallyNew.open, closed: tallyNew.closed, unknown: tallyNew.unknown },
       { open: 1, closed: 1, unknown: 0 }, 'A2x and tally follows the table too');
    eq(DS.classify('under_review'), 'unknown',
       'A2w — and the table is back as it was, so this suite left nothing behind');
  }

  eq(DS.classify('resolved'), 'closed',
     'A3 the legacy status resolved is closed — evidenced, not assumed');
  is(DS.LEGACY_CLOSED.length === 1,
     'A3a and it is the ONLY legacy alias, so the list cannot quietly grow');

  // Nothing writes these. Classifying them would be inventing vocabulary.
  for (const s of ['escalated', 'withdrawn']) {
    eq(DS.classify(s), 'unknown',
       'A4.' + s + ' is unknown — it appears once in the codebase and nothing writes it');
  }
  for (const v of [undefined, null, '', 0, {}, 'OPEN']) {
    eq(DS.classify(v), 'unknown', 'A5 a ' + JSON.stringify(v) + ' status is unknown');
  }
  eq(DS.classify('OPEN'), 'unknown', 'A5a case matters — no silent normalisation');

  // The third answer is carried, never absorbed.
  const t = DS.tally([disp('open', 1), disp('docs_requested', 2), disp('accepted', 3),
                      disp('resolved', 4), disp('nonsense', 5), disp('escalated', 6)]);
  eq(t, { total: 6, open: 2, closed: 2, unknown: 2,
          unknownStatuses: ['escalated', 'nonsense'] },
     'A6 tally splits three ways and names the statuses it could not place');
  is(t.open + t.closed + t.unknown === t.total,
     'A7 and nothing is lost — open + closed + unknown === total');

  // script.js keeps a literal copy as its browser fallback. If the two ever
  // drift, the browser and the server would enforce different state machines —
  // which is the exact class of bug M7 exists to remove, reintroduced one level
  // down. Compared here rather than trusted to a comment.
  {
    const src = fs.readFileSync(require.resolve('./script.js'), 'utf8');
    const m = src.match(/const DISPUTE_TRANSITIONS = \(window\.DisputeStatus[\s\S]*?\|\| (\{[\s\S]*?\n\});/);
    is(!!m, 'A10 script.js reads the shared table with a literal fallback');
    if (m) {
      // eslint-disable-next-line no-eval
      const fallback = eval('(' + m[1] + ')');
      eq(fallback, DS.TRANSITIONS,
         'A10a and that fallback is byte-for-byte the module\'s table — no second machine');
    }
  }

  // Purity, because this name is on the sealed shim allow-list.
  const exec = INV.stripStringsAndComments(SRC);
  is(!/document\.|localStorage|sessionStorage|fetch\(|XMLHttpRequest/.test(exec),
     'A8 the module reaches for no DOM, storage or network');
  const before = JSON.stringify(DS.TRANSITIONS);
  DS.tally([disp('open', 1)]); DS.classify('anything');
  eq(JSON.stringify(DS.TRANSITIONS), before, 'A9 and classifying mutates nothing it holds');
}

// ── B. The capabilities agree, across every status the machine defines ─────
sec('B. get_attention and get_disputes cannot disagree — the measured defect');
{
  // The exact fixture the audit measured: one open, one docs_requested.
  const two = await MCP.call('get_disputes', { propertyId: PROP },
    ctx({ sbFetch: db({ blob: blob({ disputes: [disp('open', 1), disp('docs_requested', 2)] }) }) }));
  const att = await MCP.call('get_attention', { propertyId: PROP },
    ctx({ sbFetch: db({ blob: blob({ disputes: [disp('open', 1), disp('docs_requested', 2)] }) }) }));
  eq(two.data.openDisputeCount, 2, 'B1 get_disputes counts both as open');
  const title = (att.data.items.find(i => /dispute/i.test(i.title || '')) || {}).title;
  eq(title, '2 open disputes', 'B2 and get_attention says the same number');

  // THE REAL TEST. Every subset of the machine's statuses, driven from the
  // table — so a status added to the machine is covered the day it is added.
  const statuses = Object.keys(DS.TRANSITIONS).concat(DS.LEGACY_CLOSED, ['nonsense']);
  let checked = 0, disagreed = [];
  for (let mask = 1; mask < (1 << statuses.length); mask++) {
    const list = [];
    for (let i = 0; i < statuses.length; i++) {
      if (mask & (1 << i)) list.push(disp(statuses[i], i));
    }
    const c = ctx({ sbFetch: db({ blob: blob({ disputes: list }) }) });
    const d = await MCP.call('get_disputes',  { propertyId: PROP }, c);
    const a = await MCP.call('get_attention', { propertyId: PROP }, ctx({
      sbFetch: db({ blob: blob({ disputes: list }) }) }));
    const t  = DS.tally(list);
    const it = a.data.items.find(x => /open dispute/i.test(x.title || ''));
    const attCount = it ? parseInt(String(it.title), 10) : 0;
    checked++;
    if (d.data.openDisputeCount !== t.open || attCount !== t.open) {
      disagreed.push({ statuses: list.map(x => x.status), expected: t.open,
                       disputes: d.data.openDisputeCount, attention: attCount });
    }
  }
  is(disagreed.length === 0,
     'B3 across all ' + checked + ' status combinations the two capabilities agree',
     disagreed.length ? JSON.stringify(disagreed[0]) : checked + ' combinations');

  // And the count they agree on is the one the shared module produces —
  // not merely equal to each other while both being wrong.
  const all = statuses.map((s, i) => disp(s, i));
  const dAll = await MCP.call('get_disputes', { propertyId: PROP },
    ctx({ sbFetch: db({ blob: blob({ disputes: all }) }) }));
  eq(dAll.data.openDisputeCount, DS.tally(all).open,
     'B4 and it is the shared predicate\'s number, not a coincidence');
  eq(dAll.data.closedDisputeCount, DS.tally(all).closed, 'B5 closed is reported too');
  eq(dAll.data.unknownStatusCount, DS.tally(all).unknown, 'B6 and so is unknown');
  is(dAll.data.disputeCount ===
       dAll.data.openDisputeCount + dAll.data.closedDisputeCount + dAll.data.unknownStatusCount,
     'B7 the three counts account for every dispute');
  is(codes(dAll).indexOf('disputes.unknown_status') !== -1,
     'B8 an unknown status raises a caveat rather than vanishing');
  is(/LOWER BOUND/.test(dAll.caveats.find(c => c.code === 'disputes.unknown_status').message),
     'B9 which says openDisputeCount is a lower bound, so the number is not over-read');
  is(/state machine/.test(dAll.provenance.openDisputeRule),
     'B10 and the rule itself travels on the response');

  // A property with no unknown statuses must NOT carry the caveat.
  const clean = await MCP.call('get_disputes', { propertyId: PROP },
    ctx({ sbFetch: db({ blob: blob({ disputes: [disp('open', 1), disp('accepted', 2)] }) }) }));
  eq(clean.data.unknownStatusCount, 0, 'B11 a clean roster reports zero unknowns');
  is(codes(clean).indexOf('disputes.unknown_status') === -1, 'B12 and raises no caveat');

  // The unavailable contract is untouched by any of this.
  const gone = await MCP.call('get_disputes', { propertyId: PROP },
                              ctx({ sbFetch: db({ blob: null }) }));
  eq(gone.data.disputes, null, 'B13 an unknown dispute source is still null, never []');
  eq(gone.data.openDisputeCount, null, 'B14 with a null count, not zero');
  eq(gone.data.unknownStatusCount, null, 'B15 and the new counts are null there too');
}

// ── B2. The browser modules, tested where the server cannot reach ──────────
sec('B2. collectAttention and TenantSpace, driven directly under a shim');
{
  // The server graph excludes Selectors by design, so buildPropMeta is never
  // available there and the `meta.openDisputes` path is unreachable from any
  // capability. It IS reachable in a browser, where Selectors always loads —
  // and that is precisely where the narrow count used to come from. Driving the
  // module directly with a Selectors stub is the only way to test it.
  const twoOpen = { id: PROP, tenants: TENANTS, invoices: [], timeline: [],
    disputes: [disp('open', 1), disp('docs_requested', 2)] };

  const runUnder = (extra, fn) => {
    const had = Object.prototype.hasOwnProperty.call(global, 'window');
    const prior = had ? global.window : undefined;
    try { global.window = Object.assign({ DisputeStatus: DS }, extra || {}); return fn(); }
    finally { if (had) global.window = prior; else delete global.window; }
  };

  const PW = runUnder({}, () => { delete require.cache[require.resolve('./property-workspace.js')];
                                  require('./property-workspace.js');
                                  return global.window.PropertyWorkspace; });

  const plain = runUnder({ PropertyWorkspace: PW }, () => PW.collectAttention(twoOpen));
  const plainTitle = (plain.find(i => /dispute/i.test(i.title)) || {}).title;
  eq(plainTitle, '2 open disputes',
     'B2a collectAttention counts a docs_requested dispute as open');

  // The back door: Selectors present, offering the OLD narrow number.
  const withSel = runUnder({
    PropertyWorkspace: PW,
    Selectors: { derivePropertyReadiness: () => ({}),
                 buildPropMeta: () => ({ openDisputes: 1 }) },
  }, () => PW.collectAttention(twoOpen));
  const selTitle = (withSel.find(i => /dispute/i.test(i.title)) || {}).title;
  eq(selTitle, '2 open disputes',
     'B2b and does NOT defer to Selectors.buildPropMeta, which still uses the narrow rule');

  // TenantSpace's own count, driven the same way.
  const TS = runUnder({}, () => { delete require.cache[require.resolve('./tenant-space.js')];
                                  require('./tenant-space.js');
                                  return global.window.TenantSpace; });
  const rec = runUnder({ TenantSpace: TS }, () => TS.assemble(twoOpen, T1));
  eq(rec.counts.openDisputes, 2,
     'B2c TenantSpace agrees, so a space\'s badge and the capability cannot differ');
  eq(rec.counts.openDisputes, DS.tally(twoOpen.disputes).open,
     'B2d and it is the shared predicate\'s number');

  // All three, on one property, at once.
  const viaMcp = await MCP.call('get_disputes', { propertyId: PROP },
    ctx({ sbFetch: db({ blob: blob({ disputes: twoOpen.disputes }) }) }));
  is(plainTitle === '2 open disputes' && rec.counts.openDisputes === 2 &&
     viaMcp.data.openDisputeCount === 2,
     'B2e attention, space and capability all say 2 — the measured contradiction, closed');

  // DEFERRING, NOT MERELY AGREEING.
  //
  // Both files keep a literal `open || docs_requested` fallback for a browser
  // that failed to load dispute-status.js, and that literal happens to equal the
  // canonical rule today — so every assertion above passes even if the files
  // ignore the shared module entirely. Mutation testing found exactly that: two
  // mutants disabling the DisputeStatus branch survived the whole suite.
  //
  // Adding a state to the machine separates the two. A file that defers picks it
  // up; a file running its own literal does not.
  {
    DS.TRANSITIONS.under_review = ['accepted', 'rejected'];
    const withNew = { id: PROP, tenants: TENANTS, invoices: [], timeline: [],
      disputes: [disp('open', 1), disp('under_review', 2)] };
    let attN = null, tsN = null, mcpN = null;
    try {
      attN = runUnder({ PropertyWorkspace: PW }, () => PW.collectAttention(withNew));
      tsN  = runUnder({ TenantSpace: TS }, () => TS.assemble(withNew, T1));
      mcpN = await MCP.call('get_disputes', { propertyId: PROP },
        ctx({ sbFetch: db({ blob: blob({ disputes: withNew.disputes }) }) }));
    } finally {
      delete DS.TRANSITIONS.under_review;
    }
    const attTitle = (attN.find(i => /dispute/i.test(i.title)) || {}).title;
    eq(attTitle, '2 open disputes',
       'B2f collectAttention DEFERS to the shared module — a new open state counts');
    eq(tsN.counts.openDisputes, 2, 'B2g TenantSpace defers too');
    eq(mcpN.data.openDisputeCount, 2, 'B2h and so does get_disputes');
    eq(DS.classify('under_review'), 'unknown', 'B2i with the table restored afterwards');
  }
}

// ── C. Units are declared, and ambiguity is stated rather than resolved ────
sec('C. Every exposed number says what it means');
{
  const sp = await MCP.call('get_space', { propertyId: PROP, spaceId: T1 }, ctx());
  const u  = sp.provenance.units;
  is(!!u, 'C1 a units declaration travels on the response');
  eq(u['lease.cap'].unit, 'percent', 'C2 lease.cap is declared as a percentage');
  eq(u['lease.cap'].guarantee, 'convention',
     'C3 and only as a CONVENTION — normalizeCap runs on the extraction path only');
  is(/tenants table|manual edit|import/.test(u['lease.cap'].note),
     'C4 the note names the paths that bypass normalisation');
  eq(u['lease.sqft'].unit, 'square_feet', 'C5 lease.sqft is declared');
  is(/rentable/.test(u['lease.sqft'].note),
     'C6 with its own leased-vs-rentable caveat stated rather than hidden');

  // Currency is NOT guessed. fmt() prints a '$' but no currency code is stored
  // anywhere in the schema, and inventing USD would assert a fact about every
  // property in the system.
  const cam = await MCP.call('get_cam_status', { propertyId: PROP }, ctx());
  eq(cam.provenance.units['cam.pool'].unit, 'currency', 'C7 CAM money is declared as currency');
  eq(cam.provenance.units['cam.pool'].currencyCode, null,
     'C8 with a NULL currency code — none is stored, and none is invented');
  eq(cam.provenance.units['cam.pool'].guarantee, 'unknown', 'C9 and the guarantee says so');

  // The ambiguous range. 0.05 is 0.05% by the convention and 5% by every
  // human intent; both readings are stated and neither is chosen.
  const amb = await MCP.call('get_space', { propertyId: PROP, spaceId: T1 }, ctx({
    sbFetch: db({ blob: blob({ tenants: [Object.assign({}, TENANTS[0], { cap: 0.05 })] }) }) }));
  is(codes(amb).indexOf('lease.cap_unit_ambiguous') !== -1,
     'C10 a cap between 0 and 1 raises an ambiguity caveat');
  const m = amb.caveats.find(c => c.code === 'lease.cap_unit_ambiguous').message;
  is(/0\.05%/.test(m) && /5%/.test(m), 'C11 stating BOTH readings', m.slice(0, 70) + '…');
  is(/factor\s+of\s+100/.test(m), 'C12 and how far apart they are');
  is(/NOT converted/.test(m), 'C13 while the stored value is passed through unchanged');
  eq(amb.data.lease.cap, 0.05, 'C14 — measured: the value is not rewritten');

  // Unambiguous caps raise nothing.
  for (const v of [5, 0, 1, 35, null]) {
    const r = await MCP.call('get_space', { propertyId: PROP, spaceId: T1 }, ctx({
      sbFetch: db({ blob: blob({ tenants: [Object.assign({}, TENANTS[0], { cap: v })] }) }) }));
    is(codes(r).indexOf('lease.cap_unit_ambiguous') === -1,
       'C15 a cap of ' + v + ' is unambiguous and raises no caveat');
  }
  eq(MCP.capAmbiguityCaveat(0.5, 'x').code, 'lease.cap_unit_ambiguous', 'C16 0.5 is in range');
  eq(MCP.capAmbiguityCaveat(1, 'x'), null, 'C17 1 is not — the boundary is exclusive');
  eq(MCP.capAmbiguityCaveat(0, 'x'), null, 'C18 nor is a genuine 0% freeze');

  // get_tenant carries it too — the same lease reached two ways cannot differ.
  const tn = await MCP.call('get_tenant', { propertyId: PROP, tenantId: T1 }, ctx({
    sbFetch: db({ blob: blob({ tenants: [Object.assign({}, TENANTS[0], { cap: 0.05 })] }) }) }));
  is(codes(tn).indexOf('lease.cap_unit_ambiguous') !== -1,
     'C19 get_tenant raises the same caveat for the same lease');
}

// ── D. Leased area and occupancy come from one definition, or from neither ─
sec('D. Occupancy can no longer contradict the area it is computed from');
{
  // The clean case: every tenant has an area. 800 / 1000 = 80%.
  const full = await MCP.call('get_property', { propertyId: PROP }, ctx());
  eq(full.data.identity.leasedSqft, 800, 'D1 a complete roster yields a real leased area');
  eq(full.data.identity.occupancy, 80, 'D2 and an occupancy derived from THAT number');
  eq(full.data.identity.areaBasis.rule, 'sum_leased_sqft_all_tenants_complete',
     'D3 with the rule named on the response');
  eq(full.data.identity.areaBasis.clamped, false, 'D4 and stated as unclamped');

  // A tenant with NO area of any kind ⇒ BOTH null. Not a smaller sum, and not
  // an occupancy computed from a partial numerator anyway.
  const partial = await MCP.call('get_property', { propertyId: PROP }, ctx({
    sbFetch: db({ blob: blob({ tenants: [TENANTS[0],
      { id: T2, tenant_name: 'Northside Hardware', lease_type: 'NNN' }] }) }) }));
  eq(partial.data.identity.leasedSqft, null,
     'D5 one tenant without an area makes the total UNKNOWN, not smaller');
  eq(partial.data.identity.occupancy, null, 'D6 and occupancy is null with it');
  eq(partial.data.identity.areaBasis.tenantsMissingArea, 1, 'D7 naming how many are missing');
  is(codes(partial).indexOf('identity.area_incomplete_tenant_area') !== -1,
     'D8 with a caveat explaining the null');
  is(/not substituted/.test(
       partial.caveats.find(c => c.code === 'identity.area_incomplete_tenant_area').message),
     'D9 which says the `|| sqft` fallback is gone from this layer');
  // The old rule returned 500/1000 = 50% here by counting only what it had.
  is(JSON.stringify(partial.data.identity).indexOf('50') === -1,
     'D10 — measured: the number the old `|| 0` rule would have produced appears nowhere');

  // AND THE LIMIT OF THE FIX, MEASURED RATHER THAN CLAIMED AWAY.
  //
  // PropertyArea never substitutes sqft for leased_sqft. But tenant-normalize.js
  // resolves `leased_sqft ?? leasedSqft ?? sqft` before the record is built, so a
  // tenant whose demised area was never recorded reaches this layer already
  // carrying its rentable figure under the leased name. Nothing downstream can
  // see that this happened.
  //
  // This is asserted as it IS, not as it should be: M7 fixed the layer it owns
  // and the units declaration says the guarantee is `convention` because of
  // this. Changing the tenant normaliser is a change to what a tenant record IS,
  // on every write path in the product, and it is not a coherence change.
  const viaNorm = await MCP.call('get_property', { propertyId: PROP }, ctx({
    sbFetch: db({ blob: blob({ tenants: [TENANTS[0],
      { id: T2, tenant_name: 'Northside Hardware', sqft: 300, lease_type: 'NNN' }] }) }) }));
  eq(viaNorm.data.identity.leasedSqft, 800,
     'D10a a tenant carrying only `sqft` still reaches this layer as leased area — ' +
     'the substitution is upstream, in tenant-normalize.js');
  eq(viaNorm.provenance.units['identity.leasedSqft'].guarantee, 'convention',
     'D10b so the declared guarantee is `convention`, not `enforced`');
  is(/tenant-normalize\.js/.test(viaNorm.provenance.units['identity.leasedSqft'].note),
     'D10c and the note names the module that does it, rather than implying this ' +
     'layer has closed a hole it has not');

  // THE CLAMP. Tenant areas exceeding the property total is a contradiction.
  const over = await MCP.call('get_property', { propertyId: PROP }, ctx({
    sbFetch: db({ sqft: 500, blob: blob() }) }));   // 800 leased vs 500 total
  eq(over.data.identity.occupancy, null,
     'D11 leased > total yields null, NOT a clamped 100');
  eq(over.data.identity.leasedSqft, 800, 'D12 while the leased area itself is still reported');
  eq(over.data.identity.areaBasis.reason, 'exceeds_total', 'D13 with the contradiction named');
  is(codes(over).indexOf('identity.area_exceeds_total') !== -1, 'D14 and a caveat raised');
  is(/clamp/.test(over.caveats.find(c => c.code === 'identity.area_exceeds_total').message),
     'D15 which says exactly what the old behaviour did with this data');
  is(JSON.stringify(over.data.identity).indexOf('100') === -1,
     'D16 — measured: no 100 anywhere in identity');

  // The module, directly.
  eq(PA.occupancyPct({ tenants: [{ leased_sqft: 500 }], totalSqft: 1000 }).value, 50,
     'D17 half let is 50%');
  eq(PA.occupancyPct({ tenants: [], totalSqft: 1000 }).reason, 'no_tenants',
     'D18 no tenants is unknown, not 0% — an unreadable roster arrives this way too');
  eq(PA.occupancyPct({ tenants: [{ leased_sqft: 500 }] }).reason, 'no_total',
     'D19 no denominator is unknown');
  eq(PA.occupancyPct({ tenants: [{ leased_sqft: -5 }], totalSqft: 100 }).reason, 'negative_area',
     'D20 a negative area yields no total at all');
  eq(PA.leasedSqft({ tenants: [{ leased_sqft: 0 }, { leased_sqft: 100 }] }).value, 100,
     'D21 a genuine zero-area tenant counts as zero, not as missing');
  eq(PA.leasedSqft({ tenants: [{ leased_sqft: '250.5' }] }).value, 250.5,
     'D22 a numeric string parses');
  eq(PA.leasedSqft({ tenants: [{ leased_sqft: 'abc' }] }).reason, 'incomplete_tenant_area',
     'D23 while an unparseable one is missing, not zero');
  // The rule that was removed, asserted as removed.
  eq(PA.leasedSqft({ tenants: [{ sqft: 500 }] }).reason, 'incomplete_tenant_area',
     'D24 a tenant with only `sqft` and no `leased_sqft` is MISSING an area');
  is(!/\|\|\s*\w*\.?sqft/.test(INV.stripStringsAndComments(AREA_SRC).replace(/property\.sqft/g, '')),
     'D25 and the module contains no leased_sqft-to-sqft fallback at all');
  is(!/Math\.min\s*\(\s*100/.test(INV.stripStringsAndComments(AREA_SRC)),
     'D26 nor the clamp');
}

// ── E. Which store an answer came out of ───────────────────────────────────
sec('E. Every response names the store it read');
{
  const cases = [
    ['list_properties',    {}, 'ROW'],
    ['get_property',       {}, 'BLOB'],
    ['get_tenant',         { tenantId: T1 }, 'BLOB'],
    ['get_space',          { spaceId: T1 }, 'BLOB'],
    ['get_timeline',       {}, 'BLOB'],
    ['get_disputes',       {}, 'BLOB'],
    ['get_cam_status',     {}, 'BLOB'],
    ['get_attention',      {}, 'BLOB'],
    ['get_lease_evidence', { tenantId: T1 }, 'TABLE'],
  ];
  for (const [name, extra, kind] of cases) {
    const r = await MCP.call(name, Object.assign({ propertyId: PROP }, extra), ctx());
    is(typeof r.provenance.store === 'string' && r.provenance.store.length > 10,
       'E1.' + name + ' states its store');
    is(r.provenance.store.indexOf(MCP.STORE[kind].slice(0, 20)) === 0,
       'E2.' + name + ' and it is the ' + kind + ' store');
  }

  // The blob wording has to carry the fact that makes it matter.
  is(/normalised tables were NOT read/.test(MCP.STORE.BLOB),
     'E3 the blob store says the normalised tables were not consulted');
  is(/not reconciled/.test(MCP.STORE.BLOB),
     'E4 and that nothing reconciles the two — the duplication is disclosed, not implied');
  is(/tenant_field_evidence/.test(
       (await MCP.call('get_lease_evidence', { propertyId: PROP, tenantId: T1 }, ctx()))
         .provenance.store),
     'E5 the one table-backed capability names its table');

  // get_cam_status keeps its stronger, prose statement as well.
  const cam = await MCP.call('get_cam_status', { propertyId: PROP }, ctx());
  is(codes(cam).indexOf('cam.snapshot_scope') !== -1,
     'E6 and CAM still carries its own scope caveat as well as the structured field');
}

// ── F. M7 changed no CAM data and added no capability ──────────────────────
sec('F. A coherence phase, not a capability phase');
{
  eq(MCP.TOOLS.map(t => t.name),
     ['list_properties', 'get_property', 'get_tenant', 'get_lease_evidence',
      'get_space', 'get_timeline', 'get_disputes', 'get_cam_status', 'get_attention'],
     'F1 the same nine capabilities — M7 added none');

  // The CAM gate is untouched: a legacy pilot-shaped row still withholds.
  const legacy = blob({ camReconciliation: { camYear: 2025, total: 12000, results: [
    { tenantId: T1, tenantName: 'Acme Coffee LLC', totalAllocated: 6000, actualCam: 6000,
      expectedCam: 5, variance: 5995 }] } });
  const cam = await MCP.call('get_cam_status', { propertyId: PROP },
                             ctx({ sbFetch: db({ blob: legacy }) }));
  eq(cam.data.results[0].expectedCam, null, 'F2 the expected-CAM gate is unchanged');
  eq(cam.data.results[0].expectedCamTrust, 'unstamped_value_withheld', 'F3 with the same trust label');
  eq(JSON.stringify(legacy.camReconciliation.results[0].expectedCam), '5',
     'F4 and the stored row is untouched — M7 repaired no CAM data');

  // Read-only still.
  let threw = null;
  try { await MCP._readOnly(async () => ({}))('/x', { method: 'POST' }); }
  catch (e) { threw = e.message; }
  is(threw && /refused a POST/.test(threw), 'F5 writes are still refused');
  const execMcp = INV.stripStringsAndComments(
    fs.readFileSync(require.resolve('./api/_mcp-capabilities.js'), 'utf8'));
  is(!/method:\s*'(POST|PATCH|PUT|DELETE)'/.test(execMcp), 'F6 and none is issued anywhere');

  // The shim grew by exactly one reviewed name.
  DEPS.load();
  eq(DEPS.shimKeys(), ['DisputeStatus', 'LeaseIntelligence', 'PropertyReference',
                       'PropertyWorkspace', 'TenantSpace'],
     'F7 the shim holds the reviewed set, and DisputeStatus is actually IN it');
  // shimKeys() reports what is IN the shim; SHIM_KEYS is what the allow-list
  // PERMITS. Widening the declaration is the change that matters, and it would
  // not show up in the first list until something tried to write the name — so
  // the declaration is pinned as well.
  eq(DEPS.SHIM_KEYS.slice().sort(),
     ['DisputeStatus', 'LeaseIntelligence', 'PropertyReference', 'PropertyWorkspace', 'TenantSpace'],
     'F8 the declared allow-list permits exactly the reviewed names');
  is(DEPS.SHIM_KEYS.indexOf('Selectors') === -1,
     'F8a Selectors is not permitted, so the prune still removes it and the seal still refuses it');
  eq(DEPS._pruneToAllowList({ Selectors: {}, DisputeStatus: {}, whatever: 1 }).sort(),
     ['Selectors', 'whatever'],
     'F8b — measured: the prune removes what is outside the list and keeps what is on it');
  eq(DEPS.leakedWindow(), false, 'F9 and no window is left behind');
}

console.log('\n\x1b[1mRESULT: ' + pass + ' passed, ' + fail + ' failed\x1b[0m');
process.exit(fail ? 1 : 0);

})().catch(e => { console.error(e); process.exit(1); });
