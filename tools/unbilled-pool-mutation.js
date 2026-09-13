'use strict';
/**
 * tools/unbilled-pool-mutation.js — can the Overview regress to "underbilling"?
 *
 *   node tools/unbilled-pool-mutation.js
 *
 * Four kinds of mutant:
 *
 *   REGRESS   the old interpretation returns — the literal wording, or the
 *             subtraction re-labelled as recoverable. This is the defect: a
 *             lease-imposed cap presented as money the manager failed to collect.
 *   AUTHORITY the scoped read is replaced by a local derivation, or the scope
 *             guard is dropped so another building's breakdown is borrowed. The
 *             local answer is not merely different, it is wrong (residual
 *             -$46,515.36 against $0), which is why this class matters.
 *   VERDICT   the explained/residual test stops governing the wording — a
 *             remaining residual called "accounted for", or a settled gap called
 *             unaccounted.
 *   FIGURES   an amount or a cause is altered, dropped or invented. The
 *             decomposition is the audit's and must survive verbatim.
 *
 * A FAILING BASELINE IS NOT A PASS. The unmutated copy is asserted before any
 * mutant runs and the harness exits non-zero if it fails.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const MUTATED_FILES = ['property-workspace.js'];

const SETTLED = '    var settled = breakdown.explained === true && Math.abs(residual) < 0.01;';
const SCOPED  = '      if (!p || !p.id || !w.propertyId || w.propertyId !== p.id) return null;';
const CALL    = '          var _n = unbilledPoolNarrative(under, varianceBreakdown || null);\n' +
                '          items.push(_mk(\'warning\', \'\\u{1F4B0}\', _n.title, _n.why,\n' +
                '            { tab: \'cam\', anchors: [\'results\', \'cardInvoices\'] }, \'Review allocation\'));';
// The browser half: renderAttention performs the scoped read and hands it down.
const INJECT  = '    var items = collectAttention(property, _scopedVarianceBreakdown(property));';
const NAMED   = '    var named = (breakdown.lines || []).filter(function (l) {\n' +
                '      return l && l.key !== \'residual\' && Number(l.amount);\n' +
                '    });';

const MUTANTS = [
  // ── REGRESS: the old interpretation comes back ───────────────────────────
  { id: 'U01', file: 'property-workspace.js', why: 'the original underbilling wording returns verbatim',
    from: CALL,
    to: "          items.push(_mk('warning', '\\u{1F4B0}',\n" +
        "            'CAM underbilling — ' + '$' + Math.round(under).toLocaleString() + ' unrecovered',\n" +
        "            'Allocated charges fall short of the eligible expense pool.',\n" +
        "            { tab: 'cam', anchors: ['results', 'cardInvoices'] }, 'Review allocation'));" },
  { id: 'U02', file: 'property-workspace.js', why: 'the accounted title calls the total unrecovered',
    from: "        title: amt + ' of the expense pool was not billed — accounted for',",
    to:   "        title: amt + ' unrecovered'," },
  { id: 'U03', file: 'property-workspace.js', why: 'the accounted why claims the charges fall short',
    from: "        why: 'Largest cause — ' + String(top.label || 'Unnamed cause')",
    to:   "        why: 'Allocated charges fall short of the eligible expense pool. ' + String(top.label || '')" },
  { id: 'U04', file: 'property-workspace.js', why: 'the unaccounted branch calls the gap underbilling',
    from: "      title: _money(gap) + ' of the expense pool is an unaccounted variance',",
    to:   "      title: _money(gap) + ' of CAM underbilling'," },
  { id: 'U05', file: 'property-workspace.js', why: 'the no-breakdown branch invents an unrecovered amount',
    from: "        title: amt + ' of the expense pool was not billed to tenants',",
    to:   "        title: amt + ' unrecovered'," },
  { id: 'U06', file: 'property-workspace.js', why: 'the no-breakdown branch asserts a cause it does not have',
    from: "        why: 'What accounts for it has not been established for this reconciliation. '",
    to:   "        why: 'Allocated charges fall short of the eligible expense pool. '" },

  // ── AUTHORITY: the scoped read is bypassed ──────────────────────────────
  { id: 'U07', file: 'property-workspace.js', why: 'the breakdown is re-derived locally from the snapshot',
    from: CALL,
    to: "          var _bk = null;\n" +
        "          try { _bk = window.VarianceBreakdown.derive({ results: snap.results,\n" +
        "            invoices: snap.invoices || [], pool: Number(snap.total) || 0, billed: allocated,\n" +
        "            reconciled: snap.invoices || [] }); } catch (_x) { _bk = null; }\n" +
        "          var _n = unbilledPoolNarrative(under, _bk);\n" +
        "          items.push(_mk('warning', '\\u{1F4B0}', _n.title, _n.why,\n" +
        "            { tab: 'cam', anchors: ['results', 'cardInvoices'] }, 'Review allocation'));" },
  { id: 'U08', file: 'property-workspace.js', why: 'the property scope guard is dropped',
    from: SCOPED, to: '      if (!w.breakdown) return null;' },
  { id: 'U09', file: 'property-workspace.js', why: 'the scope guard accepts any property id',
    from: SCOPED, to: '      if (!p || !p.id) return null;' },
  { id: 'U10', file: 'property-workspace.js', why: 'the scoped read always returns null, losing the explanation',
    from: '      return w.breakdown;', to: '      return null;' },

  // ── VERDICT: explained/residual stops governing the wording ─────────────
  { id: 'U11', file: 'property-workspace.js', why: 'everything is called accounted for',
    from: SETTLED, to: '    var settled = true;' },
  { id: 'U12', file: 'property-workspace.js', why: 'nothing is ever called accounted for',
    from: SETTLED, to: '    var settled = false;' },
  { id: 'U13', file: 'property-workspace.js', why: 'a remaining residual no longer blocks "accounted for"',
    from: SETTLED, to: '    var settled = breakdown.explained === true;' },
  { id: 'U14', file: 'property-workspace.js', why: 'explained:false no longer blocks "accounted for"',
    from: SETTLED, to: '    var settled = Math.abs(residual) < 0.01;' },
  { id: 'U15', file: 'property-workspace.js', why: 'the residual is read as zero whatever it is',
    from: '    var residual = Number(breakdown.residual) || 0;',
    to:   '    var residual = 0;' },
  { id: 'U16', file: 'property-workspace.js', why: 'the unaccounted branch reports the whole gap as unattributed',
    from: "    var gap = Math.abs(residual) >= 0.01 ? Math.abs(residual) : Number(difference) || 0;",
    to:   "    var gap = Number(difference) || 0;" },
  { id: 'U17', file: 'property-workspace.js', why: 'the unaccounted branch stops saying how much IS attributed',
    from: "        ? amt + ' was not billed; named causes account for ' + _money(attributed)",
    to:   "        ? amt + ' was not billed' + (0 ? _money(attributed) : '')" },

  // ── FIGURES: the decomposition must survive verbatim ───────────────────
  { id: 'U18', file: 'property-workspace.js', why: 'the residual line is counted as a named cause',
    from: NAMED,
    to: '    var named = (breakdown.lines || []).filter(function (l) {\n' +
        '      return l && Number(l.amount);\n' +
        '    });' },
  { id: 'U19', file: 'property-workspace.js', why: 'the largest cause is taken from the end of the list',
    from: '      var top = named[0];', to: '      var top = named[named.length - 1];' },
  { id: 'U20', file: 'property-workspace.js', why: 'the cause is named but its amount is dropped',
    from: "           + ' (' + _money(top.amount) + ')'", to: "           + ''" },
  { id: 'U21', file: 'property-workspace.js', why: 'the remaining causes are miscounted',
    from: '      var rest = named.length - 1;', to: '      var rest = named.length;' },
  { id: 'U22', file: 'property-workspace.js', why: 'the label is re-worded instead of quoted',
    from: "        why: 'Largest cause — ' + String(top.label || 'Unnamed cause')",
    to:   "        why: 'Largest cause — ' + String(top.label || 'Unnamed cause').toLowerCase()" },
  { id: 'U23', file: 'property-workspace.js', why: 'the amount is rounded to thousands',
    from: '  function _money(n) { return \'$\' + Math.round(Number(n) || 0).toLocaleString(); }',
    to:   '  function _money(n) { return \'$\' + (Math.round((Number(n) || 0) / 1000) * 1000).toLocaleString(); }' },
  { id: 'U24', file: 'property-workspace.js', why: 'the attributed subtotal sums the residual too',
    from: '    var attributed = named.reduce(function (s, l) { return s + (Number(l.amount) || 0); }, 0);',
    to:   '    var attributed = (breakdown.lines || []).reduce(function (s, l) { return s + (Number(l.amount) || 0); }, 0);' },

  // ── the item must not vanish, nor move ─────────────────────────────────
  { id: 'U25', file: 'property-workspace.js', why: 'the item stops being produced at all',
    from: CALL, to: '' },
  { id: 'U26', file: 'property-workspace.js', why: 'the item is demoted, changing which items are shown',
    from: CALL, to: CALL.replace("_mk('warning'", "_mk('info'") },
  { id: 'U27', file: 'property-workspace.js', why: 'the CTA destination moves off the CAM tab',
    from: CALL, to: CALL.replace("tab: 'cam'", "tab: 'overview'") },
  // ── INJECTION: the server path must stay browser-free ──────────────────
  { id: 'U29', file: 'property-workspace.js', why: 'collectAttention reaches for the browser global itself',
    from: '          var _n = unbilledPoolNarrative(under, varianceBreakdown || null);',
    to:   '          var _n = unbilledPoolNarrative(under, varianceBreakdown || _scopedVarianceBreakdown(p));' },
  { id: 'U30', file: 'property-workspace.js', why: 'renderAttention stops supplying the breakdown',
    from: INJECT, to: '    var items = collectAttention(property);' },
  { id: 'U28', file: 'property-workspace.js', why: 'the threshold changes, so the item fires differently',
    from: '        if (under > Number(snap.total) * 0.05) {',
    to:   '        if (under > Number(snap.total) * 0.5) {' },
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ubpmut-'));
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

const SUITES = ['test-unbilled-pool-narrative.js'];
function runSuites() {
  for (const suite of SUITES) {
    try {
      execFileSync(process.execPath, [suite], {
        cwd: tmp, stdio: 'pipe', timeout: 600000,
        env: Object.assign({}, process.env, { UBP_PORT: '8969' }),
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
      execFileSync(process.execPath, [suite], { cwd: tmp, stdio: 'pipe', timeout: 600000,
        env: Object.assign({}, process.env, { UBP_PORT: '8969' }) });
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
