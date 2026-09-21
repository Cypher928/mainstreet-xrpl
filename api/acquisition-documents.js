// api/acquisition-documents.js — the documents an Acquisition Review was given.
// ============================================================================
// Acquisition Review Phase 1, increment P1-2. See docs/ACQUISITION_REVIEW.md.
//
// Server-side proxy for the acquisition_documents table, using the service role
// so a browser insert is not fighting RLS. Modelled on api/lease-documents.js,
// and deliberately NOT that endpoint: acquisition documents belong to a review,
// which has no property until it is converted, so ownership is checked against
// acquisition_reviews.user_id rather than properties.user_id.
//
// THE OWNERSHIP RULE
// A caller may touch a document only if they own the REVIEW it belongs to. That
// is checked before every read and every write, and `user_id` is written from
// the verified token — never from the request body, which the caller controls.
// The table's composite foreign key then makes it impossible for a row to name
// an owner its review does not have, so the rule holds even if this file is
// wrong one day.
//
// NO DELETE. Preserving every source is the point of this increment; a removal
// would be an explicit archive workflow with its own column and its own
// approval. DELETE answers 405 rather than silently doing nothing.
'use strict';

const _t = require('./_pilot-target');
const SUPABASE_URL      = _t.url;
const SUPABASE_ANON_KEY = _t.anonKey;
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error('[api/acquisition-documents] Supabase URL/anon not configured for ' + _t.name + ' target');
}

// SEC-12 — one sliding-window limiter, shared. See api/_rate-limit.js for what
// it can and cannot do: it is per-instance and Vercel scales instances, so it
// brakes runaway loops and single-client hammering, not a determined attacker.
const { checkRate, sendRateLimited } = require('./_rate-limit');

const KEY_SOURCE = _t.serviceRoleKey ? 'service_role' : 'anon';
function key() { return _t.serviceRoleKey || SUPABASE_ANON_KEY; }

// The columns a LIST returns. extracted_text is deliberately absent: it is the
// largest column in the table and a list of documents does not need it. The
// text is read by the increments that use it (P1-4 abstraction, P1-9 Q&A),
// one document at a time.
const LIST_COLUMNS = [
  'id', 'review_id', 'file_name', 'intake_kind', 'byte_size', 'content_type',
  'storage_path', 'parsing_status', 'extraction_model', 'used_pdf_direct',
  'error_message', 'produced_kind', 'produced_id', 'created_at', 'updated_at',
].join(',');

// What a POST may set. A body key outside this list is ignored rather than
// forwarded — particularly `user_id`, which comes from the token, and `id`,
// which the database mints.
const WRITABLE = {
  file_name:        v => (typeof v === 'string' && v.trim()) ? v.trim().slice(0, 500) : null,
  intake_kind:      v => (['lease', 'invoice', 'other'].includes(v) ? v : 'other'),
  byte_size:        v => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.floor(Number(v)) : null),
  content_type:     v => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 255) : null),
  storage_path:     v => (typeof v === 'string' && v.trim() ? v.trim() : null),
  extracted_text:   v => (typeof v === 'string' && v ? v : null),
  parsing_status:   v => (['pending', 'success', 'partial', 'failed'].includes(v) ? v : 'pending'),
  extraction_model: v => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 255) : null),
  used_pdf_direct:  v => v === true,
  error_message:    v => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 2000) : null),
  produced_kind:    v => (['tenant', 'invoice'].includes(v) ? v : null),
  produced_id:      v => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 200) : null),
};

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

async function sbFetch(path, options = {}) {
  const k = key();
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...options,
    headers: {
      'Content-Type':  'application/json',
      'apikey':        k,
      'Authorization': `Bearer ${k}`,
      'Prefer':        'return=representation',
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, json };
}

function _isMigrationMissing(json) {
  if (!json) return false;
  const obj = Array.isArray(json) ? (json[0] || {}) : json;
  const msg = String(obj.message || obj.error || obj.raw || '').toLowerCase();
  return obj.code === '42P01' || (msg.includes('does not exist') || (msg.includes('relation') && msg.includes('exist')));
}

// A missing table is named for the table that is actually missing.
//
// Two different lookups here can fail this way — the ownership check reads
// acquisition_reviews (migration 006), the document read and write touch
// acquisition_documents (migration 023) — and telling an operator to run 023
// when what is absent is the reviews table sends them to the wrong file. The
// `code` is the same either way, because the client's handling is the same:
// say the documents are not being filed, and carry on extracting.
const MIGRATION_FOR = {
  acquisition_reviews:   'migrations/006_acquisition_reviews.sql',
  acquisition_documents: 'migrations/023_acquisition_documents.sql',
};
function _sendMigrationMissing(res, table) {
  const t = MIGRATION_FOR[table] ? table : 'acquisition_documents';
  const file = MIGRATION_FOR[t];
  console.error('[acquisition-documents] migration_missing — run ' + file);
  return res.status(503).json({
    error:     t + ' table not found — run ' + file + ' in Supabase SQL Editor',
    code:      'migration_missing',
    table:     t,
    keySource: KEY_SOURCE,
  });
}

// A caller may touch a document only through the review that owns it.
async function _ownsReview(reviewId, userId) {
  const r = await sbFetch(
    `/acquisition_reviews?id=eq.${encodeURIComponent(reviewId)}&user_id=eq.${encodeURIComponent(userId)}&select=id`,
    { method: 'GET', headers: { 'Prefer': '' } }
  );
  if (r.status >= 300) return { ok: false, status: r.status, json: r.json };
  const rows = Array.isArray(r.json) ? r.json : [];
  return { ok: rows.length > 0, status: r.status, json: r.json };
}

// CommonJS, like api/document-url.js and for the same reason: the ownership
// rule and the write allow-list are this file's security boundary, and a test
// that can require() them exercises the rule itself rather than reading the
// source and hoping.
module.exports = async function handler(req, res) {
  const { method } = req;

  const user = await _verifyUser(req, res);
  if (!user) return;
  {
    const _rl = checkRate(user.id, 60, 60000);
    if (!_rl.ok) return sendRateLimited(res, _rl);
  }

  // ── POST — create or update one document row ─────────────────────────────
  // Upsert key is (review_id, file_name), the way lease-documents keys on
  // (property_id, file_name): re-uploading the same file name onto the same
  // review updates that row rather than filing a second copy of it.
  if (method === 'POST') {
    const body = req.body || {};
    const reviewId = body.reviewId;
    if (!reviewId || !body.fileName) {
      return res.status(400).json({ error: 'Missing reviewId or fileName', keySource: KEY_SOURCE });
    }

    const owns = await _ownsReview(reviewId, user.id);
    if (!owns.ok) {
      if (_isMigrationMissing(owns.json)) return _sendMigrationMissing(res, 'acquisition_reviews');
      return res.status(403).json({ error: 'Forbidden', keySource: KEY_SOURCE });
    }

    // camelCase in, snake_case out, through the allow-list above.
    const payload = { review_id: reviewId, user_id: user.id };
    const CAMEL = {
      fileName: 'file_name', intakeKind: 'intake_kind', byteSize: 'byte_size',
      contentType: 'content_type', storagePath: 'storage_path', extractedText: 'extracted_text',
      parsingStatus: 'parsing_status', extractionModel: 'extraction_model',
      usedPdfDirect: 'used_pdf_direct', errorMessage: 'error_message',
      producedKind: 'produced_kind', producedId: 'produced_id',
    };
    for (const [camel, snake] of Object.entries(CAMEL)) {
      if (body[camel] !== undefined) payload[snake] = WRITABLE[snake](body[camel]);
    }
    if (!payload.file_name) {
      return res.status(400).json({ error: 'fileName must be a non-empty string', keySource: KEY_SOURCE });
    }

    const result = await sbFetch(
      '/acquisition_documents?on_conflict=review_id,file_name',
      { method: 'POST', headers: { 'Prefer': 'return=representation,resolution=merge-duplicates' },
        body: JSON.stringify(payload) }
    );

    if (result.status >= 300) {
      if (_isMigrationMissing(result.json)) return _sendMigrationMissing(res);
      console.error('[acquisition-documents] write failed:', result.status, JSON.stringify(result.json).slice(0, 300));
      return res.status(502).json({ error: 'Write failed', detail: result.json, keySource: KEY_SOURCE });
    }

    const rows = Array.isArray(result.json) ? result.json : [result.json];
    // The text is not echoed back — the caller just sent it, and a list-shaped
    // response keeps this endpoint's payloads one size.
    const clean = rows.map(r => { const c = { ...r }; delete c.extracted_text; return c; });
    return res.status(200).json({ ok: true, data: clean, keySource: KEY_SOURCE });
  }

  // ── GET — list a review's documents ──────────────────────────────────────
  if (method === 'GET') {
    const { reviewId } = req.query || {};
    if (!reviewId) {
      return res.status(400).json({ error: 'Missing reviewId', keySource: KEY_SOURCE });
    }

    const owns = await _ownsReview(reviewId, user.id);
    if (!owns.ok) {
      if (_isMigrationMissing(owns.json)) return _sendMigrationMissing(res, 'acquisition_reviews');
      return res.status(403).json({ error: 'Forbidden', keySource: KEY_SOURCE });
    }

    const result = await sbFetch(
      `/acquisition_documents?review_id=eq.${encodeURIComponent(reviewId)}&order=created_at.asc&select=${LIST_COLUMNS}`,
      { method: 'GET', headers: { 'Prefer': '' } }
    );
    if (result.status >= 300) {
      if (_isMigrationMissing(result.json)) return _sendMigrationMissing(res);
      return res.status(502).json({ error: 'Query failed', detail: result.json, keySource: KEY_SOURCE });
    }

    const rows = Array.isArray(result.json) ? result.json : [];
    return res.status(200).json({ ok: true, data: rows, keySource: KEY_SOURCE });
  }

  // ── No delete ────────────────────────────────────────────────────────────
  // Said out loud rather than left to the default: this endpoint has no delete
  // BY DESIGN, and a caller that tries deserves the reason.
  if (method === 'DELETE') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({
      error: 'Acquisition documents are preserved. There is no delete; removing a source would be an explicit archive workflow.',
      keySource: KEY_SOURCE,
    });
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
};

// Exported for tests — the ownership rule and the write allow-list are the
// security boundary here and are worth exercising directly.
module.exports.LIST_COLUMNS       = LIST_COLUMNS;
module.exports.WRITABLE           = WRITABLE;
module.exports._isMigrationMissing = _isMigrationMissing;
