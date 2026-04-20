// Serverless proxy for Anthropic API calls.
// Reads ANTHROPIC_API_KEY from the Vercel environment — never exposed to the browser.

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '12mb',
    },
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
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

  const model = process.env.CLAUDE_MODEL || requestedModel || 'claude-sonnet-4-6';
  const payload = { model, max_tokens, messages };
  if (system) payload.system = system;

  // ── Call Anthropic ──────────────────────────────────────────────────────────
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
  } catch (e) {
    console.error('[claude] Network error reaching Anthropic:', e.message);
    return res.status(502).json({ error: 'Could not reach Anthropic API' });
  }

  // ── Parse Anthropic response body ───────────────────────────────────────────
  let data;
  try {
    data = await anthropicResp.json();
  } catch (e) {
    console.error('[claude] Failed to parse Anthropic response as JSON, status:', anthropicResp.status, e.message);
    return res.status(500).json({ error: 'Invalid response from Anthropic API' });
  }

  if (!anthropicResp.ok) {
    const msg = data?.error?.message || data?.message || `HTTP ${anthropicResp.status}`;
    console.error('[claude] Anthropic API error:', anthropicResp.status, msg);
    return res.status(anthropicResp.status).json({ error: msg });
  }

  // ── Validate content ────────────────────────────────────────────────────────
  const rawText = data?.content?.[0]?.text;
  if (rawText === undefined && data?.content?.[0]?.type !== 'tool_use') {
    console.error('[claude] Missing content in Anthropic response:', JSON.stringify(data));
    return res.status(500).json({ error: 'No content in Anthropic response' });
  }

  // Return the full Anthropic envelope — callers read data.content[0].text
  return res.status(200).json(data);
}
