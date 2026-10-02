'use strict';
/**
 * tools/acquisition-matrix13-mutation.js — would anyone notice if the
 * acquisition matrix, F1, or the merge-only re-read were quietly undone?
 *
 *   node tools/acquisition-matrix13-mutation.js
 *
 * Each mutant undoes ONE rule, and test-acquisition-matrix13.js,
 * test-acquisition-lease-matrix.js, test-acquisition-terms.js or
 * test-e2e-acquisition-matrix13.js must fail for every one.
 *
 *   The thirteen columns — acquisition-lease-matrix.js
 *     X01  two columns trade places (% Rent after Options)
 *     X02  an unfiled row is shown as a tenant
 *     X03  the monthly figure stops saying it was calculated
 *     X04  the readings a governing document replaced are dropped (F3)
 *     X05  the governing document's date is lost
 *
 *   "None (stated)" — acquisition-lease-matrix.js
 *     X06  "None" with no clause behind it reads as stated
 *     X07  an unclear "None" reads as stated
 *     X08  a "None" a person typed reads as stated by a document
 *
 *   The CSVs — acquisition-lease-matrix.js
 *     X09  a term no document establishes is written as a blank cell
 *     X10  a formula is written as a formula
 *     X11  the byte-order mark is dropped
 *
 *   F1 — Unclear with no value is not "Not established"
 *     F01  cellFor gives an unclear term with no value no words
 *     F02  the matrix cell draws it as the em dash
 *     F03  the record's value draws it as the em dash
 *     F04  the headline says "not established"
 *
 *   The merge-only re-read — acquisition-terms.js / script.js
 *     R01  a second reading replaces keys already read
 *     R02  the re-read writes the reading's status as well
 *     R03  the re-read merges onto the page's cache, not the database's row
 *     R04  a closed acquisition is read again
 *     R05  a failed re-read records the document as `failed`
 *
 *   The Tenant column — index.html / script.js
 *     T01  the tenant row header inherits the column headers' nowrap again
 *     T02  the tenant row header no longer clips what overflows it
 *     T03  a long name is no longer clamped, and runs as many lines as it takes
 *     T04  the tenant name is drawn outside its clamp
 *
 *   Readings in their field's type — acquisition-lease-matrix.js / script.js
 *     M01  an earlier reading is written raw
 *     M02  a competing reading is written raw
 *     M03  the sources CSV writes an earlier reading raw
 *     M04  every number is written as money, whatever the field
 *     M05  the panel draws the raw earlier value
 *     M06  the record's "Replaced" value is written raw
 *     M07  the record's contested values are written raw
 *
 *   The view — script.js
 *     V01  the thirteen columns become the default view
 *     V02  a clause in the sources is drawn as HTML
 *     V03  Escape no longer closes the sources
 *
 * Applied to a COPY; the working tree is never touched.
 * A FAILING BASELINE IS NOT A PASS.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const M = 'acquisition-lease-matrix.js';
const H = 'index.html';
const A = 'acquisition-terms.js';
const S = 'script.js';

const MUTANTS = [
  // ── the thirteen ─────────────────────────────────────────────────────────
  { id: 'X01', file: M, why: 'two columns trade places (% Rent after Options)',
    from: "    { key: 'pct_rent',    header: '% Rent',            field: 'percentage_rent' },\n    { key: 'options',     header: 'Options',           field: 'renewal_options' },",
    to:   "    { key: 'options',     header: 'Options',           field: 'renewal_options' },\n    { key: 'pct_rent',    header: '% Rent',            field: 'percentage_rent' }," },
  { id: 'X02', file: M, why: 'an unfiled row is shown as a tenant',
    from: "    var leaseholds = rows.filter(function (r) { return r._source === 'leasehold'; }).map(function (r) {\n      var id",
    to:   "    var leaseholds = rows.map(function (r) {\n      var id" },
  { id: 'X03', file: M, why: 'the monthly figure stops saying it was calculated',
    from: "        out.sub = _money(c.value / 12) + '/mo (calc.)';",
    to:   "        out.sub = _money(c.value / 12) + '/mo';" },
  { id: 'X04', file: M, why: 'the readings a governing document replaced are dropped (F3)',
    from: '        prior: _arr(t.supersededValues).map(function (h) {',
    to:   '        prior: [].map(function (h) {' },
  { id: 'X05', file: M, why: "the governing document's date is lost",
    from: '        docDate:      g ? (g.docDate || null) : null,',
    to:   '        docDate:      null,' },
  // ── None (stated) ────────────────────────────────────────────────────────
  { id: 'X06', file: M, why: '"None" with no clause behind it reads as stated',
    from: "      if (c.value === 'None' && quote && (c.state === 'read' || c.state === 'verified')) {",
    to:   "      if (c.value === 'None' && (c.state === 'read' || c.state === 'verified')) {" },
  { id: 'X07', file: M, why: 'an unclear "None" reads as stated',
    from: "      if (c.value === 'None' && quote && (c.state === 'read' || c.state === 'verified')) {",
    to:   "      if (c.value === 'None' && quote && (c.state === 'read' || c.state === 'verified' || c.state === 'unclear')) {" },
  { id: 'X08', file: M, why: 'a "None" a person typed reads as stated by a document',
    from: "      if (c.value === 'None' && quote && (c.state === 'read' || c.state === 'verified')) {",
    to:   "      if (c.value === 'None' && (quote || c.state === 'entered') && (c.state === 'read' || c.state === 'verified' || c.state === 'entered')) {" },
  // ── CSVs ─────────────────────────────────────────────────────────────────
  { id: 'X09', file: M, why: 'a term no document establishes is written as a blank cell',
    from: "    if (c.state === 'missing' || c.text === null || c.text === undefined) return STATE_LABEL.missing;",
    to:   "    if (c.state === 'missing' || c.text === null || c.text === undefined) return '';" },
  { id: 'X10', file: M, why: 'a formula is written as a formula',
    from: "    if (/^[=+\\-@\\t\\r]/.test(s)) s = \"'\" + s;",
    to:   '' },
  { id: 'X11', file: M, why: 'the byte-order mark is dropped',
    from: "  var CSV_BOM = '\\uFEFF';",
    to:   "  var CSV_BOM = '';" },
  // ── F1 ───────────────────────────────────────────────────────────────────
  { id: 'F01', file: M, why: 'cellFor gives an unclear term with no value no words',
    from: "    return (t === null && state === 'unclear') ? STATE_LABEL.unclear : t;",
    to:   '    return t;' },
  { id: 'F02', file: S, why: 'the matrix cell draws an unclear term with no value as the em dash',
    from: "  if (cell.state === 'unclear' && cell.text === null) return `<span class=\"acq-lm-v unclear\" data-state=\"unclear\"${title}>Unclear</span>`;\n",
    to:   '' },
  { id: 'F03', file: S, why: "the record's value draws an unclear term with no value as the em dash",
    from: "  if (cell.state === 'unclear' && cell.text === null) return `<span class=\"acq-lm-v unclear\" data-state=\"unclear\" title=\"${esc(cell.label)}: unclear\">Unclear</span>`;\n",
    to:   '' },
  { id: 'F04', file: M, why: 'the headline says "not established" for an unclear term',
    from: "      if (_noValue(cell))             return noun + ' unclear';\n",
    to:   '' },
  // ── the merge-only re-read ───────────────────────────────────────────────
  { id: 'R01', file: A, why: 'a second reading replaces keys already read',
    from: "    return want.filter(function (k) { return FIELDS.indexOf(k) >= 0 && !Object.prototype.hasOwnProperty.call(f, k); });",
    to:   "    return want.filter(function (k) { return FIELDS.indexOf(k) >= 0; });" },
  { id: 'R02', file: S, why: "the re-read writes the reading's status as well",
    from: "    ? await _acqSaveDocument({ reviewId, intakeId: row.intake_id, fileName: row.file_name, abstractedFields: m.abstraction })",
    to:   "    ? await _acqSaveDocument({ reviewId, intakeId: row.intake_id, fileName: row.file_name, abstractedFields: m.abstraction, abstractionStatus: 'success', abstractedAt: new Date().toISOString() })" },
  { id: 'R03', file: S, why: "the re-read merges onto the page's cache, not the database's row",
    from: '  const existing = await _acqLoadOneEvidence(docId);',
    to:   '  const existing = _acqEvidence.get(docId);' },
  { id: 'R04', file: S, why: 'a closed acquisition is read again',
    from: '  if (!AT || !r || !reviewId || _acqFrozen(reviewId) || _acqAbstracting.has(r.id)) return false;',
    to:   '  if (!AT || !r || !reviewId || _acqAbstracting.has(r.id)) return false;' },
  { id: 'R05', file: S, why: 'a failed re-read records the document as `failed`',
    from: "    showToast('The new terms could not be read for ' + (row.file_name || 'this document') + ' — nothing was changed.');\n    _renderAcqDocuments();\n    return;",
    to:   "    await _acqSaveDocument({ reviewId, intakeId: row.intake_id, fileName: row.file_name, abstractionStatus: 'failed', abstractionError: failed || 'no_fields' });\n    _renderAcqDocuments();\n    return;" },
  // ── the Tenant column ────────────────────────────────────────────────────
  { id: 'T01', file: H, why: "the tenant row header inherits the column headers' nowrap again",
    from: '    .acq-m13-table tbody .acq-m13-tenant { width: 170px; max-width: 170px; white-space: normal; overflow: hidden; }\n',
    to:   '' },
  { id: 'T02', file: H, why: 'the tenant row header no longer clips what overflows it',
    from: '    .acq-m13-table tbody .acq-m13-tenant { width: 170px; max-width: 170px; white-space: normal; overflow: hidden; }',
    to:   '    .acq-m13-table tbody .acq-m13-tenant { width: 170px; max-width: 170px; white-space: normal; }' },
  { id: 'T03', file: H, why: 'a long name is no longer clamped, and runs as many lines as it takes',
    from: '    .acq-m13-name { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;',
    to:   '    .acq-m13-name { display: block;' },
  { id: 'T04', file: S, why: 'the tenant name is drawn outside its clamp',
    from: '<span class="acq-m13-name">${esc(l.tenant)}</span></button></th>',
    to:   '${esc(l.tenant)}<span class="acq-m13-name"></span></button></th>' },
  // ── readings in their field's type ───────────────────────────────────────
  { id: 'M01', file: M, why: 'an earlier reading is written raw',
    from: 'docDate: h.docDate || null, value: h.value, text: readingText(h.value, c.type),',
    to:   'docDate: h.docDate || null, value: h.value, text: h.value == null ? null : String(h.value),' },
  { id: 'M02', file: M, why: 'a competing reading is written raw',
    from: '          r.text = readingText(r.value, c.type); return r;',
    to:   '          r.text = r.value == null ? null : String(r.value); return r;' },
  { id: 'M03', file: M, why: 'the sources CSV writes an earlier reading raw',
    from: "': ' + (p.text || readingText(p.value));",
    to:   "': ' + (p.value == null ? '—' : p.value);" },
  { id: 'M04', file: M, why: 'every number is written as money, whatever the field',
    from: "    if (type === 'date') return usDate(value);\n    return formatValue(value, type);",
    to:   "    if (type === 'date') return usDate(value);\n    return formatValue(value, typeof value === 'number' ? 'money' : type);" },
  { id: 'M05', file: S, why: 'the panel draws the raw earlier value',
    from: "<strong>${esc(p.text || '—')}</strong>",
    to:   "<strong>${esc(p.value == null ? '—' : String(p.value))}</strong>" },
  { id: 'M06', file: S, why: 'the record\'s "Replaced" value is written raw',
    from: "Replaced ${esc(_acqTermValue({ value: term.supersededValues[0].value, type: term.type }) || '—')}",
    to:   "Replaced ${esc(String(term.supersededValues[0].value))}" },
  { id: 'M07', file: S, why: "the record's contested values are written raw",
    from: "esc((c.values || []).map(v => _acqTermValue({ value: v, type: term.type }) || '—').join(' vs '))",
    to:   "esc((c.values || []).join(' vs '))" },
  // ── the view ─────────────────────────────────────────────────────────────
  { id: 'V01', file: S, why: 'the thirteen columns become the default view',
    from: "  try { return localStorage.getItem('acqMatrixView') === 'acquisition' ? 'acquisition' : 'summary'; }",
    to:   "  try { return localStorage.getItem('acqMatrixView') === 'summary' ? 'summary' : 'acquisition'; }" },
  { id: 'V02', file: S, why: 'a clause in the sources is drawn as HTML',
    from: '        ${s.quote ? `<blockquote class="acq-m13-d-quote">${esc(s.quote)}</blockquote>`',
    to:   '        ${s.quote ? `<blockquote class="acq-m13-d-quote">${s.quote}</blockquote>`' },
  { id: 'V03', file: S, why: 'Escape no longer closes the sources',
    from: "    if (ev.key === 'Escape' && _acqM13Open) { ev.preventDefault(); acqCloseMatrixCell(); return; }\n",
    to:   '' },
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'acq-matrix13-mut-'));
for (const entry of fs.readdirSync(ROOT)) {
  if (['node_modules', '.git', 'scratchpad', 'evidence', 'assets'].includes(entry)) continue;
  fs.cpSync(path.join(ROOT, entry), path.join(tmp, entry), { recursive: true });
}
try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(tmp, 'node_modules'), 'dir'); } catch (_) {}

const ORIGINAL = {};
[...new Set(MUTANTS.map(m => m.file))].forEach(f => { ORIGINAL[f] = fs.readFileSync(path.join(ROOT, f), 'utf8'); });
// The fast suites first: a mutant they kill never pays for a browser.
const SUITES = ['test-acquisition-matrix13.js', 'test-acquisition-lease-matrix.js', 'test-acquisition-terms.js',
                'test-e2e-acquisition-matrix13.js'];
function runSuites() {
  for (const suite of SUITES) {
    try { execFileSync(process.execPath, [suite], { cwd: tmp, stdio: 'pipe', timeout: 600000 }); }
    catch (_) { return false; }
  }
  return true;
}

const baseline = runSuites();
console.log('Baseline (unmutated copy): ' + (baseline ? 'PASS' : 'FAIL'));
if (!baseline) {
  console.error('\nThe unmutated copy does not pass, so every result below would be\n' +
                'meaningless. Nothing is mutated. Fix the harness or the suite first.');
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(2);
}

let killed = 0;
const survived = [];
for (const m of MUTANTS) {
  const src = ORIGINAL[m.file];
  const i = src.indexOf(m.from);
  if (i === -1) { console.log(`  ??   ${m.id}  ANCHOR NOT FOUND in ${m.file} — malformed mutant`); survived.push(m.id + ' (malformed)'); continue; }
  if (src.indexOf(m.from, i + 1) !== -1) {
    console.log(`  ??   ${m.id}  ANCHOR NOT UNIQUE in ${m.file} — malformed mutant`); survived.push(m.id + ' (anchor not unique)'); continue;
  }
  fs.writeFileSync(path.join(tmp, m.file), src.slice(0, i) + m.to + src.slice(i + m.from.length));
  const passed = runSuites();
  fs.writeFileSync(path.join(tmp, m.file), src);
  if (!passed) { killed++; console.log(`  kill ${m.id}  ${m.why}`); continue; }
  survived.push(`${m.id}: ${m.why}`);
  console.log(`  LIVE ${m.id}  ${m.why}`);
}
console.log(`\n${killed}/${MUTANTS.length} killed`);
if (survived.length) { console.log('\nSURVIVORS — each needs a written verdict (real gap or equivalent):'); survived.forEach(s => console.log('  · ' + s)); }
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(survived.length ? 1 : 0);
