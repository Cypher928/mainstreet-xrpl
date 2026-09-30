// Server-side proxy for lease_documents table operations.
// Uses the service role key so RLS doesn't block browser inserts.

const _t = require('./_pilot-target');
const SUPABASE_URL      = _t.url;
const SUPABASE_ANON_KEY = _t.anonKey;
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error('[api/lease-documents] Supabase URL/anon not configured for ' + _t.name + ' target');
}

// SEC-12 — one sliding-window limiter, shared. See api/_rate-limit.js for what
// it can and cannot do: it is per-instance and Vercel scales instances, so it
// brakes runaway loops and single-client hammering, not a determined attacker.
const { checkRate, sendRateLimited } = require('./_rate-limit');

async function _verifyUser(req, res) {
  const tok = (req.headers['authorization'] || '').replace(/^Bearer\s+/, '');
  if (!tok) { res.status(401).json({ error: 'Authentication required' }); return null; }
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      signal: AbortSignal.timeout(3000),
      headers: { apikey: (_t.serviceRoleKey || SUPABASE_ANON_KEY).trim(), Authorization: `Bearer ${tok}` },
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

const KEY_SOURCE = _t.serviceRoleKey ? 'service_role' : 'anon';

function key() {
  return _t.serviceRoleKey || SUPABASE_ANON_KEY;
}

async function _ownsProperty(propertyId, userId) {
  const r = await sbFetch(
    `/properties?id=eq.${encodeURIComponent(propertyId)}&user_id=eq.${encodeURIComponent(userId)}&select=id`,
    { method: 'GET', headers: { 'Prefer': '' } }
  );
  if (r.status >= 300) return false;
  const rows = Array.isArray(r.json) ? r.json : [];
  return rows.length > 0;
}

function _isMigrationMissing(json) {
  if (!json) return false;
  const obj = Array.isArray(json) ? (json[0] || {}) : json;
  const msg = String(obj.message || obj.error || obj.raw || '').toLowerCase();
  return obj.code === '42P01' || (msg.includes('does not exist') || (msg.includes('relation') && msg.includes('exist')));
}

// Migration 039: lease_documents.tenant_id is the leasehold (tenants.id) of the
// SAME property — lease_documents_leasehold_fk, (tenant_id, property_id) →
// tenants(id, property_id). A write naming a tenant that is not (yet) a row of
// this property is refused with 23503 on exactly that constraint. Any other
// error — another constraint, another code — is not this, and is not retried.
function _isLeaseholdLinkRefused(json) {
  if (!json) return false;
  const obj = Array.isArray(json) ? (json[0] || {}) : json;
  return obj.code === '23503'
    && /lease_documents_leasehold_fk/.test(String(obj.message || '') + ' ' + String(obj.details || ''));
}

function _isDuplicateKey(json) {
  if (!json) return false;
  const obj = Array.isArray(json) ? (json[0] || {}) : json;
  return obj.code === '23505';
}

// Step A-2: the kinds a person may confirm for an uploaded lease document —
// lease_documents.doc_type values the register already allows (025).
const LEASE_DOC_KINDS = ['original_lease', 'amendment', 'renewal_extension', 'assignment'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function sbFetch(path, options = {}) {
  const k = key();
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...options,
    headers: {
      'Content-Type':  'application/json',
      'apikey':        k,
      'Authorization': `Bearer ${k}`,
      'Prefer':        'return=representation',
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, json };
}

export default async function handler(req, res) {
  const { method } = req;

  const user = await _verifyUser(req, res);
  if (!user) return;
  {
    const _rl = checkRate(user.id, 60, 60000);
    if (!_rl.ok) return sendRateLimited(res, _rl);
  }

  // POST — record a lease document in the register.
  //
  // Step A-2: a document's identity is its OWN id, never (property_id,
  // file_name). Two leaseholds may each have a "Lease.pdf"; a second upload
  // with the same name used to find the first row by name and PATCH it —
  // re-pointing, or with tenant_id null unlinking, another leasehold's lease.
  //
  //   · documentId given  → that row is created or updated, and only that row.
  //     A row already linked to a leasehold is never re-pointed to another one
  //     and never unlinked (409 document_linked_elsewhere); an unlinked row may
  //     be linked. Replaying the same write is harmless.
  //   · no documentId      → legacy callers. A same-named row is updated only
  //     when it already belongs to the SAME leasehold this write names; in
  //     every other case a new row is inserted. A write never unlinks.
  //
  // docType, when given, is the kind a PERSON confirmed (Amendment, Renewal /
  // Extension, Assignment, Original Lease Copy), so it is recorded as
  // classified_by 'user'. Nothing here guesses a type.
  if (method === 'POST') {
    const { propertyId, documentId, fileName, fileUrl, extractedText, parsingStatus, tenantId, tenantName, extractionModel, usedPdfDirect, docType } = req.body || {};
    if (!propertyId || (!fileName && !documentId)) {
      return res.status(400).json({ error: 'Missing propertyId or fileName', keySource: KEY_SOURCE });
    }
    if (documentId != null && !UUID_RE.test(String(documentId))) {
      return res.status(400).json({ error: 'documentId must be a uuid', keySource: KEY_SOURCE });
    }
    if (docType != null && !LEASE_DOC_KINDS.includes(docType)) {
      return res.status(400).json({ error: 'docType must be one of ' + LEASE_DOC_KINDS.join(', '), keySource: KEY_SOURCE });
    }
    if (!await _ownsProperty(propertyId, user.id)) {
      return res.status(403).json({ error: 'Forbidden', keySource: KEY_SOURCE });
    }

    const _migrationMissing = () => res.status(503).json({
      error:     'lease_documents table not found — run migrations/004_lease_intelligence.sql in Supabase SQL Editor',
      code:      'migration_missing',
      keySource: KEY_SOURCE,
    });

    // The document's content fields: only what this write actually carries, so
    // a link-only write (documentId + tenantId + docType) never blanks the text.
    const content = {};
    if (tenantName      !== undefined) content.tenant_name      = tenantName || null;
    if (fileName        !== undefined) content.file_name        = fileName;
    if (fileUrl         !== undefined) content.file_url         = fileUrl || null;
    if (extractedText   !== undefined) content.extracted_text   = extractedText || null;
    if (parsingStatus   !== undefined) content.parsing_status   = parsingStatus || 'pending';
    if (extractionModel !== undefined) content.extraction_model = extractionModel || null;
    if (usedPdfDirect   !== undefined) content.used_pdf_direct  = usedPdfDirect === true;
    if (docType) Object.assign(content, { doc_type: docType, category: 'leases', classified_by: 'user' });
    const wantTenant = tenantId || null;

    // Find the row this write is about, and whether it may take the link.
    let target = null;          // { id, tenant_id } of an existing row to PATCH
    let insertId = null;        // the id a new row is inserted with (documentId path)
    if (documentId) {
      const found = await sbFetch(
        `/lease_documents?id=eq.${encodeURIComponent(documentId)}&select=id,property_id,tenant_id`,
        { method: 'GET', headers: { 'Prefer': '' } }
      );
      if (found.status >= 300) {
        if (_isMigrationMissing(found.json)) return _migrationMissing();
        return res.status(502).json({ error: 'Supabase lookup failed', detail: found.json, keySource: KEY_SOURCE });
      }
      const row = (Array.isArray(found.json) ? found.json : [])[0] || null;
      if (row && String(row.property_id) !== String(propertyId)) {
        return res.status(409).json({ error: 'Document belongs to another property', code: 'document_in_other_property', keySource: KEY_SOURCE });
      }
      if (row && row.tenant_id && wantTenant && String(row.tenant_id) !== String(wantTenant)) {
        console.warn('[lease-documents] refused: document', documentId, 'is linked to another leasehold');
        return res.status(409).json({ error: 'Document is linked to another leasehold', code: 'document_linked_elsewhere', keySource: KEY_SOURCE });
      }
      if (row) target = { id: row.id, tenant_id: row.tenant_id || null };
      else {
        if (!fileName) return res.status(400).json({ error: 'Missing fileName for a new document', keySource: KEY_SOURCE });
        insertId = String(documentId);
      }
    } else {
      const existing = await sbFetch(
        `/lease_documents?property_id=eq.${encodeURIComponent(propertyId)}&file_name=eq.${encodeURIComponent(fileName)}&select=id,tenant_id`,
        { method: 'GET', headers: { 'Prefer': '' } }
      );
      if (existing.status >= 300) {
        if (_isMigrationMissing(existing.json)) {
          console.error('[lease-documents] migration_missing — run migrations/004_lease_intelligence.sql');
          return _migrationMissing();
        }
        return res.status(502).json({ error: 'Supabase lookup failed', detail: existing.json, keySource: KEY_SOURCE });
      }
      const rows = Array.isArray(existing.json) ? existing.json : [];
      // Only the same leasehold's own same-named row is updated. An unlinked
      // row, or another leasehold's row, is never taken over by name.
      const own = wantTenant ? rows.find(r => r.tenant_id && String(r.tenant_id) === String(wantTenant)) : null;
      if (own) target = { id: own.id, tenant_id: own.tenant_id };
    }

    const write = async (linkTenant) => {
      if (target) {
        // A linked row keeps its link (the only tenant this path could name is
        // the one it already has); an unlinked row may be linked now.
        const p = { ...content };
        if (!target.tenant_id && linkTenant) p.tenant_id = linkTenant;
        if (Object.keys(p).length === 0) {
          // Nothing to change (a replayed link to the leasehold it already has).
          return sbFetch(`/lease_documents?id=eq.${encodeURIComponent(target.id)}&select=*`,
            { method: 'GET', headers: { 'Prefer': '' } });
        }
        const r = await sbFetch(
          `/lease_documents?id=eq.${encodeURIComponent(target.id)}&property_id=eq.${encodeURIComponent(propertyId)}`,
          { method: 'PATCH', body: JSON.stringify(p) }
        );
        console.log('[lease-documents] PATCH', r.status, target.id);
        return r;
      }
      const p = { ...content, property_id: propertyId, tenant_id: linkTenant || null };
      if (insertId) p.id = insertId;
      if (p.parsing_status === undefined) p.parsing_status = 'pending';
      const r = await sbFetch('/lease_documents', {
        method: 'POST',
        body:   JSON.stringify(p),
      });
      console.log('[lease-documents] INSERT', r.status);
      return r;
    };

    let result = await write(wantTenant);
    let linked = !!wantTenant;
    // Two writes for one new documentId raced (a replayed upload): the row now
    // exists, so this write is an update of it — the same rules, once.
    if (result.status >= 300 && insertId && _isDuplicateKey(result.json)) {
      const again = await sbFetch(
        `/lease_documents?id=eq.${encodeURIComponent(insertId)}&property_id=eq.${encodeURIComponent(propertyId)}&select=id,tenant_id`,
        { method: 'GET', headers: { 'Prefer': '' } }
      );
      const row = (Array.isArray(again.json) ? again.json : [])[0] || null;
      if (!row) return res.status(409).json({ error: 'Document belongs to another property', code: 'document_in_other_property', keySource: KEY_SOURCE });
      if (row.tenant_id && wantTenant && String(row.tenant_id) !== String(wantTenant)) {
        return res.status(409).json({ error: 'Document is linked to another leasehold', code: 'document_linked_elsewhere', keySource: KEY_SOURCE });
      }
      target = { id: row.id, tenant_id: row.tenant_id || null };
      insertId = null;
      result = await write(wantTenant);
    }
    // A document is never lost because its leasehold is not persisted yet (a
    // tenant held for review, a failed save): the same write is made once more
    // without the link — the document is kept, unfiled — and the response says
    // linked:false. Only the leasehold-link refusal is retried.
    if (result.status >= 300 && wantTenant && _isLeaseholdLinkRefused(result.json)) {
      console.warn('[lease-documents] leasehold link refused (no such tenant in this property) — saving unlinked');
      result = await write(null);
      linked = false;
    }
    if (target && target.tenant_id) linked = true;

    if (result.status >= 300) {
      if (_isMigrationMissing(result.json)) {
        console.error('[lease-documents] migration_missing on write');
        return res.status(503).json({
          error:     'lease_documents table not found — run migrations/004_lease_intelligence.sql in Supabase SQL Editor',
          code:      'migration_missing',
          keySource: KEY_SOURCE,
        });
      }
      console.error('[lease-documents] write failed:', result.status, JSON.stringify(result.json));
      return res.status(502).json({ error: 'Write failed', detail: result.json, keySource: KEY_SOURCE });
    }

    const data = Array.isArray(result.json) ? result.json : [result.json];
    return res.status(200).json({ ok: true, data, linked, keySource: KEY_SOURCE });
  }

  // GET — list lease documents for a property, ordered by most recent first.
  if (method === 'GET') {
    const { propertyId } = req.query || {};
    if (!propertyId) {
      return res.status(400).json({ error: 'Missing propertyId', keySource: KEY_SOURCE });
    }
    if (!await _ownsProperty(propertyId, user.id)) {
      return res.status(403).json({ error: 'Forbidden', keySource: KEY_SOURCE });
    }

    const result = await sbFetch(
      `/lease_documents?property_id=eq.${encodeURIComponent(propertyId)}&order=created_at.desc&select=id,property_id,tenant_id,tenant_name,file_name,file_url,parsing_status,extraction_model,used_pdf_direct,created_at,updated_at`,
      { method: 'GET', headers: { 'Prefer': '' } }
    );

    if (result.status >= 300) {
      if (_isMigrationMissing(result.json)) {
        return res.status(503).json({
          error:     'lease_documents table not found — run migrations/004_lease_intelligence.sql in Supabase SQL Editor',
          code:      'migration_missing',
          keySource: KEY_SOURCE,
        });
      }
      return res.status(502).json({ error: 'Query failed', detail: result.json, keySource: KEY_SOURCE });
    }

    const rows = Array.isArray(result.json) ? result.json : [];
    return res.status(200).json({ ok: true, data: rows, keySource: KEY_SOURCE });
  }

  // DELETE — remove a single lease document by id.
  if (method === 'DELETE') {
    const { id } = req.query || {};
    if (!id) {
      return res.status(400).json({ error: 'Missing id', keySource: KEY_SOURCE });
    }

    // Fetch the document first to get property_id for ownership verification
    const lookup = await sbFetch(
      `/lease_documents?id=eq.${encodeURIComponent(id)}&select=id,property_id`,
      { method: 'GET', headers: { 'Prefer': '' } }
    );
    if (lookup.status >= 300) {
      return res.status(502).json({ error: 'Lookup failed', detail: lookup.json, keySource: KEY_SOURCE });
    }
    const docRows = Array.isArray(lookup.json) ? lookup.json : [];
    if (docRows.length === 0) {
      return res.status(404).json({ error: 'Document not found', keySource: KEY_SOURCE });
    }
    if (!await _ownsProperty(docRows[0].property_id, user.id)) {
      return res.status(403).json({ error: 'Forbidden', keySource: KEY_SOURCE });
    }

    const result = await sbFetch(
      `/lease_documents?id=eq.${encodeURIComponent(id)}`,
      { method: 'DELETE', headers: { 'Prefer': '' } }
    );

    if (result.status >= 300) {
      return res.status(502).json({ error: 'Delete failed', detail: result.json, keySource: KEY_SOURCE });
    }

    return res.status(200).json({ ok: true, keySource: KEY_SOURCE });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
