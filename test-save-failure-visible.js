'use strict';
/**
 * test-save-failure-visible.js — a save that fails says so.
 *
 *   node test-save-failure-visible.js
 *
 * WHAT THIS PREVENTS
 *
 * saveProperty is called fire-and-forget from a debounce timer, from the
 * property you are leaving, and from the navigation away. None of those awaits
 * it. So any rejection it produced went nowhere: no console error, no logError
 * entry, no toast, no sync-status change — and no write. A save that did not
 * happen, with nothing anywhere to say so.
 *
 * Two of the function's steps made that reachable rather than theoretical:
 * _captureSnapshot and _lsSave ran BEFORE the try block, so a throw in either
 * skipped the error handling the Supabase write already had.
 *
 * This suite pins both halves: the boundary covers those steps, and every
 * approved fire-and-forget call site routes its rejection to _saveFailed. The
 * sink itself is lifted out of script.js and executed, so what is checked is
 * what it does, not what it looks like.
 *
 * WHAT IT DELIBERATELY DOES NOT CLAIM
 *
 * Seven further unawaited saveProperty call sites exist (escrow reserve delete,
 * the two space-vacancy writes, three owner-property writes, one restore).
 * They are OUT OF SCOPE for this slice by explicit instruction and are NOT
 * asserted here. §4 records them so the gap is written down rather than
 * implied.
 */
const fs   = require('fs');
const path = require('path');
const vm   = require('vm');
const { fnSource } = require('./test-support/fn-source');

const SCRIPT = fs.readFileSync(path.join(__dirname, 'script.js'), 'utf8');
// Comments in this change quote the very identifiers these assertions look for,
// so strip them: a grep that reads a comment is a green test about prose.
const CODE = SCRIPT.replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
  .map(l => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n');

let pass = 0, fail = 0;
const ok  = (m) => { console.log('  \x1b[32m✓\x1b[0m ' + m); pass++; };
const bad = (m, d) => { console.log('  \x1b[31m✗\x1b[0m ' + m + (d ? '\n      → ' + d : '')); fail++; };
const yes = (m, c, d) => c ? ok(m) : bad(m, d);
const H   = (t) => console.log('\n\x1b[36m── ' + t + ' ──\x1b[0m');

console.log('\n══ A save that fails says so ══');

// ── 1. The error boundary covers the local writes ───────────────────────────
H('_captureSnapshot and _lsSave are inside the boundary');

const SAVE = fnSource(CODE, 'saveProperty');
const tryAt  = SAVE.indexOf('try {');
const snapAt = SAVE.indexOf('_captureSnapshot(');
const lsAt   = SAVE.indexOf('_lsSave(');
const catchAt = SAVE.indexOf('} catch');

yes('saveProperty still has one try/catch', tryAt > -1 && catchAt > tryAt);
yes('_captureSnapshot runs inside the try, not before it',
    snapAt > tryAt && snapAt < catchAt, `try@${tryAt} snapshot@${snapAt} catch@${catchAt}`);
yes('_lsSave runs inside the try, not before it',
    lsAt > tryAt && lsAt < catchAt, `try@${tryAt} lsSave@${lsAt} catch@${catchAt}`);
yes("the 'local' sync status is set inside the try too",
    SAVE.indexOf("_setSyncStatus('local')") > tryAt && SAVE.indexOf("_setSyncStatus('local')") < catchAt);

// The generation counter must stay OUTSIDE, because the catch reads it to
// decide whether this completion has been superseded.
yes('the generation is claimed before the try, where the catch can still read it',
    SAVE.indexOf('++_saveGeneration') > -1 && SAVE.indexOf('++_saveGeneration') < tryAt);
yes('and the staleness guard in the catch is intact',
    /gen !== _saveGeneration/.test(SAVE.slice(catchAt)), 'a superseded failure would now be reported');

// Ordering within the try is behavioural: the localStorage copy must be on disk
// before the network write is attempted, or an offline failure loses the work.
yes('_lsSave still precedes the Supabase write',
    lsAt < SAVE.indexOf('_stripBlobs('), 'the local copy must be written first');

// ── 2. The sink actually sinks ──────────────────────────────────────────────
H('_saveFailed routes a rejection to a status, a log and nowhere else');

const sinkSrc = CODE.match(/const _saveFailed = [\s\S]*?\n\}\);/);
yes('_saveFailed is defined in script.js', !!sinkSrc);

function runSink(promise, prop) {
  const calls = { status: [], logs: [] };
  const ctx = {
    _setSyncStatus: (s, m) => calls.status.push([s, m]),
    logError: (t, e, c) => calls.logs.push([t, e && e.message, c]),
    Promise, console,
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(sinkSrc[0] + '\nthis.__out = _saveFailed(this.__p, this.__prop, this.__w);',
    Object.assign(ctx, { __p: promise, __prop: prop, __w: 'debounced' }));
  return { calls, out: ctx.__out };
}

const prop = { id: 'p-1', name: 'Cascade Commons' };

(async function main() {
  // A rejection is caught, reported, and does not propagate.
  {
    const { calls, out } = runSink(Promise.reject(new Error('boom')), prop);
    let threw = false;
    await out.catch(() => { threw = true; });
    yes('a rejection does not escape the sink', threw === false);
    yes('the sync status is set to error', calls.status.length === 1 && calls.status[0][0] === 'error');
    yes('the error message reaches the status', calls.status[0][1] === 'boom');
    yes('one logError is written', calls.logs.length === 1);
    yes('it is namespaced to the call site', calls.logs[0][0] === 'saveProperty:debounced',
        String(calls.logs[0][0]));
    yes('and it names the property, so the log says WHICH save was lost',
        calls.logs[0][2] && calls.logs[0][2].propId === 'p-1' && calls.logs[0][2].propName === 'Cascade Commons');
  }

  // A successful save must be left entirely alone — no status, no log.
  {
    const { calls, out } = runSink(Promise.resolve('ok'), prop);
    await out;
    yes('a successful save sets no error status', calls.status.length === 0);
    yes('a successful save writes no log', calls.logs.length === 0);
  }

  // A thrown non-Error, and a synchronous throw, are both survivable: the sink
  // is the last line of defence and must not itself become the failure.
  {
    const { calls, out } = runSink(Promise.reject('a string, not an Error'), prop);
    await out;
    yes('a non-Error rejection still produces a status and a log',
        calls.status.length === 1 && calls.logs.length === 1);
    yes('and the status carries a readable message',
        calls.status[0][1] === 'a string, not an Error', String(calls.status[0][1]));
  }

  // ── 3. Every approved call site routes through it ─────────────────────────
  H('The three approved fire-and-forget paths are covered');

  yes('the debounced save is wrapped',
      /_saveDebounceTimer = setTimeout\(\(\) => _saveFailed\(saveProperty\(prop\), prop, 'debounced'\), 800\)/.test(CODE),
      'the 800ms debounce can still drop a rejection');
  yes('the leaving-property save is wrapped',
      /_saveFailed\(saveProperty\(leavingProp\), leavingProp, 'leaving'\)/.test(CODE),
      'selectProperty can still drop the save of the property being left');
  yes('the navigation save is wrapped',
      /_saveFailed\(saveProperty\(prop\), prop, 'navigating'\)/.test(CODE),
      'the navigate-away save can still drop a rejection');
  yes('each site names itself, so a log entry says which path failed',
      new Set((CODE.match(/_saveFailed\(saveProperty\([^)]*\), [^,]+, '([a-z]+)'\)/g) || [])).size === 3,
      'two call sites share a label, or one lost its own');

  // ── 4. The gap this slice did not close, written down ─────────────────────
  H('What is still unwatched (out of scope, recorded not fixed)');

  // Line numbers come from the UNSTRIPPED source, so they are the ones a
  // reader can open. Comment lines are excluded by shape instead.
  const unhandled = SCRIPT.split('\n')
    .map((l, i) => [i + 1, l.trim()])
    .filter(([, t]) => /\bsaveProperty\(/.test(t)
      && !/^(\/\/|\*|\/\*)/.test(t)
      && !/^async function saveProperty\(/.test(t)
      && !/await\s+saveProperty\(/.test(t)
      && !/_saveFailed\(saveProperty\(/.test(t)
      && !/out = saveProperty\(prop\)/.test(t));

  console.log(`  ${unhandled.length} unawaited saveProperty call site(s) remain unwatched:`);
  unhandled.forEach(([n, t]) => console.log(`    · script.js:${n}  ${t.slice(0, 72)}`));

  // A number, deliberately hard-coded. It may go DOWN freely; raising it means
  // someone added a new fire-and-forget save without a sink, and should have to
  // say so in a diff.
  const UNWATCHED_BUDGET = 7;
  yes(`the unwatched count has not grown (${unhandled.length} ≤ ${UNWATCHED_BUDGET})`,
      unhandled.length <= UNWATCHED_BUDGET,
      'a new fire-and-forget saveProperty landed without rejection handling');

  console.log(`\n${fail ? '\x1b[31m' : '\x1b[32m'}RESULT: ${pass} passed, ${fail} failed\x1b[0m\n`);
  process.exit(fail ? 1 : 0);
})();
