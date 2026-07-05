# MainStreet — Make Waves Submission Answers (draft)

Organized by the fields these programs usually ask for. Map to the actual form when submitting;
the content transfers even if the field names differ. Fill placeholder tokens last.

---

### Project name
MainStreet

### One-line pitch (≈ 1 sentence)
MainStreet makes commercial-real-estate CAM reconciliation transparent and verifiable —
automating the allocation of shared building expenses across tenants and settling payments in
RLUSD on the XRP Ledger, so every charge is one a tenant can independently verify.

### Elevator pitch (≈ 3–4 sentences)
Every year, commercial landlords divide millions of dollars of shared building costs (CAM —
common area maintenance) across their tenants. It's done in spreadsheets, takes weeks, and
hands tenants a number they can't verify — so disputes are constant. MainStreet automates the
whole workflow with AI document extraction and a pro-rata allocation engine, then settles
payments in RLUSD on XRPL mainnet and surfaces each settlement as a public, clickable
transaction. The result: a CAM number both sides can trust, settled on a ledger neither can
quietly alter.

### The problem
CAM reconciliation is one of commercial real estate's most opaque processes. Landlords
manually compile expenses, split them by lease terms (square footage, caps, exclusions), and
issue statements tenants have no practical way to check. The work is slow and error-prone, and
the lack of verifiability drives disputes that cost both sides time and trust.

### The solution / what we built
- **AI lease & invoice extraction** — pulls CAM terms, square footage, caps, and exclusions
  from PDFs, with a 0–100 confidence score on every field so humans know what to check.
- **Allocation engine** — computes each tenant's pro-rata share in seconds, with built-in
  integrity checks (does it balance? are caps applied correctly?).
- **Dispute workflow** — tenants challenge charges in-app; each resolution is recorded with a SHA-256 audit fingerprint for tamper detection.
- **Transparent RLUSD settlement on XRPL** — payments settle in RLUSD on mainnet and appear
  in-app as "Settled via RLUSD on XRPL — View Transaction," linking to the public explorer.
- **Works alongside Yardi** — imports existing CAM data via CSV; no migration required.

### Why XRPL / why blockchain
The core problem is *trust in a number*. A database row can be changed silently; an XRPL
transaction can't. By settling in RLUSD on XRPL and surfacing the transaction to both tenant
and landlord, MainStreet turns "trust my spreadsheet" into "verify it yourself on a public
ledger." RLUSD gives a USD-denominated settlement so neither party has to think about crypto —
the ledger is the trust layer, not the interface. Fast finality and low fees make
per-settlement on-chain records economical.

**Precisely what is on-chain vs. local (so there's no ambiguity):** each RLUSD settlement is a
real XRPL Mainnet transaction whose memo carries a SHA-256 fingerprint of the settlement
record, so the payment and what it settled are publicly verifiable together. Reconciliation,
lease, and dispute records themselves stay **off-chain** to protect tenant and landlord
confidentiality — each is protected by a SHA-256 audit fingerprint computed in-app, which makes
any later change to the record detectable. The architecture is deliberately built to
*optionally* anchor a finalized record's fingerprint to XRPL in future, without ever putting
private data on-chain. We chose not to overstate this: today the ledger carries settlements
(with their memo fingerprints), and the audit fingerprints are local by design.

### Mainnet status / on-chain proof
MainStreet is live on XRPL mainnet. First settlement transaction:
- **TX hash:** `D5F11B5EF7BD9C9BC8062FDA2F6B94BCA1F95DC3417C372548BB5F6082B4D12A`
- **Explorer:** https://livenet.xrpl.org/transactions/D5F11B5EF7BD9C9BC8062FDA2F6B94BCA1F95DC3417C372548BB5F6082B4D12A
- **Amount:** 1 RLUSD
- **Date:** 2026-07-05 (UTC)
- **Settlement wallet:** `rHLDysh6p6TcJM7QXU15YRLG4mERF5h5pv`
- **Landlord (destination) wallet:** `rw97rJThBJtoVRqR4DsoK5kW2taftzQvAX`
- **RLUSD issuer (mainnet):** `rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De`
- **On-chain proof:** Payment · `tesSUCCESS` · RLUSD from Ripple's official issuer · SHA-256 fingerprint in the tx memo. Verify with `node scripts/verify-settlement.js rHLDysh6p6TcJM7QXU15YRLG4mERF5h5pv`.
- **Attribution reference (per program rules):** `<<ATTRIBUTION_REF>>` — confirm the Make Waves attribution mechanism (registered wallet address vs. Source/Destination tag vs. memo) and fill in before submitting.

### Live demo
- **App:** https://mainstreet-xrpl.vercel.app (sign up free → "Try Live Demo" → seeded
  Cascade Commons property)
- **Demo video:** `<<DEMO_VIDEO_URL>>`

### Tech stack
Vanilla JS frontend; Vercel serverless functions; Supabase (auth + Postgres); Claude API for
document extraction (server-side proxy); XRPL + xrpl.js with RLUSD settlement. Secrets
(API key, wallet seed) live only in server-side environment variables.

### Traction
*(Fill honestly at submission time — do not inflate.)* Live app with a complete, judge-ready
demo property; full RLUSD settlement architecture deployed to mainnet. _State any real pilot
property managers / design partners / signups here only if true._

### What's next (roadmap)
- Onboard the first paying property-management pilots and process real CAM settlements on
  mainnet at volume.
- Expand settlement coverage across full tenant payment cycles.
- Deepen Yardi round-trip (export back to the system of record).

### Team
*(Add founder name(s), role(s), and one line of relevant CRE / engineering background.)*

### How Make Waves funding would be used
*(Tailor to the prize/track.)* Accelerate pilot onboarding and the cost of real on-chain
settlement volume during the challenge window; harden the settlement pipeline for production
property-management use.

### Registration / eligibility notes (for our own tracking, not the form)
- Registered: `<<REGISTRATION_DATE>>`
- Mainnet launch must be within 30 days of registration — **verify this window against the
  official page**; the first settlement must land inside it.
- Attribution mechanism **not yet verified** — confirm from Make Waves rules / registration /
  XRPL Commons Discord how on-chain activity is attributed (registered wallet address, Source
  Tag, Destination Tag, or memo). Apply it before/at the first settlement (go-live checklist
  step 5). Do not assume a Source Tag.
