/**
 * CAM Logic — XRPL Escrow Reconciliation
 *
 * How this works in plain English:
 * ---------------------------------
 * At the start of the year, a tenant doesn't know their exact CAM charges yet.
 * They lock an *estimated* amount in escrow on the XRP Ledger. The funds sit
 * there — untouchable by either party — until the reconciliation deadline.
 *
 * At year-end, the actual CAM charges are calculated. Then:
 *   • If the tenant OVERPAID → escrow is finished, landlord keeps the correct
 *     amount and immediately sends the overpayment back to the tenant.
 *   • If the tenant UNDERPAID → escrow is cancelled, tenant pays the correct
 *     (higher) amount directly to the landlord.
 *   • If it's EXACT → escrow is simply finished and landlord keeps all of it.
 *
 * NOTE ON CURRENCY:
 * XRPL native escrow supports only XRP, not issued currencies like RLUSD.
 * In this implementation, estimatedAnnualCAM is treated as an XRP amount
 * (in whole units). For a production system using RLUSD, you would:
 *   1. Convert RLUSD → XRP at the current DEX rate, or
 *   2. Use a multisig Payment Channel arrangement for issued currencies.
 */

const xrpl = require("xrpl");

const TESTNET_WSS = "wss://s.altnet.rippletest.net:51233";
const EXPLORER_BASE = "https://testnet.xrpl.org/transactions/";
const DROPS_PER_XRP = 1_000_000; // 1 XRP = 1,000,000 drops

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert XRP to drops (XRPL's smallest unit). */
function toDrops(xrpAmount) {
  return String(Math.floor(xrpAmount * DROPS_PER_XRP));
}

/** Convert drops back to XRP for display. */
function toXRP(drops) {
  return (parseInt(drops, 10) / DROPS_PER_XRP).toFixed(6);
}

/** Hex-encode a plain-text string for XRPL Memo fields. */
function toHex(str) {
  return Buffer.from(str, "utf8").toString("hex").toUpperCase();
}

/** Convert a JS Date to XRPL epoch seconds (XRPL epoch starts 2000-01-01). */
function toXRPLTime(date) {
  const XRPL_EPOCH_OFFSET = 946684800; // Unix timestamp of 2000-01-01T00:00:00Z
  return Math.floor(date.getTime() / 1000) - XRPL_EPOCH_OFFSET;
}

/** Open a client connection with clear error messaging. */
async function connect() {
  const client = new xrpl.Client(TESTNET_WSS);
  try {
    await client.connect();
  } catch (err) {
    throw new Error(`XRPL testnet unavailable — could not connect: ${err.message}`);
  }
  return client;
}

// ---------------------------------------------------------------------------
// createCAMEscrow()
// ---------------------------------------------------------------------------

/**
 * Locks a tenant's estimated annual CAM payment in an XRPL escrow.
 *
 * Plain English:
 *   The tenant signs a transaction that moves their estimated CAM funds into
 *   a time-locked vault on the ledger. Neither party can touch the funds until
 *   the reconciliation deadline passes. A memo records the property, tenant,
 *   and billing period so the escrow is auditable on-chain.
 *
 * @param {object} params
 * @param {string} params.tenantWallet          - Tenant's XRPL address
 * @param {string} params.tenantWalletSecret    - Tenant's wallet secret (signs the tx)
 * @param {string} params.landlordWallet        - Landlord's XRPL address (escrow destination)
 * @param {number} params.estimatedAnnualCAM    - Estimated CAM in XRP (whole units)
 * @param {Date}   params.reconciliationDeadline - Date after which escrow can be finished
 * @param {object} params.memo                  - { property_id, tenant_id, period }
 *
 * @returns {Promise<{ escrowTxHash, escrowSequence, explorerLink, lockedAmountXRP }>}
 */
async function createCAMEscrow({
  tenantWallet,
  tenantWalletSecret,
  landlordWallet,
  estimatedAnnualCAM,
  reconciliationDeadline,
  memo,
}) {
  const client = await connect();

  try {
    // Reconstruct the wallet object from the secret so we can sign
    const wallet = xrpl.Wallet.fromSeed(tenantWalletSecret);

    // Encode the memo so it's stored on-chain and visible in any explorer
    const memoData = toHex(JSON.stringify({
      property_id: memo.property_id,
      tenant_id:   memo.tenant_id,
      period:      memo.period,
      type:        "CAM_ESCROW_CREATE",
    }));

    // Build the EscrowCreate transaction.
    // FinishAfter = the reconciliation deadline — no one can touch the
    // funds until this timestamp has passed on the ledger.
    const escrowCreateTx = {
      TransactionType: "EscrowCreate",
      Account:     wallet.address,          // Tenant locks the funds
      Destination: landlordWallet,           // Landlord receives them on finish
      Amount:      toDrops(estimatedAnnualCAM), // Amount locked (in drops)
      FinishAfter: toXRPLTime(reconciliationDeadline), // Unlock date
      Memos: [
        {
          Memo: {
            MemoType:   toHex("CAMLogic/EscrowCreate"),
            MemoFormat: toHex("application/json"),
            MemoData:   memoData,
          },
        },
      ],
    };

    // Submit and wait for ledger confirmation
    let response;
    try {
      response = await client.submitAndWait(escrowCreateTx, { wallet });
    } catch (err) {
      throw new Error(`EscrowCreate submission failed: ${err.message}`);
    }

    const txHash = response.result.hash;
    // The escrow sequence number is needed later to finish or cancel it
    const escrowSequence = response.result.Sequence ?? response.result.tx_json?.Sequence;

    return {
      escrowTxHash:    txHash,
      escrowSequence:  escrowSequence,
      explorerLink:    EXPLORER_BASE + txHash,
      lockedAmountXRP: estimatedAnnualCAM,
    };
  } finally {
    await client.disconnect();
  }
}

// ---------------------------------------------------------------------------
// completeCAMEscrow()
// ---------------------------------------------------------------------------

/**
 * Completes a CAM reconciliation by releasing the escrow and handling
 * any overpayment or underpayment.
 *
 * Plain English:
 *   Now that the year is over and real CAM charges are known, this function
 *   settles the escrow:
 *
 *   OVERPAID  → Finish the escrow (full locked amount goes to landlord), then
 *               landlord immediately sends the overpayment back to the tenant.
 *
 *   UNDERPAID → Cancel the escrow (full locked amount returns to tenant), then
 *               tenant sends the correct higher amount to the landlord.
 *
 *   EXACT     → Finish the escrow. Done — no additional payment needed.
 *
 * @param {object} params
 * @param {string} params.tenantWallet           - Tenant's XRPL address
 * @param {string} params.tenantWalletSecret     - Tenant's wallet secret
 * @param {string} params.landlordWallet         - Landlord's XRPL address
 * @param {string} params.landlordWalletSecret   - Landlord's wallet secret
 * @param {number} params.escrowSequence         - Sequence number from createCAMEscrow()
 * @param {number} params.estimatedAnnualCAM     - Original locked amount (XRP)
 * @param {number} params.finalReconciledAmount  - Actual CAM owed (XRP)
 * @param {object} params.memo                   - { property_id, tenant_id, period }
 *
 * @returns {Promise<{ action, escrowTxHash, adjustmentTxHash, explorerLinks, summary }>}
 */
async function completeCAMEscrow({
  tenantWallet,
  tenantWalletSecret,
  landlordWallet,
  landlordWalletSecret,
  escrowSequence,
  estimatedAnnualCAM,
  finalReconciledAmount,
  memo,
}) {
  const client = await connect();

  try {
    const tenantW   = xrpl.Wallet.fromSeed(tenantWalletSecret);
    const landlordW = xrpl.Wallet.fromSeed(landlordWalletSecret);

    const difference = estimatedAnnualCAM - finalReconciledAmount;
    // Positive = tenant overpaid. Negative = tenant underpaid. Zero = exact.
    const action =
      difference > 0 ? "OVERPAID" :
      difference < 0 ? "UNDERPAID" :
                       "EXACT";

    const baseMemoData = {
      property_id: memo.property_id,
      tenant_id:   memo.tenant_id,
      period:      memo.period,
    };

    let escrowTxHash     = null;
    let adjustmentTxHash = null;

    if (action === "EXACT" || action === "OVERPAID") {
      // --- Step 1: FINISH the escrow ---
      // This releases the full locked amount to the landlord.
      const escrowFinishTx = {
        TransactionType:  "EscrowFinish",
        Account:          landlordW.address,   // Landlord triggers the release
        Owner:            tenantW.address,     // Tenant originally created it
        OfferSequence:    escrowSequence,      // Identifies which escrow to finish
        Memos: [
          {
            Memo: {
              MemoType:   toHex("CAMLogic/EscrowFinish"),
              MemoFormat: toHex("application/json"),
              MemoData:   toHex(JSON.stringify({ ...baseMemoData, type: "CAM_ESCROW_FINISH" })),
            },
          },
        ],
      };

      let finishResp;
      try {
        finishResp = await client.submitAndWait(escrowFinishTx, { wallet: landlordW });
      } catch (err) {
        throw new Error(`EscrowFinish submission failed: ${err.message}`);
      }
      escrowTxHash = finishResp.result.hash;

      // --- Step 2 (OVERPAID only): Landlord returns the overpayment ---
      // The landlord got more than they're owed, so they send the difference back.
      if (action === "OVERPAID") {
        const refundTx = {
          TransactionType: "Payment",
          Account:     landlordW.address,
          Destination: tenantW.address,
          Amount:      toDrops(difference),   // Only the overpaid portion
          Memos: [
            {
              Memo: {
                MemoType:   toHex("CAMLogic/Refund"),
                MemoFormat: toHex("application/json"),
                MemoData:   toHex(JSON.stringify({
                  ...baseMemoData,
                  type:           "CAM_OVERPAYMENT_REFUND",
                  refundAmountXRP: difference,
                })),
              },
            },
          ],
        };

        let refundResp;
        try {
          refundResp = await client.submitAndWait(refundTx, { wallet: landlordW });
        } catch (err) {
          throw new Error(`Overpayment refund submission failed: ${err.message}`);
        }
        adjustmentTxHash = refundResp.result.hash;
      }

    } else {
      // --- UNDERPAID: CANCEL the escrow, then tenant pays full amount ---

      // Step 1: Cancel the escrow. Locked funds return to the tenant.
      // (CancelAfter must have passed, or the landlord must agree to cancel.)
      const escrowCancelTx = {
        TransactionType: "EscrowCancel",
        Account:         tenantW.address,    // Either party can cancel after CancelAfter
        Owner:           tenantW.address,
        OfferSequence:   escrowSequence,
        Memos: [
          {
            Memo: {
              MemoType:   toHex("CAMLogic/EscrowCancel"),
              MemoFormat: toHex("application/json"),
              MemoData:   toHex(JSON.stringify({ ...baseMemoData, type: "CAM_ESCROW_CANCEL" })),
            },
          },
        ],
      };

      let cancelResp;
      try {
        cancelResp = await client.submitAndWait(escrowCancelTx, { wallet: tenantW });
      } catch (err) {
        throw new Error(`EscrowCancel submission failed: ${err.message}`);
      }
      escrowTxHash = cancelResp.result.hash;

      // Step 2: Tenant pays the correct (higher) reconciled amount to the landlord.
      const topUpTx = {
        TransactionType: "Payment",
        Account:     tenantW.address,
        Destination: landlordW.address,
        Amount:      toDrops(finalReconciledAmount),
        Memos: [
          {
            Memo: {
              MemoType:   toHex("CAMLogic/TopUp"),
              MemoFormat: toHex("application/json"),
              MemoData:   toHex(JSON.stringify({
                ...baseMemoData,
                type:              "CAM_UNDERPAYMENT_TOPUP",
                topUpAmountXRP:    finalReconciledAmount,
              })),
            },
          },
        ],
      };

      let topUpResp;
      try {
        topUpResp = await client.submitAndWait(topUpTx, { wallet: tenantW });
      } catch (err) {
        throw new Error(`Underpayment top-up submission failed: ${err.message}`);
      }
      adjustmentTxHash = topUpResp.result.hash;
    }

    return {
      action,
      escrowTxHash,
      adjustmentTxHash,
      explorerLinks: {
        escrow:     escrowTxHash     ? EXPLORER_BASE + escrowTxHash     : null,
        adjustment: adjustmentTxHash ? EXPLORER_BASE + adjustmentTxHash : null,
      },
      summary: {
        estimatedXRP:     estimatedAnnualCAM,
        finalXRP:         finalReconciledAmount,
        differenceXRP:    Math.abs(difference),
        action,
        // Human-readable outcome
        outcome:
          action === "EXACT"      ? "Escrow finished. No adjustment needed." :
          action === "OVERPAID"   ? `Escrow finished. Landlord refunded ${Math.abs(difference).toFixed(6)} XRP to tenant.` :
                                    `Escrow cancelled. Tenant paid ${finalReconciledAmount.toFixed(6)} XRP to landlord.`,
      },
    };
  } finally {
    await client.disconnect();
  }
}

module.exports = { createCAMEscrow, completeCAMEscrow, toDrops, toXRP };
