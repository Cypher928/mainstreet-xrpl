# MainStreet — Demo Video Shot List

Matches `DEMO_SCRIPT.md` beat-for-beat. Record at 1920×1080, clean browser (no bookmarks bar,
no extensions visible), incognito so it mirrors a judge's first-time experience. Capture each
shot with a little head/tail room so cuts are easy.

| # | Time | Screen / action | What to capture | Watch out for |
|---|---|---|---|---|
| 1 | 0:00–0:18 | Live landing page → portfolio dashboard | Clean first impression; product name visible | Don't show a half-loaded page; wait for full render |
| 2 | 0:18–0:30 | Click **Try Live Demo** | The single click that loads everything | Make sure you're signed in first (demo needs auth) |
| 3 | 0:30–0:45 | Cascade Commons opens; KPI header | Populated KPIs (occupancy, tenants, CAM) — no empty states | If any tile reads `—` or `$0`, reseed before recording |
| 4 | 0:45–1:05 | **CAM tab** → reconciliation summary | Confidence badge + coverage badge + balanced badge | Hold long enough to read the badges |
| 5 | 1:05–1:20 | Scroll the per-tenant allocation table | Pro-rata %, allocated amounts, billing method | Smooth slow scroll, not a jump |
| 6 | 1:20–1:35 | Tenant portal → a resolved dispute | Dispute status chip; tenant-side view | Use a tenant account/role that has the seeded dispute |
| 7 | 1:35–1:45 | Back to landlord dispute view | Resolution record visible | — |
| 8 | 1:45–2:10 | **Settlement flow** (landlord summary or tenant portal) | The 4 steps: Pay Now → RLUSD Settlement → Settled on XRPL → View Transaction, in the green settled state | Must be the post-funding live state, not pending |
| 9 | 2:10–2:30 | Click **View Transaction** → real explorer page | **The money shot:** `<<EXPLORER_LINK>>` showing the `<<SETTLEMENT_AMOUNT>>` RLUSD payment on the public ledger. Hold ~3s. | Confirm the page fully loads the tx before cutting |
| 10 | 2:30–2:50 | Settlement flow green state → live URL | Closing brand shot | End on the live URL, readable |

## Capture order ≠ edit order
Record the explorer shot (#9) carefully and maybe twice — it's the proof and the hardest to
re-stage. You can record screens out of order and assemble them to the script timeline in edit.

## Pre-recording checklist
- [ ] First mainnet settlement complete and `property.settlement` set (settlement flow is green)
- [ ] Seeded demo data looks clean (no `$NaN`, no empty tiles, no `—` where a value should be)
- [ ] Incognito window, 1920×1080, clean chrome
- [ ] Signed in to the account that can load the demo + the tenant account for the portal shot
- [ ] `<<EXPLORER_LINK>>` opens and shows the real transaction
- [ ] Mic test — narration clear, no room echo
