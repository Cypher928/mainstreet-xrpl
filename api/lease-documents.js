// Server-side proxy for lease_documents table operations.
// Uses the service role key so RLS doesn't block browser inserts.

const SUPABASE_URL      = 'https://zhsuhehgehbzkmzurzyf.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inpoc3VoZWhnZWhiemttenVyenlmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4NDkwNDAsImV4cCI6MjA5MTQyNTA0MH0.HUl9ha9hhjIO1F_k8xPkqbZQnWx-ERRGbnmc6KS3lNE';

const KEY_SOURCE = process.env.SUPABASE_SERVICE_ROLE_KEY ? 'service_role' : 'anon';

function key() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;
}

function _isMigrationMissing(json) {
  if (!json) return false;
  const obj = Array.isArray(json) ? (json[0] || {}) : json;
  const msg = String(obj.message || obj.error || obj.raw || '').toLowerCase();
  return obj.code === '42P01' || (msg.includes('does not exist') || (msg.includes('relation') && msg.includes('exist')));
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

  // POST — upsert a lease document record.
  // If a record with the same property_id + file_name already exists, update it.
  if (method === 'POST') {
    const { propertyId, fileName, fileUrl, extractedText, parsingStatus, tenantId, tenantName, extractionModel, usedPdfDirect } = req.body || {};
    if (!propertyId || !fileName) {
      return res.status(400).json({ error: 'Missing propertyId or fileName', keySource: KEY_SOURCE });
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

    let result;
    if (existingRows.length > 0) {
      // Update existing record
      const existingId = existingRows[0].id;
      result = await sbFetch(
        `/lease_documents?id=eq.${encodeURIComponent(existingId)}`,
        { method: 'PATCH', body: JSON.stringify(payload) }
      );
      console.log('[lease-documents] PATCH', result.status, existingId);
    } else {
      // Insert new record
      result = await sbFetch('/lease_documents', {
        method: 'POST',
        body:   JSON.stringify(payload),
      });
      console.log('[lease-documents] INSERT', result.status);
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
    return res.status(200).json({ ok: true, data, keySource: KEY_SOURCE });
  }

  // GET — list lease documents for a property, ordered by most recent first.
  if (method === 'GET') {
    const { propertyId } = req.query || {};
    if (!propertyId) {
      return res.status(400).json({ error: 'Missing propertyId', keySource: KEY_SOURCE });
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
