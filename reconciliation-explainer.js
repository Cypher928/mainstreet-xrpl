/**
 * reconciliation-explainer.js
 * Pure narrative generation for reconciliation results — no DOM, no global state.
 * All functions: same input → same output (deterministic templates only).
 *
 * Exposes: window.ReconciliationExplainer
 */
window.ReconciliationExplainer = (() => {
  'use strict';

  // ── Internal formatter (mirrors script.js fmt, no dependency) ─────────────
  function _fmtUSD(n) {
    return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  // ── Warning code → actionable narrative ───────────────────────────────────
  const _WARNING_NARRATIVES = {
    SQFT_OVERFLOW:
      'Total leased square footage exceeds the property total, which may cause over-allocation. ' +
      'Verify tenant square footage entries and correct the total before issuing statements.',
    SQFT_APPROXIMATE:
      'Square footage could not be confirmed from the lease document. The pro-rata allocation is ' +
      'approximate — enter the correct leased square footage in Section 2 to produce a verified result.',
    BASE_YEAR_MISMATCH:
      'One or more invoices predate the lease start date, which may indicate incorrect CAM charges. ' +
      'Verify invoice dates and confirm the applicable CAM period.',
    NNN_GROSS_UNKNOWN:
      'Lease type (NNN vs. Gross) could not be determined, which affects how expenses are allocated. ' +
      'Set the lease type in Section 2 to ensure correct treatment of shared expenses.',
  };

  /**
   * Builds a per-tenant allocation narrative sentence-group.
   *
   * @param {object} tenant
   *   { tenantName|name, sqFt, proRataPercent, capApplied, capAdjustment, totalAllocated }
   * @param {object} [context]
   *   { method, totalSqFt, normalizationApplied, normalizationDelta }
   * @returns {string}
   */
  function buildAllocationNarrative(tenant, context) {
    const method = (context && context.method) ? context.method : 'leased square footage';
    const parts  = [];

    parts.push('Allocation based on ' + method + '.');

    const sqFt      = tenant && (tenant.sqFt || tenant.leasedSqft);
    const totalSqFt = context && context.totalSqFt;

    if (sqFt && totalSqFt && totalSqFt > 0) {
      const pct = tenant.proRataPercent != null
        ? parseFloat(tenant.proRataPercent).toFixed(2)
        : ((sqFt / totalSqFt) * 100).toFixed(2);
      parts.push(
        'Tenant occupies ' + Number(sqFt).toLocaleString() + ' sqft of ' +
        Number(totalSqFt).toLocaleString() + ' total occupied sqft (' + pct + '%).'
      );
    }

    if (tenant && tenant.capApplied && tenant.capAdjustment != null) {
      parts.push(
        'CAM cap applied — allocation reduced by ' + _fmtUSD(tenant.capAdjustment) +
        ' to comply with lease cap.'
      );
    }

    if (context && context.normalizationApplied && context.normalizationDelta != null) {
      const delta = parseFloat(context.normalizationDelta);
      const sign  = delta >= 0 ? '+' : '';
      parts.push(
        'Allocation normalized by ' + sign + delta.toFixed(4) + '% to preserve balanced totals.'
      );
    }

    return parts.join(' ');
  }

  /**
   * Builds an exclusion reason narrative.
   *
   * @param {'inactive_lease'|'lease_clause'|'zero_sqft'|'missing_basis'|string} reason
   * @param {string} [detail]  Category names for 'lease_clause'; tenant name for others.
   * @returns {string}
   */
  function buildExclusionNarrative(reason, detail) {
    switch (reason) {
      case 'inactive_lease':
        return 'Tenant excluded: lease term has ended. Confirm occupancy before including in reconciliation.';
      case 'lease_clause':
        return detail
          ? 'Tenant excluded by lease clause: ' + detail + ' are excluded from this tenant\'s CAM pool.'
          : 'Tenant excluded by lease clause. Review excluded categories in tenant settings.';
      case 'zero_sqft':
        return 'Tenant excluded: no square footage on record. Enter leased square footage in Section 2 to include.';
      case 'missing_basis':
        return 'Tenant excluded: insufficient data to calculate pro-rata basis.';
      default:
        return 'Tenant excluded from this reconciliation run.';
    }
  }

  /**
   * Builds an actionable narrative string for a single ambiguity flag.
   *
   * @param {{ code: string, message: string, explanation: string }} issue
   * @returns {string}
   */
  function buildWarningNarrative(issue) {
    if (!issue) return '';
    if (issue.code && _WARNING_NARRATIVES[issue.code]) {
      return _WARNING_NARRATIVES[issue.code];
    }
    return issue.explanation || issue.message || '';
  }

  /**
   * Builds a full-sentence paragraph describing the reconciliation result.
   *
   * @param {object} result  ReconciliationResult-shaped object
   * @param {object} [tenant] Matching tenant record (for lease_type)
   * @returns {string}
   */
  function buildReconciliationSummaryNarrative(result, tenant) {
    if (!result) return '';

    const name   = result.tenantName || result.name || 'Tenant';
    const sqFt   = result.sqFt;
    const pct    = result.proRataPercent != null ? parseFloat(result.proRataPercent).toFixed(2) : null;
    const amount = result.totalAllocated != null ? result.totalAllocated : result.allocatedAmount;
    const lt     = (tenant && tenant.lease_type) ? tenant.lease_type : null;
    const flags  = result.ambiguityFlags || [];
    const parts  = [];

    // Opening — tenant identity and lease type
    if (lt && sqFt && pct) {
      parts.push(
        name + ' holds a ' + lt + ' lease occupying ' +
        Number(sqFt).toLocaleString() + ' sqft (' + pct + '% of property).'
      );
    } else if (sqFt && pct) {
      parts.push(name + ' occupies ' + Number(sqFt).toLocaleString() + ' sqft (' + pct + '% of property).');
    } else {
      parts.push(name + ' is included in this reconciliation.');
    }

    // Allocation amount
    if (amount != null && !isNaN(amount)) {
      parts.push('This reconciliation allocated ' + _fmtUSD(amount) + ' based on pro-rata share.');
    }

    // Cap
    if (result.capApplied && result.capAdjustment != null) {
      parts.push('A CAM cap reduced the gross allocation by ' + _fmtUSD(result.capAdjustment) + '.');
    }

    // Data quality flags
    if (flags.length === 1) {
      parts.push('One data quality issue requires attention before this result should be considered final.');
    } else if (flags.length > 1) {
      parts.push(
        flags.length + ' data quality issues require attention before this result should be considered final.'
      );
    }

    return parts.join(' ');
  }

  /**
   * Assembles the full explainability object for one reconciliation result.
   *
   * @param {object}  result   ReconciliationResult-shaped object
   * @param {object}  [tenant] Matching tenantData entry (for lease_type, excluded_categories)
   * @param {object}  [context] { method, totalSqFt, normalizationApplied, normalizationDelta }
   * @returns {{ explanations: { allocation, exclusions, warnings, normalization, summary } }}
   */
  function buildExplainability(result, tenant, context) {
    // Allocation narrative
    const alloc = buildAllocationNarrative(
      {
        tenantName:     result ? (result.tenantName || result.name) : '',
        sqFt:           result ? result.sqFt : null,
        proRataPercent: result ? result.proRataPercent : null,
        capApplied:     result ? result.capApplied : false,
        capAdjustment:  result ? result.capAdjustment : null,
        totalAllocated: result ? result.totalAllocated : null,
      },
      context || {}
    );

    // Warning narratives — deduped by exact text
    const rawWarnings = (result && result.ambiguityFlags ? result.ambiguityFlags : [])
      .map(f => buildWarningNarrative(f));
    const seenW = new Set();
    const warnings = rawWarnings.filter(w => {
      if (!w || seenW.has(w)) return false;
      seenW.add(w);
      return true;
    });

    // Exclusion narratives from excluded_categories
    const exclusions = [];
    const rawCats = tenant && tenant.excluded_categories ? tenant.excluded_categories : null;
    if (rawCats) {
      const cats = Array.isArray(rawCats)
        ? rawCats.filter(Boolean)
        : rawCats.split(',').map(s => s.trim()).filter(Boolean);
      if (cats.length) {
        exclusions.push(buildExclusionNarrative('lease_clause', cats.join(', ')));
      }
    }

    // Normalization — only present when actually applied
    const normalization = (context && context.normalizationApplied && context.normalizationDelta != null)
      ? 'Pro-rata shares were normalized by ' +
        (context.normalizationDelta >= 0 ? '+' : '') +
        Math.abs(parseFloat(context.normalizationDelta)).toFixed(4) +
        '% to ensure allocations sum to exactly 100%.'
      : null;

    // Summary paragraph
    const summary = buildReconciliationSummaryNarrative(result, tenant);

    return {
      explanations: {
        allocation:   alloc,
        exclusions,
        warnings,
        normalization,
        summary,
      },
    };
  }

  return {
    buildAllocationNarrative,
    buildExclusionNarrative,
    buildWarningNarrative,
    buildReconciliationSummaryNarrative,
    buildExplainability,
  };
})();
