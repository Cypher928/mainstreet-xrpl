'use strict';
/**
 * tools/acquisition-controls-mutation.js — would anyone notice if the
 * acquisition workflow's controls quietly went back to how they were?
 *
 *   node tools/acquisition-controls-mutation.js
 *
 * Each mutant undoes ONE rule, and test-e2e-acquisition-controls.js (or
 * test-e2e-acquisition-matrix13.js) must fail for every one.
 *
 *   One button vocabulary — index.html
 *     A01  the shared shape is no taller than its text
 *     A02  the phone size goes back to the desktop size
 *     A03  the CSV buttons leave the shared shape
 *     A04  the header stops wrapping, so a narrow screen pushes a button off
 *     A05  Delete takes its colour from an inline style again
 *
 *   The CSVs in both views — script.js
 *     A06  the Summary loses the downloads (the switch alone, as before)
 *     A07  the Acquisition Matrix loses the downloads
 *
 *   The labels — script.js / index.html
 *     A08  "⬇ Matrix CSV" goes back to "Download matrix (CSV)"
 *     A09  "⬇ Sources CSV" goes back to "Download sources (CSV)"
 *     A10  the report is "Acquisition Report v2" again
 *     A11  the rent roll tab's download is "Export CSV" again
 *     A12  "13 columns" no longer sits beneath "Acquisition Matrix"
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const H = 'index.html';
const S = 'script.js';

const MUTANTS = [
  { id: 'A01', file: H, why: 'the shared shape is no taller than its text',
    from: '      min-height: 36px; padding: 0 16px; border-radius: 8px; border: 1px solid transparent;',
    to:   '      min-height: 0; padding: 0 16px; border-radius: 8px; border: 1px solid transparent;' },
  { id: 'A02', file: H, why: 'the phone size goes back to the desktop size',
    from: '      .acq-convert-btn, .acq-m13-actions button, .acq-lm-view { min-height: 44px; }',
    to:   '      .acq-convert-btn, .acq-m13-actions button, .acq-lm-view { min-height: 36px; }' },
  { id: 'A03', file: H, why: 'the CSV buttons leave the shared shape',
    from: '    .acq-analyze-btn, .acq-convert-btn, .acq-m13-actions button {\n      display: inline-flex;',
    to:   '    .acq-analyze-btn, .acq-convert-btn {\n      display: inline-flex;' },
  { id: 'A04', file: H, why: 'the header stops wrapping',
    from: '    .acq-detail-header { flex-wrap: wrap; row-gap: 8px; }',
    to:   '    .acq-detail-header { row-gap: 8px; }' },
  { id: 'A05', file: H, why: 'Delete takes its colour from an inline style again',
    from: 'title="Delete this review permanently" style="margin-left:auto;">',
    to:   'title="Delete this review permanently" style="margin-left:auto;border-color:rgba(239,68,68,0.3);color:var(--c-f87171);">' },
  { id: 'A06', file: S, why: 'the Summary loses the downloads',
    from: '  return `<div class="acq-lm" data-leaseholds="${n}" data-unfiled="${m.unfiled.length}">\n      ${_acqMatrixToolbarHtml()}',
    to:   '  return `<div class="acq-lm" data-leaseholds="${n}" data-unfiled="${m.unfiled.length}">\n      ${_acqMatrixViewSwitchHtml()}' },
  { id: 'A07', file: S, why: 'the Acquisition Matrix loses the downloads',
    from: 'data-unfiled="${m.unfiled}">\n      ${_acqMatrixToolbarHtml()}',
    to:   'data-unfiled="${m.unfiled}">\n      ${_acqMatrixViewSwitchHtml()}' },
  { id: 'A08', file: S, why: 'the matrix download is "Download matrix (CSV)" again',
    from: '>&#x2B07; Matrix CSV</button>',
    to:   '>Download matrix (CSV)</button>' },
  { id: 'A09', file: S, why: 'the sources download is "Download sources (CSV)" again',
    from: '>&#x2B07; Sources CSV</button>',
    to:   '>Download sources (CSV)</button>' },
  { id: 'A10', file: H, why: 'the report is "Acquisition Report v2" again',
    from: '>&#x1F4D8; Acquisition Report</button>',
    to:   '>&#x1F4D8; Acquisition Report v2</button>' },
  { id: 'A11', file: S, why: 'the rent roll tab\'s download is "Export CSV" again',
    from: '  <div class="acq-rr-export-bar">\n    <button class="acq-export-btn" onclick="acqExportRentRollCsv()">&#x2B07; Rent Roll CSV</button>',
    to:   '  <div class="acq-rr-export-bar">\n    <button class="acq-export-btn" onclick="acqExportRentRollCsv()">&#x1F4E5; Export CSV</button>' },
  { id: 'A12', file: S, why: '"13 columns" no longer sits beneath "Acquisition Matrix"',
    from: "'Acquisition Matrix <span class=\"acq-lm-view-sub\">13 columns</span>'",
    to:   "'Acquisition Matrix'" },
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'acq-controls-mut-'));
for (const entry of fs.readdirSync(ROOT)) {
  if (['node_modules', '.git', 'scratchpad', 'evidence', 'assets'].includes(entry)) continue;
  fs.cpSync(path.join(ROOT, entry), path.join(tmp, entry), { recursive: true });
}
try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(tmp, 'node_modules'), 'dir'); } catch (_) {}

const ORIGINAL = {};
[...new Set(MUTANTS.map(m => m.file))].forEach(f => { ORIGINAL[f] = fs.readFileSync(path.join(ROOT, f), 'utf8'); });
const SUITES = ['test-e2e-acquisition-controls.js', 'test-e2e-acquisition-matrix13.js'];
function runSuites() {
  for (const suite of SUITES) {
    try { execFileSync(process.execPath, [suite], { cwd: tmp, stdio: 'pipe', timeout: 600000 }); }
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
