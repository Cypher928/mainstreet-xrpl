# MainStreet — Make Waves Demo Script (2–3 min)

**Format:** screen recording with voiceover. Target 2:30, hard cap 3:00.
**Recorded last** — after the first real mainnet settlement, so the settlement flow shows the
live green "Settled via RLUSD on XRPL — View Transaction" state, not the pending state.
**Tone:** confident, concrete, no hype. Every claim shown on screen is real.

Spoken word count ≈ 360 (≈ 2:30 at a calm pace). Timings are guides, not gospel.

---

### 0:00 – 0:18 — The problem (hook)

> "Commercial real estate runs on a process almost nobody outside the industry has heard of:
> CAM reconciliation. Every year, landlords divide millions of dollars of shared building
> expenses across their tenants. It's done in spreadsheets, it takes weeks, and tenants are
> handed a number they have no way to verify. Disputes are constant. This is MainStreet."

*(On screen: the live app landing page, then the portfolio dashboard.)*

---

### 0:18 – 0:45 — Get into the product fast

> "Anyone can try it right now — sign up takes seconds, then one click loads a fully worked
> example property. Here's Cascade Commons: real tenants, real leases, real invoices, a
> completed reconciliation. No setup, nothing to configure."

*(On screen: click "Try Live Demo" → Cascade Commons opens → KPI header populated.)*

---

### 0:45 – 1:20 — The core engine

> "MainStreet reads leases and invoices with AI — pulling out square footage, CAM caps,
> exclusions — and scores every extracted field for confidence, so a human knows exactly what
> to double-check. Then the allocation engine splits the expense pool across tenants by their
> pro-rata share in seconds, not weeks. Every number on this screen traces back to a source
> document."

*(On screen: CAM tab → reconciliation summary, confidence badge, per-tenant allocation table.)*

---

### 1:20 – 1:45 — Trust & disputes

> "Because tenants can finally see the math, they can challenge it. A tenant disputes a charge
> right in their portal — no email chains, no he-said-she-said. The landlord sees it, resolves
> it, and there's a clean record of what happened."

*(On screen: tenant portal → a resolved dispute; back to landlord dispute view.)*

---

### 1:45 – 2:30 — The XRPL payoff (the centerpiece)

> "Here's where the XRP Ledger comes in. When a tenant pays, MainStreet settles the matching
> amount in RLUSD on XRPL mainnet — and surfaces it right here. This isn't a hidden backend
> rail. The tenant and the landlord both see 'Settled via RLUSD on XRPL,' and anyone can click
> through to the transaction on the public ledger and verify it themselves."

*(On screen: the settlement flow — Pay Now → RLUSD Settlement → Settled on XRPL → View
Transaction. Click "View Transaction" → the real explorer page at `<<EXPLORER_LINK>>` opens,
showing the `<<SETTLEMENT_AMOUNT>>` RLUSD settlement.)*

> "That's the unlock: a CAM number a tenant can trust, settled on a ledger neither side can
> quietly change after the fact."

---

### 2:30 – 2:50 — Close

> "MainStreet is live on XRPL mainnet today. It takes one of commercial real estate's most
> opaque, dispute-ridden processes and makes it transparent, fast, and verifiable — with the
> XRP Ledger as the trust layer. That's MainStreet."

*(On screen: settlement flow green state, then live URL `mainstreet-xrpl.vercel.app`.)*

---

## Notes for the recorder
- Do a silent dry run of the click path first; the reconciliation and tenant-portal loads can
  take a beat — pause narration to let screens settle rather than talking over a spinner.
- The single most important shot is **clicking "View Transaction" and landing on the real
  explorer page**. Hold on it for ~3 seconds. That shot is the proof.
- Do not show anything that isn't real. If a number looks off in the seeded demo on recording
  day, fix the data — don't narrate around it.
