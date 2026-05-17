/**
 * review-engine.js
 * Pure review state derivation — no DOM access, no global state, no side effects.
 * All functions: same input → same output.
 *
 * Exposes: window.ReviewEngine
 */
window.ReviewEngine = (() => {
  'use strict';

  // Warning types that represent structural missing fields (vs. quality/heuristic signals).
  const MISSING_FIELD_TYPES = new Set([
    'missing_lease_type', 'missing_sqft', 'missing_start_date',
    'missing_end_date', 'nnn_cap_missing',
  ]);

  function getWarnings(flags) {
    if (!Array.isArray(flags)) return [];
    return flags.map(f => {
      if (f === 'no_term_in_doc')        return 'No lease term found in document — please enter manually';
      if (f === 'lease_type_missing')    return 'Lease type not specified';
      if (f === 'missing_start_date')    return 'Missing start date';
      if (f === 'missing_end_date')      return 'Missing end date';
      if (f === 'approx_sqft_detected')  return 'Approximate sqft detected';
      if (f === 'base_year_detected')    return 'Base year needs review';
      return f;
    });
  }

  function computeFlags(d) {
    const base = [];
    if (d.doc_has_dates === false && !d.start_date && !d.end_date) {
      base.push('no_term_in_doc');
    } else {
      if (!d.start_date) base.push('missing_start_date');
      if (!d.end_date)   base.push('missing_end_date');
    }
    if (!d.lease_type) base.push('lease_type_missing');
    const extra = (Array.isArray(d.flags) ? d.flags : []).filter(
      f => (f === 'approx_sqft_detected' || f === 'base_year_detected') && !base.includes(f)
    );
    const result = [...base, ...extra];
    if (d.lease_type && d.lease_type !== '') return result.filter(f => f !== 'lease_type_missing');
    return result;
  }

  function computeFlagsStrict(d) {
    const base = [];
    if (d.doc_has_dates === false && d.start_date == null && d.end_date == null) {
      base.push('no_term_in_doc');
    } else {
      if (d.start_date == null) base.push('missing_start_date');
      if (d.end_date   == null) base.push('missing_end_date');
    }
    if (!d.lease_type) base.push('lease_type_missing');
    const extra = (Array.isArray(d.flags) ? d.flags : []).filter(
      f => (f === 'approx_sqft_detected' || f === 'base_year_detected') && !base.includes(f)
    );
    const result = [...base, ...extra];
    if (d.lease_type && d.lease_type !== '') return result.filter(f => f !== 'lease_type_missing');
    return result;
  }

  /**
   * Derives the full review state for a single tenant record.
   *
   * @param {object} t            - Normalized tenant record (from normalizeTenant())
   * @param {Array}  reconResults - ReconciliationResult[] — used for pro-rata overflow check.
   *                                Pass [] when results are unavailable (e.g. portfolio view
   *                                before a run). Callers in script.js pass lastResults for
   *                                the live active-property context.
   * @returns {{ status, score, warnings, reviewerConfirmed, reviewedAt, reviewedBy, notes }}
   */
  function deriveTenantReviewState(t, reconResults) {
    const _empty = {
      status: 'incomplete', score: 0, warnings: [],
      reviewerConfirmed: false, reviewedAt: null, reviewedBy: null, notes: null,
    };
    if (!t) return _empty;

    const results = Array.isArray(reconResults) ? reconResults : [];

    // ── Structured warnings ────────────────────────────────────────────────
    const warnings = [];
    if (!t.lease_type)  warnings.push({ type: 'missing_lease_type',  severity: 'high',   label: 'Lease Type' });
    if (!t.leased_sqft) warnings.push({ type: 'missing_sqft',        severity: 'high',   label: 'Sq Ft' });
    if (!t.start_date)  warnings.push({ type: 'missing_start_date',  severity: 'high',   label: 'Start Date' });
    if (!t.end_date)    warnings.push({ type: 'missing_end_date',    severity: 'high',   label: 'End Date' });
    const isNNN = /nnn|triple[\s-]?net/i.test(String(t.lease_type || ''));
    if (isNNN && (t.cap == null || t.cap === ''))
      warnings.push({ type: 'nnn_cap_missing', severity: 'medium', label: 'NNN Cap' });
    if (t._usedFallback)
      warnings.push({ type: 'fallback_extraction', severity: 'low', label: 'Fallback Extraction' });
    const sqftConf = t.confidence?.leased_sqft ?? t.confidence?.leasedSqft;
    if (sqftConf != null && sqftConf < 70)
      warnings.push({ type: 'low_sqft_confidence', severity: 'medium', label: `Low Sqft Confidence (${sqftConf}%)` });
    const recon = results.find(r => r.name === t.tenant_name);
    if (recon && recon.proRata > 1.0)
      warnings.push({ type: 'pro_rata_overflow', severity: 'high', label: 'Pro-rata > 100%' });

    // ── Score ──────────────────────────────────────────────────────────────
    let score = 100;
    if (!t.leased_sqft)  score -= 25;
    if (!t.lease_type)   score -= 25;
    if (t._usedFallback) score -= 15;
    if (sqftConf != null && sqftConf < 70) score -= 10;
    if (isNNN && (t.cap == null || t.cap === '')) score -= 10;
    score -= getWarnings(computeFlags(t)).length * 5;
    score = Math.max(0, Math.min(100, score));

    // ── Persisted review metadata ──────────────────────────────────────────
    const persisted         = t.review || {};
    const reviewerConfirmed = !!(persisted.reviewerConfirmed);
    const hasLegacyOverride = Object.values(t.reviewOverrides || {}).some(ov => ov?.reviewerConfirmed);
    if (reviewerConfirmed || hasLegacyOverride) {
      return {
        status: 'manually_verified', score, warnings, reviewerConfirmed,
        reviewedAt: persisted.reviewedAt || null, reviewedBy: persisted.reviewedBy || null,
        notes: persisted.notes || null,
      };
    }

    // ── Status derivation ──────────────────────────────────────────────────
    let status;
    if (!t.tenant_name || (t.extractionFailed && !t._userConfirmed)) {
      status = 'incomplete';
    } else if (!t.lease_type || !t.leased_sqft || !t.start_date || !t.end_date) {
      status = 'incomplete';
    } else if (
      t._usedFallback === true ||
      (sqftConf != null && sqftConf < 70) ||
      (isNNN && (t.cap == null || t.cap === '')) ||
      t._needsReview === true ||
      (recon && recon.proRata > 1.0)
    ) {
      status = 'needs_review';
    } else {
      status = 'verified';
    }

    return {
      status, score, warnings, reviewerConfirmed: false,
      reviewedAt: persisted.reviewedAt || null, reviewedBy: persisted.reviewedBy || null,
      notes: persisted.notes || null,
    };
  }

  function getTenantReviewState(t, reconResults) { return deriveTenantReviewState(t, reconResults).status; }
  function getTenantReviewScore(t, reconResults)  { return deriveTenantReviewState(t, reconResults).score; }

  function urgencyClass(score) {
    if (score < 50) return 'rq-critical';
    if (score < 80) return 'rq-moderate';
    return 'rq-healthy';
  }

  return {
    MISSING_FIELD_TYPES,
    getWarnings,
    computeFlags,
    computeFlagsStrict,
    deriveTenantReviewState,
    getTenantReviewState,
    getTenantReviewScore,
    urgencyClass,
  };
})();
