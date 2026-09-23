'use strict';
/**
 * tools/acquisition-isolation-mutation.js — would anyone notice if one review's
 * work started landing in another again?
 *
 *   node tools/acquisition-isolation-mutation.js
 *
 * Each mutant undoes ONE part of the cross-review isolation fix — puts back a
 * read of the review on screen where the review the work belongs to is meant —
 * and test-e2e-acquisition-isolation.js must fail for every one.
 *
 *   Uploads — script.js
 *     I01  a lease upload appends to the list on screen
 *     I02  a lease upload saves the list on screen over its own review
 *     I03  an invoice upload appends to the list on screen
 *     I04  an invoice upload saves the list on screen over its own review
 *
 *   Analysis — script.js
 *     I05  the analysis draws its report into whichever review is open
 *
 *   Human acts — script.js
 *     I06  a term decision is filed against the review open after sign-in
 *     I07  confirming a type writes to the review open after sign-in
 *     I08  correcting a type writes to the review open after sign-in
 *     I09  beginning a leasehold creates it in the review open after sign-in
 *     I10  beginning a leasehold files the document in the review open after sign-in
 *     I11  a re-read writes to the review open after the text is fetched
 *
 *   The Lease Terms panel on navigation — script.js
 *     T01  a review with no documents leaves the previous review's terms on screen
 *     T02  with the documents table missing, the previous review's terms stay
 *
 * Not mutated, and why: the guarded redraws inside the upload loops draw the
 * list of the review that is open — correct either way, so reverting the guard
 * changes nothing a reader can see.
 *
 * A FAILING BASELINE IS NOT A PASS.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const S = 'script.js';

const MUTANTS = [
  { id: 'I01', file: S, why: 'a lease upload appends to the list on screen',
    from: '    tenants.push(placeholder);\n    if (_acqIsActive(review)) _renderAcqLeaselist();',
    to:   '    _acqTenants.push(placeholder);\n    _renderAcqLeaselist();' },
  { id: 'I02', file: S, why: 'a lease upload saves the list on screen over its own review',
    from: "  review.data.tenants = tenants.filter(t => t._status !== 'error');",
    to:   "  review.data.tenants = _acqTenants.filter(t => t._status !== 'error');" },
  { id: 'I03', file: S, why: 'an invoice upload appends to the list on screen',
    from: '    invoices.push(placeholder);\n    if (_acqIsActive(review)) _renderAcqInvoiceList();',
    to:   '    _acqInvoices.push(placeholder);\n    _renderAcqInvoiceList();' },
  { id: 'I04', file: S, why: 'an invoice upload saves the list on screen over its own review',
    from: "  review.data.invoices = invoices.filter(i => i._status !== 'error' && i.amount);",
    to:   "  review.data.invoices = _acqInvoices.filter(i => i._status !== 'error' && i.amount);" },
  { id: 'I05', file: S, why: 'the analysis draws its report into whichever review is open',
    from: "    if (_acqIsActive(review)) {\n      _renderAcqReport(report, document.getElementById('acqReportContainer'));",
    to:   "    if (true) {\n      _renderAcqReport(report, document.getElementById('acqReportContainer'));" },
  { id: 'I06', file: S, why: 'a term decision is filed against the review open after sign-in',
    from: '    const built = _AT().buildDecisionPayload(reviewId, user.id, fields, term);',
    to:   '    const built = _AT().buildDecisionPayload(_activeAcqId, user.id, fields, term);' },
  { id: 'I07', file: S, why: 'confirming a type writes to the review open after sign-in',
    from: "    reviewId, intakeId: row.intake_id, fileName: row.file_name,\n    docType: row.doc_type, docTypeStatus: 'confirmed',",
    to:   "    reviewId: _activeAcqId, intakeId: row.intake_id, fileName: row.file_name,\n    docType: row.doc_type, docTypeStatus: 'confirmed'," },
  { id: 'I08', file: S, why: 'correcting a type writes to the review open after sign-in',
    from: "    reviewId, intakeId: row.intake_id, fileName: row.file_name,\n    docType: nextType,",
    to:   "    reviewId: _activeAcqId, intakeId: row.intake_id, fileName: row.file_name,\n    docType: nextType," },
  { id: 'I09', file: S, why: 'beginning a leasehold creates it in the review open after sign-in',
    from: '  const step = await _acqFamilyForHuman(reviewId, row, row.doc_type, { beginLeasehold: true });',
    to:   '  const step = await _acqFamilyForHuman(_activeAcqId, row, row.doc_type, { beginLeasehold: true });' },
  { id: 'I10', file: S, why: 'beginning a leasehold files the document in the review open after sign-in',
    from: '    reviewId, intakeId: row.intake_id, fileName: row.file_name,\n    familyId: step.patch.familyId,',
    to:   '    reviewId: _activeAcqId, intakeId: row.intake_id, fileName: row.file_name,\n    familyId: step.patch.familyId,' },
  { id: 'I11', file: S, why: 'a re-read writes to the review open after the text is fetched',
    from: '  await _acqAbstractDocument(reviewId, row, text);',
    to:   '  await _acqAbstractDocument(_activeAcqId, row, text);' },
  { id: 'T01', file: S, why: "a review with no documents leaves the previous review's terms on screen",
    from: "    el.innerHTML = '<div class=\"acq-docs-empty\">No documents on file yet. Every lease and invoice uploaded above is kept here with its original.</div>';\n    _renderAcqTerms();\n    return;",
    to:   "    el.innerHTML = '<div class=\"acq-docs-empty\">No documents on file yet. Every lease and invoice uploaded above is kept here with its original.</div>';\n    return;" },
  { id: 'T02', file: S, why: "with the documents table missing, the previous review's terms stay",
    from: "      + 'Run <code>' + esc(gapFile) + '</code> in Supabase to keep the originals.</div>';\n    _renderAcqTerms();\n    return;",
    to:   "      + 'Run <code>' + esc(gapFile) + '</code> in Supabase to keep the originals.</div>';\n    return;" },
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'acq-iso-mut-'));
for (const entry of fs.readdirSync(ROOT)) {
  if (['node_modules', '.git', 'scratchpad', 'evidence', 'assets'].includes(entry)) continue;
  fs.cpSync(path.join(ROOT, entry), path.join(tmp, entry), { recursive: true });
}
try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(tmp, 'node_modules'), 'dir'); } catch (_) {}

const ORIGINAL = { [S]: fs.readFileSync(path.join(ROOT, S), 'utf8') };
const SUITES = [['node', 'test-e2e-acquisition-isolation.js']];
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
                'meaningless. Nothing is mutated. Fix the harness or the suite first.');
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(2);
}

let killed = 0;
const survived = [];
for (const m of MUTANTS) {
  const src = ORIGINAL[m.file];
  const i = src.indexOf(m.from);
  if (i === -1) { console.log(`  ??   ${m.id}  ANCHOR NOT FOUND — malformed mutant`); survived.push(m.id + ' (malformed)'); continue; }
  if (src.indexOf(m.from, i + 1) !== -1) {
    console.log(`  ??   ${m.id}  ANCHOR NOT UNIQUE — malformed mutant`); survived.push(m.id + ' (anchor not unique)'); continue;
  }
  fs.writeFileSync(path.join(tmp, m.file), src.slice(0, i) + m.to + src.slice(i + m.from.length));
  const passed = runSuites();
  fs.writeFileSync(path.join(tmp, m.file), src);
  if (!passed) { killed++; console.log(`  kill ${m.id}  ${m.why}`); continue; }
  survived.push(`${m.id}: ${m.why}`);
  console.log(`  LIVE ${m.id}  ${m.why}`);
}
console.log(`\n${killed}/${MUTANTS.length} killed`);
if (survived.length) { console.log('\nSURVIVORS:'); survived.forEach(s => console.log('  · ' + s)); }
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(survived.length ? 1 : 0);
