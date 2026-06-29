# MainStreet — 3-Minute Demo Script (XRPL Judges)

**Format:** screen recording + voiceover. Target **2:50**, hard cap 3:00.
**Tone:** a founder who knows the industry. Plain language, concrete numbers, no hype.
Avoid "revolutionary / disrupt / web3 / trustless / decentralized." Say **"XRP Ledger"** and
**"public ledger,"** not "blockchain."
**Record LAST** — after the first real RLUSD settlement exists, so "View Transaction" opens a
real explorer page and the "live on mainnet today" line is true.

Spoken word count ≈ 430 (~2:50 at a calm pace). Timings are guides.

---

### 0:00 – 0:35 — The business problem

> "Commercial landlords share building costs across their tenants every year — security,
> landscaping, snow removal, insurance. It's called CAM reconciliation, and it's one of the
> most disputed line items in commercial real estate. Today it's done in spreadsheets: a
> property manager spends weeks compiling invoices and splitting them by each tenant's square
> footage, applying caps and exclusions buried in eighty-page leases. The tenant receives a
> number with no practical way to check it — so they dispute it. Across a portfolio, that's
> months of back-and-forth over money nobody can independently verify."

*(On screen: the live app, then the portfolio dashboard.)*

---

### 0:35 – 1:30 — The solution

> "MainStreet automates the whole process. You drop in the leases — AI reads each one and pulls
> out the CAM terms, square footage, caps, and exclusions, and it scores its own confidence on
> every field, so a human knows exactly what to double-check. Invoices go in the same way. Then
> the allocation engine splits the expense pool across tenants in seconds — enforcing every cap
> and exclusion, and checking that the totals actually balance. What took weeks takes minutes."
>
> "Every tenant gets a clear statement showing their share and the exact invoices behind it. If
> they still disagree, they dispute it right in the app, and the resolution is recorded with a
> tamper-evident fingerprint. This is the part property managers actually ask for."

*(On screen: "Try Live Demo" → Cascade Commons → CAM tab: reconciliation summary, confidence
badge, per-tenant table → a tenant statement → a resolved dispute.)*

---

### 1:30 – 2:25 — The XRPL integration

> "Here's where the XRP Ledger comes in. The hardest problem in CAM isn't the math — it's trust.
> So when a tenant pays, MainStreet settles the matching amount in RLUSD on the XRP Ledger, and
> embeds a cryptographic fingerprint of that settlement in the transaction itself. The tenant
> and the landlord both get a link — they can open the public ledger and verify the payment, and
> what it settled, for themselves."
>
> "We deliberately keep the sensitive lease and reconciliation data off-chain — that stays
> private. We use the ledger for what it's uniquely good at: a settlement record neither side
> can quietly change after the fact. And because it settles in RLUSD, it's denominated in
> dollars — nobody has to think about crypto. The ledger is the trust layer; the interface stays
> familiar property-management software."

*(On screen: the settlement flow — Pay → RLUSD Settlement → Settled on XRPL → **View
Transaction**. Click it; the real explorer page opens showing the RLUSD settlement. **Hold ~3
seconds** — this shot is the proof.)*

---

### 2:25 – 2:55 — Why this matters

> "CAM reconciliation moves real money and strains real relationships between landlords and
> tenants. MainStreet makes it fast for the manager and verifiable for the tenant — and that
> verification doesn't depend on trusting us, or trusting a spreadsheet. It's on a public ledger
> anyone can check. That's a genuinely better way to run a process the whole industry already
> does, every single year. It's live on the XRP Ledger mainnet today. That's MainStreet."

*(On screen: settlement flow in its green "Settled via RLUSD on XRPL" state, then the live URL.)*

---

## Notes for the recorder
- The single most important shot is **clicking "View Transaction" and landing on the real
  explorer page** (1:30–2:25 block). Record it carefully, maybe twice.
- Pause narration to let the reconciliation and explorer pages finish loading — don't talk over
  a spinner.
- Show only what's real. If a number looks off in the seeded demo on recording day, fix the
  data; don't narrate around it.
- See `SHOT_LIST.md` for the shot-by-shot capture plan and the pre-recording checklist.
