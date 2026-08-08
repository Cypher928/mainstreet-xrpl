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
  const CANONICAL_FIELDS = [
    'cap', 'admin_fee_pct', 'gross_up_pct', 'expense_stop',
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

  function _fmtDate(d) {
    if (!d) return null;
    try { return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }); }
    catch (_) { return d; }
  }

  // Mirrors the enforcement condition in script.js runCAMAllocation (the stricter
  // of the two engine sites — runFullReconciliation only null-checks). Kept in
  // this module so the summary and the engine cannot disagree about whether a
  // cap is live. If the engine's condition changes, change this with it.
  function capIsEnforceable(t) {
    if (!t) return false;
    const pct = parseFloat(t.cap);
    if (t.cap == null || t.cap === '' || !Number.isFinite(pct) || pct < 0 || pct > 100) return false;
    // parseFloat(null/undefined/'') is NaN, so this one check covers absence and
    // non-numeric alike. Note 0 IS enforceable here: the engine treats a zero
    // base the same way, and this helper must not diverge from it.
    return Number.isFinite(parseFloat(t.capBaseAmount));
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
      if (!capIsEnforceable(t)) {
        fieldSummaries.cap += ' NOT ENFORCED — no prior-year base amount on file, so the cap cannot be calculated and this reconciliation applies no limit.';
        reviewNotes.push(`CAM Cap of ${t.cap}% found in the lease but NOT being enforced. Enter the prior-year CAM base amount for this tenant to apply it.`);
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
    const capPhrase = t.cap == null
      ? 'No CAM Cap.'
      : (capIsEnforceable(t) ? `CAM Cap: ${t.cap}%.` : `CAM Cap: ${t.cap}% (not enforced — no base amount).`);
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
        // Only fire when field was never extracted (null/undefined).
        // Empty string means Claude confirmed no exclusions — still informative, don't alert.
        return isNnn && (t.excluded_categories === null || t.excluded_categories === undefined);
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
        const leaseEndYr = new Date(t.end_date).getFullYear();
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
    CAM_CONCEPT_MAP,
    normalizeClauseConcept,
    reasonMultiDocumentLease,
    deriveExtractionConfidence,
    generateLeaseExplainability,
    detectLeaseEdgeCases,
    modelRoutingRecommendation,
    buildMultiDocReasoningDocs,
  };
})();
