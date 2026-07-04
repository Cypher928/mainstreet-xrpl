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

Wallet provisioning and RLUSD trust-line setup are complete and verified on XRPL mainnet.
The **first live RLUSD mainnet settlement is the final gated deployment step**, performed
only after wallet provisioning and on-ledger trust-line verification — both of which are
now confirmed. Until that step is executed, the in-app settlement flow shows an honest
"launching on mainnet" pending state and never displays a fabricated transaction.
