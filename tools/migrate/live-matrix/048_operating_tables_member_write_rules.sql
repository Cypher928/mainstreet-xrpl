-- 048 live matrix on Pilot, run AFTER 048 is applied. ONE transaction that always
-- ends in RAISE EXCEPTION, so every fixture row, membership and write below is
-- rolled back. Results travel out in the exception message; the last line counts
-- them. Only the four mainstreet-test.local accounts are written as; the one real
-- account is used for read-only counts. Every write names a fixture row by id or
-- by the fixture property; nothing here touches an existing row.
--
-- No storage; no DDL beyond the session-local pg_temp helpers, which die with the
-- session. The one TRUNCATE attempt is on tenants, which other tables
-- reference by foreign key, so it cannot succeed under any grant; the TRUNCATE
-- grant on the other seven tables is checked from the catalog (K5), not by trying.
--
-- Run before 048 (or after its rollback) the same file reports FAIL lines: the
-- matrix is local-tested against both states (scratchpad phase6/live048).
do $m$
declare
  OWNER  uuid := '1c682d8e-0fcb-42c9-9d91-95b9524bb113';  -- test account, admin of its own org, no properties
  EDITOR uuid := '6833ee9f-754d-41aa-8214-85652b3ef0ee';  -- test account → property_manager in OWNER's org (fixture)
  RO     uuid := '871e3646-ea87-4312-b27b-469e0bc0a03d';  -- test account → read_only in OWNER's org (fixture)
  OUTS   uuid := 'a8048989-1a8f-4891-b5e2-d985f5000915';  -- test account → stranger, tenant user, revoked, unaccepted, accepted
  REAL1  uuid := '011df998-bad2-464e-bbcb-28e2d0fee821';  -- real owner account, READ-ONLY count checks
  MARKER uuid := 'fd9c09b1-b657-4c58-9999-c3cce28e7600';  -- the Pilot marker property (another organisation's)
  MEMBER_Q constant text := '(property_id IN ( SELECT member_property_ids() AS member_property_ids))';
  EDIT_Q   constant text := 'can_edit_property(property_id)';
  ADMIN_Q  constant text := 'is_property_admin(property_id)';
  ALLP     constant text := 'DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE';
  ORG uuid; res text[] := '{}'; ln text;
  P uuid; T1 uuid; T2 uuid; PX uuid; j uuid; n int; t text; c1 int; c2 int; c3 int; c4 int; c5 int; ok_n int := 0; fail_n int := 0;
  JOB uuid := 'aaaaaaaa-0000-4000-8000-0000000048aa';
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
  end $f$;
  create function pg_temp.v(cond boolean) returns text language sql as $f$ select case when cond then ' ok' else ' FAIL' end $f$;

  -- ── K · the catalog 048 leaves (read as the database owner) ────────────────
  select count(*) into c1 from pg_policies where schemaname = 'public' and policyname in
    ('tenants_owner_all', 'lease_jobs_owner_all', 'tfe_owner_all', 'tra_owner_all', 'cam_recon_owner_all', 'tenant_users_landlord_all', 'tenant_invitations_landlord_all', 'tenant_statements_landlord_all');
  res := res || ('K1 the eight 024 FOR ALL member rules gone: '||c1||pg_temp.v(c1 = 0));
  select string_agg(tablename||'|'||policyname||'|'||cmd||'|'||array_to_string(roles, ',')||'|'||coalesce(qual, '')||'|'||coalesce(with_check, ''), E'\n' order by tablename, policyname) into t
    from pg_policies where schemaname = 'public' and policyname in (
      'tenants_member_select', 'tenants_editor_insert', 'tenants_editor_update', 'tenants_editor_delete',
      'lease_jobs_member_select', 'lease_jobs_editor_insert', 'lease_jobs_editor_update', 'lease_jobs_editor_delete',
      'tfe_member_select', 'tfe_editor_insert', 'tra_member_select', 'tra_editor_insert',
      'cam_recon_member_select', 'cam_recon_editor_insert', 'cam_recon_editor_update', 'cam_recon_editor_delete',
      'tenant_users_landlord_select', 'tenant_invitations_admin_all',
      'tenant_statements_member_select', 'tenant_statements_editor_insert', 'tenant_statements_editor_update', 'tenant_statements_editor_delete');
  res := res || ('K2 the 22 rules exactly as 048 writes them'||pg_temp.v(t =
      'cam_reconciliations|cam_recon_editor_delete|DELETE|authenticated|'||EDIT_Q||'|'||E'\n'||
      'cam_reconciliations|cam_recon_editor_insert|INSERT|authenticated||'||EDIT_Q||E'\n'||
      'cam_reconciliations|cam_recon_editor_update|UPDATE|authenticated|'||EDIT_Q||'|'||EDIT_Q||E'\n'||
      'cam_reconciliations|cam_recon_member_select|SELECT|authenticated|'||MEMBER_Q||'|'||E'\n'||
      'lease_jobs|lease_jobs_editor_delete|DELETE|authenticated|'||EDIT_Q||'|'||E'\n'||
      'lease_jobs|lease_jobs_editor_insert|INSERT|authenticated||'||EDIT_Q||E'\n'||
      'lease_jobs|lease_jobs_editor_update|UPDATE|authenticated|'||EDIT_Q||'|'||EDIT_Q||E'\n'||
      'lease_jobs|lease_jobs_member_select|SELECT|authenticated|'||MEMBER_Q||'|'||E'\n'||
      'tenant_field_evidence|tfe_editor_insert|INSERT|authenticated||'||EDIT_Q||E'\n'||
      'tenant_field_evidence|tfe_member_select|SELECT|authenticated|'||MEMBER_Q||'|'||E'\n'||
      'tenant_invitations|tenant_invitations_admin_all|ALL|authenticated|'||ADMIN_Q||'|'||ADMIN_Q||E'\n'||
      'tenant_review_audit|tra_editor_insert|INSERT|authenticated||'||EDIT_Q||E'\n'||
      'tenant_review_audit|tra_member_select|SELECT|authenticated|'||MEMBER_Q||'|'||E'\n'||
      'tenant_statements|tenant_statements_editor_delete|DELETE|authenticated|'||EDIT_Q||'|'||E'\n'||
      'tenant_statements|tenant_statements_editor_insert|INSERT|authenticated||'||EDIT_Q||E'\n'||
      'tenant_statements|tenant_statements_editor_update|UPDATE|authenticated|'||EDIT_Q||'|'||EDIT_Q||E'\n'||
      'tenant_statements|tenant_statements_member_select|SELECT|authenticated|'||MEMBER_Q||'|'||E'\n'||
      'tenant_users|tenant_users_landlord_select|SELECT|authenticated|'||MEMBER_Q||'|'||E'\n'||
      'tenants|tenants_editor_delete|DELETE|authenticated|'||EDIT_Q||'|'||E'\n'||
      'tenants|tenants_editor_insert|INSERT|authenticated||'||EDIT_Q||E'\n'||
      'tenants|tenants_editor_update|UPDATE|authenticated|'||EDIT_Q||'|'||EDIT_Q||E'\n'||
      'tenants|tenants_member_select|SELECT|authenticated|'||MEMBER_Q||'|'));
  select count(*) into c1 from pg_policies where schemaname = 'public' and roles = '{service_role}' and qual = 'true' and with_check = 'true' and policyname in
    ('tenants_service_role_all', 'lease_jobs_service_role_all', 'tfe_service_role_all', 'tra_service_role_all', 'cam_recon_service_role_all', 'tenant_users_service_role_all', 'tenant_invitations_service_role_all', 'tenant_statements_service_role_all');
  res := res || ('K3 the eight service-role rules kept: '||c1||pg_temp.v(c1 = 8));
  select count(*) into c1 from pg_policies where schemaname = 'public' and policyname in ('tenants_tenant_self_select', 'tenant_users_self_select', 'tenant_statements_tenant_select');
  res := res || ('K4 the three tenant-side read rules kept: '||c1||pg_temp.v(c1 = 3));
  select string_agg(x, ' ; ' order by x) into t from (
    select table_name||':'||grantee||'='||string_agg(privilege_type, ',' order by privilege_type) as x
      from information_schema.role_table_grants
     where table_schema = 'public' and table_name in ('tenants', 'lease_jobs', 'tenant_field_evidence', 'tenant_review_audit', 'cam_reconciliations', 'tenant_users', 'tenant_invitations', 'tenant_statements')
       and grantee in ('anon', 'authenticated', 'service_role')
     group by table_name, grantee) s;
  res := res || ('K5 grants: '||coalesce(t, '-')||pg_temp.v(t =
      'cam_reconciliations:authenticated=DELETE,INSERT,SELECT,UPDATE ; cam_reconciliations:service_role='||ALLP||
      ' ; lease_jobs:authenticated=DELETE,INSERT,SELECT,UPDATE ; lease_jobs:service_role='||ALLP||
      ' ; tenant_field_evidence:authenticated=INSERT,SELECT ; tenant_field_evidence:service_role='||ALLP||
      ' ; tenant_invitations:service_role=SELECT,UPDATE'||
      ' ; tenant_review_audit:authenticated=INSERT,SELECT ; tenant_review_audit:service_role='||ALLP||
      ' ; tenant_statements:authenticated=SELECT ; tenant_statements:service_role=INSERT,SELECT,UPDATE'||
      ' ; tenant_users:authenticated=SELECT ; tenant_users:service_role=DELETE,INSERT,SELECT,UPDATE'||
      ' ; tenants:authenticated=DELETE,INSERT,SELECT,UPDATE ; tenants:service_role='||ALLP));
  select count(*) into c1 from pg_trigger where tgrelid = 'public.tenants'::regclass and not tgisinternal and tgname in ('tenants_delete_guard', 'tenants_lifecycle_guard', 'tenants_tombstone_guard', 'tenants_property_immutable', 'tenants_absorbed_freeze');
  res := res || ('K6 038''s five leasehold guards still on tenants: '||c1||pg_temp.v(c1 = 5));

  -- ── fixtures (as the owner, the way the app writes them) ───────────────────
  perform pg_temp.as_user(OWNER);
  insert into public.properties(user_id, name) values (OWNER, '048 live matrix property') returning id into P;
  insert into public.tenants(property_id, name, sqft) values (P, '048 Tenant One', 1000) returning id into T1;
  insert into public.tenants(property_id, name, sqft) values (P, '048 Tenant Two', 500) returning id into T2;
  perform pg_temp.as_db();
  select organization_id into ORG from public.properties where id = P;
  if ORG is null then raise exception 'fixture property has no organisation; matrix cannot run'; end if;
  insert into public.organization_members(organization_id, user_id, role, accepted_at) values (ORG, EDITOR, 'property_manager', now());
  insert into public.organization_members(organization_id, user_id, role, accepted_at) values (ORG, RO, 'read_only', now());
  -- rows on the other six tables, as the server and the pipeline leave them
  insert into public.lease_jobs(id, property_id, tenant_id, file_name) values (JOB, P, T1, '048-lease-one.pdf');
  insert into public.tenant_field_evidence(property_id, tenant_id, field_key, reviewed_at, value) values (P, T1::text, 'base_rent', '2025-01-01', '1000');
  insert into public.tenant_review_audit(property_id, tenant_id, action, client_ts) values (P, T1::text, 'approved', '2025-01-01');
  insert into public.cam_reconciliations(property_id, tenant_id, year, actual_cam) values (P, T1, 2025, 100);
  insert into public.tenant_users(user_id, tenant_id, property_id, accepted_at) values (OUTS, T1, P, now());
  insert into public.tenant_invitations(tenant_id, property_id, email, token_hash, invited_by) values (T2, P, '048-two@mainstreet-test.local', repeat('ab', 32), OWNER);
  insert into public.tenant_statements(tenant_id, property_id, cam_year, version, allocated_amount, pro_rata_percent, total_pool, statement_json, status, published_at)
    values (T1, P, 2025, 1, 0, 0, 0, '{}'::jsonb, 'published', now()), (T2, P, 2025, 1, 0, 0, 0, '{}'::jsonb, 'draft', null);
  res := res || ('FX property '||left(P::text, 8)||' org '||left(ORG::text, 8)||'; leaseholds '||left(T1::text, 8)||' '||left(T2::text, 8)||'; editor, read-only member and a tenant user added; one row on each of the other six tables')::text;

  -- ── L · leaseholds (tenants) ───────────────────────────────────────────────
  perform pg_temp.as_user(OWNER);  select count(*) into c1 from public.tenants where property_id = P; perform pg_temp.as_db();
  perform pg_temp.as_user(EDITOR); select count(*) into c2 from public.tenants where property_id = P; perform pg_temp.as_db();
  perform pg_temp.as_user(RO);     select count(*) into c3 from public.tenants where property_id = P; perform pg_temp.as_db();
  perform pg_temp.as_user(OUTS);   select count(*) into c4 from public.tenants where property_id = P; perform pg_temp.as_db();
  res := res || ('L1 owner/editor/read-only/tenant-user read the leaseholds: '||c1||'/'||c2||'/'||c3||'/'||c4||pg_temp.v(c1 = 2 and c2 = 2 and c3 = 2 and c4 = 1));
  perform pg_temp.as_user(RO); update public.tenants set name = 'renamed by read-only' where id = T2; get diagnostics n = row_count; perform pg_temp.as_db();
  res := res || ('L2 read-only member renames a leasehold: '||n||' rows'||pg_temp.v(n = 0));
  begin
    perform pg_temp.as_user(RO); insert into public.tenants(property_id, name, sqft) values (P, '048 planted by read-only', 1) returning id into j;
    res := res || ('L3 FAIL: read-only member added a leasehold')::text;
  exception when others then res := res || ('L3 read-only member adding a leasehold refused: '||sqlstate||pg_temp.v(sqlstate = '42501')); end;
  perform pg_temp.as_db();
  perform pg_temp.as_user(EDITOR); update public.tenants set sqft = 600 where id = T2; get diagnostics n = row_count; perform pg_temp.as_db();
  res := res || ('L4 editor edits a leasehold: '||n||' row'||pg_temp.v(n = 1));
  begin
    perform pg_temp.as_user(OWNER); insert into public.tenants(property_id, name, sqft) values (P, '048 Tenant Three', 10) returning id into j; perform pg_temp.as_db();
    res := res || ('L5 owner adds a leasehold: ok')::text;
  exception when others then perform pg_temp.as_db(); res := res || ('L5 FAIL: owner adding a leasehold refused — '||sqlstate||' '||left(sqlerrm, 90)); end;
  begin
    perform pg_temp.as_user(EDITOR); delete from public.tenants where id = T2;
    res := res || ('L6 FAIL: editor deleted a leasehold directly (038 should refuse)')::text;
  exception when others then res := res || ('L6 editor''s direct delete of a leasehold refused by 038: '||sqlstate||pg_temp.v(sqlstate = '23000')); end;
  perform pg_temp.as_db();
  perform pg_temp.as_user(OUTS); update public.tenants set name = 'x' where id = T1; get diagnostics n = row_count; perform pg_temp.as_db();
  res := res || ('L7 tenant user (no membership) renames their own leasehold: '||n||' rows'||pg_temp.v(n = 0));
  begin
    perform set_config('role', 'anon', true); select count(*) into c1 from public.tenants;
    res := res || ('L8 FAIL: anon read leaseholds ('||c1||' rows)');
  exception when others then res := res || ('L8 anon read of leaseholds refused: '||sqlstate||pg_temp.v(sqlstate = '42501')); end;
  perform pg_temp.as_db();
  begin
    perform pg_temp.as_user(OWNER); truncate public.tenants;
    res := res || ('L9 FAIL: a signed-in person truncated tenants')::text;
  exception when others then res := res || ('L9 TRUNCATE tenants by a signed-in person refused: '||sqlstate||pg_temp.v(sqlstate = '42501')); end;
  perform pg_temp.as_db();

  -- ── J · lease jobs ─────────────────────────────────────────────────────────
  perform pg_temp.as_user(OWNER);  select count(*) into c1 from public.lease_jobs where property_id = P; perform pg_temp.as_db();
  perform pg_temp.as_user(RO);     select count(*) into c2 from public.lease_jobs where property_id = P; perform pg_temp.as_db();
  perform pg_temp.as_user(OUTS);   select count(*) into c3 from public.lease_jobs where property_id = P; perform pg_temp.as_db();
  res := res || ('J1 owner/read-only/stranger read the lease job: '||c1||'/'||c2||'/'||c3||pg_temp.v(c1 = 1 and c2 = 1 and c3 = 0));
  begin
    perform pg_temp.as_user(RO); insert into public.lease_jobs(property_id, file_name) values (P, '048-planted.pdf');
    res := res || ('J2 FAIL: read-only member filed a lease job')::text;
  exception when others then res := res || ('J2 read-only member filing a lease job refused: '||sqlstate||pg_temp.v(sqlstate = '42501')); end;
  perform pg_temp.as_db();
  perform pg_temp.as_user(RO); update public.lease_jobs set stage = 'OCR' where id = JOB; get diagnostics c1 = row_count;
  delete from public.lease_jobs where id = JOB; get diagnostics c2 = row_count; perform pg_temp.as_db();
  res := res || ('J3 read-only member updates/deletes the job: '||c1||'/'||c2||' rows'||pg_temp.v(c1 = 0 and c2 = 0));
  begin
    perform pg_temp.as_user(EDITOR);
    insert into public.lease_jobs(id, property_id, file_name) values (JOB, P, '048-lease-one.pdf') on conflict (id) do update set file_name = excluded.file_name; get diagnostics c1 = row_count;
    update public.lease_jobs set status = 'completed', stage = 'completed' where id = JOB; get diagnostics c2 = row_count;
    insert into public.lease_jobs(property_id, file_name) values (P, '048-by-editor.pdf') returning id into j;
    delete from public.lease_jobs where id = j; get diagnostics c3 = row_count;
    perform pg_temp.as_db();
    res := res || ('J4 editor: the job upsert (script.js) '||c1||', the update-by-id '||c2||', add and delete '||c3||pg_temp.v(c1 = 1 and c2 = 1 and c3 = 1));
  exception when others then perform pg_temp.as_db(); res := res || ('J4 FAIL: editor''s lease job writes refused — '||sqlstate||' '||left(sqlerrm, 90)); end;
  begin
    perform set_config('role', 'anon', true); insert into public.lease_jobs(property_id, file_name) values (P, '048-anon.pdf');
    res := res || ('J5 FAIL: anon filed a lease job')::text;
  exception when others then res := res || ('J5 anon filing a lease job refused: '||sqlstate||pg_temp.v(sqlstate = '42501')); end;
  perform pg_temp.as_db();

  -- ── E · field evidence: append-only for signed-in people ───────────────────
  perform pg_temp.as_user(OWNER);  select count(*) into c1 from public.tenant_field_evidence where property_id = P; perform pg_temp.as_db();
  perform pg_temp.as_user(RO);     select count(*) into c2 from public.tenant_field_evidence where property_id = P; perform pg_temp.as_db();
  perform pg_temp.as_user(OUTS);   select count(*) into c3 from public.tenant_field_evidence where property_id = P; perform pg_temp.as_db();
  res := res || ('E1 owner/read-only/stranger read the evidence row: '||c1||'/'||c2||'/'||c3||pg_temp.v(c1 = 1 and c2 = 1 and c3 = 0));
  begin
    perform pg_temp.as_user(RO); insert into public.tenant_field_evidence(property_id, tenant_id, field_key, reviewed_at, value) values (P, T1::text, 'planted', '2025-02-01', 'x');
    res := res || ('E2 FAIL: read-only member added an evidence row')::text;
  exception when others then res := res || ('E2 read-only member adding evidence refused: '||sqlstate||pg_temp.v(sqlstate = '42501')); end;
  perform pg_temp.as_db();
  begin
    perform pg_temp.as_user(EDITOR);
    insert into public.tenant_field_evidence(property_id, tenant_id, field_key, reviewed_at, value) values (P, T1::text, 'base_rent', '2025-03-01', '1100')
      on conflict (tenant_id, field_key, reviewed_at) do nothing; get diagnostics c1 = row_count;
    insert into public.tenant_field_evidence(property_id, tenant_id, field_key, reviewed_at, value) values (P, T1::text, 'base_rent', '2025-03-01', '1100')
      on conflict (tenant_id, field_key, reviewed_at) do nothing; get diagnostics c2 = row_count;
    perform pg_temp.as_db();
    res := res || ('E3 editor''s evidence write as the browser makes it (insert, ignore duplicates): new row '||c1||', duplicate ignored '||c2||pg_temp.v(c1 = 1 and c2 = 0));
  exception when others then perform pg_temp.as_db(); res := res || ('E3 FAIL: editor''s evidence write refused — '||sqlstate||' '||left(sqlerrm, 90)); end;
  begin
    perform pg_temp.as_user(OWNER); update public.tenant_field_evidence set value = 'rewritten' where property_id = P;
    res := res || ('E4 FAIL: the owner rewrote an evidence row')::text;
  exception when others then res := res || ('E4 owner rewriting evidence refused outright: '||sqlstate||pg_temp.v(sqlstate = '42501')); end;
  perform pg_temp.as_db();
  begin
    perform pg_temp.as_user(OWNER); delete from public.tenant_field_evidence where property_id = P;
    res := res || ('E5 FAIL: the owner deleted evidence')::text;
  exception when others then res := res || ('E5 owner deleting evidence refused outright: '||sqlstate||pg_temp.v(sqlstate = '42501')); end;
  perform pg_temp.as_db();
  begin
    perform pg_temp.as_user(EDITOR); update public.tenant_field_evidence set value = 'rewritten' where property_id = P;
    res := res || ('E6 FAIL: an editor rewrote an evidence row')::text;
  exception when others then res := res || ('E6 editor rewriting evidence refused outright: '||sqlstate||pg_temp.v(sqlstate = '42501')); end;
  perform pg_temp.as_db();
  begin
    perform pg_temp.as_service();
    update public.tenant_field_evidence set value = '1000' where property_id = P and field_key = 'base_rent' and reviewed_at = '2025-03-01'; get diagnostics c1 = row_count;
    delete from public.tenant_field_evidence where property_id = P and field_key = 'base_rent' and reviewed_at = '2025-03-01'; get diagnostics c2 = row_count;
    perform pg_temp.as_db();
    res := res || ('E7 the server (service_role) still corrects and removes evidence: '||c1||'/'||c2||pg_temp.v(c1 = 1 and c2 = 1));
  exception when others then perform pg_temp.as_db(); res := res || ('E7 FAIL: service_role refused on evidence — '||sqlstate||' '||left(sqlerrm, 90)); end;
  select count(*) into c1 from public.tenant_field_evidence where property_id = P and value = '1000' and reviewed_at = '2025-01-01';
  res := res || ('E8 the fixture evidence row is intact after every refused write: '||c1||pg_temp.v(c1 = 1));

  -- ── A · review audit: append-only for signed-in people ─────────────────────
  perform pg_temp.as_user(RO); select count(*) into c1 from public.tenant_review_audit where property_id = P; perform pg_temp.as_db();
  res := res || ('A1 read-only member reads the audit row: '||c1||pg_temp.v(c1 = 1));
  begin
    perform pg_temp.as_user(RO); insert into public.tenant_review_audit(property_id, tenant_id, action, client_ts) values (P, T1::text, 'planted', '2025-02-01');
    res := res || ('A2 FAIL: read-only member added an audit row')::text;
  exception when others then res := res || ('A2 read-only member adding an audit row refused: '||sqlstate||pg_temp.v(sqlstate = '42501')); end;
  perform pg_temp.as_db();
  begin
    perform pg_temp.as_user(EDITOR);
    insert into public.tenant_review_audit(property_id, tenant_id, action, client_ts) values (P, T1::text, 'confirmed', '2025-03-01')
      on conflict (tenant_id, action, client_ts) do nothing; get diagnostics c1 = row_count;
    insert into public.tenant_review_audit(property_id, tenant_id, action, client_ts) values (P, T1::text, 'confirmed', '2025-03-01')
      on conflict (tenant_id, action, client_ts) do nothing; get diagnostics c2 = row_count;
    perform pg_temp.as_db();
    res := res || ('A3 editor''s audit write as the browser makes it: new row '||c1||', duplicate ignored '||c2||pg_temp.v(c1 = 1 and c2 = 0));
  exception when others then perform pg_temp.as_db(); res := res || ('A3 FAIL: editor''s audit write refused — '||sqlstate||' '||left(sqlerrm, 90)); end;
  begin
    perform pg_temp.as_user(OWNER); update public.tenant_review_audit set action = 'rewritten' where property_id = P;
    res := res || ('A4 FAIL: the owner rewrote the audit trail')::text;
  exception when others then res := res || ('A4 owner rewriting the audit trail refused outright: '||sqlstate||pg_temp.v(sqlstate = '42501')); end;
  perform pg_temp.as_db();
  begin
    perform pg_temp.as_user(OWNER); delete from public.tenant_review_audit where property_id = P;
    res := res || ('A5 FAIL: the owner deleted audit rows')::text;
  exception when others then res := res || ('A5 owner deleting audit rows refused outright: '||sqlstate||pg_temp.v(sqlstate = '42501')); end;
  perform pg_temp.as_db();
  begin
    perform pg_temp.as_service(); delete from public.tenant_review_audit where property_id = P and action = 'confirmed'; get diagnostics c1 = row_count; perform pg_temp.as_db();
    res := res || ('A6 the server (service_role) still removes an audit row: '||c1||pg_temp.v(c1 = 1));
  exception when others then perform pg_temp.as_db(); res := res || ('A6 FAIL: service_role refused on audit — '||sqlstate||' '||left(sqlerrm, 90)); end;
  select count(*) into c1 from public.tenant_review_audit where property_id = P and action = 'approved';
  res := res || ('A7 the fixture audit row is intact after every refused write: '||c1||pg_temp.v(c1 = 1));

  -- ── C · CAM results ────────────────────────────────────────────────────────
  perform pg_temp.as_user(RO); select count(*) into c1 from public.cam_reconciliations where property_id = P; perform pg_temp.as_db();
  res := res || ('C1 read-only member reads the CAM result: '||c1||pg_temp.v(c1 = 1));
  begin
    perform pg_temp.as_user(RO); insert into public.cam_reconciliations(property_id, tenant_id, year, actual_cam) values (P, T1, 2024, 1);
    res := res || ('C2 FAIL: read-only member wrote a CAM result')::text;
  exception when others then res := res || ('C2 read-only member writing a CAM result refused: '||sqlstate||pg_temp.v(sqlstate = '42501')); end;
  perform pg_temp.as_db();
  perform pg_temp.as_user(RO); update public.cam_reconciliations set actual_cam = 1 where property_id = P and year = 2025; get diagnostics c1 = row_count;
  delete from public.cam_reconciliations where property_id = P and year = 2025; get diagnostics c2 = row_count; perform pg_temp.as_db();
  res := res || ('C3 read-only member changes/deletes the CAM result: '||c1||'/'||c2||' rows'||pg_temp.v(c1 = 0 and c2 = 0));
  begin
    perform pg_temp.as_user(EDITOR);
    insert into public.cam_reconciliations(property_id, tenant_id, year, actual_cam) values (P, T1, 2024, 1); get diagnostics c1 = row_count;
    update public.cam_reconciliations set actual_cam = 2 where property_id = P and year = 2024; get diagnostics c2 = row_count;
    delete from public.cam_reconciliations where property_id = P and year = 2024; get diagnostics c3 = row_count;
    perform pg_temp.as_db();
    res := res || ('C4 editor adds, changes, deletes a CAM result: '||c1||'/'||c2||'/'||c3||pg_temp.v(c1 = 1 and c2 = 1 and c3 = 1));
  exception when others then perform pg_temp.as_db(); res := res || ('C4 FAIL: editor''s CAM writes refused — '||sqlstate||' '||left(sqlerrm, 90)); end;
  begin
    perform pg_temp.as_service();
    delete from public.cam_reconciliations where property_id = P and year = 2025; get diagnostics c1 = row_count;
    insert into public.cam_reconciliations(property_id, tenant_id, year, actual_cam) values (P, T1, 2025, 100); get diagnostics c2 = row_count;
    perform pg_temp.as_db();
    res := res || ('C5 the CAM proxy''s writes (service_role: delete the year, insert the rows): '||c1||'/'||c2||pg_temp.v(c1 = 1 and c2 = 1));
  exception when others then perform pg_temp.as_db(); res := res || ('C5 FAIL: service_role refused on CAM results — '||sqlstate||' '||left(sqlerrm, 90)); end;
  begin
    perform set_config('role', 'anon', true); select count(*) into c1 from public.cam_reconciliations;
    res := res || ('C6 FAIL: anon read CAM results ('||c1||' rows)');
  exception when others then res := res || ('C6 anon read of CAM results refused: '||sqlstate||pg_temp.v(sqlstate = '42501')); end;
  perform pg_temp.as_db();

  -- ── U · tenant memberships (tenant_users) ──────────────────────────────────
  perform pg_temp.as_user(OWNER); select count(*) into c1 from public.tenant_users where property_id = P; perform pg_temp.as_db();
  perform pg_temp.as_user(RO);    select count(*) into c2 from public.tenant_users where property_id = P; perform pg_temp.as_db();
  res := res || ('U1 owner/read-only member read the tenant membership: '||c1||'/'||c2||pg_temp.v(c1 = 1 and c2 = 1));
  begin
    perform pg_temp.as_user(OWNER); insert into public.tenant_users(user_id, tenant_id, property_id, accepted_at) values (RO, T2, P, now());
    res := res || ('U2 FAIL: the owner wrote a tenant membership through the API')::text;
  exception when others then res := res || ('U2 owner writing a membership refused outright (the server writes memberships): '||sqlstate||pg_temp.v(sqlstate = '42501')); end;
  perform pg_temp.as_db();
  begin
    perform pg_temp.as_user(OWNER); update public.tenant_users set revoked_at = now() where property_id = P;
    res := res || ('U3 FAIL: the owner revoked a membership through the API')::text;
  exception when others then res := res || ('U3 owner revoking a membership refused outright: '||sqlstate||pg_temp.v(sqlstate = '42501')); end;
  perform pg_temp.as_db();
  begin
    perform pg_temp.as_service();
    insert into public.tenant_users(user_id, tenant_id, property_id, accepted_at) values (OUTS, T1, P, now()) on conflict (user_id, tenant_id) do update set accepted_at = excluded.accepted_at; get diagnostics c1 = row_count;
    perform pg_temp.as_db();
    res := res || ('U4 accept-invite''s membership upsert (service_role) still works: '||c1||pg_temp.v(c1 = 1));
  exception when others then perform pg_temp.as_db(); res := res || ('U4 FAIL: service_role membership upsert refused — '||sqlstate||' '||left(sqlerrm, 90)); end;

  -- ── I · tenant invitations ─────────────────────────────────────────────────
  begin
    perform pg_temp.as_user(OWNER); select count(*) into c1 from public.tenant_invitations where property_id = P;
    res := res || ('I1 FAIL: a signed-in person read invitations ('||c1||' rows; there is no grant)');
  exception when others then res := res || ('I1 signed-in read of invitations refused outright (no grant yet): '||sqlstate||pg_temp.v(sqlstate = '42501')); end;
  perform pg_temp.as_db();
  begin
    perform pg_temp.as_user(OWNER); insert into public.tenant_invitations(tenant_id, property_id, email, token_hash, invited_by) values (T1, P, '048-a@mainstreet-test.local', repeat('ef', 32), OWNER);
    res := res || ('I2 FAIL: a signed-in person created an invitation (no landlord invite screen exists)')::text;
  exception when others then res := res || ('I2 signed-in creating an invitation refused outright (the admin rule is dormant until a grant): '||sqlstate||pg_temp.v(sqlstate = '42501')); end;
  perform pg_temp.as_db();
  begin
    perform pg_temp.as_service();
    select count(*) into c1 from public.tenant_invitations where token_hash = repeat('ab', 32);
    update public.tenant_invitations set accepted_at = now(), accepted_by = OUTS where token_hash = repeat('ab', 32) and accepted_at is null; get diagnostics c2 = row_count;
    perform pg_temp.as_db();
    res := res || ('I3 accept-invite''s read-then-patch of the invitation (service_role): '||c1||'/'||c2||pg_temp.v(c1 = 1 and c2 = 1));
  exception when others then perform pg_temp.as_db(); res := res || ('I3 FAIL: service_role refused on invitations — '||sqlstate||' '||left(sqlerrm, 90)); end;

  -- ── S · tenant statements ──────────────────────────────────────────────────
  perform pg_temp.as_user(OWNER); select count(*) into c1 from public.tenant_statements where property_id = P; perform pg_temp.as_db();
  perform pg_temp.as_user(RO);    select count(*) into c2 from public.tenant_statements where property_id = P; perform pg_temp.as_db();
  res := res || ('S1 owner/read-only member read both statements: '||c1||'/'||c2||pg_temp.v(c1 = 2 and c2 = 2));
  begin
    perform pg_temp.as_user(OWNER); insert into public.tenant_statements(tenant_id, property_id, cam_year, version, allocated_amount, pro_rata_percent, total_pool, statement_json) values (T2, P, 2024, 1, 0, 0, 0, '{}'::jsonb);
    res := res || ('S2 FAIL: the owner created a statement through the API (statements are published by the server)')::text;
  exception when others then res := res || ('S2 owner creating a statement refused outright: '||sqlstate||pg_temp.v(sqlstate = '42501')); end;
  perform pg_temp.as_db();
  begin
    perform pg_temp.as_user(OWNER); update public.tenant_statements set status = 'void' where property_id = P;
    res := res || ('S3 FAIL: the owner voided statements through the API')::text;
  exception when others then res := res || ('S3 owner voiding a statement refused outright: '||sqlstate||pg_temp.v(sqlstate = '42501')); end;
  perform pg_temp.as_db();
  begin
    perform pg_temp.as_service();
    insert into public.tenant_statements(tenant_id, property_id, cam_year, version, allocated_amount, pro_rata_percent, total_pool, statement_json, status, published_at)
      values (T1, P, 2024, 1, 0, 0, 0, '{}'::jsonb, 'published', now()); get diagnostics c1 = row_count;
    perform pg_temp.as_db();
    res := res || ('S4 statement publication (service_role, as publish_tenant_statement writes) still works: '||c1||pg_temp.v(c1 = 1));
  exception when others then perform pg_temp.as_db(); res := res || ('S4 FAIL: service_role refused on statements — '||sqlstate||' '||left(sqlerrm, 90)); end;

  -- ── T · a tenant user keeps exactly their reads and gains no write ─────────
  perform pg_temp.as_user(OUTS);
  select count(*) into c1 from public.tenants where property_id = P;
  select count(*) into c2 from public.tenant_users where property_id = P;
  select count(*) into c3 from public.tenant_statements where property_id = P;
  select (select count(*) from public.lease_jobs where property_id = P) + (select count(*) from public.tenant_field_evidence where property_id = P)
       + (select count(*) from public.tenant_review_audit where property_id = P) + (select count(*) from public.cam_reconciliations where property_id = P) into c4;
  select count(*) into c5 from public.tenant_statements where property_id = P and status = 'draft';
  perform pg_temp.as_db();
  res := res || ('T1 tenant user reads their leasehold, their membership and their published statements, nothing else: '||c1||'/'||c2||'/'||c3||'; jobs+evidence+audit+CAM '||c4||'; drafts '||c5||pg_temp.v(c1 = 1 and c2 = 1 and c3 = 2 and c4 = 0 and c5 = 0));
  begin
    perform pg_temp.as_user(OUTS); insert into public.tenant_users(user_id, tenant_id, property_id, accepted_at) values (OUTS, T2, P, now());
    res := res || ('T2 FAIL: a tenant user granted themselves another space')::text;
  exception when others then res := res || ('T2 tenant user granting themselves another space refused: '||sqlstate||pg_temp.v(sqlstate = '42501')); end;
  perform pg_temp.as_db();
  begin
    perform pg_temp.as_user(OUTS); update public.tenant_statements set status = 'void' where property_id = P;
    res := res || ('T3 FAIL: a tenant user voided a statement')::text;
  exception when others then res := res || ('T3 tenant user voiding a statement refused: '||sqlstate||pg_temp.v(sqlstate = '42501')); end;
  perform pg_temp.as_db();
  -- the tenant membership is removed (as the database owner) so OUTS is a plain stranger again for the membership checks below
  delete from public.tenant_users where user_id = OUTS and property_id = P;

  -- ── V · revoked and unaccepted memberships write nothing; accepted editors do
  insert into public.organization_members(organization_id, user_id, role, accepted_at, revoked_at) values (ORG, OUTS, 'property_manager', now(), now());
  begin
    perform pg_temp.as_user(OUTS); insert into public.lease_jobs(property_id, file_name) values (P, '048-revoked.pdf');
    res := res || ('V1 FAIL: revoked member filed a lease job')::text;
  exception when others then res := res || ('V1 revoked member filing a lease job refused: '||sqlstate||pg_temp.v(sqlstate = '42501')); end;
  perform pg_temp.as_db();
  update public.organization_members set accepted_at = null, revoked_at = null where organization_id = ORG and user_id = OUTS;
  begin
    perform pg_temp.as_user(OUTS); insert into public.tenant_field_evidence(property_id, tenant_id, field_key, reviewed_at, value) values (P, T1::text, 'unaccepted', '2025-04-01', 'x');
    res := res || ('V2 FAIL: unaccepted member added evidence')::text;
  exception when others then res := res || ('V2 unaccepted member adding evidence refused: '||sqlstate||pg_temp.v(sqlstate = '42501')); end;
  perform pg_temp.as_db();
  update public.organization_members set accepted_at = now() where organization_id = ORG and user_id = OUTS;
  begin
    perform pg_temp.as_user(OUTS);
    insert into public.lease_jobs(property_id, file_name) values (P, '048-accepted.pdf');
    insert into public.tenant_field_evidence(property_id, tenant_id, field_key, reviewed_at, value) values (P, T1::text, 'accepted', '2025-04-01', 'x');
    perform pg_temp.as_db();
    res := res || ('V3 the same account, once accepted as property_manager, files a job and an evidence row: ok (membership is what gates)')::text;
  exception when others then perform pg_temp.as_db(); res := res || ('V3 FAIL: accepted editor refused — '||sqlstate||' '||left(sqlerrm, 90)); end;

  -- ── W · the workflows around the eight tables ──────────────────────────────
  begin
    perform pg_temp.as_user(OWNER);
    perform public.resync_property_tenants(P, jsonb_build_array(jsonb_build_object('id', T1, 'name', '048 Tenant One', 'sqft', 1000), jsonb_build_object('id', T2, 'name', '048 Tenant Two', 'sqft', 600)));
    perform pg_temp.as_db();
    select count(*) into c1 from public.tenants where property_id = P;
    res := res || ('W1 resync_property_tenants (SECURITY DEFINER) still runs for the owner; leaseholds kept: '||c1||pg_temp.v(c1 >= 2));
  exception when others then perform pg_temp.as_db(); res := res || ('W1 FAIL: resync_property_tenants — '||sqlstate||' '||left(sqlerrm, 120)); end;
  begin
    perform pg_temp.as_user(OWNER); perform public.end_leasehold(T2, '2025-06-30'::date, 'lease_expired', 'ended in the 048 matrix'); perform pg_temp.as_db();
    select leasehold_status into t from public.tenants where id = T2;
    res := res || ('W2 end_leasehold (038) still runs for the owner; the leasehold is kept as '||coalesce(t, 'GONE')||pg_temp.v(t = 'ended'));
  exception when others then perform pg_temp.as_db(); res := res || ('W2 FAIL: end_leasehold — '||sqlstate||' '||left(sqlerrm, 120)); end;
  begin
    perform pg_temp.as_user(OWNER); delete from public.tenants where id = T2;
    res := res || ('W3 FAIL: the owner deleted a leasehold directly')::text;
  exception when others then res := res || ('W3 the owner''s direct delete of a leasehold is still refused by 038: '||sqlstate||pg_temp.v(sqlstate = '23000')); end;
  perform pg_temp.as_db();
  begin
    perform pg_temp.as_user(OWNER); insert into public.tenants(id, property_id, name, sqft) values (T1, P, '048 Tenant One', 1200) on conflict (id) do update set sqft = excluded.sqft; get diagnostics c1 = row_count; perform pg_temp.as_db();
    res := res || ('W4 the browser''s leasehold upsert (resync fallback, demo seeds) by the owner: '||c1||pg_temp.v(c1 = 1));
  exception when others then perform pg_temp.as_db(); res := res || ('W4 FAIL: leasehold upsert refused — '||sqlstate||' '||left(sqlerrm, 90)); end;
  begin
    perform pg_temp.as_user(OWNER); insert into public.properties(user_id, name) values (OWNER, '048 live matrix doomed property') returning id into PX; perform pg_temp.as_db();
    insert into public.tenant_field_evidence(property_id, tenant_id, field_key, reviewed_at, value) values (PX, 't', 'k', '2025-01-01', 'v');
    insert into public.tenant_review_audit(property_id, tenant_id, action, client_ts) values (PX, 't', 'a', '2025-01-01');
    perform pg_temp.as_user(OWNER); delete from public.properties where id = PX; get diagnostics c1 = row_count; perform pg_temp.as_db();
    select (select count(*) from public.tenant_field_evidence where property_id = PX) + (select count(*) from public.tenant_review_audit where property_id = PX) into c2;
    res := res || ('W5 deleting a property still removes its evidence and audit rows (the cascade runs as the owner): deleted '||c1||', rows left '||c2||pg_temp.v(c1 = 1 and c2 = 0));
  exception when others then perform pg_temp.as_db(); res := res || ('W5 FAIL: '||sqlstate||' '||left(sqlerrm, 120)); end;

  -- ── RA · a real owner account, read-only: sees exactly the rows the rules allow
  with allowed as (
    select p.id from public.properties p
     where p.user_id = REAL1
        or (p.organization_id is not null and exists (
              select 1 from public.organization_members m
               where m.organization_id = p.organization_id and m.user_id = REAL1 and m.accepted_at is not null and m.revoked_at is null)))
  select (select count(*) from public.tenants x where x.property_id in (select id from allowed))
       ||'/'||(select count(*) from public.lease_jobs x where x.property_id in (select id from allowed))
       ||'/'||(select count(*) from public.tenant_field_evidence x where x.property_id in (select id from allowed))
       ||'/'||(select count(*) from public.tenant_review_audit x where x.property_id in (select id from allowed))
       ||'/'||(select count(*) from public.cam_reconciliations x where x.property_id in (select id from allowed)) into t;
  perform pg_temp.as_user(REAL1);
  select count(*) into c1 from public.tenants;
  select count(*) into c2 from public.lease_jobs;
  select count(*) into c3 from public.tenant_field_evidence;
  select count(*) into c4 from public.tenant_review_audit;
  select count(*) into c5 from public.cam_reconciliations;
  perform pg_temp.as_db();
  res := res || ('RA1 real owner account reads leaseholds/jobs/evidence/audit/CAM '||c1||'/'||c2||'/'||c3||'/'||c4||'/'||c5||' vs allowed '||t||pg_temp.v(c1||'/'||c2||'/'||c3||'/'||c4||'/'||c5 = t));

  foreach ln in array res loop
    if ln like '%FAIL%' then fail_n := fail_n + 1; elsif ln like '% ok%' then ok_n := ok_n + 1; end if;
  end loop;
  raise exception using message = E'MATRIX RESULTS (everything rolled back)\n' || array_to_string(res, E'\n')
    || E'\nSUMMARY ' || ok_n || ' ok, ' || fail_n || ' FAIL', errcode = 'P0001';
end $m$;
