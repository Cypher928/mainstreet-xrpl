-- 045 live matrix on Pilot. ONE transaction that always ends in RAISE EXCEPTION,
-- so every fixture row, membership and write below is rolled back. Results travel
-- out in the exception message. Only the four mainstreet-test.local accounts are
-- written as; the one real account is used for a read-only count.
do $m$
declare
  OWNER  uuid := '1c682d8e-0fcb-42c9-9d91-95b9524bb113';  -- test account, admin of its own org, no properties
  EDITOR uuid := '6833ee9f-754d-41aa-8214-85652b3ef0ee';  -- test account → property_manager in OWNER's org (fixture)
  RO     uuid := '871e3646-ea87-4312-b27b-469e0bc0a03d';  -- test account → read_only in OWNER's org (fixture)
  OUTS   uuid := 'a8048989-1a8f-4891-b5e2-d985f5000915';  -- test account → stranger, then revoked, then unaccepted, then accepted
  REAL1  uuid := '011df998-bad2-464e-bbcb-28e2d0fee821';  -- real owner account, READ-ONLY count check
  ORG uuid; j jsonb; res text[] := '{}';
  pa uuid; ra uuid; pb uuid; rb uuid; fa uuid; da uuid; da2 uuid; fb uuid; dbb uuid; n int; t text; u uuid; o uuid; c1 int; c2 int; c3 int; c4 int;
begin
  create function pg_temp.as_user(uid uuid) returns void language plpgsql as $f$
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', uid::text, true);
    perform set_config('role', 'authenticated', true);
  end $f$;
  create function pg_temp.as_db() returns void language plpgsql as $f$
  begin
    perform set_config('role', 'none', true);
    perform set_config('request.jwt.claims', '', true);
    perform set_config('request.jwt.claim.sub', '', true);
  end $f$;

  -- ── fixtures (legitimate workflow: the owner begins two acquisitions) ──────
  perform pg_temp.as_user(OWNER);
  j := public.begin_acquisition('045 live matrix deal A', '{"totalSqFt":"1000"}'::jsonb); pa := (j->>'property_id')::uuid; ra := (j->>'review_id')::uuid;
  j := public.begin_acquisition('045 live matrix deal B', '{"totalSqFt":"1000"}'::jsonb); pb := (j->>'property_id')::uuid; rb := (j->>'review_id')::uuid;
  perform pg_temp.as_db();
  select organization_id into ORG from public.properties where id = pa;
  res := res || ('FX begin_acquisition as owner: property '||left(pa::text,8)||' org '||coalesce(left(ORG::text,8),'NULL')||' stage '||(select lifecycle_stage from public.properties where id = pa)||', review '||left(ra::text,8)||' status '||(select status from public.acquisition_reviews where id = ra));
  if ORG is null then raise exception 'fixture property has no organisation; matrix cannot run'; end if;
  insert into public.organization_members(organization_id, user_id, role, accepted_at) values (ORG, EDITOR, 'property_manager', now());
  insert into public.organization_members(organization_id, user_id, role, accepted_at) values (ORG, RO, 'read_only', now());
  -- the owner files one family + one document on deal A (legit)
  perform pg_temp.as_user(OWNER);
  insert into public.acquisition_document_families(review_id, user_id, property_id, label) values (ra, OWNER, pa, 'Fixture Tenant A') returning id into fa;
  insert into public.acquisition_documents(review_id, user_id, property_id, file_name, intake_id) values (ra, OWNER, pa, 'fixture-a.pdf', 'ik-fixture-a') returning id into da;
  perform pg_temp.as_db();
  res := res || ('FX owner filed family + document on deal A')::text;

  -- ── R · reads: every member reads, outsiders do not ──────────────────────
  perform pg_temp.as_user(OWNER);  select count(*) into c1 from public.properties where id = pa; select count(*) into c2 from public.acquisition_reviews where id = ra; perform pg_temp.as_db();
  res := res || ('R1 owner sees property/review: '||c1||'/'||c2||case when c1=1 and c2=1 then ' ok' else ' FAIL' end);
  perform pg_temp.as_user(EDITOR); select count(*) into c1 from public.properties where id = pa; select count(*) into c2 from public.acquisition_reviews where id = ra; select count(*) into c3 from public.acquisition_documents where id = da; perform pg_temp.as_db();
  res := res || ('R2 editor sees property/review/document: '||c1||'/'||c2||'/'||c3||case when c1=1 and c2=1 and c3=1 then ' ok' else ' FAIL' end);
  perform pg_temp.as_user(RO);     select count(*) into c1 from public.properties where id = pa; select count(*) into c2 from public.acquisition_reviews where id = ra; select count(*) into c3 from public.acquisition_documents where id = da; perform pg_temp.as_db();
  res := res || ('R3 read-only member sees property/review/document: '||c1||'/'||c2||'/'||c3||case when c1=1 and c2=1 and c3=1 then ' ok (reads kept)' else ' FAIL' end);
  perform pg_temp.as_user(OUTS);   select count(*) into c1 from public.properties where id = pa; select count(*) into c2 from public.acquisition_reviews where id = ra; perform pg_temp.as_db();
  res := res || ('R4 stranger sees property/review: '||c1||'/'||c2||case when c1=0 and c2=0 then ' ok' else ' FAIL' end);
  begin
    perform set_config('role', 'anon', true);
    select count(*) into c1 from public.properties;
    res := res || ('R5 FAIL: anon read properties ('||c1||' rows)');
  exception when others then res := res || ('R5 anon read of properties refused: '||sqlstate||' '||left(sqlerrm, 60)||' ok'); end;
  perform pg_temp.as_db();

  -- ── W · review updates ────────────────────────────────────────────────────
  perform pg_temp.as_user(OWNER);  update public.acquisition_reviews set name = name where id = ra; get diagnostics n = row_count; perform pg_temp.as_db();
  res := res || ('W1 owner updates review: '||n||' row'||case when n=1 then ' ok' else ' FAIL' end);
  perform pg_temp.as_user(EDITOR); update public.acquisition_reviews set name = name where id = ra; get diagnostics n = row_count; perform pg_temp.as_db();
  res := res || ('W2 editor updates review: '||n||' row'||case when n=1 then ' ok' else ' FAIL' end);
  perform pg_temp.as_user(RO);     update public.acquisition_reviews set name = name where id = ra; get diagnostics n = row_count; perform pg_temp.as_db();
  res := res || ('W3 read-only member updates review: '||n||' rows'||case when n=0 then ' ok (refused)' else ' FAIL' end);
  perform pg_temp.as_user(OUTS);   update public.acquisition_reviews set name = name where id = ra; get diagnostics n = row_count; perform pg_temp.as_db();
  res := res || ('W4 stranger updates review: '||n||' rows'||case when n=0 then ' ok (refused)' else ' FAIL' end);

  -- ── D · documents: editors insert as themselves; forged authorship refused ──
  begin
    perform pg_temp.as_user(EDITOR);
    insert into public.acquisition_documents(review_id, user_id, property_id, file_name, intake_id) values (ra, EDITOR, pa, 'editor.pdf', 'ik-editor') returning id into da2;
    res := res || ('D1 editor inserts a document as themselves: ok')::text;
  exception when others then res := res || ('D1 FAIL: editor insert refused — '||sqlstate||' '||left(sqlerrm, 90)); end;
  perform pg_temp.as_db();
  begin
    perform pg_temp.as_user(RO);
    insert into public.acquisition_documents(review_id, user_id, property_id, file_name, intake_id) values (ra, RO, pa, 'ro.pdf', 'ik-ro');
    res := res || ('D2 FAIL: read-only member inserted a document')::text;
  exception when others then res := res || ('D2 read-only member insert refused: '||sqlstate||' '||left(sqlerrm, 70)||' ok'); end;
  perform pg_temp.as_db();
  begin
    perform pg_temp.as_user(OUTS);
    insert into public.acquisition_documents(review_id, user_id, property_id, file_name, intake_id) values (ra, OUTS, pa, 'outs.pdf', 'ik-outs');
    res := res || ('D3 FAIL: stranger inserted a document')::text;
  exception when others then res := res || ('D3 stranger insert refused: '||sqlstate||' '||left(sqlerrm, 70)||' ok'); end;
  perform pg_temp.as_db();
  begin
    perform pg_temp.as_user(EDITOR);
    insert into public.acquisition_documents(review_id, user_id, property_id, file_name, intake_id) values (ra, OWNER, pa, 'forged.pdf', 'ik-forged');
    res := res || ('D4 FAIL: editor inserted a document in the OWNER''s name')::text;
  exception when others then res := res || ('D4 forged author (document user_id = owner) refused: '||sqlstate||' '||left(sqlerrm, 90)||' ok'); end;
  perform pg_temp.as_db();
  begin
    perform pg_temp.as_user(EDITOR);
    update public.acquisition_documents set user_id = EDITOR where id = da; get diagnostics n = row_count;
    res := res || ('D5 FAIL: editor re-authored the owner''s document ('||n||' row)');
  exception when others then res := res || ('D5 changing a document''s user_id refused: '||sqlstate||' '||left(sqlerrm, 80)||' ok'); end;
  perform pg_temp.as_db();
  begin
    perform pg_temp.as_user(EDITOR);
    insert into public.acquisition_reviews(name, user_id, property_id, status) values ('forged review', OWNER, pa, 'draft');
    res := res || ('RV1 FAIL: editor inserted a review in the OWNER''s name')::text;
  exception when others then res := res || ('RV1 forged author (review user_id = owner) refused: '||sqlstate||' '||left(sqlerrm, 90)||' ok'); end;
  perform pg_temp.as_db();

  -- ── F/T · families and term decisions ─────────────────────────────────────
  begin
    perform pg_temp.as_user(EDITOR);
    insert into public.acquisition_document_families(review_id, user_id, property_id, label) values (ra, EDITOR, pa, 'Editor Family') returning id into fb;
    res := res || ('F1 editor inserts a family: ok')::text;
  exception when others then res := res || ('F1 FAIL: editor family refused — '||sqlstate||' '||left(sqlerrm, 90)); end;
  perform pg_temp.as_db();
  begin
    perform pg_temp.as_user(RO);
    insert into public.acquisition_document_families(review_id, user_id, property_id, label) values (ra, RO, pa, 'RO Family');
    res := res || ('F2 FAIL: read-only member inserted a family')::text;
  exception when others then res := res || ('F2 read-only member family refused: '||sqlstate||' '||left(sqlerrm, 70)||' ok'); end;
  perform pg_temp.as_db();
  begin
    perform pg_temp.as_user(EDITOR);
    insert into public.acquisition_term_decisions(review_id, user_id, property_id, family_id, field_key, action, new_value, decided_by) values (ra, EDITOR, pa, fb, 'leased_sqft', 'confirm', '500', EDITOR);
    res := res || ('T1 editor records a term decision as themselves: ok')::text;
  exception when others then res := res || ('T1 FAIL: editor decision refused — '||sqlstate||' '||left(sqlerrm, 90)); end;
  perform pg_temp.as_db();
  begin
    perform pg_temp.as_user(EDITOR);
    insert into public.acquisition_term_decisions(review_id, user_id, property_id, family_id, field_key, action, new_value, decided_by) values (ra, EDITOR, pa, fb, 'leased_sqft', 'confirm', '500', OWNER);
    res := res || ('T2 FAIL: editor recorded a decision as decided_by = owner')::text;
  exception when others then res := res || ('T2 forged decided_by refused: '||sqlstate||' '||left(sqlerrm, 80)||' ok'); end;
  perform pg_temp.as_db();
  begin
    perform pg_temp.as_user(RO);
    insert into public.acquisition_term_decisions(review_id, user_id, property_id, family_id, field_key, action, new_value, decided_by) values (ra, RO, pa, fb, 'leased_sqft', 'confirm', '500', RO);
    res := res || ('T3 FAIL: read-only member recorded a decision')::text;
  exception when others then res := res || ('T3 read-only member decision refused: '||sqlstate||' '||left(sqlerrm, 70)||' ok'); end;
  perform pg_temp.as_db();

  -- ── S · a document's stored-file path is set once ─────────────────────────
  perform pg_temp.as_user(OWNER); update public.acquisition_documents set storage_path = 'leases/'||OWNER||'/acq_'||ra||'_fixture-a.pdf' where id = da; get diagnostics n = row_count; perform pg_temp.as_db();
  res := res || ('S1 owner sets storage_path the first time: '||n||' row'||case when n=1 then ' ok' else ' FAIL' end);
  begin
    perform pg_temp.as_user(OWNER); update public.acquisition_documents set storage_path = 'leases/elsewhere.pdf' where id = da;
    res := res || ('S2 FAIL: owner re-pointed storage_path')::text;
  exception when others then res := res || ('S2 re-pointing storage_path refused: '||sqlstate||' '||left(sqlerrm, 80)||' ok'); end;
  perform pg_temp.as_db();
  begin
    perform pg_temp.as_user(OWNER); update public.acquisition_documents set storage_path = null where id = da;
    res := res || ('S3 FAIL: owner cleared storage_path')::text;
  exception when others then res := res || ('S3 clearing storage_path refused: '||sqlstate||' '||left(sqlerrm, 80)||' ok'); end;
  perform pg_temp.as_db();
  begin
    update public.acquisition_documents set storage_path = 'leases/elsewhere.pdf' where id = da;
    res := res || ('S4 FAIL: postgres (no signed-in person) re-pointed storage_path')::text;
  exception when others then res := res || ('S4 re-pointing storage_path refused even without a signed-in person: '||sqlstate||' ok'); end;

  -- ── C · conversion only inside acquire_property ───────────────────────────
  begin
    perform pg_temp.as_user(OWNER); update public.acquisition_reviews set status = 'converted', converted_at = now() where id = ra;
    res := res || ('C1 FAIL: owner marked the review converted directly')::text;
  exception when others then res := res || ('C1 direct conversion by owner refused: '||sqlstate||' '||left(sqlerrm, 90)||' ok'); end;
  perform pg_temp.as_db();
  begin
    perform pg_temp.as_user(OWNER); update public.acquisition_reviews set converted_at = now() where id = ra;
    res := res || ('C2 FAIL: owner stamped converted_at directly')::text;
  exception when others then res := res || ('C2 stamping converted_at refused: '||sqlstate||' ok'); end;
  perform pg_temp.as_db();
  begin
    update public.acquisition_reviews set status = 'converted', converted_at = now() where id = ra;
    res := res || ('C3 FAIL: postgres marked the review converted directly')::text;
  exception when others then res := res || ('C3 direct conversion without a signed-in person refused: '||sqlstate||' ok'); end;
  begin
    perform pg_temp.as_user(OWNER); insert into public.acquisition_reviews(name, user_id, property_id, status) values ('born converted', OWNER, pa, 'converted');
    res := res || ('C4 FAIL: a review was created already converted')::text;
  exception when others then res := res || ('C4 creating a review already converted refused: '||sqlstate||' '||left(sqlerrm, 70)||' ok'); end;
  perform pg_temp.as_db();

  -- ── P · properties: editors edit, ownership never moves ───────────────────
  perform pg_temp.as_user(EDITOR); update public.properties set name = name where id = pa; get diagnostics n = row_count; perform pg_temp.as_db();
  res := res || ('P1 editor updates property: '||n||' row'||case when n=1 then ' ok' else ' FAIL' end);
  perform pg_temp.as_user(RO);     update public.properties set name = name where id = pa; get diagnostics n = row_count; perform pg_temp.as_db();
  res := res || ('P2 read-only member updates property: '||n||' rows'||case when n=0 then ' ok (refused)' else ' FAIL' end);
  begin
    perform pg_temp.as_user(EDITOR); update public.properties set user_id = EDITOR, organization_id = null where id = pa; get diagnostics n = row_count; perform pg_temp.as_db();
    select user_id, organization_id into u, o from public.properties where id = pa;
    res := res || ('P3 editor''s save tried to take ownership: statement touched '||n||' row; owner kept='||(u = OWNER)||' org kept='||(o = ORG)||case when u = OWNER and o = ORG then ' ok' else ' FAIL' end);
  exception when others then res := res || ('P3 UNEXPECTED ERROR: '||sqlstate||' '||left(sqlerrm, 90)); end;
  perform pg_temp.as_db();

  -- ── U/L · TRUNCATE and direct ledger inserts ──────────────────────────────
  perform pg_temp.as_user(OWNER);
  begin truncate public.acquisition_documents;
    res := res || ('U1 FAIL: a signed-in person truncated acquisition_documents')::text;
  exception when others then res := res || ('U1 TRUNCATE by a signed-in person refused: '||sqlstate||' '||left(sqlerrm, 60)||' ok'); end;
  perform pg_temp.as_db();
  perform pg_temp.as_user(OWNER);
  begin truncate public.properties;
    res := res || ('U2 FAIL: a signed-in person truncated properties')::text;
  exception when others then res := res || ('U2 TRUNCATE properties refused: '||sqlstate||' ok'); end;
  perform pg_temp.as_db();
  begin
    perform pg_temp.as_user(OWNER); insert into public.financial_sources default values;
    res := res || ('L1 FAIL: a signed-in person inserted into financial_sources')::text;
  exception when others then res := res || ('L1 direct insert into financial_sources refused: '||sqlstate||' '||left(sqlerrm, 60)||' ok'); end;
  perform pg_temp.as_db();
  begin
    perform pg_temp.as_user(OWNER); insert into public.gl_entries default values;
    res := res || ('L2 FAIL: a signed-in person inserted into gl_entries')::text;
  exception when others then res := res || ('L2 direct insert into gl_entries refused: '||sqlstate||' '||left(sqlerrm, 60)||' ok'); end;
  perform pg_temp.as_db();

  -- ── V · revoked and unaccepted memberships ────────────────────────────────
  insert into public.organization_members(organization_id, user_id, role, accepted_at, revoked_at) values (ORG, OUTS, 'property_manager', now(), now());
  perform pg_temp.as_user(OUTS); select count(*) into c1 from public.properties where id = pa; perform pg_temp.as_db();
  begin
    perform pg_temp.as_user(OUTS); insert into public.acquisition_documents(review_id, user_id, property_id, file_name, intake_id) values (ra, OUTS, pa, 'revoked.pdf', 'ik-revoked');
    res := res || ('V2 FAIL: revoked member inserted a document')::text;
  exception when others then res := res || ('V1 revoked member sees property: '||c1||case when c1=0 then ' ok' else ' FAIL' end||' | V2 revoked member insert refused: '||sqlstate||' ok'); end;
  perform pg_temp.as_db();
  update public.organization_members set accepted_at = null, revoked_at = null where organization_id = ORG and user_id = OUTS;
  perform pg_temp.as_user(OUTS); select count(*) into c1 from public.properties where id = pa; perform pg_temp.as_db();
  begin
    perform pg_temp.as_user(OUTS); insert into public.acquisition_documents(review_id, user_id, property_id, file_name, intake_id) values (ra, OUTS, pa, 'unaccepted.pdf', 'ik-unaccepted');
    res := res || ('V4 FAIL: unaccepted member inserted a document')::text;
  exception when others then res := res || ('V3 unaccepted member sees property: '||c1||case when c1=0 then ' ok' else ' FAIL' end||' | V4 unaccepted member insert refused: '||sqlstate||' ok'); end;
  perform pg_temp.as_db();
  update public.organization_members set accepted_at = now() where organization_id = ORG and user_id = OUTS;
  begin
    perform pg_temp.as_user(OUTS); insert into public.acquisition_documents(review_id, user_id, property_id, file_name, intake_id) values (ra, OUTS, pa, 'accepted.pdf', 'ik-accepted');
    res := res || ('V5 the same account, once accepted as property_manager, inserts a document: ok (membership is what gates)')::text;
  exception when others then res := res || ('V5 FAIL: accepted editor refused — '||sqlstate||' '||left(sqlerrm, 90)); end;
  perform pg_temp.as_db();

  -- ── RA · a real owner account, read-only: sees exactly their own records ──
  select count(*) into c1 from public.properties where user_id = REAL1; select count(*) into c2 from public.acquisition_reviews where user_id = REAL1;
  perform pg_temp.as_user(REAL1); select count(*) into c3 from public.properties; select count(*) into c4 from public.acquisition_reviews; perform pg_temp.as_db();
  res := res || ('RA1 real owner account reads properties/reviews: visible '||c3||'/'||c4||' vs owned '||c1||'/'||c2||case when c1=c3 and c2=c4 then ' ok' else ' CHECK' end);

  -- ── C5/C6 · legitimate conversion of deal B by its owner ──────────────────
  begin
    perform pg_temp.as_user(OWNER);
    insert into public.acquisition_document_families(review_id, user_id, property_id, label) values (rb, OWNER, pb, 'Convert Tenant') returning id into fb;
    insert into public.acquisition_documents(review_id, user_id, property_id, file_name, intake_id, family_id, family_status, doc_type, doc_type_status, doc_type_source, confirmed_by, confirmed_at, storage_path)
      values (rb, OWNER, pb, 'conv.pdf', 'ik-conv', fb, 'confirmed', 'original_lease', 'confirmed', 'human', OWNER, now(), 'leases/'||OWNER||'/acq_'||rb||'_conv.pdf') returning id into dbb;
    insert into public.acquisition_term_decisions(review_id, user_id, property_id, family_id, field_key, action, new_value, decided_by) values (rb, OWNER, pb, fb, 'leased_sqft', 'confirm', '500', OWNER);
    j := public.acquire_property(pb, rb, jsonb_build_object(
           'roster', jsonb_build_array(jsonb_build_object('id', fb, 'family_id', fb, 'property_id', pb, 'review_id', rb, 'tenant_name', 'Convert Tenant', 'leased_sqft', '500', 'cap', null, 'start_date', null, 'end_date', null, 'lease_type', null)),
           'propertyName', '045 live matrix deal B', 'occupancyAtAcquisition', 100, 'waltAtAcquisition', 0));
    perform pg_temp.as_db();
    select r.status||'|'||(r.converted_at is not null)::text||'|'||p.lifecycle_stage||'|tenants='||(select count(*) from public.tenants t where t.property_id = pb)::text into t
      from public.acquisition_reviews r join public.properties p on p.id = r.property_id where r.id = rb;
    res := res || ('C5 acquire_property as owner: '||t||case when t like 'converted|true|acquired|tenants=1' then ' ok (conversion guard admits the real path)' else ' CHECK' end);
  exception when others then perform pg_temp.as_db(); res := res || ('C5 FAIL: acquire_property refused — '||sqlstate||' '||left(sqlerrm, 160)); end;
  begin
    perform pg_temp.as_user(OWNER); update public.acquisition_reviews set data = data || '{"x":1}'::jsonb where id = rb; get diagnostics n = row_count;
    res := res || ('C6 FAIL: converted review was edited ('||n||' row)');
  exception when others then res := res || ('C6 converted review stays frozen (036): '||sqlstate||' '||left(sqlerrm, 60)||' ok'); end;
  perform pg_temp.as_db();

  -- ── X · deletion: editors cannot delete; the owner''s delete cascades ──────
  perform pg_temp.as_user(EDITOR); begin delete from public.acquisition_reviews where id = ra; get diagnostics n = row_count; end; perform pg_temp.as_db();
  res := res || ('X1 editor deletes review: '||n||' rows'||case when n=0 then ' ok (refused)' else ' FAIL' end);
  perform pg_temp.as_user(RO);     begin delete from public.acquisition_reviews where id = ra; get diagnostics n = row_count; end; perform pg_temp.as_db();
  res := res || ('X2 read-only member deletes review: '||n||' rows'||case when n=0 then ' ok (refused)' else ' FAIL' end);
  perform pg_temp.as_user(EDITOR); begin delete from public.properties where id = pa; get diagnostics n = row_count; end; perform pg_temp.as_db();
  res := res || ('X3 editor deletes property: '||n||' rows'||case when n=0 then ' ok (refused)' else ' FAIL' end);
  begin
    perform pg_temp.as_user(RO); perform public.delete_prospect_acquisition(ra);
    res := res || ('X4 FAIL: read-only member deleted the acquisition through the RPC')::text;
  exception when others then res := res || ('X4 delete_prospect_acquisition by read-only member refused: '||sqlstate||' '||left(sqlerrm, 80)||' ok'); end;
  perform pg_temp.as_db();
  select count(*) into c1 from public.acquisition_documents where review_id = ra; select count(*) into c2 from public.acquisition_document_families where review_id = ra; select count(*) into c3 from public.acquisition_term_decisions where review_id = ra;
  res := res || ('X5 before the owner deletes deal A: documents '||c1||', families '||c2||', decisions '||c3);
  begin
    perform pg_temp.as_user(OWNER); perform public.delete_prospect_acquisition(ra); perform pg_temp.as_db();
    select count(*) into c1 from public.acquisition_documents where review_id = ra; select count(*) into c2 from public.acquisition_document_families where review_id = ra; select count(*) into c3 from public.acquisition_term_decisions where review_id = ra;
    select count(*) into c4 from public.acquisition_reviews where id = ra; select count(*) into n from public.properties where id = pa;
    res := res || ('X6 owner deletes deal A through delete_prospect_acquisition: review left '||c4||', property left '||n||', documents '||c1||', families '||c2||', decisions '||c3||case when c4=0 and n=0 and c1=0 and c2=0 and c3=0 then ' ok (cascade complete)' else ' CHECK' end);
  exception when others then perform pg_temp.as_db(); res := res || ('X6 FAIL: owner delete refused — '||sqlstate||' '||left(sqlerrm, 120)); end;

  raise exception using message = E'MATRIX RESULTS (everything rolled back)\n' || array_to_string(res, E'\n'), errcode = 'P0001';
end $m$;
