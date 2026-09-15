'use strict';
/**
 * tools/invoice-evidence-identity-mutation.js — does the invoice identity hold?
 *
 *   node tools/invoice-evidence-identity-mutation.js
 *
 * Identity resolution is a handful of lines that every expense-side figure now
 * depends on, and each mutant is a plausible way of getting it wrong. Three of
 * them are ways this fix was ACTUALLY written wrong before landing:
 *
 *   E01/E02  back to `invoice:<vendorName>` in one documentation detector or
 *            the other — THE ORIGINAL DEFECT, $105,350 of a $188,300 pool.
 *   E03      key on the record's `id` alone. Uploaded invoices have no id until
 *            PropertyOS.ensureInvoiceIds runs, so every one keys on
 *            `invoice:undefined` and the pool collapses to its largest invoice.
 *   E04/E05  the natural key degrades to a constant or to the vendor name,
 *            re-collapsing the id-less upload path fixture B covers.
 *   E06      a positional identity. Positions are array-local and the detectors
 *            read two arrays, so this is never a safe id.
 *   E09      concentration keyed by vendor again — the CROSS-ARRAY case. A
 *            first version of this fix left concentration alone and reported
 *            $110,000 of a $67,300 pool in the Test 3 replay.
 *   E10      the natural key drops the amount, so two bills from one vendor on
 *            one date collapse — the vendor defect in miniature.
 *   E11      ambiguity is guessed at: several register rows match, and the
 *            resolver picks the first instead of declining. That invents an
 *            identity for an invoice nobody can name.
 *   E12      an unresolvable row is priced anyway with no items, which
 *            deriveExposure gives a throwaway id and counts on its own axis —
 *            $31,000 of a $22,000 pool in fixture F.
 *   E07/E08  the max-dedupe in deriveExposure becomes a sum or a min. This is
 *            the behaviour that must NOT change: the whole fix rests on it, so
 *            a harness that did not pin it would let the real invariant rot
 *            while the new assertions stayed green.
 *
 * A FAILING BASELINE IS NOT A PASS. The unmutated copy is asserted before any
 * mutant runs and the harness exits non-zero if it fails.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

const RESOLVER = `    const hits = allInvData.filter(x => x &&
      String(x.vendorName || '').trim() === v && parseFloat(x.amount) === a);
    return hits.length === 1 ? hits[0] : null;`;
const NATURAL = `    return 'invoice:' + String(row.vendorName || '').trim() + '|'
         + (row.amount == null ? '' : row.amount) + '|'
         + (row.invoiceDate || '');`;
// Includes the basis line: the tied-candidate detector two sections down emits
// an items line identical to the character, so the anchor has to carry context.
const CONC_ITEMS = `                items: [{ id: _invImpactId(inv), amount: amt }],
                basis: \`Single invoice at \${pct}% of the pool, pending independent verification\` }`;
const CONC_IMPACT = `          impact: _invImpactId(inv)
            ? { amount: amt, kind: 'concentration',`;
const MISSING_ITEMS = '              items: missing.map(i => ({ id: _invImpactId(i), amount: parseFloat(i.amount) || 0 }))';
const UNDATED_ITEMS = '              items: noDates.map(i => ({ id: _invImpactId(i), amount: parseFloat(i.amount) || 0 }))';
const MAX_DEDUPE    = '          if (!(bag[id] > amount)) { bag[id] = amount; }';

const MUTANTS = [
  { id: 'E01', file: 'script.js', why: 'missing-docs keyed by vendor again — THE ORIGINAL DEFECT',
    from: MISSING_ITEMS,
    to:   '              items: missing.map(i => ({ id: `invoice:${i.vendorName}`, amount: parseFloat(i.amount) || 0 }))' },
  { id: 'E02', file: 'script.js', why: 'undated invoices keyed by vendor again',
    from: UNDATED_ITEMS,
    to:   '              items: noDates.map(i => ({ id: `invoice:${i.vendorName}`, amount: parseFloat(i.amount) || 0 }))' },

  { id: 'E03', file: 'script.js', why: 'the bare record id — every uploaded invoice becomes invoice:undefined',
    from: NATURAL, to: "    return 'invoice:' + row.id;" },
  { id: 'E04', file: 'script.js', why: 'the natural key becomes a constant, collapsing id-less invoices',
    from: NATURAL, to: "    return 'invoice:x';" },
  { id: 'E05', file: 'script.js', why: 'the natural key is the vendor name again',
    from: NATURAL, to: "    return 'invoice:' + String(row.vendorName || '').trim();" },
  { id: 'E06', file: 'script.js', why: 'a positional identity, which is array-local and meaningless across arrays',
    from: NATURAL, to: "    return 'invoice:#' + allInvData.indexOf(row);" },
  { id: 'E10', file: 'script.js', why: 'the natural key drops the amount, so same-vendor same-date bills collapse',
    from: NATURAL,
    to:   `    return 'invoice:' + String(row.vendorName || '').trim() + '|'
         + (row.invoiceDate || '');` },

  { id: 'E09', file: 'script.js', why: 'concentration keyed by vendor again — the cross-array overlap, $110,000 of a $67,300 pool',
    from: CONC_ITEMS,
    to:   `                items: [{ id: \`invoice:\${vendor}\`, amount: amt }],
                basis: \`Single invoice at \${pct}% of the pool, pending independent verification\` }` },

  { id: 'E11', file: 'script.js', why: 'ambiguity guessed at — the resolver takes the first of several matches',
    from: RESOLVER,
    to:   `    const hits = allInvData.filter(x => x &&
      String(x.vendorName || '').trim() === v && parseFloat(x.amount) === a);
    return hits.length ? hits[0] : null;` },
  { id: 'E12', file: 'script.js', why: 'an unresolvable row is priced anyway, so deriveExposure counts it on its own id',
    from: CONC_IMPACT,
    to:   `          impact: true
            ? { amount: amt, kind: 'concentration',` },

  { id: 'E07', file: 'audit-exposure.js', why: 'the max-dedupe becomes a sum — one invoice counted once per finding',
    from: MAX_DEDUPE, to: '          bag[id] = (bag[id] || 0) + amount;' },
  { id: 'E08', file: 'audit-exposure.js', why: 'the max-dedupe becomes a min',
    from: MAX_DEDUPE, to: '          if (!(bag[id] < amount)) { bag[id] = amount; }' },
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'invidmut-'));
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

// The new suite owns the identity. test-billing-blocker-visibility.js owns the
// blocking behaviour riding on the same finding, so E07/E08 cannot be "killed"
// by breaking something the fix was meant to leave alone. test-e2e-test3.js
// owns the real CROSS-ARRAY overlap — it is the suite that caught an earlier
// version of this fix giving one invoice two identities.
const SUITES = ['test-e2e-invoice-evidence-identity.js',
                'test-billing-blocker-visibility.js',
                'test-e2e-test3.js'];
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
