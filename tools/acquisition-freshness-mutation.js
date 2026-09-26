'use strict';
/**
 * tools/acquisition-freshness-mutation.js — would anyone notice if an analysis
 * went back to being "current" for inputs it was not run with, a report
 * outlived its analysis, or 251.7% occupancy passed without a word?
 *
 *   node tools/acquisition-freshness-mutation.js
 *
 * Each mutant undoes ONE part of §4o, and the freshness suites
 * (test-acquisition-analysis-freshness.js, test-e2e-acquisition-analysis-
 * freshness.js) must fail for every one.
 *
 *   Occupancy over 100% — acquisition-engine.js
 *     F01  it is never flagged
 *     F02  the rate is clamped to 100%
 *     F03  the flag reads the rounded rate, so a sliver over passes
 *   The invoices an analysis used — acquisition-engine.js
 *     F04  the fingerprint leaves the amount out
 *     F05  the fingerprint depends on the order of the invoices
 *   The stale check — script.js
 *     F06  a different Total Property SqFt is not stale
 *     F07  different invoices are not stale
 *     F08  an analysis that recorded no invoices is trusted
 *     F09  typing a new area does not show the analysis out of date
 *     F10  the consumers are given a stale analysis as current
 *     F11  adding invoices does not show the analysis out of date
 *   The report overlay — script.js, index.html
 *     F12  closing a report keeps its contents
 *     F13  running an analysis leaves an open Decision Report standing
 *     F14  refreshing an analysis leaves an open Decision Report standing
 *     F15  the retirement never recognises a Decision Report
 *     F16  print goes back to the old rule (hides the report's parent, forces
 *          the overlay visible)
 *     F17  print forces the overlay visible whether open or not
 *     F18  print hides the report's parent too, so an open report is blank
 *   Where the flag is shown — script.js
 *     F19  Risk Analysis drops it
 *     F20  the Rent Roll drops it
 *     F21  the Decision Report drops it
 *     F22  the Rent Roll paints 251.7% green
 *   Seeing it — script.js, index.html (the Pilot, 2026-09-26: the notice lived
 *   only in the Rent Roll tab and Run Analysis still said "Ready")
 *     F23  the notice is looked for inside the Rent Roll tab again
 *     F24  the notice is in the page but hidden by its stylesheet
 *     F25  an out-of-date analysis still offers "Run Analysis", not Refresh
 *     F26  an out-of-date analysis is still announced "Ready — click to run"
 *     F27  a current analysis is not labelled Re-run
 *     F28  a current analysis cannot be re-run on purpose
 *     F30  the note stops saying a current analysis is current
 *     F29  a run leaves the button saying "Run Analysis" whatever the state
 *
 * Not mutated, and why: _acqBuildAnalysis recording `sqft` — an analysis that
 * records none is read from its rent roll's buildingSqft, which the engine
 * always writes from the same number, so dropping it changes nothing either
 * suite (or a person) can see.
 *
 * A FAILING BASELINE IS NOT A PASS.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const S = 'script.js', E = 'acquisition-engine.js', H = 'index.html';

const MUTANTS = [
  { id: 'F01', file: E, why: 'occupancy over 100% is never flagged',
    from: "    if (!(building > 0) || !(occupied > building)) return null;",
    to:   "    return null;" },
  { id: 'F02', file: E, why: 'the rate is clamped to 100%',
    from: "    const occRate  = bsqft > 0 ? parseFloat(((occupied / bsqft) * 100).toFixed(1)) : 0;",
    to:   "    const occRate  = bsqft > 0 ? Math.min(100, parseFloat(((occupied / bsqft) * 100).toFixed(1))) : 0;" },
  { id: 'F03', file: E, why: 'the flag reads the rounded rate, so a sliver over passes',
    from: "    if (!(building > 0) || !(occupied > building)) return null;",
    to:   "    if (!(building > 0) || !(occ.occupancyRate > 100)) return null;" },
  { id: 'F04', file: E, why: 'the invoice fingerprint leaves the amount out',
    from: "  const INVOICE_INPUT_FIELDS = ['amount', 'category', 'vendorName', 'invoiceDate'];",
    to:   "  const INVOICE_INPUT_FIELDS = ['category', 'vendorName', 'invoiceDate'];" },
  { id: 'F05', file: E, why: 'the invoice fingerprint depends on their order',
    from: "      .map(i => JSON.stringify(INVOICE_INPUT_FIELDS.map(k => i[k] === undefined ? null : i[k])))\n      .sort());",
    to:   "      .map(i => JSON.stringify(INVOICE_INPUT_FIELDS.map(k => i[k] === undefined ? null : i[k]))));" },
  { id: 'F06', file: S, why: 'a different Total Property SqFt is not stale',
    from: "  if (sfWas !== sfNow) {",
    to:   "  if (false) {" },
  { id: 'F07', file: S, why: 'different invoices are not stale',
    from: "  } else if (AE && typeof AE.invoiceInputsFingerprint === 'function'\n             && AE.invoiceInputsFingerprint(_acqAnalysisInvoices(review)) !== a.canonical.invoices) {",
    to:   "  } else if (false) {" },
  { id: 'F08', file: S, why: 'an analysis that recorded no invoices is trusted',
    from: "  if (a.canonical.invoices === undefined) {\n    parts.push(",
    to:   "  if (a.canonical.invoices === undefined) {\n    if (0) parts.push(" },
  { id: 'F09', file: S, why: 'typing a new area does not show the analysis out of date',
    from: "  if (review && review.data.analysis) {\n    _acqUpdateStaleNotice();\n    _renderAcqConvertAction(review);\n  }",
    to:   "  if (false) {\n    _acqUpdateStaleNotice();\n    _renderAcqConvertAction(review);\n  }" },
  { id: 'F10', file: S, why: 'the consumers are given a stale analysis as current',
    from: "  if (why.length) return { state: 'stale', reason: why.map(p => p.reason).join('; '), analysis: null };",
    to:   "  if (false) return { state: 'stale', reason: why.map(p => p.reason).join('; '), analysis: null };" },
  { id: 'F11', file: S, why: 'adding invoices does not show the analysis out of date',
    from: "  if (_acqIsActive(review) && review.data.analysis) {\n    _acqUpdateStaleNotice();",
    to:   "  if (false) {\n    _acqUpdateStaleNotice();" },
  { id: 'F12', file: S, why: 'closing a report keeps its contents',
    from: "  if (body) body.innerHTML = '';",
    to:   "  if (false) body.innerHTML = '';" },
  { id: 'F13', file: S, why: 'running an analysis leaves an open Decision Report standing',
    from: "    review.data.analysis = report;\n    _acqInvalidateDecisionReport();",
    to:   "    review.data.analysis = report;" },
  { id: 'F14', file: S, why: 'refreshing an analysis leaves an open Decision Report standing',
    from: "  review.data.analysis = built.report;\n  _acqInvalidateDecisionReport();",
    to:   "  review.data.analysis = built.report;" },
  { id: 'F15', file: S, why: 'the retirement never recognises a Decision Report',
    from: "/^Acquisition Decision Report\\b/.test(title.textContent || '')",
    to:   "/^Decision Report\\b/.test(title.textContent || '')" },
  { id: 'F16', file: H, why: 'print goes back to the old rule',
    from: '      body:has(#reportOverlay[style*="display: block"]) *:not(#reportOverlay):not(:has(#reportOverlay)):not(#reportOverlay *),\n      body:has(#reportOverlay.open) *:not(#reportOverlay):not(:has(#reportOverlay)):not(#reportOverlay *) { display: none !important; }\n      #reportOverlay[style*="display: block"], #reportOverlay.open {',
    to:   '      body > *:not(#reportOverlay) { display: none !important; }\n      #reportOverlay {' },
  { id: 'F17', file: H, why: 'print forces the overlay visible whether open or not',
    from: '      #reportOverlay[style*="display: block"], #reportOverlay.open {\n        display: block !important;',
    to:   '      #reportOverlay {\n        display: block !important;' },
  { id: 'F18', file: H, why: "print hides the report's parent too, so an open report is blank",
    from: '      body:has(#reportOverlay[style*="display: block"]) *:not(#reportOverlay):not(:has(#reportOverlay)):not(#reportOverlay *),',
    to:   '      body:has(#reportOverlay[style*="display: block"]) *:not(#reportOverlay):not(#reportOverlay *),' },
  { id: 'F19', file: S, why: 'Risk Analysis drops the flag',
    from: "${execSummaryInline}${_acqOccupancyCheckHtml((report.rentRoll || {}).occupancy)}",
    to:   "${execSummaryInline}" },
  { id: 'F20', file: S, why: 'the Rent Roll drops the flag',
    from: "  </div>${_acqOccupancyCheckHtml(occ)}`;",
    to:   "  </div>`;" },
  { id: 'F21', file: S, why: 'the Decision Report drops the flag',
    from: "  </div>${_acqOccupancyCheckHtml(occ, true)}\n",
    to:   "  </div>\n" },
  { id: 'F22', file: S, why: 'the Rent Roll paints 251.7% green',
    from: "${occCheck ? 'verify' : occ.occupancyRate >= 90",
    to:   "${false ? 'verify' : occ.occupancyRate >= 90" },
  { id: 'F23', file: S, why: 'the notice is looked for inside the Rent Roll tab again',
    from: "  const el = document.getElementById('acqStaleNotice');",
    to:   "  const el = document.querySelector('#acqTabRentRoll .acq-analysis-stale');" },
  { id: 'F24', file: H, why: 'the notice is in the page but hidden by its stylesheet',
    from: "    #acqStaleNotice { font-size: 0.82rem; margin: -8px 0 16px; }",
    to:   "    #acqStaleNotice { font-size: 0.82rem; margin: -8px 0 16px; display: none !important; }" },
  { id: 'F25', file: S, why: 'an out-of-date analysis still offers "Run Analysis", not Refresh',
    from: "                  : why          ? '↻ Refresh Analysis'",
    to:   "                  : why          ? '⚡ Run Analysis'" },
  { id: 'F26', file: S, why: 'an out-of-date analysis is still announced "Ready — click to run"',
    from: "                     : why         ? 'Out of date — refresh the analysis to use what is on file now.'",
    to:   "                     : why         ? 'Ready — click to run risk analysis.'" },
  { id: 'F27', file: S, why: 'a current analysis is not labelled Re-run',
    from: "                  : current      ? '↻ Re-run Analysis'",
    to:   "                  : current      ? '⚡ Run Analysis'" },
  { id: 'F28', file: S, why: 'a current analysis cannot be re-run on purpose',
    from: "  btn.disabled = !ready;\n  btn.textContent",
    to:   "  btn.disabled = !ready || current;\n  btn.textContent" },
  { id: 'F30', file: S, why: 'the note stops saying a current analysis is current',
    from: "                     : current     ? 'Analysis is current — up to date",
    to:   "                     : current     ? 'Ready — up to date" },
  { id: 'F29', file: S, why: 'a run leaves the button saying "Run Analysis" whatever the state',
    from: "  if (btn) { btn.disabled = false; btn.textContent = '⚡ Run Analysis'; }\n  _updateAcqAnalyzeBtn();",
    to:   "  if (btn) { btn.disabled = false; btn.textContent = '⚡ Run Analysis'; }" },
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'acq-freshness-mut-'));
for (const entry of fs.readdirSync(ROOT)) {
  if (['node_modules', '.git', 'scratchpad', 'evidence', 'assets'].includes(entry)) continue;
  fs.cpSync(path.join(ROOT, entry), path.join(tmp, entry), { recursive: true });
}
try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(tmp, 'node_modules'), 'dir'); } catch (_) {}

const ORIGINAL = {};
[S, E, H].forEach(f => { ORIGINAL[f] = fs.readFileSync(path.join(ROOT, f), 'utf8'); });
// The fast suite first: a mutant it kills never pays for a browser.
const SUITES = [['node', 'test-acquisition-analysis-freshness.js'], ['node', 'test-e2e-acquisition-analysis-freshness.js']];
function runSuites() {
  for (const [bin, suite] of SUITES) {
    try { execFileSync(bin, [suite], { cwd: tmp, stdio: 'pipe', timeout: 900000 }); }
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
