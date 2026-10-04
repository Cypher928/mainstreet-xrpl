# Pilot migration runbook

How a database migration gets from a reviewed file in this repository onto the
**Pilot** Supabase project (`mainstreet-pilot`, ref `bhmktujbxdbvdmpybmad`), the
way 044 (2026-10-03) and 045 (2026-10-04) actually got there. Production
(`zhsuhehgehbzkmzurzyf`) is out of scope for every tool in this runbook; see
"Environments" below.

The short version: **you approve in writing, Claude prepares and verifies, you
paste one line into Terminal, Claude verifies again and reports.** Nothing is
applied without your written approval of the exact file, and nothing is ever
retried blindly.

This runbook is the migration-specific part of `docs/WORKING_AGREEMENT.md`.
Which migrations are applied, and what the next approved action is, is recorded
in `docs/HANDOFF.md` and `migrations/APPLIED.md`.

---

## 1. How 045 was actually applied (the procedure this runbook is built on)

| step | who | what happened | needed? |
|---|---|---|---|
| Local build and tests | Claude | Migration + rollback written; verifier run on throwaway PostgreSQL 16 and 17.6 (136/136); mutation harness; full regression. | yes |
| Read-only calibration | Claude | Pilot inspected through the Supabase connector (read-only SQL): identity, migration history, live policies/grants, catalog fingerprint, row-content hashes. Saved as the before-state. | yes |
| Written approval | Lynn | "I approve Phase 4 Stage 2a only … Apply Migration 045". | yes |
| Attempt through the Supabase connector | Claude | `apply_migration` timed out twice at 60 s with no effect. Cause (established for 044): the hosted Supabase connector asks for confirmation before any SQL whose statements begin with DROP/DELETE/TRUNCATE, this client cannot show that prompt, and the harness gives up at 60 s. Every permissions migration contains `drop policy if exists`, so this path is closed for them. | no, failed |
| Hand-off script on Lynn's Mac | Lynn | `apply-045-pilot.sh` (now generalised as `tools/migrate/apply-migration.sh`): verified the file's md5 and size, built the request body, generated one Idempotency-Key, read the token from the environment, sent **one** `POST https://api.supabase.com/v1/projects/bhmktujbxdbvdmpybmad/database/migrations` with `{name, query}`. HTTP 200 at 18:44:27Z. | **yes, this is the procedure** |
| Token | Lynn | A Supabase personal access token created in the dashboard. The first one was scoped with no permissions (HTTP 403, "Missing required permission(s)"). The one that worked was scoped to the Pilot project with **Database → Migrations: read-write** and nothing else. It was typed at a silent prompt, never pasted into chat, never written to a file. | yes |
| Verification | Claude | Read-only SQL through the connector: history has exactly one 045 row whose recorded text hashes to the approved file; every expected function/policy/trigger/grant present; catalog fingerprint diff shows only 045's objects; row-content hashes identical; live permission matrix (46 checks) in one rolled-back transaction. | yes |

Earlier detours that are **not** part of the procedure: the two connector
attempts, probing `GET /v1/projects/{ref}` and `GET /v1/organizations` (both
fail with a Migrations-only token even when the token is fine), and a
Terminal window stuck at a `quote>` prompt (open a new window with ⌘N).

---

## 2. Roles and the plain-English checklist

| | You approve | Claude does | Evidence that proves it |
|---|---|---|---|
| **Before** | The exact migration file (its name, its md5) and the stage it belongs to. | Builds and tests locally (verifier on a throwaway database, mutation harness, regression). Runs `prepare-migration.js`: files present, Pilot guard present, one transaction, rollback present. Reads Pilot read-only: history count, fingerprint, row hashes, prerequisites present, migration absent. Writes the approval file. Packs the hand-off folder. | Verifier `RESULT: n passed, 0 failed`; `READY` from prepare; before-state numbers in the report; `tools/migrate/approvals/<name>.approval` with the md5 you approved. |
| **Apply** | Running the one line (or, with the environment token set up, saying "apply it"). | Nothing on the database. Waits for the script's last line. | The script's `ACCEPTED: HTTP 200` line and its Idempotency-Key. |
| **After** | Nothing until the report. | Read-only SQL: record present exactly once with the approved md5; objects exist; fingerprint diff explained line by line; row hashes identical; live matrix in a rolled-back transaction; relevant regression suites. Updates `migrations/APPLIED.md`. | The verification table in Claude's report; the matrix result file under `tools/migrate/live-matrix/`. |
| **Stop rule** | — | Any unexpected difference, any non-conclusive send, any failed check: Claude stops and reports. No retry, no repair, no rollback on its own. | The report says exactly what differed. |

---

## 3. Your part, step by step (Terminal, one line)

Claude sends you a folder with three files: `apply-migration.sh`, the migration
`.sql`, and its `.approval`. Put them together (Downloads is fine).

1. Open **Terminal** (⌘-space, type Terminal). If an old window shows `quote>`,
   ignore it and press ⌘N for a fresh one.
2. Type this and press Enter (replace the folder and migration name with the
   ones Claude gave you):
   ```
   cd ~/Downloads && chmod +x apply-migration.sh && ./apply-migration.sh 046_acquisition_general_ledger
   ```
3. When it asks, paste the token and press Enter. **Nothing appears while you
   paste. That is normal.**
4. Copy the last five lines it prints and send them to Claude. They never
   contain the token.

What the script does before it sends anything: checks the file against the
approval (md5 and size), refuses any project other than Pilot, builds the
request body and proves it is byte-identical to the file, reuses or creates one
Idempotency-Key, then makes a **read-only** request for Pilot's migration
history with your token. Only if that returns 200 and the migration is not
already recorded does it send the one POST. Then it prints exactly one of:

- `ACCEPTED: HTTP 200` (or 201): done. Claude verifies.
- `PROBE: HTTP 401/403 … Nothing sent`: the token is wrong or lacks the
  Migrations permission. Nothing happened. Make a new token (section 4).
- `… ALREADY RECORDED … Nothing sent`: the migration is already on Pilot.
- `NOT CONCLUSIVE`: the send happened but the answer was not a clean 200.
  Do nothing; send Claude the lines. Claude reads the database and tells you
  whether a `--resend` (same key, typed confirmation) is warranted.

Afterwards, `unset SUPABASE_ACCESS_TOKEN` if you exported one, and revoke the
token in the dashboard if you will not need it again soon.

### Making the token (dashboard, once per token)

Supabase dashboard → account menu → **Access Tokens** → *Generate new token*.
Choose **scoped**, pick the organisation "Main Street", the project
**mainstreet-pilot** only, and under *Database* tick **Migrations: read-write**.
Nothing else. Copy it once. A token scoped like this cannot read your other
projects, cannot list organisations, and cannot touch Production.

### Option B, no Terminal at all (not configured; a separate decision)

The cloud environment Claude runs in has no token and its network policy denies
`api.supabase.com`, which is why your Mac is in the loop. Both are settings of
the Claude Code cloud environment (cloud environment menu in the session title
bar → Edit), and both are supported by the platform:

- **Secret.** Add the Pilot-scoped token as the environment variable
  `SUPABASE_ACCESS_TOKEN` (under API credentials where that section is
  offered, otherwise as an environment variable). It is stored by the platform,
  injected into the container's environment, and never appears in chat.
- **Network.** Under Network access choose Custom and add `api.supabase.com`
  to the allowed domains, keeping the default package-manager list.
- A **new** session is needed for either to take effect.

What changes: Claude runs `tools/migrate/apply-migration.sh <name>` itself,
with every guard above, still only after your written approval of the exact
file. What does not change: the token is scoped to Pilot and to Migrations
read-write, so it cannot read other projects or touch Production.

Honest trade-offs: the token then lives in every session of that environment
for as long as it exists, readable by anything Claude runs there, so (1) keep
it scoped exactly as above, (2) rotate or revoke it when no migration is
planned, (3) accept that "approval" becomes a chat message rather than your
hands on the keyboard, and (4) know that the network allow-list is the control
that stops the token travelling anywhere but Supabase. Until you decide to do
this, the Terminal line is the procedure.

---

## 4. Claude's part, in order

1. **Prepare (local).** `node tools/migrate/prepare-migration.js <name> --verify`
   must print `READY`. It also says how many statements the Supabase
   connector would flag as destructive, which is why the connector path is not
   used for these migrations.
2. **Before-state (Pilot, read-only, through the connector).** Run the four
   queries `node tools/migrate/render-sql.js {fingerprint|inventory|data-hashes|record <name>}`
   produces; save the inventory rows for the diff; confirm the migration's
   prerequisites exist and the migration itself is absent.
3. **Approval on record.** After your written approval of the exact md5:
   `node tools/migrate/prepare-migration.js <name> --approve "Lynn, chat <date>" --verification "<verifier result>"`
   then `--bundle <folder>` and send you the folder.
4. **Apply.** You run the line (section 3). Claude does nothing on Pilot
   meanwhile.
5. **Verify (Pilot, read-only). Mandatory; success is not reported until every
   check below passes.**
   - `record` result → `node tools/migrate/check-record.js <name> <result.json> --expect-rows <before+1> --key <key the script printed>`
     must print `VERIFIED`: exactly one row named `<name>`, its recorded text
     hashes (md5 **and** sha256) and size equal the approval, one statement,
     newest row, the idempotency key the script printed, Pilot marker present.
   - `inventory` before/after → `node tools/migrate/check-inventory.js <name> <before> <after>`
     must print `EXPLAINED`: every added or removed function, policy, trigger
     or grant row names an object the migration text mentions. One
     unexplained line fails the check.
   - `fingerprint`: `col/con/idx/rls` identical unless the header says
     otherwise; `fn/pol/pri/trg` changed, explained by the inventory check.
   - `data-hashes`: identical, unless the header says rows change and the
     difference is then explained line by line.
   - Live matrix: `tools/migrate/live-matrix/<name>.sql`, one transaction that
     ends in `RAISE EXCEPTION`, test accounts only; every expectation holds.
   - Relevant regression suites locally.
   If any check fails or cannot be run, the outcome is reported as **NOT
   VERIFIED** with the reason, nothing is retried, nothing is rolled back, and
   the approval's "after the apply" lines stay empty.
6. **Record.** Only after step 5: fill the approval's "after the apply" lines,
   add the row and the fact to `migrations/APPLIED.md`, and report.

---

## 5. Environments

- Every tool here hard-codes the Pilot ref and refuses any other. A
  Production migration would need its own approval file naming the Production
  ref, its own token scoped to that project, its own copy of the script with
  the Production ref, and its own written approval. None of that exists today,
  on purpose. A Pilot-scoped token structurally cannot authorise Production.
- Every migration refuses to run unless the Pilot marker property exists
  (`REFUSING TO RUN: pilot marker property not found`).
- The read-only connector queries address Pilot by ref in every call.

---

## 6. Rollback, honestly

- Every migration ships with `<name>_rollback.sql`, verified on the throwaway
  database to restore the catalog exactly (policies, grants, triggers,
  functions). The rollback is applied by the same script and the same
  approval process, never automatically.
- **Safe to reverse:** policy, grant, trigger and function changes (044, 045,
  047, 048 are of this kind). Reversing re-opens whatever gap the migration
  closed; the rollback headers say so.
- **Not freely reversible:** anything that wrote or removed rows, created
  tables that then received data, or changed data shape. 046's rollback, for
  example, refuses to run while any import history exists. A rollback that
  would lose data is a decision for you, taken on the record, never a reflex.
- **Never automatic:** a failed or non-conclusive apply is read first. The
  history row, the objects and the hashes say what state Pilot is in; only
  then is a rollback even proposed.

---

## 7. Files

| file | purpose |
|---|---|
| `tools/migrate/apply-migration.sh` | the one-send apply script (hand-off or, with Option B, run by Claude) |
| `tools/migrate/approvals/<name>.approval` | your approval on record: md5, size, date, who; filled after the apply with version and key |
| `tools/migrate/prepare-migration.js` | local readiness check, approval writer, bundle packer |
| `tools/migrate/render-sql.js` + `tools/migrate/sql/*.sql` | the read-only before/after queries Claude runs through the connector |
| `tools/migrate/check-record.js` | mechanical pass/fail on the history record: once, newest, md5 + sha256 + size equal the approval, key matches |
| `tools/migrate/check-inventory.js` | mechanical pass/fail on the catalog diff: every changed line must name an object the migration mentions |
| `tools/migrate/live-matrix/<name>.sql` | the rolled-back live permission matrix for that migration, with its `.result.txt` |
| `tools/migrate/test-apply-migration.sh` | offline tests of the apply script with a fake curl (28 checks; proves the token never reaches a command line, a log or a file) |
| `tools/migrate/test-checkers.sh` | the two checkers against deliberately wrong evidence (25 checks: missing record, wrong sha256/md5/size, recorded twice, wrong key, wrong count, not Pilot, malformed approval, unexplained catalog change); uses 045's real inventories kept under `live-matrix/` |
| `migrations/APPLIED.md` | the record of what Pilot has, row by row |

## 8. What the offline tests prove, and what they do not

`tools/migrate/test-apply-migration.sh` runs the apply script against a fake
`curl` that records every request and fails if the token ever appears in an
argument. It proves the script's own logic: check mode makes no request and
reads no token; a good probe plus HTTP 200 produces exactly one POST; a second
plain run is refused; the key file is reused and never replaced; a history that
already holds the name blocks the send; probe 401/403 sends nothing; a POST
that returns 403 or times out is NOT CONCLUSIVE with the attempt recorded; an
approval naming any other project, a wrong md5, a wrong sha256, another
migration's name, a missing approval or anything token-shaped inside it is
refused before any request; token whitespace and bad names are refused; no
token characters reach the log, state or response files.

It does **not** prove anything about real Supabase: that the Management API
still accepts `{name, query}`, that an Idempotency-Key deduplicates on the
server, what a 500 looks like, or that the connector's read-only queries match
what the API records. Those were observed once each on 044 and 045 and are
re-observed on every real apply by the verification step, which is why it is
mandatory.

## 9. Known limitations

- The Supabase connector cannot apply a migration containing DROP/DELETE/
  TRUNCATE statements from this client; that is why the script exists.
- The scoped token proves it can read the history before sending, but no
  read-only call proves the *write* half of the Migrations permission; a token
  with read only would produce a NOT CONCLUSIVE HTTP 403 send, which applies
  nothing but consumes the one plain send (a `--resend` follows after the
  read-only check).
- The live matrix runs under the database owner's connection with the role
  switched per test; it exercises the same policies and triggers the API uses,
  but not PostgREST itself. Browser-level checks remain a separate step.
- The before/after inventory covers `public` and `storage`; a migration that
  touches another schema needs its queries extended first.
- `check-inventory.js` explains a changed line by *name*: a changed grant row
  on a table the migration mentions, or a policy whose name appears in the
  file, counts as explained even if the exact privilege set or predicate is not
  what the migration intended. The checker catches objects the migration never
  names; reading the diff lines for the named ones is still part of step 5.
- The checkers judge the connector's output against the approval file, the
  key the apply script printed and the history count read before the apply.
  They cannot tell a faithful connector result from a fabricated one; the
  result is pasted from the same session that ran the query, and the saved
  evidence files make it re-checkable later.
