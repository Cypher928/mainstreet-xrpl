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
        frame.push({ id: l.__id, beat: window.ProductFilm.beatId(),
                     k0: parseFloat(cam.style.getPropertyValue('--k0')),
                     s: m.a, b: bm, p: pm, plate: !!plate,
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
  const vels = layers.map(l => ({ id: l.id, v: slope(l.pts) })).filter(x => x.v !== null);
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
  // A transition is any run of frames carrying two layers at once.
  const runs = [];
  let cur = null;
  for (const f of tr) {
    if (f.frame.length >= 2) { cur ? (cur.b = f.t) : (cur = { a: f.t, b: f.t, n: 1 }); if (cur) cur.n++; }
    else if (cur) { runs.push(cur); cur = null; }
  }
  if (cur) runs.push(cur);
  (runs.length === 12)
    ? ok(`12 dissolves for 13 beats — every transition overlaps two shots`)
    : bad('wrong number of dissolves', `${runs.length} found, expected 12`);
  const durs = runs.map(r => r.b - r.a);
  const shortest = Math.min(...durs);
  // The brief asked for a longer overlap; 600ms is the floor below which it
  // stops reading as a glide and starts reading as a wipe.
  (shortest >= 600)
    ? ok(`shortest overlap ${shortest}ms, longest ${Math.max(...durs)}ms — all at least 600ms`)
    : bad('a transition is too short to read as continuous', `${shortest}ms`);

  console.log('\n── Both shots keep moving through the dissolve ──');
  let stalled = 0, held = 0, rose = 0;
  for (const r of runs) {
    const win = tr.filter(f => f.t >= r.a && f.t <= r.b && f.frame.length >= 2);
    const ids = [...new Set(win.flatMap(f => f.frame.map(l => l.id)))];
    for (const id of ids) {
      const pts = win.flatMap(f => f.frame.filter(l => l.id === id).map(l => [f.t, l.s]));
      const v = slope(pts);
      if (v === null || v <= 0) stalled++;
    }
    // The outgoing layer is held opaque on purpose: a semi-transparent incoming
    // layer over an opaque outgoing one composites to new*a + old*(1-a), a true
    // cross-dissolve, without the mid-transition luminance dip that fading both
    // would produce.
    const outOps = win.flatMap(f => f.frame.filter(l => l.out).map(l => l.o));
    if (outOps.length && Math.min(...outOps) > 0.9) held++;
    const inOps = win.flatMap(f => f.frame.filter(l => !l.out).map(l => l.o));
    if (inOps.length && inOps[0] < 0.5 && inOps[inOps.length-1] > 0.9) rose++;
  }
  (stalled === 0)
    ? ok('no shot is stationary during a dissolve — both layers are still travelling')
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

  console.log('\n── Console ──');
  (errs.length === 0) ? ok('no page errors') : bad('errors', JSON.stringify(errs.slice(0, 3)));

  console.log('\n' + (fail ? '\x1b[31m' : '\x1b[32m') + `RESULT: ${pass} passed, ${fail} failed\x1b[0m`);
  await b.close(); srv.close(); process.exit(fail ? 1 : 0);
})();
