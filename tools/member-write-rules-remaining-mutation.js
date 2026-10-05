'use strict';
/**
 * tools/member-write-rules-remaining-mutation.js — would anyone notice if a
 * rule of migration 047 (the register, the storage folders, the grants) were
 * quietly undone?
 *
 *   node tools/member-write-rules-remaining-mutation.js
 *   MS_ONLY=Q03,Q07 node tools/member-write-rules-remaining-mutation.js
 *
 * Each mutant undoes ONE rule in migrations/047_member_write_rules_remaining
 * .sql (or its rollback), and tools/verify-migration-047.js (a throwaway
 * PostgreSQL cluster; no Supabase project is contacted) must fail for every
 * one. MS_PG_SERVER_BIN, when set, is passed through.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const F  = 'migrations/047_member_write_rules_remaining.sql';
const RB = 'migrations/047_member_write_rules_remaining_rollback.sql';
const MEMBER = '(property_id in (select public.member_property_ids()))';
const MUTANTS = [
  { id: 'Q01', why: 'a read-only member may add register rows',
    from: "create policy lease_docs_editor_insert on public.lease_documents\n  for insert to authenticated\n  with check (public.can_edit_property(property_id));",
    to:   `create policy lease_docs_editor_insert on public.lease_documents\n  for insert to authenticated\n  with check ${MEMBER};` },
  { id: 'Q02', why: 'a read-only member may rename register rows',
    from: "  for update to authenticated\n  using      (public.can_edit_property(property_id))\n  with check (public.can_edit_property(property_id));",
    to:   `  for update to authenticated\n  using      ${MEMBER}\n  with check ${MEMBER};` },
  { id: 'Q03', why: 'a read-only member may delete register rows',
    from: "create policy lease_docs_editor_delete on public.lease_documents\n  for delete to authenticated\n  using (public.can_edit_property(property_id));",
    to:   `create policy lease_docs_editor_delete on public.lease_documents\n  for delete to authenticated\n  using ${MEMBER};` },
  { id: 'Q04', why: 'read-only members lose their reads of the register',
    from: "create policy lease_docs_member_select on public.lease_documents\n  for select to authenticated\n  using (property_id in (select public.member_property_ids()));",
    to:   "create policy lease_docs_member_select on public.lease_documents\n  for select to authenticated\n  using (public.can_edit_property(property_id));" },
  { id: 'Q05', why: 'a read-only member counts as a storage writer',
    from: "              and m.role <> 'read_only'\n              and m.organization_id::text", to: "              and m.organization_id::text" },
  { id: 'Q06', why: 'a revoked or unaccepted member counts as a storage writer',
    from: "              and m.accepted_at is not null and m.revoked_at is null\n              and m.role <> 'read_only'", to: "              and m.role <> 'read_only'" },
  { id: 'Q07', why: 'a person loses their own storage folder',
    from: "  select (storage.foldername(object_name))[1] = auth.uid()::text\n      or exists (", to: "  select exists (" },
  { id: 'Q08', why: 'the storage insert rule still admits every member',
    from: "  with check (bucket_id in ('leases', 'invoices') and public.storage_object_writable(name));\ncreate policy \"docs_owner_update\"",
    to:   "  with check (bucket_id in ('leases', 'invoices') and public.storage_object_accessible(name));\ncreate policy \"docs_owner_update\"" },
  { id: 'Q09', why: 'the storage update rule still admits every member',
    from: "  using      (bucket_id in ('leases', 'invoices') and public.storage_object_writable(name))\n  with check (bucket_id in ('leases', 'invoices') and public.storage_object_writable(name));",
    to:   "  using      (bucket_id in ('leases', 'invoices') and public.storage_object_accessible(name))\n  with check (bucket_id in ('leases', 'invoices') and public.storage_object_accessible(name));" },
  { id: 'Q10', why: 'the storage delete rule still admits every member',
    from: "  using (bucket_id in ('leases', 'invoices') and public.storage_object_writable(name));", to: "  using (bucket_id in ('leases', 'invoices') and public.storage_object_accessible(name));" },
  { id: 'Q11', why: 'the storage write rules open other buckets',
    from: "  with check (bucket_id in ('leases', 'invoices') and public.storage_object_writable(name));\ncreate policy \"docs_owner_update\"",
    to:   "  with check (public.storage_object_writable(name));\ncreate policy \"docs_owner_update\"" },
  { id: 'Q12', why: 'authenticated keeps its writes on the organisation tables',
    from: "revoke insert, update, delete, truncate, references, trigger on public.organization_members, public.organizations from authenticated;\n", to: "" },
  { id: 'Q13', why: 'anon keeps its grants on the three tables',
    from: "revoke all on public.organization_members, public.organizations, public.lease_documents from anon;\n", to: "" },
  { id: 'Q14', why: 'authenticated keeps TRUNCATE on the register',
    from: "revoke truncate, references, trigger on public.lease_documents from authenticated;\n", to: "" },
  { id: 'Q15', why: 'anon may execute the storage helper',
    from: "revoke all on function public.storage_object_writable(text) from public, anon;\n", to: "" },
  { id: 'Q16', why: 'the helper runs as the caller (SECURITY INVOKER — a member cannot read organization_members rows that are not theirs through it)',
    from: "language sql\nvolatile\nsecurity definer\nset search_path = ''\nas $$\n  select (storage.foldername(object_name))[1]", to: "language sql\nvolatile\nset search_path = ''\nas $$\n  select (storage.foldername(object_name))[1]" },
  { id: 'Q17', why: 'the migration runs without 045', from: "    raise exception '047 requires 045 (can_edit_property, is_active_editor_of_org)';", to: "    null;" },
  { id: 'Q18', why: 'the migration runs on a database without the Pilot marker', from: "    raise exception 'REFUSING TO RUN: pilot marker property not found.", to: "    raise notice 'REFUSING TO RUN: pilot marker property not found." },
  { id: 'Q19', file: RB, why: 'the rollback does not restore the grants',
    from: "grant all on public.organization_members, public.organizations, public.lease_documents to anon, authenticated;\n", to: "" },
  { id: 'Q20', file: RB, why: 'the rollback leaves the helper behind',
    from: "drop function if exists public.storage_object_writable(text);\n", to: "" },
  { id: 'Q21', file: RB, why: 'the rollback leaves the narrowed storage rules in place',
    from: "    and public.storage_object_accessible(name)\n  );\ncreate policy \"docs_owner_update\"", to: "    and public.storage_object_writable(name)\n  );\ncreate policy \"docs_owner_update\"" },
];

const ONLY = (process.env.MS_ONLY || '').split(',').filter(Boolean);
if (ONLY.length) MUTANTS.splice(0, MUTANTS.length, ...MUTANTS.filter(m => ONLY.includes(m.id)));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'member-write-rem-mut-'));
for (const entry of ['migrations', 'tools']) fs.cpSync(path.join(ROOT, entry), path.join(tmp, entry), { recursive: true });
const ORIG = { [F]: fs.readFileSync(path.join(ROOT, F), 'utf8'), [RB]: fs.readFileSync(path.join(ROOT, RB), 'utf8') };
const verify = () => {
  try { execFileSync(process.execPath, ['tools/verify-migration-047.js'], { cwd: tmp, stdio: 'pipe', timeout: 900000, env: process.env }); return true; }
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
