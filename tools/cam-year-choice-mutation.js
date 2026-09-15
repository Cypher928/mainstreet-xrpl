'use strict';
/**
 * tools/cam-year-choice-mutation.js — can the year still be chosen where it is reconciled?
 *
 *   node tools/cam-year-choice-mutation.js
 *
 *   Y01  the Prepare selector is not populated (only the Property Setup one)
 *   Y02  setCamYear moves only the Property Setup select
 *   Y03  switching the year after a run does not stale the results
 *   Y04  switching the year stales the results even when it is the results' year
 *   Y05  the refusal panel has no "Change the CAM year" button
 *   Y06  the refusal button focuses nothing
 *   Y07  the Prepare hint never names the invoices' year
 *   Y08  the hint shows even when the selected year has invoices
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
  { id: 'Y01', file: S, why: 'the Prepare selector is not populated',
    from: "  const sels = document.querySelectorAll('.cam-year-select');\n  if (!sels.length) return;",
    to:   "  const sels = document.querySelectorAll('#camYearSelect');\n  if (!sels.length) return;" },
  { id: 'Y02', file: S, why: 'setCamYear moves only the Property Setup select',
    from: "  document.querySelectorAll('.cam-year-select').forEach(sel => {\n    if (sel.value !== String(_camYear)) sel.value = String(_camYear);\n  });",
    to:   "  document.querySelectorAll('#camYearSelect').forEach(sel => {\n    if (sel.value !== String(_camYear)) sel.value = String(_camYear);\n  });" },
  { id: 'Y03', file: S, why: 'switching the year after a run is never noticed',
    from: "            && getCamYear() !== lastResultsYear);\n}",
    to:   "            && false);\n}" },
  { id: 'Y04', file: S, why: "the results read as another year's even when it is the results' year",
    from: "            && getCamYear() !== lastResultsYear);\n}",
    to:   "            && true);\n}" },
  { id: 'Y05', file: S, why: 'the refusal panel has no "Change the CAM year" button',
    from: "    <button type=\"button\" class=\"cam-refusal-year-btn\" onclick=\"focusCamYearSelect()\">Change the CAM year &rsaquo;</button>\n", to: "" },
  { id: 'Y06', file: S, why: 'the refusal button focuses nothing',
    from: "  setTimeout(() => { try { sel.focus(); } catch (_) {} }, 350);", to: "  setTimeout(() => {}, 350);" },
  { id: 'Y07', file: S, why: "the Prepare hint never names the invoices' year",
    from: "    if (scope.in > 0 || !invAll.length) return '';\n    const byYear = {};", to: "    if (true) return '';\n    const byYear = {};" },
  { id: 'Y08', file: S, why: 'the hint shows even when the selected year has invoices',
    from: "    if (scope.in > 0 || !invAll.length) return '';\n    const byYear = {};", to: "    if (!invAll.length) return '';\n    const byYear = {};" },
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yearmut-'));
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

const SUITES = ['test-e2e-cam-year-choice.js'];
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
