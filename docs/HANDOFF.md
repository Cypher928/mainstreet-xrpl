# Hand-off — current state

**Updated:** 2026-10-05 (after commits A, D, B, the test-reference fix and C; the Vercel environment separation and Pilot redeploy; and the XRPL network guard commit).
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
| Vercel (Pilot site) | project `mainstreet-xrpl` | **verified 2026-10-05:** every push to `pilot` deploys automatically as a Preview, and `www.mainstreet-review.com` follows the newest `pilot` deployment; Production is `main` → `www.mainstreetcam.com`. Serving `892bd0a` (redeployed 2026-10-05 as `dpl_2E73gK9gtaGcZvPrbhqdHWKzD2Et`). Environment separated 2026-10-05: the Production wallet seed/address and Production `SUPABASE_*` are Production-only; Preview has `XRPL_NETWORK=testnet` and no wallet. The ledger endpoints are **not deployed** | deploy only on approval |
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
| GL parser (`gl-import.js`) | yes | 142/142 (`test-gl-import.js`, re-run 2026-10-04 before commit B), in regression | **yes, `30fb242`** (commit B) | **no** | n/a | n/a | n/a | n/a | no |
| Ledger endpoints (`api/_ledger-*.js`, `?op=` in `api/upload.js`) | yes | 68 endpoint + 22 concurrency checks against a **local stand-in** of Storage/PostgREST/GoTrue (re-run 2026-10-04 before commit B); Bulk Intake scope suite 86/86 | **yes, `30fb242`** | **no** | **no — never run on Vercel** | n/a (needs 046) | no | **no** | no |
| Migration 046 acquisition general ledger | yes | verifier 130/130; mutation 60/60 non-equivalent mutants killed, 1 equivalent (L08) — both re-run 2026-10-04 before commit B (logs in scratchpad `phase6/commitB/`) | **yes, `30fb242`** (file md5 `5c8af9624927c3c275d46526bfc4c05f`, 56,369 bytes; rollback md5 `74dd6285912cb5725f808434b181b766`) | **no** | n/a | **no** | no (no live matrix yet) | n/a | no |
| Migration 047 remaining member write rules | yes | verifier 76/76 on PG 16.13 and 17.6; mutation 21/21 killed (re-run 2026-10-05, logs in scratchpad `phase6/commitC/`) | **no** (proposed commit C, awaiting approval) | no | n/a | **no** | no (no live matrix yet) | n/a | no |
| Migration 048 operating tables | yes | verifier 50/50 on PG 16.13 and 17.6; mutation 21/21 killed (re-run 2026-10-05) | **no** (proposed commit C) | no | n/a | **no** | no (no live matrix yet) | n/a | no |
| Full regression (`node test-regression.js`) | — | **2026-10-05, after the test-fix commit `8fb42e8` (257 suites): 251 passed, 6 failed = the six pre-existing baseline failures only.** Between commit B and that fix the gate read 249 passed, 8 failed (see §6) | — | — | — | — | — | — | — |

Locally tested means throwaway PostgreSQL clusters and local stand-ins. The only
live verification of any kind so far is the 045 rolled-back SQL matrix, which is
live database verification. None of the Phase 2/3 code has been exercised on
Vercel, against the deployed API, or in a browser.

## 5. Outstanding

1. **Phase 2/3 work and the XRPL guard are committed, locally:** A (045 and
   its tests, `0317644`), D (the documentation, `e47a504`), B (GL parser, 046,
   ledger endpoints, §7d; `30fb242`), the test-reference fix (`8fb42e8`), C
   (047, 048; `979306a`) and the XRPL network guard (the commit carrying this
   line).
2. **Decide about pushing `pilot`** (the seven commits above). A push to
   `pilot` **does** deploy the Pilot site automatically (verified 2026-10-05),
   and it runs the two CI gates that write disposable fixtures to Pilot (red
   at `origin/pilot` for pre-existing reasons). After a push the ledger
   endpoints would exist on Vercel without deployed API verification.
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
- **Fixed in `8fb42e8` (2026-10-05, test plumbing only):** two of commit B's
  own tests failed once B was committed, because both took `git show
  HEAD:api/upload.js` as the "before the ledger operations" reference, and
  after `30fb242` HEAD already carries them (`tools/verify-ledger-import-endpoint.js`
  §9 at 67/68; `test-bulk-intake.js` 9.2a at 85/86). Both now read the
  reference from `e47a504`, the last commit before the ledger work; its
  `api/upload.js` is byte-identical to the file on `origin/pilot` and the six
  approved hunks map it exactly onto HEAD's. No application file changed.
- The 045 migration file header still says "NOT APPLIED"; it is left as is on
  purpose, because the committed file must stay byte-identical to the text
  Pilot recorded and the approval vouches for. The record of the apply is
  `migrations/APPLIED.md` fact 17 and this file.
- **Open on `storage.objects`, not closed by 046, 047 or 048 (unresolved, not
  claimed otherwise):**
  (a) *Grants.* In the 2026-10-04 Pilot snapshot `anon` and `authenticated` hold
  every table privilege on `storage.objects` and `storage.buckets`. No policy on
  `storage.objects` names `anon`, so with row security on (Supabase's default;
  the snapshot's row-security lines cover `public` only, so this was not
  re-read) the grant is latent rather than exploitable through the API — the
  same shape the 047/048 tables had before those migrations. 047 does not
  revoke it; a separate small migration would.
  (b) *Ownership.* 011 recorded that `alter table storage.objects enable row
  level security` failed with "must be owner of table objects", yet the 011 and
  024 policies on that table were accepted on Pilot, and 046 and 047 each
  create more. Whether the migration role may create a trigger there (the only
  way to guard against a service-key overwrite) is unknown until the read-only
  queries listed in `docs/ACQUISITION_REVIEW.md` §7e are run on Pilot. Until
  then 046's integrity check detects a replaced original; nothing prevents one.
- The composite-key authorship limitation above.
- The ledger endpoints' Vercel behaviour (request object, 30 s limit) is
  untested.
- **Pilot on XRPL mainnet — found and closed 2026-10-05.** The Pilot site
  showed "live on XRPL mainnet" and linked the Production settlement wallet,
  because `XRPL_NETWORK=mainnet` and the wallet address and seed were scoped to
  Preview as well as Production, and the code used testnet only as a fallback.
  No funds could move (the endpoint is read-only and no deployed code reads the
  seed). Closed in two layers: the Vercel scoping above, and in code (the
  guard commit) — `api/_pilot-target.js` pins non-production to testnet
  whatever `XRPL_NETWORK` says, and the settlement UI names only the network
  the server reports, saying "not configured" when there is no wallet.
  `test-xrpl-network-guard.js` pins both. Until that commit is pushed and
  deployed, the live Pilot page still carries the old hand-written "XRPL
  Mainnet" copy (the server side is already testnet through the Vercel change).

## 7. Next approved action

**Nothing is currently approved beyond keeping this hand-off accurate.** Seven
commits are done, locally, on `pilot`, and none is pushed: `54fecd4` (migration
tooling), `0317644` (A, 045), `e47a504` (D, documentation), `30fb242` (B, GL
parser, 046, ledger endpoints), `8fb42e8` (test-reference fix), `979306a` (C,
047 and 048, NOT applied) and the XRPL network guard (the commit carrying
this text). On 2026-10-05 the Vercel environment was separated and the Pilot
site was redeployed at the same commit `892bd0a`.

**Next proposed action, awaiting Lynn's approval:** push `pilot`. That deploys
the Pilot site automatically and runs the two Pilot CI gates. Afterwards: read
the new deployment's commit through Vercel, and Lynn checks in a browser that
the settlement panel says "not configured … XRPL Testnet" and that an ordinary
lease upload still works.

Approval of a push would authorise that push and nothing else. Any migration
(046, 047, 048), live matrix, Production change, CI-gate change, Pilot testnet
wallet, the Pilot-marker guard for the committed 045 and 046 rollbacks, and
Option B each need their own specific approval.
