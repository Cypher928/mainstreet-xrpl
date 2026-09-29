-- tools/verify-p5-6b-live.sql — P5-6B live RLS matrix, Pilot, READ-ONLY.
--
-- Runs the five acquisition reads the hydrator issues AS THE CALLER — the same
-- tables, filters and columns (PropertyLeaseholds.SELECT, reviews with
-- SELECT.memoryReviews) — under each role, and checks what each role sees.
-- Every probe is a SELECT. Nothing is inserted, updated or deleted; no grant,
-- policy or function is created or changed. The block ends in RAISE so even
-- the role switches are unwound, and the RAISE message IS the report.
--
-- The owner's rows are fingerprinted with the same field concatenation
-- fixtures/maple-acquisition-rows.js is checked with, so a pass proves the
-- caller read returns exactly the rows the offline tests compose from.
do $do$
declare
  A   uuid := '011df998-bad2-464e-bbcb-28e2d0fee821';   -- Maple's owner (the org's only member)
  S   uuid := '05c35898-a4e8-4943-9ad5-bc54b4cb0690';   -- a real user in no Maple org
  P   uuid := '3dc8a7b8-170c-4a51-b90d-dde831c56ca9';   -- Maple
  out text := '';
  npass int := 0; nfail int := 0;
  r text;
  Z constant text := '∅';
  q_fam  text; q_doc text; q_dec text; q_rev text; q_ev text;
  c_fam  text; c_doc text; c_dec text; c_rev text; c_ev text;
begin
  -- The five reads, as the hydrator issues them (columns = PropertyLeaseholds.SELECT).
  q_fam := format('select id, review_id, property_id, label, family_kind, tenant_hint, suite_hint, created_at, updated_at from public.acquisition_document_families where property_id = %L order by created_at limit 1000', P);
  q_doc := format('select id, review_id, property_id, user_id, family_id, family_status, file_name, storage_path, content_type, byte_size, doc_type, doc_type_status, doc_date, confirmed_by, confirmed_at, superseded_by_document_id, created_at from public.acquisition_documents where property_id = %L order by created_at limit 1000', P);
  q_dec := format('select id, review_id, property_id, family_id, field_key, action, previous_value, new_value, source_document_id, source_quote, source_page, decided_by, decided_at, note, created_at from public.acquisition_term_decisions where property_id = %L order by decided_at limit 1000', P);
  q_rev := format('select id, property_id, status, converted_at, created_at, user_id, data->''activityCount'' as activity_count, data->''analysis''->''canonical'' as canonical, data->''invoices'' as invoices, data->''conversionRecord'' as conversion from public.acquisition_reviews where property_id = %L and status = ''converted'' limit 1000', P);
  q_ev  := format('select id, property_id, actor_uid, actor_email, action, subject_type, subject_id, old_value, new_value, detail, client_ts, created_at, source_key from public.property_events where property_id = %L and action = ''stage_changed'' order by created_at limit 1000', P);

  -- Fingerprints over the rows each read returns (the fixture's formula).
  c_fam := 'select count(*)::text || ''|'' || md5(string_agg(concat_ws(''|'', id, review_id, property_id, label, family_kind, tenant_hint, coalesce(suite_hint, ''' || Z || '''), to_json(created_at)#>>''{}'', to_json(updated_at)#>>''{}''), E''\n'' order by id)) from (' || q_fam || ') x';
  c_doc := 'select count(*)::text || ''|'' || md5(string_agg(concat_ws(''|'', id, review_id, property_id, user_id, coalesce(family_id::text, ''' || Z || '''), family_status, file_name, storage_path, content_type, byte_size, coalesce(doc_type, ''' || Z || '''), doc_type_status, coalesce(doc_date::text, ''' || Z || '''), coalesce(confirmed_by::text, ''' || Z || '''), coalesce(to_json(confirmed_at)#>>''{}'', ''' || Z || '''), coalesce(superseded_by_document_id::text, ''' || Z || '''), to_json(created_at)#>>''{}''), E''\n'' order by id)) from (' || q_doc || ') x';
  c_dec := 'select count(*)::text || ''|'' || md5(string_agg(concat_ws(''|'', id, review_id, property_id, family_id, field_key, action, coalesce(previous_value, ''' || Z || '''), coalesce(new_value, ''' || Z || '''), coalesce(source_document_id::text, ''' || Z || '''), coalesce(source_quote, ''' || Z || '''), coalesce(source_page::text, ''' || Z || '''), decided_by, to_json(decided_at)#>>''{}'', coalesce(note, ''' || Z || '''), to_json(created_at)#>>''{}''), E''\n'' order by id)) from (' || q_dec || ') x';
  c_rev := 'select count(*)::text || ''|'' || coalesce(max(md5(invoices::text || ''|'' || conversion::text)), ''none'') || ''|'' || coalesce(max(activity_count::text), ''none'') from (' || q_rev || ') x';
  c_ev  := 'select count(*)::text || ''|'' || coalesce(string_agg(id::text || '':'' || coalesce(source_key, ''direct''), '','' order by id), ''none'') from (' || q_ev || ') x';

  create function pg_temp.probe(p_role text, p_uid text, p_sql text) returns text language plpgsql as $f$
  declare v text; msg text; st text;
  begin
    begin
      execute format('set local role %I', p_role);
      perform set_config('request.jwt.claim.sub', coalesce(p_uid, ''), true);
      execute p_sql into v;
      execute 'reset role';
      perform set_config('request.jwt.claim.sub', '', true);
      return coalesce(v, 'null');
    exception when others then
      get stacked diagnostics msg = message_text, st = returned_sqlstate;
      execute 'reset role';
      perform set_config('request.jwt.claim.sub', '', true);
      return 'ERR ' || st;
    end;
  end $f$;

  create function pg_temp.line(p_label text, p_got text, p_want text) returns text language sql as $f$
    select case when p_got = p_want then 'PASS ' else 'FAIL ' end || p_label || ' => ' || p_got || case when p_got = p_want then '' else '  (want ' || p_want || ')' end || E'\n'
  $f$;

  -- ── Owner: exactly Maple's rows, byte-for-byte the fixture's ──────────────
  out := out || pg_temp.line('L1 owner reads families',  pg_temp.probe('authenticated', A::text, c_fam), '5|573cf12dd156dad71b0eb24c4c2c0964');
  out := out || pg_temp.line('L2 owner reads documents', pg_temp.probe('authenticated', A::text, c_doc), '8|01f761462e2a526c67bc3ddff7b90b5e');
  out := out || pg_temp.line('L3 owner reads decisions', pg_temp.probe('authenticated', A::text, c_dec), '27|e5fea6d2baad246d13fe5fe1887b0491');
  out := out || pg_temp.line('L4 owner reads the converted review (+invoices, conversionRecord)', pg_temp.probe('authenticated', A::text, c_rev), '1|b8b85ec846fab429451874b85e822222|45');
  out := out || pg_temp.line('L5 owner reads the one direct acquisition event', pg_temp.probe('authenticated', A::text, c_ev), '1|9b9f424e-6cad-4649-8eea-c4a39ad85ec1:direct');

  -- ── Unrelated authenticated user: nothing ─────────────────────────────────
  out := out || pg_temp.line('L6 stranger: families',  pg_temp.probe('authenticated', S::text, 'select count(*)::text from (' || q_fam || ') x'), '0');
  out := out || pg_temp.line('L7 stranger: documents', pg_temp.probe('authenticated', S::text, 'select count(*)::text from (' || q_doc || ') x'), '0');
  out := out || pg_temp.line('L8 stranger: decisions', pg_temp.probe('authenticated', S::text, 'select count(*)::text from (' || q_dec || ') x'), '0');
  out := out || pg_temp.line('L9 stranger: reviews',   pg_temp.probe('authenticated', S::text, 'select count(*)::text from (' || q_rev || ') x'), '0');
  out := out || pg_temp.line('L10 stranger: events',   pg_temp.probe('authenticated', S::text, 'select count(*)::text from (' || q_ev  || ') x'), '0');

  -- ── A token with no user (auth.uid() null): nothing ───────────────────────
  out := out || pg_temp.line('L11 authenticated with no sub: decisions', pg_temp.probe('authenticated', null, 'select count(*)::text from (' || q_dec || ') x'), '0');

  -- ── Anonymous: refused outright ───────────────────────────────────────────
  out := out || pg_temp.line('L12 anon: families',  pg_temp.probe('anon', null, 'select count(*)::text from (' || q_fam || ') x'), 'ERR 42501');
  out := out || pg_temp.line('L13 anon: documents', pg_temp.probe('anon', null, 'select count(*)::text from (' || q_doc || ') x'), 'ERR 42501');
  out := out || pg_temp.line('L14 anon: decisions', pg_temp.probe('anon', null, 'select count(*)::text from (' || q_dec || ') x'), 'ERR 42501');
  out := out || pg_temp.line('L15 anon: reviews',   pg_temp.probe('anon', null, 'select count(*)::text from (' || q_rev || ') x'), 'ERR 42501');
  out := out || pg_temp.line('L16 anon: events',    pg_temp.probe('anon', null, 'select count(*)::text from (' || q_ev  || ') x'), 'ERR 42501');

  -- ── Service role: STILL no privilege on families / decisions (unchanged) ──
  out := out || pg_temp.line('L17 service_role: families still denied',  pg_temp.probe('service_role', null, 'select count(*)::text from (' || q_fam || ') x'), 'ERR 42501');
  out := out || pg_temp.line('L18 service_role: decisions still denied', pg_temp.probe('service_role', null, 'select count(*)::text from (' || q_dec || ') x'), 'ERR 42501');

  -- ── Grants and policies exactly as P5-6B found them ───────────────────────
  out := out || pg_temp.line('L19 service_role SELECT: reviews/documents/events yes, families/decisions no',
    (select string_agg(t || '=' || has_table_privilege('service_role', 'public.' || t, 'SELECT')::text, ',' order by t)
       from unnest(array['acquisition_document_families','acquisition_documents','acquisition_reviews','acquisition_term_decisions','property_events']) t),
    'acquisition_document_families=false,acquisition_documents=true,acquisition_reviews=true,acquisition_term_decisions=false,property_events=true');
  out := out || pg_temp.line('L20 authenticated SELECT on all five',
    (select bool_and(has_table_privilege('authenticated', 'public.' || t, 'SELECT'))::text
       from unnest(array['acquisition_document_families','acquisition_documents','acquisition_reviews','acquisition_term_decisions','property_events']) t), 'true');
  out := out || pg_temp.line('L21 policies on the five tables unchanged (count)',
    (select count(*)::text from pg_policies where schemaname = 'public' and tablename in ('acquisition_document_families','acquisition_documents','acquisition_reviews','acquisition_term_decisions','property_events')), '12');
  out := out || pg_temp.line('L22 no function named like an acquisition-memory reader exists',
    (select count(*)::text from pg_proc where pronamespace = 'public'::regnamespace and proname ~ '(acquisition_memory|acq_memory|read_acquisition)'), '0');

  select count(*) filter (where l like 'PASS%'), count(*) filter (where l like 'FAIL%')
    into npass, nfail from unnest(string_to_array(rtrim(out, E'\n'), E'\n')) l;
  raise exception E'P5-6B LIVE MATRIX (read-only; rolled back): % pass, % fail\n%', npass, nfail, out;
end $do$;
