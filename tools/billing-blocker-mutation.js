'use strict';
/**
 * tools/billing-blocker-mutation.js — does the blocker suite actually bite?
 *
 *   node tools/billing-blocker-mutation.js
 *
 * Three kinds of mutant, because this fix can fail in three directions:
 *
 *   REGRESS   the property verdict goes back to a bare count, or the CAM screen
 *             stops showing what it was given.
 *   TRUNCATE  the surfaces show SOME blockers — the easy way to look fixed
 *             while dropping the one that matters.
 *   FABRICATE the honest refusals are replaced by a confident answer: an
 *             all-clear with no verdict, another property's blockers, a cause
 *             invented for a verdict that named none, a citation chip on a
 *             derived number.
 *
 * The last group is the point. A blocker feature that passes its happy path and
 * lies on its edges is worse than no feature, because a manager would act on it.
 *
 * Applied to a COPY in a scratch directory; the working tree is never touched.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
// reconciliation-engine.js is read by test-billing-readiness.js's source
// assertions, so the copy is not a runnable baseline without it.
const FILES = ['audit-exposure.js', 'ai-workspace.js', 'script.js', 'index.html',
               'reconciliation-engine.js',
               'test-billing-blocker-visibility.js', 'test-billing-readiness.js'];

const MUTANTS = [
  // ── REGRESS: the verdict stops carrying what it counts ───────────────────
  { id: 'B01', file: 'audit-exposure.js', why: 'the property verdict returns a bare count again',
    from: "        canBill: false, label: 'Not ready to bill', blockers: allBlockers,\n        reason: `${prop.length} property-level exception",
    to:   "        canBill: false, label: 'Not ready to bill',\n        reason: `${prop.length} property-level exception" },
  { id: 'B02', file: 'audit-exposure.js', why: 'the tenant-only block stops naming its tenants',
    from: "        canBill: false, label: 'Not ready to bill', blockers: allBlockers,\n        reason: `${tenantsBlocked} tenant",
    to:   "        canBill: false, label: 'Not ready to bill', blockers: [],\n        reason: `${tenantsBlocked} tenant" },
  { id: 'B03', file: 'audit-exposure.js', why: 'only property-scoped blockers survive, tenant ones vanish',
    from: '    const allBlockers = prop.concat(tenantFlat);',
    to:   '    const allBlockers = prop;' },
  { id: 'B04', file: 'audit-exposure.js', why: 'the tenant tally is flattened from the wrong side',
    from: '      .reduce((all, n) => all.concat(bl.byTenant[n] || []), []);',
    to:   '      .reduce((all, n) => all, []);' },

  // ── FABRICATE: a clear reconciliation grows blockers ─────────────────────
  //
  // B05 and B06 SURVIVE, and they are equivalent mutants — proved from the
  // control flow rather than argued from a fixture. Both returns sit below
  // `if (prop.length) {...}` and `if (tenantsBlocked) {...}`, each of which
  // returns. Reaching either line therefore requires prop.length === 0 AND
  // Object.keys(bl.byTenant).length === 0, and allBlockers is
  // prop.concat(tenantFlat) — empty on both sides. Substituting `allBlockers`
  // for `[]` there substitutes one empty array for another.
  //
  // The explicit `blockers: []` is kept rather than dropped as dead: it makes
  // the verdict ONE shape at every exit, so a caller doing `r.blockers.length`
  // cannot throw on the happy path. Marked equivalent so this reasoning is
  // re-read rather than rediscovered, and so the harness complains if one of
  // these ever starts dying — which would mean the branch order changed.
  { id: 'B05', file: 'audit-exposure.js', equivalent: true, why: 'EQUIVALENT (see note): a READY verdict reports blockers it does not have',
    from: "    return { canBill: true, label: 'Ready to bill', blockers: [],\n             reason: 'No exceptions were detected.' };",
    to:   "    return { canBill: true, label: 'Ready to bill', blockers: allBlockers,\n             reason: 'No exceptions were detected.' };" },
  { id: 'B06', file: 'audit-exposure.js', equivalent: true, why: 'EQUIVALENT (see B05 note): an advisory finding is promoted to a blocker',
    from: "        canBill: true, label: 'Bill with review', blockers: [],",
    to:   "        canBill: true, label: 'Bill with review', blockers: allBlockers," },
  { id: 'B07', file: 'audit-exposure.js', why: 'a non-blocking finding enters the blocking tally',
    from: '    if (typeof f.blocksBilling === \'boolean\') return f.blocksBilling;',
    to:   '    if (typeof f.blocksBilling === \'boolean\') return true;' },

  // ── REGRESS / TRUNCATE on the CAM surface ────────────────────────────────
  { id: 'B08', file: 'script.js', why: 'the CAM screen stops rendering the hold block at all',
    from: "        if (!_billing || _billable) return '';\n        const _bl = _billing.blockers || [];",
    to:   "        if (true) return '';\n        const _bl = _billing.blockers || [];" },
  { id: 'B09', file: 'script.js', why: 'the hold block shows only the first blocker',
    from: '<ul class="rcs-held-list">${_prop.map(_row).join(\'\')}${_ten.map(_row).join(\'\')}</ul>',
    to:   '<ul class="rcs-held-list">${_prop.slice(0, 1).map(_row).join(\'\')}</ul>' },
  { id: 'B10', file: 'script.js', why: 'the hold block sorts findings, inventing a priority',
    from: '        const _prop = _bl.filter(b => b && b.scope === \'property\');',
    to:   '        const _prop = _bl.filter(b => b && b.scope === \'property\').sort((a, b) => String(a.title).localeCompare(String(b.title)));' },
  { id: 'B11', file: 'script.js', why: 'the hold block renders on a BILLABLE reconciliation',
    from: "        if (!_billing || _billable) return '';",
    to:   '        if (!_billing) return \'\';' },
  { id: 'B12', file: 'script.js', why: 'the blocker title is interpolated unescaped',
    from: '<span class="rcs-held-title">${esc(_title)}</span>',
    to:   '<span class="rcs-held-title">${_title}</span>' },
  { id: 'B13', file: 'script.js', why: 'the hold block derives its own exposure instead of reusing the verdict',
    from: '        const _bl = _billing.blockers || [];',
    to:   '        const _bl = (AuditExposure.deriveExposure(buildAuditSummary(), 0).blocking || {}).property || [];' },
  { id: 'B14', file: 'script.js', why: 'an empty blocker list still draws the panel',
    from: "        if (!_bl.length) return '';",
    to:   '        if (false) return \'\';' },
  { id: 'B15', file: 'script.js', why: 'the rendered verdict is never captured for Ask AI',
    from: '  _lastBillingVerdict = _billing ? {',
    to:   '  _lastBillingVerdict = false ? {' },
  { id: 'B16', file: 'script.js', why: 'the capture forgets which property it describes',
    from: "    propertyId:    (currentProperty() || {}).id   || null,",
    to:   '    propertyId:    null,' },
  { id: 'B17', file: 'script.js', why: 'a stale verdict survives a workflow reset',
    from: '  _lastBillingVerdict = null;',
    to:   '  ;' },
  { id: 'B18', file: 'index.html', why: 'the hold block loses its styling and reads as loose text',
    from: '    .rcs-held {', to: '    .rcs-held-DISABLED {' },

  // ── the AI intent ────────────────────────────────────────────────────────
  { id: 'B19', file: 'ai-workspace.js', why: 'the intent is never registered — back to the honest fallback',
    from: "    id: 'billing_blocked',\n    match: (s) => _BILL_BLOCK_RE.test(s)",
    to:   "    id: 'billing_blocked',\n    match: (s) => false && _BILL_BLOCK_RE.test(s)" },
  { id: 'B20', file: 'ai-workspace.js', why: '"holding up billing" stops matching',
    from: "'hold(?:ing)? (?:this |it )?(?:up|back)',", to: '' },
  { id: 'B21', file: 'ai-workspace.js', why: '"can\'t I bill" stops matching',
    from: "'can(?:\\'|’)?t (?:i )?bill', 'cannot bill',", to: '' },
  // B22 SURVIVES and is equivalent. "why are 0 of 5 tenants billable?" is
  // caught by TWO deliberate branches — `why .*billable` and
  // `tenants? (?:not )?billable` — so removing either leaves the phrasing
  // covered. That overlap is the design: a manager's phrasing is not a grammar,
  // and the branches are written to catch the same sentence more than one way.
  // Retiring one to make this mutant die would trade robustness for a score.
  { id: 'B22', file: 'ai-workspace.js', equivalent: true, why: "EQUIVALENT (see note): 'tenants billable' stops matching",
    from: "    'tenants? (?:not )?billable',", to: '' },
  { id: 'B23', file: 'ai-workspace.js', why: 'the intent answers every question, hijacking the others',
    from: '    match: (s) => _BILL_BLOCK_RE.test(s) && /bill|recon|statement|tenant/.test(s),',
    to:   '    match: (s) => true,' },
  { id: 'B24', file: 'ai-workspace.js', why: 'the answer lists only the property blocker, dropping the tenant one',
    from: '      const bullets = propBl.map(_line).concat(tenBl.map(_line));',
    to:   '      const bullets = propBl.map(_line);' },
  { id: 'B25', file: 'ai-workspace.js', why: 'the answer reports a billable count it made up',
    from: '        paragraphs.push(`${v.billableNames.length} of ${v.tenantCount} tenant',
    to:   '        paragraphs.push(`${v.tenantCount} of ${v.tenantCount} tenant' },

  // ── FABRICATE: the AI's honest refusals replaced by confidence ───────────
  { id: 'B26', file: 'ai-workspace.js', why: 'NO VERDICT is reported as "nothing is blocking billing"',
    from: "      if (!v || !v.readiness) {\n        return {\n          heading: 'No reconciliation is open',",
    to:   "      if (!v || !v.readiness) {\n        return {\n          heading: 'Nothing is blocking billing'," },
  { id: 'B27', file: 'ai-workspace.js', why: 'a missing verdict falls through and is treated as clear',
    from: '      if (!v || !v.readiness) {', to: '      if (false) {' },
  { id: 'B28', file: 'ai-workspace.js', why: "another property's blockers are answered as this property's",
    from: '      if (p && v.propertyId && p.id !== v.propertyId) {', to: '      if (false) {' },
  { id: 'B29', file: 'ai-workspace.js', why: 'a verdict that named nothing gets a cause invented',
    from: "        paragraphs.push('The verdict did not name the individual exceptions behind it, so I won’t guess at them — the reconciliation summary on the CAM tab lists what it has.');",
    to:   "        paragraphs.push('The most likely cause is undocumented invoices in the CAM pool.');" },
  { id: 'B30', file: 'ai-workspace.js', why: 'the derived verdict is given a citation chip',
    from: '        citations: [],\n        actions: p ? [_actOpenProperty(p)] : [_actPortfolio()],\n        confidence: { pct: 96,',
    to:   '        citations: [_camReportCitation(p)],\n        actions: p ? [_actOpenProperty(p)] : [_actPortfolio()],\n        confidence: { pct: 96,' },
  { id: 'B31', file: 'ai-workspace.js', why: 'a throwing verdict getter takes the whole answer down',
    from: '        try { return getter(); } catch (_) { return null; }',
    to:   '        return getter();' },
  { id: 'B32', file: 'ai-workspace.js', why: 'the trace stops naming the authoritative engine',
    from: "    billing_blocked: 'Audit Exposure — Billing Readiness',",
    to:   "    billing_blocked: 'MainStreet'," },

  // ── the statement path this slice must not disturb ───────────────────────
  { id: 'B33', file: 'script.js', why: 'the statement gate stops asking the TENANT question',
    from: '  const readiness = AXs.billingReadiness(exposure, tenantName);',
    to:   '  const readiness = AXs.billingReadiness(exposure);' },
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'billblock-mut-'));
const ORIGINAL = {};
for (const f of FILES) {
  ORIGINAL[f] = fs.readFileSync(path.join(ROOT, f), 'utf8');
  fs.writeFileSync(path.join(tmp, f), ORIGINAL[f]);
}

function runSuites() {
  for (const suite of ['test-billing-blocker-visibility.js', 'test-billing-readiness.js']) {
    try {
      execFileSync(process.execPath, [suite], { cwd: tmp, stdio: 'pipe', timeout: 120000 });
    } catch (_) { return false; }   // either suite failing kills the mutant
  }
  return true;
}

console.log('Baseline (unmutated copy): ' + (runSuites() ? 'PASS' : 'FAIL — fix before mutating'));

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
  if (passed) {
    // A mutant declared equivalent must actually survive; one that starts dying
    // means the reasoning written above it has gone stale.
    if (m.equivalent) { console.log(`  EQUIV ${m.id}  ${m.why}`); }
    else { survived.push(`${m.id} ${m.file}: ${m.why}`); console.log(`  LIVE ${m.id}  ${m.why}`); }
  } else {
    killed++;
    if (m.equivalent) {
      survived.push(`${m.id} was declared EQUIVALENT but was killed — re-read the note above it`);
      console.log(`  ??!  ${m.id}  declared equivalent, but the suites caught it`);
    } else {
      console.log(`  kill ${m.id}  ${m.why}`);
    }
  }
}

const equivalents = MUTANTS.filter(m => m.equivalent).length;
console.log(`\n${killed}/${MUTANTS.length - equivalents} killed` +
            (equivalents ? ` (${equivalents} declared equivalent, argued in place)` : ''));
if (survived.length) {
  console.log('\nSURVIVORS — each needs a written verdict (real gap or equivalent):');
  survived.forEach(s => console.log('  · ' + s));
}
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(survived.length ? 1 : 0);
