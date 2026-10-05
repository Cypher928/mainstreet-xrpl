'use strict';
/**
 * api/_ledger-common.js — what api/_ledger-import.js and api/_ledger-reverse.js
 * (served from api/upload.js ?op=ledger-import / ?op=ledger-reverse) share: who is calling, where an acquisition original lives, and how a
 * database refusal is told to the person. Not an endpoint (leading underscore).
 *
 * Every function takes the Supabase target and fetch it should use, so the same
 * code runs against Pilot and, in tools/verify-ledger-import-endpoint.js,
 * against a local stand-in.
 */

const crypto = require('crypto');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The signed-in person, from their own access token. null after responding. */
async function verifyUser(t, fetchFn, req, res) {
  const tok = String(req.headers && (req.headers.authorization || req.headers.Authorization) || '').replace(/^Bearer\s+/i, '');
  if (!tok) { res.status(401).json({ error: 'Authentication required' }); return null; }
  try {
    const r = await fetchFn(`${t.url}/auth/v1/user`, {
      signal: AbortSignal.timeout(4000),
      headers: { apikey: (t.serviceRoleKey || t.anonKey).trim(), Authorization: `Bearer ${tok}` },
    });
    if (!r.ok) { res.status(401).json({ error: 'Invalid or expired token' }); return null; }
    const user = await r.json();
    if (!user || !UUID.test(String(user.id || ''))) { res.status(401).json({ error: 'User identity missing' }); return null; }
    return { id: user.id, token: tok };
  } catch (e) {
    res.status(503).json({ error: 'Auth service unavailable — try again' });
    return null;
  }
}

/**
 * An acquisition original's storage path, as api/upload.js writes it:
 *   leases/<owner uid>/acq_<review id>_<timestamp>-<file name>
 * Returns { bucket, name } (name = '<owner uid>/acq_…', the object's name in
 * the bucket) only when it is exactly that, for this owner and review; anything
 * else (another folder, another review, a nested or '..' path) is null — the
 * pattern admits no '/' after the owner folder, so no traversal can match.
 */
function acquisitionOriginal(storagePath, ownerId, reviewId) {
  const s = String(storagePath || '');
  const m = s.match(/^leases\/([0-9a-f-]{36})\/(acq_([0-9a-f-]{36})_[A-Za-z0-9._-]+)$/i);
  if (!m) return null;
  if (m[1].toLowerCase() !== String(ownerId || '').toLowerCase()) return null;
  if (m[3].toLowerCase() !== String(reviewId || '').toLowerCase()) return null;
  // The object's name inside the bucket includes the owner's folder.
  return { bucket: 'leases', name: m[1] + '/' + m[2] };
}

/**
 * A PostgREST error body → an HTTP status and what the person is told.
 *
 * Only the refusals the 046 functions raise on purpose are repeated to the
 * person, by SQLSTATE: their sentences are written for people and carry no
 * internals. Anything else — a PostgREST error, a constraint the functions did
 * not anticipate, an internal failure — is told as one fixed sentence with a
 * reference id, and the full body is logged server-side under that id.
 */
const SAFE_CODES = {
  '42501': 403,   // insufficient_privilege — who may import or reverse
  '23514': 409,   // check_violation — the functions' own refusals (preview, balance, status…)
  '55P03': 409,   // lock_not_available — another import or reversal is still running
  '40001': 409,   // serialization_failure — two imports at once
  '57014': 504,   // query_canceled — the statement limit
  '53400': 429,   // configuration_limit_exceeded — too many imports by one person
};
function refusal(status, bodyText, log) {
  let j = null;
  try { j = JSON.parse(bodyText); } catch (_) { /* not JSON */ }
  const code = j && typeof j.code === 'string' ? j.code : null;
  if (code && SAFE_CODES[code]) {
    const msg = (j && typeof j.message === 'string' && j.message.trim()) || 'The database refused the request';
    return { http: SAFE_CODES[code], body: { error: msg.slice(0, 300), code } };
  }
  const ref = crypto.randomBytes(6).toString('hex');
  (log || console.error)(`[ledger] unexpected database refusal ref=${ref} status=${status} code=${code || '-'} body=${String(bodyText || '').slice(0, 2000)}`);
  return { http: status >= 500 ? 502 : 500, body: { error: `The request could not be completed. Reference ${ref}.`, code: 'unexpected', reference: ref } };
}

module.exports = { UUID, SAFE_CODES, verifyUser, acquisitionOriginal, refusal };
