'use strict';
/**
 * POST /api/upload?op=ledger-reverse — reverse one general ledger import
 * (migration 046). Not a function of its own; see api/_ledger-import.js.
 *
 *   { sourceId, reason }
 *
 * The person is verified from their own token, must be able to see the import
 * (row rules, as themselves), and reverse_general_ledger_import — called as
 * service_role, naming them — requires them to be a property admin (the owner
 * or an organisation admin), a reason, and an acquisition that is still open.
 * Lines no other import holds are archived, then removed; lines another import
 * still holds stay. The reversal is recorded in ledger_import_history.
 */
const { UUID, verifyUser, refusal } = require('./_ledger-common');

function createHandler(deps) {
  const t = deps.target;
  const fetchFn = deps.fetch || fetch;
  const rate = deps.rate || require('./_rate-limit');
  const log = deps.log || console.error;

  return async function handler(req, res) {
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Method not allowed' }); }
    if (!t.serviceRoleKey) return res.status(503).json({ error: 'Ledger reversal is not configured on this server' });

    const user = await verifyUser(t, fetchFn, req, res);
    if (!user) return;
    const rl = rate.checkRate('ledger-reverse:' + user.id, 10, 60000);
    if (!rl.ok) return rate.sendRateLimited(res, rl);

    const b = req.body || {};
    if (!UUID.test(String(b.sourceId || ''))) return res.status(400).json({ error: 'sourceId is required' });
    const reason = String(b.reason == null ? '' : b.reason).trim().slice(0, 1000);
    if (!reason) return res.status(400).json({ error: 'A reversal needs a reason' });

    try {
      const r = await fetchFn(`${t.url}/rest/v1/financial_sources?id=eq.${b.sourceId}&select=id`, {
        signal: AbortSignal.timeout(4000),
        headers: { apikey: t.anonKey, Authorization: `Bearer ${user.token}`, Accept: 'application/json' },
      });
      if (!r.ok) { const f = refusal(r.status, await r.text(), log); return res.status(f.http).json(f.body); }
      if (!(await r.json())[0]) return res.status(404).json({ error: 'That import is not one you can see' });
    } catch (e) {
      return res.status(502).json({ error: 'Could not read the import' });
    }

    let r, text;
    try {
      r = await fetchFn(`${t.url}/rest/v1/rpc/reverse_general_ledger_import`, {
        method: 'POST',
        signal: AbortSignal.timeout(10000),
        headers: { apikey: t.serviceRoleKey, Authorization: `Bearer ${t.serviceRoleKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_actor: user.id, p_source_id: b.sourceId, p_reason: reason }),
      });
      text = await r.text();
    } catch (e) {
      return res.status(504).json({ error: 'The reversal did not answer in time. Check the import\'s status before trying again.', code: 'outcome_unknown' });
    }
    if (!r.ok) { const f = refusal(r.status, text, log); return res.status(f.http).json(f.body); }
    let result;
    try { result = JSON.parse(text); } catch (_) { return res.status(502).json({ error: 'The database returned an unreadable result' }); }
    return res.status(200).json(result);
  };
}

module.exports = createHandler({ target: require('./_pilot-target') });
module.exports.createHandler = createHandler;
