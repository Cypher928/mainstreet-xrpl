/**
 * One-time / manual: send native XRP from a wallet (e.g., to activate a second wallet).
 *
 * Local admin only. Run from an environment WITH network access (not the dev sandbox).
 * The seed is read ONLY from XRPL_SETTLEMENT_WALLET_SEED — never a CLI arg, never logged,
 * never committed. The destination and amount are not secret, so they're CLI args.
 *
 *   read -rs XRPL_SETTLEMENT_WALLET_SEED   # paste the SENDING wallet's seed (hidden)
 *   export XRPL_SETTLEMENT_WALLET_SEED
 *   node scripts/send-xrp.js <destinationAddress> <amountXrp>           # DRY RUN (no send)
 *   node scripts/send-xrp.js <destinationAddress> <amountXrp> --yes     # actually send
 *   unset XRPL_SETTLEMENT_WALLET_SEED
 *
 * Safety: without --yes it performs a dry run — it shows the sender, destination, amount,
 * and balances, but submits nothing. XRP only moves when you pass --yes. It prints only the
 * public sending address, never the seed.
 */

const xrpl = require("xrpl");
const { walletFromSeed, getAccountStatus, getNetworkConfig } = require("../rlusd-integration");

const NETWORK = (process.env.XRPL_NETWORK || "mainnet").trim();
const SEED = (process.env.XRPL_SETTLEMENT_WALLET_SEED || "").trim();
const args = process.argv.slice(2);
const CONFIRM = args.includes("--yes");
const positional = args.filter((a) => !a.startsWith("--"));
const DESTINATION = (positional[0] || "").trim();
const AMOUNT_XRP = positional[1];

// Leave at least this much XRP in the sender after the send (account reserve + fee headroom).
const MIN_LEFTOVER_XRP = 2;

function fail(msg) { console.error(msg); process.exit(2); }

(async () => {
  if (!SEED) {
    fail("XRPL_SETTLEMENT_WALLET_SEED is not set.\n" +
      "Provide it via the environment (not a CLI arg):\n" +
      "  read -rs XRPL_SETTLEMENT_WALLET_SEED; export XRPL_SETTLEMENT_WALLET_SEED; node scripts/send-xrp.js <dest> <amountXrp> [--yes]");
  }
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
