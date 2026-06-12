// Explain endpoint — returns raw Anthropic response so callers can read
// content[0].text directly. Unlike /api/claude, does NOT parse inner JSON.
//
// WHY 20mb: extractTextFromPdfDirect sends scanned PDFs as base64 document blocks.
// A 10 MB PDF becomes ~13 MB of JSON. Without this override, Vercel's default
// 4.5 MB bodyParser limit returns 413 before the handler runs.
module.exports.config = {
  api: {
    bodyParser: {
      sizeLimit: '20mb',
    },
  },
};

const _SB_URL  = 'https://zhsuhehgehbzkmzurzyf.supabase.co';
const _SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inpoc3VoZWhnZWhiemttenVyenlmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4NDkwNDAsImV4cCI6MjA5MTQyNTA0MH0.HUl9ha9hhjIO1F_k8xPkqbZQnWx-ERRGbnmc6KS3lNE';

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
    const r = await fetch(`${_SB_URL}/auth/v1/user`, {
      headers: { apikey: _SB_ANON, Authorization: `Bearer ${tok}` },
    });
    if (!r.ok) { res.status(401).json({ error: 'Invalid or expired token' }); return null; }
    return r.json();
  } catch { res.status(500).json({ error: 'Auth check failed' }); return null; }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await _verifyUser(req, res);
  if (!user) return;
  if (!_chkRate(user.id, 20, 60000)) {
    return res.status(429).json({ error: 'Too many requests — please slow down.' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('[explain] ANTHROPIC_API_KEY is not set');
    return res.status(500).json({ error: 'API key not configured on server' });
  }

  const { max_tokens, messages, model: requestedModel, system } = req.body || {};
  if (!messages) {
    return res.status(400).json({ error: 'Missing required field: messages' });
  }

  const model = process.env.CLAUDE_MODEL || requestedModel || 'claude-sonnet-4-6';
  const payload = { model, max_tokens, messages };
  if (system) payload.system = system;

  let anthropicResp;
  try {
    anthropicResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'anthropic-version': '2023-06-01',
        'x-api-key':         apiKey,
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.error('[explain] Fetch failed:', err);
    return res.status(500).json({ error: 'Failed to reach Anthropic' });
  }

  if (!anthropicResp.ok) {
    const errText = await anthropicResp.text();
    console.error('[explain] Anthropic error:', errText);
    return res.status(500).json({ error: 'Anthropic API error', details: errText });
  }

  let json;
  try {
    json = await anthropicResp.json();
  } catch (err) {
    console.error('[explain] JSON parse failed:', err);
    return res.status(500).json({ error: 'Invalid JSON from Anthropic' });
  }

  if (!json?.content?.[0]?.text) {
    console.error('[explain] No content returned:', json);
    return res.status(500).json({ error: 'No content from Claude' });
  }

  return res.status(200).json(json);
};
