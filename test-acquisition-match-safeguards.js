// test-acquisition-match-safeguards.js
// ============================================================================
// Acquisition matching and conversion safeguards.
//
//   1  tenant names: a material mismatch is flagged (SafeShield Security →
//      Sunrise Cafe & Bakery, as on the Pilot's Maple Plaza); genuine matches
//      are not (Luxe Nails, Maple Coffee Co → Maple Coffee Co., ShopRite …
//      Inc → Inc.); an uncertain comparison is flagged for a look, never as
//      proof of a mismatch
//   2  the property a lease names, against the acquisition's own names
//   3  matchConcerns / requiresReason
//   4  leaseholds with no lease on file, and their acknowledgement
//   5  the page's resolution path, run against the real functions: a
//      concerning match is never written unconfirmed, a material mismatch
//      never without a reason; confirming records the concerns and the reason
//      in the resolution and the activity entry; cancelling writes nothing;
//      a genuine match is recorded as it always was; a frozen acquisition is
//      never written
//   6  the conversion gate: a leasehold with no lease on file blocks
//      conversion until a person acknowledges it; the acknowledgement is
//      recorded, says it verifies nothing, and changes no term
//
// Run: node test-acquisition-match-safeguards.js
// ============================================================================
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const AL = require('./acquisition-leasehold.js');
const AW = require('./acquisition-workspace.js');
const F  = require('./fixtures/maple-plaza-acquisition.js');
const SCRIPT = fs.readFileSync(path.join(__dirname, 'script.js'), 'utf8');

let pass = 0, fail = 0; const failures = [];
function t(name, fn) {
  try { fn(); pass++; console.log('  \x1b[32m✓\x1b[0m ' + name); }
  catch (e) { fail++; failures.push(name + ' — ' + e.message); console.log('  \x1b[31m✗\x1b[0m ' + name + '\n      ' + e.message); }
}
async function ta(name, fn) {
  try { await fn(); pass++; console.log('  \x1b[32m✓\x1b[0m ' + name); }
  catch (e) { fail++; failures.push(name + ' — ' + e.message); console.log('  \x1b[31m✗\x1b[0m ' + name + '\n      ' + e.message); }
}
function ok(c, m) { if (!c) throw new Error(m || 'expected true'); }
function eq(a, b, m) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((m || 'not equal') + ': ' + JSON.stringify(a) + ' !== ' + JSON.stringify(b)); }
function sec(s) { console.log('\n── ' + s + ' ' + '─'.repeat(Math.max(0, 60 - s.length))); }
function fnSource(src, name) {
  const re = new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\(');
  const m = re.exec(src); if (!m) throw new Error('no function ' + name);
  let i = src.indexOf('{', m.index), d = 0, j = i;
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && --d === 0) break; }
  return src.slice(m.index, j + 1);
}
const L = (s) => (s || {}).level || null;

(async () => {
// ════════════════════════════════════════════════════════════════════════════
sec('1 · tenant names');
t('SafeShield Security, LLC → Sunrise Cafe & Bakery LLC is a material mismatch', () => {
  eq(L(AL.compareTenantNames('SafeShield Security, LLC', 'Sunrise Cafe & Bakery LLC')), 'mismatch');
});
t('genuine matches are not flagged: case, punctuation, "&"/"and", legal suffixes, spelled-out letters', () => {
  [['Luxe Nails', 'Luxe Nails'], ['Maple Coffee Co', 'Maple Coffee Co.'], ['ShopRite Supermarkets, Inc', 'ShopRite Supermarkets, Inc.'],
   ['Prime Wellness Spa', 'Prime Wellness Spa'], ['PRIME wellness spa', 'Prime Wellness Spa'], ['Smith & Sons', 'Smith and Sons'],
   ['Acme Hardware, L.L.C.', 'ACME HARDWARE'], ['Shop Rite', 'ShopRite'], ['The Corner Bakery', 'Corner Bakery, Inc.']]
    .forEach(([a, b]) => eq(AL.compareTenantNames(a, b), null, a + ' → ' + b));
});
t('one name only adding descriptive words to the other is the same tenant', () => {
  eq(AL.compareTenantNames('Sunrise Cafe', 'Sunrise Cafe & Bakery LLC'), null);
  eq(AL.compareTenantNames('Luxe Nails', 'Luxe Nails & Spa'), null);
});
t('sharing only a word every such business uses is not agreement: "Joe’s Cafe" → "Sunrise Cafe" is a mismatch', () => {
  eq(L(AL.compareTenantNames("Joe's Cafe", 'Sunrise Cafe')), 'mismatch');
});
t('an uncertain comparison is flagged for a look — never as a mismatch', () => {
  eq(L(AL.compareTenantNames('SafeShield Security, LLC', 'SafeShield Insurance')), 'uncertain', 'same mark, different business');
  eq(L(AL.compareTenantNames('Maple Coffee Co', 'Maple Plaza Coffee')), 'uncertain', 'partial overlap');
  eq(L(AL.compareTenantNames('', 'Luxe Nails')), 'uncertain', 'a blank name');
  eq(L(AL.compareTenantNames('Cafe', 'Bakery')), 'uncertain', 'nothing distinguishing to compare');
});

// ════════════════════════════════════════════════════════════════════════════
sec('2 · the property a lease names');
t('the Pilot’s Sunrise lease names Maple Plaza: it agrees with "Maple plaza"', () => {
  eq(AL.compareProperty('Maple Plaza Shopping Center, 1240 Commerce Blvd, Austin TX 78701', ['Maple plaza']), null);
});
t('a street address cannot be told from a property recorded by name: uncertain, not a mismatch', () => {
  eq(L(AL.compareProperty('500 Main Street', ['Maple plaza'])), 'uncertain');
});
t('a different named property is a material conflict', () => {
  eq(L(AL.compareProperty('Harborview Retail Center', ['Maple plaza'])), 'mismatch');
});
t('nothing to compare raises nothing; any one of the acquisition’s names that agrees is enough', () => {
  eq(AL.compareProperty('', ['Maple plaza']), null);
  eq(AL.compareProperty('Maple Plaza', []), null);
  eq(AL.compareProperty('Harborview Retail Center', ['Deal 7', 'Harborview']), null);
});

// ════════════════════════════════════════════════════════════════════════════
sec('3 · matchConcerns / requiresReason');
const SAFESHIELD = { tenant_name: 'SafeShield Security, LLC', property_name: '500 Main Street', _fileName: 'messy_scanned_lease.pdf' };
const SUNRISE_FAM = { id: 'c99dda4d-b477-4098-a9e3-2af250a6b8af', label: 'Sunrise Cafe & Bakery LLC' };
t('SafeShield → Sunrise: a tenant-name mismatch and an uncertain property; a reason is required', () => {
  const c = AL.matchConcerns(SAFESHIELD, SUNRISE_FAM, { acquisitionNames: ['Maple plaza'] });
  eq(c.map(x => [x.kind, x.level]), [['tenant_name', 'mismatch'], ['property_name', 'uncertain']]);
  ok(/SafeShield Security, LLC/.test(c[0].text) && /Sunrise Cafe & Bakery LLC/.test(c[0].text) && /do not match/.test(c[0].text), c[0].text);
  ok(/500 Main Street/.test(c[1].text) && /may not match/.test(c[1].text), c[1].text);
  eq(AL.requiresReason(c), true);
});
t('the Pilot’s three genuine matches raise nothing', () => {
  const fam = (id) => F.families.find(f => f.id === id);
  const row = (id) => F.tenants.find(r => r.id === id);
  [['ef57f534-9d56-4b49-a12d-ba0f6be65bf1', F.FAM.luxe], ['6bfe2b5e-c418-4248-b6d5-6888e7563dd3', F.FAM.prime],
   ['fbfa929b-5013-475c-838e-af8b03cacd44', F.FAM.coffee || F.families.find(f => /Coffee/.test(f.label)).id]]
    .forEach(([r, f]) => eq(AL.matchConcerns(row(r), fam(f), { acquisitionNames: ['Maple plaza'] }), [], row(r).tenant_name));
});
t('only uncertain concerns: a look is asked for, a reason is not required', () => {
  const c = AL.matchConcerns({ tenant_name: 'SafeShield Security, LLC' }, { label: 'SafeShield Insurance' }, {});
  eq(c.map(x => x.level), ['uncertain']);
  eq(AL.requiresReason(c), false);
});

// ════════════════════════════════════════════════════════════════════════════
sec('4 · leaseholds with no lease on file');
const FAMS = [{ id: 'f1', label: 'ShopRite' }, { id: 'f2', label: 'Sunrise Cafe & Bakery LLC' }, { id: 'f3', label: 'Luxe' }, { id: 'f4', label: 'Prime' }];
const DOCS = [{ id: 'd1', family_id: 'f1' }, { id: 'd3', family_id: 'f3', superseded_by_document_id: 'd9' }, { id: 'd4', family_id: 'f4' }];
t('a leasehold no live document is filed into is named; a replaced document does not count', () => {
  eq(AL.documentlessLeaseholds(FAMS, DOCS, {}), [{ familyId: 'f2', label: 'Sunrise Cafe & Bakery LLC' }, { familyId: 'f3', label: 'Luxe' }]);
});
t('a document set aside as not relevant or a duplicate does not count either', () => {
  eq(AL.documentlessLeaseholds(FAMS, DOCS, { d4: { action: 'duplicate' } }).map(l => l.familyId), ['f2', 'f3', 'f4']);
});
t('an acknowledgement settles only its own leasehold, and only for this condition', () => {
  const acks = { f2: { condition: AL.NO_DOCUMENT_ON_FILE }, f3: { condition: 'something_else' } };
  eq(AL.unacknowledgedDocumentless(FAMS, DOCS, acks, {}).map(l => l.familyId), ['f3']);
});
t('Maple Plaza as the Pilot holds it (four leaseholds, each with its lease) has none', () => {
  eq(AL.documentlessLeaseholds(F.families, F.documents, {}), []);
});

// ════════════════════════════════════════════════════════════════════════════
sec('5 · the page’s resolution path, run');
const AW_ = AW;
function world(opts) {
  const o = opts || {};
  const review = { id: F.REVIEW, name: 'Maple plaza', status: o.status || 'complete', property_id: 'prop-1', updated_at: 'rev-0',
    data: JSON.parse(JSON.stringify({ tenants: F.tenants, invoices: [], activity: [], extractionResolutions: o.resolutions || {} })) };
  if (o.status === 'converted') review.data.conversionRecord = { propertyId: 'prop-1' };
  const SUNRISE = { id: 'c99dda4d-b477-4098-a9e3-2af250a6b8af', label: 'Sunrise Cafe & Bakery LLC', tenant_hint: 'Sunrise Cafe & Bakery LLC' };
  const fams = F.families.concat(o.noSunrise ? [] : [SUNRISE]);
  const calls = { saves: 0, from: 0, renders: 0 };
  const rows = F.tenants.map(r => Object.assign({}, r, r.id === '1f89d42e-0651-490c-b6f7-ffc091f8eb0c' ? { property_name: '500 Main Street' } : {}));
  const sandbox = {
    _AL: () => AL, _AW: () => AW_, _acqActor: () => ({ uid: 'u1', email: null }),
    _acqReviews: [review], _activeAcqId: review.id, _props: [{ id: 'prop-1', name: 'Maple Plaza' }],
    _acqFrozen: (r) => AW_.isFrozen(typeof r === 'object' ? r : review),
    _acqRefuseFrozen: (r) => AW_.isFrozen(typeof r === 'object' ? r : review),
    _acqUnmatched: () => AL.unmatchedEntries({ rows: rows.map(r => Object.assign({}, r, { _source: 'unfiled', _legacyWhy: 'no_document' })) },
      review.data.extractionResolutions, fams),
    _acqFamilyRows: () => fams,
    _acqResolutions: () => review.data.extractionResolutions || {},
    _acqDocRows: () => F.documents,
    _acqDocDispositions: () => (review.data.documentDispositions || {}),
    _acqSaveFamily: async () => null,
    _acqRecordLoaded: () => true, _acqUnresolvedExtractions: () => 0, _acqPendingDocuments: () => [],
    _acqLeaseholdsOnly: () => [{}], _acqCanonicalRows: () => ({}), _acqAnalysisStale: () => '',
    _saveAcqReview: async () => { calls.saves++; return true; },
    _renderAcqDocuments: () => { calls.renders++; }, _renderAcqSection: () => {}, _renderAcqConvertAction: () => {},
    showToast: () => {},
    db: { auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) }, from: () => { calls.from++; throw new Error('no table writes expected'); } },
    _acqRecord: null,
    Object, Array, JSON, String, Date, Promise, Error,
  };
  const names = ['_acqRecord', '_acqAcquisitionNames', '_acqMatchConcerns', 'acqResolveExtraction', '_acqConversionBlock',
                 '_acqLeaseholdAcknowledgements', '_acqDocumentlessLeaseholds', '_acqUnacknowledgedDocumentless', 'acqAcknowledgeDocumentless'];
  vm.createContext(sandbox);
  vm.runInContext(names.map(n => fnSource(SCRIPT, n)).join('\n') + '\n'
    + "const _ACQ_NO_DOCUMENT_TEXT = 'x';\n"
    + names.map(n => 'this.' + n + ' = ' + n + ';').join('\n'), sandbox);
  return { sandbox, review, calls, SUNRISE };
}
const SAFE_ROW = '1f89d42e-0651-490c-b6f7-ffc091f8eb0c', LUXE_ROW = 'ef57f534-9d56-4b49-a12d-ba0f6be65bf1';
const snap = (r) => JSON.stringify(r.data);

await ta('SafeShield → Sunrise unconfirmed (as the bare dropdown used to write it): refused, nothing written', async () => {
  const w = world(); const before = snap(w.review);
  eq(await w.sandbox.acqResolveExtraction(SAFE_ROW, 'matched', w.SUNRISE.id), false);
  eq(snap(w.review), before); eq(w.calls.saves, 0);
});
await ta('confirmed without a reason: refused — a material mismatch needs one; nothing written', async () => {
  const w = world(); const before = snap(w.review);
  eq(await w.sandbox.acqResolveExtraction(SAFE_ROW, 'matched', w.SUNRISE.id, { confirmed: true, reason: '   ' }), false);
  eq(snap(w.review), before); eq(w.calls.saves, 0);
});
await ta('a reason without confirmation: refused', async () => {
  const w = world(); const before = snap(w.review);
  eq(await w.sandbox.acqResolveExtraction(SAFE_ROW, 'matched', w.SUNRISE.id, { reason: 'seller says so' }), false);
  eq(snap(w.review), before);
});
await ta('confirmed with a reason: the resolution and the activity entry record the concerns and the reason', async () => {
  const w = world();
  eq(await w.sandbox.acqResolveExtraction(SAFE_ROW, 'matched', w.SUNRISE.id, { confirmed: true, reason: 'Seller confirms same occupant' }), true);
  const res = w.review.data.extractionResolutions[SAFE_ROW];
  eq([res.action, res.familyId, res.reason], ['matched', w.SUNRISE.id, 'Seller confirms same occupant']);
  eq(res.concerns.map(c => [c.kind, c.level]), [['tenant_name', 'mismatch'], ['property_name', 'uncertain']]);
  const act = w.review.data.activity[w.review.data.activity.length - 1];
  eq(act.type, 'extraction_resolved');
  eq([act.meta.rowId, act.meta.reason, act.meta.concerns.length], [SAFE_ROW, 'Seller confirms same occupant', 2]);
  ok(/confirmed by a person despite/.test(act.summary) && /Reason: Seller confirms same occupant/.test(act.summary), act.summary);
  eq(w.calls.saves, 1);
});
await ta('a genuine match (Luxe Nails → Luxe Nails) is recorded at once, as before, with no concern fields', async () => {
  const w = world();
  eq(await w.sandbox.acqResolveExtraction(LUXE_ROW, 'matched', F.FAM.luxe), true);
  const res = w.review.data.extractionResolutions[LUXE_ROW];
  eq([res.action, res.familyId, 'concerns' in res, 'reason' in res], ['matched', F.FAM.luxe, false, false]);
  const act = w.review.data.activity[w.review.data.activity.length - 1];
  eq(Object.keys(act.meta).sort(), ['action', 'familyId', 'rowId']);
});
await ta('the property name is checked against the property’s own name too', async () => {
  const w = world();
  eq(w.sandbox._acqAcquisitionNames(w.review), ['Maple plaza', 'Maple Plaza'].filter((v, i, a) => a.indexOf(v) === i));
});
await ta('a frozen (converted) acquisition: no match is written, confirmed or not', async () => {
  const w = world({ status: 'converted' }); const before = snap(w.review);
  eq(await w.sandbox.acqResolveExtraction(LUXE_ROW, 'matched', F.FAM.luxe), false);
  eq(await w.sandbox.acqResolveExtraction(SAFE_ROW, 'matched', w.SUNRISE.id, { confirmed: true, reason: 'x' }), false);
  eq(snap(w.review), before); eq(w.calls.saves, 0);
});
t('the dropdown asks first: its change handler goes through acqRequestMatch, never straight to a write', () => {
  ok(/acqRequestMatch\(sel\.getAttribute\('data-row'\), sel\.value\)/.test(SCRIPT), 'the change handler does not request');
  ok(!/acqResolveExtraction\(sel\.getAttribute\('data-row'\), _AL\(\)\.RESOLUTION\.MATCHED, sel\.value\)/.test(SCRIPT), 'the old direct write is still there');
  const cancel = fnSource(SCRIPT, 'acqCancelPendingMatch');
  ok(!/acqResolveExtraction|_saveAcqReview|_acqRecord/.test(cancel), 'Cancel writes');
});

// ════════════════════════════════════════════════════════════════════════════
sec('6 · the conversion gate: no lease on file');
await ta('Sunrise with no document blocks conversion, named, saying an acknowledgement verifies nothing', async () => {
  const w = world();
  const why = w.sandbox._acqConversionBlock(w.review);
  ok(/Sunrise Cafe & Bakery LLC/.test(why) && /no lease document on file/.test(why) && /does not verify any term/.test(why), why);
});
await ta('acknowledging it: recorded on the review and in the activity, verifiesTerms false; the gate then passes', async () => {
  const w = world();
  const decisionsBefore = JSON.stringify(F.decisions);
  eq(await w.sandbox.acqAcknowledgeDocumentless(w.SUNRISE.id), true);
  const a = w.review.data.leaseholdAcknowledgements[w.SUNRISE.id];
  eq([a.condition, a.verifiesTerms, a.label, a.by], [AL.NO_DOCUMENT_ON_FILE, false, 'Sunrise Cafe & Bakery LLC', 'u1']);
  ok(typeof a.at === 'string' && a.at.length >= 20);
  const act = w.review.data.activity[w.review.data.activity.length - 1];
  eq([act.type, act.meta.familyId, act.meta.verifiesTerms, act.meta.condition], ['leasehold_acknowledged', w.SUNRISE.id, false, AL.NO_DOCUMENT_ON_FILE]);
  ok(/does not verify them/.test(act.summary) && !/verified\b(?! by)/i.test(act.summary.replace('does not verify them', '')), act.summary);
  eq(w.sandbox._acqConversionBlock(w.review), '');
  eq(w.calls.from, 0, 'a table was written — the acknowledgement touches no decision, document or leasehold');
  eq(JSON.stringify(F.decisions), decisionsBefore);
});
await ta('acknowledging twice records once; a leasehold that has its lease cannot be acknowledged', async () => {
  const w = world();
  eq(await w.sandbox.acqAcknowledgeDocumentless(w.SUNRISE.id), true);
  const n = w.review.data.activity.length;
  eq(await w.sandbox.acqAcknowledgeDocumentless(w.SUNRISE.id), false);
  eq(await w.sandbox.acqAcknowledgeDocumentless(F.FAM.luxe), false);
  eq(w.review.data.activity.length, n);
});
await ta('a frozen acquisition is never acknowledged on', async () => {
  const w = world({ status: 'converted' }); const before = snap(w.review);
  eq(await w.sandbox.acqAcknowledgeDocumentless(w.SUNRISE.id), false);
  eq(snap(w.review), before); eq(w.calls.saves, 0);
});
await ta('with every leasehold’s lease on file, nothing is asked and the gate is as before', async () => {
  const w = world({ noSunrise: true });
  eq(w.sandbox._acqConversionBlock(w.review), '');
});
t('the activity vocabulary lists the new entry type', () => {
  ok(AW.ACTIVITY_TYPES.indexOf('leasehold_acknowledged') >= 0);
});
t('the page never words an acknowledgement as a verification', () => {
  const html = fnSource(SCRIPT, '_acqDocumentlessHtml');
  ok(/_ACQ_ACK_NOT_VERIFIED/.test(html) && /_ACQ_NO_DOCUMENT_TEXT/.test(html));
  ok(/does not verify any lease term; its terms remain not established/.test(SCRIPT));
});

console.log('\n' + '─'.repeat(66));
console.log('RESULT: ' + pass + ' passed, ' + fail + ' failed');
if (fail) { console.log('FAILED:'); failures.forEach(f => console.log('  - ' + f)); process.exit(1); }
})();
