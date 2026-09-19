'use strict';
/**
 * tools/lease-job-ordering-mutation.js — does the ordering guard actually bite?
 *
 *   node tools/lease-job-ordering-mutation.js
 *
 * The invariant here is negative — "a stale write changes nothing" — and
 * negative invariants pass trivially when nothing is stale. So each mutant
 * removes exactly one guard, inverts one comparison, or confuses one of the two
 * meanings of a zero-row result, and the suite must notice. A harness that only
 * replayed writes in order could not tell any of these apart, which is how the
 * original defect survived in production for two months.
 *
 * A FAILING BASELINE IS NOT A PASS.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const MOD = 'lease-job-write.js';
const SCR = 'script.js';

const MUTANTS = [
  // ── the terminal guard ───────────────────────────────────────────────────
  { id: 'O01', file: MOD, why: 'a late stage write may overwrite a terminal job — the original defect',
    from: "    filters.push(['not', 'status', 'in', _list(TERMINAL)]);",
    to:   '' },
  { id: 'O02', file: MOD, why: 'the terminal set shrinks, so review_required is overwritable',
    from: "  const TERMINAL = ['completed', 'failed', 'review_required'];",
    to:   "  const TERMINAL = ['completed', 'failed'];" },
  { id: 'O03', file: MOD, why: 'the guard is inverted — only terminal jobs accept stage writes',
    from: "    filters.push(['not', 'status', 'in', _list(TERMINAL)]);",
    to:   "    filters.push(['in', 'status', _list(TERMINAL)]);" },

  // ── the progress guard ───────────────────────────────────────────────────
  { id: 'O04', file: MOD, why: 'progress may move backward — an older stage overwrites a newer one',
    from: "    if (prog !== null) filters.push(['lte', 'progress', prog]);",
    to:   '' },
  { id: 'O05', file: MOD, why: 'lte becomes gte, so ONLY backward moves are allowed',
    from: "    if (prog !== null) filters.push(['lte', 'progress', prog]);",
    to:   "    if (prog !== null) filters.push(['lt', 'progress', prog]);" },

  // ── the retry generation ─────────────────────────────────────────────────
  { id: 'O06', file: MOD, why: 'a pre-retry write drags the fresh attempt back to its old stage',
    from: "    const gen = _int(row && row.retry_count);\n    if (gen !== null) filters.push(['eq', 'retry_count', gen]);",
    to:   '' },
  { id: 'O07', file: MOD, why: 'the reset is ungated, so a replayed retry resets a running job again',
    from: "      if (gen !== null) filters.push(['lt', 'retry_count', gen]);",
    to:   '' },
  { id: 'O08', file: MOD, why: 'the reset uses lte, so the same generation applies twice',
    from: "      if (gen !== null) filters.push(['lt', 'retry_count', gen]);",
    to:   "      if (gen !== null) filters.push(['lte', 'retry_count', gen]);" },
  { id: 'O09', file: MOD, why: 'a reset is also progress-guarded, so a retry can never reset',
    from: "      return { mode: 'reset', filters, guarded: gen !== null };",
    to:   "      filters.push(['lte', 'progress', _int(row && row.progress)]);\n      return { mode: 'reset', filters, guarded: gen !== null };" },

  // ── terminal writes must win ─────────────────────────────────────────────
  { id: 'O10', file: MOD, why: 'terminal writes become guarded, so a finished job may fail to record it',
    from: "      return { mode: 'terminal', filters, guarded: false };",
    to:   "      filters.push(['lte', 'progress', _int(row && row.progress)]);\n      return { mode: 'terminal', filters, guarded: false };" },

  // ── the reaper's scope ───────────────────────────────────────────────────
  { id: 'O11', file: MOD, why: 'a stale reaper turns a job that has since completed into failed',
    from: "        filters.push(['in', 'status', _list(ACTIVE)]);",
    to:   '' },
  { id: 'O12', file: MOD, why: 'the reaper scope widens to include terminal states',
    from: "  const ACTIVE = ['queued', 'processing'];",
    to:   "  const ACTIVE = ['queued', 'processing', 'completed', 'failed', 'review_required'];" },
  { id: 'O13', file: SCR, why: 'the reaper stops scoping its write at the call site',
    from: "), job.stage || 'extraction', job.property_id, { scopeActive: true });",
    to:   "), job.stage || 'extraction', job.property_id);" },
  { id: 'O14', file: SCR, why: 'failLeaseJob drops caller options, so scopeActive never arrives',
    from: '  }, { terminal: true, ...(opts || {}) });',
    to:   '  }, { terminal: true });' },

  // ── zero-row classification ──────────────────────────────────────────────
  { id: 'O15', file: MOD, why: 'an expected stale refusal is reported as an error',
    from: '      if (rows.length) return { ok: true };\n      if (!p.guarded) {',
    to:   '      if (rows.length) return { ok: true };\n      if (true) {' },
  { id: 'O16', file: MOD, why: 'a missing job is silently treated as a refusal, so it is never reported',
    from: "            if (!exists) log('lease_job_sync_missing', new Error('lease job ' + row.id + ' does not exist'), ctx);",
    to:   '            if (false) {}' },
  { id: 'O17', file: MOD, why: 'an unguarded write that matched nothing is treated as success',
    from: '      if (!p.guarded) {',
    to:   '      if (false) {' },

  // ── mode selection ───────────────────────────────────────────────────────
  { id: 'O18', file: MOD, why: 'the insert path becomes a filtered update, so a new job never lands',
    from: "      if (p.mode === 'insert') return Promise.resolve(db.from('lease_jobs').upsert(row).select('id'));",
    to:   '' },
  { id: 'O19', file: SCR, why: 'createLeaseJob stops declaring itself an insert',
    from: '  _syncJobToDb(job, { insert: true });',
    to:   '  _syncJobToDb(job);' },
  { id: 'O20', file: SCR, why: 'retryLeaseJob stops declaring itself a reset, so retry is refused',
    from: '  }, { reset: true });',
    to:   '  });' },

  // ── the delegation and the awaits ────────────────────────────────────────
  { id: 'O21', file: SCR, why: 'updateLeaseJob stops returning the write, so the reaper await is fake again',
    from: '  return _syncJobToDb(job, opts);\n}',
    to:   '  _syncJobToDb(job, opts);\n  return job;\n}' },
  { id: 'O22', file: MOD, why: 'the property_id guard is lost, reviving the 403 loop R1 fixed',
    from: '    if (!row.property_id) {',
    to:   '    if (false) {' },
  { id: 'O23', file: MOD, why: 'in-memory fields stop being stripped and reach the wire',
    from: "    return Object.fromEntries(Object.entries(job || {}).filter(([k]) => !k.startsWith('_')));",
    to:   '    return Object.assign({}, job || {});' },
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ordmut-'));
fs.cpSync(ROOT, tmp, {
  recursive: true,
  filter: (src) => {
    const rel = path.relative(ROOT, src);
    return !(rel === '.git' || rel.startsWith('.git' + path.sep) || rel === 'node_modules' || rel.startsWith('node_modules' + path.sep));
  },
});
const ORIGINAL = {};
for (const m of MUTANTS) if (!ORIGINAL[m.file]) ORIGINAL[m.file] = fs.readFileSync(path.join(ROOT, m.file), 'utf8');

const SUITES = ['test-lease-job-ordering.js', 'test-lease-job-reaper.js'];
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
