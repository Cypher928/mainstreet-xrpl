// Phase 23 — CAM Validation Against Lease (Tier 2: clause search)
//
// Hard requirements enforced server-side before response reaches the UI:
//   1. Critical requires non-null quote AND non-null section — downgraded to warning otherwise
//   2. Every finding has: check, source, severity, confidence, explanation
//   3. source is always 'lease_ai' from this endpoint
//   4. Lease silence → Info/High — never Warning or Critical

const SUPABASE_URL      = 'https://zhsuhehgehbzkmzurzyf.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inpoc3VoZWhnZWhiemttenVyenlmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4NDkwNDAsImV4cCI6MjA5MTQyNTA0MH0.HUl9ha9hhjIO1F_k8xPkqbZQnWx-ERRGbnmc6KS3lNE';

const _rl = new Map();
function _chkRate(uid, max, winMs) {
  const now = Date.now();
  let w = _rl.get(uid) || { n: 0, reset: now + winMs };
  if (now > w.reset) w = { n: 0, reset: now + winMs };
  w.n++; _rl.set(uid, w);
  return w.n <= max;
}

async function _verifyUser(req, res) {
  const tok = (req.headers['authorization'] || '').replace(/^Bearer\s+/, '');
  if (!tok) { res.status(401).json({ error: 'Authentication required' }); return null; }
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${tok}` },
    });
    if (!r.ok) { res.status(401).json({ error: 'Invalid or expired token' }); return null; }
    return r.json();
  } catch { res.status(500).json({ error: 'Auth check failed' }); return null; }
}

const MAX_LEASE_TEXT     = 300000;
const VALIDATION_TIMEOUT = 45000;
const VALIDATION_MODEL   = 'claude-sonnet-4-6';

const TIER2_CHECKS      = new Set(['CAM_EXCLUSIONS', 'STRUCT_EXCLUSIONS', 'TAX_ALLOCATION']);
const VALID_SEVERITIES  = new Set(['info', 'warning', 'critical']);
const VALID_CONFIDENCES = new Set(['high', 'medium', 'low']);

// Phrases Claude uses to indicate the lease does not address an item.
// Findings matching these must be coerced to Info/High before leaving the server.
const SILENCE_PHRASES = [
  'does not address', 'is silent', 'not mentioned', 'no mention',
  'not specified',    'not found in', 'does not specify', 'no provision',
  'does not contain', 'no language',  'does not discuss',
];

function sbKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;
}

async function fetchLeaseDoc(id) {
  const k   = sbKey();
  const url = `${SUPABASE_URL}/rest/v1/lease_documents?id=eq.${encodeURIComponent(id)}&select=id,extracted_text,file_url`;
  const res = await fetch(url, {
    headers: { 'apikey': k, 'Authorization': `Bearer ${k}` },
  });
  const text = await res.text();
  let rows;
  try { rows = JSON.parse(text); } catch { rows = []; }
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return rows[0];
}

// Enforces all hard requirements. Called on every finding before it leaves the server.
function normalizeFinding(f) {
  let severity   = typeof f.severity   === 'string' ? f.severity.toLowerCase()   : '';
  let confidence = typeof f.confidence === 'string' ? f.confidence.toLowerCase() : '';

  if (!VALID_SEVERITIES.has(severity))    severity   = 'info';
  if (!VALID_CONFIDENCES.has(confidence)) confidence = 'medium';

  const quote       = typeof f.quote       === 'string' && f.quote.trim()       ? f.quote.trim()       : null;
  const section     = typeof f.section     === 'string' && f.section.trim()     ? f.section.trim()     : null;
  const page        = typeof f.page        === 'number' && Number.isFinite(f.page) ? Math.floor(f.page) : null;
  const finding     = typeof f.finding     === 'string' && f.finding.trim()     ? f.finding.trim()     : 'No detail provided.';
  const explanation = typeof f.explanation === 'string' && f.explanation.trim() ? f.explanation.trim() : null;

  // Hard requirement 1: Critical requires quote + section citation
  if (severity === 'critical' && (!quote || !section)) {
    severity   = 'warning';
    confidence = confidence === 'high' ? 'medium' : confidence;
  }

  // Hard requirement 4: Lease silence → Info/High
  const findingLc = finding.toLowerCase();
  if (SILENCE_PHRASES.some(p => findingLc.includes(p))) {
    severity   = 'info';
    confidence = 'high';
  }

  return {
    check:       f.check,
    source:      'lease_ai',
    severity,
    confidence,
    finding,
    quote,
    section,
    page,
    explanation,
  };
}

// Parses Claude's raw text response into a normalized findings array.
// Returns empty array on any parse failure — never throws.
function parseValidationFindings(raw) {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return [];
  let parsed;
  try { parsed = JSON.parse(match[0]); } catch { return []; }

  const findings = Array.isArray(parsed.findings) ? parsed.findings : [];
  return findings
    .filter(f => f && typeof f.check === 'string' && TIER2_CHECKS.has(f.check))
    .map(normalizeFinding);
}

function buildClausePrompt(leaseText, lineItems, totalExpenses, year) {
  const itemLines = (lineItems || [])
    .map(li => `  - ${li.category}: $${Number(li.amount || 0).toLocaleString()}`)
    .join('\n') || '  (none provided)';

  return `You are a commercial real estate lease compliance auditor.
Review the lease text below against the CAM reconciliation data and perform the three checks listed.

RECONCILIATION DATA (${year || 'current year'}):
  Total CAM Expenses: $${Number(totalExpenses || 0).toLocaleString()}
  Line Items:
${itemLines}

LEASE TEXT:
${leaseText}

CHECKS TO PERFORM:
1. CAM_EXCLUSIONS — Do any reconciliation line items appear in the lease's explicit CAM exclusion list?
2. STRUCT_EXCLUSIONS — Does the reconciliation include capital expenditures or structural repairs that the lease explicitly excludes from CAM?
3. TAX_ALLOCATION — Is property tax handling in the reconciliation consistent with the lease's stated allocation method?

STRICT RULES:
- Only report severity "critical" when you can cite exact verbatim lease language AND a specific section reference. Both quote and section must be non-null.
- If the lease is silent or ambiguous on an item, return severity "info" and confidence "high". Never return "warning" or "critical" for lease silence.
- Confidence must reflect how directly the lease language supports the finding: "high" = explicit exact language, "medium" = related but ambiguous language, "low" = inferred.
- Prefer fewer high-confidence findings. A missed finding is acceptable; an unsupported critical finding is not.

Return ONLY valid JSON — no markdown, no text outside the object:
{
  "findings": [
    {
      "check": "CAM_EXCLUSIONS",
      "severity": "info" | "warning" | "critical",
      "confidence": "high" | "medium" | "low",
      "finding": "Human-readable summary (1-2 sentences)",
      "quote": "Verbatim excerpt from the lease or null",
      "section": "Section X.Y or null",
      "page": 12,
      "explanation": "Why this conflicts with the reconciliation, or null if compliant"
    }
  ]
}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await _verifyUser(req, res);
  if (!user) return;
  if (!_chkRate(user.id, 10, 60000)) {
    return res.status(429).json({ error: 'Too many requests — please slow down.' });
  }

  const { leaseDocumentId, reconciliationData } = req.body || {};

  if (!leaseDocumentId) {
    return res.status(400).json({ error: 'Missing leaseDocumentId' });
  }
  if (!reconciliationData) {
    return res.status(400).json({ error: 'Missing reconciliationData' });
  }
  if (!Array.isArray(reconciliationData.lineItems)) {
    return res.status(400).json({ error: 'reconciliationData.lineItems must be an array' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured on server' });
  }

  let doc;
  try {
    doc = await fetchLeaseDoc(leaseDocumentId);
  } catch (err) {
    console.error('[validate-lease] Supabase fetch failed:', err.message);
    return res.status(502).json({ error: 'Failed to fetch lease document' });
  }

  if (!doc) {
    return res.status(404).json({ error: 'Lease document not found' });
  }
  if (!doc.extracted_text) {
    return res.status(422).json({ error: 'No extracted text available for this lease document. Re-upload to enable validation.' });
  }

  const truncated     = doc.extracted_text.length > MAX_LEASE_TEXT;
  const textToSend    = truncated ? doc.extracted_text.slice(0, MAX_LEASE_TEXT) : doc.extracted_text;
  const charsAnalyzed = textToSend.length;

  const controller = new AbortController();
  const timeoutId  = setTimeout(() => controller.abort(), VALIDATION_TIMEOUT);

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
        model:      VALIDATION_MODEL,
        max_tokens: 2048,
        messages: [{
          role:    'user',
          content: buildClausePrompt(
            textToSend,
            reconciliationData.lineItems,
            reconciliationData.totalExpenses,
            reconciliationData.year,
          ),
        }],
      }),
    });
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      return res.status(500).json({ error: 'Lease validation timed out (>45s). Try again.' });
    }
    return res.status(500).json({ error: 'Failed to reach Anthropic' });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!resp.ok) {
    const errText = await resp.text();
    console.error('[validate-lease] Anthropic error:', errText.slice(0, 200));
    return res.status(500).json({ error: 'Anthropic API error', details: errText.slice(0, 200) });
  }

  const json = await resp.json();
  const raw  = json?.content?.[0]?.text;
  if (!raw) {
    return res.status(500).json({ error: 'No content returned from Claude' });
  }

  const findings = parseValidationFindings(raw);

  console.log(
    '[validate-lease] doc:', leaseDocumentId,
    '| findings:', findings.length,
    '| critical:', findings.filter(f => f.severity === 'critical').length,
    '| warning:', findings.filter(f => f.severity === 'warning').length,
    '| chars:', charsAnalyzed, truncated ? '(truncated)' : '(full)',
  );

  return res.status(200).json({
    findings,
    fileUrl:       doc.file_url || null,
    charsAnalyzed,
    truncated,
  });
}
