'use strict';
/**
 * tools/gl-fixture.js — a synthetic general ledger, generated from a fixed seed.
 *
 * Shared by test-gl-import.js (the parser) and tools/verify-migration-046.js
 * (the database import), so both prove their claims on the same 2,000 lines.
 * Every value is invented: account names are generic, vendors are labelled
 * fictional, and nothing comes from any customer or test package.
 *
 * buildLedger(seed) → { rows, expected }
 *   rows      the sheet as arrays of cells, header first: 1,000 balanced journal
 *             pairs (debit an expense, credit cash or payables, same date) across
 *             2025. Cell formats vary on purpose — dates as ISO text, M/D/YYYY
 *             text and Excel serial numbers; amounts as "$1,234.56" text and as
 *             plain numbers. Every 97th pair repeats the previous pair exactly: a
 *             legitimate identical charge that must be kept, not deduplicated.
 *   expected  exact BigInt totals overall and by month, computed independently
 *             of the parser.
 */

function rng(seed) {   // mulberry32
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const HEADER = ['Posting Date', 'Account Number', 'Account Name', 'Description', 'Vendor', 'Reference', 'Debit', 'Credit'];
const EXPENSES = [
  ['5100', 'Landscaping'], ['5200', 'Snow removal'], ['5300', 'Repairs & maintenance'], ['5400', 'Utilities - electric'],
  ['5410', 'Utilities - water'], ['5500', 'Janitorial'], ['5600', 'Security'], ['5700', 'Insurance'],
  ['5800', 'Real estate taxes'], ['5900', 'Management fee'], ['0150', 'Prepaid service'],
];
const VENDORS = ['Fictional Greens LLC', 'Example Plow Co', 'Sample HVAC Inc', 'Placeholder Power', 'Demo Water Utility',
                 'Test Clean Services', 'Mock Guard Co', 'Synthetic Mutual', 'County Treasurer (fictional)', 'Example PM LLC'];
const CASH = ['1010', 'Operating cash'], AP = ['2010', 'Accounts payable'];

const fmtMoney = c => { const s = (c / 100).toFixed(2); const [w, f] = s.split('.'); return '$' + w.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + f; };
const excelSerial = iso => { const t = Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)); return Math.round((t - Date.UTC(1899, 11, 30)) / 86400000); };
const mdy = iso => `${+iso.slice(5, 7)}/${+iso.slice(8, 10)}/${iso.slice(0, 4)}`;

function buildLedger(seed, pairCount, opts) {
  const textDates = !!(opts && opts.textDates);   // a CSV export: no Excel serials
  const r = rng(seed);
  const total = pairCount || 1000;
  const rows = [HEADER.slice()];
  const expected = { debitCents: 0n, creditCents: 0n, lines: 0, byMonth: {} };
  let pairs = 0, j = 0, prev = null;
  while (pairs < total) {
    let pair;
    if (prev && pairs % 97 === 0) pair = prev;   // an identical repeat
    else {
      const month = 1 + Math.floor(r() * 12);
      const day = 1 + Math.floor(r() * 28);
      const iso = `2025-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const exp = EXPENSES[Math.floor(r() * EXPENSES.length)];
      const cents = 1 + Math.floor(r() * 2500000);   // $0.01 – $25,000.00
      const contra = r() < 0.5 ? CASH : AP;
      const vendor = VENDORS[Math.floor(r() * VENDORS.length)];
      j++;
      pair = { iso, exp, cents, contra, vendor, ref: 'JE-' + String(j).padStart(5, '0'), fmt: Math.floor(r() * 3) };
      if (textDates && pair.fmt === 2) pair.fmt = 3;   // keep the number amount, but a text date
    }
    const dateCell = pair.fmt === 0 || pair.fmt === 3 ? pair.iso : pair.fmt === 1 ? mdy(pair.iso) : excelSerial(pair.iso);
    const amtCell = pair.fmt === 2 || pair.fmt === 3 ? pair.cents / 100 : fmtMoney(pair.cents);
    rows.push([dateCell, pair.exp[0], pair.exp[1], 'Synthetic charge', pair.vendor, pair.ref, amtCell, '']);
    rows.push([dateCell, pair.contra[0], pair.contra[1], 'Synthetic charge', pair.vendor, pair.ref, '', amtCell]);
    const mk = pair.iso.slice(0, 7);
    const m = expected.byMonth[mk] || (expected.byMonth[mk] = { d: 0n, c: 0n });
    m.d += BigInt(pair.cents); m.c += BigInt(pair.cents);
    expected.debitCents += BigInt(pair.cents); expected.creditCents += BigInt(pair.cents); expected.lines += 2;
    prev = pair; pairs++;
  }
  return { rows, expected };
}

function shuffle(arr, seed) {
  const r = rng(seed), a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const k = Math.floor(r() * (i + 1)); [a[i], a[k]] = [a[k], a[i]]; }
  return a;
}

/** Rows of cells -> CSV text (RFC 4180; a cell is quoted when it must be). */
function toCsv(rows, eol) {
  const q = (v) => { const t = v == null ? '' : String(v); return /[",\r\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
  return rows.map(r => r.map(q).join(',')).join(eol || '\r\n') + (eol || '\r\n');
}

module.exports = { rng, buildLedger, shuffle, fmtMoney, excelSerial, mdy, toCsv, HEADER };
