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
    // A term's flag, for the screens: a reading a person REJECTED (no value —
    // the resolver keeps the reading as evidence only), or an ENTERED value a
    // document now reads differently (the entered value stands, with a
    // warning until a person decides).
    var states = {}, origins = {}, quotes = {}, flags = {};
    Object.keys(terms).forEach(function (f) {
      var t = terms[f] || {};
      states[f]  = t.state || 'missing';
      origins[f] = t.support === 'entered' ? 'entered' : null;
      flags[f]   = t.rejected ? 'rejected' : t.enteredConflict ? 'entered_conflict' : null;
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
      // The acquisition matrix's own columns. Acquisition-only: conversion
      // carries none of them to the property's tenant record.
      rent_escalations:   v('rent_escalations'),
      cam_recovery:       v('cam_recovery'),
      tax_recovery:       v('tax_recovery'),
      insurance_recovery: v('insurance_recovery'),
      percentage_rent:    v('percentage_rent'),
      quotes:   quotes,
      _states:  states,
      _origins: origins,
      _flags:   flags,
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

  // ── Matching concerns: is this extraction plausibly this leasehold? ────────
  //
  // A person matches an extracted entry to a leasehold by hand. Nothing used to
  // compare the two, and "SafeShield Security, LLC" (read from a lease naming
  // "500 Main Street") was matched to "Sunrise Cafe & Bakery LLC" on a closed
  // acquisition. This compares what can be compared and says what it found. It
  // never decides: a MISMATCH is a material conflict a person must explain to
  // proceed past; UNCERTAIN is a comparison too weak to call either way, shown
  // for a look. Harmless differences — case, punctuation, "&" for "and", legal
  // suffixes, words every such business shares — are not differences.
  var CONCERN = { TENANT_NAME: 'tenant_name', PROPERTY_NAME: 'property_name' };
  var CONCERN_LEVEL = { MISMATCH: 'mismatch', UNCERTAIN: 'uncertain' };
  var LEGAL_SUFFIX = { llc: 1, inc: 1, incorporated: 1, corp: 1, corporation: 1, co: 1, company: 1, ltd: 1,
                       limited: 1, lp: 1, llp: 1, plc: 1, pllc: 1, pc: 1, pa: 1, dba: 1 };
  var FILLER = { and: 1, of: 1, the: 1, a: 1, an: 1, at: 1, by: 1 };
  // Words that describe a kind of business, not which one: sharing "cafe" is not
  // evidence that two names are the same tenant.
  var GENERIC_TENANT = { cafe: 1, coffee: 1, bakery: 1, restaurant: 1, grill: 1, kitchen: 1, bar: 1, pizza: 1, deli: 1,
    shop: 1, shops: 1, store: 1, stores: 1, market: 1, markets: 1, supermarket: 1, supermarkets: 1, salon: 1, spa: 1,
    nails: 1, studio: 1, services: 1, service: 1, group: 1, holdings: 1, enterprises: 1, partners: 1, associates: 1,
    international: 1, retail: 1, center: 1, wellness: 1, security: 1, insurance: 1, bank: 1, pharmacy: 1,
    fitness: 1, gym: 1, dental: 1, medical: 1, clinic: 1, health: 1 };
  var GENERIC_PROPERTY = { plaza: 1, center: 1, centre: 1, shopping: 1, mall: 1, retail: 1, square: 1, commons: 1,
    marketplace: 1, village: 1, crossing: 1, station: 1, property: 1, properties: 1, building: 1,
    street: 1, st: 1, avenue: 1, ave: 1, road: 1, rd: 1, boulevard: 1, blvd: 1, drive: 1, dr: 1, lane: 1, ln: 1,
    way: 1, suite: 1, ste: 1, highway: 1, hwy: 1, parkway: 1, pkwy: 1 };

  // A name as comparable words: lower case, "&" read as "and", apostrophes and
  // punctuation gone, spelled-out letters joined ("L.L.C." → "llc"), legal
  // suffixes and filler dropped.
  function _nameTokens(s) {
    var raw = String(s == null ? '' : s).toLowerCase().replace(/&/g, ' and ').replace(/['’]/g, '')
      .replace(/[^a-z0-9]+/g, ' ').trim();
    if (!raw) return [];
    var parts = raw.split(/\s+/), out = [], run = '';
    parts.forEach(function (p) {
      if (p.length === 1 && /[a-z]/.test(p)) { run += p; return; }
      if (run) { out.push(run); run = ''; }
      out.push(p);
    });
    if (run) out.push(run);
    return out.filter(function (t) { return !LEGAL_SUFFIX[t] && !FILLER[t]; });
  }
  function _distinct(tokens, generic) {
    return tokens.filter(function (t) { return !generic[t] && !/^\d+$/.test(t); });
  }
  function _same(a, b) { return a.length === b.length && a.every(function (t, i) { return t === b[i]; }); }
  function _shared(a, b) { return a.filter(function (t) { return b.indexOf(t) >= 0; }); }

  /**
   * Compare two tenant names. Returns null when they name the same tenant once
   * harmless differences are set aside, else { level, why }.
   */
  function compareTenantNames(extracted, selected) {
    var a = _nameTokens(extracted), b = _nameTokens(selected);
    if (!a.length || !b.length) return { level: CONCERN_LEVEL.UNCERTAIN, why: 'one of the names is blank' };
    if (_same(a, b) || a.join('') === b.join('')) return null;
    var da = _distinct(a, GENERIC_TENANT), db = _distinct(b, GENERIC_TENANT);
    if (!da.length || !db.length) return { level: CONCERN_LEVEL.UNCERTAIN, why: 'the names are too generic to compare' };
    var common = _shared(da, db);
    if (!common.length) return { level: CONCERN_LEVEL.MISMATCH, why: 'the names share no distinguishing word' };
    // The same distinguishing words: the same tenant when one name only adds
    // descriptive words to the other ("Sunrise Cafe" / "Sunrise Cafe & Bakery");
    // a look when each describes a different business ("SafeShield Security" /
    // "SafeShield Insurance").
    if (_same(da.slice().sort(), db.slice().sort())) {
      var aInB = a.every(function (x) { return b.indexOf(x) >= 0; });
      var bInA = b.every(function (x) { return a.indexOf(x) >= 0; });
      return (aInB || bInA) ? null
        : { level: CONCERN_LEVEL.UNCERTAIN, why: 'the names share a distinguishing word but describe different businesses' };
    }
    return { level: CONCERN_LEVEL.UNCERTAIN, why: 'the names only partly agree' };
  }

  // The name part of a property line: what precedes the first comma.
  function _propertyName(s) { return String(s == null ? '' : s).split(',')[0]; }

  /**
   * Compare the property an extraction's lease names with the acquisition's
   * own names (the review's name, its property's name). Returns null when they
   * agree or there is nothing to compare, else { level, why }. A lease that
   * names only a street address cannot be told apart from a property recorded
   * by name: that is UNCERTAIN, never proof of a mismatch.
   */
  function compareProperty(sourceProperty, acquisitionNames) {
    var src = String(sourceProperty == null ? '' : sourceProperty).trim();
    var names = _arr(acquisitionNames).map(function (n) { return String(n).trim(); }).filter(Boolean);
    if (!src || !names.length) return null;
    var srcName = _propertyName(src);
    var st = _nameTokens(srcName), sd = _distinct(st, GENERIC_PROPERTY);
    var addressOnly = /^\s*\d+[a-z]?\b/i.test(srcName);
    var best = null;
    for (var i = 0; i < names.length; i++) {
      var nt = _nameTokens(_propertyName(names[i])), nd = _distinct(nt, GENERIC_PROPERTY);
      if (_same(st, nt) || (sd.length && nd.length && _shared(sd, nd).length)) return null;
      var nameHasNumber = /\d/.test(names[i]);
      var r = (addressOnly && !nameHasNumber)
        ? { level: CONCERN_LEVEL.UNCERTAIN, why: 'the lease names a street address, and the acquisition records no address to compare it with' }
        : (!sd.length || !nd.length)
          ? { level: CONCERN_LEVEL.UNCERTAIN, why: 'the property names are too generic to compare' }
          : { level: CONCERN_LEVEL.MISMATCH, why: 'the lease names a different property' };
      if (!best || (best.level === CONCERN_LEVEL.MISMATCH && r.level === CONCERN_LEVEL.UNCERTAIN)) best = r;
    }
    return best;
  }

  /**
   * What a person should know before matching `row` (an unmatched extraction)
   * to `family` (a leasehold). `opts.acquisitionNames` are the acquisition's
   * own names. Returns [{ kind, level, extracted, selected, text }] — [] when
   * nothing calls for a look.
   */
  function matchConcerns(row, family, opts) {
    var r = row || {}, f = family || {}, o = opts || {};
    var out = [];
    var extracted = r.tenant_name || r.tenantName || '';
    var selected  = f.label || f.tenant_hint || '';
    var t = compareTenantNames(extracted, selected);
    if (t) out.push({ kind: CONCERN.TENANT_NAME, level: t.level, extracted: extracted || null, selected: selected || null,
      text: (t.level === CONCERN_LEVEL.MISMATCH ? 'Tenant names do not match' : 'Tenant names may not match')
        + ': the extracted entry is “' + (extracted || 'unnamed') + '” and the leasehold is “' + (selected || 'unnamed') + '” — ' + t.why + '.' });
    var source = r.property_name || r.propertyName || '';
    var names = _arr(o.acquisitionNames);
    var p = compareProperty(source, names);
    if (p) out.push({ kind: CONCERN.PROPERTY_NAME, level: p.level, extracted: source || null, selected: names.join(' / ') || null,
      text: (p.level === CONCERN_LEVEL.MISMATCH ? 'Property does not match' : 'Property may not match')
        + ': the lease names “' + source + '” and this acquisition is “' + names.join(' / ') + '” — ' + p.why + '.' });
    return out;
  }

  /** A match with a material conflict can proceed only with a person's reason. */
  function requiresReason(concerns) {
    return _arr(concerns).some(function (c) { return c.level === CONCERN_LEVEL.MISMATCH; });
  }

  // ── Leaseholds with no lease on file ──────────────────────────────────────
  //
  // A leasehold a person established from an extraction can have no document
  // at all (Sunrise Cafe & Bakery LLC on Maple Plaza). Every one of its terms
  // is then "not established", and acquiring the property makes it a permanent
  // tenant with none. Before conversion that is said, leasehold by leasehold,
  // and a person acknowledges it. An acknowledgement records that the lease is
  // missing; it never verifies a term — the terms stay not established.
  var NO_DOCUMENT_ON_FILE = 'no_document_on_file';

  /**
   * The leaseholds no live document is filed into. A document counts when it
   * is filed into the leasehold, has not been replaced by a newer upload, and
   * has not been set aside as not relevant or a duplicate.
   * Returns [{ familyId, label }] in the families' order.
   */
  function documentlessLeaseholds(families, documents, dispositions) {
    var disp = (dispositions && typeof dispositions === 'object') ? dispositions : {};
    var live = {};
    _arr(documents).forEach(function (d) {
      if (!d.family_id || d.superseded_by_document_id) return;
      var x = disp[d.id];
      if (x && (x.action === 'not_relevant' || x.action === 'duplicate')) return;
      live[d.family_id] = true;
    });
    return _arr(families).filter(function (f) { return f.id && !live[f.id]; })
      .map(function (f) { return { familyId: f.id, label: f.label || f.tenant_hint || 'Unnamed leasehold' }; });
  }

  /** Those of them no person has acknowledged. Conversion waits for []. */
  function unacknowledgedDocumentless(families, documents, acknowledgements, dispositions) {
    var acks = (acknowledgements && typeof acknowledgements === 'object') ? acknowledgements : {};
    return documentlessLeaseholds(families, documents, dispositions).filter(function (l) {
      var a = acks[l.familyId];
      return !(a && typeof a === 'object' && a.condition === NO_DOCUMENT_ON_FILE);
    });
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
    CONCERN: CONCERN,
    CONCERN_LEVEL: CONCERN_LEVEL,
    compareTenantNames: compareTenantNames,
    compareProperty: compareProperty,
    matchConcerns: matchConcerns,
    requiresReason: requiresReason,
    NO_DOCUMENT_ON_FILE: NO_DOCUMENT_ON_FILE,
    documentlessLeaseholds: documentlessLeaseholds,
    unacknowledgedDocumentless: unacknowledgedDocumentless,
    analysisRows: analysisRows,
    unmatchedEntries: unmatchedEntries,
    unresolvedCount: unresolvedCount,
  };
  if (root) root.AcquisitionLeasehold = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

})(typeof window !== 'undefined' ? window : null);
