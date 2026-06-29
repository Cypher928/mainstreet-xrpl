/**
 * One-time / manual: send a real RLUSD settlement from the production wallet.
 *
 * Run locally from an environment WITH network access (not the dev sandbox). The seed is
 * read ONLY from XRPL_SETTLEMENT_WALLET_SEED (never a CLI arg, never logged, never committed).
 * The destination and amount are NOT secret, so they're passed as CLI args.
 *
 *   read -rs XRPL_SETTLEMENT_WALLET_SEED   # paste seed (hidden), Enter
 *   export XRPL_SETTLEMENT_WALLET_SEED
 *   node scripts/send-settlement.js <destinationAddress> <amountUsd>            # DRY RUN (no send)
 *   node scripts/send-settlement.js <destinationAddress> <amountUsd> --yes      # actually send
 *   unset XRPL_SETTLEMENT_WALLET_SEED
 *
 * Safety: without --yes it performs a dry run — it shows the wallet/preflight and exactly
 * what it would send, but submits nothing. Funds only move when you pass --yes.
 *
 * This replaces the (now-disabled) public `settle` endpoint action, so no authenticated web
 * request can ever move funds from the settlement wallet.
 */

const {
  walletFromSeed,
  getAccountStatus,
  buildSettlementPaymentTx,
  settleRlusdPayment,
  getNetworkConfig,
} = require("../rlusd-integration");

const NETWORK = (process.env.XRPL_NETWORK || "mainnet").trim();
const SEED = (process.env.XRPL_SETTLEMENT_WALLET_SEED || "").trim();
const args = process.argv.slice(2);
const CONFIRM = args.includes("--yes");
const positional = args.filter((a) => !a.startsWith("--"));
const DESTINATION = (positional[0] || "").trim();
const AMOUNT_USD = positional[1];

function fail(msg) { console.error(msg); process.exit(2); }

(async () => {
  if (!SEED) {
    fail("XRPL_SETTLEMENT_WALLET_SEED is not set.\n" +
      "Provide it via the environment (not a CLI arg):\n" +
      "  read -rs XRPL_SETTLEMENT_WALLET_SEED; export XRPL_SETTLEMENT_WALLET_SEED; node scripts/send-settlement.js <dest> <amountUsd> [--yes]");
  }
  if (!DESTINATION || !(Number(AMOUNT_USD) > 0)) {
    fail("Usage: node scripts/send-settlement.js <destinationAddress> <amountUsd> [--yes]\n" +
      "Both a destination and a positive amountUsd are required.");
  }

  let wallet;
  try { wallet = walletFromSeed(SEED); }
  catch (e) { fail("Could not derive a wallet from the provided seed: " + e.message); }

  const cfg = getNetworkConfig(NETWORK);
  console.log(`\nNetwork:        ${NETWORK}`);
  console.log(`From (wallet):  ${wallet.address}`);   // public only — never the seed
  console.log(`To (destination): ${DESTINATION}`);
  console.log(`Amount:         ${AMOUNT_USD} RLUSD`);
  console.log(`RLUSD issuer:   ${cfg.issuer}\n`);

  // Preflight — confirm the wallet can actually settle this.
  let status;
  try { status = await getAccountStatus(wallet.address, NETWORK); }
  catch (e) { fail("Could not read account status (run from a networked environment): " + e.message); }

  if (!status.exists)               fail("Wallet is not activated on-ledger — fund it with XRP first.");
  if (!status.trustLineEstablished) fail("No RLUSD trust line — run scripts/setup-trust-line.js first.");
  console.log(`XRP balance:    ${status.xrpBalance}`);
  console.log(`RLUSD balance:  ${status.rlusdBalance}`);
  if (status.rlusdBalance < Number(AMOUNT_USD)) {
    fail(`Insufficient RLUSD balance (${status.rlusdBalance}) for this settlement (${AMOUNT_USD}).`);
  }

  // Show the fingerprint that will go in the transaction memo.
  const { dataHash } = buildSettlementPaymentTx({
    fromAddress: wallet.address, destination: DESTINATION, amountUsd: AMOUNT_USD, network: NETWORK,
  });
  console.log(`Memo dataHash:  ${dataHash}`);

  if (!CONFIRM) {
    console.log("\nDRY RUN — nothing was sent. Re-run with --yes to execute the settlement:");
    console.log(`  node scripts/send-settlement.js ${DESTINATION} ${AMOUNT_USD} --yes`);
    process.exit(0);
  }

  console.log("\nSubmitting RLUSD settlement…");
  let result;
  try {
    result = await settleRlusdPayment({ wallet, destination: DESTINATION, amountUsd: AMOUNT_USD, network: NETWORK });
  } catch (e) { fail("Settlement failed: " + e.message); }

  console.log("\n✓ Settlement submitted on " + NETWORK + ".");
  console.log(`  TX hash:   ${result.txHash}`);
  console.log(`  Explorer:  ${result.explorerLink}`);
  console.log(`  dataHash:  ${result.dataHash}`);
  console.log("\nNext: verify with  node scripts/verify-settlement.js " + result.txHash);
  process.exit(0);
})().catch((e) => { console.error("send-settlement crashed:", e); process.exit(2); });
