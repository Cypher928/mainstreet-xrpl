'use strict';
/**
 * tools/verify-ledger-concurrency.js — imports and reversals of the same
 * property that genuinely overlap in time (migration 046).
 *
 *   node tools/verify-ledger-concurrency.js
 *
 * Every other ledger test runs one statement after another. Here two database
 * sessions run at once on a throwaway cluster: the first holds its transaction
 * open after doing its work (pg_sleep before COMMIT) while the second starts,
 * so the second sees the first's work only once it commits — the window in
 * which READ COMMITTED lets a reversal and an import, or two reversals, each
 * decide from a picture the other is about to change.
 *
 * After every race the property's ledger must still be whole:
 *   I1  every line is held by at least one ACTIVE import (no orphan lines)
 *   I2  every active import holds exactly as many lines as it contained
 *   I3  a line's own source is an active import that holds it
 *   I4  a reversed import holds nothing
 * and (§7) one person's simultaneous imports cannot pass the per-person ceiling.
 * and, with 046's per-property lock, the second session waits for the first
 * and then succeeds against what the first committed — nothing is refused.
 *
 * It touches NO Supabase project.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { startCluster, tally } = require('./_pg-throwaway');
const GL = require('../gl-import.js');
const { buildLedger, toCsv } = require('./gl-fixture.js');

const MIG = path.join(__dirname, '..', 'migrations');
const T = tally();
const { check, section } = T;
console.log('\n══ ledger concurrency — overlapping imports and reversals (046) ══');
console.log('   NO Supabase project is contacted by this script.');
const pg = startCluster('ledgerrace');
console.log('   server: ' + pg.serverVersion());

// The 046 verifier's database, built from the same files (as the endpoint verifier does).
const V046 = fs.readFileSync(path.join(__dirname, 'verify-migration-046.js'), 'utf8');
const grab = (name) => { const a = V046.indexOf(`const ${name} = `); const b = V046.indexOf('`;\n', a); return V046.slice(a, b + 2); };
const A = '11111111-1111-4111-8111-111111111111', M = '33333333-3333-4333-8333-333333333333', D = '55555555-5555-4555-8555-555555555555';
const R = '44444444-4444-4444-8444-444444444444', S = '22222222-2222-4222-8222-222222222222', Z = '66666666-6666-4666-8666-666666666666';
const V = '77777777-7777-4777-8777-777777777777';
const O1 = 'c1c1c1c1-0000-4000-8000-000000000001', O2 = 'c2c2c2c2-0000-4000-8000-000000000002', O3 = 'c3c3c3c3-0000-4000-8000-000000000003';
const MARKER = 'fd9c09b1-b657-4c58-9999-c3cce28e7600';
const V036 = fs.readFileSync(path.join(__dirname, 'verify-migration-036.js'), 'utf8');
const SCHEMA = (() => { const a = V036.indexOf('const SCHEMA = `') + 16, b = V036.indexOf('`;\n\nconst q =', a);
  // eslint-disable-next-line no-new-func
  return new Function('A', 'M', 'D', 'R', 'S', 'Z', 'O1', 'O2', 'O3', 'return `' + V036.slice(a, b) + '`;')(A, M, D, R, S, Z, O1, O2, O3); })();
// eslint-disable-next-line no-new-func
const STORAGE = new Function('A', 'V', 'O1', 'MARKER', 'Z', grab('STORAGE') + ' return STORAGE;')(A, V, O1, MARKER, Z);
// eslint-disable-next-line no-new-func
const EXTRA = new Function('A', 'V', 'O1', 'MARKER', 'Z', grab('EXTRA') + ' return EXTRA;')(A, V, O1, MARKER, Z);

const DB = 'race';
const q = (sql) => pg.psql(sql, DB);
const one = (sql) => q(sql).out;
const as = (uid, sql) => pg.as('authenticated', uid, sql, DB);
const s = (v) => v == null ? 'null' : "'" + String(v).replace(/'/g, "''") + "'";
const lit = (v) => JSON.stringify(v).replace(/'/g, "''");
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const short = (t) => String(typeof t === 'string' ? t : JSON.stringify(t)).replace(/\s+/g, ' ').slice(0, 200);
const wait = (ms) => new Promise(ok => setTimeout(ok, ms));

let r = pg.database(DB, 'legacy');
for (const part of [SCHEMA, STORAGE, EXTRA]) if (r.ok) r = q(part);
for (const n of ['032_resync_property_tenants_property_bound', '033_property_lifecycle_integrity', '034_property_at_new_acquisition', '035_acquire_property',
                 '036_acquisition_episode_frozen', '044_acquisition_conversion_safeguards']) if (r.ok) r = pg.psqlFile(path.join(MIG, n + '.sql'), DB);
for (const f of [path.join(MIG, 'phase0', '029_financial_tables.sql'), path.join(MIG, '045_acquisition_member_write_rules.sql'), path.join(MIG, '046_acquisition_general_ledger.sql')]) if (r.ok) r = pg.psqlFile(f, DB);
check('a Pilot-shaped database with 032–036, 044, 029, 045 and 046 applied', r.ok, short(r.out));
if (!r.ok) T.finish();

const deal = (name) => { const d = JSON.parse(as(A, `select public.begin_acquisition(${s(name)}, '{"totalSqFt":"1000"}'::jsonb);`).out); return { P: d.property_id, R: d.review_id }; };
let n = 0;
const fileOriginal = (dl, name, buf) => {
  const objName = `${A}/acq_${dl.R}_${Date.now()}${++n}-${name}`;
  q(`insert into storage.objects(bucket_id,name,owner,metadata) values ('leases',${s(objName)},'${A}','${lit({ size: buf.length })}'::jsonb);`);
  const id = as(A, `insert into public.acquisition_documents(review_id,user_id,file_name,intake_id,intake_kind,doc_type,doc_type_status,doc_type_source,storage_path)
    values ('${dl.R}','${A}',${s(name)},${s('ik-' + n)},'other','financial_statement','proposed','intake_kind',${s('leases/' + objName)}) returning id;`).out.trim();
  return { id, path: 'leases/' + objName, buf, P: dl.P };
};
/** The import as api/_ledger-import.js calls it, as SQL; `hold` keeps the transaction open that many seconds after the work. */
const importSql = (doc, hold) => {
  const parsed = GL.parseRows(GL.readCsvFile(doc.buf).rows, { maxRows: GL.IMPORT_MAX_ROWS });
  const payload = GL.importPayload(parsed);
  const file = { sha256: sha(doc.buf), bytes: doc.buf.length, storagePath: doc.path };
  const preview = { lines: payload.summary.lines, debitCents: payload.summary.debitCents, creditCents: payload.summary.creditCents, dateOrder: payload.summary.dateOrder, fileSha256: file.sha256 };
  return ['\\set VERBOSITY verbose', '\\pset tuples_only on', '\\pset format unaligned', 'begin;', 'set local role service_role;',
    `select public.import_general_ledger('${A}'::uuid, '${doc.id}'::uuid, '${lit(file)}'::jsonb, '${lit(payload)}'::jsonb, '${lit(preview)}'::jsonb, null);`,
    hold ? `select pg_sleep(${hold});` : '', 'commit;'].join('\n');
};
const reverseSql = (sourceId, hold) => ['\\set VERBOSITY verbose', '\\pset tuples_only on', '\\pset format unaligned', 'begin;', 'set local role service_role;',
  `select public.reverse_general_ledger_import('${A}'::uuid, '${sourceId}'::uuid, 'race test');`, hold ? `select pg_sleep(${hold});` : '', 'commit;'].join('\n');
const json = (out) => { const l = String(out).split('\n').filter(x => x.startsWith('{')).pop(); try { return JSON.parse(l); } catch (_) { return null; } };
const run = (sql) => { const x = pg.psqlText(sql, DB, 'seq'); return { ok: x.ok, out: x.out, j: json(x.out) }; };
/** Start `first` (which holds its transaction open), then `second` after `lag` ms; both results. */
async function race(first, second, lag) {
  const p1 = pg.psqlTextAsync(first, DB, 'first');
  await wait(lag || 800);
  const p2 = pg.psqlTextAsync(second, DB, 'second');
  const [a, b] = await Promise.all([p1, p2]);
  return [{ ok: a.ok, out: a.out, j: json(a.out) }, { ok: b.ok, out: b.out, j: json(b.out) }];
}
/** I1–I4 for one property: '' when whole, else what is wrong. */
const whole = (pid) => one(`
  select concat_ws(' · ',
    (select 'I1 '||count(*)||' line(s) no active import holds' from public.gl_entries g where g.property_id='${pid}'
       and not exists (select 1 from public.gl_entry_sources l join public.financial_sources f on f.id=l.source_id where l.gl_entry_id=g.id and f.import_status='active') having count(*)>0),
    (select 'I2 '||string_agg(f.id::text||' holds '||(select count(*) from public.gl_entry_sources l where l.source_id=f.id)||' of '||(f.extracted->>'lines'), ', ')
       from public.financial_sources f where f.property_id='${pid}' and f.import_status='active'
        and (select count(*) from public.gl_entry_sources l where l.source_id=f.id) <> (f.extracted->>'lines')::int having count(*)>0),
    (select 'I3 '||count(*)||' line(s) name a source that is not an active holder' from public.gl_entries g where g.property_id='${pid}'
       and not exists (select 1 from public.gl_entry_sources l join public.financial_sources f on f.id=l.source_id
                        where l.gl_entry_id=g.id and l.source_id=g.source_id and f.import_status='active') having count(*)>0),
    (select 'I4 '||count(*)||' link(s) held by reversed imports' from public.gl_entry_sources l join public.financial_sources f on f.id=l.source_id
       where l.property_id='${pid}' and f.import_status<>'active' having count(*)>0));`);
const counts = (pid) => one(`select (select count(*) from public.financial_sources where property_id='${pid}' and import_status='active')||' active, '||(select count(*) from public.gl_entries where property_id='${pid}')||' lines';`);

const L = buildLedger(20261004, 400, { textDates: true });
const csvOf = (rows) => Buffer.from(toCsv(rows), 'utf8');
const FULL = csvOf(L.rows);
const Q1 = csvOf([L.rows[0], ...L.rows.slice(1).filter(row => GL.parseDate(row[0], 'mdy').iso < '2025-04-01')]);
const H2 = csvOf([L.rows[0], ...L.rows.slice(1).filter(row => GL.parseDate(row[0], 'mdy').iso >= '2025-02-01')]);   // overlaps Q1 in February and March

(async () => {
  section('1 · an overlapping import is in flight while the import it overlaps is reversed');
  {
    const d = deal('ZZ Race 1');
    const a = run(importSql(fileOriginal(d, 'q1.csv', Q1)));
    check('setup: the Q1 import', a.ok && a.j && a.j.inserted > 0, short(a.out));
    const [imp, rev] = await race(importSql(fileOriginal(d, 'h2.csv', H2), 2.5), reverseSql(a.j.source_id));
    check('the import finishes; the reversal waits for it, then keeps the lines the import shares', imp.ok && rev.ok && rev.j && rev.j.lines_kept > 0 && rev.j.lines_handed_over === rev.j.lines_kept, short(imp.out) + ' || ' + short(rev.out));
    const w = whole(d.P);
    check('the ledger is whole afterwards: no active import lost a line, no line is orphaned (' + counts(d.P) + ')', w === '', w);
  }

  section('2 · the reversal is in flight while an overlapping import starts');
  {
    const d = deal('ZZ Race 2');
    const a = run(importSql(fileOriginal(d, 'q1.csv', Q1)));
    const [rev, imp] = await race(reverseSql(a.j.source_id, 2.5), importSql(fileOriginal(d, 'h2.csv', H2)));
    check('the reversal finishes; the import waits for it, then imports every line (nothing refused)', rev.ok && imp.ok && imp.j && imp.j.inserted === imp.j.lines, short(rev.out) + ' || ' + short(imp.out));
    const w = whole(d.P);
    check('the ledger is whole afterwards (' + counts(d.P) + ')', w === '', w);
  }

  section('3 · two imports that share lines are reversed at the same time');
  {
    const d = deal('ZZ Race 3');
    const a = run(importSql(fileOriginal(d, 'q1.csv', Q1)));
    const b = run(importSql(fileOriginal(d, 'h2.csv', H2)));
    check('setup: two imports sharing February and March', a.ok && b.ok && b.j.already_present > 0, short(a.out) + ' || ' + short(b.out));
    const [r1, r2] = await race(reverseSql(a.j.source_id, 2.5), reverseSql(b.j.source_id));
    check('both reversals finished', r1.ok && r2.ok, short(r1.out) + ' || ' + short(r2.out));
    const w = whole(d.P);
    check('no line is left behind that no active import holds (' + counts(d.P) + ')', w === '' && one(`select count(*) from public.gl_entries where property_id='${d.P}';`) === '0', w);
  }

  section('4 · the same document imported twice at once');
  {
    const d = deal('ZZ Race 4');
    const doc = fileOriginal(d, 'full.csv', FULL);
    const [x, y] = await race(importSql(doc, 2.5), importSql(doc));
    check('one import writes the ledger; the other waits, then is answered already_imported',
      x.ok && x.j && x.j.inserted > 0 && y.ok && y.j && y.j.already_imported === true && y.j.source_id === x.j.source_id, short(x.out) + ' || ' + short(y.out));
    check('one active import, every line once', one(`select count(*) from public.financial_sources where property_id='${d.P}';`) === '1' && whole(d.P) === '', counts(d.P));
  }

  section('5 · two overlapping files imported at once');
  {
    const d = deal('ZZ Race 5');
    const [x, y] = await race(importSql(fileOriginal(d, 'q1.csv', Q1), 2.5), importSql(fileOriginal(d, 'h2.csv', H2)));
    check('the first imports; the second waits, then imports, finding the shared lines present', x.ok && y.ok && y.j && y.j.already_present > 0 && y.j.inserted + y.j.already_present === y.j.lines, short(x.out) + ' || ' + short(y.out));
    const w = whole(d.P);
    check('the ledger is whole afterwards (' + counts(d.P) + ')', w === '', w);
  }

  section('6 · a holder that outlasts the 5 s wait: the second request is told "busy", nothing is half-done');
  {
    const d = deal('ZZ Race 6');
    const a = run(importSql(fileOriginal(d, 'q1.csv', Q1)));
    const [hold, x] = await race(reverseSql(a.j.source_id, 7), importSql(fileOriginal(d, 'h2.csv', H2)), 500);
    check('the long reversal finishes', hold.ok, short(hold.out));
    check('the import waiting behind it gives up after 5 s with 55P03 and a sentence a person can act on',
      !x.ok && /55P03/.test(x.out) && /still running; nothing was imported\. Try again/.test(x.out), short(x.out));
    const w = whole(d.P);
    check('…and wrote nothing: the ledger is whole (' + counts(d.P) + ')', w === '' && one(`select count(*) from public.financial_sources where property_id='${d.P}' and import_status='active';`) === '0', w);
    const later = run(importSql(fileOriginal(d, 'h2-again.csv', H2)));
    check('trying again once the holder is gone imports in full', later.ok && later.j && later.j.inserted === later.j.lines, short(later.out));
    const sql = importSql(fileOriginal(deal('ZZ Race 6b'), 'full.csv', FULL)).replace('set local role service_role;', "set local role service_role;\nset local lock_timeout = '123s';").replace('commit;', 'show lock_timeout;\nrollback;');
    const after = run(sql);
    check('the 5 s applies to that wait only: lock_timeout is the caller\'s own again afterwards', after.ok && /\n123s\s*$/.test(after.out), short(after.out.slice(-80)));
  }

  section('7 · the per-person ceiling holds when one person\'s imports run at once');
  {
    // Bring A to 27 imports in the last minute, then start six at once, each on
    // its own property (so only the per-person turn-taking orders them) and each
    // holding its transaction open 0.5 s after the import. Exactly three may
    // pass: the fourth onwards must see the three before it on the record.
    const have = Number(one(`select count(*) from public.ledger_import_history where actor_uid='${A}' and action='import' and occurred_at > now() - interval '1 minute';`));
    check(`(A has made ${have} imports in the last minute; the record is topped up to 27 with historical rows)`, have <= 27, String(have));
    if (have < 27) q(`insert into public.ledger_import_history(action, actor_uid, property_id, occurred_at) select 'import', '${A}', '${deal('ZZ Rate Filler').P}', now() from generate_series(1, ${27 - have});`);
    const docs = [1, 2, 3, 4, 5, 6].map(i => fileOriginal(deal('ZZ Rate ' + i), 'r.csv', csvOf([L.rows[0], ...L.rows.slice(1, 1 + 20 * i)])));
    const results = await Promise.all(docs.map(d => pg.psqlTextAsync(importSql(d, 0.5), DB, 'rate')));
    const ok = results.filter(r => r.ok).length, limited = results.filter(r => !r.ok && /53400/.test(r.out)).length, other = results.length - ok - limited;
    check('exactly three of six simultaneous imports go through; the other three are refused with 53400 — never more than the ceiling, never fewer', ok === 3 && limited === 3 && other === 0, `${ok} ok, ${limited} limited, ${other} other: ` + results.filter(r => !r.ok && !/53400/.test(r.out)).map(r => short(r.out)).join(' | '));
    check('the record shows exactly 30 imports by A in the last minute', one(`select count(*) from public.ledger_import_history where actor_uid='${A}' and action='import' and occurred_at > now() - interval '1 minute';`) === '30');
    check('every ledger that was imported is whole; every refused one is empty', docs.every((d, i) => results[i].ok ? whole(d.P) === '' : one(`select count(*) from public.financial_sources where property_id='${d.P}';`) === '0'));
  }

  T.finish();
})().catch((e) => { console.error(e); process.exit(1); });
