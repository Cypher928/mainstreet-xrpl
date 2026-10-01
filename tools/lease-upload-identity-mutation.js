'use strict';
/**
 * tools/lease-upload-identity-mutation.js — do the Step A-2 suites bite?
 *
 *   node tools/lease-upload-identity-mutation.js
 *
 * Step A-2: an uploaded lease that MAY belong to an existing leasehold is held
 * for a person; nothing is attached, and no evidence written, until they
 * decide; a vacancy never lends its id; a confirmed value is never changed
 * silently; the job writes only to its own property, by its own id; and a
 * document is identified by its own id — a same-named upload can never
 * re-point or unlink another leasehold's document. Each mutant below breaks
 * one leg of that. Every one must be caught.
 *
 * Applied to a COPY in a scratch directory; the working tree is never touched.
 * A FAILING BASELINE IS NOT A PASS.
 */
const fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const I = 'lease-upload-identity.js', S = 'script.js', A = 'api/lease-documents.js', N = 'tenant-normalize.js';

const MUTANTS = [
  // ── the rule: who may be a candidate ─────────────────────────────────────
  { id: 'U01', file: I, why: 'an ENDED leasehold becomes a candidate',
    from: "    if (!_LS().isCurrent(t)) return false;                      // ENDED is never a candidate\n", to: '' },
  { id: 'U02', file: I, why: 'a vacancy row becomes a candidate (and could lend its id)',
    from: "    if (t.vacant === true) return false;                        // a space, not a leasehold\n", to: '' },
  { id: 'U03', file: I, why: 'an in-flight placeholder becomes a candidate',
    from: "    if (t.status === 'pending') return false;                   // an upload still in flight\n", to: '' },
  { id: 'U04', file: I, why: 'fuzzy name matching (a shared prefix is a match)',
    from: 'var byName  = !!name  && normalizeName(t.tenant_name) === name;',
    to:   'var byName  = !!name  && normalizeName(t.tenant_name).slice(0, 6) === name.slice(0, 6);' },
  { id: 'U05', file: I, why: 'the upload may propose itself',
    from: "if (o.excludeId != null && String(t.id) === String(o.excludeId)) return;", to: '' },
  { id: 'U06', file: I, why: 'a human-confirmed value is changed silently',
    from: '      if (isHumanConfirmed(target, fk)) {', to: '      if (false) {' },
  { id: 'U07', file: I, why: 'an Original Lease Copy rewrites a leasehold that already has its lease',
    from: '      if (fillOnly) return;\n', to: '' },
  // ── the pipeline: hold, do not attach ───────────────────────────────────
  { id: 'U08', file: S, why: 'a UNIQUE candidate is not held (the old auto-attach boundary)',
    from: 'const _held       = _candidates.length > 0 || !!(_docGate && _docGate.hold);', to: 'const _held       = _candidates.length > 1 || !!(_docGate && _docGate.hold);' },
  { id: 'U09', file: S, why: 'a held upload\'s evidence is written against its first candidate before any decision',
    from: '    if (!_held) {\n      try {\n        // No source_document_id here: the register row is written after the\n        // batch (it names the tenant row, which must exist first), and the\n        // lineage column is a foreign key to it.\n        _persistExtractedEvidence(propertyId, _linkedTenantId, finalEntry.fieldEvidence);',
    to:   '    if (true) {\n      try {\n        _persistExtractedEvidence(propertyId, _linkedTenantId || (_candidates[0] || {}).id, finalEntry.fieldEvidence);' },
  { id: 'U10', file: S, why: 'a held upload\'s register row is linked to its first candidate',
    from: 'const _linkedTenantId = _held ? null : finalEntry.id;', to: 'const _linkedTenantId = _held ? _candidates[0].id : finalEntry.id;' },
  { id: 'U11', file: S, why: 'a held upload is left in the roster',
    from: '      _dropLeaseJobRow(propertyId, jobId);\n      _holdLeaseUpload(propertyId, {', to: '      _holdLeaseUpload(propertyId, {' },
  { id: 'U12', file: S, why: 'D2: a lease for a vacant suite takes the vacancy row\'s id',
    from: '      _putLeaseJobRow(propertyId, jobId, finalEntry);\n      _retireVacanciesFor(propertyId, finalEntry, jobId);',
    to:   '      const _vac = _LUI.vacanciesFor(_roster.rows, finalEntry)[0];\n      if (_vac) { _dropLeaseJobRow(propertyId, jobId); finalEntry.id = _vac; const _vi = _roster.rows.findIndex(t => t && t.id === _vac); _roster.rows[_vi] = finalEntry; if (_roster.live && _roster.prop) _roster.prop.tenants = [...tenantData]; }\n      else _putLeaseJobRow(propertyId, jobId, finalEntry);' },
  { id: 'U13', file: S, why: 'the vacancy a new lease fills is not retired',
    from: '      _putLeaseJobRow(propertyId, jobId, finalEntry);\n      _retireVacanciesFor(propertyId, finalEntry, jobId);',
    to:   '      _putLeaseJobRow(propertyId, jobId, finalEntry);' },
  { id: 'U13b', file: S, why: 'a failed extraction on a vacant suite retires the vacancy',
    from: '  if (!entry || entry.extractionFailed || !entry.tenant_name) return [];', to: '  if (!entry) return [];' },
  { id: 'U14', file: S, why: 'the held record is not saved with the property',
    from: '      pendingLeaseUploads: Array.isArray(stripped.pendingLeaseUploads) ? stripped.pendingLeaseUploads : [],',
    to:   '      pendingLeaseUploads: [],' },
  { id: 'U15', file: S, why: 'a reload drops the held uploads the database holds',
    from: '        pendingLeaseUploads: Array.isArray(d.pendingLeaseUploads) ? d.pendingLeaseUploads : [],',
    to:   '        pendingLeaseUploads: [],' },
  // ── the decision ────────────────────────────────────────────────────────
  { id: 'U16', file: S, why: 'a conflict with a confirmed value is attached without a person',
    from: '  if (plan.unresolved.length) {', to: '  if (false) {' },
  { id: 'U17', file: S, why: 'any leasehold may take the upload, not only a current candidate',
    from: '|| !nowCandidates.some(c => c.id === target.id)) {', to: ') {' },
  { id: 'U18', file: S, why: 'the document kind need not be confirmed',
    from: "  if (!LUI.isKind(o.kind)) return { ok: false, error: 'kind_required' };\n", to: '' },
  { id: 'U19', file: S, why: 'attach gives the leasehold a new id',
    from: '    const next = { ...updatedTenant, id: target.id };', to: '    const next = { ...updatedTenant, id: heldId };' },
  { id: 'U20', file: S, why: 'attach writes evidence for fields the person kept',
    from: '    fields.forEach(fk => { if (inc.fieldEvidence && inc.fieldEvidence[fk]) ev[fk] = inc.fieldEvidence[fk]; });',
    to:   '    Object.assign(ev, inc.fieldEvidence || {});' },
  { id: 'U21', file: S, why: 'a confirmed value replaced by a person is not recorded as a human decision',
    from: '    if (confirmedChanges.length) {', to: '    if (false) {' },
  { id: 'U22', file: S, why: 'the merge ignores the plan and takes every differing field',
    from: "    const { updatedTenant } = _amendmentMerge(target, inc, heldId, held.fileName, docMeta, fields,",
    to:   "    const { updatedTenant } = _amendmentMerge(target, inc, heldId, held.fileName, docMeta, null," },
  { id: 'U23', file: S, why: 'create gives the new lease a candidate\'s id',
    from: '        row = { ...inc, id: heldId,', to: '        row = { ...inc, id: (held.candidates[0] || {}).id || heldId,' },
  // ── replay ──────────────────────────────────────────────────────────────
  { id: 'U24', file: S, why: 'a decided upload is not recognised in the record (amendment entry)',
    from: '(Array.isArray(t.amendments) && t.amendments.some(a => a && a.amendmentId === heldId))', to: 'false' },
  { id: 'U25', file: S, why: 'decisions in flight are not serialised (double click)',
    from: "  if (_heldInFlight.has(heldId)) return { ok: false, error: 'in_progress' };\n", to: '' },
  { id: 'U27', file: S, why: 'a retry mints a new document id (a second register row)',
    from: 'const documentId = job._documentId || (job._documentId = crypto.randomUUID());', to: 'const documentId = crypto.randomUUID();' },
  // ── scoping ─────────────────────────────────────────────────────────────
  { id: 'U28', file: S, why: 'a job writes to whatever property is on screen',
    from: '  if (propertyId && activePropId === propertyId) return { prop, rows: tenantData, live: true };',
    to:   '  return { prop, rows: tenantData, live: true };' },
  { id: 'U29', file: S, why: 'a job\'s row is appended rather than found by its id',
    from: '  if (i === -1) r.rows.push(row); else r.rows[i] = row;', to: '  r.rows.push(row);' },
  { id: 'U30', file: S, why: 'the batch saves the global buffer as its property\'s roster',
    from: '  target.tenants = dedupeTenants(_leaseJobRoster(propertyId, target).rows.filter(t => t !== null));',
    to:   '  target.tenants = dedupeTenants(tenantData.filter(t => t !== null));' },
  { id: 'U31', file: S, why: 'Add One Tenant clears the roster row at its slot index again',
    from: '  try { renderTenantUploadZone(i); } catch (_) {}', to: '  tenantData[i] = null;\n  try { renderTenantUploadZone(i); } catch (_) {}' },
  { id: 'U32', file: S, why: 'the roster dedupes by file name again (two "Lease.pdf" leaseholds collapse)',
    from: "const key = t.id || t.fileName || (t.tenant_name || '').toLowerCase().trim() || String(map.size);",
    to:   "const key = t.fileName || t.id || (t.tenant_name || '').toLowerCase().trim() || String(map.size);" },
  // ── document-link integrity ─────────────────────────────────────────────
  { id: 'U33', file: S, why: 'the register queue drops the document id',
    from: '    documentId:      w.documentId,\n', to: '' },
  { id: 'U34', file: S, why: 'saveLeaseDocument does not send the document id',
    from: 'body:    JSON.stringify({ propertyId, documentId, tenantId,', to: 'body:    JSON.stringify({ propertyId, tenantId,' },
  { id: 'U35', file: A, why: 'the file-name path takes over ANY same-named row',
    from: 'const own = wantTenant ? rows.find(r => r.tenant_id && String(r.tenant_id) === String(wantTenant)) : null;',
    to:   'const own = rows[0] || null;' },
  { id: 'U36', file: A, why: 'a linked document may be re-pointed to another leasehold',
    from: "      if (row && row.tenant_id && wantTenant && String(row.tenant_id) !== String(wantTenant)) {\n        console.warn",
    to:   "      if (false) {\n        console.warn" },
  { id: 'U37', file: A, why: 'a write without a tenant unlinks the document',
    from: '        if (!target.tenant_id && linkTenant) p.tenant_id = linkTenant;', to: '        p.tenant_id = linkTenant || null;' },
  { id: 'U38', file: A, why: 'the document id is ignored (back to file-name identity)',
    from: '    if (documentId) {\n      const found', to: '    if (false) {\n      const found' },
  { id: 'U39', file: A, why: 'a document of another property may be written through this one',
    from: 'if (row && String(row.property_id) !== String(propertyId)) {', to: 'if (false) {' },
  { id: 'U40', file: A, why: 'any doc_type is accepted as "confirmed"',
    from: 'if (docType != null && !LEASE_DOC_KINDS.includes(docType)) {', to: 'if (false) {' },
  { id: 'U41', file: A, why: 'a link-only write blanks the document text',
    from: "    if (extractedText   !== undefined) content.extracted_text   = extractedText || null;",
    to:   "    content.extracted_text = extractedText || null;" },
  { id: 'U42', file: A, why: 'a duplicate-key race on one document id fails instead of updating',
    from: 'if (result.status >= 300 && insertId && _isDuplicateKey(result.json)) {', to: 'if (false) {' },
  { id: 'U43', file: A, why: 'the confirmed kind is not attributed to a person',
    from: "Object.assign(content, { doc_type: docType, category: 'leases', classified_by: 'user' });",
    to:   "Object.assign(content, { doc_type: docType, category: 'leases', classified_by: 'ai' });" },
  { id: 'U45', file: S, why: 'a parked resync caller is released before its rows are written (the flush links to nothing)',
    from: '    return new Promise(resolve => state.waiters.push(resolve));', to: '    return;' },
  { id: 'U46', file: S, why: 'a resync run that throws leaves its parked callers waiting forever',
    from: '    left.forEach(w => w());', to: '' },
  { id: 'U44', file: N, why: 'a reload drops the document a leasehold was created from',
    from: '      leaseDocumentId:     d.leaseDocumentId     ?? null,\n', to: '' },
];

// EQUIVALENT — not run, and not counted. Each changes code no input can reach
// while the rest of the guard stands; recorded so the reasoning is on file.
//   create's "row already there?" check in resolveHeldLeaseUpload
//     (`let row = roster.rows.find(t => t && t.id === heldId) || null;` → `null`):
//     a leasehold with the held upload's id makes _heldUploadSettled true, and
//     that check returns before the create branch, so the lookup is defence in
//     depth only — G5 and G2b/G2c cover the replay it guards.
const EQUIVALENT = ['create row-exists check (see note)'];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'a2-mut-'));
fs.cpSync(ROOT, tmp, { recursive: true, filter: (src) => { const rel = path.relative(ROOT, src); return !(rel === '.git' || rel.startsWith('.git' + path.sep) || rel === 'node_modules' || rel.startsWith('node_modules' + path.sep)); } });
try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(tmp, 'node_modules'), 'dir'); } catch (_) {}
const ORIGINAL = {};
for (const f of [I, S, A, N]) ORIGINAL[f] = fs.readFileSync(path.join(ROOT, f), 'utf8');

const SUITES = ['test-lease-upload-identity.js', 'test-property-data-preservation.js', 'test-register-leasehold-link.js'];
function runSuites() {
  for (const suite of SUITES) {
    try { execFileSync(process.execPath, [suite], { cwd: tmp, stdio: 'pipe', timeout: 600000 }); }
    catch (_) { return suite; }
  }
  return null;
}

const baseline = runSuites();
console.log('Baseline (unmutated copy): ' + (baseline ? 'FAIL ' + baseline : 'PASS'));
if (baseline) { console.error('\nThe unmutated copy does not pass, so every result below would be meaningless. Nothing is mutated.'); fs.rmSync(tmp, { recursive: true, force: true }); process.exit(2); }

let killed = 0; const survivors = [];
for (const m of MUTANTS) {
  const src = ORIGINAL[m.file];
  if (src.indexOf(m.from) === -1) { console.log(`  ?  ${m.id} anchor not found in ${m.file} — the harness is stale, not the product`); survivors.push(m.id + ' (anchor missing)'); continue; }
  if (src.indexOf(m.from) !== src.lastIndexOf(m.from)) { console.log(`  ?  ${m.id} anchor is not unique in ${m.file}`); survivors.push(m.id + ' (anchor ambiguous)'); continue; }
  fs.writeFileSync(path.join(tmp, m.file), src.replace(m.from, m.to));
  const failedBy = runSuites();
  fs.writeFileSync(path.join(tmp, m.file), ORIGINAL[m.file]);
  if (failedBy) { killed++; console.log(`  \x1b[32m☠\x1b[0m  ${m.id} killed by ${failedBy} — ${m.why}`); }
  else { survivors.push(m.id); console.log(`  \x1b[31m✗\x1b[0m  ${m.id} SURVIVED — ${m.why}`); }
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log('\n' + '─'.repeat(58));
console.log(`${killed} killed, ${survivors.length} survived of ${MUTANTS.length}`);
console.log(`${EQUIVALENT.length} equivalent mutant(s) recorded, not run: ${EQUIVALENT.join('; ')}`);
if (survivors.length) { survivors.forEach(s => console.log('  · ' + s)); process.exit(1); }
