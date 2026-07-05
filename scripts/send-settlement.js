/**
 * One-time / manual: send a real RLUSD settlement from the production wallet.
 *
 * Run locally from an environment WITH network access (not the dev sandbox). The seed is
 * entered at a hidden prompt (never a CLI arg, never logged, never committed). The
 * destination and amount are NOT secret, so they're passed as CLI args.
 *
 *   node scripts/send-settlement.js <destinationAddress> <amountUsd>            # DRY RUN (no send)
 *   node scripts/send-settlement.js <destinationAddress> <amountUsd> --yes      # actually send
 *
 * The script prompts for the wallet seed directly, with terminal echo turned off, so no
 * env var or shell wrapper is needed. (Non-interactive/CI: falls back to
 * XRPL_SETTLEMENT_WALLET_SEED when there is no TTY.)
 *
 * Safety: without --yes it performs a dry run — it shows the wallet/preflight and exactly
 * what it would send, but submits nothing. Funds only move when you pass --yes.
 *
 * This replaces the (now-disabled) public `settle` endpoint action, so no authenticated web
 * request can ever move funds from the settlement wallet.
 */

const readline = require("readline");
const {
  walletFromSeed,
  getAccountStatus,
  buildSettlementPaymentTx,
  settleRlusdPayment,
  getNetworkConfig,
} = require("../rlusd-integration");

const NETWORK = (process.env.XRPL_NETWORK || "mainnet").trim();
const args = process.argv.slice(2);
const CONFIRM = args.includes("--yes");
const positional = args.filter((a) => !a.startsWith("--"));
const DESTINATION = (positional[0] || "").trim();
const AMOUNT_USD = positional[1];

function fail(msg) { console.error(msg); process.exit(2); }

// Prompt for a secret with the terminal echo turned off: the prompt shows, typed/pasted
// input is suppressed, so the seed never appears on screen. Requires an interactive TTY.
function promptSecret(query) {
  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl.stdoutMuted = false;
    rl._writeToOutput = function _writeToOutput(str) { if (rl.stdoutMuted) return; rl.output.write(str); };
    rl.on("error", reject);
    rl.question(query, (answer) => { rl.output.write("\n"); rl.close(); resolve((answer || "").trim()); });
    rl.stdoutMuted = true;
  });
}

// Interactive: always prompt with echo off (no env var / wrapper). Non-interactive (no TTY):
// fall back to XRPL_SETTLEMENT_WALLET_SEED for CI use.
async function getSeed() {
  if (process.stdin.isTTY) {
    const seed = await promptSecret("Paste settlement wallet seed (input hidden — you won't see it), then press Enter: ");
    if (!seed) throw new Error("No seed entered — aborting.");
    return seed;
  }
  const fromEnv = (process.env.XRPL_SETTLEMENT_WALLET_SEED || "").trim();
  if (fromEnv) return fromEnv;
  throw new Error("No seed available. Run in an interactive terminal so it can prompt you, or set XRPL_SETTLEMENT_WALLET_SEED for non-interactive use.");
}

(async () => {
  let SEED;
  try { SEED = await getSeed(); }
  catch (e) { fail(e.message); }
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
