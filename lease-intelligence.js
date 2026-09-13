'use strict';
/**
 * lease-intelligence.js — Phase 15: Lease Reasoning Benchmarking
 *
 * Pure module — no DOM, no global state mutations, no network.
 * All functions are deterministic given their inputs.
 *
 * Exposes: window.LeaseIntelligence
 *
 * Task 1 — reasonMultiDocumentLease(docs)
 * Task 2 — normalizeClauseConcept(rawText)
 * Task 3 — deriveExtractionConfidence(snapshots, context)
 * Task 4 — generateLeaseExplainability(tenantState)
 * Task 5 — detectLeaseEdgeCases(tenantState, extractionResult)
 * Task 6 — modelRoutingRecommendation(tenantState)
 */
window.LeaseIntelligence = (() => {

  // ── Canonical field list (mirrors CLAUDE_LEASE_SYSTEM schema) ────────────────
  // cap_base_amount is the DOLLAR operand of the CAM ceiling, and it was the one
  // input to that calculation with no provenance at all: absent from this list,
  // so FieldProvenance never resolved it and PropertyRecord never carried it,
  // while `cap` — the percentage beside it — had both. A ceiling is
  // capBaseAmount x (1 + cap%), so half of every enforced cap rested on a number
  // no surface could describe. It is stored on the tenant as `capBaseAmount`
  // (camelCase, unlike every key here), so callers resolve it through the
  // existing opts.value override rather than reshaping the tenant record.
  const CANONICAL_FIELDS = [
    'cap', 'cap_base_amount', 'admin_fee_pct', 'gross_up_pct', 'expense_stop',
    'audit_rights', 'pro_rata_method', 'renewal_options',
    'tenant_name', 'leased_sqft', 'start_date', 'end_date', 'lease_type',
  ];

  // ── Fields without which a CAM reconciliation cannot be computed ─────────────
  // Phase 0 (M5): the ingest gate in script.js used to derive "partial" from
  // start_date/end_date/lease_type only, so a lease with no square footage —
  // which cannot be allocated a pro-rata share at all — passed as status
  // 'success', _needsReview false, confidence 'high', while the explainability
  // summary generated from THIS list said "Review required before
  // reconciliation". Two lists, two answers, and the machine-readable one gated
  // the workflow. Exported so both consumers read the same array.
  const RECONCILIATION_CRITICAL_FIELDS = ['tenant_name', 'leased_sqft', 'start_date', 'end_date'];

  // ── TASK 2: CLAUSE SEMANTIC NORMALIZATION ─────────────────────────────────────
  //
  // Maps natural-language CAM clause variants to canonical codes.
  // Preserves original text and clause quote for evidence lineage.

  const CAM_CONCEPT_MAP = [
    {
      canonical: 'ADMIN_FEE',
      label: 'Administrative / Management Fee',
      patterns: [
        /admin(?:istrative)?\s+fee/i,
        /management\s+(?:fee|surcharge|charge|overhead)/i,
        /operating\s+overhead\s+allocation/i,
        /supervision\s+fee/i,
        /property\s+management\s+fee/i,
        /management\s+services\s+fee/i,
      ],
    },
    {
      canonical: 'CAM_CAP',
      label: 'CAM / Expense Increase Cap',
      patterns: [
        /cam\s+cap/i,
        /expense\s+(?:increase\s+)?cap/i,
        /capped\s+at\s+[\d.]+\s*%/i,
        /not\s+to\s+exceed\s+[\d.]+\s*%/i,
        /annual\s+increase\s+(?:is\s+)?(?:limited|capped)/i,
        /controllable\s+expense\s+cap/i,
        /shall\s+not\s+(?:pay|increase)\s+more\s+than/i,
        /increases\s+(?:shall\s+be\s+)?limited\s+to/i,
        /cam\s+increases\s+(?:limited|capped)/i,
      ],
    },
    {
      canonical: 'EXPENSE_STOP',
      label: 'Expense Stop / Base Year Stop',
      patterns: [
        /expense\s+stop/i,
        /base\s+year\s+(?:stop|expense)/i,
        /base\s+(?:year\s+)?operating\s+expenses?\s+of\s+\$/i,
        /tenant\s+(?:shall\s+)?pay\s+(?:the\s+)?excess/i,
        /gross\s+rent\s+(?:with\s+)?expense\s+stop/i,
      ],
    },
    {
      canonical: 'GROSS_UP',
      label: 'Gross-Up / Occupancy Normalization',
      patterns: [
        /gross[\s-]?up/i,
        /grossed[\s-]?up\s+to/i,
        /occupancy\s+factor/i,
        /occupancy\s+(?:threshold|level)\s+of\s+[\d.]+\s*%/i,
        /as\s+if\s+(?:the\s+)?(?:building|project)\s+were\s+[\d.]+\s*%\s+occupied/i,
        /normalized\s+to\s+[\d.]+\s*%\s+occupancy/i,
      ],
    },
    {
      canonical: 'CAM_EXCLUSION',
      label: 'CAM Exclusion',
      patterns: [
        /excluded?\s+(?:from\s+)?(?:cam|operating\s+expenses?)/i,
        /cam\s+exclusion/i,
        /non[-\s]?(?:allocable|cam)\s+expense/i,
        /shall\s+not\s+(?:be\s+)?included\s+in\s+(?:cam|operating)/i,
        /excluded\s+(?:from\s+)?tenant'?s?\s+(?:pro[\s-]?rata\s+)?share/i,
      ],
    },
    {
      canonical: 'AUDIT_RIGHTS',
      label: 'Tenant Audit Rights',
      patterns: [
        /audit\s+rights?/i,
        /right\s+to\s+audit/i,
        /inspection\s+(?:and\s+audit\s+)?rights?/i,
        /books\s+and\s+records/i,
        /tenant\s+(?:may|shall\s+have\s+the\s+right\s+to)\s+(?:examine|inspect|audit)/i,
        /right\s+to\s+examine\s+(?:landlord'?s?\s+)?(?:books|records)/i,
        /\d+[\s-]year\s+(?:audit\s+)?(?:look[\s-]?back|reimbursement\s+period)/i,
      ],
    },
    {
      canonical: 'RENEWAL_OPTION',
      label: 'Renewal Option',
      patterns: [
        /renewal\s+option/i,
        /option\s+to\s+(?:renew|extend)/i,
        /extension\s+option/i,
        /renewal\s+term/i,
        /(?:tenant|lessee)\s+shall\s+have\s+(?:the\s+)?(?:option|right)\s+to\s+(?:renew|extend)/i,
        /(?:two|three|four|five|\d+)\s+(?:\(\d+\)\s+)?(?:additional\s+)?(?:five|three|two|\d+)[\s-]year\s+(?:renewal|extension)/i,
      ],
    },
    {
      canonical: 'PRO_RATA',
      label: 'Pro-Rata Share Method',
      patterns: [
        /pro[\s-]?rata\s+share/i,
        /proportionate\s+share/i,
        /tenant'?s?\s+(?:pro[\s-]?rata|proportionate)\s+share/i,
        /rentable\s+(?:area|square\s+(?:feet|footage))\s+(?:of\s+)?(?:the\s+)?(?:premises|leased\s+space)/i,
        /(?:leasable|occupied|gross)\s+(?:area|square\s+(?:feet|footage))/i,
      ],
    },
    {
      canonical: 'LEASE_TYPE',
      label: 'Lease Type',
      patterns: [
        /triple[\s-]?net/i,
        /\bnnn\b/i,
        /modified\s+gross/i,
        /gross\s+lease/i,
        /net[\s-]?net[\s-]?net/i,
        /full[\s-]?service\s+(?:gross\s+)?lease/i,
      ],
    },
  ];

  function normalizeClauseConcept(rawText) {
    if (!rawText || typeof rawText !== 'string') {
      return { canonical: null, label: null, candidates: [], preservedText: rawText || '', confidence: 0 };
    }
    const text = rawText.trim();
    const matches = [];
    for (const concept of CAM_CONCEPT_MAP) {
      const hitCount = concept.patterns.filter(p => p.test(text)).length;
      if (hitCount > 0) matches.push({ canonical: concept.canonical, label: concept.label, hitCount });
    }
    matches.sort((a, b) => b.hitCount - a.hitCount);
    const best = matches[0] || null;
    const confidence = !best ? 0
      : matches.length === 1 ? (best.hitCount >= 2 ? 90 : 70)
      : best.hitCount > matches[1].hitCount ? 75 : 50;
    return { canonical: best?.canonical ?? null, label: best?.label ?? null, candidates: matches, preservedText: text, confidence };
  }

  // ── TASK 1: MULTI-DOCUMENT REASONING ─────────────────────────────────────────
  //
  // Determines governing clause precedence across a document set.
  // Input:  [{ docType, docDate, fileName, extractedFields:{}, quotes:{} }]
  // Output: { [fieldKey]: { currentValue, supersededValues, governingDocument,
  //                         governingClause, confidence, reasoning, contradictions } }

  const DOC_TYPE_TIER = { side_letter: 4, estoppel: 3, amendment: 2, original_lease: 1 };

  function reasonMultiDocumentLease(documents) {
    if (!Array.isArray(documents) || documents.length === 0) return {};

    // Sort: higher tier first, then newer date first within same tier.
    const sorted = [...documents].sort((a, b) => {
      const td = (DOC_TYPE_TIER[b.docType] || 0) - (DOC_TYPE_TIER[a.docType] || 0);
      if (td !== 0) return td;
      const da = a.docDate ? new Date(a.docDate).getTime() : 0;
      const db = b.docDate ? new Date(b.docDate).getTime() : 0;
      return db - da;
    });

    const result = {};

    for (const field of CANONICAL_FIELDS) {
      const history = [];
      for (const doc of sorted) {
        const val = doc.extractedFields?.[field];
        if (val == null || val === '') continue;
        history.push({ value: val, docType: doc.docType, docDate: doc.docDate || null, fileName: doc.fileName || null, quote: doc.quotes?.[field] || null });
      }
      if (history.length === 0) continue;

      const governing = history[0];
      const supersededValues = history.slice(1);

      // Contradiction: same-tier docs with different values for this field
      const contradictions = [];
      const byTier = {};
      for (const v of history) {
        const tier = DOC_TYPE_TIER[v.docType] || 0;
        (byTier[tier] = byTier[tier] || []).push(v);
      }
      for (const group of Object.values(byTier)) {
        if (group.length < 2) continue;
        const unique = new Set(group.map(v => String(v.value)));
        if (unique.size > 1) {
          contradictions.push({ tier: DOC_TYPE_TIER[group[0].docType] || 0, documents: group.map(v => v.fileName), values: [...unique] });
        }
      }

      let fieldConf = 80;
      if (contradictions.length > 0) fieldConf -= 25;
      if (history.length > 1 && contradictions.length === 0) fieldConf = Math.min(95, fieldConf + 10);
      if (!governing.quote) fieldConf -= 10;
      fieldConf = Math.max(10, Math.min(100, fieldConf));

      const docLabel = d => {
        const dt = d.docDate ? ` dated ${d.docDate}` : '';
        const fn = d.fileName ? ` (${d.fileName})` : '';
        return `${(d.docType || '').replace('_', ' ')}${dt}${fn}`;
      };

      let reasoning;
      if (history.length === 1) {
        reasoning = `${field} set to ${JSON.stringify(governing.value)} in ${docLabel(governing)}.`;
      } else {
        const prior = supersededValues[0];
        reasoning = `${field} changed from ${JSON.stringify(prior.value)} to ${JSON.stringify(governing.value)} by ${docLabel(governing)}.`;
        if (supersededValues.length > 1) reasoning += ` Previously set by ${supersededValues.length} earlier document${supersededValues.length > 1 ? 's' : ''}.`;
        if (contradictions.length > 0) reasoning += ` WARNING: Conflicting values detected across ${contradictions.length} document group${contradictions.length > 1 ? 's' : ''}.`;
      }

      result[field] = { currentValue: governing.value, supersededValues, governingDocument: governing.docType, governingClause: governing.quote || null, confidence: fieldConf, reasoning, contradictions };
    }
    return result;
  }

  // ── TASK 3: CONFIDENCE CALIBRATION ───────────────────────────────────────────
  //
  // Extends computeExtractionConfidence with multi-document and clause signals.
  // Input:  snapshots — evidence snapshots array for a specific field
  //         context  — { ocrChars, hasQuote, multiDocAgreement, amendmentConflict,
  //                       candidateCount, ocrQuality, governingClauseUncertain, inferenceType }
  // Output: { score, level, reasons, signals }

  function deriveExtractionConfidence(snapshots, context) {
    const ctx = context || {};
    let score = 70;
    const reasons = [];
    const signals = [];

    const push = (type, adj, desc) => { score += adj; signals.push({ type, adjustment: adj, description: desc }); };

    if (ctx.hasQuote) {
      push('direct_quote', +20, 'Direct verbatim clause found');
    }
    if (ctx.multiDocAgreement === true) {
      push('multi_doc_agreement', +10, 'Multiple documents agree on this value');
    }
    if (Array.isArray(snapshots) && snapshots.length > 1) {
      const bonus = Math.min(10, (snapshots.length - 1) * 5);
      push('confirming_snapshots', bonus, `${snapshots.length} evidence snapshots confirm value`);
    }
    if (ctx.ocrQuality === 'poor' || (ctx.ocrChars != null && ctx.ocrChars < 200)) {
      push('poor_ocr', -15, 'OCR quality below threshold'); reasons.push('Poor OCR quality detected');
    } else if (ctx.ocrChars != null && ctx.ocrChars < 500) {
      push('short_ocr', -8, 'OCR text very short'); reasons.push('Short text layer — possible OCR degradation');
    }
    if (ctx.amendmentConflict === true) {
      push('amendment_conflict', -20, 'Amendment contradicts prior value'); reasons.push('Conflicting amendment values detected');
    }
    if (ctx.candidateCount != null && ctx.candidateCount > 1) {
      push('ambiguous_clauses', -10, 'Multiple candidate clauses found'); reasons.push(`${ctx.candidateCount} candidate clause matches — ambiguous`);
    }
    if (ctx.governingClauseUncertain === true) {
      push('uncertain_clause', -10, 'Governing clause not definitively identified'); reasons.push('Governing clause uncertain');
    }
    if (ctx.inferenceType === 'unsupported') {
      push('unsupported_inference', -5, 'Inferred without explicit clause support'); reasons.push('Value inferred without explicit clause support');
    }

    // Without a verbatim clause quote the score cannot be rated 'high' — confirming
    // snapshots improve precision but do not substitute for a direct textual citation.
    if (!ctx.hasQuote) {
      score = Math.min(score, 79);
    }

    score = Math.max(0, Math.min(100, score));
    const level = score >= 80 ? 'high' : score >= 55 ? 'medium' : score > 0 ? 'low' : 'failed';
    return { score, level, reasons, signals };
  }

  // ── TASK 4: EXPLAINABILITY OUTPUTS ───────────────────────────────────────────
  //
  // Generates human-readable summaries for review acceleration.
  // Output: { fieldSummaries:{}, overallSummary:string, reviewNotes:[] }

  // A date-only lease value is a calendar day, not an instant. `new Date(
  // '2016-02-28')` is midnight UTC, which renders as February 27th anywhere west
  // of Greenwich — the same one-day shift that made this module and the Lender
  // Summary disagree with the audit about when SHONAC's lease ended. Build the
  // date from its parts so the day survives the round trip.
  function _leaseDate(d) {
    if (d == null || d === '') return null;
    if (d instanceof Date) return isNaN(d.getTime()) ? null : d;
    const s = String(d).trim();
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    const dt = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(s);
    return isNaN(dt.getTime()) ? null : dt;
  }

  function _fmtDate(d) {
    if (!d) return null;
    try {
      const dt = _leaseDate(d);
      return dt ? dt.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : d;
    } catch (_) { return d; }
  }

  // ── THE CAP'S UNIT IS READ, NEVER GUESSED ──────────────────────────────────
  //
  // api/_claude-tasks.js asks for `cam_cap` as a bare number and says, in the
  // prompt itself: "If a percentage is found return 5. If a dollar amount is
  // found, return that number." So a 5% cap and a $5 cap arrive in the same
  // field wearing the same shape, and NOTHING stored tells them apart. The
  // engine treats every cap as a percentage — `base x (1 + cap/100)` — which is
  // right for the first and meaningless for the second.
  //
  // The one thing that CAN say which is meant is the clause the value came from,
  // because the lease writes its own unit down. So the unit is read out of the
  // stored evidence quote and nowhere else.
  //
  // THE NUMBER IS NEVER CONSULTED. "5 is too small to be dollars" and "120 is
  // too big to be a percent" are exactly the inferences that put a percentage in
  // a dollar field once already; M7's cap_unit_ambiguous caveat exists because
  // magnitude cannot settle this. A quote that says both, or says neither, or
  // does not exist, leaves the unit UNDECLARED — which is a fact about our
  // knowledge, not a defect in the lease, and it is the default rather than the
  // exception so that silence can never read as a percentage.
  const CAP_UNIT = { PERCENT: 'percent', DOLLAR: 'dollar', UNDECLARED: 'undeclared' };

  // 'cap' is the canonical key; 'cam_cap' is the name extraction returns and
  // several fixtures store. Both are read so the unit does not depend on which
  // path wrote the evidence.
  const _CAP_EVIDENCE_KEYS = ['cap', 'cam_cap'];
  const _PERCENT_MARK = /%|\bper\s?cent(?:um|age)?\b|\bpercent\b/i;
  const _DOLLAR_MARK  = /\$|\bdollars?\b|\bUSD\b/i;

  function _capQuotes(t) {
    const fev = (t && t.fieldEvidence) || {};
    const out = [];
    for (const k of _CAP_EVIDENCE_KEYS) {
      const snaps = (fev[k] && fev[k].snapshots) || [];
      for (const s of snaps) {
        if (s && typeof s.quote === 'string' && s.quote.trim()) out.push(s.quote);
      }
    }
    return out;
  }

  /**
   * percent | dollar | undeclared — from the lease's own words.
   *
   * Every stored cap quote must agree. One clause saying "5%" and another saying
   * "$5.00" is not a majority vote to be counted; it is two readings of the same
   * term, and picking one would be the hundred-fold guess this exists to refuse.
   */
  function capUnit(t) {
    const quotes = _capQuotes(t);
    if (!quotes.length) return CAP_UNIT.UNDECLARED;
    let sawPercent = false, sawDollar = false;
    for (const q of quotes) {
      const pct = _PERCENT_MARK.test(q);
      const usd = _DOLLAR_MARK.test(q);
      // A single clause carrying both marks states a compound term this slice
      // does not model. It settles nothing.
      if (pct && usd) return CAP_UNIT.UNDECLARED;
      if (pct) sawPercent = true;
      if (usd) sawDollar  = true;
    }
    if (sawPercent && sawDollar) return CAP_UNIT.UNDECLARED;
    if (sawPercent) return CAP_UNIT.PERCENT;
    if (sawDollar)  return CAP_UNIT.DOLLAR;
    return CAP_UNIT.UNDECLARED;
  }

  /**
   * Is there a dollar base the ceiling can actually stand on?
   *
   * ZERO IS NOT A BASE. `0 x (1 + 5/100)` is 0, so a zero base does not produce
   * a loose ceiling — it produces a ceiling of nothing, capping the tenant's
   * entire CAM charge to $0 and reporting capApplied: true. That is the single
   * most destructive value this field can hold, and it is the one value the old
   * `!isNaN(parseFloat(base))` test waved through.
   *
   * Two paths already knew this. Extraction refuses a base unless `n > 0`
   * (script.js _capBaseAmount) and the tenant statement requires `_capBase > 0`
   * before it will describe a ceiling. Only the engine and this helper disagreed.
   * They no longer do.
   */
  function capBaseIsUsable(t) {
    if (!t) return false;
    const n = parseFloat(t.capBaseAmount);
    return Number.isFinite(n) && n > 0;
  }

  // Mirrors the enforcement condition in script.js runCAMAllocation (the stricter
  // of the two engine sites — runFullReconciliation only null-checks). Kept in
  // this module so the summary and the engine cannot disagree about whether a
  // cap is live. If the engine's condition changes, change this with it.
  // Unit-blind ON PURPOSE — see deriveCapState. The only thing that changed here
  // is that a base of 0 no longer counts as a base, which tracks the matching
  // guard now in script.js _camCeilingCents. The mirror still holds.
  function capIsEnforceable(t) {
    if (!t) return false;
    const pct = parseFloat(t.cap);
    if (t.cap == null || t.cap === '' || !Number.isFinite(pct) || pct < 0 || pct > 100) return false;
    return capBaseIsUsable(t);
  }

  /**
   * THE ONE ANSWER TO "IS THIS TENANT'S CAP DOING ANYTHING?"
   *
   * Derived at read time from what is already stored. Nothing here is persisted:
   * a second copy of this truth in the database is a second thing that can drift
   * away from the lease, and the inputs — the cap, the base, the quote — are
   * already the record.
   *
   * The states are deliberately five rather than two, because "the cap is not
   * being enforced" has three different causes that call for three different
   * things from the manager, and collapsing them is how the old banner came to
   * tell the owner of a DOLLAR cap to go and enter a prior-year percentage base:
   *
   *   no_cap            nothing to enforce; say nothing
   *   enforceable       percentage cap standing on a usable base
   *   missing_base      percentage cap, no usable base — ASK, and say where
   *   dollar_cap        the lease states dollars; a base is NOT the missing piece
   *   unit_unconfirmed  we do not know which kind of cap this is
   *
   * `actionable` marks only the state where a manager typing one number into an
   * existing field resolves the whole thing. The other two unresolved states are
   * real and must stay visible, but neither is fixed by supplying a base, and
   * offering that action would be a lie about what would happen.
   */
  function deriveCapState(t) {
    const capRaw = t ? t.cap : null;
    const pct    = parseFloat(capRaw);
    const hasCap = t != null && capRaw != null && capRaw !== '' && Number.isFinite(pct);

    if (!hasCap) {
      return { state: 'no_cap', unit: null, enforceable: false, actionable: false,
               capValue: null, baseUsable: false, engineWillCap: false,
               title: 'No CAM cap', why: 'This lease states no limit on CAM increases.',
               needed: null, field: null };
    }

    const unit   = capUnit(t);
    const usable = capBaseIsUsable(t);

    // WHAT THE ENGINE WILL ACTUALLY DO — not what we wish it did.
    //
    // `enforceable` is capIsEnforceable, which mirrors runCAMAllocation. It is
    // deliberately NOT unit-aware, because the engine is not: it applies
    // percentage arithmetic to whatever `cap` holds, under the system-wide
    // convention that lease.cap is a percentage (api/_mcp-capabilities.js UNITS
    // records that convention, and normalizeCap enforces it on the extraction
    // path). Teaching the engine about units is a separate decision.
    //
    // Making this flag unit-dependent was tried and was wrong: it made this
    // module report "not enforced" for caps the engine was in fact enforcing,
    // which is the exact divergence the mirror exists to prevent. The unit
    // instead decides WHICH unresolved cause to name when the engine is not
    // enforcing — it never contradicts the engine about whether it is.
    const enforceable = capIsEnforceable(t);
    if (enforceable) {
      return { state: 'enforced', unit, enforceable: true, actionable: false,
               capValue: pct, baseUsable: true, engineWillCap: true,
               title: 'CAM cap enforced', why: null, needed: null, field: null };
    }

    // AND WHAT THE LIVE ENGINE DOES IS NOT QUITE WHAT capIsEnforceable SAYS.
    //
    // capIsEnforceable's comment describes it as mirroring runCAMAllocation —
    // but CAM-6 deleted that call, and runFullReconciliation, the only CAM
    // arithmetic that now runs, has NO percentage-range check. Its gate is a
    // finite cap and a usable base, nothing more. So a cap of 150 with a base
    // still produces a ceiling and can still bind (a NEGATIVE cap binds hard:
    // -50 on a $26,000 base yields a $13,000 ceiling that silently halves the
    // bill).
    //
    // That gap matters for one sentence in particular. Every other unresolved
    // state can honestly say "no limit was applied"; this one cannot, and a
    // banner that said it anyway would be making exactly the kind of false
    // reassurance this slice exists to remove. So the engine's real condition
    // is carried separately rather than inferred from `enforceable`.
    const engineWillCap = Number.isFinite(pct) && usable;

    if (unit === CAP_UNIT.DOLLAR) {
      // A base is NOT what is missing here, so none is requested. Sending this
      // manager after a prior-year base would be advice that could not have
      // helped, for a term their lease never wrote.
      return { state: 'dollar_cap', unit, enforceable: false, actionable: false,
               capValue: pct, baseUsable: usable, engineWillCap: engineWillCap,
               title: 'CAM cap recorded in dollars',
               // Same rule as cap_out_of_range below: the flat claim is made only
               // when the engine really did compute nothing. A dollar cap with a
               // base still reaches the ceiling arithmetic, which reads it as a
               // percentage — the resulting ceiling is nonsense rather than
               // absent, and calling that "not applied" would understate it.
               why: 'The lease clause states this cap as a dollar amount, and MainStreet applies percentage caps only.'
                    + (engineWillCap
                        ? ' It was read as a percentage, so the ceiling calculated from it does not reflect the lease. Confirm the cap.'
                        : ' This cap is not being applied, and a prior-year base would not change that.'),
               needed: null, field: null };
    }

    if (pct < 0 || pct > 100) {
      return { state: 'cap_out_of_range', unit, enforceable: false, actionable: false,
               capValue: pct, baseUsable: usable, engineWillCap: engineWillCap,
               title: 'Cap value out of range',
               why: 'A CAM cap of ' + pct + ' is on file, which is outside the range MainStreet treats as a percentage.'
                    + (engineWillCap
                        ? ' A ceiling was still calculated from it, so the amount charged may not reflect what the lease allows. Confirm the cap.'
                        : ' Confirm the cap before it can be enforced.'),
               needed: null, field: null };
    }

    if (unit === CAP_UNIT.UNDECLARED) {
      // The honest weaker state. We know a base is absent, but not whether a
      // base is even the right thing to ask for — so we ask for neither.
      return { state: 'unit_unconfirmed', unit, enforceable: false, actionable: false,
               capValue: pct, baseUsable: usable, engineWillCap: engineWillCap,
               title: 'Cap type needs confirmation',
               why: 'A CAM cap of ' + pct + ' is on file, but no clause on record says whether that is a percentage or a dollar amount. Cap type needs confirmation before MainStreet can determine whether a base is required.',
               needed: null, field: null };
    }

    // Percentage, in range, no usable base: the one state a manager fixes by
    // typing a single number into a field that already exists.
    return { state: 'missing_base', unit, enforceable: false, actionable: true,
             capValue: pct, baseUsable: false, engineWillCap: false,
             title: 'CAM cap not enforced',
             why: 'The lease caps CAM increases at ' + pct + '% over a prior-year base, and MainStreet has no base amount on file for this tenant. Without it the ceiling cannot be calculated, so this reconciliation applies no limit.',
             needed: 'Prior-Year CAM Base ($)',
             field: 'cap_base_amount' };
  }

  function generateLeaseExplainability(tenantState) {
    if (!tenantState) return { fieldSummaries: {}, overallSummary: '', reviewNotes: [] };
    const t = tenantState;
    const amendments = Array.isArray(t.amendments) ? t.amendments : [];
    const fev = t.fieldEvidence || {};
    const fieldSummaries = {};
    const reviewNotes = [];

    const govAmendment = fk => amendments.slice().reverse().find(a => Array.isArray(a.overriddenFields) && a.overriddenFields.includes(fk));
    const amdLabel = a => {
      const idx = amendments.indexOf(a);
      const dt = a.effectiveDate || a.uploadedAt;
      return `Amendment #${idx + 1}${dt ? ` dated ${_fmtDate(dt)}` : ''}`;
    };
    const latestQuote = fk => {
      const snaps = fev[fk]?.snapshots || [];
      return snaps.length ? snaps[snaps.length - 1].quote || null : null;
    };
    const supersededSnaps = fk => {
      const snaps = fev[fk]?.snapshots || [];
      return snaps.slice(0, -1);
    };

    // cap
    if (t.cap != null) {
      const gov = govAmendment('cap');
      const prior = supersededSnaps('cap');
      if (gov && prior.length > 0) {
        const prevVal = prior[prior.length - 1].value;
        fieldSummaries.cap = `CAM Cap ${prevVal != null ? `reduced from ${prevVal}% to ` : 'set to '}${t.cap}% by ${amdLabel(gov)}.`;
      } else if (gov) {
        fieldSummaries.cap = `CAM Cap of ${t.cap}% applied by ${amdLabel(gov)}.`;
      } else {
        fieldSummaries.cap = `CAM Cap of ${t.cap}% defined in original lease.`;
      }
      // Phase 0 (M1a): a cap percentage alone does not cap anything. The engine
      // (script.js runFullReconciliation / runCAMAllocation) requires BOTH
      // capPercentage and capBaseAmount and skips enforcement when the base is
      // absent — deliberately, rather than invent a base. capBaseAmount is
      // manual entry and extraction never sets it, so every extracted cap is
      // inert on arrival. Saying "CAM Cap of 5.25%" without saying that is a
      // claim the reconciliation does not honour.
      //
      // WHICH inertness, though, is now read from deriveCapState rather than
      // assumed. This said "no prior-year base amount on file" for every
      // unenforced cap, including one the lease states in DOLLARS — sending that
      // manager off to find a prior-year base that would not have helped, for a
      // cap that needs no base at all. One derivation, so this note and the CAM
      // banner cannot name different causes for the same tenant.
      const _cs = deriveCapState(t);
      if (!_cs.enforceable) {
        fieldSummaries.cap += ' NOT ENFORCED — ' + _cs.why;
        reviewNotes.push(_cs.actionable
          ? `CAM Cap of ${t.cap}% found in the lease but NOT being enforced. Enter the prior-year CAM base amount for this tenant to apply it.`
          : `CAM Cap of ${t.cap} found in the lease but NOT being enforced. ${_cs.why}`);
      }
    } else {
      fieldSummaries.cap = 'No CAM Cap found — tenant bears full proportionate share of expense increases.';
      reviewNotes.push('CAM Cap not specified. Verify whether annual increase limits apply.');
    }

    // admin_fee_pct
    if (t.admin_fee_pct != null) {
      const gov = govAmendment('admin_fee_pct');
      fieldSummaries.admin_fee_pct = gov
        ? `Administrative fee of ${t.admin_fee_pct}% applied per ${amdLabel(gov)}.`
        : `Administrative fee of ${t.admin_fee_pct}% per lease.`;
    } else {
      fieldSummaries.admin_fee_pct = 'Administrative / management fee not specified.';
    }

    // gross_up_pct
    if (t.gross_up_pct != null) {
      const qt = latestQuote('gross_up_pct');
      if (!qt) {
        fieldSummaries.gross_up_pct = 'Gross-up language detected with ambiguous occupancy threshold.';
        reviewNotes.push('Gross-up clause detected but occupancy percentage not confirmed by direct quote — verify manually.');
      } else {
        fieldSummaries.gross_up_pct = `Gross-up set to ${t.gross_up_pct}% occupancy. Clause: "${qt.slice(0, 80)}${qt.length > 80 ? '…' : ''}"`;
      }
    } else {
      fieldSummaries.gross_up_pct = 'No gross-up provision found.';
    }

    // expense_stop
    if (t.expense_stop != null) {
      fieldSummaries.expense_stop = `Expense stop of $${t.expense_stop}/sqft defined in lease.`;
    } else {
      fieldSummaries.expense_stop = 'No expense stop defined.';
    }

    // audit_rights
    if (t.audit_rights === true) {
      const qt = latestQuote('audit_rights');
      const windowMatch = qt?.match(/(\d+)[\s-]year/i);
      const windowStr = windowMatch ? ` — ${windowMatch[1]}-year look-back window` : '';
      fieldSummaries.audit_rights = qt
        ? `Audit rights clause exists${windowStr}. Source: "${qt.slice(0, 80)}${qt.length > 80 ? '…' : ''}"`
        : 'Audit rights clause exists but reimbursement window could not be determined.';
    } else if (t.audit_rights === false) {
      fieldSummaries.audit_rights = 'Audit rights explicitly waived in lease.';
      reviewNotes.push('Audit rights have been waived — tenant cannot independently verify CAM charges.');
    } else {
      fieldSummaries.audit_rights = 'Audit rights not addressed — default rights may apply per jurisdiction.';
    }

    // pro_rata_method
    if (t.pro_rata_method) {
      fieldSummaries.pro_rata_method = `Pro-rata share calculated on ${t.pro_rata_method} square footage basis.`;
    } else {
      fieldSummaries.pro_rata_method = 'Pro-rata method not specified — verify allocation denominator.';
      reviewNotes.push('Pro-rata share denominator not confirmed. Allocation may be contested.');
    }

    // renewal_options
    fieldSummaries.renewal_options = t.renewal_options
      ? `Renewal options: ${t.renewal_options}.`
      : 'No renewal options specified.';

    // amendments digest
    if (amendments.length > 0) {
      const modified = [...new Set(amendments.flatMap(a => a.overriddenFields || []))];
      reviewNotes.push(`${amendments.length} amendment${amendments.length > 1 ? 's' : ''} on file, modifying: ${modified.join(', ')}.`);
    }

    const missingCritical = RECONCILIATION_CRITICAL_FIELDS.filter(f => !t[f]);
    // The one-line verdict, from the same derivation as the note above. The
    // unenforced branch used to name a missing base unconditionally and print a
    // "%" sign on a cap whose unit nothing had established; both are claims, and
    // neither survived contact with a dollar cap.
    const _capSummaryState = deriveCapState(t);
    // The "%" follows the same convention the engine does: lease.cap is read as
    // a percentage unless a clause says otherwise, so it is printed for percent
    // and undeclared alike and withheld ONLY from a cap the lease states in
    // dollars — where "50000%" would be the app repeating a mistake in a louder
    // voice. Dropping it everywhere was tried and was wrong: it made the summary
    // disagree with the tenant card, the CAM tile and the engine, all of which
    // apply the convention.
    const _pctMark = _capSummaryState.unit === CAP_UNIT.DOLLAR ? '' : '%';
    const capPhrase = t.cap == null
      ? 'No CAM Cap.'
      : (_capSummaryState.enforceable
          ? `CAM Cap: ${t.cap}${_pctMark}.`
          : `CAM Cap: ${t.cap}${_pctMark} (not enforced — ${_capSummaryState.actionable ? 'no base amount' : _capSummaryState.title.toLowerCase()}).`);
    const overallSummary = missingCritical.length === 0
      ? `Lease complete. ${amendments.length > 0 ? amendments.length + ' amendment(s) applied. ' : ''}${capPhrase}`
      : `Lease incomplete — missing: ${missingCritical.join(', ')}. Review required before reconciliation.`;

    return { fieldSummaries, overallSummary, reviewNotes };
  }

  // ── TASK 5: EDGE CASE REASONING ──────────────────────────────────────────────
  //
  // Detects lease document quality issues and structural ambiguities.
  // Input:  tenantState — tenant object with fieldEvidence, amendments, etc.
  //         extractionResult — { ocrChars, usedPdfDirect, ocrText }
  // Output: { edgeCases, overallRisk, shouldFlagReview, totalConfidenceAdjustment }

  const EDGE_CASE_DEFINITIONS = [
    {
      type: 'WEAK_OCR',
      severity: 'high',
      description: 'Very short OCR text layer — likely scan quality issue or locked PDF.',
      confidenceAdjustment: -20,
      fieldImpact: ['tenant_name', 'leased_sqft', 'start_date', 'end_date', 'cap'],
      reviewerNote: 'Retry with PDF direct mode or re-scan at higher resolution.',
      detect: (t, r) => !r?.usedPdfDirect && r?.ocrChars != null && r.ocrChars < 300,
    },
    {
      type: 'MISSING_PAGES',
      severity: 'medium',
      description: 'Document appears truncated — key lease sections may be missing.',
      confidenceAdjustment: -15,
      fieldImpact: ['cap', 'audit_rights', 'renewal_options'],
      reviewerNote: 'Ensure full lease was uploaded. Missing pages may hide critical CAM clauses.',
      detect: (t, r) => r?.ocrChars != null && r.ocrChars > 0 && r.ocrChars < 800 && !r?.usedPdfDirect,
    },
    {
      type: 'AMENDMENT_CONFLICT',
      severity: 'high',
      description: 'Two or more amendments modify the same field — governing version unclear.',
      confidenceAdjustment: -25,
      fieldImpact: [],
      reviewerNote: 'Confirm which amendment governs based on effective date order.',
      detect: (t) => {
        const ams = Array.isArray(t.amendments) ? t.amendments : [];
        if (ams.length < 2) return false;
        const seen = {};
        for (const a of ams) for (const f of (a.overriddenFields || [])) seen[f] = (seen[f] || 0) + 1;
        return Object.values(seen).some(c => c > 1);
      },
    },
    {
      type: 'CONTRADICTORY_CAP_AND_STOP',
      severity: 'medium',
      description: 'Both a CAM Cap and an Expense Stop are present — mechanisms may conflict.',
      confidenceAdjustment: -10,
      fieldImpact: ['cap', 'expense_stop'],
      reviewerNote: 'Confirm which protection mechanism applies per your reconciliation approach.',
      detect: (t) => t.cap != null && t.expense_stop != null,
    },
    {
      type: 'CAM_EXCLUSIONS_UNDEFINED',
      severity: 'low',
      description: 'NNN lease with no CAM exclusions — all operating expenses may be allocable.',
      confidenceAdjustment: -5,
      fieldImpact: ['excluded_categories'],
      reviewerNote: 'NNN with no exclusions — tenant may have broader exposure to expense categories.',
      detect: (t) => {
        const lt = (t.lease_type || '').toLowerCase();
        const isNnn = lt.includes('nnn') || lt.includes('triple') || lt.includes('net');
        // F-02: this could never fire before, because script.js collapsed '' to
        // null at extraction and normalizeTenant turned null back into '' — so
        // the stored value was '' either way. Both sides are fixed; null now
        // genuinely means "never extracted" and reaches this branch.
        return isNnn && (t.excluded_categories === null || t.excluded_categories === undefined);
      },
    },
    {
      type: 'CAM_EXCLUSIONS_EMPTY',
      severity: 'low',
      description: 'NNN lease where extraction found no exclusion schedule at all.',
      confidenceAdjustment: -5,
      fieldImpact: ['excluded_categories'],
      reviewerNote: 'Extraction returned no exclusions for a net lease. Confirm against the lease — SIGA returned none twice and five exclusions on a third run of the identical document.',
      // '' means extraction ran and found nothing. That is a real answer, but on
      // a net lease it is an unusual one and F-02 showed it can be wrong.
      detect: (t) => {
        const lt = (t.lease_type || '').toLowerCase();
        const isNnn = lt.includes('nnn') || lt.includes('triple') || lt.includes('net');
        return isNnn && t.excluded_categories === '';
      },
    },
    {
      type: 'AMBIGUOUS_GROSS_UP',
      severity: 'medium',
      description: 'Gross-up percentage found but no verbatim clause quote — occupancy threshold uncertain.',
      confidenceAdjustment: -10,
      fieldImpact: ['gross_up_pct'],
      reviewerNote: 'Verify gross-up occupancy percentage against lease language.',
      detect: (t) => {
        const snaps = t.fieldEvidence?.gross_up_pct?.snapshots || [];
        return t.gross_up_pct != null && !snaps.some(s => s.quote);
      },
    },
    {
      type: 'MALFORMED_OCR',
      severity: 'medium',
      description: 'High proportion of non-alphanumeric characters — OCR output may be corrupted.',
      confidenceAdjustment: -15,
      fieldImpact: ['tenant_name', 'leased_sqft'],
      reviewerNote: 'Re-upload as a higher-quality scan or enable PDF direct mode.',
      detect: (t, r) => {
        if (!r?.ocrText || r.ocrText.length < 100) return false;
        const sample = r.ocrText.slice(0, 500);
        const noise = (sample.match(/[^a-zA-Z0-9\s$%.,;:'"()\-/]/g) || []).length;
        return noise / sample.length > 0.08;
      },
    },
    {
      type: 'RENEWAL_DATE_CONFLICT',
      severity: 'low',
      description: 'Renewal option text references dates inconsistent with lease end date.',
      confidenceAdjustment: -5,
      fieldImpact: ['renewal_options', 'end_date'],
      reviewerNote: 'Verify renewal option dates against lease expiration.',
      detect: (t) => {
        if (!t.renewal_options || !t.end_date) return false;
        const _le = _leaseDate(t.end_date);
        if (!_le) return false;
        const leaseEndYr = _le.getFullYear();
        const m = t.renewal_options.match(/20(\d{2})/);
        if (!m) return false;
        return parseInt('20' + m[1]) < leaseEndYr;
      },
    },
    {
      type: 'PROPERTY_NAME_MISMATCH',
      severity: 'high',
      description: 'The property/building name stated in the lease document does not match the property this lease was uploaded into.',
      confidenceAdjustment: -20,
      fieldImpact: ['property_name'],
      reviewerNote: 'Confirm this lease belongs to the current property before approving — it may have been uploaded to the wrong property.',
      detect: (t, r) => {
        const extracted = (t.property_name || '').trim();
        const current = (r?.currentPropertyName || '').trim();
        if (!extracted || !current) return false; // fail-open: never flag on missing data
        const tokenize = s => (s.toLowerCase().match(/[a-z0-9]+/g) || []).filter(w => w.length > 2);
        const extractedTokens = tokenize(extracted);
        const currentTokens   = tokenize(current);
        if (extractedTokens.length === 0 || currentTokens.length === 0) return false;
        // Any shared token (e.g. "Lakeview" in "Lakeview Plaza" vs "Lakeview Towers") counts as a match —
        // only flag when there is NO overlap at all, to avoid false positives on partial/abbreviated names.
        const hasOverlap = extractedTokens.some(w => currentTokens.includes(w));
        return !hasOverlap;
      },
    },
  ];

  // ── PROPERTY_NAME_MISMATCH: the landlord's explicit resolution ─────────────
  // Detection above is deliberately unchanged and stays unchanged: a mismatch is
  // always detected, always recorded on _edgeCases, and always visible. What
  // follows only answers a second, separate question — has a human who owns this
  // property said "yes, this lease really does belong here".
  //
  // Lives here, beside the detector, so script.js (the CAM gate) and
  // review-engine.js (Needs Review) cannot drift into two different opinions of
  // what "confirmed" means. Same reasoning as F-02's single resolver.
  //
  // WHY THIS COMPARES VALUES RATHER THAN HASHING THEM
  // The exclusion acknowledgement (_exclusionAck) keys on a fingerprint because
  // its input is free-text prose that has to be normalised before two versions
  // can be compared. The facts here are already discrete — a property name and a
  // document identity — so storing and comparing them directly is both simpler
  // and strictly more auditable: a person reading the record sees exactly what
  // was confirmed, instead of an opaque eight-character hash.

  /**
   * Stable identity of the lease document a confirmation was made against.
   * Re-uploading a different document changes this, which invalidates the
   * confirmation — the landlord verified one document, not the tenant forever.
   */
  function propertyDocumentKey(t) {
    if (!t) return '';
    return String(t.leaseUrl || t.fileName || (t.leaseFile && t.leaseFile.name) || '').trim();
  }

  /**
   * True when a landlord confirmation is present AND still describes the lease
   * as it stands now.
   *
   * FAILS CLOSED in every ambiguous case. A confirmation that cannot be matched
   * to the current extracted property name and document is treated as absent, so
   * the mismatch re-blocks rather than silently persisting across a re-upload or
   * a re-extraction that changed what the lease says.
   */
  function isPropertyMismatchConfirmed(t) {
    const c = t && t._propertyConfirm;
    if (!c || typeof c !== 'object') return false;
    const confirmedName = String(c.extractedName == null ? '' : c.extractedName).trim();
    const currentName   = String((t && t.property_name) == null ? '' : t.property_name).trim();
    // An empty confirmed name identifies nothing and must never match.
    if (!confirmedName) return false;
    if (confirmedName !== currentName) return false;
    return String(c.documentKey == null ? '' : c.documentKey) === propertyDocumentKey(t);
  }

  function detectLeaseEdgeCases(tenantState, extractionResult) {
    const t = tenantState || {};
    const r = extractionResult || {};
    const edgeCases = [];

    for (const def of EDGE_CASE_DEFINITIONS) {
      let triggered = false;
      try { triggered = !!def.detect(t, r); } catch (_) {}
      if (!triggered) continue;
      edgeCases.push({
        type:                 def.type,
        severity:             def.severity,
        description:          def.description,
        fieldImpact:          def.fieldImpact.slice(),
        confidenceAdjustment: def.confidenceAdjustment,
        reviewerNote:         def.reviewerNote,
      });
    }

    const hasHigh   = edgeCases.some(e => e.severity === 'high');
    const hasMedium = edgeCases.some(e => e.severity === 'medium');
    return {
      edgeCases,
      overallRisk:                hasHigh ? 'high' : hasMedium ? 'medium' : edgeCases.length > 0 ? 'low' : 'none',
      shouldFlagReview:           hasHigh || (hasMedium && edgeCases.length >= 2),
      totalConfidenceAdjustment:  edgeCases.reduce((s, e) => s + e.confidenceAdjustment, 0),
    };
  }

  // ── TASK 6: MODEL ROUTING ────────────────────────────────────────────────────
  //
  // Recommends model tier based on lease complexity signals.
  // simple extraction → lightweight model (Haiku 4.5)
  // complex amendment reasoning → Opus 4.8

  function modelRoutingRecommendation(tenantState) {
    const t = tenantState || {};
    const amendments = Array.isArray(t.amendments) ? t.amendments : [];
    const { edgeCases, overallRisk } = detectLeaseEdgeCases(t, null);
    // AI-1 — `?? 100` routed an unmeasured lease to the lightweight model on the
    // strength of a score nobody computed. Unknown confidence is a reason to
    // spend more reasoning, not less: null routes conservatively.
    const confScore = (typeof t._confidenceScore === 'number' && Number.isFinite(t._confidenceScore))
      ? t._confidenceScore : null;

    const signals = [];
    if (amendments.length > 0)           signals.push(`${amendments.length} amendment(s) require precedence reasoning`);
    if (overallRisk === 'high')           signals.push('High-risk edge cases detected');
    if (confScore == null)                signals.push('Extraction confidence unknown — routing conservatively');
    else if (confScore < 60)              signals.push(`Low confidence score (${confScore})`);
    if (edgeCases.some(e => e.type === 'AMENDMENT_CONFLICT'))       signals.push('Amendment conflict — governing version uncertain');
    if (edgeCases.some(e => e.type === 'CONTRADICTORY_CAP_AND_STOP')) signals.push('Contradictory CAM clauses present');
    if (t.expense_stop != null && t.cap != null)                    signals.push('Both expense stop and CAM cap present');

    return signals.length > 0
      ? { model: 'claude-opus-4-8',              tier: 'complex', reason: `Complex reasoning required: ${signals.join('; ')}.`, signals }
      : { model: 'claude-haiku-4-5-20251001',    tier: 'simple',  reason: 'Clean single-document lease with high confidence — lightweight model sufficient.', signals: [] };
  }

  // ── Helper: build multi-doc reasoning input from a tenant object ──────────────
  //
  // Reconstructs the document set from t.fieldEvidence snapshots and t.amendments.
  // Used by script.js integration hooks after applyAmendmentOverrides().

  function buildMultiDocReasoningDocs(t) {
    if (!t) return [];
    const docs = [];

    const origFields = {}, origQuotes = {};
    for (const [fk, fev] of Object.entries(t.fieldEvidence || {})) {
      const s = (fev.snapshots || []).find(snap => !snap.amendmentId);
      if (s && s.value != null) { origFields[fk] = s.value; if (s.quote) origQuotes[fk] = s.quote; }
    }
    // Also include direct tenant fields not yet in fieldEvidence
    for (const fk of CANONICAL_FIELDS) {
      if (origFields[fk] == null && t[fk] != null) origFields[fk] = t[fk];
    }
    if (Object.keys(origFields).length > 0) {
      docs.push({ docType: 'original_lease', docDate: t.start_date || null, fileName: t.fileName || null, extractedFields: origFields, quotes: origQuotes });
    }

    for (const amd of (t.amendments || [])) {
      const amdFields = {}, amdQuotes = {};
      for (const [fk, fev] of Object.entries(t.fieldEvidence || {})) {
        const s = (fev.snapshots || []).find(snap => snap.amendmentId === amd.amendmentId);
        if (s && s.value != null) { amdFields[fk] = s.value; if (s.quote) amdQuotes[fk] = s.quote; }
      }
      for (const fk of (amd.overriddenFields || [])) {
        if (amdFields[fk] == null && amd.extractedFields?.[fk] != null) amdFields[fk] = amd.extractedFields[fk];
      }
      if (Object.keys(amdFields).length > 0) {
        docs.push({ docType: amd.docType || 'amendment', docDate: amd.effectiveDate || amd.uploadedAt || null, fileName: amd.fileName || null, extractedFields: amdFields, quotes: amdQuotes });
      }
    }
    return docs;
  }

  // ── Public API ────────────────────────────────────────────────────────────────
  return {
    CANONICAL_FIELDS,
    RECONCILIATION_CRITICAL_FIELDS,
    capIsEnforceable,
    CAP_UNIT,
    capUnit,
    capBaseIsUsable,
    deriveCapState,
    CAM_CONCEPT_MAP,
    normalizeClauseConcept,
    reasonMultiDocumentLease,
    deriveExtractionConfidence,
    generateLeaseExplainability,
    detectLeaseEdgeCases,
    modelRoutingRecommendation,
    buildMultiDocReasoningDocs,
    propertyDocumentKey,
    isPropertyMismatchConfirmed,
  };
})();
