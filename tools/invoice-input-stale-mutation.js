'use strict';
/**
 * tools/invoice-input-stale-mutation.js — does a register change still stale the results?
 *
 *   node tools/invoice-input-stale-mutation.js
 *
 * Each mutant removes one path's marker, or breaks the marker itself.
 * test-e2e-invoice-input-stale.js must fail against every one.
 *
 *   S01  Remove no longer marks the results stale
 *   S02  Clear All no longer marks them stale
 *   S03  an amount edit no longer marks them stale
 *   S04  a vendor edit no longer marks them stale
 *   S05  a category edit no longer marks them stale
 *   S06  a date edit no longer marks them stale
 *   S07  the marker sets the flag to false
 *   S08  the marker sets the flag but never shows the banner
 *   S09  taking an invoice out of CAM no longer marks them stale
 *
 * A FAILING BASELINE IS NOT A PASS.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const S = 'script.js', P = 'property-os.js';

const MUTANTS = [
  { id: 'S01', file: S, why: 'Remove no longer marks the results stale',
    from: "  invoiceData.splice(i, 1);\n  _invoiceInputChanged();", to: "  invoiceData.splice(i, 1);" },
  { id: 'S02', file: S, why: 'Clear All no longer marks them stale',
    from: "async function clearInvResults() {\n  invoiceData.splice(0, invoiceData.length);\n  _invoiceInputChanged();",
    to:   "async function clearInvResults() {\n  invoiceData.splice(0, invoiceData.length);" },
  { id: 'S03', file: S, why: 'an amount edit no longer marks them stale',
    from: "markFieldVerified(${i},'amount');refreshInvSummary(${i});_invoiceInputChanged();savePropertyData()",
    to:   "markFieldVerified(${i},'amount');refreshInvSummary(${i});savePropertyData()" },
  { id: 'S04', file: S, why: 'a vendor edit no longer marks them stale',
    from: "markFieldVerified(${i},'vendorName');refreshInvSummary(${i});_invoiceInputChanged();savePropertyData()",
    to:   "markFieldVerified(${i},'vendorName');refreshInvSummary(${i});savePropertyData()" },
  { id: 'S05', file: S, why: 'a category edit no longer marks them stale',
    from: "markFieldVerified(${i},'category');refreshInvSummary(${i});_invoiceInputChanged();savePropertyData()",
    to:   "markFieldVerified(${i},'category');refreshInvSummary(${i});savePropertyData()" },
  { id: 'S06', file: S, why: 'a date edit no longer marks them stale',
    from: "recomputeSummaryBadge(${i});_invoiceInputChanged();savePropertyData()",
    to:   "recomputeSummaryBadge(${i});savePropertyData()" },
  { id: 'S07', file: S, why: 'the marker sets the flag to false',
    from: "  if (!lastResults.length || _resultsStale) return;\n  _resultsStale = true;",
    to:   "  if (!lastResults.length || _resultsStale) return;\n  _resultsStale = false;" },
  { id: 'S08', file: S, why: 'the marker sets the flag but never shows the banner',
    from: "  _resultsStale = true;\n  _updateStaleResultsBanner();\n}\nwindow._invoiceInputChanged",
    to:   "  _resultsStale = true;\n}\nwindow._invoiceInputChanged" },
  { id: 'S09', file: P, why: 'taking an invoice out of CAM no longer marks them stale',
    from: "    if (field === 'camEligible' && window._invoiceInputChanged) { try { window._invoiceInputChanged(); } catch (_e) {} }",
    to:   "" },
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stalemut-'));
fs.cpSync(ROOT, tmp, {
  recursive: true,
  filter: (src) => {
    const rel = path.relative(ROOT, src);
    return !(rel === '.git' || rel.startsWith('.git' + path.sep) ||
             rel === 'node_modules' || rel.startsWith('node_modules' + path.sep));
  },
});
const FILES = [...new Set(MUTANTS.map(m => m.file))];
const ORIGINAL = {};
for (const f of FILES) ORIGINAL[f] = fs.readFileSync(path.join(ROOT, f), 'utf8');

const SUITES = ['test-e2e-invoice-input-stale.js'];
function runSuites() {
  for (const suite of SUITES) {
    try { execFileSync(process.execPath, [suite], { cwd: tmp, stdio: 'pipe', timeout: 900000 }); }
    catch (_) { return false; }
  }
  return true;
}

const baseline = runSuites();
console.log('Baseline (unmutated copy): ' + (baseline ? 'PASS' : 'FAIL'));
if (!baseline) {
  console.error('\nThe unmutated copy does not pass, so every result below would be\n' +
                'meaningless. Nothing is mutated. Fix the harness or the suites first.');
  for (const suite of SUITES) {
    try { execFileSync(process.execPath, [suite], { cwd: tmp, stdio: 'pipe', timeout: 900000 }); }
    catch (e) { console.error('\n── ' + suite + ' ──\n' + String(e.stdout || e.message).slice(-3000)); }
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(2);
}

let killed = 0;
const survived = [];
for (const m of MUTANTS) {
  const src = ORIGINAL[m.file];
  const i = src.indexOf(m.from);
  if (i === -1) { console.log(`  ??   ${m.id}  ANCHOR NOT FOUND in ${m.file} — malformed mutant`); survived.push(m.id + ' (malformed)'); continue; }
  if (src.indexOf(m.from, i + 1) !== -1) console.log(`  ??   ${m.id}  ANCHOR NOT UNIQUE in ${m.file} — mutating only the first`);
  if (m.to === m.from) { console.log(`  ??   ${m.id}  NO-OP MUTANT`); survived.push(m.id + ' (no-op)'); continue; }
  fs.writeFileSync(path.join(tmp, m.file), src.slice(0, i) + m.to + src.slice(i + m.from.length));
  const passedM = runSuites();
  fs.writeFileSync(path.join(tmp, m.file), src);
  if (passedM) { survived.push(`${m.id} (${m.file}): ${m.why}`); console.log(`  LIVE ${m.id}  ${m.why}`); }
  else         { killed++;                                      console.log(`  kill ${m.id}  ${m.why}`); }
}

console.log(`\n${killed}/${MUTANTS.length} killed`);
if (survived.length) {
  console.log('\nSURVIVORS — each needs a written verdict (real gap or equivalent):');
  survived.forEach(s => console.log('  · ' + s));
}
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(survived.length ? 1 : 0);
