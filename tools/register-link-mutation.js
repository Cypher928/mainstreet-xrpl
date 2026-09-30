'use strict';
/**
 * tools/register-link-mutation.js — do the register-link suites bite?
 *
 *   node tools/register-link-mutation.js
 *
 * The 039 client/API change: a lease upload's register row names the tenant
 * row's REAL id, is written only after that row exists, is never lost when the
 * link is refused, and nothing deletes a tenant a document is linked to. Each
 * mutant is one edit that breaks one leg of that. Every one must be caught by
 * test-register-leasehold-link.js or, for behaviour only a real page shows, by
 * test-e2e-register-leasehold-link.js.
 *
 * Applied to a COPY in a scratch directory; the working tree is never touched.
 * A FAILING BASELINE IS NOT A PASS.
 */
const fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const S = 'script.js', A = 'api/lease-documents.js';

const MUTANTS = [
  // ── the id ───────────────────────────────────────────────────────────────
  { id: 'L01', file: S, why: 'the register goes back to the discarded norm.id',
    from: '      tenantId:        _linkedTenantId || null,', to: '      tenantId:        norm?.id || null,' },
  // Step A-2: a held upload's row names no tenant; every other names the job's own row.
  { id: 'L02', file: S, why: 'a held upload\'s register row names its own never-persisted id',
    from: '      tenantId:        _linkedTenantId || null,', to: '      tenantId:        finalEntry.id || null,' },
  { id: 'L03', file: S, why: 'the linked id goes back to the discarded norm.id',
    from: 'const _linkedTenantId = _held ? null : finalEntry.id;', to: 'const _linkedTenantId = _held ? null : norm?.id;' },
  { id: 'L04', file: S, why: 'evidence and register stop sharing one id',
    from: '_persistExtractedEvidence(propertyId, _linkedTenantId,', to: '_persistExtractedEvidence(propertyId, jobId,' },
  // ── the order ────────────────────────────────────────────────────────────
  { id: 'L05', file: S, why: 'the queue is ignored — every write goes out before the tenant rows',
    from: '    if (Array.isArray(registerQueue) && !_held) registerQueue.push(_registerWrite);\n    else _saveLeaseRegisterWrite(_registerWrite);',
    to:   '    _saveLeaseRegisterWrite(_registerWrite);' },
  { id: 'L06', file: S, why: 'bulk upload stops passing its queue',
    from: '_runLeaseJobPipeline(jobId, _registerQueue)', to: '_runLeaseJobPipeline(jobId)' },
  { id: 'L07', file: S, why: 'the queue is flushed BEFORE the roster write',
    from: '  try {\n    await saveProperty(target);\n    // Exclude failed extractions',
    to:   '  await _flushLeaseRegisterWrites(_registerQueue);\n  try {\n    await saveProperty(target);\n    // Exclude failed extractions' },
  { id: 'L08', file: S, why: 'the flush is no longer in a finally — a failed save drops the documents',
    from: '  } finally {\n    // The register rows, now that', to: '  } catch (_e) {\n    // The register rows, now that' },
  { id: 'L09', file: S, why: 'the retry path gets a queue nobody flushes — its document is never written',
    from: 'await _runLeaseJobPipeline(jobId);', to: 'await _runLeaseJobPipeline(jobId, []);' },
  // ── the queue helpers ────────────────────────────────────────────────────
  { id: 'L10', file: S, why: 'the flush goes out all at once',
    from: '  for (const w of pending) await _saveLeaseRegisterWrite(w);', to: '  await Promise.all(pending.map(_saveLeaseRegisterWrite));' },
  { id: 'L11', file: S, why: 'the vision text is not awaited — a Promise is sent as the text',
    from: '  try { extractedText = await w.extractedText; }', to: '  try { extractedText = w.extractedText; }' },
  { id: 'L12', file: S, why: 'one failed write stops the rest of the flush',
    from: "  }).catch(e => { console.warn('[saveLeaseDocument:bulk] failed:', e?.message); return null; });", to: '  });' },
  { id: 'L13', file: S, why: 'the queue is not emptied — a second flush writes everything again',
    from: 'Array.isArray(queue) ? queue.splice(0, queue.length) : []', to: 'Array.isArray(queue) ? queue.slice() : []' },
  // ── the API ──────────────────────────────────────────────────────────────
  { id: 'L14', file: A, why: 'a refused link is not retried — the document is lost',
    from: 'if (result.status >= 300 && wantTenant && _isLeaseholdLinkRefused(result.json)) {', to: 'if (false) {' },
  { id: 'L15', file: A, why: 'ANY failure is retried unlinked — a real error is hidden',
    from: 'wantTenant && _isLeaseholdLinkRefused(result.json)) {', to: 'wantTenant) {' },
  { id: 'L16', file: A, why: 'the retry keeps the refused link',
    from: '      result = await write(null);\n      linked = false;', to: '      result = await write(wantTenant);\n      linked = false;' },
  { id: 'L17', file: A, why: 'the response claims a link it does not have',
    from: '      linked = false;\n    }\n    if (target', to: '    }\n    if (target' },
  { id: 'L18', file: A, why: 'the matcher accepts any foreign key, not this constraint',
    from: '&& /lease_documents_leasehold_fk/.test(', to: '&& /foreign key/.test(' },
  { id: 'L19', file: A, why: 'the retry drops everything but the link — the document text is lost',
    from: "      const p = { ...content, property_id: propertyId, tenant_id: linkTenant || null };",
    to:   "      const p = linkTenant ? { ...content, property_id: propertyId, tenant_id: linkTenant } : { property_id: propertyId, file_name: content.file_name, tenant_id: null };" },
  // ── the deleters ─────────────────────────────────────────────────────────
  { id: 'L20', file: S, why: 'property delete goes back to deleting tenants first',
    from: "    const { error } = await db.from('properties').delete().eq('id', propId);",
    to:   "    await db.from('tenants').delete().eq('property_id', propId);\n    const { error } = await db.from('properties').delete().eq('id', propId);" },
  // Step A-1 moved these onto the stronger rule: nothing deletes a leasehold for leaving a list.
  { id: 'L21', file: S, why: 'Clear All deletes tenants rows again',
    from: "  document.getElementById('bulkLeaseInput').value = '';\n  if (lastResults.length > 0)",
    to:   "  document.getElementById('bulkLeaseInput').value = '';\n  if (prop?.id) await db.from('tenants').delete().eq('property_id', prop.id);\n  if (lastResults.length > 0)" },
  { id: 'L22', file: S, why: 'Clear All goes back to warning that records are removed',
    from: "'saved for this property are not deleted.'", to: "'saved for this property are removed and cannot be recovered.'" },
  { id: 'L23', file: S, why: 'the direct-write resync fallback prunes absentees again',
    from: "  console.log('[resyncTenantsDirectly] fallback resync OK —', insertRows.length,",
    to:   "  await db.from('tenants').delete().in('id', []);\n  console.log('[resyncTenantsDirectly] fallback resync OK —', insertRows.length," },
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'reglink-mut-'));
fs.cpSync(ROOT, tmp, { recursive: true, filter: (src) => { const rel = path.relative(ROOT, src); return !(rel === '.git' || rel.startsWith('.git' + path.sep) || rel === 'node_modules' || rel.startsWith('node_modules' + path.sep)); } });
try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(tmp, 'node_modules'), 'dir'); } catch (_) {}
const ORIGINAL = {};
for (const f of [S, A]) ORIGINAL[f] = fs.readFileSync(path.join(ROOT, f), 'utf8');

const SUITES = ['test-register-leasehold-link.js', 'test-e2e-register-leasehold-link.js'];
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
if (survivors.length) { survivors.forEach(s => console.log('  · ' + s)); process.exit(1); }
