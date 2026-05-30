/**
 * fixtures/dispute-heavy-property.js
 * "Harbor Point" — reviewer-confirmed tenant + open disputes + needs_review tenant.
 * Harbor Café: manually_verified (reviewerConfirmed=true).
 * Pier Gallery: NNN, no cap → needs_review.
 */
window.QAFixtures = window.QAFixtures || {};
window.QAFixtures.disputeHeavy = {
  id:       'prop-d-001',
  name:     'Harbor Point',
  address:  '42 Harbor Way, Seattle WA 98101',
  totalCAM: 38000,
  openDisputes: 2,

  tenants: [
    {
      id: 't-d-001', tenant_name: 'Harbor Café',
      lease_type: 'NNN', leased_sqft: 1200,
      start_date: '2022-03-01', end_date: '2027-02-28',
      cap: 3, capBaseAmount: 8000,
      confidence: { leased_sqft: 90 },
      review: {
        reviewerConfirmed: true,
        reviewedAt: '2025-11-15T14:30:00Z',
        reviewedBy: 'Jane Smith',
        notes: 'Verified against executed lease — all figures match.',
      },
      reviewOverrides: {}, flags: [],
      doc_has_dates: true, doc_has_lease_type: true,
      _usedFallback: false, _needsReview: false, _userConfirmed: false,
    },
    {
      id: 't-d-002', tenant_name: 'Pier Gallery',
      lease_type: 'NNN', leased_sqft: 2000,
      start_date: '2021-09-01', end_date: '2026-08-31',
      cap: null, capBaseAmount: null,
      confidence: { leased_sqft: 80 },
      review: {}, reviewOverrides: {}, flags: [],
      doc_has_dates: true, doc_has_lease_type: true,
      _usedFallback: false, _needsReview: false, _userConfirmed: false,
    },
  ],

  camReconciliation: {
    camYear: 2025,
    total: 38000,
    savedAt: '2025-09-20T08:00:00Z',
    results: [
      {
        tenantId: 't-d-001', name: 'Harbor Café',
        totalAllocated: 14250, proRataPercent: 37.50, proRata: 0.375,
        capApplied: false, capAdjustment: 0,
        ambiguityFlags: [], includedInvoices: [],
        averageConfidence: 90,
      },
      {
        tenantId: 't-d-002', name: 'Pier Gallery',
        totalAllocated: 23750, proRataPercent: 62.50, proRata: 0.625,
        capApplied: false, capAdjustment: 0,
        ambiguityFlags: [], includedInvoices: [],
        averageConfidence: 80,
      },
    ],
  },

  invoices: [
    { id: 'inv-d-001', description: 'HVAC Maintenance', amount: 12000, fileUrl: 'https://example.com/d1.pdf' },
    { id: 'inv-d-002', description: 'Landscaping Annual', amount: 9000, fileUrl: 'https://example.com/d2.pdf' },
    { id: 'inv-d-003', description: 'Parking Resurfacing', amount: 17000, fileUrl: 'https://example.com/d3.pdf' },
  ],

  disputes: [
    {
      id: 'disp-d-001', tenantId: 't-d-001', tenantName: 'Harbor Café',
      status: 'resolved', description: 'HVAC allocation dispute Q3',
      tenantShare: 1200,
    },
    {
      id: 'disp-d-002', tenantId: 't-d-002', tenantName: 'Pier Gallery',
      status: 'open', description: 'Landscaping invoice challenged — scope excludes rear lot',
      tenantShare: 890,
    },
    {
      id: 'disp-d-003', tenantId: 't-d-002', tenantName: 'Pier Gallery',
      status: 'open', description: 'Parking resurfacing — argues pre-existing damage clause',
      tenantShare: 3400,
    },
  ],

  activityLog: [
    { type: 'dispute_resolved', title: 'HVAC dispute resolved for Harbor Café', severity: 'success', timestamp: '2025-11-10T16:00:00Z', actor: 'Jane Smith' },
    { type: 'review_confirmed', title: 'Harbor Café lease verified', severity: 'success', timestamp: '2025-11-15T14:30:00Z', actor: 'Jane Smith' },
  ],
};
