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

// ── Make Waves attribution ──────────────────────────────────────────────────
// The Challenge terms require the assigned Source Tag on every relevant
// transaction. Nothing asserted it, so a refactor could have dropped the one
// field the project's on-chain activity is counted by, and every test would
// still have passed.
check("the Make Waves source tag is on the settlement Payment", () => {
  const { tx } = buildSettlementPaymentTx({
    fromAddress: "rFrom", destination: "rTo", amountUsd: 1, network: "mainnet",
  });
  assert.strictEqual(typeof tx.SourceTag, "number", "SourceTag is missing or not numeric");
  assert.ok(tx.SourceTag > 0, "SourceTag must be a positive integer");
});

check("the Make Waves source tag is on the TrustSet too", () => {
  const tx = buildTrustSetTx("rSomeAddress", "mainnet", "1000000");
  assert.strictEqual(typeof tx.SourceTag, "number", "TrustSet carries no SourceTag");
  assert.ok(tx.SourceTag > 0);
});

check("the source tag defaults to the assigned tag rather than being optional", () => {
  // Read from source: the default must be the literal assigned tag, so an
  // unset XRPL_SOURCE_TAG cannot silently omit attribution.
  const src = require("fs").readFileSync(require("path").join(__dirname, "rlusd-integration.js"), "utf8");
  assert.ok(/XRPL_SOURCE_TAG\s*\|\|\s*\d{10}/.test(src),
    "the source tag no longer has a hard-coded default");
});

// ── What actually goes on the public ledger ─────────────────────────────────
// The memo is permanent and world-readable. These assert what it contains and,
// just as importantly, what it must never contain.
check("the memo decodes to JSON carrying the settlement hash", () => {
  const record = { destination: "rTo", amountUsd: 250.5, network: "mainnet", camYear: 2026 };
  const { tx, dataHash } = buildSettlementPaymentTx({
    fromAddress: "rFrom", destination: record.destination, amountUsd: record.amountUsd,
    network: record.network, metadata: { camYear: record.camYear },
  });
  const memo = tx.Memos[0].Memo;
  assert.strictEqual(memo.MemoFormat, Buffer.from("application/json").toString("hex").toUpperCase());
  const decoded = JSON.parse(Buffer.from(memo.MemoData, "hex").toString("utf8"));
  assert.strictEqual(decoded.dataHash, dataHash, "the memo's hash is not the returned dataHash");
  // And that hash must be reproducible from the record alone — which is the
  // whole basis of "anyone can verify this independently".
  assert.strictEqual(dataHash, hashSettlement(record),
    "the memo hash is not reproducible from the settlement record");
});

check("the DEFAULT memo payload is a hash and an amount, nothing else", () => {
  const { tx } = buildSettlementPaymentTx({
    fromAddress: "rFrom", destination: "rTo", amountUsd: 100, network: "mainnet",
  });
  const decoded = JSON.parse(Buffer.from(tx.Memos[0].Memo.MemoData, "hex").toString("utf8"));
  assert.deepStrictEqual(Object.keys(decoded).sort(), ["amountUsd", "dataHash"],
    "the default memo payload has grown new fields — everything here is public and permanent");
});

// KNOWN HAZARD, pinned rather than asserted away.
//
// `metadata` is spread into MemoData verbatim, so whatever a caller passes goes
// on a public ledger forever. Today the only caller is a local admin script that
// passes nothing, so nothing has leaked. This test states the behaviour plainly
// so that it is a decision rather than a discovery the first time a caller
// passes a tenant name — and it fails the moment the shape changes, in either
// direction.
check("caller metadata is spread into the public memo verbatim (known hazard)", () => {
  const { tx } = buildSettlementPaymentTx({
    fromAddress: "rFrom", destination: "rTo", amountUsd: 100, network: "mainnet",
    metadata: { tenantName: "SHONAC", propertyAddress: "123 Main St" },
  });
  const decoded = JSON.parse(Buffer.from(tx.Memos[0].Memo.MemoData, "hex").toString("utf8"));
  assert.strictEqual(decoded.tenantName, "SHONAC",
    "metadata no longer reaches the memo — if that was deliberate, update this test and the audit note");
  assert.strictEqual(decoded.propertyAddress, "123 Main St");
  // Any settle path exposed over HTTP must therefore whitelist metadata keys
  // before this becomes reachable by a request. See the Phase 3 plan.
});

// ── Both networks, because pilot and production differ ──────────────────────
// api/_pilot-target.js sends preview/pilot to testnet and production to
// mainnet, so a wrong testnet issuer would only ever fail on the pilot.
check("getNetworkConfig returns the testnet config the pilot uses", () => {
  const cfg = getNetworkConfig("testnet");
  assert.ok(/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(cfg.issuer), "testnet issuer is not a valid XRPL address");
  assert.ok(cfg.wss.startsWith("wss://"), "testnet endpoint is not a websocket URL");
  assert.ok(cfg.explorerBase.startsWith("https://testnet.xrpl.org/"),
    "testnet explorer does not point at the testnet explorer");
  assert.notStrictEqual(cfg.issuer, getNetworkConfig("mainnet").issuer,
    "testnet and mainnet share an issuer address");
});

check("mainnet explorer links point at livenet", () => {
  assert.ok(getNetworkConfig("mainnet").explorerBase.startsWith("https://livenet.xrpl.org/transactions/"));
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
