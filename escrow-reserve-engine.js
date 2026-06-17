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
    denied:        'Denied',
  };
  // Statuses that represent a claim against the reserve balance — used by
  // computeReserveBalance to compute what is "committed" vs truly available.
  var COMMITTED_DRAW_STATUSES = ['submitted', 'under_review', 'approved', 'funded'];

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

    return {
      id:               meta.id || ('reserve-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8)),
      reserveType:       reserveTypeKey,
      reserveTypeLabel:  reserveTypeKey === 'other' && raw.reserve_name
        ? String(raw.reserve_name).slice(0, 80)
        : RESERVE_TYPE_LABELS[reserveTypeKey],
      sourceFileName:    meta.sourceFileName || raw.sourceFileName || null,
      sourceFileUrl:      meta.sourceFileUrl  || raw.sourceFileUrl  || null,
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
      notes:        raw.notes ? String(raw.notes).slice(0, 1000) : null,
      quotes:       (raw.quotes && typeof raw.quotes === 'object') ? raw.quotes : {},
      extractedAt:  meta.extractedAt || new Date().toISOString(),
    };
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
      } : null,
      drawRequest: {
        id:              dr.id              || null,
        amountRequested: dr.amountRequested || 0,
        status:          dr.status          || 'draft',
        notes:           dr.notes           || null,
        createdAt:       dr.createdAt       || null,
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
    classifyReserveType,
    normalizeReserve,
    computeReserveBalance,
    validateDrawRequest,
    applyDrawStatus,
    buildDrawRequestPackage,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = EscrowReserveEngine;
  } else {
    root.EscrowReserveEngine = EscrowReserveEngine;
  }

}(typeof window !== 'undefined' ? window : global));
