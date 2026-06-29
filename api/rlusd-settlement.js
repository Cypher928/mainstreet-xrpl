// Serverless endpoint for MainStreet's XRPL RLUSD settlement layer — READ-ONLY.
// It exposes only the `status` action (wallet activation / trust line / RLUSD balance),
// which is what the in-app settlement panel reads.
//
// SECURITY: fund-moving actions (establishing the trust line, sending a settlement) are
// intentionally NOT exposed here. They are performed out-of-band by a local admin who
// holds the wallet seed, via scripts/setup-trust-line.js and scripts/send-settlement.js.
// This endpoint therefore never loads the seed and cannot sign or submit any transaction,
// so no authenticated request can move funds from the settlement wallet.

const { getNetworkConfig, getAccountStatus } = require("../rlusd-integration");

const _SB_URL  = (process.env.SUPABASE_URL      || '').trim();
const _SB_ANON = (process.env.SUPABASE_ANON_KEY || '').trim();
if (!_SB_URL || !_SB_ANON) {
  throw new Error('[api/rlusd-settlement] SUPABASE_URL and SUPABASE_ANON_KEY env vars are required');
}

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
    const r = await fetch(`${_SB_URL}/auth/v1/user`, {
      signal: AbortSignal.timeout(3000),
      headers: { apikey: (process.env.SUPABASE_SERVICE_ROLE_KEY || _SB_ANON).trim(), Authorization: `Bearer ${tok}` },
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

function _walletAddress() {
  return (process.env.XRPL_SETTLEMENT_WALLET_ADDRESS || '').trim();
}

function _network() {
  return (process.env.XRPL_NETWORK || 'mainnet').trim();
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await _verifyUser(req, res);
  if (!user) return;
  if (!_chkRate(user.id, 20, 60000)) {
    return res.status(429).json({ error: 'Too many requests — please slow down.' });
  }

  const { action } = req.body || {};
  const network = _network();
  const address = _walletAddress();

  try {
    if (action === 'status') {
      if (!address) {
        return res.status(200).json({
          configured: false,
          network,
          message: 'Settlement wallet has not been generated yet. Run scripts/generate-settlement-wallet.js.',
        });
      }
      const status = await getAccountStatus(address, network);
      return res.status(200).json({ configured: true, network, ...status, explorerBase: getNetworkConfig(network).explorerBase });
    }

    if (action === 'setup-trust-line' || action === 'settle') {
      // Fund-moving actions are deliberately disabled on the public endpoint. They are
      // performed by a local admin holding the wallet seed (scripts/setup-trust-line.js,
      // scripts/send-settlement.js). This endpoint cannot sign or submit transactions.
      return res.status(403).json({ error: 'This endpoint is read-only. Trust-line setup and settlement are performed via local admin scripts.' });
    }

    return res.status(400).json({ error: 'Unknown action — this endpoint supports only "status".' });
  } catch (err) {
    console.error('[rlusd-settlement] error:', err.message);
    return res.status(502).json({ error: err.message });
  }
};
