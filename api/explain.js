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

const { resolveExplainTask, resolveMaxTokens } = require('./_explain-tasks');
const _t = require('./_pilot-target');
const _SB_URL  = _t.url;
const _SB_ANON = _t.anonKey;
if (!_SB_URL || !_SB_ANON) {
  throw new Error('[api/explain] Supabase URL/anon not configured for ' + _t.name + ' target');
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
    const r = await fetch(`${_SB_URL}/auth/v1/user`, {
      signal: AbortSignal.timeout(3000),
      headers: { apikey: (_t.serviceRoleKey || _SB_ANON).trim(), Authorization: `Bearer ${tok}` },
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

  const { max_tokens, messages } = req.body || {};
  if (!messages) {
    return res.status(400).json({ error: 'Missing required field: messages' });
  }

  // AI-2 — the instructions are the server's, not the caller's.
  //
  // This handler used to read `system` off the request body and forward it to
  // Anthropic verbatim. Every promise MainStreet makes about how its AI behaves
  // lived in a browser string that anyone could rewrite, and the server had no
  // idea what it had just been asked to say. The client now names a task; the
  // server decides what the model is told. See api/_explain-tasks.js.
  const resolved = resolveExplainTask(req.body);
  if (!resolved.ok) {
    return res.status(resolved.status).json({ error: resolved.error });
  }

  // Always use the server-configured model — never allow callers to request expensive models.
  const model = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';
  const payload = {
    model,
    max_tokens: resolveMaxTokens(max_tokens, resolved.task),
    system:     resolved.task.system,
    messages,
  };

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
