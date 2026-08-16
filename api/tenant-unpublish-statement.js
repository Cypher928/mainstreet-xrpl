// api/tenant-unpublish-statement.js — B2: withdraw a published statement.
// ============================================================================
// Sets status to 'void'. It NEVER deletes: the tenant may already have read the
// statement, and possibly acted on it, so the record of what they were shown has
// to survive. Voiding removes tenant visibility while leaving the landlord's
// history intact.
//
// Checks 1-5 of the publish boundary apply unchanged — the same ownership and
// tenant/property proof, because unpublishing someone else's statement is the
// same class of mistake as publishing one.
//
// There is no F-02, staleness or amount check here, and there should not be:
// withdrawing a statement is always safe, and gating it behind correctness
// checks would mean a landlord who published something wrong could be blocked
// from taking it back by the very wrongness they are trying to undo.
'use strict';

const { checkRate, sendRateLimited } = require('./_rate-limit');
const A = require('./_landlord-auth');

const ALLOWED_FIELDS = ['property_id', 'tenant_id', 'cam_year'];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  const verdict = checkRate(`unpublish-statement:${ip}`, 30, 60_000);
  if (!verdict.ok) return sendRateLimited(res, verdict);

  const user = await A.currentUser(req, res);
  if (!user) return;

  const key = A.serviceKey(res);
  if (!key) return;

  const body = req.body || {};
  if (!A.rejectUnexpectedFields(res, body, ALLOWED_FIELDS)) return;

  const { property_id: propertyId, tenant_id: tenantId, cam_year: camYear } = body;
  if (!propertyId || !tenantId) {
    return res.status(400).json({ error: 'property_id and tenant_id are required' });
  }
  if (!Number.isInteger(camYear) || camYear < 2000 || camYear > 2100) {
    return res.status(400).json({ error: 'cam_year must be a four-digit year' });
  }

  try {
    const property = await A.ownedProperty(res, key, propertyId, user.id);
    if (!property) return;

    const tenant = await A.tenantOnProperty(res, key, tenantId, propertyId);
    if (!tenant) return;

    // Conditioned on still being published, so two concurrent withdrawals cannot
    // both claim to have done it.
    const r = await A.sbFetch(
      `/tenant_statements?tenant_id=eq.${encodeURIComponent(tenantId)}` +
      `&cam_year=eq.${camYear}&status=eq.published`,
      {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ status: 'void' }),
      }, key);

    if (!r.ok) {
      const detail = await r.text().catch(() => '');
      console.error('[tenant-unpublish-statement] patch failed', r.status, detail.slice(0, 300));
      return res.status(502).json({ error: 'Could not withdraw the statement' });
    }

    const rows = await r.json().catch(() => []);
    if (!rows.length) {
      return res.status(409).json({
        error: `No published ${camYear} statement to withdraw for this tenant.`,
        code: 'not_published',
      });
    }

    return res.status(200).json({ ok: true, statement_id: rows[0].id, status: 'void' });
  } catch (e) {
    const timedOut = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
    console.error('[tenant-unpublish-statement]', e && e.message);
    return res.status(timedOut ? 503 : 500).json({
      error: timedOut ? 'Service unavailable — try again' : 'Could not withdraw the statement',
    });
  }
};
