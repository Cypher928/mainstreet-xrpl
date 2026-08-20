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

  const IMPACT_KINDS = ['at_risk', 'under_review', 'recoverable', 'none'];

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
    if (!impact || typeof impact !== 'object') return { amount: null, kind: 'none' };
    const kind = IMPACT_KINDS.indexOf(impact.kind) >= 0 ? impact.kind : 'none';
    return { amount: num(impact.amount), kind, basis: impact.basis || null };
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
    const all = []
      .concat(findings && findings.red    || [])
      .concat(findings && findings.yellow || [])
      .concat(findings && findings.green  || []);

    const out = {
      totalPool:           num(totalPool) || 0,
      confirmedAtRisk:     0,
      requiringReview:     0,
      excludedRecoverable: 0,
      unquantified:        0,   // findings that matter but carry no amount yet
      counts: {
        red:    (findings && findings.red    || []).length,
        yellow: (findings && findings.yellow || []).length,
        green:  (findings && findings.green  || []).length,
      },
      contributors: { at_risk: [], under_review: [], recoverable: [] },
    };

    all.forEach((f) => {
      if (!f) return;
      const imp = normalizeImpact(f.impact);
      const material = f.severity === 'red' || f.severity === 'yellow'
        || (f.group && f.group !== 'green');
      if (imp.amount === null) {
        // Only red/yellow findings are "unquantified"; a green finding with no
        // amount is simply a verification, not a gap in pricing.
        if (f.severity === 'red' || f.severity === 'yellow') out.unquantified++;
        return;
      }
      if (imp.kind === 'at_risk')      { out.confirmedAtRisk     += imp.amount; out.contributors.at_risk.push(f.title); }
      else if (imp.kind === 'under_review') { out.requiringReview += imp.amount; out.contributors.under_review.push(f.title); }
      else if (imp.kind === 'recoverable')  { out.excludedRecoverable += imp.amount; out.contributors.recoverable.push(f.title); }
      else if (material) { /* kind 'none' with an amount: informational only */ }
    });

    return out;
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
    if (x.confirmedAtRisk > 0)     parts.push(`${fmtMoney(x.confirmedAtRisk)} at risk`);
    if (x.requiringReview > 0)     parts.push(`${fmtMoney(x.requiringReview)} requiring review`);
    if (x.excludedRecoverable > 0) parts.push(`${fmtMoney(x.excludedRecoverable)} excluded or recovered`);

    if (x.unquantified > 0) {
      parts.push(`${x.unquantified} finding${x.unquantified === 1 ? '' : 's'} not yet quantified`);
    }

    const nothingOutstanding =
      x.confirmedAtRisk === 0 && x.requiringReview === 0 && x.unquantified === 0;

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
        reasons.push(`${fmtMoney(x.confirmedAtRisk)} of the pool at risk (−${capped})`);
      }
    }
    if (x.unquantified > 0) {
      d += x.unquantified * 3;
      reasons.push(`${x.unquantified} finding${x.unquantified === 1 ? '' : 's'} not yet quantified (−3 each)`);
    }
    return { deduction: d, reasons };
  }

  return {
    IMPACT_KINDS, VERDICT, VERDICT_LABEL, VERDICT_ICON, VERDICT_MEANING,
    normalizeImpact, deriveExposure, describeExposure, billingReadiness,
    healthDeductions, fmtMoney,
  };
});
