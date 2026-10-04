# Hand-off — current state

**Updated:** 2026-10-04 (after the 045 Pilot apply, the reconciliation review and commit A).
**Rules:** `docs/WORKING_AGREEMENT.md`. **Migrations:** `docs/MIGRATION_RUNBOOK.md`
and `migrations/APPLIED.md`. **History and detail:** `docs/ACQUISITION_REVIEW.md`
(kept as written; this file is canonical when the two disagree).

States used below, and never conflated (`docs/WORKING_AGREEMENT.md` rule 5):
*implemented* (code exists locally); *tested locally* (verifier / mutation /
regression on throwaway databases and local stand-ins); *committed*; *pushed*;
*deployed* (Vercel); *applied* (to the named database); *live DB verified* (SQL
against the live database, including a rolled-back matrix — proves what the
database enforces, nothing about the application); *deployed API verified*
(requests against the deployed endpoints); *browser verified* (the workflow
exercised end to end in the live application).

## 1. Product direction

MainStreet is the owner-operator's lease, CAM and acquisition workspace on the
Pilot site (www.mainstreet-review.com). The current programme is **Financial
Intake, increment one**: a general ledger CSV imported against an acquisition
document from its stored original, and the permissions hardening that makes
member roles mean what they say (members read; only people who may edit write).
The browser side of the import is deliberately not built yet.

## 2. Environments and boundaries

| environment | ref | status | who may change it |
|---|---|---|---|
| **Pilot** Supabase (`mainstreet-pilot`) | `bhmktujbxdbvdmpybmad` | the only target for approved Pilot migrations; read-only inspection through the Supabase connector | a migration only with Lynn's written approval of the exact file, applied by the runbook procedure |
| **Production** Supabase | `zhsuhehgehbzkmzurzyf` | **protected and separate; never accessed, migrated, changed or deployed to in this programme** | nothing, without explicit, specific approval naming Production |
| Vercel (Pilot site) | — | believed to deploy from `pilot` (**unverified in this session**); the ledger endpoints are **not deployed**. A push to `pilot` *may* trigger a deployment: the Vercel branch and deployment configuration must be verified, read-only, before any push | deploy only on approval |
| Claude's cloud environment | — | no Supabase token, `api.supabase.com` denied by network policy; "Option B" (token + allow-list) is documented in the runbook and **not configured** | Lynn, in the environment settings |

Every migration file refuses to run unless the Pilot marker property exists;
every migration tool hard-codes the Pilot ref and refuses any other.

## 3. Pilot database state (last read-only check)

**Read 2026-10-04 21:09:52 UTC**, through the Supabase connector, read-only:

- 45 migration rows; newest `20261004184427 045_acquisition_member_write_rules`.
- 045 recorded once; recorded text md5 `5ee571956613b4cf0beab2a36bbbcd2b`,
  sha256 `39311540…ffd6d656`, 19,462 bytes = the file in `migrations/` and the
  approval `tools/migrate/approvals/045_….approval`; idempotency key
  `82ffaede-02cb-497e-9bd5-ab8f1d490b87`.
- Nothing from 046, 047 or 048 recorded or present (functions, tables,
  policies all absent).
- Catalog fingerprint `1388 64950c2ba9d3ef2e676054f51d19c8b1` (post-045 value,
  unchanged since 18:45 UTC); every data hash at its pre-045 baseline (no row
  changed by 045 or by the live matrix, which was rolled back).
- Evidence: `tools/migrate/live-matrix/045_*.result.txt`, the inventories
  beside it, `migrations/APPLIED.md` fact 17, and the session notes under the
  scratchpad `phase6/` folder (not in the repository).

Anything read after that time is **unverified** until the next read-only check.

## 4. Work and its state

| piece | implemented | tested locally | committed | pushed | deployed | applied to Pilot | live DB verified | deployed API verified | browser verified |
|---|---|---|---|---|---|---|---|---|---|
| Migration tooling and runbook (`tools/migrate/`, `docs/MIGRATION_RUNBOOK.md`) | yes | 28 + 25 offline checks | **yes, `54fecd4`** | **no** | n/a | n/a | n/a | n/a | n/a |
| Migration 045 member write rules | yes | 136/136 on PG 16 and 17.6 (re-run before the commit); mutation harness | **yes, `0317644`** (file byte-identical to the applied text, blob `42f0f046`) | **no** | n/a | **yes, 2026-10-04 18:44:27Z** | **yes**: 46-check rolled-back matrix, 2026-10-04 (`tools/migrate/live-matrix/`) | n/a (no endpoint) | **no** |
| GL parser (`gl-import.js`) | yes | `test-gl-import.js`, in regression | no | no | n/a | n/a | n/a | n/a | no |
| Ledger endpoints (`api/_ledger-*.js`, `?op=` in `api/upload.js`) | yes | 68 endpoint + 22 concurrency checks against a **local stand-in** of Storage/PostgREST/GoTrue | no | no | **no — never run on Vercel** | n/a (needs 046) | no | **no** | no |
| Migration 046 acquisition general ledger | yes | verifier; mutation 58/60 in the saved run + the 2 re-based mutants killed 2026-10-04 (log in scratchpad `phase6/`) | no | no | n/a | **no** | no (no live matrix yet) | n/a | no |
| Migration 047 remaining member write rules | yes | 76/76; mutation 21/21 | no | no | n/a | **no** | no (no live matrix yet) | n/a | no |
| Migration 048 operating tables | yes | 50/50 on PG 16 and 17.6; mutation 21/21 | no | no | n/a | **no** | no (no live matrix yet) | n/a | no |
| Full regression (`node test-regression.js`) | — | 251 suites passed, 6 failed = the same six pre-existing baseline failures (saved log, 2026-10-04 14:15 UTC) | — | — | — | — | — | — | — |

Locally tested means throwaway PostgreSQL clusters and local stand-ins. The only
live verification of any kind so far is the 045 rolled-back SQL matrix, which is
live database verification. None of the Phase 2/3 code has been exercised on
Vercel, against the deployed API, or in a browser.

## 5. Outstanding

1. **Commit the rest of the Phase 2/3 work** in the agreed grouping: B (GL
   parser, 046, ledger endpoints), C (047, 048), D (this documentation). A
   (045 and its tests) is committed as `0317644`.
2. **Decide about pushing `pilot`** (`54fecd4`, `0317644` and the commits to
   come). A push *may* trigger a Vercel deployment of the Pilot site; the actual
   Vercel branch and deployment configuration must be verified, read-only,
   before any push. If a push does deploy, the ledger endpoints would exist on
   Vercel without deployed API verification.
3. **Live matrices for 046, 047, 048** (`tools/migrate/live-matrix/<name>.sql`),
   required by the runbook before each apply.
4. **046 apply** — needs its own approval; then a real import with one small
   synthetic CSV on a test property, and reversal.
5. **Browser side of the import** (preview, date-order prompt, history view,
   Reverse button) — not started.
6. **pg_cron** for `run_ledger_maintenance()` — available on Pilot, not
   installed; a configuration change needing approval.
7. **Bucket `file_size_limit`** (none set) and **anon ALL on
   `storage.objects`/`storage.buckets`** (not revoked by 047) — candidates for a
   small later migration.
8. **Deferred authorship migration**: the composite keys
   `(review_id, user_id) → acquisition_reviews(id, user_id)` mean a non-owner
   cannot file documents, families or decisions on another's review by any
   path (045 fact 17).
9. **Option B** (environment token + allow-list) — a separate decision.

## 6. Known defects and limitations

- Six regression suites fail at baseline, predating this work: Demo showroom
  (populated cabinet), Live extraction walk, Billing readiness consistency,
  Ask AI intent coverage, Unbilled pool, Broken promises (dead controls). The
  regression run therefore exits red even when everything new passes.
- The 045 migration file header still says "NOT APPLIED"; it is left as is on
  purpose, because the committed file must stay byte-identical to the text
  Pilot recorded and the approval vouches for. The record of the apply is
  `migrations/APPLIED.md` fact 17 and this file.
- The composite-key authorship limitation above.
- The ledger endpoints' Vercel behaviour (request object, 30 s limit) is
  untested.

## 7. Next approved action

**Current approved scope (before commit D): review of this documentation and of
the Phase 2/3 commit plan.** Commit A (045 and its tests, `0317644`) is done and
accepted. Nothing else is authorised.

Committing this documentation (commit D), when Lynn approves it, authorises
nothing further. Commits B and C, any push of `pilot`, any deployment, Migration
046 and Option B each require their own specific approval. Once D is committed,
this section is updated to name the next specific action, which will itself
still require Lynn's approval before anything is done.
