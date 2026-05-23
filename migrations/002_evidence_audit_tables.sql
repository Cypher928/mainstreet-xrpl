-- tenant_field_evidence + tenant_review_audit
-- Phase 1 normalization: dual-write alongside existing JSON blob in properties.data.
-- Safe to re-run. DO NOT drop properties.data -- JSON blob persistence stays active.
-- Rollback: drop table public.tenant_review_audit cascade;
--           drop table public.tenant_field_evidence cascade;


-- TABLE: tenant_field_evidence
-- One row per evidence snapshot. Mirrors t.fieldEvidence[key].snapshots[].

create table if not exists public.tenant_field_evidence (
  id                       uuid        primary key default gen_random_uuid(),
  property_id              uuid        not null references public.properties(id) on delete cascade,
  tenant_id                text        not null,
  field_key                text        not null,
  value                    text,
  confidence_status        text        check (confidence_status in ('verified','estimated','missing')),
  confidence_note          text,
  source_file              text,
  source_page              integer,
  extraction_id            text,
  extraction_version       text,
  reviewer_uid             text,
  reviewer_email           text,
  reviewed_at              timestamptz,
  approved                 boolean     not null default false,
  manually_edited          boolean     not null default false,
  original_extracted_value text,
  created_at               timestamptz not null default now(),
  constraint tenant_field_evidence_dedup unique (tenant_id, field_key, reviewed_at)
);

create index if not exists tfe_property_id_idx      on public.tenant_field_evidence (property_id);
create index if not exists tfe_tenant_id_idx        on public.tenant_field_evidence (tenant_id);
create index if not exists tfe_field_key_idx        on public.tenant_field_evidence (field_key);
create index if not exists tfe_created_at_idx       on public.tenant_field_evidence (created_at desc);
create index if not exists tfe_tenant_field_time_idx on public.tenant_field_evidence (tenant_id, field_key, created_at desc);


-- TABLE: tenant_review_audit
-- One row per reviewer action. Mirrors activityLog[type='field_review_audit'].

create table if not exists public.tenant_review_audit (
  id                  uuid        primary key default gen_random_uuid(),
  property_id         uuid        not null references public.properties(id) on delete cascade,
  tenant_id           text        not null,
  field_key           text,
  action              text        not null,
  label               text,
  severity            text        not null default 'info' check (severity in ('info','success','warning','error')),
  old_value           text,
  new_value           text,
  review_state_before text,
  review_state_after  text,
  reviewer_uid        text,
  reviewer_email      text,
  client_ts           timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  constraint tenant_review_audit_dedup unique (tenant_id, action, client_ts)
);

create index if not exists tra_property_id_idx on public.tenant_review_audit (property_id);
create index if not exists tra_tenant_id_idx   on public.tenant_review_audit (tenant_id);
create index if not exists tra_field_key_idx   on public.tenant_review_audit (field_key) where field_key is not null;
create index if not exists tra_created_at_idx  on public.tenant_review_audit (created_at desc);
create index if not exists tra_tenant_time_idx on public.tenant_review_audit (tenant_id, client_ts desc);


-- RLS

alter table public.tenant_field_evidence enable row level security;
alter table public.tenant_review_audit   enable row level security;

grant usage  on schema public to authenticated;
grant usage  on schema public to service_role;
grant select, insert, update, delete on public.tenant_field_evidence to authenticated;
grant select, insert, update, delete on public.tenant_field_evidence to service_role;
grant select, insert, update, delete on public.tenant_review_audit   to authenticated;
grant select, insert, update, delete on public.tenant_review_audit   to service_role;


-- POLICIES: tenant_field_evidence

drop policy if exists "tfe_owner_all"        on public.tenant_field_evidence;
drop policy if exists "tfe_service_role_all" on public.tenant_field_evidence;

create policy "tfe_owner_all"
  on public.tenant_field_evidence
  for all to authenticated
  using      (exists (select 1 from public.properties p where p.id = tenant_field_evidence.property_id and p.user_id = auth.uid()))
  with check (exists (select 1 from public.properties p where p.id = tenant_field_evidence.property_id and p.user_id = auth.uid()));

create policy "tfe_service_role_all"
  on public.tenant_field_evidence
  for all to service_role using (true) with check (true);


-- POLICIES: tenant_review_audit

drop policy if exists "tra_owner_all"        on public.tenant_review_audit;
drop policy if exists "tra_service_role_all" on public.tenant_review_audit;

create policy "tra_owner_all"
  on public.tenant_review_audit
  for all to authenticated
  using      (exists (select 1 from public.properties p where p.id = tenant_review_audit.property_id and p.user_id = auth.uid()))
  with check (exists (select 1 from public.properties p where p.id = tenant_review_audit.property_id and p.user_id = auth.uid()));

create policy "tra_service_role_all"
  on public.tenant_review_audit
  for all to service_role using (true) with check (true);


-- VERIFY (should return 0 rows each, not an error)

select count(*) from public.tenant_field_evidence;
select count(*) from public.tenant_review_audit;
