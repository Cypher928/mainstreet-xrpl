'use strict';
/**
 * tools/acquisition-resolver-mutation.js — would anyone notice if a term
 * started claiming to be more settled than it is?
 *
 *   node tools/acquisition-resolver-mutation.js
 *
 * P4-2's rules are almost all rules about REFUSING to conclude: a contradiction
 * is not resolved, a proposal is not verified, a figure the clause does not
 * state is not evidenced, a silence is not a zero. Every one of those fails
 * silently — the screen still fills with terms, they are just quietly wrong
 * about how much they can be trusted. So each gets a mutant that makes it
 * conclude, and a SURVIVOR is either a real gap or an equivalent mutant that
 * has to be argued for in writing.
 *
 *   The seam — lease-intelligence.js
 *     L01  the field list is accepted and then ignored
 *     L02  the default widens, so the owner-operator path reasons over all 27
 *     L03  the tier table is widened instead of mapped onto
 *
 *   Which documents speak — acquisition-terms.js
 *     R01  a superseded document is consulted again (D-14 regression)
 *     R02  a rent roll is allowed to set lease terms
 *     R03  a document that was never read is consulted
 *     R04  a null value is offered to the reasoner as a value
 *     R05  a renewal is mapped to the tier of an original lease
 *     R06  the private tier copy drifts from lease-intelligence.js
 *
 *   Does the clause say it — acquisition-terms.js
 *     S01  a derived figure is reported as stated
 *     S02  an explicit negative is reported as derived
 *     S03  numerals are read without their commas, so 65,000 stops matching
 *     S04  a non-numeric value with a quote is reported as derived
 *     S05  accounting parentheses stop being understood
 *
 *   The five states — acquisition-terms.js
 *     T01  a value with no clause reads as evidenced
 *     T02  a derived figure reads as evidenced
 *     T03  a clause with no readable value is dropped to missing
 *     T04  a missing term comes back as zero instead of null
 *     T05  a missing term is omitted from the answer entirely
 *
 *   Contradictions — acquisition-terms.js
 *     C01  contradictions are dropped from the term
 *     C02  a contradiction is auto-resolved to the governing value
 *     C03  the ceiling downgrades a contradiction into agreement
 *
 *   The ceiling — acquisition-terms.js
 *     E01  a proposed document allows a verified term
 *     E02  Confirm is offered on a document nobody has classified
 *     E03  a confirmed document with no clause still allows verified
 *     E04  the ceiling reads the best document rather than the governing one
 *
 *   Human decisions — acquisition-terms.js
 *     D01  a confirmation outranks the classification ceiling
 *     D02  the earliest decision wins instead of the latest
 *     D03  reopening is ignored and the old decision stands
 *     D04  a correction leaves a derived figure flagged derived
 *     D05  a rejection deletes what the document said
 *     D06  a decision on one field settles every field
 *     D07  a decision erases the contradiction it was made against
 *
 *   Lineage — acquisition-terms.js
 *     P01  the reasoner's answer is never cross-checked against the documents
 *     P02  superseded values are dropped, so lineage disappears
 *
 * A FAILING BASELINE IS NOT A PASS.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const A = 'acquisition-terms.js';
const L = 'lease-intelligence.js';

const MUTANTS = [
  // ── the seam ─────────────────────────────────────────────────────────────
  { id: 'L01', file: L, why: 'the field list is accepted and then ignored',
    from: "    const fields = (options && Array.isArray(options.fields) && options.fields.length)\n      ? options.fields : CANONICAL_FIELDS;",
    to:   "    const fields = CANONICAL_FIELDS;" },
  { id: 'L02', file: L, why: 'the default widens, so the owner-operator path reasons over all 27',
    from: "      ? options.fields : CANONICAL_FIELDS;",
    to:   "      ? options.fields : (options && options.fields) || CANONICAL_FIELDS.concat(['co_tenancy', 'guarantor_name']);" },
  { id: 'L03', file: L, why: 'the tier table is widened instead of mapped onto',
    from: "  const DOC_TYPE_TIER = { side_letter: 4, estoppel: 3, amendment: 2, original_lease: 1 };",
    to:   "  const DOC_TYPE_TIER = { side_letter: 4, estoppel: 3, amendment: 2, renewal: 2, original_lease: 1 };" },

  // ── which documents speak ────────────────────────────────────────────────
  { id: 'R01', file: A, why: 'a superseded document is consulted again (D-14 regression)',
    from: '    if (doc.superseded_by_document_id) return false;',
    to:   '    if (false) return false;' },
  { id: 'R02', file: A, why: 'a rent roll is allowed to set lease terms',
    from: '    if (!isAbstractable(doc.doc_type)) return false;',
    to:   '    if (false) return false;' },
  { id: 'R03', file: A, why: 'a document that was never read is consulted',
    from: "    if (doc.abstraction_status !== 'success' && doc.abstraction_status !== 'partial') return false;",
    to:   "    if (false) return false;" },
  { id: 'R04', file: A, why: 'a null value is offered to the reasoner as a value',
    from: "        if (e.value !== null && e.value !== undefined && e.value !== '') extracted[f] = e.value;",
    to:   "        extracted[f] = e.value;" },
  { id: 'R05', file: A, why: 'a renewal is mapped to the tier of an original lease',
    from: "    renewal:        'amendment',",
    to:   "    renewal:        'original_lease'," },
  { id: 'R06', file: A, why: 'the private tier copy drifts from lease-intelligence.js',
    from: "  var DEFAULT_TIER = { side_letter: 4, estoppel: 3, amendment: 2, original_lease: 1 };",
    to:   "  var DEFAULT_TIER = { side_letter: 1, estoppel: 3, amendment: 2, original_lease: 4 };" },

  // ── does the clause say it ───────────────────────────────────────────────
  { id: 'S01', file: A, why: 'a derived figure is reported as stated',
    from: "    return _numeralsIn(e.quote).indexOf(e.value) >= 0 ? 'stated' : 'derived';",
    to:   "    return 'stated';" },
  { id: 'S02', file: A, why: 'an explicit negative is reported as derived',
    from: "    if (e.value === 0 && NEGATIVE_CLAUSE.test(e.quote)) return 'stated';",
    to:   "    if (false) return 'stated';" },
  { id: 'S03', file: A, why: 'numerals are read without their commas, so 65,000 stops matching',
    from: "      var n = Number(m[0].replace(/[(),\\s]/g, ''));",
    to:   "      var n = Number(m[0].replace(/[()\\s]/g, ''));" },
  { id: 'S04', file: A, why: 'a non-numeric value with a quote is reported as derived',
    from: "    if (meta.type !== 'number' && meta.type !== 'money' && meta.type !== 'percent') return 'stated';",
    to:   "    if (false) return 'stated';" },
  { id: 'S05', file: A, why: 'accounting parentheses stop being understood',
    from: '      if (m[1] && m[2]) out.push(-n);',
    to:   '      if (false) out.push(-n);' },

  // ── the five states ──────────────────────────────────────────────────────
  { id: 'T01', file: A, why: 'a value with no clause reads as evidenced',
    from: "      else if (governing.support !== 'stated') term.state = 'unclear';",
    to:   "      else if (false) term.state = 'unclear';" },
  { id: 'T02', file: A, why: 'a derived figure reads as evidenced',
    from: "      else if (governing.support !== 'stated') term.state = 'unclear';",
    to:   "      else if (governing.support === 'none') term.state = 'unclear';" },
  { id: 'T03', file: A, why: 'a clause with no readable value is dropped to missing',
    from: '        if (history.length) {\n          var q = history[0];',
    to:   '        if (false) {\n          var q = history[0];' },
  { id: 'T04', file: A, why: 'a missing term comes back as zero instead of null',
    from: "      state: 'missing', value: null, quote: null, page: null, confidence: null,",
    to:   "      state: 'missing', value: 0, quote: null, page: null, confidence: null," },
  { id: 'T05', file: A, why: 'a missing term is omitted from the answer entirely',
    from: '        terms[field] = _applyDecision(term, decisions, byId);\n        continue;',
    to:   '        if (history.length) terms[field] = _applyDecision(term, decisions, byId);\n        continue;' },

  // ── contradictions ───────────────────────────────────────────────────────
  { id: 'C01', file: A, why: 'contradictions are dropped from the term',
    from: '        term.contradictions     = Array.isArray(fromReasoner.contradictions) ? fromReasoner.contradictions : [];',
    to:   '        term.contradictions     = [];' },
  { id: 'C02', file: A, why: 'a contradiction is auto-resolved to the governing value',
    from: "      if (term.contradictions.length)        term.state = 'conflicting';",
    to:   "      if (false)                            term.state = 'conflicting';" },
  // EQUIVALENT, and kept because the reason is worth writing down. Removing
  // `conflicting` from this guard changes nothing TODAY: STATE_STRENGTH has no
  // entry for it, so its strength reads 0, 0 is below every ceiling, and the
  // comparison returns the state unchanged anyway. The guard is there for the
  // day somebody adds `conflicting` to STATE_STRENGTH — at which point a
  // contradiction could be quietly capped into agreement. Defence in depth for
  // a future edit cannot be killed by a test against today's code, and
  // deleting the guard to score a kill would be trading a real safeguard for a
  // number.
  { id: 'C03', file: A, why: 'the ceiling downgrades a contradiction into agreement',
    equivalent: 'STATE_STRENGTH has no entry for `conflicting`, so its strength is 0 and no ceiling can cap it. '
              + 'The guard protects a future edit, not current behaviour, and no test against today\'s code can reach it.',
    from: "    if (state === 'conflicting' || state === 'missing') return state;",
    to:   "    if (state === 'missing') return state;" },

  // ── the ceiling ──────────────────────────────────────────────────────────
  { id: 'E01', file: A, why: 'a proposed document allows a verified term',
    from: "    return {\n      ceiling: 'ai_extracted',\n      canConfirm: false,",
    to:   "    return {\n      ceiling: 'verified',\n      canConfirm: true," },
  { id: 'E02', file: A, why: 'Confirm is offered on a document nobody has classified',
    from: "      canConfirm: false,\n      reason: 'The document this term comes from is '",
    to:   "      canConfirm: true,\n      reason: 'The document this term comes from is '" },
  { id: 'E03', file: A, why: 'a confirmed document with no clause still allows verified',
    from: "      return hasQuote\n        ? { ceiling: 'verified', canConfirm: true, reason: null }",
    to:   "      return true\n        ? { ceiling: 'verified', canConfirm: true, reason: null }" },
  { id: 'E04', file: A, why: 'the ceiling reads the best document rather than the governing one',
    from: '      var cap = classificationCeiling(byId[governing.documentId], !!governing.quote);',
    to:   "      var _best = history.filter(function (h) { return h.docStatus === 'confirmed' || h.docStatus === 'corrected'; })[0] || governing;\n      var cap = classificationCeiling(byId[_best.documentId], !!governing.quote);" },

  // ── human decisions ──────────────────────────────────────────────────────
  { id: 'D01', file: A, why: 'a confirmation outranks the classification ceiling',
    from: "    if (term.ceiling === 'verified') {\n      term.state = 'verified';\n    } else {",
    to:   "    if (true) {\n      term.state = 'verified';\n    } else {" },
  { id: 'D02', file: A, why: 'the earliest decision wins instead of the latest',
    from: '    var last = rows[rows.length - 1];',
    to:   '    var last = rows[0];' },
  { id: 'D03', file: A, why: 'reopening is ignored and the old decision stands',
    from: "    return last.action === 'reopen' ? null : last;",
    to:   "    return last;" },
  { id: 'D04', file: A, why: 'a correction leaves a derived figure flagged derived',
    from: "      term.support = 'stated';\n      term.derived = false;",
    to:   "      term.support = 'stated';" },
  { id: 'D05', file: A, why: 'a rejection deletes what the document said',
    from: "      term.state = 'unclear';\n      term.note = 'A person rejected this reading.",
    to:   "      term.state = 'unclear';\n      term.value = null;\n      term.note = 'A person rejected this reading." },
  { id: 'D06', file: A, why: 'a decision on one field settles every field',
    from: '      return r && r.field_key === field && DECISION_ACTIONS.indexOf(r.action) >= 0;',
    to:   '      return r && DECISION_ACTIONS.indexOf(r.action) >= 0;' },
  { id: 'D07', file: A, why: 'a decision erases the contradiction it was made against',
    from: "    if (d.action === 'correct') {\n      var quote = _str(d.source_quote, QUOTE_MAX);",
    to:   "    if (d.action === 'correct') {\n      term.contradictions = [];\n      var quote = _str(d.source_quote, QUOTE_MAX);" },

  // ── lineage ──────────────────────────────────────────────────────────────
  { id: 'P01', file: A, why: "the reasoner's answer is never cross-checked against the documents",
    from: '        if (String(fromReasoner.currentValue) !== String(governing.value)) term.lineageMismatch = true;',
    to:   '        if (false) term.lineageMismatch = true;' },
  { id: 'P02', file: A, why: 'superseded values are dropped, so lineage disappears',
    from: '      term.supersededValues = superseded;',
    to:   '      term.supersededValues = [];' },
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'acq-resolver-mut-'));
for (const entry of fs.readdirSync(ROOT)) {
  if (['node_modules', '.git', 'scratchpad', 'evidence', 'assets'].includes(entry)) continue;
  fs.cpSync(path.join(ROOT, entry), path.join(tmp, entry), { recursive: true });
}
try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(tmp, 'node_modules'), 'dir'); } catch (_) {}

const FILES = [...new Set(MUTANTS.map(m => m.file))];
const ORIGINAL = {};
for (const f of FILES) ORIGINAL[f] = fs.readFileSync(path.join(ROOT, f), 'utf8');

// Cheapest first. Both are pure Node; the resolver suite is the one that
// carries the state model, so it goes first.
const SUITES = [
  ['node', 'test-acquisition-resolver.js'],
  ['node', 'test-acquisition-terms.js'],
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
const equivalents = [];
for (const m of MUTANTS) {
  const src = ORIGINAL[m.file];
  const i = src.indexOf(m.from);
  if (i === -1) { console.log(`  ??   ${m.id}  ANCHOR NOT FOUND in ${m.file} — malformed mutant`); survived.push(m.id + ' (malformed)'); continue; }
  if (src.indexOf(m.from, i + 1) !== -1) console.log(`  ??   ${m.id}  ANCHOR NOT UNIQUE in ${m.file} — mutating only the first`);
  if (m.to === m.from) { console.log(`  ??   ${m.id}  NO-OP MUTANT`); survived.push(m.id + ' (no-op)'); continue; }
  fs.writeFileSync(path.join(tmp, m.file), src.slice(0, i) + m.to + src.slice(i + m.from.length));
  const passedM = runSuites();
  fs.writeFileSync(path.join(tmp, m.file), src);
  if (!passedM) { killed++; console.log(`  kill ${m.id}  ${m.why}`); continue; }
  // A mutant declared equivalent must ACTUALLY survive. One that dies was
  // never equivalent, and the note claiming it was is wrong — say so loudly
  // rather than letting a stale exemption sit in the file.
  if (m.equivalent) { equivalents.push(`${m.id}: ${m.equivalent}`); console.log(`  EQUIV ${m.id}  ${m.why}`); continue; }
  survived.push(`${m.id} (${m.file}): ${m.why}`);
  console.log(`  LIVE ${m.id}  ${m.why}`);
}

console.log(`\n${killed}/${MUTANTS.length - equivalents.length} killed` +
            (equivalents.length ? `, ${equivalents.length} documented equivalent` : ''));
if (equivalents.length) {
  console.log('\nEQUIVALENT — survives by design, with a written reason:');
  equivalents.forEach(s => console.log('  · ' + s));
}
if (survived.length) {
  console.log('\nSURVIVORS — each needs a written verdict (real gap or equivalent):');
  survived.forEach(s => console.log('  · ' + s));
}
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(survived.length ? 1 : 0);
