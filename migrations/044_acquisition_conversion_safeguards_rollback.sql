-- ============================================================================
-- 044_acquisition_conversion_safeguards_rollback.sql
-- ============================================================================
-- Restores acquire_property to 035's definition, VERBATIM, and drops what 044
-- added: the attestations table (with its triggers, policies and indexes), its
-- two trigger functions, and the five name-comparison functions. 034's
-- acq_child_property_bind and 036's acq_children_frozen are shared and stay.
--
-- DATA. Dropping the table discards every acknowledgement and every recorded
-- match reason. Nothing else is touched: an acquisition already made stays
-- made (acquired is terminal by 033), and review.data is not changed. After
-- this file acquire_property again converts without the 5c/5d checks.
-- ============================================================================

begin;

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

drop table if exists public.acquisition_conversion_attestations;
drop function if exists public.acq_attestations_guard();
drop function if exists public.acq_attestations_append_only();
drop function if exists public.acq_match_requires_reason(jsonb, text, text[]);
drop function if exists public.acq_compare_property(text, text[]);
drop function if exists public.acq_compare_tenant_names(text, text);
drop function if exists public.acq_name_tokens(text);
drop function if exists public.acq_js_trim(text);

commit;
