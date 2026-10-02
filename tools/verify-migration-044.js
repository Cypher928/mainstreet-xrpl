'use strict';
/**
 * tools/verify-migration-044.js — run 044 (the server enforces the matching
 * and missing-lease safeguards inside acquire_property) for real, against
 * nothing that matters.
 *
 *   node tools/verify-migration-044.js
 *
 * It touches NO Supabase project. It builds a throwaway PostgreSQL cluster,
 * stands up the Pilot-shaped stand-ins tools/verify-migration-036.js keeps (its
 * SCHEMA, read from that file so the two cannot drift), installs 032, 033, 034,
 * 035 and 036 from their files, shows the bypass 044 closes, and applies 044.
 *
 * WHAT IT PROVES
 *
 *   0  BEFORE 044 a direct acquire_property call converts a review with an
 *      unacknowledged leasehold that has no lease on file, and one whose
 *      SafeShield Security entry is matched to Sunrise Cafe & Bakery with no
 *      reason (the gap)
 *   1  044 applies, and applies again; acquire_property stays SECURITY DEFINER
 *      with an empty search_path and the same grants; the attestation table is
 *      RLS-protected, append-only, insert/select only for authenticated,
 *      nothing for anon; acquire_property is 035's body verbatim plus 5c/5d
 *   2  PARITY — acq_compare_tenant_names / acq_compare_property return what
 *      AcquisitionLeasehold.compareTenantNames / compareProperty return, over
 *      every pair of a corpus, and the word lists are the JS module's
 *   3  the nine required behaviours:
 *        1 no lease on file + no acknowledgement → refused
 *        2 each such leasehold acknowledged → converts
 *        3 an acknowledgement for another review or another leasehold does
 *          not count (and cannot be filed against the wrong review)
 *        4 an acknowledgement verifies nothing
 *        5 a material mismatch without a persisted reason → refused
 *        6 a reasoned mismatch, a genuine match and an uncertain one convert
 *        7 client-supplied flags (p_snapshot, review.data, resolution keys,
 *          acted_by, created_at, verifies_terms) bypass nothing
 *        8 authorisation, the freeze, idempotency and the SAME property id hold
 *        9 legacy reviews are not grandfathered
 *      every refusal leaves the property, review, tenants and events
 *      byte-identical
 *   4  NOTHING ELSE MOVED; ROLLBACK restores 035's function exactly, removes
 *      044's objects, and 044 applies again
 *
 * SKIPS (exit 0) when no local PostgreSQL server binary is present, and says so
 * loudly — a skip is not a pass and must not read like one.
 */
const fs = require('fs');
const path = require('path');
const { startCluster, tally } = require('./_pg-throwaway');
const AL = require('../acquisition-leasehold.js');

const ROOT = path.join(__dirname, '..');
const MIG  = path.join(ROOT, 'migrations');
const FILES = ['032_resync_property_tenants_property_bound', '033_property_lifecycle_integrity', '034_property_at_new_acquisition',
               '035_acquire_property', '036_acquisition_episode_frozen'].map(n => [n.slice(0, 3), path.join(MIG, n + '.sql')]);
const M035 = path.join(MIG, '035_acquire_property.sql');
const M044 = path.join(MIG, '044_acquisition_conversion_safeguards.sql');
const R044 = path.join(MIG, '044_acquisition_conversion_safeguards_rollback.sql');

const T = tally();
const { check, section } = T;
const SQL = fs.readFileSync(M044, 'utf8');
const strip = (s) => s.replace(/^\s*--.*$/gm, '');

console.log('\n══ migration 044 — executed against a throwaway cluster ══');
console.log('   NO Supabase project is contacted by this script.');
const pg = startCluster('044');
console.log('   postgres: ' + pg.PGBIN);

// ── people and organisations (verify-migration-036.js's) ─────────────────────
const A = '11111111-1111-4111-8111-111111111111';   // owner of the properties, admin of O1
const M = '33333333-3333-4333-8333-333333333333';   // property_manager in O1 (a member, not an admin)
const D = '55555555-5555-4555-8555-555555555555';   // admin of O1 who owns nothing
const R = '44444444-4444-4444-8444-444444444444';   // read_only in O1
const S = '22222222-2222-4222-8222-222222222222';   // stranger, admin of O2
const Z = '66666666-6666-4666-8666-666666666666';   // admin of O3
const O1 = 'c1c1c1c1-0000-4000-8000-000000000001', O2 = 'c2c2c2c2-0000-4000-8000-000000000002', O3 = 'c3c3c3c3-0000-4000-8000-000000000003';

const V036 = fs.readFileSync(path.join(__dirname, 'verify-migration-036.js'), 'utf8');
const SCHEMA = (() => {
  const a = V036.indexOf('const SCHEMA = `') + 'const SCHEMA = `'.length;
  const b = V036.indexOf('`;\n\nconst q =', a);
  if (a < 20 || b < a) throw new Error('could not read SCHEMA from verify-migration-036.js');
  // eslint-disable-next-line no-new-func
  return new Function('A', 'M', 'D', 'R', 'S', 'Z', 'O1', 'O2', 'O3', 'return `' + V036.slice(a, b) + '`;')(A, M, D, R, S, Z, O1, O2, O3);
})();

const q = (sql, db) => pg.psql(sql, db);
const as = (uid, sql, db) => pg.as('authenticated', uid, sql, db);
const anon = (sql, db) => pg.as('anon', null, sql, db);
const refused = (r, re) => !r.ok && (re ? re.test(r.out) : true);
const one = (sql, db) => q(sql, db).out;
const parse = (r) => { try { return JSON.parse(r.out); } catch (_) { return { _raw: r.out }; } };
const lit = (v) => JSON.stringify(v).replace(/'/g, "''");
const s = (v) => v == null ? 'null' : "'" + String(v).replace(/'/g, "''") + "'";
const rpcBegin = (db, uid, name, data) => parse(as(uid, `select public.begin_acquisition(${s(name)}, '${lit(Object.assign({ totalSqFt: '1000' }, data || {}))}'::jsonb);`, db));
const acquire = (db, uid, pid, rid, snapshot) => as(uid, `select public.acquire_property('${pid}'::uuid, '${rid}'::uuid, '${lit(snapshot)}'::jsonb);`, db);
const fnmd5 = (db) => one(`select md5(pg_get_functiondef('public.acquire_property(uuid,uuid,jsonb)'::regprocedure));`, db);

// The whole state a refused acquire must leave untouched.
const snapshot = (db, pid, rid) => one(`
  select coalesce((select p.lifecycle_stage||'|'||coalesce(p.acquired_at::text,'')||'|'||coalesce(p.data::text,'') from public.properties p where p.id='${pid}'),'')
    || '#' || coalesce((select r.status||'|'||coalesce(r.converted_at::text,'')||'|'||r.data::text||'|'||r.updated_at::text from public.acquisition_reviews r where r.id='${rid}'),'')
    || '#' || coalesce((select string_agg(t.id::text||'|'||coalesce(t.name,''), ',' order by t.id) from public.tenants t where t.property_id='${pid}'),'')
    || '#' || coalesce((select string_agg(e.id::text||'|'||e.action, ',' order by e.id) from public.property_events e where e.property_id='${pid}'),'')
    || '#' || coalesce((select string_agg(a.id::text, ',' order by a.id) from public.acquisition_conversion_attestations a where a.review_id='${rid}'),'')
    || '#' || (select count(*) from public.acquisition_term_decisions where review_id='${rid}')::text;`, db);
// Before 044 there is no attestation table; the same snapshot without it.
const snapshot035 = (db, pid, rid) => one(`
  select coalesce((select p.lifecycle_stage from public.properties p where p.id='${pid}'),'') || '#' ||
         coalesce((select r.status from public.acquisition_reviews r where r.id='${rid}'),'');`, db);

/**
 * A Maple-Plaza-shaped deal. `leaseholds`: [{ key, label, doc }] — doc: true
 * files a confirmed lease into it. `raw`: extracted rows written into
 * review.data.tenants; `res`: extractionResolutions by row id, with familyId
 * given as a leasehold key. Returns ids and a roster with one row per leasehold.
 */
function makeDeal(db, uid, name, o) {
  const d = rpcBegin(db, uid, name, { totalSqFt: '1000' });
  const P = d.property_id, Rv = d.review_id;
  const F = {};
  for (const l of o.leaseholds) {
    F[l.key] = one(`select gen_random_uuid();`, db);
    let r = as(uid, `insert into public.acquisition_document_families(id,review_id,user_id,label) values ('${F[l.key]}','${Rv}','${uid}',${s(l.label)});`, db);
    if (!r.ok) throw new Error('family: ' + r.out);
    if (l.doc) {
      r = as(uid, `insert into public.acquisition_documents(review_id,user_id,file_name,intake_id,family_id,family_status,doc_type,doc_type_status,doc_type_source,confirmed_by,confirmed_at)
                   values ('${Rv}','${uid}',${s(l.key + '.pdf')},${s('ik-' + l.key)},'${F[l.key]}','confirmed','original_lease','confirmed','human','${uid}',now());`, db);
      if (!r.ok) throw new Error('document: ' + r.out);
    }
  }
  const res = {};
  for (const [row, v] of Object.entries(o.res || {})) res[row] = Object.assign({}, v, v.family ? { familyId: F[v.family] } : {}, { family: undefined });
  const data = Object.assign({ tenants: o.raw || [], extractionResolutions: res }, o.data || {});
  const r = as(uid, `update public.acquisition_reviews set data = data || '${lit(data)}'::jsonb where id='${Rv}';`, db);
  if (!r.ok) throw new Error('review data: ' + r.out);
  const roster = o.leaseholds.map(l => ({ id: F[l.key], family_id: F[l.key], property_id: P, review_id: Rv, tenant_name: l.label, leased_sqft: '500', cap: null, start_date: null, end_date: null, lease_type: null }));
  return { P, R: Rv, F, roster, snap: { roster, propertyName: name, occupancyAtAcquisition: 100, waltAtAcquisition: 0 } };
}
const ack = (db, uid, deal, key, extra) => as(uid, `insert into public.acquisition_conversion_attestations(review_id,family_id,kind${extra ? ',' + Object.keys(extra).join(',') : ''})
  values ('${deal.R}','${deal.F[key]}','no_document_on_file'${extra ? ',' + Object.values(extra).map(s).join(',') : ''});`, db);
const confirmMatch = (db, uid, deal, row, key, reason, extra) => as(uid, `insert into public.acquisition_conversion_attestations(review_id,family_id,kind,row_key,reason${extra ? ',' + Object.keys(extra).join(',') : ''})
  values ('${deal.R}','${deal.F[key]}','match_confirmed',${s(row)},${s(reason)}${extra ? ',' + Object.values(extra).map(s).join(',') : ''});`, db);

// The SafeShield → Sunrise shape, as the Pilot held it before conversion.
const SAFESHIELD = { id: 'raw-ss', tenant_name: 'SafeShield Security, LLC', property_name: '500 Main Street', _status: 'ok', _fileName: 'SafeShield Lease.pdf' };
const LUXE_RAW   = { id: 'raw-lx', tenant_name: 'LUXE NAILS, L.L.C.', property_name: 'Maple Plaza', _status: 'ok' };
const COFFEE_RAW = { id: 'raw-mc', tenant_name: 'Maple Coffee Co', property_name: 'Maple Plaza Shopping Center, 12 Elm St', _status: 'ok' };
const UNSURE_RAW = { id: 'raw-un', tenant_name: 'Prime Wellness', property_name: 'Maple Plaza', _status: 'ok' };
const ELSEWHERE  = { id: 'raw-ew', tenant_name: 'Luxe Nails', property_name: 'Lakeview Center', _status: 'ok' };

// ── build ────────────────────────────────────────────────────────────────────
const DB = 'pilotlike';
let r = pg.database(DB, 'legacy');
check('pilotlike: database built under Pilot\'s legacy default privileges', r.ok, r.ok ? '' : r.out.slice(0, 300));
r = q(SCHEMA, DB);
check('pilotlike: verify-migration-036.js\'s stand-ins (constraints, triggers, functions, privileges, organisations, policies)', r.ok, r.ok ? '' : r.out.slice(0, 500));
for (const [n, f] of FILES) { r = pg.psqlFile(f, DB); check(`pilotlike: ${n} installed from its file`, r.ok, r.ok ? '' : r.out.slice(0, 300)); }
const md5_035 = fnmd5(DB);

// ── 0 · the gap ──────────────────────────────────────────────────────────────
section('0 · BEFORE 044 — a direct call bypasses both safeguards');
let G = makeDeal(DB, A, 'Gap Docless', { leaseholds: [{ key: 'luxe', label: 'Luxe Nails', doc: true }, { key: 'sun', label: 'Sunrise Cafe & Bakery LLC' }] });
r = acquire(DB, A, G.P, G.R, G.snap);
check('before 044: a leasehold with no lease on file and no acknowledgement converts', r.ok && parse(r).ok === true, r.out.slice(0, 200));
G = makeDeal(DB, A, 'Maple Gap', { leaseholds: [{ key: 'sun', label: 'Sunrise Cafe & Bakery LLC', doc: true }], raw: [SAFESHIELD], res: { 'raw-ss': { action: 'matched', family: 'sun' } } });
r = acquire(DB, A, G.P, G.R, G.snap);
check('before 044: SafeShield Security matched to Sunrise Cafe & Bakery with no reason converts', r.ok && parse(r).ok === true, r.out.slice(0, 200));

// Every object outside 044's own, for the "nothing else moved" diff.
const OWN = ['acquire_property', 'acq_name_tokens', 'acq_compare_tenant_names', 'acq_compare_property', 'acq_match_requires_reason', 'acq_attestations_guard', 'acq_attestations_append_only'];
const inventory = (db) => q(`
  select string_agg(x, E'\\n' order by x) from (
    select 'con|'||conrelid::regclass::text||'|'||conname||'|'||pg_get_constraintdef(oid) as x from pg_constraint where connamespace='public'::regnamespace and conrelid::regclass::text <> 'acquisition_conversion_attestations'
    union all select 'trg|'||t.tgrelid::regclass::text||'|'||t.tgname||'|'||pg_get_triggerdef(t.oid) from pg_trigger t where not t.tgisinternal and t.tgrelid::regclass::text <> 'acquisition_conversion_attestations'
    union all select 'fn|'||p.proname||'|'||md5(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f' and p.proname not in (${OWN.map(f => `'${f}'`).join(',')})
    union all select 'col|'||table_name||'|'||column_name||'|'||data_type||'|'||is_nullable from information_schema.columns where table_schema='public' and table_name <> 'acquisition_conversion_attestations'
    union all select 'idx|'||indexname||'|'||indexdef from pg_indexes where schemaname='public' and tablename <> 'acquisition_conversion_attestations'
    union all select 'pol|'||tablename||'|'||policyname||'|'||coalesce(qual,'')||'|'||coalesce(with_check,'') from pg_policies where schemaname='public' and tablename <> 'acquisition_conversion_attestations'
    union all select 'pri|'||table_name||'|'||grantee||'|'||string_agg(privilege_type, ',' order by privilege_type) from information_schema.role_table_grants where table_schema='public' and table_name <> 'acquisition_conversion_attestations' group by table_name, grantee
  ) s;`, db).out;
const before = inventory(DB);

// ── 1 · apply ────────────────────────────────────────────────────────────────
section('1 · 044 applies, and applies again');
r = pg.psqlFile(M044, DB);
check('044 applies', r.ok, r.ok ? '' : r.out.slice(0, 800));
r = pg.psqlFile(M044, DB);
check('044 applies a second time without error', r.ok, r.out.slice(0, 300));
check('acquire_property is still SECURITY DEFINER with an empty search_path', one(`select prosecdef::text||'|'||coalesce(array_to_string(proconfig,','),'') from pg_proc where proname='acquire_property';`, DB) === 'true|search_path=""');
check('acquire_property: authenticated and service_role may execute; anon and PUBLIC may not',
  pg.canExecute('authenticated', 'public.acquire_property(uuid,uuid,jsonb)', DB) && pg.canExecute('service_role', 'public.acquire_property(uuid,uuid,jsonb)', DB)
  && !pg.canExecute('anon', 'public.acquire_property(uuid,uuid,jsonb)', DB) && one(`select has_function_privilege(0, 'public.acquire_property(uuid,uuid,jsonb)', 'execute');`, DB) === 'f');
check('the attestation table: RLS on; authenticated may only SELECT and INSERT; anon nothing',
  one(`select relrowsecurity::text from pg_class where oid='public.acquisition_conversion_attestations'::regclass;`, DB) === 'true'
  && pg.privs('public.acquisition_conversion_attestations', 'authenticated', DB) === 'INSERT,SELECT'
  && pg.privs('public.acquisition_conversion_attestations', 'anon', DB) === '', pg.privs('public.acquisition_conversion_attestations', 'authenticated', DB));
check('the guard runs before 034\'s property bind and 036\'s freeze, on insert',
  one(`select string_agg(tgname, ',' order by tgname) from pg_trigger where tgrelid='public.acquisition_conversion_attestations'::regclass and not tgisinternal;`, DB)
  === 'acq_attestations_append_only,acq_attestations_guard,acq_attestations_property_bind,acq_children_frozen');
(() => {
  // 044's acquire_property is 035's text with exactly the declarations and the
  // 5c/5d block added — every other line is 035's, in 035's order.
  const fn035 = fs.readFileSync(M035, 'utf8'); const f35 = fn035.slice(fn035.indexOf('create or replace function public.acquire_property('));
  const f44all = SQL.slice(SQL.indexOf('create or replace function public.acquire_property('));
  const f44 = f44all.slice(0, f44all.indexOf('to authenticated, service_role;') + 'to authenticated, service_role;'.length) + '\n';
  const added = f44.replace(/  v_docless    integer;\n  v_docless_names text;\n  v_unreasoned integer;\n  v_unreasoned_names text;\n  v_names      text\[\];\n/, '')
                   .replace(/  -- 5c · no lease on file \(044\)[\s\S]*?(?=  -- ── 6 · the supplied roster)/, '');
  check('acquire_property is 035\'s body VERBATIM plus the declarations and steps 5c / 5d', added === f35, 'differs from 035');
})();

// ── 2 · parity ───────────────────────────────────────────────────────────────
section('2 · PARITY — the SQL comparison is the JS comparison');
(() => {
  const src = fs.readFileSync(path.join(ROOT, 'acquisition-leasehold.js'), 'utf8');
  const jsList = (name) => { const m = src.match(new RegExp('var ' + name + ' = \\{([^}]*)\\}')); return m ? m[1].match(/[a-z]+(?=\s*:)/g).sort().join(',') : '<missing>'; };
  const sqlList = (name) => { const m = strip(SQL).match(new RegExp(name + '\\s+constant\\s+text\\[\\]\\s*:=\\s*array\\[([^\\]]+)\\]')); return m ? m[1].split(',').map(x => x.trim().replace(/'/g, '')).sort().join(',') : '<missing>'; };
  for (const [js, sq] of [['LEGAL_SUFFIX', 'c_legal'], ['FILLER', 'c_filler'], ['GENERIC_TENANT', 'c_generic_tenant'], ['GENERIC_PROPERTY', 'c_generic_property']]) {
    check(`${sq} is exactly the JS module's ${js}`, jsList(js) === sqlList(sq) && jsList(js) !== '<missing>', jsList(js) + ' vs ' + sqlList(sq));
  }
})();
const TENANTS = ['SafeShield Security, LLC', 'Sunrise Cafe & Bakery LLC', 'Sunrise Cafe', 'Sunrise Café', 'SafeShield Insurance', 'SafeShield',
  'Luxe Nails', 'LUXE NAILS, L.L.C.', 'Luxe Nail Spa', 'Maple Coffee Co', 'Maple Coffee Co.', 'Maple Coffee Company', 'Prime Wellness Spa', 'Prime Wellness',
  'ShopRite', 'Shop Rite Supermarkets', 'Joe’s Pizza', 'Joes Pizza', "Joe's Pizza & Grill", 'The Coffee Shop', 'Coffee', '', '   ', 'A & B Holdings',
  'A&B Holdings Inc', 'AB Holdings', '7-Eleven', '7 Eleven Inc', 'Seven Eleven', 'Bank of America', 'Chase Bank', 'CVS Pharmacy', 'CVS',
  'Dental Care Associates', 'Smile Dental', 'Planet Fitness', 'Planet Fitness Inc.', 'Salon Lofts', 'Lofts Salon', 'Ünïcode Café', "O'Brien's Deli",
  'OBriens Deli', 'U.S. Bank', 'US Bank National Association', "Mc Donald's", 'McDonalds', 'The UPS Store', 'UPS Store #1234', 'Dr. Smith, D.D.S., P.C.', '1234', 'Unit 5'];
(() => {
  const pairs = [];
  for (const a of TENANTS) for (const b of TENANTS) pairs.push([a, b]);
  const js = pairs.map(([a, b]) => { const c = AL.compareTenantNames(a, b); return c ? c.level : 'null'; });
  const out = one(`select string_agg(coalesce(public.acq_compare_tenant_names(a, b), 'null'), '|' order by i) from (values ${pairs.map(([a, b], i) => `(${i}, ${s(a)}, ${s(b)})`).join(',')}) v(i, a, b);`, DB).split('|');
  const diff = pairs.map((p, i) => js[i] !== out[i] ? `${JSON.stringify(p)} js=${js[i]} sql=${out[i]}` : null).filter(Boolean);
  check(`tenant names: ${pairs.length} ordered pairs, every SQL verdict equals the JS verdict`, out.length === pairs.length && diff.length === 0, diff.slice(0, 3).join('; '));
  check('…the corpus exercises all three verdicts', ['null', 'uncertain', 'mismatch'].every(l => js.includes(l)));
  check('SafeShield Security, LLC → Sunrise Cafe & Bakery LLC is a mismatch in both', AL.compareTenantNames(SAFESHIELD.tenant_name, 'Sunrise Cafe & Bakery LLC').level === 'mismatch'
    && one(`select public.acq_compare_tenant_names(${s(SAFESHIELD.tenant_name)}, 'Sunrise Cafe & Bakery LLC');`, DB) === 'mismatch');
  check('Luxe Nails → Luxe Nails and Maple Coffee Co. → Maple Coffee Co. are no concern in both',
    one(`select coalesce(public.acq_compare_tenant_names('LUXE NAILS, L.L.C.', 'Luxe Nails'),'null')||'|'||coalesce(public.acq_compare_tenant_names('Maple Coffee Co', 'Maple Coffee Co.'),'null');`, DB) === 'null|null'
    && AL.compareTenantNames('LUXE NAILS, L.L.C.', 'Luxe Nails') === null && AL.compareTenantNames('Maple Coffee Co', 'Maple Coffee Co.') === null);
})();
const SOURCES = ['500 Main Street', '500 Main Street, Springfield', '500 Main St', 'Maple Plaza', 'Maple Plaza Shopping Center, 12 Elm St', '  Maple Plaza  ',
  'Lakeview Center', 'Lakeview', 'Plaza', 'The Shopping Center', '12A Elm Road', '1200Elm', 'Elm Street Commons', 'Harborview Commons', 'Maple', '', ',', '\tMaple Plaza\n'];
const NAMESETS = [['Maple Plaza'], ['Maple Plaza', 'Maple Plaza'], ['Maple Plaza', '500 Main Street'], ['Shopping Center'], ['Lakeview Center'], ['Harborview'],
  [], ['  '], ['Elm Street Commons', 'Maple Plaza'], ['12 Elm Street'], ['Lakeview Center', 'Plaza'], ['!!!']];
(() => {
  const cases = [];
  for (const a of SOURCES) for (const n of NAMESETS) cases.push([a, n]);
  const js = cases.map(([a, n]) => { const c = AL.compareProperty(a, n); return c ? c.level : 'null'; });
  const arr = (n) => n.length ? `array[${n.map(s).join(',')}]::text[]` : `'{}'::text[]`;
  const out = one(`select string_agg(coalesce(public.acq_compare_property(a, n), 'null'), '|' order by i) from (values ${cases.map(([a, n], i) => `(${i}, ${s(a)}, ${arr(n)})`).join(',')}) v(i, a, n);`, DB).split('|');
  const diff = cases.map((c, i) => js[i] !== out[i] ? `${JSON.stringify(c)} js=${js[i]} sql=${out[i]}` : null).filter(Boolean);
  check(`property: ${cases.length} source × name-set cases, every SQL verdict equals the JS verdict`, out.length === cases.length && diff.length === 0, diff.slice(0, 3).join('; '));
  check('…the corpus exercises all three verdicts', ['null', 'uncertain', 'mismatch'].every(l => js.includes(l)));
})();
(() => {
  // matchConcerns → requiresReason, against the SQL predicate the gate uses.
  const rows = [SAFESHIELD, LUXE_RAW, COFFEE_RAW, UNSURE_RAW, ELSEWHERE, { tenantName: 'Sunrise Cafe', propertyName: 'Lakeview' }, { tenant_name: '', tenantName: 'SafeShield' }];
  const fams = ['Sunrise Cafe & Bakery LLC', 'Luxe Nails', 'Maple Coffee Co.', 'Prime Wellness Spa'];
  const names = ['Maple Plaza'];
  const cases = []; for (const row of rows) for (const f of fams) cases.push([row, f]);
  const js = cases.map(([row, f]) => String(AL.requiresReason(AL.matchConcerns(row, { label: f }, { acquisitionNames: names }))));
  const out = one(`select string_agg(public.acq_match_requires_reason(r, f, array['Maple Plaza'])::text, '|' order by i) from (values ${cases.map(([row, f], i) => `(${i}, '${lit(row)}'::jsonb, ${s(f)})`).join(',')}) v(i, r, f);`, DB).split('|');
  check(`requiresReason(matchConcerns(…)): ${cases.length} cases, the SQL predicate agrees with the JS`, out.join('|') === js.join('|'), out.join('|') + ' vs ' + js.join('|'));
})();

// ── 3 · the required behaviours ──────────────────────────────────────────────
section('3 · THE GATE — every refusal leaves the state byte-identical');
const refuseSame = (label, deal, call, re) => {
  const s0 = snapshot(DB, deal.P, deal.R);
  const r = call();
  check(label, refused(r, re), r.out.slice(0, 240));
  const s1 = snapshot(DB, deal.P, deal.R);
  check('  … and the property, review, tenants, events and attestations are untouched', s0 === s1, s0 === s1 ? '' : 'state moved');
  return r;
};
const converts = (label, deal, uid) => {
  const r = acquire(DB, uid || A, deal.P, deal.R, deal.snap);
  const x = parse(r);
  check(label, r.ok && x.ok === true && x.property_id === deal.P
    && one(`select lifecycle_stage||'|'||(select status from public.acquisition_reviews where id='${deal.R}') from public.properties where id='${deal.P}';`, DB) === 'acquired|converted', r.out.slice(0, 240));
  return x;
};

// 1 · no lease on file, no acknowledgement
const DL = makeDeal(DB, A, 'Maple Plaza', { leaseholds: [{ key: 'luxe', label: 'Luxe Nails', doc: true }, { key: 'sun', label: 'Sunrise Cafe & Bakery LLC' }, { key: 'kiosk', label: 'Kiosk 4' }] });
let rr = refuseSame('1 · two leaseholds with no lease on file and no acknowledgement: refused', DL, () => acquire(DB, A, DL.P, DL.R, DL.snap), /no lease document on file and no acknowledgement/);
check('  … the refusal names both leaseholds and says the acknowledgement verifies no term', /“Kiosk 4”/.test(rr.out) && /“Sunrise Cafe & Bakery LLC”/.test(rr.out) && !/Luxe/.test(rr.out) && /does not verify any lease term/.test(rr.out), rr.out.slice(0, 300));
r = ack(DB, A, DL, 'sun');
check('  an acknowledgement for one of them is recorded', r.ok, r.out.slice(0, 200));
refuseSame('1 · one of two acknowledged: still refused, naming the other', DL, () => acquire(DB, A, DL.P, DL.R, DL.snap), /1 leasehold\(s\)[^]*Kiosk 4/);
// a document set aside or replaced does not count as the lease on file
const DS = makeDeal(DB, A, 'Set Aside', { leaseholds: [{ key: 'one', label: 'Tenant One', doc: true }] });
const dsDoc = one(`select id from public.acquisition_documents where review_id='${DS.R}';`, DB);
as(A, `update public.acquisition_reviews set data = data || jsonb_build_object('documentDispositions', jsonb_build_object('${dsDoc}', jsonb_build_object('action','duplicate'))) where id='${DS.R}';`, DB);
refuseSame('1 · a leasehold whose only document is set aside as a duplicate has no lease on file: refused', DS, () => acquire(DB, A, DS.P, DS.R, DS.snap), /no lease document on file/);
const DR = makeDeal(DB, A, 'Replaced', { leaseholds: [{ key: 'one', label: 'Tenant One', doc: true }] });
r = as(A, `insert into public.acquisition_documents(id,review_id,user_id,file_name,intake_id,doc_type,doc_type_status,doc_type_source,confirmed_by,confirmed_at)
             values ('00000000-0000-4000-8000-00000000d0c2','${DR.R}','${A}','other.pdf','ik-other','other','confirmed','human','${A}',now());
           update public.acquisition_documents set superseded_by_document_id='00000000-0000-4000-8000-00000000d0c2' where review_id='${DR.R}' and intake_id='ik-one';`, DB);
check('(setup) the leasehold\'s only lease is replaced by a newer upload', r.ok, r.out.slice(0, 200));
refuseSame('1 · a leasehold whose only document was replaced has no lease on file: refused', DR, () => acquire(DB, A, DR.P, DR.R, DR.snap), /no lease document on file/);

// 2 · each acknowledged
r = ack(DB, A, DL, 'kiosk');
check('2 · the second acknowledgement is recorded', r.ok, r.out.slice(0, 200));
const tenantsBefore = one(`select count(*) from public.acquisition_term_decisions where review_id='${DL.R}';`, DB);
converts('2 · every leasehold with no lease on file acknowledged: converts, on the SAME property id', DL);
check('  … tenants were written for all three leaseholds, with the leasehold ids', one(`select count(*) from public.tenants where property_id='${DL.P}' and id in ('${DL.F.luxe}','${DL.F.sun}','${DL.F.kiosk}');`, DB) === '3');

// 4 · an acknowledgement verifies nothing
check('4 · the acknowledgements say they verify nothing (verifies_terms false), stamped with the person and the time',
  one(`select string_agg(kind||'|'||verifies_terms::text||'|'||(acted_by='${A}')::text||'|'||(created_at is not null)::text, ',') from public.acquisition_conversion_attestations where review_id='${DL.R}';`, DB)
  === 'no_document_on_file|false|true|true,no_document_on_file|false|true|true');
check('4 · converting recorded no term decision — no term was confirmed, corrected or entered',
  one(`select count(*) from public.acquisition_term_decisions where review_id='${DL.R}';`, DB) === tenantsBefore);
check('4 · the tenants made from documentless leaseholds carry no lease term the roster did not give (no dates, no cap, no type)',
  one(`select string_agg(coalesce(start_date::text,'-')||coalesce(end_date::text,'-')||coalesce(cap::text,'-')||coalesce(lease_type,'-'), ',') from public.tenants where id in ('${DL.F.sun}','${DL.F.kiosk}');`, DB) === '----,----');
check('4 · nothing on the converted review calls a term verified', !/verif/i.test(one(`select data::text from public.acquisition_reviews where id='${DL.R}';`, DB)));
const DV = makeDeal(DB, A, 'Verify Claim', { leaseholds: [{ key: 'one', label: 'Tenant One' }] });
r = ack(DB, A, DV, 'one', { verifies_terms: 'true' });
check('4 · an acknowledgement that claims to verify the terms is refused by the table', refused(r, /acq_attestations_verifies_nothing/), r.out.slice(0, 200));
const DH = makeDeal(DB, A, 'Has Lease', { leaseholds: [{ key: 'one', label: 'Tenant One', doc: true }] });
r = ack(DB, A, DH, 'one');
check('4 · a leasehold WITH a lease on file cannot be "acknowledged" as missing one', refused(r, /has a lease document on file/), r.out.slice(0, 200));

// 3 · another review's or another leasehold's acknowledgement
const X1 = makeDeal(DB, A, 'Cross One', { leaseholds: [{ key: 'a', label: 'Alpha Tenant' }, { key: 'b', label: 'Beta Tenant' }] });
const X2 = makeDeal(DB, A, 'Cross Two', { leaseholds: [{ key: 'a', label: 'Alpha Tenant' }] });
check('3 · (setup) the other review\'s leasehold is acknowledged on the other review', ack(DB, A, X2, 'a').ok);
check('3 · (setup) a DIFFERENT leasehold of this review is acknowledged', ack(DB, A, X1, 'b').ok);
refuseSame('3 · an acknowledgement for another review\'s leasehold, and one for another leasehold of this review, do not count: refused', X1, () => acquire(DB, A, X1.P, X1.R, X1.snap), /1 leasehold\(s\)[^]*Alpha Tenant/);
r = as(A, `insert into public.acquisition_conversion_attestations(review_id,family_id,kind) values ('${X1.R}','${X2.F.a}','no_document_on_file');`, DB);
check('3 · an acknowledgement naming this review and ANOTHER review\'s leasehold cannot be filed', refused(r, /not one of review/), r.out.slice(0, 200));
r = as(A, `insert into public.acquisition_conversion_attestations(review_id,property_id,family_id,kind) values ('${X1.R}','${X2.P}','${X1.F.a}','no_document_on_file');`, DB);
check('3 · nor one placed under another property', refused(r), r.out.slice(0, 200));
r = ack(DB, A, X1, 'b');
check('3 · the same leasehold cannot be acknowledged twice', refused(r, /acq_attestations_one_ack_per_leasehold|duplicate key/), r.out.slice(0, 200));

// 5 · a material mismatch without a persisted reason
const MM = makeDeal(DB, A, 'Maple Plaza', { leaseholds: [{ key: 'sun', label: 'Sunrise Cafe & Bakery LLC', doc: true }, { key: 'luxe', label: 'Luxe Nails', doc: true }],
  raw: [SAFESHIELD, ELSEWHERE], res: { 'raw-ss': { action: 'matched', family: 'sun' }, 'raw-ew': { action: 'matched', family: 'luxe' } } });
rr = refuseSame('5 · SafeShield Security → Sunrise Cafe & Bakery with no reason recorded: refused', MM, () => acquire(DB, A, MM.P, MM.R, MM.snap), /material mismatch with no recorded reason/);
check('  … the refusal names the match; a lease naming another property (Lakeview Center) is a material mismatch too', /“SafeShield Security, LLC” → “Sunrise Cafe & Bakery LLC”/.test(rr.out) && /“Luxe Nails” → “Luxe Nails”/.test(rr.out) && /2 match/.test(rr.out), rr.out.slice(0, 300));
r = confirmMatch(DB, A, MM, 'raw-ss', 'sun', null);
check('5 · a confirmation of a material mismatch without a reason cannot be filed', refused(r, /reason is required/), r.out.slice(0, 200));
r = confirmMatch(DB, A, MM, 'raw-ss', 'sun', '    ');
check('5 · nor with a blank reason', refused(r, /reason is required/), r.out.slice(0, 200));
r = confirmMatch(DB, A, MM, 'raw-ss', 'luxe', 'wrong leasehold');
check('5 · (setup) a reasoned confirmation of the entry as ANOTHER leasehold is filed', r.ok, r.out.slice(0, 200));
r = confirmMatch(DB, A, MM, 'raw-ew', 'luxe', 'Luxe Nails also leases at Lakeview; this lease is the Maple Plaza store, per the broker.');
check('5 · (setup) the Lakeview match is confirmed with a reason', r.ok, r.out.slice(0, 200));
refuseSame('5 · the reason given for another leasehold does not carry SafeShield → Sunrise: refused', MM, () => acquire(DB, A, MM.P, MM.R, MM.snap), /1 match\(es\)[^]*SafeShield/);
r = confirmMatch(DB, A, MM, 'raw-zz', 'sun', 'no such row');
check('5 · a confirmation for an entry the review does not have cannot be filed', refused(r, /no extracted entry/), r.out.slice(0, 200));
// Two entries matched to ONE leasehold: a reason for one does not carry the other.
const TW = makeDeal(DB, A, 'Maple Plaza', { leaseholds: [{ key: 'sun', label: 'Sunrise Cafe & Bakery LLC', doc: true }],
  raw: [SAFESHIELD, { id: 'raw-ss2', tenant_name: 'Ironclad Alarm Co', _status: 'ok' }], res: { 'raw-ss': { action: 'matched', family: 'sun' }, 'raw-ss2': { action: 'matched', family: 'sun' } } });
check('(setup) one of the two entries is confirmed with a reason', confirmMatch(DB, A, TW, 'raw-ss', 'sun', 'guarantor of the Sunrise lease').ok);
refuseSame('5 · two entries matched to the same leasehold: the reason given for one does not carry the other: refused', TW, () => acquire(DB, A, TW.P, TW.R, TW.snap), /1 match\(es\)[^]*Ironclad/);
// A match confirmed while it was only uncertain, then the leasehold renamed so it is a mismatch.
const RN = makeDeal(DB, A, 'Maple Plaza', { leaseholds: [{ key: 'pw', label: 'Prime Wellness Spa', doc: true }], raw: [UNSURE_RAW], res: { 'raw-un': { action: 'matched', family: 'pw' } } });
r = confirmMatch(DB, A, RN, 'raw-un', 'pw', null);
check('(setup) an uncertain match is confirmed without a reason (allowed: not a material concern)', r.ok, r.out.slice(0, 200));
as(A, `update public.acquisition_document_families set label='Harbor Dental Group' where id='${RN.F.pw}';`, DB);
refuseSame('5 · the leasehold renamed afterwards makes it a material mismatch; the reasonless confirmation does not carry it: refused', RN, () => acquire(DB, A, RN.P, RN.R, RN.snap), /material mismatch[^]*Harbor Dental Group/);

// 6 · reasoned; genuine; uncertain
r = confirmMatch(DB, A, MM, 'raw-ss', 'sun', 'SafeShield Security is the guarantor named in the Sunrise sublease; confirmed with the seller.');
check('6 · the SafeShield → Sunrise match is confirmed with a reason', r.ok, r.out.slice(0, 200));
converts('6 · every material mismatch carries a person\'s reason: converts', MM);
check('  … the reason is kept, with the person and the time', one(`select count(*) from public.acquisition_conversion_attestations where review_id='${MM.R}' and kind='match_confirmed' and row_key='raw-ss' and reason like 'SafeShield Security is the guarantor%' and acted_by='${A}';`, DB) === '1');
const GM = makeDeal(DB, A, 'Maple Plaza', { leaseholds: [{ key: 'luxe', label: 'Luxe Nails', doc: true }, { key: 'mc', label: 'Maple Coffee Co.', doc: true }, { key: 'pw', label: 'Prime Wellness Spa', doc: true }],
  raw: [LUXE_RAW, COFFEE_RAW, UNSURE_RAW], res: { 'raw-lx': { action: 'matched', family: 'luxe' }, 'raw-mc': { action: 'matched', family: 'mc' }, 'raw-un': { action: 'matched', family: 'pw' } } });
converts('6 · LUXE NAILS, L.L.C. → Luxe Nails, Maple Coffee Co → Maple Coffee Co. and an uncertain Prime Wellness → Prime Wellness Spa convert with no attestation at all', GM);
check('  … and no attestation was needed or made', one(`select count(*) from public.acquisition_conversion_attestations where review_id='${GM.R}';`, DB) === '0');

// 7 · client-supplied flags
const CF = makeDeal(DB, A, 'Maple Plaza', { leaseholds: [{ key: 'sun', label: 'Sunrise Cafe & Bakery LLC' }, { key: 'luxe', label: 'Luxe Nails', doc: true }],
  raw: [SAFESHIELD], res: { 'raw-ss': { action: 'matched', family: 'sun', concerns: [], reason: 'trust me', confirmed: true } },
  data: { leaseholdAcknowledgements: {} } });
as(A, `update public.acquisition_reviews set data = jsonb_set(data, '{leaseholdAcknowledgements}', jsonb_build_object('${CF.F.sun}', jsonb_build_object('condition','no_document_on_file','verifiesTerms',false,'by','pm@example.com','at','2026-10-01T00:00:00Z'))) where id='${CF.R}';`, DB);
const flagged = Object.assign({}, CF.snap, { acknowledgements: { [CF.F.sun]: true }, skipSafeguards: true, concerns: [], confirmed: true, reason: 'trust me',
  roster: CF.roster.map(x => Object.assign({}, x, { acknowledged: true, _acknowledged: true, verifiesTerms: true, concerns: [] })) });
refuseSame('7 · p_snapshot flags, a leaseholdAcknowledgements map in review.data, and concerns: [] / reason on the resolution: all ignored, refused', CF,
  () => acquire(DB, A, CF.P, CF.R, flagged), /no lease document on file and no acknowledgement/);
check('(setup) the missing lease is acknowledged for real', ack(DB, A, CF, 'sun').ok);
refuseSame('7 · with the lease acknowledged, the resolution\'s own `concerns: []` and `reason` still do not carry the mismatch: refused', CF,
  () => acquire(DB, A, CF.P, CF.R, flagged), /material mismatch with no recorded reason/);
const DF = makeDeal(DB, A, 'Forged Stamp', { leaseholds: [{ key: 'one', label: 'Tenant One' }] });
r = as(A, `insert into public.acquisition_conversion_attestations(review_id,family_id,kind,acted_by,created_at) values ('${DF.R}','${DF.F.one}','no_document_on_file','${S}','2020-01-01T00:00:00Z');`, DB);
check('7 · a client-supplied acted_by and created_at are overwritten with the caller and now()', r.ok
  && one(`select (acted_by='${A}')::text||'|'||(created_at > now() - interval '5 minutes')::text from public.acquisition_conversion_attestations where review_id='${DF.R}';`, DB) === 'true|true', r.out.slice(0, 200));
r = as(A, `update public.acquisition_conversion_attestations set reason='edited' where review_id='${DF.R}';`, DB);
check('7 · an attestation cannot be edited (append-only; no UPDATE privilege)', refused(r), r.out.slice(0, 160));
r = as(A, `delete from public.acquisition_conversion_attestations where review_id='${DF.R}';`, DB);
check('7 · nor deleted', refused(r), r.out.slice(0, 160));
r = q(`delete from public.acquisition_conversion_attestations where review_id='${DF.R}';`, DB);
check('7 · not even by the table owner outside a cascade', refused(r, /append-only/), r.out.slice(0, 160));

// 8 · authorisation, freeze, idempotency, SAME property id
const AU = makeDeal(DB, A, 'Auth Deal', { leaseholds: [{ key: 'one', label: 'Tenant One' }] });
for (const [who, uid] of [['property_manager M', M], ['read_only R', R], ['stranger S (admin of another organisation)', S]]) {
  rr = refuseSame(`8 · ${who} is refused before learning anything about the gate`, AU, () => acquire(DB, uid, AU.P, AU.R, AU.snap), /administrator/);
  check('  … the refusal says nothing about leaseholds or acknowledgements', !/leasehold|acknowledg/i.test(rr.out.replace(/^.*?ERROR:\s*/s, '').split('\n')[0]), rr.out.slice(0, 200));
}
r = anon(`select public.acquire_property('${AU.P}'::uuid, '${AU.R}'::uuid, '{}'::jsonb);`, DB);
check('8 · anon is refused', refused(r), r.out.slice(0, 160));
const NOT_YOURS = /Only the owner of the property, or a member of its organisation who may edit it/;
const leaks = (r) => /Tenant One|leasehold|lease document|extracted entry|converted|does not exist|No acquisition review/i.test(r.out.split('\n')[0]);
r = as(S, `insert into public.acquisition_conversion_attestations(review_id,family_id,kind) values ('${AU.R}','${AU.F.one}','no_document_on_file');`, DB);
check('8 · a stranger cannot file an acknowledgement on someone else\'s acquisition, and learns nothing about it', refused(r, NOT_YOURS) && !leaks(r), r.out.slice(0, 160));
r = as(S, `insert into public.acquisition_conversion_attestations(review_id,family_id,kind) values ('00000000-0000-4000-8000-0000000000aa','${AU.F.one}','no_document_on_file');`, DB);
check('8 · an unknown review gets the same refusal (existence is not disclosed)', refused(r, NOT_YOURS) && !leaks(r), r.out.slice(0, 160));
r = as(R, `insert into public.acquisition_conversion_attestations(review_id,family_id,kind) values ('${AU.R}','${AU.F.one}','no_document_on_file');`, DB);
check('8 · a read_only member of the organisation cannot file one', refused(r, NOT_YOURS), r.out.slice(0, 160));
const AM = makeDeal(DB, A, 'Manager Ack', { leaseholds: [{ key: 'one', label: 'Tenant One' }] });
r = as(M, `insert into public.acquisition_conversion_attestations(review_id,family_id,kind) values ('${AM.R}','${AM.F.one}','no_document_on_file');`, DB);
check('8 · a property_manager of the organisation can, stamped as themself', r.ok && one(`select (acted_by='${M}')::text from public.acquisition_conversion_attestations where review_id='${AM.R}';`, DB) === 'true', r.out.slice(0, 160));
r = acquire(DB, M, AM.P, AM.R, AM.snap);
check('8 · … but converting still needs an administrator', refused(r, /administrator/), r.out.slice(0, 160));
converts('8 · the owner then converts it on the manager\'s acknowledgement', AM);
check('8 · nor read one', (() => { ack(DB, A, AU, 'one'); return one(`set local role authenticated; set local request.jwt.claim.sub='${S}'; select count(*) from public.acquisition_conversion_attestations where review_id='${AU.R}';`, DB) === '0'
  && one(`set local role authenticated; set local request.jwt.claim.sub='${A}'; select count(*) from public.acquisition_conversion_attestations where review_id='${AU.R}';`, DB) === '1'; })());
r = anon(`insert into public.acquisition_conversion_attestations(review_id,family_id,kind) values ('${AU.R}','${AU.F.one}','no_document_on_file');`, DB);
check('8 · anon cannot file one', refused(r), r.out.slice(0, 160));
r = q(`insert into public.acquisition_conversion_attestations(review_id,family_id,kind) values ('${AU.R}','${AU.F.one}','no_document_on_file');`, DB);
check('8 · an acknowledgement with no signed-in person behind it is refused', refused(r, /signed-in person/), r.out.slice(0, 160));
const propsBefore = one(`select count(*) from public.properties;`, DB);
converts('8 · the owner converts; the result is the SAME property id', AU);
check('8 · no properties row was created', one(`select count(*) from public.properties;`, DB) === propsBefore);
check('8 · exactly one stage_changed event', one(`select count(*) from public.property_events where property_id='${AU.P}' and action='stage_changed';`, DB) === '1');
r = acquire(DB, A, AU.P, AU.R, AU.snap);
check('8 · a second call is refused (idempotency)', refused(r, /not a prospect|already converted/), r.out.slice(0, 160));
r = ack(DB, A, AU, 'one');
check('8 · a converted (frozen) acquisition takes no acknowledgement', refused(r, /only an open acquisition|converted acquisition review/), r.out.slice(0, 160));
r = as(A, `insert into public.acquisition_conversion_attestations(review_id,family_id,kind,row_key,reason) values ('${MM.R}','${MM.F.sun}','match_confirmed','raw-ss','late');`, DB);
check('8 · nor a match confirmation', refused(r, /only an open acquisition|converted acquisition review/), r.out.slice(0, 160));
r = as(A, `delete from public.acquisition_reviews where id='${AU.R}';`, DB);
check('8 · the converted review (and its attestations) cannot be deleted (036)', refused(r) && one(`select count(*) from public.acquisition_conversion_attestations where review_id='${AU.R}';`, DB) === '1', r.out.slice(0, 160));
const DP = makeDeal(DB, A, 'Deleted Prospect', { leaseholds: [{ key: 'one', label: 'Tenant One' }] });
ack(DB, A, DP, 'one');
r = as(A, `select public.delete_prospect_acquisition('${DP.R}'::uuid);`, DB);
check('8 · a prospect deal with an acknowledgement can still be deleted; its attestations go with it (cascade)', r.ok
  && one(`select count(*) from public.acquisition_conversion_attestations where review_id='${DP.R}';`, DB) === '0'
  && one(`select count(*) from public.properties where id='${DP.P}';`, DB) === '0', r.out.slice(0, 200));

// 9 · legacy
const LG = makeDeal(DB, A, 'Maple Plaza', { leaseholds: [{ key: 'sun', label: 'Sunrise Cafe & Bakery LLC' }, { key: 'luxe', label: 'Luxe Nails', doc: true }],
  raw: [SAFESHIELD], res: { 'raw-ss': { action: 'matched', family: 'sun', by: 'pm@example.com', at: '2026-09-26T00:13:25Z' } } });
refuseSame('9 · a legacy review (resolutions and documents as the Pilot holds them, no attestation rows) is NOT grandfathered: refused', LG,
  () => acquire(DB, A, LG.P, LG.R, LG.snap), /no lease document on file and no acknowledgement/);
check('(setup) the legacy review\'s missing lease is acknowledged through the table', ack(DB, A, LG, 'sun').ok);
refuseSame('9 · its legacy mismatched match still needs a person\'s reason: refused', LG, () => acquire(DB, A, LG.P, LG.R, LG.snap), /material mismatch/);
check('9 · the gate wrote nothing to the legacy review on its own (no acknowledgement or reason invented)',
  one(`select count(*) from public.acquisition_conversion_attestations where review_id='${LG.R}';`, DB) === '1'
  && one(`select (data->'extractionResolutions'->'raw-ss') - 'familyId' = '{"by":"pm@example.com","at":"2026-09-26T00:13:25Z","action":"matched"}'::jsonb from public.acquisition_reviews where id='${LG.R}';`, DB) === 't');

// ── 4 · nothing else moved; rollback ─────────────────────────────────────────
section('4 · NOTHING ELSE MOVED · ROLLBACK');
check('every object outside 044\'s own is identical across the apply', inventory(DB) === before, 'inventory differs');
check('044 touches nothing XRPL, wallet, payment, settlement or billing related', !/rlusd|xrpl|xrp\b|wallet|ripple|settlement|payment|billing|stripe/i.test(strip(SQL)));
check('044 inserts no properties row and backfills no attestation', !/insert\s+into\s+public\.properties\b/i.test(strip(SQL)) && !/insert\s+into\s+public\.acquisition_conversion_attestations/i.test(strip(SQL)));
r = pg.psqlFile(R044, DB);
check('rollback applies', r.ok, r.out.slice(0, 300));
check('acquire_property is 035\'s definition again, byte for byte', fnmd5(DB) === md5_035);
check('044\'s table and functions are gone, and nothing else changed', one(`select count(*) from pg_proc where proname in (${OWN.slice(1).map(f => `'${f}'`).join(',')});`, DB) === '0'
  && one(`select to_regclass('public.acquisition_conversion_attestations') is null;`, DB) === 't' && inventory(DB) === before);
check('acquisitions already made stay made', one(`select lifecycle_stage from public.properties where id='${DL.P}';`, DB) === 'acquired');
r = pg.psqlFile(M044, DB);
check('044 applies again after the rollback', r.ok && fnmd5(DB) !== md5_035, r.out.slice(0, 300));

T.finish();
