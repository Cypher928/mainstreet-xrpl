'use strict';
/**
 * test-ci-fixture-teardown.js — the CI fixture scripts tear down the
 * organisation they create, and never anything else.
 *
 *   node test-ci-fixture-teardown.js
 *
 * THE DEFECT THIS EXISTS FOR
 *
 * scripts/b1-ci-fixture.js and scripts/pilot-live-fixture.js each build a
 * disposable world on Pilot and delete it. Inserting the landlord's first
 * property fires migration 024's trigger, which creates an organisation named
 * after the landlord's email. Teardown deleted the properties and the users;
 * the membership cascaded away with the user, the organisation did not
 * (created_by is ON DELETE SET NULL), and 88 creator-less organisations
 * accumulated on Pilot in three weeks, one per gate run.
 *
 * WHAT THIS PINS, OFFLINE
 *
 * Both scripts export the pieces of their lifecycle that decide WHAT is deleted
 * and in WHAT ORDER; this suite drives them with a recorder in place of the
 * network. The target stays hard-coded in the scripts — nothing here makes it
 * configurable.
 *
 *   1  the fixture-name predicate accepts exactly the trigger's naming of a
 *      fixture landlord and nothing that could be a person's organisation
 *   2  the teardown plan deletes properties, then organisations, then users,
 *      then re-reads all three; the organisation step restates id, creator
 *      and name; an organisation with a foreign name or a foreign creator is
 *      refused, never deleted
 *   3  the executor issues the organisation DELETE with all three filters and
 *      asks for the deleted rows back; anything but exactly one row fails the
 *      step; a refused organisation is counted as residue and never deleted;
 *      a row that survives its delete is reported
 *   4  discovery finds an organisation the state file missed, while the user
 *      still exists; a failed listing falls back to the recorded ones
 *   5  the sweep deletes an account's organisation before the account, and
 *      leaves both alone when the organisation is not a fixture organisation or
 *      its delete does not match exactly one row
 *   6  mutants — each deliberate break of the guards above makes this suite
 *      fail, so the guards are load-bearing, not decorative
 *   7  static — both scripts keep their Pilot pin and carry no production ref,
 *      and requiring them runs nothing and writes nothing
 *
 * OFFLINE. No sockets, no credentials, no state file.
 */

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const ROOT = __dirname;
const SCRIPTS = [
  { label: 'b1',   file: path.join(ROOT, 'scripts/b1-ci-fixture.js'),      tag: 'landlord', state: '.b1-ci-state.json' },
  { label: 'plci', file: path.join(ROOT, 'scripts/pilot-live-fixture.js'), tag: 'a',        state: '.pilot-live-state.json' },
];

let pass = 0, fail = 0;
const failures = [];
function t(name, fn) {
  try { fn(); pass++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  catch (e) { fail++; failures.push(`${name}: ${e.message}`); console.log(`  \x1b[31m✗\x1b[0m ${name}\n      → ${e.message}`); }
}
async function ta(name, fn) {
  try { await fn(); pass++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  catch (e) { fail++; failures.push(`${name}: ${e.message}`); console.log(`  \x1b[31m✗\x1b[0m ${name}\n      → ${e.message}`); }
}
const ok = (c, m) => { if (!c) throw new Error(m || 'expected truthy'); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m || ''} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const section = (s) => console.log('\n── ' + s + ' ' + '─'.repeat(Math.max(0, 60 - s.length)));

const L  = '11111111-1111-4111-8111-111111111111';  // landlord
const U2 = '22222222-2222-4222-8222-222222222222';  // another fixture user
const U3 = '33333333-3333-4333-8333-333333333333';
const P1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', P2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const O  = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const O2 = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const STRANGER = '99999999-9999-4999-8999-999999999999';

/** A recorder standing in for the scripts' rest()/admin(): every call is kept, answers are scripted. */
function recorder(answers = {}) {
  const calls = [], warnings = [];
  const idIn = (p) => (p.match(/id=eq\.([0-9a-f-]{36})/) || [])[1];
  const io = {
    calls, warnings,
    async rest(p, o = {}) {
      const method = o.method || 'GET';
      calls.push({ via: 'rest', method, path: p, prefer: o.prefer || null });
      if (answers.rest) { const a = answers.rest(p, o, method); if (a) return a; }
      if (method === 'DELETE' && p.startsWith('/organizations?')) return { ok: true, status: 200, body: [{ id: idIn(p) }] };
      if (method === 'DELETE') return { ok: true, status: 204, body: null };
      return { ok: true, status: 200, body: [] };
    },
    async admin(p, o = {}) {
      const method = o.method || 'GET';
      calls.push({ via: 'admin', method, path: p });
      if (answers.admin) { const a = answers.admin(p, o, method); if (a) return a; }
      if (method === 'DELETE') return { ok: true, status: 200, body: {} };
      return { ok: false, status: 404, body: { msg: 'user not found' } };
    },
    warn(m) { warnings.push(m); },
  };
  return io;
}
const kinds = (plan) => plan.map(s => s.kind);
const firstIndex = (plan, kind) => plan.findIndex(s => s.kind === kind);
const lastIndex  = (plan, kind) => plan.map(s => s.kind).lastIndexOf(kind);

/** The assertions every mutant must break at least one of. */
async function coreAssertions(M, S) {
  const email = `${M.FIXTURE_PREFIX}37554003196-${S.tag}@${M.FIXTURE_EMAIL_DOMAIN}`;
  ok(M.isFixtureOrgName(email), 'fixture name rejected');
  ok(!M.isFixtureOrgName(`${M.FIXTURE_PREFIX}real.user+tag@${M.FIXTURE_EMAIL_DOMAIN}`), 'non-fixture shape accepted');
  const state = { propertyIds: [P1, P2], userIds: [L, U2], organizations: [{ id: O, createdBy: L, name: email }] };
  const plan = M.teardownPlan(state);
  ok(firstIndex(plan, 'delete-organization') >= 0, 'plan has no organisation delete');
  ok(lastIndex(plan, 'delete-property') < firstIndex(plan, 'delete-organization'), 'organisation not after properties');
  ok(lastIndex(plan, 'delete-organization') < firstIndex(plan, 'delete-user'), 'organisation not before users');
  const io = recorder();
  const r = await M.executePlan(plan, io);
  const del = io.calls.find(c => c.method === 'DELETE' && c.path.startsWith('/organizations?'));
  ok(del, 'no organisation DELETE issued');
  ok(del.path.includes(`id=eq.${O}`) && del.path.includes(`created_by=eq.${L}`) && del.path.includes(`name=eq.${encodeURIComponent(email)}`), 'organisation DELETE lacks a filter: ' + del.path);
  eq(r.failed + r.residue, 0, 'clean teardown reported leftovers');
  const zero = recorder({ rest: (p, o, m) => (m === 'DELETE' && p.startsWith('/organizations?')) ? { ok: true, status: 200, body: [] } : null });
  const r0 = await M.executePlan(plan, zero);
  ok(r0.failed >= 1, 'a zero-row organisation DELETE was not a failure');
  const found = recorder({ rest: (p) => p.startsWith(`/organizations?created_by=eq.${L}`) ? { ok: true, status: 200, body: [{ id: O2, name: email, created_by: L }] } : null });
  const disc = await M.discoverOrganizations({ propertyIds: [], userIds: [L], organizations: [] }, found);
  ok(disc.some(o => o.id === O2 && o.createdBy === L), 'discovery did not pick up the unrecorded organisation');
  const stranger = recorder({ rest: (p) => p.startsWith(`/organizations?created_by=eq.${L}`) ? { ok: true, status: 200, body: [{ id: O2, name: 'Acme Holdings' }] } : null });
  await M.sweepUser({ id: L, email }, stranger);
  ok(!stranger.calls.some(c => c.via === 'admin' && c.method === 'DELETE'), 'sweep deleted the account of a user with a non-fixture organisation');
  ok(!stranger.calls.some(c => c.via === 'rest' && c.method === 'DELETE' && c.path.startsWith('/organizations?')), 'sweep deleted a non-fixture organisation');
}

function loadMutant(file, edits) {
  let src = fs.readFileSync(file, 'utf8');
  for (const [from, to] of edits) {
    if (!src.includes(from)) throw new Error('mutant anchor not found: ' + from.slice(0, 70));
    if (src.split(from).length !== 2) throw new Error('mutant anchor not unique: ' + from.slice(0, 70));
    src = src.replace(from, to);
  }
  const tmp = path.join(os.tmpdir(), `ms-fixture-mutant-${path.basename(file, '.js')}-${Math.random().toString(36).slice(2)}.js`);
  fs.writeFileSync(tmp, src);
  try { return require(tmp); } finally { try { fs.unlinkSync(tmp); } catch (_) {} }
}

const MUTANTS = [
  ['M1 the plan forgets the organisation',
    [[`else                                    steps.push({ kind: 'delete-organization', id: o.id, createdBy: o.createdBy, name: o.name });`, `else {}`]]],
  ['M2 users are deleted before organisations',
    [[`  const steps = [];\n  for (const id of props) steps.push({ kind: 'delete-property', id });`,
      `  const steps = [];\n  for (const id of users) steps.push({ kind: 'delete-user', id });\n  for (const id of props) steps.push({ kind: 'delete-property', id });`],
     [`  for (const id of users) steps.push({ kind: 'delete-user', id });\n  // Not a formality`, `  // Not a formality`]]],
  ['M3 the DELETE drops the created_by filter',
    [[`&created_by=eq.\${s.createdBy}&name=eq.`, `&name=eq.`]]],
  ['M4 the fixture-name predicate is widened',
    [[`[a-z0-9]+-[a-z]+@`, `.*@`]]],
  ['M5 a zero-row DELETE is accepted',
    [[`if (n !== 1) { failed++; io.warn(\`organisation \${s.id}: delete matched`, `if (n > 1) { failed++; io.warn(\`organisation \${s.id}: delete matched`]]],
  ['M6 the sweep deletes the account despite refusing its organisation',
    [[`which is not a fixture name — leaving account and organisation alone\`);\n      return { swept: false };`, `which is not a fixture name — leaving account and organisation alone\`);`]]],
  ['M7 discovery ignores what it finds',
    [[`for (const o of r.body) if (!known.some(k => k.id === o.id)) known.push(`, `for (const o of []) if (!known.some(k => k.id === o.id)) known.push(`]]],
];

(async () => {
  for (const S of SCRIPTS) {
    const M = require(S.file);
    const email = `${M.FIXTURE_PREFIX}37554003196-${S.tag}@${M.FIXTURE_EMAIL_DOMAIN}`;

    section(`${S.label}: 1  the fixture-name predicate`);
    t(`${S.label}: accepts the trigger's naming of a CI fixture landlord`, () => ok(M.isFixtureOrgName(email)));
    t(`${S.label}: accepts a local run id (local<millis>)`, () => ok(M.isFixtureOrgName(`${M.FIXTURE_PREFIX}local1759800000000-${S.tag}@pilot.invalid`)));
    t(`${S.label}: rejects the other gate's prefix`, () => {
      const other = M.FIXTURE_PREFIX === 'b1ci-' ? 'plci-' : 'b1ci-';
      ok(!M.isFixtureOrgName(`${other}37554003196-a@pilot.invalid`));
    });
    t(`${S.label}: rejects anything a person could own`, () => {
      for (const n of ['Acme Holdings', 'owner@example.com', 'Organisation', `${M.FIXTURE_PREFIX}real.user+tag@pilot.invalid`,
                       `${M.FIXTURE_PREFIX}1-a@pilot.invalid.example.com`, `${M.FIXTURE_PREFIX}1-a@PILOT.INVALID`, ` ${email}`, `${email} `,
                       `${email}\n`, M.FIXTURE_PREFIX, `${M.FIXTURE_PREFIX}@pilot.invalid`, `${M.FIXTURE_PREFIX}1-@pilot.invalid`, '', null, undefined, 42]) {
        ok(!M.isFixtureOrgName(n), `accepted ${JSON.stringify(n)}`);
      }
    });

    section(`${S.label}: 2  the teardown plan`);
    const state = { runId: '37554003196', propertyIds: [P1, P2], userIds: [L, U2, U3], organizations: [{ id: O, createdBy: L, name: email }] };
    const plan = M.teardownPlan(state);
    t(`${S.label}: properties, then organisations, then users, then re-reads`, () => {
      ok(lastIndex(plan, 'delete-property') < firstIndex(plan, 'delete-organization'), 'organisation before a property');
      ok(lastIndex(plan, 'delete-organization') < firstIndex(plan, 'delete-user'), 'user before the organisation');
      ok(lastIndex(plan, 'delete-user') < firstIndex(plan, 'verify-absent'), 're-read before a delete');
      ok(lastIndex(plan, 'delete-user') < firstIndex(plan, 'verify-absent-user'), 'user re-read before a delete');
    });
    t(`${S.label}: every object is deleted once and re-read once`, () => {
      const k = kinds(plan);
      eq(k.filter(x => x === 'delete-property').length, 2, 'property deletes');
      eq(k.filter(x => x === 'delete-organization').length, 1, 'organisation deletes');
      eq(k.filter(x => x === 'delete-user').length, 3, 'user deletes');
      eq(plan.filter(s => s.kind === 'verify-absent' && s.table === 'properties').length, 2, 'property re-reads');
      eq(plan.filter(s => s.kind === 'verify-absent' && s.table === 'organizations').length, 1, 'organisation re-reads');
      eq(k.filter(x => x === 'verify-absent-user').length, 3, 'user re-reads');
      eq(k.length, 12, 'total steps');
    });
    t(`${S.label}: the organisation step restates id, creator and name`, () => {
      const s = plan.find(x => x.kind === 'delete-organization');
      eq(s.id, O, 'id'); eq(s.createdBy, L, 'createdBy'); eq(s.name, email, 'name');
    });
    t(`${S.label}: an organisation with a foreign name is refused, not deleted`, () => {
      const p = M.teardownPlan({ ...state, organizations: [{ id: O, createdBy: L, name: 'Acme Holdings' }] });
      eq(kinds(p).filter(x => x === 'delete-organization').length, 0, 'deletes');
      eq(kinds(p).filter(x => x === 'refuse-organization').length, 1, 'refusals');
      eq(p.filter(s => s.kind === 'verify-absent' && s.table === 'organizations').length, 0, 'no re-read of a refused row');
    });
    t(`${S.label}: an organisation created by a stranger is refused, not deleted`, () => {
      const p = M.teardownPlan({ ...state, organizations: [{ id: O, createdBy: STRANGER, name: email }] });
      eq(kinds(p).filter(x => x === 'delete-organization').length, 0, 'deletes');
      eq(kinds(p).filter(x => x === 'refuse-organization').length, 1, 'refusals');
    });
    t(`${S.label}: a state file from before the fix (no organizations key) still plans`, () => {
      const p = M.teardownPlan({ runId: 'x', propertyIds: [P1], userIds: [L] });
      eq(kinds(p).join(','), 'delete-property,delete-user,verify-absent,verify-absent-user');
    });

    section(`${S.label}: 3  the executor`);
    await ta(`${S.label}: the organisation DELETE carries id, created_by and the exact name, and asks for the rows back`, async () => {
      const io = recorder();
      const r = await M.executePlan(plan, io);
      const del = io.calls.filter(c => c.method === 'DELETE' && c.path.startsWith('/organizations?'));
      eq(del.length, 1, 'organisation DELETEs');
      ok(del[0].path.includes(`id=eq.${O}`), 'id filter');
      ok(del[0].path.includes(`created_by=eq.${L}`), 'created_by filter');
      ok(del[0].path.includes(`name=eq.${encodeURIComponent(email)}`), 'name filter');
      eq(del[0].prefer, null, 'must not ask for return=minimal — the row count is the check');
      eq(r.failed, 0, 'failed'); eq(r.residue, 0, 'residue'); eq(io.warnings.length, 0, 'warnings');
    });
    await ta(`${S.label}: the calls happen in plan order`, async () => {
      const io = recorder();
      await M.executePlan(plan, io);
      const seq = io.calls.map(c => `${c.via}:${c.method}:${c.path.split('?')[0].split('/')[1] || c.path}`);
      const i = (pfx) => seq.findIndex(s => s.startsWith(pfx)), li = (pfx) => seq.map(s => s.startsWith(pfx)).lastIndexOf(true);
      ok(li('rest:DELETE:properties') < i('rest:DELETE:organizations'), 'organisation DELETE before a property DELETE');
      ok(li('rest:DELETE:organizations') < i('admin:DELETE:admin'), 'user DELETE before the organisation DELETE');
      ok(li('admin:DELETE:admin') < i('rest:GET:properties'), 're-read before the deletes finished');
      eq(io.calls.length, 12, 'one call per step');
    });
    await ta(`${S.label}: a DELETE that matches no row is a failure, not a no-op`, async () => {
      const io = recorder({ rest: (p, o, m) => (m === 'DELETE' && p.startsWith('/organizations?')) ? { ok: true, status: 200, body: [] } : null });
      const r = await M.executePlan(plan, io);
      eq(r.failed, 1, 'failed');
      ok(io.warnings.some(w => w.includes(O) && /expected exactly 1/.test(w)), 'warning names the organisation');
    });
    await ta(`${S.label}: a DELETE that matches two rows is a failure`, async () => {
      const io = recorder({ rest: (p, o, m) => (m === 'DELETE' && p.startsWith('/organizations?')) ? { ok: true, status: 200, body: [{ id: O }, { id: O2 }] } : null });
      eq((await M.executePlan(plan, io)).failed, 1);
    });
    await ta(`${S.label}: an HTTP error on the DELETE is a failure`, async () => {
      const io = recorder({ rest: (p, o, m) => (m === 'DELETE' && p.startsWith('/organizations?')) ? { ok: false, status: 409, body: { message: 'restrict' } } : null });
      const r = await M.executePlan(plan, io);
      eq(r.failed, 1); ok(io.warnings.some(w => w.includes('http 409')), 'status reported');
    });
    await ta(`${S.label}: a refused organisation is residue and no DELETE is issued for it`, async () => {
      const io = recorder();
      const p = M.teardownPlan({ ...state, organizations: [{ id: O, createdBy: L, name: 'Acme Holdings' }] });
      const r = await M.executePlan(p, io);
      eq(r.residue, 1, 'residue');
      ok(!io.calls.some(c => c.method === 'DELETE' && c.path.startsWith('/organizations?')), 'a DELETE was issued');
      ok(io.warnings.some(w => w.includes('not deleting organisation') && w.includes('Acme Holdings')), 'warning');
    });
    await ta(`${S.label}: a row that survives its delete is reported as residue`, async () => {
      const io = recorder({ rest: (p, o, m) => (m === 'GET' && p.startsWith(`/organizations?id=eq.${O}`)) ? { ok: true, status: 200, body: [{ id: O }] } : null });
      const r = await M.executePlan(plan, io);
      eq(r.residue, 1); ok(io.warnings.some(w => w.includes('organizations row') && w.includes('still present')), 'warning');
    });
    await ta(`${S.label}: a user that survives its delete is reported as residue`, async () => {
      const io = recorder({ admin: (p, o, m) => (m === 'GET' && p === `/admin/users/${U2}`) ? { ok: true, status: 200, body: { id: U2 } } : null });
      eq((await M.executePlan(plan, io)).residue, 1);
    });

    section(`${S.label}: 4  discovery`);
    await ta(`${S.label}: an organisation the state file missed is found through its creator`, async () => {
      const io = recorder({ rest: (p) => p.startsWith(`/organizations?created_by=eq.${L}`) ? { ok: true, status: 200, body: [{ id: O2, name: email, created_by: L }] } : null });
      const got = await M.discoverOrganizations({ propertyIds: [P1], userIds: [L, U2], organizations: [] }, io);
      eq(got.length, 1); eq(got[0].id, O2); eq(got[0].createdBy, L); eq(got[0].name, email);
      eq(io.calls.filter(c => c.path.startsWith('/organizations?created_by=eq.')).length, 2, 'one listing per user');
    });
    await ta(`${S.label}: a recorded organisation is not duplicated by discovery`, async () => {
      const io = recorder({ rest: (p) => p.startsWith(`/organizations?created_by=eq.${L}`) ? { ok: true, status: 200, body: [{ id: O, name: email, created_by: L }] } : null });
      const got = await M.discoverOrganizations(state, io);
      eq(got.length, 1); eq(got[0].id, O);
    });
    await ta(`${S.label}: a failed listing warns and keeps the recorded organisations`, async () => {
      const io = recorder({ rest: (p) => p.startsWith('/organizations?created_by=eq.') ? { ok: false, status: 500, body: null } : null });
      const got = await M.discoverOrganizations(state, io);
      eq(got.length, 1); eq(io.warnings.length, 3, 'one warning per user');
    });
    await ta(`${S.label}: a discovered organisation with a foreign name is refused by the plan`, async () => {
      const io = recorder({ rest: (p) => p.startsWith(`/organizations?created_by=eq.${L}`) ? { ok: true, status: 200, body: [{ id: O2, name: 'Acme Holdings', created_by: L }] } : null });
      const got = await M.discoverOrganizations({ propertyIds: [], userIds: [L], organizations: [] }, io);
      const p = M.teardownPlan({ propertyIds: [], userIds: [L], organizations: got });
      eq(kinds(p).filter(x => x === 'refuse-organization').length, 1);
      eq(kinds(p).filter(x => x === 'delete-organization').length, 0);
    });

    section(`${S.label}: 5  the sweep`);
    await ta(`${S.label}: properties, then the organisation (three filters), then the account`, async () => {
      const io = recorder({ rest: (p) => p.startsWith(`/organizations?created_by=eq.${L}`) ? { ok: true, status: 200, body: [{ id: O, name: email }] } : null });
      const r = await M.sweepUser({ id: L, email }, io);
      eq(r.swept, true);
      const seq = io.calls.map(c => `${c.via}:${c.method}:${c.path.split('?')[0]}`);
      eq(seq.join(' '), `rest:DELETE:/properties rest:GET:/organizations rest:DELETE:/organizations admin:DELETE:/admin/users/${L}`);
      const del = io.calls.find(c => c.method === 'DELETE' && c.path.startsWith('/organizations?'));
      ok(del.path.includes(`id=eq.${O}`) && del.path.includes(`created_by=eq.${L}`) && del.path.includes(`name=eq.${encodeURIComponent(email)}`), del.path);
      eq(del.prefer, null, 'rows must come back');
    });
    await ta(`${S.label}: an account with no organisation is swept as before`, async () => {
      const io = recorder();
      eq((await M.sweepUser({ id: L, email }, io)).swept, true);
      ok(io.calls.some(c => c.via === 'admin' && c.method === 'DELETE'), 'user deleted');
    });
    await ta(`${S.label}: a non-fixture organisation leaves account and organisation alone`, async () => {
      const io = recorder({ rest: (p) => p.startsWith(`/organizations?created_by=eq.${L}`) ? { ok: true, status: 200, body: [{ id: O, name: 'Acme Holdings' }] } : null });
      const r = await M.sweepUser({ id: L, email }, io);
      eq(r.swept, false);
      ok(!io.calls.some(c => c.method === 'DELETE' && (c.path.startsWith('/organizations?') || c.via === 'admin')), 'something was deleted');
      ok(io.warnings.some(w => w.includes('Acme Holdings')), 'warning names it');
    });
    await ta(`${S.label}: an organisation DELETE that does not match exactly one row leaves the account`, async () => {
      const io = recorder({ rest: (p, o, m) => p.startsWith(`/organizations?created_by=eq.${L}`) ? { ok: true, status: 200, body: [{ id: O, name: email }] }
                                             : (m === 'DELETE' && p.startsWith('/organizations?')) ? { ok: true, status: 200, body: [] } : null });
      const r = await M.sweepUser({ id: L, email }, io);
      eq(r.swept, false);
      ok(!io.calls.some(c => c.via === 'admin' && c.method === 'DELETE'), 'user deleted anyway');
    });
    await ta(`${S.label}: a failed organisation listing leaves the account for the next sweep`, async () => {
      const io = recorder({ rest: (p) => p.startsWith('/organizations?created_by=eq.') ? { ok: false, status: 500, body: null } : null });
      const r = await M.sweepUser({ id: L, email }, io);
      eq(r.swept, false);
      ok(!io.calls.some(c => c.via === 'admin' && c.method === 'DELETE'), 'user deleted anyway');
    });

    section(`${S.label}: 6  mutants`);
    for (const [name, edits] of MUTANTS) {
      await ta(`${S.label}: ${name} — killed`, async () => {
        const mutant = loadMutant(S.file, edits);
        let died = false;
        try { await coreAssertions(mutant, S); } catch (_) { died = true; }
        ok(died, 'the mutant passed every core assertion — a guard is not load-bearing');
      });
    }
    await ta(`${S.label}: the unmutated script passes the core assertions the mutants must break`, async () => { await coreAssertions(M, S); });

    section(`${S.label}: 7  static`);
    const src = fs.readFileSync(S.file, 'utf8');
    t(`${S.label}: still pinned to the pilot project ref (the workflow's grep)`, () => {
      ok(/PILOT_REF *= *'bhmktujbxdbvdmpybmad'/.test(src), 'pin missing');
      eq(M.PILOT_REF, 'bhmktujbxdbvdmpybmad');
    });
    t(`${S.label}: the production ref appears only as the PRODUCTION_REF constant`, () => {
      const offending = src.split('\n').filter(l => l.includes('zhsuhehgehbzkmzurzyf') && !l.includes('PRODUCTION_REF'));
      eq(offending.length, 0, 'lines: ' + JSON.stringify(offending));
    });
    t(`${S.label}: verbs run only when the script is the entry point`, () => {
      ok(src.includes('if (require.main === module) {'), 'guard missing');
      ok(src.indexOf('module.exports') < src.indexOf('if (require.main === module) {'), 'exports after the guard');
    });
    t(`${S.label}: requiring the script wrote no state file`, () => {
      ok(!fs.existsSync(path.join(process.cwd(), S.state)), `${S.state} exists in the working directory`);
    });
  }

  const TOTAL_EXPECTED = 79;
  t(`suite runs all ${TOTAL_EXPECTED} checks`, () => {
    eq(pass + fail + 1, TOTAL_EXPECTED, 'test count changed — update TOTAL_EXPECTED deliberately');
  });

  console.log('\n' + '─'.repeat(58));
  if (fail) {
    console.log(`\x1b[31mRESULT: ${pass} passed, ${fail} failed\x1b[0m`);
    failures.forEach(f => console.log(`  · ${f}`));
    process.exit(1);
  }
  console.log(`\x1b[32mRESULT: ${pass} passed, 0 failed\x1b[0m`);
})().catch(e => { console.error(e.stack || String(e)); process.exit(1); });
