'use strict';
/**
 * tools/member-write-rules-mutation.js — would anyone notice if a rule of
 * migration 045 (member write rules) were quietly undone?
 *
 *   node tools/member-write-rules-mutation.js
 *
 * Each mutant undoes ONE rule in migrations/045_acquisition_member_write_rules
 * .sql (or its rollback), and tools/verify-migration-045-member-write-rules.js
 * (a throwaway PostgreSQL cluster; no Supabase project is contacted) must fail
 * for every one. MS_PG_SERVER_BIN, when set, is passed through.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const F  = 'migrations/045_acquisition_member_write_rules.sql';
const RB = 'migrations/045_acquisition_member_write_rules_rollback.sql';
const MUTANTS = [
  { id: 'W01', why: 'a read-only member may update reviews',
    from: "  for update to authenticated\n  using      (public.can_edit_property(property_id) or (property_id is null and user_id = auth.uid()))\n  with check (public.can_edit_property(property_id) or (property_id is null and user_id = auth.uid()));",
    to:   "  for update to authenticated\n  using      (property_id in (select public.member_property_ids()))\n  with check (property_id in (select public.member_property_ids()));" },
  { id: 'W02', why: 'a read-only member may delete documents',
    from: "  for delete to authenticated using (public.can_edit_property(property_id));",
    to:   "  for delete to authenticated using (property_id in (select public.member_property_ids()));" },
  { id: 'W03', why: 'a read-only member may file leaseholds',
    from: "create policy acq_doc_families_editor_insert on public.acquisition_document_families\n  for insert to authenticated with check (public.can_edit_property(property_id));",
    to:   "create policy acq_doc_families_editor_insert on public.acquisition_document_families\n  for insert to authenticated with check (property_id in (select public.member_property_ids()));" },
  { id: 'W04', why: 'a read-only member may record term decisions',
    from: "create policy acq_term_decisions_editor_insert on public.acquisition_term_decisions\n  for insert to authenticated with check (public.can_edit_property(property_id));",
    to:   "create policy acq_term_decisions_editor_insert on public.acquisition_term_decisions\n  for insert to authenticated with check (property_id in (select public.member_property_ids()));" },
  { id: 'W05', why: 'a direct update may mark a review converted',
    from: "  if new.status = 'converted' or new.converted_at is distinct from old.converted_at then\n    if new.status = 'converted'",
    to:   "  if false then\n    if new.status = 'converted'" },
  { id: 'W06', why: 'conversion is accepted without the property acquired in the same transaction',
    from: "                      and p.stage_changed_at = now()) then",
    to:   "                      ) or true then" },
  { id: 'W07', why: 'a family may be filed in another person\'s name',
    from: "create trigger acq_doc_families_author_guard\n  before insert or update of user_id on public.acquisition_document_families",
    to:   "create trigger acq_doc_families_author_guard\n  before update of user_id on public.acquisition_document_families" },
  // EQUIVALENT by construction: 026's acq_term_decisions_actor requires
  // decided_by = user_id, and the author guard requires user_id = auth.uid(), so
  // decided_by = auth.uid() already holds. Kept as a second layer; listed so the
  // verdict is on record, not so it must die.
  { id: 'W08', equivalent: true, why: 'a term decision may name another person as decided_by',
    from: "    if tg_table_name = 'acquisition_term_decisions'\n       and (to_jsonb(new) ->> 'decided_by') is distinct from v_uid::text then",
    to:   "    if false then" },
  { id: 'W09', why: 'a record\'s author may be changed',
    from: "  if new.user_id is distinct from old.user_id then\n    raise exception '%.user_id does not change'",
    to:   "  if false then\n    raise exception '%.user_id does not change'" },
  { id: 'W10', why: 'a document\'s stored file may be re-pointed',
    from: "  if old.storage_path is not null and new.storage_path is distinct from old.storage_path then",
    to:   "  if false then" },
  { id: 'W11', why: 'a save may move a property\'s ownership',
    from: "    new.user_id         := old.user_id;\n    new.organization_id := old.organization_id;",
    to:   "    null;" },
  { id: 'W12', why: 'an editor may delete a property',
    from: "  using (public.is_property_admin(id));",
    to:   "  using (public.can_edit_property(id));" },
  { id: 'W13', why: 'a read-only member may update a property',
    from: "  using      (user_id = auth.uid() or (organization_id is not null and public.is_active_editor_of_org(organization_id)))\n  with check (user_id = auth.uid() or (organization_id is not null and public.is_active_editor_of_org(organization_id)));",
    to:   "  using      (user_id = auth.uid() or (organization_id is not null and public.is_active_member_of_org(organization_id)))\n  with check (user_id = auth.uid() or (organization_id is not null and public.is_active_member_of_org(organization_id)));" },
  { id: 'W14', why: 'a property may be filed into any organisation',
    from: "  with check (user_id = auth.uid() and (organization_id is null or public.is_active_editor_of_org(organization_id)));",
    to:   "  with check (user_id = auth.uid());" },
  { id: 'W15', why: 'authenticated keeps TRUNCATE',
    from: "revoke truncate on public.acquisition_reviews, public.acquisition_documents, public.properties from authenticated;",
    to:   "" },
  { id: 'W16', why: 'anon keeps its grants on properties',
    from: "revoke all on public.properties from anon;",
    to:   "" },
  { id: 'W17', why: 'members may still insert ledger rows',
    from: "revoke insert on public.financial_sources, public.gl_entries from authenticated;",
    to:   "" },
  { id: 'W18', why: 'a read-only member counts as an editor',
    from: "       and m.accepted_at is not null and m.revoked_at is null\n       and m.role <> 'read_only')",
    to:   "       and m.accepted_at is not null and m.revoked_at is null)" },
  { id: 'W19', why: 'a revoked member counts as an editor',
    from: "       and m.accepted_at is not null and m.revoked_at is null\n       and m.role <> 'read_only')",
    to:   "       and m.accepted_at is not null\n       and m.role <> 'read_only')" },
  { id: 'W20', why: 'only the owner may edit (editors lose their workflow)',
    from: "       and (p.user_id = auth.uid()\n            or (p.organization_id is not null and public.is_active_editor_of_org(p.organization_id))))",
    to:   "       and p.user_id = auth.uid())" },
  { id: 'W21', why: 'an editor may delete a review',
    from: "  using (public.is_property_admin(property_id) or (property_id is null and user_id = auth.uid()));",
    to:   "  using (public.can_edit_property(property_id) or (property_id is null and user_id = auth.uid()));" },
  { id: 'W22', why: 'the editor check cannot see an organisation created in the same statement',
    from: "returns boolean\nlanguage sql\nvolatile\nsecurity definer",
    to:   "returns boolean\nlanguage sql\nstable\nsecurity definer" },
  { id: 'W23', why: 'the rollback does not restore TRUNCATE', file: RB,
    from: "grant truncate on public.acquisition_reviews, public.acquisition_documents, public.properties to authenticated;",
    to:   "" },
  { id: 'W24', why: 'the rollback leaves a guard behind', file: RB,
    from: "drop trigger if exists properties_identity_guard        on public.properties;",
    to:   "" },
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'member-write-mut-'));
for (const entry of ['migrations', 'tools']) fs.cpSync(path.join(ROOT, entry), path.join(tmp, entry), { recursive: true });
const ORIG = { [F]: fs.readFileSync(path.join(ROOT, F), 'utf8'), [RB]: fs.readFileSync(path.join(ROOT, RB), 'utf8') };
const verify = () => {
  try { execFileSync(process.execPath, ['tools/verify-migration-045-member-write-rules.js'], { cwd: tmp, stdio: 'pipe', timeout: 900000, env: process.env }); return true; }
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
