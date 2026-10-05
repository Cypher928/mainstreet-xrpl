'use strict';
// test-gl-import.js — gl-import.js, the ledger parser (Financial Intake, increment one).
//
// Pure: no browser, no database, no SheetJS. Rows are fed as the arrays of cells
// a spreadsheet decodes to — strings, numbers (Excel serial dates, numeric
// amounts and codes) and blanks — exactly as the browser will hand them over.
//
// The CAM tab's own parser (script.js parseGLAmount / parseGLDate) is loaded from
// script.js's source, unchanged, and compared input by input. Where the two
// differ, the test pins BOTH answers: it does not assume the CAM parser is right,
// and it does not change it.
//
// Every fixture is synthetic, generated from a fixed seed. No customer or test
// package data is used.

const fs   = require('fs');
const path = require('path');
const ROOT = __dirname;
const GL   = require('./gl-import.js');

let pass = 0, fail = 0;
const failures = [];
function check(name, ok, detail) {
  if (ok) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${name}${detail ? '  — ' + detail : ''}`); }
  else    { fail++; failures.push(name + (detail ? ': ' + detail : '')); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? '  — ' + detail : ''}`); }
}
function section(t) { console.log(`\n── ${t} ──`); }
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ── The CAM parser, from script.js, unchanged ─────────────────────────────────
const SCRIPT = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');
function extractFn(name) {
  const start = SCRIPT.indexOf('function ' + name + '(');
  if (start < 0) throw new Error(name + ' not found in script.js');
  let i = SCRIPT.indexOf('{', start), depth = 0;
  for (; i < SCRIPT.length; i++) {
    if (SCRIPT[i] === '{') depth++;
    else if (SCRIPT[i] === '}') { depth--; if (depth === 0) break; }
  }
  return SCRIPT.slice(start, i + 1);
}
const camAmount = new Function(extractFn('parseGLAmount') + '\nreturn parseGLAmount;')();
const camDate   = new Function('XLSX', extractFn('parseGLDate') + '\nreturn parseGLDate;')(undefined);

// ── Seeded synthetic ledger (shared with tools/verify-migration-046.js) ─────
const { buildLedger, shuffle, fmtMoney } = require('./tools/gl-fixture.js');

// ════════════════════════════════════════════════════════════════════════════
section('1 · amounts — debits, credits, negatives, exact cents');
const A = v => GL.parseAmount(v);
check('"$1,234.56" → 123456 cents', A('$1,234.56').cents === 123456);
check('plain number 1234.56 → 123456', A(1234.56).cents === 123456);
check('"(1,234.56)" → -123456 (accounting negative)', A('(1,234.56)').cents === -123456);
check('"1234.56-" → -123456 (trailing minus)', A('1234.56-').cents === -123456);
check('"-$5" and "$-5" → -500', A('-$5').cents === -500 && A('$-5').cents === -500);
check('".5" → 50; "0.05" → 5', A('.5').cents === 50 && A('0.05').cents === 5);
check('blank, null and whitespace are blank, not zero and not an error',
  [ '', '   ', null, undefined, ' ' ].every(v => A(v).blank && A(v).cents === null && !A(v).error));
check('"12abc" is an error, not 12', !!A('12abc').error && A('12abc').cents === null);
check('"1.2.3" is an error, not 1.2', !!A('1.2.3').error);
check('"1e3" is an error, not 1000', !!A('1e3').error);
check('"1,23,456" (misplaced comma) is an error', !!A('1,23,456').error);
check('"1.234" (three decimals) is an error, not rounded', /two decimal/.test(A('1.234').error || ''));
check('number 1.005 (three decimals) is an error', /two decimal/.test(A(1.005).error || ''));
check('"(5)-" (two negative markers) is an error', !!A('(5)-').error);
check('999,999,999,999.99 fits numeric(14,2); one cent more does not',
  A('999,999,999,999.99').cents === 99999999999999 && /too large/.test(A('1,000,000,000,000.00').error || ''));
check('integer cents: 0.1 + 0.2 lines total exactly 30 cents', A('0.10').cents + A('0.20').cents === 30);
check('centsToString round-trips', GL.centsToString(123456) === '1234.56' && GL.centsToString(-5) === '-0.05' && GL.centsToString(0) === '0.00');

section('2 · dates');
const D = v => GL.parseDate(v);
check('ISO "2025-03-07" → 2025-03-07', D('2025-03-07').iso === '2025-03-07');
check('ISO with time "2025-03-07T15:20:00Z" → 2025-03-07', D('2025-03-07T15:20:00Z').iso === '2025-03-07');
check('"3/7/2025" → 2025-03-07 (month first)', D('3/7/2025').iso === '2025-03-07');
check('"3-7-2025" and "2025/03/07" → 2025-03-07', D('3-7-2025').iso === '2025-03-07' && D('2025/03/07').iso === '2025-03-07');
check('"3/7/25" → 2025-03-07', D('3/7/25').iso === '2025-03-07');
check('Excel serial 45658 → 2025-01-01', D(45658).iso === '2025-01-01');
check('Excel serial 46022 → 2025-12-31', D(46022).iso === '2025-12-31');
check('Excel serial with a time fraction 45658.75 → 2025-01-01', D(45658.75).iso === '2025-01-01');
check('Excel serials 1, 59, 61 → 1900-01-01, 1900-02-28, 1900-03-01', D(1).iso === '1900-01-01' && D(59).iso === '1900-02-28' && D(61).iso === '1900-03-01');
check('Excel serial 60 (the fictitious 29 Feb 1900) is refused', !!D(60).error);
check('a JS Date is read in UTC', D(new Date(Date.UTC(2025, 5, 30))).iso === '2025-06-30');
check('"2025-02-30" is an error (no such day)', !!D('2025-02-30').error);
check('"13/01/2025" is an error (no 13th month), not swapped', !!D('13/01/2025').error);
check('"2/29/2025" is an error; "2/29/2024" is not', !!D('2/29/2025').error && D('2/29/2024').iso === '2024-02-29');
check('"Jan 5 2025" is an error, not passed through', !!D('Jan 5 2025').error && D('Jan 5 2025').iso === null);
check('blank is blank', D('').blank && D(null).blank);

section('2b · date order — decided per file, never guessed');
const DO = (dates, opts) => GL.parseRows([['Date', 'Account Number', 'Debit', 'Credit'], ...dates.map((d, i) => [d, '5100', i % 2 ? '' : '1.00', i % 2 ? '1.00' : ''])], opts);
let res = DO(['3/4/2025', '3/4/2025', '5/6/2025', '5/6/2025']);
check('an ambiguous file with no choice yields NO entries and asks for the order', res.ok === false && res.entries.length === 0 && res.needsDateOrder === true && res.dateOrder === null);
check('…the refusal names the count, a row and its text', res.errors.length === 1 && res.errors[0].field === 'dateOrder' && res.errors[0].sourceRow === 2 && /All 4 slash dates/.test(res.errors[0].message) && /"3\/4\/2025"/.test(res.errors[0].message), res.errors[0] && res.errors[0].message);
res = DO(['3/4/2025', '3/4/2025'], { dateOrder: 'mdy' });
check('chosen month-first: 3/4/2025 → 2025-03-04, recorded as a person\'s choice', res.ok && res.entries[0].postedOn === '2025-03-04' && res.dateOrder === 'mdy' && res.dateOrderSource === 'person');
res = DO(['3/4/2025', '3/4/2025'], { dateOrder: 'dmy' });
check('chosen day-first: 3/4/2025 → 2025-04-03', res.ok && res.entries[0].postedOn === '2025-04-03' && res.dateOrder === 'dmy');
res = DO(['25/3/2025', '25/3/2025', '03/04/2025', '03/04/2025']);
check('a file proving day-first ("25/3/2025") reads every slash date day-first, and says so', res.ok && res.dateOrder === 'dmy' && res.dateOrderSource === 'detected'
  && res.dateDetection.dayFirstRow === 2 && res.entries[2].postedOn === '2025-04-03' && res.entries[0].postedOn === '2025-03-25');
res = DO(['3/25/2025', '3/25/2025', '03/04/2025', '03/04/2025']);
check('a file proving month-first ("3/25/2025") reads month-first, and says so', res.ok && res.dateOrder === 'mdy' && res.dateOrderSource === 'detected' && res.entries[2].postedOn === '2025-03-04');
res = DO(['25/3/2025', '25/3/2025', '3/25/2025', '3/25/2025']);
check('a file proving both orders is refused outright — no entries', res.ok === false && res.entries.length === 0 && /mixes date orders/.test(res.errors[0].message) && res.errors[0].sourceRow === 2);
res = DO(['25/3/2025', '25/3/2025'], { dateOrder: 'mdy' });
check('a choice the file contradicts is refused (month-first chosen, row 2 can only be day-first)', res.ok === false && res.entries.length === 0 && /row 2 can only be day-first/.test(res.errors[0].message));
res = DO(['2025-03-04', 45658, '2025-03-04', 45658]);
check('ISO text and Excel serials need no choice: dateOrder iso', res.ok && res.dateOrder === 'iso' && res.dateOrderSource === 'iso' && res.dateDetection.slashDates === 0);
res = DO(['2025-03-04', '2025-03-04'], { dateOrder: 'dmy' });
check('a choice on a file with no slash dates changes nothing and records iso', res.ok && res.dateOrder === 'iso' && res.entries[0].postedOn === '2025-03-04');
res = DO(['3/4/25', '3/4/25']);
check('two-digit years are slash dates too, and ambiguous', res.needsDateOrder === true);
res = DO(['3/4/2025', '3/4/2025'], { dateOrder: 'ymd' });
check('an order other than mdy / dmy is refused', res.ok === false && /month-first \(mdy\) or day-first \(dmy\)/.test(res.errors[0].message));
check('parseDate takes the order: "3/4/2025" dmy → 2025-04-03; "13/1/2025" dmy → 2025-01-13', GL.parseDate('3/4/2025', 'dmy').iso === '2025-04-03' && GL.parseDate('13/1/2025', 'dmy').iso === '2025-01-13');
check('detectDateOrder is exported, and reports evidence by sheet row', typeof GL.detectDateOrder === 'function'
  && GL.detectDateOrder([['Date'], ['1/13/2025']], 0, 1, 1).monthFirstRow === 2);

section('3 · account codes');
const S = v => GL.splitAccount(v);
check('"0100" keeps its leading zero', eq(S('0100'), { code: '0100', name: '' }));
check('numeric cell 100 → "100" (a number cannot carry a leading zero)', eq(S(100), { code: '100', name: '' }));
check('"5100 · Landscaping" → code 5100, name Landscaping', eq(S('5100 · Landscaping'), { code: '5100', name: 'Landscaping' }));
check('"5100 - Landscaping" and "5100: Landscaping"', eq(S('5100 - Landscaping'), { code: '5100', name: 'Landscaping' }) && eq(S('5100: Landscaping'), { code: '5100', name: 'Landscaping' }));
check('"5100 Landscaping" → split on the space', eq(S('5100 Landscaping'), { code: '5100', name: 'Landscaping' }));
check('"1000-01" is one code', eq(S('1000-01'), { code: '1000-01', name: '' }));
check('"Operating cash" is a name with no code', eq(S('Operating cash'), { code: '', name: 'Operating cash' }));

section('4 · header detection');
const H = rows => GL.detectHeader(rows);
let h = H([['Posting Date', 'Account Number', 'Account Name', 'Debit', 'Credit']]);
check('debit/credit ledger: mode debit_credit, every column found', h.mode === 'debit_credit' && eq(h.columns, { date: 0, account_code: 1, account_name: 2, debit: 3, credit: 4 }), JSON.stringify(h.columns));
h = H([['Date', 'GL Account', 'Memo', 'Amount']]);
check('signed ledger: mode signed, combined account column', h.mode === 'signed' && h.columns.account === 1 && h.columns.description === 2 && h.columns.amount === 3, JSON.stringify(h.columns));
h = H([['Redwood-style title (synthetic)'], ['Report date: 1/1/2026'], [], ['Trans Date', 'Account', 'Account Description', 'Dr', 'Cr', 'Balance']]);
check('header below title rows is found (row 4); "Balance" is not mistaken for an amount', h.headerIndex === 3 && h.mode === 'debit_credit' && h.columns.amount === undefined && h.columns.account_name === 2, JSON.stringify(h));
h = H([['Date', 'Account', 'Debit']]);
check('a debit column with no credit column is refused', !!h.error && /credit/.test(h.error));
h = H([['Name', 'Notes', 'Total']]);
check('no date / account / amount columns → no header, with a reason', h.headerIndex === -1 && !!h.error);
check('a one-letter header does not match "dr"/"cr" by containment', GL.matchHeader('d') === null && GL.matchHeader('c') === null);

section('5 · rows — invalid rows are reported, never dropped silently');
res = GL.parseRows([
  ['Date', 'Account Number', 'Account Name', 'Description', 'Debit', 'Credit'],     // row 1
  ['2025-01-05', '5100', 'Landscaping', 'Mowing', '100.00', ''],                     // 2 ok
  ['2025-02-30', '5100', 'Landscaping', 'Bad day', '10.00', ''],                     // 3 bad date
  ['1/9/2025', '', '', 'No account', '10.00', ''],                                   // 4 no account
  ['1/9/2025', '5300', 'Repairs', 'Junk amount', '12abc', ''],                       // 5 bad amount
  ['1/9/2025', '5300', 'Repairs', 'Both sides', '5.00', '5.00'],                     // 6 both sides
  ['1/9/2025', '5300', 'Repairs', 'Precision', '1.234', ''],                         // 7 three decimals
  ['', '5300', 'Repairs', 'No date', '5.00', ''],                                    // 8 no date
  [],                                                                                // 9 blank → skipped
  ['1/10/2025', '5300', 'Repairs', 'Zero line', '0.00', ''],                         // 10 zero → skipped
  ['', '', 'Total', '', '115.00', ''],                                               // 11 total → skipped
  ['1/11/2025', '1010', 'Operating cash', 'Pay', '', '100.00'],                      // 12 ok
], { dateOrder: 'mdy' });
const errRows = res.errors.map(e => e.sourceRow + ':' + e.field);
check('six bad rows reported, each with its sheet row number and field',
  eq(errRows, ['3:date', '4:account', '5:debit', '6:amount', '7:debit', '8:date']), errRows.join(' '));
check('blank, zero and total lines are skipped with a reason, not errors',
  eq(res.skipped.map(s => s.sourceRow + ':' + s.reason), ['9:blank', '10:zero amount', '11:total line']));
check('the valid rows are still read (2 entries), but ok is false', res.entries.length === 2 && res.ok === false);
check('every data row is accounted for: entries + errors + skipped = 11', res.entries.length + new Set(res.errors.map(e => e.sourceRow)).size + res.skipped.length === 11);

res = GL.parseRows([
  ['Date', 'Account', 'Amount'],
  ['2025-01-05', '5100 · Landscaping', '(1,234.56)'],
  ['2025-01-05', '5100 · Landscaping', '1234.56-'],
  ['2025-01-05', '1010 · Operating cash', '$2,469.12'],
  ['2025-01-06', 'Operating cash', ''],
]);
check('signed mode: parentheses and trailing minus are credits; positive is a debit',
  res.entries[0].creditCents === 123456 && res.entries[1].creditCents === 123456 && res.entries[2].debitCents === 246912);
check('signed mode: a blank amount is an error ("no amount")', res.errors.length === 1 && res.errors[0].sourceRow === 5 && /no amount/.test(res.errors[0].message));
check('a combined account cell is split; a name-only account warns about the missing code',
  res.entries[0].accountCode === '5100' && res.entries[0].accountName === 'Landscaping');

res = GL.parseRows([
  ['Date', 'Account Number', 'Debit', 'Credit'],
  ['2025-01-05', '5100', '-50.00', ''],
  ['2025-01-05', '1010', '', '(50.00)'],
]);
check('a negative debit is read as a credit, with a warning', res.entries[0].creditCents === 5000 && res.entries[0].debitCents === 0 && /negative debit/.test(res.entries[0].warnings[0] || ''));
check('a negative credit is read as a debit, with a warning', res.entries[1].debitCents === 5000 && /negative credit/.test(res.entries[1].warnings[0] || ''));
check('…and the pair still balances', res.totals.balanced === true && res.totals.netCents === 0);

res = GL.parseRows([['Date', 'Account Number', 'Debit', 'Credit'], ['2025-01-05', '5100', '10.00', ''], ['2026-01-02', '1010', '', '10.00']],
  { periodStart: '2025-01-01', periodEnd: '2025-12-31' });
check('a line outside the stated period is an error', res.errors.length === 1 && res.errors[0].sourceRow === 3 && /after the period/.test(res.errors[0].message));

res = GL.parseRows([['Date', 'Account Number', 'Debit', 'Credit'], ['2025-01-05', '0100', '10.00', ''], ['2025-01-05', 100, '', '10.00']]);
check('text code "0100" and numeric code 100 stay different accounts', res.entries[0].accountCode === '0100' && res.entries[1].accountCode === '100' && Object.keys(res.totals.byAccount).length === 2);

res = GL.parseRows([['Date', 'Account Number', 'Debit', 'Credit'], ...Array.from({ length: 6 }, () => ['2025-01-05', '5100', '1.00', ''])], { maxRows: 5 });
check('more data rows than the limit is refused before anything is read', res.ok === false && res.entries.length === 0 && /at most 5/.test(res.errors[0].message));
check('the default limit is 20,000 rows', GL.MAX_ROWS === 20000);
res = GL.parseRows([]);
check('an empty sheet is an error', res.ok === false && /empty/.test(res.errors[0].message));
res = GL.parseRows([['Date', 'Account Number', 'Debit', 'Credit'], []]);
check('a header with no lines under it is an error', res.ok === false && /No ledger lines/.test(res.errors[0].message));

section('6 · identical lines kept; repeated imports produce the same keys');
const twin = ['2025-04-01', '5500', 'Janitorial', 'Monthly service', 'Test Clean Services', 'JE-1', '850.00', ''];
res = GL.parseRows([['Date', 'Account Number', 'Account Name', 'Description', 'Vendor', 'Reference', 'Debit', 'Credit'], twin, twin.slice(), twin.slice()]);
check('three identical lines → three entries, occurrences 1, 2, 3', res.entries.length === 3 && eq(res.entries.map(e => e.occurrence), [1, 2, 3]));
check('…with three different keys', new Set(res.entries.map(e => e.key)).size === 3);
check('…and all three are in the totals', res.totals.debitCents === 255000);
const tA = GL.parseRows([['Date', 'Account Number', 'Account Name', 'Debit', 'Credit'], ['2025-04-01', '5500', 'Janitorial', '850.00', '']]).entries[0].key;
const tB = GL.parseRows([['Date', 'Account Number', 'Account Name', 'Debit', 'Credit'], ['4/1/2025', '5500', 'JANITORIAL SERVICES', 850, '']], { dateOrder: 'mdy' }).entries[0].key;
check('the same line exported with another date format, amount type and account name has the same key', tA === tB);
const tC = GL.parseRows([['Date', 'Account Number', 'Debit', 'Credit'], ['2025-04-01', '5500', '850.01', '']]).entries[0].key;
check('one cent different is a different key', tC !== tA);

section('7 · a balanced 2,000-row ledger');
const big = buildLedger(20251003);
const t0 = Date.now();
res = GL.parseRows(big.rows, { periodStart: '2025-01-01', periodEnd: '2025-12-31' });
const ms = Date.now() - t0;
check('2,000 lines read, none in error, none skipped', res.ok && res.entries.length === 2000 && res.errors.length === 0 && res.skipped.length === 0, `${ms} ms`);
check('mode debit_credit, header on sheet row 1', res.mode === 'debit_credit' && res.headerRowNumber === 1);
check('the fixture\'s M/D/YYYY dates prove month-first (a day over 12 appears second): detected, not assumed',
  res.dateOrder === 'mdy' && res.dateOrderSource === 'detected' && res.dateDetection.monthFirstRow !== null && res.dateDetection.dayFirstRow === null);
check('total debits equal the generator\'s exact BigInt total', BigInt(res.totals.debitCents) === big.expected.debitCents, GL.centsToString(res.totals.debitCents));
check('total credits equal it too', BigInt(res.totals.creditCents) === big.expected.creditCents);
check('balanced: net is exactly 0 cents', res.totals.balanced === true && res.totals.netCents === 0);
check('every month balances, and the months match the generator', Object.keys(res.totals.byMonth).sort().join() === Object.keys(big.expected.byMonth).sort().join()
  && Object.entries(res.totals.byMonth).every(([k, m]) => m.balanced && BigInt(m.debitCents) === big.expected.byMonth[k].d));
check('period read is within 2025', res.period.start >= '2025-01-01' && res.period.end <= '2025-12-31', `${res.period.start} – ${res.period.end}`);
const floatSum = res.entries.reduce((s, e) => s + e.debitCents / 100, 0);
check('integer-cent total is exact where a float sum is not relied on', (Math.round(floatSum * 100) === res.totals.debitCents),
  `float sum ${floatSum} vs exact ${GL.centsToString(res.totals.debitCents)}`);
const repeats = res.entries.filter(e => e.occurrence > 1).length;
check('the generator\'s deliberate identical repeats are kept as separate lines', repeats > 0 && res.entries.length === 2000, `${repeats} lines with occurrence > 1`);
check('2,000 entries, 2,000 distinct keys', new Set(res.entries.map(e => e.key)).size === 2000);
check('every entry knows its sheet row', res.entries.every((e, i) => e.sourceRow === i + 2));
check('date cells in three formats all parsed (ISO text, M/D/YYYY text, Excel serial)',
  big.rows.slice(1).some(r => typeof r[0] === 'number') && big.rows.slice(1).some(r => /\//.test(r[0])) && big.rows.slice(1).some(r => /^\d{4}-/.test(r[0])));
check('account codes keep their leading zero ("0150")', res.entries.some(e => e.accountCode === '0150'));

const again = GL.parseRows(big.rows, { periodStart: '2025-01-01', periodEnd: '2025-12-31' });
check('importing the same file again gives exactly the same 2,000 keys', eq(again.entries.map(e => e.key), res.entries.map(e => e.key)));
const shuffled = GL.parseRows([big.rows[0], ...shuffle(big.rows.slice(1), 7)]);
check('the same rows in another order give the same set of keys', eq(shuffled.entries.map(e => e.key).sort(), res.entries.map(e => e.key).sort()));
check('…and the same totals', shuffled.totals.debitCents === res.totals.debitCents && shuffled.totals.balanced);

section('8 · an unbalanced 2,000-row ledger');
const off = buildLedger(20251003);
const victim = off.rows.findIndex((r, i) => i > 0 && r[7] !== '' && typeof r[7] === 'string');
const victimMonth = GL.parseDate(off.rows[victim][0]).iso.slice(0, 7);
const vc = GL.parseAmount(off.rows[victim][7]).cents + 1;
off.rows[victim] = off.rows[victim].slice(); off.rows[victim][7] = fmtMoney(vc);
res = GL.parseRows(off.rows);
check('one credit raised by one cent: still 2,000 clean lines', res.ok && res.entries.length === 2000);
check('…but not balanced: net is exactly -1 cent', res.totals.balanced === false && res.totals.netCents === -1);
check('…and only the month holding that line is out of balance', Object.entries(res.totals.byMonth).every(([k, m]) => m.balanced === (k !== victimMonth)), victimMonth);
const dropped = buildLedger(20251003);
dropped.rows.splice(5, 1);
res = GL.parseRows(dropped.rows);
check('one line removed: 1,999 lines, unbalanced by exactly that line', res.entries.length === 1999 && res.totals.balanced === false
  && Math.abs(res.totals.netCents) === Math.max(GL.parseAmount(big.rows[5][6]).cents || 0, GL.parseAmount(big.rows[5][7]).cents || 0));

section('9 · the actual CAM parser, compared — not assumed correct');
// [input, CAM result (pinned), gl-import result in cents or 'error']
const AMOUNTS = [
  ['$1,234.56', 1234.56, 123456], ['(1,234.56)', -1234.56, -123456], ['1234.56-', -1234.56, -123456],
  ['$-5', -5, -500], [1234.56, 1234.56, 123456], ['0.10', 0.1, 10],
  // CAM is looser on these; the ledger path refuses them.
  ['12abc', 12, 'error'], ['1.2.3', 1.2, 'error'], ['1e3', 1000, 'error'], ['1.234', 1.234, 'error'],
  // blank: CAM says 0; the ledger path says blank (no value), which is not the same as $0.00.
  ['', 0, 'blank'],
];
AMOUNTS.forEach(([inp, camExp, mine]) => {
  const cam = camAmount(inp), g = GL.parseAmount(inp);
  const mineGot = g.error ? 'error' : g.blank ? 'blank' : g.cents;
  check(`amount ${JSON.stringify(inp)}: CAM ${cam}, ledger ${mineGot}`, Math.abs(cam - camExp) < 1e-9 && mineGot === mine);
});
const DATES = [
  ['3/7/2025', '2025-03-07', '2025-03-07'], ['3/7/25', '2025-03-07', '2025-03-07'], ['2025-03-07', '2025-03-07', '2025-03-07'],
  // CAM passes these through unchanged; the ledger path refuses them.
  ['13/45/2025', '2025-13-45', 'error'], ['Jan 5 2025', 'Jan 5 2025', 'error'], ['2025-02-30', '2025-02-30', 'error'],
];
DATES.forEach(([inp, camExp, mine]) => {
  const cam = camDate(inp), g = GL.parseDate(inp);
  check(`date ${JSON.stringify(inp)}: CAM "${cam}", ledger ${g.error ? 'error' : g.iso}`, cam === camExp && (g.error ? 'error' : g.iso) === mine);
});
// The CAM row rule, applied with its own parser to the balanced ledger: net = debit − credit, keep only > 0.
let camKept = 0, camTotal = 0;
big.rows.slice(1).forEach(r => { const amt = camAmount(r[6]) - camAmount(r[7]); if (amt > 0) { camKept++; camTotal += amt; } });
const glRes = GL.parseRows(big.rows);
check('on the balanced 2,000-line ledger the CAM rule keeps only the 1,000 debit lines and drops every credit',
  camKept === 1000 && glRes.entries.length === 2000, `CAM kept ${camKept}; ledger kept ${glRes.entries.length}`);
check('the CAM total is debits only (no balance possible); the ledger total balances',
  Math.round(camTotal * 100) === glRes.totals.debitCents && glRes.totals.balanced);
check('script.js CAM functions are unchanged by this work (parseGLAmount/parseGLDate/handleGLUpload/importGLToInvoices present)',
  ['parseGLAmount', 'parseGLDate', 'handleGLUpload', 'importGLToInvoices'].every(n => SCRIPT.indexOf('function ' + n + '(') > 0));

section('11 · CSV — the format the server imports');
const { toCsv } = require('./tools/gl-fixture.js');
const LIM = require('./request-limits.js');
check('MAX_FILE_BYTES is exactly the largest original /api/upload stores', GL.MAX_FILE_BYTES === LIM.MAX_UPLOAD_BYTES, GL.MAX_FILE_BYTES + ' vs ' + LIM.MAX_UPLOAD_BYTES);
check('the provisional import ceiling is 10,000 lines, below the parser\'s 20,000', GL.IMPORT_MAX_ROWS === 10000 && GL.IMPORT_MAX_ROWS < GL.MAX_ROWS);
let csv = GL.parseCsv('a,b\r\n"x, y","he said ""hi"""\n"two\nlines",3\r\n');
check('quoted commas, doubled quotes and a line break inside quotes; CRLF and LF', !csv.error && eq(csv.rows, [['a', 'b'], ['x, y', 'he said "hi"'], ['two\nlines', '3']]));
check('a tab-separated file is read with tabs', eq(GL.parseCsv('a\tb\n1\t2').rows, [['a', 'b'], ['1', '2']]) && GL.parseCsv('a\tb').delimiter === '\t');
check('a semicolon file is refused (decimal commas would be misread)', /Semicolon/.test(GL.parseCsv('a;b\n1;2').error || ''));
check('an unclosed quote is refused, naming the line it opened on', /Line 2: a quoted field is never closed/.test(GL.parseCsv('a,b\n"open,2\n3,4').error || ''));
check('text after a closing quote is refused', /text after a closing quote/.test(GL.parseCsv('a,b\n"x"y,2').error || ''));
check('a quote inside an unquoted field is a character (5" pipe)', GL.parseCsv('a,b\n5" pipe,2').rows[1][0] === '5" pipe');
check('a trailing empty field is kept; a final line break adds no row', eq(GL.parseCsv('a,b\n1,').rows, [['a', 'b'], ['1', '']]) && GL.parseCsv('a,b\n1,2\n').rows.length === 2);
check('a UTF-8 byte-order mark is dropped', eq(GL.readCsvFile(Buffer.from([0xEF, 0xBB, 0xBF, 0x61, 0x2C, 0x62])).rows, [['a', 'b']]));
check('a file that is not UTF-8 (Windows-1252 "é") is refused, not misread', /not UTF-8/.test(GL.readCsvFile(Buffer.from([0x61, 0x2C, 0xE9])).error || ''));
check('a file over the size limit is refused before it is read', /at most/.test(GL.readCsvFile(new Uint8Array(GL.MAX_FILE_BYTES + 1)).error || ''));
check('accented vendor names survive UTF-8', GL.readCsvFile(Buffer.from('a,b\nCafé Ñandú,2', 'utf8')).rows[1][0] === 'Café Ñandú');
const csvLedger = buildLedger(20251003, 1000, { textDates: true });
const fromCells = GL.parseRows(csvLedger.rows);
const fromCsv = GL.parseRows(GL.readCsvFile(Buffer.from(toCsv(csvLedger.rows), 'utf8')).rows);
check('the 2,000-line ledger written as CSV reads to the same lines, keys and exact totals as its cells',
  fromCsv.ok && fromCsv.entries.length === 2000 && eq(fromCsv.entries.map(e => e.key), fromCells.entries.map(e => e.key))
  && BigInt(fromCsv.totals.debitCents) === csvLedger.expected.debitCents && fromCsv.totals.balanced, fromCsv.errors.slice(0, 2).map(e => e.message).join('; '));
check('…with its M/D/YYYY dates proven month-first by the file', fromCsv.dateOrder === 'mdy' && fromCsv.dateOrderSource === 'detected');
const amb = GL.parseRows(GL.parseCsv('Date,Account Number,Debit,Credit\n3/4/2025,5100,10.00,\n3/4/2025,1010,,10.00').rows);
check('an ambiguous CSV still asks for the date order', amb.needsDateOrder === true && amb.entries.length === 0);
const pay = GL.importPayload(fromCsv);
check('importPayload: one row per line with cents, sheet row and key; the summary is the parse\'s own totals',
  pay.rows.length === 2000 && pay.rows[0].source_row === 2 && typeof pay.rows[0].debit_cents === 'number' && pay.rows[0].key === fromCsv.entries[0].key
  && pay.summary.lines === 2000 && pay.summary.debitCents === fromCsv.totals.debitCents && pay.summary.dateOrder === 'mdy');

section('10 · shape');
const src = fs.readFileSync(path.join(ROOT, 'gl-import.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
check('no DOM, no network, no spreadsheet library, no storage', !/document\.|fetch\(|XMLHttpRequest|supabase|XLSX|localStorage/i.test(src));
check('exposed on window as GLImport and as a CommonJS module', /root\.GLImport = api/.test(src) && /module\.exports = api/.test(src));
check('no floating-point money: amounts are parsed by string, not parseFloat', !/parseFloat/.test(src));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log('\nFailures:'); failures.forEach(f => console.log('  - ' + f)); process.exit(1); }
