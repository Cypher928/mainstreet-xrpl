'use strict';
/**
 * tools/activity-merge-mutation.js — does "local may add, never erase" bite?
 *
 *   node tools/activity-merge-mutation.js
 *
 * The rule this protects is one sentence: local state may ADD activity the
 * database has not seen, and must never ERASE activity the database holds.
 * Before P2 it was not protected at all — `activityLog` rode into the merged
 * property on `...base`, and `base` is picked on TENANT COUNT, so a local
 * snapshot carrying one more tenant deleted entries the database held. The
 * next save made the deletion durable. Two pilot entries went that way.
 *
 * A rule that is one sentence is also one token from being wrong. Each mutant
 * below is that one token: an identity that is too loose or too tight, a
 * direction reversed, a ceiling removed, a delegation quietly re-implemented.
 * Every one must be caught by the suites, or the suite is describing the code
 * rather than constraining it.
 *
 * A FAILING BASELINE IS NOT A PASS.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TM  = 'timeline-merge.js';
const SCR = 'script.js';

const MUTANTS = [
  // ── the invariant itself: never erase ────────────────────────────────────
  { id: 'A01', file: TM, why: 'the database side is dropped — the exact pilot data loss, restored',
    from: '    const merged = [...db, ...lsOnly].sort((a, b) => _time(b) - _time(a));',
    to:   '    const merged = [...lsOnly].sort((a, b) => _time(b) - _time(a));' },
  { id: 'A02', file: TM, why: 'an empty local log wins, erasing everything the DB holds',
    from: '    const db  = Array.isArray(dbLog) ? dbLog.filter(e => e && typeof e === \'object\') : [];',
    to:   '    const db  = (Array.isArray(dbLog) && (!Array.isArray(lsLog) || lsLog.length)) ? dbLog.filter(e => e && typeof e === \'object\') : [];' },
  { id: 'A03', file: SCR, why: 'the monolith falls back to the local copy when the module is absent',
    from: '    : (Array.isArray(dbData.activityLog) ? dbData.activityLog : []);',
    to:   '    : (Array.isArray(lsData.activityLog) ? lsData.activityLog : []);' },
  { id: 'A04', file: SCR, why: 'the delegation is reverted to the tenant-count pick on `base`',
    from: '    activityLog:       _mergedAct,\n',
    to:   '' },
  { id: 'A05', file: SCR, why: 'the merge arguments are reversed, so local beats the database',
    from: '    ? TimelineMerge.mergeActivityLogs(dbData.activityLog, lsData.activityLog)',
    to:   '    ? TimelineMerge.mergeActivityLogs(lsData.activityLog, dbData.activityLog)' },

  // ── the other half: local additions are kept ─────────────────────────────
  { id: 'A06', file: TM, why: 'local-only entries are discarded — the rule loses its "may add"',
    from: '    const merged = [...db, ...lsOnly].sort((a, b) => _time(b) - _time(a));',
    to:   '    const merged = [...db].sort((a, b) => _time(b) - _time(a));' },

  // ── identity: too loose ──────────────────────────────────────────────────
  { id: 'A07', file: TM, why: 'the dedupe check is removed — every shared entry arrives twice',
    from: '      if (!k || seen.has(k)) return false;',
    to:   '      if (!k) return false;' },
  { id: 'A08', file: TM, why: 'admitted local keys never join `seen`, so a local duplicate passes twice',
    from: '      seen.add(k);\n      return true;',
    to:   '      return true;' },
  { id: 'A09', file: TM, why: 'the database keys are never collected, so nothing dedupes against them',
    from: '    for (const e of db) { const k = eventKey(e); if (k) seen.add(k); }',
    to:   '    for (const e of db) { const k = eventKey(e); if (k && false) seen.add(k); }' },

  // ── identity: too tight (a false collision erases real history) ──────────
  { id: 'A10', file: TM, why: 'identity ignores the timestamp — two exports of the same log collapse',
    from: "    return 'k:' + [ev.type ?? '', ev.timestamp ?? '', ev.title ?? ''].join('\\u001f');",
    to:   "    return 'k:' + [ev.type ?? '', ev.title ?? ''].join('\\u001f');" },
  { id: 'A11', file: TM, why: 'identity is the type alone — every entry of a kind becomes one entry',
    from: "    return 'k:' + [ev.type ?? '', ev.timestamp ?? '', ev.title ?? ''].join('\\u001f');",
    to:   "    return 'k:' + [ev.type ?? ''].join('\\u001f');" },
  { id: 'A12', file: TM, why: 'the id is ignored, so post-P0.5 entries fall back to the composite',
    from: "    if (typeof id === 'string' && id.trim()) return 'id:' + id.trim();",
    to:   "    if (typeof id === 'string' && id.trim() && false) return 'id:' + id.trim();" },

  // ── order and ceiling ────────────────────────────────────────────────────
  { id: 'A13', file: TM, why: 'the sort is inverted — oldest first, and the cap then drops the newest',
    from: '    const merged = [...db, ...lsOnly].sort((a, b) => _time(b) - _time(a));',
    to:   '    const merged = [...db, ...lsOnly].sort((a, b) => _time(a) - _time(b));' },
  { id: 'A14', file: TM, why: 'the cap trims the newest instead of the oldest',
    from: '    return merged.length > max ? merged.slice(0, max) : merged;\n  }\n\n  const api = { mergeTimelines, mergeActivityLogs,',
    to:   '    return merged.length > max ? merged.slice(-max) : merged;\n  }\n\n  const api = { mergeTimelines, mergeActivityLogs,' },
  { id: 'A15', file: TM, why: 'the ceiling drifts from the one logActivity keeps',
    from: '  const MAX_ACTIVITY = 200;',
    to:   '  const MAX_ACTIVITY = 500;' },

  // ── purity: a merge that edits its inputs breaks reload-then-save ────────
  { id: 'A16', file: TM, why: 'the merge sorts the caller\'s array in place',
    from: '    const merged = [...db, ...lsOnly].sort((a, b) => _time(b) - _time(a));',
    to:   '    const merged = db.sort((a, b) => _time(b) - _time(a)).concat(lsOnly);' },

  // ── malformed input must degrade, not throw — this is on the load path ───
  { id: 'A17', file: TM, why: 'a non-array local log throws instead of being ignored',
    from: '    const ls  = Array.isArray(lsLog) ? lsLog.filter(e => e && typeof e === \'object\') : [];',
    to:   '    const ls  = lsLog.filter(e => e && typeof e === \'object\');' },
  { id: 'A18', file: TM, why: 'null members survive the filter and reach eventKey',
    from: '    const db  = Array.isArray(dbLog) ? dbLog.filter(e => e && typeof e === \'object\') : [];',
    to:   '    const db  = Array.isArray(dbLog) ? dbLog.slice() : [];' },
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'actmut-'));
fs.cpSync(ROOT, tmp, {
  recursive: true,
  filter: (src) => {
    const rel = path.relative(ROOT, src);
    return !(rel === '.git' || rel.startsWith('.git' + path.sep) || rel === 'node_modules' || rel.startsWith('node_modules' + path.sep));
  },
});
const ORIGINAL = {};
for (const m of MUTANTS) if (!ORIGINAL[m.file]) ORIGINAL[m.file] = fs.readFileSync(path.join(ROOT, m.file), 'utf8');

const SUITES = ['test-timeline-merge.js'];
function runSuites() {
  const failed = [];
  for (const suite of SUITES) {
    try { execFileSync(process.execPath, [suite], { cwd: tmp, stdio: 'pipe', timeout: 120000 }); }
    catch (_) { failed.push(suite); }
  }
  return failed;
}

const baseline = runSuites();
console.log('Baseline (unmutated copy): ' + (baseline.length ? 'FAIL ' + baseline.join(', ') : 'PASS'));
if (baseline.length) {
  console.error('\nThe unmutated copy does not pass, so every result below would be meaningless. Nothing is mutated.');
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(2);
}

let killed = 0, survived = 0;
const survivors = [];
for (const m of MUTANTS) {
  const src = ORIGINAL[m.file];
  if (src.indexOf(m.from) === -1) {
    console.log(`  ?  ${m.id} anchor not found in ${m.file} — the harness is stale, not the product`);
    survived++; survivors.push(m.id + ' (anchor missing)');
    continue;
  }
  fs.writeFileSync(path.join(tmp, m.file), src.replace(m.from, m.to));
  const failed = runSuites();
  fs.writeFileSync(path.join(tmp, m.file), src);
  if (failed.length) { killed++; console.log(`  \x1b[32m☠\x1b[0m  ${m.id} killed — ${m.why}`); }
  else { survived++; survivors.push(m.id); console.log(`  \x1b[31m✗\x1b[0m  ${m.id} SURVIVED — ${m.why}`); }
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log('\n' + '─'.repeat(58));
console.log(`${killed} killed, ${survived} survived of ${MUTANTS.length}`);
if (survived) { survivors.forEach(s => console.log('  · ' + s)); process.exit(1); }
