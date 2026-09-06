'use strict';
/**
 * api/_mcp-capabilities.js — the first three read-only capabilities another
 * system may ask MainStreet for.
 *
 * MODULE ONLY. There is no transport here: no HTTP route, no MCP server, no
 * socket. It exports tool descriptors and handlers so a transport can mount
 * them once one is approved. Nothing in this file writes, anywhere.
 *
 * ── THE ONE THING THIS FILE EXISTS TO GET RIGHT ─────────────────────────────
 *
 * An MCP client asks "does this property have any disputes?". If MainStreet
 * could not load the module that composes disputes, the answer must not be
 * "no". A verified-memory system that reports absence of evidence as evidence
 * of absence is worse than one that says nothing, because the caller cannot
 * tell the two apart and will act on the wrong one.
 *
 * So every section of every answer carries a status, and four cases stay
 * distinct all the way to the caller:
 *
 *   ok           composed, and it has content
 *   empty        composed, the source was present, and there genuinely are none
 *   unavailable  could NOT be composed, or the source was never there
 *   degraded     composed, but from fewer inputs than the browser would use
 *
 * `unavailable` is returned as null and never as []. That is not a style
 * preference. `[]` is an answer; null plus a caveat is a refusal to answer.
 *
 * ── WHAT AUTHORISES A CALLER ────────────────────────────────────────────────
 *
 * A bearer token, and nothing else. These handlers take a `token` and resolve
 * the user from it server-side; there is deliberately NO userId parameter,
 * because a parameter is something a caller can supply.
 *
 * Only `user.id` is read from the auth response. Not `role`, not
 * `app_metadata`, not `user_metadata` — in Supabase user_metadata is writable
 * by the user it describes, so authorising from it would let a caller grant
 * itself whatever it liked.
 *
 * Ownership is `properties.user_id = <the authenticated user>`, and that is the
 * only ownership there is here. MainStreet has a SECOND identity space —
 * tenant_users (migration 012) links an auth user to a tenant space and carries
 * a property_id — and a tenant-portal user therefore holds a perfectly valid
 * session for a property they do not own. They get an empty portfolio and a
 * refusal, which is the whole point: a tenant identity must never quietly
 * become a landlord's portfolio.
 *
 * Service-role credentials are TRANSPORT, exactly as everywhere else in api/,
 * and never a substitute for the check.
 */

const _t   = require('./_pilot-target');
const HYD  = require('./_property-record-hydrator.js');

const SUPABASE_URL      = _t.url;
const SUPABASE_ANON_KEY = _t.anonKey;

/** Transport credential. Service role when configured, as api/ does. */
function _key() { return _t.serviceRoleKey || SUPABASE_ANON_KEY; }

// ── Refusals ───────────────────────────────────────────────────────────────
const REFUSAL = {
  NO_TOKEN:        'authentication_required',
  BAD_TOKEN:       'invalid_or_expired_token',
  NO_IDENTITY:     'user_identity_missing',
  AUTH_UNAVAILABLE:'auth_service_unavailable',
  NOT_AUTHORIZED:  'not_authorized',
  NOT_FOUND:       'property_not_found',
  TENANT_NOT_FOUND:'tenant_not_found',
  READ_FAILED:     'read_failed',
  BAD_REQUEST:     'invalid_arguments',
  UNKNOWN_TOOL:    'unknown_tool',
};

/** Caveat severities. `refusal` means there is no data at all. */
const SEVERITY = { REFUSAL: 'refusal', UNAVAILABLE: 'unavailable',
                   DEGRADED: 'degraded', INFO: 'info' };

/** Section statuses, kept distinct all the way to the caller. */
const STATUS = { OK: 'ok', EMPTY: 'empty', UNAVAILABLE: 'unavailable',
                 DEGRADED: 'degraded' };

// ── Identity ───────────────────────────────────────────────────────────────

/**
 * Bearer token -> user id, resolved server-side against Supabase.
 *
 * Mirrors _verifyUser in api/lease-documents.js, minus the response handling.
 * Reads ONLY `id` from the auth payload; every other field on that object is
 * either irrelevant here or user-writable, and neither kind may authorise
 * anything.
 */
async function resolveIdentity(token, authFetch) {
  const tok = String(token == null ? '' : token).replace(/^Bearer\s+/i, '').trim();
  if (!tok) return { ok: false, reason: REFUSAL.NO_TOKEN };

  const doFetch = authFetch || _defaultAuthFetch;
  let res;
  try {
    res = await doFetch(tok);
  } catch (e) {
    const timedOut = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
    return { ok: false, reason: timedOut ? REFUSAL.AUTH_UNAVAILABLE : REFUSAL.BAD_TOKEN };
  }
  if (!res || res.status >= 300) return { ok: false, reason: REFUSAL.BAD_TOKEN };

  const user = res.json || {};
  if (!user.id || typeof user.id !== 'string') {
    return { ok: false, reason: REFUSAL.NO_IDENTITY };
  }
  // Only the id crosses this line. Deliberately not user.role, app_metadata or
  // user_metadata — see the header.
  return { ok: true, userId: user.id };
}

async function _defaultAuthFetch(tok) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    signal: AbortSignal.timeout(3000),
    headers: { apikey: _key(), Authorization: `Bearer ${tok}` },
  });
  let json = null;
  try { json = await r.json(); } catch (_e) { json = null; }
  return { status: r.status, json };
}

// ── Transport ──────────────────────────────────────────────────────────────

/** The default PostgREST transport. Injectable so tests never open a socket. */
async function _defaultFetch(pathAndQuery, options = {}) {
  const k = _key();
  const res = await fetch(`${SUPABASE_URL}/rest/v1${pathAndQuery}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'apikey': k, 'Authorization': `Bearer ${k}`, 'Prefer': '',
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, json };
}

/** Same guard the hydrator uses: a write is refused, not merely absent. */
const WRITE_METHODS = ['POST', 'PATCH', 'PUT', 'DELETE'];
function _readOnly(fetchImpl) {
  return async function guarded(pathAndQuery, options = {}) {
    const method = (options.method || 'GET').toUpperCase();
    if (WRITE_METHODS.indexOf(method) !== -1) {
      throw new Error('[mcp] refused a ' + method + ' — these capabilities are read-only');
    }
    return fetchImpl(pathAndQuery, options);
  };
}

// ── Envelope ───────────────────────────────────────────────────────────────

/**
 * Build the agreed response envelope.
 *
 * `data` is null for a refusal AND for nothing else. An empty list is [],
 * an unavailable section is null INSIDE data with a caveat naming it, and a
 * refusal is data:null with a caveat of severity `refusal`. Those three are
 * different answers and the caller can tell them apart without guessing.
 */
function envelope(opts) {
  const o = opts || {};
  return {
    data:       o.data === undefined ? null : o.data,
    provenance: Object.assign({
      origin: 'server',
      includesBrowserLocalState: false,
      source: 'database',
    }, o.provenance || {}),
    caveats:    o.caveats || [],
    asOf:       o.asOf || new Date().toISOString(),
  };
}

function refuse(reason, message, extra) {
  return envelope(Object.assign({
    data: null,
    caveats: [{ code: reason, severity: SEVERITY.REFUSAL, scope: 'request', message }],
  }, extra || {}));
}

/**
 * Which hydrator degradation codes bear on which section of the record.
 * A degradation that nobody maps here still reaches the caller as a caveat —
 * it just is not attributed to a section.
 */
const DEGRADED_SECTIONS = {
  'tenants.from_table_no_review_state': ['spaces'],
  'tenants.read_failed':                ['spaces'],
  'evidence.read_failed':               ['fields'],
  'attention.without_selectors_readiness': ['attention'],
  'property.no_stored_record':          ['spaces', 'disputes', 'timeline', 'documents', 'cam'],
};

/**
 * Degradations that mean UNKNOWN rather than "known, from less".
 *
 * The distinction is the whole product argument. `tenants.from_table_no_review_state`
 * means the rows are real and carry less; a caller can still count them.
 * `tenants.read_failed` and `property.no_stored_record` mean nobody knows what
 * is there — and a section like that must come back as null, because a caller
 * reading `data.disputes.length === 0` will conclude "no disputes" no matter
 * what a caveat in a sibling field says. Caveats inform; null is what actually
 * stops the wrong answer being formed.
 */
const UNKNOWN_CODES = ['property.no_stored_record', 'tenants.read_failed'];

/** Human wording for the codes a caller will actually see. */
const CAVEAT_TEXT = {
  'tenants.from_table_no_review_state':
    'Spaces were read from the tenants table, which carries no review state, ' +
    'so review status and cap-base figures are absent rather than zero.',
  'tenants.read_failed':
    'The tenant roster could not be read. Spaces are not empty — they are unknown.',
  'evidence.read_failed':
    'Field evidence could not be read, so provenance is incomplete. A field ' +
    'shown without a citation here may still have one on record.',
  'attention.without_selectors_readiness':
    'Attention items were composed without the readiness module, so this list ' +
    'is shorter than the application would show. It is not a complete list of concerns.',
  'property.no_stored_record':
    'This property has no stored record yet. Disputes, spaces, timeline and ' +
    'documents are UNKNOWN, not zero — nothing has been saved for it.',
};

/**
 * Status for one section of the record.
 *
 * The order matters. Unavailable beats degraded beats empty: a section nobody
 * could compose is not "empty with a note", and calling it that is the exact
 * mistake this whole file exists to prevent.
 */
function sectionStatus(name, value, unavailable, degradedCodes) {
  if (unavailable.indexOf(name) !== -1) return STATUS.UNAVAILABLE;
  if (value === null || value === undefined) return STATUS.UNAVAILABLE;
  // "We do not know" outranks "we know less", and both outrank "there are none".
  for (const code of degradedCodes) {
    if (UNKNOWN_CODES.indexOf(code) === -1) continue;
    const sections = DEGRADED_SECTIONS[code] || [];
    if (sections.indexOf(name) !== -1) return STATUS.UNAVAILABLE;
  }
  for (const code of degradedCodes) {
    const sections = DEGRADED_SECTIONS[code] || [];
    if (sections.indexOf(name) !== -1) return STATUS.DEGRADED;
  }
  if (Array.isArray(value) && value.length === 0) return STATUS.EMPTY;
  if (value && typeof value === 'object' && !Array.isArray(value)
      && Object.keys(value).length === 0) return STATUS.EMPTY;
  return STATUS.OK;
}

/** null for an unavailable section — never an empty array. */
function sectionValue(status, value) {
  return status === STATUS.UNAVAILABLE ? null : value;
}

/** Turn a record's meta + the hydrator's degradation list into caveats. */
function buildCaveats(unavailable, degradedCodes) {
  const out = [];
  for (const name of unavailable) {
    out.push({
      code: 'section_unavailable', severity: SEVERITY.UNAVAILABLE, scope: name,
      message: 'The "' + name + '" section could not be composed. It is reported ' +
               'as null rather than empty: this is not a statement that there ' +
               'are none.',
    });
  }
  for (const code of degradedCodes) {
    const unknown = UNKNOWN_CODES.indexOf(code) !== -1;
    out.push({
      code,
      severity: unknown ? SEVERITY.UNAVAILABLE : SEVERITY.DEGRADED,
      scope: (DEGRADED_SECTIONS[code] || ['record']).join('+'),
      message: CAVEAT_TEXT[code] || 'This answer was composed from fewer inputs than usual.',
    });
  }
  return out;
}

// ── Tool 1: list_properties ────────────────────────────────────────────────

/**
 * Every property the authenticated user owns, and nothing else.
 *
 * ONE read, of the minimum columns. Deliberately NOT the `data` blob and
 * deliberately not a hydration per property: a portfolio listing that assembled
 * a full PropertyRecord for each row would turn a list into N database round
 * trips and would hand the caller far more than it asked for.
 *
 * Because the blob is not read, this cannot and does not report dispute counts,
 * tenant counts or readiness. It says so in provenance rather than returning
 * zeroes that a caller might believe.
 */
async function listProperties(args, ctx) {
  const c = ctx || {};
  const id = await resolveIdentity(c.token, c.authFetch);
  if (!id.ok) return refuse(id.reason, 'The caller could not be authenticated.',
                            { asOf: c.now });

  const reads = [];
  const sb = _readOnly(async (p, o) => { reads.push(p); return (c.sbFetch || _defaultFetch)(p, o); });

  const r = await sb(
    `/properties?user_id=eq.${encodeURIComponent(id.userId)}` +
    `&select=id,name,sqft,created_at,updated_at,archived_at&order=name.asc`,
    { method: 'GET' });

  if (r.status >= 300) {
    return refuse(REFUSAL.READ_FAILED,
      'The property list could not be read. This is not an empty portfolio.',
      { provenance: { reads }, asOf: c.now });
  }

  const rows = Array.isArray(r.json) ? r.json : [];
  const properties = rows.map(row => ({
    propertyId: row.id,
    name:       row.name,
    totalSqft:  row.sqft == null ? null : Number(row.sqft),
    archived:   !!row.archived_at,
    createdAt:  row.created_at || null,
    updatedAt:  row.updated_at || null,
  }));

  const caveats = [{
    code: 'summary_only', severity: SEVERITY.INFO, scope: 'properties',
    message: 'This listing reads only the property row. Tenant counts, disputes, ' +
             'CAM status and readiness are NOT included and must not be inferred ' +
             'as zero — call get_property for those.',
  }];
  if (!properties.length) {
    caveats.push({
      code: 'no_properties_owned', severity: SEVERITY.INFO, scope: 'properties',
      message: 'This user owns no properties. If they are a tenant contact rather ' +
               'than a landlord, that is expected: tenant access is a separate ' +
               'identity and confers no portfolio.',
    });
  }

  return envelope({
    data: { properties, count: properties.length },
    provenance: { reads, tables: ['properties'], hydrated: false,
                  ownership: 'properties.user_id = authenticated user' },
    caveats,
    asOf: c.now,
  });
}

// ── Tool 2: get_property ───────────────────────────────────────────────────

/** Hydrate one owned property, through the accepted server-side hydrator. */
async function _hydrateOwned(propertyId, userId, c) {
  return HYD.hydrate({
    propertyId, userId,
    sbFetch: c.sbFetch,
    deps:    c.deps,
  });
}

/** Map a hydrator refusal onto the envelope's vocabulary. */
function _refusalFor(reason, reads, now) {
  const map = {
    [HYD.REFUSAL.NO_USER]:   [REFUSAL.NO_TOKEN,       'The caller could not be authenticated.'],
    [HYD.REFUSAL.NOT_OWNED]: [REFUSAL.NOT_AUTHORIZED, 'This property is not owned by the authenticated user.'],
    [HYD.REFUSAL.NOT_FOUND]: [REFUSAL.NOT_FOUND,      'No such property for this user.'],
    [HYD.REFUSAL.READ_FAILED]: [REFUSAL.READ_FAILED,
      'The property could not be read. This is not a statement that it is empty.'],
  };
  const [code, message] = map[reason] || [REFUSAL.READ_FAILED, 'The property could not be read.'];
  return refuse(code, message, { provenance: { reads: reads || [] }, asOf: now });
}

async function getProperty(args, ctx) {
  const a = args || {}, c = ctx || {};
  const id = await resolveIdentity(c.token, c.authFetch);
  if (!id.ok) return refuse(id.reason, 'The caller could not be authenticated.',
                            { asOf: c.now });
  if (!a.propertyId || typeof a.propertyId !== 'string') {
    return refuse(REFUSAL.BAD_REQUEST, 'propertyId is required and must be a string.',
                  { asOf: c.now });
  }

  const h = await _hydrateOwned(a.propertyId, id.userId, c);
  if (!h.ok) return _refusalFor(h.reason, h.reads, c.now);

  const rec = h.record;
  const unavailable = (rec.meta && rec.meta.unavailable) || [];
  const degradedCodes = h.degraded || [];

  const st = (name, value) => sectionStatus(name, value, unavailable, degradedCodes);
  const status = {
    identity:  st('identity',  rec.identity),
    spaces:    st('spaces',    rec.spaces),
    fields:    st('fields',    rec.fields),
    cam:       st('cam',       rec.cam),
    timeline:  st('timeline',  rec.timeline),
    disputes:  st('disputes',  rec.disputes),
    attention: st('attention', rec.attention),
    documents: st('documents', rec.documents),
  };

  const data = {
    propertyId: a.propertyId,
    identity:   sectionValue(status.identity,  rec.identity),
    spaces:     sectionValue(status.spaces,    rec.spaces),
    fields:     sectionValue(status.fields,    rec.fields),
    cam:        sectionValue(status.cam,       rec.cam),
    timeline:   sectionValue(status.timeline,  rec.timeline),
    disputes:   sectionValue(status.disputes,  rec.disputes),
    attention:  sectionValue(status.attention, rec.attention),
    documents:  sectionValue(status.documents, rec.documents),
  };

  return envelope({
    data,
    provenance: {
      origin: rec.meta.origin,
      includesBrowserLocalState: rec.meta.includesBrowserLocalState,
      note: rec.meta.note,
      unavailable: unavailable.slice(),
      degraded: degradedCodes.slice(),
      sectionStatus: status,
      reads: h.reads,
      hydrated: true,
      ownership: 'properties.user_id = authenticated user',
    },
    caveats: buildCaveats(unavailable, degradedCodes),
    asOf: c.now,
  });
}

// ── Tool 3: get_tenant ─────────────────────────────────────────────────────

/**
 * One tenant, resolved ONLY inside a property the caller owns.
 *
 * A tenant id from another property cannot resolve here, and not because a
 * check rejects it: the lookup happens inside the owned property's own space
 * list, so a foreign id is simply not present. There is no query anywhere in
 * this function that could reach another property's rows.
 *
 * get_lease is folded in: the lease terms and the lease documents a space
 * carries are part of what a space IS, and splitting them into a second call
 * would invite a caller to ask about a lease without its space's provenance.
 */
async function getTenant(args, ctx) {
  const a = args || {}, c = ctx || {};
  const id = await resolveIdentity(c.token, c.authFetch);
  if (!id.ok) return refuse(id.reason, 'The caller could not be authenticated.',
                            { asOf: c.now });
  if (!a.propertyId || typeof a.propertyId !== 'string' ||
      !a.tenantId   || typeof a.tenantId   !== 'string') {
    return refuse(REFUSAL.BAD_REQUEST, 'propertyId and tenantId are both required strings.',
                  { asOf: c.now });
  }

  const h = await _hydrateOwned(a.propertyId, id.userId, c);
  if (!h.ok) return _refusalFor(h.reason, h.reads, c.now);

  const rec = h.record;
  const unavailable = (rec.meta && rec.meta.unavailable) || [];
  const degradedCodes = h.degraded || [];

  // If spaces could not be composed, the tenant is UNKNOWN, not absent. Saying
  // "no such tenant" here would be a false negative about a real tenant.
  const spacesStatus = sectionStatus('spaces', rec.spaces, unavailable, degradedCodes);
  if (spacesStatus === STATUS.UNAVAILABLE) {
    return envelope({
      data: null,
      provenance: { origin: rec.meta.origin,
                    includesBrowserLocalState: rec.meta.includesBrowserLocalState,
                    unavailable: unavailable.slice(), degraded: degradedCodes.slice(),
                    sectionStatus: { spaces: spacesStatus }, reads: h.reads, hydrated: true },
      caveats: [{ code: 'section_unavailable', severity: SEVERITY.UNAVAILABLE, scope: 'spaces',
                  message: 'The spaces for this property could not be composed, so ' +
                           'whether this tenant exists is UNKNOWN. This is not a ' +
                           'statement that the tenant does not exist.' }]
        .concat(buildCaveats([], degradedCodes)),
      asOf: c.now,
    });
  }

  const space = (rec.spaces || []).find(s => s && s.tenantId === a.tenantId) || null;
  if (!space) {
    return refuse(REFUSAL.TENANT_NOT_FOUND,
      'No tenant with that id exists in this property. A tenant id belonging to ' +
      'another property does not resolve here.',
      { provenance: { reads: h.reads, hydrated: true,
                      spacesConsidered: (rec.spaces || []).length }, asOf: c.now });
  }

  const fieldsStatus = sectionStatus('fields', rec.fields, unavailable, degradedCodes);
  const provenanceForTenant = fieldsStatus === STATUS.UNAVAILABLE
    ? null
    : ((rec.fields || {})[a.tenantId] || null);

  // A space carries a dispute COUNT, not the rows; the rows live on the record.
  // Scoped with the same predicate TenantSpace uses, so the count and the list
  // cannot disagree. The status is the property-level one: if disputes could
  // not be composed at all, this tenant's disputes are unknown, not zero.
  const disputesStatus = sectionStatus('disputes', rec.disputes, unavailable, degradedCodes);
  const tenantDisputes = (rec.disputes || []).filter(d =>
    d && (d.tenantId === a.tenantId || d.tenantName === space.tenantName));

  // Documents on the record are already tenant-scoped and already include the
  // lease document itself (from: 'lease on file'), which is why get_lease is
  // folded in here rather than sold separately.
  const documentsStatus = sectionStatus('documents', rec.documents, unavailable, degradedCodes);
  const tenantDocuments = (rec.documents || []).filter(d => d && d.tenantId === a.tenantId);

  const data = {
    propertyId: a.propertyId,
    tenantId:   space.tenantId,
    tenantName: space.tenantName,
    space:      space.space || null,
    noIdentity: !!space.noIdentity,
    lease:      space.lease || null,
    summary:    space.summary || null,
    counts:     space.counts || null,
    camResult:  space.camResult || null,
    disputes:   sectionValue(disputesStatus,  tenantDisputes),
    documents:  sectionValue(documentsStatus, tenantDocuments),
    fieldProvenance: provenanceForTenant,
  };

  const caveats = buildCaveats(unavailable, degradedCodes);
  if (fieldsStatus !== STATUS.UNAVAILABLE && !provenanceForTenant) {
    caveats.push({
      code: 'no_field_provenance', severity: SEVERITY.INFO, scope: 'fieldProvenance',
      message: 'No field-level evidence is on record for this tenant. Lease terms ' +
               'shown here are unverified rather than contradicted.',
    });
  }

  return envelope({
    data,
    provenance: {
      origin: rec.meta.origin,
      includesBrowserLocalState: rec.meta.includesBrowserLocalState,
      note: rec.meta.note,
      unavailable: unavailable.slice(),
      degraded: degradedCodes.slice(),
      sectionStatus: { spaces: spacesStatus, fields: fieldsStatus,
                       disputes: disputesStatus, documents: documentsStatus },
      reads: h.reads, hydrated: true,
      ownership: 'properties.user_id = authenticated user',
      resolvedWithin: a.propertyId,
    },
    caveats,
    asOf: c.now,
  });
}

// ── Tool descriptors ───────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'list_properties',
    description:
      'List the properties owned by the authenticated user. Returns the property ' +
      'row only — no tenant counts, disputes, CAM status or readiness. Absence of ' +
      'those fields must not be read as zero.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: listProperties,
  },
  {
    name: 'get_property',
    description:
      'The full server-side PropertyRecord for one owned property. Every section ' +
      'carries a status: ok, empty, degraded, or unavailable. A section reported ' +
      'as unavailable is null, and null never means "none".',
    inputSchema: {
      type: 'object',
      properties: { propertyId: { type: 'string', description: 'Property UUID.' } },
      required: ['propertyId'], additionalProperties: false,
    },
    handler: getProperty,
  },
  {
    name: 'get_tenant',
    description:
      'One tenant space within an owned property, with its lease terms, lease ' +
      'documents, disputes and field-level provenance. A tenant id from a ' +
      'different property does not resolve.',
    inputSchema: {
      type: 'object',
      properties: {
        propertyId: { type: 'string', description: 'Property UUID the tenant belongs to.' },
        tenantId:   { type: 'string', description: 'Tenant UUID within that property.' },
      },
      required: ['propertyId', 'tenantId'], additionalProperties: false,
    },
    handler: getTenant,
  },
];

/** Dispatch by name. An unknown tool is refused, not guessed at. */
async function call(name, args, ctx) {
  const tool = TOOLS.find(t => t.name === name);
  if (!tool) {
    return refuse(REFUSAL.UNKNOWN_TOOL, 'No such capability: ' + String(name),
                  { asOf: (ctx || {}).now });
  }
  return tool.handler(args, ctx);
}

module.exports = {
  TOOLS, call, listProperties, getProperty, getTenant,
  resolveIdentity, envelope, refuse, sectionStatus, sectionValue, buildCaveats,
  REFUSAL, SEVERITY, STATUS, WRITE_METHODS, DEGRADED_SECTIONS, UNKNOWN_CODES, CAVEAT_TEXT,
  _readOnly,
};
