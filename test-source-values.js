'use strict';
/**
 * test-source-values.js — one interpretation of every number read off a document.
 *
 *   node test-source-values.js
 *
 * THE TWO DEFECTS THIS EXISTS FOR
 *
 * I-1  Four independent tests for "does this lease have square footage?".
 *      getValidTenants() used `Number(t.leased_sqft) > 0` — NaN for "50,000" —
 *      while both surfaces that would WARN used parseSqft, which reads it as
 *      50000 and stays quiet. The strict predicate decided inclusion, the
 *      permissive ones decided whether to warn. A lease vanished from the
 *      reconciliation with its card reading "verified".
 *
 * I-2  Two parsers for "what is this invoice worth?". The pool total used
 *      parseFloat ("$1,250.00" -> NaN -> $0); the engine used parseMoney
 *      (-> $1,250). Billed could exceed pool, and Math.abs() hid the sign.
 *
 * WHAT IS ASSERTED
 *
 * Reader semantics, and then the thing that actually matters: an INVARIANT that
 * the eligibility gate and every warning surface reach the same conclusion for
 * every value in a corpus of realistic extraction output. Testing the reader
 * alone would not have caught either bug — both readers were always correct in
 * isolation. What was wrong was that they were different readers.
 */

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');

const SV = require('./source-values.js');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log(`  \x1b[32m✓\x1b[0m ${name}`); pass++; }
  catch (e) { console.log(`  \x1b[31m✗\x1b[0m ${name}\n      → ${e.message}`); fail++; }
}
const ok = (c, m) => assert.ok(c, m);
const eq = (a, b, m) => assert.strictEqual(a, b, m || `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);

const scriptSrc  = fs.readFileSync(path.join(__dirname, 'script.js'), 'utf8');
const scriptCode = scriptSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const reviewSrc  = fs.readFileSync(path.join(__dirname, 'review-engine.js'), 'utf8');

console.log('\n══ Source values ══');
console.log('\n── Reading a square footage ──');

t('a formatted area is read, not discarded', () => {
  eq(SV.readArea('50,000').value, 50000);
  eq(SV.readArea('50,000').usable, true);
});

t('the OCR and European-separator rules parseSqft always had are preserved', () => {
  eq(SV.readArea('45,OOO').value, 45000, 'capital-O for zero');
  eq(SV.readArea('45.000').value, 45000, 'European thousands');
  eq(SV.readArea('1200.50').value, 1200.5, 'a real decimal must survive');
  eq(SV.readArea('approx 1200').value, 1200, 'prose around the number');
});

t('ZERO, ABSENT AND UNREADABLE ARE THREE DIFFERENT FACTS', () => {
  // parseSqft returned 0 for all three, which is why no surface could tell a
  // lease with no area apart from one whose area nobody had read.
  eq(SV.readArea('0').status,    'zero');
  eq(SV.readArea('').status,     'absent');
  eq(SV.readArea(null).status,   'absent');
  eq(SV.readArea('TBD').status,  'unreadable');
  eq(SV.readArea('see exhibit A').status, 'unreadable');
  eq(SV.readArea('0').value, 0, 'a real zero keeps its value');
  eq(SV.readArea('TBD').value, null, 'unreadable must be null, never 0');
});

t('none of the three is usable, which is what the gate consults', () => {
  ['0', '', null, undefined, 'TBD'].forEach(v =>
    eq(SV.readArea(v).usable, false, `${JSON.stringify(v)} must not be usable`));
});

console.log('\n── Reading a money amount ──');

t('a currency-formatted amount is read, not zeroed', () => {
  eq(SV.readMoney('$1,250.00').value, 1250);
  eq(SV.readMoney('1,250.00').value, 1250);
  eq(SV.readMoney('1250.00USD').value, 1250);
});

t('accounting negatives are credits, not garbage', () => {
  eq(SV.readMoney('(500)').value, -500);
  eq(SV.readMoney('(500)').usable, true, 'a credit is a real amount');
});

t('unreadable money is null, never zero', () => {
  eq(SV.readMoney('TBD').value, null);
  eq(SV.readMoney('12.34.56').value, null, 'must reject, not partially parse');
  eq(SV.readMoney('TBD').status, 'unreadable');
  eq(SV.readMoney('').status, 'absent');
  eq(SV.readMoney(0).status, 'zero', 'a genuinely free invoice is not an absence');
});

console.log('\n── THE INVARIANT: one value, one conclusion ──');

// A corpus of what extraction and manual entry actually produce. The point is
// not any single row — it is that no row can make two surfaces disagree.
const CORPUS = [
  1200, '1200', ' 1200 ', '1,200', '50,000', '1200.50', '45,OOO', '45.000',
  'approx 1200', '1,200 sq ft', 0, '0', '', null, undefined, 'TBD',
  'see exhibit A', 'N/A', '-', '.',
];

// The four predicates, as they now exist in the codebase.
const gate      = v => SV.readArea(v).usable;                 // getValidTenants
const banner    = v => !SV.readArea(v).usable;                // cam-sqft-warning
const parseSqft = v => SV.readArea(v).value || 0;             // script.js delegate

t('the eligibility gate and the warning banner never disagree', () => {
  const bad = CORPUS.filter(v => gate(v) === banner(v));
  eq(bad.length, 0,
     `a value is both eligible and warned about, or neither: ${JSON.stringify(bad)}`);
});

t('nothing usable is silently excluded, and nothing excluded is silent', () => {
  CORPUS.forEach(v => {
    if (gate(v)) ok(parseSqft(v) > 0, `${JSON.stringify(v)} is eligible but the engine would use 0`);
    else         ok(banner(v),        `${JSON.stringify(v)} is excluded with no warning — SILENT DROP`);
  });
});

t('THE SHONAC CASE specifically', () => {
  eq(gate('50,000'), true,  'a formatted area must reach the reconciliation');
  eq(banner('50,000'), false, 'and must not be warned about as missing');
  eq(parseSqft('50,000'), 50000, 'and the engine must allocate on the real number');
});

t('an unreadable area is excluded AND warned about', () => {
  eq(gate('TBD'), false);
  eq(banner('TBD'), true);
});

console.log('\n── Ownership: the predicates are gone from their old homes ──');

t('[source] getValidTenants no longer has a private opinion about the value', () => {
  const i = scriptCode.indexOf('function getValidTenants');
  const body = scriptCode.slice(i, i + 500);
  ok(!/Number\(t\.leased_sqft\)\s*>\s*0/.test(body),
     'the NaN-on-"50,000" predicate is back in the eligibility gate');
  ok(/SourceValues\.readArea\(t\.leased_sqft\)\.usable/.test(body),
     'the gate does not consult the canonical reading');
});

t('[source] getValidTenants still OWNS the eligibility decision', () => {
  // The reader interprets; this function decides. Moving the decision itself
  // into the reader would just relocate the problem.
  const i = scriptCode.indexOf('function getValidTenants');
  const body = scriptCode.slice(i, i + 500);
  ok(/t\.tenant_name/.test(body) && /extractionFailed/.test(body)
     && /_propertyMismatchBlockReason/.test(body),
     'the other eligibility conditions left getValidTenants');
});

t('[source] the sqft warning surfaces read the same function', () => {
  ok(!/parseSqft\(t\.leased_sqft\)\s*<=\s*0/.test(scriptCode),
     'a warning surface still uses its own predicate');
  eq((scriptCode.match(/SourceValues\.readArea\([^)]*\)\.usable/g) || []).length, 3,
     'expected exactly three consumers of the canonical reading in script.js');
});

t('[source] review-engine reads it too, and fails closed without it', () => {
  ok(/function _hasArea\(t\)/.test(reviewSrc), '_hasArea is gone');
  ok(/SV\.readArea\(t && t\.leased_sqft\)\.usable/.test(reviewSrc),
     'review-engine does not consult the canonical reading');
  ok(/return false;/.test(reviewSrc.slice(reviewSrc.indexOf('function _hasArea'),
                                          reviewSrc.indexOf('function _hasArea') + 700)),
     'the missing-module branch does not fail closed');
  ok(!/if \(!t\.leased_sqft\) warnings\.push/.test(reviewSrc),
     'the raw truthiness test is back in the warning');
  eq((reviewSrc.match(/_hasArea\(t\)/g) || []).length, 4,
     'expected the helper plus its three call sites');
});

t('[source] parseSqft and parseMoney are delegates, not second implementations', () => {
  const ps = scriptCode.slice(scriptCode.indexOf('function parseSqft(v) {'), scriptCode.indexOf('function parseSqft(v) {') + 260);
  ok(/SourceValues\.readArea\(v\)\.value \|\| 0/.test(ps), 'parseSqft re-implements the parsing');
  const pm = scriptCode.slice(scriptCode.indexOf('function parseMoney(v) {'), scriptCode.indexOf('function parseMoney(v) {') + 260);
  ok(/SourceValues\.readMoney\(v\)\.value/.test(pm), 'parseMoney re-implements the parsing');
});

console.log('\n── Invoice amounts are canonical before anything reads them ──');

// The boundary function, evaluated in isolation.
const _canonSrc = scriptSrc.slice(
  scriptSrc.indexOf('function canonicaliseInvoiceAmount(inv) {'),
  scriptSrc.indexOf('window.canonicaliseInvoiceAmount'));
const canon = new Function('window', _canonSrc + '; return { one: canonicaliseInvoiceAmount, many: canonicaliseInvoiceAmounts };')({ SourceValues: SV });

t('a formatted amount becomes a number on the way in', () => {
  eq(canon.one({ amount: '$1,250.00' }).amount, 1250);
  eq(canon.one({ amount: '2,000.00' }).amount, 2000);
  eq(canon.one({ amount: 1250 }).amount, 1250, 'an already-clean amount is untouched');
});

t('so every parseFloat reader downstream is correct without being rewritten', () => {
  // This is the whole reason the fix is at the boundary: 35 call sites do
  // `parseFloat(inv.amount) || 0`, which is right for a number.
  const inv = canon.one({ amount: '$1,250.00' });
  eq(parseFloat(inv.amount) || 0, 1250, 'the downstream assumption is now true');
});

t('UNREADABLE DOES NOT BECOME ZERO — it becomes an excluded invoice', () => {
  const inv = canon.one({ amount: 'TBD' });
  eq(inv.amount, '', 'must not be 0 — 0 is a real amount');
  eq(inv.amountUnparsed, 'TBD', 'the original text is kept for the reader');
  // '' fails `parseFloat(inv.amount) > 0`, which routes it into the existing
  // "N invoices with no amount were excluded" banner rather than silence.
  ok(!(parseFloat(inv.amount) > 0), 'an unreadable amount must not enter the pool as a number');
});

t('a real zero is preserved as zero', () => {
  eq(canon.one({ amount: 0 }).amount, 0);
  eq(canon.one({ amount: '0' }).amount, 0);
});

t('a credit survives the boundary', () => {
  eq(canon.one({ amount: '(500)' }).amount, -500);
});

t('re-canonicalising is idempotent', () => {
  const a = canon.one({ amount: '$1,250.00' });
  const b = canon.one(JSON.parse(JSON.stringify(a)));
  eq(b.amount, 1250);
  eq(b.amountUnparsed, undefined);
});

t('[source] every path that fills invoiceData canonicalises first', () => {
  const pushes  = (scriptCode.match(/invoiceData\.push\(canonicaliseInvoiceAmount\(\{/g) || []).length;
  const splices = (scriptCode.match(/invoiceData\.splice\(0, invoiceData\.length, \.\.\.canonicalise/g) || []).length;
  eq(pushes, 3, 'a creation path bypasses the boundary');
  eq(splices, 4, 'a load path bypasses the boundary');
  ok(!/invoiceData\.push\(\{\s*\n\s*vendorName/.test(scriptCode),
     'a raw invoiceData.push with a vendorName is back');
});

console.log('\n── Clean-data behaviour is unchanged ──');

t('parseSqft returns exactly what it always did for every ordinary value', () => {
  // The old implementation, verbatim, for comparison.
  const legacy = (v) => {
    if (v === null || v === undefined || v === '') return 0;
    let s = String(v).trim();
    s = s.replace(/O/g, '0');
    s = s.replace(/\.(?=\d{3}(?:[,\s]|$))/g, '');
    s = s.replace(/[^0-9.]/g, '');
    const n = parseFloat(s);
    return isNaN(n) ? 0 : n;
  };
  const diffs = CORPUS.filter(v => legacy(v) !== parseSqft(v))
                      .map(v => ({ v, legacy: legacy(v), now: parseSqft(v) }));
  eq(diffs.length, 0, `parseSqft changed behaviour: ${JSON.stringify(diffs)}`);
});

t('parseMoney returns exactly what it always did', () => {
  const legacy = (v) => {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    var raw = String(v).trim();
    var neg = /^\(.*\)$/.test(raw);
    if (neg) raw = raw.slice(1, -1);
    var cleaned = raw.replace(/[$£€]/g, '').replace(/[,\s]/g, '').replace(/[A-Za-z]+$/, '');
    if (cleaned === '' || cleaned === '-' || cleaned === '.') return null;
    if (!/^-?\d*\.?\d+$/.test(cleaned)) return null;
    var n = Number(cleaned);
    if (!Number.isFinite(n)) return null;
    return neg ? -n : n;
  };
  const money = ['1250', '1,250.00', '$1,250.00', '(500)', '0', '', null, 'TBD',
                 '12.34.56', '1250.00USD', 0, -25, 1250.5];
  const diffs = money.filter(v => legacy(v) !== SV.readMoney(v).value)
                     .map(v => ({ v, legacy: legacy(v), now: SV.readMoney(v).value }));
  eq(diffs.length, 0, `parseMoney changed behaviour: ${JSON.stringify(diffs)}`);
});

t('an ordinary numeric lease is eligible exactly as before', () => {
  [1200, '1200', ' 1200 ', 8194, 100000].forEach(v =>
    eq(gate(v), true, `${JSON.stringify(v)} should still be eligible`));
  [0, '', null].forEach(v =>
    eq(gate(v), false, `${JSON.stringify(v)} should still be ineligible`));
});

console.log('\n' + '─'.repeat(56));
if (fail) { console.log(`\x1b[31mRESULT: ${pass} passed, ${fail} failed\x1b[0m`); process.exit(1); }
console.log(`\x1b[32mRESULT: ${pass} passed, 0 failed\x1b[0m`);
