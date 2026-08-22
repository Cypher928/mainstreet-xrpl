'use strict';
/**
 * audit-exposure.js — the canonical audit state.
 *
 * Exposes: window.AuditExposure (and module.exports, for tests)
 *
 * WHY THIS EXISTS
 * The audit summary reported "5 critical exceptions" and, two lines later,
 * "no at-risk amounts identified". Both statements were correct and neither
 * was a rendering bug: the exception COUNT came from the red-flag array, while
 * the exposure STRING was computed from three unrelated inputs (undocumented
 * invoices, open disputes, cap savings). Red flags carried no money at all, so
 * four expired leases receiving real allocations summed to nothing.
 *
 * The Lender Summary had the same shape of defect from a third direction: its
 * health score was 100 minus penalties for missing docs, low confidence, open
 * disputes and lease exceptions — none of which is the audit's finding set. A
 * property with five critical exceptions scored 100/100.
 *
 * So the fix is not a better string or a lower score. It is one place where a
 * finding's financial consequence is recorded, and one derivation every surface
 * reads. This module is that place. It computes nothing about leases or CAM; it
 * only classifies and totals what the detectors already found.
 *
 * THE FOUR BUCKETS, AND WHY "UNQUANTIFIED" IS ONE OF THEM
 * A finding's money is one of:
 *   at_risk      — a real amount that should not be billed as it stands
 *   under_review — a real amount whose treatment is unresolved, NOT a loss
 *   recoverable  — an amount correctly excluded or already recovered
 *   none         — the finding has no dollar consequence
 * and separately a finding may have no amount yet at all.
 *
 * That last case is tracked and reported rather than silently treated as zero.
 * Reporting "$0 at risk" for a finding nobody has priced is how the original
 * contradiction happened, and it is the one failure mode this module exists to
 * make impossible.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AuditExposure = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  // TWO AXES, NEVER ADDED TOGETHER
  //
  // at_risk / under_review / recoverable measure the ALLOCATION side: dollars
  // billed out to tenants. `unsubstantiated` measures the EXPENSE side: dollars
  // in the pool whose supporting evidence is thin — an undated invoice, a
  // missing receipt, a vendor holding an outsized share of the pool.
  //
  // The same dollar is usually on both axes at once. In the Test 2
  // reconciliation the four expired leases carry $40,832 of allocation risk and
  // the weakly-evidenced invoices come to $57,750, against a $71,950 pool. Add
  // them and the report claims $98,582 of exposure on a $71,950 pool, which is
  // the same species of nonsense this module was written to stop. So the
  // expense-side figure is totalled separately, labelled by what it measures,
  // and never folded into the allocation total.
  const IMPACT_KINDS = ['at_risk', 'under_review', 'recoverable',
                       'unsubstantiated', 'concentration', 'none'];

  // Allocation-side kinds. The expense-side kinds are deliberately absent.
  const ALLOCATION_KINDS = ['at_risk', 'under_review', 'recoverable'];

  // EXPENSE-SIDE KINDS, AND WHY THERE ARE TWO OF THEM.
  //
  // These were one bucket called `unsubstantiated`, which put a $55,000 invoice
  // under "weakly evidenced" on a reconciliation whose own green finding read
  // "All 5 invoices have source documents attached". The evidence was not weak.
  // What was notable is that one invoice was 81.7% of the pool — a materiality
  // question, not a documentation one, and answered by an independent bid rather
  // than by attaching a receipt.
  //
  //   unsubstantiated — the supporting document is missing or incomplete
  //   concentration   — the document exists; the amount is large enough that one
  //                     source should not be taken on trust
  const EXPENSE_KINDS = ['unsubstantiated', 'concentration'];

  // ONE VOCABULARY FOR THE BUCKETS, AND WHY "AT RISK" WAS THE WRONG WORD.
  //
  // Every surface wrote its own label, and the shorthand they converged on for
  // `at_risk` was "at risk" — which a property manager handing this to an owner
  // reads as money that definitely cannot be billed. It is not. Every finding
  // that contributes to this bucket is an allocation whose supporting lease has
  // expired, and each says so itself: "Unless a holdover or renewal extends the
  // CAM obligation, there is no lease on file supporting this charge." A
  // holdover may well exist. What is certain is that nobody has verified it.
  //
  // So the bucket is named for what is actually true of it — the allocation
  // needs its lease verified — and the labels live here so no surface can drift
  // back to a stronger claim on its own.
  const KIND_LABEL = {
    at_risk:         'requiring lease verification',
    under_review:    'requiring review',
    recoverable:     'excluded or already recovered',
    unsubstantiated: 'weakly evidenced',
    concentration:   'requiring independent verification',
    none:            '—',
  };

  // Title case, for column headings and KPI labels.
  const KIND_LABEL_TITLE = {
    at_risk:         'Requiring Lease Verification',
    under_review:    'Requiring Review',
    recoverable:     'Excluded / Recovered',
    unsubstantiated: 'Weakly Evidenced',
    // Kept short: this is a table column heading and a subtotal label. The full
    // "Independent Verification Required" phrasing lives in KIND_MEANING, where
    // there is room for it.
    concentration:   'Material Concentration',
    none:            '—',
  };

  const KIND_MEANING = {
    at_risk:         'Allocated CAM with no unexpired lease on file. A holdover or renewal may cover it — none has been confirmed.',
    under_review:    'A real amount whose correct treatment is unresolved. Not a loss.',
    recoverable:     'Already excluded or recovered under lease terms.',
    unsubstantiated: 'Pool dollars whose supporting document is missing or incomplete. Measures the expenses, not the amounts billed.',
    concentration:   'The document exists. One source accounts for enough of the pool that it should be verified independently before billing.',
    none:            'No dollar consequence.',
  };

  // Verdict vocabulary for clause-level (tenant) checks.
  //
  // The panel previously mapped severity->label with three values, so `info`
  // rendered as "PASSED". Seven different situations shared that severity,
  // including "No management fee cap was extracted from the lease" and "Audit
  // rights are not addressed in this lease" — absence of evidence displayed as
  // confirmation. NOT_CONFIRMED separates "we checked and it holds" from "the
  // lease does not say".
  const VERDICT = {
    PASSED:        'passed',
    NOT_CONFIRMED: 'not_confirmed',
    REVIEW:        'review',
    EXCEPTION:     'exception',
  };

  const VERDICT_LABEL = {
    passed:        'PASSED',
    not_confirmed: 'NOT CONFIRMED',
    review:        'REVIEW',
    exception:     'EXCEPTION',
  };

  const VERDICT_ICON = {
    passed:        '✅',      // ✅
    not_confirmed: '❓',      // ❓ — absence of evidence, not a pass and not a fault
    review:        '⚠️', // ⚠️
    exception:     '⛔',      // ⛔
  };

  // What each verdict means to someone about to bill a tenant. Rendered as the
  // card's one-line gloss so a property manager never has to infer it.
  const VERDICT_MEANING = {
    passed:        'The lease explicitly supports this condition.',
    not_confirmed: 'The lease does not provide enough information to confirm this. Not a failure — not a pass either.',
    review:        'Resolve before billing: the lease and the reconciliation may not agree.',
    exception:     'The reconciliation conflicts with the lease.',
  };

  const num = (v) => (typeof v === 'number' && isFinite(v)) ? v : null;

  /**
   * Normalise a finding's impact. Accepts the shorthand detectors write and
   * always returns a well-formed object, so callers never branch on shape.
   */
  function normalizeImpact(impact) {
    if (!impact || typeof impact !== 'object') return { amount: null, kind: 'none', scope: null };
    const kind = IMPACT_KINDS.indexOf(impact.kind) >= 0 ? impact.kind : 'none';
    return {
      amount: num(impact.amount),
      kind,
      basis: impact.basis || null,
      // Optional identifier for the dollars this finding is about, e.g.
      // "invoice:Harbor Snow Removal". Two findings naming the same scope are
      // two observations about one sum of money, not two sums — see dedupe in
      // deriveExposure. Findings without a scope are assumed distinct.
      scope: impact.scope ? String(impact.scope) : null,
      // The atomic dollars this finding is about, as [{id, amount}].
      //
      // A bare `scope` string could not express OVERLAP. On the Test 3
      // reconciliation the same $55,000 invoice was flagged twice — once as a
      // concentration with scope "invoice:MainStreet CAM Validation", once as
      // undated with scope "invoices:MainStreet CAM Validation" — and because
      // the two strings differ by one character the exposure reported $110,000
      // of a $67,300 pool. Fixing the prefix would have hidden the flaw rather
      // than removed it: three findings over overlapping SETS of invoices would
      // still have triple-counted.
      //
      // Items are compared per id, so one invoice contributes its dollars once
      // however many findings mention it, and a finding covering {A,B} correctly
      // shares A with a finding covering {A}.
      items: Array.isArray(impact.items)
        ? impact.items.filter(x => x && x.id != null && num(x.amount) !== null)
                      .map(x => ({ id: String(x.id), amount: num(x.amount) }))
        : null,
    };
  }

  /** The atoms a finding's money decomposes into, whatever shorthand it used. */
  function impactItems(imp, seq) {
    if (imp.items && imp.items.length) return imp.items;
    if (imp.amount === null) return [];
    return [{ id: imp.scope || ('#anon:' + seq), amount: imp.amount }];
  }

  /**
   * Which severity bucket a finding is in.
   *
   * Detectors are inconsistent about the `severity` field: the reconciliation
   * engine sets it, buildAuditSummary does not — it expresses severity purely by
   * pushing into the red or yellow array. Reading `f.severity` alone therefore
   * saw one unpriced finding in the Test 2 set when there were five, and quietly
   * treated the other four as costing nothing. Which array a finding is in is
   * the authoritative answer, because that is the same thing every report
   * renders "Critical" or "Warning" from.
   */
  function severityOf(finding, bucket) {
    if (finding && (finding.severity === 'red' || finding.severity === 'yellow' || finding.severity === 'green')) {
      return finding.severity;
    }
    return bucket;
  }

  /**
   * The canonical derivation. Takes the finding arrays the audit already builds
   * plus the total CAM pool, and returns every number the summary, the exposure
   * line and the Lender Summary are allowed to state.
   *
   * Deliberately tolerant of findings that predate the structured fields: one
   * without `impact` counts as unquantified rather than as zero.
   */
  function deriveExposure(findings, totalPool) {
    const buckets = [
      ['red',    (findings && findings.red)    || []],
      ['yellow', (findings && findings.yellow) || []],
      ['green',  (findings && findings.green)  || []],
    ];

    const out = {
      totalPool:           num(totalPool) || 0,
      confirmedAtRisk:     0,
      requiringReview:     0,
      excludedRecoverable: 0,
      poolUnsubstantiated: 0,   // expense-side; NOT part of the allocation total
      poolConcentration:   0,   // expense-side; documented, but materially large
      poolFlagged:         0,   // the UNION of the two above — each dollar once
      unquantified:        0,   // findings that matter but carry no amount yet
      counts: { red: buckets[0][1].length, yellow: buckets[1][1].length, green: buckets[2][1].length },
      contributors: { at_risk: [], under_review: [], recoverable: [],
                      unsubstantiated: [], concentration: [] },
    };

    // kind -> item id -> the largest amount any finding claims for it. Taking the
    // max rather than the sum is what makes one invoice count once however many
    // findings describe it.
    const byKind = {};
    let seq = 0;

    buckets.forEach(([bucket, list]) => {
      list.forEach((f) => {
        if (!f) return;
        const sev = severityOf(f, bucket);
        const imp = normalizeImpact(f.impact);

        if (imp.amount === null && !(imp.items && imp.items.length)) {
          // Only red/yellow findings are "unquantified"; a green finding with no
          // amount is simply a verification, not a gap in pricing.
          if (sev === 'red' || sev === 'yellow') out.unquantified++;
          return;
        }
        if (imp.kind === 'none') return; // an amount recorded for context only

        const bag = byKind[imp.kind] || (byKind[imp.kind] = {});
        let contributed = false;
        impactItems(imp, seq++).forEach(({ id, amount }) => {
          if (!(bag[id] > amount)) { bag[id] = amount; }
          contributed = true;
        });
        const listName = out.contributors[imp.kind] ? imp.kind : null;
        if (contributed && listName && out.contributors[listName].indexOf(f.title) < 0) {
          out.contributors[listName].push(f.title);
        }
      });
    });

    const sumOf = (kind) => Object.values(byKind[kind] || {}).reduce((a, b) => a + b, 0);
    out.confirmedAtRisk     = sumOf('at_risk');
    out.requiringReview     = sumOf('under_review');
    out.excludedRecoverable = sumOf('recoverable');
    out.poolUnsubstantiated = sumOf('unsubstantiated');
    out.poolConcentration   = sumOf('concentration');

    // The union across the expense-side kinds. One invoice that is BOTH undated
    // and materially concentrated is one sum of pool dollars needing attention,
    // not two — so the flagged figure takes each id once across both kinds.
    {
      const union = {};
      EXPENSE_KINDS.forEach((k) => {
        Object.entries(byKind[k] || {}).forEach(([id, amt]) => {
          if (!(union[id] > amt)) union[id] = amt;
        });
      });
      out.poolFlagged = Object.values(union).reduce((a, b) => a + b, 0);
    }

    // An expense-side figure larger than the pool it is a share of is
    // arithmetically impossible and always indicates double counting. Report it
    // rather than printing it: a reader who sees "$110,000 of a $67,300 pool"
    // has no way to know which number to distrust.
    out.exceedsPool = out.totalPool > 0 && out.poolFlagged > out.totalPool + 0.005;

    return out;
  }

  /**
   * The allocation-side total: what is outstanding against dollars being billed.
   * Kept as a function so no caller is tempted to add poolUnsubstantiated in.
   */
  function allocationExposure(x) {
    if (!x) return 0;
    return (x.confirmedAtRisk || 0) + (x.requiringReview || 0);
  }

  const fmtMoney = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('en-US');

  /**
   * The exposure sentence, built so that the contradiction cannot recur.
   *
   * The old fallback said "no at-risk amounts identified" whenever three
   * specific inputs were zero, regardless of how many exceptions existed. Here
   * the phrase is only reachable when there is genuinely nothing outstanding:
   * no at-risk money, nothing under review, and nothing unpriced.
   */
  function describeExposure(x) {
    if (!x || !x.totalPool) return 'Insufficient data';

    const parts = [`${fmtMoney(x.totalPool)} total CAM pool`];
    if (x.confirmedAtRisk > 0)     parts.push(`${fmtMoney(x.confirmedAtRisk)} ${KIND_LABEL.at_risk}`);
    if (x.requiringReview > 0)     parts.push(`${fmtMoney(x.requiringReview)} ${KIND_LABEL.under_review}`);
    if (x.excludedRecoverable > 0) parts.push(`${fmtMoney(x.excludedRecoverable)} excluded or recovered`);
    // Expense-side, said in its own words because it is not part of the running
    // total above — and stated as the UNION, so an invoice that is both undated
    // and materially concentrated is one figure rather than two.
    if (x.poolFlagged > 0) {
      const why = [];
      if (x.poolConcentration > 0)   why.push('concentration');
      if (x.poolUnsubstantiated > 0) why.push('documentation');
      parts.push(`${fmtMoney(x.poolFlagged)} of the pool flagged for ${why.join(' and ')} (separate measure)`);
    }
    // An expense figure above the pool is arithmetically impossible. Say so
    // rather than printing it — "$110,000 of a $67,300 pool" leaves a reader no
    // way to know which number to distrust.
    if (x.exceedsPool) {
      parts.push('expense-side total exceeds the pool — figures withheld pending review');
    }

    if (x.unquantified > 0) {
      parts.push(`${x.unquantified} finding${x.unquantified === 1 ? '' : 's'} not yet quantified`);
    }

    const nothingOutstanding =
      x.confirmedAtRisk === 0 && x.requiringReview === 0
      && !(x.poolFlagged > 0) && x.unquantified === 0;

    if (nothingOutstanding && x.counts.red === 0 && x.counts.yellow === 0) {
      return `${fmtMoney(x.totalPool)} total CAM pool — no at-risk amounts identified`;
    }
    return parts.join(' · ');
  }

  /**
   * Whether the reconciliation can be billed as it stands. This is the question
   * the whole screen exists to answer, so it is derived once here rather than
   * inferred separately by each surface.
   */
  function billingReadiness(x) {
    if (!x) return { canBill: false, label: 'Unknown', reason: 'No audit state available.' };
    if (x.counts.red > 0) {
      return {
        canBill: false, label: 'Not ready to bill',
        reason: `${x.counts.red} critical exception${x.counts.red === 1 ? '' : 's'} must be resolved before statements are issued.`,
      };
    }
    if (x.counts.yellow > 0 || x.unquantified > 0) {
      return {
        canBill: true, label: 'Bill with review',
        reason: `${x.counts.yellow} advisory finding${x.counts.yellow === 1 ? '' : 's'} should be reviewed; none blocks billing.`,
      };
    }
    return { canBill: true, label: 'Ready to bill', reason: 'No exceptions were detected.' };
  }

  /**
   * Health-score deductions derived from canonical audit state.
   *
   * The Lender Summary computed 100 minus penalties for missing documents, low
   * extraction confidence, open disputes and lease exceptions — a set that never
   * included the audit's own findings, which is how a property with five
   * critical exceptions scored 100/100. Callers add these to their existing
   * deductions rather than replacing them: document completeness still matters,
   * it was simply never the whole picture.
   *
   * Returns the deduction and the reasons, so the report can show its working
   * instead of presenting an unexplained number.
   */
  function healthDeductions(x) {
    if (!x) return { deduction: 0, reasons: [] };
    const reasons = [];
    let d = 0;
    if (x.counts.red > 0) {
      d += x.counts.red * 12;
      reasons.push(`${x.counts.red} critical exception${x.counts.red === 1 ? '' : 's'} (−12 each)`);
    }
    if (x.counts.yellow > 0) {
      d += x.counts.yellow * 4;
      reasons.push(`${x.counts.yellow} advisory finding${x.counts.yellow === 1 ? '' : 's'} (−4 each)`);
    }
    if (x.totalPool > 0 && x.confirmedAtRisk > 0) {
      const pct = (x.confirmedAtRisk / x.totalPool) * 100;
      const capped = Math.min(20, Math.round(pct));
      if (capped > 0) {
        d += capped;
        reasons.push(`${fmtMoney(x.confirmedAtRisk)} of the pool ${KIND_LABEL.at_risk} (−${capped})`);
      }
    }
    if (x.totalPool > 0 && x.poolFlagged > 0) {
      const pct = (x.poolFlagged / x.totalPool) * 100;
      const capped = Math.min(10, Math.round(pct / 2));
      if (capped > 0) {
        d += capped;
        reasons.push(`${fmtMoney(x.poolFlagged)} of the pool flagged on the expense side (−${capped})`);
      }
    }
    if (x.unquantified > 0) {
      d += x.unquantified * 3;
      reasons.push(`${x.unquantified} finding${x.unquantified === 1 ? '' : 's'} not yet quantified (−3 each)`);
    }
    return { deduction: d, reasons };
  }

  return {
    IMPACT_KINDS, ALLOCATION_KINDS, EXPENSE_KINDS,
    KIND_LABEL, KIND_LABEL_TITLE, KIND_MEANING,
    VERDICT, VERDICT_LABEL, VERDICT_ICON, VERDICT_MEANING,
    normalizeImpact, severityOf, deriveExposure, allocationExposure,
    describeExposure, billingReadiness, healthDeductions, fmtMoney,
  };
});
