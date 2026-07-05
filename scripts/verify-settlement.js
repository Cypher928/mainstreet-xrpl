/**
 * Post-launch verification of the first real RLUSD mainnet settlement.
 *
 * Run from an environment WITH outbound network access (not the dev sandbox, which is
 * network-blocked from XRPL):
 *
 *   node scripts/verify-settlement.js <txHash> [settlementWalletAddress]
 *   # or:  XRPL_SETTLEMENT_TX=<txHash> node scripts/verify-settlement.js
 *
 * Pass the settlement wallet address as the optional 2nd argument (or set
 * XRPL_SETTLEMENT_WALLET_ADDRESS) to also verify the payment was sent from it.
 *
 * It connects to XRPL mainnet, looks up the transaction, and confirms it is a successful
 * RLUSD Payment from the settlement wallet — the exact checks a judge (or you) would do
 * on the explorer, automated. It also prints the wallet's current on-ledger status.
 *
 * Read-only: never signs or submits anything.
 */

const xrpl = require("xrpl");
const {
  getNetworkConfig,
  getAccountStatus,
  RLUSD_CURRENCY_HEX,
} = require("../rlusd-integration");

const NETWORK = (process.env.XRPL_NETWORK || "mainnet").trim();
const TXHASH = (process.argv[2] || process.env.XRPL_SETTLEMENT_TX || "").trim();
const WALLET = (process.env.XRPL_SETTLEMENT_WALLET_ADDRESS || process.argv[3] || "").trim();

let pass = 0, fail = 0;
const ok = (m) => { console.log("  \x1b[32m✓\x1b[0m " + m); pass++; };
const bad = (m) => { console.log("  \x1b[31m✗\x1b[0m " + m); fail++; };

(async () => {
  const cfg = getNetworkConfig(NETWORK);
  console.log(`\nVerifying ${NETWORK} settlement`);
  console.log("Explorer base:", cfg.explorerBase, "\n");

  if (!TXHASH) {
    console.error("No transaction hash provided. Pass it as the first argument or set XRPL_SETTLEMENT_TX.");
    process.exit(2);
  }

  // 1) Wallet status (informational; needs XRPL_SETTLEMENT_WALLET_ADDRESS)
  if (WALLET) {
    try {
      const s = await getAccountStatus(WALLET, NETWORK);
      console.log("Settlement wallet:", WALLET);
      console.log(`  exists=${s.exists} · XRP=${s.xrpBalance} · trustLine=${s.trustLineEstablished} · RLUSD=${s.rlusdBalance}\n`);
    } catch (e) {
      console.log("  (wallet status lookup failed:", e.message, ")\n");
    }
  } else {
    console.log("(XRPL_SETTLEMENT_WALLET_ADDRESS not set — skipping wallet status; tx checks still run)\n");
  }

  // 2) Look up the transaction — try several endpoints in order. Some public nodes (and
  // load-balanced clusters like xrplcluster.com) return "notImpl" for the `tx` command even
  // though they answer account_info fine; falling back to a full-history server makes the
  // lookup reliable. Read-only throughout — never signs or submits.
  const endpoints = NETWORK === "mainnet"
    ? [cfg.wss, "wss://s2.ripple.com", "wss://s1.ripple.com"]
    : [cfg.wss];

  let tx = null, usedEndpoint = null, lastErr = null, sawNotFound = false;
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
      const resp = await client.request({ command: "tx", transaction: TXHASH, binary: false });
      tx = resp;
      usedEndpoint = wss;
      await client.disconnect();
      break;
    } catch (e) {
      const errCode = e && e.data && e.data.error;         // rippled error code, e.g. "notImpl", "txnNotFound"
      lastErr = errCode || (e && e.message) || String(e);
      if (errCode === "txnNotFound") sawNotFound = true;    // this node has history but not this tx
      try { await client.disconnect(); } catch (_) { /* ignore */ }
      continue;                                             // notImpl / partial history → try the next endpoint
    }
  }

  if (!tx) {
    if (sawNotFound) {
      console.error(`Transaction ${TXHASH} was not found on any endpoint.`);
      console.error("Double-check the hash; if it's very recent, wait a few seconds and retry.");
    } else {
      console.error(`Transaction lookup failed on all endpoints (last error: ${lastErr}).`);
    }
    console.error(`Endpoints tried: ${endpoints.join(", ")}`);
    process.exit(1);
  }

  const r = tx.result;
  const meta = r.meta || r.metaData || {};

  console.log("Looked up via:", usedEndpoint);
  console.log("Transaction:", cfg.explorerBase + TXHASH, "\n");

  // 3) Assertions
  (r.TransactionType === "Payment") ? ok("type is Payment") : bad(`type is ${r.TransactionType} (expected Payment)`);

  const result = meta.TransactionResult;
  (result === "tesSUCCESS") ? ok("on-ledger result tesSUCCESS") : bad(`on-ledger result ${result}`);

  if (WALLET) {
    (r.Account === WALLET) ? ok("sent from the settlement wallet") : bad(`sender ${r.Account} ≠ settlement wallet`);
  }

  const amt = r.Amount;
  if (amt && typeof amt === "object") {
    const isRlusd = (amt.currency === RLUSD_CURRENCY_HEX || amt.currency === "RLUSD");
    isRlusd ? ok(`amount is RLUSD (${amt.value})`) : bad(`amount currency ${amt.currency} is not RLUSD`);
    (amt.issuer === cfg.issuer) ? ok("RLUSD issuer matches Ripple's official issuer") : bad(`issuer ${amt.issuer} ≠ ${cfg.issuer}`);
  } else {
    bad(`amount is ${amt} (XRP drops, not an RLUSD payment)`);
  }

  if (r.Destination) console.log(`  · destination: ${r.Destination}`);

  const hasMemo = Array.isArray(r.Memos) && r.Memos.length > 0;
  hasMemo ? ok("carries a memo (settlement metadata)") : console.log("  · no memo present (optional)");

  // Informational only — the program's attribution mechanism is not yet verified (it may use a
  // registered wallet address, a Source Tag, a Destination Tag, or a memo). Report what's present.
  if (r.SourceTag != null) console.log(`  · SourceTag present (${r.SourceTag})`);
  if (r.DestinationTag != null) console.log(`  · DestinationTag present (${r.DestinationTag})`);
  if (r.SourceTag == null && r.DestinationTag == null) {
    console.log("  · no Source/Destination tag — fine if the program attributes by wallet address or memo (verify the program's rules)");
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => { console.error("verify-settlement crashed:", e); process.exit(2); });
