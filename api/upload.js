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

const SUPABASE_URL      = 'https://zhsuhehgehbzkmzurzyf.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inpoc3VoZWhnZWhiemttenVyenlmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4NDkwNDAsImV4cCI6MjA5MTQyNTA0MH0.HUl9ha9hhjIO1F_k8xPkqbZQnWx-ERRGbnmc6KS3lNE';

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

  const { fileName, fileType, fileBase64, bucket = 'invoices' } = req.body || {};
  if (!fileName || !fileBase64) {
    return res.status(400).json({ error: 'Missing fileName or fileBase64' });
  }

  const ALLOWED_BUCKETS = ['invoices', 'leases'];
  if (!ALLOWED_BUCKETS.includes(bucket)) {
    return res.status(400).json({ error: `Invalid bucket: ${bucket}` });
  }

  const key      = process.env.SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;
  const buffer   = Buffer.from(fileBase64, 'base64');
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
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
