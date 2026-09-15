'use strict';
/**
 * tools/invoice-duplicate-mutation.js — does the duplicate suite bite?
 *
 *   node tools/invoice-duplicate-mutation.js
 *
 * Four kinds of mutant:
 *
 *   REGRESS   the register goes back to its own date-blind rule, or the shared
 *             helper stops being shared — the original 11-false-positives state.
 *   THRESHOLD the day limit moves, in either direction. Widening it turns
 *             quarterly retainers back into duplicates; narrowing it hides a
 *             real double-submission.
 *   OVER-CLAIM an undated invoice is called a duplicate, or a $0/vendorless row
 *             is, or the exact/near suppression is dropped so one pair is
 *             reported twice.
 *   SURFACE   the badge or the Remove confirmation stops naming what it is about.
 *
 * A FAILING BASELINE IS NOT A PASS. The baseline is asserted before any mutant
 * runs and the harness exits non-zero if it fails — a copy that cannot run kills
 * every mutant trivially and reports a perfect score.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const MUTATED_FILES = ['script.js'];

const MUTANTS = [
  // ── REGRESS: back to two rules ──────────────────────────────────────────
  { id: 'D01', file: 'script.js', why: 'the register goes back to its own date-blind comparison',
    from: '    const dupBadge = _dupBadgeHtml(_dupIndex.get(i), i);',
    to:   "    const dupBadge = _dupBadgeHtml(invoiceData.some((o, j) => j !== i && o && o.vendorName && o.amount !== '' && Math.abs(parseFloat(d.amount) - parseFloat(o.amount)) <= 1 && similarVendor(d.vendorName, o.vendorName)) ? { kind: 'near', displayVendor: d.vendorName, amount: parseFloat(d.amount) || 0, date: '', daysDiff: 0 } : null, i);" },
  { id: 'D02', file: 'script.js', why: 'the audit detector stops reading the shared rule',
    from: '  const _dups = _findDuplicateInvoices(invoices);',
    to:   '  const _dups = { rows: [], exactGroups: [], nearPairs: [], byIndex: new Map(), exactFlaggedIdx: new Set() };' },
  { id: 'D03', file: 'script.js', why: 'the register badge never renders',
    from: '  if (!dup) return \'\';', to: '  if (true) return \'\';' },
  { id: 'D04', file: 'script.js', why: 'the register badges every row',
    from: '    const dupBadge = _dupBadgeHtml(_dupIndex.get(i), i);',
    to:   "    const dupBadge = _dupBadgeHtml(_dupIndex.get(i) || { kind: 'near', displayVendor: d.vendorName, amount: parseFloat(d.amount) || 0, date: '', daysDiff: 1 }, i);" },

  // ── THRESHOLD ───────────────────────────────────────────────────────────
  { id: 'D05', file: 'script.js', why: 'the day limit widens to 400 — quarterly retainers are duplicates again',
    from: 'const _DUP_NEAR_DAY_LIMIT = 7;', to: 'const _DUP_NEAR_DAY_LIMIT = 400;' },
  { id: 'D06', file: 'script.js', why: 'the day limit narrows to 0 — a 3-day double submission is hidden',
    from: 'const _DUP_NEAR_DAY_LIMIT = 7;', to: 'const _DUP_NEAR_DAY_LIMIT = 0;' },
  { id: 'D07', file: 'script.js', why: 'the boundary flips to strictly-less-than, losing the 7-day case',
    from: '      if (daysDiff <= _DUP_NEAR_DAY_LIMIT) {', to: '      if (daysDiff < _DUP_NEAR_DAY_LIMIT) {' },
  { id: 'D08', file: 'script.js', why: 'the gap is measured in the wrong unit',
    from: '      const daysDiff = Math.round((dated[i + 1].ts - dated[i].ts) / DAY_MS);',
    to:   '      const daysDiff = Math.round((dated[i + 1].ts - dated[i].ts) / (DAY_MS * 30));' },

  // ── OVER-CLAIM ──────────────────────────────────────────────────────────
  { id: 'D09', file: 'script.js', why: 'an UNDATED invoice becomes an exact duplicate',
    from: '    if (!r.date) return;\n    const key = `${r.vendor}|${r.amtKey}|${r.date}`;',
    to:   '    const key = `${r.vendor}|${r.amtKey}|${r.date}`;' },
  { id: 'D10', file: 'script.js', why: 'undated rows enter the near check and produce a NaN gap',
    from: '    const dated = group.filter(r => !isNaN(r.ts)).sort((a, b) => a.ts - b.ts);',
    to:   '    const dated = group.slice().sort((a, b) => a.ts - b.ts);' },
  { id: 'D11', file: 'script.js', why: 'a $0 or vendorless row becomes eligible',
    from: '  }).filter(r => r.vendor && r.amount > 0);', to: '  });' },
  { id: 'D12', file: 'script.js', why: 'the $1 tolerance comes back into the shared key',
    from: '      amtKey: amount.toFixed(2),', to: '      amtKey: Math.round(amount).toFixed(0),' },
  { id: 'D13', file: 'script.js', why: 'the vendor is dropped from the key — any two equal amounts match',
    from: '    const key = `${r.vendor}|${r.amtKey}|${r.date}`;',
    to:   '    const key = `${r.amtKey}|${r.date}`;' },
  { id: 'D14', file: 'script.js', why: 'the date is dropped from the exact key',
    from: '    const key = `${r.vendor}|${r.amtKey}|${r.date}`;',
    to:   '    const key = `${r.vendor}|${r.amtKey}`;' },
  { id: 'D15', file: 'script.js', why: 'the exact/near suppression is dropped — one pair reported twice',
    from: '  rows.filter(r => !exactFlaggedIdx.has(r.idx)).forEach(r => {',
    to:   '  rows.forEach(r => {' },
  { id: 'D16', file: 'script.js', why: 'the near check reports every pair in a group, not one',
    from: '        break; // one flag per vendor+amount pair is enough', to: '        ;' },
  { id: 'D17', file: 'script.js', why: 'the near pair overwrites an exact verdict already recorded',
    from: '  nearPairs.forEach(p => [p.a, p.b].forEach(r => byIndex.set(r.idx, {',
    to:   '  nearPairs.concat(exactGroups.map(g => ({ a: g[0], b: g[1], daysDiff: 0 }))).forEach(p => [p.a, p.b].forEach(r => byIndex.set(r.idx, {' },
  { id: 'D18', file: 'script.js', why: 'byIndex never records the exact group',
    from: '  exactGroups.forEach(g => g.forEach(r => byIndex.set(r.idx, {', to: '  [].forEach(g => g.forEach(r => byIndex.set(r.idx, {' },
  { id: 'D19', file: 'script.js', why: 'the vendor stops being normalised, so case breaks the match',
    from: "    const vendor = (inv.vendorName || inv.vendor || '').toLowerCase().trim();",
    to:   "    const vendor = (inv.vendorName || inv.vendor || '');" },
  { id: 'D20', file: 'script.js', why: 'the shared rule mutates the invoices it was handed',
    from: '  const rows = (Array.isArray(invoices) ? invoices : []).map((inv, idx) => {',
    to:   '  const rows = (Array.isArray(invoices) ? invoices : []).map((inv, idx) => { inv.touched = true;' },

  // ── SURFACE ─────────────────────────────────────────────────────────────
  { id: 'D21', file: 'script.js', why: 'the badge stops distinguishing exact from near',
    from: "  const what = dup.kind === 'exact'", to: '  const what = false' },
  { id: 'D22', file: 'script.js', why: 'the NEAR badge stops naming the vendor',
    from: 'Possible duplicate \\u2014 ${esc(dup.displayVendor)} ${fmt(dup.amount)} billed twice within',
    to:   'Possible duplicate \\u2014 ${fmt(dup.amount)} billed twice within' },
  { id: 'D22b', file: 'script.js', why: 'the badge interpolates the vendor name unescaped',
    from: 'Possible duplicate \\u2014 ${esc(dup.displayVendor)}', to: 'Possible duplicate \\u2014 ${dup.displayVendor}' },
  { id: 'D22c', file: 'script.js', why: 'the Remove button loses the row it belongs to',
    from: 'removeInvItem(${i})">Remove</button>', to: 'removeInvItem(0)">Remove</button>' },
  { id: 'D23', file: 'script.js', why: 'the exact badge stops naming the date',
    from: 'on ${esc(dup.date)} appears ${dup.occurrences} times', to: 'appears ${dup.occurrences} times' },
  { id: 'D24', file: 'script.js', why: 'the Remove confirmation goes back to naming nothing',
    from: 'return `Remove this invoice from the list?\\n\\n${who}\\n${amt} \\u00B7 ${when}`;',
    to:   "return 'Remove this invoice from the list?';" },
  { id: 'D25', file: 'script.js', why: 'the confirmation reads the wrong record',
    from: 'confirm(_removeInvoiceConfirmText(invoiceData[i]))',
    to:   'confirm(_removeInvoiceConfirmText(invoiceData[0]))' },
  { id: 'D25b', file: 'script.js', why: 'a missing field blanks instead of saying so',
    from: "  const who  = (d && (d.vendorName || d.vendor)) || '(unknown vendor)';",
    to:   '  const who  = (d && (d.vendorName || d.vendor)) || \'\';' },
  { id: 'D26', file: 'script.js', why: 'the confirmation stops reading the date',
    from: "  const when = (d && (d.invoiceDate || '').trim()) || 'no date';",
    to:   "  const when = 'no date';" },
  { id: 'D27', file: 'script.js', why: 'the badge is recomputed per row instead of once',
    from: '  const _dupIndex = _findDuplicateInvoices(invoiceData).byIndex;',
    to:   '  const _dupIndex = { get: function (k) { return _findDuplicateInvoices(invoiceData).byIndex.get(k); } };' },
  { id: 'D27b', file: 'script.js', why: 'the row stops handing its verdict to the badge builder',
    from: '    const dupBadge = _dupBadgeHtml(_dupIndex.get(i), i);',
    to:   '    const dupBadge = _dupBadgeHtml(null, i);' },

  // ── the audit findings this slice must not disturb ───────────────────────
  { id: 'D28', file: 'script.js', why: 'the exact finding stops being red',
    from: "      severity:   'red',\n      title:      `Exact duplicate invoice:", to: "      severity:   'yellow',\n      title:      `Exact duplicate invoice:" },
  { id: 'D29', file: 'script.js', why: 'the near finding stops being yellow',
    from: "      severity:   'yellow',\n      title:      `Possible duplicate:", to: "      severity:   'red',\n      title:      `Possible duplicate:" },
  { id: 'D30', file: 'script.js', why: 'the stated threshold drifts from the constant',
    from: '`Gap: ${daysDiff} day${daysDiff === 1 ? \'\' : \'s\'} (threshold for review: ≤${_DUP_NEAR_DAY_LIMIT} days)`,',
    to:   '`Gap: ${daysDiff} day${daysDiff === 1 ? \'\' : \'s\'} (threshold for review: ≤30 days)`,' },
  { id: 'D31', file: 'script.js', why: 'the shared-attachment check is lost with the refactor',
    from: '    if (!r.fileUrl) return;', to: '    return;' },
  { id: 'D32', file: 'script.js', why: 'removal itself is broken',
    from: '  invoiceData.splice(i, 1);', to: '  invoiceData.splice(i, 0);' },
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dupmut-'));
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

const SUITES = ['test-invoice-duplicates.js', 'test-audit-consistency.js'];
function runSuites() {
  for (const suite of SUITES) {
    try { execFileSync(process.execPath, [suite], { cwd: tmp, stdio: 'pipe', timeout: 180000 }); }
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
    try { execFileSync(process.execPath, [suite], { cwd: tmp, stdio: 'pipe', timeout: 180000 }); }
    catch (e) { console.error('\n── ' + suite + ' ──\n' + String(e.stdout || e.message).slice(-2500)); }
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
  fs.writeFileSync(path.join(tmp, m.file), src.slice(0, i) + m.to + src.slice(i + m.from.length));
  const passed = runSuites();
  fs.writeFileSync(path.join(tmp, m.file), src);
  if (passed) { survived.push(`${m.id} ${m.file}: ${m.why}`); console.log(`  LIVE ${m.id}  ${m.why}`); }
  else        { killed++;                                    console.log(`  kill ${m.id}  ${m.why}`); }
}

console.log(`\n${killed}/${MUTANTS.length} killed`);
if (survived.length) {
  console.log('\nSURVIVORS — each needs a written verdict (real gap or equivalent):');
  survived.forEach(s => console.log('  · ' + s));
}
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(survived.length ? 1 : 0);
