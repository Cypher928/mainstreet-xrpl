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
    from: "), job.stage || 'extraction', job.property_id);",
    to:   "), job.stage || 'extraction');" },
  { id: 'R03', file: SCR, why: 'failLeaseJob drops the parameter, so the argument goes nowhere',
    from: 'function failLeaseJob(jobId, err, stage, propertyId) {',
    to:   'function failLeaseJob(jobId, err, stage) {\n  const propertyId = undefined;' },
  { id: 'R04', file: SCR, why: 'the property_id never reaches the update payload',
    from: '    ...(propertyId ? { property_id: propertyId } : {}),',
    to:   '' },
  { id: 'R05', file: SCR, why: 'the spread becomes unconditional, blanking the Map copy with undefined',
    from: '    ...(propertyId ? { property_id: propertyId } : {}),',
    to:   '    property_id: propertyId,' },

  // ── the guard ────────────────────────────────────────────────────────────
  { id: 'R06', file: SCR, why: 'the guard is removed, so a doomed row is written and retried again',
    from: "  if (!row.property_id) { logError('lease_job_sync_incomplete', new Error('no property_id on lease job ' + job.id), ctx); return Promise.resolve(false); }\n",
    to:   '' },
  { id: 'R07', file: SCR, why: 'the guard warns but still issues the write it just called doomed',
    from: "return Promise.resolve(false); }",
    to:   "} if (false) {" },
  { id: 'R08', file: SCR, why: 'the guard stops reporting, so the refusal is as silent as the 403 was',
    from: "logError('lease_job_sync_incomplete', new Error('no property_id on lease job ' + job.id), ctx); return Promise.resolve(false);",
    to:   "return Promise.resolve(false);" },
  { id: 'R09', file: SCR, why: 'the guard misses an explicit null because it tests presence, not value',
    from: '  if (!row.property_id) {',
    to:   "  if (!('property_id' in row)) {" },
  { id: 'R10', file: SCR, why: 'the guard sits AFTER the upsert, so the request still goes out',
    from: "  if (!row.property_id) { logError('lease_job_sync_incomplete', new Error('no property_id on lease job ' + job.id), ctx); return Promise.resolve(false); }\n  return Promise.resolve(db.from('lease_jobs').upsert(row))",
    to:   "  return Promise.resolve(db.from('lease_jobs').upsert(row))" },
  { id: 'R11', file: SCR, why: 'the guard throws instead of resolving, and every caller fires and forgets',
    from: "return Promise.resolve(false); }\n  return Promise.resolve(db.from('lease_jobs').upsert(row))",
    to:   "throw new Error('no property_id'); }\n  return Promise.resolve(db.from('lease_jobs').upsert(row))" },

  // ── what must NOT change ─────────────────────────────────────────────────
  { id: 'R12', file: SCR, why: 'the terminal retry is lost — a final status could go unrecorded again',
    from: '      if (!terminal) return false;',
    to:   '      return false;' },
  { id: 'R13', file: SCR, why: 'every failure retries, not just the terminal one',
    from: '      if (!terminal) return false;',
    to:   '      if (false) return false;' },
  { id: 'R14', file: SCR, why: 'in-memory fields stop being stripped and reach the wire',
    from: "  const row = Object.fromEntries(Object.entries(job).filter(([k]) => !k.startsWith('_')));",
    to:   '  const row = Object.assign({}, job);' },
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
