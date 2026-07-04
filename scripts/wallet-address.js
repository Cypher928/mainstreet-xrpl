/**
 * Read-only diagnostic: prompt for a seed (hidden input) and print ONLY the XRPL
 * address it controls. No network, no signing — it just answers "which wallet does
 * this seed belong to?", so you can confirm you have the right seed for an address.
 *
 *   node scripts/wallet-address.js                       # prints the derived address
 *   node scripts/wallet-address.js <expected-address>    # also says MATCH / NO MATCH
 *
 * Paste the seed at the hidden prompt (you won't see it). The seed is never echoed,
 * never written to a file, and only lives in memory for this run.
 */

const readline = require("readline");
const { walletFromSeed } = require("../rlusd-integration");

// Prompt for a secret with the terminal echo turned off (same technique the
// trust-line script uses): the prompt text shows, typed/pasted input does not.
function promptSecret(query) {
  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });
    rl.stdoutMuted = false;
    rl._writeToOutput = function _writeToOutput(str) {
      if (rl.stdoutMuted) return;
      rl.output.write(str);
    };
    rl.on("error", reject);
    rl.question(query, (answer) => {
      rl.output.write("\n");
      rl.close();
      resolve((answer || "").trim());
    });
    rl.stdoutMuted = true;
  });
}

(async () => {
  const expected = (process.argv[2] || "").trim();

  let seed;
  if (process.stdin.isTTY) {
    seed = await promptSecret("Paste a seed to check (input hidden — you won't see it), then press Enter: ");
  } else {
    seed = (process.env.XRPL_SETTLEMENT_WALLET_SEED || "").trim();
  }
  if (!seed) {
    console.error("No seed provided.");
    process.exit(2);
  }

  let wallet;
  try {
    wallet = walletFromSeed(seed);
  } catch (e) {
    console.error("That is not a valid XRPL seed:", e.message);
    process.exit(2);
  }

  console.log("\nThis seed controls address:");
  console.log("  " + wallet.address);

  if (expected) {
    console.log("\nExpected address:");
    console.log("  " + expected);
    if (wallet.address === expected) {
      console.log("\n✓ MATCH — this seed controls that wallet.");
    } else {
      console.log("\n✗ NO MATCH — this seed controls a DIFFERENT wallet than expected.");
    }
  }

  process.exit(0);
})().catch((e) => { console.error("wallet-address crashed:", e); process.exit(2); });
