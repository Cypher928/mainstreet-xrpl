const { anchorReconciliation, hashReconciliation } = require("./xrpl-integration");

// Sample CAM reconciliation result (same shape as runCAMAllocation output)
const sampleResult = {
  property: "Westfield Plaza",
  periodYear: 2024,
  totalExpenses: 32000,
  allocations: [
    {
      tenantId: "t1",
      tenantName: "Sunrise Cafe",
      proRataShare: "10%",
      allocatedAmount: 3200,
      capApplied: false,
      capAdjustment: null,
    },
    {
      tenantId: "t2",
      tenantName: "TechHub Office",
      proRataShare: "25%",
      allocatedAmount: 6000,
      capApplied: false,
      capAdjustment: null,
    },
    {
      tenantId: "t3",
      tenantName: "MegaMart Retail",
      proRataShare: "40%",
      allocatedAmount: 8800,
      capApplied: false,
      capAdjustment: null,
    },
  ],
};

async function main() {
  console.log("==============================================");
  console.log("   CAM Logic — XRPL Anchoring Test          ");
  console.log("==============================================\n");

  // Show the hash before hitting the network
  const previewHash = hashReconciliation(sampleResult);
  console.log("Reconciliation Data Hash (SHA-256):");
  console.log(" ", previewHash, "\n");

  console.log("Connecting to XRPL testnet...");

  try {
    const result = await anchorReconciliation(sampleResult);

    console.log("\n✓ Transaction anchored successfully!\n");
    console.log("Data Hash:     ", result.dataHash);
    console.log("TX Hash:       ", result.txHash);
    console.log("Explorer Link: ", result.explorerLink);
    console.log();
  } catch (err) {
    console.error("\n✗ Anchoring failed:", err.message);
    process.exit(1);
  }
}

main();
