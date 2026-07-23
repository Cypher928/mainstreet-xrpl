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

## ⏳ Remaining

| Item | Why | Effort |
|---|---|---|
| **A. Disable email confirmation** in pilot Supabase (Authentication → Providers → Email → "Confirm email" off), or pre-create the user | so Create Account / Sign In completes (new-project email quota blocks confirmation mail) | 1 toggle |
| **B. Add `PILOT_SUPABASE_SERVICE_ROLE_KEY`** (Vercel, **Preview** scope) = pilot `sb_secret_…` key | enables file uploads + server-side AI persistence; without it, browsing + login still work | 1 variable |
| B-hygiene. Re-scope prod `SUPABASE_SERVICE_ROLE_KEY` to **Production only** | remove prod secret from the pilot runtime (code already never uses it there) | 1 edit |
| **C. Confirm schema in DB** — run the 8-table + 2-bucket verify query in the pilot SQL editor | I can't read your DB from here; confirms migrations landed | 1 query |

## Cannot verify from the sandbox (no network path to Vercel/Supabase)

These need A+B done, then a ~2-minute live click-through:
- File upload → lands in the **pilot** storage bucket (not production).
- AI features (`claude` / `ask-lease` / `explain`) authenticate against the pilot project.
- Data written in the app appears in the **pilot** DB and **not** in production.
- Settlement panel reads **testnet**.

The code paths for all of the above are verified; only the live runtime needs the
two remaining config items.

## Bottom line
The pilot is **operational for browsing and authentication against the isolated
database right now.** Two small settings (A + B) unlock login and file uploads.
Production is fully isolated and untouched.
