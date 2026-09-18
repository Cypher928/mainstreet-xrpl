'use strict';
/**
 * tools/p03-schema-mutation.js — does the P0.3 schema contract bite?
 *
 *   node tools/p03-schema-mutation.js
 *
 * Each mutant is a one-token edit to a migration file that would quietly
 * change what ships: widen a policy, hand anon a grant, let events be
 * deleted, let a provision be edited in place, make the view bypass RLS,
 * fabricate a backfill value, drop a delete rule. The contract suite must
 * object to every one. Two negative controls close the door on the people
 * it must admit.
 *
 * A FAILING BASELINE IS NOT A PASS.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const M = (n) => 'migrations/' + n;

const MUTANTS = [
  // ── 025 ───────────────────────────────────────────────────────────────────
  { id: 'R01', file: M('025_document_register.sql'), why: 'the view runs as its owner — every organisation\'s documents readable through it',
    from: "create or replace view public.property_documents\nwith (security_invoker = true) as", to: "create or replace view public.property_documents as" },
  { id: 'R02', file: M('025_document_register.sql'), why: 'the view exposes extracted_text',
    from: "  ld.parsing_status,\n", to: "  ld.parsing_status,\n  ld.extracted_text,\n" },
  { id: 'R03', file: M('025_document_register.sql'), why: 'the backfill fabricates a classifier for inferred rows',
    from: "set doc_type = 'original_lease', category = 'leases'\nwhere doc_type is null and tenant_id is not null;",
    to:   "set doc_type = 'original_lease', category = 'leases', classified_by = 'ai', classification_confidence = 100\nwhere doc_type is null and tenant_id is not null;" },
  { id: 'R04', file: M('025_document_register.sql'), why: 'a label leaves the doc_type vocabulary',
    from: "        'service_contract',\n", to: "" },
  { id: 'R05', file: M('025_document_register.sql'), why: 'the view is granted to anon',
    from: "grant select on public.property_documents to service_role;", to: "grant select on public.property_documents to service_role;\ngrant select on public.property_documents to anon;" },
  { id: 'R06', file: M('025_document_register.sql'), why: 'deleting a register row deletes what supersedes it (cascade instead of set null)',
    from: "supersedes_document_id    uuid references public.lease_documents(id) on delete set null", to: "supersedes_document_id    uuid references public.lease_documents(id) on delete cascade" },
  // ── 026 ───────────────────────────────────────────────────────────────────
  { id: 'P01', file: M('026_lease_provisions.sql'), why: 'a provision state outside the five is accepted',
    from: "check (state in ('lease_confirmed', 'manually_confirmed', 'manually_entered', 'ai_extracted', 'unknown'))",
    to:   "check (state in ('lease_confirmed', 'manually_confirmed', 'manually_entered', 'ai_extracted', 'unknown', 'verified'))" },
  { id: 'P02', file: M('026_lease_provisions.sql'), why: 'a provision\'s plain sentence can be edited in place',
    from: "  or new.plain              is distinct from old.plain\n", to: "" },
  { id: 'P03', file: M('026_lease_provisions.sql'), why: 'members may delete provisions — history is not kept',
    from: "grant select, insert, update on public.lease_provisions to authenticated;", to: "grant select, insert, update, delete on public.lease_provisions to authenticated;" },
  { id: 'P04', file: M('026_lease_provisions.sql'), why: 'the select policy is the single-user rule',
    from: "create policy lease_provisions_member_select on public.lease_provisions\n  for select to authenticated\n  using (property_id in (select public.member_property_ids()));",
    to:   "create policy lease_provisions_member_select on public.lease_provisions\n  for select to authenticated\n  using (property_id in (select id from public.properties where user_id = auth.uid()));" },
  { id: 'P05', file: M('026_lease_provisions.sql'), why: 'the immutability trigger is not attached',
    from: "create trigger lease_provisions_immutable\n  before update on public.lease_provisions", to: "create trigger lease_provisions_immutable\n  after update on public.lease_provisions" },
  // ── 027 ───────────────────────────────────────────────────────────────────
  { id: 'L01', file: M('027_evidence_lineage.sql'), why: 'lineage is backfilled by guess',
    from: "create index if not exists tfe_source_document_idx", to: "update public.tenant_field_evidence set source_document_id = null where false;\ncreate index if not exists tfe_source_document_idx" },
  { id: 'L02', file: M('027_evidence_lineage.sql'), why: 'deleting a register row deletes the evidence that cited it',
    from: "add column if not exists source_document_id uuid references public.lease_documents(id) on delete set null", to: "add column if not exists source_document_id uuid references public.lease_documents(id) on delete cascade" },
  // ── 028 ───────────────────────────────────────────────────────────────────
  { id: 'E01', file: M('028_property_events.sql'), why: 'a member can write an event as someone else',
    from: "    elsif new.actor_uid <> v_caller then\n      raise exception 'property_events.actor_uid must be the caller' using errcode = 'insufficient_privilege';\n    end if;", to: "    end if;" },
  { id: 'E02', file: M('028_property_events.sql'), why: 'a direct DELETE passes',
    from: "  if pg_trigger_depth() = 0 then", to: "  if pg_trigger_depth() = 99 then" },
  { id: 'E03', file: M('028_property_events.sql'), why: 'events can be updated',
    from: "  if tg_op = 'UPDATE' then\n    raise exception", to: "  if tg_op = 'NEVER' then\n    raise exception" },
  { id: 'E04', file: M('028_property_events.sql'), why: 'service_role is granted everything, including delete',
    from: "grant select, insert on public.property_events to service_role;", to: "grant all on public.property_events to service_role;" },
  { id: 'E05', file: M('028_property_events.sql'), why: 'a delete policy appears',
    from: "create policy property_events_service_role_insert on public.property_events\n  for insert to service_role with check (true);",
    to:   "create policy property_events_service_role_insert on public.property_events\n  for insert to service_role with check (true);\ncreate policy property_events_member_delete on public.property_events\n  for delete to authenticated using (true);" },
  { id: 'E06', file: M('028_property_events.sql'), why: 'the stamp function loses its empty search_path',
    from: "language plpgsql\nsecurity definer\nset search_path = ''\nas $$\ndeclare\n  v_caller", to: "language plpgsql\nsecurity definer\nas $$\ndeclare\n  v_caller" },
  { id: 'E07', file: M('028_property_events.sql'), why: 'the append-only guard is not attached to delete',
    from: "  before update or delete on public.property_events", to: "  before update on public.property_events" },
  // ── 029 ───────────────────────────────────────────────────────────────────
  { id: 'F01', file: M('029_financial_tables.sql'), why: 'a re-import duplicates ledger lines (row_hash no longer unique)',
    from: "  constraint gl_entries_row_hash_uniq unique (property_id, row_hash)\n", to: "" },
  { id: 'F02', file: M('029_financial_tables.sql'), why: 'money becomes floating point',
    from: "amount             numeric(14,2),", to: "amount             double precision," },
  { id: 'F03', file: M('029_financial_tables.sql'), why: 'the ledger is seeded with data',
    from: "-- ── RLS ────────────────────────────────────────────────────────────────────\nalter table public.financial_sources enable row level security;",
    to:   "insert into public.financial_sources (property_id, kind) select id, 'budget' from public.properties;\n-- ── RLS ────────────────────────────────────────────────────────────────────\nalter table public.financial_sources enable row level security;" },
  { id: 'F04', file: M('029_financial_tables.sql'), why: 'anon may read the ledger',
    from: "revoke all on public.gl_entries        from public, anon;", to: "revoke all on public.gl_entries        from public;" },
  { id: 'F05', file: M('029_financial_tables.sql'), why: 'the ledger is left with the schema-default DELETE privilege (the 026 mismatch, again)',
    from: "revoke update, delete, truncate, references, trigger on public.gl_entries        from authenticated;\n", to: "" },
  { id: 'F06', file: M('029_financial_tables.sql'), why: 'financial_sources is left with the schema-default privileges',
    from: "revoke update, delete, truncate, references, trigger on public.financial_sources from authenticated;\n", to: "" },
  { id: 'F07', file: M('029_financial_tables.sql'), why: 'the revoke is issued before the grant, so the grant reopens it',
    from: "grant select, insert on public.gl_entries        to authenticated;\nrevoke update, delete, truncate, references, trigger on public.financial_sources from authenticated;\nrevoke update, delete, truncate, references, trigger on public.gl_entries        from authenticated;",
    to:   "revoke update, delete, truncate, references, trigger on public.financial_sources from authenticated;\nrevoke update, delete, truncate, references, trigger on public.gl_entries        from authenticated;\ngrant select, insert on public.gl_entries        to authenticated;" },
  // ── 026b ──────────────────────────────────────────────────────────────────
  { id: 'H01', file: M('026b_lease_provisions_privileges.sql'), why: 'the hardening forgets DELETE',
    from: "revoke delete, truncate, references, trigger on public.lease_provisions from authenticated;", to: "revoke truncate, references, trigger on public.lease_provisions from authenticated;" },
  { id: 'H02', file: M('026b_lease_provisions_privileges.sql'), why: 'the hardening revokes from anon only, leaving authenticated as it was',
    from: "revoke delete, truncate, references, trigger on public.lease_provisions from authenticated;", to: "revoke delete, truncate, references, trigger on public.lease_provisions from anon;" },
  { id: 'H03', file: M('026b_lease_provisions_privileges.sql'), why: 'the hardening grants delete back',
    from: "grant  select, insert, update                  on public.lease_provisions to   authenticated;", to: "grant  select, insert, update, delete          on public.lease_provisions to   authenticated;" },
  { id: 'H04', file: M('026b_lease_provisions_privileges.sql'), why: 'the hardening slips in a policy change',
    from: "revoke all on public.lease_provisions from public, anon;", to: "revoke all on public.lease_provisions from public, anon;\ncreate policy lease_provisions_member_delete on public.lease_provisions for delete to authenticated using (true);" },
  // ── rollbacks ─────────────────────────────────────────────────────────────
  { id: 'B01', file: M('028_property_events_rollback.sql'), why: 'the rollback drops the table before its append-only trigger (the drop would be refused)',
    from: "drop trigger  if exists property_events_append_only on public.property_events;\n", to: "" },
  { id: 'B02', file: M('029_financial_tables_rollback.sql'), why: 'the rollback drops financial_sources before gl_entries (the FK refuses)',
    from: "drop table if exists public.gl_entries;\ndrop table if exists public.financial_sources;", to: "drop table if exists public.financial_sources;\ndrop table if exists public.gl_entries;" },
  { id: 'B03', file: M('025_document_register_rollback.sql'), why: 'the rollback forgets a column',
    from: "alter table public.lease_documents drop column if exists sha256;\n", to: "" },
  // ── negative controls ────────────────────────────────────────────────────
  { id: 'N01', file: M('026_lease_provisions.sql'), why: 'NEGATIVE CONTROL — members lose insert; the abstract cannot be written',
    from: "grant select, insert, update on public.lease_provisions to authenticated;", to: "grant select on public.lease_provisions to authenticated;" },
  { id: 'N02', file: M('028_property_events.sql'), why: 'NEGATIVE CONTROL — the guard refuses the property cascade too, so no property can ever be deleted',
    from: "  if pg_trigger_depth() = 0 then\n    raise exception", to: "  if true then\n    raise exception" },
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'p03mut-'));
fs.cpSync(ROOT, tmp, {
  recursive: true,
  filter: (src) => {
    const rel = path.relative(ROOT, src);
    return !(rel === '.git' || rel.startsWith('.git' + path.sep) || rel === 'node_modules' || rel.startsWith('node_modules' + path.sep));
  },
});
const ORIGINAL = {};
for (const m of MUTANTS) if (!ORIGINAL[m.file]) ORIGINAL[m.file] = fs.readFileSync(path.join(ROOT, m.file), 'utf8');

const SUITES = ['test-p03-schema-contract.js'];
function runSuites() {
  const failed = [];
  for (const suite of SUITES) {
    try { execFileSync(process.execPath, [suite], { cwd: tmp, stdio: 'pipe', timeout: 120000 }); }
    catch (_) { failed.push(suite); }
  }
  return failed;
}

const baseline = runSuites();
console.log('Baseline (unmutated copy): ' + (baseline.length ? 'FAIL ' + baseline.join(', ') : 'PASS'));
if (baseline.length) {
  console.error('\nThe unmutated copy does not pass, so every result below would be meaningless. Nothing is mutated.');
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(2);
}

let killed = 0, survived = 0;
const survivors = [];
for (const m of MUTANTS) {
  const src = ORIGINAL[m.file];
  if (src.indexOf(m.from) === -1) {
    console.log(`  ?  ${m.id} anchor not found in ${m.file} — the harness is stale, not the product`);
    survived++; survivors.push(m.id + ' (anchor missing)');
    continue;
  }
  fs.writeFileSync(path.join(tmp, m.file), src.replace(m.from, m.to));
  const failed = runSuites();
  fs.writeFileSync(path.join(tmp, m.file), src);
  if (failed.length) { killed++; console.log(`  \x1b[32m☠\x1b[0m  ${m.id} killed — ${m.why}`); }
  else { survived++; survivors.push(m.id); console.log(`  \x1b[31m✗\x1b[0m  ${m.id} SURVIVED — ${m.why}`); }
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log('\n' + '─'.repeat(58));
console.log(`${killed} killed, ${survived} survived of ${MUTANTS.length}`);
if (survived) { survivors.forEach(s => console.log('  · ' + s)); process.exit(1); }
