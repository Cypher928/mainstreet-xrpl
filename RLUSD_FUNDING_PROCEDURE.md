# RLUSD Settlement Wallet — Funding Procedure & Deployment Checklist

**Status:** Infrastructure prepared. Wallet generated. **Not funded. No mainnet transactions sent.**
**Phase:** Pre-launch — Make Waves mainnet requirement not yet satisfied.

This document is the exact, ordered procedure for taking the production settlement wallet
from "generated" to "live on mainnet." Nothing in this document should be executed until
the live application, demo flow, and deployment have been personally verified — per the
explicit hold the team placed on this phase.

---

## 1. What already exists (done, this phase)

- **Wallet generated.** A real XRPL keypair was generated locally via
  `scripts/generate-settlement-wallet.js` (offline — no network call, no funding).
- **Address:** `rG2ZaUs5SodnNNE23ktTzNbRt55PQZNPrn` (public — safe to share, safe to put in
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

| Variable | Value | Secret? |
|---|---|---|
| `XRPL_SETTLEMENT_WALLET_ADDRESS` | `rG2ZaUs5SodnNNE23ktTzNbRt55PQZNPrn` | No — public address |
| `XRPL_SETTLEMENT_WALLET_SEED` | *(from the file sent directly to you — not reproduced here)* | **Yes — secret** |
| `XRPL_NETWORK` | `mainnet` | No |

Set these under **Vercel → Project Settings → Environment Variables → Production**. Do not add
them to any `.env` file that could be accidentally committed — `.gitignore` already excludes
`.env`/`.env.*`, but Vercel's dashboard is the only place this seed should ever be typed after
the one-time generation.

`api/rlusd-settlement.js` reads exactly these three names — confirmed by reading the source
directly (`process.env.XRPL_SETTLEMENT_WALLET_ADDRESS`, `XRPL_SETTLEMENT_WALLET_SEED`,
`XRPL_NETWORK`). No other naming variant will work.

## 3. Funding procedure (DO NOT EXECUTE YET — held pending live-app sign-off)

1. **Buy/transfer real XRP** from an exchange or existing wallet to
   `rG2ZaUs5SodnNNE23ktTzNbRt55PQZNPrn`. Minimum: enough to cover the XRP reserve
   (currently ~1–10 XRP base reserve depending on current network reserve settings —
   check the live reserve requirement at send time, it has changed over XRPL's history)
   plus a small buffer for transaction fees. A modest amount (e.g. 20–30 XRP) covers
   reserve + fees + headroom comfortably without it being a meaningful sum of money.
2. **Confirm activation.** Call `getAccountStatus(address, 'mainnet')` (or
   `POST /api/rlusd-settlement {"action":"status"}` once env vars are set) — `exists` should
   flip from `false` to `true` once the transfer lands.
3. **Establish the RLUSD trust line.** Call
   `POST /api/rlusd-settlement {"action":"setup-trust-line"}`. This signs and submits a
   `TrustSet` transaction from the settlement wallet to Ripple's mainnet RLUSD issuer
   (`rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De`). Confirm `trustLineEstablished: true` on the next
   status call.
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
- Vercel environment variables are not visible in the repo, in logs, or to the browser — they
  are only readable by the serverless function at request time
  (`api/rlusd-settlement.js`'s `_loadSigningWallet()`).
- Never lower the rate limit or auth check in `api/rlusd-settlement.js` to "ship faster" — the
  `_verifyUser` + `_chkRate` gate is what stands between this endpoint and an attacker draining
  the wallet via the `settle` action.

## 5. Recommended dry run before the real funding event

Because this development sandbox can't reach any XRPL node, the trust-line and settlement code
paths have only been verified by unit test, not against a live ledger. Before funding the real
wallet, it's worth 15 minutes to fund a **throwaway testnet wallet** (via `xrpl.Client.fundWallet()`
on `wss://s.altnet.rippletest.net:51233` — same pattern as `test-xrpl.js`) from any environment
with normal internet access, and run `submitTrustLine()` against it once. This proves the
trust-line mechanism works end-to-end with zero real money at risk, before doing the same thing
for real on mainnet. Not required, but cheap insurance.
