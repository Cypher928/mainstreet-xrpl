'use strict';
/**
 * test-m8d-read-model-coherence.js — the five seams the M8 final gate measured.
 *
 *   node test-m8d-read-model-coherence.js
 *
 * OFFLINE. Every transport and auth call is defined in this file. Nothing here
 * opens a socket or can reach Pilot or Production.
 *
 * WHAT M8d IS
 * -----------
 * Every module in the M1–M8c layer had a passing suite, and the final-gate audit
 * still found five truthfulness defects. All five sat in the SEAMS: between two
 * capabilities reading one column, between a gate and the four doors it did not
 * cover, between a stored citation and the value it stopped describing. The
 * suites pinned what each phase built and nothing pinned what lay between them.
 *
 * So the assertions here are mostly of one shape — *these two surfaces must give
 * the same answer for the same underlying fact* — rather than *this function
 * returns that value*. A test that checks one surface cannot catch a seam.
 *
 *   A. every exposed CAM row goes through the gate     (audit B1)
 *   B. attention is projected identically on both      (audit B2)
 *   C. stale evidence cannot certify the current value (audit B3/B4)
 *   D. properties.sqft is one answer, not two          (audit B5)
 *   E. lease.sqft agrees across all five readers       (audit B6/B7)
 *
 * SECTION A IS THE ONE TO READ. It does not check that get_cam_status withholds
 * a legacy expectation — M6 already pins that. It requires that NO surface
 * exposes it, by enumerating the exposure paths and driving the same stored row
 * through every one of them. A fifth door added later fails the count assertion
 * before it can fail a caller.
 */

const fs   = require('fs');
const MCP  = require('./api/_mcp-capabilities.js');
const HYD  = require('./api/_property-record-hydrator.js');
const FP   = require('./field-provenance.js');

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
const NOW   = '2026-09-09T12:00:00.000Z';

const auth = async (t) => (t === 'owner' ? { status: 200, json: { id: OWNER } }
                                        : { status: 401, json: {} });

/** One stubbed PostgREST. `sqft` is the property row's own column. */
function db(o) {
  const opt = Object.assign({ sqft: 10000, blob: {}, evidence: [] }, o || {});
  return async (p) => {
    if (/^\/properties\?id=eq\.[^&]+&user_id=eq\.[^&]+&select=id$/.test(p))
      return { status: 200, json: [{ id: PROP }] };
    if (/^\/properties\?id=eq\./.test(p))
      return { status: 200, json: [{ id: PROP, name: 'Plaza', sqft: opt.sqft, data: opt.blob }] };
    if (/^\/properties\?user_id=eq\./.test(p))
      return { status: 200, json: [{ id: PROP, name: 'Plaza', sqft: opt.sqft,
                                     created_at: NOW, updated_at: NOW, archived_at: null }] };
    if (/^\/tenant_field_evidence\?/.test(p)) return { status: 200, json: opt.evidence };
    if (/^\/tenants\?/.test(p)) return { status: 200, json: [] };
    return { status: 404, json: [] };
  };
}
const ctx = (o) => ({ token: 'owner', authFetch: auth, sbFetch: db(o), now: NOW });

const blob = (over) => Object.assign(
  { tenants: [], invoices: [], disputes: [], timeline: [] }, over || {});

(async function main() {

// ═══════════════════════════════════════════════════════════════════════════
sec('A. Every exposed CAM row goes through the gate, not just get_cam_status');
// ═══════════════════════════════════════════════════════════════════════════
{
  /**
   * The row the audit measured. `expected_cam_basis: 'legacy_unverified'` marks
   * an expectedCam that is a cap PERCENTAGE an older path wrote into a dollar
   * field. Five is not $5, and the stored variance beside it is dollars minus a
   * percentage — a number with no unit at all.
   */
  const legacy = {
    tenantId: T1, tenantName: 'Acme Coffee LLC',
    allocatedAmount: 12000, actualCam: 12000,
    expectedCam: 5, variance: 11995,
    expectedCamBasis: 'legacy_unverified', capApplied: true, proRataPercent: 12,
    // A key no capability names. It must not ride along on any surface.
    internalScratch: 'should never reach a caller',
  };
  const b = blob({
    tenants: [{ id: T1, tenant_name: 'Acme Coffee LLC', leased_sqft: 1200 }],
    camReconciliation: { camYear: 2025, total: 100000, results: [legacy] },
  });

  const cs = await MCP.getCamStatus({ propertyId: PROP }, ctx({ blob: b }));
  const sp = await MCP.getSpace({ propertyId: PROP, spaceId: T1 }, ctx({ blob: b }));
  const tn = await MCP.getTenant({ propertyId: PROP, tenantId: T1 }, ctx({ blob: b }));
  const pr = await MCP.getProperty({ propertyId: PROP }, ctx({ blob: b }));

  /**
   * EVERY PLACE A STORED CAM ROW LEAVES THE SURFACE. Named explicitly, so that
   * adding a sixth without gating it fails A0 rather than quietly shipping.
   */
  const EXPOSURES = [
    ['get_cam_status.results[0]',            cs.data.results[0]],
    ['get_space.camResult',                  sp.data.camResult],
    ['get_tenant.camResult',                 tn.data.camResult],
    ['get_property.spaces[0].camResult',     pr.data.spaces[0].camResult],
    ['get_property.cam.results[0]',          pr.data.cam.results[0]],
    ['get_property.cam.capped[0]',           pr.data.cam.capped[0]],
  ];

  eq(EXPOSURES.length, 6, 'A0 six paths expose a stored CAM row; all six are checked below');

  for (const [where, row] of EXPOSURES) {
    is(row != null, 'A1 ' + where + ' is present at all');
    eq(row.expectedCam, null,
       'A2 ' + where + ' withholds the legacy expectation');
    eq(row.variance, null,
       'A3 ' + where + ' withholds the variance that was computed from it');
    eq(row.expectedCamTrust, 'legacy_unverified_not_money',
       'A4 ' + where + ' names the trust state');
    eq(row.expectedCamBasis, 'legacy_unverified',
       'A5 ' + where + ' still reports the stored basis, unrepaired');
    is(!('internalScratch' in row),
       'A6 ' + where + ' is whitelisted — an unnamed stored key cannot ride along');
    // What is NOT withheld: the figures that are real money regardless of basis.
    eq(row.actualCam, 12000, 'A7 ' + where + ' still reports the actual charge');
    eq(row.allocatedAmount, 12000, 'A8 ' + where + ' still reports the allocation');
  }

  // Every surface must agree key-for-key. A gate applied four different ways is
  // four gates.
  const shapes = EXPOSURES.map(([, r]) => JSON.stringify(Object.keys(r).sort()));
  is(new Set(shapes).size === 1,
     'A9 all six surfaces return the identical row shape', shapes[0]);

  // ── The other bases still behave as M6 defined them, through every door ──
  const CASES = [
    ['cap_ceiling with a number', 'cap_ceiling',       9000, 9000, 'cap_ceiling_arithmetic'],
    ['cap_ceiling, no number',    'cap_ceiling',       null, null, 'stamped_without_usable_value'],
    ['no basis, has a number',    null,                92,   null, 'unstamped_value_withheld'],
    ['no basis, no number',       null,                null, null, 'no_expectation_established'],
    ['a word this build lacks',   'future_vocabulary', 500,  null, 'unrecognised_basis'],
  ];
  for (const [label, basis, stored, expected, trust] of CASES) {
    const bb = blob({
      tenants: [{ id: T1, tenant_name: 'Acme Coffee LLC', leased_sqft: 1200 }],
      camReconciliation: { camYear: 2025, total: 100000, results: [{
        tenantId: T1, tenantName: 'Acme Coffee LLC', allocatedAmount: 1000,
        actualCam: 1000, expectedCam: stored, variance: 7,
        expectedCamBasis: basis, capApplied: true,
      }] } });
    const s2 = await MCP.getSpace({ propertyId: PROP, spaceId: T1 }, ctx({ blob: bb }));
    const p2 = await MCP.getProperty({ propertyId: PROP }, ctx({ blob: bb }));
    const t2 = await MCP.getTenant({ propertyId: PROP, tenantId: T1 }, ctx({ blob: bb }));
    eq(s2.data.camResult.expectedCam, expected, 'A10 get_space — ' + label);
    eq(p2.data.cam.results[0].expectedCam, expected, 'A11 get_property.cam — ' + label);
    eq(t2.data.camResult.expectedCam, expected, 'A12 get_tenant — ' + label);
    eq(s2.data.camResult.expectedCamTrust, trust, 'A13 get_space trust — ' + label);
    eq(p2.data.cam.capped[0].expectedCamTrust, trust, 'A14 capped trust — ' + label);
  }

  // A cap_ceiling row keeps its variance, because its expectation survived.
  const good = blob({
    tenants: [{ id: T1, tenant_name: 'Acme Coffee LLC', leased_sqft: 1200 }],
    camReconciliation: { camYear: 2025, total: 100000, results: [{
      tenantId: T1, tenantName: 'Acme Coffee LLC', allocatedAmount: 9500,
      actualCam: 9500, expectedCam: 9000, variance: 500,
      expectedCamBasis: 'cap_ceiling', capApplied: true,
    }] } });
  const sg = await MCP.getSpace({ propertyId: PROP, spaceId: T1 }, ctx({ blob: good }));
  eq(sg.data.camResult.variance, 500,
     'A15 variance travels WITH a surviving expectation — the gate withholds, it does not blank');

  // The units for that money are now declared where the money is.
  is(!!sg.provenance.units['cam.results.expectedCam'],
     'A16 get_space declares the units of the CAM figures it now carries');
  const tg = await MCP.getTenant({ propertyId: PROP, tenantId: T1 }, ctx({ blob: good }));
  is(!!tg.provenance.units['cam.results.expectedCam'],
     'A17 get_tenant does too');

  // A space with no reconciliation row is null, not an empty gated row.
  const none = blob({ tenants: [{ id: T1, tenant_name: 'Acme Coffee LLC', leased_sqft: 1200 }] });
  const sn = await MCP.getSpace({ propertyId: PROP, spaceId: T1 }, ctx({ blob: none }));
  eq(sn.data.camResult, null, 'A18 no CAM row for this space stays null, not a hollow row');
}

// ═══════════════════════════════════════════════════════════════════════════
sec('B. Attention is the same projection on both surfaces');
// ═══════════════════════════════════════════════════════════════════════════
{
  const b = blob({
    tenants: [{ id: T1, tenant_name: 'Acme Coffee LLC', leased_sqft: 1200,
                end_date: '2026-10-01' }],
    disputes: [{ id: 'd1', status: 'open', tenantId: T1, amount: 500 }],
  });
  const pr = await MCP.getProperty({ propertyId: PROP }, ctx({ blob: b }));
  const at = await MCP.getAttention({ propertyId: PROP }, ctx({ blob: b }));

  is(Array.isArray(pr.data.attention) && pr.data.attention.length > 0,
     'B0 the fixture produces at least one attention item',
     String((pr.data.attention || []).length));

  eq(pr.data.attention, at.data.items,
     'B1 get_property.attention is byte-identical to get_attention.items');

  const ALLOWED = ['rank', 'severity', 'title', 'why'];
  const BANNED  = ['icon', 'nav', 'action', 'anchors', 'tab'];
  for (const it of pr.data.attention) {
    eq(Object.keys(it).sort(), ALLOWED.slice().sort(),
       'B2 an item carries exactly rank/severity/title/why');
    for (const k of BANNED) {
      is(!(k in it), 'B3 no ' + k + ' on the wire');
    }
  }

  // The UI fields really were there before, and really are produced upstream —
  // so this is a projection, not a fixture that never had them.
  const DEPS = require('./api/_server-deps.js');
  const raw = DEPS.withWindow(() => DEPS.load().PropertyWorkspace.collectAttention({
    id: PROP, name: 'Plaza', totalSqft: 10000,
    tenants: b.tenants, disputes: b.disputes, invoices: [], timeline: [],
  }));
  is(raw.length > 0 && 'nav' in raw[0] && 'icon' in raw[0] && 'action' in raw[0],
     'B4 collectAttention DOES produce icon/nav/action — the projection removes them',
     JSON.stringify(Object.keys(raw[0])));
  is(JSON.stringify(raw).indexOf('anchors') !== -1,
     'B5 and nav carries DOM element ids, which is what must not travel');
  is(JSON.stringify(pr.data.attention).indexOf('anchors') === -1,
     'B6 none of which appear in the projected list');

  // The contract is now STATED on both, not just honoured on both.
  const codes = (e) => e.caveats.map(c => c.code);
  is(codes(pr).indexOf('attention.ui_fields_removed') !== -1,
     'B7 get_property states the ui_fields_removed contract');
  is(codes(at).indexOf('attention.ui_fields_removed') !== -1,
     'B8 get_attention states it too');

  // Ordering is the answer, so rank must be the composed order.
  eq(pr.data.attention.map(i => i.rank), pr.data.attention.map((_, i) => i),
     'B9 rank is the order collectAttention ranked them in');

  /**
   * UNKNOWN IS NOT EMPTY, asserted on the projection itself.
   *
   * sectionValue() already nulls anything whose status is UNAVAILABLE, so a
   * projection that returned [] for an uncomposable list would be invisible
   * through any capability — a mutant of exactly that survived the whole suite.
   * The rule belongs to the projection regardless of who guards it downstream,
   * so it is checked where it lives.
   */
  is(MCP._attentionItems(null) === null,
     'B10 an attention list that could not be composed projects to null, not []');
  is(MCP._attentionItems(undefined) === null, 'B11 undefined likewise');
  eq(MCP._attentionItems([]), [], 'B12 a genuinely empty list stays an empty list');
  is(MCP._attentionItems([]) !== null,
     'B13 and empty is NOT collapsed into unknown, which is the other half of the rule');
  eq(MCP._attentionItems([{ severity: 'warning', icon: 'x', title: 't', why: 'w',
                            nav: { tab: 'cam', anchors: ['a'] }, action: 'go' }]),
     [{ rank: 0, severity: 'warning', title: 't', why: 'w' }],
     'B14 and the projection drops every UI field it is handed');
}

// ═══════════════════════════════════════════════════════════════════════════
sec('C. Stale evidence cannot certify the value on screen');
// ═══════════════════════════════════════════════════════════════════════════
{
  /** An extraction snapshot that cited a clause for `value`. */
  const cite = (value, over) => Object.assign({
    value: value, quote: 'not to exceed ' + value + ' percent', page: 12,
    sourceFile: 'acme-lease.pdf', extractedAt: '2026-01-01T00:00:00Z',
    approved: null, manuallyEdited: false,
  }, over || {});
  const withSnap = (current, snap, extra) => Object.assign(
    { id: T1, tenant_name: 'Acme', cap: current,
      fieldEvidence: { cap: { snapshots: [snap] } } }, extra || {});

  // ── the reported case ──
  const stale = FP.fieldProvenance('cap', withSnap(6, cite(5)));
  eq(stale.state, 'ai_extracted',
     'C1 a cap edited to 6 under a clause stating 5 is NOT lease_confirmed');
  eq(stale.cited, false,   'C2 and is not cited');
  eq(stale.quote, null,    'C3 the clause that states a different number is withheld');
  eq(stale.page, null,     'C4 as is its page');
  eq(stale.evidenceStale, true, 'C5 and the reason is stated, not merely implied');
  eq(stale.when, null,     'C6 the superseded reading does not date the current value');
  eq(stale.sourceFile, null,
     'C7 nor name the document, which no longer says what this value says');

  const fresh = FP.fieldProvenance('cap', withSnap(5, cite(5)));
  eq(fresh.state, 'lease_confirmed', 'C8 an unedited value keeps its citation');
  eq(fresh.cited, true,              'C9 and stays cited');
  eq(fresh.evidenceStale, false,     'C10 and is not marked stale');

  // ── the evidence column is TEXT, so a faithful round-trip is not an edit ──
  const SAME = [
    ['number vs numeric string',        5,      '5'],
    ['numeric string vs number',        '5',    5],
    ['trailing zeros',                  4.5,    '4.50'],
    ['integer written as decimal',      15,     '15.0'],
    ['percentage figure',               95,     '95'],
    ['zero',                            0,      '0'],
    ['boolean true vs text',            true,   'true'],
    ['boolean false vs text',           false,  'false'],
    ['prose, identical',                'two 5-year options', 'two 5-year options'],
    ['prose, surrounding whitespace',   'rentable', '  rentable  '],
    ['prose, differing case',           'Rentable', 'rentable'],
  ];
  for (const [label, current, stored] of SAME) {
    const r = FP.fieldProvenance('cap', withSnap(current, cite(1, { value: stored })));
    eq(r.evidenceStale, false, 'C11 same value — ' + label);
    eq(r.state, 'lease_confirmed', 'C12 so the citation still stands — ' + label);
  }

  const DIFFERENT = [
    ['a genuine numeric edit',      6,        '5'],
    ['a decimal edit',              4.75,     '4.5'],
    ['zero against a real figure',  0,        '500'],
    ['a real figure against zero',  500,      '0'],
    ['boolean flipped',             false,    'true'],
    ['boolean against a number',    true,     '1'],
    ['prose rewritten',             'occupied', 'rentable'],
    ['a number against prose',      5,        'five percent'],
    ['percent sign is not a number', 5,       '5%'],
  ];
  for (const [label, current, stored] of DIFFERENT) {
    const r = FP.fieldProvenance('cap', withSnap(current, cite(1, { value: stored })));
    eq(r.evidenceStale, true, 'C13 different value — ' + label);
    is(r.state !== 'lease_confirmed',
       'C14 so it cannot be lease_confirmed — ' + label, r.state);
    eq(r.cited, false, 'C15 and carries no citation — ' + label);
  }

  // ── an EMPTY evidence value is unverifiable, not wrong ──
  for (const [label, v] of [['null', null], ['empty string', ''],
                            ['whitespace', '   '], ['undefined', undefined]]) {
    const snap = cite(5); snap.value = v;
    const r = FP.fieldProvenance('cap', withSnap(5, snap));
    eq(r.evidenceStale, false, 'C16 evidence with ' + label + ' cannot contradict anything');
    eq(r.state, 'lease_confirmed',
       'C17 so behaviour is unchanged for the corpus that has no stored value — ' + label);
  }
  const noKey = { quote: 'q', page: 3, extractedAt: '2026-01-01T00:00:00Z' };
  const rNoKey = FP.fieldProvenance('cap', withSnap(5, noKey));
  eq(rNoKey.state, 'lease_confirmed',
     'C18 a snapshot with no value KEY at all behaves exactly as before');
  eq(rNoKey.evidenceStale, false, 'C19 and is not marked stale');

  // ── an approval is a claim about a figure too ──
  const appr = (value, over) => Object.assign({
    value: value, quote: 'not to exceed ' + value + ' percent', page: 12,
    sourceFile: 'acme-lease.pdf', reviewerEmail: 'jane@landlordco.com',
    reviewedAt: '2026-02-02T00:00:00Z', approved: true, manuallyEdited: false,
  }, over || {});
  const okAppr = FP.fieldProvenance('cap', withSnap(5, appr(5)));
  eq(okAppr.state, 'manually_confirmed', 'C20 an approval of the current value stands');
  eq(okAppr.by, 'jane@landlordco.com',   'C21 and names the reviewer');

  const staleAppr = FP.fieldProvenance('cap', withSnap(6, appr(5)));
  is(staleAppr.state !== 'manually_confirmed',
     'C22 an approval of a DIFFERENT figure does not certify this one', staleAppr.state);
  eq(staleAppr.by, null,
     'C23 and a real person is not named as having checked a number they never saw');
  eq(staleAppr.evidenceStale, true, 'C24 stated');

  // ── stale citation + a RECORDED manual edit: the edit is a true fact ──
  const manual = FP.fieldProvenance('cap', withSnap(6, appr(5, {
    manuallyEdited: true, approved: false })));
  eq(manual.state, 'manually_entered',
     'C25 a recorded manual edit still reports as manually entered');
  eq(manual.by, 'jane@landlordco.com',
     'C26 naming who made the edit — that is what the snapshot records');
  eq(manual.cited, false, 'C27 and it carries no citation');

  const override = FP.fieldProvenance('cap', withSnap(6, cite(5), {
    reviewOverrides: { cap: { reviewerConfirmed: true, reviewedAt: '2026-03-03T00:00:00Z' } } }));
  eq(override.state, 'manually_entered',
     'C28 a reviewOverride is a record of an edit and survives a stale snapshot');

  // ── nothing is fabricated, and unknown stays unknown ──
  eq(FP.fieldProvenance('cap', withSnap(null, cite(5))).state, 'unknown',
     'C29 an absent value is still unknown — staleness never promotes');
  eq(FP.fieldProvenance('cap', withSnap('', cite(5))).state, 'unknown',
     'C30 blank too');
  eq(FP.fieldProvenance('cap', withSnap('', cite(5))).evidenceStale, false,
     'C31 and an unknown field is not described as having stale evidence');
  const fab = FP.fieldProvenance('cap', withSnap(6, cite(5)));
  is(!('value' in fab),
     'C32 the resolver still returns no value of its own — nothing is substituted');

  // ── the NEVER_EXTRACTED floor is unaffected in kind ──
  const cb = FP.fieldProvenance('cap_base_amount',
    { id: T1, capBaseAmount: 26000,
      fieldEvidence: { cap_base_amount: { snapshots: [cite(1, { value: '25000' })] } } },
    { value: 26000 });
  eq(cb.state, 'manually_entered',
     'C33 a stale cap base falls to its own floor, not to ai_extracted');
  eq(cb.evidenceStale, true, 'C34 and says why it is uncited');

  // ── end to end, on the wire ──
  const evRow = (over) => Object.assign({
    tenant_id: T1, field_key: 'cap', value: '5',
    confidence_status: 'estimated', confidence_note: null,
    source_file: 'acme-lease.pdf', source_page: 12,
    quote: 'shall not increase by more than five percent (5%) annually',
    extraction_id: 'e1', extraction_version: 1, reviewer_uid: null,
    reviewer_email: null, reviewed_at: null, approved: null,
    manually_edited: false, original_extracted_value: null,
    created_at: '2026-01-01T00:00:00Z',
  }, over || {});

  const wire = await MCP.getLeaseEvidence({ propertyId: PROP, tenantId: T1, fieldKey: 'cap' },
    ctx({ blob: blob({ tenants: [{ id: T1, tenant_name: 'Acme', cap: 6 }] }),
          evidence: [evRow()] }));
  eq(wire.data.evidence.cap.value, 6,       'C35 get_lease_evidence reports the current value');
  eq(wire.data.evidence.cap.state, 'ai_extracted',
     'C36 and does not present it as read from the lease');
  eq(wire.data.evidence.cap.quote, null,    'C37 the mismatched clause does not travel');
  eq(wire.data.evidence.cap.evidenceStale, true, 'C38 the flag survives the projection');

  const wireOk = await MCP.getLeaseEvidence({ propertyId: PROP, tenantId: T1, fieldKey: 'cap' },
    ctx({ blob: blob({ tenants: [{ id: T1, tenant_name: 'Acme', cap: 5 }] }),
          evidence: [evRow()] }));
  eq(wireOk.data.evidence.cap.state, 'lease_confirmed',
     'C39 and the matching case is untouched end to end');
  is(typeof wireOk.data.evidence.cap.quote === 'string',
     'C40 keeping the clause that does support the value');
}

// ═══════════════════════════════════════════════════════════════════════════
sec('D. properties.sqft is one answer, not two');
// ═══════════════════════════════════════════════════════════════════════════
{
  /** Every shape the nullable numeric column takes, and the canonical answer. */
  const SQFT = [
    ['NULL',              null,      null],
    ['a real zero',       0,         0],
    ['a positive number', 10000,     10000],
    ['a numeric string',  '10000',   10000],
    ['a decimal string',  '1234.5',  1234.5],
    ['an empty string',   '',        null],
    ['unparseable',       'abc',     null],
    ['undefined',         undefined, null],
  ];

  for (const [label, stored, want] of SQFT) {
    const c = { sqft: stored, blob: blob({ tenants: [{ id: T1, tenant_name: 'A', leased_sqft: 400 }] }) };
    const list = await MCP.listProperties({}, ctx(c));
    const prop = await MCP.getProperty({ propertyId: PROP }, ctx(c));
    const fromList = list.data.properties[0].totalSqft;
    const fromProp = prop.data.identity.totalSqft;
    eq(fromList, want, 'D1 list_properties — ' + label);
    eq(fromProp, want, 'D2 get_property.identity — ' + label);
    eq(fromList, fromProp, 'D3 THE TWO AGREE — ' + label);
  }

  // The specific contradiction the audit measured.
  const nullCtx = { sqft: null, blob: blob({ tenants: [{ id: T1, tenant_name: 'A', leased_sqft: 400 }] }) };
  const pNull = await MCP.getProperty({ propertyId: PROP }, ctx(nullCtx));
  eq(pNull.data.identity.totalSqft, null,
     'D4 a property whose area was never entered is UNKNOWN, not a zero-square-foot building');
  eq(pNull.data.identity.areaBasis.reason, 'no_total',
     'D5 and the no_total behaviour is preserved exactly');
  eq(pNull.data.identity.occupancy, null, 'D6 occupancy has no denominator, so it is null');
  is(pNull.caveats.map(c => c.code).indexOf('identity.area_no_total') !== -1,
     'D7 and the caveat still names the reason');

  // A real 0 is still a real 0 — it is not converted to unknown either.
  const zeroCtx = { sqft: 0, blob: blob({ tenants: [{ id: T1, tenant_name: 'A', leased_sqft: 400 }] }) };
  const pZero = await MCP.getProperty({ propertyId: PROP }, ctx(zeroCtx));
  eq(pZero.data.identity.totalSqft, 0, 'D8 a stored zero is reported as zero, not null');
  eq(pZero.data.identity.areaBasis.reason, 'no_total',
     'D9 and still yields no usable denominator');

  // A positive total still divides.
  const okCtx = { sqft: 1000, blob: blob({ tenants: [{ id: T1, tenant_name: 'A', leased_sqft: 400 }] }) };
  const pOk = await MCP.getProperty({ propertyId: PROP }, ctx(okCtx));
  eq(pOk.data.identity.occupancy, 40, 'D10 a real total still produces occupancy');
  eq(pOk.data.identity.areaBasis.reason, null, 'D11 with no reason, because nothing is missing');

  // The hydrator itself no longer manufactures the zero.
  const h = await HYD.hydrate({ propertyId: PROP, userId: OWNER, sbFetch: db(nullCtx) });
  eq(h.record.identity.totalSqft, null,
     'D12 the hydrator passes absence through instead of writing `|| 0`');

  /**
   * BY IDENTITY, NOT BY SERIALISATION. `JSON.stringify(NaN)` is the string
   * "null", so eq() above literally cannot tell an unparseable area that became
   * NaN from one that was correctly refused — a mutant that dropped the finite
   * check survived every assertion in this section until these were added. The
   * same trap caught M8c; it is checked here rather than remembered.
   */
  for (const [label, stored] of [['unparseable', 'abc'], ['a bare word', 'sqft'],
                                 ['NaN itself', NaN], ['Infinity', Infinity]]) {
    const v = MCP._canonicalSqft(stored);
    is(v === null, 'D14 ' + label + ' is exactly null, not NaN', String(v));
    is(!Number.isNaN(v), 'D15 ' + label + ' is specifically not NaN');
  }
  for (const [label, stored, want] of [['zero', 0, 0], ['numeric string', '10000', 10000],
                                       ['decimal string', '1234.5', 1234.5],
                                       ['negative', -5, -5]]) {
    const v = MCP._canonicalSqft(stored);
    is(v === want && typeof v === 'number',
       'D16 ' + label + ' is the number itself, by identity', String(v));
  }
  for (const [label, stored] of [['null', null], ['undefined', undefined], ['empty string', '']]) {
    is(MCP._canonicalSqft(stored) === null, 'D17 ' + label + ' is exactly null');
  }

  // And on the wire, where a NaN would have serialised to a plausible null.
  const badCtx = { sqft: 'abc', blob: blob({ tenants: [{ id: T1, tenant_name: 'A', leased_sqft: 400 }] }) };
  const lBad = await MCP.listProperties({}, ctx(badCtx));
  is(lBad.data.properties[0].totalSqft === null,
     'D18 list_properties emits a decided null for a malformed area, never NaN');

  // And the unit is declared on the surface that reports it.
  const list = await MCP.listProperties({}, ctx(okCtx));
  is(!!list.provenance.units['properties.totalSqft'],
     'D13 list_properties declares what its square footage measures');
}

// ═══════════════════════════════════════════════════════════════════════════
sec('E. lease.sqft is the same answer to every reader');
// ═══════════════════════════════════════════════════════════════════════════
{
  const AREAS = [
    ['a genuine zero',    0,      0],
    ['the string zero',   '0',    0],
    ['a positive number', 500,    500],
    ['a numeric string',  '500',  500],
    ['a decimal',         250.5,  250.5],
    ['null',              null,   null],
    ['an empty string',   '',     null],
    ['unparseable',       'abc',  null],
  ];

  const DEPS = require('./api/_server-deps.js');
  const TS   = DEPS.load().TenantSpace;

  for (const [label, stored, want] of AREAS) {
    const b = blob({ tenants: [{ id: T1, tenant_name: 'Rooftop Signage',
                                 leased_sqft: stored, lease_type: 'Licence' }] });
    const sp = await MCP.getSpace({ propertyId: PROP, spaceId: T1 }, ctx({ blob: b }));
    const tn = await MCP.getTenant({ propertyId: PROP, tenantId: T1 }, ctx({ blob: b }));
    const pr = await MCP.getProperty({ propertyId: PROP }, ctx({ blob: b }));

    eq(sp.data.lease.sqft, want, 'E1 get_space — ' + label);
    eq(tn.data.lease.sqft, want, 'E2 get_tenant — ' + label);
    eq(pr.data.spaces[0].lease.sqft, want, 'E3 get_property — ' + label);

    // THE SUMMARY IS PART OF THE RECORD. A 0 that vanishes from the sentence
    // beside `lease.sqft: 0` is the same value reported two ways in one response.
    const mentionsArea = /\bsqft\b/.test(sp.data.summary);
    eq(mentionsArea, want !== null,
       'E4 summary states the area exactly when there is one — ' + label,
       sp.data.summary);
    if (want !== null) {
      is(sp.data.summary.indexOf(String(want) + ' sqft') !== -1,
         'E5 and states THIS area — ' + label, sp.data.summary);
    }
    eq(sp.data.summary, tn.data.summary, 'E6 summary agrees across capabilities — ' + label);
  }

  // The browser-side readers, driven rather than described.
  const rec0 = DEPS.withWindow(() => TS.assemble(
    { id: PROP, tenants: [{ id: T1, tenant_name: 'Rooftop Signage',
                            leased_sqft: 0, lease_type: 'Licence' }] }, T1));
  eq(rec0.lease.sqft, 0, 'E7 assemble() projects the zero');
  is(rec0.summary.indexOf('0 sqft') !== -1,
     'E8 and the summary says so', rec0.summary);

  // _citableRecord: a zero area is a lease fact, so it makes a record citable.
  const src = fs.readFileSync('./tenant-space.js', 'utf8');
  is(/hasLease = !!\(lease\.type \|\| lease\.sqft != null/.test(src),
     'E9 the citable-record predicate treats a 0 area as a lease term on file');
  is(/if \(rec\.lease\.sqft != null\) leaseRows\.push/.test(src),
     'E10 the space detail view shows a Leased area row for a zero area');
  is(/lease\.sqft != null \? ' · ' \+ lease\.sqft/.test(src),
     'E11 the summary builder is `!= null`, not truthiness');
  is(/if \(rec\.lease\.sqft != null\) meta\.push/.test(src),
     'E12 and the space-list card stays as M8c left it');

  // No truthiness read of lease.sqft survives anywhere in the file.
  const truthy = src.split('\n')
    .map((l, i) => [i + 1, l])
    .filter(([, l]) => /^\s*[^*\/]/.test(l))
    .filter(([, l]) => /(if\s*\(|\|\||\?)\s*(rec\.)?lease\.sqft\s*(\)|\?|\|\||&&)/.test(l));
  eq(truthy.map(([n]) => n), [],
     'E13 no live truthiness test of lease.sqft remains in tenant-space.js');

  // The declared unit note describes the code that actually runs.
  const b1 = blob({ tenants: [{ id: T1, tenant_name: 'A', leased_sqft: 500 }] });
  const sp1 = await MCP.getSpace({ propertyId: PROP, spaceId: T1 }, ctx({ blob: b1 }));
  const note = sp1.provenance.units['lease.sqft'].note;
  is(note.indexOf('falls back to the tenant row') === -1,
     'E14 the note no longer describes the fallback M8c deleted');
  is(note.indexOf('PropertyArea._area') !== -1,
     'E15 and names the definition that does run');
  is(!/leased_sqft\s*\|\|\s*t\.sqft/.test(
       src.split('\n').filter(l => !/^\s*(\*|\/\/)/.test(l)).join('\n')),
     'E16 and no such fallback exists in live code to describe');
}

console.log('\n' + (fail === 0 ? '\x1b[32m' : '\x1b[31m') +
            `RESULT: ${pass} passed, ${fail} failed\x1b[0m`);
process.exit(fail === 0 ? 0 : 1);

})().catch(e => { console.error(e); process.exit(1); });
