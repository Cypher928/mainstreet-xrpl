// Serverless endpoint for MainStreet's XRPL RLUSD settlement layer.
// Tenants pay rent/CAM via a normal processor (Stripe etc.) — this endpoint settles a
// matching amount in RLUSD on the XRP Ledger as a transparent, verifiable proof-of-
// settlement record, never as a hidden rail. The settlement wallet's seed lives only
// in the XRPL_SETTLEMENT_WALLET_SEED env var — it never reaches the browser.
//
// WHY a single multi-action endpoint instead of three files: all three actions share
// the same auth/rate-limit gate and the same "wallet not funded yet" guard, and the
// production wallet is deliberately left unfunded until launch — splitting this into
// separate files now would mean duplicating that guard with no present benefit.

const { getNetworkConfig, getAccountStatus, walletFromSeed, submitTrustLine, settleRlusdPayment } = require("../rlusd-integration");

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

function _loadSigningWallet() {
  const seed = (process.env.XRPL_SETTLEMENT_WALLET_SEED || '').trim();
  if (!seed) return null;
  return walletFromSeed(seed);
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

    if (action === 'setup-trust-line') {
      const wallet = _loadSigningWallet();
      if (!wallet) {
        return res.status(503).json({ error: 'XRPL_SETTLEMENT_WALLET_SEED is not configured — wallet has not been generated/funded yet.' });
      }
      const result = await submitTrustLine(wallet, network);
      return res.status(200).json(result);
    }

    if (action === 'settle') {
      const { destination, amountUsd, metadata } = req.body || {};
      if (!destination || !(Number(amountUsd) > 0)) {
        return res.status(400).json({ error: 'destination and a positive amountUsd are required' });
      }
      const wallet = _loadSigningWallet();
      if (!wallet) {
        return res.status(503).json({ error: 'Settlement wallet is not configured yet — RLUSD settlement is unavailable until the production wallet is funded.' });
      }
      const result = await settleRlusdPayment({ wallet, destination, amountUsd, network, metadata: metadata || {} });
      return res.status(200).json(result);
    }

    return res.status(400).json({ error: 'Unknown action — expected "status", "setup-trust-line", or "settle"' });
  } catch (err) {
    console.error('[rlusd-settlement] error:', err.message);
    return res.status(502).json({ error: err.message });
  }
};
