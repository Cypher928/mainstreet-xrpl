'use strict';
/**
 * tools/data-api-grants-mutation.js — would the verifiers notice if a grant or
 * a scope were wrong?
 *
 *   node tools/data-api-grants-mutation.js
 *
 * Each mutant is one plausible edit to 022b, 015b, 024b, 026c, 031 (or their
 * rollbacks), or to the default-privilege model the verifiers run under. A
 * SURVIVOR means the verifiers would not have noticed and is either a real gap
 * or an equivalent mutant that must be argued for. Every suite runs against a
 * throwaway PostgreSQL cluster; no Supabase project is contacted.
 *
 *   022b — payment access scope
 *     A01  the payments policy is left on PUBLIC
 *     A02  the events policy is scoped to authenticated instead of service_role
 *     A03  the settlements policy is left on PUBLIC
 *     A04  the sources policy is left on PUBLIC
 *     A05  _payment_settled_total keeps its EXECUTE grants
 *     A06  _payment_derive_state keeps its EXECUTE grants
 *     A07  _payment_replay is revoked from the API roles but not from PUBLIC
 *     A08  _payment_settled_total is revoked from anon only
 *     A09  the rollback forgets to re-open the events policy
 *
 *   015b — tenant_users / tenant_invitations
 *     T01  service_role loses DELETE (the authz fixture's reset)
 *     T02  service_role loses UPDATE (the accept-invite upsert)
 *     T03  authenticated gains INSERT on tenant_users
 *     T04  authenticated loses SELECT (the portal's own read)
 *     T05  service_role gets nothing on tenant_invitations
 *     T06  service_role gains INSERT on tenant_invitations
 *     T07  authenticated gains SELECT on tenant_invitations
 *     T08  tenant_users is not revoked first (Pilot keeps every privilege)
 *     T09  tenant_invitations is not revoked first
 *     T10  anon gains SELECT on tenant_users
 *     T11  the rollback forgets tenant_invitations
 *
 *   024b — acquisition_document_families
 *     F01  authenticated loses UPDATE (the upsert's conflict path)
 *     F02  authenticated loses INSERT
 *     F03  authenticated gains DELETE
 *     F04  service_role gains SELECT
 *     F05  the table is not revoked first (Pilot keeps every privilege)
 *     F06  anon gains SELECT
 *
 *   026c — acquisition_term_decisions
 *     C01  authenticated loses INSERT
 *     C02  authenticated gains UPDATE (append-only left to the trigger alone)
 *     C03  the table is not revoked first
 *     C04  authenticated gains DELETE
 *     C05  service_role gains SELECT
 *
 *   031 — pilot_requests
 *     P01  service_role is granted SELECT as well as INSERT
 *     P02  service_role is granted nothing
 *     P03  anon is granted INSERT
 *     P04  the shape guard never fires
 *     P05  the primary-key guard never fires
 *     P06  the table is not revoked first (Pilot keeps every privilege)
 *     P07  row-level security is not enabled on a new table
 *     P08  the created_at index is not created on a new table
 *     P09  the new table's email is nullable
 *     P10  the rollback drops the table
 *
 *   The model the verifiers run under
 *     V01  verify-024 never switches to the post-October-30 defaults
 *     V02  verify-026 never switches to the post-October-30 defaults
 *     V03  the shared post-October-30 model grants tables after all
 *
 * A FAILING BASELINE IS NOT A PASS.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const A = 'migrations/022b_payment_access_scope.sql';
const AR = 'migrations/022b_payment_access_scope_rollback.sql';
const TB = 'migrations/015b_tenant_access_privileges.sql';
const TR = 'migrations/015b_tenant_access_privileges_rollback.sql';
const F = 'migrations/024b_acquisition_document_families_privileges.sql';
const C = 'migrations/026c_acquisition_term_decisions_privileges.sql';
const P = 'migrations/031_pilot_requests.sql';
const PR = 'migrations/031_pilot_requests_rollback.sql';
const V24 = 'tools/verify-migration-024.js';
const V26 = 'tools/verify-migration-026.js';
const PGT = 'tools/_pg-throwaway.js';

const S022B = ['node', 'tools/verify-migration-022b.js'];
const SCON  = ['node', 'test-payment-schema-contract.js'];
const S015B = ['node', 'tools/verify-migration-015b.js'];
const S024  = ['node', 'tools/verify-migration-024.js'];
const S026  = ['node', 'tools/verify-migration-026.js'];
const S031  = ['node', 'tools/verify-migration-031.js'];

const TU_SVC = 'grant select, insert, update, delete on public.tenant_users       to service_role;';
const TU_AUTH = 'grant select                         on public.tenant_users       to authenticated;';
const TI_SVC = 'grant select, update                 on public.tenant_invitations to service_role;';

const MUTANTS = [
  // ── 022b ─────────────────────────────────────────────────────────────────
  { id: 'A01', file: A, suites: [SCON, S022B], why: 'the payments policy is left on PUBLIC',
    from: 'alter policy payments_service_role_all            on public.payments            to service_role;\n', to: '' },
  { id: 'A02', file: A, suites: [SCON, S022B], why: 'the events policy is scoped to authenticated',
    from: 'on public.payment_events      to service_role;', to: 'on public.payment_events      to authenticated;' },
  { id: 'A03', file: A, suites: [SCON, S022B], why: 'the settlements policy is left on PUBLIC',
    from: 'alter policy payment_settlements_service_role_all on public.payment_settlements to service_role;\n', to: '' },
  { id: 'A04', file: A, suites: [SCON, S022B], why: 'the sources policy is left on PUBLIC',
    from: 'alter policy payment_sources_service_role_all     on public.payment_sources     to service_role;\n', to: '' },
  { id: 'A05', file: A, suites: [SCON, S022B], why: '_payment_settled_total keeps its EXECUTE grants',
    from: 'revoke all on function public._payment_settled_total(uuid)  from public, anon, authenticated, service_role;\n', to: '' },
  { id: 'A06', file: A, suites: [SCON, S022B], why: '_payment_derive_state keeps its EXECUTE grants',
    from: 'revoke all on function public._payment_derive_state(uuid)   from public, anon, authenticated, service_role;\n', to: '' },
  { id: 'A07', file: A, suites: [SCON, S022B], why: '_payment_replay is not revoked from PUBLIC',
    from: 'public._payment_replay(uuid, uuid)   from public, anon,', to: 'public._payment_replay(uuid, uuid)   from anon,' },
  { id: 'A08', file: A, suites: [SCON, S022B], why: '_payment_settled_total is revoked from anon only',
    from: 'public._payment_settled_total(uuid)  from public, anon, authenticated, service_role;',
    to:   'public._payment_settled_total(uuid)  from anon;' },
  { id: 'A09', file: AR, suites: [SCON, S022B], why: 'the rollback forgets to re-open the events policy',
    from: 'alter policy payment_events_service_role_all      on public.payment_events      to public;\n', to: '' },

  // ── 015b ─────────────────────────────────────────────────────────────────
  { id: 'T01', file: TB, suites: [S015B], why: 'service_role loses DELETE on tenant_users',
    from: TU_SVC, to: 'grant select, insert, update         on public.tenant_users       to service_role;' },
  { id: 'T02', file: TB, suites: [S015B], why: 'service_role loses UPDATE on tenant_users',
    from: TU_SVC, to: 'grant select, insert, delete         on public.tenant_users       to service_role;' },
  { id: 'T03', file: TB, suites: [S015B], why: 'authenticated gains INSERT on tenant_users',
    from: TU_AUTH, to: 'grant select, insert                 on public.tenant_users       to authenticated;' },
  { id: 'T04', file: TB, suites: [S015B], why: 'authenticated loses SELECT on tenant_users',
    from: TU_AUTH + '\n', to: '' },
  { id: 'T05', file: TB, suites: [S015B], why: 'service_role gets nothing on tenant_invitations',
    from: TI_SVC + '\n', to: '' },
  { id: 'T06', file: TB, suites: [S015B], why: 'service_role gains INSERT on tenant_invitations',
    from: TI_SVC, to: 'grant select, insert, update         on public.tenant_invitations to service_role;' },
  { id: 'T07', file: TB, suites: [S015B], why: 'authenticated gains SELECT on tenant_invitations',
    from: TI_SVC, to: TI_SVC + '\ngrant select on public.tenant_invitations to authenticated;' },
  { id: 'T08', file: TB, suites: [S015B], why: 'tenant_users is not revoked first',
    from: 'revoke all on public.tenant_users       from anon, authenticated, service_role;\n', to: '' },
  { id: 'T09', file: TB, suites: [S015B], why: 'tenant_invitations is not revoked first',
    from: 'revoke all on public.tenant_invitations from anon, authenticated, service_role;\n', to: '' },
  { id: 'T10', file: TB, suites: [S015B], why: 'anon gains SELECT on tenant_users',
    from: TU_AUTH, to: TU_AUTH + '\ngrant select on public.tenant_users to anon;' },
  { id: 'T11', file: TR, suites: [S015B], why: 'the rollback forgets tenant_invitations',
    from: 'grant all  on public.tenant_invitations to authenticated, service_role;\n', to: '' },

  // ── 024b ─────────────────────────────────────────────────────────────────
  { id: 'F01', file: F, suites: [S024], why: 'authenticated loses UPDATE',
    from: 'grant select, insert, update on public.acquisition_document_families to authenticated;',
    to:   'grant select, insert on public.acquisition_document_families to authenticated;' },
  { id: 'F02', file: F, suites: [S024], why: 'authenticated loses INSERT',
    from: 'grant select, insert, update on public.acquisition_document_families to authenticated;',
    to:   'grant select, update on public.acquisition_document_families to authenticated;' },
  { id: 'F03', file: F, suites: [S024], why: 'authenticated gains DELETE',
    from: 'grant select, insert, update on public.acquisition_document_families to authenticated;',
    to:   'grant select, insert, update, delete on public.acquisition_document_families to authenticated;' },
  { id: 'F04', file: F, suites: [S024], why: 'service_role gains SELECT',
    from: 'to authenticated;\n', to: 'to authenticated;\ngrant select on public.acquisition_document_families to service_role;\n' },
  { id: 'F05', file: F, suites: [S024], why: 'the table is not revoked first',
    from: 'revoke all on public.acquisition_document_families from anon, authenticated, service_role;\n', to: '' },
  { id: 'F06', file: F, suites: [S024], why: 'anon gains SELECT',
    from: 'to authenticated;\n', to: 'to authenticated;\ngrant select on public.acquisition_document_families to anon;\n' },

  // ── 026c ─────────────────────────────────────────────────────────────────
  { id: 'C01', file: C, suites: [S026], why: 'authenticated loses INSERT',
    from: 'grant select, insert on public.acquisition_term_decisions to authenticated;',
    to:   'grant select on public.acquisition_term_decisions to authenticated;' },
  { id: 'C02', file: C, suites: [S026], why: 'authenticated gains UPDATE',
    from: 'grant select, insert on public.acquisition_term_decisions to authenticated;',
    to:   'grant select, insert, update on public.acquisition_term_decisions to authenticated;' },
  { id: 'C03', file: C, suites: [S026], why: 'the table is not revoked first',
    from: 'revoke all on public.acquisition_term_decisions from anon, authenticated, service_role;\n', to: '' },
  { id: 'C04', file: C, suites: [S026], why: 'authenticated gains DELETE',
    from: 'grant select, insert on public.acquisition_term_decisions to authenticated;',
    to:   'grant select, insert, delete on public.acquisition_term_decisions to authenticated;' },
  { id: 'C05', file: C, suites: [S026], why: 'service_role gains SELECT',
    from: 'to authenticated;\n', to: 'to authenticated;\ngrant select on public.acquisition_term_decisions to service_role;\n' },

  // ── 031 ──────────────────────────────────────────────────────────────────
  { id: 'P01', file: P, suites: [S031], why: 'service_role is granted SELECT as well',
    from: 'grant insert on public.pilot_requests to service_role;', to: 'grant select, insert on public.pilot_requests to service_role;' },
  { id: 'P02', file: P, suites: [S031], why: 'service_role is granted nothing',
    from: 'grant insert on public.pilot_requests to service_role;\n', to: '' },
  { id: 'P03', file: P, suites: [S031], why: 'anon is granted INSERT',
    from: 'grant insert on public.pilot_requests to service_role;', to: 'grant insert on public.pilot_requests to service_role, anon;' },
  { id: 'P04', file: P, suites: [S031], why: 'the shape guard never fires',
    from: '  if actual is distinct from expected then', to: '  if false then' },
  { id: 'P05', file: P, suites: [S031], why: 'the primary-key guard never fires',
    from: "  if pk is distinct from 'id' then", to: '  if false then' },
  { id: 'P06', file: P, suites: [S031], why: 'the table is not revoked first',
    from: 'revoke all on public.pilot_requests from anon, authenticated, service_role;\n', to: '' },
  { id: 'P07', file: P, suites: [S031], why: 'RLS is not enabled on a new table',
    from: 'alter table public.pilot_requests enable row level security;\n', to: '' },
  { id: 'P08', file: P, suites: [S031], why: 'the created_at index is not created on a new table',
    from: 'create index if not exists pilot_requests_created_at_idx\n  on public.pilot_requests (created_at desc);\n', to: '' },
  { id: 'P09', file: P, suites: [S031], why: "the new table's email is nullable",
    from: '  email       text not null,', to: '  email       text,' },
  { id: 'P10', file: PR, suites: [S031], why: 'the rollback drops the table',
    from: 'grant all  on public.pilot_requests to anon, authenticated, service_role;',
    to:   'drop table public.pilot_requests;' },

  // ── the model the verifiers run under ────────────────────────────────────
  { id: 'V01', file: V24, suites: [S024], why: 'verify-024 never switches to the post-October-30 defaults',
    from: "  if (f === '023_acquisition_documents.sql') switchToPostOct30();\n", to: '' },
  { id: 'V02', file: V26, suites: [S026], why: 'verify-026 never switches to the post-October-30 defaults',
    from: "  if (f === '023_acquisition_documents.sql') switchToPostOct30();\n", to: '' },
  { id: 'V03', file: PGT, suites: [S015B, S031], why: 'the shared post-October-30 model grants tables after all',
    from: 'alter default privileges in schema public revoke all     on tables    from anon, authenticated, service_role;',
    to:   'alter default privileges in schema public grant all      on tables    to anon, authenticated, service_role;' },
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'grants-mut-'));
for (const entry of fs.readdirSync(ROOT)) {
  if (['node_modules', '.git', 'scratchpad', 'evidence', 'assets'].includes(entry)) continue;
  fs.cpSync(path.join(ROOT, entry), path.join(tmp, entry), { recursive: true });
}
try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(tmp, 'node_modules'), 'dir'); } catch (_) {}
// The verifiers drop to the postgres user when run as root; it must be able to read the copy.
try { fs.chmodSync(tmp, 0o755); } catch (_) {}

const FILES = [...new Set(MUTANTS.map(m => m.file))];
const ORIGINAL = {};
for (const f of FILES) ORIGINAL[f] = fs.readFileSync(path.join(ROOT, f), 'utf8');

function run(suites) {
  for (const [bin, suite] of suites) {
    try { execFileSync(bin, [suite], { cwd: tmp, stdio: 'pipe', timeout: 900000 }); }
    catch (_) { return false; }
  }
  return true;
}

const ALL_SUITES = [SCON, S022B, S015B, S024, S026, S031];
const baseline = run(ALL_SUITES);
console.log('Baseline (unmutated copy): ' + (baseline ? 'PASS' : 'FAIL'));
if (!baseline) {
  console.error('\nThe unmutated copy does not pass, so every result below would be\n' +
                'meaningless. Nothing is mutated. Fix the harness or the suites first.');
  for (const [bin, suite] of ALL_SUITES) {
    try { execFileSync(bin, [suite], { cwd: tmp, stdio: 'pipe', timeout: 900000 }); }
    catch (e) { console.error('\n── ' + suite + ' ──\n' + String(e.stdout || e.message).slice(-3000)); }
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(2);
}

let killed = 0;
const survived = [];
for (const m of MUTANTS) {
  const src = ORIGINAL[m.file];
  const i = src.indexOf(m.from);
  if (i === -1) { console.log(`  ??   ${m.id}  ANCHOR NOT FOUND in ${m.file} — malformed mutant`); survived.push(m.id + ' (malformed)'); continue; }
  if (src.indexOf(m.from, i + 1) !== -1) { console.log(`  ??   ${m.id}  ANCHOR NOT UNIQUE in ${m.file} — malformed mutant`); survived.push(m.id + ' (not unique)'); continue; }
  if (m.to === m.from) { console.log(`  ??   ${m.id}  NO-OP MUTANT`); survived.push(m.id + ' (no-op)'); continue; }
  fs.writeFileSync(path.join(tmp, m.file), src.slice(0, i) + m.to + src.slice(i + m.from.length));
  const passedM = run(m.suites);
  fs.writeFileSync(path.join(tmp, m.file), src);
  if (passedM) { survived.push(`${m.id} (${m.file}): ${m.why}`); console.log(`  LIVE ${m.id}  ${m.why}`); }
  else         { killed++;                                      console.log(`  kill ${m.id}  ${m.why}`); }
}

console.log(`\n${killed}/${MUTANTS.length} killed`);
if (survived.length) {
  console.log('\nSURVIVORS — each needs a written verdict (real gap or equivalent):');
  survived.forEach(s => console.log('  · ' + s));
}
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(survived.length ? 1 : 0);
