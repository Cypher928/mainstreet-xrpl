'use strict';
/**
 * api/_mcp-transport.js — the external boundary for the nine read-only
 * capabilities, and nothing else.
 *
 * MODULE ONLY. It speaks no HTTP: `serve()` takes a plain request description
 * and returns `{ status, headers, body }`. api/mcp.js is the twelve lines that
 * turn a Node req/res into that and back. Keeping the boundary logic here is
 * what makes every rule below assertable without a socket.
 *
 * ── WHAT M9 IS, AND IS NOT ──────────────────────────────────────────────────
 *
 * The capability layer was finished and gated in M8. This phase adds no
 * capability, changes no CAM rule, no evidence rule and no PropertyRecord
 * semantics. It answers one question: what has to be true before those
 * capabilities may be reached from outside the application?
 *
 * Four things, and they are the whole of this file:
 *
 *   1. the server builds the context, never the caller
 *   2. identity comes from a bearer token, resolved server-side
 *   3. the response is bounded, and says so when it is
 *   4. what leaves is narrower than what the capability returns
 *
 * ── 1. THE CONTEXT IS SERVER-OWNED, AND THAT IS THE P0 ─────────────────────
 *
 * Every capability takes `(args, ctx)`. `ctx` carries `sbFetch`, `authFetch`
 * and `deps` — the seams the M1–M8 tests inject to run offline. A transport
 * that built `ctx` by spreading request JSON would let a caller supply its own
 * database transport and its own auth resolver, which is not a privilege
 * escalation so much as a complete bypass: `sbFetch` decides what rows exist
 * and `authFetch` decides who you are.
 *
 * So `_buildContext` is the ONLY constructor of a ctx in this file, it names
 * every key it sets, it never spreads anything, and it freezes what it returns.
 * The seams are reachable only through `serve()`'s SECOND parameter, which no
 * request can populate — api/mcp.js calls `serve(request)` with one argument,
 * and test-m9 asserts that it does.
 *
 * `ctx.now` is generated here from the same `Date.now()` the rest of the
 * request uses, so `asOf` and the clock `collectAttention` reads cannot
 * disagree by more than the request's own duration. Before M9 a caller supplied
 * it, and the M8 gate measured an envelope confidently stamped 1999.
 *
 * ── 2. TOOL INPUT IS WHITELISTED AGAINST THE TOOL'S OWN SCHEMA ─────────────
 *
 * Each tool already declares `inputSchema` with `additionalProperties: false`.
 * Nothing enforced it. Enforcing it here means a caller cannot smuggle a key
 * into `args` and hope some capability reads it — the argument object handed to
 * a capability contains only keys that tool declares, plus nothing.
 *
 * ── 3. BOUNDING LIVES HERE, NOT IN THE CAPABILITIES ────────────────────────
 *
 * `get_property` returns the whole record. That is the right contract for a
 * read model and the wrong one for an external response: measured at pilot
 * scale (86 tenants, 1000 events) it is 868 KB, and at 300 tenants 3.5 MB.
 *
 * The capabilities are left exactly as M8 closed them. The transport caps what
 * it forwards and DISCLOSES every cap it applied, because a truncated list that
 * does not say it is truncated is the same lie as an empty list that means
 * unknown — the mistake this codebase has spent eight phases not making.
 *
 * Bounding never changes a section's status. `ok`, `empty`, `degraded` and
 * `unavailable` keep their exact M8 meanings; a bounded section is still `ok`
 * and additionally carries an entry in `provenance.bounded` and a caveat. A
 * caller that reads `sectionStatus` alone learns nothing false; a caller that
 * wants completeness reads `bounded`.
 *
 * ── 4. TWO THINGS ARE NARROWED ON THE WAY OUT ──────────────────────────────
 *
 * `provenance.reads` and `fieldProvenance.by` — see PROVENANCE POLICY and
 * REVIEWER POLICY below, each documented where it is implemented.
 *
 * READ-ONLY. This module performs no write, holds no database client of its
 * own, and reaches the database only through the capability layer, whose
 * transport is already wrapped so that a write is refused rather than absent.
 */

const CAP  = require('./_mcp-capabilities.js');
const { checkRate } = require('./_rate-limit');

/** The protocol version this server speaks. */
const PROTOCOL_VERSION = '2024-11-05';
const SERVER_INFO = { name: 'mainstreet-property-record', version: '1.0.0' };

/**
 * Every limit the boundary enforces, in one place so they can be read, tested
 * and tuned without hunting through branches.
 *
 * The rate limits reuse api/_rate-limit.js unchanged — the same sliding window
 * every other handler in api/ uses, at the same 60/minute the authenticated
 * endpoints already apply. Its limitation is real and is not papered over here:
 * it is PER INSTANCE, and Vercel scales instances horizontally with no shared
 * memory, so a caller spread across N warm instances gets up to N × max and a
 * cold start begins at zero. It brakes runaway agent loops and single-client
 * hammering, which is what an MCP client actually does wrong. It is not a
 * defence against a determined attacker and is not a cost ceiling; either would
 * need shared state this codebase deliberately does not have.
 */
const LIMITS = {
  // Per authenticated user, per minute. Matches api/cam-reconciliations.js.
  RATE_MAX: 60,
  RATE_WINDOW_MS: 60000,
  // Per client hint, per minute, applied BEFORE the token is resolved. An
  // unauthenticated flood otherwise costs one auth round-trip per request even
  // though every one of them fails. The key is a hint — a forwarded header is
  // spoofable and shared NATs collide — so it is deliberately looser than the
  // authenticated limit and is a brake, never an authorisation decision.
  RATE_PREAUTH_MAX: 120,
  // Bounded database time. Without it an external request can hold a read open
  // for as long as the upstream is willing to stall.
  DB_TIMEOUT_MS: 8000,
  // Hard caps on what get_property forwards, each disclosed when it bites.
  //
  // Sized against a measured worst case rather than guessed: a 300-tenant,
  // 5000-event property. The first set of numbers here was twice this and the
  // bounded response still came to 1.6 MB, which the size backstop refused —
  // correct behaviour, but a 413 is a worse answer than a disclosed truncation
  // for a property that large. These caps keep that same property comfortably
  // inside the ceiling while still returning a useful record.
  SPACES: 50,
  FIELD_TENANTS: 25,
  TIMELINE_IN_PROPERTY: 50,
  // byTenant is a map of arrays, so it needs a cap on each axis — see _boundData.
  TIMELINE_TENANTS: 25,
  TIMELINE_PER_TENANT: 20,
  DISPUTES: 100,
  DOCUMENTS: 100,
  CAM_ROWS: 100,
  ATTENTION: 50,
  // get_timeline is paginated rather than capped, because paging a timeline is
  // a thing a caller legitimately wants to do.
  PAGE_DEFAULT: 100,
  PAGE_MAX: 500,
  // Backstop. If a response is still this large after every cap above, the caps
  // are wrong; refusing is safer than emitting it.
  MAX_RESPONSE_BYTES: 1048576,
};

/** JSON-RPC 2.0 error codes, plus the two application codes this server adds. */
const RPC = {
  PARSE_ERROR: -32700, INVALID_REQUEST: -32600, METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602, INTERNAL: -32603,
  UNAUTHENTICATED: -32001, RATE_LIMITED: -32002, RESPONSE_TOO_LARGE: -32003,
};

/**
 * The only keys a context may ever have.
 *
 * `token` and `now` are built from the request's Authorization header and the
 * server clock. The other three are test seams and are reachable ONLY through
 * serve()'s second parameter. Exported so a test can assert the set rather than
 * trust this comment.
 */
const CTX_KEYS = ['token', 'now', 'sbFetch', 'authFetch', 'deps'];

/**
 * Build the context. The one place a ctx is created.
 *
 * Note what is absent: there is no `...request`, no `Object.assign` from
 * anything the caller sent, and no parameter that carries caller JSON. Every
 * key is named literally. That is the enforcement — not a filter that could be
 * bypassed by a key nobody thought of, but a constructor that can only ever
 * produce the keys written here.
 */
function _buildContext(bearer, nowMs, seam) {
  const ctx = {
    token: bearer,
    now: new Date(nowMs).toISOString(),
  };
  // Test seams only. `seam` comes from serve()'s second argument, which the
  // HTTP handler does not pass and a request cannot reach.
  if (seam) {
    if (seam.sbFetch)   ctx.sbFetch   = seam.sbFetch;
    if (seam.authFetch) ctx.authFetch = seam.authFetch;
    if (seam.deps)      ctx.deps      = seam.deps;
  }
  return Object.freeze(ctx);
}

// ── tool input ─────────────────────────────────────────────────────────────

/** The tools, as the protocol advertises them — description and schema, no handler. */
function _publicTools() {
  return CAP.TOOLS.map(function (t) {
    const schema = _advertisedSchema(t);
    return { name: t.name, description: t.description, inputSchema: schema };
  });
}

/**
 * The schema a caller sees, which for a paginated tool is wider than the
 * capability's own: `limit` and `offset` are the TRANSPORT's parameters and are
 * consumed here, never forwarded.
 */
function _advertisedSchema(tool) {
  const base = tool.inputSchema || { type: 'object', properties: {} };
  if (!PAGINATED[tool.name]) return base;
  const props = Object.assign({}, base.properties, {
    limit: { type: 'integer', minimum: 1, maximum: LIMITS.PAGE_MAX,
             description: 'Events to return. Default ' + LIMITS.PAGE_DEFAULT +
                          ', maximum ' + LIMITS.PAGE_MAX + '.' },
    offset: { type: 'integer', minimum: 0,
              description: 'Events to skip. Use data.page.nextOffset to continue.' },
  });
  return Object.assign({}, base, { properties: props });
}

/** Which tools the transport pages rather than caps. */
const PAGINATED = { get_timeline: true };

/**
 * Split a caller's input into the arguments a capability may see and the
 * pagination the transport consumes, refusing anything the tool never declared.
 *
 * The schemas have always said `additionalProperties: false` and nothing
 * checked. Checking here means the object reaching a capability contains only
 * keys that capability documents — so an unexpected key is a stated error
 * rather than a value sitting in `args` waiting for someone to read it.
 */
function _splitInput(tool, raw) {
  const input = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
  const declared = Object.keys((tool.inputSchema && tool.inputSchema.properties) || {});
  const paged = !!PAGINATED[tool.name];

  const args = {};
  const page = {};
  const unknown = [];
  for (const k of Object.keys(input)) {
    if (declared.indexOf(k) !== -1) { args[k] = input[k]; continue; }
    if (paged && (k === 'limit' || k === 'offset')) { page[k] = input[k]; continue; }
    unknown.push(k);
  }
  return { args, page, unknown };
}

/** A pagination window, clamped. A caller cannot ask for more than PAGE_MAX. */
function _window(page) {
  let limit = LIMITS.PAGE_DEFAULT;
  if (page.limit !== undefined) {
    const n = Number(page.limit);
    if (!Number.isInteger(n) || n < 1) return { error: 'limit must be an integer of at least 1.' };
    limit = Math.min(n, LIMITS.PAGE_MAX);
  }
  let offset = 0;
  if (page.offset !== undefined) {
    const n = Number(page.offset);
    if (!Number.isInteger(n) || n < 0) return { error: 'offset must be an integer of at least 0.' };
    offset = n;
  }
  return { limit, offset };
}

// ── bounding ───────────────────────────────────────────────────────────────

/**
 * Cap one array, and report what was capped.
 *
 * Returns the original array untouched when it fits, so the overwhelming
 * majority of responses carry no bounding metadata at all and look exactly as
 * they did in M8.
 */
function _cap(list, limit, path, bounded) {
  if (!Array.isArray(list) || list.length <= limit) return list;
  bounded.push({ path: path, returned: limit, total: list.length,
                 limit: limit, more: true });
  return list.slice(0, limit);
}

/** The same, for an object used as a map — bound by key count. */
function _capKeys(obj, limit, path, bounded) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
  const keys = Object.keys(obj);
  if (keys.length <= limit) return obj;
  const out = {};
  for (let i = 0; i < limit; i++) out[keys[i]] = obj[keys[i]];
  bounded.push({ path: path, returned: limit, total: keys.length,
                 limit: limit, more: true });
  return out;
}

/**
 * Apply this tool's caps to an envelope's data.
 *
 * Every section is rebuilt with Object.assign onto a fresh object rather than
 * mutated, because the envelope came from the capability layer and this layer
 * does not own it. A null section is left null: bounding an unknown is not a
 * thing, and replacing null with [] here would undo the whole M8 contract.
 */
function _boundData(toolName, data, bounded) {
  if (!data || typeof data !== 'object') return data;
  const d = Object.assign({}, data);

  if (toolName === 'get_property') {
    d.spaces    = _cap(d.spaces,    LIMITS.SPACES,    'data.spaces',    bounded);
    d.fields    = _capKeys(d.fields, LIMITS.FIELD_TENANTS, 'data.fields', bounded);
    d.disputes  = _cap(d.disputes,  LIMITS.DISPUTES,  'data.disputes',  bounded);
    d.documents = _cap(d.documents, LIMITS.DOCUMENTS, 'data.documents', bounded);
    d.attention = _cap(d.attention, LIMITS.ATTENTION, 'data.attention', bounded);
    if (d.cam && typeof d.cam === 'object') {
      d.cam = Object.assign({}, d.cam, {
        results: _cap(d.cam.results, LIMITS.CAM_ROWS, 'data.cam.results', bounded),
        capped:  _cap(d.cam.capped,  LIMITS.CAM_ROWS, 'data.cam.capped',  bounded),
      });
    }
    if (d.timeline && typeof d.timeline === 'object') {
      // byTenant is bounded on BOTH axes. Capping only the events per tenant
      // leaves the map itself unbounded — a 300-tenant property returned 300
      // keys × 25 events and blew the size backstop, which is how this was
      // found. One cap on the number of spaces indexed, one on each list.
      let bt = _capKeys(d.timeline.byTenant, LIMITS.TIMELINE_TENANTS,
                        'data.timeline.byTenant', bounded);
      if (bt && typeof bt === 'object' && !Array.isArray(bt)) {
        const capped = {};
        for (const k of Object.keys(bt)) {
          capped[k] = _cap(bt[k], LIMITS.TIMELINE_PER_TENANT,
                           'data.timeline.byTenant.' + k, bounded);
        }
        bt = capped;
      }
      d.timeline = Object.assign({}, d.timeline, {
        property: _cap(d.timeline.property, LIMITS.TIMELINE_IN_PROPERTY,
                       'data.timeline.property', bounded),
        byTenant: bt,
      });
    }
  } else if (toolName === 'get_tenant') {
    d.disputes  = _cap(d.disputes,  LIMITS.DISPUTES,  'data.disputes',  bounded);
    d.documents = _cap(d.documents, LIMITS.DOCUMENTS, 'data.documents', bounded);
  } else if (toolName === 'get_disputes') {
    d.disputes  = _cap(d.disputes,  LIMITS.DISPUTES,  'data.disputes',  bounded);
  } else if (toolName === 'get_attention') {
    d.items     = _cap(d.items,     LIMITS.ATTENTION, 'data.items',     bounded);
  }
  return d;
}

/**
 * get_timeline is paged, not capped.
 *
 * `eventCount` is left exactly as the capability computed it — the TRUE total —
 * and `page` says what this response actually carries. Two numbers that mean
 * different things, both named, neither standing in for the other.
 */
function _pageTimeline(data, win) {
  if (!data || typeof data !== 'object') return data;
  const events = data.events;
  if (!Array.isArray(events)) return data;      // null stays null: unknown, not empty
  const slice = events.slice(win.offset, win.offset + win.limit);
  const more = win.offset + slice.length < events.length;
  return Object.assign({}, data, {
    events: slice,
    page: {
      limit: win.limit, offset: win.offset, returned: slice.length,
      total: events.length, more: more,
      nextOffset: more ? win.offset + slice.length : null,
    },
  });
}

// ── what is narrowed on the way out ────────────────────────────────────────

/**
 * PROVENANCE POLICY — summarise `reads`, do not delete it.
 *
 * The capability layer records every PostgREST path it issued, and that is
 * genuinely useful provenance: it is how a caller knows which stores an answer
 * came out of. Externally it is also a schema disclosure — table names, exact
 * column lists, filter shapes and the caller's own uuid, e.g.
 *
 *     /properties?id=eq.<uuid>&user_id=eq.<uuid>&select=id,name,sqft,data
 *
 * Three options were on the table: forward it raw, redact it, or summarise it.
 * Raw hands an external agent this system's schema for no benefit it can use.
 * Deleting it removes provenance a caller has a legitimate interest in, which
 * the M9 brief explicitly rules out.
 *
 * So it is summarised: which tables were read, and how many reads each took.
 * That preserves the answerable question — "what did this come from?" — and
 * drops the column lists, the filters and the identifier. The unsummarised form
 * remains available inside the application, where it is not a disclosure.
 */
function _summariseReads(reads) {
  if (!Array.isArray(reads)) return reads === undefined ? undefined : null;
  const byTable = {};
  for (const r of reads) {
    const m = /^\/([A-Za-z0-9_]+)/.exec(String(r || ''));
    const t = m ? m[1] : 'unknown';
    byTable[t] = (byTable[t] || 0) + 1;
  }
  return { tables: Object.keys(byTable).sort(), readCount: reads.length, byTable: byTable };
}

/**
 * REVIEWER POLICY — keep the claim, drop the address.
 *
 * `fieldProvenance.by` carries a reviewer's email. Internally that is right:
 * the person who confirmed a lease term should be nameable to the manager whose
 * staff they are. Externally the caller is an AI agent that will log, cache and
 * transmit whatever it receives, and the address buys it nothing.
 *
 * What matters to a reader is the CLAIM, and the claim survives without the
 * address: `state: 'manually_confirmed'` already entails that a named reviewer
 * approved the field — the resolver cannot reach that state without one — and
 * `when` says at what time. The only thing lost by nulling `by` outright is the
 * distinction, on `manually_entered`, between "we know who typed this" and
 * "nothing on file names who", which is a real difference the record makes.
 *
 * So `by` becomes null and `byPresent` states whether an identity was on file.
 * Nothing about internal provenance semantics changes; field-provenance.js is
 * untouched and the in-app surfaces still show the reviewer.
 */
function _redactField(f) {
  if (!f || typeof f !== 'object') return f;
  if (!('by' in f)) return f;
  return Object.assign({}, f, { by: null, byPresent: f.by != null });
}

/** Redact every provenance object wherever a capability places one. */
function _redactReviewers(toolName, data) {
  if (!data || typeof data !== 'object') return data;
  const d = Object.assign({}, data);

  const mapFields = function (byField) {
    if (!byField || typeof byField !== 'object') return byField;
    const out = {};
    for (const k of Object.keys(byField)) out[k] = _redactField(byField[k]);
    return out;
  };

  if (d.fields && typeof d.fields === 'object') {          // get_property
    const out = {};
    for (const tid of Object.keys(d.fields)) out[tid] = mapFields(d.fields[tid]);
    d.fields = out;
  }
  if (d.fieldProvenance) d.fieldProvenance = mapFields(d.fieldProvenance); // get_tenant
  if (d.evidence)        d.evidence        = mapFields(d.evidence);        // get_lease_evidence
  return d;
}

// ── the envelope, on the way out ───────────────────────────────────────────

const BOUNDED_CAVEAT = 'response.bounded';
const REDACTED_CAVEAT = 'response.redacted_for_transport';

/**
 * Apply every outbound rule to one capability envelope.
 *
 * Order matters only in that bounding runs before the size check, so the check
 * measures what will actually be sent.
 */
function _project(toolName, env, win) {
  const bounded = [];
  let data = env.data;

  if (data !== null && data !== undefined) {
    data = _redactReviewers(toolName, data);
    data = (toolName === 'get_timeline' && win) ? _pageTimeline(data, win) : data;
    data = _boundData(toolName, data, bounded);
  }

  const prov = Object.assign({}, env.provenance || {});
  if ('reads' in prov) prov.reads = _summariseReads(prov.reads);
  prov.transport = {
    boundary: 'external MCP transport',
    contextOwnedBy: 'server',
    asOfSource: 'server clock, generated per request',
    limits: {
      rateMaxPerMinute: LIMITS.RATE_MAX,
      dbTimeoutMs: LIMITS.DB_TIMEOUT_MS,
      pageMax: LIMITS.PAGE_MAX,
    },
    readsPolicy: 'summarised — tables and counts, not query strings',
    reviewerPolicy: 'reviewer identity withheld; byPresent states whether one is on file',
  };
  if (bounded.length) prov.bounded = bounded;

  const caveats = Array.isArray(env.caveats) ? env.caveats.slice() : [];
  if (bounded.length) {
    caveats.push({
      code: BOUNDED_CAVEAT, severity: 'degraded', scope: 'response',
      message: 'This response was bounded by the transport. ' +
        bounded.map(function (b) {
          return b.path + ' returned ' + b.returned + ' of ' + b.total;
        }).join('; ') +
        '. The sections are NOT empty and their status is unchanged — they are ' +
        'truncated, and every truncation is listed in provenance.bounded. Use ' +
        'get_timeline for a paged property timeline and get_lease_evidence for ' +
        'one tenant\'s full field provenance.',
    });
  }
  caveats.push({
    code: REDACTED_CAVEAT, severity: 'info', scope: 'provenance',
    message: 'Two fields are narrowed at this boundary and nowhere else: ' +
      'provenance.reads is summarised to tables and counts rather than query ' +
      'strings, and reviewer identity is withheld — fieldProvenance.by is null ' +
      'with byPresent stating whether an identity is on file. A state of ' +
      'manually_confirmed still means a named reviewer approved the field.',
  });

  return { data: data, provenance: prov, caveats: caveats, asOf: env.asOf };
}

// ── dispatch ───────────────────────────────────────────────────────────────

function _rpcError(id, code, message, data) {
  const err = { code: code, message: message };
  if (data !== undefined) err.data = data;
  return { jsonrpc: '2.0', id: id === undefined ? null : id, error: err };
}
function _rpcResult(id, result) {
  return { jsonrpc: '2.0', id: id === undefined ? null : id, result: result };
}

/**
 * An envelope carried as MCP tool content, with the structured form beside it.
 *
 * Both representations are sent because clients differ on which they read, and
 * an agent that saw neither would get nothing. The text one is COMPACT: it is
 * the same envelope a second time, and pretty-printing it spent roughly a third
 * of the response on indentation an agent does not read.
 */
function _toolResult(env) {
  return {
    content: [{ type: 'text', text: JSON.stringify(env) }],
    structuredContent: env,
    // A refusal is a truthful answer about authorisation, not a protocol fault,
    // so it is a result. `isError` marks it so an agent does not read a refusal
    // envelope as data.
    isError: env.data === null && Array.isArray(env.caveats) &&
             env.caveats.some(function (c) { return c && c.severity === 'refusal'; }),
  };
}

/**
 * Serve one request.
 *
 * @param {object} request  { httpMethod, headers, body, nowMs }
 *        `headers` is read for exactly two names: authorization and a client
 *        hint for pre-auth rate limiting. `body` is the JSON-RPC message.
 * @param {object} [seam]   TEST ONLY — { sbFetch, authFetch, deps, checkRate }.
 *        api/mcp.js calls this function with ONE argument. Nothing in `request`
 *        can populate this parameter; that is the entire mechanism by which a
 *        caller cannot reach the capability layer's injection points.
 */
async function serve(request, seam) {
  const req = request || {};
  // THE CLOCK IS READ FROM THE SEAM, NOT FROM THE REQUEST.
  //
  // This used to be `req.nowMs ?? Date.now()`. `request` is the object built
  // FROM the HTTP request, so putting a clock override on it made asOf settable
  // through the same parameter a caller influences — one refactor in api/mcp.js
  // away from being live. Mutation testing found it: removing the override
  // changed nothing any test could see, which is what an unreachable-but-real
  // seam looks like. It now sits beside the other test seams, on the parameter
  // the HTTP handler does not pass.
  const nowMs = (seam && typeof seam.nowMs === 'number') ? seam.nowMs : Date.now();
  const headers = req.headers || {};
  const rate = (seam && seam.checkRate) || checkRate;

  if (String(req.httpMethod || 'POST').toUpperCase() !== 'POST') {
    return { status: 405, headers: { Allow: 'POST' },
             body: _rpcError(null, RPC.INVALID_REQUEST, 'This endpoint accepts POST only.') };
  }

  // Pre-auth brake. Keyed on a client hint, which is exactly that — it gates
  // nothing and decides nothing about identity.
  const hint = String(headers['x-forwarded-for'] || headers['X-Forwarded-For'] ||
                      req.ip || 'unknown').split(',')[0].trim();
  const pre = rate('mcp:pre:' + hint, LIMITS.RATE_PREAUTH_MAX, LIMITS.RATE_WINDOW_MS);
  if (!pre.ok) {
    return { status: 429, headers: { 'Retry-After': String(pre.retryAfterSec) },
             body: _rpcError(null, RPC.RATE_LIMITED,
               'Too many requests. Retry in ' + pre.retryAfterSec + 's.',
               { retryAfterSec: pre.retryAfterSec }) };
  }

  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { status: 400, headers: {},
             body: _rpcError(null, RPC.INVALID_REQUEST, 'Expected a JSON-RPC 2.0 object.') };
  }
  const id = body.id;
  const method = body.method;
  if (typeof method !== 'string') {
    return { status: 400, headers: {},
             body: _rpcError(id, RPC.INVALID_REQUEST, 'A string "method" is required.') };
  }

  const bearer = String(headers.authorization || headers.Authorization || '')
    .replace(/^Bearer\s+/i, '').trim();

  // AUTHENTICATION GATES EVERY METHOD, INCLUDING DISCOVERY.
  //
  // tools/list returns only names, descriptions and schemas, so exposing it
  // unauthenticated would leak little. It is gated anyway because one rule is
  // auditable and two are a place for the wrong one to be applied: there is no
  // path through this function that reaches a capability, or a tool listing,
  // without a resolved user.
  if (!bearer) {
    return { status: 401, headers: {},
             body: _rpcError(id, RPC.UNAUTHENTICATED,
               'Authentication required — send a bearer token.') };
  }

  const ctx = _buildContext(bearer, nowMs, seam);
  const identity = await CAP.resolveIdentity(ctx.token, ctx.authFetch);
  if (!identity.ok) {
    const unavailable = identity.reason === CAP.REFUSAL.AUTH_UNAVAILABLE;
    return { status: unavailable ? 503 : 401, headers: {},
             body: _rpcError(id, RPC.UNAUTHENTICATED,
               'The caller could not be authenticated.', { reason: identity.reason }) };
  }

  // Authenticated rate limit, on the identity the server resolved — never on
  // anything the caller asserted about itself.
  const verdict = rate('mcp:user:' + identity.userId, LIMITS.RATE_MAX, LIMITS.RATE_WINDOW_MS);
  if (!verdict.ok) {
    return { status: 429, headers: { 'Retry-After': String(verdict.retryAfterSec) },
             body: _rpcError(id, RPC.RATE_LIMITED,
               'Too many requests. Retry in ' + verdict.retryAfterSec + 's.',
               { retryAfterSec: verdict.retryAfterSec, limit: verdict.limit }) };
  }
  const rlHeaders = {
    'X-RateLimit-Limit': String(LIMITS.RATE_MAX),
    'X-RateLimit-Remaining': String(verdict.remaining),
  };

  if (method === 'initialize') {
    return { status: 200, headers: rlHeaders, body: _rpcResult(id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: { listChanged: false } },
      serverInfo: SERVER_INFO,
      instructions:
        'Read-only access to a property record. Every response is ' +
        '{data, provenance, caveats, asOf}. A section reported as unavailable ' +
        'is null and null never means none. Values withheld by a trust gate are ' +
        'null with a stated reason; do not substitute your own estimate for one.',
    }) };
  }

  if (method === 'notifications/initialized') {
    return { status: 202, headers: rlHeaders, body: null };
  }

  if (method === 'tools/list') {
    return { status: 200, headers: rlHeaders,
             body: _rpcResult(id, { tools: _publicTools() }) };
  }

  if (method !== 'tools/call') {
    return { status: 404, headers: rlHeaders,
             body: _rpcError(id, RPC.METHOD_NOT_FOUND, 'Unknown method: ' + method) };
  }

  // ── tools/call ───────────────────────────────────────────────────────────
  const params = (body.params && typeof body.params === 'object') ? body.params : {};
  const name = params.name;
  if (typeof name !== 'string' || !name) {
    return { status: 400, headers: rlHeaders,
             body: _rpcError(id, RPC.INVALID_PARAMS, 'params.name must be a tool name.') };
  }
  const tool = CAP.TOOLS.find(function (t) { return t.name === name; });
  if (!tool) {
    return { status: 404, headers: rlHeaders,
             body: _rpcError(id, RPC.METHOD_NOT_FOUND, 'No such tool: ' + name) };
  }

  const split = _splitInput(tool, params.arguments);
  if (split.unknown.length) {
    return { status: 400, headers: rlHeaders,
             body: _rpcError(id, RPC.INVALID_PARAMS,
               'Unknown argument' + (split.unknown.length === 1 ? '' : 's') + ': ' +
               split.unknown.join(', ') + '. This tool accepts only: ' +
               Object.keys(_advertisedSchema(tool).properties || {}).join(', ') + '.') };
  }
  let win = null;
  if (PAGINATED[name]) {
    win = _window(split.page);
    if (win.error) {
      return { status: 400, headers: rlHeaders,
               body: _rpcError(id, RPC.INVALID_PARAMS, win.error) };
    }
  }

  // The capability layer runs with a context this function built. `split.args`
  // is data; it never becomes part of ctx.
  let env;
  try {
    env = await tool.handler(split.args, ctx);
  } catch (e) {
    return { status: 500, headers: rlHeaders,
             body: _rpcError(id, RPC.INTERNAL, 'The capability failed to complete.') };
  }

  const projected = _project(name, env, win);

  const payload = _toolResult(projected);
  const bytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
  if (bytes > LIMITS.MAX_RESPONSE_BYTES) {
    // Fail closed. Reaching here means a cap above is wrong; emitting a
    // multi-megabyte body to an agent is the worse of the two outcomes.
    return { status: 413, headers: rlHeaders,
             body: _rpcError(id, RPC.RESPONSE_TOO_LARGE,
               'The response exceeded the transport size limit and was not sent. ' +
               'Request a narrower scope — get_space, get_lease_evidence, or ' +
               'get_timeline with a smaller limit.',
               { bytes: bytes, maxBytes: LIMITS.MAX_RESPONSE_BYTES }) };
  }

  return { status: 200, headers: rlHeaders, body: _rpcResult(id, payload) };
}

module.exports = {
  serve,
  LIMITS, RPC, CTX_KEYS, PROTOCOL_VERSION, SERVER_INFO,
  BOUNDED_CAVEAT, REDACTED_CAVEAT, PAGINATED,
  // Exported so the boundary rules can be asserted directly rather than only
  // through a full request.
  _buildContext, _splitInput, _window, _cap, _capKeys, _boundData,
  _pageTimeline, _summariseReads, _redactField, _redactReviewers,
  _project, _publicTools, _advertisedSchema,
};
