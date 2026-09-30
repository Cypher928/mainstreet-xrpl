'use strict';
/**
 * leasehold-status.js — the ONE answer to "is this leasehold current?"
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * tenants.id is the permanent leasehold identity (migration 037). A leasehold is
 * never deleted merely because it disappears from a roster; it can be ENDED, and
 * an ended leasehold stays on the roster as historical memory. So "a tenant row
 * exists" stopped meaning "this is a current tenant". Every consumer that means
 * current — occupancy, rent roll, expirations, readiness, renewal risk, upload
 * matching — asks here; every consumer that means "in this CAM period" asks
 * inPeriodRoster(). Nobody re-derives either rule.
 *
 * THE RULES
 * ---------
 *   · A leasehold is ENDED only when leasehold_status is exactly 'ended'. That is
 *     set by a person through the product (038), never inferred. Anything else —
 *     'active', absent (a blob row saved before 037), or garbage — is current.
 *   · A past contractual end_date does NOT make a leasehold ended. This module
 *     never reads end_date; the holdover logic that does lives in LeasePeriod.
 *   · ended_at is the confirmed actual end. For the CAM period: an ended
 *     leasehold is in the period's roster when its confirmed end falls on or
 *     after the period's first day (it owes the part it occupied). An ended row
 *     with no readable ended_at stays in the roster, so LeasePeriod reports its
 *     end as unknown rather than anything being written off silently.
 *   · A vacancy (vacant === true) is a space, not a lease: isCurrentLease()
 *     excludes it; isCurrent() does not decide vacancy.
 *   · This module is not the extraction `status` field and never reads it.
 *
 * PURE: no DOM, no network, no clock, no randomness. Loaded in the browser by
 * index.html BEFORE lease-period.js and script.js (window.LeaseholdStatus), and
 * required directly by Node.
 */
(function (root) {
  'use strict';

  var STATUSES = ['active', 'ended'];
  var REASONS  = ['lease_expired', 'terminated_early', 'surrendered', 'evicted', 'other'];
  var ISO = /^\d{4}-\d{2}-\d{2}$/;

  function _iso(v) {
    if (v == null) return null;
    var s = String(v).trim().slice(0, 10);
    return ISO.test(s) ? s : null;
  }

  function isEnded(t)        { return !!(t && t.leasehold_status === 'ended'); }
  function isCurrent(t)      { return !isEnded(t); }
  function isCurrentLease(t) { return !!t && isCurrent(t) && t.vacant !== true; }

  /** The confirmed end of an ENDED leasehold (ISO), or null. Never end_date. */
  function endedAt(t) { return isEnded(t) ? _iso(t.ended_at) : null; }

  /**
   * Is this leasehold part of the roster for a CAM period?
   * `period` is {start, end} (ISO) as LeasePeriod.periodFrom returns it, or null
   * for "no period known" (then only the lifecycle decides, and an ended row is
   * kept so the caller can still reason about it).
   */
  function inPeriodRoster(t, period) {
    if (!t) return false;
    if (!isEnded(t)) return true;
    var end = endedAt(t);
    var start = period && _iso(period.start);
    if (!end || !start) return true;
    return end >= start;
  }

  /**
   * The lifecycle triple, normalised from a tenants row or a blob record.
   * Consistent by construction: an active leasehold carries no end fields;
   * ended_at / ended_reason are kept only as far as they are valid.
   */
  function lifecycleFrom(r) {
    var ended = !!(r && r.leasehold_status === 'ended');
    return {
      leasehold_status: ended ? 'ended' : 'active',
      ended_at:         ended ? _iso(r.ended_at) : null,
      ended_reason:     (ended && REASONS.indexOf(r.ended_reason) >= 0) ? r.ended_reason : null,
    };
  }

  var api = {
    STATUSES: STATUSES.slice(),
    REASONS:  REASONS.slice(),
    isEnded: isEnded,
    isCurrent: isCurrent,
    isCurrentLease: isCurrentLease,
    endedAt: endedAt,
    inPeriodRoster: inPeriodRoster,
    lifecycleFrom: lifecycleFrom,
  };
  if (root) root.LeaseholdStatus = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null);
