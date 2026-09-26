'use strict';
/**
 * test-acquisition-analysis-freshness.js — an analysis is current only for the
 * inputs it was run with, and a report printed from it cannot outlive it
 * (docs/ACQUISITION_REVIEW.md §4o).
 *
 *   node test-acquisition-analysis-freshness.js
 *
 * The pure rules in acquisition-engine.js (occupancyCheck,
 * invoiceInputsFingerprint), run on Maple Plaza's figures as the Pilot holds
 * them, and the page wiring: what the stale check compares, what a new
 * analysis retires, what closing a report keeps, and what print shows.
 * The browser walk is test-e2e-acquisition-analysis-freshness.js.
 */
const fs   = require('fs');
const path = require('path');
const AE   = require('./acquisition-engine.js');

let pass = 0, fail = 0;
const failures = [];
function t(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; failures.push(name + ' — ' + e.message); console.log('  ✗ ' + name + '  — ' + e.message); }
}
function ok(v, msg) { if (!v) throw new Error(msg || 'expected truthy'); }
function eq(a, b, msg) { if (a !== b) throw new Error((msg ? msg + ': ' : '') + JSON.stringify(a) + ' !== ' + JSON.stringify(b)); }
function sec(s) { console.log('\n── ' + s + ' ' + '─'.repeat(Math.max(0, 60 - s.length))); }
function fnBody(src, name) {
  const re = new RegExp('(?:async\\s+)?function ' + name + '\\s*\\(');
  const m = re.exec(src); if (!m) throw new Error('no function ' + name);
  let i = src.indexOf('{', m.index), depth = 0, j = i;
  for (; j < src.length; j++) { if (src[j] === '{') depth++; else if (src[j] === '}') { depth--; if (!depth) break; } }
  return src.slice(i, j + 1);
}

const S = fs.readFileSync(path.join(__dirname, 'script.js'), 'utf8');
const H = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

// Maple Plaza's four leaseholds on the Pilot: 65,000 + 3,000 + 3,000 + 4,500.
const MAPLE = [['ShopRite Supermarkets, Inc.', 65000], ['Luxe Nails', 3000], ['Maple Coffee Co.', 3000], ['Prime Wellness Spa', 4500]]
  .map(([n, sf]) => ({ tenant_name: n, leased_sqft: sf }));
// The Pilot's five invoices.
const INVOICES = [
  { amount: 3200, _status: 'ok', category: 'landscaping', fileName: 'inv1-greenscape-landscaping.pdf', vendorName: 'GreenScape Lawn & Landscape', invoiceDate: '2024-01-15' },
  { amount: 6000, _status: 'ok', category: 'insurance', fileName: 'ABC_Insurance_Group_Invoice.pdf', vendorName: 'ABC Insurance Group', invoiceDate: '2026-01-01' },
  { amount: 2400, _status: 'ok', category: 'landscaping', fileName: 'GreenScape_LLC_Invoice.pdf', vendorName: 'GreenScape LLC', invoiceDate: '2026-03-01' },
  { amount: 1200, _status: 'ok', category: 'repairs', fileName: 'FixIt_Maintenance_Invoice.pdf', vendorName: 'FixIt Maintenance', invoiceDate: '2026-03-10' },
  { amount: 900,  _status: 'ok', category: 'janitorial', fileName: 'CleanCo_Invoice.pdf', vendorName: 'CleanCo', invoiceDate: '2026-03-05' },
];

console.log('\nAcquisition Review §4o — analysis freshness, the report overlay, occupancy over 100%\n' + '='.repeat(72));

sec('1 · occupancy over 100% is flagged, never clamped');
t('A · 30,000 sf property, 75,500 sf leased: 251.7% — and flagged for verification', () => {
  const r = AE.buildAcquisitionReport(MAPLE, INVOICES, 30000);
  const occ = r.rentRoll.occupancy;
  eq(occ.occupancyRate, 251.7); eq(occ.occupiedSqft, 75500); eq(occ.buildingSqft, 30000);
  const c = AE.occupancyCheck(occ);
  ok(c, 'not flagged');
  eq(c.message, 'Occupancy exceeds 100% — verify property and lease SF.');
  eq(c.detail, '75,500 sf leased ÷ 30,000 sf property = 251.7%');
  eq(c.occupancyRate, 251.7, 'the flag reports another rate than was computed');
});
t('C · 75,500 sf property: 100% — no flag', () => {
  const occ = AE.buildAcquisitionReport(MAPLE, INVOICES, 75500).rentRoll.occupancy;
  eq(occ.occupancyRate, 100); eq(AE.occupancyCheck(occ), null);
});
t('the rate is left as computed — never clamped to 100%', () => {
  eq(AE.occupancyAnalysis(MAPLE, 30000).occupancyRate, 251.7);
  eq(AE.occupancyAnalysis(MAPLE, 30000).vacantSqft, 0);
});
t('a sliver over is still over: 75,501 leased of 75,500 rounds to 100.0% and is flagged', () => {
  const occ = AE.occupancyAnalysis([{ leased_sqft: 75501 }], 75500);
  eq(occ.occupancyRate, 100); ok(AE.occupancyCheck(occ), 'rounding hid it');
});
t('no property area, no leases, or under 100%: nothing to flag', () => {
  eq(AE.occupancyCheck(AE.occupancyAnalysis(MAPLE, 0)), null);
  eq(AE.occupancyCheck(AE.occupancyAnalysis([], 30000)), null);
  eq(AE.occupancyCheck(AE.occupancyAnalysis(MAPLE, 100000)), null);
  eq(AE.occupancyCheck(null), null);
});
t('it reads a stored rent roll too (an analysis saved before §4o)', () => {
  ok(AE.occupancyCheck({ buildingSqft: 30000, occupiedSqft: 75500, occupancyRate: 251.7 }));
});

sec('2 · the invoices an analysis used');
const fp = AE.invoiceInputsFingerprint;
t('the fingerprint covers exactly the fields the analysis reads', () => {
  eq(JSON.stringify(AE.INVOICE_INPUT_FIELDS), JSON.stringify(['amount', 'category', 'vendorName', 'invoiceDate']));
});
t('F · any change the analysis would see changes it: amount, category, vendor, date', () => {
  const base = fp(INVOICES);
  for (const [k, v] of [['amount', 3201], ['category', 'snow_removal'], ['vendorName', 'Other'], ['invoiceDate', '2026-02-01']]) {
    const next = INVOICES.map((i, n) => n === 0 ? Object.assign({}, i, { [k]: v }) : i);
    ok(fp(next) !== base, k + ' change not seen');
  }
});
t('F · an invoice added or removed changes it', () => {
  ok(fp(INVOICES.concat([{ amount: 5, vendorName: 'x' }])) !== fp(INVOICES));
  ok(fp(INVOICES.slice(1)) !== fp(INVOICES));
});
t('reordering, or a field the analysis does not read, does not', () => {
  eq(fp(INVOICES.slice().reverse()), fp(INVOICES));
  eq(fp(INVOICES.map(i => Object.assign({}, i, { _status: 'x', url: 'https://signed/' + Math.random() }))), fp(INVOICES));
  eq(fp(INVOICES.map(i => Object.assign({}, i, { fileName: 'renamed-' + i.fileName }))), fp(INVOICES), 'a file name the engine never reads made it stale');
});

sec('3 · the stale check compares every input');
t('B · the analysis records the area and invoices it was built from, read the same way it is checked', () => {
  const A = fnBody(S, '_acqBuildAnalysis');
  ok(/const invoices = _acqAnalysisInvoices\(review\);/.test(A) && /const sqft     = _acqAnalysisSqFt\(review\);/.test(A));
  ok(/AE\.buildAcquisitionReport\(tenants, invoices, sqft\)/.test(A), 'the engine is given other inputs than are recorded');
  ok(/sqft, invoices: AE\.invoiceInputsFingerprint\(invoices\)/.test(A));
});
t('B · a different Total Property SqFt is stale, naming both areas', () => {
  const P = fnBody(S, '_acqAnalysisStaleParts');
  ok(/const sfNow = _acqAnalysisSqFt\(review\);/.test(P) && /if \(sfWas !== sfNow\)/.test(P));
  ok(/'Total Property SqFt has changed since this analysis was run \(' \+ sf\(sfWas\) \+ ' → ' \+ sf\(sfNow\) \+ '\)\.'/.test(P));
  // An analysis from before §4o still says which area it used.
  ok(/\(\(a\.rentRoll \|\| \{\}\)\.occupancy \|\| \{\}\)\.buildingSqft/.test(P));
});
t('F · different invoices are stale; an analysis that recorded none is not trusted', () => {
  const P = fnBody(S, '_acqAnalysisStaleParts');
  ok(/AE\.invoiceInputsFingerprint\(_acqAnalysisInvoices\(review\)\) !== a\.canonical\.invoices/.test(P));
  ok(/if \(a\.canonical\.invoices === undefined\)/.test(P) && /does not record which invoices it used/.test(P));
});
t('G · a change to the leaseholds is still caught', () => {
  ok(/_acqCanonicalFingerprint\(_acqLeaseholdsOnly\(canon\)\) !== a\.canonical\.fingerprint/.test(fnBody(S, '_acqAnalysisStaleParts')));
});
t('the other inputs are checked even without the resolver — only the leaseholds need it', () => {
  ok(/if \(!canon\.resolverAvailable && !parts\.length\) return null;/.test(fnBody(S, '_acqAnalysisStaleParts')));
});
t('every consumer reads the same check: the gate, the Decision Report, the stale notice and the consumer view', () => {
  ok(/_acqAnalysisStale\(review\)/.test(fnBody(S, '_acqConversionBlock')));
  ok(/const _stale = _acqAnalysisStale\(review\);/.test(fnBody(S, 'generateAcquisitionReport')));
  ok(/_acqAnalysisStale\(review\)/.test(fnBody(S, '_acqUpdateStaleNotice')));
  const C = fnBody(S, '_acqConsumerAnalysis');
  ok(/const why = _acqAnalysisStaleParts\(review\);/.test(C) && /reason: why\.map\(p => p\.reason\)\.join\('; '\)/.test(C));
});
t('typing a new area or adding invoices shows the analysis out of date at once', () => {
  const Q = fnBody(S, 'acqSaveSqft');
  ok(/_acqUpdateStaleNotice\(\);\s*_renderAcqConvertAction\(review\);/.test(Q));
  ok(/\/\/ The invoices are an input to the analysis: new ones put it out of date\.\s*if \(_acqIsActive\(review\) && review\.data\.analysis\) \{\s*_acqUpdateStaleNotice\(\);/.test(S));
});

sec('4 · a report cannot outlive its analysis');
t('E · closing a report empties it', () => {
  const C = fnBody(S, 'closeReport');
  ok(/style\.display = 'none'/.test(C) && /body\.innerHTML = ''/.test(C));
});
t('E · a new analysis retires any Decision Report already drawn — both ways of running one', () => {
  ok(/Acquisition Decision Report\\b/.test(fnBody(S, '_acqInvalidateDecisionReport')) && /closeReport\(\)/.test(fnBody(S, '_acqInvalidateDecisionReport')));
  ok(/review\.data\.analysis = report;\s*_acqInvalidateDecisionReport\(\);/.test(fnBody(S, 'runAcquisitionAnalysis')));
  ok(/review\.data\.analysis = built\.report;\s*_acqInvalidateDecisionReport\(\);/.test(fnBody(S, '_acqRefreshAnalysis')));
});
t('E · print shows the report only while it is open — and nothing but the report', () => {
  ok(!/body > \*:not\(#reportOverlay\) \{ display: none !important; \}/.test(H), 'the old rule is back: it hid #appContent (and the report in it) and forced a closed overlay visible');
  ok(H.includes('body:has(#reportOverlay[style*="display: block"]) *:not(#reportOverlay):not(:has(#reportOverlay)):not(#reportOverlay *)'));
  ok(/#reportOverlay\[style\*="display: block"\], #reportOverlay\.open \{\s*display: block !important;/.test(H));
  ok(!/^\s*#reportOverlay \{\s*display: block !important;/m.test(H), 'a rule forces the overlay visible in print whether open or not');
});

sec('5 · where the flag is shown');
t('Risk Analysis, the Rent Roll and the Decision Report all carry it', () => {
  ok(/\$\{execSummaryInline\}\$\{_acqOccupancyCheckHtml\(\(report\.rentRoll \|\| \{\}\)\.occupancy\)\}/.test(S), 'Risk Analysis');
  ok(/<\/div>\$\{_acqOccupancyCheckHtml\(occ\)\}`;/.test(fnBody(S, '_renderRentRollTab')), 'Rent Roll');
  ok(/<\/div>\$\{_acqOccupancyCheckHtml\(occ, true\)\}/.test(fnBody(S, 'generateAcquisitionReport')), 'Decision Report');
  ok(/occCheck \? 'verify'/.test(fnBody(S, '_renderRentRollTab')), 'the Rent Roll paints 251.7% as safe');
});

sec('6 · an out-of-date analysis is seen, whichever tab is open');
t('the notice is one element under Run Analysis, above the report and its tabs — not inside a tab', () => {
  const bar = H.indexOf('<div class="acq-analyze-bar">'), note = H.indexOf('id="acqStaleNotice"'), rpt = H.indexOf('<div id="acqReportContainer">');
  ok(bar > 0 && note > bar && rpt > note, 'the notice is not between Run Analysis and the report');
  ok(!/class="acq-analysis-stale"/.test(fnBody(S, '_renderRentRollTab')), 'the notice is back inside the Rent Roll tab');
  const U = fnBody(S, '_acqUpdateStaleNotice');
  ok(/document\.getElementById\('acqStaleNotice'\)/.test(U) && /_updateAcqAnalyzeBtn\(\);/.test(U));
  ok(/This analysis is out of date\./.test(U) && /esc\(why\)/.test(U), 'the reasons are not shown as the check gives them');
});
t('the action says what to do: Run Analysis, Refresh Analysis, or — the analysis being current — Re-run on purpose', () => {
  const B = fnBody(S, '_updateAcqAnalyzeBtn');
  ok(/const why         = hasAnalysis \? _acqAnalysisStale\(review\) : null;/.test(B), 'the button judges currency another way');
  ok(/btn\.disabled = !ready;/.test(B) && !/btn\.disabled = [^;]*current/.test(B), 'a current analysis cannot be re-run on purpose');
  ok(/!hasAnalysis \? '⚡ Run Analysis'/.test(B) && /current      \? '↻ Re-run Analysis'/.test(B) && /why          \? '↻ Refresh Analysis'/.test(B));
  ok(/why         \? 'Out of date — refresh the analysis to use what is on file now\.'/.test(B), 'an out-of-date analysis is still announced as Ready');
  ok(/current     \? 'Analysis is current — up to date with MainStreet’s Record, the property area and the invoices\. Re-run it only if you want a fresh run\.'/.test(B), 'a current analysis is not said to be current');
  ok(B.indexOf("'Out of date") < B.indexOf("'Ready — click to run risk analysis.'"), '"Ready" is said before the out-of-date check');
  ok(/btn\.textContent = '⚡ Run Analysis'; \}\n  _updateAcqAnalyzeBtn\(\);\n\}$/.test(fnBody(S, 'runAcquisitionAnalysis')), 'Run Analysis leaves its button saying Run after a run');
});
t('the freshness check itself is unchanged by the notice move — byte for byte as committed', () => {
  let head = null;
  try {
    head = require('child_process').execFileSync('git', ['show', 'HEAD:script.js'], { cwd: __dirname, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch (_) { console.log('    (no git here — pin skipped, not passed)'); return; }
  eq(fnBody(S, '_acqAnalysisStaleParts'), fnBody(head, '_acqAnalysisStaleParts'), '_acqAnalysisStaleParts changed');
  eq(fnBody(S, '_acqAnalysisStale'), fnBody(head, '_acqAnalysisStale'), '_acqAnalysisStale changed');
});

console.log('\n' + '─'.repeat(64));
console.log(`RESULT: ${pass} passed, ${fail} failed`);
if (fail) { console.log('\nFAILED:'); failures.forEach(f => console.log('  ✗ ' + f)); }
process.exit(fail ? 1 : 0);
