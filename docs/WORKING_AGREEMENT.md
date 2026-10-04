# Working agreement

How Lynn, Claude and ChatGPT work on MainStreet. Adopted 2026-10-04 after the
045 Pilot apply. `docs/HANDOFF.md` carries the current state;
`docs/MIGRATION_RUNBOOK.md` carries the migration procedure;
`docs/CONTRIBUTING.md` and `docs/BRANCHING_AND_DEPLOYMENT.md` carry the coding
and branch norms. When documents disagree, this one and the hand-off win.

## Roles

- **Lynn** is the product owner and makes the decisions. Technical risks and
  choices are explained to her in plain English.
- **Claude** is the implementation and verification partner: inspects the code,
  investigates defects, implements approved work, runs the appropriate tests
  and reports evidence.
- **ChatGPT** is the strategic and technical review partner: helps Lynn assess
  the plan, spot missing safeguards, challenge assumptions and decide what
  should happen next.
- A technical recommendation, or a previous approval, is never blanket
  permission for future work.

## How we work

1. **One hand-off.** `docs/HANDOFF.md` is the single, current hand-off: product
   direction, completed work, outstanding work, known defects, environment
   boundaries and the next approved action. It is updated at the end of every
   stage, before the report.
2. **Before implementation:** the problem, the proposed solution, the files and
   systems affected, the risks, the test plan and explicit scope boundaries.
3. **Small, reviewable stages.** One stage is finished and verified before the
   next begins.
4. **Unrelated work stays separate.** Feature work, migration tooling, security
   fixes and database changes are never silently mixed in one change or one
   commit.
5. **States of work are distinct and named.** Every piece of work is described
   by the states it has actually reached, and a later state is never implied by
   an earlier one:
   - *implemented locally* — the code or SQL exists in the worktree;
   - *tested locally* — unit tests, static checks, verifiers and mutation
     harnesses on throwaway databases and local stand-ins;
   - *committed*; *pushed*; *deployed* (which environment);
   - *applied to a database* (which one, which version);
   - *live database verification* — SQL run against the live database,
     including a rolled-back permission matrix; this proves what the database
     enforces, not what the application does;
   - *deployed API verification* — requests made against the deployed
     endpoints on the real platform;
   - *end-to-end browser verification* — the workflow exercised in the live
     application in a browser.
   A rolled-back SQL matrix is live database verification. It is never
   reported as API or browser verification.
6. **No invented testing.** A browser workflow or the live application is never
   reported as tested when only unit tests, static checks, SQL tests or API
   checks were run.
7. **Real data and existing behaviour are preserved.** Test results are never
   invented. The mixed-up Lakeview data is never used as a trustworthy test
   property. Synthetic data is labelled as such and lives in isolated fixtures.
8. **Canonical records are never silently modified by AI.** Verified property,
   lease, tenant, financial and other canonical records change only through
   the established protocol: evidence → proposal → human confirmation →
   audited change.

## Database and Production safeguards

- **Production is protected and separate.** No Production access, migration,
  data change, deployment or wallet action without explicit, specific approval
  naming Production.
- **Pilot is the only target for approved Pilot migrations.** The target is
  verified before every change; every migration refuses to run without the
  Pilot marker; every tool hard-codes the Pilot ref.
- **For each migration:** prepare the SQL, inspect its effects and its rollback
  limitations, run local verification and mutation tests, and prepare the live
  verification plan (the rolled-back matrix) *before* asking for approval.
- **One migration at a time.** Approval for one migration never authorises the
  next.
- **After an approved apply:** verify the migration history, the catalog
  changes and data preservation with the checkers; report the evidence; stop
  for review before proceeding.
- **An inconclusive apply is investigated, never retried blindly** and never
  assumed to have failed. The database is read first.
- **Credentials never appear** in chat, source control, command history or
  logs. The scoped-token procedure in the runbook is followed; temporary
  credentials are revoked when no longer needed.
- **Nothing is pushed, deployed, applied, deleted or modified in shared data**
  because it would be the logical next step. Anything outside the specific
  approval is asked first.

## Communication

- When Lynn must use Terminal or another technical interface: **one clear next
  action at a time**, with what to expect.
- Reports are concise and understandable, with enough evidence to tell
  verified facts from assumptions. Anything unverified is labelled unverified.
- UX regressions, broken workflows, misleading navigation, lifecycle gaps and
  behaviour that contradicts user expectations are flagged, not only code or
  test failures.
- When blocked: what is blocked, why, and the safest next choice. No
  improvising around security controls.
