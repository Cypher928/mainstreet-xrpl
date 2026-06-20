'use strict';

// ─── Escrow & Reserve Intelligence Engine ────────────────────────────────────
// Phase 21 — pure functions only: no DOM access, no global state, no network.
// Mirrors the architectural pattern of acquisition-engine.js. Input/output
// shapes are designed to be stored directly inside property.escrowReserves /
// property.drawRequests (persisted in properties.data, same as
// camReconciliation) — no new database tables required for this phase.

(function (root) {

  // ─── Canonical reserve types ────────────────────────────────────────────
  var RESERVE_TYPES = [
    { key: 'roof',                label: 'Roof Reserve' },
    { key: 'hvac',                label: 'HVAC Reserve' },
    { key: 'tenant_improvement',  label: 'Tenant Improvement Reserve' },
    { key: 'leasing_commission',  label: 'Leasing Commission Reserve' },
    { key: 'capital',             label: 'Capital Reserve' },
    { key: 'insurance_recovery',  label: 'Insurance Recovery Reserve' },
    { key: 'other',               label: 'Other Reserve' },
  ];
  var RESERVE_TYPE_KEYS   = RESERVE_TYPES.map(function (r) { return r.key; });
  var RESERVE_TYPE_LABELS = RESERVE_TYPES.reduce(function (acc, r) { acc[r.key] = r.label; return acc; }, {});

  // ─── Draw request status lifecycle ──────────────────────────────────────
  var DRAW_STATUSES = ['draft', 'submitted', 'under_review', 'approved', 'funded', 'denied'];
  var DRAW_STATUS_LABELS = {
    draft:         'Draft',
    submitted:     'Submitted',
    under_review:  'Under Review',
    approved:      'Approved',
    funded:        'Funded',
    denied:        'Rejected',
  };
  // Statuses that represent a claim against the reserve balance — used by
  // computeReserveBalance to compute what is "committed" vs truly available.
  var COMMITTED_DRAW_STATUSES = ['submitted', 'under_review', 'approved', 'funded'];

  // Legal forward-progression edges for the draw lifecycle. A draw can be
  // denied at any stage prior to funding, but cannot skip stages (e.g. draft
  // straight to funded) or move backward once advanced. funded/denied are
  // terminal. Enforced by applyDrawStatus; the UI stepper only renders these
  // as clickable next steps.
  var VALID_DRAW_TRANSITIONS = {
    draft:         ['submitted', 'denied'],
    submitted:     ['under_review', 'denied'],
    under_review:  ['approved', 'denied'],
    approved:      ['funded', 'denied'],
    funded:        [],
    denied:        [],
  };

  function getValidNextDrawStatuses(currentStatus) {
    return (VALID_DRAW_TRANSITIONS[currentStatus] || []).slice();
  }

  function _pf(v) {
    if (v == null || v === '') return null;
    var n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
    return Number.isFinite(n) ? n : null;
  }

  function _pb(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'boolean') return v;
    var s = String(v).toLowerCase().trim();
    if (s === 'true' || s === 'yes') return true;
    if (s === 'false' || s === 'no') return false;
    return null;
  }

  function _pd(v) {
    if (!v) return null;
    var d = new Date(v);
    if (isNaN(d.getTime())) return null;
    return String(v).slice(0, 10);
  }

  // Maps free-text reserve type (as returned by Claude extraction, or typed
  // by a user) to one of the canonical RESERVE_TYPES keys.
  function classifyReserveType(rawType) {
    if (!rawType) return 'other';
    var s = String(rawType).toLowerCase();
    if (/roof/.test(s))                                   return 'roof';
    if (/hvac|heating|ventilat|air\s*condition/.test(s))  return 'hvac';
    if (/tenant\s*improvement|\bti\b/.test(s))             return 'tenant_improvement';
    if (/leasing\s*commission/.test(s))                    return 'leasing_commission';
    if (/insurance\s*recover/.test(s))                     return 'insurance_recovery';
    if (/capital/.test(s))                                 return 'capital';
    return 'other';
  }

  // Maps an invoice's vendor name / category / line-item description to a
  // reserve type so the Draw Request builder can show only the invoices
  // relevant to the reserve being drawn against. Rule-based only (mirrors
  // the structure of classifyReserveType) — purely keyword-driven, no AI
  // call here; script.js layers a Claude fallback on top when this returns
  // 'other' with low confidence, following the normalizeCategory/
  // classifyCategory pattern already used for invoice category extraction.
  var INVOICE_RESERVE_KEYWORDS = [
    { type: 'roof',               re: /roof|shingle|membrane|reroof|gutter/i },
    { type: 'hvac',                re: /hvac|heating|ventilat|air\s*condition|chiller|boiler|rooftop\s*unit|\brtu\b|furnace|condenser/i },
    { type: 'tenant_improvement',  re: /tenant\s*improvement|\bti\b|build[\s-]?out|fit[\s-]?out/i },
    { type: 'leasing_commission',  re: /leasing\s*commission|broker\s*commission/i },
    { type: 'insurance_recovery',  re: /insurance|casualty|storm\s*damage|claim/i },
    { type: 'capital',             re: /capital\s*(expenditure|improvement|project)|parking\s*lot|paving|elevator|facade|structural/i },
  ];
  var CATEGORY_TO_RESERVE_TYPE = {
    insurance: 'insurance_recovery',
  };

  function classifyInvoiceReserveType(invoice) {
    var inv = invoice || {};
    var haystack = [inv.vendorName, inv.description, inv.lineItems, inv.notes]
      .filter(Boolean).join(' ');

    for (var i = 0; i < INVOICE_RESERVE_KEYWORDS.length; i++) {
      if (INVOICE_RESERVE_KEYWORDS[i].re.test(haystack)) {
        return { reserveType: INVOICE_RESERVE_KEYWORDS[i].type, confidence: 75 };
      }
    }

    var byCategory = CATEGORY_TO_RESERVE_TYPE[String(inv.category || '').toLowerCase()];
    if (byCategory) return { reserveType: byCategory, confidence: 60 };

    return { reserveType: 'other', confidence: 30 };
  }

  // ── Extraction confidence & source grounding ─────────────────────────────
  //
  // Lender documents are legal documents — a property manager will not trust
  // "Roof Reserve: $75,000" without knowing where that number came from. This
  // mirrors LeaseIntelligence.deriveExtractionConfidence: a verbatim quote
  // (with page number, read from the "--- Page N ---" markers script.js's
  // extractPdfText already injects) raises confidence; absence of a quote,
  // the lower-fidelity scanned-PDF vision path, or thin OCR text lower it.
  var CONFIDENCE_FIELDS = ['reserve_type', 'current_balance', 'eligible_uses'];

  function deriveReserveExtractionConfidence(evidence, opts) {
    evidence = (evidence && typeof evidence === 'object') ? evidence : {};
    opts = opts || {};
    var score = 70;
    var reasons = [];

    CONFIDENCE_FIELDS.forEach(function (f) {
      var ev = evidence[f];
      if (ev && ev.quote) {
        score += 8;
        if (ev.page == null) {
          score -= 3;
          reasons.push('No page citation for ' + f);
        }
      } else {
        score -= 12;
        reasons.push('No verbatim source quote for ' + f);
      }
    });

    if (opts.extractionPath === 'pdf_vision') {
      score -= 10;
      reasons.push('Extracted via scanned-document vision path — verify against source document');
    }
    if (opts.ocrChars != null && opts.ocrChars < 500) {
      score -= 10;
      reasons.push('Source text layer was very short — possible OCR degradation');
    }

    score = Math.max(0, Math.min(100, score));
    var level = score >= 80 ? 'high' : score >= 55 ? 'medium' : score > 0 ? 'low' : 'failed';
    return { score: score, level: level, reasons: reasons };
  }

  // ── TRACK 1: Reserve normalization ───────────────────────────────────────
  //
  // Converts raw Claude extraction output (or a manually-entered reserve) into
  // the canonical shape stored on property.escrowReserves[].
  function normalizeReserve(raw, meta) {
    raw  = raw  || {};
    meta = meta || {};
    var reserveTypeKey = RESERVE_TYPE_KEYS.indexOf(raw.reserve_type) !== -1
      ? raw.reserve_type
      : classifyReserveType(raw.reserve_type);

    var evidence = (raw.evidence && typeof raw.evidence === 'object') ? raw.evidence : {};
    var sourcePages = Object.keys(evidence)
      .map(function (k) { return evidence[k] && evidence[k].page; })
      .filter(function (p) { return typeof p === 'number' && p > 0; });
    sourcePages = sourcePages.filter(function (p, i) { return sourcePages.indexOf(p) === i; }).sort(function (a, b) { return a - b; });

    var confidence = deriveReserveExtractionConfidence(evidence, {
      extractionPath: meta.extractionPath || null,
      ocrChars:       meta.ocrChars != null ? meta.ocrChars : null,
    });

    return {
      id:               meta.id || ('reserve-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8)),
      reserveType:       reserveTypeKey,
      reserveTypeLabel:  reserveTypeKey === 'other' && raw.reserve_name
        ? String(raw.reserve_name).slice(0, 80)
        : RESERVE_TYPE_LABELS[reserveTypeKey],
      sourceFileName:    meta.sourceFileName || raw.sourceFileName || null,
      sourceFileUrl:      meta.sourceFileUrl  || raw.sourceFileUrl  || null,
      sourceDocuments:    Array.isArray(meta.sourceDocuments) ? meta.sourceDocuments : (
        meta.sourceFileName ? [{
          fileName:  meta.sourceFileName,
          fileUrl:   meta.sourceFileUrl || null,
          uploadedAt: meta.extractedAt || new Date().toISOString(),
        }] : []
      ),
      currentBalance:    _pf(raw.current_balance),
      eligibleUses:      raw.eligible_uses ? String(raw.eligible_uses).slice(0, 500) : null,
      requirements: {
        requiresInvoices:              _pb(raw.requires_invoices)              !== false, // default true unless explicitly false
        requiresPhotos:                _pb(raw.requires_photos)               === true,
        requiresLienWaivers:           _pb(raw.requires_lien_waivers)         === true,
        requiresContractorBids:        _pb(raw.requires_contractor_bids)      === true,
        requiresEngineerCertification: _pb(raw.requires_engineer_certification) === true,
        requiresApproval:              _pb(raw.requires_approval)             !== false,
        minDrawAmount:                 _pf(raw.min_draw_amount),
      },
      deadlines: {
        drawRequestDeadline:      _pd(raw.draw_request_deadline),
        repairCompletionDeadline: _pd(raw.repair_completion_deadline),
        reserveExpirationDate:    _pd(raw.reserve_expiration_date),
      },
      notes:                 raw.notes ? String(raw.notes).slice(0, 1000) : null,
      evidence:              evidence,
      sourcePages:           sourcePages,
      extractionConfidence:  confidence,
      extractedAt:           meta.extractedAt || new Date().toISOString(),
    };
  }

  // ── Reserve extraction merging ───────────────────────────────────────────
  //
  // A single document (or a batch of documents uploaded together) can cause
  // the same reserve type to be extracted more than once — e.g. a "Capital
  // Reserve" mentioned with its balance on page 1 and again, contextually,
  // on page 2 with no balance restated. Left alone this produces two cards
  // for what a property manager sees as one reserve. mergeReserveExtractions
  // groups a list of normalizeReserve() outputs by reserveType and collapses
  // each group into a single reserve carrying the union of every group
  // member's citations (sourcePages, sourceDocuments, evidence) — "one card,
  // multiple citations" instead of one card per extraction.
  function _mergeReserveGroup(group) {
    if (group.length === 1) return group[0];
    // Prefer the first member that actually states a balance as the base —
    // a later "Capital Reserve" mention with no balance shouldn't blank out
    // a balance an earlier mention already established.
    var base = group.filter(function (r) { return r.currentBalance != null; })[0] || group[0];
    var merged = Object.assign({}, base);

    var evidence = {};
    group.forEach(function (r) {
      Object.keys(r.evidence || {}).forEach(function (k) {
        if (!evidence[k] || !evidence[k].quote) evidence[k] = r.evidence[k];
      });
    });
    merged.evidence = evidence;

    var pages = [];
    group.forEach(function (r) {
      (r.sourcePages || []).forEach(function (p) { if (pages.indexOf(p) === -1) pages.push(p); });
    });
    merged.sourcePages = pages.sort(function (a, b) { return a - b; });

    var docs = [];
    group.forEach(function (r) {
      (r.sourceDocuments || []).forEach(function (d) {
        if (!docs.some(function (x) { return x.fileUrl === d.fileUrl && x.fileName === d.fileName; })) docs.push(d);
      });
    });
    merged.sourceDocuments = docs;

    merged.eligibleUses = group.map(function (r) { return r.eligibleUses; }).filter(Boolean)[0] || null;
    var notes = group.map(function (r) { return r.notes; }).filter(Boolean);
    merged.notes = notes.length ? notes.filter(function (n, i) { return notes.indexOf(n) === i; }).join(' ') : null;

    var reqs = group.map(function (r) { return r.requirements || {}; });
    merged.requirements = {
      requiresInvoices:              reqs.some(function (r) { return r.requiresInvoices; }),
      requiresPhotos:                reqs.some(function (r) { return r.requiresPhotos; }),
      requiresLienWaivers:           reqs.some(function (r) { return r.requiresLienWaivers; }),
      requiresContractorBids:        reqs.some(function (r) { return r.requiresContractorBids; }),
      requiresEngineerCertification: reqs.some(function (r) { return r.requiresEngineerCertification; }),
      requiresApproval:              reqs.some(function (r) { return r.requiresApproval; }),
      minDrawAmount: (function () {
        var vals = reqs.map(function (r) { return r.minDrawAmount; }).filter(function (v) { return v != null; });
        return vals.length ? vals[0] : null;
      }()),
    };

    var dls = group.map(function (r) { return r.deadlines || {}; });
    merged.deadlines = {
      drawRequestDeadline:      dls.map(function (d) { return d.drawRequestDeadline; }).filter(Boolean)[0] || null,
      repairCompletionDeadline: dls.map(function (d) { return d.repairCompletionDeadline; }).filter(Boolean)[0] || null,
      reserveExpirationDate:    dls.map(function (d) { return d.reserveExpirationDate; }).filter(Boolean)[0] || null,
    };

    merged.extractionConfidence = deriveReserveExtractionConfidence(merged.evidence, {});
    return merged;
  }

  function mergeReserveExtractions(reserves) {
    var safe = Array.isArray(reserves) ? reserves.filter(Boolean) : [];
    var groups = {};
    var order = [];
    safe.forEach(function (r) {
      if (!groups[r.reserveType]) { groups[r.reserveType] = []; order.push(r.reserveType); }
      groups[r.reserveType].push(r);
    });
    return order.map(function (type) { return _mergeReserveGroup(groups[type]); });
  }

  // ── TRACK 2: Reserve balance ─────────────────────────────────────────────
  //
  // currentBalance is the lender-stated balance as of the source document.
  // committedAmount sums every draw request against this reserve that is not
  // a draft and not denied (i.e. anything that represents a real claim on
  // funds, including ones already funded — funded draws should eventually be
  // reflected in an updated lender statement, but until that document is
  // uploaded we keep counting them so the available balance never overstates).
  function computeReserveBalance(reserve, drawRequests) {
    var safeDraws = (Array.isArray(drawRequests) ? drawRequests : [])
      .filter(function (d) { return d && d.reserveId === reserve.id; });

    var committedAmount = safeDraws
      .filter(function (d) { return COMMITTED_DRAW_STATUSES.indexOf(d.status) !== -1; })
      .reduce(function (s, d) { return s + (parseFloat(d.amountRequested) || 0); }, 0);

    var currentBalance   = reserve.currentBalance != null ? reserve.currentBalance : null;
    var availableBalance = currentBalance != null ? currentBalance - committedAmount : null;

    return {
      currentBalance:   currentBalance,
      committedAmount:  committedAmount,
      availableBalance: availableBalance,
      drawCount:        safeDraws.length,
    };
  }

  // ── TRACK 3: Draw request validation ─────────────────────────────────────
  //
  // Evaluates a draft draw request against its reserve's documented
  // requirements. Returns an explicit checklist plus an overall `pass` flag.
  // `pass` is the single gate the UI uses to decide whether a package may be
  // marked "lender-ready" / complete (Track 4 must check this before
  // generating a complete package).
  function validateDrawRequest(reserve, drawRequest, allDrawRequests) {
    var checklist = [];
    var dr = drawRequest || {};
    var req = (reserve && reserve.requirements) || {};

    var eligibleReserveFound = !!reserve;
    checklist.push({
      key: 'eligibleReserve', label: 'Eligible reserve found',
      met: eligibleReserveFound,
      detail: eligibleReserveFound ? null : 'No matching reserve selected for this draw request.',
    });

    if (!eligibleReserveFound) {
      return { pass: false, checklist: checklist, missing: checklist.filter(function (c) { return !c.met; }) };
    }

    // Committed amount of every OTHER draw against this reserve — excludes
    // the draw being validated so re-validating it doesn't double-count itself.
    var otherDraws = (Array.isArray(allDrawRequests) ? allDrawRequests : [])
      .filter(function (d) { return d && d.reserveId === reserve.id && d.id !== dr.id; });
    var committedExcludingSelf = otherDraws
      .filter(function (d) { return COMMITTED_DRAW_STATUSES.indexOf(d.status) !== -1; })
      .reduce(function (s, d) { return s + (parseFloat(d.amountRequested) || 0); }, 0);

    var amount  = parseFloat(dr.amountRequested) || 0;
    var available = reserve.currentBalance != null ? reserve.currentBalance - committedExcludingSelf : null;
    var sufficientBalance = available == null ? false : amount <= available;
    checklist.push({
      key: 'sufficientBalance', label: 'Sufficient reserve balance',
      met: sufficientBalance,
      detail: sufficientBalance ? null : (available == null
        ? 'Reserve balance is unknown — upload a reserve document with a current balance.'
        : 'Requested $' + amount.toLocaleString('en-US') + ' exceeds available balance of $' + available.toLocaleString('en-US') + '.'),
    });

    if (req.minDrawAmount != null) {
      var meetsMin = amount >= req.minDrawAmount;
      checklist.push({
        key: 'minDrawAmount', label: 'Meets minimum draw amount',
        met: meetsMin,
        detail: meetsMin ? null : 'Minimum draw amount is $' + req.minDrawAmount.toLocaleString('en-US') + '.',
      });
    }

    var invoices = Array.isArray(dr.invoices) ? dr.invoices : [];
    if (req.requiresInvoices) {
      checklist.push({
        key: 'invoices', label: 'Required invoices attached',
        met: invoices.length > 0,
        detail: invoices.length > 0 ? null : 'No invoices attached to this draw request.',
      });
    }

    var docs = (dr.attachedDocuments && typeof dr.attachedDocuments === 'object') ? dr.attachedDocuments : {};
    function _docCheck(key, label, flagKey) {
      if (!req[flagKey]) return;
      var arr = Array.isArray(docs[key]) ? docs[key] : [];
      checklist.push({
        key: key, label: label,
        met: arr.length > 0,
        detail: arr.length > 0 ? null : ('No ' + label.toLowerCase() + ' attached to this draw request.'),
      });
    }
    _docCheck('photos',             'Required photos attached',          'requiresPhotos');
    _docCheck('lienWaivers',        'Required lien waivers attached',    'requiresLienWaivers');
    _docCheck('contractorBids',     'Required contractor bids attached', 'requiresContractorBids');
    _docCheck('engineerCertification', 'Required engineer certification attached', 'requiresEngineerCertification');

    var missing = checklist.filter(function (c) { return !c.met; });
    return { pass: missing.length === 0, checklist: checklist, missing: missing };
  }

  // ── TRACK 5: Draw request status mutation ────────────────────────────────
  //
  // Pure helper backing the Draw Request Tracking status control. Mutates the
  // matched draw request in place and appends an immutable history entry.
  // Returns false (no-op) for an unrecognized status or an unknown id.
  function applyDrawStatus(drawRequests, drawRequestId, status, opts) {
    if (DRAW_STATUSES.indexOf(status) === -1) return false;
    var safeDraws = Array.isArray(drawRequests) ? drawRequests : [];
    var dr = safeDraws.filter(function (d) { return d && d.id === drawRequestId; })[0];
    if (!dr) return false;

    opts = opts || {};

    // Reject illegal lifecycle jumps (e.g. draft -> funded) unless the caller
    // explicitly forces it (used for trusted data migrations/tests only).
    if (dr.status !== status && !opts.force) {
      var allowedNext = VALID_DRAW_TRANSITIONS[dr.status] || [];
      if (allowedNext.indexOf(status) === -1) return false;
    }
    dr.status    = status;
    dr.updatedAt = opts.timestamp || new Date().toISOString();
    if (!Array.isArray(dr.statusHistory)) dr.statusHistory = [];
    dr.statusHistory.push({
      status:    status,
      timestamp: dr.updatedAt,
      note:      opts.note || null,
      actor:     opts.actor || null,
    });
    return true;
  }

  // Picks the strongest verbatim quote+page citation available on a reserve
  // (preferring current_balance, since that's the figure a lender will check
  // first) for display in the draw package and the Source Citation viewer.
  function _reserveCitation(reserve) {
    var evidence = (reserve && reserve.evidence) || {};
    var preferredFields = ['current_balance', 'reserve_type', 'eligible_uses'];
    for (var i = 0; i < preferredFields.length; i++) {
      var ev = evidence[preferredFields[i]];
      if (ev && ev.quote) {
        return {
          field: preferredFields[i],
          quote: ev.quote,
          page:  ev.page != null ? ev.page : null,
          sourceFileName: (reserve && reserve.sourceFileName) || null,
        };
      }
    }
    return null;
  }

  // ── TRACK 6: Draw submission email draft (structured data only — caller
  // decides whether to render it into a mailto: link, a copyable text box,
  // or an actual send-mail API call) ───────────────────────────────────────
  function buildDrawEmailDraft(property, reserve, drawRequest) {
    var prop = property || {};
    var dr   = drawRequest || {};
    var reserveLabel = (reserve && reserve.reserveTypeLabel) || 'Reserve';
    var propName     = prop.name || '(unnamed property)';
    var amount       = dr.amountRequested || 0;
    var amountStr    = '$' + Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    var drawLabel    = dr.drawNumber ? ('Draw Request #' + dr.drawNumber) : 'Draw Request';

    var docs = (dr.attachedDocuments && typeof dr.attachedDocuments === 'object') ? dr.attachedDocuments : {};
    var docLabels = []
      .concat((Array.isArray(dr.invoices) && dr.invoices.length) ? ['Invoice' + (dr.invoices.length > 1 ? 's' : '')] : [])
      .concat((docs.photos || []).length ? ['Photos'] : [])
      .concat((docs.lienWaivers || []).length ? ['Lien Waiver' + ((docs.lienWaivers || []).length > 1 ? 's' : '')] : [])
      .concat((docs.contractorBids || []).length ? ['Contractor Bid' + ((docs.contractorBids || []).length > 1 ? 's' : '')] : [])
      .concat((docs.engineerCertification || []).length ? ['Engineer Certification'] : []);

    var subject = reserveLabel + ' Draw Request - ' + propName;
    var bodyLines = [
      'This email is to submit ' + drawLabel,
      'for reimbursement from the ' + reserveLabel + '.',
      '',
    ];
    if (docLabels.length) {
      bodyLines.push('Supporting documentation prepared for this submission (please attach the draw package separately):');
      docLabels.forEach(function (l) { bodyLines.push('- ' + l); });
      bodyLines.push('');
    }
    bodyLines.push('Requested Amount:');
    bodyLines.push(amountStr);

    return { subject: subject, body: bodyLines.join('\n') };
  }

  // ── TRACK 4: Draw request package (structured data only — HTML formatting
  // lives in escrow-draw-packets.js, mirroring the lease-intelligence /
  // lease-review-packets split) ────────────────────────────────────────────
  function buildDrawRequestPackage(property, reserve, drawRequest, validation) {
    var prop = property || {};
    var dr   = drawRequest || {};
    var invoices = Array.isArray(dr.invoices) ? dr.invoices : [];
    var invoiceTotal = invoices.reduce(function (s, i) { return s + (parseFloat(i.amount) || 0); }, 0);
    var docs = (dr.attachedDocuments && typeof dr.attachedDocuments === 'object') ? dr.attachedDocuments : {};
    var supportingDocuments = []
      .concat((docs.photos || []).map(function (d) { return Object.assign({ category: 'Photo' }, d); }))
      .concat((docs.lienWaivers || []).map(function (d) { return Object.assign({ category: 'Lien Waiver' }, d); }))
      .concat((docs.contractorBids || []).map(function (d) { return Object.assign({ category: 'Contractor Bid' }, d); }))
      .concat((docs.engineerCertification || []).map(function (d) { return Object.assign({ category: 'Engineer Certification' }, d); }));

    return {
      generatedAt:    new Date().toISOString(),
      complete:       !!(validation && validation.pass),
      property: {
        id:   prop.id   || null,
        name: prop.name || '(unnamed property)',
        totalSqft: prop.totalSqft || prop.totalSqFt || null,
      },
      reserve: reserve ? {
        id:             reserve.id,
        type:           reserve.reserveTypeLabel,
        currentBalance: reserve.currentBalance,
        eligibleUses:   reserve.eligibleUses,
        requirements:   reserve.requirements,
        deadlines:      reserve.deadlines,
        notes:          reserve.notes,
        sourceFileName: reserve.sourceFileName || null,
        sourcePages:    Array.isArray(reserve.sourcePages) ? reserve.sourcePages : [],
        citation:       _reserveCitation(reserve),
      } : null,
      drawRequest: {
        id:              dr.id              || null,
        drawNumber:      dr.drawNumber      || null,
        amountRequested: dr.amountRequested || 0,
        status:          dr.status          || 'draft',
        notes:           dr.notes           || null,
        createdAt:       dr.createdAt       || null,
        statusHistory:   Array.isArray(dr.statusHistory) ? dr.statusHistory : [],
      },
      invoiceSummary: {
        count: invoices.length,
        total: invoiceTotal,
        invoices: invoices,
      },
      supportingDocuments: supportingDocuments,
      validationChecklist: (validation && validation.checklist) || [],
    };
  }

  var EscrowReserveEngine = {
    RESERVE_TYPES,
    RESERVE_TYPE_LABELS,
    DRAW_STATUSES,
    DRAW_STATUS_LABELS,
    COMMITTED_DRAW_STATUSES,
    VALID_DRAW_TRANSITIONS,
    getValidNextDrawStatuses,
    classifyReserveType,
    classifyInvoiceReserveType,
    deriveReserveExtractionConfidence,
    normalizeReserve,
    mergeReserveExtractions,
    computeReserveBalance,
    validateDrawRequest,
    applyDrawStatus,
    buildDrawRequestPackage,
    buildDrawEmailDraft,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = EscrowReserveEngine;
  } else {
    root.EscrowReserveEngine = EscrowReserveEngine;
  }

}(typeof window !== 'undefined' ? window : global));
