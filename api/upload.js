// Serverless proxy for Supabase Storage uploads.
// Uses Node.js https module — avoids Node native fetch binary upload issues.

import { request } from 'https';

// ⚠ This export has NO runtime effect. `api.bodyParser` is a Next.js API-route
// construct and this is not a Next.js project. The real ceiling is Vercel's
// ~4.5 MB request body limit, enforced before this handler runs. It is retained
// only as documentation of the constraint. The limit that IS real lives in
// request-limits.js and is checked below.
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '12mb',
    },
  },
};

const { checkEncodedSize } = require('../request-limits.js');

const _t = require('./_pilot-target');
const SUPABASE_URL      = _t.url;
const SUPABASE_ANON_KEY = _t.anonKey;
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error('[api/upload] Supabase URL/anon not configured for ' + _t.name + ' target');
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
  {
    const _rl = checkRate(user.id, 60, 60000);
    if (!_rl.ok) return sendRateLimited(res, _rl);
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

  // The client gate in script.js can be bypassed — a direct POST, or a stale
  // tab running the build that allowed 60 MB. Check here too, against the same
  // constant and with the same sentence, so a user who reaches it is not told
  // two different stories about the same limit.
  const sizeVerdict = checkEncodedSize(fileBase64.length, bucket === 'leases' ? 'lease' : 'invoice');
  if (!sizeVerdict.ok) {
    return res.status(413).json({ error: sizeVerdict.error });
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

  // SEC-1 — return a storage REFERENCE, not a public URL.
  //
  // This used to mint `${SUPABASE_URL}/storage/v1/object/public/${bucket}/...`
  // and the app stored it on the invoice and the lease_documents row. Once the
  // buckets are private that URL resolves for nobody, and it goes on claiming
  // in the database — and in any log or export it reaches — that the object is
  // publicly readable.
  //
  // `bucket/path` is what /api/document-url needs to sign, and
  // resolveDocumentUrl() accepts it. Rows written before this change hold the
  // full public URL; the resolver parses the path back out of those too, so
  // both shapes work and no data migration is required.
  return res.status(200).json({ url: `${bucket}/${safeName}` });
}
