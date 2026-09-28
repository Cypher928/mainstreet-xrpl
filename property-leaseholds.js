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
  var SELECT = Object.freeze({
    families:  FAMILY_COLUMNS.join(', '),
    documents: DOCUMENT_COLUMNS.join(', '),
    decisions: DECISION_COLUMNS.join(', '),
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
    build: build,
    set: set, clear: clear, get: get, has: has, forTenant: forTenant,
    _reset: _reset,
  };
});
