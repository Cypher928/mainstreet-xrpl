/**
 * One-time, local-only generator for MainStreet's XRPL settlement wallet.
 *
 * Run this once, manually:   node scripts/generate-settlement-wallet.js
 *
 * It ONLY generates an offline keypair — it does NOT connect to the network and does
 * NOT fund the account. Funding the wallet with real XRP/RLUSD is a separate step.
 *
 * SECURITY: the seed is NEVER printed to the terminal (so it can't end up in scrollback
 * or a screenshot of this window). It is written to a private file OUTSIDE the repo. Open
 * that file, copy the seed into your password manager, verify with wallet-address.js, then
 * DELETE the file. Only the public address is printed here.
 */

const os = require("os");
const path = require("path");
const fs = require("fs");
const { generateWallet } = require("../rlusd-integration");

const wallet = generateWallet();

// Write the SECRET seed to a file OUTSIDE the repo (never printed, never committed), with
// owner-only permissions where the OS honors them. Keeping it off the terminal means a photo
// or screenshot of this window cannot leak the seed.
const secretPath = path.join(os.homedir(), "mainstreet-new-wallet-SECRET.txt");
fs.writeFileSync(
  secretPath,
  "MainStreet settlement wallet — GENERATED " + new Date().toISOString() + "\n" +
  "==============================================================\n" +
  "Address:    " + wallet.address + "\n" +
  "Seed:       " + wallet.seed + "\n" +
  "Public key: " + wallet.publicKey + "\n" +
  "==============================================================\n\n" +
  "ACTION REQUIRED (in order):\n" +
  "  1. Copy the Seed into your password manager now.\n" +
  "  2. Verify:  node scripts/wallet-address.js " + wallet.address + "\n" +
  "  3. DELETE this file.\n" +
  "Never photograph, screenshot, commit, or paste the seed anywhere.\n",
  { mode: 0o600 }
);

console.log("==============================================================");
console.log("  MainStreet — New Settlement Wallet Generated");
console.log("==============================================================\n");
console.log("Address:    ", wallet.address);
console.log("Public key: ", wallet.publicKey);
console.log("\nThe SEED was NOT printed here — so a photo/screenshot of this window");
console.log("cannot leak it. It was written to a private file OUTSIDE the repo:");
console.log("   " + secretPath);
console.log("\nDo this now, in order:");
console.log("  1. Open that file and copy the Seed into your password manager.");
console.log("  2. Verify:  node scripts/wallet-address.js " + wallet.address);
console.log("  3. DELETE the file when done:");
console.log("       Windows:      del \"" + secretPath + "\"");
console.log("       macOS/Linux:  rm \"" + secretPath + "\"");
console.log("\nTreat that file as radioactive: copy the seed to your password manager,");
console.log("then delete it. Do NOT photograph, screenshot, or share the seed — including");
console.log("in chat. (The terminal above is safe to share; it shows only the address.)");
console.log("==============================================================");
