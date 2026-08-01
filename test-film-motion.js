'use strict';
/**
 * Cinematography contract: one continuous camera move, not a sequence of shots.
 *
 * The film used to hard-cut between beats (`canvas.innerHTML = ''`) while each
 * beat's own motion eased OUT to a standstill first — `.pf-ken` was a 10s
 * ease-out on 4-5s beats, and `.msl-zoomin` popped from scale(.965) to rest.
 * Every transition therefore joined two stationary frames, which is what made
 * well-composed beats still read as separate images.
 *
 * The fix has three parts, and all three are measured here rather than asserted
 * from the source:
 *
 *   1  a cross-dissolve exists at every transition, with both layers mounted
 *   2  every beat travels at the SAME speed in the SAME direction, so the
 *      outgoing and incoming shots agree on velocity across the dissolve
 *   3  beats sharing a plate hand off at the same absolute scale, so the
 *      identical image never changes size mid-dissolve
 *
 * Method: instrument one full playthrough with a requestAnimationFrame sampler
 * that records every layer's scale and opacity each frame, then derive all of it
 * from that trace. Velocity comes from least-squares regression over each
 * layer's samples — a frame-to-frame difference is ~2.6e-4 in scale, which is
 * inside the noise of a computed transform matrix.
 */
let pw; try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = __dirname, PORT = 8857;
const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css',
               '.json':'application/json', '.png':'image/png', '.svg':'image/svg+xml',
               '.jpg':'image/jpeg', '.mp3':'audio/mpeg' };
let pass = 0, fail = 0;
const ok  = m => { console.log('  \x1b[32m✓\x1b[0m ' + m); pass++; };
const bad = (m, d) => { console.log('  \x1b[31m✗\x1b[0m ' + m + (d ? ' — ' + d : '')); fail++; };

const srv = http.createServer((rq, rs) => {
  let r = decodeURIComponent(rq.url.split('?')[0]); if (r === '/') r = '/home.html';
  fs.readFile(path.join(ROOT, r), (e, d) => {
    if (e) { rs.writeHead(404); rs.end('nf'); return; }
    rs.writeHead(200, { 'Content-Type': MIME[path.extname(r)] || 'application/octet-stream' }); rs.end(d);
  });
});

// Least squares slope, in scale-units per millisecond.
function slope(pts) {
  const n = pts.length;
  if (n < 6) return null;
  let st = 0, sv = 0, stt = 0, stv = 0;
  for (const [t, v] of pts) { st += t; sv += v; stt += t * t; stv += t * v; }
  const d = n * stt - st * st;
  return d === 0 ? null : (n * stv - st * sv) / d;
}

(async () => {
  await new Promise(r => srv.listen(PORT, '127.0.0.1', r));
  const b = await pw.chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await (await b.newContext({ viewport: { width: 1280, height: 820 } })).newPage();
  await page.route('**fonts.g**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });

  const runMs = await page.evaluate(() => window.ProductFilm.scenes().reduce((a, s) => a + s.dur, 0));

  await page.evaluate(() => {
    window.__tr = [];
    // Tag each layer instance so the trace can tell a re-entered beat from the
    // same one continuing, and so regression groups samples per instance.
    let seq = 0;
    window.__t0 = Date.now();
    window.ProductFilm.play();
    const tick = () => {
      const t = Date.now() - window.__t0;
      const frame = [];
      document.querySelectorAll('#pfCanvas .pf-layer').forEach(l => {
        if (!l.__id) l.__id = ++seq;
        const cam = l.querySelector('.pf-cam');
        if (!cam) return;
        const m = new DOMMatrixReadOnly(getComputedStyle(cam).transform);
        const bodyEl = l.querySelector('.pf-body');
        const bm = bodyEl ? new DOMMatrixReadOnly(getComputedStyle(bodyEl).transform).a : 1;
        const plate = l.querySelector('.pf-approach');
        const pm = plate ? new DOMMatrixReadOnly(getComputedStyle(plate).transform).a : 1;
        // How far the plate's VISIBLE CONTENT runs past the frame, in px a side.
        // Not the <img> box: a contain-fitted plate letterboxes inside its box,
        // so the box can overflow while every pixel of the screenshot is still
        // on screen. Positive means real content is being cut off.
        let ovl = null, ovr = null, shotW = null;
        const shot = l.querySelector('.pf-shot');
        if (shot && shot.naturalWidth) {
          const host = l.parentElement.getBoundingClientRect();
          const r = shot.getBoundingClientRect();
          let cw = r.width;
          if (getComputedStyle(shot).objectFit === 'contain') {
            cw = shot.naturalWidth * Math.min(r.width / shot.naturalWidth, r.height / shot.naturalHeight);
          }
          const cl = r.left + (r.width - cw) / 2;
          ovl = host.left - cl; ovr = (cl + cw) - host.right;
          shotW = cw;
        }
        // Overlays that CLAIM to be horizontally centred, measured once their
        // entry animation has landed (opacity 1). Recorded as offset-from-centre
        // and outside-the-frame, both in px.
        const host2 = l.parentElement.getBoundingClientRect();
        const mid = (host2.left + host2.right) / 2;
        const centred = [];
        l.querySelectorAll('.pf-callout,.pf-total,.pf-worker').forEach(el => {
          if (parseFloat(getComputedStyle(el).opacity) < 0.98) return;
          const r2 = el.getBoundingClientRect();
          if (!r2.width) return;
          centred.push({ cls: el.className.split(' ')[0],
                         off: Math.round(Math.abs((r2.left + r2.right) / 2 - mid)),
                         out: Math.round(Math.max(host2.left - r2.left, r2.right - host2.right)) });
        });
        const rec = l.querySelector('#pfRecover'), askq = l.querySelector('#pfAskQ');
        frame.push({ id: l.__id, beat: window.ProductFilm.beatId(),
                     k0: parseFloat(cam.style.getPropertyValue('--k0')),
                     s: m.a, b: bm, p: pm, plate: !!plate,
                     shotCls: shot ? shot.className : null, ovl, ovr, shotW, centred,
                     rec: rec ? rec.textContent : null,
                     askq: askq ? askq.textContent : null,
                     o: parseFloat(getComputedStyle(l).opacity),
                     out: l.classList.contains('pf-layer--out') });
      });
      window.__tr.push({ t, frame });
      window.__raf = requestAnimationFrame(tick);
    };
    tick();
  });
  await page.waitForTimeout(runMs + 1200);
  await page.evaluate(() => cancelAnimationFrame(window.__raf));
  const tr = await page.evaluate(() => window.__tr);

  console.log(`\n── The trace is usable ──`);
  console.log(`   ${tr.length} frames over ${(tr[tr.length-1].t/1000).toFixed(1)}s`);
  (tr.length > 1200) ? ok(`sampled ${tr.length} frames — enough to regress per-beat velocity`)
                     : bad('too few frames sampled', String(tr.length));
  const empty = tr.filter(f => f.frame.length === 0).length;
  // One or two empty frames at t=0 before the first layer mounts is normal.
  (empty <= 3) ? ok(`the frame is never empty (${empty} unpopulated samples at mount)`)
               : bad('the canvas went empty mid-film', `${empty} frames with no layer`);

  // Group samples by layer instance.
  const byId = new Map();
  for (const f of tr) for (const l of f.frame) {
    if (!byId.has(l.id)) byId.set(l.id, { id: l.id, beat: l.beat, k0: l.k0, pts: [], ops: [] });
    const g = byId.get(l.id);
    g.pts.push([f.t, l.s]); g.ops.push([f.t, l.o, l.out]);
  }
  const layers = [...byId.values()].sort((a, b) => a.pts[0][0] - b.pts[0][0]);

  console.log('\n── Every beat travels at the same speed, in the same direction ──');
  // Trim the trailing hold before taking a slope. The last layer keeps being
  // sampled after its glide has finished — the brand card is supposed to sit
  // there — and those flat samples drag its average velocity down. The suite
  // spent a run reporting "beats travel at different speeds, 14.92 vs 16.00"
  // when the only thing that had changed was how long the hold lasted. What is
  // under test is the speed of the move, not the length of the rest after it.
  const moving = pts => {
    let end = pts.length - 1;
    while (end > 0 && pts[end][1] - pts[end - 1][1] <= 0) end--;
    return end >= 2 ? pts.slice(0, end + 1) : pts;
  };
  const vels = layers.map(l => ({ id: l.id, v: slope(moving(l.pts)) })).filter(x => x.v !== null);
  const vs = vels.map(x => x.v);
  const vMin = Math.min(...vs), vMax = Math.max(...vs);
  vs.every(v => v > 0)
    ? ok(`all ${vs.length} shots push IN — none reverses direction`)
    : bad('a shot moves the wrong way', JSON.stringify(vels.filter(x => x.v <= 0)));
  // The property that matters is agreement, not any particular value: a shared
  // speed is what lets two shots read as one move. 6% spread covers compositor
  // jitter on a loaded headless box.
  const spread = (vMax - vMin) / vMax;
  (spread <= 0.06)
    ? ok(`speeds agree within ${(spread*100).toFixed(1)}% — ${(vMin*1e6).toFixed(2)}–${(vMax*1e6).toFixed(2)} scale-units/µs`)
    : bad('beats travel at different speeds', `spread ${(spread*100).toFixed(1)}%, ${(vMin*1e6).toFixed(2)}–${(vMax*1e6).toFixed(2)}/µs`);

  console.log('\n── Every transition is a dissolve, not a cut ──');
  // A transition is any run of frames carrying two layers at once. `a`/`b` are
  // the first and last two-layer SAMPLES; `outer` is the span between the
  // single-layer samples that bracket them, which is the widest the overlap
  // could possibly have been. The truth is somewhere between the two, and the
  // gap is entirely the sampler's resolution — see the note on the bound below.
  const runs = [];
  let cur = null, lastSingle = 0;
  for (const f of tr) {
    if (f.frame.length >= 2) { cur ? (cur.b = f.t) : (cur = { a: f.t, b: f.t, n: 1, pre: lastSingle }); cur.n++; }
    else { if (cur) { cur.post = f.t; runs.push(cur); cur = null; } lastSingle = f.t; }
  }
  if (cur) { cur.post = tr[tr.length - 1].t; runs.push(cur); }
  (runs.length === 12)
    ? ok(`12 dissolves for 13 beats — every transition overlaps two shots`)
    : bad('wrong number of dissolves', `${runs.length} found, expected 12`);
  // Bounded ABOVE by the outer span and BELOW by frame count, not by an inner
  // duration. This used to demand at least 600ms, on the theory that a longer
  // overlap reads as a glide; watching it proved the opposite — at ~1s two
  // complete screens sit legibly on top of each other and the film reads as
  // though it has glitched. So the ceiling is what matters now, and the outer
  // span is the conservative way to measure it: it can only over-report.
  //
  // The floor is counted in frames rather than milliseconds on purpose. A
  // 320ms dissolve gets ~20 rAF samples when the box is idle and as few as 4
  // when it is loaded, so an inner-duration floor measures how busy the machine
  // is — it failed at "127ms" on a dissolve that was running exactly as
  // authored. Two or more overlapping frames is what "not a cut" means at any
  // sampling rate; that the fade genuinely ramps is proven below by opacity.
  const outer = runs.map(r => r.post - r.pre);
  const widest = Math.max(...outer), fewest = Math.min(...runs.map(r => r.n));
  (widest <= 620 && fewest >= 2)
    ? ok(`overlaps span at most ${widest}ms (${fewest}+ frames each) — a dissolve, never a double exposure`)
    : bad(fewest < 2 ? 'a transition is a cut, not a dissolve'
                     : 'a transition leaves two screens readable at once',
          `widest outer span ${widest}ms, fewest overlapping frames ${fewest}`);

  console.log('\n── Both shots keep moving through the dissolve ──');
  let stalled = 0, held = 0, rose = 0, thin = 0;
  for (const r of runs) {
    const win = tr.filter(f => f.t >= r.a && f.t <= r.b && f.frame.length >= 2);
    const ids = [...new Set(win.flatMap(f => f.frame.map(l => l.id)))];
    for (const id of ids) {
      const pts = win.flatMap(f => f.frame.filter(l => l.id === id).map(l => [f.t, l.s]));
      // Under three samples a slope is noise, not a measurement: across a 320ms
      // dissolve on a loaded box a layer can appear in two frames whose scales
      // round the same way, and the suite then reports a stall on a shot that
      // never stopped. Those windows are counted separately rather than judged.
      if (pts.length < 3) { thin++; continue; }
      const v = slope(pts);
      if (v === null || v <= 0) stalled++;
    }
    // The outgoing layer is held opaque on purpose: a semi-transparent incoming
    // layer over an opaque outgoing one composites to new*a + old*(1-a), a true
    // cross-dissolve, without the mid-transition luminance dip that fading both
    // would produce.
    const outOps = win.flatMap(f => f.frame.filter(l => l.out).map(l => l.o));
    if (outOps.length && Math.min(...outOps) > 0.9) held++;
    // Measured as a RISE, not against absolute endpoints. The old form wanted
    // the first two-layer sample below 0.5 and the last above 0.9, which a
    // ~40ms sampler can only satisfy if the fade is long: across 320ms it has
    // eight samples and routinely misses the last 10% of the ramp, so it
    // reported "the incoming shot does not fade in" on a fade that was running
    // perfectly. A rise of 0.4 over the run proves the same thing at any length.
    const inOps = win.flatMap(f => f.frame.filter(l => !l.out).map(l => l.o));
    if (inOps.length > 1 && inOps[inOps.length-1] - inOps[0] >= 0.4) rose++;
  }
  (stalled === 0)
    ? ok(`no shot is stationary during a dissolve — both layers are still travelling`
         + (thin ? ` (${thin} window(s) too thinly sampled to judge)` : ''))
    : bad('a shot stalls mid-transition', `${stalled} layer(s) with zero or negative velocity`);
  (held === runs.length)
    ? ok(`the outgoing shot stays opaque through all ${held} dissolves — no luminance dip`)
    : bad('the outgoing shot fades too', `${held} of ${runs.length} held`);
  (rose >= runs.length - 1)
    ? ok(`the incoming shot fades up across ${rose} of ${runs.length} dissolves`)
    : bad('the incoming shot does not fade in', `${rose} of ${runs.length}`);

  console.log('\n── Beats sharing a plate hand off at the same scale ──');
  // promise continues logo, and upload continues promise. For those, a scale
  // reset would show up as the same image changing size mid-dissolve.
  const CHAINED = ['promise'];
  for (const beat of CHAINED) {
    const inc = layers.find(l => l.beat === beat);
    if (!inc) { bad(`no layer recorded for ${beat}`); continue; }
    const t0 = inc.pts[0][0];
    const outAt = tr.find(f => f.t >= t0 && f.frame.some(l => l.out));
    const o = outAt && outAt.frame.find(l => l.out);
    const i = outAt && outAt.frame.find(l => !l.out);
    if (!o || !i) { bad(`could not sample the ${beat} dissolve`); continue; }
    const d = Math.abs(o.s - i.s);
    (d <= 0.004)
      ? ok(`${beat} enters at the scale the previous shot left (${i.s.toFixed(4)} vs ${o.s.toFixed(4)})`)
      : bad(`${beat} jumps scale mid-dissolve`, `${o.s.toFixed(4)} -> ${i.s.toFixed(4)}, Δ${d.toFixed(4)}`);
  }

  console.log('\n── The opening hands the frame to the product at matched size ──');
  // The transition that still read as a cut. The laptop's screen occupies only
  // part of its plate, so at the cut the Command Center UI was at that fraction
  // of frame while the incoming screenshot filled it completely — two pictures
  // of an interface at different sizes, which no amount of layer-scale matching
  // can disguise. The approach pushes the plate until the two agree.
  //
  // The screen fraction is RE-MEASURED here from keyart-scene.jpg rather than
  // read from product-film.js, the same way the narration suite re-measures the
  // mp3s: a constant the film asserts about itself proves nothing.
  const frac = await page.evaluate(async (src) => {
    const img = new Image(); img.src = src; await img.decode();
    const W = img.width, H = img.height;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    c.getContext('2d').drawImage(img, 0, 0);
    const d = c.getContext('2d').getImageData(0, 0, W, H).data;
    const L = (x, y) => { const i = (y * W + x) * 4; return 0.2126*d[i] + 0.7152*d[i+1] + 0.0722*d[i+2]; };
    // The panel is a dark-theme UI, so it is found by its density of edges, not
    // by brightness — the city behind it is brighter than the screen.
    const cx = new Array(W).fill(0);
    for (let y = 2; y < H - 2; y += 2) for (let x = 2; x < W - 2; x += 2)
      if (Math.abs(L(x, y+1) - L(x, y-1)) > 18) cx[x]++;
    const tot = cx.reduce((a, b) => a + b, 0), want = tot * 0.90;
    let bi = 0, bj = W - 1, best = 1e9;
    for (let a = 0; a < W; a++) { let sum = 0;
      for (let b = a; b < W; b++) { sum += cx[b];
        if (sum >= want) { if (b - a < best) { best = b - a; bi = a; bj = b; } break; } } }
    return (bj - bi) / W;
  }, '/assets/landing/keyart-scene.jpg');
  (frac > 0.6 && frac < 0.95)
    ? ok(`the laptop screen measures ${(frac*100).toFixed(0)}% of its plate's width`)
    : bad('could not measure the screen fraction', String(frac));

  // Apparent size of the interface in frame: camera x entry x plate, times the
  // screen fraction for the photograph and 1.0 for the full-bleed screenshot.
  const uiScale = l => l.s * l.b * l.p * (l.plate ? frac : 1);
  const uploadStart = tr.find(f => f.frame.some(l => l.beat === 'upload'));
  const win = uploadStart
    ? tr.filter(f => f.t >= uploadStart.t && f.t <= uploadStart.t + 1100 && f.frame.length >= 2)
    : [];
  const pairs = win.map(f => {
    const o = f.frame.find(l => l.out), i = f.frame.find(l => !l.out);
    return (o && i) ? { t: f.t, o: uiScale(o), i: uiScale(i) } : null;
  }).filter(Boolean);
  if (!pairs.length) bad('never sampled the opening -> product dissolve');
  else {
    const worst = Math.max(...pairs.map(p => Math.abs(p.o - p.i) / p.o));
    (worst <= 0.05)
      ? ok(`the two interfaces stay within ${(worst*100).toFixed(1)}% of each other's size across the whole dissolve`)
      : bad('the interfaces are different sizes across the cut',
            `worst ${(worst*100).toFixed(1)}% — ${pairs.map(p => p.o.toFixed(2)+'/'+p.i.toFixed(2)).slice(0,4).join(' ')}`);
    // Same direction and comparable speed, so neither picture is overtaking the
    // other while they are both on screen.
    const vo = slope(pairs.map(p => [p.t, p.o])), vi = slope(pairs.map(p => [p.t, p.i]));
    (vo > 0 && vi > 0 && Math.abs(vo - vi) / vo <= 0.35)
      ? ok(`both grow together through it (${(vo*1e6).toFixed(1)} vs ${(vi*1e6).toFixed(1)} scale/µs)`)
      : bad('the two interfaces move apart during the dissolve',
            `${(vo*1e6).toFixed(1)} vs ${(vi*1e6).toFixed(1)} scale/µs`);
  }
  // The approach must be still at the start of promise, or the logo -> promise
  // cut becomes a lurch, and moving by the end, or there is nothing to match.
  const prom = tr.filter(f => f.frame.some(l => l.beat === 'promise' && l.plate && !l.out));
  if (prom.length > 40) {
    const pick = f => { const l = f.frame.find(x => x.plate && !x.out); return [f.t, l.p]; };
    const half = Math.floor(prom.length / 2);
    const v1 = slope(prom.slice(0, half).map(pick)), v2 = slope(prom.slice(half).map(pick));
    (v1 < v2 * 0.25 && v2 > 0)
      ? ok(`the approach holds still through the first half, then moves in (${(v1*1e6).toFixed(1)} → ${(v2*1e6).toFixed(1)} scale/µs)`)
      : bad('the approach is not motivated', `first half ${(v1*1e6).toFixed(1)}, second ${(v2*1e6).toFixed(1)}`);
  } else bad('too few promise frames to measure the approach', String(prom.length));

  console.log('\n── The film fills a large screen ──');
  // Every measurement in this suite used to be taken at 1280x820, where the
  // frame's fixed 880x460 box filled 61% of the viewport and looked fine. On a
  // 1440p monitor that same box was 11% of the screen — and 19 checks passed
  // while the film was a postage stamp. Large sizes are measured now.
  for (const [w, h, label] of [[1920, 1080, '1080p'], [2560, 1440, '1440p']]) {
    const ctx = await b.newContext({ viewport: { width: w, height: h } });
    const p2 = await ctx.newPage();
    await p2.route('**fonts.g**', r => r.continue());
    await p2.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
    await p2.evaluate(() => { window.__t0 = Date.now(); window.ProductFilm.play(); });
    await p2.waitForFunction(() => Date.now() - window.__t0 >= 9000, null, { timeout: 15000, polling: 40 });
    const m = await p2.evaluate(() => {
      const c = document.querySelector('#pfFilm .msl-canvas').getBoundingClientRect();
      return { areaPct: +((c.width * c.height) / (innerWidth * innerHeight) * 100).toFixed(1),
               w: Math.round(c.width), h: Math.round(c.height) };
    });
    (m.areaPct >= 28)
      ? ok(`${label}: the film covers ${m.areaPct}% of the screen (${m.w}x${m.h})`)
      : bad(`${label}: the film is too small on this screen`, `${m.areaPct}% — ${m.w}x${m.h}`);
    await ctx.close();
  }

  console.log('\n── One beat at a time is readable ──');
  // The complaint was reading two screens at once on a 27-inch monitor. Layer
  // opacity cannot see this — the fix cuts overlays INSIDE a layer that is
  // deliberately held opaque — so this counts elements that actually carry
  // legible words on each layer.
  {
    const ctx = await b.newContext({ viewport: { width: 2560, height: 1440 } });
    const p3 = await ctx.newPage();
    await p3.route('**fonts.g**', r => r.continue());
    await p3.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
    const trace = await p3.evaluate(async () => {
      window.__t0 = Date.now(); window.ProductFilm.play();
      const out = [];
      await new Promise(res => {
        const iv = setInterval(() => {
          const t = Date.now() - window.__t0;
          const words = l => {
            if (parseFloat(getComputedStyle(l).opacity) < 0.12) return 0;
            return [...l.querySelectorAll('*')].filter(e => {
              if (e.tagName === 'IMG') return false;
              const cs = getComputedStyle(e);
              if (parseFloat(cs.opacity) < 0.25 || cs.visibility === 'hidden' || cs.display === 'none') return false;
              const txt = (e.textContent || '').trim();
              if (txt.length < 3) return false;
              if ([...e.children].some(c => (c.textContent || '').trim().length >= 3)) return false;
              const b = e.getBoundingClientRect();
              return b.width > 8 && b.height > 6;
            }).length;
          };
          out.push({ t, words: [...document.querySelectorAll('#pfCanvas .pf-layer')].map(words) });
          if (t > 26000) { clearInterval(iv); res(); }
        }, 40);
      });
      return out;
    });
    const runs = []; let cur = null;
    for (const s of trace) {
      const on = s.words.filter(x => x > 0).length >= 2;
      if (on) { cur ? cur.b = s.t : (cur = { a: s.t, b: s.t }); }
      else if (cur) { runs.push(cur); cur = null; }
    }
    if (cur) runs.push(cur);
    const total = runs.reduce((a, x) => a + (x.b - x.a), 0);
    const worst = runs.length ? Math.max(...runs.map(x => x.b - x.a)) : 0;
    console.log(`   double-reading windows: ${runs.map(x => (x.b - x.a) + 'ms').join(', ') || 'none'}`);
    // The overlays fade over 260ms, so a couple of frames of overlap per
    // transition is the floor. 300ms per window is the ceiling above which you
    // can actually read the old beat over the new one.
    (worst <= 300)
      ? ok(`no window longer than ${worst}ms — the old beat's text is gone before the new one lands`)
      : bad('two beats are readable at once', `worst window ${worst}ms`);
    (total <= 1200)
      ? ok(`${total}ms of overlap across ${runs.length} transitions, all of it the 260ms fade`)
      : bad('too much double-reading overall', `${total}ms`);
    await ctx.close();
  }

  console.log('\n── The retired motion is really gone ──');
  const src = fs.readFileSync(path.join(ROOT, 'product-film.js'), 'utf8');
  const build = src.slice(0, src.indexOf('function injectStyles'));
  [['pf-ken', 'the 10s ease-out ken-burns'], ['pf-arrive', 'the decelerating arrival'],
   ['pf-scene-a', 'the per-plate opening push']].forEach(([cls, what]) => {
    new RegExp('class="[^"]*\\b' + cls + '\\b').test(build)
      ? bad(`${what} is still applied to a beat`, cls) : ok(`${what} is gone (${cls})`);
  });
  /transform:scale\(\.965\)/.test(src)
    ? bad('mslZoomIn still scales, fighting the camera')
    : ok('per-beat reveals no longer scale — they only fade and rise');

  // ── What a first-time viewer would call a glitch ────────────────────────
  // Everything below came out of watching the film as a prospect rather than
  // reading it as its author. Each one is a thing that made the software look
  // broken for a moment, which is the only kind of flaw a demo cannot survive.

  console.log('\n── The camera push never cuts into a screenshot ──');
  // The push crops from every edge. On the blurred backdrops (--dim at .34
  // opacity, --deep at .20) that is invisible and intended. On a plate the
  // viewer is meant to READ, losing the first letter of five stacked tenant
  // names reads as a rendering fault: recon showed "ENANT / hole Health Market
  // / ummit Coffee", upload showed "cted Tenants (5)".
  const READABLE = f => f.shotCls && !/pf-shot--(dim|deep)/.test(f.shotCls) && !f.out;
  // Budget in px a side, stated per beat rather than inferred, so an exemption
  // is something you have to read rather than something that hides in a margin.
  //   recon, settle  contain-fitted and inset 4.6% so the push has its own
  //                  room. Presented AS a screen: must not lose a pixel. (0)
  //   upload         cover, but captured with side padding for exactly this
  //                  purpose. Its budget is MEASURED off the shipped png below
  //                  rather than written here: a hard-coded 88 passed happily
  //                  when the old unpadded plate was dropped back in, which is
  //                  a test that checks the number I typed instead of the file.
  //   space          cover and full-bleed by design: a whole-app screenshot
  //                  with the modal centred and the nearest content ~27% in
  //                  from the edge, already trimmed top and bottom by the same
  //                  fit. What the push takes off the sides is empty chrome.
  //                  Budgeted, not exempted, so a regression that doubled it
  //                  would still fail here.
  // The blank margin the upload plate actually carries, read out of the png by
  // column edge-density — the same technique the keyart screen fraction uses,
  // and for the same reason: what the film can safely crop is a property of the
  // asset, not a constant somebody remembered to update alongside it.
  const uploadMargin = await page.evaluate(async (src) => {
    const img = new Image(); img.src = src; await img.decode();
    const W = img.width, H = img.height;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, W, H).data;
    const L = (x, y) => { const i = (y * W + x) * 4; return 0.2126*d[i] + 0.7152*d[i+1] + 0.0722*d[i+2]; };
    const col = new Array(W).fill(0);
    for (let y = 2; y < H - 2; y += 2) for (let x = 0; x < W; x++)
      if (Math.abs(L(x, y+1) - L(x, y-1)) > 10) col[x]++;
    // Percentile bounds, not a first-nonzero scan. The card has a hairline
    // border and a faint background gradient, so every column from x=0 carries
    // 2-5 edge hits against a peak of ~194 — a first-nonzero scan called the
    // margin 0.1% and the whole measurement useless. 0.5%/99.5% of cumulative
    // edge energy finds where the content really starts.
    const tot = col.reduce((a, b) => a + b, 0);
    let acc = 0, lo = 0, hi = W - 1;
    for (let x = 0; x < W; x++) { acc += col[x]; if (!lo && acc >= tot * 0.005) lo = x; if (acc >= tot * 0.995) { hi = x; break; } }
    return Math.min(lo, W - 1 - hi) / W;
  }, '/assets/landing/ui-upload.png');
  const uploadShotW = Math.max(...tr.flatMap(f => f.frame.filter(l => l.beat === 'upload' && l.shotW).map(l => l.shotW)), 0);
  const uploadBudget = Math.floor(uploadMargin * uploadShotW);
  console.log(`   ui-upload.png carries ${(uploadMargin*100).toFixed(1)}% of blank margin a side` +
              ` = ${uploadBudget}px at its rendered width`);
  const CROP_BUDGET = { upload: uploadBudget, space: 48 };
  const cropped = [];
  for (const f of tr) for (const l of f.frame) {
    if (!READABLE(l) || l.ovl === null) continue;
    const budget = CROP_BUDGET[l.beat] || 0;
    const worst = Math.max(l.ovl, l.ovr);
    if (worst > budget) cropped.push({ beat: l.beat, px: Math.round(worst), budget });
  }
  if (!cropped.length) ok('no readable plate is cropped by the camera at any point');
  else {
    const byBeat = {};
    for (const c of cropped) byBeat[c.beat] = Math.max(byBeat[c.beat] || 0, c.px);
    bad('the camera crops a plate the viewer is meant to read',
        Object.entries(byBeat).map(([b, px]) => `${b} ${px}px`).join(', '));
  }

  console.log('\n── Centred overlays are actually centred ──');
  // The trap this catches has now been hit three times in product-film.js:
  // an element positioned with left:50% + translateX(-50%) is animated in with
  // keyframes that end on `transform:none`, which wipes the translate the
  // instant the animation lands. The element then anchors its LEFT edge to the
  // centre of the frame and hangs off to the right — the upload beat's "Reading
  // 3 documents" chip ran clean off the edge, progress bar and all, and both
  // green callouts sat half a pill right of where they were composed. Measured
  // from laid-out geometry, so it catches the next keyframe set that forgets.
  const offs = tr.flatMap(f => f.frame.filter(l => !l.out).flatMap(l => l.centred || []));
  const skewed = offs.filter(c => c.off > 12);
  const spilled = offs.filter(c => c.out > 0);
  (offs.length > 60)
    ? ok(`sampled ${offs.length} frames of centred overlays`)
    : bad('too few centred-overlay samples to judge', String(offs.length));
  (skewed.length === 0)
    ? ok('every centred overlay sits on the frame\'s centre line once it lands')
    : bad('a centred overlay is off-centre after its entry animation',
          `${skewed[0].cls} by ${Math.max(...skewed.map(c => c.off))}px`);
  (spilled.length === 0)
    ? ok('no overlay runs past the edge of the frame')
    : bad('an overlay runs off the frame',
          `${spilled[0].cls} by ${Math.max(...spilled.map(c => c.out))}px`);

  console.log('\n── The money beat never shows zero ──');
  // recover's markup shipped a literal "$0" and started counting 480ms later,
  // so the beat whose line is "the revenue you were entitled to recover" spent
  // its entire entrance dissolve reading zero — over the top of the previous
  // shot, which made $0 look like the answer to the previous beat's question.
  const zeroVisible = tr.flatMap(f => f.frame
    .filter(l => l.rec !== null && /^\$0$/.test((l.rec || '').trim()) && l.o > 0.05)
    .map(l => ({ t: f.t, o: l.o })));
  (zeroVisible.length === 0)
    ? ok('$0 is never on screen at a legible opacity — the number is already climbing')
    : bad('the recover beat displays $0 while visible',
          `${zeroVisible.length} frame(s), peak opacity ${Math.max(...zeroVisible.map(z => z.o)).toFixed(2)}`);

  console.log('\n── The query is never caught half-typed mid-transition ──');
  // The ask beat typed its question from frame one at 26cps, so the dissolve
  // out of `space` caught it at "Which ten" laid over the previous screen. An
  // empty search bar during the dissolve is a state software is actually in;
  // half a word appearing over another screen reads as a stutter.
  const halfTyped = tr.filter(f => f.frame.length >= 2).flatMap(f => f.frame
    .filter(l => l.askq !== null)
    .map(l => (l.askq || '').trim())
    .filter(q => q.length > 0 && q !== 'Which tenants have CAM caps?'));
  (halfTyped.length === 0)
    ? ok('the search bar is empty or fully typed whenever two layers are on screen')
    : bad('the query is mid-word during a dissolve', JSON.stringify(halfTyped.slice(0, 3)));

  console.log('\n── Console ──');
  (errs.length === 0) ? ok('no page errors') : bad('errors', JSON.stringify(errs.slice(0, 3)));

  console.log('\n' + (fail ? '\x1b[31m' : '\x1b[32m') + `RESULT: ${pass} passed, ${fail} failed\x1b[0m`);
  await b.close(); srv.close(); process.exit(fail ? 1 : 0);
})();
