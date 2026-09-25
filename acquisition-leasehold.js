'use strict';
/**
 * acquisition-leasehold.js — one row per leasehold, from the resolved terms.
 *
 * Phase 1 of Acquisition Review (docs/ACQUISITION_REVIEW.md §4l). The
 * canonical projection every downstream consumer reads: the analysis, the
 * Rent Roll and its CSV, the Decision Report, conversion to a property, and
 * through the stored analysis, Ask AI and drafting.
 *
 * WHY THIS EXISTS
 *
 * Until now those consumers read `review.data.tenants[]` — one row per
 * uploaded lease FILE, holding whatever the extraction said the day the file
 * arrived. A person's correction went into acquisition_term_decisions and was
 * seen only by the Lease Terms panel and Report v2. So the Rent Roll showed
 * 65,000 sf beside a report that said 67,000, and a lease plus its amendment
 * counted as two tenants. This file makes the P4-2 resolver's answer — the
 * documents' readings with every decision laid over them — the one source.
 *
 * THE RULES
 *
 *   · A leasehold row's value is the resolved term's value. A term with no
 *     answer yields NULL, and the row says which kind of no-answer it is
 *     (`_states`): `missing` ("Not established") or `conflicting`
 *     ("Contested" — nothing has been chosen, so nothing is reported).
 *   · An entered value (a person typed it; no document supports it) is
 *     reported as the value, with `_origins[field] === 'entered'` so every
 *     consumer can say so. It is never dressed as document-supported.
 *   · `review.data.tenants[]` is NOT modified and NOT merged. It is the raw
 *     upload record. A raw row is carried as a LEGACY row only when nothing
 *     represents it: its document is in no leasehold, or it has no document
 *     row at all (uploads from before P1-2). A raw row whose document is
 *     filed into a leasehold is represented by that leasehold and is dropped
 *     from the projection — not from the review.
 *   · A legacy row is marked `_source: 'unfiled'` with no states, so it can
 *     never read as verified. It is what the file said, unchecked.
 *
 * Pure: no DOM, no network, no globals. The resolver is injected
 * (`opts.terms` = AcquisitionTerms, `opts.reasoner` = LeaseIntelligence),
 * as acquisition-report.js does.
 */
(function (root) {

  var SOURCE = { LEASEHOLD: 'leasehold', UNFILED: 'unfiled' };

  var UNFILED_NOTE  = 'Not in a leasehold — from file extraction, not verified.';
  var ENTERED_NOTE  = 'Entered by a person. No document on file supports it.';

  function _AT(opts) { return (opts && opts.terms) || (root && root.AcquisitionTerms) || null; }
  function _arr(v)   { return Array.isArray(v) ? v.filter(Boolean) : []; }

  /** The value a consumer may use. A contradiction has no value to report. */
  function canonicalValue(term) {
    if (!term) return null;
    if (term.state === 'conflicting') return null;
    return term.value === undefined ? null : term.value;
  }

  /**
   * One leasehold as the tenant-row shape the analysis engine, the Rent Roll
   * and conversion already read. Keys are emitted under every alias those
   * readers use (`cap` and `cam_cap`; `start_date` and `lease_start`) so no
   * reader has to change to see the resolved value.
   */
  function tenantRowFor(family, resolved) {
    var fam   = family || {};
    var terms = (resolved && resolved.terms) || {};
    var v = function (f) { return canonicalValue(terms[f]); };

    // The clause behind each value, so the engine's findings keep their
    // citations. An entered value has no clause and gets none.
    var states = {}, origins = {}, quotes = {};
    Object.keys(terms).forEach(function (f) {
      var t = terms[f] || {};
      states[f]  = t.state || 'missing';
      origins[f] = t.support === 'entered' ? 'entered' : null;
      if (t.quote && t.support !== 'entered' && t.state !== 'conflicting') quotes[f] = t.quote;
    });

    var tenantName = v('tenant_name');
    var row = {
      id:           fam.id || null,
      _leaseholdId: fam.id || null,
      _source:      SOURCE.LEASEHOLD,
      _status:      'ok',
      _familyLabel: fam.label || fam.tenant_hint || null,
      // The leasehold's name is the tenant's identity when no document reads
      // one; the row says which it was.
      _tenantNameFrom: tenantName ? 'term' : 'leasehold_label',
      tenant_name:  tenantName || fam.label || fam.tenant_hint || 'Unnamed leasehold',
      suite:        v('suite'),
      leased_sqft:  v('leased_sqft'),
      start_date:   v('start_date'),  lease_start: v('start_date'),
      end_date:     v('end_date'),    lease_end:   v('end_date'),
      lease_type:   v('lease_type'),
      base_rent:    v('base_rent'),
      security_deposit: v('security_deposit'),
      cap:          v('cap'),         cam_cap:     v('cap'),
      cap_base_amount:  v('cap_base_amount'),
      admin_fee_pct:    v('admin_fee_pct'),
      admin_fee_basis:  v('admin_fee_basis'),
      gross_up_pct:     v('gross_up_pct'),
      expense_stop:     v('expense_stop'),
      pro_rata_method:  v('pro_rata_method'),
      excluded_categories: v('excluded_categories'),
      audit_rights:     v('audit_rights'),
      renewal_options:  v('renewal_options'),
      tenant_improvement_allowance: v('tenant_improvement_allowance'),
      landlord_work:    v('landlord_work'),
      guarantor_name:   v('guarantor_name'),
      guaranty_limit:   v('guaranty_limit'),
      termination_rights: v('termination_rights'),
      expansion_rights: v('expansion_rights'),
      assignment_consent: v('assignment_consent'),
      exclusive_use:    v('exclusive_use'),
      co_tenancy:       v('co_tenancy'),
      quotes:   quotes,
      _states:  states,
      _origins: origins,
      _resolved: !!(resolved && resolved.ok),
    };
    return row;
  }

  /**
   * The raw rows nothing represents. `documents` are the review's document
   * rows (`produced_id` names the raw row a lease file produced).
   */
  function legacyRows(tenants, documents, families) {
    var famIds = {};
    _arr(families).forEach(function (f) { if (f.id) famIds[f.id] = true; });
    var byProduced = {};
    _arr(documents).forEach(function (d) { if (d.produced_id) byProduced[d.produced_id] = d; });

    var kept = [], dropped = [];
    _arr(tenants).forEach(function (t) {
      if (t._status === 'error' || t._status === 'pending') return;
      var name = t.tenant_name || t.tenantName;
      if (!name) return;
      var doc = t.id ? byProduced[t.id] : null;
      if (doc && doc.superseded_by_document_id) {
        dropped.push({ tenantId: t.id || null, fileName: doc.file_name || null, why: 'replaced' });
        return;
      }
      if (doc && doc.family_id && famIds[doc.family_id]) {
        dropped.push({ tenantId: t.id || null, fileName: doc.file_name || null, familyId: doc.family_id, why: 'in_leasehold' });
        return;
      }
      var row = {};
      Object.keys(t).forEach(function (k) { row[k] = t[k]; });
      row._source   = SOURCE.UNFILED;
      row._legacyWhy = doc ? 'unfiled_document' : 'no_document';
      row._states   = {};
      row._origins  = {};
      row._unverified = true;
      row._note = UNFILED_NOTE;
      kept.push(row);
    });
    return { rows: kept, dropped: dropped };
  }

  /**
   * The projection. `input` = { families, documents (WITH abstracted_fields
   * merged on), decisions, tenants (review.data.tenants) }.
   * Returns { rows, leaseholds, unfiled, dropped, resolverAvailable }.
   * Never throws.
   */
  function leaseholdRows(input, opts) {
    var o   = opts || {};
    var AT  = _AT(o);
    var inp = input || {};
    var fams = _arr(inp.families), docs = _arr(inp.documents), decs = _arr(inp.decisions);
    var canResolve = !!(AT && typeof AT.resolveFamilyTerms === 'function');

    var rows = fams.map(function (fam) {
      var mine = docs.filter(function (d) { return d.family_id === fam.id; });
      var res  = canResolve
        ? AT.resolveFamilyTerms(mine, decs.filter(function (d) { return d.family_id === fam.id; }), { reasoner: o.reasoner })
        : null;
      var row = tenantRowFor(fam, res);
      row._documentCount = mine.length;
      return row;
    });

    var legacy = legacyRows(inp.tenants, docs, fams);
    return {
      rows: rows.concat(legacy.rows),
      leaseholds: rows.length,
      unfiled: legacy.rows.length,
      dropped: legacy.dropped,
      resolverAvailable: canResolve,
    };
  }

  /**
   * After the engine has mapped rows to its tenantSummary (one to one, in
   * order), put the states back on so the Rent Roll can say Contested or
   * Not established instead of a dash.
   */
  function attachStates(tenantSummary, rows) {
    var ts = Array.isArray(tenantSummary) ? tenantSummary : [];
    var rs = Array.isArray(rows) ? rows : [];
    ts.forEach(function (t, i) {
      var r = rs[i];
      if (!t || !r) return;
      t._source      = r._source || null;
      t._leaseholdId = r._leaseholdId || null;
      t._states      = r._states || {};
      t._origins     = r._origins || {};
      t._unverified  = !!r._unverified;
      t._legacyWhy   = r._legacyWhy || null;
    });
    return ts;
  }

  /** What one cell of a canonical row should say, for any consumer. */
  function cellState(row, field) {
    var r = row || {};
    if (r._source === SOURCE.UNFILED) return 'unverified';
    var st = (r._states || {})[field];
    if (st === 'conflicting') return 'contested';
    if (st === 'missing' || st === undefined) return 'missing';
    if ((r._origins || {})[field] === 'entered') return 'entered';
    return st === 'verified' ? 'verified' : 'read';
  }

  // ── What may reach the analysis (Option B) ──────────────────────────────────
  //
  // THE RULE. Only a canonical LEASEHOLD is a tenant. The projection above
  // still returns the unmatched raw rows — they are the review's record of
  // what its files said, and MainStreet's Record lists them apart — but none
  // of them may enter the analysis (occupancy, rent roll, recovery, rollover,
  // risk), the Decision Report, anything that reads the stored analysis, or a
  // conversion. An unmatched extraction is not a tenant.
  //
  // It stays visibly unresolved until a PERSON matches it to a leasehold,
  // establishes a new leasehold from it, or dismisses it. There is no
  // automatic matching, by name or by file name: that is the guess the
  // canonical model exists to replace.

  /** The rows the analysis and conversion may use: the leaseholds, and nothing else. */
  function analysisRows(projection) {
    var rows = projection && Array.isArray(projection.rows) ? projection.rows : [];
    return rows.filter(function (r) { return r && r._source === SOURCE.LEASEHOLD; });
  }

  // What a person may decide about one unmatched extraction. A match or a new
  // leasehold names the leasehold it now belongs to; a dismissal says it is not
  // a tenant at all.
  var RESOLUTION = { MATCHED: 'matched', NEW_LEASEHOLD: 'new_leasehold', DISMISSED: 'dismissed' };

  /**
   * The unmatched extractions, each with the person's resolution if it has
   * one that still holds. `resolutions` is review.data.extractionResolutions,
   * keyed by the raw row's id.
   *
   * A resolution holds only when it still makes sense:
   *   · a match or new leasehold must name a leasehold that still exists —
   *     if that leasehold is gone, the entry is unresolved again;
   *   · a raw row whose DOCUMENT is on file is settled in Documents, where the
   *     document itself is filed into a leasehold (the projection then drops
   *     the row) — so for it only a dismissal counts here;
   *   · a row with no id cannot be named by a resolution, and stays unresolved.
   *
   * Returns [{ row, key, why, resolution }] in the projection's order;
   * `resolution` is null while unresolved.
   */
  function unmatchedEntries(projection, resolutions, families) {
    var rows = projection && Array.isArray(projection.rows) ? projection.rows : [];
    var res  = (resolutions && typeof resolutions === 'object') ? resolutions : {};
    var famIds = {};
    _arr(families).forEach(function (f) { if (f.id) famIds[f.id] = true; });
    return rows.filter(function (r) { return r && r._source === SOURCE.UNFILED; }).map(function (r) {
      var key = r.id != null && r.id !== '' ? String(r.id) : null;
      var e = key ? res[key] : null;
      var ok = false;
      if (e && typeof e === 'object') {
        if (e.action === RESOLUTION.DISMISSED) ok = true;
        else if ((e.action === RESOLUTION.MATCHED || e.action === RESOLUTION.NEW_LEASEHOLD)
                 && r._legacyWhy === 'no_document' && e.familyId && famIds[e.familyId]) ok = true;
      }
      return { row: r, key: key, why: r._legacyWhy || null, resolution: ok ? e : null };
    });
  }

  /** How many unmatched extractions still need a person. Conversion waits for 0. */
  function unresolvedCount(projection, resolutions, families) {
    return unmatchedEntries(projection, resolutions, families).filter(function (x) { return !x.resolution; }).length;
  }

  var api = {
    SOURCE: SOURCE,
    UNFILED_NOTE: UNFILED_NOTE,
    ENTERED_NOTE: ENTERED_NOTE,
    canonicalValue: canonicalValue,
    tenantRowFor: tenantRowFor,
    legacyRows: legacyRows,
    leaseholdRows: leaseholdRows,
    attachStates: attachStates,
    cellState: cellState,
    RESOLUTION: RESOLUTION,
    analysisRows: analysisRows,
    unmatchedEntries: unmatchedEntries,
    unresolvedCount: unresolvedCount,
  };
  if (root) root.AcquisitionLeasehold = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

})(typeof window !== 'undefined' ? window : null);
