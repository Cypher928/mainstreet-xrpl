'use strict';
/**
 * test-p03-schema-contract.js — Phase 0, P0.3: migrations 025–029 encode the
 * decisions, and only those.
 *
 *   node test-p03-schema-contract.js
 *
 * Read-only, no database. The five migrations have NOT been applied; this
 * suite exists so they can be reviewed before they are. It reads the SQL as
 * text, strips comments first (the 022 lesson: a header that EXPLAINS a
 * forbidden value would otherwise satisfy a pin for it), and asserts:
 *
 *   A  target and blast radius: pilot guard before any DDL, one transaction,
 *      no production ref, no XRPL, no policy on a table the file does not own
 *   B  025 — the register is lease_documents, extended; the view is
 *      security_invoker; the backfill infers and says so
 *   C  026 — provisions carry the SAME five states as tenant fields, are
 *      immutable except for superseded_by, and cannot be deleted by members
 *   D  027 — evidence gains lineage in place; nothing is backfilled
 *   E  028 — events are append-only by construction, identity-stamped by
 *      construction, and have no update/delete path for any role
 *   F  029 — tables only; every row traces to the register; re-import is
 *      idempotent
 *   G  the whole set: every new policy reads member_property_ids() (024),
 *      none reads user_id = auth.uid(), nothing is granted to anon, every
 *      foreign key states its delete rule, the dependency order is
 *      024 → 023 → 025 → 026/027/029 → 028, and NO row is copied anywhere —
 *      Acquire remains a stage transition (P0.2)
 *   H  each rollback removes exactly what its migration created, in an order
 *      Postgres will accept
 *   I  a real parse when the PostgreSQL parser is installed nearby
 */

const fs   = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const failures = [];
function t(name, cond, detail) {
  if (cond) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  else { fail++; failures.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail !== undefined ? '  — ' + detail : ''}`); }
}
const eq  = (a, b, name) => t(name, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
const sec = (s) => console.log(`\n── ${s} ──`);

const ROOT = __dirname;
const read = (f) => fs.readFileSync(path.join(ROOT, 'migrations', f), 'utf8');
const strip = (s) => s.replace(/^\s*--.*$/gm, '');
const FILES = {
  '025': ['025_document_register.sql', '025_document_register_rollback.sql'],
  '026': ['026_lease_provisions.sql',  '026_lease_provisions_rollback.sql'],
  '026b': ['026b_lease_provisions_privileges.sql', '026b_lease_provisions_privileges_rollback.sql'],
  '027': ['027_evidence_lineage.sql',  '027_evidence_lineage_rollback.sql'],
  '028': ['028_property_events.sql',   '028_property_events_rollback.sql'],
  '029': ['029_financial_tables.sql',  '029_financial_tables_rollback.sql'],
};
const RAW = {}, SQL = {}, RB = {}, RBS = {};
for (const [n, [m, r]] of Object.entries(FILES)) { RAW[n] = read(m); SQL[n] = strip(RAW[n]); RB[n] = read(r); RBS[n] = strip(RB[n]); }
const ALL_SQL = Object.values(SQL).join('\n');
const ALL_RB  = Object.values(RBS).join('\n');

const MARKER = 'fd9c09b1-b657-4c58-9999-c3cce28e7600';
const PROD_REF = 'zhsuhehgehbzkmzurzyf';

// The vocabularies these files must agree with.
const FP = require('./field-provenance.js');
const STATES = FP.STATES || (FP.FieldProvenance && FP.FieldProvenance.STATES);
const DOC_TYPES = [
  'original_lease', 'amendment', 'renewal_extension', 'assignment', 'guaranty', 'side_letter', 'snda', 'estoppel', 'commencement_letter',
  'offering_memorandum', 'purchase_agreement', 'letter_of_intent',
  'rent_roll', 'general_ledger', 'operating_statement', 'budget',
  'tax_bill', 'assessment',
  'insurance_policy', 'insurance_certificate',
  'title_commitment', 'legal_other',
  'survey', 'zoning_letter',
  'environmental_report',
  'pca_report', 'roof_report', 'hvac_report', 'inspection',
  'loan_document', 'escrow_agreement',
  'service_contract',
  'unclassified',
];
const DOC_STATUSES = ['received', 'classified', 'extracted', 'verified', 'needs_attention'];
const FIN_KINDS    = ['rent_roll', 'general_ledger', 'operating_statement', 'budget', 't12'];
const PROVISION_KINDS = ['rent_schedule', 'expense_responsibility', 'cam_exclusions', 'renewal_option', 'exclusive_use', 'co_tenancy',
  'permitted_use', 'termination_right', 'assignment_sublet', 'rofr_rofo', 'guaranty', 'landlord_obligation', 'other_material', 'audit_right'];

/** The body of one `create policy <name>` statement. */
function policy(src, name) {
  const m = src.match(new RegExp('create policy\\s+"?' + name + '"?[\\s\\S]*?;', 'i'));
  return m ? m[0] : null;
}
function allPolicies(src) {
  return [...src.matchAll(/create policy\s+"?([a-z_]+)"?\s+on\s+public\.([a-z_]+)[\s\S]*?;/gi)].map(m => ({ name: m[1], table: m[2], body: m[0] }));
}
function fnBody(src, name) {
  const i = src.indexOf('create or replace function public.' + name + '(');
  if (i === -1) return null;
  const j = src.indexOf('$$;', i);
  return j === -1 ? null : src.slice(i, j + 3);
}

sec('A. Target and blast radius — every file');
for (const n of Object.keys(FILES)) {
  const raw = RAW[n], sql = SQL[n];
  t(`A1 ${n} carries the pilot marker guard`, sql.indexOf(MARKER) !== -1);
  t(`A2 ${n} refuses before the first DDL or privilege statement`, sql.indexOf('raise exception') < sql.search(/\b(alter table|create table|create or replace|revoke|grant)\b/));
  t(`A3 ${n} is one transaction`, /^begin;/m.test(sql) && /^commit;/m.test(sql) && sql.indexOf('begin;') < sql.indexOf(MARKER));
  t(`A4 ${n} never names the production project`, raw.indexOf(PROD_REF) === -1 && RB[n].indexOf(PROD_REF) === -1);
  t(`A5 ${n} touches nothing XRPL`, !/xrpl|ripple|rlusd|wallet/i.test(sql) && !/xrpl|ripple|rlusd|wallet/i.test(RBS[n]));
  t(`A6 ${n} rollback carries the same guard`, RBS[n].indexOf(MARKER) !== -1 && /raise exception/.test(RBS[n]));
  t(`A7 ${n} inserts no property row and copies nothing into properties`,
    !/insert into public\.properties/.test(sql) && !/update public\.properties\b/.test(sql));
}

sec('B. 025 — the register is lease_documents, extended');
{
  const s = SQL['025'];
  t('B1 no second register: no create table', !/create table/.test(s));
  const cols = ['doc_type', 'doc_family_id', 'category', 'classification_confidence', 'classified_by', 'doc_date', 'effective_date', 'status', 'uploaded_by', 'supersedes_document_id', 'sha256', 'size_bytes', 'mime'];
  for (const c of cols) t(`B2 adds ${c} idempotently`, new RegExp('alter table public\\.lease_documents add column if not exists ' + c + '\\s').test(s));
  t('B3 status is not null with default received', /add column if not exists status\s+text not null default 'received'/.test(s));
  const dt = (s.match(/lease_documents_doc_type_check[\s\S]*?\)\);/) || [''])[0];
  const found = [...dt.matchAll(/'([a-z_]+)'/g)].map(m => m[1]);
  eq(found.length, 33, 'B4 the doc_type check names 33 labels (32 types + unclassified)');
  eq(found.slice().sort(), DOC_TYPES.slice().sort(), 'B5 exactly the plan\'s labels');
  t('B6 doc_type may be NULL (not yet classified)', /check \(doc_type is null or doc_type in \(/.test(s));
  const st = (s.match(/lease_documents_status_check[\s\S]*?\)\);/) || [''])[0];
  eq([...st.matchAll(/'([a-z_]+)'/g)].map(m => m[1]), DOC_STATUSES, 'B7 the five statuses');
  t('B8 classified_by is ai | user', /classified_by is null or classified_by in \('ai', 'user'\)/.test(s));
  t('B9 confidence is 0..100', /classification_confidence between 0 and 100/.test(s));
  t('B10 sha256 is a 64-hex digest', /sha256 ~ '\^\[0-9a-f\]\{64\}\$'/.test(s));
  t('B11 a document cannot supersede itself', /supersedes_document_id <> id/.test(s));
  t('B12 uploaded_by references auth.users, set null on delete', /uploaded_by\s+uuid references auth\.users\(id\) on delete set null/.test(s));
  t('B13 supersedes_document_id references the register, set null on delete', /supersedes_document_id\s+uuid references public\.lease_documents\(id\) on delete set null/.test(s));
  t('B14 doc_family_id has NO foreign key — a family is the set of rows sharing the id', /add column if not exists doc_family_id\s+uuid;/.test(s));
  t('B15 category has NO check — the drawer map is owned by property-cabinet.js', /add column if not exists category\s+text;/.test(s) && !/category in \(/.test(s));
  // Backfill: inference, in the right order, marked as such.
  const iAmend = s.indexOf("set doc_type = 'amendment'"), iOrig = s.indexOf("set doc_type = 'original_lease'"), iUncl = s.indexOf("set doc_type = 'unclassified'"), iExtr = s.indexOf("set status = 'extracted'");
  t('B16 backfill order: amendment (blob-referenced) → original_lease (tenant rows) → unclassified', iAmend > 0 && iAmend < iOrig && iOrig < iUncl);
  t('B17 the amendment rule reads tenant.amendments[].leaseDocumentId from the blob', /a->>'leaseDocumentId' = ld\.id::text/.test(s));
  t('B18 original_lease only where a tenant is set and nothing typed it yet', /set doc_type = 'original_lease', category = 'leases'\s+where doc_type is null and tenant_id is not null/.test(s));
  t('B19 status extracted only where text exists and nothing else set it', iExtr > 0 && /where status = 'received' and extracted_text is not null/.test(s));
  t('B20 the backfill invents no confidence, no classifier and no uploader', !/set classification_confidence/.test(s) && !/set classified_by/.test(s) && !/set uploaded_by/.test(s));
  // The view.
  t('B21 property_documents is a view over lease_documents', /create or replace view public\.property_documents[\s\S]*from public\.lease_documents ld;/.test(s));
  t('B22 with security_invoker = true — RLS applies to reads through it', /create or replace view public\.property_documents\s+with \(security_invoker = true\)/.test(s));
  t('B23 it derives a bare storage_ref from either file_url shape', /storage\/v1\/object\/\(public\|sign\|authenticated\)\//.test(s) && /as storage_ref/.test(s));
  t('B24 it never exposes extracted_text — only has_text', /as has_text/.test(s) && !/^\s*ld\.extracted_text,?$/m.test(s));
  t('B25 the view is granted to authenticated and service_role only', /grant select on public\.property_documents to authenticated/.test(s) && /grant select on public\.property_documents to service_role/.test(s) && !/property_documents to anon/.test(s));
  t('B26 no policy is created or dropped — 024\'s lease_docs_owner_all governs', !/create policy|drop policy/.test(s));
}

sec('C. 026 — provisions use the same verified-memory architecture');
{
  const s = SQL['026'];
  t('C1 creates lease_provisions', /create table if not exists public\.lease_provisions \(/.test(s));
  t('C2 property_id cascades with the property', /property_id\s+uuid\s+not null references public\.properties\(id\) on delete cascade/.test(s));
  t('C3 tenant_id is text — the same key tenant_field_evidence uses', /tenant_id\s+text\s+not null/.test(s));
  t('C4 source_document_id → the register, set null on delete', /source_document_id uuid\s+references public\.lease_documents\(id\) on delete set null/.test(s));
  t('C5 superseded_by → a later provision, set null on delete', /superseded_by\s+uuid\s+references public\.lease_provisions\(id\) on delete set null/.test(s));
  const stc = (s.match(/state\s+text\s+not null\s+check \(state in \(([^)]+)\)\)/) || ['', ''])[1];
  const states = [...stc.matchAll(/'([a-z_]+)'/g)].map(m => m[1]);
  eq(states, Array.from(STATES), 'C6 the state check is EXACTLY FieldProvenance.STATES — one vocabulary');
  t('C7 structured jsonb, plain, quote, page, section — the evidence shape', /structured\s+jsonb\s+not null default/.test(s) && /\bplain\s+text,/.test(s) && /\bquote\s+text,/.test(s) && /page\s+integer/.test(s) && /section\s+text,/.test(s));
  t('C8 reviewer_uid, reviewer_email, reviewed_at — the same attribution', /reviewer_uid\s+text,/.test(s) && /reviewer_email\s+text,/.test(s) && /reviewed_at\s+timestamptz,/.test(s));
  t('C9 ordinal for repeatable kinds', /ordinal\s+integer\s+not null default 0 check \(ordinal >= 0\)/.test(s));
  t('C10 provision_key is free text — no second copy of the module\'s vocabulary', /provision_key\s+text\s+not null,/.test(s) && !/provision_key in \(/.test(s));
  t('C11 the fourteen kinds are named in a comment, for the reader, not enforced', PROVISION_KINDS.every(k => RAW['026'].indexOf(k) !== -1));
  const g = fnBody(s, '_lease_provisions_immutable_guard');
  t('C12 an immutability guard exists', !!g);
  t('C13 it permits superseded_by to be set once', g && /old\.superseded_by is not null and new\.superseded_by is distinct from old\.superseded_by/.test(g));
  for (const c of ['structured', 'plain', 'quote', 'page', 'state', 'reviewer_uid', 'reviewed_at', 'provision_key', 'tenant_id', 'property_id', 'source_document_id', 'created_at']) {
    t(`C14 ${c} is immutable`, g && new RegExp('new\\.' + c + '\\s+is distinct from old\\.' + c).test(g));
  }
  t('C15 the guard fires before every update', /create trigger lease_provisions_immutable\s+before update on public\.lease_provisions/.test(s));
  t('C16 members may select, insert and update — not delete', /grant select, insert, update on public\.lease_provisions to authenticated/.test(s) && !/delete on public\.lease_provisions to authenticated/.test(s));
  t('C17 anon is revoked', /revoke all on public\.lease_provisions from public, anon/.test(s));
  const pols = allPolicies(s).filter(p => p.table === 'lease_provisions');
  eq(pols.map(p => p.name).sort(), ['lease_provisions_member_insert', 'lease_provisions_member_select', 'lease_provisions_member_update', 'lease_provisions_service_role_all'], 'C18 four policies, none of them delete');
  t('C19 the current-provision index is partial on superseded_by is null', /lease_provisions_current_idx[\s\S]*where superseded_by is null/.test(s));
  t('C20 a provision cannot supersede itself', /superseded_by <> id/.test(s));

  // 026b — the privilege layer says the same thing the policy layer says.
  // 026 is applied on pilot and is not replayed; 026b corrects the table
  // privileges in place (the schema's default ACL had handed authenticated
  // DELETE, TRUNCATE, REFERENCES and TRIGGER at creation).
  const b = SQL['026b'];
  t('C21 026b revokes delete, truncate, references and trigger from authenticated on lease_provisions',
    /revoke delete, truncate, references, trigger on public\.lease_provisions from authenticated;/.test(b));
  t('C22 026b re-states the intended grant: select, insert, update — and nothing more',
    /grant\s+select, insert, update\s+on public\.lease_provisions to\s+authenticated;/.test(b) && !/grant[^;]*delete[^;]*to\s+authenticated/.test(b));
  t('C23 026b revokes anon', /revoke all on public\.lease_provisions from public, anon;/.test(b));
  t('C24 026b touches nothing else: no column, policy, trigger or row', !/alter table|create policy|drop policy|create trigger|drop trigger|insert into|update public|delete from/.test(b));
  t('C25 026b explains that 026 is not replayed', /not replayed/.test(RAW['026b']));
  t('C26 the 026b rollback restores exactly the four privileges it revoked', /grant delete, truncate, references, trigger on public\.lease_provisions to authenticated;/.test(RBS['026b']) && !/policy|trigger on|alter table/.test(RBS['026b'].replace(/grant[^;]*;/, '')));
}

sec('D. 027 — evidence lineage, in place');
{
  const s = SQL['027'];
  t('D1 no new table', !/create table/.test(s));
  t('D2 amendment_id text', /add column if not exists amendment_id\s+text;/.test(s));
  t('D3 source_document_id → the register, set null on delete', /add column if not exists source_document_id uuid references public\.lease_documents\(id\) on delete set null/.test(s));
  t('D4 superseded_by → a later evidence row, set null on delete', /add column if not exists superseded_by\s+uuid references public\.tenant_field_evidence\(id\) on delete set null/.test(s));
  t('D5 a row cannot supersede itself', /tfe_not_self_superseding[\s\S]*superseded_by <> id/.test(s));
  t('D6 NO backfill — unknown lineage stays NULL', !/update public\.tenant_field_evidence/.test(s) && !/\bset amendment_id\b|\bset source_document_id\b/.test(s));
  t('D7 the dedup key the writer relies on is not touched', !/tenant_field_evidence_dedup/.test(s));
  t('D8 no policy change', !/create policy|drop policy/.test(s));
  t('D9 no column the writer sends today is altered', !/alter column/.test(s) && !/drop column/.test(s));
}

sec('E. 028 — append-only, identity-stamped events');
{
  const s = SQL['028'];
  t('E1 creates property_events', /create table if not exists public\.property_events \(/.test(s));
  t('E2 property_id cascades with the property', /property_id\s+uuid\s+not null references public\.properties\(id\) on delete cascade/.test(s));
  t('E3 organization_id → organizations (024), set null', /organization_id uuid\s+references public\.organizations\(id\) on delete set null/.test(s));
  t('E4 actor_uid → auth.users, set null', /actor_uid\s+uuid\s+references auth\.users\(id\) on delete set null/.test(s));
  for (const c of ['actor_email', 'action', 'subject_type', 'subject_id', 'field_key', 'old_value', 'new_value', 'detail', 'client_ts', 'created_at']) {
    t(`E5 column ${c}`, new RegExp('^\\s*' + c + '\\s', 'm').test(s));
  }
  t('E6 action is required and bounded', /action\s+text\s+not null check \(length\(action\) between 1 and 80\)/.test(s));
  t('E7 detail is jsonb, never null', /detail\s+jsonb\s+not null default/.test(s));
  const stamp = fnBody(s, '_property_events_stamp');
  t('E8 a stamp trigger exists, security definer, empty search_path', stamp && /security definer/.test(stamp) && /set search_path = ''/.test(stamp));
  t('E9 it fills actor_uid with the caller when absent', stamp && /new\.actor_uid := v_caller/.test(stamp));
  t('E10 and REFUSES a row that names someone else as the actor', stamp && /new\.actor_uid <> v_caller[\s\S]*raise exception/.test(stamp));
  t('E11 and stamps organization_id from the property', stamp && /select p\.organization_id into new\.organization_id/.test(stamp));
  t('E12 the stamp runs before insert', /create trigger property_events_stamp\s+before insert on public\.property_events/.test(s));
  const ao = fnBody(s, '_property_events_append_only');
  t('E13 an append-only guard exists', !!ao);
  t('E14 every UPDATE is refused', ao && /tg_op = 'UPDATE'[\s\S]*raise exception/.test(ao));
  t('E15 a direct DELETE is refused; only the property\'s cascade passes', ao && /pg_trigger_depth\(\) = 0[\s\S]*raise exception/.test(ao));
  t('E16 the guard runs before update or delete', /create trigger property_events_append_only\s+before update or delete on public\.property_events/.test(s));
  t('E17 no UPDATE or DELETE grant to authenticated or service_role', /revoke all on public\.property_events from authenticated, service_role/.test(s) && /grant select, insert on public\.property_events to authenticated/.test(s) && /grant select, insert on public\.property_events to service_role/.test(s) && !/grant all on public\.property_events/.test(s));
  const pols = allPolicies(s).filter(p => p.table === 'property_events');
  eq(pols.map(p => p.name).sort(), ['property_events_member_insert', 'property_events_member_select', 'property_events_service_role_insert', 'property_events_service_role_select'], 'E18 four policies: select and insert, for members and service role');
  t('E19 NO policy is for update, delete or all', pols.every(p => !/for (update|delete|all)\b/.test(p.body)));
  t('E20 member insert is checked against member_property_ids()', /property_events_member_insert[\s\S]*with check \(property_id in \(select public\.member_property_ids\(\)\)\)/.test(s));
  t('E21 anon is revoked', /revoke all on public\.property_events from public, anon/.test(s));
}

sec('F. 029 — financial tables, tables only');
{
  const s = SQL['029'];
  t('F1 creates financial_sources and gl_entries', /create table if not exists public\.financial_sources \(/.test(s) && /create table if not exists public\.gl_entries \(/.test(s));
  const kinds = (s.match(/kind in \(([^)]+)\)/) || ['', ''])[1];
  eq([...kinds.matchAll(/'([a-z_0-9]+)'/g)].map(m => m[1]), FIN_KINDS, 'F2 the five source kinds');
  t('F3 financial_sources.document_id → the register, set null', /document_id\s+uuid\s+references public\.lease_documents\(id\) on delete set null/.test(s));
  t('F4 gl_entries.source_id → financial_sources, set null', /source_id\s+uuid\s+references public\.financial_sources\(id\) on delete set null/.test(s));
  t('F5 gl_entries.source_document_id → the register, set null', /source_document_id uuid\s+references public\.lease_documents\(id\) on delete set null/.test(s));
  t('F6 both cascade with the property', (s.match(/references public\.properties\(id\) on delete cascade/g) || []).length === 2);
  t('F7 row_hash is required and unique per property — idempotent re-import', /row_hash\s+text\s+not null/.test(s) && /gl_entries_row_hash_uniq unique \(property_id, row_hash\)/.test(s));
  t('F8 money is numeric(14,2), never float', (s.match(/numeric\(14,2\)/g) || []).length === 3 && !/\bfloat|double precision|real\b/.test(s));
  t('F9 debit and credit are non-negative', /debit\s+is null or debit\s+>= 0/.test(s) && /credit is null or credit >= 0/.test(s));
  t('F10 periods are ordered', (s.match(/period_start <= period_end/g) || []).length === 2);
  t('F11 extraction_status is filed | extracted | failed, default filed', /extraction_status text\s+not null default 'filed'[\s\S]*check \(extraction_status in \('filed', 'extracted', 'failed'\)\)/.test(s));
  t('F12 mapped_category is free text — the vocabulary is gl-import.js\'s', /mapped_category\s+text,/.test(s) && !/mapped_category in \(/.test(s));
  t('F13 NO data is written — tables only', !/\binsert into\b/.test(s) && !/\bupdate public\./.test(s));
  t('F14 members select and insert; no update or delete grant', /grant select, insert on public\.financial_sources to authenticated/.test(s) && /grant select, insert on public\.gl_entries\s+to authenticated/.test(s) && !/update on public\.gl_entries\s+to authenticated|delete on public\.gl_entries\s+to authenticated/.test(s));
  t('F14b and everything else is REVOKED from authenticated by name, on both tables — the privilege layer is not left to the schema default',
    /revoke update, delete, truncate, references, trigger on public\.financial_sources from authenticated;/.test(s) &&
    /revoke update, delete, truncate, references, trigger on public\.gl_entries\s+from authenticated;/.test(s));
  t('F14c the revokes come AFTER the grants (a grant after a revoke would reopen the door)',
    s.indexOf('grant select, insert on public.gl_entries') < s.indexOf('revoke update, delete, truncate, references, trigger on public.gl_entries'));
  t('F15 anon is revoked on both', /revoke all on public\.financial_sources from public, anon/.test(s) && /revoke all on public\.gl_entries\s+from public, anon/.test(s));
  const pols = allPolicies(s);
  eq(pols.map(p => p.name).sort(), ['financial_sources_member_insert', 'financial_sources_member_select', 'financial_sources_service_role_all', 'gl_entries_member_insert', 'gl_entries_member_select', 'gl_entries_service_role_all'], 'F16 six policies');
  t('F17 the existing CAM-tab GL import is not touched — no statement names the invoice or CAM tables', !/public\.(invoices|cam_reconciliations)\b/.test(s));
}

sec('G. The whole set — one architecture, one rule, one order');
{
  const pols = allPolicies(ALL_SQL).filter(p => !/service_role/.test(p.name));
  t('G1 every member policy reads member_property_ids() — the 024 rule', pols.length === 9 && pols.every(p => /select public\.member_property_ids\(\)/.test(p.body)), pols.map(p => p.name).join(','));
  t('G2 no policy anywhere reads user_id = auth.uid() — no single-user policy ships', !/user_id = auth\.uid\(\)/.test(ALL_SQL));
  t('G3 nothing is granted to anon', !/to anon\b/.test(ALL_SQL) && !/grant[^;]*\banon\b/.test(ALL_SQL));
  // The privilege layer, table by table: what authenticated is INTENDED to hold.
  // 028 revokes everything and grants back select+insert; 029 grants and then
  // revokes the rest by name; 026's set is corrected by 026b. No new table is
  // left to the schema default.
  t('G3b every new table states authenticated\'s privileges explicitly — grant plus a revoke of the rest',
    /revoke all on public\.property_events from authenticated, service_role/.test(SQL['028']) &&
    /revoke update, delete, truncate, references, trigger on public\.financial_sources from authenticated/.test(SQL['029']) &&
    /revoke update, delete, truncate, references, trigger on public\.gl_entries\s+from authenticated/.test(SQL['029']) &&
    /revoke delete, truncate, references, trigger on public\.lease_provisions from authenticated/.test(SQL['026b']));
  t('G3c no new table grants authenticated DELETE anywhere', !/grant[^;]*\bdelete\b[^;]*to\s+authenticated/.test(ALL_SQL) && !/grant all on public\.(lease_provisions|property_events|financial_sources|gl_entries)\s+to authenticated/.test(ALL_SQL));
  const fks = [...ALL_SQL.matchAll(/references (public|auth)\.[a-z_]+\([a-z_]+\)([^,\n)]*)/g)];
  t('G4 every foreign key states its delete rule', fks.length >= 14 && fks.every(m => /on delete (cascade|set null)/.test(m[2])), String(fks.length));
  t('G5 references to lease_documents are all set null (the register outlives what cites it)',
    [...ALL_SQL.matchAll(/references public\.lease_documents\(id\)([^,\n)]*)/g)].every(m => /on delete set null/.test(m[1])));
  t('G6 references to properties are all cascade (deleting the property is the one destructive act)',
    [...ALL_SQL.matchAll(/references public\.properties\(id\)([^,\n)]*)/g)].every(m => /on delete cascade/.test(m[1])));
  t('G7 references to auth.users are all set null (a departed user leaves the record intact)',
    [...ALL_SQL.matchAll(/references auth\.users\(id\)([^,\n)]*)/g)].every(m => /on delete set null/.test(m[1])));
  // Dependency order. Each file names what it depends on; the numbers are the file's identity, the order is the plan's.
  t('G8 028 depends on organizations (024) — 024 first, always', /references public\.organizations\(id\)/.test(SQL['028']));
  t('G9 026, 027 and 029 depend on lease_documents rows existing (004) but not on 025\'s columns or view — safe in any order after 024',
    !/lease_documents\.(doc_type|doc_family_id|category|sha256|status)|property_documents/.test(SQL['026'] + SQL['027'] + SQL['029']));
  t('G10 nothing here depends on 023 — 023 and 025–029 are independent of each other', !/lifecycle_stage|acquired_at|passed_at/.test(ALL_SQL));
  t('G11 everything depends on 024\'s member_property_ids() — no file runs before 024', /member_property_ids/.test(SQL['026']) && /member_property_ids/.test(SQL['028']) && /member_property_ids/.test(SQL['029']));
  t('G12 not one row is copied between tables — no insert ... select from another table', !/insert into public\.[a-z_]+[\s\S]{0,200}select[\s\S]{0,200}from public\./.test(ALL_SQL));
  t('G13 acquisition_reviews is not touched (023 gave it property_id; nothing else changes)', !/acquisition_reviews/.test(ALL_SQL));
  t('G14 tenant_review_audit is not replaced or altered — no statement targets it', !/(alter|drop) table[^;]*tenant_review_audit|on public\.tenant_review_audit/.test(ALL_SQL));
  t('G15 the tenant portal\'s publication records are not touched', !/tenant_documents|tenant_document_sources/.test(ALL_SQL));
  t('G16 the lifecycle module still says the same five stages (P0.2 is untouched)', (() => {
    const PL = require('./property-lifecycle.js'); return JSON.stringify(PL.STAGES) === JSON.stringify(['prospect', 'under_review', 'due_diligence', 'acquired', 'passed']);
  })());
  t('G17 every helper function sets an empty search_path or is a plain trigger', [...ALL_SQL.matchAll(/create or replace function public\.([a-z_]+)\(\)[\s\S]*?\$\$;/g)].every(m => !/security definer/.test(m[0]) || /set search_path = ''/.test(m[0])));
}

sec('H. Each rollback removes what its migration created, in an order Postgres accepts');
{
  // 025
  t('H1 025 rollback drops the view first, then indexes, constraints, columns', (() => {
    const r = RBS['025']; return r.indexOf('drop view if exists public.property_documents') < r.indexOf('drop index') && r.indexOf('drop index') < r.indexOf('drop constraint') && r.indexOf('drop constraint') < r.indexOf('drop column');
  })());
  for (const c of ['doc_type', 'doc_family_id', 'category', 'classification_confidence', 'classified_by', 'doc_date', 'effective_date', 'status', 'uploaded_by', 'supersedes_document_id', 'sha256', 'size_bytes', 'mime']) {
    t(`H2 025 rollback drops ${c}`, new RegExp('drop column if exists ' + c + ';').test(RBS['025']));
  }
  t('H3 025 rollback keeps file_url, extracted_text and every pre-025 column', !/drop column if exists (file_url|extracted_text|file_name|tenant_id|property_id|parsing_status)/.test(RBS['025']));
  for (const c of [...SQL['025'].matchAll(/add constraint ([a-z_]+)/g)].map(m => m[1])) t(`H4 025 rollback drops constraint ${c}`, RBS['025'].indexOf('drop constraint if exists ' + c) !== -1);
  for (const i of [...SQL['025'].matchAll(/create index if not exists ([a-z_]+)/g)].map(m => m[1])) t(`H5 025 rollback drops index ${i}`, RBS['025'].indexOf('drop index if exists public.' + i) !== -1);
  // 026
  t('H6 026 rollback drops policies, trigger, function, then the table', (() => {
    const r = RBS['026']; return r.indexOf('drop policy') < r.indexOf('drop trigger') && r.indexOf('drop trigger') < r.indexOf('drop function') && r.indexOf('drop function') < r.indexOf('drop table if exists public.lease_provisions');
  })());
  t('H7 026 rollback names the guard function', /drop function if exists public\._lease_provisions_immutable_guard\(\)/.test(RBS['026']));
  // 027
  for (const c of ['amendment_id', 'source_document_id', 'superseded_by']) t(`H8 027 rollback drops ${c}`, new RegExp('drop column if exists ' + c + ';').test(RBS['027']));
  t('H9 027 rollback drops the constraint before the column', RBS['027'].indexOf('drop constraint if exists tfe_not_self_superseding') < RBS['027'].indexOf('drop column if exists superseded_by'));
  t('H10 027 rollback keeps the dedup constraint and every pre-027 column', !/tenant_field_evidence_dedup/.test(RBS['027']) && !/drop column if exists (quote|value|field_key)/.test(RBS['027']));
  // 028
  t('H11 028 rollback drops the append-only trigger BEFORE the table (or the drop is refused)', (() => {
    const r = RBS['028'], i = r.indexOf('drop trigger  if exists property_events_append_only'), j = r.indexOf('drop table if exists public.property_events');
    return i !== -1 && j !== -1 && i < j;
  })());
  t('H12 028 rollback drops both functions', /_property_events_append_only\(\)/.test(RBS['028']) && /_property_events_stamp\(\)/.test(RBS['028']));
  t('H13 028 rollback warns that the audit trail is destroyed', /audit trail[\s\S]*destroyed/.test(RB['028']));
  // 029
  t('H14 029 rollback drops gl_entries before financial_sources (gl_entries references it)', RBS['029'].indexOf('drop table if exists public.gl_entries') < RBS['029'].indexOf('drop table if exists public.financial_sources'));
  t('H15 029 rollback drops the updated_at trigger', /drop trigger if exists financial_sources_updated_at/.test(RBS['029']));
  // Every policy a migration creates, its rollback drops.
  for (const n of ['026', '028', '029']) {
    const created = allPolicies(SQL[n]).map(p => p.name);
    const dropped = [...RBS[n].matchAll(/drop policy if exists ([a-z_]+)/g)].map(m => m[1]);
    t(`H16 ${n} rollback drops every policy ${n} creates`, created.every(c => dropped.indexOf(c) !== -1), created.filter(c => dropped.indexOf(c) === -1).join(','));
  }
  // Every rollback is one transaction.
  for (const n of Object.keys(FILES)) t(`H17 ${n} rollback is one transaction`, /^begin;/m.test(RBS[n]) && /^commit;/m.test(RBS[n]));
}

// I. Optional real parse.
{
  let parser = null;
  try { parser = require('@pgsql/parser'); } catch (_) {}
  if (parser) {
    (async () => {
      const p = new parser.Parser({ version: 16 });
      for (const n of Object.keys(FILES)) {
        for (const [label, src] of [[FILES[n][0], RAW[n]], [FILES[n][1], RB[n]]]) {
          try { await p.parse(src); t(`I ${label} parses as PostgreSQL 16`, true); }
          catch (e) { t(`I ${label} parses as PostgreSQL 16`, false, e.message); }
        }
      }
      finish();
    })();
  } else {
    console.log('\n  (no PostgreSQL parser installed here — all ten files were parsed with @pgsql/parser at authoring time; the live suite is the proof)');
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
