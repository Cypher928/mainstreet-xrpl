'use strict';
/**
 * acquisition-lease-matrix.js — the Lease Matrix, and what one leasehold's
 * record opens with.
 *
 * Acquisition Review prototype (docs/ACQUISITION_REVIEW.md §4m). The review
 * opens on a scannable matrix — one row per leasehold — and a row opens that
 * leasehold's detailed record: the existing Lease Terms evidence, unchanged,
 * under a header that says what needs attention. This file decides what the
 * matrix and the header say. It adds no field and no state.
 *
 * WHAT IT READS
 *
 * Only the canonical projection (acquisition-leasehold.js, §4l): one row per
 * leasehold, whose values are the resolved terms and whose `_states` /
 * `_origins` say how settled each one is, followed by any raw row nothing
 * represents (`_source: 'unfiled'`). The matrix shows those rows; it does not
 * resolve anything again and it never reads `review.data.tenants[]` directly.
 *
 * THE RULES IT KEEPS
 *
 *   · A contested term has no value to show. Its cell says "Contested" —
 *     nothing was chosen, so nothing is reported.
 *   · A term no document establishes is NOT blank, zero or "none": its cell is
 *     an em dash carrying the words "Not established".
 *   · A value a person entered is marked as entered, every time.
 *   · An unfiled row is what a file said, unchecked. It is listed apart, never
 *     given a status, and never opens a leasehold record — it has none.
 *
 * Pure: no DOM, no network, no globals. Labels and types come from
 * AcquisitionTerms, injected as `opts.terms` (as acquisition-leasehold.js does).
 */
(function (root) {

  // The terms a person scans the matrix for. Their states decide a row's
  // status; the CAM cap rides along in the structure column.
  var KEY_FIELDS = ['leased_sqft', 'base_rent', 'end_date', 'lease_type'];

  var STATE_TEXT = {
    verified:  'Verified',
    entered:   'Entered by a person · No document on file supports this value',
    read:      'Read by AI · not yet verified',
    unclear:   'Unclear',
    contested: 'Contested — the documents disagree; nothing has been chosen',
    missing:   'Not established — no document on file establishes this',
  };

  function _AT(opts) { return (opts && opts.terms) || (root && root.AcquisitionTerms) || null; }
  function _arr(v)   { return Array.isArray(v) ? v.filter(Boolean) : []; }

  function _meta(field, opts) {
    var AT = _AT(opts);
    var m  = AT && AT.FIELD_META ? AT.FIELD_META[field] : null;
    return m || { label: field, type: 'text' };
  }

  /**
   * A value as a person reads it — the same rules as the Lease Terms panel's
   * _acqTermValue. `null` is returned as null, never as 0 or ''.
   */
  function formatValue(value, type) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (typeof value === 'number') {
      if (type === 'percent') return value + '%';
      if (type === 'money')   return '$' + value.toLocaleString('en-US');
      return value.toLocaleString('en-US');
    }
    return String(value);
  }

  /**
   * One term of one canonical row: its value, how it is shown, and its state
   * in the matrix's vocabulary. The state comes from the row's own `_states`
   * and `_origins`; nothing is inferred from the value.
   */
  function cellFor(row, field, opts) {
    var r    = row || {};
    var meta = _meta(field, opts);
    var st   = (r._states || {})[field] || 'missing';
    var entered = (r._origins || {})[field] === 'entered';
    var state =
        st === 'conflicting' ? 'contested'
      : st === 'missing'     ? 'missing'
      : entered              ? 'entered'
      : st === 'verified'    ? 'verified'
      : st === 'unclear'     ? 'unclear'
      :                        'read';
    var value = state === 'contested' ? null : (r[field] === undefined ? null : r[field]);
    var text  = state === 'contested' ? 'Contested'
              : state === 'missing'   ? null
              : formatValue(value, meta.type);
    return { field: field, label: meta.label, type: meta.type, state: state,
             value: value, text: text, stateText: STATE_TEXT[state] };
  }

  /**
   * What needs attention on one leasehold, in the order a person should see
   * it: every contested term (any field — the documents disagree and nothing
   * has been chosen), then any KEY term that is missing or unclear.
   */
  function attentionFor(row, opts) {
    var r = row || {};
    var AT = _AT(opts);
    // In review order, so the list reads in the order the record below does.
    var fields = detailOrder((AT && Array.isArray(AT.FIELDS)) ? AT.FIELDS : Object.keys(r._states || {}));
    var out = [];
    fields.forEach(function (f) {
      if ((r._states || {})[f] === 'conflicting') {
        var c = cellFor(r, f, opts);
        out.push({ field: f, label: c.label, kind: 'contested', text: c.label + ' — contested' });
      }
    });
    KEY_FIELDS.forEach(function (f) {
      var c = cellFor(r, f, opts);
      if (c.state === 'missing') out.push({ field: f, label: c.label, kind: 'missing', text: c.label + ' — not established' });
      else if (c.state === 'unclear') out.push({ field: f, label: c.label, kind: 'unclear', text: c.label + ' — unclear' });
    });
    return out;
  }

  /**
   * The row's status, from its attention list and its key terms' states:
   *   issues      one or more terms are contested ("2 issues")
   *   missing     a key term is not established
   *   unclear     a key term is unclear
   *   unverified  every key term has a value, and at least one is only read by AI
   *   verified    every key term is verified or entered
   */
  function statusFor(row, attention, opts) {
    var att = attention || attentionFor(row, opts);
    var contested = att.filter(function (a) { return a.kind === 'contested'; }).length;
    if (contested) return { kind: 'issues', label: contested + (contested === 1 ? ' issue' : ' issues') };
    if (att.some(function (a) { return a.kind === 'missing'; }))  return { kind: 'missing', label: 'Missing terms' };
    if (att.some(function (a) { return a.kind === 'unclear'; }))  return { kind: 'unclear', label: 'Unclear terms' };
    var read = KEY_FIELDS.some(function (f) { return cellFor(row, f, opts).state === 'read'; });
    if (read) return { kind: 'unverified', label: 'Not yet verified' };
    return { kind: 'verified', label: 'Key terms verified' };
  }

  /** Lease / CAM structure: the lease type, then the CAM cap — each with its own state. */
  function structureFor(row, opts) {
    var type = cellFor(row, 'lease_type', opts);
    var cap  = cellFor(row, 'cap', opts);
    var parts = [];
    if (type.state === 'contested') parts.push({ field: 'lease_type', state: 'contested', text: 'Lease type contested' });
    else if (type.text !== null)    parts.push({ field: 'lease_type', state: type.state, text: type.text });
    if (cap.state === 'contested')  parts.push({ field: 'cap', state: 'contested', text: 'Cap contested' });
    else if (cap.text !== null)     parts.push({ field: 'cap', state: cap.state, text: cap.text + ' cap' });
    return { parts: parts, text: parts.length ? parts.map(function (p) { return p.text; }).join(' · ') : null };
  }

  /** One matrix row for one leasehold. */
  function leaseholdEntry(row, opts) {
    var r = row || {};
    var attention = attentionFor(r, opts);
    return {
      leaseholdId: r._leaseholdId || r.id || null,
      tenant:      r.tenant_name || 'Unnamed leasehold',
      tenantFrom:  r._tenantNameFrom || null,
      documentCount: typeof r._documentCount === 'number' ? r._documentCount : null,
      cells: {
        leased_sqft: cellFor(r, 'leased_sqft', opts),
        base_rent:   cellFor(r, 'base_rent', opts),
        end_date:    cellFor(r, 'end_date', opts),
        lease_type:  cellFor(r, 'lease_type', opts),
        cap:         cellFor(r, 'cap', opts),
      },
      structure: structureFor(r, opts),
      attention: attention,
      status:    statusFor(r, attention, opts),
    };
  }

  /** A raw row nothing represents: shown as the file said it, unverified. */
  function unfiledEntry(row) {
    var r = row || {};
    var sf = (r.leased_sqft === null || r.leased_sqft === undefined || r.leased_sqft === '') ? null : Number(r.leased_sqft);
    return {
      tenant:   r.tenant_name || r.tenantName || 'Unnamed',
      sqftText: (sf === null || isNaN(sf)) ? null : sf.toLocaleString('en-US'),
      fileName: r._fileName || r.fileName || null,
      why:      r._legacyWhy || null,
    };
  }

  /**
   * The matrix for a review, from its canonical rows (the §4l projection's
   * `rows`). Leaseholds keep the projection's order.
   */
  function buildMatrix(canonicalRows, opts) {
    var rows = _arr(canonicalRows);
    var leaseholds = rows.filter(function (r) { return r._source === 'leasehold'; }).map(function (r) { return leaseholdEntry(r, opts); });
    var unfiled    = rows.filter(function (r) { return r._source === 'unfiled'; }).map(unfiledEntry);
    return { leaseholds: leaseholds, unfiled: unfiled };
  }

  /**
   * The line under a leasehold's name in its record: area, lease type, base
   * rent — each stated, or said to be missing or contested, never left out
   * silently. e.g. "67,000 SF · NNN · $1,251,250 base rent".
   */
  function headline(entry) {
    var e = entry || {}, c = e.cells || {};
    function part(cell, fmt, noun) {
      if (!cell) return null;
      if (cell.state === 'contested') return noun + ' contested';
      if (cell.text === null)         return noun + ' not established';
      return fmt(cell.text);
    }
    return [
      part(c.leased_sqft, function (t) { return t + ' SF'; }, 'Leased area'),
      part(c.lease_type,  function (t) { return t; },          'Lease type'),
      part(c.base_rent,   function (t) { return t + ' base rent'; }, 'Base rent'),
    ].filter(Boolean).join(' · ');
  }

  /** "2 items need attention" — or null when nothing does. */
  function attentionHeading(entry) {
    var n = ((entry || {}).attention || []).length;
    if (!n) return null;
    return n + (n === 1 ? ' item needs attention' : ' items need attention');
  }

  // ── The leasehold's record ─────────────────────────────────────────────────

  // The order a person reviews a lease in: who and where, the term, the rent
  // and the CAM cap, security and renewal — the CORE lease terms — then the
  // OTHER lease terms: the CAM mechanics, and the obligations and special
  // terms. Every field the resolver knows appears exactly once (detailOrder
  // appends any field not named here, so a new one is never lost). There is
  // no separate rent-increase field: escalations live in the base-rent clause.
  var DETAIL_GROUPS = [
    { key: 'premises', tier: 'core', title: 'Premises & term',
      fields: ['tenant_name', 'suite', 'leased_sqft', 'start_date', 'end_date', 'lease_type'] },
    { key: 'rent', tier: 'core', title: 'Rent & CAM cap', fields: ['base_rent', 'cap'] },
    { key: 'security', tier: 'core', title: 'Security & renewal', fields: ['security_deposit', 'renewal_options'] },
    { key: 'cam', tier: 'other', title: 'CAM details',
      fields: ['cap_base_amount', 'admin_fee_pct', 'admin_fee_basis', 'gross_up_pct',
               'expense_stop', 'pro_rata_method', 'excluded_categories', 'audit_rights'] },
    { key: 'obligations', tier: 'other', title: 'Obligations & special terms',
      fields: ['tenant_improvement_allowance', 'landlord_work', 'termination_rights', 'expansion_rights',
               'assignment_consent', 'exclusive_use', 'co_tenancy', 'guarantor_name', 'guaranty_limit'] },
  ];
  var TIERS = [{ key: 'core', title: 'Core lease terms' }, { key: 'other', title: 'Other lease terms' }];
  var CORE_FIELDS = DETAIL_GROUPS.filter(function (g) { return g.tier === 'core'; })
    .reduce(function (a, g) { return a.concat(g.fields); }, []);
  var DETAIL_ORDER = DETAIL_GROUPS.reduce(function (a, g) { return a.concat(g.fields); }, []);

  /** `fields` in review order: the named ones first, then anything unnamed, in its own order. */
  function detailOrder(fields) {
    var all = _arr(fields);
    var named = DETAIL_ORDER.filter(function (f) { return all.indexOf(f) >= 0; });
    return named.concat(all.filter(function (f) { return DETAIL_ORDER.indexOf(f) < 0; }));
  }

  /** A resolved term's state in the record's vocabulary — the matrix's, one to one. */
  function termState(term) {
    var t = term || {};
    return t.state === 'conflicting' ? 'contested'
         : t.state === 'missing'     ? 'missing'
         : t.support === 'entered'   ? 'entered'
         : t.state === 'verified'    ? 'verified'
         : t.state === 'unclear'     ? 'unclear'
         :                             'read';
  }

  /**
   * The Lease Terms layer of a record: every term, in review order, grouped,
   * with its value as a person reads it — or "Contested" (nothing chosen), or
   * null for not established. Read from the resolver's terms for that
   * leasehold, the same terms the evidence below is drawn from.
   */
  function termRows(resolvedTerms, opts) {
    var terms = resolvedTerms || {};
    var AT = _AT(opts);
    var known = (AT && Array.isArray(AT.FIELDS)) ? AT.FIELDS : Object.keys(terms);
    var order = detailOrder(known.filter(function (f) { return terms[f]; }));
    var groupOf = {};
    DETAIL_GROUPS.forEach(function (g) { g.fields.forEach(function (f) { groupOf[f] = g.key; }); });
    var groups = DETAIL_GROUPS.map(function (g) { return { key: g.key, tier: g.tier, title: g.title, rows: [] }; });
    var other = { key: 'other', tier: 'other', title: 'Other terms', rows: [] };
    order.forEach(function (f) {
      var t = terms[f], meta = _meta(f, opts), state = termState(t);
      var text = state === 'contested' ? 'Contested'
               : state === 'missing'   ? null
               : formatValue(t.value, meta.type);
      var row = { field: f, label: t.label || meta.label, state: state, text: text };
      var g = groups.filter(function (x) { return x.key === groupOf[f]; })[0] || other;
      g.rows.push(row);
    });
    return groups.concat(other.rows.length ? [other] : []).filter(function (g) { return g.rows.length; });
  }

  /**
   * The Lease Terms layer split in two: CORE lease terms, then OTHER lease
   * terms — each tier its groups, and the count of its terms by state, so a
   * collapsed tier still says what is in it. Nothing is dropped: every row
   * termRows returns is in exactly one tier.
   */
  function termSections(resolvedTerms, opts) {
    var groups = termRows(resolvedTerms, opts);
    return TIERS.map(function (t) {
      var gs = groups.filter(function (g) { return g.tier === t.key; });
      var rows = gs.reduce(function (a, g) { return a.concat(g.rows); }, []);
      var n = function (st) { return rows.filter(function (r) { return r.state === st; }).length; };
      return { key: t.key, title: t.title, groups: gs, total: rows.length,
               counts: { verified: n('verified') + n('entered'), contested: n('contested'),
                         missing: n('missing'), unclear: n('unclear'), read: n('read') } };
    }).filter(function (t) { return t.total; });
  }

  /** "17 terms · 1 contested · 9 not established" — a tier's contents, in words. */
  function sectionLine(section) {
    var s = section || {}, c = s.counts || {};
    var parts = [(s.total || 0) + ((s.total === 1) ? ' term' : ' terms')];
    if (c.verified)  parts.push(c.verified + ' verified');
    if (c.contested) parts.push(c.contested + ' contested');
    if (c.unclear)   parts.push(c.unclear + ' unclear');
    if (c.read)      parts.push(c.read + ' not yet verified');
    if (c.missing)   parts.push(c.missing + ' not established');
    return parts.join(' · ');
  }

  /**
   * What each document says about a CONTESTED term — every reading, each with
   * its own document, clause, page and confidence, in file-name order so that
   * no document is presented first as though it were the answer. Empty for a
   * term that is not contested.
   */
  function contestedReadings(term) {
    var t = term || {};
    if (t.state !== 'conflicting') return [];
    var seen = {}, out = [];
    function add(r) {
      if (!r) return;
      var key = (r.documentId || r.fileName || '') + '|' + String(r.value);
      if (seen[key]) return;
      seen[key] = true;
      out.push({ fileName: r.fileName || null, docType: r.docType || null, value: r.value,
                 quote: r.quote || null, page: r.page == null ? null : r.page,
                 confidence: r.confidence == null ? null : r.confidence });
    }
    add({ documentId: t.governingDocumentId, fileName: t.governingDocumentName, docType: t.governingDocType,
          value: t.value, quote: t.quote, page: t.page, confidence: t.confidence });
    _arr(t.supersededValues).forEach(add);
    return out.sort(function (a, b) { return String(a.fileName || '').localeCompare(String(b.fileName || '')); });
  }

  /**
   * The matrix header: readiness per LEASEHOLD, never a count of every
   * possible term. e.g. "4 leaseholds · 1 with issues · 2 with missing terms ·
   * 1 with unclear terms". '' when there is no leasehold.
   */
  function summaryLine(matrix) {
    var ls = ((matrix || {}).leaseholds) || [];
    if (!ls.length) return '';
    var n = function (kind) { return ls.filter(function (e) { return e.status && e.status.kind === kind; }).length; };
    var parts = [ls.length + (ls.length === 1 ? ' leasehold' : ' leaseholds')];
    var issues = n('issues'), missing = n('missing'), unclear = n('unclear'), unverified = n('unverified'), verified = n('verified');
    if (issues)     parts.push(issues + ' with issues');
    if (missing)    parts.push(missing + ' with missing terms');
    if (unclear)    parts.push(unclear + ' with unclear terms');
    if (unverified) parts.push(unverified + ' not yet verified');
    if (verified)   parts.push(verified + ' with key terms verified');
    return parts.join(' · ');
  }

  var api = {
    KEY_FIELDS: KEY_FIELDS,
    DETAIL_GROUPS: DETAIL_GROUPS,
    DETAIL_ORDER: DETAIL_ORDER,
    detailOrder: detailOrder,
    termState: termState,
    termRows: termRows,
    termSections: termSections,
    sectionLine: sectionLine,
    CORE_FIELDS: CORE_FIELDS,
    TIERS: TIERS,
    contestedReadings: contestedReadings,
    summaryLine: summaryLine,
    STATE_TEXT: STATE_TEXT,
    formatValue: formatValue,
    cellFor: cellFor,
    attentionFor: attentionFor,
    statusFor: statusFor,
    structureFor: structureFor,
    leaseholdEntry: leaseholdEntry,
    unfiledEntry: unfiledEntry,
    buildMatrix: buildMatrix,
    headline: headline,
    attentionHeading: attentionHeading,
  };
  if (root) root.AcquisitionLeaseMatrix = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

})(typeof window !== 'undefined' ? window : null);
