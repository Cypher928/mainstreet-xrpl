-- ============================================================================
-- 044_acquisition_conversion_safeguards.sql — the server enforces the matching
-- and missing-lease safeguards before an acquisition is converted
-- ============================================================================
-- TARGET: PILOT PROJECT (bhmktujbxdbvdmpybmad). Not to be run on production as
-- part of this change. NOT APPLIED. Written against Pilot's catalog as recorded
-- in migrations/APPLIED.md (latest 043), with 034, 035 and 036 applied.
-- Requires 034 (is_property_admin, member_property_ids, acq_child_property_bind,
-- acq_doc_families_id_property_key), 035 (acquire_property, replaced here by
-- CREATE OR REPLACE — the 035 file is not edited) and 036
-- (acq_children_frozen).
--
-- WHY
-- ---
--   The page (5bc5e84, docs/ACQUISITION_REVIEW.md §4p) asks a person before a
--   tenant-to-leasehold match whose names or property materially conflict, and
--   before a leasehold with no lease document on file becomes a tenant.
--   acquire_property is callable directly by any administrator of the
--   property, so a client that skips the page skipped both. 044 makes the
--   server authoritative (§4q).
--
-- WHAT THE SERVER TRUSTS
-- ----------------------
--   review.data is JSON the browser writes whole; a key in it is not evidence.
--   The two human acts the gate needs are rows in a new append-only table,
--   acquisition_conversion_attestations, stamped by the database:
--     · no_document_on_file — a person accepts proceeding without a lease
--       document for ONE leasehold of ONE review. It records that the lease is
--       missing. It verifies nothing: verifies_terms exists only to be false.
--     · match_confirmed — a person confirms ONE extracted entry (row_key) as
--       ONE leasehold of ONE review, with a reason. Whether that match is a
--       MATERIAL MISMATCH is never read from the client: the server compares
--       the names itself (acq_compare_tenant_names / acq_compare_property, a
--       line-for-line port of AcquisitionLeasehold.compareTenantNames /
--       compareProperty, held identical by tools/verify-migration-044.js).
--
-- BEFORE → AFTER (exact inventory)
-- --------------------------------
--   table      + acquisition_conversion_attestations (RLS: members select and
--                insert, and the guard admits only the owner or a member who
--                may edit — not read_only; no update; delete only by cascade
--                from its review or leasehold)
--   indexes    + idx_acq_attestations_review, idx_acq_attestations_family
--              + acq_attestations_one_ack_per_leasehold (unique, partial)
--   triggers   + acq_attestations_guard           (BEFORE INSERT: stamp, scope, meaning)
--              + acq_attestations_property_bind   (034's acq_child_property_bind)
--              + acq_children_frozen              (036's, as on the other children)
--              + acq_attestations_append_only     (BEFORE UPDATE OR DELETE)
--   functions  + acq_js_trim, acq_name_tokens, acq_compare_tenant_names,
--                acq_compare_property, acq_match_requires_reason (pure,
--                immutable, locale-independent)
--              + acq_attestations_guard, acq_attestations_append_only (trigger)
--              ~ acquire_property — 035's body VERBATIM with two steps added
--                after 5b: 5c (no lease on file) and 5d (concerning matches).
--   Nothing else: no change to 032–043's tables, policies, triggers or data,
--   to payments, settlement, XRPL, wallets, auth or billing. No backfill: no
--   acknowledgement is invented for any existing review.
--
-- LEGACY
-- ------
--   Not grandfathered. A review reaching acquire_property after 044 meets the
--   gate in full. review.data.leaseholdAcknowledgements and resolution
--   `concerns` / `reason` keys are ignored. Converted reviews are frozen (036)
--   and never reach the function again.
--
-- ROLLBACK: 044_acquisition_conversion_safeguards_rollback.sql (restores 035's
-- acquire_property verbatim and drops what 044 added, attestations included).
-- ============================================================================

begin;

-- ── 1 · name comparison (AcquisitionLeasehold, ported) ───────────────────────
-- JavaScript's String.prototype.trim: the 25 code points \s matches (tabs,
-- line breaks, non-breaking, ideographic and the other Unicode spaces, U+FEFF),
-- whatever the database locale says whitespace is. Used for every name and
-- every reason, so the server and the page agree on what is blank.
create or replace function public.acq_js_trim(p_s text)
returns text
language sql
immutable
set search_path = ''
as $$
  select regexp_replace(p_s, '^[\u0009-\u000D\u0020\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]+|[\u0009-\u000D\u0020\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]+$', '', 'g');
$$;

-- A name as comparable words: lower case, "&" read as "and", apostrophes and
-- punctuation gone, spelled-out letters joined ("L.L.C." → "llc"), legal
-- suffixes and filler dropped. Mirrors _nameTokens.
--
-- LOCALE-INDEPENDENT. lower() follows the database's collation (Pilot: ICU
-- en-US), so it is not used. Only ASCII letters and digits survive the
-- clean-up, so lowering only has to agree with JavaScript's toLowerCase on
-- the characters that BECOME ASCII: A–Z, and the two non-ASCII code points
-- whose lower case contains an ASCII letter — U+0130 "İ" (→ "i" + U+0307) and
-- U+212A KELVIN SIGN (→ "k"). tools/verify-migration-044.js enumerates every
-- code point to keep that list complete.
create or replace function public.acq_name_tokens(p_s text)
returns text[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_raw   text;
  v_out   text[] := '{}';
  v_run   text := '';
  v_p     text;
  c_legal  constant text[] := array['llc','inc','incorporated','corp','corporation','co','company','ltd','limited','lp','llp','plc','pllc','pc','pa','dba'];
  c_filler constant text[] := array['and','of','the','a','an','at','by'];
begin
  v_raw := replace(coalesce(p_s, ''), chr(304), 'i' || chr(775));
  v_raw := replace(v_raw, chr(8490), 'k');
  v_raw := translate(v_raw, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz');
  v_raw := replace(v_raw, '&', ' and ');
  v_raw := regexp_replace(v_raw, '[''’]', '', 'g');
  v_raw := btrim(regexp_replace(v_raw, '[^a-z0-9]+', ' ', 'g'));
  if v_raw = '' then
    return '{}'::text[];
  end if;
  foreach v_p in array regexp_split_to_array(v_raw, ' +') loop
    if length(v_p) = 1 and v_p ~ '[a-z]' then
      v_run := v_run || v_p;
      continue;
    end if;
    if v_run <> '' then
      v_out := v_out || v_run;
      v_run := '';
    end if;
    v_out := v_out || v_p;
  end loop;
  if v_run <> '' then
    v_out := v_out || v_run;
  end if;
  return array(select t from unnest(v_out) with ordinality u(t, n)
                where not (t = any(c_legal)) and not (t = any(c_filler)) order by n);
end;
$$;

-- Two tenant names: null when they name the same tenant once harmless
-- differences are set aside, else 'mismatch' (no distinguishing word shared)
-- or 'uncertain' (too weak to call). Mirrors compareTenantNames.
create or replace function public.acq_compare_tenant_names(p_extracted text, p_selected text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  a  text[] := public.acq_name_tokens(p_extracted);
  b  text[] := public.acq_name_tokens(p_selected);
  da text[];
  db text[];
  c_generic_tenant constant text[] := array['cafe','coffee','bakery','restaurant','grill','kitchen','bar','pizza','deli',
    'shop','shops','store','stores','market','markets','supermarket','supermarkets','salon','spa',
    'nails','studio','services','service','group','holdings','enterprises','partners','associates',
    'international','retail','center','wellness','security','insurance','bank','pharmacy',
    'fitness','gym','dental','medical','clinic','health'];
begin
  if cardinality(a) = 0 or cardinality(b) = 0 then
    return 'uncertain';
  end if;
  if a = b or array_to_string(a, '') = array_to_string(b, '') then
    return null;
  end if;
  da := array(select t from unnest(a) with ordinality u(t, n) where not (t = any(c_generic_tenant)) and t !~ '^[0-9]+$' order by n);
  db := array(select t from unnest(b) with ordinality u(t, n) where not (t = any(c_generic_tenant)) and t !~ '^[0-9]+$' order by n);
  if cardinality(da) = 0 or cardinality(db) = 0 then
    return 'uncertain';
  end if;
  if not (da && db) then
    return 'mismatch';
  end if;
  if array(select t from unnest(da) t order by t collate "C") = array(select t from unnest(db) t order by t collate "C") then
    if a <@ b or b <@ a then
      return null;
    end if;
    return 'uncertain';
  end if;
  return 'uncertain';
end;
$$;

-- The property a lease names against the acquisition's own names: null when
-- they agree or there is nothing to compare, else 'mismatch' or 'uncertain'
-- (a street address cannot be told from a name). Mirrors compareProperty.
--
-- Whitespace is JavaScript's (String.prototype.trim and \s: the 25 code points
-- in c_js_ws, non-breaking and ideographic spaces and U+FEFF included), not
-- the database's, and the address test's word boundary is ASCII as in
-- JavaScript (\b), not the locale's (\y).
create or replace function public.acq_compare_property(p_source text, p_names text[])
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  c_js_ws   constant text := '[\u0009-\u000D\u0020\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]';
  v_src     text := public.acq_js_trim(coalesce(p_source, ''));
  v_names   text[];
  v_srcname text;
  st        text[];
  sd        text[];
  nt        text[];
  nd        text[];
  v_addr    boolean;
  v_name    text;
  v_r       text;
  v_best    text := null;
  c_generic_property constant text[] := array['plaza','center','centre','shopping','mall','retail','square','commons',
    'marketplace','village','crossing','station','property','properties','building',
    'street','st','avenue','ave','road','rd','boulevard','blvd','drive','dr','lane','ln',
    'way','suite','ste','highway','hwy','parkway','pkwy'];
begin
  v_names := array(select t from (
                      select public.acq_js_trim(n) as t, i
                        from unnest(coalesce(p_names, '{}'::text[])) with ordinality u(n, i) where n is not null) x
                    where t <> '' order by i);
  if v_src = '' or cardinality(v_names) = 0 then
    return null;
  end if;
  v_srcname := split_part(v_src, ',', 1);
  st := public.acq_name_tokens(v_srcname);
  sd := array(select t from unnest(st) with ordinality u(t, n) where not (t = any(c_generic_property)) and t !~ '^[0-9]+$' order by n);
  v_addr := v_srcname ~ ('^' || c_js_ws || '*[0-9]+[A-Za-z]?(?![A-Za-z0-9_])');
  foreach v_name in array v_names loop
    nt := public.acq_name_tokens(split_part(v_name, ',', 1));
    nd := array(select t from unnest(nt) with ordinality u(t, n) where not (t = any(c_generic_property)) and t !~ '^[0-9]+$' order by n);
    if st = nt or (cardinality(sd) > 0 and cardinality(nd) > 0 and sd && nd) then
      return null;
    end if;
    v_r := case
             when v_addr and v_name !~ '[0-9]' then 'uncertain'
             when cardinality(sd) = 0 or cardinality(nd) = 0 then 'uncertain'
             else 'mismatch'
           end;
    if v_best is null or (v_best = 'mismatch' and v_r = 'uncertain') then
      v_best := v_r;
    end if;
  end loop;
  return v_best;
end;
$$;

-- A match that only a person's reason can carry: the extracted tenant and the
-- leasehold's name, or the lease's property and the acquisition's names, are a
-- MATERIAL MISMATCH (AcquisitionLeasehold.requiresReason over matchConcerns).
-- An 'uncertain' comparison is not a material concern.
create or replace function public.acq_match_requires_reason(p_row jsonb, p_leasehold text, p_names text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(public.acq_compare_tenant_names(
           coalesce(nullif(p_row->>'tenant_name', ''), nullif(p_row->>'tenantName', ''), ''),
           coalesce(p_leasehold, '')), '') = 'mismatch'
      or coalesce(public.acq_compare_property(
           coalesce(nullif(p_row->>'property_name', ''), nullif(p_row->>'propertyName', ''), ''),
           p_names), '') = 'mismatch';
$$;

revoke all on function public.acq_js_trim(text)                             from public, anon;
revoke all on function public.acq_name_tokens(text)                         from public, anon;
revoke all on function public.acq_compare_tenant_names(text, text)          from public, anon;
revoke all on function public.acq_compare_property(text, text[])            from public, anon;
revoke all on function public.acq_match_requires_reason(jsonb, text, text[]) from public, anon;
grant execute on function public.acq_js_trim(text)                             to authenticated, service_role;
grant execute on function public.acq_name_tokens(text)                         to authenticated, service_role;
grant execute on function public.acq_compare_tenant_names(text, text)          to authenticated, service_role;
grant execute on function public.acq_compare_property(text, text[])            to authenticated, service_role;
grant execute on function public.acq_match_requires_reason(jsonb, text, text[]) to authenticated, service_role;

-- ── 2 · the evidence: acquisition_conversion_attestations ────────────────────
create table if not exists public.acquisition_conversion_attestations (
  id             uuid primary key default gen_random_uuid(),
  review_id      uuid not null references public.acquisition_reviews(id) on delete cascade,
  property_id    uuid not null references public.properties(id) on delete restrict,
  family_id      uuid not null,
  kind           text not null
                 constraint acq_attestations_kind_check check (kind in ('no_document_on_file', 'match_confirmed')),
  row_key        text,
  reason         text
                 constraint acq_attestations_reason_check check (reason is null or length(public.acq_js_trim(reason)) between 1 and 1000),
  -- An acknowledgement records that a lease is missing. It never verifies a
  -- lease term; this column exists so that no row can ever say it does.
  verifies_terms boolean not null default false
                 constraint acq_attestations_verifies_nothing check (verifies_terms = false),
  acted_by       uuid not null,
  created_at     timestamptz not null default now(),
  constraint acq_attestations_row_key_check
    check ((kind = 'match_confirmed') = (row_key is not null and length(btrim(row_key)) > 0)),
  constraint acq_attestations_family_property_fk
    foreign key (family_id, property_id) references public.acquisition_document_families(id, property_id) on delete cascade
);

create index if not exists idx_acq_attestations_review on public.acquisition_conversion_attestations (review_id);
create index if not exists idx_acq_attestations_family on public.acquisition_conversion_attestations (family_id);
create unique index if not exists acq_attestations_one_ack_per_leasehold
  on public.acquisition_conversion_attestations (review_id, family_id) where kind = 'no_document_on_file';

-- Stamp who and when; refuse anything out of scope or meaningless.
create or replace function public.acq_attestations_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_rev   public.acquisition_reviews%rowtype;
  v_fam   public.acquisition_document_families%rowtype;
  v_row   jsonb;
  v_pname text;
begin
  if v_uid is null then
    raise exception 'An acquisition acknowledgement is made by a signed-in person'
      using errcode = 'insufficient_privilege';
  end if;
  new.acted_by   := v_uid;
  new.created_at := now();
  new.reason     := nullif(public.acq_js_trim(coalesce(new.reason, '')), '');

  -- Who first, so a caller who may not act learns nothing about what exists:
  -- the property's owner, or an active member of its organisation who may
  -- edit (every role but read_only). Converting still needs an administrator.
  select * into v_rev from public.acquisition_reviews where id = new.review_id;
  if not found or v_rev.property_id is null or not exists (
       select 1 from public.properties p
        where p.id = v_rev.property_id
          and (p.user_id = v_uid
               or (p.organization_id is not null and exists (
                     select 1 from public.organization_members m
                      where m.organization_id = p.organization_id and m.user_id = v_uid
                        and m.role <> 'read_only' and m.accepted_at is not null and m.revoked_at is null)))) then
    raise exception 'Only the owner of the property, or a member of its organisation who may edit it, records an acquisition acknowledgement'
      using errcode = 'insufficient_privilege';
  end if;
  if v_rev.status not in ('draft', 'analyzing', 'complete') then
    raise exception 'Review % is %; only an open acquisition takes an acknowledgement', new.review_id, v_rev.status
      using errcode = 'check_violation';
  end if;
  select * into v_fam from public.acquisition_document_families where id = new.family_id;
  if not found or v_fam.review_id is distinct from new.review_id then
    raise exception 'Leasehold % is not one of review %''s leaseholds', new.family_id, new.review_id
      using errcode = 'check_violation';
  end if;

  if new.kind = 'no_document_on_file' then
    if exists (
      select 1 from public.acquisition_documents d
       where d.review_id = new.review_id and d.family_id = new.family_id
         and d.superseded_by_document_id is null
         and coalesce(v_rev.data->'documentDispositions'->(d.id::text)->>'action', '') not in ('not_relevant', 'duplicate')) then
      raise exception 'Leasehold “%” has a lease document on file; there is no missing lease to acknowledge',
        coalesce(nullif(v_fam.label, ''), v_fam.tenant_hint) using errcode = 'check_violation';
    end if;
  elsif new.kind = 'match_confirmed' then
    select t.value into v_row
      from jsonb_array_elements(case when jsonb_typeof(v_rev.data->'tenants') = 'array' then v_rev.data->'tenants' else '[]'::jsonb end) t
     where t.value->>'id' = new.row_key
     limit 1;
    if v_row is null then
      raise exception 'Review % has no extracted entry %', new.review_id, new.row_key using errcode = 'check_violation';
    end if;
    select p.name into v_pname from public.properties p where p.id = v_rev.property_id;
    if new.reason is null
       and public.acq_match_requires_reason(v_row, coalesce(nullif(v_fam.label, ''), v_fam.tenant_hint), array[v_rev.name, v_pname]) then
      raise exception 'Matching this entry to “%” is a material mismatch; a person''s reason is required to confirm it',
        coalesce(nullif(v_fam.label, ''), v_fam.tenant_hint) using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

-- Append-only: no update, ever; a delete only when its review or leasehold is
-- deleted (the foreign key's cascade, one trigger level down).
create or replace function public.acq_attestations_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception 'acquisition_conversion_attestations is append-only: % is refused', tg_op
    using errcode = 'restrict_violation';
end;
$$;

drop trigger if exists acq_attestations_guard on public.acquisition_conversion_attestations;
create trigger acq_attestations_guard
  before insert on public.acquisition_conversion_attestations
  for each row execute function public.acq_attestations_guard();
drop trigger if exists acq_attestations_property_bind on public.acquisition_conversion_attestations;
create trigger acq_attestations_property_bind
  before insert on public.acquisition_conversion_attestations
  for each row execute function public.acq_child_property_bind();
drop trigger if exists acq_children_frozen on public.acquisition_conversion_attestations;
create trigger acq_children_frozen
  before insert or update or delete on public.acquisition_conversion_attestations
  for each row execute function public.acq_children_frozen();
drop trigger if exists acq_attestations_append_only on public.acquisition_conversion_attestations;
create trigger acq_attestations_append_only
  before update or delete on public.acquisition_conversion_attestations
  for each row execute function public.acq_attestations_append_only();

alter table public.acquisition_conversion_attestations enable row level security;
drop policy if exists acq_attestations_member_select on public.acquisition_conversion_attestations;
create policy acq_attestations_member_select on public.acquisition_conversion_attestations
  for select to authenticated
  using (property_id in (select public.member_property_ids()));
drop policy if exists acq_attestations_member_insert on public.acquisition_conversion_attestations;
create policy acq_attestations_member_insert on public.acquisition_conversion_attestations
  for insert to authenticated
  with check (property_id in (select public.member_property_ids()));

revoke all on table public.acquisition_conversion_attestations from public, anon, authenticated;
grant select, insert on table public.acquisition_conversion_attestations to authenticated;
grant select, insert on table public.acquisition_conversion_attestations to service_role;

-- ── 3 · acquire_property: 035 verbatim, with 5c and 5d ───────────────────────
create or replace function public.acquire_property(
  p_property_id uuid,
  p_review_id   uuid,
  p_snapshot    jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid        uuid := auth.uid();
  v_now        timestamptz := now();
  v_now_iso    text;
  v_prop       public.properties%rowtype;
  v_rev        public.acquisition_reviews%rowtype;
  v_fam_ids    uuid[];
  v_roster     jsonb;
  v_roster_ids uuid[] := '{}';
  v_row        jsonb;
  v_fid        uuid;
  v_fid_txt    text;
  v_missing    uuid[];
  v_other_prop uuid;
  v_open_others integer;
  v_pending    integer;
  v_unresolved integer;
  v_tenants    integer := 0;
  v_existing_inv jsonb;
  v_carried_inv  jsonb;
  v_carried    integer;
  v_public_roster jsonb;
  v_record     jsonb;
  v_activity   jsonb;
  v_count      integer;
  v_entry      jsonb;
  v_event_id   uuid;
  v_acquired_at timestamptz;
  v_review_out jsonb;
  v_docless    integer;
  v_docless_names text;
  v_unreasoned integer;
  v_unreasoned_names text;
  v_names      text[];
  c_uuid       constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  c_num        constant text := '^-?[0-9]+(\.[0-9]+)?$';
  -- The family-type documents of acquisition-documents.js DOC_TYPES (family: true).
  c_family_types constant text[] := array['original_lease','amendment','renewal','extension','assignment','guaranty','estoppel','snda','side_letter'];
begin
  -- ── 1 · who ───────────────────────────────────────────────────────────────
  if v_uid is null then
    raise exception 'acquire_property requires an authenticated user'
      using errcode = 'insufficient_privilege';
  end if;
  if p_property_id is null or p_review_id is null then
    raise exception 'acquire_property needs a property id and a review id' using errcode = 'check_violation';
  end if;
  -- Authorisation first, so a stranger learns nothing about what exists.
  if not public.is_property_admin(p_property_id) then
    raise exception 'Only an administrator of the property may acquire it'
      using errcode = 'insufficient_privilege';
  end if;

  -- ── 2 · the property ──────────────────────────────────────────────────────
  select * into v_prop from public.properties where id = p_property_id for update;
  if not found then
    raise exception 'Property % does not exist', p_property_id using errcode = 'no_data_found';
  end if;
  if v_prop.archived_at is not null then
    raise exception 'Property % is archived and cannot be acquired', p_property_id using errcode = 'check_violation';
  end if;
  if v_prop.lifecycle_stage <> 'prospect' then
    raise exception 'Property % is %, not a prospect; only a prospect can be acquired', p_property_id, v_prop.lifecycle_stage
      using errcode = 'check_violation';
  end if;

  -- ── 3 · the episode ───────────────────────────────────────────────────────
  select * into v_rev from public.acquisition_reviews where id = p_review_id for update;
  if not found then
    raise exception 'No acquisition review % exists', p_review_id using errcode = 'no_data_found';
  end if;
  if v_rev.property_id is distinct from p_property_id then
    raise exception 'Review % belongs to property %, not to property %', p_review_id, coalesce(v_rev.property_id::text, '<none>'), p_property_id
      using errcode = 'check_violation';
  end if;
  if v_rev.status = 'converted' then
    raise exception 'Review % is already converted', p_review_id using errcode = 'check_violation';
  end if;
  if v_rev.status not in ('draft', 'analyzing', 'complete') then
    raise exception 'Review % is %; only an open episode (draft, analyzing, complete) can be acquired', p_review_id, v_rev.status
      using errcode = 'check_violation';
  end if;
  select count(*) into v_open_others from public.acquisition_reviews
   where property_id = p_property_id and id <> p_review_id and status in ('draft', 'analyzing', 'complete');
  if v_open_others > 0 then
    raise exception 'Property % has % other open episode(s); review % is not its only one', p_property_id, v_open_others, p_review_id
      using errcode = 'check_violation';
  end if;

  -- ── 4 · the canonical leaseholds ──────────────────────────────────────────
  select coalesce(array_agg(f.id order by f.id), '{}'::uuid[]) into v_fam_ids
    from public.acquisition_document_families f
   where f.review_id = p_review_id and f.property_id = p_property_id;
  if coalesce(array_length(v_fam_ids, 1), 0) = 0 then
    raise exception 'Review % has no leasehold; there is no tenant to create', p_review_id using errcode = 'check_violation';
  end if;

  -- ── 5 · the integrity gate (structural port of the client gate) ───────────
  -- 5a · pending documents (acquisition-documents.js pendingDocuments)
  select count(*) into v_pending
    from public.acquisition_documents d
   where d.review_id = p_review_id
     and d.superseded_by_document_id is null
     and coalesce(v_rev.data->'documentDispositions'->(d.id::text)->>'action', '') not in ('not_relevant', 'duplicate')
     and (
       d.doc_type is null or d.doc_type = 'unknown'
       or (d.doc_type = any(c_family_types)
           and (d.family_id is null
                or not exists (select 1 from public.acquisition_document_families f where f.id = d.family_id and f.review_id = p_review_id)
                or d.family_status <> 'confirmed'))
     );
  if v_pending > 0 then
    raise exception 'Review % has % document(s) a person must still resolve (type not set, not matched to a tenant, or filed by AI and not confirmed)', p_review_id, v_pending
      using errcode = 'check_violation';
  end if;

  -- 5b · unresolved extractions (acquisition-leasehold.js legacyRows + unmatchedEntries)
  with raw as (
    select t.value as row, t.value->>'id' as key
      from jsonb_array_elements(case when jsonb_typeof(v_rev.data->'tenants') = 'array' then v_rev.data->'tenants' else '[]'::jsonb end) t
     where coalesce(t.value->>'_status', '') not in ('error', 'pending')
       and coalesce(nullif(t.value->>'tenant_name', ''), nullif(t.value->>'tenantName', '')) is not null
  ), filed as (
    select r.row, r.key, d.id as doc_id, d.superseded_by_document_id, d.family_id
      from raw r
      left join lateral (
        select d.* from public.acquisition_documents d
         where d.review_id = p_review_id and r.key is not null and d.produced_id is not null and d.produced_id::text = r.key
         order by d.created_at desc limit 1
      ) d on true
  ), unfiled as (
    select f.*, v_rev.data->'extractionResolutions'->f.key as res
      from filed f
     where not (f.doc_id is not null and f.superseded_by_document_id is not null)
       and not (f.doc_id is not null and f.family_id is not null and f.family_id = any(v_fam_ids))
  )
  select count(*) into v_unresolved
    from unfiled u
   where not (
     u.key is not null and u.res is not null and jsonb_typeof(u.res) = 'object' and (
       u.res->>'action' = 'dismissed'
       or (u.res->>'action' in ('matched', 'new_leasehold') and u.doc_id is null
           and (u.res->>'familyId') ~* c_uuid and (u.res->>'familyId')::uuid = any(v_fam_ids))
     )
   );
  if v_unresolved > 0 then
    raise exception 'Review % has % extracted entry/entries not matched to a tenant; a person must resolve them before acquisition', p_review_id, v_unresolved
      using errcode = 'check_violation';
  end if;

  -- 5c · no lease on file (044). A leasehold no live document is filed into
  -- (AcquisitionLeasehold.documentlessLeaseholds: filed into it, not replaced
  -- by a newer upload, not set aside as not relevant or a duplicate) becomes a
  -- tenant with no lease term established by any document. A person must have
  -- acknowledged THAT leasehold of THIS review, in the table the database
  -- stamps — not in review.data. The acknowledgement verifies nothing.
  select count(*), string_agg('“' || coalesce(nullif(f.label, ''), f.tenant_hint, 'Unnamed leasehold') || '”', ', ' order by f.label, f.id)
    into v_docless, v_docless_names
    from public.acquisition_document_families f
   where f.id = any(v_fam_ids)
     and not exists (
       select 1 from public.acquisition_documents d
        where d.review_id = p_review_id and d.family_id = f.id
          and d.superseded_by_document_id is null
          and coalesce(v_rev.data->'documentDispositions'->(d.id::text)->>'action', '') not in ('not_relevant', 'duplicate'))
     and not exists (
       select 1 from public.acquisition_conversion_attestations a
        where a.review_id = p_review_id and a.family_id = f.id and a.kind = 'no_document_on_file');
  if v_docless > 0 then
    raise exception 'Review % has % leasehold(s) with no lease document on file and no acknowledgement: %. A person must acknowledge each one before acquisition; an acknowledgement records that the lease is missing and does not verify any lease term', p_review_id, v_docless, v_docless_names
      using errcode = 'check_violation';
  end if;

  -- 5d · concerning matches (044). Every `matched` resolution 5b honours is
  -- compared again HERE — the client's `concerns` are not read. A material
  -- mismatch (tenant name or the lease's property) stands only with a person's
  -- reason recorded for THIS extracted entry as THIS leasehold of THIS review.
  v_names := array[v_rev.name, v_prop.name];
  with raw as (
    select t.value as row, t.value->>'id' as key
      from jsonb_array_elements(case when jsonb_typeof(v_rev.data->'tenants') = 'array' then v_rev.data->'tenants' else '[]'::jsonb end) t
     where coalesce(t.value->>'_status', '') not in ('error', 'pending')
       and coalesce(nullif(t.value->>'tenant_name', ''), nullif(t.value->>'tenantName', '')) is not null
  ), filed as (
    select r.row, r.key, d.id as doc_id, d.superseded_by_document_id, d.family_id
      from raw r
      left join lateral (
        select d.* from public.acquisition_documents d
         where d.review_id = p_review_id and r.key is not null and d.produced_id is not null and d.produced_id::text = r.key
         order by d.created_at desc limit 1
      ) d on true
  ), unfiled as (
    select f.*, v_rev.data->'extractionResolutions'->f.key as res
      from filed f
     where not (f.doc_id is not null and f.superseded_by_document_id is not null)
       and not (f.doc_id is not null and f.family_id is not null and f.family_id = any(v_fam_ids))
  ), matched as (
    select u.key, u.row, (case when (u.res->>'familyId') ~* c_uuid then (u.res->>'familyId')::uuid end) as fid
      from unfiled u
     where u.key is not null and u.res is not null and jsonb_typeof(u.res) = 'object'
       and u.res->>'action' = 'matched' and u.doc_id is null
  )
  select count(*), string_agg('“' || coalesce(nullif(m.row->>'tenant_name', ''), m.row->>'tenantName') || '” → “' || coalesce(nullif(fm.label, ''), fm.tenant_hint, 'Unnamed leasehold') || '”', ', ' order by m.key)
    into v_unreasoned, v_unreasoned_names
    from matched m
    join public.acquisition_document_families fm on fm.id = m.fid and fm.id = any(v_fam_ids)
   where public.acq_match_requires_reason(m.row, coalesce(nullif(fm.label, ''), fm.tenant_hint), v_names)
     and not exists (
       select 1 from public.acquisition_conversion_attestations a
        where a.review_id = p_review_id and a.family_id = m.fid and a.kind = 'match_confirmed'
          and a.row_key = m.key and a.reason is not null and length(public.acq_js_trim(a.reason)) > 0);
  if v_unreasoned > 0 then
    raise exception 'Review % has % match(es) made despite a material mismatch with no recorded reason: %. Undo each match and match it again with a reason before acquisition', p_review_id, v_unreasoned, v_unreasoned_names
      using errcode = 'check_violation';
  end if;

  -- ── 6 · the supplied roster, structurally ─────────────────────────────────
  v_roster := p_snapshot->'roster';
  if v_roster is null or jsonb_typeof(v_roster) <> 'array' then
    raise exception 'p_snapshot.roster must be an array with one row per canonical leasehold' using errcode = 'check_violation';
  end if;
  if jsonb_array_length(v_roster) <> array_length(v_fam_ids, 1) then
    raise exception 'The roster has % row(s); review % has % leasehold(s)', jsonb_array_length(v_roster), p_review_id, array_length(v_fam_ids, 1)
      using errcode = 'check_violation';
  end if;
  for v_row in select value from jsonb_array_elements(v_roster) loop
    if jsonb_typeof(v_row) <> 'object' then
      raise exception 'A roster row is not an object' using errcode = 'check_violation';
    end if;
    v_fid_txt := coalesce(nullif(v_row->>'family_id', ''), nullif(v_row->>'_leaseholdId', ''), nullif(v_row->>'id', ''));
    if v_fid_txt is null or v_fid_txt !~* c_uuid then
      raise exception 'A roster row names no leasehold id' using errcode = 'check_violation';
    end if;
    v_fid := v_fid_txt::uuid;
    if nullif(v_row->>'id', '') is not null and ((v_row->>'id') !~* c_uuid or (v_row->>'id')::uuid <> v_fid) then
      raise exception 'Roster row id % is not its leasehold id %', v_row->>'id', v_fid using errcode = 'check_violation';
    end if;
    if nullif(v_row->>'property_id', '') is not null and ((v_row->>'property_id') !~* c_uuid or (v_row->>'property_id')::uuid <> p_property_id) then
      raise exception 'Roster row names property %, not property %', v_row->>'property_id', p_property_id using errcode = 'check_violation';
    end if;
    if nullif(v_row->>'review_id', '') is not null and ((v_row->>'review_id') !~* c_uuid or (v_row->>'review_id')::uuid <> p_review_id) then
      raise exception 'Roster row names review %, not review %', v_row->>'review_id', p_review_id using errcode = 'check_violation';
    end if;
    if not (v_fid = any(v_fam_ids)) then
      raise exception 'Roster row names leasehold %, which is not one of review %''s leaseholds on property %', v_fid, p_review_id, p_property_id
        using errcode = 'check_violation';
    end if;
    if v_fid = any(v_roster_ids) then
      raise exception 'Leasehold % appears more than once in the roster', v_fid using errcode = 'check_violation';
    end if;
    v_roster_ids := v_roster_ids || v_fid;
  end loop;
  select coalesce(array_agg(f), '{}'::uuid[]) into v_missing from unnest(v_fam_ids) f where not (f = any(v_roster_ids));
  if coalesce(array_length(v_missing, 1), 0) > 0 then
    raise exception 'The roster is missing leasehold(s) %', v_missing using errcode = 'check_violation';
  end if;
  -- A tenant row with a leasehold's id that lives under another property is
  -- never adopted or re-pointed (033 would refuse the move; refuse it here by name).
  select t.property_id into v_other_prop from public.tenants t
   where t.id = any(v_fam_ids) and t.property_id is distinct from p_property_id limit 1;
  if found then
    raise exception 'A tenant with a leasehold''s id already belongs to property %; it is not re-pointed to property %', v_other_prop, p_property_id
      using errcode = 'check_violation';
  end if;

  -- ── 7 · the SAME property becomes acquired (033's mechanism) ──────────────
  perform set_config('mainstreet.acquire', 'on', true);
  update public.properties
     set lifecycle_stage  = 'acquired',
         stage_changed_by = v_uid,
         stage_changed_at = v_now
   where id = p_property_id;
  perform set_config('mainstreet.acquire', '', true);

  -- ── 8 · operational tenants: one per leasehold, id = leasehold id ─────────
  for v_row in select value from jsonb_array_elements(v_roster) loop
    v_fid := coalesce(nullif(v_row->>'family_id', ''), nullif(v_row->>'_leaseholdId', ''), nullif(v_row->>'id', ''))::uuid;
    insert into public.tenants (id, property_id, name, sqft, cap, start_date, end_date, lease_url, lease_type)
    values (
      v_fid,
      p_property_id,
      coalesce(nullif(v_row->>'tenant_name', ''), nullif(v_row->>'tenantName', ''),
               (select coalesce(nullif(f.label, ''), f.tenant_hint) from public.acquisition_document_families f where f.id = v_fid), 'Unnamed leasehold'),
      case when (v_row->>'leased_sqft') ~ c_num then (v_row->>'leased_sqft')::numeric end,
      case when coalesce(v_row->>'cap', v_row->>'cam_cap') ~ c_num then coalesce(v_row->>'cap', v_row->>'cam_cap')::numeric end,
      case when (v_row->>'start_date') ~ '^\d{4}-\d{2}-\d{2}' then substr(v_row->>'start_date', 1, 10)::date end,
      case when (v_row->>'end_date')   ~ '^\d{4}-\d{2}-\d{2}' then substr(v_row->>'end_date', 1, 10)::date end,
      nullif(v_row->>'lease_url', ''),
      nullif(v_row->>'lease_type', '')
    )
    on conflict (id) do update
      set name       = excluded.name,
          sqft       = excluded.sqft,
          cap        = excluded.cap,
          start_date = excluded.start_date,
          end_date   = excluded.end_date,
          lease_url  = coalesce(excluded.lease_url, tenants.lease_url),
          lease_type = excluded.lease_type
      where tenants.property_id = p_property_id;
    v_tenants := v_tenants + 1;
  end loop;

  -- ── 9 · properties.data: preserved, invoices carried once, roster stored ──
  v_now_iso := to_char(v_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_existing_inv := case when jsonb_typeof(v_prop.data->'invoices') = 'array' then v_prop.data->'invoices' else '[]'::jsonb end;
  select coalesce(jsonb_agg(e.value || jsonb_build_object('sourceEpisodeId', p_review_id, 'acquiredAt', v_now_iso)), '[]'::jsonb), count(*)
    into v_carried_inv, v_carried
    from jsonb_array_elements(case when jsonb_typeof(v_rev.data->'invoices') = 'array' then v_rev.data->'invoices' else '[]'::jsonb end) e
   where jsonb_typeof(e.value) = 'object';
  -- the roster as the workspace reads tenants: the rows as supplied, minus private keys
  select coalesce(jsonb_agg(
           (select coalesce(jsonb_object_agg(k.key, k.value), '{}'::jsonb) from jsonb_each(r.value) k where k.key not like '\_%' escape '\')
           || jsonb_build_object('id', coalesce(nullif(r.value->>'family_id', ''), nullif(r.value->>'_leaseholdId', ''), r.value->>'id'), '_fromAcquisition', true, '_leaseholdId', coalesce(nullif(r.value->>'family_id', ''), nullif(r.value->>'_leaseholdId', ''), r.value->>'id'))
         ), '[]'::jsonb)
    into v_public_roster
    from jsonb_array_elements(v_roster) r;
  update public.properties
     set data = coalesce(data, '{}'::jsonb)
                || jsonb_build_object(
                     'invoices', v_existing_inv || v_carried_inv,
                     'tenants',  v_public_roster,
                     'acquiredFrom', jsonb_build_object('reviewId', p_review_id, 'acquiredAt', v_now_iso, 'source', 'acquire_property'))
   where id = p_property_id;

  -- ── 10 · the episode is converted; it stays on the SAME property ──────────
  v_record := jsonb_build_object(
    'propertyId',   p_property_id,
    'propertyName', v_prop.name,
    'convertedAt',  v_now_iso,
    'reviewId',     p_review_id,
    'source',       'acquire_property',
    'occupancyAtAcquisition', p_snapshot->'occupancyAtAcquisition',
    'waltAtAcquisition',      p_snapshot->'waltAtAcquisition');
  v_count := coalesce(nullif(v_rev.data->>'activityCount', '')::integer, 0) + 1;
  v_entry := jsonb_build_object(
    'id',      'act-' || v_count || '-' || substr(regexp_replace(v_now_iso, '[^0-9]', '', 'g'), 1, 17),
    'at',      v_now_iso,
    'type',    'converted',
    'actor',   jsonb_build_object('uid', v_uid::text, 'email', null),
    'summary', 'Acquired — property ' || coalesce(v_prop.name, '') || ' acquired in place',
    'meta',    jsonb_build_object('from', v_rev.data->>'stage', 'propertyId', p_property_id, 'repair', false, 'source', 'acquire_property'));
  v_activity := (case when jsonb_typeof(v_rev.data->'activity') = 'array' then v_rev.data->'activity' else '[]'::jsonb end) || jsonb_build_array(v_entry);
  if jsonb_array_length(v_activity) > 500 then
    select jsonb_agg(a.value order by a.ordinality) into v_activity
      from jsonb_array_elements(v_activity) with ordinality a
     where a.ordinality > jsonb_array_length(v_activity) - 500;
  end if;
  update public.acquisition_reviews
     set status       = 'converted',
         converted_at = v_now,
         data         = coalesce(data, '{}'::jsonb)
                        || jsonb_build_object('conversionRecord', v_record, 'stage', 'acquired',
                                              'activity', v_activity, 'activityCount', v_count)
   where id = p_review_id;

  -- ── 11 · exactly one property event ───────────────────────────────────────
  insert into public.property_events (property_id, actor_uid, action, subject_type, subject_id, old_value, new_value, detail)
  values (p_property_id, v_uid, 'stage_changed', 'property', p_property_id::text, 'prospect', 'acquired',
          jsonb_build_object('source', 'acquire_property', 'reviewId', p_review_id,
                             'leaseholds', array_length(v_fam_ids, 1), 'tenants', v_tenants, 'invoices', v_carried))
  returning id into v_event_id;

  -- ── 12 · the SAME property id, and the server's truth for the client ──────
  select acquired_at into v_acquired_at from public.properties where id = p_property_id;
  select jsonb_build_object('id', r.id, 'name', r.name, 'status', r.status, 'property_id', r.property_id,
                            'converted_at', r.converted_at, 'created_at', r.created_at, 'updated_at', r.updated_at, 'data', r.data)
    into v_review_out from public.acquisition_reviews r where r.id = p_review_id;
  return jsonb_build_object(
    'ok', true,
    'property_id', p_property_id,
    'review_id', p_review_id,
    'lifecycle_stage', 'acquired',
    'acquired_at', v_acquired_at,
    'converted_at', v_now,
    'tenants_written', v_tenants,
    'invoices_carried', v_carried,
    'event_id', v_event_id,
    'review', v_review_out);
end;
$$;

revoke all on function public.acquire_property(uuid, uuid, jsonb) from public, anon;
grant execute on function public.acquire_property(uuid, uuid, jsonb) to authenticated, service_role;

comment on table public.acquisition_conversion_attestations is
  'A person''s acknowledgement that a leasehold has no lease document on file (no_document_on_file), or confirmation of a materially mismatched extraction match with a reason (match_confirmed). Stamped by the database; append-only; verifies no lease term. Read by acquire_property 5c/5d. (044)';
comment on function public.acq_compare_tenant_names(text, text) is
  'Port of AcquisitionLeasehold.compareTenantNames: null | uncertain | mismatch. Kept identical by tools/verify-migration-044.js. (044)';
comment on function public.acq_compare_property(text, text[]) is
  'Port of AcquisitionLeasehold.compareProperty: null | uncertain | mismatch. Kept identical by tools/verify-migration-044.js. (044)';

commit;
