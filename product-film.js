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
 * business logic. Narration plays from pre-rendered clips in assets/vo/ — one
 * per spoken line, scheduled so no two lines ever overlap.
 *
 *   ProductFilm.play({ onExit })   open and play from the first beat
 *   ProductFilm.stop()             close
 *   ProductFilm.preload()          warm the narration clips before play()
 *   ProductFilm.narrationCues()    [{ id, atMs, durMs, line, caption, audio, startMs, endMs }]
 *   ProductFilm.narrationScript()  the same, formatted for a voice artist
 */
(function () {
  'use strict';

  var EXPLORER = 'https://livenet.xrpl.org/transactions/7FA730B2B78819AE34B3D1B458721FBC52B9CD25E980ED42DD1B15E9F9FC724A';
  var ASSET = 'assets/landing/';
  var STYLE_ID = 'pf-styles';

  // ── narration ───────────────────────────────────────────────────────────────
  // durMs is MEASURED from each rendered mp3 by parsing frame headers, not
  // estimated from the word count. The schedule below depends on the real
  // numbers: two lines run past the scene they belong to, and arithmetic on
  // these values is the only thing keeping them from talking over the next
  // line. test-narration.js re-measures the files and fails if a re-render
  // changes a length, so the table cannot drift away from the audio.
  var VO_DIR = 'assets/vo/';
  var VO_GAP = 250;                      // minimum silence between two lines
  // The first line used to fire at 0ms, over the 450ms fade-in — the voice
  // arrived before the picture did. It now waits until the establishing shot
  // has cut away and the upload screen has settled.
  var VO_LEAD = 600;                     // delay after the first spoken scene opens
  var VO = {
    upload:   { file: 'vo-upload.mp3',   durMs: 4310 },   // overruns its 4.0s scene
    extract:  { file: 'vo-extract.mp3',  durMs: 2640 },
    recon:    { file: 'vo-recon.mp3',    durMs: 2460 },
    recover:  { file: 'vo-recover.mp3',  durMs: 2870 },
    // space and settle are deliberately silent. The script refuses to narrate
    // the UI ("now we're looking at Spaces"), and a breath after the $99,542
    // beat is worth more than a line would be.
    ask:      { file: 'vo-ask.mp3',      durMs: 5510 },   // overruns its 5.2s scene
    timeline: { file: 'vo-timeline.mp3', durMs: 2950 },
    verify:   { file: 'vo-verify.mp3',   durMs: 3600 },
    brand:    { file: 'vo-brand.mp3',    durMs: 4020 },   // runs past the last cut
  };

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
    // The application is the base layer of every beat: real screenshots of the
    // shipping product, with animation layered on top to direct the eye. The
    // previous pass composed minimal cards on black, which read as title slides
    // rather than software doing work.
    //
    // `fw` is the composition width of the overlay content for that beat. `vo`
    // is the narration line spoken over it, rendered to a clip in assets/vo/.

    // Establishing shot. The film used to open mid-workflow on the upload
    // screen with the first line already speaking over the 450ms fade-in, which
    // read as being dropped into the middle of something. This holds the
    // portfolio wide and quiet first so there is a place to be dropped into.
    // The same plate returns under the $99,542 at `recover` — establish the
    // room, then come back to it for the payoff.
    { id: 'open', dur: 1800, fw: 1000, cap: '',
      build: function (c) {
        c.innerHTML =
          '<img class="pf-shot pf-shot--sharp pf-ken" src="' + ASSET + 'ui-command-center.png" alt="">' +
          '<div class="pf-edge"></div>';
      } },

    { id: 'upload', dur: 4000, fw: 780, cap: 'It starts reading the moment a lease lands',
      vo: 'It starts with what you already have. Leases, invoices, statements.',
      build: function (c) {
        c.innerHTML =
          '<img class="pf-shot pf-ken" src="' + ASSET + 'ui-upload.png" alt="">' +
          '<div class="msl-vig"></div>' +
          '<div class="msl-docs">' +
            '<div class="msl-doc-fly" style="--d:.05s;--x:-150px">Lease — Whole Health Market.pdf</div>' +
            '<div class="msl-doc-fly" style="--d:.3s;--x:40px">Invoice — Cascade Handyman.pdf</div>' +
            '<div class="msl-doc-fly" style="--d:.55s;--x:180px">Invoice — Meridian Insurance.pdf</div>' +
          '</div>' +
          // The emphasis is the AI starting work, not the drop target.
          '<div class="pf-worker" style="--d:1.1s">' +
            '<span class="pf-pulse"></span>' +
            '<span class="pf-worker-t">Reading 3 documents · extracting lease terms</span>' +
            '<span class="pf-worker-bar"><i></i></span>' +
          '</div>';
      } },

    // HERO — the clause and the fields it produces, side by side, over the app.
    { id: 'extract', dur: 4800, fw: 960, cap: 'AI reads every clause — and cites it',
      vo: 'MainStreet reads every clause, and tells you which page it came from.',
      build: function (c) {
        c.innerHTML =
          '<img class="pf-shot pf-shot--dim pf-ken" src="' + ASSET + 'ui-workspace.png" alt="">' +
          '<div class="msl-vig"></div>' +
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

    // The REAL reconciliation table, with the real figures the engine computed.
    // A focus band sweeps down the prevented-by-cap column so the eye lands on
    // the savings rather than scanning the whole grid.
    { id: 'recon', dur: 4400, fw: 900, cap: 'Every charge checked against what the lease allows',
      vo: 'Every charge is checked against what the lease actually permits.',
      build: function (c) {
        c.innerHTML =
          '<img class="pf-shot pf-shot--sharp msl-zoomin" src="' + ASSET + 'beat1-cap-catch.png" alt="">' +
          '<div class="pf-focus" style="--d:1.0s;--fx:58%;--fw2:19%"></div>' +
          '<div class="pf-callout pf-callout--top" style="--d:1.9s">Prevented by lease caps</div>' +
          '<div class="pf-total" style="--d:2.9s"><b>$75,549</b> the lease didn’t allow — caught before billing</div>';
      } },

    // HERO — the money, over the Command Center it was computed in.
    { id: 'recover', dur: 4800, fw: 700, cap: 'Revenue you were entitled to recover',
      vo: 'And it finds the revenue you were entitled to recover.',
      build: function (c) {
        c.innerHTML =
          '<img class="pf-shot pf-shot--deep pf-ken" src="' + ASSET + 'ui-command-center.png" alt="">' +
          '<div class="msl-vig msl-vig--tight"></div>' +
          '<div class="msl-spot msl-spot--center"></div>' +
          '<div class="msl-bignum msl-bignum--center msl-blin">' +
            '<div class="msl-bignum-v" id="pfRecover">$0</div>' +
            '<div class="msl-bignum-l">Recoverable revenue identified</div>' +
            '<div class="msl-bignum-sub" style="--d:2.4s">Cap enforcement · exclusions · unbilled vacancy</div>' +
          '</div>';
        setTimeout(function () { countUp(document.getElementById('pfRecover'), 99542, 1600, '$'); }, reduce() ? 0 : 480);
      } },

    // HERO — the REAL Space, with callouts pinned to what matters in it.
    { id: 'space', dur: 4600, fw: 900, cap: 'Open a space — its whole history is there',
      vo: 'Every tenant’s full history lives in one place — not in someone’s inbox.',
      build: function (c) {
        c.innerHTML =
          '<img class="pf-shot pf-shot--sharp pf-shot--top msl-zoomin" src="' + ASSET + 'ui-space-modal.png" alt="">' +
          '<div class="pf-edge"></div>' +
          '<div class="pf-pins">' +
            [['Lease on file', '.9s'], ['CAM allocated · Ready', '1.5s'], ['Open dispute', '2.1s'], ['Documents & photos', '2.7s']]
            .map(function (p2, i) { return '<div class="pf-pin" style="--d:' + p2[1] + '"><span class="pf-pin-dot"></span>' + p2[0] + '</div>'; }).join('') +
          '</div>';
      } },

    // HERO — the REAL AI workspace, question typed in, citations landing.
    { id: 'ask', dur: 5200, fw: 820, cap: 'Ask anything — every answer cites its source',
      vo: 'Ask anything. Every answer cites the document it came from.',
      build: function (c) {
        var hits = [['Whole Health Market', '5% cap · p.2 §6.4'],
                    ['Summit Coffee & Provisions', '8% cap · p.3'],
                    ['FitZone Athletics', '4% cap · p.2']];
        c.innerHTML =
          '<img class="pf-shot pf-shot--dim pf-ken" src="' + ASSET + 'ui-workspace.png" alt="">' +
          '<div class="msl-vig"></div>' +
          '<div class="pf-ask msl-zoomin">' +
            '<div class="pf-ask-bar"><span class="pf-ask-q" id="pfAskQ">&nbsp;</span><span class="pf-ask-go">Ask</span></div>' +
            '<div class="pf-ask-rows">' +
              hits.map(function (it, i) {
                return '<div class="pf-ask-row" style="--d:' + (1.9 + i * 0.3) + 's">' +
                       '<span>' + it[0] + '</span><b>' + it[1] + '</b>' +
                       '<em class="pf-chip">cited</em></div>'; }).join('') +
            '</div>' +
            '<div class="msl-stmt-cite" style="--d:3.3s">Answers come from your documents — never from guesswork.</div>' +
          '</div>';
        typeInto(c.querySelector('#pfAskQ'), 'Which tenants have CAM caps?', 26);
      } },

    { id: 'timeline', dur: 4200, fw: 720, cap: 'Every property keeps a living memory',
      vo: 'And every property keeps a living memory of what happened to it.',
      build: function (c) {
        var ev = [['Lease uploaded', 'Jan 4'], ['CAM reconciliation run', 'Jan 31'],
                  ['Dispute opened — Cascade Handyman', 'Feb 2'], ['Settlement completed', 'Feb 9']];
        c.innerHTML =
          '<img class="pf-shot pf-shot--deep pf-ken" src="' + ASSET + 'ui-command-center.png" alt="">' +
          '<div class="msl-vig"></div>' +
          '<div class="msl-tl msl-zoomin">' +
            '<div class="msl-tl-h">Property Timeline</div>' +
            '<div class="msl-tl-rail"></div>' +
            ev.map(function (e, i) {
              return '<div class="msl-tl-row" style="--d:' + (0.35 + i * 0.5) + 's">' +
                     '<span class="msl-tl-dot"></span><span class="msl-tl-t">' + e[0] + '</span><em>' + e[1] + '</em></div>'; }).join('') +
            '<div class="msl-stmt-cite" style="--d:2.7s">Nothing is lost when someone leaves the company.</div>' +
          '</div>';
      } },

    // The REAL settlement row from the product.
    { id: 'settle', dur: 3600, fw: 820, cap: 'Settled in RLUSD on the XRP Ledger',
      vo: 'And when it’s time to settle, the balance moves in RLUSD.',
      build: function (c) {
        c.innerHTML =
          '<img class="pf-shot pf-shot--sharp msl-zoomin" src="' + ASSET + 'ui-settlement.png" alt="">' +
          '<div class="pf-focus pf-focus--wide" style="--d:.9s;--fx:50%;--fw2:64%"></div>' +
          '<div class="pf-callout" style="--d:1.8s">Verified on-ledger · publicly checkable</div>';
      } },

    // HERO — public proof.
    { id: 'verify', dur: 4400, fw: 660, cap: 'Verified on-chain — proof anyone can check',
      vo: 'Verified on the XRP Ledger. Proof anyone can check.',
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

    { id: 'brand', dur: 4400, fw: 760, cap: '', end: true,
      vo: 'MainStreet. The verified memory for every commercial property.',
      // Mark and tagline, nothing else. This card used to carry a "settlement
      // verified on the XRP Ledger" line as well, which split the last frame
      // between the brand and the proof. The proof is the beat immediately
      // before this one — showing it twice makes the ledger the thing the
      // viewer leaves with. Give the name the frame to itself.
      build: function (c) {
        c.innerHTML =
          '<div class="msl-close msl-close--final">' +
            '<div class="msl-close-mark msl-blin">Main<span>Street</span></div>' +
            '<div class="msl-close-line" style="--d:.9s">The verified memory for<br><em>every commercial property.</em></div>' +
          '</div>';
      } },
  ];

  function narrationCues() {
    var t = 0, prevEnd = -Infinity;
    return SCENES.map(function (s) {
      var cue = { id: s.id, atMs: t, durMs: s.dur, line: s.vo || '', caption: s.cap || '',
                  audio: null, voMs: 0, startMs: null, endMs: null };
      t += s.dur;
      // Anchor each line to its scene, then push it later if the previous line
      // is still speaking. Anchoring naively would put the tail of the opening
      // line on top of the head of the next one — it runs 4.31s inside a 4.0s
      // scene. Every line after an overrun has slack in its own window, so the
      // push absorbs within one scene and never compounds.
      var vo = VO[s.id];
      if (vo) {
        cue.audio = VO_DIR + vo.file;
        cue.voMs = vo.durMs;
        var floor = cue.atMs + (prevEnd === -Infinity ? VO_LEAD : 0);
        cue.startMs = Math.max(floor, prevEnd + VO_GAP);
        cue.endMs = cue.startMs + vo.durMs;
        prevEnd = cue.endMs;
      }
      return cue;
    });
  }
  function narrationEndMs() {
    return narrationCues().reduce(function (m, c) { return (c.endMs || 0) > m ? c.endMs : m; }, 0);
  }
  function narrationScript() {
    return narrationCues().map(function (c) {
      var sec = (c.atMs / 1000).toFixed(1);
      return sec + 's  (' + (c.durMs / 1000).toFixed(1) + 's)  ' + c.line;
    }).join('\n');
  }

  // ── mount ──────────────────────────────────────────────────────────────────
  var root = null, cineEl = null, canvas = null, capEl = null, tlEl = null, endEl = null;
  var state = { i: 0, playing: false, timer: null, t0: 0 };
  var onExit = null;
  var vox = { on: true, blocked: false, els: {}, timers: [], bed: null, bedFailed: false };

  // Warm the clips before play(). The first line starts at 0ms, so if loading
  // begins when the film opens it starts late — and because the schedule is
  // absolute, a late line eats into the gap before the next one. Call this on
  // hover or focus of a play control; play() also calls it as a backstop.
  function preload() {
    narrationCues().forEach(function (c) {
      if (!c.audio || vox.els[c.id]) return;
      var a = new Audio();
      a.preload = 'auto';
      a.src = c.audio;
      vox.els[c.id] = a;
      try { a.load(); } catch (e) {}
    });
    if (!vox.bed) {
      var b = new Audio();
      b.preload = 'auto';
      b.src = BED_SRC;
      b.addEventListener('error', function () { vox.bedFailed = true; });
      vox.bed = b;
      try { b.load(); } catch (e) {}
    }
  }

  // ── music bed ───────────────────────────────────────────────────────────────
  // Optional. The film opens on 1.8s of establishing shot with no voice, and
  // silence over a still frame reads as a stall rather than a beat — the bed is
  // what makes that pause feel intentional. If the file is absent the film runs
  // exactly as it does without it: no error, no gap, just no music.
  var BED_SRC   = 'assets/audio/bed.mp3';
  var BED_LEVEL = 0.20;   // under the voice, never competing with it
  var BED_DUCK  = 0.09;   // while a line is speaking
  var BED_IN    = 900;    // fade up as the first frame lands
  var BED_OUT   = 1400;   // fade down under the brand card

  function rampVolume(el, to, ms) {
    if (!el) return;
    if (el.__ramp) { clearInterval(el.__ramp); el.__ramp = null; }
    var from = el.volume, t0 = Date.now();
    if (ms <= 0) { el.volume = to; return; }
    el.__ramp = setInterval(function () {
      var k = Math.min(1, (Date.now() - t0) / ms);
      // Perceptual, not linear: a linear ramp on an audio taper sounds like it
      // jumps at the top and crawls at the bottom.
      var v = from + (to - from) * (k * k * (3 - 2 * k));
      el.volume = Math.max(0, Math.min(1, v));
      if (k >= 1) { clearInterval(el.__ramp); el.__ramp = null; }
    }, 40);
  }

  function startBed(from) {
    var b = vox.bed;
    if (!b || !vox.on || vox.bedFailed) return;
    b.loop = true;
    b.volume = 0;
    try { b.currentTime = 0; } catch (e) {}
    var p = b.play();
    // A missing or blocked bed must not mute the narration — that path belongs
    // to the voice alone, and losing music is not a reason to lose the film.
    if (p && p.catch) p.catch(function () { vox.bedFailed = true; });
    rampVolume(b, BED_LEVEL, BED_IN);

    // Duck around each line, and fade out under the closing card.
    narrationCues().forEach(function (c) {
      if (!c.audio || c.endMs <= from) return;
      vox.timers.push(setTimeout(function () { rampVolume(vox.bed, BED_DUCK, 420); },
                                 Math.max(0, c.startMs - from - 260)));
      vox.timers.push(setTimeout(function () { rampVolume(vox.bed, BED_LEVEL, 700); },
                                 Math.max(0, c.endMs - from)));
    });
    var total = SCENES.reduce(function (a, s) { return a + s.dur; }, 0);
    vox.timers.push(setTimeout(function () { rampVolume(vox.bed, 0, BED_OUT); },
                               Math.max(0, total - BED_OUT - from)));
  }

  function stopBed() {
    if (!vox.bed) return;
    if (vox.bed.__ramp) { clearInterval(vox.bed.__ramp); vox.bed.__ramp = null; }
    try { vox.bed.pause(); vox.bed.currentTime = 0; } catch (e) {}
  }

  function elapsedMs() { return state.t0 ? Date.now() - state.t0 : 0; }

  function clearNarrationTimers() {
    vox.timers.forEach(function (t) { clearTimeout(t); });
    vox.timers = [];
  }

  function silence() {
    clearNarrationTimers();
    Object.keys(vox.els).forEach(function (k) {
      try { vox.els[k].pause(); vox.els[k].currentTime = 0; } catch (e) {}
    });
    stopBed();
  }

  // Rebuilt from scratch whenever the playhead moves for any reason — open,
  // replay, arrow-key scrub, unmute. Cues already finished are dropped; a cue
  // caught mid-line resumes at the right offset rather than restarting.
  function syncNarration() {
    silence();
    if (!vox.on || !state.playing) return;
    var from = elapsedMs();
    startBed(from);
    narrationCues().forEach(function (c) {
      if (!c.audio || c.endMs <= from) return;
      var a = vox.els[c.id];
      if (!a) return;
      var seek = c.startMs < from ? (from - c.startMs) / 1000 : 0;
      vox.timers.push(setTimeout(function () {
        if (!vox.on || !state.playing) return;
        try { a.currentTime = seek; } catch (e) {}
        var p = a.play();
        // A rejected play() is the deep-link case: index.html?demo=1 arrives by
        // navigation, and user activation does not survive a navigation. Drop
        // to muted and label the control "Sound on" so the film reads as
        // deliberately silent rather than broken.
        if (p && p.catch) p.catch(function () { vox.blocked = true; setMuted(true); });
      }, Math.max(0, c.startMs - from)));
    });
  }

  function setMuted(m) {
    vox.on = !m;
    var b = root && root.querySelector('#pfMute');
    if (b) {
      b.textContent = m ? (vox.blocked ? 'Sound on' : 'Sound off') : 'Sound on ●';
      b.setAttribute('aria-pressed', m ? 'false' : 'true');
      b.setAttribute('aria-label', m ? 'Turn narration on' : 'Turn narration off');
      b.classList.toggle('msl-vox--off', m);
    }
    if (m) silence(); else { vox.blocked = false; syncNarration(); }
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var css = [
      // Design tokens. These were scoped to #msLanding; the film layer needs its
      // own copy or every var(--pa)/var(--mut)/var(--gold) in the scene CSS below
      // resolves to nothing — which is exactly why the Spaces and Ask AI beats
      // rendered blank and the reconciliation table showed no data.
      // The application, full-bleed, as the base of a beat. pf-shot--sharp keeps a
      // screenshot legible (it IS the subject); --dim / --deep push it back when
      // an overlay is the subject and the app is context.
      '.pf-shot{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center;}',
      '.pf-shot--sharp{object-fit:contain;opacity:1;}',
      '.pf-shot--top{object-fit:cover;object-position:top center;}',
      '.pf-shot--dim{opacity:.34;filter:blur(1px) saturate(.85);}',
      '.pf-shot--deep{opacity:.20;filter:blur(2px) saturate(.8);}',
      '.pf-ken{animation:pfKen 10s ease-out both;}',
      '@keyframes pfKen{from{transform:scale(1.04)}to{transform:scale(1.11)}}',
      // A vertical focus band that dims everything except one column of the
      // screenshot — how the eye is directed at the savings column.
      '.pf-focus{position:absolute;inset:0;pointer-events:none;opacity:0;',
      '  background:linear-gradient(90deg,rgba(5,7,9,.74) 0,rgba(5,7,9,.74) calc(var(--fx) - var(--fw2)/2),',
      '    transparent calc(var(--fx) - var(--fw2)/2),transparent calc(var(--fx) + var(--fw2)/2),',
      '    rgba(5,7,9,.74) calc(var(--fx) + var(--fw2)/2),rgba(5,7,9,.74) 100%);',
      '  animation:mslFade .9s var(--ez) both;animation-delay:var(--d,0s);}',
      '.pf-focus--wide{background:radial-gradient(ellipse at var(--fx) 50%,transparent 26%,rgba(5,7,9,.78) 68%);}',
      '.pf-callout{position:absolute;left:50%;bottom:12%;transform:translateX(-50%);padding:8px 16px;border-radius:999px;',
      '  background:rgba(52,192,138,.14);border:1px solid rgba(52,192,138,.4);color:#7BE3A6;',
      '  font-size:.82rem;font-weight:700;letter-spacing:.04em;white-space:nowrap;opacity:0;',
      '  animation:mslUp .7s var(--ez) both;animation-delay:var(--d,0s);}',
      // Above the frame, clear of the table header it used to sit on top of.
      '.pf-callout--top{bottom:auto;top:4%;}',
      '.pf-total{position:absolute;left:50%;bottom:5%;transform:translateX(-50%);font-size:1rem;color:var(--pa);',
      '  opacity:0;animation:mslUp .8s var(--ez) both;animation-delay:var(--d,0s);white-space:nowrap;}',
      '.pf-total b{color:#7BE3A6;font-size:1.25rem;}',
      // The "AI is working" affordance for the upload beat — the emphasis is the
      // reading, not the drop target.
      '.pf-worker{position:absolute;left:50%;bottom:13%;transform:translateX(-50%);display:flex;align-items:center;gap:12px;',
      '  padding:12px 20px;border-radius:14px;background:rgba(8,11,18,.86);border:1px solid rgba(201,151,58,.32);',
      '  opacity:0;animation:mslUp .8s var(--ez) both;animation-delay:var(--d,0s);}',
      '.pf-pulse{width:9px;height:9px;border-radius:50%;background:var(--gold);animation:pfPulse 1.3s ease-in-out infinite;}',
      '@keyframes pfPulse{0%,100%{opacity:.35;transform:scale(.8)}50%{opacity:1;transform:scale(1.15)}}',
      '.pf-worker-t{font-size:.92rem;color:var(--pa);font-weight:600;white-space:nowrap;}',
      '.pf-worker-bar{width:120px;height:3px;border-radius:3px;background:rgba(255,255,255,.12);overflow:hidden;}',
      '.pf-worker-bar i{display:block;height:100%;width:0;background:var(--gold);animation:pfBar 2.4s ease-out .3s forwards;}',
      '@keyframes pfBar{to{width:100%}}',
      // Callout pins for the Space beat.
      '.pf-pins{position:absolute;right:6%;top:50%;transform:translateY(-50%);display:flex;flex-direction:column;gap:12px;}',
      '.pf-pin{display:flex;align-items:center;gap:10px;padding:10px 16px;border-radius:10px;',
      '  background:rgba(8,11,18,.9);border:1px solid rgba(255,255,255,.1);color:var(--pa);font-size:.88rem;font-weight:600;',
      '  white-space:nowrap;opacity:0;animation:mslUp .7s var(--ez) both;animation-delay:var(--d,0s);}',
      '.pf-pin-dot{width:7px;height:7px;border-radius:50%;background:var(--gold);flex:none;}',
      '.pf-edge{position:absolute;inset:0;pointer-events:none;background:linear-gradient(180deg,transparent 60%,rgba(5,7,9,.9) 100%);}',
      // Ask AI overlay — a real query bar and cited rows over the workspace.
      '.pf-ask{width:min(var(--fw),94%);padding:20px 22px;border-radius:16px;background:rgba(8,11,18,.92);',
      '  border:1px solid rgba(255,255,255,.1);box-shadow:0 40px 90px -30px rgba(0,0,0,.9);}',
      '.pf-ask-bar{display:flex;align-items:center;gap:12px;padding:13px 16px;border-radius:11px;',
      '  background:rgba(255,255,255,.04);border:1px solid rgba(201,151,58,.4);margin-bottom:16px;}',
      '.pf-ask-q{flex:1;color:var(--pa);font-size:1.02rem;font-weight:600;min-height:1.3em;}',
      '.pf-ask-go{padding:7px 16px;border-radius:8px;background:var(--gold);color:#0B0804;font-size:.82rem;font-weight:800;}',
      '.pf-ask-rows{display:flex;flex-direction:column;gap:2px;}',
      '.pf-ask-row{display:grid;grid-template-columns:1fr auto auto;align-items:center;gap:14px;padding:11px 4px;',
      '  border-bottom:1px solid rgba(255,255,255,.06);opacity:0;animation:mslUp .6s var(--ez) both;animation-delay:var(--d,0s);}',
      '.pf-ask-row span{color:var(--pa);font-weight:600;font-size:.95rem;}',
      '.pf-ask-row b{color:var(--gold);font-size:.9rem;font-weight:700;}',
      '.pf-chip{font-style:normal;font-size:.66rem;letter-spacing:.09em;text-transform:uppercase;padding:3px 8px;border-radius:999px;',
      '  background:rgba(52,192,138,.14);border:1px solid rgba(52,192,138,.36);color:#7BE3A6;}',
      '@media (max-width:720px){.pf-pins{right:auto;left:50%;transform:translate(-50%,0);top:auto;bottom:6%;}',
      '  .pf-worker-bar{display:none;} .pf-callout{white-space:normal;text-align:center;max-width:80%;}}',
      '.pf-root{--ink:#080b12;--pa:#EAECEF;--mut:#9AA4B2;--dim:#5A6472;--gold:#C9973A;--goldl:#E4B75C;--grn:#34C08A;',
      '  --ez:cubic-bezier(.16,1,.3,1);}',
      // shared tokens
      '#msLanding{--ink:#080b12;--pa:#EAECEF;--mut:#9AA4B2;--dim:#5A6472;--gold:#C9973A;--goldl:#E4B75C;--grn:#34C08A;}',
      '#msLanding{position:fixed;inset:0;z-index:99000;display:none;overflow-y:auto;color:var(--pa);',
      'font-family:-apple-system,system-ui,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;',
      'background:radial-gradient(1200px 700px at 80% -12%,rgba(201,151,58,.10),transparent 60%),var(--ink);}',
      '#msLanding.msl-on{display:block;animation:mslFade .55s ease both;}',
      '@keyframes mslFade{from{opacity:0}to{opacity:1}}',
      '#msLanding::before{content:"";position:absolute;inset:0;pointer-events:none;background:linear-gradient(rgba(255,255,255,.016) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.016) 1px,transparent 1px);background-size:64px 64px;mask-image:radial-gradient(circle at 50% 30%,#000,transparent 80%);}',
      // hero (unchanged premium)
      '.msl-nav{position:relative;z-index:2;display:flex;align-items:center;justify-content:space-between;max-width:1120px;margin:0 auto;padding:26px 32px;}',
      '.msl-logo{font-weight:700;font-size:1.1rem;letter-spacing:-.02em;}.msl-logo b{color:var(--gold);}',
      '.msl-nav-signin{background:none;border:none;color:var(--mut);font:inherit;font-size:.9rem;font-weight:500;cursor:pointer;padding:8px;transition:color .2s;}.msl-nav-signin:hover{color:var(--pa);}',
      '.msl-hero{position:relative;z-index:1;max-width:920px;margin:0 auto;padding:clamp(48px,11vh,120px) 32px 60px;text-align:center;}',
      '.msl-eyebrow{display:inline-flex;align-items:center;gap:9px;font-family:ui-monospace,"SF Mono",Menlo,monospace;font-size:.72rem;letter-spacing:.18em;text-transform:uppercase;color:var(--goldl);margin-bottom:30px;padding:8px 16px;border:1px solid rgba(201,151,58,.32);background:rgba(201,151,58,.08);border-radius:999px;opacity:0;animation:mslUp .7s .05s ease forwards;}',
      '.msl-eyebrow::before{content:"";width:5px;height:5px;border-radius:50%;background:var(--gold);box-shadow:0 0 0 3px rgba(201,151,58,.16);}',
      '.msl-h1{font-size:clamp(2.9rem,7vw,5.4rem);font-weight:700;letter-spacing:-.04em;line-height:1.02;margin:0;text-wrap:balance;opacity:0;animation:mslUp .85s .16s cubic-bezier(.2,.7,.2,1) forwards;}',
      '.msl-h1 em{font-style:normal;color:var(--gold);}',
      '.msl-lede{font-size:clamp(1.05rem,2vw,1.35rem);line-height:1.55;color:var(--mut);max-width:44ch;margin:24px auto 0;opacity:0;animation:mslUp .85s .3s ease forwards;}',
      '.msl-lede em{color:var(--pa);font-style:normal;font-weight:500;}',
      // problem/value section (marketing) — matches hero language, no new animation system
      '.msl-why{position:relative;z-index:1;max-width:920px;margin:0 auto;padding:8px 32px clamp(40px,7vh,80px);text-align:center;opacity:0;animation:mslUp .85s .8s ease forwards;}',
      '.msl-why-h{font-size:clamp(1.4rem,3vw,2.1rem);font-weight:700;letter-spacing:-.025em;color:var(--pa);margin:0 0 30px;text-wrap:balance;}',
      '.msl-why-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;max-width:720px;margin:0 auto;text-align:left;align-items:start;}',
      '.msl-why-item{background:#0f1520;border:1px solid rgba(255,255,255,.07);border-radius:12px;transition:border-color .25s;}',
      '.msl-why-item:hover{border-color:rgba(201,151,58,.35);}',
      '.msl-why-item[open]{border-color:rgba(201,151,58,.35);}',
      '.msl-why-head{display:flex;align-items:center;gap:14px;padding:16px 18px;cursor:pointer;list-style:none;-webkit-tap-highlight-color:transparent;}',
      '.msl-why-head::-webkit-details-marker{display:none;}',
      '.msl-why-head:focus-visible{outline:2px solid var(--gold);outline-offset:2px;border-radius:12px;}',
      '.msl-why-ic{width:34px;height:34px;border-radius:9px;flex:none;display:grid;place-items:center;background:rgba(201,151,58,.1);color:var(--gold);}.msl-why-ic svg{width:18px;height:18px;}',
      '.msl-why-label{font-size:.95rem;color:#C6CEDA;font-weight:500;flex:1;}',
      '.msl-why-chev{flex:none;color:#7C8798;display:grid;place-items:center;transition:transform .25s,color .25s;}.msl-why-chev svg{width:16px;height:16px;}',
      '.msl-why-item[open] .msl-why-chev{transform:rotate(180deg);color:var(--gold);}',
      '.msl-why-detail{margin:0;padding:0 18px 16px 66px;font-size:.88rem;line-height:1.55;color:#98A2B3;}',
      '.msl-why-cta{font-size:clamp(1.05rem,2.2vw,1.35rem);font-weight:600;letter-spacing:-.01em;color:var(--pa);margin:30px auto 0;max-width:34ch;}',
      '.msl-why-cta b,.msl-why-cta em{color:var(--gold);font-style:normal;}',
      '@media(max-width:600px){.msl-why-grid{grid-template-columns:1fr;}.msl-why{padding-bottom:48px;}}',
      '.msl-cta{display:flex;gap:12px;flex-wrap:wrap;justify-content:center;margin:40px 0 0;opacity:0;animation:mslUp .85s .44s ease forwards;}',
      '.msl-btn{font:inherit;font-size:1rem;font-weight:600;border-radius:12px;padding:14px 26px;cursor:pointer;border:1px solid transparent;transition:transform .18s,filter .18s,border-color .2s,color .2s,background .2s;display:inline-flex;align-items:center;gap:9px;}',
      '.msl-btn:hover{transform:translateY(-1px);}.msl-btn:focus-visible{outline:2px solid var(--gold);outline-offset:3px;}',
      '.msl-btn--primary{background:var(--gold);color:#0b0e15;box-shadow:0 14px 34px -14px rgba(201,151,58,.65);}.msl-btn--primary:hover{filter:brightness(1.07);}',
      '.msl-btn--ghost{background:rgba(255,255,255,.045);color:var(--pa);border-color:rgba(255,255,255,.14);}.msl-btn--ghost:hover{border-color:rgba(255,255,255,.32);}',
      '.msl-btn--text{background:none;color:var(--mut);}.msl-btn--text:hover{color:var(--pa);}',
      '.msl-trust{margin:34px 0 0;font-family:ui-monospace,"SF Mono",Menlo,monospace;font-size:.72rem;letter-spacing:.06em;color:var(--dim);display:inline-flex;align-items:center;gap:10px;opacity:0;animation:mslUp .85s .56s ease forwards;}',
      '.msl-trust .msl-dot{width:6px;height:6px;border-radius:50%;background:var(--grn);box-shadow:0 0 0 3px rgba(52,192,138,.18);}',
      '.msl-rail{max-width:1000px;margin:64px auto 0;padding:0 32px;display:flex;align-items:flex-start;justify-content:space-between;gap:4px;opacity:0;animation:mslUp .85s .68s ease forwards;}',
      '.msl-rstep{flex:1;display:flex;flex-direction:column;align-items:center;gap:9px;position:relative;}',
      '.msl-rstep::after{content:"";position:absolute;top:19px;left:50%;width:100%;height:1px;background:rgba(255,255,255,.09);z-index:0;}.msl-rstep:last-child::after{display:none;}',
      '.msl-ric{width:40px;height:40px;border-radius:11px;display:grid;place-items:center;background:#0f1520;border:1px solid rgba(255,255,255,.08);color:var(--mut);position:relative;z-index:1;transition:color .2s,border-color .2s;}.msl-ric svg{width:20px;height:20px;}',
      '.msl-rstep:hover .msl-ric{color:var(--gold);border-color:rgba(201,151,58,.4);}',
      '.msl-rlabel{font-size:.7rem;color:var(--dim);}',
      '@keyframes mslUp{from{opacity:0;transform:translateY(22px)}to{opacity:1;transform:none}}',
      '@media(max-width:720px){.msl-cta{flex-direction:column;width:100%;max-width:340px;margin-left:auto;margin-right:auto;}.msl-btn{justify-content:center;width:100%;}.msl-rail{display:none;}}',
      // ── cinematic film ──
      '.msl-cine{position:fixed;inset:0;z-index:99001;display:none;flex-direction:column;align-items:center;justify-content:center;',
      'background:radial-gradient(1100px 760px at 50% -12%,rgba(201,151,58,.08),transparent 62%),#05070c;padding:24px;}',
      '.msl-cine.msl-on{display:flex;animation:mslFade .45s ease both;}',
      '.msl-cine-close{position:absolute;top:22px;right:26px;z-index:6;background:rgba(255,255,255,.05);border:none;color:var(--mut);font-size:1rem;width:36px;height:36px;border-radius:50%;cursor:pointer;display:grid;place-items:center;transition:background .2s,color .2s;}',
      '.msl-cine-close:hover{background:rgba(255,255,255,.12);color:var(--pa);}',
      '.msl-vox{position:absolute;top:22px;right:74px;z-index:6;background:rgba(255,255,255,.05);border:none;color:var(--mut);font:inherit;font-size:.72rem;letter-spacing:.08em;text-transform:uppercase;height:36px;padding:0 14px;border-radius:18px;cursor:pointer;transition:background .2s,color .2s;}',
      '.msl-vox:hover{background:rgba(255,255,255,.12);color:var(--pa);}',
      '.msl-vox--off{color:var(--dim);}',
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
      // The final card carries two elements, so it can afford more air between
      // them and a larger mark than the mid-film variant.
      '.msl-close--final{gap:26px;}',
      '.msl-close--final .msl-close-mark{font-size:clamp(2.6rem,6.2vw,4.2rem);}',
      '.msl-close-mark{font-size:clamp(2.2rem,5vw,3.4rem);font-weight:800;letter-spacing:-.035em;color:var(--pa);}',
      '.msl-close-mark span{background:linear-gradient(120deg,#EBD49A,#C9A254 55%,#E4C57F);-webkit-background-clip:text;background-clip:text;color:transparent;}',
      '.msl-close-line{font-size:clamp(1.05rem,2.2vw,1.5rem);line-height:1.35;color:var(--pa);font-weight:600;letter-spacing:-.02em;opacity:0;animation:mslUp .8s var(--ez,ease) both;animation-delay:var(--d,0s);}',
      '.msl-close-line em{font-style:normal;background:linear-gradient(120deg,#EBD49A,#C9A254 55%,#E4C57F);-webkit-background-clip:text;background-clip:text;color:transparent;}',
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
      '@media(max-width:600px){',
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
      '@media(prefers-reduced-motion:reduce){#msLanding *{animation-duration:.001s!important;animation-delay:0s!important;}}',
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
      '<button class="msl-vox" id="pfMute" aria-pressed="true" aria-label="Turn narration off">Sound on \u25cf</button>' +
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
    root.querySelector('#pfMute').addEventListener('click', function () { setMuted(vox.on); });
    document.addEventListener('keydown', onKey);
  }

  function onKey(e) {
    if (!root || !root.classList.contains('msl-on')) return;
    if (e.key === 'Escape') stop();
    else if (e.key === 'ArrowRight' && state.i < SCENES.length - 1) { clearTimeout(state.timer); state.i++; scrubbed(); }
    else if (e.key === 'ArrowLeft' && state.i > 0) { clearTimeout(state.timer); state.i--; scrubbed(); }
    else if (e.key === 'm' || e.key === 'M') setMuted(vox.on);
  }

  // Re-anchor the narration clock to the scene the scrub landed on, otherwise
  // the voice keeps running against the timeline the viewer just left.
  function scrubbed() {
    state.t0 = Date.now() - sceneStartMs(state.i);
    renderScene();
    syncNarration();
  }

  function sceneStartMs(i) {
    return SCENES.slice(0, i).reduce(function (a, sc) { return a + sc.dur; }, 0);
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
      else {
        // Hold the brand frame until the closing line finishes. It runs 4.02s
        // against a 3.4s scene, so cutting to the CTA on the scene clock would
        // clip "…every commercial property" — the one line that has to land.
        var hold = s.dur;
        if (vox.on && !vox.blocked) hold = Math.max(hold, narrationEndMs() - elapsed + 280);
        state.timer = setTimeout(showEnd, hold);
      }
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
    endEl.querySelector('#pfEndReplay').addEventListener('click', function () {
      state.i = 0; state.playing = true; state.t0 = Date.now();
      renderScene(); syncNarration();
    });
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
    preload();
    if (opts && opts.muted) setMuted(true);
    state.i = 0; state.playing = true; state.t0 = Date.now();
    renderScene();
    syncNarration();
    root.classList.add('msl-on');
    document.body.style.overflow = 'hidden';
  }

  function stop() {
    clearTimeout(state.timer);
    silence();
    state.playing = false;
    if (root) root.classList.remove('msl-on');
    document.body.style.overflow = '';
    if (onExit) { try { onExit(); } catch (e) {} }
  }

  window.ProductFilm = {
    play: play, stop: stop, preload: preload,
    narrationCues: narrationCues,
    narrationEndMs: narrationEndMs,
    narrationScript: narrationScript,
    scenes: function () { return SCENES.map(function (s) { return { id: s.id, dur: s.dur, cap: s.cap, vo: s.vo }; }); },
  };
})();
