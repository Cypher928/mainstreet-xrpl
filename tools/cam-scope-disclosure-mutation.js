'use strict';
/**
 * tools/cam-scope-disclosure-mutation.js — do the two scope fixes hold?
 *
 *   node tools/cam-scope-disclosure-mutation.js
 *
 * Both fixes are small expressions in strings and totals, which is the shape
 * that gets quietly undone. Each mutant restores one of the decisions that
 * produced the reported defects:
 *
 *   C01  the modal states camPool again — THE REPORTED DEFECT: $13,700 of
 *        CAM-recoverable expenses on a run that allocated from $4,500.
 *   C02  the headline and the table disagree, which is how one of them can be
 *        fixed and the other left behind.
 *   C03  the year filter stops narrowing the modal's eligible set, so the
 *        out-of-year line and the category rows go back to the gross.
 *   C04  the out-of-year subtraction is dropped from the pool.
 *   C05  an undated invoice is treated as out-of-year. The engine KEEPS it
 *        deliberately, and this is the mutant that proves the modal did not
 *        invent a stricter rule than the engine's.
 *   C06  the pro-rata count goes back to paidInvData.length — THE REPORTED
 *        DEFECT: "5 invoices distributed pro-rata" beside tenant cards reading
 *        "3 of 5".
 *   C07  the count takes the MINIMUM eligibleCount instead of the maximum, so
 *        one tenant's category exclusion shrinks the claim for everyone.
 *   C08  the "did not enter this allocation" disclosure is dropped.
 *   C09  the title stops saying "of N", so the scoped count loses its
 *        denominator and reads as the whole register again.
 *
 * A FAILING BASELINE IS NOT A PASS. The unmutated copy is asserted before any
 * mutant runs and the harness exits non-zero if it fails.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

const HEADLINE   = '      You are about to allocate <strong>${fmt(allocPool)}</strong> of CAM-recoverable';
const TABLE_ROW  = '      <tr><td><strong>Allocating from</strong></td><td><strong>${fmt(allocPool)}</strong></td></tr>';
const ELIGIBLE   = '  const eligible   = _camYear ? eligibleAll.filter(inv => camYearIncludes(inv, _camYear)) : eligibleAll;';
const ALLOC_POOL = '  const allocPool  = Math.max(0, camPool - outOfYear);';
const UNDATED_RULE = "function camYearIncludes(inv, year) { return camYearScopeOf(inv, year) !== 'out'; }";
const COUNT      = '        const _n          = _eligCounts.length ? Math.max(..._eligCounts) : paidInvData.length;';
const NOT_INCL   = '        const _notIncluded = Math.max(0, paidInvData.length - _n);';
const TITLE      = '          title:  `${_n}${_notIncluded > 0 ? ` of ${paidInvData.length}` : \'\'} ${_invWord} allocated as shared CAM expense${_n === 1 ? \'\' : \'s\'} (pro-rata)`,';

const MUTANTS = [
  { id: 'C01', file: 'script.js', why: 'the modal headline states the gross CAM pool again — THE REPORTED DEFECT',
    from: HEADLINE,
    to:   '      You are about to allocate <strong>${fmt(camPool)}</strong> of CAM-recoverable' },
  { id: 'C02', file: 'script.js', why: 'the table row disagrees with the headline',
    from: TABLE_ROW,
    to:   '      <tr><td><strong>Allocating from</strong></td><td><strong>${fmt(camPool)}</strong></td></tr>' },
  { id: 'C03', file: 'script.js', why: 'the modal stops scoping its eligible set to the year',
    from: ELIGIBLE, to: '  const eligible   = eligibleAll;' },
  { id: 'C04', file: 'script.js', why: 'the out-of-year amount is not subtracted from the pool',
    from: ALLOC_POOL, to: '  const allocPool  = camPool;' },
  { id: 'C05', file: 'script.js', why: 'an undated invoice is treated as out-of-year, which the engine never does',
    from: UNDATED_RULE,
    to:   "function camYearIncludes(inv, year) { return camYearScopeOf(inv, year) === 'in'; }" },

  { id: 'C06', file: 'script.js', why: 'the pro-rata count goes back to the register — THE REPORTED DEFECT',
    from: COUNT, to: '        const _n          = paidInvData.length;' },
  { id: 'C07', file: 'script.js', why: 'the count takes the minimum eligibleCount instead of the maximum',
    from: COUNT,
    to:   '        const _n          = _eligCounts.length ? Math.min(..._eligCounts) : paidInvData.length;' },
  { id: 'C08', file: 'script.js', why: 'the invoices that did not enter the allocation are no longer disclosed',
    from: NOT_INCL, to: '        const _notIncluded = 0;' },
  { id: 'C09', file: 'script.js', why: 'the title drops its denominator, so the count reads as the whole register',
    from: TITLE,
    to:   '          title:  `${_n} ${_invWord} allocated as shared CAM expense${_n === 1 ? \'\' : \'s\'} (pro-rata)`,' },
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scopemut-'));
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

// The new suite owns both disclosures. test-e2e-allocation-disclosure.js owns
// the CAM-eligibility half of the same modal, which this change must leave
// working — so a mutant cannot be "killed" by breaking the exclusion line that
// was already correct. test-lease-period.js guards the year-scope behaviour the
// extracted predicate came from.
const SUITES = ['test-e2e-cam-scope-disclosure.js',
                'test-e2e-allocation-disclosure.js',
                'test-lease-period.js'];
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
  if (i === -1) {
    console.log(`  ??   ${m.id}  ANCHOR NOT FOUND in ${m.file} — malformed mutant`);
    survived.push(m.id + ' (malformed)');
    continue;
  }
  if (src.indexOf(m.from, i + 1) !== -1) {
    console.log(`  ??   ${m.id}  ANCHOR NOT UNIQUE in ${m.file} — mutating only the first`);
  }
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
