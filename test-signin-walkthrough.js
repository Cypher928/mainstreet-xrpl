// test-signin-walkthrough.js
// ============================================================================
// THE FIRST-TIME SIGN-IN, WALKED. Five steps, no extra clicks allowed:
//
//   1. Tap "Log in" on the marketing page
//   2. Land ON THE SIGN-IN FORM — no intermediate page
//   3. Sign in
//   4. Land directly on Your Properties
//   5. "Add Property" is immediately visible
//
// It clicks only by VISIBLE LABEL and counts every click it makes. If the count
// exceeds the two a human is entitled to (Log in, Sign In) the walk fails, no
// matter what ends up on screen.
//
// ── Why this test asserts by HIT-TESTING and not by geometry ────────────────
// The bug it was written for was invisible to every check I had. script.js's
// _maybeShowLoginFromIntent() revealed #loginScreen for a visitor arriving with
// ?signin=1 — correctly. But revealing #loginScreen is exactly the trigger
// landing-experience.js's maybeShow() waits for, so the pre-login landing hero
// mounted at z-index 99000 directly ON TOP of the form. getBoundingClientRect()
// still reported the email field as 300x44 at a sensible position, and
// getComputedStyle() still said display:block — so "the field is visible"
// passed while the user was looking at a marketing hero with a "Sign in" button
// on it. That button was the second of the three screens.
//
// Occlusion is not observable from an element's own box. The only honest
// question is the one the browser answers on a real click:
// document.elementFromPoint(centre) — is the thing under the cursor this
// element, or something covering it? Every visibility assertion below goes
// through hit(), which asks exactly that.
//
// Run: node test-signin-walkthrough.js
// ============================================================================
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
let pw; try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }

const ROOT = __dirname, PORT = 8916;
// Screenshots are evidence, not source. Keep them out of the repo.
const SHOT = process.env.OUT || require('os').tmpdir();
const VJ = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css',
               '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg',
               '.svg':'image/svg+xml', '.pdf':'application/pdf', '.mp3':'audio/mpeg', '.webm':'audio/webm' };

// Serve through vercel.json's own redirect/rewrite table so "/" -> /home and
// "/app" -> index.html behave here exactly as they do in the deployment. A
// walkthrough that invents its own routing is not walking the product.
function route(u) {
  for (const r of (VJ.redirects || [])) if (r.source === u) return { redirect: r.destination };
  for (const r of (VJ.rewrites  || [])) if (r.source === u) return { file: r.destination };
  return { file: u };
}

// Signed OUT until signInWithPassword is called — the state a first-time user
// actually arrives in. Every previous harness handed the page a live session on
// the first tick, which is why none of them could see the sign-in screens.
// __AUTH_DELAY_MS models the Supabase round-trip. It matters: with auth
// resolving on the next tick, the normal signed-out path calls _showLogin()
// so fast that the form is up before anyone could notice, and
// _maybeShowLoginFromIntent() looks like dead code. On a real network that
// round-trip is hundreds of milliseconds of nothing, which is what the intent
// handler exists to fill. The delayed probe below is the only place that
// difference is observable.
const DB = `
(function(){
  var U={id:'first-timer',email:'newuser@example.com'};
  var authed=false, cbs=[];
  var D=Number(window.__AUTH_DELAY_MS||0);
  function P(v){return D?new Promise(function(res){setTimeout(function(){res(v);},D);}):Promise.resolve(v);}
  function q(){var a={select:function(){return a;},eq:function(){return a;},neq:function(){return a;},
    is:function(){return a;},order:function(){return a;},limit:function(){return a;},ilike:function(){return a;},
    in:function(){return P({data:[],error:null});},single:function(){return P({data:null,error:{message:'no rows'}});},
    insert:function(){var p=P({data:[],error:null});p.select=function(){return P({data:[],error:null});};return p;},
    upsert:function(){var p=P({data:[],error:null});p.select=function(){return P({data:[],error:null});};return p;},
    update:function(){return P({data:null,error:null});},
    delete:function(){return {eq:function(){return P({error:null});}};},
    then:function(f){return P({data:[],error:null}).then(f);}};return a;}
  window.supabase={createClient:function(){return {auth:{
    getUser:function(){return P({data:{user:authed?U:null},error:null});},
    getSession:function(){return P({data:{session:authed?{user:U}:null},error:null});},
    signInWithPassword:function(){authed=true;
      cbs.forEach(function(cb){setTimeout(function(){cb('SIGNED_IN',{user:U});},10);});
      return P({data:{user:U,session:{user:U}},error:null});},
    signUp:function(){return P({data:{user:U,session:{user:U}},error:null});},
    onAuthStateChange:function(cb){cbs.push(cb);
      setTimeout(function(){cb(authed?'SIGNED_IN':'SIGNED_OUT',authed?{user:U}:null);},D+30);
      return {data:{subscription:{unsubscribe:function(){}}}};},
    signOut:function(){authed=false;return P({error:null});}},
    rpc:function(){return P({data:null,error:null});},from:function(){return q();},
    storage:{from:function(){return {upload:function(){return P({data:{path:'x'},error:null});},
      getPublicUrl:function(){return {data:{publicUrl:''}};}};}}};}};
})();`;

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail || '' });
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (detail ? '  — ' + detail : ''));
}

// Is this element the thing a finger would actually hit? Samples the centre and
// four inset corners: a wide overlay can leave one edge of a control exposed,
// and a control that is only reachable at one corner is not reachable.
const HIT = function (sel) {
  var el = document.querySelector(sel);
  if (!el) return { found: false };
  var r = el.getBoundingClientRect();
  var cs = getComputedStyle(el);
  var box = { w: Math.round(r.width), h: Math.round(r.height) };
  if (cs.display === 'none' || cs.visibility === 'hidden' || r.width < 2 || r.height < 2)
    return { found: true, painted: false, box: box, hit: false };
  var pts = [[r.left + r.width / 2, r.top + r.height / 2],
             [r.left + 4, r.top + 4], [r.right - 4, r.top + 4],
             [r.left + 4, r.bottom - 4], [r.right - 4, r.bottom - 4]];
  var blockedBy = null, hits = 0;
  pts.forEach(function (p) {
    if (p[0] < 0 || p[1] < 0 || p[0] > innerWidth || p[1] > innerHeight) return;
    var top = document.elementFromPoint(p[0], p[1]);
    if (top && (top === el || el.contains(top) || top.contains(el))) hits++;
    else if (top && !blockedBy) {
      var b = top;
      // Name the highest-z ancestor that has an id — that is the thing a human
      // would call "the screen that came up instead".
      while (b && b !== document.body && !b.id) b = b.parentElement;
      blockedBy = (b && b.id ? '#' + b.id : (top.className || top.tagName)) + '';
    }
  });
  return { found: true, painted: true, box: box, hit: hits >= 3, blockedBy: blockedBy };
};

// Click strictly by visible label, the way a person finds a control.
//
// When more than one visible control carries the same label, click the largest
// one. The login screen has two things that say "Sign In": the tab that is
// already selected, and the full-width primary button underneath it. A thumb
// goes to the button. Taking the first match in DOM order picked the tab, which
// is a no-op — the walk then "signed in" without signing in and blamed the
// portfolio. The count is returned so a duplicate label is visible in the log
// rather than silently resolved.
const CLICK_LABEL = function (rx) {
  var re = new RegExp(rx, 'i');
  var els = [].slice.call(document.querySelectorAll('a,button,[role="button"]'));
  var hitable = els.filter(function (e) {
    var r = e.getBoundingClientRect(); var cs = getComputedStyle(e);
    if (cs.display === 'none' || cs.visibility === 'hidden' || r.width < 2 || r.height < 2) return false;
    return re.test((e.innerText || e.textContent || '').trim());
  });
  if (!hitable.length) return null;
  hitable.sort(function (a, b) {
    var ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
    return (rb.width * rb.height) - (ra.width * ra.height);
  });
  hitable[0].click();
  return (hitable[0].innerText || hitable[0].textContent || '').trim().slice(0, 40) +
         (hitable.length > 1 ? ' (' + hitable.length + ' controls share this label)' : '');
};

(async () => {
  const srv = http.createServer((rq, rs) => {
    const u = decodeURIComponent(rq.url.split('?')[0]);
    if (u.startsWith('/api/')) { rs.writeHead(200, { 'Content-Type': 'application/json' }); rs.end('{}'); return; }
    const r = route(u);
    if (r.redirect) { rs.writeHead(307, { Location: r.redirect }); rs.end(); return; }
    fs.readFile(path.join(ROOT, r.file), (e, d) => {
      if (e) { rs.writeHead(404); rs.end(); return; }
      rs.writeHead(200, { 'Content-Type': MIME[path.extname(r.file)] || 'application/octet-stream' }); rs.end(d);
    });
  });
  await new Promise(r => srv.listen(PORT, '127.0.0.1', r));

  const browser = await pw.chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 430, height: 930 } });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e.message).split('\n')[0]));

  await page.addInitScript(DB);
  // The CDN bundles are unreachable from CI, and a connection reset MID-PARSE
  // truncates index.html — the document ends at the failing tag and script.js
  // never instantiates. That is a sandbox artefact, and it cost a whole
  // diagnostic pass masquerading as "the function does not exist". Stub them so
  // the harness is never the thing that breaks the boot.
  await page.route('**cdnjs**',   r => r.fulfill({ status: 200, body: '/*x*/' }));
  await page.route('**jsdelivr**', r => r.fulfill({ status: 200, body: '/*x*/' }));
  await page.route('**fonts.googleapis.com**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.route('**fonts.gstatic.com**', r => r.fulfill({ status: 200, body: '' }));

  let clicks = 0;
  console.log('\nFirst-time sign-in walkthrough\n' + '='.repeat(60));

  // ── 1 · the marketing page ────────────────────────────────────────────────
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  check('1. marketing page is what a visitor lands on',
        (await page.evaluate(() => location.pathname)) === '/home',
        await page.evaluate(() => location.pathname));

  const label = await page.evaluate(CLICK_LABEL, '^log ?in$');
  clicks++;
  check('   a "Log in" control is findable by its label', !!label, label || 'not found');
  await page.waitForTimeout(3000);

  // ── 2 · the sign-in form, directly ───────────────────────────────────────
  const urlNow = await page.evaluate(() => location.pathname + location.search);
  check('2. "Log in" goes to the application', /^\/app/.test(urlNow), urlNow);

  const email = await page.evaluate(HIT, '#loginEmail');
  const pass  = await page.evaluate(HIT, '#loginPassword');
  const btn   = await page.evaluate(HIT, '#loginBtn');
  check('   the email field is on screen and not covered', email.hit,
        JSON.stringify(email));
  check('   the password field is on screen and not covered', pass.hit, JSON.stringify(pass));
  check('   the Sign In button is on screen and not covered', btn.hit, JSON.stringify(btn));

  // The specific regression: the pre-login hero must not have mounted.
  const heroUp = await page.evaluate(() => {
    const r = document.getElementById('msLanding');
    return !!(r && getComputedStyle(r).display !== 'none');
  });
  check('   no intermediate landing page appeared', !heroUp,
        heroUp ? '#msLanding is displayed over the form' : 'msLanding not shown');

  // Whatever is topmost at the middle of the screen IS the screen the user sees.
  const topMost = await page.evaluate(() => {
    const el = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
    const login = document.getElementById('loginScreen');
    let b = el; while (b && b !== document.body && !b.id) b = b.parentElement;
    return { id: b && b.id ? '#' + b.id : (el ? el.tagName : 'nothing'),
             insideLogin: !!(login && el && login.contains(el)) };
  });
  check('   the screen in front of the user is the login screen',
        topMost.insideLogin, topMost.id);

  await page.screenshot({ path: path.join(SHOT, 'signin-step2.png') }).catch(() => {});

  // ── 2b · the same screen, on a real network ──────────────────────────────
  // A separate load with auth taking 1500ms — roughly what a cold Supabase
  // project costs. Assert the form is usable at 450ms, which is BEFORE auth
  // resolves and before script.js's 1000ms emergency fallback fires. Only
  // _maybeShowLoginFromIntent() can satisfy this; without it the visitor stares
  // at an empty page for the whole round-trip and then gets the form.
  {
    const slow = await ctx.newPage();
    await slow.addInitScript('window.__AUTH_DELAY_MS=1500;');
    await slow.addInitScript(DB);
    await slow.route('**cdnjs**',   r => r.fulfill({ status: 200, body: '/*x*/' }));
    await slow.route('**jsdelivr**', r => r.fulfill({ status: 200, body: '/*x*/' }));
    await slow.route('**fonts.googleapis.com**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await slow.route('**fonts.gstatic.com**', r => r.fulfill({ status: 200, body: '' }));
    await slow.goto(`http://127.0.0.1:${PORT}/app?signin=1`, { waitUntil: 'domcontentloaded' });
    await slow.waitForTimeout(450);
    const early = await slow.evaluate(HIT, '#loginEmail');
    check('2b. on a slow connection the form is up before auth resolves',
          early.hit, JSON.stringify(early));
    await slow.close();
  }

  // ── 3 · sign in ───────────────────────────────────────────────────────────
  await page.fill('#loginEmail', 'newuser@example.com');
  await page.fill('#loginPassword', 'correct-horse');
  const signLabel = await page.evaluate(CLICK_LABEL, '^sign ?in$');
  clicks++;
  check('3. a "Sign In" control is findable by its label', !!signLabel, signLabel || 'not found');
  await page.waitForTimeout(4500);

  // ── 4 · land on Your Properties ───────────────────────────────────────────
  const board = await page.evaluate(HIT, '#portfolioDashboard');
  check('4. the portfolio is on screen and not covered', board.hit, JSON.stringify(board));

  // Read the CONTENT region, not #appContent — that includes the persistent app
  // header (brand, email, role badge, theme picker, Sign out), which is chrome
  // on every screen and says nothing about where the user landed.
  const firstText = await page.evaluate(() => {
    const a = document.getElementById('portfolioDashboard');
    return a ? (a.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 90) : '(portfolio empty)';
  });
  check('   the first thing it says is about your properties',
        /^your propert/i.test(firstText), firstText);

  // ── 5 · Add Property, immediately ─────────────────────────────────────────
  const cta = await page.evaluate(HIT, '.ptf-start-cta');
  check('5. "Add Property" is visible without opening anything first', cta.hit, JSON.stringify(cta));
  const ctaLabel = await page.evaluate(() => {
    const e = document.querySelector('.ptf-start-cta');
    return e ? (e.innerText || '').trim() : null;
  });
  check('   and it is labelled so a first-timer knows what it does',
        !!ctaLabel && /add propert/i.test(ctaLabel), ctaLabel || 'no label');

  // ── the click budget ──────────────────────────────────────────────────────
  check('the whole flow took exactly 2 clicks (Log in, Sign In)', clicks === 2, clicks + ' clicks');

  check('no uncaught errors during the flow', pageErrors.length === 0,
        pageErrors.slice(0, 3).join(' | ') || 'clean');

  await page.screenshot({ path: path.join(SHOT, 'signin-step5.png') }).catch(() => {});
  await ctx.close(); await browser.close(); srv.close();

  const failed = results.filter(r => !r.ok);
  console.log('='.repeat(60));
  console.log(`${results.length - failed.length}/${results.length} passed`);
  if (failed.length) { console.log('FAILED:'); failed.forEach(f => console.log('  - ' + f.name + ' :: ' + f.detail)); }
  process.exit(failed.length ? 1 : 0);
})();
