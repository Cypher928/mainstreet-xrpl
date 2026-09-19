'use strict';
/**
 * test-b1-fixture-teardown.js — the B1 CI fixture cleans up everything it
 * caused, including the object it never asked for.
 *
 *   node test-b1-fixture-teardown.js
 *
 * WHY THIS EXISTS
 * ---------------
 * scripts/b1-ci-fixture.js creates a landlord and two properties. Migration
 * 024's properties_default_organization trigger then gives that landlord an
 * organisation — a row the fixture script never writes and, until this fix,
 * never deleted. Six of them accumulated in pilot, one per run, because
 * teardown deleted the user first and organizations.created_by is
 * `on delete set null`: the row survived with nothing left to attribute it to.
 *
 * Offline. The real script is executed as a child process with global.fetch
 * replaced by a fake Supabase that records every request, so these are
 * assertions about what the script DOES, not about what its source says.
 *
 *   A  teardown removes the landlord's organisation, and the run is clean
 *   B  ORDER: properties → organisation → user. Getting this wrong is the bug.
 *   C  SCOPE: only organisations created_by a uid this run made are touched;
 *      an existing orphan (created_by null) is never named in any request
 *   D  the residue re-read cannot be fooled once created_by is nulled
 *   E  a database without 024 still tears down, and asks for no organisation
 *   F  sweep cleans a cancelled run's organisation, in the same order/scope
 */

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT   = __dirname;
const SCRIPT = path.join(ROOT, 'scripts', 'b1-ci-fixture.js');

let pass = 0, fail = 0;
const failures = [];
function t(name, cond, detail) {
  if (cond) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  else {
    fail++; failures.push(name + (detail ? ` — ${detail}` : ''));
    console.log(`  \x1b[31m✗ ${name}\x1b[0m${detail ? ` — ${detail}` : ''}`);
  }
}

// ── The fake Supabase ───────────────────────────────────────────────────────
// Written to disk and preloaded with --require, so the script under test runs
// unmodified and unaware. It answers like PostgREST and GoTrue do, and — the
// point of the exercise — it MODELS THE SET-NULL: deleting a user nulls
// created_by on the organisations they created, exactly as the foreign key
// does. A teardown that deletes the user first therefore cannot find its own
// organisation afterwards, and the test can see that.
const PRELOAD = `
'use strict';
const fs = require('fs');
const LOG  = process.env.B1_STUB_LOG;
const PLAN = JSON.parse(process.env.B1_STUB_PLAN);

const orgs  = PLAN.orgs.slice();               // { id, created_by }
const props = PLAN.properties.slice();         // { id, user_id }
const users = PLAN.users.slice();              // { id, email, created_at }

function record(method, url) {
  fs.appendFileSync(LOG, JSON.stringify({ method, url }) + '\\n');
}
function reply(status, body) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(body === undefined ? '' : JSON.stringify(body)),
  });
}
const qs = (u) => u.split('?')[1] || '';
const eqOf = (u, field) => {
  const m = qs(u).split('&').find(p => p.startsWith(field + '=eq.'));
  return m ? decodeURIComponent(m.slice((field + '=eq.').length)) : null;
};

global.fetch = function (url, opts) {
  const method = ((opts && opts.method) || 'GET').toUpperCase();
  record(method, url);
  const u = String(url);

  // ── PostgREST ──
  if (u.includes('/rest/v1/properties')) {
    const id  = eqOf(u, 'id');
    const uid = eqOf(u, 'user_id');
    if (method === 'DELETE') {
      for (let i = props.length - 1; i >= 0; i--) {
        if ((id && props[i].id === id) || (uid && props[i].user_id === uid)) {
          if (!PLAN.undeletableProperties.includes(props[i].id)) props.splice(i, 1);
        }
      }
      return reply(204);
    }
    if (id) return reply(200, props.filter(p => p.id === id).map(p => ({ id: p.id })));
    return reply(200, props.map(p => ({ id: p.id })));
  }

  if (u.includes('/rest/v1/organizations')) {
    if (!PLAN.orgsPresent) return reply(404, { code: 'PGRST205', message: 'relation does not exist' });
    const id = eqOf(u, 'id');
    const by = eqOf(u, 'created_by');
    if (method === 'DELETE') {
      for (let i = orgs.length - 1; i >= 0; i--) {
        const hit = (id && orgs[i].id === id) || (by && orgs[i].created_by === by);
        if (hit && !PLAN.undeletableOrgs.includes(orgs[i].id)) orgs.splice(i, 1);
      }
      return reply(204);
    }
    let rows = orgs;
    if (id) rows = rows.filter(o => o.id === id);
    if (by) rows = rows.filter(o => o.created_by === by);
    return reply(200, rows.map(o => ({ id: o.id })));
  }

  // ── GoTrue admin ──
  if (u.includes('/auth/v1/admin/users')) {
    const m = u.match(/\\/auth\\/v1\\/admin\\/users\\/([^/?]+)/);
    if (m) {
      const uid = m[1];
      if (method === 'DELETE') {
        const i = users.findIndex(x => x.id === uid);
        if (i >= 0 && !PLAN.undeletableUsers.includes(uid)) {
          users.splice(i, 1);
          // THE FOREIGN KEY: organizations.created_by is on delete set null.
          for (const o of orgs) if (o.created_by === uid) o.created_by = null;
        }
        return reply(200, {});
      }
      const found = users.find(x => x.id === uid);
      return found ? reply(200, { id: found.id }) : reply(404, { msg: 'not found' });
    }
    return reply(200, { users });
  }

  return reply(500, { msg: 'unexpected request: ' + u });
};
`;

function run(verb, plan, state) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'b1fix-'));
  const preload = path.join(dir, 'preload.js');
  const logFile = path.join(dir, 'calls.log');
  fs.writeFileSync(preload, PRELOAD);
  fs.writeFileSync(logFile, '');
  if (state) fs.writeFileSync(path.join(dir, '.b1-ci-state.json'), JSON.stringify(state));

  const full = Object.assign({
    orgsPresent: true, orgs: [], properties: [], users: [],
    undeletableOrgs: [], undeletableProperties: [], undeletableUsers: [],
  }, plan);

  let status = 0, stdout = '', stderr = '';
  try {
    stdout = execFileSync(process.execPath, ['--require', preload, SCRIPT, verb], {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: Object.assign({}, process.env, {
        GITHUB_ACTIONS: '', GITHUB_ENV: '', GITHUB_RUN_ID: '',
        PILOT_SUPABASE_SERVICE_ROLE_KEY: 'stub-key-for-offline-test',
        B1_STUB_LOG: logFile,
        B1_STUB_PLAN: JSON.stringify(full),
      }),
    });
  } catch (e) {
    status = e.status === undefined ? 1 : e.status;
    stdout = (e.stdout || '').toString();
    stderr = (e.stderr || '').toString();
  }

  const calls = fs.readFileSync(logFile, 'utf8').trim().split('\n')
    .filter(Boolean).map(l => JSON.parse(l));
  fs.rmSync(dir, { recursive: true, force: true });
  return { status, stdout, stderr, calls };
}

const idx = (calls, pred) => calls.findIndex(pred);
const isDel = (c, frag) => c.method === 'DELETE' && c.url.includes(frag);

// A world shaped exactly like a real run: four fixture users, two properties
// owned by the landlord, the organisation the trigger gave the landlord — and
// one pre-existing orphan with a null creator, standing in for the six sitting
// in pilot right now.
const LANDLORD = 'u-landlord', TA = 'u-a', TB = 'u-b', TC = 'u-c';
const ORG = 'org-landlord', ORPHAN = 'org-orphan-existing';
const P1 = 'prop-1', P2 = 'prop-2';

const world = () => ({
  orgs: [{ id: ORG, created_by: LANDLORD }, { id: ORPHAN, created_by: null }],
  properties: [{ id: P1, user_id: LANDLORD }, { id: P2, user_id: LANDLORD }],
  users: [LANDLORD, TA, TB, TC].map(id => ({
    id, email: `b1ci-99-${id}@pilot.invalid`, created_at: '2020-01-01T00:00:00Z',
  })),
});
const STATE = { runId: '99', userIds: [LANDLORD, TA, TB, TC], propertyIds: [P1, P2] };

console.log('\n╔══════════════════════════════════════════════════════════════╗');
console.log('║  B1 CI fixture — teardown removes the organisation it caused ║');
console.log('╚══════════════════════════════════════════════════════════════╝\n');

// ── A: the organisation goes ────────────────────────────────────────────────
console.log('A  teardown removes the landlord\'s organisation');
{
  const r = run('teardown', world(), STATE);
  t('A1 teardown succeeds', r.status === 0, `exit ${r.status} ${r.stderr.slice(0, 300)}`);
  t('A2 the landlord\'s organisation is deleted',
    r.calls.some(c => isDel(c, '/organizations') && c.url.includes(`id=eq.${ORG}`)));
  t('A3 both properties are deleted',
    r.calls.some(c => isDel(c, '/properties') && c.url.includes(P1)) &&
    r.calls.some(c => isDel(c, '/properties') && c.url.includes(P2)));
  t('A4 all four users are deleted',
    [LANDLORD, TA, TB, TC].every(u => r.calls.some(c => isDel(c, `/admin/users/${u}`))));
  t('A5 it reports the organisation it removed, and that it re-read to confirm',
    /1 organisation\(s\)/.test(r.stdout) && /re-read confirms none remain/.test(r.stdout), r.stdout.trim());
  t('A6 no warning is emitted on a clean run', !/::warning::/.test(r.stderr), r.stderr.slice(0, 300));
}

// ── B: the order is the fix ─────────────────────────────────────────────────
console.log('\nB  order: properties before the organisation, organisation before its creator');
{
  const r = run('teardown', world(), STATE);
  const delProp = idx(r.calls, c => isDel(c, '/properties'));
  const delOrg  = idx(r.calls, c => isDel(c, '/organizations'));
  const delUser = idx(r.calls, c => isDel(c, `/admin/users/${LANDLORD}`));
  t('B1 properties are deleted before the organisation (organization_id is on delete restrict)',
    delProp !== -1 && delOrg !== -1 && delProp < delOrg, `prop@${delProp} org@${delOrg}`);
  t('B2 the organisation is deleted BEFORE its creator (created_by is on delete set null)',
    delOrg !== -1 && delUser !== -1 && delOrg < delUser, `org@${delOrg} user@${delUser}`);
  t('B3 the organisation is found by created_by while that still points at the fixture landlord',
    idx(r.calls, c => c.method === 'GET' && c.url.includes(`/organizations`) && c.url.includes(`created_by=eq.${LANDLORD}`)) < delUser);
}

// ── C: scope ────────────────────────────────────────────────────────────────
console.log('\nC  scope: only this run\'s organisations, never a pre-existing orphan');
{
  const r = run('teardown', world(), STATE);
  t('C1 the pre-existing orphan is never named in any request',
    !r.calls.some(c => c.url.includes(ORPHAN)), JSON.stringify(r.calls.filter(c => c.url.includes(ORPHAN))));
  t('C2 the orphan survives teardown',
    !r.calls.some(c => isDel(c, '/organizations') && c.url.includes(ORPHAN)));
  t('C3 every organisation DELETE is filtered to a single id',
    r.calls.filter(c => isDel(c, '/organizations')).every(c => /[?&]id=eq\.[^&]+/.test(c.url)),
    JSON.stringify(r.calls.filter(c => isDel(c, '/organizations')).map(c => c.url)));
  t('C4 no organisation DELETE is issued without a filter',
    !r.calls.some(c => isDel(c, '/organizations') && !/[?&](id|created_by)=eq\./.test(c.url)));
  t('C5 the script never asks for organisations by name or by member count',
    !r.calls.some(c => c.url.includes('/organizations') && /name=|members|not\.in|is\.null/.test(c.url)));
}
{
  // The same run with NO organisation of its own: nothing is deleted at all.
  const w = world(); w.orgs = [{ id: ORPHAN, created_by: null }];
  const r = run('teardown', w, STATE);
  t('C6 a run that caused no organisation deletes none',
    r.status === 0 && !r.calls.some(c => isDel(c, '/organizations')), `exit ${r.status}`);
  t('C7 and says so', /0 organisation\(s\)/.test(r.stdout), r.stdout.trim());
}

// ── D: the residue check has teeth ──────────────────────────────────────────
console.log('\nD  a surviving organisation fails the run — even after created_by is nulled');
{
  const w = world();
  const r = run('teardown', Object.assign(w, { undeletableOrgs: [ORG] }), STATE);
  t('D1 teardown exits non-zero when the organisation survives its DELETE',
    r.status !== 0, `exit ${r.status}`);
  t('D2 it names the organisation left behind',
    /::warning::organisation org-landlord still present after delete/.test(r.stderr), r.stderr.slice(0, 400));
  t('D3 the re-read is by id, so nulling created_by cannot hide it',
    r.calls.some(c => c.method === 'GET' && c.url.includes('/organizations') && c.url.includes(`id=eq.${ORG}`) &&
                      idx(r.calls, x => isDel(x, `/admin/users/${LANDLORD}`)) < r.calls.indexOf(c)),
    'no post-user-delete read by id');
}

// ── E: a database without 024 ───────────────────────────────────────────────
console.log('\nE  no 024 applied: teardown still works and asks for no organisation');
{
  const w = world(); w.orgsPresent = false;
  const r = run('teardown', w, STATE);
  t('E1 teardown succeeds', r.status === 0, `exit ${r.status} ${r.stderr.slice(0, 200)}`);
  t('E2 no organisation is deleted', !r.calls.some(c => isDel(c, '/organizations')));
  t('E3 users and properties are still removed',
    r.calls.some(c => isDel(c, '/properties')) &&
    [LANDLORD, TA, TB, TC].every(u => r.calls.some(c => isDel(c, `/admin/users/${u}`))));
}

// ── F: sweep, for the run that was cancelled ────────────────────────────────
console.log('\nF  sweep: a cancelled run\'s organisation is cleaned the same way');
{
  const r = run('sweep', world(), null);
  const delProp = idx(r.calls, c => isDel(c, '/properties'));
  const delOrg  = idx(r.calls, c => isDel(c, '/organizations'));
  const delUser = idx(r.calls, c => isDel(c, `/admin/users/${LANDLORD}`));
  t('F1 sweep succeeds', r.status === 0, `exit ${r.status} ${r.stderr.slice(0, 300)}`);
  t('F2 it deletes the stale landlord\'s organisation', delOrg !== -1);
  t('F3 scoped by created_by to the stale fixture uid',
    r.calls.some(c => isDel(c, '/organizations') && c.url.includes(`created_by=eq.${LANDLORD}`)));
  t('F4 properties → organisation → user, in that order',
    delProp < delOrg && delOrg < delUser, `prop@${delProp} org@${delOrg} user@${delUser}`);
  t('F5 the pre-existing orphan is never named', !r.calls.some(c => c.url.includes(ORPHAN)));
}
{
  const w = world(); w.orgsPresent = false;
  const r = run('sweep', w, null);
  t('F6 sweep works on a database without 024',
    r.status === 0 && !r.calls.some(c => isDel(c, '/organizations')), `exit ${r.status}`);
}
{
  // Nothing stale: the 1-hour cutoff still governs, and no organisation work
  // happens for accounts that are not fixtures.
  const w = world();
  w.users = w.users.map(u => Object.assign({}, u, { created_at: new Date().toISOString() }));
  const r = run('sweep', w, null);
  t('F7 a fresh fixture is not swept mid-run',
    r.status === 0 && !r.calls.some(c => c.method === 'DELETE'), `exit ${r.status}`);
}

console.log('\n' + '─'.repeat(62));
if (fail) {
  console.log(`\x1b[31mRESULT: ${pass} passed, ${fail} failed\x1b[0m`);
  failures.forEach(f => console.log(`  · ${f}`));
  process.exit(1);
}
console.log(`\x1b[32mRESULT: ${pass} passed, 0 failed\x1b[0m`);
