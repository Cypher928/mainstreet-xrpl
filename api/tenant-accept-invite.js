// api/tenant-accept-invite.js — Phase B1: redeem a tenant invitation.
// ============================================================================
// This endpoint exists so that TENANTS NEVER NEED WRITE ACCESS TO tenant_users.
//
// Phase A established that membership is the authorization source of truth: a
// tenant who can insert or update tenant_users can grant itself any space in
// the pilot. Its RLS proves that door is shut (T11: a well-formed self-grant is
// refused with 42501). But it also left a real gap — a tenant could not accept
// their own invitation either, and the attempt failed SILENTLY at 0 rows.
//
// The obvious fix, a narrow tenant UPDATE policy on accepted_at, reopens the
// door it took Phase A to close: policies constrain columns, not intent, and an
// UPDATE path is one mis-written predicate away from a self-grant. So the
// authority lives in the invitation instead. The landlord issues a single-use
// token; the tenant presents it here; this endpoint — and only this endpoint —
// writes the membership, with the service role.
//
// ── WHAT IS CHECKED, IN ORDER ───────────────────────────────────────────────
//   1. caller is authenticated               (a token alone is not enough)
//   2. token hashes to an OPEN invitation    (not accepted, not revoked)
//   3. invitation has not expired
//   4. the invited email matches the caller  (a leaked link is not a login)
//   5. the tenant/property pair still exists (FK, enforced by the database)
//
// Failing any of these returns the SAME opaque error. An endpoint that says
// "expired" versus "no such invitation" is an oracle for probing which tokens
// existed; there is no legitimate caller who benefits from the distinction.
//
// ── WHAT THIS ENDPOINT WILL NOT DO ──────────────────────────────────────────
// It will not create the auth user, and it will not authenticate anyone. Both
// stay with Supabase Auth. The tenant is signed in BEFORE calling this, and the
// route only binds an already-authenticated identity to a tenant space.
//
// Tenants authenticate by magic link (portal.js requestLink), so there is no
// tenant password anywhere in this flow — which is why the endpoint can be this
// small. It never sees, sets or verifies a credential; it verifies a token that
// grants membership, and nothing else.
//
// The magic-link redirect carries the invite token back through email, so by the
// time this route is called the caller holds both a real session and the token.
// Checking the invited email against the session email is what stops a forwarded
// link from becoming someone else's access.
'use strict';

const crypto = require('crypto');
const { checkRate, sendRateLimited } = require('./_rate-limit');
const _t = require('./_pilot-target');

const SUPABASE_URL      = _t.url;
const SUPABASE_ANON_KEY = _t.anonKey;
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error('[api/tenant-accept-invite] Supabase URL/anon not configured for ' + _t.name + ' target');
}

// Writing a membership row is precisely what RLS forbids the caller to do, so
// this route is only correct with the service role. Refuse rather than fall
// back to the anon key and fail confusingly at the database.
function serviceKey(res) {
  if (!_t.serviceRoleKey) {
    res.status(503).json({ error: 'Invitation service unavailable' });
    return null;
  }
  return _t.serviceRoleKey.trim();
}

async function sbFetch(path, opts = {}, key) {
  return fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...opts,
    signal: AbortSignal.timeout(5000),
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
}

async function verifyUser(req, res) {
  const tok = (req.headers['authorization'] || '').replace(/^Bearer\s+/, '');
  if (!tok) { res.status(401).json({ error: 'Sign in to accept this invitation' }); return null; }
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      signal: AbortSignal.timeout(3000),
      headers: { apikey: (_t.serviceRoleKey || SUPABASE_ANON_KEY).trim(), Authorization: `Bearer ${tok}` },
    });
    if (!r.ok) { res.status(401).json({ error: 'Invalid or expired session' }); return null; }
    const user = await r.json();
    if (!user?.id) { res.status(401).json({ error: 'User identity missing' }); return null; }
    return user;
  } catch (e) {
    const timedOut = e?.name === 'TimeoutError' || e?.name === 'AbortError';
    res.status(timedOut ? 503 : 500).json({ error: timedOut ? 'Auth service unavailable — try again' : 'Auth check failed' });
    return null;
  }
}

// One opaque failure for every rejected redemption. See the header.
function refuse(res) {
  return res.status(400).json({ error: 'This invitation is not valid. Ask your property manager to send a new one.' });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Token redemption is a guessing target. Brake it harder than a normal read.
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  const verdict = checkRate(`accept-invite:${ip}`, 10, 60_000);
  if (!verdict.ok) return sendRateLimited(res, verdict);

  const user = await verifyUser(req, res);
  if (!user) return;

  const key = serviceKey(res);
  if (!key) return;

  const token = (req.body && req.body.token) || '';
  if (typeof token !== 'string' || token.length < 32 || token.length > 256) return refuse(res);

  // The raw token is never stored; only this hash is comparable.
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

  try {
    const lookup = await sbFetch(
      `/tenant_invitations?token_hash=eq.${encodeURIComponent(tokenHash)}` +
      `&accepted_at=is.null&revoked_at=is.null` +
      `&select=id,tenant_id,property_id,email,expires_at`,
      { method: 'GET' }, key
    );
    if (!lookup.ok) return res.status(502).json({ error: 'Invitation lookup failed' });

    const rows = await lookup.json().catch(() => []);
    const inv  = Array.isArray(rows) ? rows[0] : null;
    if (!inv) return refuse(res);

    if (new Date(inv.expires_at).getTime() <= Date.now()) return refuse(res);

    // A forwarded invitation link must not become someone else's access.
    const invitedEmail = String(inv.email || '').trim().toLowerCase();
    const callerEmail  = String(user.email || '').trim().toLowerCase();
    if (!invitedEmail || invitedEmail !== callerEmail) return refuse(res);

    // Membership first. If this fails the invitation stays open and the tenant
    // can retry; the reverse order would burn the token and strand them.
    const membership = await sbFetch('/tenant_users', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      // revoked_at is set EXPLICITLY, and that is load-bearing on the
      // re-invitation path. `resolution=merge-duplicates` becomes ON CONFLICT
      // (user_id, tenant_id) DO UPDATE SET ... for the columns present in this
      // payload and no others, so omitting revoked_at leaves a previously
      // revoked row revoked: the tenant redeems a valid invitation, gets 200,
      // and still reads nothing, because tenant_ids_for_current_user() filters
      // on revoked_at. Accepting a landlord-issued invitation IS the authority
      // to restore access, so clearing it here is the correct semantics.
      // Asserted by T17/T18 in test-tenant-authz.js.
      body: JSON.stringify({
        user_id:     user.id,
        tenant_id:   inv.tenant_id,
        property_id: inv.property_id,
        accepted_at: new Date().toISOString(),
        revoked_at:  null,
        invited_by:  null,
      }),
    }, key);

    if (!membership.ok) {
      const detail = await membership.text().catch(() => '');
      console.error('[tenant-accept-invite] membership insert failed', membership.status, detail.slice(0, 300));
      return res.status(502).json({ error: 'Could not complete the invitation. Try again.' });
    }

    // Single use. Conditioned on still being open, so two concurrent redemptions
    // cannot both mark it accepted.
    const close = await sbFetch(
      `/tenant_invitations?id=eq.${encodeURIComponent(inv.id)}&accepted_at=is.null&revoked_at=is.null`,
      {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ accepted_at: new Date().toISOString(), accepted_by: user.id }),
      }, key
    );
    if (!close.ok) {
      console.error('[tenant-accept-invite] invitation not closed', close.status);
      // The membership exists and is the thing that grants access; report success.
    }

    return res.status(200).json({ ok: true, tenantId: inv.tenant_id });
  } catch (e) {
    const timedOut = e?.name === 'TimeoutError' || e?.name === 'AbortError';
    console.error('[tenant-accept-invite]', e?.message);
    return res.status(timedOut ? 503 : 500).json({ error: timedOut ? 'Service unavailable — try again' : 'Could not complete the invitation' });
  }
};
