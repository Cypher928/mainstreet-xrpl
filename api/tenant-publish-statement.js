// api/tenant-publish-statement.js — B2: the publication trust boundary.
// ============================================================================
// Publishing is the moment landlord working data becomes tenant-visible fact.
// Every control that matters lives here, because after this returns 200 the
// tenant can read the row and RLS will not second-guess any of it.
//
// TWELVE CHECKS, IN ORDER. Numbered in the code so the tests can name them.
//
//   1  POST + rate limit                    405 / 429
//   2  caller is authenticated              401
//   3  no unexpected fields                 400   <- no amounts from the client
//   4  caller owns the property             403   <- the authorization decision
//   5  tenant belongs to that property      400
//   6  cam_year well formed, matches source 400 / 409
//   7  exactly one reconciliation row       409
//   8  source not stale                     409
//   9  F-02 exclusions not blocking         409
//   10 amounts derived, required non-null   409
//   11 source hash unchanged                409
//   12 atomic supersede-and-publish         409
//
// THE AMOUNT NEVER COMES FROM THE CLIENT. It is read from cam_reconciliations
// and written from there. This is the same rule B3 will need for Stripe, and it
// is cheaper to establish now than to retrofit around a shipped shape.
//
// ERRORS HERE ARE SPECIFIC, unlike tenant-accept-invite's single opaque refusal.
// That endpoint answers untrusted strangers, where distinguishable failures are
// an enumeration oracle. This one answers the verified owner of the data, who
// needs to know whether the problem is a stale reconciliation, an unresolved
// exclusion or a year mismatch. Nothing is disclosed to anyone who is not
// already the owner, because check 4 runs before any of those can be reached.
'use strict';

const crypto = require('crypto');
const { checkRate, sendRateLimited } = require('./_rate-limit');
const A = require('./_landlord-auth');
const { exclusionBlockReason, findTenantRecord } = require('./_exclusion-block');

const ALLOWED_FIELDS = ['property_id', 'tenant_id', 'cam_year', 'expected_source_hash'];

// Identity + figures of the reconciliation this statement was cut from. If any
// of it changes, the hash changes, and a landlord publishing against a view of
// the data that has since moved is refused rather than silently applied.
function runHash(rec) {
  return crypto.createHash('sha256').update(JSON.stringify({
    id: rec.id, year: rec.year,
    allocated: rec.allocated_amount, pro_rata: rec.pro_rata_percent,
    total: rec.total_expenses, billed: rec.expected_cam,
    reconciled_at: rec.reconciled_at,
  })).digest('hex');
}

const money = (v) => (v === null || v === undefined ? null : Number(v));

module.exports = async function handler(req, res) {
  // ── 1 ── method + rate limit ─────────────────────────────────────────────
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  const verdict = checkRate(`publish-statement:${ip}`, 30, 60_000);
  if (!verdict.ok) return sendRateLimited(res, verdict);

  // ── 2 ── caller is authenticated ─────────────────────────────────────────
  const user = await A.currentUser(req, res);
  if (!user) return;

  const key = A.serviceKey(res);
  if (!key) return;

  const body = req.body || {};

  // ── 3 ── nothing the server derives may be supplied ──────────────────────
  if (!A.rejectUnexpectedFields(res, body, ALLOWED_FIELDS)) return;

  const propertyId = body.property_id;
  const tenantId   = body.tenant_id;
  const camYear    = body.cam_year;

  if (!propertyId || !tenantId) {
    return res.status(400).json({ error: 'property_id and tenant_id are required' });
  }

  // ── 6a ── cam_year well formed (range is also enforced by a CHECK) ───────
  if (!Number.isInteger(camYear) || camYear < 2000 || camYear > 2100) {
    return res.status(400).json({ error: 'cam_year must be a four-digit year' });
  }

  try {
    // ── 4 ── ownership ─────────────────────────────────────────────────────
    const property = await A.ownedProperty(res, key, propertyId, user.id);
    if (!property) return;

    // ── 5 ── tenant belongs to that property ───────────────────────────────
    const tenant = await A.tenantOnProperty(res, key, tenantId, propertyId);
    if (!tenant) return;

    // ── 7 ── exactly one reconciliation to publish ─────────────────────────
    const recR = await A.sbFetch(
      `/cam_reconciliations?property_id=eq.${encodeURIComponent(propertyId)}` +
      `&tenant_id=eq.${encodeURIComponent(tenantId)}&year=eq.${camYear}` +
      `&select=id,year,tenant_name,allocated_amount,pro_rata_percent,total_expenses,expected_cam,actual_cam,reconciled_at`,
      { method: 'GET' }, key);
    if (!recR.ok) return res.status(502).json({ error: 'Could not load the reconciliation' });
    const recs = await recR.json().catch(() => []);

    if (!recs.length) {
      return res.status(409).json({
        error: `No ${camYear} reconciliation exists for this tenant. Run the reconciliation before publishing.`,
        code: 'no_source',
      });
    }
    if (recs.length > 1) {
      // Publishing one of several would be a guess about which figures are real.
      return res.status(409).json({
        error: `There are ${recs.length} ${camYear} reconciliations for this tenant. Resolve the duplicates before publishing.`,
        code: 'ambiguous_source',
      });
    }
    const rec = recs[0];

    // ── 6b ── the source's year must be the year being published ───────────
    if (Number(rec.year) !== camYear) {
      return res.status(409).json({
        error: `The reconciliation is for ${rec.year}, not ${camYear}.`,
        code: 'year_mismatch',
      });
    }

    // ── 8 ── the source must not be stale ──────────────────────────────────
    // The durable analogue of the in-memory _resultsStale flag: if the property
    // changed after these figures were computed, they no longer describe it.
    // Property-grained, so it over-blocks rather than under-blocks — recorded as
    // debt B2-D2.
    const reconciledAt = rec.reconciled_at ? Date.parse(rec.reconciled_at) : null;
    const propUpdated  = property.updated_at ? Date.parse(property.updated_at) : null;
    if (!reconciledAt) {
      return res.status(409).json({
        error: 'This reconciliation has no completion time and cannot be published.',
        code: 'stale_source',
      });
    }
    if (propUpdated && propUpdated > reconciledAt) {
      return res.status(409).json({
        error: 'The property changed after this reconciliation ran. Re-run it before publishing.',
        code: 'stale_source',
      });
    }

    // ── 9 ── F-02 ──────────────────────────────────────────────────────────
    // Same resolver the browser uses (cam-exclusions.js), same acknowledgement
    // rule. A statement generateTenantStatement() would refuse cannot be
    // published through this door either.
    const tenantRecord = findTenantRecord(property.data, rec.tenant_name || tenant.name);
    const block = exclusionBlockReason(tenantRecord);
    if (block) {
      return res.status(409).json({
        error: block.reason,
        code: block.staleAck ? 'exclusions_ack_stale' : 'exclusions_unresolved',
        not_applied: block.notApplied,
      });
    }

    // ── 10 ── amounts derived from the source, never from the request ──────
    const allocated = money(rec.allocated_amount);
    const proRata   = money(rec.pro_rata_percent);
    const pool      = money(rec.total_expenses);
    const billed    = money(rec.expected_cam);

    if (allocated === null || proRata === null || pool === null) {
      return res.status(409).json({
        error: 'This reconciliation is missing the figures a statement needs (allocation, share, or pool total).',
        code: 'incomplete_source',
      });
    }
    const balance = billed === null ? null : Number((allocated - billed).toFixed(2));

    // ── 11 ── the source has not moved under the landlord ──────────────────
    const hash = runHash(rec);
    if (body.expected_source_hash && body.expected_source_hash !== hash) {
      return res.status(409).json({
        error: 'These figures changed since you loaded them. Review the reconciliation and publish again.',
        code: 'source_changed',
      });
    }

    // The tenant-visible slice. Composed here, deliberately narrow: this tenant's
    // own line items and nothing about anyone else, no exclusion reasoning, no
    // evidence, no audit reference, no confidence score, no model name.
    const statementJson = {
      line_items: Array.isArray(rec.line_items) ? rec.line_items : [],
      method_note: `Allocated by rentable square footage (${proRata}% of the pool).`,
      questions_to: null,
      cam_year: camYear,
    };

    // ── 12 ── atomic supersede-and-publish ─────────────────────────────────
    const rpc = await A.sbFetch('/rpc/publish_tenant_statement', {
      method: 'POST',
      body: JSON.stringify({
        p_tenant_id: tenantId,
        p_property_id: propertyId,
        p_cam_year: camYear,
        p_allocated_amount: allocated,
        p_pro_rata_percent: proRata,
        p_total_pool: pool,
        p_amount_billed: billed,
        p_balance_due: balance,
        p_statement_json: statementJson,
        p_reconciliation_id: rec.id,
        p_source_run_hash: hash,
        p_published_by: user.id,
      }),
    }, key);

    if (!rpc.ok) {
      const detail = await rpc.text().catch(() => '');
      console.error('[tenant-publish-statement] rpc failed', rpc.status, detail.slice(0, 300));
      return res.status(409).json({
        error: 'Could not publish the statement. It may have been published by someone else — reload and try again.',
        code: 'publish_failed',
      });
    }

    const row = await rpc.json().catch(() => null);
    const stmt = Array.isArray(row) ? row[0] : row;

    return res.status(200).json({
      ok: true,
      statement_id: stmt && stmt.id,
      version: stmt && stmt.version,
      status: 'published',
      source_hash: hash,
    });
  } catch (e) {
    const timedOut = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
    console.error('[tenant-publish-statement]', e && e.message);
    return res.status(timedOut ? 503 : 500).json({
      error: timedOut ? 'Service unavailable — try again' : 'Could not publish the statement',
    });
  }
};
