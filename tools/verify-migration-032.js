'use strict';
/**
 * tools/verify-migration-032.js — run 032 for real, against nothing that
 * matters, and prove a tenant id can no longer be moved between properties.
 *
 *   node tools/verify-migration-032.js
 *
 * It touches NO Supabase project. It builds a throwaway PostgreSQL cluster,
 * stands up the five tables the function reads and writes, installs the
 * definition Pilot runs TODAY (the rollback file, which is Pilot's live
 * pg_get_functiondef), shows the hazard, applies 032, and runs the matrix.
 *
 * ABOUT THE SCHEMA. The function touches properties, tenants,
 * cam_reconciliations, tenant_field_evidence and payments. The repo's own
 * migration files cannot build that set here: 022 (payments) has a foreign key
 * to tenant_statements, which only 017 creates, and 017 lives on another branch
 * (see migrations/APPLIED.md). So the tables are STAND-INS with exactly the
 * columns and constraints the function relies on, each read from Pilot's
 * catalog: properties(id, user_id, lifecycle_stage with its CHECK, archived_at),
 * tenants(id pk, property_id fk, the eight roster columns, unique (id,
 * property_id)), cam_reconciliations(property_id, tenant_id, year),
 * tenant_field_evidence(property_id, tenant_id text, field_key),
 * payments(property_id, tenant_id).
 *
 * WHAT IT PROVES
 *
 *   1  BASELINE — with today's definition an owner's roster for property B
 *      re-points a tenant that belongs to property A (the H2 hazard), and a
 *      roster is accepted for a prospect
 *   2  032 applies, and applies again
 *   3  same property + same id updates in place and never writes property_id;
 *      same property + new id inserts
 *   4  SECURITY — an id that belongs to another property, owned by the caller
 *      or by someone else, refuses the WHOLE call before any write
 *   5  a prospect (any non-acquired stage) is refused; an acquired property,
 *      archived or not, is written
 *   6  a missing property, another user and anonymous all answer
 *      not_authorized, exactly as before
 *   7  retention: a tenant referenced by a reconciliation, a piece of evidence
 *      or a payment is kept; an unreferenced absentee is pruned
 *   8  empty roster and all-unusable roster are no-ops that delete nothing
 *   9  the exact live-matrix block (verify-migration-032.live.sql) leaves no
 *      row behind and reads as expected, before and after 032
 *  10  032 is additive — one create-or-replace and two grants, no DDL on any
 *      table, no row written — and the function's privileges do not move
 *  11  the rollback restores Pilot's live definition (normalised text equal)
 *      and, with it, the old behaviour; 032 applies again after it
 *  12  under the post-2026-10-30 default-privilege model the grants 032
 *      re-states are sufficient for authenticated and service_role
 *
 * SKIPS (exit 0) when no local PostgreSQL server binary is present, and says so
 * loudly — a skip is not a pass and must not read like one.
 */
const fs = require('fs');
const path = require('path');
const { startCluster, tally } = require('./_pg-throwaway');

const ROOT = path.join(__dirname, '..');
const MIG  = path.join(ROOT, 'migrations');
const M032 = path.join(MIG, '032_resync_property_tenants_property_bound.sql');
const R032 = path.join(MIG, '032_resync_property_tenants_property_bound_rollback.sql');
const LIVE_MATRIX = path.join(__dirname, 'verify-migration-032.live.sql');

const T = tally();
const { check, section } = T;

const SQL  = fs.readFileSync(M032, 'utf8');
const BACK = fs.readFileSync(R032, 'utf8');
const strip = (s) => s.replace(/^\s*--.*$/gm, '').replace(/--[^\n']*$/gm, '');

console.log('\n══ migration 032 — executed against a throwaway cluster ══');
console.log('   NO Supabase project is contacted by this script.');
const pg = startCluster('032');
console.log('   postgres: ' + pg.PGBIN);

const A  = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222';
const P1 = 'aaaaaaaa-0000-4000-8000-000000000001', P2 = 'aaaaaaaa-0000-4000-8000-000000000002';
const P3 = 'aaaaaaaa-0000-4000-8000-000000000003', P5 = 'aaaaaaaa-0000-4000-8000-000000000005';
const P4 = 'bbbbbbbb-0000-4000-8000-000000000004', PX = 'cccccccc-0000-4000-8000-00000000000c';
const T1 = 'dddddddd-0000-4000-8000-000000000001', T2 = 'dddddddd-0000-4000-8000-000000000002';
const T3 = 'dddddddd-0000-4000-8000-000000000003', T4 = 'dddddddd-0000-4000-8000-000000000004';
const TN = 'dddddddd-0000-4000-8000-00000000000e', TP = 'dddddddd-0000-4000-8000-00000000000f';

const SCHEMA = `
  alter table auth.users add column if not exists created_at timestamptz default now();
  insert into auth.users(id) values ('${A}'),('${B}');
  create table public.properties (
    id uuid primary key default gen_random_uuid(),
    user_id uuid references auth.users(id) on delete cascade,
    name text, archived_at timestamptz,
    lifecycle_stage text not null default 'acquired'
      check (lifecycle_stage in ('prospect','under_review','due_diligence','acquired','passed')));
  create table public.tenants (
    id uuid primary key default gen_random_uuid(),
    property_id uuid references public.properties(id) on delete cascade,
    name text, sqft numeric, cap numeric, start_date date, end_date date, lease_url text, lease_type text,
    constraint tenants_id_property_uniq unique (id, property_id));
  create table public.cam_reconciliations (id uuid primary key default gen_random_uuid(), property_id uuid not null, tenant_id uuid, year integer not null);
  create table public.tenant_field_evidence (id uuid primary key default gen_random_uuid(), property_id uuid not null, tenant_id text not null, field_key text not null);
  create table public.payments (id uuid primary key default gen_random_uuid(), property_id uuid not null, tenant_id uuid not null);
  alter table public.properties enable row level security;
  alter table public.tenants enable row level security;`;

const FIXTURES = `
  delete from public.payments; delete from public.tenant_field_evidence; delete from public.cam_reconciliations;
  delete from public.tenants; delete from public.properties;
  insert into public.properties(id,user_id,name,lifecycle_stage,archived_at) values
    ('${P1}','${A}','A acquired 1','acquired',null),
    ('${P2}','${A}','A acquired 2','acquired',null),
    ('${P3}','${A}','A prospect','prospect',null),
    ('${P5}','${A}','A acquired archived','acquired',now()),
    ('${P4}','${B}','B acquired','acquired',null);
  insert into public.tenants(id,property_id,name) values
    ('${T1}','${P1}','T1 on P1 (payment)'),('${T2}','${P1}','T2 on P1 (unreferenced)'),
    ('${T3}','${P1}','T3 on P1 (evidence)'),('${T4}','${P4}','T4 on P4 (B)');
  insert into public.payments(property_id,tenant_id) values ('${P1}','${T1}');
  insert into public.tenant_field_evidence(property_id,tenant_id,field_key) values ('${P1}','${T3}','sqft');`;

const q = (sql, db) => pg.psql(sql, db);
const rpc = (db, uid, prop, rows) =>
  pg.as('authenticated', uid, `select public.resync_property_tenants('${prop}'::uuid, '${JSON.stringify(rows).replace(/'/g, "''")}'::jsonb);`, db);
const owner = (db, t) => q(`select coalesce(property_id::text, '<none>') from public.tenants where id='${t}';`, db).out;
const name  = (db, t) => q(`select name from public.tenants where id='${t}';`, db).out;
const count = (db, p) => q(`select count(*) from public.tenants where property_id='${p}';`, db).out;
const exists = (db, t) => q(`select exists(select 1 from public.tenants where id='${t}');`, db).out === 't';
const row = (id, nm) => ({ id, name: nm, sqft: 100 });
const parse = (r) => { try { return JSON.parse(r.out); } catch (_) { return { _raw: r.out }; } };
// pg_get_functiondef prints $function$ quoting, `SET search_path TO 'public'` and no
// terminating semicolon; the file has $$, `set search_path to 'public'` and a `;`.
const norm = (s) => strip(s).replace(/\$function\$/g, '$$$$').replace(/set search_path to 'public'/i, 'set search_path = public')
  .replace(/\s+/g, '').toLowerCase().replace(/;$/, '');
const funcdef = (db) => q(`select pg_get_functiondef('public.resync_property_tenants(uuid,jsonb)'::regprocedure);`, db).out;
const acl = (db) => q(`select coalesce(proacl::text,'<default>') from pg_proc where oid='public.resync_property_tenants(uuid,jsonb)'::regprocedure;`, db).out;

function runLiveMatrix(db) {
  const x = pg.psqlText(`select set_config('t032.uid', '${A}', false);\n` + fs.readFileSync(LIVE_MATRIX, 'utf8'), db, 'live-matrix');
  const m = x.out.match(/T032 RESULTS \(everything above rolled back by design\): (\{.*\})/s);
  return { res: m ? JSON.parse(m[1]) : null, raw: x.out, left: q(`select count(*) from public.properties where name like 'T032 %';`, db).out };
}

// ── build ────────────────────────────────────────────────────────────────────
const DB = 'pilotlike';
let r = pg.database(DB, 'legacy');
check('pilotlike: database built under Pilot\'s legacy default privileges', r.ok, r.ok ? '' : r.out.slice(0, 300));
r = q(SCHEMA, DB);
check('pilotlike: stand-in tables for properties, tenants, cam_reconciliations, tenant_field_evidence, payments', r.ok, r.ok ? '' : r.out.slice(0, 300));
r = pg.psqlFile(R032, DB);
check('pilotlike: today\'s definition installed (the rollback file = Pilot\'s live pg_get_functiondef)', r.ok, r.ok ? '' : r.out.slice(0, 300));
const aclBefore = acl(DB);

// ── 1 · baseline ─────────────────────────────────────────────────────────────
section('1 · baseline — the hazard is present with today\'s definition');
q(FIXTURES, DB);
let x = parse(rpc(DB, A, P2, [row(T1, 'T1 moved to P2')]));
check('H2: owner A\'s roster for P2 RE-POINTS T1 from P1 to P2', x.ok === true && owner(DB, T1) === P2, JSON.stringify(x));
x = parse(rpc(DB, A, P3, [row(TP, 'on a prospect')]));
check('a roster is accepted for a PROSPECT', x.ok === true && owner(DB, TP) === P3, JSON.stringify(x));
const before = runLiveMatrix(DB);
check('live-matrix block (today): E3 re-points, E3b re-points, E4 writes', before.res
  && before.res.E3_cross_property_same_owner.ok === true && before.res.E3_cross_property_same_owner.t1_still_on_p1 === false
  && before.res.E3b_cross_property_other_owner.ok === true && before.res.E4_prospect.ok === true, before.res ? '' : before.raw.slice(0, 300));
check('live-matrix block (today): leaves no row behind', before.left === '0', before.left + ' T032 rows');

// ── 2 · apply ────────────────────────────────────────────────────────────────
section('2 · 032 applies, and applies again');
r = pg.psqlFile(M032, DB);
check('pilotlike: 032 applies', r.ok, r.ok ? '' : r.out.slice(0, 400));
r = pg.psqlFile(M032, DB);
check('pilotlike: 032 applies a second time without error', r.ok, r.ok ? '' : r.out.slice(0, 400));
check('the function\'s privileges did not move', acl(DB) === aclBefore, acl(DB) + ' vs ' + aclBefore);
check('still SECURITY DEFINER with search_path = public',
  q(`select (prosecdef and proconfig = array['search_path=public'])::text from pg_proc where oid='public.resync_property_tenants(uuid,jsonb)'::regprocedure;`, DB).out === 'true');

// ── 3 · same property ────────────────────────────────────────────────────────
section('3 · same property — update in place, insert new, never write property_id');
q(FIXTURES, DB);
x = parse(rpc(DB, A, P1, [row(T1, 'T1 renamed'), row(T2, 'T2 on P1 (unreferenced)'), row(T3, 'T3 on P1 (evidence)')]));
check('same property + same id → ok, updated in place', x.ok === true && x.upserted === 3 && name(DB, T1) === 'T1 renamed' && owner(DB, T1) === P1, JSON.stringify(x));
x = parse(rpc(DB, A, P1, [row(T1, 'T1 renamed'), row(T2, 'T2 on P1 (unreferenced)'), row(T3, 'T3 on P1 (evidence)'), row(TN, 'brand new')]));
check('same property + new id → inserted under P1', x.ok === true && x.upserted === 4 && owner(DB, TN) === P1, JSON.stringify(x));
check('032\'s update set does not contain property_id', !/property_id\s*=\s*excluded\.property_id/.test(strip(SQL)));
check('and the update is guarded by the property', /where tenants\.property_id = p_property_id/.test(strip(SQL)));

// ── 4 · cross-property ───────────────────────────────────────────────────────
section('4 · SECURITY — an id that belongs to another property refuses the whole call');
x = parse(rpc(DB, A, P2, [row(T1, 'T1 stolen'), row(TP, 'legit new for P2')]));
check('same owner, other property: refused with cross_property_tenant', x.ok === false && x.code === 'cross_property_tenant', JSON.stringify(x));
check('the refusal names exactly the foreign id', Array.isArray(x.tenant_ids) && x.tenant_ids.length === 1 && x.tenant_ids[0] === T1, JSON.stringify(x.tenant_ids));
check('T1 is still on P1 with its name', owner(DB, T1) === P1 && name(DB, T1) === 'T1 renamed');
check('and NOTHING was written for P2 — not even the legitimate new row', count(DB, P2) === '0' && !exists(DB, TP), count(DB, P2) + ' rows');
x = parse(rpc(DB, A, P1, [row(T1, 'T1 renamed'), row(T4, 'T4 taken from B')]));
check('another user\'s tenant id: refused with cross_property_tenant', x.ok === false && x.code === 'cross_property_tenant' && x.tenant_ids[0] === T4, JSON.stringify(x));
check('T4 is still on B\'s property', owner(DB, T4) === P4);
q(`insert into public.tenants(id,name) values ('eeeeeeee-0000-4000-8000-00000000000e','orphan, no property');`, DB);
x = parse(rpc(DB, A, P1, [row(T1, 'T1 renamed'), row('eeeeeeee-0000-4000-8000-00000000000e', 'adopt orphan')]));
check('an orphan row (property_id null) counts as foreign too', x.ok === false && x.code === 'cross_property_tenant', JSON.stringify(x));
check('and it stays an orphan', owner(DB, 'eeeeeeee-0000-4000-8000-00000000000e') === '<none>');

// ── 5 · lifecycle stage ──────────────────────────────────────────────────────
section('5 · only an acquired property has a roster to write');
for (const stage of ['prospect', 'under_review', 'due_diligence', 'passed']) {
  q(`update public.properties set lifecycle_stage='${stage}' where id='${P3}';`, DB);
  x = parse(rpc(DB, A, P3, [row(TP, 'on a deal')]));
  check(`${stage}: refused with property_not_acquired, stage reported, nothing written`,
    x.ok === false && x.code === 'property_not_acquired' && x.stage === stage && count(DB, P3) === '0', JSON.stringify(x));
}
x = parse(rpc(DB, A, P5, [row('dddddddd-0000-4000-8000-000000000055', 'on archived acquired')]));
check('acquired + archived: written, as before', x.ok === true && x.upserted === 1, JSON.stringify(x));
q(`update public.properties set lifecycle_stage='acquired' where id='${P3}';`, DB);
x = parse(rpc(DB, A, P3, [row(TP, 'now acquired')]));
check('after the transition to acquired the same roster is written', x.ok === true && owner(DB, TP) === P3, JSON.stringify(x));

// ── 6 · authorization ────────────────────────────────────────────────────────
section('6 · authorization is exactly as before');
x = parse(rpc(DB, A, PX, [row(T1, 'x')]));
check('missing property → not_authorized (no existence leak)', x.ok === false && x.code === 'not_authorized', JSON.stringify(x));
x = parse(rpc(DB, B, P1, [row(T1, 'hijack')]));
check('another user → not_authorized, nothing changed', x.ok === false && x.code === 'not_authorized' && name(DB, T1) === 'T1 renamed', JSON.stringify(x));
x = parse(rpc(DB, null, P1, [row(T1, 'anon')]));
check('anonymous (no JWT subject) → not_authorized', x.ok === false && x.code === 'not_authorized', JSON.stringify(x));
check('the stage check runs AFTER the owner check (a stranger learns nothing about a prospect)',
  strip(SQL).indexOf('insufficient_privilege') < strip(SQL).indexOf('property_not_acquired'));

// ── 7 · retention ────────────────────────────────────────────────────────────
section('7 · retention — referenced absentees are kept, unreferenced ones pruned');
q(FIXTURES, DB);
x = parse(rpc(DB, A, P1, [row(TN, 'only the new one')]));
check('T1 (payment) and T3 (evidence) kept, T2 pruned', x.ok === true && x.deleted === 1 && x.retained_referenced === 2
  && exists(DB, T1) && exists(DB, T3) && !exists(DB, T2) && owner(DB, TN) === P1, JSON.stringify(x));
q(`insert into public.cam_reconciliations(property_id,tenant_id,year) values ('${P1}','${TN}',2025);`, DB);
x = parse(rpc(DB, A, P1, [row(T1, 'T1 on P1 (payment)')]));
check('a tenant named by a reconciliation is kept too (TN and T3 absent and referenced → retained 2)',
  x.ok === true && x.retained_referenced === 2 && x.deleted === 0 && exists(DB, TN) && exists(DB, T3), JSON.stringify(x));

// ── 8 · no-ops ───────────────────────────────────────────────────────────────
section('8 · empty and unusable rosters are no-ops');
const n0 = count(DB, P1);
x = parse(rpc(DB, A, P1, []));
check('empty roster → empty_roster, nothing deleted', x.ok === true && x.noop_reason === 'empty_roster' && count(DB, P1) === n0, JSON.stringify(x));
x = parse(rpc(DB, A, P1, [{ id: 'not-a-uuid', name: 'x' }, { id: TN, name: '' }, { name: 'no id at all' }]));
check('all rows unusable → no_usable_rows, skipped 3, nothing deleted', x.ok === true && x.noop_reason === 'no_usable_rows' && x.skipped === 3 && count(DB, P1) === n0, JSON.stringify(x));
check('032 still refuses to mint ids server-side', !/coalesce\(v_tenant_id, gen_random_uuid\(\)\)/.test(strip(SQL)));

// ── 9 · the live-matrix block ────────────────────────────────────────────────
section('9 · the exact live-matrix block, after 032');
q(FIXTURES, DB);
const after = runLiveMatrix(DB);
const R = after.res || {};
check('block ran and reported', !!after.res, after.res ? '' : after.raw.slice(0, 300));
check('E1 same/same ok, name updated, property untouched', R.E1_same_same && R.E1_same_same.ok === true && R.E1_same_same.property_now === true);
check('E2 new id inserted under p1', R.E2_same_new && R.E2_same_new.new_under_p1 === true);
check('E3 same-owner cross-property refused, row stays, target empty', R.E3_cross_property_same_owner && R.E3_cross_property_same_owner.code === 'cross_property_tenant' && R.E3_cross_property_same_owner.t1_still_on_p1 === true && R.E3_cross_property_same_owner.p2_tenant_count === 0);
check('E3b other-owner cross-property refused', R.E3b_cross_property_other_owner && R.E3b_cross_property_other_owner.code === 'cross_property_tenant' && R.E3b_cross_property_other_owner.t4_still_on_p4 === true);
check('E3c orphan tenant id refused, still unowned', R.E3c_orphan_tenant_id && R.E3c_orphan_tenant_id.code === 'cross_property_tenant' && R.E3c_orphan_tenant_id.orphan_still_unowned === true);
check('E4 prospect refused, nothing written', R.E4_prospect && R.E4_prospect.code === 'property_not_acquired' && R.E4_prospect.p3_tenant_count === 0);
check('E5 acquired ok', R.E5_acquired && R.E5_acquired.ok === true);
check('E5b acquired + archived written', R.E5b_acquired_archived && R.E5b_acquired_archived.ok === true && R.E5b_acquired_archived.t5_under_p5 === true);
check('E6 missing / E7 other user / E7b anonymous → not_authorized', R.E6_missing_property && R.E6_missing_property.code === 'not_authorized' && R.E7_unauthorized_user && R.E7_unauthorized_user.code === 'not_authorized' && R.E7_unauthorized_user.t1_name_unchanged === true && R.E7b_anonymous && R.E7b_anonymous.code === 'not_authorized');
check('R1 retention: referenced kept, unreferenced pruned', R.R1_retention && R.R1_retention.t1_kept === true && R.R1_retention.t2_pruned === true);
check('N1/N2 no-ops', R.N1_empty_roster && R.N1_empty_roster.noop_reason === 'empty_roster' && R.N2_unusable_rows && R.N2_unusable_rows.noop_reason === 'no_usable_rows' && R.N2_unusable_rows.tn_kept === true);
check('the block leaves no row behind', after.left === '0', after.left + ' T032 rows');

// ── 10 · additive ────────────────────────────────────────────────────────────
section('10 · 032 is additive');
const body = strip(SQL);
check('exactly one create or replace function', (body.match(/create or replace function/gi) || []).length === 1);
check('exactly two grants, to authenticated and service_role', (body.match(/^\s*grant execute on function public\.resync_property_tenants\(uuid, jsonb\) to (authenticated|service_role);/gm) || []).length === 2);
check('no create/alter/drop of any table, index, policy or trigger, no revoke', !/\b(create|alter|drop)\s+(table|index|policy|trigger|schema|type|view)\b|\brevoke\b|\btruncate\b/i.test(body));
check('touches nothing XRPL, wallet or settlement related', !/rlusd|xrpl|xrp\b|wallet|ripple|settlement/i.test(body));

// ── 11 · rollback ────────────────────────────────────────────────────────────
section('11 · the rollback restores Pilot\'s live definition');
r = pg.psqlFile(R032, DB);
check('pilotlike: rollback runs', r.ok, r.ok ? '' : r.out.slice(0, 300));
check('pg_get_functiondef after rollback equals the rollback file\'s definition (normalised)', norm(funcdef(DB)) === norm(BACK.replace(/^\s*grant execute[^\n]*$/gm, '')));
check('the rollback header says it RE-OPENS the hazard', /RE-OPENS HAZARD H2/.test(BACK));
q(FIXTURES, DB);
x = parse(rpc(DB, A, P2, [row(T1, 'T1 moved again')]));
check('and the old behaviour is back: the re-point succeeds (this is what the rollback costs)', x.ok === true && owner(DB, T1) === P2, JSON.stringify(x));
r = pg.psqlFile(M032, DB);
check('pilotlike: 032 applies again after the rollback', r.ok, r.ok ? '' : r.out.slice(0, 300));
q(FIXTURES, DB);
x = parse(rpc(DB, A, P2, [row(T1, 'T1 moved?')]));
check('and refuses again', x.ok === false && x.code === 'cross_property_tenant' && owner(DB, T1) === P1, JSON.stringify(x));

// ── 12 · fresh model ─────────────────────────────────────────────────────────
section('12 · under the post-2026-10-30 default-privilege model');
const F = 'fresh';
r = pg.database(F, 'post-2026-10-30');
q(SCHEMA, F); q(FIXTURES, F);
r = pg.psqlFile(M032, F);
check('fresh: 032 applies on a database that never had the function', r.ok, r.ok ? '' : r.out.slice(0, 300));
check('fresh: authenticated and service_role may execute it, anon may not',
  pg.canExecute('authenticated', 'public.resync_property_tenants(uuid,jsonb)', F)
  && pg.canExecute('service_role', 'public.resync_property_tenants(uuid,jsonb)', F)
  && !pg.canExecute('anon', 'public.resync_property_tenants(uuid,jsonb)', F));
x = parse(rpc(F, A, P2, [row(T1, 'T1 stolen')]));
check('fresh: the cross-property refusal holds', x.ok === false && x.code === 'cross_property_tenant' && owner(F, T1) === P1, JSON.stringify(x));

T.finish();
