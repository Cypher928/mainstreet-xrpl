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
  // Fallback delay for whichever line comes first, so the voice never starts
  // over a fade-in. `atMs` on a VO entry overrides it with an absolute anchor.
  var VO_LEAD = 600;
  var VO = {
    // Anchored, not scene-relative. The line begins at 3.0s — as the `promise`
    // beat opens, 2.5s before the cut into the workflow — and runs to 7.31s, so
    // it carries across that cut. Elise reads with no pause over 140ms and the
    // frame-header energy profile is flat end to end, so there is no verifiable
    // gap inside the clip to hide a cut behind; the line has to bridge it.
    upload:   { file: 'vo-upload.mp3',   durMs: 4310, atMs: 3000 },
    extract:  { file: 'vo-extract.mp3',  durMs: 2640 },
    recon:    { file: 'vo-recon.mp3',    durMs: 2460 },
    recover:  { file: 'vo-recover.mp3',  durMs: 2870 },
    space:    { file: 'vo-space.mp3',    durMs: 4410 },
    ask:      { file: 'vo-ask.mp3',      durMs: 5510 },   // overruns its 5.2s scene
    timeline: { file: 'vo-timeline.mp3', durMs: 2950 },
    settle:   { file: 'vo-settle.mp3',   durMs: 3530 },
    verify:   { file: 'vo-verify.mp3',   durMs: 3710 },
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

    // Establishing shot, cut to the brief:
    //   0.0-0.8  fade up from black, slow push toward the screen
    //   0.8-2.3  the lockup fades in over a scrim
    //   2.0      the first line begins, one second before the cut
    //   2.3-3.0  lockup out, scrim lifts, push continues into the workflow
    //
    // The plate is the supplied key art, cropped right of x=640 so the printed
    // lockup is out of frame and the animated one can do that job. The office
    // is real photography from that artwork — nothing here composites the app
    // into an invented environment.
    // ── OPENING SEQUENCE ────────────────────────────────────────────────
    // Three beats before any feature is shown, per the storyboard: emotion,
    // then the product's name, then the promise — and only then the workflow.
    // The earlier single beat opened straight onto the dashboard, which made it
    // a splash screen for a demo. Nothing here competes with the brand: the app
    // is present but veiled and defocused until the camera has arrived.
    //
    // The push is continuous across `logo` and `promise` at a matched rate
    // (~0.03 scale/sec), and `upload` arrives already scaled in and settles, so
    // the cut reads as the camera reaching the software rather than a jump to
    // another screen.

    // 0.00-1.50  Emotion first. No product at all.
    { id: 'story', dur: 1500, fw: 940, cap: '', bare: true,
      build: function (c) {
        c.innerHTML =
          '<div class="pf-open">' +
            '<div class="pf-story"><p>Every commercial property<br>has <em>a story.</em></p></div>' +
            '<div class="pf-open-black"></div>' +
          '</div>';
      } },

    // 1.50-3.00  The product's name, lit. The dashboard is behind it, heavily
    //            veiled and out of focus — supporting the frame, not sharing it.
    { id: 'logo', dur: 1500, fw: 1180, cap: '', bare: true,
      build: function (c) {
        c.innerHTML =
          '<div class="pf-open">' +
            '<img class="pf-open-scene" src="' + ASSET + 'keyart-scene.jpg" alt="">' +
            '<img class="pf-open-scene pf-blur" src="' + ASSET + 'keyart-scene-blur.jpg" alt="">' +
            '<div class="pf-veil pf-veil-a"></div>' +
            '<div class="pf-halo"></div>' +
            '<div class="pf-open-lock">' +
              '<img class="pf-open-mark" src="' + ASSET + 'keyart-mark.png" alt="">' +
              '<div class="pf-open-word">MAINSTREET</div>' +
              '<div class="pf-open-rule"></div>' +
              '<div class="pf-open-tag">The AI Operating System<br>for Commercial Real&nbsp;Estate.</div>' +
            '</div>' +
          '</div>';
      } },

    // 3.00-5.50  The promise, spoken and on screen. The veil lifts and focus
    //            pulls in as the camera closes on the product. The recorded line
    //            starts here and runs past the cut into `upload`.
    //
    //            The two lines CROSSFADE rather than cutting. I could not locate
    //            the sentence break in vo-upload.mp3: the read has no pause over
    //            140ms, and the frame-header energy profile is flat 2500-3800
    //            bits end to end because CBR bit allocation smooths amplitude
    //            through the bit reservoir. A hard cut would need a timing I
    //            cannot verify; a 600ms crossfade is right either way.
    { id: 'promise', dur: 2500, fw: 1180, cap: '', bare: true, chain: true,
      build: function (c) {
        c.innerHTML =
          '<div class="pf-open">' +
            '<img class="pf-open-scene pf-approach" src="' + ASSET + 'keyart-scene.jpg" alt="">' +
            '<img class="pf-open-scene pf-approach pf-blur pf-rack" src="' + ASSET + 'keyart-scene-blur.jpg" alt="">' +
            '<div class="pf-veil pf-veil-b"></div>' +
            '<div class="pf-lgrad"></div>' +
            '<div class="pf-line pf-line-a">Commercial real estate<br>moves <em>fast…</em></div>' +
            '<div class="pf-line pf-line-b">…MainStreet reads<br><em>every lease.</em></div>' +
          '</div>';
      } },

    { id: 'upload', dur: 4000, fw: 780, enter: 'arrive', cap: 'It starts reading the moment a lease lands',
      vo: 'It starts with what you already have. Leases, invoices, statements.',
      build: function (c) {
        c.innerHTML =
          '<img class="pf-shot" src="' + ASSET + 'ui-upload.png" alt="">' +
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
          '<img class="pf-shot pf-shot--dim" src="' + ASSET + 'ui-workspace.png" alt="">' +
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
          '<img class="pf-shot pf-shot--deep" src="' + ASSET + 'ui-command-center.png" alt="">' +
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
          '<img class="pf-shot pf-shot--dim" src="' + ASSET + 'ui-workspace.png" alt="">' +
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
          '<img class="pf-shot pf-shot--deep" src="' + ASSET + 'ui-command-center.png" alt="">' +
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
        var floor = typeof vo.atMs === 'number' ? vo.atMs
                  : cue.atMs + (prevEnd === -Infinity ? VO_LEAD : 0);
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
  var vox = { on: true, blocked: false, els: {}, timers: [], bedBytes: null, bedFailed: false };

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
    // The bed is fetched as BYTES, not wrapped in an <audio> element.
    //
    // It used to be an element whose .volume carried the mix level, with a
    // fallback to that same .volume if the WebAudio graph could not be built.
    // On iOS Safari HTMLMediaElement.volume is READ-ONLY — assignments are
    // silently ignored — so on an iPhone that fallback played the music at full
    // system volume, and three rounds of cutting the level changed nothing at
    // all. An AudioBufferSourceNode cannot bypass the graph, on any platform.
    if (!vox.bedBytes) {
      vox.bedBytes = fetch(bedSrc()).then(function (r) {
        if (!r.ok) throw new Error('bed ' + r.status);
        return r.arrayBuffer();
      }).catch(function () { vox.bedFailed = true; return null; });
    }
  }

  // ── music bed ───────────────────────────────────────────────────────────────
  // Optional. The film opens on 1.8s of establishing shot with no voice, and
  // silence over a still frame reads as a stall rather than a beat — the bed is
  // what makes that pause feel intentional. If the file is absent the film runs
  // exactly as it does without it: no error, no gap, just no music.
  // Opus where it plays, MP3 everywhere else. Same 52s of the same track: the
  // Opus copy is 614KB against 2.03MB, and this is the heaviest asset in the
  // film — it matters most on the phone, where there is no hover to preload on.
  var BED_SRCS  = [['audio/webm; codecs=opus', 'assets/audio/bed.webm'],
                   ['audio/mpeg',              'assets/audio/bed.mp3']];
  function bedSrc() {
    var a = document.createElement('audio');
    for (var i = 0; i < BED_SRCS.length; i++) {
      if (a.canPlayType(BED_SRCS[i][0]).replace('no', '')) return BED_SRCS[i][1];
    }
    return BED_SRCS[BED_SRCS.length - 1][1];
  }
  // Bed: "A Perfect Day" (Iros Young), first 52s.
  //
  // ── why this is a WebAudio graph and not an element volume ──────────────────
  // The first version set BED_LEVEL from an RMS ratio: music 20dB under the
  // narration's speech-only mean. On paper that is a conservative broadcast
  // level. In the room it still fought the voice, because an RMS ratio does not
  // predict intelligibility. Masking is frequency-specific — music energy
  // between roughly 1kHz and 4kHz covers consonants at levels where the overall
  // ratio looks safe. Turning the whole track down far enough to fix that by
  // level alone would have left no music worth having.
  //
  // So the fix is spectral and dynamic rather than a single number:
  //
  //   source → presence dip (peaking EQ ~2.4kHz) → base gain → duck gain → out
  //                                                               ↑
  //                                        envelope follower on the voice bus
  //
  // The dip carves the band the voice occupies while leaving the low end and
  // the air above 6kHz intact, so the track keeps its body and sparkle. The
  // follower listens to the actual voice bus, so the music dips on speech and
  // recovers in the gaps without anything being hand-timed per scene.
  // Cut hard on the second report of the music competing. Recording the real
  // output showed the graph working exactly as modelled — the voice was already
  // 13.2dB over the ducked bed in the speech band, comfortably past the
  // broadcast floor. So the standard was the wrong target, not the maths: for
  // this film the bed wants to sit well below "correct" and stay there.
  //
  // Against the previous pass this is 5.6dB quieter between lines and 10.6dB
  // quieter under a line.
  var BED_BASE_DB  = -20;    // between lines and over the titles
  var BED_DUCK_DB  = -16;    // additional, while the voice is present
  var BED_BRAND_DB = -9;     // ...but only this much under the closing line, so
                             //    the music still swells with the brand card
  // Q 0.6 puts the skirt roughly across 1.1-4.8kHz, which is the band asked
  // for. At Q 0.9 the dip was only shifting the mid/low balance by 1.8dB —
  // audible as a level change but not actually clearing the voice's band.
  var EQ_HZ = 2200, EQ_Q = 0.6;
  var EQ_IDLE_DB = -3;       // always a little out of the way
  var EQ_DUCK_DB = -10;      // and well out of the way while speaking
  var FOLLOW_ATTACK = 0.055; // fast enough to catch a syllable onset
  var FOLLOW_RELEASE = 0.42; // slow enough not to pump between words
  var VOICE_FLOOR = 0.006;   // below this the bus counts as silent
  var VOICE_FULL  = 0.055;   // at this the duck is at full depth
  var BED_IN    = 400;
  var BED_OUT   = 1400;      // fade down under the brand card

  var dbToGain = function (db) { return Math.pow(10, db / 20); };

  var audio = { ctx: null, bedNode: null, bedBuf: null, eq: null, base: null, duck: null,
                bus: null, ana: null, buf: null, raf: null, srcs: {},
                depthDb: BED_DUCK_DB, follow: 0 };

  // One MediaElementAudioSourceNode per element, ever. Creating a second for the
  // same element throws, and these elements are reused on replay.
  function nodeFor(el) {
    if (!audio.ctx) return null;
    if (el.__node) return el.__node;
    try { el.__node = audio.ctx.createMediaElementSource(el); } catch (e) { return null; }
    return el.__node;
  }

  function buildGraph() {
    if (audio.ctx) return true;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try { audio.ctx = new AC(); } catch (e) { return false; }
    var c = audio.ctx;
    audio.eq = c.createBiquadFilter();
    audio.eq.type = 'peaking';
    audio.eq.frequency.value = EQ_HZ;
    audio.eq.Q.value = EQ_Q;
    audio.eq.gain.value = EQ_IDLE_DB;
    audio.base = c.createGain(); audio.base.gain.value = 0;
    audio.duck = c.createGain(); audio.duck.gain.value = 1;
    audio.eq.connect(audio.base); audio.base.connect(audio.duck);
    audio.duck.connect(c.destination);
    // Every line plays into one bus, so the follower has a single thing to
    // listen to no matter which clip is speaking.
    audio.bus = c.createGain(); audio.bus.gain.value = 1;
    audio.bus.connect(c.destination);
    audio.ana = c.createAnalyser();
    audio.ana.fftSize = 1024;
    audio.buf = new Float32Array(audio.ana.fftSize);
    audio.bus.connect(audio.ana);
    return true;
  }

  // Is a line supposed to be sounding right now, per the cue timeline?
  function scheduledVoice(ms) {
    var cs = narrationCues(), i;
    for (i = 0; i < cs.length; i++) {
      if (!cs[i].audio) continue;
      if (ms >= cs[i].startMs - 120 && ms <= cs[i].endMs + 80) return true;
    }
    return false;
  }

  function follower() {
    audio.raf = requestAnimationFrame(follower);
    if (!audio.ana || !audio.ctx) return;
    audio.ana.getFloatTimeDomainData(audio.buf);
    var s = 0, i;
    for (i = 0; i < audio.buf.length; i++) s += audio.buf[i] * audio.buf[i];
    var rms = Math.sqrt(s / audio.buf.length);
    // 0 when the bus is quiet, 1 when the voice is at full tilt.
    var want = (rms - VOICE_FLOOR) / (VOICE_FULL - VOICE_FLOOR);
    want = want < 0 ? 0 : (want > 1 ? 1 : want);
    // Floored by the cue schedule. Routing a media element into the graph is
    // the one part of this that can fail per-platform, and if the voice never
    // reaches the bus the analyser hears silence and the music never ducks at
    // all. The schedule knows when a line is playing regardless, so the duck
    // survives that failure — the follower only ever makes it deeper.
    if (scheduledVoice(elapsedMs())) want = want < 1 ? 1 : want;
    // Asymmetric smoothing: duck quickly, recover slowly. A symmetric follower
    // pumps audibly in the gaps between words.
    var k = want > audio.follow
      ? 1 - Math.exp(-1 / (60 * FOLLOW_ATTACK))
      : 1 - Math.exp(-1 / (60 * FOLLOW_RELEASE));
    audio.follow += (want - audio.follow) * k;
    var f = audio.follow;
    var t = audio.ctx.currentTime;
    audio.duck.gain.setTargetAtTime(dbToGain(audio.depthDb * f), t, 0.02);
    audio.eq.gain.setTargetAtTime(EQ_IDLE_DB + (EQ_DUCK_DB - EQ_IDLE_DB) * f, t, 0.05);
  }

  function rampParam(p, to, ms) {
    if (!p || !audio.ctx) return;
    var t = audio.ctx.currentTime;
    p.cancelScheduledValues(t);
    p.setValueAtTime(p.value, t);
    p.linearRampToValueAtTime(to, t + ms / 1000);
  }

  function setMix(o) {
    if (!o) return { baseDb: BED_BASE_DB, duckDb: BED_DUCK_DB, brandDb: BED_BRAND_DB };
    if (typeof o.baseDb === 'number') BED_BASE_DB = o.baseDb;
    if (typeof o.duckDb === 'number') BED_DUCK_DB = o.duckDb;
    if (typeof o.brandDb === 'number') BED_BRAND_DB = o.brandDb;
    audio.depthDb = BED_DUCK_DB;
    if (audio.base && audio.ctx) rampParam(audio.base.gain, dbToGain(BED_BASE_DB), 120);
    return { baseDb: BED_BASE_DB, duckDb: BED_DUCK_DB, brandDb: BED_BRAND_DB };
  }

  // ?mix=base,duck  — so the balance can be tried on the device it will be
  // watched on, rather than described back and forth.
  function mixFromUrl() {
    try {
      var m = /[?&]mix=(-?[\d.]+)(?:,(-?[\d.]+))?/.exec(window.location.search);
      if (!m) return;
      setMix({ baseDb: parseFloat(m[1]),
               duckDb: m[2] !== undefined ? parseFloat(m[2]) : undefined });
    } catch (e) {}
  }

  function startBed(from) {
    if (!vox.on || vox.bedFailed || !vox.bedBytes) return;
    if (!buildGraph()) return;          // no graph, no music — never a fallback
    if (audio.ctx.state === 'suspended') { try { audio.ctx.resume(); } catch (e) {} }

    var ctx = audio.ctx;
    var startAt = Math.max(0, from) / 1000;
    audio.base.gain.value = 0;
    // Decoded on the LIVE context so the buffer's rate matches it. Decoding on
    // an OfflineAudioContext at 44.1k and playing it on a 48k device context
    // resamples inconsistently across engines.
    vox.bedBytes.then(function (bytes) {
      if (!bytes || !vox.on || !state.playing) return;
      return ctx.decodeAudioData(bytes.slice(0));
    }).then(function (buf) {
      if (!buf || !vox.on || !state.playing) return;
      audio.bedBuf = buf;
      stopBedSource();
      var src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(audio.eq);
      audio.bedNode = src;
      // Enter the track at wherever the film has actually reached, not at
      // `from`. Decoding 52s takes a few hundred milliseconds, and starting at
      // the track's beginning afterwards would leave the music trailing the
      // picture by however long the decode took — on a slow phone, enough to
      // pull the closing swell off the brand card.
      var at = Math.max(0, elapsedMs()) / 1000;
      try { src.start(0, Math.min(at, buf.duration - 0.05)); } catch (e) {}
      rampParam(audio.base.gain, dbToGain(BED_BASE_DB), BED_IN);
      if (!audio.raf) follower();
      var total = SCENES.reduce(function (a, s) { return a + s.dur; }, 0);
      vox.timers.push(setTimeout(function () {
        rampParam(audio.base.gain, 0, BED_OUT);
      }, Math.max(0, total - BED_OUT - from)));
    }).catch(function () { vox.bedFailed = true; });
  }

  function stopBedSource() {
    if (!audio.bedNode) return;
    try { audio.bedNode.stop(); } catch (e) {}
    try { audio.bedNode.disconnect(); } catch (e) {}
    audio.bedNode = null;
  }

  function stopBed() {
    if (audio.raf) { cancelAnimationFrame(audio.raf); audio.raf = null; }
    audio.follow = 0;
    if (audio.duck && audio.ctx) audio.duck.gain.setValueAtTime(1, audio.ctx.currentTime);
    if (audio.base && audio.ctx) audio.base.gain.setValueAtTime(0, audio.ctx.currentTime);
    stopBedSource();
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
    // Built before anything plays, so the voice bus exists for the first line
    // even if the bed is missing or blocked.
    buildGraph();
    startBed(from);
    narrationCues().forEach(function (c) {
      if (!c.audio || c.endMs <= from) return;
      var a = vox.els[c.id];
      if (!a) return;
      var seek = c.startMs < from ? (from - c.startMs) / 1000 : 0;
      vox.timers.push(setTimeout(function () {
        if (!vox.on || !state.playing) return;
        try { a.currentTime = seek; } catch (e) {}
        // Into the bus, not straight to the speakers — this is what the
        // sidechain listens to. Without it the follower hears nothing and the
        // music never ducks.
        if (audio.ctx && !a.__wired) {
          var n = nodeFor(a);
          if (n) { n.connect(audio.bus); a.__wired = true; }
        }
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
      // The camera lives on the LAYER, so everything in the beat moves together —
      // screenshot, callouts, focus bands, type. Previously only the base image
      // moved and the overlays sat still on top of it, which read as graphics
      // pasted onto a photo rather than objects inside a shot.
      // Opacity is driven from JS via the Web Animations API; no transition here,
      // so nothing about the CSS can quietly change the dissolve.
      '.pf-layer{position:absolute;inset:0;will-change:opacity;}',
      '.pf-layer--out{pointer-events:none;}',
      // The camera. Constant velocity, one direction, and its timeline outlives
      // the beat by the dissolve length so the shot is STILL MOVING while it
      // fades out — which is what makes the two shots read as one move.
      // ── matching the opening into the product ────────────────────────────
      // Measured from keyart-scene.jpg: the laptop's screen fills 77% of the
      // plate's width, centred at 45% / 57.5% of the image. So at the cut the
      // Command Center UI was at 0.77x frame while the incoming screenshot
      // filled it completely — the two UIs were simply different sizes, which is
      // what read as a cut no matter how well the LAYER scales matched.
      //
      // The approach pushes the plate to 1.20 by the cut:
      //   0.77 (screen) x 1.064 (camera) x 1.195 (approach) = 0.979
      // against the incoming screenshot at 1.0. Within 2%.
      //
      // It holds still for the first third, so the logo->promise cut is not a
      // lurch, and only starts moving in once the text begins to clear. From
      // there it is linear — constant speed, so there is a velocity to match.
      '.pf-approach{transform-origin:45% 64%;animation:pfApproach var(--ed,3540ms) linear both;}',
      '@keyframes pfApproach{0%{transform:scale(1)}33.9%{transform:scale(1)}100%{transform:scale(1.351)}}',
      // The arrival continues that move into the workflow. Its opening slope is
      // 1.03e-4/ms against the plate's 1.23e-4/ms at the cut (within 3%), then it
      // relaxes to the film's base rate — easing to the base speed, never to a
      // stop. It also straightens the 1.25deg screen tilt measured off the
      // plate, so the geometry resolves as the camera squares up to it.
      '.pf-body{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;}',
      '.pf-body--arrive{transform-origin:50% 46%;animation:pfArrive var(--ed,5040ms) linear both;}',
      '@keyframes pfArrive{',
      '  0%{transform:perspective(1400px) rotateZ(1.25deg) rotateY(4deg) scale(1.000)}',
      '  6%{transform:perspective(1400px) rotateZ(1.18deg) rotateY(3.8deg) scale(1.031)}',
      '  16%{transform:perspective(1400px) rotateZ(.95deg) rotateY(3deg) scale(1.068)}',
      '  34%{transform:perspective(1400px) rotateZ(.55deg) rotateY(1.7deg) scale(1.092)}',
      '  60%{transform:perspective(1400px) rotateZ(.15deg) rotateY(.5deg) scale(1.103)}',
      '  100%{transform:perspective(1400px) rotateZ(0deg) rotateY(0deg) scale(1.108)}}',
      '.pf-cam{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;',
      '  transform-origin:56% 48%;will-change:transform;',
      '  animation:pfGlide var(--gd,4s) linear both;}',
      '@keyframes pfGlide{from{transform:scale(var(--k0,1))}to{transform:scale(var(--k1,1.06))}}',
      '.pf-shot{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center;}',
      '.pf-shot--sharp{object-fit:contain;opacity:1;}',
      '.pf-shot--top{object-fit:cover;object-position:top center;}',
      '.pf-shot--dim{opacity:.34;filter:blur(1px) saturate(.85);}',
      '.pf-shot--deep{opacity:.20;filter:blur(2px) saturate(.8);}',
      // .pf-ken retired: a 10s ease-out on a 4-5s beat only ever played its
      // decelerating first half, so each beat lurched then stopped. The layer
      // glide replaces it at constant velocity.
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
      '.msl-dev{width:min(880px,94vw);border-radius:16px;overflow:hidden;transition:width 1.04s linear,border-color 1.04s linear,border-radius 1.04s linear,background-color 1.04s linear,box-shadow 1.04s linear;border:1px solid rgba(255,255,255,.1);background:#0c111a;box-shadow:0 60px 130px -50px rgba(0,0,0,.9),0 0 0 1px rgba(255,255,255,.02);}',
      '.msl-dev-bar{display:flex;align-items:center;gap:7px;padding:12px 16px;max-height:48px;overflow:hidden;transition:opacity 1.04s linear,max-height 1.04s linear,padding 1.04s linear,border-bottom-color 1.04s linear;border-bottom:1px solid rgba(255,255,255,.06);background:#0a0e16;}',
      '.msl-dev-bar>i{width:11px;height:11px;border-radius:50%;background:rgba(255,255,255,.14);}',
      '.msl-dev-url{margin-left:14px;font-family:ui-monospace,"SF Mono",Menlo,monospace;font-size:.72rem;color:var(--dim);}',
      '.msl-canvas{position:relative;height:min(52vh,460px);overflow:hidden;transition:height 1.04s linear;background:#0b0f17;}',
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
      // Reveal only — no scale. This used to pop from scale(.965) to rest on
      // every beat, fighting the camera and landing at a standstill.
      '@keyframes mslZoomIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}',
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
      // ── opening beat ────────────────────────────────────────────────────
      // The frame morphs across the dissolve. `display:none` cannot transition,
      // so the bar collapses by max-height and opacity — otherwise the browser
      // chrome snapped into existence halfway through the promise->upload
      // dissolve, which was its own visible discontinuity.
      '.pf-bare .msl-dev-bar{opacity:0;max-height:0;padding-top:0;padding-bottom:0;border-bottom-color:transparent;}',
      '.pf-bare .msl-dev{width:min(1180px,96vw);border-color:transparent;border-radius:20px;background:#000;box-shadow:0 70px 150px -60px rgba(0,0,0,.95);}',
      '.pf-bare .msl-canvas{height:min(62vh,560px);background:#000;}',
      '.pf-open{position:absolute;inset:0;overflow:hidden;border-radius:inherit;}',
      // The push runs the full 3s and does not settle, so the cut into the
      // upload beat lands mid-move — the camera keeps going rather than
      // stopping and jumping somewhere else.
      '.pf-open-scene{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:56% 52%;}',
      // Continuous push. Same rate across both beats (~0.03 scale/sec) so the
      // camera never stops: logo covers 1.000->1.045 in 1.5s, promise picks up
      // at 1.045 and carries to 1.120 in 2.5s.
      // The opening plates no longer carry their own push — the layer glide does,
      // so the veil, halo and type travel with the shot instead of over it.
      // Shallow depth of field over the whole frame, pulling into focus as the
      // camera closes. This is what keeps the dashboard from reading as a
      // dashboard while the brand has the frame.
      // The veil suppresses the app while the brand holds, then lifts as we
      // approach it.
      '.pf-veil{position:absolute;inset:0;background:rgba(4,6,11,.72);}',
      '.pf-veil-b{animation:pfVeil 2.5s cubic-bezier(.33,0,.25,1) both;}',
      // Subdued until the text clears, then lifts through the approach and
      // straight on into the workflow, so brightness ramps across the cut
      // instead of stepping at it.
      '@keyframes pfVeil{0%{opacity:1}62%{opacity:.94}100%{opacity:.46}}',
      // Light behind the lockup. The brief asked for lighting that draws the eye
      // to the brand, so the source sits behind the type rather than in a corner.
      '.pf-halo{position:absolute;inset:0;pointer-events:none;',
      '  background:radial-gradient(38% 44% at 50% 46%,rgba(216,184,114,.20),transparent 70%);',
      '  animation:pfHalo 1.5s ease-out both;}',
      '@keyframes pfHalo{from{opacity:0}45%{opacity:1}to{opacity:1}}',
      '.pf-open-lock{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;',
      '  justify-content:center;text-align:center;gap:14px;animation:pfLockIn 1.5s cubic-bezier(.4,0,.2,1) both;}',
      '@keyframes pfLockIn{0%{opacity:0;transform:translateY(12px) scale(.985)}',
      '  46%{opacity:1;transform:translateY(0) scale(1)}100%{opacity:1;transform:translateY(0) scale(1.012)}}',
      // Emotion card. No product, no chrome — just the line.
      '.pf-story{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;',
      '  animation:pfStory 1.5s cubic-bezier(.4,0,.2,1) both;}',
      // The line lives in a block child. When the <em> was a direct child of the
      // flex container it became a flex ITEM and laid out in a row beside the
      // text, so "a story." sat next to "property" instead of after the break.
      '.pf-story p{margin:0;text-align:center;font-family:Inter,-apple-system,system-ui,sans-serif;',
      '  font-weight:600;font-size:clamp(1.5rem,3.9vw,2.9rem);line-height:1.26;',
      '  letter-spacing:-.025em;color:#EAECEF;}',
      '.pf-story p em{font-style:normal;background:linear-gradient(120deg,#EBD49A,#C9A254 55%,#E4C57F);',
      '  -webkit-background-clip:text;background-clip:text;color:transparent;}',
      '@keyframes pfStory{0%{opacity:0;transform:translateY(14px)}34%{opacity:1;transform:translateY(0)}',
      '  100%{opacity:1;transform:translateY(-4px)}}',
      // Kinetic type for the spoken promise, left-composed per the storyboard so
      // it does not sit on top of the laptop.
      // Guarantees the type reads once the veil lifts and the dashboard
      // brightens underneath it.
      '.pf-lgrad{position:absolute;inset:0;pointer-events:none;',
      '  background:linear-gradient(90deg,rgba(3,5,9,.86) 0%,rgba(3,5,9,.62) 34%,transparent 62%);}',
      '.pf-line{position:absolute;left:7%;right:46%;top:50%;transform:translateY(-50%);text-align:left;',
      '  font-family:Inter,-apple-system,system-ui,sans-serif;font-weight:600;',
      '  font-size:clamp(1.3rem,3.2vw,2.35rem);line-height:1.22;letter-spacing:-.025em;color:#EAECEF;opacity:0;}',
      '.pf-line em{font-style:normal;background:linear-gradient(120deg,#EBD49A,#C9A254 55%,#E4C57F);',
      '  -webkit-background-clip:text;background-clip:text;color:transparent;}',
      // Timed to the READ, not to the beat. Decoding vo-upload.mp3 to PCM shows
      // 400ms of true silence from 1.84s to 2.24s — the sentence break. Earlier
      // I reported there was no pause over 140ms in this clip; that came from
      // the MP3 frame-header proxy, which is flat for speech, and it was wrong.
      // Against --ed (2500 + 1040 = 3540ms): the break is 52-63%, so line A
      // holds to 52% and line B arrives at 65%, as the second sentence starts.
      '.pf-line-a{animation:pfLineA var(--ed,3540ms) cubic-bezier(.4,0,.2,1) both;}',
      '.pf-line-b{animation:pfLineB var(--ed,3540ms) cubic-bezier(.4,0,.2,1) both;}',
      '@keyframes pfLineA{0%{opacity:0;transform:translateY(calc(-50% + 10px))}',
      '  8%{opacity:1;transform:translateY(-50%)}52%{opacity:1;transform:translateY(-50%)}',
      '  58%{opacity:0;transform:translateY(calc(-50% - 8px))}100%{opacity:0}}',
      // Line B carries across the cut, fading with its layer as the workflow
      // comes up — the type bridges the transition the way the voice does.
      '@keyframes pfLineB{0%{opacity:0;transform:translateY(calc(-50% + 10px))}',
      '  65%{opacity:0;transform:translateY(calc(-50% + 10px))}',
      '  71%{opacity:1;transform:translateY(-50%)}',
      '  88%{opacity:1;transform:translateY(-50%)}',
      '  96%{opacity:0;transform:translateY(calc(-50% - 10px))}',
      '  100%{opacity:0;transform:translateY(calc(-50% - 10px))}}',
      // The workflow arrives mid-move and settles, instead of cutting in cold.
      // .pf-arrive retired: it decelerated to a stop, which is the camera
      // parking. `upload` now enters already pushed in (k0 1.045) and keeps
      // travelling at the same rate as the beat before it.

      // Defocus by cross-fading a pre-blurred copy of the plate. This replaces
      // three animated backdrop-filters that were re-blurring the whole frame
      // every frame inside a scaling ancestor — 15fps on the promise beat
      // against 54fps where there was no blur. Judder is a cinematography
      // problem, and it was worst exactly where the camera move matters most.
      '.pf-blur{opacity:1;}',
      // Held fully defocused while the brand has the frame.
      // The rack pulls it off as the camera closes on the screen.
      '.pf-rack{animation:pfRack var(--ed,3540ms) linear both;}',
      '@keyframes pfRack{0%{opacity:1}62%{opacity:.92}100%{opacity:.06}}',
      // Brand light. Warm accent from the top-left, matching the gold in the
      // artwork, plus a vignette so the frame closes down at the corners.
      '.pf-open-black{position:absolute;inset:0;background:#000;animation:pfFromBlack .8s ease-out both;}',
      '@keyframes pfFromBlack{from{opacity:1}to{opacity:0}}',
      '.pf-open-mark{width:clamp(52px,6.4vw,84px);height:auto;filter:drop-shadow(0 6px 26px rgba(201,151,58,.42));}',
      '.pf-open-word{font-family:Inter,-apple-system,system-ui,"Segoe UI",sans-serif;',
      '  font-size:clamp(1.5rem,3.6vw,2.6rem);font-weight:300;letter-spacing:.24em;',
      '  text-indent:.24em;color:#F4F6F8;line-height:1;}',
      '.pf-open-rule{width:84px;height:1px;background:linear-gradient(90deg,transparent,var(--goldl),transparent);',
      '  box-shadow:0 0 14px rgba(228,183,92,.55);}',
      '.pf-open-tag{font-family:Inter,-apple-system,system-ui,"Segoe UI",sans-serif;',
      '  font-size:clamp(1rem,2.1vw,1.55rem);font-weight:600;letter-spacing:-.015em;line-height:1.28;color:#EAECEF;}',

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
      '  .msl-onchain--lg{transform:none;}',
      // Phones: go edge to edge. The frame was taking 43% of a 390x844 screen —
      // a landscape film sitting in the middle of a portrait phone with black
      // above and below. Dropping the page padding, the device border and the
      // radius, and floating the caption over the picture instead of below it,
      // takes it past 70%.
      '  .msl-cine{padding:0;}',
      '  .msl-dev{width:100%!important;border:0!important;border-radius:0!important;box-shadow:none!important;}',
      '  .msl-dev-bar{display:none;}',
      // Two different answers, because the beats are two different things.
      //
      // The opening beats are photography and type. Cropping a photograph to a
      // portrait frame is what a camera does, so they take the whole screen.
      //
      // The product beats are landscape screenshots of a wide UI. Filling a
      // 390x844 phone with one crops it to about a third of its width: at 66vh
      // the tenant names came out as "...ket" and "...rovisions", and "Reading 3
      // documents" ran off the edge. More screen made them WORSE. They get the
      // full width and as much height as stays legible, and no more.
      '  .msl-canvas{height:56vh!important;}',
      '  .pf-bare .msl-canvas{height:82vh!important;}',
      // Over the picture, on its own scrim, so it costs no vertical space.
      '  .msl-cap{position:absolute;left:0;right:0;bottom:26px;margin:0;padding:0 20px 0;z-index:5;',
      '    font-size:1.02rem;text-shadow:0 2px 18px rgba(0,0,0,.85);}',
      '  .msl-timeline{position:absolute;left:0;right:0;bottom:12px;width:auto;margin:0 20px;z-index:5;}',
      '  .msl-vox{top:14px;right:60px;height:32px;padding:0 11px;font-size:.64rem;}',
      '  .msl-cine-close{top:14px;right:14px;width:32px;height:32px;}',
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

  // ── camera ──────────────────────────────────────────────────────────────────
  // One move, constant velocity, one direction, for the whole film. Every beat
  // glides at CAM_RATE scale-units per millisecond, so the outgoing and incoming
  // shots are travelling at the same speed in the same direction across the
  // dissolve and the eye reads it as a single continuous move.
  //
  // Velocity matching is the whole trick. Absolute scale resets per beat (it
  // would otherwise reach 2x by the end of the film) and the dissolve hides that
  // reset — but only while the velocities agree. The previous version had beats
  // easing OUT to a standstill before each cut, which is why they read as
  // separate images no matter how well composed they were.
  var CAM_RATE = 0.000016;   // scale per ms  (1.6% per second)
  var XFADE    = 1040;       // dissolve overlap
  // Clamped so a 1.5s beat is not mostly dissolve. The long overlap is wanted
  // on the wide beats, where there is time for two shots to travel together.
  function xfadeFor(i) { return Math.min(XFADE, Math.round(SCENES[i].dur * 0.5)); }

  function camStart(i) {
    var s = SCENES[i];
    // `chain` continues the previous beat's absolute scale, so the two layers sit
    // at the SAME scale as well as the same velocity through the dissolve.
    if (s.chain && i > 0) return camEnd(i - 1);
    return typeof s.k0 === 'number' ? s.k0 : 1;
  }
  // Where the camera has reached when the NEXT beat starts. This is the chain
  // hand-off point, and it deliberately excludes the dissolve tail.
  function camEnd(i) { return camStart(i) + CAM_RATE * SCENES[i].dur; }
  // Where the glide animation must finish. The layer keeps travelling for XFADE
  // beyond its own beat, so its end scale has to cover that too — otherwise the
  // same distance is spread over a longer time and the beat glides SLOWER than
  // CAM_RATE. That was the velocity mismatch: measured 1.05e-5/ms against a
  // declared 1.6e-5/ms, which is precisely what made each shot read as its own
  // move rather than part of one.
  function camGlideEnd(i) { return camStart(i) + CAM_RATE * (SCENES[i].dur + xfadeFor(i)); }

  function renderScene() {
    clearTimeout(state.timer);
    var s = SCENES[state.i];
    capEl.style.opacity = '0'; capEl.style.transform = 'translateY(6px)';
    var urlEl = root.querySelector('#pfUrl');
    if (urlEl) urlEl.textContent = (typeof URLS !== 'undefined' && URLS[s.id]) || 'mainstreetcam.com';
    canvas.style.setProperty('--fw', (s.fw || 760) + 'px');
    // The opening beat is photography of a laptop in a room. Wrapping that in
    // the browser chrome put a laptop inside a browser window — a frame within
    // a frame, which read as a screenshot rather than a room. Bare beats drop
    // the chrome and fill the frame edge to edge; the chrome returns for every
    // beat that really is the app.
    root.classList.toggle('pf-bare', !!s.bare);
    // The closing line is the payoff, so the music is allowed to stay closer to
    // it than anywhere else — the brand card should swell, not duck flat.
    audio.depthDb = (s.id === 'brand') ? BED_BRAND_DB : BED_DUCK_DB;

    // Cross-dissolve, not a cut. The outgoing layer stays mounted and keeps
    // running its own animations while it fades, so it is still moving when the
    // incoming layer comes up over it. `canvas.innerHTML = ''` was here before,
    // which made every transition a hard cut between two still frames.
    // Two nested elements on purpose. The OUTER owns opacity, the INNER owns the
    // camera transform.
    //
    // They were one element at first, with the dissolve and the glide as two
    // entries in a single `animation` shorthand. Adding the fade-out class
    // rewrote that shorthand, and changing the animation-name list RESTARTS
    // every animation in it — so the outgoing shot snapped back to its starting
    // scale at the exact moment of the cut. Measured: story left frame at scale
    // 1.0004 when it should have been at 1.024.
    //
    // Opacity is a transition here rather than an animation, so toggling it can
    // never disturb the glide.
    var prev = canvas.querySelector('.pf-layer:not(.pf-layer--out)');
    var wrap = document.createElement('div');
    wrap.className = 'pf-layer';
    var XF = xfadeFor(state.i);
    var cam = document.createElement('div');
    cam.className = 'pf-cam';
    // Strings, not numbers. setProperty coerces, but an unparsable value makes
    // var() fall back silently — which is how k0 was lost: every beat entered at
    // scale 1 regardless, including `upload` at its declared 1.045.
    cam.style.setProperty('--k0', String(camStart(state.i)));
    cam.style.setProperty('--k1', String(camGlideEnd(state.i)));
    cam.style.setProperty('--gd', (s.dur + XF) + 'ms');  // still travelling as it fades
    // A third element so a beat can carry its OWN entry move (approach, arrival,
    // perspective straighten) without touching the camera's glide — two
    // transform animations on one element would fight, last one wins.
    var body = document.createElement('div');
    body.className = 'pf-body' + (s.enter ? ' pf-body--' + s.enter : '');
    body.style.setProperty('--ed', (s.dur + XF) + 'ms');
    cam.appendChild(body);
    wrap.appendChild(cam);
    canvas.appendChild(wrap);
    s.build(body);
    // The dissolve: the incoming layer fades UP over an outgoing layer that is
    // held fully opaque. That composites to new*a + old*(1-a) — a true
    // cross-dissolve — and it is more robust than fading both, which double-dips
    // the luminance in the middle of every transition.
    //
    // Driven by the Web Animations API rather than a class-toggled transition.
    // The class version silently did not run on the outgoing layer, and an
    // accidental effect that happens to look right is one refactor away from
    // looking wrong.
    var fade = wrap.animate([{ opacity: 0 }, { opacity: 1 }],
                            { duration: XF, easing: 'linear', fill: 'both' });
    if (prev) {
      prev.classList.add('pf-layer--out');       // held opaque; only stops hit-testing
      var drop = function () { if (prev.parentNode) prev.parentNode.removeChild(prev); };
      // Removed only once the incoming layer is fully opaque, so the outgoing
      // shot is never visibly pulled out from underneath.
      if (fade.finished) fade.finished.then(drop).catch(drop);
      else setTimeout(drop, XF + 80);
    }
    // Tied to the dissolve. At a flat 260ms the caption for the incoming beat
    // appeared while the outgoing shot was still fully opaque — the words
    // arrived before the picture they describe.
    setTimeout(function () {
      capEl.textContent = s.cap || '';
      capEl.style.opacity = s.cap ? '1' : '0';
      capEl.style.transform = 'translateY(0)';
    }, Math.round(XF * 0.6) + 120);
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
    mixFromUrl();
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
    // Which beat is on screen. Exposed for tests: asserting the beat order by
    // scrubbing with arrow keys conflated playback with scrubbing and proved
    // flaky, and inferring the beat from DOM markers guessed at internals.
    beatId: function () { return SCENES[state.i] ? SCENES[state.i].id : null; },
    // Audition the balance without a rebuild. Two passes of guessing at this
    // from measurements have now been overruled by ears, so the levels are
    // adjustable live:  ProductFilm.mix({ baseDb: -24, duckDb: -18 })
    // or on a phone, where there is no console:  /home?mix=-24,-18
    mix: setMix,
    // Test seam. The bed's level lives in the graph now, not on the element, so
    // reading el.volume tells you nothing — it is pinned at 1.
    mixState: function () {
      if (!audio.ctx) return null;
      return { follow: audio.follow,
               duckDb: 20 * Math.log10(Math.max(audio.duck.gain.value, 1e-6)),
               baseDb: 20 * Math.log10(Math.max(audio.base.gain.value, 1e-6)),
               eqDb: audio.eq.gain.value, depthDb: audio.depthDb };
    },
    narrationCues: narrationCues,
    narrationEndMs: narrationEndMs,
    narrationScript: narrationScript,
    scenes: function () { return SCENES.map(function (s) { return { id: s.id, dur: s.dur, cap: s.cap, vo: s.vo }; }); },
  };
})();
