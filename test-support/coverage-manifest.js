'use strict';
/**
 * test-support/coverage-manifest.js — every test file in this repo is either
 * REGISTERED in test-regression.js or listed here with a reason.
 *
 * WHY THIS FILE EXISTS
 *
 * Two suites were found failing that nobody had noticed:
 *
 *   test-smoke-fixes.js            crashed on load — it extracted a function by
 *                                  its SIGNATURE, and the function gained an
 *                                  optional parameter. Six real assertions about
 *                                  the tenant statement's staleness guards had
 *                                  been going unevaluated ever since.
 *   test-restore-renderer-parity.js reported the product as missing a button it
 *                                  has, because the button gained a conditional
 *                                  modifier class.
 *
 * Neither was registered, so neither ran, so nobody knew. An audit of all 110
 * test files then found 74 unregistered — a bigger gap than the two.
 *
 * A test that nobody runs is not coverage; it is a note claiming coverage. The
 * guard in test-suite-registration.js fails when a test file appears that is
 * neither registered nor listed below, so the next one cannot arrive silently.
 * Adding a file here is a deliberate act with a reason attached, which is the
 * whole point: exclusions are on the record instead of being invisible.
 *
 * THE CATEGORIES
 *
 *   credentials  Needs real accounts, keys or a live database. Cannot run in a
 *                sandbox and MUST NOT be made to skip quietly — an unrun
 *                security test that reads as a pass is worse than no test.
 *                These are run deliberately against a real environment.
 *   network      Needs outbound access to a third-party network.
 *   cosmetic     Marketing site, film, audio and visual-polish contracts. Real
 *                tests, no CAM behaviour. Kept out of the reconciliation
 *                regression because ~6 minutes of film timing has no bearing on
 *                whether a tenant may be billed.
 *   stale        Currently FAILING for a known, diagnosed reason that is about
 *                the test rather than the product. Debt, recorded as debt, with
 *                the diagnosis attached so the repair does not start from
 *                scratch. Anything here is uncovered ground — read it that way.
 */

const EXCLUDED = {
  // ── credentials ───────────────────────────────────────────────────────────
  'test-tenant-authz.js': {
    reason: 'credentials',
    detail: 'Phase A tenant authorization against the real PILOT project. NOT UNRUN: it runs ' +
            'in CI on every change to the auth surface, via .github/workflows/b1-authorization.yml, ' +
            'which builds a disposable world (scripts/b1-ci-fixture.js), runs the suite and tears ' +
            'the world down. It is excluded from the offline regression only because it needs ' +
            'network and a service-role key — not because it is unverified. Latest run at the time ' +
            'of writing: 66 passed, 0 failed on head efe64c0. It exits NON-ZERO rather than ' +
            'skipping, deliberately: an unrun security test must never read as a pass.',
  },
  'test-rls-cross-user.js': {
    reason: 'credentials',
    detail: 'Cross-user row-level-security verification against a live database. Two real ' +
            'users are required to prove one cannot read the other. TARGETS PILOT BY DEFAULT ' +
            'since the retarget — it used to hard-code the production project. Needs ' +
            'USER_A_EMAIL/PASS/PROP_ID, USER_B_EMAIL/PASS and APP_URL. Run before any release ' +
            'that touches RLS policies or property ownership.',
  },
  'test-supabase-integration.js': {
    reason: 'credentials',
    detail: 'Phase 20 live Supabase write/read verification of the normalized evidence tables. ' +
            'It INSERTS via ms_debug_dualwrite(), and used to hard-code the production project — ' +
            'it now targets PILOT by default through test-support/supabase-target.js. Needs ' +
            'TEST_EMAIL, TEST_PASSWORD, TEST_PROP_ID and APP_URL.',
  },
  'test-escrow-extraction-verification.js': {
    reason: 'credentials',
    detail: 'Calls the live Anthropic API and costs real tokens. Needs ANTHROPIC_API_KEY. ' +
            'Reads the escrow system prompt out of api/_claude-tasks.js so it cannot drift ' +
            'from what the app sends.',
  },
  'test-prod-smoke.js': {
    reason: 'credentials',
    detail: '20-requirement smoke test against the deployed site. Needs a live URL and a ' +
            'real account; it is the post-deploy check, not a pre-merge one.',
  },

  // ── network ───────────────────────────────────────────────────────────────
  'test-xrpl.js': {
    reason: 'network',
    detail: 'Connects to the XRPL testnet. The OFFLINE half of XRPL coverage — issuer, ' +
            'currency code, source tag and memo payload — is test-rlusd.js, which IS ' +
            'registered and skips only the live ledger reads.',
  },
  'test-xrpl-ui.js': {
    reason: 'network',
    detail: 'Drives the RLUSD settlement UI against a live XRPL ledger read; blocked wherever outbound access to the ledger is not available.',
  },

  // ── cosmetic ──────────────────────────────────────────────────────────────
  'test-film-motion.js':      { reason: 'cosmetic', detail: 'Cinematography contract for the launch film — one continuous camera move rather than a cut sequence (139s).' },
  'test-film-on-page.js':     { reason: 'cosmetic', detail: 'The film must play IN PLACE on the marketing page rather than opening a lightbox. Currently 1 failing check.' },
  'test-film2-plates.js':     { reason: 'cosmetic', detail: 'Film 2 plate contract — asserts the still plates the second film cuts between.' },
  'test-launch-film.js':      { reason: 'cosmetic', detail: 'Launch film contract — shot order, timing and copy for the launch film (96s).' },
  'test-hero-video.js':       { reason: 'cosmetic', detail: 'Hero film integration contract — how Film 1 is embedded and autoplayed on the marketing page.' },
  'test-audio-mix.js':        { reason: 'cosmetic', detail: 'Audio mix contract — the voice stays the primary focus.' },
  'test-narration.js':        { reason: 'cosmetic', detail: 'Narration script contract — the voiceover copy and its timing against the film.' },
  'test-landing-depth.js':    { reason: 'cosmetic', detail: 'Marketing landing page depth contract — parallax layers and scroll behaviour on the public page (129s).' },
  'test-modal-layering.js':   { reason: 'cosmetic', detail: 'Modal layering and background scroll lock — a modal must sit above the page and stop it scrolling underneath.' },
  'test-e2e-phase25-visual.js': { reason: 'cosmetic', detail: 'Phase 25 visual polish pass over the workspace chrome. Currently failing; visual only, no CAM behaviour.' },

  // ── stale ─────────────────────────────────────────────────────────────────
  //
  // TEN SUITES, ONE CAUSE. Each navigates to `/` and clicks #loginBtn. The
  // marketing landing dialog (#msLanding) now covers that button, so the click
  // times out after 30s and the suite dies at its FIRST step — before touching
  // any CAM logic, which is why none of these can be reporting a reconciliation
  // regression. The product's own answer is the `?signin=1` intent that every
  // current suite uses ("someone who clicked Log in has already declared what
  // they want"). Adding the flag gets past the dialog but not to green: the
  // sign-in flow gained tabs and a focus step these suites predate, so each
  // needs its entry sequence brought forward. Measured, not assumed — one was
  // patched and re-run to find the second wall.
  'test-e2e-acquisition.js':            { reason: 'stale', detail: 'Landing dialog blocks the sign-in click, and the entry sequence predates the ?signin=1 intent. See the note above.' },
  'test-e2e-acquisition-conversion.js': { reason: 'stale', detail: 'Same landing-dialog entry-point drift as test-e2e-acquisition.js. See the note above.' },
  'test-e2e-data-persistence.js':       { reason: 'stale', detail: 'Same landing-dialog entry-point drift as test-e2e-acquisition.js. See the note above.' },
  'test-e2e-escrow-reserve.js':         { reason: 'stale', detail: 'Same landing-dialog entry-point drift; this one dies on page.check rather than page.click.' },
  'test-e2e-existing-landlord.js':      { reason: 'stale', detail: 'Same landing-dialog entry-point drift as test-e2e-acquisition.js. See the note above.' },
  'test-e2e-first-time-experience.js':  { reason: 'stale', detail: 'Same landing-dialog entry-point drift as test-e2e-acquisition.js. See the note above.' },
  'test-e2e-property-mismatch.js':      { reason: 'stale', detail: 'Same landing-dialog entry-point drift. NOTE: cross-property contamination is covered offline by test-property-confirmation.js, which IS registered.' },
  'test-e2e-reports.js':                { reason: 'stale', detail: 'Same landing-dialog entry-point drift as test-e2e-acquisition.js. See the note above.' },
  'test-e2e-tenant-dispute.js':         { reason: 'stale', detail: 'Same landing-dialog entry-point drift. NOTE: the dispute pipeline is covered by test-disputes.js and test-dispute-lifecycle.js, both registered.' },

  // Behavioural failures, diagnosed only as far as "not the landing dialog".
  // Each needs its own investigation; none is a CAM-arithmetic claim.
  'test-property-timeline.js': {
    reason: 'stale',
    detail: '142 passed, 7 failed. Property Timeline v1 assertions; not diagnosed further.',
  },
  'test-dispute-polish.js': {
    reason: 'stale',
    detail: '24 passed, 1 failed. Dispute workflow polish; not diagnosed further.',
  },
  'test-lease-ingest.js': {
    reason: 'stale',
    detail: '37 passed, 1 failed. Lease ingestion hardening; not diagnosed further.',
  },
  'test-no-silent-failures.js': {
    reason: 'stale',
    detail: '6 passed, 1 failed. Asserts that no control fails silently; the failing check is not yet diagnosed.',
  },
};

module.exports = { EXCLUDED };
