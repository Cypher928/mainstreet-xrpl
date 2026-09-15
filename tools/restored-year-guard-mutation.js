'use strict';
/**
 * tools/restored-year-guard-mutation.js — does the restored year really hold?
 *
 *   node tools/restored-year-guard-mutation.js
 *
 * One line of state restoration, so a small harness. The guards it feeds are
 * not mutated — they were already correct and are out of scope; what is mutated
 * is the value they read, which is the only thing this slice changed.
 *
 *   Y01  the assignment is gone — THE ORIGINAL DEFECT: after a reload the
 *        guards read null, pass, and the export produces a file named for the
 *        selected year containing another year's rows.
 *   Y02  the year is taken from the selector rather than the snapshot, so it
 *        always equals getCamYear() and the guard can never fire. This is the
 *        plausible wrong fix, and the reason the value must come from the
 *        snapshot: a year that tracks the selection cannot contradict it.
 *   Y03  the string is not parsed, so '2025' !== 2025 and the guard refuses
 *        even at the correct year — protection turned into obstruction.
 *   Y04  a snapshot with no stored year is given today's, inventing a claim the
 *        record cannot support.
 *   Y05  a snapshot with no stored year keeps whatever the session was carrying,
 *        so the last property's year stands as a claim about these results.
 *   Y06  off by one.
 *
 * A FAILING BASELINE IS NOT A PASS. The unmutated copy is asserted before any
 * mutant runs and the harness exits non-zero if it fails.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const FILE = 'script.js';
const ASSIGN = "    lastResultsYear = snapshot.camYear ? (parseInt(snapshot.camYear, 10) || null) : null;";

const MUTANTS = [
  { id: 'Y01', why: 'the assignment is gone — THE ORIGINAL DEFECT', to: '' },
  { id: 'Y02', why: 'the year is read from the selector, so the guard can never fire',
    to: '    lastResultsYear = getCamYear();' },
  { id: 'Y03', why: 'the year is left a string, so the guard refuses at the correct year too',
    to: '    lastResultsYear = snapshot.camYear ? String(snapshot.camYear) : null;' },
  { id: 'Y04', why: 'a snapshot with no year is given the current one',
    to: '    lastResultsYear = snapshot.camYear ? (parseInt(snapshot.camYear, 10) || null) : new Date().getFullYear();' },
  { id: 'Y05', why: 'a snapshot with no year keeps the last property’s year',
    to: '    if (snapshot.camYear) lastResultsYear = parseInt(snapshot.camYear, 10) || null;' },
  { id: 'Y06', why: 'off by one',
    to: '    lastResultsYear = snapshot.camYear ? (parseInt(snapshot.camYear, 10) + 1 || null) : null;' },
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rygmut-'));
fs.cpSync(ROOT, tmp, {
  recursive: true,
  filter: (src) => {
    const rel = path.relative(ROOT, src);
    return !(rel === '.git' || rel.startsWith('.git' + path.sep) ||
             rel === 'node_modules' || rel.startsWith('node_modules' + path.sep));
  },
});
const ORIGINAL = fs.readFileSync(path.join(ROOT, FILE), 'utf8');

const SUITES = ['test-e2e-restored-year-guard.js'];
function runSuites() {
  for (const suite of SUITES) {
    try {
      execFileSync(process.execPath, [suite], { cwd: tmp, stdio: 'pipe', timeout: 900000 });
    } catch (_) { return false; }
  }
  return true;
}

const baseline = runSuites();
console.log('Baseline (unmutated copy): ' + (baseline ? 'PASS' : 'FAIL'));
if (!baseline) {
  console.error('\nThe unmutated copy does not pass, so every result below would be\n' +
                'meaningless. Nothing is mutated. Fix the harness or the suite first.');
  for (const suite of SUITES) {
    try { execFileSync(process.execPath, [suite], { cwd: tmp, stdio: 'pipe', timeout: 900000 }); }
    catch (e) { console.error('\n── ' + suite + ' ──\n' + String(e.stdout || e.message).slice(-3000)); }
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(2);
}

let killed = 0;
const survived = [];
const i = ORIGINAL.indexOf(ASSIGN);
if (i === -1) {
  console.error('ANCHOR NOT FOUND — the assignment this harness exists for is not in ' + FILE);
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(2);
}
if (ORIGINAL.indexOf(ASSIGN, i + 1) !== -1) console.log('  ??   ANCHOR NOT UNIQUE — mutating only the first');

for (const m of MUTANTS) {
  if (m.to === ASSIGN) { console.log(`  ??   ${m.id}  NO-OP MUTANT`); survived.push(m.id + ' (no-op)'); continue; }
  fs.writeFileSync(path.join(tmp, FILE), ORIGINAL.slice(0, i) + m.to + ORIGINAL.slice(i + ASSIGN.length));
  const passedM = runSuites();
  fs.writeFileSync(path.join(tmp, FILE), ORIGINAL);
  if (passedM) { survived.push(`${m.id}: ${m.why}`); console.log(`  LIVE ${m.id}  ${m.why}`); }
  else         { killed++;                          console.log(`  kill ${m.id}  ${m.why}`); }
}

console.log(`\n${killed}/${MUTANTS.length} killed`);
if (survived.length) {
  console.log('\nSURVIVORS — each needs a written verdict (real gap or equivalent):');
  survived.forEach(s => console.log('  · ' + s));
}
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(survived.length ? 1 : 0);
