# Release Notes — v0.8-tenant-dispute-stable

**Branch:** `claude/review-main-street-yVU0j`
**Tag:** `v0.8-tenant-dispute-stable`
**Commit:** `71891fb`
**Date:** 2026-05-26

---

## Summary

This release stabilizes the tenant dispute persistence pipeline end-to-end. Tenant disputes
submitted from the tenant portal now correctly persist to Supabase and appear on the landlord
side after a hard refresh. Three independent bugs in the write, save, and merge paths were
identified and fixed. Normalized evidence/audit tables were also introduced and hardened.

---

## Fixes

### 1. `activePropId` not set in tenant portal (`c9576d8`)

**Root cause:** `_initTenantPortal()` loaded property data via `loadPropertyData()` but never
set `activePropId` or added the property to `_props`. Every downstream write function
(`savePropertyData()`, `appendReviewAuditEntry()`, `_writeTenantReviewAudit()`) guards on
`if (!activePropId) return` — all silently returned without writing anything.

**Fix:** After a successful `_loadTenantPropertyData()` call, `_initTenantPortal()` now sets:
- `activePropId = data.id`
- `window._tenantPortalPropId = data.id`
- Pushes `data` into `_props` if absent

---

### 2. Three data-destruction bugs in `savePropertyData()` during tenant mode (`71891fb`)

**Root cause:** `renderProperty()` is never called in tenant mode, so the global working arrays
(`disputes[]`, `activityLog[]`, `lastResults`, `invoiceData`) all start at their defaults (empty).
The unconditional save assignments overwrote stored property data with empty state:

| Assignment | Effect in tenant mode |
|---|---|
| `prop.results = lastResults.length ? {...} : null` | Wiped CAM reconciliation results |
| `prop.disputes = Array.from(disputes)` | Replaced all prior disputes with only the new one |
| `prop.activityLog = [...activityLog]` | Lost all prior activity log entries |
| `prop.invoices = Array.from(invoiceData)` | Would have wiped all invoices (fixed earlier) |

**Fixes:**
- **Results:** `prop.results = lastResults.length ? {...} : (prop.results ?? null)` — preserves
  existing results when the session has not computed new ones.
- **Disputes + activityLog:** `_initTenantPortal()` now seeds `disputes[]` and `activityLog[]`
  from the loaded property data before any dispute is submitted, so `Array.from(disputes)` on
  save contains existing + new entries rather than only the new entry.
- **Invoices:** `if (invoiceData.length > 0) prop.invoices = ...` — skips the overwrite when
  `invoiceData` is empty (guards against invoice list being wiped).

---

### 3. Dispute lost on landlord reload — merge path bug (`71891fb`)

**Root cause:** `loadPropertyData()` chose between `lsData` (landlord localStorage) and `dbData`
(Supabase) as the merge base by tenant count. When the landlord's localStorage had ≥ tenants as
Supabase, `lsData` won as `base` — and `disputes` came from `lsData` which had no record of the
tenant's dispute (submitted from a different session/device).

**Fix:** `disputes` is now always resolved as the union of DB disputes (authoritative source) plus
any LS-only entries not yet in DB (safety net for network failures during save):

```js
const _dbDisps     = dbData.disputes || [];
const _lsDisps     = lsData.disputes || [];
const _lsOnlyDisps = _lsDisps.filter(d => !_dbDisps.some(dd => dd.id === d.id));
const _mergedDisps = [..._dbDisps, ..._lsOnlyDisps];
```

This mirrors the existing pattern for `results` and `camReconciliation` which already preferred
Supabase as authoritative.

---

### 4. `nextDisputeId` not seeded in tenant portal (`71891fb`)

**Root cause:** `nextDisputeId` starts at 0 in tenant mode. Disputes pushed with id=0 would
collide with any existing dispute already stored.

**Fix:** `_initTenantPortal()` now seeds `nextDisputeId` from the loaded disputes list, matching
the landlord-side seeding in `renderProperty()`.

---

### 5. RLS policy rendering corruption fixed (`77be9d2`)

**Root cause:** The SQL migration's RLS policies used alias dot-notation (`p.id`, `prop.id`)
which the chat renderer mangled into `<p.id>` / `<prop.id>` when copy-pasted into Supabase SQL
Editor, producing `ERROR: 42601: syntax error at or near "<"`.

**Fix:** All four RLS policy bodies were rewritten to use an `IN` subquery with no alias
dot-notation:

```sql
property_id in (
  select id from public.properties
  where user_id = auth.uid()
)
```

---

### 6. Normalized evidence/audit tables (`4833d51`, `77be9d2`)

Two new Supabase tables introduced with dual-write architecture:

- **`tenant_field_evidence`** — immutable append-only per-field extraction provenance snapshots.
  Dedup constraint: `(tenant_id, field_key, reviewed_at)`.
- **`tenant_review_audit`** — structured audit trail of reviewer actions (field overrides,
  confirmations, disputes). Dedup constraint: `(tenant_id, action, client_ts)`.

Both tables have RLS policies gating access to the authenticated property owner. Both are
written on every review action alongside the existing JSON blob in `properties.data` (dual-write
phase — JSON blob remains authoritative until Phase 2 read migration). Feature flags
`window.ms_useNormalizedEvidence` and `window.ms_useNormalizedAudit` control the read path.

Backfill utilities available: `await ms_backfillEvidence()`, `await ms_backfillAudit()`.

---

## Diagnostic Tooling Added

All diagnostic tooling is temporary and can be removed post-stabilization.

| Global | Purpose |
|---|---|
| `window.ms_lastDualWrite` | State of last normalized table write (evidence + audit) |
| `window.ms_lastDisputeFlow` | State of last dispute submission attempt |
| `window.ms_dumpDualWrite()` | Mobile-safe JSON summary of last write — paste without DevTools |
| `window.ms_debug_dualwrite()` | Fire test inserts into both normalized tables + read back |
| `window.ms_testAuditInsert()` | Insert a known audit row, read it back, verify property ownership |
| `window.ms_debugDualWriteUI = true` | Show floating dual-write status pill (AUTH/PROP/TFE/TRA) |
| `window.ms_debugDisputeUI = true` | Show floating dispute-flow badge (AUTH/PROP/WRITE/AUDIT) |
| `window._tenantPortalPropId` | Property ID hydrated by tenant portal init |

---

## Files Changed

| File | Change |
|---|---|
| `script.js` | All application fixes and diagnostic instrumentation |
| `migrations/002_evidence_audit_tables.sql` | New: normalized evidence/audit table migration |
| `RELEASE_NOTES.md` | This file |

---

## Verification Checklist

- [ ] Tenant logs in with `user_metadata.property_ids` set → portal shows property card
- [ ] `window.ms_debugDisputeUI = true` → PROP badge shows `✓ <uuid-prefix>` immediately
- [ ] Tenant submits a dispute → no alert, `WRITE ✓` appears in badge
- [ ] Landlord hard-refreshes → dispute visible in open disputes panel
- [ ] `[LANDLORD disputes]` log in console shows `dbDisputesLen > 0` at merge and renderProperty
- [ ] CAM reconciliation results survive a tenant dispute save (not wiped)
- [ ] Invoice list survives a tenant dispute save (not wiped)
- [ ] `await ms_testAuditInsert()` → prints `INSERT OK — id: <uuid>`
