// Server-side proxy for cam_reconciliations table operations.
// Uses the service role key so RLS doesn't block browser inserts.

const SUPABASE_URL      = 'https://zhsuhehgehbzkmzurzyf.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inpoc3VoZWhnZWhiemttenVyenlmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4NDkwNDAsImV4cCI6MjA5MTQyNTA0MH0.HUl9ha9hhjIO1F_k8xPkqbZQnWx-ERRGbnmc6KS3lNE';

const _rl = new Map();
function _chkRate(uid, max, winMs) {
  const now = Date.now();
  let w = _rl.get(uid) || { n: 0, reset: now + winMs };
  if (now > w.reset) w = { n: 0, reset: now + winMs };
  w.n++; _rl.set(uid, w);
  return w.n <= max;
}

async function _verifyUser(req, res) {
  const tok = (req.headers['authorization'] || '').replace(/^Bearer\s+/, '');
  if (!tok) { res.status(401).json({ error: 'Authentication required' }); return null; }
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      signal: AbortSignal.timeout(3000),
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${tok}` },
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

const KEY_SOURCE = process.env.SUPABASE_SERVICE_ROLE_KEY ? 'service_role' : 'anon';

function key() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;
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

// Returns true when Supabase reports the table does not exist (migration not run).
function _isMigrationMissing(json) {
  if (!json) return false;
  const obj = Array.isArray(json) ? (json[0] || {}) : json;
  const msg = String(obj.message || obj.error || obj.raw || '').toLowerCase();
  return obj.code === '42P01' || msg.includes('does not exist') || msg.includes('relation') && msg.includes('exist');
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
  if (!_chkRate(user.id, 60, 60000)) {
    return res.status(429).json({ error: 'Too many requests — please slow down.' });
  }

  // DELETE then INSERT (upsert-style replace for a property+year)
  if (method === 'POST') {
    const { propertyId, year, rows } = req.body || {};
    if (!propertyId || !year) {
      return res.status(400).json({ error: 'Missing propertyId or year', keySource: KEY_SOURCE });
    }
    if (!await _ownsProperty(propertyId, user.id)) {
      return res.status(403).json({ error: 'Forbidden', keySource: KEY_SOURCE });
    }

    // Delete existing rows for this property+year
    const del = await sbFetch(
      `/cam_reconciliations?property_id=eq.${encodeURIComponent(propertyId)}&year=eq.${encodeURIComponent(year)}`,
      { method: 'DELETE' }
    );
    console.log('[cam-reconciliations] DELETE', del.status, JSON.stringify(del.json));
    if (del.status >= 300) {
      if (_isMigrationMissing(del.json)) {
        console.error('[cam-reconciliations] migration_missing — run migrations/003_cam_reconciliations.sql');
        return res.status(503).json({
          error: 'cam_reconciliations table not found — run migrations/003_cam_reconciliations.sql in Supabase SQL Editor',
          code:      'migration_missing',
          keySource: KEY_SOURCE,
        });
      }
      return res.status(del.status).json({ error: 'Delete failed', detail: del.json, keySource: KEY_SOURCE });
    }

    if (!rows || !rows.length) {
      return res.status(200).json({ data: [], keySource: KEY_SOURCE });
    }

    // Insert new rows
    const ins = await sbFetch('/cam_reconciliations', {
      method:  'POST',
      body:    JSON.stringify(rows),
    });
    console.log('[cam-reconciliations] INSERT', ins.status, JSON.stringify(ins.json));
    if (ins.status >= 300) {
      if (_isMigrationMissing(ins.json)) {
        console.error('[cam-reconciliations] migration_missing — run migrations/003_cam_reconciliations.sql');
        return res.status(503).json({
          error: 'cam_reconciliations table not found — run migrations/003_cam_reconciliations.sql in Supabase SQL Editor',
          code:      'migration_missing',
          keySource: KEY_SOURCE,
        });
      }
      return res.status(ins.status).json({ error: 'Insert failed', detail: ins.json, keySource: KEY_SOURCE });
    }
    return res.status(200).json({ data: ins.json, keySource: KEY_SOURCE });
  }

  // GET: load rows for a property+year, OR full history (history=all, no year)
  if (method === 'GET') {
    const { propertyId, year, history } = req.query || {};
    if (!propertyId) {
      return res.status(400).json({ error: 'Missing propertyId' });
    }
    if (!await _ownsProperty(propertyId, user.id)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // History mode: all years for this property, newest first.
    if (history === 'all' || (!year && history)) {
      const result = await sbFetch(
        `/cam_reconciliations?property_id=eq.${encodeURIComponent(propertyId)}` +
        `&select=*&order=year.desc,created_at.desc`
      );
      if (result.status >= 300) {
        if (_isMigrationMissing(result.json)) {
          return res.status(503).json({ error: 'Query failed', code: 'migration_missing', detail: result.json });
        }
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
      if (_isMigrationMissing(result.json)) {
        return res.status(503).json({ error: 'Query failed', code: 'migration_missing', detail: result.json });
      }
      return res.status(result.status).json({ error: 'Query failed', detail: result.json });
    }
    return res.status(200).json({ data: result.json });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
