# Go-Live Checklist — RLUSD Mainnet Settlement

**Do not start this checklist until the live application, demo flow, and deployment have been
personally verified.** Infrastructure (wallet generation, env-var wiring, trust-line code,
serverless endpoint) is already built and unit-tested — this checklist is the remaining,
deliberately-deferred sequence that takes it from "ready" to "real."

Each item should be checked off in order — several have hard dependencies on the one before it.

- [ ] **1. Fund wallet with XRP**
  Transfer real XRP to `rBGMooWB2a82fEkPSvH1tAZR3Xvcq8RmpC` — enough to cover the current
  mainnet account reserve plus transaction fees (see `RLUSD_FUNDING_PROCEDURE.md` §3.1).
  *Verify:* `POST /api/rlusd-settlement {"action":"status"}` → `exists: true`.

- [ ] **2. Configure environment variables**
  Set `XRPL_SETTLEMENT_WALLET_ADDRESS`, `XRPL_SETTLEMENT_WALLET_SEED`, `XRPL_NETWORK=mainnet`
  in Vercel → Production. *Must happen before step 4* — the trust-line action needs the seed
  to sign. *Verify:* the status endpoint returns `configured: true` instead of the
  "wallet not generated" message.

- [ ] **3. Establish RLUSD trust line**
  `POST /api/rlusd-settlement {"action":"setup-trust-line"}`.
  *Depends on:* steps 1–2 (needs XRP for the tx fee + reserve, needs the seed to sign).
  *Verify:* status endpoint returns `trustLineEstablished: true`.

- [ ] **4. Fund wallet with RLUSD**
  Transfer a modest amount of RLUSD (e.g. $25–50) to the now-trust-lined wallet.
  *Depends on:* step 3 (no trust line = transfer will fail/bounce).
  *Verify:* status endpoint shows `rlusdBalance > 0`.

- [ ] **5. Add the official XRPL Commons Source Tag**
  Once Make Waves registration assigns a Source Tag, add a 1-line change in
  `rlusd-integration.js` (the `Payment`/`TrustSet` tx objects) to include
  `SourceTag: <assigned tag>`. *External dependency — requires registering with XRPL Commons
  first; not something that can be done from code alone.*
  *Verify:* re-read the built transaction object before submitting and confirm the field is
  present.

- [ ] **6. Execute the first real mainnet settlement**
  `POST /api/rlusd-settlement {"action":"settle", "destination": "<recipient address>",
  "amountUsd": <small amount>, "metadata": {...}}`. Use a small, deliberate amount for this
  first transaction — it's a proof, not a real tenant payment yet.
  *Depends on:* steps 1–5 (especially 5, if the Source Tag needs to be present on the
  transaction that's submitted for attribution credit).
  *Verify:* response includes `txHash`, `explorerLink`, and `dataHash`; on-ledger result is
  `tesSUCCESS`.

- [ ] **7. Verify the transaction on XRPL Explorer**
  Open the `explorerLink` from step 6 in a browser
  (`https://livenet.xrpl.org/transactions/<txHash>`). Confirm: transaction type `Payment`,
  correct `Amount` (RLUSD, correct issuer), the memo decodes to the expected JSON, and (once
  step 5 is done) the Source Tag is visible on the transaction.

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
