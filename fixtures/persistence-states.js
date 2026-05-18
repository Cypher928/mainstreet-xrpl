/**
 * fixtures/persistence-states.js
 * Fixtures for Phase 4 persistence integrity tests.
 * Covers: malformed hydration, schema migration, stale-save simulation,
 *         corrupted review state, overlapping autosave.
 */
window.QAFixtures = window.QAFixtures || {};

// ── Malformed property data ───────────────────────────────────────────────────
// Simulates a partially-written or corrupted save: some tenants are null/invalid,
// some activity log entries are missing required fields, a dispute has no id.
window.QAFixtures.malformedPersisted = {
  id:   'prop-bad-001',
  name: 'Corrupted State Property',
  _schemaVersion: 0, // old schema — migration should be triggered
  tenants: [
    null,                                // null entry — should be filtered
    { not_a_tenant: true },              // invalid shape — should be filtered
    {
      id: 't-bad-001', tenant_name: 'Good Tenant',
      lease_type: 'NNN', leased_sqft: 1500,
      start_date: '2022-01-01', end_date: '2027-12-31',
      cap: 4, capBaseAmount: 10000,
      confidence: { leased_sqft: 88 },
      review: {}, reviewOverrides: {}, flags: [],
      doc_has_dates: true, doc_has_lease_type: true,
      _usedFallback: false, _needsReview: false,
    },
  ],
  disputes: [
    { status: 'open', description: 'No id — invalid' }, // missing id — should be filtered
    { id: 'disp-ok', status: 'open', description: 'Valid dispute', amount: 500 },
  ],
  activityLog: [
    { not_an_event: true },                              // missing type/timestamp — filtered
    { type: 'test_event', timestamp: '2025-11-01T10:00:00Z', title: 'Valid event' },
  ],
  invoices: [
    null,                                                // null entry — filtered
    { id: 'inv-ok', description: 'Valid invoice', amount: 5000 },
  ],
  camReconciliation: null,
  results: null,
};

// ── Sanitization fixture ──────────────────────────────────────────────────────
// Simulates imported data with NaN values, duplicate tenant IDs, invalid dates,
// and invalid review/dispute status enums.
window.QAFixtures.unsanitizedImport = {
  id:   'prop-dirty-001',
  name: 'Import Sanitization Test',
  tenants: [
    {
      id: 't-dup', tenant_name: 'Duplicate Tenant',
      lease_type: 'NNN', leased_sqft: NaN,  // NaN sqft
      start_date: 'not-a-date',              // invalid date
      end_date: '2027-12-31',
      cap: NaN,                              // NaN cap
      confidence: { leased_sqft: 150 },     // out-of-range confidence (> 100)
      review: { status: 'unknown_status' }, // invalid review status
      reviewOverrides: {}, flags: [],
    },
    {
      id: 't-dup',                           // duplicate ID — second one should be dropped
      tenant_name: 'Duplicate Tenant (copy)',
      lease_type: 'NNN', leased_sqft: 2000,
      start_date: '2022-01-01', end_date: '2027-12-31',
      cap: 3, confidence: {}, review: {}, reviewOverrides: {}, flags: [],
    },
    {
      id: 't-clean', tenant_name: 'Clean Tenant',
      lease_type: 'Gross', leased_sqft: 1200,
      start_date: '2023-06-01', end_date: '2028-05-31',
      cap: null, confidence: { leased_sqft: 90 },
      review: {}, reviewOverrides: {}, flags: [],
    },
  ],
  disputes: [
    { id: 'disp-x', status: 'invalid_status', amount: NaN, description: 'Bad status + NaN amount' },
    { id: 'disp-y', status: 'open', amount: 1500, description: 'Valid dispute' },
  ],
};
