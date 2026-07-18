/**
 * onboarding-experience.js — modern first-run onboarding + interactive demo.
 *
 * A self-contained, additive overlay inspired by enterprise SaaS onboarding
 * (Stripe / Linear / Notion / Uber). It explains what MainStreet is, who it's
 * for, and what it does, then lets the user launch 20–30s guided walkthroughs
 * of each capability using the real seeded demo figures — before handing off
 * into the full application via existing entry points.
 *
 * Design constraints honored:
 *   - PURE, ADDITIVE MODULE. Self-mounts its own container + styles; the only
 *     app change is one <script> tag. Touches NO auth, settlement, XRPL, or
 *     business logic.
 *   - Reuses existing demo data (values match the seeded Cascade Commons /
 *     Harborview demo) and existing entry functions (loadDemo, showCommandCenter,
 *     _openAcqDemo) for the "Continue into MainStreet" hand-off.
 *   - Self-triggers once per browser when #appContent first becomes visible for
 *     a landlord (never for tenant portal or review mode). Re-openable via
 *     window.MainStreetOnboarding.start() or ?onboarding=1 / #tour.
 *
 * Exposes: window.MainStreetOnboarding = { start, dismiss, isOpen }
 */
(function () {
  'use strict';

  var LS_KEY = 'ms_onboarded_v1';
  var TAGGED_TX = '7FA730B2B78819AE34B3D1B458721FBC52B9CD25E980ED42DD1B15E9F9FC724A';
  var EXPLORER = 'https://livenet.xrpl.org/transactions/' + TAGGED_TX;
  var AUTOPLAY_MS = 4600; // per step → ~6×3×4.6s ≈ 83s "90-second overview"

  // ── content model (figures match the seeded demo) ──────────────────────────
  var HERO = {
    eyebrow: 'MainStreet · AI for Commercial Real Estate',
    title: 'The AI operating system for CAM reconciliation.',
    sub: 'MainStreet reads your leases, computes what every tenant owes with ' +
         'page-cited evidence, and settles it on the XRP Ledger — turning weeks ' +
         'of spreadsheet work into a verifiable workflow.',
    who: 'Built for commercial landlords and property managers — portfolios of 5 to 100 properties.',
  };

  // Simple stroke SVG icons (no external deps).
  function icon(name) {
    var p = {
      cam:   '<path d="M3 3v18h18"/><rect x="7" y="12" width="3" height="6"/><rect x="12" y="8" width="3" height="10"/><rect x="17" y="5" width="3" height="13"/>',
      acq:   '<path d="M4 21V7l7-4 7 4v14"/><path d="M9 21v-6h4v6"/><circle cx="17.5" cy="15.5" r="3"/><path d="M19.6 17.6 22 20"/>',
      intel: '<rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="5" rx="1"/><rect x="13" y="10" width="8" height="11" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/>',
      resv:  '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="12" cy="12" r="4"/><path d="M12 8v4l2 2"/>',
      doc:   '<path d="M6 2h9l5 5v15a0 0 0 0 1 0 0H6a0 0 0 0 1 0 0Z"/><path d="M15 2v5h5"/><path d="m11 15 1 2 2-4"/>',
      rlusd: '<circle cx="7" cy="7" r="3"/><circle cx="17" cy="17" r="3"/><path d="M9.5 9.5 14.5 14.5"/><path d="M7 10v4M17 10v-4"/>',
    };
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' + (p[name] || '') + '</svg>';
  }

  function stat(v, l) { return '<div class="mso-stat"><span class="mso-stat-v">' + v + '</span><span class="mso-stat-l">' + l + '</span></div>'; }
  function chip(t) { return '<span class="mso-vchip">' + t + '</span>'; }

  var FEATURES = [
    {
      id: 'cam', icon: 'cam', accent: '#C9973A',
      title: 'CAM Reconciliation',
      tagline: 'Turn a stack of invoices into defensible tenant bills.',
      steps: [
        { t: '26 invoices, categorized', b: 'MainStreet reads every vendor invoice for the year and sorts it by category — no spreadsheet, no manual keying.',
          v: '<div class="mso-statrow">' + stat('26', 'invoices') + stat('5', 'leases') + stat('$284k', 'CAM pool') + '</div>' },
        { t: 'Allocated with caps & exclusions', b: 'Each tenant’s pro-rata share is computed automatically, with their lease’s expense caps and excluded costs applied.',
          v: '<div class="mso-mock">' +
             '<div class="mso-mrow"><span>Summit Coffee &amp; Provisions</span><b>$34,861</b></div>' +
             '<div class="mso-mrow"><span>Whole Health Market</span><b>$41,204</b></div>' +
             '<div class="mso-mrow mso-mrow--cap"><span>Harbor Nail &amp; Beauty <em>· cap applied</em></span><b>$18,940</b></div>' +
             '</div>' },
        { t: 'Every charge carries its evidence', b: 'Tenant statements cite the exact lease clause behind each number — so disputes get resolved against documents, not arguments.',
          v: '<div class="mso-evd"><span class="mso-evd-q">“Tenant’s share of Common Area costs shall not increase more than 5% year-over-year…”</span><span class="mso-evd-src">Lease · p.14 · 98% confidence</span></div>' },
      ],
      end: { note: 'That’s the core engine — the two-week job, done in seconds.' },
    },
    {
      id: 'acq', icon: 'acq', accent: '#7DD3FC',
      title: 'Acquisition Review',
      tagline: 'Underwrite a building’s CAM before you close.',
      steps: [
        { t: 'Drop the target’s rent roll', b: 'Upload a property you’re evaluating — Harborview Retail Center in the demo — and MainStreet reads its leases the same way it reads yours.',
          v: chip('Harborview Retail Center') + chip('Rent roll · imported') },
        { t: 'See the leakage', b: 'CAM recovery rate and revenue-at-risk, computed in minutes instead of an analyst-week — the money you’d inherit.',
          v: '<div class="mso-statrow">' + stat('61%', 'CAM recovery') + stat('$92k', 'at risk / yr') + '</div>' },
        { t: 'Get the verdict', b: 'A clear investment read, with every number backed by the source lease — so you bid on facts, not a broker’s pro forma.',
          v: '<span class="mso-verdict">Recovery below 70% threshold — quantify leakage before closing</span>' },
      ],
      end: { note: 'Same engine, pointed at a building you don’t own yet.',
             secondary: { label: 'Open the acquisition demo', run: function () { call('_openAcqDemo'); } } },
    },
    {
      id: 'intel', icon: 'intel', accent: '#E4B75C',
      title: 'Portfolio Intelligence',
      tagline: 'Your whole portfolio, ranked by dollar impact.',
      steps: [
        { t: 'Your morning briefing', b: 'The Command Center turns portfolio state into ranked, dollar-quantified actions — written by deterministic analysis, not a chatbot.',
          v: '<div class="mso-statrow">' + stat('$99,542', 'value identified') + stat('4', 'priorities today') + '</div>' },
        { t: 'The biggest opportunities first', b: 'Missed CAM caps, vacancy leakage, expiring leases — every item sorted by what it’s actually worth.',
          v: '<div class="mso-mock">' +
             '<div class="mso-mrow mso-mrow--hi"><span>10% of CAM has no paying tenant</span><b>$18,849</b></div>' +
             '<div class="mso-mrow"><span>Summit Coffee lease expired</span><b>$6,696</b></div>' +
             '<div class="mso-mrow"><span>2 tenant disputes need decisions</span><b>$6,252</b></div>' +
             '</div>' },
        { t: 'One click to the exact item', b: 'Every recommendation deep-links straight to the precise lease field, dispute, or reserve that needs you — no hunting.',
          v: chip('Review lease → CAM cap field') + chip('Open this dispute') },
      ],
      end: { note: 'The daily driver — reconciliation is the wedge, this is the retention.',
             secondary: { label: 'Open the Command Center', run: function () { call('showCommandCenter'); } } },
    },
    {
      id: 'resv', icon: 'resv', accent: '#6EE7B7',
      title: 'Reserve Planning',
      tagline: 'Get the lender money you’re owed back.',
      steps: [
        { t: 'Read the loan reserve terms', b: 'MainStreet extracts reserve balances, eligible uses, and draw procedures straight from mortgage and escrow documents.',
          v: chip('Roof reserve · $40,000') + chip('Eligible: capital repairs') },
        { t: 'Draw-readiness score', b: 'Know exactly what’s missing before you file — invoices, lien waivers, photos, engineer certs — as a single percentage.',
          v: '<div class="mso-ring" style="--pct:72"><span>72%</span></div><span class="mso-ring-l">ready · 2 items outstanding</span>' },
        { t: 'Lender package, assembled', b: 'Generate the draw package and cover email in one click — so reimbursements stop slipping through the cracks.',
          v: chip('Draw package · generated') + chip('Lender email · drafted') },
      ],
      end: { note: 'Found money most landlords leave sitting in escrow.' },
    },
    {
      id: 'doc', icon: 'doc', accent: '#A5B4FC',
      title: 'Document AI',
      tagline: 'Read any lease with page-cited evidence.',
      steps: [
        { t: 'Upload the lease', b: 'Drop a PDF — MainStreet reads CAM terms, caps, square footage, dates, and exclusions automatically.',
          v: chip('Whole Health Market.pdf') + chip('extracting…') },
        { t: 'Every field, with proof', b: 'Each extracted value carries a verbatim quote, the page it came from, and a confidence score. Nothing is a black box.',
          v: '<div class="mso-evd"><span class="mso-evd-q">“… demised premises containing approximately 4,200 rentable square feet…”</span><span class="mso-evd-src">Leased Sq Ft · p.2 · verified</span></div>' },
        { t: 'Human-verified before it bills', b: 'Low-confidence fields route to a review queue. The AI proposes; a person confirms; only then does it drive a real charge.',
          v: '<span class="mso-conf mso-conf--hi">High</span><span class="mso-conf mso-conf--mid">Review</span><span class="mso-conf mso-conf--hi">High</span>' },
      ],
      end: { note: 'Generative AI where a human verifies it — deterministic everywhere else.' },
    },
    {
      id: 'rlusd', icon: 'rlusd', accent: '#34C08A',
      title: 'RLUSD Settlement',
      tagline: 'Settle on the XRP Ledger — provably.',
      steps: [
        { t: 'Reconciliation → dollars owed', b: 'The billed total flows straight into settlement — no re-keying, no separate system.',
          v: '<div class="mso-statrow">' + stat('1 RLUSD', 'settled on mainnet') + stat('3–5s', 'finality') + '</div>' },
        { t: 'Paid in RLUSD on mainnet', b: 'A regulated dollar stablecoin, carrying a SHA-256 fingerprint of the exact reconciliation in the transaction memo.',
          v: chip('Source Tag 2606290001') + chip('SHA-256 memo · 0025F7…FA341') },
        { t: 'Verify on public infrastructure', b: 'Landlord, tenant, or auditor checks the transaction on the XRP Ledger — infrastructure no single party controls.',
          v: chip('livenet.xrpl.org · tesSUCCESS') + chip('7FA730B2…F9FC724A') },
      ],
      end: { note: 'A payment that proves what it settled — a wire can’t do that.',
             secondary: { label: 'View on XRPL Explorer ↗', run: function () { window.open(EXPLORER, '_blank', 'noopener'); } } },
    },
  ];

  // ── safe call into existing app entry points ───────────────────────────────
  function call(fnName, arg) {
    try {
      var fn = window[fnName];
      if (typeof fn === 'function') { var r = fn(arg); if (r && typeof r.catch === 'function') r.catch(function () {}); return true; }
    } catch (e) { /* degrade gracefully */ }
    return false;
  }

  // ── styles (scoped) ────────────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('mso-styles')) return;
    var css = [
      '#msOnboarding{position:fixed;inset:0;z-index:100000;display:none;overflow-y:auto;',
      'font-family:-apple-system,system-ui,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#F3EFE6;',
      'background:radial-gradient(1200px 600px at 78% -8%,rgba(201,151,58,.12),transparent 60%),radial-gradient(900px 500px at 0% 108%,rgba(52,192,138,.07),transparent 55%),#080b12;}',
      '#msOnboarding.mso-open{display:block;animation:msoFade .4s ease both;}',
      '@keyframes msoFade{from{opacity:0}to{opacity:1}}',
      '.mso-wrap{max-width:1120px;margin:0 auto;padding:34px 28px 72px;}',
      '.mso-top{display:flex;justify-content:space-between;align-items:center;margin-bottom:38px;}',
      '.mso-brand{font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;letter-spacing:.2em;text-transform:uppercase;font-size:.72rem;color:#8A99AD;}',
      '.mso-brand b{color:#F3EFE6;}',
      '.mso-skip{background:none;border:none;color:#8A99AD;font-size:.82rem;cursor:pointer;font-family:inherit;padding:8px 4px;transition:color .2s;}',
      '.mso-skip:hover{color:#C9973A;}',
      '.mso-hero{max-width:760px;}',
      '.mso-eyebrow{font-family:ui-monospace,"SF Mono",Menlo,monospace;font-size:.74rem;letter-spacing:.22em;text-transform:uppercase;color:#C9973A;display:flex;align-items:center;gap:12px;margin:0 0 20px;}',
      '.mso-eyebrow::before{content:"";width:34px;height:1px;background:#C9973A;opacity:.6;}',
      '.mso-h1{font-size:clamp(2.1rem,5vw,3.4rem);font-weight:800;letter-spacing:-.025em;line-height:1.03;margin:0;text-wrap:balance;}',
      '.mso-sub{font-size:clamp(1rem,1.7vw,1.2rem);line-height:1.55;color:#C6CEDA;margin:20px 0 0;max-width:62ch;}',
      '.mso-who{font-family:ui-monospace,"SF Mono",Menlo,monospace;font-size:.8rem;color:#8A99AD;margin:16px 0 0;letter-spacing:.02em;}',
      '.mso-cta{display:flex;flex-wrap:wrap;gap:14px;margin:30px 0 0;}',
      '.mso-btn{font:inherit;font-size:.95rem;font-weight:700;border-radius:11px;padding:13px 22px;cursor:pointer;border:1px solid transparent;transition:transform .18s,filter .18s,border-color .2s,background .2s;display:inline-flex;align-items:center;gap:9px;}',
      '.mso-btn:hover{transform:translateY(-1px);}',
      '.mso-btn--primary{background:#C9973A;color:#080b12;}',
      '.mso-btn--primary:hover{filter:brightness(1.08);}',
      '.mso-btn--ghost{background:rgba(255,255,255,.03);color:#F3EFE6;border-color:rgba(255,255,255,.14);}',
      '.mso-btn--ghost:hover{border-color:#C9973A;color:#C9973A;}',
      '.mso-btn:focus-visible{outline:2px solid #C9973A;outline-offset:2px;}',
      '.mso-cards{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin:52px 0 0;}',
      '@media(max-width:900px){.mso-cards{grid-template-columns:1fr 1fr;}}',
      '@media(max-width:600px){.mso-cards{grid-template-columns:1fr;}.mso-cta{flex-direction:column;}.mso-btn{justify-content:center;}}',
      '.mso-card{position:relative;text-align:left;background:linear-gradient(180deg,#141922,#0d121c);border:1px solid rgba(255,255,255,.07);border-radius:15px;padding:20px 18px 18px;cursor:pointer;overflow:hidden;transition:transform .2s,border-color .2s,box-shadow .2s;opacity:0;transform:translateY(14px);}',
      '.mso-card.mso-in{opacity:1;transform:none;}',
      '.mso-card::before{content:"";position:absolute;left:0;top:0;right:0;height:2px;background:var(--a);opacity:.85;}',
      '.mso-card:hover{transform:translateY(-3px);border-color:color-mix(in srgb,var(--a) 55%,transparent);box-shadow:0 18px 40px -24px rgba(0,0,0,.8);}',
      '.mso-card:focus-visible{outline:2px solid var(--a);outline-offset:2px;}',
      '.mso-ic{width:42px;height:42px;border-radius:11px;display:grid;place-items:center;background:color-mix(in srgb,var(--a) 16%,transparent);color:var(--a);margin-bottom:14px;}',
      '.mso-ic svg{width:22px;height:22px;}',
      '.mso-card h3{margin:0;font-size:1.08rem;font-weight:700;letter-spacing:-.01em;}',
      '.mso-card p{margin:6px 0 0;font-size:.86rem;line-height:1.45;color:#8A99AD;}',
      '.mso-card-go{margin-top:14px;font-family:ui-monospace,"SF Mono",Menlo,monospace;font-size:.72rem;letter-spacing:.08em;color:var(--a);opacity:.9;display:flex;align-items:center;gap:6px;}',
      // player
      '.mso-player{position:fixed;inset:0;z-index:100001;display:none;align-items:center;justify-content:center;padding:26px;background:rgba(7,12,22,.72);backdrop-filter:blur(6px);}',
      '.mso-player.mso-open{display:flex;animation:msoFade .25s ease both;}',
      '.mso-panel{width:min(760px,100%);background:linear-gradient(180deg,#141922,#0a0f18);border:1px solid rgba(255,255,255,.1);border-radius:18px;overflow:hidden;box-shadow:0 40px 100px -40px rgba(0,0,0,.9);}',
      '.mso-phead{display:flex;align-items:center;gap:13px;padding:18px 22px;border-bottom:1px solid rgba(255,255,255,.06);}',
      '.mso-phead .mso-ic{margin:0;width:38px;height:38px;}',
      '.mso-phead-t{font-weight:700;font-size:1.02rem;}',
      '.mso-phead-tag{font-size:.78rem;color:#8A99AD;margin-top:1px;}',
      '.mso-pclose{margin-left:auto;background:none;border:none;color:#8A99AD;font-size:1.3rem;line-height:1;cursor:pointer;padding:4px 8px;border-radius:8px;}',
      '.mso-pclose:hover{color:#F3EFE6;background:rgba(255,255,255,.05);}',
      '.mso-pbar{height:3px;background:rgba(255,255,255,.07);}',
      '.mso-pbar-fill{height:100%;background:var(--a);width:0;transition:width .25s linear;}',
      '.mso-pbody{padding:26px 26px 8px;min-height:230px;}',
      '.mso-step{animation:msoStep .42s cubic-bezier(.2,.7,.2,1) both;}',
      '@keyframes msoStep{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}',
      '.mso-step-n{font-family:ui-monospace,"SF Mono",Menlo,monospace;font-size:.7rem;letter-spacing:.14em;text-transform:uppercase;color:var(--a);}',
      '.mso-step h4{margin:8px 0 8px;font-size:1.32rem;font-weight:800;letter-spacing:-.015em;line-height:1.15;}',
      '.mso-step p{margin:0;font-size:.98rem;line-height:1.55;color:#C6CEDA;max-width:60ch;}',
      '.mso-visual{margin-top:18px;}',
      '.mso-statrow{display:flex;gap:12px;flex-wrap:wrap;}',
      '.mso-stat{background:#080b12;border:1px solid rgba(255,255,255,.07);border-radius:11px;padding:12px 16px;min-width:110px;}',
      '.mso-stat-v{display:block;font-size:1.3rem;font-weight:800;letter-spacing:-.01em;}',
      '.mso-stat-l{display:block;font-size:.68rem;text-transform:uppercase;letter-spacing:.1em;color:#8A99AD;margin-top:2px;}',
      '.mso-mock{background:#080b12;border:1px solid rgba(255,255,255,.07);border-radius:11px;overflow:hidden;}',
      '.mso-mrow{display:flex;justify-content:space-between;align-items:center;padding:10px 15px;font-size:.9rem;border-bottom:1px solid rgba(255,255,255,.05);}',
      '.mso-mrow:last-child{border-bottom:none;}.mso-mrow b{font-variant-numeric:tabular-nums;}',
      '.mso-mrow em{color:#C9973A;font-style:normal;font-size:.78rem;}',
      '.mso-mrow--cap b{color:#C9973A;}.mso-mrow--hi{background:rgba(201,151,58,.06);}.mso-mrow--hi b{color:#4ade80;}',
      '.mso-vchip{display:inline-block;background:#080b12;border:1px solid rgba(255,255,255,.09);border-radius:8px;padding:7px 12px;font-size:.8rem;color:#C6CEDA;margin:0 8px 8px 0;font-family:ui-monospace,"SF Mono",Menlo,monospace;}',
      '.mso-evd{background:#080b12;border-left:2px solid var(--a);border-radius:0 10px 10px 0;padding:13px 16px;}',
      '.mso-evd-q{display:block;font-style:italic;color:#F3EFE6;line-height:1.5;font-size:.92rem;}',
      '.mso-evd-src{display:block;margin-top:7px;font-family:ui-monospace,"SF Mono",Menlo,monospace;font-size:.72rem;color:#8A99AD;}',
      '.mso-verdict{display:inline-block;background:rgba(201,151,58,.1);border:1px solid rgba(201,151,58,.35);color:#E4B75C;border-radius:9px;padding:10px 15px;font-size:.9rem;font-weight:600;}',
      '.mso-conf{display:inline-block;border-radius:7px;padding:5px 12px;font-size:.75rem;font-weight:700;margin-right:8px;}',
      '.mso-conf--hi{background:rgba(52,192,138,.14);color:#4ade80;}.mso-conf--mid{background:rgba(201,151,58,.14);color:#E4B75C;}',
      '.mso-ring{--pct:72;width:76px;height:76px;border-radius:50%;display:inline-grid;place-items:center;background:conic-gradient(var(--a) calc(var(--pct)*1%),rgba(255,255,255,.08) 0);vertical-align:middle;}',
      '.mso-ring span{width:58px;height:58px;border-radius:50%;background:#080b12;display:grid;place-items:center;font-weight:800;font-size:1.05rem;}',
      '.mso-ring-l{margin-left:12px;font-size:.85rem;color:#8A99AD;}',
      '.mso-pfoot{display:flex;align-items:center;gap:12px;padding:16px 26px 22px;flex-wrap:wrap;}',
      '.mso-dots{display:flex;gap:7px;}',
      '.mso-dot{width:7px;height:7px;border-radius:50%;background:rgba(255,255,255,.18);transition:background .2s,transform .2s;}',
      '.mso-dot.mso-on{background:var(--a);transform:scale(1.3);}',
      '.mso-foot-actions{margin-left:auto;display:flex;gap:10px;align-items:center;flex-wrap:wrap;}',
      '.mso-link{background:none;border:none;color:#8A99AD;font:inherit;font-size:.85rem;cursor:pointer;padding:8px;}',
      '.mso-link:hover{color:#C9973A;}',
      '.mso-mini{font:inherit;font-size:.86rem;font-weight:700;border-radius:9px;padding:9px 15px;cursor:pointer;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.03);color:#F3EFE6;transition:border-color .2s,color .2s,background .2s;}',
      '.mso-mini:hover{border-color:var(--a);color:var(--a);}',
      '.mso-mini--primary{background:#C9973A;color:#080b12;border-color:#C9973A;}',
      '.mso-mini--primary:hover{filter:brightness(1.08);color:#080b12;}',
      '.mso-mini--accent{background:color-mix(in srgb,var(--a) 90%,#000);color:#080b12;border-color:var(--a);}',
      '@media(prefers-reduced-motion:reduce){.mso-card,.mso-step,#msOnboarding.mso-open,.mso-player.mso-open{animation:none!important;transition:none!important;}.mso-card{opacity:1;transform:none;}.mso-btn:hover,.mso-card:hover{transform:none;}}',
    ].join('');
    var s = document.createElement('style');
    s.id = 'mso-styles'; s.textContent = css;
    document.head.appendChild(s);
  }

  // ── DOM build ──────────────────────────────────────────────────────────────
  var root, playerEl, state = { fi: 0, si: 0, autoplay: false, timer: null };

  function buildRoot() {
    if (root) return;
    injectStyles();
    root = document.createElement('div');
    root.id = 'msOnboarding';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', 'Welcome to MainStreet');
    root.innerHTML =
      '<div class="mso-wrap">' +
        '<div class="mso-top"><span class="mso-brand"><b>MainStreet</b> · Welcome</span>' +
          '<button class="mso-skip" id="msoSkip">Continue into MainStreet →</button></div>' +
        '<div class="mso-hero">' +
          '<div class="mso-eyebrow">' + HERO.eyebrow + '</div>' +
          '<h1 class="mso-h1">' + HERO.title + '</h1>' +
          '<p class="mso-sub">' + HERO.sub + '</p>' +
          '<p class="mso-who">' + HERO.who + '</p>' +
          '<div class="mso-cta">' +
            '<button class="mso-btn mso-btn--primary" id="msoStartDemo">▶ Start Interactive Demo</button>' +
            '<button class="mso-btn mso-btn--ghost" id="msoWatch">Watch 90-Second Overview</button>' +
          '</div>' +
        '</div>' +
        '<div class="mso-cards" id="msoCards"></div>' +
      '</div>' +
      '<div class="mso-player" id="msoPlayer"><div class="mso-panel" id="msoPanel"></div></div>';
    document.body.appendChild(root);

    // feature cards
    var cardsEl = root.querySelector('#msoCards');
    FEATURES.forEach(function (f, i) {
      var c = document.createElement('button');
      c.className = 'mso-card'; c.style.setProperty('--a', f.accent);
      c.setAttribute('aria-label', 'Walkthrough: ' + f.title);
      c.innerHTML =
        '<div class="mso-ic">' + icon(f.icon) + '</div>' +
        '<h3>' + f.title + '</h3><p>' + f.tagline + '</p>' +
        '<div class="mso-card-go">Watch 30-second walkthrough →</div>';
      c.addEventListener('click', function () { openPlayer(i, false); });
      cardsEl.appendChild(c);
      requestAnimationFrame(function () { setTimeout(function () { c.classList.add('mso-in'); }, 60 * i + 80); });
    });

    playerEl = root.querySelector('#msoPlayer');
    root.querySelector('#msoSkip').addEventListener('click', dismiss);
    root.querySelector('#msoStartDemo').addEventListener('click', function () { openPlayer(0, false); });
    root.querySelector('#msoWatch').addEventListener('click', function () { openPlayer(0, true); });
    document.addEventListener('keydown', onKey);
  }

  // ── player ─────────────────────────────────────────────────────────────────
  function openPlayer(fi, autoplay) {
    state.fi = fi; state.si = 0; state.autoplay = !!autoplay;
    playerEl.classList.add('mso-open');
    renderStep();
  }
  function closePlayer() {
    clearTimeout(state.timer); state.autoplay = false;
    playerEl.classList.remove('mso-open');
  }
  function renderStep() {
    clearTimeout(state.timer);
    var f = FEATURES[state.fi], step = f.steps[state.si], last = state.si === f.steps.length - 1;
    var panel = root.querySelector('#msoPanel');
    panel.style.setProperty('--a', f.accent);
    var dots = f.steps.map(function (_, i) { return '<span class="mso-dot' + (i === state.si ? ' mso-on' : '') + '"></span>'; }).join('');

    var actions;
    if (last) {
      var sec = f.end && f.end.secondary
        ? '<button class="mso-mini mso-mini--accent" id="msoSecondary">' + f.end.secondary.label + '</button>' : '';
      var nextFeat = state.fi < FEATURES.length - 1
        ? '<button class="mso-mini" id="msoNextFeat">Next feature →</button>' : '';
      actions = sec + nextFeat + '<button class="mso-mini mso-mini--primary" id="msoContinue">Continue into MainStreet →</button>';
    } else {
      actions = '<button class="mso-link" id="msoPrev"' + (state.si === 0 ? ' style="visibility:hidden"' : '') + '>← Back</button>' +
                '<button class="mso-mini mso-mini--primary" id="msoNext">Next →</button>';
    }

    panel.innerHTML =
      '<div class="mso-phead"><div class="mso-ic">' + icon(f.icon) + '</div>' +
        '<div><div class="mso-phead-t">' + f.title + '</div><div class="mso-phead-tag">' + f.tagline + '</div></div>' +
        '<button class="mso-pclose" id="msoPClose" aria-label="Close">×</button></div>' +
      '<div class="mso-pbar"><div class="mso-pbar-fill" id="msoBar"></div></div>' +
      '<div class="mso-pbody"><div class="mso-step">' +
        '<div class="mso-step-n">' + f.title + ' · ' + (state.si + 1) + ' of ' + f.steps.length + '</div>' +
        '<h4>' + step.t + '</h4><p>' + step.b + '</p>' +
        '<div class="mso-visual">' + step.v + '</div>' +
      '</div></div>' +
      '<div class="mso-pfoot"><div class="mso-dots">' + dots + '</div>' +
        '<div class="mso-foot-actions">' + actions + '</div></div>';

    // wire
    panel.querySelector('#msoPClose').addEventListener('click', closePlayer);
    var b;
    if ((b = panel.querySelector('#msoNext'))) b.addEventListener('click', next);
    if ((b = panel.querySelector('#msoPrev'))) b.addEventListener('click', prev);
    if ((b = panel.querySelector('#msoNextFeat'))) b.addEventListener('click', function () { state.fi++; state.si = 0; renderStep(); });
    if ((b = panel.querySelector('#msoContinue'))) b.addEventListener('click', dismiss);
    if ((b = panel.querySelector('#msoSecondary'))) b.addEventListener('click', function () { dismissThen(f.end.secondary.run); });

    // autoplay progress + advance
    if (state.autoplay) {
      var bar = panel.querySelector('#msoBar');
      requestAnimationFrame(function () { bar.style.transition = 'width ' + AUTOPLAY_MS + 'ms linear'; bar.style.width = '100%'; });
      state.timer = setTimeout(function () {
        if (last && state.fi === FEATURES.length - 1) { state.autoplay = false; return; } // rest on final step
        if (last) { state.fi++; state.si = 0; } else { state.si++; }
        renderStep();
      }, AUTOPLAY_MS);
    }
  }
  function next() { var f = FEATURES[state.fi]; if (state.si < f.steps.length - 1) { state.si++; renderStep(); } }
  function prev() { if (state.si > 0) { state.si--; renderStep(); } }

  function onKey(e) {
    if (!root || root.style.display === 'none') return;
    if (playerEl.classList.contains('mso-open')) {
      if (e.key === 'Escape') closePlayer();
      else if (e.key === 'ArrowRight') { var f = FEATURES[state.fi]; if (state.si < f.steps.length - 1) next(); }
      else if (e.key === 'ArrowLeft') prev();
    } else if (e.key === 'Escape') { dismiss(); }
  }

  // ── show / dismiss ─────────────────────────────────────────────────────────
  function start() {
    buildRoot();
    root.classList.add('mso-open');
    root.style.display = 'block';
    document.body.style.overflow = 'hidden';
  }
  function dismiss() {
    try { localStorage.setItem(LS_KEY, '1'); } catch (e) {}
    closePlayer();
    if (root) { root.classList.remove('mso-open'); root.style.display = 'none'; }
    document.body.style.overflow = '';
  }
  function dismissThen(run) { dismiss(); try { run(); } catch (e) {} }
  function isOpen() { return !!(root && root.style.display !== 'none'); }

  // ── auto-trigger ────────────────────────────────────────────────────────────
  // FALLBACK MODE (post-login onboarding): superseded by the pre-login landing
  // experience (landing-experience.js). Kept as a working fallback — it no longer
  // auto-shows unless explicitly opted in via ?onboarding=1 / #tour /
  // localStorage ms_onboarding_legacy='1'. Still invokable via
  // window.MainStreetOnboarding.start().
  function maybeAutoStart() {
    var params = new URLSearchParams(location.search);
    var legacyFlag = false; try { legacyFlag = localStorage.getItem('ms_onboarding_legacy') === '1'; } catch (e) {}
    var forced = params.get('onboarding') === '1' || location.hash === '#tour' || legacyFlag;
    if (!forced) return; // default off — the pre-login landing is the primary experience
    var seen = false; try { seen = localStorage.getItem(LS_KEY) === '1'; } catch (e) {}
    if (!forced && seen) return;

    var app = document.getElementById('appContent');
    if (!app) return;
    // review mode never onboards
    if (/^#review\//i.test(location.hash) && !forced) return;

    function visibleLandlord() {
      var shown = app.style.display !== 'none' && app.offsetParent !== null;
      var role = app.getAttribute('data-role');
      return shown && role !== 'tenant';
    }
    if (forced) { start(); return; }
    if (visibleLandlord()) { start(); return; }
    // observe until the app becomes visible for a landlord
    var obs = new MutationObserver(function () {
      if (visibleLandlord()) { obs.disconnect(); setTimeout(start, 350); }
    });
    obs.observe(app, { attributes: true, attributeFilter: ['style', 'data-role'] });
    // safety timeout so the observer never lingers forever
    setTimeout(function () { obs.disconnect(); }, 60000);
  }

  window.MainStreetOnboarding = { start: start, dismiss: dismiss, isOpen: isOpen };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', maybeAutoStart);
  else maybeAutoStart();
})();
