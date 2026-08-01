'use strict';
/**
 * Hero film integration contract (Film 1).
 *
 * Two-state test. While the film does not exist, it asserts the hero is still
 * the static screenshot and that the plates a studio needs are present. The
 * moment a <video> appears in home.html it switches to enforcing the full
 * autoplay contract, so the swap cannot ship half-configured.
 *
 * See docs/FILM1_IMPLEMENTATION.md.
 */
const fs = require('fs'), path = require('path');
const ROOT = __dirname;
const HTML = fs.readFileSync(path.join(ROOT, 'home.html'), 'utf8');
const A = p => path.join(ROOT, 'assets', 'landing', p);
const exists = p => fs.existsSync(A(p));
const kb = p => Math.round(fs.statSync(A(p)).size / 1024);

let pass = 0, fail = 0;
const ok  = m => { console.log('  \x1b[32m✓\x1b[0m ' + m); pass++; };
const bad = (m, d) => { console.log('  \x1b[31m✗\x1b[0m ' + m + (d ? ' — ' + d : '')); fail++; };

// Isolate the hero <video>, if one has been added.
const video = (HTML.match(/<video[^>]*class="[^"]*hero-film[^"]*"[\s\S]*?<\/video>/i) || [null])[0];

console.log('\n── Studio plates (real UI, per package §3) ──');
for (const [f, what] of [
  ['beat1-cap-catch.png',  'beat 1 — allocation table with the cap row'],
  ['beat3-settlement.png', 'beat 3 — settlement verified on the XRP Ledger'],
  ['hero-poster.png',      'poster frame'],
  ['hero-plates.json',     'engine figures recorded per capture'],
]) exists(f) ? ok(`${what} (${f}, ${kb(f)} KB)`) : bad(`missing ${f}`, 'run tools/capture-hero-plates.js');

// The plates must carry the engine's own numbers, not numbers from a document.
if (exists('hero-plates.json')) {
  const r = JSON.parse(fs.readFileSync(A('hero-plates.json'), 'utf8'));
  const wh = r.figures && r.figures.wholeHealth;
  (wh && wh.capApplied && Math.round(wh.capAdjustment) === 31979 && wh.totalAllocated === 34650)
    ? ok(`figures came from the engine: cap −$${wh.capAdjustment}, allocated $${wh.totalAllocated}`)
    : bad('hero-plates.json figures do not match the engine', JSON.stringify(wh));
  (r.figures && r.figures.cappedCount === 4)
    ? ok('4 tenant caps enforced, as the Opportunity Center reports')
    : bad('capped count mismatch', String(r.figures && r.figures.cappedCount));
}

if (!video) {
  console.log('\n── Hero state: film not yet produced ──');
  /<img[^>]+assets\/landing\/ui-command-center\.png/.test(HTML)
    ? ok('hero is still the static product screenshot — no blank <video> shipped')
    : bad('hero image missing and no <video> present', 'the hero would render empty');
  (!exists('hero-loop.mp4') && !exists('hero-loop.webm'))
    ? ok('no stale encodes on disk')
    : bad('hero-loop encodes exist but home.html has no <video>', 'apply the swap in FILM1_IMPLEMENTATION.md');
} else {
  console.log('\n── Hero state: film integrated ──');
  for (const attr of ['autoplay', 'muted', 'playsinline'])
    new RegExp('\\b' + attr + '\\b').test(video)
      ? ok(`<video> is ${attr} (iOS refuses autoplay without all three)`)
      : bad(`<video> missing ${attr}`, 'autoplay will be blocked');
  /\bloop\b/.test(video) ? ok('<video> loops') : bad('<video> missing loop');

  const poster = (video.match(/poster="([^"]+)"/) || [])[1];
  poster && fs.existsSync(path.join(ROOT, poster))
    ? ok(`poster present (${poster})`)
    : bad('poster missing or not on disk', String(poster));

  for (const [f, type] of [['hero-loop.webm', 'webm'], ['hero-loop.mp4', 'mp4']]) {
    const wired = video.includes(f);
    if (!wired) { bad(`<video> has no ${type} source`); continue; }
    exists(f) ? ok(`${type} source present (${kb(f)} KB)`) : bad(`${f} referenced but not on disk`);
  }
  if (exists('hero-loop.mp4')) {
    const size = kb('hero-loop.mp4');
    size <= 2560 ? ok(`MP4 within the 2.5 MB hero budget (${size} KB)`)
                 : bad(`MP4 is ${size} KB, over the 2.5 MB budget`, 'competes with LCP above the fold');
  }
  /prefers-reduced-motion[\s\S]*?\.hero-film\s*\{[^}]*display\s*:\s*none/.test(HTML)
    ? ok('prefers-reduced-motion hides the film and leaves the still')
    : bad('no prefers-reduced-motion rule for .hero-film');
}

console.log('\n' + (fail ? '\x1b[31m' : '\x1b[32m') + `RESULT: ${pass} passed, ${fail} failed\x1b[0m`);
process.exit(fail ? 1 : 0);
