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

The last row is read by the cabinet and **kept by the writer**:
`appendPropertyTimelineEvent` keeps `keyDate` only as a readable `YYYY-MM-DD`
(a date with a time on it is cut to the day; anything unreadable becomes
`null`, never a guess) and `keyDateKind` only when it is one of the six kinds
above. The whole timeline event is persisted as written and read back as
stored, so a key date survives save → reload (`test-e2e-demo-showroom.js`
proves it on a property the demo seeder never touches). What is still Phase 2
is *authoring* a key date in the add/edit entry modal; today only code writes
one (the demo seed does).

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

**Phase 1 — the visible cabinet (shipped).** `property-cabinet-view.js`
renders the Property tab as the front page of the record — header (name,
address, Total size · Spaces · Occupied · Vacant · Occupancy, a quiet Edit
property), What Needs Your Attention (the same items PropertyWorkspace ranks,
mounted a second time; the insurance item now opens the Insurance drawer),
nine cabinet tiles whose counts come from `PropertyCabinet.buildIndex()`, and
Recent activity (five pointers into History). Each tile opens a drawer:
records drawers group by year and reuse `PropertyOS.recordCardHtml` (Edit ·
Attach · Link · revisions unchanged); Invoices is searched, filtered by year /
vendor / category / space and paged 25 at a time through
`PropertyCabinet.invoiceQuery`; Building & Systems holds Property information,
the systems grid and — when a system is chosen — the whole story, with records
homed elsewhere shown as pointers; Important Dates is derived; History is home
to the fallbacks and lists everything. `#property/<drawer>/<year>/<id>` and
`#spaces/<id>` are written with `replaceState` and read on `hashchange`.
Spaces is a searchable, sortable table — Suite · Tenant · Sq ft · Lease end ·
Occupied/Vacant · Records — with vacant rows as real rows, and the Space file
is ten sections: Lease & Terms · Tenant Documents · CAM · Invoices ·
Statements · Disputes · Photos · Warranties · Notes · History. The flat
Property Records list and the 40-row register are replaced (the legacy page
remains as the fallback when the view module is absent). **Not done in Phase
1, by decision:** CAM inputs and coverage still read `property.tenants`, not
`activeTenants()` — a change to what CAM is *handed*, approved separately.

**Phase 1a — Invoices as a filing system (shipped).** The Invoices drawer
opens on **Vendor → Year → Month → Invoice**: `PropertyCabinet.invoiceFolders`
(one folder per vendor, alphabetical, case-insensitive, with category, count,
total and years — newest first, Undated last) and `invoiceFolder` (a vendor's
year by month, calendar order, chronological within the month). Every level is
a view over `property.invoices`; the leaf renders `PropertyOS.invoiceRowHtml`,
so identity, relations and the file chip (through `docLinkHtml`, signed on
open) are the register's own. `#property/invoices/<vendor>/<year>/<id>` is the
one drawer address that carries a vendor. Search & filter — the flat, paged
list — is one click away, and typing at the top of the cabinet is searching.
The filing principle is applied here only: *if a manager naturally thinks of
something as a folder, organize it that way.* Taxes → Year, Insurance → Year,
Agreements → Type/Vendor, Financing → Loan, Building & Systems → System are
candidates, not approvals.

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

Seed v8 fills the cabinet (see `docs/DEMO_SHOWROOM.md`): 49 records seeded as
ordinary manual timeline events — Real Estate Taxes 9 · Insurance 4 · Mortgage
& Financing 4 · Property Financials 5 · Agreements 5 · Building & Systems 17 ·
History 5 — linked to the register's bills by stable id, seven of them carrying
a `keyDate`, twelve carrying a labelled fictional PDF. The register's 26 rows
carry the ids `inv-0…inv-25` the reconciliation summary and the disputes
already used. The **reference samples** (site plan, survey, roof warranty…)
are still samples: they are not among the records and never counted.

## Known gaps against this IA
- **Team Workspace / Team access** are named and not implemented.
- **Tab order** renders `Overview · Property · Spaces · CAM · Reports · Reserves`;
  left alone (decision 1).
- **Space → Disputes** is a section of the Space file (surfaced); the dispute
  workflow stays in CAM, and a property-level roll-up is Phase 2.
- **Statements** is a Space section that links to the generator in Reports; a
  statement history per space is not yet recorded.
- **Property image**: the header shows `info.imageUrl` (with
  `info.imageCaption`) when a property carries one — the demo's is an
  architectural rendering captioned "demonstration illustration, not a
  photograph". No property image model exists beyond that field; a real
  property without one shows no image rather than an invented one.
- **The demo opens at its current seed from any route** (`selectProperty`
  runs the idempotent seed for the demo id), and its version marker now
  travels with the live object and through the load path, so an ordinary save
  no longer drops it and the next open no longer re-seeds over a manager's own
  demo records. See `docs/DEMO_SHOWROOM.md`, "A demo that already existed".
- **Invoice relations do not persist** (pre-existing): `_stripBlobs` keeps
  `id`, `camEligible` and the match fields on an invoice but not `system` or
  `spaceId`, so a Space/System relation set in the register is lost on reload.
  The demo therefore links its bills to systems from the record side
  (`relatedTo`, which is persisted) rather than tagging invoices. Not changed
  here; called out.
- The hidden `Estoppels` pane is dead markup behind a commented-out tab; left
  alone in Phase 1 because it is outside the Property/Spaces surfaces.
- The seeded demo's **reference samples** (site plan, survey, roof warranty…)
  surface in Building & Systems only, in a closed box headed "Reference
  samples — not records on this property (demo only)", every row tagged
  *sample*, after the records; the Records count never includes them.
