'use strict';
/**
 * fixtures/maple-plaza-acquisition.js — the Maple Plaza acquisition review as
 * the Pilot holds it (read from the Pilot database, catalog + rows, read-only,
 * 2026-09-24), for the Lease Matrix → Leasehold Detail walk.
 *
 * Four leaseholds (ShopRite — a renewal plus an amendment — Luxe Nails, Maple
 * Coffee Co., Prime Wellness Spa), the documents behind them with their
 * evidence, every decision on file (the 65,000 → 67,000 correction included),
 * and the review's raw upload rows. Nothing is invented: evidence entries whose
 * value, quote, page and confidence were all null are omitted (the resolver
 * reads an absent field and an all-null one the same way); the user id is a
 * placeholder; storage paths are placeholders.
 */
const UID = 'u1';
const REVIEW = '59af3e99-82dc-4a97-813b-21e4f956aca8';

const FAM = {
  shoprite: '8b175124-98c2-46be-a44c-34d622378e44',
  luxe:     'd1fb1d5a-aea0-4305-ad8e-82b14e9fee17',
  coffee:   'ae6f43fd-eb1e-469f-928e-0caa706914a7',
  prime:    'a4ded336-7195-42d1-9f90-d9f67c6d62d6',
};

const EV = (value, quote, page, confidence) => ({ value, quote, page, confidence });
const READ = (at, fields) => ({ schemaVersion: 1, model: 'claude-sonnet-4-6', at, fields });

const families = [
  { id: FAM.shoprite, review_id: REVIEW, user_id: UID, label: 'ShopRite Supermarkets, Inc.', family_kind: 'lease', tenant_hint: 'ShopRite Supermarkets, Inc.', created_at: '2026-09-21T20:30:00Z' },
  { id: FAM.luxe,     review_id: REVIEW, user_id: UID, label: 'Luxe Nails',                  family_kind: 'lease', tenant_hint: 'Luxe Nails',                  created_at: '2026-09-22T20:12:30Z' },
  { id: FAM.coffee,   review_id: REVIEW, user_id: UID, label: 'Maple Coffee Co.',            family_kind: 'lease', tenant_hint: 'Maple Coffee Co.',            created_at: '2026-09-23T00:02:00Z' },
  { id: FAM.prime,    review_id: REVIEW, user_id: UID, label: 'Prime Wellness Spa',          family_kind: 'lease', tenant_hint: 'Prime Wellness Spa',          created_at: '2026-09-23T02:06:40Z' },
];

const base = (o) => Object.assign({
  review_id: REVIEW, user_id: UID, intake_kind: 'lease', parsing_status: 'success', produced_kind: 'tenant',
  doc_date: null, parent_document_id: null, relationship: null, relationship_status: null,
  superseded_by_document_id: null, classification_history: [], confirmed_by: null, confirmed_at: null,
  abstracted_fields: {}, abstraction_error: null,
}, o);

const documents = [
  base({ id: '440d3294-d97d-4248-ae6e-8af6facdd8d3', intake_id: 'ik-mp-1', file_name: 'SafeShield_Insurance_Lease.pdf',
    storage_path: 'leases/u1/acq_mp_1.pdf', produced_id: '3b9f05c3-2560-4c60-8ded-cf2a4a78d2c8',
    doc_type: null, doc_type_status: 'unclassified', doc_type_source: null,
    family_id: null, family_status: 'unfiled', family_source: null, abstraction_status: 'pending',
    created_at: '2026-09-21T12:29:52Z' }),
  base({ id: 'ed5abee6-b156-4617-b412-31f7a910161a', intake_id: 'ik-mp-2', file_name: 'Prime_Wellness_Spa_Lease.pdf',
    storage_path: 'leases/u1/acq_mp_2.pdf', produced_id: 'f2797285-6653-4a82-a04a-fd39a044daae',
    doc_type: null, doc_type_status: 'unclassified', doc_type_source: null,
    family_id: null, family_status: 'unfiled', family_source: null, abstraction_status: 'pending',
    superseded_by_document_id: 'cb91e8fc-58ba-43bc-95dd-f3ceb9df93ec', created_at: '2026-09-21T12:30:54Z' }),
  base({ id: '3fc9463f-230e-424c-8bba-7dfacafd6a98', intake_id: 'ik-mp-3', file_name: 'ShopRite_Anchor_Tenant_Lease.pdf',
    storage_path: 'leases/u1/acq_mp_3.pdf', produced_id: 'b8887d2d-643d-4d30-bfb6-0f3a85ca8292',
    doc_type: 'renewal', doc_type_status: 'corrected', doc_type_source: 'human',
    family_id: FAM.shoprite, family_status: 'proposed', family_source: 'ai', abstraction_status: 'success',
    created_at: '2026-09-21T12:31:02Z',
    abstracted_fields: READ('2026-09-21T20:30:55.850Z', {
      cap:        EV(4, 'CAM increases are capped at 4% annually, excluding uncontrollable expenses.', 4, 0.95),
      suite:      EV('Anchor Unit A-1', 'Premises:   Maple Plaza, Anchor Unit A-1', 1, 0.99),
      end_date:   EV('2039-02-28', 'Lease term shall commence on March 1, 2024 and shall expire on February 28, 2039.', 2, 0.99),
      base_rent:  EV(1202500, 'Tenant agrees to pay base rent of $18.50 per square foot annually.', 3, 0.95),
      lease_type: EV('NNN', 'This lease is a Triple Net (NNN) lease.', 2, 0.99),
      start_date: EV('2024-03-01', 'Lease term shall commence on March 1, 2024 and shall expire on February 28, 2039.', 2, 0.99),
      leased_sqft: EV(65000, 'Leased Area:   65,000 rentable square feet', 1, 0.99),
      tenant_name: EV('ShopRite Supermarkets, Inc.', 'Tenant:   ShopRite Supermarkets, Inc.', 1, 0.99),
      renewal_options: EV("The initial term shall be fifteen (15) years, subject to Tenant's renewal options as set forth herein.",
        "The initial term shall be fifteen (15) years, subject to Tenant's renewal options as set forth herein.", 2, 0.4),
      excluded_categories: EV('Capital expenditures (except those reducing operating costs), Marketing and promotional expenses, Snow removal, Roof replacement',
        'The following expenses are excluded from CAM:  •   Capital expenditures (except those reducing operating costs)  •   Marketing and promotional expenses  •   Snow removal  •   Roof replacement', 4, 0.97),
    }) }),
  base({ id: 'e6a60a25-0c1f-4759-b135-7ed0bcfd67bf', intake_id: 'ik-mp-4', file_name: 'Maple_Plaza_Test_Lease_Amendment.pdf',
    storage_path: 'leases/u1/acq_mp_4.pdf', produced_id: '8ba081e2-eb19-4238-b672-7fafe6666a97',
    doc_type: 'amendment', doc_type_status: 'confirmed', doc_type_source: 'human', doc_date: '2027-01-01',
    family_id: FAM.shoprite, family_status: 'confirmed', family_source: 'human', abstraction_status: 'success',
    created_at: '2026-09-22T03:15:36Z',
    abstracted_fields: READ('2026-09-22T15:09:11.892Z', {
      cap:        EV(3, "the Tenant's controllable Common Area Maintenance expense increases shall not exceed   3% per year . Uncontrollable expenses remain outside this cap.", 1, 0.99),
      base_rent:  EV(1251250, 'the annual base rent for the Premises shall be   $19.25 per rentable square foot , payable in equal monthly installments. For purposes of this amendment, the Premises contain 65,000 rentable square feet.', 1, 0.97),
      co_tenancy: EV('Tenant shall have no co-tenancy termination right or rent-abatement right under this amendment.',
        'Tenant shall have   no co-tenancy termination right or rent-abatement right   under this amendment.', 2, 0.99),
      start_date: EV('2027-01-01', 'Effective January 1, 2027, the annual base rent for the Premises shall be', 1, 0.97),
      leased_sqft: EV(65000, 'For purposes of this amendment, the Premises contain 65,000 rentable square feet.', 1, 0.99),
      tenant_name: EV('ShopRite Supermarkets, Inc.', 'Tenant   ShopRite Supermarkets, Inc.', 1, 0.99),
      audit_rights: EV(true, 'Tenant may, upon reasonable written notice, inspect the records supporting Common Area Maintenance charges for the preceding two calendar years. The inspection shall occur during normal business hours.', 1, 0.99),
      landlord_work: EV("Landlord shall replace the rooftop HVAC control panel serving the Premises at Landlord's sole cost, substantially completed no later than March 31, 2027.",
        "Landlord shall replace the rooftop HVAC control panel serving the Premises at Landlord's sole cost, with the work to be substantially completed no later than March 31, 2027.", 2, 0.99),
      admin_fee_basis: EV('controllable_expenses', "the Tenant's controllable Common Area Maintenance expense increases shall not exceed   3% per year . Uncontrollable expenses remain outside this cap.", 1, 0.85),
      renewal_options: EV('one additional five-year renewal option following expiration of the then-current term, exercisable by written notice not less than nine months before expiration',
        'The Tenant shall have   one additional five-year renewal option   following the expiration of the then-current term. The option must be exercised by written notice delivered to Landlord not less than nine months before the expiration date.', 1, 0.99),
      expansion_rights: EV('This amendment grants Tenant no expansion right and does not reserve additional space for Tenant within Maple Plaza.',
        'This amendment grants Tenant   no expansion right   and does not reserve additional space for Tenant within Maple Plaza.', 1, 0.99),
      assignment_consent: EV("Landlord's prior written consent, which consent shall not be unreasonably withheld, conditioned, or delayed.",
        "Tenant may assign this lease or transfer its interest with Landlord's prior written consent, which consent shall not be unreasonably withheld, conditioned, or delayed.", 1, 0.99),
      termination_rights: EV('Tenant has no unilateral early termination right under this amendment, except for rights expressly stated in the underlying lease documents.',
        'Except for rights expressly stated in the underlying lease documents, Tenant has   no unilateral early termination right   under this amendment.', 3, 0.99),
      tenant_improvement_allowance: EV(250000, 'Landlord shall provide a tenant improvement allowance of   $250,000   for approved improvements to the Premises. Unused allowance expires upon expiration of the construction period.', 2, 0.99),
    }) }),
  base({ id: 'd11215d4-1035-4f73-958a-5a260fb339e7', intake_id: 'ik-mp-5', file_name: 'Luxe_Nails_Lease.pdf',
    storage_path: 'leases/u1/acq_mp_5.pdf', produced_id: '16143a75-518b-4cf4-a202-0b7407518369',
    doc_type: 'original_lease', doc_type_status: 'confirmed', doc_type_source: 'human',
    family_id: FAM.luxe, family_status: 'confirmed', family_source: 'human', abstraction_status: 'success',
    created_at: '2026-09-22T20:12:10Z',
    abstracted_fields: READ('2026-09-22T20:12:23.867Z', {
      cap:         EV(5, '5% annual cap.', null, 0.95),
      leased_sqft: EV(3000, 'Premises: 3,000 Sq Ft', null, 0.99),
      tenant_name: EV('Luxe Nails', 'Tenant: Luxe Nails', null, 0.99),
      excluded_categories: EV('Snow removal', 'Snow removal excluded from CAM.', null, 0.97),
    }) }),
  base({ id: 'cb91e8fc-58ba-43bc-95dd-f3ceb9df93ec', intake_id: 'ik-mp-6', file_name: 'Prime_Wellness_Spa_Lease.pdf',
    storage_path: 'leases/u1/acq_mp_6.pdf', produced_id: '13f08a33-c9b5-4111-b211-705dfbcb87e5',
    doc_type: null, doc_type_status: 'unclassified', doc_type_source: null,
    family_id: null, family_status: 'unfiled', family_source: null, abstraction_status: 'skipped',
    superseded_by_document_id: 'ebc3f7b1-69cc-431a-8beb-9c123b07265d', created_at: '2026-09-22T20:12:24Z' }),
  base({ id: 'c50c30e8-5c7c-43c0-91fa-378437e2d9d3', intake_id: 'ik-mp-7', file_name: 'maple_plaza_messy_lease.pdf',
    storage_path: 'leases/u1/acq_mp_7.pdf', produced_id: 'f8ba7ed1-462f-4289-817a-36b90924137e',
    doc_type: 'original_lease', doc_type_status: 'proposed', doc_type_source: 'ai', doc_date: '2024-03-01',
    family_id: FAM.coffee, family_status: 'proposed', family_source: 'ai', abstraction_status: 'success',
    created_at: '2026-09-23T00:01:18Z',
    abstracted_fields: READ('2026-09-23T00:01:57.139Z', {
      cap:         EV(5, 'CAM increases may be capped at 5% annually, excluding uncontrollable expenses.', 1, 0.85),
      suite:       EV('B-2', 'Premises: Maple Plaza, Unit B-2', 1, 0.99),
      base_rent:   EV(84000, 'Tenant agrees to pay base rent of $28.00 per square foot, subject to annual increases of 3%.', 1, 0.5),
      start_date:  EV('2024-03-01', 'Lease term shall commence on or about March 1, 2024, or upon substantial completion of landlord work (whichever is later)', 1, 0.72),
      leased_sqft: EV(3000, 'The leased premises consists of approximately 2,800 – 3,200 rentable square feet, subject to final measurement. Landlord estimates the space at ~3,000 RSF, but Tenant shall verify.', 1, 0.55),
      tenant_name: EV('Maple Coffee Co.', 'Tenant: Maple Coffee Co.', 1, 0.99),
      expense_stop: EV(0, 'Tenant shall be responsible for increases in operating expenses over the 2023 base year, if applicable. If no base year is determined, expenses may be billed on a current-year basis.', 1, 0.45),
      pro_rata_method: EV('rentable', "Tenant's share is based on leased square footage divided by total building square footage (estimated 18,000 SF).", 1, 0.7),
      excluded_categories: EV("uncontrollable expenses (specific categories not enumerated); certain expenses at landlord's discretion",
        "CAM increases may be capped at 5% annually, excluding uncontrollable expenses. Certain expenses may be excluded at landlord's discretion.", 1, 0.55),
    }) }),
  base({ id: 'ebc3f7b1-69cc-431a-8beb-9c123b07265d', intake_id: 'ik-mp-8', file_name: 'Prime_Wellness_Spa_Lease.pdf',
    storage_path: 'leases/u1/acq_mp_8.pdf', produced_id: '90a128c7-d7ee-4f56-af78-baab2c699524',
    doc_type: 'original_lease', doc_type_status: 'proposed', doc_type_source: 'ai', doc_date: '2024-03-01',
    family_id: FAM.prime, family_status: 'proposed', family_source: 'ai', abstraction_status: 'success',
    created_at: '2026-09-23T02:06:18Z',
    abstracted_fields: READ('2026-09-23T02:06:33.826Z', {
      cap:         EV(5, 'CAM increases are capped at 5% annually.', 1, 0.99),
      suite:       EV('C-1', 'Premises:   Maple Plaza, Unit C-1', 1, 0.99),
      end_date:    EV('2029-02-28', 'shall expire on February 28, 2029.', 1, 0.99),
      base_rent:   EV(144000, 'Tenant agrees to pay base rent of $32.00 per square foot annually.', 1, 0.97),
      lease_type:  EV('NNN', 'This lease is a Triple Net (NNN) lease.', 1, 0.99),
      start_date:  EV('2024-03-01', 'Lease term shall commence on March 1, 2024', 1, 0.99),
      leased_sqft: EV(4500, 'The leased premises consists of 4,500 rentable square feet.', 1, 0.99),
      tenant_name: EV('Prime Wellness Spa', 'Tenant:   Prime Wellness Spa', 1, 0.99),
      pro_rata_method: EV('rentable', 'The leased premises consists of 4,500 rentable square feet.', 1, 0.75),
      excluded_categories: EV('Snow removal, Marketing expenses, Capital expenditures',
        'The following expenses are excluded from CAM:  - Snow removal  - Marketing expenses  - Capital expenditures', 1, 0.99),
    }) }),
];

const D = (id, field_key, action, previous_value, new_value, source_document_id, source_quote, source_page, decided_at, note) => ({
  id, review_id: REVIEW, user_id: UID, family_id: FAM.shoprite, field_key, action,
  previous_value, new_value, source_document_id, source_quote, source_page,
  decided_by: UID, decided_at, created_at: decided_at, note: note || null,
});
const AMD = 'e6a60a25-0c1f-4759-b135-7ed0bcfd67bf', REN = '3fc9463f-230e-424c-8bba-7dfacafd6a98';
const Q_CAP = "the Tenant's controllable Common Area Maintenance expense increases shall not exceed   3% per year . Uncontrollable expenses remain outside this cap.";
const Q_AUDIT = 'Tenant may, upon reasonable written notice, inspect the records supporting Common Area Maintenance charges for the preceding two calendar years. The inspection shall occur during normal business hours.';
const Q_SQFT = 'For purposes of this amendment, the Premises contain 65,000 rentable square feet.';

// Every decision on file for Maple Plaza, in the order they were made.
const decisions = [
  D('b96090a0-84f5-4df0-99ca-0459b13aff6a', 'cap', 'confirm', '3', null, AMD, Q_CAP, 1, '2026-09-22T15:18:26.132Z'),
  D('7c38a344-5ad8-453b-b055-645b0fef5b05', 'cap', 'confirm', '3', null, AMD, Q_CAP, 1, '2026-09-22T15:24:59.675Z'),
  D('c33e1a4c-a174-4377-a87a-613b4cc53e36', 'audit_rights', 'confirm', 'true', null, AMD, Q_AUDIT, 1, '2026-09-22T15:25:14.317Z'),
  D('02cf28c9-45a7-48f4-aa87-320da8d9abd7', 'audit_rights', 'reopen', 'true', null, null, null, null, '2026-09-22T15:26:00.512Z'),
  D('fd40c42d-1596-4833-becc-8985be1157b4', 'audit_rights', 'reject', 'true', null, null, null, null, '2026-09-22T15:26:41.991Z'),
  D('49b94472-a9db-45a6-85c3-cc0bf6eca1ac', 'suite', 'correct', 'Anchor Unit A-1', 'Anchor Unit A-3', REN, null, null, '2026-09-22T16:35:59.898Z'),
  D('2ea3fbbd-d523-4783-8f79-e189779d0d31', 'suite', 'reopen', 'Anchor Unit A-3', null, null, null, null, '2026-09-22T20:13:13.954Z'),
  D('a035de3e-ab40-47cf-8cb0-1e0955d55283', 'suite', 'confirm', 'Anchor Unit A-1', null, REN, 'Premises:   Maple Plaza, Anchor Unit A-1', 1, '2026-09-22T20:13:17.790Z'),
  D('e0e3f2fa-97e4-47aa-8c6d-ad7ec2af8fb0', 'base_rent', 'confirm', '1251250', null, AMD,
    'the annual base rent for the Premises shall be   $19.25 per rentable square foot , payable in equal monthly installments. For purposes of this amendment, the Premises contain 65,000 rentable square feet.', 1, '2026-09-23T03:51:16.713Z'),
  D('8da2182e-383d-4db7-a4d7-eb4cc28c1acf', 'leased_sqft', 'correct', '65000', '67000', AMD, null, null, '2026-09-23T03:53:25.327Z'),
  D('c82cb927-d751-4e4a-8487-7bb593b5fc95', 'leased_sqft', 'confirm', '67000', null, AMD, Q_SQFT, null, '2026-09-23T03:53:28.212Z'),
  D('ec929724-7c05-4696-9efe-4629fe1c77f9', 'leased_sqft', 'correct', '65000', '67000', AMD, null, null, '2026-09-23T03:53:39.229Z'),
  D('ea0e474b-dc9c-4618-a8cb-b1cef7704acc', 'leased_sqft', 'confirm', '67000', null, AMD, Q_SQFT, null, '2026-09-24T01:08:24.193Z'),
  D('ac238fde-49f7-4f26-a255-6b65339161ca', 'leased_sqft', 'confirm', '65000', null, AMD, Q_SQFT, 1, '2026-09-24T01:08:34.013Z'),
  D('52276b37-1d58-4a19-a8b5-36b9e5d0dc44', 'leased_sqft', 'correct', '65000', '67000', AMD, null, null, '2026-09-24T01:55:34.691Z'),
  D('25454485-4a58-4da9-b8f2-95c24a3f3ddf', 'leased_sqft', 'confirm', '67000', null, AMD, Q_SQFT, null, '2026-09-24T01:55:37.821Z'),
  D('e4330712-239d-4948-8f3b-14da47aebce2', 'leased_sqft', 'correct', '65000', '67,000', AMD, null, null, '2026-09-24T02:16:21.119Z'),
  D('167a2389-82ab-4641-ac78-ec4b6c161aa6', 'leased_sqft', 'confirm', '67000', null, AMD, Q_SQFT, null, '2026-09-24T02:16:35.047Z'),
  D('7e67ae1b-fc28-4763-93b9-2b731520898c', 'leased_sqft', 'correct', '65000', '67000', AMD, null, null, '2026-09-24T02:16:47.705Z'),
  D('20634614-a1dd-48fb-8dd7-6ca947ba6116', 'security_deposit', 'correct', null, '50,000', null, null, null, '2026-09-24T12:42:35.855Z',
    'Entered by a person. No document on file supports it.'),
  D('9eff8b5a-c2e7-4a2d-a3d0-314507dc0de7', 'security_deposit', 'reopen', '50000', null, null, null, null, '2026-09-24T12:44:12.391Z'),
];

// review.data.tenants — the raw upload rows (name, area, file), as stored.
const T = (id, tenant_name, leased_sqft, _fileName) => ({ id, tenant_name, leased_sqft, _status: 'ok', _fileName });
const tenants = [
  T('ef57f534-9d56-4b49-a12d-ba0f6be65bf1', 'Luxe Nails', 3000, 'Luxe_Nails_Lease.pdf'),
  T('18868fa7-5a14-43df-ac36-eba092b52445', 'Sunrise Cafe & Bakery LLC', 2800, 'maple-plaza-sunrise-cafe-lease.pdf'),
  T('1f89d42e-0651-490c-b6f7-ffc091f8eb0c', 'SafeShield Security, LLC', 4500, 'messy_scanned_lease.pdf'),
  T('6bfe2b5e-c418-4248-b6d5-6888e7563dd3', 'Prime Wellness Spa', 4500, 'Prime_Wellness_Spa_Lease.pdf'),
  T('fbfa929b-5013-475c-838e-af8b03cacd44', 'Maple Coffee Co', 4000, 'Maple_Coffee_Lease.pdf'),
  T('3b9f05c3-2560-4c60-8ded-cf2a4a78d2c8', 'SafeShield Insurance', 5000, 'SafeShield_Insurance_Lease.pdf'),
  T('f2797285-6653-4a82-a04a-fd39a044daae', 'Prime Wellness Spa', 4500, 'Prime_Wellness_Spa_Lease.pdf'),
  T('b8887d2d-643d-4d30-bfb6-0f3a85ca8292', 'ShopRite Supermarkets, Inc', 65000, 'ShopRite_Anchor_Tenant_Lease.pdf'),
  T('8ba081e2-eb19-4238-b672-7fafe6666a97', 'ShopRite Supermarkets, Inc', 65000, 'Maple_Plaza_Test_Lease_Amendment.pdf'),
  T('16143a75-518b-4cf4-a202-0b7407518369', 'Luxe Nails', 3000, 'Luxe_Nails_Lease.pdf'),
  T('13f08a33-c9b5-4111-b211-705dfbcb87e5', 'Prime Wellness Spa', 4500, 'Prime_Wellness_Spa_Lease.pdf'),
  T('f8ba7ed1-462f-4289-817a-36b90924137e', 'Maple Coffee Co', 3000, 'maple_plaza_messy_lease.pdf'),
  T('90a128c7-d7ee-4f56-af78-baab2c699524', 'Prime Wellness Spa', 4500, 'Prime_Wellness_Spa_Lease.pdf'),
];

module.exports = { UID, REVIEW, FAM, families, documents, decisions, tenants };
