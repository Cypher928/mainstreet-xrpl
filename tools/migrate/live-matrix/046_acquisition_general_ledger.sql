-- 046 live matrix on Pilot, run AFTER 046 is applied. ONE transaction that always
-- ends in RAISE EXCEPTION, so every fixture row written below is rolled back: the
-- acquisition, its document, its two stored-file records, both imports, the
-- reversal, the history rows and the maintenance run. Results travel out in the
-- exception message; the last line counts them. Only the four
-- mainstreet-test.local accounts are written as; the one real account is used for
-- a read-only count. Every write names a fixture row; nothing touches an existing row.
--
-- The import and the reversal are called exactly as api/_ledger-import.js and
-- api/_ledger-reverse.js call them: as service_role, naming the acting person. The
-- stored original is a storage.objects row written by this matrix with the metadata
-- shape Pilot's Storage writes (size as a number, eTag as a quoted 32-hex string),
-- so the import reads Pilot's real storage table, not a stand-in.
--
-- Storage: Pilot's storage.protect_objects_delete trigger (FOR EACH STATEMENT)
-- refuses every direct DELETE on storage.objects unless storage.allow_delete_query
-- is 'true'; the two delete checks set it for their statement and reset it after,
-- so what they test is the row rule, not that trigger.
--
-- No DDL beyond the session-local pg_temp helpers, which die with the session.
--
-- Run before 046 (or after its rollback) the same file reports FAIL lines: the
-- matrix is local-tested against both states (scratchpad phase6/prep046).
do $m$
declare
  U_OWNER  uuid := '1c682d8e-0fcb-42c9-9d91-95b9524bb113';  -- test account, admin of its own org, no properties
  EDITOR uuid := '6833ee9f-754d-41aa-8214-85652b3ef0ee';  -- test account → property_manager in U_OWNER's org (fixture)
  RO     uuid := '871e3646-ea87-4312-b27b-469e0bc0a03d';  -- test account → read_only in U_OWNER's org (fixture)
  OUTS   uuid := 'a8048989-1a8f-4891-b5e2-d985f5000915';  -- test account → stranger
  REAL1  uuid := '011df998-bad2-464e-bbcb-28e2d0fee821';  -- real owner account, READ-ONLY count
  MARKER uuid := 'fd9c09b1-b657-4c58-9999-c3cce28e7600';  -- the Pilot marker property (another organisation's)
  BYTES  constant bigint := 4321;                         -- the fixture original's size, as Storage records it
  ETAG   constant text := '"'||md5('046 live matrix original')||'"';
  SHA    constant text := encode(sha256(convert_to('046 live matrix ledger', 'UTF8')), 'hex');
  SVC_FNS constant text[] := array['import_general_ledger(uuid,uuid,jsonb,jsonb,jsonb,text)', 'reverse_general_ledger_import(uuid,uuid,text)',
    'purge_ledger_import_history()', 'check_ledger_evidence_integrity()', 'run_ledger_maintenance()', 'ledger_actor_may_edit(uuid,uuid)', 'ledger_actor_is_admin(uuid,uuid)'];
  TRG_FNS constant text[] := array['ledger_import_history_append_only()', 'financial_sources_acq_guard()', 'financial_sources_acq_keep()',
    'financial_sources_acq_removed()', 'gl_entries_import_guard()'];
  ORG uuid; res text[] := '{}'; ln text; j jsonb; fl jsonb; pl jsonb; pv jsonb;
  pa uuid; ra uuid; da uuid; src uuid; src2 uuid; OBJ text; CTRL text; f text;
  n int; t text; c1 int; c2 int; c3 int; c4 int; c5 int; ok_n int := 0; fail_n int := 0;
begin
  if not exists (select 1 from public.properties where id = MARKER) then
    raise exception 'REFUSING TO RUN: pilot marker property not found. This matrix is for the Pilot project only.';
  end if;

  create function pg_temp.as_user(uid uuid) returns void language plpgsql as $f$
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', uid::text, true);
    perform set_config('role', 'authenticated', true);
  end $f$;
  create function pg_temp.as_service() returns void language plpgsql as $f$
  begin
    perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('role', 'service_role', true);
  end $f$;
  create function pg_temp.as_anon() returns void language plpgsql as $f$
  begin
    perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('role', 'anon', true);
  end $f$;
  create function pg_temp.as_db() returns void language plpgsql as $f$
  begin
    perform set_config('role', 'none', true);
    perform set_config('request.jwt.claims', '', true);
    perform set_config('request.jwt.claim.sub', '', true);
  end $f$;
  create function pg_temp.v(cond boolean) returns text language sql as $f$ select case when coalesce(cond, false) then ' ok' else ' FAIL' end $f$;

  -- ── K · the catalog 046 leaves (read as the database owner) ────────────────
  select count(*) into c1 from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and relrowsecurity
     and relname in ('gl_entry_sources', 'gl_entries_reversed', 'ledger_import_history', 'ledger_maintenance_runs');
  res := res || ('K1 the four new tables exist with row rules on: '||c1||'/4'||pg_temp.v(c1 = 4));
  select coalesce(string_agg(table_name||':'||grantee||'='||p, ';' order by table_name, grantee), '-') into t from (
    select table_name, grantee, string_agg(privilege_type, ',' order by privilege_type) p from information_schema.role_table_grants
     where table_schema = 'public' and grantee in ('anon', 'authenticated', 'service_role')
       and table_name in ('gl_entry_sources', 'gl_entries_reversed', 'ledger_import_history', 'ledger_maintenance_runs') group by 1, 2) s;
  res := res || ('K2 grants on the new tables: '||t||pg_temp.v(t =
    'gl_entries_reversed:authenticated=SELECT;gl_entries_reversed:service_role=SELECT;gl_entry_sources:authenticated=SELECT;gl_entry_sources:service_role=SELECT;'
    ||'ledger_import_history:authenticated=SELECT;ledger_import_history:service_role=SELECT;ledger_maintenance_runs:service_role=INSERT,SELECT'));
  begin
    c1 := 0; c2 := 0; c3 := 0;
    foreach f in array SVC_FNS loop
      if to_regprocedure('public.'||f) is not null then c1 := c1 + 1;
        if has_function_privilege('service_role', 'public.'||f, 'execute') and not has_function_privilege('authenticated', 'public.'||f, 'execute')
           and not has_function_privilege('anon', 'public.'||f, 'execute') then c2 := c2 + 1; end if;
      end if;
    end loop;
    foreach f in array TRG_FNS loop
      if to_regprocedure('public.'||f) is not null then c1 := c1 + 1;
        if not has_function_privilege('authenticated', 'public.'||f, 'execute') and not has_function_privilege('anon', 'public.'||f, 'execute') then c3 := c3 + 1; end if;
      end if;
    end loop;
    if to_regprocedure('public.storage_object_is_acquisition_evidence(text,text)') is not null then c1 := c1 + 1;
      if has_function_privilege('authenticated', 'public.storage_object_is_acquisition_evidence(text,text)', 'execute')
         and not has_function_privilege('anon', 'public.storage_object_is_acquisition_evidence(text,text)', 'execute') then c3 := c3 + 1; end if;
    end if;
    res := res || ('K3 the 13 functions exist ('||c1||'/13); import, reversal, purge, integrity, maintenance and actor helpers run for service_role only ('
      ||c2||'/7); triggers and the storage helper closed to anon and authenticated as written ('||c3||'/6)'||pg_temp.v(c1 = 13 and c2 = 7 and c3 = 6));
  exception when others then res := res || ('K3 FAIL: '||sqlstate||' '||left(sqlerrm, 80)); end;
  select count(*) into c1 from pg_trigger where not tgisinternal and (tgrelid, tgname) in (
    ('public.financial_sources'::regclass, 'financial_sources_acq_guard'), ('public.financial_sources'::regclass, 'financial_sources_acq_keep'),
    ('public.financial_sources'::regclass, 'financial_sources_acq_removed'), ('public.gl_entries'::regclass, 'gl_entries_import_guard'));
  select count(*) into c2 from pg_trigger t join pg_class c on c.oid = t.tgrelid
   where not t.tgisinternal and c.relnamespace = 'public'::regnamespace and c.relname = 'ledger_import_history'
     and t.tgname in ('ledger_import_history_append_only', 'ledger_import_history_no_truncate');
  res := res || ('K4 guard triggers: financial_sources + gl_entries '||c1||'/4, ledger_import_history '||c2||'/2'||pg_temp.v(c1 = 4 and c2 = 2));
  select count(*) into c1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and permissive = 'RESTRICTIVE' and roles = '{authenticated}'
     and ((policyname = 'acq_evidence_no_update' and cmd = 'UPDATE') or (policyname = 'acq_evidence_no_delete' and cmd = 'DELETE'))
     and qual like '%storage_object_is_acquisition_evidence(bucket_id, name)%';
  select count(*) into c2 from pg_policies where schemaname = 'storage' and tablename = 'objects' and permissive = 'PERMISSIVE'
     and policyname in ('docs_owner_read', 'docs_owner_insert', 'docs_owner_update', 'docs_owner_delete');
  res := res || ('K5 storage: the two restrictive evidence rules '||c1||'/2; 047''s four docs_owner rules kept '||c2||'/4'||pg_temp.v(c1 = 2 and c2 = 4));
  select count(*) into c1 from information_schema.columns where table_schema = 'public' and table_name = 'financial_sources' and column_name in
    ('acquisition_document_id', 'import_status', 'file_sha256', 'file_bytes', 'file_etag', 'storage_path', 'date_order', 'reversed_at', 'reversed_by', 'reversal_reason');
  select count(*) into c2 from information_schema.columns where table_schema = 'public' and table_name = 'gl_entries' and column_name in ('posted_on', 'reference', 'source_row');
  res := res || ('K6 new columns: financial_sources '||c1||'/10, gl_entries '||c2||'/3'||pg_temp.v(c1 = 10 and c2 = 3));
  select coalesce(string_agg(table_name||'='||p, ';' order by table_name), '-') into t from (
    select table_name, string_agg(privilege_type, ',' order by privilege_type) p from information_schema.role_table_grants
     where table_schema = 'public' and grantee = 'authenticated' and table_name in ('financial_sources', 'gl_entries') group by 1) s;
  res := res || ('K7 045 kept: signed-in people may only read the ledger tables: '||t||pg_temp.v(t = 'financial_sources=SELECT;gl_entries=SELECT'));

  -- ── FX · fixtures: the owner begins an acquisition and files a CSV original ──
  perform pg_temp.as_user(U_OWNER);
  j := public.begin_acquisition('046 live matrix deal', '{"totalSqFt":"1000"}'::jsonb); pa := (j->>'property_id')::uuid; ra := (j->>'review_id')::uuid;
  perform pg_temp.as_db();
  select organization_id into ORG from public.properties where id = pa;
  if ORG is null or ra is null then raise exception 'fixture acquisition has no organisation or review; matrix cannot run'; end if;
  insert into public.organization_members(organization_id, user_id, role, accepted_at) values (ORG, EDITOR, 'property_manager', now()), (ORG, RO, 'read_only', now());
  OBJ := U_OWNER::text||'/acq_'||ra::text||'_046-matrix-ledger.csv';
  CTRL := U_OWNER::text||'/046-matrix-control.csv';
  -- what Storage writes when the upload endpoint stores a file: the object row with its size and ETag
  insert into storage.objects(bucket_id, name, owner, metadata) values
    ('leases', OBJ,  U_OWNER, jsonb_build_object('size', BYTES, 'eTag', ETAG, 'mimetype', 'text/csv', 'contentLength', BYTES, 'httpStatusCode', 200)),
    ('leases', CTRL, U_OWNER, jsonb_build_object('size', 10, 'eTag', '"'||md5('control')||'"', 'mimetype', 'text/csv', 'contentLength', 10, 'httpStatusCode', 200));
  perform pg_temp.as_user(U_OWNER);
  insert into public.acquisition_documents(review_id, user_id, property_id, file_name, intake_id, storage_path)
    values (ra, U_OWNER, pa, '046-matrix-ledger.csv', 'ik-046-matrix', 'leases/'||OBJ) returning id into da;
  perform pg_temp.as_db();
  res := res || ('FX owner began acquisition '||left(pa::text, 8)||' (review '||left(ra::text, 8)||', status '||(select status from public.acquisition_reviews where id = ra)
    ||'), editor + read-only members added, CSV original filed as document '||left(da::text, 8)||' with its stored-file record');
  -- what api/_ledger-import.js sends: the server's fingerprint of the stored file, its own parse, and what the person previewed
  fl := jsonb_build_object('sha256', SHA, 'bytes', BYTES, 'storagePath', 'leases/'||OBJ);
  pl := jsonb_build_object('rows', jsonb_build_array(
          jsonb_build_object('posted_on', '2025-01-15', 'account_code', '6100', 'account_name', 'Repairs', 'description', '046 matrix repair', 'vendor', 'Matrix Co',
                             'reference', 'M-1', 'debit_cents', 12345, 'credit_cents', 0, 'source_row', 2, 'key', '2025-01-15|6100|12345|0|m-1|046 matrix repair|matrix co'),
          jsonb_build_object('posted_on', '2025-01-15', 'account_code', '1000', 'account_name', 'Cash', 'description', '046 matrix repair', 'vendor', 'Matrix Co',
                             'reference', 'M-1', 'debit_cents', 0, 'credit_cents', 12345, 'source_row', 3, 'key', '2025-01-15|1000|0|12345|m-1|046 matrix repair|matrix co')),
        'summary', jsonb_build_object('lines', 2, 'debitCents', 12345, 'creditCents', 12345, 'dateOrder', 'iso'));
  pv := jsonb_build_object('lines', 2, 'debitCents', 12345, 'creditCents', 12345, 'dateOrder', 'iso', 'fileSha256', SHA);

  -- ── I · the import ─────────────────────────────────────────────────────────
  begin
    perform pg_temp.as_user(U_OWNER); j := public.import_general_ledger(U_OWNER, da, fl, pl, pv, null); perform pg_temp.as_db();
    res := res || ('I1 FAIL: a signed-in person called the import directly')::text;
  exception when others then perform pg_temp.as_db(); res := res || ('I1 a signed-in person calling the import directly is refused: '||sqlstate||pg_temp.v(sqlstate = '42501')); end;
  begin
    perform pg_temp.as_service(); j := public.import_general_ledger(RO, da, fl, pl, pv, null); perform pg_temp.as_db();
    res := res || ('I2 FAIL: an import naming a read-only member was accepted')::text;
  exception when others then perform pg_temp.as_db(); res := res || ('I2 an import naming a read-only member is refused: '||sqlstate||pg_temp.v(sqlstate = '42501')); end;
  begin
    perform pg_temp.as_service(); j := public.import_general_ledger(EDITOR, da, fl, pl, pv || jsonb_build_object('fileSha256', repeat('0', 64)), null); perform pg_temp.as_db();
    res := res || ('I3 FAIL: a preview of another file was accepted')::text;
  exception when others then perform pg_temp.as_db(); res := res || ('I3 a preview of another file is refused: '||sqlstate||' '||left(sqlerrm, 60)||pg_temp.v(sqlstate = '23514' and sqlerrm like '%fingerprints differ%')); end;
  begin
    perform pg_temp.as_service(); j := public.import_general_ledger(EDITOR, da, fl || jsonb_build_object('bytes', BYTES + 1), pl, pv, null); perform pg_temp.as_db();
    res := res || ('I4 FAIL: a size Storage does not record was accepted')::text;
  exception when others then perform pg_temp.as_db(); res := res || ('I4 a size Storage does not record is refused (reads storage.objects metadata size): '||sqlstate||pg_temp.v(sqlstate = '23514' and sqlerrm like '%not in storage with that size%')); end;
  select count(*) into c1 from public.financial_sources where property_id = pa;
  res := res || ('I5a nothing written by the four refusals: '||c1||' sources'||pg_temp.v(c1 = 0));
  begin
    perform pg_temp.as_service(); j := public.import_general_ledger(EDITOR, da, fl, pl, pv, null); perform pg_temp.as_db();
    src := (j->>'source_id')::uuid;
    select count(*) into c1 from public.gl_entries where property_id = pa and source_id = src and posted_on = '2025-01-15';
    select count(*) into c2 from public.gl_entry_sources where source_id = src;
    select count(*) into c3 from public.ledger_import_history where source_id = src and action = 'import' and actor_uid = EDITOR and file_bytes = BYTES and file_sha256 = SHA;
    select count(*) into c4 from public.property_events where property_id = pa and action = 'ledger_imported';
    select import_status||'|'||coalesce(file_etag, 'null')||'|'||file_bytes||'|'||storage_path into t from public.financial_sources where id = src;
    res := res || ('I5 an editor imports through the server: inserted '||(j->>'inserted')||', lines '||c1||', links '||c2||', history '||c3||', events '||c4||'; source '
      ||left(t, 6)||' etag recorded='||(t like 'active|'||ETAG||'|'||BYTES||'|leases/'||OBJ)::text
      ||pg_temp.v((j->>'already_imported') = 'false' and (j->>'inserted') = '2' and c1 = 2 and c2 = 2 and c3 = 1 and c4 = 1 and t = 'active|'||ETAG||'|'||BYTES||'|leases/'||OBJ));
  exception when others then perform pg_temp.as_db(); res := res || ('I5 FAIL: the import was refused — '||sqlstate||' '||left(sqlerrm, 120)); end;
  begin
    perform pg_temp.as_service(); j := public.import_general_ledger(EDITOR, da, fl, pl, pv, null); perform pg_temp.as_db();
    select count(*) into c1 from public.financial_sources where property_id = pa;
    select count(*) into c2 from public.gl_entries where property_id = pa;
    res := res || ('I6 the same file again writes nothing: already_imported='||(j->>'already_imported')||', sources '||c1||', lines '||c2
      ||pg_temp.v((j->>'already_imported') = 'true' and (j->>'source_id')::uuid = src and c1 = 1 and c2 = 2));
  exception when others then perform pg_temp.as_db(); res := res || ('I6 FAIL: '||sqlstate||' '||left(sqlerrm, 100)); end;
  begin
    perform pg_temp.as_user(RO);   select count(*) into c1 from public.ledger_import_history where property_id = pa; select count(*) into c2 from public.gl_entry_sources where property_id = pa;
    perform pg_temp.as_user(OUTS); select count(*) into c3 from public.ledger_import_history where property_id = pa; select count(*) into c4 from public.gl_entry_sources where property_id = pa;
    perform pg_temp.as_db();
    res := res || ('I7 reads: read-only member sees history/links '||c1||'/'||c2||', stranger '||c3||'/'||c4||pg_temp.v(c1 = 1 and c2 = 2 and c3 = 0 and c4 = 0));
  exception when others then perform pg_temp.as_db(); res := res || ('I7 FAIL: '||sqlstate||' '||left(sqlerrm, 100)); end;
  begin
    perform pg_temp.as_anon(); select count(*) into c1 from public.ledger_import_history; perform pg_temp.as_db();
    res := res || ('I8 FAIL: anon read the import history ('||c1||' rows)');
  exception when others then perform pg_temp.as_db(); res := res || ('I8 anon read of the import history refused: '||sqlstate||pg_temp.v(sqlstate = '42501')); end;
  n := 0;
  begin perform pg_temp.as_service();
    insert into public.gl_entries(property_id, source_id, account_code, debit, row_hash) values (pa, src, '9999', 1, 'planted-046-matrix');
    perform pg_temp.as_db();
  exception when others then perform pg_temp.as_db(); if sqlstate = '42501' and src is not null then n := n + 1; end if; end;
  begin perform pg_temp.as_service(); delete from public.gl_entries where property_id = pa; perform pg_temp.as_db();
  exception when others then perform pg_temp.as_db(); if sqlstate = '42501' and src is not null then n := n + 1; end if; end;
  begin perform pg_temp.as_service(); update public.financial_sources set import_status = 'reversed', reversed_at = now(), reversed_by = U_OWNER, reversal_reason = 'x' where id = src; perform pg_temp.as_db();
  exception when others then perform pg_temp.as_db(); if sqlstate = '42501' and src is not null then n := n + 1; end if; end;
  begin update public.ledger_import_history set reason = 'edited' where property_id = pa;
  exception when others then if sqlstate = '42501' and src is not null then n := n + 1; end if; end;
  select count(*) into c1 from public.gl_entries where property_id = pa;
  res := res || ('I9 outside the functions, even service_role and the database owner are refused: add a line, delete a line, mark reversed, edit history '
    ||n||'/4; lines still '||c1||pg_temp.v(n = 4 and c1 = 2));

  -- ── S · the stored original is evidence: signed-in people cannot change or remove it
  begin
    res := res || ('S1 storage_object_is_acquisition_evidence: original '||public.storage_object_is_acquisition_evidence('leases', OBJ)::text
      ||', control '||public.storage_object_is_acquisition_evidence('leases', CTRL)::text
      ||pg_temp.v(public.storage_object_is_acquisition_evidence('leases', OBJ) and not public.storage_object_is_acquisition_evidence('leases', CTRL)));
  exception when others then res := res || ('S1 FAIL: '||sqlstate||' '||left(sqlerrm, 80)); end;
  perform pg_temp.as_user(U_OWNER);
  update storage.objects set metadata = metadata where bucket_id = 'leases' and name = OBJ;  get diagnostics c1 = row_count;
  update storage.objects set metadata = metadata where bucket_id = 'leases' and name = CTRL; get diagnostics c2 = row_count;
  perform pg_temp.as_db();
  res := res || ('S2 the owner overwrites in their own folder: the original '||c1||' row, an unreferenced control file '||c2||' row'||pg_temp.v(c1 = 0 and c2 = 1));
  perform pg_temp.as_user(U_OWNER);
  update storage.objects set name = U_OWNER::text||'/046-moved.csv' where bucket_id = 'leases' and name = OBJ; get diagnostics c1 = row_count;
  perform pg_temp.as_db();
  res := res || ('S3 the owner moves the original: '||c1||' rows'||pg_temp.v(c1 = 0));
  perform pg_temp.as_user(U_OWNER);
  perform set_config('storage.allow_delete_query', 'true', true);
  delete from storage.objects where bucket_id = 'leases' and name = OBJ;  get diagnostics c1 = row_count;
  delete from storage.objects where bucket_id = 'leases' and name = CTRL; get diagnostics c2 = row_count;
  perform set_config('storage.allow_delete_query', 'false', true);
  perform pg_temp.as_db();
  select count(*) into c3 from storage.objects where bucket_id = 'leases' and name = OBJ and (metadata->>'size')::bigint = BYTES;
  res := res || ('S4 the owner deletes (Storage''s own delete guard lifted for the statement): the original '||c1||' row, the control '||c2
    ||' row; the original still stored with its size: '||c3||pg_temp.v(c1 = 0 and c2 = 1 and c3 = 1));

  -- ── V · reversal: property admins only, with a reason; shared nothing, archived
  begin
    perform pg_temp.as_service(); j := public.reverse_general_ledger_import(EDITOR, src, 'editor tries'); perform pg_temp.as_db();
    res := res || ('V1 FAIL: an editor reversed an import')::text;
  exception when others then perform pg_temp.as_db(); res := res || ('V1 an editor (not admin) cannot reverse: '||sqlstate||pg_temp.v(sqlstate = '42501' and src is not null)); end;
  begin
    perform pg_temp.as_service(); j := public.reverse_general_ledger_import(U_OWNER, src, '   '); perform pg_temp.as_db();
    res := res || ('V2 FAIL: a reversal without a reason was accepted')::text;
  exception when others then perform pg_temp.as_db(); res := res || ('V2 a reversal needs a reason: '||sqlstate||pg_temp.v(sqlstate = '23514' and src is not null)); end;
  begin
    perform pg_temp.as_service(); j := public.reverse_general_ledger_import(U_OWNER, src, '046 live matrix: reversed by the owner'); perform pg_temp.as_db();
    select count(*) into c1 from public.gl_entries where property_id = pa;
    select count(*) into c2 from public.gl_entries_reversed where reversed_source = src;
    select count(*) into c3 from public.ledger_import_history where source_id = src and action = 'reverse' and actor_uid = U_OWNER;
    select import_status||'|'||(reversed_by = U_OWNER)::text into t from public.financial_sources where id = src;
    select count(*) into c4 from public.property_events where property_id = pa and action = 'ledger_import_reversed';
    res := res || ('V3 the owner reverses: removed '||(j->>'lines_removed')||', lines left '||c1||', archived '||c2||', history '||c3||', events '||c4||', source '||t
      ||pg_temp.v((j->>'lines_removed') = '2' and c1 = 0 and c2 = 2 and c3 = 1 and c4 = 1 and t = 'reversed|true'));
  exception when others then perform pg_temp.as_db(); res := res || ('V3 FAIL: '||sqlstate||' '||left(sqlerrm, 120)); end;
  begin
    perform pg_temp.as_service(); j := public.import_general_ledger(EDITOR, da, fl, pl, pv, null); perform pg_temp.as_db();
    src2 := (j->>'source_id')::uuid;
    select count(*) into c1 from public.gl_entries where property_id = pa and source_id = src2;
    res := res || ('V4 after the reversal the same file imports again as a new source: inserted '||(j->>'inserted')||', lines '||c1
      ||pg_temp.v((j->>'already_imported') = 'false' and src2 is distinct from src and c1 = 2));
  exception when others then perform pg_temp.as_db(); res := res || ('V4 FAIL: '||sqlstate||' '||left(sqlerrm, 120)); end;

  -- ── E · evidence integrity and the maintenance run ─────────────────────────
  begin
    perform pg_temp.as_service(); j := public.check_ledger_evidence_integrity(); perform pg_temp.as_db();
    res := res || ('E1 integrity check with the original as imported: checked '||(j->>'checked')||', flagged '||(j->>'flagged')
      ||pg_temp.v((j->>'checked')::int >= 2 and (j->>'flagged') = '0'));
  exception when others then perform pg_temp.as_db(); res := res || ('E1 FAIL: '||sqlstate||' '||left(sqlerrm, 100)); end;
  update storage.objects set metadata = jsonb_set(metadata, '{size}', to_jsonb(BYTES + 5)) where bucket_id = 'leases' and name = OBJ;
  begin
    perform pg_temp.as_service(); j := public.check_ledger_evidence_integrity(); perform pg_temp.as_db();
    select count(*) into c1 from public.ledger_import_history where property_id = pa and action = 'evidence_mismatch' and detail->>'problem' = 'size';
    res := res || ('E2 the stored original replaced with another size is put on the record: flagged '||(j->>'flagged')||', mismatch rows '||c1
      ||pg_temp.v((j->>'flagged') = '2' and c1 = 2));
  exception when others then perform pg_temp.as_db(); res := res || ('E2 FAIL: '||sqlstate||' '||left(sqlerrm, 100)); end;
  update storage.objects set metadata = jsonb_set(metadata, '{size}', to_jsonb(BYTES)) where bucket_id = 'leases' and name = OBJ;
  begin
    perform pg_temp.as_service(); j := public.run_ledger_maintenance(); perform pg_temp.as_db();
    select count(*) into c1 from public.ledger_maintenance_runs where id = (j->>'run_id')::uuid;
    res := res || ('E3 the maintenance run purges nothing young and is recorded: purged '||(j->>'purged')||', recorded '||c1
      ||pg_temp.v((j->>'purged') = '0' and c1 = 1));
  exception when others then perform pg_temp.as_db(); res := res || ('E3 FAIL: '||sqlstate||' '||left(sqlerrm, 100)); end;

  -- ── X · an imported document is kept; the whole prospect may go, its history stays
  begin
    perform pg_temp.as_user(U_OWNER); delete from public.acquisition_documents where id = da; get diagnostics n = row_count; perform pg_temp.as_db();
    res := res || ('X1 FAIL: the imported document was deleted on its own ('||n||' row)');
  exception when others then perform pg_temp.as_db(); res := res || ('X1 deleting the imported document on its own is refused: '||sqlstate||pg_temp.v(sqlstate = '23001')); end;
  begin
    select count(*) into c5 from public.ledger_import_history where property_id = pa;
    perform pg_temp.as_user(U_OWNER); perform public.delete_prospect_acquisition(ra); perform pg_temp.as_db();
    select count(*) into c1 from public.properties where id = pa;
    select count(*) into c2 from public.financial_sources where property_id = pa;
    select count(*) into c3 from public.gl_entries where property_id = pa;
    select count(*) into c4 from public.ledger_import_history where property_id = pa and action = 'evidence_removed';
    select count(*) into n from public.ledger_import_history where property_id = pa;
    res := res || ('X2 the owner deletes the prospect: property '||c1||', sources '||c2||', lines '||c3||'; history kept '||n||' (was '||c5||') incl. evidence_removed '||c4
      ||pg_temp.v(c1 = 0 and c2 = 0 and c3 = 0 and c4 = 2 and n = c5 + 2));
  exception when others then perform pg_temp.as_db(); res := res || ('X2 FAIL: '||sqlstate||' '||left(sqlerrm, 120)); end;

  -- ── RA · a real owner account, read-only: sees no ledger history but its own ─
  begin
    select count(*) into c1 from public.ledger_import_history h join public.properties p on p.id = h.property_id where p.user_id = REAL1;
    perform pg_temp.as_user(REAL1); select count(*) into c2 from public.ledger_import_history; perform pg_temp.as_db();
    res := res || ('RA1 the real owner account reads import history: visible '||c2||' vs its own '||c1||pg_temp.v(c1 = c2));
  exception when others then perform pg_temp.as_db(); res := res || ('RA1 FAIL: '||sqlstate||' '||left(sqlerrm, 80)); end;

  foreach ln in array res loop
    if ln like '%FAIL%' then fail_n := fail_n + 1; elsif ln like '% ok%' then ok_n := ok_n + 1; end if;
  end loop;
  raise exception using message = E'MATRIX RESULTS (everything rolled back)\n' || array_to_string(res, E'\n')
    || E'\nSUMMARY ' || ok_n || ' ok, ' || fail_n || ' FAIL', errcode = 'P0001';
end $m$;
