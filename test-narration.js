'use strict';
/**
 * Narration contract.
 *
 * The film schedules eight pre-rendered clips against fixed scene durations.
 * Three of those clips are longer than the scene they belong to, so nothing
 * but arithmetic keeps them from talking over each other — and that arithmetic
 * is only correct while the durations in product-film.js match the bytes on
 * disk. This suite re-measures every mp3 and re-derives the schedule, so a
 * re-render that changes a length fails here instead of shipping as an overlap.
 */
const fs = require('fs'), path = require('path');
const ROOT = __dirname;
const SRC = fs.readFileSync(path.join(ROOT, 'product-film.js'), 'utf8');

let pass = 0, fail = 0;
const ok  = m => { console.log('  \x1b[32m✓\x1b[0m ' + m); pass++; };
const bad = (m, d) => { console.log('  \x1b[31m✗\x1b[0m ' + m + (d ? ' — ' + d : '')); fail++; };

// ── measure the audio ────────────────────────────────────────────────────────
// Duration from MPEG1 Layer III frame headers. No decoder, no dependency: each
// frame is exactly 1152 samples, so counting frames is exact rather than an
// estimate from file size (which a variable-size ID3 tag would skew).
const BITRATE = {1:32,2:40,3:48,4:56,5:64,6:80,7:96,8:112,9:128,10:160,11:192,12:224,13:256,14:320};
const RATE = {0:44100, 1:48000, 2:32000};

function measure(file) {
  const b = fs.readFileSync(file);
  let i = 0;
  if (b.slice(0,3).toString() === 'ID3') {
    i = 10 + (((b[6]&0x7f)<<21)|((b[7]&0x7f)<<14)|((b[8]&0x7f)<<7)|(b[9]&0x7f));
  }
  let frames = 0, rate = 0, xing = false;
  while (i < b.length - 4) {
    if (b[i] !== 0xFF || (b[i+1] & 0xE0) !== 0xE0) { i++; continue; }
    const ver = (b[i+1]>>3)&3, lay = (b[i+1]>>1)&3;
    const bri = (b[i+2]>>4)&15, sri = (b[i+2]>>2)&3, pad = (b[i+2]>>1)&1;
    if (ver !== 3 || lay !== 1 || bri === 0 || bri === 15 || sri === 3) { i++; continue; }
    rate = RATE[sri];
    const len = Math.floor(144 * BITRATE[bri] * 1000 / rate) + pad;
    if (len < 4 || i + len > b.length) break;
    // The Xing/Info header lives in the first frame and carries no audio.
    if (frames === 0 && /Xing|Info/.test(b.slice(i, i+len).toString('latin1'))) xing = true;
    else frames++;
    i += len;
  }
  return { ms: Math.round(frames * 1152 / rate * 1000), rate, xing, bytes: b.length };
}

// ── load the real module ─────────────────────────────────────────────────────
// Runs product-film.js and asks IT for the schedule. An earlier version of this
// suite re-implemented the "anchor to scene, push past the previous line" rule
// here and compared the two — which meant deleting the scheduler from the film
// left every assertion green, because the test was only ever checking its own
// copy of the arithmetic. Nothing below may restate a rule the module owns.
const vm = require('vm');
const sandbox = { window: {}, Audio: function () {}, setTimeout, clearTimeout, Date, console };
vm.createContext(sandbox);
vm.runInContext(SRC, sandbox, { filename: 'product-film.js' });
const PF = sandbox.window.ProductFilm;
if (!PF || typeof PF.narrationCues !== 'function') {
  console.log('  \x1b[31m✗\x1b[0m product-film.js did not expose narrationCues()');
  process.exit(1);
}

const CUES = PF.narrationCues();
const SCENES = CUES.map(c => ({ id: c.id, dur: c.durMs }));
// The declared table, read back from the cues the module actually produced.
const VO = {};
CUES.filter(c => c.audio).forEach(c => { VO[c.id] = { file: path.basename(c.audio), durMs: c.voMs }; });

const schedule = () => CUES.map(c => c.audio
  ? { id: c.id, at: c.atMs, dur: c.durMs, start: c.startMs, end: c.endMs, voMs: c.voMs, file: c.audio }
  : { id: c.id, at: c.atMs, dur: c.durMs, silent: true });

console.log('\n── The clips exist and are real audio ──');
const VO_DIR = path.join(ROOT, 'assets', 'vo');
const measured = {};
for (const id of Object.keys(VO)) {
  const f = path.join(VO_DIR, VO[id].file);
  if (!fs.existsSync(f)) { bad(VO[id].file + ' is missing'); continue; }
  const m = measure(f);
  measured[id] = m;
  m.ms > 0 && m.rate === 44100
    ? ok(`${VO[id].file.padEnd(16)} ${(m.ms/1000).toFixed(2)}s @ ${m.rate}Hz, ${(m.bytes/1024).toFixed(0)}KB`)
    : bad(VO[id].file + ' did not parse as 44.1kHz MPEG audio');
}

console.log('\n── The duration table matches the bytes on disk ──');
// The whole schedule is derived from these numbers. 40ms of slack covers frame
// quantisation (26ms per frame); anything larger means a re-render happened and
// the table was not updated with it.
for (const id of Object.keys(VO)) {
  if (!measured[id]) continue;
  const diff = Math.abs(measured[id].ms - VO[id].durMs);
  diff <= 40
    ? ok(`${id.padEnd(9)} declared ${VO[id].durMs}ms, measured ${measured[id].ms}ms`)
    : bad(`${id} duration is stale`, `declared ${VO[id].durMs}ms, file is ${measured[id].ms}ms`);
}

console.log('\n── No two lines ever speak at once ──');
const S = schedule();
const voiced = S.filter(c => !c.silent);
let overlap = 0;
for (let i = 1; i < voiced.length; i++) {
  const gap = voiced[i].start - voiced[i-1].end;
  if (gap < 0) { bad(`${voiced[i-1].id} overlaps ${voiced[i].id}`, `by ${-gap}ms`); overlap++; }
}
const minGap = voiced.length > 1 ? Math.min(...voiced.slice(1).map((c, i) => c.start - voiced[i].end)) : Infinity;
if (!overlap) ok(`all ${voiced.length} lines are disjoint, minimum gap ${minGap}ms`);
// A literal floor, not VO_GAP read back from the source — reading the constant
// out of the file under test would make this assertion agree with any value it
// found, including zero. Back-to-back lines with no breath is the thing being
// ruled out, and that requirement does not live in product-film.js.
const BREATH = 200;
minGap >= BREATH
  ? ok(`every line has at least ${BREATH}ms of breath before it`)
  : bad('lines run into each other', `minimum gap is ${minGap}ms, want ≥ ${BREATH}ms`);

console.log('\n── The overruns are handled, not ignored ──');
// These three are the reason the scheduler exists. If a re-render ever makes
// them fit, this test should be simplified — but silently losing the guard
// while the clips still overrun is the failure worth catching.
const over = voiced.filter(c => c.voMs > c.dur);
over.length
  ? ok(`${over.length} lines run past their scene (${over.map(c => c.id + ' +' + (c.voMs - c.dur) + 'ms').join(', ')})`)
  : ok('no line overruns its scene');
for (const c of over) {
  const next = voiced[voiced.indexOf(c) + 1];
  if (!next) continue;
  next.start >= c.end + BREATH
    ? ok(`${c.id} overrun absorbed — ${next.id} pushed to ${next.start}ms, still inside its own scene`)
    : bad(`${c.id} overrun collides with ${next.id}`);
}
// A pushed line must not be shoved out of the scene it describes, or the voice
// would be talking about a screen that is no longer on-frame.
for (const c of voiced) {
  const sceneEnd = c.at + c.dur;
  c.start < sceneEnd
    ? ok(`${c.id.padEnd(9)} starts ${c.start - c.at}ms into its own scene`)
    : bad(`${c.id} is pushed past its scene entirely`, `starts ${c.start}ms, scene ends ${sceneEnd}ms`);
}

console.log('\n── The closing line is not cut off ──');
const total = SCENES.reduce((a, s) => a + s.dur, 0);
const last = voiced[voiced.length - 1];
const holds = /hold = Math\.max\(hold, narrationEndMs\(\) - elapsed \+ \d+\)/.test(SRC);
last.end > total
  ? (holds ? ok(`closing line runs ${last.end - total}ms past the last cut, and the end card waits for it`)
           : bad('closing line is truncated', `ends ${last.end}ms, film cuts at ${total}ms`))
  : ok('closing line finishes before the last cut');

console.log('\n── Silence is deliberate ──');
// The script refuses to narrate the UI, so two scenes carry no line. Asserting
// this stops a future "fill the gap" edit from quietly undoing that decision.
const silent = S.filter(c => c.silent).map(c => c.id);
// `open` is the establishing shot and stays silent permanently. `space` and
// `settle` are silent only until their clips are rendered — they were holes of
// 6.9s and 4.3s in the first narrated cut, and the film is not finished while
// they are listed here. This asserts the expected state and says which of the
// two reasons applies, so a pending render never reads as a design decision.
const PENDING = ['space', 'settle'];
const expected = ['open'].concat(PENDING.filter(id => silent.includes(id)));
JSON.stringify(silent) === JSON.stringify(expected)
  ? ok('silent scenes: ' + silent.map(id => id + (id === 'open' ? ' (by design)' : ' (clip pending)')).join(', '))
  : bad('the silent scenes changed', 'now ' + JSON.stringify(silent));
const stillPending = PENDING.filter(id => silent.includes(id));
stillPending.length
  ? console.log(`  \x1b[33m·\x1b[0m ${stillPending.length} line(s) not yet recorded: ${stillPending.join(', ')} — the film has a gap until they land`)
  : ok('every planned line is recorded — no gaps left in the read');

console.log('\n── The opening does not stall ──');
const open0 = S[0];
(open0.id === 'open' && open0.silent && open0.dur >= 1500 && open0.dur <= 2000)
  ? ok(`establishing shot holds ${open0.dur}ms with no voice, inside the 1.5–2.0s brief`)
  : bad('the establishing shot is wrong', JSON.stringify(open0));
const firstLine = voiced[0];
// The complaint this fixes: the first line fired at 0ms, over the 450ms
// fade-in — the voice arrived before the picture. It must now start after the
// establishing shot has cut away.
firstLine.start >= open0.dur + 400
  ? ok(`the first line starts at ${firstLine.start}ms — after the cut, not over the fade-in`)
  : bad('the first line still starts too early', `${firstLine.start}ms, establishing shot ends ${open0.dur}ms`);

console.log('\n── The music bed degrades to silence, never to a broken film ──');
// The bed is optional and not yet supplied. What must hold either way: a
// missing or blocked bed cannot take the narration down with it, because the
// blocked-audio path mutes everything and losing music is not a reason to lose
// the voice.
const bedPath = path.join(ROOT, 'assets', 'audio', 'bed.mp3');
[['function startBed', 'the bed has its own start path, separate from the narration'],
 ['vox.bedFailed = true', 'a failed bed marks itself and stops trying'],
 ['rampVolume', 'the bed fades rather than cutting in and out'],
 ['BED_DUCK', 'the bed ducks under each spoken line'],
].forEach(([needle, msg]) => SRC.includes(needle) ? ok(msg) : bad('missing: ' + msg));
// The narration's own catch must be the only thing that mutes the film.
!/p\.catch\(function \(\) \{ vox\.bedFailed = true; \}\);[\s\S]{0,40}setMuted/.test(SRC)
  ? ok('a missing bed does not mute the narration')
  : bad('a failed bed mutes the whole film');
fs.existsSync(bedPath)
  ? ok('assets/audio/bed.mp3 is present — music plays from the first frame')
  : console.log('  \x1b[33m·\x1b[0m assets/audio/bed.mp3 not supplied yet — the film plays without music, no error');

console.log('\n── Playback is wired correctly ──');
[['preload: preload',            'preload() is exposed so clips can be warmed before play()'],
 ['silence();\n    state.playing = false', 'stop() silences the narration'],
 ['p.catch(function () { vox.blocked = true; setMuted(true); })',
                                 'blocked autoplay falls back to muted instead of failing silently'],
 ['id="pfMute"',                 'a mute control is rendered'],
 ['state.t0 = Date.now() - sceneStartMs(state.i)', 'arrow-key scrub re-anchors the narration clock'],
].forEach(([needle, msg]) => SRC.includes(needle) ? ok(msg) : bad('missing: ' + msg));

console.log('\n── The page does not claim there is no narration ──');
const HOME = fs.readFileSync(path.join(ROOT, 'home.html'), 'utf8');
/no narration/i.test(HOME)
  ? bad('home.html still says "no narration"', 'the film now has a voice track')
  : ok('home.html makes no false claim about narration');
/ProductFilm\.preload\(\)/.test(HOME)
  ? ok('home.html warms the clips on hover, so the opening line is not late')
  : bad('home.html never calls preload()');

console.log('\n' + (fail ? '\x1b[31m' : '\x1b[32m') + 'RESULT: ' + pass + ' passed, ' + fail + ' failed\x1b[0m');
process.exit(fail ? 1 : 0);
