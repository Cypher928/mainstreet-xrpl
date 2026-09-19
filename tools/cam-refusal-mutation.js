'use strict';
/**
 * tools/cam-refusal-mutation.js — can a refused run pass for a successful one again?
 *
 *   node tools/cam-refusal-mutation.js
 *
 * R-1/R-2 was not a wrong number. The engine refused correctly every time; the
 * application ran on past the refusal and let four separate surfaces each decide
 * the run had worked — the property timeline, the run history, the step bar and
 * the completion toast — and the portfolio then advertised the unallocated pool
 * as CAM under management.
 *
 * The fix is a single branch on the engine's own verdict plus one shared
 * renderer, so there are three places for it to be lost and a small number of
 * ways to lose it in each. Four kinds of mutant:
 *
 *   GATE      the branch stops firing, fires on the wrong condition, or stops
 *             short-circuiting. Dropping the `return` is the ORIGINAL DEFECT
 *             reproduced exactly: the refusal is drawn on screen and then the
 *             success surfaces run anyway.
 *   VERDICT   the branch fires but the notice stops reading from the engine —
 *             produced unconditionally, or with the counts confused, so a
 *             successful run gets a refusal panel or a refusal gets the wrong
 *             reason.
 *   PAINT     the refusal is known and the screen keeps the success chrome:
 *             stale tenant cards or summary bar left underneath, the cap warning
 *             about charges that were never calculated left standing, or the
 *             heading still reading like a completed run.
 *   CARRY     the refusal does not survive to the next page load — dropped from
 *             the save whitelist, from the loader, or from the assignment in
 *             selectProperty (all three were separate omissions), or left
 *             standing after a later run succeeds.
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

const GATE     = '  if (_yearScope && _yearScope.refused === true) {';
const RETURN   = '      await saveProperty(_refProp);\n    }\n    return;\n  }';
const STEPBAR  = "    updateStepBar('calculate');";
const GUARD    = "  if (!scope || scope.refused !== true) return null;";
const DETAIL   = "  const detail = scope.reason === 'all_out_of_year'";
const COUNTS   = '  const outside = Number(scope.excluded) || 0;\n  const undated = Number(scope.undated)  || 0;';
const CAPCLEAR = "  section.querySelectorAll('.cam-cap-incomplete-warning').forEach(el => el.remove());";
const BODY     = '  body.innerHTML = _camRefusalHtml(scope);';
const TITLE    = '  if (title) title.textContent = `CAM ${n.year} — not reconciled`;';
const SAVE     = '      camRefusal:        stripped.camRefusal        ?? null,';
const LOAD     = '        camRefusal:        d.camRefusal        ?? null,';
const APPLY    = '    property.camRefusal        = data.camRefusal ?? null;';
const CLEAR    = '    delete _snapProp.camRefusal;';
const RESTORE  = `      const _refApplies = !!(_ref && _ref.refused === true &&
        String(_ref.year) === String(getCamYear()));`;

const MUTANTS = [
  // ── GATE ────────────────────────────────────────────────────────────────
  { id: 'R01', why: 'the refusal branch never fires — THE ORIGINAL DEFECT',
    from: GATE, to: '  if (false) {' },
  { id: 'R02', why: 'the branch draws the refusal and then runs the success surfaces anyway',
    from: RETURN, to: '      await saveProperty(_refProp);\n    }\n  }' },
  { id: 'R03', why: 'any year scope triggers a refusal, so an ordinary run is refused',
    from: GATE, to: '  if (_yearScope) {' },
  { id: 'R04', why: 'a falsy `refused` still counts, so a clean scope refuses',
    from: GATE, to: "  if (_yearScope && _yearScope.refused !== true) {" },
  { id: 'R05', why: 'the branch reads the result count instead of the engine’s verdict',
    from: GATE, to: '  if (fullResults.length === 0) {' },
  { id: 'R06', why: 'the step bar is advanced to Review on a refused run',
    from: STEPBAR, to: "    updateStepBar('review');" },
  { id: 'R07', why: 'the step bar is left wherever the previous state put it',
    from: STEPBAR, to: '' },

  // ── VERDICT ─────────────────────────────────────────────────────────────
  { id: 'R08', why: 'the notice is produced for any scope, refused or not',
    from: GUARD, to: '  if (!scope) return null;' },
  { id: 'R09', why: 'the notice is never produced',
    from: GUARD, to: '  if (scope) return null;' },
  { id: 'R10', why: 'every refusal is described as "all dated outside the year"',
    from: DETAIL, to: '  const detail = true' },
  { id: 'R11', why: 'no refusal is, so undated invoices are never named as undated',
    from: DETAIL, to: '  const detail = false' },
  { id: 'R12', why: 'the misdated and undated counts are swapped',
    from: COUNTS, to: '  const outside = Number(scope.undated) || 0;\n  const undated = Number(scope.excluded)  || 0;' },

  // ── PAINT ───────────────────────────────────────────────────────────────
  { id: 'R13', why: 'the cap warning about calculated charges is left standing',
    from: CAPCLEAR, to: '' },
  { id: 'R14', why: 'the refusal is appended, so a previous run’s cards stay underneath',
    from: BODY, to: '  body.innerHTML = body.innerHTML + _camRefusalHtml(scope);' },
  { id: 'R15', why: 'the results heading still reads like a completed reconciliation',
    from: TITLE, to: '  if (title) title.textContent = `${n.year} CAM — Cedar Park Commons`;' },
  { id: 'R16', why: 'renderCamRefusal reports success without painting anything',
    from: BODY, to: '  body.innerHTML = body.innerHTML;' },

  // ── CARRY ───────────────────────────────────────────────────────────────
  { id: 'R17', why: 'the refusal is dropped from the save whitelist, so storage never sees it',
    from: SAVE, to: '' },
  { id: 'R18', why: 'the refusal is stored but always null',
    from: SAVE, to: '      camRefusal:        null,' },
  { id: 'R19', why: 'the loader stops reading it back out of the blob',
    from: LOAD, to: '        camRefusal:        null,' },
  { id: 'R20', why: 'selectProperty stops applying it to the live property',
    from: APPLY, to: '' },
  { id: 'R21', why: 'a later successful run leaves the spent refusal behind',
    from: CLEAR, to: '' },
  { id: 'R22', why: 'the restored view renders a refusal recorded for any year',
    from: RESTORE, to: '      const _refApplies = !!(_ref && _ref.refused === true);' },
  { id: 'R23', why: 'the restored view never renders the refusal, falling back to "never run"',
    from: RESTORE, to: '      const _refApplies = false;' },
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'refmut-'));
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

const SUITES = ['test-cam-refusal.js', 'test-e2e-cam-year-refusal.js'];
function runSuites() {
  for (const suite of SUITES) {
    try {
      execFileSync(process.execPath, [suite], { cwd: tmp, stdio: 'pipe', timeout: 600000 });
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
    try { execFileSync(process.execPath, [suite], { cwd: tmp, stdio: 'pipe', timeout: 600000 }); }
    catch (e) { console.error('\n── ' + suite + ' ──\n' + String(e.stdout || e.message).slice(-3000)); }
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(2);
}

let killed = 0;
const survived = [];
for (const m of MUTANTS) {
  const file = m.file || 'script.js';
  const src = ORIGINAL[file];
  const i = src.indexOf(m.from);
  if (i === -1) {
    console.log(`  ??   ${m.id}  ANCHOR NOT FOUND in ${file} — malformed mutant`);
    survived.push(m.id + ' (malformed)');
    continue;
  }
  if (src.indexOf(m.from, i + 1) !== -1) {
    console.log(`  ??   ${m.id}  ANCHOR NOT UNIQUE in ${file} — mutating only the first`);
  }
  if (m.to === m.from) {
    console.log(`  ??   ${m.id}  NO-OP MUTANT`);
    survived.push(m.id + ' (no-op)');
    continue;
  }
  fs.writeFileSync(path.join(tmp, file), src.slice(0, i) + m.to + src.slice(i + m.from.length));
  const passedM = runSuites();
  fs.writeFileSync(path.join(tmp, file), src);
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
