'use strict';
/**
 * tools/verify-migration-022b.js — run 022b for real, against nothing that
 * matters, and prove the payment exposure is closed without breaking payments.
 *
 *   node tools/verify-migration-022b.js
 *
 * It touches NO Supabase project. It builds a throwaway PostgreSQL cluster and
 * applies the repo's own migrations to it.
 *
 * TWO DATABASES
 *
 *   pilotlike   built under the LEGACY default privileges Pilot was actually
 *               built under, so it reproduces Pilot's current exposure. The
 *               bug is proven present BEFORE 022b — a test that cannot fail on
 *               the broken state proves nothing — then 022b is applied.
 *   fresh       built under the post-2026-10-30 model (nothing granted unless a
 *               migration grants it), to prove 022b is also right for any
 *               environment built from here on.
 *
 * WHAT IT PROVES
 *
 *   1  baseline: before 022b another landlord reads A's payments, sources,
 *      settlements, events and balances, a tenant reads every payment event,
 *      and anon can call the internal helpers
 *   2  022b applies, and applies again
 *   3  SECURITY — another authenticated user cannot read another property's
 *      payment, source, settlement, event or balance records
 *   4  the owner, the tenant (within their existing rules) and service_role
 *      still read exactly what they should
 *   5  SECURITY — the three internal helpers cannot be invoked by anon,
 *      authenticated or service_role
 *   6  LIFECYCLE — create → authorize → issue → record (partial) → record
 *      (settled) → void (back to partial) → dispute open → resolve, and
 *      create → cancel, all still work; state is still derived; a retried
 *      request records nothing twice (see the note in lifecycle() on 022's
 *      replay guard, a pre-existing defect this migration does not touch)
 *   7  NOTHING ELSE MOVED — every payment function definition, every column,
 *      constraint and index, and every existing row is byte-identical across 022b
 *   8  the rollback is the exact inverse (and re-opens the exposure), and 022b
 *      applies again after it
 *   9  under the post-2026-10-30 model the same guarantees hold
 *
 * ABOUT tenant_statements. 022 has a foreign key to public.tenant_statements,
 * which migration 017 creates — and 017 is not on this branch (it lives only on
 * claude/b2-tenant-portal; see the migration-drift workstream). This verifier
 * therefore creates a STAND-IN with the three columns 022 touches (id, a
 * tenant/property pair, status). It stands in for 017 and nothing else.
 */
const path = require('path');
const { startCluster, tally, show } = require('./_pg-throwaway');

const ROOT = path.join(__dirname, '..');
const MIG  = path.join(ROOT, 'migrations');
const M022B = path.join(MIG, '022b_payment_access_scope.sql');
const R022B = path.join(MIG, '022b_payment_access_scope_rollback.sql');

const T = tally();
const { check, section } = T;

const MARKER = 'fd9c09b1-b657-4c58-9999-c3cce28e7600';   // 012–015 refuse to run without it
const UA = '11111111-1111-4111-8111-111111111111';        // landlord A
const UB = '22222222-2222-4222-8222-222222222222';        // landlord B
const UT = '33333333-3333-4333-8333-333333333333';        // tenant-portal user of A's tenant
const PA = 'aaaaaaaa-0000-4000-8000-00000000000a';
const PB = 'bbbbbbbb-0000-4000-8000-00000000000b';
const TA = 'aaaaaaaa-1111-4000-8000-00000000000a';
const TB = 'bbbbbbbb-1111-4000-8000-00000000000b';

const PREREQS = ['000_base_schema.sql', '001_lease_jobs.sql', '005_rls_hardening.sql',
                 '012_tenant_users_phase_a.sql', '013_tenant_users_revoke_anon.sql',
                 '014_tenant_invitations.sql', '015_tenant_users_hide_revoked.sql'];

const TABLES = ['payments', 'payment_sources', 'payment_settlements', 'payment_events'];
const HELPERS = ['public._payment_settled_total(uuid)', 'public._payment_derive_state(uuid)',
                 'public._payment_replay(uuid, uuid)'];

console.log('\n══ migration 022b — executed against a throwaway cluster ══');
console.log('   NO Supabase project is contacted by this script.');
const pg = startCluster('022b');
console.log('   postgres: ' + pg.PGBIN);

// ── building a database to the point just before 022b ─────────────────────
function build(db, model) {
  section(`${db}: build to 022 (${model} default privileges)`);
  const boot = pg.database(db, model);
  check(`${db}: Supabase prerequisites created`, boot.ok, boot.ok ? '' : boot.out.slice(0, 200));
  const q = (sql) => pg.psql(sql, db);
  q(`insert into auth.users (id, email) values ('${UA}','a@example.com'), ('${UB}','b@example.com'), ('${UT}','t@example.com');`);
  let ok = true;
  for (const f of PREREQS.slice(0, 3)) { const r = pg.psqlFile(path.join(MIG, f), db); ok = check(`${db}: ${f} applies`, r.ok, r.ok ? '' : r.out.slice(0, 300)) && ok; }
  q(`insert into public.properties (id, user_id, name) values
       ('${MARKER}', null, 'pilot marker'), ('${PA}','${UA}','A Plaza'), ('${PB}','${UB}','B Centre');
     insert into public.tenants (id, property_id, name) values ('${TA}','${PA}','A Tenant'), ('${TB}','${PB}','B Tenant');`);
  for (const f of PREREQS.slice(3)) { const r = pg.psqlFile(path.join(MIG, f), db); ok = check(`${db}: ${f} applies`, r.ok, r.ok ? '' : r.out.slice(0, 300)) && ok; }
  // The 017 stand-in (see the header). Under the post-2026-10-30 model it is
  // given exactly the SELECT that the B2 grant migration gives the real table.
  const st = q(`create table public.tenant_statements (
                  id uuid primary key default gen_random_uuid(),
                  tenant_id uuid, property_id uuid, status text not null default 'published');
                ${model === 'post-2026-10-30' ? 'grant select on public.tenant_statements to authenticated;' : ''}`);
  ok = check(`${db}: tenant_statements stand-in created (017 is not on this branch)`, st.ok, st.ok ? '' : st.out) && ok;
  const r22 = pg.psqlFile(path.join(MIG, '022_payment_management.sql'), db);
  ok = check(`${db}: 022_payment_management.sql applies`, r22.ok, r22.ok ? '' : r22.out.slice(0, 400)) && ok;
  q(`insert into public.tenant_users (user_id, tenant_id, property_id, accepted_at) values ('${UT}','${TA}','${PA}', now());`);
  if (!ok) { console.log('\nStopping: the database could not be built.'); T.finish(); }
}

// ── the procedures, called the way the app would: as an authenticated user ──
function statement(db, tenant, property) {
  return pg.psql(`insert into public.tenant_statements (tenant_id, property_id) values ('${tenant}','${property}') returning id;`, db).out;
}
function call(db, uid, sql) {
  const r = pg.as('authenticated', uid, `select ${sql};`, db);
  return r;
}
const rid = () => require('crypto').randomUUID();
function lifecycle(db, uid, property, tenant, label) {
  const out = { ok: true, steps: [] };
  const step = (name, r, expectState) => {
    let good = r.ok;
    let state = null;
    if (good && expectState) { state = r.out.split('|').pop(); good = state === expectState; }
    out.steps.push(`${name}${good ? '' : ' FAILED: ' + (r.ok ? 'state ' + state : r.out.slice(0, 160))}`);
    out.ok = out.ok && good;
    return r;
  };
  const st1 = statement(db, tenant, property);
  const cr = step('create', call(db, uid, `(p).id, (p).state from (select public.payment_create('${property}','${tenant}',2025,'${st1}',1000,'h1','${rid()}') p) x`), 'draft');
  const pay = cr.ok ? cr.out.split('|')[0] : null;
  out.payment = pay;
  step('authorize', call(db, uid, `(public.payment_authorize('${pay}','${rid()}','h1')).state`), 'authorized');
  step('issue', call(db, uid, `(public.payment_issue('${pay}','${rid()}','ach','Operating ••4821','2026-01-31')).state`), 'instructed');
  const replayId = rid();
  step('record 400 (partial)', call(db, uid, `(public.payment_record_settlement('${pay}','${replayId}',400,now(),'bank_reference','document_backed','REF-1')).state`), 'partially_settled');
  // A RETRIED request. 022's guard is `_payment_replay(…) is not null`, and a
  // composite row IS NOT NULL only when every column is non-null — an event
  // row always has nulls (client_ts, reason…), so the guard never fires and
  // the retry is refused by a unique index instead of returning the prior
  // result. That is 022's behaviour before 022b and after it (this verifier
  // checks both); it records nothing twice, which is the property that
  // matters here. The guard itself is a pre-existing defect, out of scope:
  // 022b changes no function body.
  const counts = () => pg.psql(`select (select count(*) from public.payment_events where payment_id='${pay}')||'/'||
                                        (select count(*) from public.payment_settlements where payment_id='${pay}');`, db).out;
  const before = counts();
  const retry = call(db, uid, `(public.payment_record_settlement('${pay}','${replayId}',400,now(),'bank_reference','document_backed','REF-1')).state`);
  out.retryRefused = !retry.ok;
  out.replayWroteNothing = counts() === before;
  out.steps.push('retry the same request' + (out.replayWroteNothing ? ' (recorded nothing twice)' : ' FAILED: recorded twice'));
  out.ok = out.ok && out.replayWroteNothing;
  step('record 600 (settled)', call(db, uid, `(public.payment_record_settlement('${pay}','${rid()}',600,now(),'bank_reference','document_backed','REF-2')).state`), 'settled');
  const sid = pg.psql(`select id from public.payment_settlements where payment_id='${pay}' and evidence_ref='REF-2';`, db).out;
  step('void the 600 (back to partial — derived state)', call(db, uid, `(public.payment_void_settlement('${sid}','${rid()}','entered in error')).state`), 'partially_settled');
  step('dispute open', call(db, uid, `(public.payment_dispute_open('${pay}','${rid()}','tenant disputes')).state`), 'partially_settled');
  step('dispute resolve', call(db, uid, `(public.payment_dispute_resolve('${pay}','${rid()}','resolved')).state`), 'partially_settled');
  const st2 = statement(db, tenant, property);
  const cr2 = step('create a second', call(db, uid, `(p).id, (p).state from (select public.payment_create('${property}','${tenant}',2025,'${st2}',250,'h2','${rid()}') p) x`), 'draft');
  const pay2 = cr2.ok ? cr2.out.split('|')[0] : null;
  step('cancel it', call(db, uid, `(public.payment_cancel('${pay2}','${rid()}','superseded')).state`), 'cancelled');
  out.events = pg.psql(`select string_agg(action, ',' order by server_ts, action) from public.payment_events where payment_id='${pay}';`, db).out;
  out.label = label;
  return out;
}

// What a role can SEE of another property's payment records.
function foreignRows(db, role, uid, property) {
  const n = {};
  for (const t of TABLES.concat(['payment_balances'])) {
    const r = pg.as(role, uid, `select count(*) from public.${t} where property_id='${property}';`, db);
    n[t] = r.ok ? Number(r.out) : 'refused';
  }
  return n;
}
const allZero = (n) => Object.values(n).every(v => v === 0);
// The request id is looked up as postgres and passed as a literal: a lookup
// inside the role's own query would be refused for the WRONG reason (no read
// on payment_events), and prove nothing about the helper.
let HELPER_DB = null;
const reqOf = (p) => pg.psql(`select request_id from public.payment_events where payment_id='${p}' order by server_ts limit 1;`, HELPER_DB).out;
const helperCall = {
  'public._payment_settled_total(uuid)': (p) => `select public._payment_settled_total('${p}');`,
  'public._payment_derive_state(uuid)':  (p) => `select public._payment_derive_state('${p}');`,
  'public._payment_replay(uuid, uuid)':  (p) => `select (public._payment_replay('${p}', '${reqOf(p)}')).id;`,
};

// Everything 022b must leave exactly as it was.
function fingerprint(db) {
  const q = (sql) => pg.psql(sql, db).out;
  return {
    functions: q(`select md5(string_agg(pg_get_functiondef(p.oid), '|' order by p.proname))
                  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                  where n.nspname='public' and (p.proname like 'payment\\_%' or p.proname like '\\_payment\\_%' or p.proname='resync_property_tenants')`),
    columns: q(`select md5(string_agg(table_name||'.'||column_name||':'||data_type||':'||is_nullable||':'||coalesce(column_default,''), '|' order by table_name, ordinal_position))
                from information_schema.columns where table_schema='public' and table_name like 'payment%'`),
    constraints: q(`select md5(string_agg(conname||':'||pg_get_constraintdef(oid), '|' order by conname))
                    from pg_constraint where conrelid in ('public.payments'::regclass,'public.payment_sources'::regclass,
                                                          'public.payment_settlements'::regclass,'public.payment_events'::regclass)`),
    indexes: q(`select md5(string_agg(indexdef, '|' order by indexname)) from pg_indexes where schemaname='public' and tablename like 'payment%'`),
    view: q(`select md5(pg_get_viewdef('public.payment_balances'::regclass))`),
    rows: q(`select md5(concat_ws('|',
               (select string_agg(p::text, ',' order by p.id) from public.payments p),
               (select string_agg(s::text, ',' order by s.payment_id) from public.payment_sources s),
               (select string_agg(x::text, ',' order by x.id) from public.payment_settlements x),
               (select string_agg(e::text, ',' order by e.id) from public.payment_events e)))`),
    procGrants: q(`select md5(string_agg(p.proname||':'||coalesce(p.proacl::text,''), '|' order by p.proname))
                   from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                   where n.nspname='public' and p.proname like 'payment\\_%'`),
  };
}
const policyRoles = (db) => pg.psql(`select string_agg(policyname||'='||array_to_string(roles,'+'), ' ' order by policyname)
                                     from pg_policies where schemaname='public' and policyname like 'payment%service_role_all';`, db).out;

// ════════════════════════════════════════════════════════════════════════════
// PILOTLIKE — the state Pilot is in today
// ════════════════════════════════════════════════════════════════════════════
const D = 'pilotlike';
build(D, 'legacy');
HELPER_DB = D;

section('pilotlike: payments exist for two landlords');
const seedA = lifecycle(D, UA, PA, TA, 'A before 022b');
check('landlord A runs the full lifecycle (before 022b)', seedA.ok, seedA.steps.filter(s => /FAILED/.test(s)).join('; '));
const seedB = lifecycle(D, UB, PB, TB, 'B before 022b');
check('landlord B runs the full lifecycle (before 022b)', seedB.ok, seedB.steps.filter(s => /FAILED/.test(s)).join('; '));

section('1 · baseline — the exposure is real before 022b');
const leakB = foreignRows(D, 'authenticated', UB, PA);
check("BEFORE: landlord B reads landlord A's payment records (the bug)",
  Object.values(leakB).every(v => typeof v === 'number' && v > 0), JSON.stringify(leakB));
const tenantEventsBefore = pg.as('authenticated', UT, `select count(*) from public.payment_events;`, D).out;
check('BEFORE: a tenant-portal user reads every payment event of every property (the bug)',
  Number(tenantEventsBefore) > 0, tenantEventsBefore);
check('BEFORE: the service-role policies target PUBLIC', /payments_service_role_all=public/.test(policyRoles(D)), policyRoles(D));
const anonBefore = pg.as('anon', null, helperCall[HELPERS[0]](seedA.payment), D);
check('BEFORE: anon can call _payment_settled_total directly (the bug)', anonBefore.ok && anonBefore.out === '400', anonBefore.out.slice(0, 80));
const replayBefore = pg.as('anon', null, helperCall[HELPERS[2]](seedA.payment), D);
check('BEFORE: anon can read a payment event through _payment_replay (the bug)', replayBefore.ok && /^[0-9a-f-]{36}$/.test(replayBefore.out), replayBefore.out.slice(0, 80));

const fp0 = fingerprint(D);

section('2 · 022b applies, and applies again');
const a1 = pg.psqlFile(M022B, D);
check('022b applies cleanly', a1.ok, a1.ok ? '' : a1.out.slice(0, 400));
const a2 = pg.psqlFile(M022B, D);
check('022b applies a second time without error', a2.ok, a2.ok ? '' : a2.out.slice(0, 400));
check('the four service-role policies now target service_role only',
  policyRoles(D) === 'payment_events_service_role_all=service_role payment_settlements_service_role_all=service_role '
                   + 'payment_sources_service_role_all=service_role payments_service_role_all=service_role', policyRoles(D));

section("3 · SECURITY — no one reads another property's payment records");
const afterB = foreignRows(D, 'authenticated', UB, PA);
check("landlord B reads NONE of landlord A's payments, sources, settlements, events or balances", allZero(afterB), JSON.stringify(afterB));
const afterA = foreignRows(D, 'authenticated', UA, PB);
check("and landlord A reads none of B's", allZero(afterA), JSON.stringify(afterA));
const tenantForeign = foreignRows(D, 'authenticated', UT, PB);
check("a tenant-portal user reads none of another property's records", allZero(tenantForeign), JSON.stringify(tenantForeign));
const tenantEvents = pg.as('authenticated', UT, `select count(*) from public.payment_events;`, D).out;
check('a tenant-portal user reads no payment events at all (022 gives tenants no event policy)', tenantEvents === '0', tenantEvents);
const tenantSources = pg.as('authenticated', UT, `select count(*) from public.payment_sources;`, D).out;
check('nor any payment sources (no tenant policy there either)', tenantSources === '0', tenantSources);
const anonTables = TABLES.map(t => pg.as('anon', null, `select count(*) from public.${t};`, D));
check('anon still cannot read any payment table (unchanged)', anonTables.every(r => !r.ok && /permission denied/.test(r.out)));
check('authenticated still holds SELECT only on the payment tables (no write was granted)',
  TABLES.every(t => pg.privs(`public.${t}`, 'authenticated', D) === 'SELECT'),
  TABLES.map(t => t + '=' + show(pg.privs(`public.${t}`, 'authenticated', D))).join(' '));

section('4 · the legitimate readers still read what they should');
const ownA = pg.as('authenticated', UA, `select count(*) from public.payments where property_id='${PA}';`, D).out;
check("landlord A still reads A's payments", ownA === '2', ownA);
const ownAll = TABLES.map(t => pg.as('authenticated', UA, `select count(*) from public.${t} where property_id='${PA}';`, D).out);
check("and A's sources, settlements and events", ownAll.every(n => Number(n) > 0), ownAll.join(','));
const tenantPays = pg.as('authenticated', UT, `select string_agg(state, ',' order by state) from public.payments;`, D).out;
check('the tenant-portal user still reads their own issued payment (drafts/cancelled stay hidden)', tenantPays === 'partially_settled', tenantPays);
const tenantSettle = pg.as('authenticated', UT, `select count(*) from public.payment_settlements;`, D).out;
check('and its settlements', tenantSettle === '2', tenantSettle);
const svc = TABLES.map(t => pg.as('service_role', null, `select count(*) from public.${t};`, D).out);
const total = TABLES.map(t => pg.psql(`select count(*) from public.${t};`, D).out);
check('service_role still reads every row of all four tables', svc.join() === total.join(), svc.join() + ' vs ' + total.join());

section('5 · SECURITY — the internal helpers cannot be called directly');
for (const role of ['anon', 'authenticated', 'service_role']) {
  for (const h of HELPERS) {
    check(`${role} holds no EXECUTE on ${h}`, !pg.canExecute(role, h, D));
    const r = pg.as(role, role === 'authenticated' ? UA : null, helperCall[h](seedA.payment), D);
    check(`${role} calling ${h.replace('public.', '')} is refused (permission denied)`, !r.ok && /permission denied/.test(r.out), r.ok ? 'it ran: ' + r.out : '');
  }
}
check('PUBLIC holds no EXECUTE on the helpers either',
  pg.psql(`select count(*) from pg_proc p, aclexplode(p.proacl) a where p.proname in ('_payment_settled_total','_payment_derive_state','_payment_replay') and a.grantee = 0;`, D).out === '0');

section('6 · LIFECYCLE — every payment operation still works after 022b');
const life = lifecycle(D, UA, PA, TA, 'A after 022b');
check('create → authorize → issue → record (partial) → record (settled) → void → dispute open → resolve; create → cancel',
  life.ok, life.steps.join(' · '));
check('a retried request records nothing twice — exactly as before 022b', life.replayWroteNothing && life.retryRefused === seedA.retryRefused,
  `retry refused before=${seedA.retryRefused} after=${life.retryRefused}`);
check('the event history is complete and in order',
  life.events === 'create,authorize,issue,record_settlement,record_settlement,void_settlement,dispute_open,dispute_resolve', life.events);
const lifeB = lifecycle(D, UB, PB, TB, 'B after 022b');
check('landlord B runs the full lifecycle too', lifeB.ok, lifeB.steps.filter(s => /FAILED/.test(s)).join('; '));
const cross = call(D, UB, `(public.payment_authorize('${life.payment}','${rid()}','h1')).state`);
check("landlord B still cannot act on A's payment (the ownership check is untouched)", !cross.ok && /Not authorized/.test(cross.out), cross.out.slice(0, 120));
const anonProc = pg.as('anon', null, `select (public.payment_cancel('${life.payment}','${rid()}','x')).state;`, D);
check('anon still cannot act on a payment', !anonProc.ok, anonProc.out.slice(0, 120));

section('7 · nothing else moved');
// Definitions are compared against the snapshot taken just before 022b. Rows
// cannot be compared here — section 6 wrote new ones on purpose — so a second
// database is built, filled, fingerprinted, given 022b and fingerprinted again.
const fp1 = fingerprint(D);
for (const k of ['functions', 'columns', 'constraints', 'indexes', 'view', 'procGrants']) {
  check(`${k} are byte-identical across 022b`, fp0[k] === fp1[k] && !!fp0[k], `${fp0[k].slice(0, 8)} → ${fp1[k].slice(0, 8)}`);
}
const rowsCheck = (() => {
  const d2 = 'rowcheck';
  build(d2, 'legacy');
  lifecycle(d2, UA, PA, TA, 'rows'); lifecycle(d2, UB, PB, TB, 'rows');
  const before = fingerprint(d2).rows;
  const r = pg.psqlFile(M022B, d2);
  return { ok: r.ok, same: fingerprint(d2).rows === before, before };
})();
check('every existing payment, source, settlement and event row is byte-identical across 022b',
  rowsCheck.ok && rowsCheck.same && !!rowsCheck.before);

section('8 · the rollback is the exact inverse');
const rb = pg.psqlFile(R022B, D);
check('the rollback applies', rb.ok, rb.ok ? '' : rb.out.slice(0, 300));
check('and re-opens the exposure — which is why it carries a warning',
  !allZero(foreignRows(D, 'authenticated', UB, PA)) && pg.canExecute('anon', HELPERS[2], D));
const again = pg.psqlFile(M022B, D);
check('022b applies again after the rollback', again.ok, again.ok ? '' : again.out.slice(0, 300));
check('and closes it again', allZero(foreignRows(D, 'authenticated', UB, PA)) && !pg.canExecute('anon', HELPERS[2], D));

// ════════════════════════════════════════════════════════════════════════════
// FRESH — an environment built from here on
// ════════════════════════════════════════════════════════════════════════════
const F = 'fresh';
build(F, 'post-2026-10-30');
section('9 · under the post-2026-10-30 model');
const fa = pg.psqlFile(M022B, F);
check('022b applies to a fresh environment', fa.ok, fa.ok ? '' : fa.out.slice(0, 300));
const fLifeA = lifecycle(F, UA, PA, TA, 'fresh A');
const fLifeB = lifecycle(F, UB, PB, TB, 'fresh B');
check('the full lifecycle works for both landlords', fLifeA.ok && fLifeB.ok,
  fLifeA.steps.concat(fLifeB.steps).filter(s => /FAILED/.test(s)).join('; '));
check('a retried request still records nothing twice', fLifeA.replayWroteNothing);
check("another landlord reads none of A's records", allZero(foreignRows(F, 'authenticated', UB, PA)), JSON.stringify(foreignRows(F, 'authenticated', UB, PA)));
check('no API role holds EXECUTE on any helper',
  ['anon', 'authenticated', 'service_role'].every(r => HELPERS.every(h => !pg.canExecute(r, h, F))));
// 022 never granted service_role anything on these tables; Pilot's service_role
// access came from the legacy defaults. Nothing in the application uses
// service_role on payments, so a fresh build leaving it with no privilege is
// the minimum — recorded here so the day a server path needs it, this fails
// loudly instead of a 42501 in production.
check('service_role holds NO privilege on the payment tables in a fresh build (022 never granted one; no code needs it)',
  TABLES.every(t => pg.privs(`public.${t}`, 'service_role', F) === ''),
  TABLES.map(t => t + '=' + show(pg.privs(`public.${t}`, 'service_role', F))).join(' '));

T.finish();
