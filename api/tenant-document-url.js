// api/tenant-document-url.js — B2: a tenant fetches a shared document.
// ============================================================================
// The tenant asks by tenant_documents.id and never learns where the file lives.
// storage_path is in tenant_document_sources, which has no tenant policy, so
// even a compromised portal bundle cannot read it — the boundary is in the
// database, not in this file.
//
// api/document-url.js is deliberately untouched. It authorizes by
// path.split('/')[0] === user.id and every object is uploaded under
// ${landlord.id}/…, so a tenant can never satisfy it. Widening that rule to let
// tenants through would weaken the landlord's path to serve the weaker case;
// a separate route with its own, stricter rule is the correct shape.
//
// ONE OPAQUE REFUSAL for every rejected fetch. Unlike the publish routes — whose
// caller is the verified owner — this caller is a tenant, and distinguishable
// errors would let them probe which document ids exist and which are merely
// unpublished. "Not yours", "not published" and "no such document" are the same
// sentence, following tenant-accept-invite.
'use strict';

const { checkRate, sendRateLimited } = require('./_rate-limit');
const A = require('./_landlord-auth');

const SIGNED_URL_TTL = 120;   // seconds — long enough to start a download, short
                              // enough that a leaked URL is not a standing grant.

function refuse(res) {
  return res.status(400).json({ error: 'That document is not available.' });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  const verdict = checkRate(`tenant-doc-url:${ip}`, 20, 60_000);
  if (!verdict.ok) return sendRateLimited(res, verdict);

  // Authentication is answered plainly — a signed-out caller learns only that
  // they are signed out, which they already know.
  const user = await A.currentUser(req, res);
  if (!user) return;

  const key = A.serviceKey(res);
  if (!key) return;

  const documentId = req.body && req.body.document_id;
  if (typeof documentId !== 'string' || !/^[0-9a-f-]{36}$/i.test(documentId)) return refuse(res);

  try {
    // Membership is re-derived here rather than trusted from the request. The
    // service role bypasses RLS, so this endpoint must re-apply the same rule
    // the tenant's own session would have been held to.
    const memR = await A.sbFetch(
      `/tenant_users?user_id=eq.${encodeURIComponent(user.id)}` +
      `&accepted_at=not.is.null&revoked_at=is.null&select=tenant_id`,
      { method: 'GET' }, key);
    if (!memR.ok) return res.status(502).json({ error: 'Could not verify your access' });
    const memberships = await memR.json().catch(() => []);
    const tenantIds = (memberships || []).map((m) => m.tenant_id);
    if (!tenantIds.length) return refuse(res);

    // The document must be published AND belong to a space this caller holds.
    const docR = await A.sbFetch(
      `/tenant_documents?id=eq.${encodeURIComponent(documentId)}` +
      `&status=eq.published&select=id,tenant_id,title,content_type`,
      { method: 'GET' }, key);
    if (!docR.ok) return res.status(502).json({ error: 'Could not load the document' });
    const docs = await docR.json().catch(() => []);
    const doc = Array.isArray(docs) ? docs[0] : null;
    if (!doc || !tenantIds.includes(doc.tenant_id)) return refuse(res);

    // Only now is the storage location read, with the service role.
    const srcR = await A.sbFetch(
      `/tenant_document_sources?document_id=eq.${encodeURIComponent(documentId)}` +
      `&select=storage_path,storage_bucket`,
      { method: 'GET' }, key);
    if (!srcR.ok) return res.status(502).json({ error: 'Could not load the document' });
    const srcs = await srcR.json().catch(() => []);
    const src = Array.isArray(srcs) ? srcs[0] : null;
    if (!src || !src.storage_path) return refuse(res);

    const bucket = src.storage_bucket || 'lease-documents';
    const signR = await fetch(
      `${A.SUPABASE_URL}/storage/v1/object/sign/${encodeURIComponent(bucket)}/${src.storage_path}`,
      {
        method: 'POST',
        signal: AbortSignal.timeout(6000),
        headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ expiresIn: SIGNED_URL_TTL }),
      });
    if (!signR.ok) {
      console.error('[tenant-document-url] sign failed', signR.status);
      return res.status(502).json({ error: 'Could not prepare the download' });
    }
    const signed = await signR.json().catch(() => ({}));
    if (!signed || !signed.signedURL) return res.status(502).json({ error: 'Could not prepare the download' });

    return res.status(200).json({
      url: `${A.SUPABASE_URL}/storage/v1${signed.signedURL}`,
      expires_in: SIGNED_URL_TTL,
      title: doc.title,
      content_type: doc.content_type || null,
    });
  } catch (e) {
    const timedOut = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
    console.error('[tenant-document-url]', e && e.message);
    return res.status(timedOut ? 503 : 500).json({
      error: timedOut ? 'Service unavailable — try again' : 'Could not prepare the download',
    });
  }
};
