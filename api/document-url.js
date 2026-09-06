// api/document-url.js — SEC-1: a short-lived, ownership-checked URL for a stored document.
// ============================================================================
// The `leases` and `invoices` buckets were created public, so every uploaded
// lease PDF was retrievable by anyone holding the URL — no authentication, no
// expiry. Commercial leases carry tenant names, rents, addresses, guarantors
// and signatures. The row was protected by RLS; the object was not protected
// at all.
//
// Making the buckets private breaks every `/object/public/...` URL already
// stored in lease_documents.file_url and on tenant records. This endpoint is
// the replacement: the client asks for a URL at the moment it needs one, the
// server checks ownership, and Supabase mints a signed URL that expires.
//
// ── THE OWNERSHIP RULE ──────────────────────────────────────────────────────
// api/upload.js writes every object to `${user.id}/${safeName}`. So the first
// path segment IS the owner, and the check is exact:
//
//     path.split('/')[0] === user.id
//
// That is stronger than joining through properties (a lease can be re-pointed
// between properties; the storage path cannot be re-pointed between users) and
// it needs no database round trip. A path that does not begin with the
// caller's id is refused, whatever the caller claims about it.
//
// ── WHY THE CLIENT MAY SEND A FULL URL ──────────────────────────────────────
// Existing rows hold complete public URLs. Rather than migrate that column,
// the path is parsed back out of whatever the caller sends — old-style public
// URLs, new-style bare paths, both. The path is then re-derived and re-checked
// here; nothing the caller sends is trusted as a location.
'use strict';

const { checkRate, sendRateLimited } = require('./_rate-limit');
const _t = require('./_pilot-target');

const SUPABASE_URL      = _t.url;
const SUPABASE_ANON_KEY = _t.anonKey;
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error('[api/document-url] Supabase URL/anon not configured for ' + _t.name + ' target');
}

const ALLOWED_BUCKETS = ['leases', 'invoices'];

// Short. A signed URL is handed out per view; it does not need to outlive the
// page that asked for it, and a leaked one should die quickly.
const SIGN_TTL_SECONDS = 300;

async function _verifyUser(req, res) {
  const tok = (req.headers['authorization'] || '').replace(/^Bearer\s+/, '');
  if (!tok) { res.status(401).json({ error: 'Authentication required' }); return null; }
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      signal: AbortSignal.timeout(3000),
      headers: { apikey: (_t.serviceRoleKey || SUPABASE_ANON_KEY).trim(), Authorization: `Bearer ${tok}` },
    });
    if (!r.ok) { res.status(401).json({ error: 'Invalid or expired token' }); return null; }
    const user = await r.json();
    if (!user?.id) { res.status(401).json({ error: 'User identity missing' }); return null; }
    return user;
  } catch (e) {
    const timedOut = e?.name === 'TimeoutError' || e?.name === 'AbortError';
    res.status(timedOut ? 503 : 500).json({ error: timedOut ? 'Auth service unavailable — try again' : 'Auth check failed' });
    return null;
  }
}

/**
 * Extracts { bucket, path } from anything the client might hold.
 *
 * Accepts a stored public URL, a signed URL, or a bare "bucket/path". Returns
 * null when it cannot be parsed — never a guess, because a guess here would be
 * a guess about which file to hand over.
 *
 * Rejects `..` outright. The path is used to build a Storage API URL, and a
 * traversal segment there is never legitimate.
 */
function parseStoragePath(ref) {
  if (typeof ref !== 'string' || !ref.trim()) return null;
  let s = ref.trim();

  // Strip a full URL down to the storage-relative part.
  const marker = s.indexOf('/storage/v1/object/');
  if (marker !== -1) {
    s = s.slice(marker + '/storage/v1/object/'.length);
    // Drop the access-mode segment: public/ , sign/ , authenticated/
    s = s.replace(/^(public|sign|authenticated)\//, '');
  }
  // Drop any query string (a signed URL carries ?token=…).
  s = s.split('?')[0];
  // Percent-decoding happens here so traversal cannot hide behind %2e%2e.
  try { s = decodeURIComponent(s); } catch (_) { return null; }

  const parts = s.split('/').filter(Boolean);
  if (parts.length < 2) return null;

  const bucket = parts[0];
  const path   = parts.slice(1).join('/');
  if (!ALLOWED_BUCKETS.includes(bucket)) return null;
  if (path.split('/').some(seg => seg === '..' || seg === '.')) return null;
  return { bucket, path };
}

/** The owner of an object is the first path segment — see the header. */
function pathOwner(path) {
  const first = String(path || '').split('/')[0];
  return first || null;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await _verifyUser(req, res);
  if (!user) return;
  {
    const rl = checkRate(user.id, 120, 60000);
    if (!rl.ok) return sendRateLimited(res, rl);
  }

  const { ref, fileUrl, path: rawPath } = req.body || {};
  const parsed = parseStoragePath(ref || fileUrl || rawPath);
  if (!parsed) {
    return res.status(400).json({ error: 'Missing or unrecognised document reference' });
  }

  // THE CHECK. Not a lookup that could be stale — the identity is in the path.
  if (pathOwner(parsed.path) !== user.id) {
    console.warn('[document-url] refused: user', user.id, 'requested an object owned by', pathOwner(parsed.path));
    return res.status(403).json({ error: 'Forbidden' });
  }

  const key = _t.serviceRoleKey || SUPABASE_ANON_KEY;
  let signResp, signBody;
  try {
    signResp = await fetch(
      `${SUPABASE_URL}/storage/v1/object/sign/${parsed.bucket}/${parsed.path.split('/').map(encodeURIComponent).join('/')}`,
      {
        method: 'POST',
        signal: AbortSignal.timeout(8000),
        headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ expiresIn: SIGN_TTL_SECONDS }),
      },
    );
    signBody = await signResp.text();
  } catch (e) {
    console.error('[document-url] sign request failed:', e && e.message);
    return res.status(502).json({ error: 'Could not reach storage to authorise this document' });
  }

  if (!signResp.ok) {
    // 404 here is the ordinary "the file is gone" case and deserves its own
    // message — a manager should not be told "authorisation failed" when the
    // document simply is not there.
    if (signResp.status === 404) {
      return res.status(404).json({ error: 'That document is no longer in storage.' });
    }
    console.error('[document-url] storage refused to sign:', signResp.status, signBody.slice(0, 200));
    return res.status(502).json({ error: 'Storage could not authorise this document' });
  }

  let signed;
  try { signed = JSON.parse(signBody); } catch (_) { signed = null; }
  // Supabase returns { signedURL: "/object/sign/bucket/path?token=..." }.
  const rel = signed && (signed.signedURL || signed.signedUrl);
  if (!rel) {
    console.error('[document-url] no signedURL in storage response:', signBody.slice(0, 200));
    return res.status(502).json({ error: 'Storage returned no signed URL' });
  }

  const absolute = rel.startsWith('http')
    ? rel
    : `${SUPABASE_URL}/storage/v1${rel.startsWith('/') ? '' : '/'}${rel}`;

  return res.status(200).json({ url: absolute, expiresIn: SIGN_TTL_SECONDS });
};

// Exported for tests — the parsing and ownership rules are the security
// boundary and are worth exercising directly, not only through the handler.
module.exports.parseStoragePath = parseStoragePath;
module.exports.pathOwner        = pathOwner;
module.exports.ALLOWED_BUCKETS  = ALLOWED_BUCKETS;
module.exports.SIGN_TTL_SECONDS = SIGN_TTL_SECONDS;
