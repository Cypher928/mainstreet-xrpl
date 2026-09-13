'use strict';
/**
 * test-invoice-duplicates.js — a quarterly retainer is not a duplicate, and the
 * register and the audit summary must never disagree about which is which.
 *
 *   node test-invoice-duplicates.js
 *
 * THE DEFECT THIS EXISTS FOR
 *
 * On the Cascade Commons demo the CAM invoice register showed, on 11 of its 26
 * rows:
 *
 *     ⚠ Possible duplicate of Cascade Property Management   [Remove]
 *
 * while the audit summary on the same screen, from the same invoices, reported
 *
 *     ✓ No duplicate or suspicious invoice patterns detected
 *
 * The flagged invoices were quarterly retainers — management, janitorial and
 * security — billed 61 to 91 days apart. Every one of them carried a Remove
 * button wired to removeInvItem(), which splices the invoice out and persists.
 * A manager who believed the badge would delete a real invoice, silently
 * shrinking the CAM pool and changing every tenant's share.
 *
 * ROOT CAUSE: two definitions of "duplicate".
 *
 *   the authority   _detectInvoiceSuspicions: exact = vendor + amount + DATE
 *                   (red); near = vendor + amount within 7 days (yellow);
 *                   anything further apart is a recurring charge and is not
 *                   flagged at all.
 *
 *   the badge       `Math.abs(amt - oth.amount) <= 1 && similarVendor(...)`.
 *                   No date. Looser amount. Fuzzy vendor. And the delete button.
 *
 * TWO DIVERGENCES RESOLVED IN THE AUTHORITY'S FAVOUR, pinned below rather than
 * changed silently:
 *
 *   AMOUNT  the authority keys on `amount.toFixed(2)` — equal to the cent. The
 *           badge's ±$1 tolerance appears nowhere in the authority and was never
 *           stated as an intent; it is a looser rule carrying a destructive
 *           action. Section C pins exact-cent equality, and pins that $999.50
 *           and $1,000.00 on the same day are NOT called duplicates.
 *
 *   VENDOR  the authority compares the normalised name; the badge used the fuzzy
 *           similarVendor(). Section C pins that "Austin Energy" and "Austin
 *           Energy Inc" are not merged — that is a judgement the audit engine
 *           does not make.
 *
 * AN UNDATED INVOICE IS NEVER A DUPLICATE (section D). The authority excludes it
 * from both checks, because the evidence for the claim is the date and there is
 * none. That refusal is preserved, not reasoned around.
 *
 * WHAT THIS PINS
 *   A  the authoritative rule, case by case, including both thresholds' edges
 *   B  the two surfaces agree — same fixture, same verdict
 *   C  the $1 tolerance and the fuzzy vendor match, decided and pinned
 *   D  undated invoices
 *   E  the demo's own figures
 *   F  the register badge and the Remove confirmation
 *   G  CAM arithmetic, audit severities and billing readiness untouched
 */

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');
const { fnSource } = require('./test-support/fn-source.js');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log(`  \x1b[32m✓\x1b[0m ${name}`); pass++; }
  catch (e) { console.log(`  \x1b[31m✗\x1b[0m ${name}\n      → ${e.message}`); fail++; }
}
const ok = (c, m) => assert.ok(c, m);
const eq = (a, b, m) => assert.strictEqual(a, b, m || `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
const H  = (s) => console.log(`\n\x1b[36m── ${s} ──\x1b[0m`);

const rawScript  = fs.readFileSync(path.join(__dirname, 'script.js'), 'utf8');
// Comment-stripped, so this slice's own prose cannot satisfy a source assertion.
const scriptCode = rawScript.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// The two functions, loaded and CALLED. `fmt` is the only global the detector
// needs; nothing else is stubbed, because nothing else is used.
const fmt = (n) => '$' + (Number(n) || 0).toLocaleString('en-US',
  { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const DUP_LIMIT = (() => {
  const m = scriptCode.match(/const _DUP_NEAR_DAY_LIMIT = (\d+);/);
  if (!m) throw new Error('_DUP_NEAR_DAY_LIMIT not found');
  return parseInt(m[1], 10);
})();
const esc = (v) => String(v == null ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const { findDuplicates, detect, badgeHtml, confirmText } = (() => {
  const src = `const _DUP_NEAR_DAY_LIMIT = ${DUP_LIMIT};\n`
    + fnSource(rawScript, '_findDuplicateInvoices') + '\n'
    + fnSource(rawScript, '_detectInvoiceSuspicions') + '\n'
    + fnSource(rawScript, '_dupBadgeHtml') + '\n'
    + fnSource(rawScript, '_removeInvoiceConfirmText') + '\n'
    + 'return { findDuplicates: _findDuplicateInvoices, detect: _detectInvoiceSuspicions,'
    + '         badgeHtml: _dupBadgeHtml, confirmText: _removeInvoiceConfirmText };';
  // eslint-disable-next-line no-new-func
  return new Function('fmt', 'esc', src)(fmt, esc);
})();

// ── builders ────────────────────────────────────────────────────────────────
const inv = (vendorName, amount, invoiceDate, extra) =>
  Object.assign({ vendorName, amount, invoiceDate, category: 'utilities' }, extra || {});
const plus = (iso, days) => {
  const d = new Date(iso); d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};
const dupTitles = (list) => detect(list)
  .filter(f => /duplicate/i.test(f.title))
  .map(f => ({ severity: f.severity, title: f.title }));
const badged = (list) => findDuplicates(list).byIndex;

console.log('\n══ Invoice duplicate detection ══');

// ── A — the authoritative rule ──────────────────────────────────────────────
H('A · what the audit engine calls a duplicate');

t('A1 QUARTERLY RETAINER (91 days apart) is NOT a duplicate', () => {
  const list = ['2025-03-31', '2025-06-30', '2025-09-30', '2025-12-31']
    .map(d => inv('Cascade Property Management', 7600, d));
  eq(dupTitles(list).length, 0, 'a quarterly retainer was flagged: ' + JSON.stringify(dupTitles(list)));
  eq(badged(list).size, 0, 'a quarterly retainer was badged in the register');
});

t('A2 EXACT duplicate — same vendor, amount AND date — is red', () => {
  const list = [inv('Austin Energy', 7200, '2025-03-31'), inv('Austin Energy', 7200, '2025-03-31')];
  const f = dupTitles(list);
  eq(f.length, 1);
  eq(f[0].severity, 'red');
  ok(/Exact duplicate invoice/.test(f[0].title), f[0].title);
  eq(badged(list).size, 2, 'both copies must be badged');
  eq(badged(list).get(0).kind, 'exact');
});

t('A3 NEAR duplicate — within the day limit — is yellow', () => {
  const list = [inv('Austin Energy', 7200, '2025-03-01'),
                inv('Austin Energy', 7200, plus('2025-03-01', 3))];
  const f = dupTitles(list);
  eq(f.length, 1);
  eq(f[0].severity, 'yellow');
  ok(/Possible duplicate/.test(f[0].title), f[0].title);
  eq(badged(list).get(0).kind, 'near');
  eq(badged(list).get(0).daysDiff, 3);
});

t(`A4 BOUNDARY: exactly ${DUP_LIMIT} days apart IS flagged`, () => {
  const list = [inv('Austin Energy', 7200, '2025-03-01'),
                inv('Austin Energy', 7200, plus('2025-03-01', DUP_LIMIT))];
  eq(dupTitles(list).length, 1, `${DUP_LIMIT} days should be inside the threshold`);
  eq(badged(list).size, 2);
});

t(`A5 BOUNDARY: ${DUP_LIMIT + 1} days apart is NOT flagged`, () => {
  const list = [inv('Austin Energy', 7200, '2025-03-01'),
                inv('Austin Energy', 7200, plus('2025-03-01', DUP_LIMIT + 1))];
  eq(dupTitles(list).length, 0, `${DUP_LIMIT + 1} days should be outside the threshold`);
  eq(badged(list).size, 0);
});

t('A6 the 61-day gap the demo actually has is not flagged', () => {
  const list = [inv('WatchPoint Security', 2850, '2025-06-30'),
                inv('WatchPoint Security', 2850, '2025-10-31')];
  eq(dupTitles(list).length, 0);
  eq(badged(list).size, 0);
});

t('A7 an exact duplicate suppresses the near check for the same records', () => {
  // Three records: two identical on one date, one three days later. The exact
  // pair is red; the survivor must not then also be reported as a near pair.
  const list = [inv('Austin Energy', 7200, '2025-03-01'),
                inv('Austin Energy', 7200, '2025-03-01'),
                inv('Austin Energy', 7200, '2025-03-04')];
  const f = dupTitles(list);
  eq(f.filter(x => x.severity === 'red').length, 1);
  eq(f.filter(x => x.severity === 'yellow').length, 0,
     'the same invoices were reported twice: ' + JSON.stringify(f));
});

t('A7b THREE within the window produce ONE finding, but badge every member', () => {
  // Removing the `break` in the near loop is invisible on a two-invoice fixture
  // because the loop ends anyway. Three is what distinguishes them.
  const list = [inv('A', 100, '2025-01-01'), inv('A', 100, '2025-01-03'),
                inv('A', 100, '2025-01-05')];
  const f = dupTitles(list);
  eq(f.length, 1, 'the same vendor+amount group was reported more than once: ' + JSON.stringify(f));
  ok(/within 2 days/.test(f[0].title), f[0].title);
  eq(badged(list).size, 2, 'the badge marked more than the pair the audit identified');
});

t('A8 a different vendor, or a different amount, is a different invoice', () => {
  eq(dupTitles([inv('Austin Energy', 7200, '2025-03-01'),
                inv('Regional Power', 7200, '2025-03-01')]).length, 0, 'vendor ignored');
  eq(dupTitles([inv('Austin Energy', 7200, '2025-03-01'),
                inv('Austin Energy', 7300, '2025-03-01')]).length, 0, 'amount ignored');
});

t('A9 a zero or negative amount is never a duplicate', () => {
  eq(dupTitles([inv('Austin Energy', 0, '2025-03-01'),
                inv('Austin Energy', 0, '2025-03-01')]).length, 0);
  eq(badged([inv('Austin Energy', 0, '2025-03-01'),
             inv('Austin Energy', 0, '2025-03-01')]).size, 0);
});

t('A10 an invoice with no vendor is never a duplicate', () => {
  eq(dupTitles([inv('', 7200, '2025-03-01'), inv('', 7200, '2025-03-01')]).length, 0);
  eq(badged([inv('', 7200, '2025-03-01'), inv('', 7200, '2025-03-01')]).size, 0);
});

// ── B — the two surfaces agree ──────────────────────────────────────────────
H('B · the register badge and the audit summary agree');

const AGREEMENT_CASES = [
  ['quarterly retainers',          ['2025-03-31', '2025-06-30', '2025-09-30'].map(d => inv('CleanSpace Commercial', 5200, d))],
  ['exact duplicate',              [inv('A', 100, '2025-01-01'), inv('A', 100, '2025-01-01')]],
  ['near duplicate',               [inv('A', 100, '2025-01-01'), inv('A', 100, '2025-01-05')]],
  ['just outside the threshold',   [inv('A', 100, '2025-01-01'), inv('A', 100, plus('2025-01-01', DUP_LIMIT + 1))]],
  ['a single invoice',             [inv('A', 100, '2025-01-01')]],
  ['an empty register',            []],
  ['undated pair',                 [inv('A', 100, ''), inv('A', 100, '')]],
  ['mixed: one real, one recurring', [
    inv('A', 100, '2025-01-01'), inv('A', 100, '2025-01-01'),
    inv('B', 200, '2025-01-01'), inv('B', 200, '2025-04-01')]],
];

AGREEMENT_CASES.forEach(([label, list], i) => {
  t(`B${i + 1} ${label}: a badge exists iff the audit raises a finding`, () => {
    const findings = dupTitles(list);
    const badges   = badged(list);
    eq(badges.size > 0, findings.length > 0,
       `badges=${badges.size} findings=${findings.length} — the surfaces disagree`);
  });
});

t('B9 and the badge kind matches the finding severity', () => {
  const ex = [inv('A', 100, '2025-01-01'), inv('A', 100, '2025-01-01')];
  eq(badged(ex).get(0).kind, 'exact');
  eq(dupTitles(ex)[0].severity, 'red');
  const nr = [inv('A', 100, '2025-01-01'), inv('A', 100, '2025-01-05')];
  eq(badged(nr).get(0).kind, 'near');
  eq(dupTitles(nr)[0].severity, 'yellow');
});

t('B10 [source] ONE rule — the register does not re-derive it', () => {
  const render = fnSource(scriptCode, 'renderInvResults');
  ok(/_findDuplicateInvoices\(invoiceData\)\.byIndex/.test(render),
     'the register does not read the shared rule');
  ok(!/Math\.abs\(amt - parseFloat\(oth\.amount\)\) <= 1/.test(render),
     'the register still runs its own amount comparison');
  ok(!/similarVendor/.test(render), 'the register still fuzzy-matches vendors');
  const detectSrc = fnSource(scriptCode, '_detectInvoiceSuspicions');
  ok(/_findDuplicateInvoices\(invoices\)/.test(detectSrc),
     'the audit detector does not read the shared rule');
  // The threshold must exist in exactly one place.
  eq((scriptCode.match(/_DUP_NEAR_DAY_LIMIT = \d+/g) || []).length, 1,
     'the day limit is declared more than once');
  eq((scriptCode.match(/daysDiff <= \d+/g) || []).length, 0,
     'a literal day threshold is still compared somewhere');
});

// ── C — the $1 tolerance and the fuzzy vendor, decided ──────────────────────
H('C · the two divergences, decided in the authority\'s favour');

t('C1 THE $1 TOLERANCE IS GONE: amounts must be equal to the cent', () => {
  // The badge used to call these duplicates. The authority never did.
  const list = [inv('Austin Energy', 999.50, '2025-03-01'),
                inv('Austin Energy', 1000.00, '2025-03-01')];
  eq(dupTitles(list).length, 0, 'the authority flagged a 50c difference');
  eq(badged(list).size, 0, 'the register still tolerates a sub-$1 difference');
});

t('C2 and a one-cent difference is still a different invoice', () => {
  const list = [inv('A', 100.00, '2025-03-01'), inv('A', 100.01, '2025-03-01')];
  eq(badged(list).size, 0);
});

t('C3 equal-to-the-cent amounts written differently still match', () => {
  // "7200" and 7200.0 are the same money; toFixed(2) is what makes them one key.
  const list = [inv('A', '7200', '2025-03-01'), inv('A', 7200.0, '2025-03-01')];
  eq(badged(list).size, 2, 'the same amount in two notations failed to match');
});

t('C4 THE FUZZY VENDOR MATCH IS GONE: near-names are not merged', () => {
  const list = [inv('Austin Energy', 7200, '2025-03-01'),
                inv('Austin Energy Inc', 7200, '2025-03-01')];
  eq(dupTitles(list).length, 0, 'the authority merged two vendor names');
  eq(badged(list).size, 0, 'the register still fuzzy-matches vendor names');
});

t('C5 but case and surrounding whitespace are still the same vendor', () => {
  const list = [inv('Austin Energy', 7200, '2025-03-01'),
                inv('  AUSTIN energy ', 7200, '2025-03-01')];
  eq(badged(list).size, 2, 'normalisation stopped lowercasing/trimming');
});

// ── D — undated invoices ────────────────────────────────────────────────────
H('D · an undated invoice is never called a duplicate');

t('D1 two undated invoices, identical in every other way, are NOT duplicates', () => {
  const list = [inv('A', 100, ''), inv('A', 100, '')];
  eq(dupTitles(list).length, 0, 'an undated pair was called a duplicate');
  eq(badged(list).size, 0);
});

t('D2 one dated, one undated: no claim is made', () => {
  const list = [inv('A', 100, '2025-01-01'), inv('A', 100, '')];
  eq(dupTitles(list).length, 0);
  eq(badged(list).size, 0);
});

t('D3 an unparseable date is treated as no date, not as a match', () => {
  const list = [inv('A', 100, 'not-a-date'), inv('A', 100, 'not-a-date')];
  // Same string, so the EXACT rule can group them — that is the authority's own
  // behaviour and is preserved. What must not happen is the NEAR rule inventing
  // a gap from two NaN timestamps.
  const f = dupTitles(list);
  ok(f.every(x => x.severity === 'red'), 'a NaN gap produced a near-duplicate: ' + JSON.stringify(f));
});

t('D4 [source] the undated exclusions are still in the shared rule', () => {
  const src = fnSource(scriptCode, '_findDuplicateInvoices');
  ok(/if \(!r\.date\) return;/.test(src), 'the exact rule stopped excluding undated invoices');
  ok(/filter\(r => !isNaN\(r\.ts\)\)/.test(src), 'the near rule stopped excluding undated invoices');
});

// ── E — the demo ────────────────────────────────────────────────────────────
H('E · the Cascade Commons demo register');

const DEMO_REPEATS = [
  ...['2025-03-31', '2025-06-30', '2025-09-30', '2025-12-31'].map(d => inv('Cascade Property Management', 7600, d)),
  ...['2025-03-31', '2025-06-30', '2025-09-30'].map(d => inv('CleanSpace Commercial', 5200, d)),
  ...['2025-03-31', '2025-06-30', '2025-10-31', '2025-12-31'].map(d => inv('WatchPoint Security', 2850, d)),
];

t('E1 the 11 invoices that were badged raise nothing at all', () => {
  eq(DEMO_REPEATS.length, 11, 'the demo fixture drifted');
  eq(dupTitles(DEMO_REPEATS).length, 0);
  eq(badged(DEMO_REPEATS).size, 0, 'the demo register still badges its retainers');
});

t('E2 the smallest gap among them is well outside the threshold', () => {
  const gaps = [];
  const by = {};
  DEMO_REPEATS.forEach(r => { (by[r.vendorName] = by[r.vendorName] || []).push(r.invoiceDate); });
  Object.values(by).forEach(ds => {
    ds.sort().slice(1).forEach((d, i) =>
      gaps.push(Math.round((new Date(d) - new Date(ds[i])) / 86400000)));
  });
  ok(Math.min(...gaps) > DUP_LIMIT,
     `the demo has a ${Math.min(...gaps)}-day gap, inside the ${DUP_LIMIT}-day threshold`);
});

// ── F — the register surface ────────────────────────────────────────────────
H('F · the badge names the invoice, and so does the confirmation');

t('F1 MEASURED: no verdict, no badge', () => {
  eq(badgeHtml(null, 0), '', 'a badge was rendered for an invoice the rule did not identify');
  eq(badgeHtml(undefined, 0), '');
});

t('F1b MEASURED: the EXACT badge names vendor, amount, date and count', () => {
  const html = badgeHtml({ kind: 'exact', displayVendor: 'Austin Energy', amount: 7200,
                           date: '2025-03-31', occurrences: 2 }, 4);
  ok(/Austin Energy/.test(html), html);
  ok(/\$7,200\.00/.test(html),  html);
  ok(/2025-03-31/.test(html),   html);
  ok(/appears 2 times/.test(html), html);
  ok(/removeInvItem\(4\)/.test(html), 'the Remove button lost its row index: ' + html);
});

t('F1c MEASURED: the NEAR badge names vendor, amount and the gap', () => {
  const html = badgeHtml({ kind: 'near', displayVendor: 'Austin Energy', amount: 7200,
                           date: '2025-03-01', daysDiff: 3 }, 1);
  ok(/Austin Energy/.test(html), html);
  ok(/\$7,200\.00/.test(html),  html);
  ok(/within 3 days/.test(html), html);
  ok(!/appears/.test(html), 'a near duplicate is described as an exact one: ' + html);
});

t('F1d MEASURED: exact and near read differently, and 1 day is singular', () => {
  const ex = badgeHtml({ kind: 'exact', displayVendor: 'A', amount: 1, date: 'd', occurrences: 2 }, 0);
  const nr = badgeHtml({ kind: 'near',  displayVendor: 'A', amount: 1, date: 'd', daysDiff: 1 }, 0);
  ok(ex !== nr, 'the two kinds render identically');
  ok(/within 1 day(?!s)/.test(nr), nr);
});

t('F1e MEASURED: a hostile vendor name is escaped', () => {
  const html = badgeHtml({ kind: 'near', displayVendor: '<img src=x onerror=1>',
                           amount: 1, date: 'd', daysDiff: 2 }, 0);
  ok(!/<img/.test(html), 'the vendor name is interpolated unescaped: ' + html);
  ok(/&lt;img/.test(html), html);
});

t('F2 MEASURED: the Remove confirmation names vendor, amount and date', () => {
  const txt = confirmText({ vendorName: 'Austin Energy', amount: 7200, invoiceDate: '2025-03-31' });
  ok(/Remove this invoice/.test(txt), txt);
  ok(/Austin Energy/.test(txt), txt);
  ok(/\$7,200\.00/.test(txt), txt);
  ok(/2025-03-31/.test(txt), txt);
});

t('F2b MEASURED: it says so plainly when a field is missing, rather than blank', () => {
  const txt = confirmText({ vendorName: '', amount: '', invoiceDate: '' });
  ok(/\(unknown vendor\)/.test(txt), txt);
  ok(/no amount/.test(txt), txt);
  ok(/no date/.test(txt), txt);
  eq(confirmText(null).includes('(unknown vendor)'), true, 'a missing record throws or blanks');
});

t('F2c [source] removeInvItem confirms with THAT row\'s record', () => {
  const src = fnSource(scriptCode, 'removeInvItem');
  ok(/confirm\(_removeInvoiceConfirmText\(invoiceData\[i\]\)\)/.test(src),
     'the confirmation does not read the row being removed');
});

t('F3 [source] removal itself is unchanged', () => {
  const src = fnSource(scriptCode, 'removeInvItem');
  ok(/invoiceData\.splice\(i, 1\);/.test(src), 'the splice changed');
  ok(/PropertyOS\.ensureInvoiceIds/.test(src), 'the id-stamping guard before the splice is gone');
  ok(/savePropertyData\(\)/.test(src), 'the persist step is gone');
});

t('F4 [source] the badge is derived once, not per row', () => {
  const render = fnSource(scriptCode, 'renderInvResults');
  // Bound to the statement form: a lambda that re-derives per lookup still
  // contains the call exactly once, which a bare count would accept.
  ok(/const _dupIndex = _findDuplicateInvoices\(invoiceData\)\.byIndex;/.test(render),
     'the verdict is not resolved once into a plain index');
  eq((render.match(/_findDuplicateInvoices\(/g) || []).length, 1,
     'the shared rule is invoked more than once per render');
  const decl = render.indexOf('const _dupIndex');
  const map  = render.indexOf('invoiceData.map((d, i) =>');
  ok(decl !== -1 && decl < map, 'the verdict is computed inside the row map');
  ok(/_dupBadgeHtml\(_dupIndex\.get\(i\), i\)/.test(render),
     'the row does not hand its resolved verdict to the badge builder');
});

// ── G — nothing else moved ──────────────────────────────────────────────────
H('G · the audit findings, CAM arithmetic and billing readiness are untouched');

t('G1 the red and yellow wording is exactly as it was', () => {
  const ex = detect([inv('Austin Energy', 7200, '2025-03-31'), inv('Austin Energy', 7200, '2025-03-31')]);
  const red = ex.find(f => f.severity === 'red');
  eq(red.title, 'Exact duplicate invoice: "Austin Energy" — $7,200.00 on 2025-03-31 appears 2 times');
  ok(/would be overbilled/.test(red.detail), red.detail);
  eq(red.conditions.length, 5);

  const nr = detect([inv('Austin Energy', 7200, '2025-03-01'), inv('Austin Energy', 7200, '2025-03-04')]);
  const yel = nr.find(f => f.severity === 'yellow');
  eq(yel.title, 'Possible duplicate: "Austin Energy" billed $7,200.00 twice within 3 days');
  ok(/Monthly services are typically billed once per period/.test(yel.detail), yel.detail);
  ok(yel.conditions.some(c => c.includes(`threshold for review: ≤${DUP_LIMIT} days`)),
     'the stated threshold drifted from the constant: ' + JSON.stringify(yel.conditions));
});

t('G2 the other suspicion checks still fire', () => {
  const shared = detect([
    inv('A', 100, '2025-01-01', { fileUrl: 'https://x/doc.pdf' }),
    inv('B', 200, '2025-02-01', { fileUrl: 'https://x/doc.pdf' }),
  ]);
  ok(shared.some(f => /Same source document linked to/.test(f.title)),
     'the shared-attachment check stopped firing');
});

t('G3 [source] nothing in the shared rule touches CAM arithmetic', () => {
  const src = fnSource(scriptCode, '_findDuplicateInvoices');
  ok(!/runFullReconciliation|capAdjustment|proRataPercent|totalAllocated|billingReadiness|camEligible/.test(src),
     'the duplicate rule reaches into the reconciliation');
  ok(!/invoiceData|currentProperty\(|lastResults/.test(src),
     'the duplicate rule reads global state instead of its argument');
});

t('G4 [source] the detector still returns flags and nothing else', () => {
  const src = fnSource(scriptCode, '_detectInvoiceSuspicions');
  ok(!/savePropertyData|splice|invoiceData\s*=/.test(src), 'the detector mutates state');
});

t('G5 the rule is pure — the same input twice gives the same answer', () => {
  const list = [inv('A', 100, '2025-01-01'), inv('A', 100, '2025-01-03')];
  const snapshot = JSON.stringify(list);
  const a = JSON.stringify([...findDuplicates(list).byIndex.entries()]);
  const b = JSON.stringify([...findDuplicates(list).byIndex.entries()]);
  eq(a, b);
  eq(JSON.stringify(list), snapshot, 'the rule mutated the invoices it was handed');
});

// ── Z — self-checks ─────────────────────────────────────────────────────────
H('Z · self-checks');

t('Z1 the functions actually loaded and do something', () => {
  eq(typeof findDuplicates, 'function');
  eq(typeof detect, 'function');
  eq(badged([inv('A', 1, '2025-01-01'), inv('A', 1, '2025-01-01')]).size, 2);
});
t('Z2 the source read is comment-stripped', () => {
  ok(!/THE DEFECT THIS EXISTS FOR/.test(scriptCode), 'block comments survived');
  ok(!/a quarterly retainer and is not flagged/.test(scriptCode), 'line comments survived');
});
t('Z3 the day limit was read from the source, not assumed', () => eq(DUP_LIMIT, 7));

console.log('\n' + (fail === 0 ? '\x1b[32m' : '\x1b[31m') +
  `${pass} passed, ${fail} failed\x1b[0m\n`);
process.exit(fail ? 1 : 0);
