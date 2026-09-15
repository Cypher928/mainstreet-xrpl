'use strict';
/**
 * tools/session-persistence-mutation.js — do the two Pilot fixes hold?
 *
 *   node tools/session-persistence-mutation.js
 *
 * Both defects were races or cross-surface disagreements, which is exactly the
 * shape that survives a green unit suite. Each mutant restores one of the
 * decisions that produced them:
 *
 *   S01  _authHeaders returns {} when a refresh comes back empty — THE
 *        ORIGINAL DEFECT. The request goes out unsigned, the server correctly
 *        answers 401, and the client reads its own omission as an expired
 *        session.
 *   S02  refreshes stop being single-flight. Supabase rotates the refresh
 *        token, so concurrent callers race and the losers get nothing.
 *   S03  _onAuthLost declares expiry without asking the auth authority.
 *   S04  a run is recorded with no `persisted` field, so an absent flag reads
 *        as persisted and a refused save becomes history again.
 *   S05  the flag is set from nothing instead of from the save result.
 *   S06  renderPreviousRuns stops filtering, which is the exact line that put
 *        an unsaved run under Previous Runs badged Latest.
 *   S07  _isPersistedRun says yes to everything.
 *   S08  _isPersistedRun says no to a legacy run with no flag, which would hide
 *        real history restored from a snapshot. The opposite error to S07, and
 *        the reason the predicate tests for an explicit false.
 *   S09  a 200 that stored zero rows counts as a save.
 *   S10  the destructive client-side pre-delete comes back: it wiped the
 *        previous run's rows before a POST that could still fail.
 *   S11  the unsaved warning is never cleared, so it outlives the failure that
 *        raised it and a later successful run still reads as unsaved.
 *
 * A FAILING BASELINE IS NOT A PASS. The unmutated copy is asserted before any
 * mutant runs and the harness exits non-zero if it fails.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

const FALLBACK_TOKEN = `      const r = await _refreshSessionOnce();
      const tok = r?.data?.session?.access_token;
      if (tok) return { 'Authorization': \`Bearer \${tok}\` };`;
const SINGLE_FLIGHT = `  if (!_refreshInFlight) {
    _refreshInFlight = Promise.resolve()
      .then(() => db.auth.refreshSession())
      .catch(e => ({ data: null, error: e }))
      .finally(() => { _refreshInFlight = null; });
  }
  return _refreshInFlight;`;
const VERIFY = `    const { data } = await db.auth.getSession();
    if (data?.session) {`;
const RUN_FLAG = '    persisted:     false,';
const STAMP    = '    if (camRuns.length) camRuns[0].persisted = !!_camSave.ok;';
const FILTER   = '  const history = camRuns.slice(1).filter(_isPersistedRun);';
const PREDICATE = 'function _isPersistedRun(run) { return !run || run.persisted !== false; }';
const ZERO_ROWS = `    if (rows.length > 0 && written === 0) {`;
const CLEAR_WARN = `function _clearCamSaveWarning() {
  const banner = document.getElementById('camSaveWarningBanner');
  if (banner) { banner.textContent = ''; banner.style.display = 'none'; }
}`;
const NO_PREDELETE = '  const reconciledAt = new Date().toISOString();';

const MUTANTS = [
  { id: 'S01', file: 'script.js', why: 'a failed refresh sends NO token — THE ORIGINAL DEFECT',
    from: FALLBACK_TOKEN,
    to: `      const r = await _refreshSessionOnce();
      const tok = r?.data?.session?.access_token;
      if (!tok) return {};
      if (tok) return { 'Authorization': \`Bearer \${tok}\` };` },
  { id: 'S02', file: 'script.js', why: 'refreshes are no longer single-flight, so concurrent callers race',
    from: SINGLE_FLIGHT,
    to: `  return Promise.resolve()
    .then(() => db.auth.refreshSession())
    .catch(e => ({ data: null, error: e }));` },
  { id: 'S03', file: 'script.js', why: '_onAuthLost declares expiry without asking the auth authority',
    from: VERIFY,
    to: `    const { data } = await db.auth.getSession();
    if (false) {` },

  { id: 'S04', file: 'script.js', why: 'a run is recorded with no persisted field, so absent reads as saved',
    from: RUN_FLAG, to: '' },
  { id: 'S05', file: 'script.js', why: 'the flag is set true regardless of what the save did',
    from: STAMP, to: '    if (camRuns.length) camRuns[0].persisted = true;' },
  { id: 'S06', file: 'script.js', why: 'Previous Runs stops filtering — the line that listed an unsaved run as Latest',
    from: FILTER, to: '  const history = camRuns.slice(1);' },
  { id: 'S07', file: 'script.js', why: 'the predicate calls every run persisted',
    from: PREDICATE, to: 'function _isPersistedRun(run) { return true; }' },
  { id: 'S08', file: 'script.js', why: 'the predicate hides legacy runs that have no flag — real history vanishes',
    from: PREDICATE, to: 'function _isPersistedRun(run) { return !!(run && run.persisted === true); }' },

  { id: 'S09', file: 'script.js', why: 'a 200 that stored zero rows counts as a save',
    from: ZERO_ROWS, to: '    if (false) {' },
  { id: 'S10', file: 'script.js', why: 'the destructive client-side pre-delete returns',
    from: NO_PREDELETE,
    to: `  try { await db.from('cam_reconciliations').delete().match({ property_id: propertyId, year: year }); } catch (_e) {}
  const reconciledAt = new Date().toISOString();` },
  { id: 'S11', file: 'script.js', why: 'the unsaved warning is never cleared and outlives its failure',
    from: CLEAR_WARN,
    to: `function _clearCamSaveWarning() {
  return;
}` },
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sessmut-'));
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

// The new suite owns both behaviours. test-security.js owns the genuine
// signed-out path, so a mutant cannot be "killed" by breaking the rescue that
// has to keep working — S03 in particular must fail the new suite while
// test-security stays green.
const SUITES = ['test-e2e-session-persistence-truth.js', 'test-security.js'];
function runSuites() {
  for (const suite of SUITES) {
    try {
      execFileSync(process.execPath, [suite], { cwd: tmp, stdio: 'pipe', timeout: 900000 });
    } catch (_) { return false; }
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
  if (i === -1) {
    console.log(`  ??   ${m.id}  ANCHOR NOT FOUND in ${m.file} — malformed mutant`);
    survived.push(m.id + ' (malformed)');
    continue;
  }
  if (src.indexOf(m.from, i + 1) !== -1) {
    console.log(`  ??   ${m.id}  ANCHOR NOT UNIQUE in ${m.file} — mutating only the first`);
  }
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
