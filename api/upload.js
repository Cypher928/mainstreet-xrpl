// Serverless proxy for Supabase Storage uploads.
// Uses Node.js https module — avoids Node native fetch binary upload issues.

import { request } from 'https';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '12mb',
    },
  },
};

const _t = require('./_pilot-target');
const SUPABASE_URL      = _t.url;
const SUPABASE_ANON_KEY = _t.anonKey;
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error('[api/upload] Supabase URL/anon not configured for ' + _t.name + ' target');
}

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

// Allowed file types: extension → canonical MIME type.
const ALLOWED_TYPES = {
  pdf:  'application/pdf',
  csv:  'text/csv',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  png:  'image/png',
  jpg:  'image/jpeg',
  jpeg: 'image/jpeg',
};

// Returns an error string if the file is not allowed, or null if valid.
function _validateUpload(fileName, fileType) {
  const ext = (fileName.split('.').pop() || '').toLowerCase();
  const allowed = ALLOWED_TYPES[ext];
  if (!allowed) {
    return `File type .${ext} is not allowed. Allowed extensions: ${Object.keys(ALLOWED_TYPES).join(', ')}`;
  }
  if (fileType && fileType !== allowed) {
    return `MIME type "${fileType}" does not match extension .${ext} (expected ${allowed})`;
  }
  return null;
}

function httpsPost(url, headers, body) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = request(
      {
        hostname: parsed.hostname,
        path:     parsed.pathname,
        method:   'POST',
        headers:  { ...headers, 'Content-Length': body.length },
      },
      (res) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve({
          status: res.statusCode,
          body:   Buffer.concat(chunks).toString(),
        }));
      }
    );
    req.on('error', reject);
    req.end(body);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await _verifyUser(req, res);
  if (!user) return;
  if (!_chkRate(user.id, 60, 60000)) {
    return res.status(429).json({ error: 'Too many requests — please slow down.' });
  }

  const { fileName, fileType, fileBase64, bucket = 'invoices' } = req.body || {};
  if (!fileName || !fileBase64) {
    return res.status(400).json({ error: 'Missing fileName or fileBase64' });
  }

  const ALLOWED_BUCKETS = ['invoices', 'leases'];
  if (!ALLOWED_BUCKETS.includes(bucket)) {
    return res.status(400).json({ error: `Invalid bucket: ${bucket}` });
  }

  const uploadError = _validateUpload(fileName, fileType);
  if (uploadError) {
    return res.status(400).json({ error: uploadError });
  }

  const key      = _t.serviceRoleKey || SUPABASE_ANON_KEY;
  const buffer   = Buffer.from(fileBase64, 'base64');
  const safeName = `${user.id}/${fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  const uploadUrl = `${SUPABASE_URL}/storage/v1/object/${bucket}/${safeName}`;

  console.log('[api/upload] POST', uploadUrl, 'bytes:', buffer.length);

  let status, body;
  try {
    ({ status, body } = await httpsPost(uploadUrl, {
      'Authorization': `Bearer ${key}`,
      'apikey':        key,
      'Content-Type':  fileType || 'application/octet-stream',
      'x-upsert':      'true',
    }, buffer));
  } catch (e) {
    console.error('[api/upload] network error:', e.code, e.message);
    const paused = ['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET'].includes(e.code);
    const msg = paused
      ? `Supabase project is unreachable (${e.code}) — it may be paused. Go to supabase.com, open your project, and click Resume.`
      : `Network error: ${e.message} (${e.code || 'unknown'})`;
    return res.status(502).json({ error: msg });
  }

  console.log('[api/upload] response:', status, body);

  if (status >= 300) {
    return res.status(status).json({ error: `Supabase Storage error (HTTP ${status}): ${body}` });
  }

  const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${safeName}`;
  return res.status(200).json({ url: publicUrl });
}
