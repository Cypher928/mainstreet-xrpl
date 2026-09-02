'use strict';
/**
 * test-field-provenance.js — a value's label may not outrun its evidence.
 *
 *   node test-field-provenance.js
 *
 * WHY THIS EXISTS
 *
 * `getFieldConfidence()` decided "verified" from non-emptiness for `cap` and for
 * the `default:` branch, which together cover almost every lease field. Measured
 * in the running app against real Pilot tenants: a cap typed by hand into a
 * property with no document rendered byte-identically to one read off a
 * 25,824-character lease, and identically again to one carrying a verbatim
 * clause AND a page number. Across Pilot, 530 field values asserted a document
 * that nothing pointed at, and the 52 that could genuinely cite a clause were
 * indistinguishable from them.
 *
 * The rule this suite pins was not invented for it. lease-review-packets.js has
 * always computed it correctly for the lender packet — "VERIFIED every populated
 * key field quotes the executed document / INFERRED a value exists but nothing
 * cites it". field-provenance.js promotes that to per-field; getFieldConfidence
 * now projects it rather than deciding a second answer.
 */
const fs   = require('fs');
const path = require('path');
const FP   = require('./field-provenance.js');
const { fnSource } = require('./test-support/fn-source');

let pass = 0, fail = 0;
const ok  = (m) => { console.log('  \x1b[32m✓\x1b[0m ' + m); pass++; };
const bad = (m, d) => { console.log('  \x1b[31m✗\x1b[0m ' + m + (d ? '\n      → ' + d : '')); fail++; };
const yes = (m, c, d) => c ? ok(m) : bad(m, d);
const R   = (l, v) => console.log('  ' + String(l).padEnd(46) + ':', typeof v === 'string' ? v : JSON.stringify(v));
const H   = (t) => console.log('\n\x1b[36m── ' + t + ' ──\x1b[0m');

const SCRIPT = fs.readFileSync(path.join(__dirname, 'script.js'), 'utf8');
// Every comment in this change quotes the strings these assertions search for.
const CODE = SCRIPT.replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
  .map(l => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n');

const snap = (o) => Object.assign({ fieldKey: 'cap', value: '5' }, o);
const fe   = (field, snaps) => ({ [field]: { snapshots: snaps } });
const P    = (f, t) => FP.fieldProvenance(f, t);

console.log('\n══ Where a lease field\'s value actually came from ══');

// ── 1. Unknown stays unknown ────────────────────────────────────────────────
H('An absent value has no provenance to argue about');
[['', 'empty string'], [null, 'null'], [undefined, 'undefined'], ['   ', 'whitespace']].forEach(([v, label]) => {
  yes(`${label} → unknown`, P('cap', { cap: v }).state === 'unknown', P('cap', { cap: v }).state);
});
// The precise failure this guards: a citation on the field cannot conjure a value.
yes('a quote on an empty field does NOT promote it out of unknown',
    P('cap', { cap: '', fieldEvidence: fe('cap', [snap({ quote: 'shall not exceed 5%' })]) }).state === 'unknown',
    'an empty value was promoted by its evidence');

// ── 2. The floor ────────────────────────────────────────────────────────────
H('A value nothing affirms is an AI extraction, and says so');
let p = P('cap', { cap: '5' });
R('bare value', { state: p.state, ui: p.uiStatus, db: p.dbStatus, label: p.label });
yes('a non-empty value with no evidence → ai_extracted',
    p.state === 'ai_extracted', p.state);
yes('    it is NOT cited, and NOT stated by anyone',
    p.cited === false && p.stated === false, JSON.stringify([p.cited, p.stated]));
yes('    and its label never mentions the lease document',
    !/lease document/i.test(p.label), p.label);
// The whole defect, as one assertion.
yes('NON-EMPTINESS ALONE IS NEVER LEASE-CONFIRMED — every field, not just cap',
    ['cap','admin_fee_pct','admin_fee_basis','gross_up_pct','expense_stop','audit_rights',
     'pro_rata_method','renewal_options','excluded_categories','base_rent','security_deposit',
     'capBaseAmount','tenant_name','lease_type','leased_sqft','start_date','end_date']
      .every(f => P(f, { [f]: 'something' }).state === 'ai_extracted'),
    'some field still reaches lease_confirmed on presence alone');

// ── 3. Lease-confirmed requires a citation ─────────────────────────────────
H('Only a clause or a page earns the document\'s authority');
p = P('cap', { cap: '5', fieldEvidence: fe('cap', [snap({ quote: 'shall not exceed five percent (5%)', page: 12, sourceFile: 'lease.pdf' })]) });
R('with quote + page', { state: p.state, cited: p.cited, page: p.page });
yes('a verbatim quote → lease_confirmed', p.state === 'lease_confirmed', p.state);
yes('    cited is true and the quote travels with it',
    p.cited === true && /five percent/.test(p.quote || ''), JSON.stringify(p.quote));
yes('a page reference alone is also a citation',
    P('cap', { cap: '5', fieldEvidence: fe('cap', [snap({ quote: null, page: 12 })]) }).state === 'lease_confirmed',
    'a page number did not count as evidence');
yes('a snapshot with neither is not',
    P('cap', { cap: '5', fieldEvidence: fe('cap', [snap({ quote: null, page: null })]) }).state === 'ai_extracted',
    'an empty snapshot conferred a citation');
// A confidence score reports how well a number was READ. It is not a citation.
yes('a high extraction confidence score is not a citation either',
    P('leased_sqft', { leased_sqft: '12000', confidence: { leasedSqft: 100 }, _confidenceScore: 100 }).state === 'ai_extracted',
    'a score stood in for a clause');

// ── 4 & 5. The two human states ────────────────────────────────────────────
H('A person is an authority, and not the lease\'s');
p = P('cap', { cap: '5', reviewOverrides: { cap: { reviewerConfirmed: true, reviewedAt: '2026-02-01T00:00:00Z' } } });
R('reviewOverrides', { state: p.state, ui: p.uiStatus, db: p.dbStatus });
yes('a reviewOverrides confirmation → manually_entered', p.state === 'manually_entered', p.state);
p = P('cap', { cap: '5', fieldEvidence: fe('cap', [snap({ manuallyEdited: true, approved: true, reviewerEmail: 'pm@example.com', reviewedAt: '2026-02-01T00:00:00Z' })]) });
yes('a snapshot marked manuallyEdited → manually_entered too',
    p.state === 'manually_entered', p.state);
yes('    even though that snapshot also carries approved:true — they authored it',
    p.state === 'manually_entered', p.state);

p = P('cap', { cap: '5', fieldEvidence: fe('cap', [snap({ approved: true, reviewerEmail: 'pm@example.com', reviewedAt: '2026-02-01T00:00:00Z' })]) });
R('field-level approval', { state: p.state, by: p.by, db: p.dbStatus });
yes('approval WITHOUT editing → manually_confirmed', p.state === 'manually_confirmed', p.state);
yes('    and it names who, and when',
    p.by === 'pm@example.com' && !!p.when, JSON.stringify([p.by, p.when]));
yes('approved with no reviewer identity is not a confirmation',
    P('cap', { cap: '5', fieldEvidence: fe('cap', [snap({ approved: true })]) }).state === 'ai_extracted',
    'an anonymous approval was accepted as field-level confirmation');

H('Neither human state may borrow the lease\'s words');
['manually_entered', 'manually_confirmed'].forEach(st => {
  yes(`${st} never says "lease document"`, !/lease document/i.test(FP.LABEL[st]), FP.LABEL[st]);
  yes(`${st} never reports the method "AI Extraction"`,
      FP.METHOD[st] !== 'AI Extraction', FP.METHOD[st]);
});

// ── 6. Tenant-level confirmation must not leak ─────────────────────────────
H('Confirming a TENANT does not verify its fields');
// All 44 tenant_review_audit rows in Pilot carry action:'tenant_confirmed' and
// field_key:null — the bulk "Confirm N CAM-ready extractions" button. They name
// a real reviewer; they say nothing about any particular value.
const tenantConfirmed = {
  cap: '5', _userConfirmed: true,
  review: { status: 'verified', reviewedBy: 'pm@example.com' },
  reviewOverrides: {},
};
p = P('cap', tenantConfirmed);
R('tenant confirmed, field untouched', { state: p.state, ui: p.uiStatus });
yes('a tenant-level confirmation leaves the field ai_extracted',
    p.state === 'ai_extracted', p.state);
yes('    and does not set stated or cited',
    p.stated === false && p.cited === false, JSON.stringify([p.stated, p.cited]));
yes('    the module never reads _userConfirmed, review.status or any audit record',
    !/_userConfirmed|tenant_review_audit|tenant_confirmed/.test(
      fs.readFileSync(path.join(__dirname, 'field-provenance.js'), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n')),
    'field provenance is reading a tenant-level signal');

// ── 7, 8, 9. Precedence, and the current value ─────────────────────────────
H('Provenance describes the value on screen, not the field\'s whole history');
// A human correction is not vouched for by the clause it overrode.
p = P('cap', { cap: '6', fieldEvidence: fe('cap', [
  snap({ quote: 'shall not exceed five percent (5%)', extractedAt: '2026-01-01T00:00:00Z' }),
  snap({ value: '6', manuallyEdited: true, reviewerEmail: 'pm@example.com', reviewedAt: '2026-02-01T00:00:00Z' }),
]) });
R('quote, then a manual correction', { state: p.state, cited: p.cited });
yes('a later manual edit outranks an earlier citation',
    p.state === 'manually_entered' && p.cited === false, JSON.stringify([p.state, p.cited]));

// And the mirror: re-extraction must not resurrect a stale confirmation.
p = P('cap', { cap: '6',
  reviewOverrides: { cap: { reviewerConfirmed: true, reviewedAt: '2026-01-01T00:00:00Z' } },
  fieldEvidence: fe('cap', [snap({ value: '6', quote: null, extractedAt: '2026-03-01T00:00:00Z' })]) });
R('override, then a re-extraction', { state: p.state });
yes('RE-EXTRACTION DOES NOT RESURRECT AN OLD MANUAL CONFIRMATION',
    p.state === 'ai_extracted', p.state);
p = P('cap', { cap: '5',
  reviewOverrides: { cap: { reviewerConfirmed: true, reviewedAt: '2026-04-01T00:00:00Z' } },
  fieldEvidence: fe('cap', [snap({ quote: null, extractedAt: '2026-03-01T00:00:00Z' })]) });
yes('    and an override that came AFTER the extraction still stands',
    p.state === 'manually_entered', p.state);

// An old quote must not vouch for a newer, uncited reading of the same field.
p = P('cap', { cap: '6', fieldEvidence: fe('cap', [
  snap({ value: '5', quote: 'five percent', extractedAt: '2026-01-01T00:00:00Z' }),
  snap({ value: '6', quote: null,           extractedAt: '2026-03-01T00:00:00Z' }),
]) });
yes('a stale citation does not carry forward to a later uncited value',
    p.state === 'ai_extracted', p.state);
yes('a superseded snapshot is ignored even when it is the only one',
    P('cap', { cap: '5', fieldEvidence: fe('cap', [snap({ quote: 'five percent', superseded: true })]) }).state === 'ai_extracted',
    'a superseded citation was still counted');

// ── The two projections ────────────────────────────────────────────────────
H('Five states, projected onto the contracts that already exist');
R('UI  (verified|estimated|manual|missing)', FP.UI_STATUS);
R('DB  (verified|estimated|missing)',        FP.DB_STATUS);
yes('every state has both projections',
    FP.STATES.every(s => FP.UI_STATUS[s] && FP.DB_STATUS[s]), 'a state has no projection');
yes('the DB projection uses only what the CHECK constraint permits',
    Object.values(FP.DB_STATUS).every(v => ['verified', 'estimated', 'missing'].includes(v)),
    JSON.stringify(FP.DB_STATUS));
yes('an uncited AI value can never reach the database as "verified"',
    FP.DB_STATUS.ai_extracted === 'estimated', FP.DB_STATUS.ai_extracted);
yes('    nor can a typed one',
    FP.DB_STATUS.manually_entered === 'estimated', FP.DB_STATUS.manually_entered);
yes('a reviewer-approved field does reach it as "verified" — that IS verification',
    FP.DB_STATUS.manually_confirmed === 'verified', FP.DB_STATUS.manually_confirmed);
yes('both human states read "manual" in the UI contract, never "verified"',
    FP.UI_STATUS.manually_entered === 'manual' && FP.UI_STATUS.manually_confirmed === 'manual',
    JSON.stringify([FP.UI_STATUS.manually_entered, FP.UI_STATUS.manually_confirmed]));

// ── Conflict stays off the scale ───────────────────────────────────────────
H('Conflict is not a point between cited and uncited');
yes('the five states do not include a conflict state',
    !FP.STATES.includes('conflict') && FP.STATES.length === 5, JSON.stringify(FP.STATES));

// ── getFieldConfidence delegates ───────────────────────────────────────────
H('getFieldConfidence projects the resolver — it does not decide');
const GFC = fnSource(CODE, 'getFieldConfidence');
yes('it calls the provenance resolver',
    /FieldProvenance\.fieldProvenance\(/.test(GFC), 'getFieldConfidence no longer delegates');
// Every branch that CLAIMS THE DOCUMENT must sit behind the citation gate.
// proRata is the one verified return that legitimately does not: it is derived,
// and it inherits square footage's status rather than asserting its own.
yes('every "Extracted from lease document" return is behind the citation gate',
    (GFC.match(/note:\s*'Extracted from lease document'/g) || []).length ===
    (GFC.match(/_cited\s*\n?\s*\?/g) || []).length,
    'a document claim is not gated on _cited: ' +
      JSON.stringify([(GFC.match(/note:\s*'Extracted from lease document'/g)||[]).length,
                      (GFC.match(/_cited\s*\n?\s*\?/g)||[]).length]));
yes('    and the one ungated verified return is proRata, which inherits',
    (GFC.match(/status:\s*'verified'/g) || []).length -
    (GFC.match(/note:\s*'Extracted from lease document'/g) || []).length === 1 &&
    /Computed from verified square footage/.test(GFC),
    'an ungated verified return other than proRata exists');
yes('the bare non-empty → verified default is gone',
    !/:\s*\{\s*status:\s*'verified',\s*source:\s*'structured',\s*note:\s*'Extracted from lease document'\s*\};\s*\n\s*\}\s*$/m.test(GFC) &&
    !/isEmpty\s*\n?\s*\?\s*\{\s*status:\s*'missing'[\s\S]{0,120}?:\s*\{\s*status:\s*'verified'/.test(GFC),
    'the default branch still returns verified on non-emptiness');
yes('a manual state short-circuits before the switch, and reports manual',
    /manually_confirmed[\s\S]{0,220}?status:\s*'manual'/.test(GFC) &&
    /manually_entered[\s\S]{0,160}?status:\s*'manual'/.test(GFC),
    'the manual states are not projected to the manual status');

H('A derived field inherits its input\'s provenance, all of it');
// Found by the assertion above: proRata handled `missing` and `estimated` and
// let everything else fall through to verified, so a hand-typed square footage
// produced "Computed from verified square footage".
yes('the proRata branch handles the manual case rather than falling through',
    /sqftConf\.status === 'manual'/.test(GFC), 'proRata still falls through to verified');

H('hasFieldQuote reads the current snapshot, not any snapshot ever taken');
yes('it delegates to FieldProvenance.latestSnapshot',
    /FieldProvenance\.latestSnapshot\(/.test(fnSource(CODE, 'hasFieldQuote')),
    'hasFieldQuote still scans the whole history');

H('The database projection is explicit at the write boundary');
const DBS = fnSource(CODE, '_evidenceDbStatus');
yes('_evidenceDbStatus exists and is used by the evidence writer',
    !!DBS && /confidence_status:\s*_evidenceDbStatus\(snapshot\)/.test(CODE),
    'the writer does not go through the explicit mapping');
yes('it decides the manual case on the snapshot\'s own flags',
    /approved\s*===\s*true/.test(DBS) && /manuallyEdited\s*!==\s*true/.test(DBS),
    'the manual case is not discriminated');
yes('it can only ever emit the three permitted values',
    (DBS.match(/return\s+'([a-z]+)'/g) || []).every(r => /'(verified|estimated|missing)'/.test(r)),
    JSON.stringify(DBS.match(/return\s+'[a-z]+'/g)));

H('Both Lease Review Workspace labellers read the same resolver');
yes('the confidence chip consults it',
    /FieldProvenance\.fieldProvenance\(/.test(fnSource(CODE, '_rwConfChip')), 'chip has its own opinion');
yes('the extraction method consults it',
    /FieldProvenance\.fieldProvenance\(/.test(fnSource(CODE, '_rwExtractionMethod')), 'method has its own opinion');

H('No provenance is invented for data that cannot establish it');
const FPSRC = fs.readFileSync(path.join(__dirname, 'field-provenance.js'), 'utf8');
yes('the module writes nothing and reads no store',
    !/db\.|supabase|fetch\(|localStorage/.test(FPSRC), 'the resolver touches storage');
yes('it is pure — same tenant in, same answer out',
    JSON.stringify(P('cap', { cap: '5' })) === JSON.stringify(P('cap', { cap: '5' })), 'not deterministic');
const frozen = { cap: '5', fieldEvidence: fe('cap', [snap({ quote: 'q' })]) };
const before = JSON.stringify(frozen);
P('cap', frozen);
yes('and it does not mutate the tenant it was given',
    JSON.stringify(frozen) === before, 'the resolver mutated its input');

console.log(`\n${fail ? '\x1b[31m' : '\x1b[32m'}RESULT: ${pass} passed, ${fail} failed\x1b[0m\n`);
process.exit(fail ? 1 : 0);
