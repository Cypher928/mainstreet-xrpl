# Information Architecture — FROZEN

**Status: FROZEN.** The organization is settled. From this point forward we
**deepen each section rather than moving features around.** No further navigation
or structural redesign without an explicit decision to unfreeze.

> Records belong to **subjects** (Portfolio · Acquisition · Property · Space), not
> to feature modules. A warranty is a record attached to a subject, not a
> "Warranty module."

---

## Portfolio
- Properties
- Acquisition Reviews
- Portfolio analytics
- Team access

## Acquisition
- Due Diligence
- Rent Roll
- Risk Analysis
- Decision Report
- Convert to Property

## Property
- Overview
- Property
- Spaces
- CAM
- Reserves
- Reports
- Team Workspace

## Space
The home for everything about one tenant/suite:
- Lease
- CAM
- Invoices
- Disputes
- Maintenance
- Documents
- Photos
- Timeline
- AI / Ask AI

---

## Section contents

### Property → Property Information
**Reference information, not operational alerts.** The facts a manager looks *up*.
Grouped as Identity · Physical · Risk & Systems:

Property Name · Property Type · Address · Owner · Property Manager · Parcel/Tax ID ·
Year Built · Gross Square Feet · Lot Size · Number of Spaces · Occupancy % ·
Construction Type · Parking Spaces · Zoning · Insurance Carrier · Insurance Policy
Number · Insurance Expiration · Roof Age · HVAC Summary · Fire Protection · Utilities

Occupancy is **derived live** from tenant data, never hardcoded.

### Property → Documents
Site Plan · Survey · Building Plans · Environmental Reports · Insurance Policies ·
Roof Warranty · Parking Lot Plans · Capital Improvement Documents · Building Photos

### Space → Documents
Lease · Amendments · Estoppel · Certificates of Insurance · CAM Backup · Notices ·
Correspondence · Tenant Photos · Move-in / Move-out Photos

### Overview → Attention Needed
A prioritized widget near the top of Overview, **separate from Property
Information**. 3–5 items, ranked by severity, each with *what · why · one action*,
and a **View all** for the rest. Signals include: lease expiring/expired, CAM
underbilling, audit window closing, open disputes, insurance renewal approaching,
maintenance requiring review, missing NNN caps, vacancy reducing recoveries.

---

## Demo data
The seeded demo property (**Cascade Commons** — 26,000 sqft Austin retail strip
center) carries realistic commercial-real-estate values throughout so the app
reads like a live production system during a demonstration.

**Demo values are never shown for a real property.** `PropertyReference.isDemo()`
gates them; a real property shows its own data or an honest empty state.

---

## Known gaps against this IA
Recorded rather than silently built, since the freeze forbids new modules:

- **Property → Team Workspace** and **Portfolio → Team access** are named in the
  IA but not implemented. Building them means new modules — a separate decision.
- **Tab order** currently renders `Overview · Property · Spaces · CAM · Reports ·
  Reserves`; the frozen IA lists Reserves before Reports. A cosmetic swap, left
  alone to avoid navigation churn under the freeze.
- **Space → Disputes** is reachable from CAM, not yet surfaced inside the Space
  workspace (explicitly deferred).
