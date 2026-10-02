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
 *   · A term a document speaks to without a clear value is NOT "Not
 *     established": its cell says "Unclear" (F1). The clause exists; it could
 *     not be read. Only `missing` is drawn as the em dash.
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

  // THE FIVE STATES, in the words a person reads everywhere in the workspace:
  // the matrix, the record, the evidence chips, the legend and every count.
  // "Verified" is only ever reached by a person confirming, correcting or
  // entering a value (acquisition-terms.js), so it says so. An entered value
  // is verified by a person; the ✎ mark says no document supports it.
  var STATE_LABEL = {
    verified:  'Verified by a person',
    entered:   'Verified by a person',
    read:      'Read by AI · not yet verified',
    unclear:   'Unclear',
    contested: 'Contested',
    missing:   'Not established',
  };
  // The same five, keyed by the resolver's own state names.
  var TERM_STATE_LABEL = {
    verified:     STATE_LABEL.verified,
    ai_extracted: STATE_LABEL.read,
    unclear:      STATE_LABEL.unclear,
    conflicting:  STATE_LABEL.contested,
    missing:      STATE_LABEL.missing,
  };
  // A cell's tooltip: the state, then what it means.
  var STATE_TEXT = {
    verified:  STATE_LABEL.verified,
    entered:   STATE_LABEL.entered + ' — entered, no document on file supports this value',
    read:      STATE_LABEL.read,
    unclear:   STATE_LABEL.unclear + ' — a document has language here, but no clear value',
    contested: STATE_LABEL.contested + ' — the documents disagree; nothing has been chosen',
    missing:   STATE_LABEL.missing + ' — no document on file establishes this',
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

  // A value's words in its state. An unclear term with no value says
  // "Unclear" — never null, which every renderer draws as "Not established".
  function _textOf(state, value, type) {
    var t = formatValue(value, type);
    return (t === null && state === 'unclear') ? STATE_LABEL.unclear : t;
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
    var flag  = (r._flags || {})[field] || null;
    // A rejected reading is no value; the cell says who set it aside.
    var rejected = flag === 'rejected' && state === 'unclear';
    var text  = state === 'contested' ? 'Contested'
              : state === 'missing'   ? null
              : rejected              ? REJECTED_TEXT
              : _textOf(state, value, meta.type);
    var out = { field: field, label: meta.label, type: meta.type, state: state,
                value: rejected ? null : value, text: text,
                stateText: rejected ? REJECTED_TEXT + ' — the reading is kept as evidence, not used'
                         : flag === 'entered_conflict' && state === 'entered' ? STATE_TEXT[state] + ' — a document now reads this term differently'
                         : STATE_TEXT[state] };
    if (rejected) out.rejected = true;
    if (flag === 'entered_conflict' && state === 'entered') out.conflict = true;
    return out;
  }
  var REJECTED_TEXT = 'Rejected by a person';

  /**
   * Every term of a canonical row that has a value only the AI has read —
   * nobody has confirmed or corrected it — in review order.
   */
  function unverifiedFor(row, opts) {
    var r = row || {};
    var AT = _AT(opts);
    var fields = detailOrder((AT && Array.isArray(AT.FIELDS)) ? AT.FIELDS : Object.keys(r._states || {}));
    return fields.filter(function (f) { return (r._states || {})[f] && cellFor(r, f, opts).state === 'read'; });
  }

  /**
   * The issues that decide a row's status, in the order a person should see
   * them: every contested term (any field — the documents disagree and nothing
   * has been chosen), then any KEY term that is missing or unclear. The whole
   * workload, every term by state, is attentionSummary.
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
    fields.forEach(function (f) {
      var c = cellFor(r, f, opts);
      if (c.conflict) out.push({ field: f, label: c.label, kind: 'entered_conflict', text: c.label + ' — entered value; a document now reads it differently' });
    });
    KEY_FIELDS.forEach(function (f) {
      var c = cellFor(r, f, opts);
      if (c.state === 'missing') out.push({ field: f, label: c.label, kind: 'missing', text: c.label + ' — not established' });
      else if (c.state === 'unclear') out.push({ field: f, label: c.label, kind: 'unclear', text: c.label + ' — unclear' });
    });
    return out;
  }

  // What remains to review, in the order it matters: the documents disagree,
  // nothing establishes it, it is unclear, a person has not yet checked the
  // AI's reading. Verified terms are done and not listed.
  var ATTENTION_KINDS = [
    { kind: 'contested',  state: 'contested', words: function () { return 'contested'; } },
    { kind: 'entered_conflict', test: function (c) { return !!c.conflict; },
      words: function (n) { return (n === 1 ? 'entered value' : 'entered values') + ' a document now reads differently'; } },
    { kind: 'missing',    state: 'missing',   words: function () { return 'not established'; } },
    { kind: 'unclear',    state: 'unclear',   words: function () { return 'unclear'; } },
    { kind: 'unverified', state: 'read',      words: function (n) { return (n === 1 ? 'value' : 'values') + ' read by AI · not yet verified'; } },
  ];

  /**
   * Needs attention, as the actual workload: every term of the leasehold that
   * is not verified, grouped by its state, each group with its count and its
   * terms in review order — "2 contested", "9 not established", "1 unclear",
   * "11 values read by AI · not yet verified". Read from the row's own states,
   * the same ones the evidence is drawn from; nothing is summed into "items".
   * [] when every term is verified.
   */
  function attentionSummary(row, opts) {
    var r = row || {};
    var AT = _AT(opts);
    var fields = detailOrder((AT && Array.isArray(AT.FIELDS)) ? AT.FIELDS : Object.keys(r._states || {}))
      .filter(function (f) { return (r._states || {})[f]; });
    var cells = fields.map(function (f) { return cellFor(r, f, opts); });
    return ATTENTION_KINDS.map(function (k) {
      var terms = cells.filter(function (c) { return k.test ? k.test(c) : c.state === k.state; })
        .map(function (c) { return { field: c.field, label: c.label }; });
      return { kind: k.kind, count: terms.length, text: terms.length + ' ' + k.words(terms.length), terms: terms };
    }).filter(function (g) { return g.count > 0; });
  }

  /**
   * The row's status, from its attention list and its key terms' states:
   *   issues      one or more terms are contested ("2 contested")
   *   missing     a key term is not established
   *   unclear     a key term is unclear
   *   unverified  every key term has a value, and at least one is only read by AI
   *   verified    every key term is verified or entered
   */
  function statusFor(row, attention, opts) {
    var att = attention || attentionFor(row, opts);
    var contested = att.filter(function (a) { return a.kind === 'contested'; }).length;
    if (contested) return { kind: 'issues', label: contested + ' contested' };
    var conflicts = att.filter(function (a) { return a.kind === 'entered_conflict'; }).length;
    if (conflicts) return { kind: 'issues', label: conflicts === 1 ? '1 entered value to review' : conflicts + ' entered values to review' };
    if (att.some(function (a) { return a.kind === 'missing'; }))  return { kind: 'missing', label: 'Terms not established' };
    if (att.some(function (a) { return a.kind === 'unclear'; }))  return { kind: 'unclear', label: 'Unclear terms' };
    var read = KEY_FIELDS.some(function (f) { return cellFor(row, f, opts).state === 'read'; });
    if (read) return { kind: 'unverified', label: 'Not yet verified' };
    return { kind: 'verified', label: 'Key terms verified by a person' };
  }

  // An unclear cell with no value to show: the clause exists, unread.
  function _noValue(cell) { return !!cell && cell.state === 'unclear' && (cell.value === null || cell.value === undefined); }

  /** Lease / CAM structure: the lease type, then the CAM cap — each with its own state. */
  function structureFor(row, opts) {
    var type = cellFor(row, 'lease_type', opts);
    var cap  = cellFor(row, 'cap', opts);
    var parts = [];
    if (type.state === 'contested') parts.push({ field: 'lease_type', state: 'contested', text: 'Lease type contested' });
    else if (_noValue(type))        parts.push({ field: 'lease_type', state: 'unclear', text: 'Lease type unclear' });
    else if (type.text !== null)    parts.push({ field: 'lease_type', state: type.state, text: type.text });
    if (cap.state === 'contested')  parts.push({ field: 'cap', state: 'contested', text: 'Cap contested' });
    else if (_noValue(cap))         parts.push({ field: 'cap', state: 'unclear', text: 'Cap unclear' });
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
      unverified: unverifiedFor(r, opts),
      attention: attention,
      attentionSummary: attentionSummary(r, opts),
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
      if (_noValue(cell))             return noun + ' unclear';
      if (cell.text === null)         return noun + ' not established';
      return fmt(cell.text);
    }
    return [
      part(c.leased_sqft, function (t) { return t + ' SF'; }, 'Leased area'),
      part(c.lease_type,  function (t) { return t; },          'Lease type'),
      part(c.base_rent,   function (t) { return t + ' base rent'; }, 'Base rent'),
    ].filter(Boolean).join(' · ');
  }

  // ── The leasehold's record ─────────────────────────────────────────────────

  // The order a person reviews a lease in: who and where, the term, the rent
  // and the CAM cap, security and renewal — the CORE lease terms — then the
  // OTHER lease terms: the CAM mechanics, and the obligations and special
  // terms. Every field the resolver knows appears exactly once (detailOrder
  // appends any field not named here, so a new one is never lost). The
  // acquisition matrix's own columns — rent increases and how CAM, taxes and
  // insurance are recovered, and percentage rent — follow the rent they
  // qualify, in "Rent & recoveries", among the OTHER terms.
  var DETAIL_GROUPS = [
    { key: 'premises', tier: 'core', title: 'Premises & term',
      fields: ['tenant_name', 'suite', 'leased_sqft', 'start_date', 'end_date', 'lease_type'] },
    { key: 'rent', tier: 'core', title: 'Rent & CAM cap', fields: ['base_rent', 'cap'] },
    { key: 'security', tier: 'core', title: 'Security & renewal', fields: ['security_deposit', 'renewal_options'] },
    { key: 'recoveries', tier: 'other', title: 'Rent & recoveries',
      fields: ['rent_escalations', 'cam_recovery', 'tax_recovery', 'insurance_recovery', 'percentage_rent'] },
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
   * with its value as a person reads it — or "Contested" (nothing chosen),
   * "Unclear" (language, no clear value), or null for not established. Read from the resolver's terms for that
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
               : t.rejected            ? REJECTED_TEXT
               : _textOf(state, t.value, meta.type);
      var row = { field: f, label: t.label || meta.label, state: state, text: text };
      if (t.rejected) row.rejected = true;
      if (t.enteredConflict) row.conflict = true;
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

  /**
   * Term counts in the five states' words, in the one order used everywhere:
   * verified by a person · read by AI, not yet verified · unclear · contested
   * · not established. Zero counts are left out. Inside a count line the
   * "Read by AI · not yet verified" label takes a comma, so that " · " still
   * separates one count from the next.
   *   c = { total, verified, read, unclear, contested, missing }
   */
  function countsLine(c) {
    var x = c || {};
    var parts = [];
    if (x.total != null) parts.push(x.total + (x.total === 1 ? ' term' : ' terms'));
    if (x.verified)  parts.push(x.verified + ' verified by a person');
    if (x.read)      parts.push(x.read + ' read by AI, not yet verified');
    if (x.unclear)   parts.push(x.unclear + ' unclear');
    if (x.contested) parts.push(x.contested + ' contested');
    if (x.missing)   parts.push(x.missing + ' not established');
    return parts.join(' · ');
  }

  /** The resolver's summary ({ total, verified, ai_extracted, … }) as a counts line. */
  function summaryCounts(summary) {
    var s = summary || {};
    return { total: s.total, verified: s.verified, read: s.ai_extracted, unclear: s.unclear,
             contested: s.conflicting, missing: s.missing };
  }

  /** "17 terms · 8 read by AI, not yet verified · 1 unclear · 8 not established" — a tier's contents. */
  function sectionLine(section) {
    var s = section || {}, c = s.counts || {};
    return countsLine({ total: s.total || 0, verified: c.verified, read: c.read, unclear: c.unclear,
                        contested: c.contested, missing: c.missing });
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
   * The header of MainStreet's Record: readiness per LEASEHOLD, never a count
   * of every possible term — e.g. "4 leaseholds · 1 with contested terms · 2
   * with terms not established · 1 with unclear terms" — and then the
   * documents nobody has matched yet, so they are not a second queue found
   * only further down. '' when there is nothing to say.
   *   opts.documents = { unmatched, untyped }
   */
  function summaryLine(matrix, opts) {
    var ls = ((matrix || {}).leaseholds) || [];
    var docs = (opts && opts.documents) || {};
    var n = function (kind) { return ls.filter(function (e) { return e.status && e.status.kind === kind; }).length; };
    var parts = [];
    if (ls.length) {
      parts.push(ls.length + (ls.length === 1 ? ' leasehold' : ' leaseholds'));
      var issues = n('issues'), missing = n('missing'), unclear = n('unclear'), unverified = n('unverified'), verified = n('verified');
      if (issues)     parts.push(issues + ' with contested terms');
      if (missing)    parts.push(missing + ' with terms not established');
      if (unclear)    parts.push(unclear + ' with unclear terms');
      if (unverified) parts.push(unverified + ' not yet verified');
      if (verified)   parts.push(verified + ' with key terms verified by a person');
    }
    parts = parts.concat(documentsLine(docs));
    return parts.join(' · ');
  }

  /** The documents a person still has to match, type or confirm, in words; [] when none. */
  function documentsLine(docs) {
    var d = docs || {}, out = [];
    if (d.unmatched) out.push(d.unmatched + (d.unmatched === 1 ? ' document' : ' documents') + ' not yet matched to a tenant');
    if (d.untyped)   out.push(d.untyped + (d.untyped === 1 ? ' document' : ' documents') + ' of unknown type');
    if (d.unconfirmed) out.push(d.unconfirmed + (d.unconfirmed === 1 ? ' document' : ' documents') + ' filed by AI, not yet confirmed');
    return out;
  }

  // ── The acquisition matrix: the buyer's own thirteen columns ──────────────
  //
  // Exactly the columns, and the order, of the buyer's hand-built acquisition
  // matrix. One field per column; every cell is the same resolved term the
  // summary matrix and the record read (cellFor), so no column has a state of
  // its own. What a cell adds is how it is WRITTEN (dates as M/D/YYYY, a
  // monthly rent worked out from the annual and labelled so, a stated "None")
  // and, for the detail view, WHERE it came from: the governing document, its
  // clause, and every earlier reading (F3 — the newest document governs; the
  // readings it replaced stay open to inspection).
  var MATRIX13 = [
    { key: 'tenant',      header: 'Tenant',            field: 'tenant_name' },
    { key: 'lease_exp',   header: 'Lease Exp.',        field: 'end_date' },
    { key: 'sqft',        header: 'Sq. Ft.',           field: 'leased_sqft' },
    { key: 'base_rent',   header: 'Base Rent',         field: 'base_rent' },
    { key: 'rent_inc',    header: 'Rent Inc.',         field: 'rent_escalations' },
    { key: 'cam',         header: 'CAM',               field: 'cam_recovery' },
    { key: 'taxes',       header: 'Taxes',             field: 'tax_recovery' },
    { key: 'ins',         header: 'Ins.',              field: 'insurance_recovery' },
    { key: 'pct_rent',    header: '% Rent',            field: 'percentage_rent' },
    { key: 'options',     header: 'Options',           field: 'renewal_options' },
    { key: 'exclusive',   header: 'Exclusive',         field: 'exclusive_use' },
    { key: 'co_ten',      header: 'Co-Ten',            field: 'co_tenancy' },
    { key: 'termination', header: 'Termination Right', field: 'termination_rights' },
  ];
  var NONE_STATED = 'None (stated)';

  /** "2034-02-28" → "2/28/2034"; anything else unchanged. */
  function usDate(v) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v == null ? '' : v));
    return m ? (Number(m[2]) + '/' + Number(m[3]) + '/' + m[1]) : (v == null ? null : String(v));
  }
  function _money(n) {
    var r = Math.round(n * 100) / 100;
    return '$' + r.toLocaleString('en-US', { minimumFractionDigits: r % 1 ? 2 : 0, maximumFractionDigits: 2 });
  }

  // A reading's value in its field's type, as the cell writes it: money as
  // dollars, a percentage with %, a date M/D/YYYY, a count with separators,
  // text as it stands. The stored value is never changed — this is display.
  function readingText(value, type) {
    if (value === null || value === undefined || value === '') return '—';
    if (type === 'date') return usDate(value);
    return formatValue(value, type);
  }

  // The reading of the governing document, out of the term's own history.
  function _governingReading(term) {
    var t = term || {};
    var h = _arr(t.history).filter(function (x) { return x.documentId && x.documentId === t.governingDocumentId; })[0];
    return h || null;
  }

  /**
   * One cell of the thirteen. `row` is the canonical row (its states decide
   * the cell's state, exactly as in the summary matrix); `term` is the
   * resolver's term for the same field (where it came from). Returns
   *   { column, header, field, label, state, value, text, sub, noneStated,
   *     stateText, source }
   * `text` is never blank: a term no document establishes is null here and
   * every renderer writes it as "Not established".
   */
  function matrix13Cell(row, column, term, opts) {
    var col = column || {};
    var c = cellFor(row, col.field, opts);
    var t = term || null;
    var out = { column: col.key, header: col.header, field: col.field, label: c.label,
                state: c.state, value: c.value, text: c.text, sub: null, noneStated: false,
                stateText: c.stateText, source: null };
    if (c.rejected) out.rejected = true;
    if (c.conflict) out.conflict = true;
    if (col.key === 'tenant') {
      out.text = (row && row.tenant_name) || 'Unnamed leasehold';
    } else if (c.state !== 'contested' && c.state !== 'missing' && c.value !== null) {
      if (c.type === 'date') out.text = usDate(c.value);
      if (col.field === 'base_rent' && typeof c.value === 'number' && isFinite(c.value)) {
        out.sub = _money(c.value / 12) + '/mo (calc.)';
      }
      // "None (stated)": the document itself denies the provision — the value
      // None, its clause in hand, read or confirmed from a document. Never for
      // a silent document (that is Not established), never for an unclear
      // reading, never for a value a person typed with no document behind it.
      var quote = t ? t.quote : ((row && row.quotes) || {})[col.field];
      if (c.value === 'None' && quote && (c.state === 'read' || c.state === 'verified')) {
        out.noneStated = true; out.text = NONE_STATED;
      }
    }
    if (t) {
      var g = _governingReading(t);
      out.source = {
        documentId:   t.governingDocumentId || null,
        fileName:     t.governingDocumentName || null,
        docType:      t.governingDocType || null,
        docDate:      g ? (g.docDate || null) : null,
        docStatus:    t.governingDocStatus || null,
        quote:        t.quote || null,
        page:         t.page == null ? null : t.page,
        confidence:   t.confidence == null ? null : t.confidence,
        derived:      !!t.derived,
        support:      t.support || null,
        note:         t.note || null,
        decision:     t.decision || null,
        // Step C: the reading a person set aside, replaced, or entered a value
        // beside — kept, each in the field's type.
        rejectedReading: t.rejectedReading ? Object.assign({}, t.rejectedReading, { text: readingText(t.rejectedReading.value, c.type) }) : null,
        replacedReading: t.replacedReading ? Object.assign({}, t.replacedReading, { text: readingText(t.replacedReading.value, c.type) }) : null,
        documentReading: t.documentReading ? Object.assign({}, t.documentReading, { text: readingText(t.documentReading.value, c.type) }) : null,
        enteredConflict: !!t.enteredConflict,
        enteredKept: !!t.enteredKept,
        // Every reading the governing one replaced, newest-ranked first.
        prior: _arr(t.supersededValues).map(function (h) {
          return { documentId: h.documentId || null, fileName: h.fileName || null, docType: h.docType || null,
                   docDate: h.docDate || null, value: h.value, text: readingText(h.value, c.type),
                   quote: h.quote || null, page: h.page == null ? null : h.page };
        }),
        readings: contestedReadings(t).map(function (r) {
          r.text = readingText(r.value, c.type); return r;
        }),
      };
    }
    return out;
  }

  /**
   * The thirteen-column matrix: one row per leasehold, in the projection's
   * order, each with its thirteen cells. `termsByLeasehold` maps a leasehold
   * id to the resolver's terms for it (as resolveFamilyTerms returns them).
   * Raw rows nothing represents are counted, never shown as tenants.
   */
  function buildMatrix13(canonicalRows, termsByLeasehold, opts) {
    var rows = _arr(canonicalRows);
    var byId = termsByLeasehold || {};
    var leaseholds = rows.filter(function (r) { return r._source === 'leasehold'; }).map(function (r) {
      var id = r._leaseholdId || r.id || null;
      var terms = (id && byId[id]) || {};
      return {
        leaseholdId: id,
        tenant: r.tenant_name || 'Unnamed leasehold',
        cells: MATRIX13.map(function (col) { return matrix13Cell(r, col, terms[col.field] || null, opts); }),
      };
    });
    return { columns: MATRIX13.map(function (c) { return { key: c.key, header: c.header, field: c.field }; }),
             leaseholds: leaseholds,
             unfiled: rows.filter(function (r) { return r._source === 'unfiled'; }).length };
  }

  // ── CSV ───────────────────────────────────────────────────────────────────
  // UTF-8 with a byte-order mark, so a spreadsheet reads "—" and "§" as
  // written; every cell quoted where it must be; and a cell that a
  // spreadsheet would run as a formula (= + - @, or a leading tab or return)
  // is written as text. A lease clause is somebody else's document.
  var CSV_BOM = '\uFEFF';
  function csvCell(v) {
    var s = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function _csv(lines) { return CSV_BOM + lines.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n') + '\r\n'; }

  /** One cell as the matrix CSV writes it — never blank. */
  function csvText(cell) {
    var c = cell || {};
    if (c.column === 'tenant') return c.text;
    if (c.state === 'contested') return STATE_LABEL.contested;
    if (c.state === 'missing' || c.text === null || c.text === undefined) return STATE_LABEL.missing;
    if (c.rejected) return REJECTED_TEXT;
    if (c.state === 'unclear' && (c.value === null || c.value === undefined)) return STATE_LABEL.unclear;
    var t = c.text + (c.sub ? ' / ' + c.sub : '');
    return c.state === 'unclear' ? t + ' (unclear)' : t;
  }

  /** The buyer's thirteen headers, in the buyer's order, one row per leasehold. */
  function matrix13Csv(m13) {
    var m = m13 || { columns: MATRIX13, leaseholds: [] };
    var lines = [m.columns.map(function (c) { return c.header; })];
    _arr(m.leaseholds).forEach(function (l) { lines.push(l.cells.map(csvText)); });
    if (m.unfiled) {
      lines.push([]);
      lines.push(['Not included: ' + m.unfiled + (m.unfiled === 1 ? ' extracted entry' : ' extracted entries')
        + ' not matched to a tenant — as extracted, not reviewed.']);
    }
    return _csv(lines);
  }

  var PROVENANCE_HEADERS = ['Tenant', 'Column', 'Value', 'State', 'Governing document', 'Document type',
                            'Document date', 'Page', 'Confidence', 'Clause', 'Earlier readings', 'Decision',
                            'Previous value', 'Origin', 'Reason'];

  // Who the cell's value is owed to, in words.
  function _origin(c, s) {
    var d = s.decision || null;
    if (c.rejected) return REJECTED_TEXT;
    if (c.state === 'entered') {
      if (s.enteredConflict) return 'Entered by a person — a document now reads ' + ((s.documentReading && s.documentReading.text) || 'it differently');
      if (s.enteredKept) return 'Entered by a person — kept over a document\u2019s reading';
      return 'Entered by a person';
    }
    if (d && d.action === 'correct') return 'Corrected by a person';
    if (d && d.action === 'confirm') return 'Confirmed by a person';
    if (c.state === 'contested') return 'Contested — nothing chosen';
    if (c.state === 'missing') return '';
    return 'Read by AI';
  }
  // What the standing decision set aside: the reading it replaced, the reading
  // it rejected, or the reading an entered value was kept over.
  function _previous(s) {
    var r = s.replacedReading || s.rejectedReading || (s.enteredKept ? s.documentReading : null);
    if (!r) return '';
    return r.text + (r.documentName ? ' (' + r.documentName + (r.page != null ? ', p. ' + r.page : '') + ')' : '');
  }
  var ENTERED_PREFIX = 'Entered by a person. No document on file supports it.';
  function _reason(s) {
    var n = s.decision && s.decision.note;
    if (typeof n !== 'string') return '';
    var x = n.indexOf(ENTERED_PREFIX) === 0 ? n.slice(ENTERED_PREFIX.length).trim() : n.trim();
    if (x.indexOf('Reason:') === 0) x = x.slice(7).trim();
    return x;
  }
  /** Where every cell came from: one row per leasehold × column. */
  function matrix13ProvenanceCsv(m13) {
    var m = m13 || { leaseholds: [] };
    var lines = [PROVENANCE_HEADERS];
    _arr(m.leaseholds).forEach(function (l) {
      l.cells.forEach(function (c) {
        var s = c.source || {};
        var state = c.noneStated ? 'Stated in the document: none' : (STATE_LABEL[c.state] || c.state);
        lines.push([
          l.tenant, c.header, csvText(c), state,
          s.fileName || '', s.docType || '', s.docDate ? usDate(s.docDate) : (s.fileName ? 'Undated' : ''),
          s.page == null ? '' : s.page, s.confidence == null ? '' : s.confidence, s.quote || '',
          _arr(s.prior).map(function (p) {
            return (p.fileName || 'A document') + (p.docDate ? ' (' + usDate(p.docDate) + ')' : ' (undated)') + ': ' + (p.text || readingText(p.value));
          }).join(' | '),
          s.decision ? (s.decision.action + (s.decision.decidedAt ? ' ' + String(s.decision.decidedAt).slice(0, 10) : '')) : '',
          c.column === 'tenant' ? '' : _previous(s),
          c.column === 'tenant' ? '' : _origin(c, s),
          c.column === 'tenant' ? '' : _reason(s),
        ]);
      });
    });
    return _csv(lines);
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
    STATE_LABEL: STATE_LABEL,
    REJECTED_TEXT: REJECTED_TEXT,
    TERM_STATE_LABEL: TERM_STATE_LABEL,
    unverifiedFor: unverifiedFor,
    countsLine: countsLine,
    summaryCounts: summaryCounts,
    documentsLine: documentsLine,
    formatValue: formatValue,
    cellFor: cellFor,
    attentionFor: attentionFor,
    statusFor: statusFor,
    structureFor: structureFor,
    leaseholdEntry: leaseholdEntry,
    unfiledEntry: unfiledEntry,
    buildMatrix: buildMatrix,
    headline: headline,
    attentionSummary: attentionSummary,
    MATRIX13: MATRIX13,
    NONE_STATED: NONE_STATED,
    usDate: usDate,
    readingText: readingText,
    matrix13Cell: matrix13Cell,
    buildMatrix13: buildMatrix13,
    csvCell: csvCell,
    csvText: csvText,
    matrix13Csv: matrix13Csv,
    PROVENANCE_HEADERS: PROVENANCE_HEADERS,
    matrix13ProvenanceCsv: matrix13ProvenanceCsv,
  };
  if (root) root.AcquisitionLeaseMatrix = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

})(typeof window !== 'undefined' ? window : null);
