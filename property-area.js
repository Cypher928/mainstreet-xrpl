/**
 * property-area.js — the ONE definition of leased area, and of occupancy.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * PropertyRecord has always returned `identity.leasedSqft: null`, and said why:
 * three modules compute a property-level leased total and they disagree.
 *
 *   acquisition-engine.js:404      Σ parseFloat(t.leased_sqft), missing ⇒ 0
 *   lease-review-packets.js        Σ over "active" tenants only
 *   PropertyReference.occupancyPct Σ (t.leased_sqft || t.sqft) over every tenant
 *
 * Refusing to pick one was right. What was NOT right — and what the M1–M6 audit
 * measured — is that the record went on publishing `identity.occupancy`, which
 * came from the third of those. So the record declined to state the numerator
 * and published a ratio computed from it, and an agent could recover the
 * refused number by multiplying occupancy by totalSqft.
 *
 * WHAT IS WRONG WITH EACH OF THE THREE
 * ------------------------------------
 * All three silently substitute something for a tenant whose area is unknown:
 *
 *   · `|| 0`      treats "we don't know this tenant's area" as "this tenant
 *                 occupies nothing", which understates leased area and
 *                 overstates vacancy.
 *   · `|| sqft`   substitutes a DIFFERENT QUANTITY. `leased_sqft` is demised
 *                 area under a lease; `sqft` is the tenant row's own area
 *                 figure. Falling back from one to the other quietly changes
 *                 what the sum means, mid-sum, per tenant.
 *   · "active"    is a filter no other consumer applies, so the same property
 *                 has two leased totals depending on who asks.
 *
 * Each of those is a guess wearing a number's clothing, which is the one thing
 * this codebase does not do.
 *
 * THE CANONICAL DEFINITION
 * ------------------------
 *     leasedSqft = Σ leased_sqft, over EVERY tenant, and only when EVERY
 *                  tenant has one.
 *
 * No filter, no fallback, no substitution. If a single tenant's `leased_sqft`
 * is absent the total is not a smaller number — it is UNKNOWN, and it comes
 * back null with a count of how many tenants are missing an area, so a caller
 * can see exactly what stands between it and an answer.
 *
 * This is strictly more informative than the old always-null: a property whose
 * tenants all carry an area now gets a real, defensible number, and one that
 * does not gets a null it can act on.
 *
 * OCCUPANCY FOLLOWS FROM IT, OR IT DOES NOT EXIST
 * -----------------------------------------------
 * occupancy = leasedSqft / totalSqft, from the SAME numerator. It is null
 * whenever leasedSqft is null, so the pair can never contradict each other.
 *
 * AND THE CLAMP IS GONE
 * ---------------------
 * PropertyReference.occupancyPct ends in `Math.min(100, ...)`. A property whose
 * tenant areas sum to more than its own total area is a property with bad data
 * — double-counted tenants, a stale suite record, a total that was never
 * updated after a subdivision — and the clamp converts that evidence into a
 * confident, plausible "100% occupied". The one number that could have revealed
 * the contradiction is the one it erases.
 *
 * Here, leased > total returns null with reason `exceeds_total`. A contradiction
 * is surfaced, never rounded away. (PropertyReference.occupancyPct is left
 * exactly as it is: it is a UI helper for the browser, changing it is a UI
 * change, and this module simply stops the record depending on it.)
 *
 * PURE. No DOM, no network, no storage, no session state, no mutation.
 */
(function (root) {
  'use strict';

  /** Finite numbers only. '', null, undefined, NaN and 'abc' are all absent. */
  function _area(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = typeof v === 'number' ? v : parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }

  function _tenants(property) {
    var t = property && property.tenants;
    return Array.isArray(t) ? t.filter(Boolean) : [];
  }

  /**
   * Total demised area under lease.
   *
   * @returns {{value: number|null, complete: boolean, tenantsCounted: number,
   *            tenantsMissingArea: number, reason: string|null}}
   *   value  — the sum, or null when it cannot be stated
   *   reason — 'no_tenants' | 'incomplete_tenant_area' | 'negative_area', or
   *            null when a value is present
   */
  function leasedSqft(property) {
    var tenants = _tenants(property);
    var out = { value: null, complete: false, tenantsCounted: tenants.length,
                tenantsMissingArea: 0, reason: null };

    if (!tenants.length) {
      // No tenants is not a leased area of zero unless the property genuinely
      // has none — and a property whose roster could not be read reaches this
      // function with an empty list too. The record's `spaces` section already
      // distinguishes those two, so this reports the fact and lets the layer
      // that knows which case it is decide.
      out.reason = 'no_tenants';
      return out;
    }

    var sum = 0;
    for (var i = 0; i < tenants.length; i++) {
      // NOT `|| t.sqft`. See the header: that substitutes a different quantity.
      var a = _area(tenants[i].leased_sqft);
      if (a === null) { out.tenantsMissingArea++; continue; }
      if (a < 0) { out.reason = 'negative_area'; return out; }
      sum += a;
    }

    if (out.tenantsMissingArea > 0) {
      out.reason = 'incomplete_tenant_area';
      return out;
    }

    out.value = sum;
    out.complete = true;
    return out;
  }

  /**
   * Occupancy as a percentage, from the canonical numerator only.
   *
   * @returns {{value: number|null, leasedSqft: number|null, totalSqft: number|null,
   *            reason: string|null, tenantsMissingArea: number}}
   *   reason — 'no_total' | 'exceeds_total' | whatever leasedSqft() reported,
   *            or null when a value is present
   */
  function occupancyPct(property) {
    var leased = leasedSqft(property);
    var total  = _area(property && (property.totalSqft != null
                                     ? property.totalSqft : property.sqft));

    var out = { value: null, leasedSqft: leased.value, totalSqft: total,
                reason: null, tenantsMissingArea: leased.tenantsMissingArea };

    if (leased.value === null) { out.reason = leased.reason; return out; }
    if (total === null || total <= 0) { out.reason = 'no_total'; return out; }

    // NOT clamped. See the header — a ratio above 1 is the data telling you
    // something is wrong, and it is the only chance anyone gets to hear it.
    if (leased.value > total) { out.reason = 'exceeds_total'; return out; }

    out.value = Math.round((leased.value / total) * 1000) / 10;
    return out;
  }

  var api = { leasedSqft: leasedSqft, occupancyPct: occupancyPct, _area: _area };

  if (root) root.PropertyArea = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

})(typeof window !== 'undefined' ? window : null);
