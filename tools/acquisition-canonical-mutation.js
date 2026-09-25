'use strict';
/**
 * tools/acquisition-canonical-mutation.js — would anyone notice if the Rent
 * Roll went back to reading the files instead of the lease terms?
 *
 *   node tools/acquisition-canonical-mutation.js
 *
 * §4l made the resolved terms the one source every consumer reads — the
 * analysis, the Rent Roll and its CSV, conversion — and let a person ENTER a
 * term no document establishes. Every rule it keeps fails silently: a Rent
 * Roll drawn from the raw rows still looks like a Rent Roll; an entered value
 * with no tag still looks verified; a contested term shown as one figure still
 * looks like an answer. So each rule gets a mutant that breaks it quietly, and
 * a SURVIVOR is either a real gap or an equivalent mutant argued for in
 * writing.
 *
 *   The projection — acquisition-leasehold.js
 *     L01  a contested term yields one of its values
 *     L02  an entered value loses its origin
 *     L03  a raw row whose document is in a leasehold is projected too
 *     L04  an unfiled row is marked as a leasehold row
 *     L05  a leasehold is resolved from every document in the review
 *     L06  a leasehold is resolved with every decision in the review
 *     L07  the origins do not ride along to the engine's rows
 *     L08  an entered cell reads verified
 *     L09  an unfiled row's cells read as though they had states
 *     L10  a raw row whose document was replaced is projected
 *
 *   Entering a term — acquisition-terms.js
 *     T01  an entered term is capped by the ceiling
 *     T02  an entered term is recorded as document-stated
 *     T03  an entry may cite a document
 *     T04  an entry is accepted on a term a document establishes
 *     T05  an entry is not validated against the field's type
 *     T06  entered terms are not counted
 *
 *   Provenance in the report — acquisition-report.js / -view.js
 *     R01  an entered fact keeps evidence
 *     R02  an entered fact loses its origin
 *     R03  verified-by-entry is not counted apart
 *     V01  the verified chip drops the entered tag
 *     V02  the entered tag is shortened
 *
 *   The glue — script.js
 *     S01  the analysis is built from the raw upload rows
 *     S02  the states do not ride along to tenantSummary
 *     S03  an act does not refresh the analysis
 *     S04  a contested Rent Roll cell draws a dash
 *     S05  a missing Rent Roll cell draws a dash
 *     S06  an entered Rent Roll cell loses its tag
 *     S07  an unfiled row is drawn like a leasehold row
 *     S08  the CSV carries a contested cell as empty
 *     S09  the CSV drops the Basis column
 *     S10  conversion reads the raw upload rows
 *     S11  a pre-§4l analysis is never flagged as behind the terms
 *     S12  Enter writes a plain correction
 *     S13  Enter acts on a term a document establishes
 *     S14  an entered term still offers Confirm, Correct and Reject
 *     S15  the refreshed analysis is drawn into whichever review is open
 *
 * acquisition-report.js is pinned by sha256 in two suites; its mutants are
 * run against the suites that test BEHAVIOUR, so a kill means the rule held,
 * not that a hash changed.
 *
 * A FAILING BASELINE IS NOT A PASS.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const L = 'acquisition-leasehold.js', T = 'acquisition-terms.js', R = 'acquisition-report.js',
      V = 'acquisition-report-view.js', S = 'script.js';

const BEHAVIOUR = ['test-acquisition-report.js', 'test-e2e-acquisition-canonical.js'];

const MUTANTS = [
  // ── the projection ───────────────────────────────────────────────────────
  { id: 'L01', file: L, why: 'a contested term yields one of its values',
    from: "    if (term.state === 'conflicting') return null;\n", to: '' },
  { id: 'L02', file: L, why: 'an entered value loses its origin',
    from: "      origins[f] = t.support === 'entered' ? 'entered' : null;", to: '      origins[f] = null;' },
  { id: 'L03', file: L, why: 'a raw row whose document is in a leasehold is projected too',
    from: '      if (doc && doc.family_id && famIds[doc.family_id]) {', to: '      if (false) {' },
  { id: 'L04', file: L, why: 'an unfiled row is marked as a leasehold row',
    from: '      row._source   = SOURCE.UNFILED;', to: '      row._source   = SOURCE.LEASEHOLD;' },
  { id: 'L05', file: L, why: 'a leasehold is resolved from every document in the review',
    from: '      var mine = docs.filter(function (d) { return d.family_id === fam.id; });', to: '      var mine = docs;' },
  { id: 'L06', file: L, why: 'a leasehold is resolved with every decision in the review',
    from: '        ? AT.resolveFamilyTerms(mine, decs.filter(function (d) { return d.family_id === fam.id; }), { reasoner: o.reasoner })',
    to:   '        ? AT.resolveFamilyTerms(mine, decs, { reasoner: o.reasoner })' },
  { id: 'L07', file: L, why: 'the origins do not ride along to the engine\'s rows',
    from: '      t._origins     = r._origins || {};', to: '      t._origins     = {};' },
  { id: 'L08', file: L, why: 'an entered cell reads verified',
    from: "    if ((r._origins || {})[field] === 'entered') return 'entered';\n", to: '' },
  { id: 'L09', file: L, why: 'an unfiled row\'s cells read as though they had states',
    from: "    if (r._source === SOURCE.UNFILED) return 'unverified';\n", to: '' },
  { id: 'L10', file: L, why: 'a raw row whose document was replaced is projected',
    from: '      if (doc && doc.superseded_by_document_id) {', to: '      if (false) {' },

  // ── entering a term ──────────────────────────────────────────────────────
  { id: 'T01', file: T, why: 'an entered term is capped by the ceiling',
    from: "      term.state = 'verified';\n      term.note  = ENTERED_NOTE;",
    to:   "      term.state = _capState('verified', term.ceiling || 'ai_extracted');\n      term.note  = ENTERED_NOTE;" },
  { id: 'T02', file: T, why: 'an entered term is recorded as document-stated',
    from: "      term.support = 'entered';\n      term.derived = false;\n      term.governingDocumentId = null;",
    to:   "      term.support = 'stated';\n      term.derived = false;\n      term.governingDocumentId = null;" },
  { id: 'T03', file: T, why: 'an entry may cite a document',
    from: '      payload.source_document_id = null;\n      payload.source_quote = null;\n      payload.source_page = null;\n',
    to:   '' },
  { id: 'T04', file: T, why: 'an entry is accepted on a term a document establishes',
    from: "      if (term.state !== 'missing') {\n        return { ok: false, error: 'A document establishes this term.",
    to:   "      if (false) {\n        return { ok: false, error: 'A document establishes this term." },
  { id: 'T05', file: T, why: 'an entry is not validated against the field\'s type',
    from: '      if (typed === null || typed === undefined) {', to: '      if (false) {' },
  { id: 'T06', file: T, why: 'entered terms are not counted',
    from: "      if (term && term.support === 'entered') out.entered++;\n", to: '' },

  // ── provenance in the report ─────────────────────────────────────────────
  { id: 'R01', file: R, suites: BEHAVIOUR, why: 'an entered fact keeps evidence',
    from: "        fact.origin   = 'entered';\n        fact.evidence = null;", to: "        fact.origin   = 'entered';" },
  { id: 'R02', file: R, suites: BEHAVIOUR, why: 'an entered fact loses its origin',
    from: "        fact.origin   = 'entered';\n        fact.evidence = null;", to: '        fact.evidence = null;' },
  { id: 'R03', file: R, suites: BEHAVIOUR, why: 'verified-by-entry is not counted apart',
    from: "      if (f.state === 'verified' && f.origin === 'entered') out.verified_entered++;\n", to: '' },
  { id: 'V01', file: V, why: 'the verified chip drops the entered tag',
    from: "    if (st === 'verified' && VERIFIED_ORIGIN_LABEL[f.origin]) {", to: '    if (false) {' },
  { id: 'V02', file: V, why: 'the entered tag is shortened',
    from: "    entered: 'Entered by a person · No document on file supports this value',", to: "    entered: 'Entered'," },

  // ── the glue ─────────────────────────────────────────────────────────────
  { id: 'S01', file: S, why: 'the analysis is built from the raw upload rows',
    from: '  const tenants  = _acqAnalysisRows(_acqLeaseholdsOnly(canon));', to: '  const tenants  = _acqAnalysisRows(d.tenants);' },
  { id: 'S02', file: S, why: 'the states do not ride along to tenantSummary',
    from: '  if (AL) AL.attachStates(report.tenantSummary, tenants);\n', to: '' },
  { id: 'S03', file: S, why: 'an act does not refresh the analysis',
    from: '  _renderAcqTerms();\n  await _acqRefreshAnalysis(reviewId);', to: '  _renderAcqTerms();' },
  { id: 'S04', file: S, why: 'a contested Rent Roll cell draws a dash',
    from: "  if (st === 'contested') return '<span class=\"acq-rr-contested\"", to: "  if (st === 'contested') return text; if (false) return '<span class=\"acq-rr-contested\"" },
  { id: 'S05', file: S, why: 'a missing Rent Roll cell draws a dash',
    from: "  if (st === 'missing')   return '<span class=\"acq-rr-missing\"", to: "  if (st === 'missing')   return text; if (false) return '<span class=\"acq-rr-missing\"" },
  { id: 'S06', file: S, why: 'an entered Rent Roll cell loses its tag',
    from: "  if (st === 'entered')   return text + ' <span class=\"acq-rr-entered\"", to: "  if (st === 'entered')   return text; if (false) return text + ' <span class=\"acq-rr-entered\"" },
  { id: 'S07', file: S, why: 'an unfiled row is drawn like a leasehold row',
    from: '  if (!AL || !t || t._source !== AL.SOURCE.UNFILED) return name;', to: '  return name;' },
  { id: 'S08', file: S, why: 'the CSV carries a contested cell as empty',
    from: "    return st === 'contested' ? 'Contested' : st === 'missing' ? '' : raw;", to: "    return st === 'missing' || st === 'contested' ? '' : raw;" },
  { id: 'S09', file: S, why: 'the CSV drops the Basis column',
    from: '    basis(t),\n', to: "    '',\n" },
  { id: 'S10', file: S, why: 'conversion reads the raw upload rows',
    from: '    const prop = AcquisitionEngine.buildPropertyFromReview(_acqConversionReview(review));',
    to:   '    const prop = AcquisitionEngine.buildPropertyFromReview(review);' },
  { id: 'S11', file: S, why: 'a pre-§4l analysis is never flagged as behind the terms',
    from: "  if (!a.canonical) return 'This analysis was run from the uploaded files, before the Rent Roll read the lease terms.';",
    to:   "  if (!a.canonical) return '';" },
  { id: 'S12', file: S, why: 'Enter writes a plain correction',
    from: "    newValue: String(typed).trim(), entered: true }, term);", to: "    newValue: String(typed).trim() }, term);" },
  { id: 'S13', file: S, why: 'Enter acts on a term a document establishes',
    from: "  if (!AT || !term || term.state !== 'missing') return;", to: '  if (!AT || !term) return;' },
  { id: 'S14', file: S, why: 'an entered term still offers Confirm, Correct and Reject',
    from: '      const actions = entered ? `', to: '      const actions = false ? `' },
  { id: 'S15', file: S, why: 'the refreshed analysis is drawn into whichever review is open',
    from: "  if (_acqIsActive(review)) {\n    _renderAcqReport(built.report, document.getElementById('acqReportContainer'));",
    to:   "  if (true) {\n    _renderAcqReport(built.report, document.getElementById('acqReportContainer'));" },
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'acq-canon-mut-'));
for (const entry of fs.readdirSync(ROOT)) {
  if (['node_modules', '.git', 'scratchpad', 'evidence', 'assets'].includes(entry)) continue;
  fs.cpSync(path.join(ROOT, entry), path.join(tmp, entry), { recursive: true });
}
try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(tmp, 'node_modules'), 'dir'); } catch (_) {}

const FILES = [...new Set(MUTANTS.map(m => m.file))];
const ORIGINAL = {};
for (const f of FILES) ORIGINAL[f] = fs.readFileSync(path.join(ROOT, f), 'utf8');

// Cheapest first: the pure suites, then the browser. The copy has no .git, so
// the view suite is told where the real checkout is for its pins.
const ENV = Object.assign({}, process.env, { ACQ_REPORT_GIT_ROOT: ROOT });
const SUITES = [
  'test-acquisition-leasehold.js',
  'test-acquisition-decisions.js',
  'test-acquisition-report.js',
  'test-acquisition-report-view.js',
  'test-e2e-acquisition-canonical.js',
  // §4n: an analysis stored before Option B still holds unfiled rows, and it
  // is this walk that draws one — S07's marker is read there.
  'test-e2e-acquisition-leaseholds-only.js',
];
function runSuites(list) {
  for (const suite of list) {
    try { execFileSync('node', [suite], { cwd: tmp, stdio: 'pipe', timeout: 900000, env: ENV }); }
    catch (_) { return false; }
  }
  return true;
}

const baseline = runSuites(SUITES);
console.log('Baseline (unmutated copy): ' + (baseline ? 'PASS' : 'FAIL'));
if (!baseline) {
  console.error('\nThe unmutated copy does not pass, so every result below would be\n' +
                'meaningless. Nothing is mutated. Fix the harness or the suites first.');
  for (const suite of SUITES) {
    try { execFileSync('node', [suite], { cwd: tmp, stdio: 'pipe', timeout: 900000, env: ENV }); }
    catch (e) { console.error('\n── ' + suite + ' ──\n' + String(e.stdout || e.message).slice(-3000)); }
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(2);
}

let killed = 0;
const survived = [];
const equivalents = [];
for (const m of MUTANTS) {
  const src = ORIGINAL[m.file];
  const i = src.indexOf(m.from);
  if (i === -1) { console.log(`  ??   ${m.id}  ANCHOR NOT FOUND in ${m.file} — malformed mutant`); survived.push(m.id + ' (malformed)'); continue; }
  if (src.indexOf(m.from, i + 1) !== -1) {
    console.log(`  ??   ${m.id}  ANCHOR NOT UNIQUE in ${m.file} — malformed mutant, it would test the wrong code`);
    survived.push(m.id + ' (anchor not unique)');
    continue;
  }
  if (m.to === m.from) { console.log(`  ??   ${m.id}  NO-OP MUTANT`); survived.push(m.id + ' (no-op)'); continue; }
  fs.writeFileSync(path.join(tmp, m.file), src.slice(0, i) + m.to + src.slice(i + m.from.length));
  const passedM = runSuites(m.suites || SUITES);
  fs.writeFileSync(path.join(tmp, m.file), src);
  if (!passedM) { killed++; console.log(`  kill ${m.id}  ${m.why}`); continue; }
  if (m.equivalent) { equivalents.push(`${m.id}: ${m.equivalent}`); console.log(`  EQUIV ${m.id}  ${m.why}`); continue; }
  survived.push(`${m.id} (${m.file}): ${m.why}`);
  console.log(`  LIVE ${m.id}  ${m.why}`);
}

console.log(`\n${killed}/${MUTANTS.length - equivalents.length} killed` +
            (equivalents.length ? `, ${equivalents.length} documented equivalent` : ''));
if (equivalents.length) {
  console.log('\nEQUIVALENT — survives by design, with a written reason:');
  equivalents.forEach(s => console.log('  · ' + s));
}
if (survived.length) {
  console.log('\nSURVIVORS — each needs a written verdict (real gap or equivalent):');
  survived.forEach(s => console.log('  · ' + s));
}
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(survived.length ? 1 : 0);
