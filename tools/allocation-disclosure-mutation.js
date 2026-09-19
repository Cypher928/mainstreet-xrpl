'use strict';
/**
 * tools/allocation-disclosure-mutation.js — do the three wording fixes hold?
 *
 *   node tools/allocation-disclosure-mutation.js
 *
 * Text changes are the easiest thing in a codebase to quietly undo, so each of
 * the three is mutated back toward what it said before, plus the near-misses:
 *
 *   SPACES  the empty state names a tab that does not exist again, or names no
 *           control at all (D01, D02).
 *   MODAL   the confirmation states the gross invoiced total instead of the
 *           recoverable pool — THE ORIGINAL DEFECT (D03) — or drops the
 *           exclusion line (D04, D05), or discloses one where there is none
 *           (D06), or lets the category rows contradict the headline (D07).
 *   LABEL   the gross figure is called the CAM pool again (D08, D09), or the
 *           relabelling over-reaches and renames the concentration finding,
 *           which legitimately measures against the recoverable pool (D10).
 *
 * D10 matters most of the three label mutants: the fix was to rename ONE of two
 * genuinely different pools, and a change that renamed both would look correct
 * on the panel while making the concentration sentence wrong.
 *
 * A FAILING BASELINE IS NOT A PASS. The unmutated copy is asserted before any
 * mutant runs and the harness exits non-zero if it fails.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

const SPACES_MSG = `      host.innerHTML = '<div class="ts-empty">No tenant spaces yet. Use ' +
        '<strong>Upload Leases</strong> or <strong>Add One Tenant</strong> in Lease intake below, ' +
        'and each tenant will appear here as a space.</div>';`;
const POOL_CALC  = '  const camPool  = window.CamPool ? (window.CamPool.total(invoices) || 0) : total;';
const EXCL_CALC  = '  const excluded = Math.max(0, total - camPool);';
const HEADLINE   = `      You are about to allocate <strong>${'${fmt(camPool)}'}</strong> of CAM-recoverable
      expenses across <strong>${'${tenants.length}'}</strong> tenant${'${tenants.length !== 1 ? \'s\' : \'\'}'}.`;
const EXCL_ROW   = `      ${'${excluded > 0'}
        ? \`<tr><td>Not CAM-eligible</td><td>&minus;${'${fmt(excluded)}'}</td></tr>\` : ''}`;
const CAT_SRC    = `  const catTotals = {};
  eligible.forEach(inv => {`;
const PANEL_ROW  = "          ['Total invoiced expenses', money(x.totalPool), null],";
const DESCRIBE   = '    const parts = [`${fmtMoney(x.totalPool)} total invoiced expenses`];';
const CONC_LABEL = '          `Total CAM pool: ${fmt(camPool)}`,';

const MUTANTS = [
  { id: 'D01', file: 'tenant-space.js', why: 'the empty state points at a Documents tab again — THE ORIGINAL DEFECT',
    from: SPACES_MSG,
    to: `      host.innerHTML = '<div class="ts-empty">No tenant spaces yet. Add tenants under Documents \\u2192 Add One Tenant, and they\\u2019ll appear here as spaces.</div>';` },
  { id: 'D02', file: 'tenant-space.js', why: 'the empty state names no control at all',
    from: SPACES_MSG,
    to: `      host.innerHTML = '<div class="ts-empty">No tenant spaces yet.</div>';` },

  { id: 'D03', file: 'script.js', why: 'the modal states the gross invoiced total again — THE ORIGINAL DEFECT',
    from: POOL_CALC, to: '  const camPool  = total;' },
  { id: 'D04', file: 'script.js', why: 'the excluded amount is computed as zero, so it is never disclosed',
    from: EXCL_CALC, to: '  const excluded = 0;' },
  { id: 'D05', file: 'script.js', why: 'the exclusion row is dropped from the table',
    from: EXCL_ROW, to: "      ${''}" },
  { id: 'D06', file: 'script.js', why: 'an exclusion is disclosed even when nothing is excluded',
    from: EXCL_CALC, to: '  const excluded = Math.max(1, total - camPool);' },
  { id: 'D07', file: 'script.js', why: 'category rows are struck off the gross, contradicting the headline',
    from: CAT_SRC, to: `  const catTotals = {};
  invoices.forEach(inv => {` },

  { id: 'D08', file: 'script.js', why: 'the panel calls the gross figure the CAM pool again',
    from: PANEL_ROW, to: "          ['Total CAM pool', money(x.totalPool), null]," },
  { id: 'D09', file: 'audit-exposure.js', why: 'the one-line summary calls it the CAM pool again',
    from: DESCRIBE, to: '    const parts = [`${fmtMoney(x.totalPool)} total CAM pool`];' },
  { id: 'D10', file: 'script.js', why: 'the rename over-reaches onto the concentration finding, which measures the RECOVERABLE pool',
    from: CONC_LABEL, to: '          `Total invoiced expenses: ${fmt(camPool)}`,' },
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'discmut-'));
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

// D10 is about not breaking the concentration finding, which test-cam-pool.js
// owns — so it runs alongside the new suite.
const SUITES = ['test-e2e-allocation-disclosure.js', 'test-cam-pool.js'];
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
