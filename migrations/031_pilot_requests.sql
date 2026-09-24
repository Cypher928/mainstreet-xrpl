-- ============================================================================
-- 031_pilot_requests.sql — the "Request a Pilot" lead table, as a migration
-- ============================================================================
-- TARGET: PILOT PROJECT (bhmktujbxdbvdmpybmad). Written so it is also correct
-- on a project where the table does not exist yet, but it is NOT to be run on
-- production as part of this change.
--
-- Until now this table was created by hand from docs/PILOT_REQUESTS_SETUP.md.
-- This file replaces that manual step. It is written to ADOPT the table Pilot
-- already has without touching a row:
--
--   * `create table if not exists` — on Pilot the table exists, so nothing is
--     created or rewritten.
--   * A shape guard then REFUSES TO RUN if an existing table differs in any
--     column name, type, nullability or default, or lacks the primary key —
--     rather than silently leaving a different table in place under this
--     migration's name. Pilot's live table was read (catalog only) and matches
--     the definition below exactly.
--   * `enable row level security` and `create index if not exists` are no-ops
--     where they already hold.
--   * No UPDATE, DELETE, TRUNCATE, ALTER COLUMN or DROP of any kind.
--
-- PRIVILEGES — the only thing that changes on Pilot
-- -------------------------------------------------
-- The one caller is api/pilot-request.js, server-side, with the service-role
-- key: `POST /rest/v1/pilot_requests` with `Prefer: return=minimal`. Nothing on
-- any branch reads, updates or deletes the table through the API; leads are read
-- in the SQL editor as the table owner.
--
--   service_role   INSERT   api/pilot-request.js. `return=minimal` asks
--                           PostgREST for no row back, so its statement is
--                           `INSERT … RETURNING 1`, which reads no column and
--                           needs no SELECT privilege. tools/verify-migration-031.js
--                           executes that statement shape as service_role.
--   authenticated  none
--   anon           none     The browser never touches this table; the form posts
--                           to the serverless function.
--
-- On Pilot the table was created before October 30, 2026, so it still carries
-- Supabase's automatic grant: EVERY privilege for anon, authenticated and
-- service_role. RLS with no policies has kept anon and authenticated from
-- reading rows, but the grant-level defence was absent. Revoke-then-grant makes
-- Pilot and any newly built project reach the same exact set.
--
-- Safe to re-run.
-- ============================================================================

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

-- The shape guard. Compares the live table to the definition above.
do $$
declare
  expected text := 'company:text:NO:' || chr(10) ||
                   'created_at:timestamp with time zone:NO:now()' || chr(10) ||
                   'email:text:NO:' || chr(10) ||
                   'id:uuid:NO:gen_random_uuid()' || chr(10) ||
                   'lease_name:text:YES:' || chr(10) ||
                   'lease_path:text:YES:' || chr(10) ||
                   'name:text:NO:' || chr(10) ||
                   'properties:text:NO:' || chr(10) ||
                   'source:text:YES:' || chr(10) ||
                   'user_agent:text:YES:';
  actual text;
  pk     text;
begin
  select string_agg(column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, ''),
                    chr(10) order by column_name)
    into actual
    from information_schema.columns
   where table_schema = 'public' and table_name = 'pilot_requests';

  if actual is distinct from expected then
    raise exception 'REFUSING TO RUN: public.pilot_requests exists with a different shape. Expected [%] found [%]',
      replace(expected, chr(10), ', '), replace(coalesce(actual, ''), chr(10), ', ');
  end if;

  select string_agg(a.attname, ',' order by a.attname)
    into pk
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
   where c.conrelid = 'public.pilot_requests'::regclass and c.contype = 'p';

  if pk is distinct from 'id' then
    raise exception 'REFUSING TO RUN: public.pilot_requests primary key is %, expected id', coalesce(pk, '(none)');
  end if;
end $$;

-- RLS on with NO policies: only the table owner and BYPASSRLS roles see rows.
alter table public.pilot_requests enable row level security;

create index if not exists pilot_requests_created_at_idx
  on public.pilot_requests (created_at desc);

revoke all on public.pilot_requests from anon, authenticated, service_role;
grant insert on public.pilot_requests to service_role;
