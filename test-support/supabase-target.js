'use strict';
/**
 * test-support/supabase-target.js — which Supabase project a live test talks to.
 *
 * TEST-ONLY. No product code imports this, and nothing here changes how the app
 * chooses its own project — that is supabase-config.js, which this file READS.
 *
 * WHY THIS EXISTS
 *
 * Three suites verify security and persistence against a real database.
 * test-tenant-authz.js pins itself to the PILOT project and aborts if the URL is
 * anything else. The other two hard-coded the PRODUCTION project's URL and anon
 * key as plain consts:
 *
 *   test-rls-cross-user.js        reads production
 *   test-supabase-integration.js  INSERTS into production
 *                                 (tenant_field_evidence, tenant_review_audit)
 *
 * So provisioning pilot accounts would not have pointed them at pilot — they
 * would have ignored the accounts and gone to production anyway, and the second
 * one would have written test evidence rows into the customer database.
 *
 * THE RULE, AND ITS DIRECTION
 *
 * supabase-config.js already states the safe direction: "the default is the
 * PILOT project, never production... Config bugs fail toward pilot." This
 * follows the same rule for tests:
 *
 *   MS_TEST_SUPABASE_TARGET unset      → pilot
 *   MS_TEST_SUPABASE_TARGET=pilot      → pilot
 *   MS_TEST_SUPABASE_TARGET=production → REFUSED unless MS_TEST_ALLOW_PRODUCTION
 *                                        carries the exact force token
 *   anything else                      → REFUSED
 *
 * There is no fallback branch anywhere in here. An unrecognised value is a
 * refusal, not a silent default — the failure mode this exists to prevent is a
 * test quietly reaching production, and "quietly" is the part that does the
 * damage. Refusals throw; resolveOrAbort() turns that into a non-zero exit, the
 * convention test-tenant-authz.js already uses.
 *
 * THE PROJECTS ARE NOT LISTED HERE
 *
 * They are read out of supabase-config.js by running it, once per hostname
 * branch. A copy of a URL and an anon key in a test file is a copy that drifts,
 * and the drifted copy is the one nobody is looking at — which is exactly how
 * these two suites came to be pointed at production in the first place.
 */

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT = path.join(__dirname, '..');
const FORCE_TOKEN = 'i-understand-this-targets-production';

/**
 * Run the app's own config with a given hostname and return what it decided.
 * PROD_HOSTS lives in that file; passing a host in it yields the production
 * project, and any other host yields pilot — the same branch a browser takes.
 */
function _appConfigFor(hostname) {
  const src = fs.readFileSync(path.join(ROOT, 'supabase-config.js'), 'utf8');
  const sandbox = {
    window: {},
    location: { hostname },
    console: { log() {}, error() {}, warn() {} },
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  const cfg = sandbox.window.__MS_SUPABASE;
  if (!cfg || !cfg.url || !cfg.anonKey) {
    throw new Error('supabase-config.js did not produce a config for host "' + hostname + '"');
  }
  return cfg;
}

// 'localhost' is not in PROD_HOSTS, so this is the pilot branch — the same one
// every preview deployment takes.
function pilotConfig()      { return _appConfigFor('localhost'); }
// A host that IS in PROD_HOSTS. Resolved through the same file so that if the
// production allowlist ever changes, this follows it.
function productionConfig() { return _appConfigFor('mainstreetcam.com'); }

class TargetRefused extends Error {
  constructor(msg) { super(msg); this.name = 'TargetRefused'; this.refused = true; }
}

/**
 * @param {object} [env] defaults to process.env — injectable so the suite that
 *        tests this can exercise every branch without mutating the real one.
 * @returns {{name:'pilot'|'production', url:string, anonKey:string, isProduction:boolean, forced:boolean}}
 * @throws {TargetRefused}
 */
function resolveTarget(env) {
  const e = env || process.env;
  const raw = e.MS_TEST_SUPABASE_TARGET;
  const want = raw == null || String(raw).trim() === ''
    ? 'pilot'
    : String(raw).trim().toLowerCase();

  if (want === 'pilot') {
    const cfg = pilotConfig();
    // supabase-config.js sets this when the pilot project still holds
    // placeholders. Running a security test against a half-configured project
    // proves nothing, and the one thing it must not do is reach for production
    // instead.
    if (cfg.unconfigured) {
      throw new TargetRefused(
        'the PILOT project is not configured in supabase-config.js (placeholder url/anonKey). ' +
        'Refusing to run — and refusing to fall back to production.');
    }
    if (cfg.isProduction) {
      throw new TargetRefused(
        'supabase-config.js resolved the pilot branch to a PRODUCTION project. ' +
        'Refusing: the target and the label disagree.');
    }
    return { name: 'pilot', url: cfg.url, anonKey: cfg.anonKey, isProduction: false, forced: false };
  }

  if (want === 'production') {
    if (e.MS_TEST_ALLOW_PRODUCTION !== FORCE_TOKEN) {
      throw new TargetRefused(
        'MS_TEST_SUPABASE_TARGET=production requires MS_TEST_ALLOW_PRODUCTION=' + FORCE_TOKEN + '.\n' +
        '        This suite reads — and in the case of test-supabase-integration.js WRITES — ' +
        'the customer database.\n' +
        '        If you meant the customer-validation database, leave the variable unset: pilot is the default.');
    }
    const cfg = productionConfig();
    return { name: 'production', url: cfg.url, anonKey: cfg.anonKey, isProduction: true, forced: true };
  }

  throw new TargetRefused(
    'MS_TEST_SUPABASE_TARGET="' + raw + '" is not a target. Use "pilot" (or leave it unset) ' +
    'or "production". An unrecognised value is refused rather than defaulted — a test that ' +
    'guesses which database it is talking to is worse than one that will not start.');
}

/**
 * The form the suites call. Prints what was chosen — a live test should always
 * say which database it touched — and exits non-zero on refusal rather than
 * carrying on against something unintended.
 */
function resolveOrAbort(label) {
  let t;
  try {
    t = resolveTarget();
  } catch (err) {
    console.error('\nABORT' + (label ? ' [' + label + ']' : '') + ': ' + err.message);
    console.error('This suite exits non-zero rather than skipping — an unrun security test must never read as a pass.');
    process.exit(2);
  }
  const banner = t.isProduction
    ? '  \x1b[31m⚠ TARGET: PRODUCTION\x1b[0m (forced) — ' + t.url
    : '  \x1b[32mTARGET: pilot\x1b[0m — ' + t.url;
  console.log(banner);
  return t;
}

module.exports = {
  resolveTarget, resolveOrAbort, TargetRefused,
  pilotConfig, productionConfig, FORCE_TOKEN,
};
