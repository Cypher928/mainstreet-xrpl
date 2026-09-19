'use strict';
/**
 * tools/unreadable-date-mutation.js — can unreadable collapse back into missing?
 *
 *   node tools/unreadable-date-mutation.js
 *
 * The defect D-1 fixed is a lost distinction, not a wrong number: a lease whose
 * term ends "upon substantial completion of the Landlord Work" normalised to the
 * same '' as a lease with no end date at all, and then inherited the assumed-end
 * behaviour — unreadable → missing → assumed full period → BILLED.
 *
 * The distinction is carried by one field (`unreadableDates`) and read back by
 * one resolver (`_readField`), so it has exactly two places to be lost and a
 * handful of ways to be lost in each. Four kinds of mutant:
 *
 *   CAPTURE   the normaliser stops recording what it could not read, or records
 *             it for the wrong field, or invents one for a date that is simply
 *             absent. Any of these makes two states into one.
 *   CARRY     the record is captured but does not survive — dropped from the
 *             allow-list (so it never reaches storage), or lost on the second
 *             normalise every load performs, or left standing after the manager
 *             corrects the date.
 *   RESOLVE   the reader stops pairing the empty field with the raw beside it,
 *             so the stored shape resolves `absent` again.
 *   CONSEQUENCE the distinction survives and stops mattering: the unreadable
 *             case is apportioned anyway, or classified as unknown_end, or its
 *             finding stops blocking billing. This is the class that matters
 *             most — a distinction nothing acts on is not a distinction.
 *
 * A FAILING BASELINE IS NOT A PASS. The unmutated copy is asserted before any
 * mutant runs and the harness exits non-zero if it fails.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const MUTATED_FILES = ['tenant-normalize.js', 'lease-period.js', 'reconciliation-engine.js'];

const KEEP    = '      const keep = r.unreadable ?? (_prior[k] ?? null);\n      if (keep) _unreadable[k] = String(keep);';
const CLEARS  = '      if (r.iso) continue;';
const PRIOR   = "    const _prior = (d.unreadableDates && typeof d.unreadableDates === 'object') ? d.unreadableDates : {};";
const ALLOW   = '      unreadableDates:       Object.keys(_unreadable).length ? _unreadable : null,';
const PAIR    = `    if (r.status === 'absent') {
      var u = t.unreadableDates;
      var raw = (u && typeof u === 'object') ? u[field] : null;
      if (raw != null && String(raw).trim() !== '') {
        return { value: null, status: 'unreadable', normalised: null, raw: String(raw).trim() };
      }
    }`;

const MUTANTS = [
  // ── CAPTURE: the normaliser stops recording the unreadable text ─────────
  { id: 'D01', file: 'tenant-normalize.js', why: 'nothing unreadable is ever recorded — THE ORIGINAL DEFECT',
    from: KEEP, to: '      const keep = null;\n      if (keep) _unreadable[k] = String(keep);' },
  { id: 'D02', file: 'tenant-normalize.js', why: 'the raw is recorded under the wrong field key',
    from: KEEP, to: "      const keep = r.unreadable ?? (_prior[k] ?? null);\n      if (keep) _unreadable['start_date'] = String(keep);" },
  { id: 'D03', file: 'tenant-normalize.js', why: 'an absent date invents an unreadable record, so missing looks unreadable',
    from: KEEP, to: "      const keep = r.unreadable ?? (_prior[k] ?? null) ?? 'unspecified';\n      if (keep) _unreadable[k] = String(keep);" },

  // ── CARRY: captured, then lost before anything can read it ─────────────
  { id: 'D04', file: 'tenant-normalize.js', why: 'the field is dropped from the allow-list, so storage never sees it',
    from: ALLOW, to: '' },
  { id: 'D05', file: 'tenant-normalize.js', why: 'the field is written but always null',
    from: ALLOW, to: '      unreadableDates:       null,' },
  { id: 'D06', file: 'tenant-normalize.js', why: 'the record is not carried across the second normalise every load performs',
    from: PRIOR, to: '    const _prior = {};' },
  { id: 'D07', file: 'tenant-normalize.js', why: 'a corrected date no longer clears the stale unreadable record',
    from: CLEARS, to: '      if (false) continue;' },

  // ── RESOLVE: the reader stops pairing the two back together ────────────
  { id: 'D08', file: 'lease-period.js', why: 'the resolver ignores the raw, so the stored shape reads absent again',
    from: PAIR, to: "    if (false) {\n      var u = t.unreadableDates;\n    }" },
  { id: 'D09', file: 'lease-period.js', why: 'the resolver reports unreadable as absent',
    from: "        return { value: null, status: 'unreadable', normalised: null, raw: String(raw).trim() };",
    to:   "        return { value: null, status: 'absent', normalised: null, raw: String(raw).trim() };" },
  { id: 'D10', file: 'lease-period.js', why: 'the resolver drops the quoted text, so nothing can cite the lease',
    from: "        return { value: null, status: 'unreadable', normalised: null, raw: String(raw).trim() };",
    to:   "        return { value: null, status: 'unreadable', normalised: null, raw: null };" },
  { id: 'D11', file: 'lease-period.js', why: 'a blank raw counts as unreadable, so missing becomes unreadable',
    from: "      if (raw != null && String(raw).trim() !== '') {", to: '      if (raw != null || true) {' },

  // ── CONSEQUENCE: the distinction survives and stops mattering ──────────
  // D12 was the single clause `c.case === 'unreadable' ||` removed from the
  // early return below. That is a PROVABLE EQUIVALENT and was replaced rather
  // than argued: occupancy() holds the unreadable case out of apportionment
  // TWICE, and either guard alone is sufficient. With the named clause gone, an
  // unreadable term still has no overlap bounds, so the belt-and-braces guard on
  // the next line — whose own comment says it exists for exactly this — returns
  // the same {applied:false, factor:null, unresolved:true}. Measured, not
  // assumed. The mutant that is load-bearing removes BOTH, which is what "the
  // unreadable case is no longer held out of apportionment" actually means; the
  // unreadable term then reaches the day arithmetic with null bounds.
  { id: 'D12', file: 'lease-period.js', why: 'the unreadable case is no longer held out of apportionment at all',
    from: "    if (c.case === 'unreadable' || c.case === 'ended_before' || c.case === 'begins_after') {\n      out.unresolved = true;\n      return out;\n    }",
    to:   "    if (c.case === 'ended_before' || c.case === 'begins_after') {\n      out.unresolved = true;\n      return out;\n    }\n    c.overlapStart = c.overlapStart || c.periodStart;\n    c.overlapEnd = c.overlapEnd || c.periodEnd;" },
  { id: 'D13', file: 'lease-period.js', why: 'classify stops calling it unreadable, so it falls through to unknown_end',
    from: "      out.case = 'unreadable'; out.label = CASES.unreadable;",
    to:   "      out.case = 'unknown_end'; out.label = CASES.unknown_end;" },
  { id: 'D14', file: 'lease-period.js', why: 'only an unreadable START counts, so an unreadable end slips through',
    from: "    if (s.status === 'unreadable' || e.status === 'unreadable') {",
    to:   "    if (s.status === 'unreadable') {" },
  { id: 'D15', file: 'reconciliation-engine.js', why: 'the unreadable finding stops blocking billing',
    from: "      if (c.case === 'unreadable') {\n        flags.push(Object.assign({\n          severity: 'yellow',\n          blocksBilling: true,",
    to:   "      if (c.case === 'unreadable') {\n        flags.push(Object.assign({\n          severity: 'yellow',\n          blocksBilling: false," },
  { id: 'D16', file: 'reconciliation-engine.js', why: 'the finding is not raised at all for an unreadable date',
    from: "      if (c.case === 'unreadable') {", to: '      if (false) {' },
  { id: 'D17', file: 'reconciliation-engine.js', why: 'the finding quotes the empty field instead of the lease text',
    from: '`${c.endStatus === \'unreadable\' ? ` (end: "${c.endRaw}")` : \'\'}`',
    to:   '`${c.endStatus === \'unreadable\' ? ` (end: "${t.end_date}")` : \'\'}`' },
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'udmut-'));
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

const SUITES = ['test-unreadable-date-distinction.js'];
function runSuites() {
  for (const suite of SUITES) {
    try {
      execFileSync(process.execPath, [suite], { cwd: tmp, stdio: 'pipe', timeout: 300000 });
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
    try { execFileSync(process.execPath, [suite], { cwd: tmp, stdio: 'pipe', timeout: 300000 }); }
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
  if (m.to === m.from) {
    console.log(`  ??   ${m.id}  NO-OP MUTANT`);
    survived.push(m.id + ' (no-op)');
    continue;
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
