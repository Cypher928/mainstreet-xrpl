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
  var REVIEW_COLUMNS = ['id', 'property_id', 'status', 'converted_at', 'canonical:data->analysis->canonical'];
  var SELECT = Object.freeze({
    families:  FAMILY_COLUMNS.join(', '),
    documents: DOCUMENT_COLUMNS.join(', '),
    decisions: DECISION_COLUMNS.join(', '),
    reviews:   REVIEW_COLUMNS.join(', '),
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

  /**
   * The projection for ONE property.
   *
   * @param {object} input  { propertyId, families, documents, decisions, currentUid, tenants? }
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
      builtAt: new Date().toISOString(),
    };
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
    build: build,
    set: set, clear: clear, get: get, has: has, forTenant: forTenant,
    _reset: _reset,
  };
});
