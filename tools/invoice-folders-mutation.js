'use strict';
/**
 * tools/invoice-folders-mutation.js — does the invoice filing system hold?
 *
 *   node tools/invoice-folders-mutation.js
 *
 * The folder VIEWS are mutated by property-cabinet-mutation.js (P20–P28).
 * These mutants are the surface's own decisions: what the drawer opens on,
 * what a leaf renders, how a folder click and an address are read, and how
 * the reference samples are kept apart from records.
 *
 *   I01  the drawer opens on the flat list, not the cabinet
 *   I02  the leaf renders a summary line instead of the register's row
 *   I03  months render in reverse
 *   I04  a year folder click ignores the year
 *   I05  the address drops the vendor
 *   I06  openInvoice files a Space's invoice under the property
 *   I07  openInvoice stops at the vendor, never the year
 *   I08  typing at the top of the cabinet does not search
 *   I09  the reference samples box is never rendered
 *   I10  the samples box is open by default
 *   I11  the vendor step is missing from the trail
 *   I12  sample rows carry no "sample" tag
 *   I13  the deep-linked bill is not highlighted
 *   I14  the summary miscounts what is filed under Spaces
 *
 * A FAILING BASELINE IS NOT A PASS.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const V = 'property-cabinet-view.js', POS = 'property-os.js';

const MUTANTS = [
  { id: 'I01', file: V, why: 'the drawer opens on the flat list',
    from: "             mode: 'folders', fVendor: null, fYear: null };", to: "             mode: 'search', fVendor: null, fYear: null };" },
  { id: 'I02', file: V, why: 'the leaf renders a summary line instead of the register’s row',
    from: "            var row = POS().invoiceRowHtml(property, i);",
    to:   "            var row = '<div class=\"pos-inv\" data-inv-id=\"' + _esc(i.id) + '\"><span class=\"pos-inv-amt\">' + _esc(_money(i.amount)) + '</span></div>';" },
  { id: 'I03', file: V, why: 'months render in reverse',
    from: "      var months = f.months.map(function (m) {", to: "      var months = f.months.slice().reverse().map(function (m) {" },
  { id: 'I04', file: V, why: 'a year folder click ignores the year',
    from: "    _state.mode = 'folders'; _state.fVendor = vendor || null; _state.fYear = vendor ? (year || null) : null;",
    to:   "    _state.mode = 'folders'; _state.fVendor = vendor || null; _state.fYear = null;" },
  { id: 'I05', file: V, why: 'the address drops the vendor',
    from: "      vendor: isInv ? _state.fVendor : null,", to: "      vendor: null," },
  { id: 'I06', file: V, why: 'openInvoice files a Space’s invoice under the property',
    from: "    if (raw.spaceId) return false;                      // filed under its Space", to: "    if (false) return false;" },
  { id: 'I07', file: V, why: 'openInvoice stops at the vendor',
    from: "    return openDrawer('invoices', { vendor: vendor, year: y == null ? 'undated' : String(y), recordId: String(raw.id) });",
    to:   "    return openDrawer('invoices', { vendor: vendor, year: null, recordId: String(raw.id) });" },
  { id: 'I08', file: V, why: 'typing at the top of the cabinet does not search',
    from: "    if (_state.drawer === 'invoices' && _state.mode !== 'search' && _state.q) { _state.mode = 'search'; _state.fVendor = null; _state.fYear = null; }",
    to:   "    if (false) { _state.mode = 'search'; }" },
  { id: 'I09', file: V, why: 'the reference samples box is never rendered',
    from: "? _samplesBox(POS().sampleDocumentsHtml(property)) : '') +", to: "? '' : '') +" },
  { id: 'I10', file: V, why: 'the samples box is open by default',
    from: "    return '<details class=\"pcv-samples\">' +", to: "    return '<details class=\"pcv-samples\" open>' +" },
  { id: 'I11', file: V, why: 'the vendor step is missing from the trail',
    from: "    if (_state.fVendor) crumb.push({ label: _state.fVendor,", to: "    if (false) crumb.push({ label: _state.fVendor," },
  { id: 'I12', file: POS, why: 'sample rows carry no “sample” tag',
    from: "          '<span class=\"pos-doc-sample\">sample</span></div>';", to: "          '</div>';" },
  { id: 'I13', file: V, why: 'the deep-linked bill is not highlighted',
    from: "              ? row.replace('class=\"pos-inv\"', 'class=\"pos-inv pos-inv--focus\"') : row;", to: "              ? row : row;" },
  { id: 'I14', file: V, why: 'the summary miscounts what is filed under Spaces',
    from: "        (bySpace ? ' · ' + _plural(bySpace, 'tenant-direct invoice') + ' filed under Spaces' : '') + '</div>' +",
    to:   "        '</div>' +" },
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'invmut-'));
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

const SUITES = ['test-e2e-invoice-folders.js'];
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
