'use strict';
/**
 * tools/property-cabinet-view-mutation.js — does the Phase 1 surface hold?
 *
 *   node tools/property-cabinet-view-mutation.js
 *
 * The cabinet view routes records to drawers, pages the register, mounts the
 * attention list and resolves addresses; the Spaces list labels vacancy and
 * orders rows. Each mutant below is a plausible way of getting one of those
 * wrong in the VIEW (the map itself is mutated by property-cabinet-mutation.js).
 *
 *   V01  a drawer shows every record, not only its own
 *   V02  History renders every record as a card, not only its fallbacks
 *   V03  the year chip is ignored
 *   V04  the invoice page is 500 rows — the register is dumped
 *   V05  the Space filter on invoices is ignored
 *   V06  a tile counts every record instead of its drawer's
 *   V07  Recent activity is oldest first
 *   V08  openRecord opens History whatever the record's home
 *   V09  hashchange is not listened to — pasted links do nothing
 *   V10  the attention mount shows every item, not the top three
 *   V11  a suite's record opens no Space
 *   V12  the Spaces list treats every row as occupied
 *   V13  search ignores the tenant name
 *   V14  sort direction cannot be reversed
 *   V15  suites sort as strings (100 before 9)
 *   V16  an empty drawer's tile shows "0 records" instead of saying so
 *   V17  "Next 90 days" takes everything
 *   V18  a space with no CAM result still offers a statement
 *   V19  an attention item's drawer address is ignored
 *   V20  the attention mount is never rendered
 *   V21  a vacant space shows lease terms
 *
 * A FAILING BASELINE IS NOT A PASS. The unmutated copy is asserted before any
 * mutant runs and the harness exits non-zero if it fails.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const V = 'property-cabinet-view.js', TS = 'tenant-space.js', PW = 'property-workspace.js';

const MUTANTS = [
  { id: 'V01', file: V, why: 'a drawer shows every record, not only its own',
    from: "      return p.drawer === key;", to: "      return true;" },
  { id: 'V02', file: V, why: 'History renders every record as a card',
    from: "      if (key === 'history') return p.drawer === 'history';     // History is HOME only to its fallbacks",
    to:   "      if (key === 'history') return true;" },
  { id: 'V03', file: V, why: 'the year chip is ignored',
    from: "      if (_state.year && String(p.year == null ? 'undated' : p.year) !== String(_state.year)) return false;",
    to:   "      if (false) return false;" },
  { id: 'V04', file: V, why: 'the invoice page is 500 rows',
    from: "  var PAGE_INVOICES = 25;  // invoice rows per page", to: "  var PAGE_INVOICES = 500;" },
  { id: 'V05', file: V, why: 'the Space filter on invoices is ignored',
    from: "category: _state.category, spaceId: _state.spaceId || null, page: _state.page, pageSize: PAGE_INVOICES });",
    to:   "category: _state.category, spaceId: null, page: _state.page, pageSize: PAGE_INVOICES });" },
  { id: 'V06', file: V, why: 'a tile counts every record instead of its drawer’s',
    from: "      line1: (years.length ? _plural(years.length, 'year') + ' · ' : '') + recs(d.count) + (docs ? ' · ' + _plural(docs, 'document') : ''),",
    to:   "      line1: (years.length ? _plural(years.length, 'year') + ' · ' : '') + recs(idx.records.length) + (docs ? ' · ' + _plural(docs, 'document') : '')," },
  { id: 'V07', file: V, why: 'Recent activity is oldest first',
    from: "    var rows = idx.records.slice().sort(function (a, b) {\n      return (new Date(b.when).getTime() || 0) - (new Date(a.when).getTime() || 0);\n    });\n    if (limit) rows = rows.slice(0, limit);",
    to:   "    var rows = idx.records.slice().sort(function (a, b) {\n      return (new Date(a.when).getTime() || 0) - (new Date(b.when).getTime() || 0);\n    });\n    if (limit) rows = rows.slice(0, limit);" },
  { id: 'V08', file: V, why: 'openRecord opens History whatever the home',
    from: "    return openDrawer(filed.drawer, { recordId: String(ev.id), year: null, cat: 'all', system: null });",
    to:   "    return openDrawer('history', { recordId: String(ev.id), year: null, cat: 'all', system: null });" },
  { id: 'V09', file: V, why: 'hashchange is not listened to',
    from: "    window.addEventListener('hashchange', function () { try { applyAddress(location.hash); } catch (_e) {} });",
    to:   "    void 0;" },
  { id: 'V10', file: PW, why: 'the attention mount shows every item',
    from: "  var CABINET_SHOWN = 3;", to: "  var CABINET_SHOWN = 99;" },
  { id: 'V11', file: V, why: 'a suite’s record opens no Space',
    from: "      if (sid != null) { openSpace(sid); return true; }", to: "      if (false) { openSpace(sid); return true; }" },
  { id: 'V12', file: TS, why: 'every row is occupied',
    from: "    return PC && PC.isVacant ? PC.isVacant(t) : !!(t && t.vacant === true);", to: "    return false;" },
  { id: 'V13', file: TS, why: 'search ignores the tenant name',
    from: "               String(r.tenant || '').toLowerCase().indexOf(q) >= 0 ||", to: "               false ||" },
  { id: 'V14', file: TS, why: 'sort direction cannot be reversed',
    from: "      return c * dir;", to: "      return c;" },
  { id: 'V15', file: TS, why: 'suites sort as strings (100 before 9)',
    from: "    return String(a || '').localeCompare(String(b || ''), undefined, { numeric: true, sensitivity: 'base' });",
    to:   "    return String(a || '').localeCompare(String(b || ''), undefined, { sensitivity: 'base' });" },
  { id: 'V16', file: V, why: 'an empty drawer’s tile shows “0 records”',
    from: "    if (!d.count) return { line1: 'No records yet', line2: EMPTY2[key] || '', empty: true };",
    to:   "    if (false) return { line1: 'No records yet', line2: EMPTY2[key] || '', empty: true };" },
  { id: 'V17', file: V, why: '“Next 90 days” takes everything',
    from: "    var soon = all.filter(function (x) { return x.daysOut <= 90; });", to: "    var soon = all.filter(function (x) { return x.daysOut <= 900; });" },
  { id: 'V18', file: TS, why: 'a space with no CAM result still offers a statement',
    from: "    var stmtHtml = rec.camResult\n", to: "    var stmtHtml = true\n" },
  { id: 'V19', file: PW, why: 'an attention item’s drawer address is ignored',
    from: "    if (it.nav.drawer && window.PropertyCabinetView && window.PropertyCabinetView.openDrawer) {", to: "    if (false) {" },
  { id: 'V20', file: PW, why: 'the attention mount is never rendered',
    from: "    _renderCabinetMount(items);\n", to: "" },
  { id: 'V21', file: TS, why: 'a vacant space shows lease terms',
    from: "    if (rec.space.vacant) leaseHtml = _empty(", to: "    if (false) leaseHtml = _empty(" },
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pcvmut-'));
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

const SUITES = ['test-e2e-property-cabinet-view.js', 'test-e2e-spaces-list.js'];
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
