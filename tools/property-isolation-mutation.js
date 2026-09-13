'use strict';
/**
 * tools/property-isolation-mutation.js — do the two-property tests have teeth?
 *
 *   node tools/property-isolation-mutation.js
 *
 * Three one-line repairs, so a small harness aimed squarely at them. Each
 * mutant is a way the repair could be removed or mis-made:
 *
 *   SCOPE   the late advisor refresh stops checking whose property it is, or
 *           checks the wrong thing. P01 is the ORIGINAL DEFECT — the debounced
 *           refresh fires holding the property the manager just left and paints
 *           its Spaces list and attention panel over the one they opened.
 *   POOL    the restored CAM pool is not restored, is taken from the wrong
 *           source, or is set to a value the audit findings then measure
 *           against. P04 is the ORIGINAL DEFECT for HIGH-1: leave lastCamPool
 *           alone and a restored property keeps the previous run's denominator.
 *   STALE   the saved reconciliation stops being compared against current data,
 *           is compared on fields that cannot change an allocation, or the
 *           comparison is inverted or made unconditional. P07 is the ORIGINAL
 *           DEFECT for HIGH-3.
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

const GUARD  = '    if (!prop || (activePropId != null && prop.id !== activePropId)) return;';
const POOL   = `    lastCamPool = (window.CamPool && lastInvoicesFull.length)
      ? (window.CamPool.total(lastInvoicesFull) || 0)
      : 0;`;
const COMPARE = `      if (snapshot.inputsFingerprint) {
        const _now = camInputsFingerprint(currentProperty()?.tenants, invoiceData);
        _resultsStale = _now !== snapshot.inputsFingerprint;
      } else {
        _resultsStale = false;
      }`;
const FP_SQFT = "      String(parseSqft(x.leased_sqft) ?? ''),";
const FP_AMT  = "      String(parseMoney(x.amount) ?? ''),";
const STORE   = `      inputsFingerprint: (() => {
        try { return camInputsFingerprint(currentProperty()?.tenants, invoiceData); }
        catch (_) { return null; }
      })(),`;

const MUTANTS = [
  // ── SCOPE (HIGH-2) ──────────────────────────────────────────────────────
  { id: 'P01', why: 'the late refresh paints whichever property it was handed — THE ORIGINAL DEFECT',
    from: GUARD, to: '' },
  { id: 'P02', why: 'the guard compares the wrong way round, so it only ever paints the WRONG property',
    from: GUARD, to: '    if (!prop || (activePropId != null && prop.id === activePropId)) return;' },
  { id: 'P03', why: 'the guard accepts any property that has an id',
    from: GUARD, to: '    if (!prop || !prop.id) return;' },

  // ── POOL (HIGH-1) ───────────────────────────────────────────────────────
  { id: 'P04', why: 'the restored pool is left as the previous run’s — THE ORIGINAL DEFECT',
    from: POOL, to: '' },
  { id: 'P05', why: 'the restored pool is the gross total rather than the CAM-eligible pool',
    from: POOL, to: '    lastCamPool = lastTotal || 0;' },
  { id: 'P06', why: 'the restored pool is zeroed even when the snapshot carries invoices',
    from: POOL, to: '    lastCamPool = 0;' },

  // ── STALE (HIGH-3) ──────────────────────────────────────────────────────
  { id: 'P07', why: 'a restored run is never compared against current data — THE ORIGINAL DEFECT',
    from: COMPARE, to: '      _resultsStale = false;' },
  { id: 'P08', why: 'the comparison is inverted, so valid results are blocked and stale ones pass',
    from: COMPARE, to: `      if (snapshot.inputsFingerprint) {
        const _now = camInputsFingerprint(currentProperty()?.tenants, invoiceData);
        _resultsStale = _now === snapshot.inputsFingerprint;
      } else {
        _resultsStale = false;
      }` },
  { id: 'P09', why: 'every restored run is treated as stale, blocking valid exports for ever',
    from: COMPARE, to: '      _resultsStale = true;' },
  { id: 'P10', why: 'the fingerprint ignores leased area, so a sqft correction goes unnoticed',
    from: FP_SQFT, to: "      '',", },
  { id: 'P11', why: 'the fingerprint ignores invoice amounts, so a changed expense goes unnoticed',
    from: FP_AMT, to: "      '',", },
  { id: 'P12', why: 'nothing is stored to compare against, so no restored run can ever be judged',
    from: STORE, to: '      inputsFingerprint: null,' },
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pisomut-'));
fs.cpSync(ROOT, tmp, {
  recursive: true,
  filter: (src) => {
    const rel = path.relative(ROOT, src);
    return !(rel === '.git' || rel.startsWith('.git' + path.sep) ||
             rel === 'node_modules' || rel.startsWith('node_modules' + path.sep));
  },
});
const ORIGINAL = fs.readFileSync(path.join(ROOT, FILE), 'utf8');

const SUITES = ['test-e2e-property-switch-isolation.js', 'test-e2e-stale-results-persistence.js'];
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
  const i = ORIGINAL.indexOf(m.from);
  if (i === -1) {
    console.log(`  ??   ${m.id}  ANCHOR NOT FOUND — malformed mutant`);
    survived.push(m.id + ' (malformed)');
    continue;
  }
  if (ORIGINAL.indexOf(m.from, i + 1) !== -1) {
    console.log(`  ??   ${m.id}  ANCHOR NOT UNIQUE — mutating only the first`);
  }
  if (m.to === m.from) { console.log(`  ??   ${m.id}  NO-OP MUTANT`); survived.push(m.id + ' (no-op)'); continue; }
  fs.writeFileSync(path.join(tmp, FILE), ORIGINAL.slice(0, i) + m.to + ORIGINAL.slice(i + m.from.length));
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
