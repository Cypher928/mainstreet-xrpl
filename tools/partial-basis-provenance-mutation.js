'use strict';
/**
 * tools/partial-basis-provenance-mutation.js — does the confirmation suite bite?
 *
 *   node tools/partial-basis-provenance-mutation.js
 *
 * D-2 asks a narrow question: when a manager confirms a partial-period basis,
 * does that decision come back from a REAL reload still reading as the manager's
 * decision? The production path already does this. This harness is what proves
 * the suite that says so has teeth, by taking the mechanism apart one piece at a
 * time and requiring the suite to notice.
 *
 * Four kinds of mutant:
 *
 *   PERSIST   the normalized write is removed or defanged. tenant_field_evidence
 *             is authoritative — savePropertyData strips fieldEvidence out of the
 *             property blob because ms_useNormalizedEvidence is on — so losing
 *             that row is exactly the original defect: the value survives and its
 *             provenance does not.
 *   FLUSH     the blob write goes back on the 800ms keystroke debounce, so a
 *             manager who confirms and navigates leaves it in a timer.
 *   PROVENANCE the reader stops distinguishing a confirmation from the lease's own
 *             language — forced to 'lease' (the original defect) or forced to
 *             'manual' (the over-correction that would turn every extracted basis
 *             into a confirmation nobody gave; this is what the negative control
 *             exists to catch).
 *   RECOVERY  the evidence row stops being readable as the answer when the blob
 *             copy is lost, so a tenant is asked a second time for a confirmation
 *             already given.
 *
 * A FAILING BASELINE IS NOT A PASS. The unmutated copy is asserted before any
 * mutant runs and the harness exits non-zero if it fails.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const MUTATED_FILES = ['script.js', 'lease-period.js'];

const WRITE_ROW = "    try { await _writeTenantFieldEvidence(_propId, tenantId, 'partial_period_basis', _snap); }";
const SNAP_MADE = "    { value: key, manuallyEdited: true, approved: true });";
const FLUSH     = '  try { await savePropertyNow(); } catch (_) {}';
const RESOLVE   = "      return { basis: v, source: manualSnap ? 'manual' : 'lease', stated: true, raw: raw };";
// Anchored through the partial_period_basis slot above it: adminFeeBasis carries
// a byte-identical scan and recovery branch further down the same file.
const SCAN      = "    var snaps = (t.fieldEvidence && t.fieldEvidence.partial_period_basis\n"
                + "                 && t.fieldEvidence.partial_period_basis.snapshots) || [];\n"
                + '    var manualSnap = null;\n'
                + '    for (var i = snaps.length - 1; i >= 0; i--) {\n'
                + '      if (snaps[i] && snaps[i].manuallyEdited === true) { manualSnap = snaps[i]; break; }\n'
                + '    }';
const RECOVER   = "    if (v === '' && manualSnap) {\n"
                + '      var mv = manualSnap.value == null ? \'\' : String(manualSnap.value).trim().toLowerCase();\n'
                + '      if (BASES.indexOf(mv) >= 0) {';

const MUTANTS = [
  // ── PERSIST: the row that survives the strip ────────────────────────────
  { id: 'P01', file: 'script.js', why: 'the normalized evidence write is removed entirely',
    from: WRITE_ROW, to: '    try { /* removed */ }' },
  { id: 'P02', file: 'script.js', why: 'the row is written for a different field, so this one has none',
    from: WRITE_ROW,
    to: "    try { await _writeTenantFieldEvidence(_propId, tenantId, 'cam_cap', _snap); }" },
  { id: 'P03', file: 'script.js', why: 'the write is fired but never awaited, so a reload can beat it',
    from: WRITE_ROW,
    to: "    try { _writeTenantFieldEvidence(_propId, tenantId, 'partial_period_basis', _snap); }" },
  { id: 'P04', file: 'script.js', why: 'the snapshot is no longer marked as manually edited',
    from: SNAP_MADE, to: "    { value: key, manuallyEdited: false, approved: true });" },
  { id: 'P05', file: 'script.js', why: 'the snapshot carries no value, so nothing can be recovered from it',
    from: SNAP_MADE, to: "    { value: null, manuallyEdited: true, approved: true });" },

  // ── FLUSH: the value must be on disk, not in a timer ───────────────────
  { id: 'P06', file: 'script.js', why: 'the confirmation goes back on the keystroke debounce',
    from: FLUSH, to: '  try { /* no immediate flush */ } catch (_) {}' },

  // ── PROVENANCE: a confirmation is not the lease, and vice versa ────────
  { id: 'P07', file: 'lease-period.js', why: 'a recognised value always reads as the lease — THE ORIGINAL DEFECT',
    from: RESOLVE, to: "      return { basis: v, source: 'lease', stated: true, raw: raw };" },
  { id: 'P08', file: 'lease-period.js', why: 'a recognised value always reads as manual — the over-correction',
    from: RESOLVE, to: "      return { basis: v, source: 'manual', stated: true, raw: raw };" },
  { id: 'P09', file: 'lease-period.js', why: 'the manual snapshot scan never finds one',
    from: SCAN, to: SCAN.replace('snaps[i].manuallyEdited === true', 'false') },
  { id: 'P10', file: 'lease-period.js', why: 'any snapshot counts as manual, extracted ones included',
    from: SCAN, to: SCAN.replace('snaps[i] && snaps[i].manuallyEdited === true', 'snaps[i]') },

  // ── RECOVERY: the row is the record, not a footnote ───────────────────
  { id: 'P11', file: 'lease-period.js', why: 'the answer is no longer recoverable from its evidence row',
    from: RECOVER, to: RECOVER.replace("if (v === '' && manualSnap) {", 'if (false) {') },
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pbpmut-'));
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

const SUITES = ['test-e2e-partial-basis-persistence.js'];
function runSuites() {
  for (const suite of SUITES) {
    try {
      execFileSync(process.execPath, [suite], {
        cwd: tmp, stdio: 'pipe', timeout: 600000,
        env: Object.assign({}, process.env, { APP_PORT: '7981' }),
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
      execFileSync(process.execPath, [suite], { cwd: tmp, stdio: 'pipe', timeout: 600000,
        env: Object.assign({}, process.env, { APP_PORT: '7981' }) });
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
