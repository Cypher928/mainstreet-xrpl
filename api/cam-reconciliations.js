// Server-side proxy for cam_reconciliations table operations.
// Uses the service role key so RLS doesn't block browser inserts.

const SUPABASE_URL      = 'https://zhsuhehgehbzkmzurzyf.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inpoc3VoZWhnZWhiemttenVyenlmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4NDkwNDAsImV4cCI6MjA5MTQyNTA0MH0.HUl9ha9hhjIO1F_k8xPkqbZQnWx-ERRGbnmc6KS3lNE';

function key() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;
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

  // DELETE then INSERT (upsert-style replace for a property+year)
  if (method === 'POST') {
    const { propertyId, year, rows } = req.body || {};
    if (!propertyId || !year) {
      return res.status(400).json({ error: 'Missing propertyId or year' });
    }

    // Delete existing rows for this property+year
    const del = await sbFetch(
      `/cam_reconciliations?property_id=eq.${encodeURIComponent(propertyId)}&year=eq.${encodeURIComponent(year)}`,
      { method: 'DELETE' }
    );
    console.log('[cam-reconciliations] DELETE', del.status, JSON.stringify(del.json));
    if (del.status >= 300) {
      return res.status(del.status).json({ error: 'Delete failed', detail: del.json });
    }

    if (!rows || !rows.length) {
      return res.status(200).json({ data: [] });
    }

    // Insert new rows
    const ins = await sbFetch('/cam_reconciliations', {
      method:  'POST',
      body:    JSON.stringify(rows),
    });
    console.log('[cam-reconciliations] INSERT', ins.status, JSON.stringify(ins.json));
    if (ins.status >= 300) {
      return res.status(ins.status).json({ error: 'Insert failed', detail: ins.json });
    }
    return res.status(200).json({ data: ins.json });
  }

  // GET: load rows for a property+year, OR full history (history=all, no year)
  if (method === 'GET') {
    const { propertyId, year, history } = req.query || {};
    if (!propertyId) {
      return res.status(400).json({ error: 'Missing propertyId' });
    }

    // History mode: all years for this property, newest first.
    if (history === 'all' || (!year && history)) {
      const result = await sbFetch(
        `/cam_reconciliations?property_id=eq.${encodeURIComponent(propertyId)}` +
        `&select=*&order=year.desc,created_at.desc`
      );
      if (result.status >= 300) {
        return res.status(result.status).json({ error: 'Query failed', detail: result.json });
      }
      return res.status(200).json({ data: result.json });
    }

    if (!year) {
      return res.status(400).json({ error: 'Missing year (or pass history=all for all years)' });
    }
    const result = await sbFetch(
      `/cam_reconciliations?property_id=eq.${encodeURIComponent(propertyId)}&year=eq.${encodeURIComponent(year)}&select=*`
    );
    if (result.status >= 300) {
      return res.status(result.status).json({ error: 'Query failed', detail: result.json });
    }
    return res.status(200).json({ data: result.json });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
