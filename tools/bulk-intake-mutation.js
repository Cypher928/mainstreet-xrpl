'use strict';
/**
 * tools/bulk-intake-mutation.js — would anyone notice if a Bulk Intake fix
 * (B1–B5) were undone?
 *
 *   node tools/bulk-intake-mutation.js
 *
 * Each mutant undoes ONE part of the fix, and test-bulk-intake.js,
 * test-e2e-bulk-retry-input.js or test-lease-job-lifecycle.js must fail for
 * every one.
 *
 *   B5 — a document that is not a new lease is held, not created
 *     M01  the document-type hold is ignored (only A-2 candidates hold)
 *     M02  every recognised type may become a new leasehold
 *     M03  "unknown" may become a new leasehold (fails open)
 *     M04  the classification is skipped — every upload reads as a lease
 *     M05  an unrecognised type, or no vocabulary, reads as a lease
 *
 *   B1 — retry has its own input
 *     M06  the retry borrows the Upload Leases control
 *     M07  a retry pick arms the Upload Leases control (the old hijack)
 *
 *   B2 — retry goes through the protected pipeline
 *     M08  retryLeaseJob re-reads a persisted leasehold in place
 *     M09  Retry on a leasehold re-reads it in place instead of a new upload
 *     M10  the retry skips the pipeline
 *     M11  a retry file chosen after another property was opened is accepted
 *
 *   B4 — a successful retry is persisted
 *     M12  the retry saves the property but neither syncs nor flushes
 *     M13  the retry mints a new document id (a second register row)
 *
 *   B3 — a job not in memory is updated by id
 *     M14  it goes back to an upsert of { id, … }
 *     M15  the update carries id / property_id
 *     M16  the update by id becomes an upsert
 *
 * Not mutated, and why: the order "classify, then read the roster" — moving
 * the await after the candidates are read changes nothing a single-threaded
 * test can observe without a second batch racing the first; the batch-of-two
 * suites in test-lease-upload-identity.js cover that ordering's purpose.
 *
 * Applied to a COPY; the working tree is never touched.
 * A FAILING BASELINE IS NOT A PASS.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const S = 'script.js';

const MUTANTS = [
  // ── B5 ──────────────────────────────────────────────────────────────────
  { id: 'M01', file: S, why: 'the document-type hold is ignored (only A-2 candidates hold)',
    from: 'const _held       = _candidates.length > 0 || !!(_docGate && _docGate.hold);',
    to:   'const _held       = _candidates.length > 0;' },
  { id: 'M02', file: S, why: 'every recognised type may become a new leasehold',
    from: "  if (docType === 'original_lease') return { ...out, hold: false, reason: null };",
    to:   "  if (docType !== 'unknown') return { ...out, hold: false, reason: null };" },
  { id: 'M03', file: S, why: '"unknown" may become a new leasehold (fails open)',
    from: "  if (docType === 'unknown')        return { ...out, hold: true,  reason: 'unclassified' };",
    to:   "  if (docType === 'unknown')        return { ...out, hold: false, reason: null };" },
  { id: 'M04', file: S, why: 'the classification is skipped — every upload reads as a lease',
    from: '      try { _reading = await _classifyLeaseUpload(_classText, file.name); } catch (_) { _reading = null; }',
    to:   "      _reading = { docType: 'original_lease' };" },
  { id: 'M05', file: S, why: 'an unrecognised type, or no vocabulary, reads as a lease',
    from: "  const docType = (types && raw && Object.prototype.hasOwnProperty.call(types, raw)) ? raw : 'unknown';",
    to:   "  const docType = (types && raw && Object.prototype.hasOwnProperty.call(types, raw)) ? raw : 'original_lease';" },
  // ── B1 ──────────────────────────────────────────────────────────────────
  { id: 'M06', file: S, why: 'the retry borrows the Upload Leases control',
    from: "  let el = document.getElementById('leaseRetryInput');",
    to:   "  let el = document.getElementById('bulkLeaseInput');" },
  { id: 'M07', file: S, why: 'a retry pick arms the Upload Leases control (the old hijack)',
    from: '  _leaseRetryPick = { propertyId, onFile };\n',
    to:   "  _leaseRetryPick = { propertyId, onFile };\n  { const b = document.getElementById('bulkLeaseInput'); if (b) b.onchange = function () { const f = this.files && this.files[0]; this.onchange = null; if (f) onFile(f); }; }\n" },
  // ── B2 ──────────────────────────────────────────────────────────────────
  { id: 'M08', file: S, why: 'retryLeaseJob re-reads a persisted leasehold in place',
    from: "  if (_persistableTenantRows([_r.rows[i]]).length) { console.warn('[retryLeaseJob] refused: row is a persisted leasehold:', jobId); return; }\n",
    to:   '' },
  { id: 'M09', file: S, why: 'Retry on a leasehold re-reads it in place instead of a new upload',
    from: '  if (_persistableTenantRows([row]).length) {\n    // A leasehold: the file is a new upload, for A-2 to decide.',
    to:   '  if (false) {\n    // A leasehold: the file is a new upload, for A-2 to decide.' },
  { id: 'M10', file: S, why: 'the retry skips the pipeline',
    from: '  await _runLeaseJobPipeline(jobId, _retryQueue);',
    to:   '' },
  { id: 'M11', file: S, why: 'a retry file chosen after another property was opened is accepted',
    from: '    if (activePropId !== pick.propertyId) {',
    to:   '    if (false) {' },
  // ── B4 ──────────────────────────────────────────────────────────────────
  { id: 'M12', file: S, why: 'the retry saves the property but neither syncs nor flushes',
    from: '    try { await _persistLeaseUploads(propertyId, prop, _retryQueue); }',
    to:   '    try { await saveProperty(prop); }' },
  { id: 'M13', file: S, why: 'the retry mints a new document id (a second register row)',
    from: '  if (!job._documentId && row.leaseDocumentId) job._documentId = row.leaseDocumentId;\n',
    to:   '' },
  // ── B3 ──────────────────────────────────────────────────────────────────
  { id: 'M14', file: S, why: 'a job not in memory goes back to an upsert of { id, … }',
    from: '    _updateJobRowById(jobId, { ...updates, updated_at: new Date().toISOString() }, opts);',
    to:   '    _syncJobToDb({ id: jobId, ...updates, updated_at: new Date().toISOString() }, opts);' },
  { id: 'M15', file: S, why: 'the update carries id / property_id',
    from: ".filter(([k]) => !k.startsWith('_') && k !== 'id' && k !== 'property_id'));",
    to:   ".filter(([k]) => !k.startsWith('_')));" },
  { id: 'M16', file: S, why: 'the update by id becomes an upsert',
    from: "    try { return Promise.resolve(db.from('lease_jobs').update(row).eq('id', jobId)); }",
    to:   "    try { return Promise.resolve(db.from('lease_jobs').upsert({ id: jobId, ...row })); }" },
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bulk-intake-mut-'));
for (const entry of fs.readdirSync(ROOT)) {
  if (['node_modules', '.git', 'scratchpad', 'evidence', 'assets'].includes(entry)) continue;
  fs.cpSync(path.join(ROOT, entry), path.join(tmp, entry), { recursive: true });
}
try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(tmp, 'node_modules'), 'dir'); } catch (_) {}
// test-bulk-intake.js §9 asks git about HEAD; the copy has no .git, so it is
// told where the real checkout is (the mutants never touch the files §9 reads).
const ENV = Object.assign({}, process.env, { BULK_INTAKE_GIT_ROOT: ROOT });

const ORIGINAL = {};
[S].forEach(f => { ORIGINAL[f] = fs.readFileSync(path.join(ROOT, f), 'utf8'); });
// The fast suite first: a mutant it kills never pays for a browser.
const SUITES = ['test-bulk-intake.js', 'test-lease-job-lifecycle.js', 'test-e2e-bulk-retry-input.js'];
function runSuites() {
  for (const suite of SUITES) {
    try { execFileSync(process.execPath, [suite], { cwd: tmp, stdio: 'pipe', timeout: 600000, env: ENV }); }
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
