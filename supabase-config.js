/**
 * supabase-config.js — Host-based Supabase routing (production vs pilot).
 * ============================================================================
 * Production and the pilot customer-validation environment MUST use SEPARATE
 * Supabase projects. This file is the single source of truth for which project
 * a page talks to, chosen purely by hostname:
 *
 *   - Production custom domain(s) in PROD_HOSTS  → PRODUCTION project
 *   - Everything else (localhost, 127.0.0.1, and every *.vercel.app preview,
 *     including the pilot branch's preview URL)  → PILOT project
 *
 * FAIL-SAFE BY DESIGN: the default is the PILOT project, never production. Only
 * an exact match against the PROD_HOSTS allowlist reaches the production
 * database — so a preview deployment can NEVER accidentally read or write
 * production data. (Config bugs fail toward pilot, the safe direction.)
 *
 * Anon keys are PUBLIC by design — row-level security enforces per-user access —
 * so it is safe to ship both here. NO service-role keys or other secrets belong
 * in this file; those live only in server-side process.env (Vercel env scopes
 * them per environment).
 *
 * Load order: after the @supabase/supabase-js CDN and BEFORE script.js (or the
 * inline init in reset-password.html), which read window.__MS_SUPABASE.
 */
(function () {
  'use strict';

  // Only these exact hosts serve the real production app to real customers.
  // Note: the production deployment's *.vercel.app alias is deliberately NOT
  // here — if you ever load production via that alias it routes to pilot, which
  // is harmless; the customer path is the custom domain below.
  var PROD_HOSTS = ['mainstreetcam.com', 'www.mainstreetcam.com'];

  // Production project (unchanged — same values the app has always shipped).
  var PROD = {
    url:     'https://zhsuhehgehbzkmzurzyf.supabase.co',
    anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inpoc3VoZWhnZWhiemttenVyenlmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4NDkwNDAsImV4cCI6MjA5MTQyNTA0MH0.HUl9ha9hhjIO1F_k8xPkqbZQnWx-ERRGbnmc6KS3lNE',
  };

  // Pilot project — the isolated customer-validation database.
  // Key is Supabase's publishable (client) key — the anon-key equivalent, safe
  // to ship; row-level security enforces per-user access.
  var PILOT = {
    url:     'https://bhmktujbxdbvdmpybmad.supabase.co',
    anonKey: 'sb_publishable__Gi3NcVbKmnhu4SfjUxLHw_QpZMYEz1',
  };

  var host   = (location.hostname || '').toLowerCase();
  var isProd = PROD_HOSTS.indexOf(host) >= 0;
  var cfg    = isProd ? PROD : PILOT;

  var unconfigured = !isProd &&
    (cfg.url.indexOf('PILOT_PROJECT_REF') >= 0 || cfg.anonKey === 'PILOT_ANON_KEY');

  window.__MS_SUPABASE = {
    url:          cfg.url,
    anonKey:      cfg.anonKey,
    target:       isProd ? 'production' : 'pilot',
    isProduction: isProd,
    unconfigured: unconfigured,
  };

  if (unconfigured) {
    // Refuse to fall back to production from a preview host. Better a visibly
    // broken (unconfigured) pilot than one that silently writes to production.
    console.error(
      '[supabase-config] Pilot Supabase project is not configured yet — refusing ' +
      'to use the production database from preview host "' + host + '". ' +
      'Fill PILOT.url / PILOT.anonKey in supabase-config.js.'
    );
  } else {
    console.log('[supabase-config] Supabase target = ' + window.__MS_SUPABASE.target + ' (host "' + host + '")');
  }
})();
