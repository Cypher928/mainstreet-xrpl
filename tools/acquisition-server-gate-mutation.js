'use strict';
/**
 * tools/acquisition-server-gate-mutation.js — would anyone notice if a rule of
 * migration 044 (the server-side acquisition safeguards) were quietly undone?
 *
 *   node tools/acquisition-server-gate-mutation.js
 *
 * Each mutant undoes ONE rule in migrations/044_acquisition_conversion_
 * safeguards.sql, and tools/verify-migration-044.js (a throwaway PostgreSQL
 * cluster; no Supabase project is contacted) must fail for every one.
 *
 *   The gate (acquire_property 5c / 5d)
 *     G01  a leasehold with no lease on file needs no acknowledgement
 *     G02  any acknowledgement on the review counts, for any leasehold
 *     G03  a document set aside counts as the lease on file
 *     G04  a replaced document counts as the lease on file
 *     G05  a material mismatch needs no reason
 *     G06  a reason given for another entry of the leasehold counts
 *     G07  a reason given for another leasehold counts
 *     G08  a reasonless confirmation counts for a mismatch
 *     G09  the browser's leaseholdAcknowledgements map is honoured
 *
 *   The comparison (ported from acquisition-leasehold.js)
 *     G10  names sharing no distinguishing word are only "uncertain"
 *     G11  the lease's property is never compared
 *     G12  "&" is not read as "and"
 *
 *   The evidence (acquisition_conversion_attestations)
 *     G13  the caller is not stamped as the person who acknowledged
 *     G14  a row may claim to verify the lease terms
 *     G15  a leasehold of another review may be acknowledged on this one
 *     G16  a leasehold with its lease on file may be "acknowledged"
 *     G17  a mismatch may be confirmed without a reason
 *     G18  a read_only member may acknowledge
 *     G19  an attestation may be deleted outside a cascade
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const F = 'migrations/044_acquisition_conversion_safeguards.sql';

const MUTANTS = [
  { id: 'G01', why: 'a leasehold with no lease on file needs no acknowledgement',
    from: '  if v_docless > 0 then', to: '  if false then' },
  { id: 'G02', why: 'any acknowledgement on the review counts, for any leasehold',
    from: "        where a.review_id = p_review_id and a.family_id = f.id and a.kind = 'no_document_on_file');",
    to:   "        where a.review_id = p_review_id and a.kind = 'no_document_on_file');" },
  { id: 'G03', why: 'a document set aside counts as the lease on file',
    from: "        where d.review_id = p_review_id and d.family_id = f.id\n          and d.superseded_by_document_id is null\n          and coalesce(v_rev.data->'documentDispositions'->(d.id::text)->>'action', '') not in ('not_relevant', 'duplicate'))",
    to:   "        where d.review_id = p_review_id and d.family_id = f.id\n          and d.superseded_by_document_id is null)" },
  { id: 'G04', why: 'a replaced document counts as the lease on file',
    from: "        where d.review_id = p_review_id and d.family_id = f.id\n          and d.superseded_by_document_id is null\n",
    to:   "        where d.review_id = p_review_id and d.family_id = f.id\n" },
  { id: 'G05', why: 'a material mismatch needs no reason',
    from: '  if v_unreasoned > 0 then', to: '  if false then' },
  { id: 'G06', why: 'a reason given for another entry of the leasehold counts',
    from: "          and a.row_key = m.key and a.reason is not null", to: "          and a.reason is not null" },
  { id: 'G07', why: 'a reason given for another leasehold counts',
    from: "        where a.review_id = p_review_id and a.family_id = m.fid and a.kind = 'match_confirmed'",
    to:   "        where a.review_id = p_review_id and a.kind = 'match_confirmed'" },
  { id: 'G08', why: 'a reasonless confirmation counts for a mismatch',
    from: "          and a.row_key = m.key and a.reason is not null and length(btrim(a.reason)) > 0);",
    to:   "          and a.row_key = m.key);" },
  { id: 'G09', why: 'the browser\'s leaseholdAcknowledgements map is honoured',
    from: "     and not exists (\n       select 1 from public.acquisition_conversion_attestations a\n        where a.review_id = p_review_id and a.family_id = f.id and a.kind = 'no_document_on_file');",
    to:   "     and not exists (\n       select 1 from public.acquisition_conversion_attestations a\n        where a.review_id = p_review_id and a.family_id = f.id and a.kind = 'no_document_on_file')\n     and coalesce(v_rev.data->'leaseholdAcknowledgements'->(f.id::text)->>'condition', '') <> 'no_document_on_file';" },
  { id: 'G10', why: 'names sharing no distinguishing word are only "uncertain"',
    from: "  if not (da && db) then\n    return 'mismatch';", to: "  if not (da && db) then\n    return 'uncertain';" },
  { id: 'G11', why: 'the lease\'s property is never compared',
    from: "      or coalesce(public.acq_compare_property(", to: "      or false and coalesce(public.acq_compare_property(" },
  { id: 'G12', why: '"&" is not read as "and"',
    from: "  v_raw := replace(v_raw, '&', ' and ');", to: "" },
  { id: 'G13', why: 'the caller is not stamped as the person who acknowledged',
    from: '  new.acted_by   := v_uid;\n', to: '  new.acted_by   := coalesce(new.acted_by, v_uid);\n' },
  { id: 'G14', why: 'a row may claim to verify the lease terms',
    from: '                 constraint acq_attestations_verifies_nothing check (verifies_terms = false),', to: '                 ,' },
  { id: 'G15', why: 'a leasehold of another review may be acknowledged on this one',
    from: '  if not found or v_fam.review_id is distinct from new.review_id then', to: '  if not found then' },
  { id: 'G16', why: 'a leasehold with its lease on file may be "acknowledged"',
    from: "  if new.kind = 'no_document_on_file' then\n    if exists (", to: "  if new.kind = 'no_document_on_file' then\n    if false and exists (" },
  { id: 'G17', why: 'a mismatch may be confirmed without a reason',
    from: '    if new.reason is null\n       and public.acq_match_requires_reason(', to: '    if false\n       and public.acq_match_requires_reason(' },
  { id: 'G18', why: 'a read_only member may acknowledge',
    from: "                        and m.role <> 'read_only' and m.accepted_at is not null", to: "                        and m.accepted_at is not null" },
  { id: 'G19', why: 'an attestation may be deleted outside a cascade',
    from: "  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then", to: "  if tg_op = 'DELETE' then" },
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'acq-gate-mut-'));
for (const entry of ['migrations', 'tools', 'acquisition-leasehold.js']) fs.cpSync(path.join(ROOT, entry), path.join(tmp, entry), { recursive: true });
const ORIGINAL = fs.readFileSync(path.join(ROOT, F), 'utf8');
const verify = () => {
  try { execFileSync(process.execPath, ['tools/verify-migration-044.js'], { cwd: tmp, stdio: 'pipe', timeout: 600000 }); return true; }
  catch (_) { return false; }
};

const baseline = verify();
console.log('Baseline (unmutated copy): ' + (baseline ? 'PASS' : 'FAIL'));
if (!baseline) {
  console.error('\nThe unmutated copy does not pass, so every result below would be\n' +
                'meaningless. Nothing is mutated. Fix the harness or the verifier first.');
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(2);
}

let killed = 0;
const survived = [];
for (const m of MUTANTS) {
  const i = ORIGINAL.indexOf(m.from);
  if (i === -1) { console.log(`  ??   ${m.id}  ANCHOR NOT FOUND — malformed mutant`); survived.push(m.id + ' (malformed)'); continue; }
  if (ORIGINAL.indexOf(m.from, i + 1) !== -1) { console.log(`  ??   ${m.id}  ANCHOR NOT UNIQUE — malformed mutant`); survived.push(m.id + ' (anchor not unique)'); continue; }
  fs.writeFileSync(path.join(tmp, F), ORIGINAL.slice(0, i) + m.to + ORIGINAL.slice(i + m.from.length));
  const passed = verify();
  fs.writeFileSync(path.join(tmp, F), ORIGINAL);
  if (!passed) { killed++; console.log(`  kill ${m.id}  ${m.why}`); continue; }
  survived.push(`${m.id}: ${m.why}`);
  console.log(`  LIVE ${m.id}  ${m.why}`);
}
console.log(`\n${killed}/${MUTANTS.length} killed`);
if (survived.length) { console.log('\nSURVIVORS — each needs a written verdict (real gap or equivalent):'); survived.forEach(s => console.log('  · ' + s)); }
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(survived.length ? 1 : 0);
