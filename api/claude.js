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

module.exports = async function handler(req, res) {
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
