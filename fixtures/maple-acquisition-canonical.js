'use strict';
/**
 * fixtures/maple-acquisition-canonical.js — Maple plaza's converted review's
 * `data.analysis.canonical`, read from Pilot on 2026-09-28 (review
 * 59af3e99-82dc-4a97-813b-21e4f956aca8, converted 2026-09-27T13:40:41Z).
 *
 * The analysis ran at 2026-09-26T16:56:24.830Z — after the last decision
 * (16:51:27Z) — and the Acquire gate refuses a stale analysis, so this is the
 * record of every leasehold's term states AS ACQUIRED.
 *
 * `fingerprint` is the live value re-serialised: Postgres returned it through
 * jsonb, which normalises key order inside each object; nothing else differs
 * (live string: 8,084 chars, md5 b2c3c73264d929d50171fff2406f6916). Each entry
 * is [leaseholdId, source, AcquisitionEngine.normalizeAcqTenant(row), _states,
 * _origins] — exactly what script.js _acqCanonicalFingerprint writes.
 */
const MAPLE_REVIEW_ID   = '59af3e99-82dc-4a97-813b-21e4f956aca8';
const MAPLE_PROPERTY_ID = '3dc8a7b8-170c-4a51-b90d-dde831c56ca9';
const MAPLE_CONVERTED_AT = '2026-09-27T13:40:41.213071+00:00';

const NO_ORIGINS = () => ({
  cap: null, suite: null, end_date: null, base_rent: null, co_tenancy: null, lease_type: null, start_date: null,
  leased_sqft: null, tenant_name: null, audit_rights: null, expense_stop: null, gross_up_pct: null, admin_fee_pct: null,
  exclusive_use: null, landlord_work: null, guarantor_name: null, guaranty_limit: null, admin_fee_basis: null,
  cap_base_amount: null, pro_rata_method: null, renewal_options: null, expansion_rights: null, security_deposit: null,
  assignment_consent: null, termination_rights: null, excluded_categories: null, tenant_improvement_allowance: null,
});
const origins = (over) => Object.assign(NO_ORIGINS(), over || {});

const FINGERPRINT_ROWS = [
  ['8b175124-98c2-46be-a44c-34d622378e44', 'leasehold',
    { suite: 'Anchor Unit A-1', base_rent: 1251250, lease_end: '2039-02-28', lease_start: null, leased_sqft: 67000,
      tenant_name: 'ShopRite Supermarkets, Inc.', cam_structure: 'NNN · 3% cap · 10% admin · excl: Capital expenditures (except those reduc…',
      renewal_options: null, security_deposit: null },
    { cap: 'verified', suite: 'verified', end_date: 'ai_extracted', base_rent: 'verified', co_tenancy: 'ai_extracted',
      lease_type: 'ai_extracted', start_date: 'conflicting', leased_sqft: 'verified', tenant_name: 'ai_extracted',
      audit_rights: 'unclear', expense_stop: 'missing', gross_up_pct: 'missing', admin_fee_pct: 'verified',
      exclusive_use: 'missing', landlord_work: 'ai_extracted', guarantor_name: 'missing', guaranty_limit: 'missing',
      admin_fee_basis: 'ai_extracted', cap_base_amount: 'missing', pro_rata_method: 'missing', renewal_options: 'conflicting',
      expansion_rights: 'ai_extracted', security_deposit: 'missing', assignment_consent: 'ai_extracted',
      termination_rights: 'ai_extracted', excluded_categories: 'ai_extracted', tenant_improvement_allowance: 'ai_extracted' },
    origins({ admin_fee_pct: 'entered' })],
  ['d1fb1d5a-aea0-4305-ad8e-82b14e9fee17', 'leasehold',
    { suite: null, base_rent: null, lease_end: '2031-07-07', lease_start: null, leased_sqft: 3000, tenant_name: 'Luxe Nails',
      cam_structure: '5% cap · excl: Snow removal', renewal_options: null, security_deposit: null },
    { cap: 'ai_extracted', suite: 'missing', end_date: 'verified', base_rent: 'missing', co_tenancy: 'missing',
      lease_type: 'missing', start_date: 'missing', leased_sqft: 'ai_extracted', tenant_name: 'ai_extracted',
      audit_rights: 'missing', expense_stop: 'missing', gross_up_pct: 'missing', admin_fee_pct: 'missing',
      exclusive_use: 'missing', landlord_work: 'missing', guarantor_name: 'missing', guaranty_limit: 'missing',
      admin_fee_basis: 'missing', cap_base_amount: 'missing', pro_rata_method: 'missing', renewal_options: 'missing',
      expansion_rights: 'missing', security_deposit: 'missing', assignment_consent: 'missing', termination_rights: 'missing',
      excluded_categories: 'ai_extracted', tenant_improvement_allowance: 'missing' },
    origins({ end_date: 'entered' })],
  ['ae6f43fd-eb1e-469f-928e-0caa706914a7', 'leasehold',
    { suite: 'B-2', base_rent: 84000, lease_end: null, lease_start: '2024-03-01', leased_sqft: 3000, tenant_name: 'Maple Coffee Co.',
      cam_structure: '5% cap · excl: uncontrollable expenses (specific catego…', renewal_options: null, security_deposit: null },
    { cap: 'ai_extracted', suite: 'ai_extracted', end_date: 'missing', base_rent: 'unclear', co_tenancy: 'missing',
      lease_type: 'missing', start_date: 'ai_extracted', leased_sqft: 'ai_extracted', tenant_name: 'ai_extracted',
      audit_rights: 'missing', expense_stop: 'ai_extracted', gross_up_pct: 'missing', admin_fee_pct: 'missing',
      exclusive_use: 'missing', landlord_work: 'missing', guarantor_name: 'missing', guaranty_limit: 'missing',
      admin_fee_basis: 'missing', cap_base_amount: 'missing', pro_rata_method: 'ai_extracted', renewal_options: 'missing',
      expansion_rights: 'missing', security_deposit: 'missing', assignment_consent: 'missing', termination_rights: 'missing',
      excluded_categories: 'ai_extracted', tenant_improvement_allowance: 'missing' },
    origins()],
  ['a4ded336-7195-42d1-9f90-d9f67c6d62d6', 'leasehold',
    { suite: 'C-1', base_rent: 144000, lease_end: '2029-02-28', lease_start: '2024-03-01', leased_sqft: 4500, tenant_name: 'Prime Wellness Spa',
      cam_structure: 'NNN · 5% cap · excl: Snow removal, Marketing expenses, Capita…', renewal_options: null, security_deposit: null },
    { cap: 'ai_extracted', suite: 'ai_extracted', end_date: 'ai_extracted', base_rent: 'unclear', co_tenancy: 'missing',
      lease_type: 'ai_extracted', start_date: 'ai_extracted', leased_sqft: 'ai_extracted', tenant_name: 'ai_extracted',
      audit_rights: 'missing', expense_stop: 'missing', gross_up_pct: 'missing', admin_fee_pct: 'missing',
      exclusive_use: 'missing', landlord_work: 'missing', guarantor_name: 'missing', guaranty_limit: 'missing',
      admin_fee_basis: 'missing', cap_base_amount: 'missing', pro_rata_method: 'ai_extracted', renewal_options: 'missing',
      expansion_rights: 'missing', security_deposit: 'missing', assignment_consent: 'missing', termination_rights: 'missing',
      excluded_categories: 'ai_extracted', tenant_improvement_allowance: 'missing' },
    origins()],
  ['c99dda4d-b477-4098-a9e3-2af250a6b8af', 'leasehold',
    { suite: null, base_rent: null, lease_end: null, lease_start: null, leased_sqft: null, tenant_name: 'Sunrise Cafe & Bakery LLC',
      cam_structure: null, renewal_options: null, security_deposit: null },
    { cap: 'missing', suite: 'missing', end_date: 'missing', base_rent: 'missing', co_tenancy: 'missing', lease_type: 'missing',
      start_date: 'missing', leased_sqft: 'missing', tenant_name: 'missing', audit_rights: 'missing', expense_stop: 'missing',
      gross_up_pct: 'missing', admin_fee_pct: 'missing', exclusive_use: 'missing', landlord_work: 'missing',
      guarantor_name: 'missing', guaranty_limit: 'missing', admin_fee_basis: 'missing', cap_base_amount: 'missing',
      pro_rata_method: 'missing', renewal_options: 'missing', expansion_rights: 'missing', security_deposit: 'missing',
      assignment_consent: 'missing', termination_rights: 'missing', excluded_categories: 'missing',
      tenant_improvement_allowance: 'missing' },
    origins()],
];

/** The converted review's `data.analysis.canonical`, as stored (no `states`: it predates P5-4). */
const MAPLE_CANONICAL = {
  at: '2026-09-26T16:56:24.830Z', sqft: 77500, basis: 'leaseholds', dropped: 7, unfiled: 6, unmatched: 0,
  leaseholds: 5, resolverAvailable: true,
  fingerprint: JSON.stringify(FINGERPRINT_ROWS),
  invoices: JSON.stringify([
    [1200, 'repairs', 'FixIt Maintenance', '2026-03-10'], [2400, 'landscaping', 'GreenScape LLC', '2026-03-01'],
    [3200, 'landscaping', 'GreenScape Lawn & Landscape', '2024-01-15'], [6000, 'insurance', 'ABC Insurance Group', '2026-01-01'],
    [900, 'janitorial', 'CleanCo', '2026-03-05'],
  ].map(x => JSON.stringify(x))),
};

/** The review row as the workspace loader selects it (canonical only — never data.tenants). */
const MAPLE_REVIEW_ROW = {
  id: MAPLE_REVIEW_ID, property_id: MAPLE_PROPERTY_ID, status: 'converted', converted_at: MAPLE_CONVERTED_AT,
  canonical: MAPLE_CANONICAL,
};

/**
 * Maple's tenants as properties.data.tenants holds them today (Pilot, read
 * 2026-09-28): the CURRENT values the workspace shows. Every key as stored.
 */
const _blob = (o) => Object.assign({
  flags: [], suite: '', _error: null, _jobId: null, review: {}, vacant: false, baseYear: null, fileName: '', leaseUrl: null,
  base_rent: null, _edgeCases: null, amendments: [], confidence: {}, unitNumber: '', _needsReview: false, audit_rights: null,
  expense_stop: null, gross_up_pct: null, _exclusionAck: null, _usedFallback: false, admin_fee_pct: null, capBaseAmount: null,
  doc_has_dates: true, leaseExpected: false, property_name: null, _userConfirmed: false, admin_fee_basis: null,
  pro_rata_method: null, renewal_options: null, reviewOverrides: {}, unreadableDates: null, _propertyConfirm: null,
  extractionFailed: false, security_deposit: null, _pendingJobReview: false, doc_has_lease_type: true,
  excluded_categories: null, partial_period_basis: null, cam_commencement_date: null,
}, o);
const MAPLE_BLOB_TENANTS = [
  _blob({ id: '8b175124-98c2-46be-a44c-34d622378e44', cap: 3, end_date: '2039-02-28', lease_type: 'NNN', start_date: '', leased_sqft: 67000, tenant_name: 'ShopRite Supermarkets, Inc' }),
  _blob({ id: 'd1fb1d5a-aea0-4305-ad8e-82b14e9fee17', cap: 5, end_date: '2031-07-07', lease_type: '', start_date: '', leased_sqft: 3000, tenant_name: 'Luxe Nails' }),
  _blob({ id: 'ae6f43fd-eb1e-469f-928e-0caa706914a7', cap: 5, end_date: '', lease_type: '', start_date: '2024-03-01', leased_sqft: 3000, tenant_name: 'Maple Coffee Co' }),
  _blob({ id: 'a4ded336-7195-42d1-9f90-d9f67c6d62d6', cap: 5, end_date: '2029-02-28', lease_type: 'NNN', start_date: '2024-03-01', leased_sqft: 4500, tenant_name: 'Prime Wellness Spa' }),
  _blob({ id: 'c99dda4d-b477-4098-a9e3-2af250a6b8af', cap: null, end_date: '', lease_type: '', start_date: '', leased_sqft: 0, tenant_name: 'Sunrise Cafe & Bakery LLC' }),
];

/**
 * The raw upload row that became Sunrise's leasehold (review.data.tenants,
 * as stored). A person established a NEW leasehold from it
 * (extractionResolutions: new_leasehold) and no document was ever filed, so
 * its 2,800 sf is an unverified extraction. It is here so the tests can prove
 * it never reaches the property: not the projection, not a line, not a count.
 */
const MAPLE_SUNRISE_RAW_UPLOAD = {
  id: '18868fa7-5a14-43df-ac36-eba092b52445', tenant_name: 'Sunrise Cafe & Bakery LLC', leased_sqft: '2800',
  start_date: '', end_date: '', lease_type: 'Triple Net (NNN)', _status: 'ok',
};

module.exports = { MAPLE_REVIEW_ID, MAPLE_PROPERTY_ID, MAPLE_CONVERTED_AT, FINGERPRINT_ROWS, MAPLE_CANONICAL, MAPLE_REVIEW_ROW,
                   MAPLE_BLOB_TENANTS, MAPLE_SUNRISE_RAW_UPLOAD };
