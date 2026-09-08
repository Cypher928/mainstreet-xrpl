/**
 * dispute-status.js — the ONE definition of what an open dispute is.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The M1–M6 architecture audit measured two capabilities contradicting each
 * other about the same disputes. One property holding one `open` dispute and
 * one `docs_requested` dispute produced:
 *
 *     get_attention  ->  "1 open dispute"
 *     get_disputes   ->  openDisputeCount: 2
 *
 * Both answers passed every test, because there was no definition to be wrong
 * about — there were four, spread across seven files:
 *
 *   status === 'open'                          property-workspace.js:47,
 *                                              selectors.js, acquisition-engine.js,
 *                                              lease-review-packets.js
 *   status === 'open' || 'docs_requested'      tenant-space.js, _mcp-capabilities.js
 *   status !== accepted/rejected/resolved      command-center.js:84,
 *                                              ai-workspace.js:405
 *   DISPUTE_TRANSITIONS                        script.js:14897 — the actual
 *                                              state machine resolveDispute enforces
 *
 * THE DEFINITION IS NOT A JUDGEMENT CALL — IT WAS ALREADY WRITTEN DOWN
 * --------------------------------------------------------------------
 * The fourth of those is an authority and the other three are opinions. The
 * state machine says which statuses can still change:
 *
 *     open:           -> docs_requested, accepted, rejected     (can move)
 *     docs_requested: -> accepted, rejected                     (can move)
 *     accepted:       -> []                                     (terminal)
 *     rejected:       -> []                                     (terminal)
 *
 * A dispute is OPEN when the machine still permits it to move, and CLOSED when
 * it does not. That makes `docs_requested` open — which it plainly is; the
 * landlord has asked the tenant for documents and nobody has decided anything —
 * and it makes the narrow `=== 'open'` readings the outliers.
 *
 * Deriving the predicate FROM the transition table rather than restating it as
 * a list is deliberate: add a state to the machine and this follows, instead of
 * silently classifying it wrong.
 *
 * THE THIRD ANSWER
 * ----------------
 * A status the machine has never heard of is UNKNOWN, and unknown is reported,
 * never folded into either count. Folding it into `closed` understates what
 * needs attention; folding it into `open` invents work. Both are the failure
 * this codebase exists to prevent, so `tally()` returns open, closed AND
 * unknown, and a caller that wants a single number has to decide knowingly.
 *
 * LEGACY_CLOSED is the one concession, and it is evidenced rather than assumed:
 * `resolved` is not in the state machine, but it is written in stored fixture
 * data (fixtures/dispute-heavy-property.js, test-packets.js) and TWO shipping
 * modules already treat it as terminal (command-center.js:84,
 * ai-workspace.js:405). Nothing writes it any more; it is history, and history
 * that two consumers already agree about.
 *
 * DELIBERATELY NOT INCLUDED: `escalated` and `withdrawn`. They appear exactly
 * once in the codebase, inside script.js's VALID_DISPUTE_STATUSES set, and
 * nothing anywhere writes either one. Classifying them would be guessing at
 * vocabulary that was proposed and never used, so they resolve to `unknown`.
 *
 * PURE. No DOM, no network, no storage, no session state, no mutation of its
 * input. Safe on a server and safe in the allow-listed shim.
 */
(function (root) {
  'use strict';

  /**
   * The dispute state machine. Mirrors script.js's DISPUTE_TRANSITIONS, which
   * reads this table so the two cannot drift.
   *
   * A status maps to the statuses it may still become. An empty list is
   * terminal — the dispute is decided and nothing further can happen to it.
   */
  var TRANSITIONS = {
    open:           ['docs_requested', 'accepted', 'rejected'],
    docs_requested: ['accepted', 'rejected'],
    accepted:       [],
    rejected:       [],
  };

  /**
   * Statuses no longer written, whose meaning is settled by existing consumers
   * rather than by this file. See the header before adding to this list.
   */
  var LEGACY_CLOSED = ['resolved'];

  var OPEN = 'open', CLOSED = 'closed', UNKNOWN = 'unknown';

  /**
   * Which class a status falls in.
   *
   * @param {string} status
   * @returns {'open'|'closed'|'unknown'}
   */
  function classify(status) {
    if (typeof status !== 'string' || status === '') return UNKNOWN;
    if (Object.prototype.hasOwnProperty.call(TRANSITIONS, status)) {
      // Still able to move ⇒ still open. Terminal ⇒ closed.
      return TRANSITIONS[status].length ? OPEN : CLOSED;
    }
    if (LEGACY_CLOSED.indexOf(status) !== -1) return CLOSED;
    return UNKNOWN;
  }

  /**
   * True ONLY for a status the machine says can still change.
   *
   * An unknown status returns false here, which is why `isOpen` must never be
   * used to produce a count on its own — use tally(), which reports the
   * unknowns rather than discarding them.
   */
  function isOpen(dispute) {
    return classify(dispute && dispute.status) === OPEN;
  }

  /** True for a status the machine says is decided. */
  function isClosed(dispute) {
    return classify(dispute && dispute.status) === CLOSED;
  }

  /**
   * Count a list of disputes without losing any of them.
   *
   * total === open + closed + unknown, always. A caller that reports `open`
   * while ignoring a non-zero `unknown` is reporting a number it cannot
   * support, and this shape is what makes that visible instead of silent.
   *
   * @param {Array} disputes
   * @returns {{total:number, open:number, closed:number, unknown:number,
   *            unknownStatuses:string[]}}
   */
  function tally(disputes) {
    var list = Array.isArray(disputes) ? disputes : [];
    var out = { total: 0, open: 0, closed: 0, unknown: 0, unknownStatuses: [] };
    for (var i = 0; i < list.length; i++) {
      var d = list[i];
      if (!d) continue;
      out.total++;
      var k = classify(d.status);
      out[k]++;
      if (k === UNKNOWN) {
        var s = (typeof d.status === 'string' && d.status) ? d.status : '(absent)';
        if (out.unknownStatuses.indexOf(s) === -1) out.unknownStatuses.push(s);
      }
    }
    out.unknownStatuses.sort();
    return out;
  }

  /** Every status this module can classify, for documentation and tests. */
  function knownStatuses() {
    return Object.keys(TRANSITIONS).concat(LEGACY_CLOSED).sort();
  }

  var api = {
    TRANSITIONS: TRANSITIONS,
    LEGACY_CLOSED: LEGACY_CLOSED,
    OPEN: OPEN, CLOSED: CLOSED, UNKNOWN: UNKNOWN,
    classify: classify, isOpen: isOpen, isClosed: isClosed,
    tally: tally, knownStatuses: knownStatuses,
  };

  if (root) root.DisputeStatus = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

})(typeof window !== 'undefined' ? window : null);
