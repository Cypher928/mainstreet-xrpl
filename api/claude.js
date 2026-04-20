// Serverless proxy for Anthropic API calls.
// Reads ANTHROPIC_API_KEY from the Vercel environment — never exposed to the browser.
// Always returns parsed JSON extracted from Claude's text response.

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
    return res.status(500).json({ error: 'Could not reach Anthropic API' });
  }

  // ── Parse Anthropic response body ───────────────────────────────────────────
  let data;
  try {
    data = await anthropicResp.json();
  } catch (e) {
    console.error('[claude] Failed to parse Anthropic response body:', e.message);
    return res.status(500).json({ error: 'Invalid response from Anthropic API' });
  }

  if (!anthropicResp.ok) {
    const msg = data?.error?.message || data?.message || `HTTP ${anthropicResp.status}`;
    console.error('[claude] Anthropic API error:', anthropicResp.status, msg);
    return res.status(500).json({ error: msg });
  }

  // ── Extract text content ────────────────────────────────────────────────────
  const rawText = data?.content?.[0]?.text;
  if (!rawText) {
    console.error('[claude] Missing content[0].text in response:', JSON.stringify(data));
    return res.status(500).json({ error: 'No content in Anthropic response' });
  }

  // ── Strip markdown fences, extract and parse JSON ───────────────────────────
  const cleaned = rawText.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) {
    console.error('[claude] No JSON object found in Claude response:', rawText);
    return res.status(500).json({ error: 'Claude did not return valid JSON' });
  }

  let parsed;
  try {
    parsed = JSON.parse(match[0]);
  } catch (e) {
    console.error('[claude] JSON.parse failed:', match[0]);
    return res.status(500).json({ error: 'Failed to parse JSON from Claude response' });
  }

  return res.status(200).json(parsed);
}
