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
  console.log('\n── Every Request a Pilot goes to the same place, and stays here ──');
  // The three buttons were mailto: links. A mailto: hands off to whichever
  // application owns the mail protocol, which is why one of them opened an
  // unrelated browser. Nothing may leave the page.
  const cta = await desk.evaluate(() => {
    const btns = [...document.querySelectorAll('a,button')]
      .filter(e => /request a pilot/i.test((e.innerText || '').trim()));
    return btns.map(e => ({
      text: (e.innerText || '').trim().split('\n')[0],
      href: e.getAttribute('href'), target: e.getAttribute('target'),
      pilot: e.hasAttribute('data-pilot'),
    }));
  });
  console.log('   ' + cta.map(c => `${c.href}${c.target ? ' target=' + c.target : ''}`).join('  |  '));
  (cta.length >= 3) ? ok(`${cta.length} Request a Pilot buttons found`)
                    : bad('missing CTAs', String(cta.length));
  cta.every(c => c.pilot) ? ok('every one opens the in-page pilot modal')
                          : bad('a CTA does not open the modal', JSON.stringify(cta));
  cta.every(c => !/^mailto:/i.test(c.href || '')) ? ok('none is a mailto: — nothing hands off to another application')
                                                  : bad('a CTA is still a mailto:', JSON.stringify(cta));
  cta.every(c => !c.target) ? ok('none opens a new tab') : bad('a CTA has a target', JSON.stringify(cta));
  (new Set(cta.map(c => c.href)).size === 1)
    ? ok(`all ${cta.length} share one destination (${cta[0].href})`)
    : bad('the CTAs disagree', JSON.stringify([...new Set(cta.map(c => c.href))]));
  const noMailto = !/href="mailto:/i.test(fs.readFileSync(path.join(ROOT, 'home.html'), 'utf8'));
  noMailto ? ok('no mailto: href anywhere in the page') : bad('a mailto: href survives in home.html');

  console.log('\n── The modal opens, traps focus and closes ──');
  const modal = await desk.evaluate(async () => {
    const out = {};
    const before = document.querySelectorAll('.pm.on').length;
    document.querySelector('[data-pilot]').click();
    await new Promise(r => setTimeout(r, 120));
    const m = document.getElementById('pilotModal');
    out.opensOnClick = !!m && m.classList.contains('on') && !m.hidden;
    out.scrollLocked = getComputedStyle(document.body).overflow === 'hidden';
    out.fields = [...m.querySelectorAll('input,select')].map(e => e.name);
    out.hasSubmit = !!m.querySelector('button[type=submit]');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await new Promise(r => setTimeout(r, 120));
    out.closesOnEscape = !m.classList.contains('on') && m.hidden;
    out.scrollRestored = getComputedStyle(document.body).overflow !== 'hidden';
    out.before = before;
    return out;
  });
  modal.opensOnClick ? ok('clicking a CTA opens the modal in place') : bad('the modal did not open');
  modal.closesOnEscape ? ok('Escape closes it') : bad('Escape does not close the modal');
  (modal.scrollLocked && modal.scrollRestored)
    ? ok('the page behind is locked while it is open and released after')
    : bad('scroll lock is wrong', JSON.stringify(modal));
  // The fields the brief asked for.
  const want = ['name', 'company', 'email', 'properties', 'lease'];
  want.every(f => modal.fields.includes(f))
    ? ok(`collects ${want.join(', ')}`)
    : bad('a field is missing', JSON.stringify(modal.fields));
  modal.hasSubmit ? ok('and has a submit button') : bad('no submit button');

  console.log('\n── The form actually submits ──');
  // The endpoint is verified separately; this is the CLIENT half — payload
  // shape, success and failure rendering, and the file path. It is the half
  // that already hid one bug (form.name is the FORM's name attribute and
  // shadows the named input, so form.name.value threw on submit).
  {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
    const p = await ctx.newPage();
    p.on('pageerror', e => errs.push(e.message));
    await p.route('**fonts.g**', r => r.continue());
    let seen = null, mode = 'ok';
    await p.route('**/api/pilot-request', route => {
      try { seen = JSON.parse(route.request().postData() || '{}'); } catch (e) { seen = null; }
      if (mode === 'ok') return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
      return route.fulfill({ status: 503, contentType: 'application/json',
        body: '{"error":"The pilot_requests table has not been created yet"}' });
    });
    await p.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });

    const fill = async () => {
      await p.click('[data-pilot]');
      await p.fill('#pmName', 'Dana Reyes');
      await p.fill('#pmCompany', 'Reyes Property Group');
      await p.fill('#pmEmail', 'dana@reyespg.com');
      await p.selectOption('#pmProps', { index: 2 });
    };

    // 1 — client-side validation must fire before any request goes out
    await p.click('[data-pilot]');
    await p.click('#pmSubmit');
    await p.waitForTimeout(150);
    const emptyMsg = await p.evaluate(() => document.getElementById('pmMsg').innerText);
    (seen === null && /fill in every field/i.test(emptyMsg))
      ? ok('an empty form is rejected in the browser, without hitting the endpoint')
      : bad('empty form was not caught client-side', JSON.stringify({ seen, emptyMsg }));

    await p.fill('#pmName', 'Dana');
    await p.fill('#pmCompany', 'Reyes');
    await p.fill('#pmEmail', 'not-an-email');
    await p.selectOption('#pmProps', { index: 1 });
    await p.click('#pmSubmit');
    await p.waitForTimeout(150);
    const badEmail = await p.evaluate(() => document.getElementById('pmMsg').innerText);
    (seen === null && /email/i.test(badEmail))
      ? ok('a malformed email is caught before the request')
      : bad('bad email reached the endpoint', JSON.stringify({ seen, badEmail }));

    // 2 — the happy path
    await p.reload({ waitUntil: 'networkidle' });
    await fill();
    await p.click('#pmSubmit');
    await p.waitForTimeout(400);
    const after = await p.evaluate(() => ({
      msg: document.getElementById('pmMsg').innerText,
      formHidden: getComputedStyle(document.getElementById('pmForm')).display === 'none',
    }));
    (seen && seen.name === 'Dana Reyes' && seen.company === 'Reyes Property Group'
        && seen.email === 'dana@reyespg.com' && seen.properties)
      ? ok(`the payload carries every field (${Object.keys(seen).join(', ')})`)
      : bad('payload is wrong', JSON.stringify(seen));
    (/thank you/i.test(after.msg) && after.formHidden)
      ? ok('a successful submit confirms and retires the form')
      : bad('success state did not render', JSON.stringify(after));

    // 3 — a real failure must say so, and must not offer a mailto:
    mode = 'fail'; seen = null;
    await p.reload({ waitUntil: 'networkidle' });
    await fill();
    await p.click('#pmSubmit');
    await p.waitForTimeout(400);
    const failed = await p.evaluate(() => ({
      msg: document.getElementById('pmMsg').innerText,
      html: document.getElementById('pmMsg').innerHTML,
      canRetry: !document.getElementById('pmSubmit').disabled,
    }));
    (/table has not been created/i.test(failed.msg) && /lynnie928@me\.com/.test(failed.msg))
      ? ok('a failure states the reason and shows the address as text')
      : bad('failure state is wrong', JSON.stringify(failed.msg));
    !/mailto:/i.test(failed.html)
      ? ok('and it is NOT a mailto: link — nothing hands off to another application')
      : bad('the failure path offers a mailto:');
    failed.canRetry ? ok('the button re-enables so the visitor can try again')
                    : bad('the form is stuck after a failure');

    // 4 — an attached lease is base64'd into the payload
    mode = 'ok'; seen = null;
    await p.reload({ waitUntil: 'networkidle' });
    await fill();
    await p.setInputFiles('#pmFile', { name: 'sample-lease.pdf', mimeType: 'application/pdf',
                                       buffer: Buffer.from('%PDF-1.4 pretend lease') });
    await p.click('#pmSubmit');
    await p.waitForTimeout(600);
    (seen && seen.lease && seen.lease.name === 'sample-lease.pdf' && seen.lease.data
       && Buffer.from(seen.lease.data, 'base64').toString().startsWith('%PDF'))
      ? ok('an attached lease arrives base64-encoded and decodes back to the file')
      : bad('the file did not make it into the payload', JSON.stringify(seen && seen.lease));
    await ctx.close();
  }

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

  console.log('\n── On a large monitor ──');
  for (const [w, h, label] of [[1920, 1080, '1080p'], [2560, 1440, '1440p']]) {
    const ctx = await b.newContext({ viewport: { width: w, height: h } });
    const p = await ctx.newPage();
    p.on('pageerror', e => errs.push(e.message));
    await p.route('**fonts.g**', r => r.continue());
    await p.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
    const m = await p.evaluate(() => {
      const wrap = document.querySelector('.wrap').getBoundingClientRect();
      const panel = document.querySelector('.panel');
      const pr = panel ? panel.getBoundingClientRect() : null;
      return { share: +(wrap.width / innerWidth * 100).toFixed(1),
               // does the first chapter's top edge show without scrolling?
               panelPeeks: pr ? pr.top < innerHeight - 20 : false,
               panelTop: pr ? Math.round(pr.top) : null, vh: innerHeight,
               heroOverflows: document.querySelector('.hero').getBoundingClientRect().bottom > innerHeight,
               cue: !!document.querySelector('.scroll-cue'),
               trustBottomBorder: getComputedStyle(document.querySelector('.trust')).borderBottomWidth };
    });
    // A fixed 1140px container was 44% of a 1440p screen. 55% is the floor at
    // which the page stops reading as a column on a billboard.
    (m.share >= 55) ? ok(`${label}: content uses ${m.share}% of the width`)
                    : bad(`${label}: content is too narrow`, `${m.share}%`);
    // Either the next chapter's edge shows, OR the hero itself already runs past
    // the fold — both mean content visibly continues. Requiring the panel
    // specifically failed at 1080p, where the hero alone is taller than the
    // screen and there is no dead band to fix.
    (m.panelPeeks || m.heroOverflows)
      ? ok(`${label}: ` + (m.panelPeeks
            ? `the first chapter's top edge is visible at ${m.panelTop}px against a ${m.vh}px fold`
            : `the hero itself continues past the fold`))
      : bad(`${label}: the fold looks like the end of the page`, `panel top ${m.panelTop}, fold ${m.vh}`);
    (m.trustBottomBorder === '0px')
      ? ok(`${label}: the trust strip has no bottom rule — no false ending`)
      : bad(`${label}: a full-width rule still terminates the fold`, m.trustBottomBorder);
    m.cue ? ok(`${label}: a scroll affordance is present`) : bad('no scroll cue');
    await ctx.close();
  }

  console.log('\n── Console ──');
  (errs.length === 0) ? ok('no page errors') : bad('errors', JSON.stringify(errs.slice(0, 3)));

  console.log('\n' + (fail ? '\x1b[31m' : '\x1b[32m') + `RESULT: ${pass} passed, ${fail} failed\x1b[0m`);
  await b.close(); srv.close(); process.exit(fail ? 1 : 0);
})();
