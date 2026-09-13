'use strict';
/**
 * tenant-normalize.js — the canonical shape of a tenant record.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * normalizeTenant() decides what a tenant record IS: which spellings collapse
 * into which canonical field, which dates could be read and which could not,
 * and — critically — which fields survive a save at all. It is an ALLOW-LIST:
 * a field it does not name is dropped on the next property load. That makes it
 * the most consequential pure function in the product, and it lived in the
 * middle of a 27,000-line browser file where nothing server-side could reach it.
 *
 * M1a moves it here UNCHANGED so the server-side PropertyRecord hydrator can
 * reuse the definition rather than grow a second one. Two definitions of what a
 * tenant is would diverge, and the divergence would be invisible: both sides
 * would look correct in isolation and disagree only in production.
 *
 * NOTHING HERE IS NEW. The bodies below were lifted verbatim from script.js and
 * are pinned against a frozen pre-extraction baseline of 31 cases in
 * evidence/2026-09-05-normalize-tenant-baseline.json. If a future edit changes
 * an answer, test-tenant-normalize-extraction.js fails and names the case.
 *
 * PURE, AND IT MUST STAY PURE
 * ---------------------------
 * No DOM, no localStorage, no window, no network, no clock, no randomness. It
 * does not mint identities: since the tenant-identity work, an id is created at
 * the extraction boundary by mintTenantIdentity(), never here — a record without
 * an id comes back with `id: null` so a missing identity stays visible rather
 * than being silently invented on every load.
 *
 * Loaded in the browser by index.html and required directly by Node.
 */
(function (root) {
  'use strict';
  function cleanTenantName(raw) {
    if (!raw) return '';
    return raw
      .replace(/\b[A-Z]\.\s*/g, '')   // drop "P. ", "M. " etc.
      .replace(/\s+/g, ' ')
      .replace(/^[\s,;.]+|[\s,;.]+$/g, '')
      .trim();
  }

  function toISODate(val) {
    if (!val) return '';
    const s = String(val).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const d = new Date(s);
    return isNaN(d) ? '' : d.toISOString().split('T')[0];
  }

  function extractDatesFromText(text) {
    if (!text) return {};
    const re = /\b(\d{1,2}\/\d{1,2}\/\d{2,4}|\w+\s\d{1,2},\s\d{4})\b/g;
    const matches = text.match(re) || [];
    if (matches.length < 2) return {};
    return {
      startDate:     matches[0],
      endDate:       matches[1],
      _usedFallback: true,
    };
  }

  function _dateWithRaw(input) {
    const raw = input == null ? '' : String(input).trim();
    const iso = toISODate(raw);
    return { iso, unreadable: (raw !== '' && iso === '') ? raw : null };
  }

  function normalizeTenant(d) {
    if (!d) return d;
    const fallback = extractDatesFromText(d.rawText || '');
    const _start = _dateWithRaw(d.start_date ?? d.startDate ?? d.lease_start_date ?? fallback.startDate ?? '');
    const _end   = _dateWithRaw(d.end_date   ?? d.endDate   ?? d.lease_end_date  ?? fallback.endDate   ?? '');
    const _cam   = _dateWithRaw(d.cam_commencement_date ?? d.camCommencementDate ?? '');
    // Carried forward when normalizeTenant runs over an already-normalized record,
    // which it does on every load — otherwise the second pass, seeing an empty ISO
    // field and no raw input, would erase the distinction it exists to keep.
    const _prior = (d.unreadableDates && typeof d.unreadableDates === 'object') ? d.unreadableDates : {};
    const _unreadable = {};
    for (const [k, r] of [['start_date', _start], ['end_date', _end], ['cam_commencement_date', _cam]]) {
      // A readable date clears the record of the unreadable one: once the manager
      // corrects "TBD" to a real date there is nothing left that could not be read.
      if (r.iso) continue;
      const keep = r.unreadable ?? (_prior[k] ?? null);
      if (keep) _unreadable[k] = String(keep);
    }
    return {
      tenant_name:         cleanTenantName(d.tenant_name ?? d.tenantName ?? d.name ?? ''),
      suite:               d.suite ?? d.unit ?? d.unitNumber ?? '',
      leased_sqft:         d.leased_sqft         ?? d.leasedSqft ?? d.sqft  ?? '',
      start_date:          _start.iso,
      end_date:            _end.iso,
      lease_type:          d.lease_type          ?? d.leaseType                     ?? '',
      excluded_categories: d.excluded_categories ?? d.excludedCategories            ?? null,  // F-02: null = never extracted, '' = none found
      cap:                 d.cap                 ?? d.cam_cap ?? d.capPercentage    ?? null,
      flags:               d.flags               ?? [],
      confidence:          d.confidence          ?? {},
      baseYear:            d.baseYear            ?? null,
      unitNumber:          d.unitNumber          ?? '',
      doc_has_dates:       d.doc_has_dates       ?? true,
      doc_has_lease_type:  d.doc_has_lease_type  ?? true,
      leaseUrl:            d.leaseUrl ?? d.lease_url ?? d.file_url ?? null,
      leaseExpected:       d.leaseExpected ?? !!(d.leaseUrl ?? d.lease_url ?? d.file_url),
      extractionFailed:    d.extractionFailed    ?? false,
      _needsReview:        d._needsReview        ?? false,
      _pendingJobReview:   d._pendingJobReview   ?? false,
      _userConfirmed:      d._userConfirmed      ?? false,
      _jobId:              d._jobId              ?? null,
      _usedFallback:       d._usedFallback       ?? fallback._usedFallback ?? false,
      // Preserved, never minted. See mintTenantIdentity() for why.
      id:                  d.id                  ?? null,
      fileName:            d.fileName            ?? '',
      _error:              d._error              ?? null,
      reviewOverrides:     d.reviewOverrides     ?? {},
      review:              d.review              ?? {},
      // ── State a CAM blocker depends on ─────────────────────────────────────
      //
      // This function is an allow-list, and the property blob is re-read through
      // it on every property load. These three were written to storage and then
      // silently dropped on the way back in, which is worse than never saving
      // them: the record looked complete and the behaviour was not.
      //
      // _edgeCases is computed ONCE, at extraction, and never recomputed. Losing
      // it on load meant _hasPropertyMismatch() went false, _propertyMismatchBlockReason()
      // returned null, and a lease whose document names a different property
      // silently became CAM-eligible again on the next page load — the blocker
      // evaporating in the permissive direction, with the warning gone from the
      // card too. That is the one direction a safety gate must never fail in.
      //
      // _propertyConfirm is the landlord's explicit verification. Dropping it
      // discarded a recorded human decision — who, when, against which document —
      // so the audit trail on the record disappeared even though the activity log
      // entry survived.
      //
      // _exclusionAck is the same shape for the exclusion gate. It failed the
      // safe way (the landlord was asked again) but was lost for the same reason,
      // and is restored here rather than left as a known-broken sibling.
      _edgeCases:          d._edgeCases          ?? null,
      _propertyConfirm:    d._propertyConfirm    ?? null,
      _exclusionAck:       d._exclusionAck       ?? null,
      capBaseAmount:       d.capBaseAmount       ?? null,
      fieldEvidence:       d.fieldEvidence       ?? {},
      admin_fee_pct:       d.admin_fee_pct       ?? null,
      gross_up_pct:        d.gross_up_pct        ?? null,
      expense_stop:        d.expense_stop        ?? null,
      audit_rights:        d.audit_rights        ?? null,
      pro_rata_method:     d.pro_rata_method     ?? null,
      renewal_options:     d.renewal_options     ?? null,
      // ALLOW-LIST. Omitting either of these would write them to storage and drop
      // them on the next property load — the failure this list already carries a
      // warning about, and the one that would make a lease's own partial-period
      // clause evaporate between sessions.
      cam_commencement_date: _cam.iso || null,
      // ALLOW-LIST, and the reason this one is here: without it the record of what
      // could not be read is written to storage and dropped on the next load, and
      // the field goes back to reading as simply absent.
      unreadableDates:       Object.keys(_unreadable).length ? _unreadable : null,
      partial_period_basis:  (() => {
        const v = d.partial_period_basis ?? d.partialPeriodBasis ?? null;
        const k = v == null ? '' : String(v).trim().toLowerCase();
        return k === '' ? null : k;
      })(),
      // SAME ALLOW-LIST, SAME REASON. This function is a whitelist: a field it
      // does not name is dropped on the next load, so a basis captured at
      // extraction would come back absent and LeasePeriod.adminFeeBasis would
      // report `source: 'default'` on a lease that had actually stated one. That
      // is the failure this field exists to prevent, arriving through the door
      // the field was added to close.
      admin_fee_basis:       (() => {
        const v = d.admin_fee_basis ?? d.adminFeeBasis ?? null;
        const k = v == null ? '' : String(v).trim().toLowerCase();
        return k === '' ? null : k;
      })(),
      base_rent:           d.base_rent           ?? null,
      security_deposit:    d.security_deposit    ?? null,
      amendments:          Array.isArray(d.amendments) ? d.amendments : [],
      property_name:       (() => {
        const v = d.property_name ?? d.propertyName ?? null;
        return (typeof v === 'string' && v.trim()) ? v.trim() : null;
      })(),
    };
  }

  const api = {
    normalizeTenant:      normalizeTenant,
    cleanTenantName:      cleanTenantName,
    toISODate:            toISODate,
    extractDatesFromText: extractDatesFromText,
    _dateWithRaw:         _dateWithRaw,
  };

  if (root) root.TenantNormalize = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

})(typeof window !== 'undefined' ? window : null);
