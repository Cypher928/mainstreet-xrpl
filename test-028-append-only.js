'use strict';
/**
 * test-028-append-only.js — property_events is append-only against a REAL
 * database, proved from the one kind of session that could break it.
 *
 *   node test-028-append-only.js
 *
 * WHY THIS EXISTS
 * ---------------
 * 028 claimed "a trigger refuses every UPDATE, and every DELETE that is not
 * the cascade of the property itself". It did not. The guard raised only when
 * `pg_trigger_depth() = 0`, and inside a row trigger the depth is never 0 — a
 * direct statement arrives at 1, a foreign key's cascade at 2. Every DELETE
 * went through.
 *
 * The offline contract test passed anyway, because it asserted that the
 * migration TEXT contains `pg_trigger_depth() = 0`. It pinned the defect as
 * the contract. The live suite passed too, because no PostgREST role holds
 * DELETE, so the privilege layer refused before the trigger was ever reached.
 * A test that can only reach the table through PostgREST cannot tell a working
 * trigger from a broken one.
 *
 * So this suite starts its own PostgreSQL, applies migrations/028 and
 * migrations/028b UNMODIFIED, and drives them as the table owner — the only
 * role that actually holds DELETE, UPDATE and TRUNCATE. It asserts behaviour,
 * never source text.
 *
 *   A  the defect is real: with 028 alone, a privileged DELETE succeeds
 *   B  after 028b: UPDATE, DELETE and TRUNCATE are all refused
 *   C  the property's own cascade still removes its events
 *   D  deleting a referenced user keeps the event and nulls actor_uid
 *   E  deleting a referenced organisation keeps the event and nulls its org
 *   F  a trigger-driven update that is NOT a SET NULL is still refused
 *   G  organization_id is derived from the property, never from the caller
 *   H  actor_uid is auth.uid(), and naming someone else is refused
 *
 * REQUIRES a local PostgreSQL (initdb/pg_ctl/psql). If none is present this
 * exits NON-ZERO rather than skipping: an unrun invariant test must never read
 * as a pass. On Debian/Ubuntu: apt-get install postgresql.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = __dirname;
const M028  = path.join(ROOT, 'migrations', '028_property_events.sql');
const M028B = path.join(ROOT, 'migrations', '028b_property_events_append_only_fix.sql');
const MARKER = 'fd9c09b1-b657-4c58-9999-c3cce28e7600';

let pass = 0, fail = 0;
const failures = [];
function t(name, cond, detail) {
  if (cond) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  else {
    fail++; failures.push(name + (detail ? ` — ${detail}` : ''));
    console.log(`  \x1b[31m✗ ${name}\x1b[0m${detail ? ` — ${detail}` : ''}`);
  }
}
function die(msg, code) {
  console.error(`\n\x1b[31m${msg}\x1b[0m`);
  process.exit(code === undefined ? 2 : code);
}

// ── Find a PostgreSQL ───────────────────────────────────────────────────────
function findBin() {
  const dirs = [];
  const base = '/usr/lib/postgresql';
  if (fs.existsSync(base)) {
    for (const v of fs.readdirSync(base).sort().reverse()) {
      const d = path.join(base, v, 'bin');
      if (fs.existsSync(path.join(d, 'initdb'))) dirs.push(d);
    }
  }
  for (const d of ['/usr/local/bin', '/usr/bin', '/opt/homebrew/bin']) {
    if (fs.existsSync(path.join(d, 'initdb'))) dirs.push(d);
  }
  return dirs[0] || null;
}

const BIN = findBin();
if (!BIN) {
  die('NOT RUN — no local PostgreSQL found (need initdb, pg_ctl, psql).\n' +
      '  This suite proves a database invariant and cannot be faked without a database.\n' +
      '  Debian/Ubuntu: apt-get install -y postgresql\n' +
      '  macOS:         brew install postgresql');
}

// initdb refuses to run as root, so when we are root the server runs as an
// unprivileged account. The client does not care who it connects as.
const AS_ROOT = (typeof process.getuid === 'function' && process.getuid() === 0);
let SERVER_USER = null;
if (AS_ROOT) {
  for (const u of ['postgres', 'nobody']) {
    const r = spawnSync('getent', ['passwd', u], { encoding: 'utf8' });
    if (r.status === 0 && r.stdout.trim()) { SERVER_USER = u; break; }
  }
  if (!SERVER_USER) {
    die('NOT RUN — running as root and no unprivileged account (postgres, nobody) exists to run the server as.');
  }
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pe028-'));
const DATA = path.join(TMP, 'data');
const SOCK = path.join(TMP, 'sock');
fs.mkdirSync(SOCK);
if (AS_ROOT) { execFileSync('chmod', ['-R', '777', TMP]); }

function server(cmd, args) {
  const line = [path.join(BIN, cmd)].concat(args).map(a => `'${a}'`).join(' ');
  if (AS_ROOT) return spawnSync('su', [SERVER_USER, '-s', '/bin/sh', '-c', line], { encoding: 'utf8' });
  return spawnSync(path.join(BIN, cmd), args, { encoding: 'utf8' });
}

let started = false;
function cleanup() {
  try { if (started) server('pg_ctl', ['-D', DATA, '-m', 'immediate', 'stop']); } catch (_) {}
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {}
}
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(130); });

console.log('\n╔════════════════════════════════════════════════════════════════╗');
console.log('║  028 — property_events is append-only, proved against Postgres ║');
console.log('╚════════════════════════════════════════════════════════════════╝\n');
console.log(`  · using ${BIN}${AS_ROOT ? ` (server runs as ${SERVER_USER})` : ''}`);

let r = server('initdb', ['-D', DATA, '-U', 'pgowner', '--auth=trust', '-E', 'UTF8']);
if (r.status !== 0) die('NOT RUN — initdb failed:\n' + (r.stderr || r.stdout || '').slice(-1500));

r = server('pg_ctl', ['-D', DATA, '-o', `-k ${SOCK} -c listen_addresses=`, '-w', '-l', path.join(TMP, 'log'), 'start']);
if (r.status !== 0) {
  let log = '';
  try { log = fs.readFileSync(path.join(TMP, 'log'), 'utf8'); } catch (_) {}
  die('NOT RUN — could not start PostgreSQL:\n' + (r.stderr || r.stdout || '') + '\n' + log.slice(-1500));
}
started = true;

function psql(sql, opts) {
  const args = ['-h', SOCK, '-U', 'pgowner', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At', '-c', sql];
  const res = spawnSync(path.join(BIN, 'psql'), args, { encoding: 'utf8' });
  if (res.status !== 0 && !(opts && opts.allowFail)) {
    die('setup SQL failed:\n' + sql.slice(0, 400) + '\n' + (res.stderr || '').slice(-1200), 1);
  }
  return { ok: res.status === 0, out: (res.stdout || '').trim(), err: (res.stderr || '').trim() };
}
function psqlFile(file) {
  const res = spawnSync(path.join(BIN, 'psql'),
    ['-h', SOCK, '-U', 'pgowner', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At', '-f', file],
    { encoding: 'utf8' });
  return { ok: res.status === 0, out: (res.stdout || '').trim(), err: (res.stderr || '').trim() };
}

// ── A pilot-shaped stub: only what 028 references ───────────────────────────
psql(`
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('test.uid', true), '')::uuid
$$;
create table public.organizations (id uuid primary key default gen_random_uuid(), name text);
create table public.properties (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),
  name text,
  organization_id uuid references public.organizations(id) on delete restrict
);
create function public.member_property_ids() returns setof uuid language sql stable as $$
  select id from public.properties where user_id = auth.uid()
$$;
`);

// The pilot marker the migration guards on, plus a world to act in.
psql(`
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'owner@pilot.invalid'),
  ('22222222-2222-2222-2222-222222222222', 'other@pilot.invalid'),
  ('33333333-3333-3333-3333-333333333333', 'departing@pilot.invalid');
insert into public.organizations (id, name) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Org One'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'Org Two');
insert into public.properties (id, user_id, name, organization_id) values
  ('${MARKER}', '11111111-1111-1111-1111-111111111111', 'pilot marker', 'aaaaaaaa-0000-0000-0000-000000000001');
create table probe (n int, step text, result text);
`);

// ── A: the defect, with 028 alone ───────────────────────────────────────────
console.log('\nA  the defect is real — with 028 alone a privileged DELETE goes through');
{
  const applied = psqlFile(M028);
  t('A1 migrations/028_property_events.sql applies unmodified', applied.ok, applied.err.slice(-300));

  psql(`insert into public.property_events (property_id, action, actor_uid)
        values ('${MARKER}', 'before_fix', '11111111-1111-1111-1111-111111111111');`);

  const del = psql(`delete from public.property_events where action = 'before_fix';`, { allowFail: true });
  const left = psql(`select count(*) from public.property_events where action='before_fix';`).out;
  t('A2 a direct DELETE is NOT refused by 028 (this is the bug being fixed)', del.ok && left === '0',
    `delete ok=${del.ok} rows_left=${left}`);

  psql(`insert into public.property_events (property_id, action) values ('${MARKER}', 'truncate_me');`);
  const tr = psql(`truncate public.property_events;`, { allowFail: true });
  t('A3 TRUNCATE is NOT refused by 028 either', tr.ok, tr.err.slice(-200));

  const upd = psql(`insert into public.property_events (property_id, action) values ('${MARKER}','x');
                    update public.property_events set action='y';`, { allowFail: true });
  t('A4 UPDATE was already refused by 028', !upd.ok && /never updated/.test(upd.err), upd.err.slice(-200));
  psql(`delete from public.property_events;`, { allowFail: true });
}

// ── Apply the fix ───────────────────────────────────────────────────────────
console.log('\nB  after 028b — update, delete and truncate are all refused');
{
  const applied = psqlFile(M028B);
  t('B1 migrations/028b applies unmodified on top of 028', applied.ok, applied.err.slice(-400));

  t('B2 all three triggers are present',
    psql(`select string_agg(tgname, ',' order by tgname) from pg_trigger
          where tgrelid='public.property_events'::regclass and not tgisinternal;`).out
      === 'property_events_append_only,property_events_no_truncate,property_events_stamp');

  psql(`insert into public.property_events (property_id, action, actor_uid)
        values ('${MARKER}', 'kept_forever', '11111111-1111-1111-1111-111111111111');`);

  const del = psql(`delete from public.property_events where action='kept_forever';`, { allowFail: true });
  t('B3 a direct DELETE is refused', !del.ok && /never deleted/.test(del.err), del.err.slice(-200));

  const upd = psql(`update public.property_events set action='tampered' where action='kept_forever';`, { allowFail: true });
  t('B4 a direct UPDATE is refused', !upd.ok && /never updated/.test(upd.err), upd.err.slice(-200));

  const tr = psql(`truncate public.property_events;`, { allowFail: true });
  t('B5 TRUNCATE is refused', !tr.ok && /never truncated/.test(tr.err), tr.err.slice(-200));

  const trc = psql(`truncate public.properties cascade;`, { allowFail: true });
  t('B6 TRUNCATE of the parent cannot reach it either', !trc.ok && /never truncated/.test(trc.err), trc.err.slice(-200));

  t('B7 the event is still there after all of that',
    psql(`select count(*) from public.property_events where action='kept_forever';`).out === '1');
}

// ── C: the property's own cascade ───────────────────────────────────────────
console.log('\nC  the property\'s own cascade still removes its events');
{
  psql(`insert into public.properties (id, user_id, name, organization_id)
        values ('dddddddd-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111',
                'cascade probe', 'aaaaaaaa-0000-0000-0000-000000000001');
        insert into public.property_events (property_id, action)
        values ('dddddddd-0000-0000-0000-00000000000c', 'on_doomed_property');`);
  const d = psql(`delete from public.properties where id='dddddddd-0000-0000-0000-00000000000c';`, { allowFail: true });
  t('C1 deleting the property succeeds', d.ok, d.err.slice(-300));
  t('C2 its events went with it',
    psql(`select count(*) from public.property_events where action='on_doomed_property';`).out === '0');
}

// ── D: a referenced user is deleted ─────────────────────────────────────────
console.log('\nD  deleting a referenced user keeps the event and drops only the attribution');
{
  psql(`insert into public.property_events (property_id, action, actor_email, actor_uid)
        values ('${MARKER}', 'by_departing_user', 'departing@pilot.invalid',
                '33333333-3333-3333-3333-333333333333');`);
  const d = psql(`delete from auth.users where id='33333333-3333-3333-3333-333333333333';`, { allowFail: true });
  t('D1 the user can be deleted', d.ok, d.err.slice(-300));
  const row = psql(`select count(*)||'|'||coalesce(max(actor_uid::text),'NULL')||'|'||coalesce(max(actor_email),'')
                    from public.property_events where action='by_departing_user';`).out;
  t('D2 the event survives, actor_uid is NULL, the rest is untouched',
    row === "1|NULL|departing@pilot.invalid", row);
  const upd = psql(`update public.property_events set action='x' where action='by_departing_user';`, { allowFail: true });
  t('D3 an ordinary UPDATE is still refused afterwards', !upd.ok && /never updated/.test(upd.err), upd.err.slice(-200));
}

// ── E: a referenced organisation is deleted ─────────────────────────────────
console.log('\nE  deleting a referenced organisation keeps the event and drops only the label');
{
  psql(`insert into public.properties (id, user_id, name, organization_id)
        values ('dddddddd-0000-0000-0000-00000000000e', '11111111-1111-1111-1111-111111111111',
                'org probe', 'aaaaaaaa-0000-0000-0000-000000000002');
        insert into public.property_events (property_id, action)
        values ('dddddddd-0000-0000-0000-00000000000e', 'org_linked');
        update public.properties set organization_id='aaaaaaaa-0000-0000-0000-000000000001'
         where id='dddddddd-0000-0000-0000-00000000000e';`);
  t('E1 the event was stamped with the organisation it was filed under',
    psql(`select organization_id from public.property_events where action='org_linked';`).out
      === 'aaaaaaaa-0000-0000-0000-000000000002');
  const d = psql(`delete from public.organizations where id='aaaaaaaa-0000-0000-0000-000000000002';`, { allowFail: true });
  t('E2 the organisation can be deleted', d.ok, d.err.slice(-300));
  const row = psql(`select count(*)||'|'||coalesce(max(organization_id::text),'NULL')||'|'||max(action)
                    from public.property_events where action='org_linked';`).out;
  t('E3 the event survives with organization_id NULL and its action intact', row === '1|NULL|org_linked', row);
}

// ── F: a trigger-driven update that is not a SET NULL ───────────────────────
console.log('\nF  depth alone is not enough — a trigger-driven rewrite is still refused');
{
  psql(`create table public._rewrite_source (id int primary key);
        create function public._rewrite_attempt() returns trigger language plpgsql as $fn$
        begin
          update public.property_events set action = 'rewritten_by_trigger' where action = 'kept_forever';
          return new;
        end $fn$;
        create trigger t_rewrite after insert on public._rewrite_source
          for each row execute function public._rewrite_attempt();`);
  const ins = psql(`insert into public._rewrite_source values (1);`, { allowFail: true });
  t('F1 an update from inside another trigger is refused when it is not a SET NULL',
    !ins.ok && /only a foreign key/.test(ins.err), ins.err.slice(-250));
  t('F2 the targeted event is unchanged',
    psql(`select count(*) from public.property_events where action='kept_forever';`).out === '1');

  // A row whose actor_email actually HAS a value, so nulling it is a real
  // change rather than a no-op.
  psql(`insert into public.property_events (property_id, action, actor_email)
        values ('${MARKER}', 'has_an_email', 'someone@pilot.invalid');
        create function public._null_email_attempt() returns trigger language plpgsql as $fn$
        begin
          update public.property_events set actor_email = null where action = 'has_an_email';
          return new;
        end $fn$;
        drop trigger t_rewrite on public._rewrite_source;
        create trigger t_null_email after insert on public._rewrite_source
          for each row execute function public._null_email_attempt();`);
  const ins2 = psql(`insert into public._rewrite_source values (2);`, { allowFail: true });
  t('F3 nulling a column that is NOT an attribution foreign key is refused too',
    !ins2.ok && /only a foreign key/.test(ins2.err), ins2.err.slice(-250));
  t('F4 that row kept its email',
    psql(`select actor_email from public.property_events where action='has_an_email';`).out
      === 'someone@pilot.invalid');
}

// ── G: the organisation is the property's, never the caller's ───────────────
console.log('\nG  organization_id is derived from the property, never taken from the caller');
{
  psql(`insert into public.property_events (property_id, action, organization_id)
        values ('${MARKER}', 'supplied_a_foreign_org', 'aaaaaaaa-0000-0000-0000-000000000001');`);
  t('G1 a supplied organisation that matches is simply the property\'s',
    psql(`select organization_id from public.property_events where action='supplied_a_foreign_org';`).out
      === 'aaaaaaaa-0000-0000-0000-000000000001');

  psql(`insert into public.organizations (id, name) values ('aaaaaaaa-0000-0000-0000-000000000003','Org Three');
        insert into public.property_events (property_id, action, organization_id)
        values ('${MARKER}', 'mismatched_org', 'aaaaaaaa-0000-0000-0000-000000000003');`);
  const stored = psql(`select organization_id from public.property_events where action='mismatched_org';`).out;
  t('G2 a MISMATCHED supplied organisation never becomes stored data',
    stored === 'aaaaaaaa-0000-0000-0000-000000000001', `stored=${stored}`);

  // An organisation id that does not exist at all. If the caller's value were
  // kept, the foreign key would reject the row; it is accepted precisely
  // because the trigger throws the caller's value away.
  const bogus = psql(`insert into public.property_events (property_id, action, organization_id)
                      values ('${MARKER}', 'bogus_org', 'aaaaaaaa-0000-0000-0000-0000000000ff');`, { allowFail: true });
  t('G3 an organisation id that does not exist is discarded rather than rejected',
    bogus.ok, bogus.err.slice(-250));
  t('G4 and that event carries the property\'s organisation',
    psql(`select organization_id from public.property_events where action='bogus_org';`).out
      === 'aaaaaaaa-0000-0000-0000-000000000001');

  // The write-time invariant: of everything written against the marker
  // property, not one row disagrees with that property's organisation.
  t('G5 every event written against the property carries that property\'s organisation',
    psql(`select count(*) from public.property_events e join public.properties p on p.id = e.property_id
          where p.id = '${MARKER}' and e.organization_id is distinct from p.organization_id;`).out === '0');
}

// ── H: the actor is the caller ──────────────────────────────────────────────
console.log('\nH  actor_uid is auth.uid(), and naming someone else is refused');
{
  const ok = psql(`set test.uid = '11111111-1111-1111-1111-111111111111';
                   insert into public.property_events (property_id, action) values ('${MARKER}','stamped');
                   select actor_uid from public.property_events where action='stamped';`, { allowFail: true });
  t('H1 actor_uid is stamped from auth.uid() when omitted',
    ok.ok && ok.out.indexOf('11111111-1111-1111-1111-111111111111') !== -1, ok.err.slice(-200));

  const spoof = psql(`set test.uid = '11111111-1111-1111-1111-111111111111';
                      insert into public.property_events (property_id, action, actor_uid)
                      values ('${MARKER}','spoofed','22222222-2222-2222-2222-222222222222');`, { allowFail: true });
  t('H2 naming another user as the actor is refused',
    !spoof.ok && /must be the caller/.test(spoof.err), spoof.err.slice(-200));

  const self = psql(`set test.uid = '11111111-1111-1111-1111-111111111111';
                     insert into public.property_events (property_id, action, actor_uid)
                     values ('${MARKER}','self_named','11111111-1111-1111-1111-111111111111');`, { allowFail: true });
  t('H3 naming yourself is accepted', self.ok, self.err.slice(-200));
}

// ── The guard still guards ──────────────────────────────────────────────────
console.log('\nI  the pilot guard');
{
  psql(`delete from public.property_events where true;`, { allowFail: true });
  psql(`drop trigger property_events_no_truncate on public.property_events;
        drop trigger property_events_append_only on public.property_events;
        delete from public.property_events;
        update public.properties set id='ffffffff-ffff-ffff-ffff-ffffffffffff' where id='${MARKER}';`);
  const guarded = psqlFile(M028B);
  t('I1 028b refuses to run where the pilot marker property is absent',
    !guarded.ok && /REFUSING TO RUN/.test(guarded.err), guarded.err.slice(-200));
}

console.log('\n' + '─'.repeat(64));
if (fail) {
  console.log(`\x1b[31mRESULT: ${pass} passed, ${fail} failed\x1b[0m`);
  failures.forEach(f => console.log(`  · ${f}`));
  process.exit(1);
}
console.log(`\x1b[32mRESULT: ${pass} passed, 0 failed\x1b[0m`);
