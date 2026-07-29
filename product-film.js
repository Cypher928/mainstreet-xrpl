/**
 * product-film.js — the MainStreet product launch film, as a standalone module.
 *
 * Extracted from landing-experience.js so the film has ONE implementation shared
 * by both surfaces that show it:
 *
 *   home.html    plays it in place, so the CTA click is the user gesture that
 *                permits audio. Browsers do not carry user activation across a
 *                navigation, so the old home -> index.html?demo=1 hop could
 *                never autoplay narration. That is why this module exists.
 *   index.html   landing-experience.js delegates to it for a signed-out visitor.
 *
 * Mounts its own overlay and styles. Touches no auth, settlement, XRPL or
 * business logic. Narration is a scaffold only: cue times are exposed so a
 * recorded track can be dropped in, and no synthetic voice is ever spoken.
 *
 *   ProductFilm.play({ onExit })   open and play from the first beat
 *   ProductFilm.stop()             close
 *   ProductFilm.narrationCues()    [{ id, atMs, durMs, line, caption }]
 *   ProductFilm.narrationScript()  the same, formatted for a voice artist
 */
(function () {
  'use strict';

  var EXPLORER = 'https://livenet.xrpl.org/transactions/7FA730B2B78819AE34B3D1B458721FBC52B9CD25E980ED42DD1B15E9F9FC724A';
  var ASSET = 'assets/landing/';
  var STYLE_ID = 'pf-styles';

  function icon(name) {
    var d = {
      upload:  '<path d="M12 15V4"/><path d="m7.5 8.5 4.5-4.5 4.5 4.5"/><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
      ai:      '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M9 15V9l3 4 3-4v6"/>',
      match:   '<path d="M9 7H6a4 4 0 0 0 0 8h3"/><path d="M15 17h3a4 4 0 0 0 0-8h-3"/><path d="M8 11h8"/>',
      recon:   '<circle cx="12" cy="12" r="9"/><path d="M12 3v9l6 3"/>',
      recover: '<path d="M3 17l6-6 4 4 8-8"/><path d="M21 7v5h-5"/>',
      statement:'<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4"/><path d="M10 13h5M10 17h5"/>',
      settle:  '<circle cx="8" cy="8" r="3"/><circle cx="16" cy="16" r="3"/><path d="M10.5 10.5 13.5 13.5"/>',
      verify:  '<path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z"/><path d="m9 12 2 2 4-4"/>',
      chev:    '<path d="m6 9 6 6 6-6"/>',
    };
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' + (d[name] || '') + '</svg>';
  }


  function reduce() { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } }
  function countUp(el, target, dur, prefix, suffix) {
    if (!el) return; prefix = prefix || ''; suffix = suffix || '';
    if (reduce()) { el.textContent = prefix + Math.round(target).toLocaleString('en-US') + suffix; return; }
    var t0 = null;
    function step(ts) {
      if (t0 === null) t0 = ts;
      var p = Math.min((ts - t0) / dur, 1), e = 1 - Math.pow(1 - p, 3);
      el.textContent = prefix + Math.round(target * e).toLocaleString('en-US') + suffix;
      if (p < 1) requestAnimationFrame(step);
      else { el.classList.add('msl-landed'); setTimeout(function () { el.classList.remove('msl-landed'); }, 500); }
    }
    requestAnimationFrame(step);
  }
  function typeInto(el, text, cps) {
    if (!el) return; if (reduce()) { el.textContent = text; return; }
    var i = 0, iv = setInterval(function () { el.textContent = text.slice(0, ++i); if (i >= text.length) clearInterval(iv); }, 1000 / (cps || 34));
  }


  var URLS = { upload:'mainstreetcam.com/documents', ai:'mainstreetcam.com/review', match:'mainstreetcam.com/cam',
    recon:'mainstreetcam.com/cam', recover:'mainstreetcam.com/command-center', statement:'mainstreetcam.com/reports',
    settle:'mainstreetcam.com/settlement', verify:'livenet.xrpl.org' };

  var SCENES = [
    // Ten beats, 43.4s. Hero beats (extract / recover / ask / verify) run ~5.2s
    // so they breathe; connective beats run 3.6-4.4s. `fw` is that scene's
    // composition width — each is framed for what should dominate it rather
    // than a uniform fill, so nothing reads cropped or oversized. `vo` is the
    // narration line for the launch cut; see NARRATION below. No synthetic
    // voice is played.
    { id: 'upload', dur: 4000, fw: 780, cap: 'Every lease and invoice, in one place',
      vo: 'It starts with what you already have. Leases, invoices, statements.',
      build: function (c) {
        c.innerHTML =
          '<img class="msl-bg msl-ken" src="' + ASSET + 'ui-upload.png" alt="">' +
          '<div class="msl-vig"></div>' +
          '<div class="msl-drop msl-zoomin"><div class="msl-drop-ic">' + icon('upload') + '</div><div class="msl-drop-t">Drop files to begin</div>' +
          '<div class="msl-drop-bar"><i></i></div></div>' +
          '<div class="msl-docs">' +
            '<div class="msl-doc-fly" style="--d:.05s;--x:-150px">Lease — Whole Health Market.pdf</div>' +
            '<div class="msl-doc-fly" style="--d:.35s;--x:40px">Invoice — Cascade Handyman.pdf</div>' +
            '<div class="msl-doc-fly" style="--d:.65s;--x:180px">Invoice — Meridian Insurance.pdf</div>' +
          '</div>';
      } },

    // HERO — the clause is found and cited. Wide: the document and the fields
    // it produces have to sit side by side for the causation to read.
    { id: 'extract', dur: 5200, fw: 940, cap: 'AI reads every clause — and cites it',
      vo: 'MainStreet reads every clause, and tells you which page it came from.',
      build: function (c) {
        c.innerHTML =
          '<div class="msl-lease msl-zoomin">' +
            '<div class="msl-lease-doc">' +
              ['SECTION 6.4  CAP ON COMMON','AREA MAINTENANCE COSTS','','Tenant’s Proportionate Share of','Common Area Maintenance Costs','payable in respect of any calendar','year shall not increase by more than','five percent (5%) over the amount','payable in the preceding year.']
              .map(function (ln, i) { return '<div class="msl-ln" style="--d:' + (i * .07) + 's">' + (ln || '&nbsp;') + '</div>'; }).join('') +
              '<div class="msl-hl msl-hl--slow"></div>' +
            '</div>' +
            '<div class="msl-fields">' +
              [['CAM Cap','5% / yr'],['Base amount','$33,000'],['Leased Sq Ft','9,200'],['Lease Type','NNN']]
              .map(function (f, i) { return '<div class="msl-field" style="--d:' + (1.5 + i * .34) + 's"><span>' + f[0] + '</span><b>' + f[1] + '</b><em class="msl-verify-dot"></em></div>'; }).join('') +
              '<div class="msl-cite" style="--d:3.1s">Lease · page 2 · §6.4</div>' +
            '</div>' +
          '</div>';
      } },

    // The saving is the story. "Prevented by cap" replaces "CAP ADJ", the green
    // figures count up in sequence, and one plain sentence lands the point.
    { id: 'recon', dur: 4400, fw: 820, cap: 'Every charge checked against what the lease allows',
      vo: 'Every charge is checked against what the lease actually permits.',
      build: function (c) {
        var rows = [['Whole Health Market', 31979, 34650], ['Summit Coffee & Provisions', 6340, 6696],
                    ['ProActive Physical Therapy', 12942, 13780], ['FitZone Athletics', 24288, 24960]];
        c.innerHTML =
          '<div class="msl-alloc msl-zoomin">' +
            '<div class="msl-alloc-head msl-arow--3"><span>Tenant</span><span>Prevented by cap</span><span>Billed</span></div>' +
            rows.map(function (r, i) {
              return '<div class="msl-arow msl-arow--3" style="--d:' + (i * .18) + 's"><span>' + r[0] + '</span>' +
                     '<em class="msl-capadj" data-p="' + r[1] + '">−$0</em><b>$' + r[2].toLocaleString('en-US') + '</b></div>'; }).join('') +
            '<div class="msl-alloc-note" style="--d:2.4s"><b>$75,549</b> in charges the lease didn’t allow — caught before billing.</div>' +
          '</div>';
        setTimeout(function () {
          c.querySelectorAll('[data-p]').forEach(function (el, i) {
            setTimeout(function () { countUp(el, +el.dataset.p, 620, '−$'); }, i * 260);
          });
        }, reduce() ? 0 : 380);
      } },

    // HERO — the money. No competing background: the Command Center render has
    // its own "$99,542" in it, and two of the same number in one frame reads as
    // a rendering fault. Just the number, on black, out of blur.
    { id: 'recover', dur: 5200, fw: 700, cap: 'Revenue you were entitled to recover',
      vo: 'And it finds the revenue you were entitled to recover.',
      build: function (c) {
        c.innerHTML =
          '<div class="msl-spot msl-spot--center"></div>' +
          '<div class="msl-bignum msl-bignum--center msl-blin">' +
            '<div class="msl-bignum-v" id="mslRecover">$0</div>' +
            '<div class="msl-bignum-l">Recoverable revenue identified</div>' +
            '<div class="msl-bignum-sub" style="--d:2.4s">Cap enforcement · exclusions · unbilled vacancy</div>' +
          '</div>';
        setTimeout(function () { countUp(document.getElementById('mslRecover'), 99542, 1600, '$'); }, reduce() ? 0 : 480);
      } },

    { id: 'space', dur: 4400, fw: 720, cap: 'Open a space — its whole history is there',
      vo: 'Open any space, and its whole history is already there.',
      build: function (c) {
        var rows = [['Lease on file', 'NNN · 9,200 sqft · to 2028'],
                    ['2025 CAM', '$34,650 · Ready'],
                    ['Dispute — Cascade Handyman', '$6,051 · docs requested'],
                    ['Documents · photos', '7 · 2']];
        c.innerHTML =
          '<div class="msl-stmt msl-zoomin">' +
            '<div class="msl-stmt-head" style="--d:0s"><div><b>📍 Whole Health Market</b><span>Everything about this space, in one place</span></div><div class="msl-stmt-badge">Space</div></div>' +
            rows.map(function (it, i) { return '<div class="msl-stmt-row" style="--d:' + (0.4 + i * 0.26) + 's"><span>' + it[0] + '</span><b>' + it[1] + '</b></div>'; }).join('') +
            '<div class="msl-stmt-cite" style="--d:1.8s">Grounded in the documents behind it — not in an inbox.</div>' +
          '</div>';
      } },

    // HERO — the citation is the payoff, not the answer.
    { id: 'ask', dur: 5200, fw: 760, cap: 'Ask anything — every answer cites its source',
      vo: 'Ask anything. Every answer cites the document it came from.',
      build: function (c) {
        var hits = [['Whole Health Market', '5% cap · p.2 §6.4'],
                    ['Summit Coffee & Provisions', '8% cap · p.3'],
                    ['FitZone Athletics', '4% cap · p.2']];
        c.innerHTML =
          '<div class="msl-vig"></div>' +
          '<div class="msl-stmt msl-zoomin">' +
            '<div class="msl-stmt-head" style="--d:0s"><div><b>Ask MainStreet AI</b><span class="msl-askq" id="mslAskQ">&nbsp;</span></div><div class="msl-stmt-badge">Cited</div></div>' +
            hits.map(function (it, i) { return '<div class="msl-stmt-row" style="--d:' + (1.9 + i * 0.3) + 's"><span>' + it[0] + '</span><b>' + it[1] + '</b></div>'; }).join('') +
            '<div class="msl-stmt-cite" style="--d:3.2s">Answers come from your documents — never from guesswork.</div>' +
          '</div>';
        typeInto(c.querySelector('#mslAskQ'), 'Which tenants have CAM caps?', 26);
      } },

    { id: 'timeline', dur: 4200, fw: 700, cap: 'Every property keeps a living memory',
      vo: 'And every property keeps a living memory of what happened to it.',
      build: function (c) {
        var ev = [['Lease uploaded', 'Jan 4'], ['CAM reconciliation run', 'Jan 31'],
                  ['Dispute opened — Cascade Handyman', 'Feb 2'], ['Settlement completed', 'Feb 9']];
        c.innerHTML =
          '<div class="msl-tl msl-zoomin">' +
            '<div class="msl-tl-h">Property Timeline</div>' +
            '<div class="msl-tl-rail"></div>' +
            ev.map(function (e, i) {
              return '<div class="msl-tl-row" style="--d:' + (0.35 + i * 0.5) + 's">' +
                     '<span class="msl-tl-dot"></span><span class="msl-tl-t">' + e[0] + '</span><em>' + e[1] + '</em></div>'; }).join('') +
            '<div class="msl-stmt-cite" style="--d:2.6s">Nothing is lost when someone leaves the company.</div>' +
          '</div>';
      } },

    { id: 'settle', dur: 3600, fw: 620, cap: 'Settled in RLUSD on the XRP Ledger',
      vo: 'Balances settle in RLUSD on the XRP Ledger.',
      build: function (c) {
        var steps = ['Tenant pays', 'Settled in RLUSD', 'Written to the ledger'];
        c.innerHTML =
          '<div class="msl-settle msl-zoomin">' +
            '<div class="msl-settle-amt" id="mslAmt">$34,650</div>' +
            '<div class="msl-steps">' + steps.map(function (s2, i) {
              return '<div class="msl-sstep2" style="--d:' + (0.35 + i * 0.6) + 's"><span class="msl-scheck">' + icon('verify') + '</span><span>' + s2 + '</span></div>' +
                (i < steps.length - 1 ? '<div class="msl-sline" style="--d:' + (0.62 + i * 0.6) + 's"></div>' : '');
            }).join('') + '</div>' +
          '</div>';
      } },

    // HERO — public proof. Bigger than before: the verification should be the
    // largest thing on screen, not smaller than its own caption.
    { id: 'verify', dur: 4400, fw: 660, cap: 'Verified on-chain — proof anyone can check',
      vo: 'Verified on-chain. Proof anyone can check.',
      build: function (c) {
        c.innerHTML =
          '<div class="msl-onchain msl-onchain--lg msl-zoomin">' +
            '<div class="msl-check-big">' + icon('verify') + '</div>' +
            '<div class="msl-oc-title">tesSUCCESS · XRPL mainnet</div>' +
            '<div class="msl-oc-rows">' +
              [['Amount', '$34,650 RLUSD'], ['Ledger', 'validated'], ['Proof', 'publicly verifiable']]
              .map(function (r, i) { return '<div class="msl-oc-r" style="--d:' + (0.55 + i * 0.34) + 's"><span>' + r[0] + '</span><b>' + r[1] + '</b></div>'; }).join('') +
            '</div>' +
          '</div>';
      } },

    // CLOSE — the last impression is MainStreet's value, with the ledger proof
    // reduced to a footnote beneath it. Ending on the XRPL screen alone left the
    // film feeling like a blockchain demo rather than a property product.
    { id: 'brand', dur: 3200, fw: 760, cap: '', end: true,
      vo: 'MainStreet. The verified memory for every commercial property.',
      build: function (c) {
        c.innerHTML =
          '<div class="msl-close">' +
            '<div class="msl-close-mark msl-blin">Main<span>Street</span></div>' +
            '<div class="msl-close-line" style="--d:.7s">The verified memory for<br><em>every commercial property.</em></div>' +
            '<div class="msl-close-proof" style="--d:1.5s"><span class="msl-close-dot"></span>Settlement verified on the XRP Ledger</div>' +
          '</div>';
      } },
  ];

  function narrationCues() {
    var t = 0;
    return SCENES.map(function (s) {
      var cue = { id: s.id, atMs: t, durMs: s.dur, line: s.vo || '', caption: s.cap || '' };
      t += s.dur;
      return cue;
    });
  }
  function narrationScript() {
    return narrationCues().map(function (c) {
      var sec = (c.atMs / 1000).toFixed(1);
      return sec + 's  (' + (c.durMs / 1000).toFixed(1) + 's)  ' + c.line;
    }).join('\n');
  }

  // ── mount ──────────────────────────────────────────────────────────────────
  var root = null, cineEl = null, canvas = null, capEl = null, tlEl = null, endEl = null;
  var state = { i: 0, playing: false, timer: null };
  var onExit = null;

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var css = [
      // shared tokens
      '#msLanding{position:fixed;inset:0;z-index:99000;display:none;overflow-y:auto;color:var(--pa);',
      'background:radial-gradient(1200px 700px at 80% -12%,rgba(201,151,58,.10),transparent 60%),var(--ink);}',
      '@keyframes mslFade{from{opacity:0}to{opacity:1}}',
      // hero (unchanged premium)
      '.msl-logo{font-weight:700;font-size:1.1rem;letter-spacing:-.02em;}.msl-logo b{color:var(--gold);}',
      '.msl-nav-signin{background:none;border:none;color:var(--mut);font:inherit;font-size:.9rem;font-weight:500;cursor:pointer;padding:8px;transition:color .2s;}.msl-nav-signin:hover{color:var(--pa);}',
      '.msl-eyebrow{display:inline-flex;align-items:center;gap:9px;font-family:ui-monospace,"SF Mono",Menlo,monospace;font-size:.72rem;letter-spacing:.18em;text-transform:uppercase;color:var(--goldl);margin-bottom:30px;padding:8px 16px;border:1px solid rgba(201,151,58,.32);background:rgba(201,151,58,.08);border-radius:999px;opacity:0;animation:mslUp .7s .05s ease forwards;}',
      '.msl-eyebrow::before{content:"";width:5px;height:5px;border-radius:50%;background:var(--gold);box-shadow:0 0 0 3px rgba(201,151,58,.16);}',
      '.msl-h1 em{font-style:normal;color:var(--gold);}',
      '.msl-lede{font-size:clamp(1.05rem,2vw,1.35rem);line-height:1.55;color:var(--mut);max-width:44ch;margin:24px auto 0;opacity:0;animation:mslUp .85s .3s ease forwards;}',
      '.msl-lede em{color:var(--pa);font-style:normal;font-weight:500;}',
      // problem/value section (marketing) — matches hero language, no new animation system
      '.msl-why-h{font-size:clamp(1.4rem,3vw,2.1rem);font-weight:700;letter-spacing:-.025em;color:var(--pa);margin:0 0 30px;text-wrap:balance;}',
      '.msl-why-head:focus-visible{outline:2px solid var(--gold);outline-offset:2px;border-radius:12px;}',
      '.msl-why-ic{width:34px;height:34px;border-radius:9px;flex:none;display:grid;place-items:center;background:rgba(201,151,58,.1);color:var(--gold);}.msl-why-ic svg{width:18px;height:18px;}',
      '.msl-why-item[open] .msl-why-chev{transform:rotate(180deg);color:var(--gold);}',
      '.msl-why-cta{font-size:clamp(1.05rem,2.2vw,1.35rem);font-weight:600;letter-spacing:-.01em;color:var(--pa);margin:30px auto 0;max-width:34ch;}',
      '.msl-why-cta b,.msl-why-cta em{color:var(--gold);font-style:normal;}',
      '.msl-btn{font:inherit;font-size:1rem;font-weight:600;border-radius:12px;padding:14px 26px;cursor:pointer;border:1px solid transparent;transition:transform .18s,filter .18s,border-color .2s,color .2s,background .2s;display:inline-flex;align-items:center;gap:9px;}',
      '.msl-btn:hover{transform:translateY(-1px);}.msl-btn:focus-visible{outline:2px solid var(--gold);outline-offset:3px;}',
      '.msl-btn--primary{background:var(--gold);color:#0b0e15;box-shadow:0 14px 34px -14px rgba(201,151,58,.65);}.msl-btn--primary:hover{filter:brightness(1.07);}',
      '.msl-btn--ghost{background:rgba(255,255,255,.045);color:var(--pa);border-color:rgba(255,255,255,.14);}.msl-btn--ghost:hover{border-color:rgba(255,255,255,.32);}',
      '.msl-btn--text{background:none;color:var(--mut);}.msl-btn--text:hover{color:var(--pa);}',
      '.msl-trust{margin:34px 0 0;font-family:ui-monospace,"SF Mono",Menlo,monospace;font-size:.72rem;letter-spacing:.06em;color:var(--dim);display:inline-flex;align-items:center;gap:10px;opacity:0;animation:mslUp .85s .56s ease forwards;}',
      '.msl-trust .msl-dot{width:6px;height:6px;border-radius:50%;background:var(--grn);box-shadow:0 0 0 3px rgba(52,192,138,.18);}',
      '.msl-ric{width:40px;height:40px;border-radius:11px;display:grid;place-items:center;background:#0f1520;border:1px solid rgba(255,255,255,.08);color:var(--mut);position:relative;z-index:1;transition:color .2s,border-color .2s;}.msl-ric svg{width:20px;height:20px;}',
      '.msl-rstep:hover .msl-ric{color:var(--gold);border-color:rgba(201,151,58,.4);}',
      '.msl-rlabel{font-size:.7rem;color:var(--dim);}',
      '@keyframes mslUp{from{opacity:0;transform:translateY(22px)}to{opacity:1;transform:none}}',
      '@media(max-width:720px){.msl-cta{flex-direction:column;width:100%;max-width:340px;margin-left:auto;margin-right:auto;}.msl-btn{justify-content:center;width:100%;}.msl-rail{display:none;}}',
      // ── cinematic film ──
      '.msl-cine{position:fixed;inset:0;z-index:99001;display:none;flex-direction:column;align-items:center;justify-content:center;',
      '.msl-cine.msl-on{display:flex;animation:mslFade .45s ease both;}',
      '.msl-cine-close{position:absolute;top:22px;right:26px;z-index:6;background:rgba(255,255,255,.05);border:none;color:var(--mut);font-size:1rem;width:36px;height:36px;border-radius:50%;cursor:pointer;display:grid;place-items:center;transition:background .2s,color .2s;}',
      '.msl-cine-close:hover{background:rgba(255,255,255,.12);color:var(--pa);}',
      // device frame — stays put, content transforms → continuous product feel
      '.msl-dev{width:min(880px,94vw);border-radius:16px;overflow:hidden;border:1px solid rgba(255,255,255,.1);background:#0c111a;box-shadow:0 60px 130px -50px rgba(0,0,0,.9),0 0 0 1px rgba(255,255,255,.02);}',
      '.msl-dev-bar{display:flex;align-items:center;gap:7px;padding:12px 16px;border-bottom:1px solid rgba(255,255,255,.06);background:#0a0e16;}',
      '.msl-dev-bar>i{width:11px;height:11px;border-radius:50%;background:rgba(255,255,255,.14);}',
      '.msl-dev-url{margin-left:14px;font-family:ui-monospace,"SF Mono",Menlo,monospace;font-size:.72rem;color:var(--dim);}',
      '.msl-canvas{position:relative;height:min(52vh,460px);overflow:hidden;background:#0b0f17;}',
      '.msl-canvas>*{animation:mslCanvasIn .7s cubic-bezier(.2,.7,.2,1) both;}',
      '@keyframes mslCanvasIn{from{opacity:0;transform:scale(1.015);filter:blur(4px)}to{opacity:1;transform:none;filter:blur(0)}}',
      '.msl-bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:top;}',
      '.msl-bg-dim{filter:brightness(.4) saturate(.9);}',
      '.msl-cap{margin:26px 0 0;font-size:clamp(1.05rem,2.2vw,1.5rem);font-weight:600;letter-spacing:-.02em;color:var(--pa);text-align:center;min-height:1.6em;transition:opacity .38s ease,transform .38s cubic-bezier(.2,.7,.2,1);}',
      // ── Cinematic primitives ────────────────────────────────────────────
      // One easing curve carries the whole film: expo-out. Motion decelerates
      // hard into place, which is what separates "composed" from "slid in".
      '.msl-cine{--ez:cubic-bezier(.16,1,.3,1);}',
      // Ken Burns: the frame is never perfectly still, so a scene reads as a
      // shot rather than a slide.
      '.msl-ken{animation:mslKen 9s ease-out both;}',
      '@keyframes mslKen{from{transform:scale(1.06)}to{transform:scale(1.13)}}',
      // Vignette + spotlight darken the periphery so the eye lands on the
      // subject instead of scanning the whole UI equally.
      '.msl-vig{position:absolute;inset:0;pointer-events:none;background:radial-gradient(ellipse at 50% 46%,transparent 34%,rgba(0,0,0,.55) 78%,rgba(0,0,0,.82) 100%);}',
      '.msl-vig--tight{background:radial-gradient(ellipse at 50% 46%,transparent 18%,rgba(0,0,0,.72) 62%,rgba(0,0,0,.92) 100%);}',
      // Every scene enters already composed — scaled and settling, never empty.
      '.msl-zoomin{animation:mslZoomIn .9s var(--ez,cubic-bezier(.16,1,.3,1)) both;}',
      '@keyframes mslZoomIn{from{opacity:0;transform:scale(.965) translateY(10px)}to{opacity:1;transform:none}}',
      // Hero numbers resolve out of blur — the "celebrate it" treatment.
      '.msl-blin{animation:mslBlurIn 1.1s var(--ez,cubic-bezier(.16,1,.3,1)) both;}',
      '@keyframes mslBlurIn{from{opacity:0;filter:blur(14px);transform:scale(.94)}to{opacity:1;filter:blur(0);transform:none}}',
      '.msl-bignum-sub{margin-top:10px;font-size:.82rem;letter-spacing:.05em;text-transform:uppercase;color:var(--mut);opacity:0;animation:mslUp .7s var(--ez,ease) both;animation-delay:var(--d,0s);}',
      // The clause highlight sweeps slowly enough to read.
      '.msl-hl--slow{animation-duration:1.5s!important;}',
      '.msl-cite{margin-top:12px;font-size:.75rem;letter-spacing:.06em;text-transform:uppercase;color:var(--gold);opacity:0;animation:mslUp .6s var(--ez,ease) both;animation-delay:var(--d,0s);}',
      '.msl-askq{color:var(--gold);}',
      // Reconciliation gains a third column so the cap adjustment is visible —
      // the saving is the story, not the allocated figure.
      '.msl-arow--3{grid-template-columns:1fr auto auto;gap:18px;}',
      '.msl-capadj{color:#7BE3A6;font-style:normal;font-weight:600;font-size:.9rem;}',
      // Property Timeline: events accrue down a rail as time compresses.
      '.msl-tl{position:relative;width:min(660px,90vw);padding:22px 26px;border-radius:14px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);}',
      '.msl-tl-h{font-size:.72rem;letter-spacing:.16em;text-transform:uppercase;color:var(--mut);margin-bottom:16px;}',
      '.msl-tl-rail{position:absolute;left:34px;top:56px;bottom:52px;width:1px;background:linear-gradient(180deg,transparent,rgba(216,184,114,.5),transparent);}',
      '.msl-tl-row{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:12px;padding:9px 0;opacity:0;animation:mslUp .6s var(--ez,ease) both;animation-delay:var(--d,0s);}',
      '.msl-tl-dot{width:9px;height:9px;border-radius:50%;background:var(--gold);box-shadow:0 0 0 4px rgba(216,184,114,.14);}',
      '.msl-tl-t{color:var(--pa);font-weight:600;font-size:.95rem;}',
      '.msl-tl-row em{font-style:normal;color:var(--mut);font-size:.82rem;}',
      // Per-scene composition. Each scene declares its own `fw`, applied here as
      // --fw, so the block that should dominate is sized for that beat rather
      // than to one global percentage. Nothing reads cropped or oversized.
      '.msl-canvas{--fw:760px;}',
      // Scoped under .msl-cine: the base scene rules are emitted later in this
      // array, so an unscoped rule loses on source order.
      '.msl-cine .msl-alloc,.msl-cine .msl-stmt,.msl-cine .msl-tl,.msl-cine .msl-onchain,.msl-cine .msl-settle,.msl-cine .msl-close{width:min(var(--fw),92%);max-width:none;}',
      '.msl-cine .msl-lease{width:min(var(--fw),94%);max-width:none;}',
      // Reconciliation: the prevented column is the subject, so it gets the
      // emphasis and a plain-language summary beneath.
      '.msl-arow--3{display:grid;grid-template-columns:1.5fr auto auto;gap:26px;align-items:center;}',
      '.msl-capadj{color:#7BE3A6;font-style:normal;font-weight:700;font-size:1rem;letter-spacing:-.01em;text-align:right;min-width:5.5em;}',
      '.msl-alloc-note{margin-top:16px;padding-top:14px;border-top:1px solid rgba(255,255,255,.08);font-size:.95rem;color:var(--mut);opacity:0;animation:mslUp .7s var(--ez,ease) both;animation-delay:var(--d,0s);}',
      '.msl-alloc-note b{color:#7BE3A6;font-size:1.1rem;}',
      // Revenue hero: dead centre in the frame, no competing background.
      // Centred by FLEX, not by transform. .msl-blin's keyframes end on
      // transform:none, which silently wipes a translate(-50%,-50%) the moment
      // the animation completes — the number drifted half a canvas off-centre.
      // The animation owns transform; layout must not depend on it.
      // Scoped under .msl-cine so this wins regardless of where it lands in the
      // stylesheet — the base .msl-bignum is emitted later in the array.
      '.msl-cine .msl-bignum--center{position:static;left:auto;top:auto;transform:none;text-align:center;width:min(var(--fw),92%);}',
      '.msl-cine .msl-spot--center{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:120%;height:120%;background:radial-gradient(ellipse at center,rgba(123,227,166,.10),transparent 62%);}',
      // Verification: the largest thing on screen, not smaller than its caption.
      '.msl-cine .msl-onchain--lg{transform:scale(1.14);transform-origin:center;}',
      // Brand close — the last impression is MainStreet, ledger proof beneath.
      '.msl-close{display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:18px;}',
      '.msl-close-mark{font-size:clamp(2.2rem,5vw,3.4rem);font-weight:800;letter-spacing:-.035em;color:var(--pa);}',
      '.msl-close-mark span{background:linear-gradient(120deg,#EBD49A,#C9A254 55%,#E4C57F);-webkit-background-clip:text;background-clip:text;color:transparent;}',
      '.msl-close-line{font-size:clamp(1.05rem,2.2vw,1.5rem);line-height:1.35;color:var(--pa);font-weight:600;letter-spacing:-.02em;opacity:0;animation:mslUp .8s var(--ez,ease) both;animation-delay:var(--d,0s);}',
      '.msl-close-line em{font-style:normal;background:linear-gradient(120deg,#EBD49A,#C9A254 55%,#E4C57F);-webkit-background-clip:text;background-clip:text;color:transparent;}',
      '.msl-close-proof{display:inline-flex;align-items:center;gap:9px;font-size:.8rem;letter-spacing:.05em;text-transform:uppercase;color:var(--mut);opacity:0;animation:mslUp .7s var(--ez,ease) both;animation-delay:var(--d,0s);}',
      '.msl-close-dot{width:7px;height:7px;border-radius:50%;background:#7BE3A6;box-shadow:0 0 0 4px rgba(123,227,166,.16);}',
      // Progress: one continuous line, not nine chapter ticks. Ticks made a 44s
      // film read like a task bar.
      '.msl-timeline{position:relative;width:min(880px,94vw);height:2px;margin:20px 0 0;background:rgba(255,255,255,.1);border-radius:2px;overflow:hidden;}',
      '.msl-prog{position:absolute;inset:0 auto 0 0;width:0;background:linear-gradient(90deg,rgba(216,184,114,.5),var(--gold));transition:width .45s linear;}',
      // Mobile: the end card must sit BELOW the caption with real spacing. Its
      // buttons wrapped to 232px tall on a narrow screen and rode up over the
      // caption — 13,680px² of overlap, invisible at desktop widths.
      '@media (max-width:720px){',
      '  .msl-cine-end{position:static!important;flex-wrap:wrap;justify-content:center;gap:10px;margin:18px 0 8px;padding:0 12px;}',
      '  .msl-cap{margin-bottom:4px;}',
      '  .msl-onchain--lg{transform:none;}',
      '}',
      '.msl-tseg{flex:1;height:2px;border-radius:2px;background:rgba(255,255,255,.12);overflow:hidden;}',
      '.msl-tseg-f{height:100%;width:0;background:var(--gold);}',
      '.msl-tseg.msl-tdone .msl-tseg-f{width:100%;}',
      '.msl-tseg.msl-tcur .msl-tseg-f{animation:mslSeg linear forwards;}',
      '@keyframes mslSeg{from{width:0}to{width:100%}}',
      '.msl-cine-end{position:absolute;left:0;right:0;bottom:26px;display:flex;gap:12px;justify-content:center;flex-wrap:wrap;opacity:0;transition:opacity .5s;pointer-events:none;z-index:6;}',
      '.msl-cine-end.msl-show{opacity:1;pointer-events:auto;}',
      // scene: upload
      '.msl-drop{position:absolute;left:50%;top:52%;transform:translate(-50%,-50%);width:280px;text-align:center;background:rgba(11,15,23,.82);border:1.5px dashed rgba(201,151,58,.5);border-radius:16px;padding:26px 20px;backdrop-filter:blur(2px);}',
      '.msl-drop-ic{width:44px;height:44px;margin:0 auto 12px;color:var(--gold);}.msl-drop-ic svg{width:44px;height:44px;stroke-width:1.3;}',
      '.msl-drop-t{color:var(--mut);font-size:.9rem;}',
      '.msl-drop-bar{margin:16px auto 0;width:80%;height:4px;border-radius:3px;background:rgba(255,255,255,.1);overflow:hidden;}',
      '.msl-drop-bar i{display:block;height:100%;width:0;background:var(--gold);animation:mslFill 2.4s 1.2s cubic-bezier(.4,0,.2,1) forwards;}',
      '@keyframes mslFill{to{width:100%}}',
      '.msl-doc-fly{position:absolute;left:50%;top:-40px;transform:translateX(-50%);white-space:nowrap;font-family:ui-monospace,"SF Mono",Menlo,monospace;font-size:.72rem;color:var(--pa);background:#141c2b;border:1px solid rgba(255,255,255,.12);border-radius:8px;padding:7px 12px;opacity:0;animation:mslDrop 1.3s var(--d) cubic-bezier(.4,0,.2,1) forwards;}',
      '@keyframes mslDrop{0%{opacity:0;transform:translate(calc(-50% + var(--x)),-40px) rotate(-4deg)}30%{opacity:1}100%{opacity:0;transform:translate(-50%,150px) scale(.7)}}',
      // scene: extract
      '.msl-lease{display:flex;gap:20px;height:100%;padding:26px 30px;align-items:center;}',
      '.msl-lease-doc{position:relative;flex:1.3;background:#0f1520;border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:20px 22px;height:82%;overflow:hidden;}',
      '.msl-ln{font-size:.82rem;color:#B8C0CC;line-height:1.9;opacity:0;animation:mslUp .5s var(--d) ease forwards;}',
      '.msl-ln:nth-child(3),.msl-ln:nth-child(4){color:var(--goldl);font-weight:600;}',
      '.msl-hl{position:absolute;left:22px;right:22px;height:26px;top:56px;border-radius:5px;background:rgba(201,151,58,.16);border-left:2px solid var(--gold);opacity:0;animation:mslSweep 2.6s 1.2s ease-in-out;}',
      '@keyframes mslSweep{0%{opacity:0;top:56px}20%{opacity:1}50%{opacity:1;top:90px}80%{opacity:1;top:118px}100%{opacity:0;top:118px}}',
      '.msl-fields{flex:1;display:flex;flex-direction:column;gap:9px;}',
      '.msl-field{display:flex;align-items:center;gap:8px;background:#0f1520;border:1px solid rgba(255,255,255,.08);border-radius:9px;padding:10px 13px;font-size:.82rem;opacity:0;transform:translateY(8px);animation:mslPop .5s var(--d) cubic-bezier(.2,1.3,.4,1) forwards;}',
      '.msl-field span{color:var(--mut);}.msl-field b{margin-left:auto;color:var(--pa);}',
      '.msl-verify-dot{width:8px;height:8px;border-radius:50%;background:var(--grn);box-shadow:0 0 0 3px rgba(52,192,138,.18);}',
      '@keyframes mslPop{to{opacity:1;transform:none}}',
      // scene: match
      '.msl-match{position:relative;display:flex;height:100%;align-items:center;justify-content:space-between;padding:28px 26px;}',
      '.msl-col{display:flex;flex-direction:column;gap:14px;width:150px;z-index:1;}',
      '.msl-node{font-size:.76rem;background:#0f1520;border:1px solid rgba(255,255,255,.1);border-radius:8px;padding:9px 11px;color:#C6CEDA;opacity:0;transform:translateX(var(--tx,0));animation:mslNode .5s var(--d) ease forwards;}',
      '.msl-col-l .msl-node{--tx:-16px;font-family:ui-monospace,"SF Mono",Menlo,monospace;}.msl-col-r .msl-node{--tx:16px;text-align:right;}',
      '@keyframes mslNode{to{opacity:1;transform:none}}',
      '.msl-wires{position:absolute;inset:0;width:100%;height:100%;z-index:0;}',
      '.msl-wire{fill:none;stroke:var(--gold);stroke-width:1.4;opacity:.55;stroke-dasharray:600;stroke-dashoffset:600;animation:mslDraw 1s var(--d) ease forwards;filter:drop-shadow(0 0 3px rgba(201,151,58,.45));}',
      '@keyframes mslDraw{to{stroke-dashoffset:0}}',
      // scene: reconcile
      '.msl-alloc{max-width:560px;margin:0 auto;height:100%;display:flex;flex-direction:column;justify-content:center;padding:0 34px;}',
      '.msl-alloc-head{display:flex;justify-content:space-between;font-family:ui-monospace,"SF Mono",Menlo,monospace;font-size:.68rem;letter-spacing:.1em;text-transform:uppercase;color:var(--dim);padding:0 4px 10px;}',
      '.msl-arow{display:flex;justify-content:space-between;align-items:center;padding:11px 4px;border-top:1px solid rgba(255,255,255,.06);font-size:.9rem;opacity:0;transform:translateY(8px);animation:mslPop .5s var(--d) ease forwards;}',
      '.msl-arow b{font-variant-numeric:tabular-nums;color:var(--pa);}',
      '.msl-atotal{border-top:1.5px solid rgba(201,151,58,.4);margin-top:4px;}.msl-atotal span{font-weight:600;}.msl-atotal b{color:var(--goldl);font-size:1.05rem;}',
      // scene: recover
      '.msl-spot{position:absolute;inset:0;background:radial-gradient(360px 260px at 32% 42%,transparent,rgba(5,7,12,.55) 70%);}',
      '.msl-bignum{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);text-align:center;}',
      '.msl-bignum-v{font-size:clamp(3rem,8vw,5rem);font-weight:800;letter-spacing:-.03em;color:var(--grn);font-variant-numeric:tabular-nums;text-shadow:0 0 40px rgba(52,192,138,.35);}',
      '.msl-bignum-l{margin-top:8px;font-size:.9rem;color:var(--mut);letter-spacing:.02em;}',
      // scene: statement
      '.msl-stmt{max-width:520px;margin:0 auto;height:100%;display:flex;flex-direction:column;justify-content:center;padding:0 34px;}',
      '.msl-stmt-head,.msl-stmt-row,.msl-stmt-total,.msl-stmt-cite{opacity:0;transform:translateY(8px);animation:mslPop .5s var(--d) ease forwards;}',
      '.msl-stmt-head{display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:14px;border-bottom:1px solid rgba(255,255,255,.08);}',
      '.msl-stmt-head b{font-size:1.05rem;}.msl-stmt-head span{display:block;color:var(--dim);font-size:.76rem;margin-top:3px;}',
      '.msl-stmt-badge{font-size:.7rem;color:var(--grn);border:1px solid rgba(52,192,138,.35);background:rgba(52,192,138,.1);border-radius:6px;padding:4px 9px;}',
      '.msl-stmt-row{display:flex;justify-content:space-between;padding:9px 2px;font-size:.88rem;color:#C6CEDA;}.msl-stmt-row b{color:var(--pa);font-variant-numeric:tabular-nums;}',
      '.msl-stmt-total{display:flex;justify-content:space-between;padding:12px 2px 8px;border-top:1.5px solid rgba(201,151,58,.4);margin-top:4px;font-weight:600;}.msl-stmt-total b{color:var(--goldl);}',
      '.msl-stmt-cite{font-size:.74rem;color:var(--dim);text-align:center;margin-top:8px;}',
      // scene: settle
      '.msl-settle{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:26px;}',
      '.msl-settle-amt{font-size:clamp(2rem,6vw,3.4rem);font-weight:800;letter-spacing:-.02em;color:var(--goldl);animation:mslAmt 1s .2s cubic-bezier(.2,1.3,.4,1) both;}',
      '@keyframes mslAmt{from{opacity:0;transform:scale(.7)}to{opacity:1;transform:none}}',
      '.msl-steps{display:flex;align-items:center;flex-wrap:wrap;justify-content:center;gap:0;max-width:640px;}',
      '.msl-sstep2{display:flex;align-items:center;gap:8px;font-size:.82rem;color:#C6CEDA;opacity:0;transform:scale(.9);animation:mslPop .5s var(--d) cubic-bezier(.2,1.3,.4,1) forwards;padding:6px 4px;}',
      '.msl-scheck{width:24px;height:24px;border-radius:50%;display:grid;place-items:center;color:var(--grn);background:rgba(52,192,138,.14);}.msl-scheck svg{width:14px;height:14px;}',
      '.msl-sline{width:34px;height:2px;background:rgba(52,192,138,.35);transform-origin:left;transform:scaleX(0);animation:mslLine .5s var(--d) ease forwards;}',
      '@keyframes mslLine{to{transform:scaleX(1)}}',
      // scene: verify
      '.msl-onchain{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:0 24px;}',
      '.msl-check-big{width:80px;height:80px;border-radius:50%;display:grid;place-items:center;color:var(--grn);background:rgba(52,192,138,.14);border:1px solid rgba(52,192,138,.3);animation:mslCheckPop .7s cubic-bezier(.2,1.5,.4,1) both;}.msl-check-big svg{width:40px;height:40px;}',
      '@keyframes mslCheckPop{from{opacity:0;transform:scale(0)}to{opacity:1;transform:none}}',
      '.msl-oc-title{font-family:ui-monospace,"SF Mono",Menlo,monospace;font-size:.86rem;color:var(--grn);letter-spacing:.04em;opacity:0;animation:mslUp .5s .4s ease forwards;}',
      '.msl-oc-rows{width:min(420px,84vw);margin-top:6px;}',
      '.msl-oc-r{display:flex;justify-content:space-between;padding:9px 2px;border-top:1px solid rgba(255,255,255,.07);font-size:.82rem;}',
      '.msl-oc-r span{color:var(--mut);}.msl-oc-r b{font-family:ui-monospace,"SF Mono",Menlo,monospace;color:var(--pa);min-height:1em;}',
      // ── final polish: dynamic numbers + mobile readability ──
      '.msl-arow b,.msl-atotal b,.msl-bignum-v,.msl-stmt-row b,.msl-stmt-total b,.msl-settle-amt,.msl-oc-r b{font-variant-numeric:tabular-nums;}',
      '.msl-landed{animation:mslLand .45s cubic-bezier(.2,1.4,.4,1);}',
      '@keyframes mslLand{35%{transform:scale(1.07)}100%{transform:scale(1)}}',
      '.msl-bignum-v.msl-landed{animation:mslLandGlow .5s ease;}',
      '@keyframes mslLandGlow{35%{transform:scale(1.05);text-shadow:0 0 60px rgba(52,192,138,.6)}100%{transform:scale(1)}}',
      '.msl-settle-amt{text-shadow:0 0 34px rgba(228,183,92,.22);}',
      '.msl-atotal b{transition:color .3s;}',
      '.msl-drop{animation:mslDropSettle .6s 3.5s ease both;}',
      '@keyframes mslDropSettle{40%{border-color:rgba(52,192,138,.65)}100%{border-color:rgba(52,192,138,.45)}}',
        '.msl-canvas{height:46vh;min-height:300px;}',
        '.msl-cap{font-size:1.08rem;padding:0 14px;margin-top:20px;}',
        '.msl-btn{min-height:46px;}',
        '.msl-col{width:118px;}.msl-node{font-size:.66rem;padding:7px 8px;}',
        '.msl-match{padding:18px 12px;}',
        '.msl-lease{flex-direction:column;padding:14px 16px;gap:10px;align-items:stretch;overflow-y:auto;}',
        '.msl-lease-doc{flex:none;height:auto;padding:12px 14px;}.msl-ln{font-size:.7rem;line-height:1.65;}',
        '.msl-hl{display:none;}',
        '.msl-fields{flex-direction:row;flex-wrap:wrap;gap:7px;}.msl-field{font-size:.7rem;padding:8px 10px;flex:1 1 45%;}',
        '.msl-alloc{padding:0 18px;}.msl-arow{font-size:.82rem;padding:9px 2px;}',
        '.msl-stmt{padding:0 18px;}.msl-stmt-row{font-size:.82rem;}',
        '.msl-bignum-l{font-size:.8rem;padding:0 10px;}',
        '.msl-steps{max-width:92vw;}.msl-sstep2{font-size:.74rem;}.msl-sline{width:16px;}',
        '.msl-oc-rows{width:92vw;}.msl-oc-r{font-size:.74rem;}.msl-oc-r b{font-size:.7rem;}',
        '.msl-timeline{gap:3px;}',
      '}',
      // This module's root IS the film layer, not a child of a landing overlay,
      // so it owns full-screen positioning itself.
      '.pf-root{position:fixed;inset:0;z-index:99900;display:none;background:#050709;',
      '  align-items:center;justify-content:center;flex-direction:column;padding:28px 16px;overflow-y:auto;}',
      '.pf-root.msl-on{display:flex;}',
      '.pf-root .msl-dev{width:min(1040px,96vw);}',
    ].join('');
    var st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = css;
    document.head.appendChild(st);
  }

  function build() {
    if (root) return;
    injectStyles();
    root = document.createElement('div');
    root.className = 'msl-cine pf-root';
    root.id = 'pfFilm';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', 'MainStreet product film');
    root.innerHTML =
      '<button class="msl-cine-close" id="pfClose" aria-label="Close">\u2715</button>' +
      '<div class="msl-dev"><div class="msl-dev-bar"><i></i><i></i><i></i>' +
        '<span class="msl-dev-url" id="pfUrl">mainstreetcam.com</span></div>' +
        '<div class="msl-canvas" id="pfCanvas"></div></div>' +
      '<div class="msl-cap" id="pfCap"></div>' +
      '<div class="msl-timeline" id="pfTimeline"></div>' +
      '<div class="msl-cine-end" id="pfEnd"></div>';
    document.body.appendChild(root);
    cineEl = root; canvas = root.querySelector('#pfCanvas');
    capEl = root.querySelector('#pfCap'); tlEl = root.querySelector('#pfTimeline');
    endEl = root.querySelector('#pfEnd');
    root.querySelector('#pfClose').addEventListener('click', stop);
    document.addEventListener('keydown', onKey);
  }

  function onKey(e) {
    if (!root || !root.classList.contains('msl-on')) return;
    if (e.key === 'Escape') stop();
    else if (e.key === 'ArrowRight' && state.i < SCENES.length - 1) { clearTimeout(state.timer); state.i++; renderScene(); }
    else if (e.key === 'ArrowLeft' && state.i > 0) { clearTimeout(state.timer); state.i--; renderScene(); }
  }

  function renderScene() {
    clearTimeout(state.timer);
    var s = SCENES[state.i];
    capEl.style.opacity = '0'; capEl.style.transform = 'translateY(6px)';
    var urlEl = root.querySelector('#pfUrl');
    if (urlEl) urlEl.textContent = (typeof URLS !== 'undefined' && URLS[s.id]) || 'mainstreetcam.com';
    canvas.style.setProperty('--fw', (s.fw || 760) + 'px');
    canvas.innerHTML = '';
    var wrap = document.createElement('div');
    wrap.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center';
    canvas.appendChild(wrap);
    s.build(wrap);
    setTimeout(function () {
      capEl.textContent = s.cap || '';
      capEl.style.opacity = s.cap ? '1' : '0';
      capEl.style.transform = 'translateY(0)';
    }, 260);
    if (!tlEl.querySelector('.msl-prog')) tlEl.innerHTML = '<i class="msl-prog"></i>';
    var elapsed = SCENES.slice(0, state.i).reduce(function (a, sc) { return a + sc.dur; }, 0);
    var total = SCENES.reduce(function (a, sc) { return a + sc.dur; }, 0);
    var bar = tlEl.querySelector('.msl-prog');
    if (bar) bar.style.width = Math.min(100, ((elapsed + s.dur) / total) * 100) + '%';
    endEl.classList.remove('msl-show');
    if (state.playing) {
      if (state.i < SCENES.length - 1) state.timer = setTimeout(function () { state.i++; renderScene(); }, s.dur);
      else state.timer = setTimeout(showEnd, s.dur);
    } else if (s.end) setTimeout(showEnd, 300);
  }

  function showEnd() {
    endEl.innerHTML =
      '<button class="msl-btn msl-btn--primary" id="pfEndPilot">Request a Pilot</button>' +
      '<button class="msl-btn msl-btn--ghost" id="pfEndVerify">Verify on XRPL \u2197</button>' +
      '<button class="msl-btn msl-btn--text" id="pfEndReplay">Replay</button>' +
      '<button class="msl-btn msl-btn--text" id="pfEndBack">\u2190 Back to site</button>';
    endEl.classList.add('msl-show');
    endEl.querySelector('#pfEndPilot').addEventListener('click', function () {
      stop();
      var cta = document.querySelector('a[href^="mailto:"]');
      if (cta) cta.click();
    });
    endEl.querySelector('#pfEndVerify').addEventListener('click', function () { window.open(EXPLORER, '_blank', 'noopener'); });
    endEl.querySelector('#pfEndReplay').addEventListener('click', function () { state.i = 0; state.playing = true; renderScene(); });
    endEl.querySelector('#pfEndBack').addEventListener('click', stop);
  }

  // Composed first, revealed second — the frame is never empty on open.
  function play(opts) {
    // Idempotent. maybeShow() can reach open() from more than one path, and a
    // second play() started a second advance timer — the film ran at double
    // speed and skipped beats.
    if (state.playing && root && root.classList.contains('msl-on')) return;
    onExit = (opts && opts.onExit) || null;
    build();
    state.i = 0; state.playing = true;
    renderScene();
    root.classList.add('msl-on');
    document.body.style.overflow = 'hidden';
  }

  function stop() {
    clearTimeout(state.timer);
    state.playing = false;
    if (root) root.classList.remove('msl-on');
    document.body.style.overflow = '';
    if (onExit) { try { onExit(); } catch (e) {} }
  }

  window.ProductFilm = {
    play: play, stop: stop,
    narrationCues: narrationCues,
    narrationScript: narrationScript,
    scenes: function () { return SCENES.map(function (s) { return { id: s.id, dur: s.dur, cap: s.cap, vo: s.vo }; }); },
  };
})();
