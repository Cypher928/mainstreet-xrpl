'use strict';
/**
 * tools/lease-job-reaper-mutation.js — can a lease job lose its property again?
 *
 *   node tools/lease-job-reaper-mutation.js
 *
 * The fix is three tokens wide: a column in a SELECT, an argument passed on,
 * and a guard before a write. Each mutant below removes exactly one of them, or
 * loosens the guard until it stops guarding. Every one must be caught — a suite
 * that tolerates any of these is describing the fix rather than holding it.
 *
 * A FAILING BASELINE IS NOT A PASS.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SCR = 'script.js';

const MUTANTS = [
  // ── the column ───────────────────────────────────────────────────────────
  { id: 'R01', file: SCR, why: 'property_id is dropped from the reaper SELECT — the original bug',
    from: ".select('id,status,stage,updated_at,property_id')",
    to:   ".select('id,status,stage,updated_at')" },

  // ── passing it on ────────────────────────────────────────────────────────
  { id: 'R02', file: SCR, why: 'the reaper stops handing property_id to failLeaseJob',
    from: "), job.stage || 'extraction', job.property_id, { scopeActive: true });",
    to:   "), job.stage || 'extraction', undefined, { scopeActive: true });" },
  { id: 'R03', file: SCR, why: 'failLeaseJob drops the parameter, so the argument goes nowhere',
    from: 'function failLeaseJob(jobId, err, stage, propertyId, opts) {',
    to:   'function failLeaseJob(jobId, err, stage, _propertyId, opts) {\n  const propertyId = undefined;' },
  { id: 'R04', file: SCR, why: 'the property_id never reaches the update payload',
    from: '    ...(propertyId ? { property_id: propertyId } : {}),',
    to:   '' },
  { id: 'R05', file: SCR, why: 'the spread becomes unconditional, blanking the Map copy with undefined',
    from: '    ...(propertyId ? { property_id: propertyId } : {}),',
    to:   '    property_id: propertyId,' },

  // ── the guard, and the retry ladder, MOVED TO lease-job-write.js in R2 ───
  //
  // R06–R14 lived here and targeted _syncJobToDb's body: the property_id
  // guard, its placement before the request, resolving rather than throwing,
  // the terminal retry, and the underscore strip. R2 lifted that body into
  // the module, so those anchors no longer exist in script.js.
  //
  // They are NOT dropped — they are owned by tools/lease-job-ordering-mutation.js,
  // which mutates them in their new home and kills every one:
  //   O22  the property_id guard is lost (was R06/R07)
  //   O15  an expected stale refusal is reported as an error (was R08)
  //   O16  a missing job is silently treated as a refusal (was R09/R10)
  //   O17  an unguarded zero-row write is treated as success (was R11)
  //   O10  terminal writes become guarded (was R12/R13)
  //   O23  in-memory fields reach the wire (was R14)
  //
  // A retired mutant with a named, demonstrably-killing replacement is
  // bookkeeping. One retired without is how coverage quietly rots.

  // ── what must NOT change ─────────────────────────────────────────────────
  { id: 'R15', file: SCR, why: 'the stage a job died at is overwritten with a default',
    from: "    stage:                   stage || 'extraction',",
    to:   "    stage:                   'extraction'," },
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'reapmut-'));
fs.cpSync(ROOT, tmp, {
  recursive: true,
  filter: (src) => {
    const rel = path.relative(ROOT, src);
    return !(rel === '.git' || rel.startsWith('.git' + path.sep) || rel === 'node_modules' || rel.startsWith('node_modules' + path.sep));
  },
});
const ORIGINAL = {};
for (const m of MUTANTS) if (!ORIGINAL[m.file]) ORIGINAL[m.file] = fs.readFileSync(path.join(ROOT, m.file), 'utf8');

const SUITES = ['test-lease-job-reaper.js'];
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
