/**
 * fixtures/auth-sessions.js
 * Raw Supabase user object fixtures for AuthService / AccessControl QA tests.
 * These objects mimic what Supabase returns from auth.getSession() / onAuthStateChange.
 * They are NOT normalized — hydrateFromSupabaseUser() should be called on them.
 */
window.QAFixtures = window.QAFixtures || {};

// Raw Supabase user objects (not normalized)
window.QAFixtures.sbLandlord = {
  id: 'u-landlord-1',
  email: 'owner@riverfront.com',
  created_at: '2024-01-15T10:00:00Z',
  user_metadata: { role: 'landlord', display_name: 'River Owner' },
};
window.QAFixtures.sbTenant = {
  id: 'u-tenant-1',
  email: 'coffee@anchor.com',
  created_at: '2024-02-01T09:00:00Z',
  user_metadata: { role: 'tenant', property_ids: ['prop-riverfront'] },
};
window.QAFixtures.sbReviewer = {
  id: 'u-reviewer-1',
  email: 'auditor@firm.com',
  created_at: '2024-01-20T08:00:00Z',
  user_metadata: { role: 'reviewer' },
};
window.QAFixtures.sbAdmin = {
  id: 'u-admin-1',
  email: 'admin@mainstreet.app',
  created_at: '2024-01-01T00:00:00Z',
  user_metadata: { role: 'admin', display_name: 'Platform Admin' },
};
window.QAFixtures.sbUnknownRole = {
  id: 'u-unknown-1',
  email: 'x@example.com',
  created_at: '2024-03-01T00:00:00Z',
  user_metadata: { role: 'superuser' }, // invalid role → normalize to landlord
};
window.QAFixtures.sbExpiredSession = null; // no user — session expired
window.QAFixtures.sbNoMetadata = {
  id: 'u-nometa-1',
  email: 'nometa@example.com',
  created_at: '2024-04-01T00:00:00Z',
  user_metadata: {}, // no role → default to landlord
};
