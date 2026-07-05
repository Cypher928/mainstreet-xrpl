/**
 * Verification of an RLUSD mainnet settlement — read-only (never signs or submits).
 *
 * Run from an environment WITH outbound network access (not the dev sandbox, which is
 * network-blocked from XRPL):
 *
 *   # Easiest — give the settlement wallet address; it finds the latest RLUSD payment itself:
 *   node scripts/verify-settlement.js <settlementWalletAddress>
 *
 *   # Or verify a specific transaction by hash (optionally with the wallet to check the sender):
 *   node scripts/verify-settlement.js <txHash> [settlementWalletAddress]
 *
 * Arguments are auto-classified: a 64-hex string is treated as a tx hash (stray spaces/
 * newlines from a paste are stripped), an r... string as a wallet address — order doesn't
 * matter. It connects to XRPL, looks up the transaction, and confirms it's a successful
 * RLUSD Payment — the same checks a judge would do on the explorer, automated. It tries
 * several endpoints so a single node that doesn't implement a command doesn't block it.
 */

const xrpl = require("xrpl");
const { getNetworkConfig, getAccountStatus, RLUSD_CURRENCY_HEX } = require("../rlusd-integration");

const NETWORK = (process.env.XRPL_NETWORK || "mainnet").trim();

// Classify positional args: a string that reduces to 64 hex chars is a tx hash (this tolerates
// spaces/newlines a terminal may inject into a pasted hash); an r... classic address is a wallet.
let TXHASH = "";
let WALLET = (process.env.XRPL_SETTLEMENT_WALLET_ADDRESS || "").trim();
for (const a of process.argv.slice(2)) {
  const hex = (a || "").replace(/[^0-9a-fA-F]/g, "").toUpperCase();
  if (hex.length === 64) { TXHASH = hex; continue; }
  if (xrpl.isValidClassicAddress((a || "").trim())) { WALLET = a.trim(); continue; }
}
if (!TXHASH && process.env.XRPL_SETTLEMENT_TX) {
  const hex = process.env.XRPL_SETTLEMENT_TX.replace(/[^0-9a-fA-F]/g, "").toUpperCase();
  if (hex.length === 64) TXHASH = hex;
}

let pass = 0, fail = 0;
const ok = (m) => { console.log("  \x1b[32m✓\x1b[0m " + m); pass++; };
const bad = (m) => { console.log("  \x1b[31m✗\x1b[0m " + m); fail++; };

const cfg = getNetworkConfig(NETWORK);
// Try the configured node first, then full-history public servers. Some nodes / load-balanced
// clusters return "notImpl" for `tx`/`account_tx`; falling through makes lookups reliable.
const endpoints = NETWORK === "mainnet"
  ? [cfg.wss, "wss://s2.ripple.com", "wss://s1.ripple.com"]
  : [cfg.wss];

// Run a read-only request against the endpoints in order; return the first success.
async function tryEndpoints(fn) {
  let lastErr = null;
  for (const wss of endpoints) {
    const client = new xrpl.Client(wss);
    try {
      await client.connect();
    } catch (e) {
      lastErr = `connect failed (${e.message})`;
      try { await client.disconnect(); } catch (_) { /* ignore */ }
      continue;
    }
    try {
      const out = await fn(client);
      await client.disconnect();
      return { out, wss, err: null };
    } catch (e) {
      lastErr = (e && e.data && e.data.error) || (e && e.message) || String(e);
      try { await client.disconnect(); } catch (_) { /* ignore */ }
      continue;
    }
  }
  return { out: null, wss: null, err: lastErr };
}

function isRlusdAmount(amt) {
  return amt && typeof amt === "object" && (amt.currency === RLUSD_CURRENCY_HEX || amt.currency === "RLUSD");
}

(async () => {
  console.log(`\nVerifying ${NETWORK} settlement`);
  console.log("Explorer base:", cfg.explorerBase, "\n");

  // Wallet status (informational)
  if (WALLET) {
    try {
      const s = await getAccountStatus(WALLET, NETWORK);
      console.log("Settlement wallet:", WALLET);
      console.log(`  exists=${s.exists} · XRP=${s.xrpBalance} · trustLine=${s.trustLineEstablished} · RLUSD=${s.rlusdBalance}\n`);
    } catch (e) {
      console.log("  (wallet status lookup failed:", e.message, ")\n");
    }
  }

  // If no valid hash was given, auto-discover the latest RLUSD Payment sent from the wallet.
  if (!TXHASH) {
    if (!WALLET) {
      console.error("Provide a 64-character transaction hash, or the settlement wallet address to auto-find the latest RLUSD settlement.");
      process.exit(2);
    }
    console.log("No tx hash given — searching the wallet's recent transactions for the latest RLUSD payment…");
    const { out, wss, err } = await tryEndpoints((c) => c.request({
      command: "account_tx", account: WALLET, ledger_index_min: -1, ledger_index_max: -1, limit: 30, binary: false,
    }));
    if (!out) {
      console.error(`Could not read the wallet's transactions (last error: ${err}).`);
      console.error(`Endpoints tried: ${endpoints.join(", ")}`);
      process.exit(1);
    }
    const rows = out.result.transactions || [];
    let found = null;
    for (const row of rows) {
      const t = row.tx || row.tx_json || row;
      const amt = t.Amount != null ? t.Amount : t.DeliverMax;
      if (t.TransactionType === "Payment" && t.Account === WALLET && isRlusdAmount(amt)) {
        found = t.hash || row.hash || null;
        if (found) break;
      }
    }
    if (!found) {
      console.error("No RLUSD Payment sent from this wallet was found in its recent transactions.");
      process.exit(1);
    }
    TXHASH = String(found).toUpperCase();
    console.log(`Found RLUSD settlement: ${TXHASH}  (via ${wss})\n`);
  }

  // Look up the transaction by hash.
  const { out: txResp, wss: usedEndpoint, err } = await tryEndpoints((c) =>
    c.request({ command: "tx", transaction: TXHASH, binary: false }));
  if (!txResp) {
    console.error(`Transaction lookup failed on all endpoints (last error: ${err}).`);
    console.error(`Endpoints tried: ${endpoints.join(", ")}`);
    process.exit(1);
  }
  const r = txResp.result;
  const meta = r.meta || r.metaData || {};

  console.log("Looked up via:", usedEndpoint);
  console.log("Transaction:", cfg.explorerBase + TXHASH, "\n");

  // Assertions
  (r.TransactionType === "Payment") ? ok("type is Payment") : bad(`type is ${r.TransactionType} (expected Payment)`);

  const result = meta.TransactionResult;
  (result === "tesSUCCESS") ? ok("on-ledger result tesSUCCESS") : bad(`on-ledger result ${result}`);

  if (WALLET) {
    (r.Account === WALLET) ? ok("sent from the settlement wallet") : bad(`sender ${r.Account} ≠ settlement wallet`);
  }

  const amt = r.Amount != null ? r.Amount : r.DeliverMax;
  if (isRlusdAmount(amt)) {
    ok(`amount is RLUSD (${amt.value})`);
    (amt.issuer === cfg.issuer) ? ok("RLUSD issuer matches Ripple's official issuer") : bad(`issuer ${amt.issuer} ≠ ${cfg.issuer}`);
  } else {
    bad(`amount is ${JSON.stringify(amt)} (not an RLUSD payment)`);
  }

  const hasMemo = Array.isArray(r.Memos) && r.Memos.length > 0;
  hasMemo ? ok("carries a memo (settlement metadata)") : console.log("  · no memo present (optional)");

  if (r.Destination) console.log(`  · destination: ${r.Destination}`);
  if (r.SourceTag != null) console.log(`  · SourceTag present (${r.SourceTag})`);
  if (r.DestinationTag != null) console.log(`  · DestinationTag present (${r.DestinationTag})`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => { console.error("verify-settlement crashed:", e); process.exit(2); });
