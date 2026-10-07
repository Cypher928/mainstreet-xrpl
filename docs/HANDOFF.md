# Hand-off — current state

**Updated:** 2026-10-07 (after the 015c completion commit was pushed and both CI gates passed on it, B1 66/66 for the first time since 015b; the CI fixture organisation leak was found, fixed in `8395f41` and pushed, and the 88 orphan organisations it had left on Pilot were removed by a one-off, verified cleanup, 101 → 13; earlier that day 015c applied to Pilot and verified; 2026-10-06: 048 applied and verified, its completion commit and four test-only fixes pushed, the Pilot live verification gate green again; 2026-10-05: 047 applied and verified, its completion commit pushed, the CI test fix committed locally; earlier that day: commits A, D, B, the test-reference fix and C, the Vercel environment separation and Pilot redeploy, and the XRPL network guard commit).
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
| Vercel (Pilot site) | project `mainstreet-xrpl` | **verified 2026-10-05:** every push to `pilot` deploys automatically as a Preview, and `www.mainstreet-review.com` follows the newest `pilot` deployment; Production is `main` → `www.mainstreetcam.com`. `origin/pilot` is `8395f41` (pushed 2026-10-07 02:49:06Z, after `34f4ed5` at 00:49:48Z the same day); its automatic deployment `dpl_HFgLY61smztXgGCqoZi5agkwjviA` was read back READY (ready 02:49:26Z), serving `8395f412`, aliased to `www.mainstreet-review.com` and `mainstreet-xrpl-git-pilot-cypher928s-projects.vercel.app`. Environment separated 2026-10-05: the Production wallet seed/address and Production `SUPABASE_*` are Production-only; Preview has `XRPL_NETWORK=testnet` and no wallet. The ledger endpoints are **not deployed** | deploy only on approval |
| Claude's cloud environment | — | no Supabase token, `api.supabase.com` denied by network policy; "Option B" (token + allow-list) is documented in the runbook and **not configured** | Lynn, in the environment settings |

Every migration file refuses to run unless the Pilot marker property exists;
every migration tool hard-codes the Pilot ref and refuses any other.

## 3. Pilot database state (last read-only check)

**Read 2026-10-07 02:50:59 UTC** (after both CI gates had run on `8395f41`), through the Supabase connector, read-only:

- 48 migration rows; newest `20261007003020 015c_tenant_invitations_service_insert`.
- 015c recorded once; recorded text md5 `886a689c5e5445b4a9986eccd44f5743`,
  sha256 `a8fdf8b9…`, 3,877 bytes = the file in `migrations/` and the approval
  `tools/migrate/approvals/015c_….approval`; idempotency key
  `0fa8cc70-bb85-48c0-a023-c2f83f627781` (`check-record.js`: VERIFIED). 045, 047
  and 048 unchanged.
- Nothing from 046 recorded or present.
- `tenant_invitations`: `service_role` holds INSERT, SELECT, UPDATE (015c added
  INSERT); `authenticated` and `anon` hold nothing.
- Catalog fingerprint `1398 64458394045bd877f0e1fe5ffdfbb123` (post-015c value,
  exactly what the rolled-back trial predicted; unchanged by everything since — the
  organisation cleanup is a data correction and touched no catalog object); the
  catalog diff against the pre-015c inventory is exactly one privilege row,
  `pri|public.tenant_invitations|service_role`, SELECT,UPDATE → INSERT,SELECT,UPDATE
  (`check-inventory.js`: EXPLAINED); columns, constraints, functions, indexes,
  policies, row-security flags and triggers unchanged.
- **`organizations` 13, `organization_members` 13, orphan organisations 0.** Ids md5
  `faff4c993fce0ebb0c76869dc13b5ed3`, rows md5 `b33b11158cb59059f7929b63085e44ed` —
  the same 13 rows, byte-identical, as before the cleanup; every one has a living
  creator, a membership and a name equal to its creator's email. 101 → 13 on
  2026-10-07 02:16:36Z by the one-off cleanup (§5.2, §6); **not a migration** — no
  migration-history row.
- Every other data hash identical to the pre-015c record (tenants, lease_jobs,
  evidence, audit, CAM, tenant_users/invitations/statements, properties, members,
  property_events, lease_documents, auth.users; digest
  `a536646f90f0320a6315d6071eac8c06`); acquisition 12/16/12/40/0, ledger 0/0,
  storage objects 199. No fixture residue (gate users 0, gate properties 0, debug
  rows 0), no open transactions.
- Evidence: `tools/migrate/live-matrix/015c_*.result.txt` (14 ok, 0 FAIL) and the
  inventories beside it, `migrations/APPLIED.md` fact 20, and the session notes
  under the scratchpad `phase6/apply015c/` and `phase6/trial015c/` folders (not in
  the repository). The 048 evidence is unchanged (`048_*.result.txt`, fact 19). The
  cleanup's evidence is `tools/ci-fixture-orphan-cleanup/pilot-2026-10-07.sql` (the
  exact text run, md5 `d8542491…`) and `pilot-2026-10-07.result.txt` beside it.

Anything read after that time is **unverified** until the next read-only check.

## 4. Work and its state

| piece | implemented | tested locally | committed | pushed | deployed | applied to Pilot | live DB verified | deployed API verified | browser verified |
|---|---|---|---|---|---|---|---|---|---|
| Migration tooling and runbook (`tools/migrate/`, `docs/MIGRATION_RUNBOOK.md`) | yes | 28 + 25 offline checks | **yes, `54fecd4`** | **no** | n/a | n/a | n/a | n/a | n/a |
| Migration 045 member write rules | yes | 136/136 on PG 16 and 17.6 (re-run before the commit); mutation harness | **yes, `0317644`** (file byte-identical to the applied text, blob `42f0f046`) | **no** | n/a | **yes, 2026-10-04 18:44:27Z** | **yes**: 46-check rolled-back matrix, 2026-10-04 (`tools/migrate/live-matrix/`) | n/a (no endpoint) | **no** |
| GL parser (`gl-import.js`) | yes | 142/142 (`test-gl-import.js`, re-run 2026-10-04 before commit B), in regression | **yes, `30fb242`** (commit B) | **no** | n/a | n/a | n/a | n/a | no |
| Ledger endpoints (`api/_ledger-*.js`, `?op=` in `api/upload.js`) | yes | 68 endpoint + 22 concurrency checks against a **local stand-in** of Storage/PostgREST/GoTrue (re-run 2026-10-04 before commit B); Bulk Intake scope suite 86/86 | **yes, `30fb242`** | **no** | **no — never run on Vercel** | n/a (needs 046) | no | **no** | no |
| Migration 046 acquisition general ledger | yes | verifier 130/130; mutation 60/60 non-equivalent mutants killed, 1 equivalent (L08) — both re-run 2026-10-04 before commit B (logs in scratchpad `phase6/commitB/`) | **yes, `30fb242`** (file md5 `5c8af9624927c3c275d46526bfc4c05f`, 56,369 bytes; rollback md5 `74dd6285912cb5725f808434b181b766`) | **no** | n/a | **no** | no (no live matrix yet) | n/a | no |
| Migration 047 remaining member write rules | yes | verifier 76/76 on PG 16.13 and 17.6; mutation 21/21 killed (re-run 2026-10-05, logs in scratchpad `phase6/commitC/`) | **yes, `979306a`** (C); its live matrix and apply records in `396cf29` | yes (`979306a` and `396cf29` are in `origin/pilot`) | n/a | **yes, 2026-10-05 18:30:07Z** (hand-off script, one send, HTTP 200) | **yes**: rolled-back trial on Pilot before the apply (047 + matrix 46/0 + rollback exact), and the 46-check matrix after it, 46 ok / 0 FAIL | n/a (no endpoint) | no |
| Migration 048 operating tables | yes | verifier 50/50 on PG 16.13 and 17.6; mutation 21/21 killed (re-run 2026-10-05); live matrix 64 checks local-tested on both; trial 21/21 on both | **yes, `979306a`** (C); its live matrix and apply records in the 048 completion commit | yes (`979306a` and the completion commit `147e0b5` are in `origin/pilot`) | n/a | **yes, 2026-10-06 13:07:26Z** (hand-off script, one send, HTTP 200) | **yes**: rolled-back trial on Pilot before the apply (048 + matrix 64/0 + rollback exact, 2026-10-06), and the 64-check matrix after it, 64 ok / 0 FAIL | n/a (no endpoint) | no |
| Migration 015c service-role INSERT on `tenant_invitations` (B1 gate fix) | yes | `tools/verify-migration-015b.js` (015b + 015c) 213/213 on PG 16.13 and 17.6; `tools/data-api-grants-mutation.js` 49/49 killed on both (5 new 015c mutants); live matrix 14 checks and trial 26/26 local-tested on both | **yes, the 015c completion commit** (migration, rollback, verifier, mutation harness, matrix, approval and apply records together) | yes, `34f4ed5` (2026-10-07 00:49:48Z); both gates green on it — B1 run 208 66 passed / 0 failed (T17–T21 reached for the first time since 015b), live verification run 289 all suites | n/a | **yes, 2026-10-07 00:30:20Z** (hand-off script, one send, HTTP 200) | **yes**: rolled-back trial on Pilot before the apply (015c + matrix 14/0 + rollback exact + matrix 9/5, 2026-10-06), and the 14-check matrix after it, 14 ok / 0 FAIL | n/a (no endpoint) | no |
| CI fixture organisation teardown (`scripts/b1-ci-fixture.js`, `scripts/pilot-live-fixture.js`) and the one-off orphan cleanup tool (`tools/ci-fixture-orphan-cleanup.js`) — **test and CI code only; no application file, migration, policy or grant** | yes | `test-ci-fixture-teardown.js` 79/79 (both scripts, seven mutants each killed, offline); `tools/verify-ci-fixture-organizations.js` 62/62 on PG 16.13 and 17.6 (leak reproduced from the 024 text, fix, order, predicate vs five decoys, cleanup template's every refusal and its rollback); both in regression | **yes, `8395f41`** | yes (2026-10-07 02:49:06Z) | yes, `dpl_HFgLY6…` READY — incidental: the deployment carries no application change | **n/a — not a migration.** The one-off cleanup ran on Pilot 2026-10-07 02:16:36Z as a data correction: organisations 101 → 13 | **yes**: read-only 02:17:51Z (0 orphans, protected 13 byte-identical, fingerprint and every other hash unchanged) and 02:50:59Z after gate runs 209 and 290, which created and removed one organisation each and left 0 | n/a | n/a |
| Full regression (`node test-regression.js`) | — | **2026-10-07, before the fixture-fix commit `8395f41` (260 suites): 254 passed, 6 failed = the six pre-existing baseline failures only, each on the same assertion as before.** 2026-10-05 after `8fb42e8` (257 suites): 251 passed, 6 failed, the same six. Between commit B and that fix the gate read 249 passed, 8 failed (see §6) | — | — | — | — | — | — | — |

Locally tested means throwaway PostgreSQL clusters and local stand-ins. The only
live verification of any kind so far is the 045, 047, 048 and 015c rolled-back SQL
matrices, which are live database verification, the CI gates' live suites (§5), and
the read-only checks around the organisation cleanup. The cleanup is a data
correction, not a migration: it is recorded here and under
`tools/ci-fixture-orphan-cleanup/`, not in `migrations/APPLIED.md`. None of the
Phase 2/3 code has been exercised on Vercel, against the deployed API, or in a
browser.

## 5. Outstanding

1. **Pushed:** on 2026-10-05 A (`0317644`), D (`e47a504`), B (`30fb242`), the
   test-reference fix (`8fb42e8`), C (047, 048; `979306a`), the XRPL guard
   (`d2ea524`) and the 047 completion commit (`396cf29`); on 2026-10-06 the D-2
   service-role delete (`203cbb4`), the 048 completion commit (`147e0b5`), the
   integration suite's service-role clean-up (`27ecff6`) and three D-2 sandbox fixes
   (`a39a528` tenant-normalize.js, `233cc0c` evidence helpers and field storage,
   `bd15488` FieldProvenance); on 2026-10-07 the 015c completion commit (`34f4ed5`,
   00:49:48Z) and the CI fixture teardown fix with the orphan cleanup record
   (`8395f41`, 02:49:06Z). Every push deployed the Pilot site; each deployment
   was read back READY. The ledger endpoints exist on Vercel **without deployed API
   verification**.
2. **CI gates — both green on `8395f41`.** B1 authorization: run 209, 66 passed /
   0 failed (run 208 on `34f4ed5` was the first to pass since 015b narrowed the
   grant on 2026-09-24 — up from 40 passed / 3 failed on run 207 — and the first to
   reach T17–T21: re-invitation, single use, no duplicate membership, an invitation
   alone grants nothing). Pilot live verification: run 290, cross-user RLS, D-2
   round trip and integration all passing (green since run 288). **The
   orphan-organisation leak is fixed:** migration 024's trigger creates an
   organisation for the fixture landlord on the first property insert, and until
   `8395f41` neither fixture script deleted it (`organizations.created_by` is ON
   DELETE SET NULL), so every run left one — 88 on Pilot between 2026-09-18 and
   2026-10-07. Both scripts now tear down properties → organisation (id, creator
   and fixture name restated; exactly one row) → users and re-read all three; runs
   209 and 290 each created and removed one and left none. The 88 historic orphans
   were removed 2026-10-07 02:16:36Z by the one-off cleanup (§3, §6): 101 → 13, the
   remaining 13 byte-identical, 0 orphans.
3. **Live matrix for 046** (`tools/migrate/live-matrix/<name>.sql`), required by
   the runbook before its apply. 047's, 048's and 015c's are done (applied and verified
   2026-10-05, 46/0; 2026-10-06, 64/0; 2026-10-07, 14/0). The Supabase connector cannot run
   these matrices or the rolled-back trials (it times out at 60 s on text
   containing DELETE/TRUNCATE); Lynn runs them in the Pilot SQL editor, which
   turns line endings into CRLF — harmless for a matrix or a trial (the trial's
   hash guard reads the executable text), but a migration itself must go through
   the hand-off script. Lesson from 048: paste into a **new** editor tab with
   nothing selected; the editor runs a selection on its own, and an edited tab
   is refused by the trial's hash guard, as designed.
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
  Re-confirmed 2026-10-07 (260 suites: 254 passed, these 6), each on the same
  assertion as on 2026-10-05.
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
  `test-xrpl-network-guard.js` pins both. The guard commit `d2ea524` was pushed
  2026-10-05 and is in `origin/pilot`; every Pilot deployment since, including the
  current `dpl_HFgLY6…`, carries `api/_pilot-target.js` and the settlement UI
  change. That the live page now names testnet has **not been browser verified**.
- **CI fixture organisation leak — found and closed 2026-10-07.** One
  `organizations` row per gate run since 024 was applied (2026-09-18), 88 in all,
  each creator-less, member-less and property-less, named after a reserved-domain
  fixture email. Cause and fix in the header of `scripts/b1-ci-fixture.js`; closed
  in `8395f41` (test and CI code only). The backlog was removed by a one-off cleanup
  scoped to the 88 enumerated ids AND the orphan predicate, count-checked before and
  after, in one transaction (`tools/ci-fixture-orphan-cleanup/pilot-2026-10-07.sql`,
  run by Lynn in the SQL editor, committed 02:16:36Z). Remaining gap: a run
  cancelled between its property insert and its teardown now has its organisation
  swept with its account on the next run, but an organisation whose creator is
  already gone is not reachable by the sweep and would need the same cleanup tool
  again.

## 7. Next approved action

**015c is complete and pushed** (applied by Lynn 2026-10-07 00:30:20Z through the
hand-off script after the rolled-back trial on Pilot; record verified, catalog diff
explained — one privilege row — fingerprint as predicted, data unchanged, live
matrix 14/0; completion commit `34f4ed5` pushed 00:49:48Z, both gates green, B1
66/66). **The CI fixture organisation leak is fixed and pushed** (`8395f41`,
02:49:06Z; both gates green, 0 orphans left by the runs) and the 88 historic
orphans are gone (101 → 13, verified). `origin/pilot` is at `8395f41`.

**Nothing further is currently approved.** Proposed next, each needing its own
approval: 046 through the same procedure (live matrix, rolled-back trial, hand-off
apply, verification), which also creates the ledger tables and depends on
endpoints that are not yet deployed-API or browser verified; the Pilot-marker
guard for the committed 045 and 046 rollbacks; the storage anon grants (§5.7).

Any migration (046), live matrix run, push, Production change, CI-gate change,
Pilot testnet wallet, the Pilot-marker guard for the committed 045 and 046
rollbacks, and Option B each need their own specific approval.
