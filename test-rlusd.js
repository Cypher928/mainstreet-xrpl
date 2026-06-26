// Tests for rlusd-integration.js.
// No real money moves here: the "live" checks below only ever read public ledger state
// for the well-known RLUSD issuer address (which definitely exists), never sign or submit
// anything. The production settlement wallet stays unfunded — these tests don't touch it.

const assert = require("assert");
const {
  RLUSD_CURRENCY_HEX,
  getNetworkConfig,
  hashSettlement,
  generateWallet,
  walletFromSeed,
  buildTrustSetTx,
  buildSettlementPaymentTx,
  getAccountStatus,
} = require("./rlusd-integration");

let pass = 0, fail = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
    pass++;
  } catch (err) {
    console.error(`✗ ${name}\n  ${err.message}`);
    fail++;
  }
}

check("RLUSD currency code is a zero-padded 40-hex-char string", () => {
  assert.strictEqual(RLUSD_CURRENCY_HEX.length, 40);
  assert.ok(RLUSD_CURRENCY_HEX.startsWith("524C555344")); // "RLUSD" in hex
});

check("getNetworkConfig returns mainnet config with the official RLUSD issuer", () => {
  const cfg = getNetworkConfig("mainnet");
  assert.strictEqual(cfg.issuer, "rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De");
  assert.ok(cfg.wss.startsWith("wss://"));
});

check("getNetworkConfig rejects unknown networks", () => {
  assert.throws(() => getNetworkConfig("devnet"));
});

check("hashSettlement is deterministic regardless of key order", () => {
  const a = hashSettlement({ tenant: "t1", amountUsd: 500 });
  const b = hashSettlement({ amountUsd: 500, tenant: "t1" });
  assert.strictEqual(a, b);
  assert.strictEqual(a.length, 64);
});

check("generateWallet produces an offline keypair with no network call", () => {
  const w = generateWallet();
  assert.ok(w.address.startsWith("r"));
  assert.ok(w.seed.length > 0);
  const recovered = walletFromSeed(w.seed);
  assert.strictEqual(recovered.address, w.address);
});

check("buildTrustSetTx targets the correct issuer and currency", () => {
  const tx = buildTrustSetTx("rSomeAddress", "mainnet", "1000000");
  assert.strictEqual(tx.TransactionType, "TrustSet");
  assert.strictEqual(tx.LimitAmount.currency, RLUSD_CURRENCY_HEX);
  assert.strictEqual(tx.LimitAmount.issuer, "rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De");
});

check("buildSettlementPaymentTx embeds a verifiable hashed memo", () => {
  const { tx, dataHash } = buildSettlementPaymentTx({
    fromAddress: "rFrom", destination: "rTo", amountUsd: 250.5,
    network: "mainnet", metadata: { tenantId: "t1", invoiceId: "inv1" },
  });
  assert.strictEqual(tx.Amount.currency, RLUSD_CURRENCY_HEX);
  assert.strictEqual(tx.Amount.value, "250.5");
  assert.strictEqual(dataHash.length, 64);
  assert.strictEqual(tx.Memos[0].Memo.MemoType, Buffer.from("MainStreet/RLUSDSettlement").toString("hex").toUpperCase());
});

check("buildSettlementPaymentTx rejects a non-positive amount", () => {
  assert.throws(() => buildSettlementPaymentTx({ fromAddress: "rFrom", destination: "rTo", amountUsd: 0 }));
});

async function liveChecks() {
  // Read-only: queries the real RLUSD issuer account, which is guaranteed to exist.
  // No signing, no submission, no funds at risk. Skipped (not failed) if this
  // environment's network policy blocks outbound XRPL connections.
  let status;
  try {
    status = await getAccountStatus("rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De", "mainnet");
  } catch (err) {
    console.log(`… skipping live XRPL checks — network unavailable here (${err.message})`);
    return;
  }

  check("getAccountStatus finds the live RLUSD issuer account on mainnet", () => {
    assert.strictEqual(status.exists, true);
    assert.ok(status.xrpBalance > 0);
  });

  // An address that has never existed on the ledger — exercises the "not yet funded" path
  // the production settlement wallet will hit until it's funded.
  const unfunded = await getAccountStatus("rN7n7otQDd6FczFgLdSqtcsAUxDkw6fzRH", "mainnet");
  check("getAccountStatus reports unfunded addresses without throwing", () => {
    assert.strictEqual(unfunded.exists, false);
    assert.strictEqual(unfunded.trustLineEstablished, false);
  });
}

liveChecks()
  .catch((err) => {
    console.error("✗ live checks crashed:", err.message);
    fail++;
  })
  .finally(() => {
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail > 0 ? 1 : 0);
  });
