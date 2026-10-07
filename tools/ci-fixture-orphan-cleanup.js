'use strict';
/**
 * tools/ci-fixture-orphan-cleanup.js — the one-off SQL that removes the
 * organisations the CI fixture scripts leaked on Pilot, and nothing else.
 *
 *   node tools/ci-fixture-orphan-cleanup.js --precheck
 *   node tools/ci-fixture-orphan-cleanup.js <ids-file> --expected 88 \
 *        --protected-count 13 --protected-ids-md5 <md5> --protected-rows-md5 <md5>
 *
 * It prints SQL and contacts nothing.
 *
 * WHAT IT CLEANS UP
 * Until 2026-10-07 scripts/b1-ci-fixture.js and scripts/pilot-live-fixture.js
 * deleted their landlord without deleting the organisation migration 024's
 * trigger had created for it: organizations.created_by is ON DELETE SET NULL,
 * so one creator-less, member-less, property-less organisation named after the
 * landlord's reserved-domain email survived every run (88 on Pilot). The
 * scripts now tear their organisation down; this removes what they left.
 *
 * HOW IT REFUSES
 * The SQL is one transaction that deletes ONLY ids listed in it, and only those
 * that still satisfy the orphan predicate at run time: no creator, a fixture
 * name, no membership, no property, no property_events row, no auth user with
 * that email. Before deleting it requires the list to hold exactly `expected`
 * distinct ids, every one of them to match, and everything OUTSIDE the list to
 * be exactly the protected set (count and ids md5) read in the pre-check. After
 * deleting it requires row_count = expected and the remaining organisations to
 * be the protected set again, by count, ids md5 and whole-row md5. Any
 * mismatch raises, and the transaction rolls back. It also refuses to run where
 * the Pilot marker property is absent.
 *
 * tools/verify-ci-fixture-organizations.js runs this same template on a
 * throwaway cluster seeded with orphans, legitimate organisations and decoys,
 * and proves each refusal and the rollback.
 */
const fs = require('fs');

const PILOT_MARKER_PROPERTY = 'fd9c09b1-b657-4c58-9999-c3cce28e7600';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MD5  = /^[0-9a-f]{32}$/;

// The orphan predicate, over organisations alias `a`. [0-9]+ deliberately: the
// Pilot rows all carry a GitHub run id, and a one-off should be no wider than
// the rows it is for. (The scripts' own teardown allows `local<millis>` too.)
function orphanPredicate(a) {
  return [
    `${a}.created_by is null`,
    `${a}.name ~ '^(b1ci|plci)-[0-9]+-[a-z]+@pilot\\.invalid$'`,
    `not exists (select 1 from public.organization_members m where m.organization_id = ${a}.id)`,
    `not exists (select 1 from public.properties p where p.organization_id = ${a}.id)`,
    `not exists (select 1 from public.property_events e where e.organization_id = ${a}.id)`,
    `not exists (select 1 from auth.users u where u.email = ${a}.name)`,
  ].join('\n      and ');
}

// Read-only. Run first; its numbers go into the build. Re-run it immediately
// before the cleanup if any CI gate ran in between — a gate run before the
// fixture fix lands adds an orphan the list does not hold, and the
// outside-the-list check will then refuse, which is the right outcome.
const PRECHECK_SQL = `with orphan as (
  select o.* from public.organizations o
  where ${orphanPredicate('o')}
)
select 'a now' k, now()::text v
union all select 'b orphans (expected)', count(*)::text from orphan
union all select 'c orphan ids md5', md5(string_agg(id::text, ',' order by id)) from orphan
union all select 'd protected count', count(*)::text from public.organizations o where not exists (select 1 from orphan x where x.id = o.id)
union all select 'e protected ids md5', md5(string_agg(o.id::text, ',' order by o.id)) from public.organizations o where not exists (select 1 from orphan x where x.id = o.id)
union all select 'f protected rows md5', md5(string_agg(o::text, '|' order by o.id)) from public.organizations o where not exists (select 1 from orphan x where x.id = o.id)
union all select 'g orphan ids', string_agg(id::text, ',' order by id) from orphan
order by 1;`;

function buildCleanupSql(opts) {
  const { ids, expected, protectedCount, protectedIdsMd5, protectedRowsMd5 } = opts;
  const markerId = opts.markerId || PILOT_MARKER_PROPERTY;
  const generatedAt = opts.generatedAt || new Date().toISOString();
  if (!Array.isArray(ids) || !ids.length) throw new Error('ids: a non-empty array is required');
  for (const id of ids) if (!UUID.test(id)) throw new Error('ids: not a lower-case uuid: ' + id);
  if (new Set(ids).size !== ids.length) throw new Error('ids: duplicates present');
  if (!Number.isInteger(expected) || expected !== ids.length) throw new Error(`expected (${expected}) must equal the number of ids (${ids.length})`);
  if (!Number.isInteger(protectedCount) || protectedCount < 0) throw new Error('protectedCount: a non-negative integer is required');
  if (!MD5.test(protectedIdsMd5 || '')) throw new Error('protectedIdsMd5: 32 hex characters required');
  if (!MD5.test(protectedRowsMd5 || '')) throw new Error('protectedRowsMd5: 32 hex characters required');
  if (!UUID.test(markerId)) throw new Error('markerId: not a uuid');

  const list = ids.slice().sort().map(id => `    '${id}'`).join(',\n');
  const pred = orphanPredicate('o');
  return `-- CI fixture orphan organisations — one-off cleanup. PILOT ONLY.
-- Generated ${generatedAt} by tools/ci-fixture-orphan-cleanup.js.
-- Deletes exactly the ${expected} organisations listed below, each of which must still satisfy
-- the orphan predicate (no creator, fixture name, no members, no properties, no property_events,
-- no auth user with that email), and refuses — rolling back — on any other outcome.
-- How they arose: the header of scripts/b1-ci-fixture.js.
begin;
do $$
declare
  v_expected       constant int    := ${expected};
  v_protected_n    constant int    := ${protectedCount};
  v_protected_ids  constant text   := '${protectedIdsMd5}';
  v_protected_rows constant text   := '${protectedRowsMd5}';
  v_ids            constant uuid[] := array[
${list}
  ]::uuid[];
  v_n        int;
  v_ids_md5  text;
  v_rows_md5 text;
begin
  if not exists (select 1 from public.properties where id = '${markerId}') then
    raise exception 'REFUSING: pilot marker property not found — this is not the Pilot project';
  end if;
  if coalesce(array_length(v_ids, 1), 0) <> v_expected
     or (select count(distinct x) from unnest(v_ids) x) <> v_expected then
    raise exception 'REFUSING: the id list holds % entries, expected % distinct', coalesce(array_length(v_ids, 1), 0), v_expected;
  end if;
  select count(*) into v_n from public.organizations o
    where o.id = any(v_ids)
      and ${pred};
  if v_n <> v_expected then
    raise exception 'REFUSING: % of the % listed organisations match the orphan predicate — nothing deleted', v_n, v_expected;
  end if;
  select count(*), coalesce(md5(string_agg(o.id::text, ',' order by o.id)), '-') into v_n, v_ids_md5
    from public.organizations o where not (o.id = any(v_ids));
  if v_n <> v_protected_n or v_ids_md5 <> v_protected_ids then
    raise exception 'REFUSING: the organisations outside the list are not the expected set (% rows, ids md5 %) — nothing deleted', v_n, v_ids_md5;
  end if;
  delete from public.organizations o
    where o.id = any(v_ids)
      and ${pred};
  get diagnostics v_n = row_count;
  if v_n <> v_expected then
    raise exception 'ABORT: the delete removed % rows, expected % — rolled back', v_n, v_expected;
  end if;
  select count(*),
         coalesce(md5(string_agg(o.id::text, ',' order by o.id)), '-'),
         coalesce(md5(string_agg(o::text, '|' order by o.id)), '-')
    into v_n, v_ids_md5, v_rows_md5
    from public.organizations o;
  if v_n <> v_protected_n or v_ids_md5 <> v_protected_ids or v_rows_md5 <> v_protected_rows then
    raise exception 'ABORT: after the delete the remaining organisations are not the protected set (% rows, ids md5 %, rows md5 %) — rolled back', v_n, v_ids_md5, v_rows_md5;
  end if;
end $$;
commit;
-- After-state, read-only (the SQL editor shows the last result set).
select 'a organizations remaining' as k, count(*)::text as v from public.organizations
union all select 'b remaining ids md5', coalesce(md5(string_agg(id::text, ',' order by id)), '-') from public.organizations
union all select 'c remaining rows md5', coalesce(md5(string_agg(o::text, '|' order by o.id)), '-') from public.organizations o
union all select 'd orphans matching the predicate (expect 0)', count(*)::text from public.organizations o where ${pred}
union all select 'e organization_members', count(*)::text from public.organization_members
union all select 'f now', now()::text
order by 1;
`;
}

function readIdsFile(file) {
  const text = fs.readFileSync(file, 'utf8');
  const ids = text.split(/[\s,]+/).map(s => s.trim()).filter(s => s && !s.startsWith('#'));
  // Comment lines are dropped whole; anything else must be a uuid.
  const clean = text.split('\n').filter(l => !l.trim().startsWith('#')).join(',').split(/[\s,]+/).filter(Boolean);
  return clean.length ? clean : ids;
}

module.exports = { PILOT_MARKER_PROPERTY, orphanPredicate, PRECHECK_SQL, buildCleanupSql, readIdsFile };

if (require.main === module) {
  const argv = process.argv.slice(2);
  if (argv.includes('--precheck')) { process.stdout.write(PRECHECK_SQL + '\n'); process.exit(0); }
  const file = argv.find(a => !a.startsWith('--'));
  const opt = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  if (!file || !opt('--expected') || !opt('--protected-count') || !opt('--protected-ids-md5') || !opt('--protected-rows-md5')) {
    console.error('usage: node tools/ci-fixture-orphan-cleanup.js --precheck\n' +
                  '       node tools/ci-fixture-orphan-cleanup.js <ids-file> --expected N --protected-count N --protected-ids-md5 <md5> --protected-rows-md5 <md5>');
    process.exit(2);
  }
  try {
    process.stdout.write(buildCleanupSql({
      ids: readIdsFile(file),
      expected: Number(opt('--expected')),
      protectedCount: Number(opt('--protected-count')),
      protectedIdsMd5: opt('--protected-ids-md5'),
      protectedRowsMd5: opt('--protected-rows-md5'),
    }));
  } catch (e) { console.error('refusing to build: ' + e.message); process.exit(2); }
}
