'use strict';
/**
 * tools/acquisition-report-mutation.js — would anyone notice if Acquisition
 * Report v2 quietly told a buyer something the documents do not say?
 *
 *   node tools/acquisition-report-mutation.js
 *
 * P1-7 / R-2 drew questions 3 and 4, and R-3 questions 1 and 2, from the frozen
 * R-1 model. Every rule they
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
 *   R-3, question 1 — acquisition-report-view.js
 *     Q01  property-level facts are not said to be missing
 *     Q02  the review's name is not said to be a label
 *     Q03  documents in no leasehold are dropped
 *     Q04  a replaced upload is counted as an unfiled document
 *     Q05  the leasehold roster is dropped
 *     Q06  the roster's document counts are wrong
 *     Q07  question 1's identity table is dropped
 *     Q08  a deal-level entered figure is dropped
 *     Q09  the review is not named
 *     Q10  question 1 is drawn as pending again
 *     Q11  question 1 is left out of the coverage count
 *
 *   R-3, question 2 — acquisition-report-view.js / index.html
 *     Q12  the three income sources are dropped
 *     Q13  the rent roll and GL columns show $0 instead of "Not on file"
 *     Q14  the rent roll and GL notes are dropped
 *     Q15  "financial intake is not yet included" is dropped
 *     Q16  a contested contractual rent shows one figure
 *     Q17  a missing contractual rent is drawn blank
 *     Q18  the contractual cell carries a state the model did not give
 *     Q19  the contractual cell loses its state chip
 *     Q20  the source columns are not the model's
 *     Q21  with no leasehold, the contractual note is dropped
 *     Q22  question 2's term table is dropped
 *     Q23  a Q2-keyed entered figure is dropped
 *     Q24  the source headings stop wrapping, pushing the table off the page
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
const IDENT_TAIL = "    html += termTables(q, opts, 'Fact');\n"
  + "    if (q.emptyNote) html += '<p class=\"acqr-empty\">' + esc(q.emptyNote) + '</p>';\n"
  + "    html += enteredHtml(q.entered, opts);";
const INCOME_TAIL = "    html += termTables(q, opts, 'Term');\n"
  + "    if (q.emptyNote) html += '<p class=\"acqr-empty\">' + esc(q.emptyNote) + '</p>';\n"
  + "    html += enteredHtml(q.entered, opts);";

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
  // Anchored on renderObligations' own tail: R-3 reuses the same line in
  // questions 1 and 2, which have their own mutants (Q08, Q23).
  { id: 'V14', file: V, why: 'entered figures are dropped from the report',
    from: "    html += enteredHtml(q.entered, opts);\n    return html + '</section>';\n  }\n\n  /** Figures a person entered.",
    to:   "    return html + '</section>';\n  }\n\n  /** Figures a person entered." },

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

  // ── R-3, question 1 ──────────────────────────────────────────────────────
  { id: 'Q01', file: V, why: 'property-level facts are not said to be missing',
    from: "'<span class=\"acqr-missing-value\">Property-level facts — address, site, building area, title — are not established.</span>'",
    to:   "''" },
  { id: 'Q02', file: V, why: 'the review\'s name is not said to be a label',
    from: "'<div class=\"acqr-note\">The name this review was given. It is a label, not a fact any document establishes.</div>'",
    to:   "''" },
  { id: 'Q03', file: V, why: 'documents in no leasehold are dropped',
    from: 'return d && !d.leasehold && !d.superseded; }',
    to:   'return false; }' },
  { id: 'Q04', file: V, why: 'a replaced upload is counted as an unfiled document',
    from: 'return d && !d.leasehold && !d.superseded; }',
    to:   'return d && !d.leasehold; }' },
  { id: 'Q05', file: V, why: 'the leasehold roster is dropped',
    from: "    if (ls.length) {\n      html += '<ul class=\"acqr-roster\">'",
    to:   "    if (false) {\n      html += '<ul class=\"acqr-roster\">'" },
  { id: 'Q06', file: V, why: 'the roster\'s document counts are wrong',
    from: "esc(plural(l.documentCount || 0, 'document', 'documents'))",
    to:   "esc(plural(0, 'document', 'documents'))" },
  { id: 'Q07', file: V, why: 'question 1\'s identity table is dropped',
    from: IDENT_TAIL,
    to:   IDENT_TAIL.replace("    html += termTables(q, opts, 'Fact');\n", '') },
  { id: 'Q08', file: V, why: 'a deal-level entered figure is dropped',
    from: IDENT_TAIL,
    to:   IDENT_TAIL.replace('    html += enteredHtml(q.entered, opts);', '') },
  { id: 'Q09', file: V, why: 'the review is not named',
    from: "esc(m.reviewName || 'Acquisition Review')",
    to:   "esc('Acquisition Review')" },
  { id: 'Q10', file: V, why: 'question 1 is drawn as pending again',
    from: "      if (q.id === 'what_am_i_buying') body += renderIdentity(q, m, opts);",
    to:   "      if (false) body += renderIdentity(q, m, opts);" },
  { id: 'Q11', file: V, why: 'question 1 is left out of the coverage count',
    from: "  var RENDERED = ['what_am_i_buying', 'what_income', 'what_obligations', 'what_evidence'];",
    to:   "  var RENDERED = ['what_income', 'what_obligations', 'what_evidence'];" },

  // ── R-3, question 2 ──────────────────────────────────────────────────────
  { id: 'Q12', file: V, why: 'the three income sources are dropped',
    from: '    html += sourcesHtml(q.sources);',
    to:   '' },
  { id: 'Q13', file: V, why: 'the rent roll and GL columns show $0 instead of "Not on file"',
    from: "+ '<span class=\"acqr-missing-value\">Not on file</span></span>');",
    to:   "+ '<span class=\"acqr-value\">$0</span></span>');" },
  { id: 'Q14', file: V, why: 'the rent roll and GL notes are dropped',
    from: "    absent.forEach(function (s) {\n      if (s.id === 'contractual') return;",
    to:   "    absent.forEach(function (s) {\n      return;" },
  { id: 'Q15', file: V, why: '"financial intake is not yet included" is dropped',
    from: '    if (absent.some(function (s) { return s.pendingIncrement; })) {',
    to:   '    if (false) {' },
  { id: 'Q16', file: V, why: 'a contested contractual rent shows one figure',
    from: "      : contested ? '<span class=\"acqr-contested\">Contested</span>'",
    to:   "      : false ? '<span class=\"acqr-contested\">Contested</span>'" },
  { id: 'Q17', file: V, why: 'a missing contractual rent is drawn blank',
    from: "    var v = x.state === 'missing' ? '<span class=\"acqr-missing-value\">Not established</span>'",
    to:   "    var v = x.state === 'missing' ? ''" },
  { id: 'Q18', file: V, why: 'the contractual cell carries a state the model did not give',
    from: "    return '<span data-source=\"contractual\" data-state=\"' + esc(x.state || 'missing') + '\"'",
    to:   "    return '<span data-source=\"contractual\" data-state=\"' + 'verified' + '\"'" },
  { id: 'Q19', file: V, why: 'the contractual cell loses its state chip',
    from: "+ '>' + stateChip(x) + ' ' + v + '</span>';",
    to:   "+ '>' + v + '</span>';" },
  { id: 'Q20', file: V, why: 'the source columns are not the model\'s',
    from: "list.map(function (s) { return '<th>' + esc(s.label) + '</th>'; })",
    to:   "list.map(function (s) { return '<th>Source</th>'; })" },
  { id: 'Q21', file: V, why: 'with no leasehold, the contractual note is dropped',
    from: '    } else if (contractual.note) {',
    to:   '    } else if (false) {' },
  { id: 'Q22', file: V, why: 'question 2\'s term table is dropped',
    from: INCOME_TAIL,
    to:   INCOME_TAIL.replace("    html += termTables(q, opts, 'Term');\n", '') },
  { id: 'Q23', file: V, why: 'a Q2-keyed entered figure is dropped',
    from: INCOME_TAIL,
    to:   INCOME_TAIL.replace('    html += enteredHtml(q.entered, opts);', '') },
  { id: 'Q24', file: H, why: 'the source headings stop wrapping, pushing the table off the page',
    from: '    .rpt-table.acqr-sources-table th:not(:first-child) { white-space: normal; }',
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
  ['node', 'test-acquisition-report-q1q2.js'],
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
