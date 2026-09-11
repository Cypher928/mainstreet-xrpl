'use strict';
/**
 * tools/cam-coverage-label-mutation.js — does the coverage-label suite bite?
 *
 *   node tools/cam-coverage-label-mutation.js
 *
 * Three kinds of mutant:
 *
 *   REGRESS   the badge goes back to calling the ratio "coverage", or to some
 *             other word that claims coverage. This is the defect: two numbers
 *             on one card sharing a name, 43 points apart.
 *   VALUE     the arithmetic moves. The slice was a RELABEL — the numerator,
 *             the denominator and the rounding must all be exactly as they
 *             were, and a suite that would not notice them moving is not
 *             protecting the thing it claims to protect.
 *   COLLATERAL the real coverage KPIs, the allocation KPI or the caps figure
 *             change while the badge is being renamed.
 *
 * A FAILING BASELINE IS NOT A PASS. The unmutated copy is asserted before any
 * mutant runs and the harness exits non-zero if it fails.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const MUTATED_FILES = ['script.js'];

const BADGE = '>${totalPool > 0 ? (totalBilled / totalPool * 100).toFixed(1) : \'—\'}% of pool allocated</span>';

const MUTANTS = [
  // ── REGRESS: the word comes back ────────────────────────────────────────
  { id: 'C01', file: 'script.js', why: 'the badge calls the ratio "coverage" again — the defect',
    from: BADGE, to: '>${totalPool > 0 ? (totalBilled / totalPool * 100).toFixed(1) : \'—\'}% coverage</span>' },
  { id: 'C02', file: 'script.js', why: 'the badge says "covered" instead',
    from: BADGE, to: '>${totalPool > 0 ? (totalBilled / totalPool * 100).toFixed(1) : \'—\'}% covered</span>' },
  { id: 'C03', file: 'script.js', why: 'the badge drops the word that names the metric',
    from: BADGE, to: '>${totalPool > 0 ? (totalBilled / totalPool * 100).toFixed(1) : \'—\'}%</span>' },
  { id: 'C04', file: 'script.js', why: 'the badge names the pool but not what happened to it',
    from: BADGE, to: '>${totalPool > 0 ? (totalBilled / totalPool * 100).toFixed(1) : \'—\'}% of pool</span>' },
  { id: 'C05', file: 'script.js', why: 'the tooltip stops disclaiming the coverage reading',
    from: 'Not a coverage figure — see &quot;Space under lease&quot; below',
    to:   'See &quot;Space under lease&quot; below' },
  { id: 'C06', file: 'script.js', why: 'the tooltip stops naming the two figures behind the ratio',
    from: 'title="Share of the gross expense pool allocated to tenants: ${fmt(totalBilled)} of ${fmt(totalPool)}.',
    to:   'title="Share of the gross expense pool allocated to tenants.' },

  // ── VALUE: the relabel quietly moves the number ─────────────────────────
  { id: 'C07', file: 'script.js', why: 'the numerator becomes the capped-out amount',
    from: '>${totalPool > 0 ? (totalBilled / totalPool * 100).toFixed(1)',
    to:   '>${totalPool > 0 ? ((totalPool - totalBilled) / totalPool * 100).toFixed(1)' },
  { id: 'C08', file: 'script.js', why: 'the denominator becomes the CAM-eligible pool rather than the gross pool',
    from: '>${totalPool > 0 ? (totalBilled / totalPool * 100).toFixed(1)',
    to:   '>${camPoolTotal > 0 ? (totalBilled / camPoolTotal * 100).toFixed(1)' },
  { id: 'C09', file: 'script.js', why: 'the ratio is reported to a different precision',
    from: '% of pool allocated</span>', to: '%% of pool allocated</span>' },
  { id: 'C10', file: 'script.js', why: 'the ratio rounds to whole percent, losing the .1',
    from: '(totalBilled / totalPool * 100).toFixed(1) : \'—\'}% of pool allocated',
    to:   '(totalBilled / totalPool * 100).toFixed(0) : \'—\'}% of pool allocated' },
  { id: 'C11', file: 'script.js', why: 'the numerator sums the pro-rata share instead of the allocation',
    from: '  const totalBilled = results.reduce((s, r) => s + r.totalAllocated, 0);',
    to:   '  const totalBilled = results.reduce((s, r) => s + (r.proRataPercent || 0), 0);' },
  { id: 'C12', file: 'script.js', why: 'the denominator drops invoices with unparseable amounts silently',
    from: '  const totalPool   = invoices.reduce((s, inv) => s + (parseFloat(inv.amount) || 0), 0);',
    to:   '  const totalPool   = invoices.filter(inv => parseFloat(inv.amount) > 0).length * 1000;' },
  { id: 'C13', file: 'script.js', why: 'a zero pool renders 0% rather than declining to divide',
    from: '>${totalPool > 0 ? (totalBilled / totalPool * 100).toFixed(1) : \'—\'}',
    to:   '>${(totalBilled / totalPool * 100).toFixed(1)}' },

  // ── COLLATERAL: the neighbours move ─────────────────────────────────────
  { id: 'C14', file: 'script.js', why: 'the real coverage KPI is renamed too',
    from: '<div class="rcs-kpi-lbl">Space under lease</div>',
    to:   '<div class="rcs-kpi-lbl">Space allocated</div>' },
  { id: 'C15', file: 'script.js', why: 'the real coverage KPI shows the allocation ratio',
    from: '<div class="rcs-kpi ${proCls}"><div class="rcs-kpi-val">${proRataSum.toFixed(1)}%</div>',
    to:   '<div class="rcs-kpi ${proCls}"><div class="rcs-kpi-val">${(totalBilled / totalPool * 100).toFixed(1)}%</div>' },
  { id: 'C16', file: 'script.js', why: 'the covered-all-year KPI takes the space figure',
    from: '<div class="rcs-kpi-val">${_occCoveredPct.toFixed(1)}%</div><div class="rcs-kpi-lbl">Covered all year</div>',
    to:   '<div class="rcs-kpi-val">${(totalBilled / totalPool * 100).toFixed(1)}%</div><div class="rcs-kpi-lbl">Covered all year</div>' },
  { id: 'C17', file: 'script.js', why: 'the allocation KPI stops refusing the word "billed" on a blocked run',
    from: "          _billable ? 'Total Billed' : 'Calculated Tenant Allocation'}</div></div>",
    to:   "          'Total Billed'}</div></div>" },
  { id: 'C18', file: 'script.js', why: 'the caps figure moves',
    from: '${capsCount > 0 ? capsCount + \' (−\' + fmt(capTotal) + \')\' : \'0\'}',
    to:   '${capsCount > 0 ? capsCount + \' (−\' + fmt(capTotal * 2) + \')\' : \'0\'}' },
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cclmut-'));
// WHOLE TREE, minus .git and node_modules — a hand-listed subset has twice
// produced a baseline that could not load its own dependencies.
fs.cpSync(ROOT, tmp, {
  recursive: true,
  filter: (src) => {
    const rel = path.relative(ROOT, src);
    return !(rel === '.git' || rel.startsWith('.git' + path.sep) ||
             rel === 'node_modules' || rel.startsWith('node_modules' + path.sep));
  },
});
const ORIGINAL = {};
for (const f of MUTATED_FILES) ORIGINAL[f] = fs.readFileSync(path.join(ROOT, f), 'utf8');

const SUITES = ['test-cam-coverage-label.js'];
function runSuites() {
  for (const suite of SUITES) {
    try {
      execFileSync(process.execPath, [suite], {
        cwd: tmp, stdio: 'pipe', timeout: 300000,
        env: Object.assign({}, process.env, { CCL_PORT: '8979' }),
      });
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
    try {
      execFileSync(process.execPath, [suite], { cwd: tmp, stdio: 'pipe', timeout: 300000,
        env: Object.assign({}, process.env, { CCL_PORT: '8979' }) });
    } catch (e) { console.error('\n── ' + suite + ' ──\n' + String(e.stdout || e.message).slice(-3000)); }
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
  fs.writeFileSync(path.join(tmp, m.file), src.slice(0, i) + m.to + src.slice(i + m.from.length));
  const passedM = runSuites();
  fs.writeFileSync(path.join(tmp, m.file), src);
  if (passedM) { survived.push(`${m.id} ${m.file}: ${m.why}`); console.log(`  LIVE ${m.id}  ${m.why}`); }
  else         { killed++;                                    console.log(`  kill ${m.id}  ${m.why}`); }
}

console.log(`\n${killed}/${MUTANTS.length} killed`);
if (survived.length) {
  console.log('\nSURVIVORS — each needs a written verdict (real gap or equivalent):');
  survived.forEach(s => console.log('  · ' + s));
}
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(survived.length ? 1 : 0);
