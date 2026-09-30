'use strict';
/**
 * tools/roster-reload-mutation.js — does the roster reload suite bite?
 *
 *   node tools/roster-reload-mutation.js
 *
 * The fix: over the portfolio list's placeholder roster (built from the
 * tenants table) the saved roster wins on open, the live buffer takes it too,
 * and nothing done in the session is lost to it. Each mutant is one edit that
 * breaks one leg of that. Every one must be caught by
 * test-e2e-roster-reload-preservation.js.
 *
 * Applied to a COPY in a scratch directory; the working tree is never touched.
 * A FAILING BASELINE IS NOT A PASS.
 */
const fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const S = 'script.js';
const MUTANTS = [
  // ── recognising the placeholder ──────────────────────────────────────────
  { id: 'RR01', why: 'loadProperties no longer marks the list roster',
    from: '_listRosterRows.add(r); return r;', to: 'return r;' },
  { id: 'RR02', why: 'a roster is never recognised as holding placeholder rows',
    from: '  return ids.size ? ids : null;', to: '  return null;' },
  { id: 'RR03', why: 'only a roster made wholly of placeholder rows is recognised',
    from: '  return ids.size ? ids : null;', to: '  return ids.size && ids.size === (tenants || []).filter(Boolean).length ? ids : null;' },
  { id: 'RR04', why: 'the placeholder is recognised after the paint (the paint replaced its rows)',
    from: '  const _placeholderIds = _listRosterIds(property.tenants);\n  renderProperty(property);',
    to:   '  renderProperty(property);\n  const _placeholderIds = _listRosterIds(property.tenants);' },
  { id: 'RR16', why: 'a real row beside the placeholder is taken into the base (dropped as untouched)',
    from: "if (!t || typeof t !== 'object' || t.id == null || !ids.has(String(t.id))) return;", to: "if (!t || typeof t !== 'object' || t.id == null) return;" },
  // ── adopting the saved roster ────────────────────────────────────────────
  { id: 'RR05', why: 'the count guard decides over the placeholder too',
    from: 'const adopt = _rosterBase ? (loadedCount > 0 || inMemCount === 0) : loadedCount >= inMemCount;',
    to:   'const adopt = loadedCount >= inMemCount;' },
  { id: 'RR06', why: 'the live buffer keeps the placeholder (the original defect)',
    from: '        tenantData.splice(0, tenantData.length,\n          ..._reconcileProvisionalRoster(_rosterBase, tenantData, property.tenants));',
    to:   '        void 0;' },
  { id: 'RR07', why: 'the buffer takes the saved roster whole — session work is lost',
    from: '          ..._reconcileProvisionalRoster(_rosterBase, tenantData, property.tenants));',
    to:   '          ...property.tenants);' },
  // ── the merge ────────────────────────────────────────────────────────────
  { id: 'RR08', why: 'a field changed in the session is not carried onto the saved row',
    from: '    changed.forEach(k => { merged[k] = t[k]; });', to: '' },
  { id: 'RR09', why: 'the placeholder row wins over the saved row',
    from: '    const merged = { ...s };', to: '    const merged = { ...s, ...t };' },
  { id: 'RR10', why: 'a row added in the session is dropped',
    from: '    if (!was) { out.push(t); return; }', to: '    if (!was) return;' },
  { id: 'RR11', why: 'an untouched placeholder row the saved roster lacks is kept',
    from: '    if (!s) { if (changed.length) out.push(t); return; }', to: '    if (!s) { out.push(t); return; }' },
  { id: 'RR12', why: 'a saved row the buffer lacks is not appended',
    from: '    if (t.id != null && placed.has(String(t.id))) return;\n    out.push(t);', to: '    return;' },
  { id: 'RR13', why: 'a changed field is detected against nothing — every field reads as changed',
    from: '    const changed = Object.keys(t).filter(k => JSON.stringify(t[k]) !== was[k]);', to: '    const changed = Object.keys(t);' },
  { id: 'RR14', why: 'no base is kept — every placeholder row reads as a session row',
    from: 'const _rosterBase = _placeholderIds ? _snapshotRoster(tenantData, _placeholderIds) : null;', to: 'const _rosterBase = _placeholderIds ? new Map() : null;' },
  // ── the late lease file ──────────────────────────────────────────────────
  { id: 'RR15', why: 'a late lease file writes back the row captured before the read',
    from: '      tenantData[at] = { ...cur, leaseFile: file };', to: '      tenantData[idx] = { ...t, leaseFile: file };' },
];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roster-mut-'));
fs.cpSync(ROOT, tmp, { recursive: true, filter: (src) => { const rel = path.relative(ROOT, src); return !(rel === '.git' || rel.startsWith('.git' + path.sep) || rel === 'node_modules' || rel.startsWith('node_modules' + path.sep)); } });
try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(tmp, 'node_modules'), 'dir'); } catch (_) {}
const ORIGINAL = fs.readFileSync(path.join(ROOT, S), 'utf8');
const SUITES = ['test-e2e-roster-reload-preservation.js'];
function runSuites() {
  for (const suite of SUITES) {
    try { execFileSync(process.execPath, [suite], { cwd: tmp, stdio: 'pipe', timeout: 600000 }); }
    catch (_) { return suite; }
  }
  return null;
}
const baseline = runSuites();
console.log('Baseline (unmutated copy): ' + (baseline ? 'FAIL ' + baseline : 'PASS'));
if (baseline) { console.error('\nThe unmutated copy does not pass, so every result below would be meaningless. Nothing is mutated.'); fs.rmSync(tmp, { recursive: true, force: true }); process.exit(2); }
let killed = 0; const survivors = [];
for (const m of MUTANTS) {
  if (ORIGINAL.indexOf(m.from) === -1) { console.log(`  ?  ${m.id} anchor not found — the harness is stale, not the product`); survivors.push(m.id + ' (anchor missing)'); continue; }
  if (ORIGINAL.indexOf(m.from) !== ORIGINAL.lastIndexOf(m.from)) { console.log(`  ?  ${m.id} anchor is not unique`); survivors.push(m.id + ' (anchor ambiguous)'); continue; }
  fs.writeFileSync(path.join(tmp, S), ORIGINAL.replace(m.from, m.to));
  const failedBy = runSuites();
  fs.writeFileSync(path.join(tmp, S), ORIGINAL);
  if (failedBy) { killed++; console.log(`  \x1b[32m☠\x1b[0m  ${m.id} killed by ${failedBy} — ${m.why}`); }
  else { survivors.push(m.id); console.log(`  \x1b[31m✗\x1b[0m  ${m.id} SURVIVED — ${m.why}`); }
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log('\n' + '─'.repeat(58));
console.log(`${killed} killed, ${survivors.length} survived of ${MUTANTS.length}`);
if (survivors.length) { survivors.forEach(s => console.log('  · ' + s)); process.exit(1); }
