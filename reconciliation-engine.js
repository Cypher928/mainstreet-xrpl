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

    // ── 3. Property coverage vs pro-rata over-allocation ───────────────────
    //
    // These are two different things and used to share one red flag.
    //
    // UNDER (shares sum below 100%): the leases loaded into MainStreet cover
    // less of the building than its total square footage. That is not an error
    // — a landlord validating on three of twenty leases sees exactly this — and
    // it does not change what any tenant is billed, because each tenant is
    // charged only its own share. Calling it red, saying "expected 100%", and
    // asserting a tenant "may be missing" told the operator their reconciliation
    // was broken when it was complete for the leases they had loaded.
    //
    // OVER (shares sum above 100%): tenants are collectively billed more than
    // the expense pool. That is a genuine money error and stays red.
    {
      const totalPR = results.reduce((s, r) => s + (r.proRataPercent || 0), 0);
      const gap     = parseFloat((100 - totalPR).toFixed(2));
      if (gap > 2) {
        flags.push({
          severity: 'yellow',
          // Presentation contract for the renderer:
          //   kind 'coverage'  → this is about how much of the PROPERTY is
          //                      loaded, not about whether a tenant's number is
          //                      right. It must not be styled as an exception.
          //   disputable false → there is no counterparty. Offering "Open
          //                      Dispute" here used to raise an
          //                      allocation_mismatch dispute against a tenant
          //                      whose allocation is correct.
          kind:       'coverage',
          disputable: false,
          title:    `Coverage gap: loaded leases cover ${totalPR.toFixed(1)}% of the property`,
          detail:   `The leases currently loaded account for ${totalPR.toFixed(2)}% of the property's square footage, leaving ${gap.toFixed(1)}% unallocated. That remainder is either vacant space — whose share of CAM the landlord absorbs — or space under a lease that has not been uploaded yet, in which case that share is recoverable and is missing from this reconciliation. The amounts billed to the tenants above are unaffected: each is charged only its own share.`,
          conditions: [
            `Loaded leases cover: ${totalPR.toFixed(2)}% of the property`,
            `Unallocated: ${gap.toFixed(2)}%`,
            `${results.length} lease${results.length !== 1 ? 's' : ''} in this reconciliation`,
            'Cause not determined: vacant space, or a lease not yet uploaded',
            'Tenant charges are unaffected — each tenant is billed only its own share',
            'To resolve: upload any lease still missing, then re-run the reconciliation',
            'If every lease is loaded, the remainder is vacant and the landlord absorbs its share',
          ],
        });
      } else if (gap < -2) {
        const over = Math.abs(gap);
        flags.push({
          severity: 'red',
          title:    `Pro-rata over-allocation: shares total ${totalPR.toFixed(1)}% of the property`,
          detail:   `The sum of tenant pro-rata shares is ${totalPR.toFixed(2)}%, which exceeds 100%. Tenants are collectively being billed ${over.toFixed(1)}% more than the expense pool. Check for a duplicated tenant or square footage entries that add up to more than the property total.`,
          conditions: [
            `Pro-rata sum: ${totalPR.toFixed(2)}% (must not exceed 100%)`,
            `Over-allocated by: ${over.toFixed(2)}%`,
            `${results.length} lease${results.length !== 1 ? 's' : ''} in this reconciliation`,
            'Check for duplicate tenants or square footage exceeding the property total',
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
        //
        // This finding asks a question; it does not allege an error. Its own text
        // says "verify whether ... is permitted", and until the lease is read
        // nobody knows whether the charge is wrong. It carried an "Open Dispute"
        // button anyway, and openDisputeFromFlag's typeKeyMap does not match this
        // title (/gross-lease/i matches the pure-Gross variant, not "Modified
        // Gross"), so the button raised an UNTYPED dispute against a tenant whose
        // allocation may well be correct.
        //
        // The right next action already exists: "Validate Against Lease" on that
        // tenant's result card (script.js _startLeaseValidation). Point there.
        // The pure-Gross branch below is deliberately left disputable — its text
        // says the charge "may violate lease terms", which is an allegation.
        flags.push({
          severity: 'yellow',
          kind:       'lease_verification',
          disputable: false,
          title:    `Modified Gross tenant receiving shared CAM — ${r.name} (${_fmt(sharedTotal)})`,
          detail:   `${r.name} holds a ${t.lease_type} lease. Modified Gross leases vary — some permit CAM pass-throughs, others bundle expenses into base rent. Verify whether ${_fmt(sharedTotal)} in shared CAM is permitted under this lease's expense provisions. This is a question about the lease, not a finding that the allocation is wrong — use "Validate Against Lease" on ${r.name}'s result card to check the expense provisions.`,
          conditions: [
            `Tenant: ${r.name}`,
            `Lease type: ${t.lease_type}`,
            `Shared CAM charges: ${_fmt(sharedTotal)} across ${sharedInvs.length} invoice${sharedInvs.length !== 1 ? 's' : ''}`,
            'Modified Gross leases may or may not include CAM pass-throughs — verify the lease',
            'Action: run "Validate Against Lease" on this tenant\'s result card',
            'Not a dispute: nothing here shows the allocation is wrong until the lease is read',
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
