'use strict';
/**
 * lease-upload-identity.js — which leasehold is an uploaded lease document for?
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * tenants.id is the permanent identity of one lease contract and its occupancy
 * lineage. An amendment, a renewal or extension, and an assignment do NOT create
 * a new leasehold; a genuinely new lease does. Only a person can tell those
 * apart reliably, so an upload that MIGHT belong to an existing leasehold is
 * never attached automatically: every candidate — a unique suite match, a unique
 * name match, several matches, a leasehold with or without a lease on file —
 * becomes a proposal a human confirms (Step A-2). AI may propose; the human
 * decides.
 *
 * The bulk pipeline used to merge a unique suite or name match straight into
 * the existing tenant, `{ ...existing, ...upload }`, so the upload's nulls, its
 * empty review state and its own lease URL replaced the leasehold's. This module
 * is the rule that replaced that merge. It decides nothing on its own: it says
 * who the candidates are, what kind of document the upload probably is, and
 * which human-confirmed values an attach would change.
 *
 * THE RULES
 * ---------
 *   · A candidate is an ELIGIBLE leasehold of the same property: it has an id
 *     and a name, it is current (leasehold-status.js — an ENDED leasehold is
 *     never offered), it is not a vacancy, and it is persisted (not an upload
 *     still held for review, not a failed extraction nobody confirmed).
 *   · A vacancy row is a space, not a leasehold identity. It is never a
 *     candidate; a lease for a vacant suite becomes a NEW leasehold with a NEW
 *     id (vacanciesFor() says which vacancy the new lease fills).
 *   · Matching is exact after normalisation — suite, then tenant name. No fuzzy
 *     matching: a near miss is a new leasehold, which a person can still see.
 *   · A value a person confirmed or entered (FieldProvenance.isHumanBacked) is
 *     never changed silently. plan() reports it as a conflict; it changes only
 *     when the human chooses the incoming value.
 *
 * PURE: no DOM, no network, no clock. Loaded by index.html after
 * leasehold-status.js and field-provenance.js (window.LeaseUploadIdentity), and
 * required directly by Node.
 */
(function (root) {
  'use strict';

  // The four things a person may say an attached document is. The keys are the
  // lease_documents.doc_type values the register already allows.
  var KINDS = [
    { key: 'amendment',         label: 'Amendment' },
    { key: 'renewal_extension', label: 'Renewal / Extension' },
    { key: 'assignment',        label: 'Assignment' },
    { key: 'original_lease',    label: 'Original Lease Copy' },
  ];
  var KIND_KEYS = KINDS.map(function (k) { return k.key; });

  // The fields an attached document may change — the same list the per-leasehold
  // amendment flow (applyAmendmentOverrides) compares.
  var COMPARABLE_FIELDS = [
    'tenant_name', 'leased_sqft', 'start_date', 'end_date', 'lease_type', 'cap',
    'admin_fee_pct', 'admin_fee_basis', 'gross_up_pct', 'expense_stop', 'audit_rights',
    'pro_rata_method', 'renewal_options',
  ];

  function _dep(name, rel) {
    var r = (typeof window !== 'undefined' && window && window[name]) ||
            (typeof require === 'function' ? require(rel) : null);
    if (!r) throw new Error(name + ' is not loaded (' + rel.slice(2) + ' must load before lease-upload-identity.js)');
    return r;
  }
  function _LS() { return _dep('LeaseholdStatus', './leasehold-status.js'); }
  function _FP() { return _dep('FieldProvenance', './field-provenance.js'); }

  var _SUFFIXES = /\b(inc|incorporated|llc|l\.l\.c|ltd|limited|corp|corporation|co|company|lp|llp|plc|gmbh|pllc)\b/g;

  function normalizeName(name) {
    return String(name || '')
      .toLowerCase()
      .replace(/\./g, '')
      .replace(/[,'’`"()]/g, ' ')
      .replace(/&/g, ' and ')
      .replace(_SUFFIXES, ' ')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function normalizeSuite(suite) {
    return String(suite || '')
      .toLowerCase()
      .replace(/\b(suite|ste|unit|space|no|#)\b/g, ' ')
      .replace(/[^a-z0-9]/g, '')
      .trim();
  }

  function _empty(v) { return v === null || v === undefined || (typeof v === 'string' && v.trim() === ''); }
  function _hasLease(t) { return !!(t && (t.leaseUrl || t.lease_url)); }

  /** Is this row a leasehold an upload may be attached to? */
  function isEligibleTarget(t) {
    if (!t || typeof t !== 'object' || !t.id) return false;
    if (t.vacant === true) return false;                        // a space, not a leasehold
    if (!_LS().isCurrent(t)) return false;                      // ENDED is never a candidate
    if (!t.tenant_name || !String(t.tenant_name).trim()) return false;
    if (t.status === 'pending') return false;                   // an upload still in flight
    if (t._pendingJobReview) return false;                      // held for review, not persisted
    if (t.extractionFailed && !t._userConfirmed) return false;  // nobody has confirmed it exists
    return true;
  }

  /**
   * Every eligible leasehold the upload may belong to. Empty means genuinely new.
   * `opts.excludeId` is the upload's own id (its placeholder must never match itself).
   */
  function candidates(roster, incoming, opts) {
    var o = opts || {};
    var suite = normalizeSuite(incoming && (incoming.suite || incoming.unitNumber));
    var name  = normalizeName(incoming && incoming.tenant_name);
    var out = [];
    (Array.isArray(roster) ? roster : []).forEach(function (t) {
      if (!isEligibleTarget(t)) return;
      if (o.excludeId != null && String(t.id) === String(o.excludeId)) return;
      var bySuite = !!suite && normalizeSuite(t.suite || t.unitNumber) === suite;
      var byName  = !!name  && normalizeName(t.tenant_name) === name;
      if (!bySuite && !byName) return;
      out.push({
        id:         t.id,
        basis:      bySuite && byName ? 'suite+name' : (bySuite ? 'suite' : 'name'),
        tenantName: t.tenant_name || null,
        suite:      (t.suite || t.unitNumber || '') || null,
        hasLease:   _hasLease(t),
        startDate:  t.start_date || null,
        endDate:    t.end_date || null,
      });
    });
    var rank = { 'suite+name': 0, suite: 1, name: 2 };
    out.sort(function (a, b) { return rank[a.basis] - rank[b.basis]; });
    return out;
  }

  /** The vacancy rows an upload for this suite would fill (never an identity). */
  function vacanciesFor(roster, incoming) {
    var suite = normalizeSuite(incoming && (incoming.suite || incoming.unitNumber));
    if (!suite) return [];
    return (Array.isArray(roster) ? roster : [])
      .filter(function (t) { return t && t.vacant === true && t.id != null &&
        normalizeSuite(t.suite || t.unitNumber) === suite; })
      .map(function (t) { return t.id; });
  }

  /**
   * MainStreet's suggestion for what the document is. A suggestion only: the
   * person confirms the kind before anything is attached.
   */
  function proposeKind(target, incoming) {
    if (!target || !incoming) return 'amendment';
    if (!_hasLease(target)) return 'original_lease';
    var a = normalizeName(target.tenant_name), b = normalizeName(incoming.tenant_name);
    if (a && b && a !== b) return 'assignment';
    if (incoming.end_date && target.end_date && String(incoming.end_date) > String(target.end_date)) {
      return 'renewal_extension';
    }
    return 'amendment';
  }

  function isKind(k) { return KIND_KEYS.indexOf(k) !== -1; }

  /** A value a person confirmed or entered. The one rule, FieldProvenance's. */
  function isHumanConfirmed(target, field) {
    return !!(target && _FP().isHumanBacked(field, target));
  }

  /**
   * What attaching `incoming` to `target` as `kind` would change.
   *
   *   changes     fields that will take the incoming value
   *   conflicts   human-confirmed fields the incoming document disagrees with
   *   unresolved  conflicts the person has not decided yet — while any remain,
   *               nothing is attached
   *   kept        conflicts the person chose to keep
   *
   * `choices[field]` is 'incoming' or 'keep'. An empty value is always filled.
   * An Original Lease Copy for a leasehold that already has its lease on file
   * only fills what is empty: a copy of the lease does not rewrite the record.
   * Everything else follows the per-leasehold amendment merge: a differing,
   * non-empty, unconfirmed value takes the incoming one.
   */
  function plan(target, incoming, kind, choices) {
    var ch = choices || {};
    var out = { changes: [], conflicts: [], unresolved: [], kept: [] };
    if (!target || !incoming) return out;
    var fillOnly = kind === 'original_lease' && _hasLease(target);
    COMPARABLE_FIELDS.forEach(function (fk) {
      var inVal = incoming[fk];
      if (_empty(inVal)) return;
      var cur = target[fk];
      if (!_empty(cur) && String(cur) === String(inVal)) return;
      if (_empty(cur)) { out.changes.push({ field: fk, from: cur == null ? null : cur, to: inVal, confirmed: false }); return; }
      if (fillOnly) return;
      if (isHumanConfirmed(target, fk)) {
        var c = { field: fk, current: cur, incoming: inVal };
        out.conflicts.push(c);
        if (ch[fk] === 'incoming')  out.changes.push({ field: fk, from: cur, to: inVal, confirmed: true });
        else if (ch[fk] === 'keep') out.kept.push(fk);
        else                        out.unresolved.push(fk);
        return;
      }
      out.changes.push({ field: fk, from: cur, to: inVal, confirmed: false });
    });
    return out;
  }

  var api = {
    KINDS: KINDS.map(function (k) { return { key: k.key, label: k.label }; }),
    KIND_KEYS: KIND_KEYS.slice(),
    COMPARABLE_FIELDS: COMPARABLE_FIELDS.slice(),
    normalizeName: normalizeName,
    normalizeSuite: normalizeSuite,
    isEligibleTarget: isEligibleTarget,
    candidates: candidates,
    vacanciesFor: vacanciesFor,
    proposeKind: proposeKind,
    isKind: isKind,
    isHumanConfirmed: isHumanConfirmed,
    plan: plan,
  };
  if (root) root.LeaseUploadIdentity = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null);
