// api/document-url.js — SEC-1 + P0.1: a short-lived, authorisation-checked URL for a stored document.
// ============================================================================
// The `leases` and `invoices` buckets are private. A stored object's URL cannot
// be known at render time; the client asks for one at the moment it needs it,
// the server checks that the caller may see the document, and Supabase mints a
// signed URL that expires.
//
// ── THE RULE, P0.1 ───────────────────────────────────────────────────────────
// A storage path is an ADDRESS. It is never, on its own, a grant. Access must
// resolve through a record the caller is allowed to see:
//
//   1. If the path belongs to a row in the document register (lease_documents),
//      the caller must be the owner or an active organisation member of that
//      row's property (api/_membership.js). The prefix shape does not matter.
//   2. If NO register row exists, the pre-P0.1 rule applies unchanged: the
//      first path segment must equal the caller's OWN uid. There is no
//      cross-user grant on the uid shape, and an org-prefixed path with no row
//      is refused outright — knowing or guessing a path yields nothing.
//   3. An org-prefixed path must also NAME THE PROPERTY'S ORGANISATION. A row
//      whose property sits in organisation X does not authorise a path claiming
//      organisation Y, whoever the caller is.
//
// The URL is minted with the service role, so storage RLS does not protect
// it — this handler IS the gate, and it fails closed: any read that errors is
// a refusal. Storage RLS (migration 024) remains the independent second layer
// for direct access with a user token.
//
// ── TWO WAYS TO ASK ─────────────────────────────────────────────────────────
//   { documentId }            the register row's id — the preferred form going
//                             forward; the path comes from the row, not the caller
//   { ref | fileUrl | path }  what existing rows and records hold — a public URL
//                             from before SEC-1, a signed URL, or a bare path.
//                             Parsed, then resolved to a register row where one
//                             exists.
//
// REVOCATION. Membership is read on every request; a revoked member is refused
// on the next call. A URL already minted lives for SIGN_TTL_SECONDS (300) —
// that is the one window, and it is the reason the TTL is short.
'use strict';

const { checkRate, sendRateLimited } = require('./_rate-limit');
const _t = require('./_pilot-target');
const { propertyAccess } = require('./_membership');

const SUPABASE_URL      = _t.url;
const SUPABASE_ANON_KEY = _t.anonKey;
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error('[api/document-url] Supabase URL/anon not configured for ' + _t.name + ' target');
}

const ALLOWED_BUCKETS = ['leases', 'invoices'];

// Short. A signed URL is handed out per view; it does not need to outlive the
// page that asked for it, and a leaked one should die quickly.
const SIGN_TTL_SECONDS = 300;

const _UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function _key() { return _t.serviceRoleKey || SUPABASE_ANON_KEY; }

async function _verifyUser(req, res) {
  const tok = (req.headers['authorization'] || '').replace(/^Bearer\s+/, '');
  if (!tok) { res.status(401).json({ error: 'Authentication required' }); return null; }
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      signal: AbortSignal.timeout(3000),
      headers: { apikey: _key().trim(), Authorization: `Bearer ${tok}` },
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

/** PostgREST transport, service role. Same shape as every other route's sbFetch. */
async function _defaultSb(path, options = {}) {
  const k = _key();
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    signal: AbortSignal.timeout(8000),
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'apikey': k, 'Authorization': `Bearer ${k}`, 'Prefer': '',
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, json };
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

/** The first path segment — an address, not a grant. */
function pathOwner(path) {
  const first = String(path || '').split('/')[0];
  return first || null;
}

/**
 * Find the register row for a bucket/path, if there is one.
 *
 * file_url may hold a full pre-SEC-1 public URL or a bare path, so the match
 * is by suffix and then CONFIRMED by re-parsing each candidate — a LIKE match
 * is a candidate, never an answer (an `_` in a filename is a wildcard to LIKE).
 */
async function _registerRowForPath(sb, bucket, path) {
  let r;
  try {
    r = await sb(
      `/lease_documents?file_url=like.*${encodeURIComponent(path)}&select=id,property_id,file_url&limit=10`,
      { method: 'GET' });
  } catch (_) { return { ok: false, row: null }; }
  if (!r || r.status >= 300) return { ok: false, row: null };
  const rows = Array.isArray(r.json) ? r.json : [];
  const hit = rows.find(x => {
    const p = parseStoragePath(x && x.file_url);
    return p && p.bucket === bucket && p.path === path;
  });
  return { ok: true, row: hit || null };
}

/**
 * THE DECISION. Pure with respect to HTTP: takes the caller and the request,
 * returns either { bucket, path } to mint or { status, error } to send.
 * Exported so the rule is tested directly, without a socket.
 */
async function authorizeDocument({ sb, user, documentId, ref }) {
  const uid = user && user.id;
  if (!uid) return { status: 401, error: 'Authentication required' };

  // ── Form 1: by register id ─────────────────────────────────────────────
  if (documentId != null) {
    if (!_UUID.test(String(documentId))) return { status: 400, error: 'Invalid document id' };
    let r;
    try {
      r = await sb(`/lease_documents?id=eq.${encodeURIComponent(documentId)}&select=id,property_id,file_url`,
                   { method: 'GET' });
    } catch (_) { return { status: 502, error: 'Could not read the document register' }; }
    if (!r || r.status >= 300) return { status: 502, error: 'Could not read the document register' };
    const row = Array.isArray(r.json) ? r.json[0] : null;
    if (!row) return { status: 404, error: 'No such document' };
    const parsed = parseStoragePath(row.file_url);
    if (!parsed) return { status: 404, error: 'That document has no stored file' };
    const access = await propertyAccess(sb, row.property_id, uid);
    if (!access.allowed) return { status: 403, error: 'Forbidden' };
    if (!(await _prefixPermitted(sb, parsed.path, uid, access, row.property_id))) {
      return { status: 403, error: 'Forbidden' };
    }
    return { bucket: parsed.bucket, path: parsed.path, via: access.via, documentId: row.id };
  }

  // ── Form 2: by reference ───────────────────────────────────────────────
  const parsed = parseStoragePath(ref);
  if (!parsed) return { status: 400, error: 'Missing or unrecognised document reference' };

  const reg = await _registerRowForPath(sb, parsed.bucket, parsed.path);
  if (!reg.ok) return { status: 502, error: 'Could not read the document register' };

  if (reg.row) {
    // Rule 1 — a registered document: membership on its property decides.
    const access = await propertyAccess(sb, reg.row.property_id, uid);
    if (!access.allowed) return { status: 403, error: 'Forbidden' };
    if (!(await _prefixPermitted(sb, parsed.path, uid, access, reg.row.property_id))) {
      return { status: 403, error: 'Forbidden' };
    }
    return { bucket: parsed.bucket, path: parsed.path, via: access.via, documentId: reg.row.id };
  }

  // Rule 2 — no register row: the SEC-1 rule, unchanged. Own uid only.
  if (pathOwner(parsed.path) === uid) {
    return { bucket: parsed.bucket, path: parsed.path, via: 'owner', documentId: null };
  }
  console.warn('[document-url] refused: user', uid, 'requested an unregistered object under prefix', pathOwner(parsed.path));
  return { status: 403, error: 'Forbidden' };
}

/**
 * Rule 3. A registered path may sit under exactly three prefixes:
 *
 *   · the caller's own uid              (their upload, legacy shape)
 *   · the property owner's uid          (a colleague's legacy upload — the
 *                                        register row + membership granted it)
 *   · the property's organisation id    (the P0.1 shape)
 *
 * Anything else is refused — most importantly a path naming an organisation
 * the property is NOT in. A register row for property P never authorises an
 * object filed under some other organisation's prefix, whoever asks.
 *
 * The first two answers are free; the third costs one read of the property
 * row, made only when the cheap checks fail. A failed read is a refusal.
 * On a project without migration 024 the organization_id column is unknown
 * and the read is retried without it, so the legacy shapes still resolve.
 */
async function _prefixPermitted(sb, path, uid, access, propertyId) {
  const first = pathOwner(path);
  if (!first) return false;
  if (first === uid) return true;
  if (access && access.organizationId && first === access.organizationId) return true;

  const read = async (select) => {
    let r;
    try {
      r = await sb(`/properties?id=eq.${encodeURIComponent(propertyId)}&select=${select}`, { method: 'GET' });
    } catch (_) { return null; }
    if (!r || r.status >= 300) return null;
    return Array.isArray(r.json) ? (r.json[0] || null) : null;
  };
  let row = await read('id,user_id,organization_id');
  if (!row) row = await read('id,user_id');
  if (!row) return false;
  if (row.user_id && first === row.user_id) return true;
  if (row.organization_id && first === row.organization_id) return true;
  return false;
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

  const { documentId, ref, fileUrl, path: rawPath } = req.body || {};
  const decision = await authorizeDocument({
    sb: _defaultSb, user, documentId, ref: ref || fileUrl || rawPath,
  });
  if (decision.status) return res.status(decision.status).json({ error: decision.error });

  const key = _key();
  let signResp, signBody;
  try {
    signResp = await fetch(
      `${SUPABASE_URL}/storage/v1/object/sign/${decision.bucket}/${decision.path.split('/').map(encodeURIComponent).join('/')}`,
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

// Exported for tests — the parsing and authorisation rules are the security
// boundary and are worth exercising directly, not only through the handler.
module.exports.parseStoragePath  = parseStoragePath;
module.exports.pathOwner         = pathOwner;
module.exports.authorizeDocument = authorizeDocument;
module.exports.ALLOWED_BUCKETS   = ALLOWED_BUCKETS;
module.exports.SIGN_TTL_SECONDS  = SIGN_TTL_SECONDS;
