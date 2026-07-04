/**
 * One-time: establish the RLUSD trust line on a settlement / landlord wallet.
 *
 * Run from an environment WITH network access (your machine, not the dev sandbox).
 * The script prompts for the wallet seed directly and reads it with the terminal
 * echo turned OFF, so the seed is never typed as a CLI argument, never stored in
 * shell history, and never displayed on screen. Just run:
 *
 *   node scripts/setup-trust-line.js
 *
 * ...then paste the seed at the hidden prompt and press Enter (you won't see it).
 * No environment variable or shell wrapper is needed. (For non-interactive/CI use
 * only, it falls back to the XRPL_SETTLEMENT_WALLET_SEED env var when there is no TTY.)
 *
 * It is idempotent: if the trust line already exists, it reports that and exits without
 * sending another transaction. It never prints the seed — only the public address.
 */

const readline = require("readline");
const {
  walletFromSeed,
  getAccountStatus,
  submitTrustLine,
  getNetworkConfig,
} = require("../rlusd-integration");

const NETWORK = (process.env.XRPL_NETWORK || "mainnet").trim();

/**
 * Prompt for a secret on the terminal without echoing what is typed or pasted.
 * The prompt text itself is shown; every keystroke/paste after it is suppressed,
 * so the seed never appears on screen. Requires an interactive TTY.
 */
function promptSecret(query) {
  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });
    rl.stdoutMuted = false;
    rl._writeToOutput = function _writeToOutput(str) {
      if (rl.stdoutMuted) return;   // hide the seed as it is typed/pasted
      rl.output.write(str);         // but still show the prompt itself
    };
    rl.on("error", reject);
    rl.question(query, (answer) => {
      rl.output.write("\n");
      rl.close();
      resolve((answer || "").trim());
    });
    rl.stdoutMuted = true;          // mute immediately after the prompt is written
  });
}

/**
 * Resolve the wallet seed. When run interactively, always prompt with echo off
 * (no env var, no shell wrapper). Only falls back to XRPL_SETTLEMENT_WALLET_SEED
 * when there is no TTY (non-interactive / CI).
 */
async function getSeed() {
  if (process.stdin.isTTY) {
    const seed = await promptSecret(
      "Paste wallet seed (input hidden — you won't see it), then press Enter: "
    );
    if (!seed) throw new Error("No seed entered — aborting.");
    return seed;
  }
  const fromEnv = (process.env.XRPL_SETTLEMENT_WALLET_SEED || "").trim();
  if (fromEnv) return fromEnv;
  throw new Error(
    "No seed available. Run this in an interactive terminal so it can prompt you,\n" +
    "or set XRPL_SETTLEMENT_WALLET_SEED for non-interactive use."
  );
}

(async () => {
  let SEED;
  try {
    SEED = await getSeed();
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }

  let wallet;
  try {
    wallet = walletFromSeed(SEED);
  } catch (e) {
    console.error("Could not derive a wallet from the provided seed:", e.message);
    process.exit(2);
  }

  const cfg = getNetworkConfig(NETWORK);
  console.log(`\nNetwork:        ${NETWORK}`);
  console.log(`Wallet address: ${wallet.address}`);   // public only — never the seed
  console.log(`RLUSD issuer:   ${cfg.issuer}\n`);

  // Pre-flight: must be funded; skip if the trust line already exists.
  let status;
  try {
    status = await getAccountStatus(wallet.address, NETWORK);
  } catch (e) {
    console.error("Could not read account status:", e.message);
    console.error("Run this from an environment with outbound XRPL network access.");
    process.exit(1);
  }

  if (!status.exists) {
    console.error("Account is not activated on-ledger yet — fund it with XRP first.");
    process.exit(1);
  }
  console.log(`XRP balance:    ${status.xrpBalance}`);

  if (status.trustLineEstablished) {
    console.log("\n✓ RLUSD trust line already established — nothing to do.");
    console.log(`  Current RLUSD balance: ${status.rlusdBalance}`);
    process.exit(0);
  }

  console.log("\nSubmitting TrustSet (RLUSD)…");
  let result;
  try {
    result = await submitTrustLine(wallet, NETWORK);
  } catch (e) {
    console.error("TrustSet failed:", e.message);
    process.exit(1);
  }

  if (result.result !== "tesSUCCESS") {
    console.error(`\n✗ TrustSet did not succeed on-ledger: ${result.result}`);
    console.error(`  ${result.explorerLink}`);
    process.exit(1);
  }

  console.log("\n✓ RLUSD trust line established.");
  console.log(`  TX hash:  ${result.txHash}`);
  console.log(`  Explorer: ${result.explorerLink}`);

  // Confirm by re-reading status.
  try {
    const after = await getAccountStatus(wallet.address, NETWORK);
    console.log(`  trustLineEstablished: ${after.trustLineEstablished}  ·  RLUSD balance: ${after.rlusdBalance}`);
  } catch (_) { /* non-fatal */ }

  console.log("\nNext: acquire a small amount of RLUSD and send it to the wallet address above.");
  process.exit(0);
})().catch((e) => { console.error("setup-trust-line crashed:", e); process.exit(2); });
