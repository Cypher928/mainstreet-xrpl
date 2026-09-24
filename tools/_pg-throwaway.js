'use strict';
/**
 * tools/_pg-throwaway.js — the throwaway PostgreSQL cluster the grant and
 * payment-access verifiers run against. Not a verifier itself (the leading
 * underscore keeps it out of every "run all tools" glob).
 *
 * It contacts NO Supabase project. It builds a cluster in a temp directory,
 * stands up the pieces of a Supabase project that migrations assume (the three
 * API roles, the auth schema, auth.uid()), and deletes everything on exit.
 *
 * THE DEFAULT-PRIVILEGE MODEL IS A PARAMETER, on purpose:
 *
 *   'post-2026-10-30'  what Supabase does from October 30, 2026 — nothing created
 *                      in public is granted to anon, authenticated or
 *                      service_role unless the migration grants it. Every new
 *                      verifier runs under this one.
 *   'legacy'           what Pilot was actually built under — every table and
 *                      function created in public is granted to all three API
 *                      roles (and functions to PUBLIC). Used only to reproduce
 *                      Pilot's CURRENT state, e.g. to prove a bug before fixing it.
 *
 * service_role is created with BYPASSRLS, as it is on Supabase.
 *
 * SKIPS (exit 0) when no local PostgreSQL server binary is present, and says so
 * loudly — a skip is not a pass and must not read like one.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawn } = require('child_process');

const PGBIN = ['/usr/lib/postgresql/16/bin', '/usr/lib/postgresql/15/bin', '/usr/pgsql-16/bin', '/usr/local/bin']
  .find(d => { try { return fs.existsSync(path.join(d, 'initdb')) && fs.existsSync(path.join(d, 'postgres')); } catch (_) { return false; } });

const PRIVS = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'];

const DEFAULTS = {
  // PostgreSQL's own global default gives EXECUTE on every new function to
  // PUBLIC, and per-schema default privileges only ADD to the global ones — so
  // the PUBLIC revoke has to be global to take effect at all. Tables and
  // sequences have no global grant to other roles, so the per-schema revokes
  // there state the model rather than change it.
  'post-2026-10-30': `
    alter default privileges in schema public revoke all     on tables    from anon, authenticated, service_role;
    alter default privileges in schema public revoke all     on sequences from anon, authenticated, service_role;
    alter default privileges                  revoke execute on functions from public;
    alter default privileges in schema public revoke execute on functions from anon, authenticated, service_role;`,
  'legacy': `
    alter default privileges in schema public grant all     on tables    to anon, authenticated, service_role;
    alter default privileges in schema public grant all     on sequences to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;`,
};

function skip(what) {
  console.log('\n\x1b[33m⚠ SKIPPED — ' + what + '\x1b[0m');
  console.log('  Nothing was executed. This is a skip, not a pass.\n');
  process.exit(0);
}

/** A tally of named checks, printed as the other verifiers print them. */
function tally() {
  let pass = 0, fail = 0;
  const failures = [];
  return {
    check(name, ok, detail) {
      if (ok) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${name}${detail ? '  — ' + detail : ''}`); }
      else    { fail++; failures.push(name + (detail ? ': ' + detail : '')); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? '  — ' + detail : ''}`); }
      return !!ok;
    },
    section(s) { console.log('\n── ' + s + ' ' + '─'.repeat(Math.max(0, 60 - s.length))); },
    finish() {
      console.log('\n' + '─'.repeat(64));
      console.log(`RESULT: ${pass} passed, ${fail} failed`);
      if (fail) { console.log('FAILED:'); failures.forEach(f => console.log('  - ' + f)); }
      process.exit(fail ? 1 : 0);
    },
  };
}

/** Start a cluster. Returns helpers bound to it; the cluster dies with the process. */
function startCluster(label) {
  if (!PGBIN) skip('no local PostgreSQL server binary found. Install postgresql-16 (server, not just psql).');
  const IS_ROOT = typeof process.getuid === 'function' && process.getuid() === 0;
  let AS_PG = null;
  if (IS_ROOT) {
    try { execFileSync('id', ['-u', 'postgres'], { stdio: 'ignore' }); AS_PG = ['setpriv', ['--reuid=postgres', '--regid=postgres', '--clear-groups']]; }
    catch (_) { skip('running as root and there is no `postgres` user to drop to.'); }
  }
  const pgArgs = (bin, args) => AS_PG ? [AS_PG[0], [...AS_PG[1], path.join(PGBIN, bin), ...args]] : [path.join(PGBIN, bin), args];
  const pgRun = (bin, args, opts) => { const [c, a] = pgArgs(bin, args); return execFileSync(c, a, opts); };
  const pgSpawn = (bin, args, opts) => { const [c, a] = pgArgs(bin, args); return spawn(c, a, opts); };

  const tmp  = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-' + label + '-'));
  const DATA = path.join(tmp, 'data'), SOCK = path.join(tmp, 'sock'), LOG = path.join(tmp, 'pg.log');
  fs.mkdirSync(SOCK); fs.writeFileSync(LOG, '');
  if (AS_PG) { try { execFileSync('chown', ['-R', 'postgres:postgres', tmp]); } catch (_) {} }
  let server = null;
  process.on('exit', () => {
    try { if (server) pgRun('pg_ctl', ['-D', DATA, '-m', 'immediate', 'stop'], { stdio: 'ignore' }); } catch (_) {}
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
  });

  pgRun('initdb', ['-D', DATA, '-U', 'postgres', '--auth=trust', '-E', 'UTF8'], { stdio: 'ignore' });
  server = pgSpawn('postgres', ['-D', DATA, '-k', SOCK, '-c', 'listen_addresses=', '-c', 'log_min_messages=warning'],
                   { stdio: ['ignore', fs.openSync(LOG, 'a'), fs.openSync(LOG, 'a')] });
  let up = false;
  for (let i = 0; i < 100; i++) {
    try { pgRun('pg_isready', ['-h', SOCK, '-U', 'postgres'], { stdio: 'ignore' }); up = true; break; }
    catch (_) { execFileSync('sleep', ['0.2']); }
  }
  if (!up) { console.log('Cannot start the throwaway cluster:\n' + fs.readFileSync(LOG, 'utf8').slice(-600)); process.exit(2); }

  function psql(sql, db) {
    const args = ['-h', SOCK, '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-X', '-q', '-t', '-A', '-c', sql];
    try { return { ok: true, out: pgRun('psql', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() }; }
    catch (e) { return { ok: false, out: String((e.stdout || '') + (e.stderr || '')).trim() }; }
  }
  function psqlText(text, db, name) {
    const staged = path.join(tmp, 'sql-' + (name || 'inline') + '-' + Math.random().toString(36).slice(2) + '.sql');
    fs.writeFileSync(staged, text);
    if (AS_PG) { try { execFileSync('chown', ['postgres:postgres', staged]); } catch (_) {} }
    const args = ['-h', SOCK, '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-X', '-q', '-f', staged];
    try { return { ok: true, out: pgRun('psql', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() }; }
    catch (e) { return { ok: false, out: String((e.stdout || '') + (e.stderr || '')).trim() }; }
  }
  const psqlFile = (file, db) => psqlText(fs.readFileSync(file, 'utf8'), db, path.basename(file));

  /** A fresh database with the Supabase pieces migrations assume, under the given default-privilege model. */
  function database(name, model) {
    if (!DEFAULTS[model]) throw new Error('unknown default-privilege model ' + model);
    pgRun('createdb', ['-h', SOCK, '-U', 'postgres', name], { stdio: 'ignore' });
    const r = psql(`
      create extension if not exists pgcrypto;
      do $$ begin
        if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
        if not exists (select 1 from pg_roles where rolname='service_role')  then create role service_role nologin bypassrls; end if;
        if not exists (select 1 from pg_roles where rolname='anon')          then create role anon nologin;          end if;
      end $$;
      create schema if not exists auth;
      create table if not exists auth.users (id uuid primary key default gen_random_uuid(), email text);
      create or replace function auth.uid() returns uuid language sql stable as $f$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $f$;
      grant usage on schema auth to anon, authenticated, service_role;
      grant execute on function auth.uid() to anon, authenticated, service_role;
      grant usage on schema public to anon, authenticated, service_role;
      ${DEFAULTS[model]}
    `, name);
    return r;
  }

  /** Run SQL as an API role, the way PostgREST does: SET LOCAL ROLE plus the JWT subject. */
  function as(role, uid, sql, db) {
    const sub = uid ? `set local request.jwt.claim.sub='${uid}';` : '';
    return psql(`set local role ${role}; ${sub} ${sql}`, db);
  }

  /** The exact table privileges a role holds, e.g. 'INSERT,SELECT,UPDATE' or '' for none. */
  function privs(table, role, db) {
    const cols = PRIVS.map(p => `case when has_table_privilege('${role}', '${table}', '${p}') then '${p}' end`).join(', ');
    const r = psql(`select concat_ws(',', ${cols});`, db);
    return r.ok ? r.out.split(',').filter(Boolean).sort().join(',') : 'ERROR: ' + r.out;
  }

  const canExecute = (role, signature, db) =>
    psql(`select has_function_privilege('${role}', '${signature}', 'EXECUTE');`, db).out === 't';

  /**
   * Switch an existing database to another default-privilege model. Objects
   * already created keep the grants they got; only objects created afterwards
   * follow the new model — exactly what the October 30 change does to a
   * project that already exists (Pilot).
   */
  const setModel = (db, model) => {
    if (!DEFAULTS[model]) throw new Error('unknown default-privilege model ' + model);
    return psql(DEFAULTS[model], db);
  };

  return { psql, psqlText, psqlFile, database, as, privs, canExecute, setModel, PGBIN, DATA };
}

/** True when a statement was refused for lack of a privilege (SQLSTATE 42501), not for any other reason. */
const denied = (r) => !r.ok && /permission denied/i.test(r.out);

/** '<none>' reads better than '' in a failure message. */
const show = (s) => s === '' ? '<none>' : s;
const set = (list) => list.slice().sort().join(',');

module.exports = { startCluster, tally, PRIVS, DEFAULTS, show, set, denied };
