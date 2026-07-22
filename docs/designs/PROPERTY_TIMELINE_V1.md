# Design — Property Timeline v1

**Status:** Design only. Do **not** implement yet.
**Branch when built:** `claude/property-timeline-v1` off `pilot` → merge into `pilot`.
**Origin:** First pilot feature, driven by Christy's feedback.

---

## 1. The problem (Christy's words, our framing)

A property manager's real question is rarely "what is the CAM total?" It's
**"what has happened at this property, in order, and can you show me the paper
behind each thing?"** Today that story is scattered across the lease view, the
invoice list, the dispute records, and the settlement panel. When an owner or a
tenant challenges something, Christy has to reassemble the sequence by memory and
by hunting through tabs.

**Property Timeline v1 gives her one chronological, provenance-linked record of
everything that happened at a property** — and lets her click any entry to see
the document behind it.

This is squarely a real-workflow feature (Vision §"Solve real workflows"): it
adds no new technology, it makes the record MainStreet already keeps *usable*.

---

## 2. Goals & non-goals

**Goals (v1)**
- One coherent, filterable, chronological view per property.
- Every entry that has a source is **clickable → opens the evidence** (document +
  page + highlight) using the existing Evidence Viewer.
- Complete coverage of the events a PM cares about: leases, extractions,
  amendments, invoices/CAM, disputes, **settlements/payments**, **documents**,
  reserves, reviews.
- Grouped by day so a long history is scannable.
- Works on mobile (Christy checks things on her phone).
- **Zero new database tables, zero migration** — reuse the persisted
  `property.timeline` array.

**Non-goals (explicitly out for v1)**
- No cross-property / portfolio timeline (single property only).
- No editing or manual event authoring by the user.
- No new AI, no predictions, no "what should I do next" (that is a later phase).
- No new upload path — documents enter through the flows that already exist.
- No exporting/printing beyond what the existing export already covers.

---

## 3. What already exists (reuse inventory)

This feature is ~70% built. The engine and the evidence plumbing are already in
production; v1 mostly connects and completes them.

| Capability | Already in code | Identifier |
|---|---|---|
| Event store (append, cap 500, persisted) | ✅ | `appendPropertyTimelineEvent(property, event)` — `script.js:17370` |
| Persistence (survives Supabase round-trip) | ✅ | `property.timeline` saved in the `properties.data` blob — `script.js:19789`; written by debounced `savePropertyData()` — `script.js:19894` |
| Renderer + collapsible panel + filter chips | ✅ | `renderPropertyActivity(property)` → `#propertyActivitySlot` (inside `#wsPane-overview`) — `script.js:17440`, called from `renderProperty` at `script.js:20350` |
| Derived views (critical, disputes, amendments…) | ✅ | `derivePropertyTimeline(property)` — `script.js:17403` |
| Filter grouping taxonomy | ✅ | `_ACTIVITY_FILTER_GROUPS` / `filterPropertyActivity()` — `script.js:17418` |
| Event schema w/ cross-link fields | ✅ (fields exist, unused) | `relatedEvidenceIds`, `relatedInvoiceIds`, `relatedDisputeIds` on each entry |
| Current-property accessor | ✅ | `currentProperty()` (`_props.find(p=>p.id===activePropId)`) — `script.js:806` |
| Tenant-name resolution in rows | ✅ | row render resolves `ev.tenantId` → `tenant_name` — `script.js:17480` |
| Evidence viewer (doc + page + highlight) | ✅ | `EvidenceViewer.open({citations,index})`, modal `#evidenceViewer` — `evidence-viewer.js:153` |
| Evidence adapters from existing model | ✅ | `EvidenceViewer.fromTenantField(p,t,keys,reason)`, `fromReserve(r)` |
| Citation chip → viewer wiring pattern | ✅ | `EvidenceViewer.openFromChip(el)` via `data-evd` JSON + `data-idx` |
| Empty-state helper | ✅ | `_workspaceEmptyStateHtml(icon,title,subtitle)` |
| Demo history seeding (shape reference) | ✅ | `ensureDemoProperty()` seeds `demoTimeline` — `script.js:15352` |
| Test harnesses | ✅ | `test-timeline.js` (unit), `test-e2e-activity-timeline.js` (Playwright) |

**Event schema (unchanged, from `appendPropertyTimelineEvent`):**
```
{ id, timestamp, type, severity: critical|warning|info|success,
  propertyId, tenantId, actor, source,
  title, description, metadata:{},
  relatedEvidenceIds:[], relatedDisputeIds:[], relatedInvoiceIds:[],
  derivedStateVersion }
```

**Existing type taxonomy already handled by the renderer:**
`lease_uploaded, extraction_completed, extraction_warning, amendment_uploaded,
amendment_applied, field_overridden, review_confirmed, invoice_imported,
dispute_created, dispute_resolved, sync_restored, merge_recovered,
export_generated, derived_metrics_rebuilt`.

---

## 4. The gap — what v1 actually adds

Three concrete gaps between "Property Activity" (today) and "Property Timeline
v1" (target):

1. **Coverage gaps.** Most events already emit — `lease_uploaded`
   (`script.js:4552`), `field_overridden` (`:6321`), `review_confirmed` (`:6397`),
   `amendment_uploaded` (`:6478`), `amendment_applied` (`:6591`),
   `invoice_imported` (`:7579`), `dispute_created` (`:11597`), `dispute_resolved`
   (`:11845`), `export_generated` (`:14529`), `sync_restored` (`:18481`). The
   **notable holes are settlements/RLUSD payments** (not in the emitter list) and
   **non-lease document uploads / reserve updates**. The seed comment at
   `script.js:15346` confirms it: the demo had to fake a history because not every
   real flow logs. Closing these is the bulk of the value.

   > **Two timelines — don't confuse them.** `property.timeline` +
   > `renderPropertyActivity` is the Property Activity feature we extend. A
   > *separate* CAM run log — `property.activityLog` + `renderActivityTimeline()`
   > (`script.js:13293`) — is for a single reconciliation run and is **out of
   > scope**; v1 must not touch it.
2. **Dead cross-link fields.** Every entry carries `relatedEvidenceIds`,
   `relatedInvoiceIds`, `relatedDisputeIds`, but the renderer never turns them
   into clickable links. The provenance promise isn't delivered at the row level.
3. **Scannability.** Rows are a flat reverse-chron list capped at 50 with no date
   grouping and a limited filter set (no Settlements/Documents groups).

v1 = **close coverage + make rows clickable to evidence + group by day + extend
filters.** That's it. No new subsystems.

---

## 5. UX design

### 5.1 Placement — one decision to make
Two viable homes; **recommend option A for v1**:

- **A (recommended, smallest change):** keep the collapsible panel where activity
  already lives — `#propertyActivitySlot` inside `#wsPane-overview` — and rename
  its header to **"Property Timeline."** Same component, no new route. Christy
  finds it exactly where it was.
- **B (more prominent, slightly more work):** promote it to its own workspace tab.
  `WORKSPACE_TABS = ['overview','cam','reserves','reports','documents']`
  (`script.js:3136`) → add `'timeline'`, a `#wsPane-timeline` pane + button
  `#wsTabBtn-timeline`, and a render call in `renderProperty`. Do this only if
  Christy says the timeline is a primary daily destination (§9).

Default to A; revisit B after pilot feedback. Either way the renderer and event
store are unchanged.

### 5.2 Anatomy of the panel
```
┌ Property Timeline — 34 events ───────────────────────────── [▾] ┐
│ [All][Leases][CAM][Disputes][Settlements][Documents][System]    │  ← filter chips (extended)
│                                                                  │
│  ── Tue, Jul 14, 2026 ───────────────────────────────────       │  ← NEW day divider
│   ● Settlement   ✓  RLUSD payment settled — $4,120               │
│                     FitZone Athletics · Property Manager         │
│                     [ View transaction ↗ ]  [ Evidence ]         │  ← NEW row actions
│   ● Invoice      ℹ  Q3 invoices imported                         │
│                     6 invoices · System            [ Details ▾ ] │
│                                                                  │
│  ── Mon, Jun 30, 2026 ──────────────────────────────────        │
│   ● Dispute      ⚠  Dispute opened — FitZone Athletics           │
│                     Parking resurfacing flagged   [ Evidence ]   │
│  … Showing 50 of 34 events …                                     │
└──────────────────────────────────────────────────────────────────┘
```

### 5.3 Interactions
- **Filter chips** — reuse `filterPropertyActivity(group)`. Add two groups to
  `_ACTIVITY_FILTER_GROUPS`: `settlements` and `documents`; add labels.
- **Row → Evidence** — when a row has resolvable provenance, show an **Evidence**
  button that calls `EvidenceViewer.open({citations})`. Citations are built at
  render time from the event's linkage (see §6.2). Reuses the exact viewer the
  rest of the app uses — same doc render, same highlight, same honesty banners.
- **Row → related record** — settlement rows show **View transaction ↗**
  (existing settlement/RLUSD deep link); invoice-linked rows can jump to
  `#cardInvoices`; dispute rows can open the dispute. Reuse existing navigation;
  don't invent new destinations.
- **Details ▾** — keep the existing metadata `<details>` expander.
- **Day dividers** — group `tl` by local calendar day before rendering the rows.

### 5.4 States (honesty rules — Vision §"Never a black box")
- **Empty:** keep the existing empty state ("No activity has been recorded…").
- **No source on file:** if a row's provenance can't be resolved to a document,
  **do not show an Evidence button** (never a dead click). Same principle the
  Evidence Viewer already follows (Tier 1 degradation).
- **Filtered-empty:** keep existing "No events in this category."
- **Truncation is stated:** keep "Showing 50 of N" — never hide the cap silently.

### 5.5 Mobile
Rows already stack; verify the new action buttons wrap (reuse the
`flex-wrap` pattern from the invoice action row fix) and that day dividers and
the extended chip bar scroll rather than overflow at 390px. No horizontal scroll.

---

## 6. Technical design

### 6.1 Data model — no change, no migration
Continue using the persisted `property.timeline` array and the existing entry
shape. It already round-trips through Supabase in the property blob
(`script.js:19789`). **No new tables. No API changes.**

### 6.2 Cross-linking rows to evidence (the core new wiring)
The entry already carries linkage fields; v1 adds a **resolver** that turns an
entry into Evidence-Viewer citations at render time, reusing existing adapters:

- **Lease/extraction/amendment/review events** (have `tenantId`): resolve the
  tenant on the property and call
  `EvidenceViewer.fromTenantField(property, tenant, fieldKeys, reason)` to build a
  citation from the lease document already on file. (No new evidence store.)
- **Invoice/CAM events** (`relatedInvoiceIds`): link to the invoice line in
  `#cardInvoices`; if the invoice carries a source doc/citation, pass it straight
  to `EvidenceViewer.open`.
- **Settlement events:** deep-link to the existing settlement/RLUSD transaction
  view (and testnet/mainnet explorer as already used).
- **Document events:** citation `{source, fileName, fileUrl}` → the viewer's Tier
  2 render path (it already fetches + renders any `fileUrl`).

Render change: in the row template (`script.js:17484`), when the resolver returns
a non-empty citation set, emit an **Evidence** button carrying the citations as
`data-evd` JSON and wire it through the existing `EvidenceViewer.openFromChip`
pattern (or a thin `openFromTimeline`). **Reuses the chip→viewer mechanism
verbatim.**

> Honesty: `relatedEvidenceIds` has no global by-id evidence registry today, so
> v1 resolves provenance through the **existing** field/reserve/lease evidence
> adapters rather than inventing an id lookup. If a later phase wants a global
> evidence registry, that's a separate decision — not v1.

### 6.3 Closing coverage gaps (instrumentation)
Add `appendPropertyTimelineEvent(property, {...})` calls at the points that
already mutate property state but don't log. Each is a **one-line addition** at an
existing success path — no refactor:

| Event to add | Where it fires today | New `type` / severity |
|---|---|---|
| Settlement initiated / settled | RLUSD settlement success handler (client side of `api/rlusd-settlement.js`) | `settlement_initiated` / `settlement_completed`, `success` |
| Non-lease document uploaded | upload success that writes via `api/lease-documents.js` (lease uploads already emit at `script.js:4552`; other docs don't) | `document_uploaded`, `info` |
| Reserve/escrow updated | escrow reserve engine apply | `reserve_updated`, `info` |

After each new `appendPropertyTimelineEvent(...)`, call `savePropertyData()`
(debounced, `script.js:19894`) so the entry persists in the blob — no schema work.
`export_generated`, `invoice_imported`, disputes, lease/amendment/review events
already emit; leave them as-is.

Register the two new display groups:
```
_ACTIVITY_FILTER_GROUPS.settlements = ['settlement_initiated','settlement_completed'];
_ACTIVITY_FILTER_GROUPS.documents   = ['document_uploaded'];
_ACTIVITY_FILTER_LABELS = { …, settlements:'Settlements', documents:'Documents' };
```
Add `_TYPE_LABEL` and `_activityGroupForType` entries to match (both already
exist; just extend them).

### 6.4 Rendering changes (all inside `renderPropertyActivity`)
1. Group `tl` by calendar day → insert `.tl-day-divider` rows.
2. Per row, run the provenance resolver (§6.2) → conditionally render action
   buttons (Evidence / View transaction / open record).
3. Extend chip list to include the two new groups.
4. Keep the 50-row cap + "Showing 50 of N" line.

No changes outside this function, the two taxonomy maps, and the handful of
instrumentation call sites. Blast radius is small and contained.

### 6.5 Production-settlement safety
The settlement instrumentation only **reads** the settlement result to log a
timeline entry — it must not alter the settlement flow, amounts, or the mainnet
path. On `main` this code is frozen; the event-logging line ships on `pilot`
first and is promoted only after validation.

---

## 7. Test plan (reuse existing harnesses)
- Extend **`test-e2e-activity-timeline.js`** (already drives the timeline via the
  local server + Supabase mock) to assert: day dividers render, new filter groups
  work, Evidence button appears only when provenance resolves, and clicking it
  opens `#evidenceViewer`.
- Extend **`test-timeline.js`** for the pure additions: day-grouping helper, the
  provenance resolver (unit-level), and the extended taxonomy maps.
- Reuse the Playwright + mocked-Supabase pattern; add a settlement-event
  assertion to confirm coverage without touching mainnet.
- Mobile 390px check reusing the invoice-overflow harness pattern.

---

## 8. Rollout
1. Branch `claude/property-timeline-v1` off `pilot`.
2. Build behind the same property view; verify on the branch preview URL.
3. Merge into `pilot`; Christy validates on `pilot.mainstreetcam.com`.
4. Iterate from her feedback (new `claude/*` branches off `pilot`).
5. Promote to `main` only after judging + validation (per branching strategy).

---

## 9. Open questions for Christy (validate before/while building)
- Which events matter most to her day — is **settlements** or **documents** the
  higher-value coverage gap to close first?
- Does she want the timeline **collapsed or expanded by default**?
- Is **per-day grouping** the right granularity, or does she think in weeks/quarters?
- Should a timeline entry ever be **dismissible/annotatable** (a note like "owner
  approved")? — candidate for v2, listed here so we don't build it prematurely.

---

_v1 principle check: every item above reuses an existing system (timeline engine,
evidence viewer, persistence, upload, settlement). Nothing here adds technology
for its own sake — it makes the record MainStreet already keeps usable and
defensible for a property manager._
