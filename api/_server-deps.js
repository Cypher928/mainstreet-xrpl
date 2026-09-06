'use strict';
/**
 * api/_server-deps.js — the eight modules PropertyRecord.assemble() needs, loaded
 * for Node without leaving a `window` behind.
 *
 * WHY THIS FILE EXISTS AT ALL
 * ---------------------------
 * property-record.js ends with
 *
 *     })(typeof window !== 'undefined' ? window : null);
 *
 * so under Node its `root` is null and `_dep()`'s global fallback is dead. That
 * is a feature: it means a server caller MUST hand assemble() its dependencies
 * explicitly, and there is no ambient path by which a browser global could creep
 * into a server-side answer. This module builds that explicit set, once.
 *
 * THE SHIM, AND WHY IT IS TEMPORARY AND NARROW
 * -------------------------------------------
 * Five of the eight are plain CommonJS and load cleanly. Three —
 * lease-intelligence.js, tenant-space.js and property-workspace.js — are
 * browser-first files that end by assigning to `window`, so requiring them under
 * Node throws `window is not defined` before a single line of their logic runs.
 *
 * The fix is to give them a window to assign to, take what they assigned, and
 * put the global back exactly as it was. `global.window` is restored — deleted
 * if it did not exist, and returned to its prior value if it did — so nothing
 * downstream can find a `window` this module created. A serverless process is
 * long-lived and shared between invocations; a leaked global there is not a
 * tidiness problem, it is a cross-request one.
 *
 * LOAD TIME IS NOT THE ONLY TIME
 * -----------------------------
 * Restoring the global after load is necessary but not sufficient, because two
 * of those files also read `window` when their functions are CALLED, not merely
 * when they are loaded:
 *
 *     property-workspace.js:42   var S = window.Selectors || {};
 *     property-workspace.js:86   var PR = window.PropertyReference;
 *
 * So `PropertyWorkspace.collectAttention(p)` — which PropertyRecord.assemble()
 * calls — throws ReferenceError under a restored (absent) global. withWindow()
 * exists for that: it reinstalls the same shim for the duration of one call and
 * restores it in a `finally`. The window is never present between calls.
 *
 * WHAT IS IN THE SHIM IS AN ALLOW-LIST, AND THAT IS A SECURITY PROPERTY
 * --------------------------------------------------------------------
 * The shim holds the three modules that attached themselves during load, plus
 * PropertyReference, which is pure and is looked up by name at call time. It
 * holds nothing else — and specifically NOT:
 *
 *   Selectors        loads under Node but every function throws, because
 *                    selectors.js references a bare `ReviewEngine` global while
 *                    review-engine.js only ever attaches to `window`. Supplying
 *                    it would mean leaking a second kind of global to paper over
 *                    the first. collectAttention degrades without it by design
 *                    (`|| {}`), and the hydrator reports that degradation.
 *   PropertyTimeline property-timeline.js touches `document` at load.
 *   currentProperty  \
 *   showToast         | browser SESSION state. tenant-space.js reaches for all
 *   savePropertyNow   | four. On a server they must be `undefined`, which is the
 *   AuthService      /  path those files already handle, so that no browser
 *                       session can influence a server-side record.
 *
 * Every one of those resolves to `undefined` inside the shim, which is the same
 * thing a browser with the script absent would give. The absence is the
 * enforcement of "no browser session data in the server record" — a structural
 * guarantee rather than a reviewed one.
 *
 * Those three files DO contain `document.` references. None of them is on a path
 * assemble() takes, which is asserted by running the whole thing against a
 * document that throws on contact rather than by reading the files and hoping.
 *
 * READ-ONLY. No database client, no network, no fund movement, no writes.
 */

const path = require('path');
const ROOT = path.join(__dirname, '..');

/**
 * EVERY REQUIRE BELOW IS A STRING LITERAL, AND THAT IS NOT A STYLE CHOICE
 * ----------------------------------------------------------------------
 * A serverless deployment does not ship the repository. Vercel's Node builder
 * runs @vercel/nft over each entry point, follows the requires it can resolve
 * statically, and packages only those files. `require(path.join(__dirname, rel))`
 * is a computed expression: nft has no value for `rel`, follows nothing, and
 * says nothing. The function deploys, every local test passes, and the first
 * real invocation dies on MODULE_NOT_FOUND — because the eight dependencies were
 * never in the bundle.
 *
 * This file used to do exactly that. tools/static-require-trace.js models what a
 * bundler can see, and test-m2-runtime-harness.js asserts that every dependency
 * is reachable from the hydrator by literal requires alone. If you replace one
 * of these with a computed path, that test fails — before a deployment does.
 */
const REQUIRE = {
  '../field-provenance.js':   () => require('../field-provenance.js'),
  '../cam-pool.js':           () => require('../cam-pool.js'),
  '../property-reference.js': () => require('../property-reference.js'),
  '../timeline-merge.js':     () => require('../timeline-merge.js'),
  '../variance-breakdown.js': () => require('../variance-breakdown.js'),
  '../lease-intelligence.js': () => require('../lease-intelligence.js'),
  '../tenant-space.js':       () => require('../tenant-space.js'),
  '../property-workspace.js': () => require('../property-workspace.js'),
};

/** Load one declared dependency. Refuses a path that has no literal require. */
function _req(rel) {
  const load = REQUIRE[rel];
  if (!load) {
    throw new Error('[server-deps] ' + rel + ' has no static require entry — a ' +
                    'bundler could not see it, so it would be absent at runtime');
  }
  return load();
}

/** Plain CommonJS: these export properly and need no shim. */
const CLEAN = {
  FieldProvenance:   '../field-provenance.js',
  CamPool:           '../cam-pool.js',
  PropertyReference: '../property-reference.js',
  TimelineMerge:     '../timeline-merge.js',
  VarianceBreakdown: '../variance-breakdown.js',
};

/** Browser-first: they assign to `window` and return nothing useful from require. */
const NEEDS_WINDOW = {
  LeaseIntelligence: '../lease-intelligence.js',
  TenantSpace:       '../tenant-space.js',
  PropertyWorkspace: '../property-workspace.js',
};

/**
 * Names the shim is allowed to carry, and nothing else. Anything absent from
 * this list resolves to `undefined` inside the shim — the same value a browser
 * missing that script would give, and the path these files already handle.
 *
 * Keep this list closed. Adding a name here is the one way browser state could
 * reach a server-assembled record, so an addition needs the same scrutiny as a
 * new database read.
 */
const SHIM_KEYS = ['LeaseIntelligence', 'TenantSpace', 'PropertyWorkspace', 'PropertyReference'];

let _cached  = null;
let _shim    = null;   // the raw backing object, writable during load
let _window  = null;   // the sealed view handed to withWindow()
const _blocked = [];   // names something tried to attach at call time
const _reads   = [];   // every window.* name the dependency graph asked for

/**
 * Seal the shim behind a proxy that ignores writes of names outside the
 * allow-list.
 *
 * This is not hypothetical tidiness. cam-pool.js does
 *
 *     const MC = (typeof window !== 'undefined' && window.MoneyCents)
 *             || require('./money-cents.js');
 *
 * inside a function, so during assemble() the require runs, money-cents.js sees
 * a `window`, and its UMD tail assigns itself to it. Nothing breaks — cam-pool
 * takes the require's return value either way — but the shim would quietly grow
 * a name nobody put there, and an allow-list that grows on its own is not an
 * allow-list. Refused writes are recorded in blockedWrites() rather than merely
 * dropped, so the behaviour is inspectable instead of invisible.
 *
 * The trap returns true rather than false: returning false makes an assignment
 * throw under 'use strict', which would turn a harmless UMD tail into a crash.
 */
function _seal(shim) {
  return new Proxy(shim, {
    // Every name the dependency graph asks the shim for, recorded as it is asked.
    // This is what makes requirement "fail loudly if a new undeclared global
    // dependency appears" checkable at RUNTIME rather than by reading files: a
    // dependency that starts reaching for window.Something shows up here the
    // first time it runs, whether or not anyone thought to grep for it.
    get(target, prop, recv) {
      if (typeof prop === 'string' && _reads.indexOf(prop) === -1) _reads.push(prop);
      return Reflect.get(target, prop, recv);
    },
    has(target, prop) {
      if (typeof prop === 'string' && _reads.indexOf(prop) === -1) _reads.push(prop);
      return Reflect.has(target, prop);
    },
    set(target, prop, value) {
      if (SHIM_KEYS.indexOf(prop) === -1) {
        if (_blocked.indexOf(prop) === -1) _blocked.push(String(prop));
        return true;
      }
      target[prop] = value;
      return true;
    },
    defineProperty(target, prop, desc) {
      if (SHIM_KEYS.indexOf(prop) === -1) {
        if (_blocked.indexOf(prop) === -1) _blocked.push(String(prop));
        return true;
      }
      Object.defineProperty(target, prop, desc);
      return true;
    },
  });
}

/** Delete every key that is not on the allow-list. Returns what it removed. */
function _pruneToAllowList(obj) {
  const removed = [];
  for (const k of Object.keys(obj)) {
    if (SHIM_KEYS.indexOf(k) === -1) { delete obj[k]; removed.push(k); }
  }
  return removed;
}

/** Install the shim, run fn, put the global back exactly as it was. */
function _underShim(shim, fn) {
  const had   = Object.prototype.hasOwnProperty.call(global, 'window');
  const prior = had ? global.window : undefined;
  try {
    global.window = shim;
    return fn();
  } finally {
    if (had) global.window = prior;
    else     delete global.window;
  }
}

/**
 * Load the three browser-first modules behind a temporary global, then restore
 * the global. Returns what they attached, and keeps the shim for withWindow().
 *
 * The try/finally is the whole point: if one of them throws halfway through, the
 * global is still put back. A partially-loaded dependency is a caller's problem;
 * a permanently mutated process is everyone's.
 */
function _loadWindowBound() {
  const shim = {};
  const out  = {};
  _underShim(shim, () => {
    for (const [name, rel] of Object.entries(NEEDS_WINDOW)) {
      _req(rel);
      out[name] = shim[name] || null;
    }
  });
  _shim = shim;
  return out;
}

/**
 * The dependency set for PropertyRecord.assemble(property, deps).
 * Cached: the modules are stateless and requiring them repeatedly would re-run
 * the shim for no reason.
 */
function load() {
  if (_cached) return _cached;
  const deps = {};
  for (const [name, rel] of Object.entries(CLEAN)) {
    deps[name] = _req(rel);
  }
  Object.assign(deps, _loadWindowBound());

  // The shim is pruned to the allow-list AFTER load. The seal below covers
  // call-time writes; this covers load-time ones, which the seal cannot, because
  // the three browser-first modules have to be able to attach themselves before
  // it exists. No dependency in today's set attaches an extra name on the way
  // in, so this removes nothing at present — it is the load-time half of a
  // guarantee that would otherwise hold only half the time.
  _pruneToAllowList(_shim);
  // PropertyReference is looked up by name at call time (property-workspace.js:86)
  // and is not one of the three that self-attach, so it is placed explicitly.
  _shim.PropertyReference = deps.PropertyReference;

  // From here on the shim is closed: writes outside the allow-list are refused.
  _window = _seal(_shim);

  _cached = deps;
  return deps;
}

/**
 * Run fn with the allow-listed shim installed as `window`, and restore the
 * global afterwards whether fn returns or throws.
 *
 * Callers wrap the single call that needs it — PropertyRecord.assemble() —
 * rather than a whole request, so the window exists for the shortest possible
 * span. Nothing awaits inside: this is deliberately SYNCHRONOUS, because a
 * global installed across an `await` would be visible to unrelated work that
 * happened to run on the event loop in between.
 */
function withWindow(fn) {
  if (!_window) load();
  return _underShim(_window, fn);
}

/** The shim's exact contents, for a test to assert the allow-list is closed. */
function shimKeys() {
  if (!_shim) load();
  return Object.keys(_shim).sort();
}

/** Names something tried to attach to the sealed shim and was refused. */
function blockedWrites() { return _blocked.slice().sort(); }

/**
 * Every `window.<name>` the dependency graph has actually reached for, in the
 * order first seen. A name here that is not in SHIM_KEYS is a dependency on a
 * browser global that this module does not supply — harmless today because it
 * reads `undefined`, but it is exactly how a new undeclared global dependency
 * would arrive, and the M2 harness fails loudly when one appears.
 */
function shimReads() { return _reads.slice().sort(); }

/** Reads seen so far that are NOT on the allow-list. */
function undeclaredReads() { return _reads.filter(n => SHIM_KEYS.indexOf(n) === -1).sort(); }

/** Forget the recorded reads. For a harness that wants a clean measurement. */
function resetObservations() { _reads.length = 0; _blocked.length = 0; }

/** Names assemble() asks for, so a caller can assert the set is complete. */
const REQUIRED = Object.keys(CLEAN).concat(Object.keys(NEEDS_WINDOW));

/** True when every dependency loaded. A missing one degrades the record rather
 *  than crashing it — assemble() reports the gap in meta.unavailable — but a
 *  caller should be able to see that it happened. */
function missing(deps) {
  const d = deps || load();
  return REQUIRED.filter(n => !d[n]);
}

/** Did this module leave a `window` behind? Should always be false. */
function leakedWindow() {
  return Object.prototype.hasOwnProperty.call(global, 'window');
}

module.exports = {
  load, withWindow, shimKeys, blockedWrites, shimReads, undeclaredReads, _req,
  resetObservations, missing, leakedWindow, _pruneToAllowList,
  REQUIRED, CLEAN, NEEDS_WINDOW, SHIM_KEYS, ROOT,
};
