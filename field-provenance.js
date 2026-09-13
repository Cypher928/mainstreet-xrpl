'use strict';
/**
 * field-provenance.js — where a lease field's value actually came from.
 *
 * THE DEFECT THIS EXISTS FOR
 *
 * `getFieldConfidence()` decided whether a field was "verified", and for most
 * fields the entire test was whether the value was non-empty. `case 'cap'` and
 * the `default:` branch — which between them cover cap, admin_fee_pct,
 * admin_fee_basis, gross_up_pct, expense_stop, audit_rights, pro_rata_method,
 * renewal_options, excluded_categories, base_rent, security_deposit,
 * capBaseAmount and tenant_name — returned
 *
 *     { status: 'verified', source: 'structured',
 *       note: 'Extracted from lease document' }
 *
 * on presence alone. Measured in the running app: a cap typed by hand into a
 * property with no document at all rendered byte-identically to one read off a
 * 25,824-character lease, and identically again to one carrying a verbatim
 * clause AND a page number. Roughly 449 of the ~501 Pilot field values reading
 * "verified" had nothing behind them, and the 52 that could genuinely cite a
 * clause were indistinguishable from the rest.
 *
 * THE PRODUCT ALREADY KNEW THE RIGHT RULE. lease-review-packets.js's
 * `_lenderVerification()` has always computed it correctly for the lender
 * packet, in its own words: "VERIFIED every populated key field quotes the
 * executed document / INFERRED a value exists but nothing cites it." That
 * belief was applied at tenant-roster granularity in a report and a weaker one
 * at field granularity on the screen a manager actually uses. This module
 * promotes the correct rule to per-field, and getFieldConfidence delegates to it
 * rather than inferring a second answer.
 *
 * ── PROVENANCE IS A PROPERTY OF THE CURRENT VALUE ───────────────────────────
 *
 * The single idea that makes the precedence rules fall out. A field's
 * provenance is decided by the MOST RECENT act on that field, not by the union
 * of everything that ever happened to it.
 *
 * `hasFieldQuote()` asked `snapshots.some(s => s.quote)` — ANY snapshot, ever.
 * So a clause captured for an old value would still vouch for a new one: a
 * re-extraction that found no quote, or a manual correction that replaced the
 * quoted figure, both kept reading as lease-confirmed on the strength of a
 * citation that no longer supports what is on screen. Reading the latest
 * non-superseded snapshot instead is what makes "re-extraction cannot resurrect
 * an old confirmation" true, and its mirror — "a manual correction is not
 * vouched for by the clause it overrode" — true as well.
 *
 * ── THE FIVE STATES ─────────────────────────────────────────────────────────
 *
 *   lease_confirmed      a clause or a page supports THIS value. The only state
 *                        allowed to say the words "lease document".
 *   manually_confirmed   a named reviewer approved this field. A person is the
 *                        authority — the lease's is not borrowed for them.
 *   manually_entered     a person typed or corrected the value. Asserting, not
 *                        checking; and never "AI-extracted".
 *   ai_extracted         a model read a document and nothing points at the
 *                        passage. The honest floor, never skipped past.
 *   unknown              no value, or nothing readable. Never promoted because
 *                        a value happens to exist.
 *
 * CONFLICT IS NOT ON THIS SCALE, and deliberately so — the same call
 * `_lenderVerification` makes. Two sources disagreeing about a field is not a
 * point between "cited" and "uncited"; a tenant whose lease states an 18.54%
 * share while its square footage derives 22.25% has plenty of evidence, it just
 * disagrees with itself. Conflict detection stays where it lives, in the audit
 * layer, and this module says nothing about it.
 *
 * ── WHAT THIS MODULE WILL NOT DO ────────────────────────────────────────────
 *
 * It will not read `tenant_review_audit`. All 44 of Pilot's rows carry
 * `action: 'tenant_confirmed'` and `field_key: null` — they are the bulk
 * "Confirm N CAM-ready extractions" button, which confirms a TENANT. They name
 * a real reviewer at a real time and they are worth keeping, as a tenant-level
 * review state. Turning them into field provenance would manufacture the claim
 * "a person checked this cap" from a record that says nothing of the kind,
 * which is the same overreach one level up.
 *
 * It will not invent provenance a row cannot establish. Every existing Pilot
 * evidence row — estimated, unapproved, unedited, page-less — resolves to
 * `ai_extracted`, which is exactly what it is. No backfill is needed and none
 * should be written.
 */

(function (root) {

  var STATES = ['lease_confirmed', 'manually_confirmed', 'manually_entered', 'ai_extracted', 'unknown'];

  /**
   * Fields NO EXTRACTION PATH CAN SUPPLY, so `ai_extracted` is not their floor.
   *
   * `ai_extracted` means something specific — "a model read a document and
   * nothing points at the passage". For most fields that is the honest floor,
   * because the extractor really did produce the value and simply cited
   * nothing. For a field the extractor cannot produce at all, it is a false
   * statement about origin in the opposite direction: it credits a machine for
   * a number a person typed.
   *
   * cap_base_amount is the case. Verified against the write paths, not assumed:
   * /api/claude's contract has no cap-base key in either the value channel or
   * the parallel `quotes` channel, `_quoteMap` has no entry for it, and the
   * only writers in the codebase are the manual form (handleFieldBlur →
   * script.js:8532) and hardcoded demo/acquisition seed literals.
   * lease-intelligence.js has said so in prose since Phase 0 — "capBaseAmount
   * is manual entry and extraction never sets it".
   *
   * So when such a field has a value and nothing affirms it, the floor is
   * `manually_entered`: a person put it there, asserting rather than checking.
   * That is the weakest TRUE claim available. The three states above the floor
   * are unaffected — a cap base that later arrives with a clause still reaches
   * lease_confirmed by exactly the same rule as every other field.
   *
   * This map is deliberately about where a value CAN come from, not about
   * trust. It adds no state, changes no precedence, and is empty of policy
   * beyond a fact each entry has to be able to prove.
   */
  var NEVER_EXTRACTED = { cap_base_amount: true };

  /**
   * The storage vocabulary, which has three values and cannot hold five.
   *
   * `tenant_field_evidence.confidence_status` is CHECK-constrained to
   * verified | estimated | missing. Rather than widen the constraint, the five
   * states project onto it along the axis the column actually names — was this
   * reading affirmatively established, or is it a machine's unchecked output.
   *
   *   verified   a clause supports it, or a named reviewer approved it
   *   estimated  a value with no affirmative confirmation — an extraction
   *              nobody checked, or data entry, which is not verification
   *   missing    nothing to evaluate
   *
   * The line is drawn so an uncited AI value can never reach `verified`, which
   * is the whole point. The projection is lossy by design and the exact state
   * travels beside it in `confidence_note`, which is free text.
   */
  var DB_STATUS = {
    lease_confirmed:    'verified',
    manually_confirmed: 'verified',
    manually_entered:   'estimated',
    ai_extracted:       'estimated',
    unknown:            'missing',
  };

  /**
   * The in-app four-status contract, which predates this module and which many
   * surfaces already branch on. It stays a PROJECTION of the state above, never
   * a second opinion: `manual` continues to mean "a person is behind this",
   * `verified` narrows to mean "the document is behind this", and `estimated`
   * keeps its existing sub-reasons (heuristic, ocr, extraction) intact.
   */
  var UI_STATUS = {
    lease_confirmed:    'verified',
    manually_confirmed: 'manual',
    manually_entered:   'manual',
    ai_extracted:       'estimated',
    unknown:            'missing',
  };

  var LABEL = {
    lease_confirmed:    'Extracted from lease document',
    manually_confirmed: 'Manually confirmed',
    manually_entered:   'Manually entered',
    ai_extracted:       'AI extraction — no supporting clause captured',
    unknown:            'Not found',
  };

  /** The method wording the Lease Review Workspace already uses, so one answer feeds both. */
  var METHOD = {
    lease_confirmed:    'AI Extraction',
    manually_confirmed: 'Manually Confirmed',
    manually_entered:   'Manually Entered',
    ai_extracted:       'AI Extraction',
    unknown:            'Not Found',
  };

  function _isEmpty(v) {
    return v === null || v === undefined || String(v).trim() === '';
  }

  function _time(v) {
    if (!v) return 0;
    var n = new Date(v).getTime();
    return isFinite(n) ? n : 0;
  }

  /**
   * ── M8d: DOES THIS SNAPSHOT DESCRIBE THE VALUE ON SCREEN? ──────────────────
   *
   * The module header already commits to this: "a manual correction is not
   * vouched for by the clause it overrode." It enforced that only for edits that
   * left a RECORD — a `manuallyEdited` snapshot, or a reviewOverride. The M8
   * final-gate audit measured the case where an edit leaves no record at all.
   *
   * `handleFieldBlur` → `updateTenantField` writes `pt[field] = value` and
   * nothing else: no snapshot, no override, no audit row. Six of the thirteen
   * canonical fields are edited that way — cap, tenant_name, leased_sqft,
   * start_date, end_date, lease_type — and the CAM Cap input renders the
   * citation chip directly beside itself. So a user corrected a cap from 5 to 6
   * while looking at the clause stating five percent, and afterwards:
   *
   *     value 6 · state lease_confirmed · cited true · page 12
   *     quote "shall not increase by more than five percent (5%) annually"
   *     label "Extracted from lease document"
   *
   * A fabricated citation: the document is real, the clause is real, and it does
   * not say six. Nothing in the response contradicted it.
   *
   * The evidence row carried what it needed all along. `tenant_field_evidence`
   * has a `value` column, both _evidenceRowToSnapshot implementations copy it
   * onto the snapshot, and this resolver has never looked at it. Comparing it to
   * the value being judged is the whole fix, and it lives here — in the
   * canonical layer — rather than in the write path, because a read model that
   * depends on every writer behaving is not a verified-memory system.
   *
   * WHAT COUNTS AS A CONTRADICTION, AND WHAT DOES NOT
   *
   * Only a snapshot that HAS a value and DISAGREES with the current one. A
   * snapshot with no value on file cannot contradict anything and is left
   * exactly as it was — that is most of the existing corpus, and demoting it
   * would be inventing a disagreement to go with a silence.
   *
   * The column is TEXT, so the comparison has to be. `5` and `'5'` are the same
   * cap, `4.5` and `'4.50'` the same expense stop, `true` and `'true'` the same
   * audit right. Numeric equality is tried before string equality precisely so
   * that a faithful round-trip through a text column is not read as an edit.
   */
  /**
   * Same value, allowing for the evidence column storing everything as text.
   *
   * Three comparisons, in order, and nothing else. Deliberately NOT tolerant
   * beyond format: '5' and '5%' are different strings and neither is a number,
   * so they count as different — refusing to certify is the safe direction when
   * two readings cannot be reconciled.
   *
   * NO BOOLEAN BRANCH, and that is a measured decision rather than an omission.
   * The first draft had one. `String(true)` is 'true', so a boolean and its text
   * form are already equal at the first comparison, and a case difference is
   * already equal at the third — an exhaustive sweep over 400 pairs of booleans,
   * their text forms, mixed casing, 0/1 and non-boolean strings found zero pairs
   * where the branch changed the answer. Two mutants of it survived precisely
   * because it could not affect anything. A branch that cannot fire still asks
   * to be read and maintained as though it could, so it is gone; audit_rights,
   * the one boolean canonical field, is covered by the tests either way.
   */
  function _sameValue(a, b) {
    var sa = String(a).trim(), sb = String(b).trim();
    if (sa === sb) return true;

    if (sa !== '' && sb !== '') {
      var na = Number(sa), nb = Number(sb);
      if (isFinite(na) && isFinite(nb)) return na === nb;
    }
    return sa.toLowerCase() === sb.toLowerCase();
  }

  /**
   * True only when the snapshot states a value and it is not the current one.
   * Absent, null or blank evidence values return false: unverifiable, not wrong.
   */
  function _evidenceContradicts(snap, raw) {
    if (!snap || typeof snap !== 'object') return false;
    if (!('value' in snap)) return false;
    if (_isEmpty(snap.value)) return false;
    return !_sameValue(snap.value, raw);
  }

  /**
   * The snapshot that describes the value on screen right now.
   *
   * Superseded snapshots are skipped — that flag exists precisely to say "this
   * one no longer describes the field" — and the newest of what remains wins.
   * Falls back to array order when nothing carries a usable timestamp, which is
   * the order persistFieldEvidence appends in.
   */
  function latestSnapshot(fieldKey, tenant) {
    var snaps = (tenant && tenant.fieldEvidence && tenant.fieldEvidence[fieldKey]
                 && tenant.fieldEvidence[fieldKey].snapshots) || [];
    var live = [];
    for (var i = 0; i < snaps.length; i++) {
      if (snaps[i] && snaps[i].superseded !== true) live.push({ s: snaps[i], i: i });
    }
    if (!live.length) return null;
    var best = live[0];
    for (var j = 1; j < live.length; j++) {
      var a = _time(live[j].s.reviewedAt) || _time(live[j].s.extractedAt);
      var b = _time(best.s.reviewedAt)    || _time(best.s.extractedAt);
      if (a > b || (a === b && live[j].i > best.i)) best = live[j];
    }
    return best.s;
  }

  /**
   * Resolve where a field's current value came from.
   *
   * @param {string} fieldKey
   * @param {object} tenant
   * @param {{value?:*}} [opts] value override — for derived fields such as
   *        proRata that are computed rather than stored on the tenant.
   */
  function fieldProvenance(fieldKey, tenant, opts) {
    var t = tenant || {};
    var raw = (opts && 'value' in opts) ? opts.value : t[fieldKey];

    var out = {
      field: fieldKey, state: 'unknown', stated: false, cited: false,
      by: null, when: null, quote: null, page: null, sourceFile: null,
      label: LABEL.unknown, method: METHOD.unknown,
      uiStatus: UI_STATUS.unknown, dbStatus: DB_STATUS.unknown,
      // M8d. Additive, and deliberately NOT a sixth state: the five states are
      // branched on across the app and the DB/UI projections map onto them, so
      // widening that scale would be a semantic change. This says only why a
      // field that has evidence on file is nonetheless uncited — the evidence
      // describes a different value than the one being reported.
      evidenceStale: false,
    };

    // 1. UNKNOWN STAYS UNKNOWN. Nothing below may promote a field because a
    //    value happens to exist somewhere else on the tenant.
    if (_isEmpty(raw)) return out;

    var snap = latestSnapshot(fieldKey, t);
    var ov   = (t.reviewOverrides && t.reviewOverrides[fieldKey]) || null;
    var ovConfirmed = !!(ov && ov.reviewerConfirmed);

    // WHICH HUMAN ACT IS CURRENT. reviewOverrides has no snapshot timeline of
    // its own, so a re-extraction that appends a fresh AI snapshot after an
    // override has to be able to win. Comparing the two timestamps is what
    // stops an old manual confirmation being resurrected by a later extraction
    // — and, in the other direction, stops a later extraction erasing an
    // override that came after it.
    var ovAt   = ovConfirmed ? _time(ov.reviewedAt) : 0;
    var snapAt = snap ? (_time(snap.reviewedAt) || _time(snap.extractedAt)) : 0;
    var overrideIsCurrent = ovConfirmed && (!snap || ovAt >= snapAt);

    var snapManual   = !!(snap && snap.manuallyEdited === true);
    var snapReviewer = (snap && (snap.reviewerEmail || snap.reviewerUid)) || null;
    var snapApproved = !!(snap && snap.approved === true && snapReviewer);

    // M8d — a snapshot that states a DIFFERENT value cannot certify this one.
    //
    // Gates both certifying branches, not just the citation. An approval is a
    // claim that a named person checked THIS figure; if the figure has changed
    // since, that claim is about a number they never saw, and attaching their
    // name to it is the same fabrication as attaching the clause. What survives
    // is the manual branch below — `manuallyEdited` and reviewOverrides are
    // records OF an edit, so they describe the edit rather than a superseded
    // reading, and demoting them would lose a true fact.
    var stale = _evidenceContradicts(snap, raw);
    out.evidenceStale = stale;

    // 2. A HUMAN ACT ON THIS FIELD OUTRANKS A CITATION, because a citation
    //    describes the value it was captured for. A reviewer who corrected a
    //    figure is not vouched for by the clause that stated the old one.
    if (snapApproved && !snapManual && !stale) {
      out.state = 'manually_confirmed'; out.stated = true;
      out.by = snapReviewer; out.when = snap.reviewedAt || null;
      // A confirmed field may ALSO carry the clause it was confirmed against.
      // That is worth keeping and showing; it does not change who the authority
      // is, so it travels as evidence rather than as the state.
      out.quote = snap.quote || null; out.page = (snap.page != null ? snap.page : null);
      out.sourceFile = snap.sourceFile || null;
      out.cited = !!(out.quote || out.page != null);
    } else if (snapManual || overrideIsCurrent) {
      out.state = 'manually_entered'; out.stated = true;
      out.by = snapReviewer || null;
      out.when = (overrideIsCurrent && ov.reviewedAt) || (snap && snap.reviewedAt) || null;
      out.sourceFile = null;    // a typed value has no source document
    } else if (snap && !stale && (snap.quote || snap.page != null)) {
      // 3. LEASE-CONFIRMED REQUIRES A CITATION ON THE CURRENT SNAPSHOT, and
      //    (M8d) a snapshot whose own value is the one the citation supports.
      //    Never on any snapshot ever taken, and never on presence alone.
      out.state = 'lease_confirmed'; out.stated = true; out.cited = true;
      out.quote = snap.quote || null;
      out.page = (snap.page != null ? snap.page : null);
      out.sourceFile = snap.sourceFile || null;
      out.when = snap.extractedAt || snap.reviewedAt || null;
    } else if (NEVER_EXTRACTED[fieldKey] === true) {
      // 4a. THE FLOOR, for a field no extractor can produce. Crediting a model
      //     for it would be as wrong as crediting the lease. A person typed it.
      out.state = 'manually_entered'; out.stated = true;
      out.by = null;                  // nothing on file names who; see saveFieldOverride
      out.sourceFile = null;          // a typed value has no source document
      out.when = (stale ? null
                        : (snap && (snap.reviewedAt || snap.extractedAt))) || null;
    } else {
      // 4. THE FLOOR. A value exists and nothing affirms it.
      //
      // M8d — a stale snapshot reaches this floor, and must not furnish it. Its
      // sourceFile and timestamp belong to the reading it captured, not to the
      // value being reported: dating the current cap to the extraction that
      // found a different one is the same overstatement one notch quieter. The
      // tenant's own fileName still stands — it says which document is on file,
      // never that this value came out of it.
      out.state = 'ai_extracted';
      out.sourceFile = (stale ? null : (snap && snap.sourceFile)) || t.fileName || null;
      out.when = (stale ? null : (snap && (snap.extractedAt || snap.reviewedAt))) || null;
    }

    out.label    = LABEL[out.state];
    out.method   = METHOD[out.state];
    out.uiStatus = UI_STATUS[out.state];
    out.dbStatus = DB_STATUS[out.state];
    return out;
  }

  /** True only for the one state permitted to name the document. */
  function isLeaseConfirmed(fieldKey, tenant, opts) {
    return fieldProvenance(fieldKey, tenant, opts).state === 'lease_confirmed';
  }
  /** True when a person — not a model — is the authority for this value. */
  function isHumanBacked(fieldKey, tenant, opts) {
    var s = fieldProvenance(fieldKey, tenant, opts).state;
    return s === 'manually_confirmed' || s === 'manually_entered';
  }

  var api = {
    STATES: STATES, DB_STATUS: DB_STATUS, UI_STATUS: UI_STATUS,
    LABEL: LABEL, METHOD: METHOD,
    // M8a. Exported, not duplicated. PropertyRecord projects a field's ORIGIN
    // alongside its value, and "no extractor can produce this" is a fact this
    // module already owns and already acts on (see the 4a floor above). A
    // reader that restated the list would be a second place to keep in step;
    // test-m8 asserts this export agrees with the behaviour it describes.
    // Additive: nothing here changes what fieldProvenance() returns.
    NEVER_EXTRACTED: NEVER_EXTRACTED,
    fieldProvenance: fieldProvenance, latestSnapshot: latestSnapshot,
    isLeaseConfirmed: isLeaseConfirmed, isHumanBacked: isHumanBacked,
  };
  if (root) root.FieldProvenance = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

})(typeof window !== 'undefined' ? window : null);
