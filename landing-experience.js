/**
 * landing-experience.js — modern pre-login landing + 60-second animated demo.
 *
 * A visitor understands what MainStreet is in under 10 seconds. Large type,
 * motion over paragraphs, minimal reading. Shown BEFORE login (over the login
 * screen), never touching auth, settlement, XRPL, or business logic.
 *
 *   Hero → three CTAs: Watch 60-second Demo · Explore Demo Property · Sign In
 *   Demo → 8 auto-advancing full-screen scenes (Upload → … → Verified on-chain)
 *
 * Purely additive: self-mounts its own DOM + styles, self-triggers when the
 * login screen appears for an unauthenticated visitor. Re-openable via
 * window.MainStreetLanding.show() or ?landing=1.
 *
 * Exposes: window.MainStreetLanding = { show, hide, playDemo }
 */
(function () {
  'use strict';

  var EXPLORER = 'https://livenet.xrpl.org/transactions/7FA730B2B78819AE34B3D1B458721FBC52B9CD25E980ED42DD1B15E9F9FC724A';
  var SCENE_MS = 6000; // 8 scenes × 6s ≈ 48s core; final scene holds → ~60s feel

  // 8-scene product story — big keyword, one-line caption, animated visual.
  var SCENES = [
    { glyph: '📂', accent: '#C9973A', key: 'Upload',            cap: 'Drag in leases and invoices.',           vis: 'upload' },
    { glyph: '🤖', accent: '#A5B4FC', key: 'AI Analysis',       cap: 'Extracts lease terms automatically.',     vis: 'extract' },
    { glyph: '📑', accent: '#7DD3FC', key: 'Match Invoices',    cap: 'Every charge tied to the right tenant.',   vis: 'match' },
    { glyph: '💰', accent: '#E4B75C', key: 'CAM Reconciliation',cap: "Calculates every tenant's share.",        vis: 'recon' },
    { glyph: '📈', accent: '#4ade80', key: 'Recovery Found',    cap: '$99,542 in opportunities.',                vis: 'recovery' },
    { glyph: '📄', accent: '#7DD3FC', key: 'Tenant Statement',  cap: 'Cited, tenant-ready in one click.',        vis: 'statement' },
    { glyph: '🌎', accent: '#34C08A', key: 'RLUSD Settlement',  cap: 'Settled on the XRP Ledger.',               vis: 'settle' },
    { glyph: '✅', accent: '#34C08A', key: 'Verified On-Chain', cap: 'Source Tag 2606290001 · public proof.',    vis: 'verified' },
  ];

  var root, demoEl, state = { i: 0, timer: null, playing: false };

  // NOTE: use computed display, NOT offsetParent — the login screen and app are
  // position:fixed, and offsetParent is always null for fixed elements (that was
  // the bug that stopped the landing from auto-showing).
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

  // ── styles ─────────────────────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('msl-styles')) return;
    var css = [
      '#msLanding{position:fixed;inset:0;z-index:99000;display:none;overflow:hidden;color:#F3EFE6;',
      'font-family:-apple-system,system-ui,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;',
      'background:radial-gradient(1100px 620px at 82% -10%,rgba(201,151,58,.16),transparent 58%),radial-gradient(900px 560px at -5% 108%,rgba(52,192,138,.10),transparent 55%),#080e1a;}',
      '#msLanding.msl-on{display:block;animation:mslFade .5s ease both;}',
      '@keyframes mslFade{from{opacity:0}to{opacity:1}}',
      // ambient drifting grid
      '#msLanding::before{content:"";position:absolute;inset:0;background:linear-gradient(rgba(255,255,255,.022) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.022) 1px,transparent 1px);background-size:52px 52px;mask-image:radial-gradient(circle at 50% 40%,#000,transparent 78%);animation:mslDrift 26s linear infinite;}',
      '@keyframes mslDrift{to{background-position:52px 52px;}}',
      '.msl-nav{position:absolute;top:0;left:0;right:0;display:flex;align-items:center;justify-content:space-between;padding:22px 30px;z-index:2;}',
      '.msl-logo{font-weight:800;font-size:1.15rem;letter-spacing:-.02em;}',
      '.msl-logo b{color:#C9973A;}',
      '.msl-signin-top{background:none;border:1px solid rgba(255,255,255,.16);color:#F3EFE6;border-radius:9px;padding:8px 16px;font:inherit;font-size:.85rem;font-weight:600;cursor:pointer;transition:border-color .2s,color .2s;}',
      '.msl-signin-top:hover{border-color:#C9973A;color:#C9973A;}',
      // hero
      '.msl-hero{position:relative;z-index:1;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:80px 24px 40px;}',
      '.msl-badge{font-family:ui-monospace,"SF Mono",Menlo,monospace;font-size:.72rem;letter-spacing:.24em;text-transform:uppercase;color:#C9973A;margin-bottom:26px;opacity:0;animation:mslUp .7s .1s ease forwards;}',
      '.msl-title{font-size:clamp(3.2rem,11vw,7rem);font-weight:800;letter-spacing:-.035em;line-height:.9;margin:0;opacity:0;animation:mslUp .8s .18s cubic-bezier(.2,.7,.2,1) forwards;}',
      '.msl-sub{font-size:clamp(1.05rem,2.4vw,1.6rem);font-weight:600;color:#C6CEDA;margin:18px 0 0;letter-spacing:-.01em;opacity:0;animation:mslUp .8s .3s ease forwards;}',
      '.msl-pitch{font-size:clamp(.95rem,1.7vw,1.15rem);color:#8A99AD;margin:16px 0 0;max-width:640px;opacity:0;animation:mslUp .8s .42s ease forwards;}',
      '.msl-pitch b{color:#E4B75C;font-weight:600;}',
      '.msl-cta{display:flex;gap:14px;flex-wrap:wrap;justify-content:center;margin:38px 0 0;opacity:0;animation:mslUp .8s .54s ease forwards;}',
      '.msl-btn{font:inherit;font-size:1rem;font-weight:700;border-radius:12px;padding:15px 26px;cursor:pointer;border:1px solid transparent;transition:transform .18s,filter .18s,border-color .2s,color .2s,background .2s;display:inline-flex;align-items:center;gap:10px;}',
      '.msl-btn:hover{transform:translateY(-2px);}',
      '.msl-btn:focus-visible{outline:2px solid #C9973A;outline-offset:3px;}',
      '.msl-btn--primary{background:#C9973A;color:#0b1220;box-shadow:0 12px 32px -12px rgba(201,151,58,.7);}',
      '.msl-btn--primary:hover{filter:brightness(1.08);}',
      '.msl-btn--ghost{background:rgba(255,255,255,.04);color:#F3EFE6;border-color:rgba(255,255,255,.16);}',
      '.msl-btn--ghost:hover{border-color:#C9973A;color:#C9973A;}',
      '.msl-btn--text{background:none;color:#8A99AD;}',
      '.msl-btn--text:hover{color:#F3EFE6;}',
      '.msl-flow{display:flex;gap:10px;margin:44px 0 0;flex-wrap:wrap;justify-content:center;opacity:0;animation:mslUp .8s .66s ease forwards;}',
      '.msl-flow-chip{font-size:1.5rem;filter:grayscale(.2);opacity:.85;transition:transform .2s;}',
      '.msl-flow-sep{color:#3a4a63;align-self:center;font-size:.8rem;}',
      '@keyframes mslUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:none}}',
      '@media(max-width:600px){.msl-cta{flex-direction:column;width:100%;max-width:320px;}.msl-btn{justify-content:center;width:100%;}.msl-flow{display:none;}}',
      // demo player
      '.msl-demo{position:fixed;inset:0;z-index:99001;display:none;background:radial-gradient(900px 600px at 50% 0%,rgba(201,151,58,.10),transparent 60%),#060b15;}',
      '.msl-demo.msl-on{display:block;animation:mslFade .35s ease both;}',
      '.msl-demo-close{position:absolute;top:20px;right:24px;z-index:3;background:rgba(255,255,255,.06);border:none;color:#C6CEDA;font-size:1.1rem;width:38px;height:38px;border-radius:50%;cursor:pointer;display:grid;place-items:center;transition:background .2s;}',
      '.msl-demo-close:hover{background:rgba(255,255,255,.14);}',
      '.msl-stage{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:64px 24px;}',
      '.msl-scene{display:flex;flex-direction:column;align-items:center;}',
      '.msl-scene.msl-anim{animation:mslScene .6s cubic-bezier(.2,.7,.2,1) both;}',
      '@keyframes mslScene{from{opacity:0;transform:translateY(26px) scale(.97)}to{opacity:1;transform:none}}',
      '.msl-glyph{font-size:clamp(4.5rem,15vw,8rem);line-height:1;filter:drop-shadow(0 12px 30px rgba(0,0,0,.5));animation:mslFloat 3.4s ease-in-out infinite;}',
      '@keyframes mslFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-10px)}}',
      '.msl-halo{position:absolute;width:340px;height:340px;border-radius:50%;filter:blur(60px);opacity:.5;z-index:-1;transition:background .5s;}',
      '.msl-key{font-size:clamp(2.4rem,7vw,4.6rem);font-weight:800;letter-spacing:-.03em;margin:26px 0 0;line-height:1;text-wrap:balance;}',
      '.msl-cap{font-size:clamp(1rem,2.4vw,1.5rem);color:#C6CEDA;margin:14px 0 0;font-weight:500;}',
      '.msl-vis{margin:34px 0 0;min-height:56px;display:flex;align-items:center;justify-content:center;}',
      // scene visuals
      '.msl-bars{display:flex;gap:8px;align-items:flex-end;height:60px;}',
      '.msl-bar{width:26px;background:linear-gradient(var(--a),color-mix(in srgb,var(--a) 40%,transparent));border-radius:5px 5px 0 0;animation:mslBar .9s ease forwards;transform-origin:bottom;transform:scaleY(0);}',
      '@keyframes mslBar{to{transform:scaleY(1)}}',
      '.msl-count{font-size:clamp(2.6rem,8vw,4rem);font-weight:800;color:#4ade80;font-variant-numeric:tabular-nums;letter-spacing:-.02em;}',
      '.msl-pill{font-family:ui-monospace,"SF Mono",Menlo,monospace;font-size:.82rem;color:#C6CEDA;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:999px;padding:9px 18px;margin:0 5px;display:inline-block;}',
      '.msl-pill b{color:var(--a);}',
      '.msl-doc{width:120px;height:150px;border-radius:10px;background:linear-gradient(160deg,#1a2740,#101a2e);border:1px solid rgba(255,255,255,.1);position:relative;overflow:hidden;}',
      '.msl-doc::after{content:"";position:absolute;left:14px;right:14px;top:18px;height:8px;border-radius:3px;background:rgba(255,255,255,.14);box-shadow:0 18px 0 rgba(255,255,255,.14),0 36px 0 rgba(255,255,255,.14),0 54px 0 rgba(201,151,58,.5),0 72px 0 rgba(255,255,255,.1);}',
      '.msl-scan{position:absolute;left:0;right:0;height:3px;background:var(--a);box-shadow:0 0 14px var(--a);animation:mslScan 1.6s ease-in-out infinite;}',
      '@keyframes mslScan{0%,100%{top:8%}50%{top:88%}}',
      '.msl-rows{width:min(360px,80vw);}',
      '.msl-r{display:flex;justify-content:space-between;padding:9px 14px;font-size:.86rem;border:1px solid rgba(255,255,255,.08);border-radius:9px;margin-bottom:7px;background:#0b1424;opacity:0;animation:mslUp .5s ease forwards;}',
      '.msl-r b{color:var(--a);font-variant-numeric:tabular-nums;}',
      '.msl-check{width:96px;height:96px;border-radius:50%;background:color-mix(in srgb,var(--a) 18%,transparent);display:grid;place-items:center;font-size:3rem;animation:mslPop .6s cubic-bezier(.2,1.4,.4,1) both;}',
      '@keyframes mslPop{from{transform:scale(0)}to{transform:scale(1)}}',
      // progress
      '.msl-prog{position:absolute;left:0;right:0;bottom:0;display:flex;gap:6px;padding:20px 24px;z-index:2;}',
      '.msl-seg{flex:1;height:3px;border-radius:2px;background:rgba(255,255,255,.14);overflow:hidden;}',
      '.msl-seg-f{height:100%;width:0;background:var(--a);}',
      '.msl-seg.msl-done .msl-seg-f{width:100%;}',
      '.msl-seg.msl-active .msl-seg-f{animation:mslSeg linear forwards;}',
      '@keyframes mslSeg{from{width:0}to{width:100%}}',
      '.msl-demo-end{position:absolute;left:0;right:0;bottom:56px;display:flex;gap:12px;justify-content:center;flex-wrap:wrap;padding:0 20px;opacity:0;transition:opacity .4s;}',
      '.msl-demo-end.msl-show{opacity:1;}',
      '@media(prefers-reduced-motion:reduce){*[class^="msl-"],*[class*=" msl-"]{animation-duration:.001s!important;}.msl-glyph{animation:none;}.msl-btn:hover{transform:none;}}',
    ].join('');
    var s = document.createElement('style'); s.id = 'msl-styles'; s.textContent = css;
    document.head.appendChild(s);
  }

  // ── build landing ──────────────────────────────────────────────────────────
  function build() {
    if (root) return;
    injectStyles();
    root = document.createElement('div');
    root.id = 'msLanding';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', 'Welcome to MainStreet');
    var flow = SCENES.map(function (s, i) {
      return '<span class="msl-flow-chip">' + s.glyph + '</span>' +
        (i < SCENES.length - 1 ? '<span class="msl-flow-sep">→</span>' : '');
    }).join('');
    root.innerHTML =
      '<div class="msl-nav"><div class="msl-logo"><b>Main</b>Street</div>' +
        '<button class="msl-signin-top" id="mslSigninTop">Sign In</button></div>' +
      '<div class="msl-hero">' +
        '<div class="msl-badge">AI for Commercial Real Estate</div>' +
        '<h1 class="msl-title">MainStreet</h1>' +
        '<div class="msl-sub">Reconcile CAM · Review leases · Analyze acquisitions</div>' +
        '<p class="msl-pitch">Settle with <b>RLUSD on the XRP Ledger</b> — verifiable on-chain.</p>' +
        '<div class="msl-cta">' +
          '<button class="msl-btn msl-btn--primary" id="mslWatch">▶ Watch 60-Second Demo</button>' +
          '<button class="msl-btn msl-btn--ghost" id="mslExplore">Explore Demo Property</button>' +
          '<button class="msl-btn msl-btn--text" id="mslSignin">Sign In</button>' +
        '</div>' +
        '<div class="msl-flow">' + flow + '</div>' +
      '</div>' +
      '<div class="msl-demo" id="mslDemo">' +
        '<button class="msl-demo-close" id="mslDemoClose" aria-label="Close demo">×</button>' +
        '<div class="msl-stage"><div class="msl-halo" id="mslHalo"></div><div id="mslScene"></div></div>' +
        '<div class="msl-demo-end" id="mslEnd"></div>' +
        '<div class="msl-prog" id="mslProg"></div>' +
      '</div>';
    document.body.appendChild(root);
    demoEl = root.querySelector('#mslDemo');

    root.querySelector('#mslWatch').addEventListener('click', playDemo);
    root.querySelector('#mslExplore').addEventListener('click', function () { enterApp('signup'); });
    root.querySelector('#mslSignin').addEventListener('click', function () { enterApp('signin'); });
    root.querySelector('#mslSigninTop').addEventListener('click', function () { enterApp('signin'); });
    root.querySelector('#mslDemoClose').addEventListener('click', stopDemo);
    document.addEventListener('keydown', onKey);
  }

  // ── demo player ────────────────────────────────────────────────────────────
  function sceneVisual(v, accent) {
    switch (v) {
      case 'upload': return '<div class="msl-doc"><div class="msl-scan" style="background:' + accent + ';box-shadow:0 0 14px ' + accent + '"></div></div>';
      case 'extract': return '<div class="msl-doc"><div class="msl-scan" style="background:' + accent + ';box-shadow:0 0 14px ' + accent + '"></div></div>';
      case 'match': return '<div class="msl-rows">' +
        ['Snow removal → 5 tenants', 'Landscaping → 5 tenants', 'Insurance → excluded'].map(function (t, i) {
          return '<div class="msl-r" style="animation-delay:' + (i * .18) + 's"><span>' + t + '</span><b>✓</b></div>'; }).join('') + '</div>';
      case 'recon': return '<div class="msl-bars">' +
        [40, 62, 30, 78, 52].map(function (h, i) { return '<div class="msl-bar" style="height:' + h + 'px;animation-delay:' + (i * .12) + 's"></div>'; }).join('') + '</div>';
      case 'recovery': return '<div class="msl-count" id="mslCounter">$0</div>';
      case 'statement': return '<span class="msl-pill"><b>Whole Health Market</b> · statement ready</span>';
      case 'settle': return '<span class="msl-pill">1 RLUSD</span><span class="msl-pill">mainnet · 3–5s</span>';
      case 'verified': return '<div class="msl-check">✅</div>';
      default: return '';
    }
  }

  function renderScene() {
    clearTimeout(state.timer);
    var s = SCENES[state.i];
    var sceneEl = root.querySelector('#mslScene');
    var halo = root.querySelector('#mslHalo');
    halo.style.background = s.accent;
    sceneEl.style.setProperty('--a', s.accent);
    sceneEl.innerHTML =
      '<div class="msl-scene msl-anim" style="--a:' + s.accent + '">' +
        '<div class="msl-glyph">' + s.glyph + '</div>' +
        '<h2 class="msl-key">' + s.key + '</h2>' +
        '<p class="msl-cap">' + s.cap + '</p>' +
        '<div class="msl-vis">' + sceneVisual(s.vis, s.accent) + '</div>' +
      '</div>';

    if (s.vis === 'recovery') animateCount(root.querySelector('#mslCounter'), 99542);

    // progress segments
    var prog = root.querySelector('#mslProg');
    prog.innerHTML = SCENES.map(function (_, i) {
      var cls = i < state.i ? ' msl-done' : (i === state.i ? ' msl-active' : '');
      var dur = i === state.i ? 'animation-duration:' + SCENE_MS + 'ms;' : '';
      return '<div class="msl-seg' + cls + '" style="--a:' + s.accent + '"><div class="msl-seg-f" style="' + dur + '"></div></div>';
    }).join('');

    root.querySelector('#mslEnd').classList.remove('msl-show');

    if (state.i < SCENES.length - 1) {
      if (state.playing) state.timer = setTimeout(function () { state.i++; renderScene(); }, SCENE_MS);
    } else {
      // final scene: hold, then reveal CTAs
      state.timer = setTimeout(showEnd, state.playing ? SCENE_MS : 400);
    }
  }

  function showEnd() {
    var end = root.querySelector('#mslEnd');
    end.innerHTML =
      '<button class="msl-btn msl-btn--primary" id="mslEndExplore">Explore Demo Property</button>' +
      '<button class="msl-btn msl-btn--ghost" id="mslEndVerify">Verify on XRPL ↗</button>' +
      '<button class="msl-btn msl-btn--text" id="mslEndReplay">↺ Replay</button>';
    end.classList.add('msl-show');
    end.querySelector('#mslEndExplore').addEventListener('click', function () { enterApp('signup'); });
    end.querySelector('#mslEndVerify').addEventListener('click', function () { window.open(EXPLORER, '_blank', 'noopener'); });
    end.querySelector('#mslEndReplay').addEventListener('click', function () { state.i = 0; state.playing = true; renderScene(); });
  }

  function animateCount(el, target) {
    if (!el) return;
    var start = null, dur = 1600;
    function step(ts) {
      if (start === null) start = ts;
      var p = Math.min((ts - start) / dur, 1);
      var eased = 1 - Math.pow(1 - p, 3);
      el.textContent = '$' + Math.round(target * eased).toLocaleString('en-US');
      if (p < 1) requestAnimationFrame(step);
    }
    try { requestAnimationFrame(step); } catch (e) { el.textContent = '$99,542'; }
  }

  function playDemo() { build(); state.i = 0; state.playing = true; demoEl.classList.add('msl-on'); renderScene(); }
  function stopDemo() { clearTimeout(state.timer); state.playing = false; demoEl.classList.remove('msl-on'); }
  // advance / pause on click within the stage
  function stageClick() { if (state.i < SCENES.length - 1) { clearTimeout(state.timer); state.i++; renderScene(); } }

  function onKey(e) {
    if (!root || root.style.display === 'none') return;
    if (demoEl.classList.contains('msl-on')) {
      if (e.key === 'Escape') stopDemo();
      else if (e.key === 'ArrowRight' && state.i < SCENES.length - 1) { clearTimeout(state.timer); state.i++; renderScene(); }
      else if (e.key === 'ArrowLeft' && state.i > 0) { clearTimeout(state.timer); state.i--; renderScene(); }
    } else if (e.key === 'Escape') { enterApp('signin'); }
  }

  // ── show / enter app ───────────────────────────────────────────────────────
  function show() { build(); root.classList.add('msl-on'); root.style.display = 'block'; document.body.style.overflow = 'hidden'; }
  function hide() { stopDemo(); if (root) { root.classList.remove('msl-on'); root.style.display = 'none'; } document.body.style.overflow = ''; }

  // Dismiss the landing into the existing login screen, on the requested tab.
  function enterApp(tab) {
    hide();
    try {
      var login = document.getElementById('loginScreen');
      if (login) login.style.display = 'flex';
      if (typeof window.switchAuthTab === 'function') window.switchAuthTab(tab === 'signup' ? 'signup' : 'signin');
      var email = document.getElementById('loginEmail'); if (email) setTimeout(function () { try { email.focus(); } catch (e) {} }, 60);
    } catch (e) {}
  }

  // ── auto-trigger before login ──────────────────────────────────────────────
  function maybeShow() {
    var params = new URLSearchParams(location.search);
    var forced = params.get('landing') === '1';
    if (/^#review\//i.test(location.hash) && !forced) return;   // never in review mode
    if (isAuthed() && !forced) return;

    var login = document.getElementById('loginScreen');
    if (!login) return;
    if (forced || shown(login)) { show(); return; }
    // The login screen starts display:none and is flipped to flex asynchronously
    // (getSession resolves on window 'load'). Watch for it, and also poll as a
    // belt-and-suspenders fallback in case the style flip is missed.
    var done = false;
    function tryShow() {
      if (done) return true;
      if (isAuthed()) { done = true; obs.disconnect(); clearInterval(poll); return true; }
      if (shown(login)) { done = true; obs.disconnect(); clearInterval(poll); show(); return true; }
      return false;
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
