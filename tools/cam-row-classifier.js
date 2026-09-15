'use strict';
/**
 * tools/cam-row-classifier.js — the S5 disposition rule, as a pure function.
 *
 * NOT LOADED BY THE APPLICATION. index.html does not reference this file and
 * nothing in the product imports it. It exists so the disposition proposed for
 * each of the 28 legacy cam_reconciliations rows is DETERMINISTIC, inspectable
 * and testable, rather than a judgement re-made by hand each time the question
 * is revisited. It reads a row; it writes nothing, anywhere.
 *
 * ── THE TWO AXES, WHICH THIS FILE REFUSES TO MERGE ──────────────────────────
 *
 * CALCULATION VALIDITY asks: can `capBaseAmount × (1 + cap%)` be reproduced
 * from what is persisted? That is arithmetic, and its answer is yes or no.
 *
 * SOURCE VALIDITY asks: where did the base come from? That is provenance, and
 * its answer is one of FieldProvenance's five states.
 *
 * Reproducible does NOT mean trustworthy. Every one of the eleven bases in
 * pilot is reproducible and none is lease-supported. A disposition that folded
 * the two together would either discard correct arithmetic because its input is
 * unverified, or let a stamped basis imply the input was verified. Both are
 * wrong, so `reproducible` and `sourceState` travel separately all the way to
 * the recommendation.
 *
 * ── WHAT IT WILL NOT DO ─────────────────────────────────────────────────────
 *
 * It never derives a cap base. Not from the CAM figure, the rent, the square
 * footage, the cap percentage, a sibling tenant, another user's copy of the
 * same demo property, or any arithmetic of its own. A base is present or it is
 * absent, and absent has exactly one disposition.
 */

/** The dispositions this classifier can return. Deliberately few. */
const DISPOSITIONS = [
  'recompute_and_stamp',        // lease-supported base: recompute, stamp cap_ceiling
  'recompute_disclosed',        // reproducible but unverified base: recompute, stamp, disclose provenance
  'null_out',                   // no base: expected_cam and variance become NULL
  'hold_identity_unresolved',   // tenant does not resolve: no write until identity is settled
];

const CLASSES = ['M', 'N', 'O'];

/** Money to cents and back, so a ceiling is quantised exactly as the engine does. */
function _ceiling(base, pct) {
  if (base == null || pct == null) return null;
  const b = parseFloat(base), p = parseFloat(pct);
  if (!Number.isFinite(b) || !Number.isFinite(p)) return null;
  if (!(b > 0)) return null;                       // a non-positive base is not an operand
  const scaled = b * (1 + p / 100) * 100;
  const eps = scaled >= 0 ? 1e-9 : -1e-9;
  return Math.sign(scaled) * Math.round(Math.abs(scaled + eps)) / 100;
}

const _round2 = (n) => Math.round(n * 100) / 100;

/**
 * @param {object} row  one cam_reconciliations row joined to its tenant, as read
 *                      from pilot. See test-cam-row-classification.js for shape.
 * @returns {object} a full disposition record. Pure: same row in, same record out.
 */
function classify(row) {
  const r = row || {};

  // ── Axis 1: does the tenant this row points at still exist? ───────────────
  // Checked FIRST, because nothing downstream can be trusted about a row whose
  // subject cannot be found. A cap base read from "the tenant" is meaningless
  // when there is no tenant.
  const tenantResolves = r.tenant_resolves === true;

  // ── Axis 2: is there a base, and can the ceiling be reproduced? ───────────
  const capPct  = (r.cap_pct  === null || r.cap_pct  === undefined || r.cap_pct  === '') ? null : parseFloat(r.cap_pct);
  const capBase = (r.cap_base === null || r.cap_base === undefined || r.cap_base === '') ? null : parseFloat(r.cap_base);
  const hasBase = capBase !== null && Number.isFinite(capBase) && capBase > 0;
  const ceiling = tenantResolves ? _ceiling(capBase, capPct) : null;
  const reproducible = ceiling !== null;

  // ── Axis 3: where did the base come from? ─────────────────────────────────
  // Mirrors FieldProvenance exactly, on the data a row can see. A quoted
  // evidence row is lease_confirmed; an approved unedited one is
  // manually_confirmed; a stored value with neither is manually_entered (the
  // NEVER_EXTRACTED floor, since no extractor could have supplied it); nothing
  // is unknown.
  const quotedEvid   = Number(r.capbase_evid_quoted || 0) > 0;
  const approvedEvid = Number(r.capbase_evid_approved || 0) > 0;
  const sourceState = !tenantResolves ? 'unresolved'
                    : !hasBase        ? 'unknown'
                    : quotedEvid      ? 'lease_confirmed'
                    : approvedEvid    ? 'manually_confirmed'
                    :                   'manually_entered';

  const leaseEvidence  = quotedEvid;
  // A replacement can only come from a clause that states the figure. Lease
  // text merely EXISTING is not a source; a document that mentions a base year
  // without its dollar amount is not a source either. Only a captured quote is.
  const replacementAvailable = quotedEvid;

  // ── The M sub-question the disposition turns on ───────────────────────────
  // 1 usable  — the arithmetic works
  // 2 supported — a clause backs the number
  // 3 historical — usable, unsupported: somebody typed it and nothing records why
  const mKind = !hasBase ? null
              : (leaseEvidence ? 'supported'
                              : (reproducible ? 'historical' : 'unusable'));

  const cls = !tenantResolves ? 'O' : (hasBase ? 'M' : 'N');

  let disposition, reason;
  if (!tenantResolves) {
    disposition = 'hold_identity_unresolved';
    reason = 'The tenant_id on this row matches no tenant in the property blob or the tenants table. '
           + 'Its subject cannot be identified, so no value written to it could be verified afterwards. '
           + 'Identity is a lifecycle question and is settled before, not during, a value repair.';
  } else if (!hasBase) {
    disposition = 'null_out';
    reason = 'No cap base is on file, so no ceiling exists to compute. The stored expected_cam is a cap '
           + 'percentage in a dollar column and the variance is dollars-minus-percent. NULL is what '
           + 'saveCamResults writes for this tenant today; the row is being brought into agreement with '
           + 'the code, not given a new number.';
  } else if (leaseEvidence) {
    disposition = 'recompute_and_stamp';
    reason = 'A captured clause states the base, so the ceiling is both reproducible and lease-supported. '
           + 'Recompute, and stamp expected_cam_basis = cap_ceiling.';
  } else if (reproducible) {
    disposition = 'recompute_disclosed';
    reason = 'The ceiling is reproducible from the persisted base and percentage, so the arithmetic is '
           + 'correct and stampable. The base itself is manually entered and uncited, which is a fact about '
           + 'the INPUT and not about the calculation. Recompute and stamp cap_ceiling; the base\'s '
           + 'provenance is reported separately by FieldProvenance and must be disclosed beside the figure.';
  } else {
    disposition = 'null_out';
    reason = 'A base is stored but it is not a usable operand (non-numeric, zero or negative), so no '
           + 'ceiling can be produced from it.';
  }

  const proposed = (disposition === 'recompute_and_stamp' || disposition === 'recompute_disclosed')
    ? { expected_cam: ceiling,
        variance: (r.actual_cam != null && Number.isFinite(r.actual_cam))
          ? _round2(r.actual_cam - ceiling) : null,
        expected_cam_basis: 'cap_ceiling' }
    : (disposition === 'null_out'
        ? { expected_cam: null, variance: null, expected_cam_basis: null }
        : null);   // hold ⇒ no proposed write at all

  return {
    recon_id: r.recon_id, property_id: r.property_id, property: r.property,
    tenant_id: r.tenant_id, tenant_name: r.tenant_name, cam_year: r.cam_year,
    tenantResolves,
    current: { expected_cam: r.expected_cam, actual_cam: r.actual_cam,
               variance: r.variance, expected_cam_basis: r.expected_cam_basis ?? null },
    capPct, capBase, hasBase,
    sourceState, leaseEvidence, replacementAvailable,
    reproducible, ceiling,
    class: cls, mKind, disposition, reason, proposed,
    // Stated explicitly so no consumer has to infer them.
    effects: {
      billingCouldChange: false,   // expected_cam/variance feed no statement or invoice path
      varianceCouldChange: disposition !== 'hold_identity_unresolved',
      provenanceCouldChange: false, // provenance is derived from evidence, which no disposition writes
      reversible: disposition !== 'hold_identity_unresolved',
    },
  };
}

/** Roll a set of rows up into counts, for a report that cannot drift from the rows. */
function summarise(rows) {
  const out = { total: 0, byClass: { M: 0, N: 0, O: 0 }, byDisposition: {}, byMKind: {},
                reproducible: 0, leaseSupported: 0 };
  for (const d of (rows || []).map(classify)) {
    out.total++;
    out.byClass[d.class]++;
    out.byDisposition[d.disposition] = (out.byDisposition[d.disposition] || 0) + 1;
    if (d.mKind) out.byMKind[d.mKind] = (out.byMKind[d.mKind] || 0) + 1;
    if (d.reproducible) out.reproducible++;
    if (d.leaseEvidence) out.leaseSupported++;
  }
  return out;
}

module.exports = { classify, summarise, DISPOSITIONS, CLASSES, _ceiling };
