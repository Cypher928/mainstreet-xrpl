/**
 * MainStreet — RLUSD Settlement on XRPL
 *
 * Tenants pay rent/CAM normally (card/ACH via a processor like Stripe — that flow is
 * separate from this file). This module settles a matching amount in RLUSD (Ripple's
 * USD stablecoin) on the XRP Ledger as a transparent, verifiable proof-of-settlement
 * layer: "Settlement verified on XRPL — view transaction." It is NOT a hidden payment
 * rail — every settlement is a real, explorer-visible mainnet transaction.
 *
 * Deployment note: this module is fully wired for mainnet, but the production
 * settlement wallet is deliberately left UNFUNDED until the tenant payment flow is
 * complete and launch is imminent. Funding the wallet is the last deployment step,
 * not a development step — see scripts/generate-settlement-wallet.js.
 */

const xrpl = require("xrpl");
const crypto = require("crypto");

const NETWORKS = {
  mainnet: {
    wss: "wss://xrplcluster.com",
    issuer: "rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De", // Ripple's official RLUSD issuer
    explorerBase: "https://livenet.xrpl.org/transactions/",
  },
  testnet: {
    wss: "wss://s.altnet.rippletest.net:51233",
    issuer: "rQhWct2fv4Vc4KRjRgMrxa8xPN9Zx9iLKV", // Ripple's testnet RLUSD issuer
    explorerBase: "https://testnet.xrpl.org/transactions/",
  },
};

// RLUSD's currency code is the 5-character ASCII string "RLUSD", which doesn't fit in
// XRPL's 3-character shorthand format, so it's carried as a 160-bit hex code (zero-padded).
const RLUSD_CURRENCY_HEX = Buffer.from("RLUSD", "ascii").toString("hex").toUpperCase().padEnd(40, "0");

function getNetworkConfig(network = "mainnet") {
  const cfg = NETWORKS[network];
  if (!cfg) throw new Error(`Unknown XRPL network: "${network}" — expected "mainnet" or "testnet"`);
  return cfg;
}

/** SHA-256 hash of a settlement record, same pattern as hashReconciliation() in xrpl-integration.js. */
function hashSettlement(settlementRecord) {
  const json = JSON.stringify(settlementRecord, Object.keys(settlementRecord).sort());
  return crypto.createHash("sha256").update(json).digest("hex").toUpperCase();
}

function _hexEncode(str) {
  return Buffer.from(str, "utf8").toString("hex").toUpperCase();
}

/**
 * Generates a brand-new XRPL keypair for the production settlement wallet.
 * Pure/offline — does not touch the network and does NOT fund the account.
 * Intended to be called once, locally, via scripts/generate-settlement-wallet.js.
 */
function generateWallet() {
  const wallet = xrpl.Wallet.generate();
  return { address: wallet.address, seed: wallet.seed, publicKey: wallet.publicKey };
}

function walletFromSeed(seed) {
  return xrpl.Wallet.fromSeed(seed);
}

async function _withClient(network, fn) {
  const { wss } = getNetworkConfig(network);
  const client = new xrpl.Client(wss);
  try {
    await client.connect();
  } catch (err) {
    throw new Error(`XRPL ${network} unavailable — could not connect: ${err.message}`);
  }
  try {
    return await fn(client);
  } finally {
    await client.disconnect();
  }
}

/**
 * Reads on-ledger status for a settlement wallet address: whether the account exists
 * (has been activated by receiving the minimum XRP reserve), its XRP balance, whether
 * an RLUSD trust line has been established, and its current RLUSD balance.
 *
 * Safe to call for an unfunded address — returns { exists: false, ... } rather than
 * throwing, so the UI can render "awaiting funding" instead of an error.
 */
async function getAccountStatus(address, network = "mainnet") {
  const { issuer } = getNetworkConfig(network);
  return _withClient(network, async (client) => {
    let accountInfo;
    try {
      accountInfo = await client.request({ command: "account_info", account: address, ledger_index: "validated" });
    } catch (err) {
      if (err?.data?.error === "actNotFound") {
        return {
          network, address, exists: false, xrpBalance: 0,
          trustLineEstablished: false, rlusdBalance: 0,
          rlusdLimit: 0, message: "Account not yet activated on the XRP Ledger — needs an initial XRP funding transfer.",
        };
      }
      throw new Error(`account_info lookup failed: ${err.message || err}`);
    }

    let trustLineEstablished = false;
    let rlusdBalance = 0;
    let rlusdLimit = 0;
    try {
      const lines = await client.request({ command: "account_lines", account: address, peer: issuer });
      const rlusdLine = (lines.result.lines || []).find(
        (l) => l.currency === RLUSD_CURRENCY_HEX || l.currency === "RLUSD"
      );
      if (rlusdLine) {
        trustLineEstablished = true;
        rlusdBalance = Number(rlusdLine.balance);
        rlusdLimit = Number(rlusdLine.limit);
      }
    } catch (err) {
      // account_lines failing for a real account just means "no lines yet" in practice — don't block status.
    }

    return {
      network, address, exists: true,
      xrpBalance: Number(xrpl.dropsToXrp(accountInfo.result.account_data.Balance)),
      trustLineEstablished, rlusdBalance, rlusdLimit, message: null,
    };
  });
}

/**
 * Builds (but does not submit) the TrustSet transaction the settlement wallet needs to
 * sign once it's funded, so it can hold/receive RLUSD. Exposed separately from
 * submitTrustLine() so the unsigned tx can be inspected/logged before signing.
 */
function buildTrustSetTx(address, network = "mainnet", limit = "1000000") {
  const { issuer } = getNetworkConfig(network);
  return {
    TransactionType: "TrustSet",
    Account: address,
    LimitAmount: { currency: RLUSD_CURRENCY_HEX, issuer, value: String(limit) },
  };
}

/** Signs and submits the RLUSD trust line for the settlement wallet. Requires the wallet to already be funded with XRP. */
async function submitTrustLine(wallet, network = "mainnet", limit = "1000000") {
  return _withClient(network, async (client) => {
    const tx = buildTrustSetTx(wallet.address, network, limit);
    let prepared;
    try {
      prepared = await client.autofill(tx);
    } catch (err) {
      throw new Error(`TrustSet autofill failed — is the wallet funded with XRP yet? (${err.message})`);
    }
    const signed = wallet.sign(prepared);
    const submitted = await client.submitAndWait(signed.tx_blob);
    return {
      txHash: submitted.result.hash,
      explorerLink: getNetworkConfig(network).explorerBase + submitted.result.hash,
      result: submitted.result.meta?.TransactionResult,
    };
  });
}

/**
 * Builds an RLUSD Payment transaction settling `amountUsd` from the settlement wallet to
 * `destination`, with a memo carrying the settlement metadata hash. Returns the unsigned
 * tx — callers needing to submit should use settleRlusdPayment().
 */
function buildSettlementPaymentTx({ fromAddress, destination, amountUsd, network = "mainnet", metadata = {} }) {
  const { issuer } = getNetworkConfig(network);
  if (!(Number(amountUsd) > 0)) throw new Error("amountUsd must be a positive number");

  const settlementRecord = { destination, amountUsd, network, ...metadata };
  const dataHash = hashSettlement(settlementRecord);

  return {
    tx: {
      TransactionType: "Payment",
      Account: fromAddress,
      Destination: destination,
      Amount: { currency: RLUSD_CURRENCY_HEX, issuer, value: String(amountUsd) },
      Memos: [
        {
          Memo: {
            MemoType: _hexEncode("MainStreet/RLUSDSettlement"),
            MemoFormat: _hexEncode("application/json"),
            MemoData: _hexEncode(JSON.stringify({ dataHash, amountUsd, ...metadata })),
          },
        },
      ],
    },
    dataHash,
  };
}

/**
 * Signs and submits an RLUSD settlement payment from the production wallet to `destination`
 * (e.g. the landlord's payout wallet). Throws a clear, actionable error — rather than an
 * opaque XRPL error — if the wallet hasn't been funded or trust-lined yet, since that is the
 * expected state until the deferred "fund the wallet" deployment step happens.
 */
async function settleRlusdPayment({ wallet, destination, amountUsd, network = "mainnet", metadata = {} }) {
  const status = await getAccountStatus(wallet.address, network);
  if (!status.exists) {
    throw new Error(
      "Settlement wallet is not yet funded on the XRP Ledger. RLUSD settlement is unavailable until the " +
      "production wallet is funded with XRP (deliberately deferred until launch)."
    );
  }
  if (!status.trustLineEstablished) {
    throw new Error(
      "Settlement wallet has no RLUSD trust line yet. Call submitTrustLine() once the wallet is funded."
    );
  }
  if (status.rlusdBalance < Number(amountUsd)) {
    throw new Error(
      `Settlement wallet RLUSD balance (${status.rlusdBalance}) is insufficient for this settlement (${amountUsd}).`
    );
  }

  const { tx, dataHash } = buildSettlementPaymentTx({
    fromAddress: wallet.address, destination, amountUsd, network, metadata,
  });

  return _withClient(network, async (client) => {
    let prepared;
    try {
      prepared = await client.autofill(tx);
    } catch (err) {
      throw new Error(`Settlement payment autofill failed: ${err.message}`);
    }
    const signed = wallet.sign(prepared);
    const submitted = await client.submitAndWait(signed.tx_blob);
    const result = submitted.result.meta?.TransactionResult;
    if (result !== "tesSUCCESS") {
      throw new Error(`Settlement payment failed on-ledger: ${result}`);
    }
    return {
      dataHash,
      txHash: submitted.result.hash,
      explorerLink: getNetworkConfig(network).explorerBase + submitted.result.hash,
      amountUsd,
      network,
    };
  });
}

module.exports = {
  NETWORKS,
  RLUSD_CURRENCY_HEX,
  getNetworkConfig,
  hashSettlement,
  generateWallet,
  walletFromSeed,
  getAccountStatus,
  buildTrustSetTx,
  submitTrustLine,
  buildSettlementPaymentTx,
  settleRlusdPayment,
};
