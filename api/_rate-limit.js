'use strict';
/**
 * _rate-limit.js — SEC-12: the best in-process limiter available here, and an
 * honest statement of what it cannot do.
 *
 * ── WHAT THIS CANNOT DO ─────────────────────────────────────────────────────
 * This limiter is PER INSTANCE. Vercel runs each serverless function in its own
 * isolate and scales them horizontally with no shared memory, so a caller
 * spread across N warm instances gets up to N × max, and a cold start begins at
 * zero. There is no fix for that without shared storage (Redis, Upstash, KV, or
 * a Postgres counter), and this codebase deliberately has no such dependency.
 *
 * That limit is stated here rather than papered over. Treat these numbers as a
 * brake on accidental runaway loops and single-client hammering — which is what
 * they actually catch — NOT as a defence against a determined attacker, and not
 * as a cost ceiling. Anything that needs a real ceiling needs shared state.
 *
 * ── WHAT WAS ACTUALLY WRONG, AND IS NOW FIXED ───────────────────────────────
 * The previous limiter was copied into eight handlers, and each copy had three
 * defects that are fixable in process:
 *
 *   1. UNBOUNDED MEMORY. `_rl` was a Map that only ever grew — one entry per
 *      user id, never pruned, for the life of the instance. On a long-lived warm
 *      instance that is a slow leak in a 1024 MB sandbox.
 *
 *   2. THE WINDOW NEVER MOVED. `w.reset` was set once when the entry was
 *      created and only advanced after it had fully elapsed, so a caller who
 *      kept the entry warm rode one fixed window. A sliding window is both more
 *      accurate and cheaper to reason about.
 *
 *   3. NO RETRY SIGNAL. It returned a bare boolean, so every handler answered
 *      429 with no `Retry-After`. A client cannot back off correctly against a
 *      window it cannot see.
 *
 * Eight copies also meant eight places to fix any of the above. There is one now.
 */

/** requests[] holds the timestamps of each hit inside the window. */
const _buckets = new Map();

/** Hard cap on tracked identities per instance — the memory bound. */
const MAX_TRACKED = 5000;

/** How often to sweep expired buckets, in operations. */
const SWEEP_EVERY = 500;
let _ops = 0;

function _sweep(now) {
  for (const [key, hits] of _buckets) {
    // A bucket whose newest hit is older than the longest window we use is dead.
    if (!hits.length || now - hits[hits.length - 1] > 3600000) _buckets.delete(key);
  }
  // Still over the cap after sweeping? Evict oldest-first. Insertion order on a
  // Map is stable, so the first keys are the least recently created.
  if (_buckets.size > MAX_TRACKED) {
    const excess = _buckets.size - MAX_TRACKED;
    let i = 0;
    for (const key of _buckets.keys()) {
      if (i++ >= excess) break;
      _buckets.delete(key);
    }
  }
}

/**
 * Sliding-window check.
 *
 * Returns { ok, remaining, retryAfterSec, limit }. Callers should send
 * `Retry-After: retryAfterSec` with a 429 so a client can back off against the
 * real window instead of guessing.
 */
function checkRate(identity, max, windowMs) {
  const now = Date.now();
  if (++_ops % SWEEP_EVERY === 0) _sweep(now);

  const key = String(identity == null ? 'anon' : identity);
  const cutoff = now - windowMs;

  let hits = _buckets.get(key);
  if (!hits) { hits = []; _buckets.set(key, hits); }

  // Drop everything that has slid out of the window. Hits are appended in time
  // order, so the expired ones are always a prefix.
  let drop = 0;
  while (drop < hits.length && hits[drop] <= cutoff) drop++;
  if (drop) hits.splice(0, drop);

  if (hits.length >= max) {
    // The window frees up when the OLDEST hit in it expires.
    const retryAfterMs = Math.max(0, hits[0] + windowMs - now);
    return {
      ok: false,
      remaining: 0,
      retryAfterSec: Math.max(1, Math.ceil(retryAfterMs / 1000)),
      limit: max,
    };
  }

  hits.push(now);
  return { ok: true, remaining: max - hits.length, retryAfterSec: 0, limit: max };
}

/**
 * The 429 a handler should send. Kept here so every endpoint answers the same
 * way, with the header a client needs to behave.
 */
function sendRateLimited(res, verdict) {
  res.setHeader('Retry-After', String(verdict.retryAfterSec));
  return res.status(429).json({
    error: `Too many requests — please slow down. Try again in ${verdict.retryAfterSec} second${verdict.retryAfterSec === 1 ? '' : 's'}.`,
    retryAfter: verdict.retryAfterSec,
  });
}

/** Test seam: reset instance state between cases. */
function _resetForTests() { _buckets.clear(); _ops = 0; }

module.exports = { checkRate, sendRateLimited, MAX_TRACKED, _resetForTests, _buckets };
