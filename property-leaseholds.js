/**
 * property-leaseholds.js — the canonical leaseholds of an ACQUIRED property, as
 * the Property Workspace reads them. Pure; no network, no DOM, no storage.
 *
 * UPLOAD/VERIFY ONCE → ACQUIRE → THE PROPERTY REMEMBERS IT.
 *
 * During an acquisition a person files documents into leaseholds
 * (acquisition_document_families), reads the terms out of them and records
 * decisions (acquisition_term_decisions). Migration 035 carries the leaseholds
 * across as tenants with THE SAME ID — `tenants.id = families.id` — and 034 had
 * already bound every family, document and decision to the property
 * (property_id). That equality is the whole join; there is no leasehold_id and
 * none is needed.
 *
 * WHAT THIS IS. A projection of those rows for one property, keyed by
 * leasehold id (= tenant id), so the Space file can list the documents on file
 * and say that a person verified the terms. It is built from rows the caller
 * has ALREADY read (by property_id, under the tables' membership RLS) and kept
 * in a module-level map keyed by property uuid.
 *
 * WHAT THIS IS NOT.
 *   · not a store: nothing here is written to properties.data, localStorage or
 *     any table; the map lives for the page and is replaced on every load;
 *   · not authoritative: the database rows are; a load REPLACES the property's
 *     entry, and clear() empties it before a fresh read so a stale set is never
 *     shown while the query is pending;
 *   · not cross-property: every accessor takes the property uuid, and build()
 *     drops any row whose property_id names a different property, so one
 *     property's leaseholds cannot surface on another even if a caller hands
 *     it the wrong rows;
 *   · not a tenant factory: it never creates, renames or reshapes a tenant.
 *
 * DOCUMENTS. A leasehold's documents are the live, confirmed ones: family_id =
 * the leasehold, family_status 'confirmed', not superseded. A document filed
 * nowhere (unfiled) or replaced by a later upload is not "on file" for a
 * tenant. A document links only when the current user is the uploader — the
 * storage path is keyed by the uploader's uid and /api/document-url signs only
 * for that owner — otherwise it is listed as on file without a link (an
 * honest chip, never a dead click). Aligning that ownership to membership is a
 * separate security review, not this module's business.
 *
 * DECISIONS. Grouped per leasehold, oldest first, with a summary (count, last
 * decided_at, per-field latest) so a surface can say "N term decisions by a
 * person" and locate the one behind a value.
 *
 * WHAT STANDS (P5-3). acquisition_term_decisions is an append-only history —
 * confirm, correct, reject, reopen — not a fact table. Per leasehold, `verified`
 * is the projection of the decision that currently STANDS for each field, by
 * the one rule the Acquisition Review itself applies (DecisionStanding.standing:
 * known actions, decided_at ascending, the last row; a last reopen ⇒ none).
 * A standing confirm or correct is a verified term; a correct with no source
 * document is an entered one; a standing reject says the reading was rejected;
 * a field whose last row is a reopen is open. The term VALUES the workspace
 * shows still come from the tenant row 035 wrote; this module does not
 * re-resolve terms and never changes a shown value — matchesShown() only lets a
 * surface SAY whether the shown value is the one that was decided.
 *
 * AT ACQUISITION (P5-4). What the acquisition left unresolved must still be
 * traceable after Acquire, WITHOUT a second attention store. Acquire keeps
 * every acquisition row in place; what it drops is the KIND of each gap
 * (contested / unclear / read by AI / not established), because the roster it
 * writes carries values only. The one place those kinds survive is the
 * converted review's own `data.analysis.canonical` — the analysis the Acquire
 * gate requires to be current. `atAcquisition` is a READ of that record:
 * structured `states` when the review has them (written since P5-4), else the
 * `fingerprint` it has always stored. Anything ambiguous — not exactly one
 * converted review, a basis other than leaseholds, an unknown field or state,
 * a leasehold that is not one of that review's, structured states that
 * disagree with the fingerprint — yields NOTHING rather than a guess.
 * `acquisitionAttention()` then derives, at render time, what is still open:
 * the state at acquisition × the standing decision (P5-3) × the value shown
 * now. Nothing here is stored, copied or editable; it is history, read.
 *
 * THE ACQUISITION EPISODE (P5-5). A property has one permanent identity; its
 * acquisition is an episode in that life, and the converted review IS that
 * episode's record. `episode` composes, at read time, what the permanent
 * workspace's History can say about it, from the canonical rows already read
 * here plus ONE more: the property's `stage_changed` rows in property_events.
 * It names the episode (the review, when it was opened and by whom), the
 * milestones its sources support (documents filed, leaseholds established,
 * decisions recorded, the analysis current at acquisition), the acquisition
 * itself (the ONE direct property_events row acquire_property wrote — its
 * actor and time; failing that the review's converted_at, with no actor) and
 * what the acquisition left unresolved (summed from `atAcquisition`). Nothing
 * is written; nothing from the episode is copied into the property; the
 * detail stays in the acquisition workspace, which History links to.
 *
 * window.PropertyLeaseholds in the browser; module.exports for Node.
 */
(function (root, factory) {
  var api = factory();
  if (root) root.PropertyLeaseholds = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  // The standing rule, shared with acquisition-terms.js. Pure and dependency-
  // free, so neither the Acquisition resolver nor its reasoner comes along.
  // Dual-resolved like the Space file's read of this module: the browser has
  // it on window; the server (the MCP hydrator) requires it.
  var _DS = (typeof window !== 'undefined' && window.DecisionStanding)
         || (typeof require === 'function' ? require('./decision-standing.js') : null);
  if (!_DS) throw new Error('property-leaseholds.js needs decision-standing.js loaded first');

  // ── The columns the loader asks for. Never the document text or the
  //    abstracted evidence: those are read by the code that reasons from them,
  //    one leasehold at a time, not by a list that shows a chip. ─────────────
  var FAMILY_COLUMNS = [
    'id', 'review_id', 'property_id', 'label', 'family_kind', 'tenant_hint', 'suite_hint',
    'created_at', 'updated_at',
  ];
  var DOCUMENT_COLUMNS = [
    'id', 'review_id', 'property_id', 'user_id', 'family_id', 'family_status',
    'file_name', 'storage_path', 'content_type', 'byte_size',
    'doc_type', 'doc_type_status', 'doc_date',
    'confirmed_by', 'confirmed_at', 'superseded_by_document_id', 'created_at',
  ];
  var DECISION_COLUMNS = [
    'id', 'review_id', 'property_id', 'family_id', 'field_key', 'action',
    'previous_value', 'new_value', 'source_document_id', 'source_quote', 'source_page',
    'decided_by', 'decided_at', 'note', 'created_at',
  ];
  // P5-4: the converted review, and of its data ONLY the analysis's canonical
  // block. Never `data` itself: that holds the raw upload rows (Maple's
  // unverified 2,800 sf Sunrise reading among them), and the workspace has no
  // business reading an unverified extraction.
  // P5-5 adds the episode's own facts: when it was opened (created_at), by
  // whom (user_id — the caller of begin_acquisition, the row's owner) and how
  // many acts its workspace recorded (data.activityCount, a number; never the
  // activity array itself, which is the acquisition workspace's to show).
  var REVIEW_COLUMNS = ['id', 'property_id', 'status', 'converted_at', 'created_at', 'user_id',
                        'activity_count:data->activityCount', 'canonical:data->analysis->canonical'];
  // P5-5: the property's lifecycle events. The loader asks for stage_changed
  // rows only; the projection then keeps the ONE direct row acquire_property
  // wrote (source_key null). Rows the 030 trigger mirrored from the blob
  // (source_key set) are the blob's history, already shown, never read here.
  var EVENT_COLUMNS = ['id', 'property_id', 'actor_uid', 'actor_email', 'action', 'subject_type', 'subject_id',
                       'old_value', 'new_value', 'detail', 'client_ts', 'created_at', 'source_key'];
  // P5-6B: the server's acquisition-memory read of the converted review — the
  // REVIEW_COLUMNS above plus exactly two more paths of its frozen data: the
  // invoices acquire_property carried (035 carries every object in this array)
  // and the conversion record (WALT / occupancy at acquisition). Still never
  // `data` itself. The browser's read (SELECT.reviews) is unchanged.
  var MEMORY_REVIEW_COLUMNS = REVIEW_COLUMNS.concat(['invoices:data->invoices', 'conversion:data->conversionRecord']);
  var SELECT = Object.freeze({
    families:  FAMILY_COLUMNS.join(', '),
    documents: DOCUMENT_COLUMNS.join(', '),
    decisions: DECISION_COLUMNS.join(', '),
    reviews:   REVIEW_COLUMNS.join(', '),
    events:    EVENT_COLUMNS.join(', '),
    memoryReviews: MEMORY_REVIEW_COLUMNS.join(', '),
  });

  var BUCKETS = { leases: 1, invoices: 1 };

  function _arr(v) { return Array.isArray(v) ? v.filter(Boolean) : []; }
  function _time(v) { var t = v ? new Date(v).getTime() : NaN; return isNaN(t) ? 0 : t; }
  function _sameProperty(row, propertyId) {
    // A row that names a property must name THIS one. A row with no property
    // column (an older fixture) is kept: the caller's query scoped it.
    return row.property_id == null || row.property_id === propertyId;
  }

  /**
   * The uploader of a stored object — the uid segment of its path, in any of
   * the forms the app holds: a bare "leases/<uid>/…", a public
   * "/storage/v1/object/public/leases/<uid>/…" or a signed URL. Null when the
   * reference is not one of ours. Mirrors api/document-url.js: bucket first,
   * then the owner.
   */
  function pathOwner(ref) {
    var s = String(ref || '');
    if (!s) return null;
    var m = /\/storage\/v1\/object\/(?:public|sign|authenticated)\/(.+)$/.exec(s);
    if (m) s = m[1];
    s = s.split('?')[0];
    var parts = s.split('/').filter(Boolean);
    if (!parts.length) return null;
    if (BUCKETS[parts[0]]) return parts[1] || null;
    return parts[0] || null;
  }

  /** A confirmed, live document of a leasehold. */
  function _isLiveFor(doc, familyId) {
    return !!doc && doc.family_id === familyId
      && !doc.superseded_by_document_id
      && doc.family_status === 'confirmed';
  }

  function _documentEntry(d, currentUid) {
    var owner = pathOwner(d.storage_path);
    var mine  = !!(owner && currentUid && owner === currentUid);
    return {
      id:           d.id || null,
      name:         d.file_name || 'Document',
      kind:         'pdf',
      docType:      d.doc_type || null,
      docTypeStatus: d.doc_type_status || null,
      when:         d.doc_date || d.confirmed_at || d.created_at || null,
      confirmed:    !!d.confirmed_at,
      storagePath:  d.storage_path || null,
      ownerUid:     owner,
      // The link, only for the uploader. Anyone else sees the document is on
      // file and gets no url — /api/document-url would refuse it anyway.
      url:          mine ? d.storage_path : null,
      uploadedByOther: !mine,
    };
  }

  function _decisionEntry(d) {
    return {
      id:            d.id || null,
      fieldKey:      d.field_key || null,
      action:        d.action || null,
      previousValue: d.previous_value === undefined ? null : d.previous_value,
      newValue:      d.new_value === undefined ? null : d.new_value,
      sourceDocumentId: d.source_document_id || null,
      sourceQuote:   d.source_quote || null,
      sourcePage:    d.source_page == null ? null : d.source_page,
      decidedBy:     d.decided_by || null,
      decidedAt:     d.decided_at || d.created_at || null,
      note:          d.note || null,
    };
  }

  function _decisionSummary(decisions) {
    var byField = {}, latestByField = {}, lastAt = null;
    decisions.forEach(function (d) {
      var k = d.fieldKey || '?';
      byField[k] = (byField[k] || 0) + 1;
      if (!latestByField[k] || _time(d.decidedAt) >= _time(latestByField[k].decidedAt)) latestByField[k] = d;
      if (!lastAt || _time(d.decidedAt) > _time(lastAt)) lastAt = d.decidedAt;
    });
    return { count: decisions.length, lastAt: lastAt, byField: byField, latestByField: latestByField };
  }

  // ── P5-3: what a person decided, as the Space file may say it ──────────────

  // The 27 term labels, as AcquisitionTerms.FIELD_META names them. A copy, not
  // a require: the Property Workspace must not load the acquisition resolver.
  // test-decision-standing.js holds the two side by side so they cannot drift.
  var FIELD_LABELS = {
    cap: 'CAM cap', cap_base_amount: 'Cap base amount', admin_fee_pct: 'Admin fee %',
    gross_up_pct: 'Gross-up %', expense_stop: 'Expense stop', audit_rights: 'Audit rights',
    pro_rata_method: 'Pro rata method', renewal_options: 'Renewal options', tenant_name: 'Tenant',
    leased_sqft: 'Leased sq ft', start_date: 'Commencement', end_date: 'Expiration',
    lease_type: 'Lease type', base_rent: 'Base rent', security_deposit: 'Security deposit',
    suite: 'Suite', excluded_categories: 'Excluded categories', admin_fee_basis: 'Admin fee basis',
    tenant_improvement_allowance: 'TI allowance', landlord_work: "Landlord's work",
    guarantor_name: 'Guarantor', guaranty_limit: 'Guaranty limit', termination_rights: 'Termination rights',
    expansion_rights: 'Expansion / ROFR', assignment_consent: 'Assignment consent',
    exclusive_use: 'Exclusive use', co_tenancy: 'Co-tenancy',
  };
  // The fields FIELD_META types as number, money or percent: compared as
  // quantities ('67,000' is 67000); every other field as trimmed text.
  var NUMERIC_FIELDS = {
    cap: 1, cap_base_amount: 1, admin_fee_pct: 1, gross_up_pct: 1, expense_stop: 1,
    leased_sqft: 1, base_rent: 1, security_deposit: 1, tenant_improvement_allowance: 1, guaranty_limit: 1,
  };
  var ACTION_LABELS = { confirm: 'Confirmed', correct: 'Corrected', reject: 'Rejected', reopen: 'Reopened' };

  function fieldLabel(field) { return FIELD_LABELS[field] || String(field || ''); }
  function actionLabel(action) { return ACTION_LABELS[action] || String(action || ''); }

  function _num(v) {
    if (v == null || v === '') return NaN;
    var s = String(v).replace(/[^0-9.\-]/g, '');
    return s === '' || s === '-' || s === '.' ? NaN : Number(s);
  }
  /**
   * Is the value a surface shows the one the standing decision fixed? Used to
   * LABEL a row, never to change it. Quantities compare as numbers ('67,000' =
   * 67000 = '67000.0'); anything else as trimmed, case-insensitive text. Two
   * absent values do not match: a term nobody shows was not "verified as shown".
   */
  function matchesShown(field, decided, shown) {
    if (decided == null || decided === '' || shown == null || shown === '') return false;
    if (NUMERIC_FIELDS[field]) {
      var a = _num(decided), b = _num(shown);
      return !isNaN(a) && !isNaN(b) && a === b;
    }
    return String(decided).trim().toLowerCase() === String(shown).trim().toLowerCase();
  }

  /** The value a decision fixed: a correction's new value; a confirmation confirms the reading it was made on. */
  function _decidedValue(d) {
    if (!d) return null;
    if (d.action === 'correct') return d.new_value == null ? null : d.new_value;
    return d.previous_value == null ? (d.new_value == null ? null : d.new_value) : d.previous_value;
  }

  /**
   * The document a decision cites, found BY ID among all of the property's
   * document rows (a source may be superseded by now — it is still what was
   * cited). It links only when it is live for this leasehold AND this user is
   * its uploader (the P5-2 rule); otherwise the name is shown, unlinked.
   */
  function resolveSource(sourceDocumentId, docs, familyId, currentUid) {
    if (!sourceDocumentId) return null;
    var d = null;
    for (var i = 0; i < docs.length; i++) { if (docs[i] && docs[i].id === sourceDocumentId) { d = docs[i]; break; } }
    if (!d) return { id: sourceDocumentId, name: 'Document no longer on file', docType: null, live: false, url: null, uploadedByOther: false, missing: true };
    var owner = pathOwner(d.storage_path);
    var mine  = !!(owner && currentUid && owner === currentUid);
    var live  = _isLiveFor(d, familyId);
    return {
      id: d.id, name: d.file_name || 'Document', docType: d.doc_type || null,
      live: live, url: (live && mine) ? d.storage_path : null, uploadedByOther: !mine, missing: false,
    };
  }

  /** One standing decision as a surface reads it. */
  function _standingEntry(field, d, docs, familyId, currentUid) {
    var verified = d.action === 'confirm' || d.action === 'correct';
    return {
      field: field, label: fieldLabel(field),
      decisionId: d.id || null, action: d.action, actionLabel: actionLabel(d.action),
      verified: verified,
      rejected: d.action === 'reject',
      entered: d.action === 'correct' && !d.source_document_id,
      value: _decidedValue(d),
      decidedBy: d.decided_by || null,
      decidedAt: d.decided_at || d.created_at || null,
      source: resolveSource(d.source_document_id, docs, familyId, currentUid),
      sourcePage: d.source_page == null ? null : d.source_page,
      sourceQuote: d.source_quote || null,
      note: d.note || null,
    };
  }

  /**
   * The standing decisions of ONE leasehold, from its raw decision rows (already
   * grouped by family_id and scoped to the property by build()).
   * @returns {{ fields: object[], byField: object, openFields: string[], counts: object, lastAt: string|null }}
   */
  function standingDecisions(rawRows, docs, familyId, currentUid) {
    var by = _DS.standingByField(rawRows);
    var fields = [], byField = {}, open = [], lastAt = null;
    var c = { decisions: 0, fieldsDecided: 0, fieldsVerified: 0, fieldsEntered: 0, fieldsRejected: 0, fieldsOpen: 0 };
    (Array.isArray(rawRows) ? rawRows : []).forEach(function (r) {
      if (!r || _DS.DECISION_ACTIONS.indexOf(r.action) < 0) return;
      c.decisions++;
      var at = r.decided_at || r.created_at || null;
      if (at && (!lastAt || String(at) > String(lastAt))) lastAt = at;
    });
    Object.keys(by).forEach(function (field) {
      c.fieldsDecided++;
      var d = by[field];
      if (!d) { open.push(field); c.fieldsOpen++; return; }
      var e = _standingEntry(field, d, docs, familyId, currentUid);
      fields.push(e); byField[field] = e;
      if (e.verified) c.fieldsVerified++;
      if (e.entered) c.fieldsEntered++;
      if (e.rejected) c.fieldsRejected++;
    });
    return { fields: fields, byField: byField, openFields: open, counts: c, lastAt: lastAt };
  }

  // ── P5-4: what the acquisition left, read from the converted review ────────

  // The resolver's five states (acquisition-terms.js TERM_STATES) and the words
  // the workspace uses for them — the Lease Matrix's vocabulary, one to one.
  var RESOLVER_STATE = { verified: 'verified', ai_extracted: 'read', unclear: 'unclear', conflicting: 'contested', missing: 'missing' };
  // The Space file's lease rows. Only these carry a line under a value.
  var ROW_FIELDS = ['lease_type', 'leased_sqft', 'start_date', 'end_date', 'cap'];
  // The fingerprint's normalised row (AcquisitionEngine.normalizeAcqTenant)
  // names three of those differently; lease_type and cap are not in it at all,
  // so a fingerprint can never vouch for their value (structured states can).
  var FINGERPRINT_VALUE_KEY = { leased_sqft: 'leased_sqft', start_date: 'lease_start', end_date: 'lease_end' };
  // Where a term lives on a workspace tenant, when it lives there at all.
  // The acquisition-only terms (TI allowance, guaranty, co-tenancy…) have no
  // home on a workspace tenant: the workspace cannot show or edit them.
  var TENANT_KEY = {
    leased_sqft: 'leased_sqft', lease_type: 'lease_type', start_date: 'start_date', end_date: 'end_date', cap: 'cap',
    cap_base_amount: 'capBaseAmount', admin_fee_pct: 'admin_fee_pct', admin_fee_basis: 'admin_fee_basis',
    gross_up_pct: 'gross_up_pct', expense_stop: 'expense_stop', audit_rights: 'audit_rights',
    pro_rata_method: 'pro_rata_method', renewal_options: 'renewal_options', tenant_name: 'tenant_name',
    base_rent: 'base_rent', security_deposit: 'security_deposit', suite: 'suite', excluded_categories: 'excluded_categories',
  };
  // The review-engine warning types that already name a field in the
  // workspace. A field one of these covers is ALREADY an attention item there;
  // the acquisition's history annotates it and is never counted again.
  var WORKSPACE_WARNING_FIELD = {
    missing_lease_type: 'lease_type', missing_sqft: 'leased_sqft', missing_start_date: 'start_date',
    missing_end_date: 'end_date', nnn_cap_missing: 'cap', audit_rights_unknown: 'audit_rights',
    audit_rights_present: 'audit_rights', admin_fee_present: 'admin_fee_pct', gross_up_present: 'gross_up_pct',
    expense_stop_present: 'expense_stop', low_sqft_confidence: 'leased_sqft',
  };

  function _isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }

  /** One leasehold's states and origins, validated. Null when anything is not what the resolver writes. */
  function _validStates(states, origins) {
    if (!_isObj(states)) return null;
    var o = origins == null ? {} : origins;
    if (!_isObj(o)) return null;
    var outS = {}, outO = {}, keys = Object.keys(states);
    for (var i = 0; i < keys.length; i++) {
      var f = keys[i], s = states[f];
      if (!FIELD_LABELS[f] || !RESOLVER_STATE[s]) return null;       // an unknown field or state: not ours to read
      outS[f] = s;
    }
    var okeys = Object.keys(o);
    for (var j = 0; j < okeys.length; j++) {
      var g = okeys[j], v = o[g];
      if (!FIELD_LABELS[g]) return null;
      if (v === null || v === undefined) { outO[g] = null; continue; }
      // `entered` is the one origin, and only a verified term can carry it.
      if (v !== 'entered' || states[g] !== 'verified') return null;
      outO[g] = 'entered';
    }
    return { states: outS, origins: outO };
  }

  function _fromFingerprint(fp) {
    if (typeof fp !== 'string' || !fp) return null;
    var arr;
    try { arr = JSON.parse(fp); } catch (_) { return null; }
    if (!Array.isArray(arr) || !arr.length) return null;
    var by = {};
    for (var i = 0; i < arr.length; i++) {
      var e = arr[i];
      // [leaseholdId, source, normalizedRow, _states, _origins] — exactly.
      if (!Array.isArray(e) || e.length !== 5) return null;
      var id = e[0];
      if (typeof id !== 'string' || !id || by[id]) return null;     // no id, or the same leasehold twice
      if (e[1] !== 'leasehold') return null;                         // an analysis of anything else is not a record of leaseholds
      if (e[2] !== null && !_isObj(e[2])) return null;
      var v = _validStates(e[3], e[4]);
      if (!v) return null;
      var values = {};
      Object.keys(FINGERPRINT_VALUE_KEY).forEach(function (f) {
        var n = e[2] ? e[2][FINGERPRINT_VALUE_KEY[f]] : undefined;
        if (n !== undefined) values[f] = n;
      });
      by[id] = { states: v.states, origins: v.origins, values: values };
    }
    return by;
  }

  function _fromStructured(st) {
    if (!_isObj(st)) return null;
    var ids = Object.keys(st);
    if (!ids.length) return null;
    var by = {};
    for (var i = 0; i < ids.length; i++) {
      var e = st[ids[i]];
      if (!_isObj(e)) return null;
      var v = _validStates(e.states, e.origins);
      if (!v) return null;
      var values = {};
      if (e.values != null) {
        if (!_isObj(e.values)) return null;
        var vk = Object.keys(e.values);
        for (var k = 0; k < vk.length; k++) {
          if (ROW_FIELDS.indexOf(vk[k]) < 0) return null;
          values[vk[k]] = e.values[vk[k]];
        }
      }
      by[ids[i]] = { states: v.states, origins: v.origins, values: values };
    }
    return by;
  }

  // Two maps with the same keys and the same value under each (a null origin
  // and an absent one are the same fact).
  function _sameMap(a, b, dropNull) {
    var keep = function (o) { return Object.keys(o || {}).filter(function (k) { return !dropNull || o[k] != null; }).sort(); };
    var ka = keep(a), kb = keep(b);
    if (ka.length !== kb.length) return false;
    for (var i = 0; i < ka.length; i++) { if (ka[i] !== kb[i] || a[ka[i]] !== b[kb[i]]) return false; }
    return true;
  }
  function _sameStates(a, b) {
    var ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
    if (ka.length !== kb.length || ka.some(function (k, i) { return k !== kb[i]; })) return false;
    return ka.every(function (id) {
      return _sameMap(a[id].states, b[id].states, false) && _sameMap(a[id].origins, b[id].origins, true);
    });
  }

  /**
   * The per-leasehold term states an acquisition's canonical block recorded.
   * Structured `states` first (written since P5-4); the `fingerprint` every
   * earlier review stored otherwise. When BOTH are present they must agree.
   * @returns {{ source: 'states'|'fingerprint', byLeasehold: object }|null}
   */
  function parseCanonicalStates(canonical) {
    if (!_isObj(canonical) || canonical.basis !== 'leaseholds') return null;
    var hasS = canonical.states !== undefined, hasF = typeof canonical.fingerprint === 'string';
    var s = hasS ? _fromStructured(canonical.states) : null;
    var f = hasF ? _fromFingerprint(canonical.fingerprint) : null;
    if (hasS && !s) return null;                       // structured but unreadable: do not fall back past it
    if (s && f && !_sameStates(s, f)) return null;      // two records of one moment that disagree
    if (s) {
      // Values the structured block does not carry may still come from the fingerprint.
      if (f) Object.keys(s).forEach(function (id) {
        Object.keys(f[id].values).forEach(function (k) { if (!(k in s[id].values)) s[id].values[k] = f[id].values[k]; });
      });
      return { source: 'states', byLeasehold: s };
    }
    return f ? { source: 'fingerprint', byLeasehold: f } : null;
  }

  /**
   * The converted review that recorded this property's acquisition, and what it
   * recorded — or null. Exactly one converted review of THIS property, whose
   * canonical block reads cleanly, and every leasehold it names is one of that
   * review's families on this property.
   */
  function acquisitionRecord(reviews, propertyId, families) {
    var mine = _arr(reviews).filter(function (r) { return r.property_id === propertyId && r.status === 'converted'; });
    if (mine.length !== 1) return null;
    var r = mine[0];
    // Only the selected `canonical` (SELECT.reviews). A whole review row is not
    // read here: its data carries the raw, unverified upload rows.
    var canonical = r.canonical;
    var parsed = parseCanonicalStates(canonical);
    if (!parsed) return null;
    var famOfReview = {};
    _arr(families).forEach(function (f) { if (f.id && f.review_id === r.id && _sameProperty(f, propertyId)) famOfReview[f.id] = true; });
    var ids = Object.keys(parsed.byLeasehold);
    if (!ids.every(function (id) { return famOfReview[id]; })) return null;   // a leasehold this review does not own
    return { reviewId: r.id, convertedAt: r.converted_at || null, analysedAt: canonical.at || null,
             source: parsed.source, byLeasehold: parsed.byLeasehold };
  }

  /** One leasehold's record, as the workspace reads it. Null when the acquisition did not record it. */
  function _atAcquisitionEntry(record, leaseholdId, liveDocumentCount) {
    if (!record || !record.byLeasehold[leaseholdId]) return null;
    var rec = record.byLeasehold[leaseholdId];
    var fields = {}, counts = { verified: 0, entered: 0, read: 0, unclear: 0, contested: 0, missing: 0 };
    Object.keys(rec.states).forEach(function (f) {
      var raw = rec.states[f];
      var state = (raw === 'verified' && rec.origins[f] === 'entered') ? 'entered' : RESOLVER_STATE[raw];
      counts[state]++;
      fields[f] = { field: f, label: fieldLabel(f), state: state,
                    value: Object.prototype.hasOwnProperty.call(rec.values, f) ? rec.values[f] : undefined };
    });
    return {
      reviewId: record.reviewId, convertedAt: record.convertedAt, analysedAt: record.analysedAt, source: record.source,
      fields: fields, counts: counts,
      // A leasehold with no lease document filed into it — every term it has
      // was read from nothing, and nothing here may be presented as documented.
      noDocument: liveDocumentCount === 0,
    };
  }

  function _present(field, v) {
    if (v === null || v === undefined) return false;
    if (typeof v === 'string' && v.trim() === '') return false;
    // An area of zero is not an area (the CAM gate reads it as missing too).
    if (field === 'leased_sqft') { var n = _num(v); return !isNaN(n) && n > 0; }
    return true;
  }

  /**
   * What the acquisition left open for ONE leasehold, derived now:
   *   state at acquisition × the standing decision (P5-3) × the value shown now.
   *
   *   current    { <field>: value } as the surface shows it (a tenant, or the
   *              Space file's lease rows); a field absent from it is 'not_tracked'
   *   opts.workspaceWarnings  the review-engine warning types for this tenant
   *
   * Each item: { field, label, kind, rejected, current, valueAtAcquisition,
   *   comparable, changedSince, resolvedSince, representedInWorkspace, open }.
   * A field whose standing decision contradicts its recorded state is left out
   * (fail closed). The leasehold with no document adds one `no_document` item.
   */
  function acquisitionAttention(entry, current, opts) {
    var at = entry && entry.atAcquisition;
    if (!at) return [];
    var cur = _isObj(current) ? current : {};
    var o = opts || {};
    var represented = {};
    _arr(o.workspaceWarnings).forEach(function (t) { if (WORKSPACE_WARNING_FIELD[t]) represented[WORKSPACE_WARNING_FIELD[t]] = true; });
    var standing = (entry.verified && entry.verified.byField) || {};
    var out = [];
    Object.keys(at.fields).forEach(function (f) {
      var a = at.fields[f];
      if (a.state === 'verified' || a.state === 'entered') return;
      var sd = standing[f];
      if (sd && sd.verified) return;                                  // a decision says verified; the record says otherwise
      var rejected = !!(sd && sd.rejected);
      if (rejected && a.state !== 'unclear') return;                  // a rejection resolves to unclear, nothing else
      var tracked = Object.prototype.hasOwnProperty.call(cur, f);
      var shown = tracked ? cur[f] : undefined;
      var present = tracked && _present(f, shown);
      var comparable = a.value !== undefined && a.value !== null && a.value !== '';
      var changedSince = !!(present && comparable && !matchesShown(f, a.value, shown));
      // A term the acquisition could not establish that the workspace now holds
      // was set since — by a person, in the workspace. Not an open gap.
      var resolvedSince = present && (a.state === 'missing' || a.state === 'contested' || a.state === 'unclear');
      out.push({
        field: f, label: a.label, kind: a.state, rejected: rejected,
        current: tracked ? (present ? 'present' : 'absent') : 'not_tracked',
        valueAtAcquisition: comparable ? a.value : null, comparable: comparable,
        changedSince: changedSince, resolvedSince: resolvedSince,
        representedInWorkspace: !!represented[f],
        open: !resolvedSince && !changedSince,
      });
    });
    if (at.noDocument) out.push({ field: null, label: null, kind: 'no_document', rejected: false, current: 'not_tracked',
      valueAtAcquisition: null, comparable: false, changedSince: false, resolvedSince: false, representedInWorkspace: false, open: true });
    return out;
  }

  /** The value a workspace tenant shows for each term it has a home for. */
  function currentFromTenant(t) {
    var cur = {};
    if (!t) return cur;
    Object.keys(TENANT_KEY).forEach(function (f) { cur[f] = t[TENANT_KEY[f]]; });
    return cur;
  }

  /**
   * The ONE rolled-up line for a property's Needs attention: what the
   * acquisition left open that the workspace has no word for. Counted, per
   * leasehold, are only items that are open, that the workspace does not
   * already raise (a missing start date is the Review Queue's; it is annotated
   * there, never counted twice), and that say something about a value a person
   * can see: contested or unclear anywhere, read-by-AI only where the value
   * shown is the one that was read. Not established and no-document are never
   * counted here — the workspace already says both.
   *   warningTypesFor(t) → the review-engine warning types for a tenant.
   * @returns {{ leaseholds, contested, unclear, read, items[] }|null}
   */
  function propertyAcquisitionAttention(built, tenants, warningTypesFor) {
    if (!built || !built.byLeaseholdId) return null;
    var byId = {};
    _arr(tenants).forEach(function (t) { if (t.id != null) byId[t.id] = t; });
    var out = { leaseholds: 0, contested: 0, unclear: 0, read: 0, items: [] };
    var any = false;
    (built.leaseholdIds || []).forEach(function (id) {
      var e = built.byLeaseholdId[id];
      if (!e || !e.atAcquisition) return;
      any = true;
      var t = byId[id];
      if (!t) return;                                                 // the tenant is gone; nothing to point at
      var warnings = typeof warningTypesFor === 'function' ? (warningTypesFor(t) || []) : [];
      var counted = acquisitionAttention(e, currentFromTenant(t), { workspaceWarnings: warnings }).filter(function (it) {
        if (!it.open || it.representedInWorkspace) return false;
        if (it.kind === 'contested' || it.kind === 'unclear') return true;
        return it.kind === 'read' && ROW_FIELDS.indexOf(it.field) >= 0 && it.current === 'present' && it.comparable;
      });
      if (!counted.length) return;
      out.leaseholds++;
      counted.forEach(function (it) { out[it.kind]++; out.items.push({ tenantId: id, field: it.field, kind: it.kind }); });
    });
    return any ? out : null;
  }

  /**
   * The acquisition's word on each field a workspace warning names — for the
   * Review Queue, which shows the CURRENT issue and may add what the
   * acquisition recorded about it. Never a task: history, annotated.
   */
  function historyForWarnings(entry, warningTypes) {
    var at = entry && entry.atAcquisition;
    if (!at) return [];
    var standing = (entry.verified && entry.verified.byField) || {};
    var seen = {}, out = [];
    _arr(warningTypes).forEach(function (t) {
      var f = WORKSPACE_WARNING_FIELD[t];
      if (!f || seen[f] || !at.fields[f]) return;
      seen[f] = true;
      var sd = standing[f];
      out.push({ type: t, field: f, label: at.fields[f].label, state: at.fields[f].state,
                 rejected: !!(sd && sd.rejected), noDocument: at.noDocument });
    });
    return out;
  }

  // ── P5-5: the acquisition episode, as History may tell it ─────────────────

  /** How an episode document ended up: replaced by a later upload, filed into a leasehold, or neither. */
  function _filing(d) {
    if (d.superseded_by_document_id) return 'superseded';
    if (d.family_id && d.family_status === 'confirmed') return 'filed';
    return 'unfiled';
  }

  function _minMax(rows, key) {
    var lo = null, hi = null;
    rows.forEach(function (r) {
      var v = r && r[key]; if (!v) return;
      if (!lo || String(v) < String(lo)) lo = v;
      if (!hi || String(v) > String(hi)) hi = v;
    });
    return { first: lo, last: hi };
  }

  /**
   * The one lifecycle event that acquired this property from this episode:
   * a DIRECT property_events row (source_key null) — action stage_changed,
   * prospect → acquired, on this property, whose detail names this review.
   * Exactly one, or null: two would mean the record is not what 035 promised
   * (one row per acquisition), and a row naming another review is another
   * episode's. A derived row (source_key set) is never a lifecycle event.
   */
  function acquiredEvent(events, propertyId, reviewId) {
    if (!propertyId || !reviewId) return null;
    var hits = _arr(events).filter(function (e) {
      return _isObj(e) && e.source_key == null && e.action === 'stage_changed'
        && _sameProperty(e, propertyId)
        && (e.subject_type == null || e.subject_type === 'property')
        && (e.subject_id == null || e.subject_id === propertyId)
        && e.old_value === 'prospect' && e.new_value === 'acquired'
        && _isObj(e.detail) && e.detail.reviewId === reviewId;
    });
    return hits.length === 1 ? hits[0] : null;
  }

  /**
   * The episode: null unless exactly one converted review of THIS property is
   * present (the same rule acquisitionRecord applies). Every fact comes from
   * a durable row; a fact whose source is absent is null, never guessed.
   *
   *   review      { id, startedAt, startedBy, convertedAt, activityCount }
   *   acquired    { at, by, byEmail, source: 'property_events'|'acquisition_reviews', eventId, counts }
   *               `by` only from the event row; a review-dated acquisition has no actor
   *   documents   { total, filed, unfiled, superseded, first, last }   this review's rows
   *   leaseholds  { count, first, last }                                this review's families
   *   decisions   { count, confirm, correct, reject, reopen, leaseholds, actors, first, last }
   *   analysedAt  the canonical analysis's timestamp, when it reads cleanly (P5-4)
   *   unresolved  summed atAcquisition counts across the property's leaseholds, or null
   *               { leaseholds, contested, unclear, read, missing, noDocument }
   */
  function acquisitionEpisode(reviews, propertyId, families, documents, decisions, events, byLeaseholdId, acqRecord) {
    var mine = _arr(reviews).filter(function (r) { return r.property_id === propertyId && r.status === 'converted'; });
    if (mine.length !== 1) return null;
    var r = mine[0];
    var fams = _arr(families).filter(function (f) { return f.review_id === r.id && _sameProperty(f, propertyId); });
    var docs = _arr(documents).filter(function (d) { return d.review_id === r.id && _sameProperty(d, propertyId); });
    var decs = _arr(decisions).filter(function (d) { return d.review_id === r.id && _sameProperty(d, propertyId) && _DS.DECISION_ACTIONS.indexOf(d.action) >= 0; });
    var ev = acquiredEvent(events, propertyId, r.id);

    var dc = { total: docs.length, filed: 0, unfiled: 0, superseded: 0 };
    docs.forEach(function (d) { dc[_filing(d)]++; });
    var dmm = _minMax(docs, 'created_at');
    var fmm = _minMax(fams, 'created_at');
    var xc = { count: decs.length, confirm: 0, correct: 0, reject: 0, reopen: 0 }, xf = {}, xa = {};
    decs.forEach(function (d) { xc[d.action]++; if (d.family_id) xf[d.family_id] = 1; if (d.decided_by) xa[d.decided_by] = 1; });
    var xmm = _minMax(decs.map(function (d) { return { at: d.decided_at || d.created_at }; }), 'at');

    var unresolved = null;
    if (acqRecord) {
      unresolved = { leaseholds: 0, contested: 0, unclear: 0, read: 0, missing: 0, noDocument: 0 };
      Object.keys(byLeaseholdId || {}).forEach(function (id) {
        var at = byLeaseholdId[id] && byLeaseholdId[id].atAcquisition;
        if (!at) return;
        unresolved.leaseholds++;
        unresolved.contested += at.counts.contested; unresolved.unclear += at.counts.unclear;
        unresolved.read += at.counts.read;           unresolved.missing += at.counts.missing;
        if (at.noDocument) unresolved.noDocument++;
      });
    }

    var acquiredAt = ev ? (ev.created_at || ev.client_ts || null) : (r.converted_at || null);
    return {
      review: { id: r.id, startedAt: r.created_at || null, startedBy: r.user_id || null, convertedAt: r.converted_at || null,
                activityCount: (typeof r.activity_count === 'number' && r.activity_count >= 0) ? r.activity_count : null },
      acquired: acquiredAt ? {
        at: acquiredAt,
        by: ev ? (ev.actor_uid || null) : null,
        byEmail: ev ? (ev.actor_email || null) : null,
        source: ev ? 'property_events' : 'acquisition_reviews',
        eventId: ev ? (ev.id || null) : null,
        counts: (ev && _isObj(ev.detail)) ? { leaseholds: ev.detail.leaseholds == null ? null : ev.detail.leaseholds,
                                              tenants: ev.detail.tenants == null ? null : ev.detail.tenants,
                                              invoices: ev.detail.invoices == null ? null : ev.detail.invoices } : null,
      } : null,
      documents:  { total: dc.total, filed: dc.filed, unfiled: dc.unfiled, superseded: dc.superseded, first: dmm.first, last: dmm.last },
      leaseholds: { count: fams.length, first: fmm.first, last: fmm.last },
      decisions:  { count: xc.count, confirm: xc.confirm, correct: xc.correct, reject: xc.reject, reopen: xc.reopen,
                    leaseholds: Object.keys(xf).length, actors: Object.keys(xa).length, first: xmm.first, last: xmm.last },
      analysedAt: acqRecord ? (acqRecord.analysedAt || null) : null,
      unresolved: unresolved,
    };
  }

  /**
   * The episode as dated milestones, oldest first — ONLY those whose source
   * supports them. Each: { key, at, label, detail, actorUid, actorEmail,
   * source }. Nothing about the acquisition is invented to fill a gap: an
   * episode with no documents has no documents milestone.
   */
  function episodeMilestones(ep) {
    if (!ep) return [];
    var out = [];
    var n = function (k, one, many) { return k + ' ' + (k === 1 ? one : many); };
    if (ep.review.startedAt) out.push({ key: 'started', at: ep.review.startedAt, label: 'Acquisition started',
      detail: 'A due-diligence review was opened for this property.', actorUid: ep.review.startedBy, actorEmail: null, source: 'acquisition_reviews' });
    if (ep.documents.total > 0 && ep.documents.last) out.push({ key: 'documents', at: ep.documents.last,
      label: n(ep.documents.total, 'lease document reviewed', 'lease documents reviewed'),
      detail: n(ep.documents.filed, 'filed into a leasehold', 'filed into leaseholds')
        + (ep.documents.unfiled ? ' · ' + n(ep.documents.unfiled, 'left unfiled', 'left unfiled') : '')
        + (ep.documents.superseded ? ' · ' + n(ep.documents.superseded, 'superseded by a later upload', 'superseded by later uploads') : '')
        + (ep.documents.first && ep.documents.first !== ep.documents.last ? ' · from ' + String(ep.documents.first).slice(0, 10) : ''),
      actorUid: null, actorEmail: null, source: 'acquisition_documents' });
    if (ep.leaseholds.count > 0 && ep.leaseholds.last) out.push({ key: 'leaseholds', at: ep.leaseholds.last,
      label: n(ep.leaseholds.count, 'leasehold established', 'leaseholds established'),
      detail: 'Each became a space of this property at acquisition.'
        + (ep.leaseholds.first && ep.leaseholds.first !== ep.leaseholds.last ? ' From ' + String(ep.leaseholds.first).slice(0, 10) + '.' : ''),
      actorUid: null, actorEmail: null, source: 'acquisition_document_families' });
    if (ep.decisions.count > 0 && ep.decisions.last) out.push({ key: 'decisions', at: ep.decisions.last,
      label: n(ep.decisions.count, 'term decision by a person', 'term decisions by a person'),
      detail: [ep.decisions.confirm ? ep.decisions.confirm + ' confirmed' : '', ep.decisions.correct ? ep.decisions.correct + ' corrected' : '',
               ep.decisions.reject ? ep.decisions.reject + ' rejected' : '', ep.decisions.reopen ? ep.decisions.reopen + ' reopened' : '']
        .filter(Boolean).join(' · ') + ' · on ' + n(ep.decisions.leaseholds, 'leasehold', 'leaseholds')
        + (ep.decisions.first && ep.decisions.first !== ep.decisions.last ? ' · from ' + String(ep.decisions.first).slice(0, 10) : ''),
      actorUid: null, actorEmail: null, source: 'acquisition_term_decisions' });
    if (ep.analysedAt) out.push({ key: 'analysed', at: ep.analysedAt, label: 'Analysis current at acquisition',
      detail: 'The term states this analysis recorded are the ones the property remembers as at acquisition.', actorUid: null, actorEmail: null, source: 'acquisition_reviews' });
    if (ep.acquired) out.push({ key: 'acquired', at: ep.acquired.at, label: 'Property acquired',
      detail: ep.acquired.counts && ep.acquired.counts.leaseholds != null
        ? n(ep.acquired.counts.leaseholds, 'leasehold became a space', 'leaseholds became spaces')
          + (ep.acquired.counts.invoices ? ' · ' + n(ep.acquired.counts.invoices, 'invoice carried over', 'invoices carried over') : '')
        : 'The review was converted; the property became part of the portfolio.',
      actorUid: ep.acquired.by, actorEmail: ep.acquired.byEmail, source: ep.acquired.source });
    out.sort(function (a, b) { return String(a.at) < String(b.at) ? -1 : (String(a.at) > String(b.at) ? 1 : 0); });
    return out;
  }

  /**
   * The projection for ONE property.
   *
   * @param {object} input  { propertyId, families, documents, decisions, reviews?, events?, currentUid, tenants? }
   *   families/documents/decisions: the rows read for this property (by
   *   property_id). tenants is optional and only used for the join report.
   * @returns {{ propertyId, byLeaseholdId, leaseholdIds, familyCount, documentCount,
   *             unattachedDocumentCount, decisionCount, tenantsMatched, tenantsWithoutLeasehold, builtAt }}
   *
   * Never mutates its inputs. Never throws on bad input: an empty projection.
   */
  function build(input) {
    var inp = input || {};
    var propertyId = inp.propertyId || null;
    var uid = inp.currentUid || null;
    var fams = _arr(inp.families).filter(function (f) { return f.id && _sameProperty(f, propertyId); });
    var docs = _arr(inp.documents).filter(function (d) { return _sameProperty(d, propertyId); });
    var decs = _arr(inp.decisions).filter(function (d) { return _sameProperty(d, propertyId); });
    // P5-4: what the acquisition recorded, or null (fail closed).
    var acqRecord = acquisitionRecord(inp.reviews, propertyId, fams);

    var byId = {}, ids = [], docCount = 0, decCount = 0;
    fams.forEach(function (f) {
      if (byId[f.id]) return;                                   // a duplicate row is one leasehold
      var mine = docs.filter(function (d) { return _isLiveFor(d, f.id); })
        .sort(function (a, b) { return _time(a.doc_date || a.created_at) - _time(b.doc_date || b.created_at); })
        .map(function (d) { return _documentEntry(d, uid); });
      var theirs = decs.filter(function (d) { return d.family_id === f.id; })
        .sort(function (a, b) { return _time(a.decided_at || a.created_at) - _time(b.decided_at || b.created_at); });
      var history = theirs.map(function (d) {
        // P5-3: every row, with its label, its action as a word, the value it
        // fixed and the document it cited — the history a surface lists.
        var e = _decisionEntry(d);
        e.label = fieldLabel(e.fieldKey);
        e.actionLabel = actionLabel(e.action);
        e.value = _decidedValue(d);
        e.source = resolveSource(d.source_document_id, docs, f.id, uid);
        return e;
      });
      byId[f.id] = {
        leaseholdId: f.id,
        propertyId:  propertyId,
        family: { id: f.id, label: f.label || f.tenant_hint || null, kind: f.family_kind || null,
                  tenantHint: f.tenant_hint || null, suiteHint: f.suite_hint || null,
                  reviewId: f.review_id || null, createdAt: f.created_at || null },
        documents: mine,
        decisions: history,
        decisionSummary: _decisionSummary(history),
        // P5-3: what currently STANDS per field, by the shared rule.
        verified: standingDecisions(theirs, docs, f.id, uid),
        // P5-4: each term's state as the acquisition recorded it, or null.
        atAcquisition: _atAcquisitionEntry(acqRecord, f.id, mine.length),
      };
      ids.push(f.id);
      docCount += mine.length;
      decCount += history.length;
    });

    // Documents on the property that no leasehold shows: unfiled, or filed into
    // a family that is not one of this property's, or superseded. Counted so a
    // later surface can say so; never attached to a tenant.
    var unattached = docs.filter(function (d) {
      return !(d.family_id && byId[d.family_id] && _isLiveFor(d, d.family_id));
    }).length;

    var tenants = _arr(inp.tenants);
    var matched = 0, without = 0;
    tenants.forEach(function (t) { if (t.id != null && byId[t.id]) matched++; else without++; });

    // P5-5: the episode, composed from the rows above and the lifecycle events.
    var episode = acquisitionEpisode(inp.reviews, propertyId, fams, docs, decs, inp.events, byId, acqRecord);

    return {
      propertyId: propertyId,
      byLeaseholdId: byId,
      leaseholdIds: ids,
      familyCount: ids.length,
      documentCount: docCount,
      unattachedDocumentCount: unattached,
      decisionCount: decCount,
      tenantsMatched: matched,
      tenantsWithoutLeasehold: without,
      // P5-4: the review the acquisition was recorded in, when it reads cleanly.
      acquisition: acqRecord ? { reviewId: acqRecord.reviewId, convertedAt: acqRecord.convertedAt,
                                 analysedAt: acqRecord.analysedAt, source: acqRecord.source } : null,
      // P5-5: the acquisition episode for History, or null.
      episode: episode,
      builtAt: new Date().toISOString(),
    };
  }

  // ── P5-6B: the acquisition memory, as a server read may tell it ───────────
  //
  // ONE object answering "what happened when we acquired this property", for a
  // reader that has no page and no map: the MCP hydrator. It is composed here,
  // from build() — so the standing rule, the at-acquisition parse, the
  // episode, the milestones and the unresolved sums are the ones the browser
  // shows, never restated — and it is RETURNED, never stored: memory() does
  // not call set(), and holds nothing between calls.
  //
  // Three kinds of fact, kept apart so no reader can mistake one for another:
  //   memory   what the acquisition recorded (frozen rows, 034 + 036)
  //   current  what the property holds NOW (lifecycle columns; the current
  //            tenant beside each standing decision, compared, never merged)
  //   sources  where each remembered fact can be checked (row ids, the
  //            documents, the quote and page a decision cited)
  //
  // Status: 'ok'; 'empty' — no acquisition episode on record for this
  // property; 'degraded' — an episode exists but some of its memory is
  // missing, ambiguous or inconsistent (each cause named in `reasons`);
  // 'unavailable' — a read failed, so nothing is claimed at all.
  // `limitations` name true, permanent gaps in what the record can support
  // (an actor stored only as a uid, invoices with no original…), so a reader
  // does not state more than the record holds.

  var MEMORY_VERSION = 1;

  function _finite(v) { return (typeof v === 'number' && isFinite(v)) ? v : null; }
  function _strOrNull(v) { return (typeof v === 'string' && v.trim() !== '') ? v : null; }

  /**
   * What acquire_property carried into the property's invoices: every object
   * in the review's `data.invoices` (035, step 9), by value. Null when the
   * column was not read. The lines have no document and no link to the
   * property's current invoices — said, not implied.
   */
  function _carriedInvoices(review, eventCount) {
    if (!review || review.invoices === undefined) return null;
    var list = Array.isArray(review.invoices) ? review.invoices.filter(_isObj) : [];
    var lines = list.map(function (e) {
      var amt = typeof e.amount === 'number' ? e.amount : _num(e.amount);
      return { vendorName: _strOrNull(e.vendorName), amount: isFinite(amt) ? amt : null,
               category: _strOrNull(e.category), invoiceDate: _strOrNull(e.invoiceDate),
               fileNameAsRecorded: _strOrNull(e.fileName) };
    });
    var summable = lines.every(function (l) { return l.amount !== null; });
    var total = summable ? Math.round(lines.reduce(function (s, l) { return s + l.amount; }, 0) * 100) / 100 : null;
    return { count: lines.length, total: total, lines: lines,
             countMatchesEvent: eventCount == null ? null : eventCount === lines.length,
             originalsLinked: false, linkedToCurrentInvoices: false };
  }

  /** WALT and occupancy as the conversion recorded them, or null. Refused when the record names another review or property. */
  function _conversionMetrics(conv, reviewId, propertyId) {
    if (!_isObj(conv)) return { metrics: null, mismatch: false };
    if ((conv.reviewId != null && conv.reviewId !== reviewId) || (conv.propertyId != null && conv.propertyId !== propertyId)) {
      return { metrics: null, mismatch: true };
    }
    var w = _isObj(conv.waltAtAcquisition) ? conv.waltAtAcquisition : {};
    var o = _isObj(conv.occupancyAtAcquisition) ? conv.occupancyAtAcquisition : {};
    return { mismatch: false, metrics: {
      waltYears: _finite(w.walt), waltMonths: _finite(w.waltMonths), weightedSqft: _finite(w.weightedSqft),
      occupancyRate: _finite(o.occupancyRate), occupiedSqft: _finite(o.occupiedSqft),
      buildingSqft: _finite(o.buildingSqft), vacantSqft: _finite(o.vacantSqft),
    } };
  }

  /** The value a tenant shows now beside a standing decision: the same, different, absent, or not a tenant field at all. */
  function _compareCurrent(field, decided, tenant) {
    if (!Object.prototype.hasOwnProperty.call(TENANT_KEY, field)) return 'not_tracked';
    var shown = currentFromTenant(tenant)[field];
    if (!_present(field, shown)) return 'absent';
    return matchesShown(field, decided, shown) ? 'same' : 'different';
  }

  function _statesOf(at, state) {
    return Object.keys(at.fields).filter(function (f) { return at.fields[f].state === state; })
      .map(function (f) { return { field: f, label: at.fields[f].label }; });
  }

  /**
   * The acquisition memory of ONE property.
   *
   * @param {object} input
   *   propertyId                    the property (required)
   *   property   { lifecycle_stage, acquired_at }   the property row's lifecycle columns
   *   families, documents, decisions, reviews, events
   *                                 the rows read for this property, in the
   *                                 SELECT columns (reviews: SELECT.memoryReviews)
   *   tenants                       the property's CURRENT tenants, for the
   *                                 `current` comparison only
   *   failed     string[]           names of reads that failed → 'unavailable'
   *   truncated  string[]           names of reads that may be cut short → 'degraded'
   * Never throws on bad input; never mutates its inputs; never touches the map.
   */
  function memory(input) {
    var inp = input || {};
    var propertyId = inp.propertyId || null;
    var prop = _isObj(inp.property) ? inp.property : {};
    var out = { kind: 'acquisition_memory', version: MEMORY_VERSION, propertyId: propertyId,
                status: null, reasons: [], limitations: [], memory: null, current: null, sources: null };
    var failed = _arr(inp.failed).map(String);
    if (!propertyId || failed.length) {
      out.status = 'unavailable';
      out.reasons = failed.length ? failed.map(function (f) { return 'read_failed:' + f; }) : ['no_property'];
      return out;
    }
    var current = { lifecycleStage: prop.lifecycle_stage || null, acquiredAt: prop.acquired_at || null, leaseholds: [] };
    out.current = current;
    var reasons = [];
    _arr(inp.truncated).forEach(function (t) { reasons.push('read_truncated:' + String(t)); });

    var converted = _arr(inp.reviews).filter(function (r) { return _isObj(r) && r.property_id === propertyId && r.status === 'converted'; });
    if (converted.length !== 1) {
      // None: no episode is on record. More than one: nothing is picked.
      if (converted.length > 1) reasons.push('ambiguous_episodes');
      else if (current.acquiredAt) reasons.push('acquired_without_episode_record');
      out.reasons = reasons;
      out.status = reasons.length ? 'degraded' : 'empty';
      if (out.status === 'empty') out.reasons = ['no_acquisition_episode'];
      return out;
    }
    var r = converted[0];
    var tenants = _arr(inp.tenants);
    var built = build({ propertyId: propertyId, families: inp.families, documents: inp.documents, decisions: inp.decisions,
                        reviews: converted, events: inp.events, tenants: tenants, currentUid: null });
    var ep = built.episode;
    var limitations = [];

    var tenantById = {};
    tenants.forEach(function (t) { if (t && t.id != null) tenantById[t.id] = t; });
    var evidence = [];
    var noDocument = false, differs = false;
    var leaseholds = built.leaseholdIds.filter(function (id) { return built.byLeaseholdId[id].family.reviewId === r.id; }).map(function (id) {
      var e = built.byLeaseholdId[id];
      var v = e.verified, at = e.atAcquisition;
      var t = tenantById[id] || null;
      var cmp = {};
      var fields = v.fields.map(function (s) {
        if (s.source || s.sourceQuote) evidence.push({
          decisionId: s.decisionId, leaseholdId: id, field: s.field,
          documentId: s.source ? s.source.id : null, documentName: s.source ? s.source.name : null,
          documentLive: s.source ? s.source.live : null, documentMissing: s.source ? s.source.missing : null,
          page: s.sourcePage, quote: s.sourceQuote,
        });
        if (t && !s.rejected) {
          cmp[s.field] = _compareCurrent(s.field, s.value, t);
          if (cmp[s.field] === 'different' || cmp[s.field] === 'absent') differs = true;
        }
        return { field: s.field, label: s.label, action: s.action, value: s.value, verified: s.verified,
                 entered: s.entered, rejected: s.rejected, decidedAt: s.decidedAt, decidedByUid: s.decidedBy,
                 decisionId: s.decisionId, sourceDocumentId: s.source ? s.source.id : null };
      });
      current.leaseholds.push({ leaseholdId: id, tenantOnProperty: !!t,
                                tenantName: t ? (t.tenant_name || t.name || null) : null, standingVsCurrent: cmp });
      if (!e.documents.length) noDocument = true;
      return {
        leaseholdId: id, label: e.family.label, kind: e.family.kind, tenantHint: e.family.tenantHint,
        suiteHint: e.family.suiteHint, createdAt: e.family.createdAt,
        documentIds: e.documents.map(function (d) { return d.id; }),
        decisionCount: e.decisions.length,
        standing: { fields: fields, openFields: v.openFields.map(function (f) { return { field: f, label: fieldLabel(f) }; }),
                    counts: v.counts },
        atAcquisition: at ? { counts: at.counts, contested: _statesOf(at, 'contested'), unclear: _statesOf(at, 'unclear'),
                              noDocument: at.noDocument } : null,
      };
    });

    var invoices = _carriedInvoices(r, ep.acquired && ep.acquired.counts ? ep.acquired.counts.invoices : null);
    var conv = r.conversion === undefined ? { metrics: null, mismatch: false, unread: true } : _conversionMetrics(r.conversion, r.id, propertyId);

    // Degraded: the episode exists, and part of its memory is missing or does not agree with itself.
    if (!ep.acquired || ep.acquired.source !== 'property_events') reasons.push('no_acquisition_event');
    if (!built.acquisition) reasons.push('at_acquisition_unrecorded');
    if (invoices === null) reasons.push('carried_invoices_unread');
    else if (invoices.countMatchesEvent === false) reasons.push('invoice_count_mismatch');
    if (conv.unread) reasons.push('conversion_record_unread');
    else if (conv.mismatch) reasons.push('conversion_record_mismatch');
    if (current.acquiredAt && ep.acquired && _time(current.acquiredAt) !== _time(ep.acquired.at)) reasons.push('acquired_at_mismatch');
    if (ep.acquired && ep.acquired.counts && ep.acquired.counts.leaseholds != null
        && ep.acquired.counts.leaseholds !== leaseholds.length) reasons.push('leasehold_count_mismatch');

    // Limitations: true of the record, and permanent; they bound what may be said.
    if (ep.acquired && ep.acquired.by && !ep.acquired.byEmail) limitations.push('actor_uid_only');
    if (ep.acquired && !ep.acquired.by) limitations.push('no_actor_recorded');
    if (built.acquisition && built.acquisition.source === 'fingerprint') limitations.push('analysis_fingerprint_only');
    if (invoices && invoices.count) limitations.push('invoice_originals_not_linked', 'carried_invoices_not_linked_to_current');
    if (!conv.unread && !conv.mismatch && !conv.metrics) limitations.push('metrics_not_recorded');
    if (noDocument) limitations.push('leasehold_without_document');
    if (differs) limitations.push('current_differs_from_decided');

    var docs = _arr(inp.documents).filter(function (d) { return _isObj(d) && d.review_id === r.id && _sameProperty(d, propertyId); })
      .slice().sort(function (a, b) { return _time(a.created_at) - _time(b.created_at); });

    out.status = reasons.length ? 'degraded' : 'ok';
    out.reasons = reasons;
    out.limitations = limitations;
    out.memory = {
      episode: { reviewId: ep.review.id, startedAt: ep.review.startedAt, startedByUid: ep.review.startedBy,
                 convertedAt: ep.review.convertedAt, analysedAt: ep.analysedAt,
                 analysisSource: built.acquisition ? built.acquisition.source : null, activityCount: ep.review.activityCount },
      acquired: ep.acquired ? { at: ep.acquired.at, byUid: ep.acquired.by, byEmail: ep.acquired.byEmail,
                                source: ep.acquired.source, eventId: ep.acquired.eventId, counts: ep.acquired.counts } : null,
      leaseholdCount: leaseholds.length,
      leaseholds: leaseholds,
      documents: ep.documents,
      decisions: ep.decisions,
      unresolvedAtAcquisition: ep.unresolved,
      carried: { invoices: invoices, metrics: conv.metrics },
      milestones: episodeMilestones(ep),
    };
    out.sources = {
      review: { table: 'acquisition_reviews', id: r.id },
      event: (ep.acquired && ep.acquired.eventId) ? { table: 'property_events', id: ep.acquired.eventId } : null,
      documents: docs.map(function (d) {
        var filing = _filing(d);
        return { documentId: d.id || null, fileName: d.file_name || null, docType: d.doc_type || null,
                 docTypeStatus: d.doc_type_status || null, docDate: d.doc_date || null, confirmedAt: d.confirmed_at || null,
                 createdAt: d.created_at || null, filing: filing, leaseholdId: filing === 'filed' ? d.family_id : null,
                 supersededBy: d.superseded_by_document_id || null, hasOriginal: !!d.storage_path };
      }),
      decisionEvidence: evidence,
    };
    return out;
  }

  // ── The per-property map. Page-lifetime only. ──────────────────────────────
  var _byProperty = new Map();

  /** Replace the property's entry. Refused (and returns false) when the projection names another property. */
  function set(propertyId, built) {
    if (!propertyId || !built || typeof built !== 'object') return false;
    if (built.propertyId && built.propertyId !== propertyId) return false;
    _byProperty.set(propertyId, built);
    return true;
  }
  /** Empty the property's entry — before a fresh read, so nothing stale shows while it is pending. */
  function clear(propertyId) { if (propertyId) _byProperty.delete(propertyId); }
  /** The projection, or undefined when none is loaded for this property. */
  function get(propertyId) { return propertyId ? _byProperty.get(propertyId) : undefined; }
  function has(propertyId) { return !!propertyId && _byProperty.has(propertyId); }
  /**
   * The leasehold behind a tenant of THIS property — `tenants.id = families.id`.
   * Null when the property has no projection, the tenant has no leasehold, or
   * the ids do not match. Never looks in another property's entry.
   */
  function forTenant(propertyId, tenantId) {
    var built = get(propertyId);
    if (!built || tenantId == null || tenantId === '') return null;
    var e = built.byLeaseholdId[tenantId];
    return (e && e.propertyId === propertyId) ? e : null;
  }
  /** Test hook: forget everything. */
  function _reset() { _byProperty.clear(); }

  return {
    SELECT: SELECT,
    FAMILY_COLUMNS: FAMILY_COLUMNS, DOCUMENT_COLUMNS: DOCUMENT_COLUMNS, DECISION_COLUMNS: DECISION_COLUMNS,
    pathOwner: pathOwner,
    // P5-3
    FIELD_LABELS: FIELD_LABELS, NUMERIC_FIELDS: NUMERIC_FIELDS,
    fieldLabel: fieldLabel, actionLabel: actionLabel,
    matchesShown: matchesShown, resolveSource: resolveSource, standingDecisions: standingDecisions,
    // P5-4
    REVIEW_COLUMNS: REVIEW_COLUMNS, RESOLVER_STATE: RESOLVER_STATE, ROW_FIELDS: ROW_FIELDS,
    WORKSPACE_WARNING_FIELD: WORKSPACE_WARNING_FIELD,
    parseCanonicalStates: parseCanonicalStates, acquisitionRecord: acquisitionRecord,
    acquisitionAttention: acquisitionAttention, currentFromTenant: currentFromTenant,
    propertyAcquisitionAttention: propertyAcquisitionAttention, historyForWarnings: historyForWarnings,
    // P5-5
    EVENT_COLUMNS: EVENT_COLUMNS, acquiredEvent: acquiredEvent, acquisitionEpisode: acquisitionEpisode, episodeMilestones: episodeMilestones,
    build: build,
    // P5-6B
    MEMORY_REVIEW_COLUMNS: MEMORY_REVIEW_COLUMNS, memory: memory,
    set: set, clear: clear, get: get, has: has, forTenant: forTenant,
    _reset: _reset,
  };
});
