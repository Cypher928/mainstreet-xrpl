# Pilot request form — one-time database setup

The three **Request a Pilot** buttons on the marketing page open an in-page
modal that posts to `api/pilot-request.js`. That function writes to a
`pilot_requests` table. **Until the table exists the form returns an error** —
deliberately, because a lead that silently disappears is worse than one that
visibly fails. The modal then shows the email address as plain text so the
visitor still has a way through.

## Which projects

`api/_pilot-target.js` picks the project from `VERCEL_ENV`:

| Where you are | Supabase project |
|---|---|
| Pilot / any preview deployment | **pilot** — `bhmktujbxdbvdmpybmad` |
| Production | **production** — whatever `SUPABASE_URL` points at |

So:

- **To test on the pilot environment now → run it on the PILOT project only.**
- **Before promoting to production → run the same SQL on the PRODUCTION
  project.** If you skip this, the form works on pilot and fails on the live
  site, which is the worst of the three outcomes.

## The SQL

Supabase dashboard → your project → **SQL Editor** → New query → paste → Run.
It is safe to run twice; `if not exists` makes it idempotent.

```sql
create table if not exists public.pilot_requests (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  name        text not null,
  company     text not null,
  email       text not null,
  properties  text not null,
  lease_name  text,
  lease_path  text,
  source      text,
  user_agent  text
);

-- RLS on with NO policies: the service role key used by the serverless
-- function bypasses RLS, and nothing else can read the table. Leads are not
-- readable by any logged-in user, anonymous visitor, or the browser.
alter table public.pilot_requests enable row level security;

create index if not exists pilot_requests_created_at_idx
  on public.pilot_requests (created_at desc);
```

## Optional — keeping the attached sample lease

The modal's file field is optional, and so is this. Without the bucket a
request still saves; only the file is not retained (the row keeps the
filename, so you know to ask for it in your reply).

Dashboard → **Storage** → New bucket → name `pilot-requests` → **Private**.

Leave it private. The function uploads with the service role key; nothing
reads it from the browser.

## Checking it worked

In the SQL editor:

```sql
select created_at, name, company, email, properties, lease_name
from public.pilot_requests
order by created_at desc
limit 20;
```

Submit the form once on the pilot site, then re-run. One row should appear.

## If the form errors

The modal shows the reason it was given. The function distinguishes them:

| Message | Meaning |
|---|---|
| "The pilot_requests table has not been created yet" | the SQL above has not been run on **that** project |
| "Request store is not configured" | `PILOT_SUPABASE_SERVICE_ROLE_KEY` (preview) or `SUPABASE_SERVICE_ROLE_KEY` (production) is missing from the Vercel environment |
| "Could not record the request" | the insert was rejected — check the function logs in Vercel |

Vercel → your project → the deployment → **Functions** → `api/pilot-request`
shows the server-side log line for each failure.
