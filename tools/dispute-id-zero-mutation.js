'use strict';
/**
 * tools/dispute-id-zero-mutation.js — does the zero-id suite bite?
 *
 *   node tools/dispute-id-zero-mutation.js
 *
 * Four kinds of mutant:
 *
 *   REGRESS   the truthiness guard comes back, in any of its disguises — `!d.id`,
 *             `d.id === 0`, a falsy-coalescing rewrite. This is the defect: a
 *             dispute deleted on load and the property falsely called malformed.
 *   IDENTITY  the displayed number stops being the record's own id — array
 *             index, index + 1, id + 1, id - 1. The numbering was correct and
 *             must stay correct; the suite uses NON-SEQUENTIAL ids (0, 4, 9)
 *             precisely so an ordinal implementation cannot pass by accident.
 *   CONTRACT  the identity predicate starts accepting things that are not
 *             identifiers (null, '', NaN) or rejecting things that are ('0', a
 *             negative number).
 *   SIGNAL    a valid record still sets _malformed, or an invalid one stops
 *             setting it — the audit event that claims the data was corrupt.
 *
 * A FAILING BASELINE IS NOT A PASS. The unmutated copy is asserted before any
 * mutant runs and the harness exits non-zero if it fails.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const MUTATED_FILES = ['script.js'];

const GUARD = "      if (!d || typeof d !== 'object' || !_isUsableRecordId(d.id)) { malformed = true; return false; }";
const META  = '        <div class="d-meta">#${d.id + 1} · ${esc(d.tenantName)} · ${fmtTs(d.timestamp)}${typeLabel}${sevLabel}</div>';

const MUTANTS = [
  // ── REGRESS: the truthiness guard returns ───────────────────────────────
  { id: 'Z01', file: 'script.js', why: 'the original `!d.id` truthiness guard comes back',
    from: GUARD,
    to:   "      if (!d || typeof d !== 'object' || !d.id) { malformed = true; return false; }" },
  { id: 'Z02', file: 'script.js', why: 'zero is singled out and rejected explicitly',
    from: GUARD,
    to:   "      if (!d || typeof d !== 'object' || d.id === 0 || !_isUsableRecordId(d.id)) { malformed = true; return false; }" },
  { id: 'Z03', file: 'script.js', why: 'the id check is dropped entirely — malformed records are kept',
    from: GUARD,
    to:   "      if (!d || typeof d !== 'object') { malformed = true; return false; }" },
  { id: 'Z04', file: 'script.js', why: 'a falsy-coalescing rewrite reintroduces the same bug',
    from: GUARD,
    to:   "      if (!d || typeof d !== 'object' || !(d.id || null)) { malformed = true; return false; }" },

  // ── CONTRACT: the predicate stops describing an identifier ──────────────
  { id: 'Z05', file: 'script.js', why: 'the predicate accepts anything, including null and blank',
    from: '  if (typeof v === \'number\') return Number.isFinite(v);\n  if (typeof v === \'string\') return v.trim() !== \'\';\n  return false;',
    to:   '  return true;' },
  { id: 'Z06', file: 'script.js', why: 'the predicate rejects everything',
    from: '  if (typeof v === \'number\') return Number.isFinite(v);\n  if (typeof v === \'string\') return v.trim() !== \'\';\n  return false;',
    to:   '  return false;' },
  { id: 'Z07', file: 'script.js', why: 'the predicate falls back to truthiness',
    from: '  if (typeof v === \'number\') return Number.isFinite(v);\n  if (typeof v === \'string\') return v.trim() !== \'\';\n  return false;',
    to:   '  return !!v;' },
  { id: 'Z08', file: 'script.js', why: 'a blank string becomes a usable id',
    from: "  if (typeof v === 'string') return v.trim() !== '';",
    to:   "  if (typeof v === 'string') return true;" },
  { id: 'Z09', file: 'script.js', why: 'NaN and Infinity become usable ids',
    from: "  if (typeof v === 'number') return Number.isFinite(v);",
    to:   "  if (typeof v === 'number') return true;" },
  { id: 'Z10', file: 'script.js', why: 'only positive numbers count, so zero is rejected again',
    from: "  if (typeof v === 'number') return Number.isFinite(v);",
    to:   "  if (typeof v === 'number') return Number.isFinite(v) && v > 0;" },
  { id: 'Z11', file: 'script.js', why: 'string ids stop being accepted, narrowing the contract',
    from: "  if (typeof v === 'string') return v.trim() !== '';",
    to:   '  if (typeof v === \'string\') return false;' },

  // ── SIGNAL: the malformed flag stops meaning what it says ───────────────
  { id: 'Z12', file: 'script.js', why: 'a valid record still raises the malformed audit signal',
    from: GUARD,
    to:   "      if (!d || typeof d !== 'object' || !_isUsableRecordId(d.id)) { malformed = true; return false; }\n      malformed = true;" },
  { id: 'Z13', file: 'script.js', why: 'a genuinely malformed record stops raising it',
    from: GUARD,
    to:   "      if (!d || typeof d !== 'object' || !_isUsableRecordId(d.id)) { return false; }" },

  // ── IDENTITY: the displayed number stops being the record's own id ──────
  { id: 'Z14', file: 'script.js', why: 'the register renumbers cards by array position instead of by id',
    from: '  function renderCard(d) {',
    to:   '  let _pos = 0;\n  function renderCard(d) {\n    d = { ...d, id: _pos++ };' },
  { id: 'Z15', file: 'script.js', why: 'the register meta drops the +1, so ids and labels disagree',
    from: META, to: META.replace('#${d.id + 1}', '#${d.id}') },
  { id: 'Z16', file: 'script.js', why: 'the register meta adds 2 instead of 1',
    from: META, to: META.replace('#${d.id + 1}', '#${d.id + 2}') },
  { id: 'Z17', file: 'script.js', why: 'the register meta subtracts 1',
    from: META, to: META.replace('#${d.id + 1}', '#${d.id - 1}') },
  { id: 'Z18', file: 'script.js', why: 'the workspace opens a dispute by its displayed ordinal, not its id',
    from: 'openDisputeWorkspace(${d.id})', to: 'openDisputeWorkspace(${d.id + 1})' },

  // ── the id scheme itself must not move ──────────────────────────────────
  { id: 'Z19', file: 'script.js', why: 'nextDisputeId starts at 1, changing the id scheme',
    from: 'let nextDisputeId = 0;', to: 'let nextDisputeId = 1;' },
  { id: 'Z20', file: 'script.js', why: 'the id allocator stops advancing past the highest id',
    from: '      nextDisputeId = Math.max(...savedDisputes.map(d => d.id + 1), 0);',
    to:   '      nextDisputeId = savedDisputes.length;' },
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dizmut-'));
fs.cpSync(ROOT, tmp, {
  recursive: true,
  filter: (src) => {
    const rel = path.relative(ROOT, src);
    return !(rel === '.git' || rel.startsWith('.git' + path.sep) ||
             rel === 'node_modules' || rel.startsWith('node_modules' + path.sep));
  },
});
const ORIGINAL = {};
for (const f of MUTATED_FILES) ORIGINAL[f] = fs.readFileSync(path.join(ROOT, f), 'utf8');

const SUITES = ['test-dispute-id-zero.js'];
function runSuites() {
  for (const suite of SUITES) {
    try {
      execFileSync(process.execPath, [suite], {
        cwd: tmp, stdio: 'pipe', timeout: 300000,
        env: Object.assign({}, process.env, { DIZ_PORT: '8982' }),
      });
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
    try {
      execFileSync(process.execPath, [suite], { cwd: tmp, stdio: 'pipe', timeout: 300000,
        env: Object.assign({}, process.env, { DIZ_PORT: '8982' }) });
    } catch (e) { console.error('\n── ' + suite + ' ──\n' + String(e.stdout || e.message).slice(-3000)); }
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
  fs.writeFileSync(path.join(tmp, m.file), src.slice(0, i) + m.to + src.slice(i + m.from.length));
  const passedM = runSuites();
  fs.writeFileSync(path.join(tmp, m.file), src);
  if (passedM) { survived.push(`${m.id} ${m.file}: ${m.why}`); console.log(`  LIVE ${m.id}  ${m.why}`); }
  else         { killed++;                                    console.log(`  kill ${m.id}  ${m.why}`); }
}

console.log(`\n${killed}/${MUTANTS.length} killed`);
if (survived.length) {
  console.log('\nSURVIVORS — each needs a written verdict (real gap or equivalent):');
  survived.forEach(s => console.log('  · ' + s));
}
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(survived.length ? 1 : 0);
