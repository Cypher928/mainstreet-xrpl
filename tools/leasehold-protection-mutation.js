'use strict';
/**
 * tools/leasehold-protection-mutation.js — does the 038 verifier bite?
 *
 *   node tools/leasehold-protection-mutation.js
 *
 * Each mutant is one edit to migrations/038_leasehold_protection.sql that breaks
 * one rule 038 enforces. Every one must be caught by
 * tools/verify-migration-038.js running against a throwaway cluster.
 *
 * Applied to a COPY in a scratch directory; the working tree is never touched.
 * The migration embeds the md5 of its own resync body (its re-run
 * precondition); the copy's constant is recomputed after every edit, so a
 * resync mutant is caught for what it does, not for failing that check.
 *
 * A FAILING BASELINE IS NOT A PASS. A SKIPPED verifier (no PostgreSQL) is not a
 * kill: the harness refuses to report anything.
 */
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const { execFileSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const REL = 'migrations/038_leasehold_protection.sql';
const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');
const resyncBody = (s) => { const a = s.indexOf('create or replace function public.resync_property_tenants('); const i = s.indexOf('as $$', a); return s.slice(i + 5, s.indexOf('$$;', i)); };

const MUTANTS = [
  // ── resync ─────────────────────────────────────────────────────────────────
  { id: 'P01', why: 'the resync deletes unreferenced absentees again',
    from: "  -- ── 038: an active leasehold missing from the roster is reported, never",
    to:   "  delete from public.tenants t where t.property_id = p_property_id and not (t.id = any(v_incoming))\n    and not exists (select 1 from public.cam_reconciliations c where c.tenant_id = t.id);\n  -- ── 038: an active leasehold missing from the roster is reported, never" },
  { id: 'P02', why: 'an ended leasehold in the roster is overwritten (skip and guard both gone)',
    from: "    if v_tenant_id = any(v_ended) then\n      continue;\n    end if;\n", to: '',
    also: [["    where tenants.property_id = p_property_id      -- 032: property_id is never re-pointed\n      and tenants.leasehold_status = 'active';     -- 038: an ended leasehold is never overwritten",
            "    where tenants.property_id = p_property_id;"]] },
  { id: 'P03', why: 'absent_active counts ended leaseholds too',
    from: "    and not (t.id = any(v_incoming))\n    and t.leasehold_status = 'active';", to: "    and not (t.id = any(v_incoming));" },
  { id: 'P04', why: 'ended_in_roster is not reported',
    from: "    'ended_in_roster', to_jsonb(v_ended)", to: "    'ended_in_roster', '[]'::jsonb" },
  { id: 'P05', why: 'deleted is reported as a count again, not 0',
    from: "    'deleted', 0, 'retained_referenced', cardinality(v_absent),", to: "    'deleted', cardinality(v_absent), 'retained_referenced', 0," },
  // ── delete guard ───────────────────────────────────────────────────────────
  { id: 'P06', why: 'the property cascade is no longer let through',
    from: "  if pg_trigger_depth() > 1 then\n    return old;\n  end if;", to: '' },
  { id: 'P07', why: 'any discard flag lets any row be deleted',
    from: "  if current_setting('mainstreet.discard_leasehold', true) = old.id::text then\n    return old;",
    to:   "  if coalesce(current_setting('mainstreet.discard_leasehold', true), '') <> '' then\n    return old;" },
  { id: 'P08', why: 'the delete guard lets everything through',
    from: "  raise exception 'Leasehold % is permanent and is not deleted.", to: "  return old;\n  raise exception 'Leasehold % is permanent and is not deleted." },
  // ── lifecycle guard ────────────────────────────────────────────────────────
  { id: 'P09', why: 'an ended leasehold can be inserted',
    from: "    if new.leasehold_status is distinct from 'active' or new.ended_at is not null or new.ended_reason is not null then",
    to:   "    if false then" },
  { id: 'P10', why: 'a no-op UPDATE naming the lifecycle columns is refused',
    from: "  if new.leasehold_status is not distinct from old.leasehold_status\n     and new.ended_at     is not distinct from old.ended_at\n     and new.ended_reason is not distinct from old.ended_reason then\n    return new;\n  end if;\n", to: '' },
  { id: 'P11', why: 'the lifecycle guard lets any direct change through',
    from: "  raise exception 'The lifecycle of leasehold % changes only through", to: "  return new;\n  raise exception 'The lifecycle of leasehold % changes only through" },
  { id: 'P12', why: 'the lifecycle flag is ignored (end_leasehold itself is refused)',
    from: "  if current_setting('mainstreet.leasehold_lifecycle', true) = old.id::text then\n    return new;\n  end if;\n", to: '' },
  // ── end_leasehold ──────────────────────────────────────────────────────────
  { id: 'P13', why: 'a missing actual end date is taken from end_date',
    from: "  if p_ended_at is null then\n    raise exception 'The actual end date is required; it is never taken from the contractual end date' using errcode = 'check_violation';\n  end if;",
    to:   "  if p_ended_at is null then\n    p_ended_at := v_t.end_date;\n  end if;" },
  { id: 'P14', why: '"assigned" becomes an ending reason',
    from: "  if p_reason is null or p_reason not in ('lease_expired', 'terminated_early', 'surrendered', 'evicted', 'other') then",
    to:   "  if p_reason is null or p_reason not in ('lease_expired', 'terminated_early', 'surrendered', 'evicted', 'other', 'assigned') then" },
  { id: 'P15', why: 'any member (not only the owner) may end a leasehold',
    from: "  select * into v_t from public.tenants where id = p_tenant_id for update;\n  -- Authorisation first, so a stranger learns nothing about what exists.\n  if not found or not exists (select 1 from public.properties p where p.id = v_t.property_id and p.user_id = v_uid) then",
    to:   "  select * into v_t from public.tenants where id = p_tenant_id for update;\n  -- Authorisation first, so a stranger learns nothing about what exists.\n  if not found or not (v_t.property_id in (select public.member_property_ids())) then" },
  { id: 'P16', why: 'ending writes no event',
    from: "  values (v_t.property_id, v_uid, 'leasehold_ended',", to: "  select v_t.property_id, v_uid, 'leasehold_ended',",
    also: [["                             'contractual_end_date', v_t.end_date))\n  returning id into v_event;", "                             'contractual_end_date', v_t.end_date) where false\n  returning id into v_event;"]] },
  { id: 'P17', why: 'the lifecycle flag outlives end_leasehold',
    from: "     set leasehold_status = 'ended', ended_at = p_ended_at, ended_reason = p_reason\n   where id = p_tenant_id;\n  perform set_config('mainstreet.leasehold_lifecycle', '', true);",
    to:   "     set leasehold_status = 'ended', ended_at = p_ended_at, ended_reason = p_reason\n   where id = p_tenant_id;" },
  { id: 'P18', why: 'an ended leasehold can be ended again (its end silently moved)',
    from: "  if v_t.leasehold_status <> 'active' then\n    raise exception 'Leasehold % is already ended", to: "  if false then\n    raise exception 'Leasehold % is already ended" },
  // ── reactivate_leasehold ───────────────────────────────────────────────────
  { id: 'P19', why: 'reactivation needs no note',
    from: "    raise exception 'A note is required to reactivate a leasehold' using errcode = 'check_violation';", to: "    null;" },
  { id: 'P20', why: 'the previous ending is lost from the reactivation event',
    from: "'previous_ended_at', v_t.ended_at, 'previous_reason', v_t.ended_reason))", to: "'previous_ended_at', null, 'previous_reason', null))" },
  // ── discard_leasehold ──────────────────────────────────────────────────────
  { id: 'P21', why: 'CAM no longer blocks a discard',
    from: "  if v_n > 0 then v_reasons := v_reasons || format('%s CAM reconciliation row(s)', v_n); end if;", to: '' },
  { id: 'P22', why: 'provisions no longer block a discard',
    from: "  if v_n > 0 then v_reasons := v_reasons || format('%s lease provision(s)', v_n); end if;", to: '' },
  { id: 'P23', why: 'review audit no longer blocks a discard',
    from: "  if v_n > 0 then v_reasons := v_reasons || format('%s review audit entr(y/ies)', v_n); end if;", to: '' },
  { id: 'P24', why: 'payments no longer block a discard',
    from: "  if v_n > 0 then v_reasons := v_reasons || format('%s payment(s)', v_n); end if;", to: '' },
  { id: 'P25', why: 'one portal table (tenant_invitations) is forgotten',
    from: "       + (select count(*) from public.tenant_invitations    where tenant_id = p_tenant_id)\n", to: '' },
  { id: 'P26', why: 'history events no longer block a discard',
    from: "  if v_n > 0 then v_reasons := v_reasons || format('%s property history event(s)', v_n); end if;", to: '' },
  { id: 'P27', why: 'a reviewer email alone is not treated as a person\'s review',
    from: "     and (approved or manually_edited or reviewer_uid is not null or reviewer_email is not null);",
    to:   "     and (approved or manually_edited or reviewer_uid is not null);" },
  { id: 'P28', why: 'reviewed_at (every snapshot has it) blocks every discard',
    from: "     and (approved or manually_edited or reviewer_uid is not null or reviewer_email is not null);",
    to:   "     and (approved or manually_edited or reviewer_uid is not null or reviewer_email is not null or reviewed_at is not null);" },
  { id: 'P29', why: 'the upload\'s documents are deleted instead of kept and unlinked',
    from: "    update public.lease_documents\n       set tenant_id = null\n     where tenant_id = p_tenant_id and property_id = v_t.property_id\n    returning id",
    to:   "    delete from public.lease_documents\n     where tenant_id = p_tenant_id and property_id = v_t.property_id\n    returning id" },
  { id: 'P30', why: 'the unlinked document borrows legacy_tenant_id (reserved for relinks)',
    from: "       set tenant_id = null\n", to: "       set tenant_id = null, legacy_tenant_id = tenant_id\n" },
  { id: 'P31', why: 'an ended leasehold can be discarded',
    from: "  if v_t.leasehold_status <> 'active' then\n    raise exception 'Leasehold % ended on %; an ended leasehold is history and is never discarded'",
    to:   "  if false then\n    raise exception 'Leasehold % ended on %; an ended leasehold is history and is never discarded'" },
  // (Leaving the discard flag set after the call is an EQUIVALENT mutant: the
  // flag names only the row just deleted, so it can match nothing afterwards.
  // It is cleared anyway; the lifecycle flag, which names a row that still
  // exists, is the one whose clearing matters — P17.)
  { id: 'P32', why: 'the discard removes the unreviewed evidence of every leasehold of the property',
    from: "  delete from public.tenant_field_evidence where tenant_id = p_tenant_id::text;",
    to:   "  delete from public.tenant_field_evidence where property_id = v_t.property_id and not (approved or manually_edited);" },
  { id: 'P33', why: 'the discarded id is not preserved in the event snapshot',
    from: "'snapshot', to_jsonb(v_t),", to: "'snapshot', to_jsonb(v_t) - 'id'," },
  { id: 'P34', why: 'a discard needs no note',
    from: "    raise exception 'A note is required to discard a leasehold' using errcode = 'check_violation';", to: "    null;" },
  // ── grants ─────────────────────────────────────────────────────────────────
  { id: 'P35', why: 'anon may call discard_leasehold',
    from: "grant execute on function public.discard_leasehold(uuid, text)         to authenticated, service_role;",
    to:   "grant execute on function public.discard_leasehold(uuid, text)         to anon, authenticated, service_role;" },
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-protect-mut-'));
for (const d of ['migrations', 'tools']) fs.cpSync(path.join(ROOT, d), path.join(tmp, d), { recursive: true });
const ORIGINAL = fs.readFileSync(path.join(ROOT, REL), 'utf8');
const ORIGINAL_MD5 = md5(resyncBody(ORIGINAL));
const writeMutant = (text) => {
  // keep the copy's re-run precondition consistent with its own (mutated) resync body
  const fixed = text.replace(ORIGINAL_MD5, md5(resyncBody(text)));
  fs.writeFileSync(path.join(tmp, REL), fixed);
};
function run() {
  try { const out = execFileSync(process.execPath, ['tools/verify-migration-038.js'], { cwd: tmp, encoding: 'utf8', stdio: 'pipe', timeout: 900000 });
        return /SKIPPED/.test(out) ? 'skipped' : 'pass'; }
  catch (e) { return /SKIPPED/.test(String(e.stdout || '')) ? 'skipped' : 'fail'; }
}
writeMutant(ORIGINAL);
const baseline = run();
console.log('Baseline (unmutated copy): ' + baseline.toUpperCase());
if (baseline !== 'pass') { console.error('\nThe unmutated copy does not pass (or the verifier skipped), so every result below would be meaningless. Nothing is mutated.'); fs.rmSync(tmp, { recursive: true, force: true }); process.exit(2); }
let killed = 0; const survivors = [];
// MUT_ONLY=P07,P32 runs just those (after the same baseline).
const ONLY = (process.env.MUT_ONLY || '').split(',').filter(Boolean);
for (const m of MUTANTS.filter(x => !ONLY.length || ONLY.includes(x.id))) {
  const edits = [[m.from, m.to], ...(m.also || [])];
  let text = ORIGINAL, bad = null;
  for (const [f, to] of edits) {
    if (text.indexOf(f) === -1) { bad = 'anchor not found'; break; }
    if (text.indexOf(f) !== text.lastIndexOf(f)) { bad = 'anchor not unique'; break; }
    text = text.replace(f, to);
  }
  if (bad) { console.log(`  ?  ${m.id} ${bad} — the harness is stale, not the product`); survivors.push(m.id + ' (' + bad + ')'); continue; }
  writeMutant(text);
  const r = run();
  writeMutant(ORIGINAL);
  if (r === 'fail') { killed++; console.log(`  \x1b[32m☠\x1b[0m  ${m.id} killed — ${m.why}`); }
  else { survivors.push(m.id); console.log(`  \x1b[31m✗\x1b[0m  ${m.id} SURVIVED (${r}) — ${m.why}`); }
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log('\n' + '─'.repeat(58));
console.log(`${killed} killed, ${survivors.length} survived of ${ONLY.length ? ONLY.length : MUTANTS.length}`);
if (survivors.length) { survivors.forEach(s => console.log('  · ' + s)); process.exit(1); }
