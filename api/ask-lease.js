// Ask-the-Lease proxy — Phase 22B (hardened for long leases)
// Fetches stored extracted_text for a lease document, sends it to Claude
// with the user's question, and returns { answer } as plain text.
// No citations, no clause extraction, no CAM validation.

const SUPABASE_URL      = 'https://zhsuhehgehbzkmzurzyf.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inpoc3VoZWhnZWhiemttenVyenlmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4NDkwNDAsImV4cCI6MjA5MTQyNTA0MH0.HUl9ha9hhjIO1F_k8xPkqbZQnWx-ERRGbnmc6KS3lNE';

const MAX_QUESTION_LEN  = 1000;   // chars
// 300k chars ≈ 75k tokens — fits a 50-page lease well within Claude's 200k-token window.
// Paired with MAX_PAGES=50 in extractPdfText: stored text for most leases stays under
// 250k chars, so this constant acts as a safety guard rather than an active truncation point.
const MAX_LEASE_TEXT    = 300000; // chars
const ANTHROPIC_TIMEOUT = 45000;  // ms — fail clearly before Vercel's 60s maxDuration

// Ask-the-Lease is pinned to Sonnet regardless of the CLAUDE_MODEL env var.
// The operator may set CLAUDE_MODEL=haiku for cheap bulk field extraction, but QA
// on nuanced lease language requires Sonnet-level reasoning.
const ASK_MODEL = 'claude-sonnet-4-6';

function sbKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;
}

async function fetchLeaseDoc(leaseDocumentId) {
  const k   = sbKey();
  const url = `${SUPABASE_URL}/rest/v1/lease_documents?id=eq.${encodeURIComponent(leaseDocumentId)}&select=id,file_name,tenant_name,extracted_text,used_pdf_direct`;
  const res = await fetch(url, {
    headers: {
      'apikey':        k,
      'Authorization': `Bearer ${k}`,
    },
  });
  const text = await res.text();
  let rows;
  try { rows = JSON.parse(text); } catch { rows = []; }
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return rows[0];
}

async function callClaude(leaseText, question) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured on server');

  const system = `You are a commercial real estate lease assistant. \
The user will provide a lease text and ask a question about it. \
Answer based only on the provided lease text. \
Be specific and quote relevant terms when helpful. \
If the answer is not in the provided text, say so clearly — do not guess. \
Keep your answer concise (2–5 sentences unless more detail is clearly needed). \
Do not use JSON, markdown headers, or bullet points unless the question specifically asks for a list.`;

  const truncated     = leaseText.length > MAX_LEASE_TEXT;
  const textToSend    = truncated ? leaseText.slice(0, MAX_LEASE_TEXT) : leaseText;
  const charsAnalyzed = textToSend.length;
  const userContent   = `LEASE TEXT:\n${textToSend}\n\nQUESTION: ${question}`;

  const controller = new AbortController();
  const timeoutId  = setTimeout(() => controller.abort(), ANTHROPIC_TIMEOUT);

  let resp;
  try {
    resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type':      'application/json',
        'anthropic-version': '2023-06-01',
        'x-api-key':         apiKey,
      },
      body: JSON.stringify({
        model:      ASK_MODEL,
        max_tokens: 2048,
        system,
        messages: [{ role: 'user', content: userContent }],
      }),
    });
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Claude took too long to respond (>45s). Try a shorter question or try again.');
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Anthropic API error ${resp.status}: ${errText.slice(0, 200)}`);
  }

  const json   = await resp.json();
  const answer = json?.content?.[0]?.text;
  if (!answer) throw new Error('No content returned from Claude');

  return {
    answer,
    truncated,
    charsAnalyzed,
    model:        json.model,
    inputTokens:  json.usage?.input_tokens,
    outputTokens: json.usage?.output_tokens,
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { leaseDocumentId, question } = req.body || {};

  if (!leaseDocumentId) {
    return res.status(400).json({ error: 'Missing leaseDocumentId' });
  }
  if (!question || !question.trim()) {
    return res.status(400).json({ error: 'Missing question' });
  }
  if (question.length > MAX_QUESTION_LEN) {
    return res.status(400).json({ error: `Question too long (max ${MAX_QUESTION_LEN} characters)` });
  }

  let doc;
  try {
    doc = await fetchLeaseDoc(leaseDocumentId);
  } catch (err) {
    console.error('[ask-lease] Supabase fetch failed:', err.message);
    return res.status(502).json({ error: 'Failed to fetch lease document' });
  }

  if (!doc) {
    return res.status(404).json({ error: 'Lease document not found' });
  }

  if (!doc.extracted_text) {
    const reason = doc.used_pdf_direct
      ? 'This lease was processed via PDF vision — text was not stored. Re-upload the PDF to enable Ask the Lease.'
      : 'No extracted text is available for this lease document.';
    return res.status(422).json({ error: reason });
  }

  let result;
  try {
    result = await callClaude(doc.extracted_text, question.trim());
  } catch (err) {
    console.error('[ask-lease] Claude call failed:', err.message);
    return res.status(500).json({ error: err.message || 'Claude request failed' });
  }

  console.log(
    '[ask-lease] answered | doc:', leaseDocumentId,
    '| tenant:', doc.tenant_name,
    '| chars:', result.charsAnalyzed, result.truncated ? '(truncated)' : '(full)',
    '| in:', result.inputTokens, '| out:', result.outputTokens
  );

  return res.status(200).json({
    answer:       result.answer,
    truncated:    result.truncated,
    charsAnalyzed: result.charsAnalyzed,
  });
}
