'use strict';
/**
 * tools/acquisition-intake-mutation.js — would the suites notice if a held
 * document stopped following its rules?
 *
 *   node tools/acquisition-intake-mutation.js
 *
 * Each mutant is a single, plausible edit to a rule I-2 introduced — in the
 * module (acquisition-intake.js) or in the reader and screen (script.js). A
 * SURVIVOR means the suites would not have noticed the regression and is either
 * a real gap or an equivalent mutant that must be argued for.
 *
 *   The module — acquisition-intake.js
 *     M01  a rent roll goes to the lease lane
 *     M02  an invoice goes to the lease lane
 *     M03  unknown gets a lane instead of a person
 *     M04  xlsx is accepted at the drop
 *     M05  the MIME-must-match rule is dropped
 *     M06  an empty file is accepted
 *     M07  the total-letters rule is dropped
 *     M08  the letters-per-page rule is dropped
 *     M09  a scanned PDF is classified instead of needing a type
 *     M10  a left-out file is still picked up by the reader
 *     M11  a type set by a person can be re-read
 *     M12  a human override forgets the AI answer
 *     M13  held text is never capped
 *     M14  low confidence is never badged
 *     M15  a file left out while reading comes back as reading
 *     M16  the proposal no longer says who proposed it
 *     M17  the classifier floor is dropped
 *
 *   The reader and the screen — script.js
 *     G01  images are read as text and classified
 *     G02  a scanned PDF is read on and classified
 *     G03  two files can be read at once
 *     G04  a duplicate is held but not left out
 *     G05  a 429 fails the file instead of pausing the queue
 *     G06  a read that lands after the file was left out is applied anyway
 *     G07  the tab no longer asks before closing on held files
 *     G08  a refused file is held anyway
 *     G09  a type a person picks goes around the module (no lane)
 *     G10  the classifier swallows the 429 even when asked (the queue never pauses)
 *     G11  the classifier rethrows every error when asked, not only a 429
 *
 *   I-3b — the proposal on screen (acquisition-assignment.js decides; the screen shows it)
 *     P01  the picker preselects the first candidate
 *     P02  recompute writes the proposal into the assignment
 *     P03  the validator's refusal is ignored
 *     P04  tick-boxes for every document that names several properties
 *     P05  an Accept button on a question
 *     P06  no recompute after a read
 *     P07  a new prospect does not refresh the profiles
 *     P08  the bulk act bypasses the validator
 *     P09  the "your choice stands" note is hidden
 *     P10  tick-boxes for every candidate, not only the strongly named
 *
 * A FAILING BASELINE IS NOT A PASS.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const M = 'acquisition-intake.js';
const S = 'script.js';

const MUTANTS = [
  // ── the module ────────────────────────────────────────────────────────────
  { id: 'M01', file: M, why: 'a rent roll goes to the lease lane',
    from: "    rent_roll:           { label: 'Rent Roll',           family: false },",
    to:   "    rent_roll:           { label: 'Rent Roll',           family: true  }," },
  { id: 'M02', file: M, why: 'an invoice goes to the lease lane',
    from: "    invoice:             { label: 'Invoice',             family: false },",
    to:   "    invoice:             { label: 'Invoice',             family: true  }," },
  { id: 'M03', file: M, why: 'unknown gets a lane instead of a person',
    from: "    if (!type || !TYPES[type] || type === 'unknown') return null;",
    to:   "    if (!type || !TYPES[type]) return null;" },
  { id: 'M04', file: M, why: 'xlsx is accepted at the drop',
    from: "    webp: ['image/webp'],\n  };",
    to:   "    webp: ['image/webp'],\n    xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],\n  };" },
  { id: 'M05', file: M, why: 'the MIME-must-match rule is dropped',
    from: "    if (mime && ACCEPT[ext].indexOf(mime) === -1) {",
    to:   "    if (false) {" },
  { id: 'M06', file: M, why: 'an empty file is accepted',
    from: "    if (size === 0) return { ok: false, ext: ext, reason: 'The file is empty (0 bytes).', hint: 'Re-export it and try again.' };",
    to:   "    if (false) return { ok: false, ext: ext, reason: 'The file is empty (0 bytes).', hint: 'Re-export it and try again.' };" },
  { id: 'M07', file: M, why: 'the total-letters rule is dropped',
    from: "    if (letters < SCAN_LETTERS_TOTAL) return true;",
    to:   "    if (false) return true;" },
  { id: 'M08', file: M, why: 'the letters-per-page rule is dropped',
    from: "    if (pages > 0 && letters / pages < SCAN_LETTERS_PER_PAGE) return true;",
    to:   "    if (false) return true;" },
  { id: 'M09', file: M, why: 'a scanned PDF is classified instead of needing a type',
    from: "        if (item.ext === 'pdf' && isScanned({ isPdf: true, text: item.text, letters: item.letters, pagesRead: item.pagesRead })) {\n          return needsType(item, REASON.SCANNED);\n        }",
    to:   "" },
  { id: 'M10', file: M, why: 'a left-out file is still picked up by the reader',
    from: "      if (h && h.state === STATE.QUEUED && !h.removed) return h;",
    to:   "      if (h && (h.state === STATE.QUEUED || h.state === STATE.LEFT_OUT) && !h.removed) return h;" },
  { id: 'M11', file: M, why: 'a type set by a person can be re-read',
    from: "      case 'retry':\n        if (item.type.source === 'human') throw new Error('a type set by a person is not re-read');",
    to:   "      case 'retry':\n        if (false) throw new Error('a type set by a person is not re-read');" },
  { id: 'M12', file: M, why: 'a human override forgets the AI answer',
    from: "        item.type = { value: pick, source: 'human', confidence: null, evidence: null };\n        item.lane = laneFor(pick);",
    to:   "        item.type = { value: pick, source: 'human', confidence: null, evidence: null };\n        item.aiType = null;\n        item.lane = laneFor(pick);" },
  { id: 'M13', file: M, why: 'held text is never capped',
    from: "    return s.length > TEXT_CAP ? { text: s.slice(0, TEXT_CAP), truncated: true } : { text: s, truncated: false };",
    to:   "    return { text: s, truncated: false };" },
  { id: 'M14', file: M, why: 'low confidence is never badged',
    from: "        var badge = (t.source === 'ai' && typeof t.confidence === 'number' && t.confidence < LOW_CONFIDENCE) ? 'Low confidence' : null;",
    to:   "        var badge = null;" },
  { id: 'M15', file: M, why: 'a file left out while reading comes back as reading (the token does not move)',
    from: "        item.readToken += 1;\n        item.state = STATE.LEFT_OUT; item.picking = false;",
    to:   "        item.state = STATE.LEFT_OUT; item.picking = false;" },
  { id: 'M16', file: M, why: 'the proposal no longer says who proposed it',
    from: "          : 'proposed by AI' + (typeof t.confidence === 'number' ? ' at ' + pct(t.confidence) : '');",
    to:   "          : '';" },
  { id: 'M17', file: M, why: 'the classifier floor is dropped',
    from: "        if (conf !== null && conf < CLASSIFIER_FLOOR) return needsType(item, REASON.LOW);",
    to:   "        if (false) return needsType(item, REASON.LOW);" },

  // ── the reader and the screen ─────────────────────────────────────────────
  { id: 'G01', file: S, why: 'images are read as text and classified',
    from: "    if (item.image) {\n      textSource = 'image';\n    } else if (item.ext === 'pdf') {",
    to:   "    if (false) {\n      textSource = 'image';\n    } else if (item.ext === 'pdf') {" },
  { id: 'G02', file: S, why: 'a scanned PDF (or an image, or nothing to read) is sent to the classifier anyway',
    from: "  if (item.state !== 'reading') return;        // an image, a scan, nothing to read: a person's call",
    to:   "  void 0;" },
  { id: 'G03', file: S, why: 'two files can be read at once',
    from: "  if (!AI || _acqIntakeReader.running || _acqIntakeReader.paused) return;",
    to:   "  if (!AI || _acqIntakeReader.paused) return;" },
  { id: 'G04', file: S, why: 'a duplicate is held but not left out',
    from: "    if (dup) { item.warnings.push(AI.WARN.DUPLICATE); item.duplicateOf = dup.itemId; AI.transition(item, 'leave_out'); }",
    to:   "    if (dup) { item.warnings.push(AI.WARN.DUPLICATE); item.duplicateOf = dup.itemId; }" },
  { id: 'G05', file: S, why: 'a 429 fails the file instead of pausing the queue',
    from: "    if (e && e.status === 429) {",
    to:   "    if (false) {" },
  { id: 'G06', file: S, why: 'a read that lands after the file was left out or removed is applied anyway',
    from: "  const live = () => !item.removed && item.readToken === token && item.state === 'reading';",
    to:   "  const live = () => true;" },
  { id: 'G07', file: S, why: 'the tab no longer asks before closing on held files',
    from: "  if (want && !_acqIntakeUnloadArmed) { window.addEventListener('beforeunload', _acqIntakeBeforeUnload); _acqIntakeUnloadArmed = true; }",
    to:   "  if (false) { window.addEventListener('beforeunload', _acqIntakeBeforeUnload); _acqIntakeUnloadArmed = true; }" },
  { id: 'G08', file: S, why: 'a refused file is held anyway',
    from: "    if (!v.ok) { _acqIntakeRefused.push({ name: f.name, reason: v.reason, hint: v.hint }); continue; }",
    to:   "    if (!v.ok) { _acqIntakeRefused.push({ name: f.name, reason: v.reason, hint: v.hint }); }" },
  { id: 'G09', file: S, why: 'a type a person picks goes around the module (no lane, no rules)',
    from: "function acqIntakeSetType(itemId, type) { if (type) _acqIntakeMove(itemId, 'set_type', { type }); }",
    to:   "function acqIntakeSetType(itemId, type) { const it = _acqIntakeItem(itemId); if (it && type) { it.type = { value: type, source: 'human', confidence: null, evidence: null }; it.state = 'classified'; _renderAcqIntakeDocs(); } }" },
  { id: 'G10', file: S, why: 'the classifier swallows the 429 even when asked (the queue never pauses)',
    from: '    if (opts && opts.rethrow === true && e && e.status === 429) throw e;', to: '    if (false) throw e;' },
  { id: 'G11', file: S, why: 'the classifier rethrows EVERY error when asked, not only a 429',
    from: '    if (opts && opts.rethrow === true && e && e.status === 429) throw e;', to: '    if (opts && opts.rethrow === true) throw e;' },

  // ── I-3b: the proposal on screen ────────────────────────────────────────
  { id: 'P01', file: S, why: 'the picker preselects the first candidate',
    from: "  const opts = first.concat(rest).map(rid => `<option value=\"${esc(rid)}\">${esc(_acqIntakeProfileName(rid))}</option>`).join('');",
    to:   "  const opts = first.concat(rest).map((rid, i) => `<option value=\"${esc(rid)}\"${i === 0 ? ' selected' : ''}>${esc(_acqIntakeProfileName(rid))}</option>`).join('');" },
  { id: 'P02', file: S, why: 'recompute writes the proposal into the assignment',
    from: '  _acqIntakeDecisions = r.decisions;\n  _acqIntakeTallies = r.tallies;',
    to:   "  _acqIntakeDecisions = r.decisions;\n  _acqIntakeTallies = r.tallies;\n  _acqIntakeHeld.forEach(i => { const d = r.decisions[i.itemId]; if (d && d.proposal && !i.assignment) i.assignment = { reviewIds: [d.proposal.reviewId], by: 'ai', at: 'now' }; });" },
  { id: 'P03', file: S, why: 'the validator\'s refusal is ignored',
    from: "  if (!verdict.ok) { showToast(verdict.error, { color: '#92400e', textColor: '#fef3c7' }); return false; }",
    to:   "  if (false) { showToast(verdict.error, { color: '#92400e', textColor: '#fef3c7' }); return false; }" },
  { id: 'P04', file: S, why: 'tick-boxes for every document that names several properties, several allowed or not',
    from: "  } else if (d.state === 'several') {", to: "  } else if (d.state === 'several' || (d.state === 'candidates' && d.candidates.length > 1)) {" },
  { id: 'P05', file: S, why: 'an Accept button on a question',
    from: "    controls = _acqIntakePropertyPicker(item.itemId, d, 'Which is it?');",
    to:   "    controls = `<button type=\"button\" class=\"acq-btn acq-btn-primary acq-intake-prop-accept\" onclick=\"acqIntakeAssign('${id}', '${esc(d.candidates[0].reviewId)}')\">Accept ${nameOf(d.candidates[0].reviewId)}</button>` + _acqIntakePropertyPicker(item.itemId, d, 'Which is it?');" },
  { id: 'P06', file: S, why: 'no recompute after a read (the screen never learns what the evidence says)',
    from: '      _acqIntakeRecompute();   // I-3b: what the evidence says now, for every held file', to: '      _renderAcqIntakeDocs();' },
  { id: 'P07', file: S, why: 'a new prospect does not refresh the profiles',
    from: '  if (created) _acqIntakeProfilesChanged();   // I-3b: a new prospect is a new candidate for every held file', to: '' },
  { id: 'P08', file: S, why: 'the bulk act bypasses the validator',
    from: '  picked.forEach(i => { if (_acqIntakeSetAssignment(i, [target])) n++; });',
    to:   "  picked.forEach(i => { i.assignment = { reviewIds: [target], by: 'human', at: 'now' }; n++; });" },
  { id: 'P09', file: S, why: 'the evidence note is hidden when a person\'s choice disagrees with the proposal',
    from: "    if (disagree) body += `<div class=\"acq-intake-prop-note acq-intake-prop-stands\">The evidence points at ${nameOf(d.proposal.reviewId)} — your choice stands.</div>`;", to: '' },
  { id: 'P10', file: S, why: 'tick-boxes offered for every candidate, not only the properties named strongly',
    from: '    const strong = d.candidates.filter(r => r.strong > 0);', to: '    const strong = d.candidates;' },
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'acq-intake-mut-'));
for (const entry of fs.readdirSync(ROOT)) {
  if (['node_modules', '.git', 'scratchpad', 'evidence', 'assets'].includes(entry)) continue;
  fs.cpSync(path.join(ROOT, entry), path.join(tmp, entry), { recursive: true });
}
try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(tmp, 'node_modules'), 'dir'); } catch (_) {}

const FILES = [...new Set(MUTANTS.map(m => m.file))];
const ORIGINAL = {};
for (const f of FILES) ORIGINAL[f] = fs.readFileSync(path.join(ROOT, f), 'utf8');

// Cheapest first: most mutants die in Node before the browser is ever opened.
const SUITES = ['test-acquisition-intake-module.js', 'test-acquisition-intake.js', 'test-e2e-acquisition-intake-documents.js', 'test-e2e-acquisition-intake-assignment.js'];
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
fs.rmSync(tmp, { recursive: true, force: true });

console.log(`\n${killed}/${MUTANTS.length} killed`);
if (survived.length) {
  console.log('\nSURVIVORS — each needs a written verdict (real gap or equivalent):');
  survived.forEach(s => console.log('  - ' + s));
  process.exit(1);
}
