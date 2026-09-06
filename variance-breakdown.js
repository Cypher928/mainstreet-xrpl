'use strict';
/**
 * variance-breakdown.js
 *
 * Answers ONE question: the expense pool is $X, the tenants were billed $Y, so
 * where did the difference go?
 *
 * The reconciliation screen has always been able to state the gap. It could not
 * state its composition, so the banner fell back to "Re-check invoice amounts or
 * re-run allocation" — advice that is wrong in the common case, because most of
 * the gap is usually the product working exactly as instructed: an invoice the
 * manager marked not CAM-eligible, a category a lease excludes, a cap, or simply
 * the share of the building no loaded lease covers.
 *
 * NO CAM ARITHMETIC HAPPENS HERE.
 *
 * Everything below is read back out of what runFullReconciliation already
 * produced — `result.includedInvoices[].share`, `result.capAdjustment`,
 * `result.proRataPercent` — and out of the invoice records the engine was
 * handed. This module re-adds those numbers into buckets; it never recomputes an
 * allocation, and no figure it returns can differ from what was billed. That is
 * deliberate: an explanation panel that computed its own version of the answer
 * would be a second CAM engine, and this codebase has already had to delete one
 * of those (see CAM-6 in script.js).
 *
 * THE IDENTITY IT MAINTAINS
 *
 *   pool − billed  =  outOfYear             (dated outside the CAM year)
 *                  +  notEligible
 *                  +  uncovered            (shared dollars outside the loaded shares)
 *                  +  notOccupied          (leased space whose lease did not run
 *                                           the whole period — T2 apportionment)
 *                  +  excludedOrUnmatched  (dollars no lease claimed)
 *                  +  caps
 *                  +  residual
 *
 * `residual` is the honesty valve. If the buckets do not close the gap, the panel
 * says so in a labelled line rather than silently absorbing it into whichever
 * bucket is nearest — the failure mode that let a $110,000 exposure be reported
 * against a $67,300 pool. A non-zero residual is a defect signal, and it is the
 * one line on the panel that means "re-check the invoices".
 *
 * Exposes: window.VarianceBreakdown  (and module.exports for the test suites)
 */
(function (root) {

  // Two invoices are the same invoice when they carry the same id. Engine
  // Invoice objects always have one when the register assigned one; the fallback
  // key is vendor + category + amount, which is what the older stripped invoice
  // shape can offer. Collisions under the fallback merge two identical-looking
  // invoices into one row — visible in the row's amount, not silently dropped.
  function invoiceKey(inv) {
    if (!inv) return '';
    if (inv.id) return 'id:' + String(inv.id);
    // P6 — THE AMOUNT IN THE FALLBACK KEY IS THE CENT, not the raw value. The
    // engine's line items now carry the quantised amount and the source records
    // carry what the document said, so keying on the raw would stop an
    // un-id'd invoice matching itself across the two lists — and its allocation
    // would silently read as zero. One canonical form on both sides.
    var MCk = (typeof window !== 'undefined' && window.MoneyCents)
           || (typeof require === 'function' ? require('./money-cents.js') : null);
    var amt = MCk ? (MCk.toCents(inv.amount) || 0) : (Number(inv.amount) || 0);
    return [
      String(inv.vendorName || inv.vendor || '').toLowerCase().trim(),
      String(inv.category || '').toLowerCase().trim(),
      amt,
    ].join('|');
  }

  function _round(n) { return Math.round((Number(n) || 0) * 100) / 100; }

  /**
   * HOW MUCH OF THE BUILDING-YEAR THE LOADED LEASES COVER.
   *
   * `proRataSum` answers "is there a lease over this square footage at all";
   * this answers "did the lease covering it run the whole period". The two are
   * different questions and the screen has to be able to show both — which it
   * could not, because this figure was computed inside derive() and available
   * nowhere else, so every surface that wanted it would have had to re-derive
   * it. One definition, exported, used by derive() itself.
   *
   * NOT ROUNDED, and that is deliberate: it is a multiplicand, not a display
   * figure. Rounding the percentage sum before dividing by 100 moved $4.93 of a
   * $100,000 pool out of notOccupied and into the unattributed claim bucket.
   * Callers that want to print it round at the point of printing.
   *
   * @returns {number} a fraction in [0,1] — multiply by 100 to display.
   */
  function occupancyCovered(results) {
    const rs = Array.isArray(results) ? results.filter(Boolean) : [];
    return rs.reduce((s, r) => {
      // P6 — THE RATIONAL WHERE THERE IS ONE. `proRataPercent` is a two-decimal
      // display value; a one-third tenant reads 33.33 and the building it is a
      // third of does not. `totalSqFt` is stored since P6, so the exact fraction
      // is available for any record run under the cent policy — and this
      // function has to agree to the cent with derive(), which now uses it, or
      // the KPI tile and the variance panel print two different coverages.
      const t = Number(r.totalSqFt) || 0;
      const space = (r.precision === 'cents' && t > 0)
        ? (Number(r.sqFt) || 0) / t
        : (Number(r.proRataPercent) || 0) / 100;
      const o = r.occupancy;
      const f = (o && o.applied)
        ? (o.numerator != null && Number(o.denominator) > 0
            ? o.numerator / o.denominator
            : (o.factor !== null ? o.factor : 1))
        : 1;
      return s + space * f;
    }, 0);
  }

  /**
   * @param {object} args
   * @param {Array}  args.results   ReconciliationResult[] from runFullReconciliation
   * @param {Array}  args.invoices   the Invoice[] behind the pool total (carries camEligible)
   * @param {Array}  [args.reconciled] the subset the engine actually considered, after
   *        its CAM-year filter (property._reconciledInvoices). Defaults to all of
   *        `invoices`, which is correct whenever no year filter ran.
   * @param {number} args.pool      the pool total the screen is showing
   * @param {number} args.billed    the billed total the screen is showing
   */
  function derive(args) {
    const a        = args || {};
    const results  = Array.isArray(a.results)  ? a.results.filter(Boolean)  : [];
    const invoices = Array.isArray(a.invoices) ? a.invoices.filter(Boolean) : [];
    const pool     = Number(a.pool)   || 0;
    const billed   = Number(a.billed) || 0;
    // Membership by key rather than by object identity: the engine filters into a
    // local and the panel may be re-deriving from stored state, so the two lists
    // are not guaranteed to hold the same object references.
    const inYear = Array.isArray(a.reconciled)
      ? new Set(a.reconciled.filter(Boolean).map(invoiceKey))
      : null;

    const difference = _round(pool - billed);
    // What share of the pool actually reached a tenant. This is the number the
    // reader means by "coverage" when looking at a variance banner, and it is NOT
    // the same as proRataSum — a property can be 100% leased and still bill 11%
    // of the pool if most of the invoices are not CAM-eligible.
    const billedPct  = pool > 0 ? _round((billed / pool) * 100) : null;
    const proRataSum = _round(results.reduce((s, r) => s + (Number(r.proRataPercent) || 0), 0));
    const capTotal   = _round(results.reduce((s, r) => s + (r.capApplied ? (Number(r.capAdjustment) || 0) : 0), 0));

    // ── What each invoice actually contributed, read off the results ─────────
    const allocatedByInvoice = new Map();
    results.forEach(r => {
      (Array.isArray(r.includedInvoices) ? r.includedInvoices : []).forEach(li => {
        const k = invoiceKey(li);
        allocatedByInvoice.set(k, (allocatedByInvoice.get(k) || 0) + (Number(li.share) || 0));
      });
    });

    // ── Per-invoice attribution ──────────────────────────────────────────────
    //
    // For an eligible invoice the gap splits exactly two ways, and both halves
    // are arithmetic on figures already computed:
    //
    //   coverageShortfall  the part of a SHARED invoice that no loaded lease
    //                      has a share of, because the loaded shares sum to
    //                      proRataSum, not 100. Zero for a direct invoice —
    //                      a direct match bills the whole invoice to one tenant.
    //
    //   claimShortfall     whatever is still missing after that: a category a
    //                      lease excludes, or a direct-matched invoice no lease
    //                      ended up claiming. These two are not separable from
    //                      the outputs alone, so they share one honestly-named
    //                      bucket rather than being guessed apart.
    // TWO COVERAGE FRACTIONS SINCE T2, and they answer different questions.
    //
    //   spaceCovered      is there a lease over this square footage at all?
    //   occupancyCovered  did the lease covering it run the whole period?
    //
    // Their difference is money that belongs to leased space whose lease did not
    // span the period — landlord absorption, exactly like vacancy, but from a
    // different cause. Folding the two together would report a part-year tenant
    // as a coverage gap and send the manager looking for a lease that is already
    // uploaded.
    // ── P6 · WHICH ARITHMETIC THIS RECONCILIATION WAS RUN UNDER (D12) ────────
    //
    // A record saved before P6 carries neither the spatial rational (`totalSqFt`)
    // nor the engine's exclusion decisions, so its explanation CANNOT be
    // reconstructed at cent precision. Reopening it must not manufacture a clean
    // zero it never had, and must not claim an `excluded_by_lease` figure it
    // cannot establish. The stamp is read off the results, not sniffed from the
    // presence of a field.
    const isCents = results.length > 0 && results.every(r => r && r.precision === 'cents');
    const MC = (typeof window !== 'undefined' && window.MoneyCents)
            || (typeof require === 'function' ? require('./money-cents.js') : null);
    const precision = (isCents && MC) ? 'cents' : 'legacy';

    // THE SPATIAL SHARE, EXACT. `proRataSum` is a sum of two-decimal DISPLAY
    // percentages and dividing by it is what put $1.06 in the wrong bucket and
    // three cents of phantom vacancy on a fully-leased building. Under the cent
    // policy the fraction comes from sqFt/totalSqFt, which is what the engine
    // actually allocated on.
    const _exactSpace = (r) => {
      const t = Number(r && r.totalSqFt) || 0;
      if (precision === 'cents' && t > 0) return (Number(r.sqFt) || 0) / t;
      return (Number(r && r.proRataPercent) || 0) / 100;
    };
    const covered = precision === 'cents'
      ? results.reduce((s, r) => s + _exactSpace(r), 0)
      : proRataSum / 100;
    // ONE DEFINITION, and it now knows about the rational itself — so the KPI
    // tile that calls occupancyCovered() and this panel cannot disagree.
    const occCoveredRaw = occupancyCovered(results);
    const occCovered = occCoveredRaw;
    let outOfYear = 0, notEligible = 0, uncovered = 0, notOccupied = 0, claimShortfall = 0;
    // THE TWO THINGS THAT LAND IN notOccupied, kept apart as well as together.
    //
    // The bucket sums the apportioned-away share of every SHARED invoice and the
    // whole of every DIRECT invoice held out over its date. Both belong to
    // "leased space whose lease did not run the whole period", so the total is
    // right — but a property-level explanation that says the space-versus-time
    // coverage gap accounts for the bucket is wrong by exactly the direct half,
    // and on Northgate that half is $9,700.00 of $22,932.88. Additive: the
    // existing field and the identity are untouched.
    let notOccupiedShared = 0, notOccupiedDirect = 0;

    // One definition of what is in the CAM pool, shared with the allocation and
    // the concentration detector. Resolved once here rather than per invoice,
    // and guarded because this module is also required directly by the suites.
    const _CP = (typeof window !== 'undefined' && window.CamPool)
              || (typeof require === 'function' ? require('./cam-pool.js') : null);
    const isEligible = _CP ? _CP.isEligible : (inv => inv.camEligible !== false);

    // A DIRECT INVOICE HELD OUT FOR OCCUPANCY IS NOT AN UNCLAIMED ONE.
    //
    // Since T2 the engine holds back a direct-matched invoice when it is dated
    // outside the tenant's occupancy window, or carries no date to place it by.
    // Both are reported to the manager by name and amount — and both landed here
    // in `claim`, under the label "Excluded by a lease, or matched to no
    // tenant", which is the one thing they are not. The manager was sent to
    // read exclusion schedules to explain money that was held back over a date.
    //
    // The engine records which invoices those were on the flag itself, so this
    // reads the decision rather than re-applying the date rule — the same
    // discipline as `considered` and `isDirect` above.
    const occHeld = new Map();
    results.forEach(r => {
      (r.ambiguityFlags || []).forEach(f => {
        if (!f || !Array.isArray(f.held)) return;
        const kind = f.code === 'DIRECT_OUTSIDE_OCCUPANCY' ? 'outside'
                   : f.code === 'DIRECT_UNDATED_OCCUPANCY' ? 'undated'
                   : null;
        if (!kind) return;
        f.held.forEach(h => { if (h) occHeld.set(invoiceKey(h), kind); });
      });
    });

    // D8 — WHAT EACH LEASE'S EXCLUSION SCHEDULE ACTUALLY WITHHELD, per invoice,
    // read from the engine's own decision. Inferring it by subtraction is what
    // put a −$1.06 rounding artefact under the label "Excluded by a lease".
    const excludedByInvoice = new Map();
    if (precision === 'cents') {
      results.forEach(r => {
        (Array.isArray(r.excludedShares) ? r.excludedShares : []).forEach(e => {
          if (!e) return;
          const k = invoiceKey(e);
          excludedByInvoice.set(k, (excludedByInvoice.get(k) || 0) + (Number(e.cents) || 0));
        });
      });
    }
    // Billed cents per invoice, summed from the tenant lines. THIS IS AN INPUT
    // to the decomposition and is never adjusted by it — see the note on
    // largestRemainder in money-cents.js, and test-cent-policy.js.
    const allocatedCentsByInvoice = new Map();
    if (precision === 'cents') {
      results.forEach(r => {
        (Array.isArray(r.includedInvoices) ? r.includedInvoices : []).forEach(li => {
          const k = invoiceKey(li);
          allocatedCentsByInvoice.set(k, (allocatedCentsByInvoice.get(k) || 0) + (MC.toCents(li.share) || 0));
        });
      });
    }
    let roundingResidue = 0, excludedByLease = 0, unclaimed = 0;

    const rows = invoices.map(inv => {
      const amount    = precision === 'cents' ? MC.fromCents(MC.toCents(inv.amount) || 0) : _round(inv.amount);
      const allocated = precision === 'cents'
        ? MC.fromCents(allocatedCentsByInvoice.get(invoiceKey(inv)) || 0)
        : _round(allocatedByInvoice.get(invoiceKey(inv)) || 0);
      const eligible  = isEligible(inv);
      // The engine splits on this threshold; read it, do not re-derive it.
      const isDirect  = (Number(inv.matchConfidence) || 0) >= 75;
      // Likewise the CAM-year decision: this asks whether the engine kept the
      // invoice, it does not re-apply the date rule.
      const considered = !inYear || inYear.has(invoiceKey(inv));

      let reason, coverageShare = 0, occupancyShare = 0, claimShare = 0;
      let excludedShare = 0, unclaimedShare = 0, residueShare = 0;
      if (!considered) {
        outOfYear += amount;
        reason = 'out_of_year';
      } else if (!eligible) {
        notEligible += amount;
        reason = 'not_eligible';
      } else if (precision === 'cents') {
        // ── THE CENT-EXACT DECOMPOSITION (D8 / D11) ──────────────────────────
        //
        //   amount = allocated                  ← given by the engine, never moved
        //          + uncovered                  ⎫
        //          + notOccupied                ⎬ exact values, quantised together
        //          + excludedByLease            ⎪ by largest remainder
        //          + unclaimed                  ⎭
        //          + roundingResidue            ← measured, not plugged
        //
        // The five parts after `allocated` are all money NOBODY WAS BILLED. The
        // remainder sweep runs over four of them and cannot reach `allocated`,
        // which is why no tenant charge can move to make this close.
        const key       = invoiceKey(inv);
        const held      = isDirect ? occHeld.get(key) : undefined;
        const amtC      = MC.toCents(inv.amount) || 0;
        const allocC    = allocatedCentsByInvoice.get(key) || 0;
        const exclC     = excludedByInvoice.get(key) || 0;

        // Exact parts, in cents, still carrying their fractions.
        let uncoveredE, notOccupiedE, unclaimedE;
        if (isDirect) {
          // A direct invoice is not apportioned by either multiplicand. It is
          // billed in full, held over its date, excluded by a schedule, or
          // matched to a tenant no loaded lease covers.
          uncoveredE   = 0;
          notOccupiedE = held ? Math.max(0, amtC - allocC - exclC) : 0;
          unclaimedE   = held ? 0 : Math.max(0, amtC - allocC - exclC);
        } else {
          uncoveredE   = amtC * (1 - covered);
          notOccupiedE = amtC * (covered - occCovered);
          // Every tenant that does not exclude the category takes its share of
          // every shared invoice, so nothing inside the covered, occupied,
          // non-excluded portion goes unclaimed.
          unclaimedE   = 0;
        }
        // What the takers were owed exactly, against what they were billed.
        const takersE  = isDirect ? allocC : Math.max(0, amtC * occCovered - exclC);
        const T        = amtC - allocC;
        const rhoGuess = Math.round(takersE - allocC);
        const lr       = MC.largestRemainder([uncoveredE, notOccupiedE, exclC, unclaimedE], T - rhoGuess);
        const p        = lr.parts;
        // D11 — THE RESIDUE IS A MEASURED QUANTITY, NOT A PLUG. It is exactly
        // "what the takers were owed, less what they were billed": the cents
        // lost or gained rounding each charge. It is NOT defined as whatever
        // makes the invoice close.
        //
        // That distinction is load-bearing. Defining it as the leftover would
        // make it absorb any condition the four buckets cannot describe — an
        // over-allocated building, where the loaded leases exceed 100% and
        // `uncovered` would be negative, dumps a large number here and the panel
        // calls a real defect "rounding". Left as a measurement, the leftover
        // falls through to `residual` instead, which is the line that says the
        // numbers may be wrong. In the ordinary case the two are identical and
        // `residual` is exactly zero.
        residueShare   = MC.fromCents(rhoGuess);

        coverageShare   = MC.fromCents(p[0]);
        occupancyShare  = MC.fromCents(p[1]);
        excludedShare   = MC.fromCents(p[2]);
        unclaimedShare  = MC.fromCents(p[3]);
        claimShare      = 0;      // superseded by the two named buckets

        uncovered       += coverageShare;
        notOccupied     += occupancyShare;
        if (isDirect) notOccupiedDirect += occupancyShare;
        else          notOccupiedShared += occupancyShare;
        excludedByLease += excludedShare;
        unclaimed       += unclaimedShare;
        roundingResidue += residueShare;

        reason = held === 'outside' ? 'outside_occupancy'
          : held === 'undated' ? 'undated_occupancy'
          : excludedShare > 0 && allocC === 0 ? 'excluded_by_lease'
          : allocC <= 0 && amtC > 0 ? (isDirect ? 'unclaimed_direct' : 'unclaimed_shared')
          : excludedShare > 0 ? 'partly_excluded'
          : occupancyShare > 0 ? 'part_period'
          : coverageShare  > 0 ? 'uncovered_share'
          : 'fully_allocated';
      } else {
        const held = isDirect ? occHeld.get(invoiceKey(inv)) : undefined;
        coverageShare  = isDirect ? 0 : _round(amount * (1 - covered));
        // The part of the covered share that a part-period lease did not take —
        // or, for a direct invoice the engine held out over its date, the whole
        // of what went unbilled. THE IDENTITY IS UNTOUCHED: claimShare is still
        // the remainder, so naming this money only moves it between two buckets
        // that already sum to the same difference.
        occupancyShare = isDirect
          ? (held ? _round(amount - allocated) : 0)
          : _round(amount * (covered - occCovered));
        claimShare     = _round(amount - coverageShare - occupancyShare - allocated);
        uncovered      += coverageShare;
        notOccupied    += occupancyShare;
        if (isDirect) notOccupiedDirect += occupancyShare;
        else          notOccupiedShared += occupancyShare;
        claimShortfall += claimShare;
        reason = held === 'outside' ? 'outside_occupancy'
          : held === 'undated' ? 'undated_occupancy'
          : allocated <= 0 && amount > 0
          ? (isDirect ? 'unclaimed_direct' : 'unclaimed_shared')
          : claimShare > 0.005 ? 'partly_claimed'
          : occupancyShare > 0.005 ? 'part_period'
          : coverageShare > 0.005 ? 'uncovered_share'
          : 'fully_allocated';
      }

      return {
        id:          inv.id || null,
        vendor:      inv.vendorName || inv.vendor || 'Unknown vendor',
        category:    inv.category || 'other',
        amount, allocated,
        unallocated: _round(amount - allocated),
        eligible, isDirect, considered, reason,
        coverageShare:  _round(coverageShare),
        occupancyShare: _round(occupancyShare),
        claimShare:     _round(claimShare),
        // P6 — the two halves the old `claim` bucket could not tell apart, and
        // the residue that must never be mistaken for either.
        excludedShare:  _round(excludedShare),
        unclaimedShare: _round(unclaimedShare),
        residueShare:   _round(residueShare),
      };
    });

    outOfYear      = _round(outOfYear);
    notEligible    = _round(notEligible);
    uncovered      = _round(uncovered);
    notOccupied    = _round(notOccupied);
    notOccupiedShared = _round(notOccupiedShared);
    notOccupiedDirect = _round(notOccupiedDirect);
    claimShortfall = _round(claimShortfall);
    excludedByLease = _round(excludedByLease);
    unclaimed       = _round(unclaimed);
    roundingResidue = _round(roundingResidue);
    // THE RESIDUAL IS STILL COMPUTED AS A REMAINDER, and that is the point: it
    // is the one number on the panel nobody designs. Under the cent policy every
    // other bucket holds a quantity that was measured, so this arrives at zero
    // because the money is understood — not because a bucket was bent to make it
    // so. If it is ever non-zero, something here is genuinely unexplained.
    const residual = _round(difference - outOfYear - notEligible - uncovered - notOccupied
                            - claimShortfall - excludedByLease - unclaimed - roundingResidue - capTotal);

    const gapPct = _round(100 - proRataSum);
    const lines = [
      { key: 'out_of_year', label: 'Dated outside the CAM year', amount: outOfYear,
        detail: 'Invoices the reconciliation set aside because their date falls outside the CAM year being billed. They are still counted in the expense pool shown above.' },
      { key: 'not_eligible', label: 'Marked not CAM-eligible', amount: notEligible,
        detail: 'Invoices the manager unticked in the invoice register. They stay in the expense pool and are never allocated to any tenant.' },
      { key: 'uncovered', label: `Outside the ${proRataSum.toFixed(1)}% of the property covered by loaded leases`, amount: uncovered,
        detail: `Shared expenses are split by pro-rata share. The loaded leases hold ${proRataSum.toFixed(1)}% of the building, so ${gapPct.toFixed(1)}% of every shared invoice belongs to space that is either vacant or under a lease not yet uploaded.` },
      { key: 'not_occupied', label: 'Leased, but the lease did not run the whole period', amount: notOccupied,
        detail: `Expense belonging to space that IS under a loaded lease, for the part of the period that lease did not cover — a tenant who took occupancy or moved out mid-year. Two things land here: the apportioned-away part of every shared invoice, and any invoice matched directly to that tenant but dated outside their occupancy, or carrying no date to place it by. None of it is charged to anyone else; it remains unallocated to tenants in this reconciliation.` },
      // LEGACY ONLY. Pre-P6 records cannot separate an exclusion from a rounding
      // residue, so they keep the honestly-vague label they were computed under.
      { key: 'claim', label: 'Excluded by a lease, or matched to no tenant', amount: claimShortfall,
        detail: 'Dollars inside the covered share that no lease ended up claiming — a category a lease excludes from CAM, or an invoice matched to a tenant that no lease then took.' },
      // D8 — the two halves that bucket could not tell apart, each now read from
      // a decision rather than reached by subtraction.
      { key: 'excluded_by_lease', label: 'Excluded from CAM by a lease', amount: excludedByLease,
        detail: 'Expense in a category one or more leases exclude from CAM. It stays in the expense pool and is not billed to the tenants whose leases exclude it. The invoice rows below name which invoices and which categories.' },
      { key: 'unclaimed', label: 'Matched to no lease', amount: unclaimed,
        detail: 'Expense matched to a tenant that no loaded lease then took — most often an invoice matched by unit number or vendor name to a space whose lease has not been uploaded.' },
      // D11 — THE RESIDUE HAS ITS OWN NAME. Every tenant charge is rounded to a
      // cent, and the cents lost or gained in that rounding are a real quantity.
      // Folding them into an exclusion is how a $1.06 rounding artefact came to
      // be labelled "Excluded by a lease" — as a NEGATIVE amount. It is small by
      // construction and it is never anything else.
      { key: 'rounding_residue', label: 'Rounding to the nearest cent', amount: roundingResidue,
        detail: 'The difference between each tenant\u2019s exact computed share and the whole cent they were billed. Every charge on every statement is rounded to a cent, and this line is what that rounding adds up to across the pool. It is not an exclusion, a cap, or a coverage gap.' },
      { key: 'caps', label: 'Reduced by a CAM cap', amount: capTotal,
        detail: 'Allocation the engine computed and then withheld because a lease cap was reached. The expense stays in the pool; the tenant is not billed for it.' },
      { key: 'residual', label: 'Not attributed', amount: residual,
        detail: 'The part of the difference these categories do not explain. Anything here is worth checking against the invoice register — it is the only line on this panel that means the numbers may be wrong.' },
    ].filter(l => Math.abs(l.amount) >= 0.005)
     .sort((x, y) => Math.abs(y.amount) - Math.abs(x.amount));

    const unbilled = rows.filter(r => r.allocated <= 0 && r.amount > 0);

    return {
      pool: _round(pool), billed: _round(billed), difference,
      billedPct, proRataSum, gapPct, capTotal,
      occupancyCoveredPct: _round(occCoveredRaw * 100),
      outOfYear, notEligible, uncovered, notOccupied, claimShortfall, residual,
      // P6. `claimShortfall` is retained and stays in the identity so a legacy
      // record reads exactly as it did; under the cent policy it is always 0 and
      // these three carry the money instead.
      excludedByLease, unclaimed, roundingResidue,
      // D12 — 'cents' or 'legacy'. Which arithmetic produced this explanation,
      // stated rather than implied, so a surface can say so.
      precision,
      // Additive. `notOccupied` keeps its meaning and its place in the identity;
      // these two say which half is which.
      notOccupiedShared, notOccupiedDirect,
      lines, invoices: rows,
      invoiceCount:  rows.length,
      unbilledCount: unbilled.length,
      unbilledTotal: _round(unbilled.reduce((s, r) => s + r.amount, 0)),
      // True when the gap is fully explained by settings the manager chose or by
      // coverage — i.e. nothing here says the reconciliation is wrong.
      // P6 — EXACTLY ZERO, not "close enough". The five-cent tolerance existed
      // because the arithmetic could not do better; in integer cents it can, so
      // a residual of any size is now a real finding. Legacy records keep the
      // old tolerance, because their arithmetic genuinely cannot reach zero.
      explained: precision === 'cents' ? residual === 0 : Math.abs(residual) < 0.05,
    };
  }

  // What to tell the reader to do next, in the same "Next step" shape the lease
  // review flow uses. Ordered by which bucket is actually the largest, so the
  // advice matches this reconciliation instead of being generic.
  function nextStep(bk) {
    if (!bk) return null;
    // P6 — in integer cents an unexplained penny is a real finding, so the
    // five-cent tolerance goes with it. Legacy records keep the old threshold.
    const _resTol = bk.precision === 'cents' ? 0 : 0.05;
    if (Math.abs(bk.residual) > _resTol) {
      return { cta: 'Re-check the invoice register', key: 'residual' };
    }
    const biggest = (bk.lines || []).filter(l => l.key !== 'residual')[0];
    if (!biggest) return null;
    if (biggest.key === 'out_of_year')  return { cta: 'Check the CAM year against the invoice dates', key: 'out_of_year' };
    if (biggest.key === 'not_eligible') return { cta: 'Review which invoices are CAM-eligible', key: 'not_eligible' };
    if (biggest.key === 'uncovered')    return { cta: 'Upload the remaining leases, or confirm the space is vacant', key: 'uncovered' };
    if (biggest.key === 'not_occupied') {
      // The remedy differs by cause, and sending someone to review lease dates
      // when the real problem is an invoice with no date on it is the kind of
      // dead end this CTA exists to remove.
      const _undated = (bk.invoices || []).filter(r => r.reason === 'undated_occupancy');
      if (_undated.length) {
        return { cta: `Add the missing invoice date${_undated.length === 1 ? '' : 's'} and re-run`, key: 'not_occupied' };
      }
      return { cta: 'Review the partial-period treatment on the leases that started or ended mid-year', key: 'not_occupied' };
    }
    if (biggest.key === 'claim')        return { cta: 'Review the lease exclusion schedules', key: 'claim' };
    if (biggest.key === 'excluded_by_lease') return { cta: 'Review the lease exclusion schedules', key: 'excluded_by_lease' };
    if (biggest.key === 'unclaimed')    return { cta: 'Upload the lease for the space these invoices matched', key: 'unclaimed' };
    // NO NEXT STEP FOR ROUNDING. There is nothing to fix: every charge is
    // rounded to a cent and this is what that adds up to. Offering an action
    // would send a manager looking for a defect that is not there.
    if (biggest.key === 'rounding_residue') return null;
    if (biggest.key === 'caps')         return { cta: 'Review the CAM caps that were applied', key: 'caps' };
    return null;
  }

  const REASON_LABEL = {
    out_of_year:      'Dated outside the CAM year',
    not_eligible:     'Marked not CAM-eligible',
    unclaimed_direct: 'Matched to a tenant, but no lease billed it',
    unclaimed_shared: 'Shared expense that reached no tenant',
    partly_claimed:   'Partly allocated — a lease excludes part of it',
    excluded_by_lease:'Excluded from CAM by a lease',
    partly_excluded:  'Partly allocated — a lease excludes it from CAM',
    uncovered_share:  'Allocated to the covered share only',
    part_period:      'Reduced — a lease covered only part of the period',
    outside_occupancy:'Matched to a tenant, but dated outside their occupancy',
    undated_occupancy:'Matched to a part-period tenant, but carries no date to place it by',
    fully_allocated:  'Fully allocated',
  };

  const api = { derive, nextStep, invoiceKey, occupancyCovered, REASON_LABEL };
  if (root) root.VarianceBreakdown = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

})(typeof window !== 'undefined' ? window : null);
