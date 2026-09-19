'use strict';
/**
 * tools/vacancy-mutation.js — does "Mark space vacant" hold, and does a
 * vacancy stay a space rather than becoming a tenant?
 *
 *   node tools/vacancy-mutation.js
 *
 *   V01  the allocation set stops excluding vacant rows (a vacancy is billed)
 *   V02  the Prepare roster counts vacant rows as leases
 *   V03  a vacancy renders as a Lease Intake card
 *   V04  the inputs fingerprint reads vacant rows (recording one stales the run)
 *   V05  the engine no longer subtracts recorded vacancy (coverage stays yellow)
 *   V06  the resolved coverage finding is emitted as yellow, not green
 *   V07  the 2% safeguard is loosened (a partly-recorded remainder reads resolved)
 *   V08  the green finding is filed with the warnings
 *   V09  recording the same suite twice adds a second row
 *   V10  a suite under a loaded lease can be marked vacant on top
 *   V11  the record is written without the vacant flag (a nameless tenant)
 *   V12  the record is written with a tenant name
 *   V13  the variance breakdown ignores the vacancy it is told about
 *   V14  the breakdown's next step still asks for a lease on a resolved remainder
 *   V15  the Spaces list loses the button
 *   V16  the uncovered-remainder note counts recorded vacancy as still uncovered
 *   V17  the summary banner never says who bears the recorded vacant share
 *   V18  the Prepare fact for recorded vacancy is dropped
 *   V19  the form's refusal is swallowed (no inline error)
 *   V20  the property readiness selector counts a vacancy as a lease
 *
 * A FAILING BASELINE IS NOT A PASS.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const S = 'script.js', E = 'reconciliation-engine.js', T = 'tenant-space.js', V = 'variance-breakdown.js', SEL = 'selectors.js';
const PR = 'property-reference.js', PA = 'property-area.js', CC = 'command-center.js', AI = 'ai-workspace.js', PREC = 'property-record.js';

const MUTANTS = [
  { id: 'V01', file: S, why: 'the allocation set stops excluding vacant rows',
    from: "    t &&\n    t.vacant !== true &&\n    t.tenant_name &&", to: "    t &&\n    t.tenant_name &&" },
  { id: 'V02', file: S, why: 'the Prepare roster counts vacant rows as leases',
    from: "  const tenants   = tenantData.filter(t => t && t.vacant !== true && tName(t) && parseSqft(tSqft(t)) > 0);",
    to:   "  const tenants   = tenantData.filter(t => t && tName(t) && parseSqft(tSqft(t)) > 0);" },
  { id: 'V03', file: S, why: 'a vacancy renders as a Lease Intake card',
    from: "    .filter(({ d }) => d && typeof d === 'object' && d.vacant !== true);",
    to:   "    .filter(({ d }) => d && typeof d === 'object');" },
  { id: 'V04', file: S, why: 'the inputs fingerprint reads vacant rows',
    from: "    .filter(x => x && x.vacant !== true && x.tenant_name)",
    to:   "    .filter(x => x && (x.vacant === true || x.tenant_name))" },
  { id: 'V05', file: E, why: 'the engine no longer subtracts recorded vacancy',
    from: "      const _vacantRows = tenants.filter(t => t.vacant === true);",
    to:   "      const _vacantRows = [];" },
  { id: 'V06', file: E, why: 'the resolved coverage finding is emitted as yellow',
    from: "          severity: 'green',\n          kind:       'coverage',",
    to:   "          severity: 'yellow',\n          kind:       'coverage'," },
  { id: 'V07', file: E, why: 'the 2% safeguard is loosened',
    from: "      if (gap > 2 && unresolved <= 2 && vacantPct > 0) {",
    to:   "      if (gap > 2 && unresolved <= 8 && vacantPct > 0) {" },
  { id: 'V08', file: S, why: 'the green finding is filed with the warnings',
    from: "    reconIssues.forEach(f => (f.severity === 'red' ? red : f.severity === 'green' ? green : yellow).push(f));",
    to:   "    reconIssues.forEach(f => (f.severity === 'red' ? red : yellow).push(f));" },
  { id: 'V09', file: S, why: 'recording the same suite twice adds a second row',
    from: "  const existing = (prop.tenants || []).find(t => sameSuite(t) && t.vacant === true);",
    to:   "  const existing = null;" },
  { id: 'V10', file: S, why: 'a suite under a loaded lease can be marked vacant on top',
    from: "  if (leased) return { ok: false, error: `Suite ${s} is under a loaded lease (${leased.tenant_name}). Edit or remove that lease instead of marking the space vacant.` };",
    to:   "" },
  { id: 'V11', file: S, why: 'the record is written without the vacant flag',
    from: "      tenant_name: '', suite: s, unitNumber: s, leased_sqft: n, vacant: true,",
    to:   "      tenant_name: '', suite: s, unitNumber: s, leased_sqft: n," },
  { id: 'V12', file: S, why: 'the record is written with a tenant name',
    from: "      tenant_name: '', suite: s, unitNumber: s, leased_sqft: n, vacant: true,",
    to:   "      tenant_name: 'Vacant', suite: s, unitNumber: s, leased_sqft: n, vacant: true," },
  { id: 'V13', file: V, why: 'the breakdown ignores the vacancy it is told about',
    from: "    const vacantPct     = _round(Math.max(0, Number(a.vacantPct) || 0));",
    to:   "    const vacantPct     = 0;" },
  { id: 'V14', file: V, why: 'the next step still asks for a lease on a resolved remainder',
    from: "    const biggest = (bk.lines || []).filter(l => l.key !== 'residual' && !(l.key === 'uncovered' && bk.vacantResolved))[0];",
    to:   "    const biggest = (bk.lines || []).filter(l => l.key !== 'residual')[0];" },
  { id: 'V15', file: T, why: 'the Spaces list loses the button',
    from: "        '<button type=\"button\" class=\"tsl-vacant-btn\" id=\"tslVacantBtn\" onclick=\"TenantSpace.openVacantForm()\"' + (_list.vacantForm ? ' disabled' : '') + '>Mark space vacant</button>' +",
    to:   "" },
  { id: 'V16', file: T, why: 'the uncovered note counts recorded vacancy as still uncovered',
    from: "      if (!_isVacantRow(t) && !t.tenant_name) return;\n      covered += (_numish(t.leased_sqft) || 0);",
    to:   "      if (_isVacantRow(t) || !t.tenant_name) return;\n      covered += (_numish(t.leased_sqft) || 0);" },
  { id: 'V17', file: S, why: 'the summary banner never says who bears the recorded vacant share',
    from: "      if (bk.vacantResolved && _vacPct > 0) {",
    to:   "      if (false) {" },
  { id: 'V18', file: S, why: 'the Prepare fact for recorded vacancy is dropped',
    from: "      return v.count > 0\n        ? fact('Recorded vacant',",
    to:   "      return false\n        ? fact('Recorded vacant'," },
  { id: 'V19', file: T, why: "the form's refusal is swallowed",
    from: "      _list.vacantError = (res && res.error) || 'The vacancy could not be recorded.';",
    to:   "      _list.vacantError = '';" },
  // ── one vacancy-aware authority, and every consumer that reads it ─────────
  // Each of these is a consumer that once counted the vacancy as a sixth
  // tenant and its area as occupied ("100% Occupied · 6 Tenants" on a building
  // whose Spaces tab said 5 and 1). Each is sent back to its own arithmetic.
  { id: 'V21', file: S, why: 'the portfolio card counts every row as a tenant and every area as occupied',
    from: "    const _occupiedRows = Array.isArray(p.tenants) ? window.TenantNormalize.occupiedTenants(p.tenants) : null;",
    to:   "    const _occupiedRows = Array.isArray(p.tenants) ? p.tenants : null;" },
  { id: 'V22', file: PR, why: 'the Property Information occupancy counts vacant area as leased',
    from: "    var leased = _TN().occupiedTenants(property.tenants).reduce(function (s, t) {",
    to:   "    var leased = (property.tenants || []).reduce(function (s, t) {" },
  { id: 'V23', file: PA, why: 'the leased-area authority (property record, AI occupancy) counts the vacancy',
    from: "    return Array.isArray(t) ? _TN().occupiedTenants(t) : [];",
    to:   "    return Array.isArray(t) ? t.filter(Boolean) : [];" },
  { id: 'V24', file: CC, why: "the Command Center's per-property occupancy counts vacant area as occupied",
    from: "      const occupied = window.TenantNormalize.occupiedTenants(p.tenants).reduce((s, t) => s + _num(t && t.leased_sqft), 0);",
    to:   "      const occupied = (p.tenants || []).reduce((s, t) => s + _num(t && t.leased_sqft), 0);" },
  { id: 'V25', file: AI, why: 'the AI summary counts the vacancy as a tenant',
    from: "        ? rec.spaces.filter(sp => !sp.vacant).length",
    to:   "        ? rec.spaces.length" },
  { id: 'V26', file: PREC, why: 'the property record stops saying which space is vacant',
    from: "        vacant:     !!(t && t.vacant === true),",
    to:   "        vacant:     false," },
  { id: 'V27', file: S, why: 'the Property tab header is not redrawn after a vacancy is recorded',
    from: "  try { if (window.PropertyOS && typeof PropertyOS.renderPropertyPage === 'function') PropertyOS.renderPropertyPage(prop, { allowCollapse: false }); } catch (_) {}",
    to:   "" },
  { id: 'V20', file: SEL, why: 'the property readiness selector counts a vacancy as a lease',
    from: "    const tenants = Array.isArray(p.tenants) ? p.tenants.filter(t => t && t.vacant !== true) : [];\n    const snap    = p.camReconciliation ?? null;",
    to:   "    const tenants = Array.isArray(p.tenants) ? p.tenants.filter(Boolean) : [];\n    const snap    = p.camReconciliation ?? null;" },
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vacmut-'));
fs.cpSync(ROOT, tmp, {
  recursive: true,
  filter: (src) => {
    const rel = path.relative(ROOT, src);
    return !(rel === '.git' || rel.startsWith('.git' + path.sep) ||
             rel === 'node_modules' || rel.startsWith('node_modules' + path.sep));
  },
});
const FILES = [...new Set(MUTANTS.map(m => m.file))];
const ORIGINAL = {};
for (const f of FILES) ORIGINAL[f] = fs.readFileSync(path.join(ROOT, f), 'utf8');

// The e2e suite proves the workflow; the two pure suites pin the selector and
// the coverage finding's contract for a property with a recorded vacancy.
const SUITES = ['test-e2e-vacancy.js', 'test-vacancy.js'];
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
