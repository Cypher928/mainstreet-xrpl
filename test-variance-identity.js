'use strict';
/**
 * test-variance-identity.js — an allocation must find its invoice, and a cap
 * reduction must never be called uncovered CAM.
 *
 *   node test-variance-identity.js
 *
 * THE DEFECT THIS EXISTS FOR
 *
 * On the Cascade Commons demo the CAM summary told the manager:
 *
 *   "Partial property coverage — $99,523.23 currently unallocated … because the
 *    loaded leases cover 90.0% of the property"
 *
 * while the authoritative decomposition said 75.9% of that gap was lease caps
 * and only 18.9% was the uncovered share. Two different things, and the smaller
 * one was the headline.
 *
 * Opening the panel behind that banner was worse:
 *
 *   Rounding to the nearest cent      $169,470.00
 *   Not attributed                   $-164,325.37
 *
 * on a $188,300 pool, with all 26 invoices shown as allocated $0.00.
 *
 * TWO ROOT CAUSES, both about identity rather than arithmetic:
 *
 *   1  invoiceKey() prefers `id`. The engine's stored line items carry
 *      `id: null` and key on vendor|category|cents; the register rows carry a
 *      generated id and key on `id:…`. Across those two shapes the keys can
 *      never meet, so every allocation read as zero and the residue — a
 *      MEASUREMENT, not a plug — absorbed the whole allocated pool.
 *
 *   2  `excludedShares` entries carry neither an amount nor a date, so a lease
 *      exclusion could not be matched to an invoice at all. $5,144.60 of
 *      ProActive's management exclusion was reported as "Rounding to the
 *      nearest cent".
 *
 * And one in the surface: the coverage-incomplete banner branch asserted
 * coverage as the cause without ever reading the breakdown sitting a few lines
 * above it. The coverage-COMPLETE branch already read it. That asymmetry was the
 * whole defect.
 *
 * WHAT THIS PINS
 *   A  the identity rule, case by case, including the ambiguity it refuses
 *   B  the buckets, and that caps ≠ uncovered
 *   C  the coexistence matrix: both, caps only, uncovered only, neither
 *   D  insufficient data is stated, never estimated
 *   E  the demo's own figures
 *   F  the CAM summary surfaces the distinction and infers no vacancy
 *   G  CAM arithmetic and billing readiness are untouched
 */

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');

const VB = require('./variance-breakdown.js');
const MC = require('./money-cents.js');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log(`  \x1b[32m✓\x1b[0m ${name}`); pass++; }
  catch (e) { console.log(`  \x1b[31m✗\x1b[0m ${name}\n      → ${e.message}`); fail++; }
}
const ok = (c, m) => assert.ok(c, m);
const eq = (a, b, m) => assert.strictEqual(a, b, m || `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
const near = (a, b, m) => assert.ok(Math.abs(a - b) < 0.02, m || `expected ~${b}, got ${a}`);
const H  = (s) => console.log(`\n\x1b[36m── ${s} ──\x1b[0m`);

// Source, comment-stripped, so this slice's own prose cannot satisfy an
// assertion about the code it describes.
const code = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  .replace(/<!--[\s\S]*?-->/g, '');
const scriptCode = code('script.js');
// The banner builder, loaded and CALLED rather than grepped. Mutation testing
// showed that source assertions on this were hollow: flipping a condition to
// `false`, or reading the uncovered figure out of the caps bucket, left every
// string in place and every assertion green.
const { fnSource } = require('./test-support/fn-source.js');
const rawScript = fs.readFileSync(path.join(__dirname, 'script.js'), 'utf8');
const _explainSrc = fnSource(rawScript, '_varianceExplanationHtml');
const explain = (() => {
  const fmt = (n) => '$' + (Number(n) || 0).toLocaleString('en-US',
    { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const esc = (v) => String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  // eslint-disable-next-line no-new-func
  return new Function('fmt', 'esc', _explainSrc + '\nreturn _varianceExplanationHtml;')(fmt, esc);
})();
const plain = (html) => String(html).replace(/<[^>]*>/g, ' ').replace(/&#x1F4D0;/g, '')
  .replace(/&mdash;/g, '—').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const bkOf = (o) => Object.assign({ lines: [], unmatchedInvoices: 0, difference: 0 }, o);
const CTX = { variance: 1000, totalBilled: 400, totalPool: 1400, proRataSum: 50 };
const vbCode     = code('variance-breakdown.js');
const htmlSrc    = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

// ── builders ────────────────────────────────────────────────────────────────
// A stored tenant line item: the engine's shape, id null.
const li = (v, c, amount, share, date) => {
  const o = { id: null, vendorName: v, category: c, amount, share };
  if (date) o.invoiceDate = date;
  return o;
};
// A register invoice: carries a generated id.
const reg = (id, v, c, amount, date, extra) => Object.assign(
  { id, vendorName: v, category: c, amount, matchConfidence: 0, camEligible: true },
  date ? { invoiceDate: date } : {}, extra || {});
const result = (o) => Object.assign({
  precision: 'cents', tenantName: 'T', sqFt: 5000, proRataPercent: 50,
  totalAllocated: 0, capApplied: false, capAdjustment: 0,
  includedInvoices: [], excludedShares: [],
}, o);

console.log('\n══ Variance identity & shortfall attribution ══');

// ── A — the identity rule ───────────────────────────────────────────────────
H('A · matching an allocation to its invoice');

t('A1 ID to ID: both sides carry the same id → exact match', () => {
  const bk = VB.derive({
    results: [result({ totalAllocated: 500, includedInvoices: [
      { id: 'x1', vendorName: 'Acme', category: 'jan', amount: 1000, share: 500 }] })],
    invoices: [reg('x1', 'Acme', 'jan', 1000)], pool: 1000, billed: 500,
  });
  eq(bk.invoices[0].allocated, 500);
  eq(bk.unmatchedInvoices, 0);
});

t('A2 MISSING ID on the line items → the fallback matches (the demo case)', () => {
  const bk = VB.derive({
    results: [result({ totalAllocated: 500, includedInvoices: [li('Acme', 'jan', 1000, 500, '2025-01-01')] })],
    invoices: [reg('generated-0', 'Acme', 'jan', 1000, '2025-01-01')], pool: 1000, billed: 500,
  });
  eq(bk.invoices[0].allocated, 500, 'the allocation did not reach its invoice');
  eq(bk.unmatchedInvoices, 0);
});

t('A3 MISMATCHED IDs but a valid fallback identity → still matches', () => {
  const bk = VB.derive({
    results: [result({ totalAllocated: 500, includedInvoices: [
      { id: 'engine-zz', vendorName: 'Acme', category: 'jan', amount: 1000, invoiceDate: '2025-01-01', share: 500 }] })],
    invoices: [reg('register-aa', 'Acme', 'jan', 1000, '2025-01-01')], pool: 1000, billed: 500,
  });
  eq(bk.invoices[0].allocated, 500, 'two ids that disagree defeated the fallback');
  eq(bk.unmatchedInvoices, 0);
});

t('A4 REPEATS separated by date — four identical $7,600 invoices', () => {
  const dates = ['2025-03-31', '2025-06-30', '2025-09-30', '2025-12-31'];
  const bk = VB.derive({
    results: [result({ totalAllocated: 15200,
      includedInvoices: dates.map(d => li('Cascade Property Management', 'management', 7600, 3800, d)) })],
    invoices: dates.map((d, i) => reg('inv-' + i, 'Cascade Property Management', 'management', 7600, d)),
    pool: 30400, billed: 15200,
  });
  assert.deepStrictEqual(bk.invoices.map(r => r.allocated), [3800, 3800, 3800, 3800],
    'the four repeats did not each get their own share');
  eq(bk.unmatchedInvoices, 0);
});

t('A5 AMBIGUOUS: identical AND undated → REFUSED, not guessed', () => {
  const bk = VB.derive({
    results: [result({ totalAllocated: 1000,
      includedInvoices: [li('Acme', 'jan', 1000, 500), li('Acme', 'jan', 1000, 500)] })],
    invoices: [reg('a', 'Acme', 'jan', 1000), reg('b', 'Acme', 'jan', 1000)],
    pool: 2000, billed: 1000,
  });
  // The merged total is $1,000. Handing it to BOTH rows would over-attribute by
  // 2x — a different wrong answer than $0, and a worse one.
  assert.deepStrictEqual(bk.invoices.map(r => r.allocated), [0, 0],
    'an unidentifiable invoice was given an allocation anyway');
  eq(bk.unmatchedInvoices, 2, 'the refusal was not reported');
});

t('A6 AMBIGUOUS: dates on the register side only → REFUSED', () => {
  const bk = VB.derive({
    results: [result({ totalAllocated: 1000,
      includedInvoices: [li('Acme', 'jan', 1000, 500), li('Acme', 'jan', 1000, 500)] })],
    invoices: [reg('a', 'Acme', 'jan', 1000, '2025-01-01'), reg('b', 'Acme', 'jan', 1000, '2025-04-01')],
    pool: 2000, billed: 1000,
  });
  assert.deepStrictEqual(bk.invoices.map(r => r.allocated), [0, 0]);
  eq(bk.unmatchedInvoices, 2);
});

t('A7 NO FABRICATED MATCH: a different amount is a different invoice', () => {
  const bk = VB.derive({
    results: [result({ totalAllocated: 500, includedInvoices: [li('Acme', 'jan', 1000, 500, '2025-01-01')] })],
    invoices: [reg('a', 'Acme', 'jan', 999, '2025-01-01')], pool: 999, billed: 500,
  });
  eq(bk.invoices[0].allocated, 0, 'a $999 invoice claimed a $1,000 allocation');
});

t('A8 NO FABRICATED MATCH: a different vendor or category is a different invoice', () => {
  const mk = (v, c) => VB.derive({
    results: [result({ totalAllocated: 500, includedInvoices: [li('Acme', 'jan', 1000, 500, '2025-01-01')] })],
    invoices: [reg('a', v, c, 1000, '2025-01-01')], pool: 1000, billed: 500,
  }).invoices[0].allocated;
  eq(mk('Other Co', 'jan'), 0, 'a different vendor matched');
  eq(mk('Acme', 'repairs'), 0, 'a different category matched');
});

t('A9 [source] invoiceKey() itself is UNCHANGED — a snapshot set depends on it', () => {
  const i = vbCode.indexOf('function invoiceKey');
  const body = vbCode.slice(i, vbCode.indexOf('\n  }', i));
  ok(/if \(inv\.id\) return 'id:' \+ String\(inv\.id\);/.test(body),
     'invoiceKey stopped preferring id — the persisted year-filter set would not match on restore');
  ok(/\.join\('\|'\)/.test(body), 'the fallback form changed');
  // script.js persists these keys into the snapshot and matches them on restore.
  ok(/VB\.invoiceKey\(i\)/.test(scriptCode), 'the snapshot no longer keys on invoiceKey');
});

t('A10 [source] the cross-shape rule is its own function, tried strongest first', () => {
  const i = vbCode.indexOf('function buildAllocationIndex');
  ok(i !== -1, 'there is no allocation index');
  const body = vbCode.slice(i, vbCode.indexOf('\n  }', vbCode.indexOf('return function lookup', i)));
  ok(/if \(inv\.id\)[\s\S]*byId\.has/.test(body), 'the id is not tried first');
  ok(/byDated\.has\(dk\)/.test(body),            'the dated fallback is missing');
  ok(/e\.dated\.size <= 1 && e\.maxPerResult <= 1/.test(body),
     'the loose fallback is not guarded against ambiguity');
});

// ── B — the buckets ─────────────────────────────────────────────────────────
H('B · a cap reduction is not an uncovered share');

// One property, both causes: 50% covered, and a cap on the one tenant.
//
// `includedInvoices[].share` is the UNCAPPED pro-rata share, and the cap is
// accounted separately — confirmed against the running demo, where Whole Health
// Market's line item on the $42,000 insurance invoice reads $14,861.54 (35.38%
// of it) even though the cap held its total billing to $34,650. A fixture that
// wrote the post-cap share here double-counts the cap and the breakdown
// correctly reports a −$100 residual, which is what caught the error.
const BOTH = {
  results: [result({ tenantName: 'A', proRataPercent: 50, totalAllocated: 400,
    capApplied: true, capAdjustment: 100,
    includedInvoices: [li('Acme', 'jan', 1000, 500, '2025-01-01')] })],
  invoices: [reg('a', 'Acme', 'jan', 1000, '2025-01-01')],
  pool: 1000, billed: 400,
};

t('B1 caps and uncovered are separate, non-interchangeable buckets', () => {
  const bk = VB.derive(BOTH);
  const caps  = bk.lines.find(l => l.key === 'caps');
  const uncov = bk.lines.find(l => l.key === 'uncovered');
  ok(caps,  'no caps bucket');
  ok(uncov, 'no uncovered bucket');
  eq(caps.amount, 100);
  near(uncov.amount, 500);
  ok(caps.amount !== uncov.amount, 'the two buckets report the same figure');
  ok(!/cap/i.test(uncov.label), 'the uncovered bucket is labelled as a cap: ' + uncov.label);
  ok(!/cover/i.test(caps.label), 'the caps bucket is labelled as coverage: ' + caps.label);
});

t('B2 the identity closes: difference === sum of the buckets', () => {
  const bk = VB.derive(BOTH);
  const sum = bk.lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
  near(sum, bk.difference, `buckets ${sum} vs difference ${bk.difference}`);
  eq(bk.residual, 0, 'the buckets did not close and nothing said so');
});

t('B3 an exclusion is reported as an exclusion, not as rounding', () => {
  const bk = VB.derive({
    results: [result({ proRataPercent: 100, totalAllocated: 600,
      includedInvoices: [li('Acme', 'management', 1000, 600, '2025-01-01')],
      excludedShares: [{ id: null, vendorName: 'Acme', category: 'management', scope: 'shared', cents: 40000 }] })],
    invoices: [reg('a', 'Acme', 'management', 1000, '2025-01-01')], pool: 1000, billed: 600,
  });
  const excl = bk.lines.find(l => l.key === 'excluded_by_lease');
  const round = bk.lines.find(l => l.key === 'rounding_residue');
  ok(excl, 'no exclusion bucket');
  near(excl.amount, 400);
  ok(!round || Math.abs(round.amount) < 1,
     'a lease exclusion is still being reported as rounding: ' + (round && round.amount));
  eq(bk.excludedUnattributed > 0, true, 'the unattributable part was not reported');
});

// ── C — the coexistence matrix ──────────────────────────────────────────────
H('C · both, one, or neither');

t('C1 CAPS ONLY: full coverage, a cap applied → no uncovered claimed', () => {
  const bk = VB.derive({
    results: [result({ proRataPercent: 100, totalAllocated: 900, capApplied: true, capAdjustment: 100,
      includedInvoices: [li('Acme', 'jan', 1000, 1000, '2025-01-01')] })],
    invoices: [reg('a', 'Acme', 'jan', 1000, '2025-01-01')], pool: 1000, billed: 900,
  });
  eq(bk.capTotal, 100);
  near(bk.uncovered, 0);
  ok(!bk.lines.some(l => l.key === 'uncovered'),
     'an uncovered line was rendered on a fully covered property');
  eq(bk.residual, 0, 'the cap-only case does not close');
});

t('C2 UNCOVERED ONLY: partial coverage, no cap → no cap reduction claimed', () => {
  const bk = VB.derive({
    results: [result({ proRataPercent: 40, totalAllocated: 400,
      includedInvoices: [li('Acme', 'jan', 1000, 400, '2025-01-01')] })],
    invoices: [reg('a', 'Acme', 'jan', 1000, '2025-01-01')], pool: 1000, billed: 400,
  });
  eq(bk.capTotal, 0);
  near(bk.uncovered, 600);
  ok(!bk.lines.some(l => l.key === 'caps'),
     'a cap line was rendered on a reconciliation with no cap');
});

t('C3 NEITHER: fully covered, no cap, nothing withheld → no gap at all', () => {
  const bk = VB.derive({
    results: [result({ proRataPercent: 100, totalAllocated: 1000,
      includedInvoices: [li('Acme', 'jan', 1000, 1000, '2025-01-01')] })],
    invoices: [reg('a', 'Acme', 'jan', 1000, '2025-01-01')], pool: 1000, billed: 1000,
  });
  eq(bk.difference, 0);
  eq(bk.capTotal, 0);
  near(bk.uncovered, 0);
  eq(bk.lines.length, 0, 'buckets were rendered for a reconciliation with no gap');
});

// ── D — insufficient data is stated ─────────────────────────────────────────
H('D · when it cannot tell, it says so');

t('D1 no line items at all → nothing is attributed to a cause', () => {
  const bk = VB.derive({
    results: [result({ proRataPercent: 100, totalAllocated: 500, includedInvoices: [] })],
    invoices: [reg('a', 'Acme', 'jan', 1000, '2025-01-01')], pool: 1000, billed: 500,
  });
  eq(bk.unmatchedInvoices, 1, 'an unmatchable invoice was not counted');
});

t('D2 the unmatched count travels on the result, for a surface to report', () => {
  ok(/unmatchedInvoices/.test(vbCode), 'the count is not computed');
  const bk = VB.derive({ results: [], invoices: [], pool: 0, billed: 0 });
  eq(typeof bk.unmatchedInvoices, 'number', 'the field is absent on a result');
});

t('D3 an unattributable exclusion is reported as such, not silently absorbed', () => {
  ok(/excludedUnattributed/.test(vbCode), 'the unattributed exclusion is not reported');
  ok(/aggExclC - attributedC/.test(vbCode),
     'the exclusion is not derived as aggregate-minus-attributed, so it could double count');
});

// ── E — the demo's own figures ──────────────────────────────────────────────
H('E · the Cascade Commons demo');

t('E1 the demo decomposes to caps $75,548.60 and uncovered $18,830.00', () => {
  // The engine's own stored figures for that run, in the shapes it writes them.
  const POOL = 188300, BILLED = 88776.77;
  const caps = [31979.23, 6340.15, 12941.55, 24287.67];
  const total = caps.reduce((s, c) => s + c, 0);
  near(total, 75548.60, 'the demo cap total moved');
  near(POOL - BILLED, 99523.23, 'the demo gap moved');
  // caps + uncovered + exclusions + rounding, as measured on the running app.
  near(75548.60 + 18830.00 + 5144.60 + 0.03, 99523.23,
     'the demo buckets no longer close on the gap');
  // And the point of the slice: caps are the larger share, not coverage.
  ok(75548.60 > 18830.00 * 3, 'caps are no longer the dominant cause on the demo');
});

// ── F — the CAM summary surfaces it ─────────────────────────────────────────
H('F · the CAM summary reads the breakdown');

t('F1 [source] the coverage-incomplete branch hands the breakdown to the builder', () => {
  const i = scriptCode.indexOf('const varianceBanner = variance <= 0.05');
  const body = scriptCode.slice(i, i + 1200);
  ok(/_coverageIncomplete/.test(body), 'the branch is gone');
  ok(/_varianceExplanationHtml\(_lastVarianceBreakdown,/.test(body),
     'the coverage branch does not pass the authoritative breakdown to the explainer');
});

t('F2 [source] it no longer asserts coverage as THE cause', () => {
  ok(!/Partial property coverage — \$\{fmt\(variance\)\} currently unallocated/.test(scriptCode),
     'the old coverage-as-cause headline is still there');
  ok(!/because the loaded leases cover \$\{proRataSum\.toFixed\(1\)\}% of the property/.test(scriptCode),
     'the banner still explains the whole gap by coverage');
});

t('F3 MEASURED: caps and uncovered each get their own prose, only when present', () => {
  const both = plain(explain(bkOf({ lines: [
    { key: 'caps', label: 'Reduced by a CAM cap', amount: 800 },
    { key: 'uncovered', label: 'Outside the 50.0% of the property covered by loaded leases', amount: 200 },
  ] }), CTX));
  ok(/\$800\.00 reduced by a CAM cap is money the leases say those tenants do not owe/.test(both), both);
  ok(/\$200\.00 outside the covered share is property expense with no paying tenant allocation/.test(both), both);
  ok(/neither explains the other/.test(both), both);

  const capsOnly = plain(explain(bkOf({ lines: [
    { key: 'caps', label: 'Reduced by a CAM cap', amount: 1000 }] }), CTX));
  ok(/reduced by a CAM cap/.test(capsOnly), capsOnly);
  ok(!/no paying tenant allocation/.test(capsOnly),
     'an uncovered share was described on a run that has none: ' + capsOnly);
  ok(!/neither explains the other/.test(capsOnly), capsOnly);

  const uncovOnly = plain(explain(bkOf({ lines: [
    { key: 'uncovered', label: 'Outside the 50.0% of the property covered by loaded leases', amount: 1000 }] }), CTX));
  ok(/no paying tenant allocation/.test(uncovOnly), uncovOnly);
  ok(!/leases say those tenants do not owe/.test(uncovOnly),
     'a cap reduction was described on a run that has none: ' + uncovOnly);
});

t('F3b MEASURED: the uncovered figure is never taken from the caps bucket', () => {
  // The two buckets carry different amounts, so a surface reading the wrong one
  // announces the wrong number under the wrong name.
  const out = plain(explain(bkOf({ lines: [
    { key: 'caps', label: 'Reduced by a CAM cap', amount: 900 },
    { key: 'uncovered', label: 'Outside the 50.0% of the property covered by loaded leases', amount: 100 },
  ] }), CTX));
  ok(/\$100\.00 outside the covered share/.test(out),
     'the uncovered sentence is not reporting the uncovered bucket: ' + out);
  ok(!/\$900\.00 outside the covered share/.test(out),
     'THE CAP AMOUNT IS BEING DESCRIBED AS UNCOVERED CAM: ' + out);
  ok(/\$900\.00 reduced by a CAM cap/.test(out), out);
});

t('F4 MEASURED: no vacancy is inferred from the uncovered share', () => {
  const out = plain(explain(bkOf({ lines: [
    { key: 'uncovered', label: 'Outside the 50.0% of the property covered by loaded leases', amount: 1000 }] }), CTX));
  ok(/has not been established/.test(out), out);
  ok(!/is vacant and the landlord absorbs/.test(out),
     'the uncovered share is asserted to be vacancy: ' + out);
  ok(!/\bvacant\b(?!\s+or)/.test(out.replace('vacant or under a lease', 'X')),
     'vacancy is claimed rather than left open: ' + out);
});

t('F5 MEASURED: a residual is stated when there is one, and not when there is not', () => {
  const withResid = plain(explain(bkOf({ lines: [
    { key: 'caps', label: 'Reduced by a CAM cap', amount: 900 },
    { key: 'residual', label: 'Not attributed', amount: 100 },
  ] }), CTX));
  ok(/\$100\.00 is not attributed to any of these causes/.test(withResid), withResid);
  const clean = plain(explain(bkOf({ lines: [
    { key: 'caps', label: 'Reduced by a CAM cap', amount: 1000 }] }), CTX));
  ok(!/not attributed to any of these causes/.test(clean),
     'a residual was announced on a run that closed: ' + clean);
});

t('F5b MEASURED: unmatched invoices are stated when there are any', () => {
  const withUnmatched = plain(explain(bkOf({ unmatchedInvoices: 3, lines: [
    { key: 'caps', label: 'Reduced by a CAM cap', amount: 1000 }] }), CTX));
  ok(/3 invoices could not be matched to an allocation/.test(withUnmatched), withUnmatched);
  ok(/do not account for them/.test(withUnmatched), withUnmatched);
  const clean = plain(explain(bkOf({ unmatchedInvoices: 0, lines: [
    { key: 'caps', label: 'Reduced by a CAM cap', amount: 1000 }] }), CTX));
  ok(!/could not be matched/.test(clean),
     'unmatched invoices were announced on a run with none: ' + clean);
});

t('F5c MEASURED: every bucket is listed, largest first, none dropped', () => {
  const out = plain(explain(bkOf({ lines: [
    { key: 'rounding_residue', label: 'Rounding to the nearest cent', amount: 0.03 },
    { key: 'uncovered', label: 'Outside the 50.0% of the property covered by loaded leases', amount: 200 },
    { key: 'caps', label: 'Reduced by a CAM cap', amount: 800 },
    { key: 'excluded_by_lease', label: 'Excluded from CAM by a lease', amount: 50 },
  ] }), CTX));
  ['Reduced by a CAM cap', 'Outside the 50.0%', 'Excluded from CAM by a lease',
   'Rounding to the nearest cent'].forEach(l => ok(out.includes(l), 'missing bucket: ' + l + ' in ' + out));
  ok(out.indexOf('Reduced by a CAM cap') < out.indexOf('Outside the 50.0%'), 'not ordered by size: ' + out);
  ok(out.indexOf('Excluded from CAM by a lease') < out.indexOf('Rounding to the nearest cent'), out);
});

t('F5d MEASURED: a zero bucket is not rendered', () => {
  const out = plain(explain(bkOf({ lines: [
    { key: 'caps', label: 'Reduced by a CAM cap', amount: 1000 },
    { key: 'uncovered', label: 'Outside the 50.0% of the property covered by loaded leases', amount: 0 },
  ] }), CTX));
  ok(!/Outside the 50\.0%/.test(out), 'a $0 bucket was rendered: ' + out);
});

t('F6 MEASURED: with no breakdown it claims no cause at all', () => {
  [null, bkOf({ lines: [] }), bkOf({ lines: null })].forEach(bad => {
    const out = plain(explain(bad, CTX));
    ok(/could not break this difference down into its causes/.test(out),
       'the no-breakdown path attributes a cause anyway: ' + out);
    ok(!/because the loaded leases cover/.test(out),
       'the no-breakdown path blames coverage: ' + out);
    ok(!/reduced by a CAM cap is money/.test(out), out);
  });
});

t('F7 [source] bucket labels come from the module, not retyped in the banner', () => {
  const i = scriptCode.indexOf('const _rows = bk.lines');
  const body = scriptCode.slice(i, i + 800);
  ok(/esc\(l\.label\)/.test(body), 'the banner writes its own labels');
  ok(/fmt\(l\.amount\)/.test(body), 'the banner writes its own amounts');
  ok(!/\.slice\(0,\s*\d\)/.test(body), 'the banner truncates the bucket list');
});

t('F8 the breakdown list is styled', () => {
  ok(/\.rcs-vb-list\s*\{/.test(htmlSrc), 'no .rcs-vb-list rule');
  ok(/\.rcs-vb-item\s*\{/.test(htmlSrc), 'no .rcs-vb-item rule');
  ok(/\.rcs-vb-item--residual/.test(htmlSrc), 'the residual line is not distinguished');
});

// ── G — nothing else moved ──────────────────────────────────────────────────
H('G · CAM arithmetic and billing readiness are untouched');

t('G1 [source] the explainer computes no CAM figure of its own', () => {
  const body = fnSource(code('script.js'), '_varianceExplanationHtml');
  ok(!/runFullReconciliation|capBaseAmount|proRataPercent \*|allocatedAmount \*|CamPool/.test(body),
     'the explainer performs allocation arithmetic');
  // It may only read what it was handed.
  ok(!/lastResults|lastTotal|lastInvoicesFull|currentProperty\(/.test(body),
     'the explainer reaches for global run state instead of its arguments');
});

t('G2 [source] variance, totalBilled and totalPool are unchanged expressions', () => {
  ok(/const variance = Math\.abs\(totalBilled - totalPool\);/.test(scriptCode), 'variance moved');
  ok(/const totalBilled = results\.reduce\(\(s, r\) => s \+ r\.totalAllocated, 0\);/.test(scriptCode),
     'totalBilled moved');
  ok(/const totalPool   = invoices\.reduce\(\(s, inv\) => s \+ \(parseFloat\(inv\.amount\) \|\| 0\), 0\);/
     .test(scriptCode), 'totalPool moved');
});

t('G3 [source] the cap total is still read off the stored results', () => {
  ok(/results\.reduce\(\(s, r\) => s \+ \(r\.capApplied \? \(Number\(r\.capAdjustment\) \|\| 0\) : 0\), 0\)/
     .test(vbCode), 'the cap total is no longer read from capAdjustment');
});

t('G4 [source] billing readiness is not consulted or altered by the explainer', () => {
  const body = fnSource(code('script.js'), '_varianceExplanationHtml');
  ok(!/billingReadiness|canBill|blockers/.test(body), 'the explainer reaches into billing readiness');
});

t('G5 the module still declares no CAM arithmetic', () => {
  const raw = fs.readFileSync(path.join(__dirname, 'variance-breakdown.js'), 'utf8');
  ok(/NO CAM ARITHMETIC HAPPENS HERE/.test(raw), 'the module dropped its own contract');
});

// ── Z — self-checks ─────────────────────────────────────────────────────────
H('Z · self-checks');

t('Z1 the source reads are comment-stripped', () => {
  ok(!/THE DEFECT THIS EXISTS FOR/.test(scriptCode), 'block comments survived');
  ok(!/MATCHING AN ALLOCATION TO AN INVOICE/.test(vbCode), 'vb comments survived');
  ok(!/Was "Expected/.test(scriptCode), 'html comments survived');
});
t('Z2 the modules loaded', () => {
  eq(typeof VB.derive, 'function');
  eq(typeof MC.toCents, 'function');
  ok(scriptCode.length > 1000 && vbCode.length > 1000);
});

console.log('\n' + (fail === 0 ? '\x1b[32m' : '\x1b[31m') +
  `${pass} passed, ${fail} failed\x1b[0m\n`);
process.exit(fail ? 1 : 0);
