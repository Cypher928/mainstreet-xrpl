'use strict';
/**
 * tools/legacy-snapshot-mutation.js — can a legacy snapshot slip through again?
 *
 *   node tools/legacy-snapshot-mutation.js
 *
 * The six classes this must kill, from the defect it closes:
 *
 *   SKIP     legacy reconstruction never runs, so a fingerprint-less snapshot
 *            falls through to whatever the else-branch says (L01, L02).
 *   VALID    a snapshot that cannot account for itself is treated as valid —
 *            THE ORIGINAL DEFECT, and the one that exported
 *            "4200","16.15","19021.16" after a lease was corrected to 5,200
 *            (L03, L04).
 *   SQFT     the comparison stops seeing leased area (L05, L06).
 *   AMOUNT   it stops seeing invoice amounts (L07).
 *   POOL     it stops seeing what is recoverable — category or CAM-eligibility
 *            (L08, L09). The fixture keeps the recoverable pool (88,400) apart
 *            from the invoiced total (114,500) precisely so a mutant reading
 *            the wrong one cannot pass.
 *   GUARD    the export guard is bypassed, so the block never reaches the file
 *            (L10, L11).
 *
 * Plus the demo stamp (L12): without it the demo opens unverifiable, which the
 * suite treats as a failure rather than a cosmetic difference.
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

const RECON_CALL = '      const _was = snapshot.inputsFingerprint || camSnapshotInputsFingerprint(snapshot);';
const UNKNOWN    = `      } else {
        _resultsStale      = true;
        _resultsUnverified = true;
      }`;
const GUARD_T    = '  if (!Array.isArray(tRows) || !tRows.length) return null;';
const GUARD_I    = '  if (!Array.isArray(iRows) || !iRows.length) return null;';
const FP_SQFT    = "      String(parseSqft(x.leased_sqft) ?? ''),";
const FP_AMT     = "      String(parseMoney(x.amount) ?? ''),";
const FP_CAT     = "      String(x.category || ''),";
const FP_ELIG    = '      String(window.CamPool ? window.CamPool.isEligible(x) : true),';
const MAP_SQFT   = '        leased_sqft:        t.leasedSqft,';
const EXPORT_G   = `  if (_resultsStale) {
    showToast('⚠️ Results may be stale — lease or invoice data changed since last run. Re-run reconciliation before exporting.', { color: '#92400e', textColor: '#fef3c7', duration: 7000 });
    return;
  }`;
const STMT_G     = `  if (_resultsStale) {
    showToast('⚠️ Results may be stale — lease or invoice data changed since the last run. Re-run the reconciliation before generating a tenant statement.', { color: '#92400e', textColor: '#fef3c7', duration: 7000 });
    return;
  }`;
const DEMO_STAMP = `    inputsFingerprint: (() => {
      try { return camInputsFingerprint(demoTenants, demoInvoiceList); }
      catch (_) { return null; }
    })(),`;

const MUTANTS = [
  // ── SKIP ────────────────────────────────────────────────────────────────
  { id: 'L01', why: 'legacy reconstruction is never attempted',
    from: RECON_CALL, to: '      const _was = snapshot.inputsFingerprint;' },
  { id: 'L02', why: 'reconstruction always declines, even with the inputs present',
    from: GUARD_T, to: '  if (true) return null;' },

  // ── VALID ───────────────────────────────────────────────────────────────
  { id: 'L03', why: 'an unverifiable snapshot is treated as valid — THE ORIGINAL DEFECT',
    from: UNKNOWN, to: `      } else {
        _resultsStale      = false;
        _resultsUnverified = false;
      }` },
  { id: 'L04', why: 'unverifiable is flagged but not blocking',
    from: UNKNOWN, to: `      } else {
        _resultsStale      = false;
        _resultsUnverified = true;
      }` },

  // ── SQFT ────────────────────────────────────────────────────────────────
  { id: 'L05', why: 'the fingerprint ignores leased area',
    from: FP_SQFT, to: "      ''," },
  { id: 'L06', why: 'the legacy mapping drops leased area, so only new runs see it',
    from: MAP_SQFT, to: '        leased_sqft:        null,' },

  // ── AMOUNT ──────────────────────────────────────────────────────────────
  { id: 'L07', why: 'the fingerprint ignores invoice amounts',
    from: FP_AMT, to: "      ''," },

  // ── POOL (category / eligibility) ───────────────────────────────────────
  { id: 'L08', why: 'the fingerprint ignores invoice category',
    from: FP_CAT, to: "      ''," },
  { id: 'L09', why: 'the fingerprint ignores CAM eligibility — the recoverable pool can change unseen',
    from: FP_ELIG, to: "      ''," },

  // ── GUARD ───────────────────────────────────────────────────────────────
  { id: 'L10', why: 'the stale export guard is bypassed',
    from: EXPORT_G, to: '' },
  { id: 'L11', why: 'the stale statement guard is bypassed',
    from: STMT_G, to: '' },

  // ── DEMO ────────────────────────────────────────────────────────────────
  { id: 'L12', why: 'the demo seed is not stamped, so the demo opens unverifiable',
    from: DEMO_STAMP, to: '    inputsFingerprint: null,' },
  { id: 'L13', why: 'the demo is stamped from the wrong inputs, so it opens stale',
    from: DEMO_STAMP, to: `    inputsFingerprint: (() => {
      try { return camInputsFingerprint(demoTenants, []); }
      catch (_) { return null; }
    })(),` },
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'legmut-'));
fs.cpSync(ROOT, tmp, {
  recursive: true,
  filter: (src) => {
    const rel = path.relative(ROOT, src);
    return !(rel === '.git' || rel.startsWith('.git' + path.sep) ||
             rel === 'node_modules' || rel.startsWith('node_modules' + path.sep));
  },
});
const ORIGINAL = fs.readFileSync(path.join(ROOT, FILE), 'utf8');

const SUITES = ['test-e2e-legacy-snapshot-integrity.js'];
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
