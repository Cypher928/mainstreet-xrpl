'use strict';
/**
 * tools/migrate/prepare-migration.js — the local, no-network half of applying a
 * migration to Pilot. It checks a migration is ready, records an approval the
 * apply script will honour, and packs the hand-off folder. It never contacts
 * Supabase and never reads a token.
 *
 *   node tools/migrate/prepare-migration.js 046_acquisition_general_ledger
 *       Report only: files present, hashes, Pilot guard present, dependencies the
 *       header names, which statements the Supabase connector's destructive-SQL
 *       detector would flag (= whether the connector apply path is usable at all),
 *       whether a verifier and a live matrix exist. Exit 0 when ready, 1 when not.
 *
 *   node tools/migrate/prepare-migration.js <name> --verify
 *       Also runs tools/verify-migration-<NNN>*.js (throwaway PostgreSQL cluster).
 *
 *   node tools/migrate/prepare-migration.js <name> --approve "Lynn, chat 2026-10-05" [--verification "136/136"]
 *       Writes tools/migrate/approvals/<name>.approval from the file on disk. Run
 *       this ONLY after the person responsible has approved that exact file in
 *       writing; the note goes in verbatim so the record says who and when.
 *
 *   node tools/migrate/prepare-migration.js <name> --bundle <dir>
 *       Copies apply-migration.sh, the .sql and the .approval into <dir> and
 *       prints the single line the operator runs. Requires an approval.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const args = process.argv.slice(2);
const name = args[0];
if (!name || !/^[0-9]{3}[a-z]?_[A-Za-z0-9_]+$/.test(name)) { console.error('usage: prepare-migration.js <NNN_snake_case> [--verify] [--approve "<who, when>"] [--verification "<note>"] [--bundle <dir>]'); process.exit(64); }
const flag = (f) => { const i = args.indexOf(f); return i === -1 ? null : (args[i + 1] || ''); };
const has = (f) => args.includes(f);
const num = name.split('_')[0];
const md5 = (buf) => crypto.createHash('md5').update(buf).digest('hex');
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
/** Free text written into a key=value file: one line, no control characters, nothing token-shaped. */
const oneLine = (s) => { const t = String(s).replace(/[\r\n\t\0]+/g, ' ').trim(); if (/sbp_[0-9a-f]{20,}|Bearer /.test(t)) { console.error('refusing to write something token-shaped into an approval'); process.exit(64); } return t; };
let ready = true;
const say = (ok, msg) => { console.log((ok ? '  ok   ' : '  NOT  ') + msg); if (!ok) ready = false; };

console.log(`prepare ${name} (local only; no network, no token)`);
const sqlPath = path.join(ROOT, 'migrations', `${name}.sql`);
const rbPath = path.join(ROOT, 'migrations', `${name}_rollback.sql`);
say(fs.existsSync(sqlPath), `migration file migrations/${name}.sql`);
say(fs.existsSync(rbPath), `rollback file migrations/${name}_rollback.sql`);
if (!fs.existsSync(sqlPath)) process.exit(1);
const sql = fs.readFileSync(sqlPath);
const text = sql.toString('utf8');
const sqlMd5 = md5(sql), sqlBytes = sql.length;
const rb = fs.existsSync(rbPath) ? fs.readFileSync(rbPath) : null;
console.log(`       md5=${sqlMd5} sha256=${sha256(sql)} bytes=${sqlBytes}` + (rb ? `  rollback md5=${md5(rb)} bytes=${rb.length}` : ''));
say(/fd9c09b1-b657-4c58-9999-c3cce28e7600/.test(text) && /REFUSING TO RUN/.test(text), 'Pilot marker guard present (refuses to run anywhere but Pilot)');
say(/^begin;\s*$/m.test(text) && /^commit;\s*$/m.test(text), 'wrapped in begin; … commit; (one transaction, all or nothing)');
say(!/\b(zhsuhehgehbzkmzurzyf)\b/.test(text), 'does not mention the Production project');
const deps = (text.match(/to_regprocedure\('public\.([a-z_]+)\(|to_regclass\('public\.([a-z_]+)'\)/g) || []).map(s => s.replace(/.*public\./, '').replace(/[('].*$/, ''));
console.log(`       prerequisites the header checks for: ${deps.length ? [...new Set(deps)].join(', ') : '(none declared)'}`);
// Replay of the Supabase MCP destructive-SQL detector (comments stripped, split on ';', statement starts with drop/delete/truncate):
const stripped = text.replace(/--[^\n]*/g, '');
const flagged = stripped.split(';').filter(p => /^\s*(drop|delete|truncate)\s/i.test(p)).length;
console.log(`       statements the Supabase connector flags as destructive: ${flagged}` + (flagged ? '  → the connector apply path will hang (unrenderable confirmation); use the hand-off script' : '  → the connector apply path may work, but the hand-off script is still the recorded procedure'));
const verifiers = fs.readdirSync(path.join(ROOT, 'tools')).filter(f => f.startsWith(`verify-migration-${num}`) && f.endsWith('.js'));
say(verifiers.length > 0, `local verifier: ${verifiers.join(', ') || 'none found (tools/verify-migration-' + num + '*.js)'}`);
const matrix = path.join(__dirname, 'live-matrix', `${name}.sql`);
console.log(`       live matrix for after the apply: ${fs.existsSync(matrix) ? 'tools/migrate/live-matrix/' + name + '.sql' : 'none yet (write one before the apply; see the 045 file)'}`);
if (has('--verify') && verifiers.length) {
  for (const v of verifiers) {
    try { const out = execFileSync(process.execPath, [path.join('tools', v)], { cwd: ROOT, stdio: 'pipe', timeout: 1800000 }).toString(); const m = out.match(/RESULT: (\d+) passed, (\d+) failed/); say(m && m[2] === '0', `${v}: ${m ? m[0] : 'ran, no RESULT line'}`); }
    catch (e) { say(false, `${v} failed: ${String(e.stdout || e.message).split('\n').filter(Boolean).slice(-3).join(' | ')}`); }
  }
}
const approvalsDir = path.join(__dirname, 'approvals');
const approvalPath = path.join(approvalsDir, `${name}.approval`);
const approveNote = flag('--approve');
if (approveNote !== null) {
  if (!approveNote.trim()) { console.error('--approve needs a note: who approved and when (e.g. "Lynn, chat 2026-10-05")'); process.exit(64); }
  if (!ready) { console.error('not writing an approval: the checks above did not all pass'); process.exit(1); }
  fs.mkdirSync(approvalsDir, { recursive: true });
  const body = [
    '# Approval record — read by tools/migrate/apply-migration.sh. One file per migration.',
    '# The script refuses to send unless the .sql file hashes to sql_md5/sql_bytes and',
    '# project_ref is the Pilot project. Never put a token or secret in this file.',
    `migration_name=${name}`, 'project_ref=bhmktujbxdbvdmpybmad', 'project_name=mainstreet-pilot',
    `sql_md5=${sqlMd5}`, `sql_sha256=${sha256(sql)}`, `sql_bytes=${sqlBytes}`,
    `rollback_file=${rb ? name + '_rollback.sql' : ''}`, `rollback_md5=${rb ? md5(rb) : ''}`, `rollback_sha256=${rb ? sha256(rb) : ''}`,
    `approved_on=${new Date().toISOString().slice(0, 10)}`, `approved_by=${oneLine(approveNote)}`,
    `local_verification=${oneLine(flag('--verification') || '')}`,
    '# Filled in after the apply:', 'applied_on=', 'applied_version=', 'idempotency_key=', 'applied_by=', ''].join('\n');
  if (fs.existsSync(approvalPath)) { console.error(`approval already exists: ${path.relative(ROOT, approvalPath)}. Delete it deliberately if the approval is being redone.`); process.exit(1); }
  fs.writeFileSync(approvalPath, body);
  say(true, `approval written: ${path.relative(ROOT, approvalPath)} (md5 ${sqlMd5})`);
}
const bundleDir = flag('--bundle');
if (bundleDir !== null) {
  if (!bundleDir) { console.error('--bundle needs a directory'); process.exit(64); }
  if (!fs.existsSync(approvalPath)) { console.error(`no approval for ${name}; run --approve first (after the written approval)`); process.exit(1); }
  const a = fs.readFileSync(approvalPath, 'utf8');
  if (!a.includes(`sql_md5=${sqlMd5}`) || !a.includes(`sql_sha256=${sha256(sql)}`) || !a.includes(`sql_bytes=${sqlBytes}`)) { console.error('the approval does not match the file on disk any more; the file changed after approval. Not bundling.'); process.exit(1); }
  fs.mkdirSync(bundleDir, { recursive: true });
  for (const [src, dst] of [[path.join(__dirname, 'apply-migration.sh'), 'apply-migration.sh'], [sqlPath, `${name}.sql`], [approvalPath, `${name}.approval`]]) fs.copyFileSync(src, path.join(bundleDir, dst));
  fs.chmodSync(path.join(bundleDir, 'apply-migration.sh'), 0o755);
  say(true, `bundle written to ${bundleDir}: apply-migration.sh, ${name}.sql, ${name}.approval`);
  console.log(`       script md5 ${md5(fs.readFileSync(path.join(bundleDir, 'apply-migration.sh')))}`);
  console.log('\nOperator line (in the folder holding the three files; it asks for the token at a silent prompt):');
  console.log(`  chmod +x apply-migration.sh && ./apply-migration.sh ${name}`);
}
console.log(ready ? '\nREADY' : '\nNOT READY');
process.exit(ready ? 0 : 1);
