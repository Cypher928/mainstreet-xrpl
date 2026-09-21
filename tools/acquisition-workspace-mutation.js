'use strict';
/**
 * tools/acquisition-workspace-mutation.js — does the review record really
 * upgrade without loss, does the stage really lock, and does a stale save
 * really refuse to overwrite?
 *
 *   node tools/acquisition-workspace-mutation.js
 *
 * Each mutant is a single, plausible edit to a rule this increment (P1-1)
 * introduced. A SURVIVOR means the suites would not have noticed the
 * regression and is either a real gap or an equivalent mutant that must be
 * argued for.
 *
 *   The module — acquisition-workspace.js
 *     W01  derivation never says Report (analysis on file is ignored)
 *     W02  stageOf ignores the conversion facts
 *     W03  upgrade drops the tenants
 *     W04  upgrade is no longer idempotent (appends to activity each time)
 *     W05  a person can choose Acquired
 *     W06  an acquired review can still be moved
 *     W07  activity is never capped (the record can grow without bound)
 *     W08  an empty save response is treated as success
 *     W09  a database error is treated as success
 *     W10  a conflict is reported as "missing" (and then upserted over)
 *     W11  the save payload leaks the whole row (id, updated_at)
 *     W12  every chip is selectable, Acquired included
 *     W13  a revert leaves the stage at Acquired
 *
 *   The glue — script.js
 *     G01  the save drops the revision filter (last writer wins again)
 *     G02  a conflict does not reload the stored row
 *     G03  loaded rows are not adopted (no upgrade, no revision)
 *     G04  adopt forgets the revision it read
 *     G05  a new review is created in the legacy shape
 *     G06  conversion does not mark the review acquired
 *     G07  a revert does not re-derive the stage
 *     G08  running the analysis is not recorded
 *     G09  opening a review does not render its stage
 *     G10  a stage click is not saved
 *     G11  the demo seed records the timestamp it SENT as a revision
 *     G12  the conflict handler keeps the local copy
 *
 * A FAILING BASELINE IS NOT A PASS.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const W = 'acquisition-workspace.js', S = 'script.js';

const MUTANTS = [
  // ── the module ───────────────────────────────────────────────────────────
  { id: 'W01', file: W, why: 'derivation never says Report',
    from: "    if (_isObj(d.analysis)) return 'report';", to: "    if (false) return 'report';" },
  { id: 'W02', file: W, why: 'stageOf ignores the conversion facts',
    from: '  function stageOf(review) {\n    if (isConverted(review)) return TERMINAL_STAGE;',
    to:   '  function stageOf(review) {\n    if (false) return TERMINAL_STAGE;' },
  { id: 'W03', file: W, why: 'upgrade drops the tenants',
    from: '    data.tenants       = _arr(src.tenants);', to: '    data.tenants       = [];' },
  { id: 'W04', file: W, why: 'upgrade is no longer idempotent',
    from: '    data.activity      = _arr(src.activity);', to: '    data.activity      = _arr(src.activity).concat([{ type: "upgrade" }]);' },
  { id: 'W05', file: W, why: 'a person can choose Acquired',
    from: "    if (stage === TERMINAL_STAGE)  return { ok: false, review: row, changed: false, reason: 'acquired_is_set_by_conversion' };",
    to:   "    if (false)  return { ok: false, review: row, changed: false, reason: 'acquired_is_set_by_conversion' };" },
  { id: 'W06', file: W, why: 'an acquired review can still be moved',
    from: "    if (from === TERMINAL_STAGE)   return { ok: false, review: up, changed: false, reason: 'locked_after_acquisition' };",
    to:   "    if (false)   return { ok: false, review: up, changed: false, reason: 'locked_after_acquisition' };" },
  { id: 'W07', file: W, why: 'activity is never capped',
    from: '    if (next.length > ACTIVITY_CAP) {', to: '    if (false) {' },
  { id: 'W08', file: W, why: 'an empty save response is treated as success',
    from: '    if (rows.length > 0) {', to: '    if (rows.length >= 0) {' },
  { id: 'W09', file: W, why: 'a database error is treated as success',
    from: '    if (r.error) {\n      var msg', to: '    if (false) {\n      var msg' },
  { id: 'W10', file: W, why: 'a conflict is reported as missing',
    from: "    return { ok: false, kind: r.hadRev ? 'conflict' : 'missing', message: r.hadRev",
    to:   "    return { ok: false, kind: 'missing', message: r.hadRev" },
  { id: 'W11', file: W, why: 'the save payload leaks the whole row',
    from: '      name:   r.name,\n      status: r.status,', to: '      name:   r.name, id: r.id, updated_at: r.updated_at,\n      status: r.status,' },
  { id: 'W12', file: W, why: 'every chip is selectable',
    from: '        selectable: !locked && key !== TERMINAL_STAGE,', to: '        selectable: true,' },
  { id: 'W13', file: W, why: 'a revert leaves the stage at Acquired',
    from: '    up.data.stage = deriveStage(up);\n    return recordActivity(up, {\n      type: \'conversion_reverted\'',
    to:   '    up.data.stage = TERMINAL_STAGE;\n    return recordActivity(up, {\n      type: \'conversion_reverted\'' },

  // ── the glue ─────────────────────────────────────────────────────────────
  { id: 'G01', file: S, why: 'the save drops the revision filter',
    from: "    if (rev) q = q.eq('updated_at', rev);", to: "    if (false) q = q.eq('updated_at', rev);" },
  { id: 'G02', file: S, why: 'a conflict does not reload the stored row',
    from: '  const fresh = Array.isArray(rows) && rows[0] ? _acqAdopt(rows[0]) : null;', to: '  const fresh = null;' },
  { id: 'G03', file: S, why: 'loaded rows are not adopted',
    from: '    return (data || []).map(_acqAdopt);', to: '    return data || [];' },
  { id: 'G04', file: S, why: 'adopt forgets the revision it read',
    from: '  if (row && row.id && row.updated_at) _acqRevs.set(row.id, String(row.updated_at));', to: '  void row;' },
  { id: 'G05', file: S, why: 'a new review is created in the legacy shape',
    from: '      data:       _AW().newReviewData(),', to: '      data:       { tenants: [], invoices: [], totalSqFt: 0, documents: [], analysis: null },' },
  { id: 'G06', file: S, why: 'conversion does not mark the review acquired',
    from: '    review.data   = _AW().markAcquired(review, { actor: _acqActor(), repair: _isRepair }).data;', to: '    void _isRepair;' },
  { id: 'G07', file: S, why: 'a revert does not re-derive the stage',
    from: '      review.data   = _AW().markReverted(review, { actor: _acqActor(), propertyId: propId }).data;', to: '      void propId;' },
  { id: 'G08', file: S, why: 'running the analysis is not recorded',
    from: "    _acqRecord(review, { type: 'analysis_run', summary: 'Risk analysis run',", to: "    void (review, { type: 'analysis_run', summary: 'Risk analysis run'," },
  { id: 'G09', file: S, why: 'opening a review does not render its stage',
    from: '  _renderAcqConvertAction(review);\n  _renderAcqStageChips(review);\n\n  const sqftEl', to: '  _renderAcqConvertAction(review);\n\n  const sqftEl' },
  { id: 'G10', file: S, why: 'a stage click is not saved',
    from: '  review.data = r.review.data;\n  _renderAcqStageChips(review);\n  _saveAcqReview(review);\n}', to: '  review.data = r.review.data;\n  _renderAcqStageChips(review);\n}' },
  { id: 'G11', file: S, why: 'the demo seed records the timestamp it SENT as a revision',
    from: '    _acqReviews.unshift(_AW().upgradeReview(review));', to: '    _acqReviews.unshift(_acqAdopt(review));' },
  { id: 'G12', file: S, why: 'the conflict handler keeps the local copy',
    from: '    if (idx >= 0) _acqReviews[idx] = fresh; else _acqReviews.unshift(fresh);', to: '    void idx;' },
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'acq-ws-mut-'));
// The suites need the page and everything it loads; copy the tree minus the
// heavy, irrelevant directories.
for (const entry of fs.readdirSync(ROOT)) {
  if (['node_modules', '.git', 'scratchpad', 'evidence', 'assets'].includes(entry)) continue;
  fs.cpSync(path.join(ROOT, entry), path.join(tmp, entry), { recursive: true });
}
try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(tmp, 'node_modules'), 'dir'); } catch (_) {}

const FILES = [...new Set(MUTANTS.map(m => m.file))];
const ORIGINAL = {};
for (const f of FILES) ORIGINAL[f] = fs.readFileSync(path.join(ROOT, f), 'utf8');

const SUITES = ['test-acquisition-workspace.js', 'test-e2e-acquisition-workspace.js'];
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
