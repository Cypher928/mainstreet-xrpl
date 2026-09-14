# Information Architecture — Property Workspace V2

**Status: APPROVED, in progress.** The previous IA was frozen on the principle that
records belong to subjects, not feature modules. That principle stands. What
changes in V2 is the *experience*: the Property tab becomes the organized record
of the whole building, and a Space becomes the complete file for one physical
space. No data model is replaced; the filing cabinet already existed as data and
had never existed as a surface.

> **The two questions the product must answer on sight.**
> *"Tell me everything about this property."* → the Property filing cabinet.
> *"Tell me everything about this tenant / space."* → Spaces → Suite → the space file.
> That distinction is the heart of the redesign.

---

## Decisions (approved)

1. **The top-level tab bar does not change:** Overview · Property · Spaces · CAM ·
   Reports · Reserves. Everything in V2 lives *inside* Property and Spaces.
2. **Property is the filing cabinet** — the organized record of the entire building.
3. **Spaces are the tenant/space files.** Every physical space exists whether
   occupied or vacant.
4. **Vacancy is `vacant: true` on the existing tenant row.** One `tenants` array;
   no second `spaces[]` source of truth.
5. **`property.info` is persisted.** Verified property facts cannot be demo-only.
6. **Reserves stays a top-level workflow tab.** Its documents *surface* under
   Property → Mortgage & Financing as pointers; the workflow is not moved in V2.
7. **One home, many views.** A record has exactly one canonical drawer. It may
   appear in History, Important Dates, a building-system group, search or an AI
   answer — each of those is a pointer back to the record, never a copy.
8. **Search and AI return pointers into the cabinet**, not a second flat universe.

---

## The subjects

Records belong to **subjects** — Portfolio · Acquisition · Property · Space.
A warranty is a record attached to a subject, not a "Warranty module."

## Portfolio
- Properties · Acquisition Reviews · Portfolio analytics · Team access

## Acquisition
- Due Diligence · Rent Roll · Risk Analysis · Decision Report · Convert to Property

## Property

```
Overview        What Needs Your Attention (prominent, unchanged)
                Important Dates — next 90 days
                Cabinet tiles with live counts → each opens a drawer

Property        THE FILING CABINET
  Real Estate Taxes        by year → bills · assessments · correspondence
  Insurance                policies · certificates · claims · renewals, by year
  Invoices                 year · vendor · category · search — paged, never dumped
  Mortgage & Financing     loan docs · amendments · escrow · lender correspondence
  Property Financials      budgets · statements · reserves · owner statements
  Agreements               management · service · vendor · parking · easements
  Building & Systems       info · roof / HVAC / parking / … · warranties · photos
  Important Dates          every deadline, renewal, expiry — each with its source
  History                  the full property timeline

Spaces          list of every physical space — occupied AND vacant
  Space / Suite  THE TENANT FILE
    Lease & Terms · Tenant Documents · CAM · Invoices · Statements ·
    Disputes · Photos · Warranties · Notes · History

CAM             workflow (untouched) — REFERENCES property invoices, never owns them
Reserves        workflow (untouched in V2)
Reports         outputs (untouched)
```

Each drawer is a **detail view**, not another giant page. Invoices in particular
are searchable, filterable and paged so a property with thousands never renders
them all at once.

---

## How the cabinet maps to data that already exists

`property-cabinet.js` holds the **one** map from what a record already says
about itself to its drawer. Every surface asks it; none restates it.

| drawer | canonical home of |
|---|---|
| Real Estate Taxes | records with `category: real_estate_taxes` |
| Insurance | `category: insurance` (+ `info.insurance*` facts) |
| Invoices | `property.invoices` with no `spaceId` — a view of the register |
| Mortgage & Financing | `category: mortgage_financing`; `reserve_updated` events; **pointers** to `escrowReserves[].sourceDocuments` |
| Property Financials | `category ∈ {payment, cam}`; `cam_reconciled`, `invoice_imported`, `derived_metrics_rebuilt`, `settlement_completed` |
| Agreements | `category ∈ {vendor, lease}` at property scope |
| Building & Systems | `category ∈ {capital_improvement, warranty, inspection, maintenance, repair, building_photo, survey, site_plan, building_plan, environmental}`; any record with a `system` subject and no other filing; `property.info` |
| Important Dates | **derived** — see below |
| History | a view of everything, and the home of last resort |

**Fallback rule.** A property-scoped record that names no drawer — `category:
other`, `category: tenant` at property scope, system events such as
`sync_restored` — files under History with `reason: 'fallback'`. It is not lost
and it is not guessed into a drawer it does not belong in. The one thing that
can still place such a record is a `system` subject the author attached it to
(a note filed as "Other" against the roof is a roof record): that is read as a
fact, `reason: 'system'`, not a guess.

**Scope rule.** A record with a `suite` subject, or a bare `tenantId`, belongs
to that Space and returns no drawer. An invoice with a `spaceId` files under its
Space; the property Invoices drawer sees it only through a "by space" filter.

**Year** is a group-by on `timestamp` / `invoiceDate`, not a field.

### Important Dates — derived first, authored second

Every date points at the record it came from; a date with no record behind it
is not shown.

| kind | source | drawer |
|---|---|---|
| `lease_expiration` | `tenants[].end_date` (occupied rows only) | the Space |
| `insurance_renewal` | `info.insuranceExpires` | Insurance |
| `reserve_expiration` | `escrowReserves[].deadlines.reserveExpirationDate` | Financing |
| `renewal · deadline · maturity · expiry · inspection · permit` | timeline event `keyDate` + `keyDateKind` | the record's drawer |

The last row is **read now and written later**: `appendPropertyTimelineEvent`
is an allow-list writer and does not yet keep `keyDate`. Authoring it (in the
add/edit entry modal) is Phase 2 and requires extending that writer — a
persistence change, called out rather than slipped in.

### Addressing

One address format so an attention item, an AI citation or an MCP answer can
point into the cabinet: `#property/<drawer>/<year>/<recordId>` and
`#spaces/<spaceId>`. `PropertyCabinet.address()` / `parseAddress()` are pure;
Phase 1 wires them to the tab switcher.

---

## Space

The home for everything about one physical space, assembled by
`TenantSpace.assemble()` from the property's verified record — structured data
first, then rendered:

Lease & Terms · Tenant Documents · CAM · Invoices · Statements · Disputes ·
Photos · Warranties · Notes · History

A space is scoped by `subject.id` / `tenantId`, never by name. A **vacant** space
is a `tenants[]` row with `vacant: true`: it keeps its suite and area, reads
"Vacant" in the list, and is **not a lease** — `PropertyCabinet.activeTenants()`
is the set CAM inputs and coverage arithmetic should read once Phase 1 routes
them through it.

---

## Section contents carried forward

### Property → Property Information
Reference facts, not operational alerts — the facts a manager looks *up*.
Identity · Physical · Risk & Systems: Property Name · Property Type · Address ·
Owner · Property Manager · Parcel/Tax ID · Year Built · Gross Square Feet · Lot
Size · Number of Spaces · Occupancy % · Construction Type · Parking Spaces ·
Zoning · Insurance Carrier · Policy Number · Insurance Expiration · Roof Age ·
HVAC Summary · Fire Protection · Utilities.

Occupancy is **derived live** from tenant data. Stored in `property.info`,
persisted with the property (decision 5). Surfaces under Building & Systems.

### Space → Documents
Lease · Amendments · Estoppel · Certificates of Insurance · CAM Backup · Notices ·
Correspondence · Tenant Photos · Move-in / Move-out Photos.

### Overview → What Needs Your Attention
Unchanged and prominent: 3–5 ranked items, each *what · why · one action*, with
View all. Its actions gain a drawer address so "insurance renewal approaching"
opens Insurance rather than the generic Property tab.

---

## Phases

**Phase 0 — foundations (this document).** Unfreeze and approve this IA. Add
`property-cabinet.js` (drawer registry, index, invoice paging, Important Dates,
vacancy, addressing) as a pure module with behaviour tests and a mutation
harness. Persist `property.info` (four sites, mirroring `camRefusal`). Preserve
`vacant` through the tenant allow-list. No visible change.

**Phase 1 — the visible cabinet.** Property tab becomes the drawers with live
counts; Invoices drawer paged and searchable; Building & Systems with info,
systems, warranties, photos; History; derived Important Dates. Overview gains
tiles and the next-90-days dates. Spaces becomes a searchable, sortable list —
Suite · Tenant · Sqft · Lease end · Occupied/Vacant · counts — and the Space
file splits CAM from Invoices and links the tenant statement. The flat Property
Records list and the 40-row register are replaced, not deleted. CAM inputs and
coverage read `activeTenants()` (a change to what CAM is *handed*, not to the
engine — approved separately).

**Phase 2 — move things to where they belong.** Invoice/GL upload re-parented to
Property → Invoices (CAM references). Reserve & Loan documents surfaced in
Financing. Disputes: property roll-up + Space section. Authored `keyDate`.
Agreement sub-kinds.

**Phase 3 — scale and retrieval.** `properties.data` is one JSONB blob holding
timeline, invoices, tenants and reserves, rewritten on every save and capped at
500 timeline events. A `property_records` table behind the existing read
functions is the schema decision for thousands of records; property-wide search
index; drawer-aware AI retrieval and an MCP `get_records(drawer, year, page)`.

---

## Demo data
The seeded demo property (**Cascade Commons** — 26,000 sqft Austin retail strip
center) carries realistic values throughout. **Demo values are never shown for a
real property.** `PropertyReference.isDemo()` gates them; a real property shows
its own `info` or an honest empty state.

## Known gaps against this IA
- **Team Workspace / Team access** are named and not implemented.
- **Tab order** renders `Overview · Property · Spaces · CAM · Reports · Reserves`;
  left alone (decision 1).
- **Space → Disputes** is reachable from CAM and not yet a Space section (Phase 2).
- **Statements** has no home today beyond Reports (Phase 1 links it from the Space).
- The hidden `Documents` and `Estoppels` panes are dead markup, removed once the
  drawers cover what Documents once held (Phase 1).
