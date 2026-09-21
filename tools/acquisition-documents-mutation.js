'use strict';
/**
 * tools/acquisition-documents-mutation.js — is every source really kept, and is
 * the table really the caller's to touch?
 *
 *   node tools/acquisition-documents-mutation.js
 *
 * Each mutant is a single, plausible edit to a rule P1-2 introduced — in the
 * write contract, in the data layer, in the intake, or in the migration itself. A SURVIVOR means the
 * suites would not have noticed the regression and is either a real gap or an
 * equivalent mutant that must be argued for.
 *
 *   The write contract — acquisition-documents.js
 *     D01  the write allow-list is bypassed — the fields go to the database
 *     D02  user_id is taken from the fields instead of the session
 *     D03  the list asks for the document text as well
 *     D04  a nameless document is accepted
 *     D05  the upsert key is dropped, so one file files twice
 *     D06  a missing table is not recognised
 *     D07  a missing REVIEWS table sends the operator to migration 023
 *     D08  unknown keys are forwarded to the database
 *     D09  a document with no review is built anyway
 *
 *   The data layer — script.js
 *     C01  the read is not scoped to the signed-in user
 *     C02  the list comes back newest first
 *     C03  the upsert loses its conflict key
 *     C04  the write asks the database for the document text back
 *     C05  a write that fails on a missing table says nothing
 *     C06  a read that fails on a missing table reads as "no documents"
 *     C07  the row is never shown until the review is re-opened
 *
 *   The intake — script.js
 *     G01  no row is written until the extraction has finished
 *     G02  a failed extraction leaves no row again
 *     G03  the row forgets where the original is
 *     G04  the size gate is skipped, so an unstored file claims to be stored
 *     G05  the panel renders no way to open the original
 *     G06  a missing table renders as "no documents"
 *     G07  opening a review no longer loads its documents
 *     G08  a scanned lease is filed with no text
 *     G09  the row stops naming what it produced
 *     G10  an invoice's original is not stored
 *
 *   The migration — migrations/023_*.sql
 *     M01  row-level security is never enabled
 *     M02  the owner policy lets everyone read everything
 *     M03  the owner is no longer tied to the review's owner
 *     M04  the same file can be filed twice on one review
 *     M05  parsing_status accepts anything
 *     M06  the rollback leaves its constraint behind
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
const M = 'migrations/023_acquisition_documents.sql';
const R = 'migrations/023_acquisition_documents_rollback.sql';

const MUTANTS = [
  // ── the write contract ───────────────────────────────────────────────────
  { id: 'D01', file: D, why: 'the write allow-list is bypassed',
    from: '      payload[snake] = WRITABLE[snake](f[camel]);',
    to:   '      payload[snake] = f[camel];' },
  { id: 'D02', file: D, why: 'user_id is taken from the fields instead of the session',
    from: '    var payload = { review_id: reviewId, user_id: userId };',
    to:   '    var payload = { review_id: reviewId, user_id: f.user_id || f.userId || userId };' },
  { id: 'D03', file: D, why: 'the list asks for the document text as well',
    from: "    'error_message', 'produced_kind', 'produced_id', 'created_at', 'updated_at',",
    to:   "    'error_message', 'produced_kind', 'produced_id', 'created_at', 'updated_at', 'extracted_text'," },
  { id: 'D04', file: D, why: 'a nameless document is accepted',
    from: "    if (!payload.file_name) return { ok: false, error: 'fileName must be a non-empty string' };",
    to:   "    if (!payload.file_name) payload.file_name = 'untitled';" },
  { id: 'D05', file: D, why: 'the upsert key is dropped, so one file files twice',
    from: "  var CONFLICT_KEY = 'review_id,file_name';",
    to:   "  var CONFLICT_KEY = 'id';" },
  { id: 'D06', file: D, why: 'a missing table is not recognised',
    from: "    if (error.code === '42P01') return true;",
    to:   "    if (false) return true;" },
  // The defect the first mutation run surfaced, carried over from the endpoint
  // this module replaces: two different reads can meet an absent table, and
  // naming 023 when the reviews table is the missing one sends an operator to
  // the wrong file.
  { id: 'D07', file: D, why: 'a missing REVIEWS table sends the operator to migration 023',
    from: '    return MIGRATION_FOR[table] || MIGRATION_FOR.acquisition_documents;',
    to:   '    return MIGRATION_FOR.acquisition_documents;' },
  { id: 'D08', file: D, why: 'unknown keys are forwarded to the database',
    from: '    return { ok: true, payload: payload };',
    to:   '    return { ok: true, payload: Object.assign({}, f, payload) };' },
  { id: 'D09', file: D, why: 'a document with no review is built anyway',
    from: "    if (!reviewId) return { ok: false, error: 'Missing reviewId' };",
    to:   "    if (!reviewId) reviewId = 'unknown';" },

  // ── the data layer ───────────────────────────────────────────────────────
  { id: 'C01', file: S, why: 'the read is not scoped to the signed-in user',
    from: "      .eq('user_id', user.id)\n      .order('created_at', { ascending: true });",
    to:   "      .order('created_at', { ascending: true });" },
  // Anchored on the user filter above it: `.order('created_at', …)` alone
  // appears four times in script.js and three of them are other screens.
  { id: 'C02', file: S, why: 'the list comes back newest first',
    from: "      .eq('user_id', user.id)\n      .order('created_at', { ascending: true });",
    to:   "      .eq('user_id', user.id)\n      .order('created_at', { ascending: false });" },
  { id: 'C03', file: S, why: 'the upsert loses its conflict key',
    from: "      .upsert(built.payload, { onConflict: _AD().CONFLICT_KEY })\n      .select(_AD().LIST_SELECT);",
    to:   "      .upsert(built.payload)\n      .select(_AD().LIST_SELECT);" },
  { id: 'C04', file: S, why: 'the write asks the database for the document text back',
    from: "      .upsert(built.payload, { onConflict: _AD().CONFLICT_KEY })\n      .select(_AD().LIST_SELECT);",
    to:   "      .upsert(built.payload, { onConflict: _AD().CONFLICT_KEY })\n      .select('*');" },
  { id: 'C05', file: S, why: 'a write that fails on a missing table says nothing',
    from: "      if (_AD().isMissingTable(error)) { _acqDocsMissing('acquisition_documents', { toast: true }); return null; }",
    to:   "      if (_AD().isMissingTable(error)) { return null; }" },
  { id: 'C06', file: S, why: 'a read that fails on a missing table reads as "no documents"',
    from: "      if (_AD().isMissingTable(error)) { _acqDocsMissing('acquisition_documents'); return []; }",
    to:   "      if (_AD().isMissingTable(error)) { return []; }" },
  { id: 'C07', file: S, why: 'the row is never shown until the review is re-opened',
    from: '    if (row) _acqDocCache(fields.reviewId, row);',
    to:   '    if (row) void row;' },

  // ── the intake ───────────────────────────────────────────────────────────
  { id: 'G01', file: S, why: 'no row is written until the extraction has finished',
    from: "    const docRow = await _acqSaveDocument({\n      reviewId: review.id, fileName: file.name, intakeKind: 'lease',\n      byteSize: file.size, contentType: file.type || null, parsingStatus: 'pending',\n    });\n    if (docRow) placeholder._documentId = docRow.id;",
    to:   "    const docRow = null;" },
  { id: 'G02', file: S, why: 'a failed extraction leaves no row again',
    from: "      await _acqSaveDocument({\n        reviewId: review.id, fileName: file.name, intakeKind: 'lease',\n        byteSize: file.size, contentType: file.type || null,\n        storagePath: storage.ref, parsingStatus: 'failed',",
    to:   "      await Promise.resolve({\n        reviewId: review.id, fileName: file.name, intakeKind: 'lease',\n        byteSize: file.size, contentType: file.type || null,\n        storagePath: storage.ref, parsingStatus: 'failed'," },
  { id: 'G03', file: S, why: 'the row forgets where the original is',
    from: "        storagePath: storage.ref, extractedText: storedText || null,",
    to:   "        storagePath: null, extractedText: storedText || null," },
  { id: 'G04', file: S, why: 'the size gate is skipped, so an unstored file claims to be stored',
    from: "  if (!_L || !_v.ok) {\n    const reason = _v ? _v.error : 'request-limits.js is not loaded';",
    to:   "  if (false) {\n    const reason = _v ? _v.error : 'request-limits.js is not loaded';" },
  { id: 'G05', file: S, why: 'the panel renders no way to open the original',
    from: "    const opener   = r.storage_path && window.docLinkHtml",
    to:   "    const opener   = false && window.docLinkHtml" },
  { id: 'G06', file: S, why: 'a missing table renders as "no documents"',
    from: "  if (_acqDocsUnavailable) {\n    el.innerHTML = '<div class=\"acq-docs-warn\">",
    to:   "  if (false) {\n    el.innerHTML = '<div class=\"acq-docs-warn\">" },
  { id: 'G07', file: S, why: 'opening a review no longer loads its documents',
    from: "  _acqLoadDocuments(id).then(() => { if (_activeAcqId === id) _renderAcqDocuments(); });",
    to:   "  void id;" },
  { id: 'G08', file: S, why: 'a scanned lease is filed with no text',
    from: "        visionTextPromise = extractTextFromPdfDirect(file).catch(e => {",
    to:   "        visionTextPromise = Promise.resolve(null).catch(e => {" },
  { id: 'G09', file: S, why: 'the row stops naming what it produced',
    from: "        producedKind: 'tenant', producedId: normalized.id || null,",
    to:   "        producedKind: null, producedId: null," },
  { id: 'G10', file: S, why: "an invoice's original is not stored",
    from: "      const [stored, d] = await Promise.all([\n        _acqStoreOriginal(file, review.id),\n        callClaude(file, 'invoice_extraction'),\n      ]);",
    to:   "      const [stored, d] = await Promise.all([\n        Promise.resolve({ ref: null, reason: null }),\n        callClaude(file, 'invoice_extraction'),\n      ]);" },

  // ── the migration ────────────────────────────────────────────────────────
  { id: 'M01', file: M, why: 'row-level security is never enabled',
    from: 'alter table public.acquisition_documents enable row level security;',
    to:   'alter table public.acquisition_documents disable row level security;' },
  { id: 'M02', file: M, why: 'the owner policy lets everyone read everything',
    from: '  using      (user_id = auth.uid())\n  with check (user_id = auth.uid());',
    to:   '  using      (true)\n  with check (true);' },
  { id: 'M03', file: M, why: "the owner is no longer tied to the review's owner",
    from: '    foreign key (review_id, user_id)\n    references public.acquisition_reviews (id, user_id)',
    to:   '    foreign key (review_id)\n    references public.acquisition_reviews (id)' },
  { id: 'M04', file: M, why: 'the same file can be filed twice on one review',
    from: '  constraint acquisition_documents_review_file_key unique (review_id, file_name)',
    to:   '  constraint acquisition_documents_review_file_key_disabled check (true)' },
  { id: 'M05', file: M, why: 'parsing_status accepts anything',
    from: "  parsing_status   text        not null default 'pending'\n                     check (parsing_status in ('pending', 'success', 'partial', 'failed')),",
    to:   "  parsing_status   text        not null default 'pending',", },
  { id: 'M06', file: R, why: 'the rollback leaves its constraint behind',
    from: 'alter table public.acquisition_reviews\n  drop constraint if exists acquisition_reviews_id_user_id_key;',
    to:   'select 1;' },
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'acq-doc-mut-'));
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
  ['node', 'test-acquisition-documents.js'],
  ['node', 'tools/verify-migration-023.js'],
  ['node', 'test-e2e-acquisition-documents.js'],
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
