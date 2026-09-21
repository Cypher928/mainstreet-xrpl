'use strict';
/**
 * tools/acquisition-classification-mutation.js — would anyone notice if the
 * model started guessing?
 *
 *   node tools/acquisition-classification-mutation.js
 *
 * P1-3's rules are mostly rules about DECLINING: an amendment with no lease is
 * not placed, two families naming one tenant propose neither, a reading nobody
 * confirmed never reads as confirmed. A rule like that fails silently — the
 * product still works, it is just quietly wrong — so each one gets a mutant
 * that makes it guess, and a SURVIVOR is either a real gap or an equivalent
 * mutant that has to be argued for.
 *
 *   The model — acquisition-documents.js
 *     D01  the tier table stops matching LeaseIntelligence
 *     D02  an unrecognised type becomes 'other' instead of 'unknown'
 *     D03  an ambiguous tenant picks the first family
 *     D04  an amendment with no lease on file starts its own family
 *     D05  a rent roll is put in a leasehold
 *     D06  a confirmed status no longer needs a confirmer
 *     D07  a null confidence is stored as zero confidence
 *     D08  the audit trail is replaced instead of appended
 *     D09  a re-upload matches itself, so nothing is superseded
 *     D10  a third upload supersedes the first instead of the second
 *     D11  family order ignores the document tier
 *     D12  a replaced upload sorts as though it were current
 *     D13  a proposal describes itself as verified
 *     D14  an unfiled lease document is not flagged for review
 *     D15  a relationship is proposed when the family has two leases
 *     D16  a document filed in a vanished family is dropped from the screen
 *
 *   The data layer — script.js
 *     C01  the two writes of one upload get different identities
 *     C02  a re-upload replaces its predecessor again (D-14 regression)
 *     C03  the AI path writes a confirmation
 *     C04  a replacement inherits the confirmation with the family
 *     C05  classification is awaited before the source is stored
 *     C06  the classifier is given the file name to classify from
 *     C07  a correction does not name who made it
 *     C08  a corrected review-level type keeps its leasehold
 *
 *   The migration — migrations/024_*.sql
 *     M01  a confirmed classification no longer needs a confirmer
 *     M02  a document may be filed into another owner's family
 *     M03  the parent key stops being composite on the owner
 *     M04  deleting a family nulls the owner too
 *     M05  the identity of a document goes back to its file name
 *     M06  doc_type accepts anything
 *     M07  a document may supersede itself
 *     M08  the rollback destroys a preserved source to fit the old key
 *
 *   The prompt — api/_claude-tasks.js
 *     P01  the classifier is no longer told it may answer unknown
 *
 * A FAILING BASELINE IS NOT A PASS.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const D = 'acquisition-documents.js';
const S = 'script.js';
const M = 'migrations/024_acquisition_document_classification.sql';
const R = 'migrations/024_acquisition_document_classification_rollback.sql';
const T = 'api/_claude-tasks.js';

const MUTANTS = [
  // ── the model ────────────────────────────────────────────────────────────
  { id: 'D01', file: D, why: 'the tier table stops matching LeaseIntelligence',
    from: "    side_letter:         { label: 'Side Letter',           tier: 4, family: true  },",
    to:   "    side_letter:         { label: 'Side Letter',           tier: 1, family: true  }," },
  { id: 'D02', file: D, why: "an unrecognised type becomes 'other' instead of 'unknown'",
    from: "    doc_type:            function (v) { return v == null ? null : (DOC_TYPES[v] ? v : 'unknown'); },",
    to:   "    doc_type:            function (v) { return v == null ? null : (DOC_TYPES[v] ? v : 'other'); }," },
  { id: 'D03', file: D, why: 'an ambiguous tenant picks the first family',
    from: "    if (matches.length > 1) {\n      return { kind: 'none',\n               reason: 'More than one family names this tenant — which one is a decision for a person.' };\n    }",
    to:   "    if (matches.length > 1) {\n      return { kind: 'existing', familyId: matches[0].id, reason: 'first match' };\n    }" },
  { id: 'D04', file: D, why: 'an amendment with no lease on file starts its own family',
    from: "    if (type === 'original_lease') {\n      return { kind: 'new',",
    to:   "    if (type) {\n      return { kind: 'new'," },
  { id: 'D05', file: D, why: 'a rent roll is put in a leasehold',
    from: "    if (!isFamilyType(type)) {\n      return { kind: 'none', reason: docTypeLabel(type) + ' belongs to the review, not to a lease.' };\n    }",
    to:   "    if (false) {\n      return { kind: 'none', reason: docTypeLabel(type) + ' belongs to the review, not to a lease.' };\n    }" },
  { id: 'D06', file: D, why: 'a confirmed status no longer needs a confirmer',
    from: '    if (claims && !payload.confirmed_by) {',
    to:   '    if (false && claims && !payload.confirmed_by) {' },
  { id: 'D07', file: D, why: 'a null confidence is stored as zero confidence',
    from: "    if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null;",
    to:   "    if (v === undefined) return null;" },
  { id: 'D08', file: D, why: 'the audit trail is replaced instead of appended',
    from: '    var list = Array.isArray(existing) ? existing.slice() : [];',
    to:   '    var list = [];' },
  { id: 'D09', file: D, why: 'a re-upload matches itself, so nothing is superseded',
    from: '      return r && r.file_name === name && r.intake_id !== intakeId && isCurrent(r);',
    to:   '      return r && r.file_name === name && isCurrent(r);' },
  { id: 'D10', file: D, why: 'a third upload supersedes the first instead of the second',
    from: '    hits.sort(function (a, b) { return String(a.created_at) < String(b.created_at) ? 1 : -1; });',
    to:   '    hits.sort(function (a, b) { return String(a.created_at) < String(b.created_at) ? -1 : 1; });' },
  { id: 'D11', file: D, why: 'family order ignores the document tier',
    from: '      var td = docTypeTier(b.doc_type) - docTypeTier(a.doc_type);\n      if (td !== 0) return td;',
    to:   '      var td = 0;\n      if (td !== 0) return td;' },
  { id: 'D12', file: D, why: 'a replaced upload sorts as though it were current',
    from: '      var ca = isCurrent(a) ? 0 : 1, cb = isCurrent(b) ? 0 : 1;\n      if (ca !== cb) return ca - cb;',
    to:   '      var ca = 0, cb = 0;\n      if (ca !== cb) return ca - cb;' },
  { id: 'D13', file: D, why: 'a proposal describes itself as verified',
    from: '    var confirmed = CONFIRMED_STATUSES.indexOf(st) >= 0;',
    to:   '    var confirmed = true;' },
  { id: 'D14', file: D, why: 'an unfiled lease document is not flagged for review',
    from: "      if (!type || type === 'unknown' || (isFamilyType(type) && !filed)) { needsReview.push(d); return; }",
    to:   "      if (!type || type === 'unknown') { needsReview.push(d); return; }" },
  { id: 'D15', file: D, why: 'a relationship is proposed when the family has two leases',
    from: "    if (leases.length === 1) {",
    to:   "    if (leases.length >= 1) {" },
  { id: 'D16', file: D, why: 'a document filed in a vanished family is dropped from the screen',
    from: "    Object.keys(byFamily).forEach(function (k) {\n      byFamily[k].forEach(function (d) { needsReview.push(d); });\n    });",
    to:   "    Object.keys(byFamily).forEach(function (k) { void k; });" },

  // ── the data layer ───────────────────────────────────────────────────────
  { id: 'C01', file: S, why: 'the two writes of one upload get different identities',
    from: "        reviewId: review.id, fileName: file.name, intakeId, intakeKind: 'lease',\n        byteSize: file.size, contentType: file.type || null,\n        storagePath: storage.ref, extractedText: storedText || null,",
    to:   "        reviewId: review.id, fileName: file.name, intakeId: _acqMintIntakeId(), intakeKind: 'lease',\n        byteSize: file.size, contentType: file.type || null,\n        storagePath: storage.ref, extractedText: storedText || null," },
  { id: 'C02', file: S, why: 'a re-upload replaces its predecessor again (D-14 regression)',
    from: '    const replaced = docRow ? await _acqSupersedePrevious(review.id, file.name, intakeId, docRow.id) : null;',
    to:   '    const replaced = null;' },
  { id: 'C03', file: S, why: 'the AI path writes a confirmation',
    from: "    docTypeStatus: type === 'unknown' ? 'unclassified' : 'proposed',",
    to:   "    docTypeStatus: type === 'unknown' ? 'unclassified' : 'confirmed'," },
  { id: 'C04', file: S, why: 'a replacement inherits the confirmation with the family',
    from: "    fields.familyStatus = 'proposed';",
    to:   "    fields.familyStatus = opts.inheritedFamily ? 'confirmed' : 'proposed';" },
  { id: 'C05', file: S, why: 'classification is awaited before the source is stored',
    from: '      const saved = await _acqSaveDocument({',
    to:   '      await _acqClassifyDocument(leaseText, file.name);\n      const saved = await _acqSaveDocument({' },
  { id: 'C06', file: S, why: 'the classifier is given the file name to classify from',
    from: '        `File name (context only, do not classify from it): ${fileName || \'unknown\'}\\n\\n` +',
    to:   '        `File name: ${fileName || \'unknown\'}\\n\\n` +' },
  { id: 'C07', file: S, why: 'a correction does not name who made it',
    from: "    docType: nextType, docTypeStatus: 'corrected', docTypeSource: 'human',\n    docTypeConfidence: null,\n    confirmedBy: user.id, confirmedAt: new Date().toISOString(),",
    to:   "    docType: nextType, docTypeStatus: 'proposed', docTypeSource: 'human',\n    docTypeConfidence: null," },
  { id: 'C08', file: S, why: 'a corrected review-level type keeps its leasehold',
    from: '  if (!AD.isFamilyType(nextType) && row.family_id) {',
    to:   '  if (false && !AD.isFamilyType(nextType) && row.family_id) {' },

  // ── the migration ────────────────────────────────────────────────────────
  { id: 'M01', file: M, why: 'a confirmed classification no longer needs a confirmer',
    from: "     and new.confirmed_by is null then",
    to:   "     and false then" },
  { id: 'M02', file: M, why: "a document may be filed into another owner's family",
    from: '      foreign key (family_id, user_id)\n      references public.acquisition_document_families (id, user_id)\n      on delete set null (family_id);',
    to:   '      foreign key (family_id)\n      references public.acquisition_document_families (id)\n      on delete set null;' },
  { id: 'M03', file: M, why: 'the parent key stops being composite on the owner',
    from: '      foreign key (parent_document_id, user_id)\n      references public.acquisition_documents (id, user_id)\n      on delete set null (parent_document_id);',
    to:   '      foreign key (parent_document_id)\n      references public.acquisition_documents (id)\n      on delete set null;' },
  { id: 'M04', file: M, why: 'deleting a family nulls the owner too',
    from: '      on delete set null (family_id);',
    to:   '      on delete set null;' },
  { id: 'M05', file: M, why: 'the identity of a document goes back to its file name',
    from: 'alter table public.acquisition_documents\n  drop constraint if exists acquisition_documents_review_file_key;',
    to:   'select 1;' },
  { id: 'M06', file: M, why: 'doc_type accepts anything',
    from: "      check (doc_type is null or doc_type in (",
    to:   "      check (doc_type is null or true or doc_type in (" },
  { id: 'M07', file: M, why: 'a document may supersede itself',
    from: '      check (superseded_by_document_id is distinct from id);',
    to:   '      check (true);' },
  { id: 'M08', file: R, why: 'the rollback destroys a preserved source to fit the old key',
    from: '  if dupes = 0 then',
    to:   '  if true then' },

  // ── the prompt ───────────────────────────────────────────────────────────
  { id: 'P01', file: T, why: 'the classifier is no longer told it may answer unknown',
    from: '- If you are not confident, return "unknown". Do NOT pick the closest match.',
    to:   '- Choose the single best match for every document.' },
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'acq-cls-mut-'));
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
  ['node', 'test-acquisition-classification.js'],
  ['node', 'tools/verify-migration-024.js'],
  ['node', 'test-e2e-acquisition-classification.js'],
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
