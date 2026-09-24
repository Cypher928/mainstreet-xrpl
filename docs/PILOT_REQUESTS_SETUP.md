# Pilot request form — database setup

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

## The table is a migration: `migrations/031_pilot_requests.sql`

This page used to carry SQL to paste into the SQL editor by hand. That is now
`migrations/031_pilot_requests.sql`. Do not paste the old SQL any more.

What 031 does:

- **Creates the table only if it is missing**, with exactly the columns the old
  SQL created. On Pilot the table already exists (created by hand), so 031
  adopts it: no row is read, changed or removed.
- **Refuses to run** if an existing `pilot_requests` has any other shape (a
  column missing, extra, of another type or nullability, or no primary key),
  rather than leaving a different table under the migration's name.
- Keeps **RLS on with no policies**, and the `created_at desc` index.
- **Grants exactly one privilege: `INSERT` to `service_role`.** The only caller
  is the serverless function, with the service-role key and
  `Prefer: return=minimal`, which needs nothing else. anon and authenticated get
  nothing. Supabase stops granting new tables automatically on October 30,
  2026, so on a project where 031 creates the table this grant is what lets the
  form work at all. On Pilot it narrows the old automatic grant (every
  privilege, for every API role) to that one.

`tools/verify-migration-031.js` runs 031 against a throwaway local PostgreSQL:
the hand-made-table path with existing leads, the new-table path, the refusals,
and the function's insert in the statement shape PostgREST sends.

The rollback (`031_pilot_requests_rollback.sql`) restores the old grants and
**never drops the table** — it holds real leads.

**Production** is a separate decision. 031 is written for Pilot; applying it to
the production project needs its own explicit authorization.

Leads are read in the SQL editor, as the table owner. After 031 they cannot be
read through the Data API with any key, including the service-role key; that is
intended.

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
| "The pilot_requests table has not been created yet" | `migrations/031_pilot_requests.sql` has not been applied to **that** project |
| "Request store is not configured" | `PILOT_SUPABASE_SERVICE_ROLE_KEY` (preview) or `SUPABASE_SERVICE_ROLE_KEY` (production) is missing from the Vercel environment |
| "Could not record the request" | the insert was rejected — check the function logs in Vercel. `permission denied for table pilot_requests` means the `service_role` INSERT grant is missing: apply 031 |

Vercel → your project → the deployment → **Functions** → `api/pilot-request`
shows the server-side log line for each failure.
