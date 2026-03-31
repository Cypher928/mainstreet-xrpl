# CAM Logic — AI-Powered CAM Reconciliation for Commercial Real Estate

> **The CAM reconciliation layer that works alongside Yardi — transparent, automated, and settled on XRPL.**

**Live Demo:** [mainstreet-xrpl.vercel.app](https://mainstreet-xrpl.vercel.app)

**Live XRPL Transaction:**
[AFAD1E38C7A932C35511DB846A099EE346B7E1D71EF3E9F5E61D1F9BF505E113](https://testnet.xrpl.org/transactions/AFAD1E38C7A932C35511DB846A099EE346B7E1D71EF3E9F5E61D1F9BF505E113)

---

## What It Does

CAM Logic automates the full Commercial Area Maintenance reconciliation workflow — from uploading leases to generating printable tenant statements — with AI-powered document extraction, on-chain audit trails, and a dispute resolution workflow.

| Feature | Description |
|---|---|
| **Portfolio Dashboard** | See all properties at once with KPIs — total tenants, invoices, CAM collected, open disputes |
| **Bulk Lease Upload** | Drop all lease PDFs at once — AI reads CAM terms, sqft, caps, and exclusions automatically |
| **Batch Invoice Upload** | Drop multiple invoice files (PDF, JPG, PNG) — AI extracts vendor, amount, category, and date from each |
| **Yardi Genesis CSV Import** | Export your CAM expense report from Yardi, drop it in — columns auto-detected, categories auto-mapped |
| **CAM Allocation Engine** | Calculates each tenant's pro-rata share based on their lease terms, exclusions, and caps |
| **Dispute Workflow** | Tenants can dispute any charge; resolutions are hashed and recorded on-chain via XRPL |
| **Monthly Holes Report** | Flags missing invoice categories and vendors before reconciliation runs — no more surprises |
| **Landlord Master Report** | Full property-wide summary — expenses by category, tenant allocations, dispute log |
| **Tenant Statements** | Per-tenant printable statements showing their share, eligible invoices, and reconciliation status |
| **AI Confidence Scoring** | Every extracted field is scored 0–100; low-confidence fields flagged for manual review |
| **Duplicate Detection** | Cross-batch duplicate invoices caught automatically with vendor + amount + date matching |
| **Pre-Allocation Modal** | Confirmation summary before any allocation runs — shows total, tenant count, category breakdown |

---

## Why XRPL

CAM reconciliation involves significant money and significant disputes. XRPL provides the audit trail that neither party can alter after the fact.

- **Every invoice hashed on-chain** — SHA-256 fingerprint anchored to XRPL at allocation time
- **Year-end settlement via XRPL Escrow** — funds released automatically when both parties agree
- **Dispute resolutions recorded immutably** — accepted, rejected, or docs-requested status stored on ledger
- **Neither landlord nor tenant touches crypto directly** — XRPL is the backend, not the interface

---

## For the Property Manager

Traditional CAM reconciliation takes weeks, involves outside firms, and produces paper statements tenants can't easily verify. CAM Logic changes that:

- **No more mailing statements** — tenants see their share, eligible invoices, and reasoning in real time
- **Flexible payment cadence** — tenants can pay weekly, monthly, or annually
- **Dispute any charge directly in the app** — no emails, no phone calls, no he-said-she-said
- **No outside reconciliation firm needed** — the allocation engine runs in seconds, not weeks
- **Works alongside Yardi** — import your existing data via CSV, no migration required

---

## Roadmap

| Phase | Status |
|---|---|
| **Phase 1 — CAM Reconciliation** | Live now |
| **Phase 2 — Escrow Analysis for Mortgage Companies** | In development |
| **Phase 3 — Rent Payment Processing via XRPL** | Planned |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | HTML / CSS / Vanilla JavaScript |
| AI | Claude API (Anthropic) — `claude-sonnet-4-20250514` |
| Blockchain | XRPL + xrpl.js |
| Hosting | Vercel (static) |
| Payments | RLUSD on XRPL *(planned)* |

---

## File Structure

```
mainstreet-xrpl/
├── index.html                  # Full app — all UI, AI logic, portfolio, reports, dispute workflow
├── xrpl-integration.js         # XRPL testnet connection, escrow creation, payment anchoring
├── escrow-reconciliation.js    # Escrow lifecycle: create, finish, cancel with CAM data memos
├── allocation-engine.js        # Standalone CAM pro-rata allocation engine (Node.js)
├── architecture.html           # Visual system architecture diagram
├── test-xrpl.js                # Live XRPL testnet test — funds two wallets, sends 10 XRP with memo
├── test-allocation.js          # Unit tests for the allocation engine
├── test-escrow.js              # Integration tests for escrow reconciliation
├── vercel.json                 # Vercel static hosting config
├── package.json                # Node.js dependencies (xrpl, etc.)
└── LICENSE                     # MIT
```

---

## Error Prevention

CAM Logic has four layers of error prevention built in before allocation runs:

1. **AI Confidence Scoring** — every field extracted from a lease or invoice is scored 0–100; anything below 70% is flagged with a visual warning badge
2. **Duplicate Invoice Detection** — cross-batch matching on vendor name prefix, amount (±$1), and date (±7 days); warns before adding and lets you remove the duplicate
3. **Amount Sanity Check** — if a new invoice is more than 3× the average for its category, a warning banner appears asking you to verify
4. **Pre-Allocation Confirmation Modal** — shows total expense amount, tenant count, and category breakdown before any allocation runs

---

## Security & Privacy

CAM Logic is **100% client-side and read-only**.

- No private keys or seed phrases are ever requested
- All AI analysis runs in your browser — documents are sent directly to the Anthropic API and never touch a CAM Logic server
- Wallet addresses are not logged or retained
- Only publicly visible XRPL data is used for on-chain verification
- Your Anthropic API key is used in-browser only and never stored

---

## Quick Start

1. Open [mainstreet-xrpl.vercel.app](https://mainstreet-xrpl.vercel.app)
2. Paste your Anthropic API key in the key bar at the top
3. Select a property from the portfolio dashboard (or add a new one)
4. Upload tenant leases — AI extracts CAM terms automatically
5. Upload invoices or import from Yardi Genesis CSV
6. Click **Run CAM Allocation**
7. Review results, dispute any charges, and generate printable reports

No installation. No account. No data stored.

---

## Live XRPL Transaction

This transaction was anchored to the XRPL testnet during development to demonstrate the on-chain audit trail:

```
TX Hash:  AFAD1E38C7A932C35511DB846A099EE346B7E1D71EF3E9F5E61D1F9BF505E113
Network:  XRPL Testnet
Explorer: https://testnet.xrpl.org/transactions/AFAD1E38C7A932C35511DB846A099EE346B7E1D71EF3E9F5E61D1F9BF505E113
```

---

*Built for the XRPL Grants program. CAM Logic is open source under the MIT License.*
