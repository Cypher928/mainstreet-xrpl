'use strict';
/**
 * tools/operating-tables-mutation.js — would anyone notice if a rule of the
 * PROPOSED migration 048 (operating tables: members read, editors write) were
 * quietly undone?
 *
 *   node tools/operating-tables-mutation.js
 *   MS_ONLY=T03,T09 node tools/operating-tables-mutation.js
 *
 * Each mutant undoes ONE rule in migrations/048_operating_tables_member_write
 * _rules.sql (or its rollback), and tools/verify-migration-048.js (a throwaway
 * PostgreSQL cluster; no Supabase project is contacted) must fail for every
 * one. MS_PG_SERVER_BIN, when set, is passed through.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const F  = 'migrations/048_operating_tables_member_write_rules.sql';
const RB = 'migrations/048_operating_tables_member_write_rules_rollback.sql';
const MEMBER = '(property_id in (select public.member_property_ids()))';
const back = (table, rule, kind) => ({
  from: `create policy ${rule} on public.${table}\n  for ${kind} to authenticated ${kind === 'insert' ? 'with check' : 'using'} (public.can_edit_property(property_id))${kind === 'update' ? ' with check (public.can_edit_property(property_id))' : ''};`,
  to:   `create policy ${rule} on public.${table}\n  for ${kind} to authenticated ${kind === 'insert' ? 'with check' : 'using'} ${MEMBER}${kind === 'update' ? ` with check ${MEMBER}` : ''};`,
});
const MUTANTS = [
  { id: 'T01', why: 'a read-only member may add leaseholds', ...back('tenants', 'tenants_editor_insert', 'insert') },
  { id: 'T02', why: 'a read-only member may change leaseholds', ...back('tenants', 'tenants_editor_update', 'update') },
  { id: 'T03', why: 'a read-only member may file lease jobs', ...back('lease_jobs', 'lease_jobs_editor_insert', 'insert') },
  { id: 'T04', why: 'a read-only member may change lease jobs', ...back('lease_jobs', 'lease_jobs_editor_update', 'update') },
  { id: 'T05', why: 'a read-only member may delete lease jobs', ...back('lease_jobs', 'lease_jobs_editor_delete', 'delete') },
  { id: 'T06', why: 'a read-only member may add evidence', ...back('tenant_field_evidence', 'tfe_editor_insert', 'insert') },
  { id: 'T07', why: 'a read-only member may add audit rows', ...back('tenant_review_audit', 'tra_editor_insert', 'insert') },
  { id: 'T08', why: 'a read-only member may write CAM results', ...back('cam_reconciliations', 'cam_recon_editor_insert', 'insert') },
  { id: 'T09', why: 'a read-only member may change CAM results', ...back('cam_reconciliations', 'cam_recon_editor_update', 'update') },
  { id: 'T10', why: 'a read-only member may delete CAM results', ...back('cam_reconciliations', 'cam_recon_editor_delete', 'delete') },
  { id: 'T11', why: 'evidence and audit rows may be rewritten or removed by signed-in people (no longer append-only)',
    from: "revoke update, delete on public.tenant_field_evidence, public.tenant_review_audit from authenticated;\n", to: "" },
  { id: 'T12', why: 'read-only members lose their reads of leaseholds',
    from: "create policy tenants_member_select on public.tenants\n  for select to authenticated using (property_id in (select public.member_property_ids()));",
    to:   "create policy tenants_member_select on public.tenants\n  for select to authenticated using (public.can_edit_property(property_id));" },
  { id: 'T13', why: 'the dormant landlord write rule on tenant_users is kept (a later grant would let every member write memberships)',
    from: "create policy tenant_users_landlord_select on public.tenant_users\n  for select to authenticated using (property_id in (select public.member_property_ids()));",
    to:   `create policy tenant_users_landlord_select on public.tenant_users\n  for all to authenticated using ${MEMBER} with check ${MEMBER};` },
  { id: 'T14', why: 'invitations may be issued by every member once a grant exists, not only admins',
    from: "  using      (public.is_property_admin(property_id))\n  with check (public.is_property_admin(property_id));",
    to:   `  using      ${MEMBER}\n  with check ${MEMBER};` },
  { id: 'T15', why: 'invitations may be issued by editors once a grant exists',
    from: "  using      (public.is_property_admin(property_id))\n  with check (public.is_property_admin(property_id));",
    to:   "  using      (public.can_edit_property(property_id))\n  with check (public.can_edit_property(property_id));" },
  { id: 'T16', why: 'anon keeps its grants on the eight tables',
    from: "revoke all on public.tenants, public.lease_jobs, public.tenant_field_evidence, public.tenant_review_audit, public.cam_reconciliations,\n              public.tenant_users, public.tenant_invitations, public.tenant_statements from anon;\n", to: "" },
  { id: 'T17', why: 'authenticated keeps TRUNCATE on the eight tables',
    from: "revoke truncate, references, trigger on public.tenants, public.lease_jobs, public.tenant_field_evidence, public.tenant_review_audit,\n              public.cam_reconciliations, public.tenant_users, public.tenant_invitations, public.tenant_statements from authenticated;\n", to: "" },
  { id: 'T18', why: 'the migration runs without 045', from: "    raise exception '048 requires 045 (can_edit_property)';", to: "    null;" },
  { id: 'T19', why: 'the migration runs on a database without the Pilot marker', from: "    raise exception 'REFUSING TO RUN: pilot marker property not found.", to: "    raise notice 'REFUSING TO RUN: pilot marker property not found." },
  { id: 'T20', file: RB, why: 'the rollback does not restore the grants',
    from: "grant all on public.tenants, public.lease_jobs, public.tenant_field_evidence, public.tenant_review_audit, public.cam_reconciliations to anon, authenticated;\n", to: "" },
  { id: 'T21', file: RB, why: 'the rollback leaves the append-only rules in place',
    from: "drop policy if exists tfe_editor_insert on public.tenant_field_evidence;\n", to: "" },
];

const ONLY = (process.env.MS_ONLY || '').split(',').filter(Boolean);
if (ONLY.length) MUTANTS.splice(0, MUTANTS.length, ...MUTANTS.filter(m => ONLY.includes(m.id)));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'operating-tables-mut-'));
for (const entry of ['migrations', 'tools']) fs.cpSync(path.join(ROOT, entry), path.join(tmp, entry), { recursive: true });
const ORIG = { [F]: fs.readFileSync(path.join(ROOT, F), 'utf8'), [RB]: fs.readFileSync(path.join(ROOT, RB), 'utf8') };
const verify = () => {
  try { execFileSync(process.execPath, ['tools/verify-migration-048.js'], { cwd: tmp, stdio: 'pipe', timeout: 900000, env: process.env }); return true; }
  catch (_) { return false; }
};

const baseline = verify();
console.log('Baseline (unmutated copy): ' + (baseline ? 'PASS' : 'FAIL'));
if (!baseline) {
  console.error('\nThe unmutated copy does not pass, so every result below would be\nmeaningless. Nothing is mutated. Fix the harness or the verifier first.');
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(2);
}

let killed = 0;
const survived = [];
const equivalent = [];
for (const m of MUTANTS) {
  const file = m.file || F;
  const src = ORIG[file];
  const i = src.indexOf(m.from);
  if (i === -1) { console.log(`  ??   ${m.id}  ANCHOR NOT FOUND — malformed mutant`); survived.push(m.id + ' (malformed)'); continue; }
  if (src.indexOf(m.from, i + 1) !== -1) { console.log(`  ??   ${m.id}  ANCHOR NOT UNIQUE — malformed mutant`); survived.push(m.id + ' (anchor not unique)'); continue; }
  fs.writeFileSync(path.join(tmp, file), src.slice(0, i) + m.to + src.slice(i + m.from.length));
  const passed = verify();
  fs.writeFileSync(path.join(tmp, file), src);
  if (!passed) { killed++; console.log(`  kill ${m.id}  ${m.why}`); continue; }
  if (m.equivalent) { equivalent.push(m.id); console.log(`  equiv ${m.id}  ${m.why} (equivalent mutant — see its note)`); continue; }
  survived.push(`${m.id}: ${m.why}`);
  console.log(`  LIVE ${m.id}  ${m.why}`);
}
console.log(`\n${killed}/${MUTANTS.length - equivalent.length} non-equivalent mutants killed` + (equivalent.length ? `; ${equivalent.length} equivalent (${equivalent.join(', ')})` : ''));
if (survived.length) { console.log('\nSURVIVORS — each needs a written verdict (real gap or equivalent):'); survived.forEach(x => console.log('  · ' + x)); }
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(survived.length ? 1 : 0);
