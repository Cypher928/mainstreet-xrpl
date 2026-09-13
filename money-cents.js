'use strict';
/**
 * money-cents.js — the one place a dollar becomes an integer, and the one place
 * a rational share becomes a cent.
 *
 * THE DEFECT THIS EXISTS FOR
 *
 * A reconciliation of four tenants and six invoices, every figure correct,
 * printed this on the variance panel:
 *
 *     Outside the 100.0% of the property covered by loaded leases     $0.03
 *     Not attributed                                                 −$0.03
 *
 * on a building with no vacancy at all. Three tenants at exactly one third of
 * the building each: 33.33 + 33.33 + 33.33 = 99.99, so `covered` came out at
 * 0.9999 and three cents of a $300 pool were reported as belonging to space
 * nobody leases. The panel's own label said 100.0% on the same line.
 *
 * The residual then read −$0.03 — the one line whose detail text says "it is the
 * only line on this panel that means the numbers may be wrong."
 *
 * THREE SEPARATE CAUSES, ALL OF THEM ARITHMETIC
 *
 * 1. A DISPLAY VALUE USED AS AN OPERAND. `proRataPercent` is `round2(sqFt /
 *    totalSqFt × 100)` and exists to be printed. variance-breakdown.js divided
 *    by it. On the P5 fixture that put $1.06 of a $31,800 shared pool into the
 *    wrong bucket, and — because the claim bucket was computed as a subtraction
 *    remainder — surfaced it as **negative $1.06 labelled "Excluded by a lease"**.
 *
 * 2. THE SUM OF THE ROUNDED PARTS IS NOT THE ROUNDED SUM. The engine billed
 *    `round2(Σ exact)` and the statement listed `round2(exact)` per line. Both
 *    were called "what the tenant owes" and they differ by up to n/2 cents.
 *
 * 3. FLOATS. Two immaculate general-ledger columns produce a stored invoice
 *    amount of 234.54999999999995 — `1234.56 - 1000.01` in IEEE-754. And a pool
 *    of eight clean two-decimal invoices sums to 36000.299999999996. Neither
 *    needs a single bad input; both are what binary floating point does to
 *    decimal money.
 *
 * WHAT THIS MODULE IS
 *
 * The canonical integer-cent boundary for reconciliation arithmetic (D9a). Money
 * crosses into the reconciliation through `toCents` and comes back out through
 * `fromCents`; in between it is an integer and every identity closes exactly,
 * with no tolerance constant anywhere in the code or in the tests.
 *
 * SOURCE EVIDENCE IS NOT REWRITTEN (D9b). Quantisation happens at the boundary,
 * not at ingestion. `inv.amount` on the stored record keeps whatever the
 * document said or the manager typed; what enters the reconciliation is the
 * cent. `quantise()` reports whether the two differ so a surface can say so
 * rather than silently disagreeing with the paperwork.
 *
 * EXACT, NOT MERELY CAREFUL. `shareCents` multiplies through in BigInt, so
 * `amount × sqFt/totalSqFt × days/period` is evaluated as one rational and
 * rounded once. There is no intermediate float to accumulate error and no tie
 * that lands on the wrong side because 0.5 was really 0.49999999999999994.
 *
 * Exposes: window.MoneyCents  (and module.exports for the test suites)
 */
(function (root) {

  // Square footage is not guaranteed to be a whole number — source-values.js
  // deliberately lets "1200.50" through, because leases do state fractional
  // areas. Scaling by 1000 turns any realistic area into an integer so the
  // spatial share can be carried exactly as a rational rather than as a float.
  var AREA_SCALE = 1000;

  function _isNum(n) { return typeof n === 'number' && isFinite(n); }

  /**
   * A dollar amount as an integer number of cents.
   *
   * HALF-UP ON THE MAGNITUDE, so −0.005 and +0.005 are treated alike. Banker's
   * rounding would be defensible for a statistical series and is wrong here: a
   * tenant charge is not a sample, and a rule a manager cannot reproduce on a
   * calculator is a rule that will be disputed.
   *
   * @returns {number|null} integer cents, or null when the value is unreadable.
   */
  function toCents(v) {
    var n = v;
    if (typeof n !== 'number') {
      var SV = (typeof window !== 'undefined' && window.SourceValues)
            || (typeof require === 'function' ? require('./source-values.js') : null);
      if (SV) {
        var r = SV.readMoney(v);
        if (r.value === null) return null;
        n = r.value;
      } else {
        n = parseFloat(v);
      }
    }
    if (!_isNum(n)) return null;
    // The 1e-9 nudge is not a fudge factor for the result — it is protection
    // against the input ALREADY being a float artefact. 234.54999999999995 is
    // the stored form of $234.55, and Math.round(23454.999999999996) is 23455
    // only because the error happens to be upward. It is not always.
    var scaled = n * 100;
    var eps = scaled >= 0 ? 1e-9 : -1e-9;
    return Math.sign(scaled) * Math.round(Math.abs(scaled + eps));
  }

  /** Integer cents back to the number every display path already expects. */
  function fromCents(c) {
    if (!_isNum(c)) return 0;
    return Math.round(c) / 100;
  }

  /**
   * What crossing the boundary did to a value, so a surface can disclose it.
   *
   * `changed` is true only when the source genuinely carried sub-cent precision
   * — not for the float noise that IS the two-decimal value, which is why the
   * comparison is against the re-expanded cent rather than against the raw.
   */
  function quantise(v) {
    var cents = toCents(v);
    if (cents === null) return { cents: null, value: null, changed: false, status: 'unreadable' };
    var value = fromCents(cents);
    var raw   = typeof v === 'number' ? v : parseFloat(v);
    // Sub-cent by more than a float artefact could account for.
    var changed = _isNum(raw) && Math.abs(raw - value) > 1e-6;
    return { cents: cents, value: value, changed: changed, status: changed ? 'subcent' : 'ok' };
  }

  /** Sum a list of amounts as cents. The only correct way to total money. */
  function sumCents(list, pick) {
    var f = typeof pick === 'function' ? pick : function (x) { return x; };
    return (Array.isArray(list) ? list : []).reduce(function (s, x) {
      var c = toCents(f(x));
      return s + (c === null ? 0 : c);
    }, 0);
  }

  /**
   * A ratio of two possibly-fractional quantities, as a pair of integers.
   *
   * Used for the spatial share: `ratio(9200, 26000)` is `{n: 9200000, d:
   * 26000000}`, which reduces to the same rational and multiplies exactly.
   */
  function ratio(a, b) {
    var n = Math.round((Number(a) || 0) * AREA_SCALE);
    var d = Math.round((Number(b) || 0) * AREA_SCALE);
    return { n: n, d: d };
  }

  function _big(n) { return BigInt(Math.round(n)); }

  /**
   * `amountCents × Π(factor.n / factor.d)`, evaluated as ONE rational and
   * rounded half-up exactly once.
   *
   * This is the arithmetic behind every tenant charge: cents × sqFt/totalSqFt ×
   * occupiedDays/periodDays. Doing it in BigInt is what lets the printed
   * equation on the statement reproduce the billed cent — the P5 guarantee —
   * for a share like 1/3 that no decimal can carry.
   *
   * @param {number} amountCents integer cents
   * @param {Array<{n:number,d:number}>} factors
   * @returns {number} integer cents
   */
  function shareCents(amountCents, factors) {
    var c = Math.round(Number(amountCents) || 0);
    if (c === 0) return 0;
    var num = _big(c), den = 1n;
    var list = Array.isArray(factors) ? factors : [];
    for (var i = 0; i < list.length; i++) {
      var f = list[i] || {};
      var fn = Math.round(Number(f.n) || 0), fd = Math.round(Number(f.d) || 0);
      // A zero or missing denominator is not "multiply by nothing" — it is a
      // question this module cannot answer, and returning the un-apportioned
      // amount would silently bill the whole invoice to one tenant.
      if (!fd) return 0;
      num *= _big(fn); den *= _big(fd);
    }
    if (den === 0n) return 0;
    var neg = (num < 0n) !== (den < 0n);
    var a = num < 0n ? -num : num, b = den < 0n ? -den : den;
    // Half-up: (2a + b) / 2b, integer-divided.
    var q = (2n * a + b) / (2n * b);
    return neg ? -Number(q) : Number(q);
  }

  /**
   * LARGEST REMAINDER, over buckets that describe money NOBODY WAS BILLED.
   *
   * The exact parts of an invoice do not land on whole cents, and the quantised
   * parts have to sum to the invoice exactly or the identity does not close.
   * The classical answer is largest remainder: floor everything, then hand the
   * leftover cents to the largest fractional parts.
   *
   * THIS FUNCTION IS NEVER APPLIED TO AN ALLOCATION. A tenant's billed cents are
   * an INPUT to the decomposition, never one of the parts a remainder can move —
   * that is the separation the whole of P6 rests on, and the caller enforces it
   * by simply not passing allocated amounts in. See test-cent-policy.js.
   *
   * DETERMINISTIC. Ties on the fractional part are broken by position, so the
   * same inputs in the same order always produce the same cents. The caller
   * passes buckets in a fixed order, so "same order" is not an accident.
   *
   * @param {number[]} exact  non-negative exact values, in cents
   * @param {number}   target integer cents the result must sum to
   * @returns {{parts:number[], shortfall:number}} shortfall is non-zero only
   *          when `target` was smaller than the floors — the caller decides
   *          where that goes, and it is never taken out of a bucket.
   */
  function largestRemainder(exact, target) {
    var vals = (Array.isArray(exact) ? exact : []).map(function (v) {
      var n = Number(v) || 0;
      return n > 0 ? n : 0;                 // a bucket is never negative
    });
    var floors = vals.map(Math.floor);
    var used = floors.reduce(function (s, x) { return s + x; }, 0);
    var left = Math.round(Number(target) || 0) - used;
    if (left < 0) return { parts: floors, shortfall: left };
    var order = vals.map(function (v, i) { return { i: i, frac: v - floors[i] }; })
                    .sort(function (a, b) { return b.frac - a.frac || a.i - b.i; });
    for (var k = 0; k < left; k++) floors[order[k % order.length].i] += 1;
    return { parts: floors, shortfall: 0 };
  }

  var api = {
    AREA_SCALE: AREA_SCALE,
    toCents: toCents, fromCents: fromCents, quantise: quantise,
    sumCents: sumCents, ratio: ratio, shareCents: shareCents,
    largestRemainder: largestRemainder,
  };
  if (root) root.MoneyCents = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

})(typeof window !== 'undefined' ? window : null);
