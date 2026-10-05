'use strict';
/**
 * tools/ledger-import-mutation.js — would anyone notice if a rule of the
 * acquisition general ledger (migration 046 and its endpoints) were quietly
 * undone?
 *
 *   node tools/ledger-import-mutation.js
 *
 * Each mutant undoes ONE rule. Database rules must be caught by
 * tools/verify-migration-046.js; endpoint rules by
 * tools/verify-ledger-import-endpoint.js; concurrency rules by
 * tools/verify-ledger-concurrency.js. All run against throwaway
 * PostgreSQL clusters; no Supabase project is contacted. MS_PG_SERVER_BIN,
 * when set, is passed through.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const MIG = 'migrations/046_acquisition_general_ledger.sql';
const RB  = 'migrations/046_acquisition_general_ledger_rollback.sql';
const IMP = 'api/_ledger-import.js';
const REV = 'api/_ledger-reverse.js';
const COM = 'api/_ledger-common.js';
const UPL = 'api/upload.js';
const V046 = 'tools/verify-migration-046.js';
const VAPI = 'tools/verify-ledger-import-endpoint.js';
const VCON = 'tools/verify-ledger-concurrency.js';

const MUTANTS = [
  { id: 'L01', file: MIG, why: 'anyone who can see the document may import',
    from: "  if not found or not public.ledger_actor_may_edit(p_actor, v_doc.property_id) then", to: "  if not found then" },
  { id: 'L02', file: MIG, why: 'a converted acquisition takes an import',
    from: "  if v_status is null or v_status not in ('draft', 'analyzing', 'complete') then\n    raise exception 'Review % is %; a ledger is imported only",
    to: "  if false then\n    raise exception 'Review % is %; a ledger is imported only" },
  { id: 'L03', file: MIG, why: 'the import need not be read from the document\'s own stored original',
    from: "  if v_doc.storage_path is null or v_path is distinct from v_doc.storage_path then", to: "  if v_doc.storage_path is null then" },
  { id: 'L04', file: MIG, why: 'the stored object need not exist with the size the server read',
    from: "  if not found then\n    raise exception 'The stored original is not in storage with that size'", to: "  if false then\n    raise exception 'The stored original is not in storage with that size'" },
  { id: 'L05', file: MIG, why: 'the previewed file need not be the stored original',
    from: "  if (p_preview->>'fileSha256') is distinct from v_sha then", to: "  if false then" },
  { id: 'L06', file: MIG, why: 'the imported totals need not equal the preview',
    from: "  if (p_preview->>'lines') is distinct from v_n::text or (p_preview->>'debitCents') is distinct from v_debit::text", to: "  if false and (p_preview->>'debitCents') is distinct from v_debit::text" },
  { id: 'L07', file: MIG, why: 'an untrusted line with a matching hash is counted as present (the silent skip returns)',
    from: "  if v_untrusted > 0 then", to: "  if false then" },
  // EQUIVALENT: a line held by an active import shares the incoming key's
  // sha256, and the key encodes exactly the compared fields; only a sha256
  // collision could make the content differ. Kept as a second layer.
  { id: 'L08', file: MIG, equivalent: true, why: 'content is not compared for a line an active import holds',
    from: "      or g.posted_on is distinct from i.posted_on\n", to: "      or false\n" },
  { id: 'L09', file: MIG, why: 'an unbalanced ledger needs no reason',
    from: "  if v_debit <> v_credit and v_reason is null then", to: "  if false then" },
  { id: 'L10', file: MIG, why: 'the date order need not be the one previewed',
    from: "  if (p_preview->>'dateOrder') is distinct from v_order then", to: "  if false then" },
  { id: 'L11', file: MIG, why: 'the 10,000-line ceiling is lifted',
    from: "  c_max_lines constant integer := 10000;", to: "  c_max_lines constant integer := 100000;" },
  { id: 'L12', file: MIG, why: 'any editor may reverse',
    from: "  if not public.ledger_actor_is_admin(p_actor, v_src.property_id) then", to: "  if not public.ledger_actor_may_edit(p_actor, v_src.property_id) then" },
  { id: 'L13', file: MIG, why: 'a reversal needs no reason',
    from: "  if v_reason is null then\n    raise exception 'A reversal needs a reason'", to: "  if false then\n    raise exception 'A reversal needs a reason'" },
  { id: 'L14', file: MIG, why: 'a converted acquisition\'s import may be reversed',
    from: "  if v_status is null or v_status not in ('draft', 'analyzing', 'complete') then\n    raise exception 'The acquisition is %; its ledger is frozen",
    to: "  if false then\n    raise exception 'The acquisition is %; its ledger is frozen" },
  { id: 'L15', file: MIG, why: 'a reversal removes lines another import still holds',
    from: "  delete from public.gl_entries g using pg_temp._gl_reverse r\n   where g.id = r.gl_entry_id and not exists (select 1 from public.gl_entry_sources l where l.gl_entry_id = g.id);",
    to: "  delete from public.gl_entry_sources l using pg_temp._gl_reverse r where l.gl_entry_id = r.gl_entry_id;\n  delete from public.gl_entries g using pg_temp._gl_reverse r where g.id = r.gl_entry_id;" },
  { id: 'L16', file: MIG, why: 'a reversal leaves no history',
    from: "  values (v_hist, 'reverse', p_actor,", to: "  select v_hist, 'reverse', p_actor," , extra: { from: "          jsonb_build_object('linesRemoved', v_removed, 'linesKeptByOtherImports', v_kept, 'linesHandedOver', v_handed));", to: "          jsonb_build_object('linesRemoved', v_removed, 'linesKeptByOtherImports', v_kept, 'linesHandedOver', v_handed) where false;" } },
  { id: 'L17', file: MIG, why: 'history may be edited',
    from: "  raise exception 'ledger_import_history is append-only (%)', tg_op using errcode = 'insufficient_privilege';",
    to: "  if tg_op = 'UPDATE' then return new; end if;\n  raise exception 'ledger_import_history is append-only (%)', tg_op using errcode = 'insufficient_privilege';" },
  { id: 'L18', file: MIG, why: 'an imported document may be deleted on its own',
    from: "     and exists (select 1 from public.acquisition_reviews r where r.property_id = old.property_id) then", to: "     and false then" },
  { id: 'L19', file: MIG, why: 'a signed-in person may delete the stored original',
    from: "create policy acq_evidence_no_delete on storage.objects\n  as restrictive for delete to authenticated\n  using (not public.storage_object_is_acquisition_evidence(bucket_id, name));",
    to: "create policy acq_evidence_no_delete on storage.objects\n  as restrictive for delete to authenticated\n  using (true);" },
  { id: 'L20', file: MIG, why: 'a signed-in person may overwrite or move the stored original',
    from: "create policy acq_evidence_no_update on storage.objects\n  as restrictive for update to authenticated\n  using (not public.storage_object_is_acquisition_evidence(bucket_id, name));",
    to: "create policy acq_evidence_no_update on storage.objects\n  as restrictive for update to authenticated\n  using (true);" },
  { id: 'L21', file: MIG, why: 'a signed-in person may call the import directly',
    from: "grant execute on function public.import_general_ledger(uuid, uuid, jsonb, jsonb, jsonb, text) to service_role;",
    to: "grant execute on function public.import_general_ledger(uuid, uuid, jsonb, jsonb, jsonb, text) to service_role, authenticated;" },
  { id: 'L22', file: MIG, why: 'an imported line may be deleted directly',
    from: "    raise exception 'An imported ledger line is removed only by reversing its import'", to: "    return old;\n    raise exception 'An imported ledger line is removed only by reversing its import'" },
  { id: 'L23', file: MIG, why: 'an acquisition source may be filed without the import',
    from: "    if new.acquisition_document_id is not null\n       and coalesce(current_setting('mainstreet.gl_import_document', true), '') <> new.acquisition_document_id::text then",
    to: "    if false then" },
  { id: 'L24', file: MIG, why: 'the purge ignores the seven-year retention',
    from: "having max(x.occurred_at) < now() - interval '7 years'", to: "having max(x.occurred_at) < now()" },
  { id: 'L25', file: MIG, why: 'the purge removes the history of properties that still exist',
    from: "   where not exists (select 1 from public.properties p where p.id = h.property_id)\n     and h.property_id in", to: "   where h.property_id in" },
  { id: 'L26', file: RB, why: 'the rollback discards history',
    from: "  if v_sources + v_lines + v_reversed + v_history > 0 then", to: "  if v_sources + v_lines + v_reversed > 0 then" },
  { id: 'E01', file: IMP, verifier: VAPI, why: 'the endpoint accepts a preview of another file',
    from: "  if (p.fileSha256 !== sha256) {", to: "  if (false) {" },
  { id: 'E02', file: IMP, verifier: VAPI, why: 'the endpoint does not compare its reading with the preview',
    from: "    if (s.lines !== p.lines || s.debitCents !== p.debitCents || s.creditCents !== p.creditCents || s.dateOrder !== p.dateOrder) {", to: "    if (false) {" },
  { id: 'E03', file: IMP, verifier: VAPI, why: 'the endpoint imports rows a browser sent',
    from: "    const payload = GL.importPayload(parsed);", to: "    const payload = b.payload || GL.importPayload(parsed);" },
  { id: 'E04', file: IMP, verifier: VAPI, why: 'an ambiguous file is read month-first without asking',
    from: "dateOrder: b.dateOrder || undefined,", to: "dateOrder: b.dateOrder || 'mdy'," },
  { id: 'E05', file: COM, verifier: VAPI, why: 'an original in another person\'s folder is accepted',
    from: "  if (m[1].toLowerCase() !== String(ownerId || '').toLowerCase()) return null;", to: "" },
  { id: 'E06', file: IMP, verifier: VAPI, why: 'the endpoint reads an original of any size',
    from: "    if (n > max) return null;   // leaving the loop cancels the stream", to: "", extra: { from: "      if (declared > GL.MAX_FILE_BYTES)", to: "      if (false)" } },
  { id: 'E07', file: IMP, verifier: VAPI, why: 'no rate limit in front of the import',
    from: "    if (!rl.ok) return rate.sendRateLimited(res, rl);", to: "" },
  { id: 'E08', file: UPL, verifier: VAPI, why: 'an acquisition original may be overwritten by a second upload',
    from: "      'x-upsert':      isAcquisitionOriginal ? 'false' : 'true',", to: "      'x-upsert':      'true'," },
  { id: 'L27', file: MIG, verifier: VCON, why: 'an import does not wait for a reversal of the same property (the silent line loss returns)',
    from: "    perform pg_advisory_xact_lock(46, hashtext(v_doc.property_id::text));", to: "" },
  { id: 'L28', file: MIG, verifier: VCON, why: 'a reversal does not wait for an import of the same property',
    from: "    perform pg_advisory_xact_lock(46, hashtext(v_src.property_id::text));", to: "" },
  { id: 'L29', file: MIG, verifier: VCON, why: 'the wait for another ledger change is unbounded',
    from: "    perform set_config('lock_timeout', '5s', true);\n    perform pg_advisory_xact_lock(46, hashtext(v_doc.property_id::text));",
    to: "    perform pg_advisory_xact_lock(46, hashtext(v_doc.property_id::text));" },
  { id: 'L30', file: MIG, verifier: VCON, why: 'the 5 s lock wait leaks into the rest of the import',
    from: "  perform set_config('lock_timeout', v_prev_lock_timeout, true);\n  select r.status into v_status", to: "  select r.status into v_status" },
  { id: 'E13', file: IMP, verifier: VAPI, why: 'a download without a Content-Length is read whole, whatever its size',
    from: "    if (n > max) return null;   // leaving the loop cancels the stream", to: "" },
  { id: 'E14', file: UPL, verifier: VAPI, why: 'an original is recognised by the name sent, not the name stored (acq\\… overwrites acq_…)',
    from: "  return /^acq_/.test(String(fileName || '').replace(/[^a-zA-Z0-9._-]/g, '_'));", to: "  return /^acq[\\/_]/.test(String(fileName || ''));" },
  { id: 'E15', file: UPL, verifier: VAPI, why: 'an ordinary upload is no longer an upsert (normal behaviour changed)',
    from: "      'x-upsert':      isAcquisitionOriginal ? 'false' : 'true',", to: "      'x-upsert':      'false'," },
  { id: 'E16', file: UPL, verifier: VAPI, why: 'a prototype name is accepted as an op',
    from: "    if (typeof op !== 'string' || !Object.prototype.hasOwnProperty.call(LEDGER_OPS, op)) {", to: "    if (typeof op !== 'string' || !(op in LEDGER_OPS)) {" },
  { id: 'E17', file: COM, verifier: VAPI, why: 'a busy ledger (55P03) is told as a generic failure',
    from: "  '55P03': 409,   // lock_not_available — another import or reversal is still running\n", to: "" },
  { id: 'L31', file: MIG, why: 'an editor may import an unbalanced ledger by giving a reason (admins only is undone)',
    from: "  if v_debit <> v_credit and not public.ledger_actor_is_admin(p_actor, v_doc.property_id) then", to: "  if false then" },
  { id: 'L32', file: MIG, why: 'the durable per-person import ceiling is lifted',
    from: "       where h.actor_uid = p_actor and h.action = 'import' and h.occurred_at > now() - interval '1 minute') >= c_actor_imports_per_minute then",
    to:   "       where h.actor_uid = p_actor and h.action = 'import' and h.occurred_at > now() - interval '1 minute') >= 1000000 then" },
  { id: 'L33', file: MIG, verifier: VCON, why: 'one person\'s imports no longer take turns, so the ceiling can be passed by running them at once',
    from: "    perform pg_advisory_xact_lock(46, hashtext('actor:' || p_actor::text));", to: "" },
  { id: 'L34', file: MIG, why: 'the integrity check ignores a changed size',
    from: "      when r.o_size !~ '^[0-9]+$' or r.o_size::bigint <> r.file_bytes then 'size'", to: "" },
  { id: 'L35', file: MIG, why: 'the integrity check ignores a changed ETag',
    from: "      when r.file_etag is not null and r.o_etag is not null and r.o_etag <> r.file_etag then 'etag'", to: "" },
  { id: 'L36', file: MIG, why: 'the integrity check records nothing',
    from: "    if v_last is not distinct from v_detail then continue; end if;   -- already on record, unchanged", to: "    continue;" },
  { id: 'L37', file: MIG, why: 'the integrity check records the same finding again on every run',
    from: "    if v_last is not distinct from v_detail then continue; end if;   -- already on record, unchanged", to: "" },
  { id: 'L38', file: MIG, why: 'the maintenance run is not recorded',
    from: "  insert into public.ledger_maintenance_runs (purged, integrity) values (v_purged, v_integrity) returning id into v_id;", to: "  v_id := gen_random_uuid();" },
  { id: 'L39', file: MIG, why: 'the import does not record storage\'s ETag (a later overwrite with the same size goes unseen)',
    from: "      (v_doc.property_id, 'general_ledger', v_doc.id, 'active', v_sha, v_bytes, v_etag, v_path, v_order, v_start, v_end, 'extracted',",
    to:   "      (v_doc.property_id, 'general_ledger', v_doc.id, 'active', v_sha, v_bytes, null, v_path, v_order, v_start, v_end, 'extracted'," },
  { id: 'L40', file: RB, why: 'the rollback leaves the maintenance table behind', from: "drop table if exists public.ledger_maintenance_runs;\n", to: "" },
  { id: 'E18', file: COM, verifier: VAPI, why: 'an unexpected database error is repeated to the person word for word',
    from: "  if (code && SAFE_CODES[code]) {", to: "  if (true) {" },
  { id: 'E19', file: COM, verifier: VAPI, why: 'an unexpected database error is not logged under its reference',
    from: "  (log || console.error)(`[ledger] unexpected database refusal ref=${ref} status=${status} code=${code || '-'} body=${String(bodyText || '').slice(0, 2000)}`);\n", to: "" },
  { id: 'E20', file: COM, verifier: VAPI, why: 'too many imports (53400) is told as a generic failure',
    from: "  '53400': 429,   // configuration_limit_exceeded — too many imports by one person\n", to: "" },
  { id: 'E21', file: IMP, verifier: VAPI, why: 'an editor\'s unbalanced override reaches the database as if it were the owner\'s (the endpoint names the wrong person)',
    from: "          p_actor: user.id, p_document_id: doc.id,", to: "          p_actor: doc.user_id, p_document_id: doc.id," },
  { id: 'E09', file: UPL, verifier: VAPI, why: 'upload.js no longer hands ?op=ledger-… to the ledger handlers',
    from: "  if (op !== undefined) {", to: "  if (false) {" },
  { id: 'E10', file: UPL, verifier: VAPI, why: 'an operation upload.js does not serve is not refused',
    from: "    if (typeof op !== 'string' || !Object.prototype.hasOwnProperty.call(LEDGER_OPS, op)) {\n      return res.status(400).json({ error: 'Unknown operation' });\n    }\n    return LEDGER_OPS[op](req, res);",
    to: "    if (typeof op === 'string' && Object.prototype.hasOwnProperty.call(LEDGER_OPS, op)) return LEDGER_OPS[op](req, res);" },
  { id: 'E11', file: REV, verifier: VAPI, why: 'no rate limit in front of the reversal',
    from: "    if (!rl.ok) return rate.sendRateLimited(res, rl);", to: "" },
  { id: 'E12', file: IMP, verifier: VAPI, why: 'the import may wait on the database past upload.js\'s 30 s',
    from: "        signal: AbortSignal.timeout(10000),", to: "        signal: AbortSignal.timeout(55000)," },
];

// MS_ONLY=L25,L26 runs only those mutants (after the same baseline).
const ONLY = (process.env.MS_ONLY || '').split(',').filter(Boolean);
if (ONLY.length) MUTANTS.splice(0, MUTANTS.length, ...MUTANTS.filter(m => ONLY.includes(m.id)));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-mut-'));
for (const entry of ['migrations', 'tools', 'api', 'gl-import.js', 'request-limits.js', 'script.js', 'vercel.json']) fs.cpSync(path.join(ROOT, entry), path.join(tmp, entry), { recursive: true });
// The endpoint verifier compares a normal upload with HEAD's api/upload.js; the copy has no .git, so it is told where the checkout is.
const ENV = Object.assign({}, process.env, { LEDGER_GIT_ROOT: ROOT });
const verify = (v) => { try { execFileSync(process.execPath, [v], { cwd: tmp, stdio: 'pipe', timeout: 1500000, env: ENV }); return true; } catch (_) { return false; } };

const baseline = verify(V046) && verify(VAPI) && verify(VCON);
console.log('Baseline (unmutated copy, both verifiers): ' + (baseline ? 'PASS' : 'FAIL'));
if (!baseline) { console.error('\nThe unmutated copy does not pass; nothing is mutated.'); fs.rmSync(tmp, { recursive: true, force: true }); process.exit(2); }

let killed = 0;
const survived = [], equivalent = [];
for (const m of MUTANTS) {
  const file = path.join(tmp, m.file);
  const orig = fs.readFileSync(file, 'utf8');
  let src = orig, bad = null;
  for (const e of [m, m.extra].filter(Boolean)) {
    const i = src.indexOf(e.from);
    if (i === -1) { bad = 'ANCHOR NOT FOUND'; break; }
    if (src.indexOf(e.from, i + 1) !== -1) { bad = 'ANCHOR NOT UNIQUE'; break; }
    src = src.slice(0, i) + e.to + src.slice(i + e.from.length);
  }
  if (bad) { console.log(`  ??   ${m.id}  ${bad} — malformed mutant`); survived.push(`${m.id} (${bad})`); continue; }
  fs.writeFileSync(file, src);
  const passed = verify(m.verifier || V046);
  fs.writeFileSync(file, orig);
  if (!passed) { killed++; console.log(`  kill ${m.id}  ${m.why}`); continue; }
  if (m.equivalent) { equivalent.push(m.id); console.log(`  equiv ${m.id}  ${m.why} (equivalent mutant — see its note)`); continue; }
  survived.push(`${m.id}: ${m.why}`);
  console.log(`  LIVE ${m.id}  ${m.why}`);
}
console.log(`\n${killed}/${MUTANTS.length - equivalent.length} non-equivalent mutants killed` + (equivalent.length ? `; ${equivalent.length} equivalent (${equivalent.join(', ')})` : ''));
if (survived.length) { console.log('\nSURVIVORS — each needs a written verdict:'); survived.forEach(x => console.log('  · ' + x)); }
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(survived.length ? 1 : 0);
