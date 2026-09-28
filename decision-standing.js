/**
 * decision-standing.js — which term decision currently STANDS.
 *
 * acquisition_term_decisions is an append-only history, not a fact table: a
 * person confirms a reading, corrects it, rejects it or reopens the question,
 * and every one of those is a row. What a surface may present as "the
 * decision" is derived, and the rule is this one:
 *
 *   · only the four known actions count (confirm · correct · reject · reopen);
 *   · rows are ordered by decided_at (as strings, ascending; a stable sort, so
 *     an exact tie keeps arrival order);
 *   · the LAST row is the standing decision — a confirm or correct stands, a
 *     reject stands as "the reading was rejected";
 *   · a last row that is a reopen means NO decision stands (null).
 *
 * The rule was AcquisitionTerms.latestDecision. It is here, dependency-free,
 * so the Acquisition Review (through AcquisitionTerms, which delegates to it)
 * and the Property Workspace (property-leaseholds.js, P5-3) apply the same
 * rule without the Property Workspace loading the acquisition resolver or its
 * reasoner. The body is the original, moved; test-decision-standing.js holds
 * both entry points to the same fixtures so the two cannot drift.
 *
 * window.DecisionStanding in the browser; module.exports for Node.
 */
(function (root, factory) {
  var api = factory();
  if (root) root.DecisionStanding = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  var DECISION_ACTIONS = ['confirm', 'correct', 'reject', 'reopen'];

  /** The decision that stands for one field, or null when none does. */
  function standing(decisions, field) {
    var rows = (Array.isArray(decisions) ? decisions : []).filter(function (r) {
      return r && r.field_key === field && DECISION_ACTIONS.indexOf(r.action) >= 0;
    });
    if (!rows.length) return null;
    rows.sort(function (a, b) {
      var x = String(a.decided_at || ''), y = String(b.decided_at || '');
      return x < y ? -1 : x > y ? 1 : 0;
    });
    var last = rows[rows.length - 1];
    return last.action === 'reopen' ? null : last;
  }

  /**
   * The standing decision for every field that has at least one known-action
   * row, keyed by field_key in order of first appearance. A field whose last
   * row is a reopen is present with the value null — it was decided about,
   * and nothing stands now.
   */
  function standingByField(decisions) {
    var out = {};
    (Array.isArray(decisions) ? decisions : []).forEach(function (r) {
      if (!r || r.field_key == null || DECISION_ACTIONS.indexOf(r.action) < 0) return;
      if (!(r.field_key in out)) out[r.field_key] = standing(decisions, r.field_key);
    });
    return out;
  }

  return { DECISION_ACTIONS: DECISION_ACTIONS, standing: standing, standingByField: standingByField };
});
