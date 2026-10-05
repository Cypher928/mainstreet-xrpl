'use strict';
/**
 * tools/verify-ledger-import-endpoint.js — the REAL api/_ledger-import.js and
 * api/_ledger-reverse.js, reached THROUGH the real api/upload.js (?op=ledger-
 * import / ?op=ledger-reverse — they are not functions of their own: Vercel's
 * Hobby plan deploys twelve), run against a local stand-in for the parts of Supabase
 * they call, backed by a throwaway PostgreSQL cluster with 045 and 046 applied.
 *
 *   node tools/verify-ledger-import-endpoint.js
 *
 * It touches NO Supabase project. The stand-in is an HTTP server on 127.0.0.1
 * that answers exactly what the handlers ask:
 *   GET  /auth/v1/user                   token → person (as GoTrue does)
 *   GET  /rest/v1/<table>?id=eq.…&select= read AS THE TOKEN'S PERSON (role
 *                                        authenticated, row rules on), or as
 *                                        service_role for the service key
 *   GET  /storage/v1/object/<bucket>/<name>  the stored bytes, service key only;
 *                                        the object must exist in storage.objects
 *   POST /rest/v1/rpc/<fn>               the function, as service_role for the
 *                                        service key or authenticated for a
 *                                        person's token, with Pilot's 8 s
 *                                        statement_timeout; errors come back as
 *                                        PostgREST shapes them ({ code, message })
 * What it does not emulate: GoTrue's JWT signing, PostgREST's own query
 * engine, Supabase Storage's S3 layer, Vercel's runtime limits. Those are for the
 * platform calibration, not this.
 *
 * WHAT IT PROVES — through the endpoint, end to end on this stand-in:
 *   the stored original is downloaded, hashed and parsed by the server; the
 *   preview must match it; rows or totals a browser sends are never imported;
 *   an ambiguous file needs a date-order choice; a replaced or missing original
 *   is refused; who may import and reverse is the database's rule, told back as
 *   403/404; a person cannot call the database function directly; the CAM pool
 *   is untouched; the upload endpoint never overwrites an acquisition original.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { startCluster, tally } = require('./_pg-throwaway');
const GL = require('../gl-import.js');
const { buildLedger, toCsv } = require('./gl-fixture.js');
const importEndpoint = require('../api/_ledger-import.js');
const reverseEndpoint = require('../api/_ledger-reverse.js');

const ROOT = path.join(__dirname, '..');
const MIG = path.join(ROOT, 'migrations');
const T = tally();
const { check, section } = T;
console.log('\n══ ledger import endpoints — the real handlers against a local Supabase stand-in ══');
console.log('   NO Supabase project is contacted by this script.');
const pg = startCluster('ledgerapi');
console.log('   server: ' + pg.serverVersion());

// The 046 verifier's database, built from the same files (its build function is reused by reading it).
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

const DB = 'api';
const q = (sql) => pg.psql(sql, DB);
const one = (sql) => q(sql).out;
const as = (uid, sql) => pg.as('authenticated', uid, sql, DB);
const s = (v) => v == null ? 'null' : "'" + String(v).replace(/'/g, "''") + "'";
const lit = (v) => JSON.stringify(v).replace(/'/g, "''");
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const short = (t) => String(typeof t === 'string' ? t : JSON.stringify(t)).replace(/\s+/g, ' ').slice(0, 170);

let r = pg.database(DB, 'legacy');
for (const part of [SCHEMA, STORAGE, EXTRA]) if (r.ok) r = q(part);
for (const n of ['032_resync_property_tenants_property_bound', '033_property_lifecycle_integrity', '034_property_at_new_acquisition', '035_acquire_property',
                 '036_acquisition_episode_frozen', '044_acquisition_conversion_safeguards']) if (r.ok) r = pg.psqlFile(path.join(MIG, n + '.sql'), DB);
for (const f of [path.join(MIG, 'phase0', '029_financial_tables.sql'), path.join(MIG, '045_acquisition_member_write_rules.sql'), path.join(MIG, '046_acquisition_general_ledger.sql')]) if (r.ok) r = pg.psqlFile(f, DB);
check('a Pilot-shaped database with 032–036, 044, 029, 045 and 046 applied, and storage as Pilot has it', r.ok, short(r.out));
if (!r.ok) T.finish();

// ── the stand-in ─────────────────────────────────────────────────────────────
const SERVICE = 'svc-key-local', ANON = 'anon-key-local';
const TOKENS = { 'tok-A': A, 'tok-M': M, 'tok-D': D, 'tok-R': R, 'tok-S': S, 'tok-V': V };
const STORE = new Map();   // 'leases/<name>' → bytes
const UNDECLARED = new Set();   // keys served chunked, with no Content-Length
let RPC_FAIL_NEXT = null;       // when set, the next RPC answers with this body and status 500 (an internal failure, as PostgREST would relay it)
const TABLES = new Set(['acquisition_documents', 'financial_sources']);
const calls = [];
function sqlAs(role, uid, sql) {
  const pre = ['\\set VERBOSITY verbose', '\\pset tuples_only on', '\\pset format unaligned', 'begin;', `set local role ${role};`,
    uid ? `set local request.jwt.claim.sub = '${uid}';` : '', "set local statement_timeout = '8s';"].join('\n');
  return pg.psqlText(pre + '\n' + sql + '\ncommit;\n', DB, 'api');
}
const sqlValue = (v) => v == null ? 'null' : typeof v === 'object' ? `'${lit(v)}'::jsonb` : typeof v === 'number' ? String(v) : s(v);
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const u = new URL(req.url, 'http://x');
    const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const send = (code, obj, raw) => { res.writeHead(code, { 'content-type': raw ? 'application/octet-stream' : 'application/json', ...(raw ? { 'content-length': raw.length } : {}) }); res.end(raw || JSON.stringify(obj)); };
    calls.push(req.method + ' ' + u.pathname);
    if (u.pathname === '/auth/v1/user') return TOKENS[bearer] ? send(200, { id: TOKENS[bearer] }) : send(401, { message: 'invalid JWT' });
    const who = bearer === SERVICE ? { role: 'service_role', uid: null } : TOKENS[bearer] ? { role: 'authenticated', uid: TOKENS[bearer] } : null;
    if (!who) return send(401, { message: 'no API key or token' });
    let m;
    if (req.method === 'GET' && (m = u.pathname.match(/^\/rest\/v1\/([a-z_]+)$/))) {
      const id = (u.searchParams.get('id') || '').replace(/^eq\./, '');
      const cols = (u.searchParams.get('select') || '').split(',');
      if (!TABLES.has(m[1]) || !/^[0-9a-f-]{36}$/.test(id) || !cols.every(c => /^[a-z_]+$/.test(c))) return send(400, { message: 'unsupported query' });
      const out = sqlAs(who.role, who.uid, `select coalesce(json_agg(t), '[]') from (select ${cols.join(',')} from public.${m[1]} where id = '${id}') t;`);
      if (!out.ok) return send(400, { message: out.out });
      return send(200, JSON.parse(out.out.split('\n').filter(l => l.startsWith('[')).pop()));
    }
    if (req.method === 'GET' && (m = u.pathname.match(/^\/storage\/v1\/object\/([a-z]+)\/(.+)$/))) {
      if (who.role !== 'service_role') return send(400, { message: 'not authorised' });
      const key = m[1] + '/' + decodeURIComponent(m[2]);
      const exists = one(`select count(*) from storage.objects where bucket_id=${s(m[1])} and name=${s(decodeURIComponent(m[2]))};`) === '1';
      if (!exists || !STORE.has(key)) return send(404, { message: 'Object not found' });
      if (UNDECLARED.has(key)) {
        const buf = STORE.get(key);
        res.writeHead(200, { 'content-type': 'application/octet-stream' });   // chunked: no length is declared
        for (let i = 0; i < buf.length; i += 65536) res.write(buf.subarray(i, i + 65536));
        return res.end();
      }
      return send(200, null, STORE.get(key));
    }
    if (req.method === 'POST' && (m = u.pathname.match(/^\/rest\/v1\/rpc\/([a-z_]+)$/))) {
      if (RPC_FAIL_NEXT) { const f = RPC_FAIL_NEXT; RPC_FAIL_NEXT = null; return send(500, f); }
      const args = JSON.parse(body || '{}');
      const out = sqlAs(who.role, who.uid, `select public.${m[1]}(${Object.entries(args).map(([k, v]) => `${k} => ${sqlValue(v)}`).join(', ')});`);
      if (!out.ok) {
        const e = out.out.match(/ERROR:\s+([0-9A-Z]{5}):\s+([^\n]*)/);
        return send(e && e[1] === '42501' ? 403 : 400, { code: e ? e[1] : null, message: e ? e[2] : out.out.slice(0, 300) });
      }
      return send(200, JSON.parse(out.out.split('\n').filter(l => l.startsWith('{')).pop()));
    }
    return send(404, { message: 'not emulated: ' + req.method + ' ' + u.pathname });
  });
});

/**
 * The real api/upload.js handler. It is an ES module that also calls require
 * (Vercel bundles it); here its four export/import lines are rewritten to plain
 * declarations and it runs with a require that hands it the stand-in target and
 * the ledger handlers built for it. Everything else in it runs as written.
 */
function loadUpload(target, ops, opts) {
  const o = opts || {};
  let src = o.src || fs.readFileSync(path.join(ROOT, 'api', 'upload.js'), 'utf8');
  const edits = [
    ["import { request } from 'https';", "const { request } = require('https');"],
    ['export const config =', 'const config ='],
    ['export default async function handler', 'async function handler'],
  ];
  for (const [a, b] of edits) { if (!src.includes(a)) throw new Error('api/upload.js no longer has: ' + a); src = src.replace(a, b); }
  src = src.replace('export function isAcquisitionOriginalName', 'function isAcquisitionOriginalName');   // absent before 046
  const seen = [];
  const req = (m) => {
    seen.push(m);
    if (m === './_pilot-target') return target;
    if (m === './_ledger-import') return ops.imp;
    if (m === './_ledger-reverse') return ops.rev;
    if (m === './_rate-limit') return require('../api/_rate-limit');
    if (m === '../request-limits.js') return require('../request-limits.js');
    if (m === 'https') return o.https || require('https');
    throw new Error('api/upload.js requires something this test does not provide: ' + m);
  };
  // eslint-disable-next-line no-new-func
  const handler = new Function('require', src + '\nreturn handler;')(req);
  handler.required = seen;
  return handler;
}

/** A stand-in for node:https as api/upload.js uses it: records each storage write and answers with `reply`. */
function fakeHttps(log, reply) {
  const { EventEmitter } = require('events');
  return {
    request(opts, cb) {
      const req = new EventEmitter();
      req.end = (body) => {
        log.push({ host: opts.hostname, path: opts.path, method: opts.method, headers: opts.headers, sha: sha(Buffer.from(body)) });
        const r = reply();
        const res = new EventEmitter(); res.statusCode = r.status;
        cb(res); res.emit('data', Buffer.from(r.body)); res.emit('end');
      };
      return req;
    },
  };
}
/**
 * api/upload.js as it was before the ledger operations, from git — the
 * reference for "an upload behaves as before". Pinned to e47a504, the last
 * commit before they were added (30fb242): once that commit exists, HEAD
 * already serves them and can no longer be the "before".
 */
const UPLOAD_BASELINE = 'e47a504';
function headUploadSource() {
  const where = process.env.LEDGER_GIT_ROOT || ROOT;
  return require('child_process').execFileSync('git', ['show', UPLOAD_BASELINE + ':api/upload.js'], { cwd: where, encoding: 'utf8' });
}

async function main() {
  await new Promise(ok => server.listen(0, '127.0.0.1', ok));
  const target = { url: 'http://127.0.0.1:' + server.address().port, anonKey: ANON, serviceRoleKey: SERVICE };
  const allow = { checkRate: () => ({ ok: true }), sendRateLimited: () => {} };
  // Every request below goes through api/upload.js, as a browser's would.
  const UPLOAD = loadUpload(target, { imp: importEndpoint.createHandler({ target, rate: allow }), rev: reverseEndpoint.createHandler({ target, rate: allow }) });
  const via = (op) => (req, res) => UPLOAD({ ...req, query: { ...(req.query || {}), op } }, res);
  const imp = via('ledger-import');
  const rev = via('ledger-reverse');
  const call = async (handler, token, body, method) => {
    const res = { statusCode: 0, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(o) { this.body = o; return this; }, setHeader(k, v) { this.headers[k] = v; } };
    await handler({ method: method || 'POST', headers: token ? { authorization: 'Bearer ' + token } : {}, body }, res);
    return res;
  };
  const deal = (uid, name) => { const d = JSON.parse(as(uid, `select public.begin_acquisition(${s(name)}, '{"totalSqFt":"1000"}'::jsonb);`).out); return { P: d.property_id, R: d.review_id }; };
  let n = 0;
  /** The upload as /api/upload stores it: the bytes, the storage.objects row, and the document filed by its owner. */
  const upload = (owner, dl, name, buf, storagePathOverride) => {
    const objName = `${owner}/acq_${dl.R}_${Date.now()}${++n}-${name}`;
    STORE.set('leases/' + objName, buf);
    q(`insert into storage.objects(bucket_id,name,owner,metadata) values ('leases',${s(objName)},'${owner}','${lit({ size: buf.length })}'::jsonb);`);
    const storage_path = storagePathOverride || 'leases/' + objName;
    const id = as(owner, `insert into public.acquisition_documents(review_id,user_id,file_name,intake_id,intake_kind,doc_type,doc_type_status,doc_type_source,storage_path)
      values ('${dl.R}','${owner}',${s(name)},${s('ik-' + n)},'other','financial_statement','proposed','intake_kind',${s(storage_path)}) returning id;`).out.trim();
    return { id, objName, buf };
  };
  /** What the browser's preview computes from the file the person chose. */
  const previewOf = (buf, dateOrder) => {
    const p = GL.parseRows(GL.readCsvFile(buf).rows, { dateOrder });
    return { lines: p.totals.lines, debitCents: p.totals.debitCents, creditCents: p.totals.creditCents, dateOrder: p.dateOrder, fileSha256: sha(buf) };
  };
  const csv = (seed) => Buffer.from(toCsv(buildLedger(seed, 1000, { textDates: true }).rows), 'utf8');
  const ledgerCounts = (pid) => one(`select (select count(*) from public.financial_sources where property_id='${pid}')||'|'||(select count(*) from public.gl_entries where property_id='${pid}')||'|'||(select count(*) from public.ledger_import_history where property_id='${pid}');`);

  section('1 · the import endpoint, end to end on the stand-in');
  const D1 = deal(A, 'ZZ API Deal');
  const camBefore = one(`select md5(coalesce(data::text,'')) from public.properties where id='${D1.P}';`);
  const f1 = upload(A, D1, 'gl.csv', csv(20251003));
  calls.length = 0;
  let res = await call(imp, 'tok-A', { documentId: f1.id, preview: previewOf(f1.buf) });
  check('the owner imports through /api/upload?op=ledger-import: 200, 2,000 lines inserted', res.statusCode === 200 && res.body.inserted === 2000, short(res.body));
  check('the handler verified the person, read the document as them, downloaded the original and called the function — in that order',
    calls.join(' > ') === `GET /auth/v1/user > GET /rest/v1/acquisition_documents > GET /storage/v1/object/leases/${f1.objName} > POST /rest/v1/rpc/import_general_ledger`, calls.join(' > '));
  check('the recorded fingerprint and size are the stored object\'s, computed by the server',
    one(`select file_sha256||'|'||file_bytes||'|'||created_by from public.financial_sources where id='${res.body.source_id}';`) === `${sha(f1.buf)}|${f1.buf.length}|${A}`);
  check('the CAM invoice pool is untouched (properties.data byte-identical)', one(`select md5(coalesce(data::text,'')) from public.properties where id='${D1.P}';`) === camBefore);

  const D2 = deal(A, 'ZZ API Refusals');
  const f2 = upload(A, D2, 'gl.csv', csv(4242));
  const c2 = () => ledgerCounts(D2.P);
  const base = c2();
  const refused = async (label, token, body, code, re) => {
    const rr = await call(imp, token, body);
    check(label, rr.statusCode === code && (!re || re.test(JSON.stringify(rr.body))) && c2() === base, `${rr.statusCode} ${short(rr.body)} · ${c2()}`);
  };
  await refused('no token → 401', null, { documentId: f2.id, preview: previewOf(f2.buf) }, 401);
  await refused('an unknown token → 401', 'tok-nobody', { documentId: f2.id, preview: previewOf(f2.buf) }, 401);
  await refused('no preview → 400 (the person must have seen it)', 'tok-A', { documentId: f2.id }, 400);
  await refused('a stranger → 404: the document is not one they can see', 'tok-S', { documentId: f2.id, preview: previewOf(f2.buf) }, 404);
  await refused('a revoked member → 404', 'tok-V', { documentId: f2.id, preview: previewOf(f2.buf) }, 404);
  await refused('a read-only member sees it but → 403 from the database (may not edit)', 'tok-R', { documentId: f2.id, preview: previewOf(f2.buf) }, 403, /may edit it/);
  await refused('a preview of another file (stale or swapped) → 409 fingerprint_mismatch', 'tok-A', { documentId: f2.id, preview: previewOf(csv(1)) }, 409, /fingerprint_mismatch/);
  const p2 = previewOf(f2.buf);
  await refused('a preview with tampered totals (same fingerprint) → 409 preview_mismatch', 'tok-A', { documentId: f2.id, preview: Object.assign({}, p2, { debitCents: p2.debitCents - 100 }) }, 409, /preview_mismatch/);
  const forged = GL.importPayload(GL.parseRows(GL.readCsvFile(csv(7)).rows));
  res = await call(imp, 'tok-A', { documentId: f2.id, preview: p2, rows: forged.rows, payload: forged, summary: forged.summary });
  check('rows, payload or summary sent by a browser are ignored: the import is the stored file\'s, line for line',
    res.statusCode === 200 && res.body.inserted === 2000 && res.body.debit_cents === p2.debitCents
    && one(`select sum(debit*100)::bigint from public.gl_entries where source_id='${res.body.source_id}';`) === String(p2.debitCents), short(res.body));
  const D3 = deal(A, 'ZZ API Storage');
  const f3 = upload(A, D3, 'gl.csv', csv(99));
  const p3 = previewOf(f3.buf);
  STORE.set('leases/' + f3.objName, csv(98));   // replaced in storage after the preview (only the service key could)
  res = await call(imp, 'tok-A', { documentId: f3.id, preview: p3 });
  check('the stored original replaced after the preview → 409, nothing imported', res.statusCode === 409 && /fingerprint_mismatch/.test(JSON.stringify(res.body)) && ledgerCounts(D3.P) === '0|0|0', short(res.body));
  STORE.delete('leases/' + f3.objName);
  res = await call(imp, 'tok-A', { documentId: f3.id, preview: p3 });
  check('the stored original gone from storage → 404', res.statusCode === 404, short(res.body));
  const f3b = upload(A, D3, 'elsewhere.csv', csv(97), `leases/${A}/not-an-acquisition-upload.csv`);
  res = await call(imp, 'tok-A', { documentId: f3b.id, preview: previewOf(f3b.buf) });
  check('a document whose path is not an acquisition upload of its review → 422, nothing downloaded', res.statusCode === 422 && ledgerCounts(D3.P) === '0|0|0', short(res.body));
  const f3d = upload(A, D3, 'theirs.csv', csv(96));
  q(`update storage.objects set name='${S}/' || substr(name, 38) where name='${f3d.objName}';`);
  STORE.set(`leases/${S}/` + f3d.objName.slice(37), f3d.buf);
  q(`set session_replication_role = replica; update public.acquisition_documents set storage_path='leases/${S}/' || substr(storage_path, 45) where id='${f3d.id}';`);
  res = await call(imp, 'tok-A', { documentId: f3d.id, preview: previewOf(f3d.buf) });
  check('a document pointing at an original in SOMEONE ELSE\'s folder → 422, never downloaded', res.statusCode === 422 && ledgerCounts(D3.P) === '0|0|0', short(res.body));
  const big = Buffer.alloc(GL.MAX_FILE_BYTES + 10, 0x61);
  const f3c = upload(A, D3, 'huge.csv', big);
  res = await call(imp, 'tok-A', { documentId: f3c.id, preview: Object.assign(previewOf(csv(1)), { fileSha256: sha(big) }) });
  check('a stored original over the upload limit → 413', res.statusCode === 413, short(res.body));
  const f3u = upload(A, D3, 'huge-undeclared.csv', big);
  UNDECLARED.add('leases/' + f3u.objName);
  res = await call(imp, 'tok-A', { documentId: f3u.id, preview: Object.assign(previewOf(csv(1)), { fileSha256: sha(big) }) });
  check('…and when storage declares no length, the download is counted as it arrives and cut off → 413', res.statusCode === 413 && ledgerCounts(D3.P) === '0|0|0', short(res.body));
  const f3s = upload(A, D3, 'undeclared-ok.csv', csv(4343));
  UNDECLARED.add('leases/' + f3s.objName);
  res = await call(imp, 'tok-A', { documentId: f3s.id, preview: previewOf(f3s.buf) });
  check('…while an original within the limit, served the same way, imports whole', res.statusCode === 200 && res.body.inserted === 2000, short(res.body));
  const latin = upload(A, D3, 'latin1.csv', Buffer.from([0x44, 0x61, 0x74, 0x65, 0x2C, 0x41, 0x0A, 0xE9, 0x2C, 0x31]));
  res = await call(imp, 'tok-A', { documentId: latin.id, preview: { lines: 1, debitCents: 1, creditCents: 0, dateOrder: 'iso', fileSha256: sha(latin.buf) } });
  check('a stored original that is not UTF-8 CSV → 422 not_a_csv_ledger', res.statusCode === 422 && /not_a_csv_ledger/.test(JSON.stringify(res.body)), short(res.body));
  const empty = upload(A, D3, 'empty.csv', Buffer.alloc(0));
  const beforeEmpty = ledgerCounts(D3.P);
  res = await call(imp, 'tok-A', { documentId: empty.id, preview: { lines: 1, debitCents: 1, creditCents: 0, dateOrder: 'iso', fileSha256: sha(Buffer.alloc(0)) } });
  check('an empty stored original → 422, nothing imported', res.statusCode === 422 && /empty/.test(res.body.error) && ledgerCounts(D3.P) === beforeEmpty, short(res.body));

  section('2 · date order through the endpoint');
  const amb = Buffer.from('Date,Account Number,Debit,Credit\r\n3/4/2025,5100,10.00,\r\n3/4/2025,1010,,10.00\r\n', 'utf8');
  const fa = upload(A, D3, 'ambiguous.csv', amb);
  res = await call(imp, 'tok-A', { documentId: fa.id, preview: Object.assign(previewOf(amb, 'mdy')) });
  check('an ambiguous file with no choice → 422 date_order_required, never guessed', res.statusCode === 422 && /date_order_required/.test(JSON.stringify(res.body)), short(res.body));
  res = await call(imp, 'tok-A', { documentId: fa.id, dateOrder: 'dmy', preview: previewOf(amb, 'mdy') });
  check('a choice that differs from the preview\'s → 409', res.statusCode === 409, short(res.body));
  res = await call(imp, 'tok-A', { documentId: fa.id, dateOrder: 'mdy', preview: previewOf(amb, 'mdy') });
  check('with the person\'s choice (month-first) → 200, recorded as mdy, 4 March',
    res.statusCode === 200 && one(`select date_order||'|'||(select min(posted_on) from public.gl_entries where source_id=s.id) from public.financial_sources s where id='${res.body.source_id}';`) === 'mdy|2025-03-04', short(res.body));

  section('3 · the function is reachable only through the server');
  const direct = await fetch(target.url + '/rest/v1/rpc/import_general_ledger', { method: 'POST', headers: { Authorization: 'Bearer tok-A', 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_actor: A, p_document_id: f2.id, p_file: { sha256: sha(f2.buf), bytes: f2.buf.length, storagePath: 'x' }, p_payload: forged, p_preview: p2, p_override_reason: null }) });
  check('a person calling import_general_ledger with their own token is refused (permission denied, 42501)', direct.status === 403 && /42501/.test(await direct.text()));

  section('4 · the reversal endpoint');
  const D4 = deal(A, 'ZZ API Reverse');
  const f4 = upload(A, D4, 'gl.csv', csv(5150));
  const i4 = (await call(imp, 'tok-A', { documentId: f4.id, preview: previewOf(f4.buf) })).body;
  res = await call(rev, 'tok-A', { sourceId: i4.source_id, reason: '   ' });
  check('no reason → 400', res.statusCode === 400 && /reason/.test(res.body.error));
  res = await call(rev, 'tok-S', { sourceId: i4.source_id, reason: 'x' });
  check('a stranger → 404 (cannot see the import)', res.statusCode === 404, short(res.body));
  res = await call(rev, 'tok-M', { sourceId: i4.source_id, reason: 'wrong file' });
  check('an editor who is not an admin → 403 from the database', res.statusCode === 403 && /organisation admin/.test(res.body.error), short(res.body));
  res = await call(rev, 'tok-D', { sourceId: i4.source_id, reason: 'Seller sent a corrected file' });
  check('an organisation admin reverses it: 200, 2,000 lines archived', res.statusCode === 200 && res.body.lines_removed === 2000
    && one(`select import_status||'|'||reversed_by||'|'||reversal_reason from public.financial_sources where id='${i4.source_id}';`) === `reversed|${D}|Seller sent a corrected file`, short(res.body));
  res = await call(imp, 'tok-A', { documentId: f4.id, preview: previewOf(f4.buf) });
  check('the corrected re-import through the endpoint is accepted', res.statusCode === 200 && res.body.inserted === 2000, short(res.body));
  check('history holds the import, the reversal and the re-import, each with its person',
    one(`select string_agg(action||':'||actor_uid, ',' order by occurred_at, action) from public.ledger_import_history where property_id='${D4.P}';`) === `import:${A},reverse:${D},import:${A}`);

  section('5 · the upload endpoint never overwrites an acquisition original');
  const UP = fs.readFileSync(path.join(ROOT, 'api', 'upload.js'), 'utf8');
  const fnSrc = UP.slice(UP.indexOf('export function isAcquisitionOriginalName'), UP.indexOf('\n}\n', UP.indexOf('export function isAcquisitionOriginalName')) + 2).replace('export ', '');
  // eslint-disable-next-line no-new-func
  const isAcq = new Function(fnSrc + '; return isAcquisitionOriginalName;')();
  check('script.js\'s acquisition originals (acq/<review>/…) are recognised; ordinary uploads are not',
    isAcq('acq/' + D1.R + '/1700000000000-gl.csv') && isAcq('acq_x') && !isAcq('lease.pdf') && !isAcq('invoices/acq.pdf') && !isAcq(''));
  check('an acquisition original is sent with x-upsert false; everything else keeps x-upsert true',
    /'x-upsert':\s+isAcquisitionOriginal \? 'false' : 'true'/.test(UP) && (UP.match(/x-upsert/g) || []).length === 1);
  check('a storage "already exists" answer for an original is a 409, not a silent success',
    /if \(isAcquisitionOriginal && \(status === 409 \|\| \(status >= 400 && \/Duplicate\|already exists\/i\.test/.test(UP));
  check('script.js still names originals acq/<review>/<ts>-<file> (what the endpoint recognises)', /const fileName = `acq\/\$\{reviewId\}\/\$\{Date\.now\(\)\}-\$\{file\.name\}`;/.test(fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8')));

  section('6 · the storage-path rule and the refusal mapping, directly');
  const LC = require('../api/_ledger-common');
  const RV = '0b0b0b0b-0000-4000-8000-00000000000b';
  check('an original of this review in its owner\'s folder is accepted, named with the folder',
    JSON.stringify(LC.acquisitionOriginal(`leases/${A}/acq_${RV}_1-gl.csv`, A, RV)) === JSON.stringify({ bucket: 'leases', name: `${A}/acq_${RV}_1-gl.csv` }));
  check('…another owner\'s folder, another review, another bucket, a nested path or a traversal are not',
    [`leases/${S}/acq_${RV}_1-gl.csv`, `leases/${A}/acq_${D1.R}_1-gl.csv`, `invoices/${A}/acq_${RV}_1-gl.csv`, `leases/${A}/x/acq_${RV}_1-gl.csv`,
     `leases/${A}/acq_${RV}_1/../../x.csv`, `leases/${A}/../${S}/acq_${RV}_1-gl.csv`, ''].every(p => LC.acquisitionOriginal(p, A, RV) === null));
  check('database refusals keep their meaning: 42501 → 403, 40001 and 55P03 (busy) → 409, 57014 (timeout) → 504, 23514 → 409',
    LC.refusal(400, '{"code":"42501","message":"m"}').http === 403 && LC.refusal(400, '{"code":"40001"}').http === 409 && LC.refusal(400, '{"code":"55P03"}').http === 409
    && LC.refusal(400, '{"code":"57014"}').http === 504 && LC.refusal(400, '{"code":"23514"}').http === 409 && LC.refusal(400, '{"code":"23514","message":"why"}').body.error === 'why');

  section('7 · the real rate limiter is in front of both endpoints');
  const RL = require('../api/_rate-limit');
  RL._resetForTests();
  const LIMITED = loadUpload(target, { imp: importEndpoint.createHandler({ target }), rev: reverseEndpoint.createHandler({ target }) });
  let last;
  for (let i = 0; i < 11; i++) last = await call((rq, rs) => LIMITED({ ...rq, query: { op: 'ledger-import' } }, rs), 'tok-A', {});
  check('the 11th import request in a minute is refused (429)', last.statusCode === 429, String(last.statusCode));
  RL._resetForTests();
  for (let i = 0; i < 11; i++) last = await call((rq, rs) => LIMITED({ ...rq, query: { op: 'ledger-reverse' } }, rs), 'tok-A', {});
  check('the 11th reversal request in a minute is refused (429)', last.statusCode === 429, String(last.statusCode));
  RL._resetForTests();

  section('7b · the unbalanced override through the endpoint: admins only; unexpected errors are not repeated');
  {
    const D5 = deal(A, 'ZZ API Override Deal');
    const unbalRows = buildLedger(31337, 200, { textDates: true }).rows; unbalRows.splice(1, 1);
    const fu = upload(A, D5, 'unbalanced.csv', Buffer.from(toCsv(unbalRows), 'utf8'));
    res = await call(imp, 'tok-M', { documentId: fu.id, preview: previewOf(fu.buf), overrideReason: 'editor insists' });
    check('an editor\'s reason for an unbalanced ledger → 403 from the database, nothing imported', res.statusCode === 403 && /organisation admin imports an unbalanced ledger/.test(res.body.error) && ledgerCounts(D5.P) === '0|0|0', short(res.body));
    res = await call(imp, 'tok-M', { documentId: fu.id, preview: previewOf(fu.buf) });
    check('…and without a reason → 409 (a reason is required), nothing imported', res.statusCode === 409 && /does not balance/.test(res.body.error) && ledgerCounts(D5.P) === '0|0|0', short(res.body));
    res = await call(imp, 'tok-D', { documentId: fu.id, preview: previewOf(fu.buf), overrideReason: 'Seller export omits one accrual' });
    check('an organisation admin\'s reason → 200, the override recorded', res.statusCode === 200 && res.body.balanced === false
      && one(`select override_reason||'|'||actor_uid from public.ledger_import_history where source_id='${res.body.source_id}';`) === `Seller export omits one accrual|${D}`, short(res.body));
    // An unexpected failure: the stand-in answers the next RPC as PostgREST relays an internal error.
    const logged = [];
    const impLogged = importEndpoint.createHandler({ target, rate: allow, log: (m) => logged.push(String(m)) });
    const f6 = upload(A, D5, 'ok.csv', csv(777));
    RPC_FAIL_NEXT = { code: 'XX000', message: 'internal error: could not read block 42 of relation pg_catalog.secret_table', details: 'host db-internal-7', hint: 'call the DBA' };
    res = await call(impLogged, 'tok-A', { documentId: f6.id, preview: previewOf(f6.buf) });
    const ref = res.body && res.body.reference;
    check('an unexpected database error → 502 with one fixed sentence and a reference id; no internal detail reaches the person',
      res.statusCode === 502 && res.body.code === 'unexpected' && /^[0-9a-f]{12}$/.test(String(ref)) && res.body.error === `The request could not be completed. Reference ${ref}.`
      && !/pg_catalog|secret_table|db-internal|DBA|XX000/.test(JSON.stringify(res.body)), short(res.body));
    check('…and the full error was logged server-side under that reference', logged.length === 1 && logged[0].includes('ref=' + ref) && logged[0].includes('pg_catalog.secret_table') && logged[0].includes('XX000'), short(logged[0]));
    res = await call(impLogged, 'tok-A', { documentId: f6.id, preview: previewOf(f6.buf) });
    check('the same request afterwards imports normally (the failure was the database\'s, not the request\'s)', res.statusCode === 200 && res.body.inserted === 2000, short(res.body));
    check('refusal(): the allow-list, directly — 23505 (a raw unique violation) and PGRST codes are told generically; 53400 → 429 with the database\'s own sentence',
      LC.refusal(409, '{"code":"23505","message":"duplicate key value violates unique constraint \\"financial_sources_pkey\\""}', () => {}).http === 500
      && !/financial_sources_pkey/.test(LC.refusal(409, '{"code":"23505","message":"duplicate key value violates unique constraint \\"financial_sources_pkey\\""}', () => {}).body.error)
      && LC.refusal(400, '{"code":"PGRST202","message":"Could not find the function"}', () => {}).http === 500
      && LC.refusal(400, '{"code":"53400","message":"This person has imported 30 ledgers in the last minute"}').http === 429
      && LC.refusal(400, '{"code":"53400","message":"This person has imported 30 ledgers in the last minute"}').body.error === 'This person has imported 30 ledgers in the last minute'
      && LC.refusal(502, 'upstream gateway timeout', () => {}).http === 502 && LC.refusal(502, 'not json', () => {}).body.code === 'unexpected');
  }

  section('8 · served from api/upload.js — no function of its own, the upload unchanged');
  const deployable = fs.readdirSync(path.join(ROOT, 'api')).filter(f => f.endsWith('.js') && !f.startsWith('_'));
  check('api/ holds exactly twelve deployable functions (Vercel Hobby deploys twelve)', deployable.length === 12, deployable.length + ': ' + deployable.join(', '));
  check('…none of them a ledger endpoint; the handlers are private modules',
    !deployable.some(f => /ledger/.test(f)) && fs.existsSync(path.join(ROOT, 'api', '_ledger-import.js')) && fs.existsSync(path.join(ROOT, 'api', '_ledger-reverse.js')));
  const VJ = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  check('vercel.json names no ledger function; upload keeps its 30 s', !Object.keys(VJ.functions).some(f => /ledger/.test(f)) && VJ.functions['api/upload.js'].maxDuration === 30);
  check('api/upload.js loads both ledger handlers', UPLOAD.required.includes('./_ledger-import') && UPLOAD.required.includes('./_ledger-reverse'));
  calls.length = 0;
  res = await call((rq, rs) => UPLOAD({ ...rq, query: { op: 'ledger-delete' } }, rs), 'tok-A', { documentId: f1.id });
  check('an operation it does not serve → 400, and nothing is called', res.statusCode === 400 && calls.length === 0, short(res.body));
  res = await call((rq, rs) => UPLOAD({ ...rq, query: { op: ['ledger-import', 'ledger-reverse'] } }, rs), 'tok-A', {});
  check('…nor a repeated op parameter', res.statusCode === 400 && calls.length === 0, short(res.body));
  res = await call(imp, 'tok-A', {}, 'GET');
  check('?op=ledger-import answers as the import does (GET → 405, Allow: POST), not as the upload', res.statusCode === 405 && res.headers.Allow === 'POST' && calls.length === 0);
  res = await call(UPLOAD, null, { fileName: 'x.csv', fileBase64: 'eA==' });
  check('a request with no op is still an upload: it asks for sign-in exactly as before', res.statusCode === 401 && res.body.error === 'Authentication required');
  res = await call(UPLOAD, 'tok-A', { documentId: f1.id, preview: previewOf(f1.buf) });
  check('…and a ledger body sent without ?op is an upload request missing its file — nothing is imported',
    res.statusCode === 400 && /Missing fileName or fileBase64/.test(res.body.error) && !calls.some(c => /rpc/.test(c)), short(res.body));
  section('9 · a normal upload behaves exactly as api/upload.js did before the ledger operations (' + UPLOAD_BASELINE + ')');
  {
    let HEAD_SRC = null;
    try { HEAD_SRC = headUploadSource(); } catch (e) { HEAD_SRC = null; }
    check('the pre-ledger api/upload.js (' + UPLOAD_BASELINE + ') is read from git (the reference)', !!HEAD_SRC && !/LEDGER_OPS/.test(HEAD_SRC), HEAD_SRC ? 'it already serves ledger operations' : 'git show ' + UPLOAD_BASELINE + ':api/upload.js failed');
    let storageReply = () => ({ status: 200, body: '{"Key":"x"}' });
    const logNow = [], logHead = [];
    const ops = { imp: importEndpoint.createHandler({ target, rate: allow }), rev: reverseEndpoint.createHandler({ target, rate: allow }) };
    const NOW = loadUpload(target, ops, { https: fakeHttps(logNow, () => storageReply()) });
    const HEAD = HEAD_SRC ? loadUpload(target, ops, { src: HEAD_SRC, https: fakeHttps(logHead, () => storageReply()) }) : null;
    const b64 = (t) => Buffer.from(t).toString('base64');
    const CASES = [
      ['an invoice PDF', 'tok-A', { fileName: 'inv 1.pdf', fileType: 'application/pdf', fileBase64: b64('%PDF-1 invoice') }],
      ['a lease PDF into leases', 'tok-A', { fileName: 'lease.pdf', fileType: 'application/pdf', fileBase64: b64('%PDF-1 lease'), bucket: 'leases' }],
      ['a CSV with no type given', 'tok-M', { fileName: 'cam.csv', fileBase64: b64('a,b\n1,2') }],
      ['a name that merely contains acq', 'tok-A', { fileName: 'acquisition-memo.pdf', fileType: 'application/pdf', fileBase64: b64('%PDF') }],
      ['a name with acq later in it', 'tok-A', { fileName: 'docs/acq_1.pdf', fileType: 'application/pdf', fileBase64: b64('%PDF') }],
      ['no file', 'tok-A', { fileName: 'x.pdf' }],
      ['a bucket that is not allowed', 'tok-A', { fileName: 'x.pdf', fileBase64: b64('x'), bucket: 'public' }],
      ['an extension that is not allowed', 'tok-A', { fileName: 'x.exe', fileBase64: b64('x') }],
      ['a type that does not match its extension', 'tok-A', { fileName: 'x.pdf', fileType: 'image/png', fileBase64: b64('x') }],
      ['a file over the invoice limit', 'tok-A', { fileName: 'big.pdf', fileType: 'application/pdf', fileBase64: 'A'.repeat(12 * 1024 * 1024) }],
      ['no sign-in', null, { fileName: 'x.pdf', fileBase64: b64('x') }],
      ['a token storage does not know', 'tok-nobody', { fileName: 'x.pdf', fileBase64: b64('x') }],
    ];
    const both = async (label, token, body, method, query) => {
      RL._resetForTests(); logNow.length = 0;
      const a = await call((rq, rs) => NOW({ ...rq, query: query || {} }, rs), token, body, method);
      RL._resetForTests(); logHead.length = 0;
      const b = HEAD ? await call((rq, rs) => HEAD({ ...rq, query: query || {} }, rs), token, body, method) : { statusCode: -1 };
      const seen = (r, log) => JSON.stringify({ status: r.statusCode, body: r.body, writes: log });
      return { same: seen(a, logNow) === seen(b, logHead), now: seen(a, logNow), head: seen(b, logHead), a };
    };
    const diffs = [];
    for (const [label, token, body] of CASES) { const x = await both(label, token, body); if (!x.same) diffs.push(label + ': ' + short(x.now) + ' ≠ ' + short(x.head)); }
    check(`${CASES.length} ordinary uploads and refusals: same status, same reply, same storage write (path, headers, bytes) as before`, HEAD && diffs.length === 0, diffs.join(' | '));
    let x = await both('GET', 'tok-A', {}, 'GET');
    check('…a GET with no op is still 405 Method not allowed, as before', x.same && x.a.statusCode === 405, short(x.now));
    x = await both('other query', 'tok-A', CASES[0][2], 'POST', { download: '1', bucket: 'leases' });
    check('…other query parameters are ignored, as before (only op is read)', x.same && x.a.statusCode === 200, short(x.now));
    storageReply = () => ({ status: 400, body: '{"statusCode":"409","error":"Duplicate","message":"The resource already exists"}' });
    x = await both('dup', 'tok-A', CASES[0][2]);
    check('…a storage refusal for an ordinary file is passed through exactly as before', x.same && x.a.statusCode === 400, short(x.now));
    storageReply = () => ({ status: 200, body: '{"Key":"x"}' });

    // The two deliberate differences — acquisition originals only.
    const ACQ = ['acq/' + D1.R + '/1700000000000-gl.csv', 'acq\\' + D1.R + '\\1-gl.csv', 'acq ' + D1.R + ' 1-gl.csv', 'acq:' + D1.R + ':1-gl.csv', 'acq_' + D1.R + '_1-gl.csv'];
    const upserts = [];
    for (const name of ACQ) {
      RL._resetForTests(); logNow.length = 0;
      const r1 = await call((rq, rs) => NOW({ ...rq, query: {} }, rs), 'tok-A', { fileName: name, fileType: 'text/csv', fileBase64: b64('a,b'), bucket: 'leases' });
      upserts.push(r1.statusCode + ':' + (logNow[0] && logNow[0].headers['x-upsert']) + ':' + (logNow[0] && logNow[0].path.split('/').pop()));
    }
    check('every name that is STORED as an acquisition original is written without upsert (acq/…, acq\\…, "acq …", acq:…, acq_…)',
      upserts.every(u => /^200:false:acq_/.test(u)), upserts.join(' '));
    storageReply = () => ({ status: 400, body: '{"statusCode":"409","error":"Duplicate","message":"The resource already exists"}' });
    RL._resetForTests();
    const dup = await call((rq, rs) => NOW({ ...rq, query: {} }, rs), 'tok-A', { fileName: 'acq\\' + D1.R + '\\1-gl.csv', fileType: 'text/csv', fileBase64: b64('a,b'), bucket: 'leases' });
    check('…and a second upload onto an original is refused with 409 (never replaced)', dup.statusCode === 409 && /never replaced/.test(dup.body.error), short(dup.body));
    storageReply = () => ({ status: 200, body: '{"Key":"x"}' });

    // Unsupported op values: refused before anything is read or written.
    const BAD = ['ledger-delete', '', 'LEDGER-IMPORT', 'ledger-import ', '__proto__', 'constructor', 'toString', 'hasOwnProperty', 'upload', ['ledger-import'], ['ledger-import', 'ledger-reverse'], { a: 1 }];
    const leaks = [];
    for (const op of BAD) {
      RL._resetForTests(); logNow.length = 0; calls.length = 0;
      const r1 = await call((rq, rs) => NOW({ ...rq, query: { op } }, rs), 'tok-A', CASES[0][2]);
      if (!(r1.statusCode === 400 && r1.body.error === 'Unknown operation' && logNow.length === 0 && calls.length === 0)) leaks.push(JSON.stringify(op) + '→' + r1.statusCode + ' writes ' + logNow.length + ' calls ' + calls.length);
    }
    check(`${BAD.length} unsupported op values (unknown, empty, case or space variants, prototype names, repeated, objects) → 400 before sign-in, no storage write, no call`, leaks.length === 0, leaks.join(' | '));
    RL._resetForTests(); logNow.length = 0; calls.length = 0;
    const r2 = await call((rq, rs) => NOW({ ...rq, query: { op: 'ledger-import' } }, rs), 'tok-A', CASES[0][2]);
    check('a valid upload body sent to ?op=ledger-import is NOT uploaded; the import refuses it (400) and storage is never written', r2.statusCode === 400 && logNow.length === 0 && !calls.some(c => /rpc|storage/.test(c)), short(r2.body));
    RL._resetForTests();
  }

  const timing = (src) => (src.match(/AbortSignal\.timeout\((\d+)\)/g) || []).map(x => Number(x.match(/\d+/)[0]));
  const impWaits = timing(fs.readFileSync(path.join(ROOT, 'api', '_ledger-common.js'), 'utf8')).concat(timing(fs.readFileSync(path.join(ROOT, 'api', '_ledger-import.js'), 'utf8')));
  check('the import\'s waits add up to under upload.js\'s 30 s (sign-in + document + download + database)',
    impWaits.length === 4 && impWaits.reduce((a, b) => a + b, 0) <= 27000, impWaits.join(' + '));

  server.close();
  T.finish();
}
main().catch(e => { check('verifier crashed', false, e.stack); server.close(); T.finish(); });
