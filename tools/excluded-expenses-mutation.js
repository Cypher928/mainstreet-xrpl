'use strict';
/**
 * tools/excluded-expenses-mutation.js — does the exclusion suite bite?
 *
 *   node tools/excluded-expenses-mutation.js
 *
 * Six kinds of mutant, one per way this section could start lying:
 *
 *   COUNT     the eligible count or the denominator moves. These are the two
 *             figures the slice promised not to touch; if the suite cannot feel
 *             them move, it is not guarding them.
 *   OVERCLAIM the residual stops governing the sentence — "these records account
 *             for the difference" said regardless, or an unknown denominator
 *             treated as a reconciled zero. This is the defect the whole slice
 *             is shaped around, and the Cascade demo cannot reveal it: residual
 *             is 0 for every tenant there.
 *   RECORDS   a recorded decision is dropped, or two are merged because their
 *             display fields match. Four $7,600 management invoices from one
 *             vendor are four exclusions.
 *   INVENT    identity or a date is fabricated, or a path-dependent join is
 *             attempted against the invoice register.
 *   SOURCE    the authoritative `excludedShares` list is replaced by a freshly
 *             derived exclusion predicate — the second definition of one concept
 *             that D8 exists to prevent.
 *   REPORT    an unknown becomes a confident zero: an unreadable `cents` summed
 *             as 0, a missing scope or category rendered as though recorded.
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

const RESIDUAL = `  const residual = (denom !== null && eligible !== null)
    ? denom - eligible - records.length
    : null;`;
const GAPMAP = `    gap: residual === null ? 'unknown'
       : residual === 0   ? 'accounted'
       : residual  >  0   ? 'partial'
       :                    'inconsistent',`;
const RECMAP = '  const records = list.map(e => {';
const TOTAL = `  const totalWithheldCents = records.every(x => x.withheldCents !== null)
    ? records.reduce((s, x) => s + x.withheldCents, 0)
    : null;`;
// Anchored through the line above it: `if (!list.length) return null;` also
// appears in an unrelated helper at script.js:5083.
const EARLY = `  const list = Array.isArray(r.excludedShares) ? r.excludedShares : [];
  if (!list.length) return null;`;
const IDENT = '      identified:    _isUsableRecordId(x.id),';
const CALL  = '${_excludedExpensesHtml(r, denominator)}';

const MUTANTS = [
  // ── COUNT: the two figures the slice must not move ──────────────────────
  { id: 'X01', file: 'script.js', why: 'eligibleCount is off by one',
    from: '    this.eligibleCount  = (includedInvoices || []).length;',
    to:   '    this.eligibleCount  = (includedInvoices || []).length + 1;' },
  // X02 was `+ (this.excludedShares || []).length`, which is a PROVABLE
  // EQUIVALENT and was replaced rather than argued: eligibleCount is assigned in
  // the ReconciliationResult constructor (script.js:909), while
  // `result.excludedShares` is assigned by the caller afterwards
  // (script.js:11095). Inside the constructor the field is undefined, so the
  // added term is always `[] .length` — zero — and no observable behaviour
  // changes. This replacement tests the same intent with a value that differs:
  // eligibleCount is a count of INVOICES, not of anything else derivable.
  { id: 'X02', file: 'script.js', why: 'eligibleCount counts categories rather than invoices',
    from: '    this.eligibleCount  = (includedInvoices || []).length;',
    to:   '    this.eligibleCount  = new Set((includedInvoices || []).map(i => i && i.category)).size;' },
  { id: 'X03', file: 'script.js', why: 'the live card passes a denominator one larger than it prints',
    from: '    const invBreakdown = _invoiceBreakdownHtml(r, invoices.length);',
    to:   '    const invBreakdown = _invoiceBreakdownHtml(r, invoices.length + 1);' },
  { id: 'X04', file: 'script.js', why: 'the restored card passes the included count as the denominator',
    from: '${_invoiceBreakdownHtml(r, lastInvoicesFull.length)}',
    to:   '${_invoiceBreakdownHtml(r, r.eligibleCount)}' },
  { id: 'X05', file: 'script.js', why: 'the restored card passes no denominator at all',
    from: '${_invoiceBreakdownHtml(r, lastInvoicesFull.length)}',
    to:   '${_invoiceBreakdownHtml(r)}' },

  // ── OVERCLAIM: the residual stops governing the claim ───────────────────
  { id: 'X06', file: 'script.js', why: 'the gap is always called accounted for',
    from: GAPMAP, to: "    gap: 'accounted'," },
  { id: 'X07', file: 'script.js', why: 'an unknown denominator is reported as reconciled',
    from: GAPMAP,
    to: `    gap: residual === null ? 'accounted'
       : residual === 0   ? 'accounted'
       : residual  >  0   ? 'partial'
       :                    'inconsistent',` },
  { id: 'X08', file: 'script.js', why: 'a positive residual is folded into accounted',
    from: GAPMAP,
    to: `    gap: residual === null ? 'unknown'
       : residual >= 0    ? 'accounted'
       :                    'inconsistent',` },
  { id: 'X09', file: 'script.js', why: 'an inconsistent residual is reported as accounted',
    from: GAPMAP,
    to: `    gap: residual === null ? 'unknown'
       : residual === 0   ? 'accounted'
       : residual  >  0   ? 'partial'
       :                    'accounted',` },
  { id: 'X10', file: 'script.js', why: 'the residual forgets to subtract the records, so a real gap reads zero',
    from: RESIDUAL,
    to: `  const residual = (denom !== null && eligible !== null)
    ? denom - eligible
    : null;` },
  { id: 'X11', file: 'script.js', why: 'a missing denominator silently becomes zero',
    from: '  const denom    = _fin(denominator);',
    to:   '  const denom    = _fin(denominator) === null ? 0 : _fin(denominator);' },
  { id: 'X12', file: 'script.js', why: 'the residual is measured against the record count instead of the gap',
    from: RESIDUAL,
    to: `  const residual = (denom !== null && eligible !== null)
    ? records.length - records.length
    : null;` },
  { id: 'X13', file: 'script.js', why: 'the partial sentence stops naming how many are unattributed',
    from: '`${s.residual} further expense${s.residual !== 1 ? \'s\' : \'\'}',
    to:   '`Some further expense${s.residual !== 1 ? \'s\' : \'\'}' },
  { id: 'X14', file: 'script.js', why: 'the partial branch is replaced by the accounted wording',
    from: "    : s.gap === 'partial'",
    to:   "    : s.gap === '__never_partial__'" },

  // ── RECORDS: a decision is lost or merged ──────────────────────────────
  { id: 'X15', file: 'script.js', why: 'the first recorded exclusion is dropped',
    from: RECMAP, to: '  const records = list.slice(1).map(e => {' },
  { id: 'X16', file: 'script.js', why: 'the last recorded exclusion is dropped',
    from: RECMAP, to: '  const records = list.slice(0, -1).map(e => {' },
  { id: 'X17', file: 'script.js', why: 'records are deduplicated by vendor and category',
    from: RECMAP,
    to:   '  const _seen = new Set();\n  const records = list.filter(e => { const k = (e && e.vendorName) + \'|\' + (e && e.category); if (_seen.has(k)) return false; _seen.add(k); return true; }).map(e => {' },
  { id: 'X18', file: 'script.js', why: 'only one record per category survives',
    from: RECMAP,
    to:   '  const _seenC = new Set();\n  const records = list.filter(e => { const k = e && e.category; if (_seenC.has(k)) return false; _seenC.add(k); return true; }).map(e => {' },
  { id: 'X19', file: 'script.js', why: 'the count is taken from the gap rather than the records',
    from: '    count: records.length,', to: '    count: (denom !== null && eligible !== null) ? denom - eligible : records.length,' },
  { id: 'X20', file: 'script.js', why: 'an empty exclusion list renders a section anyway',
    from: EARLY,
    to: `  const list = Array.isArray(r.excludedShares) ? r.excludedShares : [];
  if (false) return null;` },

  // ── INVENT: identity or a date is fabricated ───────────────────────────
  { id: 'X21', file: 'script.js', why: 'every record claims to be identified',
    from: IDENT, to: '      identified:    true,' },
  { id: 'X22', file: 'script.js', why: 'identity falls back to array position',
    from: IDENT, to: '      identified:    _isUsableRecordId(x.id) || true,' },
  { id: 'X23', file: 'script.js', why: 'a null id is joined against the invoice register by vendor and category',
    from: IDENT,
    to:   '      identified:    _isUsableRecordId(x.id) || (typeof lastInvoicesFull !== \'undefined\' && (lastInvoicesFull || []).some(i => i && i.vendorName === x.vendorName && i.category === x.category)),' },
  { id: 'X24', file: 'script.js', why: 'a date is invented onto the row from the register',
    from: '          <div class="rc-excl-scope">${scope}</div>',
    to:   '          <div class="rc-excl-scope">${scope}</div>\n          <div class="rc-excl-date">${esc(((typeof lastInvoicesFull !== \'undefined\' ? lastInvoicesFull : []) || []).filter(i => i && i.category === x.category).map(i => i.invoiceDate || \'\')[0] || \'2025-01-01\')}</div>' },
  { id: 'X25', file: 'script.js', why: 'the "cannot be linked" disclosure is suppressed',
    from: "  const idNote = s.anyIdentified ? '' :", to: "  const idNote = true ? '' :" },

  // ── SOURCE: excludedShares is replaced by a re-derived predicate ───────
  { id: 'X26', file: 'script.js', why: 'the list is re-derived from the invoice register instead of read',
    from: '  const list = Array.isArray(r.excludedShares) ? r.excludedShares : [];',
    to:   '  const list = (typeof lastInvoicesFull !== \'undefined\' ? (lastInvoicesFull || []) : [])\n    .filter(i => i && /management/i.test(i.category || \'\'))\n    .map(i => ({ id: i.id, vendorName: i.vendorName, category: i.category, scope: \'shared\', cents: Math.round((i.amount || 0) * 100) }));' },
  { id: 'X27', file: 'script.js', why: 'the records are rebuilt by subtracting counts rather than read from the record',
    from: '  const list = Array.isArray(r.excludedShares) ? r.excludedShares : [];',
    to:   '  const _gap = Math.max(0, (_fin0(denominator) || 0) - (_fin0(r.eligibleCount) || 0));\n  function _fin0(v) { return (typeof v === \'number\' && Number.isFinite(v)) ? v : null; }\n  const list = Array.from({ length: _gap }, () => ({ id: null, vendorName: \'\', category: \'\', scope: \'shared\', cents: 0 }));' },

  // ── REPORT: an unknown becomes a confident zero ────────────────────────
  { id: 'X28', file: 'script.js', why: 'an unreadable withheld amount is summed as zero',
    from: TOTAL,
    to:   '  const totalWithheldCents = records.reduce((s, x) => s + (x.withheldCents || 0), 0);' },
  { id: 'X29', file: 'script.js', why: 'an unrecorded category is rendered as a named exclusion',
    from: "      ? `Excluded by lease schedule: ${esc(x.category)}`\n      : 'Excluded by lease schedule (category not recorded)';",
    to:   "      ? `Excluded by lease schedule: ${esc(x.category)}`\n      : 'Excluded by lease schedule: management';" },
  { id: 'X30', file: 'script.js', why: 'an unrecorded scope defaults to shared',
    from: "                : 'Scope not recorded';", to: "                : 'Shared expense';" },
  { id: 'X31', file: 'script.js', why: 'an unreadable amount renders as $0.00',
    from: "      : `<div class=\"rc-excl-amt rc-excl-amt--unknown\">Not recorded</div>",
    to:   "      : `<div class=\"rc-excl-amt rc-excl-amt--unknown\">${_money(0)}</div>" },
  { id: 'X32', file: 'script.js', why: 'the scope is hardcoded, losing the direct/shared distinction',
    from: "      scope:         (x.scope === 'direct' || x.scope === 'shared') ? x.scope : null,",
    to:   "      scope:         'shared'," },
  { id: 'X33', file: 'script.js', why: 'the caveat denying that these are invoice totals is removed',
    from: '<div class="rc-excl-caveat">Amounts below are what this lease withheld from this tenant — not\n          the invoice totals, which these records do not carry.</div>',
    to:   '<div class="rc-excl-caveat">Invoice totals for this tenant.</div>' },

  // ── the section stops being rendered at all ────────────────────────────
  { id: 'X34', file: 'script.js', why: 'the shared builder stops appending the exclusion section',
    from: CALL, to: '' },
  { id: 'X35', file: 'script.js', why: 'the vendor is dropped from the row',
    from: '${esc(x.vendorName || \'Vendor not recorded\')}', to: '' },
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'excmut-'));
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

const SUITES = ['test-excluded-expenses.js'];
function runSuites() {
  for (const suite of SUITES) {
    try {
      execFileSync(process.execPath, [suite], {
        cwd: tmp, stdio: 'pipe', timeout: 600000,
        env: Object.assign({}, process.env, { EXC_PORT: '8974' }),
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
        env: Object.assign({}, process.env, { EXC_PORT: '8974' }) });
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
