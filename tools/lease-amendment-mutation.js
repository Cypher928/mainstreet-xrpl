'use strict';
/**
 * tools/lease-amendment-mutation.js — is the amendment really preserved, and
 * does the citation chip really refuse a superseded clause?
 *
 *   node tools/lease-amendment-mutation.js
 *
 * Each mutant is a single, plausible edit to a predicate this slice introduced
 * or changed. A SURVIVOR means the suites would not have noticed the regression
 * and is either a real gap or an equivalent mutant that must be argued for.
 *
 *   Slice 1 — the document
 *     L01  the amendment PDF never reaches storage
 *     L02  no lease_documents row is written
 *     L03  the row loses the tenant id, so it is nobody's document
 *     L04  the amendment's text is not persisted, so it cannot be asked
 *     L05  the amendment entry drops the stored file url
 *     L06  the amendment entry drops the document id
 *     L07  a failed filing is papered over with a truthy url
 *     L08  parsingStatus claims success on a row with no text
 *     L09  the Space file stops listing amendments
 *     L10  the Space file lists amendments whose file was never stored
 *     L11  an amendment no longer marks the reconciliation stale
 *
 *   Slice 2 — the evidence
 *     L12  the chip stops asking whether the evidence is stale
 *     L13  the chip goes back to picking the snapshot itself
 *     L14  the superseded branch is removed entirely (the original defect)
 *     L15  the superseded chip is dressed as a citation
 *     L16  the superseded chip prints the old clause as its body
 *     L17  the superseded chip stops naming the governing amendment
 *     L18  the tooltip drops the disclaimer
 *     L19  the governing lookup ignores which fields were overridden
 *     L20  the governing lookup returns the EARLIEST amendment
 *     L21  the cited chip's straight quotes revert to curly
 *
 * A FAILING BASELINE IS NOT A PASS.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const S = 'script.js', T = 'tenant-space.js';

const MUTANTS = [
  // ── Slice 1 · the document ───────────────────────────────────────────────
  { id: 'L01', file: S, why: 'the amendment PDF never reaches storage',
    from: '      uploadLeaseToStorage(file, _propId),', to: '      Promise.resolve(null),' },
  { id: 'L02', file: S, why: 'no lease_documents row is written',
    from: '    if (_propId) {\n      const _saved = await saveLeaseDocument({',
    to:   '    if (false) {\n      const _saved = await saveLeaseDocument({' },
  { id: 'L03', file: S, why: "the row loses the tenant id, so it is nobody's document",
    from: '        tenantId:        tenantId || null,\n        tenantName:      (tenantData[idx] && tenantData[idx].tenant_name) || null,',
    to:   '        tenantId:        null,\n        tenantName:      (tenantData[idx] && tenantData[idx].tenant_name) || null,' },
  { id: 'L04', file: S, why: "the amendment's text is not persisted, so it cannot be asked",
    from: '        extractedText:   _amendmentText,', to: '        extractedText:   null,' },
  { id: 'L05', file: S, why: 'the amendment entry drops the stored file url',
    from: '    fileUrl:         (docMeta && docMeta.fileUrl) || null,', to: '    fileUrl:         null,' },
  { id: 'L06', file: S, why: 'the amendment entry drops the document id',
    from: '    leaseDocumentId: (docMeta && docMeta.leaseDocumentId) || null,', to: '    leaseDocumentId: null,' },
  { id: 'L07', file: S, why: 'a failed filing is papered over with a truthy url',
    from: '    fileUrl:         (docMeta && docMeta.fileUrl) || null,',
    to:   "    fileUrl:         (docMeta && docMeta.fileUrl) || 'pending'," },
  { id: 'L08', file: S, why: 'parsingStatus claims success on a row with no text',
    from: "        parsingStatus:   _amendmentText ? 'success' : 'partial',",
    to:   "        parsingStatus:   'success'," },
  { id: 'L09', file: T, why: 'the Space file stops listing amendments',
    from: '    (t.amendments || []).forEach(function (a) {', to: '    [].forEach(function (a) {' },
  { id: 'L10', file: T, why: 'the Space file lists amendments whose file was never stored',
    from: '      if (!a || !a.fileUrl) return;', to: '      if (!a) return;' },
  // Anchored on the audit entry above it: the bare `if (lastResults.length…)`
  // line appears in five functions, and mutating the first one tested a
  // different feature entirely.
  { id: 'L11', file: S, why: 'an amendment no longer marks the reconciliation stale',
    from: "    detail:     JSON.stringify({ amendmentId, overriddenFields, fileName }),\n  });\n\n  if (lastResults.length > 0) { _resultsStale = true; _updateStaleResultsBanner(); }",
    to:   "    detail:     JSON.stringify({ amendmentId, overriddenFields, fileName }),\n  });\n\n  if (false) { _resultsStale = true; _updateStaleResultsBanner(); }" },

  // ── Slice 2 · the evidence ───────────────────────────────────────────────
  { id: 'L12', file: S, why: 'the chip stops asking whether the evidence is stale',
    from: "  const stale = (FP && typeof FP.fieldProvenance === 'function')\n    ? !!FP.fieldProvenance(fieldKey, d).evidenceStale\n    : false;",
    to:   '  const stale = false;' },
  { id: 'L13', file: S, why: 'the chip goes back to picking the snapshot itself',
    from: "  const snap = (FP && typeof FP.latestSnapshot === 'function')\n    ? FP.latestSnapshot(fieldKey, d)\n    : (snaps.find(s => !s.superseded) || snaps[0]);",
    to:   '  const snap = snaps.find(s => !s.superseded) || snaps[0];' },
  { id: 'L14', file: S, why: 'the superseded branch is removed entirely (the original defect)',
    from: '  if (stale) {', to: '  if (false) {' },
  { id: 'L15', file: S, why: 'the superseded chip is dressed as a citation',
    from: '    return `<div class="fe-chip fe-chip--superseded" title="${esc(tip)}">',
    to:   '    return `<div class="fe-chip fe-chip--cited" title="${esc(tip)}">' },
  { id: 'L16', file: S, why: 'the superseded chip prints the old clause as its body',
    from: '&#x26A0;&#xFE0F; ${esc(head)} — the clause on file is not evidence for this value</div>`;',
    to:   '&#x26A0;&#xFE0F; ${esc(head)} ${esc(snap.quote || "")}</div>`;' },
  { id: 'L17', file: S, why: 'the superseded chip stops naming the governing amendment',
    from: "    const head = gov ? `Superseded by ${_amendmentLabel(gov)}` : 'Superseded clause on file';",
    to:   "    const head = 'Superseded clause on file';" },
  { id: 'L18', file: S, why: 'the tooltip drops the disclaimer',
    from: '      + `. It is not evidence for the value shown.`', to: '      + ``' },
  { id: 'L19', file: S, why: 'the governing lookup ignores which fields were overridden',
    from: '  return sorted.find(a => a && Array.isArray(a.overriddenFields)\n                       && a.overriddenFields.includes(fieldKey)) || null;',
    to:   '  return sorted[0] || null;' },
  { id: 'L20', file: S, why: 'the governing lookup returns the EARLIEST amendment',
    from: "  const sorted = [...ams].sort((a, b) =>\n    String((b && b.effectiveDate) || '').localeCompare(String((a && a.effectiveDate) || '')));",
    to:   "  const sorted = [...ams].sort((a, b) =>\n    String((a && a.effectiveDate) || '').localeCompare(String((b && b.effectiveDate) || '')));" },
  { id: 'L21', file: S, why: "the cited chip's straight quotes revert to curly",
    from: '    return `<div class="fe-chip fe-chip--cited"${fullTip}>',
    to:   '    return `<div class=”fe-chip fe-chip--cited”${fullTip}>' },
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'amdmut-'));
fs.cpSync(ROOT, tmp, {
  recursive: true,
  filter: (src) => {
    const rel = path.relative(ROOT, src);
    return !(rel === '.git' || rel.startsWith('.git' + path.sep) ||
             rel === 'node_modules' || rel.startsWith('node_modules' + path.sep));
  },
});
const FILES = [...new Set(MUTANTS.map(m => m.file))];
const ORIGINAL = {};
for (const f of FILES) ORIGINAL[f] = fs.readFileSync(path.join(ROOT, f), 'utf8');

const SUITES = ['test-lease-amendment.js', 'test-e2e-lease-amendment.js'];
function runSuites() {
  for (const suite of SUITES) {
    try { execFileSync(process.execPath, [suite], { cwd: tmp, stdio: 'pipe', timeout: 900000 }); }
    catch (_) { return false; }
  }
  return true;
}

const baseline = runSuites();
console.log('Baseline (unmutated copy): ' + (baseline ? 'PASS' : 'FAIL'));
if (!baseline) {
  console.error('\nThe unmutated copy does not pass, so every result below would be\n' +
                'meaningless. Nothing is mutated. Fix the harness or the suites first.');
  for (const suite of SUITES) {
    try { execFileSync(process.execPath, [suite], { cwd: tmp, stdio: 'pipe', timeout: 900000 }); }
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
