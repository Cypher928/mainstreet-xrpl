-- 047 live matrix on Pilot, run AFTER 047 is applied. ONE transaction that always
-- ends in RAISE EXCEPTION, so every fixture row, membership, stored-object row and
-- write below is rolled back. Results travel out in the exception message; the
-- last line counts them. Only the four mainstreet-test.local accounts are written
-- as; the one real account is used for read-only counts. Every write names a
-- fixture row by id; nothing here touches an existing row.
--
-- Storage: Pilot's storage.protect_objects_delete trigger refuses every direct
-- DELETE on storage.objects unless storage.allow_delete_query is 'true'. The
-- delete checks set it transaction-locally around their own statements, so the
-- row rules are what decide; Z1 proves the guard still refuses without it.
--
-- Run before 047 (or after its rollback) the same file reports FAIL lines: the
-- matrix is local-tested against both states (scratchpad phase6/live047).
do $m$
declare
  OWNER  uuid := '1c682d8e-0fcb-42c9-9d91-95b9524bb113';  -- test account, admin of its own org, no properties
  EDITOR uuid := '6833ee9f-754d-41aa-8214-85652b3ef0ee';  -- test account → property_manager in OWNER's org (fixture)
  RO     uuid := '871e3646-ea87-4312-b27b-469e0bc0a03d';  -- test account → read_only in OWNER's org (fixture)
  OUTS   uuid := 'a8048989-1a8f-4891-b5e2-d985f5000915';  -- test account → stranger, then revoked, then unaccepted, then accepted
  REAL1  uuid := '011df998-bad2-464e-bbcb-28e2d0fee821';  -- real owner account, READ-ONLY count checks
  MARKER uuid := 'fd9c09b1-b657-4c58-9999-c3cce28e7600';  -- the Pilot marker property (another organisation's)
  WRITE_RULE constant text := '((bucket_id = ANY (ARRAY[''leases''::text, ''invoices''::text])) AND storage_object_writable(name))';
  READ_RULE  constant text := '((bucket_id = ANY (ARRAY[''leases''::text, ''invoices''::text])) AND storage_object_accessible(name))';
  MEMBER_Q   constant text := '(property_id IN ( SELECT member_property_ids() AS member_property_ids))';
  ALLP       constant text := 'DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE';
  ORG uuid; j jsonb; res text[] := '{}'; ln text;
  pa uuid; ra uuid; p1 uuid; p2 uuid; ld uuid; ld2 uuid; ld3 uuid; ob uuid; n int; t text; u uuid; c1 int; c2 int; c3 int; c4 int; ok_n int := 0; fail_n int := 0;
  ORG_OBJ text; OWN_OBJ text;
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
  create function pg_temp.as_db() returns void language plpgsql as $f$
  begin
    perform set_config('role', 'none', true);
    perform set_config('request.jwt.claims', '', true);
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('storage.allow_delete_query', 'false', true);
  end $f$;
  create function pg_temp.v(cond boolean) returns text language sql as $f$ select case when cond then ' ok' else ' FAIL' end $f$;

  -- ── K · the catalog 047 leaves (read as the database owner) ────────────────
  select count(*) into c1 from pg_proc where oid = to_regprocedure('public.storage_object_writable(text)');
  if c1 = 1 then
    select prosecdef::text||'|'||provolatile::text||'|'||coalesce(array_to_string(proconfig, ','), '')||'|'||coalesce(proacl::text, '') into t
      from pg_proc where oid = 'public.storage_object_writable(text)'::regprocedure;
    res := res || ('K1 storage_object_writable: '||t||pg_temp.v(t like 'true|v|search_path=""|%' and t like '%authenticated=X/%' and t like '%service_role=X/%' and t not like '%anon=%' and t not like '%{=X/%' and t not like '%,=X/%'));
  else
    res := res || ('K1 storage_object_writable(text) is missing FAIL')::text;
  end if;
  select count(*) into c1 from pg_policies where schemaname = 'public' and tablename = 'lease_documents' and policyname = 'lease_docs_owner_all';
  res := res || ('K2 lease_docs_owner_all gone: '||c1||pg_temp.v(c1 = 0));
  select string_agg(policyname||'|'||cmd||'|'||permissive||'|'||array_to_string(roles, ',')||'|'||coalesce(qual, '')||'|'||coalesce(with_check, ''), E'\n' order by policyname) into t
    from pg_policies where schemaname = 'public' and tablename = 'lease_documents' and policyname like 'lease_docs_%' and policyname <> 'lease_docs_service_role_all';
  res := res || ('K3 the register''s four member rules exactly as 047 writes them'||pg_temp.v(t =
      'lease_docs_editor_delete|DELETE|PERMISSIVE|authenticated|can_edit_property(property_id)|'||E'\n'||
      'lease_docs_editor_insert|INSERT|PERMISSIVE|authenticated||can_edit_property(property_id)'||E'\n'||
      'lease_docs_editor_update|UPDATE|PERMISSIVE|authenticated|can_edit_property(property_id)|can_edit_property(property_id)'||E'\n'||
      'lease_docs_member_select|SELECT|PERMISSIVE|authenticated|'||MEMBER_Q||'|'));
  select count(*) into c1 from pg_policies where schemaname = 'public' and tablename = 'lease_documents' and policyname = 'lease_docs_service_role_all' and roles = '{service_role}' and qual = 'true' and with_check = 'true';
  res := res || ('K4 lease_docs_service_role_all kept: '||c1||pg_temp.v(c1 = 1));
  select string_agg(policyname||'|'||cmd||'|'||array_to_string(roles, ',')||'|'||coalesce(qual, '')||'|'||coalesce(with_check, ''), E'\n' order by policyname) into t
    from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname in ('docs_owner_insert', 'docs_owner_update', 'docs_owner_delete', 'docs_owner_read');
  res := res || ('K5 storage: the three write rules use storage_object_writable; docs_owner_read unchanged'||pg_temp.v(t =
      'docs_owner_delete|DELETE|authenticated|'||WRITE_RULE||'|'||E'\n'||
      'docs_owner_insert|INSERT|authenticated||'||WRITE_RULE||E'\n'||
      'docs_owner_read|SELECT|authenticated|'||READ_RULE||'|'||E'\n'||
      'docs_owner_update|UPDATE|authenticated|'||WRITE_RULE||'|'||WRITE_RULE));
  select string_agg(x, ' ; ' order by x) into t from (
    select table_name||':'||grantee||'='||string_agg(privilege_type, ',' order by privilege_type) as x
      from information_schema.role_table_grants
     where table_schema = 'public' and table_name in ('lease_documents', 'organization_members', 'organizations') and grantee in ('anon', 'authenticated', 'service_role')
     group by table_name, grantee) s;
  res := res || ('K6 grants: '||coalesce(t, '-')||pg_temp.v(t =
      'lease_documents:authenticated=DELETE,INSERT,SELECT,UPDATE ; lease_documents:service_role='||ALLP||
      ' ; organization_members:authenticated=SELECT ; organization_members:service_role='||ALLP||
      ' ; organizations:authenticated=SELECT ; organizations:service_role='||ALLP));
  select count(*) into c1 from pg_policies where schemaname = 'public' and policyname in ('organization_members_self_select', 'organization_members_org_select', 'organization_members_service_role_all', 'organizations_member_select', 'organizations_service_role_all');
  res := res || ('K7 the organisation tables'' five rules kept: '||c1||pg_temp.v(c1 = 5));

  -- ── fixtures (legitimate workflow: the owner begins an acquisition) ────────
  perform pg_temp.as_user(OWNER);
  j := public.begin_acquisition('047 live matrix deal', '{"totalSqFt":"1000"}'::jsonb); pa := (j->>'property_id')::uuid; ra := (j->>'review_id')::uuid;
  perform pg_temp.as_db();
  select organization_id into ORG from public.properties where id = pa;
  if ORG is null then raise exception 'fixture property has no organisation; matrix cannot run'; end if;
  insert into public.organization_members(organization_id, user_id, role, accepted_at) values (ORG, EDITOR, 'property_manager', now());
  insert into public.organization_members(organization_id, user_id, role, accepted_at) values (ORG, RO, 'read_only', now());
  -- a register row as api/lease-documents.js writes it (service key)
  perform pg_temp.as_service();
  insert into public.lease_documents(property_id, file_name) values (pa, '047-matrix-lease.pdf') returning id into ld;
  perform pg_temp.as_db();
  -- stored objects as api/upload.js stores them (service key): one in the organisation's folder, one in the owner's own
  ORG_OBJ := ORG::text||'/047-matrix-shared.pdf'; OWN_OBJ := OWNER::text||'/047-matrix-own.pdf';
  insert into storage.objects(bucket_id, name, owner, metadata) values ('leases', ORG_OBJ, OWNER, '{"size":10}'::jsonb), ('leases', OWN_OBJ, OWNER, '{"size":10}'::jsonb);
  res := res || ('FX property '||left(pa::text, 8)||' org '||left(ORG::text, 8)||'; editor and read-only members added; register row '||left(ld::text, 8)||'; two stored objects')::text;

  -- ── L · the lease document register: members read, editors write ───────────
  perform pg_temp.as_user(OWNER);  select count(*) into c1 from public.lease_documents where id = ld; perform pg_temp.as_db();
  perform pg_temp.as_user(EDITOR); select count(*) into c2 from public.lease_documents where id = ld; perform pg_temp.as_db();
  perform pg_temp.as_user(RO);     select count(*) into c3 from public.lease_documents where id = ld; perform pg_temp.as_db();
  perform pg_temp.as_user(OUTS);   select count(*) into c4 from public.lease_documents where id = ld; perform pg_temp.as_db();
  res := res || ('L1 owner/editor/read-only/stranger read the register row: '||c1||'/'||c2||'/'||c3||'/'||c4||pg_temp.v(c1 = 1 and c2 = 1 and c3 = 1 and c4 = 0));
  begin
    perform pg_temp.as_user(RO); insert into public.lease_documents(property_id, file_name) values (pa, '047-ro.pdf');
    res := res || ('L2 FAIL: read-only member added a register row')::text;
  exception when others then res := res || ('L2 read-only member add refused: '||sqlstate||pg_temp.v(sqlstate = '42501')); end;
  perform pg_temp.as_db();
  perform pg_temp.as_user(RO); update public.lease_documents set file_name = '047-renamed.pdf', tenant_name = 'x' where id = ld; get diagnostics n = row_count; perform pg_temp.as_db();
  res := res || ('L3 read-only member renames/re-points the row: '||n||' rows'||pg_temp.v(n = 0));
  perform pg_temp.as_user(RO); delete from public.lease_documents where id = ld; get diagnostics n = row_count; perform pg_temp.as_db();
  res := res || ('L4 read-only member deletes the row: '||n||' rows'||pg_temp.v(n = 0));
  begin
    perform pg_temp.as_user(OUTS); insert into public.lease_documents(property_id, file_name) values (pa, '047-outs.pdf');
    res := res || ('L5 FAIL: stranger added a register row')::text;
  exception when others then res := res || ('L5 stranger add refused: '||sqlstate||pg_temp.v(sqlstate = '42501')); end;
  perform pg_temp.as_db();
  begin
    perform set_config('role', 'anon', true); select count(*) into c1 from public.lease_documents;
    res := res || ('L6 FAIL: anon read the register ('||c1||' rows)');
  exception when others then res := res || ('L6 anon read refused: '||sqlstate||pg_temp.v(sqlstate = '42501')); end;
  perform pg_temp.as_db();
  begin
    perform set_config('role', 'anon', true); insert into public.lease_documents(property_id, file_name) values (pa, '047-anon.pdf');
    res := res || ('L7 FAIL: anon added a register row')::text;
  exception when others then res := res || ('L7 anon add refused: '||sqlstate||pg_temp.v(sqlstate = '42501')); end;
  perform pg_temp.as_db();
  begin
    perform pg_temp.as_user(OWNER); truncate public.lease_documents;
    res := res || ('L8 FAIL: a signed-in person truncated the register')::text;
  exception when others then res := res || ('L8 TRUNCATE by a signed-in person refused: '||sqlstate||pg_temp.v(sqlstate = '42501')); end;
  perform pg_temp.as_db();
  select file_name||'|'||coalesce(tenant_name, '') into t from public.lease_documents where id = ld;
  res := res || ('L9 the row after the refused writes: '||coalesce(t, 'GONE')||pg_temp.v(t = '047-matrix-lease.pdf|'));
  begin
    perform pg_temp.as_user(EDITOR);
    insert into public.lease_documents(property_id, file_name) values (pa, '047-editor.pdf') returning id into ld2;
    update public.lease_documents set tenant_name = 'Editor saw it' where id = ld2; get diagnostics c1 = row_count;
    delete from public.lease_documents where id = ld2; get diagnostics c2 = row_count;
    perform pg_temp.as_db();
    res := res || ('L10 editor adds, edits, deletes a register row: 1/'||c1||'/'||c2||pg_temp.v(c1 = 1 and c2 = 1));
  exception when others then perform pg_temp.as_db(); res := res || ('L10 FAIL: editor write refused — '||sqlstate||' '||left(sqlerrm, 90)); end;
  begin
    perform pg_temp.as_user(OWNER);
    insert into public.lease_documents(property_id, file_name) values (pa, '047-owner.pdf') returning id into ld2;
    update public.lease_documents set tenant_name = 'Owner saw it' where id = ld2; get diagnostics c1 = row_count;
    delete from public.lease_documents where id = ld2; get diagnostics c2 = row_count;
    perform pg_temp.as_db();
    res := res || ('L11 owner adds, edits, deletes a register row: 1/'||c1||'/'||c2||pg_temp.v(c1 = 1 and c2 = 1));
  exception when others then perform pg_temp.as_db(); res := res || ('L11 FAIL: owner write refused — '||sqlstate||' '||left(sqlerrm, 90)); end;
  begin
    perform pg_temp.as_user(EDITOR); insert into public.lease_documents(property_id, file_name) values (MARKER, '047-elsewhere.pdf');
    res := res || ('L12 FAIL: editor filed a register row on another organisation''s property')::text;
  exception when others then res := res || ('L12 editor filing on another organisation''s property refused: '||sqlstate||pg_temp.v(sqlstate = '42501')); end;
  perform pg_temp.as_db();
  begin
    perform pg_temp.as_service();
    insert into public.lease_documents(property_id, file_name) values (pa, '047-server.pdf') returning id into ld3;
    update public.lease_documents set parsing_status = parsing_status where id = ld3; get diagnostics c1 = row_count;
    select count(*) into c2 from public.lease_documents where id = ld3;
    delete from public.lease_documents where id = ld3; get diagnostics c3 = row_count;
    perform pg_temp.as_db();
    res := res || ('L13 the server (service_role) reads, adds, edits, deletes as before: '||c2||'/'||c1||'/'||c3||pg_temp.v(c1 = 1 and c2 = 1 and c3 = 1));
  exception when others then perform pg_temp.as_db(); res := res || ('L13 FAIL: service_role refused — '||sqlstate||' '||left(sqlerrm, 90)); end;

  -- ── S · storage: read-only members open the organisation's files, do not write its folder
  perform pg_temp.as_user(RO); select count(*) into c1 from storage.objects where name = ORG_OBJ; perform pg_temp.as_db();
  res := res || ('S1 read-only member opens the organisation''s file: '||c1||pg_temp.v(c1 = 1));
  begin
    perform pg_temp.as_user(RO); insert into storage.objects(bucket_id, name, owner) values ('leases', ORG::text||'/047-ro-planted.pdf', RO);
    res := res || ('S2 FAIL: read-only member put a file in the organisation''s folder')::text;
  exception when others then res := res || ('S2 read-only member put refused: '||sqlstate||pg_temp.v(sqlstate = '42501')); end;
  perform pg_temp.as_db();
  perform pg_temp.as_user(RO); update storage.objects set metadata = '{"size":1}'::jsonb where name = ORG_OBJ; get diagnostics c1 = row_count;
  update storage.objects set name = ORG::text||'/047-moved.pdf' where name = ORG_OBJ; get diagnostics c2 = row_count;
  perform set_config('storage.allow_delete_query', 'true', true);
  delete from storage.objects where name = ORG_OBJ; get diagnostics c3 = row_count;
  delete from storage.objects where name = OWN_OBJ; get diagnostics c4 = row_count;
  perform pg_temp.as_db();
  select count(*) into n from storage.objects where name in (ORG_OBJ, OWN_OBJ) and metadata->>'size' = '10';
  res := res || ('S3 read-only member overwrites/moves/deletes the organisation''s file, deletes the owner''s: '||c1||'/'||c2||'/'||c3||'/'||c4||' rows; both intact='||(n = 2)||pg_temp.v(c1 = 0 and c2 = 0 and c3 = 0 and c4 = 0 and n = 2));
  begin
    perform pg_temp.as_user(RO);
    insert into storage.objects(bucket_id, name, owner) values ('leases', RO::text||'/047-ro-own.pdf', RO);
    update storage.objects set metadata = '{"size":2}'::jsonb where name = RO::text||'/047-ro-own.pdf'; get diagnostics c1 = row_count;
    perform set_config('storage.allow_delete_query', 'true', true);
    delete from storage.objects where name = RO::text||'/047-ro-own.pdf'; get diagnostics c2 = row_count;
    perform pg_temp.as_db();
    res := res || ('S4 read-only member''s own folder stays theirs (put/overwrite/delete): 1/'||c1||'/'||c2||pg_temp.v(c1 = 1 and c2 = 1));
  exception when others then perform pg_temp.as_db(); res := res || ('S4 FAIL: read-only member refused in their own folder — '||sqlstate||' '||left(sqlerrm, 90)); end;
  begin
    perform pg_temp.as_user(EDITOR);
    insert into storage.objects(bucket_id, name, owner) values ('leases', ORG::text||'/047-editor.pdf', EDITOR);
    update storage.objects set metadata = '{"size":3}'::jsonb where name = ORG::text||'/047-editor.pdf'; get diagnostics c1 = row_count;
    perform set_config('storage.allow_delete_query', 'true', true);
    delete from storage.objects where name = ORG::text||'/047-editor.pdf'; get diagnostics c2 = row_count;
    perform pg_temp.as_db();
    res := res || ('S5 editor puts/overwrites/deletes in the organisation''s folder: 1/'||c1||'/'||c2||pg_temp.v(c1 = 1 and c2 = 1));
  exception when others then perform pg_temp.as_db(); res := res || ('S5 FAIL: editor refused in the organisation''s folder — '||sqlstate||' '||left(sqlerrm, 90)); end;
  begin
    perform pg_temp.as_user(OWNER);
    insert into storage.objects(bucket_id, name, owner) values ('invoices', ORG::text||'/047-owner.pdf', OWNER);
    perform set_config('storage.allow_delete_query', 'true', true);
    delete from storage.objects where name = ORG::text||'/047-owner.pdf'; get diagnostics c1 = row_count;
    perform pg_temp.as_db();
    res := res || ('S6 owner (admin) puts/deletes in the organisation''s folder: 1/'||c1||pg_temp.v(c1 = 1));
  exception when others then perform pg_temp.as_db(); res := res || ('S6 FAIL: owner refused in the organisation''s folder — '||sqlstate||' '||left(sqlerrm, 90)); end;
  begin
    perform pg_temp.as_user(OUTS); insert into storage.objects(bucket_id, name, owner) values ('leases', ORG::text||'/047-outs.pdf', OUTS);
    res := res || ('S7 FAIL: stranger put a file in the organisation''s folder')::text;
  exception when others then res := res || ('S7 stranger put refused: '||sqlstate||pg_temp.v(sqlstate = '42501')); end;
  perform pg_temp.as_db();
  perform pg_temp.as_user(OUTS); select count(*) into c1 from storage.objects where name = ORG_OBJ; perform pg_temp.as_db();
  res := res || ('S8 stranger opens the organisation''s file: '||c1||pg_temp.v(c1 = 0));

  -- ── V · revoked and unaccepted memberships write nothing; accepted editors do
  insert into public.organization_members(organization_id, user_id, role, accepted_at, revoked_at) values (ORG, OUTS, 'property_manager', now(), now());
  begin
    perform pg_temp.as_user(OUTS); insert into public.lease_documents(property_id, file_name) values (pa, '047-revoked.pdf');
    res := res || ('V1 FAIL: revoked member added a register row')::text;
  exception when others then res := res || ('V1 revoked member add refused: '||sqlstate||pg_temp.v(sqlstate = '42501')); end;
  perform pg_temp.as_db();
  begin
    perform pg_temp.as_user(OUTS); insert into storage.objects(bucket_id, name, owner) values ('leases', ORG::text||'/047-revoked.pdf', OUTS);
    res := res || ('V2 FAIL: revoked member put a file in the organisation''s folder')::text;
  exception when others then res := res || ('V2 revoked member put refused: '||sqlstate||pg_temp.v(sqlstate = '42501')); end;
  perform pg_temp.as_db();
  update public.organization_members set accepted_at = null, revoked_at = null where organization_id = ORG and user_id = OUTS;
  begin
    perform pg_temp.as_user(OUTS); insert into public.lease_documents(property_id, file_name) values (pa, '047-unaccepted.pdf');
    res := res || ('V3 FAIL: unaccepted member added a register row')::text;
  exception when others then res := res || ('V3 unaccepted member add refused: '||sqlstate||pg_temp.v(sqlstate = '42501')); end;
  perform pg_temp.as_db();
  begin
    perform pg_temp.as_user(OUTS); insert into storage.objects(bucket_id, name, owner) values ('leases', ORG::text||'/047-unaccepted.pdf', OUTS);
    res := res || ('V4 FAIL: unaccepted member put a file in the organisation''s folder')::text;
  exception when others then res := res || ('V4 unaccepted member put refused: '||sqlstate||pg_temp.v(sqlstate = '42501')); end;
  perform pg_temp.as_db();
  update public.organization_members set accepted_at = now() where organization_id = ORG and user_id = OUTS;
  begin
    perform pg_temp.as_user(OUTS);
    insert into public.lease_documents(property_id, file_name) values (pa, '047-accepted.pdf');
    insert into storage.objects(bucket_id, name, owner) values ('leases', ORG::text||'/047-accepted.pdf', OUTS);
    perform pg_temp.as_db();
    res := res || ('V5 the same account, once accepted as property_manager, writes both: ok (membership is what gates)')::text;
  exception when others then perform pg_temp.as_db(); res := res || ('V5 FAIL: accepted editor refused — '||sqlstate||' '||left(sqlerrm, 90)); end;

  -- ── G · the organisation tables: members read, nobody writes through the API
  perform pg_temp.as_user(RO);
  select count(*) into c1 from public.organization_members where user_id = RO and organization_id = ORG;
  select count(*) into c2 from public.organizations where id = ORG;
  perform pg_temp.as_db();
  res := res || ('G1 read-only member reads their membership and organisation: '||c1||'/'||c2||pg_temp.v(c1 = 1 and c2 = 1));
  begin
    perform pg_temp.as_user(RO); update public.organization_members set role = 'admin' where user_id = RO and organization_id = ORG;
    res := res || ('G2 FAIL: read-only member''s self-promotion was not refused outright')::text;
  exception when others then res := res || ('G2 read-only member self-promotion refused: '||sqlstate||pg_temp.v(sqlstate = '42501')); end;
  perform pg_temp.as_db();
  begin
    perform pg_temp.as_user(RO); insert into public.organization_members(organization_id, user_id, role) values (ORG, OUTS, 'admin');
    res := res || ('G3 FAIL: read-only member added a member')::text;
  exception when others then res := res || ('G3 read-only member adding a member refused: '||sqlstate||pg_temp.v(sqlstate = '42501')); end;
  perform pg_temp.as_db();
  begin
    perform pg_temp.as_user(OWNER); delete from public.organization_members where user_id = RO and organization_id = ORG;
    res := res || ('G4 FAIL: owner removed a member through the API')::text;
  exception when others then res := res || ('G4 owner removing a member through the API refused (the server writes membership): '||sqlstate||pg_temp.v(sqlstate = '42501')); end;
  perform pg_temp.as_db();
  begin
    perform pg_temp.as_user(OWNER); update public.organizations set name = name where id = ORG;
    res := res || ('G5 FAIL: owner updated the organisation through the API')::text;
  exception when others then res := res || ('G5 owner updating the organisation through the API refused: '||sqlstate||pg_temp.v(sqlstate = '42501')); end;
  perform pg_temp.as_db();
  begin
    perform set_config('role', 'anon', true); select count(*) into c1 from public.organization_members;
    res := res || ('G6 FAIL: anon read organization_members ('||c1||' rows)');
  exception when others then res := res || ('G6 anon read of organization_members refused: '||sqlstate||pg_temp.v(sqlstate = '42501')); end;
  perform pg_temp.as_db();
  begin
    perform set_config('role', 'anon', true); select count(*) into c1 from public.organizations;
    res := res || ('G7 FAIL: anon read organizations ('||c1||' rows)');
  exception when others then res := res || ('G7 anon read of organizations refused: '||sqlstate||pg_temp.v(sqlstate = '42501')); end;
  perform pg_temp.as_db();
  select count(*) into c1 from public.organization_members where user_id = RO and organization_id = ORG and role = 'read_only';
  res := res || ('G8 the membership after the refused writes: read_only rows '||c1||pg_temp.v(c1 = 1));

  -- ── W · the workflows around them ──────────────────────────────────────────
  begin
    perform pg_temp.as_user(OUTS); insert into public.properties(user_id, name) values (OUTS, '047 live matrix own property') returning id into p1; perform pg_temp.as_db();
    select organization_id into u from public.properties where id = p1;
    res := res || ('W1 a signed-in person creates a property; the organisation is assigned by the SECURITY DEFINER trigger: org set='||(u is not null)||pg_temp.v(u is not null));
  exception when others then perform pg_temp.as_db(); res := res || ('W1 FAIL: property creation refused — '||sqlstate||' '||left(sqlerrm, 90)); end;
  begin
    perform pg_temp.as_user(OWNER); insert into public.properties(user_id, name) values (OWNER, '047 live matrix doomed property') returning id into p2; perform pg_temp.as_db();
    perform pg_temp.as_service(); insert into public.lease_documents(property_id, file_name) values (p2, '047-doomed.pdf'); perform pg_temp.as_db();
    perform pg_temp.as_user(OWNER); delete from public.properties where id = p2; get diagnostics c1 = row_count; perform pg_temp.as_db();
    select count(*) into c2 from public.lease_documents where property_id = p2;
    res := res || ('W2 owner deletes a property; its register rows cascade away: deleted '||c1||', register rows left '||c2||pg_temp.v(c1 = 1 and c2 = 0));
  exception when others then perform pg_temp.as_db(); res := res || ('W2 FAIL: '||sqlstate||' '||left(sqlerrm, 120)); end;
  begin
    perform pg_temp.as_user(EDITOR); update public.properties set name = name where id = pa; get diagnostics c1 = row_count; perform pg_temp.as_db();
    perform pg_temp.as_user(RO); select count(*) into c2 from public.acquisition_reviews where id = ra; perform pg_temp.as_db();
    res := res || ('W3 editor still saves the property (045), read-only member still reads the review: '||c1||'/'||c2||pg_temp.v(c1 = 1 and c2 = 1));
  exception when others then perform pg_temp.as_db(); res := res || ('W3 FAIL: '||sqlstate||' '||left(sqlerrm, 120)); end;

  -- ── Z · the storage delete guard is still there ─────────────────────────────
  begin
    perform pg_temp.as_user(EDITOR); delete from storage.objects where name = ORG_OBJ;
    res := res || ('Z1 FAIL: a direct delete ran without storage.allow_delete_query')::text;
  exception when others then res := res || ('Z1 storage.protect_delete still refuses a direct delete: '||sqlstate||pg_temp.v(sqlstate = '42501' and sqlerrm like 'Direct deletion%')); end;
  perform pg_temp.as_db();

  -- ── RA · a real owner account, read-only: still reads exactly what the rules allow
  select count(*) into c1 from public.lease_documents d where d.property_id in (
    select p.id from public.properties p where p.user_id = REAL1
        or (p.organization_id is not null and exists (select 1 from public.organization_members m where m.organization_id = p.organization_id and m.user_id = REAL1 and m.accepted_at is not null and m.revoked_at is null)));
  select count(*) into c2 from storage.objects o where o.bucket_id in ('leases', 'invoices') and (
    (storage.foldername(o.name))[1] = REAL1::text
    or exists (select 1 from public.organization_members m where m.user_id = REAL1 and m.accepted_at is not null and m.revoked_at is null and m.organization_id::text = (storage.foldername(o.name))[1]));
  perform pg_temp.as_user(REAL1); select count(*) into c3 from public.lease_documents; select count(*) into c4 from storage.objects; perform pg_temp.as_db();
  res := res || ('RA1 real owner account reads register rows/stored files: visible '||c3||'/'||c4||' vs allowed '||c1||'/'||c2||pg_temp.v(c1 = c3 and c2 = c4));

  foreach ln in array res loop
    if ln like '%FAIL%' then fail_n := fail_n + 1; elsif ln like '% ok%' then ok_n := ok_n + 1; end if;
  end loop;
  raise exception using message = E'MATRIX RESULTS (everything rolled back)\n' || array_to_string(res, E'\n')
    || E'\nSUMMARY ' || ok_n || ' ok, ' || fail_n || ' FAIL', errcode = 'P0001';
end $m$;
