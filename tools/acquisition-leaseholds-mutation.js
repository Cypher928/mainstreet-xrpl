'use strict';
/**
 * tools/acquisition-leaseholds-mutation.js — would anyone notice if an
 * unmatched extraction became a tenant again?
 *
 *   node tools/acquisition-leaseholds-mutation.js
 *
 * Each mutant undoes ONE part of Option B (docs/ACQUISITION_REVIEW.md §4n),
 * and at least one of test-acquisition-leaseholds-only.js,
 * test-e2e-acquisition-leaseholds-only.js and test-e2e-acquisition-canonical.js
 * must fail for every one.
 *
 *   What reaches the analysis — acquisition-leasehold.js, script.js
 *     L01  analysisRows lets the unmatched rows through
 *     L02  the analysis is built from every canonical row again
 *     L03  conversion builds tenants from every canonical row again
 *     L15  an analysis of no leasehold is run and stored
 *
 *   Staleness — script.js
 *     L04  an analysis that counted unmatched rows does not read as out of date
 *     L10  the Decision Report prints an out-of-date analysis
 *     L17  the Rent Roll stops saying the unmatched are not counted
 *
 *   The conversion gate — script.js
 *     L05  unresolved extractions do not block conversion
 *     L06  an out-of-date analysis does not block conversion
 *     L07  the conversion itself skips the gate
 *     L08  the confirmation opens past the gate
 *     L09  the Acquire button is not disabled
 *
 *   Resolutions — acquisition-leasehold.js, script.js
 *     L12  a match is honoured for a row whose document is on file
 *     L13  a match is honoured after its leasehold is gone
 *     L14  resolving an extraction deletes its raw row
 *     L16  a resolution names nobody
 *     L18  the unresolved count counts resolved entries too
 *
 *   The card — script.js
 *     L11  the review card counts raw uploads again
 *
 *   Source documents in the gate — acquisition-documents.js, script.js
 *     D01  a filing the AI proposed counts as placed
 *     D02  a person's disposition is ignored
 *     D03  a copy replaced by a newer upload is counted as waiting
 *     D04  the gate ignores the documents
 *     D05  Confirm leasehold leaves the filing a proposal
 *     D06  Match to a leasehold files it as an AI proposal
 *     D07  disposing of a document leaves its extraction unresolved
 *     D08  dismissing an extraction leaves its document waiting
 *     D09  Undo on a document leaves its extraction dismissed
 *
 *   No consumer reads a stale analysis — script.js, ai-workspace.js,
 *   command-center.js, document-drafting.js, acquisition-engine.js
 *     X01  an analysis that counted unmatched rows is handed on
 *     X02  an analysis that cannot be checked is handed on
 *     X03  an analysis older than the record is handed on
 *     X04  Ask AI answers from a stale analysis
 *     X05  the Command Center acts on a stale analysis
 *     X06  drafting drafts from a stale analysis
 *     X07  the portfolio calls a gated review Ready to convert
 *     X08  Ask AI is handed the stored reviews again
 *
 * Not mutated, and why: _acqEnsureRecord's early loads — every walk opens the
 * review and waits for the record, so removing them changes nothing a walk can
 * see; they guard a click made faster than the panel loads.
 *
 * A FAILING BASELINE IS NOT A PASS.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const S = 'script.js', L = 'acquisition-leasehold.js', D = 'acquisition-documents.js',
      AI = 'ai-workspace.js', CC = 'command-center.js', DR = 'document-drafting.js', E = 'acquisition-engine.js';

const MUTANTS = [
  { id: 'L01', file: L, why: 'analysisRows lets the unmatched rows through',
    from: "    return rows.filter(function (r) { return r && r._source === SOURCE.LEASEHOLD; });",
    to:   "    return rows.filter(function (r) { return !!r; });" },
  { id: 'L02', file: S, why: 'the analysis is built from every canonical row again',
    from: '  const tenants  = _acqAnalysisRows(_acqLeaseholdsOnly(canon));',
    to:   '  const tenants  = _acqAnalysisRows(canon.rows);' },
  { id: 'L03', file: S, why: 'conversion builds tenants from every canonical row again',
    from: '  const rows  = _acqAnalysisRows(_acqLeaseholdsOnly(canon)).map(t => {',
    to:   '  const rows  = _acqAnalysisRows(canon.rows).map(t => {' },
  { id: 'L04', file: S, why: 'an analysis that counted unmatched rows does not read as out of date',
    from: "  if (a.canonical.basis !== 'leaseholds') return 'This analysis counted",
    to:   "  if (false) return 'This analysis counted" },
  { id: 'L05', file: S, why: 'unresolved extractions do not block conversion',
    from: "  const u = _acqUnresolvedExtractions(id);\n  const docs",
    to:   "  const u = 0;\n  const docs" },
  { id: 'L06', file: S, why: 'an out-of-date analysis does not block conversion',
    from: "  if (stale) return stale + ' Refresh the analysis from MainStreet’s Record before acquiring.';",
    to:   "  if (false) return stale + ' Refresh the analysis from MainStreet’s Record before acquiring.';" },
  { id: 'L07', file: S, why: 'the conversion itself skips the gate',
    from: '  const _blocked = _acqConversionBlock(review);\n  if (_blocked) {',
    to:   "  const _blocked = '';\n  if (_blocked) {" },
  { id: 'L08', file: S, why: 'the confirmation opens past the gate',
    from: '  if (blocked) { showToast(blocked,',
    to:   '  if (false) { showToast(blocked,' },
  { id: 'L09', file: S, why: 'the Acquire button is not disabled',
    from: "    el.innerHTML = why\n      ? `<button class=\"acq-convert-btn\" disabled",
    to:   "    el.innerHTML = false\n      ? `<button class=\"acq-convert-btn\" disabled" },
  { id: 'L10', file: S, why: 'the Decision Report prints an out-of-date analysis',
    from: '  const _stale = _acqAnalysisStale(review);\n  if (_stale) {',
    to:   '  const _stale = _acqAnalysisStale(review);\n  if (false) {' },
  { id: 'L11', file: S, why: 'the review card counts raw uploads again',
    from: '    const lhCount  = _acqCardLeaseholds(r);',
    to:   '    const lhCount  = (d.tenants || []).length;' },
  { id: 'L12', file: L, why: 'a match is honoured for a row whose document is on file',
    from: "                 && r._legacyWhy === 'no_document' && e.familyId && famIds[e.familyId]) ok = true;",
    to:   "                 && e.familyId && famIds[e.familyId]) ok = true;" },
  { id: 'L13', file: L, why: 'a match is honoured after its leasehold is gone',
    from: "                 && r._legacyWhy === 'no_document' && e.familyId && famIds[e.familyId]) ok = true;",
    to:   "                 && r._legacyWhy === 'no_document' && e.familyId) ok = true;" },
  { id: 'L14', file: S, why: 'resolving an extraction deletes its raw row',
    from: "  review.data = Object.assign({}, review.data || {}, { extractionResolutions: res }, docs ? { documentDispositions: docs } : {});\n  const what",
    to:   "  review.data = Object.assign({}, review.data || {}, { extractionResolutions: res, tenants: (review.data.tenants || []).filter(t => String(t.id) !== rowKey) }, docs ? { documentDispositions: docs } : {});\n  const what" },
  { id: 'L15', file: S, why: 'an analysis of no leasehold is run and stored',
    from: "    if (!_acqLeaseholdsOnly(_acqCanonicalRows(review.id)).length) {\n      showToast(_acqNoLeaseholdsMessage(review.id)",
    to:   "    if (false) {\n      showToast(_acqNoLeaseholdsMessage(review.id)" },
  { id: 'L16', file: S, why: 'a resolution names nobody',
    from: '    by: (user && user.id) || null, at: new Date().toISOString(),',
    to:   '    by: null, at: new Date().toISOString(),' },
  { id: 'L17', file: S, why: 'the Rent Roll stops saying the unmatched are not counted',
    from: '    if (c.unmatched) parts.push(',
    to:   '    if (false) parts.push(' },
  { id: 'L18', file: L, why: 'the unresolved count counts resolved entries too',
    from: '.filter(function (x) { return !x.resolution; }).length;',
    to:   '.filter(function (x) { return true; }).length;' },
  { id: 'D01', file: D, why: 'a filing the AI proposed counts as placed',
    from: "        else if (d.family_status !== 'confirmed') {",
    to:   "        else if (false) {" },
  { id: 'D02', file: D, why: "a person's disposition is ignored",
    from: "      if (e && (e.action === DISPOSITION.NOT_RELEVANT || e.action === DISPOSITION.DUPLICATE)) return;",
    to:   "" },
  { id: 'D03', file: D, why: 'a copy replaced by a newer upload is counted as waiting',
    from: "    docs.forEach(function (d) {\n      if (d.superseded_by_document_id) return;",
    to:   "    docs.forEach(function (d) {" },
  { id: 'D04', file: S, why: 'the gate ignores the documents',
    from: '  const docs = _acqPendingDocuments(id);',
    to:   '  const docs = [];' },
  { id: 'D05', file: S, why: 'Confirm leasehold leaves the filing a proposal',
    from: "    familyId: row.family_id, familyStatus: 'confirmed', familySource: 'human',",
    to:   "    familyId: row.family_id, familyStatus: 'proposed', familySource: 'ai'," },
  { id: 'D06', file: S, why: 'Match to a leasehold files it as an AI proposal',
    from: "    familyId, familyStatus: 'confirmed', familySource: 'human',",
    to:   "    familyId, familyStatus: 'proposed', familySource: 'ai'," },
  { id: 'D07', file: S, why: 'disposing of a document leaves its extraction unresolved',
    from: '  if (linked) {\n    res[linked.key]',
    to:   '  if (false) {\n    res[linked.key]' },
  { id: 'D08', file: S, why: 'dismissing an extraction leaves its document waiting',
    from: "  if (action === R.DISMISSED && entry.why === 'unfiled_document') {",
    to:   "  if (false) {" },
  { id: 'D09', file: S, why: 'Undo on a document leaves its extraction dismissed',
    from: '  if (prior.linkedRow && res[prior.linkedRow] && res[prior.linkedRow].linkedDocument === docId) delete res[prior.linkedRow];',
    to:   '' },
  { id: 'X01', file: S, why: 'an analysis that counted unmatched rows is handed on',
    from: "  if (a.canonical.basis !== 'leaseholds') return { state: 'stale',",
    to:   "  if (false) return { state: 'stale'," },
  { id: 'X02', file: S, why: 'an analysis that cannot be checked is handed on',
    from: "  if (!_acqRecordLoaded(review.id)) return { state: 'unchecked', reason: 'it has not yet been checked against MainStreet’s Record', analysis: null };\n  const why = _acqAnalysisStale(review);\n  if (why === null) return { state: 'unchecked',",
    to:   "  if (false) return { state: 'unchecked', reason: 'it has not yet been checked against MainStreet’s Record', analysis: null };\n  const why = _acqAnalysisStale(review);\n  if (false) return { state: 'unchecked'," },
  { id: 'X03', file: S, why: 'an analysis older than the record is handed on',
    from: "  if (why) return { state: 'stale', reason: 'MainStreet’s Record has changed since it was run', analysis: null };",
    to:   "" },
  { id: 'X04', file: AI, why: 'Ask AI answers from a stale analysis',
    from: "        if (rev.analysisState === 'stale' || rev.analysisState === 'unchecked') {",
    to:   "        if (false) {" },
  { id: 'X05', file: CC, why: 'the Command Center acts on a stale analysis',
    from: "      if (rev && (rev.analysisState === 'stale' || rev.analysisState === 'unchecked')) {",
    to:   "      if (false) {" },
  { id: 'X06', file: DR, why: 'drafting drafts from a stale analysis',
    from: "    if (rev.analysisState === 'stale' || rev.analysisState === 'unchecked') {",
    to:   "    if (false) {" },
  { id: 'X07', file: E, why: 'the portfolio calls a gated review Ready to convert',
    from: "(blocked ? ' — Not ready to convert' : ' — Ready to convert'),",
    to:   "' — Ready to convert'," },
  { id: 'X08', file: S, why: 'Ask AI is handed the stored reviews again',
    from: '  const ans = AIWorkspace.answer({ question, context: _aiwContext, wctx: _aiwWctx, props: _props, acqReviews: _acqReviewsForConsumers() });',
    to:   '  const ans = AIWorkspace.answer({ question, context: _aiwContext, wctx: _aiwWctx, props: _props, acqReviews: _acqReviews });' },
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'acq-lh-mut-'));
for (const entry of fs.readdirSync(ROOT)) {
  if (['node_modules', '.git', 'scratchpad', 'evidence', 'assets'].includes(entry)) continue;
  fs.cpSync(path.join(ROOT, entry), path.join(tmp, entry), { recursive: true });
}
try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(tmp, 'node_modules'), 'dir'); } catch (_) {}

const ORIGINAL = {};
[S, L, D, AI, CC, DR, E].forEach(f => { ORIGINAL[f] = fs.readFileSync(path.join(ROOT, f), 'utf8'); });
// The fast suite first: a mutant it kills never pays for a browser. The pin in
// the unit suite reads HEAD from the real checkout (this copy has no .git).
const ENV = Object.assign({}, process.env, { ACQ_REPORT_GIT_ROOT: ROOT });
const SUITES = [['node', 'test-acquisition-leaseholds-only.js'], ['node', 'test-e2e-acquisition-leaseholds-only.js'],
                ['node', 'test-e2e-acquisition-canonical.js']];
function runSuites() {
  for (const [bin, suite] of SUITES) {
    try { execFileSync(bin, [suite], { cwd: tmp, stdio: 'pipe', timeout: 900000, env: ENV }); }
    catch (_) { return false; }
  }
  return true;
}

const baseline = runSuites();
console.log('Baseline (unmutated copy): ' + (baseline ? 'PASS' : 'FAIL'));
if (!baseline) {
  console.error('\nThe unmutated copy does not pass, so every result below would be\n' +
                'meaningless. Nothing is mutated. Fix the harness or the suite first.');
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(2);
}

let killed = 0;
const survived = [];
for (const m of MUTANTS) {
  const src = ORIGINAL[m.file];
  const i = src.indexOf(m.from);
  if (i === -1) { console.log(`  ??   ${m.id}  ANCHOR NOT FOUND in ${m.file} — malformed mutant`); survived.push(m.id + ' (malformed)'); continue; }
  if (src.indexOf(m.from, i + 1) !== -1) {
    console.log(`  ??   ${m.id}  ANCHOR NOT UNIQUE in ${m.file} — malformed mutant`); survived.push(m.id + ' (anchor not unique)'); continue;
  }
  fs.writeFileSync(path.join(tmp, m.file), src.slice(0, i) + m.to + src.slice(i + m.from.length));
  const passed = runSuites();
  fs.writeFileSync(path.join(tmp, m.file), src);
  if (!passed) { killed++; console.log(`  kill ${m.id}  ${m.why}`); continue; }
  survived.push(`${m.id}: ${m.why}`);
  console.log(`  LIVE ${m.id}  ${m.why}`);
}
console.log(`\n${killed}/${MUTANTS.length} killed`);
if (survived.length) { console.log('\nSURVIVORS — each needs a written verdict (real gap or equivalent):'); survived.forEach(s => console.log('  · ' + s)); }
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(survived.length ? 1 : 0);
