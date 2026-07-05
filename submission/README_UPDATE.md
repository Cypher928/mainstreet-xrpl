# README updates to apply once the first mainnet settlement is live

> ✅ **APPLIED (2026-07-05):** The mainnet-settlement edits below are now live in `README.md`
> (settlement TX + explorer link, the "on mainnet status" callout, a "Live Mainnet Settlement"
> section, and the roadmap row). The **demo-video** row still awaits the published video URL.
> This file is retained as the record of what was applied.

These are the exact edits to make to the root `README.md` after the first real mainnet
settlement and the demo video are published. Fill placeholder tokens first. Until then, the
README's honest pre-launch wording stays as-is.

---

## Edit 1 — "For Judges" links table

In the table under **👋 For Judges — Start Here**, replace these two rows:

```
| **Demo video** | _to be added — see go-live checklist_ |
| **Live mainnet settlement transaction** | _to be added once the production wallet is funded — see [`RLUSD_GO_LIVE_CHECKLIST.md`](./RLUSD_GO_LIVE_CHECKLIST.md)_ |
```

with:

```
| **Demo video** | [Watch the 2-minute demo](<<DEMO_VIDEO_URL>>) |
| **Live mainnet settlement transaction** | [`D5F11B5EF7BD9C9BC8062FDA2F6B94BCA1F95DC3417C372548BB5F6082B4D12A`](https://livenet.xrpl.org/transactions/D5F11B5EF7BD9C9BC8062FDA2F6B94BCA1F95DC3417C372548BB5F6082B4D12A) — RLUSD on XRPL mainnet |
```

---

## Edit 2 — the "On mainnet status" callout

Replace the blockquote that begins **"On mainnet status:"** (which says the wallet is generated
but deliberately not yet funded) with:

```
> **Live on mainnet:** MainStreet settles in RLUSD on the XRP Ledger. The first settlement
> ( `$1.00 (1 RLUSD)`, `2026-07-05` ) is live and verifiable:
> [`D5F11B5EF7BD9C9BC8062FDA2F6B94BCA1F95DC3417C372548BB5F6082B4D12A`](https://livenet.xrpl.org/transactions/D5F11B5EF7BD9C9BC8062FDA2F6B94BCA1F95DC3417C372548BB5F6082B4D12A). The in-app "Settled via RLUSD on XRPL — View
> Transaction" surface links every settlement to the public ledger.
```

---

## Edit 3 — replace the testnet anchor section

Replace the entire **## On-Chain Anchor (Development / Testnet)** section (heading + the code
block with the testnet hash) with:

```
## On-Chain Settlement (Mainnet)

MainStreet's first RLUSD settlement on XRPL mainnet — public and verifiable:

​```
TX Hash:  D5F11B5EF7BD9C9BC8062FDA2F6B94BCA1F95DC3417C372548BB5F6082B4D12A
Network:  XRPL Mainnet
Amount:   $1.00 (1 RLUSD) (RLUSD)
Explorer: https://livenet.xrpl.org/transactions/D5F11B5EF7BD9C9BC8062FDA2F6B94BCA1F95DC3417C372548BB5F6082B4D12A
​```
```

(Remove the leading zero-width characters around the inner code fence — they're only here to
keep this example from breaking the surrounding code block.)

---

## Edit 4 — roadmap row

In the **## Roadmap** table, change:

```
| **RLUSD Settlement on XRPL** | Built; mainnet launch pending wallet funding |
```

to:

```
| **RLUSD Settlement on XRPL** | Live on mainnet |
```

---

## After applying
- Re-read the rendered README top-to-bottom once — confirm no remaining `<<...>>` tokens and no
  lingering "pending funding" / testnet language.
- Confirm `https://livenet.xrpl.org/transactions/D5F11B5EF7BD9C9BC8062FDA2F6B94BCA1F95DC3417C372548BB5F6082B4D12A` actually resolves to the transaction before committing.
