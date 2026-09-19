-- ─── 030_property_events_derive — Phase 0, P0.5 ─────────────────────────────
--
-- Durable property history, derived inside the transaction that already writes
-- the history.
--
-- WHY THERE IS NO OUTBOX
--   An outbox exists to bridge two writes that cannot share a transaction.
--   Here they already do. script.js savePropertyData() puts the activity log
--   and the timeline into `prop.activityLog` / `prop.timeline`, and
--   saveProperty() sends them inside `data` in ONE PostgREST call — one
--   statement, one transaction. So the history is already atomic with the
--   property mutation; it is simply trapped in a JSON blob.
--
--   This migration makes the database read that blob on write and record each
--   entry as a real property_events row. An AFTER row trigger runs in the
--   transaction that fired it, so the durable event commits with the property
--   or not at all. If the browser dies after the save returns, nothing is
--   lost: the event was already committed. If it dies before, the property
--   mutation is lost too — history and change go together, which is the
--   correct outcome and is not something this migration can or should change.
--
-- THE INVARIANT, AND ITS PRICE
--   Property mutation and durable history commit together, or neither does. A
--   genuine database failure in this trigger therefore fails the save. That is
--   deliberate: the alternative is a UI that reports success while history is
--   silently gone. The function is written to be TOTAL over malformed input so
--   that only real database failures can do this — a legacy entry with a
--   missing field, a bad timestamp, a 400-character type or a non-object array
--   element is skipped or clamped, never raised on.
--
-- ── THE WATERMARK ──────────────────────────────────────────────────────────
-- Existing blobs hold up to 200 activity entries and any number of timeline
-- entries whose `actor` is a display string — 'User', 'Reviewer', 'System'.
-- Their real authenticated identity is not recoverable, so they must NEVER be
-- converted into property_events: apparently-verified history with an invented
-- actor is worse than no history. The rule is deterministic, not time-based,
-- and differs per family because their identities differ:
--
--   ACTIVITY  derive an entry only if it carries a stable `id`.
--             AuditService.shapeEvent assigns that id at creation from P0.5
--             onward. Every entry written before P0.5 lacks the field
--             entirely, so it is excluded by construction, permanently, with
--             no clock involved. A pre-P0.5 browser tab still running after
--             this migration also writes id-less entries, and they are
--             likewise never derived — it cannot manufacture history.
--
--   TIMELINE  appendPropertyTimelineEvent has always assigned an `id`, so
--             presence cannot separate old from new. Instead this migration
--             captures, ONCE AND NOW, the key of every timeline entry that
--             already exists on every property, into
--             property_events_watermark.legacy_timeline_keys. A key in that
--             array is pre-existing forever. Anything else is new.
--             Capturing at migration time rather than lazily on first save is
--             what makes it exact: at this instant no post-P0.5 entry can
--             exist yet, so the classification has no ambiguous case and no
--             property loses its first new event to the watermark.
--
--   A property created AFTER this migration has no watermark row. Everything
--   in it is new by definition, and an absent row reads as an empty legacy
--   set, so its timeline derives from the first entry onward.
--
--   Consequences, both required by the design:
--     · saving an unchanged property derives nothing — every key is either
--       suppressed or already recorded;
--     · saving after adding one entry derives exactly that one.
--
-- ── IDEMPOTENCY ────────────────────────────────────────────────────────────
-- source_key is the entry's stable identity, namespaced per family:
--   activity:<AuditService id>
--   timeline:<metadata.dedupeKey, else id>
-- dedupeKey is preferred for the timeline because it is the identity that
-- survives a reload: appendPropertyTimelineEventOnce re-creates the same
-- logical event with a fresh random `id` but the same key, and the database
-- must treat that as the same event. A partial unique index on
-- (property_id, source_key) enforces it, and every insert is ON CONFLICT DO
-- NOTHING. Note that DO NOTHING is not a preference: 028b refuses any UPDATE
-- that is not a foreign key's own SET NULL, so DO UPDATE would be rejected.
-- The append-only contract is not weakened anywhere here.
--
-- ── WHAT THIS DOES NOT FIX ─────────────────────────────────────────────────
--   · The 800 ms debounce in savePropertyData(), with no pagehide flush
--     anywhere in the codebase. A tab that dies inside it loses the property
--     mutation AND its history together. Pre-existing; a separate item.
--   · Storage-first uploads. api/upload.js writes the object over its own HTTP
--     call, outside any database transaction, and the event is recorded by the
--     later blob save. Pre-existing; a separate item.
--
-- PILOT ONLY. Same marker guard. Idempotent. Rollback: 030_property_events_derive_rollback.sql.

begin;

do $$
begin
  if not exists (
    select 1 from public.properties
    where id = 'fd9c09b1-b657-4c58-9999-c3cce28e7600'
  ) then
    raise exception
      'REFUSING TO RUN: pilot marker property not found. This does not appear to be the pilot project (bhmktujbxdbvdmpybmad). 030 must never be applied to production.';
  end if;
end $$;

-- ── The entry's stable identity, on the event row ──────────────────────────
alter table public.property_events
  add column if not exists source_key text;

comment on column public.property_events.source_key is
  'P0.5: the identity of the blob entry this event was derived from — activity:<id> or timeline:<dedupeKey|id>. Unique per property, so a replayed save cannot duplicate history. NULL for events written directly rather than derived.';

create unique index if not exists property_events_source_key_uniq
  on public.property_events (property_id, source_key)
  where source_key is not null;

-- ── The watermark ──────────────────────────────────────────────────────────
create table if not exists public.property_events_watermark (
  property_id          uuid        primary key references public.properties(id) on delete cascade,
  established_at       timestamptz not null default now(),
  legacy_timeline_keys text[]      not null default '{}'
);

comment on table public.property_events_watermark is
  'P0.5: which blob history already existed when derivation was switched on. A timeline key listed here predates P0.5 and is never converted into a property_events row, because its authenticated actor is not recoverable. Activity entries need no list — they are identified by the stable id that only a post-P0.5 client emits.';

-- Internal bookkeeping. No application role reads or writes this; the derive
-- function is security definer and reaches it as the owner.
alter table public.property_events_watermark enable row level security;
revoke all on public.property_events_watermark from public, anon, authenticated, service_role;

-- ── A cast that cannot fail ────────────────────────────────────────────────
-- Legacy entries carry whatever the browser put in `timestamp`. A bad value
-- must skip the field, not abort a property save.
create or replace function public._p05_safe_ts(t text)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
begin
  if t is null or btrim(t) = '' then return null; end if;
  return t::timestamptz;
exception when others then
  return null;
end $$;

-- ── The derivation ─────────────────────────────────────────────────────────
-- Security definer so it reaches property_events and the watermark as the
-- owner: property_id comes from the row being written, never from caller
-- input, so there is nothing for a caller to steer. actor_uid and
-- organization_id are deliberately NOT supplied — 028b's stamp trigger sets
-- actor_uid from auth.uid() and derives organization_id from property_id, and
-- that remains the only source of both.
create or replace function public._property_events_derive()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_legacy text[] := '{}';
begin
  if new.data is null or jsonb_typeof(new.data) <> 'object' then
    return null;
  end if;

  select w.legacy_timeline_keys into v_legacy
  from public.property_events_watermark w
  where w.property_id = new.id;
  if v_legacy is null then v_legacy := '{}'; end if;

  -- ACTIVITY — only entries carrying a stable id.
  if jsonb_typeof(new.data->'activityLog') = 'array' then
    insert into public.property_events
      (property_id, action, subject_type, subject_id, detail, client_ts, source_key)
    select
      new.id,
      left(coalesce(nullif(btrim(e->>'type'), ''), 'unknown'), 80),
      nullif(btrim(coalesce(e->>'relatedEntity', '')), ''),
      nullif(btrim(coalesce(e->>'tenantId', '')), ''),
      jsonb_build_object(
        'source',       'activityLog',
        'title',        coalesce(e->>'title', ''),
        'detail',       coalesce(e->>'detail', ''),
        'severity',     coalesce(e->>'severity', 'info'),
        'client_actor', coalesce(e->>'actor', '')
      ),
      coalesce(public._p05_safe_ts(e->>'timestamp'), now()),
      'activity:' || btrim(e->>'id')
    from jsonb_array_elements(new.data->'activityLog') e
    where jsonb_typeof(e) = 'object'
      and nullif(btrim(coalesce(e->>'id', '')), '') is not null
    on conflict (property_id, source_key) where source_key is not null do nothing;
  end if;

  -- TIMELINE — anything whose key was not already there at the watermark.
  if jsonb_typeof(new.data->'timeline') = 'array' then
    insert into public.property_events
      (property_id, action, subject_type, subject_id, detail, client_ts, source_key)
    select
      new.id,
      left(coalesce(nullif(btrim(q.e->>'type'), ''), 'unknown'), 80),
      nullif(btrim(coalesce(q.e->>'source', '')), ''),
      nullif(btrim(coalesce(q.e->>'tenantId', '')), ''),
      jsonb_build_object(
        'source',       'timeline',
        'title',        coalesce(q.e->>'title', ''),
        'description',  coalesce(q.e->>'description', ''),
        'severity',     coalesce(q.e->>'severity', 'info'),
        'client_actor', coalesce(q.e->>'actor', ''),
        'category',     coalesce(q.e->>'category', '')
      ),
      coalesce(public._p05_safe_ts(q.e->>'timestamp'), now()),
      'timeline:' || q.k
    from (
      select e,
             coalesce(
               nullif(btrim(coalesce(e->'metadata'->>'dedupeKey', '')), ''),
               nullif(btrim(coalesce(e->>'id', '')), '')
             ) as k
      from jsonb_array_elements(new.data->'timeline') e
      where jsonb_typeof(e) = 'object'
    ) q
    where q.k is not null
      and not (q.k = any (v_legacy))
    on conflict (property_id, source_key) where source_key is not null do nothing;
  end if;

  return null;
end $$;

drop trigger if exists property_events_derive on public.properties;
create trigger property_events_derive
  after insert or update of data on public.properties
  for each row execute function public._property_events_derive();

-- ── Seed the watermark: everything that exists RIGHT NOW is pre-existing ───
-- Run after the trigger is created, but it touches only the watermark table,
-- so the trigger does not fire and no event is derived. No historical entry
-- becomes a property_events row here or ever.
insert into public.property_events_watermark (property_id, legacy_timeline_keys)
select p.id,
       coalesce((
         select array_agg(s.k)
         from (
           select coalesce(
                    nullif(btrim(coalesce(e->'metadata'->>'dedupeKey', '')), ''),
                    nullif(btrim(coalesce(e->>'id', '')), '')
                  ) as k
           from jsonb_array_elements(
                  case when jsonb_typeof(p.data->'timeline') = 'array'
                       then p.data->'timeline' else '[]'::jsonb end) e
           where jsonb_typeof(e) = 'object'
         ) s
         where s.k is not null
       ), '{}'::text[])
from public.properties p
on conflict (property_id) do nothing;

commit;

-- ── Verify (run after commit) ──────────────────────────────────────────────
-- select count(*) from public.property_events;                        -- unchanged: no backfill
-- select count(*) from public.property_events_watermark;              -- one row per existing property
-- select count(*) from public.property_events where source_key is not null;  -- 0 until the next save
-- A save that changes nothing must add nothing; a save carrying one new
-- id-bearing activity entry must add exactly one row, with actor_uid =
-- auth.uid() and organization_id taken from the property.
