'use strict';
/**
 * tools/acquisition-decisions-mutation.js — would anyone notice if a human
 * decision quietly destroyed the evidence behind it?
 *
 *   node tools/acquisition-decisions-mutation.js
 *
 * P4-3 is almost entirely rules about NOT destroying things, and every one of
 * them fails silently. A rejection that deletes the reading still looks like a
 * working screen. A confirmation that ignores the classification gate still
 * shows a green chip. A correction that overwrites the document reads perfectly
 * until somebody asks what the lease actually said. So each rule gets a mutant
 * that breaks it quietly, and a SURVIVOR is either a real gap or an equivalent
 * mutant that has to be argued for in writing.
 *
 *   The gate — acquisition-terms.js
 *     G01  a confirmation ignores the classification ceiling
 *     G02  the gate is applied to reject and reopen as well, blocking them
 *     G03  a missing term can be confirmed
 *     G04  the actor is taken from the caller instead of the session
 *
 *   The decision contract — acquisition-terms.js
 *     W01  the value being replaced is not recorded
 *     W02  a correction with no value is accepted
 *     W03  an unknown action is accepted
 *     W04  the quote is not bounded
 *     W05  a page of zero is stored as a page
 *
 *   The overlay — acquisition-terms.js
 *     O01  a rejection erases the value the document gave
 *     O02  a rejection reads as an answer anyway
 *     O03  a reopen leaves the previous decision in force
 *     O04  the earliest decision wins
 *     O05  a correction leaves the derived flag set
 *     O06  a decision erases the contradiction it was made against
 *
 *   The screen — script.js
 *     U01  the controls are never disabled
 *     U02  a disabled control still fires its handler
 *     U03  the blocked reason is never shown
 *     U04  a missing term renders as an empty value instead of a sentence
 *     U05  a missing term offers Confirm
 *     U06  the derived warning is dropped
 *     U07  the contradiction is dropped from the row
 *     U08  the clause is dropped, so a verified value has no provenance
 *     U09  the terms panel is not refreshed with the documents
 *     U10  a null value is coerced to 0 by the formatter
 *
 *   The data layer — script.js
 *     D01  a decision is written with an upsert, so a second act overwrites
 *          the first
 *     D02  the decision write also stamps the document's abstraction columns
 *     D03  the decisions read is not scoped to the owner
 *     D04  the evidence read is not scoped to the owner
 *     D05  the evidence is written into the cached document row
 *     D06  the correction does not carry the value it replaces
 *
 *   The migration — migrations/026_*.sql
 *     M01  append-only stops refusing an UPDATE
 *     M02  append-only stops refusing a DELETE
 *     M03  a decision may name somebody else as its author
 *     M04  the action list accepts anything
 *     M05  a correction need not correct anything
 *     M06  the family key stops being composite on the owner
 *     M07  RLS is not enabled
 *     M08  the update guard stops pinning the action, so a decision is editable
 *     M09  D-17 is not widened, so needs_review is refused
 *
 *   D-17 — script.js
 *     R01  a reclassified document discards its relationship again
 *
 * A FAILING BASELINE IS NOT A PASS.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const A = 'acquisition-terms.js';
const S = 'script.js';
const M = 'migrations/026_acquisition_term_decisions.sql';

const MUTANTS = [
  // ── the gate ─────────────────────────────────────────────────────────────
  { id: 'G01', file: A, why: 'a confirmation ignores the classification ceiling',
    from: '      if (!term.canConfirm) {',
    to:   '      if (false) {' },
  { id: 'G02', file: A, why: 'the gate blocks reject and reopen too',
    from: "    if (payload.action === 'confirm' || payload.action === 'correct') {",
    to:   "    if (true) {" },
  { id: 'G03', file: A, why: 'a missing term can be confirmed',
    from: "      if (term.state === 'missing') {",
    to:   "      if (false) {" },
  { id: 'G04', file: A, why: 'the actor is taken from the caller instead of the session',
    from: '    payload.decided_by = userId;',
    to:   '    if (!payload.decided_by) payload.decided_by = userId;' },

  // ── the decision contract ────────────────────────────────────────────────
  { id: 'W01', file: A, why: 'the value being replaced is not recorded',
    from: '    if (payload.previous_value === undefined && term && term.value !== null && term.value !== undefined) {',
    to:   '    if (false) {' },
  { id: 'W02', file: A, why: 'a correction with no value is accepted',
    from: "    if (payload.action === 'correct' && !payload.new_value) {",
    to:   "    if (false) {" },
  { id: 'W03', file: A, why: 'an unknown action is accepted',
    from: "    action:             function (v) { return DECISION_ACTIONS.indexOf(v) >= 0 ? v : null; },",
    to:   "    action:             function (v) { return v; }," },
  { id: 'W04', file: A, why: 'the quote is not bounded',
    from: '    source_quote:       function (v) { return _str(v, QUOTE_MAX); },',
    to:   '    source_quote:       function (v) { return _str(v, 100000); },' },
  { id: 'W05', file: A, why: 'a page of zero is stored as a page',
    from: '    source_page:        _page,',
    to:   '    source_page:        function (v) { return v == null ? null : Number(v); },' },

  // ── the overlay ──────────────────────────────────────────────────────────
  { id: 'O01', file: A, why: 'a rejection erases the value the document gave',
    from: "      term.state = 'unclear';\n      term.note = 'A person rejected this reading.",
    to:   "      term.state = 'unclear';\n      term.value = null; term.quote = null;\n      term.note = 'A person rejected this reading." },
  { id: 'O02', file: A, why: 'a rejection reads as an answer anyway',
    from: "    if (d.action === 'reject') {",
    to:   "    if (false) {" },
  { id: 'O03', file: A, why: 'a reopen leaves the previous decision in force',
    from: "    return last.action === 'reopen' ? null : last;",
    to:   '    return last;' },
  { id: 'O04', file: A, why: 'the earliest decision wins',
    from: '    var last = rows[rows.length - 1];',
    to:   '    var last = rows[0];' },
  { id: 'O05', file: A, why: 'a correction leaves the derived flag set',
    from: "      term.support = 'stated';\n      term.derived = false;",
    to:   "      term.support = 'stated';" },
  { id: 'O06', file: A, why: 'a decision erases the contradiction it was made against',
    from: "    if (d.action === 'correct') {\n      var quote = _str(d.source_quote, QUOTE_MAX);",
    to:   "    if (d.action === 'correct') {\n      term.contradictions = [];\n      var quote = _str(d.source_quote, QUOTE_MAX);" },

  // ── the screen ───────────────────────────────────────────────────────────
  { id: 'U01', file: S, why: 'the controls are never disabled',
    from: "      const gate = term.canConfirm ? '' : ' disabled';",
    to:   "      const gate = '';" },
  { id: 'U02', file: S, why: 'a disabled control still fires its handler',
    from: '    if (!btn || btn.disabled) return;',
    to:   '    if (!btn) return;' },
  { id: 'U03', file: S, why: 'the blocked reason is never shown',
    from: "      const blocked = (!term.canConfirm && term.state !== 'missing')",
    to:   "      const blocked = (false)" },
  { id: 'U04', file: S, why: 'a missing term renders as an empty value instead of a sentence',
    from: "        ? `<span class=\"acq-term-missing\">${esc(term.state === 'missing'",
    to:   "        ? `<span class=\"acq-term-value\">${esc(term.state === 'zzz'" },
  { id: 'U05', file: S, why: 'a missing term offers Confirm',
    from: "      const actionable = term.state !== 'missing';",
    to:   '      const actionable = true;' },
  { id: 'U06', file: S, why: 'the derived warning is dropped',
    from: '      const derived = term.derived',
    to:   '      const derived = false' },
  { id: 'U07', file: S, why: 'the contradiction is dropped from the row',
    from: '      const conflict = (term.contradictions && term.contradictions.length)',
    to:   '      const conflict = (false)' },
  { id: 'U08', file: S, why: 'the clause is dropped, so a verified value has no provenance',
    from: '      const quote = term.quote',
    to:   '      const quote = false' },
  { id: 'U09', file: S, why: 'the terms panel is not refreshed with the documents',
    from: '  _acqBindDocControls(el);\n  _renderAcqTerms();',
    to:   '  _acqBindDocControls(el);' },
  { id: 'U10', file: S, why: 'a null value is coerced to 0 by the formatter',
    from: 'function _acqTermValue(term) {\n  const v = term.value;\n  if (v === null || v === undefined) return null;',
    to:   'function _acqTermValue(term) {\n  const v = term.value;\n  if (v === undefined) return null;\n  if (v === null) return String(0);' },

  // ── the data layer ───────────────────────────────────────────────────────
  { id: 'D01', file: S, why: 'a decision is written with an upsert, so a second act overwrites the first',
    from: "      .from('acquisition_term_decisions')\n      .insert(built.payload)",
    to:   "      .from('acquisition_term_decisions')\n      .upsert(built.payload, { onConflict: 'review_id,field_key' })" },
  { id: 'D02', file: S, why: "the decision write also stamps the document's abstraction columns",
    from: '    const row = Array.isArray(data) ? data[0] : null;\n    if (row) {\n      const rows = _acqDecisionRows(reviewId).slice();',
    to:   '    const row = Array.isArray(data) ? data[0] : null;\n    if (row && term && term.governingDocumentId) { _acqEvidence.delete(term.governingDocumentId); }\n    if (row) {\n      const rows = _acqDecisionRows(reviewId).slice();' },
  { id: 'D03', file: S, why: 'the decisions read is not scoped to the owner',
    from: "      .select(_AT().DECISION_SELECT)\n      .eq('review_id', reviewId)\n      .eq('user_id', user.id)",
    to:   "      .select(_AT().DECISION_SELECT)\n      .eq('review_id', reviewId)" },
  { id: 'D04', file: S, why: 'the evidence read is not scoped to the owner',
    from: "      .select('id, abstracted_fields')\n      .eq('review_id', reviewId)\n      .eq('user_id', user.id)",
    to:   "      .select('id, abstracted_fields')\n      .eq('review_id', reviewId)" },
  { id: 'D05', file: S, why: 'the evidence is written into the cached document row',
    // Anchored on the comment above it: the v2 report glue (P1-7) repeats the
    // same .map line, and an ambiguous anchor mutates whichever comes first.
    from: '    // resolver without writing it into the cached row.\n    .map(d => _acqEvidence.has(d.id) ? Object.assign({}, d, { abstracted_fields: _acqEvidence.get(d.id) }) : d);',
    to:   '    // resolver without writing it into the cached row.\n    .map(d => { if (_acqEvidence.has(d.id)) d.abstracted_fields = _acqEvidence.get(d.id); return d; });' },
  { id: 'D06', file: S, why: 'the correction does not carry the value it replaces',
    from: '    previousValue: term.value == null ? undefined : String(term.value),\n    sourceDocumentId: term.governingDocumentId || undefined }, term);',
    to:   '    sourceDocumentId: term.governingDocumentId || undefined }, term);' },

  // ── the migration ────────────────────────────────────────────────────────
  { id: 'M01', file: M, why: 'append-only stops refusing an UPDATE',
    from: "  raise exception 'acquisition_term_decisions is append-only: UPDATE is refused. Record a new decision instead.'\n    using errcode = 'restrict_violation';",
    to:   '  return new;' },
  { id: 'M02', file: M, why: 'append-only stops refusing a DELETE',
    from: "      raise exception 'acquisition_term_decisions is append-only: DELETE is refused. The history of a decision is not editable.'\n        using errcode = 'restrict_violation';",
    to:   '      return old;' },
  { id: 'M03', file: M, why: 'a decision may name somebody else as its author',
    from: '  if new.decided_by is distinct from new.user_id then',
    to:   '  if false then' },
  { id: 'M04', file: M, why: 'the action list accepts anything',
    from: "      check (action in ('confirm', 'correct', 'reject', 'reopen'));",
    to:   '      check (action is not null);' },
  { id: 'M05', file: M, why: 'a correction need not correct anything',
    from: "      check (action <> 'correct' or (new_value is not null and length(btrim(new_value)) > 0));",
    to:   '      check (true);' },
  { id: 'M06', file: M, why: 'the family key stops being composite on the owner',
    from: '      foreign key (family_id, user_id)\n      references public.acquisition_document_families (id, user_id)',
    to:   '      foreign key (family_id)\n      references public.acquisition_document_families (id)' },
  { id: 'M07', file: M, why: 'RLS is not enabled',
    from: 'alter table public.acquisition_term_decisions enable row level security;',
    to:   'select 1;' },
  { id: 'M08', file: M, why: 'the update guard stops pinning the action, so a decision is editable',
    from: '     and new.action        =            old.action',
    to:   '     and true' },
  { id: 'M09', file: M, why: 'D-17 is not widened, so needs_review is refused',
    from: "        or relationship_status in ('proposed', 'confirmed', 'needs_review'));",
    to:   "        or relationship_status in ('proposed', 'confirmed'));" },

  // ── D-17 ─────────────────────────────────────────────────────────────────
  { id: 'R01', file: S, why: 'a reclassified document discards its relationship again',
    from: "      fields.relationshipStatus = 'needs_review';",
    to:   '      fields.parentDocumentId = null; fields.relationship = null; fields.relationshipStatus = null;' },
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'acq-dec-mut-'));
for (const entry of fs.readdirSync(ROOT)) {
  if (['node_modules', '.git', 'scratchpad', 'evidence', 'assets'].includes(entry)) continue;
  fs.cpSync(path.join(ROOT, entry), path.join(tmp, entry), { recursive: true });
}
try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(tmp, 'node_modules'), 'dir'); } catch (_) {}

const FILES = [...new Set(MUTANTS.map(m => m.file))];
const ORIGINAL = {};
for (const f of FILES) ORIGINAL[f] = fs.readFileSync(path.join(ROOT, f), 'utf8');

// Cheapest first: the pure suite, then the cluster, then the browser.
const SUITES = [
  ['node', 'test-acquisition-decisions.js'],
  ['node', 'test-acquisition-resolver.js'],
  ['node', 'tools/verify-migration-026.js'],
  ['node', 'test-e2e-acquisition-terms.js'],
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
  // A non-unique anchor silently mutates the FIRST match, which may be code
  // the mutant was never about — and then "survived" means nothing. U10 did
  // exactly that on its first run. It is a malformed mutant, not a warning.
  if (src.indexOf(m.from, i + 1) !== -1) {
    console.log(`  ??   ${m.id}  ANCHOR NOT UNIQUE in ${m.file} — malformed mutant, it would test the wrong code`);
    survived.push(m.id + ' (anchor not unique)');
    continue;
  }
  if (m.to === m.from) { console.log(`  ??   ${m.id}  NO-OP MUTANT`); survived.push(m.id + ' (no-op)'); continue; }
  fs.writeFileSync(path.join(tmp, m.file), src.slice(0, i) + m.to + src.slice(i + m.from.length));
  const passedM = runSuites();
  fs.writeFileSync(path.join(tmp, m.file), src);
  if (!passedM) { killed++; console.log(`  kill ${m.id}  ${m.why}`); continue; }
  // An exemption must actually survive; one that dies was never equivalent.
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
