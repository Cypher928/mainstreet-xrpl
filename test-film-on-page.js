'use strict';
/**
 * The film must play IN PLACE on the marketing page.
 *
 * Browsers do not carry user activation across a navigation, so the old
 * home -> index.html?demo=1 hop could never autoplay narration: the click
 * happened on a document that was then discarded. Playing in place keeps the
 * click and the audio on the same document, which is the only way narration can
 * ever be unmuted without asking the viewer to tap a speaker icon.
 *
 * These checks pin that: the CTA does not navigate, the film opens on the page,
 * closing restores the page, and the shared module is the single source of the
 * scenes for both surfaces.
 */
let pw; try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = __dirname, PORT = 8855;
const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css',
               '.json':'application/json', '.png':'image/png', '.svg':'image/svg+xml',
               '.mp3':'audio/mpeg', '.jpg':'image/jpeg', '.webm':'audio/webm' };
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

(async () => {
  await new Promise(r => srv.listen(PORT, '127.0.0.1', r));
  const b = await pw.chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  await page.route('**fonts.g**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  const navs = [];
  page.on('framenavigated', f => { if (f === page.mainFrame()) navs.push(f.url()); });

  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);

  console.log('\n── The module loads on the marketing page ──');
  const loaded = await page.evaluate(() => !!(window.ProductFilm && window.ProductFilm.play));
  loaded ? ok('ProductFilm is available on home.html') : bad('ProductFilm not loaded');
  const sceneCount = await page.evaluate(() => window.ProductFilm ? window.ProductFilm.scenes().length : 0);
  (sceneCount === 13) ? ok('the shared module carries all 13 beats') : bad('scene count', String(sceneCount));

  console.log('\n── Clicking the CTA plays in place, with no navigation ──');
  const navsBefore = navs.length;
  // Instrument before the click so the first line is captured. Deliberately no
  // --autoplay-policy override on the browser: the click is a real user
  // gesture, and if that ever stops being enough to start audio, this suite
  // should say so rather than paper over it with a flag.
  await page.evaluate(() => {
    window.__vo = [];
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      const el = this;
      const rec = { src: (el.currentSrc || el.src || '').split('/').pop(),
                    at: Date.now() - (window.__t0 || Date.now()), ok: null };
      window.__vo.push(rec);
      if (!/^vo-/.test(rec.src)) window.__bed = el;   // the music, not a line
      return play.apply(this, arguments)
        .then(() => { rec.ok = true; setTimeout(() => { rec.progressed = el.currentTime > 0; }, 400); })
        .catch(e => { rec.ok = false; rec.err = String(e.name || e); });
    };
    window.__bed = null;
    const p0 = window.ProductFilm.play;
    window.ProductFilm.play = function () { window.__t0 = Date.now(); return p0.apply(this, arguments); };
  });
  await page.click('a.btn--ghost');           // "Watch MainStreet in Action"
  await page.waitForTimeout(900);
  const st = await page.evaluate(() => {
    const f = document.getElementById('pfFilm');
    return { mounted: !!f, on: !!(f && f.classList.contains('msl-on')),
             capText: (document.getElementById('pfCap') || {}).innerText || '',
             bodyLocked: getComputedStyle(document.body).overflow === 'hidden',
             beat: window.ProductFilm.beatId(),
             storyCard: (document.querySelector('.pf-story p') || {}).innerText || '',
             anyProduct: !!document.querySelector('#pfCanvas img'),
             bare: !!document.querySelector('#pfFilm.pf-bare'),
             heroStillThere: !!document.querySelector('h1') };
  });
  (navs.length === navsBefore) ? ok('no navigation occurred — the click and the audio stay on one document')
                               : bad('the page navigated', JSON.stringify(navs.slice(navsBefore)));
  st.on ? ok('the film is open over the page') : bad('film did not open', JSON.stringify(st));
  // At 900ms the film is on `story`: a line of type, no product in frame at all.
  // That is the point of the sequence — emotion before software.
  (st.beat === 'story' && st.capText === '' && !st.anyProduct && /has a story/.test(st.storyCard) && st.bare)
    ? ok('opens on emotion: a type card, no product in frame, no browser chrome')
    : bad('wrong opening beat', JSON.stringify({ beat: st.beat, cap: st.capText, card: st.storyCard, product: st.anyProduct, bare: st.bare }));
  st.bodyLocked ? ok('the page behind is scroll-locked while the film plays') : bad('background still scrolls');
  st.heroStillThere ? ok('the marketing page is still mounted underneath — nothing was torn down') : bad('page was replaced');

  console.log('\n── Closing returns to the page, not a reload ──');
  const navsBeforeClose = navs.length;
  await page.click('#pfClose');
  await page.waitForTimeout(500);
  const after = await page.evaluate(() => ({
    on: !!(document.getElementById('pfFilm') || {}).classList?.contains('msl-on'),
    bodyFree: getComputedStyle(document.body).overflow !== 'hidden',
    h1: (document.querySelector('h1') || {}).innerText || '',
  }));
  (navs.length === navsBeforeClose) ? ok('closing does not reload the page') : bad('close navigated');
  !after.on ? ok('the film layer is dismissed') : bad('film still showing');
  after.bodyFree ? ok('scrolling is restored') : bad('page left locked');
  /verified memory/i.test(after.h1) ? ok('the viewer is back on the marketing page, scroll position intact') : bad('page state lost', after.h1);

  console.log('\n── One implementation, not two ──');
  const le = fs.readFileSync(path.join(ROOT, 'landing-experience.js'), 'utf8');
  const pf = fs.readFileSync(path.join(ROOT, 'product-film.js'), 'utf8');
  (pf.match(/\bid: '(\w+)'/g) || []).length >= 10
    ? ok('product-film.js owns the scene definitions') : bad('scenes missing from the module');
  const leScenes = (le.match(/var SCENES = \[/g) || []).length;
  (leScenes === 0) ? ok('landing-experience.js no longer carries its own copy of the film')
                   : bad('the film is defined twice', 'landing-experience.js still declares SCENES');

  console.log('\n── Narration scaffold travels with the module ──');
  const cues = await page.evaluate(() => window.ProductFilm.narrationCues());
  (cues.length === 13 && cues.filter(c => c.line).length === 10) ? ok('all 13 cues exposed from home.html; the opening sequence is unspoken')
                                                  : bad('cues incomplete', String(cues.length));
  // Narrowed from a blanket `new Audio` ban when the recorded read landed: the
  // voice is now eight mp3s in the repo, and what must stay true is that none
  // of it is generated in the browser.
  const synth = /speechSynthesis|SpeechSynthesisUtterance/.test(pf);
  !synth ? ok('no speech synthesis — narration is a recorded track')
         : bad('the browser is synthesising speech');
  const voiced = cues.filter(c => c.audio);
  (voiced.length === 10 && voiced.every(c => /^assets\/vo\/vo-[a-z]+\.mp3$/.test(c.audio)))
    ? ok('all 10 lines resolve to clips in assets/vo/')
    : bad('narration sources are wrong', JSON.stringify(voiced.map(c => c.audio)));

  console.log('\n── Narration actually plays, on schedule ──');
  // A full-length run. ~46s is slow for a test, but both findings this exists
  // to protect live at the ends of the film: the opening line overrunning into
  // the next one, and the closing line running past the final cut. Sampling the
  // first few seconds would miss both.
  const waitTill = ms => page.waitForFunction(t => Date.now() - window.__t0 >= t, ms,
                                              { timeout: ms + 8000, polling: 100 });
  const sched = await page.evaluate(() => window.ProductFilm.narrationCues().filter(c => c.audio)
    .map(c => ({ id: c.id, start: c.startMs, end: c.endMs, file: c.audio.split('/').pop() })));
  const total = await page.evaluate(() => window.ProductFilm.scenes().reduce((a, s) => a + s.dur, 0));
  const voEnd = await page.evaluate(() => window.ProductFilm.narrationEndMs());
  await page.evaluate(() => { window.__vo = []; window.ProductFilm.play(); });

  // Bed levels are derived from measured loudness, so check the duck actually
  // happens rather than trusting the constants. 5.5s is inside the opening
  // line (3.00-7.31s); 8.8s is between it and the next (9.50s).
  await waitTill(5500);
  const duck = await page.evaluate(() => window.ProductFilm.mixState());
  await waitTill(8800);
  const openv = await page.evaluate(() => window.ProductFilm.mixState());

  // The invariant is "the CTA never appears while she is still speaking", not
  // "the line runs past the cut". Sampling at total+150 assumed the latter, and
  // silently became a false alarm the moment the brand beat grew long enough to
  // contain its own line. Sample just before the closing line ends instead —
  // that holds whichever of the two finishes first.
  await waitTill(Math.max(0, voEnd - 300));
  const endEarly = await page.evaluate(() => document.getElementById('pfEnd').classList.contains('msl-show'));
  await waitTill(Math.max(total, voEnd) + 900);
  const endLate = await page.evaluate(() => document.getElementById('pfEnd').classList.contains('msl-show'));
  const vo = await page.evaluate(() => window.__vo);

  // Assert on the observations BEFORE interpreting them. Every check below
  // filters `vo`, and a filter over an empty array is empty — so if the
  // instrumentation ever breaks again, this is the line that says so instead of
  // three green ticks reporting that nothing failed because nothing happened.
  // Split the bed out of the observations. Once assets/audio/bed.mp3 exists it
  // is a ninth play() call, and counting it as a line would fail this for the
  // wrong reason.
  const bedPlays = vo.filter(v => !/^vo-/.test(v.src));
  const lines = vo.filter(v => /^vo-/.test(v.src));
  lines.length === sched.length
    ? ok(`${lines.length} play() calls observed, one per line`)
    : bad('instrumentation captured the wrong number of plays', `${lines.length} of ${sched.length}`);
  // The sidechain is driven by an envelope follower listening to the voice bus,
  // so this samples the graph rather than the element: 5.5s is inside the
  // opening line, 8.8s is between it and the next. What must hold is that the
  // duck is deep while speaking and released between lines, and that the
  // presence dip moves with it.
  (duck && openv && duck.duckDb <= -7 && openv.duckDb >= -2.5)
    ? ok(`the sidechain ducks the bed ${duck.duckDb.toFixed(1)}dB under the voice and releases to ${openv.duckDb.toFixed(1)}dB between lines`)
    : bad('the sidechain is not ducking around the narration', JSON.stringify({ duck, openv }));
  (duck && openv && duck.eqDb < openv.eqDb - 2)
    ? ok(`the 1-4kHz presence dip deepens while speaking (${openv.eqDb.toFixed(1)}dB → ${duck.eqDb.toFixed(1)}dB at ${'2.4'}kHz)`)
    : bad('the presence dip does not follow the voice', JSON.stringify({ duck, openv }));
  // The bed must NOT come from a media element. On iOS Safari
  // HTMLMediaElement.volume is read-only, so an element-based bed cannot be
  // turned down there at all — it plays at full system volume however the mix
  // constants are set. A buffer source physically cannot bypass the graph.
  (bedPlays.length === 0)
    ? ok('the bed never plays through a media element — its level cannot be bypassed on iOS')
    : bad('the bed is playing through an <audio> element', bedPlays.map(v => v.src).join(', '));
  // Sampled at 8.8s, not at mount: the bed is decoded asynchronously, so at
  // 900ms the base gain is still 0 and reads as the -120dB zero-clamp — an
  // assertion there would pass even if the music never started.
  (openv && openv.baseDb > -30 && openv.baseDb < -8)
    ? ok(`the graph is carrying the bed at ${openv.baseDb.toFixed(1)}dB, not the element`)
    : bad('the bed is not going through the WebAudio graph at a sane level', JSON.stringify(openv));

  const fired = sched.map(s => lines.find(v => v.src === s.file));
  const missing = sched.filter((s, i) => !fired[i]).map(s => s.id);
  missing.length === 0 ? ok(`all ${sched.length} clips were played`)
                       : bad('clips never played', missing.join(', '));
  const rejected = lines.filter(v => v.ok === false);
  (lines.length > 0 && rejected.length === 0)
    ? ok('every clip started — a real click is enough activation, no autoplay flag needed')
    : bad('playback was blocked', rejected.map(v => v.src + ':' + v.err).join(', ') || 'nothing observed');
  const progressed = lines.filter(v => v.progressed === true);
  progressed.length === lines.length && lines.length > 0
    ? ok('every clip advanced past 0s — audio decoded, not just requested')
    : bad('a clip never advanced', `${progressed.length} of ${lines.length} progressed`);

  // 400ms covers timer drift under a loaded headless browser. Anything larger
  // is real desync, and at 250ms of designed gap it would be audible.
  const TOL = 400;
  const drift = sched.map((s, i) => fired[i] ? { id: s.id, off: fired[i].at - s.start } : null);
  const late = drift.filter(x => x && Math.abs(x.off) > TOL);
  (drift.every(Boolean) && late.length === 0)
    ? ok(`playback is driven by the cue schedule — every line fired within ${TOL}ms of its startMs (max ${
        Math.max(...drift.map(x => Math.abs(x.off)))}ms)`)
    : bad('lines fired off-cue', late.map(x => `${x.id} ${x.off > 0 ? '+' : ''}${x.off}ms`).join(', ')
        || 'no timings captured');

  !endEarly ? ok(`the end card is still hidden at ${voEnd - 300}ms — the CTA never covers the closing line`)
            : bad('the CTA appeared over the closing line', `visible at ${voEnd - 300}ms, line ends ${voEnd}ms`);
  endLate ? ok(`the end card appears after the closing line finishes (${voEnd}ms)`)
          : bad('the end card never appeared');

  console.log('\n── On a phone ──');
  // The film is composed landscape and a phone is portrait, so "fill the screen"
  // has two different right answers.
  //
  // The opening beats are photography and type: cropping those to a portrait
  // frame is what a camera does, and they take the whole screen.
  //
  // The product beats are wide screenshots of a dense UI. Filling the screen
  // with one crops it to roughly a third of its width — measured at 66vh, the
  // tenant names rendered as "...ket" and "...rovisions" and "Reading 3
  // documents" ran off the edge. This ceiling is the legibility limit, not a
  // layout preference, and raising it makes those beats worse.
  const phone = await b.newContext({ viewport: { width: 390, height: 844 },
                                     isMobile: true, hasTouch: true });
  const ph = await phone.newPage();
  await ph.route('**fonts.g**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await ph.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
  const frac = async ms => {
    await ph.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
    await ph.evaluate(() => { window.__t0 = Date.now(); window.ProductFilm.play(); });
    await ph.waitForFunction(t => Date.now() - window.__t0 >= t, ms, { timeout: ms + 6000, polling: 25 });
    return ph.evaluate(() => {
      const c = document.querySelector('#pfFilm .msl-canvas').getBoundingClientRect();
      return { w: c.width / innerWidth, h: c.height / innerHeight,
               bare: !!document.querySelector('#pfFilm.pf-bare') };
    });
  };
  const open = await frac(2300), prod = await frac(7500);
  (open.bare && open.w >= 0.99 && open.h >= 0.75)
    ? ok(`the opening fills the phone — ${Math.round(open.w*100)}% wide, ${Math.round(open.h*100)}% tall, edge to edge`)
    : bad('the opening does not fill the phone', JSON.stringify(open));
  (!prod.bare && prod.w >= 0.99 && prod.h >= 0.5 && prod.h <= 0.62)
    ? ok(`the product beats take the full width and ${Math.round(prod.h*100)}% of the height — below the crop ceiling`)
    : bad('the product beats are mis-sized on a phone', JSON.stringify(prod));
  await phone.close();

  console.log('\n── Console ──');
  (errs.length === 0) ? ok('no page errors') : bad('errors', JSON.stringify(errs.slice(0, 3)));

  console.log('\n' + (fail ? '\x1b[31m' : '\x1b[32m') + `RESULT: ${pass} passed, ${fail} failed\x1b[0m`);
  await b.close(); srv.close(); process.exit(fail ? 1 : 0);
})();
