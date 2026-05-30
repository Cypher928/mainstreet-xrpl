/**
 * allocation-integrity.js
 * Pure financial invariant validation — no DOM access, no global state, no side effects.
 * All functions: same input → same output.
 *
 * Exposes: window.AllocationIntegrity
 */
window.AllocationIntegrity = (() => {
  'use strict';

  // ±0.01% is acceptable floating-point drift from pro-rata math
  const BALANCE_TOLERANCE = 0.01;

  // ── validateAllocationSet ─────────────────────────────────────────────────

  /**
   * Validates a complete allocation set and returns a canonical result.
   * @param {Array<{ tenantId, tenantName, percent, amount }>} allocations
   * @returns {{ totalPercent, totalAmount, isBalanced, issues, normalizedAllocations }}
   */
  function validateAllocationSet(allocations) {
    const safe = Array.isArray(allocations) ? allocations : [];
    const issues = deduplicateIssues(detectAllocationAnomalies(safe));

    let totalPercent = 0;
    let totalAmount  = 0;
    let hasNaN       = false;

    safe.forEach(a => {
      const pct = parseFloat(a.percent);
      const amt = parseFloat(a.amount);
      if (!isFinite(pct) || isNaN(pct)) { hasNaN = true; }
      else totalPercent += pct;
      if (!isFinite(amt) || isNaN(amt)) { hasNaN = true; }
      else totalAmount += amt;
    });

    totalPercent = parseFloat(totalPercent.toFixed(6));
    totalAmount  = parseFloat(totalAmount.toFixed(2));

    const isBalanced = !hasNaN && Math.abs(100 - totalPercent) <= BALANCE_TOLERANCE;

    return {
      totalPercent,
      totalAmount,
      isBalanced,
      issues,
      normalizedAllocations: normalizeAllocationPrecision(safe, totalAmount),
    };
  }

  // ── normalizeAllocationPrecision ──────────────────────────────────────────

  /**
   * Largest Remainder Method: ensures displayed amounts and percentages are
   * rounded deterministically so their sums equal targetTotal and 100.00
   * exactly. Internal high-precision values are preserved on each allocation.
   *
   * Returns a new array — does not mutate input. Same input → same output.
   *
   * @param {Array}  allocations  - allocation entries with .percent and .amount
   * @param {number} targetTotal  - the exact pool total to distribute
   * @returns {Array} normalized entries with displayAmount and displayPercent added
   */
  function normalizeAllocationPrecision(allocations, targetTotal) {
    if (!Array.isArray(allocations) || !allocations.length) return [];

    const total = parseFloat(targetTotal) || 0;
    const CENTS = 100; // 2 decimal places

    // ── Amount normalization (Largest Remainder Method) ──
    const withExact = allocations.map(a => {
      const pct  = parseFloat(a.percent) || 0;
      const exact = (pct / 100) * total;
      const fl    = Math.floor(exact * CENTS) / CENTS;
      return { ...a, _exactAmt: exact, _flAmt: fl, _remAmt: exact - fl };
    });

    const flSumAmt  = withExact.reduce((s, a) => s + a._flAmt, 0);
    const deficitAmt = parseFloat((total - flSumAmt).toFixed(2));
    const pennies    = Math.round(deficitAmt * CENTS);

    const byRemAmt = [...withExact]
      .sort((a, b) => b._remAmt - a._remAmt || a.tenantId?.localeCompare(b.tenantId ?? '') || 0)
      .map((a, i) => ({ _ref: a, _bump: i < pennies }));

    const bumpSet = new Set(byRemAmt.filter(x => x._bump).map(x => x._ref));

    const withAmt = withExact.map(a => ({
      ...a,
      displayAmount: parseFloat((bumpSet.has(a) ? a._flAmt + 1 / CENTS : a._flAmt).toFixed(2)),
    }));

    // ── Percent normalization (Largest Remainder Method, 2 dp) ──
    const PCT_SCALE = 10000; // 2 decimal places in percent
    const withFlPct = withAmt.map(a => {
      const pct = parseFloat(a.percent) || 0;
      const fl  = Math.floor(pct * 100) / 100;
      return { ...a, _flPct: fl, _remPct: pct - fl };
    });

    const flSumPct    = withFlPct.reduce((s, a) => s + a._flPct, 0);
    const deficitPct  = parseFloat((100 - flSumPct).toFixed(2));
    const pctPennies  = Math.round(deficitPct * 100); // hundredths of a percent

    const byRemPct = [...withFlPct]
      .sort((a, b) => b._remPct - a._remPct || a.tenantId?.localeCompare(b.tenantId ?? '') || 0)
      .map((a, i) => ({ _ref: a, _bump: i < pctPennies }));

    const bumpPctSet = new Set(byRemPct.filter(x => x._bump).map(x => x._ref));

    return withFlPct.map(a => ({
      tenantId:       a.tenantId,
      tenantName:     a.tenantName,
      percent:        a.percent,        // original high-precision value
      amount:         a.amount,         // original high-precision value
      displayPercent: parseFloat((bumpPctSet.has(a) ? a._flPct + 0.01 : a._flPct).toFixed(2)),
      displayAmount:  (withAmt.find(w => w === a) || a).displayAmount ?? parseFloat((a.amount || 0).toFixed(2)),
    }));
  }

  // ── detectAllocationAnomalies ─────────────────────────────────────────────

  /**
   * Detects structural and mathematical anomalies in an allocation set.
   * Returns an array of issues — empty array means no anomalies found.
   *
   * @param {Array} allocations
   * @returns {Array<{ type, severity, tenantId, message }>}
   */
  function detectAllocationAnomalies(allocations) {
    const issues = [];
    if (!Array.isArray(allocations)) return issues;

    let totalPct = 0;
    const seenIds = new Set();

    allocations.forEach(a => {
      const pct = parseFloat(a.percent);
      const amt = parseFloat(a.amount);
      const tid = a.tenantId ?? null;
      const who = a.tenantName || tid || '(unknown)';

      if (!isFinite(pct) || isNaN(pct)) {
        issues.push({ type: 'nan_percent', severity: 'critical', tenantId: tid,
          message: `${who}: non-numeric percent value` });
        return; // can't add to totalPct safely
      }
      if (!isFinite(amt) || isNaN(amt)) {
        issues.push({ type: 'nan_amount', severity: 'critical', tenantId: tid,
          message: `${who}: non-numeric allocation amount` });
      }

      if (pct < 0) {
        issues.push({ type: 'negative_percent', severity: 'critical', tenantId: tid,
          message: `${who}: negative allocation percent (${pct.toFixed(4)}%)` });
      }
      if (isFinite(amt) && amt < 0) {
        issues.push({ type: 'negative_amount', severity: 'critical', tenantId: tid,
          message: `${who}: negative allocation amount (${amt.toFixed(2)})` });
      }

      // Zero pro-rata basis with non-zero allocation
      if (pct === 0 && isFinite(amt) && amt !== 0) {
        issues.push({ type: 'zero_basis_allocation', severity: 'warning', tenantId: tid,
          message: `${who}: zero pro-rata basis but non-zero amount (${amt.toFixed(2)})` });
      }

      // Duplicate tenant in pool
      if (tid !== null) {
        if (seenIds.has(tid)) {
          issues.push({ type: 'duplicate_tenant', severity: 'critical', tenantId: tid,
            message: `${who}: appears more than once in allocation set` });
        }
        seenIds.add(tid);
      }

      totalPct += pct;
    });

    // Pool-level checks
    if (allocations.length > 0) {
      if (totalPct > 100 + BALANCE_TOLERANCE) {
        issues.push({ type: 'over_allocation', severity: 'critical', tenantId: null,
          message: `Total allocation ${totalPct.toFixed(4)}% exceeds 100% — pro-rata math error` });
      } else if (totalPct < 100 - 2) {
        // >2% gap is a warning (ReconciliationEngine flags at >2%, red at >5%)
        issues.push({ type: 'under_allocation', severity: 'warning', tenantId: null,
          message: `Total allocation ${totalPct.toFixed(4)}% — ${(100 - totalPct).toFixed(2)}% of pool unallocated` });
      }
    }

    return issues;
  }

  // ── buildAllocationExplanation ────────────────────────────────────────────

  /**
   * Produces a plain-English explanation of the allocation run for UI/report use.
   *
   * @param {Array}  allocations
   * @param {object} context  - { method?, excludedCount?, normalizationApplied?, gap? }
   * @returns {string}
   */
  function buildAllocationExplanation(allocations, context = {}) {
    if (!Array.isArray(allocations) || !allocations.length) {
      return 'No tenants in allocation pool.';
    }
    const n        = allocations.length;
    const method   = context.method        || 'leased square footage';
    const excluded = context.excludedCount || 0;
    const normApplied = context.normalizationApplied || false;

    const totalPct = allocations.reduce((s, a) => s + (parseFloat(a.percent) || 0), 0);
    const gap      = parseFloat((100 - totalPct).toFixed(4));

    const parts = [
      `CAM distributed by ${method} across ${n} active tenant${n !== 1 ? 's' : ''}.`,
    ];
    if (excluded > 0) {
      parts.push(`${excluded} tenant${excluded !== 1 ? 's' : ''} excluded (inactive lease period).`);
    }
    if (normApplied && Math.abs(gap) > 0) {
      parts.push(`Rounding normalization applied (${gap > 0 ? '+' : ''}${Math.abs(gap).toFixed(2)}% adjustment).`);
    } else if (!normApplied && Math.abs(gap) > BALANCE_TOLERANCE) {
      parts.push(`Pro-rata gap of ${Math.abs(gap).toFixed(2)}% detected — verify square footage totals.`);
    }

    return parts.join(' ');
  }

  // ── buildIntegritySummary ─────────────────────────────────────────────────

  /**
   * Produces the canonical reconciliation integrity summary object.
   * This is the primary output consumed by the reconciliation summary panel.
   *
   * @param {Array}  allocations
   * @param {object} context     - passed through to buildAllocationExplanation
   * @returns {{ balanced, totalPercent, totalAmount, criticalIssueCount,
   *             warningCount, normalizationApplied, issues,
   *             normalizedAllocations, explainability }}
   */
  function buildIntegritySummary(allocations, context = {}) {
    const validation = validateAllocationSet(allocations);

    const criticalIssues = validation.issues.filter(i => i.severity === 'critical');
    const warningIssues  = validation.issues.filter(i => i.severity === 'warning');

    // Normalization is applicable when: small gap, no critical issues, not already balanced
    const gap = Math.abs(100 - validation.totalPercent);
    const normalizationApplied = !validation.isBalanced && gap > 0 && gap < 2 &&
      criticalIssues.length === 0;

    return {
      balanced:              validation.isBalanced,
      totalPercent:          validation.totalPercent,
      totalAmount:           validation.totalAmount,
      criticalIssueCount:    criticalIssues.length,
      warningCount:          warningIssues.length,
      normalizationApplied,
      issues:                validation.issues,
      normalizedAllocations: validation.normalizedAllocations,
      explainability:        buildAllocationExplanation(
        allocations,
        { ...context, normalizationApplied, gap }
      ),
    };
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  function deduplicateIssues(issues) {
    const seen = new Set();
    return issues.filter(issue => {
      const key = `${issue.type}:${issue.tenantId ?? '__pool__'}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  return {
    BALANCE_TOLERANCE,
    validateAllocationSet,
    normalizeAllocationPrecision,
    detectAllocationAnomalies,
    buildAllocationExplanation,
    buildIntegritySummary,
  };
})();
