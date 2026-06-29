# Operational Runbook — Mainnet Go-Live

Turnkey steps for the four operational tasks, to run **the moment the wallet is funded and
the first settlement exists**. Everything here is staged and ready; nothing requires new
development. Do them in order.

> Context: the dev sandbox is network-blocked from XRPL/Vercel, so the on-ledger and
> live-site steps below must be run by you (or from any environment with normal internet).
> I can drive the text/code/verification steps with you in real time.

---

## 1. Configure the XRPL environment variables

Set these in **Vercel → Project Settings → Environment Variables → Production**:

| Variable | Value | Secret? |
|---|---|---|
| `XRPL_SETTLEMENT_WALLET_ADDRESS` | `rG2ZaUs5SodnNNE23ktTzNbRt55PQZNPrn` | no |
| `XRPL_SETTLEMENT_WALLET_SEED` | *(the seed sent to you privately)* | **YES** |
| `XRPL_NETWORK` | `mainnet` | no |

(Existing vars that must already be set: `ANTHROPIC_API_KEY`, `CLAUDE_MODEL`,
`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.)

**Verify after redeploy** — from the browser console while logged in, or curl with a valid
Supabase bearer token:
```
POST /api/rlusd-settlement  { "action": "status" }
→ expect: { configured: true, network: "mainnet", exists: <true once funded>, ... }
```
If it returns `configured: false`, the env vars didn't take — recheck names exactly.

---

## 2. Verify the first real settlement

After funding XRP → establishing the trust line → sending the first RLUSD settlement
(see `RLUSD_GO_LIVE_CHECKLIST.md` steps 1–6), confirm it on-ledger:

```
# from a networked environment, with the wallet address exported:
export XRPL_SETTLEMENT_WALLET_ADDRESS=rG2ZaUs5SodnNNE23ktTzNbRt55PQZNPrn
node scripts/verify-settlement.js <txHash>
```
This checks: type = Payment, result = tesSUCCESS, sender = settlement wallet, amount = RLUSD
with Ripple's official issuer, memo present, and whether the **SourceTag** is attached.
All green → the settlement is real and judge-verifiable.

---

## 3. Update the README + submission materials (immediately after the tx exists)

You'll have these values from step 2: `txHash`, `amountUsd`, `date`, `explorerLink`,
plus `demoVideoUrl` and `sourceTag`.

**a) Flip the in-app settlement flow to "settled"** — set the settlement record on the demo
property so every stepper turns green with a live "View Transaction" link. In
`ensureDemoProperty()` (script.js), add to the seeded `propertyData` object:
```js
settlement: {
  status: 'settled',
  amountUsd: <amountUsd>,
  txHash: '<txHash>',
  explorerLink: 'https://livenet.xrpl.org/transactions/<txHash>',
  network: 'mainnet',
  settledAt: '<ISO date>'
},
```
(Bump `_demoV` so existing seeded demos re-seed.) `_getSettlementState()` reads it and the
overview, tenant statement, and tenant portal all light up — no other code changes.

**b) README** — apply the four edits in `submission/README_UPDATE.md` (For-Judges links,
"on mainnet status" callout, replace the testnet anchor section with the mainnet one, roadmap
row).

**c) Submission docs** — find-and-replace the `<<TOKEN>>` placeholders across `submission/`
(`<<MAINNET_TX_HASH>>`, `<<EXPLORER_LINK>>`, `<<SETTLEMENT_AMOUNT>>`, `<<SETTLEMENT_DATE>>`,
`<<DEMO_VIDEO_URL>>`, `<<REGISTRATION_DATE>>`, `<<SOURCE_TAG>>`).

**d) Confirm** no `<<...>>` tokens or "to be added" / testnet-as-proof language remain:
```
grep -rnE "<<[A-Z_]+>>|to be added" README.md submission/   # expect no output
```

**e) Flip the tagline back to present tense.** The hero + login taglines were softened to
"AI-powered CAM reconciliation. **Settling** on the XRP Ledger." until the first real
settlement. Once it lands, change both back to "**Settled** on the XRP Ledger." in
`index.html` (2 occurrences), and restore the login pill to a present-tense form if desired.

I can do (a)–(d) with you in one pass once you paste the values.

---

## 4. Final smoke test (after settlement is live)

```
node test-xrpl-ui.js      # 25 checks — settlement flow (now settled), auth, statements
node test-regression.js   # engine/regression suite
```
Then a manual cold pass on the **live** URL (incognito):
- [ ] Sign up fresh → "Try Live Demo" loads Cascade Commons, no empty states
- [ ] Overview shows the **green** "Settled via RLUSD on XRPL — View Transaction"
- [ ] "View Transaction" opens the real explorer page for `<txHash>`
- [ ] Tenant statement shows the settlement section; Master Report year header matches body
- [ ] `/api/rlusd-settlement {action:status}` returns `trustLineEstablished: true`, RLUSD > 0
- [ ] Password reset round-trip still works (request → email → set → log in)
- [ ] No console errors on load

All green → ready to submit.
