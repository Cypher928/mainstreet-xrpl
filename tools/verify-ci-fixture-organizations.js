'use strict';
/**
 * tools/verify-ci-fixture-organizations.js — the CI fixture organisation leak,
 * reproduced and closed on a throwaway PostgreSQL cluster; and the one-off
 * cleanup for what already leaked, proved to delete exactly its list.
 *
 *   node tools/verify-ci-fixture-organizations.js
 *   MS_PG_SERVER_BIN=/path/to/pg17/bin node tools/verify-ci-fixture-organizations.js
 *
 * It contacts NO Supabase project. The organisations tables, the FK column and
 * the properties_default_organization trigger are loaded VERBATIM from
 * migrations/phase0/024_organizations.sql, the text applied to Pilot, and the
 * trigger's definition md5 is pinned to Pilot's live value so a later change
 * on Pilot is noticed here.
 *
 * WHAT IT PROVES
 *
 *   1  THE LEAK, as scripts/b1-ci-fixture.js and scripts/pilot-live-fixture.js
 *      tore down until 2026-10-07: insert the fixture property → the trigger
 *      creates an organisation named after the landlord's email and an admin
 *      membership; delete the properties, then the user → the membership goes
 *      (CASCADE), the organisation stays with created_by null (SET NULL) and
 *      updated_at bumped — exactly the 88 rows found on Pilot.
 *   2  THE FIX: properties → organisation (id AND created_by AND fixture name,
 *      exactly one row) → user leaves nothing; RESTRICT refuses the organisation
 *      while its property exists; the INSERT ... RETURNING row already carries
 *      organization_id, which is what the scripts record.
 *   3  ORDER MATTERS: once the user is gone, created_by is null and the
 *      three-filter delete matches nothing — the row is an orphan for good.
 *   4  THE ORPHAN PREDICATE selects a true fixture orphan and none of five
 *      decoys: creator gone but a real-looking name; fixture name but owns a
 *      property; fixture name but referenced by property_events; fixture name
 *      but a living user with that email; fixture name but a membership.
 *   5  THE ONE-OFF CLEANUP (tools/ci-fixture-orphan-cleanup.js) on a table of
 *      88 seeded orphans, 14 legitimate organisations and the five decoys:
 *      refuses without the Pilot marker; refuses when any listed id fails any
 *      conjunct of the predicate (one variant per decoy); refuses a duplicated
 *      id and a wrong expected count; refuses when the organisations outside
 *      the list are not the protected set; ABORTS AND ROLLS BACK when the
 *      after-state does not match; then deletes exactly 88, leaves every
 *      legitimate organisation and decoy intact, and refuses to run twice.
 *
 * SKIPS loudly (exit 0, says so) when no PostgreSQL server binary is present.
 */
const fs   = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { startCluster, tally } = require('./_pg-throwaway');
const cleanup = require('./ci-fixture-orphan-cleanup');

const ROOT = path.resolve(__dirname, '..');
const PILOT_TRIGGER_MD5 = '2adccedebbdfa148a33b6fa4ff6141b4';   // pg_get_functiondef(properties_default_organization) on Pilot, 2026-10-07
const MARKER = cleanup.PILOT_MARKER_PROPERTY;

const T = tally();
const C = startCluster('cifixorg');
console.log('server: ' + C.serverVersion());

const m024 = fs.readFileSync(path.join(ROOT, 'migrations/phase0/024_organizations.sql'), 'utf8');
function slice(from, to) {
  const a = m024.indexOf(from), b = m024.indexOf(to, a);
  if (a < 0 || b < 0) throw new Error('024 text: cannot find ' + from);
  return m024.slice(a, b);
}
const DDL_TABLES  = slice('create table if not exists public.organizations', '-- ── The rule, as three helpers');
const DDL_TRIGGER = slice('create or replace function public.properties_default_organization()', '-- ── Backfill');

function loadSchema(db) {
  let r = C.database(db, 'legacy');
  if (!r.ok) return r;
  return C.psqlText(`
    create or replace function public.set_updated_at() returns trigger language plpgsql as $f$
      begin new.updated_at := now(); return new; end $f$;
    create table public.properties (
      id uuid primary key default gen_random_uuid(),
      user_id uuid references auth.users(id) on delete cascade,
      name text, sqft int, data jsonb default '{}'::jsonb,
      created_at timestamptz default now(), updated_at timestamptz default now());
    ${DDL_TABLES}
    ${DDL_TRIGGER}
    -- 028: the only other FK onto organizations on Pilot, ON DELETE SET NULL
    create table public.property_events (
      id uuid primary key default gen_random_uuid(),
      property_id uuid not null references public.properties(id) on delete cascade,
      organization_id uuid references public.organizations(id) on delete set null,
      kind text);
  `, db, 'schema-' + db);
}
const q   = (sql, db) => C.psql(sql, db);
const one = (sql, db) => { const x = C.psql(sql, db); if (!x.ok) throw new Error(x.out); return x.out; };
const PRED = cleanup.orphanPredicate('o');
const orphanCount = (db) => one(`select count(*) from public.organizations o where ${PRED};`, db);

// ── 0  schema from the 024 text ─────────────────────────────────────────────
T.section('0  schema loaded from the 024 text; trigger pinned to Pilot');
let r = loadSchema('leak');
T.check('leak: tables, FK column and trigger loaded verbatim from 024', r.ok, r.ok ? '' : r.out.slice(0, 300));
if (!r.ok) T.finish();
const md5 = one(`select md5(pg_get_functiondef('public.properties_default_organization'::regproc));`, 'leak');
T.check(`properties_default_organization definition md5 is Pilot's (${PILOT_TRIGGER_MD5})`, md5 === PILOT_TRIGGER_MD5,
        md5 === PILOT_TRIGGER_MD5 ? '' : `got ${md5} — the 024 text or Pilot's live function moved; re-read the live definition before trusting this verifier`);
T.check('organizations.created_by is ON DELETE SET NULL (the leak\'s mechanism)',
        /ON DELETE SET NULL/.test(one(`select pg_get_constraintdef(oid) from pg_constraint where conrelid='public.organizations'::regclass and contype='f';`, 'leak')));
T.check('properties.organization_id is ON DELETE RESTRICT (the guard the fix relies on)',
        /ON DELETE RESTRICT/.test(one(`select pg_get_constraintdef(oid) from pg_constraint where conrelid='public.properties'::regclass and contype='f' and conname like '%organization%';`, 'leak')));

// ── 1  the leak ─────────────────────────────────────────────────────────────
T.section('1  the leak, exactly as the fixture scripts tore down until 2026-10-07');
const L = '11111111-1111-4111-8111-111111111111';
one(`insert into auth.users(id,email) values ('${L}','b1ci-999-landlord@pilot.invalid');`, 'leak');
one(`insert into public.properties(user_id,name,sqft) values ('${L}','B1 CI 999 P1',50000),('${L}','B1 CI 999 P2',40000);`, 'leak');
const org = one(`select organization_id from public.properties where user_id='${L}' limit 1;`, 'leak');
T.check('inserting the fixture properties created ONE organisation, named after the landlord email',
        one(`select count(*)||' '||string_agg(distinct name,',') from public.organizations;`, 'leak') === '1 b1ci-999-landlord@pilot.invalid');
T.check('…and one admin membership for the landlord', one(`select count(*) from public.organization_members where organization_id='${org}' and user_id='${L}' and role='admin' and accepted_at is not null;`, 'leak') === '1');
T.check('both properties point at it', one(`select count(*) from public.properties where organization_id='${org}';`, 'leak') === '2');
one(`delete from public.properties where user_id='${L}';`, 'leak');
one(`select pg_sleep(0.05);`, 'leak');
one(`delete from auth.users where id='${L}';`, 'leak');
T.check('after the old teardown: membership gone (CASCADE)', one(`select count(*) from public.organization_members where organization_id='${org}';`, 'leak') === '0');
T.check('after the old teardown: THE ORGANISATION SURVIVES', one(`select count(*) from public.organizations where id='${org}';`, 'leak') === '1');
T.check('…with created_by null (SET NULL)', one(`select created_by is null from public.organizations where id='${org}';`, 'leak') === 't');
T.check('…and updated_at bumped by the set-null UPDATE (Pilot: 88/88 have updated_at > created_at)', one(`select updated_at > created_at from public.organizations where id='${org}';`, 'leak') === 't');
T.check('it is exactly what the orphan predicate selects', orphanCount('leak') === '1');
one(`delete from public.organizations where id='${org}';`, 'leak');

// ── 2  the fix ──────────────────────────────────────────────────────────────
T.section('2  the fix: properties → organisation (three filters, one row) → user');
const L2 = '22222222-2222-4222-8222-222222222222';
one(`insert into auth.users(id,email) values ('${L2}','plci-998-a@pilot.invalid');`, 'leak');
const org2 = one(`insert into public.properties(user_id,name,sqft) values ('${L2}','Pilot Live CI 998 — A',60000) returning organization_id;`, 'leak');
T.check('INSERT ... RETURNING already carries organization_id (what PostgREST return=representation hands the script)', /^[0-9a-f-]{36}$/.test(org2));
T.check('RESTRICT refuses the organisation while its property exists', !q(`delete from public.organizations where id='${org2}';`, 'leak').ok);
one(`delete from public.properties where user_id='${L2}';`, 'leak');
T.check('the guarded delete (id AND created_by AND fixture name) removes exactly one row',
        one(`with d as (delete from public.organizations where id='${org2}' and created_by='${L2}' and name ~ '^plci-[a-z0-9]+-[a-z]+@pilot\\.invalid$' returning 1) select count(*) from d;`, 'leak') === '1');
T.check('its membership went with it (CASCADE from organizations)', one(`select count(*) from public.organization_members where organization_id='${org2}';`, 'leak') === '0');
one(`delete from auth.users where id='${L2}';`, 'leak');
T.check('nothing left: 0 organisations, 0 memberships, 0 properties, 0 users',
        one(`select (select count(*) from public.organizations)::text||(select count(*) from public.organization_members)::text||(select count(*) from public.properties)::text||(select count(*) from auth.users)::text;`, 'leak') === '0000');

// ── 3  order ────────────────────────────────────────────────────────────────
T.section('3  the wrong order (user first) defeats the created_by guard');
const L3 = '33333333-3333-4333-8333-333333333333';
one(`insert into auth.users(id,email) values ('${L3}','b1ci-997-landlord@pilot.invalid');`, 'leak');
const org3 = one(`insert into public.properties(user_id,name,sqft) values ('${L3}','B1 CI 997 P1',1) returning organization_id;`, 'leak');
one(`delete from public.properties where user_id='${L3}'; delete from auth.users where id='${L3}';`, 'leak');
T.check('after the user is gone, id + created_by matches 0 rows', one(`with d as (delete from public.organizations where id='${org3}' and created_by='${L3}' returning 1) select count(*) from d;`, 'leak') === '0');
T.check('the organisation is an orphan', one(`select count(*) from public.organizations where id='${org3}' and created_by is null;`, 'leak') === '1');

// ── 4  the predicate against decoys ─────────────────────────────────────────
T.section('4  the orphan predicate selects fixture orphans and nothing else');
const R1 = '44444444-4444-4444-8444-444444444444', R2 = '55555555-5555-4555-8555-555555555555';
one(`insert into auth.users(id,email) values ('${R1}','owner@example.com'),('${R2}','second@example.com');`, 'leak');
one(`insert into public.properties(user_id,name,sqft) values ('${R1}','Real Plaza',1);`, 'leak');
one(`insert into public.organizations(name,created_by) values ('second@example.com','${R2}');`, 'leak');
one(`insert into public.organizations(id,name,created_by) values ('66666666-6666-4666-8666-666666666666','gone-user@example.com',null);`, 'leak');
one(`insert into public.organizations(id,name,created_by) values ('77777777-7777-4777-8777-777777777777','b1ci-1-landlord@pilot.invalid',null);
     insert into public.properties(user_id,name,sqft,organization_id) values ('${R1}','Adopted',1,'77777777-7777-4777-8777-777777777777');`, 'leak');
one(`insert into public.organizations(id,name,created_by) values ('88888888-8888-4888-8888-888888888888','plci-2-a@pilot.invalid',null);
     insert into public.property_events(property_id,organization_id,kind) select id,'88888888-8888-4888-8888-888888888888','x' from public.properties where name='Real Plaza';`, 'leak');
one(`insert into public.organizations(id,name,created_by) values ('99999999-9999-4999-8999-999999999999','b1ci-3-landlord@pilot.invalid',null);
     insert into auth.users(id,email) values ('99999999-9999-4999-8999-000000000099','b1ci-3-landlord@pilot.invalid');`, 'leak');
one(`insert into public.organizations(id,name,created_by) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','plci-4-a@pilot.invalid',null);
     insert into public.organization_members(organization_id,user_id,role) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','${R1}','read_only');`, 'leak');
T.check('8 organisations on the table', one(`select count(*) from public.organizations;`, 'leak') === '8');
T.check('the predicate selects exactly the one true fixture orphan (from §3)', one(`select string_agg(id::text,',') from public.organizations o where ${PRED};`, 'leak') === org3);
T.check('NOT selected: creator gone, real-looking name', one(`select count(*) from public.organizations o where ${PRED} and o.id='66666666-6666-4666-8666-666666666666';`, 'leak') === '0');
T.check('NOT selected: fixture name, owns a property', one(`select count(*) from public.organizations o where ${PRED} and o.id='77777777-7777-4777-8777-777777777777';`, 'leak') === '0');
T.check('NOT selected: fixture name, referenced by property_events', one(`select count(*) from public.organizations o where ${PRED} and o.id='88888888-8888-4888-8888-888888888888';`, 'leak') === '0');
T.check('NOT selected: fixture name, a living user has that email', one(`select count(*) from public.organizations o where ${PRED} and o.id='99999999-9999-4999-8999-999999999999';`, 'leak') === '0');
T.check('NOT selected: fixture name, has a membership', one(`select count(*) from public.organizations o where ${PRED} and o.id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';`, 'leak') === '0');
T.check('NOT selected: any organisation with a living creator (incl. one with no members and no properties)', one(`select count(*) from public.organizations o where ${PRED} and o.created_by is not null;`, 'leak') === '0');

// ── 5  the one-off cleanup ──────────────────────────────────────────────────
T.section('5  the one-off cleanup deletes exactly its list and refuses everything else');
r = loadSchema('cleanup');
T.check('cleanup: schema loaded', r.ok, r.ok ? '' : r.out.slice(0, 300));
if (!r.ok) T.finish();
const DB = 'cleanup';
const uid = (p, n) => `${p}-0000-4000-8000-${String(n).padStart(12, '0')}`;
{
  const sql = [];
  // 13 legitimate users: 9 with a property (the trigger makes their organisation), 4 with an organisation but no property
  for (let n = 1; n <= 13; n++) sql.push(`insert into auth.users(id,email) values ('${uid('bbbbbbbb', n)}','user${n}@example.com');`);
  for (let n = 1; n <= 9; n++)  sql.push(`insert into public.properties(user_id,name,sqft) values ('${uid('bbbbbbbb', n)}','Plaza ${n}',${n * 1000});`);
  for (let n = 10; n <= 13; n++) sql.push(`insert into public.organizations(id,name,created_by) values ('${uid('cccccccc', n)}','user${n}@example.com','${uid('bbbbbbbb', n)}');
    insert into public.organization_members(organization_id,user_id,role,accepted_at) values ('${uid('cccccccc', n)}','${uid('bbbbbbbb', n)}','admin',now());`);
  // 88 orphans: 33 b1 landlords, 55 pilot-live user A, created over three weeks, each updated when its creator was deleted
  for (let n = 1; n <= 88; n++) {
    const name = n <= 33 ? `b1ci-${37400000000 + n}-landlord@pilot.invalid` : `plci-${37400000000 + n}-a@pilot.invalid`;
    sql.push(`insert into public.organizations(id,name,created_by,created_at,updated_at) values ('${uid('aaaaaaaa', n)}','${name}',null,now()-interval '${90 - n} hours',now()-interval '${90 - n} hours'+interval '37 seconds');`);
  }
  // five decoys
  sql.push(`insert into public.organizations(id,name,created_by) values ('${uid('dddddddd', 1)}','gone-user@example.com',null);`);
  sql.push(`insert into public.organizations(id,name,created_by) values ('${uid('dddddddd', 2)}','b1ci-1-landlord@pilot.invalid',null);
    insert into public.properties(user_id,name,sqft,organization_id) values ('${uid('bbbbbbbb', 1)}','Adopted',1,'${uid('dddddddd', 2)}');`);
  sql.push(`insert into public.organizations(id,name,created_by) values ('${uid('dddddddd', 3)}','plci-2-a@pilot.invalid',null);
    insert into public.property_events(property_id,organization_id,kind) select id,'${uid('dddddddd', 3)}','x' from public.properties where name='Plaza 1';`);
  sql.push(`insert into public.organizations(id,name,created_by) values ('${uid('dddddddd', 4)}','b1ci-3-landlord@pilot.invalid',null);
    insert into auth.users(id,email) values ('${uid('bbbbbbbb', 99)}','b1ci-3-landlord@pilot.invalid');`);
  sql.push(`insert into public.organizations(id,name,created_by) values ('${uid('dddddddd', 5)}','plci-4-a@pilot.invalid',null);
    insert into public.organization_members(organization_id,user_id,role) values ('${uid('dddddddd', 5)}','${uid('bbbbbbbb', 1)}','read_only');`);
  r = C.psqlText(sql.join('\n'), DB, 'seed');
  T.check('seeded 13 legitimate organisations, 88 orphans and 5 decoys', r.ok && one(`select count(*) from public.organizations;`, DB) === '106', r.ok ? one(`select count(*) from public.organizations;`, DB) : r.out.slice(0, 300));
}
T.check('the predicate finds exactly the 88 seeded orphans', orphanCount(DB) === '88');
const orphanIds = one(`select string_agg(id::text, ',' order by id) from public.organizations o where ${PRED};`, DB).split(',');
T.check('…all of them under the aaaaaaaa- prefix', orphanIds.length === 88 && orphanIds.every(id => id.startsWith('aaaaaaaa-')));

// the pre-check the person runs first
const pre = q(cleanup.PRECHECK_SQL, DB);
const preRow = (k) => (pre.out.split('\n').find(l => l.startsWith(k + '|')) || '').split('|')[1];
T.check('--precheck SQL runs and reports 88 orphans', pre.ok && preRow('b orphans (expected)') === '88', pre.ok ? '' : pre.out.slice(0, 200));

// protected set, as the pre-check reads it — BEFORE the marker exists
let protectedCount = Number(preRow('d protected count')), protectedIds = preRow('e protected ids md5'), protectedRows = preRow('f protected rows md5');
T.check('pre-check protected set: 18 organisations (13 legitimate + 5 decoys)', protectedCount === 18 && /^[0-9a-f]{32}$/.test(protectedIds) && /^[0-9a-f]{32}$/.test(protectedRows));
const build = (ids, over = {}) => cleanup.buildCleanupSql({ ids, expected: ids.length, protectedCount, protectedIdsMd5: protectedIds, protectedRowsMd5: protectedRows, generatedAt: 'test', ...over });
const totalBefore = () => one(`select count(*) from public.organizations;`, DB);

let run = C.psqlText(build(orphanIds), DB, 'no-marker');
T.check('REFUSES without the Pilot marker property, deleting nothing', !run.ok && /REFUSING: pilot marker property not found/.test(run.out) && orphanCount(DB) === '88', run.out.slice(-200));

// the marker: a user + the marker property (the trigger gives it an organisation, which joins the protected set)
one(`insert into auth.users(id,email) values ('${uid('eeeeeeee', 1)}','marker@example.com');
     insert into public.properties(id,user_id,name,sqft) values ('${MARKER}','${uid('eeeeeeee', 1)}','Pilot marker',1);`, DB);
const pre2 = q(cleanup.PRECHECK_SQL, DB);
const pre2Row = (k) => (pre2.out.split('\n').find(l => l.startsWith(k + '|')) || '').split('|')[1];
protectedCount = Number(pre2Row('d protected count')); protectedIds = pre2Row('e protected ids md5'); protectedRows = pre2Row('f protected rows md5');
T.check('with the marker, the protected set is 19 and the orphans are still 88', protectedCount === 19 && pre2Row('b orphans (expected)') === '88');
const TOTAL = totalBefore();
T.check('107 organisations in total before the cleanup', TOTAL === '107');

const decoys = [1, 2, 3, 4, 5].map(n => uid('dddddddd', n));
const decoyWhy = ['creator gone but a real-looking name', 'fixture name but owns a property', 'fixture name but referenced by property_events', 'fixture name but a living user has that email', 'fixture name but has a membership'];
decoys.forEach((d, i) => {
  const ids = orphanIds.slice(); ids[i] = d;                          // 88 ids, one of them a decoy
  const v = C.psqlText(build(ids), DB, 'decoy' + i);
  T.check(`REFUSES a list holding a decoy (${decoyWhy[i]}): 87 of 88 match, nothing deleted`,
          !v.ok && /REFUSING: 87 of the 88 listed organisations match the orphan predicate/.test(v.out) && totalBefore() === TOTAL, v.out.slice(-220));
});
{
  let threw = null; try { build(orphanIds.slice(0, 87).concat(orphanIds[0])); } catch (e) { threw = e.message; }
  T.check('the builder refuses a duplicated id', /duplicates/.test(threw || ''), threw);
  threw = null; try { build(orphanIds, { expected: 87 }); } catch (e) { threw = e.message; }
  T.check('the builder refuses an expected count that is not the list length', /must equal the number of ids/.test(threw || ''), threw);
  threw = null; try { build(orphanIds.concat(['not-a-uuid'])); } catch (e) { threw = e.message; }
  T.check('the builder refuses a non-uuid id', /not a lower-case uuid/.test(threw || ''), threw);
  threw = null; try { build(orphanIds, { protectedIdsMd5: 'xyz' }); } catch (e) { threw = e.message; }
  T.check('the builder refuses a malformed md5', /32 hex/.test(threw || ''), threw);
}
{
  const good = build(orphanIds);
  const dup = good.replace(`'${orphanIds[1]}'`, `'${orphanIds[0]}'`);        // same length, one id twice (bypasses the builder)
  const v = C.psqlText(dup, DB, 'dup');
  T.check('the SQL itself REFUSES a duplicated id (88 entries, 87 distinct)', !v.ok && /REFUSING: the id list holds 88 entries, expected 88 distinct/.test(v.out) && totalBefore() === TOTAL, v.out.slice(-200));
  const wrongN = good.replace('v_expected       constant int    := 88', 'v_expected       constant int    := 87');
  const w = C.psqlText(wrongN, DB, 'wrongn');
  T.check('the SQL itself REFUSES when the list length is not v_expected', !w.ok && /REFUSING: the id list holds 88 entries, expected 87/.test(w.out) && totalBefore() === TOTAL, w.out.slice(-200));
}
{
  const v = C.psqlText(build(orphanIds, { protectedIdsMd5: '00000000000000000000000000000000' }), DB, 'wrongprot');
  T.check('REFUSES when the organisations outside the list are not the expected protected set, nothing deleted',
          !v.ok && /REFUSING: the organisations outside the list are not the expected set \(19 rows/.test(v.out) && totalBefore() === TOTAL, v.out.slice(-220));
  const v2 = C.psqlText(build(orphanIds, { protectedCount: 18 }), DB, 'wrongcount');
  T.check('REFUSES when the protected count is wrong, nothing deleted', !v2.ok && /REFUSING: the organisations outside the list are not the expected set/.test(v2.out) && totalBefore() === TOTAL, v2.out.slice(-200));
}
{
  const v = C.psqlText(build(orphanIds, { protectedRowsMd5: '00000000000000000000000000000000' }), DB, 'abort');
  T.check('ABORTS after the delete when the after-state is not the protected set…', !v.ok && /ABORT: after the delete the remaining organisations are not the protected set/.test(v.out), v.out.slice(-220));
  T.check('…and the transaction ROLLED BACK: 88 orphans and 107 organisations still there', orphanCount(DB) === '88' && totalBefore() === TOTAL);
}
{
  const good = build(orphanIds);
  const v = C.psqlText(good, DB, 'success');
  T.check('the real build runs to COMMIT', v.ok, v.out.slice(-300));
  T.check('exactly 88 organisations deleted: 107 → 19', totalBefore() === '19');
  T.check('0 orphans remain by the predicate', orphanCount(DB) === '0');
  T.check('every legitimate organisation is intact (13 + the marker\'s)', one(`select count(*) from public.organizations o where o.created_by is not null and exists (select 1 from auth.users u where u.id=o.created_by);`, DB) === '14');
  T.check('every decoy is intact', one(`select count(*) from public.organizations where id::text like 'dddddddd-%';`, DB) === '5');
  T.check('the protected rows are byte-identical (rows md5 unchanged)', one(`select md5(string_agg(o::text, '|' order by o.id)) from public.organizations o;`, DB) === protectedRows);
  T.check('memberships untouched', one(`select count(*) from public.organization_members;`, DB) === one(`select 9 + 4 + 1 + 1;`, DB));
  T.check('the after-state result reports 0 orphans', /orphans matching the predicate \(expect 0\)\s*\|\s*0\b/.test(v.out), v.out.slice(-400));
  const again = C.psqlText(good, DB, 'again');
  T.check('running the same SQL again REFUSES (0 of 88 match) and changes nothing', !again.ok && /REFUSING: 0 of the 88 listed organisations match/.test(again.out) && totalBefore() === '19', again.out.slice(-200));
}
{
  // the CLI builds the same text (bar the timestamp) from an ids file with comment lines
  const tmp = path.join(require('os').tmpdir(), `ms-orphan-ids-${process.pid}.txt`);
  fs.writeFileSync(tmp, '# comment line\n' + orphanIds.slice(0, 44).join(',') + '\n' + orphanIds.slice(44).join(',') + '\n');
  let cli = '';
  try {
    cli = execFileSync(process.execPath, [path.join(__dirname, 'ci-fixture-orphan-cleanup.js'), tmp, '--expected', '88', '--protected-count', String(protectedCount), '--protected-ids-md5', protectedIds, '--protected-rows-md5', protectedRows], { encoding: 'utf8' });
  } catch (e) { cli = 'CLI FAILED: ' + (e.stdout || '') + (e.stderr || ''); }
  finally { try { fs.unlinkSync(tmp); } catch (_) {} }
  const strip = (s) => s.replace(/^-- Generated .*$/m, '-- Generated X');
  T.check('the CLI builds the same SQL from an ids file (comments ignored)', strip(cli) === strip(build(orphanIds)), cli.slice(0, 200));
  let bad = '';
  try { execFileSync(process.execPath, [path.join(__dirname, 'ci-fixture-orphan-cleanup.js'), tmp + '.missing', '--expected', '88'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); bad = 'exit 0'; }
  catch (e) { bad = 'exit ' + e.status; }
  T.check('the CLI exits non-zero without its arguments', bad === 'exit 2', bad);
}

T.finish();
