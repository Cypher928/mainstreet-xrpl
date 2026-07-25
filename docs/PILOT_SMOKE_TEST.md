# Pilot Environment — Smoke Test

_Snapshot of what's verified vs. remaining for the pilot customer-validation
environment. Re-run the code checks any time with the commands noted below._

## ✅ Passing — verified in code / deploy

| # | Check | How verified |
|---|---|---|
| 1 | **Production untouched** — `main` still at `a6d0437`; all pilot work on `pilot` branch | `git log origin/main` |
| 2 | **Client routes by host** — production domain → prod project; localhost + every `*.vercel.app` preview (incl. pilot) → pilot; lookalike hosts → pilot (fail-safe) | `supabase-config.js` unit test, 5/5 |
| 3 | **Server routes by `VERCEL_ENV`** — production → prod env vars + mainnet (unchanged); preview → pilot project + testnet, never the prod secret | `api/_pilot-target.js` unit test, 2/2 |
| 4 | **All 9 serverless functions parse**; no stray `process.env.SUPABASE_*` outside the resolver | `node --check`, grep |
| 5 | **Migration bundle complete** — base schema `000` + migrations `001–009` + public storage buckets | bundle scan |
| 6 | **Pilot project wired** in both client and server (real values, not placeholder) | grep + routing test shows `configured` |

## ✅ Passing — verified live (from deploy + screenshots)

| # | Check | Evidence |
|---|---|---|
| 7 | Pilot branch **auto-deploys and is Ready** (`c2ac21c`) | Vercel Deployments |
| 8 | Pilot **site loads** at the pilot `*.vercel.app` URL (landing page renders) | browser |
| 9 | **Sign-up reaches the PILOT database** — the "email rate limit" came from the pilot Supabase project, proving client↔pilot auth is live and isolated | browser |

## ✅ Isolation guarantees

- Mainnet `XRPL_SETTLEMENT_WALLET_SEED` + `_ADDRESS` re-scoped to **Production only** → not present in the pilot runtime.
- Settlement endpoint is **read-only** and loads no seed → pilot cannot move funds.
- Pilot XRPL network = **testnet**.

## ✅ Now complete (live-confirmed)

| Item | Status |
|---|---|
| **A. Email confirmation disabled** in pilot Supabase | ✅ done — sign-up logs straight in |
| **B. `PILOT_SUPABASE_SERVICE_ROLE_KEY`** set (Preview) to the pilot `sb_secret_…` key | ✅ done — pilot redeployed to pick it up |
| **C. Schema confirmed in DB** — all 8 tables present in the pilot Table Editor | ✅ verified |
| **Live: login → app** on the isolated pilot DB | ✅ account created, dashboard loads |
| **Live: property persists** — `properties` shows Cascade Commons | ✅ verified in Table Editor |
| **Live: CAM reconciliation saves to server** ("✓ CAM Reconciliation Complete", no error) | ✅ verified |

### Root cause of the earlier "CAM results weren't saved" (resolved)
An **API/auth issue**, not migration or RLS policy. The pilot's service-role key
is the new `sb_secret_…` format; the save endpoint needs a working service-role
key to bypass RLS in `_ownsProperty` (api/cam-reconciliations.js:96). Setting
`PILOT_SUPABASE_SERVICE_ROLE_KEY` to the correct **secret** key (not the
publishable key) and redeploying the pilot fixed it.

## Still worth a quick live check when convenient (optional)
- File upload → lands in the **pilot** storage bucket (uses the same service-role path — expected to work now).
- AI features (`Ask AI` / explain) against the pilot project.
- Settlement panel reads **testnet**.

## Bottom line
**The pilot is operational and isolated:** login, property persistence, and CAM
reconciliation all run on the pilot database; production is untouched. Remaining
checks are optional confirmations, not blockers.

---

## Pilot Completion Branch — verification (final)

### P1 · Property Memory — complete event coverage
All four workflow emitters are wired and registered:

| Event | Source | Idempotency |
|---|---|---|
| `cam_reconciled` | reconciliation complete | per run |
| `document_uploaded` | `saveLeaseDocument()` for property-level docs (lease flows already emit `lease_uploaded` — no duplicate) | `doc:<propertyId>:<fileName>` |
| `reserve_updated` | escrow extraction commit | `reserve:<labels>:<files>` |
| `settlement_completed` | first observation of a settled `txHash` (settlement executes out-of-band; the app observes it) | `settlement:<txHash>` |

Every emitter routes through `appendPropertyTimelineEventOnce()`, which stores a
`metadata.dedupeKey` so re-running a flow, re-rendering, or reloading cannot
duplicate history. Verified: a settlement observed three times records **once**;
the demo property's own settlement is auto-recorded on render.

### P2 · Evidence cross-linking
Timeline event → Evidence Viewer → document → page → highlighted language.
Resolution uses only the existing adapters (`EvidenceViewer.fromTenantField`,
`fromReserve`), so a citation appears **only when real extracted evidence
exists**. Verified: with no stored evidence the resolver returns `null` (never a
fabricated citation) and the row falls back to the record; with evidence it
resolves to the source document at the cited page with the verbatim quote.

### P3 · Disputes in the Space
A read-only surface: status, last activity, amount, and a link into the existing
dispute workspace. Verified that the dispute **workflow is not duplicated** in
the Space.

### P4 · Timeline reliability — the "Timeline 0" investigation
**Not reproducible.** On a fresh seed, measured across the whole demo property:

- 21 timeline events, 10 tenant-tagged
- **0 orphaned events** (every tagged event resolves to a live space)
- **0 spaces showing zero** — all five resolve their events

**Conclusion: stale persisted demo data, not missing event generation.** The
pilot's demo property was written to the pilot database under `_demoV: 7`, and
`ensureDemoProperty()` deliberately skips re-seeding an existing demo row — so a
row written before the current tenant-id derivation keeps its old ids, and
scoped lookups find nothing.

**Mitigation shipped:** `_scopedEvents()` now also matches a space by the
subject's recorded label, so events stay attached to the right space even if
tenant ids drift. A permanent assertion fails the suite if any space shows zero
events while tagged events exist.

**To confirm on the pilot:** open a space and check the Timeline count. If it
still reads 0, delete the demo property (it re-seeds on next load) — that
distinguishes stale data from a live defect.
