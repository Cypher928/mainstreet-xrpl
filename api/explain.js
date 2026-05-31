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

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
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
