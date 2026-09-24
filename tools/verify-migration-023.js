'use strict';
/**
 * tools/verify-migration-023.js — run migration 023 for real, against nothing
 * that matters.
 *
 *   node tools/verify-migration-023.js
 *
 * THE POINT
 *
 * A migration reviewed by reading is a migration whose first execution is on a
 * real database with real rows. This builds a throwaway PostgreSQL cluster in a
 * temp directory, stands up the objects 023 depends on FROM THE REPO'S OWN
 * MIGRATION FILES (000 base schema, 006 acquisition_reviews) plus the Supabase
 * pieces those assume (the auth schema, auth.uid(), the authenticated /
 * service_role / anon roles), and then executes 023 against it.
 *
 * It touches NO Supabase project. It reads nothing but this repo, writes only
 * into a temp directory, and deletes the cluster when it is done.
 *
 * WHAT IT PROVES
 *
 *   1  023 applies cleanly to a database that has 000 + 006
 *   2  it is re-runnable — applying it twice is not an error and changes nothing
 *   3  row-level security is ON, with exactly two policies and none for anon
 *   4  a reader authenticated as one user CANNOT see another user's documents
 *   5  a document cannot claim an owner its review does not have
 *   6  deleting a review deletes its documents
 *   7  the same file name twice on one review updates rather than duplicates
 *   8  every CHECK constraint rejects a value outside its list
 *   9  updated_at moves on update and created_at does not
 *  10  the rollback removes the table AND the constraint it added
 *  11  023 applies again cleanly after the rollback
 *
 * SKIPS (exit 0) when no local PostgreSQL server binary is present, and says so
 * loudly — a skip is not a pass and must not read like one.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawn } = require('child_process');
const { DEFAULTS, PRIVS } = require('./_pg-throwaway');

const ROOT = path.join(__dirname, '..');
const PGBIN = ['/usr/lib/postgresql/16/bin', '/usr/lib/postgresql/15/bin', '/usr/pgsql-16/bin', '/usr/local/bin']
  .find(d => { try { return fs.existsSync(path.join(d, 'initdb')) && fs.existsSync(path.join(d, 'postgres')); } catch (_) { return false; } });

if (!PGBIN) {
  console.log('\n\x1b[33m⚠ SKIPPED — no local PostgreSQL server binary found.\x1b[0m');
  console.log('  Migration 023 was NOT executed. This is a skip, not a pass.');
  console.log('  Install postgresql-16 (server, not just psql) to run this verification.\n');
  process.exit(0);
}

// PostgreSQL refuses to run as root, so when this runs as root (the usual case
// in a container) every cluster command drops to the `postgres` system user the
// package creates. Without that user there is nothing safe to drop to, and a
// skip is the honest answer rather than a half-run.
const IS_ROOT = typeof process.getuid === 'function' && process.getuid() === 0;
let AS_PG = null;
if (IS_ROOT) {
  try {
    execFileSync('id', ['-u', 'postgres'], { stdio: 'ignore' });
    AS_PG = ['setpriv', ['--reuid=postgres', '--regid=postgres', '--clear-groups']];
  } catch (_) {
    console.log('\n\x1b[33m⚠ SKIPPED — running as root and there is no `postgres` user to drop to.\x1b[0m');
    console.log('  Migration 023 was NOT executed. This is a skip, not a pass.\n');
    process.exit(0);
  }
}
function pgArgs(bin, args) {
  return AS_PG ? [AS_PG[0], [...AS_PG[1], path.join(PGBIN, bin), ...args]]
               : [path.join(PGBIN, bin), args];
}
function pgRun(bin, args, opts) { const [c, a] = pgArgs(bin, args); return execFileSync(c, a, opts); }
function pgSpawn(bin, args, opts) { const [c, a] = pgArgs(bin, args); return spawn(c, a, opts); }

let pass = 0, fail = 0;
const failures = [];
function check(name, ok, detail) {
  if (ok) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${name}${detail ? '  — ' + detail : ''}`); }
  else    { fail++; failures.push(name + (detail ? ': ' + detail : '')); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? '  — ' + detail : ''}`); }
}
function section(s) { console.log('\n── ' + s + ' ' + '─'.repeat(Math.max(0, 60 - s.length))); }

const tmp    = fs.mkdtempSync(path.join(os.tmpdir(), 'pg023-'));
const DATA   = path.join(tmp, 'data');
const SOCK   = path.join(tmp, 'sock');
const LOG    = path.join(tmp, 'pg.log');
fs.mkdirSync(SOCK);
fs.writeFileSync(LOG, '');
// The cluster and its socket have to belong to the user the server runs as.
// The migration files are only READ, and from the repo, which is untouched.
if (AS_PG) { try { execFileSync('chown', ['-R', 'postgres:postgres', tmp]); } catch (_) {} }
let server = null;

function psql(sql) {
  const args = ['-h', SOCK, '-U', 'postgres', '-d', 'verifydb', '-v', 'ON_ERROR_STOP=1', '-X', '-q', '-t', '-A', '-c', sql];
  try {
    return { ok: true, out: pgRun('psql', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() };
  } catch (e) {
    return { ok: false, out: String((e.stdout || '') + (e.stderr || '')).trim() };
  }
}
function psqlFile(file) {
  // The server user cannot necessarily read the repository, so the migration is
  // staged into the cluster's own directory: read here, written where postgres
  // can reach it. The repo file itself is only ever read.
  const staged = path.join(tmp, 'sql-' + path.basename(file));
  fs.writeFileSync(staged, fs.readFileSync(file, 'utf8'));
  if (AS_PG) { try { execFileSync('chown', ['postgres:postgres', staged]); } catch (_) {} }
  const args = ['-h', SOCK, '-U', 'postgres', '-d', 'verifydb', '-v', 'ON_ERROR_STOP=1', '-X', '-q', '-f', staged];
  try {
    return { ok: true, out: pgRun('psql', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() };
  } catch (e) {
    return { ok: false, out: String((e.stdout || '') + (e.stderr || '')).trim() };
  }
}

/** Refused for lack of a privilege (SQLSTATE 42501) — not for any other reason. */
function denied(sql) { const r = psql(sql); return !r.ok && /permission denied/i.test(r.out); }
/** The exact table privileges a role holds, sorted: 'INSERT,SELECT', or '' for none. */
function privs(table, role) {
  const cols = PRIVS.map(p => `case when has_table_privilege('${role}', '${table}', '${p}') then '${p}' end`).join(', ');
  return psql(`select concat_ws(',', ${cols});`).out.split(',').filter(Boolean).sort().join(',');
}
/** Assert a table's privileges for each API role EXACTLY — a missing grant and an excess one both fail. */
function matrix(table, want) {
  for (const [role, w] of Object.entries(want)) {
    const got = privs(table, role);
    check(`${table} · ${role} holds exactly {${w || '<none>'}}`, got === w, got === w ? '' : 'got {' + (got || '<none>') + '}');
  }
}
// Supabase's default privileges from October 30, 2026: nothing created in
// public is granted to anon, authenticated or service_role unless the migration
// grants it. 000 and 006 predate the change and keep their grants; every
// migration from 023 on is applied after this switch.
function switchToPostOct30() {
  const r = psql(DEFAULTS['post-2026-10-30']);
  check('project switched to the post-2026-10-30 default privileges', r.ok, r.ok ? '' : r.out.slice(0, 200));
}

function cleanup() {
  try { if (server) pgRun('pg_ctl', ['-D', DATA, '-m', 'immediate', 'stop'], { stdio: 'ignore' }); } catch (_) {}
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
}
process.on('exit', cleanup);

(async () => {
console.log('\n══ migration 023 — executed against a throwaway cluster ══');
console.log('   postgres: ' + PGBIN);
console.log('   cluster:  ' + DATA + '  (deleted on exit)');
console.log('   NO Supabase project is contacted by this script.');

// ── stand up the cluster ───────────────────────────────────────────────────
section('cluster');
pgRun('initdb', ['-D', DATA, '-U', 'postgres', '--auth=trust', '-E', 'UTF8'], { stdio: 'ignore' });
server = pgSpawn('postgres',
  ['-D', DATA, '-k', SOCK, '-c', 'listen_addresses=', '-c', 'log_min_messages=warning'],
  { stdio: ['ignore', fs.openSync(LOG, 'a'), fs.openSync(LOG, 'a')] });

let up = false;
for (let i = 0; i < 100; i++) {
  try { pgRun('pg_isready', ['-h', SOCK, '-U', 'postgres'], { stdio: 'ignore' }); up = true; break; }
  catch (_) { execFileSync('sleep', ['0.2']); }
}
check('a throwaway PostgreSQL cluster is running', up, up ? '' : fs.readFileSync(LOG, 'utf8').slice(-400));
if (!up) { console.log('\nCannot continue without the cluster.'); process.exit(2); }
pgRun('createdb', ['-h', SOCK, '-U', 'postgres', 'verifydb'], { stdio: 'ignore' });

// ── the Supabase pieces the repo's migrations assume ───────────────────────
// Not invented behaviour: these are the objects a Supabase project already has
// and that 000/006/023 reference — the roles, the auth schema, auth.uid().
const bootstrap = `
  create extension if not exists pgcrypto;
  do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
    if not exists (select 1 from pg_roles where rolname = 'service_role')  then create role service_role nologin;  end if;
    if not exists (select 1 from pg_roles where rolname = 'anon')          then create role anon nologin;          end if;
  end $$;
  create schema if not exists auth;
  create table if not exists auth.users (id uuid primary key default gen_random_uuid(), email text);
  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  grant usage on schema auth to authenticated, service_role;
`;
const boot = psql(bootstrap);
check('Supabase prerequisites (roles, auth schema, auth.uid) created', boot.ok, boot.ok ? '' : boot.out.slice(0, 200));

section('prerequisite migrations, from the repo');
for (const f of ['000_base_schema.sql', '006_acquisition_reviews.sql']) {
  const r = psqlFile(path.join(ROOT, 'migrations', f));
  check(f + ' applies', r.ok, r.ok ? '' : r.out.slice(0, 300));
}
switchToPostOct30();

// Two users and a review each — the fixture every assertion below reads.
const UA = '11111111-1111-4111-8111-111111111111';
const UB = '22222222-2222-4222-8222-222222222222';
const RA = 'aaaaaaaa-0000-4000-8000-00000000000a';
const RB = 'bbbbbbbb-0000-4000-8000-00000000000b';
psql(`insert into auth.users (id, email) values ('${UA}','a@example.com'), ('${UB}','b@example.com');`);
psql(`insert into public.acquisition_reviews (id, user_id, name, status) values
        ('${RA}','${UA}','Harborview','draft'), ('${RB}','${UB}','Lakeview','draft');`);

// ── 1 & 2 · apply, and apply again ─────────────────────────────────────────
section('1-2 · applies, and is re-runnable');
const first = psqlFile(path.join(ROOT, 'migrations', '023_acquisition_documents.sql'));
check('023 applies cleanly', first.ok, first.ok ? '' : first.out.slice(0, 400));
if (!first.ok) { console.log('\nStopping: 023 did not apply.'); process.exit(1); }

const shape = () => psql(`select column_name||':'||data_type from information_schema.columns
                           where table_schema='public' and table_name='acquisition_documents' order by column_name;`).out;
const shapeBefore = shape();
const second = psqlFile(path.join(ROOT, 'migrations', '023_acquisition_documents.sql'));
check('023 applies a SECOND time without error', second.ok, second.ok ? '' : second.out.slice(0, 300));
check('and the table is unchanged by the second run', shape() === shapeBefore);

// ── 3 · RLS and policies ───────────────────────────────────────────────────
section('3 · row-level security');
check('RLS is enabled on the table',
  psql(`select relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
         where n.nspname='public' and c.relname='acquisition_documents';`).out === 't');
const pol = psql(`select policyname||'='||array_to_string(roles,'+') from pg_policies
                   where schemaname='public' and tablename='acquisition_documents' order by policyname;`).out;
check('exactly two policies: owner (authenticated) and service_role',
  pol === 'acq_docs_owner_all=authenticated\nacq_docs_service_role_all=service_role', pol.replace(/\n/g, ' | '));
check('no policy grants anon anything',
  psql(`select count(*) from pg_policies where schemaname='public' and tablename='acquisition_documents'
         and 'anon' = any(roles);`).out === '0');

// ── 4 · one user cannot read another's documents ───────────────────────────
section('4 · a reader sees only their own');
psql(`insert into public.acquisition_documents (review_id, user_id, file_name, intake_kind)
      values ('${RA}','${UA}','lease-a.pdf','lease'), ('${RB}','${UB}','lease-b.pdf','lease');`);
const asA = psql(`set local role authenticated;
                  set local request.jwt.claim.sub = '${UA}';
                  select string_agg(file_name, ',' order by file_name) from public.acquisition_documents;`);
check('authenticated as user A sees A\'s document and only A\'s', asA.out === 'lease-a.pdf', asA.out || '(none)');
const asB = psql(`set local role authenticated;
                  set local request.jwt.claim.sub = '${UB}';
                  select string_agg(file_name, ',' order by file_name) from public.acquisition_documents;`);
check('authenticated as user B sees B\'s document and only B\'s', asB.out === 'lease-b.pdf', asB.out || '(none)');
check('anon is refused outright — at the grant, before RLS (42501)',
  denied(`set local role anon; select count(*) from public.acquisition_documents;`));
section('4b · exact privileges — 023 grants them itself, so the October 30 change does not touch them');
matrix('public.acquisition_documents', { anon: '', authenticated: 'DELETE,INSERT,SELECT,UPDATE',
                                         service_role: 'DELETE,INSERT,SELECT,UPDATE' });
const writeOther = psql(`set local role authenticated;
                         set local request.jwt.claim.sub = '${UA}';
                         insert into public.acquisition_documents (review_id, user_id, file_name)
                         values ('${RB}','${UB}','sneaky.pdf');`);
check('a user cannot insert a document owned by someone else', !writeOther.ok,
  (writeOther.out.match(/row-level security|violates/i) || ['no error'])[0]);

// ── 5 · the owner cannot disagree with the review ──────────────────────────
section('5 · owner integrity');
const mismatch = psql(`insert into public.acquisition_documents (review_id, user_id, file_name)
                       values ('${RA}','${UB}','wrong-owner.pdf');`);
check('a document claiming an owner its review does not have is REJECTED', !mismatch.ok,
  (mismatch.out.match(/acquisition_documents_review_fk|foreign key/i) || ['no error'])[0]);

// ── 6 · cascade ────────────────────────────────────────────────────────────
section('6 · deleting a review takes its documents');
psql(`insert into public.acquisition_documents (review_id, user_id, file_name) values ('${RB}','${UB}','extra-b.pdf');`);
const beforeDel = psql(`select count(*) from public.acquisition_documents where review_id='${RB}';`).out;
psql(`delete from public.acquisition_reviews where id='${RB}';`);
const afterDel = psql(`select count(*) from public.acquisition_documents where review_id='${RB}';`).out;
check('a review\'s documents go with it', beforeDel === '2' && afterDel === '0', `${beforeDel} → ${afterDel}`);

// ── 7 · same name twice ────────────────────────────────────────────────────
section('7 · re-uploading the same file name');
const dup = psql(`insert into public.acquisition_documents (review_id, user_id, file_name)
                  values ('${RA}','${UA}','lease-a.pdf');`);
check('a second row with the same (review, file name) is refused', !dup.ok,
  (dup.out.match(/acquisition_documents_review_file_key|duplicate key/i) || ['no error'])[0]);
const upsert = psql(`insert into public.acquisition_documents (review_id, user_id, file_name, parsing_status)
                     values ('${RA}','${UA}','lease-a.pdf','success')
                     on conflict (review_id, file_name) do update set parsing_status = excluded.parsing_status
                     returning parsing_status;`);
check('…and an upsert on that key updates the existing row', upsert.ok && upsert.out === 'success', upsert.out.slice(0, 80));

// ── 8 · check constraints ──────────────────────────────────────────────────
section('8 · the value lists are enforced');
for (const [col, bad] of [['parsing_status', 'nearly'], ['intake_kind', 'spreadsheet'], ['produced_kind', 'property']]) {
  const r = psql(`insert into public.acquisition_documents (review_id, user_id, file_name, ${col})
                  values ('${RA}','${UA}','bad-${col}.pdf','${bad}');`);
  check(`${col} rejects "${bad}"`, !r.ok, (r.out.match(/check constraint/i) || ['no error'])[0]);
}
const goodStatuses = psql(`insert into public.acquisition_documents (review_id, user_id, file_name, parsing_status) values
   ('${RA}','${UA}','s1.pdf','pending'), ('${RA}','${UA}','s2.pdf','success'),
   ('${RA}','${UA}','s3.pdf','partial'), ('${RA}','${UA}','s4.pdf','failed');`);
check('all four parsing_status values are accepted', goodStatuses.ok, goodStatuses.out.slice(0, 120));
const nullPath = psql(`select storage_path is null from public.acquisition_documents where file_name='s1.pdf';`);
check('storage_path may be NULL — "the original is not on file" is a real state', nullPath.out === 't');

// ── 9 · updated_at ─────────────────────────────────────────────────────────
section('9 · updated_at moves, created_at does not');
const times = psql(`select created_at, updated_at from public.acquisition_documents where file_name='s1.pdf';`).out.split('|');
psql(`update public.acquisition_documents set parsing_status='success' where file_name='s1.pdf';`);
const times2 = psql(`select created_at, updated_at from public.acquisition_documents where file_name='s1.pdf';`).out.split('|');
check('updated_at advanced on update', times2[1] > times[1], `${times[1]} → ${times2[1]}`);
check('created_at did not move', times2[0] === times[0]);

// ── 10 · rollback ──────────────────────────────────────────────────────────
section('10 · the rollback');
const rb = psqlFile(path.join(ROOT, 'migrations', '023_acquisition_documents_rollback.sql'));
check('the rollback runs', rb.ok, rb.ok ? '' : rb.out.slice(0, 300));
check('the table is gone',
  psql(`select count(*) from information_schema.tables where table_schema='public' and table_name='acquisition_documents';`).out === '0');
check('the constraint 023 added to acquisition_reviews is gone',
  psql(`select count(*) from pg_constraint where conname='acquisition_reviews_id_user_id_key';`).out === '0');
check('acquisition_reviews itself survives with its rows',
  psql(`select count(*) from public.acquisition_reviews;`).out === '1');

// ── 11 · apply again after rollback ────────────────────────────────────────
section('11 · 023 re-applies after a rollback');
const again = psqlFile(path.join(ROOT, 'migrations', '023_acquisition_documents.sql'));
check('023 applies cleanly on the rolled-back database', again.ok, again.ok ? '' : again.out.slice(0, 300));
check('and the table is empty, as a fresh install should be',
  psql(`select count(*) from public.acquisition_documents;`).out === '0');

// ── summary ────────────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(64));
console.log(`RESULT: ${pass} passed, ${fail} failed`);
if (fail) { console.log('FAILED:'); failures.forEach(f => console.log('  - ' + f)); }
cleanup();
process.exit(fail ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e && e.message); cleanup(); process.exit(2); });
