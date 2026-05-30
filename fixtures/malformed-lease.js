/**
 * fixtures/malformed-lease.js
 * "Glitch Tower" — extraction failure edge cases.
 * Tenant A: extractionFailed, no data → incomplete.
 * Tenant B: _usedFallback, low sqft confidence, NNN no cap → needs_review.
 */
window.QAFixtures = window.QAFixtures || {};
window.QAFixtures.malformedLease = {
  id:       'prop-m-001',
  name:     'Glitch Tower',
  address:  '9 Error Lane, Phoenix AZ 85001',
  totalCAM: 0,
  openDisputes: 0,

  tenants: [
    {
      id: 't-m-001', tenant_name: 'Unknown Tenant A',
      lease_type: null, leased_sqft: null,
      start_date: null, end_date: null,
      cap: null, capBaseAmount: null,
      confidence: {},
      review: {}, reviewOverrides: {}, flags: [],
      doc_has_dates: false, doc_has_lease_type: false,
      extractionFailed: true, _usedFallback: false,
      _needsReview: false, _userConfirmed: false,
    },
    {
      id: 't-m-002', tenant_name: 'Fallback Inc.',
      lease_type: 'NNN', leased_sqft: 2200,
      start_date: '2023-01-01', end_date: '2028-12-31',
      cap: null, capBaseAmount: null,
      confidence: { leased_sqft: 55 },
      review: {}, reviewOverrides: {}, flags: ['approx_sqft_detected'],
      doc_has_dates: true, doc_has_lease_type: true,
      extractionFailed: false, _usedFallback: true,
      _needsReview: false, _userConfirmed: false,
    },
  ],

  camReconciliation: null,
  invoices: [],
  disputes: [],
  activityLog: [],
};
