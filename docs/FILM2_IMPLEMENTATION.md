# Film 2 — Implementation Report (Package #2)

Capture tooling for the product film. Three approved adaptations applied; every
plate comes from the shipping product.

## Plates captured — `assets/landing/film2/`

| Scene | Plate | Surface |
|---|---|---|
| S1 + S5 | `s1-s5-allocation.png` | Allocation table, Whole Health cap row |
| S3 | `s3-upload.png` | Upload zone |
| S4 | `s4-honest-gap.png` | Command Center priority card — the missing cap |
| S6 | `s6-timeline.png` | Property Timeline — **20 real events** |
| S7 | `s7-evidence-index.png` | Dispute Packet Evidence Index |
| S8 | `s8-settlement.png` | Settlement, verified on the XRP Ledger |
| S9 | `s9-command-center.png` | Command Center |

S2 (Evidence Viewer) remains pending the Package #1 ingestion run, unchanged and
frozen. S10 is motion graphics.

`tools/capture-film2-plates.js` produces all of them and records what the
product reported in `film2-plates.json`. `test-film2-plates.js` — 11 checks —
asserts each plate exists and that **no audit fingerprint was invented**.

## The audit fingerprint: we tried the real workflow, and it declined

Per the approved direction, the tool attempts to resolve a dispute through
`resolveDispute()` — the same function the Accept button calls — so a genuine
SHA-256 would be minted by the product (`script.js:12077`, Web Crypto).

**It could not be, and that is the finding.** `resolveDispute()` guards on:

```js
if (!d || d.status !== 'open') return;          // script.js:12043
```

Neither seeded dispute is `open`: one is `accepted`, the other
`docs_requested`. So no fingerprint exists, and the Evidence Index plate
truthfully reads:

> Audit fingerprint · **Not attached** · *Generated when the dispute is resolved*

Nothing was fabricated. The plate ships as the product rendered it.

## Product observation — worth fixing for users, not for the film

That guard means **`docs_requested` is a terminal state.** Once a reviewer
requests documentation, there is no path back through `resolveDispute()` — the
documentation arrives and the dispute can never be accepted or rejected. It can
also never acquire an audit fingerprint, because the hash is minted on
resolution.

This is a real gap in the dispute workflow, independent of any film: it strands
disputes in the one state that most needs a follow-up decision.

**Recommended, but deliberately not implemented here.** The smallest fix is to
allow resolution from `docs_requested` as well as `open`, so the state machine
reads `open → docs_requested → accepted | rejected`. That is a product change and
belongs in its own change with its own tests — not smuggled in as film work. It
would also, incidentally, let the demo mint a real fingerprint.

## Honest note on how S7 will look

Four of the six provenance rows read "Not attached" — the demo dispute has an
invoice and a calculation basis on file, and no lease clause, reviewer note,
resolution history or fingerprint.

That is truthful, and the product's candour about gaps is the point of the
scene. But the studio should know the frame is sparse. Two options, both honest:

1. **Shoot it as-is** and let the closing line carry it: *"Every conclusion in
   this packet traces to a record above. Items marked 'Not attached' are gaps to
   close before the packet is sent."*
2. **Fix the `docs_requested` gap first** (above) and work a dispute through the
   real flow, which naturally populates resolution history and the fingerprint —
   a fuller frame, earned rather than staged.

Option 2 is better film and better product. It is your call, and it is a product
decision, not a marketing one.
