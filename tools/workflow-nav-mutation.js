'use strict';
/**
 * tools/workflow-nav-mutation.js — does test-workflow-navigation.js bite?
 *
 *   node tools/workflow-nav-mutation.js
 *
 * Two kinds of mutant, because a copy fix can fail in two directions:
 *   - REVERT: the instruction goes back to naming a retired section number.
 *   - DELETE: the instruction loses its destination altogether, which a test
 *     that only banned the old wording would happily accept.
 *
 * Applied to a COPY in a scratch directory; the working tree is never touched.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const FILES = ['script.js', 'tenant-space.js', 'property-os.js', 'acquisition-engine.js',
               'index.html', 'test-workflow-navigation.js'];

const MUTANTS = [
  // ── REVERT: each instruction names a retired section number again ────────
  { id: 'N01', file: 'script.js', why: 'the missing-sqft message names Section 2 again',
    from: 'Click "Edit" on each tenant on the Spaces tab', to: 'Click "Edit" on each tenant in Section 2' },
  { id: 'N02', file: 'script.js', why: 'the no-lease message names Section 2 again',
    from: 'at least one lease with a name and square footage on the Spaces tab',
    to:   'at least one lease with a name and square footage in Section 2' },
  { id: 'N03', file: 'script.js', why: 'the no-invoice message names Section 3 again',
    from: 'at least one invoice with a vendor and amount on the CAM tab',
    to:   'at least one invoice with a vendor and amount in Section 3' },
  { id: 'N04', file: 'script.js', why: 'the skipped-invoice warning names Section 3 again',
    from: 'Open each invoice on the CAM tab', to: 'Open each invoice in Section 3' },
  { id: 'N05', file: 'script.js', why: 'the allocation blocker names Section 2 again',
    from: 'Upload at least one lease on the Spaces tab before running allocation',
    to:   'Upload at least one lease in Section 2 before running allocation' },
  { id: 'N06', file: 'script.js', why: 'the Reports notice names Section 4 again',
    from: 'Run a CAM allocation on the CAM tab to generate reports.',
    to:   'Run a CAM allocation in Section 4 to generate reports.' },

  // ── DELETE: the destination is dropped rather than corrected ─────────────
  { id: 'N07', file: 'script.js', why: 'the Reports notice loses its destination entirely',
    from: 'Run a CAM allocation on the CAM tab to generate reports.',
    to:   'Run a CAM allocation to generate reports.' },
  { id: 'N08', file: 'script.js', why: 'the no-invoice message loses its destination',
    from: 'at least one invoice with a vendor and amount on the CAM tab',
    to:   'at least one invoice with a vendor and amount' },
  { id: 'N09', file: 'script.js', why: 'the app abandons its tab-naming convention',
    from: "missing.push('the property\\u2019s total square footage (Property tab)');",
    to:   "missing.push('the property\\u2019s total square footage');" },

  // ── the space overlay's property context ─────────────────────────────────
  { id: 'N10', file: 'tenant-space.js', why: 'the subtitle goes back to fixed copy',
    from: "              (property && property.name\n                ? _esc(property.name)\n                : 'Everything about this space, in one place') +",
    to:   "              'Everything about this space, in one place' +" },
  { id: 'N11', file: 'tenant-space.js', why: 'an unnamed property yields a blank subtitle',
    from: "                : 'Everything about this space, in one place') +",
    to:   "                : '') +" },
  { id: 'N12', file: 'tenant-space.js', why: 'the property name is interpolated unescaped',
    from: '                ? _esc(property.name)', to: '                ? property.name' },
  { id: 'N13', file: 'tenant-space.js', why: 'openSpace stops resolving the property it names',
    from: '    var property = window.currentProperty && window.currentProperty();',
    to:   '    var property = null;' },
  { id: 'N14', file: 'script.js', why: 'the review overlay stops naming its property, diverging again',
    from: "  document.getElementById('rwSubtitle').textContent = prop ? (prop.name || '') : '';",
    to:   "  document.getElementById('rwSubtitle').textContent = '';" },

  // ── the tab vocabulary itself ────────────────────────────────────────────
  { id: 'N15', file: 'script.js', why: 'documents returns to the tab list with no pane',
    from: "const WORKSPACE_TABS = ['overview', 'property', 'spaces', 'cam', 'reports', 'reserves'];",
    to:   "const WORKSPACE_TABS = ['overview', 'property', 'spaces', 'cam', 'reports', 'reserves', 'documents'];" },
  { id: 'N16', file: 'property-os.js', why: 'the retired Documents button stops being hidden',
    from: "    if (docsBtn) docsBtn.style.display = 'none';", to: '' },
  { id: 'N17', file: 'property-os.js', why: 'nothing builds the Property pane any more',
    from: "    pane.id = 'wsPane-property';", to: "    pane.id = 'wsPane-propertyX';" },
  { id: 'N18', file: 'index.html', why: 'a declared tab loses its pane',
    from: 'id="wsPane-reports"', to: 'id="wsPane-reportsX"' },

  // ── the vacancy reasoning this slice deliberately did not act on ─────────
  { id: 'N19', file: 'acquisition-engine.js', why: 'the structural definition of vacancy moves',
    from: 'const vacant   = Math.max(0, bsqft - occupied);',
    to:   'const vacant   = 0;' },
  { id: 'N20', file: 'tenant-space.js', why: 'vacancy starts being inferred from the tenant name',
    from: '  function assemble(property, tenantId) {',
    to:   "  function assemble(property, tenantId) {\n    var _v = (property.tenants||[]).some(function(x){return x && x.tenant_name === 'Vacant';});" },
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'navmut-'));
const ORIGINAL = {};
for (const f of FILES) {
  ORIGINAL[f] = fs.readFileSync(path.join(ROOT, f), 'utf8');
  fs.writeFileSync(path.join(tmp, f), ORIGINAL[f]);
}

function runSuite() {
  try {
    execFileSync(process.execPath, ['test-workflow-navigation.js'],
                 { cwd: tmp, stdio: 'pipe', timeout: 120000 });
    return true;
  } catch (_) { return false; }
}

console.log('Baseline (unmutated copy): ' + (runSuite() ? 'PASS' : 'FAIL — fix before mutating'));

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
  const passed = runSuite();
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
