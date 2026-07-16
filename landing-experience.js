/**
 * landing-experience.js — premium pre-login landing + continuous product demo.
 *
 * Enterprise SaaS feel (Stripe / Vercel / Linear / Notion / Apple). Answers
 * What / Who / Why in under 10 seconds, then tells ONE continuous workflow
 * story across eight steps — line icons and real MainStreet UI, minimal text,
 * large type, generous whitespace. Shown BEFORE login; touches no auth,
 * settlement, XRPL, or business logic.
 *
 * Purely additive: self-mounts DOM + styles, self-triggers when the login
 * screen appears for an unauthenticated visitor. Re-openable via
 * window.MainStreetLanding.show() or ?landing=1.
 *
 * Exposes: window.MainStreetLanding = { show, hide, playDemo }
 */
(function () {
  'use strict';

  var EXPLORER = 'https://livenet.xrpl.org/transactions/7FA730B2B78819AE34B3D1B458721FBC52B9CD25E980ED42DD1B15E9F9FC724A';
  var STEP_MS = 5200;

  // Line-icon set (stroke SVG, no emoji).
  function icon(name) {
    var d = {
      upload:  '<path d="M12 15V4"/><path d="m7.5 8.5 4.5-4.5 4.5 4.5"/><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
      ai:      '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M9 15V9l3 4 3-4v6"/><circle cx="12" cy="4" r="0"/>',
      match:   '<path d="M9 7H6a4 4 0 0 0 0 8h3"/><path d="M15 17h3a4 4 0 0 0 0-8h-3"/><path d="M8 11h8"/>',
      recon:   '<circle cx="12" cy="12" r="9"/><path d="M12 3v9l6 3"/>',
      recover: '<path d="M3 17l6-6 4 4 8-8"/><path d="M21 7v5h-5"/>',
      statement:'<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4"/><path d="M10 13h5M10 17h5"/>',
      settle:  '<circle cx="8" cy="8" r="3"/><circle cx="16" cy="16" r="3"/><path d="M10.5 10.5 13.5 13.5"/>',
      verify:  '<path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z"/><path d="m9 12 2 2 4-4"/>',
    };
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' + (d[name] || '') + '</svg>';
  }

  // Browser-chrome frame around a real product screenshot.
  function frame(src, label) {
    return '<div class="msl-frame"><div class="msl-frame-bar"><span></span><span></span><span></span>' +
      '<div class="msl-frame-url">' + (label || 'app.mainstreet.xyz') + '</div></div>' +
      '<div class="msl-frame-body"><img loading="lazy" src="' + src + '" alt=""></div></div>';
  }
  // Line-icon "illustration" in an accent halo (for steps without a screenshot).
  function illo(name) { return '<div class="msl-illo">' + icon(name) + '</div>'; }

  // Eight-step continuous workflow. `real` uses actual UI; others use line art.
  var STEPS = [
    { k: 'upload',    n: 'Upload',            t: 'Upload leases and invoices.',        v: illo('upload') },
    { k: 'ai',        n: 'AI Analysis',       t: 'AI extracts every lease term.',      v: frame('assets/landing/ui-workspace.png', 'mainstreet · ai workspace') },
    { k: 'match',     n: 'Match',             t: 'Invoices matched automatically.',    v: illo('match') },
    { k: 'recon',     n: 'Reconcile',         t: 'CAM allocated across every tenant.', v: illo('recon') },
    { k: 'recover',   n: 'Recover',           t: 'Missed revenue, surfaced.',          v: frame('assets/landing/ui-command-center.png', 'mainstreet · command center') },
    { k: 'statement', n: 'Statements',        t: 'Tenant-ready in one click.',         v: illo('statement') },
    { k: 'settle',    n: 'Settle',            t: 'Paid in RLUSD on the XRP Ledger.',   v: illo('settle') },
    { k: 'verify',    n: 'Verify',            t: 'Public proof, on-chain.',            v: illo('verify') },
  ];

  var root, demoEl, state = { i: 0, timer: null, playing: false };

  function shown(el) {
    if (!el) return false;
    try { return getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden'; }
    catch (e) { return el.style.display !== 'none'; }
  }
  function isAuthed() {
    try {
      if (shown(document.getElementById('appContent'))) return true;
      var u = window.AuthService && window.AuthService.getCurrentUser && window.AuthService.getCurrentUser();
      return !!(u && u.id);
    } catch (e) { return false; }
  }

  function injectStyles() {
    if (document.getElementById('msl-styles')) return;
    var css = [
      '#msLanding{position:fixed;inset:0;z-index:99000;display:none;overflow-y:auto;color:#EAECEF;',
      'font-family:-apple-system,system-ui,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;',
      'background:radial-gradient(1200px 700px at 80% -12%,rgba(201,151,58,.10),transparent 60%),#080b12;}',
      '#msLanding.msl-on{display:block;animation:mslFade .55s ease both;}',
      '@keyframes mslFade{from{opacity:0}to{opacity:1}}',
      '#msLanding::before{content:"";position:absolute;inset:0;pointer-events:none;background:linear-gradient(rgba(255,255,255,.016) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.016) 1px,transparent 1px);background-size:64px 64px;mask-image:radial-gradient(circle at 50% 30%,#000,transparent 80%);}',
      // nav
      '.msl-nav{position:relative;z-index:2;display:flex;align-items:center;justify-content:space-between;max-width:1120px;margin:0 auto;padding:26px 32px;}',
      '.msl-logo{font-weight:700;font-size:1.1rem;letter-spacing:-.02em;}',
      '.msl-logo b{color:#C9973A;}',
      '.msl-nav-signin{background:none;border:none;color:#9AA4B2;font:inherit;font-size:.9rem;font-weight:500;cursor:pointer;padding:8px;transition:color .2s;}',
      '.msl-nav-signin:hover{color:#EAECEF;}',
      // hero
      '.msl-hero{position:relative;z-index:1;max-width:920px;margin:0 auto;padding:clamp(48px,11vh,120px) 32px 60px;text-align:center;}',
      '.msl-eyebrow{font-family:ui-monospace,"SF Mono",Menlo,monospace;font-size:.72rem;letter-spacing:.26em;text-transform:uppercase;color:#C9973A;margin-bottom:30px;opacity:0;animation:mslUp .7s .05s ease forwards;}',
      '.msl-h1{font-size:clamp(2.9rem,7vw,5.4rem);font-weight:700;letter-spacing:-.04em;line-height:1.02;margin:0;text-wrap:balance;opacity:0;animation:mslUp .85s .16s cubic-bezier(.2,.7,.2,1) forwards;}',
      '.msl-h1 em{font-style:normal;color:#C9973A;}',
      '.msl-lede{font-size:clamp(1.05rem,2vw,1.4rem);line-height:1.5;color:#9AA4B2;max-width:30ch;margin:26px auto 0;font-weight:400;opacity:0;animation:mslUp .85s .3s ease forwards;}',
      '.msl-cta{display:flex;gap:12px;flex-wrap:wrap;justify-content:center;margin:40px 0 0;opacity:0;animation:mslUp .85s .44s ease forwards;}',
      '.msl-btn{font:inherit;font-size:1rem;font-weight:600;border-radius:12px;padding:14px 26px;cursor:pointer;border:1px solid transparent;transition:transform .18s,filter .18s,border-color .2s,color .2s,background .2s;display:inline-flex;align-items:center;gap:9px;}',
      '.msl-btn:hover{transform:translateY(-1px);}',
      '.msl-btn:focus-visible{outline:2px solid #C9973A;outline-offset:3px;}',
      '.msl-btn--primary{background:#C9973A;color:#0b0e15;box-shadow:0 14px 34px -14px rgba(201,151,58,.65);}',
      '.msl-btn--primary:hover{filter:brightness(1.07);}',
      '.msl-btn--ghost{background:rgba(255,255,255,.045);color:#EAECEF;border-color:rgba(255,255,255,.14);}',
      '.msl-btn--ghost:hover{border-color:rgba(255,255,255,.32);}',
      '.msl-btn--text{background:none;color:#9AA4B2;}',
      '.msl-btn--text:hover{color:#EAECEF;}',
      '.msl-trust{margin:34px 0 0;font-family:ui-monospace,"SF Mono",Menlo,monospace;font-size:.72rem;letter-spacing:.06em;color:#5A6472;display:inline-flex;align-items:center;gap:10px;opacity:0;animation:mslUp .85s .56s ease forwards;}',
      '.msl-trust .msl-dot{width:6px;height:6px;border-radius:50%;background:#34C08A;box-shadow:0 0 0 3px rgba(52,192,138,.18);}',
      // workflow rail (hero)
      '.msl-rail{max-width:1000px;margin:64px auto 0;padding:0 32px;display:flex;align-items:flex-start;justify-content:space-between;gap:4px;opacity:0;animation:mslUp .85s .68s ease forwards;}',
      '.msl-rstep{flex:1;display:flex;flex-direction:column;align-items:center;gap:9px;position:relative;}',
      '.msl-rstep::after{content:"";position:absolute;top:19px;left:50%;width:100%;height:1px;background:rgba(255,255,255,.09);z-index:0;}',
      '.msl-rstep:last-child::after{display:none;}',
      '.msl-ric{width:40px;height:40px;border-radius:11px;display:grid;place-items:center;background:#0f1520;border:1px solid rgba(255,255,255,.08);color:#9AA4B2;position:relative;z-index:1;transition:color .2s,border-color .2s;}',
      '.msl-ric svg{width:20px;height:20px;}',
      '.msl-rstep:hover .msl-ric{color:#C9973A;border-color:rgba(201,151,58,.4);}',
      '.msl-rlabel{font-size:.7rem;color:#6B7688;letter-spacing:.02em;}',
      '@keyframes mslUp{from{opacity:0;transform:translateY(22px)}to{opacity:1;transform:none}}',
      '@media(max-width:720px){.msl-cta{flex-direction:column;width:100%;max-width:340px;margin-left:auto;margin-right:auto;}.msl-btn{justify-content:center;width:100%;}.msl-rail{display:none;}}',
      // demo
      '.msl-demo{position:fixed;inset:0;z-index:99001;display:none;background:radial-gradient(1000px 700px at 50% -10%,rgba(201,151,58,.08),transparent 62%),#070a11;}',
      '.msl-demo.msl-on{display:grid;grid-template-columns:280px 1fr;animation:mslFade .4s ease both;}',
      '@media(max-width:860px){.msl-demo.msl-on{grid-template-columns:1fr;grid-template-rows:auto 1fr;}}',
      '.msl-demo-close{position:absolute;top:22px;right:26px;z-index:5;background:rgba(255,255,255,.05);border:none;color:#9AA4B2;font-size:1.05rem;width:36px;height:36px;border-radius:50%;cursor:pointer;display:grid;place-items:center;transition:background .2s,color .2s;}',
      '.msl-demo-close:hover{background:rgba(255,255,255,.12);color:#EAECEF;}',
      // left step rail (the "continuous workflow")
      '.msl-side{border-right:1px solid rgba(255,255,255,.06);padding:38px 26px;display:flex;flex-direction:column;gap:2px;background:rgba(255,255,255,.012);}',
      '@media(max-width:860px){.msl-side{flex-direction:row;overflow-x:auto;border-right:none;border-bottom:1px solid rgba(255,255,255,.06);padding:16px;gap:8px;}}',
      '.msl-side-brand{font-family:ui-monospace,"SF Mono",Menlo,monospace;font-size:.68rem;letter-spacing:.2em;text-transform:uppercase;color:#5A6472;margin-bottom:22px;}',
      '@media(max-width:860px){.msl-side-brand{display:none;}}',
      '.msl-sstep{display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:10px;position:relative;transition:background .3s;white-space:nowrap;}',
      '.msl-sstep .msl-sic{width:30px;height:30px;border-radius:8px;display:grid;place-items:center;background:#0f1520;border:1px solid rgba(255,255,255,.08);color:#6B7688;flex:none;transition:all .3s;}',
      '.msl-sic svg{width:16px;height:16px;}',
      '.msl-slabel{font-size:.86rem;color:#6B7688;font-weight:500;transition:color .3s;}',
      '.msl-sstep.msl-done .msl-sic{color:#34C08A;border-color:rgba(52,192,138,.35);}',
      '.msl-sstep.msl-cur{background:rgba(201,151,58,.08);}',
      '.msl-sstep.msl-cur .msl-sic{color:#0b0e15;background:#C9973A;border-color:#C9973A;transform:scale(1.06);}',
      '.msl-sstep.msl-cur .msl-slabel{color:#EAECEF;}',
      '@media(max-width:860px){.msl-slabel{display:none;}}',
      // stage
      '.msl-stage{position:relative;display:flex;align-items:center;justify-content:center;padding:clamp(30px,6vw,72px);overflow:hidden;}',
      '.msl-scene{width:100%;max-width:760px;display:flex;flex-direction:column;align-items:center;text-align:center;}',
      '.msl-scene.msl-anim{animation:mslScene .6s cubic-bezier(.2,.7,.2,1) both;}',
      '@keyframes mslScene{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:none}}',
      '.msl-num{font-family:ui-monospace,"SF Mono",Menlo,monospace;font-size:.78rem;letter-spacing:.18em;color:#C9973A;}',
      '.msl-title{font-size:clamp(1.9rem,4.4vw,3.2rem);font-weight:700;letter-spacing:-.03em;line-height:1.08;margin:14px 0 0;text-wrap:balance;}',
      '.msl-visual{margin:38px 0 0;width:100%;display:flex;justify-content:center;}',
      // illustration
      '.msl-illo{width:132px;height:132px;border-radius:26px;display:grid;place-items:center;color:#C9973A;background:radial-gradient(circle at 50% 40%,rgba(201,151,58,.16),rgba(201,151,58,.03));border:1px solid rgba(201,151,58,.22);animation:mslFloat 4s ease-in-out infinite;}',
      '.msl-illo svg{width:56px;height:56px;stroke-width:1.3;}',
      '@keyframes mslFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}',
      // frame
      '.msl-frame{width:100%;max-width:680px;border-radius:14px;overflow:hidden;border:1px solid rgba(255,255,255,.1);box-shadow:0 40px 90px -40px rgba(0,0,0,.85);background:#0f1520;}',
      '.msl-frame-bar{display:flex;align-items:center;gap:7px;padding:11px 14px;border-bottom:1px solid rgba(255,255,255,.06);background:#0c111a;}',
      '.msl-frame-bar>span{width:10px;height:10px;border-radius:50%;background:rgba(255,255,255,.14);}',
      '.msl-frame-url{margin-left:12px;font-family:ui-monospace,"SF Mono",Menlo,monospace;font-size:.7rem;color:#5A6472;letter-spacing:.02em;}',
      '.msl-frame-body{max-height:46vh;overflow:hidden;}',
      '.msl-frame-body img{display:block;width:100%;height:auto;}',
      // progress + end
      '.msl-prog{position:absolute;left:0;right:0;bottom:0;display:flex;gap:5px;padding:20px clamp(30px,6vw,72px);}',
      '.msl-seg{flex:1;height:2px;border-radius:2px;background:rgba(255,255,255,.12);overflow:hidden;}',
      '.msl-seg-f{height:100%;width:0;background:#C9973A;}',
      '.msl-seg.msl-sdone .msl-seg-f{width:100%;}',
      '.msl-seg.msl-scur .msl-seg-f{animation:mslSeg linear forwards;}',
      '@keyframes mslSeg{from{width:0}to{width:100%}}',
      '.msl-end{position:absolute;left:0;right:0;bottom:44px;display:flex;gap:12px;justify-content:center;flex-wrap:wrap;padding:0 24px;opacity:0;transition:opacity .45s;pointer-events:none;}',
      '.msl-end.msl-show{opacity:1;pointer-events:auto;}',
      '@media(prefers-reduced-motion:reduce){*[class^="msl-"],*[class*=" msl-"]{animation-duration:.001s!important;}.msl-illo{animation:none;}.msl-btn:hover{transform:none;}}',
    ].join('');
    var s = document.createElement('style'); s.id = 'msl-styles'; s.textContent = css;
    document.head.appendChild(s);
  }

  function build() {
    if (root) return;
    injectStyles();
    root = document.createElement('div');
    root.id = 'msLanding';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', 'Welcome to MainStreet');
    var rail = STEPS.map(function (s) {
      return '<div class="msl-rstep"><div class="msl-ric">' + icon(s.k) + '</div><div class="msl-rlabel">' + s.n + '</div></div>';
    }).join('');
    root.innerHTML =
      '<div class="msl-nav"><div class="msl-logo"><b>Main</b>Street</div>' +
        '<button class="msl-nav-signin" id="mslNavSignin">Sign In</button></div>' +
      '<div class="msl-hero">' +
        '<div class="msl-eyebrow">AI-Powered CAM Reconciliation</div>' +
        '<h1 class="msl-h1">Reconcile CAM.<br>Recover revenue.<br><em>Settle on-chain.</em></h1>' +
        '<p class="msl-lede">Built for commercial landlords and property managers.</p>' +
        '<div class="msl-cta">' +
          '<button class="msl-btn msl-btn--primary" id="mslWatch">Watch 60-Second Demo</button>' +
          '<button class="msl-btn msl-btn--ghost" id="mslStart">Create Free Account</button>' +
          '<button class="msl-btn msl-btn--text" id="mslSignin">Sign In</button>' +
        '</div>' +
        '<div class="msl-trust"><span class="msl-dot"></span> Live on XRPL mainnet · RLUSD settlement · publicly verifiable</div>' +
        '<div class="msl-rail">' + rail + '</div>' +
      '</div>' +
      '<div class="msl-demo" id="mslDemo">' +
        '<button class="msl-demo-close" id="mslDemoClose" aria-label="Close demo">✕</button>' +
        '<aside class="msl-side" id="mslSide"><div class="msl-side-brand">The MainStreet Workflow</div></aside>' +
        '<div class="msl-stage"><div id="mslScene"></div>' +
          '<div class="msl-prog" id="mslProg"></div>' +
          '<div class="msl-end" id="mslEnd"></div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(root);
    demoEl = root.querySelector('#mslDemo');

    // build side rail steps
    var side = root.querySelector('#mslSide');
    STEPS.forEach(function (s, i) {
      var d = document.createElement('div');
      d.className = 'msl-sstep'; d.dataset.i = i;
      d.innerHTML = '<div class="msl-sic">' + icon(s.k) + '</div><div class="msl-slabel">' + s.n + '</div>';
      d.addEventListener('click', function () { clearTimeout(state.timer); state.i = i; state.playing = false; renderScene(); });
      side.appendChild(d);
    });

    root.querySelector('#mslWatch').addEventListener('click', playDemo);
    root.querySelector('#mslStart').addEventListener('click', function () { enterApp('signup'); });
    root.querySelector('#mslSignin').addEventListener('click', function () { enterApp('signin'); });
    root.querySelector('#mslNavSignin').addEventListener('click', function () { enterApp('signin'); });
    root.querySelector('#mslDemoClose').addEventListener('click', stopDemo);
    document.addEventListener('keydown', onKey);
  }

  function renderScene() {
    clearTimeout(state.timer);
    var s = STEPS[state.i], last = state.i === STEPS.length - 1;
    var sceneEl = root.querySelector('#mslScene');
    sceneEl.innerHTML =
      '<div class="msl-scene msl-anim">' +
        '<div class="msl-num">' + String(state.i + 1).padStart(2, '0') + ' / 08</div>' +
        '<h2 class="msl-title">' + s.t + '</h2>' +
        '<div class="msl-visual">' + s.v + '</div>' +
      '</div>';

    // side rail state
    root.querySelectorAll('.msl-sstep').forEach(function (el, i) {
      el.classList.toggle('msl-cur', i === state.i);
      el.classList.toggle('msl-done', i < state.i);
    });
    // progress
    var prog = root.querySelector('#mslProg');
    prog.innerHTML = STEPS.map(function (_, i) {
      var cls = i < state.i ? ' msl-sdone' : (i === state.i ? ' msl-scur' : '');
      var dur = i === state.i && state.playing ? 'animation-duration:' + STEP_MS + 'ms;' : '';
      return '<div class="msl-seg' + cls + '"><div class="msl-seg-f" style="' + dur + '"></div></div>';
    }).join('');

    root.querySelector('#mslEnd').classList.remove('msl-show');

    if (state.playing) {
      if (!last) state.timer = setTimeout(function () { state.i++; renderScene(); }, STEP_MS);
      else state.timer = setTimeout(showEnd, STEP_MS);
    } else if (last) { setTimeout(showEnd, 300); }
  }

  function showEnd() {
    var end = root.querySelector('#mslEnd');
    end.innerHTML =
      '<button class="msl-btn msl-btn--primary" id="mslEndStart">Create Free Account</button>' +
      '<button class="msl-btn msl-btn--ghost" id="mslEndVerify">Verify on XRPL ↗</button>' +
      '<button class="msl-btn msl-btn--text" id="mslEndReplay">Replay</button>';
    end.classList.add('msl-show');
    end.querySelector('#mslEndStart').addEventListener('click', function () { enterApp('signup'); });
    end.querySelector('#mslEndVerify').addEventListener('click', function () { window.open(EXPLORER, '_blank', 'noopener'); });
    end.querySelector('#mslEndReplay').addEventListener('click', function () { state.i = 0; state.playing = true; renderScene(); });
  }

  function playDemo() { build(); state.i = 0; state.playing = true; demoEl.classList.add('msl-on'); renderScene(); }
  function stopDemo() { clearTimeout(state.timer); state.playing = false; demoEl.classList.remove('msl-on'); }

  function onKey(e) {
    if (!root || root.style.display === 'none') return;
    if (demoEl.classList.contains('msl-on')) {
      if (e.key === 'Escape') stopDemo();
      else if (e.key === 'ArrowRight' && state.i < STEPS.length - 1) { clearTimeout(state.timer); state.i++; renderScene(); }
      else if (e.key === 'ArrowLeft' && state.i > 0) { clearTimeout(state.timer); state.i--; renderScene(); }
    } else if (e.key === 'Escape') { enterApp('signin'); }
  }

  function show() { build(); root.classList.add('msl-on'); root.style.display = 'block'; document.body.style.overflow = 'hidden'; }
  function hide() { stopDemo(); if (root) { root.classList.remove('msl-on'); root.style.display = 'none'; } document.body.style.overflow = ''; }

  function enterApp(tab) {
    hide();
    try {
      var login = document.getElementById('loginScreen');
      if (login) login.style.display = 'flex';
      if (typeof window.switchAuthTab === 'function') window.switchAuthTab(tab === 'signup' ? 'signup' : 'signin');
      var email = document.getElementById('loginEmail'); if (email) setTimeout(function () { try { email.focus(); } catch (e) {} }, 60);
    } catch (e) {}
  }

  function maybeShow() {
    var params = new URLSearchParams(location.search);
    var forced = params.get('landing') === '1';
    if (/^#review\//i.test(location.hash) && !forced) return;
    if (isAuthed() && !forced) return;
    var login = document.getElementById('loginScreen');
    if (!login) return;
    if (forced || shown(login)) { show(); return; }
    var done = false;
    function tryShow() {
      if (done) return;
      if (isAuthed()) { done = true; obs.disconnect(); clearInterval(poll); return; }
      if (shown(login)) { done = true; obs.disconnect(); clearInterval(poll); show(); }
    }
    var obs = new MutationObserver(tryShow);
    obs.observe(login, { attributes: true, attributeFilter: ['style', 'class'] });
    var poll = setInterval(tryShow, 250);
    setTimeout(function () { obs.disconnect(); clearInterval(poll); }, 45000);
  }

  window.MainStreetLanding = { show: show, hide: hide, playDemo: playDemo };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', maybeShow);
  else maybeShow();
})();
