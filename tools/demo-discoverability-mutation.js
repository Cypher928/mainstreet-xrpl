'use strict';
/**
 * tools/demo-discoverability-mutation.js — can a manager who already owns a
 * property still reach the demos, and is it still opt-in?
 *
 *   node tools/demo-discoverability-mutation.js
 *
 *   D01  the invitation goes back to empty-portfolio only (the original defect)
 *   D02  the invitation renders even once the demos are seeded (duplicate cards)
 *   D03  the invitation renders over a filtered search result
 *   D04  seeded demo cards lose their DEMO badge
 *   D05  every property is treated as a demo
 *   D06  the demo predicate forgets Northgate
 *   D07  one seeded demo counts as both, withdrawing the invitation too early
 *   D08  the Northgate card is dropped from the invitation
 *   D09  opening Northgate stops seeding Cascade, losing the refusal contrast
 *   D10  opening the Northgate card seeds but never opens it
 *   D11  the portfolio seeds the demo on render — opt-in becomes automatic
 *   D12  a seeded demo counts as a real property again for the welcome panel
 *   D13  opening Northgate by card stops re-checking its seed
 *
 * A FAILING BASELINE IS NOT A PASS.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const S = 'script.js';

const MUTANTS = [
  { id: 'D01', file: S, why: 'the invitation goes back to empty-portfolio only (the original defect)',
    from: "  const _demoInvite = (!_portfolioQuery && !_demoPropertiesSeeded(props))\n    ? _renderDemoPropertiesSection() : '';",
    to:   "  const _demoInvite = '';" },
  { id: 'D02', file: S, why: 'the invitation renders even once the demos are seeded',
    from: "  const _demoInvite = (!_portfolioQuery && !_demoPropertiesSeeded(props))\n    ? _renderDemoPropertiesSection() : '';",
    to:   "  const _demoInvite = !_portfolioQuery ? _renderDemoPropertiesSection() : '';" },
  { id: 'D03', file: S, why: 'the invitation renders over a filtered search result',
    from: "  const _demoInvite = (!_portfolioQuery && !_demoPropertiesSeeded(props))\n    ? _renderDemoPropertiesSection() : '';",
    to:   "  const _demoInvite = !_demoPropertiesSeeded(props) ? _renderDemoPropertiesSection() : '';" },
  { id: 'D04', file: S, why: 'seeded demo cards lose their DEMO badge',
    from: "          ${_isDemoPropertyId(p.id) ? '<span class=\"ptf-demo-badge\">DEMO</span>' : ''}\n",
    to:   "" },
  { id: 'D05', file: S, why: 'every property is treated as a demo',
    from: "  if (id == null) return false;\n  return id === DEMO_PROPERTY_ID || id === NORTHGATE_PROPERTY_ID;",
    to:   "  if (id == null) return false;\n  return true;" },
  { id: 'D06', file: S, why: 'the demo predicate forgets Northgate',
    from: "  return id === DEMO_PROPERTY_ID || id === NORTHGATE_PROPERTY_ID;",
    to:   "  return id === DEMO_PROPERTY_ID;" },
  { id: 'D07', file: S, why: 'one seeded demo counts as both, withdrawing the invitation too early',
    from: "  return !!(DEMO_PROPERTY_ID && NORTHGATE_PROPERTY_ID\n            && ids.includes(DEMO_PROPERTY_ID) && ids.includes(NORTHGATE_PROPERTY_ID));",
    to:   "  return !!(DEMO_PROPERTY_ID && NORTHGATE_PROPERTY_ID\n            && (ids.includes(DEMO_PROPERTY_ID) || ids.includes(NORTHGATE_PROPERTY_ID)));" },
  { id: 'D08', file: S, why: 'the Northgate card is dropped from the invitation',
    from: "    ${_demoPropertyCardHtml({\n      name: 'Northgate Exchange', module: 'Clean CAM Billing Demo',",
    to:   "    ${'' && _demoPropertyCardHtml({\n      name: 'Northgate Exchange', module: 'Clean CAM Billing Demo'," },
  { id: 'D09', file: S, why: 'opening Northgate stops seeding Cascade, losing the refusal contrast',
    from: "    await ensureDemoProperty().catch(e => console.warn('[_openNorthgateDemo] Cascade seed skipped:', e && e.message));\n",
    to:   "" },
  { id: 'D10', file: S, why: 'opening the Northgate card seeds but never opens it',
    from: "    if (id) { await selectProperty(id); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }",
    to:   "    if (id) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }" },
  { id: 'D11', file: S, why: 'the portfolio seeds the demo on render — opt-in becomes automatic',
    from: "  const _demoInvite = (!_portfolioQuery && !_demoPropertiesSeeded(props))",
    to:   "  if (!_demoPropertiesSeeded(props)) { try { ensureNorthgateDemo(); } catch (_e) {} }\n  const _demoInvite = (!_portfolioQuery && !_demoPropertiesSeeded(props))" },
  { id: 'D12', file: S, why: 'a seeded demo counts as a real property again for the welcome panel',
    from: "  const realProps = (props || []).filter(p => !_isDemoPropertyId(p.id));",
    to:   "  const realProps = (props || []).filter(p => p.id !== DEMO_PROPERTY_ID);" },
  { id: 'D13', file: S, why: 'opening Northgate by card stops re-checking its seed',
    from: "  if (NORTHGATE_PROPERTY_ID && id === NORTHGATE_PROPERTY_ID && typeof ensureNorthgateDemo === 'function') {",
    to:   "  if (false) {" },
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ddmut-'));
fs.cpSync(ROOT, tmp, {
  recursive: true,
  filter: (src) => {
    const rel = path.relative(ROOT, src);
    return !(rel === '.git' || rel.startsWith('.git' + path.sep) ||
             rel === 'node_modules' || rel.startsWith('node_modules' + path.sep));
  },
});
try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(tmp, 'node_modules'), 'dir'); }
catch (e) { console.warn('[ddmut] could not link node_modules:', e && e.message); }

const ORIGINAL = { [S]: fs.readFileSync(path.join(ROOT, S), 'utf8') };

const SUITES = ['test-e2e-demo-discoverability.js'];
function runSuites() {
  for (const suite of SUITES) {
    try { execFileSync(process.execPath, [suite], { cwd: tmp, stdio: 'pipe', timeout: 900000 }); }
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
    try { execFileSync(process.execPath, [suite], { cwd: tmp, stdio: 'pipe', timeout: 900000 }); }
    catch (e) { console.error('\n── ' + suite + ' ──\n' + String(e.stdout || e.message).slice(-3000)); }
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(2);
}

let killed = 0;
const survived = [];
for (const m of MUTANTS) {
  const src = ORIGINAL[m.file];
  const i = src.indexOf(m.from);
  if (i === -1) { console.log(`  ??   ${m.id}  ANCHOR NOT FOUND in ${m.file} — malformed mutant`); survived.push(m.id + ' (malformed)'); continue; }
  if (src.indexOf(m.from, i + 1) !== -1) console.log(`  ??   ${m.id}  ANCHOR NOT UNIQUE in ${m.file} — mutating only the first`);
  if (m.to === m.from) { console.log(`  ??   ${m.id}  NO-OP MUTANT`); survived.push(m.id + ' (no-op)'); continue; }
  fs.writeFileSync(path.join(tmp, m.file), src.slice(0, i) + m.to + src.slice(i + m.from.length));
  const passedM = runSuites();
  fs.writeFileSync(path.join(tmp, m.file), src);
  if (passedM) { survived.push(`${m.id} (${m.file}): ${m.why}`); console.log(`  LIVE ${m.id}  ${m.why}`); }
  else         { killed++;                                      console.log(`  kill ${m.id}  ${m.why}`); }
}

console.log(`\n${killed}/${MUTANTS.length} killed`);
if (survived.length) {
  console.log('\nSURVIVORS — each needs a written verdict (real gap or equivalent):');
  survived.forEach(s => console.log('  · ' + s));
}
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(survived.length ? 1 : 0);
