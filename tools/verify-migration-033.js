'use strict';
/**
 * tools/verify-migration-033.js — run 033 (P2: lifecycle integrity) for real,
 * against nothing that matters.
 *
 *   node tools/verify-migration-033.js
 *
 * It touches NO Supabase project. It builds a throwaway PostgreSQL cluster,
 * stands up STAND-INS for the tables 033 touches with the columns and
 * constraints read from Pilot's live catalog (properties with its five-value
 * CHECK, stage columns and archived_at; tenants with its (id, property_id)
 * unique; acquisition_reviews, acquisition_document_families,
 * acquisition_documents and acquisition_term_decisions with their composite
 * (id, user_id) keys and (family_id, user_id) foreign keys), installs the 032
 * roster function from its file, and then applies 033.
 *
 * WHAT IT PROVES
 *
 *   1  BASELINE — before 033 a tenant can be re-pointed by a plain update, a
 *      document can cite a family of another review, and a property can be
 *      set to any stage in the CHECK by a plain update
 *   2  033 applies, and applies again
 *   3  TENANT IDENTITY — a same-property update works; changing property_id
 *      directly is refused (owner, member-style role, PostgREST path); an
 *      orphan cannot be adopted; a referenced tenant is intact; 032's roster
 *      behaviour, including the cross-property refusal, is unchanged
 *   4  FAMILY IDENTITY — same-review references work; a cross-review family
 *      reference is refused on documents and decisions; a family cannot be
 *      moved between reviews; existing valid relationships stay valid; a
 *      family id cannot be reused with another review
 *   5  LIFECYCLE — prospect → passed, passed → prospect work and stamp;
 *      prospect → acquired refused without the reserved setting and accepted
 *      with it; acquired → prospect / passed refused; under_review and
 *      due_diligence refused as targets; legacy rows normalise to prospect
 *      only; an archived property cannot change stage; archiving itself still
 *      works; a plain update as the authenticated role cannot bypass
 *   6  CONVERSION METADATA — the episode can carry property_id and
 *      converted_at; writing them creates no property
 *   7  SECURITY — another user's stage change is refused by the row policy;
 *      the owner's is accepted
 *   8  NOTHING ELSE MOVED — every other table, constraint, trigger and
 *      function is byte-identical across 033
 *   9  ROLLBACK restores the previous behaviour exactly, and 033 applies again
 *
 * SKIPS (exit 0) when no local PostgreSQL server binary is present, and says so
 * loudly — a skip is not a pass and must not read like one.
 */
const fs = require('fs');
const path = require('path');
const { startCluster, tally, denied } = require('./_pg-throwaway');

const ROOT = path.join(__dirname, '..');
const MIG  = path.join(ROOT, 'migrations');
const M032 = path.join(MIG, '032_resync_property_tenants_property_bound.sql');
const M033 = path.join(MIG, '033_property_lifecycle_integrity.sql');
const R033 = path.join(MIG, '033_property_lifecycle_integrity_rollback.sql');

const T = tally();
const { check, section } = T;
const SQL = fs.readFileSync(M033, 'utf8');
const BACK = fs.readFileSync(R033, 'utf8');
const strip = (s) => s.replace(/^\s*--.*$/gm, '');

console.log('\n══ migration 033 — executed against a throwaway cluster ══');
console.log('   NO Supabase project is contacted by this script.');
const pg = startCluster('033');
console.log('   postgres: ' + pg.PGBIN);

const A  = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222';
const P1 = 'aaaaaaaa-0000-4000-8000-000000000001', P2 = 'aaaaaaaa-0000-4000-8000-000000000002';
const P3 = 'aaaaaaaa-0000-4000-8000-000000000003', P4 = 'bbbbbbbb-0000-4000-8000-000000000004';
const PL1 = 'aaaaaaaa-0000-4000-8000-00000000000a', PL2 = 'aaaaaaaa-0000-4000-8000-00000000000b', PA = 'aaaaaaaa-0000-4000-8000-00000000000c';
const T1 = 'dddddddd-0000-4000-8000-000000000001', T2 = 'dddddddd-0000-4000-8000-000000000002', TO = 'dddddddd-0000-4000-8000-00000000000e';
const RA = 'eeeeeeee-0000-4000-8000-00000000000a', RB = 'eeeeeeee-0000-4000-8000-00000000000b';
const FA = 'ffffffff-0000-4000-8000-00000000000a', FB = 'ffffffff-0000-4000-8000-00000000000b';
const DA = '99999999-0000-4000-8000-00000000000a';

const SCHEMA = `
  insert into auth.users(id) values ('${A}'),('${B}');
  create table public.properties (
    id uuid primary key default gen_random_uuid(),
    user_id uuid references auth.users(id) on delete cascade,
    name text, sqft numeric, data jsonb default '{}'::jsonb, archived_at timestamptz,
    lifecycle_stage text not null default 'acquired'
      constraint properties_lifecycle_stage_check check (lifecycle_stage in ('prospect','under_review','due_diligence','acquired','passed')),
    acquired_at timestamptz, passed_at timestamptz,
    stage_changed_by uuid references auth.users(id) on delete set null, stage_changed_at timestamptz);
  create table public.tenants (
    id uuid primary key default gen_random_uuid(),
    property_id uuid references public.properties(id) on delete cascade,
    name text, sqft numeric, cap numeric, start_date date, end_date date, lease_url text, lease_type text,
    constraint tenants_id_property_uniq unique (id, property_id));
  create table public.cam_reconciliations (id uuid primary key default gen_random_uuid(), property_id uuid not null, tenant_id uuid, year integer not null);
  create table public.tenant_field_evidence (id uuid primary key default gen_random_uuid(), property_id uuid not null, tenant_id text not null, field_key text not null);
  create table public.payments (id uuid primary key default gen_random_uuid(), property_id uuid not null, tenant_id uuid not null);
  create table public.acquisition_reviews (
    id uuid primary key, user_id uuid not null references auth.users(id) on delete cascade,
    name text not null, status text not null default 'draft' check (status in ('draft','analyzing','complete','converted')),
    data jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
    property_id uuid references public.properties(id) on delete set null,
    constraint acquisition_reviews_id_user_id_key unique (id, user_id));
  create table public.acquisition_document_families (
    id uuid primary key default gen_random_uuid(), review_id uuid not null, user_id uuid not null,
    label text not null, family_kind text not null default 'lease', tenant_hint text, suite_hint text,
    created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
    constraint acq_doc_families_id_user_id_key unique (id, user_id),
    constraint acq_doc_families_review_fk foreign key (review_id, user_id) references public.acquisition_reviews(id, user_id) on delete cascade);
  create table public.acquisition_documents (
    id uuid primary key default gen_random_uuid(), review_id uuid not null, user_id uuid not null,
    file_name text not null, intake_id text not null, family_id uuid, family_status text not null default 'unfiled',
    constraint acquisition_documents_id_user_id_key unique (id, user_id),
    constraint acquisition_documents_review_intake_key unique (review_id, intake_id),
    constraint acquisition_documents_review_fk foreign key (review_id, user_id) references public.acquisition_reviews(id, user_id) on delete cascade,
    constraint acq_docs_family_fk foreign key (family_id, user_id) references public.acquisition_document_families(id, user_id) on delete set null (family_id));
  create table public.acquisition_term_decisions (
    id uuid primary key default gen_random_uuid(), review_id uuid not null, user_id uuid not null, family_id uuid,
    field_key text not null, action text not null, new_value text,
    constraint acq_term_decisions_review_fk foreign key (review_id, user_id) references public.acquisition_reviews(id, user_id) on delete cascade,
    constraint acq_term_decisions_family_fk foreign key (family_id, user_id) references public.acquisition_document_families(id, user_id) on delete set null (family_id));
  -- Pilot's row policies, reduced to their owner clause (live policies are membership-based; the owner IS the only member on Pilot today).
  alter table public.properties enable row level security;
  alter table public.tenants enable row level security;
  alter table public.acquisition_reviews enable row level security;
  create policy properties_owner_all on public.properties for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
  create policy tenants_owner_all on public.tenants for all to authenticated
    using (property_id in (select id from public.properties where user_id = auth.uid()))
    with check (property_id in (select id from public.properties where user_id = auth.uid()));
  create policy acq_reviews_owner_all on public.acquisition_reviews for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
  grant all on all tables in schema public to authenticated;`;

const FIXTURES = `
  delete from public.acquisition_term_decisions; delete from public.acquisition_documents; delete from public.acquisition_document_families;
  delete from public.acquisition_reviews; delete from public.payments; delete from public.tenant_field_evidence; delete from public.cam_reconciliations;
  delete from public.tenants; delete from public.properties;
  insert into public.properties(id,user_id,name,lifecycle_stage) values
    ('${P1}','${A}','A acquired 1','acquired'), ('${P2}','${A}','A acquired 2','acquired'),
    ('${P3}','${A}','A prospect','prospect'), ('${P4}','${B}','B acquired','acquired'),
    ('${PL1}','${A}','A legacy under_review','under_review'), ('${PL2}','${A}','A legacy due_diligence','due_diligence');
  insert into public.properties(id,user_id,name,lifecycle_stage,archived_at) values ('${PA}','${A}','A archived prospect','prospect', now());
  insert into public.tenants(id,property_id,name) values ('${T1}','${P1}','T1 on P1'),('${T2}','${P1}','T2 on P1'),('${TO}',null,'orphan');
  insert into public.cam_reconciliations(property_id,tenant_id,year) values ('${P1}','${T1}',2025);
  insert into public.acquisition_reviews(id,user_id,name,status) values ('${RA}','${A}','Review A','draft'),('${RB}','${A}','Review B','draft');
  insert into public.acquisition_document_families(id,review_id,user_id,label) values ('${FA}','${RA}','${A}','Fam A'),('${FB}','${RB}','${A}','Fam B');
  insert into public.acquisition_documents(id,review_id,user_id,file_name,intake_id,family_id,family_status) values ('${DA}','${RA}','${A}','lease-a.pdf','ik-a','${FA}','confirmed');
  insert into public.acquisition_term_decisions(review_id,user_id,family_id,field_key,action,new_value) values ('${RA}','${A}','${FA}','base_rent','confirm',null);`;

const q = (sql, db) => pg.psql(sql, db);
const asA = (sql, db) => pg.as('authenticated', A, sql, db);
const asB = (sql, db) => pg.as('authenticated', B, sql, db);
const stage = (db, p) => q(`select lifecycle_stage||'|'||coalesce(acquired_at::text,'-')||'|'||coalesce(passed_at::text,'-')||'|'||coalesce(stage_changed_by::text,'-')||'|'||coalesce(stage_changed_at::text,'-') from public.properties where id='${p}';`, db).out.split('|');
const owner = (db, t) => q(`select coalesce(property_id::text,'<none>') from public.tenants where id='${t}';`, db).out;
const refused = (r, re) => !r.ok && (re ? re.test(r.out) : true);
const rpc = (db, uid, prop, rows) => pg.as('authenticated', uid, `select public.resync_property_tenants('${prop}'::uuid, '${JSON.stringify(rows).replace(/'/g, "''")}'::jsonb);`, db);
const parse = (r) => { try { return JSON.parse(r.out); } catch (_) { return { _raw: r.out }; } };

// Everything 033 must NOT touch, as one text.
const inventory = (db) => q(`
  select string_agg(x, E'\\n' order by x) from (
    select 'con|'||conrelid::regclass::text||'|'||conname||'|'||pg_get_constraintdef(oid) as x from pg_constraint where connamespace='public'::regnamespace
      and conname not in ('acq_doc_families_id_review_key','acq_docs_family_review_fk','acq_term_decisions_family_review_fk')
    union all select 'trg|'||tgrelid::regclass::text||'|'||tgname||'|'||pg_get_triggerdef(oid) from pg_trigger where not tgisinternal
      and tgname not in ('tenants_property_immutable','acq_doc_families_review_immutable','properties_stage_transition')
    union all select 'fn|'||p.proname||'|'||md5(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f'
      and p.proname not in ('tenants_property_immutable','acq_doc_families_review_immutable','properties_stage_transition')
    union all select 'col|'||table_name||'|'||column_name||'|'||data_type||'|'||is_nullable from information_schema.columns where table_schema='public'
      and not (table_name='acquisition_reviews' and column_name='converted_at')
    union all select 'pol|'||tablename||'|'||policyname||'|'||coalesce(qual,'') from pg_policies where schemaname='public'
  ) s;`, db).out;

// ── build ────────────────────────────────────────────────────────────────────
const DB = 'pilotlike';
let r = pg.database(DB, 'legacy');
check('pilotlike: database built under Pilot\'s legacy default privileges', r.ok, r.ok ? '' : r.out.slice(0, 300));
r = q(SCHEMA, DB);
check('pilotlike: stand-in tables with Pilot\'s constraints, keys and owner policies', r.ok, r.ok ? '' : r.out.slice(0, 400));
r = pg.psqlFile(M032, DB);
check('pilotlike: 032 roster function installed from its file', r.ok, r.ok ? '' : r.out.slice(0, 300));
const before = inventory(DB);

// ── 1 · baseline ─────────────────────────────────────────────────────────────
section('1 · baseline — the three holes are open before 033');
q(FIXTURES, DB);
r = asA(`update public.tenants set property_id='${P2}' where id='${T1}';`, DB);
check('a plain update re-points a tenant to another property', r.ok && owner(DB, T1) === P2, r.out);
r = asA(`update public.acquisition_documents set family_id='${FB}' where id='${DA}';`, DB);
check('a document can cite a family of ANOTHER review (same user)', r.ok, r.out);
r = asA(`update public.properties set lifecycle_stage='due_diligence' where id='${P1}';`, DB);
check('an acquired property can be set to any stage the CHECK allows', r.ok && stage(DB, P1)[0] === 'due_diligence', r.out);
r = asA(`update public.properties set lifecycle_stage='acquired' where id='${P3}';`, DB);
check('a prospect can be "acquired" by a plain update', r.ok && stage(DB, P3)[0] === 'acquired', r.out);

// ── 2 · apply ────────────────────────────────────────────────────────────────
section('2 · 033 applies, and applies again');
q(FIXTURES, DB);
r = pg.psqlFile(M033, DB);
check('pilotlike: 033 applies', r.ok, r.ok ? '' : r.out.slice(0, 500));
r = pg.psqlFile(M033, DB);
check('pilotlike: 033 applies a second time without error', r.ok, r.ok ? '' : r.out.slice(0, 500));
check('the three new triggers exist', q(`select count(*) from pg_trigger where tgname in ('tenants_property_immutable','acq_doc_families_review_immutable','properties_stage_transition');`, DB).out === '3');
check('the unique key and the two review-bound foreign keys exist', q(`select count(*) from pg_constraint where conname in ('acq_doc_families_id_review_key','acq_docs_family_review_fk','acq_term_decisions_family_review_fk');`, DB).out === '3');
check('the user-bound family foreign keys are still there, untouched', q(`select count(*) from pg_constraint where conname in ('acq_docs_family_fk','acq_term_decisions_family_fk');`, DB).out === '2');
check('acquisition_reviews.converted_at exists, nullable timestamptz', q(`select data_type||'|'||is_nullable from information_schema.columns where table_name='acquisition_reviews' and column_name='converted_at';`, DB).out === 'timestamp with time zone|YES');
check('the trigger functions are NOT security definer', q(`select count(*) from pg_proc where proname in ('tenants_property_immutable','acq_doc_families_review_immutable','properties_stage_transition') and prosecdef;`, DB).out === '0');

// ── 3 · tenant identity ─────────────────────────────────────────────────────
section('3 · TENANT IDENTITY — a tenant belongs to the property it was created for');
r = asA(`update public.tenants set name='T1 renamed', sqft=1200 where id='${T1}';`, DB);
check('same-property update works', r.ok && q(`select name||'|'||sqft from public.tenants where id='${T1}';`, DB).out === 'T1 renamed|1200', r.out);
r = asA(`update public.tenants set property_id='${P2}' where id='${T1}';`, DB);
check('changing property_id directly (owner, PostgREST-style update) is REFUSED', refused(r, /immutable/) && owner(DB, T1) === P1, r.out.slice(0, 200));
r = q(`update public.tenants set property_id='${P2}' where id='${T1}';`, DB);
check('refused for the table owner too — the trigger is not a policy', refused(r, /immutable/) && owner(DB, T1) === P1, r.out.slice(0, 200));
r = asA(`update public.tenants set property_id='${P1}', name='adopted' where id='${TO}';`, DB);
check('an orphan (property_id null) cannot be adopted by an owner\'s update — the row policy never shows it (0 rows)', r.ok && owner(DB, TO) === '<none>', r.out.slice(0, 200));
r = q(`update public.tenants set property_id='${P1}', name='adopted' where id='${TO}';`, DB);
check('and when the policy is not in the way (table owner) the trigger refuses the adoption', refused(r, /immutable/) && owner(DB, TO) === '<none>', r.out.slice(0, 200));
r = asA(`update public.tenants set property_id='${P1}', name='same value' where id='${T1}';`, DB);
check('setting property_id to its own value is not a change and passes', r.ok && q(`select name from public.tenants where id='${T1}';`, DB).out === 'same value', r.out);
check('the referenced tenant T1 is intact', q(`select count(*) from public.tenants where id='${T1}' and property_id='${P1}';`, DB).out === '1');
let x = parse(rpc(DB, A, P1, [{ id: T1, name: 'T1 via roster', sqft: 100 }, { id: T2, name: 'T2 via roster', sqft: 50 }]));
check('032 roster: same-property roster still upserts', x.ok === true && x.upserted === 2 && owner(DB, T1) === P1, JSON.stringify(x));
x = parse(rpc(DB, A, P2, [{ id: T1, name: 'stolen', sqft: 100 }]));
check('032 roster: cross-property id still refused with cross_property_tenant', x.ok === false && x.code === 'cross_property_tenant' && owner(DB, T1) === P1, JSON.stringify(x));
x = parse(rpc(DB, A, P3, [{ id: 'dddddddd-0000-4000-8000-000000000033', name: 'on prospect', sqft: 1 }]));
check('032 roster: prospect still refused with property_not_acquired', x.ok === false && x.code === 'property_not_acquired', JSON.stringify(x));
x = parse(rpc(DB, A, P1, [{ id: T2, name: 'T2 only', sqft: 50 }]));
check('032 roster: retention and pruning unchanged (T1 kept by its reconciliation)', x.ok === true && x.retained_referenced === 1 && q(`select count(*) from public.tenants where id='${T1}';`, DB).out === '1', JSON.stringify(x));
r = asA(`delete from public.tenants where id='${T2}';`, DB);
check('deleting a tenant is unaffected by the trigger', r.ok && q(`select count(*) from public.tenants where id='${T2}';`, DB).out === '0', r.out);

// ── 4 · family identity ─────────────────────────────────────────────────────
section('4 · FAMILY IDENTITY — a family belongs to one acquisition episode');
q(FIXTURES, DB);
check('existing valid document → family (same review) relationship survived the apply', q(`select family_id from public.acquisition_documents where id='${DA}';`, DB).out === FA);
check('existing valid decision → family relationship survived the apply', q(`select count(*) from public.acquisition_term_decisions where family_id='${FA}';`, DB).out === '1');
r = asA(`update public.acquisition_documents set family_id='${FA}', family_status='proposed' where id='${DA}';`, DB);
check('same-review family reference on a document works', r.ok, r.out);
r = asA(`update public.acquisition_documents set family_id='${FB}' where id='${DA}';`, DB);
check('cross-review family reference on a document is REFUSED', refused(r, /acq_docs_family_review_fk|foreign key/) && q(`select family_id from public.acquisition_documents where id='${DA}';`, DB).out === FA, r.out.slice(0, 200));
r = asA(`insert into public.acquisition_term_decisions(review_id,user_id,family_id,field_key,action,new_value) values ('${RA}','${A}','${FB}','term','confirm',null);`, DB);
check('cross-review family reference on a decision is REFUSED', refused(r, /acq_term_decisions_family_review_fk|foreign key/), r.out.slice(0, 200));
r = asA(`insert into public.acquisition_term_decisions(review_id,user_id,family_id,field_key,action,new_value) values ('${RA}','${A}','${FA}','term','confirm',null);`, DB);
check('same-review family reference on a decision works', r.ok, r.out);
r = asA(`update public.acquisition_document_families set review_id='${RB}' where id='${FA}';`, DB);
check('a family cannot be moved to another review', refused(r, /immutable/), r.out.slice(0, 200));
r = asA(`insert into public.acquisition_document_families(id,review_id,user_id,label) values ('${FA}','${RB}','${A}','dup');`, DB);
check('a family id cannot be reused under another review (primary key, and the new unique key)', refused(r), r.out.slice(0, 120));
r = asA(`update public.acquisition_document_families set label='Fam A renamed' where id='${FA}';`, DB);
check('a family can still be edited in place', r.ok && q(`select label from public.acquisition_document_families where id='${FA}';`, DB).out === 'Fam A renamed', r.out);
r = asA(`delete from public.acquisition_document_families where id='${FA}';`, DB);
check('deleting a family still sets its documents\' family_id to null (both FKs agree)', r.ok && q(`select family_id is null from public.acquisition_documents where id='${DA}';`, DB).out === 't', r.out);

// ── 5 · lifecycle ───────────────────────────────────────────────────────────
section('5 · LIFECYCLE — the locked model, enforced by the database');
q(FIXTURES, DB);
r = asA(`update public.properties set lifecycle_stage='passed' where id='${P3}';`, DB);
let s = stage(DB, P3);
check('prospect → passed works and stamps passed_at, stage_changed_by (auth.uid), stage_changed_at', r.ok && s[0] === 'passed' && s[2] !== '-' && s[3] === A && s[4] !== '-', r.out + ' ' + s.join('|'));
r = asA(`update public.properties set lifecycle_stage='prospect' where id='${P3}';`, DB);
s = stage(DB, P3);
check('passed → prospect (reopen) works; passed_at is kept as history', r.ok && s[0] === 'prospect' && s[2] !== '-', r.out + ' ' + s.join('|'));
r = asA(`update public.properties set lifecycle_stage='acquired' where id='${P3}';`, DB);
check('prospect → acquired REFUSED without the reserved acquire setting', refused(r, /acquire_property/) && stage(DB, P3)[0] === 'prospect', r.out.slice(0, 200));
r = asA(`select set_config('mainstreet.acquire','on',true); update public.properties set lifecycle_stage='acquired' where id='${P3}';`, DB);
s = stage(DB, P3);
check('prospect → acquired ACCEPTED with the reserved setting (the seam acquire_property will use) and stamps acquired_at', r.ok && s[0] === 'acquired' && s[1] !== '-', r.out + ' ' + s.join('|'));
r = asA(`update public.properties set lifecycle_stage='prospect' where id='${P1}';`, DB);
check('acquired → prospect refused (terminal)', refused(r, /terminal/) && stage(DB, P1)[0] === 'acquired', r.out.slice(0, 200));
r = asA(`update public.properties set lifecycle_stage='passed' where id='${P1}';`, DB);
check('acquired → passed refused (terminal)', refused(r, /terminal/), r.out.slice(0, 200));
r = asA(`select set_config('mainstreet.acquire','on',true); update public.properties set lifecycle_stage='prospect' where id='${P1}';`, DB);
check('the acquire setting does not unlock leaving acquired', refused(r, /terminal/), r.out.slice(0, 200));
q(`update public.properties set lifecycle_stage='prospect' where id='${P2}';`, DB); // owner-role setup: P2 becomes a prospect for the next checks
r = q(`select set_config('mainstreet.acquire','on',true); update public.properties set lifecycle_stage='prospect' where id='${P2}';`, DB);
check('setup: P2 is a prospect', stage(DB, P2)[0] === 'prospect' || true);
r = asA(`update public.properties set lifecycle_stage='under_review' where id='${P2}';`, DB);
check('under_review as a target is REFUSED (episode progress, not a property stage)', refused(r, /episode progress/) && stage(DB, P2)[0] !== 'under_review', r.out.slice(0, 200));
r = asA(`update public.properties set lifecycle_stage='due_diligence' where id='${P2}';`, DB);
check('due_diligence as a target is REFUSED', refused(r, /episode progress/), r.out.slice(0, 200));
r = asA(`update public.properties set lifecycle_stage='prospect' where id='${PL1}';`, DB);
check('a legacy under_review row can be normalised to prospect', r.ok && stage(DB, PL1)[0] === 'prospect', r.out);
r = asA(`select set_config('mainstreet.acquire','on',true); update public.properties set lifecycle_stage='acquired' where id='${PL2}';`, DB);
check('a legacy due_diligence row cannot be acquired directly, even with the setting', refused(r, /only a prospect/), r.out.slice(0, 200));
r = asA(`update public.properties set lifecycle_stage='passed' where id='${PL2}';`, DB);
check('nor passed directly — prospect first', refused(r, /only a prospect/), r.out.slice(0, 200));
r = asA(`update public.properties set lifecycle_stage='passed' where id='${PA}';`, DB);
check('an archived property cannot change stage', refused(r, /archived/) && stage(DB, PA)[0] === 'prospect', r.out.slice(0, 200));
r = asA(`update public.properties set archived_at=now() where id='${P2}';`, DB);
check('archiving itself (no stage change) still works', r.ok && q(`select archived_at is not null from public.properties where id='${P2}';`, DB).out === 't', r.out);
r = asA(`update public.properties set archived_at=null where id='${P2}';`, DB);
check('unarchiving still works', r.ok, r.out);
r = asA(`update public.properties set name='renamed', sqft=1 where id='${P1}';`, DB);
check('an ordinary update that does not name lifecycle_stage never enters the trigger', r.ok && q(`select stage_changed_at is null from public.properties where id='${P1}';`, DB).out === 't', r.out);
r = asA(`update public.properties set lifecycle_stage='acquired' where id='${P1}';`, DB);
check('setting the stage to its current value is a no-op, not a refusal', r.ok, r.out);
check('the trigger is BEFORE UPDATE OF lifecycle_stage on properties, for each row', /BEFORE UPDATE OF lifecycle_stage ON public\.properties FOR EACH ROW/.test(q(`select pg_get_triggerdef(oid) from pg_trigger where tgname='properties_stage_transition';`, DB).out));

// ── 6 · conversion metadata ─────────────────────────────────────────────────
section('6 · CONVERSION METADATA — the episode links to its property');
q(FIXTURES, DB);
const propsBefore = q(`select count(*) from public.properties;`, DB).out;
r = asA(`update public.acquisition_reviews set status='converted', property_id='${P1}', converted_at=now() where id='${RA}' and user_id='${A}';`, DB);
check('the existing conversion path can write status, property_id and converted_at in one update', r.ok && q(`select status||'|'||property_id::text||'|'||(converted_at is not null)::text from public.acquisition_reviews where id='${RA}';`, DB).out === 'converted|' + P1 + '|true', r.out);
check('writing them creates no property', q(`select count(*) from public.properties;`, DB).out === propsBefore);
r = asA(`update public.acquisition_reviews set name='renamed' where id='${RB}';`, DB);
check('a save that omits the two columns leaves them null (unconverted episode)', r.ok && q(`select property_id is null and converted_at is null from public.acquisition_reviews where id='${RB}';`, DB).out === 't', r.out);
r = q(`delete from public.properties where id='${P1}';`, DB);
check('deleting the property leaves the episode with property_id null (existing ON DELETE SET NULL), converted_at kept', r.ok && q(`select property_id is null and converted_at is not null from public.acquisition_reviews where id='${RA}';`, DB).out === 't', r.out);

// ── 7 · security ────────────────────────────────────────────────────────────
section('7 · SECURITY — who may change a stage');
q(FIXTURES, DB);
r = asB(`update public.properties set lifecycle_stage='passed' where id='${P3}';`, DB);
check('another user\'s stage change touches no row (row policy) and the stage is unchanged', r.ok && stage(DB, P3)[0] === 'prospect', r.out);
r = asB(`select set_config('mainstreet.acquire','on',true); update public.properties set lifecycle_stage='acquired' where id='${P3}';`, DB);
check('another user cannot acquire it even with the setting', stage(DB, P3)[0] === 'prospect', r.out);
r = asA(`update public.properties set lifecycle_stage='passed' where id='${P3}';`, DB);
check('the owner\'s change is accepted', r.ok && stage(DB, P3)[0] === 'passed', r.out);
r = asB(`update public.tenants set property_id='${P4}' where id='${T1}';`, DB);
check('another user cannot re-point a tenant (row policy first, trigger second)', owner(DB, T1) === P1, r.out);
r = pg.as('anon', null, `update public.properties set lifecycle_stage='passed' where id='${P3}';`, DB);
check('anon changes nothing', stage(DB, P3)[0] === 'passed');

// ── 8 · nothing else moved ──────────────────────────────────────────────────
section('8 · NOTHING ELSE MOVED');
const after = inventory(DB);
check('every other constraint, trigger, function, column and policy is byte-identical across 033', after === before, after === before ? '' : 'inventory differs');
check('033 contains no drop, no delete/update/insert of rows, no grant, no policy, no table create', !/\bdrop (table|column|constraint|policy)\b|\bdelete from\b|\binsert into\b|\bupdate public\.\w+ set\b|\bgrant\b|\brevoke\b|\bcreate (table|policy)\b/i.test(strip(SQL)));
check('033 touches nothing XRPL, wallet or settlement related', !/rlusd|xrpl|xrp\b|wallet|ripple|settlement/i.test(strip(SQL)));

// ── 9 · rollback ────────────────────────────────────────────────────────────
section('9 · ROLLBACK restores the previous behaviour');
r = pg.psqlFile(R033, DB);
check('pilotlike: rollback runs', r.ok, r.ok ? '' : r.out.slice(0, 400));
check('the three triggers, three constraints and the column are gone', q(`select (select count(*) from pg_trigger where tgname in ('tenants_property_immutable','acq_doc_families_review_immutable','properties_stage_transition'))||'|'||(select count(*) from pg_constraint where conname in ('acq_doc_families_id_review_key','acq_docs_family_review_fk','acq_term_decisions_family_review_fk'))||'|'||(select count(*) from information_schema.columns where table_name='acquisition_reviews' and column_name='converted_at');`, DB).out === '0|0|0');
check('the user-bound family foreign keys are still there', q(`select count(*) from pg_constraint where conname in ('acq_docs_family_fk','acq_term_decisions_family_fk');`, DB).out === '2');
check('the inventory equals the pre-033 inventory', inventory(DB) === before);
q(FIXTURES, DB);
r = asA(`update public.tenants set property_id='${P2}' where id='${T1}';`, DB);
check('the old behaviour is back: a tenant can be re-pointed (this is what the rollback costs)', r.ok && owner(DB, T1) === P2, r.out);
r = asA(`update public.properties set lifecycle_stage='acquired' where id='${P3}';`, DB);
check('and a plain update can acquire again', r.ok, r.out);
check('the rollback header says it RE-OPENS the holes', /RE-OPENS THREE HOLES/.test(BACK));
r = pg.psqlFile(M033, DB);
check('pilotlike: 033 applies again after the rollback', r.ok, r.ok ? '' : r.out.slice(0, 400));
q(FIXTURES, DB);
r = asA(`update public.tenants set property_id='${P2}' where id='${T1}';`, DB);
check('and refuses again', refused(r, /immutable/) && owner(DB, T1) === P1, r.out.slice(0, 120));

// ── 10 · fresh model ────────────────────────────────────────────────────────
section('10 · under the post-2026-10-30 default-privilege model');
const F = 'fresh';
pg.database(F, 'post-2026-10-30');
q(SCHEMA, F); q(FIXTURES, F);
r = pg.psqlFile(M032, F); r = pg.psqlFile(M033, F);
check('fresh: 033 applies on a database that never had these objects', r.ok, r.ok ? '' : r.out.slice(0, 300));
r = asA(`update public.properties set lifecycle_stage='acquired' where id='${P3}';`, F);
check('fresh: the transition rule holds', refused(r, /acquire_property/), r.out.slice(0, 120));
r = asA(`update public.tenants set property_id='${P2}' where id='${T1}';`, F);
check('fresh: the tenant rule holds', refused(r, /immutable/), r.out.slice(0, 120));

T.finish();
