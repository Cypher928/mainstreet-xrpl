'use strict';
/**
 * tools/acquisition-terms-mutation.js — would anyone notice if "missing"
 * quietly became "none"?
 *
 *   node tools/acquisition-terms-mutation.js
 *
 * P4-1's one rule that matters most fails silently: a normaliser that turns a
 * null into a zero, a prompt that stops saying so, a column default that says
 * 0 instead of {} — the product keeps working, the report just says the lease
 * has no cap when the lease said nothing. Each rule gets a mutant that breaks
 * it, and a SURVIVOR is either a real gap in the suites or an equivalent
 * mutant that has to be argued for in writing.
 *
 *   The module — acquisition-terms.js
 *     T01  null for a number field becomes 0
 *     T02  a negative word WITHOUT a quote becomes 0
 *     T03  a negative word WITH a quote stays null (the document's own "none" is lost)
 *     T04  "none" answers a yes/no question as false
 *     T05  an enum outside its list keeps the raw string
 *     T06  group A drifts from CANONICAL_FIELDS (a rename)
 *     T07  one of the nine approved fields is dropped
 *     T08  an unknown key from the model is stored
 *     T09  a missing field is omitted instead of recorded as null/null
 *     T10  a reading with no fields is `partial` rather than `failed`
 *     T11  values without quotes count as evidenced — `success` with nothing to show
 *     T12  a quote is not bounded
 *     T13  a page of 0 is a page
 *     T14  a confidence above 1 is kept
 *     T15  a rent roll is abstractable
 *     T16  an array offered as an entry is read as a value
 *
 *   The document model — acquisition-documents.js
 *     D01  `success` with no fields is accepted
 *     D02  `success` with no timestamp is accepted
 *     D03  the evidence column joins the list select
 *     D04  a missing 025 column is blamed on 024
 *     D05  a status outside the list is stored as given
 *
 *   The data layer — script.js
 *     C01  a rent roll is sent to the abstraction task
 *     C02  a failed read wipes the evidence the row had
 *     C03  the four columns are not written together — the status lands without its evidence
 *     C04  the document is read BEFORE it is classified (from the unclassified row)
 *     C05  a correction into a lease-family type does not re-read
 *     C06  a correction out of a lease family leaves it claiming to be read
 *     C07  the abstraction writes the terms it read into the tenant record (write-back)
 *     C08  the chip is shown on a rent roll
 *     C09  the prompt is no longer told the file name is context only
 *     C10  the text read for a re-read is not scoped to the owner
 *
 *   The migration — migrations/025_*.sql
 *     M01  `success` no longer needs its evidence
 *     M02  the status check accepts anything
 *     M03  the evidence column defaults to something other than the empty object
 *     M04  the rollback drops a 024 column too
 *
 *   The prompt — api/_claude-tasks.js
 *     P01  the prompt stops saying MISSING IS NOT NONE
 *     P02  a field is dropped from the prompt
 *     P03  the prompt no longer forbids inferring from the file name
 *
 * A FAILING BASELINE IS NOT A PASS.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const A = 'acquisition-terms.js';
const D = 'acquisition-documents.js';
const S = 'script.js';
const M = 'migrations/025_acquisition_abstraction.sql';
const R = 'migrations/025_acquisition_abstraction_rollback.sql';
const T = 'api/_claude-tasks.js';

const MUTANTS = [
  // ── the module ───────────────────────────────────────────────────────────
  { id: 'T01', file: A, why: 'null for a number field becomes 0',
    from: "    if (_isNil(v) || typeof v === 'boolean') return null;\n    if (typeof v === 'number') return isFinite(v) ? v : null;",
    to:   "    if (_isNil(v)) return 0;\n    if (typeof v === 'boolean') return null;\n    if (typeof v === 'number') return isFinite(v) ? v : null;" },
  { id: 'T02', file: A, why: 'a negative word WITHOUT a quote becomes 0',
    from: '    if (_isNegativeWord(v)) return hasQuote ? 0 : null;',
    to:   '    if (_isNegativeWord(v)) return 0;' },
  { id: 'T03', file: A, why: "a negative word WITH a quote stays null — the document's own \"none\" is lost",
    from: '    if (_isNegativeWord(v)) return hasQuote ? 0 : null;',
    to:   '    if (_isNegativeWord(v)) return null;' },
  { id: 'T04', file: A, why: '"none" answers a yes/no question as false',
    from: "      if (['false', 'no', 'n'].indexOf(s) >= 0) return false;",
    to:   "      if (['false', 'no', 'n', 'none'].indexOf(s) >= 0) return false;" },
  { id: 'T05', file: A, why: 'an enum outside its list keeps the raw string',
    from: "      if (values[i].toLowerCase() === s.toLowerCase()) return values[i];\n    }\n    return null;",
    to:   "      if (values[i].toLowerCase() === s.toLowerCase()) return values[i];\n    }\n    return s;" },
  { id: 'T06', file: A, why: 'group A drifts from CANONICAL_FIELDS (a rename)',
    from: "      'cap', 'cap_base_amount', 'admin_fee_pct', 'gross_up_pct', 'expense_stop',",
    to:   "      'cam_cap', 'cap_base_amount', 'admin_fee_pct', 'gross_up_pct', 'expense_stop'," },
  { id: 'T07', file: A, why: 'one of the nine approved fields is dropped',
    from: "      'assignment_consent', 'exclusive_use', 'co_tenancy',\n    ],",
    to:   "      'assignment_consent', 'exclusive_use',\n    ]," },
  { id: 'T08', file: A, why: 'an unknown key from the model is stored',
    from: '    var fields = {};\n    var evidenced = 0, valued = 0;',
    to:   '    var fields = {};\n    Object.keys(rawFields).forEach(function (k) { if (FIELDS.indexOf(k) < 0) fields[k] = normalizeEntry(k, rawFields[k]); });\n    var evidenced = 0, valued = 0;' },
  { id: 'T09', file: A, why: 'a missing field is omitted instead of recorded as null/null',
    from: '      var entry = normalizeEntry(f, rawFields[f]);\n      fields[f] = entry;',
    to:   '      var entry = normalizeEntry(f, rawFields[f]);\n      if (rawFields[f] !== undefined) fields[f] = entry;' },
  { id: 'T10', file: A, why: 'a reading with no fields is `partial` rather than `failed`',
    from: "      return { ok: false, status: 'failed', abstraction: null,",
    to:   "      return { ok: false, status: 'partial', abstraction: null," },
  { id: 'T11', file: A, why: 'values without quotes count as evidenced',
    from: '      if (entry.value !== null) { valued++; if (entry.quote) evidenced++; }',
    to:   '      if (entry.value !== null) { valued++; evidenced++; }' },
  { id: 'T12', file: A, why: 'a quote is not bounded',
    from: '    var quote = _str(o.quote, QUOTE_MAX);',
    to:   '    var quote = _str(o.quote, 100000);' },
  { id: 'T13', file: A, why: 'a page of 0 is a page',
    from: '    return (Number.isInteger(n) && n > 0) ? n : null;',
    to:   '    return (Number.isInteger(n) && n >= 0) ? n : null;' },
  { id: 'T14', file: A, why: 'a confidence above 1 is kept',
    from: '    return (isFinite(n) && n >= 0 && n <= 1) ? n : null;\n  }\n\n  /** One field\'s evidence entry',
    to:   '    return (isFinite(n) && n >= 0) ? n : null;\n  }\n\n  /** One field\'s evidence entry' },
  { id: 'T15', file: A, why: 'a rent roll is abstractable',
    from: "            'guaranty', 'side_letter', 'snda', 'estoppel'].indexOf(docType) >= 0;",
    to:   "            'guaranty', 'side_letter', 'snda', 'estoppel', 'rent_roll'].indexOf(docType) >= 0;" },
  { id: 'T16', file: A, why: 'an array offered as an entry is read as a value',
    from: "    var o = (raw && typeof raw === 'object') ? (Array.isArray(raw) ? { value: null } : raw) : { value: raw };",
    to:   "    var o = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : { value: raw };" },

  // ── the document model ───────────────────────────────────────────────────
  { id: 'D01', file: D, why: '`success` with no fields is accepted',
    from: "      if (!ev || typeof ev !== 'object' || !Object.prototype.hasOwnProperty.call(ev, 'fields') || !payload.abstracted_at) {",
    to:   "      if (!ev || typeof ev !== 'object' || !payload.abstracted_at) {" },
  { id: 'D02', file: D, why: '`success` with no timestamp is accepted',
    from: "      if (!ev || typeof ev !== 'object' || !Object.prototype.hasOwnProperty.call(ev, 'fields') || !payload.abstracted_at) {",
    to:   "      if (!ev || typeof ev !== 'object' || !Object.prototype.hasOwnProperty.call(ev, 'fields')) {" },
  { id: 'D03', file: D, why: 'the evidence column joins the list select',
    from: "    'abstraction_status', 'abstraction_model', 'abstracted_at',\n  ];",
    to:   "    'abstraction_status', 'abstraction_model', 'abstracted_at', 'abstracted_fields',\n  ];" },
  { id: 'D04', file: D, why: 'a missing 025 column is blamed on 024',
    from: '    return (col && MIGRATION_FOR_COLUMN[col]) || MIGRATION_FOR_COLUMNS;',
    to:   '    return MIGRATION_FOR_COLUMNS;' },
  { id: 'D05', file: D, why: 'a status outside the list is stored as given',
    from: "    abstraction_status: _oneOf(ABSTRACTION_STATUSES, 'pending'),",
    to:   "    abstraction_status: function (v) { return v; }," },

  // ── the data layer ───────────────────────────────────────────────────────
  { id: 'C01', file: S, why: 'a rent roll is sent to the abstraction task',
    from: "  if (!AT.isAbstractable(docRow.doc_type)) {\n    return _acqSaveDocument({ ...base, abstractionStatus: 'skipped' });\n  }",
    to:   "  if (false) {\n    return _acqSaveDocument({ ...base, abstractionStatus: 'skipped' });\n  }" },
  { id: 'C02', file: S, why: 'a failed read wipes the evidence the row had',
    from: "  if (!built.ok) {\n    return _acqSaveDocument({ ...base, abstractionStatus: 'failed' });\n  }",
    to:   "  if (!built.ok) {\n    return _acqSaveDocument({ ...base, abstractionStatus: 'failed', abstractedFields: {}, abstractedAt: null, abstractionModel: null });\n  }" },
  { id: 'C03', file: S, why: 'the status lands without its evidence',
    from: '    abstractedFields:  built.abstraction,\n    abstractionStatus: built.status,',
    to:   '    abstractionStatus: built.status,' },
  { id: 'C04', file: S, why: 'the document is read BEFORE it is classified, from the unclassified row',
    from: "      let classified = saved;\n      if (saved && storedText) {",
    to:   "      let classified = saved;\n      if (saved) await _acqAbstractDocument(review.id, saved, storedText);\n      if (saved && storedText) {" },
  { id: 'C05', file: S, why: 'a correction into a lease-family type does not re-read',
    from: '    if (isAbstractable && !wasAbstractable) {',
    to:   '    if (false && isAbstractable && !wasAbstractable) {' },
  { id: 'C06', file: S, why: 'a correction out of a lease family leaves it claiming to be read',
    from: "    } else if (!isAbstractable && row.abstraction_status !== 'skipped') {",
    to:   "    } else if (false) {" },
  { id: 'C07', file: S, why: 'the abstraction writes the terms it read into the tenant record',
    from: '  if (!built.ok) {\n    return _acqSaveDocument',
    to:   '  { const _t = _acqTenants.find(t => t._documentId === docRow.id); if (_t && built.ok && built.abstraction.fields.cap.value !== null) _t.cap = built.abstraction.fields.cap.value; }\n  if (!built.ok) {\n    return _acqSaveDocument' },
  { id: 'C08', file: S, why: 'the chip is shown on a rent roll',
    from: '    const termsChip = (abstractable && abs)',
    to:   '    const termsChip = (abs)' },
  { id: 'C09', file: S, why: 'the prompt is no longer told the file name is context only',
    from: "        `File name (context only, do not read terms from it): ${docRow.file_name || 'unknown'}\\n` +",
    to:   "        `File name: ${docRow.file_name || 'unknown'}\\n` +" },
  { id: 'C10', file: S, why: 'the text read for a re-read is not scoped to the owner',
    from: "      .select('id, extracted_text')\n      .eq('id', docId)\n      .eq('user_id', user.id)",
    to:   "      .select('id, extracted_text')\n      .eq('id', docId)" },

  // ── the migration ────────────────────────────────────────────────────────
  { id: 'M01', file: M, why: '`success` no longer needs its evidence',
    from: "      check (abstraction_status not in ('success', 'partial')\n             or (abstracted_fields ? 'fields' and abstracted_at is not null));",
    to:   "      check (true);" },
  { id: 'M02', file: M, why: 'the status check accepts anything',
    from: "      check (abstraction_status in ('pending', 'success', 'partial', 'failed', 'skipped'));",
    to:   "      check (abstraction_status is not null);" },
  { id: 'M03', file: M, why: 'the evidence column defaults to something other than the empty object',
    from: "  add column if not exists abstracted_fields  jsonb       not null default '{}'::jsonb,",
    to:   "  add column if not exists abstracted_fields  jsonb       not null default '{\"fields\":{}}'::jsonb," },
  { id: 'M04', file: R, why: 'the rollback drops a 024 column too',
    from: '  drop column if exists abstracted_at;',
    to:   '  drop column if exists abstracted_at,\n  drop column if exists classification_history;' },

  // ── the prompt ───────────────────────────────────────────────────────────
  { id: 'P01', file: T, why: 'the prompt stops saying MISSING IS NOT NONE',
    from: '- MISSING IS NOT NONE. If the document says nothing about a term, value is null and quote is null.',
    to:   '- If the document says nothing about a term, value is null and quote is null.' },
  { id: 'P02', file: T, why: 'a field is dropped from the prompt',
    from: '  co_tenancy                    string   — any co-tenancy condition and its remedy\n',
    to:   '' },
  { id: 'P03', file: T, why: 'the prompt no longer forbids inferring from the file name',
    from: '- Never infer anything from the file name. Read the document.',
    to:   '- Use the file name as a hint.' },
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'acq-terms-mut-'));
for (const entry of fs.readdirSync(ROOT)) {
  if (['node_modules', '.git', 'scratchpad', 'evidence', 'assets'].includes(entry)) continue;
  fs.cpSync(path.join(ROOT, entry), path.join(tmp, entry), { recursive: true });
}
try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(tmp, 'node_modules'), 'dir'); } catch (_) {}

const FILES = [...new Set(MUTANTS.map(m => m.file))];
const ORIGINAL = {};
for (const f of FILES) ORIGINAL[f] = fs.readFileSync(path.join(ROOT, f), 'utf8');

// Cheapest first: a mutant that dies in the contract suite never pays for the
// cluster or the browser.
const SUITES = [
  ['node', 'test-acquisition-terms.js'],
  ['node', 'tools/verify-migration-025.js'],
  ['node', 'test-e2e-acquisition-abstraction.js'],
];
function runSuites() {
  for (const [bin, suite] of SUITES) {
    try { execFileSync(bin, [suite], { cwd: tmp, stdio: 'pipe', timeout: 900000 }); }
    catch (_) { return false; }
  }
  return true;
}

const baseline = runSuites();
console.log('Baseline (unmutated copy): ' + (baseline ? 'PASS' : 'FAIL'));
if (!baseline) {
  console.error('\nThe unmutated copy does not pass, so every result below would be\n' +
                'meaningless. Nothing is mutated. Fix the harness or the suites first.');
  for (const [bin, suite] of SUITES) {
    try { execFileSync(bin, [suite], { cwd: tmp, stdio: 'pipe', timeout: 900000 }); }
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
