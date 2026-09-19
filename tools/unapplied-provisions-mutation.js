'use strict';
/**
 * tools/unapplied-provisions-mutation.js — does the unapplied-provision gate hold?
 *
 *   node tools/unapplied-provisions-mutation.js
 *
 * Each mutant breaks one decision detector 3b makes in reconciliation-engine.js.
 * test-unapplied-provisions.js must fail against every one of them.
 *
 *   U01  the finding no longer blocks billing
 *   U02  the finding is escalated to red
 *   U03  zero is treated as absent
 *   U04  '' is treated as a stated vocabulary value
 *   U05  '' is treated as a stated expense stop
 *   U06  a tenant with no shared CAM is held anyway
 *   U07  the Tenant: scope marker is dropped (holds the whole property)
 *   U08  "rentable" fires
 *   U09  "operating_expenses" fires
 *   U10  expense stop is not checked
 *   U11  gross-up is not checked
 *   U12  base year is not checked
 *   U13  administrative fee is not checked
 *   U14  administrative fee basis is not checked
 *   U15  pro-rata method is not checked
 *   U16  the lease quote is never read
 *   U17  the first snapshot's quote is used, not the latest
 *   U18  lease type is checked here too (duplicates the Gross detector)
 *   U19  the title drops the tenant's name
 *   U20  the detector is silent when only one term is present
 *
 * A FAILING BASELINE IS NOT A PASS.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const E = 'reconciliation-engine.js';

const MUTANTS = [
  { id: 'U01', file: E, why: 'the finding no longer blocks billing',
    from: "        blocksBilling: true,  // but that figure is exactly what is in doubt",
    to:   "        blocksBilling: false,  // but that figure is exactly what is in doubt" },
  { id: 'U02', file: E, why: 'the finding is escalated to red',
    from: "        severity: 'yellow',   // the engine will not assert the figure is wrong until the lease is read",
    to:   "        severity: 'red',   // the engine will not assert the figure is wrong until the lease is read" },
  { id: 'U03', file: E, why: 'zero is treated as absent',
    from: "        const v = p.read(t);\n        if (v === null) return;",
    to:   "        const v = p.read(t);\n        if (v === null || v === 0) return;" },
  { id: 'U04', file: E, why: "'' is treated as a stated vocabulary value",
    from: "      if (s === '') return null;\n      return s.toLowerCase() === alreadyApplied ? null : s;",
    to:   "      return s.toLowerCase() === alreadyApplied ? null : s;" },
  { id: 'U05', file: E, why: "'' is treated as a stated expense stop",
    from: "      { key: 'expense_stop',    label: 'Expense stop',             read: t => _num(t.expense_stop) },",
    to:   "      { key: 'expense_stop',    label: 'Expense stop',             read: t => (t.expense_stop == null ? null : (_num(t.expense_stop) ?? 0)) }," },
  { id: 'U06', file: E, why: 'a tenant with no shared CAM is held anyway',
    from: "      if (!sharedInvs.length) return;         // nothing shared, nothing computed without the term",
    to:   "      if (false) return;         // nothing shared, nothing computed without the term" },
  { id: 'U07', file: E, why: 'the Tenant: scope marker is dropped',
    from: "          `Tenant: ${r.name}`,\n          ...stated.flatMap(s => [",
    to:   "          ...stated.flatMap(s => [" },
  { id: 'U08', file: E, why: '"rentable" fires',
    from: "read: t => _statedWord(t.pro_rata_method, 'rentable') },",
    to:   "read: t => _statedWord(t.pro_rata_method, '__never__') }," },
  { id: 'U09', file: E, why: '"operating_expenses" fires',
    from: "read: t => _statedWord(t.admin_fee_basis, 'operating_expenses') },",
    to:   "read: t => _statedWord(t.admin_fee_basis, '__never__') }," },
  { id: 'U10', file: E, why: 'expense stop is not checked',
    from: "      { key: 'expense_stop',    label: 'Expense stop',             read: t => _num(t.expense_stop) },\n", to: "" },
  { id: 'U11', file: E, why: 'gross-up is not checked',
    from: "      { key: 'gross_up_pct',    label: 'Gross-up',                 read: t => _num(t.gross_up_pct),  unit: '%' },\n", to: "" },
  { id: 'U12', file: E, why: 'base year is not checked',
    from: "      { key: 'baseYear',        label: 'Base year',                read: t => _num(t.baseYear != null ? t.baseYear : t.base_year),\n        evidenceKeys: ['baseYear', 'base_year'] },\n", to: "" },
  { id: 'U13', file: E, why: 'administrative fee is not checked',
    from: "      { key: 'admin_fee_pct',   label: 'Administrative fee',       read: t => _num(t.admin_fee_pct), unit: '%' },\n", to: "" },
  { id: 'U14', file: E, why: 'administrative fee basis is not checked',
    from: "      { key: 'admin_fee_basis', label: 'Administrative fee basis', read: t => _statedWord(t.admin_fee_basis, 'operating_expenses') },\n", to: "" },
  { id: 'U15', file: E, why: 'pro-rata method is not checked',
    from: "      { key: 'pro_rata_method', label: 'Pro-rata method',          read: t => _statedWord(t.pro_rata_method, 'rentable') },\n", to: "" },
  { id: 'U16', file: E, why: 'the lease quote is never read',
    from: "        const q = last && last.quote;", to: "        const q = null;" },
  { id: 'U17', file: E, why: "the first snapshot's quote is used, not the latest",
    from: "        const last = snaps.length ? snaps[snaps.length - 1] : null;",
    to:   "        const last = snaps.length ? snaps[0] : null;" },
  { id: 'U18', file: E, why: 'lease type is checked here too (duplicates the Gross detector)',
    from: "      { key: 'pro_rata_method', label: 'Pro-rata method',          read: t => _statedWord(t.pro_rata_method, 'rentable') },\n    ];",
    to:   "      { key: 'pro_rata_method', label: 'Pro-rata method',          read: t => _statedWord(t.pro_rata_method, 'rentable') },\n      { key: 'lease_type', label: 'Lease type', read: t => _statedWord(t.lease_type, 'nnn') },\n    ];" },
  { id: 'U19', file: E, why: "the title drops the tenant's name",
    from: "        title:  `Lease provision${one ? '' : 's'} not applied — ${r.name}: ${stated.map(s => s.label).join(', ')}`,",
    to:   "        title:  `Lease provision${one ? '' : 's'} not applied — ${stated.map(s => s.label).join(', ')}`," },
  { id: 'U20', file: E, why: 'the detector is silent when only one term is present',
    from: "      if (!stated.length) return;\n      const sharedTotal",
    to:   "      if (stated.length < 2) return;\n      const sharedTotal" },
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'provmut-'));
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

const SUITES = ['test-unapplied-provisions.js'];
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
