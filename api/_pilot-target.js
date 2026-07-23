/**
 * api/_pilot-target.js — server-side project selection (production vs pilot).
 * ============================================================================
 * Mirror of supabase-config.js on the client. Vercel automatically sets
 * VERCEL_ENV = 'production' on production deployments and 'preview' on EVERY
 * preview deployment (including the pilot branch and its pilot.* domain). We use
 * that to pick which Supabase project the serverless functions talk to:
 *
 *   - Production  → the existing production env vars (UNCHANGED byte-for-byte).
 *   - Preview     → the isolated PILOT project. URL + publishable key are safe to
 *                   embed here (RLS enforces access); the only secret that must be
 *                   supplied is PILOT_SUPABASE_SERVICE_ROLE_KEY (a Preview-scoped
 *                   Vercel env var).
 *
 * FAIL-SAFE: anything that is not explicitly VERCEL_ENV==='production' resolves
 * to pilot — a preview (or local dev) can never reach the production database.
 *
 * No production-secret handling changes: on production this reads exactly the
 * same process.env values the functions read before.
 */
'use strict';

var IS_PROD = process.env.VERCEL_ENV === 'production';

// Pilot project (publishable key — safe to ship; not a secret).
var PILOT_URL  = 'https://bhmktujbxdbvdmpybmad.supabase.co';
var PILOT_ANON = 'sb_publishable__Gi3NcVbKmnhu4SfjUxLHw_QpZMYEz1';

var target = IS_PROD ? {
  name:           'production',
  url:            (process.env.SUPABASE_URL              || '').trim(),
  anonKey:        (process.env.SUPABASE_ANON_KEY         || '').trim(),
  serviceRoleKey: (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim(),
  network:        (process.env.XRPL_NETWORK              || 'mainnet').trim(),
} : {
  name:           'pilot',
  url:            PILOT_URL,
  anonKey:        PILOT_ANON,
  serviceRoleKey: (process.env.PILOT_SUPABASE_SERVICE_ROLE_KEY || '').trim(),
  network:        (process.env.XRPL_NETWORK || 'testnet').trim(),
};

module.exports = target;
