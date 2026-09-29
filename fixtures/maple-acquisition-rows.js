'use strict';
/**
 * fixtures/maple-acquisition-rows.js — Maple plaza's acquisition rows exactly
 * as the Pilot database returns them to the P5-6B server read (read-only
 * SELECT, 2026-09-29, after migration 036), in the columns
 * PropertyLeaseholds.SELECT asks for.
 *
 *   families   5   acquisition_document_families  (FAMILY_COLUMNS)
 *   documents  8   acquisition_documents          (DOCUMENT_COLUMNS)
 *   decisions  27  acquisition_term_decisions     (DECISION_COLUMNS)
 *   review     1   acquisition_reviews, converted (MEMORY_REVIEW_COLUMNS:
 *                  REVIEW_COLUMNS + data->invoices + data->conversionRecord)
 *   events         fixtures/maple-acquisition-canonical.js MAPLE_PROPERTY_EVENTS
 *
 * Nothing is invented or normalised: ids, timestamps, quotes and notes are the
 * stored values. ROW_CHECKSUMS are the md5s tools/verify-p5-6b-live.sql
 * recomputes on Pilot from the same fields, so a transcription error cannot
 * pass unnoticed.
 */
const C = require('./maple-acquisition-canonical.js');

const P = C.MAPLE_PROPERTY_ID;
const R = C.MAPLE_REVIEW_ID;
const U = C.MAPLE_OWNER_UID;

const FAM = {
  shoprite: '8b175124-98c2-46be-a44c-34d622378e44',
  luxe:     'd1fb1d5a-aea0-4305-ad8e-82b14e9fee17',
  coffee:   'ae6f43fd-eb1e-469f-928e-0caa706914a7',
  prime:    'a4ded336-7195-42d1-9f90-d9f67c6d62d6',
  sunrise:  'c99dda4d-b477-4098-a9e3-2af250a6b8af',
};
const DOC = {
  safeshield: '440d3294-d97d-4248-ae6e-8af6facdd8d3',
  prime1:     'ed5abee6-b156-4617-b412-31f7a910161a',
  renewal:    '3fc9463f-230e-424c-8bba-7dfacafd6a98',
  amendment:  'e6a60a25-0c1f-4759-b135-7ed0bcfd67bf',
  luxe:       'd11215d4-1035-4f73-958a-5a260fb339e7',
  prime2:     'cb91e8fc-58ba-43bc-95dd-f3ceb9df93ec',
  coffee:     'c50c30e8-5c7c-43c0-91fa-378437e2d9d3',
  prime3:     'ebc3f7b1-69cc-431a-8beb-9c123b07265d',
};

const FAMILY_UPDATED_AT = '2026-09-27T03:27:53.560793+00:00';
const fam = (id, label, suite, created_at) => ({
  id, review_id: R, property_id: P, label, family_kind: 'lease', tenant_hint: label, suite_hint: suite,
  created_at, updated_at: FAMILY_UPDATED_AT,
});
const families = [
  fam(FAM.shoprite, 'ShopRite Supermarkets, Inc.', null,  '2026-09-22T15:13:23.630442+00:00'),
  fam(FAM.luxe,     'Luxe Nails',                  null,  '2026-09-22T20:12:20.114382+00:00'),
  fam(FAM.coffee,   'Maple Coffee Co.',            'B-2', '2026-09-23T00:01:44.073745+00:00'),
  fam(FAM.prime,    'Prime Wellness Spa',          'C-1', '2026-09-23T02:06:27.557119+00:00'),
  fam(FAM.sunrise,  'Sunrise Cafe & Bakery LLC',   null,  '2026-09-26T00:13:17.867541+00:00'),
];

const path = (ms, name) => 'leases/' + U + '/acq_' + R + '_' + ms + '-' + name;
const doc = (o) => Object.assign({
  review_id: R, property_id: P, user_id: U, content_type: 'application/pdf', doc_date: null,
  confirmed_by: null, confirmed_at: null, superseded_by_document_id: null,
}, o);
const documents = [
  doc({ id: DOC.safeshield, family_id: null, family_status: 'unfiled', file_name: 'SafeShield_Insurance_Lease.pdf',
        storage_path: path('1789993792724', 'SafeShield_Insurance_Lease.pdf'), byte_size: 1909,
        doc_type: null, doc_type_status: 'unclassified', created_at: '2026-09-21T12:29:52.576732+00:00' }),
  doc({ id: DOC.prime1, family_id: null, family_status: 'unfiled', file_name: 'Prime_Wellness_Spa_Lease.pdf',
        storage_path: path('1789993854128', 'Prime_Wellness_Spa_Lease.pdf'), byte_size: 3143,
        doc_type: null, doc_type_status: 'unclassified', superseded_by_document_id: DOC.prime2,
        created_at: '2026-09-21T12:30:54.0964+00:00' }),
  doc({ id: DOC.renewal, family_id: FAM.shoprite, family_status: 'confirmed', file_name: 'ShopRite_Anchor_Tenant_Lease.pdf',
        storage_path: path('1789993862550', 'ShopRite_Anchor_Tenant_Lease.pdf'), byte_size: 33098,
        doc_type: 'renewal', doc_type_status: 'corrected', confirmed_by: U, confirmed_at: '2026-09-26T00:06:07.026+00:00',
        created_at: '2026-09-21T12:31:02.458734+00:00' }),
  doc({ id: DOC.amendment, family_id: FAM.shoprite, family_status: 'confirmed', file_name: 'Maple_Plaza_Test_Lease_Amendment.pdf',
        storage_path: path('1790046937010', 'Maple_Plaza_Test_Lease_Amendment.pdf'), byte_size: 30232,
        doc_type: 'amendment', doc_type_status: 'confirmed', doc_date: '2027-01-01', confirmed_by: U,
        confirmed_at: '2026-09-22T15:14:14.571+00:00', created_at: '2026-09-22T03:15:36.926365+00:00' }),
  doc({ id: DOC.luxe, family_id: FAM.luxe, family_status: 'confirmed', file_name: 'Luxe_Nails_Lease.pdf',
        storage_path: path('1790107930768', 'Luxe_Nails_Lease.pdf'), byte_size: 1916,
        doc_type: 'original_lease', doc_type_status: 'confirmed', confirmed_by: U,
        confirmed_at: '2026-09-22T20:12:34.41+00:00', created_at: '2026-09-22T20:12:10.53528+00:00' }),
  doc({ id: DOC.prime2, family_id: null, family_status: 'unfiled', file_name: 'Prime_Wellness_Spa_Lease.pdf',
        storage_path: path('1790107944390', 'Prime_Wellness_Spa_Lease.pdf'), byte_size: 3143,
        doc_type: null, doc_type_status: 'unclassified', superseded_by_document_id: DOC.prime3,
        created_at: '2026-09-22T20:12:24.194884+00:00' }),
  doc({ id: DOC.coffee, family_id: FAM.coffee, family_status: 'confirmed', file_name: 'maple_plaza_messy_lease.pdf',
        storage_path: path('1790121678684', 'maple_plaza_messy_lease.pdf'), byte_size: 2552,
        doc_type: 'original_lease', doc_type_status: 'confirmed', doc_date: '2024-03-01', confirmed_by: U,
        confirmed_at: '2026-09-26T00:06:23.524+00:00', created_at: '2026-09-23T00:01:18.438676+00:00' }),
  doc({ id: DOC.prime3, family_id: FAM.prime, family_status: 'confirmed', file_name: 'Prime_Wellness_Spa_Lease.pdf',
        storage_path: path('1790129178788', 'Prime_Wellness_Spa_Lease.pdf'), byte_size: 3143,
        doc_type: 'original_lease', doc_type_status: 'confirmed', doc_date: '2024-03-01', confirmed_by: U,
        confirmed_at: '2026-09-26T00:06:25.276+00:00', created_at: '2026-09-23T02:06:18.561538+00:00' }),
];

const Q_CAP   = "the Tenant's controllable Common Area Maintenance expense increases shall not exceed   3% per year . Uncontrollable expenses remain outside this cap.";
const Q_AUDIT = 'Tenant may, upon reasonable written notice, inspect the records supporting Common Area Maintenance charges for the preceding two calendar years. The inspection shall occur during normal business hours.';
const Q_SUITE = 'Premises:   Maple Plaza, Anchor Unit A-1';
const Q_RENT  = 'the annual base rent for the Premises shall be   $19.25 per rentable square foot , payable in equal monthly installments. For purposes of this amendment, the Premises contain 65,000 rentable square feet.';
const Q_SQFT  = 'For purposes of this amendment, the Premises contain 65,000 rentable square feet.';
const N_ENTERED = 'Entered by a person. No document on file supports it.';

// [id, family, field, action, previous, new, sourceDoc, quote, page, decided_at, note, created_at]
const D = [
  ['b96090a0-84f5-4df0-99ca-0459b13aff6a', 'shoprite', 'cap', 'confirm', '3', null, 'amendment', Q_CAP, 1, '2026-09-22T15:18:26.132+00:00', null, '2026-09-22T15:18:26.437354+00:00'],
  ['7c38a344-5ad8-453b-b055-645b0fef5b05', 'shoprite', 'cap', 'confirm', '3', null, 'amendment', Q_CAP, 1, '2026-09-22T15:24:59.675+00:00', null, '2026-09-22T15:24:59.908599+00:00'],
  ['c33e1a4c-a174-4377-a87a-613b4cc53e36', 'shoprite', 'audit_rights', 'confirm', 'true', null, 'amendment', Q_AUDIT, 1, '2026-09-22T15:25:14.317+00:00', null, '2026-09-22T15:25:14.496901+00:00'],
  ['02cf28c9-45a7-48f4-aa87-320da8d9abd7', 'shoprite', 'audit_rights', 'reopen', 'true', null, null, null, null, '2026-09-22T15:26:00.512+00:00', null, '2026-09-22T15:26:00.898821+00:00'],
  ['fd40c42d-1596-4833-becc-8985be1157b4', 'shoprite', 'audit_rights', 'reject', 'true', null, null, null, null, '2026-09-22T15:26:41.991+00:00', null, '2026-09-22T15:26:42.23947+00:00'],
  ['49b94472-a9db-45a6-85c3-cc0bf6eca1ac', 'shoprite', 'suite', 'correct', 'Anchor Unit A-1', 'Anchor Unit A-3', 'renewal', null, null, '2026-09-22T16:35:59.898+00:00', null, '2026-09-22T16:36:00.357927+00:00'],
  ['2ea3fbbd-d523-4783-8f79-e189779d0d31', 'shoprite', 'suite', 'reopen', 'Anchor Unit A-3', null, null, null, null, '2026-09-22T20:13:13.954+00:00', null, '2026-09-22T20:13:14.059268+00:00'],
  ['a035de3e-ab40-47cf-8cb0-1e0955d55283', 'shoprite', 'suite', 'confirm', 'Anchor Unit A-1', null, 'renewal', Q_SUITE, 1, '2026-09-22T20:13:17.79+00:00', null, '2026-09-22T20:13:17.843699+00:00'],
  ['e0e3f2fa-97e4-47aa-8c6d-ad7ec2af8fb0', 'shoprite', 'base_rent', 'confirm', '1251250', null, 'amendment', Q_RENT, 1, '2026-09-23T03:51:16.713+00:00', null, '2026-09-23T03:51:16.891408+00:00'],
  ['8da2182e-383d-4db7-a4d7-eb4cc28c1acf', 'shoprite', 'leased_sqft', 'correct', '65000', '67000', 'amendment', null, null, '2026-09-23T03:53:25.327+00:00', null, '2026-09-23T03:53:25.502837+00:00'],
  ['c82cb927-d751-4e4a-8487-7bb593b5fc95', 'shoprite', 'leased_sqft', 'confirm', '67000', null, 'amendment', Q_SQFT, null, '2026-09-23T03:53:28.212+00:00', null, '2026-09-23T03:53:28.381558+00:00'],
  ['ec929724-7c05-4696-9efe-4629fe1c77f9', 'shoprite', 'leased_sqft', 'correct', '65000', '67000', 'amendment', null, null, '2026-09-23T03:53:39.229+00:00', null, '2026-09-23T03:53:39.348122+00:00'],
  ['ea0e474b-dc9c-4618-a8cb-b1cef7704acc', 'shoprite', 'leased_sqft', 'confirm', '67000', null, 'amendment', Q_SQFT, null, '2026-09-24T01:08:24.193+00:00', null, '2026-09-24T01:08:27.350723+00:00'],
  ['ac238fde-49f7-4f26-a255-6b65339161ca', 'shoprite', 'leased_sqft', 'confirm', '65000', null, 'amendment', Q_SQFT, 1, '2026-09-24T01:08:34.013+00:00', null, '2026-09-24T01:08:37.087484+00:00'],
  ['52276b37-1d58-4a19-a8b5-36b9e5d0dc44', 'shoprite', 'leased_sqft', 'correct', '65000', '67000', 'amendment', null, null, '2026-09-24T01:55:34.691+00:00', null, '2026-09-24T01:55:34.784086+00:00'],
  ['25454485-4a58-4da9-b8f2-95c24a3f3ddf', 'shoprite', 'leased_sqft', 'confirm', '67000', null, 'amendment', Q_SQFT, null, '2026-09-24T01:55:37.821+00:00', null, '2026-09-24T01:55:37.851944+00:00'],
  ['e4330712-239d-4948-8f3b-14da47aebce2', 'shoprite', 'leased_sqft', 'correct', '65000', '67,000', 'amendment', null, null, '2026-09-24T02:16:21.119+00:00', null, '2026-09-24T02:16:21.21683+00:00'],
  ['167a2389-82ab-4641-ac78-ec4b6c161aa6', 'shoprite', 'leased_sqft', 'confirm', '67000', null, 'amendment', Q_SQFT, null, '2026-09-24T02:16:35.047+00:00', null, '2026-09-24T02:16:35.163332+00:00'],
  ['7e67ae1b-fc28-4763-93b9-2b731520898c', 'shoprite', 'leased_sqft', 'correct', '65000', '67000', 'amendment', null, null, '2026-09-24T02:16:47.705+00:00', null, '2026-09-24T02:16:47.677116+00:00'],
  ['20634614-a1dd-48fb-8dd7-6ca947ba6116', 'shoprite', 'security_deposit', 'correct', null, '50,000', null, null, null, '2026-09-24T12:42:35.855+00:00', N_ENTERED, '2026-09-24T12:42:36.004639+00:00'],
  ['9eff8b5a-c2e7-4a2d-a3d0-314507dc0de7', 'shoprite', 'security_deposit', 'reopen', '50000', null, null, null, null, '2026-09-24T12:44:12.391+00:00', null, '2026-09-24T12:44:12.54699+00:00'],
  ['6f0672ba-e92a-4915-a537-6fd63bd76318', 'shoprite', 'leased_sqft', 'correct', '67000', '65000', 'amendment', null, null, '2026-09-25T23:15:46.737+00:00', null, '2026-09-25T23:15:46.836488+00:00'],
  ['5cfb3c00-fa6e-49ad-9d54-f1d793bbd654', 'shoprite', 'admin_fee_pct', 'correct', null, '10', null, null, null, '2026-09-25T23:19:59.325+00:00', N_ENTERED, '2026-09-25T23:19:59.399064+00:00'],
  ['402488ee-bc96-4742-aa6d-eb1ee03fce9a', 'luxe', 'end_date', 'correct', null, '2030-07-07', null, null, null, '2026-09-25T23:24:46.049+00:00', N_ENTERED, '2026-09-25T23:24:46.221525+00:00'],
  ['5ef4e01e-02ff-498a-b354-515b9891f4ca', 'luxe', 'end_date', 'reopen', '2030-07-07', null, null, null, null, '2026-09-25T23:28:42.313+00:00', null, '2026-09-25T23:28:42.394087+00:00'],
  ['d045e5e7-58a2-4561-9bce-26aaa6fd54ed', 'luxe', 'end_date', 'correct', null, '2031-07-07', null, null, null, '2026-09-25T23:29:00.42+00:00', N_ENTERED, '2026-09-25T23:29:00.475039+00:00'],
  ['ac6c910d-0cd8-40b4-9587-955cb4f215ec', 'shoprite', 'leased_sqft', 'correct', '65000', '67000', 'amendment', null, null, '2026-09-26T16:51:27.322+00:00', null, '2026-09-26T16:51:29.555112+00:00'],
];
const decisions = D.map(([id, f, field, action, prev, next, src, quote, page, at, note, created]) => ({
  id, review_id: R, property_id: P, family_id: FAM[f], field_key: field, action,
  previous_value: prev, new_value: next, source_document_id: src ? DOC[src] : null,
  source_quote: quote, source_page: page, decided_by: U, decided_at: at, note, created_at: created,
}));

const invoices = [
  { amount: 3200, _status: 'ok', category: 'landscaping', fileName: 'inv1-greenscape-landscaping.pdf', vendorName: 'GreenScape Lawn & Landscape', invoiceDate: '2024-01-15' },
  { amount: 6000, _status: 'ok', category: 'insurance',   fileName: 'ABC_Insurance_Group_Invoice.pdf', vendorName: 'ABC Insurance Group',         invoiceDate: '2026-01-01' },
  { amount: 2400, _status: 'ok', category: 'landscaping', fileName: 'GreenScape_LLC_Invoice.pdf',      vendorName: 'GreenScape LLC',              invoiceDate: '2026-03-01' },
  { amount: 1200, _status: 'ok', category: 'repairs',     fileName: 'FixIt_Maintenance_Invoice.pdf',   vendorName: 'FixIt Maintenance',           invoiceDate: '2026-03-10' },
  { amount: 900,  _status: 'ok', category: 'janitorial',  fileName: 'CleanCo_Invoice.pdf',             vendorName: 'CleanCo',                     invoiceDate: '2026-03-05' },
];
const conversion = {
  source: 'acquire_property', reviewId: R, propertyId: P, convertedAt: '2026-09-27T13:40:41.213Z', propertyName: 'Maple plaza',
  waltAtAcquisition: { walt: 11.51, waltMonths: 138, weightedSqft: 74500 },
  occupancyAtAcquisition: { vacantSqft: 0, vacancyRate: 0, buildingSqft: 77500, occupiedSqft: 77500, occupancyRate: 100 },
};

/** The converted review as the server's memory read returns it. */
const review = Object.assign({}, C.MAPLE_REVIEW_ROW, { invoices, conversion });

/** properties row, the columns the hydrator reads (data omitted). */
const property = {
  id: P, name: 'Maple plaza', sqft: 77500, lifecycle_stage: 'acquired',
  acquired_at: '2026-09-27T13:40:41.213071+00:00',
};

/** stage_changed rows only, as the memory read filters them. */
const events = C.MAPLE_PROPERTY_EVENTS.filter(e => e.action === 'stage_changed');

module.exports = { P, R, U, FAM, DOC, families, documents, decisions, review, invoices, conversion, property, events };
