# CAM Logic

### 🚀 Try the Live Demo

**Live Demo:** https://mainstreet-xrpl.vercel.app

Experience a complete CAM (Common Area Maintenance) reconciliation on the XRP Ledger in under 60 seconds:

- Enter property size, tenant rentable area, and expense categories
- Input estimated vs actual year-end CAM costs
- Run the allocation engine (pro-rata calculation with category exclusions and caps)
- See the reconciliation result (overpaid, underpaid, or exact)
- Watch the full reconciliation data get SHA-256 hashed and anchored to XRPL Testnet as a structured Memo
- Simulate the escrow workflow (EscrowCreate → reconciliation → EscrowFinish or cancellation)

Everything runs client-side with a real connection to the XRPL Testnet using xrpl.js. No private keys or signing authority are ever requested.

**Security note:** This is a 100% read-only demo. Wallet addresses and data are not stored anywhere.

**Why this matters:** Small businesses and property managers currently spend weeks arguing over opaque CAM bills. This demo shows how XRPL escrow and immutable memos can make the entire process transparent, automatic, and auditable for everyone involved.

### 🏢 Built for Real Estate — Not Crypto Users

Landlords and tenants never interact with cryptocurrency directly. CAM Logic handles everything behind the scenes:

- Tenants pay via familiar bank or card payment
- Landlords receive funds in their normal account
- XRPL settlement, escrow, and audit trail happen invisibly
- No wallets, no seed phrases, no crypto knowledge required

The blockchain layer exists to protect both parties — not to complicate their workflow. Think of it like how Visa runs on complex infrastructure that cardholders never see.

---

## What is CAM Logic?

CAM Logic is a commercial real estate platform that eliminates CAM reconciliation disputes by giving landlords and tenants real-time transparency into every expense.

### For Landlords
- Upload each tenant's lease once — AI reads the CAM rules automatically
- Scan invoices as they arrive — AI extracts vendor, amount, and category
- The app calculates each tenant's share automatically based on their lease
- Everything stored, organized, and auditable in one place
- No more spreadsheets, no more year-end arguments

### For Tenants
- Download the app and see a clean dashboard
- Real-time view of every invoice — vendor, amount, and category
- Their exact CAM share broken down daily, monthly, and year-to-date
- Pay weekly, monthly, or annually — whatever their lease requires
- No surprises at year-end because they've seen every charge as it happened

### The Result
Tenants stop disputing CAM charges because they can see every invoice the moment it's uploaded. Landlords save time, legal fees, and tenant relationships.

Powered by XRPL — every invoice is cryptographically verified on-chain, and year-end settlements are handled automatically via XRPL Escrow. Tenants and landlords never interact with cryptocurrency directly — the blockchain layer is invisible, working behind the scenes to protect both parties.

---

## XRPL Integration

CAM Logic uses the XRP Ledger for three distinct functions:

**1. Invoice Hashing (`xrpl-integration.js`)**
Each completed CAM reconciliation is SHA-256 hashed and the hash is written into the `Memo` field of an XRPL transaction. This creates a permanent, timestamped proof-of-existence for the reconciliation record. Neither party can alter the figures after the fact — the hash on-chain will not match.

**2. Escrow Settlement (`escrow-reconciliation.js`)**
At the start of the lease year, the tenant locks their estimated annual CAM contribution into an XRPL `EscrowCreate` transaction. The funds are time-locked until the reconciliation deadline. When the year-end figures are confirmed, `completeCAMEscrow()` handles all three settlement outcomes automatically:
- **Overpaid** — escrow is finished, landlord refunds the difference to the tenant.
- **Underpaid** — escrow is cancelled, tenant sends the correct higher amount directly.
- **Exact** — escrow is finished, no further action needed.

**3. On-Chain Audit Trail**
Every transaction — escrow creation, finish, cancellation, and any adjustment payment — includes a structured JSON memo recording the `property_id`, `tenant_id`, and billing `period`. The full history of a reconciliation is verifiable by anyone with the tenant's XRPL address.

---

## File Structure

| File | Description |
|---|---|
| `allocation-engine.js` | Core allocation logic: calculates each tenant's pro-rata CAM share with category exclusions and optional caps. |
| `xrpl-integration.js` | SHA-256 hashes a reconciliation result and anchors it on the XRPL testnet via a Memo-field transaction. |
| `escrow-reconciliation.js` | Creates and settles XRPL time-locked escrows for estimated CAM payments, handling overpay, underpay, and exact settlement. |
| `index.html` | Single-file browser UI for entering property, tenant, and expense data and running the allocation engine client-side. |
| `test-allocation.js` | Runs sample data through the allocation engine and logs results to the console. |
| `test-xrpl.js` | Hashes a sample reconciliation result and submits it to the XRPL testnet, logging the transaction hash and explorer link. |
| `test-escrow.js` | Demonstrates the full escrow lifecycle across three scenarios (overpaid, underpaid, exact) using testnet-funded wallets. |
| `package.json` | Node.js project config with the `xrpl` SDK as the only dependency. |

---

## How to Run

**Prerequisites:** Node.js v18+ and internet access to reach the XRPL testnet.

```bash
# 1. Clone the repository
git clone https://github.com/Cypher928/mainstreet-xrpl.git
cd mainstreet-xrpl

# 2. Install dependencies
npm install

# 3. Run the allocation engine (no network required)
node test-allocation.js

# 4. Anchor a reconciliation result on the XRPL testnet
node test-xrpl.js

# 5. Run the full escrow lifecycle test (funds wallets via testnet faucet)
node test-escrow.js

# 6. Open the browser UI
open index.html
```

---

## Why XRPL

- **Purpose-built for payments.** The XRP Ledger's native escrow and payment primitives map directly onto the CAM settlement workflow without requiring custom smart contract logic — reducing attack surface and audit complexity.
- **Low cost, high throughput.** XRPL transactions settle in 3–5 seconds and cost a fraction of a cent, making it economically viable to anchor every reconciliation record on-chain rather than batching or sampling.
- **RLUSD stablecoin.** Ripple's USD-pegged stablecoin (RLUSD) on XRPL enables CAM obligations to be denominated and settled in dollars without fiat bank rails, reducing the friction of cross-party payments in commercial leasing.
- **Transparent and auditable.** Every on-chain memo is readable by any explorer or auditor without requiring access to proprietary systems — critical for the dispute resolution and audit requirements common in commercial lease agreements.
