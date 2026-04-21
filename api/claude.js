// Serverless proxy for Anthropic API calls
// Uses CommonJS for Vercel compatibility

module.exports = async function handler(req, res) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;

    if (!apiKey) {
      console.error('[Claude] Missing ANTHROPIC_API_KEY');
      return res.status(500).json({ error: 'API key not configured' });
    }

    const { messages, max_tokens = 1500, system } = req.body || {};

    if (!messages) {
      return res.status(400).json({ error: 'Missing messages' });
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-3-sonnet-20240229',
        max_tokens,
        system,
        messages,
      }),
    });

    const data = await response.json();

    // Return raw Claude response
    return res.status(200).json(data);

  } catch (err) {
    console.error('[Claude ERROR]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};