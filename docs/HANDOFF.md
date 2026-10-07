# Hand-off — current state

**Updated:** 2026-10-07 (**046 applied to Pilot 13:20:07Z and verified**: record, catalog diff, fingerprint as predicted, data identical, live matrix 31/0; the deployed-endpoint smoke test passed at 15:32Z — import, idempotent re-import, reversal, prospect deletion through the deployed site — its one storage object removed by the approved cleanup at 15:47Z and the temporary test credential invalidated; final read-only check 15:49Z identical to the pre-smoke baseline except the three intentional history rows; earlier that day the 046 pre-apply validation and the rolled-back trial on Pilot, then commits `2646894` and `aa95e33` pushed 12:45:22Z; before that, after the 015c completion commit was pushed and both CI gates passed on it, B1 66/66 for the first time since 015b; the CI fixture organisation leak was found, fixed in `8395f41` and pushed, and the 88 orphan organisations it had left on Pilot were removed by a one-off, verified cleanup, 101 → 13; earlier that day 015c applied to Pilot and verified; 2026-10-06: 048 applied and verified, its completion commit and four test-only fixes pushed, the Pilot live verification gate green again; 2026-10-05: 047 applied and verified, its completion commit pushed, the CI test fix committed locally; earlier that day: commits A, D, B, the test-reference fix and C, the Vercel environment separation and Pilot redeploy, and the XRPL network guard commit).
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
| Vercel (Pilot site) | project `mainstreet-xrpl` | **verified 2026-10-05:** every push to `pilot` deploys automatically as a Preview, and `www.mainstreet-review.com` follows the newest `pilot` deployment; Production is `main` → `www.mainstreetcam.com`. `origin/pilot` is `aa95e33` (pushed 2026-10-07 12:45:22Z with `2646894`, after `8395f41` at 02:49:06Z); its automatic deployment `dpl_CajFS8D8R4H1eo6xWREiboWRBanh` was read back READY, aliased to `www.mainstreet-review.com`; CI runs 210 (B1 66/66) and 291 (live verification) passed on it. Environment separated 2026-10-05: the Production wallet seed/address and Production `SUPABASE_*` are Production-only; Preview has `XRPL_NETWORK=testnet` and no wallet. The ledger endpoints are **deployed and were exercised once** against 046 (the 2026-10-07 smoke test, §4, §5.3) | deploy only on approval |
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

**Re-read 2026-10-07 11:01:06Z, 11:17:17Z and 11:46:50Z** (before and after the 046
rolled-back trial, §4, §5.3), read-only: still 48 migration rows, newest 015c; 046
recorded 0 times and none of its tables, functions, columns or storage rules present;
fingerprint `1398 64458394045bd877f0e1fe5ffdfbb123`; `financial_sources` / `gl_entries`
0 / 0; every data hash identical; no fixture residue, open transaction or lock left
by the trial. **The trial returned Pilot exactly to its pre-046 state.** One
pre-existing function, `lease_jobs_set_updated_at()`, already holds CRLF line endings
(1 of 121; it predates 046 and 046 does not touch it).

**Read 2026-10-07 15:49:02Z** (after the 046 apply, its live matrix, the deployed smoke
test and the smoke-test cleanup), read-only through the connector — the current state:

- **49 migration rows; newest `20261007132007 046_acquisition_general_ledger`**, recorded
  once; recorded text md5 `5c8af9624927c3c275d46526bfc4c05f`, sha256 `d8acceaa…42e94`,
  56,369 bytes, no CR = the committed file and the approval; idempotency key
  `8f79de8f-81e5-45bb-9f27-43802575b64a` = the key the hand-off script printed; created_by
  set; previous newest 015c unchanged.
- Catalog fingerprint **`1524 a103e168cc737262258e745ebcda0530`** — exactly the LF
  post-apply value predicted before the apply; unchanged since 13:21Z through the matrix,
  the smoke test and the cleanup. 046 added exactly the 126 predicted rows and removed or
  changed none (current rows minus the 126 = the pre-apply `1398 64458394…`); in the four
  inventory categories 0 removed / 36 added (fn 13, pol 6, pri 11, trg 6),
  `check-inventory.js` EXPLAINED (`tools/migrate/live-matrix/046_*.inventory-*.txt`).
- 046's tables: `financial_sources` / `gl_entries` / `gl_entry_sources` /
  `gl_entries_reversed` / `ledger_maintenance_runs` 0/0/0/0/0; **`ledger_import_history`
  3 rows** (import, reverse, evidence_removed for the deleted synthetic smoke-test
  property `31a00b6c…`) — **intentional, append-only, retained by design**
  (`migrations/APPLIED.md` fact 21); not residue.
- `storage.objects` 199, md5 `d7ee8ea4…` = the pre-smoke baseline; rules = 047's four +
  046's two (`acq_evidence_no_update`, `acq_evidence_no_delete`).
- Every other data hash identical to the 13:43:19Z pre-smoke baseline and to the
  pre-apply read (acquisition_documents 16, acquisition_reviews 12, auth.users 13,
  lease_documents 93, lease_jobs 111, organization_members 13, organizations 13,
  properties 50, property_events 87, tenants 149). No smoke-test property, review,
  document, source, line, link, archived line, event or storage object remains. 0 locks,
  0 idle transactions, 0 other clients, 0 temp objects. The temporary password set on the
  fixture account `pilot-tenant-a@…` for the smoke test is invalidated (hash replaced
  by that of a discarded random password at 15:48:25Z).
- Evidence: `tools/migrate/live-matrix/046_acquisition_general_ledger.result.txt` (apply,
  record, catalog, matrix 31/0) and `….smoke.result.txt` (smoke test, cleanup, final
  check) with the two scripts as run beside them; `migrations/APPLIED.md` row and fact 21;
  approval `tools/migrate/approvals/046_….approval` with the apply fields filled.

Anything read after that time is **unverified** until the next read-only check.

## 4. Work and its state

| piece | implemented | tested locally | committed | pushed | deployed | applied to Pilot | live DB verified | deployed API verified | browser verified |
|---|---|---|---|---|---|---|---|---|---|
| Migration tooling and runbook (`tools/migrate/`, `docs/MIGRATION_RUNBOOK.md`) | yes | 28 + 25 offline checks | **yes, `54fecd4`** | **no** | n/a | n/a | n/a | n/a | n/a |
| Migration 045 member write rules | yes | 136/136 on PG 16 and 17.6 (re-run before the commit); mutation harness | **yes, `0317644`** (file byte-identical to the applied text, blob `42f0f046`) | **no** | n/a | **yes, 2026-10-04 18:44:27Z** | **yes**: 46-check rolled-back matrix, 2026-10-04 (`tools/migrate/live-matrix/`) | n/a (no endpoint) | **no** |
| GL parser (`gl-import.js`) | yes | 142/142 (`test-gl-import.js`, re-run 2026-10-04 before commit B), in regression | **yes, `30fb242`** (commit B) | **no** | n/a | n/a | n/a | n/a | no |
| Ledger endpoints (`api/_ledger-*.js`, `?op=` in `api/upload.js`) | yes | 68 endpoint + 22 concurrency checks against a **local stand-in** of Storage/PostgREST/GoTrue (re-run 2026-10-04 before commit B); Bulk Intake scope suite 86/86 | **yes, `30fb242`** | yes (2026-10-05) | yes — on every Pilot deployment since; current `dpl_CajFS8D8…` | n/a (046 applied 2026-10-07) | via the 046 matrix | **yes, 2026-10-07 15:32Z**: the smoke test from a signed-in owner's Mac — `?op=ledger-import` reached `import_general_ledger()` (2 lines inserted), re-import idempotent, `?op=ledger-reverse` reached `reverse_general_ledger_import()` (2 removed, 2 archived), every read-back as expected (`tools/migrate/live-matrix/046_*.smoke.result.txt`). One synthetic two-line CSV only | no |
| Migration 046 acquisition general ledger | yes | verifier **131/131 on PG 16.13 and 17.6** (2026-10-07; the new check: the rollback refuses a database without the Pilot marker); mutation 61/61 non-equivalent mutants killed, 1 equivalent (L08), incl. L41 (rollback marker guard); endpoint 68/68, concurrency 22/22, gl-import 142/142; live matrix (31 checks) and rolled-back trial local-tested on both (55/55 each with the line-ending correction) | **migration yes, `30fb242`** (file md5 `5c8af9624927c3c275d46526bfc4c05f`, 56,369 bytes — unchanged, byte-identical to the applied text). **Rollback with the Pilot marker guard, verifier, mutation harness and live matrix in `aa95e33`** (rollback md5 `56d3a92bf11070b67390ad1bbfaec5d0`, sha256 `553339ea…0f09`, 6,155 bytes; matrix `tools/migrate/live-matrix/046_*.sql` md5 `589e651d…`). Approval, apply and matrix records, inventories and smoke-test artifacts in the 046 completion commit | yes (`30fb242` 2026-10-05; `aa95e33` 2026-10-07 12:45:22Z; the completion commit not yet) | n/a | **yes, 2026-10-07 13:20:07Z** (hand-off script, PROBE then one send, HTTP 200, key `8f79de8f…`) | **yes**: rolled-back trial on Pilot before the apply (046 + matrix 31/0 + rollback exact + matrix 2/29, data identical), then after it: record once and exact, catalog diff 0 removed / 36 added all 046's, fingerprint `1524 a103e168…` as predicted, data identical, the 31-check matrix 31 ok / 0 FAIL | **yes, 2026-10-07 15:32Z** (the smoke test, see the endpoints row) | no |
| Migration 047 remaining member write rules | yes | verifier 76/76 on PG 16.13 and 17.6; mutation 21/21 killed (re-run 2026-10-05, logs in scratchpad `phase6/commitC/`) | **yes, `979306a`** (C); its live matrix and apply records in `396cf29` | yes (`979306a` and `396cf29` are in `origin/pilot`) | n/a | **yes, 2026-10-05 18:30:07Z** (hand-off script, one send, HTTP 200) | **yes**: rolled-back trial on Pilot before the apply (047 + matrix 46/0 + rollback exact), and the 46-check matrix after it, 46 ok / 0 FAIL | n/a (no endpoint) | no |
| Migration 048 operating tables | yes | verifier 50/50 on PG 16.13 and 17.6; mutation 21/21 killed (re-run 2026-10-05); live matrix 64 checks local-tested on both; trial 21/21 on both | **yes, `979306a`** (C); its live matrix and apply records in the 048 completion commit | yes (`979306a` and the completion commit `147e0b5` are in `origin/pilot`) | n/a | **yes, 2026-10-06 13:07:26Z** (hand-off script, one send, HTTP 200) | **yes**: rolled-back trial on Pilot before the apply (048 + matrix 64/0 + rollback exact, 2026-10-06), and the 64-check matrix after it, 64 ok / 0 FAIL | n/a (no endpoint) | no |
| Migration 015c service-role INSERT on `tenant_invitations` (B1 gate fix) | yes | `tools/verify-migration-015b.js` (015b + 015c) 213/213 on PG 16.13 and 17.6; `tools/data-api-grants-mutation.js` 49/49 killed on both (5 new 015c mutants); live matrix 14 checks and trial 26/26 local-tested on both | **yes, the 015c completion commit** (migration, rollback, verifier, mutation harness, matrix, approval and apply records together) | yes, `34f4ed5` (2026-10-07 00:49:48Z); both gates green on it — B1 run 208 66 passed / 0 failed (T17–T21 reached for the first time since 015b), live verification run 289 all suites | n/a | **yes, 2026-10-07 00:30:20Z** (hand-off script, one send, HTTP 200) | **yes**: rolled-back trial on Pilot before the apply (015c + matrix 14/0 + rollback exact + matrix 9/5, 2026-10-06), and the 14-check matrix after it, 14 ok / 0 FAIL | n/a (no endpoint) | no |
| CI fixture organisation teardown (`scripts/b1-ci-fixture.js`, `scripts/pilot-live-fixture.js`) and the one-off orphan cleanup tool (`tools/ci-fixture-orphan-cleanup.js`) — **test and CI code only; no application file, migration, policy or grant** | yes | `test-ci-fixture-teardown.js` 79/79 (both scripts, seven mutants each killed, offline); `tools/verify-ci-fixture-organizations.js` 62/62 on PG 16.13 and 17.6 (leak reproduced from the 024 text, fix, order, predicate vs five decoys, cleanup template's every refusal and its rollback); both in regression | **yes, `8395f41`** | yes (2026-10-07 02:49:06Z) | yes, `dpl_HFgLY6…` READY — incidental: the deployment carries no application change | **n/a — not a migration.** The one-off cleanup ran on Pilot 2026-10-07 02:16:36Z as a data correction: organisations 101 → 13 | **yes**: read-only 02:17:51Z (0 orphans, protected 13 byte-identical, fingerprint and every other hash unchanged) and 02:50:59Z after gate runs 209 and 290, which created and removed one organisation each and left 0 | n/a | n/a |
| Full regression (`node test-regression.js`) | — | **2026-10-07, before the fixture-fix commit `8395f41` (260 suites): 254 passed, 6 failed = the six pre-existing baseline failures only, each on the same assertion as before.** 2026-10-05 after `8fb42e8` (257 suites): 251 passed, 6 failed, the same six. Between commit B and that fix the gate read 249 passed, 8 failed (see §6) | — | — | — | — | — | — | — |

Locally tested means throwaway PostgreSQL clusters and local stand-ins. Live
verification so far: the 045, 047, 048, 015c and 046 SQL matrices and the 046
rolled-back trial (live database verification), the CI gates' live suites (§5), the
read-only checks around the organisation cleanup, and — the first deployed API
verification in this programme — the 046 smoke test of 2026-10-07, which drove the
deployed ledger endpoints once with a synthetic two-line CSV from a signed-in test
owner. The cleanup is a data correction, not a migration: it is recorded here and
under `tools/ci-fixture-orphan-cleanup/`, not in `migrations/APPLIED.md`. Nothing has
been exercised in a browser; the browser side of the import is not built.

## 5. Outstanding

1. **Pushed:** on 2026-10-05 A (`0317644`), D (`e47a504`), B (`30fb242`), the
   test-reference fix (`8fb42e8`), C (047, 048; `979306a`), the XRPL guard
   (`d2ea524`) and the 047 completion commit (`396cf29`); on 2026-10-06 the D-2
   service-role delete (`203cbb4`), the 048 completion commit (`147e0b5`), the
   integration suite's service-role clean-up (`27ecff6`) and three D-2 sandbox fixes
   (`a39a528` tenant-normalize.js, `233cc0c` evidence helpers and field storage,
   `bd15488` FieldProvenance); on 2026-10-07 the 015c completion commit (`34f4ed5`,
   00:49:48Z) and the CI fixture teardown fix with the orphan cleanup record
   (`8395f41`, 02:49:06Z), then the HANDOFF update (`2646894`) and the 046 rollback
   guard, verifier, mutation harness and live matrix (`aa95e33`) at 12:45:22Z,
   deployment `dpl_CajFS8D8…` READY, CI runs 210 (B1 66/66) and 291 green. Every push
   deployed the Pilot site; each deployment was read back READY. The ledger endpoints
   on that deployment were **verified against the deployed API once** by the 046
   smoke test (§5.3). The 046 completion commit (records only) is local, not pushed.
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
3. **046 — applied to Pilot and verified (2026-10-07).** In order, each step on its
   own approval:
   - **Pre-apply validation and rolled-back trial (morning).** Verifier 131/131 on PG
     16.13 and 17.6, mutation 61/61 + L08 equivalent, endpoint 68/68, concurrency
     22/22, gl-import 142/142; the 31-check live matrix and the self-aborting trial
     (046, matrix, rollback, matrix, forced RAISE) local-tested on both. The trial,
     run once by Lynn in the Pilot SQL editor: M1 31 ok / 0 FAIL, R1 rollback exact,
     M2 2 ok / 29 FAIL (the pre-046 set), D2 data identical, Pilot unchanged. T3
     printed false because the editor sends CRLF, which lands inside the 13
     dollar-quoted function bodies and changes `md5(pg_get_functiondef)` (the other
     113 rows matched exactly; reproduced offline 13/13); the tooling now compares
     function text with CRLF read as LF and still catches a substantive change. CRLF
     fingerprint seen in the trial `1524 537a044d…`; LF fingerprint predicted for the
     hand-off apply `1524 a103e168cc737262258e745ebcda0530`.
   - **Commits and push (12:45:22Z):** `2646894` (HANDOFF) and `aa95e33` (rollback
     marker guard md5 `56d3a92b…`, verifier, mutation harness, live matrix);
     deployment READY, CI 210 and 291 green, Pilot unchanged.
   - **Apply (13:20:03–13:20:05Z):** hand-off script from Lynn's Mac, PROBE 200 (48
     rows, 046 absent), one POST, HTTP 200, key `8f79de8f-81e5-45bb-9f27-43802575b64a`.
     Verified read-only: recorded once as `20261007132007`, exact text, key equal;
     exactly the 126 predicted catalog rows added, nothing removed or changed;
     fingerprint `1524 a103e168…` **exactly as predicted**; every data hash identical;
     no residue, lock or open transaction.
   - **Post-apply live matrix (~13:30Z, SQL editor):** 31 ok / 0 FAIL, every line as
     in the trial's M1; residue check clean, fingerprint and data unchanged.
   - **Deployed-endpoint smoke test (15:32:10–15:32:19Z):** from Lynn's Mac as the
     fixture owner `pilot-tenant-a@…` with a temporary password set by the
     established admin mechanism: `begin_acquisition`, upload of a 189-byte
     synthetic CSV, document filed, `POST /api/upload?op=ledger-import` →
     `import_general_ledger()` inserted 2 balanced lines; re-import answered
     `already_imported`; `?op=ledger-reverse` → `reverse_general_ledger_import()`
     removed 2 and archived 2; `delete_prospect_acquisition` removed property,
     document and source. Every read-back as expected. The script stopped at its own
     last check (below), so its storage delete was not reached.
   - **Smoke-test visibility finding (documented, not a defect):** the script
     re-read `ledger_import_history` as the test user after the prospect was deleted
     and expected 3 rows; the member-scoped policy correctly shows a former owner 0
     rows for a property that no longer exists, while **the 3 rows (import, reverse,
     evidence_removed) remain, append-only, visible to privileged verification**. The
     database behaviour is intended and unchanged; the script's expectation was wrong
     (`046_*.smoke.result.txt`, APPLIED.md fact 21).
   - **Cleanup (15:47Z) and credential:** the one remaining storage object (the
     189-byte smoke CSV) deleted through the Storage API as the owner, the Storage
     call the script's last step intended; storage back to 199 / `d7ee8ea4…`; the
     temporary password replaced by the hash of a discarded random password.
   - **Final read-only check (15:49Z):** identical to the pre-smoke baseline in every
     table except the three intentional history rows; fingerprint unchanged; 046 once;
     no locks, transactions or residue (§3).

   Paste a trial or matrix into a **new** editor tab with nothing selected (lesson
   from 048). A migration itself always goes through the hand-off script, never
   the editor.
4. **046 — remaining:** push the completion commit (this record-keeping commit:
   approval fields, apply/matrix/smoke records, inventories, APPLIED.md, this file);
   needs its own approval. Nothing else of 046 is outstanding. Larger ledgers, the
   Vercel 30 s limit and the browser workflow are untested (§6).
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
  (b) *Ownership — read on Pilot 2026-10-07 (read-only).* `storage.objects` is
  owned by `supabase_storage_admin`, and `postgres` cannot act as that role. That
  is why 011's `enable row level security` failed with "must be owner".
  - Pilot's `supautils.policy_grants` lists `storage.objects` for `postgres`. That
    is how the 011, 024 and 047 policies were accepted, and the 046 trial created
    and dropped 046's two policies there.
  - `postgres` holds TRIGGER on the table, so a guard trigger against a service-key
    overwrite looks possible, but none exists and none is designed or approved.
  - Until then, 046's integrity check detects a replaced original; nothing
    prevents one.
  - Also read 2026-10-07: 16/16 acquisition originals are stored with a numeric
    size and a quoted 32-hex eTag, matching what 046 reads.
- The composite-key authorship limitation above.
- The ledger endpoints ran on Vercel once (the 046 smoke test: a two-line CSV, each
  operation answered in about a second). Larger files and the 30 s limit are
  untested.
- **After a prospect is deleted, its former owner cannot see its import history
  through the API** (the member-scoped select on `ledger_import_history` finds no
  property to be a member of), although the rows are retained. Intended; recorded in
  APPLIED.md fact 21. A history view for deleted prospects, if ever wanted, would be
  a product decision.
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
orphans are gone (101 → 13, verified). `origin/pilot` is at `aa95e33` (pushed
12:45:22Z).

**046 is applied to Pilot and verified (2026-10-07):** rolled-back trial, apply
13:20:07Z through the hand-off script (record once and exact, exactly the predicted
126 catalog rows, fingerprint `1524 a103e168cc737262258e745ebcda0530` as predicted,
data identical), live matrix 31/0, the deployed-endpoint smoke test (import,
idempotent re-import, reversal, deletion through the deployed site), the cleanup of
its one storage object and the invalidation of the temporary test credential, and a
final read-only check identical to the pre-smoke baseline except the three
intentional, append-only `ledger_import_history` rows. The smoke-test script's final
check was wrong (it read history as the deleted property's former owner and expected
3 rows where the API correctly shows 0 and the database retains 3); documented, the
database unchanged. The 046 completion commit (records only) is **local, not pushed**.

**Nothing further is currently approved.** Proposed next, each needing its own
approval:
- push the 046 completion commit;
- the browser side of the import (§5.5);
- pg_cron for `run_ledger_maintenance()` (§5.6);
- the Pilot-marker guard for the committed 045 rollback;
- the storage anon grants and bucket size limit (§5.7).

Any migration, live matrix run, push, Production change, CI-gate change,
Pilot testnet wallet, the Pilot-marker guard for the committed 045 rollback, and
Option B each need their own specific approval.
