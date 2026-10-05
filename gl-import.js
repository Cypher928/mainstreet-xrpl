'use strict';
/**
 * gl-import.js — a general ledger, read as a ledger.
 *
 * Financial Intake, increment one (docs/ACQUISITION_REVIEW.md P1-5). Pure: no
 * DOM, no network, no globals read, no spreadsheet library. The caller decodes
 * the file (SheetJS in the browser) into rows of cells and hands them here.
 *
 * WHAT THIS IS NOT
 *
 * It is not the CAM tab's GL import (script.js handleGLUpload). That one turns
 * expense rows into CAM invoices and is left exactly as it is. This module is
 * the ledger path the dormant gl_entries table (migration phase0/029) was
 * built for, and it differs on purpose:
 *
 *   · credits are kept. A ledger has two sides; dropping every row whose net is
 *     not positive (as the CAM path does) makes balancing impossible.
 *   · account code and account name are separate columns, never "category".
 *   · nothing is skipped silently. A row is an entry, a reported error, or a
 *     reported skip (blank, zero, a "Total" line) — with its sheet row number.
 *   · money is integer cents. 2,000 lines summed in floating point drift.
 *   · a value that is not a clean decimal amount or a real calendar date is an
 *     error, where the CAM parser returns 0 or passes the string through.
 *
 * IDENTICAL LINES AND REPEATED IMPORTS
 *
 * A ledger legitimately repeats lines (two identical monthly charges on one
 * day). Each entry's key is its normalised content plus its occurrence among
 * identical lines in the same file: the second identical line is "#2". So:
 *   · both identical lines are kept, with different keys;
 *   · importing the same export again, or the same rows in another order,
 *     produces exactly the same keys — the store's unique key (property,
 *     row_hash) can then refuse every line as already present.
 * The content excludes the source row number on purpose (a re-sorted export
 * must not look new) and excludes the account name (exports name accounts
 * differently; the code is the identity — the name is used only when there is
 * no code).
 *
 * DATE ORDER
 *
 * "3/4/2025" is 4 March or 3 April depending on who exported it. parseRows
 * decides once per file: a person's choice (opts.dateOrder), or proof in the
 * file itself (a "25/3/2025" can only be day-first). A file with no proof and
 * no choice yields no entries and needsDateOrder: true, so the preview must ask.
 * A file with proof both ways is refused. The decision travels with the import
 * (dateOrder: iso | mdy | dmy) and migration 046 refuses an import without one.
 */
(function (root) {

  var MAX_ROWS = 20000;
  // gl_entries.debit/credit are numeric(14,2): at most 999,999,999,999.99.
  var MAX_ABS_CENTS = 99999999999999;

  // ── Headers ─────────────────────────────────────────────────────────────────
  // Exact (normalised) aliases. Unlike the CAM table, a header is matched by
  // equality first, then by containing every word of an alias — never by an
  // alias containing the header, which is how "a" or "dr" match anything.
  var ALIASES = {
    date:         ['posting date', 'post date', 'posted date', 'gl date', 'transaction date', 'trans date',
                   'entry date', 'journal date', 'je date', 'effective date', 'date', 'posted'],
    account_code: ['account number', 'account no', 'acct no', 'account num', 'acct number', 'account code',
                   'acct code', 'gl code', 'gl account number', 'gl acct no', 'account id', 'account'],
    account_name: ['account name', 'account description', 'account title', 'gl account name', 'acct name'],
    account:      ['gl account', 'gl acct', 'account and name', 'account name and number'],
    description:  ['description', 'line description', 'transaction description', 'memo', 'narration',
                   'details', 'detail', 'comment', 'comments', 'notes'],
    vendor:       ['vendor', 'vendor name', 'payee', 'payee name', 'name', 'customer vendor', 'counterparty'],
    reference:    ['reference', 'ref', 'ref no', 'reference no', 'reference number', 'journal', 'journal no',
                   'journal number', 'journal entry', 'je', 'je no', 'entry no', 'entry number',
                   'document number', 'doc no', 'check number', 'check no', 'transaction id', 'batch'],
    debit:        ['debit', 'debits', 'debit amount', 'dr', 'dr amount'],
    credit:       ['credit', 'credits', 'credit amount', 'cr', 'cr amount'],
    amount:       ['amount', 'net amount', 'transaction amount', 'net'],
  };
  // "account" alone is ambiguous: a code column when it holds codes, a combined
  // "5100 · Landscaping" column when it holds both. account_code lists it last so
  // an explicit "account number" wins; cells are split per row either way.

  function _norm(s) {
    return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }
  function _words(s) { var n = _norm(s); return n ? n.split(' ') : []; }

  /** Which field a header names: { field, exact } or null. */
  function matchHeader(raw) {
    var h = _norm(raw);
    if (!h) return null;
    var fields = Object.keys(ALIASES);
    for (var i = 0; i < fields.length; i++) {
      if (ALIASES[fields[i]].indexOf(h) >= 0) return { field: fields[i], exact: true, words: 99 };
    }
    var hw = h.split(' '), best = null;
    fields.forEach(function (f) {
      ALIASES[f].forEach(function (a) {
        var aw = a.split(' ');
        if (aw.length < 2) return;   // a one-word alias matches only exactly
        var all = aw.every(function (w) { return hw.indexOf(w) >= 0; });
        if (all && (!best || aw.length > best.words)) best = { field: f, exact: false, words: aw.length };
      });
    });
    return best;
  }

  /**
   * Find the header row in the first 25 rows and map columns to fields.
   * Returns { headerIndex, columns: {field: colIndex}, mode, error }.
   * A usable header has a date, an account, and debit/credit or an amount.
   */
  function detectHeader(rows) {
    var best = null;
    var limit = Math.min(25, (rows || []).length);
    for (var r = 0; r < limit; r++) {
      var row = rows[r] || [];
      var cols = {}, score = 0;
      var ranked = [];
      row.forEach(function (cell, c) {
        var m = matchHeader(cell);
        if (m) ranked.push({ c: c, m: m });
      });
      // Exact matches claim fields first; a field is taken once.
      ranked.sort(function (a, b) { return (b.m.exact - a.m.exact) || (b.m.words - a.m.words) || (a.c - b.c); });
      ranked.forEach(function (x) {
        if (cols[x.m.field] === undefined) { cols[x.m.field] = x.c; score++; }
      });
      var hasDate = cols.date !== undefined;
      var hasAcct = cols.account_code !== undefined || cols.account_name !== undefined || cols.account !== undefined;
      var hasMoney = cols.debit !== undefined || cols.credit !== undefined || cols.amount !== undefined;
      if (hasDate && hasAcct && hasMoney && (!best || score > best.score)) best = { headerIndex: r, columns: cols, score: score };
    }
    if (!best) {
      return { headerIndex: -1, columns: {}, mode: null,
               error: 'No header row found: a general ledger needs a date column, an account column, and debit/credit or amount columns.' };
    }
    var c = best.columns;
    var mode;
    if (c.debit !== undefined || c.credit !== undefined) {
      if (c.debit === undefined || c.credit === undefined) {
        return { headerIndex: best.headerIndex, columns: c, mode: null,
                 error: 'The ledger has a ' + (c.debit !== undefined ? 'debit' : 'credit') + ' column but no '
                   + (c.debit !== undefined ? 'credit' : 'debit') + ' column. Both sides are needed.' };
      }
      mode = 'debit_credit';
    } else {
      mode = 'signed';
    }
    return { headerIndex: best.headerIndex, columns: c, mode: mode, error: null };
  }

  // ── Amounts ─────────────────────────────────────────────────────────────────
  /**
   * One cell as integer cents. Returns { cents, blank, error }.
   * Accepts: numbers; "$1,234.56"; "(1,234.56)" and "1234.56-" as negatives;
   * "-$5" and "$-5". Rejects anything else — "12abc", "1.2.3", "1e3", more than
   * two decimals — as an error, never as 0.
   */
  function parseAmount(v) {
    if (v === null || v === undefined) return { cents: null, blank: true, error: null };
    if (typeof v === 'number') {
      if (!isFinite(v)) return { cents: null, blank: false, error: 'not a number' };
      var c = Math.round(v * 100);
      if (Math.abs(v * 100 - c) > 1e-6) return { cents: null, blank: false, error: 'more than two decimal places' };
      if (Math.abs(c) > MAX_ABS_CENTS) return { cents: null, blank: false, error: 'amount too large' };
      return { cents: c === 0 ? 0 : c, blank: false, error: null };
    }
    var s = String(v).replace(/ /g, ' ').trim();
    if (!s) return { cents: null, blank: true, error: null };
    var neg = false;
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1).trim(); }
    if (/-$/.test(s)) { if (neg) return { cents: null, blank: false, error: 'not an amount' }; neg = true; s = s.slice(0, -1).trim(); }
    s = s.replace(/^\$\s*/, '');
    if (/^-/.test(s)) { if (neg) return { cents: null, blank: false, error: 'not an amount' }; neg = true; s = s.slice(1).trim(); }
    s = s.replace(/^\$\s*/, '');
    if (!/^(\d{1,3}(,\d{3})+|\d+)(\.\d+)?$|^\.\d+$/.test(s)) return { cents: null, blank: false, error: 'not an amount' };
    var parts = s.replace(/,/g, '').split('.');
    var frac = parts[1] || '';
    if (frac.length > 2) return { cents: null, blank: false, error: 'more than two decimal places' };
    var whole = parts[0] || '0';
    if (whole.length > 13) return { cents: null, blank: false, error: 'amount too large' };
    var cents = parseInt(whole, 10) * 100 + parseInt((frac + '00').slice(0, 2), 10);
    if (cents > MAX_ABS_CENTS) return { cents: null, blank: false, error: 'amount too large' };
    return { cents: neg && cents !== 0 ? -cents : cents, blank: false, error: null };
  }

  /** Integer cents → "1234.56" / "-0.05". */
  function centsToString(c) {
    var neg = c < 0, a = Math.abs(c);
    var s = Math.floor(a / 100) + '.' + String(a % 100).padStart(2, '0');
    return neg ? '-' + s : s;
  }

  // ── Dates ───────────────────────────────────────────────────────────────────
  function _iso(y, m, d) {
    if (!(y >= 1900 && y <= 2999 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
    var t = new Date(Date.UTC(y, m - 1, d));
    if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null;
    return y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  }

  /**
   * One cell as an ISO date. Returns { iso, blank, error }.
   * Numbers are Excel 1900-system serials (1 = 1900-01-01; serial 60 is Excel's
   * fictitious 29 Feb 1900 and is refused). Strings: YYYY-MM-DD (time ignored),
   * YYYY/MM/DD, and the slash forms N/N/YYYY, N-N-YYYY, N/N/YY (20YY), read in
   * the given order: 'mdy' (the default for a single cell) or 'dmy'. parseRows
   * never relies on that default — it decides the order for the whole file
   * first (detectDateOrder) and refuses to guess. A JS Date is read in UTC.
   * Anything else, or a day that does not exist, is an error.
   */
  function parseDate(v, order) {
    var dayFirst = order === 'dmy';
    if (v === null || v === undefined) return { iso: null, blank: true, error: null };
    if (v instanceof Date) {
      if (isNaN(v.getTime())) return { iso: null, blank: false, error: 'not a date' };
      var di = _iso(v.getUTCFullYear(), v.getUTCMonth() + 1, v.getUTCDate());
      return di ? { iso: di, blank: false, error: null } : { iso: null, blank: false, error: 'not a date' };
    }
    if (typeof v === 'number') {
      if (!isFinite(v) || v < 1) return { iso: null, blank: false, error: 'not a date' };
      var n = Math.floor(v);
      if (n === 60) return { iso: null, blank: false, error: 'Excel serial 60 is 29 Feb 1900, which does not exist' };
      var base = n < 60 ? Date.UTC(1899, 11, 31) : Date.UTC(1899, 11, 30);
      var t = new Date(base + n * 86400000);
      var si = _iso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
      return si ? { iso: si, blank: false, error: null } : { iso: null, blank: false, error: 'not a date' };
    }
    var s = String(v).replace(/ /g, ' ').trim();
    if (!s) return { iso: null, blank: true, error: null };
    var m, iso = null;
    if ((m = s.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})(?:[T ].*)?$/))) iso = _iso(+m[1], +m[2], +m[3]);
    else if ((m = _slash(s))) iso = _iso(m.year, dayFirst ? m.b : m.a, dayFirst ? m.a : m.b);
    else return { iso: null, blank: false, error: 'not a date (use YYYY-MM-DD or M/D/YYYY)' };
    return iso ? { iso: iso, blank: false, error: null } : { iso: null, blank: false, error: 'not a real calendar date' };
  }

  /** "3/4/2025", "3-4-2025", "3/4/25" → { a: 3, b: 4, year: 2025 }; anything else → null. */
  function _slash(v) {
    if (typeof v !== 'string') return null;
    var m = v.replace(/ /g, ' ').trim().match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4}|\d{2})$/);
    return m ? { a: +m[1], b: +m[2], year: m[3].length === 2 ? 2000 + +m[3] : +m[3] } : null;
  }

  /**
   * DATE ORDER — decided once for the whole file, never guessed per cell.
   * "3/4/2025" is 4 March month-first and 3 April day-first. Only the file can
   * say which: a slash date whose first part is over 12 ("25/3/2025") can only
   * be day-first; one whose second part is over 12 ("3/25/2025") can only be
   * month-first. ISO text, Excel serials and Date cells carry no ambiguity.
   *
   * Returns { order, slashDates, ambiguous, mixed, monthFirstRow, dayFirstRow,
   *           example: { row, text } }:
   *   order 'iso'  no slash dates at all
   *         'mdy'  only month-first evidence     'dmy'  only day-first evidence
   *         null   no evidence either way (ambiguous) or both (mixed)
   * Rows are sheet row numbers. Cells that are not slash dates are ignored here;
   * parseDate reports them.
   */
  function detectDateOrder(rows, dateCol, fromIndex, firstRowNumber) {
    var first = firstRowNumber || 1;
    var out = { order: 'iso', slashDates: 0, ambiguous: false, mixed: false, monthFirstRow: null, dayFirstRow: null, example: null };
    if (dateCol === undefined || !Array.isArray(rows)) return out;
    for (var r = fromIndex || 0; r < rows.length; r++) {
      var p = _slash((rows[r] || [])[dateCol]);
      if (!p) continue;
      out.slashDates++;
      if (!out.example) out.example = { row: first + r, text: String(rows[r][dateCol]).trim() };
      if (p.a > 12 && p.b <= 12 && out.dayFirstRow === null) out.dayFirstRow = first + r;
      if (p.b > 12 && p.a <= 12 && out.monthFirstRow === null) out.monthFirstRow = first + r;
    }
    if (!out.slashDates) return out;
    out.mixed = out.dayFirstRow !== null && out.monthFirstRow !== null;
    out.ambiguous = out.dayFirstRow === null && out.monthFirstRow === null;
    out.order = out.mixed || out.ambiguous ? null : out.dayFirstRow !== null ? 'dmy' : 'mdy';
    return out;
  }

  // ── Accounts and text ───────────────────────────────────────────────────────
  function _text(v) {
    if (v === null || v === undefined) return '';
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    return String(v).replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
  }

  /**
   * A combined account cell — "5100 · Landscaping", "5100 - Landscaping",
   * "5100: Landscaping", "5100 Landscaping" — as { code, name }. A cell that is
   * only a code ("5100", "1000-01", "0100") is { code }. Codes are text: a
   * leading zero is kept when the cell is text. A numeric cell cannot carry
   * one; it is kept as the number's digits.
   */
  function splitAccount(v) {
    var s = _text(v);
    if (!s) return { code: '', name: '' };
    var m = s.match(/^([A-Za-z]{0,3}\d[\d.\-]*)(?:\s*[·•:|–—]\s*|\s+-\s+|\s+)(.+)$/);
    if (m) return { code: m[1], name: m[2].trim() };
    if (/^[A-Za-z]{0,3}\d[\d.\-]*$/.test(s)) return { code: s, name: '' };
    return { code: '', name: s };
  }

  // ── CSV files ───────────────────────────────────────────────────────────────
  // The server imports CSV only: the spreadsheet library the browser uses
  // (SheetJS) could not be verified for server use. The preview and the server
  // read a file through these same functions, so they read it the same way.
  //
  // MAX_FILE_BYTES is the largest original /api/upload can store (request-limits
  // .js: Vercel's 4.5 MB body, base64-encoded). IMPORT_MAX_ROWS is the largest
  // ledger the server imports in one transaction — PROVISIONAL until measured on
  // the real platform (see migration 046's header).
  var MAX_FILE_BYTES = 3489792;   // = request-limits.js MAX_UPLOAD_BYTES (a test pins it)
  var IMPORT_MAX_ROWS = 10000;

  /**
   * Bytes (Uint8Array / Buffer / ArrayBuffer) → text. UTF-8 only, strictly: a
   * file in another encoding is refused rather than read as mojibake. A leading
   * byte-order mark is dropped. Returns { text, error }.
   */
  function decodeUtf8(bytes) {
    var u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
    if (u8.length > MAX_FILE_BYTES) return { text: null, error: 'The file is ' + u8.length + ' bytes; at most ' + MAX_FILE_BYTES + ' can be imported.' };
    var text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(u8); }
    catch (_) { return { text: null, error: 'The file is not UTF-8 text. Save it as "CSV UTF-8" and upload it again.' }; }
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    return { text: text, error: null };
  }

  /**
   * CSV text → rows of string cells (RFC 4180). Quoted fields may hold the
   * delimiter, doubled quotes and line breaks; CRLF, LF and CR all end a row. A
   * quote inside an unquoted field is kept as a character (5" pipe). The
   * delimiter is read from the first line: comma, else tab. A semicolon file is
   * refused — its numbers usually use decimal commas, which would be misread.
   * Returns { rows, delimiter, error }; an error names the line it starts on.
   */
  function parseCsv(text) {
    var t = String(text == null ? '' : text);
    var firstLine = t.split(/\r\n|\n|\r/, 1)[0] || '';
    var bare = firstLine.replace(/"[^"]*"/g, '');
    var delim = bare.indexOf(',') >= 0 ? ',' : bare.indexOf('\t') >= 0 ? '\t' : null;
    if (!delim) {
      return { rows: [], delimiter: null,
               error: bare.indexOf(';') >= 0 ? 'Semicolon-separated files are not supported (their decimal commas would be misread). Export with commas.'
                                             : 'The first line has no commas or tabs; this is not a CSV ledger.' };
    }
    var rows = [], row = [], field = '', i = 0, n = t.length, line = 1, quoted = false, startLine = 1;
    while (i < n) {
      var ch = t[i];
      if (quoted) {
        if (ch === '"') {
          if (t[i + 1] === '"') { field += '"'; i += 2; continue; }
          quoted = false; i++;
          var nx = t[i];
          if (i < n && nx !== delim && nx !== '\n' && nx !== '\r') {
            return { rows: [], delimiter: delim, error: 'Line ' + line + ': text after a closing quote.' };
          }
          continue;
        }
        if (ch === '\n' || (ch === '\r' && t[i + 1] !== '\n')) line++;
        field += ch; i++; continue;
      }
      if (ch === '"' && field === '') { quoted = true; startLine = line; i++; continue; }
      if (ch === delim) { row.push(field); field = ''; i++; continue; }
      if (ch === '\r' || ch === '\n') {
        row.push(field); rows.push(row); row = []; field = '';
        i += (ch === '\r' && t[i + 1] === '\n') ? 2 : 1; line++;
        continue;
      }
      field += ch; i++;
    }
    if (quoted) return { rows: [], delimiter: delim, error: 'Line ' + startLine + ': a quoted field is never closed.' };
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return { rows: rows, delimiter: delim, error: null };
  }

  /** decodeUtf8 + parseCsv. Returns { rows, delimiter, error }. */
  function readCsvFile(bytes) {
    var d = decodeUtf8(bytes);
    if (d.error) return { rows: [], delimiter: null, error: d.error };
    return parseCsv(d.text);
  }

  /**
   * What an import sends to the database: the parsed lines and the totals they
   * add up to. Built from a parseRows result by the SERVER, from the stored
   * file — never from anything a browser sent.
   */
  function importPayload(res) {
    return {
      rows: (res.entries || []).map(function (e) {
        return { posted_on: e.postedOn, account_code: e.accountCode, account_name: e.accountName, description: e.description,
                 vendor: e.vendor, reference: e.reference, debit_cents: e.debitCents, credit_cents: e.creditCents,
                 source_row: e.sourceRow, key: e.key };
      }),
      summary: { lines: res.totals.lines, debitCents: res.totals.debitCents, creditCents: res.totals.creditCents,
                 balanced: res.totals.balanced, dateOrder: res.dateOrder, periodStart: res.period.start, periodEnd: res.period.end },
    };
  }

  // ── Rows ────────────────────────────────────────────────────────────────────
  function _cell(row, idx) { return idx === undefined ? undefined : row[idx]; }
  function _isBlankRow(row) {
    return !row || !row.some(function (c) { return _text(c) !== ''; });
  }

  function _contentKey(e) {
    var acct = e.accountCode ? 'c:' + e.accountCode.toLowerCase() : 'n:' + e.accountName.toLowerCase();
    return [e.postedOn, acct, e.debitCents, e.creditCents,
            e.reference.toLowerCase(), e.description.toLowerCase(), e.vendor.toLowerCase()].join('\u001f');
  }

  /**
   * Parse a sheet. `rows` is an array of rows (arrays of cells), header
   * included. Options:
   *   firstRowNumber  the sheet row number of rows[0] (default 1)
   *   periodStart / periodEnd  ISO dates; a line outside is an error
   *   maxRows         default 20,000 data rows
   *   dateOrder       'mdy' | 'dmy' — a person's choice, needed only when the
   *                   file's slash dates are ambiguous (see detectDateOrder)
   *
   * Returns {
   *   ok, mode, headerIndex, headerRowNumber, columns,
   *   dateOrder:       'iso' | 'mdy' | 'dmy' — what the import records; null
   *                    when undecided
   *   dateOrderSource: 'iso' | 'detected' | 'person'
   *   needsDateOrder:  true when the file is ambiguous and no order was given;
   *                    there are then no entries — the preview must ask
   *   dateDetection:   detectDateOrder's evidence, for the preview to show
   *   entries:  [{ sourceRow, postedOn, accountCode, accountName, description,
   *                vendor, reference, debitCents, creditCents, amountCents,
   *                occurrence, key, warnings[] }],
   *   errors:   [{ sourceRow, field, message }]   — any error blocks an import
   *   skipped:  [{ sourceRow, reason }]           — blank, zero or total lines
   *   warnings: [{ sourceRow, message }],
   *   totals:   { lines, debitCents, creditCents, netCents, balanced,
   *               byAccount: { key: { accountCode, accountName, debitCents, creditCents, lines } },
   *               byMonth:   { 'YYYY-MM': { debitCents, creditCents, lines, balanced } } },
   *   period:   { start, end }   — the earliest and latest posting dates read
   * }
   */
  function parseRows(rows, opts) {
    var o = opts || {};
    var first = o.firstRowNumber || 1;
    var maxRows = o.maxRows || MAX_ROWS;
    var out = { ok: false, mode: null, headerIndex: -1, headerRowNumber: null, columns: {},
                dateOrder: null, dateOrderSource: null, needsDateOrder: false, dateDetection: null,
                entries: [], errors: [], skipped: [], warnings: [],
                totals: { lines: 0, debitCents: 0, creditCents: 0, netCents: 0, balanced: false, byAccount: {}, byMonth: {} },
                period: { start: null, end: null } };
    if (!Array.isArray(rows) || !rows.length) {
      out.errors.push({ sourceRow: null, field: 'file', message: 'The sheet is empty.' });
      return out;
    }
    var hdr = detectHeader(rows);
    out.headerIndex = hdr.headerIndex;
    out.headerRowNumber = hdr.headerIndex >= 0 ? first + hdr.headerIndex : null;
    out.columns = hdr.columns;
    out.mode = hdr.mode;
    if (hdr.error) { out.errors.push({ sourceRow: out.headerRowNumber, field: 'header', message: hdr.error }); return out; }

    var dataCount = 0;
    for (var i = hdr.headerIndex + 1; i < rows.length; i++) if (!_isBlankRow(rows[i])) dataCount++;
    if (dataCount > maxRows) {
      out.errors.push({ sourceRow: null, field: 'file', message: 'The ledger has ' + dataCount + ' rows; at most ' + maxRows + ' can be imported at once.' });
      return out;
    }

    var c = hdr.columns;

    // The file's date order: chosen by a person, or proven by the file — never
    // assumed. An ambiguous or mixed file yields no entries until it is settled.
    var det = detectDateOrder(rows, c.date, hdr.headerIndex + 1, first);
    out.dateDetection = det;
    var chosen = o.dateOrder;
    if (chosen !== undefined && chosen !== null && chosen !== 'mdy' && chosen !== 'dmy') {
      out.errors.push({ sourceRow: null, field: 'dateOrder', message: 'The date order must be month-first (mdy) or day-first (dmy).' });
      return out;
    }
    if (det.mixed) {
      out.errors.push({ sourceRow: det.dayFirstRow, field: 'dateOrder',
        message: 'The file mixes date orders: row ' + det.monthFirstRow + ' can only be month-first and row ' + det.dayFirstRow
          + ' can only be day-first. Correct the file; nothing can be imported from it as it is.' });
      return out;
    }
    if (chosen) {
      var against = chosen === 'mdy' ? det.dayFirstRow : det.monthFirstRow;
      if (against !== null) {
        out.errors.push({ sourceRow: against, field: 'dateOrder',
          message: (chosen === 'mdy' ? 'Month-first' : 'Day-first') + ' was chosen, but row ' + against + ' can only be '
            + (chosen === 'mdy' ? 'day-first' : 'month-first') + '.' });
        return out;
      }
      out.dateOrder = det.slashDates ? chosen : 'iso';
      out.dateOrderSource = det.slashDates ? 'person' : 'iso';
    } else if (det.ambiguous) {
      out.needsDateOrder = true;
      out.errors.push({ sourceRow: det.example.row, field: 'dateOrder',
        message: 'All ' + det.slashDates + ' slash dates in this file could be month-first or day-first (row ' + det.example.row
          + ': "' + det.example.text + '"). Choose month-first or day-first before importing.' });
      return out;
    } else {
      out.dateOrder = det.order;
      out.dateOrderSource = det.order === 'iso' ? 'iso' : 'detected';
    }
    var order = out.dateOrder === 'dmy' ? 'dmy' : 'mdy';
    var seen = {};
    for (var r = hdr.headerIndex + 1; r < rows.length; r++) {
      var row = rows[r] || [];
      var sourceRow = first + r;
      if (_isBlankRow(row)) { out.skipped.push({ sourceRow: sourceRow, reason: 'blank' }); continue; }

      var rowErrors = [];
      var warn = [];
      var err = function (field, message) { rowErrors.push({ sourceRow: sourceRow, field: field, message: message }); };

      var d = parseDate(_cell(row, c.date), order);
      var label = [c.account_code, c.account_name, c.account, c.description, c.vendor, c.reference]
        .map(function (k) { return _text(_cell(row, k)); }).join(' ');
      // A "Total" / "Subtotal" line with no date is a summary, not an entry.
      if (d.blank && /\b(grand\s+)?(sub)?totals?\b/i.test(label)) { out.skipped.push({ sourceRow: sourceRow, reason: 'total line' }); continue; }
      if (d.blank) err('date', 'no posting date');
      else if (d.error) err('date', d.error);
      else {
        if (o.periodStart && d.iso < o.periodStart) err('date', d.iso + ' is before the period (' + o.periodStart + ')');
        if (o.periodEnd && d.iso > o.periodEnd) err('date', d.iso + ' is after the period (' + o.periodEnd + ')');
      }

      var code = '', name = '';
      if (c.account_code !== undefined) {
        var sc = splitAccount(_cell(row, c.account_code));
        code = sc.code; name = sc.name;
      }
      if (c.account !== undefined) {
        var sa = splitAccount(_cell(row, c.account));
        if (!code) code = sa.code;
        if (!name) name = sa.name;
      }
      if (c.account_name !== undefined) {
        var nm = _text(_cell(row, c.account_name));
        if (nm) name = nm;
      }
      if (!code && !name) err('account', 'no account');
      else if (!code) warn.push('no account code; the account name identifies it');

      var debit = 0, credit = 0;
      if (hdr.mode === 'debit_credit') {
        var pd = parseAmount(_cell(row, c.debit));
        var pc = parseAmount(_cell(row, c.credit));
        if (pd.error) err('debit', 'debit: ' + pd.error);
        if (pc.error) err('credit', 'credit: ' + pc.error);
        if (!pd.error && !pc.error) {
          var dv = pd.cents || 0, cv = pc.cents || 0;
          if (dv < 0) { warn.push('negative debit read as a credit'); cv += -dv; dv = 0; }
          if (cv < 0) { warn.push('negative credit read as a debit'); dv += -cv; cv = 0; }
          if (dv && cv) err('amount', 'both a debit and a credit on one line');
          debit = dv; credit = cv;
        }
      } else {
        var pa = parseAmount(_cell(row, c.amount));
        if (pa.error) err('amount', 'amount: ' + pa.error);
        else if (pa.blank) err('amount', 'no amount');
        else if (pa.cents > 0) debit = pa.cents;
        else credit = -pa.cents;
      }

      if (rowErrors.length) { Array.prototype.push.apply(out.errors, rowErrors); continue; }
      if (!debit && !credit) { out.skipped.push({ sourceRow: sourceRow, reason: 'zero amount' }); continue; }

      var e = {
        sourceRow: sourceRow, postedOn: d.iso, accountCode: code, accountName: name,
        description: _text(_cell(row, c.description)), vendor: _text(_cell(row, c.vendor)),
        reference: _text(_cell(row, c.reference)),
        debitCents: debit, creditCents: credit, amountCents: debit - credit,
        occurrence: 0, key: '', warnings: warn,
      };
      var content = _contentKey(e);
      seen[content] = (seen[content] || 0) + 1;
      e.occurrence = seen[content];
      e.key = content + '\u001f#' + e.occurrence;
      out.entries.push(e);
      warn.forEach(function (w) { out.warnings.push({ sourceRow: sourceRow, message: w }); });

      var t = out.totals;
      t.lines++; t.debitCents += debit; t.creditCents += credit;
      var ak = code ? 'c:' + code : 'n:' + name.toLowerCase();
      var acc = t.byAccount[ak] || (t.byAccount[ak] = { accountCode: code, accountName: name, debitCents: 0, creditCents: 0, lines: 0 });
      if (!acc.accountName && name) acc.accountName = name;
      acc.debitCents += debit; acc.creditCents += credit; acc.lines++;
      var mk = d.iso.slice(0, 7);
      var mo = t.byMonth[mk] || (t.byMonth[mk] = { debitCents: 0, creditCents: 0, lines: 0, balanced: false });
      mo.debitCents += debit; mo.creditCents += credit; mo.lines++;
      if (!out.period.start || d.iso < out.period.start) out.period.start = d.iso;
      if (!out.period.end || d.iso > out.period.end) out.period.end = d.iso;
    }

    var tt = out.totals;
    tt.netCents = tt.debitCents - tt.creditCents;
    tt.balanced = tt.lines > 0 && tt.netCents === 0;
    Object.keys(tt.byMonth).forEach(function (k) { var m = tt.byMonth[k]; m.balanced = m.debitCents === m.creditCents; });
    if (!tt.lines && !out.errors.length) out.errors.push({ sourceRow: null, field: 'file', message: 'No ledger lines were found under the header.' });
    out.ok = out.errors.length === 0 && tt.lines > 0;
    return out;
  }

  var api = {
    MAX_ROWS: MAX_ROWS,
    ALIASES: ALIASES,
    matchHeader: matchHeader,
    detectHeader: detectHeader,
    parseAmount: parseAmount,
    parseDate: parseDate,
    detectDateOrder: detectDateOrder,
    splitAccount: splitAccount,
    centsToString: centsToString,
    parseRows: parseRows,
    MAX_FILE_BYTES: MAX_FILE_BYTES,
    IMPORT_MAX_ROWS: IMPORT_MAX_ROWS,
    decodeUtf8: decodeUtf8,
    parseCsv: parseCsv,
    readCsvFile: readCsvFile,
    importPayload: importPayload,
  };
  if (root) root.GLImport = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

})(typeof window !== 'undefined' ? window : null);
