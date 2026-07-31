'use strict';
/**
 * Landing page depth contract.
 *
 * The brief was "it should not feel darker, it should feel deeper", and the
 * measurement that started this was blunt: six of the seven sections rendered
 * at luminance 0. Every surface WAS the page. Nothing was layered, so nothing
 * could read as layered however carefully it was coloured.
 *
 * These checks pin the structure that fixed it — an elevation ladder, chapter
 * panels, framed screenshots, varied rhythm, restrained gold, a legible type
 * scale, and a phone layout that does not overflow.
 *
 * The overflow check is the one to keep. `1fr` is minmax(auto,1fr) and `auto`
 * floors at min-content, which for an image is its INTRINSIC width — so a
 * screenshot in a grid silently forced the page 71px wider than the phone, and
 * body{overflow-x:hidden} hid the scrollbar that would have shown it. It
 * surfaced only as "everything is slightly too big", which is exactly the kind
 * of fault that survives a visual review.
 */
let pw; try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = __dirname, PORT = 8861;
const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css',
               '.json':'application/json', '.png':'image/png', '.svg':'image/svg+xml',
               '.jpg':'image/jpeg', '.mp3':'audio/mpeg', '.webm':'audio/webm' };
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

const settle = async p => p.evaluate(async () => {
  const H = document.body.scrollHeight;
  for (let y = 0; y < H; y += 500) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 40)); }
  window.scrollTo(0, 0); await new Promise(r => setTimeout(r, 300));
});

(async () => {
  await new Promise(r => srv.listen(PORT, '127.0.0.1', r));
  const b = await pw.chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const errs = [];

  // ── desktop ────────────────────────────────────────────────────────────────
  const desk = await (await b.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
  desk.on('pageerror', e => errs.push(e.message));
  await desk.route('**fonts.g**', r => r.continue());
  await desk.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
  await settle(desk);

  const d = await desk.evaluate(() => {
    const lum = c => { const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/.exec(c || '');
      if (!m) return null; if (m[4] !== undefined && +m[4] < 0.5) return null;
      return 0.2126*+m[1] + 0.7152*+m[2] + 0.0722*+m[3]; };
    const L = el => lum(getComputedStyle(el).backgroundColor);
    const panels = [...document.querySelectorAll('.panel')];
    const cards  = [...document.querySelectorAll('.card,.step')];
    const shots  = [...document.querySelectorAll('.shot')];
    const golds  = [...document.querySelectorAll('*')].filter(e => {
      const cs = getComputedStyle(e);
      return /216,\s*184,\s*114|#d8b872/i.test(cs.color) ||
             /216,\s*184,\s*114/.test(cs.backgroundImage);
    }).length;
    const px = s => parseFloat(getComputedStyle(document.querySelector(s)).fontSize);
    const secPads = [...document.querySelectorAll('section')]
      .map(s => Math.round(parseFloat(getComputedStyle(s).paddingTop)));
    return {
      pageL: L(document.body),
      panelL: panels.length ? L(panels[0]) : null,
      cardL:  cards.length  ? L(cards[0])  : null,
      panelCount: panels.length,
      panelHasBorder: panels.length ? getComputedStyle(panels[0]).borderTopWidth !== '0px' : false,
      panelHasShadow: panels.length ? getComputedStyle(panels[0]).boxShadow !== 'none' : false,
      cardHasShadow: cards.length ? getComputedStyle(cards[0]).boxShadow !== 'none' : false,
      shotCount: shots.length,
      shotShadow: shots.length ? getComputedStyle(shots[0]).boxShadow : '',
      shotWrapped: document.querySelectorAll('.shot-wrap .shot').length,
      // widest element inside each section that contains a screenshot
      shotShare: shots.map(sh => {
        const sec = sh.closest('section,header');
        if (!sec) return 0;
        return +(sh.getBoundingClientRect().width / sec.getBoundingClientRect().width).toFixed(3);
      }),
      goldCount: golds,
      secPads: [...new Set(secPads)],
      type: { h1: px('h1'), h2: px('h2'), h3: px('h3'), lede: px('.lede'),
              body: px('.card p'), eyebrow: px('.eyebrow') },
    };
  });

  console.log('\n── The page is layered, not flat ──');
  console.log(`   page ${d.pageL.toFixed(1)}  →  panel ${d.panelL === null ? '--' : d.panelL.toFixed(1)}  →  card ${d.cardL === null ? '--' : d.cardL.toFixed(1)}  (luminance)`);
  (d.panelL !== null && d.cardL !== null && d.panelL > d.pageL + 3 && d.cardL > d.panelL + 3)
    ? ok(`three distinct surface levels, each at least 3 luminance apart`)
    : bad('the surfaces do not separate', JSON.stringify({ page: d.pageL, panel: d.panelL, card: d.cardL }));
  (d.panelCount >= 3) ? ok(`${d.panelCount} chapter panels — the page reads as sections, not one surface`)
                      : bad('too few panels', String(d.panelCount));
  (d.panelHasBorder && d.panelHasShadow)
    ? ok('panels carry a hairline edge and a shadow, so depth comes from light as well as tone')
    : bad('panels have no edge or no shadow');
  d.cardHasShadow ? ok('cards sit above their panel rather than being drawn on it')
                  : bad('cards have no elevation');

  console.log('\n── The screenshots are the heroes ──');
  (d.shotWrapped === d.shotCount && d.shotCount >= 3)
    ? ok(`all ${d.shotCount} screenshots are framed and sit in their own pool of light`)
    : bad('a screenshot is unframed', `${d.shotWrapped} of ${d.shotCount} wrapped`);
  /rgba?\(/.test(d.shotShadow) && d.shotShadow.split('rgba').length >= 3
    ? ok('the frame carries a layered shadow, not a single flat one')
    : bad('the screenshot frame is flat', d.shotShadow.slice(0, 60));
  // Prominence by proportion of its section, not by absolute size.
  (Math.max(...d.shotShare) >= 0.3)
    ? ok(`the largest screenshot occupies ${(Math.max(...d.shotShare)*100).toFixed(0)}% of its section's width`)
    : bad('screenshots are not prominent', JSON.stringify(d.shotShare));

  console.log('\n── Sections have their own rhythm ──');
  (d.secPads.length >= 2)
    ? ok(`section padding varies (${d.secPads.sort((a,b)=>a-b).join('px, ')}px) — chapters, not one continuous scroll`)
    : bad('every section has identical padding', `all ${d.secPads[0]}px`);

  console.log('\n── Gold points at things; it does not decorate ──');
  // A ceiling, not a target. The brief was "keep it restrained" and the failure
  // mode is gold creeping onto every icon, rule and border.
  (d.goldCount <= 40)
    ? ok(`${d.goldCount} elements carry the champagne accent — restrained`)
    : bad('gold is everywhere', `${d.goldCount} elements`);

  console.log('\n── The type scale ranks itself ──');
  const t = d.type;
  console.log(`   h1 ${t.h1}  h2 ${t.h2}  lede ${t.lede}  h3 ${t.h3}  body ${t.body}  eyebrow ${t.eyebrow}`);
  (t.h1 > t.h2 && t.h2 > t.lede && t.lede > t.h3 && t.h3 > t.body && t.body > t.eyebrow)
    ? ok('six levels, strictly descending — the ranking is legible before the words are')
    : bad('the type hierarchy is not monotonic', JSON.stringify(t));
  (t.h1 / t.body >= 2.5)
    ? ok(`the headline is ${(t.h1/t.body).toFixed(1)}x body text`)
    : bad('not enough contrast between headline and body', `${(t.h1/t.body).toFixed(1)}x`);

  // ── phones ─────────────────────────────────────────────────────────────────
  console.log('\n── On a phone ──');
  for (const vp of [{ width: 390, height: 844 }, { width: 360, height: 780 }]) {
    const ctx = await b.newContext({ viewport: vp, isMobile: true, hasTouch: true });
    const p = await ctx.newPage();
    p.on('pageerror', e => errs.push(e.message));
    await p.route('**fonts.g**', r => r.continue());
    await p.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
    await settle(p);
    const m = await p.evaluate(() => {
      const V = document.documentElement.clientWidth;
      const over = [...document.querySelectorAll('*')].filter(e => {
        const b = e.getBoundingClientRect();
        return b.width > 0 && (b.right > V + 1 || b.left < -1);
      }).map(e => e.tagName + '.' + (e.className || '').toString().split(' ')[0]);
      const taps = [...document.querySelectorAll('a,button')]
        .map(e => ({ t: (e.innerText || '').trim().slice(0, 24), h: Math.round(e.getBoundingClientRect().height),
                     w: Math.round(e.getBoundingClientRect().width) }))
        .filter(x => x.w > 0);
      const fonts = [...document.querySelectorAll('p,h1,h2,h3,.lede,.eyebrow')]
        .map(e => parseFloat(getComputedStyle(e).fontSize));
      return { V, innerWidth, scrollWidth: document.documentElement.scrollWidth,
               over: [...new Set(over)], small: taps.filter(x => x.h < 44), taps: taps.length,
               minFont: Math.min(...fonts),
               shots: [...document.querySelectorAll('.shot img')]
                 .map(e => Math.round(e.getBoundingClientRect().width)) };
    });
    const tag = `${vp.width}px`;
    // innerWidth inflates to cover the overflow, so comparing against it can
    // never detect the overflow. clientWidth is the real layout viewport.
    (m.scrollWidth <= m.V + 1 && m.innerWidth === m.V)
      ? ok(`${tag}: nothing overflows — scrollWidth ${m.scrollWidth} against a ${m.V}px viewport`)
      : bad(`${tag}: the page is wider than the phone`,
            `scrollWidth ${m.scrollWidth}, innerWidth ${m.innerWidth}, viewport ${m.V}: ${m.over.slice(0,4).join(', ')}`);
    (m.small.length === 0)
      ? ok(`${tag}: all ${m.taps} tap targets are at least 44px tall`)
      : bad(`${tag}: ${m.small.length} tap targets are too small`,
            m.small.map(x => `"${x.t}" ${x.w}x${x.h}`).join(', '));
    (m.minFont >= 10.5)
      ? ok(`${tag}: smallest text is ${m.minFont}px`)
      : bad(`${tag}: text is too small`, `${m.minFont}px`);
    // The screenshots break out of the panel inset on a phone, so they should be
    // within a hair of the full viewport width.
    (Math.max(...m.shots) >= vp.width - 40)
      ? ok(`${tag}: screenshots run to ${Math.max(...m.shots)}px, near the full width of the screen`)
      : bad(`${tag}: screenshots are cramped`, `widest ${Math.max(...m.shots)}px of ${vp.width}px`);
    await ctx.close();
  }

  console.log('\n── Console ──');
  (errs.length === 0) ? ok('no page errors') : bad('errors', JSON.stringify(errs.slice(0, 3)));

  console.log('\n' + (fail ? '\x1b[31m' : '\x1b[32m') + `RESULT: ${pass} passed, ${fail} failed\x1b[0m`);
  await b.close(); srv.close(); process.exit(fail ? 1 : 0);
})();
