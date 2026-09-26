/**
 * property-lifecycle.js — what stage a property is in, and what that admits.
 * ============================================================================
 * Phase 0, P0.2. Decision 1: an acquisition is a PROPERTY at a pre-acquisition
 * stage. The same row, the same id, the same documents. It becomes part of the
 * managed portfolio by a stage TRANSITION to `acquired` — never by copying or
 * rebuilding the property. That sentence is the invariant this module holds,
 * and transition() is written so it cannot be broken from here: it returns a
 * PATCH of stage columns for the existing row, never a new row and never any
 * of the row's data.
 *
 * THE STAGES
 *   prospect → under_review → due_diligence → acquired        the deal path
 *   any pre-acquisition stage → passed                        declined; the
 *                                                             file is kept
 *   passed → prospect                                         reopened
 *   acquired → (nothing here)                                 the managed life
 *                                                             ends by ARCHIVE
 *                                                             (migration 010),
 *                                                             not by a stage
 *
 * THE RULE EVERY AGGREGATE INHERITS
 *   "The portfolio" means stage = acquired and not archived. classify() is the
 *   one place that decides it, and loadProperties (script.js) hands it every
 *   row it reads and keeps ONLY the `active` list in _props. Occupancy, WALT,
 *   revenue at risk, readiness counts, the Command Center, AI summaries — all
 *   of them read _props, so a prospect cannot move a portfolio number because
 *   it never enters the array they read. An archived building must not move
 *   the numbers (docs/PROPERTY_LIFECYCLE.md); a building you have not bought
 *   must not either.
 *
 * DEGRADES, DOES NOT GUESS
 *   Until migrations/023_property_lifecycle.sql is applied the column is not
 *   there. A row with NO stage reads as `acquired` — every property that
 *   exists today is a managed property, which is exactly what the migration's
 *   default says. A row with an UNRECOGNISED stage string is NOT managed: the
 *   database's check constraint makes that impossible, so meeting one here
 *   means something is wrong, and the safe side is out of the portfolio.
 *
 * PURE. No DOM, no network, no storage, no session. Exposes
 * window.PropertyLifecycle in the browser and module.exports for Node.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PropertyLifecycle = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  var STAGES          = Object.freeze(['prospect', 'under_review', 'due_diligence', 'acquired', 'passed']);
  var PRE_ACQUISITION = Object.freeze(['prospect', 'under_review', 'due_diligence']);
  var MANAGED         = Object.freeze(['acquired']);
  var DEFAULT_STAGE   = 'acquired';   // a row with no stage column predates 023: it is a managed property

  var LABELS = Object.freeze({
    prospect:      'Prospect',
    under_review:  'Under Review',
    due_diligence: 'Due Diligence',
    acquired:      'Acquired',
    passed:        'Passed',
  });

  // From each stage, where a transition may go. Read at transition time; there
  // is no other path to a stage change.
  var TRANSITIONS = Object.freeze({
    prospect:      Object.freeze(['under_review', 'due_diligence', 'acquired', 'passed']),
    under_review:  Object.freeze(['prospect', 'due_diligence', 'acquired', 'passed']),
    due_diligence: Object.freeze(['prospect', 'under_review', 'acquired', 'passed']),
    acquired:      Object.freeze([]),
    passed:        Object.freeze(['prospect']),
  });

  // The ONLY columns a transition may write. transition() cannot emit anything
  // outside this list — a test pins it — which is what makes "no copying"
  // structural rather than a review note.
  var STAGE_COLUMNS = Object.freeze(['lifecycle_stage', 'acquired_at', 'passed_at', 'stage_changed_by', 'stage_changed_at']);

  // What loadProperties selects. The pre-023 list is the fallback when the
  // column is absent (PostgREST 42703 rejects the whole query otherwise).
  var SELECT_COLUMNS         = 'id, name, sqft, user_id, archived_at, lifecycle_stage';
  var SELECT_COLUMNS_PRE_023 = 'id, name, sqft, user_id, archived_at';

  // The PostgREST filter that means "managed portfolio" on the server.
  var MANAGED_FILTER = 'lifecycle_stage=eq.acquired';

  function isKnownStage(s) { return typeof s === 'string' && STAGES.indexOf(s) !== -1; }

  /**
   * The stage a row is in. Reads the database column or the app-side field.
   * Absent (null/undefined/'') → the default, acquired. Anything else is
   * returned as-is, recognised or not — the predicates below decide what an
   * unrecognised value admits (nothing).
   */
  function stageOf(row) {
    if (!row || typeof row !== 'object') return DEFAULT_STAGE;
    var s = row.lifecycle_stage != null ? row.lifecycle_stage : row.lifecycleStage;
    if (s == null || s === '') return DEFAULT_STAGE;
    return String(s);
  }

  function isManaged(row)        { return MANAGED.indexOf(stageOf(row)) !== -1; }
  function isPreAcquisition(row) { return PRE_ACQUISITION.indexOf(stageOf(row)) !== -1; }
  function isPassed(row)         { return stageOf(row) === 'passed'; }
  /** Anything that is not a managed property: the deal path, passed, or unrecognised. */
  function isProspect(row)       { return !isManaged(row); }

  function _archivedAt(row) {
    if (!row) return null;
    if (row.archivedAt !== undefined) return row.archivedAt || null;
    return row.archived_at || null;
  }

  /**
   * One row → the shape the app's property list carries. Field-for-field what
   * loadProperties built inline before P0.2, plus lifecycleStage. Accepts a raw
   * database row (sqft, archived_at) or an already-shaped one (totalSqft,
   * archivedAt); a shaped row keeps its existing values.
   */
  function shape(row) {
    var r = row || {};
    return {
      id:             r.id,
      name:           r.name,
      totalSqft:      r.totalSqft !== undefined ? r.totalSqft : (r.sqft || 0),
      archivedAt:     _archivedAt(r),
      lifecycleStage: stageOf(r),
    };
  }

  /**
   * THE split. rows → { active, archived, prospects, unrecognised }.
   *
   *   active       managed (acquired) and not archived   → _props, every aggregate
   *   archived     managed and archived                  → the Archived view
   *   prospects    everything else: prospect, under_review, due_diligence,
   *                passed, and any unrecognised stage    → _prospectProps only
   *   unrecognised the subset of prospects whose stage string is not one of
   *                the five — listed so a caller can say so, never admitted
   *
   * A prospect is a prospect whether or not archived_at is set: archive is a
   * managed property's exit, and it does not promote anything.
   */
  function classify(rows) {
    var out = { active: [], archived: [], prospects: [], unrecognised: [] };
    (Array.isArray(rows) ? rows : []).forEach(function (raw) {
      if (!raw || typeof raw !== 'object') return;
      var row = shape(raw);
      if (isManaged(row)) {
        (row.archivedAt ? out.archived : out.active).push(row);
        return;
      }
      out.prospects.push(row);
      if (!isKnownStage(row.lifecycleStage)) out.unrecognised.push(row);
    });
    return out;
  }

  /** The aggregate guard as a filter: managed and not archived, from any row shape. */
  function managedOnly(rows) {
    return (Array.isArray(rows) ? rows : []).filter(function (r) {
      return r && typeof r === 'object' && isManaged(r) && !_archivedAt(r);
    });
  }

  /** Where a row is allowed to appear. Every surface reads one of these four flags. */
  function visibility(row) {
    var managed = isManaged(row), arch = !!_archivedAt(row);
    return {
      portfolio:    managed && !arch,
      archive:      managed && arch,
      acquisitions: isPreAcquisition(row),
      passed:       isPassed(row),
    };
  }

  function canTransition(from, to) {
    if (!isKnownStage(from) || !isKnownStage(to)) return false;
    return TRANSITIONS[from].indexOf(to) !== -1;
  }

  /**
   * A stage change, as the PATCH to apply to the existing row.
   *
   * Returns { ok: true, from, to, patch } or { ok: false, from, to, error }.
   * The patch carries ONLY stage columns (STAGE_COLUMNS): the stage, who and
   * when, plus acquired_at or passed_at when the destination is one of those.
   * It never carries id, name, sqft, data, organization_id or anything else,
   * so applying it can only ever change what stage the SAME property is in.
   *
   * @param {object} row   the property (raw or shaped)
   * @param {string} to    the destination stage
   * @param {object} ctx   { actorUid, now }  — now: ISO string or Date; defaults to the clock
   */
  function transition(row, to, ctx) {
    var c    = ctx || {};
    var from = stageOf(row);
    if (!row || typeof row !== 'object' || !row.id) {
      return { ok: false, from: from, to: to, error: 'no_property' };
    }
    if (!isKnownStage(to)) return { ok: false, from: from, to: to, error: 'unknown_stage' };
    if (!isKnownStage(from)) return { ok: false, from: from, to: to, error: 'unrecognised_current_stage' };
    if (from === to) return { ok: false, from: from, to: to, error: 'already_in_stage' };
    if (!canTransition(from, to)) return { ok: false, from: from, to: to, error: 'not_allowed' };

    var now = c.now instanceof Date ? c.now.toISOString()
            : (typeof c.now === 'string' && c.now) ? c.now
            : new Date().toISOString();
    var patch = {
      lifecycle_stage:  to,
      stage_changed_by: typeof c.actorUid === 'string' && c.actorUid ? c.actorUid : null,
      stage_changed_at: now,
    };
    if (to === 'acquired') patch.acquired_at = now;
    if (to === 'passed')   patch.passed_at   = now;
    return { ok: true, from: from, to: to, patch: patch };
  }

  /** True when a PostgREST/Supabase error says the stage column does not exist (pre-023). */
  function isStageColumnMissing(err) {
    if (!err) return false;
    var msg = String(err.message || err.error || err.raw || err || '');
    return /lifecycle_stage/.test(msg) && (/does not exist|42703|column/i.test(msg) || err.code === '42703');
  }

  function label(stage) { return LABELS[stage] || String(stage || ''); }

  return {
    STAGES: STAGES, PRE_ACQUISITION: PRE_ACQUISITION, MANAGED: MANAGED, DEFAULT_STAGE: DEFAULT_STAGE,
    LABELS: LABELS, TRANSITIONS: TRANSITIONS, STAGE_COLUMNS: STAGE_COLUMNS,
    SELECT_COLUMNS: SELECT_COLUMNS, SELECT_COLUMNS_PRE_023: SELECT_COLUMNS_PRE_023, MANAGED_FILTER: MANAGED_FILTER,
    isKnownStage: isKnownStage, stageOf: stageOf, label: label,
    isManaged: isManaged, isProspect: isProspect, isPreAcquisition: isPreAcquisition, isPassed: isPassed,
    shape: shape, classify: classify, managedOnly: managedOnly, visibility: visibility,
    canTransition: canTransition, transition: transition, isStageColumnMissing: isStageColumnMissing,
  };
});
