'use strict';
/**
 * tools/verify-migration-018b.js — run 018b for real, against nothing that
 * matters, and prove the six tenant-portal tables end with exactly the
 * privileges their callers use, whichever way the project was built.
 *
 *   node tools/verify-migration-018b.js
 *
 * It touches NO Supabase project. It builds a throwaway PostgreSQL cluster and
 * applies the repo's own migrations to it.
 *
 * TWO DATABASES
 *
 *   pilotlike   everything built under the LEGACY default privileges, as Pilot
 *               was: 016–018 inherit every privilege for authenticated and
 *               service_role.
 *   post        000–011 legacy (they predate the change everywhere); then the
 *               project switches to the post-2026-10-30 model and 012–018 are
 *               applied (with 015b), so 016–018 get NOTHING unless granted. The
 *               break is proven present before 018b runs.
 *
 * WHAT IT PROVES
 *
 *   1  baseline: pilotlike holds every privilege; post holds none, and the
 *      portal's read and the document-url lookup both FAIL there
 *   2  018b applies, and applies again
 *   3  EXACT privilege matrices for all six tables, identical in both databases
 *   4  the calls the app makes still work:
 *        portal.js (tenant): reads its own PUBLISHED profile, statements and
 *          documents — nothing draft, withdrawn, superseded or another tenant's
 *        api/tenant-publish-statement.js: publish_tenant_statement() as
 *          service_role publishes v1, then v2 superseding v1, and links sources
 *        api/tenant-unpublish-statement.js: PATCH status=void, returning
 *        api/tenant-publish-document.js: POST document returning, POST source,
 *          PATCH to withdraw
 *        api/tenant-document-url.js: GET membership, document, source
 *        scripts/b1-ci-fixture.js: every insert it makes, returning
 *   5  refusals at the grant (42501): a tenant cannot read any companion table
 *      or write anything; a landlord cannot write (the landlord policies are
 *      dormant); service_role cannot DELETE, or touch profile sources; anon
 *      everywhere; publish_tenant_statement() not executable by authenticated
 *      or anon
 *   6  deleting a property still cascades through all six, as the owner
 *   7  NOTHING ELSE MOVED — columns, constraints, indexes, policies, functions
 *      and every row are byte-identical across 018b
 *   8  the rollback restores Pilot's observed grants; 018b applies again
 */
const path = require('path');
const { startCluster, tally, show, denied } = require('./_pg-throwaway');

const ROOT = path.join(__dirname, '..');
const MIG  = path.join(ROOT, 'migrations');
const M018B = path.join(MIG, '018b_tenant_portal_privileges.sql');
const R018B = path.join(MIG, '018b_tenant_portal_privileges_rollback.sql');

const T = tally();
const { check, section } = T;

const MARKER = 'fd9c09b1-b657-4c58-9999-c3cce28e7600';
const UL = '11111111-1111-4111-8111-111111111111';   // landlord of P1
const UO = '22222222-2222-4222-8222-222222222222';   // landlord of P2
const UT = '33333333-3333-4333-8333-333333333333';   // tenant of T1
const UU = '44444444-4444-4444-8444-444444444444';   // tenant of T2 (same property)
const P1 = 'aaaaaaaa-0000-4000-8000-00000000000a';
const P2 = 'bbbbbbbb-0000-4000-8000-00000000000b';
const T1 = 'aaaaaaaa-1111-4000-8000-00000000000a';
const T2 = 'aaaaaaaa-2222-4000-8000-00000000000a';
const T3 = 'bbbbbbbb-1111-4000-8000-00000000000b';

const LEGACY_BEFORE = ['000_base_schema.sql', '001_lease_jobs.sql', '003_cam_reconciliations.sql',
                       '004_lease_intelligence.sql', '005_rls_hardening.sql'];
const AFTER = ['012_tenant_users_phase_a.sql', '013_tenant_users_revoke_anon.sql', '014_tenant_invitations.sql',
               '015_tenant_users_hide_revoked.sql', '015b_tenant_access_privileges.sql',
               '016_tenant_space_profiles.sql', '017_tenant_statements.sql', '018_tenant_documents.sql'];
const TABLES = ['tenant_space_profiles', 'tenant_space_profile_sources', 'tenant_statements',
                'tenant_statement_sources', 'tenant_documents', 'tenant_document_sources'];

const EXPECT = {
  tenant_space_profiles:        { anon: '', authenticated: 'SELECT', service_role: 'INSERT,SELECT' },
  tenant_space_profile_sources: { anon: '', authenticated: '',       service_role: '' },
  tenant_statements:            { anon: '', authenticated: 'SELECT', service_role: 'INSERT,SELECT,UPDATE' },
  tenant_statement_sources:     { anon: '', authenticated: '',       service_role: 'INSERT,SELECT' },
  tenant_documents:             { anon: '', authenticated: 'SELECT', service_role: 'INSERT,SELECT,UPDATE' },
  tenant_document_sources:      { anon: '', authenticated: '',       service_role: 'INSERT,SELECT' },
};
const ALL = 'DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE';
const OBSERVED = Object.fromEntries(TABLES.map(t => [t, { anon: '', authenticated: ALL, service_role: ALL }]));
const NONE = Object.fromEntries(TABLES.map(t => [t, { anon: '', authenticated: '', service_role: '' }]));
const PUBLISH_SIG = 'public.publish_tenant_statement(uuid, uuid, integer, numeric, numeric, numeric, numeric, numeric, jsonb, uuid, text, uuid)';

console.log('\n══ migration 018b — executed against a throwaway cluster ══');
console.log('   NO Supabase project is contacted by this script.');
const pg = startCluster('018b');
console.log('   postgres: ' + pg.PGBIN);

function build(db, modelFor012) {
  section(`${db}: build to 018 (000–011 legacy; 012–018 ${modelFor012})`);
  const boot = pg.database(db, 'legacy');
  check(`${db}: Supabase prerequisites created`, boot.ok, boot.ok ? '' : boot.out.slice(0, 200));
  const q = (sql) => pg.psql(sql, db);
  q(`insert into auth.users (id, email) values ('${UL}','l@example.com'), ('${UO}','o@example.com'),
       ('${UT}','t@example.com'), ('${UU}','u@example.com');`);
  let ok = true;
  for (const f of LEGACY_BEFORE) { const r = pg.psqlFile(path.join(MIG, f), db); ok = check(`${db}: ${f} applies`, r.ok, r.ok ? '' : r.out.slice(0, 300)) && ok; }
  q(`insert into public.properties (id, user_id, name) values
       ('${MARKER}', null, 'pilot marker'), ('${P1}','${UL}','One Plaza'), ('${P2}','${UO}','Two Centre');
     insert into public.tenants (id, property_id, name) values
       ('${T1}','${P1}','Tenant One'), ('${T2}','${P1}','Tenant Two'), ('${T3}','${P2}','Tenant Three');`);
  if (modelFor012 !== 'legacy') {
    const m = pg.setModel(db, modelFor012);
    ok = check(`${db}: project switched to the ${modelFor012} default privileges`, m.ok, m.ok ? '' : m.out) && ok;
  }
  for (const f of AFTER) { const r = pg.psqlFile(path.join(MIG, f), db); ok = check(`${db}: ${f} applies`, r.ok, r.ok ? '' : r.out.slice(0, 300)) && ok; }
  const seed = q(`
    insert into public.tenant_users (user_id, tenant_id, property_id, accepted_at) values
      ('${UT}','${T1}','${P1}', now()), ('${UU}','${T2}','${P1}', now());
    insert into public.tenant_space_profiles (tenant_id, property_id, property_name, status, published_at) values
      ('${T1}','${P1}','One Plaza','published', now()), ('${T2}','${P1}','One Plaza','published', now());
    insert into public.tenant_statements (tenant_id, property_id, cam_year, allocated_amount, pro_rata_percent, total_pool, statement_json, status, published_at) values
      ('${T1}','${P1}',2023, 100, 10, 1000, '{}', 'published', now()),
      ('${T1}','${P1}',2022, 90, 10, 900, '{}', 'draft', null),
      ('${T2}','${P1}',2023, 200, 20, 1000, '{}', 'published', now());
    insert into public.tenant_documents (tenant_id, property_id, title, doc_kind, status, published_at) values
      ('${T1}','${P1}','Lease','lease','published', now()), ('${T1}','${P1}','Old notice','notice','withdrawn', now()),
      ('${T2}','${P1}','Their lease','lease','published', now());
    insert into public.tenant_document_sources (document_id, property_id, storage_path)
      select id, property_id, 'leases/' || id from public.tenant_documents;
    insert into public.cam_reconciliations (property_id, tenant_id, year) values ('${P1}','${T1}',2024);`);
  ok = check(`${db}: portal rows seeded`, seed.ok, seed.ok ? '' : seed.out.slice(0, 300)) && ok;
  if (!ok) { console.log('\nStopping: the database could not be built.'); T.finish(); }
}

function matrix(db, expected, label) {
  for (const [table, roles] of Object.entries(expected)) {
    for (const [role, want] of Object.entries(roles)) {
      const got = pg.privs('public.' + table, role, db);
      check(`${db}: ${label} ${table} · ${role} = {${show(want)}}`, got === want, got === want ? '' : 'got {' + show(got) + '}');
    }
  }
}
function fingerprint(db) {
  const list = TABLES.map(t => `'${t}'`).join(',');
  return pg.psql(`
    select 'col|'||table_name||'|'||column_name||'|'||data_type||'|'||is_nullable||'|'||coalesce(column_default,'')
      from information_schema.columns where table_schema='public' and table_name in (${list})
    union all select 'con|'||conrelid::regclass||'|'||conname||'|'||pg_get_constraintdef(oid)
      from pg_constraint where conrelid::regclass::text in (${TABLES.map(t => `'${t}'`).join(',')})
    union all select 'idx|'||tablename||'|'||indexdef from pg_indexes where schemaname='public' and tablename in (${list})
    union all select 'pol|'||tablename||'|'||policyname||'|'||array_to_string(roles,'+')||'|'||cmd||'|'||coalesce(qual,'')||'|'||coalesce(with_check,'')
      from pg_policies where schemaname='public' and tablename in (${list})
    union all select 'fn|'||p.oid::regprocedure||'|'||md5(pg_get_functiondef(p.oid))||'|'||coalesce(array_to_string(p.proacl,'+'),'')
      from pg_proc p where p.pronamespace='public'::regnamespace
    order by 1;`, db).out;
}
const rows = (db) => TABLES.map(t => pg.psql(`select count(*)||':'||coalesce(md5(string_agg(md5(x::text), ',' order by md5(x::text))),'') from public.${t} x;`, db).out).join(' ');

const portal = (db, uid, table, col) => pg.as('authenticated', uid,
  `select coalesce(string_agg(${col}, ',' order by ${col}), '') from public.${table};`, db);

build('pilotlike', 'legacy');
build('post', 'post-2026-10-30');

// ── 1 · baseline ─────────────────────────────────────────────────────────────
section('1 · baseline, before 018b');
matrix('pilotlike', OBSERVED, 'before 018b (reproduces Pilot):');
matrix('post', NONE, 'before 018b:');
check('post: before 018b the portal\'s statement read FAILS (the October 30 break)',
  denied(portal('post', UT, 'tenant_statements', 'cam_year::text')));
check('post: before 018b the document-url lookup FAILS',
  denied(pg.as('service_role', null, `select id from public.tenant_documents;`, 'post')));
check('pilotlike: before 018b a tenant holds SELECT on the companion tables at the grant level (only RLS stops it)',
  pg.privs('public.tenant_document_sources', 'authenticated', 'pilotlike').includes('SELECT'));

const fpBefore = { pilotlike: fingerprint('pilotlike'), post: fingerprint('post') };
const rowsBefore = { pilotlike: rows('pilotlike'), post: rows('post') };

// ── 2 · apply ────────────────────────────────────────────────────────────────
section('2 · 018b applies, and applies again');
for (const db of ['pilotlike', 'post']) {
  const a = pg.psqlFile(M018B, db); check(`${db}: 018b applies`, a.ok, a.ok ? '' : a.out.slice(0, 300));
  const b = pg.psqlFile(M018B, db); check(`${db}: 018b applies a second time`, b.ok, b.ok ? '' : b.out.slice(0, 300));
}

// ── 3 · exact matrices ───────────────────────────────────────────────────────
section('3 · exact privilege matrices');
matrix('pilotlike', EXPECT, 'after 018b:');
matrix('post', EXPECT, 'after 018b:');
check('PUBLIC holds nothing on any of the six',
  TABLES.every(t => pg.privs('public.' + t, 'public', 'post') === '' && pg.privs('public.' + t, 'public', 'pilotlike') === ''));

// ── 7 (early) · nothing else moved ───────────────────────────────────────────
section('7 · nothing else moved');
for (const db of ['pilotlike', 'post']) {
  check(`${db}: columns, constraints, indexes, policies, functions byte-identical across 018b`,
    fingerprint(db) === fpBefore[db] && fpBefore[db].length > 0);
  check(`${db}: every row byte-identical across 018b`, rows(db) === rowsBefore[db]);
}

function behaviour(db) {
  const svc = (sql) => pg.as('service_role', null, sql, db);
  section(`${db}: 4 · portal.js — the tenant reads its own published rows`);
  const prof = portal(db, UT, 'tenant_space_profiles', 'tenant_id::text');
  check(`${db}: own published profile only`, prof.ok && prof.out === T1, prof.out);
  const st = portal(db, UT, 'tenant_statements', 'cam_year::text');
  check(`${db}: own published statements only (not the draft, not the neighbour's)`, st.ok && st.out === '2023', st.out);
  const docs = portal(db, UT, 'tenant_documents', 'title');
  check(`${db}: own published documents only (not the withdrawn one, not the neighbour's)`, docs.ok && docs.out === 'Lease', docs.out);
  const ll = portal(db, UL, 'tenant_statements', 'tenant_id::text');
  check(`${db}: the landlord reads its property's statements (landlord policy, SELECT grant)`, ll.ok && ll.out.split(',').length === 3, ll.out.slice(0, 80));
  const other = portal(db, UO, 'tenant_statements', 'tenant_id::text');
  check(`${db}: another landlord reads none`, other.ok && other.out === '', show(other.out));

  section(`${db}: 4 · the B2 server routes (service_role)`);
  const pub = (hash) => svc(`select (s).version||':'||(s).status from (select public.publish_tenant_statement(
      '${T1}','${P1}',2024, 120, 10, 1200, 100, 20, '{"lines":[]}'::jsonb,
      (select id from public.cam_reconciliations where tenant_id='${T1}' and year=2024), '${hash}', '${UL}') s) x;`);
  const v1 = pub('h1');
  check(`${db}: tenant-publish-statement: publish_tenant_statement() publishes v1`, v1.ok && v1.out === '1:published', v1.out.slice(0, 120));
  const v2 = pub('h2');
  check(`${db}: and v2, superseding v1 atomically`, v2.ok && v2.out === '2:published', v2.out.slice(0, 120));
  check(`${db}: v1 is superseded and its source points at v2`,
    pg.psql(`select s.status||'|'||(src.superseded_by is not null)::text from public.tenant_statements s
               join public.tenant_statement_sources src on src.statement_id = s.id
              where s.tenant_id='${T1}' and s.cam_year=2024 and s.version=1;`, db).out === 'superseded|true');
  const unp = svc(`update public.tenant_statements set status='void'
                    where tenant_id='${T1}' and cam_year=2024 and status='published' returning version||':'||status;`);
  check(`${db}: tenant-unpublish-statement: PATCH status=void, returning`, unp.ok && unp.out === '2:void', unp.out.slice(0, 120));

  const doc = svc(`insert into public.tenant_documents (tenant_id, property_id, title, doc_kind, content_type, byte_size, status, published_at)
                   values ('${T1}','${P1}','Shared','notice','application/pdf',10,'published', now()) returning id;`);
  check(`${db}: tenant-publish-document: POST document, return=representation`, doc.ok && /^[0-9a-f-]{36}$/.test(doc.out), doc.out.slice(0, 120));
  const src = svc(`insert into public.tenant_document_sources (document_id, property_id, storage_path, published_by)
                   values ('${doc.out}','${P1}','${UL}/shared.pdf','${UL}');`);
  check(`${db}: tenant-publish-document: POST its source`, src.ok, src.out.slice(0, 120));
  const wd = svc(`update public.tenant_documents set status='withdrawn' where id='${doc.out}';`);
  check(`${db}: tenant-publish-document: PATCH to withdraw (the failure path)`, wd.ok, wd.out.slice(0, 120));

  const leaseId = pg.psql(`select id from public.tenant_documents where title='Lease' and tenant_id='${T1}';`, db).out;
  const mem = svc(`select tenant_id from public.tenant_users where user_id='${UT}' and accepted_at is not null and revoked_at is null;`);
  const d = svc(`select id, tenant_id, title, content_type from public.tenant_documents where id='${leaseId}' and status='published';`);
  const s = svc(`select storage_path, storage_bucket from public.tenant_document_sources where document_id='${leaseId}';`);
  check(`${db}: tenant-document-url: GET membership, document and source`,
    mem.ok && mem.out === T1 && d.ok && d.out.startsWith(leaseId) && s.ok && s.out.startsWith('leases/'), [mem.out, d.out, s.out].join(' / ').slice(0, 140));

  // scripts/b1-ci-fixture.js — each insert with its Prefer (default return=representation).
  const fp = svc(`insert into public.tenant_space_profiles (tenant_id, property_id, property_name, status, published_at)
                  values ('${T3}','${P2}','Two Centre','published', now()) returning id;`);
  const fs1 = svc(`insert into public.tenant_statements (tenant_id, property_id, cam_year, allocated_amount, pro_rata_percent, total_pool, statement_json, status, published_at)
                   values ('${T3}','${P2}',2023, 1, 1, 1, '{}', 'published', now()) returning id;`);
  const fs2 = fs1.ok ? svc(`insert into public.tenant_statement_sources (statement_id, property_id, source_run_hash, published_by)
                            values ('${fs1.out}','${P2}','ci-1','${UO}') returning statement_id;`) : fs1;
  const fd1 = svc(`insert into public.tenant_documents (tenant_id, property_id, title, doc_kind, status, published_at)
                   values ('${T3}','${P2}','CI doc','other','published', now()) returning id;`);
  const fd2 = fd1.ok ? svc(`insert into public.tenant_document_sources (document_id, property_id, storage_path, storage_bucket, published_by)
                            values ('${fd1.out}','${P2}','ci/x.pdf','lease-documents','${UO}') returning document_id;`) : fd1;
  check(`${db}: b1-ci-fixture: profile, statement, statement source, document, document source — each returning`,
    [fp, fs1, fs2, fd1, fd2].every(r => r.ok && /^[0-9a-f-]{36}$/.test(r.out)),
    [fp, fs1, fs2, fd1, fd2].filter(r => !r.ok).map(r => r.out.split('\n')[0]).join(' | ').slice(0, 160));

  section(`${db}: 5 · refusals at the grant (42501)`);
  const refusals = [
    ['a tenant cannot read profile sources', 'authenticated', UT, `select count(*) from public.tenant_space_profile_sources;`],
    ['a tenant cannot read statement sources', 'authenticated', UT, `select count(*) from public.tenant_statement_sources;`],
    ['a tenant cannot read document sources (storage paths)', 'authenticated', UT, `select count(*) from public.tenant_document_sources;`],
    ['a tenant cannot write a statement', 'authenticated', UT, `update public.tenant_statements set balance_due = 0;`],
    ['a tenant cannot insert a document', 'authenticated', UT,
      `insert into public.tenant_documents (tenant_id, property_id, title, doc_kind) values ('${T1}','${P1}','x','other');`],
    ['a landlord cannot write a profile (landlord policy dormant)', 'authenticated', UL, `update public.tenant_space_profiles set space_label = 'x';`],
    ['a landlord cannot delete a statement', 'authenticated', UL, `delete from public.tenant_statements;`],
    ['a landlord cannot publish a document directly', 'authenticated', UL,
      `insert into public.tenant_documents (tenant_id, property_id, title, doc_kind) values ('${T1}','${P1}','x','other');`],
    ['authenticated cannot call publish_tenant_statement()', 'authenticated', UL,
      `select public.publish_tenant_statement('${T1}','${P1}',2025,1,1,1,null,null,'{}'::jsonb,null,null,null);`],
    ['service_role cannot DELETE statements', 'service_role', null, `delete from public.tenant_statements;`],
    ['service_role cannot DELETE documents', 'service_role', null, `delete from public.tenant_documents;`],
    ['service_role cannot DELETE document sources', 'service_role', null, `delete from public.tenant_document_sources;`],
    ['service_role cannot UPDATE a document source', 'service_role', null, `update public.tenant_document_sources set storage_path = 'x';`],
    ['service_role cannot UPDATE a profile (nothing does)', 'service_role', null, `update public.tenant_space_profiles set space_label = 'x';`],
    ['service_role cannot touch profile sources (no caller)', 'service_role', null, `select count(*) from public.tenant_space_profile_sources;`],
  ];
  for (const t of TABLES) refusals.push([`anon cannot read ${t}`, 'anon', null, `select count(*) from public.${t};`]);
  refusals.push(['anon cannot call publish_tenant_statement()', 'anon', null,
    `select public.publish_tenant_statement('${T1}','${P1}',2025,1,1,1,null,null,'{}'::jsonb,null,null,null);`]);
  for (const [name, role, uid, sql] of refusals) {
    const r = pg.as(role, uid, sql, db);
    check(`${db}: ${name}`, denied(r), r.ok ? 'NOT refused' : r.out.split('\n')[0].slice(0, 80));
  }
  check(`${db}: publish_tenant_statement() — EXECUTE for service_role only (017's grant, unchanged)`,
    pg.canExecute('service_role', PUBLISH_SIG, db) && !pg.canExecute('authenticated', PUBLISH_SIG, db) && !pg.canExecute('anon', PUBLISH_SIG, db));

  section(`${db}: 6 · cascades run as the owner`);
  const del = svc(`delete from public.properties where id = '${P2}';`);
  check(`${db}: deleting a property (service_role, as the fixtures do) succeeds`, del.ok, del.out.slice(0, 120));
  check(`${db}: and every portal row for it cascaded, with no DELETE grant on any of the six`,
    TABLES.every(t => pg.psql(`select count(*) from public.${t} where property_id='${P2}';`, db).out === '0'));
}
behaviour('pilotlike');
behaviour('post');

// ── 8 · rollback ─────────────────────────────────────────────────────────────
section('8 · the rollback restores Pilot\'s observed grants');
const rb = pg.psqlFile(R018B, 'pilotlike');
check('pilotlike: rollback runs', rb.ok, rb.ok ? '' : rb.out.slice(0, 300));
matrix('pilotlike', OBSERVED, 'after rollback:');
const again = pg.psqlFile(M018B, 'pilotlike');
check('pilotlike: 018b applies again after the rollback', again.ok, again.ok ? '' : again.out.slice(0, 300));
matrix('pilotlike', EXPECT, 'after re-apply:');

T.finish();
