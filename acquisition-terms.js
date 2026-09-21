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
 * approved plan rather than added quietly, and they are kept in full.
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
  };
  var FIELDS = FIELD_GROUPS.canonical.concat(FIELD_GROUPS.extracted, FIELD_GROUPS.acquisition);

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
  };

  var ABSTRACTION_STATUSES = ['pending', 'success', 'partial', 'failed', 'skipped'];
  var EVIDENCE_SCHEMA_VERSION = 1;
  var QUOTE_MAX = 600;
  var TEXT_MAX  = 1000;

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
      case 'text':    return _isNil(raw) ? null : _str(String(raw), TEXT_MAX);
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
    var quote = _str(o.quote, QUOTE_MAX);
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

  var api = {
    FIELD_GROUPS: FIELD_GROUPS,
    FIELDS: FIELDS,
    FIELD_META: FIELD_META,
    ABSTRACTION_STATUSES: ABSTRACTION_STATUSES,
    EVIDENCE_SCHEMA_VERSION: EVIDENCE_SCHEMA_VERSION,
    QUOTE_MAX: QUOTE_MAX,
    normalizeFieldValue: normalizeFieldValue,
    normalizeEntry: normalizeEntry,
    buildAbstraction: buildAbstraction,
    summarizeAbstraction: summarizeAbstraction,
    isAbstractable: isAbstractable,
  };
  if (root) root.AcquisitionTerms = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

})(typeof window !== 'undefined' ? window : null);
