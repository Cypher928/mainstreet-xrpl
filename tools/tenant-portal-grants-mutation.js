'use strict';
/**
 * tools/tenant-portal-grants-mutation.js — would the verifier notice if a
 * tenant-portal grant were wrong?
 *
 *   node tools/tenant-portal-grants-mutation.js
 *
 * Each mutant is one plausible edit to 018b (or its rollback). A SURVIVOR means
 * tools/verify-migration-018b.js would not have noticed and is either a real
 * gap or an equivalent mutant that must be argued for. The verifier runs against
 * a throwaway PostgreSQL cluster; no Supabase project is contacted.
 *
 *     B01  service_role cannot INSERT a space profile (the CI fixture)
 *     B02  service_role cannot UPDATE a statement (unpublish)
 *     B03  statement sources get INSERT only — the fixture's
 *          return=representation needs SELECT too
 *     B04  authenticated cannot SELECT documents (the portal's read)
 *     B05  authenticated gains SELECT on document sources (storage paths)
 *     B06  service_role gains DELETE on documents
 *     B07  profile sources are not revoked first (Pilot keeps every privilege)
 *     B08  authenticated gains UPDATE on statements (landlord writes woken up)
 *     B09  anon gains SELECT on documents
 *     B10  the rollback forgets document sources
 *     B11  service_role cannot SELECT document sources (document-url)
 *     B12  authenticated cannot SELECT statements (the portal and payment_balances)
 *
 * A FAILING BASELINE IS NOT A PASS.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const M = 'migrations/018b_tenant_portal_privileges.sql';
const R = 'migrations/018b_tenant_portal_privileges_rollback.sql';
const SB2   = ['node', 'test-b2-contract.js'];
const S018B = ['node', 'tools/verify-migration-018b.js'];
const V = [S018B];

const MUTANTS = [
  { id: 'B01', file: M, suites: V, why: 'service_role cannot INSERT a space profile',
    from: 'grant select, insert         on public.tenant_space_profiles    to service_role;',
    to:   'grant select                 on public.tenant_space_profiles    to service_role;' },
  { id: 'B02', file: M, suites: V, why: 'service_role cannot UPDATE a statement',
    from: 'grant select, insert, update on public.tenant_statements        to service_role;',
    to:   'grant select, insert         on public.tenant_statements        to service_role;' },
  { id: 'B03', file: M, suites: V, why: 'statement sources get INSERT only',
    from: 'grant select, insert         on public.tenant_statement_sources to service_role;',
    to:   'grant insert                 on public.tenant_statement_sources to service_role;' },
  { id: 'B04', file: M, suites: V, why: 'authenticated cannot SELECT documents',
    from: 'grant select                 on public.tenant_documents         to authenticated;\n', to: '' },
  { id: 'B05', file: M, suites: V, why: 'authenticated gains SELECT on document sources',
    from: 'grant select, insert         on public.tenant_document_sources  to service_role;',
    to:   'grant select, insert         on public.tenant_document_sources  to service_role;\ngrant select on public.tenant_document_sources to authenticated;' },
  { id: 'B06', file: M, suites: V, why: 'service_role gains DELETE on documents',
    from: 'grant select, insert, update on public.tenant_documents         to service_role;',
    to:   'grant select, insert, update, delete on public.tenant_documents to service_role;' },
  { id: 'B07', file: M, suites: V, why: 'profile sources are not revoked first',
    from: 'revoke all on public.tenant_space_profile_sources from anon, authenticated, service_role;\n', to: '' },
  { id: 'B08', file: M, suites: V, why: 'authenticated gains UPDATE on statements',
    from: 'grant select                 on public.tenant_statements        to authenticated;',
    to:   'grant select, update         on public.tenant_statements        to authenticated;' },
  { id: 'B09', file: M, suites: V, why: 'anon gains SELECT on documents',
    from: 'grant select                 on public.tenant_documents         to authenticated;',
    to:   'grant select                 on public.tenant_documents         to authenticated, anon;' },
  { id: 'B10', file: R, suites: V, why: 'the rollback forgets document sources',
    from: 'grant all on public.tenant_document_sources      to authenticated, service_role;\n', to: '' },
  { id: 'B11', file: M, suites: V, why: 'service_role cannot SELECT document sources',
    from: 'grant select, insert         on public.tenant_document_sources  to service_role;',
    to:   'grant insert                 on public.tenant_document_sources  to service_role;' },
  { id: 'B12', file: M, suites: V, why: 'authenticated cannot SELECT statements',
    from: 'grant select                 on public.tenant_statements        to authenticated;\n', to: '' },
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'b2-grants-mut-'));
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

const ALL_SUITES = [SB2, S018B];
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
