// api/tenant-publish-document.js — B2: share a file with one tenant.
// ============================================================================
// Publishing a document is what exposes a file, so it runs the same ownership
// proof as publishing a statement (checks 1-5) plus one of its own: the file
// must belong to the property being published from.
//
// The split write is the point. Display metadata goes to tenant_documents, which
// the tenant can read; the storage location goes to tenant_document_sources,
// which has no tenant policy. A tenant therefore holds an id and a title, and
// has to come back through tenant-document-url to get anything openable.
'use strict';

const { checkRate, sendRateLimited } = require('./_rate-limit');
const A = require('./_landlord-auth');

const ALLOWED_FIELDS = [
  'property_id', 'tenant_id', 'title', 'doc_kind',
  'storage_path', 'storage_bucket', 'content_type', 'byte_size',
  'lease_document_id', 'statement_id',
];
const DOC_KINDS = ['lease', 'statement', 'invoice', 'notice', 'other'];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  const verdict = checkRate(`publish-doc:${ip}`, 30, 60_000);
  if (!verdict.ok) return sendRateLimited(res, verdict);

  const user = await A.currentUser(req, res);
  if (!user) return;

  const key = A.serviceKey(res);
  if (!key) return;

  const body = req.body || {};
  if (!A.rejectUnexpectedFields(res, body, ALLOWED_FIELDS)) return;

  const { property_id: propertyId, tenant_id: tenantId, title, doc_kind: docKind,
          storage_path: storagePath } = body;

  if (!propertyId || !tenantId) return res.status(400).json({ error: 'property_id and tenant_id are required' });
  if (typeof title !== 'string' || !title.trim()) return res.status(400).json({ error: 'title is required' });
  if (!DOC_KINDS.includes(docKind)) {
    return res.status(400).json({ error: 'doc_kind must be one of: ' + DOC_KINDS.join(', ') });
  }
  if (typeof storagePath !== 'string' || !storagePath.trim()) {
    return res.status(400).json({ error: 'storage_path is required' });
  }

  try {
    const property = await A.ownedProperty(res, key, propertyId, user.id);
    if (!property) return;

    const tenant = await A.tenantOnProperty(res, key, tenantId, propertyId);
    if (!tenant) return;

    // If the landlord names an existing lease document, it must be one of
    // theirs on this property — otherwise this route becomes a way to share
    // another landlord's file by id.
    if (body.lease_document_id) {
      const ldR = await A.sbFetch(
        `/lease_documents?id=eq.${encodeURIComponent(body.lease_document_id)}` +
        `&property_id=eq.${encodeURIComponent(propertyId)}&select=id`,
        { method: 'GET' }, key);
      const lds = ldR.ok ? await ldR.json().catch(() => []) : [];
      if (!lds.length) {
        return res.status(400).json({ error: 'That document does not belong to this property' });
      }
    }

    const now = new Date().toISOString();
    const insR = await A.sbFetch('/tenant_documents', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        tenant_id: tenantId,
        property_id: propertyId,
        title: title.trim(),
        doc_kind: docKind,
        content_type: body.content_type || null,
        byte_size: body.byte_size == null ? null : Number(body.byte_size),
        status: 'published',
        published_at: now,
      }),
    }, key);

    if (!insR.ok) {
      const detail = await insR.text().catch(() => '');
      console.error('[tenant-publish-document] insert failed', insR.status, detail.slice(0, 300));
      return res.status(502).json({ error: 'Could not share the document' });
    }
    const rows = await insR.json().catch(() => []);
    const doc = Array.isArray(rows) ? rows[0] : null;
    if (!doc) return res.status(502).json({ error: 'Could not share the document' });

    // The location, written only to the companion.
    const srcR = await A.sbFetch('/tenant_document_sources', {
      method: 'POST',
      body: JSON.stringify({
        document_id: doc.id,
        property_id: propertyId,
        storage_path: storagePath.trim(),
        storage_bucket: body.storage_bucket || null,
        lease_document_id: body.lease_document_id || null,
        statement_id: body.statement_id || null,
        published_by: user.id,
      }),
    }, key);

    if (!srcR.ok) {
      // Without a location the row is undownloadable, so do not leave it
      // visible: withdraw it rather than publishing a dead link.
      await A.sbFetch(`/tenant_documents?id=eq.${doc.id}`, {
        method: 'PATCH', body: JSON.stringify({ status: 'withdrawn' }),
      }, key);
      const detail = await srcR.text().catch(() => '');
      console.error('[tenant-publish-document] source insert failed', srcR.status, detail.slice(0, 300));
      return res.status(502).json({ error: 'Could not share the document' });
    }

    return res.status(200).json({ ok: true, document_id: doc.id, status: 'published' });
  } catch (e) {
    const timedOut = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
    console.error('[tenant-publish-document]', e && e.message);
    return res.status(timedOut ? 503 : 500).json({
      error: timedOut ? 'Service unavailable — try again' : 'Could not share the document',
    });
  }
};
