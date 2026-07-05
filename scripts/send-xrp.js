/**
 * One-time / manual: send native XRP from a wallet (e.g., to activate a second wallet).
 *
 * Local admin only. Run from an environment WITH network access (not the dev sandbox).
 * The seed is entered at a hidden prompt — never a CLI arg, never logged, never committed.
 * The destination and amount are not secret, so they're CLI args.
 *
 *   node scripts/send-xrp.js <destinationAddress> <amountXrp>           # DRY RUN (no send)
 *   node scripts/send-xrp.js <destinationAddress> <amountXrp> --yes     # actually send
 *
 * The script prompts for the SENDING wallet's seed directly, with terminal echo turned off,
 * so no env var or shell wrapper is needed. (Non-interactive/CI: falls back to
 * XRPL_SETTLEMENT_WALLET_SEED when there is no TTY.)
 *
 * Safety: without --yes it performs a dry run — it shows the sender, destination, amount,
 * and balances, but submits nothing. XRP only moves when you pass --yes. It prints only the
 * public sending address, never the seed.
 */

const xrpl = require("xrpl");
const readline = require("readline");
const { walletFromSeed, getAccountStatus, getNetworkConfig } = require("../rlusd-integration");

const NETWORK = (process.env.XRPL_NETWORK || "mainnet").trim();
const args = process.argv.slice(2);
const CONFIRM = args.includes("--yes");
const positional = args.filter((a) => !a.startsWith("--"));
const DESTINATION = (positional[0] || "").trim();
const AMOUNT_XRP = positional[1];

// Leave at least this much XRP in the sender after the send (account reserve + fee headroom).
const MIN_LEFTOVER_XRP = 2;

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
    const seed = await promptSecret("Paste the SENDING wallet's seed (input hidden — you won't see it), then press Enter: ");
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
  if (!DESTINATION || !(Number(AMOUNT_XRP) > 0)) {
    fail("Usage: node scripts/send-xrp.js <destinationAddress> <amountXrp> [--yes]\n" +
      "Both a destination and a positive amountXrp are required.");
  }

  let wallet;
  try { wallet = walletFromSeed(SEED); }
  catch (e) { fail("Could not derive a wallet from the provided seed: " + e.message); }

  if (wallet.address === DESTINATION) fail("Source and destination are the same address — nothing to do.");

  const cfg = getNetworkConfig(NETWORK);
  console.log(`\nNetwork:       ${NETWORK}`);
  console.log(`From (wallet): ${wallet.address}`);   // public only — never the seed
  console.log(`To:            ${DESTINATION}`);
  console.log(`Amount:        ${AMOUNT_XRP} XRP\n`);

  // Preflight — the sender must be funded and keep enough after the send.
  let status;
  try { status = await getAccountStatus(wallet.address, NETWORK); }
  catch (e) { fail("Could not read source account status (run from a networked environment): " + e.message); }
  if (!status.exists) fail("Source wallet is not activated on-ledger — it has no XRP.");
  console.log(`Source XRP balance: ${status.xrpBalance}`);
  if (status.xrpBalance < Number(AMOUNT_XRP) + MIN_LEFTOVER_XRP) {
    fail(`Source balance (${status.xrpBalance} XRP) is too low to send ${AMOUNT_XRP} and keep a ~${MIN_LEFTOVER_XRP} XRP reserve/fee buffer.`);
  }

  // Destination status (informational).
  try {
    const dest = await getAccountStatus(DESTINATION, NETWORK);
    console.log(dest.exists
      ? `Destination already activated (balance ${dest.xrpBalance} XRP) — this will top it up.`
      : `Destination not yet activated — this payment will activate it.`);
  } catch (_) { /* non-fatal */ }

  if (!CONFIRM) {
    console.log("\nDRY RUN — nothing was sent. Re-run with --yes to execute:");
    console.log(`  node scripts/send-xrp.js ${DESTINATION} ${AMOUNT_XRP} --yes`);
    process.exit(0);
  }

  const client = new xrpl.Client(cfg.wss);
  try { await client.connect(); }
  catch (e) { fail(`Could not connect to ${NETWORK} (${e.message}). Run from a networked environment.`); }

  try {
    const prepared = await client.autofill({
      TransactionType: "Payment",
      Account: wallet.address,
      Destination: DESTINATION,
      Amount: xrpl.xrpToDrops(String(AMOUNT_XRP)),
    });
    const signed = wallet.sign(prepared);
    console.log("\nSubmitting XRP payment…");
    const res = await client.submitAndWait(signed.tx_blob);
    const result = res.result.meta?.TransactionResult;
    if (result !== "tesSUCCESS") {
      console.error(`\n✗ Payment failed on-ledger: ${result}\n  ${cfg.explorerBase}${res.result.hash}`);
      await client.disconnect();
      process.exit(1);
    }
    console.log("\n✓ XRP payment submitted on " + NETWORK + ".");
    console.log(`  TX hash:  ${res.result.hash}`);
    console.log(`  Explorer: ${cfg.explorerBase}${res.result.hash}`);
    try {
      const dest = await getAccountStatus(DESTINATION, NETWORK);
      console.log(`  Destination now: exists=${dest.exists} · XRP=${dest.xrpBalance}`);
    } catch (_) { /* non-fatal */ }
    console.log("\nNext: establish the RLUSD trust line on the destination wallet —");
    console.log("  read -rs XRPL_SETTLEMENT_WALLET_SEED   (paste the DESTINATION wallet's seed)");
    console.log("  export XRPL_SETTLEMENT_WALLET_SEED; node scripts/setup-trust-line.js");
  } finally {
    await client.disconnect();
  }
  process.exit(0);
})().catch((e) => { console.error("send-xrp crashed:", e); process.exit(2); });
