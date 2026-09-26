-- ============================================================================
-- tools/verify-migration-032.live.sql — the 032 matrix, for the LIVE Pilot
-- database, in a form that cannot leave anything behind.
-- ============================================================================
-- Everything runs inside ONE DO block that ends by RAISING, so every fixture
-- row it inserted is rolled back no matter how the caller batches statements.
-- The results travel in the exception message. Run it once BEFORE applying 032
-- (the three hazard rows read ok:true) and once AFTER (they read refused).
-- tools/verify-migration-032.js runs this same text against a throwaway cluster.
--
-- Before running:
--   select set_config('t032.uid', (select id::text from auth.users where email = '<reviewer>'), false);
-- Afterwards:
--   select count(*) from public.properties where name like 'T032 %';   -- must be 0
-- ============================================================================
do $t032$
declare
  uid   uuid := current_setting('t032.uid')::uuid;
  other uuid;
  p1 uuid := gen_random_uuid(); p2 uuid := gen_random_uuid(); p3 uuid := gen_random_uuid();
  p4 uuid := gen_random_uuid(); px uuid := gen_random_uuid();
  t1 uuid := gen_random_uuid(); t2 uuid := gen_random_uuid(); tn uuid := gen_random_uuid();
  t4 uuid := gen_random_uuid(); tp uuid := gen_random_uuid();
  p5 uuid := gen_random_uuid(); t5 uuid := gen_random_uuid(); torphan uuid := gen_random_uuid();
  r   jsonb;
  out jsonb := '{}'::jsonb;
begin
  -- impersonate the reviewer for auth.uid() (both settings Supabase's auth.uid() reads)
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', uid, 'role', 'authenticated')::text, true);

  -- fixtures (rolled back at the end)
  insert into public.properties (id, user_id, name, lifecycle_stage) values
    (p1, uid, 'T032 acquired 1', 'acquired'),
    (p2, uid, 'T032 acquired 2', 'acquired'),
    (p3, uid, 'T032 prospect',   'prospect');
  insert into public.tenants (id, property_id, name) values (t1, p1, 'T032 T1'), (t2, p1, 'T032 T2');
  insert into public.properties (id, user_id, name, lifecycle_stage, archived_at) values (p5, uid, 'T032 acquired archived', 'acquired', now());
  insert into public.tenants (id, property_id, name) values (torphan, null, 'T032 orphan');
  insert into public.cam_reconciliations (property_id, tenant_id, year) values (p1, t1, 2025);
  select id into other from auth.users where id <> uid order by created_at limit 1;
  if other is not null then
    insert into public.properties (id, user_id, name, lifecycle_stage) values (p4, other, 'T032 other owner', 'acquired');
    insert into public.tenants (id, property_id, name) values (t4, p4, 'T032 T4');
  end if;

  -- E1 same property + same tenant id
  r := public.resync_property_tenants(p1, jsonb_build_array(jsonb_build_object('id', t1, 'name', 'T032 T1 renamed'), jsonb_build_object('id', t2, 'name', 'T032 T2')));
  out := out || jsonb_build_object('E1_same_same', jsonb_build_object('ok', r->'ok', 'code', r->'code', 'upserted', r->'upserted',
           'name_now', (select name from public.tenants where id = t1), 'property_now', (select property_id from public.tenants where id = t1) = p1));

  -- E2 same property + new tenant id
  r := public.resync_property_tenants(p1, jsonb_build_array(jsonb_build_object('id', t1, 'name', 'T032 T1 renamed'), jsonb_build_object('id', t2, 'name', 'T032 T2'), jsonb_build_object('id', tn, 'name', 'T032 new')));
  out := out || jsonb_build_object('E2_same_new', jsonb_build_object('ok', r->'ok', 'upserted', r->'upserted',
           'new_under_p1', (select property_id from public.tenants where id = tn) = p1));

  -- E3 different property (same owner) + existing tenant id  ← the H2 hazard
  r := public.resync_property_tenants(p2, jsonb_build_array(jsonb_build_object('id', t1, 'name', 'T032 T1 moved')));
  out := out || jsonb_build_object('E3_cross_property_same_owner', jsonb_build_object('ok', r->'ok', 'code', r->'code',
           't1_still_on_p1', (select property_id from public.tenants where id = t1) = p1,
           'p2_tenant_count', (select count(*) from public.tenants where property_id = p2)));

  -- E3b another user's tenant id
  if other is not null then
    r := public.resync_property_tenants(p1, jsonb_build_array(jsonb_build_object('id', t4, 'name', 'T032 T4 taken')));
    out := out || jsonb_build_object('E3b_cross_property_other_owner', jsonb_build_object('ok', r->'ok', 'code', r->'code',
             't4_still_on_p4', (select property_id from public.tenants where id = t4) = p4));
  end if;

  -- E3c an orphan tenant id (no property at all)
  r := public.resync_property_tenants(p1, jsonb_build_array(jsonb_build_object('id', t1, 'name', 'T032 T1 renamed'), jsonb_build_object('id', torphan, 'name', 'T032 adopt orphan')));
  out := out || jsonb_build_object('E3c_orphan_tenant_id', jsonb_build_object('ok', r->'ok', 'code', r->'code',
           'orphan_still_unowned', (select property_id is null from public.tenants where id = torphan)));

  -- E4 prospect property
  r := public.resync_property_tenants(p3, jsonb_build_array(jsonb_build_object('id', tp, 'name', 'T032 on prospect')));
  out := out || jsonb_build_object('E4_prospect', jsonb_build_object('ok', r->'ok', 'code', r->'code', 'stage', r->'stage',
           'p3_tenant_count', (select count(*) from public.tenants where property_id = p3)));

  -- E5 acquired property (repeat of E2's roster, current)
  r := public.resync_property_tenants(p1, jsonb_build_array(jsonb_build_object('id', t1, 'name', 'T032 T1 renamed'), jsonb_build_object('id', t2, 'name', 'T032 T2'), jsonb_build_object('id', tn, 'name', 'T032 new')));
  out := out || jsonb_build_object('E5_acquired', jsonb_build_object('ok', r->'ok', 'upserted', r->'upserted'));

  -- E5b acquired + archived property
  r := public.resync_property_tenants(p5, jsonb_build_array(jsonb_build_object('id', t5, 'name', 'T032 on archived')));
  out := out || jsonb_build_object('E5b_acquired_archived', jsonb_build_object('ok', r->'ok', 'code', r->'code', 'upserted', r->'upserted',
           't5_under_p5', (select property_id from public.tenants where id = t5) = p5));

  -- E6 missing property
  r := public.resync_property_tenants(px, jsonb_build_array(jsonb_build_object('id', t1, 'name', 'x')));
  out := out || jsonb_build_object('E6_missing_property', jsonb_build_object('ok', r->'ok', 'code', r->'code'));

  -- E7 unauthorized user (another real user, or a random uuid when there is none)
  perform set_config('request.jwt.claim.sub', coalesce(other, gen_random_uuid())::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', coalesce(other, gen_random_uuid()), 'role', 'authenticated')::text, true);
  r := public.resync_property_tenants(p1, jsonb_build_array(jsonb_build_object('id', t1, 'name', 'T032 hijack')));
  out := out || jsonb_build_object('E7_unauthorized_user', jsonb_build_object('ok', r->'ok', 'code', r->'code',
           't1_name_unchanged', (select name from public.tenants where id = t1) = 'T032 T1 renamed'));

  -- E7b anonymous
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
  r := public.resync_property_tenants(p1, jsonb_build_array(jsonb_build_object('id', t1, 'name', 'T032 anon')));
  out := out || jsonb_build_object('E7b_anonymous', jsonb_build_object('ok', r->'ok', 'code', r->'code'));

  -- back to the reviewer
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', uid, 'role', 'authenticated')::text, true);

  -- R1 retention: t1 is referenced by a reconciliation → kept; t2 is not → pruned
  r := public.resync_property_tenants(p1, jsonb_build_array(jsonb_build_object('id', tn, 'name', 'T032 new')));
  out := out || jsonb_build_object('R1_retention', jsonb_build_object('ok', r->'ok', 'deleted', r->'deleted', 'retained_referenced', r->'retained_referenced',
           't1_kept', exists (select 1 from public.tenants where id = t1), 't2_pruned', not exists (select 1 from public.tenants where id = t2)));

  -- N1 empty roster, N2 all rows unusable
  r := public.resync_property_tenants(p1, '[]'::jsonb);
  out := out || jsonb_build_object('N1_empty_roster', jsonb_build_object('ok', r->'ok', 'noop_reason', r->'noop_reason'));
  r := public.resync_property_tenants(p1, jsonb_build_array(jsonb_build_object('id', 'not-a-uuid', 'name', 'x'), jsonb_build_object('id', tn, 'name', '')));
  out := out || jsonb_build_object('N2_unusable_rows', jsonb_build_object('ok', r->'ok', 'noop_reason', r->'noop_reason', 'skipped', r->'skipped',
           'tn_kept', exists (select 1 from public.tenants where id = tn)));

  raise exception using message = 'T032 RESULTS (everything above rolled back by design): ' || out::text, errcode = 'P0001';
end
$t032$;
