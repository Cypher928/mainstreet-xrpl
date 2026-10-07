-- CI fixture orphan organisations — one-off cleanup. PILOT ONLY.
-- Generated 2026-10-07T02:03:53.934Z by tools/ci-fixture-orphan-cleanup.js.
-- Deletes exactly the 88 organisations listed below, each of which must still satisfy
-- the orphan predicate (no creator, fixture name, no members, no properties, no property_events,
-- no auth user with that email), and refuses — rolling back — on any other outcome.
-- How they arose: the header of scripts/b1-ci-fixture.js.
begin;
do $$
declare
  v_expected       constant int    := 88;
  v_protected_n    constant int    := 13;
  v_protected_ids  constant text   := 'faff4c993fce0ebb0c76869dc13b5ed3';
  v_protected_rows constant text   := 'b33b11158cb59059f7929b63085e44ed';
  v_ids            constant uuid[] := array[
    '0010034a-f996-4b2a-98a5-a0da5b7a2607',
    '02e4c31b-5593-4461-8c90-2c46c707c292',
    '043b274c-7287-4708-81be-ed181d5d4c68',
    '091e7a1d-9780-4afb-8473-80071e362ed6',
    '10066735-8df7-499d-8aaf-deb48e8c2724',
    '15b60dc1-75db-4f1b-b544-8b0a71237078',
    '178f40ad-1944-4afc-bede-d1c43a591719',
    '18008d95-9fa4-4359-9c38-8a5db9b46d34',
    '18719af2-7b6f-447e-9599-d8856e6d23e5',
    '1a7082e7-30a8-460c-a723-2eb0aa910f9d',
    '1bb0b8b8-7cb9-4533-a1b1-76e518c5a30f',
    '1c8491dd-981e-4f28-a698-33390cae051a',
    '1c9a7a52-7405-4097-998c-d5a0f6f52879',
    '202619df-6aee-4bfd-af89-48b4007ab47d',
    '202f5373-c9c0-4a3a-bd9f-2521577d0fe4',
    '20315f4f-1c7c-4339-ac82-736322cb8b46',
    '2fe98428-f881-4f65-9f06-71742c25d0e1',
    '34dc67ed-23b6-499e-9033-77cafc3c87cf',
    '3cd4e61c-8512-483c-9379-df29a9cf9b3b',
    '3e6744ff-b160-473d-9415-bb20395a3b89',
    '4631e18e-74b9-45a7-82fe-622dddc8b5f2',
    '47270877-2498-4986-a032-9c3ab99905b2',
    '4c235a65-1b5d-409e-89b1-cd0d4a94e39b',
    '4cb5e5ad-dba8-4316-b48f-2694683bd811',
    '4e0eca66-cf5d-4053-ac07-8d0be5b26f39',
    '4f42f7c7-11cd-4017-a4f8-7cbb279920d5',
    '52dde42f-8535-46d6-941e-78e4738720cd',
    '5f013e92-dab8-4892-b2e8-c312542ed880',
    '600fea0b-3e8a-4042-bc85-a4eb7b617312',
    '621483b5-e1f4-425c-9d24-87b0f45948d7',
    '62b95854-41ef-4e3a-aba3-af0d8012c2b7',
    '64bddd1c-9fef-4661-b208-bba68ad24256',
    '694a3319-9bd0-40ba-99ad-f4756ad91434',
    '69c42653-c505-4ca4-a5be-e643b5479703',
    '6b73c82d-e85b-491e-be81-f38769382c6a',
    '6d7a9e9e-9dcd-4143-b5fa-d07ac10656a6',
    '6fc91131-56fe-43f1-b554-22d231afa60f',
    '717113ba-f708-428e-b7b5-a34ff666dbd0',
    '722cfdb1-1f1f-42bb-9a21-14df570bb384',
    '7383a6d4-8175-4756-b59c-1e784b250818',
    '77da4d20-5175-4809-b80b-a91180c89d83',
    '7943a19d-cf30-4b69-8da2-83c54438d970',
    '7b13ee1e-a9cd-4459-a1f1-1b8b2ab1cd81',
    '7b248f1e-2f0b-46c8-b159-6837f9a4a073',
    '7f099458-5bd4-4ca6-ac06-0c262a7b3c3c',
    '808479e5-eeb8-4244-a714-a180a4da36e5',
    '8269a92b-8fb2-4f4b-895b-43e9cb32adfc',
    '828edc74-9080-4ccf-952c-0b5037e14f03',
    '8573ae89-402b-4a86-b3db-d6103357edd2',
    '8b469705-3446-4954-8fde-3a4a8d8ae116',
    '8dd322c1-b019-495b-bad6-842a626b7fe7',
    '8ddc6444-ac1f-493c-9f8d-4423757cefb7',
    '9120b852-666c-4794-b55e-6c3cb1677d20',
    '932e7e51-96a8-4ceb-9672-d3acb419645c',
    '97a53336-8112-42d1-a070-a253d1721c67',
    '9f81b989-eea9-42b8-b08a-97abc40c4053',
    '9fe5968e-7464-47e7-92c1-2b9e9a3fb062',
    'a4bf8a3c-7034-4ce8-be3d-7ed03b8e1e72',
    'a5764a50-c89b-437d-b807-4441bbf04e80',
    'aa9207d8-0bcc-4ef3-bff9-ba4583ec85c6',
    'b49482e9-68b0-4603-ae40-8161617aa5cd',
    'b576f0a7-b4ef-49bd-abe5-7b72c8537b78',
    'b866aeae-b36e-4689-8434-80bd7ebc65d9',
    'b892524d-6f71-4910-b0f4-2ff249e8c614',
    'ba2ca207-57a1-4baf-982e-454d65284ae1',
    'c1f0f801-0155-4615-a272-d7d3070ef81f',
    'c8e3987f-3ad8-457e-a94b-72faaf324dab',
    'caf4bac5-7d92-479c-b599-ffbdae6bc852',
    'cbcb6092-008c-463a-88a5-b522e77dd3d6',
    'da120292-ed49-498f-b3a4-777266c87450',
    'da79c0c6-7bee-4c34-9cad-227e03629fc7',
    'e0aab66c-e0fd-467a-975b-b2f9234045e9',
    'e154b534-430e-4f30-b017-8d955db56bbf',
    'e1d0ada0-05ca-4923-a386-1d7440a5062d',
    'e3d91817-01c2-4d3b-9dc0-023e90c0f93f',
    'e4b72b68-c4f2-40fc-a24d-4f3141c19b45',
    'e7af65ba-3bf9-4c45-8339-b6add0625c56',
    'e7ba84da-e09b-44dc-be33-8b143b45ae8d',
    'ea32902e-0836-46be-8dab-9cc0be449a47',
    'ec225bde-1097-4339-be2d-a382a3dd372e',
    'ee27b92a-791f-4ada-8944-e01d471c41d9',
    'ef6b2412-5d7b-48c1-a6db-b6327cf9d098',
    'f0cb71c9-ccb7-4093-b337-fff740659bf0',
    'f293bcff-f1c3-422b-a52c-5dc3a5f53dc1',
    'f8fc64a0-d17d-4536-96b9-5d5e97912be1',
    'fb09aa4f-71e7-4cef-bf61-bfe48666b78a',
    'fd93d70f-0900-4989-be06-a00fb78e9e65',
    'fe1b1ada-0165-4e0f-b4c8-9ea9b8d5bddf'
  ]::uuid[];
  v_n        int;
  v_ids_md5  text;
  v_rows_md5 text;
begin
  if not exists (select 1 from public.properties where id = 'fd9c09b1-b657-4c58-9999-c3cce28e7600') then
    raise exception 'REFUSING: pilot marker property not found — this is not the Pilot project';
  end if;
  if coalesce(array_length(v_ids, 1), 0) <> v_expected
     or (select count(distinct x) from unnest(v_ids) x) <> v_expected then
    raise exception 'REFUSING: the id list holds % entries, expected % distinct', coalesce(array_length(v_ids, 1), 0), v_expected;
  end if;
  select count(*) into v_n from public.organizations o
    where o.id = any(v_ids)
      and o.created_by is null
      and o.name ~ '^(b1ci|plci)-[0-9]+-[a-z]+@pilot\.invalid$'
      and not exists (select 1 from public.organization_members m where m.organization_id = o.id)
      and not exists (select 1 from public.properties p where p.organization_id = o.id)
      and not exists (select 1 from public.property_events e where e.organization_id = o.id)
      and not exists (select 1 from auth.users u where u.email = o.name);
  if v_n <> v_expected then
    raise exception 'REFUSING: % of the % listed organisations match the orphan predicate — nothing deleted', v_n, v_expected;
  end if;
  select count(*), coalesce(md5(string_agg(o.id::text, ',' order by o.id)), '-') into v_n, v_ids_md5
    from public.organizations o where not (o.id = any(v_ids));
  if v_n <> v_protected_n or v_ids_md5 <> v_protected_ids then
    raise exception 'REFUSING: the organisations outside the list are not the expected set (% rows, ids md5 %) — nothing deleted', v_n, v_ids_md5;
  end if;
  delete from public.organizations o
    where o.id = any(v_ids)
      and o.created_by is null
      and o.name ~ '^(b1ci|plci)-[0-9]+-[a-z]+@pilot\.invalid$'
      and not exists (select 1 from public.organization_members m where m.organization_id = o.id)
      and not exists (select 1 from public.properties p where p.organization_id = o.id)
      and not exists (select 1 from public.property_events e where e.organization_id = o.id)
      and not exists (select 1 from auth.users u where u.email = o.name);
  get diagnostics v_n = row_count;
  if v_n <> v_expected then
    raise exception 'ABORT: the delete removed % rows, expected % — rolled back', v_n, v_expected;
  end if;
  select count(*),
         coalesce(md5(string_agg(o.id::text, ',' order by o.id)), '-'),
         coalesce(md5(string_agg(o::text, '|' order by o.id)), '-')
    into v_n, v_ids_md5, v_rows_md5
    from public.organizations o;
  if v_n <> v_protected_n or v_ids_md5 <> v_protected_ids or v_rows_md5 <> v_protected_rows then
    raise exception 'ABORT: after the delete the remaining organisations are not the protected set (% rows, ids md5 %, rows md5 %) — rolled back', v_n, v_ids_md5, v_rows_md5;
  end if;
end $$;
commit;
-- After-state, read-only (the SQL editor shows the last result set).
select 'a organizations remaining' as k, count(*)::text as v from public.organizations
union all select 'b remaining ids md5', coalesce(md5(string_agg(id::text, ',' order by id)), '-') from public.organizations
union all select 'c remaining rows md5', coalesce(md5(string_agg(o::text, '|' order by o.id)), '-') from public.organizations o
union all select 'd orphans matching the predicate (expect 0)', count(*)::text from public.organizations o where o.created_by is null
      and o.name ~ '^(b1ci|plci)-[0-9]+-[a-z]+@pilot\.invalid$'
      and not exists (select 1 from public.organization_members m where m.organization_id = o.id)
      and not exists (select 1 from public.properties p where p.organization_id = o.id)
      and not exists (select 1 from public.property_events e where e.organization_id = o.id)
      and not exists (select 1 from auth.users u where u.email = o.name)
union all select 'e organization_members', count(*)::text from public.organization_members
union all select 'f now', now()::text
order by 1;
