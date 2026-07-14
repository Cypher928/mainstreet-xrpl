# Go-Live Checklist — RLUSD Mainnet Settlement

**Do not start this checklist until the live application, demo flow, and deployment have been
personally verified.** Infrastructure (wallet generation, env-var wiring, trust-line code,
serverless endpoint) is already built and unit-tested — this checklist is the remaining,
deliberately-deferred sequence that takes it from "ready" to "real."

Each item should be checked off in order — several have hard dependencies on the one before it.

> **STATUS — ✅ LIVE (2026-07-05):** Steps 1, 3, 4, 6, and 7 are complete. The production
> settlement wallet (`rHLDysh6p6TcJM7QXU15YRLG4mERF5h5pv`) is funded and trust-lined, and the
> **first real RLUSD settlement is on mainnet and verified**:
> TX `7FA730B2B78819AE34B3D1B458721FBC52B9CD25E980ED42DD1B15E9F9FC724A`
> ([explorer](https://livenet.xrpl.org/transactions/7FA730B2B78819AE34B3D1B458721FBC52B9CD25E980ED42DD1B15E9F9FC724A)) —
> 1 RLUSD → `rw97rJThBJtoVRqR4DsoK5kW2taftzQvAX`, `tesSUCCESS`, with a SHA-256 memo. Remaining:
> **step 2** (point Vercel's `XRPL_SETTLEMENT_WALLET_ADDRESS` at the new wallet), **step 5**
> (confirm the Make Waves attribution mechanism), **step 8** (set the in-app `property.settlement`
> record), **step 9** (capture screenshots for the README/demo).

- [x] **1. Fund wallet with XRP**
  Transfer real XRP to `rHLDysh6p6TcJM7QXU15YRLG4mERF5h5pv` — enough to cover the current
  mainnet account reserve plus transaction fees (see `RLUSD_FUNDING_PROCEDURE.md` §3.1).
  *Verify:* `POST /api/rlusd-settlement {"action":"status"}` → `exists: true`.

- [ ] **2. Configure environment variables**
  Set `XRPL_SETTLEMENT_WALLET_ADDRESS` and `XRPL_NETWORK=mainnet` in Vercel → Production.
  **Do NOT put the seed in Vercel** — the public endpoint is read-only and never signs, so the
  seed is only needed locally (in your shell) when running the admin scripts. *Verify:* the
  status endpoint returns `configured: true` instead of the "wallet not generated" message.

- [x] **3. Establish RLUSD trust line** *(done via local script)*
  `read -rs XRPL_SETTLEMENT_WALLET_SEED; export XRPL_SETTLEMENT_WALLET_SEED; node scripts/setup-trust-line.js`
  *Depends on:* step 1 (needs XRP for the tx fee + reserve). *Verify:* the script prints
  `trustLineEstablished: true`, or the status endpoint shows it.

- [x] **4. Fund wallet with RLUSD**
  Transfer a modest amount of RLUSD (e.g. $25–50) to the now-trust-lined wallet.
  *Depends on:* step 3 (no trust line = transfer will fail/bounce).
  *Verify:* status endpoint shows `rlusdBalance > 0`.

- [ ] **5. Apply the program's attribution mechanism (whatever it actually is)**
  Confirm from the Make Waves **official rules / registration flow / XRPL Commons Discord** how
  a project's on-chain activity is attributed. **Not yet verified** — do not assume a Source
  Tag. Likely candidates and the work each implies:
  - **Registered wallet address** → no code change; just register `rHLDysh6p6TcJM7QXU15YRLG4mERF5h5pv`.
  - **Source Tag** → add `SourceTag: <tag>` to the tx builders in `rlusd-integration.js` (1 line).
  - **Destination Tag** → add `DestinationTag: <tag>` to the settlement Payment (1 line).
  - **Required memo string** → adjust the memo we already write (small change).
  *Verify:* once the mechanism is known, confirm the settlement transaction carries it (re-read
  the built tx, or check the explorer after sending).

- [x] **6. Execute the first real mainnet settlement** *(local admin script — the public
  endpoint cannot do this by design)*
  ```
  read -rs XRPL_SETTLEMENT_WALLET_SEED; export XRPL_SETTLEMENT_WALLET_SEED
  node scripts/send-settlement.js <recipient address> <small amount>          # dry run first
  node scripts/send-settlement.js <recipient address> <small amount> --yes    # then execute
  unset XRPL_SETTLEMENT_WALLET_SEED
  ```
  Use a small, deliberate amount — it's a proof, not a real tenant payment yet.
  *Depends on:* steps 1–5 (especially 5, if the attribution identifier must be present on the
  transaction itself).
  *Verify:* the script prints `txHash`, `explorerLink`, and `dataHash`; result is `tesSUCCESS`.

- [x] **7. Verify the transaction on XRPL Explorer**
  Open the `explorerLink` from step 6 in a browser
  (`https://livenet.xrpl.org/transactions/<txHash>`). Confirm: transaction type `Payment`,
  correct `Amount` (RLUSD, correct issuer), the memo decodes to the expected JSON, and (if the
  program requires an on-transaction identifier, per step 5) it is visible on the transaction.

- [ ] **8. Light up the in-app settlement flow with the real transaction**
  The settlement UI (Pay Now → RLUSD Settlement → Settled on XRPL → View Transaction) is
  already built and live in the app — it currently shows an honest "launching on mainnet"
  pending state and **never displays a fabricated hash**. To flip it to the real, verified
  state, set a `settlement` record on the demo property's data:
  ```js
  property.settlement = {
    status:       'settled',
    amountUsd:    <amount from step 6>,
    txHash:       '<txHash from step 6>',
    explorerLink: 'https://livenet.xrpl.org/transactions/<txHash>',
    network:      'mainnet',
    settledAt:    '<ISO timestamp>'
  };
  ```
  (Set this on the seeded *Cascade Commons* demo property — e.g. in `ensureDemoProperty()`'s
  `propertyData`, or persist it on the property row's `data` JSON.) `_getSettlementState()`
  reads it and the flow turns green with a working "View Transaction" link everywhere it
  appears — landlord reconciliation summary and tenant portal — with no other code changes.

- [ ] **9. Capture screenshots and transaction IDs for the README and demo video**
  - Screenshot of the explorer page from step 7.
  - The `txHash` itself, in plain text, for the README's "For Judges" section.
  - Screenshot of the in-app settlement flow (step 8) showing the green "Settled via RLUSD on
    XRPL — View Transaction" state, in both the landlord and tenant views.
  *This is the last infrastructure step before recording the demo video* — recording before
  this exists means re-recording later.

---

## After this checklist is complete

- Update the README's "Live XRPL Transaction" link from the testnet anchor hash to this real
  mainnet settlement hash.
- Update the "For Judges" section with the new transaction ID and explorer screenshot.
- Only then record the final demo video (per team decision: video is the last asset produced,
  after everything it would show is real).
