/// Serverless function for Claude API (CommonJS - Vercel safe)

module.exports = async function handler(req, res) {
  try {
    // Only allow POST
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;

    if (!apiKey) {
      console.error('[Claude] Missing API key');
      return res.status(500).json({ error: 'API key not configured' });
    }

    const { messages, max_tokens = 1024, model, system } = req.body || {};

    if (!messages) {
      return res.status(400).json({ error: 'Missing messages' });
    }

    // Call Anthropic API
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: model || 'claude-3-sonnet-20240229',
        max_tokens,
        system,
        messages
      })
    });

    // Handle bad response
    if (!response.ok) {
      let errorText = await response.text();
      console.error('[Claude API Error]', errorText);
      return res.status(500).json({
        error: 'Claude API request failed',
        details: errorText
      });
    }

    const data = await response.json();

    // Extract text safely
    let text = '';
    if (Array.isArray(data?.content)) {
  text = data.content.map(c => c?.text || '').join('');
} else if (typeof data?.content === 'string') {
  text = data.content;
} else if (data?.content?.[0]?.text) {
  text = data.content[0].text;
} else {
  console.error("Unexpected Claude response:", data);
  throw new Error("Claude response format invalid");
}
   // Clean Claude formatting
let raw = text
  .replace(/```json/g, '')
  .replace(/```/g, '')
  .trim();

// Extract JSON safely
let json;

try {
  json = JSON.parse(raw);
} catch {
  const match = raw.match(/\[[\s\S]*\]/) || raw.match(/\{[\s\S]*\}/);

  if (!match) {
    console.error("Claude raw response:", raw);
    return res.status(500).json({ error: "Invalid JSON from Claude" });
  }

  json = JSON.parse(match[0]);
}

let result;

if (Array.isArray(json)) {
  result = json;
} else if (json?.tenants && Array.isArray(json.tenants)) {
  result = json.tenants;
} else {
  result = [json];
}

return res.status(200).json(result);

  } catch (err) {
    console.error('[Server Error]', err);
    return res.status(500).json({
      error: 'Internal server error',
      details: err.message
    });
  }
};
