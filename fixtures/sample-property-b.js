/**
 * fixtures/sample-property-b.js
 * "Westgate Commons" — mixed issues for reconciliation flag coverage.
 * Triggers: expired lease (red), cap applied (yellow), pro-rata gap 8% (red),
 *           gross lease receiving shared CAM (yellow).
 */
window.QAFixtures = window.QAFixtures || {};
window.QAFixtures.samplePropertyB = {
  id:       'prop-b-001',
  name:     'Westgate Commons',
  address:  '500 Westgate Blvd, Dallas TX 75201',
  totalCAM: 62000,
  openDisputes: 1,

  tenants: [
    {
      id: 't-b-001', tenant_name: 'Brix Burger',
      lease_type: 'NNN', leased_sqft: 1500,
      start_date: '2023-04-01', end_date: '2028-03-31',
      cap: null, capBaseAmount: null,
      confidence: { leased_sqft: 90 },
      review: {}, reviewOverrides: {}, flags: [],
      doc_has_dates: true, doc_has_lease_type: true,
      _usedFallback: false, _needsReview: false, _userConfirmed: false,
    },
    {
      id: 't-b-002', tenant_name: 'Clearview Optical',
      lease_type: 'Gross', leased_sqft: 800,
      start_date: '2022-01-15', end_date: '2026-01-14',
      cap: null, capBaseAmount: null,
      confidence: { leased_sqft: 91 },
      review: {}, reviewOverrides: {}, flags: [],
      doc_has_dates: true, doc_has_lease_type: true,
      _usedFallback: false, _needsReview: false, _userConfirmed: false,
    },
    {
      id: 't-b-003', tenant_name: 'SportZone Retail',
      lease_type: 'NNN', leased_sqft: 3200,
      start_date: '2019-09-01', end_date: '2024-01-01',
      cap: 6, capBaseAmount: 28000,
      confidence: { leased_sqft: 93 },
      review: {}, reviewOverrides: {}, flags: [],
      doc_has_dates: true, doc_has_lease_type: true,
      _usedFallback: false, _needsReview: false, _userConfirmed: false,
    },
  ],

  // Pro-rata sum = 28 + 15 + 49 = 92% → 8% gap → red flag
  camReconciliation: {
    camYear: 2025,
    total: 62000,
    savedAt: '2025-10-15T09:00:00Z',
    results: [
      {
        tenantId: 't-b-001', name: 'Brix Burger',
        totalAllocated: 17360, proRataPercent: 28.00, proRata: 0.2800,
        capApplied: false, capAdjustment: 0,
        ambiguityFlags: [], includedInvoices: [],
        averageConfidence: 90,
      },
      {
        tenantId: 't-b-002', name: 'Clearview Optical',
        // Gross lease getting shared CAM — triggers gross-lease flag
        totalAllocated: 9300, proRataPercent: 15.00, proRata: 0.1500,
        capApplied: false, capAdjustment: 0,
        ambiguityFlags: [],
        includedInvoices: [{ allocation: 'shared', share: 9300 }],
        averageConfidence: 91,
      },
      {
        tenantId: 't-b-003', name: 'SportZone Retail',
        // Cap applied + expired lease (end_date 2024-01-01 < 2025-12-31)
        totalAllocated: 27340, proRataPercent: 49.00, proRata: 0.4900,
        capApplied: true, capAdjustment: 2500,
        ambiguityFlags: [], includedInvoices: [],
        averageConfidence: 93,
      },
    ],
  },

  invoices: [
    { id: 'inv-b-001', description: 'Janitorial Services', amount: 18000, fileUrl: 'https://example.com/b1.pdf' },
    { id: 'inv-b-002', description: 'Snow Removal', amount: 6000 },
    { id: 'inv-b-003', description: 'Security Patrol', amount: 38000, fileUrl: 'https://example.com/b3.pdf' },
  ],

  disputes: [
    {
      id: 'disp-b-001', tenantId: 't-b-001', tenantName: 'Brix Burger',
      status: 'open', description: 'Snow removal disputed — lease excludes winter services',
      tenantShare: 1680,
    },
  ],

  activityLog: [
    { type: 'dispute_opened', title: 'Dispute opened for Brix Burger', severity: 'warning', timestamp: '2025-10-16T11:00:00Z', actor: 'Jane Smith' },
  ],
};
