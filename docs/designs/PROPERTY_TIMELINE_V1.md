# Design — Property Timeline v1

**Status:** Approved for build (MVP). First Phase 2 feature.
**Branch:** `claude/property-timeline-v1` off `pilot` → merge into `pilot`.
**Origin:** Pilot feedback (Christy). This revision **evolves** the original
design toward Christy's real workflow — it is not a redesign.

> **What changed from the first draft (and why).** The first draft focused on
> auto-surfacing events MainStreet already records and cross-linking them to
> evidence. Pilot feedback reframed the immediate need: a property manager's
> daily pain is **remembering and retrieving what happened at a property** — the
> phone call, the roof photo, the vendor invoice, who's responsible. So v1 leads
> with a **manager-maintained logbook** (manual entries + attachments +
> responsibility + lease reference) on top of the same event engine. The
> auto-event coverage and evidence cross-linking from the first draft are **still
> the plan** — they just become the *next* increments, added as event types
> through the registry below, not separate systems.

---

## 1. The problem (Christy's lens)

A property manager carries a hundred small facts per property in their head and
across email, texts, and paper: when the roof was patched, which vendor, what the
tenant agreed to on the phone, whether that repair was the landlord's or the
tenant's, which lease clause governs it. When an owner or tenant challenges
something months later, they reassemble it from memory.

**Property Timeline v1 gives them one place to record and retrieve everything
that happens at a property — in order, with the paper attached, and with who's
responsible made explicit.**

The one question (Phase 2): _does this make a commercial property manager's day
easier?_ — Yes: it replaces "where did I put that / when did that happen" with a
single chronological record they can trust and show.

---

## 2. MVP scope

**In (this build):**
1. **Property timeline / history** — one clean, chronological record per property.
2. **Manual timeline entries** — the manager adds an event: date, what happened,
   short note.
3. **Attachments** — invoice, PDF, and photo files attached to an entry (reuses
   the existing upload path).
4. **Landlord vs. tenant responsibility** — an explicit field on each entry.
5. **Optional lease section reference** — free-text (e.g. "§7.2 Roof & Structure")
   so an entry can point at the governing clause.
6. **Clean chronological view** — day-grouped, scannable, mobile-first.

**Deliberately deferred (near-term, same event model — not separate systems):**
- Auto-logging of settlements/RLUSD, non-lease document uploads, reserves.
- Evidence-Viewer cross-linking of auto-events (the `relatedEvidenceIds` wiring).
- Extended filter groups, edit/delete of entries, cross-property/portfolio view.
- Any proactive AI ("what needs attention"). That's a later Phase 2 priority.

**Out (not this feature):** predictions, recommendations, portfolio rollups.

Scope discipline (Phase 2 principle): **help managers remember and retrieve** —
not build every future capability now.

---

## 3. Reuse inventory (evolution, not rewrite)

The event engine, persistence, and upload path already exist. v1 adds a
manager-facing entry/attachment layer on top and a registry for extensibility.

| Capability | Status | Identifier |
|---|---|---|
| Event store (append, cap 500, persisted) | reuse | `appendPropertyTimelineEvent(property, event)` — `script.js:17370` |
| Persistence in the property blob (Supabase round-trip) | reuse | `property.timeline`; written by debounced `savePropertyData()` — `script.js:19894` |
| Renderer + collapsible panel | reuse + enhance | `renderPropertyActivity(property)` → `#propertyActivitySlot` (in `#wsPane-overview`) — `script.js:17440` |
| Current-property accessor | reuse | `currentProperty()` — `script.js:806` |
| Tenant-name resolution in rows | reuse | `ev.tenantId` → `tenant_name` — `script.js:17480` |
| **File upload (base64 → Supabase Storage)** | reuse | `uploadInvoiceFile()` — `script.js:813` → `/api/upload` (buckets `invoices`, `leases`) |
| Evidence viewer (for future doc cross-linking) | reuse later | `EvidenceViewer.open({citations})` — `evidence-viewer.js:153` |
| Empty-state helper | reuse | `_workspaceEmptyStateHtml(icon,title,subtitle)` |
| Escaping | reuse | `esc()` |
| Demo history seed (shape reference) | reuse | `ensureDemoProperty()` seeds `demoTimeline` — `script.js:15352` |
| Test harnesses | reuse | `test-timeline.js` (unit), `test-e2e-activity-timeline.js` (Playwright) |

---

## 4. Data model — additive, no migration

Keep the persisted `property.timeline` array. **Extend the entry shape
additively** in `appendPropertyTimelineEvent` — existing events are unaffected
(new fields default empty), and it still round-trips in the blob. **No new
tables, no API changes.**

New fields on each entry:
```
manual:          false,          // true = manager-authored logbook entry
category:        null,           // manual category key (see registry) e.g. 'maintenance'
responsibility:  'na',           // 'landlord' | 'tenant' | 'shared' | 'na'
leaseRef:        null,           // optional free-text clause reference
attachments:     [],             // [{ name, url, kind: 'invoice'|'pdf'|'photo'|'file' }]
```
Existing fields unchanged: `id, timestamp, type, severity, propertyId, tenantId,
actor, source, title, description, metadata, relatedEvidenceIds,
relatedInvoiceIds, relatedDisputeIds, derivedStateVersion`.

## 5. Extensible event-type registry (the architecture that matters)

So future modules become **timeline events instead of separate systems**, v1
introduces a small registry mapping a `type` (or manual `category`) to its
display + source:
```
PropertyTimeline.registerType('maintenance', {
  label: 'Maintenance', icon: '🔧', group: 'manual', source: 'manager'
});
// future: registerType('cam_reconciled', {label:'CAM', icon:'📊', group:'cam', source:'system'})
//         registerType('dispute_created', ...), ('settlement_completed', ...), ('acquisition_*', ...)
```
- The renderer reads label/icon/group from the registry, so **adding a module =
  registering a type + emitting `appendPropertyTimelineEvent`** — no renderer
  changes. This is how CAM, disputes, payments, acquisitions, and AI
  recommendations later flow into the same timeline.
- MVP seeds the registry with the existing auto types (so today's demo events
  keep rendering) plus the manual categories: `note`, `maintenance`, `inspection`,
  `communication`, `payment`, `other`.

---

## 6. UX

### 6.1 Placement
Keep the collapsible panel where activity already lives —
`#propertyActivitySlot` in `#wsPane-overview` — renamed **"Property Timeline."**
No new route; Christy finds it where it was. (Promotion to its own workspace tab
stays a post-feedback option.)

### 6.2 Add-entry flow (the new core)
A **"+ Add to timeline"** button in the panel header opens a modal:
```
┌ Add to timeline ─────────────────────────────┐
│ Date        [ 2026-07-23        ]             │
│ Category    [ Maintenance ▾ ]                 │
│ What happened  [ Roof leak patched — Bldg C ] │
│ Notes (optional) [ Vendor: PavePro. Temp …  ] │
│ Responsibility  ( ) Landlord (•) Tenant       │
│                 ( ) Shared   ( ) N/A          │
│ Lease reference (optional) [ §7.2 Roof … ]    │
│ Attachments  [ + Invoice ] [ + PDF ] [ + Photo ]│
│              • pavepro-invoice.pdf  ✕          │
│              • roof-before.jpg      ✕          │
│                       [ Cancel ]  [ Save ]     │
└───────────────────────────────────────────────┘
```
On **Save**: upload any attachments via `uploadInvoiceFile()` → collect
`{name,url,kind}` → `appendPropertyTimelineEvent(prop, { manual:true, type:'manual_'+category, category, title, description, timestamp:date, responsibility, leaseRef, attachments, actor:'Property Manager' })` → `savePropertyData()` → re-render.

### 6.3 Entry anatomy (chronological view)
```
── Wed, Jul 23, 2026 ─────────────────────────────
 🔧 Maintenance   Roof leak patched — Bldg C        [Tenant]
    Vendor: PavePro. Temporary patch; permanent fix quoted.
    §7.2 Roof & Structure
    📎 pavepro-invoice.pdf   🖼 roof-before.jpg
    Jul 23, 2026 · Property Manager
```
- **Responsibility badge** — `Landlord` / `Tenant` / `Shared` (color-coded);
  hidden when `na`.
- **Lease-ref chip** — shown when present.
- **Attachments** — photos as thumbnails, invoices/PDFs as click-to-open chips
  (open the file URL; PDFs can route to the Evidence Viewer in a later increment).
- Auto-events (existing demo/system events) render in the same list via the
  registry, unchanged in meaning.

### 6.4 States & honesty
- **Empty:** existing empty state, plus the **+ Add to timeline** button so an
  empty property invites the first entry.
- **Attachment upload fails:** the entry still saves; the attachment shows a
  "couldn't upload" note rather than silently dropping — never pretend a file was
  stored.
- **Truncation stated:** keep "Showing N of M".

### 6.5 Mobile
Day-grouped list stacks; modal is full-width; attachment chips and the add
button wrap (reuse the `flex-wrap` pattern). No horizontal scroll at 390px.

---

## 7. Implementation plan (small, reversible increments)

1. **Schema** — extend the entry in `appendPropertyTimelineEvent` (additive).
2. **Module `property-timeline.js`** — registry, `openAddEntry(property)` modal,
   attachment upload (reuse `uploadInvoiceFile`), save + re-render. Keeps new
   complexity out of `script.js` and is where future types register.
3. **Render** — enhance `renderPropertyActivity`: day grouping, registry-driven
   label/icon, responsibility badge, lease-ref chip, attachments, and the
   **+ Add to timeline** button.
4. **Include** `property-timeline.js` in `index.html` after `script.js`.
5. **Verify** with a local Playwright harness (mocked Supabase): add a manual
   entry, assert it renders with responsibility + lease ref + attachment, and
   that `property.timeline` carries the new fields.

Blast radius: one additive schema edit, one enhanced render function, one new
module, one script include. Existing auto-event rendering preserved.

## 8. Test plan
- Extend `test-timeline.js` (unit): schema defaults for new fields; registry
  lookup; day-grouping helper.
- Extend `test-e2e-activity-timeline.js` (Playwright): open the add-entry modal,
  save an entry with a responsibility + lease ref + a (mocked) attachment, assert
  the row renders and persists in `property.timeline`.
- Mobile 390px: modal + list no horizontal scroll.

---

## 9. Continue the feedback loop (Phase 2)
Ship this MVP to pilot; Christy uses it in a real workflow. If she finds a better
shape — different categories, a responsibility she needs that we didn't model,
edit/delete, week grouping — **we adjust while still in pilot.** Promotion to
`main` happens only once it's polished and proven.

Open questions to watch as she uses it:
- Are the six categories right, or does she think in different buckets?
- Does she need to **edit/delete** an entry (likely yes — fast follow)?
- Is a **photo thumbnail** enough, or does she want a lightbox?
- Should responsibility ever be **per-attachment** or is per-entry enough?

---

_Principle check — every MVP piece reuses an existing system (event store,
persistence, upload, render) and serves "remember & retrieve." The registry makes
this the spine future modules plug into, so the timeline becomes the connective
tissue of the product rather than one more isolated view._
