# MainStreet — read first

1. `docs/WORKING_AGREEMENT.md` — roles, approvals, environment boundaries, and
   the states of work (implemented, locally tested, committed, pushed, deployed,
   applied, live DB verified, deployed API verified, browser verified). Follow it.
2. `docs/HANDOFF.md` — the current state and the **next approved action**. Do
   nothing beyond that action without a new, specific approval.
3. `docs/MIGRATION_RUNBOOK.md` and `migrations/APPLIED.md` — how migrations
   reach the Pilot database and what it holds.

Hard lines: Production (`zhsuhehgehbzkmzurzyf`) is never accessed or changed.
Pilot (`bhmktujbxdbvdmpybmad`) changes only through the runbook, one approved
migration at a time. No credential is ever pasted into chat, code, logs or git.
Never report a browser or live-application test that was not run. Never modify
canonical property, lease, tenant or financial records without the
evidence → proposal → confirmation → audited-change protocol.
