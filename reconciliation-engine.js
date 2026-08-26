/**
 * reconciliation-engine.js
 * Pure reconciliation validation — no DOM access, no global state, no side effects.
 * All functions: same input → same output.
 *
 * Exposes: window.ReconciliationEngine
 */
window.ReconciliationEngine = (() => {
  'use strict';

  // WHERE A LEASE TERM SITS RELATIVE TO THE CAM PERIOD — resolved, never
  // re-derived. Resolved at call time rather than at load so the engine does not
  // depend on script tag order, and via `require` as well so the Node suites
  // that evaluate this file in a bare `{window:{}}` sandbox reach the real
  // module instead of a stub.
  //
  // Returns null if it cannot be found, and every caller treats null as "raise
  // nothing" rather than falling back to a private copy of the date rule. A
  // second copy of that rule is exactly what this module exists to remove; a
  // missing module is a load-order bug to fix, not a case to quietly handle.
  function _leasePeriod() {
    if (typeof window !== 'undefined' && window.LeasePeriod) return window.LeasePeriod;
    if (typeof require === 'function') { try { return require('./lease-period.js'); } catch (_) {} }
    return null;
  }

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
    // THESE LABELS DESCRIBE THE CALCULATION, NOT THE TENANT.
    //
    // A bare "Verified" sat in the row beside Dover's allocation while Dover was
    // a RED critical exception for a lease that expired in 2016. Both were true
    // about different questions — the arithmetic used sound inputs; the lease
    // does not support billing them — but one word in the row next to the dollar
    // figure reads as "this tenant is fine". Naming the object of the verb costs
    // nothing and removes the reading entirely.
    if (codes.includes('NNN_GROSS_UNKNOWN') || codes.includes('SQFT_APPROXIMATE')) {
      return { state: 'missing_inputs', label: 'Inputs missing', cls: 'cs-missing' };
    }
    if (codes.includes('SQFT_OVERFLOW') || codes.includes('BASE_YEAR_MISMATCH')) {
      return { state: 'partial', label: 'Calc partial', cls: 'cs-partial' };
    }
    const sqftConf   = parseFloat(liveT?.confidence?.leased_sqft ?? liveT?.confidence?.leasedSqft ?? 100);
    const hasType    = !!(liveT?.lease_type);
    const docHasType = liveT?.doc_has_lease_type !== false;
    if (sqftConf < 70 || !hasType || !docHasType) {
      return { state: 'estimated', label: 'Calc estimated', cls: 'cs-estimated' };
    }
    return { state: 'verified', label: 'Calc verified', cls: 'cs-verified' };
  }

  /**
   * Detects structural reconciliation issues: expired leases, cap violations,
   * pro-rata gaps, and gross-lease CAM charges.
   *
   * @param {Array}  results        - ReconciliationResult[]
   * @param {object} property       - Property object with .tenants[]
   * @param {string|object} evaluationDate - the CAM PERIOD. A date string is read
   *                                  as the period end with 1 January of that year
   *                                  as the start; callers pass
   *                                  `${getCamYear()}-12-31`. A {start,end} object
   *                                  passes through, which is how a fiscal CAM
   *                                  period arrives. Defaults to current year end.
   * @returns {Array<{ severity, title, detail, conditions[] }>}
   */
  function detectReconciliationIssues(results, property, evaluationDate) {
    const flags   = [];
    if (!results || !results.length) return flags;
    const evalDate = evaluationDate || `${new Date().getFullYear()}-12-31`;
    const tenants  = Array.isArray(property?.tenants) ? property.tenants.filter(Boolean) : [];

    // ── 1. Lease term vs the CAM period being billed ───────────────────────
    //
    // WAS `t.end_date < evalDate`: one endpoint standing in for a question about
    // two intervals. It called an ordinary expiry five days away "a lease that
    // ended", blocked it, and said nothing at all about a lease that COMMENCED
    // mid-period — which was billed all twelve months and marked Calc verified.
    // The classification is now read from lease-period.js rather than re-derived
    // here, so the detector and every other surface answer from one definition.
    //
    // NOTHING HERE CHANGES AN ALLOCATION. Whether a partial period should be
    // billed in full or apportioned — and by days, by months, or by the lease's
    // own commencement and surrender language — is an open product question.
    // Until it is decided, these findings ask for a confirmation; they do not
    // assert that the charge is wrong, and they carry no apportioned amount,
    // because a figure here would settle the question by accident.
    const LP = _leasePeriod();
    const period  = LP && LP.periodFrom(evalDate);
    const camYear = period ? String(period.end).slice(0, 4) : String(evalDate).slice(0, 4);

    results.forEach(r => {
      const t = tenants.find(t => t.id === r.tenantId);
      if (!t || !(r.totalAllocated > 0) || !LP || !period) return;
      const c = LP.classify(t, period);
      if (!c.needsOccupancyConfirmation) return;

      // Remedies differ by case, and offering the wrong one is its own defect.
      // "Remove allocation" is a real answer for a tenant who vacated before the
      // period; it is bad advice for a lease that simply began in September,
      // where the tenant does owe something and the open question is how much.
      const base = {
        source: 'Lease term (start_date, end_date) vs the CAM period being billed',
      };
      // The amount line has to say whether it WAS apportioned. Since T2 that
      // differs by case — a holdover's allocation is un-apportioned and a
      // partial period's is — and a fixed parenthetical would be false on one
      // of them.
      const cond = (extra, note) => [
        `Tenant: ${r.name}`,
        `CAM period billed: ${period.start} to ${period.end}`,
        ...extra,
        `Allocated amount: ${_fmt(r.totalAllocated)}${note ? ` (${note})` : ''}`,
      ];
      const UNAPPORTIONED = 'full period — not apportioned';

      // ── The lease ended before the period began: a holdover, or a vacancy.
      // The file cannot tell which, and the money genuinely has no documented
      // basis, so this stays red and stays quantified. The wording no longer
      // concludes against the charge — a holdover very often does extend the
      // obligation — it asks for the confirmation that would settle it.
      if (c.case === 'ended_before') {
        const endYear   = String(c.leaseEnd).slice(0, 4);
        const yearsGone = (Number(camYear) - Number(endYear)) || 0;
        flags.push(Object.assign({
          severity: 'red',
          title:    `${r.name} is being billed ${camYear} CAM on a lease that ended ${c.leaseEnd}`,
          detail:   `This reconciliation allocates ${_fmt(r.totalAllocated)} of ${camYear} CAM to ${r.name}. The lease on file ran to ${c.leaseEnd}` +
                    (yearsGone > 0 ? `, ${yearsGone} year${yearsGone === 1 ? '' : 's'} before the period being billed` : '') +
                    `, so the file does not by itself establish a CAM obligation for ${period.start} to ${period.end}. That is a documentation question, not a finding that the charge is wrong: a holdover or a renewal may well carry the obligation forward. Confirm whether ${r.name} occupied during this period and on what terms, and record the holdover or renewal against the lease.`,
          // The whole allocation is unconfirmed: no lease on file covers any part
          // of the period. `at_risk` reads on screen as "Requiring Lease
          // Verification", which is the claim being made — not a loss.
          impact:  { amount: r.totalAllocated, kind: 'at_risk',
                     basis: `Full ${camYear} allocation to ${r.name}; occupancy for the period not yet confirmed` },
          actions: ['Confirm occupancy', 'Update lease', 'Remove allocation'],
          conditions: cond([`Lease end date: ${c.leaseEnd}`, `Lease term ended before the CAM period began`], UNAPPORTIONED),
        }, base));
        return;
      }

      // ── The lease had not begun when the period ended. Billing a period that
      // precedes the lease entirely is a data error, not a treatment question.
      if (c.case === 'begins_after') {
        flags.push(Object.assign({
          severity: 'red',
          title:    `${r.name} is being billed ${camYear} CAM on a lease that does not begin until ${c.leaseStart}`,
          detail:   `This reconciliation allocates ${_fmt(r.totalAllocated)} of ${camYear} CAM to ${r.name}, but the lease on file commences ${c.leaseStart} — after ${period.end}, the end of the period being billed. Either the lease dates or the CAM period is wrong. Confirm which before issuing anything from this run.`,
          impact:  { amount: r.totalAllocated, kind: 'at_risk',
                     basis: `Full ${camYear} allocation to ${r.name}; lease term does not reach the period billed` },
          actions: ['Confirm occupancy', 'Update lease', 'Remove allocation'],
          conditions: cond([`Lease start date: ${c.leaseStart}`, `Lease term begins after the CAM period ended`], UNAPPORTIONED),
        }, base));
        return;
      }

      // ── A date on file that cannot be read. It used to fail OPEN: '8/31/2026'
      // is not less than '2026-12-31' as a string, so a malformed end date
      // raised nothing whatever. Now it asks.
      if (c.case === 'unreadable') {
        flags.push(Object.assign({
          severity: 'yellow',
          blocksBilling: true,
          title:    `Confirm ${r.name}'s lease dates — a date on file cannot be read`,
          // QUOTED FROM THE CLASSIFICATION, NOT THE FIELD. These lines used to
          // read t.start_date/t.end_date directly, which is both a second reader
          // of the two fields obligationTerm owns and — since normalization
          // stores an unreadable date as '' — empty on precisely the finding
          // that exists to report one. `upon substantial completion` is the
          // whole message; "start: """ is not.
          detail:   `${r.name} is allocated ${_fmt(r.totalAllocated)} of ${camYear} CAM, but the lease term on file could not be read as a date` +
                    `${c.startStatus === 'unreadable' ? ` (start: "${c.startRaw}")` : ''}` +
                    `${c.endStatus === 'unreadable' ? ` (end: "${c.endRaw}")` : ''}` +
                    `, so this reconciliation cannot tell whether the lease covered ${period.start} to ${period.end}. Correct the dates on the lease record and re-run.`,
          actions: ['Correct the lease dates', 'Re-run the reconciliation'],
          conditions: cond([
            `Start date on file: ${c.startRaw == null || c.startRaw === '' ? '(none)' : String(c.startRaw)}`,
            `End date on file: ${c.endRaw == null || c.endRaw === '' ? '(none)' : String(c.endRaw)}`,
          ], UNAPPORTIONED),
        }, base));
        return;
      }

      // ── The lease is valid and covers PART of the period. Since T2 the
      // allocation is apportioned, so there is no longer anything to warn about
      // WHEN THE LEASE SAYS HOW. What remains is the case where it does not: the
      // reconciliation computes on a per-diem default, and a default is not a
      // lease term. The manager is asked once, and only once — a confirmed basis
      // is written to the lease and this stops firing.
      const _basis = LP.partialPeriodBasis(t);
      if (_basis.stated) return;

      const _occ = LP.occupancy(t, period);
      const _window = _occ && _occ.overlapStart
        ? `${_occ.overlapStart} to ${_occ.overlapEnd}` : 'the part of the period it covers';
      const _frac = _occ && _occ.numerator !== null
        ? `${_occ.numerator} of ${_occ.denominator} days` : 'a partial period';
      const _which =
          c.case === 'commences_within' ? `commences ${c.leaseStart}, after the period opened on ${period.start}`
        : c.case === 'expires_within'   ? `runs to ${c.leaseEnd}, before the period closes on ${period.end}`
        : `runs from ${c.leaseStart} to ${c.leaseEnd}, inside the period`;

      flags.push(Object.assign({
        severity: 'yellow',
        blocksBilling: true,
        title:    `Confirm how ${r.name}'s partial year is apportioned — the lease does not say`,
        detail:   `${r.name}'s lease ${_which}, covering ${_window}. This reconciliation has apportioned its share of the shared CAM pool on a PER-DIEM basis — ${_frac} — and billed ${_fmt(r.totalAllocated)}. That basis is this product's default, not a term of the lease: no partial-period clause was found in the document. Confirm the apportionment for ${r.name} once and it will be recorded against the lease; this will not be asked again.` +
                  (_basis.source === 'unrecognised'
                    ? ` (The lease record carries "${String(_basis.raw)}", which is not a basis this reconciliation recognises.)` : ''),
        actions: ['Confirm the partial-period basis',
                  'Check the lease for a proration clause',
                  'Record the basis against the lease'],
        conditions: cond([
          `Lease term: ${c.leaseStart} to ${c.leaseEnd}`,
          `Occupied within the period: ${_window}`,
          `Basis applied: ${_basis.basis} (source: ${_basis.source})`,
        ], _occ && _occ.numerator !== null
             ? `apportioned ${_occ.numerator}/${_occ.denominator} ${_occ.unit}`
             : 'apportioned'),
      }, base));
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
          // "Coverage gap" named the deficiency; it did not say what to do about
          // it. The share is unresolved rather than lost, and uploading the
          // remaining leases is what resolves it — so say that, in the actions a
          // reader can act on.
          actions:  ['Upload remaining leases', 'Confirm vacant space', 'Re-run reconciliation'],
          source:   'Sum of loaded-lease square footage vs property total',
          title:    `Property CAM coverage: ${totalPR.toFixed(1)}% documented · ${gap.toFixed(1)}% unresolved`,
          detail:   `The leases currently loaded account for ${totalPR.toFixed(2)}% of the property's square footage, leaving ${gap.toFixed(1)}% unallocated. That remainder is either vacant space — whose share of CAM the landlord absorbs — or space under a lease that has not been uploaded yet, in which case that share is recoverable and is missing from this reconciliation. The amounts billed to the tenants above are unaffected: each is charged only its own share.`,
          conditions: [
            `Loaded leases cover: ${totalPR.toFixed(2)}% of the property`,
            `Unallocated: ${gap.toFixed(2)}%`,
            `${results.length} lease${results.length !== 1 ? 's' : ''} in this reconciliation`,
            'Cause not determined: vacant space, or a lease not yet uploaded',
            'Tenant charges are unaffected — each tenant is billed only its own share',
            'To resolve: upload the remaining leases, then re-run the reconciliation — that determines whether the unresolved share is vacant space or a missing tenant obligation',
            'If every lease is already loaded, the remainder is vacant and the landlord absorbs its share',
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
          // STAYS YELLOW, BUT BLOCKS THIS TENANT. The lease may or may not permit
          // CAM pass-throughs and this engine will not assert which — that is why
          // the severity is not red and the finding is not disputable. But the
          // charge in doubt IS this tenant's, so its statement waits for a human
          // to confirm the CAM treatment. It blocks nobody else.
          blocksBilling: true,
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
          // Same reasoning as the Modified Gross branch above: the tenant whose
          // charge is in question cannot be billed until the treatment is
          // confirmed, and no other tenant is affected.
          blocksBilling: true,
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
