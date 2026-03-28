/**
 * test-escrow.js
 *
 * Demonstrates the full CAM escrow lifecycle using three scenarios:
 *   1. Tenant OVERPAID  — escrow finished, overpayment refunded
 *   2. Tenant UNDERPAID — escrow cancelled, top-up payment sent
 *   3. Tenant EXACT     — escrow finished, no adjustment needed
 *
 * NOTE: Requires internet access to reach the XRPL testnet.
 * Wallets are funded via the testnet faucet — no real funds involved.
 */

const { createCAMEscrow, completeCAMEscrow } = require("./escrow-reconciliation");

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

// Reconciliation deadline: December 31 of this year
const reconciliationDeadline = new Date(new Date().getFullYear(), 11, 31, 23, 59, 59);

const memo = {
  property_id: "WESTFIELD-PLAZA-01",
  tenant_id:   "TENANT-SUNRISE-CAFE",
  period:      `${new Date().getFullYear()}-CAM`,
};

// Three test scenarios with different final reconciled amounts
const scenarios = [
  {
    label:                "OVERPAID  — tenant locked 500 XRP, owes 420 XRP",
    estimatedAnnualCAM:   500,
    finalReconciledAmount: 420,   // Tenant gets 80 XRP back
  },
  {
    label:                "UNDERPAID — tenant locked 500 XRP, owes 580 XRP",
    estimatedAnnualCAM:   500,
    finalReconciledAmount: 580,   // Tenant owes 80 XRP more
  },
  {
    label:                "EXACT     — tenant locked 500 XRP, owes 500 XRP",
    estimatedAnnualCAM:   500,
    finalReconciledAmount: 500,   // Perfect match
  },
];

// ---------------------------------------------------------------------------
// Run a single scenario end-to-end
// ---------------------------------------------------------------------------

async function runScenario(scenario, index) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`Scenario ${index + 1}: ${scenario.label}`);
  console.log("=".repeat(60));

  // Step 1 — Fund two fresh testnet wallets (tenant + landlord)
  // In production these would be real wallet addresses passed in by the user.
  console.log("\n[1/3] Funding testnet wallets via faucet...");
  const xrpl = require("xrpl");
  const client = new xrpl.Client("wss://s.altnet.rippletest.net:51233");
  await client.connect();

  let tenantWallet, landlordWallet;
  try {
    ({ wallet: tenantWallet }   = await client.fundWallet());
    ({ wallet: landlordWallet } = await client.fundWallet());
  } finally {
    await client.disconnect();
  }

  console.log(`   Tenant wallet:   ${tenantWallet.address}`);
  console.log(`   Landlord wallet: ${landlordWallet.address}`);

  // Step 2 — Create the escrow (tenant locks estimated CAM)
  console.log("\n[2/3] Creating escrow (tenant locks estimated CAM)...");
  console.log(`   Estimated CAM:          ${scenario.estimatedAnnualCAM} XRP`);
  console.log(`   Reconciliation deadline: ${reconciliationDeadline.toDateString()}`);

  const escrowResult = await createCAMEscrow({
    tenantWallet:          tenantWallet.address,
    tenantWalletSecret:    tenantWallet.seed,
    landlordWallet:        landlordWallet.address,
    estimatedAnnualCAM:    scenario.estimatedAnnualCAM,
    reconciliationDeadline,
    memo,
  });

  console.log(`   Escrow TX Hash:  ${escrowResult.escrowTxHash}`);
  console.log(`   Escrow Sequence: ${escrowResult.escrowSequence}`);
  console.log(`   Explorer:        ${escrowResult.explorerLink}`);

  // Step 3 — Complete the reconciliation
  console.log("\n[3/3] Completing reconciliation...");
  console.log(`   Final reconciled amount: ${scenario.finalReconciledAmount} XRP`);

  const reconcileResult = await completeCAMEscrow({
    tenantWallet:          tenantWallet.address,
    tenantWalletSecret:    tenantWallet.seed,
    landlordWallet:        landlordWallet.address,
    landlordWalletSecret:  landlordWallet.seed,
    escrowSequence:        escrowResult.escrowSequence,
    estimatedAnnualCAM:    scenario.estimatedAnnualCAM,
    finalReconciledAmount: scenario.finalReconciledAmount,
    memo,
  });

  console.log(`\n   ACTION:   ${reconcileResult.action}`);
  console.log(`   OUTCOME:  ${reconcileResult.summary.outcome}`);
  console.log(`   Escrow TX:     ${reconcileResult.explorerLinks.escrow}`);
  if (reconcileResult.explorerLinks.adjustment) {
    console.log(`   Adjustment TX: ${reconcileResult.explorerLinks.adjustment}`);
  }
}

// ---------------------------------------------------------------------------
// Main — run all three scenarios sequentially
// ---------------------------------------------------------------------------

async function main() {
  console.log("=".repeat(60));
  console.log("  CAM Logic — XRPL Escrow Reconciliation Test");
  console.log("=".repeat(60));
  console.log(`\nProperty:  ${memo.property_id}`);
  console.log(`Tenant:    ${memo.tenant_id}`);
  console.log(`Period:    ${memo.period}`);
  console.log(`Deadline:  ${reconciliationDeadline.toDateString()}`);

  for (let i = 0; i < scenarios.length; i++) {
    try {
      await runScenario(scenarios[i], i);
    } catch (err) {
      console.error(`\n✗ Scenario ${i + 1} failed: ${err.message}`);
      // Continue to next scenario rather than halting entirely
    }
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log("All scenarios complete.");
  console.log("=".repeat(60));
}

main().catch((err) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
