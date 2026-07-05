# RLUSD Settlement Wallet — Funding Procedure & Deployment Checklist

**Status:** ✅ Live. Wallet funded, RLUSD trust line established, and the first real RLUSD
settlement sent and verified on mainnet (TX `D5F11B5EF7BD9C9BC8062FDA2F6B94BCA1F95DC3417C372548BB5F6082B4D12A`).
**Phase:** Live — Make Waves mainnet requirement satisfied. (This document is retained as the
reference procedure; it now reflects the wallet actually in production.)

This document is the exact, ordered procedure for taking the production settlement wallet
from "generated" to "live on mainnet." Nothing in this document should be executed until
the live application, demo flow, and deployment have been personally verified — per the
explicit hold the team placed on this phase.

---

## 1. What already exists (done, this phase)

- **Wallet generated.** A real XRPL keypair was generated locally via
  `scripts/generate-settlement-wallet.js` (offline — no network call, no funding).
- **Address:** `rHLDysh6p6TcJM7QXU15YRLG4mERF5h5pv` (public — safe to share, safe to put in
  the README, safe to commit). This is the production settlement wallet's mainnet address.
- **Seed:** delivered directly to the founder via file transfer, **never** printed to chat,
  **never** written to any tracked file, **never** committed. The local copy used to generate
  the delivery file was shredded immediately after transfer. The seed exists only wherever the
  founder has since stored it (password manager / Vercel env vars) — there is no other copy.
- **Code path verified by unit test** (`test-rlusd.js`, 8/8 passing): currency-code encoding,
  trust-line transaction construction, settlement-payment transaction construction (including
  the hashed memo), and the "account not yet funded" status path all behave correctly.
- **Live on-ledger verification not yet possible in this environment** — this sandbox's network
  policy blocks outbound connections to XRPL nodes entirely (mainnet *and* testnet). The trust-line
  and settlement code is unit-tested but has not been exercised against a live ledger from here.
  See Step 5 below for a recommended dry run before the real funding event.

## 2. Environment variables required (set these in Vercel, not locally)

**In Vercel (Production) — public, non-secret only:**

| Variable | Value | Secret? |
|---|---|---|
| `XRPL_SETTLEMENT_WALLET_ADDRESS` | `rHLDysh6p6TcJM7QXU15YRLG4mERF5h5pv` | No — public address |
| `XRPL_NETWORK` | `mainnet` | No |

The public endpoint (`api/rlusd-settlement.js`) is **read-only** — it reads only
`XRPL_SETTLEMENT_WALLET_ADDRESS` and `XRPL_NETWORK`, never signs, and never touches the seed.
**Do NOT put `XRPL_SETTLEMENT_WALLET_SEED` in Vercel.**

**Locally (your shell), only when running an admin script — secret:**

| Variable | Used by | Secret? |
|---|---|---|
| `XRPL_SETTLEMENT_WALLET_SEED` | `scripts/setup-trust-line.js`, `scripts/send-settlement.js` | **Yes — secret** |

Provide the seed via `read -rs XRPL_SETTLEMENT_WALLET_SEED; export XRPL_SETTLEMENT_WALLET_SEED`
right before running a script, and `unset` it after. Never put it in any `.env` file, commit,
or the Vercel dashboard. Keeping the fund-moving key off the production server means no
web request can ever move funds from the settlement wallet.

## 3. Funding procedure (DO NOT EXECUTE YET — held pending live-app sign-off)

1. **Buy/transfer real XRP** from an exchange or existing wallet to
   `rHLDysh6p6TcJM7QXU15YRLG4mERF5h5pv`. Minimum: enough to cover the XRP reserve
   (currently ~1–10 XRP base reserve depending on current network reserve settings —
   check the live reserve requirement at send time, it has changed over XRPL's history)
   plus a small buffer for transaction fees. A modest amount (e.g. 20–30 XRP) covers
   reserve + fees + headroom comfortably without it being a meaningful sum of money.
2. **Confirm activation.** Call `getAccountStatus(address, 'mainnet')` (or
   `POST /api/rlusd-settlement {"action":"status"}` once env vars are set) — `exists` should
   flip from `false` to `true` once the transfer lands.
3. **Establish the RLUSD trust line** via the local admin script (the public endpoint cannot —
   it's read-only): `read -rs XRPL_SETTLEMENT_WALLET_SEED; export XRPL_SETTLEMENT_WALLET_SEED;
   node scripts/setup-trust-line.js`. This signs and submits a `TrustSet` from the settlement
   wallet to Ripple's mainnet RLUSD issuer (`rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De`). Confirm
   `trustLineEstablished: true`.
4. **Buy/transfer RLUSD** to the now-activated, now-trust-lined wallet address. A modest
   amount (e.g. $25–50 of RLUSD) is enough to execute and prove one real settlement without
   it being a meaningful sum of money.
5. **Confirm RLUSD balance.** Status call should now show `rlusdBalance > 0`.

At this point the wallet is fully live and ready to settle — but no settlement transaction
should be sent until the **Go-Live Checklist** (see `RLUSD_GO_LIVE_CHECKLIST.md`) explicitly
authorizes it.

## 4. Security notes

- The seed is the only credential that can move funds out of this wallet. It exists in exactly
  one place outside this procedure: wherever the founder stored the delivered file's contents.
  If that storage is ever compromised, regenerate a new wallet
  (`node scripts/generate-settlement-wallet.js`) and migrate any funds before continuing.
- The public endpoint `api/rlusd-settlement.js` is **read-only** (`status` only). It does not
  load the seed and cannot sign or submit transactions, so no authenticated web request can
  move funds. Fund-moving actions live only in the local admin scripts, which require the seed
  in the operator's shell. Do not re-add a `settle` or `setup-trust-line` action to the
  endpoint — that would reintroduce a path for any authenticated user to move funds.
- The seed never goes on the production server. It lives in the founder's password manager and
  is exported into a local shell only for the duration of an admin script run.

## 5. Recommended dry run before the real funding event

Because this development sandbox can't reach any XRPL node, the trust-line and settlement code
paths have only been verified by unit test, not against a live ledger. Before funding the real
wallet, it's worth 15 minutes to fund a **throwaway testnet wallet** (via `xrpl.Client.fundWallet()`
on `wss://s.altnet.rippletest.net:51233` — same pattern as `test-xrpl.js`) from any environment
with normal internet access, and run `submitTrustLine()` against it once. This proves the
trust-line mechanism works end-to-end with zero real money at risk, before doing the same thing
for real on mainnet. Not required, but cheap insurance.
