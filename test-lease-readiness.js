'use strict';
/**
 * test-lease-readiness.js — "ready for CAM" must mean what it says.
 *
 *   node test-lease-readiness.js
 *
 * THE BUGS THIS EXISTS FOR
 *
 * 1. A lease with no square footage was counted as Ready and offered under
 *    "Approve all ready", on a screen whose own card read "Missing Sq Ft". The
 *    count consulted only whether extraction had finished, never whether the
 *    lease carried the fields CAM needs.
 *
 * 2. The fix for (1) wired the count to deriveTenantReviewState().missing —
 *    the whole set. That set includes nnn_cap_missing and audit_rights_unknown,
 *    which are review items, not reconciliation inputs. Every Triple Net lease
 *    without an explicit cap was then listed as "extracted but not ready for
 *    CAM ... cannot be reconciled until the missing values are entered" — on
 *    the same run in which the engine reconciled it. That is the same
 *    contradiction inverted, and the sentence is untrue.
 *
 * 3. The blocking set was derived as a SUBSET of MISSING_FIELD_TYPES, so it
 *    could only ever model blockers of the form "a required field is absent".
 *    An unconfirmed PROPERTY_NAME_MISMATCH is the opposite shape — a field is
 *    present and CONTRADICTS the property the lease was filed under — so it was
 *    invisible to the readiness model even though getValidTenants() has always
 *    excluded it. The screen said "2 leases will reconcile" and named Dover;
 *    the engine reconciled Paradigm alone and dropped Dover's $5,514.56.
 *
 *    This suite's own prose named that fourth condition while its assertion
 *    pinned the set to ['missing_sqft'], so the suite was green on the bug. The
 *    invariant is now asserted, not just described.
 *
 * THE RULE
 * getValidTenants() is the authority on what the CAM engine will reconcile:
 *
 *     tenant_name && leased_sqft > 0 && extraction succeeded
 *                 && no UNCONFIRMED property mismatch
 *
 * Only a condition in THAT filter may be described as blocking reconciliation.
 * Everything else is a review item and must be worded as one.
 */

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

let pass = 0, fail = 0;
const ok  = (m) => { console.log('  \x1b[32m✓\x1b[0m ' + m); pass++; };
const bad = (m, d) => { console.log('  \x1b[31m✗\x1b[0m ' + m + (d ? ' — ' + d : '')); fail++; };
const yes = (m, c, d) => c ? ok(m) : bad(m, d);
const eqj = (m, a, e) => JSON.stringify(a) === JSON.stringify(e)
  ? ok(`${m} → ${JSON.stringify(a)}`)
  : bad(m, `expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`);

// ── load ReviewEngine ────────────────────────────────────────────────────────
const box = { window: {}, console, Date, Math, Number, String, Array, JSON, RegExp, Set, Boolean };
box.globalThis = box;
vm.createContext(box);
// LeaseIntelligence first: review-engine reads window.LeaseIntelligence to ask
// whether a property mismatch has been confirmed, and FAILS CLOSED when it is
// absent. Loading it here means the confirmed case is exercised for real rather
// than passing because the module was missing.
vm.runInContext(fs.readFileSync(path.join(__dirname, 'lease-intelligence.js'), 'utf8'), box);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'review-engine.js'), 'utf8'), box);
const RE = box.window.ReviewEngine;
const LI = box.window.LeaseIntelligence;

const scriptCode = fs.readFileSync(path.join(__dirname, 'script.js'), 'utf8');
const engineCode = fs.readFileSync(path.join(__dirname, 'reconciliation-engine.js'), 'utf8');

// Mirror of script.js's deriveTenantReviewState post-processing, built from the
// engine's own exported sets so it cannot drift from them silently. The source
// assertions below check that script.js really computes it this way.
const derive = (t) => {
  const rv = RE.deriveTenantReviewState(t, []);
  const missing     = rv.warnings.filter(w => RE.MISSING_FIELD_TYPES.has(w.type)).map(w => w.label);
  const camBlocking = rv.warnings.filter(w => RE.CAM_BLOCKING_FIELD_TYPES.has(w.type))
    .map(w => RE.CAM_BLOCKER_REASON[w.type] || w.label);
  const reviewItems = rv.warnings
    .filter(w => RE.MISSING_FIELD_TYPES.has(w.type) && !RE.CAM_BLOCKING_FIELD_TYPES.has(w.type))
    .map(w => w.label);
  return { missing, camBlocking, reviewItems };
};

const NNN = 'Triple Net (NNN)';
const reconcilable = { tenant_name: 'Dover', leased_sqft: 8194, lease_type: NNN,
                       start_date: '2011-07-01', end_date: '2016-07-01', cap: null };
const noSqft       = { tenant_name: 'Guaranty State Bank', leased_sqft: null, lease_type: NNN,
                       start_date: '2020-01-01', end_date: '2030-01-01', cap: null };
const capped       = { tenant_name: 'Capped', leased_sqft: 5000, lease_type: NNN,
                       start_date: '2020-01-01', end_date: '2030-01-01', cap: '5', audit_rights: true };

console.log('\n── The two sets ──');

yes('CAM_BLOCKING_FIELD_TYPES is exported', RE.CAM_BLOCKING_FIELD_TYPES instanceof Set,
    'the engine does not expose a CAM-blocking set');
// DELIBERATELY NOT a subset assertion. It used to be one, and that is exactly
// how the property mismatch went unmodelled: "a required field is absent" and
// "a present field contradicts the property" are different shapes, and only the
// first can be expressed as a subset of MISSING_FIELD_TYPES. The two sets are
// independent; the invariant they owe each other is that camBlocking and
// reviewItems never overlap, which is asserted per-lease below.
yes('the blocking set is NOT constrained to missing-field types',
    [...RE.CAM_BLOCKING_FIELD_TYPES].some(t => !RE.MISSING_FIELD_TYPES.has(t)),
    'the blocking set is a subset of MISSING_FIELD_TYPES again — a conflict-shaped '
    + 'blocker like an unconfirmed property mismatch cannot be expressed that way');
yes('every review item is a missing-field type that does not block',
    [...RE.MISSING_FIELD_TYPES].some(t => !RE.CAM_BLOCKING_FIELD_TYPES.has(t)),
    'every missing field now blocks CAM — the over-blocking bug is back');
yes('every blocking type has a reason phrase a reader can act on',
    [...RE.CAM_BLOCKING_FIELD_TYPES].every(t =>
      typeof RE.CAM_BLOCKER_REASON[t] === 'string' && RE.CAM_BLOCKER_REASON[t].length > 3),
    `missing reason for: ${[...RE.CAM_BLOCKING_FIELD_TYPES].filter(t => !RE.CAM_BLOCKER_REASON[t])}`);

// The blocking set must match getValidTenants(), which is what actually decides
// whether a lease reaches the engine. Of the fields MISSING_FIELD_TYPES names,
// square footage is the only one that filter reads.
const validTenants = scriptCode.slice(
  scriptCode.indexOf('function getValidTenants'),
  scriptCode.indexOf('function getValidTenants') + 400);
yes('[source] getValidTenants still gates on leased_sqft',
    /Number\(t\.leased_sqft\)\s*>\s*0/.test(validTenants),
    'the engine filter changed — the blocking set must be re-derived from it');
yes('[source] getValidTenants still gates on the property mismatch',
    /!_propertyMismatchBlockReason\(t\)/.test(validTenants),
    'the fourth condition left the engine filter — the blocking set must follow it');
yes('[source] getValidTenants does NOT gate on a cap or on audit rights',
    !/\bcap\b/.test(validTenants) && !/audit_rights/.test(validTenants),
    'the engine filter now reads a field the blocking set does not model');
// The whole point of the set: one entry per condition in getValidTenants() that
// a warning can express. tenant_name and extractionFailed are handled upstream
// by _extractionOk and the failed-tenant list, so they raise no warning here.
eqj('the blocking set is exactly the conditions the engine filter reads',
    [...RE.CAM_BLOCKING_FIELD_TYPES].sort(), ['missing_sqft', 'property_name_mismatch']);

console.log('\n── A Triple Net lease with no cap reconciles ──');

const d1 = derive(reconcilable);
yes('it is reported as missing something (the review items are real)',
    d1.missing.length > 0, 'nothing flagged at all');
eqj('but nothing blocks CAM', d1.camBlocking, []);
yes('the cap and the audit-rights clause are review items',
    d1.reviewItems.some(l => /NNN Cap/i.test(l)) && d1.reviewItems.some(l => /audit rights/i.test(l)),
    JSON.stringify(d1.reviewItems));
// "missing = camBlocking + reviewItems" no longer holds and must not be
// reasserted: camBlocking can now carry a conflict that was never a missing
// field. What must hold is that the two lists never describe the same thing.
yes('camBlocking and reviewItems are disjoint',
    d1.camBlocking.every(b => !d1.reviewItems.includes(b)),
    JSON.stringify(d1));
yes('every missing field is either blocking or a review item, never dropped',
    d1.missing.every(l => d1.reviewItems.includes(l)
      || d1.camBlocking.some(b => b.includes(l))),
    JSON.stringify(d1));

console.log('\n── A lease with no square footage does not ──');

const d2 = derive(noSqft);
eqj('square footage blocks CAM', d2.camBlocking, ['missing Sq Ft']);
yes('and the same lease still carries its review items',
    d2.reviewItems.length > 0, JSON.stringify(d2));
yes('Sq Ft is not double-counted as a review item',
    !d2.reviewItems.some(l => /Sq Ft/i.test(l)), JSON.stringify(d2.reviewItems));

console.log('\n── A fully specified lease is clean on both counts ──');

const d3 = derive(capped);
eqj('nothing blocks CAM', d3.camBlocking, []);
yes('and no NNN cap review item is raised once a cap exists',
    !d3.reviewItems.some(l => /NNN Cap/i.test(l)), JSON.stringify(d3.reviewItems));

console.log('\n── The Dover scenario: a property mismatch, unconfirmed ──');

// The exact Pilot finding. Dover Saddlery Retail is a complete, reconcilable
// lease in every other respect — it has square footage, dates and a lease type
// — but the document names a different building than the property it was filed
// under, and no human has vouched for it.
const DOVER = {
  tenant_name: 'Dover Saddlery Retail', leased_sqft: 8194, lease_type: NNN,
  start_date: '2011-07-01', end_date: '2016-07-01', cap: null,
  property_name: 'Northgate Commons', fileName: 'dover-lease.pdf',
};
const doverEdges = LI.detectLeaseEdgeCases(DOVER, { currentPropertyName: 'Test 3 Property' });
const doverUnconfirmed = { ...DOVER, _edgeCases: doverEdges };
const doverConfirmed   = { ...DOVER, _edgeCases: doverEdges,
  _propertyConfirm: { extractedName: 'Northgate Commons', documentKey: 'dover-lease.pdf' } };

// Guard: if the detector stops firing, everything below passes on nothing.
yes('the detector actually fires on this lease (not a vacuous scenario)',
    (doverEdges.edgeCases || []).some(e => e.type === 'PROPERTY_NAME_MISMATCH'),
    `edge cases detected: ${JSON.stringify((doverEdges.edgeCases || []).map(e => e.type))}`);
yes('and it is NOT confirmed', LI.isPropertyMismatchConfirmed(doverUnconfirmed) === false,
    'the unconfirmed fixture reads as confirmed');

const du = derive(doverUnconfirmed);
const duState = RE.deriveTenantReviewState(doverUnconfirmed, []);
eqj('the unconfirmed mismatch blocks CAM', du.camBlocking,
    ['lease names a different property, not yet confirmed']);
yes('the blocking reason is visible, not a bare field name',
    du.camBlocking[0].length > 20 && /different property/i.test(du.camBlocking[0]),
    du.camBlocking[0]);
yes('it is NOT filed as a review item — it stops the calculation',
    !du.reviewItems.some(l => /different property/i.test(l)), JSON.stringify(du.reviewItems));
yes('the lease still carries its ordinary review items',
    du.reviewItems.some(l => /NNN Cap/i.test(l)), JSON.stringify(du.reviewItems));
yes('the card still shows the full-sentence warning',
    (duState.warnings.find(w => w.type === 'property_name_mismatch') || {}).label
      === 'Lease document names a different property — confirm this lease belongs here',
    JSON.stringify(duState.warnings.map(w => w.type)));
yes('the lease is otherwise complete — nothing else blocks it',
    du.camBlocking.length === 1, JSON.stringify(du.camBlocking));

console.log('\n── The same lease, once a human confirms it belongs here ──');

const dc = derive(doverConfirmed);
yes('the confirmation is recognised', LI.isPropertyMismatchConfirmed(doverConfirmed) === true,
    'the confirmed fixture does not read as confirmed');
eqj('nothing blocks CAM any more', dc.camBlocking, []);
yes('the warning type switches rather than disappearing',
    RE.deriveTenantReviewState(doverConfirmed, []).warnings
      .some(w => w.type === 'property_name_confirmed'),
    'the confirmed lease no longer records that it named a different property');
yes('confirmation resolves the consequence, not the finding',
    RE.deriveTenantReviewState(doverConfirmed, []).warnings
      .every(w => w.type !== 'property_name_mismatch'),
    'the blocking warning survived confirmation');
yes('the ordinary review items are unchanged by confirmation',
    JSON.stringify(dc.reviewItems) === JSON.stringify(du.reviewItems),
    `${JSON.stringify(du.reviewItems)} vs ${JSON.stringify(dc.reviewItems)}`);

console.log('\n── The blocker must survive a property load ──');

// normalizeTenant() is an allow-list, and the property blob is re-read through
// it on EVERY property load. _edgeCases and _propertyConfirm were written to
// storage and then dropped on the way back in, which is worse than never saving
// them: the stored record looked complete while the behaviour was not.
//
// _edgeCases is computed once, at extraction, and never recomputed. Losing it
// made _hasPropertyMismatch() false, so a lease whose document names a different
// property silently became CAM-eligible again on the next page load, with the
// warning gone from the card. A safety gate that evaporates on reload is the
// same defect as one that was never wired — and it fails in the permissive
// direction, which is the one direction it must never fail in.
const normalizeSrc = scriptCode.slice(
  scriptCode.indexOf('function normalizeTenant'),
  scriptCode.indexOf('function isValidTenant'));
[
  ['_edgeCases',       'the detected mismatch itself'],
  ['_propertyConfirm', "the landlord's explicit confirmation"],
  ['_exclusionAck',    'the exclusion acknowledgement'],
].forEach(([field, what]) => {
  yes(`[source] normalizeTenant carries ${field} — ${what}`,
      new RegExp(`\\b${field}:\\s*d\\.${field}`).test(normalizeSrc),
      `${field} is dropped on every property load, so whatever it gates resets`);
});
yes('[source] normalizeTenant is still an allow-list, not a spread',
    !/\.\.\.d[,\s}]/.test(normalizeSrc),
    'normalizeTenant now spreads the raw record — the allow-list was the point');

console.log('\n── The screen and the button must agree ──');

const bulkSrc = scriptCode.slice(
  scriptCode.indexOf('const _camBlockers = (d) =>'),
  scriptCode.indexOf('const _camBlockers = (d) =>') + 3000);
yes('[source] the readiness count reads camBlocking, not missing',
    /_camBlockers\s*=\s*\(d\)\s*=>\s*\{[\s\S]{0,200}?deriveTenantReviewState\(d\)\.camBlocking/.test(bulkSrc),
    'the bulk screen is back on the whole missing[] set');
// The control confirms EXTRACTIONS, and its label must name that object.
// "Approve N ready for CAM" was accurate about the count and vague about the
// noun: in a CRE accounting workflow "Approve" reads as approving lease terms
// for billing, which this control does not do and cannot do — the audit gate
// decides billing, separately. Both halves are asserted: the count, and the
// word that says what is being confirmed.
yes('[source] the button names the CAM-ready count',
    /Confirm \$\{_readyCount\} CAM-ready extraction/.test(scriptCode),
    'the confirm button no longer states how many extractions it will confirm');
yes('[source] the button says it confirms extractions, not approves leases',
    /Confirm \$\{_readyCount\} CAM-ready extraction/.test(scriptCode)
      && !/>Approve \$\{_readyCount\}/.test(scriptCode),
    'the control still reads as approving the leases themselves');

const approveSrc = scriptCode.slice(
  scriptCode.indexOf('async function bulkApproveReady'),
  scriptCode.indexOf('async function bulkApproveReady') + 1200);
yes('[source] bulkApproveReady uses the SAME predicate as the count',
    /deriveTenantReviewState\(d\)\.camBlocking/.test(approveSrc),
    'the button can approve leases the count excluded, or the reverse');

console.log('\n── The calc-state chip means the same thing everywhere it appears ──');

// C3 was fixed at ONE of five call sites. The reconciliation results table was
// corrected to "CAM calculation" while the Dispute Packet, the Risk & Disputes
// roster and the CSV export kept "Billing Method" over the same values — so
// those surfaces read "Billing Method: Calc verified", a heading and a value
// that do not match, which is worse than the ambiguity being fixed.
//
// A whole-file guard rather than a per-site one: the point is that no surface
// may present these values under a heading that describes something else.
const calcLabels = ['Calc verified', 'Calc estimated', 'Calc partial', 'Inputs missing'];
calcLabels.forEach(l => {
  yes(`[source] the engine still emits "${l}"`,
      new RegExp(`label: '${l}'`).test(engineCode),
      'the calc-state label set changed — every surface heading must follow it');
});
// Comments quoting the old heading are not renders, so only markup is examined.
const renderedHeadings = scriptCode
  .split('\n')
  .filter(l => !/^\s*(\/\/|\*|<!--)/.test(l))
  .join('\n');
yes('[source] no rendered surface heads these values "Billing Method"',
    !/>Billing Method<|'Billing Method'|<td>Billing Method<\/td>/.test(renderedHeadings),
    'a surface still labels the CAM calculation state as a billing method');
yes('[source] the CSV export column matches the on-screen wording',
    /'CAM Calculation'/.test(scriptCode) && /'Allocation Flags'/.test(scriptCode),
    'the CSV still exports the old column names — this is the copy most likely to '
    + 'reach a lender pack with nobody left to explain it');
// Every place the chip is rendered should say what it describes.
const chipRenders = (scriptCode.match(/rc-calc-state \$\{/g) || []).length;
const chipTitled  = (scriptCode.match(/rc-calc-state \$\{[^}]+\}"\s+title=/g) || []).length;
yes(`[source] every calc-state chip carries its scope note (${chipTitled}/${chipRenders})`,
    chipRenders > 0 && chipTitled === chipRenders,
    `${chipRenders - chipTitled} chip render(s) have no title explaining what is verified`);

console.log('\n── The wording must not overstate what is blocked ──');

// "cannot be reconciled" is a factual claim about the engine. It may appear only
// in the block listing camBlocking leases, never in the review-items note.
const blockedBlock = scriptCode.slice(
  scriptCode.indexOf('<div class="bulk-cam-blocked">'),
  scriptCode.indexOf('<div class="bulk-cam-blocked">') + 1200);
const reviewBlock = scriptCode.slice(
  scriptCode.indexOf('<div class="bulk-cam-review">'),
  scriptCode.indexOf('<div class="bulk-cam-review">') + 600);

yes('the blocked note says the lease cannot be reconciled',
    /cannot be reconciled/.test(blockedBlock), 'the refusal no longer states its consequence');
yes('a separate note exists for leases that reconcile with open review items',
    reviewBlock.length > 100 && /will reconcile but/.test(reviewBlock),
    'reconcilable leases with review items are invisible or lumped in with blocked ones');
yes('the review note does NOT claim those leases cannot be reconciled',
    !/cannot be reconciled/.test(reviewBlock), 'the untrue claim is back');
yes('the review note says confirmation validates the extraction, not lease terms',
    /Confirming validates the extraction, not the lease terms/.test(reviewBlock),
    '"CAM-ready" can still be read as "verified"');
yes('the review note is driven by reviewItems, not by missing',
    /_reviewItems\(d\)/.test(scriptCode) && !/_reviewList[\s\S]{0,120}\.missing/.test(scriptCode),
    'the review note reads the wrong list');

// ── The Needs Review box must enumerate every blank required field ──────────
//
// Reported from Pilot: a lease with Leased Sqft, Lease End Date and Lease Type
// all blank listed only the last two. The box rendered
// getWarnings(computeFlags(d)) — a second enumeration of what a lease is missing
// — and computeFlags has no square-footage branch, so the one it omitted was the
// CAM blocker.
console.log('\n── Needs Review lists every blank required field ──');

const _bfShape = {
  id: 'bf', tenant_name: 'Benefitfocus.com, Inc', leased_sqft: null,
  start_date: '2016-12-12', end_date: null, lease_type: null, cap: null,
};
const _bfState = RE.deriveTenantReviewState(_bfShape, []);

yes('the reported lease shows three outstanding required fields, not two',
    _bfState.requiredGaps.length === 3, JSON.stringify(_bfState.requiredGaps));
yes('and the square footage is one of them',
    _bfState.requiredGaps.some(g => /square footage/i.test(g)),
    JSON.stringify(_bfState.requiredGaps));
yes('the gaps agree with the warnings the blocker and the CTA are built from',
    _bfState.warnings.filter(w => RE.REQUIRED_FIELD_TYPES.indexOf(w.type) >= 0).length
      === _bfState.requiredGaps.length,
    JSON.stringify({ warnings: _bfState.warnings.map(w => w.type), gaps: _bfState.requiredGaps }));

// THE SCORE IS THE REASON computeFlags STAYS AS IT IS. It feeds
// `score -= getWarnings(computeFlags(t)).length * 5`, and missing sqft already
// costs −25, so adding a type there would reprice every sqft-less lease.
yes('computeFlags is NOT the place this was fixed',
    RE.computeFlags(_bfShape).indexOf('missing_sqft') === -1,
    JSON.stringify(RE.computeFlags(_bfShape)));
yes('so the health score is exactly what it was', _bfState.score === 40, String(_bfState.score));

yes('a lease with nothing blank lists nothing',
    RE.deriveTenantReviewState(
      { tenant_name: 'Y', leased_sqft: 1000, start_date: '2020-01-01',
        end_date: '2030-01-01', lease_type: 'Gross' }, []).requiredGaps.length === 0,
    'a complete lease still reports gaps');

// A document that states no term at all is one cause, not two symptoms. This
// wording came from computeFlags and has to survive the move.
const _noTerm = RE.deriveTenantReviewState(
  { tenant_name: 'X', leased_sqft: null, doc_has_dates: false,
    start_date: null, end_date: null, lease_type: null }, []).requiredGaps;
yes('no term in the document collapses to one sentence, not two date lines',
    _noTerm.some(g => /No lease term found in document/i.test(g))
      && !_noTerm.some(g => /^Missing (start|end) date$/i.test(g)),
    JSON.stringify(_noTerm));

// A manual override records that a human vouched for the lease. It does not fill
// in a field, so the card must still be able to say what is blank.
const _ack = RE.deriveTenantReviewState(
  Object.assign({}, _bfShape, { review: { reviewerConfirmed: true } }), []);
yes('an acknowledged lease still reports its blank fields',
    _ack.status === 'manually_verified' && _ack.requiredGaps.length === 3,
    JSON.stringify({ status: _ack.status, gaps: _ack.requiredGaps }));

// PROPERTY_NAME_MISMATCH is deliberately absent: it is not an absent field but a
// present one that contradicts the property, and the card renders it with its own
// explanation and its own Confirm control.
yes('the property mismatch is not duplicated into this list',
    RE.REQUIRED_FIELD_TYPES.indexOf('property_name_mismatch') === -1,
    'the mismatch would now be stated twice in two vocabularies');

// Comments stripped first. The rationale above _requiredGapsHtml quotes the
// expression it replaced, and a checker that reads raw source would find that
// quote and report the defect as still present — a mistake this session has
// already made twice.
const _liveScript = scriptCode.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
yes('[source] both Needs Review boxes read the canonical list',
    (_liveScript.match(/_requiredGapsHtml\(d, i, (?:true|false)\)/g) || []).length === 2
      && !/getWarnings\(computeFlags\(d\)\)/.test(_liveScript),
    'a card still enumerates missing fields from computeFlags');

const TOTAL_EXPECTED = 62;
yes(`suite runs all ${TOTAL_EXPECTED} checks`, pass + fail + 1 === TOTAL_EXPECTED,
    `test count changed — update TOTAL_EXPECTED deliberately (saw ${pass + fail + 1})`);

console.log(`\n${fail === 0 ? '\x1b[32m' : '\x1b[31m'}RESULT: ${pass} passed, ${fail} failed\x1b[0m`);
process.exit(fail === 0 ? 0 : 1);
