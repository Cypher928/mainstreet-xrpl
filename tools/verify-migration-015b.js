'use strict';
/**
 * tools/verify-migration-015b.js — run 015b for real, against nothing that
 * matters, and prove tenant_users / tenant_invitations end with exactly the
 * privileges their callers use, whichever way the project was built.
 *
 *   node tools/verify-migration-015b.js
 *
 * It touches NO Supabase project. It builds a throwaway PostgreSQL cluster and
 * applies the repo's own migrations to it.
 *
 * TWO DATABASES
 *
 *   pilotlike   everything built under the LEGACY default privileges, as Pilot
 *               was: 012–015 inherit every privilege for authenticated and
 *               service_role.
 *   post        000–011 built under the legacy model (they predate the change
 *               everywhere), then the project switches to the post-2026-10-30
 *               model and 012–015 are applied — so they get NOTHING unless a
 *               migration grants it. This is the break 015b exists to prevent,
 *               and it is proven present before 015b runs.
 *
 * WHAT IT PROVES
 *
 *   1  baseline: pilotlike holds every privilege; post holds none, and the
 *      tenant portal's own read and the accept-invite upsert both FAIL there
 *   2  015b applies, and applies again
 *   3  EXACT privilege matrices, identical in both databases — a missing grant
 *      and an excess one both fail
 *   4  the calls the app makes still work: portal read (own accepted, unrevoked
 *      membership only), accept-invite (GET invitation by token_hash, upsert
 *      membership on (user_id, tenant_id) returning the row, PATCH the
 *      invitation returning it), the authz fixture's DELETE and re-insert
 *   5  what must be refused is refused with 42501: authenticated writes to
 *      tenant_users and anything on tenant_invitations; anon everywhere
 *   6  tenant_ids_for_current_user() executable by authenticated, not anon
 *   7  deleting a property still cascades to both tables — as the owner, with
 *      no DELETE grant on tenant_invitations
 *   8  NOTHING ELSE MOVED — columns, constraints, indexes, policies, functions
 *      and every row are byte-identical across 015b
 *   9  the rollback restores Pilot's observed grants; 015b applies again after
 */
const path = require('path');
const { startCluster, tally, show, denied } = require('./_pg-throwaway');

const ROOT = path.join(__dirname, '..');
const MIG  = path.join(ROOT, 'migrations');
const M015B = path.join(MIG, '015b_tenant_access_privileges.sql');
const R015B = path.join(MIG, '015b_tenant_access_privileges_rollback.sql');

const T = tally();
const { check, section } = T;

const MARKER = 'fd9c09b1-b657-4c58-9999-c3cce28e7600';   // 012–015 refuse to run without it
const UL = '11111111-1111-4111-8111-111111111111';        // landlord
const UO = '22222222-2222-4222-8222-222222222222';        // another landlord
const UT = '33333333-3333-4333-8333-333333333333';        // tenant: accepted
const UR = '44444444-4444-4444-8444-444444444444';        // tenant: revoked
const UP = '55555555-5555-4555-8555-555555555555';        // tenant: pending (invited, never accepted)
const UN = '66666666-6666-4666-8666-666666666666';        // new tenant, accepting an invitation
const P1 = 'aaaaaaaa-0000-4000-8000-00000000000a';
const P2 = 'bbbbbbbb-0000-4000-8000-00000000000b';
const PX = 'cccccccc-0000-4000-8000-00000000000c';        // property deleted in §7
const T1 = 'aaaaaaaa-1111-4000-8000-00000000000a';
const T2 = 'bbbbbbbb-1111-4000-8000-00000000000b';
const TX = 'cccccccc-1111-4000-8000-00000000000c';
const TOKEN = 'ab'.repeat(32);                            // a sha256-hex-shaped token hash

const LEGACY_BEFORE = ['000_base_schema.sql', '001_lease_jobs.sql', '005_rls_hardening.sql'];
const TENANT_MIGS   = ['012_tenant_users_phase_a.sql', '013_tenant_users_revoke_anon.sql',
                       '014_tenant_invitations.sql', '015_tenant_users_hide_revoked.sql'];

// The exact sets 015b must produce. Sorted, comma-joined.
const EXPECT = {
  tenant_users:       { anon: '', authenticated: 'SELECT', service_role: 'DELETE,INSERT,SELECT,UPDATE' },
  tenant_invitations: { anon: '', authenticated: '',       service_role: 'SELECT,UPDATE' },
};
const ALL = 'DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE';
// What Pilot holds today (read-only catalog query), which the rollback restores.
const PILOT_OBSERVED = {
  tenant_users:       { anon: '', authenticated: ALL, service_role: ALL },
  tenant_invitations: { anon: '', authenticated: ALL, service_role: ALL },
};

console.log('\n══ migration 015b — executed against a throwaway cluster ══');
console.log('   NO Supabase project is contacted by this script.');
const pg = startCluster('015b');
console.log('   postgres: ' + pg.PGBIN);

function build(db, modelFor012) {
  section(`${db}: build to 015 (000–011 legacy; 012–015 ${modelFor012})`);
  const boot = pg.database(db, 'legacy');
  check(`${db}: Supabase prerequisites created`, boot.ok, boot.ok ? '' : boot.out.slice(0, 200));
  const q = (sql) => pg.psql(sql, db);
  q(`insert into auth.users (id, email) values ('${UL}','l@example.com'), ('${UO}','o@example.com'),
       ('${UT}','t@example.com'), ('${UR}','r@example.com'), ('${UP}','p@example.com'), ('${UN}','n@example.com');`);
  let ok = true;
  for (const f of LEGACY_BEFORE) { const r = pg.psqlFile(path.join(MIG, f), db); ok = check(`${db}: ${f} applies`, r.ok, r.ok ? '' : r.out.slice(0, 300)) && ok; }
  q(`insert into public.properties (id, user_id, name) values
       ('${MARKER}', null, 'pilot marker'), ('${P1}','${UL}','One Plaza'), ('${P2}','${UO}','Two Centre'), ('${PX}','${UL}','Doomed Court');
     insert into public.tenants (id, property_id, name) values
       ('${T1}','${P1}','Tenant One'), ('${T2}','${P2}','Tenant Two'), ('${TX}','${PX}','Tenant Doomed');`);
  if (modelFor012 !== 'legacy') {
    const m = pg.setModel(db, modelFor012);
    ok = check(`${db}: project switched to the ${modelFor012} default privileges`, m.ok, m.ok ? '' : m.out) && ok;
  }
  for (const f of TENANT_MIGS) { const r = pg.psqlFile(path.join(MIG, f), db); ok = check(`${db}: ${f} applies`, r.ok, r.ok ? '' : r.out.slice(0, 300)) && ok; }
  // Memberships and invitations as the server (table owner) would have left them.
  const seed = q(`insert into public.tenant_users (user_id, tenant_id, property_id, accepted_at, revoked_at) values
       ('${UT}','${T1}','${P1}', now(), null),
       ('${UR}','${T1}','${P1}', now(), now()),
       ('${UP}','${T1}','${P1}', null,  null),
       ('${UT}','${TX}','${PX}', now(), null);
     insert into public.tenant_invitations (tenant_id, property_id, email, token_hash, invited_by) values
       ('${T1}','${P1}','n@example.com','${TOKEN}','${UL}'),
       ('${TX}','${PX}','x@example.com','${'cd'.repeat(32)}','${UL}');`);
  ok = check(`${db}: memberships and invitations seeded`, seed.ok, seed.ok ? '' : seed.out.slice(0, 200)) && ok;
  if (!ok) { console.log('\nStopping: the database could not be built.'); T.finish(); }
}

function matrix(db, expected, label) {
  for (const [table, roles] of Object.entries(expected)) {
    for (const [role, want] of Object.entries(roles)) {
      const got = pg.privs('public.' + table, role, db);
      check(`${db}: ${label} ${table} · ${role} = {${show(want)}}`, got === want, got === want ? '' : 'got {' + show(got) + '}');
    }
  }
}

// ── the calls the app makes, in the shape PostgREST sends them ────────────────
const portalRead = (db, uid) => pg.as('authenticated', uid,
  `select string_agg(tenant_id::text, ',' order by tenant_id) from public.tenant_users;`, db);
const inviteGet = (db) => pg.as('service_role', null,
  `select id, tenant_id, property_id, email, expires_at from public.tenant_invitations
    where token_hash = '${TOKEN}' and accepted_at is null and revoked_at is null;`, db);
// api/tenant-accept-invite.js: POST /tenant_users?on_conflict=user_id,tenant_id
// Prefer: resolution=merge-duplicates,return=representation
const upsertMembership = (db, uid) => pg.as('service_role', null,
  `insert into public.tenant_users (user_id, tenant_id, property_id, accepted_at, revoked_at)
     values ('${uid}','${T1}','${P1}', now(), null)
   on conflict (user_id, tenant_id) do update
     set user_id = excluded.user_id, tenant_id = excluded.tenant_id, property_id = excluded.property_id,
         accepted_at = excluded.accepted_at, revoked_at = excluded.revoked_at
   returning id, user_id, tenant_id, accepted_at is not null;`, db);
// PATCH /tenant_invitations?id=eq.…&accepted_at=is.null&revoked_at=is.null, return=representation
const closeInvite = (db) => pg.as('service_role', null,
  `update public.tenant_invitations set accepted_at = now(), accepted_by = '${UN}'
    where token_hash = '${TOKEN}' and accepted_at is null and revoked_at is null
   returning id, accepted_by;`, db);

function fingerprint(db) {
  return pg.psql(`
    select 'col|'||table_name||'|'||column_name||'|'||data_type||'|'||is_nullable||'|'||coalesce(column_default,'')
      from information_schema.columns where table_schema='public' and table_name in ('tenant_users','tenant_invitations','tenants','properties')
    union all
    select 'con|'||conrelid::regclass||'|'||conname||'|'||pg_get_constraintdef(oid)
      from pg_constraint where conrelid in ('public.tenant_users'::regclass,'public.tenant_invitations'::regclass,'public.tenants'::regclass)
    union all
    select 'idx|'||tablename||'|'||indexdef from pg_indexes where schemaname='public' and tablename in ('tenant_users','tenant_invitations')
    union all
    select 'pol|'||tablename||'|'||policyname||'|'||array_to_string(roles,'+')||'|'||cmd||'|'||coalesce(qual,'')||'|'||coalesce(with_check,'')
      from pg_policies where schemaname='public' and tablename in ('tenant_users','tenant_invitations','tenants')
    union all
    select 'fn|'||p.oid::regprocedure||'|'||md5(pg_get_functiondef(p.oid))||'|'||coalesce(array_to_string(p.proacl,'+'),'')
      from pg_proc p where p.pronamespace='public'::regnamespace
    order by 1;`, db).out;
}
const rows = (db) => pg.psql(`
  select string_agg(md5(t::text), ',' order by t.id) from public.tenant_users t
  union all
  select string_agg(md5(i::text), ',' order by i.id) from public.tenant_invitations i;`, db).out;

// ══ build both ═══════════════════════════════════════════════════════════════
build('pilotlike', 'legacy');
build('post', 'post-2026-10-30');

// ── 1 · baseline ─────────────────────────────────────────────────────────────
section('1 · baseline, before 015b');
matrix('pilotlike', PILOT_OBSERVED, 'before 015b (reproduces Pilot):');
matrix('post', { tenant_users: { anon: '', authenticated: '', service_role: '' },
                 tenant_invitations: { anon: '', authenticated: '', service_role: '' } }, 'before 015b:');
check('post: before 015b the tenant portal\'s own membership read FAILS (the October 30 break)',
  denied(portalRead('post', UT)), portalRead('post', UT).out.split('\n')[0].slice(0, 90));
check('post: before 015b the accept-invite lookup FAILS',
  denied(inviteGet('post')), inviteGet('post').out.split('\n')[0].slice(0, 90));
check('pilotlike: before 015b authenticated holds DELETE on tenant_users at the grant level (only RLS stops it)',
  pg.privs('public.tenant_users', 'authenticated', 'pilotlike').includes('DELETE'));

const fpBefore = { pilotlike: fingerprint('pilotlike'), post: fingerprint('post') };
const rowsBefore = { pilotlike: rows('pilotlike'), post: rows('post') };

// ── 2 · apply ────────────────────────────────────────────────────────────────
section('2 · 015b applies, and applies again');
for (const db of ['pilotlike', 'post']) {
  const a = pg.psqlFile(M015B, db);
  check(`${db}: 015b applies`, a.ok, a.ok ? '' : a.out.slice(0, 300));
  const b = pg.psqlFile(M015B, db);
  check(`${db}: 015b applies a second time`, b.ok, b.ok ? '' : b.out.slice(0, 300));
}

// ── 3 · exact matrices ───────────────────────────────────────────────────────
section('3 · exact privilege matrices');
matrix('pilotlike', EXPECT, 'after 015b:');
matrix('post', EXPECT, 'after 015b:');
for (const t of Object.keys(EXPECT)) {
  check(`${t}: PUBLIC holds nothing`, pg.privs('public.' + t, 'public', 'post') === '' && pg.privs('public.' + t, 'public', 'pilotlike') === '');
}

// ── 8 (early) · nothing else moved ───────────────────────────────────────────
section('8 · nothing else moved');
for (const db of ['pilotlike', 'post']) {
  check(`${db}: columns, constraints, indexes, policies, functions byte-identical across 015b`,
    fingerprint(db) === fpBefore[db] && fpBefore[db].length > 0);
  check(`${db}: every row byte-identical across 015b`, rows(db) === rowsBefore[db] && rowsBefore[db].length > 0);
}

// ── 4–7 · behaviour, in both databases ───────────────────────────────────────
function behaviour(db) {
  section(`${db}: 4 · the app's calls still work`);
  const own = portalRead(db, UT);
  check(`${db}: tenant reads its own accepted memberships (portal.js)`, own.ok && own.out === [T1, TX].sort().join(','), own.out);
  const rev = portalRead(db, UR);
  check(`${db}: a revoked tenant reads nothing (015's rule still holds)`, rev.ok && rev.out === '', show(rev.out));
  const pen = portalRead(db, UP);
  check(`${db}: a pending tenant reads nothing`, pen.ok && pen.out === '', show(pen.out));
  const other = portalRead(db, UO);
  check(`${db}: another landlord reads none of these memberships`, other.ok && other.out === '', show(other.out));
  const tIds = pg.as('authenticated', UT, `select string_agg(x::text, ',' order by x) from public.tenant_ids_for_current_user() x;`, db);
  check(`${db}: tenant_ids_for_current_user() works for the tenant`, tIds.ok && tIds.out === [T1, TX].sort().join(','), tIds.out);
  const tenRead = pg.as('authenticated', UT, `select string_agg(name, ',' order by name) from public.tenants;`, db);
  check(`${db}: the tenant reads its own tenant rows through tenants_tenant_self_select`, tenRead.ok && tenRead.out === 'Tenant Doomed,Tenant One', tenRead.out);

  const g = inviteGet(db);
  check(`${db}: accept-invite GET by token_hash (service_role)`, g.ok && g.out.includes(`|${T1}|${P1}|`), g.out.slice(0, 120));
  const u1 = upsertMembership(db, UN);
  check(`${db}: accept-invite upsert — insert path, returning the row`, u1.ok && u1.out.endsWith('|t'), u1.out.slice(0, 120));
  const u2 = upsertMembership(db, UN);
  check(`${db}: accept-invite upsert — conflict path (re-invited tenant), returning the same row`,
    u2.ok && u2.out.split('|')[0] === u1.out.split('|')[0], u2.out.slice(0, 120));
  const c = closeInvite(db);
  check(`${db}: accept-invite PATCH closes the invitation, returning it`, c.ok && c.out.endsWith('|' + UN), c.out.slice(0, 120));
  check(`${db}: the newly accepted tenant now reads its membership`, portalRead(db, UN).out === T1);

  // scripts/provision-pilot-authz-fixture.js: DELETE its fixture memberships, then re-insert, return=representation.
  const del = pg.as('service_role', null, `delete from public.tenant_users where user_id = '${UN}';`, db);
  check(`${db}: fixture DELETE of a membership (service_role)`, del.ok, del.out.slice(0, 100));
  const ins = pg.as('service_role', null, `insert into public.tenant_users (user_id, tenant_id, property_id, accepted_at)
                                            values ('${UN}','${T1}','${P1}', now()) returning id;`, db);
  check(`${db}: fixture re-insert returning the row (service_role)`, ins.ok && /^[0-9a-f-]{36}$/.test(ins.out), ins.out.slice(0, 100));

  section(`${db}: 5 · refusals are refusals at the grant (42501)`);
  const refusals = [
    ['authenticated tenant cannot INSERT a membership for itself', 'authenticated', UT,
      `insert into public.tenant_users (user_id, tenant_id, property_id, accepted_at) values ('${UT}','${T2}','${P2}', now());`],
    ['authenticated tenant cannot UPDATE its membership (e.g. un-revoke)', 'authenticated', UR,
      `update public.tenant_users set revoked_at = null where user_id = '${UR}';`],
    ['authenticated landlord cannot DELETE a membership', 'authenticated', UL,
      `delete from public.tenant_users where property_id = '${P1}';`],
    ['authenticated cannot TRUNCATE tenant_users', 'authenticated', UL, `truncate public.tenant_users;`],
    ['authenticated landlord cannot read invitations', 'authenticated', UL, `select count(*) from public.tenant_invitations;`],
    ['authenticated landlord cannot create an invitation', 'authenticated', UL,
      `insert into public.tenant_invitations (tenant_id, property_id, email, token_hash, invited_by)
       values ('${T1}','${P1}','z@example.com','${'ef'.repeat(32)}','${UL}');`],
    ['authenticated tenant cannot read invitations', 'authenticated', UT, `select count(*) from public.tenant_invitations;`],
    ['service_role cannot INSERT an invitation (nothing creates one)', 'service_role', null,
      `insert into public.tenant_invitations (tenant_id, property_id, email, token_hash, invited_by)
       values ('${T1}','${P1}','z@example.com','${'ef'.repeat(32)}','${UL}');`],
    ['service_role cannot DELETE an invitation', 'service_role', null, `delete from public.tenant_invitations;`],
    ['anon cannot read tenant_users', 'anon', null, `select count(*) from public.tenant_users;`],
    ['anon cannot write tenant_users', 'anon', null,
      `insert into public.tenant_users (user_id, tenant_id, property_id) values ('${UN}','${T2}','${P2}');`],
    ['anon cannot read invitations', 'anon', null, `select count(*) from public.tenant_invitations;`],
    ['anon cannot call tenant_ids_for_current_user()', 'anon', null, `select public.tenant_ids_for_current_user();`],
  ];
  for (const [name, role, uid, sql] of refusals) {
    const r = pg.as(role, uid, sql, db);
    check(`${db}: ${name}`, denied(r), r.ok ? 'NOT refused' : r.out.split('\n')[0].slice(0, 80));
  }

  section(`${db}: 6 · function EXECUTE`);
  check(`${db}: authenticated may execute tenant_ids_for_current_user()`, pg.canExecute('authenticated', 'public.tenant_ids_for_current_user()', db));
  check(`${db}: anon may not`, !pg.canExecute('anon', 'public.tenant_ids_for_current_user()', db));

  section(`${db}: 7 · cascades run as the owner`);
  const cas = pg.as('service_role', null, `delete from public.properties where id = '${PX}';`, db);
  check(`${db}: deleting a property (service_role, as the fixtures do) succeeds`, cas.ok, cas.out.slice(0, 120));
  check(`${db}: its memberships cascaded`, pg.psql(`select count(*) from public.tenant_users where property_id='${PX}';`, db).out === '0');
  check(`${db}: its invitations cascaded, with no DELETE grant on tenant_invitations`,
    pg.psql(`select count(*) from public.tenant_invitations where property_id='${PX}';`, db).out === '0');
}
behaviour('pilotlike');
behaviour('post');

// ── 9 · rollback ─────────────────────────────────────────────────────────────
section('9 · the rollback restores Pilot\'s observed grants');
const rb = pg.psqlFile(R015B, 'pilotlike');
check('pilotlike: rollback runs', rb.ok, rb.ok ? '' : rb.out.slice(0, 300));
matrix('pilotlike', PILOT_OBSERVED, 'after rollback:');
const again = pg.psqlFile(M015B, 'pilotlike');
check('pilotlike: 015b applies again after the rollback', again.ok, again.ok ? '' : again.out.slice(0, 300));
matrix('pilotlike', EXPECT, 'after re-apply:');

T.finish();
