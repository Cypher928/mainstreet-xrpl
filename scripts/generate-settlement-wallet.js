/**
 * One-time, local-only generator for MainStreet's production XRPL settlement wallet.
 *
 * Run this once, manually:   node scripts/generate-settlement-wallet.js
 *
 * It ONLY generates an offline keypair — it does NOT connect to the network and does
 * NOT fund the account. Funding the wallet with real XRP/RLUSD is the deliberately
 * deferred final deployment step, done after the tenant payment flow is complete.
 *
 * After running, store the seed ONLY as a Vercel environment variable
 * (XRPL_SETTLEMENT_WALLET_SEED) — never commit it, never log it anywhere else,
 * never put it in a tracked file. The address is not secret and can be committed
 * (e.g. as XRPL_SETTLEMENT_WALLET_ADDRESS) or just copied into the Vercel dashboard
 * alongside the seed.
 */

const { generateWallet } = require("../rlusd-integration");

const wallet = generateWallet();

console.log("==============================================================");
console.log("  MainStreet — Production Settlement Wallet Generated");
console.log("==============================================================\n");
console.log("Address:    ", wallet.address);
console.log("Seed:       ", wallet.seed, "  <-- SECRET, do not commit or share");
console.log("Public key: ", wallet.publicKey);
console.log("\nThis wallet is NOT funded and NOT active on the XRP Ledger yet.");
console.log("Next steps (do these LATER, only when ready to launch):");
console.log("  1. Set these in the Vercel dashboard (Project Settings → Environment Variables):");
console.log("       XRPL_SETTLEMENT_WALLET_SEED    =", wallet.seed);
console.log("       XRPL_SETTLEMENT_WALLET_ADDRESS =", wallet.address);
console.log("       XRPL_NETWORK                   = mainnet");
console.log("  2. Transfer enough XRP to the address above to cover the account reserve");
console.log("     plus a working balance (this activates the account on-ledger).");
console.log("  3. Call POST /api/rlusd-settlement with { action: 'setup-trust-line' } to");
console.log("     establish the RLUSD trust line.");
console.log("  4. Transfer RLUSD into the wallet to fund settlements.");
console.log("==============================================================");
