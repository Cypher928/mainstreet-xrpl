'use strict';
/**
 * test-membership-authz.js — P0.1: owner OR active organisation member, and a
 * storage path is never a grant.
 *
 *   node test-membership-authz.js
 *
 * Offline. A fake PostgREST transport stands in for the database, so the rule
 * in api/_membership.js and the decision in api/document-url.js are exercised
 * directly, with two organisations and five users:
 *
 *   A   owns PROP_A (organisation ORG_A, admin) and PROP_SOLO (no organisation)
 *   C   ACTIVE member of ORG_A          → may see PROP_A, not PROP_SOLO
 *   D   REVOKED member of ORG_A         → may see nothing of A's
 *   E   INVITED to ORG_A, not accepted  → may see nothing of A's
 *   B   active member of ORG_B only     → may see nothing of A's
 *
 * WHAT IS ASSERTED, AND WHY EACH ONE MATTERS
 *   · the owner probe is the unchanged pre-P0.1 query, issued first — every
 *     existing fixture that answers it keeps working, and an owner costs one read
 *   · membership is consulted only on an owner miss, and only for the
 *     property's OWN organisation, with the accepted/not-revoked filter in the
 *     request itself (not merely in this fake)
 *   · nothing is cached: revoke the row, and the very next call is refused
 *   · every failure — a transport error, a non-2xx, a missing property — is a
 *     refusal, never a pass; a missing membership TABLE degrades to owner-only
 *   · a storage path resolves through the document register and membership;
 *     knowing another user's path, or an organisation's path, grants nothing;
 *     a registered path filed under the WRONG organisation is refused for everyone
 */

const path = require('path');
const { activeOrgIds, propertyAccess, isMemberOfProperty, propertyScope } = require('./api/_membership');
const DU = require('./api/document-url.js');

let pass = 0, fail = 0;
const failures = [];
function t(name, cond, detail) {
  if (cond) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  else { fail++; failures.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail !== undefined ? '  — ' + detail : ''}`); }
}
const eq = (a, b, name) => t(name, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
const sec = (s) => console.log(`\n── ${s} ──`);

// ── The world ──────────────────────────────────────────────────────────────
const A = 'aaaaaaaa-0000-4000-8000-00000000000a';
const B = 'bbbbbbbb-0000-4000-8000-00000000000b';
const C = 'cccccccc-0000-4000-8000-00000000000c';
const D = 'dddddddd-0000-4000-8000-00000000000d';
const E = 'eeeeeeee-0000-4000-8000-00000000000e';
const ORG_A = '0a0a0a0a-0000-4000-8000-0000000000a0';
const ORG_B = '0b0b0b0b-0000-4000-8000-0000000000b0';
const PROP_A    = '11111111-0000-4000-8000-000000000001';
const PROP_SOLO = '22222222-0000-4000-8000-000000000002';
const PROP_B    = '33333333-0000-4000-8000-000000000003';
const DOC_LEGACY   = 'd0000000-0000-4000-8000-000000000001'; // leases/<A>/lease.pdf     on PROP_A
const DOC_ORG      = 'd0000000-0000-4000-8000-000000000002'; // leases/<ORG_A>/abstract.pdf on PROP_A
const DOC_WRONGORG = 'd0000000-0000-4000-8000-000000000003'; // leases/<ORG_B>/stray.pdf on PROP_A (misfiled)
const DOC_SOLO     = 'd0000000-0000-4000-8000-000000000004'; // invoices/<A>/inv.pdf     on PROP_SOLO
const PUB = (p) => `https://x.supabase.co/storage/v1/object/public/${p}`;

function world(over) {
  const o = Object.assign({
    membersTable: true,       // false → PostgREST 404 for organization_members
    probeStatus: 200, orgReadStatus: 200, memberStatus: 200, registerStatus: 200,
    throwOn: null,            // a regex; matching paths throw
    propsColumnKnown: true,   // false → selecting organization_id is a 400 (pre-024 project)
  }, over || {});

  const properties = [
    { id: PROP_A,    user_id: A, organization_id: ORG_A },
    { id: PROP_SOLO, user_id: A, organization_id: null },
    { id: PROP_B,    user_id: B, organization_id: ORG_B },
  ];
  const members = [
    { id: 'm1', organization_id: ORG_A, user_id: A, accepted_at: 't', revoked_at: null },
    { id: 'm2', organization_id: ORG_A, user_id: C, accepted_at: 't', revoked_at: null },
    { id: 'm3', organization_id: ORG_A, user_id: D, accepted_at: 't', revoked_at: 't' },
    { id: 'm4', organization_id: ORG_A, user_id: E, accepted_at: null, revoked_at: null },
    { id: 'm5', organization_id: ORG_B, user_id: B, accepted_at: 't', revoked_at: null },
  ];
  const docs = [
    { id: DOC_LEGACY,   property_id: PROP_A,    file_url: PUB(`leases/${A}/lease.pdf`) },
    { id: DOC_ORG,      property_id: PROP_A,    file_url: `leases/${ORG_A}/abstract.pdf` },
    { id: DOC_WRONGORG, property_id: PROP_A,    file_url: PUB(`leases/${ORG_B}/stray.pdf`) },
    { id: DOC_SOLO,     property_id: PROP_SOLO, file_url: PUB(`invoices/${A}/inv.pdf`) },
    // A LIKE decoy: `_` is a single-character wildcard to LIKE, so a request for
    // `<A>/lease_pdf` matches this row's `<A>/leaseXpdf` as a CANDIDATE. It must
    // not be accepted as the register row for a different object.
    { id: 'd0000000-0000-4000-8000-0000000000de', property_id: PROP_A, file_url: `leases/${A}/leaseXpdf` },
  ];
  const calls = [];
  const dec = decodeURIComponent;
  const q = (p, k) => { const m = p.match(new RegExp('[?&]' + k + '=eq\\.([^&]+)')); return m ? dec(m[1]) : null; };

  const sb = async (p, options) => {
    calls.push({ path: p, method: (options && options.method) || 'GET' });
    if (o.throwOn && o.throwOn.test(p)) throw new Error('boom');

    // owner probe — the pre-P0.1 query, unchanged
    if (/^\/properties\?id=eq\.[^&]+&user_id=eq\.[^&]+&select=id$/.test(p)) {
      if (o.probeStatus >= 300) return { status: o.probeStatus, json: { message: 'x' } };
      const rows = properties.filter(r => r.id === q(p, 'id') && r.user_id === q(p, 'user_id'));
      return { status: 200, json: rows.map(r => ({ id: r.id })) };
    }
    if (/^\/properties\?id=eq\.[^&]+&select=/.test(p)) {
      const sel = p.split('select=')[1];
      if (/organization_id/.test(sel) && !o.propsColumnKnown) {
        return { status: 400, json: { code: '42703', message: 'column properties.organization_id does not exist' } };
      }
      if (o.orgReadStatus >= 300) return { status: o.orgReadStatus, json: { message: 'x' } };
      const rows = properties.filter(r => r.id === q(p, 'id'));
      return { status: 200, json: rows.map(r => {
        const out = {};
        for (const k of sel.split(',')) out[k] = r[k] === undefined ? null : r[k];
        return out;
      }) };
    }
    if (/^\/organization_members\?/.test(p)) {
      if (!o.membersTable) return { status: 404, json: { code: 'PGRST205', message: 'Could not find the table' } };
      if (o.memberStatus >= 300) return { status: o.memberStatus, json: { message: 'x' } };
      // The filter is applied ONLY when the request asks for it. A request that
      // forgot accepted/revoked would see every row — and fail the test.
      let rows = members.slice();
      if (q(p, 'organization_id')) rows = rows.filter(r => r.organization_id === q(p, 'organization_id'));
      if (q(p, 'user_id'))         rows = rows.filter(r => r.user_id === q(p, 'user_id'));
      if (/accepted_at=not\.is\.null/.test(p)) rows = rows.filter(r => r.accepted_at != null);
      if (/revoked_at=is\.null/.test(p))       rows = rows.filter(r => r.revoked_at == null);
      const sel = (p.match(/select=([^&]+)/) || [])[1] || 'id';
      const lim = (p.match(/limit=(\d+)/) || [])[1];
      if (lim) rows = rows.slice(0, Number(lim));
      return { status: 200, json: rows.map(r => { const out = {}; for (const k of sel.split(',')) out[k] = r[k]; return out; }) };
    }
    if (/^\/lease_documents\?/.test(p)) {
      if (o.registerStatus >= 300) return { status: o.registerStatus, json: { message: 'x' } };
      if (q(p, 'id')) return { status: 200, json: docs.filter(d => d.id === q(p, 'id')) };
      const m = p.match(/file_url=like\.\*([^&]+)/);
      const suffix = m ? dec(m[1]) : null;
      // LIKE semantics: `_` is a wildcard. Emulated so a false candidate can appear.
      const re = suffix ? new RegExp(suffix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/_/g, '.') + '$') : null;
      return { status: 200, json: docs.filter(d => re && re.test(d.file_url)) };
    }
    return { status: 404, json: [] };
  };
  sb.calls = calls;
  sb.members = members;
  sb.properties = properties;
  return sb;
}

(async function main() {

sec('A. The owner: one read, the pre-P0.1 probe, unchanged');
{
  const sb = world();
  const r = await propertyAccess(sb, PROP_A, A);
  eq(r, { allowed: true, via: 'owner', organizationId: null }, 'A1 the owner is allowed, as owner');
  eq(sb.calls.length, 1, 'A2 in exactly one read');
  eq(sb.calls[0].path, `/properties?id=eq.${PROP_A}&user_id=eq.${A}&select=id`,
     'A3 which is the exact ownership probe every route issued before P0.1');
  t('A4 and the membership table was never consulted for an owner',
    !sb.calls.some(c => /organization_members/.test(c.path)));
  t('A5 isMemberOfProperty agrees', await isMemberOfProperty(world(), PROP_A, A) === true);
  t('A6 every read is a GET', sb.calls.every(c => c.method === 'GET'));
}

sec('B. An active member of the property\'s organisation');
{
  const sb = world();
  const r = await propertyAccess(sb, PROP_A, C);
  eq(r, { allowed: true, via: 'member', organizationId: ORG_A }, 'B1 C, an active member of ORG_A, may see PROP_A');
  eq(sb.calls.length, 3, 'B2 in three reads: owner probe, the property\'s organisation, the membership row');
  t('B3 the second read asks only for the property\'s organisation',
    /^\/properties\?id=eq\.[^&]+&select=id,organization_id$/.test(sb.calls[1].path), sb.calls[1].path);
  const mem = sb.calls[2].path;
  t('B4 the membership read names the property\'s OWN organisation, not any organisation',
    mem.indexOf(`organization_id=eq.${ORG_A}`) !== -1, mem);
  t('B5 and names the caller', mem.indexOf(`user_id=eq.${C}`) !== -1, mem);
  t('B6 and carries the ACTIVE filter in the request itself: accepted, and not revoked',
    /accepted_at=not\.is\.null/.test(mem) && /revoked_at=is\.null/.test(mem), mem);
  t('B7 every read is a GET', sb.calls.every(c => c.method === 'GET'));

  // Not a member of the property with no organisation, even though A owns both.
  const solo = await propertyAccess(world(), PROP_SOLO, C);
  eq(solo.allowed, false, 'B8 C may NOT see A\'s property that has no organisation — membership is per organisation');
  const sb2 = world();
  await propertyAccess(sb2, PROP_SOLO, C);
  t('B9 and for a property with no organisation, the membership table is never asked',
    !sb2.calls.some(c => /organization_members/.test(c.path)));
}

sec('C. Not a member: invited, revoked, other organisation, nobody');
{
  eq((await propertyAccess(world(), PROP_A, E)).allowed, false, 'C1 E, invited but not accepted, is refused');
  eq((await propertyAccess(world(), PROP_A, D)).allowed, false, 'C2 D, revoked, is refused');
  eq((await propertyAccess(world(), PROP_A, B)).allowed, false, 'C3 B, an active member of a DIFFERENT organisation, is refused');
  eq((await propertyAccess(world(), PROP_B, C)).allowed, false, 'C4 C, active in ORG_A, is refused PROP_B (ORG_B)');
  eq((await propertyAccess(world(), 'ffffffff-0000-4000-8000-00000000000f', C)).allowed, false, 'C5 a property that does not exist is refused');
  eq((await propertyAccess(world(), PROP_A, 'not-a-user')).allowed, false, 'C6 an unknown user is refused');
  const sb = world();
  eq((await propertyAccess(sb, null, C)).allowed, false, 'C7 no property id is refused');
  eq((await propertyAccess(sb, PROP_A, null)).allowed, false, 'C8 no user id is refused');
  eq(sb.calls.length, 0, 'C9 and neither touched the transport');
  eq((await propertyAccess(world(), PROP_A, { id: C })).allowed, false, 'C10 an object is not an identity');
}

sec('D. Revocation is immediate — nothing is cached');
{
  const sb = world();
  eq((await propertyAccess(sb, PROP_A, C)).allowed, true, 'D1 C is allowed');
  const before = sb.calls.length;
  sb.members.find(m => m.user_id === C).revoked_at = 'now';   // the admin revokes C
  eq((await propertyAccess(sb, PROP_A, C)).allowed, false, 'D2 and is refused on the very next call after revocation');
  t('D3 because the membership row was read again, not remembered',
    sb.calls.length > before && sb.calls.slice(before).some(c => /organization_members/.test(c.path)));
  eq((await propertyAccess(sb, PROP_A, C)).allowed, false, 'D4 and stays refused');

  // The other direction: an acceptance takes effect immediately too.
  const sb2 = world();
  eq((await propertyAccess(sb2, PROP_A, E)).allowed, false, 'D5 E, not yet accepted, is refused');
  sb2.members.find(m => m.user_id === E).accepted_at = 'now';
  eq((await propertyAccess(sb2, PROP_A, E)).allowed, true, 'D6 and is admitted on the next call after accepting');
}

sec('E. Fails closed: every error is a refusal; a missing TABLE degrades to owner-only');
{
  eq((await propertyAccess(world({ probeStatus: 500 }), PROP_A, A)).allowed, false, 'E1 a failed owner probe refuses even the owner');
  eq((await propertyAccess(world({ probeStatus: 401 }), PROP_A, A)).allowed, false, 'E2 an auth failure on the probe is a refusal, not a pass');
  eq((await propertyAccess(world({ orgReadStatus: 500 }), PROP_A, C)).allowed, false, 'E3 a failed organisation read refuses a member');
  eq((await propertyAccess(world({ memberStatus: 500 }), PROP_A, C)).allowed, false, 'E4 a failed membership read refuses a member');
  eq((await propertyAccess(world({ throwOn: /organization_members/ }), PROP_A, C)).allowed, false, 'E5 a transport that throws on membership is a refusal');
  eq((await propertyAccess(world({ throwOn: /properties/ }), PROP_A, A)).allowed, false, 'E6 a transport that throws on the probe refuses the owner');

  // The membership table is absent (024 not applied here). Owner-only, silently.
  const noTable = world({ membersTable: false });
  eq((await propertyAccess(noTable, PROP_A, A)).allowed, true, 'E7 without the membership table, the owner keeps access');
  eq((await propertyAccess(noTable, PROP_A, C)).allowed, false, 'E8 and nobody else gains any');
  // The column is absent too (a pre-024 project): the organisation read is a 400.
  const pre024 = world({ membersTable: false, propsColumnKnown: false });
  eq((await propertyAccess(pre024, PROP_A, A)).allowed, true, 'E9 on a pre-024 project the owner is still authorised by the probe alone');
  eq((await propertyAccess(pre024, PROP_A, C)).allowed, false, 'E10 and a would-be member is refused, without an exception');
}

sec('F. activeOrgIds and propertyScope — the portfolio listing');
{
  const sb = world();
  eq(await activeOrgIds(sb, C), { ok: true, orgIds: [ORG_A] }, 'F1 C is active in ORG_A');
  t('F2 read with the ACTIVE filter in the request', /accepted_at=not\.is\.null&revoked_at=is\.null/.test(sb.calls[0].path), sb.calls[0].path);
  eq(await activeOrgIds(world(), D), { ok: true, orgIds: [] }, 'F3 D, revoked, is active nowhere');
  eq(await activeOrgIds(world(), E), { ok: true, orgIds: [] }, 'F4 E, unaccepted, is active nowhere');
  eq(await activeOrgIds(world(), 'junk'), { ok: true, orgIds: [] }, 'F5 a non-uuid user has no memberships, and costs no read');
  eq(await activeOrgIds(world({ membersTable: false }), C), { ok: true, orgIds: [], degraded: 'no_membership_table' },
     'F6 a missing table is reported as degraded, not as an error and not as memberships');
  eq(await activeOrgIds(world({ memberStatus: 500 }), C), { ok: false }, 'F7 a failed read is ok:false — a caller must not treat it as "none"');
  eq(await activeOrgIds(world({ throwOn: /organization_members/ }), C), { ok: false }, 'F8 a throwing transport is ok:false');

  eq(propertyScope(A, []), `user_id=eq.${A}`, 'F9 no memberships → the exact owner-only filter every route used before');
  eq(propertyScope(A, null), `user_id=eq.${A}`, 'F10 null memberships → owner-only');
  eq(propertyScope(C, [ORG_A]), `or=(user_id.eq.${C},organization_id.in.(${ORG_A}))`, 'F11 one membership → owned OR in that organisation');
  eq(propertyScope(C, [ORG_A, ORG_B]), `or=(user_id.eq.${C},organization_id.in.(${ORG_A},${ORG_B}))`, 'F12 several → all of them');
  eq(propertyScope(C, ['not-a-uuid']), `user_id=eq.${C}`, 'F13 a non-uuid organisation id is dropped rather than interpolated into the filter');
}

// ═══════════════════════════════════════════════════════════════════════════
sec('G. document-url: an unregistered path is decided by the SEC-1 rule alone');
{
  const auth = (user, args, over) => DU.authorizeDocument(Object.assign({ sb: world(over), user: { id: user } }, args));
  const own = await auth(A, { ref: `leases/${A}/unregistered.pdf` });
  eq({ bucket: own.bucket, path: own.path, via: own.via }, { bucket: 'leases', path: `${A}/unregistered.pdf`, via: 'owner' },
     'G1 the owner may open an unregistered object under their own uid');
  eq((await auth(C, { ref: `leases/${A}/unregistered.pdf` })).status, 403,
     'G2 an active member may NOT open an unregistered object under a colleague\'s uid — no register row, no grant');
  eq((await auth(B, { ref: `leases/${A}/unregistered.pdf` })).status, 403, 'G3 a stranger who knows the path gets nothing');
  eq((await auth(A, { ref: `leases/${ORG_A}/unregistered.pdf` })).status, 403,
     'G4 an organisation-prefixed path with no register row is refused — even to the organisation\'s admin');
  eq((await auth(C, { ref: `leases/${ORG_A}/unregistered.pdf` })).status, 403, 'G5 and to an active member');
  eq((await auth(A, { ref: `leases/${A}/../${B}/x.pdf` })).status, 400, 'G6 traversal is refused before any lookup');
  eq((await auth(A, { ref: `secrets/${A}/x.pdf` })).status, 400, 'G7 an unknown bucket is refused');
  eq((await auth(A, {})).status, 400, 'G8 no reference at all is a bad request');
  eq((await DU.authorizeDocument({ sb: world(), user: null, ref: `leases/${A}/x.pdf` })).status, 401, 'G9 no user is unauthenticated');
}

sec('H. document-url: a registered path resolves through the property and membership');
{
  const auth = (user, args, over) => DU.authorizeDocument(Object.assign({ sb: world(over), user: { id: user } }, args));
  const legacy = `leases/${A}/lease.pdf`;
  const c = await auth(C, { ref: legacy });
  eq({ via: c.via, documentId: c.documentId, path: c.path }, { via: 'member', documentId: DOC_LEGACY, path: `${A}/lease.pdf` },
     'H1 C, an active member, may open a colleague\'s REGISTERED legacy upload');
  eq((await auth(A, { ref: PUB(legacy) })).via, 'owner', 'H2 the owner still may, from the stored public URL');
  eq((await auth(D, { ref: legacy })).status, 403, 'H3 D, revoked, may not');
  eq((await auth(E, { ref: legacy })).status, 403, 'H4 E, unaccepted, may not');
  eq((await auth(B, { ref: legacy })).status, 403, 'H5 B, another organisation, may not');

  const org = `leases/${ORG_A}/abstract.pdf`;
  eq((await auth(C, { ref: org })).via, 'member', 'H6 C may open a registered organisation-prefixed object');
  eq((await auth(A, { ref: org })).via, 'owner', 'H7 so may the owner, whose uid is not the prefix — the register row and the property\'s organisation say so');
  eq((await auth(D, { ref: org })).status, 403, 'H8 D, revoked, may not');
  eq((await auth(B, { ref: org })).status, 403, 'H9 B may not');

  // Rule 3: the register row says PROP_A (ORG_A); the path claims ORG_B.
  const wrong = `leases/${ORG_B}/stray.pdf`;
  eq((await auth(A, { ref: wrong })).status, 403, 'H10 a registered path filed under the WRONG organisation is refused to the owner');
  eq((await auth(C, { ref: wrong })).status, 403, 'H11 and to an active member');
  eq((await auth(B, { ref: wrong })).status, 403, 'H12 and to a member of the organisation the path names — the row\'s property is not theirs');

  // A LIKE near-match is a candidate, never an answer. The register holds
  // `<A>/leaseXpdf` on PROP_A; C asks for `<A>/lease_pdf`, a DIFFERENT object
  // of A's that is not registered. If the candidate were accepted without
  // re-parsing, C would be minted a URL for an object no row grants.
  const near = await auth(C, { ref: `leases/${A}/lease_pdf` });
  eq(near.status, 403, 'H12b a LIKE wildcard near-match in the register does not authorise a different object');
  const nearOwn = await auth(A, { ref: `leases/${A}/lease_pdf` });
  eq(nearOwn.documentId, null, 'H12c and for the owner it resolves as UNREGISTERED (own-uid rule), not as the decoy row');

  // Register read failure: refusal, not fallback to the uid rule.
  const r = await auth(A, { ref: legacy }, { registerStatus: 500 });
  eq(r.status, 502, 'H13 a failed register read refuses even the owner — it does not fall back to the prefix');
  const thr = await auth(A, { ref: legacy }, { throwOn: /lease_documents/ });
  eq(thr.status, 502, 'H14 a throwing register read likewise');

  // Revocation through the document gate, immediately.
  const sb = world();
  eq((await DU.authorizeDocument({ sb, user: { id: C }, ref: legacy })).via, 'member', 'H15 C may open the document');
  sb.members.find(m => m.user_id === C).revoked_at = 'now';
  eq((await DU.authorizeDocument({ sb, user: { id: C }, ref: legacy })).status, 403, 'H16 and is refused on the next request after revocation');
}

sec('I. document-url: by register id — the path comes from the row, not the caller');
{
  const auth = (user, args, over) => DU.authorizeDocument(Object.assign({ sb: world(over), user: { id: user } }, args));
  const a = await auth(A, { documentId: DOC_LEGACY });
  eq({ bucket: a.bucket, path: a.path, via: a.via }, { bucket: 'leases', path: `${A}/lease.pdf`, via: 'owner' }, 'I1 the owner, by id');
  eq((await auth(C, { documentId: DOC_LEGACY })).via, 'member', 'I2 an active member, by id');
  eq((await auth(C, { documentId: DOC_ORG })).path, `${ORG_A}/abstract.pdf`, 'I3 an organisation-prefixed row, by id');
  eq((await auth(D, { documentId: DOC_LEGACY })).status, 403, 'I4 revoked → 403');
  eq((await auth(E, { documentId: DOC_LEGACY })).status, 403, 'I5 unaccepted → 403');
  eq((await auth(B, { documentId: DOC_LEGACY })).status, 403, 'I6 other organisation → 403');
  eq((await auth(C, { documentId: DOC_SOLO })).status, 403, 'I7 a document on A\'s organisation-less property → 403 for C');
  eq((await auth(A, { documentId: DOC_WRONGORG })).status, 403, 'I8 a misfiled row (wrong organisation prefix) → 403 even by id, even for the owner');
  eq((await auth(A, { documentId: 'd0000000-0000-4000-8000-0000000000ff' })).status, 404, 'I9 an unknown id → 404');
  eq((await auth(A, { documentId: 'nope' })).status, 400, 'I10 a malformed id → 400');
  eq((await auth(A, { documentId: DOC_LEGACY }, { registerStatus: 503 })).status, 502, 'I11 a failed register read → 502, no path');
  // documentId wins over ref: the caller's ref cannot redirect a by-id request.
  const both = await auth(C, { documentId: DOC_LEGACY, ref: `leases/${B}/other.pdf` });
  eq(both.path, `${A}/lease.pdf`, 'I12 when both are supplied the row\'s path is used, never the caller\'s');
}

sec('J. Nothing here writes');
{
  const sb = world();
  await propertyAccess(sb, PROP_A, C);
  await activeOrgIds(sb, C);
  await DU.authorizeDocument({ sb, user: { id: C }, ref: `leases/${A}/lease.pdf` });
  await DU.authorizeDocument({ sb, user: { id: C }, documentId: DOC_ORG });
  t('J1 every request across the rule and the document gate is a GET (' + sb.calls.length + ' reads)',
    sb.calls.length > 0 && sb.calls.every(c => c.method === 'GET'));
  const tables = Array.from(new Set(sb.calls.map(c => c.path.split('?')[0]))).sort();
  eq(tables, ['/lease_documents', '/organization_members', '/properties'], 'J2 and only three tables are ever read');
}

console.log('\n' + '─'.repeat(58));
if (fail) {
  console.log(`\x1b[31mRESULT: ${pass} passed, ${fail} failed\x1b[0m`);
  failures.forEach(f => console.log(`  · ${f}`));
  process.exit(1);
}
console.log(`\x1b[32mRESULT: ${pass} passed, 0 failed\x1b[0m`);
})().catch(e => { console.error(e); process.exit(1); });
