'use strict';
/**
 * test-organizations-migration.js — P0.1: migration 024 says what the plan says.
 *
 *   node test-organizations-migration.js
 *
 * Offline. There is no Postgres in the sandbox, so this reads the SQL as text
 * and pins the properties that matter — the ones a hand edit could quietly
 * lose. What it cannot prove (that the SQL runs) the live gate proves:
 * test-rls-cross-user.js Group 4 runs against pilot once 024 is applied there.
 *
 *   · the pilot marker guard is present and refuses before any DDL
 *   · every property-scoped landlord policy is rewritten to read the membership
 *     helpers, and NOT the old `user_id = auth.uid()` join
 *   · the four storage policies read storage_object_accessible(name), which
 *     keeps the uid shape for the caller's OWN uid only
 *   · every helper is security definer with an empty search_path, executable
 *     by authenticated and revoked from public/anon
 *   · membership means accepted and not revoked, in every predicate
 *   · the backfill covers users who own no property, and every property joins
 *     its owner's organisation
 *   · _payment_assert_owner reads the same rule
 *   · acquisition_reviews is NOT touched (no property_id until 023)
 *   · the rollback restores every rewritten policy by name and removes every
 *     new object
 */

const fs   = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const failures = [];
function t(name, cond, detail) {
  if (cond) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  else { fail++; failures.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? '  — ' + detail : ''}`); }
}
const sec = (s) => console.log(`\n── ${s} ──`);

const ROOT = __dirname;
const MIG  = fs.readFileSync(path.join(ROOT, 'migrations/024_organizations.sql'), 'utf8');
const RB   = fs.readFileSync(path.join(ROOT, 'migrations/024_organizations_rollback.sql'), 'utf8');
const MARKER = 'fd9c09b1-b657-4c58-9999-c3cce28e7600';
const PROD_REF = 'zhsuhehgehbzkmzurzyf';

/** The body of one `create policy <name>` statement, up to its semicolon. */
function policy(src, name) {
  const re = new RegExp('create policy\\s+"?' + name + '"?[\\s\\S]*?;', 'i');
  const m = src.match(re);
  return m ? m[0] : null;
}
/** The body of one `create or replace function public.<name>(` statement, through `$$;`. */
function fn(src, name) {
  const i = src.indexOf('create or replace function public.' + name + '(');
  if (i === -1) return null;
  const j = src.indexOf('$$;', i);
  return j === -1 ? null : src.slice(i, j + 3);
}

sec('A. Pilot only');
{
  t('A1 the migration carries the pilot marker guard', MIG.indexOf(MARKER) !== -1);
  t('A2 which refuses before the first DDL statement',
    MIG.indexOf('raise exception') < MIG.indexOf('create table'));
  t('A3 inside the transaction, so a refusal leaves nothing behind',
    /^begin;/m.test(MIG) && MIG.indexOf('begin;') < MIG.indexOf(MARKER));
  t('A4 the rollback carries the same guard', RB.indexOf(MARKER) !== -1 && /raise exception/.test(RB));
  t('A5 neither file names the production project', MIG.indexOf(PROD_REF) === -1 && RB.indexOf(PROD_REF) === -1);
}

sec('B. The tables');
{
  t('B1 organizations', /create table if not exists public\.organizations \(/.test(MIG));
  t('B2 organization_members', /create table if not exists public\.organization_members \(/.test(MIG));
  t('B3 one membership row per (organisation, user)', /unique \(organization_id, user_id\)/.test(MIG));
  t('B4 the five roles, and only those',
    /check \(role in \('admin', 'property_manager', 'accounting', 'leasing', 'read_only'\)\)/.test(MIG));
  t('B5 a membership is a lifecycle: invited_at, accepted_at, revoked_at',
    /invited_at\s+timestamptz/.test(MIG) && /accepted_at\s+timestamptz/.test(MIG) && /revoked_at\s+timestamptz/.test(MIG));
  t('B6 deleting a user removes their memberships',
    /user_id\s+uuid\s+not null references auth\.users\(id\)\s+on delete cascade/.test(MIG));
  t('B7 properties gain organization_id, referencing organizations',
    /alter table public\.properties\s+add column if not exists organization_id uuid references public\.organizations\(id\)/.test(MIG));
  t('B8 an organisation with properties cannot be deleted from under them', /organizations\(id\) on delete restrict/.test(MIG));
  t('B9 RLS is enabled on both new tables',
    /alter table public\.organizations\s+enable row level security/.test(MIG) &&
    /alter table public\.organization_members enable row level security/.test(MIG));
  t('B10 authenticated users may only SELECT the new tables in P0.1',
    /grant select on public\.organizations\s+to authenticated/.test(MIG) &&
    /grant select on public\.organization_members to authenticated/.test(MIG) &&
    !/grant (insert|update|delete|all)\s+on public\.organization(s|_members)\s+to authenticated/.test(MIG));
}

sec('C. The helpers: one rule, security definer, empty search_path, not callable by anon');
{
  const HELPERS = ['is_active_member_of_org', 'is_member_of_property', 'member_property_ids', 'storage_object_accessible'];
  for (const h of HELPERS) {
    const body = fn(MIG, h);
    t(`C1 ${h} exists`, !!body);
    if (!body) continue;
    t(`C2 ${h} is security definer`, /security definer/.test(body));
    t(`C3 ${h} sets search_path = ''`, /set search_path = ''/.test(body));
    t(`C4 ${h} is stable (a read, never a write)`, /\bstable\b/.test(body));
    t(`C5 ${h} is revoked from public and anon`, new RegExp('revoke all on function public\\.' + h + '\\([^)]*\\)\\s+from public, anon').test(MIG));
    t(`C6 ${h} is granted only to authenticated`, new RegExp('grant execute on function public\\.' + h + '\\([^)]*\\)\\s+to authenticated').test(MIG));
    t(`C7 ${h} never consults a role claim (jwt)`, !/jwt|app_metadata|user_metadata/.test(body));
  }
  const active = fn(MIG, 'is_active_member_of_org');
  t('C8 active membership means accepted AND not revoked',
    active && /accepted_at\s+is not null/.test(active) && /revoked_at\s+is null/.test(active));
  t('C9 and the caller is auth.uid(), never a parameter', active && /m\.user_id\s+= auth\.uid\(\)/.test(active) && !/p_user/.test(active));
  const prop = fn(MIG, 'is_member_of_property');
  t('C10 is_member_of_property is OWNER or active member of the property\'s organisation',
    prop && /p\.user_id = auth\.uid\(\)/.test(prop) && /public\.is_active_member_of_org\(p\.organization_id\)/.test(prop));
  t('C11 and a property with no organisation admits only its owner', prop && /p\.organization_id is not null and/.test(prop));
  const ids = fn(MIG, 'member_property_ids');
  t('C12 member_property_ids reads the same two conditions',
    ids && /p\.user_id = auth\.uid\(\)/.test(ids) && /public\.is_active_member_of_org\(p\.organization_id\)/.test(ids));
  const sto = fn(MIG, 'storage_object_accessible');
  t('C13 storage: the uid shape requires the caller\'s OWN uid — the SEC-1 rule, unchanged',
    sto && /\(storage\.foldername\(object_name\)\)\[1\] = auth\.uid\(\)::text/.test(sto));
  t('C14 storage: the organisation shape requires a LIVE membership row',
    sto && /m\.accepted_at is not null/.test(sto) && /m\.revoked_at\s+is null/.test(sto) &&
    /m\.organization_id::text = \(storage\.foldername\(object_name\)\)\[1\]/.test(sto));
  t('C15 storage: no path shape is a grant on its own — both branches read a row or auth.uid()',
    sto && !/\btrue\b/.test(sto));
}

sec('D. Every property-scoped landlord policy reads the helpers, not the old join');
{
  const IN_POLICIES = [
    'tenants_owner_all', 'lease_jobs_owner_all', 'tfe_owner_all', 'tra_owner_all',
    'cam_recon_owner_all', 'lease_docs_owner_all', 'tenant_users_landlord_all',
    'tenant_invitations_landlord_all', 'tenant_statements_landlord_all',
    'payments_landlord_select', 'payment_sources_landlord_select',
    'payment_settlements_landlord_select', 'payment_events_landlord_select',
  ];
  for (const p of IN_POLICIES) {
    const body = policy(MIG, p);
    t(`D1 ${p} is rewritten`, !!body);
    if (!body) continue;
    t(`D2 ${p} reads member_property_ids()`, /property_id in \(select public\.member_property_ids\(\)\)/.test(body));
    t(`D3 ${p} no longer joins on user_id = auth.uid()`, !/user_id = auth\.uid\(\)/.test(body));
    t(`D4 ${p} is preceded by drop policy if exists (idempotent)`,
      new RegExp('drop policy if exists "?' + p + '"? on public\\.').test(MIG));
  }
  const props = policy(MIG, 'properties_owner_all');
  t('D5 properties_owner_all: owner OR active member',
    props && /user_id = auth\.uid\(\)/.test(props) && /public\.is_active_member_of_org\(organization_id\)/.test(props));
  t('D6 properties_owner_all: the with-check keeps the same rule (a member cannot re-home a property elsewhere)',
    props && (props.match(/is_active_member_of_org\(organization_id\)/g) || []).length === 2);
  // The four ALL policies that carry a with check must carry the helper there too.
  for (const p of ['tenants_owner_all', 'lease_docs_owner_all', 'cam_recon_owner_all', 'tenant_statements_landlord_all']) {
    const body = policy(MIG, p);
    t(`D7 ${p} applies the rule to writes (with check) as well as reads`,
      body && /with check\s*\(\s*property_id in \(select public\.member_property_ids\(\)\)/.test(body));
  }
  // The four payment policies were created without `to authenticated` (022), and
  // must stay that way — a role target added here would change who is denied.
  for (const p of ['payments_landlord_select', 'payment_sources_landlord_select', 'payment_settlements_landlord_select', 'payment_events_landlord_select']) {
    const body = policy(MIG, p);
    t(`D8 ${p} keeps its 022 role target (none)`, body && !/to authenticated/.test(body));
  }
}

sec('E. Storage policies');
{
  for (const p of ['docs_owner_read', 'docs_owner_insert', 'docs_owner_update', 'docs_owner_delete']) {
    const body = policy(MIG, p);
    t(`E1 ${p} is rewritten`, !!body);
    if (!body) continue;
    t(`E2 ${p} still limits itself to the two document buckets`, /bucket_id in \('leases', 'invoices'\)/.test(body));
    t(`E3 ${p} reads storage_object_accessible(name)`, /public\.storage_object_accessible\(name\)/.test(body));
    t(`E4 ${p} is for authenticated only`, /to authenticated/.test(body));
  }
  const upd = policy(MIG, 'docs_owner_update');
  t('E5 update applies the rule to both the row it finds and the row it leaves',
    upd && (upd.match(/storage_object_accessible\(name\)/g) || []).length === 2);
}

sec('F. Default organisation, backfill, and the payment RPC guard');
{
  const trg = MIG.slice(MIG.indexOf('create or replace function public.properties_default_organization()'), MIG.indexOf('create trigger properties_default_organization'));
  t('F1 a BEFORE INSERT trigger gives a new property its owner\'s organisation',
    /create trigger properties_default_organization\s+before insert on public\.properties/.test(MIG));
  t('F2 which never overrides an organisation the insert already names', /if new\.organization_id is not null/.test(trg));
  t('F3 and creates the user\'s organisation and admin membership when they have none',
    /insert into public\.organizations/.test(trg) && /insert into public\.organization_members[\s\S]*'admin'/.test(trg));
  t('F4 the trigger is security definer with an empty search_path', /security definer/.test(trg) && /set search_path = ''/.test(trg));

  const bf = MIG.slice(MIG.indexOf('-- ── Backfill'), MIG.indexOf('-- ── RLS on the new tables'));
  t('F5 backfill: one organisation per auth user — including users who own no property',
    /insert into public\.organizations[\s\S]*from auth\.users u/.test(bf));
  t('F6 backfill: idempotent — skips users who already have one', /where not exists \(select 1 from public\.organizations o where o\.created_by = u\.id\)/.test(bf));
  t('F7 backfill: the creator is an ACCEPTED admin', /'admin', now\(\)/.test(bf));
  t('F8 backfill: every property joins its owner\'s organisation', /update public\.properties p\s+set organization_id/.test(bf) && /where p\.organization_id is null/.test(bf));

  const pay = fn(MIG, '_payment_assert_owner');
  t('F9 _payment_assert_owner is rewritten to the same rule', pay && /public\.is_member_of_property\(p_property_id\)/.test(pay));
  t('F10 and still raises insufficient_privilege', pay && /errcode = 'insufficient_privilege'/.test(pay));
}

sec('G. Untouched, deliberately');
{
  t('G1 acquisition_reviews is not rewritten (no property_id until 023)', !/create policy "?acq_reviews_owner_all/.test(MIG) && !/on public\.acquisition_reviews/.test(MIG));
  t('G2 no tenant-side policy is rewritten',
    !/tenant_self_select|tenants_tenant_self_select|_tenant_select/.test(MIG.replace(/^--.*$/gm, '')));
  t('G3 no service_role policy on an existing table is touched',
    !/drop policy if exists "?[a-z_]+_service_role[a-z_]*"? on public\.(properties|tenants|lease_|cam_|tenant_)/.test(MIG));
  t('G4 nothing is moved in storage — no update of storage.objects.name', !/update storage\.objects/.test(MIG));
  t('G5 no XRPL configuration is referenced', !/xrpl|ripple|wallet_seed/i.test(MIG));
}

sec('H. The rollback restores every rewritten policy by name and removes every new object');
{
  const REWRITTEN = [
    'properties_owner_all', 'tenants_owner_all', 'lease_jobs_owner_all', 'tfe_owner_all', 'tra_owner_all',
    'cam_recon_owner_all', 'lease_docs_owner_all', 'tenant_users_landlord_all',
    'tenant_invitations_landlord_all', 'tenant_statements_landlord_all',
    'payments_landlord_select', 'payment_sources_landlord_select',
    'payment_settlements_landlord_select', 'payment_events_landlord_select',
    'docs_owner_read', 'docs_owner_insert', 'docs_owner_update', 'docs_owner_delete',
  ];
  for (const p of REWRITTEN) {
    const body = policy(RB, p);
    t(`H1 rollback recreates ${p}`, !!body);
    if (!body) continue;
    const preText = /^docs_owner_/.test(p)
      ? /\(storage\.foldername\(name\)\)\[1\] = auth\.uid\(\)::text/     // 011: own uid prefix only
      : /user_id = auth\.uid\(\)/;                                      // owner join
    t(`H2 rollback ${p} reads its pre-024 predicate again, and no helper`,
      preText.test(body) && !/member_property_ids|is_active_member_of_org|storage_object_accessible/.test(body));
  }
  t('H3 rollback restores _payment_assert_owner to the 022 text',
    /_payment_assert_owner[\s\S]*where id = p_property_id and user_id = auth\.uid\(\)/.test(RB));
  for (const h of ['storage_object_accessible', 'member_property_ids', 'is_member_of_property', 'is_active_member_of_org', 'properties_default_organization']) {
    t(`H4 rollback drops ${h}`, new RegExp('drop function if exists public\\.' + h + '\\(').test(RB));
  }
  t('H5 rollback drops the trigger', /drop trigger\s+if exists properties_default_organization on public\.properties/.test(RB));
  t('H6 rollback drops the column', /alter table public\.properties drop column if exists organization_id/.test(RB));
  t('H7 rollback drops both tables, members first', RB.indexOf('drop table if exists public.organization_members') < RB.indexOf('drop table if exists public.organizations'));
  t('H8 rollback drops the column BEFORE the organizations table it references',
    RB.indexOf('drop column if exists organization_id') < RB.indexOf('drop table if exists public.organizations'));
  t('H9 rollback drops the helpers AFTER the policies that call them are replaced',
    RB.indexOf('drop function if exists public.member_property_ids') > RB.lastIndexOf('create policy'));
  t('H10 rollback is one transaction', /^begin;/m.test(RB) && /^commit;/m.test(RB));
}

sec('I. The application side names the same rule');
{
  const MEM = fs.readFileSync(path.join(ROOT, 'api/_membership.js'), 'utf8');
  t('I1 api/_membership.js reads accepted AND not revoked — the same predicate as the SQL',
    (MEM.match(/accepted_at=not\.is\.null&revoked_at=is\.null/g) || []).length >= 2);
  t('I2 and states that nothing is cached', /Nothing here is cached/.test(MEM));
  const AC = fs.readFileSync(path.join(ROOT, 'access-control.js'), 'utf8');
  t('I3 access-control.js lists the same five roles, as labels',
    /ORG_ROLES = Object\.freeze\(\['admin', 'property_manager', 'accounting', 'leasing', 'read_only'\]\)/.test(AC));
  t('I4 and no client-side check branches on them yet (labels only)',
    !/ORG_ROLES\.(includes|indexOf)[\s\S]*?(return false|deny)/.test(AC.slice(AC.indexOf('function isOrgRole') + 200)));
}

// Optional: a real parse, when the PostgreSQL parser is installed nearby. Not
// an assertion — its absence is not a failure, and its presence is stated.
{
  let parser = null;
  for (const cand of ['@pgsql/parser']) { try { parser = require(cand); break; } catch (_) {} }
  if (parser) {
    (async () => {
      const p = new parser.Parser({ version: 16 });
      for (const [name, src] of [['024_organizations.sql', MIG], ['024_organizations_rollback.sql', RB]]) {
        try { await p.parse(src); t(`P ${name} parses as PostgreSQL 16`, true); }
        catch (e) { t(`P ${name} parses as PostgreSQL 16`, false, e.message); }
      }
      finish();
    })();
  } else {
    console.log('\n  (no PostgreSQL parser installed here — syntax was checked with @pgsql/parser at authoring time; the live gate is the proof)');
    finish();
  }
}

function finish() {
  console.log('\n' + '─'.repeat(58));
  if (fail) {
    console.log(`\x1b[31mRESULT: ${pass} passed, ${fail} failed\x1b[0m`);
    failures.forEach(f => console.log(`  · ${f}`));
    process.exit(1);
  }
  console.log(`\x1b[32mRESULT: ${pass} passed, 0 failed\x1b[0m`);
}
