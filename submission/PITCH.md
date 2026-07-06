# MainStreet — Pitch Script & Deck Outline (Make Waves §8 deliverables)

Final. Consistent with `HACKATHON_SUBMISSION.md`. The video and deck both cover the §8
requirements: **project · team · traction.** Lead with the live XRPL Mainnet RLUSD settlement
and the measurable impact.

---

## A) Video pitch script (≤3 minutes)

> **[0:00–0:15 — Hook / on the app]** "This is MainStreet. Commercial landlords and tenants
> fight over the same thing every year — CAM charges, common-area maintenance. We automate it,
> and we settle it on the XRP Ledger so both sides can finally trust the numbers."
>
> **[0:15–0:35 — Problem]** "Today, CAM reconciliation is manual, takes weeks, and produces
> spreadsheets tenants can't verify. Money leaks through un-enforced lease caps and exclusions,
> and disputes drag on — because the landlord's spreadsheet is the only source of truth."
>
> **[0:35–1:05 — Solution / product walkthrough]** "MainStreet fixes that end to end. Our AI
> reads the leases and invoices; the allocation engine computes each tenant's share, enforcing
> the caps and exclusions from their actual lease. On this $188,300 property it flagged and
> explained a $99,000 gap, so nothing gets silently over-billed. Every charge is traceable to
> the source lease and AI-verified — and tenants dispute anything in-app, each resolution
> stamped with a tamper-proof audit fingerprint."
>
> **[1:05–1:35 — The XRPL settlement, the live proof]** "Here's what makes it trustworthy. When
> a payment settles, MainStreet settles the matching amount in RLUSD — a US-dollar stablecoin —
> on the XRP Ledger. This is a real, live settlement on XRPL Mainnet: Payment, success, to
> Ripple's official RLUSD issuer, carrying our Make Waves Source Tag and a cryptographic
> fingerprint of the statement. The tenant sees the same settlement and verifies it
> independently. Neither side trusts a spreadsheet — they trust the ledger."
>
> **[1:35–2:05 — Traction / impact]** "And it pays for itself. On one property, MainStreet
> identified nearly $87,000 in recoverable value — cap savings, disputes, and exclusions that
> leak out of manual reconciliation. We're live on mainnet today, with every settlement tagged
> and attributable on-chain."
>
> **[2:05–2:25 — Team]** "I'm Lynn Raymond, and I built MainStreet as a solo founder during the
> Make Waves Challenge — from the commercial real estate workflow and AI allocation engine to
> the live XRPL RLUSD settlement integration."
>
> **[2:25–3:00 — Roadmap + close]** "Next we're moving toward per-property wallets and fully
> non-custodial settlements, so each property manager controls its own funds while continuing to
> use MainStreet's reconciliation engine. MainStreet turns a weeks-long, distrust-ridden process
> into minutes — automated, auditable, and verifiable on XRPL. Real product, real problem, live
> on mainnet. That's MainStreet. Thank you."

*~450 words ≈ 2:55. Record incognito, 1920×1080. Hold the explorer shot (~[1:05–1:35]) ~3s so
"Payment · Success," the RLUSD amount, and the Source Tag are readable.*

---

## B) Pitch-deck outline (10 slides · project · team · traction)

**1 — Title / Hook.** `MainStreet — AI CAM reconciliation, settled & verified on XRPL.`
Sub: *Live on XRPL Mainnet.* · live URL · visual: the green "settled & verified" flow.

**2 — The Problem.** Commercial CAM reconciliation is manual, weeks-long, opaque, dispute-prone.
The landlord's spreadsheet is the only "truth" → distrust + leakage. A trust problem between two
parties who don't trust each other.

**3 — The Solution.** AI lease/invoice extraction → cap-enforcing allocation engine → in-app
dispute workflow → **RLUSD settlement on XRPL.** Weeks → minutes; every number auditable and
verifiable on-chain.

**4 — Product.** Screenshots: reconciliation + per-tenant allocation cards. Traceable to the
source lease · AI-verified · cap-enforced. Detects & explains a $99,523 gap.

**5 — Why XRPL + RLUSD (the trust layer).** Public ledger = neutral, immutable source of truth
both parties verify independently. RLUSD = USD-denominated; property managers never operate
crypto; sub-cent fees. Source Tag `2606290001` on every transaction.

**6 — Live Proof (the money slide).** Explorer screenshot: **Payment · Success**, 1 RLUSD,
Ripple's official issuer, Source Tag `2606290001`. `TX D5F11B5E…B4D12A` + explorer link.
*"Live on XRPL Mainnet — verify it yourself."*

**7 — Impact / Traction.** **$86,943.98 recoverable value identified** on one property = $75,549
caps + $6,251 disputes + $5,145 exclusions (of a $188,300 pool). Live on mainnet; on-chain
activity tagged & attributable *(insert Source-Tag metrics after validation)*.
*Keep distinct: $86,943 is value identified (product impact), not on-chain volume.*

**8 — How it works / adoption.** Architecture: AI → engine → dispute → RLUSD settlement
(SHA-256 memo). Non-custodial direction; **works alongside Yardi** (CSV import) — no
rip-and-replace.

**9 — Team.** Lynn Raymond — solo founder. Built MainStreet end to end during the Make Waves
Challenge: the CRE reconciliation workflow, the AI allocation engine, and the live XRPL RLUSD
settlement integration.

**10 — Roadmap + Close.** Next: per-property wallets and fully non-custodial settlements — each
property manager controls its own funds while continuing to use MainStreet's reconciliation
engine. Close: live URL · GitHub · settlement tx. *"Real product, real problem, live on mainnet."*
