'use strict';
/**
 * acquisition-terms.js — the terms of a lease, as each document states them.
 *
 * Phase 1 of Acquisition Review (docs/ACQUISITION_REVIEW.md §4d), increment
 * P1-4. This file is P4-1: the field vocabulary and the shape of per-document
 * evidence. P4-2 adds the resolver on top of it.
 *
 * ONE VOCABULARY, NOT TWO
 *
 * The governing-term reasoner already exists —
 * LeaseIntelligence.reasonMultiDocumentLease — and its canonical thirteen
 * fields are the source of truth. Group A below reproduces those names EXACTLY.
 * Group B is five fields the lease extraction contract already returns and
 * nobody governs across a family. Group C is nine genuinely new fields, one
 * per acquisition category the roadmap committed to; they were named in the
 * approved plan rather than added quietly, and they are kept in full. Group D
 * is the five columns of the buyer's hand-built acquisition matrix that no
 * field held (Rent Inc., CAM, Taxes, Ins., % Rent) — free text, each a short
 * summary with the clause as its quote.
 *
 * MISSING IS NOT NONE
 *
 * A field with `value: null, quote: null` means THIS DOCUMENT DOES NOT
 * ESTABLISH THE TERM. A document that says "Tenant shall have no option to
 * renew" establishes it — as a value, with the quote. `normalizeFieldValue`
 * never turns null into 0, false or "none"; the one coercion it makes is the
 * reverse, and only with a quote in hand: a recognised negative word offered
 * for a number field WITH the clause that says so becomes 0, because that is
 * what the document said.
 *
 * Pure: no DOM, no network, no globals. script.js's data layer applies it.
 */
(function (root) {

  // ── The fields ─────────────────────────────────────────────────────────────
  var FIELD_GROUPS = {
    // A — LeaseIntelligence.CANONICAL_FIELDS, verbatim. Do not rename.
    canonical: [
      'cap', 'cap_base_amount', 'admin_fee_pct', 'gross_up_pct', 'expense_stop',
      'audit_rights', 'pro_rata_method', 'renewal_options',
      'tenant_name', 'leased_sqft', 'start_date', 'end_date', 'lease_type',
    ],
    // B — in lease_extraction's schema today; never governed across a family.
    extracted: ['base_rent', 'security_deposit', 'suite', 'excluded_categories', 'admin_fee_basis'],
    // C — new, one per committed category: allowances, landlord work,
    // guaranties (×2), options (×2), obligations (×3). Keep all nine.
    acquisition: [
      'tenant_improvement_allowance', 'landlord_work',
      'guarantor_name', 'guaranty_limit',
      'termination_rights', 'expansion_rights',
      'assignment_consent', 'exclusive_use', 'co_tenancy',
    ],
    // D — the acquisition matrix's own columns (Rent Inc., CAM, Taxes, Ins.,
    // % Rent). Acquisition-only: they have no home on a workspace tenant.
    matrix: [
      'rent_escalations', 'cam_recovery', 'tax_recovery', 'insurance_recovery', 'percentage_rent',
    ],
  };
  var FIELDS = FIELD_GROUPS.canonical.concat(FIELD_GROUPS.extracted, FIELD_GROUPS.acquisition, FIELD_GROUPS.matrix);

  // What each field IS, which decides how a raw reading is normalised and how
  // a term is shown. `type` is one of number · money · percent · date ·
  // boolean · enum · text.
  var FIELD_META = {
    cap:                { label: 'CAM cap',                 type: 'percent', group: 'canonical' },
    cap_base_amount:    { label: 'Cap base amount',         type: 'money',   group: 'canonical' },
    admin_fee_pct:      { label: 'Admin fee %',             type: 'percent', group: 'canonical' },
    gross_up_pct:       { label: 'Gross-up %',              type: 'percent', group: 'canonical' },
    expense_stop:       { label: 'Expense stop',            type: 'money',   group: 'canonical' },
    audit_rights:       { label: 'Audit rights',            type: 'boolean', group: 'canonical' },
    pro_rata_method:    { label: 'Pro rata method',         type: 'enum',    group: 'canonical',
                          values: ['rentable', 'leasable', 'occupied', 'gross'] },
    renewal_options:    { label: 'Renewal options',         type: 'text',    group: 'canonical' },
    tenant_name:        { label: 'Tenant',                  type: 'text',    group: 'canonical' },
    leased_sqft:        { label: 'Leased sq ft',            type: 'number',  group: 'canonical' },
    start_date:         { label: 'Commencement',            type: 'date',    group: 'canonical' },
    end_date:           { label: 'Expiration',              type: 'date',    group: 'canonical' },
    lease_type:         { label: 'Lease type',              type: 'enum',    group: 'canonical',
                          values: ['NNN', 'Gross', 'Modified Gross'] },

    base_rent:          { label: 'Base rent',               type: 'money',   group: 'extracted' },
    security_deposit:   { label: 'Security deposit',        type: 'money',   group: 'extracted' },
    suite:              { label: 'Suite',                   type: 'text',    group: 'extracted' },
    excluded_categories:{ label: 'Excluded categories',     type: 'text',    group: 'extracted' },
    admin_fee_basis:    { label: 'Admin fee basis',         type: 'enum',    group: 'extracted',
                          values: ['operating_expenses', 'controllable_expenses', 'excluding_management_fee', 'unstated'] },

    tenant_improvement_allowance: { label: 'TI allowance',        type: 'money', group: 'acquisition' },
    landlord_work:      { label: "Landlord's work",         type: 'text',    group: 'acquisition' },
    guarantor_name:     { label: 'Guarantor',               type: 'text',    group: 'acquisition' },
    guaranty_limit:     { label: 'Guaranty limit',          type: 'money',   group: 'acquisition' },
    termination_rights: { label: 'Termination rights',      type: 'text',    group: 'acquisition' },
    expansion_rights:   { label: 'Expansion / ROFR',        type: 'text',    group: 'acquisition' },
    assignment_consent: { label: 'Assignment consent',      type: 'text',    group: 'acquisition' },
    exclusive_use:      { label: 'Exclusive use',           type: 'text',    group: 'acquisition' },
    co_tenancy:         { label: 'Co-tenancy',              type: 'text',    group: 'acquisition' },

    // `figures`: every dollar amount and percentage in the value must be in
    // the quote, or the value is not what the clause states (evidenceSupport).
    // `none`: the document may establish that the provision does not exist —
    // the value "None", with the denying clause as its quote. Never for a
    // term the document is silent on.
    // `quoteMax`: rent_escalations quotes the WHOLE schedule, so every step
    // shown has its clause; one 600-character excerpt would not.
    rent_escalations:   { label: 'Rent increases',          type: 'text',    group: 'matrix', figures: true, none: true, quoteMax: 2400 },
    cam_recovery:       { label: 'CAM recovery',            type: 'text',    group: 'matrix', figures: true, none: true },
    tax_recovery:       { label: 'Tax recovery',            type: 'text',    group: 'matrix', figures: true, none: true },
    insurance_recovery: { label: 'Insurance recovery',      type: 'text',    group: 'matrix', figures: true, none: true },
    percentage_rent:    { label: 'Percentage rent',         type: 'text',    group: 'matrix', figures: true, none: true },
  };

  var ABSTRACTION_STATUSES = ['pending', 'success', 'partial', 'failed', 'skipped'];

  // ── WHY a reading failed ───────────────────────────────────────────────────
  //
  // `failed` was written three different ways and told you nothing about which.
  // A live document came back `failed` with abstracted_fields {}, error_message
  // null and no other trace, while the server logs showed the call had actually
  // SUCCEEDED and the browser had aborted two seconds early. Diagnosing that
  // took the server's logs; the row should have said it.
  //
  // These six are the whole vocabulary, and migration 027 stores the chosen one
  // in its own column. `abstraction_status` is NOT widened — a reason is a
  // reason, not a sixth status, and `error_message` belongs to the parsing
  // stage and is not borrowed for this.
  var ABSTRACTION_ERRORS = [
    'no_text',           // there was no usable text on the row to read
    'transport',         // the request never completed: aborted, or the network went
    'upstream_timeout',  // the server reached Claude and Claude did not answer in time
    'upstream_error',    // the server reached Claude and Claude answered with an error
    'unparsable',        // an answer came back and it was not JSON we could read
    'no_fields',         // valid JSON, but it carried no `fields` object
  ];

  /**
   * Which of the six a thrown request failure is.
   *
   * Pure, and deliberately separate from the call site: the call site has the
   * error object, this has the vocabulary, and a test can exercise every branch
   * without a browser or a network. Anything unrecognised is `transport` — the
   * honest answer for "the request did not come back and we cannot say more",
   * never a guess at a more specific cause.
   */
  function abstractionErrorFor(e) {
    if (!e) return 'transport';
    if (ABSTRACTION_ERRORS.indexOf(e.reason) >= 0) return e.reason;
    if (e.name === 'AbortError' || e.name === 'TimeoutError') return 'transport';
    if (e.upstreamTimeout === true || e.status === 504) return 'upstream_timeout';
    if (typeof e.status === 'number') return 'upstream_error';
    return 'transport';
  }
  var EVIDENCE_SCHEMA_VERSION = 1;
  var QUOTE_MAX = 600;
  var TEXT_MAX  = 1000;
  /** A field's own quote allowance: QUOTE_MAX unless its meta says otherwise. */
  function quoteMaxFor(field) {
    var m = FIELD_META[field];
    return (m && m.quoteMax) || QUOTE_MAX;
  }
  // The one word a `none` field uses to say the document denies the provision.
  var NONE_VALUE = 'None';

  // ── Normalising one reading ────────────────────────────────────────────────
  function _str(v, max) {
    return (typeof v === 'string' && v.trim()) ? v.trim().slice(0, max) : null;
  }
  function _isNil(v) { return v === null || v === undefined || v === ''; }

  // "none" / "no" / "0" offered for a NUMBER field. With a quote in hand this
  // is the document saying there is none, which is a value of zero. Without
  // one it is a guess, and a guess is null.
  var NEGATIVE_WORDS = ['none', 'no', 'nil', 'zero', '0', 'n/a'];
  function _isNegativeWord(v) {
    return typeof v === 'string' && NEGATIVE_WORDS.indexOf(v.trim().toLowerCase()) >= 0;
  }

  function _number(v, hasQuote) {
    if (_isNil(v) || typeof v === 'boolean') return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    if (_isNegativeWord(v)) return hasQuote ? 0 : null;
    var s = String(v).replace(/[$,%\s]/g, '').replace(/^\((.*)\)$/, '-$1');
    var n = Number(s);
    return isFinite(n) ? n : null;
  }
  function _date(v) {
    if (typeof v !== 'string') return null;
    var s = v.trim().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    var d = new Date(s + 'T00:00:00Z');
    return isNaN(d.getTime()) ? null : s;
  }
  // A boolean is true, false, or not stated. "none", "waived", "silent" are
  // not booleans — a model that answers a yes/no question with a word other
  // than yes or no has not answered it, and an unanswered question is null.
  function _boolean(v) {
    if (typeof v === 'boolean') return v;
    if (typeof v === 'string') {
      var s = v.trim().toLowerCase();
      if (['true', 'yes', 'y'].indexOf(s) >= 0) return true;
      if (['false', 'no', 'n'].indexOf(s) >= 0) return false;
    }
    return null;
  }
  function _enum(v, values) {
    if (typeof v !== 'string') return null;
    var s = v.trim();
    for (var i = 0; i < values.length; i++) {
      if (values[i].toLowerCase() === s.toLowerCase()) return values[i];
    }
    return null;
  }

  /**
   * One field's value, as its type allows. Returns null for anything the type
   * cannot honestly hold — an out-of-list enum, a malformed date, a number
   * that is not one. The quote is kept regardless; a quote with no value is
   * how "the document has language here that could not be read" is recorded,
   * and P4-2 calls that `unclear` rather than dropping it.
   */
  function normalizeFieldValue(field, raw, hasQuote) {
    var meta = FIELD_META[field];
    if (!meta) return null;
    switch (meta.type) {
      case 'number': case 'money': case 'percent': return _number(raw, !!hasQuote);
      case 'date':    return _date(raw);
      case 'boolean': return _boolean(raw);
      case 'enum':    return _enum(raw, meta.values);
      case 'text':
        if (_isNil(raw)) return null;
        // "None" is a finding only with the clause that denies it in hand;
        // without one it is a guess, and a guess is null — never "None".
        if (meta.none && _isNegativeWord(String(raw).replace(/[.\s]+$/, ''))) return hasQuote ? NONE_VALUE : null;
        return _str(String(raw), TEXT_MAX);
      default:        return null;
    }
  }

  function _page(v) {
    if (_isNil(v) || typeof v === 'boolean') return null;
    var n = Number(v);
    return (Number.isInteger(n) && n > 0) ? n : null;
  }
  function _confidence(v) {
    if (_isNil(v) || typeof v === 'boolean') return null;
    var n = Number(v);
    return (isFinite(n) && n >= 0 && n <= 1) ? n : null;
  }

  /** One field's evidence entry, from whatever the model offered for it. */
  function normalizeEntry(field, raw) {
    // An array is not a reading of one term — Number([5]) is 5, and that is
    // exactly the kind of accident that turns nothing into a value.
    var o = (raw && typeof raw === 'object') ? (Array.isArray(raw) ? { value: null } : raw) : { value: raw };
    var quote = _str(o.quote, quoteMaxFor(field));
    return {
      value:      normalizeFieldValue(field, o.value, !!quote),
      quote:      quote,
      page:       _page(o.page),
      confidence: _confidence(o.confidence),
    };
  }

  /**
   * The evidence for one document, in the shape acquisition_documents.
   * abstracted_fields holds.
   *
   * Every field in FIELDS appears, so "the task was asked and found nothing"
   * is recorded as { value: null, quote: null } and is distinguishable from a
   * field that was never asked about. Keys outside FIELDS are dropped — the
   * vocabulary is the module's, not the model's.
   *
   * Returns { ok, abstraction, status, error }. `status` is what the document
   * row should carry:
   *   failed   the reading was not something with fields in it
   *   partial  fields came back but not one carries a value WITH its quote
   *   success  at least one field has a value and the clause that supports it
   */
  function buildAbstraction(reading, opts) {
    var o = opts || {};
    var src = reading && typeof reading === 'object' ? reading : null;
    var rawFields = src && src.fields && typeof src.fields === 'object' && !Array.isArray(src.fields)
      ? src.fields : null;
    if (!rawFields) {
      return { ok: false, status: 'failed', abstraction: null,
               error: 'The reading carried no fields' };
    }

    var fields = {};
    var evidenced = 0, valued = 0;
    for (var i = 0; i < FIELDS.length; i++) {
      var f = FIELDS[i];
      var entry = normalizeEntry(f, rawFields[f]);
      fields[f] = entry;
      if (entry.value !== null) { valued++; if (entry.quote) evidenced++; }
    }

    var abstraction = {
      schemaVersion: EVIDENCE_SCHEMA_VERSION,
      model: _str(o.model, 120),
      at:    _str(o.at, 40) || new Date().toISOString(),
      fields: fields,
    };
    return {
      ok: true,
      status: evidenced > 0 ? 'success' : 'partial',
      abstraction: abstraction,
      counts: { fields: FIELDS.length, valued: valued, evidenced: evidenced,
                missing: FIELDS.length - valued },
    };
  }

  // ── Reading a document again for fields it was never asked about ────────
  //
  // MERGE-ONLY. A document read before group D existed carries 27 entries. A
  // second, full reading could change a value a person already confirmed —
  // and a confirmation does not record the value it confirmed, so the term
  // would read "Verified" on a value nobody saw. So a second reading adds
  // ONLY the keys the stored evidence lacks. A key that is present, even as
  // { value: null, quote: null }, was asked about and answered, and is never
  // touched; every existing entry is carried over as the very object it was.

  /** The fields of `fields` (default: group D) this evidence was never asked about. */
  function unreadFields(abstraction, fields) {
    var want = Array.isArray(fields) ? fields : FIELD_GROUPS.matrix;
    var f = abstraction && abstraction.fields && typeof abstraction.fields === 'object' ? abstraction.fields : null;
    if (!f) return [];
    return want.filter(function (k) { return FIELDS.indexOf(k) >= 0 && !Object.prototype.hasOwnProperty.call(f, k); });
  }

  /**
   * The stored evidence with a second reading's answers for the unread fields
   * added, and nothing else changed. Returns { ok, abstraction, added } or
   * { ok: false, error }. `added` is [] when there was nothing to add; the
   * abstraction is then the one passed in.
   */
  function mergeUnreadFields(existing, reading, opts) {
    var o = opts || {};
    if (!existing || typeof existing !== 'object' || !existing.fields || typeof existing.fields !== 'object') {
      return { ok: false, error: 'The document has no reading to add to' };
    }
    var want = unreadFields(existing, o.fields);
    if (!want.length) return { ok: true, abstraction: existing, added: [] };
    var built = buildAbstraction(reading, { model: o.model, at: o.at });
    if (!built.ok) return { ok: false, error: built.error };
    var fields = {};
    Object.keys(existing.fields).forEach(function (k) { fields[k] = existing.fields[k]; });
    want.forEach(function (k) { fields[k] = built.abstraction.fields[k]; });
    var out = {};
    Object.keys(existing).forEach(function (k) { out[k] = existing[k]; });
    out.fields = fields;
    // Who read these, and when — the original reading's model and time stay
    // the document's own.
    out.supplements = (Array.isArray(existing.supplements) ? existing.supplements : [])
      .concat([{ fields: want, model: built.abstraction.model, at: built.abstraction.at }]);
    return { ok: true, abstraction: out, added: want };
  }

  /** What a row's evidence amounts to, for a status chip. Never throws. */
  function summarizeAbstraction(abstraction) {
    var f = abstraction && abstraction.fields && typeof abstraction.fields === 'object'
      ? abstraction.fields : {};
    var out = { total: FIELDS.length, valued: 0, evidenced: 0, quoteOnly: 0, missing: 0 };
    for (var i = 0; i < FIELDS.length; i++) {
      var e = f[FIELDS[i]] || {};
      var hasV = e.value !== null && e.value !== undefined;
      var hasQ = !!e.quote;
      if (hasV) { out.valued++; if (hasQ) out.evidenced++; }
      else if (hasQ) out.quoteOnly++;
      else out.missing++;
    }
    return out;
  }

  /** Is this something a lease-family document can carry terms for? */
  function isAbstractable(docType) {
    return ['original_lease', 'amendment', 'renewal', 'extension', 'assignment',
            'guaranty', 'side_letter', 'snda', 'estoppel'].indexOf(docType) >= 0;
  }

  // ═══ P4-2 · the resolver ═══════════════════════════════════════════════════
  //
  // One family of classified, abstracted documents becomes ONE set of terms,
  // each carrying the document and clause behind it and each saying how
  // settled it is. The precedence decision is NOT made here: it is made by
  // LeaseIntelligence.reasonMultiDocumentLease, which already existed and
  // which this feeds. What is made here is everything that reasoner has no
  // opinion about — the five states, the classification ceiling, the human
  // decision overlay, and the difference between a term no document addresses
  // and a term a document denies.

  // ── The reasoner's vocabulary is four types; ours is nine ──────────────────
  //
  // LeaseIntelligence.DOC_TYPE_TIER knows original_lease · amendment ·
  // estoppel · side_letter. Our nine lease-family types already carry tiers in
  // acquisition-documents.js, and those tiers were chosen (P1-3) to match this
  // table exactly. So each of ours maps onto the reasoner type that SHARES ITS
  // TIER — a renewal ranks where an amendment ranks because P1-3 said it does.
  // A test asserts the two tables agree rather than trusting this comment.
  //
  // Mapping rather than extending DOC_TYPE_TIER is deliberate: the approved
  // plan allows exactly one change to lease-intelligence.js, the optional
  // field list, and widening its tier table would change the owner-operator
  // path for every existing lease.
  var REASONER_DOC_TYPE = {
    original_lease: 'original_lease',
    amendment:      'amendment',
    renewal:        'amendment',
    extension:      'amendment',
    assignment:     'amendment',
    guaranty:       'amendment',
    estoppel:       'estoppel',
    snda:           'estoppel',
    side_letter:    'side_letter',
  };

  // The columns a decisions list asks for. Everything 026 stores: a decision
  // is small, and the history is the feature.
  var DECISION_COLUMNS = [
    'id', 'review_id', 'family_id', 'field_key', 'action',
    'previous_value', 'new_value',
    'source_document_id', 'source_quote', 'source_page',
    'decided_by', 'decided_at', 'note', 'created_at',
  ];
  var DECISION_SELECT = DECISION_COLUMNS.join(', ');

  var TERM_STATES = ['verified', 'ai_extracted', 'conflicting', 'unclear', 'missing'];
  // How settled a state is, for applying a ceiling. `conflicting` and
  // `missing` are NOT points on this scale — they are different facts about
  // the documents, not weaker readings of one, and a ceiling never turns a
  // contradiction into agreement.
  var STATE_STRENGTH = { verified: 3, ai_extracted: 2, unclear: 1 };
  // THE ACTION VOCABULARY AND THE "WHICH DECISION STANDS" RULE live in
  // decision-standing.js (P5-3), so the Property Workspace applies the same
  // rule without loading this module or its reasoner. Dual-resolved like the
  // reasoner below; the page loads decision-standing.js before this file.
  var _DS = (root && root.DecisionStanding)
         || (typeof require === 'function' ? require('./decision-standing.js') : null);
  if (!_DS) throw new Error('acquisition-terms.js needs decision-standing.js loaded first');
  var DECISION_ACTIONS = _DS.DECISION_ACTIONS;
  // What an entered term says about itself, everywhere it is shown (§4l).
  var ENTERED_NOTE = 'Entered by a person. No document on file supports it.';

  // ── Does the quote actually say the value? ────────────────────────────────
  //
  // P4-1 shipped and a real lease immediately produced the case this exists
  // for: base_rent stored as 1202500 against the clause "Tenant agrees to pay
  // base rent of $18.50 per square foot annually." That is 65,000 × $18.50 —
  // defensible arithmetic, and NOT something the clause literally states. A
  // number the quote does not contain has not been read off the page; it has
  // been worked out. Both are useful and they are not the same claim, so the
  // value and its quote are both kept and the term is marked `unclear` rather
  // than presented as evidenced.
  //
  // LIMIT, stated rather than hidden: only numbers are checked this way. A
  // date ("commence on March 1, 2024" → 2024-03-01), an enum, a boolean and
  // free text cannot be compared to their clause by containment without
  // inventing a parser per type, and a false `derived` would be worse than no
  // check. For those types a quote is taken at its word.
  function _numeralsIn(text) {
    var s = String(text), out = [], re = /(\()?\s*-?\d[\d,]*(?:\.\d+)?\s*(\))?/g, m;
    while ((m = re.exec(s))) {
      var n = Number(m[0].replace(/[(),\s]/g, ''));
      if (!isFinite(n)) continue;
      out.push(n);
      // Accounting notation: "(500)" is -500, and `normalizeFieldValue` already
      // reads it that way, so the support check has to speak the same dialect
      // or every bracketed credit would read as derived.
      if (m[1] && m[2]) out.push(-n);
    }
    return out;
  }
  // "There shall be no cap on Operating Expenses" supports a value of 0 even
  // though the numeral 0 is nowhere in it. An explicit negative is the case
  // this whole feature refuses to lose, so it is recognised before the
  // numeral check can call it derived.
  var NEGATIVE_CLAUSE = /\b(?:no|none|not|nor|never|nil|zero|without|waives?|waived|excluded|shall\s+not|n\/a)\b/i;

  // The dollar amounts and percentages a summary states: "$102,000",
  // "3%", "4% of sales over $3,986,250". Years, suite numbers and counts are
  // not figures; a summary may carry them freely.
  function _figuresIn(text) {
    var s = String(text), out = [], re = /\$\s*(\d[\d,]*(?:\.\d+)?)|(\d[\d,]*(?:\.\d+)?)\s*%/g, m;
    while ((m = re.exec(s))) {
      var n = Number(String(m[1] || m[2]).replace(/,/g, ''));
      if (isFinite(n)) out.push(n);
    }
    return out;
  }
  // A free-text summary is what the clause states only when every figure in
  // it is in the clause, and a "None" only when the clause denies it. A step
  // the AI worked out (a monthly figure from an annual one, a share computed
  // from square feet) is DERIVED, which the resolver reads as unclear.
  function _textSupport(meta, e) {
    if (meta.none && e.value === NONE_VALUE) return NEGATIVE_CLAUSE.test(e.quote) ? 'stated' : 'derived';
    var inQuote = _numeralsIn(e.quote);
    return _figuresIn(e.value).every(function (n) { return inQuote.indexOf(n) >= 0; }) ? 'stated' : 'derived';
  }

  /**
   * How well one entry's quote supports its value.
   *   none     there is no quote
   *   stated   the quote says it
   *   derived  a number the quote does not contain — computed, or wrong
   */
  function evidenceSupport(field, entry) {
    var meta = FIELD_META[field];
    var e = entry || {};
    if (!e.quote) return 'none';
    if (e.value === null || e.value === undefined) return 'none';
    if (!meta) return 'none';
    if (meta.type === 'text' && meta.figures) return _textSupport(meta, e);
    if (meta.type !== 'number' && meta.type !== 'money' && meta.type !== 'percent') return 'stated';
    if (e.value === 0 && NEGATIVE_CLAUSE.test(e.quote)) return 'stated';
    return _numeralsIn(e.quote).indexOf(e.value) >= 0 ? 'stated' : 'derived';
  }

  // ── Which documents the reasoner is allowed to see ────────────────────────
  function _entryOf(doc, field) {
    var ev = doc && doc.abstracted_fields;
    var f  = ev && ev.fields;
    var e  = f && f[field];
    return (e && typeof e === 'object') ? e : null;
  }
  /** Current, lease-family, actually read. Anything else has nothing to say. */
  function _eligible(doc) {
    if (!doc) return false;
    if (doc.superseded_by_document_id) return false;          // D-14: replaced
    if (!isAbstractable(doc.doc_type)) return false;           // not a lease document
    if (doc.abstraction_status !== 'success' && doc.abstraction_status !== 'partial') return false;
    return !!(doc.abstracted_fields && doc.abstracted_fields.fields);
  }

  /**
   * The family's CURRENT documents, in the shape
   * LeaseIntelligence.reasonMultiDocumentLease already takes.
   *
   * `_docId` rides along so the caller can map an answer back to the row it
   * came from; the reasoner reads only docType, docDate, fileName,
   * extractedFields and quotes, and ignores the rest.
   */
  function buildReasonerInput(documents) {
    var docs = Array.isArray(documents) ? documents : [];
    var out = [];
    for (var i = 0; i < docs.length; i++) {
      var d = docs[i];
      if (!_eligible(d)) continue;
      var extracted = {}, quotes = {};
      for (var j = 0; j < FIELDS.length; j++) {
        var f = FIELDS[j], e = _entryOf(d, f);
        if (!e) continue;
        if (e.value !== null && e.value !== undefined && e.value !== '') extracted[f] = e.value;
        if (e.quote) quotes[f] = e.quote;
      }
      out.push({
        docType:         REASONER_DOC_TYPE[d.doc_type] || 'original_lease',
        docDate:         d.doc_date || null,
        fileName:        d.file_name || null,
        extractedFields: extracted,
        quotes:          quotes,
        _docId:          d.id,
      });
    }
    return out;
  }

  // The reasoner's own precedence order, reproduced so a term can name the
  // DOCUMENT that governs it. The reasoner returns the governing docType but
  // not which document it was, and the ceiling needs that document's
  // classification status. `resolveTerms` cross-checks its answer against the
  // reasoner's rather than trusting this to stay in step.
  function _reasonerOrder(inputs, tierOf) {
    return inputs.slice().sort(function (a, b) {
      var td = (tierOf(b.docType) || 0) - (tierOf(a.docType) || 0);
      if (td !== 0) return td;
      var da = a.docDate ? new Date(a.docDate).getTime() : 0;
      var db = b.docDate ? new Date(b.docDate).getTime() : 0;
      return db - da;
    });
  }
  // lease-intelligence.js keeps DOC_TYPE_TIER private, so this is a copy, and a
  // copy is a thing that drifts. `test-acquisition-resolver.js` reads the real
  // table out of that file and asserts the two are identical, which is the same
  // guard P1-3 put on the document tiers.
  var DEFAULT_TIER = { side_letter: 4, estoppel: 3, amendment: 2, original_lease: 1 };

  // ── Which disagreements are contradictions (F2 / F4) ──────────────────────
  //
  // The shared reasoner (lease-intelligence.js, also the owner-side lease
  // reasoner) calls ANY two same-rank documents with byte-different values a
  // contradiction — in every rank, dated or not. For an acquisition that is
  // too eager: an amendment chain is the deal changing, not the documents
  // disagreeing, and two wordings of one clause are not a dispute. The
  // reasoner is left as it is; the acquisition side keeps only what is a real
  // contradiction for the term a person reads:
  //
  //   · in the GOVERNING rank — a lower rank is superseded whatever it says;
  //   · between documents their dates cannot order — the same date, or one of
  //     them undated (F4: an undated document is NOT presumed the oldest; if
  //     it disagrees, nothing is chosen);
  //   · whose values still differ once case and whitespace are set aside.
  //
  // When dates do order two documents of one rank, the newer governs, and the
  // older reading stays in the history, open to inspection.
  function _sameReading(a, b) {
    var n = function (v) { return String(v).trim().toLowerCase().replace(/\s+/g, ' '); };
    return n(a) === n(b);
  }
  function _dateKey(d) {
    if (!d) return null;
    var t = new Date(d).getTime();
    return isNaN(t) ? null : t;
  }
  function acquisitionContradictions(valued, tierOfDocType) {
    var v = Array.isArray(valued) ? valued : [];
    if (v.length < 2) return [];
    var tierOf = typeof tierOfDocType === 'function' ? tierOfDocType : function (t) { return DEFAULT_TIER[t] || 0; };
    var rank = function (h) { return tierOf(REASONER_DOC_TYPE[h.docType] || 'original_lease'); };
    var gov = v[0], tier = rank(gov), gd = _dateKey(gov.docDate);
    var peers = [gov].concat(v.slice(1).filter(function (h) {
      if (rank(h) !== tier) return false;
      var hd = _dateKey(h.docDate);
      return gd === null || hd === null || hd === gd;   // the dates cannot order them
    }));
    var values = [];
    peers.forEach(function (h) {
      if (!values.some(function (x) { return _sameReading(x, h.value); })) values.push(h.value);
    });
    if (values.length < 2) return [];
    return [{ tier: tier, documents: peers.map(function (h) { return h.fileName; }),
              documentIds: peers.map(function (h) { return h.documentId; }), values: values }];
  }

  // ── The human decisions overlay ───────────────────────────────────────────
  /** The decision in force for a field: the latest one, unless it reopened. */
  // The rule itself is DecisionStanding.standing (decision-standing.js); this
  // name stays as the public API every caller and test already uses.
  function latestDecision(decisions, field) {
    return _DS.standing(decisions, field);
  }

  // ── The ceiling: a term is never more settled than its document ───────────
  /**
   * The strongest state this term may reach, given the classification of the
   * document that governs it, and whether a person may act on it at all.
   */
  function classificationCeiling(governingDoc, hasQuote) {
    var st = governingDoc && governingDoc.doc_type_status;
    if (st === 'confirmed' || st === 'corrected') {
      return hasQuote
        ? { ceiling: 'verified', canConfirm: true, reason: null }
        : { ceiling: 'unclear',  canConfirm: true,
            reason: 'The governing document is confirmed, but this term has no supporting clause.' };
    }
    return {
      ceiling: 'ai_extracted',
      canConfirm: false,
      reason: 'The document this term comes from is ' + (st === 'proposed' ? 'a proposal' : 'unclassified')
            + '. Confirm or correct the document type first.',
    };
  }

  function _capState(state, ceiling) {
    // A contradiction and an absence are facts about the documents, not weak
    // readings — a ceiling has nothing to say about either.
    if (state === 'conflicting' || state === 'missing') return state;
    var s = STATE_STRENGTH[state] || 0, c = STATE_STRENGTH[ceiling] || 0;
    return s <= c ? state : ceiling;
  }

  function _emptyTerm(field) {
    var meta = FIELD_META[field] || {};
    return {
      field: field, label: meta.label || field, group: meta.group || null, type: meta.type || null,
      state: 'missing', value: null, quote: null, page: null, confidence: null,
      support: 'none', derived: false,
      governingDocumentId: null, governingDocumentName: null,
      governingDocType: null, governingDocStatus: null,
      supersededValues: [], contradictions: [], history: [],
      ceiling: null, ceilingReason: null, canConfirm: false,
      blockedReason: null, decision: null, reasoning: null,
      reasonerConfidence: null, lineageMismatch: false,
      note: 'No current document on file establishes this term.',
    };
  }

  /**
   * The family's terms, one per field, from the reasoner's answer plus
   * everything the reasoner has no opinion about.
   *
   *   reasonerResult  what LeaseIntelligence.reasonMultiDocumentLease returned
   *   documents       the same rows buildReasonerInput was given
   *   decisions       acquisition_term_decisions rows (P4-3; [] until then)
   *
   * Every one of the 27 fields comes back. A field no current document
   * establishes is `missing` and says so in words — never zero, never blank,
   * never omitted.
   */
  function resolveTerms(reasonerResult, documents, decisions, opts) {
    var res    = (reasonerResult && typeof reasonerResult === 'object') ? reasonerResult : {};
    var o      = opts || {};
    var tierOf = typeof o.tierOf === 'function' ? o.tierOf : function (t) { return DEFAULT_TIER[t] || 0; };
    var inputs = buildReasonerInput(documents);
    var ordered = _reasonerOrder(inputs, tierOf);
    var byId = {};
    (Array.isArray(documents) ? documents : []).forEach(function (d) { if (d && d.id) byId[d.id] = d; });

    var terms = {};
    for (var i = 0; i < FIELDS.length; i++) {
      var field = FIELDS[i];
      var term  = _emptyTerm(field);

      // Who says anything at all about this term, strongest first.
      var history = [];
      for (var k = 0; k < ordered.length; k++) {
        var inp = ordered[k];
        var raw = byId[inp._docId];
        var e   = _entryOf(raw, field);
        if (!e) continue;
        var hasValue = e.value !== null && e.value !== undefined && e.value !== '';
        if (!hasValue && !e.quote) continue;
        history.push({
          documentId: inp._docId,
          fileName:   inp.fileName,
          docType:    raw ? raw.doc_type : null,
          docDate:    inp.docDate,
          docStatus:  raw ? raw.doc_type_status : null,
          value:      hasValue ? e.value : null,
          quote:      e.quote || null,
          page:       e.page == null ? null : e.page,
          confidence: e.confidence == null ? null : e.confidence,
          support:    evidenceSupport(field, e),
        });
      }
      term.history = history;

      var valued = history.filter(function (h) { return h.value !== null; });
      var fromReasoner = Object.prototype.hasOwnProperty.call(res, field) ? res[field] : null;

      if (!valued.length) {
        // Nothing has a value. Either no document mentions it at all, or one
        // has language here that could not be read — which is `unclear`, and
        // is NOT the same as the documents being silent.
        if (history.length) {
          var q = history[0];
          term.state = 'unclear';
          term.quote = q.quote; term.page = q.page; term.confidence = q.confidence;
          term.governingDocumentId = q.documentId; term.governingDocumentName = q.fileName;
          term.governingDocType = q.docType; term.governingDocStatus = q.docStatus;
          term.support = 'none';
          term.note = 'A document has language here, but no value could be read from it.';
          var capQ = classificationCeiling(byId[q.documentId], !!q.quote);
          term.ceiling = capQ.ceiling; term.ceilingReason = capQ.reason;
          term.canConfirm = capQ.canConfirm; term.blockedReason = capQ.canConfirm ? null : capQ.reason;
        }
        terms[field] = _applyDecision(term, decisions, byId);
        continue;
      }

      var governing = valued[0];
      var superseded = valued.slice(1);

      term.value = governing.value;
      term.quote = governing.quote;
      term.page  = governing.page;
      term.confidence = governing.confidence;
      term.support = governing.support;
      term.derived = governing.support === 'derived';
      term.governingDocumentId   = governing.documentId;
      term.governingDocumentName = governing.fileName;
      term.governingDocType      = governing.docType;
      term.governingDocStatus    = governing.docStatus;
      term.supersededValues = superseded;
      term.note = null;

      if (fromReasoner) {
        // Narrowed from the reasoner's, never widened: a disagreement the
        // reasoner did not see is not invented here.
        term.contradictions     = (Array.isArray(fromReasoner.contradictions) && fromReasoner.contradictions.length)
          ? acquisitionContradictions(valued, tierOf) : [];
        term.reasoning          = fromReasoner.reasoning || null;
        term.reasonerConfidence = fromReasoner.confidence == null ? null : fromReasoner.confidence;
        // The reasoner decides precedence; the lineage above only names the
        // document that carries the answer. If the two disagree, something is
        // wrong and the term says so rather than quietly picking one.
        if (String(fromReasoner.currentValue) !== String(governing.value)) term.lineageMismatch = true;
      } else {
        // The field was not in the reasoner's answer although a document has a
        // value for it — it was not in the field list the reasoner was given.
        term.lineageMismatch = true;
      }

      if (term.contradictions.length)        term.state = 'conflicting';
      else if (governing.support !== 'stated') term.state = 'unclear';
      else                                     term.state = 'ai_extracted';

      if (term.derived) {
        term.note = 'This figure is not stated in the clause behind it. The clause gives a rate or a component; the value was worked out from it.';
      } else if (term.state === 'unclear' && term.support === 'none') {
        term.note = 'A value with no supporting clause.';
      }

      var cap = classificationCeiling(byId[governing.documentId], !!governing.quote);
      term.ceiling = cap.ceiling; term.ceilingReason = cap.reason;
      term.canConfirm = cap.canConfirm;
      term.blockedReason = cap.canConfirm ? null : cap.reason;
      term.state = _capState(term.state, cap.ceiling);

      terms[field] = _applyDecision(term, decisions, byId);
    }
    return terms;
  }

  // ── What a person decided, laid over the documents (Step C) ───────────────
  //
  // An ENTERED value is a correction that cites no document and carries the
  // entered note: the person supplied the value. Every other correction cites
  // the document whose reading it replaced. (On the Pilot, every correction
  // with no source document carries the entered note, and every other cites
  // one.)
  function isEnteredDecision(d) {
    return !!d && d.action === 'correct' && !d.source_document_id && !d.source_quote
      && typeof d.note === 'string' && d.note.indexOf(ENTERED_NOTE) === 0;
  }

  // Two values the field holds the same, each in the field's own form.
  function _sameValue(field, a, b) {
    var x = normalizeFieldValue(field, a, true), y = normalizeFieldValue(field, b, true);
    if (x === null || x === undefined || y === null || y === undefined) return false;
    return JSON.stringify(x) === JSON.stringify(y);
  }

  // What the documents say for a term before a decision is laid over it — the
  // reading a rejection sets aside, a correction replaces, or an entered value
  // stands beside. Kept whole, as evidence; never the term's value again.
  function _reading(term) {
    if ((term.value === null || term.value === undefined) && !term.quote) return null;
    return {
      value: term.value === undefined ? null : term.value,
      quote: term.quote || null,
      page: term.page == null ? null : term.page,
      confidence: term.confidence == null ? null : term.confidence,
      documentId: term.governingDocumentId || null,
      documentName: term.governingDocumentName || null,
      docType: term.governingDocType || null,
      support: term.support || null,
      derived: !!term.derived,
      state: term.state || null,
    };
  }

  // A stored decision whose value this term's type cannot hold (written before
  // the payload builder refused one). It is not applied: the documents'
  // reading stands, and the term says why — never "verified" with no value.
  function _unreadable(term) {
    term.decisionUnreadable = true;
    if (term.decision) term.decision.unreadable = true;
    term.note = 'A decision was recorded with a value this term cannot hold, so it is not used.'
      + (term.note ? ' ' + term.note : '');
    return term;
  }

  /** A person's decision, laid over what the documents said. */
  function _applyDecision(term, decisions, byId) {
    var d = latestDecision(decisions, term.field);
    if (!d) return term;
    term.decision = {
      id: d.id || null,
      action: d.action, decidedBy: d.decided_by || null, decidedAt: d.decided_at || null,
      note: d.note || null, previousValue: d.previous_value == null ? null : d.previous_value,
      sourceDocumentId: d.source_document_id || null,
    };

    // AN ENTERED VALUE (§4l). A person supplied the value themselves; it is
    // the canonical value — verified, because a person vouched for it — and it
    // carries `support: 'entered'` so that no consumer can present it as
    // something a document says. There is no governing document and no quote,
    // so there is no ceiling to cap it.
    //
    // A document may LATER speak to the term (a re-read, a new amendment). The
    // entered value still stands and is still marked entered: a reading never
    // overwrites what a person entered. What the document now says is kept
    // beside it (`documentReading`), and when it differs the term carries a
    // warning (`enteredConflict`) until the person decides — reopen the term to
    // take the document's reading, or keep their value. "Keep" is itself an
    // entered decision whose previous_value is the reading it was kept over;
    // a later reading that differs again raises the warning again.
    // (A sourceless correction on a term no document establishes is an entry
    // too, as it always was, whatever its note.)
    if (isEnteredDecision(d) || (d.action === 'correct' && term.state === 'missing' && !d.source_document_id)) {
      var entered = personValue(term.field, d.new_value).value;
      if (entered === null || entered === undefined) return _unreadable(term);
      var doc = term.state === 'missing' ? null : _reading(term);
      var docContested = term.state === 'conflicting';
      if (doc) {
        doc.contested = docContested;
        doc.superseded = term.supersededValues || [];
        doc.contradictions = term.contradictions || [];
      }
      term.value   = entered;
      term.quote   = null; term.page = null; term.confidence = null;
      term.support = 'entered';
      term.derived = false;
      term.governingDocumentId = null; term.governingDocumentName = null;
      term.governingDocType = null;    term.governingDocStatus = null;
      term.supersededValues = []; term.contradictions = [];
      term.ceiling = null; term.ceilingReason = null;
      term.canConfirm = true; term.blockedReason = null;
      term.state = 'verified';
      term.note  = ENTERED_NOTE;
      term.documentReading = doc;
      term.enteredConflict = false;
      term.enteredKept = false;
      if (doc) {
        var differs = docContested || (doc.value !== null && !_sameValue(term.field, doc.value, entered));
        var kept = differs && !docContested && d.previous_value != null && _sameValue(term.field, d.previous_value, doc.value);
        term.enteredConflict = differs && !kept;
        term.enteredKept = kept;
        term.note = term.enteredConflict ? ENTERED_NOTE + ' A document now reads this term differently; the entered value stands until a person decides.'
                  : kept                 ? ENTERED_NOTE + ' Kept by a person over what a document now reads.'
                  : doc.value === null   ? ENTERED_NOTE + ' A document now has language here, but no value could be read from it.'
                  :                        ENTERED_NOTE + ' A document now states the same value.';
      }
      return term;
    }

    if (d.action === 'reject') {
      // The person says the reading is wrong. The reading is KEPT — value,
      // clause, page, document — as `rejectedReading`, and it is no longer
      // the term's value: nothing downstream (the matrix, the rent roll, the
      // analysis, conversion, the CSVs, the report) can use it. The governing
      // document stays named, so Confirm can still take the reading back.
      term.rejected = true;
      term.rejectedReading = _reading(term);
      term.value = null; term.quote = null; term.page = null; term.confidence = null;
      term.derived = false; term.support = 'none';
      term.state = 'unclear';
      term.note = 'Rejected by a person. The reading is kept as evidence and is not used as the value.';
      return term;
    }

    if (d.action === 'correct') {
      // A correction cites the document whose reading it replaces. The new
      // value carries only a clause the correction itself cites: the replaced
      // reading's clause states a different figure, so it is kept and named as
      // `replacedReading`, never shown as the new value's support.
      var quote = _str(d.source_quote, QUOTE_MAX);
      // A correction that quotes the very clause it replaces cites the
      // reading it corrects; that clause states the old value and is no
      // support for the new one. The value is the person's.
      if (quote && term.quote && quote === _str(term.quote, QUOTE_MAX)) quote = null;
      var corrected = quote ? normalizeFieldValue(term.field, d.new_value, true) : personValue(term.field, d.new_value).value;
      if (corrected === null || corrected === undefined) return _unreadable(term);
      term.replacedReading = _reading(term);
      term.value = corrected;
      term.quote = quote || null;
      term.page  = quote ? _page(d.source_page) : null;
      term.confidence = null;
      term.support = 'stated';
      term.derived = false;
      if (d.source_document_id && byId[d.source_document_id]) {
        term.governingDocumentId   = d.source_document_id;
        term.governingDocumentName = byId[d.source_document_id].file_name || null;
        term.governingDocType      = byId[d.source_document_id].doc_type || null;
        term.governingDocStatus    = byId[d.source_document_id].doc_type_status || null;
      }
      term.note = 'Corrected by a person.';
    } else {
      term.note = 'Confirmed by a person.';
    }

    // A person's yes does not outrank the ceiling. Confirming a term whose
    // document is still a proposal cannot make it verified, and the term says
    // why instead of quietly presenting a weaker state as though nobody had
    // acted.
    if (term.ceiling === 'verified') {
      term.state = 'verified';
    } else {
      term.state = _capState('verified', term.ceiling || 'ai_extracted');
      term.note = (term.note || '') + ' It cannot read as verified yet: ' + (term.ceilingReason || term.blockedReason || '');
    }
    return term;
  }

  /**
   * The whole job, for one family: build the input, ask the reasoner that
   * already exists, and resolve. `opts.reasoner` is the reasoner to use;
   * window.LeaseIntelligence by default.
   */
  function resolveFamilyTerms(documents, decisions, opts) {
    var o = opts || {};
    var LI = o.reasoner || (root && root.LeaseIntelligence) || null;
    if (!LI || typeof LI.reasonMultiDocumentLease !== 'function') {
      return { ok: false, error: 'LeaseIntelligence.reasonMultiDocumentLease is not available', terms: null, input: [] };
    }
    var input = buildReasonerInput(documents);
    var res   = LI.reasonMultiDocumentLease(input, { fields: FIELDS });
    var terms = resolveTerms(res, documents, decisions, {
      tierOf: function (t) { return (LI.DOC_TYPE_TIER || DEFAULT_TIER)[t] || 0; },
    });
    return { ok: true, terms: terms, input: input, reasonerResult: res, summary: summarizeTerms(terms) };
  }

  // ── Writing a decision (P4-3) ─────────────────────────────────────────────
  //
  // The mirror of acquisition-documents.js buildPayload: camelCase in,
  // snake_case out, through an allow-list, with user_id from the session and
  // every unknown key dropped. Migration 026 enforces the same rules in the
  // database; refusing here too turns a constraint violation into a named
  // mistake at the call site, which is where it can be fixed.
  var DECISION_WRITABLE = {
    family_id:          function (v) { return _str(v, 64); },
    field_key:          function (v) { return _str(v, 120); },
    action:             function (v) { return DECISION_ACTIONS.indexOf(v) >= 0 ? v : null; },
    previous_value:     function (v) { return v == null ? null : _str(String(v), 4000); },
    new_value:          function (v) { return v == null ? null : _str(String(v), 4000); },
    source_document_id: function (v) { return _str(v, 64); },
    source_quote:       function (v) { return _str(v, QUOTE_MAX); },
    source_page:        _page,
    decided_by:         function (v) { return _str(v, 64); },
    decided_at:         function (v) { return _str(v, 40); },
    note:               function (v) { return _str(v, 2000); },
  };
  var DECISION_CAMEL = {
    familyId: 'family_id', fieldKey: 'field_key', action: 'action',
    previousValue: 'previous_value', newValue: 'new_value',
    sourceDocumentId: 'source_document_id', sourceQuote: 'source_quote', sourcePage: 'source_page',
    decidedBy: 'decided_by', decidedAt: 'decided_at', note: 'note',
  };

  /**
   * The row to write for one human act on one term.
   *
   * `term` is the RESOLVED term the person acted on. It supplies two things
   * nothing else can: the classification gate, and the value being replaced.
   *
   * THE GATE. Confirm and Correct are refused while the governing document is
   * `unclassified` or `proposed`. That is the approved rule, and it lives here
   * rather than only in the UI so that a disabled button is a courtesy rather
   * than the enforcement. Reject and Reopen are NOT gated: saying "this
   * reading is wrong" does not require having first agreed what the document
   * is.
   *
   * PREVIOUS VALUE. A correction records what it replaced. The caller may pass
   * one; when it does not, the term's current value is used, so a correction
   * can never silently lose the AI reading it overrode.
   */
  function buildDecisionPayload(reviewId, userId, fields, term) {
    var f = (fields && typeof fields === 'object') ? fields : {};
    if (!reviewId) return { ok: false, error: 'Missing reviewId' };
    if (!userId)   return { ok: false, error: 'Missing userId' };

    var payload = { review_id: reviewId, user_id: userId, decided_by: userId };
    for (var camel in DECISION_CAMEL) {
      if (!Object.prototype.hasOwnProperty.call(DECISION_CAMEL, camel)) continue;
      if (f[camel] === undefined) continue;
      payload[DECISION_CAMEL[camel]] = DECISION_WRITABLE[DECISION_CAMEL[camel]](f[camel]);
    }
    // The actor is the session's, never the caller's. 026's trigger refuses a
    // row whose decided_by is not its user_id; this makes that unreachable.
    payload.decided_by = userId;
    if (!payload.decided_at) payload.decided_at = new Date().toISOString();

    if (!payload.field_key) return { ok: false, error: 'fieldKey must be a non-empty string' };
    if (!payload.action)    return { ok: false, error: 'action must be one of ' + DECISION_ACTIONS.join(', ') };

    if (payload.action === 'correct' && !payload.new_value) {
      return { ok: false, error: 'A correction must carry the value it corrects to' };
    }
    // An optional reason, in the person's words. It is the decision's note —
    // after the entered note, for an entered value, so the row still says
    // what it is.
    var reason = _str(f.reason == null ? null : String(f.reason), 1000);

    // ENTERING a value (§4l): a correction on a term no document establishes,
    // asked for as such. It is the same row a correction writes — no
    // migration — with every source column forced empty, so the row can
    // never be read back as citing a document, and a note that says what it
    // is. `entered` itself is not a column; it is dropped with every other
    // key the allow-list does not name.
    if (payload.action === 'correct' && f.entered === true) {
      if (!term) return { ok: false, error: 'Entering a term needs the term it is entered for' };
      var keep = f.keep === true;
      if (keep) {
        // "Keep my value": an entered value a document now reads differently.
        // The same entered value again, with the reading it was kept over as
        // its previous value — so the warning clears for THAT reading only.
        if (term.support !== 'entered' || !term.enteredConflict || !term.documentReading
            || term.documentReading.value === null || term.documentReading.value === undefined) {
          return { ok: false, error: 'There is no document reading to keep this value over.' };
        }
      } else if (term.state !== 'missing') {
        return { ok: false, error: 'A document establishes this term. Correct the reading instead of entering a value.' };
      }
      var pv = personValue(payload.field_key, payload.new_value);
      if (pv.error) return { ok: false, error: personError(payload.field_key, pv.error, payload.new_value) };
      var typed = pv.value;
      if (keep && JSON.stringify(typed) !== JSON.stringify(term.value)) {
        return { ok: false, error: 'Keep records the value already entered; enter a different value by reopening the term.' };
      }
      payload.new_value = storedForm(typed);
      payload.source_document_id = null;
      payload.source_quote = null;
      payload.source_page = null;
      payload.previous_value = keep ? _str(String(term.documentReading.value), 4000) : null;
      payload.note = ENTERED_NOTE + (reason ? ' Reason: ' + reason : '');
      return { ok: true, payload: payload };
    }
    if (reason && !payload.note) payload.note = reason;

    if (payload.action === 'confirm' || payload.action === 'correct') {
      if (!term) return { ok: false, error: 'Confirming or correcting a term needs the term it acts on' };
      if (term.state === 'missing') {
        return { ok: false, error: 'No document establishes this term, so there is nothing to ' + payload.action + '.' };
      }
      if (!term.canConfirm) {
        return { ok: false, error: term.blockedReason
          || 'The document this term comes from is not confirmed yet. Confirm or correct the document type first.' };
      }
    }

    // A correction the field cannot hold is refused HERE, before anything is
    // written — never stored to be shown as verified with no value. What is
    // accepted is exactly what the resolver will read back, in its own form.
    if (payload.action === 'correct') {
      // A correction that quotes its clause is read as a document reading;
      // one that does not is a person's value, read by the person's rule.
      var to;
      if (payload.source_quote) {
        to = normalizeFieldValue(payload.field_key, payload.new_value, true);
        if (to === null || to === undefined) return { ok: false, error: inputError(payload.field_key, payload.new_value) };
      } else {
        var pc = personValue(payload.field_key, payload.new_value);
        if (pc.error) return { ok: false, error: personError(payload.field_key, pc.error, payload.new_value) };
        to = pc.value;
      }
      payload.new_value = storedForm(to);
    }

    // What the term read before this act, so the correction records what it
    // replaced rather than erasing it.
    // A rejected term has no value; what a later act replaces is the reading
    // that was rejected.
    if (payload.previous_value === undefined && term && term.value !== null && term.value !== undefined) {
      payload.previous_value = _str(String(term.value), 4000);
    } else if (payload.previous_value === undefined && term && term.rejectedReading
               && term.rejectedReading.value !== null && term.rejectedReading.value !== undefined) {
      payload.previous_value = _str(String(term.rejectedReading.value), 4000);
    }
    return { ok: true, payload: payload };
  }

  // ── What a person types (Step C) ──────────────────────────────────────────
  var INPUT_HINT = {
    number: 'a number', money: 'a dollar amount', percent: 'a percentage',
    date: 'a date', boolean: 'yes or no', text: 'text',
  };
  function inputHint(field) {
    var meta = FIELD_META[field] || {};
    if (meta.type === 'enum') return 'one of: ' + (meta.values || []).join(', ');
    return INPUT_HINT[meta.type] || 'a value';
  }
  // A value in the form it is stored in: what normalizeFieldValue reads back
  // unchanged.
  function storedForm(v) {
    if (typeof v === 'boolean') return v ? 'yes' : 'no';
    return String(v);
  }
  // ── What a PERSON types: zero and "none", by field type ─────────────────
  //
  // A person's value is not an AI reading. An AI reading of "0" or "none"
  // with no clause behind it is a guess, and normalizeFieldValue reads it as
  // nothing; a person who types 0 means zero. So a person's input is read by
  // its own rule, and the AI rule is unchanged:
  //
  //   money, percent   0 is a value ($0, 0%), never "not established". A word
  //                    for none ("none", "no", "n/a", "nil", "zero") is not a
  //                    figure: the person is asked to enter 0. Never negative.
  //   leased area      must be greater than zero. Never negative.
  //   a term a document can state as "None" (rent increases, CAM / tax /
  //                    insurance recovery, percentage rent): a bare "None" is
  //                    the finding that a document's clause denies the term —
  //                    a person with no clause on file cannot make it. They
  //                    may describe what they know instead ("No percentage
  //                    rent (per seller)"), recorded as their text, entered,
  //                    and never drawn as "None (stated)".
  //   everything else  as normalizeFieldValue reads it (a yes/no term's "No"
  //                    is still No).
  var GREATER_THAN_ZERO = { leased_sqft: true };
  function personValue(field, raw) {
    var meta = FIELD_META[field];
    if (!meta) return { error: 'unknown' };
    var s = raw === null || raw === undefined ? '' : String(raw).trim();
    if (!s) return { error: 'empty' };
    if (meta.type === 'number' || meta.type === 'money' || meta.type === 'percent') {
      if (_isNegativeWord(s) && !/^0+(\.0+)?$/.test(s)) return { error: 'none_word' };
      var c = s.replace(/[$,%\s]/g, '');
      if (/^-/.test(c) || /^\(.*\)$/.test(c)) return { error: 'negative' };
      var n = Number(c);
      if (!c || !isFinite(n)) return { error: 'not_a_figure' };
      if (n === 0 && GREATER_THAN_ZERO[field]) return { error: 'zero' };
      return { value: n };
    }
    if (meta.type === 'text' && meta.none && _isNegativeWord(s.replace(/[.\s]+$/, ''))) return { error: 'none_needs_clause' };
    var v = normalizeFieldValue(field, s, false);
    return (v === null || v === undefined) ? { error: 'invalid' } : { value: v };
  }
  function personError(field, code, raw) {
    var meta = FIELD_META[field] || {};
    var label = meta.label || field;
    if (code === 'none_word') return 'To record a figure of zero, enter 0. A word like “none” is not a figure.';
    if (code === 'negative') return label + ' cannot be negative.';
    if (code === 'zero') return 'A leased area must be greater than zero.';
    if (code === 'none_needs_clause') return '“None” for ' + label.toLowerCase() + ' means a document’s clause says there is none, and only a document can establish that. '
      + 'Describe what you know instead — for example “No ' + label.toLowerCase() + ' (per seller)”.';
    return inputError(field, raw);
  }

  function inputError(field, raw) {
    var meta = FIELD_META[field] || {};
    var s = raw === null || raw === undefined ? '' : String(raw).trim();
    if (!s) return 'Enter ' + inputHint(field) + '.';
    if (meta.type === 'date') return 'That is not a date. Choose a date, or type it as YYYY-MM-DD.';
    return 'That is not ' + inputHint(field) + ' for ' + (meta.label || field) + '.';
  }
  /**
   * What a person typed for a term, checked BEFORE anything is saved:
   *   { ok: true, value, stored }   the value as the term will hold it, and
   *                                 the form it is stored in
   *   { ok: false, error, empty }   why it cannot be saved
   * The same rule the payload builder enforces and the resolver reads back.
   */
  function validateTermInput(field, raw) {
    if (!FIELD_META[field]) return { ok: false, error: 'Unknown term.' };
    var s = raw === null || raw === undefined ? '' : String(raw).trim();
    if (!s) return { ok: false, error: inputError(field, s), empty: true };
    var p = personValue(field, s);
    if (p.error) return { ok: false, error: personError(field, p.error, s) };
    return { ok: true, value: p.value, stored: storedForm(p.value) };
  }

  // ── A term's decisions, in the order they were made (Step C) ──────────────
  var HISTORY_LABEL = {
    entered: 'Entered by a person', kept: 'Kept over a document\u2019s reading',
    corrected: 'Corrected', confirmed: 'Confirmed', rejected: 'Rejected', reopened: 'Reopened',
  };
  /** The reason a person gave, out of a decision's note. */
  function decisionReason(note) {
    if (typeof note !== 'string' || !note.trim()) return null;
    var s = note.indexOf(ENTERED_NOTE) === 0 ? note.slice(ENTERED_NOTE.length).trim() : note.trim();
    if (s.indexOf('Reason:') === 0) s = s.slice(7).trim();
    return s || null;
  }
  /**
   * Every decision on one field, oldest first — append-only, so this is the
   * whole history — each with what it did, the value it set, the value it
   * replaced and the person's reason; the one that stands is marked.
   */
  function decisionHistory(decisions, field) {
    var rows = (Array.isArray(decisions) ? decisions : []).filter(function (r) {
      return r && r.field_key === field && DECISION_ACTIONS.indexOf(r.action) >= 0;
    }).slice().sort(function (a, b) {
      var x = String(a.decided_at || ''), y = String(b.decided_at || '');
      return x < y ? -1 : x > y ? 1 : 0;
    });
    var stands = latestDecision(decisions, field);
    return rows.map(function (r) {
      var kind = r.action === 'correct'
        ? (isEnteredDecision(r) ? (r.previous_value != null ? 'kept' : 'entered') : 'corrected')
        : r.action === 'confirm' ? 'confirmed' : r.action === 'reject' ? 'rejected' : 'reopened';
      return {
        id: r.id || null, action: r.action, kind: kind, label: HISTORY_LABEL[kind],
        newValue: r.new_value == null ? null : normalizeFieldValue(field, r.new_value, true),
        previousValue: r.previous_value == null ? null : normalizeFieldValue(field, r.previous_value, true),
        rawNew: r.new_value == null ? null : r.new_value, rawPrevious: r.previous_value == null ? null : r.previous_value,
        reason: decisionReason(r.note),
        decidedAt: r.decided_at || null, decidedBy: r.decided_by || null,
        standing: !!stands && stands === r,
      };
    });
  }

  /** What a family's terms amount to. Never throws. */
  function summarizeTerms(terms) {
    var t = (terms && typeof terms === 'object') ? terms : {};
    var out = { total: FIELDS.length, verified: 0, ai_extracted: 0, conflicting: 0,
                unclear: 0, missing: 0, derived: 0, blocked: 0, entered: 0, rejected: 0, enteredConflict: 0 };
    for (var i = 0; i < FIELDS.length; i++) {
      var term = t[FIELDS[i]];
      var st = (term && TERM_STATES.indexOf(term.state) >= 0) ? term.state : 'missing';
      out[st]++;
      if (term && term.derived) out.derived++;
      if (term && term.support === 'entered') out.entered++;
      if (term && term.rejected) out.rejected++;
      if (term && term.enteredConflict) out.enteredConflict++;
      if (term && term.state !== 'missing' && !term.canConfirm) out.blocked++;
    }
    return out;
  }

  var api = {
    FIELD_GROUPS: FIELD_GROUPS,
    FIELDS: FIELDS,
    FIELD_META: FIELD_META,
    ABSTRACTION_STATUSES: ABSTRACTION_STATUSES,
    ABSTRACTION_ERRORS: ABSTRACTION_ERRORS,
    abstractionErrorFor: abstractionErrorFor,
    EVIDENCE_SCHEMA_VERSION: EVIDENCE_SCHEMA_VERSION,
    QUOTE_MAX: QUOTE_MAX,
    quoteMaxFor: quoteMaxFor,
    unreadFields: unreadFields,
    mergeUnreadFields: mergeUnreadFields,
    NONE_VALUE: NONE_VALUE,
    normalizeFieldValue: normalizeFieldValue,
    normalizeEntry: normalizeEntry,
    buildAbstraction: buildAbstraction,
    summarizeAbstraction: summarizeAbstraction,
    isAbstractable: isAbstractable,

    // ── P4-2 ────────────────────────────────────────────────────────────────
    REASONER_DOC_TYPE: REASONER_DOC_TYPE,
    REASONER_TIER: DEFAULT_TIER,
    TERM_STATES: TERM_STATES,
    STATE_STRENGTH: STATE_STRENGTH,
    DECISION_ACTIONS: DECISION_ACTIONS,
    ENTERED_NOTE: ENTERED_NOTE,
    evidenceSupport: evidenceSupport,
    buildReasonerInput: buildReasonerInput,
    classificationCeiling: classificationCeiling,
    latestDecision: latestDecision,
    DECISION_WRITABLE: DECISION_WRITABLE,
    DECISION_CAMEL: DECISION_CAMEL,
    DECISION_COLUMNS: DECISION_COLUMNS,
    DECISION_SELECT: DECISION_SELECT,
    buildDecisionPayload: buildDecisionPayload,
    resolveTerms: resolveTerms,
    acquisitionContradictions: acquisitionContradictions,
    resolveFamilyTerms: resolveFamilyTerms,
    summarizeTerms: summarizeTerms,

    // ── Step C: manual entry and its safeguards ─────────────────────────────
    isEnteredDecision: isEnteredDecision,
    validateTermInput: validateTermInput,
    personValue: personValue,
    inputHint: inputHint,
    storedForm: storedForm,
    decisionReason: decisionReason,
    decisionHistory: decisionHistory,
    HISTORY_LABEL: HISTORY_LABEL,
  };
  if (root) root.AcquisitionTerms = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

})(typeof window !== 'undefined' ? window : null);
