'use strict';
/**
 * tools/acquisition-report-mutation.js — would anyone notice if Acquisition
 * Report v2 quietly told a buyer something the documents do not say?
 *
 *   node tools/acquisition-report-mutation.js
 *
 * P1-7 / R-2 draws questions 3 and 4 from the frozen R-1 model. Every rule it
 * keeps fails silently: a blank where "Not established" belongs still looks
 * like a tidy table; a contradiction with one side dropped still looks like an
 * answer; a derived figure labelled "Source" reads perfectly until somebody
 * opens the lease. So each rule gets a mutant that breaks it quietly, and a
 * SURVIVOR is either a real gap or an equivalent mutant argued for in writing.
 *
 * R-1 (acquisition-report.js) is NOT mutated here: it is frozen, pinned by
 * sha256 in the view suite, so every R-1 mutant would die on the pin and prove
 * nothing. Its own rules are held by test-acquisition-report.js.
 *
 *   States and origins — acquisition-report-view.js
 *     V01  a missing term is drawn blank instead of "Not established"
 *     V02  an unknown state is drawn Verified
 *     V03  an assumption loses its origin label
 *     V04  AI-read and entered assumptions share one label
 *     V05  a null value is formatted as an empty string
 *     V06  a real zero is treated as no value
 *
 *   Derived — acquisition-report-view.js
 *     V07  a derived figure's clause is labelled "Source"
 *     V08  the derived mark is dropped from the chip
 *
 *   Contradictions — acquisition-report-view.js
 *     V09  a contested term is drawn with one value
 *     V10  the competing list is dropped
 *     V11  "Neither value has been selected" is dropped
 *     V12  a contested term names a single Source again
 *
 *   Provenance — acquisition-report-view.js
 *     V13  the caveat on a proposed document's clause is dropped
 *     V14  entered figures are dropped from the report
 *
 *   Question 4 — acquisition-report-view.js
 *     V15  a document with no original is offered an opener
 *     V16  "Original not on file" is dropped
 *     V17  an AI-proposed classification reads as confirmed
 *     V18  a proposed filing reads as confirmed
 *     V19  the reason a read failed is dropped
 *
 *   Completeness — acquisition-report-view.js
 *     V20  a pending question is left out instead of drawn in place
 *     V21  the coverage strip claims every question is answered
 *     V22  "not a complete acquisition report" is dropped
 *
 *   Safety and layout — acquisition-report-view.js
 *     V23  a document name is not escaped
 *     V24  a cell's content is not held in one block, so a phone deals it
 *          into the heading gutter
 *
 *   The glue — script.js / index.html
 *     S01  decisions are not re-read when the report opens
 *     S02  evidence is not re-read when the report opens
 *     S03  the fresh evidence is not merged into the documents
 *     S04  the decisions are not handed to the model
 *     S05  the leaseholds are not handed to the model
 *     S06  no opener is injected, so an original cannot be opened in the report
 *     S07  opening the report writes to the review
 *     S08  opening the report calls the AI
 *     S09  the v1 Decision Report is edited
 *     S10  the control is removed from the Lease Terms card
 *     S11  the view is not loaded
 *
 * A FAILING BASELINE IS NOT A PASS.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const V = 'acquisition-report-view.js';
const S = 'script.js';
const H = 'index.html';

const MUTANTS = [
  // ── states and origins ───────────────────────────────────────────────────
  { id: 'V01', file: V, why: 'a missing term is drawn blank instead of "Not established"',
    from: "      valueCell = '<span class=\"acqr-missing-value\">Not established</span>';",
    to:   "      valueCell = '';" },
  { id: 'V02', file: V, why: 'an unknown state is drawn Verified',
    from: "    var st = STATE_LABEL[f.state] ? f.state : 'missing';",
    to:   "    var st = STATE_LABEL[f.state] ? f.state : 'verified';" },
  { id: 'V03', file: V, why: 'an assumption loses its origin label',
    from: "    if (st === 'assumption' && ORIGIN_LABEL[f.origin]) {",
    to:   '    if (false) {' },
  { id: 'V04', file: V, why: 'AI-read and entered assumptions share one label',
    from: "    entered: 'Entered · no document',",
    to:   "    entered: 'AI-read · not confirmed'," },
  { id: 'V05', file: V, why: 'a null value is formatted as an empty string',
    from: "    if (value === null || value === undefined || value === '') return null;",
    to:   "    if (value === null || value === undefined || value === '') return '';" },
  { id: 'V06', file: V, why: 'a real zero is treated as no value',
    from: "    if (value === null || value === undefined || value === '') return null;",
    to:   '    if (!value) return null;' },

  // ── derived ──────────────────────────────────────────────────────────────
  { id: 'V07', file: V, why: 'a derived figure\'s clause is labelled "Source"',
    from: "    var lead = derived ? 'Calculated from' : 'Source';",
    to:   "    var lead = 'Source';" },
  { id: 'V08', file: V, why: 'the derived mark is dropped from the chip',
    from: "    if (f.derived) {\n      html += '<span class=\"acqr-derived\"",
    to:   "    if (false) {\n      html += '<span class=\"acqr-derived\"" },

  // ── contradictions ───────────────────────────────────────────────────────
  { id: 'V09', file: V, why: 'a contested term is drawn with one value',
    from: '    } else if (contested) {',
    to:   '    } else if (false) {' },
  { id: 'V10', file: V, why: 'the competing list is dropped',
    from: '        + competingHtml(f)',
    to:   "        + ''" },
  { id: 'V11', file: V, why: '"Neither value has been selected" is dropped',
    from: "      + '</ul>'\n      + '<div class=\"acqr-unchosen\">Neither value has been selected.</div>';",
    to:   "      + '</ul>';" },
  { id: 'V12', file: V, why: 'a contested term names a single Source again',
    from: "        + (contested ? '' : evidenceHtml(f.evidence, f.derived, opts))",
    to:   '        + evidenceHtml(f.evidence, f.derived, opts)' },

  // ── provenance ───────────────────────────────────────────────────────────
  { id: 'V13', file: V, why: 'the caveat on a proposed document\'s clause is dropped',
    from: "      + (ev.docStatus && ev.docStatus !== 'confirmed' && ev.docStatus !== 'corrected'",
    to:   '      + (false' },
  { id: 'V14', file: V, why: 'entered figures are dropped from the report',
    from: '    html += enteredHtml(q.entered, opts);',
    to:   '' },

  // ── question 4 ───────────────────────────────────────────────────────────
  { id: 'V15', file: V, why: 'a document with no original is offered an opener',
    from: "      var opener = d.originalOnFile && typeof o.linkFor === 'function'",
    to:   "      var opener = typeof o.linkFor === 'function'" },
  { id: 'V16', file: V, why: '"Original not on file" is dropped',
    from: "(d.originalOnFile ? '' : '<div class=\"acqr-note\">Original not on file.</div>')",
    to:   "''" },
  { id: 'V17', file: V, why: 'an AI-proposed classification reads as confirmed',
    from: ": (d.docType ? 'Proposed by AI — not confirmed.'",
    to:   ": (d.docType ? 'Confirmed by a person.'" },
  { id: 'V18', file: V, why: 'a proposed filing reads as confirmed',
    from: "(d.familyStatus === 'confirmed' ? 'Filing confirmed.'",
    to:   "(true ? 'Filing confirmed.'" },
  { id: 'V19', file: V, why: 'the reason a read failed is dropped',
    from: "    var why = d.readForTerms === 'failed' && REASON_LABEL[d.readFailedBecause]",
    to:   '    var why = false' },

  // ── completeness ─────────────────────────────────────────────────────────
  { id: 'V20', file: V, why: 'a pending question is left out instead of drawn in place',
    from: '      else body += renderPending(q);',
    to:   '      else body += \'\';' },
  { id: 'V21', file: V, why: 'the coverage strip claims every question is answered',
    from: '    var drawn = qs.filter(function (q) { return q && RENDERED.indexOf(q.id) >= 0; }).length;',
    to:   '    var drawn = qs.length;' },
  { id: 'V22', file: V, why: '"not a complete acquisition report" is dropped',
    from: "      + 'It is not a complete acquisition report. '",
    to:   "      + ''" },

  // ── safety and layout ────────────────────────────────────────────────────
  { id: 'V23', file: V, why: 'a document name is not escaped',
    from: ".replace(/&/g, '&amp;').replace(/</g, '&lt;')",
    to:   ".replace(/&/g, '&amp;')" },
  { id: 'V24', file: V, why: 'a cell\'s content is not held in one block',
    from: "'><div class=\"acqr-cell\">' + inner + '</div></td>'",
    to:   "'>' + inner + '</td>'" },

  // ── the glue ─────────────────────────────────────────────────────────────
  { id: 'S01', file: S, why: 'decisions are not re-read when the report opens',
    from: '  await _acqLoadDecisions(review.id);\n\n  const documents = _acqDocRows(review.id)',
    to:   '\n\n  const documents = _acqDocRows(review.id)' },
  { id: 'S02', file: S, why: 'evidence is not re-read when the report opens',
    from: '  await _acqLoadEvidence(review.id);\n  await _acqLoadDecisions(review.id);\n\n  const documents',
    to:   '  await _acqLoadDecisions(review.id);\n\n  const documents' },
  { id: 'S03', file: S, why: 'the fresh evidence is not merged into the documents',
    from: '    .map(d => _acqEvidence.has(d.id) ? Object.assign({}, d, { abstracted_fields: _acqEvidence.get(d.id) }) : d);\n  const model = AR.buildReport(',
    to:   '    .map(d => d);\n  const model = AR.buildReport(' },
  { id: 'S04', file: S, why: 'the decisions are not handed to the model',
    from: '                               _acqDecisionRows(review.id), {});',
    to:   '                               [], {});' },
  { id: 'S05', file: S, why: 'the leaseholds are not handed to the model',
    from: '  const model = AR.buildReport(review, _acqFamilyRows(review.id), documents,',
    to:   '  const model = AR.buildReport(review, [], documents,' },
  { id: 'S06', file: S, why: 'no opener is injected, so an original cannot be opened in the report',
    from: "    linkFor:   (path, name) => window.docLinkHtml",
    to:   "    linkForX:  (path, name) => window.docLinkHtml" },
  { id: 'S07', file: S, why: 'opening the report writes to the review',
    from: "  openReport('Acquisition Report v2 — ' + propName, body);",
    to:   "  await db.from('acquisition_reviews').update({ updated_at: 'rev-report' }).eq('id', review.id);\n"
        + "  openReport('Acquisition Report v2 — ' + propName, body);" },
  { id: 'S08', file: S, why: 'opening the report calls the AI',
    from: "  openReport('Acquisition Report v2 — ' + propName, body);",
    to:   "  claudeFetch({ task: 'report_summary' }).catch(() => {});\n"
        + "  openReport('Acquisition Report v2 — ' + propName, body);" },
  { id: 'S09', file: S, why: 'the v1 Decision Report is edited',
    from: "  openReport('Acquisition Decision Report — ' + propName, body);",
    to:   "  openReport('Acquisition Decision Report  — ' + propName, body);" },
  { id: 'S10', file: H, why: 'the control is removed from the Lease Terms card',
    from: 'id="acqReportV2Btn"',
    to:   'id="acqReportV2Btn-gone"' },
  { id: 'S11', file: H, why: 'the view is not loaded',
    from: '<script src="acquisition-report-view.js"></script>',
    to:   '' },
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'acq-report-mut-'));
for (const entry of fs.readdirSync(ROOT)) {
  if (['node_modules', '.git', 'scratchpad', 'evidence', 'assets'].includes(entry)) continue;
  fs.cpSync(path.join(ROOT, entry), path.join(tmp, entry), { recursive: true });
}
try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(tmp, 'node_modules'), 'dir'); } catch (_) {}

const FILES = [...new Set(MUTANTS.map(m => m.file))];
const ORIGINAL = {};
for (const f of FILES) ORIGINAL[f] = fs.readFileSync(path.join(ROOT, f), 'utf8');

// Cheapest first: the pure suites, then the browser. The copy has no .git, so
// the view suite is told where the real checkout is for its v1-unchanged pin.
const ENV = Object.assign({}, process.env, { ACQ_REPORT_GIT_ROOT: ROOT });
const SUITES = [
  ['node', 'test-acquisition-report.js'],
  ['node', 'test-acquisition-report-view.js'],
  ['node', 'test-e2e-acquisition-report.js'],
];
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
                'meaningless. Nothing is mutated. Fix the harness or the suites first.');
  for (const [bin, suite] of SUITES) {
    try { execFileSync(bin, [suite], { cwd: tmp, stdio: 'pipe', timeout: 900000, env: ENV }); }
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
  // A non-unique anchor silently mutates the FIRST match, which may be code
  // the mutant was never about. It is a malformed mutant, not a warning.
  if (src.indexOf(m.from, i + 1) !== -1) {
    console.log(`  ??   ${m.id}  ANCHOR NOT UNIQUE in ${m.file} — malformed mutant, it would test the wrong code`);
    survived.push(m.id + ' (anchor not unique)');
    continue;
  }
  if (m.to === m.from) { console.log(`  ??   ${m.id}  NO-OP MUTANT`); survived.push(m.id + ' (no-op)'); continue; }
  fs.writeFileSync(path.join(tmp, m.file), src.slice(0, i) + m.to + src.slice(i + m.from.length));
  const passedM = runSuites();
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
