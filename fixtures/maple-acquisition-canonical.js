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
// P5-5: the episode's own dates and owner (acquisition_reviews.created_at,
// user_id) and its activity count (data.activityCount), as read on 2026-09-28.
const MAPLE_OWNER_UID   = '011df998-bad2-464e-bbcb-28e2d0fee821';
const MAPLE_REVIEW_CREATED_AT = '2026-09-17T19:14:41.715+00:00';
const MAPLE_ORGANIZATION_ID = '2aa39264-1d44-4f43-8293-20da3208face';

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
  // P5-5: the columns the loader now also asks for (PL.SELECT.reviews).
  created_at: MAPLE_REVIEW_CREATED_AT, user_id: MAPLE_OWNER_UID, activity_count: 45,
  canonical: MAPLE_CANONICAL,
};

/**
 * P5-5: Maple's two property_events rows, exactly as Pilot holds them
 * (2026-09-28). The first is the ONE real lifecycle event — written by
 * acquire_property (035) in the same transaction as acquired_at and
 * converted_at, actor = the caller, naming the review. The second is a row the
 * 030 derive trigger mirrored from the blob timeline's `sync_restored` entry:
 * `source_key` is set, the actor is whoever saved the blob, and it is NOT
 * history of the acquisition. The projection must read the first and ignore
 * the second.
 */
const MAPLE_PROPERTY_EVENTS = [
  { id: '9b9f424e-6cad-4649-8eea-c4a39ad85ec1', property_id: MAPLE_PROPERTY_ID, organization_id: MAPLE_ORGANIZATION_ID,
    actor_uid: MAPLE_OWNER_UID, actor_email: null, action: 'stage_changed', subject_type: 'property', subject_id: MAPLE_PROPERTY_ID,
    field_key: null, old_value: 'prospect', new_value: 'acquired',
    detail: { source: 'acquire_property', tenants: 5, invoices: 5, reviewId: MAPLE_REVIEW_ID, leaseholds: 5 },
    client_ts: MAPLE_CONVERTED_AT, created_at: MAPLE_CONVERTED_AT, source_key: null },
  { id: 'f7872d2f-2d32-475a-80da-071c636a9824', property_id: MAPLE_PROPERTY_ID, organization_id: MAPLE_ORGANIZATION_ID,
    actor_uid: MAPLE_OWNER_UID, actor_email: null, action: 'sync_restored', subject_type: null, subject_id: null,
    field_key: null, old_value: null, new_value: null,
    detail: { title: 'Property state restored from sync', source: 'timeline', category: '', severity: 'info', description: '', client_actor: 'System' },
    client_ts: '2026-09-27T13:40:57.128+00:00', created_at: '2026-09-27T13:40:58.17471+00:00',
    source_key: 'timeline:sync_restored:' + MAPLE_PROPERTY_ID },
];

/**
 * P5-5: the rest of Maple's stored `data.analysis`, minus `canonical` (above)
 * and `tenantSummary` (the per-leasehold resolver rows, ~9 KB, not needed to
 * draw the report). Real values, so the browser suite can open the converted
 * review through the History doorway and the report renders as it does live.
 */
const MAPLE_ANALYSIS_REPORT = {
  generatedAt: '2026-09-26T16:56:24.829Z',
  summary: { matchRate: 0, tenantCount: 5, invoiceCount: 5, recoveryRate: 100, totalExpenses: 13700, totalRecovered: 13699.99,
             openAuditWindows: 1, annualMissedRecovery: 0, capLeakageAnnualized: 0, criticalRenewalCount: 0, unusualExclusionTenants: 2 },
  rentRoll: { walt: { walt: 11.51, waltMonths: 138, weightedSqft: 74500 },
              occupancy: { vacantSqft: 0, vacancyRate: 0, buildingSqft: 77500, occupiedSqft: 77500, occupancyRate: 100 },
              rolloverRisk: { expiring12: { sqft: 0, count: 0, tenants: [], pctOfOccupied: 0 }, expiring24: { sqft: 0, count: 0, tenants: [], pctOfOccupied: 0 }, totalOccupied: 77500 },
              expirationSchedule: [{ sqft: 4500, year: 2029, count: 1, tenants: ['Prime Wellness Spa'] }, { sqft: 3000, year: 2031, count: 1, tenants: ['Luxe Nails'] }, { sqft: 67000, year: 2039, count: 1, tenants: ['ShopRite Supermarkets, Inc.'] }] },
  topRisks: [{ type: 'unusual_exclusions', label: 'Non-Standard CAM Exclusions', detail: '2 tenant(s) have unusual exclusion language', annualImpact: null }],
  findings: [
    { type: 'unusual_exclusion', label: 'Non-Standard CAM Exclusion', value: ['capital expenditures (except those reducing operating costs)', 'roof replacement'],
      citation: { text: 'The following expenses are excluded from CAM:  •   Capital expenditures (except those reducing operating costs)  •   Marketing and promotional expenses  •   Snow removal  •   Roof replacement', field: 'excluded_categories', tenantId: '8b175124-98c2-46be-a44c-34d622378e44', tenantName: 'ShopRite Supermarkets, Inc.' },
      tenantId: '8b175124-98c2-46be-a44c-34d622378e44', tenantName: 'ShopRite Supermarkets, Inc.', annualValue: null },
    { type: 'unusual_exclusion', label: 'Non-Standard CAM Exclusion', value: ['capital expenditures'],
      citation: { text: 'The following expenses are excluded from CAM:  - Snow removal  - Marketing expenses  - Capital expenditures', field: 'excluded_categories', tenantId: 'a4ded336-7195-42d1-9f90-d9f67c6d62d6', tenantName: 'Prime Wellness Spa' },
      tenantId: 'a4ded336-7195-42d1-9f90-d9f67c6d62d6', tenantName: 'Prime Wellness Spa', annualValue: null },
  ],
  gap: { total: 0, structural: 0, operational: 0, annualizedStructural: 0, annualizedOperational: 0 },
  capLeakage: { totalLeakage: 0, affectedTenants: [], annualizedTotal: 0 },
  auditWindows: [
    { tenantId: '8b175124-98c2-46be-a44c-34d622378e44', tenantName: 'ShopRite Supermarkets, Inc.', daysToExpiry: 4537, leaseEndDate: '2039-02-28', windowStatus: 'open', hasAuditRights: true },
    { tenantId: 'd1fb1d5a-aea0-4305-ad8e-82b14e9fee17', tenantName: 'Luxe Nails', daysToExpiry: 1744, leaseEndDate: '2031-07-07', windowStatus: 'none', hasAuditRights: false },
    { tenantId: 'ae6f43fd-eb1e-469f-928e-0caa706914a7', tenantName: 'Maple Coffee Co.', daysToExpiry: null, leaseEndDate: null, windowStatus: 'none', hasAuditRights: false },
    { tenantId: 'a4ded336-7195-42d1-9f90-d9f67c6d62d6', tenantName: 'Prime Wellness Spa', daysToExpiry: 885, leaseEndDate: '2029-02-28', windowStatus: 'none', hasAuditRights: false },
    { tenantId: 'c99dda4d-b477-4098-a9e3-2af250a6b8af', tenantName: 'Sunrise Cafe & Bakery LLC', daysToExpiry: null, leaseEndDate: null, windowStatus: 'none', hasAuditRights: false },
  ],
  proRataRisk: [
    { citation: null, tenantId: '8b175124-98c2-46be-a44c-34d622378e44', isUnknown: true, riskLevel: 'low', tenantName: 'ShopRite Supermarkets, Inc.', isNonStandard: false, proRataMethod: null },
    { citation: null, tenantId: 'd1fb1d5a-aea0-4305-ad8e-82b14e9fee17', isUnknown: true, riskLevel: 'low', tenantName: 'Luxe Nails', isNonStandard: false, proRataMethod: null },
    { citation: null, tenantId: 'c99dda4d-b477-4098-a9e3-2af250a6b8af', isUnknown: true, riskLevel: 'low', tenantName: 'Sunrise Cafe & Bakery LLC', isNonStandard: false, proRataMethod: null },
  ],
  underbilling: [
    { gap: 0, cause: 'exclusions', gapPct: 0, tenantId: '8b175124-98c2-46be-a44c-34d622378e44', capApplied: false, tenantName: 'ShopRite Supermarkets, Inc.', fullLiability: 11843.87, allocatedAmount: 11843.87 },
    { gap: 0, cause: 'exclusions', gapPct: 0, tenantId: 'd1fb1d5a-aea0-4305-ad8e-82b14e9fee17', capApplied: false, tenantName: 'Luxe Nails', fullLiability: 530.32, allocatedAmount: 530.32 },
    { gap: 0, cause: 'exclusions', gapPct: 0, tenantId: 'ae6f43fd-eb1e-469f-928e-0caa706914a7', capApplied: false, tenantName: 'Maple Coffee Co.', fullLiability: 530.32, allocatedAmount: 530.32 },
    { gap: 0, cause: 'exclusions', gapPct: 0, tenantId: 'a4ded336-7195-42d1-9f90-d9f67c6d62d6', capApplied: false, tenantName: 'Prime Wellness Spa', fullLiability: 795.48, allocatedAmount: 795.48 },
    { gap: 0, cause: 'none', gapPct: 0, tenantId: 'c99dda4d-b477-4098-a9e3-2af250a6b8af', capApplied: false, tenantName: 'Sunrise Cafe & Bakery LLC', fullLiability: 0, allocatedAmount: 0 },
  ],
  exclusions: [
    { tenantId: '8b175124-98c2-46be-a44c-34d622378e44', tenantName: 'ShopRite Supermarkets, Inc.', exclusionList: ['capital expenditures (except those reducing operating costs)', 'marketing and promotional expenses', 'snow removal', 'roof replacement'], unusualExclusions: ['capital expenditures (except those reducing operating costs)', 'roof replacement'], excludedInvoiceTotal: 0, hasUnusualExclusions: true },
    { tenantId: 'd1fb1d5a-aea0-4305-ad8e-82b14e9fee17', tenantName: 'Luxe Nails', exclusionList: ['snow removal'], unusualExclusions: [], excludedInvoiceTotal: 0, hasUnusualExclusions: false },
    { tenantId: 'ae6f43fd-eb1e-469f-928e-0caa706914a7', tenantName: 'Maple Coffee Co.', exclusionList: ["uncontrollable expenses (specific categories not enumerated); certain expenses at landlord's discretion"], unusualExclusions: [], excludedInvoiceTotal: 0, hasUnusualExclusions: false },
    { tenantId: 'a4ded336-7195-42d1-9f90-d9f67c6d62d6', tenantName: 'Prime Wellness Spa', exclusionList: ['snow removal', 'marketing expenses', 'capital expenditures'], unusualExclusions: ['capital expenditures'], excludedInvoiceTotal: 0, hasUnusualExclusions: true },
  ],
  renewalRisk: [],
  reconciliation: [
    { sqFt: 67000, ownTotal: 0, tenantId: '8b175124-98c2-46be-a44c-34d622378e44', leaseType: 'NNN', capApplied: false, capLeakage: 0, proRataPct: 86.45, tenantName: 'ShopRite Supermarkets, Inc.', unitNumber: '', auditRights: true, sharedTotal: 11843.87, invoiceCount: 5, leaseEndDate: '2039-02-28', fullLiability: 11843.87, renewalOptions: null, allocatedAmount: 11843.87, excludedCategories: ['capital expenditures (except those reducing operating costs)', 'marketing and promotional expenses', 'snow removal', 'roof replacement'] },
    { sqFt: 3000, ownTotal: 0, tenantId: 'd1fb1d5a-aea0-4305-ad8e-82b14e9fee17', leaseType: null, capApplied: false, capLeakage: 0, proRataPct: 3.87, tenantName: 'Luxe Nails', unitNumber: '', auditRights: null, sharedTotal: 530.32, invoiceCount: 5, leaseEndDate: '2031-07-07', fullLiability: 530.32, renewalOptions: null, allocatedAmount: 530.32, excludedCategories: ['snow removal'] },
    { sqFt: 3000, ownTotal: 0, tenantId: 'ae6f43fd-eb1e-469f-928e-0caa706914a7', leaseType: null, capApplied: false, capLeakage: 0, proRataPct: 3.87, tenantName: 'Maple Coffee Co.', unitNumber: '', auditRights: null, sharedTotal: 530.32, invoiceCount: 5, leaseEndDate: null, fullLiability: 530.32, renewalOptions: null, allocatedAmount: 530.32, excludedCategories: ["uncontrollable expenses (specific categories not enumerated); certain expenses at landlord's discretion"] },
    { sqFt: 4500, ownTotal: 0, tenantId: 'a4ded336-7195-42d1-9f90-d9f67c6d62d6', leaseType: 'NNN', capApplied: false, capLeakage: 0, proRataPct: 5.81, tenantName: 'Prime Wellness Spa', unitNumber: '', auditRights: null, sharedTotal: 795.48, invoiceCount: 5, leaseEndDate: '2029-02-28', fullLiability: 795.48, renewalOptions: null, allocatedAmount: 795.48, excludedCategories: ['snow removal', 'marketing expenses', 'capital expenditures'] },
    { sqFt: 0, ownTotal: 0, tenantId: 'c99dda4d-b477-4098-a9e3-2af250a6b8af', leaseType: null, capApplied: false, capLeakage: 0, proRataPct: 0, tenantName: 'Sunrise Cafe & Bakery LLC', unitNumber: '', auditRights: null, sharedTotal: 0, invoiceCount: 5, leaseEndDate: null, fullLiability: 0, renewalOptions: null, allocatedAmount: 0, excludedCategories: [] },
  ],
  tenantSummary: [],
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
                   MAPLE_BLOB_TENANTS, MAPLE_SUNRISE_RAW_UPLOAD,
                   // P5-5
                   MAPLE_OWNER_UID, MAPLE_REVIEW_CREATED_AT, MAPLE_ORGANIZATION_ID, MAPLE_PROPERTY_EVENTS, MAPLE_ANALYSIS_REPORT };
