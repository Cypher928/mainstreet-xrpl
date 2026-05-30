/**
 * selectors.js
 * State derivation from canonical property/tenant data.
 * Functions accept state as parameters — no global reads, no DOM access.
 * Depends on ReviewEngine (loaded before this file).
 *
 * Exposes: window.Selectors
 */
window.Selectors = (() => {
  'use strict';

  // ── Sort constants ────────────────────────────────────────────────────────

  // Canonical review queue order — must be stable across all renders.
  // Higher priority = lower number = appears first.
  const REVIEW_STATE_ORDER = { incomplete: 0, needs_review: 1, manually_verified: 2 };

  // ── Review queue ──────────────────────────────────────────────────────────

  /**
   * Builds a flat, sorted list of tenants that need reviewer attention across
   * one or more properties. Excludes tenants in 'verified' state.
   * Reconstitutes reconResults from each property's saved snapshot so the
   * pro-rata overflow check in deriveTenantReviewState is accurate.
   *
   * Sort order (deterministic):
   *   1. incomplete  (structural data missing)
   *   2. needs_review (quality/heuristic flags)
   *   3. lowest score first (most urgent within tier)
   *   4. newest activity first (tiebreaker)
   *
   * @param {Array} props - Array of property objects
   * @returns {ReviewItem[]}
   */
  function getReviewQueueItems(props) {
    const items = [];
    for (const p of (props || [])) {
      const tenants     = Array.isArray(p.tenants) ? p.tenants.filter(Boolean) : [];
      const reconResults = (p.camReconciliation ?? p.results)?.results || [];

      for (const t of tenants) {
        const rv = ReviewEngine.deriveTenantReviewState(t, reconResults);
        if (rv.status === 'verified') continue;

        const missingFields  = rv.warnings.filter(w =>  ReviewEngine.MISSING_FIELD_TYPES.has(w.type)).map(w => w.label);
        const warningReasons = rv.warnings.filter(w => !ReviewEngine.MISSING_FIELD_TYPES.has(w.type)).map(w => w.label);

        items.push({
          propertyId:        p.id,
          propertyName:      p.name || '—',
          tenantId:          t.id,
          tenantName:        t.tenant_name || '—',
          reviewState:       rv.status,
          reviewScore:       rv.score,
          reviewerConfirmed: rv.reviewerConfirmed,
          missingFields,
          warningReasons,
          lastUpdated:       t.updated_at || t.created_at || null,
        });
      }
    }

    // Deterministic sort — never returns 0 (avoids browser-native unstable ordering)
    items.sort((a, b) => {
      const sa = REVIEW_STATE_ORDER[a.reviewState] ?? 3;
      const sb = REVIEW_STATE_ORDER[b.reviewState] ?? 3;
      if (sa !== sb) return sa - sb;
      if (a.reviewScore !== b.reviewScore) return a.reviewScore - b.reviewScore; // lowest first
      const ta = a.lastUpdated ? new Date(a.lastUpdated).getTime() : 0;
      const tb = b.lastUpdated ? new Date(b.lastUpdated).getTime() : 0;
      if (ta !== tb) return tb - ta; // newest first
      return (a.tenantName || '').localeCompare(b.tenantName || ''); // alpha fallback
    });

    return items;
  }

  // ── Property metadata ─────────────────────────────────────────────────────

  /**
   * Derives display metadata for a single property card.
   * All inputs come from the property object — no global state access.
   *
   * @param {object} prop - Property object
   * @returns {PropMeta}
   */
  function buildPropMeta(prop) {
    const snap     = prop.camReconciliation ?? prop.results ?? null;
    const invoices = (snap?.invoicesFull?.length ? snap.invoicesFull : null)
      || (prop.invoices?.length ? prop.invoices : []);
    const results    = snap?.results || [];
    const total      = snap?.total || Number(prop.totalCAM) || 0;
    const camRunsArr = snap?.camRuns || [];

    const reconResults = results; // alias for clarity below

    const missingDocs  = invoices.filter(i => i && !i.fileUrl && !i.fileName).length;
    const openDisputes = (prop.disputes || []).filter(d => d.status === 'open').length
      || Number(prop.openDisputes) || 0;

    let redCount = 0, yellowCount = 0;
    if (snap) {
      if (total > 0) {
        const thresh = total * 0.4;
        invoices.forEach(inv => { if ((parseFloat(inv?.amount) || 0) > thresh) redCount++; });
      }
      if (invoices.length > 0) {
        const pct = missingDocs / invoices.length;
        if (pct === 1) redCount++; else if (missingDocs > 0) yellowCount++;
      }
      if (camRunsArr.length >= 2) {
        const curr = camRunsArr[0];
        const prev = camRunsArr.slice(1).find(r => r.camYear !== curr.camYear) || camRunsArr[1];
        if (curr.totalExpenses && prev.totalExpenses) {
          const pct = Math.abs((curr.totalExpenses - prev.totalExpenses) / prev.totalExpenses * 100);
          if (pct > 20) redCount++; else if (pct > 10) yellowCount++;
        }
      }
      const totalPR = reconResults.reduce((s, r) => s + (r.proRataPercent || 0), 0);
      if (reconResults.length > 0 && Math.abs(totalPR - 100) >= 5) yellowCount++;
      if (openDisputes > 0) yellowCount++;
    }

    let riskLevel = 'None';
    if (snap) {
      if      (redCount >= 3 || (redCount >= 1 && openDisputes >= 1)) riskLevel = 'Critical';
      else if (redCount >= 1 || yellowCount >= 3)                     riskLevel = 'Elevated';
      else if (yellowCount >= 1)                                      riskLevel = 'Moderate';
      else                                                            riskLevel = 'Low';
    }

    const confScores = reconResults.map(r => r.averageConfidence || 0).filter(s => s > 0);
    const avgConf    = confScores.length
      ? Math.round(confScores.reduce((s, c) => s + c, 0) / confScores.length)
      : null;

    let trendDir = null, trendPct = null;
    if (camRunsArr.length >= 2) {
      const curr = camRunsArr[0];
      const prev = camRunsArr.slice(1).find(r => r.camYear !== curr.camYear) || camRunsArr[1];
      if (curr.totalExpenses && prev.totalExpenses) {
        trendPct = (curr.totalExpenses - prev.totalExpenses) / prev.totalExpenses * 100;
        trendDir = Math.abs(trendPct) < 3 ? 'flat' : trendPct > 0 ? 'up' : 'down';
      }
    }

    const tenantArr             = Array.isArray(prop.tenants) ? prop.tenants.filter(Boolean) : [];
    const tenantsNeedingReview  = tenantArr.filter(t => ReviewEngine.getTenantReviewState(t, reconResults) === 'needs_review').length;
    const incompleteLeases      = tenantArr.filter(t => ReviewEngine.getTenantReviewState(t, reconResults) === 'incomplete').length;
    const manuallyVerifiedCount = tenantArr.filter(t => ReviewEngine.getTenantReviewState(t, reconResults) === 'manually_verified').length;

    return {
      riskLevel, redCount, yellowCount, missingDocs, avgConf,
      trendDir, trendPct, openDisputes, total,
      camYear: snap?.camYear || prop.camYear || null,
      savedAt: snap?.savedAt || null,
      tenantsNeedingReview, incompleteLeases, manuallyVerifiedCount,
    };
  }

  // ── Portfolio KPIs ────────────────────────────────────────────────────────

  /**
   * Aggregates portfolio-level KPI values for the dashboard tiles.
   * @param {Array} props
   * @returns {{ properties, cam, openDisputes, criticalOrElevated, totalMissingDocs, avgConf }}
   */
  function portfolioKPIs(props) {
    const safeProps = Array.isArray(props) ? props : [];
    const metas     = safeProps.map(p => buildPropMeta(p));
    const criticalOrElevated = metas.filter(m => m.riskLevel === 'Critical' || m.riskLevel === 'Elevated').length;
    const totalMissingDocs   = metas.reduce((s, m) => s + m.missingDocs, 0);
    const confScores = metas.map(m => m.avgConf).filter(c => c !== null);
    return {
      properties:        safeProps.length,
      cam:               safeProps.reduce((s, p) => s + (Number(p.totalCAM) || 0), 0),
      openDisputes:      safeProps.reduce((s, p) => s + (Number(p.openDisputes) || 0), 0),
      criticalOrElevated,
      totalMissingDocs,
      avgConf: confScores.length
        ? Math.round(confScores.reduce((s, c) => s + c, 0) / confScores.length)
        : null,
    };
  }

  // ── Property readiness ────────────────────────────────────────────────────

  const RDY_LABELS = {
    needs_review:         'Needs Review',
    partially_verified:   'Partial',
    reconciliation_ready: 'Ready',
    reconciled:           'Reconciled',
    high_risk:            'High Risk',
  };

  /**
   * Derives property readiness state, weighted risk score, and operational insight.
   * Uses wall-clock date for expiry checks (intentional — this is a real-time status,
   * not a fixed-period reconciliation computation).
   *
   * @param {object} p - Property object
   * @returns {{ readiness, weightedRisk, riskScore, insight, missingCapCount,
   *             expiredCount, expiringCount, lowConfCount, proRataGap, unresolvedCount, incompleteCount }}
   */
  function derivePropertyReadiness(p) {
    const tenants = Array.isArray(p.tenants) ? p.tenants.filter(Boolean) : [];
    const snap    = p.camReconciliation ?? null;
    const results = snap?.results || [];
    const meta    = buildPropMeta(p);

    const rqItems    = getReviewQueueItems([p]);
    const unresolved = rqItems.filter(i => !i.reviewerConfirmed);
    const incomplete = unresolved.filter(i => i.reviewState === 'incomplete');
    const needsRev   = unresolved.filter(i => i.reviewState === 'needs_review');

    const missingCapCount = tenants.filter(t => {
      const isNNN = /nnn|triple[\s-]?net/i.test(String(t.lease_type || ''));
      return isNNN && (t.cap == null || t.cap === '');
    }).length;

    const today     = new Date().toISOString().slice(0, 10);
    const cutoff    = new Date(); cutoff.setMonth(cutoff.getMonth() + 12);
    const cutoffIso = cutoff.toISOString().slice(0, 10);

    const expiredCount  = tenants.filter(t => t.end_date && t.end_date < today).length;
    const expiringCount = tenants.filter(t => t.end_date && t.end_date >= today && t.end_date <= cutoffIso).length;
    const lowConfCount  = tenants.filter(t => t._confidence === 'low' || t._confidence === 'failed').length;

    const totalPR    = results.reduce((s, r) => s + (r.proRataPercent || 0), 0);
    const proRataGap = results.length > 0 ? Math.max(0, 100 - totalPR) : 0;

    let riskScore = 0;
    riskScore += incomplete.length * 15;
    riskScore += needsRev.length   * 8;
    riskScore += missingCapCount   * 20;
    riskScore += expiredCount      * 20;
    riskScore += meta.openDisputes * 15;
    riskScore += lowConfCount      * 10;
    riskScore += proRataGap >= 5   ? 15 : 0;
    riskScore  = Math.min(100, riskScore);

    const weightedRisk = riskScore >= 60 ? 'critical'
      : riskScore >= 35 ? 'high'
      : riskScore >= 15 ? 'moderate'
      : riskScore >  0  ? 'low'
      : 'none';

    let readiness;
    const isCriticalRisk = weightedRisk === 'critical' || meta.riskLevel === 'Critical';
    if (isCriticalRisk && unresolved.length > 0) {
      readiness = 'high_risk';
    } else if (snap?.results?.length > 0 && unresolved.length === 0) {
      readiness = 'reconciled';
    } else if (unresolved.length === 0 && tenants.length > 0) {
      readiness = 'reconciliation_ready';
    } else if (incomplete.length === 0 && needsRev.length > 0) {
      readiness = 'partially_verified';
    } else {
      readiness = 'needs_review';
    }

    let insight = null;
    if (incomplete.length > 0) {
      insight = `${incomplete.length} tenant${incomplete.length !== 1 ? 's' : ''} missing critical lease data.`;
    } else if (missingCapCount > 0) {
      insight = `${missingCapCount} NNN tenant${missingCapCount !== 1 ? 's' : ''} missing CAM cap${missingCapCount !== 1 ? 's' : ''}.`;
    } else if (proRataGap >= 5) {
      insight = `Pro-rata coverage gap of ${proRataGap.toFixed(0)}% detected.`;
    } else if (expiredCount > 0) {
      insight = `${expiredCount} lease${expiredCount !== 1 ? 's' : ''} expired — verify CAM eligibility.`;
    } else if (expiringCount > 0) {
      insight = `${expiringCount} lease${expiringCount !== 1 ? 's expire' : ' expires'} within 12 months.`;
    } else if (needsRev.length > 0) {
      insight = `${needsRev.length} tenant${needsRev.length !== 1 ? 's' : ''} flagged for review.`;
    } else if (lowConfCount > 0) {
      insight = `${lowConfCount} lease${lowConfCount !== 1 ? 's' : ''} extracted with low confidence.`;
    } else if (meta.openDisputes > 0) {
      insight = `${meta.openDisputes} open dispute${meta.openDisputes !== 1 ? 's' : ''} require resolution.`;
    } else if (readiness === 'reconciliation_ready') {
      insight = 'All tenants verified — ready to reconcile.';
    } else if (readiness === 'reconciled') {
      insight = 'Reconciliation complete.';
    }

    return {
      readiness, weightedRisk, riskScore, insight, missingCapCount,
      expiredCount, expiringCount, lowConfCount, proRataGap,
      unresolvedCount: unresolved.length, incompleteCount: incomplete.length,
    };
  }

  // ── Portfolio intelligence ────────────────────────────────────────────────

  /**
   * Aggregates portfolio-level operational intelligence across all properties.
   * @param {Array} props
   * @returns {{ totalUnresolved, totalMissingCaps, totalExpired, totalExpiring,
   *             totalLowConf, totalExposure, proRataGapProps, summary }}
   */
  function computePortfolioIntel(props) {
    let totalUnresolved = 0, totalMissingCaps = 0, totalExpired = 0;
    let totalExpiring = 0, totalLowConf = 0, totalExposure = 0, proRataGapProps = 0;

    const today     = new Date().toISOString().slice(0, 10);
    const cutoff    = new Date(); cutoff.setMonth(cutoff.getMonth() + 12);
    const cutoffIso = cutoff.toISOString().slice(0, 10);

    for (const p of (props || [])) {
      const tenants = Array.isArray(p.tenants) ? p.tenants.filter(Boolean) : [];
      const results = (p.camReconciliation ?? null)?.results || [];

      totalUnresolved  += getReviewQueueItems([p]).filter(i => !i.reviewerConfirmed).length;
      totalMissingCaps += tenants.filter(t =>
        /nnn|triple[\s-]?net/i.test(String(t.lease_type || '')) && (t.cap == null || t.cap === '')
      ).length;
      totalExpired     += tenants.filter(t => t.end_date && t.end_date < today).length;
      totalExpiring    += tenants.filter(t => t.end_date && t.end_date >= today && t.end_date <= cutoffIso).length;
      totalLowConf     += tenants.filter(t => t._confidence === 'low' || t._confidence === 'failed').length;
      totalExposure    += (p.disputes || []).filter(d => d.status === 'open')
        .reduce((s, d) => s + (parseFloat(d.tenantShare) || 0), 0);
      const totalPR = results.reduce((s, r) => s + (r.proRataPercent || 0), 0);
      if (results.length > 0 && Math.abs(totalPR - 100) >= 5) proRataGapProps++;
    }

    const issues = [];
    if (totalUnresolved  > 0) issues.push(`${totalUnresolved} unresolved review item${totalUnresolved !== 1 ? 's' : ''}`);
    if (totalMissingCaps > 0) issues.push(`${totalMissingCaps} missing CAM cap${totalMissingCaps !== 1 ? 's' : ''}`);
    if (totalExpired     > 0) issues.push(`${totalExpired} expired lease${totalExpired !== 1 ? 's' : ''}`);
    if (proRataGapProps  > 0) issues.push(`${proRataGapProps} pro-rata gap${proRataGapProps !== 1 ? 's' : ''}`);
    const summary = issues.length > 0 ? issues.join(' · ') : 'Portfolio is clean — no critical issues detected.';

    return { totalUnresolved, totalMissingCaps, totalExpired, totalExpiring, totalLowConf, totalExposure, proRataGapProps, summary };
  }

  // ── Review health helpers ─────────────────────────────────────────────────

  /**
   * Computes average review health score for a set of review items (0–100).
   * Returns 100 when no items require attention.
   * @param {ReviewItem[]} reviewItems
   * @returns {number}
   */
  function computeReviewHealth(reviewItems) {
    if (!reviewItems || reviewItems.length === 0) return 100;
    return Math.max(0, Math.round(
      reviewItems.reduce((s, i) => s + i.reviewScore, 0) / reviewItems.length
    ));
  }

  /**
   * Returns the CSS class for a review health score.
   * @param {number} health - 0–100
   * @returns {string}
   */
  function reviewHealthClass(health) {
    if (health >= 80) return 'review-health--good';
    if (health >= 50) return 'review-health--mid';
    return 'review-health--low';
  }

  /**
   * Returns chip objects {label, cls} for the property card review summary (max 3).
   * Pure derivation — no DOM access.
   * @param {ReviewItem[]} reviewItems
   * @returns {{ label, cls }[]}
   */
  function propCardBullets(reviewItems) {
    const incomplete  = reviewItems.filter(i => i.reviewState === 'incomplete').length;
    const needsReview = reviewItems.filter(i => i.reviewState === 'needs_review').length;
    let nnnCap = 0, missingDate = 0;
    reviewItems.forEach(item => {
      if (item.missingFields.includes('NNN Cap'))                                               nnnCap++;
      if (item.missingFields.includes('Start Date') || item.missingFields.includes('End Date')) missingDate++;
    });
    const chips = [];
    if (incomplete  > 0) chips.push({ label: `${incomplete} Incomplete`,    cls: 'review-chip--incomplete' });
    if (needsReview > 0) chips.push({ label: `${needsReview} Needs Review`, cls: 'review-chip--moderate'   });
    if (nnnCap      > 0) chips.push({ label: `${nnnCap} NNN Cap`,           cls: ''                        });
    if (missingDate > 0) chips.push({ label: `${missingDate} Missing Date`, cls: ''                        });
    return chips.slice(0, 3);
  }

  // ── Property sort ─────────────────────────────────────────────────────────

  const RISK_SCORE = { Critical: 4, Elevated: 3, Moderate: 2, Low: 1, None: 0 };

  /**
   * Deterministic tiebreaker sort applied after the primary sort key.
   * 1. Active disputes DESC  2. Incomplete reviews DESC
   * 3. Review health ASC (lower = more urgent)  4. Alpha ASC
   */
  function _propTiebreaker(a, b) {
    if ((a.m.openDisputes || 0) !== (b.m.openDisputes || 0))
      return (b.m.openDisputes || 0) - (a.m.openDisputes || 0);
    if ((a.m.incompleteLeases || 0) !== (b.m.incompleteLeases || 0))
      return (b.m.incompleteLeases || 0) - (a.m.incompleteLeases || 0);
    const ha = computeReviewHealth(getReviewQueueItems([a.p]).filter(i => !i.reviewerConfirmed));
    const hb = computeReviewHealth(getReviewQueueItems([b.p]).filter(i => !i.reviewerConfirmed));
    if (ha !== hb) return ha - hb;
    return (a.p.name || '').localeCompare(b.p.name || '');
  }

  /**
   * Sorts property+meta pairs by the given sort key with a deterministic tiebreaker.
   * @param {{ p, m }[]} pairs   - Property+meta pairs
   * @param {string}     sortKey - 'risk' | 'recent' | 'cam' | 'disputes' | 'review'
   * @returns {{ p, m }[]}
   */
  function sortProperties(pairs, sortKey) {
    return [...pairs].sort((a, b) => {
      let primary = 0;
      if (sortKey === 'risk')     primary = (RISK_SCORE[b.m.riskLevel] ?? 0) - (RISK_SCORE[a.m.riskLevel] ?? 0);
      if (sortKey === 'recent')   primary = (b.m.savedAt ? new Date(b.m.savedAt).getTime() : 0) - (a.m.savedAt ? new Date(a.m.savedAt).getTime() : 0);
      if (sortKey === 'cam')      primary = (b.m.total || 0) - (a.m.total || 0);
      if (sortKey === 'disputes') primary = (b.m.openDisputes || 0) - (a.m.openDisputes || 0);
      if (sortKey === 'review')   primary = (b.m.incompleteLeases + b.m.tenantsNeedingReview) - (a.m.incompleteLeases + a.m.tenantsNeedingReview);
      return primary !== 0 ? primary : _propTiebreaker(a, b);
    });
  }

  return {
    REVIEW_STATE_ORDER,
    RDY_LABELS,
    getReviewQueueItems,
    buildPropMeta,
    portfolioKPIs,
    derivePropertyReadiness,
    computePortfolioIntel,
    computeReviewHealth,
    reviewHealthClass,
    propCardBullets,
    sortProperties,
  };
})();
