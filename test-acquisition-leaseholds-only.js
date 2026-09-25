'use strict';
/**
 * test-acquisition-leaseholds-only.js — Option B: only a canonical leasehold
 * is a tenant (docs/ACQUISITION_REVIEW.md §4n).
 *
 *   node test-acquisition-leaseholds-only.js
 *
 * The pure rules in acquisition-leasehold.js (analysisRows, unmatchedEntries,
 * unresolvedCount), run on Maple Plaza as the Pilot holds it, and the page
 * wiring that routes every analytical consumer through them. The canonical
 * projection itself is pinned to HEAD: this change adds to it, and changes
 * nothing it already did.
 */
const fs   = require('fs');
const path = require('path');
const vm   = require('vm');
const { execFileSync } = require('child_process');

const AT = require('./acquisition-terms.js');
const AL = require('./acquisition-leasehold.js');
const AD = require('./acquisition-documents.js');
const F  = require('./fixtures/maple-plaza-acquisition.js');

function loadLI() {
  const sb = { window: {}, console };
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'lease-intelligence.js'), 'utf8'), sb);
  return sb.window.LeaseIntelligence;
}
function loadAE() {
  const sb = { window: {}, console, module: { exports: {} } };
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'acquisition-engine.js'), 'utf8'), sb);
  return sb.window.AcquisitionEngine || sb.module.exports;
}
const LI = loadLI(), AE = loadAE();

let pass = 0, fail = 0;
const failures = [];
function t(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; failures.push(name + ': ' + e.message); console.log('  ✗ ' + name + '  — ' + e.message); }
}
function sec(s) { console.log('\n── ' + s + ' ' + '─'.repeat(Math.max(0, 60 - s.length))); }
function ok(v, m) { if (!v) throw new Error(m || 'expected truthy'); }
function eq(a, b, m) { if (a !== b) throw new Error((m ? m + ': ' : '') + JSON.stringify(a) + ' !== ' + JSON.stringify(b)); }
function deq(a, b, m) { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error((m ? m + ': ' : '') + x + ' !== ' + y); }

const input = (over) => Object.assign({ families: F.families, documents: F.documents, decisions: F.decisions, tenants: F.tenants }, over || {});
const project = (over) => AL.leaseholdRows(input(over), { terms: AT, reasoner: LI });
const P = project();
const R = AL.RESOLUTION;
const named = (rows) => rows.filter(r => r && (r.tenant_name || r.tenantName) && r._status !== 'error');

console.log('\nAcquisition Review — Option B: only a leasehold is a tenant\n' + '='.repeat(64));

sec('1 · the analysis receives leaseholds, and nothing else');
t('Maple Plaza: the projection holds 10 rows — 4 leaseholds and 6 unmatched extractions', () => {
  eq(P.rows.length, 10); eq(P.leaseholds, 4); eq(P.unfiled, 6);
});
t('analysisRows hands on the 4 leaseholds only', () => {
  const rows = AL.analysisRows(P);
  eq(rows.length, 4);
  ok(rows.every(r => r._source === 'leasehold'));
  deq(rows.map(r => r._leaseholdId).sort(), [F.FAM.shoprite, F.FAM.luxe, F.FAM.coffee, F.FAM.prime].sort());
});
t('no unmatched extraction enters — not Sunrise Cafe, not either SafeShield, not the second Luxe or Prime row', () => {
  const names = AL.analysisRows(P).map(r => r.tenant_name);
  ok(!names.some(n => /Sunrise|SafeShield/.test(n)));
  eq(names.filter(n => /Luxe/.test(n)).length, 1); eq(names.filter(n => /Prime Wellness/.test(n)).length, 1);
});
t('with nothing but raw rows (a pre-document review) there is no tenant at all', () => {
  const lake = AL.leaseholdRows({ families: [], documents: [], decisions: [], tenants: F.tenants.slice(0, 3) }, { terms: AT, reasoner: LI });
  eq(AL.analysisRows(lake).length, 0); eq(lake.unfiled, 3);
});
t('nothing that is not a projection is mistaken for one', () => {
  deq(AL.analysisRows(null), []); deq(AL.analysisRows({}), []); deq(AL.analysisRows({ rows: [null, { _source: 'unfiled' }] }), []);
});

sec('2 · duplicate uploads make no duplicate tenant');
t('uploading Luxe Nails and Prime Wellness again adds unmatched entries — never an analytical tenant', () => {
  const dupes = [
    { id: 'dup-1', tenant_name: 'Luxe Nails', leased_sqft: 3000, _status: 'ok', _fileName: 'Luxe_Nails_Lease.pdf' },
    { id: 'dup-2', tenant_name: 'Prime Wellness Spa', leased_sqft: 4500, _status: 'ok', _fileName: 'Prime_Wellness_Spa_Lease.pdf' },
  ];
  const p2 = project({ tenants: F.tenants.concat(dupes) });
  eq(AL.analysisRows(p2).length, 4, 'a duplicate upload became a tenant');
  eq(p2.unfiled, 8);
  eq(AL.unresolvedCount(p2, {}, F.families), 8, 'a duplicate upload was silently dropped instead of waiting for a person');
});

sec('3 · occupancy, recovery and rollover are the leaseholds\'');
const INV = [{ id: 'inv-test', vendorName: 'Test (test data)', amount: 24000, category: 'landscaping' }];
const lhReport  = AE.buildAcquisitionReport(named(AL.analysisRows(P)), INV, 100000);
const allReport = AE.buildAcquisitionReport(named(P.rows), INV, 100000);
t('occupied area is 77,500 sf — the 6 would have made it 101,300 sf, over 100%', () => {
  eq(lhReport.rentRoll.occupancy.occupiedSqft, 77500);
  eq(allReport.rentRoll.occupancy.occupiedSqft, 101300);
});
t('4 tenant rows in the report, not 10', () => {
  eq(lhReport.tenantSummary.length, 4); eq(allReport.tenantSummary.length, 10);
});
t('rollover names only leaseholds', () => {
  ok(!/Sunrise|SafeShield/.test(JSON.stringify(lhReport.rentRoll.rolloverRisk || {})));
});
t('recovery is computed over the leaseholds alone — it differs from the 10-row figure', () => {
  ok(JSON.stringify(lhReport.revenueRecovery) !== JSON.stringify(allReport.revenueRecovery)
     || JSON.stringify(lhReport.summary) !== JSON.stringify(allReport.summary));
});

sec('4 · unmatched extractions, and what a person may decide');
const U = AL.unmatchedEntries(P, {}, F.families);
const byName = (n, f) => U.find(x => x.row.tenant_name === n && (!f || x.row._fileName === f));
t('six entries, each keyed by its raw row, none resolved', () => {
  eq(U.length, 6); ok(U.every(x => x.key && x.resolution === null)); eq(AL.unresolvedCount(P, {}, F.families), 6);
});
t('five have no document on file; SafeShield Insurance\'s document is on file, unmatched', () => {
  eq(U.filter(x => x.why === 'no_document').length, 5);
  eq(byName('SafeShield Insurance').why, 'unfiled_document');
});
t('a match to an existing leasehold resolves a row with no document', () => {
  const k = byName('Luxe Nails', 'Luxe_Nails_Lease.pdf').key;
  const res = { [k]: { action: R.MATCHED, familyId: F.FAM.luxe } };
  eq(AL.unresolvedCount(P, res, F.families), 5);
  eq(AL.unmatchedEntries(P, res, F.families).find(x => x.key === k).resolution.action, 'matched');
});
t('…but not when the leasehold it names no longer exists — the entry is unresolved again', () => {
  const k = byName('Luxe Nails', 'Luxe_Nails_Lease.pdf').key;
  eq(AL.unresolvedCount(P, { [k]: { action: R.MATCHED, familyId: 'gone' } }, F.families), 6);
  eq(AL.unresolvedCount(P, { [k]: { action: R.MATCHED, familyId: F.FAM.luxe } }, F.families.filter(f => f.id !== F.FAM.luxe)), 6);
});
t('a new leasehold resolves it once that leasehold exists', () => {
  const k = byName('Sunrise Cafe & Bakery LLC').key;
  const fam = { id: 'fam-sunrise', label: 'Sunrise Cafe & Bakery LLC' };
  eq(AL.unresolvedCount(P, { [k]: { action: R.NEW_LEASEHOLD, familyId: fam.id } }, F.families.concat([fam])), 5);
  eq(AL.unresolvedCount(P, { [k]: { action: R.NEW_LEASEHOLD, familyId: fam.id } }, F.families), 6);
});
t('a dismissal resolves any entry — with or without a document', () => {
  const res = {};
  U.forEach(x => { res[x.key] = { action: R.DISMISSED }; });
  eq(AL.unresolvedCount(P, res, F.families), 0);
});
t('an entry whose document is on file is NOT resolved by a match here — it is filed in Documents', () => {
  const k = byName('SafeShield Insurance').key;
  eq(AL.unresolvedCount(P, { [k]: { action: R.MATCHED, familyId: F.FAM.shoprite } }, F.families), 6);
});
t('an unknown action, an empty entry, or an entry for a row with no id resolves nothing', () => {
  const k = byName('Sunrise Cafe & Bakery LLC').key;
  eq(AL.unresolvedCount(P, { [k]: { action: 'fuzzy_match', familyId: F.FAM.shoprite } }, F.families), 6);
  eq(AL.unresolvedCount(P, { [k]: null }, F.families), 6);
  const noId = project({ tenants: [{ tenant_name: 'No Id Tenant', _status: 'ok' }] });
  const e = AL.unmatchedEntries(noId, { undefined: { action: R.DISMISSED } }, F.families)[0];
  ok(e && e.key === null && e.resolution === null);
});
t('there is no automatic matching: resolutions come only from what a person recorded', () => {
  eq(AL.unresolvedCount(P, undefined, F.families), 6);
  eq(AL.unresolvedCount(P, {}, F.families), 6);
});

sec('4b · every source document needs a person\'s disposition');
const PD = (docs, fams, disp) => AD.pendingDocuments(docs, fams, disp).map(p => p.doc.file_name + ' (' + p.reasons.join('; ') + ')');
t('Maple Plaza: 4 documents wait — SafeShield unplaced and untyped, and 3 that only the AI filed', () => {
  deq(PD(F.documents, F.families, {}), [
    'SafeShield_Insurance_Lease.pdf (type not set; not matched to a tenant)',
    'ShopRite_Anchor_Tenant_Lease.pdf (filed into ShopRite Supermarkets, Inc. by AI — not confirmed by a person)',
    'maple_plaza_messy_lease.pdf (filed into Maple Coffee Co. by AI — not confirmed by a person)',
    'Prime_Wellness_Spa_Lease.pdf (filed into Prime Wellness Spa by AI — not confirmed by a person)',
  ]);
});
t('a copy replaced by a newer upload of the same name is not waiting — it was replaced, and is kept', () => {
  const superseded = F.documents.filter(d => d.superseded_by_document_id);
  eq(superseded.length, 2);
  ok(!AD.pendingDocuments(superseded, F.families, {}).length);
});
t('a person\'s disposition — not relevant, or a duplicate — settles a document; anything else does not', () => {
  const safe = F.documents.find(d => d.file_name === 'SafeShield_Insurance_Lease.pdf');
  eq(PD([safe], F.families, { [safe.id]: { action: AD.DISPOSITION.NOT_RELEVANT } }).length, 0);
  eq(PD([safe], F.families, { [safe.id]: { action: AD.DISPOSITION.DUPLICATE } }).length, 0);
  eq(PD([safe], F.families, { [safe.id]: { action: 'looks_fine' } }).length, 1);
});
t('a filing confirmed by a person settles it; one the AI proposed does not; one whose leasehold is gone does not', () => {
  const doc = Object.assign({}, F.documents.find(d => d.file_name === 'maple_plaza_messy_lease.pdf'));
  eq(PD([Object.assign({}, doc, { family_status: 'confirmed' })], F.families, {}).length, 0);
  eq(PD([doc], F.families, {}).length, 1);
  deq(PD([Object.assign({}, doc, { family_status: 'confirmed' })], F.families.filter(f => f.id !== doc.family_id), {}),
      ['maple_plaza_messy_lease.pdf (its leasehold no longer exists)']);
});
t('a document filed by a person but of no known type still waits — "type not set"', () => {
  const d = { id: 'x', file_name: 'x.pdf', doc_type: null, family_id: F.FAM.luxe, family_status: 'confirmed' };
  deq(PD([d], F.families, {}), ['x.pdf (type not set)']);
});
t('a document that belongs to the purchase, not a lease (a rent roll, the PSA), is not waiting', () => {
  eq(PD([{ id: 'rr', file_name: 'rr.pdf', doc_type: 'rent_roll', doc_type_status: 'confirmed' }], F.families, {}).length, 0);
});
t('there is no automatic placing: with no dispositions, nothing unconfirmed is ever settled', () => {
  eq(AD.pendingDocuments(F.documents, F.families, undefined).length, 4);
});

sec('4c · the portfolio says Ready only when nothing waits');
t('a complete review that is gated reads "Not ready to convert", with what remains', () => {
  const acts = AE.computePortfolioActions([], [{ id: 'r1', name: 'Maple Plaza', status: 'complete', conversionBlocked: '6 extracted entries …' }]);
  const a = acts.infoActions.find(x => x.reviewId === 'r1');
  eq(a.title, 'Maple Plaza — Not ready to convert'); eq(a.detail, '6 extracted entries …');
});
t('…and "Ready to convert" only when nothing does', () => {
  const acts = AE.computePortfolioActions([], [{ id: 'r2', name: 'Oak', status: 'complete', conversionBlocked: null }]);
  eq(acts.infoActions.find(x => x.reviewId === 'r2').title, 'Oak — Ready to convert');
});

sec('5 · the raw extraction history is preserved');
t('projecting, choosing analysis rows and resolving never change review.data.tenants', () => {
  const tenants = JSON.parse(JSON.stringify(F.tenants));
  const before = JSON.stringify(tenants);
  const p = AL.leaseholdRows(input({ tenants }), { terms: AT, reasoner: LI });
  AL.analysisRows(p);
  const res = {}; AL.unmatchedEntries(p, {}, F.families).forEach(x => { res[x.key] = { action: R.DISMISSED }; });
  AL.unmatchedEntries(p, res, F.families); AL.unresolvedCount(p, res, F.families);
  eq(JSON.stringify(tenants), before);
  eq(tenants.length, 13);
});

sec('6 · the canonical model is unchanged');
const SRC = fs.readFileSync(path.join(__dirname, 'acquisition-leasehold.js'), 'utf8');
const fnText = (src, name) => { const m = new RegExp('\\n  function ' + name + '\\(').exec(src); if (!m) return null;
  let i = src.indexOf('{', m.index), d = 0, j = i; for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) break; } } return src.slice(m.index, j + 1); };
let HEAD_SRC = null;
try { HEAD_SRC = execFileSync('git', ['show', 'HEAD:acquisition-leasehold.js'], { cwd: process.env.ACQ_REPORT_GIT_ROOT || __dirname, encoding: 'utf8' }); } catch (_) {}
['leaseholdRows', 'legacyRows', 'tenantRowFor', 'canonicalValue', 'attachStates', 'cellState'].forEach(name => {
  t(`${name} is byte-for-byte what it was`, () => {
    if (HEAD_SRC === null) { console.log('    (no git here — skipped, not passed)'); return; }
    ok(fnText(SRC, name) && fnText(SRC, name) === fnText(HEAD_SRC, name), name + ' changed');
  });
});

sec('7 · the page routes every analytical consumer through the rule');
const S = fs.readFileSync(path.join(__dirname, 'script.js'), 'utf8');
function fnBody(src, name) {
  const re = new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\(');
  const m = re.exec(src); if (!m) throw new Error('no function ' + name);
  let i = src.indexOf('{', m.index), depth = 0, j = i;
  for (; j < src.length; j++) { if (src[j] === '{') depth++; else if (src[j] === '}') { depth--; if (!depth) break; } }
  return src.slice(i, j + 1);
}
t('the analysis is built from the leaseholds only — so Risk Analysis, Rent Roll, CSV and the stored analysis are', () => {
  const B = fnBody(S, '_acqBuildAnalysis');
  ok(/const tenants  = _acqAnalysisRows\(_acqLeaseholdsOnly\(canon\)\);/.test(B));
  ok(/basis: 'leaseholds'/.test(B));
  ok(/AL \? AL\.analysisRows\(canon\) : \[\]/.test(fnBody(S, '_acqLeaseholdsOnly')), 'without the module, raw rows would pass');
});
t('conversion takes the leaseholds only', () => {
  ok(/_acqAnalysisRows\(_acqLeaseholdsOnly\(canon\)\)/.test(fnBody(S, '_acqConversionReview')));
});
t('an analysis that counted unmatched rows, or is older than the record, reads as out of date', () => {
  const B = fnBody(S, '_acqAnalysisStale');
  ok(/a\.canonical\.basis !== 'leaseholds'/.test(B));
  ok(/_acqCanonicalFingerprint\(_acqLeaseholdsOnly\(canon\)\)/.test(B));
});
t('the conversion gate is enforced at the button, the confirmation and the conversion itself', () => {
  ok(/_acqConversionBlock\(review\)/.test(fnBody(S, '_renderAcqConvertAction')));
  ok(/_acqConversionBlock\(review\)/.test(fnBody(S, '_showAcqConvertModal')));
  const C = fnBody(S, 'convertAcquisitionToProperty');
  ok(/await _acqEnsureRecord\(review\.id\);\s*const _blocked = _acqConversionBlock\(review\);/.test(C));
  ok(C.indexOf('_acqConversionBlock(review)') < C.indexOf('buildPropertyFromReview'), 'the gate is checked after the property is built');
  const G = fnBody(S, '_acqConversionBlock');
  ok(/_acqUnresolvedExtractions\(id\)/.test(G) && /_acqAnalysisStale\(review\)/.test(G) && /_acqRecordLoaded\(id\)/.test(G));
});
t('the Decision Report refuses an out-of-date analysis', () => {
  const D = fnBody(S, 'generateAcquisitionReport');
  ok(/const _stale = _acqAnalysisStale\(review\);\s*if \(_stale\) \{/.test(D) && /_acqRecordLoaded\(review\.id\)/.test(D));
});
t('an analysis of no leasehold is refused, never stored', () => {
  ok(/if \(!_acqLeaseholdsOnly\(_acqCanonicalRows\(review\.id\)\)\.length\)/.test(fnBody(S, 'runAcquisitionAnalysis')));
  ok(/if \(!_acqLeaseholdsOnly\(_acqCanonicalRows\(reviewId\)\)\.length\)/.test(fnBody(S, '_acqRefreshAnalysis')));
});
t('the review card counts leaseholds, never raw uploads', () => {
  const C = fnBody(S, '_renderAcqSection');
  ok(/_acqCardLeaseholds\(r\)/.test(C) && !/\(d\.tenants\s*\|\|\s*\[\]\)\.length/.test(C), 'the card still counts raw uploads');
  ok(!/> Tenants</.test(C));
});
t('a resolution is recorded by a person, and never touches review.data.tenants', () => {
  const Rz = fnBody(S, 'acqResolveExtraction');
  ok(/extractionResolutions: res/.test(Rz) && /by: \(user && user\.id\) \|\| null/.test(Rz));
  ok(!/data\.tenants|_acqTenants/.test(Rz), 'the resolution writes to the raw rows');
  ok(/if \(action !== R\.DISMISSED && entry\.why !== 'no_document'\) return false;/.test(Rz), 'a document on file could be matched here, around Documents');
});

sec('8 · no consumer reads a stale analysis');
const MODS = { ai: fs.readFileSync(path.join(__dirname, 'ai-workspace.js'), 'utf8'),
               cc: fs.readFileSync(path.join(__dirname, 'command-center.js'), 'utf8'),
               dr: fs.readFileSync(path.join(__dirname, 'document-drafting.js'), 'utf8') };
t('Ask AI, the Command Center, drafting, the action center and the portfolio export are all given the checked view', () => {
  ok(/AIWorkspace\.answer\(\{[^}]*acqReviews: _acqReviewsForConsumers\(\)/.test(S), 'Ask AI');
  ok(/CommandCenter\.buildModel\(\{[^}]*acqReviews: _acqReviewsForConsumers\(\)/.test(S), 'Command Center');
  ok(/DocumentDrafting\.build\(type, \{[^}]*acqReviews: _acqReviewsForConsumers\(\)/.test(S), 'drafting');
  ok(/renderActionCenter\(props, _acqReviewsForConsumers\(\), rar\)/.test(S), 'action center');
  ok(/const reviews = _acqReviewsForConsumers\(\);/.test(fnBody(S, 'exportPortfolioSummary')), 'portfolio export');
  // The guided tour is the one reader left on the stored reviews: it reads
  // names and statuses to pick its steps, and no analysis (guided-tour.js).
  const raw = S.split('\n').filter(l => /acqReviews: _acqReviews\b/.test(l));
  ok(raw.length === 1 && /GuidedTour\.buildSteps/.test(raw[0]), 'a consumer is still handed the stored reviews: ' + raw.join(' | '));
  ok(!/analysis/.test(fs.readFileSync(path.join(__dirname, 'guided-tour.js'), 'utf8')), 'the guided tour now reads an analysis');
});
t('the view carries an analysis only when it is current — never the stored review data', () => {
  const C = fnBody(S, '_acqConsumerAnalysis');
  ok(/a\.canonical\.basis !== 'leaseholds'\) return \{ state: 'stale'/.test(C));
  ok(/if \(!_acqRecordLoaded\(review\.id\)\) return \{ state: 'unchecked'/.test(C));
  ok(/if \(why\) return \{ state: 'stale'/.test(C) && /return \{ state: 'current'/.test(C));
  const V = fnBody(S, '_acqReviewsForConsumers');
  ok(/analysis: c\.analysis/.test(V) && !/data:/.test(V), 'the view passes the review data (and its stored analysis) through');
});
t('each consumer refuses a stale or unchecked analysis', () => {
  ok(/rev\.analysisState === 'stale' \|\| rev\.analysisState === 'unchecked'/.test(MODS.ai) && /the analysis on file is not used/.test(MODS.ai));
  ok(/rev\.analysisState === 'stale' \|\| rev\.analysisState === 'unchecked'/.test(MODS.cc) && /analysis out of date/.test(MODS.cc));
  ok(/rev\.analysisState === 'stale' \|\| rev\.analysisState === 'unchecked'/.test(MODS.dr) && /Not stated: the analysis on file is not used/.test(MODS.dr));
});
t('the acquisition gate counts the documents, from the same rule Documents shows', () => {
  const G = fnBody(S, '_acqConversionBlock');
  ok(/const docs = _acqPendingDocuments\(id\);/.test(G) && /if \(u \|\| docs\.length\)/.test(G));
});

console.log('\n' + '─'.repeat(64));
console.log(`RESULT: ${pass} passed, ${fail} failed`);
if (fail) { console.log('FAILED:'); failures.forEach(f => console.log('  - ' + f)); }
process.exit(fail ? 1 : 0);
