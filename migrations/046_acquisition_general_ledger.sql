-- ============================================================================
-- 046_acquisition_general_ledger.sql — a general ledger, imported by the server
-- from the stored original, linked to it, reversible, with durable history
-- ============================================================================
-- TARGET: PILOT PROJECT (bhmktujbxdbvdmpybmad) ONLY. Refuses to run unless the
-- Pilot marker property exists. NOT APPLIED. Requires phase0/029 (the ledger
-- tables), 034 (acquisition documents on properties), 036 and 045 (member write
-- rules: no client INSERT on financial_sources / gl_entries — kept that way).
-- Verified by tools/verify-migration-046.js and tools/verify-ledger-import-
-- endpoint.js (the endpoints against this function, storage emulated).
--
-- THE PATH (Financial Intake, increment one; docs/ACQUISITION_REVIEW.md P1-5)
--   The browser previews a CSV ledger (gl-import.js) and sends ONLY: which
--   document, the date order a person chose, an override reason, and what the
--   preview showed (lines, totals, the file's sha256). api/_ledger-import.js then
--   reads the document as that person (row rules apply), downloads the stored
--   original itself, hashes it, parses it with the same gl-import.js, compares
--   its result with the preview, and calls import_general_ledger as service_role
--   with the acting person named. Rows, totals and fingerprint are the server's;
--   nothing the browser sends is imported.
--
-- WHAT IT ADDS (no existing object is rewritten; 045's grants are kept)
--   financial_sources  + acquisition_document_id (→ acquisition_documents,
--                        cascade), import_status (active | reversed), file_sha256,
--                        file_bytes, storage_path, date_order, reversed_at / _by,
--                        reversal_reason. One ACTIVE import per document, and per
--                        property + file.
--   gl_entries         + posted_on, reference, source_row; a line is a debit or a
--                        credit, not both.
--   gl_entry_sources   every import's claim on every line it contained — the
--                        lines it inserted AND the identical lines already there.
--                        This is what makes overlapping imports reversible.
--   gl_entries_reversed  lines a reversal removed, kept (with the property).
--   ledger_import_history  append-only: every import, reversal and removal of
--                        evidence — who, when, which document and stored file
--                        (path, sha256, bytes), date order, counts, totals and
--                        reasons. No foreign keys: it outlives the prospect.
--                        Retention (provisional): seven years after a property's
--                        last event once the property is gone; purged only by
--                        purge_ledger_import_history().
--   import_general_ledger(...)  service_role only. All or nothing.
--   reverse_general_ledger_import(...)  service_role only; the person must be a
--                        property admin (owner or organisation admin), give a
--                        reason, and the acquisition must still be open.
--   storage: two RESTRICTIVE policies — an object an acquisition document points
--                        at cannot be updated (overwritten, moved) or deleted by a
--                        signed-in person.
--
-- DUPLICATES
--   The same file again (same document, or the same bytes filed as another
--   document) writes nothing and returns the earlier import. Another reading of
--   it (another date order, or another file for the document) is refused.
--   A line already present (same canonical key → row_hash, unique per property)
--   is counted only if it belongs to an ACTIVE acquisition import AND holds the
--   same content. A line with no such import behind it — source-less, filed
--   another way, or differing — refuses the whole import: an untrusted row can
--   no longer make a real one be skipped.
--
-- DATES  The server parses with the date order the person chose (or the file
--   proved); the order is recorded and must match the preview.
--
-- LIMITS (provisional, to be calibrated on the real platform)
--   file   ≤ 3,489,792 bytes — what /api/upload can store (Vercel's body limit)
--   lines  ≤ 10,000 per import (gl-import.js IMPORT_MAX_ROWS; asserted equal)
--   time   PostgREST may run this with the 8 s statement limit Pilot sets on
--          authenticator; measured locally in the verifier. A timeout rolls the
--          whole import back.
--
-- NOT CHANGED: the CAM tab's GL import (script.js) and the CAM invoice pool —
-- nothing here reads or writes properties.data.
--
-- ROLLBACK: 046_acquisition_general_ledger_rollback.sql. It refuses while any
-- acquisition ledger, reversed line or history row exists.
-- ============================================================================

begin;

do $$
begin
  if not exists (select 1 from public.properties where id = 'fd9c09b1-b657-4c58-9999-c3cce28e7600') then
    raise exception 'REFUSING TO RUN: pilot marker property not found. This does not appear to be the pilot project (bhmktujbxdbvdmpybmad). 046 must never be applied to production.';
  end if;
  if to_regclass('public.financial_sources') is null or to_regclass('public.gl_entries') is null then
    raise exception '046 requires phase0/029 (financial_sources, gl_entries)';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'acquisition_documents' and column_name = 'property_id') then
    raise exception '046 requires 034 (acquisition_documents.property_id)';
  end if;
  if to_regprocedure('public.can_edit_property(uuid)') is null
     or has_table_privilege('authenticated', 'public.gl_entries', 'INSERT') then
    raise exception '046 requires 045 (member write rules: no client INSERT on the ledger tables)';
  end if;
  if to_regclass('storage.objects') is null then
    raise exception '046 requires Supabase storage (storage.objects)';
  end if;
end $$;

-- ── financial_sources: an acquisition import ────────────────────────────────
alter table public.financial_sources add column if not exists acquisition_document_id uuid;
alter table public.financial_sources add column if not exists import_status   text;
alter table public.financial_sources add column if not exists file_sha256     text;
alter table public.financial_sources add column if not exists file_bytes      bigint;
alter table public.financial_sources add column if not exists file_etag       text;      -- storage's own fingerprint of the object at import, when it offers one
alter table public.financial_sources add column if not exists storage_path    text;
alter table public.financial_sources add column if not exists date_order      text;
alter table public.financial_sources add column if not exists reversed_at     timestamptz;
alter table public.financial_sources add column if not exists reversed_by     uuid;
alter table public.financial_sources add column if not exists reversal_reason text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'financial_sources_acquisition_document_fk') then
    alter table public.financial_sources add constraint financial_sources_acquisition_document_fk
      foreign key (acquisition_document_id) references public.acquisition_documents(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'financial_sources_one_document_link') then
    alter table public.financial_sources add constraint financial_sources_one_document_link
      check (num_nonnulls(document_id, acquisition_document_id) <= 1);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'financial_sources_acq_import_shape') then
    alter table public.financial_sources add constraint financial_sources_acq_import_shape check (
      (acquisition_document_id is null and import_status is null and file_sha256 is null and file_bytes is null
         and storage_path is null and date_order is null and reversed_at is null and reversed_by is null and reversal_reason is null)
      or (acquisition_document_id is not null and kind = 'general_ledger'
          and import_status in ('active', 'reversed')
          and file_sha256 ~ '^[0-9a-f]{64}$' and file_bytes > 0 and length(storage_path) > 0
          and date_order in ('iso', 'mdy', 'dmy')
          and ((import_status = 'active' and reversed_at is null and reversed_by is null and reversal_reason is null)
            or (import_status = 'reversed' and reversed_at is not null and reversed_by is not null and length(btrim(reversal_reason)) > 0))));
  end if;
end $$;
create unique index if not exists financial_sources_acq_active_document_uniq
  on public.financial_sources (acquisition_document_id) where import_status = 'active';
create unique index if not exists financial_sources_acq_active_file_uniq
  on public.financial_sources (property_id, file_sha256) where import_status = 'active';
create index if not exists financial_sources_acq_document_idx
  on public.financial_sources (acquisition_document_id) where acquisition_document_id is not null;

-- ── gl_entries: the line's date, reference and sheet row ────────────────────
alter table public.gl_entries add column if not exists posted_on  date;
alter table public.gl_entries add column if not exists reference  text;
alter table public.gl_entries add column if not exists source_row integer;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'gl_entries_source_row_check') then
    alter table public.gl_entries add constraint gl_entries_source_row_check check (source_row is null or source_row > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'gl_entries_one_side_check') then
    alter table public.gl_entries add constraint gl_entries_one_side_check check (coalesce(debit, 0) = 0 or coalesce(credit, 0) = 0);
  end if;
end $$;
create index if not exists gl_entries_property_posted_idx on public.gl_entries (property_id, posted_on) where posted_on is not null;

-- ── every import's claim on every line ──────────────────────────────────────
create table if not exists public.gl_entry_sources (
  gl_entry_id uuid    not null references public.gl_entries(id) on delete cascade,
  source_id   uuid    not null references public.financial_sources(id) on delete cascade,
  property_id uuid    not null references public.properties(id) on delete cascade,
  source_row  integer not null check (source_row > 0),
  created_at  timestamptz not null default now(),
  primary key (gl_entry_id, source_id)
);
create index if not exists gl_entry_sources_source_idx on public.gl_entry_sources (source_id);

-- ── lines a reversal removed ────────────────────────────────────────────────
create table if not exists public.gl_entries_reversed (
  id               uuid primary key,
  property_id      uuid not null references public.properties(id) on delete cascade,
  reversed_source  uuid not null,
  history_id       uuid not null,
  posted_on        date, account_code text, account_name text, description text, vendor text, reference text,
  debit            numeric(14,2), credit numeric(14,2), amount numeric(14,2),
  source_row       integer, row_hash text not null,
  line_created_at  timestamptz not null,
  reversed_at      timestamptz not null default now()
);

-- ── append-only import history ──────────────────────────────────────────────
create table if not exists public.ledger_import_history (
  id                      uuid        primary key default gen_random_uuid(),
  action                  text        not null check (action in ('import', 'reverse', 'evidence_removed', 'evidence_mismatch')),
  occurred_at             timestamptz not null default now(),
  actor_uid               uuid,
  property_id             uuid        not null,
  review_id               uuid,
  acquisition_document_id uuid,
  source_id               uuid,
  storage_path            text,
  file_sha256             text,
  file_bytes              bigint,
  date_order              text,
  lines                   integer,
  inserted                integer,
  already_present         integer,
  debit_cents             bigint,
  credit_cents            bigint,
  balanced                boolean,
  override_reason         text,
  reason                  text,
  detail                  jsonb       not null default '{}'::jsonb
);
create index if not exists ledger_import_history_property_idx on public.ledger_import_history (property_id, occurred_at);
create index if not exists ledger_import_history_actor_idx on public.ledger_import_history (actor_uid, occurred_at) where action = 'import';

create or replace function public.ledger_import_history_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'TRUNCATE' then
    raise exception 'ledger_import_history is append-only' using errcode = 'insufficient_privilege';
  end if;
  if tg_op = 'DELETE' and coalesce(current_setting('mainstreet.ledger_history_purge', true), '') = 'on' then
    return old;
  end if;
  raise exception 'ledger_import_history is append-only (%)', tg_op using errcode = 'insufficient_privilege';
end;
$$;
revoke all on function public.ledger_import_history_append_only() from public, anon, authenticated;
drop trigger if exists ledger_import_history_append_only on public.ledger_import_history;
create trigger ledger_import_history_append_only
  before update or delete on public.ledger_import_history
  for each row execute function public.ledger_import_history_append_only();
drop trigger if exists ledger_import_history_no_truncate on public.ledger_import_history;
create trigger ledger_import_history_no_truncate
  before truncate on public.ledger_import_history
  for each statement execute function public.ledger_import_history_append_only();

-- ── row rules and grants for the three new tables ───────────────────────────
alter table public.gl_entry_sources      enable row level security;
alter table public.gl_entries_reversed   enable row level security;
alter table public.ledger_import_history enable row level security;
revoke all on public.gl_entry_sources, public.gl_entries_reversed, public.ledger_import_history from public, anon, authenticated, service_role;
grant select on public.gl_entry_sources, public.gl_entries_reversed, public.ledger_import_history to authenticated, service_role;
drop policy if exists gl_entry_sources_member_select      on public.gl_entry_sources;
drop policy if exists gl_entries_reversed_member_select   on public.gl_entries_reversed;
drop policy if exists ledger_import_history_member_select on public.ledger_import_history;
create policy gl_entry_sources_member_select on public.gl_entry_sources
  for select to authenticated using (property_id in (select public.member_property_ids()));
create policy gl_entries_reversed_member_select on public.gl_entries_reversed
  for select to authenticated using (property_id in (select public.member_property_ids()));
create policy ledger_import_history_member_select on public.ledger_import_history
  for select to authenticated using (property_id in (select public.member_property_ids()));

-- ── who the acting person is, for the service-role functions ────────────────
-- service_role has no auth.uid(); these answer for a named person and are
-- executable only by service_role.
create or replace function public.ledger_actor_may_edit(p_actor uuid, p_property uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_actor is not null and exists (
    select 1 from public.properties p
     where p.id = p_property
       and (p.user_id = p_actor
            or (p.organization_id is not null and exists (
                  select 1 from public.organization_members m
                   where m.organization_id = p.organization_id and m.user_id = p_actor
                     and m.accepted_at is not null and m.revoked_at is null and m.role <> 'read_only'))))
$$;
create or replace function public.ledger_actor_is_admin(p_actor uuid, p_property uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_actor is not null and exists (
    select 1 from public.properties p
     where p.id = p_property
       and (p.user_id = p_actor
            or (p.organization_id is not null and exists (
                  select 1 from public.organization_members m
                   where m.organization_id = p.organization_id and m.user_id = p_actor
                     and m.accepted_at is not null and m.revoked_at is null and m.role = 'admin'))))
$$;
revoke all on function public.ledger_actor_may_edit(uuid, uuid) from public, anon, authenticated;
revoke all on function public.ledger_actor_is_admin(uuid, uuid) from public, anon, authenticated;
grant execute on function public.ledger_actor_may_edit(uuid, uuid) to service_role;
grant execute on function public.ledger_actor_is_admin(uuid, uuid) to service_role;

-- ── guard: an acquisition source is written and changed only by the functions
create or replace function public.financial_sources_acq_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  c_mutable constant text[] := array['import_status', 'reversed_at', 'reversed_by', 'reversal_reason', 'updated_at'];
begin
  if tg_op = 'INSERT' then
    if new.acquisition_document_id is not null
       and coalesce(current_setting('mainstreet.gl_import_document', true), '') <> new.acquisition_document_id::text then
      raise exception 'A ledger is filed against an acquisition document only by import_general_ledger' using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;
  if old.acquisition_document_id is null and new.acquisition_document_id is null then
    return new;
  end if;
  if (to_jsonb(new) - c_mutable) is distinct from (to_jsonb(old) - c_mutable) then
    raise exception 'An imported ledger source does not change (only a reversal marks it reversed)' using errcode = 'insufficient_privilege';
  end if;
  if (new.import_status, new.reversed_at, new.reversed_by, new.reversal_reason) is distinct from (old.import_status, old.reversed_at, old.reversed_by, old.reversal_reason)
     and (old.import_status <> 'active' or new.import_status <> 'reversed'
          or coalesce(current_setting('mainstreet.gl_reverse_source', true), '') <> old.id::text) then
    raise exception 'An import is reversed only by reverse_general_ledger_import' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;
revoke all on function public.financial_sources_acq_guard() from public, anon, authenticated;
drop trigger if exists financial_sources_acq_guard on public.financial_sources;
create trigger financial_sources_acq_guard
  before insert or update on public.financial_sources
  for each row execute function public.financial_sources_acq_guard();

-- ── guard: an acquisition ledger is kept while its acquisition exists ───────
create or replace function public.financial_sources_acq_keep()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.acquisition_document_id is not null
     and exists (select 1 from public.acquisition_reviews r where r.property_id = old.property_id) then
    raise exception 'This general ledger import is evidence (source %). It is reversed, not deleted; it is removed only with the whole prospect.', old.id
      using errcode = 'restrict_violation';
  end if;
  return old;
end;
$$;
revoke all on function public.financial_sources_acq_keep() from public, anon, authenticated;
drop trigger if exists financial_sources_acq_keep on public.financial_sources;
create trigger financial_sources_acq_keep
  before delete on public.financial_sources
  for each row execute function public.financial_sources_acq_keep();

-- When one does go (its prospect was deleted), the history says so.
create or replace function public.financial_sources_acq_removed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.acquisition_document_id is not null then
    insert into public.ledger_import_history
      (action, actor_uid, property_id, acquisition_document_id, source_id, storage_path, file_sha256, file_bytes, date_order, reason, detail)
    values ('evidence_removed', auth.uid(), old.property_id, old.acquisition_document_id, old.id, old.storage_path, old.file_sha256,
            old.file_bytes, old.date_order, 'The prospect was deleted; its documents, ledger and lines went with it.',
            jsonb_build_object('import_status', old.import_status));
  end if;
  return old;
end;
$$;
revoke all on function public.financial_sources_acq_removed() from public, anon, authenticated;
drop trigger if exists financial_sources_acq_removed on public.financial_sources;
create trigger financial_sources_acq_removed
  after delete on public.financial_sources
  for each row execute function public.financial_sources_acq_removed();

-- ── guard: an imported line ─────────────────────────────────────────────────
create or replace function public.gl_entries_import_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_prop uuid;
  v_doc  uuid;
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1
       or coalesce(current_setting('mainstreet.gl_reverse_source', true), '') <> ''
       or not exists (select 1 from public.gl_entry_sources l where l.gl_entry_id = old.id) then
      return old;
    end if;
    raise exception 'An imported ledger line is removed only by reversing its import' using errcode = 'insufficient_privilege';
  end if;
  if tg_op = 'UPDATE' then
    if pg_trigger_depth() > 1 and new.source_id is null and (to_jsonb(new) - 'source_id') = (to_jsonb(old) - 'source_id') then
      return new;   -- the foreign key's SET NULL when a source goes with its prospect
    end if;
    if exists (select 1 from public.gl_entry_sources l where l.gl_entry_id = old.id) then
      if coalesce(current_setting('mainstreet.gl_reverse_source', true), '') <> ''
         and (to_jsonb(new) - 'source_id' - 'source_row') = (to_jsonb(old) - 'source_id' - 'source_row') then
        return new;   -- a reversal hands a shared line to the import that still holds it
      end if;
      raise exception 'An imported ledger line does not change' using errcode = 'insufficient_privilege';
    end if;
  end if;
  if new.source_id is null then
    return new;
  end if;
  if coalesce(current_setting('mainstreet.gl_import_source', true), '') = new.source_id::text then
    return new;   -- the import that set this mark has already validated the line and its property
  end if;
  select s.property_id, s.acquisition_document_id into v_prop, v_doc from public.financial_sources s where s.id = new.source_id;
  if v_doc is not null then
    raise exception 'Lines are added to an imported ledger only by its import' using errcode = 'insufficient_privilege';
  end if;
  if v_prop is distinct from new.property_id then
    raise exception 'A ledger line belongs to its source''s property (%), not to %', v_prop, new.property_id using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.gl_entries_import_guard() from public, anon, authenticated;
drop trigger if exists gl_entries_import_guard on public.gl_entries;
create trigger gl_entries_import_guard
  before insert or update or delete on public.gl_entries
  for each row execute function public.gl_entries_import_guard();

-- ── the import ──────────────────────────────────────────────────────────────
-- p_file     { sha256, bytes, storagePath }  — computed by the server from the
--            stored object, never sent by a browser
-- p_payload  { rows:[...], summary:{ lines, debitCents, creditCents, dateOrder } }
--            — the server's own parse of that object (gl-import.js importPayload)
-- p_preview  { lines, debitCents, creditCents, dateOrder, fileSha256 } — what the
--            person saw; the import must equal it
create or replace function public.import_general_ledger(
  p_actor           uuid,
  p_document_id     uuid,
  p_file            jsonb,
  p_payload         jsonb,
  p_preview         jsonb,
  p_override_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_max_lines constant integer := 10000;   -- = gl-import.js IMPORT_MAX_ROWS
  -- A durable ceiling on one person's imports, counted from the history this
  -- function itself writes, so it holds across server instances (the server's
  -- own limiter is per instance). Refused attempts write no history and do not
  -- count; the server's limiter handles those.
  c_actor_imports_per_minute constant integer := 30;
  v_etag      text;
  v_doc       record;
  v_status    text;
  v_rows      jsonb := p_payload->'rows';
  v_summary   jsonb := p_payload->'summary';
  v_sha       text  := p_file->>'sha256';
  v_bytes     bigint;
  v_path      text  := p_file->>'storagePath';
  v_order     text  := p_payload->'summary'->>'dateOrder';
  v_reason    text  := nullif(btrim(coalesce(p_override_reason, '')), '');
  v_prior     record;
  v_n integer; v_bad integer; v_bad_row integer; v_dup integer; v_debit bigint; v_credit bigint;
  v_start date; v_end date; v_present integer; v_inserted integer; v_untrusted integer; v_untrusted_row integer;
  v_source uuid; v_hist uuid;
  v_prev_lock_timeout text;
begin
  if p_actor is null or not exists (select 1 from auth.users u where u.id = p_actor) then
    raise exception 'A ledger is imported by a signed-in person' using errcode = 'insufficient_privilege';
  end if;
  -- One import at a time per person, so the count below is exact under
  -- concurrency: every import by this person runs after the previous one
  -- committed its history row. Bounded wait, as for the property lock.
  v_prev_lock_timeout := current_setting('lock_timeout');
  begin
    perform set_config('lock_timeout', '5s', true);
    perform pg_advisory_xact_lock(46, hashtext('actor:' || p_actor::text));
  exception when lock_not_available then
    raise exception 'Another import by this person is still running; nothing was imported. Try again in a moment.'
      using errcode = 'lock_not_available';
  end;
  perform set_config('lock_timeout', v_prev_lock_timeout, true);
  if (select count(*) from public.ledger_import_history h
       where h.actor_uid = p_actor and h.action = 'import' and h.occurred_at > now() - interval '1 minute') >= c_actor_imports_per_minute then
    raise exception 'This person has imported % ledgers in the last minute; wait a moment before importing another. Nothing was imported.', c_actor_imports_per_minute
      using errcode = 'configuration_limit_exceeded';
  end if;
  select d.id, d.property_id, d.review_id, d.user_id, d.storage_path into v_doc
    from public.acquisition_documents d where d.id = p_document_id;
  if not found or not public.ledger_actor_may_edit(p_actor, v_doc.property_id) then
    raise exception 'Only the owner of the property, or a member who may edit it, imports a ledger into this document' using errcode = 'insufficient_privilege';
  end if;
  -- One ledger change at a time per property. Without it, a reversal running
  -- while an overlapping import is still in flight does not see that import's
  -- new links, removes the shared lines, and the cascade silently drops them
  -- from the import, which stays active with lines missing
  -- (tools/verify-ledger-concurrency.js §1). Every statement below runs after
  -- the previous holder committed, so it sees what that holder did. The wait is
  -- bounded (5 s) so the server can say "busy, try again" instead of timing out
  -- with the outcome unknown.
  v_prev_lock_timeout := current_setting('lock_timeout');
  begin
    perform set_config('lock_timeout', '5s', true);
    perform pg_advisory_xact_lock(46, hashtext(v_doc.property_id::text));
  exception when lock_not_available then
    raise exception 'Another import or reversal of this property''s ledger is still running; nothing was imported. Try again in a moment.'
      using errcode = 'lock_not_available';
  end;
  perform set_config('lock_timeout', v_prev_lock_timeout, true);
  select r.status into v_status from public.acquisition_reviews r where r.id = v_doc.review_id;
  if v_status is null or v_status not in ('draft', 'analyzing', 'complete') then
    raise exception 'Review % is %; a ledger is imported only into an open acquisition', v_doc.review_id, coalesce(v_status, 'missing')
      using errcode = 'check_violation';
  end if;

  -- The stored original: the object this document names, as the server read it.
  if v_doc.storage_path is null or v_path is distinct from v_doc.storage_path then
    raise exception 'The import was not read from this document''s stored original' using errcode = 'check_violation';
  end if;
  if v_path not like 'leases/' || v_doc.user_id::text || '/acq\_' || v_doc.review_id::text || '\_%' then
    raise exception 'The stored original is not an acquisition upload of this review' using errcode = 'check_violation';
  end if;
  if v_sha is null or v_sha !~ '^[0-9a-f]{64}$' or (p_file->>'bytes') !~ '^[0-9]+$' then
    raise exception 'The server''s fingerprint of the stored original is missing' using errcode = 'check_violation';
  end if;
  v_bytes := (p_file->>'bytes')::bigint;
  select o.metadata->>'eTag' into v_etag from storage.objects o
   where o.bucket_id = 'leases' and o.name = substr(v_path, length('leases/') + 1)
     and (o.metadata->>'size') ~ '^[0-9]+$' and (o.metadata->>'size')::bigint = v_bytes;
  if not found then
    raise exception 'The stored original is not in storage with that size' using errcode = 'check_violation';
  end if;
  if (p_preview->>'fileSha256') is distinct from v_sha then
    raise exception 'The file that was previewed is not the stored original (fingerprints differ); nothing was imported' using errcode = 'check_violation';
  end if;

  -- The date order: a person's choice or the file's proof, the same as previewed.
  if v_order is null or v_order not in ('iso', 'mdy', 'dmy') then
    raise exception 'The date order is %; a person must choose month-first or day-first before importing', coalesce(v_order, 'not stated')
      using errcode = 'check_violation';
  end if;
  if (p_preview->>'dateOrder') is distinct from v_order then
    raise exception 'The dates were previewed as % but read as %; nothing was imported', coalesce(p_preview->>'dateOrder', 'undecided'), v_order
      using errcode = 'check_violation';
  end if;

  -- The same file again writes nothing; another reading of it is refused.
  select s.id, s.acquisition_document_id, s.file_sha256, s.date_order, s.extracted into v_prior
    from public.financial_sources s
   where s.property_id = v_doc.property_id and s.import_status = 'active'
     and (s.acquisition_document_id = v_doc.id or s.file_sha256 = v_sha)
   order by (s.acquisition_document_id = v_doc.id) desc
   limit 1;
  if found then
    if v_prior.file_sha256 is distinct from v_sha then
      raise exception 'This document already has an active import of a different file (source %); reverse it first', v_prior.id using errcode = 'check_violation';
    end if;
    if v_prior.date_order is distinct from v_order then
      raise exception 'This file is already imported with its dates read as % (source %); reverse it to read them as %', v_prior.date_order, v_prior.id, v_order
        using errcode = 'check_violation';
    end if;
    return jsonb_build_object('already_imported', true, 'source_id', v_prior.id, 'document_id', v_prior.acquisition_document_id,
      'lines', (v_prior.extracted->>'lines')::integer, 'inserted', 0,
      'debit_cents', (v_prior.extracted->>'debitCents')::bigint, 'credit_cents', (v_prior.extracted->>'creditCents')::bigint);
  end if;

  if v_rows is null or jsonb_typeof(v_rows) <> 'array' then
    raise exception 'The ledger lines must be an array' using errcode = 'check_violation';
  end if;
  v_n := jsonb_array_length(v_rows);
  if v_n < 1 or v_n > c_max_lines then
    raise exception 'A ledger import holds 1 to % lines (got %)', c_max_lines, v_n using errcode = 'check_violation';
  end if;

  create temporary table if not exists pg_temp._gl_import (
    posted_on date, account_code text, account_name text, description text, vendor text, reference text,
    debit_cents bigint, credit_cents bigint, source_row integer, key text, row_hash text
  ) on commit drop;
  truncate pg_temp._gl_import;
  insert into pg_temp._gl_import
  select x.posted_on, nullif(btrim(x.account_code), ''), nullif(btrim(x.account_name), ''), nullif(btrim(x.description), ''),
         nullif(btrim(x.vendor), ''), nullif(btrim(x.reference), ''), x.debit_cents, x.credit_cents, x.source_row, x.key,
         case when coalesce(x.key, '') <> '' then encode(sha256(convert_to(x.key, 'UTF8')), 'hex') end
    from jsonb_to_recordset(v_rows) as x(posted_on date, account_code text, account_name text, description text, vendor text,
                                        reference text, debit_cents bigint, credit_cents bigint, source_row integer, key text);

  select count(*), min(source_row) into v_bad, v_bad_row from pg_temp._gl_import
   where posted_on is null or (account_code is null and account_name is null)
      or debit_cents is null or credit_cents is null or debit_cents < 0 or credit_cents < 0
      or debit_cents > 99999999999999 or credit_cents > 99999999999999 or (debit_cents > 0) = (credit_cents > 0)
      or source_row is null or source_row < 1 or row_hash is null;
  if v_bad > 0 then
    raise exception '% ledger line(s) are invalid (first at sheet row %); nothing was imported', v_bad, v_bad_row using errcode = 'check_violation';
  end if;
  select count(*) - count(distinct row_hash) into v_dup from pg_temp._gl_import;
  if v_dup > 0 then
    raise exception '% line(s) repeat another line''s key; nothing was imported', v_dup using errcode = 'check_violation';
  end if;

  select sum(debit_cents), sum(credit_cents), min(posted_on), max(posted_on) into v_debit, v_credit, v_start, v_end from pg_temp._gl_import;
  if (v_summary->>'lines') is distinct from v_n::text or (v_summary->>'debitCents') is distinct from v_debit::text
     or (v_summary->>'creditCents') is distinct from v_credit::text then
    raise exception 'The parsed lines (%, debits %, credits %) do not add up to the parse''s own summary; nothing was imported', v_n, v_debit, v_credit
      using errcode = 'check_violation';
  end if;
  if (p_preview->>'lines') is distinct from v_n::text or (p_preview->>'debitCents') is distinct from v_debit::text
     or (p_preview->>'creditCents') is distinct from v_credit::text then
    raise exception 'The stored file reads as % lines, debits %, credits %, but the preview showed %, %, %; nothing was imported',
      v_n, v_debit, v_credit, p_preview->>'lines', p_preview->>'debitCents', p_preview->>'creditCents' using errcode = 'check_violation';
  end if;
  if v_debit <> v_credit and v_reason is null then
    raise exception 'The ledger does not balance (debits % cents, credits % cents); a person''s reason is required to import it', v_debit, v_credit
      using errcode = 'check_violation';
  end if;
  -- An unbalanced ledger is accepted on a person's reason only when that person
  -- is the property's owner or an organisation admin; an editor's reason is not
  -- enough.
  if v_debit <> v_credit and not public.ledger_actor_is_admin(p_actor, v_doc.property_id) then
    raise exception 'Only the owner of the property or an organisation admin imports an unbalanced ledger, with a reason; nothing was imported'
      using errcode = 'insufficient_privilege';
  end if;

  -- Lines already present count only when an ACTIVE acquisition import holds
  -- them and their content is the same. Anything else refuses the import.
  select count(*), min(i.source_row) into v_untrusted, v_untrusted_row
    from pg_temp._gl_import i
    join public.gl_entries g on g.property_id = v_doc.property_id and g.row_hash = i.row_hash
   where not exists (select 1 from public.gl_entry_sources l join public.financial_sources s on s.id = l.source_id
                      where l.gl_entry_id = g.id and s.import_status = 'active')
      -- the same content the canonical key encodes (gl-import.js _contentKey):
      -- date, account code (or name when there is no code), both sides, and the
      -- reference, description and vendor ignoring case. A line planted with a
      -- copied row_hash but other amounts or text fails here.
      or g.posted_on is distinct from i.posted_on
      or lower(coalesce(g.account_code, '')) <> lower(coalesce(i.account_code, ''))
      or (i.account_code is null and lower(coalesce(g.account_name, '')) <> lower(coalesce(i.account_name, '')))
      or lower(coalesce(g.reference, ''))   <> lower(coalesce(i.reference, ''))
      or lower(coalesce(g.description, '')) <> lower(coalesce(i.description, ''))
      or lower(coalesce(g.vendor, ''))      <> lower(coalesce(i.vendor, ''))
      or coalesce(g.debit, 0) * 100 <> i.debit_cents or coalesce(g.credit, 0) * 100 <> i.credit_cents;
  if v_untrusted > 0 then
    raise exception '% line(s) match a ledger line that no active import holds, or that differs from them (first at sheet row %); nothing was imported',
      v_untrusted, v_untrusted_row using errcode = 'check_violation';
  end if;
  select count(*) into v_present from pg_temp._gl_import i
   where exists (select 1 from public.gl_entries g where g.property_id = v_doc.property_id and g.row_hash = i.row_hash);

  perform set_config('mainstreet.gl_import_document', v_doc.id::text, true);
  begin
    insert into public.financial_sources
      (property_id, kind, acquisition_document_id, import_status, file_sha256, file_bytes, file_etag, storage_path, date_order,
       period_start, period_end, extraction_status, extracted, created_by)
    values
      (v_doc.property_id, 'general_ledger', v_doc.id, 'active', v_sha, v_bytes, v_etag, v_path, v_order, v_start, v_end, 'extracted',
       jsonb_build_object('lines', v_n, 'debitCents', v_debit, 'creditCents', v_credit, 'balanced', v_debit = v_credit,
         'overrideReason', v_reason, 'inserted', v_n - v_present, 'alreadyPresent', v_present,
         'preview', p_preview, 'parser', 'gl-import (server, CSV)', 'importedBy', p_actor, 'importedAt', now()),
       p_actor)
    returning id into v_source;
  exception when unique_violation then
    raise exception 'Another import of this ledger ran at the same time; nothing was imported. Try again.' using errcode = 'serialization_failure';
  end;
  perform set_config('mainstreet.gl_import_document', '', true);

  perform set_config('mainstreet.gl_import_source', v_source::text, true);
  insert into public.gl_entries
    (property_id, source_id, posted_on, period_start, period_end, account_code, account_name, description, vendor,
     reference, debit, credit, amount, source_row, row_hash)
  select v_doc.property_id, v_source, i.posted_on, i.posted_on, i.posted_on, i.account_code, i.account_name, i.description,
         i.vendor, i.reference,
         case when i.debit_cents > 0 then i.debit_cents / 100.0 end,
         case when i.credit_cents > 0 then i.credit_cents / 100.0 end,
         (i.debit_cents - i.credit_cents) / 100.0, i.source_row, i.row_hash
    from pg_temp._gl_import i
  on conflict (property_id, row_hash) do nothing;
  get diagnostics v_inserted = row_count;
  perform set_config('mainstreet.gl_import_source', '', true);
  if v_inserted <> v_n - v_present then
    raise exception 'Another import of this ledger ran at the same time; nothing was imported. Try again.' using errcode = 'serialization_failure';
  end if;

  insert into public.gl_entry_sources (gl_entry_id, source_id, property_id, source_row)
  select g.id, v_source, v_doc.property_id, i.source_row
    from pg_temp._gl_import i join public.gl_entries g on g.property_id = v_doc.property_id and g.row_hash = i.row_hash;

  insert into public.ledger_import_history
    (action, actor_uid, property_id, review_id, acquisition_document_id, source_id, storage_path, file_sha256, file_bytes, date_order,
     lines, inserted, already_present, debit_cents, credit_cents, balanced, override_reason)
  values ('import', p_actor, v_doc.property_id, v_doc.review_id, v_doc.id, v_source, v_path, v_sha, v_bytes, v_order,
          v_n, v_inserted, v_present, v_debit, v_credit, v_debit = v_credit, v_reason)
  returning id into v_hist;
  insert into public.property_events (property_id, actor_uid, action, subject_type, subject_id, detail)
  values (v_doc.property_id, p_actor, 'ledger_imported', 'financial_source', v_source::text,
          jsonb_build_object('document', v_doc.id, 'lines', v_n, 'inserted', v_inserted, 'alreadyPresent', v_present, 'history', v_hist));

  return jsonb_build_object('already_imported', false, 'source_id', v_source, 'document_id', v_doc.id, 'history_id', v_hist,
    'lines', v_n, 'inserted', v_inserted, 'already_present', v_present, 'debit_cents', v_debit, 'credit_cents', v_credit,
    'balanced', v_debit = v_credit, 'period_start', v_start, 'period_end', v_end);
end;
$$;
revoke all on function public.import_general_ledger(uuid, uuid, jsonb, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.import_general_ledger(uuid, uuid, jsonb, jsonb, jsonb, text) to service_role;

-- ── the reversal ────────────────────────────────────────────────────────────
create or replace function public.reverse_general_ledger_import(p_actor uuid, p_source_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason  text := nullif(btrim(coalesce(p_reason, '')), '');
  v_src     record;
  v_status  text;
  v_review  uuid;
  v_hist    uuid := gen_random_uuid();
  v_removed integer;
  v_kept    integer;
  v_handed  integer;
  v_prev_lock_timeout text;
begin
  if p_actor is null or not exists (select 1 from auth.users u where u.id = p_actor) then
    raise exception 'An import is reversed by a signed-in person' using errcode = 'insufficient_privilege';
  end if;
  if v_reason is null then
    raise exception 'A reversal needs a reason' using errcode = 'check_violation';
  end if;
  select s.* into v_src from public.financial_sources s where s.id = p_source_id;
  if not found or v_src.acquisition_document_id is null then
    raise exception 'Source % is not an acquisition ledger import', p_source_id using errcode = 'check_violation';
  end if;
  if not public.ledger_actor_is_admin(p_actor, v_src.property_id) then
    raise exception 'Only the owner of the property or an organisation admin reverses an import' using errcode = 'insufficient_privilege';
  end if;
  -- One ledger change at a time per property, waiting at most 5 s (see
  -- import_general_ledger); then the source is read again, as the previous
  -- holder left it.
  v_prev_lock_timeout := current_setting('lock_timeout');
  begin
    perform set_config('lock_timeout', '5s', true);
    perform pg_advisory_xact_lock(46, hashtext(v_src.property_id::text));
  exception when lock_not_available then
    raise exception 'Another import or reversal of this property''s ledger is still running; nothing was changed. Try again in a moment.'
      using errcode = 'lock_not_available';
  end;
  perform set_config('lock_timeout', v_prev_lock_timeout, true);
  select s.* into v_src from public.financial_sources s where s.id = p_source_id for update;
  select r.status, r.id into v_status, v_review
    from public.acquisition_documents d join public.acquisition_reviews r on r.id = d.review_id where d.id = v_src.acquisition_document_id;
  if v_status is null or v_status not in ('draft', 'analyzing', 'complete') then
    raise exception 'The acquisition is %; its ledger is frozen and no import is reversed', coalesce(v_status, 'missing') using errcode = 'check_violation';
  end if;
  if v_src.import_status <> 'active' then
    raise exception 'Import % is already reversed', p_source_id using errcode = 'check_violation';
  end if;

  perform set_config('mainstreet.gl_reverse_source', p_source_id::text, true);
  create temporary table if not exists pg_temp._gl_reverse (gl_entry_id uuid primary key) on commit drop;
  truncate pg_temp._gl_reverse;
  with gone as (delete from public.gl_entry_sources l where l.source_id = p_source_id returning l.gl_entry_id)
  insert into pg_temp._gl_reverse select gl_entry_id from gone;

  -- Lines no other import holds are archived, then removed.
  insert into public.gl_entries_reversed
    (id, property_id, reversed_source, history_id, posted_on, account_code, account_name, description, vendor, reference,
     debit, credit, amount, source_row, row_hash, line_created_at)
  select g.id, g.property_id, p_source_id, v_hist, g.posted_on, g.account_code, g.account_name, g.description, g.vendor, g.reference,
         g.debit, g.credit, g.amount, g.source_row, g.row_hash, g.created_at
    from public.gl_entries g join pg_temp._gl_reverse r on r.gl_entry_id = g.id
   where not exists (select 1 from public.gl_entry_sources l where l.gl_entry_id = g.id);
  get diagnostics v_removed = row_count;
  delete from public.gl_entries g using pg_temp._gl_reverse r
   where g.id = r.gl_entry_id and not exists (select 1 from public.gl_entry_sources l where l.gl_entry_id = g.id);

  -- Lines another import still holds stay, and are handed to it.
  select count(*) into v_kept from public.gl_entries g join pg_temp._gl_reverse r on r.gl_entry_id = g.id;
  update public.gl_entries g
     set source_id = h.source_id, source_row = h.source_row
    from (select distinct on (l.gl_entry_id) l.gl_entry_id, l.source_id, l.source_row
            from public.gl_entry_sources l join pg_temp._gl_reverse r on r.gl_entry_id = l.gl_entry_id
           order by l.gl_entry_id, l.created_at, l.source_id) h
   where g.id = h.gl_entry_id and g.source_id = p_source_id;
  get diagnostics v_handed = row_count;

  update public.financial_sources
     set import_status = 'reversed', reversed_at = now(), reversed_by = p_actor, reversal_reason = v_reason
   where id = p_source_id;
  perform set_config('mainstreet.gl_reverse_source', '', true);

  insert into public.ledger_import_history
    (id, action, actor_uid, property_id, review_id, acquisition_document_id, source_id, storage_path, file_sha256, file_bytes, date_order,
     lines, debit_cents, credit_cents, reason, detail)
  values (v_hist, 'reverse', p_actor, v_src.property_id, v_review, v_src.acquisition_document_id, p_source_id, v_src.storage_path,
          v_src.file_sha256, v_src.file_bytes, v_src.date_order, (v_src.extracted->>'lines')::integer,
          (v_src.extracted->>'debitCents')::bigint, (v_src.extracted->>'creditCents')::bigint, v_reason,
          jsonb_build_object('linesRemoved', v_removed, 'linesKeptByOtherImports', v_kept, 'linesHandedOver', v_handed));
  insert into public.property_events (property_id, actor_uid, action, subject_type, subject_id, detail)
  values (v_src.property_id, p_actor, 'ledger_import_reversed', 'financial_source', p_source_id::text,
          jsonb_build_object('reason', v_reason, 'linesRemoved', v_removed, 'linesKept', v_kept, 'history', v_hist));

  return jsonb_build_object('source_id', p_source_id, 'history_id', v_hist, 'lines_removed', v_removed, 'lines_kept', v_kept, 'lines_handed_over', v_handed);
end;
$$;
revoke all on function public.reverse_general_ledger_import(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.reverse_general_ledger_import(uuid, uuid, text) to service_role;

-- ── retention: seven years after a deleted property's last event ────────────
create or replace function public.purge_ledger_import_history()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  perform set_config('mainstreet.ledger_history_purge', 'on', true);
  delete from public.ledger_import_history h
   where not exists (select 1 from public.properties p where p.id = h.property_id)
     and h.property_id in (select x.property_id from public.ledger_import_history x
                            group by x.property_id having max(x.occurred_at) < now() - interval '7 years');
  get diagnostics v_n = row_count;
  perform set_config('mainstreet.ledger_history_purge', '', true);
  return v_n;
end;
$$;
revoke all on function public.purge_ledger_import_history() from public, anon, authenticated;
grant execute on function public.purge_ledger_import_history() to service_role;

-- ── evidence integrity: does every stored original still match what was imported? ──
-- The service key can overwrite any object and Storage's row rules do not bind
-- it. This check compares each acquisition import's stored original with what
-- the import recorded — the object must exist with the same size and, when
-- Storage offered one, the same ETag — and records every disagreement in the
-- history (action evidence_mismatch) once per distinct finding. It changes no
-- source: an import's record is evidence of what WAS imported; the finding is
-- evidence that the file is no longer that. Nothing that reads a source may
-- treat it as trustworthy while its latest history row is an open mismatch.
create or replace function public.check_ledger_evidence_integrity()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_checked integer := 0; v_flagged integer := 0; v_new integer := 0;
  r record; v_problem text; v_detail jsonb; v_last jsonb;
begin
  for r in select s.id, s.property_id, s.acquisition_document_id, s.storage_path, s.file_sha256, s.file_bytes, s.file_etag, s.import_status,
                  o.metadata->>'size' as o_size, o.metadata->>'eTag' as o_etag, (o.id is not null) as present
             from public.financial_sources s
             left join storage.objects o on o.bucket_id = split_part(s.storage_path, '/', 1) and o.name = substr(s.storage_path, length(split_part(s.storage_path, '/', 1)) + 2)
            where s.acquisition_document_id is not null
  loop
    v_checked := v_checked + 1;
    v_problem := case
      when not r.present then 'missing'
      when r.o_size !~ '^[0-9]+$' or r.o_size::bigint <> r.file_bytes then 'size'
      when r.file_etag is not null and r.o_etag is not null and r.o_etag <> r.file_etag then 'etag'
      else null end;
    if v_problem is null then continue; end if;
    v_flagged := v_flagged + 1;
    v_detail := jsonb_build_object('problem', v_problem, 'expected', jsonb_build_object('bytes', r.file_bytes, 'etag', r.file_etag, 'sha256', r.file_sha256),
                                   'found', jsonb_build_object('present', r.present, 'bytes', r.o_size, 'etag', r.o_etag), 'import_status', r.import_status);
    select h.detail into v_last from public.ledger_import_history h
     where h.source_id = r.id and h.action = 'evidence_mismatch' order by h.occurred_at desc limit 1;
    if v_last is not distinct from v_detail then continue; end if;   -- already on record, unchanged
    insert into public.ledger_import_history
      (action, property_id, acquisition_document_id, source_id, storage_path, file_sha256, file_bytes, reason, detail)
    values ('evidence_mismatch', r.property_id, r.acquisition_document_id, r.id, r.storage_path, r.file_sha256, r.file_bytes,
            'The stored original no longer matches what was imported (' || v_problem || ').', v_detail);
    v_new := v_new + 1;
  end loop;
  return jsonb_build_object('checked', v_checked, 'flagged', v_flagged, 'newly_recorded', v_new);
end;
$$;
revoke all on function public.check_ledger_evidence_integrity() from public, anon, authenticated;
grant execute on function public.check_ledger_evidence_integrity() to service_role;

-- ── maintenance: the purge and the integrity check, each run on the record ──
create table if not exists public.ledger_maintenance_runs (
  id        uuid        primary key default gen_random_uuid(),
  ran_at    timestamptz not null default now(),
  purged    integer     not null,
  integrity jsonb       not null
);
alter table public.ledger_maintenance_runs enable row level security;
revoke all on public.ledger_maintenance_runs from public, anon, authenticated, service_role;
grant select, insert on public.ledger_maintenance_runs to service_role;
drop policy if exists ledger_maintenance_runs_service on public.ledger_maintenance_runs;
create policy ledger_maintenance_runs_service on public.ledger_maintenance_runs for all to service_role using (true) with check (true);

create or replace function public.run_ledger_maintenance()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_purged integer; v_integrity jsonb; v_id uuid;
begin
  v_purged := public.purge_ledger_import_history();
  v_integrity := public.check_ledger_evidence_integrity();
  insert into public.ledger_maintenance_runs (purged, integrity) values (v_purged, v_integrity) returning id into v_id;
  return jsonb_build_object('run_id', v_id, 'purged', v_purged, 'integrity', v_integrity);
end;
$$;
revoke all on function public.run_ledger_maintenance() from public, anon, authenticated;
grant execute on function public.run_ledger_maintenance() to service_role;
comment on function public.run_ledger_maintenance() is
  '046: service_role only. Runs the seven-year history purge and the evidence integrity check and records the run. Meant to be scheduled (pg_cron, monthly); "no run in 35 days" is then a query on ledger_maintenance_runs.';

-- ── storage: an acquisition original is not overwritten, moved or deleted ───
create or replace function public.storage_object_is_acquisition_evidence(p_bucket text, p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.acquisition_documents d where d.storage_path = p_bucket || '/' || p_name)
$$;
revoke all on function public.storage_object_is_acquisition_evidence(text, text) from public, anon;
grant execute on function public.storage_object_is_acquisition_evidence(text, text) to authenticated, service_role;
drop policy if exists acq_evidence_no_update on storage.objects;
drop policy if exists acq_evidence_no_delete on storage.objects;
create policy acq_evidence_no_update on storage.objects
  as restrictive for update to authenticated
  using (not public.storage_object_is_acquisition_evidence(bucket_id, name));
create policy acq_evidence_no_delete on storage.objects
  as restrictive for delete to authenticated
  using (not public.storage_object_is_acquisition_evidence(bucket_id, name));

comment on table public.ledger_import_history is
  '046: append-only record of every acquisition ledger import, reversal and removal of evidence. Kept 7 years (provisional) after a deleted property''s last event; purged only by purge_ledger_import_history().';
comment on table public.gl_entry_sources is
  '046: every import''s claim on every line it contained, inserted or already present — what lets an overlapping import be reversed without losing the other''s lines.';
comment on function public.import_general_ledger(uuid, uuid, jsonb, jsonb, jsonb, text) is
  '046: service_role only. Imports the server''s own parse of a stored acquisition original — every line or none.';

commit;
