// Phase 23 — CAM Validation Against Lease (Tier 2: clause search)
//
// Hard requirements enforced server-side before response reaches the UI:
//   1. Critical requires non-null quote AND non-null section — downgraded to warning otherwise
//   2. Every finding has: check, source, severity, confidence, explanation
//   3. source is always 'lease_ai' from this endpoint
//   4. Lease silence → Info/High — never Warning or Critical

const { VALIDATION_SYSTEM, buildClausePrompt } = require('./_validate-lease-contract');
const _t = require('./_pilot-target');
const SUPABASE_URL      = _t.url;
const SUPABASE_ANON_KEY = _t.anonKey;
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error('[api/validate-lease] Supabase URL/anon not configured for ' + _t.name + ' target');
}

// SEC-12 — one sliding-window limiter, shared. See api/_rate-limit.js for what
// it can and cannot do: it is per-instance and Vercel scales instances, so it
// brakes runaway loops and single-client hammering, not a determined attacker.
const { checkRate, sendRateLimited } = require('./_rate-limit');

async function _verifyUser(req, res) {
  const tok = (req.headers['authorization'] || '').replace(/^Bearer\s+/, '');
  if (!tok) { res.status(401).json({ error: 'Authentication required' }); return null; }
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      signal: AbortSignal.timeout(3000),
      headers: { apikey: (_t.serviceRoleKey || SUPABASE_ANON_KEY).trim(), Authorization: `Bearer ${tok}` },
    });
    if (!r.ok) { res.status(401).json({ error: 'Invalid or expired token' }); return null; }
    const user = await r.json();
    if (!user?.id) { res.status(401).json({ error: 'User identity missing' }); return null; }
    return user;
  } catch (e) {
    const timedOut = e?.name === 'TimeoutError' || e?.name === 'AbortError';
    res.status(timedOut ? 503 : 500).json({ error: timedOut ? 'Auth service unavailable — try again' : 'Auth check failed' });
    return null;
  }
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
  return _t.serviceRoleKey || SUPABASE_ANON_KEY;
}

async function fetchLeaseDoc(id) {
  const k   = sbKey();
  const url = `${SUPABASE_URL}/rest/v1/lease_documents?id=eq.${encodeURIComponent(id)}&select=id,property_id,extracted_text,file_url`;
  const res = await fetch(url, {
    headers: { 'apikey': k, 'Authorization': `Bearer ${k}` },
  });
  const text = await res.text();
  let rows;
  try { rows = JSON.parse(text); } catch { rows = []; }
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return rows[0];
}

async function _ownsLeaseDoc(doc, userId) {
  if (!doc.property_id) return false;
  const k   = sbKey();
  const url = `${SUPABASE_URL}/rest/v1/properties?id=eq.${encodeURIComponent(doc.property_id)}&user_id=eq.${encodeURIComponent(userId)}&select=id`;
  const res = await fetch(url, { headers: { 'apikey': k, 'Authorization': `Bearer ${k}` } });
  const text = await res.text();
  let rows;
  try { rows = JSON.parse(text); } catch { rows = []; }
  return Array.isArray(rows) && rows.length > 0;
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

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await _verifyUser(req, res);
  if (!user) return;
  {
    const _rl = checkRate(user.id, 10, 60000);
    if (!_rl.ok) return sendRateLimited(res, _rl);
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
  if (!await _ownsLeaseDoc(doc, user.id)) {
    return res.status(403).json({ error: 'Forbidden' });
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
        system:     VALIDATION_SYSTEM,
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
