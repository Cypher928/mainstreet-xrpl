'use strict';
/**
 * tools/verify-migration-048.js — run 048 (the eight operating tables follow
 * 045's rule; evidence and audit append-only for signed-in people; invitations
 * admin-only) for real, against nothing that matters.
 *
 *   node tools/verify-migration-048.js
 *   MS_PG_SERVER_BIN=/path/to/pg17/bin node tools/verify-migration-048.js
 *
 * It touches NO Supabase project. It builds a throwaway PostgreSQL cluster,
 * stands up verify-migration-036.js's Pilot-shaped stand-ins, the eight tables
 * as 001–003, 012–015b, 017/018b and phase0/024 left them (their rules and
 * grants copied from those texts; the live catalog is read in the calibration
 * phase), the Pilot marker, and installs 032–036, 044, phase0/029, 037, 039, 038, 045
 * and 047 from their files.
 *
 * WHAT IT PROVES
 *   0  BEFORE 048 every gap is real: a read-only member writes leaseholds, jobs,
 *      evidence, audit rows, CAM results and statements; anon holds TRUNCATE on
 *      the five older tables
 *   1  048 applies, applies again, refuses a database without the Pilot marker
 *      or without 045, and changes only what it says it changes
 *   2  THE MATRIX — for every table and every kind of caller (owner, editor,
 *      organisation admin, read-only member, tenant user, revoked member,
 *      stranger, anon) and every operation (read, insert, update, delete), the
 *      outcome is exactly the one the header promises; reads are unchanged
 *   3  tenant users keep exactly their reads and gain no write
 *   4  append-only: evidence and audit rows cannot be changed or removed by any
 *      signed-in person, owner included; the server still can
 *   5  the workflows around them: the browser's INSERT … ON CONFLICT DO NOTHING
 *      for evidence and audit, lease job upsert and update, resync, the 038
 *      lifecycle functions, accept-invite's upsert, statement publication
 *   6  ROLLBACK restores the catalog exactly and the old behaviour returns;
 *      048 applies again to the same catalog
 *
 * SKIPS (exit 0) when no local PostgreSQL server binary is present, and says so
 * loudly — a skip is not a pass and must not read like one.
 */
const fs = require('fs');
const path = require('path');
const { startCluster, tally } = require('./_pg-throwaway');

const ROOT = path.join(__dirname, '..');
const MIG  = path.join(ROOT, 'migrations');
const FILES = ['032_resync_property_tenants_property_bound', '033_property_lifecycle_integrity', '034_property_at_new_acquisition',
               '035_acquire_property', '036_acquisition_episode_frozen', '044_acquisition_conversion_safeguards']
  .map(n => [n.slice(0, 3), path.join(MIG, n + '.sql')]);
const M029 = path.join(MIG, 'phase0', '029_financial_tables.sql');
const M037 = path.join(MIG, '037_leasehold_lifecycle.sql');
const M039 = path.join(MIG, '039_register_leasehold_link.sql');
const M038 = path.join(MIG, '038_leasehold_protection.sql');
const M045 = path.join(MIG, '045_acquisition_member_write_rules.sql');
const M047 = path.join(MIG, '047_member_write_rules_remaining.sql');
const M048 = path.join(MIG, '048_operating_tables_member_write_rules.sql');
const R048 = path.join(MIG, '048_operating_tables_member_write_rules_rollback.sql');
const MARKER = 'fd9c09b1-b657-4c58-9999-c3cce28e7600';

const T = tally();
const { check, section } = T;

console.log('\n══ migration 048 (operating tables: members read, editors write; evidence and audit append-only; invitations admin-only) — executed against a throwaway cluster ══');
console.log('   NO Supabase project is contacted by this script.');
const pg = startCluster('048');
console.log('   server: ' + pg.serverVersion() + '  (' + pg.SERVER_BIN + ')');

const A = '11111111-1111-4111-8111-111111111111';   // owner of the deals, admin of O1
const M = '33333333-3333-4333-8333-333333333333';   // property_manager in O1 — an editor
const D = '55555555-5555-4555-8555-555555555555';   // admin of O1 who owns nothing
const R = '44444444-4444-4444-8444-444444444444';   // read_only in O1
const S = '22222222-2222-4222-8222-222222222222';   // stranger, admin of O2
const Z = '66666666-6666-4666-8666-666666666666';   // admin of O3 (owns the marker)
const V = '77777777-7777-4777-8777-777777777777';   // property_manager in O1, revoked
const U = '88888888-8888-4888-8888-888888888888';   // property_manager in O1, never accepted
const TU = '99999999-9999-4999-8999-999999999999';  // a TENANT user: accepted membership on tenant T1 of the working property
const O1 = 'c1c1c1c1-0000-4000-8000-000000000001', O2 = 'c2c2c2c2-0000-4000-8000-000000000002', O3 = 'c3c3c3c3-0000-4000-8000-000000000003';

const V036 = fs.readFileSync(path.join(__dirname, 'verify-migration-036.js'), 'utf8');
const SCHEMA = (() => {
  const a = V036.indexOf('const SCHEMA = `') + 'const SCHEMA = `'.length;
  const b = V036.indexOf('`;\n\nconst q =', a);
  if (a < 20 || b < a) throw new Error('could not read SCHEMA from verify-migration-036.js');
  // eslint-disable-next-line no-new-func
  return new Function('A', 'M', 'D', 'R', 'S', 'Z', 'O1', 'O2', 'O3', 'return `' + V036.slice(a, b) + '`;')(A, M, D, R, S, Z, O1, O2, O3);
})();
const V046 = fs.readFileSync(path.join(__dirname, 'verify-migration-046.js'), 'utf8');
const STORAGE = (() => {
  const a = V046.indexOf('const STORAGE = `'), b = V046.indexOf('`;\n', a);
  // eslint-disable-next-line no-new-func
  return new Function('A', 'V', 'O1', 'MARKER', 'Z', V046.slice(a, b + 2) + ' return STORAGE;')(A, V, O1, MARKER, Z);
})();
const MEMBER = '(property_id in (select public.member_property_ids()))';
// The eight tables as their migrations and phase0/024 left them. The stand-in
// schema already has tenants (024 rule), cam_reconciliations and
// tenant_field_evidence without rules; the rest are created here. Column lists
// are the ones the checks below need; every rule and grant is copied from the
// migration text named beside it.
const EXTRA = `
  insert into auth.users(id) values ('${V}'),('${U}'),('${TU}');
  insert into public.organization_members(organization_id,user_id,role,accepted_at,revoked_at) values
    ('${O1}','${V}','property_manager',now(),now()),('${O1}','${U}','property_manager',null,null);
  insert into public.properties(id,user_id,name) values ('${MARKER}','${Z}','Pilot marker (stand-in)');
  create table public.lease_documents (id uuid primary key default gen_random_uuid(), property_id uuid not null references public.properties(id) on delete cascade, tenant_id uuid, file_name text,
    created_at timestamptz not null default now(), updated_at timestamptz not null default now());
  alter table public.lease_documents enable row level security;
  create policy "lease_docs_owner_all" on public.lease_documents for all to authenticated using ${MEMBER} with check ${MEMBER};
  alter table public.organization_members enable row level security;
  create policy organization_members_self_select on public.organization_members for select to authenticated using (user_id = auth.uid());
  -- 012: tenant_users (the composite key tenants_id_property_uniq is already in the stand-in) + the authorisation primitive + the tenant read on tenants
  create table public.tenant_users (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
    tenant_id uuid not null, property_id uuid not null references public.properties(id) on delete cascade, invited_by uuid, invited_at timestamptz not null default now(),
    accepted_at timestamptz, revoked_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
    constraint tenant_users_user_tenant_uniq unique (user_id, tenant_id),
    constraint tenant_users_tenant_property_fk foreign key (tenant_id, property_id) references public.tenants(id, property_id) on delete cascade);
  create or replace function public.tenant_ids_for_current_user() returns setof uuid language sql security definer stable set search_path = '' as $f$
    select tu.tenant_id from public.tenant_users tu where tu.user_id = auth.uid() and tu.accepted_at is not null and tu.revoked_at is null $f$;
  revoke all on function public.tenant_ids_for_current_user() from public, anon;
  grant execute on function public.tenant_ids_for_current_user() to authenticated;
  alter table public.tenant_users enable row level security;
  create policy tenant_users_self_select on public.tenant_users for select to authenticated using (user_id = auth.uid() and accepted_at is not null and revoked_at is null);   -- 015
  create policy tenant_users_landlord_all on public.tenant_users for all to authenticated using ${MEMBER} with check ${MEMBER};   -- 024
  create policy tenant_users_service_role_all on public.tenant_users for all to service_role using (true) with check (true);
  create policy tenants_tenant_self_select on public.tenants for select to authenticated using (id in (select public.tenant_ids_for_current_user()));
  -- 014: tenant_invitations (email as text here; Pilot's is citext)
  create table public.tenant_invitations (id uuid primary key default gen_random_uuid(), tenant_id uuid not null, property_id uuid not null, email text not null,
    token_hash text not null unique, invited_by uuid not null references auth.users(id) on delete cascade, invited_at timestamptz not null default now(),
    expires_at timestamptz not null default now() + interval '14 days', accepted_at timestamptz, accepted_by uuid, revoked_at timestamptz, created_at timestamptz not null default now(),
    constraint tenant_invitations_tenant_property_fk foreign key (tenant_id, property_id) references public.tenants(id, property_id) on delete cascade);
  alter table public.tenant_invitations enable row level security;
  create policy tenant_invitations_landlord_all on public.tenant_invitations for all to authenticated using ${MEMBER} with check ${MEMBER};   -- 024
  create policy tenant_invitations_service_role_all on public.tenant_invitations for all to service_role using (true) with check (true);
  -- 015b grants
  revoke all on public.tenant_users from anon, authenticated, service_role;
  grant select on public.tenant_users to authenticated;
  grant select, insert, update, delete on public.tenant_users to service_role;
  revoke all on public.tenant_invitations from anon, authenticated, service_role;
  grant select, update on public.tenant_invitations to service_role;
  -- 001: lease_jobs
  create table public.lease_jobs (id uuid primary key default gen_random_uuid(), status text not null default 'queued', stage text not null default 'upload',
    file_name text, property_id uuid references public.properties(id) on delete cascade, tenant_id uuid references public.tenants(id) on delete set null,
    created_at timestamptz not null default now(), updated_at timestamptz not null default now());
  alter table public.lease_jobs enable row level security;
  create policy "lease_jobs_owner_all" on public.lease_jobs for all to authenticated using ${MEMBER} with check ${MEMBER};   -- 024
  create policy "lease_jobs_service_role_all" on public.lease_jobs for all to service_role using (true) with check (true);
  -- 002: evidence (the stand-in table exists) + audit
  alter table public.tenant_field_evidence add column reviewed_at timestamptz, add column value text, add column created_at timestamptz not null default now(),
    add constraint tfe_property_fk foreign key (property_id) references public.properties(id) on delete cascade;   -- 002
  alter table public.tenant_field_evidence add constraint tenant_field_evidence_dedup unique (tenant_id, field_key, reviewed_at);
  alter table public.tenant_field_evidence enable row level security;
  create policy "tfe_owner_all" on public.tenant_field_evidence for all to authenticated using ${MEMBER} with check ${MEMBER};   -- 024
  create policy "tfe_service_role_all" on public.tenant_field_evidence for all to service_role using (true) with check (true);
  create table public.tenant_review_audit (id uuid primary key default gen_random_uuid(), property_id uuid not null references public.properties(id) on delete cascade,
    tenant_id text not null, field_key text, action text not null, label text, severity text not null default 'info', client_ts timestamptz not null default now(),
    created_at timestamptz not null default now(), constraint tenant_review_audit_dedup unique (tenant_id, action, client_ts));
  alter table public.tenant_review_audit enable row level security;
  create policy "tra_owner_all" on public.tenant_review_audit for all to authenticated using ${MEMBER} with check ${MEMBER};   -- 024
  create policy "tra_service_role_all" on public.tenant_review_audit for all to service_role using (true) with check (true);
  -- 003: cam_reconciliations (the stand-in table exists)
  alter table public.cam_reconciliations add column actual_cam numeric, add column created_at timestamptz not null default now(),
    add constraint cam_recon_property_fk foreign key (property_id) references public.properties(id) on delete cascade;   -- 003
  alter table public.cam_reconciliations enable row level security;
  create policy "cam_recon_owner_all" on public.cam_reconciliations for all to authenticated using ${MEMBER} with check ${MEMBER};   -- 024
  create policy "cam_recon_service_role_all" on public.cam_reconciliations for all to service_role using (true) with check (true);
  -- 017 (claude/b2-tenant-portal) + 018b + 024: tenant_statements
  create table public.tenant_statements (id uuid primary key default gen_random_uuid(), tenant_id uuid not null, property_id uuid not null, cam_year integer not null,
    version integer not null default 1, allocated_amount numeric(14,2) not null default 0, statement_json jsonb not null default '{}'::jsonb,
    status text not null default 'draft' check (status in ('draft','published','superseded','void')), published_at timestamptz, created_at timestamptz not null default now(),
    constraint tenant_statements_version_uniq unique (tenant_id, cam_year, version),
    constraint tenant_statements_tenant_property_fk foreign key (tenant_id, property_id) references public.tenants(id, property_id) on delete cascade);
  alter table public.tenant_statements enable row level security;
  create policy tenant_statements_tenant_select on public.tenant_statements for select to authenticated using (tenant_id in (select public.tenant_ids_for_current_user()) and status = 'published');
  create policy tenant_statements_landlord_all on public.tenant_statements for all to authenticated using ${MEMBER} with check ${MEMBER};   -- 024
  create policy tenant_statements_service_role_all on public.tenant_statements for all to service_role using (true) with check (true);
  revoke all on public.tenant_statements from anon, authenticated, service_role;   -- 018b
  grant select on public.tenant_statements to authenticated;
  grant select, insert, update on public.tenant_statements to service_role;`;

let DB = 'pilotlike';
const q = (sql, db) => pg.psql(sql, db || DB);
const one = (sql, db) => q(sql, db).out;
const as = (uid, sql, db) => pg.as('authenticated', uid, sql, db || DB);
const svc = (sql, db) => pg.as('service_role', null, sql, db || DB);
const anon = (sql, db) => pg.as('anon', null, sql, db || DB);
const s = (v) => v == null ? 'null' : "'" + String(v).replace(/'/g, "''") + "'";
const lit = (v) => JSON.stringify(v).replace(/'/g, "''");
const parse = (r) => { try { return JSON.parse(r.out); } catch (_) { return { _raw: r.out }; } };
const short = (t) => String(t || '').replace(/\s+/g, ' ').replace(/.*?ERROR:\s*/, '').slice(0, 150);
const wrote   = (r) => r.ok && r.out.trim() !== '';
const blocked = (r) => !r.ok || r.out.trim() === '';
const denied  = (r) => !r.ok && /permission denied/i.test(r.out);
const ALL = 'DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE';
const TABLES = ['tenants', 'lease_jobs', 'tenant_field_evidence', 'tenant_review_audit', 'cam_reconciliations', 'tenant_users', 'tenant_invitations', 'tenant_statements'];

function build(db, model, with045) {
  let r = pg.database(db, model);
  for (const part of [SCHEMA, STORAGE, EXTRA]) if (r.ok) r = q(part, db);
  for (const [n, f] of FILES) if (r.ok) { r = pg.psqlFile(f, db); if (!r.ok) r.out = n + ': ' + r.out; }
  if (r.ok) r = pg.psqlFile(M029, db);
  // 038 needs 037's lifecycle columns and 039's resync body (the order Pilot applied them: 037, 039, 038).
  for (const [n, f] of [['037', M037], ['039', M039], ['038', M038]]) if (r.ok) { r = pg.psqlFile(f, db); if (!r.ok) r.out = n + ': ' + r.out; }
  if (r.ok && with045) r = pg.psqlFile(M045, db);
  if (r.ok && with045) r = pg.psqlFile(M047, db);
  return r;
}
function deal(uid, name, db) {
  const d = parse(as(uid, `select public.begin_acquisition(${s(name)}, '${lit({ totalSqFt: '1000' })}'::jsonb);`, db));
  if (!d.property_id) throw new Error('begin_acquisition: ' + JSON.stringify(d));
  return { P: d.property_id, R: d.review_id };
}
const inventory = (db) => q(`
  select string_agg(x, E'\\n' order by x) from (
    select 'con|'||conrelid::regclass::text||'|'||conname||'|'||pg_get_constraintdef(oid) as x from pg_constraint where connamespace in ('public'::regnamespace, 'storage'::regnamespace)
    union all select 'trg|'||t.tgrelid::regclass::text||'|'||t.tgname||'|'||pg_get_triggerdef(t.oid) from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relnamespace in ('public'::regnamespace, 'storage'::regnamespace) and not t.tgisinternal
    union all select 'fn|'||p.oid::regprocedure::text||'|'||md5(pg_get_functiondef(p.oid))||'|'||coalesce(array_to_string(p.proacl,','),'') from pg_proc p where p.pronamespace='public'::regnamespace and p.prokind='f'
    union all select 'col|'||table_schema||'.'||table_name||'|'||column_name||'|'||data_type||'|'||is_nullable||'|'||coalesce(column_default,'') from information_schema.columns where table_schema in ('public','storage')
    union all select 'idx|'||schemaname||'.'||indexname||'|'||indexdef from pg_indexes where schemaname in ('public','storage')
    union all select 'pol|'||schemaname||'.'||tablename||'|'||policyname||'|'||cmd||'|'||permissive||'|'||array_to_string(roles,',')||'|'||coalesce(qual,'')||'|'||coalesce(with_check,'') from pg_policies where schemaname in ('public','storage')
    union all select 'pri|'||table_schema||'.'||table_name||'|'||grantee||'|'||string_agg(privilege_type, ',' order by privilege_type) from information_schema.role_table_grants where table_schema in ('public','storage') group by table_schema, table_name, grantee
    union all select 'rls|'||relnamespace::regnamespace::text||'.'||relname||'|'||relrowsecurity::text from pg_class where relnamespace in ('public'::regnamespace, 'storage'::regnamespace) and relkind='r'
  ) s;`, db).out.split('\n');

// ── build ────────────────────────────────────────────────────────────────────
let r = build(DB, 'legacy', true);
check('pilotlike: 036\'s stand-ins, the eight tables as 001–003/012–015b/017–018b/024 left them, the marker, 032–036, 044, phase0/029, 037, 039, 038, 045 and 047 installed from their files', r.ok, short(r.out));
if (!r.ok) T.finish();
check('the stand-in matches the migration record: anon and authenticated hold EVERY privilege on the five older tables; authenticated SELECT on tenant_users and tenant_statements, nothing on tenant_invitations; anon nothing on those three',
  ['tenants', 'lease_jobs', 'tenant_field_evidence', 'tenant_review_audit', 'cam_reconciliations'].every(t => pg.privs('public.' + t, 'anon', DB) === ALL && pg.privs('public.' + t, 'authenticated', DB) === ALL)
  && pg.privs('public.tenant_users', 'authenticated', DB) === 'SELECT' && pg.privs('public.tenant_invitations', 'authenticated', DB) === '' && pg.privs('public.tenant_statements', 'authenticated', DB) === 'SELECT'
  && ['tenant_users', 'tenant_invitations', 'tenant_statements'].every(t => pg.privs('public.' + t, 'anon', DB) === ''));

// The working property: A's, in O1, acquired (so leaseholds, jobs and CAM rows belong to it), with one leasehold T1 and one tenant user TU.
const P = (() => { const r = as(A, `insert into public.properties(user_id,name) values ('${A}','ZZ Operating Property') returning id;`); if (!wrote(r)) throw new Error(r.out); return r.out.trim(); })();
const T1 = (() => { const r = as(A, `insert into public.tenants(property_id,name,sqft) values ('${P}','Tenant One',1000) returning id;`); if (!wrote(r)) throw new Error('tenant: ' + r.out); return r.out.trim(); })();
const T2 = (() => { const r = as(A, `insert into public.tenants(property_id,name,sqft) values ('${P}','Tenant Two',500) returning id;`); if (!wrote(r)) throw new Error('tenant: ' + r.out); return r.out.trim(); })();
q(`insert into public.tenant_users(user_id,tenant_id,property_id,accepted_at) values ('${TU}','${T1}','${P}',now());
   insert into public.tenant_invitations(tenant_id,property_id,email,token_hash,invited_by) values ('${T2}','${P}','two@example.test','${'ab'.repeat(32)}','${A}');
   insert into public.tenant_statements(tenant_id,property_id,cam_year,status,published_at) values ('${T1}','${P}',2025,'published',now()),('${T2}','${P}',2025,'draft',null);
   insert into public.lease_jobs(property_id,tenant_id,file_name) values ('${P}','${T1}','lease-one.pdf');
   insert into public.tenant_field_evidence(property_id,tenant_id,field_key,reviewed_at,value) values ('${P}','${T1}','base_rent',now(),'1000');
   insert into public.tenant_review_audit(property_id,tenant_id,action,client_ts) values ('${P}','${T1}','approved',now());
   insert into public.cam_reconciliations(property_id,tenant_id,year,actual_cam) values ('${P}','${T1}',2025,100);`);
const counts = () => one(`select ${TABLES.map(t => `(select count(*) from public.${t})`).join("||'|'||")};`);

// ── 0 · the gaps ─────────────────────────────────────────────────────────────
section('0 · BEFORE 048 — every gap is real');
check('a read-only member renames a leasehold', wrote(as(R, `update public.tenants set name='renamed by read-only' where id='${T1}' returning id;`)));
check('…files a lease job, an evidence row, an audit row and a CAM result', wrote(as(R, `insert into public.lease_jobs(property_id,file_name) values ('${P}','planted.pdf') returning id;`))
  && wrote(as(R, `insert into public.tenant_field_evidence(property_id,tenant_id,field_key,reviewed_at,value) values ('${P}','${T1}','planted',now(),'x') returning id;`))
  && wrote(as(R, `insert into public.tenant_review_audit(property_id,tenant_id,action,client_ts) values ('${P}','${T1}','planted',now()) returning id;`))
  && wrote(as(R, `insert into public.cam_reconciliations(property_id,tenant_id,year,actual_cam) values ('${P}','${T1}',2024,1) returning id;`)));
check('…rewrites an audit row and deletes an evidence row (the trail is not a trail)', wrote(as(R, `update public.tenant_review_audit set action='rewritten' where action='planted' returning id;`))
  && wrote(as(R, `delete from public.tenant_field_evidence where field_key='planted' returning id;`)));
check('…but cannot void a published tenant statement even now: 018b grants authenticated SELECT only, so the 024 write rule on tenant_statements is dormant (048 narrows it all the same)', denied(as(R, `update public.tenant_statements set status='void' where tenant_id='${T1}';`)));
check('anon holds TRUNCATE on tenants, lease_jobs, evidence, audit and CAM results', ['tenants', 'lease_jobs', 'tenant_field_evidence', 'tenant_review_audit', 'cam_reconciliations'].every(t => /TRUNCATE/.test(pg.privs('public.' + t, 'anon', DB))));
q(`update public.tenants set name='Tenant One' where id='${T1}'; delete from public.lease_jobs where file_name='planted.pdf'; delete from public.tenant_review_audit where action='rewritten';
   delete from public.cam_reconciliations where year=2024; update public.tenant_statements set status='published' where tenant_id='${T1}';`);
const before = inventory(DB);
const rowsBefore = counts();

// ── 1 · apply ────────────────────────────────────────────────────────────────
section('1 · 048 applies, applies again, and changes only what it says');
r = build('nomarker', 'legacy', true); q(`delete from public.properties where id='${MARKER}';`, 'nomarker');
r = pg.psqlFile(M048, 'nomarker');
check('a database without the Pilot marker is refused before anything changes', !r.ok && /REFUSING TO RUN: pilot marker property not found/.test(r.out) && one(`select count(*) from pg_policies where policyname='tenants_owner_all';`, 'nomarker') === '1', short(r.out));
r = build('no045', 'legacy', false);
r = pg.psqlFile(M048, 'no045');
check('a Pilot-shaped database WITHOUT 045 is refused', !r.ok && /048 requires 045/.test(r.out), short(r.out));
r = pg.psqlFile(M048, DB);
check('048 applies', r.ok, short(r.out));
r = pg.psqlFile(M048, DB);
check('048 applies a second time without error', r.ok, short(r.out));
const after = inventory(DB);
const removed = before.filter(x => !after.includes(x));
const added = after.filter(x => !before.includes(x));
const REPLACED = /^pol\|public\.(tenants\|tenants_owner_all|lease_jobs\|lease_jobs_owner_all|tenant_field_evidence\|tfe_owner_all|tenant_review_audit\|tra_owner_all|cam_reconciliations\|cam_recon_owner_all|tenant_users\|tenant_users_landlord_all|tenant_invitations\|tenant_invitations_landlord_all|tenant_statements\|tenant_statements_landlord_all)\||^pri\|public\.(tenants|lease_jobs|tenant_field_evidence|tenant_review_audit|cam_reconciliations)\|(anon|authenticated)\|/;
check(`only the eight 024 rules and the grants 048 replaces are gone (${removed.length})`, removed.length === 18 && removed.every(x => REPLACED.test(x)), removed.filter(x => !REPLACED.test(x)).slice(0, 3).join(' ; ') || removed.length);
const OWN = /^pol\|public\.(tenants\|tenants_(member_select|editor_insert|editor_update|editor_delete)|lease_jobs\|lease_jobs_(member_select|editor_insert|editor_update|editor_delete)|tenant_field_evidence\|tfe_(member_select|editor_insert)|tenant_review_audit\|tra_(member_select|editor_insert)|cam_reconciliations\|cam_recon_(member_select|editor_insert|editor_update|editor_delete)|tenant_users\|tenant_users_landlord_select|tenant_invitations\|tenant_invitations_admin_all|tenant_statements\|tenant_statements_(member_select|editor_insert|editor_update|editor_delete))\||^pri\|public\.(tenants|lease_jobs|cam_reconciliations)\|authenticated\|DELETE,INSERT,SELECT,UPDATE$|^pri\|public\.(tenant_field_evidence|tenant_review_audit)\|authenticated\|INSERT,SELECT$/;
check(`everything added is 048's own (${added.length}: 22 rules, 5 grant lines)`, added.length === 27 && added.every(x => OWN.test(x)), added.filter(x => !OWN.test(x)).slice(0, 3).join(' ; ') || added.length);
check('no row changed in any of the eight tables', counts() === rowsBefore);
check('the tenant-side and service-role rules are untouched', ['tenants_tenant_self_select', 'tenant_users_self_select', 'tenant_statements_tenant_select', 'tenant_users_service_role_all', 'tenant_invitations_service_role_all']
  .every(p => after.filter(x => x.includes('|' + p + '|')).join() === before.filter(x => x.includes('|' + p + '|')).join()));
check('038\'s guards and functions are untouched', before.filter(x => /tenants_delete_guard|tenants_lifecycle_guard|end_leasehold|reactivate_leasehold|discard_leasehold|resync_property_tenants/.test(x)).join('\n') === after.filter(x => /tenants_delete_guard|tenants_lifecycle_guard|end_leasehold|reactivate_leasehold|discard_leasehold|resync_property_tenants/.test(x)).join('\n'));

// ── 2 · the matrix ──────────────────────────────────────────────────────────
section('2 · THE MATRIX — every table, every caller, every operation');
const CALLERS = { owner: A, editor: M, admin: D, readonly: R, tenant: TU, revoked: V, unaccepted: U, stranger: S };
const WRITERS = ['owner', 'editor', 'admin'];
const READERS = ['owner', 'editor', 'admin', 'readonly'];
/** For each table: a fresh insert statement, an update statement and a delete statement, each RETURNING id. `n` keeps keys unique. */
let n = 0;
const OPS = {
  tenants: {
    read: `select count(*) from public.tenants where property_id='${P}'`, reads: '2',
    insert: () => `insert into public.tenants(property_id,name,sqft) values ('${P}','ZZ Row ${++n}',10) returning id`,
    update: () => `update public.tenants set sqft=sqft where id='${T2}' returning id`,
    seed: () => `insert into public.tenants(property_id,name,sqft) values ('${P}','ZZ Del',1)`,
    delete: () => `delete from public.tenants where name='ZZ Del' returning id`,
    deleteNote: '038 refuses every direct delete',
  },
  lease_jobs: {
    read: `select count(*) from public.lease_jobs where property_id='${P}'`, reads: '1',
    insert: () => `insert into public.lease_jobs(property_id,file_name) values ('${P}','job-${++n}.pdf') returning id`,
    update: () => `update public.lease_jobs set stage='OCR' where property_id='${P}' and file_name='lease-one.pdf' returning id`,
    seed: () => `insert into public.lease_jobs(property_id,file_name) values ('${P}','job-del.pdf')`,
    delete: () => `delete from public.lease_jobs where file_name='job-del.pdf' returning id`,
  },
  tenant_field_evidence: {
    read: `select count(*) from public.tenant_field_evidence where property_id='${P}'`, reads: '1',
    insert: () => `insert into public.tenant_field_evidence(property_id,tenant_id,field_key,reviewed_at,value) values ('${P}','${T1}','k${++n}',now(),'v') returning id`,
    update: () => `update public.tenant_field_evidence set value='changed' where property_id='${P}' and field_key='base_rent' returning id`,
    seed: () => `insert into public.tenant_field_evidence(property_id,tenant_id,field_key,reviewed_at,value) values ('${P}','${T1}','k-del',now(),'v')`,
    delete: () => `delete from public.tenant_field_evidence where field_key='k-del' returning id`,
    appendOnly: true,
  },
  tenant_review_audit: {
    read: `select count(*) from public.tenant_review_audit where property_id='${P}'`, reads: '1',
    insert: () => `insert into public.tenant_review_audit(property_id,tenant_id,action,client_ts) values ('${P}','${T1}','a${++n}',now()) returning id`,
    update: () => `update public.tenant_review_audit set action='rewritten' where property_id='${P}' and action='approved' returning id`,
    seed: () => `insert into public.tenant_review_audit(property_id,tenant_id,action,client_ts) values ('${P}','${T1}','a-del',now())`,
    delete: () => `delete from public.tenant_review_audit where action='a-del' returning id`,
    appendOnly: true,
  },
  cam_reconciliations: {
    read: `select count(*) from public.cam_reconciliations where property_id='${P}'`, reads: '1',
    insert: () => `insert into public.cam_reconciliations(property_id,tenant_id,year,actual_cam) values ('${P}','${T1}',${2000 + (++n)},1) returning id`,
    update: () => `update public.cam_reconciliations set actual_cam=actual_cam where property_id='${P}' and year=2025 returning id`,
    seed: () => `insert into public.cam_reconciliations(property_id,tenant_id,year,actual_cam) values ('${P}','${T1}',1999,1)`,
    delete: () => `delete from public.cam_reconciliations where property_id='${P}' and year=1999 returning id`,
  },
  tenant_users: {
    read: `select count(*) from public.tenant_users where property_id='${P}'`, reads: '1',
    insert: () => `insert into public.tenant_users(user_id,tenant_id,property_id,accepted_at) values ('${S}','${T2}','${P}',now()) returning id`,
    update: () => `update public.tenant_users set revoked_at=now() where property_id='${P}' returning id`,
    seed: () => `insert into public.tenant_users(user_id,tenant_id,property_id) values ('${V}','${T2}','${P}')`,
    delete: () => `delete from public.tenant_users where user_id='${V}' returning id`,
    noAuthenticatedWrites: true,   // 015b: authenticated holds SELECT only — every write is refused outright, for everyone
  },
  tenant_invitations: {
    read: `select count(*) from public.tenant_invitations where property_id='${P}'`, reads: '0',   // 015b: no grant to authenticated at all
    insert: () => `insert into public.tenant_invitations(tenant_id,property_id,email,token_hash,invited_by) values ('${T2}','${P}','x${++n}@example.test','${'cd'.repeat(31)}${String(n).padStart(2, '0')}','${A}') returning id`,
    update: () => `update public.tenant_invitations set revoked_at=now() where property_id='${P}' returning id`,
    seed: () => `insert into public.tenant_invitations(tenant_id,property_id,email,token_hash,invited_by) values ('${T2}','${P}','del@example.test','${'dd'.repeat(32)}','${A}')`,
    delete: () => `delete from public.tenant_invitations where email='del@example.test' returning id`,
    noAuthenticatedAccess: true,
  },
  tenant_statements: {
    read: `select count(*) from public.tenant_statements where property_id='${P}'`, reads: '2',
    insert: () => `insert into public.tenant_statements(tenant_id,property_id,cam_year,version) values ('${T2}','${P}',${2000 + (++n)},1) returning id`,
    update: () => `update public.tenant_statements set version=version where property_id='${P}' and tenant_id='${T2}' and cam_year=2025 returning id`,
    seed: () => `insert into public.tenant_statements(tenant_id,property_id,cam_year,version) values ('${T2}','${P}',1999,1)`,
    delete: () => `delete from public.tenant_statements where cam_year=1999 returning id`,
    noAuthenticatedWrites: true,   // 018b: authenticated holds SELECT only; statements are published by publish_tenant_statement (SECURITY DEFINER)
  },
};
const problems = [];
const expectRead = (t, who) => {
  if (OPS[t].noAuthenticatedAccess) return 'denied';
  if (READERS.includes(who)) return OPS[t].reads;
  if (who === 'tenant') return t === 'tenants' ? '1' : t === 'tenant_users' ? '1' : t === 'tenant_statements' ? '1' : '0';
  return '0';
};
const expectWrite = (t, who, op) => {
  if (OPS[t].noAuthenticatedAccess || OPS[t].noAuthenticatedWrites) return 'denied';
  if (op !== 'insert' && OPS[t].appendOnly) return 'denied';   // SELECT, INSERT only — for every signed-in person
  if (!WRITERS.includes(who)) return 'blocked';
  if (op === 'delete' && t === 'tenants') return 'blocked';   // 038's delete guard, for everyone
  return 'wrote';
};
const outcome = (res) => denied(res) ? 'denied' : wrote(res) ? 'wrote' : 'blocked';
// An INSERT is judged WITHOUT RETURNING (with it, the new row must also pass the
// SELECT rule, which would hide an insert rule that is too wide behind a read
// rule that is right): did the row count grow?
const total = (t) => one(`select count(*) from public.${t};`);
// A row that lands is removed again at once (as the superuser, with 038's delete guard stood down), so the next caller sees the same table.
const ids = (t) => one(`select coalesce(string_agg(quote_literal(id::text), ','), '') from public.${t};`);
const insertOutcome = (uid, t) => {
  const before = ids(t);
  const res = as(uid, OPS[t].insert().replace(/ returning id$/, '') + ';');
  if (denied(res)) return 'denied';
  const grew = total(t) !== String(before === '' ? 0 : before.split(',').length);
  if (grew) q(`set session_replication_role = replica; delete from public.${t} where id::text not in (${before || "''"});`);
  return grew ? 'wrote' : 'blocked';
};
for (const t of TABLES) {
  for (const [who, uid] of Object.entries(CALLERS)) {
    const rd = as(uid, OPS[t].read + ';');
    const got = denied(rd) ? 'denied' : rd.ok ? rd.out.trim() : 'error';
    if (got !== expectRead(t, who)) problems.push(`${t} read by ${who}: got ${got}, want ${expectRead(t, who)}`);
    const ins = insertOutcome(uid, t);
    if (ins !== expectWrite(t, who, 'insert')) problems.push(`${t} insert by ${who}: got ${ins}, want ${expectWrite(t, who, 'insert')}`);
    for (const op of ['update', 'delete']) {
      if (op === 'delete') { const sd = q(OPS[t].seed() + ';'); if (!sd.ok) problems.push(`${t} seed for delete failed: ${short(sd.out)}`); }
      const res = as(uid, OPS[t][op]() + ';');
      const want = expectWrite(t, who, op);
      if (outcome(res) !== want) problems.push(`${t} ${op} by ${who}: got ${outcome(res)}, want ${want} — ${short(res.out)}`);
      if (op === 'delete') q(`set session_replication_role = replica; ${OPS[t].delete().replace(/ returning id$/, '')};`);
    }
  }
  // anon: refused outright on everything
  for (const op of ['insert', 'update', 'delete']) if (!denied(anon(OPS[t][op]() + ';'))) problems.push(`${t} ${op} by anon: not refused outright`);
  if (!denied(anon(OPS[t].read + ';'))) problems.push(`${t} read by anon: not refused outright`);
}
check(`every (table × caller × operation) outcome is the one promised — ${TABLES.length * (Object.keys(CALLERS).length + 1) * 4} cells`, problems.length === 0, problems.slice(0, 6).join(' | '));
check('reads are unchanged: the owner, editor, admin and read-only member see the same counts they saw before 048',
  READERS.every(who => ['tenants', 'lease_jobs', 'tenant_field_evidence', 'tenant_review_audit', 'cam_reconciliations', 'tenant_statements'].every(t => as(CALLERS[who], OPS[t].read + ';').out.trim() === OPS[t].reads)));
q(`set session_replication_role = replica; delete from public.tenants where name like 'ZZ Row %'; delete from public.lease_jobs where file_name like 'job-%'; delete from public.tenant_field_evidence where field_key like 'k%';
   delete from public.tenant_review_audit where action like 'a%' and action <> 'approved'; delete from public.cam_reconciliations where year between 2001 and 2024; delete from public.tenant_statements where cam_year between 2001 and 2024;`);

// ── 3 · tenant users ────────────────────────────────────────────────────────
section('3 · tenant users keep exactly their reads and gain no write');
check('a tenant user reads their own tenant row, their own membership and their published statement — nothing else', as(TU, `select (select count(*) from public.tenants)||'|'||(select count(*) from public.tenant_users)||'|'||(select count(*) from public.tenant_statements)||'|'||(select count(*) from public.lease_jobs)||'|'||(select count(*) from public.tenant_field_evidence)||'|'||(select count(*) from public.tenant_review_audit)||'|'||(select count(*) from public.cam_reconciliations);`).out.trim() === '1|1|1|0|0|0|0');
check('…not the draft statement, not the other tenant', as(TU, `select count(*) from public.tenant_statements where status='draft';`).out.trim() === '0' && as(TU, `select count(*) from public.tenants where id='${T2}';`).out.trim() === '0');
check('…and cannot read invitations at all (no grant)', denied(as(TU, `select count(*) from public.tenant_invitations;`)));
check('a tenant user cannot grant themselves another space, change their membership, or touch their tenant row', denied(as(TU, `insert into public.tenant_users(user_id,tenant_id,property_id,accepted_at) values ('${TU}','${T2}','${P}',now());`))
  && denied(as(TU, `update public.tenant_users set tenant_id='${T2}' where user_id='${TU}';`)) && blocked(as(TU, `update public.tenants set name='x' where id='${T1}' returning id;`)));
check('a tenant user cannot change or void a statement', denied(as(TU, `update public.tenant_statements set status='void' where tenant_id='${T1}';`)));

// ── 4 · append-only ─────────────────────────────────────────────────────────
section('4 · evidence and audit rows: appended by editors, changed or removed by nobody signed in');
check('the owner cannot rewrite or remove an evidence row', denied(as(A, `update public.tenant_field_evidence set value='x' where property_id='${P}';`)) && denied(as(A, `delete from public.tenant_field_evidence where property_id='${P}';`)));
check('…nor an audit row', denied(as(A, `update public.tenant_review_audit set action='x' where property_id='${P}';`)) && denied(as(A, `delete from public.tenant_review_audit where property_id='${P}';`)));
check('the server (service_role) still can — fixtures and corrections stay server-side', wrote(svc(`update public.tenant_field_evidence set value='1000' where property_id='${P}' and field_key='base_rent' returning id;`)));
{
  const px = as(A, `insert into public.properties(user_id,name) values ('${A}','ZZ Cascade') returning id;`).out.trim();
  const seeded = q(`insert into public.tenant_field_evidence(property_id,tenant_id,field_key,reviewed_at) values ('${px}','t','k',now()); insert into public.tenant_review_audit(property_id,tenant_id,action,client_ts) values ('${px}','t','a',now());`);
  const del = as(A, `delete from public.properties where id='${px}' returning id;`);
  check('deleting the property still removes its evidence and audit rows (cascade runs as the owner)',
    seeded.ok && wrote(del) && one(`select count(*) from public.tenant_field_evidence where property_id='${px}';`) === '0' && one(`select count(*) from public.tenant_review_audit where property_id='${px}';`) === '0',
    short(seeded.out) + ' · ' + short(del.out));
}

// ── 5 · workflows ───────────────────────────────────────────────────────────
section('5 · the workflows around the eight tables keep working');
check('the browser\'s evidence write — INSERT … ON CONFLICT DO NOTHING (ignoreDuplicates) — by an editor: new row kept, duplicate ignored, no UPDATE privilege needed',
  as(M, `insert into public.tenant_field_evidence(property_id,tenant_id,field_key,reviewed_at,value) values ('${P}','${T1}','base_rent','2025-01-01','1000') on conflict (tenant_id,field_key,reviewed_at) do nothing returning id;`).out.trim() !== ''
  && as(M, `insert into public.tenant_field_evidence(property_id,tenant_id,field_key,reviewed_at,value) values ('${P}','${T1}','base_rent','2025-01-01','1000') on conflict (tenant_id,field_key,reviewed_at) do nothing returning id;`).ok);
check('…and the audit write the same way', as(M, `insert into public.tenant_review_audit(property_id,tenant_id,action,client_ts) values ('${P}','${T1}','approved','2025-01-01') on conflict (tenant_id,action,client_ts) do nothing returning id;`).out.trim() !== '');
check('a read-only member\'s evidence write is refused, not silently ignored', blocked(as(R, `insert into public.tenant_field_evidence(property_id,tenant_id,field_key,reviewed_at,value) values ('${P}','${T1}','base_rent','2025-02-01','1') on conflict (tenant_id,field_key,reviewed_at) do nothing returning id;`)));
check('the lease job upsert and the update-by-id (script.js) by an editor', wrote(as(M, `insert into public.lease_jobs(id,property_id,file_name) values ('aaaaaaaa-0000-4000-8000-0000000000aa','${P}','up.pdf') on conflict (id) do update set file_name=excluded.file_name returning id;`))
  && wrote(as(M, `update public.lease_jobs set status='completed', stage='completed' where id='aaaaaaaa-0000-4000-8000-0000000000aa' returning id;`)));
check('the browser\'s tenants upsert (resyncTenantsDirectly fallback, demo seeds) by the owner', wrote(as(A, `insert into public.tenants(id,property_id,name,sqft) values ('${T2}','${P}','Tenant Two',600) on conflict (id) do update set sqft=excluded.sqft returning id;`)));
r = as(A, `select public.resync_property_tenants('${P}'::uuid, '${lit([{ id: T1, name: 'Tenant One', sqft: 1000 }, { id: T2, name: 'Tenant Two', sqft: 600 }])}'::jsonb);`);
check('resync_property_tenants (SECURITY DEFINER, owner) still runs', r.ok, short(r.out));
r = as(A, `select public.end_leasehold('${T2}'::uuid, '2025-06-30'::date, 'lease_expired', 'ended in test');`);
check('end_leasehold (038) still runs for the owner; the leasehold is kept, not deleted', r.ok && one(`select leasehold_status from public.tenants where id='${T2}';`) === 'ended', short(r.out));
check('a direct delete of a leasehold is still refused for everyone — editor, owner, service_role (038)', blocked(as(M, `delete from public.tenants where id='${T2}' returning id;`)) && blocked(as(A, `delete from public.tenants where id='${T2}' returning id;`)) && !svc(`delete from public.tenants where id='${T2}' returning id;`).ok);
check('accept-invite\'s upsert of a membership (service_role) still works', wrote(svc(`insert into public.tenant_users(user_id,tenant_id,property_id,accepted_at) values ('${S}','${T2}','${P}',now()) on conflict (user_id,tenant_id) do update set accepted_at=excluded.accepted_at returning id;`)));
check('…and its read-then-patch of the invitation', svc(`select count(*) from public.tenant_invitations where token_hash='${'ab'.repeat(32)}';`).out.trim() === '1' && wrote(svc(`update public.tenant_invitations set accepted_at=now() where token_hash='${'ab'.repeat(32)}' and accepted_at is null returning id;`)));
check('nobody signed in can create an invitation yet (no grant): the admin rule is dormant until a landlord screen grants INSERT', denied(as(A, `insert into public.tenant_invitations(tenant_id,property_id,email,token_hash,invited_by) values ('${T1}','${P}','a@example.test','${'ef'.repeat(32)}','${A}');`)));
check('…and when such a grant is given, only admins invite (read-only members and editors do not)', (() => {
  q(`grant insert on public.tenant_invitations to authenticated;`);
  const invited = (uid, tag, hash) => { as(uid, `insert into public.tenant_invitations(tenant_id,property_id,email,token_hash,invited_by) values ('${T1}','${P}','${tag}@example.test','${hash}','${uid}');`); return one(`select count(*) from public.tenant_invitations where email='${tag}@example.test';`) === '1'; };
  const ok = invited(A, 'a', 'ef'.repeat(32)) && invited(D, 'd', 'ee'.repeat(32)) && !invited(M, 'm', 'ed'.repeat(32)) && !invited(R, 'r', 'ec'.repeat(32));
  q(`revoke insert on public.tenant_invitations from authenticated; delete from public.tenant_invitations where email like '%@example.test' and email <> 'two@example.test';`);
  return ok;
})());
check('…and if a grant were ever given on tenant_users, no signed-in person could write a membership — the dormant 024 write rule is gone, not narrowed', (() => {
  q(`grant insert, update, delete on public.tenant_users to authenticated;`);
  const before = one(`select count(*) from public.tenant_users;`);
  as(A, `insert into public.tenant_users(user_id,tenant_id,property_id,accepted_at) values ('${R}','${T2}','${P}',now());`);
  as(D, `insert into public.tenant_users(user_id,tenant_id,property_id,accepted_at) values ('${U}','${T2}','${P}',now());`);
  const upd = as(A, `update public.tenant_users set revoked_at=now() where property_id='${P}' returning id;`);
  const del = as(A, `delete from public.tenant_users where property_id='${P}' returning id;`);
  q(`revoke insert, update, delete on public.tenant_users from authenticated;`);
  return one(`select count(*) from public.tenant_users;`) === before && blocked(upd) && blocked(del);
})());
check('the CAM proxy\'s writes (service_role: delete the year, insert the rows) still work', wrote(svc(`delete from public.cam_reconciliations where property_id='${P}' and year=2025 returning id;`)) && wrote(svc(`insert into public.cam_reconciliations(property_id,tenant_id,year,actual_cam) values ('${P}','${T1}',2025,100) returning id;`)));
check('statement publication (service_role, as publish_tenant_statement runs) still writes', wrote(svc(`insert into public.tenant_statements(tenant_id,property_id,cam_year,version,status,published_at) values ('${T1}','${P}',2024,1,'published',now()) returning id;`)));
check('a brand-new user\'s first property, then a leasehold on it', (() => {
  const NU = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  q(`insert into auth.users(id) values ('${NU}');`);
  const p = as(NU, `insert into public.properties(user_id,name) values ('${NU}','ZZ First') returning id;`).out.trim();
  return !!p && wrote(as(NU, `insert into public.tenants(property_id,name,sqft) values ('${p}','First Tenant',1) returning id;`));
})());

// ── 6 · rollback ────────────────────────────────────────────────────────────
section('6 · ROLLBACK — exact, and the old behaviour returns');
const rowsAtRollback = counts();
r = pg.psqlFile(R048, DB);
check('the rollback runs', r.ok, short(r.out));
const rolled = inventory(DB);
check('the catalog is EXACTLY what it was before 048 (policies, grants)', rolled.join('\n') === before.join('\n'),
  'missing: ' + before.filter(y => !rolled.includes(y)).slice(0, 2).join(' ; ') + ' | extra: ' + rolled.filter(y => !before.includes(y)).slice(0, 2).join(' ; '));
check('the old behaviour is back: a read-only member renames a leasehold and rewrites an audit row again', wrote(as(R, `update public.tenants set name='Tenant One' where id='${T1}' returning id;`)) && wrote(as(R, `update public.tenant_review_audit set label='x' where property_id='${P}' and action='approved' returning id;`)));
check('no row was lost by the rollback', counts() === rowsAtRollback, counts() + ' vs ' + rowsAtRollback);
r = pg.psqlFile(R048, DB);
check('the rollback runs a second time harmlessly', r.ok, short(r.out));
r = pg.psqlFile(M048, DB);
check('048 applies again, to the same catalog as before', r.ok && inventory(DB).join('\n') === after.join('\n'), short(r.out));
check('…and refuses the read-only rename again', blocked(as(R, `update public.tenants set name='again' where id='${T1}' returning id;`)));

T.finish();
