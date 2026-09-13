'use strict';
/**
 * test-e2e-login-helper.js — the shared sign-in helper, against a broken app.
 *
 *   node test-e2e-login-helper.js
 *
 * test-support/e2e-login.js exists because three suites failed a full
 * regression on the same wait and each passed standalone straight afterwards.
 * A helper that only ever runs against a working app proves nothing about that:
 * the happy path passed before too. So this drives it against pages built to
 * fail in the two specific ways the old copies could not survive or explain.
 *
 *   1. A SWALLOWED FIRST CLICK THAT LEAVES THE BUTTON DISABLED.
 *      submitAuth() sets `btn.disabled = true` before it awaits
 *      (script.js:218). If that attempt never resolves, every later click lands
 *      on a dead control — so the two-click retry the surviving copies relied on
 *      could not have worked either. The helper re-enables before retrying; this
 *      asserts that it recovers, and the mutation that removes the re-enable
 *      turns this case red.
 *
 *   2. A FAILURE THE OLD COPIES COULD NOT EXPLAIN.
 *      The old copies threw a bare timeout, or listed an empty `pageerror`
 *      sink, and said nothing about what the app was doing. This asserts the
 *      helper's error carries the app's own state — button disabled, login
 *      message, display values — and the captured page errors.
 *
 *      IT ALSO CORRECTS A CLAIM I MADE. The helper was first written asserting
 *      that `pageerror` does not fire for unhandled promise rejections. The
 *      'always-reject' case below drives exactly that and `pageerror` catches it
 *      every time. The claim was false and this fixture is what disproved it.
 *
 * These pages are deliberately NOT the product. The point is the helper's
 * behaviour in the presence of a failure, and a fixture that fails on demand is
 * the only way to test that without waiting for the flake to recur.
 */
process.env.TZ = 'America/New_York';

const SKIP = process.env.SKIP_BROWSER_TESTS === '1';
let pw = null;
if (!SKIP) {
  try { pw = require('playwright'); }
  catch (_) {
    try { pw = require('/opt/node22/lib/node_modules/playwright'); }
    catch (_2) {
      console.error('\n\x1b[31mtest-e2e-login-helper: playwright is not installed.\x1b[0m\n');
      process.exit(1);
    }
  }
}
if (SKIP) {
  console.log('\n\x1b[33m⚠ test-e2e-login-helper SKIPPED (SKIP_BROWSER_TESTS=1).\x1b[0m');
  console.log('  Whether the shared sign-in recovers from a swallowed click was NOT verified.\n');
  process.exit(0);
}
const { chromium } = pw;

const http = require('http');
const { signIn, attachDiagnostics } = require('./test-support/e2e-login');

const PORT     = parseInt(process.env.APP_PORT || '7999', 10);
const HEADLESS = process.env.HEADLESS !== '0';
const CHROME   = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

let pass = 0, fail = 0;
const ok  = (m) => { console.log('  \x1b[32m✓\x1b[0m ' + m); pass++; };
const bad = (m, d) => { console.log('  \x1b[31m✗\x1b[0m ' + m + (d ? '\n      → ' + d : '')); fail++; };
const yes = (m, c, d) => c ? ok(m) : bad(m, d);
const R   = (l, v) => console.log('  ' + String(l).padEnd(38) + ':', typeof v === 'string' ? v : JSON.stringify(v));
const H   = (t) => console.log('\n\x1b[36m── ' + t + ' ──\x1b[0m');

// A minimal stand-in with the product's shape: a form wired inline to
// submitAuth, a #loginBtn, a #loginMsg, a #loginScreen and a #appContent whose
// style.display is what "signed in" means. `mode` decides how it misbehaves.
const PAGE = (mode) => `<!DOCTYPE html><html><body>
<div id="loginScreen" style="display:flex">
  <form id="loginForm" onsubmit="submitAuth(event)">
    <input id="loginEmail"><input id="loginPassword" type="password">
    <button type="submit" id="loginBtn">Sign In</button>
  </form>
  <div id="loginMsg"></div>
</div>
<div id="appContent" style="display:none">signed in</div>
<script>
  var attempt = 0;
  function _showApp() {
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('appContent').style.display  = 'block';
  }
  async function submitAuth(ev) {
    if (ev) ev.preventDefault();
    var btn = document.getElementById('loginBtn');
    attempt++;
    // The product disables before awaiting. Reproduced exactly, because it is
    // the reason a naive retry cannot work.
    btn.disabled = true; btn.textContent = 'Signing in…';
    var mode = ${JSON.stringify(mode)};
    if (mode === 'swallow-first' && attempt === 1) {
      // Never resolves. The button stays disabled and nothing reveals the app —
      // the exact shape of the observed failure.
      return new Promise(function () {});
    }
    if (mode === 'always-reject') {
      // An async failure on the channel pageerror does not report.
      await Promise.resolve();
      throw new Error('boom inside _showApp');
    }
    if (mode === 'bad-credentials') {
      document.getElementById('loginMsg').textContent = 'Invalid login credentials';
      btn.disabled = false; btn.textContent = 'Sign In';
      return;
    }
    await Promise.resolve();
    _showApp();
  }
  window.__attempts = function () { return attempt; };
</script></body></html>`;

let MODE = 'ok';
function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(PAGE(MODE));
    });
    server.listen(PORT, '127.0.0.1', () => resolve(server));
  });
}

async function run(browser, mode) {
  MODE = mode;
  const ctx  = await browser.newContext();
  const page = await ctx.newPage();
  const errors = attachDiagnostics(page);
  await page.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'domcontentloaded', timeout: 20000 });
  let result = null, thrown = null;
  try { result = await signIn(page, { email: 'h@e2e-test.local', settleMs: 2500, readyMs: 8000, errors }); }
  catch (e) { thrown = e; }
  const attempts = await page.evaluate(() => window.__attempts()).catch(() => null);
  await ctx.close();
  return { result, thrown, attempts, errors };
}

(async () => {
  const server  = await startServer();
  const browser = await chromium.launch({ headless: HEADLESS, executablePath: CHROME,
    args: ['--no-sandbox', '--disable-setuid-sandbox'] });

  console.log('\n══ The shared e2e sign-in, against an app that misbehaves ══');
  try {
    H('A working app still signs in, in one click');
    const good = await run(browser, 'ok');
    R('result', good.result);
    yes('signs in', !!good.result && good.result.alreadySignedIn === false, String(good.thrown));
    yes('    on the first attempt — no gratuitous retry',
        good.result && good.result.attempts === 1, JSON.stringify(good.result));

    H('A swallowed first click, with the button left disabled');
    const swallowed = await run(browser, 'swallow-first');
    R('result', swallowed.result);
    R('submitAuth invocations', swallowed.attempts);
    yes('THE HELPER RECOVERS — this is the flake',
        !!swallowed.result && swallowed.result.alreadySignedIn === false,
        swallowed.thrown ? swallowed.thrown.message : 'no result');
    yes('    it took a second attempt to do it',
        swallowed.result && swallowed.result.attempts === 2, JSON.stringify(swallowed.result));
    yes('    and the retry actually re-entered submitAuth',
        swallowed.attempts === 2,
        'submitAuth ran ' + swallowed.attempts + ' time(s) — a click on a disabled button runs it 1');

    H('A failure the old copies could not explain');
    const rejected = await run(browser, 'always-reject');
    R('pageerror sink', rejected.errors);
    R('thrown message', rejected.thrown && rejected.thrown.message.split('\n')[0]);
    yes('the helper fails rather than hanging', !!rejected.thrown, 'no error thrown');
    // CORRECTED BY THIS FIXTURE. The helper was first written claiming
    // `pageerror` does not fire for unhandled rejections. It does — every time,
    // here. The assertion now pins the true behaviour, so the false one cannot
    // be reintroduced on the strength of somebody's memory.
    yes('    pageerror DOES report an async throw from the submit handler',
        rejected.errors.some(e => /boom inside _showApp/.test(e)),
        JSON.stringify(rejected.errors));
    yes('    and the thrown error carries it, because the sink was passed in',
        !!rejected.thrown && /boom inside _showApp/.test(rejected.thrown.message),
        rejected.thrown && rejected.thrown.message);
    yes('    and it reports the app state instead of a bare timeout',
        !!rejected.thrown && /buttonDisabled|loginMessage|appDisplay/.test(rejected.thrown.message),
        rejected.thrown && rejected.thrown.message);

    H('A refused credential is not retried');
    const badcreds = await run(browser, 'bad-credentials');
    R('submitAuth invocations', badcreds.attempts);
    R('thrown message', badcreds.thrown && badcreds.thrown.message.split('\n')[0]);
    yes('it gives up rather than hammering a rejected login',
        badcreds.attempts === 1,
        'submitAuth ran ' + badcreds.attempts + ' time(s)');
    yes('    and says what the app said',
        !!badcreds.thrown && /Invalid login credentials/.test(badcreds.thrown.message),
        badcreds.thrown && badcreds.thrown.message);

    H('Already signed in is a success, not a special case');
    MODE = 'ok';
    const ctx  = await browser.newContext();
    const page = await ctx.newPage();
    attachDiagnostics(page);
    await page.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.evaluate(() => { document.getElementById('loginScreen').style.display = 'none';
                                document.getElementById('appContent').style.display = 'block'; });
    const already = await signIn(page, { email: 'h@e2e-test.local', settleMs: 2500, readyMs: 8000 });
    const ran = await page.evaluate(() => window.__attempts());
    await ctx.close();
    R('result', already);
    yes('reports alreadySignedIn without touching the form',
        already.alreadySignedIn === true && already.attempts === 0 && ran === 0,
        JSON.stringify({ already, ran }));

  } catch (e) {
    bad('suite crashed', e && e.stack ? e.stack : String(e));
  } finally {
    await browser.close().catch(() => {});
    server.close();
  }

  console.log(`\n${fail ? '\x1b[31m' : '\x1b[32m'}RESULT: ${pass} passed, ${fail} failed\x1b[0m\n`);
  process.exit(fail ? 1 : 0);
})();
