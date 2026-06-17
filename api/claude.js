// Serverless proxy for Anthropic API calls.
// Reads ANTHROPIC_API_KEY from the Vercel environment — never exposed to the browser.
// Always returns parsed JSON extracted from Claude's text response.

// WHY: callClaudeWithPdfDirect sends entire PDF as base64 inside the JSON body.
// Base64 adds ~33% overhead, so a 5 MB PDF becomes ~6.7 MB.
// Vercel's default bodyParser limit is 4.5 MB — anything larger silently returns
// 413 before the handler runs, causing all large scanned leases to fail with
// "Claude PDF direct failed: HTTP 413". Setting 20 MB covers leases up to ~15 MB.
module.exports.config = {
  api: {
    bodyParser: {
      sizeLimit: '20mb',
    },
  },
};

const _SB_URL  = (process.env.SUPABASE_URL      || '').trim();
const _SB_ANON = (process.env.SUPABASE_ANON_KEY || '').trim();
if (!_SB_URL || !_SB_ANON) {
  throw new Error('[api/claude] SUPABASE_URL and SUPABASE_ANON_KEY env vars are required');
}

// In-process sliding-window rate limiter (resets per cold-start; good enough for abuse prevention).
const _rl = new Map();
function _chkRate(uid, max, winMs) {
  const now = Date.now();
  let w = _rl.get(uid) || { n: 0, reset: now + winMs };
  if (now > w.reset) w = { n: 0, reset: now + winMs };
  w.n++; _rl.set(uid, w);
  return w.n <= max;
}

// Verifies the Supabase JWT from the Authorization header.
// Returns the user object on success; sends 401/500 and returns null on failure.
async function _verifyUser(req, res) {
  const tok = (req.headers['authorization'] || '').replace(/^Bearer\s+/, '');
  if (!tok) { res.status(401).json({ error: 'Authentication required' }); return null; }
  try {
    const r = await fetch(`${_SB_URL}/auth/v1/user`, {
      signal: AbortSignal.timeout(3000),
      headers: { apikey: (process.env.SUPABASE_SERVICE_ROLE_KEY || _SB_ANON).trim(), Authorization: `Bearer ${tok}` },
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
    console.error('[claude] ANTHROPIC_API_KEY is not set');
    return res.status(500).json({ error: 'API key not configured on server' });
  }

  const { max_tokens, messages, model: requestedModel, system } = req.body || {};
  if (!messages) {
    return res.status(400).json({ error: 'Missing required field: messages' });
  }

  // Always use the server-configured model — never allow callers to request expensive models.
  const model = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';
  // Cap token output to prevent runaway cost from caller-supplied values.
  const safeMaxTokens = Math.min(Number.isFinite(max_tokens) ? max_tokens : 4096, 8192);
  const payload = { model, max_tokens: safeMaxTokens, messages };
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
    console.error('[Mainstreet] Fetch failed:', err);
    return res.status(500).json({ error: 'Failed to reach Anthropic' });
  }

  if (!anthropicResp.ok) {
    const errText = await anthropicResp.text();
    console.error('[Mainstreet] Anthropic error:', errText);
    let errType = '';
    try { errType = JSON.parse(errText)?.error?.type || ''; } catch (_) {}
    let status = 500;
    let reason = 'Anthropic API error';
    if (anthropicResp.status === 429 || errType === 'rate_limit_error') {
      status = 429; reason = 'Claude rate limit reached — please wait a moment and retry';
    } else if (errType === 'overloaded_error') {
      status = 503; reason = 'Claude is temporarily overloaded — please retry shortly';
    } else if (errType === 'invalid_request_error' && /too long|context|maximum/i.test(errText)) {
      status = 413; reason = 'Document exceeds Claude\'s context limit — try splitting the file';
    }
    return res.status(status).json({ error: reason, details: errText.slice(0, 500) });
  }

  let json;
  try {
    json = await anthropicResp.json();
  } catch (err) {
    console.error('[Mainstreet] JSON parse failed:', err);
    return res.status(500).json({ error: 'Invalid JSON from Anthropic' });
  }

  const text = json?.content?.[0]?.text;

  if (!text) {
    console.error('[Mainstreet] No content returned:', json);
    return res.status(500).json({ error: 'No content from Claude' });
  }

  // Clean + extract JSON
  const cleaned = text.replace(/```json/g, '').replace(/```/g, '').trim();
  console.log('[Mainstreet] RAW CLAUDE RESPONSE (first 500 chars):', cleaned.slice(0, 500));

  // Support both object { } and array [ { } ] responses from Claude
  const match = cleaned.match(/(\[[\s\S]*\]|\{[\s\S]*\})/);

  if (!match) {
    console.error('[Mainstreet] No JSON found in response. Full text:', cleaned);
    return res.status(500).json({ error: 'No JSON in response', rawText: cleaned.slice(0, 200) });
  }

  let data;
  try {
    data = JSON.parse(match[0]);
  } catch (err) {
    console.error('[Mainstreet] JSON parse failed. Fragment:', match[0].slice(0, 300));
    return res.status(500).json({ error: 'Failed to parse JSON', fragment: match[0].slice(0, 200) });
  }

  // Unwrap single-element arrays so callers always receive an object
  if (Array.isArray(data) && data.length === 1) data = data[0];

  // Attach extraction metadata so clients can populate telemetry without a second round-trip.
  // Uses __meta prefix to avoid colliding with any lease field name Claude might return.
  if (typeof data === 'object' && !Array.isArray(data)) {
    data.__meta = {
      model:        json.model         || model,
      inputTokens:  json.usage?.input_tokens  ?? null,
      outputTokens: json.usage?.output_tokens ?? null,
    };
  }

  return res.status(200).json(data);
}
