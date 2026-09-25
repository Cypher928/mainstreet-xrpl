'use strict';
/**
 * acquisition-workspace.js — the Acquisition Review record, owned in one place.
 *
 * Phase 1 of Acquisition Review (docs/ACQUISITION_REVIEW.md), increment P1-1.
 *
 * WHAT THIS IS
 *
 * An `acquisition_reviews` row is `{ id, user_id, name, status, data, … }` and
 * everything the review knows lives in `data` (jsonb). Until now that object
 * was shaped by whichever function last wrote to it: createAcquisitionReview
 * seeded five keys, the demo seed six, the conversion path two more, and
 * nothing said which keys a review is guaranteed to have. Every later Phase 1
 * increment — documents, families, financials, attention, the report — adds
 * to this object, so its shape has to be decided before any of them write.
 *
 * This module is that decision. It is pure: no DOM, no network, no globals.
 * script.js's acquisition glue calls it and applies the result; nothing here
 * touches a review in place.
 *
 * THREE RULES IT ENFORCES
 *
 *   1. UPGRADE MERGES, NEVER REPLACES. `upgradeReview` brings any stored row —
 *      legacy or current — to the v2 shape by adding what is missing. It never
 *      removes a key and never rewrites a value that is present, so a review's
 *      tenants, invoices, analysis, conversion record and conversion history
 *      survive byte-for-byte (ARCHITECTURE_PRINCIPLES §6). It is idempotent:
 *      upgrading an upgraded review changes nothing.
 *
 *   2. THE STAGE IS A RECORDED DECISION, NOT A GUESS. `data.stage` is set by a
 *      person (setStage) or by the acquisition itself (markAcquired). For a
 *      review written before stages existed, `deriveStage` makes ONE initial
 *      reading from the facts on file and that reading is then stored, so it
 *      cannot drift later. The one non-negotiable: a converted review IS
 *      acquired, whatever its stored stage says.
 *
 *   3. A SAVE MUST NOT OVERWRITE WHAT IT HAS NOT SEEN. `savePayload` and
 *      `classifySaveResult` are the two halves of a conditional write: the glue
 *      updates the row only where `updated_at` still equals the value it last
 *      read, and an update that matches no row is reported as a CONFLICT — the
 *      row changed underneath — never as success. The glue then reloads the
 *      stored version and says so. Silently winning was the previous behaviour.
 */
(function (root) {

  var SCHEMA_VERSION = 2;

  // ── Stages ────────────────────────────────────────────────────────────────
  // The workflow, in order. `acquired` is terminal and is only ever set by the
  // conversion path (markAcquired); a person cannot click into it.
  var STAGES = ['intake', 'abstraction', 'financials', 'review', 'report', 'acquired'];
  var STAGE_LABELS = {
    intake:      'Intake',
    abstraction: 'Abstraction',
    financials:  'Financials',
    review:      'Review',
    report:      'Report',
    acquired:    'Acquired',
  };
  var TERMINAL_STAGE = 'acquired';

  // ── Activity ──────────────────────────────────────────────────────────────
  // The vocabulary the glue records with. Not enforced on write — a future
  // increment adds its own types — but tested: every type script.js emits must
  // be listed here, so the list stays a true inventory.
  var ACTIVITY_TYPES = [
    'review_created',
    'stage_changed',
    'documents_added',
    'analysis_run',
    'converted',
    'conversion_reverted',
    'extraction_resolved',   // a person matched, established or dismissed an unmatched extraction
    'extraction_reopened',
    'document_disposed',     // a person marked a source document not relevant, or a duplicate
    'document_reopened',
  ];
  // History is kept, not trimmed, until it is genuinely large. When the cap is
  // hit the oldest entries go and `activityDropped` says how many, so the
  // record admits what it no longer holds rather than pretending to be whole.
  var ACTIVITY_CAP = 500;

  function _isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function _arr(v)   { return Array.isArray(v) ? v : []; }

  function isValidStage(s) { return STAGES.indexOf(s) !== -1; }
  function stageIndex(s)   { return STAGES.indexOf(s); }

  /** True when the row has been converted into a property that the record still vouches for. */
  function isConverted(review) {
    var d = review && _isObj(review.data) ? review.data : {};
    return review && review.status === 'converted'
      && _isObj(d.conversionRecord) && !!d.conversionRecord.propertyId;
  }

  /**
   * The initial reading for a review that has never had a stage set.
   *
   * Deliberately coarse. `financials` and `review` are never derived: nothing
   * a pre-v2 review holds can say whether financials were taken in or a
   * review was performed, and guessing either would put a stage on the record
   * that no one chose. Analysis on file means the manager got as far as the
   * report; leases or invoices on file means abstraction had begun; anything
   * else is intake.
   */
  function _deriveFromFacts(review) {
    var d = review && _isObj(review.data) ? review.data : {};
    if (_isObj(d.analysis)) return 'report';
    if (_arr(d.tenants).length || _arr(d.invoices).length || _arr(d.documents).length) return 'abstraction';
    return 'intake';
  }
  function deriveStage(review) {
    if (isConverted(review)) return TERMINAL_STAGE;
    return _deriveFromFacts(review);
  }

  /**
   * The stage the review is at right now.
   *
   * A converted review is acquired regardless of `data.stage`. Otherwise the
   * stored stage stands — unless it claims `acquired` for a review that is not
   * converted (a revert happened), in which case it is re-derived.
   */
  function stageOf(review) {
    if (isConverted(review)) return TERMINAL_STAGE;
    var d = review && _isObj(review.data) ? review.data : {};
    if (isValidStage(d.stage) && d.stage !== TERMINAL_STAGE) return d.stage;
    return deriveStage(review);
  }

  // ── The record shape ──────────────────────────────────────────────────────

  /** The data object a brand-new review is created with. */
  function newReviewData() {
    return {
      schemaVersion: SCHEMA_VERSION,
      stage:         'intake',
      tenants:       [],
      invoices:      [],
      totalSqFt:     0,
      documents:     [],
      families:      [],
      assumptions:   [],
      activity:      [],
      activityCount: 0,
      activityDropped: 0,
      analysis:      null,
    };
  }

  /**
   * Bring a stored row to the v2 shape. Pure; returns a new row object with a
   * new `data` object. Every key already present is carried through unchanged
   * (the copy is shallow — arrays and nested objects are the same references,
   * which is what lets the glue keep its in-memory identity trick). Missing
   * keys are filled with their empty value. Idempotent.
   */
  function upgradeReview(row) {
    var src  = row && _isObj(row.data) ? row.data : {};
    var data = {};
    var k;
    for (k in src) if (Object.prototype.hasOwnProperty.call(src, k)) data[k] = src[k];

    var existingVersion = typeof src.schemaVersion === 'number' ? src.schemaVersion : 0;
    data.schemaVersion = Math.max(existingVersion, SCHEMA_VERSION);
    data.tenants       = _arr(src.tenants);
    data.invoices      = _arr(src.invoices);
    data.totalSqFt     = src.totalSqFt != null ? src.totalSqFt : 0;
    data.documents     = _arr(src.documents);
    data.families      = _arr(src.families);
    data.assumptions   = _arr(src.assumptions);
    data.activity      = _arr(src.activity);
    data.activityCount = typeof src.activityCount === 'number' ? src.activityCount : data.activity.length;
    data.activityDropped = typeof src.activityDropped === 'number' ? src.activityDropped : 0;
    data.analysis      = src.analysis === undefined ? null : src.analysis;

    var out = {};
    for (k in (row || {})) if (Object.prototype.hasOwnProperty.call(row, k)) out[k] = row[k];
    out.data = data;
    // The one stored value upgrade is allowed to set: a stage the row never had,
    // or one contradicted by the conversion facts. stageOf already applies both
    // rules, so writing its answer back is what makes them stick.
    data.stage = stageOf(out);
    return out;
  }

  /** True when upgradeReview would change the stored data. */
  function needsUpgrade(row) {
    var before = row && _isObj(row.data) ? row.data : null;
    if (!before) return true;
    var after = upgradeReview(row).data;
    try { return JSON.stringify(before) !== JSON.stringify(after); }
    catch (_) { return true; }
  }

  // ── Activity ──────────────────────────────────────────────────────────────

  function _normActor(actor) {
    if (!_isObj(actor)) return null;
    var uid   = actor.uid   != null ? String(actor.uid)   : (actor.id != null ? String(actor.id) : null);
    var email = actor.email != null ? String(actor.email) : null;
    if (!uid && !email) return null;
    return { uid: uid, email: email };
  }

  /**
   * Append one activity entry. Pure: returns a new row with a new `data` and a
   * new `activity` array; the input is untouched.
   *
   * entry: { type, summary, actor?, meta?, at?, id? }
   *   type    — one of ACTIVITY_TYPES (a string; required)
   *   summary — one line a person can read (required)
   *   actor   — { uid, email } or null (a system act)
   *   meta    — small structured detail; kept as given
   *   at      — ISO timestamp; defaults to now. Tests pass it for determinism.
   */
  function recordActivity(row, entry) {
    var e = _isObj(entry) ? entry : {};
    var type = typeof e.type === 'string' ? e.type.trim() : '';
    var summary = typeof e.summary === 'string' ? e.summary.trim() : '';
    if (!type || !summary) throw new Error('recordActivity: type and summary are required');

    var up   = upgradeReview(row);
    var data = up.data;
    var count = data.activityCount + 1;
    var at = typeof e.at === 'string' && e.at ? e.at : new Date().toISOString();
    var rec = {
      id:      typeof e.id === 'string' && e.id ? e.id : ('act-' + count + '-' + at.replace(/[^0-9]/g, '').slice(0, 17)),
      at:      at,
      type:    type,
      actor:   _normActor(e.actor),
      summary: summary,
      meta:    _isObj(e.meta) ? e.meta : null,
    };

    var next = data.activity.concat([rec]);
    var dropped = data.activityDropped;
    if (next.length > ACTIVITY_CAP) {
      dropped += next.length - ACTIVITY_CAP;
      next = next.slice(next.length - ACTIVITY_CAP);
    }
    data.activity = next;
    data.activityCount = count;
    data.activityDropped = dropped;
    return up;
  }

  // ── Stage transitions ─────────────────────────────────────────────────────

  /**
   * A person moves the review to a stage.
   *
   * Returns { ok, review, changed, reason }. Refuses: an unknown stage; the
   * terminal stage (only the acquisition sets it); any change once the review
   * is acquired. Moving to the stage it is already at is ok and records
   * nothing — a no-op is not an event.
   */
  function setStage(row, stage, opts) {
    var o = _isObj(opts) ? opts : {};
    if (!isValidStage(stage))      return { ok: false, review: row, changed: false, reason: 'unknown_stage' };
    if (stage === TERMINAL_STAGE)  return { ok: false, review: row, changed: false, reason: 'acquired_is_set_by_conversion' };
    var up = upgradeReview(row);
    var from = stageOf(up);
    if (from === TERMINAL_STAGE)   return { ok: false, review: up, changed: false, reason: 'locked_after_acquisition' };
    if (from === stage)            return { ok: true,  review: up, changed: false, reason: null };
    up.data.stage = stage;
    var out = recordActivity(up, {
      type: 'stage_changed', actor: o.actor, at: o.at, id: o.id,
      summary: 'Stage set to ' + STAGE_LABELS[stage] + ' (was ' + STAGE_LABELS[from] + ')',
      meta: { from: from, to: stage },
    });
    return { ok: true, review: out, changed: true, reason: null };
  }

  /**
   * The conversion path: the review became a property. Called AFTER the glue
   * has set status='converted' and data.conversionRecord, so stageOf already
   * says acquired; this writes that stage down and records the act.
   */
  function markAcquired(row, opts) {
    var o = _isObj(opts) ? opts : {};
    // Where it was BEFORE the acquisition: the stored stage, read off the input
    // (upgradeReview would already rewrite it to acquired, since the glue has
    // set the conversion facts by now), or the facts if none was stored.
    var stored = row && _isObj(row.data) ? row.data.stage : null;
    var from = (isValidStage(stored) && stored !== TERMINAL_STAGE) ? stored : _deriveFromFacts(row);
    var up = upgradeReview(row);
    up.data.stage = TERMINAL_STAGE;
    var pid = up.data.conversionRecord && up.data.conversionRecord.propertyId;
    return recordActivity(up, {
      type: 'converted', actor: o.actor, at: o.at, id: o.id,
      summary: o.summary || ('Acquired — converted to property' + (up.data.conversionRecord && up.data.conversionRecord.propertyName ? ' ' + up.data.conversionRecord.propertyName : '')),
      meta: { from: from, propertyId: pid || null, repair: !!o.repair },
    });
  }

  /**
   * The property this review was converted to was deleted and the conversion
   * was reverted. Called AFTER the glue has cleared conversionRecord and set
   * status back, so the stage is re-derived from what remains.
   */
  function markReverted(row, opts) {
    var o = _isObj(opts) ? opts : {};
    var up = upgradeReview(row);
    up.data.stage = deriveStage(up);
    return recordActivity(up, {
      type: 'conversion_reverted', actor: o.actor, at: o.at, id: o.id,
      summary: o.summary || 'Conversion reverted — the property it created was deleted',
      meta: { to: up.data.stage, propertyId: o.propertyId || null },
    });
  }

  // ── Presentation model ────────────────────────────────────────────────────

  /**
   * The chips the detail header renders, in order. Pure view model:
   *   { key, label, state: 'done' | 'current' | 'upcoming', selectable }
   * Nothing is selectable on an acquired review, and `acquired` is never
   * selectable — the acquisition sets it.
   */
  function stageChips(row) {
    var current = stageOf(row);
    var ci = stageIndex(current);
    var locked = current === TERMINAL_STAGE;
    return STAGES.map(function (key, i) {
      return {
        key: key,
        label: STAGE_LABELS[key],
        state: i < ci ? 'done' : (i === ci ? 'current' : 'upcoming'),
        selectable: !locked && key !== TERMINAL_STAGE,
      };
    });
  }

  // ── Persistence contract ──────────────────────────────────────────────────

  /**
   * The columns a save writes — and only those. `id` and `user_id` are the
   * WHERE clause, `updated_at` belongs to the database trigger, and anything
   * else on the in-memory object is not a column.
   */
  function savePayload(row) {
    var r = row || {};
    return {
      name:   r.name,
      status: r.status,
      data:   _isObj(r.data) ? r.data : {},
    };
  }

  /**
   * What a conditional update's response means.
   *
   *   { ok: true,  rev }            one row matched and was written; `rev` is
   *                                 its new updated_at (null if not returned)
   *   { ok: false, kind: 'error' }  the database refused
   *   { ok: false, kind: 'conflict' } no row matched AND the caller was
   *                                 filtering on a revision it had read —
   *                                 the row changed (or vanished) underneath
   *   { ok: false, kind: 'missing' } no row matched and there was no revision
   *                                 filter — the row does not exist yet
   */
  function classifySaveResult(res) {
    var r = _isObj(res) ? res : {};
    if (r.error) {
      var msg = _isObj(r.error) ? (r.error.message || 'save failed') : String(r.error);
      return { ok: false, kind: 'error', message: msg, code: _isObj(r.error) ? (r.error.code || null) : null };
    }
    var rows = _arr(r.rows);
    if (rows.length > 0) {
      var first = _isObj(rows[0]) ? rows[0] : {};
      return { ok: true, rev: first.updated_at != null ? String(first.updated_at) : null };
    }
    return { ok: false, kind: r.hadRev ? 'conflict' : 'missing', message: r.hadRev
      ? 'This review was changed elsewhere since it was loaded.'
      : 'No stored row matched this review.' };
  }

  var api = {
    SCHEMA_VERSION: SCHEMA_VERSION,
    STAGES: STAGES, STAGE_LABELS: STAGE_LABELS, TERMINAL_STAGE: TERMINAL_STAGE,
    ACTIVITY_TYPES: ACTIVITY_TYPES, ACTIVITY_CAP: ACTIVITY_CAP,
    isValidStage: isValidStage, stageIndex: stageIndex, isConverted: isConverted,
    deriveStage: deriveStage, stageOf: stageOf,
    newReviewData: newReviewData, upgradeReview: upgradeReview, needsUpgrade: needsUpgrade,
    recordActivity: recordActivity,
    setStage: setStage, markAcquired: markAcquired, markReverted: markReverted,
    stageChips: stageChips,
    savePayload: savePayload, classifySaveResult: classifySaveResult,
  };
  if (root) root.AcquisitionWorkspace = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

})(typeof window !== 'undefined' ? window : null);
