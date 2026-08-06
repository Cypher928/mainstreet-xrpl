// Serverless proxy for Anthropic API calls.
// Reads ANTHROPIC_API_KEY from the Vercel environment — never exposed to the browser.
// Always returns parsed JSON extracted from Claude's text response.

// ⚠ REQUEST BODY LIMIT — READ BEFORE CHANGING
// callClaudeWithPdfDirect sends a PDF as base64 inside the JSON body, and base64
// adds ~33%. Vercel's Node serverless runtime rejects bodies over ~4.5 MB BEFORE
// this handler runs (HTTP 413), so any source PDF over ~3.3 MB used to fail.
//
// The `config.api.bodyParser.sizeLimit` export below does NOT raise that limit:
// `api.bodyParser` is a Next.js API-route construct, and this app is not a
// Next.js project (no next dependency, no pages/ or app/ dir). It is retained
// only as documentation of the constraint — it has no runtime effect.
//
// The real fix lives client-side in lease-ingest.js: measure the ENCODED size
// up front, and when it won't fit, downscale pages and send them in batches
// that each stay under the budget. Keep that budget (BODY_BUDGET) in sync with
// the 4.5 MB platform limit.
module.exports.config = {
  api: {
    bodyParser: {
      sizeLimit: '20mb',
    },
  },
};

const { resolveClaudeTask, resolveClaudeMaxTokens } = require('./_claude-tasks');
const { checkEncodedSize, base64DocBytes } = require('../request-limits.js');
const _t = require('./_pilot-target');
const _SB_URL  = _t.url;
const _SB_ANON = _t.anonKey;
if (!_SB_URL || !_SB_ANON) {
  throw new Error('[api/claude] Supabase URL/anon not configured for ' + _t.name + ' target');
}

// In-process sliding-window rate limiter (resets per cold-start; good enough for abuse prevention).
// SEC-12 — one sliding-window limiter, shared. See api/_rate-limit.js for what
// it can and cannot do: it is per-instance and Vercel scales instances, so it
// brakes runaway loops and single-client hammering, not a determined attacker.
const { checkRate, sendRateLimited } = require('./_rate-limit');

// Verifies the Supabase JWT from the Authorization header.
// Returns the user object on success; sends 401/500 and returns null on failure.
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
  {
    const _rl = checkRate(user.id, 20, 60000);
    if (!_rl.ok) return sendRateLimited(res, _rl);
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('[claude] ANTHROPIC_API_KEY is not set');
    return res.status(500).json({ error: 'API key not configured on server' });
  }

  const { max_tokens, messages } = req.body || {};
  if (!messages) {
    return res.status(400).json({ error: 'Missing required field: messages' });
  }

  // Same ceiling, same words, same constant as the client and every other
  // handler. lease-ingest.js batches to stay under it; this is the backstop for
  // anything that reaches here unbatched.
  const _docBytes = base64DocBytes(messages);
  if (_docBytes > 0) {
    const v = checkEncodedSize(_docBytes, 'lease');
    if (!v.ok) return res.status(413).json({ error: v.error });
  }

  // SEC-2 — the extraction schema is the server's, not the caller's.
  //
  // This handler read `system` off the request body and forwarded it verbatim.
  // /api/claude is LEASE EXTRACTION: that prompt defines what counts as a CAM
  // cap, how sqft is parsed, and which entity is the tenant. Every one of those
  // guarantees was a browser string, and its output flows into the fieldEvidence
  // snapshots the Evidence Viewer presents as provenance. See _claude-tasks.js.
  const resolved = resolveClaudeTask(req.body);
  if (!resolved.ok) {
    return res.status(resolved.status).json({ error: resolved.error });
  }

  // Always use the server-configured model — never allow callers to request expensive models.
  const model = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';
  const payload = {
    model,
    max_tokens: resolveClaudeMaxTokens(max_tokens, resolved.task),
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
    console.error('[Mainstreet] Fetch failed:', err);
    return res.status(500).json({ error: 'Failed to reach Anthropic' });
  }

  if (!anthropicResp.ok) {
    const errText = await anthropicResp.text();
    console.error('[Mainstreet] Anthropic error:', errText);
    return res.status(500).json({ error: 'Anthropic API error', details: errText });
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
