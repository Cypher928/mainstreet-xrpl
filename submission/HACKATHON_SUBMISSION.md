# MainStreet — XRPL Hackathon Submission Package

**Status:** Final. The application and screenshots are frozen. This document is the canonical
source for all submission-form copy. Three values still require the founder to fill in (marked
`<<…>>`): the demo-video URL, the Make Waves registration date, and the program's attribution
reference (confirm the mechanism from the official rules).

---

## Key facts (single source of truth — keep all docs consistent with these)

| | |
|---|---|
| Product | MainStreet — AI-powered CAM reconciliation for commercial real estate, settled in RLUSD on XRPL |
| Live app | https://mainstreet-xrpl.vercel.app |
| Network | XRPL **mainnet** |
| First settlement TX | `7FA730B2B78819AE34B3D1B458721FBC52B9CD25E980ED42DD1B15E9F9FC724A` |
| Explorer | https://livenet.xrpl.org/transactions/7FA730B2B78819AE34B3D1B458721FBC52B9CD25E980ED42DD1B15E9F9FC724A |
| Settlement wallet (sender) | `rHLDysh6p6TcJM7QXU15YRLG4mERF5h5pv` |
| Landlord wallet (destination) | `rw97rJThBJtoVRqR4DsoK5kW2taftzQvAX` |
| RLUSD issuer (mainnet) | `rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De` (Ripple's official) |
| Make Waves Source Tag | `2606290001` (on every settlement Payment + TrustSet; T&C §5/§7) |
| Settlement amount / date | 1 RLUSD · 2026-07-05 (UTC) |
| Recoverable value identified (demo property) | **$86,943.98** ($75,548.61 caps + $6,250.75 disputes + $5,144.62 exclusions) |
| Demo property | Cascade Commons — $188,300 CAM pool, 5 tenants, $88,776.77 billed |

---

## One-line pitch

MainStreet automates commercial-real-estate CAM reconciliation and settles it in RLUSD on the
XRP Ledger — so landlords and tenants share one verifiable source of truth instead of trusting
each other's spreadsheets.

## Elevator blurb (~50 words)

Commercial landlords bill tenants for common-area maintenance every year — a slow, opaque,
dispute-ridden manual process. MainStreet automates it with AI extraction and a cap-enforcing
allocation engine, then settles each payment in RLUSD on XRPL: a public, permanent receipt both
parties verify independently. One demo property surfaced $86,943 in recoverable value, with a
live mainnet settlement.

---

## 1. Project description

**MainStreet — AI-powered CAM reconciliation, settled and verified on XRPL.**

Every year, commercial landlords bill their tenants for "CAM" (common area maintenance) — and
every year it turns into a slow, opaque, dispute-ridden mess. Reconciliation is done by hand in
spreadsheets, takes weeks, often involves outside firms, and produces paper statements tenants
have no way to verify. The result is leakage, distrust, and disputes.

MainStreet automates the entire workflow: AI reads the leases and invoices, an allocation engine
computes each tenant's pro-rata share while enforcing the caps and exclusions written into their
actual lease, and a built-in dispute workflow resolves disagreements with a tamper-proof audit
trail. Then the part that makes it trustworthy: each settlement is paid in **RLUSD on the XRP
Ledger** — a public, permanent receipt that the landlord *and* the tenant can each verify
independently. On a single demo property, MainStreet identified **$86,943.98** of recoverable
value and produced a **live, on-chain settlement on XRPL mainnet**.

## 2. Why XRPL + RLUSD are essential (not an add-on)

CAM reconciliation is fundamentally a **trust problem between two parties who don't trust each
other** — a landlord billing, and a tenant paying, real money. Today the landlord's spreadsheet
is the only "truth," and the tenant just has to accept it. That's the whole reason the process
is adversarial.

- **XRPL is the neutral source of truth.** Settling on a public ledger means the record isn't the
  landlord's word or the tenant's — it's an immutable, independently verifiable fact neither side
  can alter after the fact. Remove XRPL and MainStreet is just another CAM spreadsheet tool.
- **RLUSD makes it usable by non-crypto operators.** A landlord settling $34,650 of CAM sees
  **$34,650** — USD-denominated, no volatility, no conversion math. A property manager adopts this
  without ever "operating crypto." XRPL's sub-cent fees (this settlement cost **0.000012 XRP**)
  make per-tenant settlement economical.
- **The ledger binds the payment to what it settled.** Each settlement carries a **SHA-256
  fingerprint of the reconciliation in its on-chain memo**, so the payment and the statement it
  settles are publicly verifiable together.

The ledger isn't decoration — it's the trust layer the entire product is built to provide.

## 3. Problem → Solution → Impact

- **Problem:** CRE CAM reconciliation is manual, slow (weeks), opaque, and dispute-prone;
  landlords and tenants have no shared verifiable record; money leaks through un-enforced caps,
  mis-applied exclusions, and unresolved disputes.
- **Solution:** AI lease/invoice extraction → a unit-tested allocation engine (pro-rata + cap +
  exclusion enforcement) → an in-app dispute workflow with SHA-256 audit fingerprints → RLUSD
  settlement on XRPL as the shared, verifiable proof-of-settlement layer. Works alongside Yardi
  (CSV import), so there's an adoption path, not a rip-and-replace.
- **Measurable impact (one demo property):** **$86,943.98** total recoverable value identified —
  $75,548.61 caps + $6,250.75 disputes + $5,144.62 exclusions — against a $188,300 CAM pool across
  5 tenants. Weeks of work compressed to minutes, every number auditable, settlement verifiable
  on-chain.

## 4. Two-minute demo script

> **[0:00–0:15 · Overview]** "Commercial landlords and tenants fight over one thing every year:
> CAM charges — common area maintenance. Reconciling them is manual, opaque, and takes weeks.
> MainStreet automates the whole thing, and settles it on XRPL so both sides can actually trust
> the result."
>
> **[0:15–0:35 · CAM reconciliation]** "Drop in the leases and invoices — our AI extracts the
> terms, and the engine computes each tenant's pro-rata share, enforcing the caps and exclusions
> from their actual lease. On this $188,300 property, it flagged and *explained* a $99,000 gap —
> cap enforcement plus vacancy — so nothing is ever silently over-billed."
>
> **[0:35–0:55 · Allocation + value]** "Every charge is traceable to the source lease and
> AI-verified. And across the property, MainStreet surfaced nearly **$87,000** in recoverable
> value — cap savings, disputes, and exclusions that leak out of manual reconciliation."
>
> **[0:55–1:20 · Settlement + explorer]** "Here's what makes it trustworthy. When a payment
> settles, MainStreet settles the matching amount in RLUSD — a US-dollar stablecoin — on the XRP
> Ledger. Not a hidden backend: a public, permanent receipt. This is a **real, live settlement on
> XRPL mainnet** — Payment, success, to Ripple's official RLUSD issuer."
>
> **[1:20–1:40 · Tenant view + audit]** "The tenant sees that same settlement and verifies it
> independently on the ledger — neither party has to trust the other's spreadsheet. And every
> dispute resolution carries a SHA-256 audit fingerprint."
>
> **[1:40–2:00 · Close]** "MainStreet turns a weeks-long, distrust-ridden process into minutes —
> automated, auditable, and verifiable on XRPL. Real product, real problem, live on mainnet.
> That's MainStreet."

*(~300 words ≈ 2:00 at a natural pace. Capture the on-chain-proof shot carefully — it's the
hardest to re-stage. Record everything in incognito at 1920×1080.)*

## 5. Screenshot captions

1. **Overview:** "End-to-end CAM reconciliation for a 5-tenant, $188,300 property — with the settlement verified on-ledger."
2. **XRPL Explorer:** "Live proof: an RLUSD settlement on XRPL mainnet — Payment · Success — to Ripple's official RLUSD issuer. Our first mainnet settlement: a deliberate small-value proof from a funded, live wallet (9 RLUSD)."
3. **Portfolio summary:** "$86,943.98 of recoverable value on one property — $75,549 cap enforcement + $6,251 disputes + $5,145 exclusions."
4. **Tenant statement:** "The tenant's own statement shows the same settlement, independently verifiable on XRPL — the ledger is the shared source of truth."
5. **Allocation cards:** "Every tenant's pro-rata share and cap adjustment, traceable to the source lease and AI-verified. Caps alone reduced billing by $75,549."
6. **Reconciliation:** "The engine detects and explains a $99,523 variance — cap enforcement plus 10% vacancy — so nothing is silently over-billed. Catching the gap is the product."
7. **Disputes + audit hash:** "In-app dispute resolution, each stamped with a SHA-256 audit fingerprint — explainable and verifiable."
8. **Reports:** "One click generates landlord-, tenant-, and lender-ready reports, CSV exports, and shareable read-only links — built for real operators."

## 6. Screenshot order

**Full (value-first):** Overview → XRPL Explorer → Portfolio summary → Tenant statement →
Allocation → Reconciliation → Disputes → Reports → (Landing) → drop Login.

- **If limited to 3:** Overview, XRPL Explorer, Portfolio summary.
- **If limited to 5:** add Tenant statement and Reconciliation.

## 7. Presentation fixes applied / to apply (no app changes)

- Caption the $1 explorer tx as a deliberate proof-of-mechanism settlement from a funded wallet.
- Caption the reconciliation "variance" as a feature (detects + explains a $99,523 gap).
- Use same-moment Overview/Reports screenshots; crop the "Delete Reconciliation" button.
- Note non-custodial design (operator-initiated settlement, read-only public API, seed off-server).
- Lead every form field with the two strongest facts: live mainnet settlement + $86,943 recovered.

## 8. Self-assessment (honest)

| Category | Score | Ceiling |
|---|---|---|
| Innovation | 7 | Sharp application + niche, but an integration of known parts, not a new primitive. |
| XRPL Integration | 8 | Real mainnet RLUSD, official issuer, memo, live proof — but a single Payment type, one small settlement; deeper XRPL (escrow, anchored disputes, recurring settlement) unused. |
| Technical Execution | 8 | Real working SaaS, unit-tested engine, clean wallet rotation — but settlement is operator-initiated and there's one live tx. |
| Real-World Impact | 8 | Large real problem, concrete $86,943 figure, Yardi-alongside adoption path — but demonstrated on demo data, no live pilots yet. |
| UI/UX | 9 | Polished, consistent, ships-like-a-product — a few edges managed via captions. |
| Overall Competitiveness | 8 | Real product + load-bearing XRPL + live proof + quantified ROI + polish. Top-of-field. |

Path to 9–10 is depth of on-chain usage, evidence of adoption, and scale of real settlement —
none fixable in submission copy, none required to place well.

---

*Fill before submitting: demo-video URL (`<<DEMO_VIDEO_URL>>`) and registration date
(`<<REGISTRATION_DATE>>`). Attribution is resolved: Make Waves Source Tag `2606290001`, now set
on every settlement.*
