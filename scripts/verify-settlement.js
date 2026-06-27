/**
 * Post-launch verification of the first real RLUSD mainnet settlement.
 *
 * Run from an environment WITH outbound network access (not the dev sandbox, which is
 * network-blocked from XRPL):
 *
 *   node scripts/verify-settlement.js <txHash>
 *   # or:  XRPL_SETTLEMENT_TX=<txHash> node scripts/verify-settlement.js
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
const WALLET = (process.env.XRPL_SETTLEMENT_WALLET_ADDRESS || "").trim();

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

  // 2) Look up the transaction
  const client = new xrpl.Client(cfg.wss);
  try {
    await client.connect();
  } catch (e) {
    console.error(`Could not connect to ${NETWORK} (${e.message}). Run this from a networked environment.`);
    process.exit(2);
  }

  let tx;
  try {
    tx = await client.request({ command: "tx", transaction: TXHASH });
  } catch (e) {
    console.error("Transaction not found / lookup failed:", e.message);
    await client.disconnect();
    process.exit(1);
  }
  const r = tx.result;
  const meta = r.meta || r.metaData || {};

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

  const hasMemo = Array.isArray(r.Memos) && r.Memos.length > 0;
  hasMemo ? ok("carries a memo (settlement metadata)") : console.log("  · no memo present (optional)");

  if (r.SourceTag != null) ok(`SourceTag present (${r.SourceTag})`);
  else console.log("  · no SourceTag — add the XRPL Commons tag before relying on leaderboard attribution");

  await client.disconnect();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => { console.error("verify-settlement crashed:", e); process.exit(2); });
