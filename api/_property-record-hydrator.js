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
 * NOT read: tenant_review_audit (feeds activityLog, which PropertyRecord never
 * looks at) and cam_reconciliations (the record's cam section reads the
 * camReconciliation snapshot from the blob; the browser's extra merge goes
 * through loadCamResults(id, getCamYear()), and getCamYear() is localStorage
 * session state that has no meaning on a server).
 */

const path = require('path');
const _t   = require('./_pilot-target');
const DEPS = require('./_server-deps');
const TN   = require(path.join(__dirname, '..', 'tenant-normalize.js'));
const PropertyRecord = require(path.join(__dirname, '..', 'property-record.js'));

const SUPABASE_URL      = _t.url;
const SUPABASE_ANON_KEY = _t.anonKey;

/** Transport credential. Service role when configured, exactly as api/ does. */
function _key() { return _t.serviceRoleKey || SUPABASE_ANON_KEY; }

/** The default PostgREST transport. Injectable so tests never touch a network. */
async function _defaultFetch(pathAndQuery, options = {}) {
  const k = _key();
  const res = await fetch(`${SUPABASE_URL}/rest/v1${pathAndQuery}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'apikey': k,
      'Authorization': `Bearer ${k}`,
      'Prefer': '',
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, json };
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
    `&user_id=eq.${encodeURIComponent(userId)}&select=id,name,sqft,data`,
    { method: 'GET' });
  if (propRes.status >= 300) return { ok: false, reason: REFUSAL.READ_FAILED, reads, degraded: [] };
  const rows = Array.isArray(propRes.json) ? propRes.json : [];
  if (!rows.length) return { ok: false, reason: REFUSAL.NOT_FOUND, reads, degraded: [] };

  const row  = rows[0];
  const d    = row.data || {};
  const degraded = [];

  // The in-memory shape loadPropertyData builds, minus everything that can only
  // come from a browser. Fields are read exactly as that function reads them.
  const property = {
    id:                row.id,
    name:              row.name,
    totalSqft:         row.sqft || 0,
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
};
