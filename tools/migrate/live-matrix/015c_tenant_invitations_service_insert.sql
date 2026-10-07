-- 015c live matrix on Pilot, run AFTER 015c is applied. ONE transaction that always
-- ends in RAISE EXCEPTION, so the fixture property, its leasehold and the invitation
-- written below are all rolled back. Results travel out in the exception message;
-- the last line counts them. Only the four mainstreet-test.local accounts are written
-- as; the one real account is used for a read-only check. Every write names the
-- fixture rows created here; nothing touches an existing row.
--
-- No storage; no DDL beyond the session-local pg_temp helpers, which die with the
-- session. Nothing here deletes.
--
-- Run before 015c (or after its rollback) the same file reports FAIL lines — G1, G5,
-- I1, I2, I3 — and 9 ok: the matrix is local-tested against both states
-- (scratchpad phase6/trial015c).
do $m$
declare
  OWNER  uuid := '1c682d8e-0fcb-42c9-9d91-95b9524bb113';  -- test account, admin of its own org, no properties
  EDITOR uuid := '6833ee9f-754d-41aa-8214-85652b3ef0ee';  -- test account → property_manager in OWNER's org (fixture)
  RO     uuid := '871e3646-ea87-4312-b27b-469e0bc0a03d';  -- test account → read_only in OWNER's org (fixture)
  OUTS   uuid := 'a8048989-1a8f-4891-b5e2-d985f5000915';  -- test account → stranger, then tenant user (fixture)
  REAL1  uuid := '011df998-bad2-464e-bbcb-28e2d0fee821';  -- real owner account, READ-ONLY check
  MARKER uuid := 'fd9c09b1-b657-4c58-9999-c3cce28e7600';  -- the Pilot marker property (another organisation's)
  ADMIN_Q  constant text := 'is_property_admin(property_id)';
  ALLP     constant text := 'DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE';
  HASH     constant text := repeat('5c', 32);               -- the invitation this matrix issues (a sha256-hex-shaped token hash)
  ORG uuid; res text[] := '{}'; ln text;
  P uuid; T1 uuid; INV uuid; who uuid; n int; t text; c1 int; c2 int; ok_n int := 0; fail_n int := 0;
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
  create function pg_temp.v(cond boolean) returns text language sql as $f$ select case when cond then ' ok' else ' FAIL' end $f$;

  -- ── G · the catalog 015c leaves (read as the database owner) ────────────────
  select string_agg(grantee||'='||privs, ' ; ' order by grantee) into t from (
    select grantee, string_agg(privilege_type, ',' order by privilege_type) privs
      from information_schema.role_table_grants
     where table_schema = 'public' and table_name = 'tenant_invitations' and grantee in ('anon', 'authenticated', 'service_role')
     group by grantee) s;
  res := res || ('G1 tenant_invitations grants: '||coalesce(t, '-')||pg_temp.v(t = 'service_role=INSERT,SELECT,UPDATE'));
  select string_agg(policyname||'|'||cmd||'|'||array_to_string(roles, ',')||'|'||coalesce(qual, '')||'|'||coalesce(with_check, ''), E'\n' order by policyname) into t
    from pg_policies where schemaname = 'public' and tablename = 'tenant_invitations';
  res := res || ('G2 the two invitation rules exactly as 048 and 014 wrote them'||pg_temp.v(t =
      'tenant_invitations_admin_all|ALL|authenticated|'||ADMIN_Q||'|'||ADMIN_Q||E'\n'||
      'tenant_invitations_service_role_all|ALL|service_role|true|true'));
  select string_agg(grantee||'='||privs, ' ; ' order by grantee) into t from (
    select grantee, string_agg(privilege_type, ',' order by privilege_type) privs
      from information_schema.role_table_grants
     where table_schema = 'public' and table_name = 'tenant_users' and grantee in ('anon', 'authenticated', 'service_role')
     group by grantee) s;
  res := res || ('G3 tenant_users grants untouched (015b): '||coalesce(t, '-')||pg_temp.v(t = 'authenticated=SELECT ; service_role=DELETE,INSERT,SELECT,UPDATE'));
  select count(*) into c1 from information_schema.role_table_grants where table_schema = 'public' and table_name = 'tenant_invitations' and grantee = 'PUBLIC';
  res := res || ('G4 PUBLIC holds nothing on tenant_invitations: '||c1||pg_temp.v(c1 = 0));
  select string_agg(x, ' ; ' order by x) into t from (
    select table_name||':'||grantee||'='||string_agg(privilege_type, ',' order by privilege_type) as x
      from information_schema.role_table_grants
     where table_schema = 'public' and table_name in ('tenants', 'lease_jobs', 'tenant_field_evidence', 'tenant_review_audit', 'cam_reconciliations', 'tenant_users', 'tenant_invitations', 'tenant_statements')
       and grantee in ('anon', 'authenticated', 'service_role')
     group by table_name, grantee) s;
  res := res || ('G5 the eight operating tables'' grants = 048''s, plus the one INSERT: '||coalesce(t, '-')||pg_temp.v(t =
      'cam_reconciliations:authenticated=DELETE,INSERT,SELECT,UPDATE ; cam_reconciliations:service_role='||ALLP||
      ' ; lease_jobs:authenticated=DELETE,INSERT,SELECT,UPDATE ; lease_jobs:service_role='||ALLP||
      ' ; tenant_field_evidence:authenticated=INSERT,SELECT ; tenant_field_evidence:service_role='||ALLP||
      ' ; tenant_invitations:service_role=INSERT,SELECT,UPDATE'||
      ' ; tenant_review_audit:authenticated=INSERT,SELECT ; tenant_review_audit:service_role='||ALLP||
      ' ; tenant_statements:authenticated=SELECT ; tenant_statements:service_role=INSERT,SELECT,UPDATE'||
      ' ; tenant_users:authenticated=SELECT ; tenant_users:service_role=DELETE,INSERT,SELECT,UPDATE'||
      ' ; tenants:authenticated=DELETE,INSERT,SELECT,UPDATE ; tenants:service_role='||ALLP));

  -- ── fixtures (as the owner, the way the app writes them) ───────────────────
  perform pg_temp.as_user(OWNER);
  insert into public.properties(user_id, name) values (OWNER, '015c live matrix property') returning id into P;
  insert into public.tenants(property_id, name, sqft) values (P, '015c Tenant One', 1000) returning id into T1;
  perform pg_temp.as_db();
  select organization_id into ORG from public.properties where id = P;
  if ORG is null then raise exception 'fixture property has no organisation; matrix cannot run'; end if;
  insert into public.organization_members(organization_id, user_id, role, accepted_at) values (ORG, EDITOR, 'property_manager', now());
  insert into public.organization_members(organization_id, user_id, role, accepted_at) values (ORG, RO, 'read_only', now());
  insert into public.tenant_users(user_id, tenant_id, property_id, accepted_at) values (OUTS, T1, P, now());
  res := res || ('FX property '||left(P::text, 8)||' org '||left(ORG::text, 8)||'; leasehold '||left(T1::text, 8)||'; editor, read-only member and a tenant user added')::text;

  -- ── I · the invitation, end to end, as the B1 gate and the accept-invite route do it
  begin
    perform pg_temp.as_service();
    insert into public.tenant_invitations(tenant_id, property_id, email, token_hash, invited_by, expires_at)
      values (T1, P, '015c-one@mainstreet-test.local', HASH, OWNER, now() + interval '7 days') returning id into INV;
    perform pg_temp.as_db();
    res := res || ('I1 the server issues an invitation (test-tenant-authz.js issueInvitation, service_role INSERT … returning): '||left(INV::text, 8)||pg_temp.v(INV is not null));
  exception when others then perform pg_temp.as_db(); res := res || ('I1 FAIL: service_role INSERT refused — '||sqlstate||' '||left(sqlerrm, 90)); end;
  begin
    perform pg_temp.as_service();
    select count(*) into c1 from public.tenant_invitations where token_hash = HASH and accepted_at is null and revoked_at is null;
    perform pg_temp.as_db();
    res := res || ('I2 accept-invite finds it open by token_hash (service_role): '||c1||pg_temp.v(c1 = 1));
  exception when others then perform pg_temp.as_db(); res := res || ('I2 FAIL: service_role read refused — '||sqlstate||' '||left(sqlerrm, 90)); end;
  begin
    perform pg_temp.as_service();
    update public.tenant_invitations set accepted_at = now(), accepted_by = OUTS where token_hash = HASH and accepted_at is null and revoked_at is null; get diagnostics c1 = row_count;
    update public.tenant_invitations set accepted_at = now() where token_hash = HASH and accepted_at is null and revoked_at is null; get diagnostics c2 = row_count;
    perform pg_temp.as_db();
    res := res || ('I3 accept-invite closes it once (service_role PATCH): '||c1||', a second redeem affects '||c2||pg_temp.v(c1 = 1 and c2 = 0));
  exception when others then perform pg_temp.as_db(); res := res || ('I3 FAIL: service_role update refused — '||sqlstate||' '||left(sqlerrm, 90)); end;
  begin
    perform pg_temp.as_service(); delete from public.tenant_invitations where property_id = P;
    perform pg_temp.as_db(); res := res || ('I4 FAIL: service_role deleted invitations (015c grants INSERT only)')::text;
  exception when others then perform pg_temp.as_db(); res := res || ('I4 service_role still cannot delete an invitation: '||sqlstate||pg_temp.v(sqlstate = '42501')); end;
  begin
    perform pg_temp.as_user(OWNER); select count(*) into c1 from public.tenant_invitations where property_id = P;
    perform pg_temp.as_db(); res := res || ('I5 FAIL: a signed-in person read invitations ('||c1||' rows; there is no grant)');
  exception when others then perform pg_temp.as_db(); res := res || ('I5 the owner (admin of the org) still cannot read invitations — no grant to authenticated: '||sqlstate||pg_temp.v(sqlstate = '42501')); end;
  begin
    perform pg_temp.as_user(OWNER);
    insert into public.tenant_invitations(tenant_id, property_id, email, token_hash, invited_by) values (T1, P, '015c-b@mainstreet-test.local', repeat('ef', 32), OWNER);
    perform pg_temp.as_db(); res := res || ('I6 FAIL: a signed-in admin created an invitation (the admin rule is meant to stay dormant)')::text;
  exception when others then perform pg_temp.as_db(); res := res || ('I6 the owner still cannot create an invitation (048''s admin rule stays dormant): '||sqlstate||pg_temp.v(sqlstate = '42501')); end;
  n := 0;
  foreach who in array array[EDITOR, RO, OUTS] loop
    begin
      perform pg_temp.as_user(who);
      insert into public.tenant_invitations(tenant_id, property_id, email, token_hash, invited_by) values (T1, P, '015c-c@mainstreet-test.local', repeat('01', 32), who);
      perform pg_temp.as_db();
    exception when others then perform pg_temp.as_db(); if sqlstate = '42501' then n := n + 1; end if; end;
  end loop;
  res := res || ('I7 editor, read-only member and tenant user each refused at the grant (42501): '||n||'/3'||pg_temp.v(n = 3));
  n := 0;
  begin perform pg_temp.as_anon(); select count(*) into c1 from public.tenant_invitations; perform pg_temp.as_db();
  exception when others then perform pg_temp.as_db(); if sqlstate = '42501' then n := n + 1; end if; end;
  begin perform pg_temp.as_anon();
    insert into public.tenant_invitations(tenant_id, property_id, email, token_hash, invited_by) values (T1, P, '015c-d@mainstreet-test.local', repeat('23', 32), OWNER);
    perform pg_temp.as_db();
  exception when others then perform pg_temp.as_db(); if sqlstate = '42501' then n := n + 1; end if; end;
  res := res || ('I8 anonymous read and insert both refused at the grant (42501): '||n||'/2'||pg_temp.v(n = 2));

  -- ── RA · a real owner account, read-only: invitations are still invisible to it
  begin
    perform pg_temp.as_user(REAL1); select count(*) into c1 from public.tenant_invitations;
    perform pg_temp.as_db(); res := res || ('RA1 FAIL: the real owner account read invitations ('||c1||' rows)');
  exception when others then perform pg_temp.as_db(); res := res || ('RA1 the real owner account still cannot read invitations: '||sqlstate||pg_temp.v(sqlstate = '42501')); end;

  foreach ln in array res loop
    if ln like '%FAIL%' then fail_n := fail_n + 1; elsif ln like '% ok%' then ok_n := ok_n + 1; end if;
  end loop;
  raise exception using message = E'MATRIX RESULTS (everything rolled back)\n' || array_to_string(res, E'\n')
    || E'\nSUMMARY ' || ok_n || ' ok, ' || fail_n || ' FAIL', errcode = 'P0001';
end $m$;
