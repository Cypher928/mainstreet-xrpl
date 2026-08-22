/**
 * CAM Logic — XRPL Integration  ·  ⚠️ UNWIRED PROTOTYPE — DO NOT EDIT FOR PRODUCTION
 *
 * Hashes a reconciliation result and anchors it on the XRP Ledger TESTNET.
 *
 * THIS FILE HAS ZERO CALLERS. Nothing in the app, the API or the tests requires
 * it. The production settlement path is `rlusd-integration.js`, which is what
 * `api/rlusd-settlement.js` and `scripts/send-settlement.js` use. The two files
 * have similar shapes and similar function names (`hashReconciliation` here,
 * `hashSettlement` there), which is exactly the trap this banner exists to
 * prevent: a change made here has no effect on anything a user touches.
 *
 * It is kept deliberately, not by accident. README.md §"Hash-anchoring
 * prototype" describes it as a reference implementation and attributes a real
 * testnet transaction to it, so deleting the file would orphan that account of
 * a genuine on-chain artifact. docs/PRODUCTION_READINESS_REVIEW.md proposes
 * removing it; that is a documentation decision as much as a code one and has
 * not been taken.
 *
 * If you are here to change settlement behaviour, you want rlusd-integration.js.
 */

const xrpl = require("xrpl");
const crypto = require("crypto");

const TESTNET_WSS = "wss://s.altnet.rippletest.net:51233";
const EXPLORER_BASE = "https://testnet.xrpl.org/transactions/";

/**
 * SHA-256 hash of a reconciliation result object.
 * @param {object} reconciliationResult
 * @returns {string} uppercase hex hash
 */
function hashReconciliation(reconciliationResult) {
  const json = JSON.stringify(reconciliationResult, Object.keys(reconciliationResult).sort());
  return crypto.createHash("sha256").update(json).digest("hex").toUpperCase();
}

/**
 * Anchors a reconciliation result on the XRPL testnet.
 *
 * @param {object} reconciliationResult  - The CAM allocation result to anchor
 * @returns {Promise<{ dataHash, txHash, explorerLink }>}
 */
async function anchorReconciliation(reconciliationResult) {
  const client = new xrpl.Client(TESTNET_WSS);

  try {
    await client.connect();
  } catch (err) {
    throw new Error(`XRPL testnet unavailable — could not connect: ${err.message}`);
  }

  try {
    // Fund a fresh wallet via the testnet faucet
    let wallet;
    try {
      const funded = await client.fundWallet();
      wallet = funded.wallet;
    } catch (err) {
      throw new Error(`Testnet faucet unavailable — could not fund wallet: ${err.message}`);
    }

    const dataHash = hashReconciliation(reconciliationResult);

    // Encode the hash as a hex memo (XRPL Memo fields must be hex)
    const memoData = Buffer.from(dataHash, "utf8").toString("hex").toUpperCase();
    const memoType = Buffer.from("CAMLogic/SHA256", "utf8").toString("hex").toUpperCase();
    const memoFormat = Buffer.from("text/plain", "utf8").toString("hex").toUpperCase();

    const tx = {
      TransactionType: "Payment",
      Account: wallet.address,
      Destination: wallet.address, // self-payment — cheapest anchor method
      Amount: "1",                 // 1 drop (minimum)
      Memos: [
        {
          Memo: {
            MemoType: memoType,
            MemoFormat: memoFormat,
            MemoData: memoData,
          },
        },
      ],
    };

    let submitted;
    try {
      submitted = await client.submitAndWait(tx, { wallet });
    } catch (err) {
      throw new Error(`Transaction submission failed: ${err.message}`);
    }

    const txHash = submitted.result.hash;

    return {
      dataHash,
      txHash,
      explorerLink: EXPLORER_BASE + txHash,
    };
  } finally {
    await client.disconnect();
  }
}

module.exports = { anchorReconciliation, hashReconciliation };
