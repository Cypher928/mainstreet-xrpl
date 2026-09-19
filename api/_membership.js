'use strict';
/**
 * api/_membership.js — P0.1: may this user see this property?
 *
 * ONE ANSWER FOR EVERY ROUTE. Six API files each carried their own copy of
 * "does this user own this property" as a PostgREST query with
 * `user_id=eq.<uid>` in it. Organisations change the question from ownership
 * to membership, and a rule that lives in six places is a rule that will be
 * updated in five. This module is the sixth-and-only place.
 *
 * THE RULE
 *   A user may see a property when they OWN it (properties.user_id), or when
 *   they are an ACTIVE MEMBER (accepted_at set, revoked_at null) of the
 *   property's organisation. Same rule as public.is_member_of_property() in
 *   migration 024 — the database enforces it for direct reads; this module
 *   enforces it for the service-role transport the API routes use, which
 *   bypasses RLS.
 *
 * REVOCATION IS IMMEDIATE. Nothing here is cached. Every call reads the
 * membership row at that moment, so a revoked member is refused on the next
 * request, not the next session.
 *
 * FAILS CLOSED, AND DEGRADES TO OWNER-ONLY. Any read that errors answers
 * "not a member". A missing organization_members table — the migration not
 * yet applied to this project — answers "no memberships" rather than
 * throwing, so a property's owner keeps access and nobody else gains any.
 * That is the rule migration 010 set for absent columns, applied here: the
 * code must be safe to run ahead of its migration.
 *
 * THE OWNER FAST PATH IS THE OLD QUERY, ON PURPOSE. The first read is the
 * exact `id=eq.&user_id=eq.&select=id` probe every route made before, so an
 * owner is authorised in one round trip and every existing fixture that
 * answers that probe keeps working. Membership is consulted only on an owner
 * miss.
 *
 * TRANSPORT IS INJECTED. `sb(pathAndQuery, options)` → `{ status, json }`, the
 * same shape as every route's sbFetch and the MCP layer's _defaultFetch. No
 * socket is opened here, which is what makes the rule testable without one.
 */

const _enc = encodeURIComponent;

/** PostgREST reports a missing relation as 404 or one of these codes. */
function _tableMissing(res) {
  if (!res) return false;
  if (res.status === 404) return true;
  const j = res.json;
  const obj = Array.isArray(j) ? (j[0] || {}) : (j || {});
  const code = String(obj.code || '');
  const msg  = String(obj.message || obj.error || obj.raw || '').toLowerCase();
  return code === '42P01' || code === 'PGRST205' || (msg.includes('relation') && msg.includes('does not exist'));
}

const _uuid = (v) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/**
 * The organisations this user is an active member of, right now.
 *
 * @returns {{ ok: true, orgIds: string[], degraded?: string } | { ok: false }}
 *   ok:false means the read FAILED (not "no memberships") — callers must
 *   treat it as "cannot establish membership" and fail closed for anything
 *   that depends on it.
 */
async function activeOrgIds(sb, userId) {
  if (!_uuid(userId)) return { ok: true, orgIds: [] };
  let r;
  try {
    r = await sb(
      `/organization_members?user_id=eq.${_enc(userId)}` +
      `&accepted_at=not.is.null&revoked_at=is.null&select=organization_id`,
      { method: 'GET' });
  } catch (_) {
    return { ok: false };
  }
  if (_tableMissing(r)) return { ok: true, orgIds: [], degraded: 'no_membership_table' };
  if (!r || r.status >= 300) return { ok: false };
  const rows = Array.isArray(r.json) ? r.json : [];
  const ids = rows.map(x => x && x.organization_id).filter(_uuid);
  return { ok: true, orgIds: Array.from(new Set(ids)) };
}

/**
 * Owner, or active member? With enough about HOW for a caller that needs it
 * (document-url compares an org-prefixed storage path to organizationId).
 *
 * @returns {{ allowed: boolean, via: 'owner'|'member'|null, organizationId: string|null }}
 */
async function propertyAccess(sb, propertyId, userId) {
  const NO = { allowed: false, via: null, organizationId: null };
  if (!_uuid(propertyId) && typeof propertyId !== 'string') return NO;
  if (!userId || typeof userId !== 'string') return NO;

  // 1. Owner — the pre-024 probe, unchanged.
  let own;
  try {
    own = await sb(
      `/properties?id=eq.${_enc(propertyId)}&user_id=eq.${_enc(userId)}&select=id`,
      { method: 'GET', headers: { 'Prefer': '' } });
  } catch (_) { return NO; }
  if (own && own.status < 300 && Array.isArray(own.json) && own.json.length > 0) {
    return { allowed: true, via: 'owner', organizationId: null };
  }
  if (!own || own.status >= 300) return NO;          // a failed read is not a "no", but it is not a "yes"

  // 2. The property's organisation, if the column exists.
  let prop;
  try {
    prop = await sb(
      `/properties?id=eq.${_enc(propertyId)}&select=id,organization_id`,
      { method: 'GET', headers: { 'Prefer': '' } });
  } catch (_) { return NO; }
  if (!prop || prop.status >= 300) return NO;        // includes a pre-024 project: the column is unknown → 400
  const row = Array.isArray(prop.json) ? prop.json[0] : null;
  const orgId = row && row.organization_id;
  if (!_uuid(orgId)) return NO;

  // 3. A live membership row for THIS org, read now.
  let mem;
  try {
    mem = await sb(
      `/organization_members?organization_id=eq.${_enc(orgId)}&user_id=eq.${_enc(userId)}` +
      `&accepted_at=not.is.null&revoked_at=is.null&select=id&limit=1`,
      { method: 'GET', headers: { 'Prefer': '' } });
  } catch (_) { return NO; }
  if (_tableMissing(mem) || !mem || mem.status >= 300) return NO;
  const active = Array.isArray(mem.json) && mem.json.length > 0;
  return active ? { allowed: true, via: 'member', organizationId: orgId } : NO;
}

/** The boolean most routes want. */
async function isMemberOfProperty(sb, propertyId, userId) {
  return (await propertyAccess(sb, propertyId, userId)).allowed;
}

/**
 * The PostgREST filter that scopes a /properties read to what this user may
 * see. Owner-only when there are no memberships, so a pre-024 project and
 * every existing fixture see exactly the query they saw before.
 */
function propertyScope(userId, orgIds) {
  const ids = (orgIds || []).filter(_uuid);
  if (!ids.length) return `user_id=eq.${_enc(userId)}`;
  return `or=(user_id.eq.${_enc(userId)},organization_id.in.(${ids.map(_enc).join(',')}))`;
}

module.exports = { activeOrgIds, propertyAccess, isMemberOfProperty, propertyScope, _tableMissing };
