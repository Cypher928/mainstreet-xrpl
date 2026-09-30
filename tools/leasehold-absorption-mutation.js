'use strict';
/**
 * tools/leasehold-absorption-mutation.js — does the 043 verifier bite?
 *
 *   node tools/leasehold-absorption-mutation.js
 *   MUT_ONLY=A05,R01 node tools/leasehold-absorption-mutation.js
 *
 * Each mutant is one edit to migrations/043_leasehold_absorption.sql (or, for
 * R-mutants, its rollback) that breaks one rule 043 enforces. Every one must be
 * caught by tools/verify-migration-043.js running against a throwaway cluster.
 *
 * Applied to a COPY in a scratch directory; the working tree is never touched.
 * The migration embeds the md5 of its own three replacement bodies (its re-run
 * precondition); the copy's constants are recomputed after every edit, so a
 * mutant is caught for what it does, not for failing that check.
 *
 * A FAILING BASELINE IS NOT A PASS. A SKIPPED verifier (no PostgreSQL) is not a
 * kill: the harness refuses to report anything.
 */
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const { execFileSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const REL = 'migrations/043_leasehold_absorption.sql';
const RREL = 'migrations/043_leasehold_absorption_rollback.sql';
const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');
const bodyOf = (s, head) => { const a = s.indexOf(head); const i = s.indexOf('as $$', a); return s.slice(i + 5, s.indexOf('$$;', i)); };
const HEADS = ['create or replace function public.resync_property_tenants(', 'create or replace function public.tenants_lifecycle_guard()',
  'create or replace function public.discard_leasehold('];

const MUTANTS = [
  // ── the state ──────────────────────────────────────────────────────────────
  { id: 'A01', why: 'the status check does not admit absorbed',
    from: "  check (leasehold_status in ('active', 'ended', 'absorbed'));", to: "  check (leasehold_status in ('active', 'ended'));" },
  { id: 'A02', why: 'an absorbed row needs no absorbed_at',
    from: "and absorbed_into is not null and absorbed_reason is not null and absorbed_at is not null));",
    to:   "and absorbed_into is not null and absorbed_reason is not null));" },
  { id: 'A03', why: 'an active row may carry a pointer',
    from: "  check (   (leasehold_status = 'active'   and ended_at is null     and ended_reason is null\n                                           and absorbed_into is null and absorbed_reason is null and absorbed_at is null)",
    to:   "  check (   (leasehold_status = 'active'   and ended_at is null     and ended_reason is null)" },
  { id: 'A04', why: 'a row may be absorbed into itself',
    from: "  check (absorbed_into is null or absorbed_into <> id);", to: "  check (true);" },
  { id: 'A05', why: 'the pointer may name a leasehold of another property',
    from: "  foreign key (absorbed_into, property_id) references public.tenants (id, property_id);",
    to:   "  foreign key (absorbed_into) references public.tenants (id);" },
  { id: 'A06', why: 'an unknown absorbed_reason is accepted',
    from: "  check (absorbed_reason is null or absorbed_reason in ('duplicate', 'document_of'));",
    to:   "  check (absorbed_reason is null or absorbed_reason in ('duplicate', 'document_of', 'merged'));" },
  { id: 'A07', why: 'the tombstone index is missing',
    from: "create index if not exists property_events_leasehold_discarded_idx on public.property_events (subject_id)\n  where action = 'leasehold_discarded';", to: '' },
  // ── data_revision ──────────────────────────────────────────────────────────
  { id: 'A08', why: 'a change of name does not move the revision',
    from: "     or new.name is distinct from old.name\n", to: '' },
  { id: 'A09', why: 'a caller\'s data_revision is kept',
    from: "  else\n    new.data_revision := old.data_revision;\n  end if;", to: "  end if;" },
  { id: 'A10', why: 'an insert keeps the data_revision it was sent',
    from: "  if tg_op = 'INSERT' then\n    new.data_revision := 0;\n    return new;", to: "  if tg_op = 'INSERT' then\n    return new;" },
  // ── helpers ────────────────────────────────────────────────────────────────
  { id: 'A11', why: 'no property is recognised as a demo',
    from: "  select p_property_id::text like 'dec00000-0000-4000-a000-%'\n      or p_property_id::text like 'de000001-0000-4000-a000-%'", to: "  select false" },
  { id: 'A12', why: 'any leasehold_discarded event is a tombstone (a copied timeline entry too)',
    from: "       and e.subject_type = 'leasehold'\n       and e.detail->>'source' = 'discard_leasehold')", to: "       )" },
  { id: 'A13', why: 'a tombstone blocks the upsert of a leasehold that still exists',
    from: "  if exists (select 1 from public.tenants t where t.id = new.id) then\n    return new;\n  end if;\n  if public._leasehold_tombstoned(new.id) then",
    to:   "  if public._leasehold_tombstoned(new.id) then" },
  // ── leasehold_history ──────────────────────────────────────────────────────
  { id: 'A14', why: 'ended is not history',
    from: "  select (case when v_t.leasehold_status = 'ended' then 1 else 0 end)\n       + (select count(*) from public.property_events e",
    to:   "  select (case when false then 1 else 0 end)\n       + (select count(*) from public.property_events e" },
  { id: 'A15', why: 'CAM is not history',
    from: "  select count(*) into v_n from public.cam_reconciliations where tenant_id = p_tenant_id;", to: "  v_n := 0;" },
  { id: 'A16', why: 'payments are not history',
    from: "  select count(*) into v_n from public.payments where tenant_id = p_tenant_id;", to: "  v_n := 0;" },
  { id: 'A17', why: 'invitations are forgotten',
    from: "       + (select count(*) from public.tenant_invitations    where tenant_id = p_tenant_id)\n       + (select count(*) from public.tenant_space_profiles where tenant_id = p_tenant_id)\n    into v_n;\n  if v_n > 0 then v_out := v_out || jsonb_build_object('code', 'portal'",
    to:   "       + (select count(*) from public.tenant_space_profiles where tenant_id = p_tenant_id)\n    into v_n;\n  if v_n > 0 then v_out := v_out || jsonb_build_object('code', 'portal'" },
  { id: 'A18', why: 'provisions are not history',
    from: "  select count(*) into v_n from public.lease_provisions where tenant_id = v_id;", to: "  v_n := 0;" },
  { id: 'A19', why: 'a reviewer email alone is not a person\'s review',
    from: "   where tenant_id = v_id\n     and (approved or manually_edited or reviewer_uid is not null or reviewer_email is not null);",
    to:   "   where tenant_id = v_id\n     and (approved or manually_edited or reviewer_uid is not null);" },
  { id: 'A20', why: 'review audit is not history',
    from: "  select count(*) into v_n from public.tenant_review_audit where tenant_id = v_id;", to: "  v_n := 0;" },
  { id: 'A21', why: 'a grouping on an unconverted review counts as a converted acquisition',
    from: "   where f.id = p_tenant_id\n     and (r.status = 'converted' or r.converted_at is not null);", to: "   where f.id = p_tenant_id;" },
  { id: 'A22', why: 'a converted acquisition is not history',
    from: "     and (r.status = 'converted' or r.converted_at is not null);", to: "     and false;" },
  { id: 'A23', why: 'term decisions are not history',
    from: "  select count(*) into v_n from public.acquisition_term_decisions where family_id = p_tenant_id;", to: "  v_n := 0;" },
  { id: 'A24', why: 'every event is history again (D4 undone)',
    from: "     and (e.action like 'manual\\_%' escape '\\' or e.action like 'space\\_%' escape '\\');", to: ";" },
  { id: 'A25', why: 'events a person wrote are not history',
    from: "     and (e.action like 'manual\\_%' escape '\\' or e.action like 'space\\_%' escape '\\');", to: "     and false;" },
  { id: 'A26', why: 'a dispute in the property record is not history',
    from: "           where jsonb_typeof(d) = 'object' and d->>'tenantId' = v_id)", to: "           where false)" },
  { id: 'A27', why: 'consolidation bookkeeping counts as history (a restored leasehold can never be consolidated again)',
    from: "           where e.subject_id = v_id and e.action in ('leasehold_ended', 'leasehold_reactivated'))",
    to:   "           where e.subject_id = v_id and e.action in ('leasehold_ended', 'leasehold_reactivated', 'leasehold_absorbed', 'leasehold_restored'))" },
  { id: 'A28', why: 'reviewed_at (every snapshot has it) counts as a review',
    from: "     and (approved or manually_edited or reviewer_uid is not null or reviewer_email is not null);\n  if v_n > 0 then v_out := v_out || jsonb_build_object('code', 'reviewed_evidence'",
    to:   "     and (approved or manually_edited or reviewer_uid is not null or reviewer_email is not null or reviewed_at is not null);\n  if v_n > 0 then v_out := v_out || jsonb_build_object('code', 'reviewed_evidence'" },
  // ── lifecycle guard, freeze ────────────────────────────────────────────────
  { id: 'A29', why: 'the lifecycle guard does not fire on the absorption columns',
    from: "  before insert or update of leasehold_status, ended_at, ended_reason, absorbed_into, absorbed_reason, absorbed_at on public.tenants",
    to:   "  before insert or update of leasehold_status, ended_at, ended_reason on public.tenants" },
  { id: 'A30', why: 'a new row may be born with absorption fields',
    from: "       or new.absorbed_into is not null or new.absorbed_reason is not null or new.absorbed_at is not null then", to: " then" },
  { id: 'A31', why: 'an absorbed row is not frozen',
    from: "  raise exception 'Leasehold % was consolidated into % and is kept as history;", to: "  return new;\n  raise exception 'Leasehold % was consolidated into % and is kept as history;" },
  { id: 'A32', why: 'a no-op update of an absorbed row is refused',
    from: "  if new is not distinct from old then\n    return new;\n  end if;\n", to: '' },
  // ── resync ─────────────────────────────────────────────────────────────────
  { id: 'A33', why: 'the resync does not skip an absorbed leasehold',
    from: "    if v_tenant_id = any(v_absorbed) then\n      continue;\n    end if;\n", to: '' },
  { id: 'A34', why: 'the resync re-creates a discarded leasehold from a stale roster',
    from: "    if v_tenant_id = any(v_discarded) then\n      continue;\n    end if;\n", to: '' },
  { id: 'A35', why: 'discarded_in_roster is not reported',
    from: "    'discarded_in_roster', to_jsonb(v_discarded)", to: "    'discarded_in_roster', '[]'::jsonb" },
  { id: 'A36', why: 'absorbed_in_roster is not reported',
    from: "    'absorbed_in_roster', to_jsonb(v_absorbed),", to: "    'absorbed_in_roster', '[]'::jsonb," },
  { id: 'A37', why: 'absent_active counts absorbed leaseholds',
    from: "    and not (t.id = any(v_incoming))\n    and t.leasehold_status = 'active';", to: "    and not (t.id = any(v_incoming))\n    and t.leasehold_status <> 'ended';" },
  // ── discard ────────────────────────────────────────────────────────────────
  { id: 'A38', why: 'discard ignores the history test',
    from: "    from jsonb_array_elements(public.leasehold_history(p_tenant_id)) with ordinality x(h, o);", to: "    from jsonb_array_elements('[]'::jsonb) with ordinality x(h, o);" },
  { id: 'A39', why: 'a consolidation target can be discarded',
    from: "  if v_n > 0 then v_reasons := v_reasons || format('%s leasehold(s) consolidated into it', v_n); end if;", to: '' },
  { id: 'A40', why: 'a demo leasehold can be discarded',
    from: "    v_reasons := v_reasons || 'a demo leasehold (reset the demo instead)'::text;", to: "    null;" },
  { id: 'A41', why: 'an absorbed leasehold is refused as if it had ended',
    from: "  if v_t.leasehold_status = 'absorbed' then\n    raise exception 'Leasehold % was consolidated into %;", to: "  if false then\n    raise exception 'Leasehold % was consolidated into %;" },
  // ── absorb eligibility ─────────────────────────────────────────────────────
  { id: 'A42', why: 'a leasehold with history can be consolidated',
    from: "  if jsonb_array_length(v_hist) > 0 then\n    v_out := v_out || to_jsonb(format('It has permanent history", to: "  if false then\n    v_out := v_out || to_jsonb(format('It has permanent history" },
  { id: 'A43', why: 'an ended leasehold can be consolidated',
    from: "  if v_s.leasehold_status = 'ended' then\n    v_out := v_out || to_jsonb(format('Leasehold %s ended on %s;", to: "  if false then\n    v_out := v_out || to_jsonb(format('Leasehold %s ended on %s;" },
  { id: 'A44', why: 'a leasehold can be consolidated INTO an absorbed one (chains)',
    from: "  elsif v_t.leasehold_status = 'absorbed' then\n    v_out := v_out || to_jsonb(format('The target was itself", to: "  elsif false then\n    v_out := v_out || to_jsonb(format('The target was itself" },
  { id: 'A45', why: 'a leasehold others were consolidated into can itself be consolidated',
    from: "  if v_n > 0 then\n    v_out := v_out || to_jsonb(format('%s leasehold(s) were consolidated into this one; restore them first', v_n));",
    to:   "  if false then\n    v_out := v_out || to_jsonb(format('%s leasehold(s) were consolidated into this one; restore them first', v_n));" },
  { id: 'A46', why: 'a demo leasehold can be consolidated',
    from: "    v_out := v_out || to_jsonb('A demo leasehold is not consolidated; reset the demo instead'::text);", to: "    null;" },
  { id: 'A47', why: 'an absorbed leasehold can be consolidated again (its pointer moved)',
    from: "  elsif v_s.leasehold_status = 'absorbed' then\n    v_out := v_out || to_jsonb(format('Leasehold %s is already consolidated into %s'",
    to:   "  elsif false then\n    v_out := v_out || to_jsonb(format('Leasehold %s is already consolidated into %s'" },
  // ── absorb ─────────────────────────────────────────────────────────────────
  { id: 'A48', why: 'a stale property revision is accepted',
    from: "  if p_expected_revision is null or p_expected_revision is distinct from v_rev then", to: "  if false then" },
  { id: 'A49', why: 'a document of another leasehold is taken',
    from: "   where d.id = any(v_docs) and d.tenant_id is not null and d.tenant_id <> p_source\n     and exists (select 1 from public.tenants x where x.id = d.tenant_id);",
    to:   "   where false;" },
  { id: 'A50', why: 'a document linked to the source may be left behind',
    from: "   where d.property_id = v_s.property_id and d.tenant_id = p_source and not (d.id = any(v_docs));", to: "   where false;" },
  { id: 'A51', why: 'a document of another property is taken',
    from: "   where not exists (select 1 from public.lease_documents d where d.id = x and d.property_id = v_s.property_id);",
    to:   "   where not exists (select 1 from public.lease_documents d where d.id = x);" },
  { id: 'A52', why: 'absorb copies a term onto the target',
    from: "  perform set_config('mainstreet.leasehold_lifecycle', p_source::text, true);\n  update public.tenants\n     set leasehold_status = 'absorbed',",
    to:   "  update public.tenants set end_date = coalesce(v_s.end_date, end_date) where id = p_target;\n  perform set_config('mainstreet.leasehold_lifecycle', p_source::text, true);\n  update public.tenants\n     set leasehold_status = 'absorbed'," },
  { id: 'A53', why: 'the source\'s saved-roster entry is not removed',
    from: "  if jsonb_array_length(v_roster) > 0 then\n    update public.properties p\n       set data = jsonb_set(p.data, '{tenants}',\n             coalesce(",
    to:   "  if false then\n    update public.properties p\n       set data = jsonb_set(p.data, '{tenants}',\n             coalesce(" },
  { id: 'A54', why: 'the source\'s saved-roster entry is not kept in the event',
    from: "                             'source_roster_entry', v_roster,", to: "                             'source_roster_entry', '[]'::jsonb," },
  { id: 'A55', why: 'the moved documents are not recorded',
    from: "                             'moved_documents', v_moved,\n                             'eligibility'", to: "                             'moved_documents', '[]'::jsonb,\n                             'eligibility'" },
  { id: 'A56', why: 'no event is written on the target',
    from: "  values (v_s.property_id, v_uid, 'leasehold_absorbed_other', 'leasehold', p_target::text,", to: "  select v_s.property_id, v_uid, 'leasehold_absorbed_other', 'leasehold', p_target::text,",
    also: [["                             'absorbed_event_id', v_event, 'moved_documents', v_moved))\n  returning id into v_event2;",
            "                             'absorbed_event_id', v_event, 'moved_documents', v_moved) where false\n  returning id into v_event2;"]] },
  { id: 'A57', why: 'a consolidation needs no note',
    from: "    raise exception 'A note is required to consolidate a leasehold' using errcode = 'check_violation';", to: "    null;" },
  { id: 'A58', why: 'any member (not only the owner) may consolidate',
    from: "  select * into v_s from public.tenants where id = p_source;\n  -- Authorisation first, so a stranger learns nothing about what exists.\n  if not found or not exists (select 1 from public.properties p where p.id = v_s.property_id and p.user_id = v_uid) then",
    to:   "  select * into v_s from public.tenants where id = p_source;\n  -- Authorisation first, so a stranger learns nothing about what exists.\n  if not found or not (v_s.property_id in (select public.member_property_ids())) then" },
  { id: 'A59', why: 'the lifecycle flag outlives absorb_leasehold',
    from: "     set leasehold_status = 'absorbed', absorbed_into = p_target, absorbed_reason = p_reason, absorbed_at = v_at\n   where id = p_source;\n  perform set_config('mainstreet.leasehold_lifecycle', '', true);",
    to:   "     set leasehold_status = 'absorbed', absorbed_into = p_target, absorbed_reason = p_reason, absorbed_at = v_at\n   where id = p_source;" },
  { id: 'A60', why: 'absorb borrows legacy_tenant_id for the moved documents',
    from: "  update public.lease_documents set tenant_id = p_target where id = any(v_docs);",
    to:   "  update public.lease_documents set legacy_tenant_id = tenant_id, tenant_id = p_target where id = any(v_docs);" },
  // ── restore ────────────────────────────────────────────────────────────────
  { id: 'A61', why: 'restore takes back a document that has moved on since',
    from: "                where d.id = v_doc and d.property_id = v_s.property_id and d.tenant_id = v_s.absorbed_into) then",
    to:   "                where d.id = v_doc and d.property_id = v_s.property_id) then" },
  { id: 'A62', why: 'restore does not return the roster entry',
    from: "  if jsonb_typeof(v_roster) = 'array' and jsonb_array_length(v_roster) > 0 then", to: "  if false then" },
  { id: 'A63', why: 'restore duplicates a roster entry that is already there',
    from: "       and not exists (select 1 from jsonb_array_elements(p.data->'tenants') e\n                        where jsonb_typeof(e) = 'object' and e->>'id' = p_tenant_id::text);",
    to:   ";" },
  { id: 'A64', why: 'restore creates a saved roster on a property whose roster is empty',
    from: "       and jsonb_typeof(p.data->'tenants') = 'array'\n       and jsonb_array_length(p.data->'tenants') > 0\n", to: '' },
  { id: 'A65', why: 'restore needs no note',
    from: "    raise exception 'A note is required to restore a consolidated leasehold' using errcode = 'check_violation';", to: "    null;" },
  { id: 'A66', why: 'the overrides adopted since are not listed',
    from: "   where a.tenant_id = v_s.absorbed_into::text and a.action = 'field_override' and a.created_at >= v_s.absorbed_at;",
    to:   "   where false;" },
  { id: 'A67', why: 'the lifecycle flag outlives restore',
    from: "     set leasehold_status = 'active', absorbed_into = null, absorbed_reason = null, absorbed_at = null\n   where id = p_tenant_id;\n  perform set_config('mainstreet.leasehold_lifecycle', '', true);",
    to:   "     set leasehold_status = 'active', absorbed_into = null, absorbed_reason = null, absorbed_at = null\n   where id = p_tenant_id;" },
  // ── preflight, grants ──────────────────────────────────────────────────────
  { id: 'A68', why: 'the preflight returns a target on another property',
    from: "    select * into v_t from public.tenants where id = p_target and property_id = v_s.property_id;",
    to:   "    select * into v_t from public.tenants where id = p_target;" },
  { id: 'A69', why: 'the preflight lists another leasehold\'s documents as unattributed',
    from: "                       and (v_s.lease_url is null or d.file_url is distinct from v_s.lease_url))",
    to:   "                       or (v_s.lease_url is null or d.file_url is distinct from v_s.lease_url))" },
  { id: 'A70', why: 'anon may call absorb_leasehold',
    from: "grant execute on function public.absorb_leasehold(uuid, uuid, text, uuid[], text, bigint) to authenticated, service_role;",
    to:   "grant execute on function public.absorb_leasehold(uuid, uuid, text, uuid[], text, bigint) to anon, authenticated, service_role;" },
  { id: 'A71', why: 'leasehold_history is callable through the API',
    from: "revoke all on function public.leasehold_history(uuid)              from public, anon, authenticated, service_role;",
    to:   "revoke all on function public.leasehold_history(uuid)              from public, anon;" },
  // ── rollback ───────────────────────────────────────────────────────────────
  { id: 'R01', file: RREL, why: 'the rollback does not refuse while a leasehold is absorbed',
    from: "    if v_n > 0 then\n      raise exception 'REFUSING TO ROLL BACK 043:", to: "    if false then\n      raise exception 'REFUSING TO ROLL BACK 043:" },
  { id: 'R02', file: RREL, why: 'the rollback leaves properties.data_revision behind',
    from: "alter table public.properties drop column if exists data_revision;\n", to: '' },
  { id: 'R03', file: RREL, why: 'the rollback restores a status check that still admits absorbed',
    from: "alter table public.tenants add constraint tenants_leasehold_status_chk\n  check (leasehold_status in ('active', 'ended'));",
    to:   "alter table public.tenants add constraint tenants_leasehold_status_chk\n  check (leasehold_status in ('active', 'ended', 'absorbed'));" },
  { id: 'R04', file: RREL, why: 'the rollback leaves the tombstone guard in place',
    from: "drop trigger if exists tenants_tombstone_guard  on public.tenants;\n", to: '',
    also: [["drop function if exists public.tenants_tombstone_guard();\n", '']] },
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-absorb-mut-'));
for (const dir of ['migrations', 'tools']) fs.cpSync(path.join(ROOT, dir), path.join(tmp, dir), { recursive: true });
const ORIGINAL = fs.readFileSync(path.join(ROOT, REL), 'utf8');
const ORIGINAL_R = fs.readFileSync(path.join(ROOT, RREL), 'utf8');
const ORIGINAL_MD5 = HEADS.map(h => md5(bodyOf(ORIGINAL, h)));
const writeMigration = (text) => {
  // keep the copy's re-run precondition consistent with its own (mutated) bodies
  let fixed = text;
  HEADS.forEach((h, i) => { fixed = fixed.replace(ORIGINAL_MD5[i], md5(bodyOf(text, h))); });
  fs.writeFileSync(path.join(tmp, REL), fixed);
};
const reset = () => { writeMigration(ORIGINAL); fs.writeFileSync(path.join(tmp, RREL), ORIGINAL_R); };
function run() {
  try { const out = execFileSync(process.execPath, ['tools/verify-migration-043.js'], { cwd: tmp, encoding: 'utf8', stdio: 'pipe', timeout: 900000 });
        return /SKIPPED/.test(out) ? 'skipped' : 'pass'; }
  catch (e) { return /SKIPPED/.test(String(e.stdout || '')) ? 'skipped' : 'fail'; }
}
reset();
const baseline = run();
console.log('Baseline (unmutated copy): ' + baseline.toUpperCase());
if (baseline !== 'pass') { console.error('\nThe unmutated copy does not pass (or the verifier skipped), so every result below would be meaningless. Nothing is mutated.'); fs.rmSync(tmp, { recursive: true, force: true }); process.exit(2); }
let killed = 0; const survivors = [];
const ONLY = (process.env.MUT_ONLY || '').split(',').filter(Boolean);
const chosen = MUTANTS.filter(x => !ONLY.length || ONLY.includes(x.id));
for (const m of chosen) {
  const file = m.file || REL;
  const edits = [[m.from, m.to], ...(m.also || [])];
  let text = file === REL ? ORIGINAL : ORIGINAL_R, bad = null;
  for (const [f, to] of edits) {
    if (text.indexOf(f) === -1) { bad = 'anchor not found'; break; }
    if (text.indexOf(f) !== text.lastIndexOf(f)) { bad = 'anchor not unique'; break; }
    text = text.replace(f, to);
  }
  if (bad) { console.log(`  ?  ${m.id} ${bad} — the harness is stale, not the product`); survivors.push(m.id + ' (' + bad + ')'); continue; }
  if (file === REL) writeMigration(text); else fs.writeFileSync(path.join(tmp, RREL), text);
  const r = run();
  reset();
  if (r === 'fail') { killed++; console.log(`  \x1b[32m☠\x1b[0m  ${m.id} killed — ${m.why}`); }
  else { survivors.push(m.id); console.log(`  \x1b[31m✗\x1b[0m  ${m.id} SURVIVED (${r}) — ${m.why}`); }
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log('\n' + '─'.repeat(58));
console.log(`${killed} killed, ${survivors.length} survived of ${chosen.length}`);
if (survivors.length) { survivors.forEach(s => console.log('  · ' + s)); process.exit(1); }
