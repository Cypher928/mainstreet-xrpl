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

  // Finite numbers only. A lease field that is null, '', 'N/A' or unparseable
  // must read as ABSENT, not as 0 — a 0% stated share would otherwise look like
  // a real figure and raise a conflict against every computed share.
  function _num(v) {
    if (v === null || v === undefined || v === '') return null;
    const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[%,\s]/g, ''));
    return Number.isFinite(n) ? n : null;
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
        // The CAM year being billed, not today — a 2026 reconciliation against a
        // lease that ended in 2003 is the sentence a manager needs to read.
        const camYear   = String(evalDate).slice(0, 4);
        const endYear   = String(t.end_date).slice(0, 4);
        const yearsGone = (Number(camYear) - Number(endYear)) || 0;
        flags.push({
          severity: 'red',
          title:    `${r.name} is being billed ${camYear} CAM on a lease that ended ${t.end_date}`,
          detail:   `This reconciliation allocates ${_fmt(r.totalAllocated)} of ${camYear} CAM to ${r.name}, but the lease on file expired ${t.end_date}` +
                    (yearsGone > 0 ? ` — ${yearsGone} year${yearsGone === 1 ? '' : 's'} before the period being billed` : '') +
                    `. Unless a holdover or renewal extends the CAM obligation, there is no lease on file supporting this charge.`,
          // The whole allocation is at risk: without a current lease there is no
          // documented basis for any of it. This amount previously existed only
          // as prose and never reached the exposure total, which is why the
          // summary could report "no at-risk amounts identified" beside it.
          impact:  { amount: r.totalAllocated, kind: 'at_risk',
                     basis: `Full ${camYear} allocation to ${r.name}; no unexpired lease on file` },
          actions: ['Confirm occupancy', 'Update lease', 'Remove allocation'],
          source:  'Lease record (end_date) vs reconciliation allocation',
          conditions: [
            `Tenant: ${r.name}`,
            `Lease end date: ${t.end_date}`,
            `CAM year billed: ${camYear}`,
            `Allocated amount: ${_fmt(r.totalAllocated)}`,
          ],
        });
      }
    });

    // ── 1b. Pro-rata allocation conflict — lease-stated vs computed ────────
    //
    // Two numbers for the same tenant, from two different sources:
    //   · the proportionate share written in the executed lease
    //   · leased_sqft / property total sqft, which is what CAM was allocated on
    //
    // Nothing previously compared them, so a tenant could display 22.25% on the
    // card while a clause check quoted 18.54% from the lease, with no finding
    // raised. The AI validator cannot catch it either — it is never given the
    // computed share (see api/_validate-lease-contract.js buildClausePrompt).
    //
    // FLAG BOTH, ASSERT NEITHER. Which figure governs depends on the lease's
    // allocation methodology, and that is a contractual question this engine has
    // no basis to settle. A fixed proportionate share may control regardless of
    // remeasurement; equally, the lease figure may be stale after a remeasure.
    // Declaring either one correct would manufacture an over- or under-recovery
    // finding out of an unresolved question — so the impact is 'under_review',
    // never 'at_risk', and the difference is stated in percentage points rather
    // than converted into a dollar loss.
    results.forEach(r => {
      const t = tenants.find(t => t.id === r.tenantId);
      const stated   = _num(t && (t.pro_rata_share ?? t.proportionate_share ?? t.pro_rata_percent));
      const computed = _num(r.proRataPercent != null ? r.proRataPercent
                            : (r.proRata != null ? r.proRata * 100 : null));
      if (stated === null || computed === null) return;

      // 0.10pp tolerance absorbs rounding in the lease text and in display.
      const diff = Math.abs(stated - computed);
      if (diff <= 0.10) return;

      // Both readings of the same pool, so the manager can see the size of the
      // question without being told which answer is right.
      const pool      = _num(r.totalAllocated != null && computed
        ? (r.totalAllocated / (computed / 100)) : null);
      const atStated  = pool != null ? pool * (stated / 100) : null;
      const spread    = (atStated != null && r.totalAllocated != null)
        ? Math.abs(r.totalAllocated - atStated) : null;

      flags.push({
        severity: 'yellow',
        title:    `Pro-rata allocation conflict — ${r.name}`,
        detail:   `Lease-stated proportionate share differs from the square-footage-derived allocation. ` +
                  `Verify the executed lease and applicable allocation methodology before billing.`,
        impact:   { amount: spread, kind: 'under_review', scope: `tenant:${r.name}`,
                    basis: 'Difference between the two methodologies. Not a confirmed over- or under-recovery — ' +
                           'which figure governs is unresolved.' },
        // Two sources disagree about one field. Carried explicitly so surfaces
        // that summarise a tenant's data quality can say CONFLICT rather than
        // fall through to INFERRED, which would report a known disagreement as
        // a mere absence of citation.
        conflict: { tenant: r.name, field: 'pro_rata_share',
                    sources: ['Lease document (stated proportionate share)',
                              'Computed (leased sqft ÷ property sqft)'] },
        actions:  ['Review lease clause', 'Confirm allocation methodology',
                   'Update tenant allocation if verified', 'Re-run reconciliation'],
        source:   'Lease-stated share (lease document) vs computed share (leased sqft ÷ property sqft)',
        conditions: [
          `Tenant: ${r.name}`,
          `Lease-stated proportionate share: ${stated.toFixed(2)}%`,
          `Computed square-footage share: ${computed.toFixed(2)}%`,
          `Difference: ${diff.toFixed(2)} percentage points`,
          spread != null
            ? `Allocation differs by ${_fmt(spread)} between the two methodologies`
            : 'Dollar difference could not be computed from the available figures',
          'Potential impact: allocation may over- or under-recover depending on which contractual methodology governs.',
          'MainStreet does not assert which figure is controlling. Confirm against the executed lease.',
        ],
      });
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
