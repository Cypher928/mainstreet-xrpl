// Serverless proxy for Anthropic API calls.
// Reads ANTHROPIC_API_KEY from the Vercel environment — never exposed to the browser.

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '12mb', // base64-encoded PDFs/images can be large
    },
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('[Mainstreet] ANTHROPIC_API_KEY is not set');
    return res.status(500).json({ error: 'API key not configured on server' });
  }

  const { max_tokens, messages, model: requestedModel, system } = req.body || {};
  if (!messages) {
    return res.status(400).json({ error: 'Missing required field: messages' });
  }

  // Env var takes priority — lets you change the model without a code deploy.
  // Falls back to whatever the client sent, then to the hardcoded default.
  const model = process.env.CLAUDE_MODEL || requestedModel || 'claude-sonnet-4-6';

  const payload = { model, max_tokens, messages };
  if (system) payload.system = system;

  let anthropicResp;
  try {
    anthropicResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        'x-api-key': apiKey,
      },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    console.error('[Mainstreet] Anthropic fetch error:', e);
    const text = await anthropicResp.text();



// Clean Claude formatting

let raw = text

  .replace(/```json/g, '')

  .replace(/```/g, '')

  .trim();



// Extract JSON safely
const match = raw.match(/\{[\s\S]*\}/);

if (!match) {
  console.error("Invalid Claude response:", raw);
  return res.status(500).json({ error: "Invalid JSON from Claude" });
}

const data = JSON.parse(match[0]);

return res.status(200).json(data);