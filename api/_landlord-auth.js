// api/_landlord-auth.js — shared caller verification for B2 publish routes.
// ============================================================================
// Three endpoints publish into a tenant projection, and all three need the same
// two facts established before they touch anything: who is calling, and whether
// they own the property they are naming. Getting that wrong on any one of them
// is a cross-landlord write, so it lives in one place rather than three.
//
// The caller's identity comes from the bearer token, never from the body. A
// request may say property_id; it may not say who it is.
'use strict';

const _t = require('./_pilot-target');

const SUPABASE_URL = _t.url;
const ANON_KEY     = _t.anonKey;

function serviceKey(res) {
  if (!_t.serviceRoleKey) {
    res.status(503).json({ error: 'Publishing is unavailable' });
    return null;
  }
  return _t.serviceRoleKey.trim();
}

async function sbFetch(path, opts, key) {
  return fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...(opts || {}),
    signal: AbortSignal.timeout(6000),
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...((opts && opts.headers) || {}),
    },
  });
}

/** Resolve the bearer token to a user, or answer and return null. */
async function currentUser(req, res) {
  const tok = (req.headers['authorization'] || '').replace(/^Bearer\s+/, '');
  if (!tok) { res.status(401).json({ error: 'Sign in to publish' }); return null; }
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      signal: AbortSignal.timeout(4000),
      headers: { apikey: (_t.serviceRoleKey || ANON_KEY).trim(), Authorization: `Bearer ${tok}` },
    });
    if (!r.ok) { res.status(401).json({ error: 'Invalid or expired session' }); return null; }
    const u = await r.json();
    if (!u || !u.id) { res.status(401).json({ error: 'User identity missing' }); return null; }
    return u;
  } catch (e) {
    const timedOut = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
    res.status(timedOut ? 503 : 500).json({ error: timedOut ? 'Auth service unavailable — try again' : 'Auth check failed' });
    return null;
  }
}

/**
 * Check 4 — the caller owns the property. This is the authorization decision;
 * everything the endpoints do afterwards is correctness, not access control.
 * Returns the property row, or answers and returns null.
 */
async function ownedProperty(res, key, propertyId, userId) {
  const r = await sbFetch(
    `/properties?id=eq.${encodeURIComponent(propertyId)}&select=id,user_id,name,data,updated_at`,
    { method: 'GET' }, key);
  if (!r.ok) { res.status(502).json({ error: 'Could not load the property' }); return null; }
  const rows = await r.json().catch(() => []);
  const prop = Array.isArray(rows) ? rows[0] : null;
  // Same answer for "does not exist" and "not yours": a landlord has no reason
  // to learn which property ids belong to someone else.
  if (!prop || prop.user_id !== userId) {
    res.status(403).json({ error: 'You do not have access to that property' });
    return null;
  }
  return prop;
}

/**
 * Check 5 — the tenant belongs to that property. The pair is verified together,
 * so a real tenant id from a DIFFERENT property fails here rather than becoming
 * a cross-property publish.
 */
async function tenantOnProperty(res, key, tenantId, propertyId) {
  const r = await sbFetch(
    `/tenants?id=eq.${encodeURIComponent(tenantId)}&property_id=eq.${encodeURIComponent(propertyId)}` +
    `&select=id,property_id,name,sqft,lease_type,start_date,end_date`,
    { method: 'GET' }, key);
  if (!r.ok) { res.status(502).json({ error: 'Could not load the tenant' }); return null; }
  const rows = await r.json().catch(() => []);
  const t = Array.isArray(rows) ? rows[0] : null;
  if (!t) { res.status(400).json({ error: 'That tenant is not on that property' }); return null; }
  return t;
}

/**
 * Check 3 — reject anything the client should not be sending. Amounts, status,
 * versions and timestamps are all derived server-side; a request that supplies
 * one is refused rather than silently ignored, so tampering is loud.
 */
function rejectUnexpectedFields(res, body, allowed) {
  const keys = Object.keys(body || {});
  const extra = keys.filter((k) => !allowed.includes(k));
  if (extra.length) {
    res.status(400).json({
      error: 'Unexpected field in request: ' + extra.join(', ') +
             '. Amounts and publication state are derived server-side.',
    });
    return false;
  }
  return true;
}

module.exports = {
  SUPABASE_URL, serviceKey, sbFetch, currentUser,
  ownedProperty, tenantOnProperty, rejectUnexpectedFields,
};
