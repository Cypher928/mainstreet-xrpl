# MainStreet — Settlement Architecture

How RLUSD settlement on the XRP Ledger is structured today, and how it is designed to
evolve for production. Reconciliation and allocation are fully decoupled from settlement,
so the wallet model below can change without touching either engine.

---

## Current Demonstration Architecture

To minimize operational complexity during the demonstration, MainStreet currently uses a
single platform-controlled RLUSD settlement wallet.

For a tenant payment, MainStreet settles the corresponding amount of RLUSD from the platform
settlement wallet to the landlord's designated XRPL wallet. Every settlement is a standard
XRP Ledger transaction — publicly recorded and independently verifiable by both the landlord
and the tenant.

By design, settlements are signed and submitted out-of-band by an operator who holds the
wallet key — never by the web application. The public API is read-only and cannot move funds,
so no authenticated web request can initiate a transfer, and the fund-moving key never touches
the production server.

This architecture was intentionally selected for the demonstration: it exercises the full
end-to-end settlement flow while minimizing both infrastructure complexity and custody surface.

---

## Production Architecture

The production architecture is designed to support individual settlement wallets for each
property manager or ownership entity.

Each customer will register or create an XRPL wallet during onboarding. Settlement destinations
will be managed at the customer or property level, allowing:

- Independent custody of digital assets.
- Separation of customer funds.
- Multiple ownership groups.
- Portfolio-level settlement routing.
- Simplified auditing and reconciliation.

The RLUSD settlement engine was designed to support this evolution without changes to the
reconciliation or allocation engines.

---

## Deployment Status

✅ **Live on XRPL mainnet.** Wallet provisioning, the RLUSD trust line, and the first real
RLUSD settlement are complete and verified on-ledger:

- **Settlement wallet:** `rHLDysh6p6TcJM7QXU15YRLG4mERF5h5pv`
- **First settlement TX:** `D5F11B5EF7BD9C9BC8062FDA2F6B94BCA1F95DC3417C372548BB5F6082B4D12A`
  ([explorer](https://livenet.xrpl.org/transactions/D5F11B5EF7BD9C9BC8062FDA2F6B94BCA1F95DC3417C372548BB5F6082B4D12A)) — 1 RLUSD to the landlord wallet, `tesSUCCESS`, carrying a SHA-256 settlement fingerprint in its memo.
- **Verify independently:** `node scripts/verify-settlement.js rHLDysh6p6TcJM7QXU15YRLG4mERF5h5pv`

Until a settlement is recorded for a given property, the in-app settlement flow shows an honest
"launching on mainnet" pending state and never displays a fabricated transaction.
