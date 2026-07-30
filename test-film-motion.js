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
        frame.push({ id: l.__id, beat: window.ProductFilm.beatId(),
                     k0: parseFloat(cam.style.getPropertyValue('--k0')),
                     s: m.a, o: parseFloat(getComputedStyle(l).opacity),
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
  const CHAINED = ['promise', 'upload'];
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
