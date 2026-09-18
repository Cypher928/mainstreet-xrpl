'use strict';
/**
 * test-030-event-derivation.js — P0.5: durable property history, derived in
 * the same transaction as the property write, proved against a real database.
 *
 *   node test-030-event-derivation.js
 *
 * WHY A REAL DATABASE
 * -------------------
 * The whole guarantee is transactional: the property mutation and the durable
 * event commit together or not at all. Nothing short of a real PostgreSQL can
 * demonstrate that, and the failure this design exists to prevent — the UI
 * reporting success while history is silently gone — is invisible to any test
 * that stops at the HTTP boundary.
 *
 * This suite starts its own PostgreSQL, applies migrations 028, 028b and 030
 * UNMODIFIED, and writes property rows shaped exactly as script.js
 * saveProperty() shapes them, with activity entries built by the REAL
 * AuditService.shapeEvent from audit-service.js. The application path and the
 * database path meet here.
 *
 *   A  the watermark: nothing that predates P0.5 ever becomes history
 *   B  a new activity entry becomes exactly one durable event
 *   C  a new timeline entry becomes exactly one durable event
 *   D  replay and retry: saving again changes nothing
 *   E  identity: actor from auth.uid(), organisation from the property
 *   F  spoofing: a caller cannot choose either
 *   G  atomicity: a failure in derivation rolls the property write back too
 *   H  totality: malformed and legacy entries never fail a save
 *   I  the derived events are still append-only
 *
 * REQUIRES a local PostgreSQL. Exits NON-ZERO if absent: an unrun durability
 * test must never read as a pass.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = __dirname;
const MIG = (n) => path.join(ROOT, 'migrations', n);
const M028  = MIG('028_property_events.sql');
const M028B = MIG('028b_property_events_append_only_fix.sql');
const M030  = MIG('030_property_events_derive.sql');
const MARKER = 'fd9c09b1-b657-4c58-9999-c3cce28e7600';

const OWNER = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';
const ORG1  = 'aaaaaaaa-0000-0000-0000-000000000001';
const ORG2  = 'aaaaaaaa-0000-0000-0000-000000000002';
const PROP  = 'dddddddd-0000-0000-0000-00000000000a';  // pre-existing, watermarked
const FRESH = 'dddddddd-0000-0000-0000-00000000000b';  // created after 030

// The real client-side shaper. Activity entries in this suite are produced by
// the same code the browser runs, so the id the watermark depends on is the
// genuine article rather than a copy of its format.
global.window = global.window || {};
try { global.crypto = global.crypto || require('crypto').webcrypto; } catch (_) {}
require('./audit-service.js');
const AuditService = global.window.AuditService;

let pass = 0, fail = 0;
const failures = [];
function t(name, cond, detail) {
  if (cond) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  else {
    fail++; failures.push(name + (detail ? ` — ${detail}` : ''));
    console.log(`  \x1b[31m✗ ${name}\x1b[0m${detail ? ` — ${detail}` : ''}`);
  }
}
const sec = (s) => console.log(`\n── ${s} ──`);
function die(msg, code) { console.error(`\n\x1b[31m${msg}\x1b[0m`); process.exit(code === undefined ? 2 : code); }

// ── PostgreSQL ──────────────────────────────────────────────────────────────
function findBin() {
  const base = '/usr/lib/postgresql';
  if (fs.existsSync(base)) {
    for (const v of fs.readdirSync(base).sort().reverse()) {
      const d = path.join(base, v, 'bin');
      if (fs.existsSync(path.join(d, 'initdb'))) return d;
    }
  }
  for (const d of ['/usr/local/bin', '/usr/bin', '/opt/homebrew/bin']) {
    if (fs.existsSync(path.join(d, 'initdb'))) return d;
  }
  return null;
}
const BIN = findBin();
if (!BIN) die('NOT RUN — no local PostgreSQL found (need initdb, pg_ctl, psql).\n' +
              '  Debian/Ubuntu: apt-get install -y postgresql');

const AS_ROOT = (typeof process.getuid === 'function' && process.getuid() === 0);
let SERVER_USER = null;
if (AS_ROOT) {
  for (const u of ['postgres', 'nobody']) {
    const r = spawnSync('getent', ['passwd', u], { encoding: 'utf8' });
    if (r.status === 0 && r.stdout.trim()) { SERVER_USER = u; break; }
  }
  if (!SERVER_USER) die('NOT RUN — running as root and no unprivileged account exists to run the server as.');
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pe030-'));
const DATA = path.join(TMP, 'data');
const SOCK = path.join(TMP, 'sock');
fs.mkdirSync(SOCK);
if (AS_ROOT) execFileSync('chmod', ['-R', '777', TMP]);

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
console.log('║  P0.5 — durable history derived in the property transaction    ║');
console.log('╚════════════════════════════════════════════════════════════════╝\n');
console.log(`  · using ${BIN}${AS_ROOT ? ` (server runs as ${SERVER_USER})` : ''}`);

let r = server('initdb', ['-D', DATA, '-U', 'pgowner', '--auth=trust', '-E', 'UTF8']);
if (r.status !== 0) die('NOT RUN — initdb failed:\n' + (r.stderr || r.stdout || '').slice(-1200));
r = server('pg_ctl', ['-D', DATA, '-o', `-k ${SOCK} -c listen_addresses=`, '-w', '-l', path.join(TMP, 'log'), 'start']);
if (r.status !== 0) {
  let log = ''; try { log = fs.readFileSync(path.join(TMP, 'log'), 'utf8'); } catch (_) {}
  die('NOT RUN — could not start PostgreSQL:\n' + (r.stderr || r.stdout || '') + '\n' + log.slice(-1200));
}
started = true;

function psql(sql, opts) {
  const res = spawnSync(path.join(BIN, 'psql'),
    ['-h', SOCK, '-U', 'pgowner', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At', '-c', sql],
    { encoding: 'utf8' });
  if (res.status !== 0 && !(opts && opts.allowFail)) {
    die('setup SQL failed:\n' + sql.slice(0, 500) + '\n' + (res.stderr || '').slice(-1200), 1);
  }
  return { ok: res.status === 0, out: (res.stdout || '').trim(), err: (res.stderr || '').trim() };
}
function psqlFile(f) {
  const res = spawnSync(path.join(BIN, 'psql'),
    ['-h', SOCK, '-U', 'pgowner', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At', '-f', f],
    { encoding: 'utf8' });
  return { ok: res.status === 0, out: (res.stdout || '').trim(), err: (res.stderr || '').trim() };
}
const q = (sql) => psql(sql).out;
const lit = (s) => "'" + String(s).replace(/'/g, "''") + "'";

// ── A pilot-shaped stub ─────────────────────────────────────────────────────
psql(`
create role anon nologin; create role authenticated nologin; create role service_role nologin;
create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('test.uid', true), '')::uuid $$;
create table public.organizations (id uuid primary key, name text);
create table public.properties (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),
  name text,
  organization_id uuid references public.organizations(id) on delete restrict,
  data jsonb not null default '{}'::jsonb
);
create function public.member_property_ids() returns setof uuid language sql stable as $$
  select id from public.properties where user_id = auth.uid() $$;
insert into auth.users (id, email) values
  (${lit(OWNER)}, 'owner@pilot.invalid'), (${lit(OTHER)}, 'other@pilot.invalid');
insert into public.organizations (id, name) values (${lit(ORG1)}, 'Org One'), (${lit(ORG2)}, 'Org Two');
insert into public.properties (id, user_id, name, organization_id) values
  (${lit(MARKER)}, ${lit(OWNER)}, 'pilot marker', ${lit(ORG1)});
`);

// A property that already carries legacy history — exactly the shape a
// pre-P0.5 blob has: activity entries with NO id, timeline entries WITH ids.
const legacyBlob = {
  tenants: [], invoices: [], disputes: [],
  activityLog: [
    { type: 'invoice_uploaded', title: 'Old invoice', detail: '', severity: 'info',
      timestamp: '2026-01-01T00:00:00.000Z', actor: 'User', relatedEntity: '', financialImpact: '',
      propertyId: PROP, tenantId: null },
    { type: 'dispute_opened', title: 'Old dispute', detail: '', severity: 'warning',
      timestamp: '2026-01-02T00:00:00.000Z', actor: 'Reviewer', relatedEntity: '', financialImpact: '',
      propertyId: PROP, tenantId: null },
  ],
  timeline: [
    { id: 'tl-legacy-1', timestamp: '2026-01-01T00:00:00.000Z', type: 'cam_reconciled',
      severity: 'success', actor: 'Property Manager', title: 'Old reconciliation', description: '',
      metadata: { dedupeKey: 'cam_reconciled:2025' } },
    { id: 'tl-legacy-2', timestamp: '2026-01-02T00:00:00.000Z', type: 'document_uploaded',
      severity: 'info', actor: 'User', title: 'Old document', description: '', metadata: {} },
  ],
};
psql(`insert into public.properties (id, user_id, name, organization_id, data)
      values (${lit(PROP)}, ${lit(OWNER)}, 'Pre-existing', ${lit(ORG1)}, ${lit(JSON.stringify(legacyBlob))}::jsonb);`);

// ── Apply the migrations, unmodified ────────────────────────────────────────
sec('Applying 028, 028b and 030 unmodified');
for (const [label, file] of [['028', M028], ['028b', M028B], ['030', M030]]) {
  const res = psqlFile(file);
  t(`migrations/${label} applies`, res.ok, res.err.slice(-400));
}

// `data` is what saveProperty() sends: the blob, whole, every time.
function save(propId, blob, uid) {
  const setUid = uid === null ? `select set_config('test.uid', '', true);`
                              : `select set_config('test.uid', ${lit(uid)}, true);`;
  return psql(`begin; ${setUid}
    update public.properties set data = ${lit(JSON.stringify(blob))}::jsonb where id = ${lit(propId)};
    commit;`, { allowFail: true });
}
const events = (propId) => q(`select count(*) from public.property_events where property_id = ${lit(propId)};`);
const keys   = (propId) => q(`select coalesce(string_agg(source_key, ',' order by source_key), '') from public.property_events where property_id = ${lit(propId)};`);

// ── A: the watermark ────────────────────────────────────────────────────────
sec('A. nothing that predates P0.5 becomes history');
{
  t('A1 the migration derived no events at all', q('select count(*) from public.property_events;') === '0');
  t('A2 a watermark row exists for every pre-existing property',
    q('select count(*) from public.property_events_watermark;') === q('select count(*) from public.properties;'));
  t('A3 the pre-existing property\'s timeline keys were captured',
    q(`select array_length(legacy_timeline_keys,1) from public.property_events_watermark where property_id = ${lit(PROP)};`) === '2');
  t('A4 the captured keys prefer dedupeKey over id',
    q(`select array_to_string(legacy_timeline_keys, ',') from public.property_events_watermark where property_id = ${lit(PROP)};`)
      === 'cam_reconciled:2025,tl-legacy-2');

  // The decisive one: re-saving the untouched legacy blob must derive nothing.
  const res = save(PROP, legacyBlob, OWNER);
  t('A5 re-saving an unchanged pre-existing property succeeds', res.ok, res.err.slice(-300));
  t('A6 ... and derives ZERO events — no historical backfill', events(PROP) === '0', events(PROP));
}

// ── B: a new activity entry ─────────────────────────────────────────────────
sec('B. a new activity entry becomes exactly one durable event');
let blob = JSON.parse(JSON.stringify(legacyBlob));
let firstActivityId = null;
{
  // Built by the real AuditService, prepended exactly as logActivity does.
  const ev = AuditService.shapeEvent('field_override', 'Cap corrected to 5%', {
    detail: 'was 4%', severity: 'success', actor: 'User', propertyId: PROP, tenantId: null,
  });
  firstActivityId = ev.id;
  t('B1 AuditService assigned a stable id at creation', typeof ev.id === 'string' && ev.id.startsWith('ae-'), ev.id);
  blob.activityLog.unshift(ev);

  const res = save(PROP, blob, OWNER);
  t('B2 the save succeeds', res.ok, res.err.slice(-300));
  t('B3 exactly one event now exists', events(PROP) === '1', events(PROP));
  t('B4 ... and it is the new entry, keyed by its id',
    keys(PROP) === 'activity:' + ev.id, keys(PROP));
  const row = q(`select action || '|' || (detail->>'title') || '|' || (detail->>'client_actor') || '|' || (detail->>'source')
                 from public.property_events where property_id = ${lit(PROP)};`);
  t('B5 the action and title carry through, and the client actor is kept as a claim',
    row === 'field_override|Cap corrected to 5%|User|activityLog', row);
  t('B6 client_ts is the entry\'s own timestamp, not the write time',
    q(`select client_ts::date::text from public.property_events where property_id = ${lit(PROP)};`)
      === new Date(ev.timestamp).toISOString().slice(0, 10));
}

// ── C: a new timeline entry ─────────────────────────────────────────────────
sec('C. a new timeline entry becomes exactly one durable event');
{
  blob.timeline.push({
    id: 'tl-new-1', timestamp: '2026-09-18T10:00:00.000Z', type: 'lease_uploaded',
    severity: 'info', actor: 'Property Manager', title: 'Lease uploaded', description: 'Unit 4',
    source: 'document', metadata: { dedupeKey: 'lease_uploaded:doc-99' },
  });
  const res = save(PROP, blob, OWNER);
  t('C1 the save succeeds', res.ok, res.err.slice(-300));
  t('C2 exactly one more event exists', events(PROP) === '2', events(PROP));
  t('C3 ... keyed by its dedupeKey, not its id',
    keys(PROP).includes('timeline:lease_uploaded:doc-99'), keys(PROP));
  t('C4 the timeline event is labelled as coming from the timeline',
    q(`select detail->>'source' from public.property_events where source_key = 'timeline:lease_uploaded:doc-99';`) === 'timeline');
}

// ── D: replay and retry ─────────────────────────────────────────────────────
sec('D. replay and retry create no duplicates');
{
  let res = save(PROP, blob, OWNER);
  t('D1 saving the identical blob again succeeds', res.ok, res.err.slice(-300));
  t('D2 ... and adds nothing', events(PROP) === '2', events(PROP));

  for (let i = 0; i < 3; i++) save(PROP, blob, OWNER);
  t('D3 three further replays still add nothing', events(PROP) === '2', events(PROP));

  // The reload case: the same logical timeline event re-created with a fresh
  // random id but the same dedupeKey is the SAME event.
  const reblob = JSON.parse(JSON.stringify(blob));
  reblob.timeline[reblob.timeline.length - 1].id = 'tl-new-1-REGENERATED';
  res = save(PROP, reblob, OWNER);
  t('D4 a re-created timeline entry with a new id but the same dedupeKey is not duplicated',
    res.ok && events(PROP) === '2', events(PROP));

  // Several new entries in one save, each exactly once.
  const a = AuditService.shapeEvent('csv_export', 'Export A', { propertyId: PROP });
  const b = AuditService.shapeEvent('csv_export', 'Export B', { propertyId: PROP });
  blob.activityLog.unshift(a, b);
  blob.timeline.push({ id: 'tl-new-2', timestamp: '2026-09-18T11:00:00.000Z', type: 'export_generated',
                       severity: 'info', actor: 'User', title: 'Export', description: '', metadata: {} });
  res = save(PROP, blob, OWNER);
  t('D5 three new entries in one save produce exactly three new events',
    res.ok && events(PROP) === '5', events(PROP) + ' ' + res.err.slice(-200));
  t('D6 two activity entries with the same type and title are still distinct events',
    q(`select count(distinct source_key) from public.property_events
       where property_id = ${lit(PROP)} and action = 'csv_export';`) === '2');
  save(PROP, blob, OWNER);
  t('D7 replaying that save adds nothing', events(PROP) === '5', events(PROP));

  // Re-shaping an event that already has an identity — a retry, a restored
  // snapshot, a queue replay — must carry that identity through rather than
  // minting a second one for what is one event.
  const reshaped = AuditService.shapeEvent(a.type, a.title, { id: a.id, propertyId: PROP });
  t('D8 re-shaping an event with its existing id keeps that identity', reshaped.id === a.id, reshaped.id);
  const dupBlob = JSON.parse(JSON.stringify(blob));
  dupBlob.activityLog.unshift(reshaped);
  save(PROP, dupBlob, OWNER);
  t('D9 ... so replaying it through the blob creates no second event', events(PROP) === '5', events(PROP));
}

// ── E: identity ─────────────────────────────────────────────────────────────
sec('E. actor comes from auth.uid(), organisation from the property');
{
  t('E1 every derived event is attributed to the authenticated saver',
    q(`select count(*) from public.property_events where property_id = ${lit(PROP)} and actor_uid = ${lit(OWNER)};`) === '5');
  t('E2 every derived event carries the property\'s organisation',
    q(`select count(*) from public.property_events e join public.properties p on p.id = e.property_id
       where e.property_id = ${lit(PROP)} and e.organization_id = p.organization_id;`) === '5');
  t('E3 every derived event carries the right property',
    q(`select count(*) from public.property_events where property_id <> ${lit(PROP)};`) === '0');

  // A different authenticated user saving the same property is recorded as
  // themselves, not as the owner.
  const ev = AuditService.shapeEvent('review_acknowledged', 'Reviewed', { propertyId: PROP });
  blob.activityLog.unshift(ev);
  save(PROP, blob, OTHER);
  t('E4 a different saver is attributed to THEM, not to the owner',
    q(`select actor_uid::text from public.property_events where source_key = ${lit('activity:' + ev.id)};`) === OTHER);

  // A service-side save has no auth.uid(); the event is recorded with none
  // rather than borrowing someone's identity.
  const ev2 = AuditService.shapeEvent('migration_applied', 'Server task', { propertyId: PROP });
  blob.activityLog.unshift(ev2);
  save(PROP, blob, null);
  t('E5 a save with no authenticated user yields actor_uid NULL, never a borrowed one',
    q(`select coalesce(actor_uid::text,'NULL') from public.property_events where source_key = ${lit('activity:' + ev2.id)};`) === 'NULL');
}

// ── F: spoofing ─────────────────────────────────────────────────────────────
sec('F. a caller cannot choose the actor or the organisation');
{
  const ev = AuditService.shapeEvent('field_override', 'Spoof attempt', { propertyId: PROP, actor: 'Someone Else' });
  // The blob entry carries whatever the client wants, including fields that
  // look like identity. None of them reach the event's identity columns.
  const spoofed = Object.assign({}, ev, {
    actor_uid: OTHER, organization_id: ORG2, propertyId: MARKER, actor: 'Someone Else',
  });
  blob.activityLog.unshift(spoofed);
  const res = save(PROP, blob, OWNER);
  t('F1 the save succeeds — a spoof attempt is ignored, not an error', res.ok, res.err.slice(-300));
  const row = q(`select actor_uid::text || '|' || organization_id::text || '|' || property_id::text || '|' || (detail->>'client_actor')
                 from public.property_events where source_key = ${lit('activity:' + ev.id)};`);
  t('F2 actor is the authenticated saver, org is the property\'s, property is the row being saved',
    row === `${OWNER}|${ORG1}|${PROP}|Someone Else`, row);
  t('F3 the client\'s actor claim survives only as a labelled claim in detail',
    q(`select detail->>'client_actor' from public.property_events where source_key = ${lit('activity:' + ev.id)};`) === 'Someone Else');
}

// ── G: atomicity ────────────────────────────────────────────────────────────
sec('G. the property write and the durable event commit together, or neither');
{
  const before = q(`select data->'activityLog'->0->>'title' from public.properties where id = ${lit(PROP)};`);
  const evCount = events(PROP);

  // An explicit rollback must take the derived event with it.
  const ev = AuditService.shapeEvent('cam_delete', 'Rolled back', { propertyId: PROP });
  const rb = JSON.parse(JSON.stringify(blob)); rb.activityLog.unshift(ev);
  psql(`begin; select set_config('test.uid', ${lit(OWNER)}, true);
        update public.properties set data = ${lit(JSON.stringify(rb))}::jsonb where id = ${lit(PROP)};
        rollback;`);
  t('G1 after rollback the property blob is unchanged',
    q(`select data->'activityLog'->0->>'title' from public.properties where id = ${lit(PROP)};`) === before);
  t('G2 ... and the derived event is gone with it', events(PROP) === evCount, events(PROP));

  // A GENUINE database failure in derivation must fail the property save.
  // A check constraint standing in for any real write failure.
  psql(`alter table public.property_events add constraint _p05_probe check (action <> 'forbidden_action');`);
  const bad = JSON.parse(JSON.stringify(blob));
  bad.activityLog.unshift(AuditService.shapeEvent('forbidden_action', 'Should fail', { propertyId: PROP }));
  const res = save(PROP, bad, OWNER);
  t('G3 a real failure in derivation FAILS the property save', !res.ok, 'save unexpectedly succeeded');
  t('G4 ... and the property blob did not change',
    q(`select data->'activityLog'->0->>'title' from public.properties where id = ${lit(PROP)};`) === before);
  t('G5 ... so the UI can never report success while history was lost', events(PROP) === evCount, events(PROP));
  psql(`alter table public.property_events drop constraint _p05_probe;`);
}

// ── H: totality ─────────────────────────────────────────────────────────────
sec('H. malformed and legacy input never fails a save');
{
  const evCount = Number(events(PROP));
  const good = AuditService.shapeEvent('exception_report', 'Good one', { propertyId: PROP });
  const junk = {
    tenants: [], invoices: [], disputes: [],
    activityLog: [
      good,
      { id: 'ae-bad-ts', type: 'csv_export', title: 'Bad timestamp', timestamp: 'not-a-date' },
      { id: 'ae-empty-type', type: '', title: 'Empty type', timestamp: '2026-09-18T12:00:00Z' },
      { id: 'ae-long-type', type: 'x'.repeat(400), title: 'Very long type', timestamp: '2026-09-18T12:00:00Z' },
      { id: '   ', type: 'blank_id', title: 'Blank id' },
      { type: 'no_id_at_all', title: 'Legacy shape', timestamp: '2026-09-18T12:00:00Z' },
      'a bare string, not an object',
      null,
      42,
    ],
    timeline: [
      { id: 'tl-ok', type: 'dispute_created', timestamp: '2026-09-18T12:00:00Z', metadata: {} },
      { type: 'no_id_or_key', timestamp: 'garbage' },
      'not an object',
      null,
    ],
  };
  const res = save(PROP, junk, OWNER);
  t('H1 a blob full of malformed entries still saves', res.ok, res.err.slice(-400));

  t('H2 the valid activity entry was derived', keys(PROP).includes('activity:' + good.id));
  t('H3 a bad timestamp falls back rather than raising',
    q(`select count(*) from public.property_events where source_key = 'activity:ae-bad-ts';`) === '1');
  t('H4 an empty type becomes "unknown", satisfying the length check',
    q(`select action from public.property_events where source_key = 'activity:ae-empty-type';`) === 'unknown');
  t('H5 a 400-character type is clamped to 80',
    q(`select length(action) from public.property_events where source_key = 'activity:ae-long-type';`) === '80');
  t('H6 a blank id is not an identity — the entry is skipped',
    q(`select count(*) from public.property_events where source_key = 'activity:';`) === '0');
  t('H7 a legacy entry with no id is never derived',
    q(`select count(*) from public.property_events where action = 'no_id_at_all';`) === '0');
  t('H8 non-object array elements are skipped',
    q(`select count(*) from public.property_events where action = 'unknown' and detail->>'title' = '';`) === '0');
  t('H9 a timeline entry with neither key is skipped',
    q(`select count(*) from public.property_events where action = 'no_id_or_key';`) === '0');
  t('H10 a null data column does not fail a save',
    psql(`update public.properties set data = '{}'::jsonb where id = ${lit(MARKER)};`, { allowFail: true }).ok);

  // jsonb_array_elements RAISES on a scalar — "cannot extract elements from a
  // scalar" — so the array guard is load-bearing, not decoration. A blob whose
  // activityLog is a string rather than an array must not fail the save.
  t('H10b activityLog present but not an array does not fail a save',
    save(PROP, { activityLog: 'not an array', timeline: [] }, OWNER).ok);
  t('H10c timeline present but not an array does not fail a save',
    save(PROP, { activityLog: [], timeline: 'not an array' }, OWNER).ok);
  t('H10d an activityLog that is an object rather than an array does not fail a save',
    save(PROP, { activityLog: { nope: true }, timeline: { nope: true } }, OWNER).ok);
  // Restore the working blob for the sections that follow.
  save(PROP, blob, OWNER);

  // A property created after 030 has no watermark, so everything in it is new.
  const fresh = { activityLog: [AuditService.shapeEvent('property_created', 'New building', {})],
                  timeline: [{ id: 'tl-fresh', type: 'sync_restored', timestamp: '2026-09-18T13:00:00Z', metadata: {} }] };
  psql(`begin; select set_config('test.uid', ${lit(OWNER)}, true);
        insert into public.properties (id, user_id, name, organization_id, data)
        values (${lit(FRESH)}, ${lit(OWNER)}, 'Fresh', ${lit(ORG1)}, ${lit(JSON.stringify(fresh))}::jsonb);
        commit;`);
  t('H11 a property created after 030 derives its history from the first write',
    events(FRESH) === '2', events(FRESH));
  t('H12 ... and it has no watermark row, because it has no pre-existing history',
    q(`select count(*) from public.property_events_watermark where property_id = ${lit(FRESH)};`) === '0');
}

// ── I: still append-only ────────────────────────────────────────────────────
sec('I. derived events obey 028b');
{
  const upd = psql(`update public.property_events set action = 'tampered' where property_id = ${lit(PROP)};`, { allowFail: true });
  t('I1 a derived event cannot be updated', !upd.ok && /never updated/.test(upd.err), upd.err.slice(-200));
  const del = psql(`delete from public.property_events where property_id = ${lit(PROP)};`, { allowFail: true });
  t('I2 a derived event cannot be deleted', !del.ok && /never deleted/.test(del.err), del.err.slice(-200));
  const tr = psql(`truncate public.property_events;`, { allowFail: true });
  t('I3 the table cannot be truncated', !tr.ok && /never truncated/.test(tr.err), tr.err.slice(-200));
  t('I4 deleting the property still takes its events (the one permitted cascade)', (() => {
    const d = psql(`delete from public.properties where id = ${lit(FRESH)};`, { allowFail: true });
    return d.ok && events(FRESH) === '0';
  })());
  t('I5 the watermark row goes with its property too',
    q(`select count(*) from public.property_events_watermark where property_id = ${lit(FRESH)};`) === '0');
}

// ── J: the actual application writer ────────────────────────────────────────
sec('J. the real logActivity produces an entry this trigger derives');
{
  // Not a copy of logActivity — the function is lifted out of script.js by
  // name and run against stubs, so the path from the call site the product
  // actually uses, through AuditService, into the blob, into the database, is
  // exercised end to end.
  const { fnSource } = require('./test-support/fn-source.js');
  const vm = require('vm');
  const src = fnSource(fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8'), 'logActivity');
  t('J1 logActivity was lifted from script.js', !!src && /AuditService\.shapeEvent/.test(src), 'not found');

  const log = [];
  let saved = 0;
  const ctx = {
    activityLog: log,
    AuditService: AuditService,
    activePropId: PROP,
    savePropertyData: () => { saved++; },
    console,
  };
  vm.createContext(ctx);
  vm.runInContext(src + '\nlogActivity("dispute_opened", "Dispute raised", { detail: "unit 3", severity: "warning", actor: "User" });', ctx);

  t('J2 it appended exactly one entry', log.length === 1, String(log.length));
  t('J3 the entry carries a stable id, so it is eligible to become history',
    !!log[0] && typeof log[0].id === 'string' && log[0].id.startsWith('ae-'), JSON.stringify(log[0] && log[0].id));
  t('J4 it tagged the active property', log[0] && log[0].propertyId === PROP);
  t('J5 it still requests a save — existing behaviour unchanged', saved === 1, String(saved));

  // Now put that exact entry through a real save and watch it become history.
  const before = Number(events(PROP));
  const realBlob = JSON.parse(JSON.stringify(blob));
  realBlob.activityLog.unshift(log[0]);
  const res = save(PROP, realBlob, OWNER);
  t('J6 saving the blob logActivity produced derives exactly one new event',
    res.ok && Number(events(PROP)) === before + 1, events(PROP) + ' ' + res.err.slice(-200));
  t('J7 ... attributed to the authenticated saver, not to the "User" string it carried',
    q(`select actor_uid::text || '|' || (detail->>'client_actor')
       from public.property_events where source_key = ${lit('activity:' + log[0].id)};`) === `${OWNER}|User`);
  save(PROP, realBlob, OWNER);
  t('J8 ... and saving again adds nothing', Number(events(PROP)) === before + 1, events(PROP));
}

console.log('\n' + '─'.repeat(64));
if (fail) {
  console.log(`\x1b[31mRESULT: ${pass} passed, ${fail} failed\x1b[0m`);
  failures.forEach(f => console.log(`  · ${f}`));
  process.exit(1);
}
console.log(`\x1b[32mRESULT: ${pass} passed, 0 failed\x1b[0m`);
