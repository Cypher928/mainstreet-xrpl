const xrpl = require("xrpl");

const TESTNET = "wss://s.altnet.rippletest.net:51233";
const EXPLORER = "https://testnet.xrpl.org/transactions";

async function main() {
  console.log("==============================================");
  console.log("   CAM Logic — XRPL Live Wallet Test        ");
  console.log("==============================================\n");

  const client = new xrpl.Client(TESTNET);

  console.log("Connecting to XRPL testnet…");
  await client.connect();
  console.log("Connected.\n");

  // ── Fund two brand-new wallets via the testnet faucet ──────────────────
  console.log("Funding Wallet A (sender)…");
  const { wallet: walletA, balance: balA } = await client.fundWallet();
  console.log(`  Address: ${walletA.address}  Balance: ${balA} XRP\n`);

  console.log("Funding Wallet B (receiver)…");
  const { wallet: walletB, balance: balB } = await client.fundWallet();
  console.log(`  Address: ${walletB.address}  Balance: ${balB} XRP\n`);

  // ── Build memo with current timestamp so it's always unique ───────────
  const memoData = `CAMLogic:test:${Date.now()}`;
  const memoHex  = Buffer.from(memoData, "utf8").toString("hex").toUpperCase();
  const memoType = Buffer.from("CAMLogic/Test", "utf8").toString("hex").toUpperCase();

  // ── Prepare and sign the payment ───────────────────────────────────────
  const prepared = await client.autofill({
    TransactionType: "Payment",
    Account:         walletA.address,
    Destination:     walletB.address,
    Amount:          xrpl.xrpToDrops("10"),
    Memos: [
      {
        Memo: {
          MemoType: memoType,
          MemoData: memoHex,
        },
      },
    ],
  });

  const signed = walletA.sign(prepared);

  console.log(`Sending 10 XRP from A → B with memo: "${memoData}"`);
  const result = await client.submitAndWait(signed.tx_blob);

  const txHash      = result.result.hash;
  const explorerUrl = `${EXPLORER}/${txHash}`;
  const outcome     = result.result.meta.TransactionResult;

  console.log("\n─────────────────────────────────────────────");
  if (outcome === "tesSUCCESS") {
    console.log("✓ Payment succeeded!\n");
  } else {
    console.log(`✗ Payment result: ${outcome}\n`);
  }
  console.log("Sender:        ", walletA.address);
  console.log("Receiver:      ", walletB.address);
  console.log("Amount:         10 XRP");
  console.log("Memo:          ", memoData);
  console.log("TX Hash:       ", txHash);
  console.log("Explorer Link: ", explorerUrl);
  console.log("─────────────────────────────────────────────\n");

  await client.disconnect();
}

main().catch(err => {
  console.error("\n✗ Test failed:", err.message);
  process.exit(1);
});
