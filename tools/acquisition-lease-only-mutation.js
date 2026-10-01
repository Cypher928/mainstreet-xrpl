'use strict';
/**
 * tools/acquisition-lease-only-mutation.js — would anyone notice if seller
 * invoices became required again, or if a lease-only analysis were treated as
 * a CAM analysis?
 *
 *   node tools/acquisition-lease-only-mutation.js
 *
 * Each mutant undoes ONE part of the lease-only analysis (seller invoices
 * optional), or one safeguard it must leave in place, and
 * test-e2e-acquisition-lease-only.js must fail for every one.
 *
 *   Running it — script.js
 *     O01  Run Analysis needs an invoice again
 *     O02  Run Analysis no longer needs the property area
 *
 *   What it shows — script.js
 *     O03  a lease-only analysis renders as the engine's "Insufficient data" error
 *     O04  the lease-only view offers the Decision Report
 *     O05  the Decision Report prints an analysis with no CAM summary
 *
 *   What it keeps — script.js
 *     O06  the term states are not stored with the analysis
 *     O07  adding invoices leaves the lease-only analysis current
 *
 *   The conversion gate, unchanged — script.js
 *     O08  unmatched extractions and pending documents do not block Acquire
 *     O09  an out-of-date analysis does not block Acquire
 *
 * A FAILING BASELINE IS NOT A PASS.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const S = 'script.js';

const MUTANTS = [
  { id: 'O01', file: S, why: 'Run Analysis needs an invoice again',
    from: '  const ready = hasTenants && hasSqFt;',
    to:   '  const ready = hasTenants && hasInvoices && hasSqFt;' },
  { id: 'O02', file: S, why: 'Run Analysis no longer needs the property area',
    from: '  const ready = hasTenants && hasSqFt;',
    to:   '  const ready = hasTenants;' },
  { id: 'O03', file: S, why: 'a lease-only analysis renders as the engine\'s "Insufficient data" error',
    from: '  if (_acqIsLeaseOnlyAnalysis(report)) {',
    to:   '  if (false) {' },
  { id: 'O04', file: S, why: 'the lease-only view offers the Decision Report',
    from: '        <button class="acq-export-btn" onclick="acqExportRentRollCsv()">&#x1F4C8; Rent Roll CSV</button>\n      </div>\n    </div>\n    <div id="acqTabRentRoll" class="acq-tab-pane"${_acqActiveTab !== \'rentroll\' ? \' style="display:none"\' : \'\'}>\n      ${rrTab}',
    to:   '        <button class="acq-export-btn" onclick="acqExportRentRollCsv()">&#x1F4C8; Rent Roll CSV</button>\n        <button class="acq-export-btn" onclick="generateAcquisitionReport()">&#x1F4CB; Decision Report</button>\n      </div>\n    </div>\n    <div id="acqTabRentRoll" class="acq-tab-pane"${_acqActiveTab !== \'rentroll\' ? \' style="display:none"\' : \'\'}>\n      ${rrTab}' },
  { id: 'O05', file: S, why: 'the Decision Report prints an analysis with no CAM summary',
    from: '  if (!review.data.analysis.summary) {',
    to:   '  if (false) {' },
  { id: 'O06', file: S, why: 'the term states are not stored with the analysis',
    from: '    states: _acqCanonicalStates(tenants),',
    to:   '    states: undefined,' },
  { id: 'O07', file: S, why: 'adding invoices leaves the lease-only analysis current',
    from: '             && AE.invoiceInputsFingerprint(_acqAnalysisInvoices(review)) !== a.canonical.invoices) {',
    to:   '             && false) {' },
  { id: 'O08', file: S, why: 'unmatched extractions and pending documents do not block Acquire',
    from: '  if (u || docs.length) {\n    const parts = [];',
    to:   '  if (false) {\n    const parts = [];' },
  { id: 'O09', file: S, why: 'an out-of-date analysis does not block Acquire',
    from: "  if (stale) return stale + ' Refresh the analysis from MainStreet’s Record before acquiring.';",
    to:   '' },
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'acq-lo-mut-'));
for (const entry of fs.readdirSync(ROOT)) {
  if (['node_modules', '.git', 'scratchpad', 'evidence', 'assets'].includes(entry)) continue;
  fs.cpSync(path.join(ROOT, entry), path.join(tmp, entry), { recursive: true });
}
try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(tmp, 'node_modules'), 'dir'); } catch (_) {}

const ORIGINAL = {};
[S].forEach(f => { ORIGINAL[f] = fs.readFileSync(path.join(ROOT, f), 'utf8'); });
const SUITES = [['node', 'test-e2e-acquisition-lease-only.js']];
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
