// api/_exclusion-block.js — F-02, evaluated server side.
// ============================================================================
// A statement the landlord is forbidden to GENERATE must not become
// tenant-visible through a different door. generateTenantStatement() refuses
// when _exclusionBlockReason() returns a block; publication has to refuse on
// the same condition, or the guard is decoration.
//
// THIS IS A REUSE, NOT A REIMPLEMENTATION — which is the only reason it can be
// trusted. script.js's _exclusionState() is a thin wrapper around
// window.CamExclusions.tenantExclusionState(), and cam-exclusions.js is a UMD
// module that already exports itself to module.exports. So the server requires
// the SAME FILE the browser loads. The resolver cannot drift between the two
// paths, because there is only one resolver.
//
// What is genuinely new here is ~15 lines: the acknowledgement comparison that
// script.js:16270-16290 performs around the resolver. That logic is mirrored
// below, deliberately literally, including its two subtleties:
//
//   · the fingerprint falls back to one derived from the stored
//     excluded_categories string when the record carries none, because rows
//     rebuilt from the database on reload do not carry the run's fingerprint;
//   · an acknowledgement for a DIFFERENT exclusion set does not count. Editing
//     the lease re-blocks automatically, so a landlord cannot acknowledge one
//     set and publish against another.
//
// FAILS CLOSED. If the resolver cannot be loaded, every tenant is blocked
// rather than published. Failing open here would publish a statement whose
// exclusions were never verified — the exact defect F-02 exists to prevent.
'use strict';

let CX = null;
let CX_ERR = null;
try {
  CX = require('../cam-exclusions.js');
} catch (e) {
  CX_ERR = e && e.message;
}

/**
 * Mirrors script.js _exclusionBlockReason(), reading from stored state.
 *
 * @param {object} tenantRecord  the tenant's entry from properties.data.tenants —
 *                               needs `excluded_categories` and `_exclusionAck`.
 * @returns {null|object} null when publication may proceed; otherwise
 *                        { reason, notApplied, fingerprint, staleAck }.
 */
function exclusionBlockReason(tenantRecord) {
  if (!CX) {
    return {
      reason: 'Exclusion resolver unavailable — cannot verify which lease exclusions apply.',
      notApplied: [], fingerprint: '', staleAck: false, resolverMissing: true,
      detail: CX_ERR || null,
    };
  }

  const raw = tenantRecord && typeof tenantRecord.excluded_categories === 'string'
    ? tenantRecord.excluded_categories
    : null;

  const state = CX.tenantExclusionState(raw);
  const notApplied = state.notApplied || [];

  // Nothing unresolved ⇒ nothing to acknowledge ⇒ publication proceeds.
  if (!notApplied.length) return null;

  // Same fallback script.js uses: prefer a fingerprint carried on the record,
  // otherwise derive one from the stored string the run itself was given.
  const fp = tenantRecord && tenantRecord.exclusionFingerprint
    ? tenantRecord.exclusionFingerprint
    : (raw && raw.trim() ? state.fingerprint : '');

  const ack = tenantRecord && tenantRecord._exclusionAck;

  if (ack && fp && ack.fingerprint === fp) return null;   // acknowledged, and for THIS set

  return {
    reason: ack
      ? 'The exclusions on this lease changed after they were reviewed. Review them again before publishing.'
      : 'This lease has exclusions that could not be applied. Review them before publishing.',
    notApplied: notApplied.map(function (n) {
      return { raw: n.raw, status: n.status, reason: n.reason };
    }),
    fingerprint: fp,
    staleAck: !!(ack && ack.fingerprint !== fp),
  };
}

/** Locate a tenant's record inside properties.data by name, the way the app does. */
function findTenantRecord(propertyData, tenantName) {
  const list = (propertyData && (propertyData.tenants || propertyData.tenantData)) || [];
  if (!Array.isArray(list)) return null;
  const want = String(tenantName || '').trim().toLowerCase();
  if (!want) return null;
  return list.find(function (t) {
    if (!t) return false;
    const n = t.tenant_name || t.tenantName || t.name;
    return String(n || '').trim().toLowerCase() === want;
  }) || null;
}

module.exports = { exclusionBlockReason, findTenantRecord, resolverLoaded: !!CX };
