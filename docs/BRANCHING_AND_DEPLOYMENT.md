# MainStreet — Branching & Deployment Strategy

_Long-term workflow for keeping production stable while running a continuous
pilot with real customers (Christy and future pilot users)._

---

## 1. Principles

1. **`main` is sacred.** It powers `mainstreetcam.com` and holds the mainnet
   RLUSD keys. Nothing reaches it except by an intentional, reviewed promotion.
2. **One direction of flow.** Code moves `feature → pilot → main`, never
   sideways. A linear promotion path is what actually prevents merge conflicts —
   `main` is always an ancestor of `pilot`, so promoting is (almost) a
   fast-forward.
3. **Pilot is a persistent staging environment**, not a scratch branch. It has a
   stable URL, its own data, and it is always deployable — that is what lets a
   customer live on it.
4. **Features are small and short-lived.** `claude/*` branches live hours to
   days, then merge and get deleted. Long-lived divergence is the root cause of
   conflicts, so we don't allow it.

---

## 2. Branch topology

| Branch        | Lifetime    | Purpose                                             | Deploys to                          | Env / data          |
|---------------|-------------|----------------------------------------------------|-------------------------------------|---------------------|
| `main`        | Permanent   | Production. Judged, real customers, mainnet RLUSD.  | `mainstreetcam.com` (Production)     | Production secrets  |
| `pilot`       | Permanent   | Customer validation / staging. Always deployable.   | `pilot.mainstreetcam.com` (Preview) | **Pilot** secrets   |
| `claude/*`    | Hours–days  | One feature or fix each. Merged then deleted.       | Auto per-branch preview URL         | Preview secrets     |
| `hotfix/*`    | Hours       | Emergency prod fix. Branches from `main`.           | Auto per-branch preview URL         | Preview secrets     |

```
   claude/feature-x ─┐
   claude/feature-y ─┼──▶  pilot  ──(validate w/ Christy)──▶  main  ──▶  mainstreetcam.com
   claude/fix-z     ─┘   (pilot.mainstreetcam.com)                       (Production)
                                  ▲                                          │
                                  └──────────── back-merge ──────────────────┘
                                        (after any hotfix/* → main)
```

`main` is always an ancestor of `pilot`. Promotion to production never
introduces surprise conflicts because everything on `main` is already on
`pilot`.

---

## 3. Vercel wiring (one-time setup in the dashboard)

Vercel's Git integration already gives us most of this for free.

1. **Production Branch = `main`.** (Settings → Git → Production Branch.) Only
   `main` publishes to the production domain. This is the single switch that
   guarantees "production is never affected until promoted."
2. **Pilot gets a stable, memorable URL.** Every branch already receives a
   deterministic preview alias:
   `mainstreet-git-pilot-<team>.vercel.app`. Give Christy something cleaner by
   assigning a **branch domain** to `pilot`:
   - Settings → Domains → add `pilot.mainstreetcam.com` → **Git Branch: `pilot`**.
   - Now every push to `pilot` auto-deploys and refreshes that one URL. Christy
     bookmarks it once and always sees the latest validated build.
3. **`claude/*` previews are automatic.** Every branch/PR push produces its own
   preview URL for review — no configuration needed. These are ephemeral and
   disappear as branches are deleted.

### Branch names have a hard length budget

Vercel builds the branch preview host as
`<project>-git-<branch-slug>-<team-slug>.vercel.app`, where `<branch-slug>` is
the branch with every non-alphanumeric character turned into `-`. That whole
string is a single **DNS label, capped at 63 characters**. Go over and the
hostname is not merely wrong, it is *illegal* — no DNS server can answer it, so
the browser reports "server can't be found" even though the deployment built
fine and shows **Ready** in the dashboard.

This is easy to miss because `*.vercel.app` is a wildcard: any *valid* name
resolves, including one for a project that doesn't exist. So a name-resolution
failure never means "bad deployment" — it means "illegal hostname".

Budget for this project:

```
63 − len("mainstreet-xrpl") − len("-git-") − 1 − len(<team-slug>) = branch budget
63 −        15             −       5      − 1 −       19          = 23 characters
```

So **keep `claude/*` branch names to ~23 characters or fewer**, counting the
`claude/` prefix. `claude/marketing-homepage` slugifies to 25 and is already
over. `claude/homepage` (15) is safely inside. Shorter is better — the team
slug is the part you don't control, and it can change.

---

## 4. Environment & data isolation (critical for a mainnet app)

Vercel scopes environment variables to **Production**, **Preview**, and
**Development**. Use that boundary as the safety wall:

- **Production env (main only):** mainnet RLUSD issuer/keys, the production
  Supabase project, live Claude API key. Never used by any preview.
- **Preview env (pilot + all `claude/*`):** a **separate Supabase project** for
  pilot data and **XRPL Testnet** (or a clearly separated, non-mainnet RLUSD
  path). This is what lets Christy click around, upload leases, and run
  settlements without ever touching production data or moving real money.
  - Vercel supports **branch-specific Preview variables**, so `pilot` can get a
    dedicated, stable Supabase project while throwaway `claude/*` branches share
    a sandbox one.
- **Rule:** if a value would be dangerous in the wrong hands (a mainnet key, a
  production DB URL), it exists **only** in the Production scope. Preview builds
  physically cannot read it.

> The XRPL Developer Console (`dev-console.js`) already follows this model — it
> self-gates to previews and testnet only. Pilot data isolation is the same idea
> applied to the whole app via env scoping.

---

## 5. Day-to-day workflows

### A. Build a feature
```bash
git fetch origin
git checkout -B claude/<short-name> origin/pilot   # branch off PILOT, not main
# ...work...
git push -u origin claude/<short-name>
# open PR:  base = pilot
```
- **Base every feature branch on `pilot`.** This is the single most important
  conflict-avoidance habit: you develop against the same tree you'll merge into.
- Keep the branch in sync while it's open: `git rebase origin/pilot` (or "Update
  branch" on the PR) before requesting merge. Rebase small, rebase often.
- Review the branch's own preview URL, then **squash-merge into `pilot`** and
  delete the branch.

### B. Continuous customer-feedback loop (the pilot's whole point)
1. Christy uses `pilot.mainstreetcam.com` and reports something.
2. Spin a `claude/<fix>` off `pilot`, fix it, PR into `pilot`.
3. Merge → Vercel redeploys `pilot` in ~1–2 min → **same URL, now fixed.**
4. Christy refreshes and confirms. No new links, no coordination.

This loop can run many times a day without ever risking production.

### C. Promote validated work to production
When a batch on `pilot` has been validated and you intentionally want it live:
```bash
git fetch origin
git checkout -B promote/<date> origin/pilot
# open PR:  base = main,  compare = promote/<date>  (or pilot directly)
```
- Because `main` is an ancestor of `pilot`, this PR is clean.
- Require review + green preview, then **merge into `main`**. Vercel publishes to
  `mainstreetcam.com`.
- Promote in **deliberate batches** (e.g., end of a validation cycle), not
  continuously. That cadence is what "intentional promotion" means.

### D. Emergency production hotfix
```bash
git checkout -B hotfix/<name> origin/main   # branch off MAIN
# fix, PR into main, merge, deploy
git checkout pilot && git merge origin/main # BACK-MERGE so pilot stays ahead
git push
```
- Always back-merge `main → pilot` after a hotfix so `main` never contains a
  commit that `pilot` is missing. This preserves the "main ⊆ pilot" invariant
  that keeps future promotions conflict-free.

---

## 6. Conflict-minimization checklist

- ✅ Branch features off `pilot`; PR them back into `pilot`.
- ✅ Keep feature branches **small and short-lived**; delete after merge.
- ✅ **Rebase on `pilot` frequently** while a branch is open.
- ✅ Keep pilot/prod differences in **environment variables and one config
  file**, never in divergent source code. Config-as-data promotes cleanly; forked
  code does not.
- ✅ Maintain the invariant **`main` ⊆ `pilot`** (back-merge every hotfix).
- ✅ **Squash-merge** to keep history linear and promotions readable.
- ❌ Never commit directly to `main` or `pilot` — always via PR.
- ❌ Never let a `claude/*` branch live for weeks.

---

## 7. GitHub branch protection (recommended settings)

**`main`**
- Require a pull request before merging (≥1 approval).
- Require the Vercel preview check to pass.
- Block direct pushes and force-pushes.
- Restrict who can merge (promotion is a deliberate act).

**`pilot`**
- Require a pull request before merging (lighter — can be self-approved for
  speed during active piloting).
- Require the preview check to pass.
- Block force-pushes.

`claude/*` and `hotfix/*` — no protection; they're disposable.

---

## 8. One-time setup checklist

- [ ] Push `pilot` branch (persistent). ✅ _done with this commit_
- [ ] Vercel: confirm Production Branch = `main`.
- [ ] Vercel: assign `pilot.mainstreetcam.com` → Git Branch `pilot`.
- [ ] Vercel: create a **Pilot Supabase project** + testnet keys; add them as
      branch-scoped Preview env vars for `pilot`.
- [ ] Vercel: verify no Production secret is duplicated into Preview scope.
- [ ] GitHub: apply branch-protection rules above to `main` and `pilot`.
- [ ] Set default PR base to `pilot` (Settings → General → Default branch stays
      `main`, but teach the workflow to target `pilot`).
- [ ] After Make Waves judging, promote this doc + any staged work `pilot → main`.

---

_Once judging is over and production is unfrozen, the promotion path in §5C is
how everything on `pilot` reaches `mainstreetcam.com`._
