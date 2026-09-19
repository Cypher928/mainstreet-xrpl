'use strict';
/**
 * tools/save-failure-mutation.js — can a save still fail in silence?
 *
 *   node tools/save-failure-mutation.js
 *
 * The property this protects is negative, and negative properties are the
 * easiest kind to test vacuously: "no silent failure" passes trivially when
 * nothing fails. So each mutant below reintroduces one specific way a save
 * could go wrong with nothing to show for it — a step moved back outside the
 * error boundary, a sink that swallows instead of reporting, a call site that
 * forgets to use it. Every one must be caught.
 *
 * A FAILING BASELINE IS NOT A PASS.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SCR = 'script.js';

const MUTANTS = [
  // ── the boundary ─────────────────────────────────────────────────────────
  { id: 'S01', file: SCR, why: '_captureSnapshot moves back outside the try — a throw there is silent again',
    from: '    // Snapshot before mutating storage — enables recoverLastSnapshot().\n    _captureSnapshot(property);\n    _lsSave(property);',
    to:   '    _lsSave(property);' },
  { id: 'S02', file: SCR, why: '_lsSave moves back outside the try — a quota error is silent again',
    from: '    _captureSnapshot(property);\n    _lsSave(property);\n',
    to:   '    _captureSnapshot(property);\n' },
  { id: 'S03', file: SCR, why: 'the generation moves inside the try, so the catch reads a stale gen',
    from: '  const gen = ++_saveGeneration;\n\n  try {',
    to:   '  try {\n    const gen = ++_saveGeneration;' },
  { id: 'S04', file: SCR, why: 'the localStorage copy is written AFTER the network attempt, losing work offline',
    from: '    _captureSnapshot(property);\n    _lsSave(property);\n    _setSyncStatus(\'local\');',
    to:   '    _captureSnapshot(property);\n    _setSyncStatus(\'local\');' },

  // ── the sink ─────────────────────────────────────────────────────────────
  { id: 'S05', file: SCR, why: 'the sink swallows the rejection without reporting anything',
    from: "  _setSyncStatus('error', e?.message || String(e));\n  logError('saveProperty:' + where, e, { propId: prop?.id, propName: prop?.name });",
    to:   "  void e;" },
  { id: 'S06', file: SCR, why: 'the sink logs but leaves the UI claiming the save is fine',
    from: "  _setSyncStatus('error', e?.message || String(e));\n  logError('saveProperty:' + where,",
    to:   "  logError('saveProperty:' + where," },
  { id: 'S07', file: SCR, why: 'the sink sets a status but writes no log, so nothing is recoverable after a reload',
    from: "  logError('saveProperty:' + where, e, { propId: prop?.id, propName: prop?.name });",
    to:   "  void where;" },
  { id: 'S08', file: SCR, why: 'the log stops naming the property, so it cannot say WHICH save was lost',
    from: "logError('saveProperty:' + where, e, { propId: prop?.id, propName: prop?.name });",
    to:   "logError('saveProperty:' + where, e, {});" },
  { id: 'S09', file: SCR, why: 'the sink rethrows, turning a handled failure back into an unhandled rejection',
    from: "const _saveFailed = (promise, prop, where) => Promise.resolve(promise).catch(e => {",
    to:   "const _saveFailed = (promise, prop, where) => Promise.resolve(promise).catch(e => { if (e) throw e;" },
  { id: 'S10', file: SCR, why: 'the sink reports on SUCCESS too, so a real failure is lost in the noise',
    from: "const _saveFailed = (promise, prop, where) => Promise.resolve(promise).catch(e => {",
    to:   "const _saveFailed = (promise, prop, where) => Promise.resolve(promise).then(() => { _setSyncStatus('error', 'ok'); }).catch(e => {" },

  // ── the call sites ───────────────────────────────────────────────────────
  { id: 'S11', file: SCR, why: 'the debounced save drops its sink — the 14:03 shape, restored',
    from: "_saveDebounceTimer = setTimeout(() => _saveFailed(saveProperty(prop), prop, 'debounced'), 800);",
    to:   "_saveDebounceTimer = setTimeout(() => saveProperty(prop), 800);" },
  { id: 'S12', file: SCR, why: 'the leaving-property save drops its sink',
    from: "_saveFailed(saveProperty(leavingProp), leavingProp, 'leaving');",
    to:   "saveProperty(leavingProp);" },
  { id: 'S13', file: SCR, why: 'the navigation save drops its sink',
    from: "_saveFailed(saveProperty(prop), prop, 'navigating');",
    to:   "saveProperty(prop);" },
  { id: 'S14', file: SCR, why: 'two call sites share one label, so a log cannot say which path failed',
    from: "_saveFailed(saveProperty(leavingProp), leavingProp, 'leaving');",
    to:   "_saveFailed(saveProperty(leavingProp), leavingProp, 'navigating');" },
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'savemut-'));
fs.cpSync(ROOT, tmp, {
  recursive: true,
  filter: (src) => {
    const rel = path.relative(ROOT, src);
    return !(rel === '.git' || rel.startsWith('.git' + path.sep) || rel === 'node_modules' || rel.startsWith('node_modules' + path.sep));
  },
});
const ORIGINAL = {};
for (const m of MUTANTS) if (!ORIGINAL[m.file]) ORIGINAL[m.file] = fs.readFileSync(path.join(ROOT, m.file), 'utf8');

const SUITES = ['test-save-failure-visible.js'];
function runSuites() {
  const failed = [];
  for (const suite of SUITES) {
    try { execFileSync(process.execPath, [suite], { cwd: tmp, stdio: 'pipe', timeout: 120000 }); }
    catch (_) { failed.push(suite); }
  }
  return failed;
}

const baseline = runSuites();
console.log('Baseline (unmutated copy): ' + (baseline.length ? 'FAIL ' + baseline.join(', ') : 'PASS'));
if (baseline.length) {
  console.error('\nThe unmutated copy does not pass, so every result below would be meaningless. Nothing is mutated.');
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(2);
}

let killed = 0, survived = 0;
const survivors = [];
for (const m of MUTANTS) {
  const src = ORIGINAL[m.file];
  if (src.indexOf(m.from) === -1) {
    console.log(`  ?  ${m.id} anchor not found in ${m.file} — the harness is stale, not the product`);
    survived++; survivors.push(m.id + ' (anchor missing)');
    continue;
  }
  fs.writeFileSync(path.join(tmp, m.file), src.replace(m.from, m.to));
  const failed = runSuites();
  fs.writeFileSync(path.join(tmp, m.file), src);
  if (failed.length) { killed++; console.log(`  \x1b[32m☠\x1b[0m  ${m.id} killed — ${m.why}`); }
  else { survived++; survivors.push(m.id); console.log(`  \x1b[31m✗\x1b[0m  ${m.id} SURVIVED — ${m.why}`); }
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log('\n' + '─'.repeat(58));
console.log(`${killed} killed, ${survived} survived of ${MUTANTS.length}`);
if (survived) { survivors.forEach(s => console.log('  · ' + s)); process.exit(1); }
