'use strict';
/**
 * test-support/e2e-login.js — one sign-in for the browser suites.
 *
 * WHY THIS EXISTS.
 *
 * Twenty-nine suites carried their own copy of the same twelve lines, and three
 * of them have failed a full regression run on it — always at the same place:
 *
 *   page.waitForFunction: Timeout 45000ms exceeded    (waiting on #appContent)
 *   page errors: (none captured)
 *
 * test-restore-completeness, test-e2e-partial-basis-persistence and
 * test-cap-base-persistence each failed there and each passed standalone
 * immediately afterwards. The copies that click twice survived it; the copies
 * that click once did not. That is a harness weakness, not a product defect —
 * but it was costing a red regression run roughly one run in three, and a red
 * run that means nothing is worse than no run at all.
 *
 * WHAT WAS ACTUALLY WRONG WITH THE OLD COPIES — two things, both fixable here.
 *
 * 1. A SWALLOWED FIRST CLICK LEFT THE BUTTON DISABLED. submitAuth() sets
 *    `btn.disabled = true` before it awaits (script.js:218). If that attempt
 *    never resolves — a slow mock, a rejected promise — the button stays
 *    disabled for the rest of the run, so the retry click that the two-click
 *    copies rely on lands on a dead control and does nothing. Retrying is only
 *    a fix if the button is re-enabled first, and none of the copies did that.
 *
 * 2. THE FAILURE REPORTED NOTHING USEFUL. Every copy threw a bare
 *    `waitForFunction: Timeout 45000ms exceeded`, or at best listed a `pageerror`
 *    sink that was empty. Neither says what the app was doing — whether the
 *    button was disabled, whether a message was showing, whether submitAuth had
 *    even loaded. Three failures cost a full regression run each to diagnose
 *    because the evidence was gone by the time anyone looked.
 *
 * WHAT I GOT WRONG WHILE WRITING THIS, recorded because the fixture caught it
 * and the next person will otherwise repeat it: this file first claimed that
 * `pageerror` does not fire for unhandled promise rejections, and built a
 * separate window-level capture on that basis. test-e2e-login-helper.js drives
 * a page whose submitAuth throws after an await, and `pageerror` catches it
 * every time — the claim was false, asserted from memory, and the test disproved
 * it. The window listener is kept because it costs nothing and the two channels
 * are not identical, but it is NOT what makes a failure diagnosable here. The
 * state probe is. And the real flake is (1), which is mechanical and proven.
 *
 * No product code is changed by any of this. Whether something in _showApp()
 * throws between a successful authentication and the line that reveals
 * #appContent (script.js:71-75) remains unproven, and is not assumed.
 */

/**
 * Attach error capture to a page BEFORE navigating.
 *
 * Returns the array it fills, so a caller that already keeps an `errors` list
 * can keep asserting on it — same contents and same semantics as the
 * `page.on('pageerror')` line it replaces, so no existing assertion changes.
 * Pass the array back to signIn() as `errors` and a failed sign-in reports it.
 */
function attachDiagnostics(page, sink) {
  const errors = sink || [];
  // ONLY thrown exceptions go in the sink. Suites assert `errors.length === 0`
  // on it, and the app logs console errors it expects to log — folding those in
  // would turn this helper into a source of failures rather than a cure for one.
  page.on('pageerror', e => errors.push(e && e.message ? e.message : String(e)));
  // Belt and braces, and honestly labelled: `pageerror` already reports async
  // throws from the submit handler — test-e2e-login-helper.js proves it — so
  // this is not the channel that makes a failure visible. It is kept because
  // the two are not identical and it costs nothing. Registered through
  // addInitScript so it survives reloads.
  page.addInitScript(() => {
    window.__e2eRejections = [];
    window.addEventListener('unhandledrejection', ev => {
      const r = ev && ev.reason;
      window.__e2eRejections.push(String((r && (r.stack || r.message)) || r));
    });
  }).catch(() => {});
  return errors;
}

const _appVisible = () => {
  const a = document.getElementById('appContent');
  return !!(a && a.style.display !== 'none' && a.style.display !== '');
};
const _loginVisible = () => {
  const b = document.getElementById('loginBtn');
  return !!(b && b.offsetParent !== null);
};

/** Everything the app can tell us about why a sign-in did not take. */
const _probe = () => {
  const btn = document.getElementById('loginBtn');
  const msg = document.getElementById('loginMsg');
  const app = document.getElementById('appContent');
  const login = document.getElementById('loginScreen');
  return {
    buttonPresent:  !!btn,
    buttonDisabled: !!(btn && btn.disabled),
    buttonText:     btn ? (btn.textContent || '').trim() : null,
    loginMessage:   msg ? (msg.textContent || '').trim() : null,
    appDisplay:     app ? app.style.display : null,
    loginDisplay:   login ? login.style.display : null,
    submitAuthReady: typeof submitAuth === 'function',
    rejections:     (window.__e2eRejections || []).slice(0, 5),
  };
};

/**
 * Sign in, or confirm we already are.
 *
 * @param {import('playwright').Page} page
 * @param {object} opts
 *   email, password      credentials to type
 *   attempts             how many times to click Sign In (default 3)
 *   settleMs             how long one attempt may take (default 20000)
 *   readyMs              how long to wait for the form to be usable (default 45000)
 *   errors               the sink from attachDiagnostics, if the caller kept one —
 *                        its contents go into the thrown message, which is where
 *                        the cause of a failed sign-in actually shows up
 * @returns {Promise<{alreadySignedIn:boolean, attempts:number}>}
 * @throws  an Error whose message carries the app's own state and, when the
 *          sink is passed, the captured page errors — never a bare timeout.
 */
async function signIn(page, opts = {}) {
  const email    = opts.email    || 'e2e@e2e-test.local';
  const password = opts.password || 'TestPass123!';
  const attempts = opts.attempts != null ? opts.attempts : 3;
  const settleMs = opts.settleMs != null ? opts.settleMs : 20000;
  const readyMs  = opts.readyMs  != null ? opts.readyMs  : 45000;
  const sink     = Array.isArray(opts.errors) ? opts.errors : null;

  // ALREADY IN IS A SUCCESS, NOT A SPECIAL CASE. A reload inside a suite may or
  // may not need credentials depending on whether the mock kept the session;
  // making the caller branch on that is how test-cap-base-persistence grew the
  // `needsLogin` check that then timed out on its own second wait.
  await page.waitForFunction(
    () => {
      const a = document.getElementById('appContent');
      const b = document.getElementById('loginBtn');
      return (!!(a && a.style.display !== 'none' && a.style.display !== ''))
          || (!!(b && b.offsetParent !== null));
    },
    null, { timeout: readyMs });
  if (await page.evaluate(_appVisible)) return { alreadySignedIn: true, attempts: 0 };

  // The form is wired inline (`<form onsubmit="submitAuth(event)">`), so it is
  // live as soon as the element parses — but submitAuth itself lives in
  // script.js. Clicking before that has evaluated throws ReferenceError inside
  // the handler, the default submit is NOT prevented, and the page navigates
  // away instead of signing in.
  await page.waitForFunction(() => typeof submitAuth === 'function', null, { timeout: readyMs });

  let last = null;
  for (let i = 1; i <= attempts; i++) {
    // RE-ENABLE BEFORE RETRYING. submitAuth disables the button before it
    // awaits, so an attempt that never resolved leaves a dead control behind
    // and every later click is a no-op. This is the difference between a retry
    // that can work and one that only looks like it might.
    if (i > 1) {
      await page.evaluate(() => {
        const b = document.getElementById('loginBtn');
        if (b) { b.disabled = false; b.textContent = 'Sign In'; }
      });
    }
    await page.fill('#loginEmail', email);
    await page.fill('#loginPassword', password);
    // Typed, not assumed: a fill that silently missed produces the same symptom
    // as a swallowed click, and the two want different fixes.
    const typed = await page.evaluate(() => ({
      e: (document.getElementById('loginEmail')    || {}).value,
      p: !!((document.getElementById('loginPassword') || {}).value),
    }));
    if (typed.e !== email || !typed.p) {
      last = { stage: 'fill', typed };
      continue;
    }

    await page.click('#loginBtn').catch(() => {});
    try {
      await page.waitForFunction(_appVisible, null, { timeout: settleMs });
      return { alreadySignedIn: false, attempts: i };
    } catch (_) {
      last = await page.evaluate(_probe).catch(() => ({ probe: 'unavailable' }));
      // A credential rejection is not worth retrying — the app has answered.
      if (last && /invalid|incorrect|not confirmed|credentials/i.test(last.loginMessage || '')) break;
    }
  }

  const err = new Error(
    'e2e sign-in did not reach the app after ' + attempts + ' attempt(s).\n' +
    'Last observed state: ' + JSON.stringify(last, null, 2) +
    (sink && sink.length ? '\nPage errors: ' + sink.slice(0, 5).join(' | ') : '\nPage errors: (none captured)'));
  err.probe = last;
  throw err;
}

module.exports = { signIn, attachDiagnostics };
