'use strict';
/**
 * api/_property-record-hydrator.js — a PropertyRecord built from database truth.
 *
 * MODULE ONLY. There is no HTTP route in this phase and this file exports no
 * handler. It reads; it writes nothing, anywhere. There is no INSERT, UPDATE,
 * DELETE or RPC in it, and no code path that could reach one.
 *
 * ── WHAT IT IS FOR ──────────────────────────────────────────────────────────
 *
 * loadPropertyData() in script.js cannot be the server-side answer, and not
 * merely because it is browser-bound. It MERGES localStorage into database
 * truth: tenants and invoices come from whichever source has MORE rows,
 * disputes are the union of both, and the timeline is merged. So a browser's
 * PropertyRecord can contain tenants, disputes and timeline events that exist
 * nowhere but that browser. The server cannot reproduce them, and the important
 * thing is that it must not pretend to.
 *
 * This hydrator therefore returns strictly less than the browser sometimes has,
 * and says so: meta.origin === 'server' and meta.includesBrowserLocalState ===
 * false. Those are structured flags, meant to be read by machines. The prose in
 * meta.note is documentation for a human and nothing should branch on it.
 *
 * ── THE AUTHORIZATION BOUNDARY ──────────────────────────────────────────────
 *
 * Bearer token → userId → _ownsProperty(propertyId, userId) → read.
 *
 * Service-role credentials are used for TRANSPORT, exactly as every other
 * handler in api/ does, and never as a substitute for the check. Two independent
 * things have to hold before a row is returned:
 *
 *   1. _ownsProperty() confirms the (property, user) pair exists, and
 *   2. the property read ITSELF carries user_id=eq.<uid>
 *
 * Either alone would be sufficient today. Both are here because a regression in
 * one still fails closed, and "fails closed" is the only acceptable failure mode
 * for a cross-tenant read.
 *
 * ── THE THREE READS, AND THE TWO THAT ARE DELIBERATELY ABSENT ───────────────
 *
 *   1. properties            — id, name, sqft, data   (ownership in the query)
 *   2. tenants               — FALLBACK ONLY, when data.tenants is empty. The
 *                              table lacks review, reviewOverrides and
 *                              capBaseAmount, so the blob wins whenever it has
 *                              anything.
 *   3. tenant_field_evidence — REQUIRED, and the non-obvious one. _stripBlobs
 *                              removes fieldEvidence from both the Supabase
 *                              payload and the localStorage write, so the blob
 *                              does not contain it. Skip this read and the whole
 *                              `fields` provenance section is silently wrong —
 *                              present, plausible, and empty.
 *
 * P5-6B — AND THE ACQUISITION MEMORY, READ AS THE CALLER
 *
 *   4–8. acquisition_document_families, acquisition_documents,
 *        acquisition_term_decisions, acquisition_reviews (converted),
 *        property_events (stage_changed) — by property_id, in the columns
 *        PropertyLeaseholds.SELECT names, composed by PropertyLeaseholds.memory()
 *        into ONE section, record.acquisition.
 *
 *   These five do NOT use the service transport. The service role holds no
 *   privilege on families or decisions, and is not given one. They run with
 *   the caller's own Supabase access token and the publishable key, so the
 *   tables' existing RLS judges every row, and only after the two ownership
 *   layers above and the managed-stage check have passed. Two transports in
 *   one module is deliberate: service role for what this module has always
 *   read, the caller for what the database already lets the caller read.
 *
 * NOT read: tenant_review_audit (feeds activityLog, which PropertyRecord never
 * looks at) and cam_reconciliations (the record's cam section reads the
 * camReconciliation snapshot from the blob; the browser's extra merge goes
 * through loadCamResults(id, getCamYear()), and getCamYear() is localStorage
 * session state that has no meaning on a server).
 */

// String-literal requires only. A computed path is invisible to the bundler
// that builds the serverless function, so the file would simply not be there at
// runtime. See the header of api/_server-deps.js.
const _t   = require('./_pilot-target');
const DEPS = require('./_server-deps');
const TN   = require('../tenant-normalize.js');
const PropertyRecord = require('../property-record.js');
// P3 — the shared, pure lifecycle rule. A PropertyRecord is a MANAGED
// property's record; a prospect or passed deal is refused by name, not
// hydrated as if it were part of the portfolio.
const PropertyLifecycle = require('../property-lifecycle.js');
// P5-6B — the acquisition memory is composed by the SAME pure module the
// browser's Property Workspace uses (standing decisions, at-acquisition
// states, the episode). Only its memory() composer is called here: never
// set()/get()/forTenant(), whose map is page-lifetime state that on a warm
// server would be shared across requests and users.
const PropertyLeaseholds = require('../property-leaseholds.js');

const SUPABASE_URL      = _t.url;
const SUPABASE_ANON_KEY = _t.anonKey;

/** Transport credential. Service role when configured, exactly as api/ does. */
function _key() { return _t.serviceRoleKey || SUPABASE_ANON_KEY; }

/**
 * M9 — every read is time-bounded.
 *
 * An external caller can otherwise hold a database read open for as long as the
 * upstream is willing to stall, and an agent that retries turns one slow query
 * into an unbounded number of them. The bound is deliberately generous: it is a
 * ceiling on pathology, not a latency target.
 *
 * A timeout is reported as a failed read, which every caller above already
 * handles — the ownership check treats a non-2xx as a refusal, the property read
 * returns `read_failed`, and tenants/evidence degrade with a stated code. That
 * matters more than it looks: a thrown AbortError would have escaped `hydrate()`
 * entirely, and the transport would have turned it into an opaque 500 rather
 * than an answer that says which section is unknown and why.
 */
const READ_TIMEOUT_MS = 8000;

/** The default PostgREST transport. Injectable so tests never touch a network. */
async function _defaultFetch(pathAndQuery, options = {}) {
  const k = _key();
  let res;
  try {
    res = await fetch(`${SUPABASE_URL}/rest/v1${pathAndQuery}`, {
      signal: AbortSignal.timeout(READ_TIMEOUT_MS),
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'apikey': k,
        'Authorization': `Bearer ${k}`,
        'Prefer': '',
        ...(options.headers || {}),
      },
    });
  } catch (e) {
    const timedOut = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
    return {
      status: timedOut ? 504 : 502,
      json: { error: timedOut ? 'read_timeout' : 'read_unreachable',
              timeoutMs: timedOut ? READ_TIMEOUT_MS : null },
    };
  }
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, json };
}

/**
 * P5-6B — the CALLER'S transport, for the acquisition reads only.
 *
 * The service role holds no privilege on acquisition_document_families or
 * acquisition_term_decisions (024b / 026c: "no server code touches this
 * table"), and P5-6B does not grant it one. These reads therefore run as the
 * authenticated caller: the publishable key as `apikey` — never the service
 * key, so the request cannot be treated as service-role — and the caller's own
 * Supabase access token as the bearer. PostgREST runs them as `authenticated`
 * with auth.uid() = the caller, under the tables' existing RLS. That is the
 * database's own boundary behind the ownership check hydrate() has already
 * passed.
 *
 * The token is used for this request and nothing else: it is not returned, not
 * logged, not placed in `reads`, the record, an error or a caveat.
 */
async function _defaultUserFetch(pathAndQuery, token, options = {}) {
  if (!SUPABASE_ANON_KEY || !token) return { status: 401, json: { error: 'no_user_session' } };
  let res;
  try {
    res = await fetch(`${SUPABASE_URL}/rest/v1${pathAndQuery}`, {
      signal: AbortSignal.timeout(READ_TIMEOUT_MS),
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${token}`,
        'Prefer': '',
      },
    });
  } catch (e) {
    const timedOut = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
    return {
      status: timedOut ? 504 : 502,
      json: { error: timedOut ? 'read_timeout' : 'read_unreachable',
              timeoutMs: timedOut ? READ_TIMEOUT_MS : null },
    };
  }
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, json };
}

/** The ceiling on rows per acquisition read. A read that reaches it may be cut short, and says so. */
const ACQ_ROW_LIMIT = 1000;

/**
 * P5-6B — the five acquisition reads, for ONE property the caller owns, in
 * the column lists PropertyLeaseholds.SELECT defines (the browser's loader
 * asks for the same, with the review read widened by exactly two frozen paths:
 * SELECT.memoryReviews). Every read is filtered by that property's id; the
 * review read by status = converted; the events read by action =
 * stage_changed. Run in parallel; any failure is named, never swallowed.
 */
async function _readAcquisition(userSb, propertyId) {
  const S = PropertyLeaseholds.SELECT;
  const pid = encodeURIComponent(propertyId);
  const sel = (s) => encodeURIComponent(String(s).replace(/\s+/g, ''));
  const lim = `&limit=${ACQ_ROW_LIMIT}`;
  const paths = {
    families:  `/acquisition_document_families?property_id=eq.${pid}&select=${sel(S.families)}&order=created_at.asc${lim}`,
    documents: `/acquisition_documents?property_id=eq.${pid}&select=${sel(S.documents)}&order=created_at.asc${lim}`,
    decisions: `/acquisition_term_decisions?property_id=eq.${pid}&select=${sel(S.decisions)}&order=decided_at.asc${lim}`,
    reviews:   `/acquisition_reviews?property_id=eq.${pid}&status=eq.converted&select=${sel(S.memoryReviews)}${lim}`,
    events:    `/property_events?property_id=eq.${pid}&action=eq.stage_changed&select=${sel(S.events)}&order=created_at.asc${lim}`,
  };
  const names = Object.keys(paths);
  const results = await Promise.all(names.map(async (n) => {
    try { return await userSb(paths[n], { method: 'GET' }); } catch (_e) { return null; }
  }));
  const rows = {}, failed = [], truncated = [];
  names.forEach((n, i) => {
    const r = results[i];
    if (!r || r.status >= 300 || !Array.isArray(r.json)) { failed.push(n); rows[n] = []; return; }
    rows[n] = r.json;
    if (r.json.length >= ACQ_ROW_LIMIT) truncated.push(n);
  });
  return { rows, failed, truncated };
}

/** Methods that would change data. None of them may ever appear here. */
const WRITE_METHODS = ['POST', 'PATCH', 'PUT', 'DELETE'];

/**
 * Wrap a transport so a write is refused rather than merely absent. A read-only
 * module that only happens not to write today is one edit away from writing.
 */
function _readOnly(fetchImpl) {
  return async function guarded(pathAndQuery, options = {}) {
    const method = (options.method || 'GET').toUpperCase();
    if (WRITE_METHODS.indexOf(method) !== -1) {
      throw new Error('[hydrator] refused a ' + method + ' — this module is read-only');
    }
    return fetchImpl(pathAndQuery, options);
  };
}

/**
 * Ownership. Mirrors _ownsProperty in api/cam-reconciliations.js and
 * api/lease-documents.js: the (property, user) pair must exist. Any non-2xx, or
 * an empty result, is a refusal.
 */
async function _ownsProperty(sb, propertyId, userId) {
  const r = await sb(
    `/properties?id=eq.${encodeURIComponent(propertyId)}` +
    `&user_id=eq.${encodeURIComponent(userId)}&select=id`,
    { method: 'GET' });
  if (r.status >= 300) return false;
  return Array.isArray(r.json) && r.json.length > 0;
}

/**
 * One tenant_field_evidence row → the snapshot shape FieldProvenance reads.
 *
 * Field-for-field identical to _evidenceRowToSnapshot in script.js, and it has
 * to be: FieldProvenance reads `page`, not `sourcePage`, and getting that wrong
 * does not throw — it silently drops the page citation from every field. There
 * is a regression assertion below that compares the two implementations key by
 * key rather than trusting this comment.
 */
function _evidenceRowToSnapshot(row) {
  return {
    value:                  row.value,
    confidence:             { status: row.confidence_status, note: row.confidence_note },
    sourceFile:             row.source_file,
    page:                   row.source_page,
    extractionId:           row.extraction_id,
    extractionVersion:      row.extraction_version,
    reviewerUid:            row.reviewer_uid,
    reviewerEmail:          row.reviewer_email,
    reviewedAt:             row.reviewed_at,
    approved:               row.approved,
    manuallyEdited:         row.manually_edited,
    originalExtractedValue: row.original_extracted_value,
    quote:                  row.quote != null ? row.quote : null,
  };
}

const REFUSAL = {
  NO_USER:      'authentication_required',
  NOT_OWNED:    'not_authorized',
  NOT_FOUND:    'property_not_found',
  // P3 — owned, present, but at a pre-acquisition or passed lifecycle stage.
  NOT_MANAGED:  'property_not_managed',
  READ_FAILED:  'read_failed',
};

/**
 * Build the canonical PropertyRecord for one property, from the database only.
 *
 * @param {object} opts
 *   propertyId  {string}   required
 *   userId      {string}   required — the AUTHENTICATED user. Absent ⇒ refused.
 *   sbFetch     {function} optional transport, for tests. Wrapped read-only.
 *   deps        {object}   optional dependency set, for tests.
 *   userToken   {string}   P5-6B — the caller's Supabase access token, the one
 *                          the userId was resolved from. Used ONLY for the
 *                          acquisition reads, as the caller. Absent ⇒ the
 *                          acquisition section is `unavailable`; the service
 *                          transport is never used in its place.
 *   userFetch   {function} P5-6B — optional caller transport, for tests:
 *                          (pathAndQuery, token, options). Wrapped read-only.
 * @returns {Promise<{ok, record?, reason?, reads, degraded}>}
 */
async function hydrate(opts) {
  const o = opts || {};
  const propertyId = o.propertyId;
  const userId     = o.userId;
  const reads      = [];

  // Fail closed, and before any transport is touched. An unauthenticated call
  // must not be able to cause a database read at all, let alone return a row.
  if (!userId || typeof userId !== 'string') {
    return { ok: false, reason: REFUSAL.NO_USER, reads, degraded: [] };
  }
  if (!propertyId || typeof propertyId !== 'string') {
    return { ok: false, reason: REFUSAL.NOT_FOUND, reads, degraded: [] };
  }

  const raw = o.sbFetch || _defaultFetch;
  const sb  = _readOnly(async (p, options) => { reads.push(p); return raw(p, options); });

  // ── 0. Ownership, checked independently of the read that follows ─────────
  if (!(await _ownsProperty(sb, propertyId, userId))) {
    return { ok: false, reason: REFUSAL.NOT_OWNED, reads, degraded: [] };
  }

  // ── 1. The property. The user_id filter is REDUNDANT with the check above,
  //      and that is the point: one regression should not open a cross-tenant
  //      read. ──────────────────────────────────────────────────────────────
  const propRes = await sb(
    `/properties?id=eq.${encodeURIComponent(propertyId)}` +
    `&user_id=eq.${encodeURIComponent(userId)}&select=id,name,sqft,data,lifecycle_stage,acquired_at`,
    { method: 'GET' });
  if (propRes.status >= 300) return { ok: false, reason: REFUSAL.READ_FAILED, reads, degraded: [] };
  const rows = Array.isArray(propRes.json) ? propRes.json : [];
  if (!rows.length) return { ok: false, reason: REFUSAL.NOT_FOUND, reads, degraded: [] };

  const row  = rows[0];

  // ── 1b. Lifecycle (P3). A prospect or passed deal is a property row, but it
  //      is not a managed property, and this record describes managed
  //      properties. Refused by its own reason so the caller is not told the
  //      building does not exist. A row with no stage predates migration 023
  //      and is managed, which is what PropertyLifecycle's default says. ────
  if (!PropertyLifecycle.isManaged(row)) {
    return { ok: false, reason: REFUSAL.NOT_MANAGED, reads, degraded: [] };
  }
  const d    = row.data || {};
  const degraded = [];

  // A property row can exist with no stored blob at all — a property created
  // but never saved. Every section below then reads `d.<x> || []` and produces
  // an empty list, which is indistinguishable from "we looked, and there are
  // none". For disputes in particular that is the difference between "this
  // property has no disputes" and "nothing has ever been recorded about this
  // property", and a caller acting on the first when the second is true is
  // exactly the failure a verified-memory system exists to prevent.
  //
  // Reported as a degradation rather than in meta.unavailable, because
  // assemble() DOES compose every section — it composes them from nothing.
  if (row.data == null || typeof row.data !== 'object') {
    degraded.push('property.no_stored_record');
  }

  // The in-memory shape loadPropertyData builds, minus everything that can only
  // come from a browser. Fields are read exactly as that function reads them.
  const property = {
    id:                row.id,
    name:              row.name,
    // M8d — ABSENCE STAYS ABSENCE. This was `row.sqft || 0`.
    //
    // `properties.sqft` is a nullable numeric with no default, and both NULL and
    // a real 0 occur (addNewProperty creates `totalSqft: 0`; migration 014's own
    // comment refers to "an abandoned 0-sqft New Property"). The `|| 0` turned
    // the first into the second, so a property whose area was never entered
    // reported `identity.totalSqft: 0` — a building stated to have no area.
    //
    // PropertyRecord already refuses that: test-property-record J14 pins "a
    // property with no totalSqft reports null, not 0". The record was right and
    // this line was overwriting it before the record ever saw the column, which
    // is also why list_properties (`row.sqft == null ? null : …`) and
    // get_property disagreed about the same column at the same moment.
    //
    // Passed through unnormalised on purpose: _num in property-record.js is the
    // canonical rule for this field and applies it once, here as everywhere.
    totalSqft:         row.sqft == null ? null : row.sqft,
    invoices:          d.invoices          || [],
    disputes:          d.disputes          || [],
    camYear:           d.camYear           ?? null,
    results:           d.results           ?? null,
    camReconciliation: d.camReconciliation ?? null,
    settlement:        d.settlement        ?? null,
    timeline:          d.timeline          || [],
    escrowReserves:    d.escrowReserves    || [],
    drawRequests:      d.drawRequests      || [],
    tenants:           null,
  };

  // ── 2. Tenants. The blob wins whenever it has any, because the table has no
  //      review, reviewOverrides or capBaseAmount. The table is a fallback for
  //      legacy rows, exactly as in loadPropertyData. ────────────────────────
  if (Array.isArray(d.tenants) && d.tenants.length) {
    property.tenants = d.tenants.map(TN.normalizeTenant);
  } else {
    const tRes = await sb(
      `/tenants?property_id=eq.${encodeURIComponent(propertyId)}` +
      `&select=id,property_id,name,sqft,cap,start_date,end_date,lease_url,lease_type`,
      { method: 'GET' });
    if (tRes.status >= 300) {
      property.tenants = [];
      degraded.push('tenants.read_failed');
    } else {
      const tRows = Array.isArray(tRes.json) ? tRes.json : [];
      property.tenants = tRows.map(t => TN.normalizeTenant({
        id:          t.id,
        tenant_name: t.name,
        leased_sqft: t.sqft,
        cap:         t.cap,
        start_date:  t.start_date,
        end_date:    t.end_date,
        lease_url:   t.lease_url,
        lease_type:  t.lease_type,
      }));
      if (tRows.length) degraded.push('tenants.from_table_no_review_state');
    }
  }

  // ── 3. Evidence. Not optional: _stripBlobs removes fieldEvidence from the
  //      stored blob, so without this the `fields` section is present, plausible
  //      and empty — the worst of the three possible wrongs. ────────────────
  if (property.tenants.length) {
    const eRes = await sb(
      `/tenant_field_evidence?property_id=eq.${encodeURIComponent(propertyId)}` +
      `&select=*&order=created_at.asc`,
      { method: 'GET' });
    if (eRes.status >= 300) {
      degraded.push('evidence.read_failed');
    } else {
      const eRows = Array.isArray(eRes.json) ? eRes.json : [];
      if (eRows.length) {
        // Grouped exactly as script.js groups it, except that both sides of the
        // join are String()-ed. Object keys are strings regardless, so this
        // cannot create a match the browser would not make — it only removes a
        // way for one to be missed.
        const byTenant = {};
        for (const r of eRows) {
          const tid = String(r.tenant_id);
          if (!byTenant[tid]) byTenant[tid] = {};
          const fk = r.field_key;
          if (!byTenant[tid][fk]) byTenant[tid][fk] = { snapshots: [] };
          byTenant[tid][fk].snapshots.push(_evidenceRowToSnapshot(r));
        }
        property.tenants = property.tenants.map(t =>
          byTenant[String(t.id)] ? { ...t, fieldEvidence: byTenant[String(t.id)] } : t);
      }
    }
  }

  // ── 3b. P5-6B — the acquisition memory ───────────────────────────────────
  //      Only here: after the ownership check and the managed-stage check
  //      have passed, so a caller who does not own this property, or asks for
  //      a prospect, causes no acquisition read at all. The five reads run as
  //      the CALLER (see _defaultUserFetch); the memory is composed by the
  //      shared pure module, request-local, and attached to this request's
  //      property object alone. The token stays in this function.
  property.acquisition = await (async () => {
    const lifecycle = { lifecycle_stage: row.lifecycle_stage == null ? null : row.lifecycle_stage,
                        acquired_at: row.acquired_at == null ? null : row.acquired_at };
    const token = String(o.userToken == null ? '' : o.userToken).replace(/^Bearer\s+/i, '').trim();
    if (!token) {
      return PropertyLeaseholds.memory({ propertyId, property: lifecycle, failed: ['user_session'] });
    }
    // An injected service transport with no caller transport is a harness:
    // it must never reach the network through the default, and it never
    // borrows the service transport for these reads. The section says so.
    const rawUser = o.userFetch || (o.sbFetch ? null : _defaultUserFetch);
    if (!rawUser) {
      return PropertyLeaseholds.memory({ propertyId, property: lifecycle, failed: ['user_transport'] });
    }
    const userSb  = _readOnly(async (p, options) => { reads.push(p); return rawUser(p, token, options); });
    const acq = await _readAcquisition(userSb, propertyId);
    return PropertyLeaseholds.memory({
      propertyId, property: lifecycle,
      families: acq.rows.families, documents: acq.rows.documents, decisions: acq.rows.decisions,
      reviews: acq.rows.reviews, events: acq.rows.events,
      tenants: property.tenants, failed: acq.failed, truncated: acq.truncated,
    });
  })();

  // ── 4. Assemble, with dependencies handed over explicitly ────────────────
  const deps = o.deps || DEPS.load();
  const missing = DEPS.missing(deps);
  if (missing.length) degraded.push('deps.missing:' + missing.join('+'));

  // Selectors and PropertyTimeline are NOT in the dependency set:
  // property-timeline.js needs `document` at load, and selectors.js reaches for
  // a bare `ReviewEngine` global. collectAttention degrades gracefully without
  // Selectors — it still returns a list — so `attention` is COMPOSED and must
  // not appear in meta.unavailable, which means "could not be composed". The
  // difference is reported here instead, as structured data.
  degraded.push('attention.without_selectors_readiness');

  // assemble() is called inside the controlled shim because PropertyWorkspace
  // reads `window.Selectors` and `window.PropertyReference` at CALL time, not
  // at load time. The shim is installed for the duration of this synchronous
  // call and removed in a `finally`; there is no `window` before or after it,
  // and there is no `await` inside it for another task to observe one.
  // The wrap is unconditional, including when deps are injected: injected
  // dependencies are passed explicitly to assemble(), but a call-time
  // `window.` lookup inside one of them would still need the shim, and a test
  // that silently took a different code path from production would be worthless.
  const record = DEPS.withWindow(() => PropertyRecord.assemble(property, deps));

  // ── 5. The approved server-origin metadata ───────────────────────────────
  // meta.unavailable keeps its exact meaning and is not touched. `origin` and
  // `includesBrowserLocalState` are the machine-readable facts; `note` is prose
  // for a human and nothing should branch on it.
  record.meta = Object.assign({}, record.meta, {
    origin: 'server',
    includesBrowserLocalState: false,
    note: 'Assembled from database truth only. A browser session may hold tenants, '
        + 'disputes or timeline events that were never persisted; those are absent '
        + 'here, and their absence is not a claim that they do not exist.',
  });

  return { ok: true, record, reads, degraded };
}

module.exports = {
  hydrate,
  REFUSAL,
  // Exported for tests and for a future endpoint; not used elsewhere here.
  _ownsProperty, _evidenceRowToSnapshot, _readOnly, WRITE_METHODS,
  // M9. The read bound, exported so a test can assert it is applied rather than
  // trust the comment above it.
  READ_TIMEOUT_MS, _defaultFetch,
  // P5-6B. The caller transport and the acquisition reads, exported so a test
  // can assert the key and bearer it sends, and the paths it issues.
  _defaultUserFetch, _readAcquisition, ACQ_ROW_LIMIT,
};
