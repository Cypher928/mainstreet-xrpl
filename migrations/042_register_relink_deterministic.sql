-- ============================================================================
-- 042_register_relink_deterministic.sql — relink EXACTLY the 53 approved
-- register rows to the leasehold they were uploaded as
-- ============================================================================
-- TARGET: PILOT PROJECT (bhmktujbxdbvdmpybmad) only. Requires 039
-- (lease_documents.legacy_tenant_id, lease_documents_leasehold_fk NOT VALID).
--
-- WHAT IT DOES
--   For each of the 53 (document, expected tenant_id, proposed tenant id)
--   triples approved from migration-042-dry-run.md — and for nothing else —
--   copies the current tenant_id into legacy_tenant_id, then sets tenant_id to
--   the proposed tenant. The set is a FIXED LIST written into this file. No
--   rule, name, blob or fuzzy match selects a row.
--
-- WHAT IT PROVES FIRST (inside the same transaction; any failure aborts ALL)
--   the list itself: 53 triples, 53 distinct documents, 53 distinct targets,
--     no document from the excluded lists;
--   039 is in place and the link is still NOT VALID; legacy_tenant_id is empty
--     on every row;
--   for EVERY one of the 53 rows — the dry run's conditions, unchanged:
--     the document exists; its tenant_id still equals the audited value and
--     still resolves to no tenant; the proposed tenant exists, in the SAME
--     property; the document's file_url equals that tenant's lease_url (the
--     same stored upload), shared by no other tenant and no other document;
--     exactly one lease_jobs row has that property and file_name, and its id
--     IS the proposed tenant; exactly one storage object is that upload; no
--     document already names the proposed tenant; the document is not on the
--     Miracle Mile property;
--   then the UPDATE must change exactly 53 rows, and afterwards: exactly 53
--   legacy values, all 53 links valid and same-property, every other
--   lease_documents row byte-identical, unresolved count down by exactly 53,
--   every excluded row untouched, the constraint still NOT VALID.
--
-- WHAT IT DOES NOT DO
--   It writes no other table (tenants, acquisition tables, property blobs,
--   evidence, CAM, storage) and no other lease_documents row. It does not
--   VALIDATE the constraint: the 38 other historical rows stay unresolved on
--   purpose. The table's own BEFORE UPDATE trigger (lease_documents_updated_at)
--   sets updated_at = now() on the 53 rows it changes.
--
-- Re-runnable: when all 53 rows already carry exactly this relink it does
-- nothing (NOTICE); any partial state is refused. Rollback:
-- 042_register_relink_deterministic_rollback.sql. Verified by
-- tools/verify-migration-042.js on a throwaway cluster.
-- ============================================================================

begin;

-- ── Guard ──────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from public.properties where id = 'fd9c09b1-b657-4c58-9999-c3cce28e7600') then
    raise exception 'REFUSING TO RUN: pilot marker property not found. This does not appear to be the pilot project (bhmktujbxdbvdmpybmad). 042 must never be applied to production.';
  end if;
end $$;

do $$
declare
  -- THE APPROVED SET — migration-042-dry-run.md, 53 rows, in its order.
  -- Row i of the three arrays is one (document, expected current tenant_id,
  -- proposed tenant id) triple; nothing else is ever selected.
  v_doc uuid[] := array[
      '427ccd99-5613-4242-9ef2-e5a26de216e4',
      '8644a114-0a18-42cc-8b1c-4a95d475298d',
      '16279f68-131d-4ad7-b823-bed2778362ea',
      'f1fe909b-771d-4025-a881-b50ab1348f30',
      '06584f2a-a377-4fc2-bfea-8a8d531b97ae',
      'ec1e799b-9ead-4abe-9e99-c1cf14b2093c',
      'd334803a-3da2-4be4-beec-25fdb63b5dcd',
      'c6673316-c3d7-41fe-a1ae-a1b1b4c105f4',
      '1bbedb68-33bc-4898-9ae3-bf713f3d6cc1',
      '780a9663-0ba2-41f8-a59d-77ff5cf74124',
      'e66c9910-9648-4a57-b4c9-f680cd928bda',
      '8c6cdc31-8eb7-4d9f-a284-89de77d86944',
      'fbfc72e4-28bd-438f-a560-184efbdef98e',
      'e2c4fdda-680e-4374-aace-a25ee921f0c1',
      '283250c9-e595-4d10-ad83-09271c6550b8',
      '94d16973-bae0-4471-9878-73aa68b7b37f',
      '8e42e299-c88e-4756-9690-765739a20a4a',
      '7332d024-7a8a-4a0d-b428-7181f289adb8',
      'd37d3d30-0d79-4f69-871d-518a9d09c9cf',
      '0d2a0b64-e3ba-41b4-bc43-632b20a6ae0a',
      '02bc2cd0-4b0a-4dd1-8aa3-635072ff14c0',
      'd184aa64-b09a-4a4b-a754-02068a34e2e5',
      '9468facb-a7a9-4a16-bb72-55d5f2298caa',
      '09e53972-5186-448f-ba2a-b0d656da9d88',
      '8dbbde25-a882-4e42-a7e7-7ae91c519447',
      '4eea1b50-93c5-4aa7-97a5-18120c06d426',
      'f7a8c7a8-9f0c-473f-bb80-aaf6fe11daab',
      'df09d124-579f-456d-9fb6-661fa04b799d',
      '25f50352-a47b-41f6-b46a-a90d7a692761',
      '70280a81-6cc6-4475-b542-65bac6c1e9bb',
      '4f3d95f6-35c7-4f41-b090-a23e92ec7efe',
      '27ce191d-5c70-44db-8afe-fdc95ab81251',
      '5c2b3946-1465-4b25-8c0c-c00416689bed',
      'ef1db11e-93ff-48c2-adde-588709771574',
      'd1237c7d-bf20-4ab5-8f07-24034b1db0e7',
      'fadffaa3-3a63-4f17-bbcc-af5e19406c69',
      'd846acbf-e00e-4e5d-a13d-5726d91a5fec',
      '76812689-623b-4fb3-997a-70ff0565c973',
      'f2ae9c65-6572-422a-8af7-318c3f4f7943',
      '74237160-f0e8-4ddf-84cf-248392402b8d',
      '5eefeaf1-7c66-42e9-a257-84b3ca5d2660',
      '56dfd85f-ee1f-4846-b407-b630b300790e',
      'cd8ed65b-6522-4eaf-8eb2-fcbd078010c8',
      'f8e1297b-61eb-408c-8120-282116f611f7',
      '32a75b6c-643f-4b0d-b301-b61f91439846',
      '8f515fa8-d1f1-4d70-9b36-e71ac818aaf8',
      'c580c3b2-5605-490c-ac20-816085b9cebe',
      '89e13376-6175-4243-b77a-c1c802a40518',
      'd4a36e8d-dec6-4474-bc33-6048366bf6a4',
      '5df30ef3-24f7-432e-b9f0-8f02f2a052a8',
      'c09dece3-4dae-45f9-927e-8ce84917cc55',
      '7198c21e-85ca-43e0-b6b7-c90b0343b896',
      '5ff7fad6-88a7-44ec-a901-f3d862350b56'
    ]::uuid[];
  v_exp uuid[] := array[
      '56bc0dbf-5ac6-4a4d-9260-dfa53106834d',
      'c44280c1-7b93-419e-a0a8-79c1f47a3fc8',
      '6a17a258-e10e-43ab-a28d-0ebdf213cad9',
      '5ec0bb57-d6f7-4dd9-b82b-f6f8549c0275',
      'a37e3b02-fbf5-4187-9058-6735b0c7308d',
      '8d8cba31-f6f9-4a5e-bfac-5ed70894ce00',
      'dbbf8e3a-1336-40ab-9861-6ced29e49d2d',
      'f3506bbc-706e-4814-99b8-8f7e748053d6',
      'bf51fcc7-113a-447e-88e7-f589299106a7',
      '9fa552ca-b013-403b-920e-d07f9f520c9a',
      '8ca16c46-b6ba-4f1a-b096-eee1db671f22',
      '95de62ca-a148-4705-97e2-b20bc85242d2',
      'a430ae83-4533-4539-a58a-a4f2ab8791d1',
      'cd5469d4-5f85-442b-9743-fd484753deed',
      '4bbc7eea-334c-4860-945a-693902d84349',
      '75c23ed4-041c-4026-bdb4-582a3bac4ec8',
      '09dd753c-1bbd-4c9f-a947-6c7d243fdd77',
      '87f9c671-a478-41cf-9c81-73215cfbc634',
      '4f2ce1ed-5734-46c0-88a4-dd14c0f2e2b9',
      '27a66e1a-cd21-402c-a0b5-9af3a7dc4562',
      '43c3efb4-42e8-4f9a-9760-507d03952774',
      '87c8a09c-60c1-4030-973b-07f7d84deb09',
      '314fe6dd-0067-49b7-a8c9-cfe3ff968b02',
      '9f778110-139b-4bcd-aa48-5548c7661641',
      '4ea60f3e-a80c-4bd6-9294-e58b8e22f0e4',
      'ff791626-779c-4bb0-9f16-dafcf4a979c2',
      '402301c3-5aa3-4131-a4f4-bb5fba9b7d13',
      'bd968004-5905-4747-ab85-80d6e736726c',
      '68f62485-0aa5-4f55-b938-a45ac3ed57f0',
      '9f073976-14e0-4706-a1df-ee3085126714',
      '9371b204-15e1-4623-bb47-a6a2b03dc333',
      'b73a065d-fa75-4264-99f0-6b2161efa63f',
      'a0988e01-f5ed-4466-aca1-a87f5c57c7f8',
      '6addb136-bca6-4463-a914-822e25b7451b',
      '47b565bd-e7be-4455-94d5-aaf9c558f305',
      'c749feeb-f4cf-44c1-9e92-ef3e012ede6e',
      '59c0bd30-9e06-4620-862c-697f68369c7f',
      '3837246c-408b-4b10-a8c8-8ab847f91608',
      'c3b5a4d6-51b9-44a2-bf0c-80ebcffff4a8',
      '4412cefc-147e-4528-ac11-885149d41c40',
      '9b23c15d-63b8-487f-8bac-37488e757d94',
      '030c3f46-f32d-49f8-9ceb-6292410429fb',
      '68027ca7-cc16-4b67-8d23-c04e3f8f724b',
      '8e524ac9-b17f-4c42-b907-e7558184f79d',
      'ad5f8ff1-5ee1-451f-8def-076749f44ca1',
      '18a55efc-c18a-4546-ae97-bcc8389a18f4',
      '5df20d40-5086-4c60-bbef-0a150a066eeb',
      'b7a45c21-1f25-40ca-b588-9d1a176af924',
      '1b43b107-c3c9-40ae-b2ab-72b590b150a6',
      '470be9ef-a9db-4a11-a52c-6d417247dfff',
      '46ac33d4-3661-404b-99f7-5073031dbc2d',
      '56fb9c53-9563-4d33-8353-dd91e0541d54',
      'ea9f6116-e69c-493a-9e42-69ed3720e07d'
    ]::uuid[];
  v_new uuid[] := array[
      'a79e3036-62ce-4516-8c77-fa1bf3e3b0a5',
      '2749ca6d-8e72-46ca-bdf0-865e58920b65',
      '5bbe0808-45ad-4f0e-83bc-673faf549588',
      'e3f35ff8-3f1b-4601-af4b-cc40105e6b99',
      '2d37368c-dc08-4414-9863-54da0afb13e4',
      '4ecf0839-e373-48c1-9700-de15cecab628',
      '83f57440-b917-4119-9ea6-e5dbaa79c586',
      'd5584b34-b2d2-4cba-acad-e0c15e2034d4',
      '1a8f56ea-df15-427f-8ed4-7e3fa2c64511',
      '29ef48f2-4fad-4f4a-83da-cb6391e23c9d',
      '7b6e9337-0552-4534-a6d4-a6481a20f3e1',
      'db8764f7-89fb-4a8a-89c9-8a24a5ba93eb',
      'f23a1302-ee31-4f7d-8a9a-545c14f9e700',
      '9fdb0a3a-ee43-4152-9037-7289929539e8',
      '3999c096-ff5e-4065-a61b-be27eadaa1bd',
      '5886813f-b6ba-4a8c-b7b5-6bd9bb007b1d',
      '5eba04b3-e700-41ca-8da8-a4b33ed2595b',
      '0ff927fe-5a1d-4368-a42b-becf2a174896',
      'e6c3a0ec-2446-4d1b-baad-8b338b2e209e',
      'cddc808d-8c4a-45c6-9a20-37e43f55b818',
      '596a79a6-c94d-4f5b-a6df-0828270cc597',
      '3c8c1d47-184f-40c2-86cf-e46c5a2faf67',
      '886fbedc-2ca2-4139-9b0d-74a187c57714',
      '7612178b-12d8-4261-a18a-7d1de11968b9',
      '87896fee-4487-4fe8-9805-159c8891b01b',
      'ac6e7187-e41f-4bc1-ab31-7ce683356244',
      '0f1eacf5-fb73-44ab-bd5d-5c3f69d04fe8',
      'fa3f1285-daa5-4ba3-b226-974e30aa5576',
      '2bc33efc-558e-447e-9226-22ed556a2269',
      '1b46b888-435b-4595-a5c0-85f632d8dbdf',
      'd32eb027-4020-4560-b334-f44d6e1cd518',
      '80d0d758-a41b-482b-9250-95849bc11c76',
      '86d80929-f71d-42e5-8aff-903e4af60a0d',
      '3032aa17-7c71-4752-939d-34fe7a90c210',
      '98795b43-bcad-4c21-84b5-afeb952d23f3',
      '77d82b2b-4206-4d02-baf9-37d8805fc11e',
      '12a7754d-3a24-4055-be08-a4648f20fa22',
      '1fd7fd58-0069-4cc5-8b09-a7c88ceb052e',
      '18667e6b-7074-41fc-965e-a106492184bd',
      '306959a4-674f-4bf7-8516-59884af79e92',
      'e6aa9503-1958-47bd-9bac-fb137abf6b6b',
      '540b3bc9-bd0c-493c-873d-19387fccd309',
      '3b320c35-b9ad-4b9c-9c2c-f9f6ac695cfa',
      '925dccf2-77e3-4092-9183-5913f7ab4a9d',
      'da5f5619-7e0c-48fe-bb14-f5f84738e59b',
      '3ad0c8ce-8901-47e4-be1e-703624a57250',
      'e28ac701-e88c-45c0-9612-ade517332ec0',
      '933c3a08-9f57-490c-9155-ede62a749e9b',
      '5d75fc17-154f-4809-a508-511813737f42',
      '5fde40cc-ee23-42dd-9754-dba25d9e221b',
      '0f28e815-25e4-49bc-90fe-bd2e8c35a2a5',
      'b642c286-5dd6-4ca0-826e-6c81f37fb263',
      'f4412130-e5fc-415e-85d4-0bf19ca2b93a'
    ]::uuid[];

  -- ROWS 042 MUST NOT TOUCH — migration-042-evidence-audit.md: the 9 Miracle
  -- Mile List A rows, the 11 List B rows, the 4 List C rows (Prime Wellness
  -- 6f09adbf… among them), the 14 List D rows, and the one row whose
  -- tenant_id is already empty. Used only to prove none of them is touched.
  v_excluded uuid[] := array[
      '15055bff-f204-4231-8950-e303dfdb7314',
      '0cda5374-d453-4410-a1bb-91887ceecb38',
      '439342b7-d7b8-4caa-a7d0-1f4f0c19c6df',
      'd98638fb-8a26-4d0f-ac27-63d5d0b36a41',
      'f9e7661d-4de7-47a4-8ef6-c4a48a832c96',
      'ac10743a-04ee-435f-9607-26671d89806f',
      '6d047cf0-20a1-4a54-a77e-1e51e44e9e4f',
      '8242e5dc-269b-4a78-8e64-cf49b5bd80aa',
      '285946d1-959e-43b2-b67f-c215f3975b51',
      '7cb287bb-5a06-4b5a-86ba-12a210129c43',
      '4aa4dfd8-f8c7-471b-9531-e974cfa4eba0',
      '1fce87e4-8d38-4e27-9614-82251f34853e',
      '0bf1c5d0-1275-4b63-a6c3-4b87323a53e2',
      '1a5e2b7b-c9da-4cf1-a1c4-5229814b4f3f',
      '6d6268ca-101e-4361-944c-a307cf4841a6',
      '352e6a6a-00df-4c5d-a0e7-928893c52a59',
      'f7925ca4-629d-4e3f-afa7-be62d09385e0',
      '3ea1fc3a-00cf-4ed8-ac4b-53457cc7bab0',
      '9ea34cac-0b00-4fa8-9b0a-775c9c1a7a9d',
      '135dc023-0be6-4040-9991-174ed3505b2d',
      'e23e74a9-30c2-47e2-9cea-ce29335a4c02',
      '14b810ba-3054-4f00-9f12-ffff7357b05a',
      '0d3f51af-677b-43c0-8972-7bf3d1940b19',
      '6f09adbf-9700-41d0-8621-eef681d40149',
      '34679621-8e2f-44d3-b10c-cc701639843e',
      'c45cbff2-eda6-4a51-b053-646911cfa5b8',
      '19588c4d-515b-4d86-a2a6-397cb3b9dac6',
      '076338ff-0ca6-4e8f-8554-a082969f2428',
      '151f4988-7a14-4207-b7de-c7daa56789e1',
      'a13e1992-6c3f-4afd-b6af-55ddf8027dee',
      '5780361c-a95b-4948-ad38-017eea6852ce',
      '9b623bd8-278d-4114-a432-bf1e1b837d76',
      '3297313a-dfd5-498f-bf26-c07354338973',
      '1d16bd10-57a1-44e1-b9d2-ea867eeb5ba4',
      '95f413c4-749d-4e03-807a-77379bd72c25',
      '8c0ca35a-4b7a-46f8-8c84-aca938a8e09e',
      'be837626-8e3b-4fbe-ac30-935b6f648697',
      'dc8016d3-0b89-4695-8efa-0d2d8e754d6b',
      'fb46a142-beda-452e-b628-d72c6db13f78'
    ]::uuid[];

  v_n            integer;
  v_post         integer;
  v_legacy       integer;
  v_fail         text;
  v_nfail        integer;
  v_other_before text;
  v_other_after  text;
  v_unres_before integer;
  v_unres_after  integer;
begin
  -- ── 0 · the list itself ────────────────────────────────────────────────
  if cardinality(v_doc) <> 53 or cardinality(v_exp) <> 53 or cardinality(v_new) <> 53 then
    raise exception '042 aborted: the approved list must hold exactly 53 triples (documents %, expected %, proposed %)',
      cardinality(v_doc), cardinality(v_exp), cardinality(v_new);
  end if;
  if (select count(distinct x) from unnest(v_doc) x) <> 53 then
    raise exception '042 aborted: a document appears twice in the approved list';
  end if;
  if (select count(distinct x) from unnest(v_new) x) <> 53 then
    raise exception '042 aborted: duplicate target tenant in the approved list';
  end if;
  if exists (select 1 from unnest(v_doc) x where x = any(v_excluded)) then
    raise exception '042 aborted: an excluded document (Miracle Mile / List B / C / D / empty) is in the approved list';
  end if;

  -- ── 1 · 039 is in place ────────────────────────────────────────────────
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'lease_documents' and column_name = 'legacy_tenant_id') then
    raise exception '042 aborted: lease_documents.legacy_tenant_id is missing (042 requires 039)';
  end if;
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.lease_documents'::regclass and conname = 'lease_documents_leasehold_fk') then
    raise exception '042 aborted: lease_documents_leasehold_fk is missing (042 requires 039)';
  end if;
  if (select convalidated from pg_constraint
       where conrelid = 'public.lease_documents'::regclass and conname = 'lease_documents_leasehold_fk') then
    raise exception '042 aborted: lease_documents_leasehold_fk is VALIDATED; 042 expects it NOT VALID';
  end if;

  -- Nothing may change the rows, the targets or the jobs between proof and write.
  lock table public.lease_documents in share row exclusive mode;
  lock table public.tenants         in share mode;
  lock table public.lease_jobs      in share mode;

  -- ── 2 · already applied? ───────────────────────────────────────────────
  select count(*) into v_post
    from unnest(v_doc, v_exp, v_new) as f(doc, exp, new)
    join public.lease_documents ld on ld.id = f.doc
   where ld.tenant_id = f.new and ld.legacy_tenant_id = f.exp;
  select count(*) into v_legacy from public.lease_documents where legacy_tenant_id is not null;
  if v_post = 53 and v_legacy = 53 then
    raise notice '042: already applied (all 53 rows carry exactly this relink); nothing to do';
    return;
  end if;
  if v_post > 0 then
    raise exception '042 aborted: % of the 53 rows already carry this relink and % do not (partial state)', v_post, 53 - v_post;
  end if;
  if v_legacy > 0 then
    raise exception '042 aborted: % lease_documents rows already hold a legacy_tenant_id; 042 expects none', v_legacy;
  end if;

  -- ── 3 · every one of the 53 rows against the approved evidence ─────────
  select count(*), string_agg(format('#%s %s: %s', z.i, z.doc, array_to_string(z.reasons, '; ')), ' | ' order by z.i)
    into v_nfail, v_fail
  from (
    select f.i, f.doc, array_remove(array[
      case when ld.id is null then 'document missing' end,
      case when ld.id is not null and ld.tenant_id is distinct from f.exp then 'current tenant_id changed' end,
      case when ld.id is not null and exists (select 1 from public.tenants x where x.id = ld.tenant_id)
           then 'current tenant_id now resolves to a tenant' end,
      case when t.id is null then 'proposed tenant missing' end,
      case when t.id is not null and ld.id is not null and t.property_id is distinct from ld.property_id
           then 'property mismatch' end,
      case when ld.id is not null and (ld.file_url is null or t.lease_url is distinct from ld.file_url)
           then 'document file_url is not the proposed tenant''s lease_url' end,
      case when ld.id is not null and (select count(*) from public.tenants t2 where t2.lease_url = ld.file_url) <> 1
           then 'upload not held by exactly one tenant' end,
      case when ld.id is not null and (select count(*) from public.lease_documents d2 where d2.file_url = ld.file_url) <> 1
           then 'upload not held by exactly one document' end,
      case when ld.id is not null and (select count(*) from public.lease_jobs j
                                        where j.property_id = ld.property_id and j.file_name = ld.file_name) <> 1
           then 'not exactly one lease_jobs row' end,
      case when ld.id is not null and not exists (select 1 from public.lease_jobs j
                                        where j.property_id = ld.property_id and j.file_name = ld.file_name and j.id = f.new)
           then 'the job id is not the proposed tenant' end,
      case when ld.id is not null and (select count(*) from storage.objects o
                                        where ld.file_url = o.bucket_id || '/' || o.name
                                           or ld.file_url like '%/storage/v1/object/public/' || o.bucket_id || '/' || o.name) <> 1
           then 'not exactly one stored object' end,
      case when exists (select 1 from public.lease_documents d3 where d3.tenant_id = f.new)
           then 'proposed tenant already named by a document' end,
      case when p.name = 'Miracle Mile' then 'document is on Miracle Mile' end
    ], null) as reasons
    from unnest(v_doc, v_exp, v_new) with ordinality as f(doc, exp, new, i)
    left join public.lease_documents ld on ld.id = f.doc
    left join public.tenants t         on t.id  = f.new
    left join public.properties p      on p.id  = ld.property_id
  ) z
  where cardinality(z.reasons) > 0;

  if v_nfail > 0 then
    raise exception '042 aborted: % of the 53 approved rows no longer meet the approved evidence: %', v_nfail, v_fail;
  end if;

  -- ── 4 · before: everything the relink must not touch ───────────────────
  select md5(string_agg(md5(ld::text), '' order by ld.id)) into v_other_before
    from public.lease_documents ld where ld.id <> all(v_doc);
  select count(*) into v_unres_before from public.lease_documents d
   where d.tenant_id is not null and not exists (select 1 from public.tenants t where t.id = d.tenant_id);

  -- ── 5 · the relink: keep the old value, then point at the leasehold ────
  update public.lease_documents ld
     set legacy_tenant_id = ld.tenant_id,
         tenant_id        = f.new
    from unnest(v_doc, v_exp, v_new) as f(doc, exp, new)
   where ld.id = f.doc
     and ld.tenant_id = f.exp
     and ld.legacy_tenant_id is null;
  get diagnostics v_n = row_count;
  if v_n <> 53 then
    raise exception '042 aborted: the relink changed % rows, not 53', v_n;
  end if;

  -- ── 6 · after, still inside the transaction ────────────────────────────
  if (select count(*) from public.lease_documents where legacy_tenant_id is not null) <> 53 then
    raise exception '042 aborted: legacy_tenant_id is not populated on exactly 53 rows';
  end if;
  if (select count(*) from unnest(v_doc, v_exp, v_new) as f(doc, exp, new)
        join public.lease_documents ld on ld.id = f.doc
       where ld.legacy_tenant_id = f.exp and ld.tenant_id = f.new) <> 53 then
    raise exception '042 aborted: the 53 rows do not carry exactly (legacy = expected, tenant_id = proposed)';
  end if;
  if (select count(*) from public.lease_documents ld
        join public.tenants t on t.id = ld.tenant_id and t.property_id = ld.property_id
       where ld.id = any(v_doc)) <> 53 then
    raise exception '042 aborted: not every relinked row points at an existing tenant of its own property';
  end if;
  select md5(string_agg(md5(ld::text), '' order by ld.id)) into v_other_after
    from public.lease_documents ld where ld.id <> all(v_doc);
  if v_other_after is distinct from v_other_before then
    raise exception '042 aborted: a lease_documents row outside the 53 changed';
  end if;
  select count(*) into v_unres_after from public.lease_documents d
   where d.tenant_id is not null and not exists (select 1 from public.tenants t where t.id = d.tenant_id);
  if v_unres_after <> v_unres_before - 53 then
    raise exception '042 aborted: unresolved rows went from % to %, not down by exactly 53', v_unres_before, v_unres_after;
  end if;
  if exists (select 1 from public.lease_documents where id = any(v_excluded) and legacy_tenant_id is not null) then
    raise exception '042 aborted: an excluded row was relinked';
  end if;
  if (select convalidated from pg_constraint
       where conrelid = 'public.lease_documents'::regclass and conname = 'lease_documents_leasehold_fk') then
    raise exception '042 aborted: the constraint became validated';
  end if;

  raise notice '042: relinked exactly 53 rows; % historical rows remain unresolved (constraint NOT VALID)', v_unres_after;
end $$;

commit;
