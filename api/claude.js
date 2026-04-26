// Serverless function for Claude API (Vercel safe)

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

    // ✅ ALWAYS build safe messages
    let finalMessages = messages;

    if (!finalMessages) {
      finalMessages = [
        {
          role: "user",
          content: `Explain this CAM charge clearly in plain English:\n\n${JSON.stringify(req.body)}`
        }
      ];
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
        messages: finalMessages
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

    // ✅ SAFELY extract text (no JSON parsing)
    let text = '';

    if (Array.isArray(data?.content)) {
      text = data.content.map(c => c?.text || '').join('');
    } else if (typeof data?.content === 'string') {
      text = data.content;
    } else if (data?.content?.[0]?.text) {
      text = data.content[0].text;
    } else {
      console.error("Unexpected Claude response:", data);
      return res.status(500).json({ error: "Claude response format invalid" });
    }

    // ✅ RETURN CLEAN TEXT (no JSON parsing!)
    return res.status(200).json({
      text: text.trim()
    });

  } catch (err) {
    console.error('[Server Error]', err);

    return res.status(500).json({
      error: 'Internal server error',
      details: err.message
    });
  }
};