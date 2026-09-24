'use strict';
/**
 * tools/verify-migration-031.js — run 031 for real, against nothing that
 * matters, and prove it adopts Pilot's hand-made pilot_requests table without
 * touching a lead, creates the same table where none exists, and leaves the
 * one caller able to write.
 *
 *   node tools/verify-migration-031.js
 *
 * It touches NO Supabase project. It builds a throwaway PostgreSQL cluster.
 *
 * THREE DATABASES
 *
 *   pilotlike   legacy default privileges; the table created by the SQL that
 *               docs/PILOT_REQUESTS_SETUP.md carried (what Pilot ran by hand),
 *               holding leads — Pilot's exact situation.
 *   fresh       post-2026-10-30 default privileges; no table. 031 creates it.
 *   drift       legacy; a table of the same name but a DIFFERENT shape. 031
 *               must refuse and change nothing.
 *
 * WHAT IT PROVES
 *
 *   1  baseline: on pilotlike anon and authenticated hold every privilege
 *   2  031 applies, and applies again, on pilotlike and fresh
 *   3  pilotlike: every existing row is byte-identical; the table, columns,
 *      constraints and indexes are unchanged; RLS is on with no policy
 *   4  fresh: the table 031 creates is identical in shape to Pilot's
 *   5  EXACT privilege matrix in both: service_role {INSERT}; nothing else
 *   6  the one caller works: api/pilot-request.js's POST with
 *      `Prefer: return=minimal`, executed as service_role in the statement shape
 *      PostgREST sends — INSERT … RETURNING 1 — succeeds with INSERT alone
 *   7  refusals (42501): anon and authenticated cannot insert or read;
 *      service_role cannot read, update or delete leads through the API
 *   8  drift: 031 refuses a table of another shape, or without its primary key,
 *      and leaves its grants and rows exactly as they were
 *   9  the rollback restores Pilot's observed grants and does NOT drop the
 *      table or any row; 031 applies again after it
 */
const path = require('path');
const { startCluster, tally, show, denied } = require('./_pg-throwaway');

const ROOT = path.join(__dirname, '..');
const MIG  = path.join(ROOT, 'migrations');
const M031 = path.join(MIG, '031_pilot_requests.sql');
const R031 = path.join(MIG, '031_pilot_requests_rollback.sql');

const T = tally();
const { check, section } = T;

// The SQL docs/PILOT_REQUESTS_SETUP.md carried before 031 — what Pilot ran by hand.
const HAND_MADE = `
create table if not exists public.pilot_requests (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  name        text not null,
  company     text not null,
  email       text not null,
  properties  text not null,
  lease_name  text,
  lease_path  text,
  source      text,
  user_agent  text
);
alter table public.pilot_requests enable row level security;
create index if not exists pilot_requests_created_at_idx
  on public.pilot_requests (created_at desc);`;

const ALL = 'DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE';
const EXPECT   = { anon: '', authenticated: '', service_role: 'INSERT' };
const OBSERVED = { anon: ALL, authenticated: ALL, service_role: ALL };   // Pilot today, read-only catalog query

// api/pilot-request.js: POST /rest/v1/pilot_requests, Prefer: return=minimal,
// one JSON object. This is the statement PostgREST builds for it: the payload
// through json_populate_recordset, the columns taken from the object's keys,
// RETURNING 1 because no representation is asked for.
function postgrestMinimalInsert(payload) {
  const cols = Object.keys(payload).sort().map(c => `"${c}"`).join(', ');
  const json = JSON.stringify(payload).replace(/'/g, "''");
  return `
    WITH pgrst_source AS (
      WITH pgrst_payload AS (SELECT '${json}'::json AS json_data),
           pgrst_body AS (SELECT CASE WHEN json_typeof(json_data) = 'array' THEN json_data
                                      ELSE json_build_array(json_data) END AS val FROM pgrst_payload)
      INSERT INTO "public"."pilot_requests"(${cols})
      SELECT ${cols} FROM json_populate_recordset(null::"public"."pilot_requests", (SELECT val FROM pgrst_body)) _
      RETURNING 1
    )
    SELECT '' AS total_result_set, pg_catalog.count(_postgrest_t) AS page_total,
           array[]::text[] AS header, ''::text AS body
      FROM (SELECT * FROM pgrst_source) _postgrest_t;`;
}
const LEAD = (n) => ({
  name: 'Visitor ' + n, company: 'Co ' + n, email: `v${n}@example.com`, properties: '3',
  lease_name: n % 2 ? 'lease.pdf' : null, lease_path: n % 2 ? `2026/lead-${n}.pdf` : null,
  source: 'home', user_agent: 'Mozilla/5.0 (verifier)',
});

console.log('\n══ migration 031 — executed against a throwaway cluster ══');
console.log('   NO Supabase project is contacted by this script.');
const pg = startCluster('031');
console.log('   postgres: ' + pg.PGBIN);

const q = (sql, db) => pg.psql(sql, db);
function matrix(db, want, label) {
  for (const [role, w] of Object.entries(want)) {
    const got = pg.privs('public.pilot_requests', role, db);
    check(`${db}: ${label} pilot_requests · ${role} = {${show(w)}}`, got === w, got === w ? '' : 'got {' + show(got) + '}');
  }
}
const shape = (db) => q(`
  select 'col|'||column_name||'|'||data_type||'|'||is_nullable||'|'||coalesce(column_default,'')||'|'||ordinal_position
    from information_schema.columns where table_schema='public' and table_name='pilot_requests'
  union all select 'con|'||conname||'|'||pg_get_constraintdef(oid) from pg_constraint where conrelid='public.pilot_requests'::regclass
  union all select 'idx|'||indexdef from pg_indexes where schemaname='public' and tablename='pilot_requests'
  union all select 'rls|'||relrowsecurity::text||'|'||relforcerowsecurity::text from pg_class where oid='public.pilot_requests'::regclass
  union all select 'pol|'||count(*)::text from pg_policies where schemaname='public' and tablename='pilot_requests'
  order by 1;`, db).out;
const rows = (db) => q(`select count(*)||':'||coalesce(string_agg(md5(r::text), ',' order by r.id), '') from public.pilot_requests r;`, db).out;

// ── build ────────────────────────────────────────────────────────────────────
section('build');
check('pilotlike: prerequisites', pg.database('pilotlike', 'legacy').ok);
const hm = q(HAND_MADE, 'pilotlike');
check('pilotlike: the hand-made table, from the setup doc\'s SQL', hm.ok, hm.ok ? '' : hm.out);
const seed = q(`insert into public.pilot_requests (name, company, email, properties, lease_name, lease_path, source, user_agent, created_at) values
  ('Lead One','Acme','one@example.com','2',null,null,'home','UA/1', '2026-08-01T10:00:00Z'),
  ('Lead Two','Beta','two@example.com','5','l.pdf','2026/l.pdf','pricing','UA/2', '2026-08-15T11:00:00Z'),
  ('Lead Three','Gamma','three@example.com','1',null,null,null,null, '2026-09-01T12:00:00Z'),
  ('Lead Four','Delta','four@example.com','12',null,null,'home','UA/4', '2026-09-20T13:00:00Z');`, 'pilotlike');
check('pilotlike: four existing leads (Pilot holds four)', seed.ok, seed.ok ? '' : seed.out);
check('fresh: prerequisites (post-2026-10-30 model)', pg.database('fresh', 'post-2026-10-30').ok);
check('fresh: no pilot_requests table yet', q(`select to_regclass('public.pilot_requests') is null;`, 'fresh').out === 't');

// ── 1 · baseline ─────────────────────────────────────────────────────────────
section('1 · baseline — the hand-made table on Pilot');
matrix('pilotlike', OBSERVED, 'before 031 (reproduces Pilot):');
const shapeBefore = shape('pilotlike');
const rowsBefore = rows('pilotlike');

// ── 2 · apply ────────────────────────────────────────────────────────────────
section('2 · 031 applies, and applies again');
for (const db of ['pilotlike', 'fresh']) {
  const a = pg.psqlFile(M031, db); check(`${db}: 031 applies`, a.ok, a.ok ? '' : a.out.slice(0, 300));
  const b = pg.psqlFile(M031, db); check(`${db}: 031 applies a second time`, b.ok, b.ok ? '' : b.out.slice(0, 300));
}

// ── 3 · Pilot's data untouched ───────────────────────────────────────────────
section('3 · pilotlike — the existing table and every lead untouched');
check('every existing lead is byte-identical', rows('pilotlike') === rowsBefore && rowsBefore.startsWith('4:'), rowsBefore.split(':')[0] + ' rows');
check('columns, constraints, indexes, RLS and (zero) policies are unchanged', shape('pilotlike') === shapeBefore, '');
check('RLS is on, with no policy', /rls\|true\|false/.test(shapeBefore) && /pol\|0/.test(shapeBefore));

// ── 4 · fresh shape ──────────────────────────────────────────────────────────
section('4 · fresh — 031 creates exactly the table Pilot has');
check('the created table is identical in shape to Pilot\'s hand-made one', shape('fresh') === shapeBefore,
  shape('fresh') === shapeBefore ? '' : shape('fresh').slice(0, 200));

// ── 5 · matrices ─────────────────────────────────────────────────────────────
section('5 · exact privilege matrix');
matrix('pilotlike', EXPECT, 'after 031:');
matrix('fresh', EXPECT, 'after 031:');
check('PUBLIC holds nothing', pg.privs('public.pilot_requests', 'public', 'pilotlike') === '' && pg.privs('public.pilot_requests', 'public', 'fresh') === '');

// ── 6 · the caller ───────────────────────────────────────────────────────────
function caller(db) {
  section(`${db}: 6 · api/pilot-request.js still records a lead`);
  const before = Number(rows(db).split(':')[0]);
  const r = pg.as('service_role', null, postgrestMinimalInsert(LEAD(1)), db);
  check(`${db}: POST return=minimal as service_role — INSERT … RETURNING 1 — succeeds with INSERT only`, r.ok, r.out.slice(0, 160));
  const r2 = pg.as('service_role', null, postgrestMinimalInsert(LEAD(2)), db);
  check(`${db}: and again with no sample lease (null lease fields)`, r2.ok, r2.out.slice(0, 160));
  check(`${db}: exactly two leads were recorded`, Number(rows(db).split(':')[0]) === before + 2);
  const got = q(`select name||'|'||company||'|'||email||'|'||properties||'|'||coalesce(lease_path,'-')||'|'||(id is not null)::text||'|'||(created_at is not null)::text
                   from public.pilot_requests where email='v1@example.com';`, db).out;
  check(`${db}: the lead holds what was sent, with id and created_at defaulted`,
    got === 'Visitor 1|Co 1|v1@example.com|3|2026/lead-1.pdf|true|true', got);
  // What return=representation WOULD need — proves the minimal preference is load-bearing.
  const rep = pg.as('service_role', null, `insert into public.pilot_requests (name, company, email, properties) values ('x','x','x@x','1') returning *;`, db);
  check(`${db}: (control) a representation insert — RETURNING * — is refused: SELECT is not granted`, denied(rep), rep.ok ? 'NOT refused' : rep.out.split('\n')[0].slice(0, 80));

  section(`${db}: 7 · refusals (42501)`);
  const refusals = [
    ['anon cannot insert (the browser never writes here)', 'anon', postgrestMinimalInsert(LEAD(9))],
    ['anon cannot read leads', 'anon', `select count(*) from public.pilot_requests;`],
    ['authenticated cannot insert', 'authenticated', postgrestMinimalInsert(LEAD(9))],
    ['authenticated cannot read leads', 'authenticated', `select count(*) from public.pilot_requests;`],
    ['service_role cannot read leads through the API', 'service_role', `select count(*) from public.pilot_requests;`],
    ['service_role cannot update a lead', 'service_role', `update public.pilot_requests set email = 'x';`],
    ['service_role cannot delete leads', 'service_role', `delete from public.pilot_requests;`],
    ['service_role cannot truncate', 'service_role', `truncate public.pilot_requests;`],
  ];
  for (const [name, role, sql] of refusals) {
    const r = pg.as(role, role === 'authenticated' ? '11111111-1111-4111-8111-111111111111' : null, sql, db);
    check(`${db}: ${name}`, denied(r), r.ok ? 'NOT refused' : r.out.split('\n')[0].slice(0, 80));
  }
}
caller('pilotlike');
caller('fresh');

// ── 8 · drift ────────────────────────────────────────────────────────────────
section('8 · a table of another shape is refused, and nothing changes');
const driftCases = [
  ['a column is missing (no user_agent)', HAND_MADE.replace(/,\s*user_agent\s+text/, '')],
  ['a column is nullable that should not be (email)', HAND_MADE.replace('email       text not null', 'email       text')],
  ['a column has another type (properties integer)', HAND_MADE.replace('properties  text not null', 'properties  integer not null')],
  ['an extra column', HAND_MADE.replace('user_agent  text', 'user_agent  text,\n  notes text')],
  ['no primary key', HAND_MADE.replace('id          uuid primary key default gen_random_uuid()', 'id          uuid not null default gen_random_uuid()')],
];
driftCases.forEach(([label, sql], i) => {
  const db = 'drift' + i;
  pg.database(db, 'legacy');
  const mk = q(sql, db);
  // '1' is an untyped literal, so it fits the integer variant too.
  q(`insert into public.pilot_requests (name, company, email, properties) values ('Keep','Me','keep@example.com','1');`, db);
  const g0 = pg.privs('public.pilot_requests', 'anon', db) + '/' + pg.privs('public.pilot_requests', 'service_role', db);
  const r0 = rows(db);
  const a = pg.psqlFile(M031, db);
  check(`${label}: 031 REFUSES TO RUN`, mk.ok && !a.ok && /REFUSING TO RUN/.test(a.out), (a.out.match(/REFUSING TO RUN[^\n]{0,70}/) || [a.ok ? 'applied' : a.out.slice(0, 80)])[0]);
  check(`${label}: grants and rows exactly as they were`,
    pg.privs('public.pilot_requests', 'anon', db) + '/' + pg.privs('public.pilot_requests', 'service_role', db) === g0 && rows(db) === r0 && r0.startsWith('1:'));
});

// ── 9 · rollback ─────────────────────────────────────────────────────────────
section('9 · the rollback restores the grants and keeps every lead');
const leadsBefore = rows('pilotlike');
const rb = pg.psqlFile(R031, 'pilotlike');
check('pilotlike: rollback runs', rb.ok, rb.ok ? '' : rb.out.slice(0, 300));
check('the table still exists', q(`select to_regclass('public.pilot_requests') is not null;`, 'pilotlike').out === 't');
check('every lead is still there, byte-identical', rows('pilotlike') === leadsBefore && leadsBefore.startsWith('6:'), leadsBefore.split(':')[0] + ' rows');
matrix('pilotlike', OBSERVED, 'after rollback:');
const again = pg.psqlFile(M031, 'pilotlike');
check('pilotlike: 031 applies again after the rollback', again.ok, again.ok ? '' : again.out.slice(0, 300));
matrix('pilotlike', EXPECT, 'after re-apply:');

T.finish();
