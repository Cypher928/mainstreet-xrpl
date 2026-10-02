'use strict';
/**
 * tools/acquisition-match-safeguards-mutation.js — would anyone notice if a
 * matching or conversion safeguard were quietly undone?
 *
 *   node tools/acquisition-match-safeguards-mutation.js
 *
 * Each mutant undoes ONE rule, and test-acquisition-match-safeguards.js or
 * test-e2e-acquisition-match-safeguards.js must fail for every one.
 *
 *   Comparing names (acquisition-leasehold.js)
 *     S01  names sharing no distinguishing word are only "uncertain"
 *     S02  one name adding descriptive words to the other is flagged
 *     S03  words every such business shares count as agreement
 *     S04  a street address is called a different property
 *     S05  the lease's property is never compared
 *     S06  a material mismatch needs no reason
 *
 *   Matching (script.js)
 *     S07  a concerning match is written unconfirmed
 *     S08  a material mismatch is written without a reason
 *     S09  the resolution does not keep the concerns and the reason
 *     S10  the activity entry does not keep them
 *     S11  the dropdown writes the match at once again
 *     S12  Cancel leaves the question open
 *     S13  the question is drawn into a closed list
 *     S14  a frozen acquisition can still be asked to match
 *
 *   No lease on file (acquisition-leasehold.js, script.js)
 *     S15  the gate ignores leaseholds with no lease on file
 *     S16  a replaced document counts as the lease on file
 *     S17  a document set aside counts as the lease on file
 *     S18  an acknowledgement is not honoured by the gate
 *     S19  the acknowledgement claims to verify the terms
 *     S20  a frozen acquisition can be acknowledged on
 *     S21  the panel words the acknowledgement as a verification
 *     S22  the convert dialog does not say it again
 *
 *   What the server reads (script.js, migration 044's table)
 *     S23  the page's gate ignores a mismatch with no recorded reason
 *     S24  a reason recorded for another leasehold counts
 *     S25  Match anyway writes the match when the server refused the confirmation
 *     S26  the browser's leaseholdAcknowledgements map is honoured again
 *     S27  a refused acknowledgement is written anyway
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const L = 'acquisition-leasehold.js';
const S = 'script.js';

const MUTANTS = [
  { id: 'S01', file: L, why: 'names sharing no distinguishing word are only "uncertain"',
    from: "    if (!common.length) return { level: CONCERN_LEVEL.MISMATCH, why: 'the names share no distinguishing word' };",
    to:   "    if (!common.length) return { level: CONCERN_LEVEL.UNCERTAIN, why: 'the names share no distinguishing word' };" },
  { id: 'S02', file: L, why: 'one name adding descriptive words to the other is flagged',
    from: '      return (aInB || bInA) ? null',
    to:   '      return false ? null' },
  { id: 'S03', file: L, why: 'words every such business shares count as agreement',
    from: '    var da = _distinct(a, GENERIC_TENANT), db = _distinct(b, GENERIC_TENANT);',
    to:   '    var da = _distinct(a, {}), db = _distinct(b, {});' },
  { id: 'S04', file: L, why: 'a street address is called a different property',
    from: '      var r = (addressOnly && !nameHasNumber)',
    to:   '      var r = (false)' },
  { id: 'S05', file: L, why: 'the lease\'s property is never compared',
    from: '    var p = compareProperty(source, names);',
    to:   '    var p = null;' },
  { id: 'S06', file: L, why: 'a material mismatch needs no reason',
    from: '    return _arr(concerns).some(function (c) { return c.level === CONCERN_LEVEL.MISMATCH; });',
    to:   '    return false;' },
  { id: 'S07', file: S, why: 'a concerning match is written unconfirmed',
    from: '      if (o.confirmed !== true) return false;\n',
    to:   '' },
  { id: 'S08', file: S, why: 'a material mismatch is written without a reason',
    from: '      if (AL.requiresReason(concerns) && !reason) return false;\n',
    to:   '' },
  { id: 'S09', file: S, why: 'the resolution does not keep the concerns and the reason',
    from: '    res[rowKey].concerns = concerns.map(c => ({ kind: c.kind, level: c.level, extracted: c.extracted, selected: c.selected, text: c.text }));\n    res[rowKey].reason = reason;\n',
    to:   '' },
  { id: 'S10', file: S, why: 'the activity entry does not keep them',
    from: '      concerns.length ? { concerns: res[rowKey].concerns, reason } : {}) });',
    to:   '      {}) });' },
  { id: 'S11', file: S, why: 'the dropdown writes the match at once again',
    from: "    acqRequestMatch(sel.getAttribute('data-row'), sel.value);",
    to:   "    acqResolveExtraction(sel.getAttribute('data-row'), _AL().RESOLUTION.MATCHED, sel.value);" },
  { id: 'S12', file: S, why: 'Cancel leaves the question open',
    from: '  _acqUnfiledOpenFor = _acqPendingMatch ? _acqPendingMatch.reviewId : _acqUnfiledOpenFor;\n  _acqPendingMatch = null;\n',
    to:   '  _acqUnfiledOpenFor = _acqPendingMatch ? _acqPendingMatch.reviewId : _acqUnfiledOpenFor;\n' },
  { id: 'S13', file: S, why: 'the question is drawn into a closed list',
    from: "data-unresolved=\"${n}\"${asking ? ' open' : ''}>",
    to:   "data-unresolved=\"${n}\">" },
  { id: 'S14', file: S, why: 'a frozen acquisition can still be asked to match',
    from: '  if (!rowKey || !familyId || _acqRefuseFrozen(reviewId)) return false;',
    to:   '  if (!rowKey || !familyId) return false;' },
  { id: 'S15', file: S, why: 'the gate ignores leaseholds with no lease on file',
    from: '  const docless = _acqUnacknowledgedDocumentless(id);\n  if (docless.length) {',
    to:   '  const docless = _acqUnacknowledgedDocumentless(id);\n  if (false) {' },
  { id: 'S16', file: L, why: 'a replaced document counts as the lease on file',
    from: '      if (!d.family_id || d.superseded_by_document_id) return;',
    to:   '      if (!d.family_id) return;' },
  { id: 'S17', file: L, why: 'a document set aside counts as the lease on file',
    from: "      if (x && (x.action === 'not_relevant' || x.action === 'duplicate')) return;\n",
    to:   '' },
  { id: 'S18', file: L, why: 'an acknowledgement is not honoured by the gate',
    from: '      return !(a && typeof a === \'object\' && a.condition === NO_DOCUMENT_ON_FILE);',
    to:   '      return true;' },
  { id: 'S19', file: S, why: 'the acknowledgement is kept in review.data, where the server does not look',
    from: '  const row = await _acqSaveAttestation(reviewId, { family_id: familyId, kind: AL.NO_DOCUMENT_ON_FILE });',
    to:   '  const row = { id: null }; review.data = Object.assign({}, review.data, { leaseholdAcknowledgements: { [familyId]: { condition: AL.NO_DOCUMENT_ON_FILE, verifiesTerms: true } } });' },
  { id: 'S20', file: S, why: 'a frozen acquisition can be acknowledged on',
    from: '  if (_acqRefuseFrozen(review)) return false;   // P5-6A\n  const l = _acqDocumentlessLeaseholds(reviewId)',
    to:   '  const l = _acqDocumentlessLeaseholds(reviewId)' },
  { id: 'S21', file: S, why: 'the panel words the acknowledgement as a verification',
    from: "const _ACQ_ACK_NOT_VERIFIED = 'Acknowledged that no lease is on file — this does not verify any lease term; its terms remain not established.';",
    to:   "const _ACQ_ACK_NOT_VERIFIED = 'Acknowledged and verified by a person.';" },
  { id: 'S22', file: S, why: 'the convert dialog does not say it again',
    from: "    doclessEl.style.display = docless.length ? 'block' : 'none';",
    to:   "    doclessEl.style.display = 'none'; return document.getElementById('acqConvertModal').style.display = 'flex';" },
  { id: 'S23', file: S, why: 'the page\'s gate ignores a mismatch with no recorded reason',
    from: '  if (unreasoned.length) {', to: '  if (false) {' },
  { id: 'S24', file: S, why: 'a reason recorded for another leasehold counts',
    from: '    .filter(x => !reasoned.some(a => a.row_key === x.key && a.family_id === x.resolution.familyId))',
    to:   '    .filter(x => !reasoned.some(a => a.row_key === x.key))' },
  { id: 'S25', file: S, why: 'Match anyway writes the match when the server refused the confirmation',
    from: '  if (!kept) {', to: '  if (false) {' },
  { id: 'S26', file: S, why: 'the browser\'s leaseholdAcknowledgements map is honoured again',
    from: '  const out = {};\n  _acqAttestationRows(reviewId).forEach(',
    to:   '  const out = Object.assign({}, ((_acqReviews.find(r => r && r.id === reviewId) || {}).data || {}).leaseholdAcknowledgements || {});\n  _acqAttestationRows(reviewId).forEach(' },
  { id: 'S27', file: S, why: 'a refused acknowledgement is written anyway',
    from: "  if (!row) {\n    showToast('⚠️ The acknowledgement could not be recorded", to: "  if (false) {\n    showToast('⚠️ The acknowledgement could not be recorded" },
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'acq-match-mut-'));
for (const entry of fs.readdirSync(ROOT)) {
  if (['node_modules', '.git', 'scratchpad', 'evidence', 'assets'].includes(entry)) continue;
  fs.cpSync(path.join(ROOT, entry), path.join(tmp, entry), { recursive: true });
}
try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(tmp, 'node_modules'), 'dir'); } catch (_) {}

const ORIGINAL = {};
[...new Set(MUTANTS.map(m => m.file))].forEach(f => { ORIGINAL[f] = fs.readFileSync(path.join(ROOT, f), 'utf8'); });
// The fast suites first: a mutant they kill never pays for a browser.
const SUITES = ['test-acquisition-match-safeguards.js', 'test-e2e-acquisition-match-safeguards.js'];
function runSuites() {
  for (const suite of SUITES) {
    try { execFileSync(process.execPath, [suite], { cwd: tmp, stdio: 'pipe', timeout: 600000 }); }
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
