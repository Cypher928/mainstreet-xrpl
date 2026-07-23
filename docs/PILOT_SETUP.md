# Pilot Environment Setup — full isolation from production

Goal: the `pilot` branch's preview becomes the **permanent, isolated** customer
validation environment. Production and pilot share **no** database, secrets, or
XRPL money path. This guide is the one-time setup; the client-side routing code
(`supabase-config.js`) is already done and waits only on the pilot project's
credentials (Step 4).

**Isolation model (already implemented):** the browser picks its Supabase
project by hostname — `mainstreetcam.com` → production project; **everything else
(localhost + every `*.vercel.app` preview, including pilot) → the pilot
project.** Fail-safe: anything not on the production allowlist routes to pilot,
so a preview can never touch production data. The serverless functions (`api/*`)
pick their project from `process.env`, scoped per Vercel environment (Step 3).

Do all of this with `main` frozen — no production change is required.

---

## Step 1 — Create the pilot Supabase project
1. Supabase dashboard → **New project** (same org). Name it e.g. `mainstreet-pilot`.
2. Choose a strong DB password (store it in your password manager).
3. Wait for it to provision.

## Step 2 — Create schema + storage (one paste)
1. **SQL Editor → New query.** Open **`docs/pilot-migrations-bundle.sql`**, copy
   the whole file, paste, **Run.** It creates the base tables (`000_base_schema`:
   `properties`, `tenants`), then runs migrations 001–009 in order, **and**
   creates the two required **public** storage buckets (`leases`, `invoices`).
   It's idempotent — safe to re-run.
   - Prefer running them separately? The individual files are
     `migrations/000…009_*.sql` in that order (000 first — a fresh project has no
     `properties`/`tenants` tables, and 001 FKs to them).
     `008b_verification_queries.sql` is read-only checks — optional.
   - The buckets must be **public**: uploads return `/object/public/…` URLs
     (`api/upload.js:151`) that the app and Evidence Viewer fetch directly.
     Uploads themselves go through the service-role key, so no extra object
     policies are required for the basic flow.

## Step 3 — Vercel Preview env var → ONE variable
Project selection is now host/environment-based in code, so almost nothing needs
Vercel config:
- **Client** picks the project by hostname (`supabase-config.js`).
- **Serverless** picks by `VERCEL_ENV` (`api/_pilot-target.js`): `production`
  keeps its existing env vars unchanged; every preview uses the pilot project's
  URL + publishable key (embedded, safe) and **testnet**.

The only value that can't be embedded is the pilot **service-role secret**. Add
exactly one variable:

| Variable | Environment | Value |
|---|---|---|
| `PILOT_SUPABASE_SERVICE_ROLE_KEY` | **Preview** only | pilot project's **secret** key (`sb_secret_…`, from pilot Supabase → Settings → API) |

That's the whole required server config. `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
`XRPL_NETWORK`, etc. do **not** need Preview values anymore — the code supplies
them for previews.

**Recommended hygiene (defense in depth):** the pilot code never reads the
production `SUPABASE_SERVICE_ROLE_KEY` on a preview, but if that variable is
currently scoped to Preview/"All Environments," edit it to **Production only** so
the prod secret isn't even present in the pilot runtime. (We already did this for
`XRPL_SETTLEMENT_WALLET_SEED` and `..._ADDRESS`.)

> The settlement endpoint (`api/rlusd-settlement.js`) is read-only and holds no
> wallet seed, so pilot cannot move funds regardless; on preview it now reads
> **testnet** automatically.

## Step 4 — (done) pilot URL + publishable key are wired
The pilot Project URL and publishable key are already embedded in
`supabase-config.js` (client) and `api/_pilot-target.js` (server). Anon/publishable
keys are public by design — RLS enforces access — so committing them is safe.
Nothing further is needed here.

---

## Two gotchas to handle before Christy logs in

### A. Preview deployments are Vercel-auth-protected (she's external)
This project relies on Vercel Authentication protecting previews (see
`script.js:15-18`). That means a `*.vercel.app` preview URL currently shows a
**Vercel login wall** to anyone outside your team — Christy would be blocked.
Before sharing, in Vercel → Project → Settings → **Deployment Protection**, do
one of:
- Disable **Vercel Authentication** for Preview deployments, **or**
- Use a **Protection Bypass / shareable link** so Christy gets in without a
  Vercel account.

(This is also why the custom `pilot.mainstreetcam.com` domain was deferred — the
stable `*.vercel.app` URL is fine once protection allows her in.)

### B. Auth emails redirect to the production domain
`PUBLIC_APP_URL` sends password-reset / signup-confirmation links to
`mainstreetcam.com` on any non-localhost host (`script.js:19-21`) — deliberately,
to avoid the preview auth wall during recovery. On pilot that means a
confirmation/reset email would open the **production** app (production project),
not pilot. For the first pilot user, sidestep it:
- **Pre-create Christy's account in the pilot project** (Supabase → Authentication
  → Add user), with her email **pre-confirmed** and a temporary password. She logs
  in directly — no confirmation email needed.

If self-serve signup/reset on pilot is wanted later, that's a small follow-up
(make `PUBLIC_APP_URL` host-aware for the pilot preview) — out of scope for first
validation.

---

## Verification checklist (after Step 4)
- [ ] Load the pilot preview → DevTools console shows
      `[supabase-config] Supabase target = pilot`.
- [ ] Sign in as Christy's pilot account; confirm data reads/writes.
- [ ] In the pilot Supabase **Table editor**, confirm her rows appear **there**,
      and in the **production** project they do **not**.
- [ ] Settlement panel shows **testnet** (not mainnet).
- [ ] Production (`mainstreetcam.com`) still shows
      `Supabase target = production` and behaves identically.

Once these pass, the pilot environment is fully isolated and safe to share.
