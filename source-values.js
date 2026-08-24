'use strict';
/**
 * source-values.js — ONE interpretation of every number read off a document.
 *
 * A lease says "50,000". An invoice says "$1,250.00". Somewhere between the
 * document and the tenant statement, those strings become numbers. This module
 * is the only place that conversion is allowed to happen, and the only place
 * that decides what an unreadable value means.
 *
 * WHY THIS EXISTS
 *
 * The integrity audit found four independent tests for "does this lease have
 * square footage?" and two independent parsers for "what is this invoice
 * worth?". They agree on clean data and diverge on exactly the shapes document
 * extraction produces:
 *
 *   leased_sqft "50,000"    Number(v) > 0 -> NaN -> lease EXCLUDED from CAM
 *                           parseSqft(v)  -> 50000 -> no warning raised
 *                           => the lease vanished, silently, card reading "verified"
 *
 *   amount "$1,250.00"      parseFloat(v) -> NaN -> $0 in the pool total
 *                           parseMoney(v) -> 1250 -> $1,250 allocated to tenants
 *                           => billed exceeded pool, and Math.abs() hid the sign
 *
 * The fault was never the parsing. parseSqft and parseMoney are both good
 * readers. The fault was that the STRICT predicate decided whether a record
 * counted while the PERMISSIVE one decided whether to warn about it — the one
 * pairing that produces silent loss.
 *
 * THE CONTRACT
 *
 * Every reader returns the same shape, and the shape is what makes silent loss
 * impossible:
 *
 *   { value, status, usable, raw }
 *
 *   status 'ok'         a real, positive quantity
 *          'zero'       a real zero — an amount, not an absence
 *          'absent'     nothing was provided
 *          'unreadable' something was provided and could not be read
 *   usable  status === 'ok'  — the only thing an eligibility gate may consult
 *   value   the number, or NULL when there isn't one
 *
 * NULL IS NOT ZERO. 'zero' and 'unreadable' both fail `usable`, but they are
 * different facts and callers that report to a human must keep them apart: one
 * is a lease with no area, the other is a lease whose area nobody has read yet.
 * Collapsing them is how "$0" ends up standing for "we don't know".
 *
 * OWNERSHIP
 *   This module owns INTERPRETATION — what does this string mean.
 *   getValidTenants() owns ELIGIBILITY — may this lease enter the reconciliation.
 *   getFieldConfidence() owns CERTAINTY — how much do we trust the reading.
 * Three questions, three owners. This module answers only the first, and it
 * deliberately says nothing about confidence: "approx 1200" reads as 1200 here,
 * and the fact that it is approximate is carried where it already lives.
 *
 * Exposes: window.SourceValues  (and module.exports for the test suites)
 */
(function (root) {

  function _reading(value, status, raw) {
    return { value: value, status: status, usable: status === 'ok', raw: raw };
  }

  /**
   * Square footage as written on a lease.
   *
   * The parsing rules are exactly those parseSqft has always applied — OCR
   * capital-O for zero, European thousand separators, and stripping any prose
   * around the number. Nothing about how a number is READ has changed; what is
   * new is that the result distinguishes "0", "nothing" and "couldn't read it",
   * which parseSqft could not: it returned 0 for all three.
   */
  function readArea(v) {
    if (v === null || v === undefined || v === '') return _reading(null, 'absent', v);
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) return _reading(null, 'unreadable', v);
      return _reading(v, v > 0 ? 'ok' : 'zero', v);
    }
    var s = String(v).trim();
    if (s === '') return _reading(null, 'absent', v);
    // "45,OOO" -> "45,000". Vision models read a zero as a capital O routinely.
    s = s.replace(/O/g, '0');
    // "45.000" -> "45000", but only where no decimal follows, so "1200.50" survives.
    s = s.replace(/\.(?=\d{3}(?:[,\s]|$))/g, '');
    s = s.replace(/[^0-9.]/g, '');
    if (s === '' || s === '.') return _reading(null, 'unreadable', v);
    var n = parseFloat(s);
    if (isNaN(n) || !Number.isFinite(n)) return _reading(null, 'unreadable', v);
    return _reading(n, n > 0 ? 'ok' : 'zero', v);
  }

  /**
   * A money amount as written on an invoice.
   *
   * These rules come from parseMoney, whose own docstring diagnosed this bug
   * before the audit did: "A dropped invoice does not fail loudly — it leaves
   * the pool, every tenant is under-billed, and the landlord absorbs it with
   * nothing on screen to say so." That reader was put into the engine and the
   * rest of the app kept using parseFloat. This finishes the job.
   *
   * Negative amounts are legitimate (a credit), so `usable` is not "positive" —
   * it is "we read a real number". Zero is separated out because an invoice
   * genuinely worth nothing is not the same as one nobody could read.
   */
  function readMoney(v) {
    if (v === null || v === undefined || v === '') return _reading(null, 'absent', v);
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) return _reading(null, 'unreadable', v);
      return _reading(v, v === 0 ? 'zero' : 'ok', v);
    }
    var raw = String(v).trim();
    if (raw === '') return _reading(null, 'absent', v);
    // Accounting negatives: (500) means -500.
    var neg = /^\(.*\)$/.test(raw);
    if (neg) raw = raw.slice(1, -1);
    var cleaned = raw.replace(/[$£€]/g, '')
                     .replace(/[,\s]/g, '')
                     .replace(/[A-Za-z]+$/, '');
    if (cleaned === '' || cleaned === '-' || cleaned === '.') return _reading(null, 'unreadable', v);
    if (!/^-?\d*\.?\d+$/.test(cleaned)) return _reading(null, 'unreadable', v);   // "12.34.56", "1e9x"
    var n = Number(cleaned);
    if (!Number.isFinite(n)) return _reading(null, 'unreadable', v);
    if (neg) n = -n;
    return _reading(n, n === 0 ? 'zero' : 'ok', v);
  }

  var api = { readArea: readArea, readMoney: readMoney };
  if (root) root.SourceValues = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

})(typeof window !== 'undefined' ? window : null);
