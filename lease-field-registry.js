'use strict';
/**
 * lease-field-registry.js — P0.4. ONE authoritative list of lease fields.
 *
 * WHAT WAS WRONG
 * --------------
 * A lease field was declared in at least four places, and they had drifted:
 *
 *   · script.js callClaudeForLease      — 18 fields + an inline quotes line
 *   · script.js callClaudeWithPdfDirect —  9 fields, no quotes
 *   · api/_claude-tasks.js              — 18 fields + a block quotes object
 *   · script.js _quoteMap               — extraction key → tenant storage key
 *
 * They are not subsets of one another. The server asks for `suite`,
 * `base_rent` and `security_deposit`, which neither browser prompt mentions.
 * Both browser prompts ask for `cam_commencement_date` and
 * `partial_period_basis`, which the server does not. `tenant_name` is
 * `string` in two of them and `string or null` in the third. Whichever list
 * someone edited, the others kept their own answer, and a field the resolver
 * did not expect is silently dropped.
 *
 * WHAT THIS IS
 * ------------
 * Every lease field, declared once, with the metadata the existing workflow
 * already relies on:
 *
 *   key      the canonical extraction key, as it appears in the prompt JSON
 *   label    the human name (what the Evidence Viewer and review UI show)
 *   store    the key the tenant object stores it under — usually identical,
 *            but `sqft → leased_sqft`, `cam_cap → cap`, `lease_start_date →
 *            start_date`, `lease_end_date → end_date`
 *   types    the type expression PER PROFILE, because they genuinely differ
 *   quote    whether the model is asked for a verbatim clause for this field
 *
 * WHAT THIS IS NOT
 * ----------------
 * It does NOT change any prompt. promptSchema() reproduces each existing
 * block byte for byte, including the divergences above — they are recorded
 * here as data, not silently reconciled. Unifying them changes what the model
 * is asked for, which is an extraction-semantics decision and a separate,
 * separately authorized piece of work. The value today is that the lists stop
 * being independent: there is one place to read, one place to change, and a
 * test that fails the moment a copy drifts from this file again.
 *
 * PROFILES
 *   text    script.js callClaudeForLease — the full text-extraction prompt
 *   pdf     script.js callClaudeWithPdfDirect — the vision prompt, a subset
 *   server  api/_claude-tasks.js LEASE_EXTRACTION_SYSTEM (P0.4 records it;
 *           the file itself is not rewritten in this slice)
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.LeaseFieldRegistry = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  var PROFILES = ['text', 'pdf', 'server'];

  // The order of this array IS the order fields appear in every prompt. A
  // profile renders the fields it has a type for, in this order, which is how
  // the rendered blocks come out identical to the hand-written ones.
  var FIELDS = [
    { key: 'tenant_name', label: 'Tenant Name', store: 'tenant_name',
      types: { text: 'string', pdf: 'string or null', server: 'string' } },

    { key: 'suite', label: 'Suite', store: 'suite',
      types: { server: 'string | null' } },

    { key: 'lease_start_date', label: 'Lease Start', store: 'start_date',
      types: { text: '"YYYY-MM-DD" or null', pdf: '"YYYY-MM-DD" or null', server: '"YYYY-MM-DD"' } },

    { key: 'lease_end_date', label: 'Lease End', store: 'end_date',
      types: { text: '"YYYY-MM-DD" or null', pdf: '"YYYY-MM-DD" or null', server: '"YYYY-MM-DD"' } },

    { key: 'cam_commencement_date', label: 'CAM Commencement', store: 'cam_commencement_date',
      types: { text: '"YYYY-MM-DD" or null', pdf: '"YYYY-MM-DD" or null' } },

    { key: 'partial_period_basis', label: 'Partial Period Basis', store: 'partial_period_basis',
      types: { text: '"per_diem" | "monthly" | "full_period" | null',
               pdf:  '"per_diem" | "monthly" | "full_period" | null' } },

    { key: 'lease_type', label: 'Lease Type', store: 'lease_type',
      types: { text: '"NNN" | "Gross" | "Modified Gross" | null',
               pdf:  '"NNN" | "Gross" | "Modified Gross" | null',
               server: 'string' } },

    { key: 'sqft', label: 'Leased SqFt', store: 'leased_sqft',
      types: { text: 'number or null', pdf: 'number or null', server: 'number' } },

    { key: 'base_rent', label: 'Base Rent', store: 'base_rent',
      types: { server: 'number | null' } },

    { key: 'cam_cap', label: 'CAM Cap', store: 'cap',
      types: { text: 'number or null', pdf: 'number or null', server: 'number' } },

    { key: 'cap_base_amount', label: 'Cap Base Amount', store: 'cap_base_amount',
      types: { text: 'number or null' } },

    { key: 'admin_fee_pct', label: 'Admin Fee %', store: 'admin_fee_pct',
      types: { text: 'number or null', server: 'number | null' } },

    { key: 'admin_fee_basis', label: 'Admin Fee Basis', store: 'admin_fee_basis',
      types: { text: '"operating_expenses" | "controllable_expenses" | "excluding_management_fee" | "unstated" | null',
               server: '"operating_expenses" | "controllable_expenses" | "excluding_management_fee" | "unstated" | null' } },

    { key: 'gross_up_pct', label: 'Gross-Up %', store: 'gross_up_pct',
      types: { text: 'number or null', server: 'number | null' } },

    { key: 'expense_stop', label: 'Expense Stop', store: 'expense_stop',
      types: { text: 'number or null', server: 'number | null' } },

    { key: 'audit_rights', label: 'Audit Rights', store: 'audit_rights',
      types: { text: 'true | false | null', server: 'true | false | null' } },

    { key: 'pro_rata_method', label: 'Pro-Rata Method', store: 'pro_rata_method',
      types: { text: '"rentable" | "leasable" | "occupied" | "gross" | null',
               server: '"rentable" | "leasable" | "occupied" | "gross" | null' } },

    { key: 'renewal_options', label: 'Renewal Options', store: 'renewal_options',
      types: { text: 'string or null', server: 'string | null' } },

    { key: 'excluded_categories', label: 'Excluded Categories', store: 'excluded_categories',
      types: { text: 'string or null', server: 'string | null' } },

    { key: 'security_deposit', label: 'Security Deposit', store: 'security_deposit',
      types: { server: 'number | null' } },

    { key: 'property_name', label: 'Property Name', store: 'property_name',
      types: { text: 'string or null', pdf: 'string or null', server: 'string | null' } },
  ];

  // Which fields carry a verbatim clause, per profile, IN THE ORDER the
  // existing prompts list them. The orders differ between text and server;
  // that difference is recorded, not resolved.
  var QUOTE_KEYS = {
    text: ['cam_cap', 'cap_base_amount', 'admin_fee_pct', 'gross_up_pct', 'expense_stop',
           'audit_rights', 'pro_rata_method', 'renewal_options', 'cam_commencement_date',
           'partial_period_basis', 'admin_fee_basis'],
    pdf: null,
    server: ['cam_cap', 'admin_fee_pct', 'admin_fee_basis', 'gross_up_pct', 'expense_stop',
             'audit_rights', 'pro_rata_method', 'renewal_options', 'base_rent',
             'security_deposit', 'tenant_name', 'lease_type', 'sqft',
             'lease_start_date', 'lease_end_date'],
  };

  // The text prompt writes its quotes on one line with `string|null` and no
  // spaces around the pipe; the server writes a block with `string | null`.
  var QUOTE_STYLE = {
    text:   { inline: true,  nullType: 'string|null' },
    server: { inline: false, nullType: 'string | null' },
  };

  var BY_KEY = {};
  for (var i = 0; i < FIELDS.length; i++) BY_KEY[FIELDS[i].key] = FIELDS[i];

  function has(field, profile) {
    return !!(field.types && Object.prototype.hasOwnProperty.call(field.types, profile));
  }

  /** Every field key in a profile, in prompt order. */
  function keys(profile) {
    var out = [];
    for (var i = 0; i < FIELDS.length; i++) if (has(FIELDS[i], profile)) out.push(FIELDS[i].key);
    return out;
  }

  function field(key) { return BY_KEY[key] || null; }
  function label(key) { return BY_KEY[key] ? BY_KEY[key].label : key; }

  /** The tenant-object key a field is stored under. Identity for most. */
  function storeKey(key) { return BY_KEY[key] ? BY_KEY[key].store : key; }

  /** Extraction key → storage key, for every field a profile can quote. */
  function quoteMap(profile) {
    var ks = QUOTE_KEYS[profile || 'text'] || [];
    var out = {};
    for (var i = 0; i < ks.length; i++) out[ks[i]] = storeKey(ks[i]);
    return out;
  }

  function quoteKeys(profile) {
    var ks = QUOTE_KEYS[profile || 'text'];
    return ks ? ks.slice() : [];
  }

  /**
   * The prompt's JSON schema block, exactly as each caller writes it today —
   * opening brace, two-space indented fields in registry order, the quotes
   * entry if the profile has one, closing brace. No trailing newline.
   */
  function promptSchema(profile) {
    if (PROFILES.indexOf(profile) === -1) throw new Error('unknown lease prompt profile: ' + profile);
    var lines = ['{'];
    var ks = keys(profile);
    var qk = QUOTE_KEYS[profile];
    for (var i = 0; i < ks.length; i++) {
      var f = BY_KEY[ks[i]];
      var last = (i === ks.length - 1) && !qk;
      lines.push('  "' + f.key + '": ' + f.types[profile] + (last ? '' : ','));
    }
    if (qk) {
      var style = QUOTE_STYLE[profile];
      if (style.inline) {
        var parts = [];
        for (var j = 0; j < qk.length; j++) parts.push('"' + qk[j] + '": ' + style.nullType);
        lines.push('  "quotes": { ' + parts.join(', ') + ' }');
      } else {
        lines.push('  "quotes": {');
        for (var k = 0; k < qk.length; k++) {
          lines.push('    "' + qk[k] + '": ' + style.nullType + (k === qk.length - 1 ? '' : ','));
        }
        lines.push('  }');
      }
    }
    lines.push('}');
    return lines.join('\n');
  }

  return {
    PROFILES: PROFILES,
    FIELDS: FIELDS,
    QUOTE_KEYS: QUOTE_KEYS,
    keys: keys,
    field: field,
    label: label,
    storeKey: storeKey,
    quoteMap: quoteMap,
    quoteKeys: quoteKeys,
    promptSchema: promptSchema,
  };
}));
