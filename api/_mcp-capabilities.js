'use strict';
/**
 * api/_mcp-capabilities.js — the read-only capabilities another system may ask
 * MainStreet for.
 *
 * Nine of them, added a phase at a time and all projections of one record:
 * list_properties, get_property, get_tenant (M4); get_lease_evidence, get_space,
 * get_timeline, get_disputes (M5); get_cam_status, get_attention (M6).
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
// Literal, like every require in _server-deps.js, so a bundler can see it.
const DEPS = require('./_server-deps.js');

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
  SPACE_NOT_FOUND: 'space_not_found',
  FIELD_NOT_FOUND: 'field_not_found',
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
 *
 * `evidence.read_failed` belongs here for a sharper reason than the others, and
 * it took a traced investigation to see it. When the evidence read fails the
 * hydrator never attaches tenant.fieldEvidence, so FieldProvenance finds no
 * snapshot and every field carrying a value falls to its floor state,
 * `ai_extracted`. That output is byte-identical to the case where the read
 * SUCCEEDED and there is genuinely no evidence — and for a field a reviewer had
 * approved it is worse than identical, it is false: `manually_confirmed` with a
 * named reviewer becomes `ai_extracted` with `by: null`. A transient 503 turns
 * "a named person verified this" into "a model guessed this".
 *
 * So this is the one degradation that fabricates a positive claim rather than
 * thinning a true one, and null is the only honest answer. Nothing true is lost
 * by it: evidence supplies provenance, never values, so lease, tenantName,
 * space, counts, summary and camResult are unaffected — measured, not assumed.
 */
const UNKNOWN_CODES = ['property.no_stored_record', 'tenants.read_failed',
                       'evidence.read_failed'];

/** Human wording for the codes a caller will actually see. */
const CAVEAT_TEXT = {
  'tenants.from_table_no_review_state':
    'Spaces were read from the tenants table, which carries no review state, ' +
    'so review status and cap-base figures are absent rather than zero.',
  'tenants.read_failed':
    'The tenant roster could not be read. Spaces are not empty — they are unknown.',
  'evidence.read_failed':
    'Field evidence could not be read, so provenance is UNKNOWN and is reported ' +
    'as null rather than guessed. Without it every field would read as an ' +
    'unverified AI extraction, including fields a reviewer has confirmed — so ' +
    'no provenance is stated at all. The lease terms and space details in this ' +
    'response are unaffected.',
  'attention.without_selectors_readiness':
    'Attention items were composed without the readiness module, so this list ' +
    'is shorter than the application would show. It is not a complete list of concerns.',
  'property.no_stored_record':
    'This property has no stored record yet. Disputes, spaces, timeline and ' +
    'documents are UNKNOWN, not zero — nothing has been saved for it.',
};

// ── M7: semantic coherence ─────────────────────────────────────────────────

/**
 * WHICH STORE AN ANSWER CAME OUT OF.
 *
 * MainStreet holds the same facts twice. `properties.data` is a JSON blob the
 * browser writes; `tenants`, `cam_reconciliations` and `lease_documents` are
 * normalised tables written on their own paths with their own gates. Nothing
 * reconciles the two, and they genuinely disagree — saveCamResults writes raw
 * in-memory rows to the blob and gated rows to the table, so a value the table
 * refused to store can still be sitting in the blob.
 *
 * These capabilities read the blob for everything except field evidence. That
 * is a fact about the answer, so it travels WITH the answer rather than living
 * in a design document: a caller told "this came from the browser's last saved
 * snapshot, and the normalised table was not consulted" can reason about
 * staleness. A caller not told that will assume it read the system of record.
 */
const STORE = {
  BLOB:  'properties.data blob — the snapshot the application last saved. The ' +
         'normalised tables were NOT read and are not reconciled with this.',
  TABLE: 'normalised table, read directly',
  ROW:   'properties row columns only — not the blob, not any normalised table',
};

/** Stated on every response that counts disputes, so the rule is auditable. */
const DISPUTE_RULE =
  'open = the dispute state machine still permits a transition (open, ' +
  'docs_requested); closed = terminal (accepted, rejected, and the legacy ' +
  'status resolved); anything else is unknown and counted separately. ' +
  'Defined once in dispute-status.js and shared with get_attention.';

/**
 * THE UNIT OF EVERY NUMBER THIS SURFACE EXPOSES.
 *
 * The audit measured `lease.cap` arriving as a bare `5` with nothing anywhere in
 * the response saying whether that meant 5%, 0.05, or $5. Every consumer had
 * simply agreed on a convention without writing it down, which works until the
 * consumer is someone else's model.
 *
 * `unit` is what the number means. `guarantee` is how much that claim is worth:
 *
 *   'enforced'   a code path normalises it and nothing else can write it
 *   'convention' the intended unit, applied on some write paths and not all —
 *                so it is what the value almost certainly is, not what it is
 *                certainly
 *   'unknown'    nothing in the system records this, and it is NOT guessed
 *
 * cap is 'convention' and the distinction is real rather than pedantic:
 * normalizeCap (script.js:2077) maps "35%" and "0.35" both to 35 on the
 * AI-extraction path, but tenant-normalize.js — which is the path THIS surface
 * reads through — copies `cap` across untouched. A cap that arrived from the
 * tenants table, a manual review edit or an import was never normalised.
 *
 * Currency is 'unknown' deliberately. `fmt()` renders a '$' with en-US, and no
 * currency code is stored on any property, invoice or reconciliation row
 * anywhere in the schema. Declaring USD here would be inventing a fact about
 * every property in the system in order to avoid an awkward null.
 */
const UNITS = {
  'identity.totalSqft':          { unit: 'square_feet', guarantee: 'convention' },
  'identity.leasedSqft':         { unit: 'square_feet', guarantee: 'convention',
                                   note: 'Sum of leased_sqft over every tenant, present ONLY when every tenant has one — no `|| 0`, no "active" filter, no substitution at this layer. The guarantee is `convention` rather than `enforced` for one measured reason: tenant-normalize.js resolves leased_sqft as `leased_sqft ?? leasedSqft ?? sqft`, so a tenant whose demised area was never recorded may arrive here carrying its rentable sqft under the leased name. That substitution happens upstream of this rule and is not something this layer can see or undo.' },
  'identity.occupancy':          { unit: 'percent', guarantee: 'convention',
                                   note: 'leasedSqft / totalSqft, from the SAME numerator, so the two cannot contradict each other. Not clamped: leased > total yields null, not 100. Inherits the leasedSqft caveat above.' },
  'lease.sqft':                  { unit: 'square_feet', guarantee: 'convention',
                                   note: 'TenantSpace reads leased_sqft and falls back to the tenant row\'s own sqft, so this may be rentable rather than demised area.' },
  'lease.cap':                   { unit: 'percent', guarantee: 'convention',
                                   note: 'A CAM cap percentage: 5 means 5%. normalizeCap enforces this on the AI-extraction path only; a value from the tenants table, a manual edit or an import is stored as written. A value strictly between 0 and 1 is genuinely ambiguous — see the cap_unit_ambiguous caveat.' },
  'cam.pool':                    { unit: 'currency', currencyCode: null, guarantee: 'unknown' },
  'cam.unallocated':             { unit: 'currency', currencyCode: null, guarantee: 'unknown' },
  'cam.results.actualCam':       { unit: 'currency', currencyCode: null, guarantee: 'unknown' },
  'cam.results.allocatedAmount': { unit: 'currency', currencyCode: null, guarantee: 'unknown' },
  'cam.results.expectedCam':     { unit: 'currency', currencyCode: null, guarantee: 'unknown' },
  'cam.results.variance':        { unit: 'currency', currencyCode: null, guarantee: 'unknown' },
  'cam.results.proRataPercent':  { unit: 'percent', guarantee: 'convention' },
  'disputes.amount':             { unit: 'currency', currencyCode: null, guarantee: 'unknown' },
  // M8a — the canonical field values, now that they are visible. Each is
  // reported as extraction returned it; api/_claude-tasks.js states the unit it
  // asks for, and that prompt is the only thing standing behind these numbers,
  // which is what `convention` means here.
  'fields.admin_fee_pct.value':  { unit: 'percent', guarantee: 'convention',
                                   note: 'Extraction asks for the number only — 15 for "15%".' },
  'fields.gross_up_pct.value':   { unit: 'percent', guarantee: 'convention',
                                   note: 'Occupancy factor — 95 for "grossed up to 95% occupancy".' },
  'fields.expense_stop.value':   { unit: 'currency_per_square_foot', currencyCode: null,
                                   guarantee: 'convention',
                                   note: 'Extraction asks for a dollar amount PER SQUARE FOOT, not a total.' },
  'fields.cap_base_amount.value':{ unit: 'currency', currencyCode: null, guarantee: 'convention',
                                   note: 'Last year\'s actual CAM charge for this tenant, typed by a person. Not a lease term — see the field\'s own origin.note.' },
  // audit_rights, pro_rata_method and renewal_options carry no unit: the first
  // is a boolean-or-prose right, the second an enum (rentable|leasable|
  // occupied|gross), the third free prose capped at 120 characters. Declaring a
  // unit for any of them would be inventing one.
};

/** Only the entries a given response actually contains. */
function unitsFor(prefixes) {
  const out = {};
  for (const k of Object.keys(UNITS)) {
    if (prefixes.some(p => k === p || k.indexOf(p + '.') === 0)) out[k] = UNITS[k];
  }
  return out;
}

/**
 * A stored cap that cannot be read with confidence.
 *
 * Under the percentage convention 0.05 means one twentieth of one percent. It
 * is far likelier to be 5% written as a fraction by a path that never ran
 * normalizeCap — but "far likelier" is not a fact, and picking one silently is
 * a hundred-fold error in whichever direction it is wrong. Both readings are
 * stated and neither is chosen.
 */
function capAmbiguityCaveat(cap, scope) {
  if (typeof cap !== 'number' || !Number.isFinite(cap)) return null;
  if (!(cap > 0 && cap < 1)) return null;
  return {
    code: 'lease.cap_unit_ambiguous', severity: SEVERITY.DEGRADED, scope,
    message: 'The stored CAM cap is ' + cap + '. Under this system\'s convention ' +
             'that is ' + cap + '%, but a value below 1 is the shape a fraction ' +
             'takes, so it may be ' + (cap * 100) + '% written as a decimal by a ' +
             'path that did not normalise it. The two readings differ by a factor ' +
             'of 100 and nothing stored distinguishes them. The value is passed ' +
             'through unchanged and NOT converted.',
  };
}

/** Why leased area and occupancy are unavailable, in the caller's terms. */
const AREA_REASON = {
  no_tenants:
    'No tenants are on this record, so leased area is not zero — it is ' +
    'unknown. Check the spaces section: an empty roster and a roster that ' +
    'could not be read reach this the same way.',
  incomplete_tenant_area:
    'At least one tenant has no leased square footage on file, so the ' +
    'property total is UNKNOWN rather than smaller. The absent tenant is not ' +
    'counted as occupying nothing, and its area is not substituted from the ' +
    'tenant row\'s own sqft — both were rules this system used to apply ' +
    'silently, and both produced a confident wrong number.',
  negative_area:
    'A tenant carries a negative leased square footage. No total is stated ' +
    'from data that cannot be true.',
  no_total:
    'The property has no total square footage on file, so occupancy has no ' +
    'denominator. Leased area, where present, is still reported.',
  exceeds_total:
    'The tenant areas sum to MORE than the property\'s own total square ' +
    'footage. That is a contradiction in the stored record — double-counted ' +
    'tenants, a stale suite, or a total never updated after a subdivision — ' +
    'and it is reported as unavailable rather than clamped to 100%. The ' +
    'clamp this replaces turned exactly this evidence into a confident ' +
    '"fully occupied".',
  property_area_module_absent:
    'The module that defines leased area could not be loaded, so leased area ' +
    'and occupancy are UNKNOWN.',
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
                  ownership: 'properties.user_id = authenticated user',
                  store: STORE.ROW,
                  units: unitsFor([]) },
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

  // M7 — say why leased area and occupancy are absent, when they are. Both
  // come from ONE definition now, so they are null together and for one stated
  // reason; a caller never has to guess whether a null means "no tenants",
  // "some tenant has no area on file", or "the areas contradict the property".
  const propertyCaveats = buildCaveats(unavailable, degradedCodes);
  const ab = (rec.identity && rec.identity.areaBasis) || null;
  if (ab && ab.reason) {
    propertyCaveats.push({
      code: 'identity.area_' + ab.reason, severity: SEVERITY.UNAVAILABLE,
      scope: 'identity.leasedSqft+identity.occupancy',
      message: AREA_REASON[ab.reason] ||
               'Leased area could not be established, so occupancy is null too.',
    });
  }
  for (const sp of (rec.spaces || [])) {
    const cv = capAmbiguityCaveat(sp && sp.lease && sp.lease.cap,
                                  'spaces[' + (sp && sp.tenantId) + '].lease.cap');
    if (cv) propertyCaveats.push(cv);
  }

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
      store: STORE.BLOB,
      evidenceStore: STORE.TABLE + ' (tenant_field_evidence)',
      units: unitsFor(['identity', 'lease', 'cam', 'disputes', 'fields']),
      openDisputeRule: DISPUTE_RULE,
      areaBasis: (rec.identity && rec.identity.areaBasis) || null,
    },
    caveats: propertyCaveats,
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
  const capCav = capAmbiguityCaveat(space.lease && space.lease.cap, 'lease.cap');
  if (capCav) caveats.push(capCav);
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
      store: STORE.BLOB,
      units: unitsFor(['lease', 'disputes', 'fields']),
      openDisputeRule: DISPUTE_RULE,
    },
    caveats,
    asOf: c.now,
  });
}

// ── M5: four more read-only projections of the SAME record ─────────────────
//
// Every capability below calls the same hydrator through the same
// _hydrateOwned(), over the same three approved reads. M5 adds no database
// read of any kind; it adds ways of ASKING about a record the server already
// knows how to build. That is deliberate — a second fetch path would be a
// second place for the ownership check and the truthfulness rules to drift.

/**
 * Resolve one space inside an already-hydrated owned record.
 *
 * Returns { kind: 'ok', space } | { kind: 'unavailable' } | { kind: 'absent' }.
 *
 * The three are different answers and every caller below must keep them apart.
 * `unavailable` means the spaces could not be composed, so whether this space
 * exists is UNKNOWN — reporting "no such space" there would be a false negative
 * about a real tenant, which is the same mistake as reporting "no disputes"
 * when the dispute source could not be read.
 */
function _resolveSpace(rec, id, unavailable, degradedCodes) {
  const status = sectionStatus('spaces', rec.spaces, unavailable, degradedCodes);
  if (status === STATUS.UNAVAILABLE) return { kind: 'unavailable', status };
  // A space's id IS its tenant id in this data model — TenantSpace sets
  // space.id from the tenant. Both are accepted so a caller need not know that,
  // and neither can reach outside this property's own space list.
  const space = (rec.spaces || []).find(s =>
    s && (s.tenantId === id || (s.space && s.space.id === id))) || null;
  return space ? { kind: 'ok', space, status } : { kind: 'absent', status };
}

/** The envelope for "the section that would have answered this is unknown". */
function _unknownSection(scope, message, rec, unavailable, degradedCodes, reads, now, extra) {
  return envelope({
    data: null,
    provenance: Object.assign({
      origin: rec.meta.origin,
      includesBrowserLocalState: rec.meta.includesBrowserLocalState,
      unavailable: unavailable.slice(), degraded: degradedCodes.slice(),
      reads, hydrated: true,
    }, extra || {}),
    caveats: [{ code: 'section_unavailable', severity: SEVERITY.UNAVAILABLE,
                scope, message }].concat(buildCaveats([], degradedCodes)),
    asOf: now,
  });
}

/** Shared preamble: authenticate, validate, hydrate. */
async function _open(a, c, needTenant) {
  const id = await resolveIdentity(c.token, c.authFetch);
  if (!id.ok) return { stop: refuse(id.reason, 'The caller could not be authenticated.',
                                    { asOf: c.now }) };
  if (!a.propertyId || typeof a.propertyId !== 'string') {
    return { stop: refuse(REFUSAL.BAD_REQUEST, 'propertyId is required and must be a string.',
                          { asOf: c.now }) };
  }
  if (needTenant && (!a[needTenant] || typeof a[needTenant] !== 'string')) {
    return { stop: refuse(REFUSAL.BAD_REQUEST, needTenant + ' is required and must be a string.',
                          { asOf: c.now }) };
  }
  const h = await _hydrateOwned(a.propertyId, id.userId, c);
  if (!h.ok) return { stop: _refusalFor(h.reason, h.reads, c.now) };
  return {
    h, rec: h.record,
    unavailable: (h.record.meta && h.record.meta.unavailable) || [],
    degradedCodes: h.degraded || [],
  };
}

// ── Tool 4: get_lease_evidence ─────────────────────────────────────────────

/**
 * The provenance PropertyRecord already holds for one tenant's lease fields.
 *
 * Nothing here is computed. Each entry is what FieldProvenance resolved —
 * which state the value is in, who attested it, and the clause and page it was
 * read from — passed through unchanged. No quote is reconstructed, no citation
 * is inferred from a filename, and no field is promoted because a value happens
 * to exist somewhere else on the tenant.
 *
 * When the evidence read failed this returns null, not a list of uncited
 * fields. That is the M4 contract and it exists because the alternative is
 * worse than vague: without the evidence rows a reviewer-confirmed field falls
 * to `ai_extracted` with no reviewer named, so a transient failure would
 * actively contradict the record rather than merely thin it.
 */
async function getLeaseEvidence(args, ctx) {
  const a = args || {}, c = ctx || {};
  const o = await _open(a, c, 'tenantId');
  if (o.stop) return o.stop;
  const { h, rec, unavailable, degradedCodes } = o;

  const found = _resolveSpace(rec, a.tenantId, unavailable, degradedCodes);
  if (found.kind === 'unavailable') {
    return _unknownSection('spaces',
      'The spaces for this property could not be composed, so whether this ' +
      'tenant exists is UNKNOWN. This is not a statement that it does not.',
      rec, unavailable, degradedCodes, h.reads, c.now);
  }
  if (found.kind === 'absent') {
    return refuse(REFUSAL.TENANT_NOT_FOUND,
      'No tenant with that id exists in this property. A tenant id belonging to ' +
      'another property does not resolve here.',
      { provenance: { reads: h.reads, hydrated: true,
                      spacesConsidered: (rec.spaces || []).length }, asOf: c.now });
  }

  const fieldsStatus = sectionStatus('fields', rec.fields, unavailable, degradedCodes);
  if (fieldsStatus === STATUS.UNAVAILABLE) {
    return _unknownSection('fields',
      'Field evidence could not be read, so the provenance of this lease is ' +
      'UNKNOWN. It is reported as null rather than as a set of uncited fields, ' +
      'because without the evidence rows a field a reviewer has confirmed is ' +
      'indistinguishable from one nobody has ever checked.',
      rec, unavailable, degradedCodes, h.reads, c.now,
      { sectionStatus: { spaces: found.status, fields: fieldsStatus },
        resolvedWithin: a.propertyId });
  }

  const all = (rec.fields || {})[a.tenantId] || null;
  if (a.fieldKey != null) {
    if (typeof a.fieldKey !== 'string') {
      return refuse(REFUSAL.BAD_REQUEST, 'fieldKey, when given, must be a string.',
                    { asOf: c.now });
    }
    if (!all || !(a.fieldKey in all)) {
      return refuse(REFUSAL.FIELD_NOT_FOUND,
        'No canonical lease field named "' + a.fieldKey + '". This is a statement ' +
        'about the field name, not about the evidence behind it.',
        { provenance: { reads: h.reads, hydrated: true,
                        knownFields: all ? Object.keys(all) : [] }, asOf: c.now });
    }
  }

  const evidence = !all ? null
    : (a.fieldKey != null ? { [a.fieldKey]: all[a.fieldKey] } : all);

  const caveats = buildCaveats(unavailable, degradedCodes);
  if (!all) {
    caveats.push({
      code: 'no_field_evidence', severity: SEVERITY.INFO, scope: 'evidence',
      message: 'The evidence read succeeded and there is no field evidence on ' +
               'record for this tenant. Lease terms shown elsewhere are ' +
               'unverified rather than contradicted.',
    });
  }

  return envelope({
    data: {
      propertyId: a.propertyId,
      tenantId:   found.space.tenantId,
      tenantName: found.space.tenantName,
      fieldKey:   a.fieldKey != null ? a.fieldKey : null,
      evidence:   sectionValue(fieldsStatus, evidence),
      fieldCount: evidence ? Object.keys(evidence).length : 0,
    },
    provenance: {
      origin: rec.meta.origin,
      includesBrowserLocalState: rec.meta.includesBrowserLocalState,
      note: rec.meta.note,
      unavailable: unavailable.slice(), degraded: degradedCodes.slice(),
      sectionStatus: { spaces: found.status, fields: fieldsStatus },
      reads: h.reads, hydrated: true,
      ownership: 'properties.user_id = authenticated user',
      resolvedWithin: a.propertyId,
      source: 'PropertyRecord.fields via FieldProvenance — passed through unchanged',
      store: STORE.TABLE + ' (tenant_field_evidence)',
      // M8a. This capability is where the field values live, so it is where
      // their units have to be declared.
      units: unitsFor(['fields']),
      // M8a rewrote this. It used to say "provenance only ... no value anywhere
      // on this surface", which was true and is not any more.
      valuesNote: 'Each field carries BOTH its value and the evidence behind it. ' +
                  '`value` is the figure the provenance resolver judged, so the ' +
                  'two always describe the same thing; `valuePresent` is false ' +
                  'and `value` null when the field is genuinely absent from the ' +
                  'record, which state `unknown` says too. A field that could ' +
                  'not be READ at all is not represented here — the whole ' +
                  'section is null in that case.',
      originNote: '`origin.kind` says what KIND of fact a field is, on a ' +
                  'separate axis from what evidence backs it. cap_base_amount ' +
                  'is `operating_actual`: last year\'s actual CAM charge, typed ' +
                  'by a person. It is NOT a lease term and must never be ' +
                  'described as lease-supported, whatever its state says. ' +
                  '`origin.extractable` is derived from FieldProvenance, not ' +
                  'restated here.',
    },
    caveats,
    asOf: c.now,
  });
}

// ── Tool 5: get_space ──────────────────────────────────────────────────────

/**
 * One space, as PropertyRecord already represents it.
 *
 * This is deliberately the NARROW view, and it overlaps get_tenant by
 * construction — in this data model a space and its tenant are one object, and
 * inventing a difference would mean inventing a second space model. get_tenant
 * is the aggregate (it also folds in disputes, documents and provenance);
 * get_space is the space itself, for a caller that wants the physical and
 * lease facts without the rest.
 *
 * A space that cannot be composed is UNKNOWN, never not_found.
 */
async function getSpace(args, ctx) {
  const a = args || {}, c = ctx || {};
  const o = await _open(a, c, 'spaceId');
  if (o.stop) return o.stop;
  const { h, rec, unavailable, degradedCodes } = o;

  const found = _resolveSpace(rec, a.spaceId, unavailable, degradedCodes);
  if (found.kind === 'unavailable') {
    return _unknownSection('spaces',
      'The spaces for this property could not be composed, so whether this ' +
      'space exists is UNKNOWN. A real space must never be reported as absent ' +
      'because the roster could not be read.',
      rec, unavailable, degradedCodes, h.reads, c.now,
      { resolvedWithin: a.propertyId });
  }
  if (found.kind === 'absent') {
    return refuse(REFUSAL.SPACE_NOT_FOUND,
      'No space with that id exists in this property. A space id belonging to ' +
      'another property does not resolve here.',
      { provenance: { reads: h.reads, hydrated: true,
                      spacesConsidered: (rec.spaces || []).length }, asOf: c.now });
  }

  const s = found.space;
  const spaceCaveats = buildCaveats(unavailable, degradedCodes);
  const spaceCap = capAmbiguityCaveat(s.lease && s.lease.cap, 'lease.cap');
  if (spaceCap) spaceCaveats.push(spaceCap);
  return envelope({
    data: {
      propertyId: a.propertyId,
      spaceId:    (s.space && s.space.id) || s.tenantId,
      spaceName:  (s.space && s.space.name) || null,
      tenantId:   s.tenantId,
      tenantName: s.tenantName,
      noIdentity: !!s.noIdentity,
      lease:      s.lease || null,
      summary:    s.summary || null,
      counts:     s.counts || null,
      camResult:  s.camResult || null,
    },
    provenance: {
      origin: rec.meta.origin,
      includesBrowserLocalState: rec.meta.includesBrowserLocalState,
      note: rec.meta.note,
      unavailable: unavailable.slice(), degraded: degradedCodes.slice(),
      sectionStatus: { spaces: found.status },
      reads: h.reads, hydrated: true,
      ownership: 'properties.user_id = authenticated user',
      resolvedWithin: a.propertyId,
      source: 'PropertyRecord.spaces — the same representation get_property returns',
      store: STORE.BLOB,
      units: unitsFor(['lease']),
      identityNote: 'In this data model a space id and its tenant id are the ' +
                    'same value; both are accepted here.',
    },
    caveats: spaceCaveats,
    asOf: c.now,
  });
}

// ── Tool 6: get_timeline ───────────────────────────────────────────────────

/**
 * The timeline the SERVER can see, and an explicit statement of what it cannot.
 *
 * loadPropertyData() in the browser merges localStorage into the stored
 * timeline, so a browser can hold events that exist nowhere else. This
 * capability reads the database only. That is not a failure and it is not
 * reported as one — it is a permanent scope limit, and it travels on every
 * response as an `info` caveat rather than hiding in the record's prose.
 *
 * THE SCOPING CASE. When TimelineMerge is absent PropertyRecord still returns a
 * timeline, but byTenant is {} and the property list is un-deduplicated. Asking
 * for one tenant's events would then yield undefined, and returning [] for that
 * would be a confident, empty, wrong answer. Tenant-scoped becomes UNAVAILABLE;
 * property-level becomes DEGRADED, because the events are real and merely
 * unfiltered.
 */
async function getTimeline(args, ctx) {
  const a = args || {}, c = ctx || {};
  const o = await _open(a, c, null);
  if (o.stop) return o.stop;
  const { h, rec, unavailable, degradedCodes } = o;

  const tl        = rec.timeline || null;
  const noScoping = unavailable.indexOf('timeline.scoping') !== -1;
  let status      = sectionStatus('timeline', tl, unavailable, degradedCodes);
  if (status !== STATUS.UNAVAILABLE && noScoping) status = STATUS.DEGRADED;

  const caveats = buildCaveats(unavailable, degradedCodes);
  caveats.push({
    code: 'timeline.server_origin_only', severity: SEVERITY.INFO, scope: 'timeline',
    message: 'This is the timeline as stored in the database. A browser session ' +
             'may hold events that were never persisted; they are absent here, ' +
             'and their absence is not a claim that they do not exist.',
  });
  if (noScoping) {
    caveats.push({
      code: 'timeline.scoping_unavailable', severity: SEVERITY.UNAVAILABLE,
      scope: 'timeline.byTenant',
      message: 'Timeline scoping could not be composed, so events cannot be ' +
               'attributed to spaces. Per-tenant timelines are UNKNOWN, not ' +
               'empty, and the property list below is un-deduplicated.',
    });
  }

  // ── tenant-scoped ────────────────────────────────────────────────────────
  if (a.tenantId != null) {
    if (typeof a.tenantId !== 'string') {
      return refuse(REFUSAL.BAD_REQUEST, 'tenantId, when given, must be a string.',
                    { asOf: c.now });
    }
    const found = _resolveSpace(rec, a.tenantId, unavailable, degradedCodes);
    if (found.kind === 'unavailable') {
      return _unknownSection('spaces',
        'The spaces for this property could not be composed, so whether this ' +
        'tenant exists is UNKNOWN, and so is its timeline.',
        rec, unavailable, degradedCodes, h.reads, c.now, { resolvedWithin: a.propertyId });
    }
    if (found.kind === 'absent') {
      return refuse(REFUSAL.TENANT_NOT_FOUND,
        'No tenant with that id exists in this property.',
        { provenance: { reads: h.reads, hydrated: true,
                        spacesConsidered: (rec.spaces || []).length }, asOf: c.now });
    }

    // Scoping gone ⇒ this tenant's events are unknown, not none.
    const scoped = (status === STATUS.UNAVAILABLE || noScoping)
      ? null
      : ((tl.byTenant || {})[a.tenantId] || []);
    const scopedStatus = scoped === null ? STATUS.UNAVAILABLE
      : (scoped.length ? STATUS.OK : STATUS.EMPTY);

    return envelope({
      data: {
        propertyId: a.propertyId, tenantId: a.tenantId,
        tenantName: found.space.tenantName,
        scope: 'tenant',
        events: scoped,
        eventCount: scoped ? scoped.length : null,
      },
      provenance: {
        origin: rec.meta.origin,
        includesBrowserLocalState: rec.meta.includesBrowserLocalState,
        note: rec.meta.note,
        unavailable: unavailable.slice(), degraded: degradedCodes.slice(),
        sectionStatus: { spaces: found.status, timeline: scopedStatus },
        reads: h.reads, hydrated: true,
        ownership: 'properties.user_id = authenticated user',
        resolvedWithin: a.propertyId,
        source: 'PropertyRecord.timeline.byTenant — scoped by TimelineMerge',
      store: STORE.BLOB,
      },
      caveats, asOf: c.now,
    });
  }

  // ── property-level ───────────────────────────────────────────────────────
  const propertyEvents = status === STATUS.UNAVAILABLE ? null : ((tl && tl.property) || []);

  // Per-tenant counts, so a caller can see that scoping exists without asking
  // once per space. Null whenever attribution is UNKNOWN, because an index of
  // zeroes — or an empty index — reads as "no tenant has any events".
  //
  // There are TWO ways attribution disappears and they arrive by different
  // routes, which is what made the second one easy to miss:
  //
  //   TimelineMerge absent  meta.unavailable gains 'timeline.scoping', byTenant
  //                         is {} because nothing can compute an event key
  //   TenantSpace absent    meta.unavailable gains 'spaces', byTenant is {}
  //                         because there are no spaces to attribute events TO
  //
  // The first was handled from the start; the second returned {} — accurate in
  // the narrow sense that the index has no entries, and misleading in every
  // sense that matters to a caller asking how many events a tenant has.
  //
  // A property that genuinely has no tenants is NOT this case: its spaces
  // section is `empty`, not `unavailable`, and {} there is the true answer.
  const spacesStatus = sectionStatus('spaces', rec.spaces, unavailable, degradedCodes);
  const attributionUnknown = status === STATUS.UNAVAILABLE || noScoping ||
                             spacesStatus === STATUS.UNAVAILABLE;
  const byTenantCounts = attributionUnknown ? null
    : Object.keys((tl && tl.byTenant) || {}).reduce((acc, k) => {
        acc[k] = ((tl.byTenant[k]) || []).length; return acc;
      }, {});

  return envelope({
    data: {
      propertyId: a.propertyId,
      scope: 'property',
      events: propertyEvents,
      eventCount: propertyEvents ? propertyEvents.length : null,
      byTenantCounts,
    },
    provenance: {
      origin: rec.meta.origin,
      includesBrowserLocalState: rec.meta.includesBrowserLocalState,
      note: rec.meta.note,
      unavailable: unavailable.slice(), degraded: degradedCodes.slice(),
      sectionStatus: { timeline: status, spaces: spacesStatus },
      reads: h.reads, hydrated: true,
      ownership: 'properties.user_id = authenticated user',
      source: 'PropertyRecord.timeline.property — database only, never localStorage',
      store: STORE.BLOB,
      attributionUnknown,
    },
    caveats, asOf: c.now,
  });
}

// ── Tool 7: get_disputes ───────────────────────────────────────────────────

/**
 * Disputes as the server-side record holds them, property-wide or for one
 * tenant.
 *
 * This is the capability the whole truthfulness contract was written for. If
 * the dispute source could not be read — the property has no stored record at
 * all, or a module that composes it is missing — the answer is null with a
 * caveat, never []. An MCP client asking "does this property have any
 * disputes?" must not be able to receive "no" from a system that does not know.
 */
async function getDisputes(args, ctx) {
  const a = args || {}, c = ctx || {};
  const o = await _open(a, c, null);
  if (o.stop) return o.stop;
  const { h, rec, unavailable, degradedCodes } = o;

  const status = sectionStatus('disputes', rec.disputes, unavailable, degradedCodes);
  const caveats = buildCaveats(unavailable, degradedCodes);

  let scopeName = 'property', tenantName = null, list = rec.disputes || [];

  if (a.tenantId != null) {
    if (typeof a.tenantId !== 'string') {
      return refuse(REFUSAL.BAD_REQUEST, 'tenantId, when given, must be a string.',
                    { asOf: c.now });
    }
    const found = _resolveSpace(rec, a.tenantId, unavailable, degradedCodes);
    if (found.kind === 'unavailable') {
      return _unknownSection('spaces',
        'The spaces for this property could not be composed, so whether this ' +
        'tenant exists is UNKNOWN, and its disputes cannot be scoped.',
        rec, unavailable, degradedCodes, h.reads, c.now, { resolvedWithin: a.propertyId });
    }
    if (found.kind === 'absent') {
      return refuse(REFUSAL.TENANT_NOT_FOUND,
        'No tenant with that id exists in this property.',
        { provenance: { reads: h.reads, hydrated: true,
                        spacesConsidered: (rec.spaces || []).length }, asOf: c.now });
    }
    scopeName = 'tenant';
    tenantName = found.space.tenantName;
    // The same predicate TenantSpace uses, so a space's dispute COUNT and this
    // list can never disagree.
    list = list.filter(d => d && (d.tenantId === a.tenantId || d.tenantName === tenantName));
  }

  // M7 — counted through the ONE shared predicate, so this number and the one
  // get_attention reports come from the same definition. `unknown` is carried
  // rather than absorbed: a status the dispute state machine has never heard of
  // is neither open nor closed, and silently choosing one would be exactly the
  // confident-wrong-number this file exists to prevent.
  const DS = (c.deps && c.deps.DisputeStatus) || DEPS.load().DisputeStatus;
  const value = sectionValue(status, list);
  const t     = value ? DS.tally(value) : null;
  const open  = value ? value.filter(d => DS.isOpen(d)) : null;
  if (t && t.unknown > 0) {
    caveats.push({
      code: 'disputes.unknown_status', severity: SEVERITY.DEGRADED, scope: 'disputes',
      message: t.unknown + ' dispute(s) carry a status the dispute state machine ' +
               'does not define (' + t.unknownStatuses.join(', ') + '). They are ' +
               'counted in disputeCount and in neither openDisputeCount nor ' +
               'closedDisputeCount, because classifying them either way would be ' +
               'a guess. openDisputeCount is therefore a LOWER BOUND.',
    });
  }

  return envelope({
    data: {
      propertyId: a.propertyId,
      scope: scopeName,
      tenantId:   a.tenantId != null ? a.tenantId : null,
      tenantName,
      disputes:   value,
      // Null rather than 0 when the source is unknown: a count of zero is an
      // assertion, and there is nothing here to assert it from.
      disputeCount:     value ? value.length : null,
      openDisputeCount: open  ? open.length  : null,
      closedDisputeCount:  t ? t.closed  : null,
      unknownStatusCount:  t ? t.unknown : null,
    },
    provenance: {
      origin: rec.meta.origin,
      includesBrowserLocalState: rec.meta.includesBrowserLocalState,
      note: rec.meta.note,
      unavailable: unavailable.slice(), degraded: degradedCodes.slice(),
      sectionStatus: { disputes: status },
      reads: h.reads, hydrated: true,
      ownership: 'properties.user_id = authenticated user',
      resolvedWithin: a.propertyId,
      source: 'PropertyRecord.disputes — the stored record only',
      store: STORE.BLOB,
      openDisputeRule: DISPUTE_RULE,
    },
    caveats, asOf: c.now,
  });
}

// ── M6: CAM status and attention ───────────────────────────────────────────
//
// Both are projections of the SAME hydrated record over the SAME three reads.
// M6 adds no database read, exactly as M5 did not.

/**
 * The vocabulary of `expectedCamBasis`, and what each value licenses.
 *
 * THE TWO AXES. `cap_ceiling` describes ARITHMETIC — the value came from
 * capBaseAmount × (1 + cap%), so it is a dollar figure and comparing it with an
 * actual charge is a like-for-like comparison. It asserts NOTHING about whether
 * the cap base itself was ever read off a lease by a human. A caller that reads
 * "basis: cap_ceiling" as "lease-supported" or "verified" has crossed from one
 * axis to the other, and this module must never encourage that: the trust label
 * below says `cap_ceiling_arithmetic` and a caveat says the rest in words.
 *
 * `legacy_unverified` marks a row whose `expectedCam` is a cap PERCENTAGE that
 * an older code path wrote into a dollar field. Five is not $5. Presenting it
 * would be presenting a percent as money, and the stored `variance` beside it is
 * dollars-minus-percent — a number with no unit. Both are withheld.
 *
 * A null or absent basis is UNKNOWN, not "no expectation": the row predates the
 * stamp, so nothing can tell a legitimate small ceiling ($92.00) from a stray
 * percentage (5) by inspection. That is precisely the judgement saveCamResults
 * refused to make, and this reader refuses it for the same reason.
 *
 * The gate below is deliberately the same predicate as script.js's `_stamped`.
 * If the two ever drift, a value this capability presents as money would be one
 * the persister would not have written.
 */
const CAM_TRUST = {
  ARITHMETIC:  'cap_ceiling_arithmetic',
  STAMP_NO_VALUE: 'stamped_without_usable_value',
  LEGACY:      'legacy_unverified_not_money',
  UNSTAMPED:   'unstamped_value_withheld',
  NONE:        'no_expectation_established',
  UNRECOGNISED:'unrecognised_basis',
};

/** Which trust labels permit the expected value to be shown at all. */
function _classifyExpectation(r) {
  const row    = r || {};
  const basis  = row.expectedCamBasis == null ? null : row.expectedCamBasis;
  const value  = row.expectedCam;
  const finite = typeof value === 'number' && Number.isFinite(value);

  if (basis === 'cap_ceiling') {
    return finite
      ? { trust: CAM_TRUST.ARITHMETIC,     expectedCam: value }
      : { trust: CAM_TRUST.STAMP_NO_VALUE, expectedCam: null };
  }
  if (basis === 'legacy_unverified') {
    return { trust: CAM_TRUST.LEGACY, expectedCam: null };
  }
  if (basis === null) {
    return finite
      ? { trust: CAM_TRUST.UNSTAMPED, expectedCam: null }
      : { trust: CAM_TRUST.NONE,      expectedCam: null };
  }
  // A basis this build does not know about. Refusing it is the safe direction:
  // a future vocabulary word must not be presented as money by a reader that
  // has never been told what it means.
  return { trust: CAM_TRUST.UNRECOGNISED, expectedCam: null };
}

/** Numbers pass through as themselves; anything else becomes null, never 0. */
function _numOrNull(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** One stored reconciliation row, projected with its expectation gated. */
function _camRow(r) {
  const row = r || {};
  const cls = _classifyExpectation(row);
  const actual = _numOrNull(row.actualCam != null ? row.actualCam : row.totalAllocated);
  return {
    tenantId:   row.tenantId != null ? row.tenantId : null,
    tenantName: row.tenantName != null ? row.tenantName : (row.name != null ? row.name : null),
    actualCam:  actual,
    allocatedAmount: _numOrNull(row.allocatedAmount != null ? row.allocatedAmount
                                                            : row.totalAllocated),
    proRataPercent: _numOrNull(row.proRataPercent != null ? row.proRataPercent
                      : (row.proRata != null ? row.proRata * 100 : null)),
    capApplied: row.capApplied === true,
    expectedCam: cls.expectedCam,
    // Variance travels WITH the expectation or not at all. A stored variance
    // whose expected half is withheld is a difference against a number this
    // response declines to state — and for a legacy row it is literally
    // dollars minus a percentage. It is not recomputed here either: deriving
    // one would be manufacturing the expectation the gate just refused.
    variance: cls.expectedCam === null ? null : _numOrNull(row.variance),
    expectedCamBasis: row.expectedCamBasis == null ? null : row.expectedCamBasis,
    expectedCamTrust: cls.trust,
  };
}

// ── Tool 8: get_cam_status ─────────────────────────────────────────────────

/**
 * The CAM reconciliation as the STORED SNAPSHOT holds it, with every expected
 * value gated on its basis stamp.
 *
 * SCOPE, STATED PLAINLY. This reads `property.data.camReconciliation` — the
 * blob snapshot the browser saved — through PropertyRecord._cam. It does NOT
 * read the `cam_reconciliations` table, and therefore does not see that table's
 * `expected_cam_basis` column. A row that exists only in the table is invisible
 * here, and this response says so rather than implying its results are the
 * complete reconciliation history.
 *
 * Nothing is repaired, nulled, rewritten or recomputed. Rows whose basis is
 * unresolved are reported as unresolved and left exactly as stored.
 */
async function getCamStatus(args, ctx) {
  const a = args || {}, c = ctx || {};
  const o = await _open(a, c, null);
  if (o.stop) return o.stop;
  const { h, rec, unavailable, degradedCodes } = o;

  const status = sectionStatus('cam', rec.cam, unavailable, degradedCodes);

  // The unknown case first, and it takes its own envelope — nothing composed
  // below it would have anything true to say.
  if (status === STATUS.UNAVAILABLE) {
    return _unknownSection('cam',
      'The CAM section could not be composed, so the reconciliation for this ' +
      'property is UNKNOWN. This is not a statement that no CAM was run and not ' +
      'a statement that nothing is owed.',
      rec, unavailable, degradedCodes, h.reads, c.now,
      { resolvedWithin: a.propertyId, sectionStatus: { cam: status } });
  }

  const caveats = buildCaveats(unavailable, degradedCodes);
  caveats.push({
    code: 'cam.snapshot_scope', severity: SEVERITY.INFO, scope: 'cam',
    message: 'This is the reconciliation snapshot stored on the property record. ' +
             'The cam_reconciliations table is not read here, so rows that exist ' +
             'only in that table are absent — their absence is not a claim that ' +
             'no reconciliation was run.',
  });

  const cam = rec.cam || {};
  const rows = Array.isArray(cam.results) ? cam.results : [];

  // `pool` and `unallocated` are separately composable and separately absent.
  // PropertyRecord reports their loss in meta.unavailable under their own
  // names, which sectionStatus('cam', …) does not look at — so they are read
  // here directly. A pool of 0 is a real answer (no eligible invoices) and must
  // not be confused with a pool nobody could compute.
  const poolUnavailable = unavailable.indexOf('cam.pool') !== -1 || cam.pool == null;
  const unallocUnavailable = unavailable.indexOf('cam.unallocated') !== -1 ||
                             cam.unallocated == null;
  if (poolUnavailable) {
    caveats.push({
      code: 'cam.pool_unavailable', severity: SEVERITY.UNAVAILABLE, scope: 'cam.pool',
      message: 'The eligible expense pool could not be computed. It is null, not ' +
               'zero: this is not a statement that there are no CAM expenses.',
    });
  }
  if (unallocUnavailable) {
    caveats.push({
      code: 'cam.unallocated_unavailable', severity: SEVERITY.UNAVAILABLE,
      scope: 'cam.unallocated',
      message: 'The unallocated remainder could not be derived. It is null, not ' +
               'zero: this is not a statement that the pool is fully allocated.',
    });
  }

  const results = rows.map(_camRow);

  // A tally of trust states, so a caller can see at a glance how much of this
  // reconciliation carries a usable expectation — without having to know the
  // vocabulary, and without any row being promoted to get into a bucket.
  const expectation = { established: 0, withheld: 0, none: 0 };
  const byTrust = {};
  for (const r of results) {
    byTrust[r.expectedCamTrust] = (byTrust[r.expectedCamTrust] || 0) + 1;
    if (r.expectedCamTrust === CAM_TRUST.ARITHMETIC) expectation.established++;
    else if (r.expectedCamTrust === CAM_TRUST.NONE)  expectation.none++;
    else expectation.withheld++;
  }

  if (expectation.withheld > 0) {
    caveats.push({
      code: 'cam.expectation_withheld', severity: SEVERITY.UNAVAILABLE,
      scope: 'cam.results.expectedCam',
      message: expectation.withheld + ' of ' + results.length + ' rows have an ' +
               'expected-CAM state this response will not present as money: a cap ' +
               'percentage stored in a dollar field, a value with no basis stamp ' +
               '(nothing can tell a small ceiling from a percentage by ' +
               'inspection), a stamp with no usable number, or a basis word this ' +
               'build does not recognise. Those rows report expectedCam and ' +
               'variance as null and name their state in expectedCamTrust. This ' +
               'is different from having no expectation at all, which ' +
               'expectation.none counts separately. The stored rows are unchanged.',
    });
  }
  if (expectation.established > 0) {
    caveats.push({
      code: 'cam.basis_is_arithmetic_not_verification', severity: SEVERITY.INFO,
      scope: 'cam.results.expectedCam',
      message: 'A cap_ceiling basis states only which arithmetic produced the ' +
               'expected amount: capBaseAmount x (1 + cap%). It is NOT a claim ' +
               'that the cap base or the cap percentage was read off a lease or ' +
               'confirmed by a reviewer. Call get_lease_evidence for that, and do ' +
               'not describe these figures as lease-supported or verified.',
    });
  }

  return envelope({
    data: {
      propertyId: a.propertyId,
      camYear: (rec.identity && rec.identity.camYear != null) ? rec.identity.camYear : null,
      pool:        poolUnavailable    ? null : cam.pool,
      unallocated: unallocUnavailable ? null : cam.unallocated,
      results,
      resultCount: results.length,
      cappedCount: Array.isArray(cam.capped) ? cam.capped.length : null,
      expectation,
      expectationByTrust: byTrust,
    },
    provenance: {
      origin: rec.meta.origin,
      includesBrowserLocalState: rec.meta.includesBrowserLocalState,
      note: rec.meta.note,
      unavailable: unavailable.slice(), degraded: degradedCodes.slice(),
      sectionStatus: { cam: status,
                       'cam.pool': poolUnavailable ? STATUS.UNAVAILABLE : STATUS.OK,
                       'cam.unallocated': unallocUnavailable ? STATUS.UNAVAILABLE : STATUS.OK },
      reads: h.reads, hydrated: true,
      ownership: 'properties.user_id = authenticated user',
      resolvedWithin: a.propertyId,
      source: 'PropertyRecord.cam — the stored camReconciliation snapshot only; ' +
              'the cam_reconciliations table is NOT read',
      store: STORE.BLOB,
      units: unitsFor(['cam']),
      expectedCamGate: 'expectedCamBasis === "cap_ceiling" AND a finite number — ' +
                       'the same predicate saveCamResults uses before persisting',
    },
    caveats, asOf: c.now,
  });
}

// ── Tool 9: get_attention ──────────────────────────────────────────────────

/**
 * The ranked attention list PropertyWorkspace already derives, projected to
 * facts and stripped of the browser.
 *
 * WHAT IS STRIPPED, AND WHY. Each item as composed carries `icon` (a UI emoji),
 * `nav` ({ tab, anchors }) and `action` (a button label). Those are instructions
 * to a DOM that an MCP caller does not have: `{ tab: 'spaces', anchors:
 * ['cardLeases'] }` names element ids in this application's HTML. Handing them
 * over would invite a client to render a button that goes nowhere, or to quote
 * "Review disputes" as though it were advice from the record. What survives is
 * what is true independently of any screen: severity, what it is, and why.
 *
 * NO RULE IS INVENTED HERE. Every item comes from collectAttention unchanged in
 * substance; this function selects fields and counts them. It adds no threshold,
 * no severity, and no item of its own.
 *
 * "ALL CAUGHT UP" IS NOT AVAILABLE FROM THIS SERVER. collectAttention reads
 * window.Selectors for readiness signals — expired leases, incomplete lease
 * terms, missing caps, low-confidence extractions — and the server graph
 * deliberately excludes Selectors, so those signals are silently absent. The
 * list still composes, so it is DEGRADED rather than unavailable, but it is
 * systematically SHORTER than the application's. An empty list therefore cannot
 * mean "nothing needs attention", and `allClear` is null rather than true to
 * stop exactly that inference being drawn from `items.length === 0`.
 */
async function getAttention(args, ctx) {
  const a = args || {}, c = ctx || {};
  const o = await _open(a, c, null);
  if (o.stop) return o.stop;
  const { h, rec, unavailable, degradedCodes } = o;

  const status = sectionStatus('attention', rec.attention, unavailable, degradedCodes);

  if (status === STATUS.UNAVAILABLE) {
    return _unknownSection('attention',
      'The attention list could not be composed, so what needs attention on this ' +
      'property is UNKNOWN. This is not a statement that nothing does.',
      rec, unavailable, degradedCodes, h.reads, c.now,
      { resolvedWithin: a.propertyId, sectionStatus: { attention: status } });
  }

  const caveats = buildCaveats(unavailable, degradedCodes);
  const raw = Array.isArray(rec.attention) ? rec.attention : [];
  const items = raw.map((it, i) => ({
    rank:     i,                       // the order collectAttention ranked them in
    severity: (it && it.severity) != null ? it.severity : null,
    title:    (it && it.title)    != null ? it.title    : null,
    why:      (it && it.why)      != null ? it.why      : null,
  }));

  const severityCounts = items.reduce((acc, it) => {
    const k = it.severity == null ? 'unknown' : it.severity;
    acc[k] = (acc[k] || 0) + 1; return acc;
  }, {});

  // Complete only if nothing thinned the list. Today the hydrator always
  // reports attention.without_selectors_readiness, so this is false on the
  // server as a matter of course — and it is computed rather than hard-coded so
  // that it becomes true honestly, and only, if that ever stops being the case.
  const complete = status === STATUS.OK || status === STATUS.EMPTY;

  caveats.push({
    code: 'attention.ui_fields_removed', severity: SEVERITY.INFO, scope: 'attention',
    message: 'Each item is reported as severity, title and why. The icon, the ' +
             'in-app navigation target and the button label are application UI ' +
             'and are deliberately not exposed.',
  });
  if (!complete) {
    caveats.push({
      code: 'attention.not_a_complete_list', severity: SEVERITY.UNAVAILABLE,
      scope: 'attention.allClear',
      message: 'This list is composed without the readiness module, so it is ' +
               'shorter than the application would show and an empty list does ' +
               'NOT mean the property is all caught up. allClear is null because ' +
               'nothing here can establish it.',
    });
  }

  return envelope({
    data: {
      propertyId: a.propertyId,
      items,
      itemCount: items.length,
      severityCounts,
      // Null, not false: "we cannot tell" is not "there is something wrong".
      allClear: complete ? items.length === 0 : null,
      complete,
    },
    provenance: {
      origin: rec.meta.origin,
      includesBrowserLocalState: rec.meta.includesBrowserLocalState,
      note: rec.meta.note,
      unavailable: unavailable.slice(), degraded: degradedCodes.slice(),
      sectionStatus: { attention: status },
      reads: h.reads, hydrated: true,
      ownership: 'properties.user_id = authenticated user',
      resolvedWithin: a.propertyId,
      source: 'PropertyWorkspace.collectAttention via PropertyRecord.attention — ' +
              'ranked as composed, projected to severity/title/why',
      store: STORE.BLOB,
      openDisputeRule: DISPUTE_RULE,
      omittedFields: ['icon', 'nav', 'action'],
      rulesAdded: 'none — no attention rule, threshold or severity is defined here',
    },
    caveats, asOf: c.now,
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
  {
    name: 'get_lease_evidence',
    description:
      'The provenance behind one tenant\'s lease fields: which state each value ' +
      'is in, who attested it, and the clause and page it was read from. Nothing ' +
      'is reconstructed. If the evidence could not be read the answer is null, ' +
      'not a list of uncited fields — a confirmed field and an unchecked one are ' +
      'indistinguishable without the evidence rows.',
    inputSchema: {
      type: 'object',
      properties: {
        propertyId: { type: 'string', description: 'Property UUID.' },
        tenantId:   { type: 'string', description: 'Tenant UUID within that property.' },
        fieldKey:   { type: 'string', description: 'Optional. One canonical lease field.' },
      },
      required: ['propertyId', 'tenantId'], additionalProperties: false,
    },
    handler: getLeaseEvidence,
  },
  {
    name: 'get_space',
    description:
      'One space within an owned property: its identity, lease terms, summary, ' +
      'record counts and CAM result. This is the narrow view — get_tenant returns ' +
      'the same space plus disputes, documents and provenance. A space that ' +
      'cannot be composed is reported as unknown, never as not found.',
    inputSchema: {
      type: 'object',
      properties: {
        propertyId: { type: 'string', description: 'Property UUID.' },
        spaceId:    { type: 'string', description: 'Space UUID — the same value as its tenant id.' },
      },
      required: ['propertyId', 'spaceId'], additionalProperties: false,
    },
    handler: getSpace,
  },
  {
    name: 'get_timeline',
    description:
      'The property timeline as STORED IN THE DATABASE, property-wide or scoped ' +
      'to one tenant. A browser session may hold events that were never ' +
      'persisted; those are absent here and their absence is not a claim that ' +
      'they do not exist. Every response says so.',
    inputSchema: {
      type: 'object',
      properties: {
        propertyId: { type: 'string', description: 'Property UUID.' },
        tenantId:   { type: 'string', description: 'Optional. Scope to one tenant.' },
      },
      required: ['propertyId'], additionalProperties: false,
    },
    handler: getTimeline,
  },
  {
    name: 'get_disputes',
    description:
      'Disputes on the stored record, property-wide or for one tenant. If the ' +
      'dispute source could not be read the answer is null with a caveat and the ' +
      'counts are null — never an empty list, and never a count of zero.',
    inputSchema: {
      type: 'object',
      properties: {
        propertyId: { type: 'string', description: 'Property UUID.' },
        tenantId:   { type: 'string', description: 'Optional. Scope to one tenant.' },
      },
      required: ['propertyId'], additionalProperties: false,
    },
    handler: getDisputes,
  },
  {
    name: 'get_cam_status',
    description:
      'The CAM reconciliation stored on an owned property: the eligible pool, ' +
      'the unallocated remainder, and each tenant row. An expected-CAM figure is ' +
      'shown ONLY when the row carries a cap_ceiling basis stamp and a finite ' +
      'value; otherwise expectedCam and variance are null. A cap_ceiling basis ' +
      'describes arithmetic only — it is NOT a claim that the cap base was read ' +
      'off a lease or confirmed by a reviewer, and these figures must never be ' +
      'described as lease-supported or verified. Reads the stored snapshot, not ' +
      'the cam_reconciliations table.',
    inputSchema: {
      type: 'object',
      properties: { propertyId: { type: 'string', description: 'Property UUID.' } },
      required: ['propertyId'], additionalProperties: false,
    },
    handler: getCamStatus,
  },
  {
    name: 'get_attention',
    description:
      'What the verified record says needs attention on an owned property, ' +
      'ranked as the application ranks it: severity, what it is, and why. No ' +
      'icons, navigation targets or button labels — those are application UI. No ' +
      'rule is invented here. The server composes this list without the ' +
      'readiness module, so it is shorter than the application\'s and an empty ' +
      'list does NOT mean the property is all caught up; allClear is null ' +
      'whenever that cannot be established.',
    inputSchema: {
      type: 'object',
      properties: { propertyId: { type: 'string', description: 'Property UUID.' } },
      required: ['propertyId'], additionalProperties: false,
    },
    handler: getAttention,
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
  getLeaseEvidence, getSpace, getTimeline, getDisputes, _resolveSpace,
  getCamStatus, getAttention, _classifyExpectation, _camRow, CAM_TRUST,
  STORE, UNITS, unitsFor, DISPUTE_RULE, AREA_REASON, capAmbiguityCaveat,
  resolveIdentity, envelope, refuse, sectionStatus, sectionValue, buildCaveats,
  REFUSAL, SEVERITY, STATUS, WRITE_METHODS, DEGRADED_SECTIONS, UNKNOWN_CODES, CAVEAT_TEXT,
  _readOnly,
};
