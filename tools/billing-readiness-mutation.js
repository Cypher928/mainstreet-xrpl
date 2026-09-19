'use strict';
/**
 * tools/billing-readiness-mutation.js — does the billing-consistency suite bite?
 *
 *   node tools/billing-readiness-mutation.js
 *
 * Four kinds of mutant:
 *
 *   REGRESS    the Space goes back to deriving its own verdict from the
 *              CALCULATION status — the original defect, in which five blocked
 *              tenants each read "Ready".
 *   OPTIMISM   an unanswerable question resolves to something billable: a null
 *              verdict, a throwing authority, a missing name, an accessor that
 *              invents an exposure rather than declining.
 *   IDENTITY   the verdict is fetched for the wrong tenant, or the accessor
 *              stops delegating to the authority the CAM table uses.
 *   TALLY      the lease-intake counts go back to the raw extraction flag, or
 *              double-count a failed/pending lease, or treat an unreadable
 *              review state as clean.
 *
 * A FAILING BASELINE IS NOT A PASS. The unmutated copy is asserted before any
 * mutant runs and the harness exits non-zero if it fails: a copy that cannot
 * run kills every mutant trivially and reports a fake perfect score.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const MUTATED_FILES = ['tenant-space.js', 'script.js'];

const MUTANTS = [
  // ── REGRESS: the Space derives its own verdict again ────────────────────
  { id: 'B01', file: 'tenant-space.js', why: 'the Space goes back to the calculation status — the original defect',
    from: "      var status = billingStatusLabel(cr.tenantName || cr.name || null);",
    to:   "      var status = (cr.status === 'needs review') ? 'Needs review' : 'Ready';" },
  { id: 'B02', file: 'tenant-space.js', why: 'the Space hard-codes Ready',
    from: "      var status = billingStatusLabel(cr.tenantName || cr.name || null);",
    to:   "      var status = 'Ready';" },
  { id: 'B03', file: 'tenant-space.js', why: 'the label helper returns Ready instead of the verdict',
    from: '    return st.label;\n  }', to: "    return 'Ready';\n  }" },

  // ── OPTIMISM: unknown resolves to billable ──────────────────────────────
  { id: 'B04', file: 'tenant-space.js', why: 'a null verdict falls through to Ready',
    from: "    if (!st || typeof st.label !== 'string' || !st.label) return BILLING_STATUS_UNKNOWN;",
    to:   "    if (!st || typeof st.label !== 'string' || !st.label) return 'Ready';" },
  { id: 'B05', file: 'tenant-space.js', why: 'no authority available falls through to Ready',
    from: "    if (!fn || !tenantName) return BILLING_STATUS_UNKNOWN;",
    to:   "    if (!fn || !tenantName) return 'Ready';" },
  { id: 'B06', file: 'tenant-space.js', why: 'a missing tenant name is no longer refused',
    from: "    if (!fn || !tenantName) return BILLING_STATUS_UNKNOWN;",
    to:   '    if (!fn) return BILLING_STATUS_UNKNOWN;' },
  { id: 'B07', file: 'tenant-space.js', why: 'an authority that throws is swallowed into a clean verdict',
    from: "    try { st = fn(tenantName); } catch (_e) { st = null; }",
    to:   "    try { st = fn(tenantName); } catch (_e) { st = { label: 'Ready' }; }" },
  { id: 'B08', file: 'tenant-space.js', why: 'the unknown word itself becomes Ready',
    from: "  var BILLING_STATUS_UNKNOWN = 'Unknown';", to: "  var BILLING_STATUS_UNKNOWN = 'Ready';" },
  { id: 'B09', file: 'script.js', why: 'the accessor invents an exposure when no results are loaded',
    from: "    if (!AXs || typeof lastResults === 'undefined' || !lastResults.length) return null;",
    to:   '    if (!AXs) return null;' },
  { id: 'B10', file: 'script.js', why: 'the accessor returns a billable verdict when it cannot answer',
    from: '    if (!exposure) return null;',
    to:   "    if (!exposure) return { state: 'billable', label: 'Billable', reason: 'x' };" },
  { id: 'B11', file: 'script.js', why: 'the accessor swallows its own failure into a clean answer',
    from: '  } catch (_) { return null; }\n};\n\nfunction _statementReadinessBlock(tenantName) {',
    to:   "  } catch (_) { return { state: 'billable', label: 'Billable', reason: 'x' }; }\n};\n\nfunction _statementReadinessBlock(tenantName) {" },

  // ── IDENTITY: the wrong tenant, or the wrong authority ──────────────────
  { id: 'B12', file: 'tenant-space.js', why: 'the Space asks about the space label, which falls back to the literal "Space"',
    from: "      var status = billingStatusLabel(cr.tenantName || cr.name || null);",
    to:   "      var status = billingStatusLabel((rec.space && rec.space.name) || null);" },
  { id: 'B13', file: 'tenant-space.js', why: 'every Space asks about the first tenant',
    from: '    var st;\n    try { st = fn(tenantName); } catch (_e) { st = null; }',
    to:   "    var st;\n    try { st = fn('Whole Health Market'); } catch (_e) { st = null; }" },
  { id: 'B14', file: 'script.js', why: 'the accessor stops delegating and re-derives its own verdict',
    from: '    return _tenantBillingState(tenantName, exposure);',
    to:   "    return { state: 'billable', label: 'Billable', reason: 'recomputed here' };" },
  { id: 'B15', file: 'script.js', why: 'the accessor asks the property verdict, dropping the tenant scope',
    from: '    return _tenantBillingState(tenantName, exposure);',
    to:   '    return _tenantBillingState(undefined, exposure);' },

  // ── TALLY: the lease-intake counts drift from the row badges ────────────
  { id: 'B16', file: 'script.js', why: 'the tally goes back to the raw extraction flag',
    from: '    const s = stateOf(t);\n    // An unreadable state is not a clean state — it needs a look.\n    return s == null || s === \'needs_review\' || s === \'incomplete\';',
    to:   '    return !!t._needsReview;' },
  { id: 'B17', file: 'script.js', why: 'derived needs_review stops counting as attention',
    from: "    return s == null || s === 'needs_review' || s === 'incomplete';",
    to:   "    return s == null || s === 'incomplete';" },
  { id: 'B18', file: 'script.js', why: 'incomplete stops counting as attention',
    from: "    return s == null || s === 'needs_review' || s === 'incomplete';",
    to:   "    return s == null || s === 'needs_review';" },
  { id: 'B19', file: 'script.js', why: 'an unreadable review state counts as clean',
    from: "    return s == null || s === 'needs_review' || s === 'incomplete';",
    to:   "    return s === 'needs_review' || s === 'incomplete';" },
  { id: 'B20', file: 'script.js', why: 'a failed extraction is counted twice, driving ready negative',
    from: "    if (t.extractionFailed || t.status === 'pending') return false;",
    to:   "    if (t.status === 'pending') return false;" },
  { id: 'B21', file: 'script.js', why: 'a pending extraction is counted twice',
    from: "    if (t.extractionFailed || t.status === 'pending') return false;",
    to:   '    if (t.extractionFailed) return false;' },
  { id: 'B22', file: 'script.js', why: 'ready stops subtracting the attention bucket',
    from: '  return { total, pending, failed, needsAttn, ready: total - pending - failed - needsAttn };',
    to:   '  return { total, pending, failed, needsAttn, ready: total - pending - failed };' },
  { id: 'B23', file: 'script.js', why: 'the tally stops consulting the review engine at all',
    from: '    : (t) => { try { return getTenantReviewState(t); } catch (_) { return null; } };',
    to:   "    : (t) => 'verified';" },
  { id: 'B24', file: 'script.js', why: 'the summary stops using the tally it was given',
    from: '  const _tally = _leaseIntakeTally(tenants);',
    to:   '  const _tally = { total: tenants.length, pending: 0, failed: 0, needsAttn: 0, ready: tenants.length };' },
  { id: 'B25', file: 'script.js', why: 'holes in the tenant list are counted as leases',
    from: '  const list = Array.isArray(tenants) ? tenants.filter(Boolean) : [];',
    to:   '  const list = Array.isArray(tenants) ? tenants : [];' },
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'brcmut-'));
// WHOLE TREE, minus .git and node_modules. A hand-listed subset has twice
// produced a baseline that could not load its own dependencies, which scores
// every mutant as killed and means nothing.
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

const SUITES = ['test-billing-readiness-consistency.js'];
function runSuites() {
  for (const suite of SUITES) {
    try {
      execFileSync(process.execPath, [suite], {
        cwd: tmp, stdio: 'pipe', timeout: 300000,
        env: Object.assign({}, process.env, { BRC_PORT: '8978' }),
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
        env: Object.assign({}, process.env, { BRC_PORT: '8978' }) });
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
