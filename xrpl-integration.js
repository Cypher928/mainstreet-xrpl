/**
 * CAM Logic — XRPL Integration
 * Hashes a reconciliation result and anchors it on the XRP Ledger testnet.
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
