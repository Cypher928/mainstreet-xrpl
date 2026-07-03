# MainStreet — AI-Powered CAM Reconciliation for Commercial Real Estate

> **Transparent CAM reconciliation for commercial real estate — automated allocation, AI document extraction, and tenant-verifiable settlement in RLUSD on the XRP Ledger.**

---

## 👋 For Judges — Start Here

**Live demo:** [mainstreet-xrpl.vercel.app](https://mainstreet-xrpl.vercel.app)

**Fastest way to see the product (under 3 minutes):**

1. Open the live demo link above.
2. **Sign up** with any email — it's free and takes a few seconds (signup is required so your data persists, but no credit card and no setup).
3. Click **"Try Live Demo"** — this loads a fully seeded example property (*Cascade Commons*) with real tenants, leases, invoices, a completed CAM reconciliation, and a resolved tenant dispute.
4. Open the property and walk through the workspace tabs: **Overview → CAM → Reserves → Reports**. Everything is populated — no empty states to set up.
5. To see the XRPL value proposition: open a completed reconciliation and look for the **"Settlement verified on XRPL — view transaction"** surface, and the tenant portal's settlement-transparency card.

**What to look at:**

| | |
|---|---|
| **Architecture diagram** | [`architecture.html`](./architecture.html) — visual system overview |
| **XRPL settlement code** | [`rlusd-integration.js`](./rlusd-integration.js) — RLUSD mainnet settlement (wallet, trust lines, transaction logic) |
| **Hash-anchoring prototype** | [`xrpl-integration.js`](./xrpl-integration.js) — reference implementation for *optionally* anchoring a SHA-256 reconciliation fingerprint via a transaction memo (testnet; **not wired into the production app**) |
| **Allocation engine** | [`allocation-engine.js`](./allocation-engine.js) — standalone, unit-tested CAM pro-rata engine |
| **Demo video** | _to be added — see go-live checklist_ |
| **Live mainnet settlement transaction** | _to be added once the production wallet is funded — see [`RLUSD_GO_LIVE_CHECKLIST.md`](./RLUSD_GO_LIVE_CHECKLIST.md)_ |

> **On mainnet status:** the full RLUSD settlement architecture (wallet generation, trust lines, transaction logic, and in-app "View on XRPL" surfaces) is built and unit-tested. The production wallet is generated but **deliberately not yet funded** — funding and the first real mainnet settlement are the final, gated deployment step. A development-time on-chain anchor (testnet) is linked below as proof the anchoring mechanism works end-to-end.

---

## What It Does

MainStreet automates the full Commercial Area Maintenance (CAM) reconciliation workflow — from uploading leases to generating printable tenant statements — with AI-powered document extraction, cryptographic (SHA-256) audit fingerprints, and a dispute-resolution workflow.

| Feature | Description |
|---|---|
| **Portfolio Dashboard** | See all properties at once with KPIs — total tenants, invoices, CAM collected, open disputes |
| **Bulk Lease Upload** | Drop all lease PDFs at once — AI reads CAM terms, sqft, caps, and exclusions automatically |
| **Batch Invoice Upload** | Drop multiple invoice files (PDF, JPG, PNG) — AI extracts vendor, amount, category, and date from each |
| **Yardi Genesis CSV Import** | Export your CAM expense report from Yardi, drop it in — columns auto-detected, categories auto-mapped |
| **CAM Allocation Engine** | Calculates each tenant's pro-rata share based on their lease terms, exclusions, and caps |
| **Dispute Workflow** | Tenants can dispute any charge; each resolution gets a SHA-256 audit fingerprint for tamper detection |
| **Monthly Holes Report** | Flags missing invoice categories and vendors before reconciliation runs — no more surprises |
| **Landlord Master Report** | Full property-wide summary — expenses by category, tenant allocations, dispute log |
| **Tenant Statements** | Per-tenant printable statements showing their share, eligible invoices, and reconciliation status |
| **AI Confidence Scoring** | Every extracted field is scored 0–100; low-confidence fields flagged for manual review |
| **Duplicate Detection** | Cross-batch duplicate invoices caught automatically with vendor + amount + date matching |
| **RLUSD Settlement (XRPL)** | Tenant payments settled in RLUSD on the XRP Ledger as a transparent, verifiable proof-of-settlement layer |

---

## Why XRPL

CAM reconciliation involves significant money and significant disputes. XRPL gives MainStreet a public, tamper-proof settlement trail that neither party can alter after the fact — paired with cryptographic audit fingerprints for the underlying records.

- **RLUSD settlement on XRPL Mainnet** — tenant payments are settled in RLUSD on the XRP Ledger and surfaced in-app as "Settlement verified on XRPL — view transaction," not hidden behind the scenes
- **Settlement fingerprint in the transaction memo** — each settlement embeds a SHA-256 fingerprint of the settlement record in its on-ledger memo, so the payment and what it settled are publicly verifiable together
- **Local cryptographic audit fingerprints** — every reconciliation and dispute resolution gets a SHA-256 fingerprint computed in-app, so any later change to the record is detectable
- **Privacy by design, with optional future anchoring** — reconciliation and lease records stay off-chain to protect tenant and landlord confidentiality; the architecture is built to *optionally* anchor a finalized record's fingerprint to XRPL in future, without putting any private data on-chain
- **Tenants verify, they don't operate crypto** — the ledger is the trust layer; the interface stays familiar property-management software

---

## For the Property Manager

Traditional CAM reconciliation takes weeks, involves outside firms, and produces paper statements tenants can't easily verify. MainStreet changes that:

- **No more mailing statements** — tenants see their share, eligible invoices, and reasoning in real time
- **Dispute any charge directly in the app** — no emails, no phone calls, no he-said-she-said
- **No outside reconciliation firm needed** — the allocation engine runs in seconds, not weeks
- **Works alongside Yardi** — import your existing data via CSV, no migration required
- **Settlement you can point a tenant to** — every settlement is a public, verifiable XRPL transaction

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | HTML / CSS / Vanilla JavaScript |
| AI | Claude API (Anthropic), called via a server-side proxy |
| Backend | Vercel serverless functions (`/api/*`) |
| Auth & data | Supabase (authentication + Postgres) |
| Blockchain | XRPL + xrpl.js; RLUSD settlement |
| Hosting | Vercel |

---

## Security & Privacy

- **Secrets stay server-side.** The Anthropic API key and the XRPL settlement wallet seed live only in server-side environment variables — they are never exposed to the browser.
- **Authenticated access.** Requests to sensitive API routes are authenticated against Supabase; the user's token is verified server-side before any privileged operation runs.
- **Rate limiting.** API endpoints apply per-user rate limiting to prevent abuse.
- **Public-by-design settlement.** XRPL settlement transactions are intentionally public and verifiable on the ledger — that transparency is the point, not a leak.

---

## Quick Start

1. Open [mainstreet-xrpl.vercel.app](https://mainstreet-xrpl.vercel.app)
2. Sign up with any email (free, no card required)
3. Click **"Try Live Demo"** to load the seeded *Cascade Commons* property
4. Explore the workspace tabs, open a reconciliation, and review a tenant dispute
5. To run your own: add a property, upload leases and invoices (or import a Yardi CSV), and click **Run CAM Allocation**

---

## On-Chain Anchor (Development / Testnet)

This transaction was submitted to the XRPL **testnet** during development to demonstrate the SHA-256 hash-anchoring mechanism (the `xrpl-integration.js` prototype) end-to-end. It is a development artifact, not a production feature. The production **mainnet** RLUSD settlement transaction will be added here once the wallet is funded (see [`RLUSD_GO_LIVE_CHECKLIST.md`](./RLUSD_GO_LIVE_CHECKLIST.md)).

```
TX Hash:  AFAD1E38C7A932C35511DB846A099EE346B7E1D71EF3E9F5E61D1F9BF505E113
Network:  XRPL Testnet
Explorer: https://testnet.xrpl.org/transactions/AFAD1E38C7A932C35511DB846A099EE346B7E1D71EF3E9F5E61D1F9BF505E113
```

---

## Roadmap

| Phase | Status |
|---|---|
| **CAM Reconciliation** | Live |
| **AI Lease & Invoice Extraction** | Live |
| **Escrow & Reserve Intelligence** | Live |
| **RLUSD Settlement on XRPL** | Built; mainnet launch pending wallet funding |

---

## Local Development & Setup

### Prerequisites
- **Node.js 18+** (20+ recommended) and npm
- For the full app: a **Supabase** project (auth + Postgres) and an **Anthropic API key**
- Optional, to run the serverless API locally: the **Vercel CLI** (`npm i -g vercel`)

### 1. Clone & install
```bash
git clone https://github.com/cypher928/mainstreet-xrpl.git
cd mainstreet-xrpl
npm install
```

### 2. Run the test suites (no external services needed)
The engines and integration logic run fully offline — the fastest way to confirm it works:
```bash
node test-regression.js     # full engine/regression suite
npm test                    # allocation engine unit tests
npm run test:rlusd          # RLUSD/XRPL settlement unit tests (live checks auto-skip if offline)
```
`test-*.js` (37 suites) cover allocation, disputes, extraction, escrow/reserves, persistence, and
the XRPL settlement builders. None require Supabase or network access.

### 3. Configure environment (for the full app)
The serverless functions in `api/` read these environment variables. Set them in a local `.env`
(git-ignored) or via the Vercel dashboard:

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Server-side Claude API key (document extraction) |
| `CLAUDE_MODEL` | Model id (defaults to a Claude Sonnet model if unset) |
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_ANON_KEY` | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service-role key (server-side auth verification) |
| `XRPL_SETTLEMENT_WALLET_ADDRESS` | Public settlement wallet address (read-only status only) |
| `XRPL_NETWORK` | `mainnet` or `testnet` |

> The public API is **read-only**. Fund-moving XRPL actions are performed by local admin scripts
> (`scripts/setup-trust-line.js`, `scripts/send-settlement.js`) that read the wallet seed from the
> `XRPL_SETTLEMENT_WALLET_SEED` env var in your shell only — the seed is never needed on the server.

### 4. Supabase schema
Create a Supabase project and apply the migrations in [`migrations/`](./migrations) in order
(`001_…` → `009_…`) via the Supabase SQL editor or CLI. They create the lease-jobs, evidence/audit,
CAM-reconciliation, lease-intelligence, acquisition-review tables and the row-level-security policies.

### 5. Run the app locally
The frontend is static (`index.html` + `script.js`); the API is Vercel serverless functions:
```bash
vercel dev        # serves the static app + /api/* functions on http://localhost:3000
```
Then open the local URL, sign up, and click **Try Live Demo** to load the seeded demo property.

> **Fork note:** the Supabase URL and anon key are set at the top of `script.js` (they point at the
> project's own Supabase). To run against **your** Supabase, update those two constants to your
> project's values.

---

*Built for XRPL Commons Make Waves. © 2026 Main Street. All rights reserved — see [LICENSE.txt](./LICENSE.txt).*
