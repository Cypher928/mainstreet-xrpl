'use strict';
/**
 * test-lifecycle-plumbing.js — Step A-1: the leasehold lifecycle reaches every
 * reader, and nothing deletes a leasehold for leaving a list.
 *
 *   node test-lifecycle-plumbing.js
 *
 * Offline. Each script.js function below is lifted out by name (fn-source) and
 * RUN against a fake database that records every call, so the assertions are on
 * behaviour, not on the text of the code.
 *
 *   A  readers select the 037 columns, and survive a database without them
 *   B  the blob roster takes its lifecycle from the table (table wins)
 *   C  the resync payload never carries lifecycle fields, and keeps ended rows
 *      (the live 039 resync prunes unreferenced absentees until 038)
 *   D  nothing deletes a leasehold for leaving a list: Clear All, the direct
 *      fallback, the demo reseeds, the legacy-demo cleanup, the dead deleter
 *   E  period and current-state rules inside script.js
 *   F  the portal reads the columns tolerantly
 */
const fs   = require('fs');
const path = require('path');
const vm   = require('vm');
const { fnSource } = require('./test-support/fn-source.js');

const SCRIPT = fs.readFileSync(path.join(__dirname, 'script.js'), 'utf8');
const LS = require('./leasehold-status.js');
const LP = require('./lease-period.js');

let pass = 0, fail = 0;
const ok  = (m) => { console.log('  \x1b[32m✓\x1b[0m ' + m); pass++; };
const bad = (m, d) => { console.log('  \x1b[31m✗\x1b[0m ' + m + (d ? '  — ' + d : '')); fail++; };
const is  = (c, m, d) => (c ? ok(m) : bad(m, d));
const eq  = (a, b, m) => (JSON.stringify(a) === JSON.stringify(b) ? ok(m) : bad(m, 'got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b)));
const sec = (t) => console.log('\n\x1b[1m── ' + t + ' ──\x1b[0m');

const ROW_SRC = SCRIPT.slice(SCRIPT.indexOf('const TENANT_ROW_COLUMNS_PRE_037'),
                             SCRIPT.indexOf('// The table is the authority on a leasehold'));

/** A Supabase-shaped fake that records every call and answers from `answer`. */
function fakeDb(answer) {
  const calls = [];
  const from = (table) => {
    const st = { table, op: 'select', cols: null, filters: [], payload: null, opts: null };
    const run = () => { calls.push(Object.assign({}, st)); return (answer && answer(st)) || { data: [], error: null }; };
    const b = {
      select(c) { if (st.op === 'select') st.cols = c; return b; },
      insert(p) { st.op = 'insert'; st.payload = p; return b; },
      upsert(p, o) { st.op = 'upsert'; st.payload = p; st.opts = o || null; return b; },
      update(p) { st.op = 'update'; st.payload = p; return b; },
      delete() { st.op = 'delete'; return b; },
      eq(k, v) { st.filters.push(['eq', k, v]); return b; },
      in(k, v) { st.filters.push(['in', k, v]); return b; },
      not(k, o, v) { st.filters.push(['not', k, o, v]); return b; },
      is(k, v) { st.filters.push(['is', k, v]); return b; },
      then(res, rej) { return Promise.resolve(run()).then(res, rej); },
    };
    return b;
  };
  const rpc = async (name, args) => { calls.push({ rpc: name, args }); return (answer && answer({ rpc: name, args })) || { data: { ok: true }, error: null }; };
  return { from, rpc, calls, auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) } };
}

function run(fnNames, sandbox, extra) {
  const src = (extra || '') + '\n' + fnNames.map(n => fnSource(SCRIPT, n)).join('\n') + '\n' +
              fnNames.map(n => `this.${n} = ${n};`).join('\n');
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return sandbox;
}

const ENDED = { id: 't-ended', tenant_name: 'Gone Co', suite: '2', leased_sqft: 1000, start_date: '2018-01-01', end_date: '2030-12-31',
  leasehold_status: 'ended', ended_at: '2024-06-30', ended_reason: 'surrendered' };
const ACTIVE = { id: 't-active', tenant_name: 'Here Co', suite: '1', leased_sqft: 2000, start_date: '2020-01-01', end_date: '2030-12-31' };

(async function main() {

// ── A ──────────────────────────────────────────────────────────────────────
sec('A. Readers select the 037 columns, and survive a database without them');
{
  const lp = fnSource(SCRIPT, 'loadProperties');
  is(/\.select\(TENANT_ROW_COLUMNS\)/.test(lp) && /_isLifecycleColumnMissing\(tenantErr\)/.test(lp) && /\.select\(TENANT_ROW_COLUMNS_PRE_037\)/.test(lp),
     'A1 loadProperties selects the lifecycle columns, and retries without them when they are missing');
  is(/normalizeTenant\(_tenantRowToRecord\(t\)\)/.test(lp), 'A2 and maps rows through the one mapper');
  const lpd = fnSource(SCRIPT, 'loadPropertyData');
  is(/select\(TENANT_ROW_COLUMNS\)/.test(lpd) && /select\(TENANT_ROW_COLUMNS_PRE_037\)/.test(lpd) && /_overlayLeaseholdLifecycle\(id, dbData\.tenants\)/.test(lpd),
     'A3 loadPropertyData: tolerant table fallback, and the blob branch gets the overlay');
  const sb = run([], { window: {} }, ROW_SRC + '\nthis.cols=[TENANT_ROW_COLUMNS, TENANT_ROW_COLUMNS_PRE_037, TENANT_LIFECYCLE_COLUMNS]; this.miss=_isLifecycleColumnMissing; this.map=_tenantRowToRecord;');
  is(/leasehold_status, ended_at, ended_reason$/.test(sb.cols[0]) && !/leasehold_status/.test(sb.cols[1]), 'A4 the column lists');
  is(sb.miss({ code: '42703', message: 'column tenants.leasehold_status does not exist' }), 'A5 42703 on a lifecycle column is "missing"');
  is(sb.miss({ code: 'PGRST204', message: "Could not find the 'ended_at' column of 'tenants'" }), 'A6 PGRST204 on a lifecycle column is "missing"');
  is(!sb.miss({ code: '42703', message: 'column tenants.lease_url does not exist' }), 'A7 another missing column is NOT (it is a real error)');
  is(!sb.miss({ code: '57014', message: 'canceling statement due to statement timeout' }) && !sb.miss(null), 'A8 a timeout or no error is not');
  const m = sb.map({ id: 'x', name: 'N', sqft: 1, leasehold_status: 'ended', ended_at: '2024-01-01', ended_reason: 'other' });
  eq([m.tenant_name, m.leasehold_status, m.ended_at, m.ended_reason], ['N', 'ended', '2024-01-01', 'other'], 'A9 the mapper carries the triple');
  const H = require('./api/_property-record-hydrator.js');
  eq([H.TENANT_ROW_COLUMNS.replace(/\s/g, ''), H.TENANT_LIFECYCLE_COLUMNS.replace(/\s/g, '')],
     [sb.cols[0].replace(/\s/g, ''), sb.cols[2].replace(/\s/g, '')], 'A10 the hydrator selects exactly the browser\'s columns');
}

// ── B ──────────────────────────────────────────────────────────────────────
sec('B. The blob roster takes its lifecycle from the table — table wins');
{
  const mkSb = (db) => run(['_overlayLeaseholdLifecycle'], { db, window: { LeaseholdStatus: LS }, console: { warn() {}, log() {}, error() {} } }, ROW_SRC);
  const blob = () => [Object.assign({}, ACTIVE, { leasehold_status: 'active', ended_at: null, ended_reason: null }),
                      Object.assign({}, ENDED, { leasehold_status: 'active', ended_at: null, ended_reason: null }),
                      { id: 'blob-only', tenant_name: 'Blob Only', leasehold_status: 'active', ended_at: null, ended_reason: null }];
  const db1 = fakeDb(st => st.table === 'tenants' ? { data: [{ id: 't-active', leasehold_status: 'active', ended_at: null, ended_reason: null },
    { id: 't-ended', leasehold_status: 'ended', ended_at: '2024-06-30', ended_reason: 'surrendered' }], error: null } : null);
  const t1 = blob();
  await mkSb(db1)._overlayLeaseholdLifecycle('p1', t1);
  eq([t1[1].leasehold_status, t1[1].ended_at, t1[1].ended_reason], ['ended', '2024-06-30', 'surrendered'], 'B1 the table\'s "ended" wins over the blob\'s "active"');
  eq(t1[0].leasehold_status, 'active', 'B2 an active table row stays active');
  eq(t1[2].leasehold_status, 'active', 'B3 a blob row the table does not hold keeps what the blob says');
  eq(db1.calls.map(c => [c.table, c.op, c.cols]), [['tenants', 'select', 'id, leasehold_status, ended_at, ended_reason']], 'B4 one read, the lifecycle columns only');
  const t2 = blob();
  await mkSb(fakeDb(() => ({ data: null, error: { code: '42703', message: 'column tenants.leasehold_status does not exist' } })))._overlayLeaseholdLifecycle('p1', t2);
  eq(t2.map(t => t.leasehold_status), ['active', 'active', 'active'], 'B5 a pre-037 database changes nothing');
  const t3 = blob(); t3[1].leasehold_status = 'ended'; t3[1].ended_at = '2020-01-01';
  await mkSb(fakeDb(() => ({ data: null, error: { code: '500', message: 'boom' } })))._overlayLeaseholdLifecycle('p1', t3);
  eq(t3[1].leasehold_status, 'ended', 'B6 a failed read keeps the blob\'s own values');
  const db4 = fakeDb();
  await mkSb(db4)._overlayLeaseholdLifecycle('p1', []);
  eq(db4.calls.length, 0, 'B7 an empty roster reads nothing');
}

// ── C ──────────────────────────────────────────────────────────────────────
sec('C. The resync payload: no lifecycle fields, and ended rows stay in it');
{
  const db = fakeDb();
  const sb = run(['_doResyncTenantsToTable'], { db, console: { error() {}, warn() {}, log() {} }, showToast() {} });
  await sb._doResyncTenantsToTable('p1', [ACTIVE, ENDED]);
  const rpc = db.calls.find(c => c.rpc === 'resync_property_tenants');
  const rows = rpc ? rpc.args.p_rows : [];
  eq(rows.map(r => r.id), ['t-active', 't-ended'], 'C1 the ENDED leasehold is in the payload — dropping it would let the live 039 resync prune it (038 fixes that server-side)');
  is(rows.every(r => !('leasehold_status' in r) && !('ended_at' in r) && !('ended_reason' in r)), 'C2 no row carries a lifecycle field — a sync never sets or clears one');
  is(!('status' in rows[0]), 'C3 nor the extraction status');
}

// ── D ──────────────────────────────────────────────────────────────────────
sec('D. Nothing deletes a leasehold for leaving a list');
{
  // D1–D4: Clear All, run.
  const db = fakeDb();
  const confirmTexts = [];
  const el = () => ({ innerHTML: 'x', style: {}, value: 'f' });
  const prop = { id: 'p1', tenants: [ACTIVE, ENDED] };
  const tenantData = [ACTIVE, ENDED];
  let saved = 0;
  const sb = run(['clearBulkResults'], {
    db, confirm: (t) => { confirmTexts.push(t); return true; }, currentProperty: () => prop, tenantData,
    document: { getElementById: el }, lastResults: [], _updateStaleResultsBanner() {}, savePropertyData: async () => { saved++; },
    _bulkFilter: null, _resultsStale: false, console,
  });
  await sb.clearBulkResults();
  eq(db.calls.length, 0, 'D1 Clear All makes no database call at all — no tenants delete, no lease_documents read');
  is(tenantData.length === 0 && saved === 1, 'D2 it empties the upload list and saves');
  is(/Leaseholds already saved for this property are not deleted/.test(confirmTexts[0]) && !/cannot be undone/.test(confirmTexts[0]),
     'D3 and says so, instead of warning that records will be removed');
  const cleared = run(['clearBulkResults'], { db: fakeDb(), confirm: () => false, currentProperty: () => prop, tenantData: [ACTIVE],
    document: { getElementById: el }, lastResults: [], savePropertyData: async () => { saved++; }, console });
  await cleared.clearBulkResults();
  eq(saved, 1, 'D4 declining the confirmation does nothing');

  // D5–D6: the direct-write fallback, run.
  const db2 = fakeDb(st => st.table === 'tenants' && st.op === 'select' ? { data: [{ id: 't-active' }, { id: 'absentee' }], error: null } : null);
  const sb2 = run(['_doResyncTenantsDirectly'], { db: db2, console: { log() {}, warn() {}, error() {} }, showToast() {}, currentProperty: () => null, savePropertyData() {} });
  await sb2._doResyncTenantsDirectly('p1', [{ id: 't-active', name: 'Here Co' }]);
  eq(db2.calls.filter(c => c.op === 'delete').length, 0, 'D5 the direct fallback never deletes an absentee');
  eq(db2.calls.map(c => [c.table, c.op]), [['tenants', 'upsert']], 'D6 it upserts, and that is all');

  // D7–D10: demo reseeds and the legacy cleanup, by their code.
  const cas = fnSource(SCRIPT, 'ensureDemoProperty');
  const ng  = fnSource(SCRIPT, 'ensureNorthgateDemo');
  is(!/from\('tenants'\)\s*\.delete\(\)/.test(cas) && /from\('tenants'\)\.upsert\(tenantRows, \{ onConflict: 'id' \}\)/.test(cas),
     'D7 D11: the Cascade Commons reseed upserts on id and deletes nothing');
  is(!/from\('tenants'\)\s*\.delete\(\)/.test(ng) && /from\('tenants'\)\.upsert\(ngTenants\.map[\s\S]*?\{ onConflict: 'id' \}\)/.test(ng),
     'D8 D11: the Northgate reseed upserts on id and deletes nothing');
  is(!/leasehold_status|ended_at|ended_reason/.test(cas + ng), 'D9 neither reseed writes a lifecycle column, so an ended demo leasehold stays ended');
  const leg = fnSource(SCRIPT, 'cleanupLegacyDemos');
  is(!/from\('tenants'\)/.test(leg) && /from\('properties'\)\.delete\(\)/.test(leg), 'D10 the legacy-demo cleanup deletes the property (which cascades) and no leasehold on its own');
  is(!/function syncTenantsToTable\s*\(/.test(SCRIPT) && !/[^e]syncTenantsToTable\(/.test(SCRIPT.replace(/\/\/.*$/gm, '')),
     'D11 syncTenantsToTable (a dead deleter) is gone, and nothing calls it');
  const tenantDeletes = (SCRIPT.replace(/\/\/.*$/gm, '').match(/from\('tenants'\)\s*\.delete\(\)|from\('tenants'\)\.delete\(\)/g) || []).length;
  eq(tenantDeletes, 0, 'D12 script.js has no tenants delete left anywhere');
}

// ── E ──────────────────────────────────────────────────────────────────────
sec('E. Period and current-state rules inside script.js');
{
  const W = { LeaseholdStatus: LS, LeasePeriod: LP, SourceValues: require('./source-values.js') };
  const prop = { tenants: [ACTIVE, ENDED, Object.assign({}, ENDED, { id: 't-ended-2025', ended_at: '2025-03-31' })] };
  const mkV = (year) => run(['getValidTenants'], { window: W, currentProperty: () => prop, getCamYear: () => year, _propertyMismatchBlockReason: () => null });
  eq(mkV(2025).getValidTenants().map(t => t.id), ['t-active', 't-ended-2025'], 'E1 getValidTenants(2025): ended before the period is out, ended inside it is in');
  eq(mkV(2024).getValidTenants().map(t => t.id), ['t-active', 't-ended', 't-ended-2025'], 'E2 getValidTenants(2024): all three were in 2024\'s roster');
  const noLS = run(['getValidTenants'], { window: { SourceValues: W.SourceValues }, currentProperty: () => prop, getCamYear: () => 2025, _propertyMismatchBlockReason: () => null });
  let err = null; try { noLS.getValidTenants(); } catch (e) { err = e; }
  is(err && /LeaseholdStatus is not loaded/.test(err.message), 'E3 without the module it throws — the CAM roster is never guessed');

  const fm = run(['findTenantMatch'], { window: W,
    _normalizeSuite: (s) => String(s || '').trim().toLowerCase(), _normalizeTenantName: (s) => String(s || '').trim().toLowerCase() });
  eq(fm.findTenantMatch([ENDED], { suite: '2' }, -1), null, 'E4 D7: an upload never matches an ended leasehold by suite');
  eq(fm.findTenantMatch([ENDED], { tenant_name: 'Gone Co' }, -1), null, 'E5 nor by name');
  eq(fm.findTenantMatch([Object.assign({}, ENDED, { leasehold_status: 'active' })], { suite: '2' }, -1), { index: 0, basis: 'suite' },
     'E6 the same row, active, still matches exactly as before (A-2 changes that, not A-1)');

  const fp = run(['camInputsFingerprint'], { window: W, parseSqft: (v) => Number(v), parseMoney: (v) => Number(v), _camInputExclusions: () => [] });
  const base = fp.camInputsFingerprint([ACTIVE], []);
  eq(base, 't:Here Co|2000|||#i:', 'E7 an active leasehold\'s fingerprint is exactly the pre-037 shape');
  is(fp.camInputsFingerprint([ENDED], []) === 't:Gone Co|1000|||' + '|ended:2024-06-30#i:', 'E8 an ended one adds its end, so ending a leasehold makes a saved run stale');
}

// ── F ──────────────────────────────────────────────────────────────────────
sec('F. The portal reads the columns tolerantly, and displays nothing new');
{
  const P = fs.readFileSync(path.join(__dirname, 'portal.js'), 'utf8');
  is(/\.select\(SPACE_COLUMNS \+ ', leasehold_status, ended_at, ended_reason'\)/.test(P) && /sp = await db\.from\('tenants'\)\.select\(SPACE_COLUMNS\)/.test(P),
     'F1 portal.js selects the lifecycle and retries with the pre-037 list');
  is(!/ended_at\)|leasehold_status\)|t\.ended|t\.leasehold/.test(P), 'F2 and renders none of it (no display change in A-1)');
}

console.log(`\n${fail ? '\x1b[31m' : '\x1b[32m'}RESULT: ${pass} passed, ${fail} failed\x1b[0m`);
process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
