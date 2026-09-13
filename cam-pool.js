'use strict';
/**
 * cam-pool.js — what is in the CAM pool, defined once.
 *
 * TWO QUANTITIES, NOT ONE. They are different numbers and both are legitimate;
 * the defect is that surfaces have been mixing them while claiming one of them.
 *
 *   GROSS EXPENSE POOL   every invoice with a readable amount, whatever its
 *                        eligibility. It is what the manager loaded. Reports
 *                        saying "Total Expenses", and the variance panel — whose
 *                        own labels say "expense pool" — mean this one.
 *
 *   CAM POOL             the subset a tenant can be billed from: camEligible is
 *                        not false. Everything whose words say CAM means this
 *                        one: the allocation, the "CAM Pool" figure on screen,
 *                        and any claim of the form "N% of total CAM".
 *
 * THE BUG THIS EXISTS FOR
 *
 * A manager marked a $70,000 roof invoice not CAM-eligible — the correct action
 * for a capital item. The allocation dropped it, exactly as instructed. The
 * concentration detector did not: it kept reporting
 *
 *     "Unusually large invoice — Summit Roofing: $70,000.00 (43.6% of total CAM)"
 *
 * about an invoice contributing nothing to CAM, because it divided by the GROSS
 * pool while its own sentence claimed the CAM pool. Since I-4 that finding is a
 * property-level billing blocker, so all four tenants stayed unbillable and the
 * manager's correct remediation did nothing. A blocker a correct action cannot
 * clear is worse than one that is merely wrong.
 *
 * WHY A MODULE FOR ONE PREDICATE
 *
 * Because there were four copies of it — script.js:843 (the Invoice
 * constructor), script.js:10096 (the engine's own filter), property-os.js:97
 * (the register's normaliser) and variance-breakdown.js — and a fifth was about
 * to be written here. `camEligible !== false` is a rule with a real edge: absent
 * means recoverable, so the default is billable and only an explicit untick
 * changes it. Four transcriptions of that today is four chances to write
 * `=== true` tomorrow and silently drop every legacy invoice from CAM.
 *
 * Exposes: window.CamPool  (and module.exports for the test suites)
 */
(function (root) {

  // ONE interpretation of "what is this invoice worth?" — the same reader the
  // eligibility gate and every warning surface use (I-1/I-2). A bare parseFloat
  // reads "$1,250.00" as 1, which is how $1,250 came to be allocated out of a
  // pool that counted it as $0. An amount that cannot be read contributes
  // nothing to the total rather than NaN-poisoning it; the register flags it
  // separately as unparsed, so a zero here is never mistaken for a confirmed $0.
  function _amount(inv) {
    if (!inv) return 0;
    const SV = (typeof window !== 'undefined' && window.SourceValues)
            || (typeof require === 'function' ? require('./source-values.js') : null);
    if (SV) {
      const r = SV.readMoney(inv.amount);
      return r.usable ? r.value : 0;
    }
    const n = typeof inv.amount === 'number' ? inv.amount : parseFloat(inv.amount);
    return Number.isFinite(n) ? n : 0;
  }

  /**
   * ABSENT MEANS RECOVERABLE. Only an explicit untick takes an invoice out of
   * CAM — which is what the checkbox in the invoice register promises, and what
   * keeps every invoice imported before the flag existed inside the pool.
   */
  function isEligible(inv) {
    return !!inv && inv.camEligible !== false;
  }

  function eligible(list)   { return (Array.isArray(list) ? list : []).filter(isEligible); }
  function excluded(list)   { return (Array.isArray(list) ? list : []).filter(i => i && !isEligible(i)); }

  // P6 — SUMMED IN CENTS, NOT ROUNDED AFTERWARDS. Eight clean two-decimal
  // invoices add up to 36000.299999999996 in binary floating point; rounding
  // that at the end hides the drift but does not prevent it, and the variance
  // identity has to close against this number exactly. Each amount becomes an
  // integer first, and the total is an integer sum.
  function _sum(list) {
    const MC = (typeof window !== 'undefined' && window.MoneyCents)
            || (typeof require === 'function' ? require('./money-cents.js') : null);
    const items = list || [];
    if (!MC) return Math.round(items.reduce((s, i) => s + _amount(i), 0) * 100) / 100;
    return MC.fromCents(items.reduce((s, i) => s + (MC.toCents(_amount(i)) || 0), 0));
  }

  /** The CAM pool: what tenants can be billed from. */
  function total(list)         { return _sum(eligible(list)); }
  /** Every invoice, eligible or not. NOT the CAM pool — see the header. */
  function grossTotal(list)    { return _sum(Array.isArray(list) ? list.filter(Boolean) : []); }
  /** What was held out of CAM, and is therefore the landlord's. */
  function excludedTotal(list) { return _sum(excluded(list)); }

  const api = { isEligible, eligible, excluded, total, grossTotal, excludedTotal };
  if (root) root.CamPool = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

})(typeof window !== 'undefined' ? window : null);
