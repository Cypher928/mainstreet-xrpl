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
               '.json':'application/json', '.png':'image/png', '.svg':'image/svg+xml' };
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
  (sceneCount === 10) ? ok('the shared module carries all 10 beats') : bad('scene count', String(sceneCount));

  console.log('\n── Clicking the CTA plays in place, with no navigation ──');
  const navsBefore = navs.length;
  await page.click('a.btn--ghost');           // "Watch MainStreet in Action"
  await page.waitForTimeout(900);
  const st = await page.evaluate(() => {
    const f = document.getElementById('pfFilm');
    return { mounted: !!f, on: !!(f && f.classList.contains('msl-on')),
             capText: (document.getElementById('pfCap') || {}).innerText || '',
             bodyLocked: getComputedStyle(document.body).overflow === 'hidden',
             heroStillThere: !!document.querySelector('h1') };
  });
  (navs.length === navsBefore) ? ok('no navigation occurred — the click and the audio stay on one document')
                               : bad('the page navigated', JSON.stringify(navs.slice(navsBefore)));
  st.on ? ok('the film is open over the page') : bad('film did not open', JSON.stringify(st));
  /in one place/i.test(st.capText) ? ok(`playing from the first beat: "${st.capText}"`) : bad('wrong opening beat', st.capText);
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
  (cues.length === 10 && cues.every(c => c.line)) ? ok('all 10 narration cues exposed from home.html')
                                                  : bad('cues incomplete', String(cues.length));
  const hasAudio = /new Audio|speechSynthesis|<audio/.test(pf);
  !hasAudio ? ok('still scaffold only — no synthetic voice') : bad('synthetic audio present');

  console.log('\n── Console ──');
  (errs.length === 0) ? ok('no page errors') : bad('errors', JSON.stringify(errs.slice(0, 3)));

  console.log('\n' + (fail ? '\x1b[31m' : '\x1b[32m') + `RESULT: ${pass} passed, ${fail} failed\x1b[0m`);
  await b.close(); srv.close(); process.exit(fail ? 1 : 0);
})();
