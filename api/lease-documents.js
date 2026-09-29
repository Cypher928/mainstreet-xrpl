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

  // POST — upsert a lease document record.
  // If a record with the same property_id + file_name already exists, update it.
  if (method === 'POST') {
    const { propertyId, fileName, fileUrl, extractedText, parsingStatus, tenantId, tenantName, extractionModel, usedPdfDirect } = req.body || {};
    if (!propertyId || !fileName) {
      return res.status(400).json({ error: 'Missing propertyId or fileName', keySource: KEY_SOURCE });
    }
    if (!await _ownsProperty(propertyId, user.id)) {
      return res.status(403).json({ error: 'Forbidden', keySource: KEY_SOURCE });
    }

    // Check if a record exists for this property+file_name to decide insert vs update
    const existing = await sbFetch(
      `/lease_documents?property_id=eq.${encodeURIComponent(propertyId)}&file_name=eq.${encodeURIComponent(fileName)}&select=id`,
      { method: 'GET', headers: { 'Prefer': '' } }
    );

    if (existing.status >= 300) {
      if (_isMigrationMissing(existing.json)) {
        console.error('[lease-documents] migration_missing — run migrations/004_lease_intelligence.sql');
        return res.status(503).json({
          error:     'lease_documents table not found — run migrations/004_lease_intelligence.sql in Supabase SQL Editor',
          code:      'migration_missing',
          keySource: KEY_SOURCE,
        });
      }
      return res.status(502).json({ error: 'Supabase lookup failed', detail: existing.json, keySource: KEY_SOURCE });
    }

    const existingRows = Array.isArray(existing.json) ? existing.json : [];
    const payload = {
      property_id:      propertyId,
      tenant_id:        tenantId   || null,
      tenant_name:      tenantName || null,
      file_name:        fileName,
      file_url:         fileUrl    || null,
      extracted_text:   extractedText || null,
      parsing_status:   parsingStatus || 'pending',
      extraction_model: extractionModel || null,
      used_pdf_direct:  usedPdfDirect  === true,
    };

    const existingId = existingRows.length > 0 ? existingRows[0].id : null;
    const write = async (p) => {
      if (existingId) {
        // Update existing record
        const r = await sbFetch(
          `/lease_documents?id=eq.${encodeURIComponent(existingId)}`,
          { method: 'PATCH', body: JSON.stringify(p) }
        );
        console.log('[lease-documents] PATCH', r.status, existingId);
        return r;
      }
      // Insert new record
      const r = await sbFetch('/lease_documents', {
        method: 'POST',
        body:   JSON.stringify(p),
      });
      console.log('[lease-documents] INSERT', r.status);
      return r;
    };

    let result = await write(payload);
    let linked = !!payload.tenant_id;
    // A document is never lost because its leasehold is not persisted yet (a
    // tenant held for review, a failed save): the same write is made once more
    // with tenant_id null — the document is kept, unfiled — and the response
    // says linked:false. Only the leasehold-link refusal is retried.
    if (result.status >= 300 && payload.tenant_id && _isLeaseholdLinkRefused(result.json)) {
      console.warn('[lease-documents] leasehold link refused (no such tenant in this property) — saving unlinked');
      result = await write({ ...payload, tenant_id: null });
      linked = false;
    }

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
