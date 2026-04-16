// Serverless proxy for Supabase Storage uploads.
// Runs server-side so browser CORS restrictions never apply.

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '12mb',
    },
  },
};

const SUPABASE_URL      = 'https://zhsuheghehzbkmzurzyf.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inpoc3VoZWhnZWhiemttenVyenlmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4NDkwNDAsImV4cCI6MjA5MTQyNTA0MH0.HUl9ha9hhjIO1F_k8xPkqbZQnWx-ERRGbnmc6KS3lNE';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { fileName, fileType, fileBase64 } = req.body || {};
  if (!fileName || !fileBase64) {
    return res.status(400).json({ error: 'Missing fileName or fileBase64' });
  }

  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;
  const buffer = Buffer.from(fileBase64, 'base64');
  const encodedName = encodeURIComponent(fileName);
  const uploadUrl = `${SUPABASE_URL}/storage/v1/object/invoices/${encodedName}`;

  console.log('[api/upload] uploading:', fileName, 'size:', buffer.length);

  let uploadRes;
  try {
    uploadRes = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': fileType || 'application/octet-stream',
        'x-upsert': 'true',
      },
      body: buffer,
    });
  } catch (e) {
    console.error('[api/upload] fetch error:', e.message);
    return res.status(502).json({ error: `Could not reach Supabase Storage: ${e.message}` });
  }

  const responseText = await uploadRes.text();
  console.log('[api/upload] response:', uploadRes.status, responseText);

  if (!uploadRes.ok) {
    return res.status(uploadRes.status).json({ error: responseText });
  }

  const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/invoices/${encodedName}`;
  return res.status(200).json({ url: publicUrl });
}
