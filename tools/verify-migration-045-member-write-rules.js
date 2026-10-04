'use strict';
/**
 * tools/verify-migration-045-member-write-rules.js — run 045 (members read,
 * editors write, conversion and authorship cannot be forged) for real, against
 * nothing that matters.
 *
 *   node tools/verify-migration-045-member-write-rules.js
 *   MS_PG_SERVER_BIN=/path/to/pg17/bin node tools/verify-migration-045-member-write-rules.js
 *
 * It touches NO Supabase project. It builds a throwaway PostgreSQL cluster
 * (PostgreSQL 16 by default; MS_PG_SERVER_BIN runs the same checks on another
 * server build, e.g. 17.6 as on Pilot), stands up verify-migration-036.js's
 * Pilot-shaped stand-ins (its SCHEMA, read from that file), the Pilot marker,
 * and installs 032–036, 044 and phase0/029 from their files.
 *
 * WHAT IT PROVES
 *   0  BEFORE 045 every gap is real: a read-only member updates and converts a
 *      review, updates and deletes a property; an editor files a family and a
 *      term decision in the owner's name and takes ownership of a property by
 *      saving it; a read-only member inserts ledger rows; TRUNCATE is granted
 *   1  045 applies, applies again, refuses a database without the Pilot marker,
 *      and changes only what it says it changes
 *   2  a read-only member (and a revoked one, an unaccepted one, a stranger,
 *      anon) still reads what it read, and every write is refused
 *   3  forged authorship of families, decisions and documents is refused —
 *      even for an editor the row rules let through
 *   4  a review is converted only by acquire_property; a direct update, by the
 *      owner or service_role, is refused; a converted review stays frozen
 *   5  properties: editors update and save without taking ownership; only the
 *      owner or an organisation admin deletes; read-only members do neither
 *   6  a document's stored-file path is set once
 *   7  ledger tables take no direct insert; TRUNCATE and anon grants are gone
 *   8  begin_acquisition, delete_prospect_acquisition and 033's lifecycle guard
 *      behave as before, for the people they served before
 *   9  ROLLBACK restores the catalog exactly — policies, grants, triggers,
 *      functions — and with it the old behaviour; 045 applies again
 *
 * SKIPS (exit 0) when no local PostgreSQL server binary is present, and says so
 * loudly — a skip is not a pass and must not read like one.
 */
const fs = require('fs');
const path = require('path');
const { startCluster, tally } = require('./_pg-throwaway');

const ROOT = path.join(__dirname, '..');
const MIG  = path.join(ROOT, 'migrations');
const FILES = ['032_resync_property_tenants_property_bound', '033_property_lifecycle_integrity', '034_property_at_new_acquisition',
               '035_acquire_property', '036_acquisition_episode_frozen', '044_acquisition_conversion_safeguards']
  .map(n => [n.slice(0, 3), path.join(MIG, n + '.sql')]);
const M029 = path.join(MIG, 'phase0', '029_financial_tables.sql');
const M045 = path.join(MIG, '045_acquisition_member_write_rules.sql');
const R045 = path.join(MIG, '045_acquisition_member_write_rules_rollback.sql');
const MARKER = 'fd9c09b1-b657-4c58-9999-c3cce28e7600';

const T = tally();
const { check, section } = T;

console.log('\n══ migration 045 (member write rules) — executed against a throwaway cluster ══');
console.log('   NO Supabase project is contacted by this script.');
const pg = startCluster('045w');
console.log('   server: ' + pg.serverVersion() + '  (' + pg.SERVER_BIN + ')');

// ── people (verify-migration-036.js's, plus a revoked and an unaccepted member)
const A = '11111111-1111-4111-8111-111111111111';   // owner of the deals, admin of O1
const M = '33333333-3333-4333-8333-333333333333';   // property_manager in O1 — an editor
const D = '55555555-5555-4555-8555-555555555555';   // admin of O1 who owns nothing
const R = '44444444-4444-4444-8444-444444444444';   // read_only in O1
const S = '22222222-2222-4222-8222-222222222222';   // stranger, admin of O2
const Z = '66666666-6666-4666-8666-666666666666';   // admin of O3 (owns the marker)
const V = '77777777-7777-4777-8777-777777777777';   // property_manager in O1, revoked
const U = '88888888-8888-4888-8888-888888888888';   // property_manager in O1, never accepted
const N = '99999999-9999-4999-8999-999999999999';   // a brand-new user: no organisation at all
const O1 = 'c1c1c1c1-0000-4000-8000-000000000001', O2 = 'c2c2c2c2-0000-4000-8000-000000000002', O3 = 'c3c3c3c3-0000-4000-8000-000000000003';

const V036 = fs.readFileSync(path.join(__dirname, 'verify-migration-036.js'), 'utf8');
const SCHEMA = (() => {
  const a = V036.indexOf('const SCHEMA = `') + 'const SCHEMA = `'.length;
  const b = V036.indexOf('`;\n\nconst q =', a);
  if (a < 20 || b < a) throw new Error('could not read SCHEMA from verify-migration-036.js');
  // eslint-disable-next-line no-new-func
  return new Function('A', 'M', 'D', 'R', 'S', 'Z', 'O1', 'O2', 'O3', 'return `' + V036.slice(a, b) + '`;')(A, M, D, R, S, Z, O1, O2, O3);
})();
const EXTRA = `
  insert into auth.users(id) values ('${V}'),('${U}'),('${N}');
  insert into public.organization_members(organization_id,user_id,role,accepted_at,revoked_at) values
    ('${O1}','${V}','property_manager',now(),now()),('${O1}','${U}','property_manager',null,null);
  insert into public.properties(id,user_id,name) values ('${MARKER}','${Z}','Pilot marker (stand-in)');
  create table public.lease_documents (id uuid primary key default gen_random_uuid(), property_id uuid references public.properties(id) on delete cascade);`;

const DB = 'pilotlike';
const q = (sql, db) => pg.psql(sql, db || DB);
const one = (sql, db) => q(sql, db).out;
const as = (uid, sql, db) => pg.as('authenticated', uid, sql, db || DB);
const svc = (sql, db) => pg.as('service_role', null, sql, db || DB);
const anon = (sql, db) => pg.as('anon', null, sql, db || DB);
const s = (v) => v == null ? 'null' : "'" + String(v).replace(/'/g, "''") + "'";
const lit = (v) => JSON.stringify(v).replace(/'/g, "''");
const parse = (r) => { try { return JSON.parse(r.out); } catch (_) { return { _raw: r.out }; } };
const short = (t) => String(t || '').replace(/\s+/g, ' ').replace(/.*?ERROR:\s*/, '').slice(0, 150);
/** A write landed: no error, and RETURNING gave a row. */
const wrote   = (r) => r.ok && r.out.trim() !== '';
/** A write did not land: refused outright, or the row rules matched nothing. */
const blocked = (r) => !r.ok || r.out.trim() === '';
const denied  = (r) => !r.ok && /permission denied/i.test(r.out);

const rpcBegin = (uid, name, org) => parse(as(uid, `select public.begin_acquisition(${s(name)}, '${lit({ totalSqFt: '1000' })}'::jsonb${org ? `, '${org}'::uuid` : ''});`));
function deal(uid, name, org) {
  const d = rpcBegin(uid, name, org);
  if (!d.property_id) throw new Error('begin_acquisition: ' + JSON.stringify(d));
  return { P: d.property_id, R: d.review_id };
}
/** A leasehold with its lease on file — enough for acquire_property to convert (044). */
function fileLeasehold(uid, dl, key, label, light) {
  const F = one(`select gen_random_uuid();`);
  let r = as(uid, `insert into public.acquisition_document_families(id,review_id,user_id,label) values ('${F}','${dl.R}','${uid}',${s(label)}) returning id;`);
  if (!wrote(r)) throw new Error('family: ' + r.out);
  r = light
    ? as(uid, `insert into public.acquisition_documents(review_id,user_id,file_name,intake_id,family_id,family_status,doc_type,doc_type_status,doc_type_source,storage_path)
               values ('${dl.R}','${uid}',${s(key + '.pdf')},${s('ik-' + key)},'${F}','proposed','original_lease','proposed','ai',${s('leases/' + uid + '/acq_' + dl.R + '_' + key + '.pdf')}) returning id;`)
    : as(uid, `insert into public.acquisition_documents(review_id,user_id,file_name,intake_id,family_id,family_status,doc_type,doc_type_status,doc_type_source,confirmed_by,confirmed_at,storage_path)
               values ('${dl.R}','${uid}',${s(key + '.pdf')},${s('ik-' + key)},'${F}','confirmed','original_lease','confirmed','human','${uid}',now(),${s('leases/' + uid + '/acq_' + dl.R + '_' + key + '.pdf')}) returning id;`);
  if (!wrote(r)) throw new Error('document: ' + r.out);
  const doc = r.out.trim();
  if (light) return { F, doc, roster: [] };
  r = as(uid, `insert into public.acquisition_term_decisions(review_id,user_id,family_id,field_key,action,new_value,decided_by) values ('${dl.R}','${uid}','${F}','leased_sqft','confirm','500','${uid}') returning id;`);
  if (!wrote(r)) throw new Error('decision: ' + r.out);
  return { F, doc, roster: [{ id: F, family_id: F, property_id: dl.P, review_id: dl.R, tenant_name: label, leased_sqft: '500', cap: null, start_date: null, end_date: null, lease_type: null }] };
}
const acquire = (uid, dl, lh, name) => as(uid, `select public.acquire_property('${dl.P}'::uuid, '${dl.R}'::uuid, '${lit({ roster: lh.roster, propertyName: name, occupancyAtAcquisition: 100, waltAtAcquisition: 0 })}'::jsonb);`);
const ownProperty = (uid, name) => { const r = as(uid, `insert into public.properties(user_id,name) values ('${uid}',${s(name)}) returning id;`); if (!wrote(r)) throw new Error('property: ' + r.out); return r.out.trim(); };
// The real saveProperty shape (script.js): an upsert carrying user_id = the person saving.
const saveProperty = (uid, id, name) => as(uid, `insert into public.properties(id,name,sqft,data,user_id) values ('${id}',${s(name)},1000,'{}'::jsonb,'${uid}')
  on conflict (id) do update set name = excluded.name, sqft = excluded.sqft, data = excluded.data, user_id = excluded.user_id returning id;`);

const inventory = (db) => q(`
  select string_agg(x, E'\\n' order by x) from (
    select 'con|'||conrelid::regclass::text||'|'||conname||'|'||pg_get_constraintdef(oid) as x from pg_constraint where connamespace='public'::regnamespace
    union all select 'trg|'||t.tgrelid::regclass::text||'|'||t.tgname||'|'||pg_get_triggerdef(t.oid) from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relnamespace='public'::regnamespace and not t.tgisinternal
    union all select 'fn|'||p.oid::regprocedure::text||'|'||md5(pg_get_functiondef(p.oid))||'|'||coalesce(array_to_string(p.proacl,','),'') from pg_proc p where p.pronamespace='public'::regnamespace and p.prokind='f'
    union all select 'col|'||table_name||'|'||column_name||'|'||data_type||'|'||is_nullable||'|'||coalesce(column_default,'') from information_schema.columns where table_schema='public'
    union all select 'idx|'||indexname||'|'||indexdef from pg_indexes where schemaname='public'
    union all select 'pol|'||tablename||'|'||policyname||'|'||cmd||'|'||permissive||'|'||array_to_string(roles,',')||'|'||coalesce(qual,'')||'|'||coalesce(with_check,'') from pg_policies where schemaname='public'
    union all select 'pri|'||table_name||'|'||grantee||'|'||string_agg(privilege_type, ',' order by privilege_type) from information_schema.role_table_grants where table_schema='public' group by table_name, grantee
    union all select 'rls|'||relname||'|'||relrowsecurity::text||'|'||relforcerowsecurity::text from pg_class where relnamespace='public'::regnamespace and relkind='r'
  ) s;`, db).out.split('\n');

// ── build ────────────────────────────────────────────────────────────────────
let r = pg.database(DB, 'legacy');
for (const part of [SCHEMA, EXTRA]) if (r.ok) r = q(part);
for (const [n, f] of FILES) if (r.ok) { r = pg.psqlFile(f, DB); if (!r.ok) r.out = n + ': ' + r.out; }
if (r.ok) r = pg.psqlFile(M029, DB);
check('pilotlike: 036\'s stand-ins, the Pilot marker, 032–036, 044 and phase0/029 installed from their files (Pilot\'s legacy default privileges)', r.ok, r.ok ? '' : short(r.out));
if (!r.ok) T.finish();
check('the stand-in matches Pilot\'s live grants (read 2026-10-03): authenticated may TRUNCATE reviews, documents and properties; anon holds all on properties',
  /TRUNCATE/.test(pg.privs('public.acquisition_reviews', 'authenticated', DB)) && /TRUNCATE/.test(pg.privs('public.acquisition_documents', 'authenticated', DB))
  && /TRUNCATE/.test(pg.privs('public.properties', 'authenticated', DB)) && pg.privs('public.properties', 'anon', DB) === 'DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE');

// ── 0 · the gaps ─────────────────────────────────────────────────────────────
section('0 · BEFORE 045 — every gap is real');
{
  const G = deal(A, 'ZZ Gap Deal');
  const gl = fileLeasehold(A, G, 'gap', 'Gap Tenant');
  check('before: a read-only member renames an acquisition review', wrote(as(R, `update public.acquisition_reviews set name='renamed by read-only' where id='${G.R}' returning id;`)));
  check('before: an editor files a family in the owner\'s name', wrote(as(M, `insert into public.acquisition_document_families(review_id,user_id,label) values ('${G.R}','${A}','forged family') returning id;`)));
  check('before: an editor records a term decision in the owner\'s name', wrote(as(M, `insert into public.acquisition_term_decisions(review_id,user_id,family_id,field_key,action,new_value,decided_by) values ('${G.R}','${A}','${gl.F}','cap','correct','9','${A}') returning id;`)));
  check('before: a read-only member re-points a document\'s stored file', wrote(as(R, `update public.acquisition_documents set storage_path='leases/elsewhere.pdf' where id='${gl.doc}' returning id;`)));
  const gp = ownProperty(A, 'ZZ Gap Property');
  check('before: a read-only member renames a property', wrote(as(R, `update public.properties set name='renamed by read-only' where id='${gp}' returning id;`)));
  check('before: an editor\'s save of the owner\'s property makes the editor its owner', wrote(saveProperty(M, gp, 'saved by editor')) && one(`select user_id from public.properties where id='${gp}';`) === M);
  check('before: a read-only member deletes a property', wrote(as(R, `delete from public.properties where id='${gp}' returning id;`)));
  check('before: a read-only member inserts a ledger line', wrote(as(R, `insert into public.gl_entries(property_id,account_code,debit,amount,row_hash) values ('${G.P}','9999',1,1,'gap') returning id;`)));
  check('before: a read-only member marks the review converted with a direct update', wrote(as(R, `update public.acquisition_reviews set status='converted', converted_at=now() where id='${G.R}' returning id;`)));
}
const before = inventory(DB);
const rowCounts = () => one(`select (select count(*) from public.acquisition_reviews)||'|'||(select count(*) from public.acquisition_documents)||'|'||(select count(*) from public.acquisition_document_families)||'|'||(select count(*) from public.acquisition_term_decisions)||'|'||(select count(*) from public.properties)||'|'||(select md5(string_agg(to_jsonb(p)::text, ',' order by id)) from public.properties p)||'|'||(select md5(string_agg(to_jsonb(r)::text, ',' order by id)) from public.acquisition_reviews r);`);
const rowsBefore = rowCounts();

// ── 1 · apply ────────────────────────────────────────────────────────────────
section('1 · 045 applies, applies again, and changes only what it says');
r = pg.database('notpilot', 'legacy');
q(`create table public.properties (id uuid primary key);`, 'notpilot');
r = pg.psqlFile(M045, 'notpilot');
check('a database without the Pilot marker is refused before anything changes', !r.ok && /REFUSING TO RUN: pilot marker property not found/.test(r.out)
  && one(`select count(*) from pg_proc where proname='can_edit_property';`, 'notpilot') === '0', short(r.out));
r = pg.psqlFile(M045, DB);
check('045 applies', r.ok, short(r.out));
r = pg.psqlFile(M045, DB);
check('045 applies a second time without error', r.ok, short(r.out));
const after = inventory(DB);
const removed = before.filter(x => !after.includes(x));
const added = after.filter(x => !before.includes(x));
const REPLACED = /^pol\|(acquisition_reviews\|acq_reviews_member_all|acquisition_documents\|acq_docs_member_all|acquisition_document_families\|acq_doc_families_member_all|acquisition_term_decisions\|acq_term_decisions_member_all|properties\|properties_owner_all|financial_sources\|financial_sources_member_insert|gl_entries\|gl_entries_member_insert)\||^pri\|(acquisition_reviews|acquisition_documents|properties|financial_sources|gl_entries)\|(authenticated|anon)\|/;
check(`only the policies and grants 045 replaces are gone (${removed.length})`, removed.length > 0 && removed.every(x => REPLACED.test(x)), removed.filter(x => !REPLACED.test(x)).slice(0, 3).join(' ; '));
const OWN = /can_edit_property|is_active_editor_of_org|acq_reviews_conversion_guard|acq_children_author_guard|acq_documents_storage_path_guard|properties_identity_guard|_author_guard|_member_select|_editor_insert|_editor_update|_editor_delete|_admin_delete|^pri\|(acquisition_reviews|acquisition_documents|properties|financial_sources|gl_entries)\|authenticated\|/;
check(`everything added is 045's own (${added.length})`, added.length > 0 && added.every(x => OWN.test(x)), added.filter(x => !OWN.test(x)).slice(0, 3).join(' ; '));
check('no row changed: reviews, documents, leaseholds, decisions and properties are byte-identical', rowCounts() === rowsBefore);
check('helpers: SECURITY DEFINER, empty search_path; authenticated may execute, anon and PUBLIC may not',
  ['can_edit_property(uuid)', 'is_active_editor_of_org(uuid)'].every(f =>
    one(`select prosecdef::text||'|'||array_to_string(proconfig,',') from pg_proc where oid='public.${f}'::regprocedure;`) === 'true|search_path=""'
    && pg.canExecute('authenticated', 'public.' + f, DB) && !pg.canExecute('anon', 'public.' + f, DB)
    && one(`select has_function_privilege(0, 'public.${f}', 'execute');`) === 'f'));
check('authenticated: no TRUNCATE on reviews, documents or properties; everything else as before',
  pg.privs('public.acquisition_reviews', 'authenticated', DB) === 'DELETE,INSERT,REFERENCES,SELECT,TRIGGER,UPDATE'
  && pg.privs('public.acquisition_documents', 'authenticated', DB) === 'DELETE,INSERT,REFERENCES,SELECT,TRIGGER,UPDATE'
  && pg.privs('public.properties', 'authenticated', DB) === 'DELETE,INSERT,REFERENCES,SELECT,TRIGGER,UPDATE');
check('anon: nothing on properties (nor on the acquisition or ledger tables)', ['properties', 'acquisition_reviews', 'acquisition_documents', 'acquisition_document_families', 'acquisition_term_decisions', 'financial_sources', 'gl_entries']
  .every(t => pg.privs('public.' + t, 'anon', DB) === ''));
check('ledger tables: authenticated may only SELECT; service_role keeps everything',
  pg.privs('public.financial_sources', 'authenticated', DB) === 'SELECT' && pg.privs('public.gl_entries', 'authenticated', DB) === 'SELECT'
  && /INSERT/.test(pg.privs('public.gl_entries', 'service_role', DB)));

// The rules themselves, exactly: some are a second layer behind the author
// guard and the review keys, so no behaviour test alone can tell them apart.
const pol = (t, n) => one(`select cmd||' | '||coalesce(qual,'-')||' | '||coalesce(with_check,'-') from pg_policies where schemaname='public' and tablename='${t}' and policyname='${n}';`);
const MEMBER = '(property_id IN ( SELECT member_property_ids() AS member_property_ids))';
const EDIT = 'can_edit_property(property_id)';
const EXPECT = [
  ['acquisition_reviews', 'acq_reviews_member_select', `SELECT | (${MEMBER} OR ((property_id IS NULL) AND (user_id = auth.uid()))) | -`],
  ['acquisition_reviews', 'acq_reviews_editor_insert', `INSERT | - | (${EDIT} OR ((property_id IS NULL) AND (user_id = auth.uid())))`],
  ['acquisition_reviews', 'acq_reviews_editor_update', `UPDATE | (${EDIT} OR ((property_id IS NULL) AND (user_id = auth.uid()))) | (${EDIT} OR ((property_id IS NULL) AND (user_id = auth.uid())))`],
  ['acquisition_reviews', 'acq_reviews_admin_delete',  `DELETE | (is_property_admin(property_id) OR ((property_id IS NULL) AND (user_id = auth.uid()))) | -`],
  ['acquisition_documents', 'acq_docs_member_select', `SELECT | ${MEMBER} | -`],
  ['acquisition_documents', 'acq_docs_editor_insert', `INSERT | - | ${EDIT}`],
  ['acquisition_documents', 'acq_docs_editor_update', `UPDATE | ${EDIT} | ${EDIT}`],
  ['acquisition_documents', 'acq_docs_editor_delete', `DELETE | ${EDIT} | -`],
  ['acquisition_document_families', 'acq_doc_families_member_select', `SELECT | ${MEMBER} | -`],
  ['acquisition_document_families', 'acq_doc_families_editor_insert', `INSERT | - | ${EDIT}`],
  ['acquisition_document_families', 'acq_doc_families_editor_update', `UPDATE | ${EDIT} | ${EDIT}`],
  ['acquisition_term_decisions', 'acq_term_decisions_member_select', `SELECT | ${MEMBER} | -`],
  ['acquisition_term_decisions', 'acq_term_decisions_editor_insert', `INSERT | - | ${EDIT}`],
  ['properties', 'properties_member_select', 'SELECT | ((user_id = auth.uid()) OR ((organization_id IS NOT NULL) AND is_active_member_of_org(organization_id))) | -'],
  ['properties', 'properties_editor_insert', 'INSERT | - | ((user_id = auth.uid()) AND ((organization_id IS NULL) OR is_active_editor_of_org(organization_id)))'],
  ['properties', 'properties_editor_update', 'UPDATE | ((user_id = auth.uid()) OR ((organization_id IS NOT NULL) AND is_active_editor_of_org(organization_id))) | ((user_id = auth.uid()) OR ((organization_id IS NOT NULL) AND is_active_editor_of_org(organization_id)))'],
  ['properties', 'properties_admin_delete', 'DELETE | is_property_admin(id) | -'],
];
for (const [t, n, want] of EXPECT) check(`rule ${t}.${n} is exactly: ${want.split(' | ')[0]} for ${/admin/.test(n) ? 'owner or admin' : /editor/.test(n) ? 'editors' : 'members'}`, pol(t, n) === want, pol(t, n));
check('no other rule for signed-in users remains on those tables', one(`select count(*) from pg_policies where schemaname='public' and 'authenticated' = any(roles) and tablename in ('acquisition_reviews','acquisition_documents','acquisition_document_families','acquisition_term_decisions','properties');`) === String(EXPECT.length));

// The working deal every later section uses.
const W = deal(A, 'ZZ Working Deal');
const wl = fileLeasehold(A, W, 'work', 'Working Tenant');
check('the owner still starts a deal and files a leasehold, its lease and a decision (begin_acquisition, then direct writes)', !!W.R && !!wl.doc);

// ── 2 · read-only and outsiders ──────────────────────────────────────────────
section('2 · READ-ONLY and outsiders: reads stay, writes are refused');
const sees = (uid) => as(uid, `select (select count(*) from public.acquisition_reviews where id='${W.R}')||'|'||(select count(*) from public.acquisition_documents where review_id='${W.R}')||'|'||(select count(*) from public.acquisition_document_families where review_id='${W.R}')||'|'||(select count(*) from public.acquisition_term_decisions where review_id='${W.R}')||'|'||(select count(*) from public.properties where id='${W.P}');`).out;
check('a read-only member still reads the review, its document, leasehold, decision and the property', sees(R) === '1|1|1|1|1', sees(R));
check('an editor reads them too', sees(M) === '1|1|1|1|1');
for (const [who, uid] of [['a stranger', S], ['a revoked member', V], ['an unaccepted member', U]]) check(`${who} reads none of it`, sees(uid) === '0|0|0|0|0', sees(uid));
check('anon reads nothing (refused outright)', denied(anon(`select count(*) from public.acquisition_reviews;`)) && denied(anon(`select count(*) from public.properties;`)));
const snapW = () => one(`select r.name||'|'||r.status||'|'||md5(r.data::text)||'|'||(select string_agg(d.id||':'||coalesce(d.doc_type,'')||':'||coalesce(d.storage_path,''), ',' order by d.id) from public.acquisition_documents d where d.review_id=r.id)||'|'||(select count(*) from public.acquisition_document_families where review_id=r.id)||'|'||(select count(*) from public.acquisition_term_decisions where review_id=r.id)||'|'||(select name||'/'||user_id from public.properties where id=r.property_id) from public.acquisition_reviews r where r.id='${W.R}';`);
const w0 = snapW();
const RO_WRITES = [
  ['rename the review',                       `update public.acquisition_reviews set name='x' where id='${W.R}' returning id;`],
  ['change the review\'s data',               `update public.acquisition_reviews set data=data||'{"x":1}' where id='${W.R}' returning id;`],
  ['move the review to complete',             `update public.acquisition_reviews set status='complete' where id='${W.R}' returning id;`],
  ['mark the review converted',               `update public.acquisition_reviews set status='converted', converted_at=now() where id='${W.R}' returning id;`],
  ['delete the review',                       `delete from public.acquisition_reviews where id='${W.R}' returning id;`],
  ['re-type a document',                      `update public.acquisition_documents set doc_type='amendment' where id='${wl.doc}' returning id;`],
  ['re-point a document\'s stored file',      `update public.acquisition_documents set storage_path='leases/elsewhere.pdf' where id='${wl.doc}' returning id;`],
  ['delete a document',                       `delete from public.acquisition_documents where id='${wl.doc}' returning id;`],
  ['file a document (in the owner\'s name)',  `insert into public.acquisition_documents(review_id,user_id,file_name,intake_id) values ('${W.R}','${A}','ro.pdf','ik-ro') returning id;`],
  ['file a leasehold (in the owner\'s name)', `insert into public.acquisition_document_families(review_id,user_id,label) values ('${W.R}','${A}','ro family') returning id;`],
  ['rename a leasehold',                      `update public.acquisition_document_families set label='ro' where id='${wl.F}' returning id;`],
  ['record a term decision (owner\'s name)',  `insert into public.acquisition_term_decisions(review_id,user_id,family_id,field_key,action,new_value,decided_by) values ('${W.R}','${A}','${wl.F}','cap','correct','7','${A}') returning id;`],
  ['acknowledge a leasehold (044)',           `insert into public.acquisition_conversion_attestations(review_id,family_id,kind) values ('${W.R}','${wl.F}','no_document_on_file') returning id;`],
  ['rename the property',                     `update public.properties set name='x' where id='${W.P}' returning id;`],
  ['archive the property',                    `update public.properties set archived_at=now() where id='${W.P}' returning id;`],
  ['delete the property',                     `delete from public.properties where id='${W.P}' returning id;`],
  ['create a property in the organisation',   `insert into public.properties(user_id,organization_id,name) values ('${R}','${O1}','ro property') returning id;`],
  ['insert a ledger source',                  `insert into public.financial_sources(property_id,kind) values ('${W.P}','general_ledger') returning id;`],
  ['insert a ledger line',                    `insert into public.gl_entries(property_id,account_code,debit,amount,row_hash) values ('${W.P}','9999',1,1,'ro') returning id;`],
];
for (const [what, sql] of RO_WRITES) {
  const res = as(R, sql);
  check(`read-only member cannot ${what}`, blocked(res), res.ok ? '(no row matched)' : short(res.out));
}
for (const [who, uid] of [['stranger', S], ['revoked member', V], ['unaccepted member', U]]) {
  check(`a ${who} cannot rename the review, re-type a document, file a leasehold or rename the property`,
    blocked(as(uid, RO_WRITES[0][1])) && blocked(as(uid, RO_WRITES[5][1])) && blocked(as(uid, RO_WRITES[9][1])) && blocked(as(uid, RO_WRITES[13][1])));
}
// Unfiltered writes (no WHERE, no RETURNING) are not limited by the SELECT rules,
// so only the write rules stand between them and every row.
const digest = () => one(`select md5(coalesce((select string_agg(to_jsonb(x)::text, ',' order by id) from public.acquisition_reviews x),'')||coalesce((select string_agg(to_jsonb(x)::text, ',' order by id) from public.acquisition_documents x),'')||coalesce((select string_agg(to_jsonb(x)::text, ',' order by id) from public.acquisition_document_families x),'')||coalesce((select string_agg(to_jsonb(x)::text, ',' order by id) from public.properties x),''));`);
const d0 = digest();
for (const [who, uid] of [['read-only member', R], ['revoked member', V], ['unaccepted member', U], ['stranger', S]]) {
  for (const sql of [`update public.acquisition_reviews set name='unfiltered';`, `update public.acquisition_documents set doc_type='other';`, `update public.acquisition_document_families set label='unfiltered';`,
                     `update public.properties set name='unfiltered';`, `delete from public.acquisition_documents;`, `delete from public.acquisition_reviews;`, `delete from public.properties;`]) as(uid, sql);
}
check('unfiltered updates and deletes by a read-only, revoked, unaccepted or stranger member change nothing anywhere', digest() === d0);
check('anon cannot write any of it (refused outright)', denied(anon(`update public.properties set name='x' where id='${W.P}';`)) && denied(anon(`delete from public.acquisition_documents;`)));
check('…and none of those attempts changed anything', snapW() === w0, snapW());
check('a read-only member still creates a property of their own (outside the organisation they only read)', wrote(as(R, `insert into public.properties(user_id,name) values ('${R}','ZZ my own') returning id;`)));

// ── 3 · authorship ───────────────────────────────────────────────────────────
section('3 · AUTHORSHIP — a record names the person who wrote it');
let x = as(M, `insert into public.acquisition_document_families(review_id,user_id,label) values ('${W.R}','${A}','forged by editor') returning id;`);
check('an editor (whom the row rules admit) cannot file a family in the owner\'s name', !x.ok && /recorded by the signed-in person/.test(x.out), short(x.out));
x = as(M, `insert into public.acquisition_term_decisions(review_id,user_id,family_id,field_key,action,new_value,decided_by) values ('${W.R}','${A}','${wl.F}','cap','correct','9','${A}') returning id;`);
check('an editor cannot record a term decision in the owner\'s name (user_id = decided_by = owner)', !x.ok && /recorded by the signed-in person/.test(x.out), short(x.out));
x = as(M, `insert into public.acquisition_documents(review_id,user_id,file_name,intake_id) values ('${W.R}','${A}','forged.pdf','ik-forged') returning id;`);
check('an editor cannot file a document in the owner\'s name', !x.ok && /recorded by the signed-in person/.test(x.out), short(x.out));
x = as(M, `insert into public.acquisition_document_families(review_id,user_id,label) values ('${W.R}','${M}','own name') returning id;`);
check('…and in their own name it is refused by the review key, as before (children belong to the review\'s owner)', !x.ok && /foreign key|violates/.test(x.out), short(x.out));
x = as(A, `insert into public.acquisition_term_decisions(review_id,user_id,family_id,field_key,action,new_value,decided_by) values ('${W.R}','${A}','${wl.F}','cap','correct','9','${M}') returning id;`);
check('a decision naming someone else as decided_by is refused', !x.ok, short(x.out));
check('the owner records a family, a document and a decision in their own name', wrote(as(A, `insert into public.acquisition_document_families(review_id,user_id,label) values ('${W.R}','${A}','owner family') returning id;`))
  && wrote(as(A, `insert into public.acquisition_documents(review_id,user_id,file_name,intake_id) values ('${W.R}','${A}','owner.pdf','ik-owner') returning id;`))
  && wrote(as(A, `insert into public.acquisition_term_decisions(review_id,user_id,family_id,field_key,action,new_value,decided_by) values ('${W.R}','${A}','${wl.F}','cap','correct','5','${A}') returning id;`)));
x = as(A, `update public.acquisition_reviews set user_id='${M}' where id='${W.R}' returning id;`);
check('a review\'s author does not change', !x.ok && /user_id does not change/.test(x.out), short(x.out));
check('service_role (no person) still writes as before: a family for the owner', wrote(svc(`insert into public.acquisition_document_families(review_id,user_id,label) values ('${W.R}','${A}','server family') returning id;`)));

// ── 4 · conversion ───────────────────────────────────────────────────────────
section('4 · CONVERSION — only acquire_property converts');
for (const [who, run] of [['the owner', (sql) => as(A, sql)], ['an editor', (sql) => as(M, sql)], ['service_role', svc]]) {
  x = run(`update public.acquisition_reviews set status='converted', converted_at=now() where id='${W.R}' returning id;`);
  check(`${who} cannot mark a review converted with a direct update`, !x.ok && /converted only by acquire_property/.test(x.out), short(x.out));
}
x = as(A, `update public.acquisition_reviews set converted_at=now() where id='${W.R}' returning id;`);
check('nor stamp converted_at on an open review', !x.ok && /converted only by acquire_property/.test(x.out), short(x.out));
check('an editor still moves the review between open states (complete, then draft)', wrote(as(M, `update public.acquisition_reviews set status='complete' where id='${W.R}' returning id;`))
  && wrote(as(M, `update public.acquisition_reviews set status='draft', data=data||'{"note":"editor"}' where id='${W.R}' returning id;`)));
check('an editor cannot delete the owner\'s review (filtered or not)', blocked(as(M, `delete from public.acquisition_reviews where id='${W.R}' returning id;`))
  && (as(M, `delete from public.acquisition_reviews;`), one(`select count(*) from public.acquisition_reviews where id='${W.R}';`) === '1'));
const K1 = deal(A, 'ZZ Review deleted by admin'), K2 = deal(A, 'ZZ Review deleted by owner');
check('an organisation admin deletes a review; the owner deletes their own', wrote(as(D, `delete from public.acquisition_reviews where id='${K1.R}' returning id;`))
  && wrote(as(A, `delete from public.acquisition_reviews where id='${K2.R}' returning id;`)));
const C = deal(A, 'ZZ Convert Deal');
const cl = fileLeasehold(A, C, 'conv', 'Convert Tenant');
x = acquire(A, C, cl, 'ZZ Convert Deal');
check('acquire_property, as the owner, converts: review converted with converted_at, the same property acquired',
  x.ok && parse(x).ok === true && one(`select r.status||'|'||(r.converted_at is not null)::text||'|'||p.lifecycle_stage from public.acquisition_reviews r join public.properties p on p.id=r.property_id where r.id='${C.R}';`) === 'converted|true|acquired', short(x.out));
x = as(A, `update public.acquisition_reviews set data=data||'{"x":1}' where id='${C.R}' returning id;`);
check('the converted review stays frozen (036)', !x.ok && /read-only/.test(x.out), short(x.out));
x = as(A, `delete from public.acquisition_reviews where id='${C.R}' returning id;`);
check('…and cannot be deleted (036)', !x.ok, short(x.out));

// ── 5 · properties ───────────────────────────────────────────────────────────
section('5 · PROPERTIES — editors edit, owners and admins delete, nobody takes ownership');
const P1 = ownProperty(A, 'ZZ Operating Property');
check('the owner\'s property sits in their organisation', one(`select organization_id from public.properties where id='${P1}';`) === O1);
check('an editor renames and archives it', wrote(as(M, `update public.properties set name='renamed by editor' where id='${P1}' returning id;`))
  && wrote(as(M, `update public.properties set archived_at=null where id='${P1}' returning id;`)));
x = saveProperty(M, P1, 'saved by editor');
check('an editor\'s save (the app\'s upsert with user_id = the editor) succeeds…', wrote(x), short(x.out));
check('…and the owner and organisation stay as they were', one(`select name||'|'||user_id||'|'||organization_id from public.properties where id='${P1}';`) === `saved by editor|${A}|${O1}`);
x = as(M, `update public.properties set user_id='${M}', organization_id='${O2}' where id='${P1}' returning user_id;`);
check('a direct change of owner or organisation by an editor keeps both', x.ok && one(`select user_id||'|'||organization_id from public.properties where id='${P1}';`) === `${A}|${O1}`, short(x.out));
x = as(A, `update public.properties set user_id='${D}' where id='${P1}' returning id;`);
check('…and by the owner too (ownership does not move through a save)', x.ok && one(`select user_id from public.properties where id='${P1}';`) === A);
check('service_role can still change ownership (server-side administration)', wrote(svc(`update public.properties set user_id='${D}' where id='${P1}' returning id;`))
  && wrote(svc(`update public.properties set user_id='${A}' where id='${P1}' returning id;`)));
check('an editor cannot delete it', blocked(as(M, `delete from public.properties where id='${P1}' returning id;`)) && one(`select count(*) from public.properties where id='${P1}';`) === '1');
const P2 = ownProperty(A, 'ZZ Deleted by Admin');
check('an organisation admin who does not own it deletes it', wrote(as(D, `delete from public.properties where id='${P2}' returning id;`)));
const P3 = ownProperty(A, 'ZZ Deleted by Owner');
check('the owner deletes their own', wrote(as(A, `delete from public.properties where id='${P3}' returning id;`)));
check('an editor creates a property of their own', wrote(as(M, `insert into public.properties(user_id,name) values ('${M}','ZZ editor own') returning id;`)));
x = as(N, `insert into public.properties(user_id,name) values ('${N}','ZZ first property') returning organization_id;`);
check('a brand-new user creates their first property, in the organisation created for them on the spot', wrote(x) && x.out.trim() !== O1 && one(`select role from public.organization_members where user_id='${N}' and organization_id='${x.out.trim()}';`) === 'admin', short(x.out));
x = as(S, `insert into public.properties(user_id,organization_id,name) values ('${S}','${O1}','ZZ planted') returning id;`);
check('a stranger cannot file a property into another organisation (before 045 owning the row was enough)', blocked(x), short(x.out));
check('an editor files a property into their organisation', wrote(as(M, `insert into public.properties(user_id,organization_id,name) values ('${M}','${O1}','ZZ editor in org') returning id;`)));
x = as(A, `update public.properties set lifecycle_stage='prospect' where id='${P1}' returning id;`);
check('033\'s lifecycle guard still refuses a direct stage change', !x.ok, short(x.out));

// ── 6 · stored file ──────────────────────────────────────────────────────────
section('6 · STORED FILE — a document\'s original is set once');
const nd = as(A, `insert into public.acquisition_documents(review_id,user_id,file_name,intake_id) values ('${W.R}','${A}','later.pdf','ik-later') returning id;`).out.trim();
check('a document filed before its upload finished takes its path once (by an editor)', wrote(as(M, `update public.acquisition_documents set storage_path='leases/${A}/acq_later.pdf' where id='${nd}' returning id;`)));
check('saving the same path again is harmless', wrote(as(A, `update public.acquisition_documents set storage_path='leases/${A}/acq_later.pdf', parsing_status='success' where id='${nd}' returning id;`)));
for (const [what, run] of [['the owner', (sql) => as(A, sql)], ['service_role', svc]]) {
  x = run(`update public.acquisition_documents set storage_path='leases/${A}/other.pdf' where id='${nd}' returning id;`);
  check(`${what} cannot re-point it`, !x.ok && /not re-pointed or cleared/.test(x.out), short(x.out));
}
x = as(A, `update public.acquisition_documents set storage_path=null where id='${nd}' returning id;`);
check('nor clear it', !x.ok && /not re-pointed or cleared/.test(x.out), short(x.out));
check('an editor still classifies the document', wrote(as(M, `update public.acquisition_documents set doc_type='amendment', doc_type_status='proposed', doc_type_source='ai' where id='${nd}' returning id;`)));

// ── 7 · ledger and TRUNCATE ──────────────────────────────────────────────────
section('7 · LEDGER inserts and TRUNCATE');
for (const [who, uid] of [['the owner', A], ['an editor', M], ['a read-only member', R]]) {
  check(`${who} cannot insert a ledger source or line directly (privilege refused)`,
    denied(as(uid, `insert into public.financial_sources(property_id,kind) values ('${W.P}','general_ledger');`))
    && denied(as(uid, `insert into public.gl_entries(property_id,account_code,debit,amount,row_hash) values ('${W.P}','1',1,1,'h-${uid.slice(0, 4)}');`)));
}
check('members still read the ledger tables (SELECT kept)', as(R, `select count(*) from public.gl_entries where property_id='${W.P}';`).ok && as(A, `select count(*) from public.financial_sources;`).ok);
check('service_role still writes them (the planned server-controlled path)', wrote(svc(`insert into public.gl_entries(property_id,account_code,debit,amount,row_hash) values ('${W.P}','1',1,1,'svc') returning id;`)));
for (const t of ['acquisition_reviews', 'acquisition_documents', 'properties']) {
  check(`authenticated cannot TRUNCATE ${t}`, denied(as(A, `truncate public.${t} cascade;`)) && one(`select count(*) > 0 from public.${t};`) === 't');
}
check('anon cannot TRUNCATE properties', denied(anon(`truncate public.properties cascade;`)));

// ── 8 · existing workflows ───────────────────────────────────────────────────
section('8 · EXISTING WORKFLOWS — deal start, prospect deletion, lifecycle');
x = rpcBegin(R, 'ZZ read-only deal', O1);
check('begin_acquisition still refuses a read-only member in the organisation (034)', !x.property_id, short(x._raw || ''));
const ME = deal(M, 'ZZ Editor Deal', O1);
check('an editor starts a deal in the organisation and, as its owner, files to it', !!ME.R && wrote(as(M, `insert into public.acquisition_document_families(review_id,user_id,label) values ('${ME.R}','${M}','editor family') returning id;`)));
check('the organisation admin sees and edits the editor\'s deal', wrote(as(D, `update public.acquisition_reviews set data=data||'{"seen":true}' where id='${ME.R}' returning id;`)));
const X = deal(A, 'ZZ Disposable');
fileLeasehold(A, X, 'disp', 'Disposable Tenant', true);   // proposed only: no confirmed record, no decision (034's deletion rule)
x = as(R, `select public.delete_prospect_acquisition('${X.R}'::uuid);`);
check('a read-only member cannot delete the prospect', !x.ok, short(x.out));
x = as(M, `select public.delete_prospect_acquisition('${X.R}'::uuid);`);
check('an editor cannot either (admin only, 034)', !x.ok, short(x.out));
x = as(A, `delete from public.properties where id='${X.P}' returning id;`);
check('the prospect property cannot be deleted directly while its review is open', !x.ok, short(x.out));
x = as(A, `select public.delete_prospect_acquisition('${X.R}'::uuid);`);
check('the owner deletes the disposable prospect with delete_prospect_acquisition: review, documents, leasehold and property gone',
  x.ok && one(`select (select count(*) from public.acquisition_reviews where id='${X.R}')||'|'||(select count(*) from public.acquisition_documents where review_id='${X.R}')||'|'||(select count(*) from public.properties where id='${X.P}');`) === '0|0|0', short(x.out));

// ── 9 · rollback ─────────────────────────────────────────────────────────────
section('9 · ROLLBACK — exact, and the old behaviour returns');
r = pg.psqlFile(R045, DB);
check('the rollback runs', r.ok, short(r.out));
const rolled = inventory(DB);
check('the catalog is EXACTLY what it was before 045 (policies, grants, triggers, functions, columns, indexes)', rolled.join('\n') === before.join('\n'),
  'missing: ' + before.filter(y => !rolled.includes(y)).slice(0, 2).join(' ; ') + ' | extra: ' + rolled.filter(y => !before.includes(y)).slice(0, 2).join(' ; '));
check('the old behaviour is back: a read-only member renames a review again', wrote(as(R, `update public.acquisition_reviews set name='after rollback' where id='${W.R}' returning id;`)));
check('…an editor files in the owner\'s name again', wrote(as(M, `insert into public.acquisition_document_families(review_id,user_id,label) values ('${W.R}','${A}','after rollback') returning id;`)));
check('…and members insert ledger rows again', wrote(as(R, `insert into public.gl_entries(property_id,account_code,debit,amount,row_hash) values ('${W.P}','1',1,1,'after-rb') returning id;`)));
check('no row was lost by the rollback', one(`select count(*) from public.acquisition_reviews where id in ('${W.R}','${C.R}','${ME.R}');`) === '3' && one(`select count(*) from public.properties where id='${P1}';`) === '1');
r = pg.psqlFile(R045, DB);
check('the rollback runs a second time harmlessly', r.ok, short(r.out));
r = pg.psqlFile(M045, DB);
check('045 applies again, to the same catalog as before', r.ok && inventory(DB).join('\n') === after.join('\n'), short(r.out));
check('…and refuses the read-only rename again', blocked(as(R, `update public.acquisition_reviews set name='again' where id='${W.R}' returning id;`)));

T.finish();
