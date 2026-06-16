/**
 * reconciliation-engine.js
 * Pure reconciliation validation — no DOM access, no global state, no side effects.
 * All functions: same input → same output.
 *
 * Exposes: window.ReconciliationEngine
 */
window.ReconciliationEngine = (() => {
  'use strict';

  // Local formatter — mirrors script.js fmt() to keep the engine self-contained.
  function _fmt(n) {
    return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  /**
   * Derives the calculation state badge for a single reconciliation result.
   * @param {object} result - ReconciliationResult
   * @param {object} liveT  - The matching tenant record (for confidence/type checks)
   * @returns {{ state, label, cls }}
   */
  function deriveCalcState(result, liveT) {
    const codes = (result?.ambiguityFlags || []).map(f => f.code);
    if (codes.includes('NNN_GROSS_UNKNOWN') || codes.includes('SQFT_APPROXIMATE')) {
      return { state: 'missing_inputs', label: 'Missing Inputs', cls: 'cs-missing' };
    }
    if (codes.includes('SQFT_OVERFLOW') || codes.includes('BASE_YEAR_MISMATCH')) {
      return { state: 'partial', label: 'Partial', cls: 'cs-partial' };
    }
    const sqftConf   = parseFloat(liveT?.confidence?.leased_sqft ?? liveT?.confidence?.leasedSqft ?? 100);
    const hasType    = !!(liveT?.lease_type);
    const docHasType = liveT?.doc_has_lease_type !== false;
    if (sqftConf < 70 || !hasType || !docHasType) {
      return { state: 'estimated', label: 'Estimated', cls: 'cs-estimated' };
    }
    return { state: 'verified', label: 'Verified', cls: 'cs-verified' };
  }

  /**
   * Detects structural reconciliation issues: expired leases, cap violations,
   * pro-rata gaps, and gross-lease CAM charges.
   *
   * @param {Array}  results        - ReconciliationResult[]
   * @param {object} property       - Property object with .tenants[]
   * @param {string} evaluationDate - ISO date string (YYYY-MM-DD). Callers pass
   *                                  `${getCamYear()}-12-31` for deterministic output.
   *                                  Defaults to current year end when omitted.
   * @returns {Array<{ severity, title, detail, conditions[] }>}
   */
  function detectReconciliationIssues(results, property, evaluationDate) {
    const flags   = [];
    if (!results || !results.length) return flags;
    const evalDate = evaluationDate || `${new Date().getFullYear()}-12-31`;
    const tenants  = Array.isArray(property?.tenants) ? property.tenants.filter(Boolean) : [];

    // ── 1. Expired lease receiving CAM allocation ──────────────────────────
    results.forEach(r => {
      const t = tenants.find(t => t.id === r.tenantId);
      if (t?.end_date && t.end_date < evalDate && r.totalAllocated > 0) {
        flags.push({
          severity: 'red',
          title:    `Expired lease receiving allocation — ${r.name} (ended ${t.end_date})`,
          detail:   `${r.name}'s lease ended ${t.end_date}, but this reconciliation allocates ${_fmt(r.totalAllocated)} to them. Confirm occupancy or remove this tenant before issuing statements.`,
          conditions: [
            `Tenant: ${r.name}`,
            `Lease end date: ${t.end_date}`,
            `Allocated amount: ${_fmt(r.totalAllocated)}`,
            'Action: confirm occupancy status or exclude from this reconciliation',
          ],
        });
      }
    });

    // ── 2. Cap applied — document and verify source ────────────────────────
    results.forEach(r => {
      if (!r.capApplied || !r.capAdjustment) return;
      const t   = tenants.find(t => t.id === r.tenantId);
      const src = t?.doc_has_lease_type !== false ? 'lease document' : 'manual entry';
      flags.push({
        severity: 'yellow',
        title:    `Cap applied to ${r.name} — ${_fmt(r.capAdjustment)} reduction (source: ${src})`,
        detail:   `CAM cap triggered for ${r.name}. Raw allocation was ${_fmt(r.totalAllocated + r.capAdjustment)}, reduced by ${_fmt(r.capAdjustment)} to ${_fmt(r.totalAllocated)}. Confirm cap percentage and base amount are documented in the lease.`,
        conditions: [
          `Tenant: ${r.name}`,
          `Raw allocation: ${_fmt(r.totalAllocated + r.capAdjustment)}`,
          `Cap reduction: −${_fmt(r.capAdjustment)}`,
          `Final charge: ${_fmt(r.totalAllocated)}`,
          `Cap source: ${src}`,
        ],
      });
    });

    // ── 3. Pro-rata coverage gap ───────────────────────────────────────────
    {
      const totalPR = results.reduce((s, r) => s + (r.proRataPercent || 0), 0);
      const gap     = parseFloat((100 - totalPR).toFixed(2));
      if (Math.abs(gap) > 2) {
        const dir = gap > 0 ? 'under-allocated' : 'over-allocated';
        flags.push({
          severity: Math.abs(gap) > 5 ? 'red' : 'yellow',
          title:    `Pro-rata coverage gap: ${gap > 0 ? '+' : ''}${gap.toFixed(1)}% — pool is ${dir}`,
          detail:   `The sum of all tenant pro-rata shares is ${totalPR.toFixed(2)}% (expected 100%). A ${Math.abs(gap).toFixed(1)}% gap suggests a tenant may be missing from the reconciliation or square footage data needs correction.`,
          conditions: [
            `Pro-rata sum: ${totalPR.toFixed(2)}%`,
            `Gap: ${gap > 0 ? '+' : ''}${gap.toFixed(2)}%`,
            `${results.length} tenant${results.length !== 1 ? 's' : ''} in reconciliation`,
            'Verify all tenants are included and square footage is correct',
          ],
        });
      }
    }

    // ── 4. Gross / Modified Gross tenant receiving shared CAM ──────────────
    results.forEach(r => {
      const t = tenants.find(t => t.id === r.tenantId);
      if (!t) return;
      const lt = (t.lease_type || '').toLowerCase();
      const isGross    = /^gross$/i.test(lt.trim()) || /full\s*service/i.test(lt);
      const isModGross = /modified\s*gross/i.test(lt);
      if (!isGross && !isModGross) return;
      const sharedInvs  = (r.includedInvoices || []).filter(i => i.allocation === 'shared');
      if (!sharedInvs.length) return;
      const sharedTotal = sharedInvs.reduce((s, i) => s + (i.share || 0), 0);
      if (isModGross) {
        // Modified Gross leases vary — some permit CAM pass-throughs, others do not.
        flags.push({
          severity: 'yellow',
          title:    `Modified Gross tenant receiving shared CAM — ${r.name} (${_fmt(sharedTotal)})`,
          detail:   `${r.name} holds a ${t.lease_type} lease. Modified Gross leases vary — some permit CAM pass-throughs, others bundle expenses into base rent. Verify whether ${_fmt(sharedTotal)} in shared CAM is permitted under this lease's expense provisions.`,
          conditions: [
            `Tenant: ${r.name}`,
            `Lease type: ${t.lease_type}`,
            `Shared CAM charges: ${_fmt(sharedTotal)} across ${sharedInvs.length} invoice${sharedInvs.length !== 1 ? 's' : ''}`,
            'Modified Gross leases may or may not include CAM pass-throughs — verify the lease',
            'Action: confirm expense pass-through provisions in the lease agreement',
          ],
        });
      } else {
        flags.push({
          severity: 'yellow',
          title:    `Gross-lease tenant receiving shared CAM — ${r.name} (${_fmt(sharedTotal)})`,
          detail:   `${r.name} holds a ${t.lease_type} lease, which typically bundles operating expenses into base rent. Charging ${_fmt(sharedTotal)} in shared CAM may violate lease terms. Review exclusion clauses.`,
          conditions: [
            `Tenant: ${r.name}`,
            `Lease type: ${t.lease_type}`,
            `Shared CAM charges: ${_fmt(sharedTotal)} across ${sharedInvs.length} invoice${sharedInvs.length !== 1 ? 's' : ''}`,
            'Gross leases typically include all operating expenses in base rent',
            'Action: confirm excluded categories or add this tenant to the NNN pool only',
          ],
        });
      }
    });

    return flags;
  }

  return { deriveCalcState, detectReconciliationIssues };
})();
