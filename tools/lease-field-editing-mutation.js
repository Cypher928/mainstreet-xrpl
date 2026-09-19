'use strict';
/**
 * tools/lease-field-editing-mutation.js — do the lease-field-editing suites bite?
 *
 *   node tools/lease-field-editing-mutation.js
 *
 * The change under test has three moving parts, and each is a one-line edit
 * that a careless hand could revert without any suite noticing. This harness
 * takes each apart and requires the suites to object.
 *
 *   ROUTE      an intake input goes back to handleFieldBlur — the writer that
 *              records the value and nothing else. This is the original defect
 *              and it is invisible to anything that only checks the value: the
 *              number lands, persists and reloads perfectly, and reports itself
 *              as "AI Extraction · <the lease>". Eight mutants, one per field,
 *              because a suite that pins only the field it was written for
 *              leaves the other seven unguarded.
 *   NAVIGATE   "Edit Fields" goes back to the read-only Tenant Detail Panel, or
 *              to nothing at all. The fields become unreachable again from the
 *              one screen that tells the manager to go and fill them in.
 *   PRESERVE   the card-expansion capture is defanged — moved after the wipe,
 *              inverted, or dropped — so the manager is closed out of the field
 *              they are typing in on every save.
 *   WRITER     the provenance chain itself is weakened: the snapshot stops
 *              being marked as a human edit, loses its reviewer, or the
 *              unchanged-value guard is removed so a bare tab-through starts
 *              manufacturing "a person entered this". The last one is the
 *              negative control — the over-correction, not the defect.
 *
 * A FAILING BASELINE IS NOT A PASS. The unmutated copy is asserted before any
 * mutant runs and the harness exits non-zero if it fails.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const MUTATED_FILES = ['script.js', 'review-engine.js'];

// ── Anchors ────────────────────────────────────────────────────────────────
const INTAKE = {
  tenant_name:         `onblur="handleProvenancedFieldBlur(\${i},'tenant_name',this.value,this);refreshBulkSummary(\${i})"`,
  leased_sqft:         `onblur="handleProvenancedFieldBlur(\${i},'leased_sqft',this.value,this);refreshBulkSummary(\${i});checkSqftValidation()"`,
  start_date:          `onblur="handleProvenancedFieldBlur(\${i},'start_date',this.value,this)"`,
  end_date:            `onblur="handleProvenancedFieldBlur(\${i},'end_date',this.value,this)"`,
  lease_type:          `<select onchange="handleProvenancedFieldBlur(\${i},'lease_type',this.value||null,this)">`,
  excluded_categories: `onblur="handleProvenancedFieldBlur(\${i},'excluded_categories',this.value,this)"`,
  cap:                 `onblur="handleProvenancedFieldBlur(\${i},'cap',this.value,this)"`,
  capBaseAmount:       `onblur="handleProvenancedFieldBlur(\${i},'capBaseAmount',this.value,this)"`,
};

const RW_OPEN   = 'function rwOpenTenant(tenantId) {\n  closeReviewWorkspace();\n  openLeaseBlockerFix(tenantId);\n}';
const CAPTURE   = "  const _openBefore = new Set(\n" +
                  "    Array.from(el.querySelectorAll('.bulk-tenant-detail'))\n" +
                  "      .filter(d => d.style.display === 'block')\n" +
                  "      .map(d => d.id));\n" +
                  "  el.innerHTML = '';";
const RESTORE   = "  _openBefore.forEach(id => {\n" +
                  "    const det = document.getElementById(id);\n" +
                  "    if (!det || det.style.display === 'block') return;\n" +
                  "    det.style.display = 'block';";
const GUARD     = "  const changed = String(prev ?? '') !== String(next ?? '');";
const DELEGATE  = "    saveFieldOverride(t.id, field, next,    // value + override + snapshot + audit\n" +
                  "                      { source: 'data_entry', skipBulkRerender: true });";
const MANUAL    = '    manuallyEdited:         true,';
const REVIEWER  = '    reviewerEmail:          user?.email || null,';
const OV_WRITE  = "      [fieldName]: { original, override: newValue, reviewerConfirmed: true, reviewedAt: new Date().toISOString(), overrideSource: (opts && opts.source) || 'manual' },";

const MUTANTS = [];

// ── ROUTE: each field back to the provenance-free writer ───────────────────
for (const [field, anchor] of Object.entries(INTAKE)) {
  MUTANTS.push({
    id: 'R' + String(MUTANTS.length + 1).padStart(2, '0'),
    file: 'script.js',
    why: `${field} reverts to handleFieldBlur — value written, origin lost (THE DEFECT)`,
    from: anchor,
    to: anchor.replace('handleProvenancedFieldBlur', 'handleFieldBlur'),
  });
}

// ── NAVIGATE: Edit Fields stops reaching an editor ─────────────────────────
MUTANTS.push(
  { id: 'N01', file: 'script.js',
    why: 'Edit Fields goes back to the READ-ONLY Tenant Detail Panel (THE DEFECT)',
    from: RW_OPEN,
    to: 'function rwOpenTenant(tenantId) {\n  closeReviewWorkspace();\n' +
        '  const idx = tenantData.findIndex(x => x && x.id === tenantId);\n' +
        '  if (idx !== -1) openTenantDetailPanel(idx);\n}' },
  { id: 'N02', file: 'script.js',
    why: 'Edit Fields closes the workspace and does nothing else',
    from: RW_OPEN,
    to: 'function rwOpenTenant(tenantId) {\n  closeReviewWorkspace();\n}' },
  { id: 'N03', file: 'script.js',
    why: 'Edit Fields navigates but never expands the card, landing on a closed row',
    from: '    const det = document.getElementById(\'bdet-\' + i);\n' +
          "    if (det && getComputedStyle(det).display === 'none' && typeof toggleBulkDetail === 'function') {",
    to:   '    const det = document.getElementById(\'bdet-\' + i);\n' +
          "    if (false && typeof toggleBulkDetail === 'function') {" },
);

// ── PRESERVE: the card must survive its own save ───────────────────────────
MUTANTS.push(
  { id: 'E01', file: 'script.js',
    why: 'the open-card capture runs AFTER the wipe, so it captures nothing',
    from: CAPTURE,
    to: "  el.innerHTML = '';\n" +
        "  const _openBefore = new Set(\n" +
        "    Array.from(el.querySelectorAll('.bulk-tenant-detail'))\n" +
        "      .filter(d => d.style.display === 'block')\n" +
        "      .map(d => d.id));" },
  { id: 'E02', file: 'script.js',
    why: 'the capture keeps the CLOSED cards instead of the open ones',
    from: CAPTURE,
    to: CAPTURE.replace("d.style.display === 'block'", "d.style.display !== 'block'") },
  { id: 'E03', file: 'script.js',
    why: 'nothing is reopened after the rebuild — the card closes on every edit',
    from: RESTORE,
    to: RESTORE.replace('if (!det || det.style.display === \'block\') return;',
                        'if (det) return;') },
);

// ── WRITER: the provenance record itself ───────────────────────────────────
MUTANTS.push(
  { id: 'W01', file: 'script.js',
    why: 'the snapshot is no longer marked as a human edit',
    from: MANUAL, to: '    manuallyEdited:         false,' },
  { id: 'W02', file: 'script.js',
    why: 'the snapshot no longer records who made the edit',
    from: REVIEWER, to: '    reviewerEmail:          null,' },
  { id: 'W03', file: 'script.js',
    why: 'the reviewOverride is no longer reviewer-confirmed',
    from: OV_WRITE,
    to: OV_WRITE.replace('reviewerConfirmed: true', 'reviewerConfirmed: false') },
  { id: 'W04', file: 'script.js',
    why: 'the provenanced blur delegates to the plain writer instead',
    from: DELEGATE, to: '    updateTenantField(index, field, next); savePropertyData();' },
  // NEGATIVE CONTROL. Not the defect — its opposite. Removing the guard makes
  // every tab-through record "a person entered this", inventing human
  // verification nobody performed. A suite that only checks edits ARE recorded
  // will not notice.
  { id: 'W05', file: 'script.js',
    why: 'NEGATIVE CONTROL — the unchanged-value guard is removed, so a bare tab ' +
         'through a field manufactures a human verification',
    from: GUARD, to: '  const changed = true;' },
);

// ── SCOPE: the two repairs that keep the widened routing from doing harm ───
//
// Neither of these existed before the routing change; both were added because a
// suite measured the damage. They are the parts most likely to be "simplified"
// away by someone who reads them as redundant options.
MUTANTS.push(
  { id: 'D01', file: 'script.js',
    why: 'card edits go back to claiming a lease sign-off (THE REGRESSION) — ' +
         'filling one blank marks the whole lease Verified',
    from: "{ source: 'data_entry', skipBulkRerender: true }",
    to:   "{ source: 'manual', skipBulkRerender: true }" },
  { id: 'D02', file: 'review-engine.js',
    why: 'the engine stops distinguishing data entry from a review act',
    from: "      .some(ov => ov?.reviewerConfirmed && ov.overrideSource !== 'data_entry');",
    to:   '      .some(ov => ov?.reviewerConfirmed);' },
  { id: 'D03', file: 'review-engine.js',
    why: 'NEGATIVE CONTROL — the test is inverted, so a REAL review sign-off ' +
         'stops counting and data entry starts',
    from: "      .some(ov => ov?.reviewerConfirmed && ov.overrideSource !== 'data_entry');",
    to:   "      .some(ov => ov?.reviewerConfirmed && ov.overrideSource === 'data_entry');" },
  { id: 'D04', file: 'review-engine.js',
    why: 'NEGATIVE CONTROL — every stored override is reinterpreted, so leases ' +
         'reviewed before this change quietly lose their verified state',
    from: "      .some(ov => ov?.reviewerConfirmed && ov.overrideSource !== 'data_entry');",
    to:   "      .some(ov => ov?.reviewerConfirmed && ov.overrideSource === 'manual');" },
  { id: 'S01', file: 'script.js',
    why: 'the card rebuilds the list from inside its own input again (THE ' +
         'REGRESSION) — the next field the user tabs to is destroyed mid-entry',
    from: "{ source: 'data_entry', skipBulkRerender: true }",
    to:   "{ source: 'data_entry' }" },
  { id: 'S02', file: 'script.js',
    why: 'the option is honoured backwards, so the review editor stops ' +
         'refreshing and the card starts',
    from: '  if (!(opts && opts.skipBulkRerender)) renderBulkResults();',
    to:   '  if (opts && opts.skipBulkRerender) renderBulkResults();' },
);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lfemut-'));
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

// The last two are here because routing the card through saveFieldOverride
// BROKE them, and the repairs (source: 'data_entry', skipBulkRerender) are only
// as good as the suites that measured the damage. A mutant that reinstates
// either regression has to be caught by the suite that found it.
const SUITES = ['test-lease-field-manual-entry.js', 'test-cap-base-writer.js',
                'test-e2e-lease-field-editing.js', 'test-cap-base-persistence.js',
                'test-e2e-lease-review-flow.js'];
function runSuites() {
  for (const suite of SUITES) {
    try {
      execFileSync(process.execPath, [suite], {
        cwd: tmp, stdio: 'pipe', timeout: 600000,
        env: Object.assign({}, process.env, { APP_PORT: '7987' }),
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
        env: Object.assign({}, process.env, { APP_PORT: '7987' }) });
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
