'use strict';
/**
 * tools/acquisition-term-entry-mutation.js — would anyone notice if a rule of
 * manual entry, or of how a decision resolves a term, were quietly undone?
 *
 *   node tools/acquisition-term-entry-mutation.js
 *
 * Each mutant undoes ONE rule, and test-acquisition-term-safeguards.js,
 * test-acquisition-decisions.js, test-acquisition-resolver.js,
 * test-acquisition-workspace.js, test-acquisition-report.js,
 * test-acquisition-report-view.js or test-e2e-acquisition-term-entry.js must
 * fail for every one.
 *
 *   Invalid input is refused before it is saved (gap 1)
 *     C01  a correction the type cannot hold is accepted by the payload builder
 *     C02  a stored correction the type cannot hold is applied (verified, empty)
 *     C11  an entry the type cannot hold is accepted
 *     C15  Save is enabled whatever was typed
 *     C16  Correct writes before checking the value
 *
 *   A rejected reading is kept, and used nowhere (gap 2)
 *     C03  the rejected reading stays the term's value
 *     C04  the rejected reading is not kept
 *     C13  the matrix cell shows "Unclear", not "Rejected by a person"
 *     C23  a correction after a rejection forgets the reading it replaces
 *
 *   An entered value is never silently overwritten (gap 3)
 *     C05  a document's later reading overwrites the entered value (as before)
 *     C06  the conflict is never raised
 *     C07  "Keep" silences every later reading, not only the one it was kept over
 *     C12  the projection loses the flags
 *     C21  Needs attention does not list the conflict
 *     C22  the row's status does not ask for review
 *     C18  "Keep my value" is offered on every entered term
 *
 *   A correction names what it replaced (gap 4)
 *     C08  the corrected value carries the replaced reading's clause
 *     C09  the replaced reading is not kept
 *
 *   Zero and "none", by field type (Step D)
 *     C24  zero is refused for every figure, as "not established"
 *     C25  a leased area of zero is accepted
 *     C26  a word for none is taken for a figure's value
 *     C27  a bare "None" is accepted with no clause behind it
 *     C28  a negative figure is accepted
 *     C29  the resolver reads an entered 0 by the AI rule (as nothing)
 *     C30  a sourceless correction is checked by the AI rule (0 refused)
 *
 *   The report shows the replaced reading apart from the evidence (Step D)
 *     C31  the replaced reading is not carried to the report
 *     C32  the rejected reading is not carried to the report
 *     C33  the replaced clause is shown as the new value's Source
 *     C34  the set-aside reading is not drawn
 *     C35  it is drawn with the evidence's own label
 *     C36  the replaced value is not struck through
 *     C37  a correction quoting the clause it replaces keeps it as support
 *     C38  …and keeps that clause's page
 *
 *   The reason, the sources CSV, the freeze, the history
 *     C10  a reason is not recorded on a correction
 *     C14  the sources CSV's Origin column is blank
 *     C17  Enter asks for a value on a converted review
 *     C19  the editor is drawn on a converted review
 *     C20  the decision history is not drawn
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const T = 'acquisition-terms.js';
const L = 'acquisition-leasehold.js';
const M = 'acquisition-lease-matrix.js';
const S = 'script.js';
const AR = 'acquisition-report.js';
const AV = 'acquisition-report-view.js';
const H = 'index.html';

const MUTANTS = [
  { id: 'C01', file: T, why: 'a correction the type cannot hold is accepted',
    from: "      if (to === null || to === undefined) return { ok: false, error: inputError(payload.field_key, payload.new_value) };\n",
    to:   '' },
  { id: 'C02', file: T, why: 'a stored correction the type cannot hold is applied',
    from: "      if (corrected === null || corrected === undefined) return _unreadable(term);\n",
    to:   '' },
  { id: 'C03', file: T, why: 'the rejected reading stays the term\'s value',
    from: "      term.value = null; term.quote = null; term.page = null; term.confidence = null;\n      term.derived = false; term.support = 'none';",
    to:   "      term.quote = null; term.page = null; term.confidence = null;\n      term.derived = false; term.support = 'none';" },
  { id: 'C04', file: T, why: 'the rejected reading is not kept',
    from: '      term.rejectedReading = _reading(term);',
    to:   '      term.rejectedReading = null;' },
  { id: 'C05', file: T, why: 'a later reading overwrites the entered value',
    from: "    if (isEnteredDecision(d) || (d.action === 'correct' && term.state === 'missing' && !d.source_document_id)) {",
    to:   "    if (term.state === 'missing' && (isEnteredDecision(d) || (d.action === 'correct' && !d.source_document_id))) {" },
  { id: 'C06', file: T, why: 'the conflict is never raised',
    from: '        term.enteredConflict = differs && !kept;',
    to:   '        term.enteredConflict = false;' },
  { id: 'C07', file: T, why: '"Keep" silences every later reading',
    from: '        var kept = differs && !docContested && d.previous_value != null && _sameValue(term.field, d.previous_value, doc.value);',
    to:   '        var kept = differs && !docContested && d.previous_value != null;' },
  { id: 'C08', file: T, why: 'the corrected value carries the replaced reading\'s clause',
    from: '      term.quote = quote || null;',
    to:   '      term.quote = quote || term.quote;' },
  { id: 'C09', file: T, why: 'the replaced reading is not kept',
    from: '      term.replacedReading = _reading(term);',
    to:   '      term.replacedReading = null;' },
  { id: 'C10', file: T, why: 'a reason is not recorded on a correction',
    from: '    if (reason && !payload.note) payload.note = reason;\n',
    to:   '' },
  { id: 'C11', file: T, why: 'an entry the type cannot hold is accepted',
    from: "      if (pv.error) return { ok: false, error: personError(payload.field_key, pv.error, payload.new_value) };\n      var typed = pv.value;\n",
    to:   "      var typed = pv.error ? payload.new_value : pv.value;\n" },
  { id: 'C12', file: L, why: 'the projection loses the flags',
    from: "      flags[f]   = t.rejected ? 'rejected' : t.enteredConflict ? 'entered_conflict' : null;",
    to:   '      flags[f]   = null;' },
  { id: 'C13', file: M, why: 'the matrix cell shows "Unclear", not "Rejected by a person"',
    from: '              : rejected              ? REJECTED_TEXT',
    to:   '              : false                 ? REJECTED_TEXT' },
  { id: 'C14', file: M, why: 'the sources CSV\'s Origin column is blank',
    from: "          c.column === 'tenant' ? '' : _origin(c, s),",
    to:   "          ''," },
  { id: 'C15', file: S, why: 'Save is enabled whatever was typed',
    from: '  save.disabled = !v.ok;',
    to:   '  save.disabled = false;' },
  { id: 'C16', file: S, why: 'Correct writes before checking the value',
    from: "  const v = _AT().validateTermInput(field, value);\n  if (!v.ok) { _acqTermEditorError(v.error); return null; }   // nothing is saved\n",
    to:   "  const v = { ok: true, stored: String(value) };\n" },
  { id: 'C17', file: S, why: 'Enter asks for a value on a converted review',
    from: "  const AT = _AT();\n  if (_acqRefuseFrozen(reviewId)) return null;   // P5-6A: before the person is asked for a value\n",
    to:   "  const AT = _AT();\n" },
  { id: 'C18', file: S, why: '"Keep my value" is offered on every entered term',
    from: '      const keep = term.enteredConflict\n',
    to:   '      const keep = true\n' },
  { id: 'C19', file: S, why: 'the editor is drawn on a converted review',
    from: '      const editing = !frozen && _acqTermEditor',
    to:   '      const editing = _acqTermEditor' },
  { id: 'C20', file: S, why: 'the decision history is not drawn',
    from: '  return `<details class="acq-term-history">',
    to:   "  return '' && `<details class=\"acq-term-history\">" },
  { id: 'C21', file: M, why: 'Needs attention does not list the conflict',
    from: "    { kind: 'entered_conflict', test: function (c) { return !!c.conflict; },",
    to:   "    { kind: 'entered_conflict', test: function (c) { return false; }," },
  { id: 'C22', file: M, why: 'the row\'s status does not ask for review',
    from: "    if (conflicts) return { kind: 'issues',",
    to:   "    if (false) return { kind: 'issues'," },
  { id: 'C23', file: T, why: 'a correction after a rejection forgets the reading it replaces',
    from: '    } else if (payload.previous_value === undefined && term && term.rejectedReading',
    to:   '    } else if (false && term.rejectedReading' },
  { id: 'C24', file: T, why: 'zero is refused for every figure',
    from: '      if (n === 0 && GREATER_THAN_ZERO[field]) return',
    to:   '      if (n === 0) return' },
  { id: 'C25', file: T, why: 'a leased area of zero is accepted',
    from: '      if (n === 0 && GREATER_THAN_ZERO[field]) return',
    to:   '      if (false) return' },
  { id: 'C26', file: T, why: 'a word for none is taken for a figure\'s value (zero)',
    from: "      if (_isNegativeWord(s) && !/^0+(\\.0+)?$/.test(s)) return { error: 'none_word' };\n",
    to:   "      if (_isNegativeWord(s)) return { value: 0 };\n" },
  { id: 'C27', file: T, why: 'a bare "None" is accepted with no clause behind it',
    from: "    if (meta.type === 'text' && meta.none && _isNegativeWord(",
    to:   "    if (false && _isNegativeWord(" },
  { id: 'C28', file: T, why: 'a negative figure is accepted',
    from: "      if (/^-/.test(c) || /^\\(.*\\)$/.test(c)) return { error: 'negative' };\n",
    to:   '' },
  { id: 'C29', file: T, why: 'the resolver reads an entered value by the AI rule',
    from: '      var entered = personValue(term.field, d.new_value).value;',
    to:   '      var entered = normalizeFieldValue(term.field, d.new_value, false);' },
  { id: 'C30', file: T, why: 'a sourceless correction is checked by the AI rule',
    from: '        var pc = personValue(payload.field_key, payload.new_value);',
    to:   "        var pc = (function (v) { return v === null || v === undefined ? { error: 'invalid' } : { value: v }; })(normalizeFieldValue(payload.field_key, payload.new_value, false));" },
  { id: 'C31', file: AR, why: 'the replaced reading is not carried to the report',
    from: '    if (t.replacedReading) fact.replaced = setAside(t.replacedReading);',
    to:   '' },
  { id: 'C32', file: AR, why: 'the rejected reading is not carried to the report',
    from: '    if (t.rejectedReading) fact.rejected = setAside(t.rejectedReading);',
    to:   '' },
  { id: 'C33', file: AR, why: 'the replaced clause is shown as the new value\'s Source',
    from: '    var noSource = (t.replacedReading && !t.quote) || t.rejected;',
    to:   '    var noSource = false;' },
  { id: 'C34', file: AV, why: 'the set-aside reading is not drawn',
    from: '        + setAsideHtml(f)\n',
    to:   '' },
  { id: 'C35', file: AV, why: 'it is drawn with the evidence\'s own label',
    from: "'Replaced reading', 'what the document read; not the support for this value'",
    to:   "'Source', 'what the document read; not the support for this value'" },
  { id: 'C36', file: H, why: 'the replaced value is not struck through',
    from: '    .acqr-setaside-value { text-decoration: line-through; }',
    to:   '    .acqr-setaside-value { }' },
  { id: 'C37', file: T, why: 'a correction quoting the clause it replaces keeps it as support',
    from: '      if (quote && term.quote && quote === _str(term.quote, QUOTE_MAX)) quote = null;\n',
    to:   '' },
  { id: 'C38', file: T, why: 'a correction quoting the clause it replaces keeps that clause\'s page',
    from: '      term.page  = quote ? _page(d.source_page) : null;',
    to:   '      term.page  = _page(d.source_page);' },
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'acq-term-entry-mut-'));
for (const entry of fs.readdirSync(ROOT)) {
  if (['node_modules', '.git', 'scratchpad', 'evidence', 'assets'].includes(entry)) continue;
  fs.cpSync(path.join(ROOT, entry), path.join(tmp, entry), { recursive: true });
}
try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(tmp, 'node_modules'), 'dir'); } catch (_) {}

const ORIGINAL = {};
[...new Set(MUTANTS.map(m => m.file))].forEach(f => { ORIGINAL[f] = fs.readFileSync(path.join(ROOT, f), 'utf8'); });
// The fast suites first: a mutant they kill never pays for a browser.
const SUITES = ['test-acquisition-term-safeguards.js', 'test-acquisition-decisions.js', 'test-acquisition-resolver.js',
                'test-acquisition-workspace.js', 'test-acquisition-report.js', 'test-acquisition-report-view.js',
                'test-e2e-acquisition-term-entry.js'];
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
