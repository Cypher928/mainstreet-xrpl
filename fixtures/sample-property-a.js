/**
 * fixtures/sample-property-a.js
 * "Riverfront Plaza" — clean NNN property, well-formed data.
 * 3 tenants: 2 verified, 1 needs_review (NNN with no cap).
 * Pro-rata sums to 100%. No disputes. No expired leases.
 */
window.QAFixtures = window.QAFixtures || {};
window.QAFixtures.samplePropertyA = {
  id:             'prop-a-001',
  _schemaVersion: 1,
  name:     'Riverfront Plaza',
  address:  '100 River Rd, Austin TX 78701',
  totalCAM: 45000,
  openDisputes: 0,

  tenants: [
    {
      id: 't-a-001', tenant_name: 'Anchor Coffee',
      lease_type: 'NNN', leased_sqft: 2400,
      start_date: '2022-01-01', end_date: '2027-12-31',
      cap: 5, capBaseAmount: 12000,
      confidence: { leased_sqft: 95 },
      review: {}, reviewOverrides: {}, flags: [],
      doc_has_dates: true, doc_has_lease_type: true,
      _usedFallback: false, _needsReview: false, _userConfirmed: false,
    },
    {
      id: 't-a-002', tenant_name: 'Summit Fitness',
      lease_type: 'NNN', leased_sqft: 4800,
      start_date: '2021-06-01', end_date: '2026-05-31',
      cap: 4, capBaseAmount: 22000,
      confidence: { leased_sqft: 92 },
      review: {}, reviewOverrides: {}, flags: [],
      doc_has_dates: true, doc_has_lease_type: true,
      _usedFallback: false, _needsReview: false, _userConfirmed: false,
    },
    {
      id: 't-a-003', tenant_name: 'Metro Bank Branch',
      lease_type: 'NNN', leased_sqft: 1800,
      start_date: '2020-03-15', end_date: '2028-03-14',
      cap: null, capBaseAmount: null,
      confidence: { leased_sqft: 88 },
      review: {}, reviewOverrides: {}, flags: [],
      doc_has_dates: true, doc_has_lease_type: true,
      _usedFallback: false, _needsReview: false, _userConfirmed: false,
    },
  ],

  // total sqft 9000 → 26.67% + 53.33% + 20.00% = 100%
  camReconciliation: {
    camYear: 2025,
    total: 45000,
    savedAt: '2025-11-01T10:00:00Z',
    results: [
      {
        tenantId: 't-a-001', name: 'Anchor Coffee',
        totalAllocated: 12015, proRataPercent: 26.67, proRata: 0.2667,
        capApplied: false, capAdjustment: 0,
        ambiguityFlags: [], includedInvoices: [],
        averageConfidence: 95,
      },
      {
        tenantId: 't-a-002', name: 'Summit Fitness',
        totalAllocated: 23985, proRataPercent: 53.33, proRata: 0.5333,
        capApplied: false, capAdjustment: 0,
        ambiguityFlags: [], includedInvoices: [],
        averageConfidence: 92,
      },
      {
        tenantId: 't-a-003', name: 'Metro Bank Branch',
        totalAllocated: 9000, proRataPercent: 20.00, proRata: 0.2000,
        capApplied: false, capAdjustment: 0,
        ambiguityFlags: [], includedInvoices: [],
        averageConfidence: 88,
      },
    ],
  },

  invoices: [
    { id: 'inv-a-001', description: 'Landscaping Q1', amount: 8000, fileUrl: 'https://example.com/inv1.pdf' },
    { id: 'inv-a-002', description: 'Common Area Utilities', amount: 22000, fileUrl: 'https://example.com/inv2.pdf' },
    { id: 'inv-a-003', description: 'Parking Lot Maintenance', amount: 15000, fileUrl: 'https://example.com/inv3.pdf' },
  ],

  disputes: [],
  activityLog: [
    { type: 'reconciliation_run', title: 'CAM reconciliation completed', severity: 'success', timestamp: '2025-11-01T10:00:00Z', actor: 'System' },
  ],
};
