'use strict';
/**
 * tools/cap-resolution-mutation.js — does "CAM cap unresolved → enter base → re-run → applied" hold?
 *
 *   node tools/cap-resolution-mutation.js
 *
 *   C01  an undeclared cap stops offering the base (actionable false)
 *   C02  an undeclared cap names no field (the button loses its target)
 *   C03  the old sentence comes back ("Cap type needs confirmation …")
 *   C04  the warning no longer says the base is what is missing
 *   C05  the cap warning is not cleared before a run (stale and duplicate banners)
 *   C06  the "Add cap base" button is rendered without its fix action
 *   C07  the fix path stops focusing the named field
 *
 * A FAILING BASELINE IS NOT A PASS.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const S = 'script.js', LI = 'lease-intelligence.js';

const MUTANTS = [
  { id: 'C01', file: LI, why: 'an undeclared cap stops offering the base',
    from: "      return { state: 'unit_unconfirmed', unit, enforceable: false, actionable: true,",
    to:   "      return { state: 'unit_unconfirmed', unit, enforceable: false, actionable: false," },
  { id: 'C02', file: LI, why: 'an undeclared cap names no field',
    from: "               needed: 'Prior-Year CAM Base ($)', field: 'cap_base_amount' };",
    to:   "               needed: 'Prior-Year CAM Base ($)', field: null };" },
  { id: 'C03', file: LI, why: 'the old sentence comes back',
    from: "               title: 'CAM cap on file — prior-year base needed',",
    to:   "               title: 'Cap type needs confirmation'," },
  { id: 'C04', file: LI, why: 'the warning no longer says the base is what is missing',
    from: "               why: 'A CAM cap of ' + pct + ' is on file, and MainStreet has no prior-year CAM base for this tenant, so the cap is not being applied. '",
    to:   "               why: 'A CAM cap of ' + pct + ' is on file. '" },
  { id: 'C05', file: S, why: 'the cap warning is not cleared before a run',
    from: "  section.querySelectorAll('.cam-sqft-warning, .cam-skip-warning, .cam-cap-incomplete-warning').forEach(el => el.remove());",
    to:   "  section.querySelectorAll('.cam-sqft-warning, .cam-skip-warning').forEach(el => el.remove());" },
  { id: 'C06', file: S, why: 'the "Add cap base" button is rendered without its fix action',
    from: "               onclick=\"openReviewItemFix('${esc(String(x.t.id)).replace(/'/g, \"\\\\'\")}','cap_base_amount')\">Add cap base &#x2192;</button>`",
    to:   "               onclick=\"void 0\">Add cap base &#x2192;</button>`" },
  { id: 'C07', file: S, why: 'the fix path stops focusing the named field',
    from: "        if (f) { tgt = f; const inp = f.querySelector('input, select'); if (inp) { try { inp.focus(); } catch (_) {} } }",
    to:   "        if (f) { tgt = f; }" },
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'capresmut-'));
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

const SUITES = ['test-e2e-cap-resolution.js'];
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
