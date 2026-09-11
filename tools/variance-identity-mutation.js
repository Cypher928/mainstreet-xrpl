'use strict';
/**
 * tools/variance-identity-mutation.js — does the identity suite bite?
 *
 *   node tools/variance-identity-mutation.js
 *
 * Four kinds of mutant:
 *
 *   REGRESS    the identity rule goes back to preferring `id`, or a step of the
 *              ladder is removed — the original all-zeros failure.
 *   OVER-ATTR  the ambiguity guard is weakened, so indistinguishable invoices
 *              each take the merged total. A different wrong answer than $0 and
 *              a worse one, because it looks plausible.
 *   MISLABEL   an exclusion goes back to being reported as rounding, or the
 *              aggregate is added without subtracting what was attributed
 *              (double counting).
 *   SURFACE    the CAM summary stops reading the breakdown, conflates caps with
 *              uncovered, infers vacancy, or hides a residual.
 *
 * A FAILING BASELINE IS NOT A PASS. The baseline is asserted before any mutant
 * runs and the harness exits non-zero if it fails — a copy that cannot run kills
 * every mutant trivially and reports a perfect score. That happened on an
 * earlier slice, which is why the check and the whole-tree copy are here.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const MUTATED_FILES = ['variance-breakdown.js', 'script.js', 'index.html'];

const MUTANTS = [
  // ── REGRESS: back to the defect ─────────────────────────────────────────
  { id: 'V01', file: 'variance-breakdown.js', why: 'the index prefers id and never falls back — all allocations read $0',
    from: `      var lk = _looseKey(inv, toCents);
      var dt = _datePart(inv);
      if (dt) {
        var dk = lk + '|' + dt;
        if (byDated.has(dk)) return byDated.get(dk);
      }`,
    to: '      var lk = _looseKey(inv, toCents);' },
  { id: 'V02', file: 'variance-breakdown.js', why: 'the id step is dropped, so an exact id match is lost',
    from: `      if (inv.id) {
        var ik = 'id:' + String(inv.id);
        if (byId.has(ik)) return byId.get(ik);
      }`, to: '' },
  { id: 'V03', file: 'variance-breakdown.js', why: 'the dated step is dropped — repeats collapse and refuse',
    from: '        if (byDated.has(dk)) return byDated.get(dk);', to: '' },
  { id: 'V04', file: 'variance-breakdown.js', why: 'the loose step is dropped — an undated single invoice stops matching',
    from: '      if (e.dated.size <= 1 && e.maxPerResult <= 1) return e.cents;',
    to:   '      if (false) return e.cents;' },
  { id: 'V05', file: 'variance-breakdown.js', why: 'the line-item side stops indexing its dated key',
    from: '        if (dk) byDated.set(dk, (byDated.get(dk) || 0) + cents);', to: '' },
  { id: 'V06', file: 'variance-breakdown.js', why: 'the date is read from the wrong field, so nothing dates',
    from: "    var d = (inv && (inv.invoiceDate || inv.date)) || '';",
    to:   "    var d = (inv && inv.notAField) || '';" },
  { id: 'V07', file: 'variance-breakdown.js', why: 'the loose key drops the amount, so any invoice from a vendor matches',
    from: '      toCents(inv.amount),\n    ].join(\'|\');\n  }',
    to:   "      0,\n    ].join('|');\n  }" },
  { id: 'V08', file: 'variance-breakdown.js', why: 'the loose key drops the category',
    from: "      String(inv.category || '').toLowerCase().trim(),\n      toCents(inv.amount),",
    to:   "      '',\n      toCents(inv.amount)," },

  // ── OVER-ATTRIBUTION: the ambiguity guard ───────────────────────────────
  { id: 'V09', file: 'variance-breakdown.js', why: 'the multiplicity half of the guard is removed — undated repeats over-attribute',
    from: '      if (e.dated.size <= 1 && e.maxPerResult <= 1) return e.cents;',
    to:   '      if (e.dated.size <= 1) return e.cents;' },
  { id: 'V10', file: 'variance-breakdown.js', why: 'the dated half of the guard is removed',
    from: '      if (e.dated.size <= 1 && e.maxPerResult <= 1) return e.cents;',
    to:   '      if (e.maxPerResult <= 1) return e.cents;' },
  { id: 'V11', file: 'variance-breakdown.js', why: 'the guard is removed entirely — every collision over-attributes',
    from: '      if (e.dated.size <= 1 && e.maxPerResult <= 1) return e.cents;',
    to:   '      return e.cents;' },
  { id: 'V12', file: 'variance-breakdown.js', why: 'multiplicity is counted across tenants, so a shared invoice looks like a repeat',
    from: '      var seenHere = new Map();',
    to:   '      var seenHere = _globalSeen || (_globalSeen = new Map());' },
  { id: 'V13', file: 'variance-breakdown.js', why: 'the refusal is not reported, so a surface cannot say the gap is incomplete',
    from: "      if ((precision === 'cents' ? _allocC : _allocL) === null) unmatchedInvoices++;",
    to:   '      ;' },

  // ── MISLABEL: the exclusion ─────────────────────────────────────────────
  { id: 'V14', file: 'variance-breakdown.js', why: 'the exclusion goes back to being reported as rounding',
    from: '      if (unattributedC > 0) {', to: '      if (false) {' },
  { id: 'V15', file: 'variance-breakdown.js', why: 'the aggregate is added without subtracting what was attributed — double count',
    from: '      const unattributedC = Math.max(0, aggExclC - attributedC);',
    to:   '      const unattributedC = aggExclC;' },
  { id: 'V16', file: 'variance-breakdown.js', why: 'the exclusion is added but not taken out of the residue, so the identity breaks',
    from: '        roundingResidue -= MC.fromCents(unattributedC);', to: '' },
  { id: 'V17', file: 'variance-breakdown.js', why: 'the exclusion lookup keys on the wrong field',
    from: "                             { list: 'excludedShares', amount: 'cents', rawCents: true })",
    to:   "                             { list: 'excludedShares', amount: 'share' })" },
  { id: 'V18', file: 'variance-breakdown.js', why: 'the cap total stops coming from the stored capAdjustment',
    from: '    const capTotal   = _round(results.reduce((s, r) => s + (r.capApplied ? (Number(r.capAdjustment) || 0) : 0), 0));',
    to:   '    const capTotal   = 0;' },

  // ── SURFACE: the CAM summary ─────────────────────────────────────────────
  { id: 'V19', file: 'script.js', why: 'the coverage branch stops handing the breakdown to the explainer',
    from: '      ? _varianceExplanationHtml(_lastVarianceBreakdown, {',
    to:   '      ? _varianceExplanationHtml(null, {' },
  { id: 'V20', file: 'script.js', why: 'the banner asserts coverage as the cause again',
    from: '      ${_hdr}\n      <ul class="rcs-vb-list">${_rows}</ul>',
    to:   '      ${_hdr} because the loaded leases cover ${proRataSum.toFixed(1)}% of the property.\n      <ul class="rcs-vb-list">${_rows}</ul>' },
  { id: 'V21', file: 'script.js', why: 'the cap sentence fires even when no cap applied',
    from: '    if (_caps > 0) _notes.push(', to: '    if (true) _notes.push(' },
  { id: 'V22', file: 'script.js', why: 'the uncovered sentence fires even when nothing is uncovered',
    from: '    if (_uncov > 0) _notes.push(', to: '    if (true) _notes.push(' },
  { id: 'V23', file: 'script.js', why: 'the two are no longer said to be different things',
    from: "    if (_caps > 0 && _uncov > 0) _notes.push('These are different things and neither explains the other.');",
    to:   '    ;' },
  { id: 'V24', file: 'script.js', why: 'VACANCY IS INFERRED from the uncovered share',
    from: 'Whether that space is vacant or under a lease not yet uploaded has not been established — upload any remaining leases and re-run to settle it.',
    to:   'That space is vacant and the landlord absorbs it.' },
  { id: 'V25', file: 'script.js', why: 'a residual is no longer mentioned',
    from: '    if (_residAmt >= 0.005) _notes.push(', to: '    if (false) _notes.push(' },
  { id: 'V26', file: 'script.js', why: 'unmatched invoices are no longer mentioned',
    from: '    if (Number(bk.unmatchedInvoices) > 0) _notes.push(', to: '    if (false) _notes.push(' },
  { id: 'V27', file: 'script.js', why: 'the bucket list is truncated to the top two',
    from: '      .map(l => `<li class="rcs-vb-item', to: '      .slice(0, 2).map(l => `<li class="rcs-vb-item' },
  { id: 'V28', file: 'script.js', why: 'the banner retypes its own labels instead of the module\'s',
    from: '        <span class="rcs-vb-label">${esc(l.label)}</span>',
    to:   '        <span class="rcs-vb-label">Unallocated</span>' },
  { id: 'V29', file: 'script.js', why: 'the no-breakdown path blames coverage again',
    from: 'MainStreet could not break this difference down into its causes on this run, so it is not attributing one.',
    to:   'because the loaded leases cover only part of the property.' },
  { id: 'V30', file: 'script.js', why: 'caps and uncovered are read from the same bucket',
    from: "    const _uncovLine = _byKey('uncovered');", to: "    const _uncovLine = _byKey('caps');" },
  { id: 'V31', file: 'index.html', why: 'the bucket list loses its styling and reads as run-on text',
    from: '    .rcs-vb-list {', to: '    .rcs-vb-list-X {' },
  { id: 'V32', file: 'index.html', why: 'the residual line stops being distinguished',
    from: [
      '    .rcs-vb-item--residual .rcs-vb-label,',
      '    .rcs-vb-item--residual .rcs-vb-amt { color: var(--c-fca5a5, #fca5a5); }',
    ].join('\n'), to: '' },

  // ── the CAM arithmetic this slice must not touch ─────────────────────────
  { id: 'V33', file: 'script.js', why: 'the variance expression is changed',
    from: '  const variance = Math.abs(totalBilled - totalPool);',
    to:   '  const variance = Math.abs(totalBilled - totalPool) * 2;' },
  { id: 'V34', file: 'script.js', why: 'totalBilled is computed differently',
    from: '  const totalBilled = results.reduce((s, r) => s + r.totalAllocated, 0);',
    to:   '  const totalBilled = results.reduce((s, r) => s + (r.allocatedAmount || 0), 0);' },
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'varmut-'));
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

const SUITES = ['test-variance-identity.js', 'test-variance-breakdown.js', 'test-cent-policy.js'];
function runSuites() {
  for (const suite of SUITES) {
    try { execFileSync(process.execPath, [suite], { cwd: tmp, stdio: 'pipe', timeout: 180000 }); }
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
    try { execFileSync(process.execPath, [suite], { cwd: tmp, stdio: 'pipe', timeout: 180000 }); }
    catch (e) { console.error('\n── ' + suite + ' ──\n' + String(e.stdout || e.message).slice(-2500)); }
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
  fs.writeFileSync(path.join(tmp, m.file), src.slice(0, i) + m.to + src.slice(i + m.from.length));
  const passed = runSuites();
  fs.writeFileSync(path.join(tmp, m.file), src);
  if (passed) { survived.push(`${m.id} ${m.file}: ${m.why}`); console.log(`  LIVE ${m.id}  ${m.why}`); }
  else        { killed++;                                    console.log(`  kill ${m.id}  ${m.why}`); }
}

console.log(`\n${killed}/${MUTANTS.length} killed`);
if (survived.length) {
  console.log('\nSURVIVORS — each needs a written verdict (real gap or equivalent):');
  survived.forEach(s => console.log('  · ' + s));
}
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(survived.length ? 1 : 0);
